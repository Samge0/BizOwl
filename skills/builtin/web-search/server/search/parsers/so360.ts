import { SearchEngine, SearchResult } from '../types';
import { parseUrl, ParserContext, pushResult, ResultAccumulator } from './shared';

export function parseSo360Results(context: ParserContext): SearchResult[] {
  const accumulator: ResultAccumulator = {
    results: [],
    seen: new Set<string>()
  };
  const root = context.document.querySelector('#main, #container, #results') || context.document.body;
  const items = Array.from(root.querySelectorAll(
    '.res-list, .result, .result-item, .so-result'
  ));

  for (const item of items) {
    const titleNode = item.querySelector(
      'h3 a, h2 a, .res-title a, a.result-title, a[data-mdurl], a[href]'
    );
    const anchor = titleNode?.closest('a') as HTMLAnchorElement | null;
    const rawUrl = item.getAttribute('data-url')
      || item.getAttribute('data-mdurl')
      || anchor?.getAttribute('data-url')
      || anchor?.getAttribute('data-mdurl')
      || anchor?.href
      || '';
    const snippetNode = item.querySelector(
      '.res-desc, .res-rich, .summary, .abstract, .content, p'
    );
    pushResult(
      accumulator,
      SearchEngine.So360,
      titleNode?.textContent || '',
      parseUrl(rawUrl, context.pageUrl),
      snippetNode?.textContent || item.textContent || '',
      context.maxResults
    );
  }

  return accumulator.results;
}
