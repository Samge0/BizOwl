"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseSogouResults = parseSogouResults;
const types_1 = require("../types");
const shared_1 = require("./shared");
function parseSogouResults(context) {
    const accumulator = {
        results: [],
        seen: new Set()
    };
    const root = context.document.querySelector('#main, #content_left, .results, #results') || context.document.body;
    const items = Array.from(root.querySelectorAll('.vrwrap, .rb, .results > div, .result, .sogou-result'));
    for (const item of items) {
        const titleNode = item.querySelector('h3 a, h2 a, .vrTitle a, .pt a, .title a, a[href]');
        const anchor = titleNode?.closest('a');
        const rawUrl = item.getAttribute('data-url')
            || anchor?.getAttribute('data-url')
            || anchor?.getAttribute('data-href')
            || anchor?.href
            || '';
        const snippetNode = item.querySelector('.str_info, .ft, .text-layout, .summary, .abstract, p');
        (0, shared_1.pushResult)(accumulator, types_1.SearchEngine.Sogou, titleNode?.textContent || '', (0, shared_1.parseUrl)(rawUrl, context.pageUrl), snippetNode?.textContent || '', context.maxResults);
    }
    return accumulator.results;
}
