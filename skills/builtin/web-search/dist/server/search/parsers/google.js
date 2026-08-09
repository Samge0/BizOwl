"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseGoogleResults = parseGoogleResults;
const types_1 = require("../types");
const shared_1 = require("./shared");
function parseGoogleResults(context) {
    const accumulator = {
        results: [],
        seen: new Set()
    };
    const items = Array.from(context.document.querySelectorAll('div#search div.g'));
    for (const item of items) {
        const titleNode = item.querySelector('h3');
        const anchor = titleNode?.closest('a');
        const snippetNode = item.querySelector('.VwiC3b, .yXK7lf, span.aCOpRe, div.IsZvec');
        (0, shared_1.pushResult)(accumulator, types_1.SearchEngine.Google, titleNode?.textContent || anchor?.textContent || '', (0, shared_1.parseUrl)(anchor?.href || '', context.pageUrl), snippetNode?.textContent || '', context.maxResults);
    }
    return accumulator.results;
}
