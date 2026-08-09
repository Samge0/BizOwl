"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrderedFallbackSearchService = void 0;
const crawlee_1 = require("crawlee");
const playwright_1 = require("playwright");
const fs_1 = require("fs");
const searchCache_1 = require("../cache/searchCache");
const config_1 = require("../config");
const browser_1 = require("../playwright/browser");
const types_1 = require("./types");
const electronBrowserClient_1 = require("./electronBrowserClient");
const parsers_1 = require("./parsers");
const readability_1 = require("./readability");
const resultFilter_1 = require("./resultFilter");
const engineScorer_1 = require("./engineScorer");
const relevanceScorer_1 = require("./relevanceScorer");
const UserAgent = require('user-agents');
const BLOCKED_RESOURCE_TYPES = new Set(['script', 'image', 'media', 'font']);
class OrderedFallbackSearchService {
    searchConfig;
    browserConfig;
    cache;
    electronBrowser;
    constructor(searchConfig, browserConfig) {
        this.searchConfig = searchConfig;
        this.browserConfig = browserConfig;
        this.cache = new searchCache_1.SearchCache();
        this.electronBrowser = new electronBrowserClient_1.ElectronBrowserClient(browserConfig);
    }
    async search(options) {
        const startTime = Date.now();
        const maxResults = options.maxResults || this.searchConfig.defaultMaxResults;
        const engines = this.resolveEngines(options.engine, options.fallbackOrder);
        const cacheIdentity = this.buildSearchCacheIdentity(options.query, maxResults, options.engine, engines);
        const cacheKey = (0, searchCache_1.hashCacheKey)('search', {
            ...cacheIdentity
        });
        const cached = await this.cache.get(cacheKey);
        if (cached) {
            return {
                ...cached,
                cache: { hit: true, key: cacheKey },
                duration: Date.now() - startTime
            };
        }
        const sourceSummaries = [];
        const diagnostics = {
            failedEngines: []
        };
        for (const engine of engines) {
            const engineStartTime = Date.now();
            const results = await this.runSearchSource(engine, options.query, maxResults, sourceSummaries, diagnostics);
            // 动态评分：记录每个引擎的实际表现（成功/失败/结果数/速度）
            const engineDuration = Date.now() - engineStartTime;
            try { (0, engineScorer_1.default)().recordSearch(engine, results.length > 0, results.length, engineDuration); } catch {}
            if (results.length === 0) {
                continue;
            }
            const response = {
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
    async getContent(url) {
        const startTime = Date.now();
        const contentMaxChars = this.searchConfig.contentMaxChars;
        const cacheKey = (0, searchCache_1.hashCacheKey)('content', { url, contentMaxChars });
        const cached = await this.cache.get(cacheKey);
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
        }
        catch (error) {
            throw new Error(`Failed to fetch content: ${error instanceof Error ? error.message : String(error)}`);
        }
        const readable = this.limitReadableContent((0, readability_1.extractReadableContent)(finalUrl, html), contentMaxChars);
        const response = {
            url: finalUrl,
            ...readable,
            cached: false,
            timestamp: Date.now(),
            duration: Date.now() - startTime
        };
        await this.cache.set(cacheKey, response, this.searchConfig.contentCacheTtlMs);
        return response;
    }
    limitReadableContent(readable, maxChars) {
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
    resolveEngines(preferredEngine, fallbackOrder) {
        if (preferredEngine === types_1.SearchEngine.Baidu
            || preferredEngine === types_1.SearchEngine.Bing
            || preferredEngine === types_1.SearchEngine.So360
            || preferredEngine === types_1.SearchEngine.Sogou
            || preferredEngine === types_1.SearchEngine.Google) {
            return [preferredEngine];
        }
        const configured = (fallbackOrder ?? this.searchConfig.fallbackOrder).filter((engine) => engine === types_1.SearchEngine.Baidu
            || engine === types_1.SearchEngine.Bing
            || engine === types_1.SearchEngine.So360
            || engine === types_1.SearchEngine.Sogou
            || engine === types_1.SearchEngine.Google);
        const staticOrder = Array.from(new Set([
            ...configured,
            types_1.SearchEngine.So360,
            types_1.SearchEngine.Bing,
            types_1.SearchEngine.Baidu,
            types_1.SearchEngine.Sogou,
            types_1.SearchEngine.Google
        ]));
        // 动态评分排序：评分高的引擎优先尝试，评分接近的保持静态顺序
        try {
            const scorer = (0, engineScorer_1.default)();
            return scorer.sortByScore(staticOrder);
        }
        catch {
            return staticOrder;
        }
    }
    buildSearchCacheIdentity(query, maxResults, preferredEngine, engines) {
        if (preferredEngine === types_1.SearchEngine.Baidu
            || preferredEngine === types_1.SearchEngine.Bing
            || preferredEngine === types_1.SearchEngine.So360
            || preferredEngine === types_1.SearchEngine.Sogou
            || preferredEngine === types_1.SearchEngine.Google) {
            return {
                query,
                maxResults,
                engine: preferredEngine
            };
        }
        return {
            query,
            maxResults,
            engine: types_1.SearchEnginePreference.Auto,
            fallbackOrder: engines
        };
    }
    buildSearchUrl(engine, query) {
        if (engine === types_1.SearchEngine.Baidu) {
            return `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`;
        }
        if (engine === types_1.SearchEngine.So360) {
            return `https://www.so.com/s?q=${encodeURIComponent(query)}`;
        }
        if (engine === types_1.SearchEngine.Sogou) {
            return `https://www.sogou.com/web?query=${encodeURIComponent(query)}`;
        }
        if (engine === types_1.SearchEngine.Google) {
            return `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en`;
        }
        if (engine === types_1.SearchEngine.Bing) {
            return `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
        }
        return query;
    }
    async runSearchSource(engine, query, maxResults, sourceSummaries, diagnostics) {
        const results = [];
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
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                diagnostics.failedEngines = [...(diagnostics.failedEngines || []), `${engine} electron: ${message}`];
                if (this.browserConfig.backend === types_1.BrowserBackend.Electron) {
                    sourceSummaries.push({
                        engine,
                        success: false,
                        results: 0,
                        error: message
                    });
                }
                else {
                    console.warn(`[WebSearch] Electron browser backend failed for ${engine}, falling back to Playwright: ${message}`);
                    await this.runCrawler([source], maxResults, results, sourceSummaries, diagnostics);
                }
            }
        }
        else {
            try {
                await this.runCrawler([source], maxResults, results, sourceSummaries, diagnostics);
            }
            catch (error) {
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
        const filtered = (0, resultFilter_1.filterSearchResults)(results);
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
    hasDiagnostics(diagnostics) {
        return Boolean(diagnostics.skippedEngines?.length
            || diagnostics.failedEngines?.length
            || diagnostics.blockedEngines?.length
            || diagnostics.filteredResults?.length);
    }
    shouldPreferElectronBackend() {
        return (0, config_1.resolveBrowserBackend)(this.browserConfig.backend, process.platform, this.electronBrowser.isConfigured()) === types_1.BrowserBackend.Electron;
    }
    shouldFallbackToElectronBackend() {
        return (0, config_1.shouldFallbackToElectronBackend)(this.browserConfig.backend, process.platform, this.electronBrowser.isConfigured());
    }
    async renderHtml(url) {
        if (this.shouldPreferElectronBackend()) {
            try {
                return await this.renderHtmlWithElectron(url);
            }
            catch (error) {
                if (this.browserConfig.backend === types_1.BrowserBackend.Electron) {
                    throw error;
                }
                console.warn(`[WebSearch] Electron browser content fetch failed, falling back to Playwright: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        let html = '';
        let finalUrl = url;
        try {
            await this.runCrawler([{ engine: types_1.SearchEngine.Bing, url }], 1, [], [], {}, async ({ page }) => {
                finalUrl = page.url();
                html = await page.content();
            });
        }
        catch (error) {
            if (!this.shouldFallbackToElectronBackend()) {
                throw error;
            }
            console.warn(`[WebSearch] Playwright browser content fetch failed, falling back to Electron: ${error instanceof Error ? error.message : String(error)}`);
            return await this.renderHtmlWithElectron(url);
        }
        return { url: finalUrl, html };
    }
    async renderHtmlWithElectron(url) {
        const pageId = await this.electronBrowser.createPage();
        try {
            const nav = await this.electronBrowser.request({
                action: electronBrowserClient_1.ElectronBrowserAction.Navigate,
                pageId,
                url,
                waitUntil: 'domcontentloaded',
                timeout: this.searchConfig.navigationTimeout
            });
            const content = await this.electronBrowser.request({
                action: electronBrowserClient_1.ElectronBrowserAction.GetContent,
                pageId
            });
            return {
                url: content.url || nav.url || url,
                html: content.content || ''
            };
        }
        finally {
            await this.electronBrowser.closePage(pageId).catch(() => undefined);
        }
    }
    async runElectronSearchSource(source, maxResults) {
        const rendered = await this.renderHtmlWithElectron(source.url);
        const results = (0, parsers_1.parseSearchResults)(source.engine, rendered.html, rendered.url, maxResults);
        if (results.length === 0) {
            throw new Error(`${source.engine} returned no parsable results`);
        }
        return { results };
    }
    async runCrawler(sources, maxResults, allResults, sourceSummaries, diagnostics, customHandler) {
        const requestList = await crawlee_1.RequestList.open(null, sources.map((source) => ({
            url: source.url,
            uniqueKey: `${source.engine}:${source.url}`,
            userData: { engine: source.engine }
        })));
        const config = new crawlee_1.Configuration({
            storageClientOptions: {
                localDataDirectory: '.cache/crawlee'
            },
            persistStorage: false
        });
        const crawler = new crawlee_1.PlaywrightCrawler({
            requestList,
            maxConcurrency: this.searchConfig.maxConcurrency,
            maxRequestRetries: 0,
            navigationTimeoutSecs: Math.ceil(this.searchConfig.navigationTimeout / 1000),
            requestHandlerTimeoutSecs: Math.ceil(this.searchConfig.searchTimeout / 1000),
            launchContext: {
                launcher: playwright_1.chromium,
                launchOptions: {
                    headless: this.browserConfig.headless,
                    executablePath: this.resolveExecutablePath(),
                    args: this.browserConfig.chromeFlags || []
                }
            },
            preNavigationHooks: [
                async ({ page }) => {
                    // 反 headless 检测：每次搜索随机生成真实 UA + 隐藏 webdriver 属性
                    // Bing/百度会检测 HeadlessChrome UA 并返回降级/无关结果
                    // 使用 user-agents 库（内置上千条真实浏览器 UA，含 Chrome/Firefox/Safari × 各平台各版本）
                    const randomUA = new UserAgent({ deviceCategory: 'desktop' }).toString();
                    try {
                        const ctx = page.context();
                        await ctx.addInitScript((ua) => {
                            // 隐藏 webdriver 标志
                            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                            // 覆盖 navigator.userAgent（JS 层反爬检测）
                            Object.defineProperty(navigator, 'userAgent', { get: () => ua });
                            // 覆盖 appVersion（部分反爬会交叉验证）
                            Object.defineProperty(navigator, 'appVersion', { get: () => ua.replace('Mozilla/', '') });
                        }, randomUA);
                        // HTTP 层 UA + 中文语言偏好
                        await page.setExtraHTTPHeaders({
                            'User-Agent': randomUA,
                            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
                        });
                    } catch {}
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
                const engine = request.userData.engine;
                const html = await page.content();
                const results = (0, parsers_1.parseSearchResults)(engine, html, page.url(), maxResults);
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
                const engine = request.userData.engine;
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
    resolveExecutablePath() {
        if (this.browserConfig.chromePath && (0, fs_1.existsSync)(this.browserConfig.chromePath)) {
            return this.browserConfig.chromePath;
        }
        try {
            return (0, browser_1.getChromePath)();
        }
        catch {
            return undefined;
        }
    }
    /**
     * 多引擎并行搜索 + 聚合
     *
     * 同时查询 2-3 个搜索引擎，合并去重，按相关性评分排序。
     * 解决单引擎质量不稳定问题——某个引擎返回词典内容时，
     * 其他引擎的优质结果可以通过聚合胜出。
     *
     * 策略：
     *   1. 从动态评分最高的引擎中选 top-3 并行搜索
     *   2. 合并所有结果，去重（canonical URL）
     *   3. 用 relevanceScorer 对每条结果打相关性分
     *   4. 按相关性排序，低分结果截断
     *   5. 对每个引擎的原始结果数+质量更新 engineScorer
     *
     * @param options.query 搜索查询
     * @param options.maxResults 最大返回数（默认 15）
     * @param options.engines 指定引擎列表（不指定则取动态评分 top-3）
     * @param options.minScore 最低相关性分阈值（默认 35）
     */
    async multiSearch(options) {
        const startTime = Date.now();
        const maxResults = options.maxResults || 15;
        const minScore = options.minScore ?? 35;
        // 决定要查哪些引擎：用户指定 > 动态评分 top-3
        let engines;
        if (options.engines && options.engines.length > 0) {
            engines = options.engines.filter(e =>
                e === types_1.SearchEngine.Baidu || e === types_1.SearchEngine.Bing ||
                e === types_1.SearchEngine.So360 || e === types_1.SearchEngine.Sogou ||
                e === types_1.SearchEngine.Google);
        } else {
            const all = this.resolveEngines(types_1.SearchEnginePreference.Auto, undefined);
            engines = all.slice(0, 3); // 取 top-3
        }
        if (engines.length === 0) {
            engines = [types_1.SearchEngine.So360, types_1.SearchEngine.Bing, types_1.SearchEngine.Baidu];
        }
        const sourceSummaries = [];
        const diagnostics = { failedEngines: [], multiSearch: true, enginesQueried: engines };
        // 并行查询所有引擎
        const searchPromises = engines.map(async (engine) => {
            const engineStartTime = Date.now();
            try {
                const results = await this.runSearchSource(engine, options.query, maxResults, sourceSummaries, diagnostics);
                const engineDuration = Date.now() - engineStartTime;
                try { (0, engineScorer_1.default)().recordSearch(engine, results.length > 0, results.length, engineDuration); } catch {}
                return { engine, results, success: true, duration: engineDuration };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const engineDuration = Date.now() - engineStartTime;
                try { (0, engineScorer_1.default)().recordSearch(engine, false, 0, engineDuration); } catch {}
                return { engine, results: [], success: false, duration: engineDuration, error: message };
            }
        });
        const searchResults = await Promise.allSettled(searchPromises);
        // 收集所有成功引擎的结果
        const allResults = [];
        const engineStats = [];
        for (let i = 0; i < searchResults.length; i++) {
            const sr = searchResults[i];
            if (sr.status === 'fulfilled' && sr.value.success) {
                allResults.push(...sr.value.results);
                engineStats.push({
                    engine: sr.value.engine,
                    resultCount: sr.value.results.length,
                    duration: sr.value.duration
                });
            } else if (sr.status === 'fulfilled') {
                engineStats.push({
                    engine: sr.value.engine,
                    resultCount: 0,
                    duration: sr.value.duration,
                    error: sr.value.error
                });
            }
        }
        if (allResults.length === 0) {
            throw new Error(`Multi-search: all engines failed. ${engineStats.map(s => `${s.engine}: ${s.error || 'no results'}`).join(' | ')}`);
        }
        // 合并去重（用 canonical URL）
        const seen = new Set();
        const deduped = [];
        for (const result of allResults) {
            const key = (0, parsers_1.canonicalizeUrl)(result.url);
            if (!seen.has(key) && result.url) {
                seen.add(key);
                deduped.push(result);
            }
        }
        // 相关性评分 + 排序
        const scored = (0, relevanceScorer_1.scoreAndSort)(deduped, options.query);
        // 过滤低分结果
        const filtered = scored.filter(r => r._relevanceScore >= minScore);
        // 如果过滤后太少，适当降低标准
        const finalResults = (filtered.length >= Math.min(5, maxResults) ? filtered : scored).slice(0, maxResults);
        const response = {
            query: options.query,
            engine: 'multi',
            results: finalResults.map((result, index) => ({
                ...result,
                position: index + 1
            })),
            totalResults: finalResults.length,
            timestamp: Date.now(),
            duration: Date.now() - startTime,
            sources: engineStats,
            cache: { hit: false, key: null },
            diagnostics: this.hasDiagnostics(diagnostics) ? diagnostics : undefined,
            multiSearch: true,
            rawTotal: deduped.length,
            scoreRange: finalResults.length > 0
                ? { min: finalResults[finalResults.length - 1]._relevanceScore, max: finalResults[0]._relevanceScore }
                : null
        };
        return response;
    }
}
exports.OrderedFallbackSearchService = OrderedFallbackSearchService;
