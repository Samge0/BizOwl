"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canonicalizeUrl = void 0;
exports.parseSearchResults = parseSearchResults;
const jsdom_1 = require("jsdom");
const types_1 = require("../types");
const baidu_1 = require("./baidu");
const bing_1 = require("./bing");
const google_1 = require("./google");
const so360_1 = require("./so360");
const sogou_1 = require("./sogou");
var shared_1 = require("./shared");
Object.defineProperty(exports, "canonicalizeUrl", { enumerable: true, get: function () { return shared_1.canonicalizeUrl; } });
function parseSearchResults(engine, html, pageUrl, maxResults) {
    const dom = new jsdom_1.JSDOM(html, { url: pageUrl });
    const context = {
        document: dom.window.document,
        pageUrl,
        maxResults
    };
    if (engine === types_1.SearchEngine.Bing) {
        return (0, bing_1.parseBingResults)(context);
    }
    if (engine === types_1.SearchEngine.Google) {
        return (0, google_1.parseGoogleResults)(context);
    }
    if (engine === types_1.SearchEngine.Baidu) {
        return (0, baidu_1.parseBaiduResults)(context);
    }
    if (engine === types_1.SearchEngine.So360) {
        return (0, so360_1.parseSo360Results)(context);
    }
    if (engine === types_1.SearchEngine.Sogou) {
        return (0, sogou_1.parseSogouResults)(context);
    }
    return [];
}
