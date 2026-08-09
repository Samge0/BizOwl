import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

export interface ReadableContent {
  title: string;
  byline?: string;
  excerpt?: string;
  textContent: string;
}

export function extractReadableContent(url: string, html: string): ReadableContent {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (article?.textContent?.trim()) {
    return {
      title: article.title || dom.window.document.title || url,
      byline: article.byline || undefined,
      excerpt: article.excerpt || undefined,
      textContent: article.textContent.trim()
    };
  }

  return {
    title: dom.window.document.title || url,
    textContent: (dom.window.document.body?.textContent || '').replace(/\s+/g, ' ').trim()
  };
}
