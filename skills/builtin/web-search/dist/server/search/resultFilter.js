"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.containsMaskedContent = containsMaskedContent;
exports.isValidSearchResult = isValidSearchResult;
exports.filterSearchResults = filterSearchResults;
const fs_1 = require("fs");
const path_1 = require("path");
const urlBlacklist_json_1 = __importDefault(require("./urlBlacklist.json"));
const fallbackMaskPattern = /(?:[*＊•●xX]){3,}/;
function readJsonFile(filePath) {
    if (!(0, fs_1.existsSync)(filePath)) {
        return null;
    }
    try {
        return JSON.parse((0, fs_1.readFileSync)(filePath, 'utf8'));
    }
    catch {
        return null;
    }
}
function readLocalBlacklist() {
    const candidates = [
        (0, path_1.resolve)(__dirname, '../../../server/search/urlBlacklist.json'),
        (0, path_1.resolve)(__dirname, 'urlBlacklist.json')
    ];
    for (const candidate of candidates) {
        const config = readJsonFile(candidate);
        if (config) {
            return config;
        }
    }
    return urlBlacklist_json_1.default;
}
function readRemoteConfig() {
    const configPath = process.env.WEB_SEARCH_REMOTE_CONFIG_PATH?.trim();
    if (!configPath) {
        return null;
    }
    return readJsonFile(configPath);
}
function normalizeDomain(domain) {
    return domain.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
}
function normalizeBlacklist(config) {
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
function getBlacklist(config) {
    const remoteConfig = readRemoteConfig();
    return normalizeBlacklist(config ?? remoteConfig?.urlBlacklist ?? readLocalBlacklist());
}
function buildMaskedContentPattern(config) {
    if (!config?.pattern) {
        return null;
    }
    try {
        return new RegExp(config.pattern, config.flags || '');
    }
    catch {
        return null;
    }
}
function getMaskedContentPattern() {
    return buildMaskedContentPattern(readRemoteConfig()?.maskedContentPattern) ?? fallbackMaskPattern;
}
function isBlockedDomain(hostname, domains) {
    const normalizedHost = normalizeDomain(hostname);
    return domains.some((domain) => normalizedHost === domain || normalizedHost.endsWith(`.${domain}`));
}
function isBlockedUrl(url, config) {
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        return true;
    }
    const blacklistConfig = getBlacklist(config);
    return isBlockedDomain(parsed.hostname, blacklistConfig.domains)
        || blacklistConfig.urlIncludes.some((item) => parsed.href.includes(item));
}
function isBlockedSearchText(result, config) {
    const blacklistConfig = getBlacklist(config);
    if (blacklistConfig.textIncludes.length === 0) {
        return false;
    }
    const text = [result.title, result.snippet].join('\n').toLowerCase();
    return blacklistConfig.textIncludes.some((item) => text.includes(item));
}
function containsMaskedContent(value) {
    return getMaskedContentPattern().test(value);
}
function isValidSearchResult(result, config) {
    if (isBlockedUrl(result.url, config)) {
        return false;
    }
    return !isBlockedSearchText(result, config)
        && !containsMaskedContent(result.title)
        && !containsMaskedContent(result.snippet);
}
function filterSearchResults(results, config) {
    const filteredResults = results.filter((result) => isValidSearchResult(result, config));
    return {
        results: filteredResults,
        filteredCount: results.length - filteredResults.length
    };
}
