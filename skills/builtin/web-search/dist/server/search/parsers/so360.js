"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseSo360Results = parseSo360Results;
const types_1 = require("../types");
const shared_1 = require("./shared");
function parseSo360Results(context) {
    const accumulator = {
        results: [],
        seen: new Set()
    };
    const root = context.document.querySelector('#main, #container, #results') || context.document.body;
    const items = Array.from(root.querySelectorAll('.res-list, .result, .result-item, .so-result'));
    for (const item of items) {
        const titleNode = item.querySelector('h3 a, h2 a, .res-title a, a.result-title, a[data-mdurl], a[href]');
        const anchor = titleNode?.closest('a');
        const rawUrl = item.getAttribute('data-url')
            || item.getAttribute('data-mdurl')
            || anchor?.getAttribute('data-url')
            || anchor?.getAttribute('data-mdurl')
            || anchor?.href
            || '';
        const snippetNode = item.querySelector('.res-desc, .res-rich, .summary, .abstract, .content, p');
        (0, shared_1.pushResult)(accumulator, types_1.SearchEngine.So360, titleNode?.textContent || '', (0, shared_1.parseUrl)(rawUrl, context.pageUrl), snippetNode?.textContent || item.textContent || '', context.maxResults);
    }
    return accumulator.results;
}
