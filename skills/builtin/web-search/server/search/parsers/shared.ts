import { SearchEngine, SearchResult } from '../types';

export interface ParserContext {
  document: Document;
  pageUrl: string;
  maxResults: number;
}

export interface ResultAccumulator {
  results: SearchResult[];
  seen: Set<string>;
}

export function canonicalizeUrl(rawUrl: string): string {
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
  } catch {
    return rawUrl;
  }
}

export function parseUrl(rawUrl: string, baseUrl: string): string {
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
  } catch {
    return '';
  }
}

export function pushResult(
  accumulator: ResultAccumulator,
  engine: SearchEngine,
  title: string,
  rawUrl: string,
  snippet: string,
  maxResults: number
): void {
  if (accumulator.results.length >= maxResults) {
    return;
  }

  const url = rawUrl.trim();
  const canonicalUrl = canonicalizeUrl(url);
  if (
    !title
    || !url
    || isInternalSearchUrl(url, engine)
    || accumulator.seen.has(canonicalUrl)
    || isNoisyResult(title, snippet, url)
  ) {
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

function normalizeText(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function isInternalSearchUrl(url: string, engine: SearchEngine): boolean {
  if (!url) {
    return true;
  }

  try {
    const parsed = new URL(url);
    if (engine === SearchEngine.Baidu) {
      return parsed.hostname.includes('baidu.com')
        && (parsed.pathname === '/' || parsed.pathname === '/s' || parsed.pathname.startsWith('/safecheck'));
    }
    if (engine === SearchEngine.Google) {
      return parsed.hostname.includes('google.') && (parsed.pathname === '/search' || parsed.pathname === '/url');
    }
    if (engine === SearchEngine.Bing) {
      return parsed.hostname.includes('bing.com') && parsed.pathname === '/search';
    }
    if (engine === SearchEngine.So360) {
      return parsed.hostname.includes('so.com') && (parsed.pathname === '/' || parsed.pathname === '/s');
    }
    if (engine === SearchEngine.Sogou) {
      return parsed.hostname.includes('sogou.com')
        && (parsed.pathname === '/' || parsed.pathname === '/web' || parsed.pathname === '/link');
    }
  } catch {
    return true;
  }

  return false;
}

function isNoisyResult(title: string, snippet: string, url: string): boolean {
  const text = `${title} ${snippet}`.toLowerCase();
  if (text.includes('广告') || text.includes('推广') || text.includes('ad ')) {
    return true;
  }

  try {
    const parsed = new URL(url);
    if (
      parsed.hostname.includes('union-click')
      || parsed.hostname.includes('recommend_list.baidu.com')
      || parsed.hostname === 'e.so.com'
      || parsed.hostname === 'www.so.com' && parsed.pathname === '/link'
      || parsed.hostname === 'www.sogou.com' && parsed.pathname === '/link'
      || parsed.searchParams.has('bd_vid')
    ) {
      return true;
    }
  } catch {
    return true;
  }

  return false;
}
