import { SearchEngine, SearchResult } from '../types';
import { parseUrl, ParserContext, pushResult, ResultAccumulator } from './shared';

export function parseGoogleResults(context: ParserContext): SearchResult[] {
  const accumulator: ResultAccumulator = {
    results: [],
    seen: new Set<string>()
  };
  const items = Array.from(context.document.querySelectorAll('div#search div.g'));

  for (const item of items) {
    const titleNode = item.querySelector('h3');
    const anchor = titleNode?.closest('a') as HTMLAnchorElement | null;
    const snippetNode = item.querySelector('.VwiC3b, .yXK7lf, span.aCOpRe, div.IsZvec');
    pushResult(
      accumulator,
      SearchEngine.Google,
      titleNode?.textContent || anchor?.textContent || '',
      parseUrl(anchor?.href || '', context.pageUrl),
      snippetNode?.textContent || '',
      context.maxResults
    );
  }

  return accumulator.results;
}
