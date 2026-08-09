import { JSDOM } from 'jsdom';
import { SearchEngine, SearchResult } from '../types';
import { parseBaiduResults } from './baidu';
import { parseBingResults } from './bing';
import { parseGoogleResults } from './google';
import { parseSo360Results } from './so360';
import { parseSogouResults } from './sogou';

export { canonicalizeUrl } from './shared';

export function parseSearchResults(
  engine: SearchEngine,
  html: string,
  pageUrl: string,
  maxResults: number
): SearchResult[] {
  const dom = new JSDOM(html, { url: pageUrl });
  const context = {
    document: dom.window.document,
    pageUrl,
    maxResults
  };

  if (engine === SearchEngine.Bing) {
    return parseBingResults(context);
  }
  if (engine === SearchEngine.Google) {
    return parseGoogleResults(context);
  }
  if (engine === SearchEngine.Baidu) {
    return parseBaiduResults(context);
  }
  if (engine === SearchEngine.So360) {
    return parseSo360Results(context);
  }
  if (engine === SearchEngine.Sogou) {
    return parseSogouResults(context);
  }

  return [];
}
