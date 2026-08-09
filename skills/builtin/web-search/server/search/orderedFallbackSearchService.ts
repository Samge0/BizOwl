import { PlaywrightCrawler, RequestList, Configuration } from 'crawlee';
import { chromium } from 'playwright';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SearchCache, hashCacheKey } from '../cache/searchCache';
import {
  BrowserConfig,
  resolveBrowserBackend,
  SearchConfig,
  shouldFallbackToElectronBackend
} from '../config';
import { getChromePath } from '../playwright/browser';
import {
  BrowserBackend,
  ContentResponse,
  SearchEngine,
  SearchEnginePreference,
  SearchResponse,
  SearchResult
} from './types';
import { ElectronBrowserAction, ElectronBrowserClient } from './electronBrowserClient';
import { parseSearchResults } from './parsers';
import { extractReadableContent, ReadableContent } from './readability';
import { filterSearchResults } from './resultFilter';
import { scoreAndSort } from './relevanceScorer';
import { canonicalizeUrl } from './parsers/shared';

type SourceSummary = NonNullable<SearchResponse['sources']>[number];

interface OrderedFallbackSearchOptions {
  query: string;
  maxResults?: number;
  engine: SearchEnginePreference;
  fallbackOrder?: SearchEngine[] | null;
}

interface SourceDefinition {
  engine: SearchEngine;
  url: string;
}

const BLOCKED_RESOURCE_TYPES = new Set(['script', 'image', 'media', 'font']);

export class OrderedFallbackSearchService {
  private cache: SearchCache;
  private electronBrowser: ElectronBrowserClient;

  constructor(
    private searchConfig: SearchConfig,
    private browserConfig: BrowserConfig
  ) {
    this.cache = new SearchCache();
    this.electronBrowser = new ElectronBrowserClient(browserConfig);
  }

  async search(options: OrderedFallbackSearchOptions): Promise<SearchResponse> {
    const startTime = Date.now();
    const maxResults = options.maxResults || this.searchConfig.defaultMaxResults;
    const engines = this.resolveEngines(options.engine, options.fallbackOrder);
    const cacheIdentity = this.buildSearchCacheIdentity(options.query, maxResults, options.engine, engines);
    const cacheKey = hashCacheKey('search', {
      ...cacheIdentity
    });

    const cached = await this.cache.get<SearchResponse>(cacheKey);
    if (cached) {
      return {
        ...cached,
        cache: { hit: true, key: cacheKey },
        duration: Date.now() - startTime
      };
    }

    const sourceSummaries: SourceSummary[] = [];
    const diagnostics: NonNullable<SearchResponse['diagnostics']> = {
      failedEngines: []
    };

    for (const engine of engines) {
      const results = await this.runSearchSource(engine, options.query, maxResults, sourceSummaries, diagnostics);
      if (results.length === 0) {
        continue;
      }

      const response: SearchResponse = {
        query: options.query,
        engine,
        results,
        totalResults: results.length,
        timestamp: Date.now(),
        duration: Date.now() - startTime,
        sources: sourceSummaries,
        cache: { hit: false, key: cacheKey },
        diagnostics: this.hasDiagnostics(diagnostics) ? diagnostics : undefined
      };

      await this.cache.set(cacheKey, response, this.searchConfig.cacheTtlMs);
      return response;
    }

    const errors = sourceSummaries
      .filter((source) => !source.success)
      .map((source) => `${source.engine}: ${source.error || 'no results'}`);
    throw new Error(`All configured search engines failed. ${errors.join(' | ')}`);
  }

  async getContent(url: string): Promise<ContentResponse> {
    const startTime = Date.now();
    const contentMaxChars = this.searchConfig.contentMaxChars;
    const cacheKey = hashCacheKey('content', { url, contentMaxChars });
    const cached = await this.cache.get<ContentResponse>(cacheKey);
    if (cached) {
      return {
        ...cached,
        cached: true,
        duration: Date.now() - startTime
      };
    }

    let html = '';
    let finalUrl = url;
    try {
      const rendered = await this.renderHtml(url);
      finalUrl = rendered.url;
      html = rendered.html;
    } catch (error) {
      throw new Error(`Failed to fetch content: ${error instanceof Error ? error.message : String(error)}`);
    }

    const readable = this.limitReadableContent(extractReadableContent(finalUrl, html), contentMaxChars);
    const response: ContentResponse = {
      url: finalUrl,
      ...readable,
      cached: false,
      timestamp: Date.now(),
      duration: Date.now() - startTime
    };
    await this.cache.set(cacheKey, response, this.searchConfig.contentCacheTtlMs);
    return response;
  }

  private limitReadableContent(
    readable: ReadableContent,
    maxChars: number
  ): Omit<ContentResponse, 'url' | 'cached' | 'timestamp' | 'duration'> {
    const textContent = readable.textContent.replace(/\s+/g, ' ').trim();
    const textContentLength = textContent.length;
    const shouldTruncate = maxChars > 0 && textContentLength > maxChars;
    return {
      ...readable,
      textContent: shouldTruncate ? textContent.slice(0, maxChars) : textContent,
      textContentLength,
      textContentTruncated: shouldTruncate,
      textContentMaxChars: maxChars
    };
  }

  private resolveEngines(
    preferredEngine: SearchEnginePreference,
    fallbackOrder?: SearchEngine[] | null
  ): SearchEngine[] {
    if (
      preferredEngine === SearchEngine.Baidu
      || preferredEngine === SearchEngine.Bing
      || preferredEngine === SearchEngine.So360
      || preferredEngine === SearchEngine.Sogou
      || preferredEngine === SearchEngine.Google
    ) {
      return [preferredEngine];
    }

    const configured = (fallbackOrder ?? this.searchConfig.fallbackOrder).filter((engine) =>
      engine === SearchEngine.Baidu
      || engine === SearchEngine.Bing
      || engine === SearchEngine.So360
      || engine === SearchEngine.Sogou
      || engine === SearchEngine.Google
    );
    return Array.from(new Set([
      ...configured,
      SearchEngine.Bing,
      SearchEngine.Baidu,
      SearchEngine.So360,
      SearchEngine.Sogou,
      SearchEngine.Google
    ]));
  }

  private buildSearchCacheIdentity(
    query: string,
    maxResults: number,
    preferredEngine: SearchEnginePreference,
    engines: SearchEngine[]
  ): Record<string, unknown> {
    if (
      preferredEngine === SearchEngine.Baidu
      || preferredEngine === SearchEngine.Bing
      || preferredEngine === SearchEngine.So360
      || preferredEngine === SearchEngine.Sogou
      || preferredEngine === SearchEngine.Google
    ) {
      return {
        query,
        maxResults,
        engine: preferredEngine
      };
    }

    return {
      query,
      maxResults,
      engine: SearchEnginePreference.Auto,
      fallbackOrder: engines
    };
  }

  private buildSearchUrl(engine: SearchEngine, query: string): string {
    if (engine === SearchEngine.Baidu) {
      return `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`;
    }
    if (engine === SearchEngine.So360) {
      return `https://www.so.com/s?q=${encodeURIComponent(query)}`;
    }
    if (engine === SearchEngine.Sogou) {
      return `https://www.sogou.com/web?query=${encodeURIComponent(query)}`;
    }
    if (engine === SearchEngine.Google) {
      return `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en`;
    }
    if (engine === SearchEngine.Bing) {
      return `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
    }
    return query;
  }

  private async runSearchSource(
    engine: SearchEngine,
    query: string,
    maxResults: number,
    sourceSummaries: SourceSummary[],
    diagnostics: NonNullable<SearchResponse['diagnostics']>
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const source = { engine, url: this.buildSearchUrl(engine, query) };
    if (this.shouldPreferElectronBackend()) {
      try {
        const htmlResult = await this.runElectronSearchSource(source, maxResults);
        results.push(...htmlResult.results);
        sourceSummaries.push({
          engine,
          success: true,
          results: htmlResult.results.length
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        diagnostics.failedEngines = [...(diagnostics.failedEngines || []), `${engine} electron: ${message}`];
        if (this.browserConfig.backend === BrowserBackend.Electron) {
          sourceSummaries.push({
            engine,
            success: false,
            results: 0,
            error: message
          });
        } else {
          console.warn(`[WebSearch] Electron browser backend failed for ${engine}, falling back to Playwright: ${message}`);
          await this.runCrawler([source], maxResults, results, sourceSummaries, diagnostics);
        }
      }
    } else {
      try {
        await this.runCrawler([source], maxResults, results, sourceSummaries, diagnostics);
      } catch (error) {
        if (!this.shouldFallbackToElectronBackend()) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        diagnostics.failedEngines = [...(diagnostics.failedEngines || []), `${engine} playwright: ${message}`];
        console.warn(`[WebSearch] Playwright browser backend failed for ${engine}, falling back to Electron: ${message}`);
        const htmlResult = await this.runElectronSearchSource(source, maxResults);
        results.push(...htmlResult.results);
        sourceSummaries.push({
          engine,
          success: true,
          results: htmlResult.results.length
        });
      }
    }
    const filtered = filterSearchResults(results);
    if (filtered.filteredCount > 0) {
      diagnostics.filteredResults = [
        ...(diagnostics.filteredResults || []),
        `${engine}: ${filtered.filteredCount}`
      ];
      for (let index = sourceSummaries.length - 1; index >= 0; index -= 1) {
        const sourceSummary = sourceSummaries[index];
        if (sourceSummary.engine === engine && sourceSummary.success) {
          sourceSummary.results = filtered.results.length;
          if (filtered.results.length === 0) {
            sourceSummary.success = false;
            sourceSummary.error = 'all results were filtered';
          }
          break;
        }
      }
    }
    return filtered.results.slice(0, maxResults).map((result, index) => ({
      ...result,
      position: index + 1
    }));
  }

  private hasDiagnostics(diagnostics: NonNullable<SearchResponse['diagnostics']>): boolean {
    return Boolean(
      diagnostics.skippedEngines?.length
      || diagnostics.failedEngines?.length
      || diagnostics.blockedEngines?.length
      || diagnostics.filteredResults?.length
    );
  }

  private shouldPreferElectronBackend(): boolean {
    return resolveBrowserBackend(
      this.browserConfig.backend,
      process.platform,
      this.electronBrowser.isConfigured()
    ) === BrowserBackend.Electron;
  }

  private shouldFallbackToElectronBackend(): boolean {
    return shouldFallbackToElectronBackend(
      this.browserConfig.backend,
      process.platform,
      this.electronBrowser.isConfigured()
    );
  }

  private async renderHtml(url: string): Promise<{ url: string; html: string }> {
    if (this.shouldPreferElectronBackend()) {
      try {
        return await this.renderHtmlWithElectron(url);
      } catch (error) {
        if (this.browserConfig.backend === BrowserBackend.Electron) {
          throw error;
        }
        console.warn(`[WebSearch] Electron browser content fetch failed, falling back to Playwright: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    let html = '';
    let finalUrl = url;
    try {
      await this.runCrawler(
        [{ engine: SearchEngine.Bing, url }],
        1,
        [],
        [],
        {},
        async ({ page }) => {
          finalUrl = page.url();
          html = await page.content();
        }
      );
    } catch (error) {
      if (!this.shouldFallbackToElectronBackend()) {
        throw error;
      }
      console.warn(`[WebSearch] Playwright browser content fetch failed, falling back to Electron: ${error instanceof Error ? error.message : String(error)}`);
      return await this.renderHtmlWithElectron(url);
    }
    return { url: finalUrl, html };
  }

  private async renderHtmlWithElectron(url: string): Promise<{ url: string; html: string }> {
    const pageId = await this.electronBrowser.createPage();
    try {
      const nav = await this.electronBrowser.request({
        action: ElectronBrowserAction.Navigate,
        pageId,
        url,
        waitUntil: 'domcontentloaded',
        timeout: this.searchConfig.navigationTimeout
      });
      const content = await this.electronBrowser.request({
        action: ElectronBrowserAction.GetContent,
        pageId
      });
      return {
        url: content.url || nav.url || url,
        html: content.content || ''
      };
    } finally {
      await this.electronBrowser.closePage(pageId).catch(() => undefined);
    }
  }

  private async runElectronSearchSource(
    source: SourceDefinition,
    maxResults: number
  ): Promise<{ results: SearchResult[] }> {
    const rendered = await this.renderHtmlWithElectron(source.url);
    const results = parseSearchResults(source.engine, rendered.html, rendered.url, maxResults);
    if (results.length === 0) {
      throw new Error(`${source.engine} returned no parsable results`);
    }
    return { results };
  }

  private async runCrawler(
    sources: SourceDefinition[],
    maxResults: number,
    allResults: SearchResult[],
    sourceSummaries: SourceSummary[],
    diagnostics: NonNullable<SearchResponse['diagnostics']>,
    customHandler?: (context: { page: import('playwright').Page }) => Promise<void>
  ): Promise<void> {
    const requestList = await RequestList.open(null, sources.map((source) => ({
      url: source.url,
      uniqueKey: `${source.engine}:${source.url}`,
      userData: { engine: source.engine }
    })));
    const config = new Configuration({
      storageClientOptions: {
        localDataDirectory: '.cache/crawlee'
      },
      persistStorage: false
    });

    const crawler = new PlaywrightCrawler({
      requestList,
      maxConcurrency: this.searchConfig.maxConcurrency,
      maxRequestRetries: 0,
      navigationTimeoutSecs: Math.ceil(this.searchConfig.navigationTimeout / 1000),
      requestHandlerTimeoutSecs: Math.ceil(this.searchConfig.searchTimeout / 1000),
      launchContext: {
        launcher: chromium,
        launchOptions: {
          headless: this.browserConfig.headless,
          executablePath: this.resolveExecutablePath(),
          args: this.browserConfig.chromeFlags || []
        }
      },
      preNavigationHooks: [
        async ({ page }) => {
          await page.route('**/*', async (route) => {
            const resourceType = route.request().resourceType();
            if (BLOCKED_RESOURCE_TYPES.has(resourceType)) {
              await route.abort();
              return;
            }
            await route.continue();
          });
        }
      ],
      requestHandler: async ({ page, request }) => {
        if (customHandler) {
          await customHandler({ page });
          return;
        }

        const engine = request.userData.engine as SearchEngine;
        const html = await page.content();
        const results = parseSearchResults(engine, html, page.url(), maxResults);
        if (results.length === 0) {
          throw new Error(`${engine} returned no parsable results`);
        }

        allResults.push(...results);
        sourceSummaries.push({
          engine,
          success: true,
          results: results.length
        });
      },
      failedRequestHandler: async ({ request, error }) => {
        const engine = request.userData.engine as SearchEngine;
        const message = error instanceof Error ? error.message : String(error);
        sourceSummaries.push({
          engine,
          success: false,
          results: 0,
          error: message
        });
        diagnostics.failedEngines = [...(diagnostics.failedEngines || []), `${engine}: ${message}`];
      }
    }, config);

    await crawler.run();
  }

  private resolveExecutablePath(): string | undefined {
    if (this.browserConfig.chromePath && existsSync(this.browserConfig.chromePath)) {
      return this.browserConfig.chromePath;
    }

    try {
      return getChromePath();
    } catch {
      return undefined;
    }
  }

  /**
   * 多引擎并行搜索 + 聚合
   * 同时查询 2-3 个搜索引擎，合并去重，按相关性评分排序。
   */
  async multiSearch(options: {
    query: string;
    maxResults?: number;
    engines?: SearchEngine[];
    minScore?: number;
  }): Promise<SearchResponse & { multiSearch: boolean; rawTotal: number; scoreRange: { min: number; max: number } | null }> {
    const startTime = Date.now();
    const maxResults = options.maxResults || 15;
    const minScore = options.minScore ?? 35;

    let engines: SearchEngine[];
    if (options.engines && options.engines.length > 0) {
      engines = options.engines;
    } else {
      engines = this.resolveEngines(SearchEnginePreference.Auto, undefined).slice(0, 3);
    }
    if (engines.length === 0) {
      engines = [SearchEngine.So360, SearchEngine.Bing, SearchEngine.Baidu];
    }

    const sourceSummaries: SourceSummary[] = [];
    const diagnostics: NonNullable<SearchResponse['diagnostics']> = {
      failedEngines: [],
      multiSearch: true,
      enginesQueried: engines
    } as any;

    // 并行查询
    const searchPromises = engines.map(async (engine) => {
      try {
        const results = await this.runSearchSource(engine, options.query, maxResults, sourceSummaries, diagnostics);
        return { engine, results, success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { engine, results: [] as SearchResult[], success: false, error: message };
      }
    });

    const searchResults = await Promise.allSettled(searchPromises);
    const allResults: SearchResult[] = [];
    const engineStats: any[] = [];

    for (const sr of searchResults) {
      if (sr.status === 'fulfilled' && sr.value.success) {
        allResults.push(...sr.value.results);
        engineStats.push({ engine: sr.value.engine, resultCount: sr.value.results.length });
      } else if (sr.status === 'fulfilled') {
        engineStats.push({ engine: sr.value.engine, resultCount: 0, error: sr.value.error });
      }
    }

    if (allResults.length === 0) {
      throw new Error(`Multi-search: all engines failed.`);
    }

    // 去重
    const seen = new Set<string>();
    const deduped: SearchResult[] = [];
    for (const result of allResults) {
      const key = canonicalizeUrl(result.url);
      if (!seen.has(key) && result.url) {
        seen.add(key);
        deduped.push(result);
      }
    }

    // 相关性评分 + 排序
    const scored = scoreAndSort(deduped, options.query);
    const filtered = scored.filter(r => (r._relevanceScore || 0) >= minScore);
    const finalResults = (filtered.length >= Math.min(5, maxResults) ? filtered : scored).slice(0, maxResults);

    return {
      query: options.query,
      engine: 'multi' as any,
      results: finalResults.map((result, index) => ({ ...result, position: index + 1 })),
      totalResults: finalResults.length,
      timestamp: Date.now(),
      duration: Date.now() - startTime,
      sources: engineStats,
      cache: { hit: false, key: null },
      diagnostics: this.hasDiagnostics(diagnostics) ? diagnostics : undefined,
      multiSearch: true,
      rawTotal: deduped.length,
      scoreRange: finalResults.length > 0
        ? { min: finalResults[finalResults.length - 1]._relevanceScore || 0, max: finalResults[0]._relevanceScore || 0 }
        : null
    } as any;
  }
}
