import { SearchEngine, SearchResult } from '../types';
import { parseUrl, ParserContext, pushResult, ResultAccumulator } from './shared';

export function parseSogouResults(context: ParserContext): SearchResult[] {
  const accumulator: ResultAccumulator = {
    results: [],
    seen: new Set<string>()
  };
  const root = context.document.querySelector('#main, #content_left, .results, #results') || context.document.body;
  const items = Array.from(root.querySelectorAll(
    '.vrwrap, .rb, .results > div, .result, .sogou-result'
  ));

  for (const item of items) {
    const titleNode = item.querySelector(
      'h3 a, h2 a, .vrTitle a, .pt a, .title a, a[href]'
    );
    const anchor = titleNode?.closest('a') as HTMLAnchorElement | null;
    const rawUrl = item.getAttribute('data-url')
      || anchor?.getAttribute('data-url')
      || anchor?.getAttribute('data-href')
      || anchor?.href
      || '';
    const snippetNode = item.querySelector(
      '.str_info, .ft, .text-layout, .summary, .abstract, p'
    );
    pushResult(
      accumulator,
      SearchEngine.Sogou,
      titleNode?.textContent || '',
      parseUrl(rawUrl, context.pageUrl),
      snippetNode?.textContent || '',
      context.maxResults
    );
  }

  return accumulator.results;
}
