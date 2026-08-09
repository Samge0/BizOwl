"use strict";
/**
 * Web Search Skill Configuration
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultConfig = void 0;
exports.resolveBrowserBackend = resolveBrowserBackend;
exports.shouldFallbackToElectronBackend = shouldFallbackToElectronBackend;
exports.mergeConfig = mergeConfig;
const types_1 = require("./search/types");
function parseBooleanEnv(name, fallback) {
    const value = process.env[name]?.trim().toLowerCase();
    if (!value) {
        return fallback;
    }
    return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}
function parseNumberEnv(name, fallback) {
    const value = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(value) ? value : fallback;
}
function parseBrowserBackendEnv(name, fallback) {
    const value = process.env[name]?.trim().toLowerCase();
    if (value === types_1.BrowserBackend.Auto
        || value === types_1.BrowserBackend.Playwright
        || value === types_1.BrowserBackend.Electron) {
        return value;
    }
    return fallback;
}
function resolveServerEnv() {
    const rawUrl = process.env.WEB_SEARCH_SERVER?.trim();
    if (!rawUrl) {
        return { host: '127.0.0.1', port: 37823 };
    }
    try {
        const parsed = new URL(rawUrl);
        return {
            host: parsed.hostname || '127.0.0.1',
            port: parsed.port ? Number.parseInt(parsed.port, 10) : 37823
        };
    }
    catch {
        return { host: '127.0.0.1', port: 37823 };
    }
}
function resolveBrowserBackend(backend, platform, electronBridgeConfigured) {
    if (backend === types_1.BrowserBackend.Electron || backend === types_1.BrowserBackend.Playwright) {
        return backend;
    }
    return platform === 'win32' && electronBridgeConfigured
        ? types_1.BrowserBackend.Electron
        : types_1.BrowserBackend.Playwright;
}
function shouldFallbackToElectronBackend(backend, platform, electronBridgeConfigured) {
    void backend;
    void platform;
    void electronBridgeConfigured;
    return false;
}
/**
 * Default configuration
 */
exports.defaultConfig = {
    browser: {
        cdpPort: parseNumberEnv('WEB_SEARCH_CDP_PORT', 9222),
        headless: parseBooleanEnv('WEB_SEARCH_BROWSER_HEADLESS', true),
        backend: parseBrowserBackendEnv('WEB_SEARCH_BROWSER_BACKEND', types_1.BrowserBackend.Auto),
        electronBrowserUrl: process.env.BIZOWL_ELECTRON_BROWSER_URL?.trim() || undefined,
        electronBrowserSecret: process.env.BIZOWL_BRIDGE_SECRET?.trim() || undefined,
        chromeFlags: [
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding'
        ]
    },
    server: {
        ...resolveServerEnv()
    },
    search: {
        defaultEngine: types_1.SearchEnginePreference.Auto,
        fallbackOrder: [
            types_1.SearchEngine.So360,
            types_1.SearchEngine.Bing,
            types_1.SearchEngine.Baidu,
            types_1.SearchEngine.Sogou,
            types_1.SearchEngine.Google
        ],
        defaultMaxResults: 20,
        searchTimeout: 30000, // 30 seconds
        navigationTimeout: 15000, // 15 seconds
        cacheTtlMs: parseNumberEnv('WEB_SEARCH_CACHE_TTL_MS', 15 * 60 * 1000),
        contentCacheTtlMs: parseNumberEnv('WEB_SEARCH_CONTENT_CACHE_TTL_MS', 24 * 60 * 60 * 1000),
        contentMaxChars: parseNumberEnv('WEB_SEARCH_CONTENT_MAX_CHARS', 8000),
        maxConcurrency: parseNumberEnv('WEB_SEARCH_MAX_CONCURRENCY', 2)
    }
};
/**
 * Merge user config with defaults
 */
function mergeConfig(userConfig) {
    if (!userConfig) {
        return exports.defaultConfig;
    }
    return {
        browser: { ...exports.defaultConfig.browser, ...userConfig.browser },
        server: { ...exports.defaultConfig.server, ...userConfig.server },
        search: { ...exports.defaultConfig.search, ...userConfig.search }
    };
}
