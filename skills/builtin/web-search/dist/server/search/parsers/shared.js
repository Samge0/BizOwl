"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canonicalizeUrl = canonicalizeUrl;
exports.parseUrl = parseUrl;
exports.pushResult = pushResult;
const types_1 = require("../types");
function canonicalizeUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        const trackingParams = [
            'utm_source',
            'utm_medium',
            'utm_campaign',
            'utm_term',
            'utm_content',
            'fbclid',
            'gclid',
            'yclid',
            'mc_cid',
            'mc_eid'
        ];
        for (const param of trackingParams) {
            parsed.searchParams.delete(param);
        }
        parsed.hash = '';
        return parsed.toString();
    }
    catch {
        return rawUrl;
    }
}
function parseUrl(rawUrl, baseUrl) {
    if (!rawUrl) {
        return '';
    }
    try {
        const parsed = new URL(rawUrl, baseUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return '';
        }
        if (parsed.hostname.includes('google.') && parsed.pathname === '/url') {
            return parsed.searchParams.get('q') || parsed.searchParams.get('url') || '';
        }
        if (parsed.hostname.includes('sogou.com') && parsed.pathname === '/link') {
            return parsed.searchParams.get('url') || parsed.href;
        }
        return parsed.href;
    }
    catch {
        return '';
    }
}
function pushResult(accumulator, engine, title, rawUrl, snippet, maxResults) {
    if (accumulator.results.length >= maxResults) {
        return;
    }
    const url = rawUrl.trim();
    const canonicalUrl = canonicalizeUrl(url);
    if (!title
        || !url
        || isInternalSearchUrl(url, engine)
        || accumulator.seen.has(canonicalUrl)
        || isNoisyResult(title, snippet, url)) {
        return;
    }
    accumulator.seen.add(canonicalUrl);
    accumulator.results.push({
        title: normalizeText(title),
        url,
        snippet: normalizeText(snippet),
        source: engine,
        position: accumulator.results.length + 1
    });
}
function normalizeText(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
}
function isInternalSearchUrl(url, engine) {
    if (!url) {
        return true;
    }
    try {
        const parsed = new URL(url);
        if (engine === types_1.SearchEngine.Baidu) {
            return parsed.hostname.includes('baidu.com')
                && (parsed.pathname === '/' || parsed.pathname === '/s' || parsed.pathname.startsWith('/safecheck'));
        }
        if (engine === types_1.SearchEngine.Google) {
            return parsed.hostname.includes('google.') && (parsed.pathname === '/search' || parsed.pathname === '/url');
        }
        if (engine === types_1.SearchEngine.Bing) {
            return parsed.hostname.includes('bing.com') && parsed.pathname === '/search';
        }
        if (engine === types_1.SearchEngine.So360) {
            return parsed.hostname.includes('so.com') && (parsed.pathname === '/' || parsed.pathname === '/s');
        }
        if (engine === types_1.SearchEngine.Sogou) {
            return parsed.hostname.includes('sogou.com')
                && (parsed.pathname === '/' || parsed.pathname === '/web' || parsed.pathname === '/link');
        }
    }
    catch {
        return true;
    }
    return false;
}
function isNoisyResult(title, snippet, url) {
    const text = `${title} ${snippet}`.toLowerCase();
    if (text.includes('广告') || text.includes('推广') || text.includes('ad ')) {
        return true;
    }
    try {
        const parsed = new URL(url);
        if (parsed.hostname.includes('union-click')
            || parsed.hostname.includes('recommend_list.baidu.com')
            || parsed.hostname === 'e.so.com'
            || parsed.hostname === 'www.so.com' && parsed.pathname === '/link'
            || parsed.hostname === 'www.sogou.com' && parsed.pathname === '/link'
            || parsed.searchParams.has('bd_vid')) {
            return true;
        }
    }
    catch {
        return true;
    }
    return false;
}
