"use strict";
/**
 * 外部搜索源适配器
 *
 * 统一接口：search(query, maxResults) → SearchResult[]
 * 支持的源：
 *   - Tavily (tavily.com) — AI优化搜索，返回提取内容+相关性分
 *   - Serper.dev — Google搜索结果API，结构化JSON
 *   - SearXNG — 自建元搜索，用户填地址
 *
 * 每个适配器：
 *   - apiKey / endpoint 从 ~/.BizOwl/store.json 读取
 *   - 失败时返回空数组（不阻断主搜索链）
 *   - 统一输出 { title, url, snippet, source, _relevanceScore? }
 */

Object.defineProperty(exports, "__esModule", { value: true });
exports.searchTavily = searchTavily;
exports.searchSerper = searchSerper;
exports.searchSearXNG = searchSearXNG;
exports.getEnabledExternalSources = getEnabledExternalSources;
exports.searchAllExternal = searchAllExternal;

const fs = require("fs");
const path = require("path");
const os = require("os");

const STORE_FILE = path.join(os.homedir(), '.BizOwl', 'store.json');

// ─── 配置读取 ───

/**
 * 从 store.json 读取外部搜索源配置
 * @returns {{ tavily?: {apiKey, enabled}, serper?: {apiKey, enabled}, searxng?: {url, enabled} }}
 */
function readExternalSearchConfig() {
    try {
        if (!fs.existsSync(STORE_FILE)) return {};
        const raw = fs.readFileSync(STORE_FILE, 'utf8');
        const data = JSON.parse(raw);
        return {
            tavily: data.tavily || null,
            serper: data.serper || null,
            searxng: data.searxng || null,
        };
    } catch {
        return {};
    }
}

// ─── Tavily ───

/**
 * Tavily AI 搜索
 * 端点: POST https://api.tavily.com/search
 * 特点: 返回提取的内容文本 + 自带 relevance_score
 * 免费额度: 1000 次/月
 *
 * @param {string} query
 * @param {number} maxResults
 * @param {string} apiKey
 * @returns {Promise<Array>}
 */
async function searchTavily(query, maxResults, apiKey) {
    if (!apiKey) return [];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
        const resp = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: apiKey,
                query,
                max_results: maxResults,
                search_depth: 'advanced', // 深度搜索，返回更多内容
                include_answer: false,    // 不需要 answer 字段，我们自己组织
            }),
            signal: controller.signal,
        });

        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            console.warn(`[Tavily] HTTP ${resp.status}: ${text.slice(0, 200)}`);
            return [];
        }

        const data = await resp.json();
        const results = Array.isArray(data.results) ? data.results : [];

        return results.map((r, i) => ({
            title: r.title || '',
            url: r.url || '',
            snippet: r.content || r.snippet || '',  // Tavily 返回的是提取的正文
            source: 'tavily',
            position: i + 1,
            // Tavily 自带相关性分 (0-1)，映射到 0-100
            _relevanceScore: typeof r.score === 'number'
                ? Math.round(r.score * 100)
                : undefined,
        }));
    } catch (e) {
        if (e.name === 'AbortError') {
            console.warn('[Tavily] 请求超时');
        } else {
            console.warn('[Tavily] 搜索失败:', e.message);
        }
        return [];
    } finally {
        clearTimeout(timeout);
    }
}

// ─── Serper.dev ───

/**
 * Serper.dev — Google 搜索结果 API
 * 端点: POST https://google.serper.dev/search
 * 特点: 返回 Google 搜索结果的结构化 JSON（organic 结果）
 * 免费额度: 2500 次一次性
 *
 * @param {string} query
 * @param {number} maxResults
 * @param {string} apiKey
 * @returns {Promise<Array>}
 */
async function searchSerper(query, maxResults, apiKey) {
    if (!apiKey) return [];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const resp = await fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-KEY': apiKey,
            },
            body: JSON.stringify({
                q: query,
                num: maxResults,
                gl: 'cn',    // 地区中国
                hl: 'zh-cn', // 中文
            }),
            signal: controller.signal,
        });

        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            console.warn(`[Serper] HTTP ${resp.status}: ${text.slice(0, 200)}`);
            return [];
        }

        const data = await resp.json();
        // Serper 返回 organic / knowledgeGraph / news 等，我们取 organic
        const organic = Array.isArray(data.organic) ? data.organic : [];

        return organic.slice(0, maxResults).map((r, i) => ({
            title: r.title || '',
            url: r.link || r.url || '',
            snippet: r.snippet || '',
            source: 'serper',
            position: i + 1,
            // Serper 的 position 字段就是 Google 排名
            _relevanceScore: typeof r.position === 'number'
                ? Math.max(10, 100 - r.position * 5)
                : undefined,
        }));
    } catch (e) {
        if (e.name === 'AbortError') {
            console.warn('[Serper] 请求超时');
        } else {
            console.warn('[Serper] 搜索失败:', e.message);
        }
        return [];
    } finally {
        clearTimeout(timeout);
    }
}

// ─── SearXNG ───

/**
 * SearXNG — 自建元搜索引擎
 * 用户在设置页填写自己的 SearXNG 实例地址
 * 端点: GET <user-url>/search?q=...&format=json
 * 特点: 聚合 Google/Bing/DuckDuckGo/Yandex 等多引擎，完全自建
 *
 * @param {string} query
 * @param {number} maxResults
 * @param {string} baseUrl — 用户自建的 SearXNG 地址 (如 http://localhost:8080)
 * @returns {Promise<Array>}
 */
async function searchSearXNG(query, maxResults, baseUrl) {
    if (!baseUrl) return [];

    // 规范化 URL
    let url = baseUrl.trim().replace(/\/+$/, ''); // 去掉尾部斜杠
    // 确保 scheme 存在
    if (!/^https?:\/\//.test(url)) {
        url = 'http://' + url;
    }

    const searchUrl = `${url}/search?q=${encodeURIComponent(query)}&format=json&pageno=1`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
        const resp = await fetch(searchUrl, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                // SearXNG 实例可能检测 UA
                'User-Agent': 'BizOwl/1.0 (Desktop AI Assistant)',
            },
            signal: controller.signal,
        });

        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            console.warn(`[SearXNG] HTTP ${resp.status}: ${text.slice(0, 200)}`);
            return [];
        }

        // SearXNG 可能返回 JSON 或 HTML（取决于实例配置 format=json 是否启用）
        const contentType = resp.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            console.warn('[SearXNG] 实例未启用 JSON 输出格式（需在 settings.yml 中开启 search.formats: [json]）');
            return [];
        }

        const data = await resp.json();
        const results = Array.isArray(data.results) ? data.results : [];

        return results.slice(0, maxResults).map((r, i) => ({
            title: r.title || '',
            url: r.url || '',
            snippet: r.content || '',
            source: 'searxng',
            position: i + 1,
            // SearXNG 不提供相关性分，用引擎数量做代理（被越多引擎返回 = 更相关）
            _relevanceScore: typeof r.engines === 'object'
                ? Math.min(90, 40 + (Array.isArray(r.engines) ? r.engines.length : Object.keys(r.engines).length) * 10)
                : undefined,
        }));
    } catch (e) {
        if (e.name === 'AbortError') {
            console.warn('[SearXNG] 请求超时');
        } else {
            console.warn('[SearXNG] 搜索失败:', e.message);
        }
        return [];
    } finally {
        clearTimeout(timeout);
    }
}

// ─── 聚合调度 ───

/**
 * 获取所有已启用的外部搜索源配置
 * @returns {{ tavily?: string, serper?: string, searxng?: string }}
 * 返回值是 { source: credential } 形式
 */
function getEnabledExternalSources() {
    const config = readExternalSearchConfig();
    const enabled = {};

    if (config.tavily?.enabled && config.tavily.apiKey?.trim()) {
        enabled.tavily = config.tavily.apiKey.trim();
    }
    if (config.serper?.enabled && config.serper.apiKey?.trim()) {
        enabled.serper = config.serper.apiKey.trim();
    }
    if (config.searxng?.enabled && config.searxng.url?.trim()) {
        enabled.searxng = config.searxng.url.trim();
    }

    return enabled;
}

/**
 * 并行调用所有已启用的外部搜索源，合并结果
 *
 * @param {string} query
 * @param {number} maxResults
 * @returns {Promise<{ results: Array, sources: Array }>}
 */
async function searchAllExternal(query, maxResults) {
    const enabled = getEnabledExternalSources();
    const tasks = [];

    if (enabled.tavily) {
        tasks.push({ name: 'tavily', fn: () => searchTavily(query, maxResults, enabled.tavily) });
    }
    if (enabled.serper) {
        tasks.push({ name: 'serper', fn: () => searchSerper(query, maxResults, enabled.serper) });
    }
    if (enabled.searxng) {
        tasks.push({ name: 'searxng', fn: () => searchSearXNG(query, maxResults, enabled.searxng) });
    }

    if (tasks.length === 0) {
        return { results: [], sources: [] };
    }

    const promises = tasks.map(async (t) => {
        const startTime = Date.now();
        try {
            const results = await t.fn();
            return { name: t.name, results, success: true, duration: Date.now() - startTime };
        } catch (e) {
            return { name: t.name, results: [], success: false, duration: Date.now() - startTime, error: e.message };
        }
    });

    const settled = await Promise.allSettled(promises);
    const allResults = [];
    const sourceStats = [];

    for (const sr of settled) {
        if (sr.status === 'fulfilled') {
            allResults.push(...sr.value.results);
            sourceStats.push({
                engine: sr.value.name,
                resultCount: sr.value.results.length,
                success: sr.value.success,
                ...(sr.value.error ? { error: sr.value.error } : {}),
            });
        }
    }

    return { results: allResults, sources: sourceStats };
}
