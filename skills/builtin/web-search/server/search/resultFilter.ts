import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import bundledBlacklist from './urlBlacklist.json';
import { SearchResult } from './types';

export interface UrlBlacklist {
  domains?: string[];
  urlIncludes?: string[];
  textIncludes?: string[];
}

export interface MaskedContentPatternConfig {
  pattern: string;
  flags?: string;
}

export interface WebSkillRemoteConfig {
  urlBlacklist?: UrlBlacklist;
  maskedContentPattern?: MaskedContentPatternConfig;
}

export interface FilterSearchResultsResult {
  results: SearchResult[];
  filteredCount: number;
}

const fallbackMaskPattern = /(?:[*＊•●xX]){3,}/;

function readJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function readLocalBlacklist(): UrlBlacklist {
  const candidates = [
    resolve(__dirname, '../../../server/search/urlBlacklist.json'),
    resolve(__dirname, 'urlBlacklist.json')
  ];

  for (const candidate of candidates) {
    const config = readJsonFile<UrlBlacklist>(candidate);
    if (config) {
      return config;
    }
  }

  return bundledBlacklist;
}

function readRemoteConfig(): WebSkillRemoteConfig | null {
  const configPath = process.env.WEB_SEARCH_REMOTE_CONFIG_PATH?.trim();
  if (!configPath) {
    return null;
  }
  return readJsonFile<WebSkillRemoteConfig>(configPath);
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
}

function normalizeBlacklist(config: UrlBlacklist): Required<UrlBlacklist> {
  return {
    domains: Array.isArray(config.domains)
      ? config.domains.map(normalizeDomain).filter(Boolean)
      : [],
    urlIncludes: Array.isArray(config.urlIncludes)
      ? config.urlIncludes.map((item) => item.trim()).filter(Boolean)
      : [],
    textIncludes: Array.isArray(config.textIncludes)
      ? config.textIncludes.map((item) => item.trim().toLowerCase()).filter(Boolean)
      : []
  };
}

function getBlacklist(config?: UrlBlacklist): Required<UrlBlacklist> {
  const remoteConfig = readRemoteConfig();
  return normalizeBlacklist(config ?? remoteConfig?.urlBlacklist ?? readLocalBlacklist());
}

function buildMaskedContentPattern(config?: MaskedContentPatternConfig): RegExp | null {
  if (!config?.pattern) {
    return null;
  }

  try {
    return new RegExp(config.pattern, config.flags || '');
  } catch {
    return null;
  }
}

function getMaskedContentPattern(): RegExp {
  return buildMaskedContentPattern(readRemoteConfig()?.maskedContentPattern) ?? fallbackMaskPattern;
}

function isBlockedDomain(hostname: string, domains: string[]): boolean {
  const normalizedHost = normalizeDomain(hostname);
  return domains.some((domain) =>
    normalizedHost === domain || normalizedHost.endsWith(`.${domain}`)
  );
}

function isBlockedUrl(url: string, config?: UrlBlacklist): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }

  const blacklistConfig = getBlacklist(config);
  return isBlockedDomain(parsed.hostname, blacklistConfig.domains)
    || blacklistConfig.urlIncludes.some((item) => parsed.href.includes(item));
}

function isBlockedSearchText(result: SearchResult, config?: UrlBlacklist): boolean {
  const blacklistConfig = getBlacklist(config);
  if (blacklistConfig.textIncludes.length === 0) {
    return false;
  }

  const text = [result.title, result.snippet].join('\n').toLowerCase();
  return blacklistConfig.textIncludes.some((item) => text.includes(item));
}

export function containsMaskedContent(value: string): boolean {
  return getMaskedContentPattern().test(value);
}

export function isValidSearchResult(result: SearchResult, config?: UrlBlacklist): boolean {
  if (isBlockedUrl(result.url, config)) {
    return false;
  }

  return !isBlockedSearchText(result, config)
    && !containsMaskedContent(result.title)
    && !containsMaskedContent(result.snippet);
}

export function filterSearchResults(
  results: SearchResult[],
  config?: UrlBlacklist
): FilterSearchResultsResult {
  const filteredResults = results.filter((result) => isValidSearchResult(result, config));
  return {
    results: filteredResults,
    filteredCount: results.length - filteredResults.length
  };
}
