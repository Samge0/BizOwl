/**
 * Web Search Skill Configuration
 */

import { BrowserBackend, SearchEngine, SearchEnginePreference } from './search/types';

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return fallback;
  }

  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function parseNumberEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) ? value : fallback;
}

function parseBrowserBackendEnv(name: string, fallback: BrowserBackend): BrowserBackend {
  const value = process.env[name]?.trim().toLowerCase();
  if (
    value === BrowserBackend.Auto
    || value === BrowserBackend.Playwright
    || value === BrowserBackend.Electron
  ) {
    return value;
  }
  return fallback;
}

function resolveServerEnv(): Pick<ServerConfig, 'host' | 'port'> {
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

export interface BrowserConfig {
  /** Chrome executable path (auto-detected if not provided) */
  chromePath?: string;
  /** CDP debugging port */
  cdpPort: number;
  /** User data directory for browser isolation */
  userDataDir?: string;
  /** Whether to run browser headless */
  headless: boolean;
  /** Additional Chrome flags */
  chromeFlags?: string[];
  /** Browser backend for rendering pages */
  backend: BrowserBackend;
  /** BizOwl Electron browser bridge endpoint */
  electronBrowserUrl?: string;
  /** Secret for the BizOwl local bridge */
  electronBrowserSecret?: string;
}

export interface ServerConfig {
  /** Bridge server port */
  port: number;
  /** Bridge server host */
  host: string;
}

export interface SearchConfig {
  /** Default search engine */
  defaultEngine: SearchEnginePreference;
  /** Engine fallback order when defaultEngine is auto */
  fallbackOrder: SearchEngine[];
  /** Default max results per search */
  defaultMaxResults: number;
  /** Search timeout in milliseconds */
  searchTimeout: number;
  /** Navigation timeout in milliseconds */
  navigationTimeout: number;
  /** Search cache TTL in milliseconds */
  cacheTtlMs: number;
  /** Content cache TTL in milliseconds */
  contentCacheTtlMs: number;
  /** Maximum returned content text length in characters; <= 0 disables truncation */
  contentMaxChars: number;
  /** Maximum concurrent source crawls */
  maxConcurrency: number;
}

export interface Config {
  browser: BrowserConfig;
  server: ServerConfig;
  search: SearchConfig;
}

export function resolveBrowserBackend(
  backend: BrowserBackend,
  platform: NodeJS.Platform,
  electronBridgeConfigured: boolean
): BrowserBackend {
  if (backend === BrowserBackend.Electron || backend === BrowserBackend.Playwright) {
    return backend;
  }
  return platform === 'win32' && electronBridgeConfigured
    ? BrowserBackend.Electron
    : BrowserBackend.Playwright;
}

export function shouldFallbackToElectronBackend(
  backend: BrowserBackend,
  platform: NodeJS.Platform,
  electronBridgeConfigured: boolean
): boolean {
  void backend;
  void platform;
  void electronBridgeConfigured;
  return false;
}

/**
 * Default configuration
 */
export const defaultConfig: Config = {
  browser: {
    cdpPort: parseNumberEnv('WEB_SEARCH_CDP_PORT', 9222),
    headless: parseBooleanEnv('WEB_SEARCH_BROWSER_HEADLESS', true),
    backend: parseBrowserBackendEnv('WEB_SEARCH_BROWSER_BACKEND', BrowserBackend.Auto),
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
    defaultEngine: SearchEnginePreference.Auto,
    fallbackOrder: [
      SearchEngine.So360,
      SearchEngine.Bing,
      SearchEngine.Baidu,
      SearchEngine.Sogou,
      SearchEngine.Google
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
export function mergeConfig(userConfig?: Partial<Config>): Config {
  if (!userConfig) {
    return defaultConfig;
  }

  return {
    browser: { ...defaultConfig.browser, ...userConfig.browser },
    server: { ...defaultConfig.server, ...userConfig.server },
    search: { ...defaultConfig.search, ...userConfig.search }
  };
}
