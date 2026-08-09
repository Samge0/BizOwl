/**
 * Search result types
 */

export const SearchEngine = {
  Baidu: 'baidu',
  Bing: 'bing',
  So360: '360',
  Sogou: 'sogou',
  Google: 'google'
} as const;

export type SearchEngine = typeof SearchEngine[keyof typeof SearchEngine];

export const SearchEnginePreference = {
  Auto: 'auto',
  ...SearchEngine
} as const;

export type SearchEnginePreference =
  typeof SearchEnginePreference[keyof typeof SearchEnginePreference];

export const BrowserBackend = {
  Auto: 'auto',
  Playwright: 'playwright',
  Electron: 'electron'
} as const;

export type BrowserBackend = typeof BrowserBackend[keyof typeof BrowserBackend];

export interface SearchResult {
  /** Result title */
  title: string;
  /** Result URL */
  url: string;
  /** Text snippet/description */
  snippet: string;
  /** Source engine */
  source: SearchEngine;
  /** Position in results (1-based) */
  position: number;
}

export interface SearchResponse {
  /** Search query */
  query: string;
  /** Engine used for this response */
  engine: SearchEngine;
  /** Search results */
  results: SearchResult[];
  /** Total results found */
  totalResults: number;
  /** Search timestamp */
  timestamp: number;
  /** Time taken in milliseconds */
  duration: number;
  /** Optional source-level summary */
  sources?: Array<{
    engine: SearchEngine;
    success: boolean;
    results: number;
    cached?: boolean;
    error?: string;
  }>;
  /** Optional cache status */
  cache?: {
    hit: boolean;
    key?: string;
  };
  /** Optional diagnostics for development or API clients */
  diagnostics?: {
    skippedEngines?: string[];
    failedEngines?: string[];
    blockedEngines?: string[];
    filteredResults?: string[];
  };
}

export interface ContentResponse {
  url: string;
  title: string;
  byline?: string;
  excerpt?: string;
  textContent: string;
  textContentLength: number;
  textContentTruncated: boolean;
  textContentMaxChars: number;
  cached?: boolean;
  timestamp: number;
  duration: number;
}
