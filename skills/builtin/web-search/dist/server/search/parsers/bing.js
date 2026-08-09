"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseBingResults = parseBingResults;
const types_1 = require("../types");
const shared_1 = require("./shared");
function parseBingResults(context) {
    const accumulator = {
        results: [],
        seen: new Set()
    };
    for (const item of Array.from(context.document.querySelectorAll('li.b_algo'))) {
        const titleNode = item.querySelector('h2 a');
        const anchor = titleNode;
        const snippetNode = item.querySelector('.b_caption p, .b_caption');
        (0, shared_1.pushResult)(accumulator, types_1.SearchEngine.Bing, titleNode?.textContent || '', (0, shared_1.parseUrl)(anchor?.href || '', context.pageUrl), snippetNode?.textContent || '', context.maxResults);
    }
    return accumulator.results;
}
