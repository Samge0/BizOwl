import { BrowserConfig } from '../config';

export const ElectronBrowserAction = {
  CreatePage: 'createPage',
  ClosePage: 'closePage',
  CloseAll: 'closeAll',
  Navigate: 'navigate',
  GetContent: 'getContent',
  GetText: 'getText',
  Screenshot: 'screenshot',
  Snapshot: 'snapshot'
} as const;

export type ElectronBrowserAction =
  typeof ElectronBrowserAction[keyof typeof ElectronBrowserAction];

export interface ElectronBrowserRequest {
  action: ElectronBrowserAction;
  pageId?: string;
  url?: string;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  timeout?: number;
  format?: 'png' | 'jpeg';
  fullPage?: boolean;
  quality?: number;
  maxElements?: number;
}

export interface ElectronBrowserElement {
  ref: string;
  tag: string;
  role: string;
  type: string;
  text: string;
  placeholder: string;
  value: string;
  href: string;
  description: string;
}

export interface ElectronBrowserSnapshot {
  title: string;
  url: string;
  elements: ElectronBrowserElement[];
  text: string;
}

export interface ElectronBrowserResponse {
  success: boolean;
  pageId?: string;
  url?: string;
  title?: string;
  content?: string;
  text?: string;
  screenshot?: string;
  format?: 'png' | 'jpeg';
  size?: number;
  snapshot?: ElectronBrowserSnapshot;
  error?: string;
}

export class ElectronBrowserClient {
  constructor(private readonly browserConfig: BrowserConfig) {}

  isConfigured(): boolean {
    return Boolean(this.browserConfig.electronBrowserUrl && this.browserConfig.electronBrowserSecret);
  }

  async request(input: ElectronBrowserRequest): Promise<ElectronBrowserResponse> {
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
    let parsed: ElectronBrowserResponse;
    try {
      parsed = JSON.parse(text) as ElectronBrowserResponse;
    } catch {
      throw new Error(text || `Electron browser bridge returned HTTP ${response.status}`);
    }
    if (!response.ok || !parsed.success) {
      throw new Error(parsed.error || `Electron browser bridge returned HTTP ${response.status}`);
    }
    return parsed;
  }

  async createPage(): Promise<string> {
    const response = await this.request({ action: ElectronBrowserAction.CreatePage });
    if (!response.pageId) {
      throw new Error('Electron browser bridge did not return a pageId');
    }
    return response.pageId;
  }

  async closePage(pageId: string): Promise<void> {
    await this.request({ action: ElectronBrowserAction.ClosePage, pageId });
  }
}
