import { SearchEngine, SearchResult } from '../types';
import { parseUrl, ParserContext, pushResult, ResultAccumulator } from './shared';

export function parseBingResults(context: ParserContext): SearchResult[] {
  const accumulator: ResultAccumulator = {
    results: [],
    seen: new Set<string>()
  };

  for (const item of Array.from(context.document.querySelectorAll('li.b_algo'))) {
    const titleNode = item.querySelector('h2 a');
    const anchor = titleNode as HTMLAnchorElement | null;
    const snippetNode = item.querySelector('.b_caption p, .b_caption');
    pushResult(
      accumulator,
      SearchEngine.Bing,
      titleNode?.textContent || '',
      parseUrl(anchor?.href || '', context.pageUrl),
      snippetNode?.textContent || '',
      context.maxResults
    );
  }

  return accumulator.results;
}
