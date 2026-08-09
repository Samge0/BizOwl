/**
 * Web Search Skill - Bridge Server
 * Provides HTTP API for browser control and search operations
 */

import express, { NextFunction, Request, Response } from 'express';
import { Server } from 'http';
import { PlaywrightManager } from './playwright/manager';
import { launchBrowser, closeBrowser, isBrowserRunning, BrowserInstance } from './playwright/browser';
import { OrderedFallbackSearchService } from './search/orderedFallbackSearchService';
import { navigate, screenshot, getContent, getTextContent } from './playwright/operations';
import {
  clickElementRef,
  fillElementRef,
  pressKey,
  selectElementRef,
  snapshotPage
} from './playwright/interactions';
import {
  Config,
  mergeConfig,
  resolveBrowserBackend,
  shouldFallbackToElectronBackend
} from './config';
import {
  formatWindowsPowerShellMissingMessage,
  isWindowsPowerShellMissingError,
  normalizeWindowsPowerShellPath
} from './runtime/windowsPath';
import { BrowserBackend, SearchEngine, SearchEnginePreference, SearchResponse } from './search/types';
import { ElectronBrowserAction, ElectronBrowserClient } from './search/electronBrowserClient';

const ALLOWED_URL_SCHEMES = ['http:', 'https:', 'about:'];
const BRIDGE_SERVICE_NAME = 'web-search-bridge';
const BRIDGE_API_VERSION = 2;

normalizeWindowsPowerShellPath();

function validateNavigationUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (!ALLOWED_URL_SCHEMES.includes(parsed.protocol)) {
    throw new Error(`Blocked URL scheme "${parsed.protocol}" — only http/https/about:blank allowed`);
  }
  if (parsed.protocol === 'about:' && url !== 'about:blank') {
    throw new Error('Blocked about URL — only about:blank allowed');
  }
}

function decodeJsonRequestBody(raw: Buffer): string {
  if (raw.length === 0) {
    return '';
  }

  if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    return new TextDecoder('utf-8', { fatal: false }).decode(raw.subarray(3));
  }
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
    return new TextDecoder('utf-16le', { fatal: false }).decode(raw.subarray(2));
  }
  if (raw.length >= 2 && raw[0] === 0xfe && raw[1] === 0xff) {
    return new TextDecoder('utf-16be', { fatal: false }).decode(raw.subarray(2));
  }

  // Per RFC 8259, JSON must be UTF-8. Prefer UTF-8 when it decodes cleanly.
  // The scoring heuristic (scoreDecodedJsonText) is unreliable for CJK text:
  // gb18030 uses 2 bytes per CJK char vs UTF-8's 3 bytes, so the same bytes
  // decoded as gb18030 produce more CJK chars → higher score → wrong choice.
  try {
    const utf8Decoded = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    JSON.parse(utf8Decoded);
    return utf8Decoded;
  } catch {
    // UTF-8 decoding or JSON parsing failed
  }

  // Fallback: try gb18030 for clients that send non-UTF-8 bodies (e.g. Windows GBK)
  try {
    const gbDecoded = new TextDecoder('gb18030', { fatal: true }).decode(raw);
    console.warn('[Bridge Server] Request body decoded using gb18030 fallback');
    return gbDecoded;
  } catch {
    // gb18030 also failed
  }

  return new TextDecoder('utf-8', { fatal: false }).decode(raw);
}

export class BridgeServer {
  private app: express.Application;
  private playwrightManager: PlaywrightManager;
  private orderedFallbackSearch: OrderedFallbackSearchService;
  private electronBrowser: ElectronBrowserClient;
  private electronConnections: Map<string, { pageId: string; connectedAt: number }> = new Map();
  private browserInstance: BrowserInstance | null = null;
  private httpServer: Server | null = null;
  private config: Config;

  constructor(config?: Partial<Config>) {
    this.config = mergeConfig(config);
    this.app = express();
    this.playwrightManager = new PlaywrightManager();
    this.orderedFallbackSearch = new OrderedFallbackSearchService(this.config.search, this.config.browser);
    this.electronBrowser = new ElectronBrowserClient(this.config.browser);

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.raw({
      type: ['application/json', 'application/*+json'],
      limit: '2mb',
    }));

    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const contentType = req.headers['content-type'];
      const isJsonRequest = Array.isArray(contentType)
        ? contentType.some((value) => value.includes('application/json') || value.includes('+json'))
        : typeof contentType === 'string'
          ? contentType.includes('application/json') || contentType.includes('+json')
          : false;

      if (!isJsonRequest) {
        if (!req.body || typeof req.body !== 'object' || Buffer.isBuffer(req.body)) {
          req.body = {};
        }
        next();
        return;
      }

      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (rawBody.length === 0) {
        req.body = {};
        next();
        return;
      }

      try {
        const decoded = decodeJsonRequestBody(rawBody);
        req.body = JSON.parse(decoded) as Record<string, unknown>;
        next();
      } catch (error) {
        res.status(400).json({
          success: false,
          error: `Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`
        });
      }
    });

    // CORS for localhost only
    this.app.use((req, res, next) => {
      const origin = req.headers.origin;
      const isLocalhost = origin && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);

      if (isLocalhost) {
        res.header('Access-Control-Allow-Origin', origin);
      }

      res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      res.header('Vary', 'Origin');

      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
      }

      next();
    });

    // Request logging
    this.app.use((req, res, next) => {
      console.log(`[API] ${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/api/health', this.handleHealth.bind(this));

    // Browser management
    this.app.post('/api/browser/launch', this.handleBrowserLaunch.bind(this));
    this.app.post('/api/browser/connect', this.handleBrowserConnect.bind(this));
    this.app.post('/api/browser/disconnect', this.handleBrowserDisconnect.bind(this));
    this.app.post('/api/browser/close', this.handleBrowserClose.bind(this));
    this.app.get('/api/browser/status', this.handleBrowserStatus.bind(this));

    // Search operations
    this.app.post('/api/search', this.handleSearch.bind(this));
    this.app.post('/api/search/content', this.handleGetContent.bind(this));

    // Page operations
    this.app.post('/api/page/navigate', this.handleNavigate.bind(this));
    this.app.post('/api/page/screenshot', this.handleScreenshot.bind(this));
    this.app.post('/api/page/content', this.handlePageContent.bind(this));
    this.app.post('/api/page/text', this.handlePageText.bind(this));
    this.app.post('/api/page/snapshot', this.handleSnapshot.bind(this));
    this.app.post('/api/page/click', this.handleClick.bind(this));
    this.app.post('/api/page/fill', this.handleFill.bind(this));
    this.app.post('/api/page/select', this.handleSelect.bind(this));
    this.app.post('/api/page/press', this.handlePress.bind(this));

    // Connection management
    this.app.get('/api/connections', this.handleListConnections.bind(this));
  }

  private isBrowserProcessAlive(instance: BrowserInstance | null): boolean {
    if (!instance) {
      return false;
    }

    if (!isBrowserRunning(instance)) {
      return false;
    }

    try {
      process.kill(instance.pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private async isCdpReachable(port: number): Promise<boolean> {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(1500)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async resetBrowserState(): Promise<void> {
    await this.playwrightManager.disconnectAll();
    await Promise.all(Array.from(this.electronConnections.values()).map(conn =>
      this.electronBrowser.closePage(conn.pageId).catch(() => undefined)
    ));
    this.electronConnections.clear();

    if (this.browserInstance) {
      try {
        await closeBrowser(this.browserInstance);
      } catch (error) {
        console.warn(`[Bridge Server] Failed to close stale browser instance: ${error instanceof Error ? error.message : String(error)}`);
      }
      this.browserInstance = null;
    }
  }

  private async ensureBrowserReady(): Promise<{ instance: BrowserInstance; reused: boolean }> {
    if (this.browserInstance) {
      const processAlive = this.isBrowserProcessAlive(this.browserInstance);
      const cdpReachable = processAlive ? await this.isCdpReachable(this.browserInstance.cdpPort) : false;

      if (processAlive && cdpReachable) {
        return { instance: this.browserInstance, reused: true };
      }

      console.warn('[Bridge Server] Detected stale browser instance, relaunching...');
      await this.resetBrowserState();
    }

    this.browserInstance = await launchBrowser(this.config.browser);
    return { instance: this.browserInstance, reused: false };
  }

  private shouldUseElectronBackend(): boolean {
    return resolveBrowserBackend(
      this.config.browser.backend,
      process.platform,
      this.electronBrowser.isConfigured()
    ) === BrowserBackend.Electron;
  }

  private shouldFallbackToElectronBackend(): boolean {
    return shouldFallbackToElectronBackend(
      this.config.browser.backend,
      process.platform,
      this.electronBrowser.isConfigured()
    );
  }

  private async createElectronConnection(): Promise<string> {
    const pageId = await this.electronBrowser.createPage();
    const connectionId = `electron:${pageId}`;
    this.electronConnections.set(connectionId, {
      pageId,
      connectedAt: Date.now()
    });
    return connectionId;
  }

  private getElectronPageId(connectionId: string): string {
    const conn = this.electronConnections.get(connectionId);
    if (!conn) {
      throw new Error(`Electron browser connection not found: ${connectionId}`);
    }
    return conn.pageId;
  }

  private isElectronConnection(connectionId: string): boolean {
    return this.electronConnections.has(connectionId);
  }

  // Health check endpoint
  private handleHealth(req: Request, res: Response): void {
    res.json({
      success: true,
      data: {
        service: BRIDGE_SERVICE_NAME,
        apiVersion: BRIDGE_API_VERSION,
        status: 'healthy',
        uptime: process.uptime(),
        connections: this.playwrightManager.getConnectionCount()
      }
    });
  }

  // Launch browser
  private async handleBrowserLaunch(req: Request, res: Response): Promise<void> {
    try {
      if (this.shouldUseElectronBackend()) {
        res.json({
          success: true,
          data: {
            message: 'Electron browser backend ready',
            backend: BrowserBackend.Electron
          }
        });
        return;
      }

      let ready: { instance: BrowserInstance; reused: boolean };
      try {
        ready = await this.ensureBrowserReady();
      } catch (error) {
        if (!this.shouldFallbackToElectronBackend()) {
          throw error;
        }
        console.warn(`[Bridge Server] Playwright browser launch failed, falling back to Electron: ${error instanceof Error ? error.message : String(error)}`);
        res.json({
          success: true,
          data: {
            message: 'Electron browser backend ready',
            backend: BrowserBackend.Electron
          }
        });
        return;
      }

      const { instance, reused } = ready;

      if (reused) {
        res.json({
          success: true,
          data: {
            message: 'Browser already running',
            pid: instance.pid,
            cdpPort: instance.cdpPort
          }
        });
        return;
      }

      res.json({
        success: true,
        data: {
          pid: instance.pid,
          cdpPort: instance.cdpPort,
          startTime: instance.startTime
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: this.formatSearchError(error)
      });
    }
  }

  private formatSearchError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (isWindowsPowerShellMissingError(error)) {
      return formatWindowsPowerShellMissingMessage(message);
    }
    return message;
  }

  // Connect to browser via Playwright
  private async handleBrowserConnect(req: Request, res: Response): Promise<void> {
    try {
      if (this.shouldUseElectronBackend()) {
        const connectionId = await this.createElectronConnection();
        res.json({
          success: true,
          data: {
            connectionId,
            backend: BrowserBackend.Electron
          }
        });
        return;
      }

      const { cdpPort } = req.body;
      let port = cdpPort as number | undefined;

      // If client does not specify a port, ensure managed browser is healthy first.
      if (!port) {
        const { instance } = await this.ensureBrowserReady();
        port = instance.cdpPort;
      }

      let connectionId: string;
      try {
        connectionId = await this.playwrightManager.connectToCDP(port);
      } catch (error) {
        if (!this.shouldFallbackToElectronBackend()) {
          throw error;
        }
        console.warn(`[Bridge Server] Playwright browser connection failed, falling back to Electron: ${error instanceof Error ? error.message : String(error)}`);
        connectionId = await this.createElectronConnection();
        res.json({
          success: true,
          data: {
            connectionId,
            backend: BrowserBackend.Electron
          }
        });
        return;
      }

      res.json({
        success: true,
        data: {
          connectionId,
          cdpPort: port
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Disconnect from browser
  private async handleBrowserDisconnect(req: Request, res: Response): Promise<void> {
    try {
      const { connectionId } = req.body;

      if (!connectionId) {
        res.status(400).json({
          success: false,
          error: 'connectionId is required'
        });
        return;
      }

      if (this.electronConnections.has(connectionId)) {
        const pageId = this.getElectronPageId(connectionId);
        this.electronConnections.delete(connectionId);
        await this.electronBrowser.closePage(pageId).catch(() => undefined);
      } else {
        await this.playwrightManager.disconnect(connectionId);
      }

      res.json({
        success: true,
        data: { message: 'Disconnected successfully' }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Close browser and disconnect all connections
  private async handleBrowserClose(req: Request, res: Response): Promise<void> {
    try {
      await this.resetBrowserState();

      res.json({
        success: true,
        data: { message: 'Browser closed successfully' }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Get browser status
  private async handleBrowserStatus(req: Request, res: Response): Promise<void> {
    const processAlive = this.isBrowserProcessAlive(this.browserInstance);
    const cdpReachable = processAlive && this.browserInstance
      ? await this.isCdpReachable(this.browserInstance.cdpPort)
      : false;

    res.json({
      success: true,
      data: {
        browserRunning: processAlive && cdpReachable,
        electronBackendConfigured: this.electronBrowser.isConfigured(),
        electronConnections: this.electronConnections.size,
        backend: this.shouldUseElectronBackend() ? BrowserBackend.Electron : BrowserBackend.Playwright,
        processAlive,
        cdpReachable,
        connections: this.playwrightManager.getConnectionCount(),
        pid: this.browserInstance?.pid,
        cdpPort: this.browserInstance?.cdpPort
      }
    });
  }

  // Search operation
  private async handleSearch(req: Request, res: Response): Promise<void> {
    try {
      const { query, maxResults, engine, fallbackOrder } = req.body;

      if (!query) {
        res.status(400).json({
          success: false,
          error: 'query is required'
        });
        return;
      }

      const preferredEngine = this.normalizeEnginePreference(engine);
      const preferredFallbackOrder = this.normalizeFallbackOrder(fallbackOrder);
      const results = await this.orderedFallbackSearch.search({
        query,
        maxResults,
        engine: preferredEngine,
        fallbackOrder: preferredFallbackOrder
      });

      res.json({
        success: true,
        data: results
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private normalizeEnginePreference(engine: unknown): SearchEnginePreference {
    const normalizedEngine = String(engine || '').trim().toLowerCase();
    if (normalizedEngine === 'so' || normalizedEngine === 'so360') {
      return SearchEngine.So360;
    }
    if (normalizedEngine === 'sg') {
      return SearchEngine.Sogou;
    }

    if (
      engine === SearchEngine.Google
      || engine === SearchEngine.Bing
      || engine === SearchEngine.Baidu
      || engine === SearchEngine.So360
      || engine === SearchEngine.Sogou
      || engine === SearchEnginePreference.Auto
    ) {
      return engine;
    }

    return this.config.search.defaultEngine;
  }

  private normalizeFallbackOrder(fallbackOrder: unknown): SearchEngine[] | null {
    const rawItems = Array.isArray(fallbackOrder)
      ? fallbackOrder
      : typeof fallbackOrder === 'string'
        ? fallbackOrder.split(',')
        : [];

    const normalized = rawItems
      .map(item => String(item).trim().toLowerCase())
      .map(item => (item === 'so' || item === 'so360' ? SearchEngine.So360 : item))
      .map(item => (item === 'sg' ? SearchEngine.Sogou : item))
      .filter((item): item is SearchEngine =>
        item === SearchEngine.Google
        || item === SearchEngine.Bing
        || item === SearchEngine.Baidu
        || item === SearchEngine.So360
        || item === SearchEngine.Sogou
      );

    const unique = Array.from(new Set<SearchEngine>(normalized));
    return unique.length > 0 ? unique : null;
  }

  // Get content from URL
  private async handleGetContent(req: Request, res: Response): Promise<void> {
    try {
      const { url } = req.body;

      if (!url) {
        res.status(400).json({
          success: false,
          error: 'url is required'
        });
        return;
      }

      validateNavigationUrl(url);

      const content = await this.orderedFallbackSearch.getContent(url);

      res.json({
        success: true,
        data: content
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Navigate to URL
  private async handleNavigate(req: Request, res: Response): Promise<void> {
    try {
      const { connectionId, url, waitUntil, timeout } = req.body;

      if (!connectionId || !url) {
        res.status(400).json({
          success: false,
          error: 'connectionId and url are required'
        });
        return;
      }

      validateNavigationUrl(url);

      if (this.isElectronConnection(connectionId)) {
        const pageId = this.getElectronPageId(connectionId);
        const result = await this.electronBrowser.request({
          action: ElectronBrowserAction.Navigate,
          pageId,
          url,
          waitUntil,
          timeout
        });
        res.json({
          success: true,
          data: { url: result.url }
        });
        return;
      }

      const page = await this.playwrightManager.getPage(connectionId);
      await navigate(page, { url, waitUntil, timeout });

      res.json({
        success: true,
        data: { url: page.url() }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Take screenshot
  private async handleScreenshot(req: Request, res: Response): Promise<void> {
    try {
      const { connectionId, format = 'png', fullPage = false, quality } = req.body;

      if (!connectionId) {
        res.status(400).json({
          success: false,
          error: 'connectionId is required'
        });
        return;
      }

      if (this.isElectronConnection(connectionId)) {
        const result = await this.electronBrowser.request({
          action: ElectronBrowserAction.Screenshot,
          pageId: this.getElectronPageId(connectionId),
          format,
          fullPage,
          quality
        });
        res.json({
          success: true,
          data: {
            screenshot: result.screenshot,
            format: result.format || format,
            size: result.size || 0
          }
        });
        return;
      }

      const page = await this.playwrightManager.getPage(connectionId);
      const buffer = await screenshot(page, { format, fullPage });

      res.json({
        success: true,
        data: {
          screenshot: buffer.toString('base64'),
          format,
          size: buffer.length
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Get page HTML content
  private async handlePageContent(req: Request, res: Response): Promise<void> {
    try {
      const { connectionId } = req.body;

      if (!connectionId) {
        res.status(400).json({
          success: false,
          error: 'connectionId is required'
        });
        return;
      }

      if (this.isElectronConnection(connectionId)) {
        const result = await this.electronBrowser.request({
          action: ElectronBrowserAction.GetContent,
          pageId: this.getElectronPageId(connectionId)
        });
        res.json({
          success: true,
          data: { content: result.content || '' }
        });
        return;
      }

      const page = await this.playwrightManager.getPage(connectionId);
      const content = await getContent(page);

      res.json({
        success: true,
        data: { content }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Get page text content
  private async handlePageText(req: Request, res: Response): Promise<void> {
    try {
      const { connectionId } = req.body;

      if (!connectionId) {
        res.status(400).json({
          success: false,
          error: 'connectionId is required'
        });
        return;
      }

      if (this.isElectronConnection(connectionId)) {
        const result = await this.electronBrowser.request({
          action: ElectronBrowserAction.GetText,
          pageId: this.getElectronPageId(connectionId)
        });
        res.json({
          success: true,
          data: { text: result.text || '' }
        });
        return;
      }

      const page = await this.playwrightManager.getPage(connectionId);
      const text = await getTextContent(page);

      res.json({
        success: true,
        data: { text }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Get text-first page snapshot with stable element refs
  private async handleSnapshot(req: Request, res: Response): Promise<void> {
    try {
      const { connectionId, maxElements } = req.body;

      if (!connectionId) {
        res.status(400).json({
          success: false,
          error: 'connectionId is required'
        });
        return;
      }

      if (this.isElectronConnection(connectionId)) {
        const result = await this.electronBrowser.request({
          action: ElectronBrowserAction.Snapshot,
          pageId: this.getElectronPageId(connectionId),
          maxElements
        });
        res.json({
          success: true,
          data: result.snapshot
        });
        return;
      }

      const page = await this.playwrightManager.getPage(connectionId);
      const snapshot = await snapshotPage(page, { maxElements });

      res.json({
        success: true,
        data: snapshot
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Click a page element by snapshot ref
  private async handleClick(req: Request, res: Response): Promise<void> {
    try {
      const { connectionId, ref } = req.body;

      if (!connectionId || !ref) {
        res.status(400).json({
          success: false,
          error: 'connectionId and ref are required'
        });
        return;
      }

      if (this.isElectronConnection(connectionId)) {
        res.status(501).json({
          success: false,
          error: 'Click is not supported by the Electron browser backend yet'
        });
        return;
      }

      const page = await this.playwrightManager.getPage(connectionId);
      await clickElementRef(page, String(ref));

      res.json({
        success: true,
        data: { url: page.url() }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Fill a page element by snapshot ref
  private async handleFill(req: Request, res: Response): Promise<void> {
    try {
      const { connectionId, ref, text, pressEnter } = req.body;

      if (!connectionId || !ref || typeof text !== 'string') {
        res.status(400).json({
          success: false,
          error: 'connectionId, ref, and text are required'
        });
        return;
      }

      if (this.isElectronConnection(connectionId)) {
        res.status(501).json({
          success: false,
          error: 'Fill is not supported by the Electron browser backend yet'
        });
        return;
      }

      const page = await this.playwrightManager.getPage(connectionId);
      await fillElementRef(page, String(ref), text, Boolean(pressEnter));

      res.json({
        success: true,
        data: { url: page.url() }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Select an option by snapshot ref
  private async handleSelect(req: Request, res: Response): Promise<void> {
    try {
      const { connectionId, ref, value, label, index } = req.body;

      if (!connectionId || !ref) {
        res.status(400).json({
          success: false,
          error: 'connectionId and ref are required'
        });
        return;
      }

      if (this.isElectronConnection(connectionId)) {
        res.status(501).json({
          success: false,
          error: 'Select is not supported by the Electron browser backend yet'
        });
        return;
      }

      const page = await this.playwrightManager.getPage(connectionId);
      await selectElementRef(page, String(ref), {
        value: typeof value === 'string' ? value : undefined,
        label: typeof label === 'string' ? label : undefined,
        index: typeof index === 'number' ? index : undefined
      });

      res.json({
        success: true,
        data: { url: page.url() }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Press a keyboard key
  private async handlePress(req: Request, res: Response): Promise<void> {
    try {
      const { connectionId, key } = req.body;

      if (!connectionId || !key) {
        res.status(400).json({
          success: false,
          error: 'connectionId and key are required'
        });
        return;
      }

      if (this.isElectronConnection(connectionId)) {
        res.status(501).json({
          success: false,
          error: 'Press is not supported by the Electron browser backend yet'
        });
        return;
      }

      const page = await this.playwrightManager.getPage(connectionId);
      await pressKey(page, String(key));

      res.json({
        success: true,
        data: { url: page.url() }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // List all connections
  private handleListConnections(req: Request, res: Response): void {
    const connections = [
      ...this.playwrightManager.listConnections(),
      ...Array.from(this.electronConnections.entries()).map(([id, conn]) => ({
        id,
        connectedAt: conn.connectedAt,
        pageCount: 1
      }))
    ];

    res.json({
      success: true,
      data: { connections }
    });
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = this.app.listen(this.config.server.port, this.config.server.host);
      this.httpServer = server;

      server.once('error', (error) => {
        this.httpServer = null;
        reject(error);
      });

      server.once('listening', () => {
        console.log(`\n[Bridge Server] Started on http://${this.config.server.host}:${this.config.server.port}`);
        console.log(`[Bridge Server] Health check: http://${this.config.server.host}:${this.config.server.port}/api/health\n`);
        resolve();
      });
    });
  }

  /**
   * Stop the server and cleanup
   */
  async stop(): Promise<void> {
    console.log('\n[Bridge Server] Shutting down...');

    // Disconnect all Playwright connections
    await this.playwrightManager.disconnectAll();
    await Promise.all(Array.from(this.electronConnections.values()).map(conn =>
      this.electronBrowser.closePage(conn.pageId).catch(() => undefined)
    ));
    this.electronConnections.clear();

    // Close browser if running
    if (this.browserInstance) {
      await closeBrowser(this.browserInstance);
      this.browserInstance = null;
    }

    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer?.close((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      this.httpServer = null;
    }

    console.log('[Bridge Server] Shutdown complete\n');
  }
}

// Main entry point
if (require.main === module) {
  const server = new BridgeServer();

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.stop();
    process.exit(0);
  });

  // Start server
  server.start().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}

export default BridgeServer;
