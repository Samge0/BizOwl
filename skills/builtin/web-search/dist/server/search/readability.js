"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractReadableContent = extractReadableContent;
const readability_1 = require("@mozilla/readability");
const jsdom_1 = require("jsdom");
function extractReadableContent(url, html) {
    const dom = new jsdom_1.JSDOM(html, { url });
    const reader = new readability_1.Readability(dom.window.document);
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
