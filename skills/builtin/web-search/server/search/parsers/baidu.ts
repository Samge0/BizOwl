import { SearchEngine, SearchResult } from '../types';
import { parseUrl, ParserContext, pushResult, ResultAccumulator } from './shared';

/**
 * 检测百度安全验证页面（headless 浏览器被拦截时常见）
 */
function isCaptchaPage(document: Document): boolean {
  const title = document.title || '';
  const bodyText = document.body?.textContent || '';
  return title.includes('百度安全验证')
    || bodyText.includes('百度安全验证')
    || bodyText.includes('请完成下方验证后继续操作');
}

export function parseBaiduResults(context: ParserContext): SearchResult[] {
  const accumulator: ResultAccumulator = {
    results: [],
    seen: new Set<string>()
  };

  // 检测验证码拦截 → 抛出明确异常，让 fallback 链跳到下一个引擎
  if (isCaptchaPage(context.document)) {
    throw new Error('baidu blocked by captcha (安全验证)');
  }

  const root = context.document.querySelector('#content_left') || context.document.body;
  // 兼容多版百度 DOM：旧版 .result/.c-container + 新版 div[tpl] + 通用 #content_left > div
  const items = Array.from(root.querySelectorAll(
    '.result, .c-container, [tpl], [srcid], #content_left > div[class]'
  )).filter(el => {
    // 过滤掉广告、推荐等非搜索结果
    const cls = el.className || '';
    const id = el.id || '';
    return !id.startsWith('content_top') // 顶部推荐
      && !cls.includes('result-op')      // 百度运营位
      || el.querySelector('h3 a');       // 有标题链接的保留
  });

  for (const item of items) {
    const titleNode = item.querySelector('h3 a, .c-title a, .t a, a[href]');
    const anchor = titleNode?.closest('a') as HTMLAnchorElement | null;
    const rawUrl = item.getAttribute('mu')
      || item.getAttribute('data-url')
      || anchor?.getAttribute('data-url')
      || anchor?.getAttribute('data-landurl')
      || anchor?.href
      || '';
    // 兼容多版 snippet 选择器
    const snippetNode = item.querySelector(
      '.c-abstract, .c-span-last, .result-summary, .c-color-text, [class*="abstract"], [class*="text"]'
    );
    pushResult(
      accumulator,
      SearchEngine.Baidu,
      titleNode?.textContent || '',
      parseUrl(rawUrl, context.pageUrl),
      snippetNode?.textContent || item.textContent || '',
      context.maxResults
    );
  }

  return accumulator.results;
}
