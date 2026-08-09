"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ElectronBrowserClient = exports.ElectronBrowserAction = void 0;
exports.ElectronBrowserAction = {
    CreatePage: 'createPage',
    ClosePage: 'closePage',
    CloseAll: 'closeAll',
    Navigate: 'navigate',
    GetContent: 'getContent',
    GetText: 'getText',
    Screenshot: 'screenshot',
    Snapshot: 'snapshot'
};
class ElectronBrowserClient {
    browserConfig;
    constructor(browserConfig) {
        this.browserConfig = browserConfig;
    }
    isConfigured() {
        return Boolean(this.browserConfig.electronBrowserUrl && this.browserConfig.electronBrowserSecret);
    }
    async request(input) {
        const url = this.browserConfig.electronBrowserUrl;
        const secret = this.browserConfig.electronBrowserSecret;
        if (!url || !secret) {
            throw new Error('Electron browser bridge is not configured');
        }
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-bridge-secret': secret
            },
            body: JSON.stringify(input),
            signal: AbortSignal.timeout(this.browserConfig.headless ? 45000 : 60000)
        });
        const text = await response.text();
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch {
            throw new Error(text || `Electron browser bridge returned HTTP ${response.status}`);
        }
        if (!response.ok || !parsed.success) {
            throw new Error(parsed.error || `Electron browser bridge returned HTTP ${response.status}`);
        }
        return parsed;
    }
    async createPage() {
        const response = await this.request({ action: exports.ElectronBrowserAction.CreatePage });
        if (!response.pageId) {
            throw new Error('Electron browser bridge did not return a pageId');
        }
        return response.pageId;
    }
    async closePage(pageId) {
        await this.request({ action: exports.ElectronBrowserAction.ClosePage, pageId });
    }
}
exports.ElectronBrowserClient = ElectronBrowserClient;
