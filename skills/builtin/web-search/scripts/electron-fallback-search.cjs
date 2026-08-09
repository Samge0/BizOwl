#!/usr/bin/env node

const fs = require('fs');

const { SearchEngine, SearchEnginePreference } = require('../dist/server/search/types');

const ElectronBrowserAction = {
  CreatePage: 'createPage',
  ClosePage: 'closePage',
  Navigate: 'navigate',
  GetContent: 'getContent',
};

function usage() {
  console.error('Usage: node scripts/electron-fallback-search.cjs [--json] <query|@utf8-file> [max_results]');
  process.exit(1);
}

function readUtf8QueryFile(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').trim();
}

function parseArgs(argv) {
  const args = [...argv];
  let outputFormat = 'markdown';
  if (args[0] === '--json') {
    outputFormat = 'json';
    args.shift();
  }
  if (args.length < 1) {
    usage();
  }
  const queryArg = args[0];
  return {
    outputFormat,
    query: queryArg.startsWith('@') ? readUtf8QueryFile(queryArg.slice(1)) : queryArg,
    maxResults: Number.isFinite(Number.parseInt(args[1] || '', 10))
      ? Number.parseInt(args[1], 10)
      : 10,
  };
}

function isElectronBridgeConfigured(env = process.env) {
  return Boolean(env.BIZOWL_ELECTRON_BROWSER_URL && env.BIZOWL_BRIDGE_SECRET);
}

function isPlaywrightLaunchError(message) {
  const text = String(message || '');
  return /Failed to launch browser/i.test(text)
    || /CDP port not ready/i.test(text)
    || /browserContext\.newPage/.test(text)
    || /Target page, context or browser has been closed/.test(text)
    || /Failed to connect to CDP/.test(text)
    || /Chrome executable/i.test(text)
    || /Executable does(?:n't| not) exist/i.test(text);
}

function normalizeEngine(engine) {
  const normalized = String(engine || '').trim().toLowerCase();
  const values = new Set(Object.values(SearchEngine));
  return values.has(normalized) ? normalized : null;
}

function resolveEngines(preferredEngine = SearchEnginePreference.Auto, fallbackOrderRaw = '') {
  const explicit = normalizeEngine(preferredEngine);
  if (explicit) {
    return [explicit];
  }

  const configured = String(fallbackOrderRaw || '')
    .split(',')
    .map(item => normalizeEngine(item))
    .filter(Boolean);
  return Array.from(new Set([
    ...configured,
    SearchEngine.Baidu,
    SearchEngine.Bing,
    SearchEngine.So360,
    SearchEngine.Sogou,
    SearchEngine.Google,
  ]));
}

function buildSearchUrl(engine, query) {
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
  return `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
}

async function electronRequest(input, env = process.env) {
  const response = await fetch(env.BIZOWL_ELECTRON_BROWSER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bridge-secret': env.BIZOWL_BRIDGE_SECRET,
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(45000),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(text || `Electron browser bridge returned HTTP ${response.status}`);
  }
  if (!response.ok || !parsed.success) {
    throw new Error(parsed.error || `Electron browser bridge returned HTTP ${response.status}`);
  }
  return parsed;
}

async function renderWithElectron(url) {
  let pageId = '';
  try {
    const created = await electronRequest({ action: ElectronBrowserAction.CreatePage });
    pageId = created.pageId || '';
    if (!pageId) {
      throw new Error('Electron browser bridge did not return a pageId');
    }
    const nav = await electronRequest({
      action: ElectronBrowserAction.Navigate,
      pageId,
      url,
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    const content = await electronRequest({
      action: ElectronBrowserAction.GetContent,
      pageId,
    });
    return {
      url: content.url || nav.url || url,
      html: content.content || '',
    };
  } finally {
    if (pageId) {
      await electronRequest({ action: ElectronBrowserAction.ClosePage, pageId }).catch(() => undefined);
    }
  }
}

async function searchWithElectron(query, maxResults, env = process.env) {
  if (!isElectronBridgeConfigured(env)) {
    throw new Error('Electron browser bridge fallback is not configured');
  }
  const { parseSearchResults } = require('../dist/server/search/parsers');
  const { filterSearchResults } = require('../dist/server/search/resultFilter');
  const startTime = Date.now();
  const engines = resolveEngines(env.WEB_SEARCH_ENGINE || SearchEnginePreference.Auto, env.WEB_SEARCH_FALLBACK_ORDER || '');
  const sources = [];
  const diagnostics = { failedEngines: [] };

  for (const engine of engines) {
    const url = buildSearchUrl(engine, query);
    try {
      const rendered = await renderWithElectron(url);
      const parsedResults = parseSearchResults(engine, rendered.html, rendered.url, maxResults);
      if (parsedResults.length === 0) {
        throw new Error(`${engine} returned no parsable results`);
      }
      const filtered = filterSearchResults(parsedResults);
      sources.push({
        engine,
        success: filtered.results.length > 0,
        results: filtered.results.length,
        ...(filtered.results.length === 0 ? { error: 'all results were filtered' } : {}),
      });
      if (filtered.filteredCount > 0) {
        diagnostics.filteredResults = [
          ...(diagnostics.filteredResults || []),
          `${engine}: ${filtered.filteredCount}`,
        ];
      }
      if (filtered.results.length === 0) {
        continue;
      }
      const results = filtered.results.slice(0, maxResults).map((result, index) => ({
        ...result,
        position: index + 1,
      }));
      return {
        query,
        engine,
        results,
        totalResults: results.length,
        timestamp: Date.now(),
        duration: Date.now() - startTime,
        sources,
        diagnostics: diagnostics.failedEngines.length || diagnostics.filteredResults?.length
          ? diagnostics
          : undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sources.push({ engine, success: false, results: 0, error: message });
      diagnostics.failedEngines = [...diagnostics.failedEngines, `${engine}: ${message}`];
    }
  }

  throw new Error(`Electron browser bridge fallback failed. ${diagnostics.failedEngines.join(' | ')}`);
}

function formatMarkdown(data, query) {
  const lines = [
    `# Search Results: ${query}`,
    '',
    `**Query:** ${query}  `,
    `**Engine:** ${data.engine || 'unknown'}  `,
    `**Results:** ${data.totalResults || 0}  `,
    `**Time:** ${data.duration || 0}ms  `,
    '',
    '---',
    '',
  ];
  for (const result of data.results || []) {
    lines.push(`## ${result.title || ''}`, '', `**URL:** [${result.url || ''}](${result.url || ''})`, '', result.snippet || '', '', '---', '');
  }
  return lines.join('\n');
}

async function main() {
  const { outputFormat, query, maxResults } = parseArgs(process.argv.slice(2));
  const data = await searchWithElectron(query, maxResults);
  if (outputFormat === 'json') {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return;
  }
  process.stderr.write(`Found ${data.totalResults} results in ${data.duration}ms (engine: ${data.engine}, backend: electron-bridge)\n\n`);
  process.stdout.write(formatMarkdown(data, query));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Electron fallback search failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

module.exports = {
  buildSearchUrl,
  isElectronBridgeConfigured,
  isPlaywrightLaunchError,
  resolveEngines,
  searchWithElectron,
};
