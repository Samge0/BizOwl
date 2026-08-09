"use strict";
/**
 * Search result types
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserBackend = exports.SearchEnginePreference = exports.SearchEngine = void 0;
exports.SearchEngine = {
    Baidu: 'baidu',
    Bing: 'bing',
    So360: '360',
    Sogou: 'sogou',
    Google: 'google'
};
exports.SearchEnginePreference = {
    Auto: 'auto',
    ...exports.SearchEngine
};
exports.BrowserBackend = {
    Auto: 'auto',
    Playwright: 'playwright',
    Electron: 'electron'
};
