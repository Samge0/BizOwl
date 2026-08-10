/**
 * main.js — Electron 主进程（BizOwl）
 */

const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const os = require('node:os');
const { realPath } = require('../src/skills/paths.cjs');

// ─── 辅助函数 ───
/**
 * 轻量 JSON HTTP(S) GET（带超时），避免依赖第三方库。
 * 主进程已有 https 模块，但手动封装 fetchJson 更简洁。
 */
function fetchJson(url, opts = {}, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const reqOpts = {
      method: 'GET',
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: opts.headers || {},
      timeout: opts.timeout || 10000,
    };
    const req = lib.request(reqOpts, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        // 跟随重定向（限制最大次数，防止无限循环）
        if (res.headers.location && maxRedirects > 0) {
          res.resume();
          fetchJson(res.headers.location, opts, maxRedirects - 1).then(resolve, reject);
          return;
        }
        if (maxRedirects <= 0) {
          res.resume();
          reject(new Error('Too many redirects'));
          return;
        }
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (err) {
          reject(new Error(`JSON 解析失败: ${err.message}`));
        }
      });
    });
    req.on('timeout', () => { req.destroy(new Error(`请求超时 (${opts.timeout || 10000}ms)`)); });
    req.on('error', reject);
    req.end();
  });
}

/**
 * 语义化版本比较。返回值 >0 表示 a 更新，<0 表示 b 更新，0 表示相同。
 * 支持任意长度的点分版本号（如 "1.0.0", "2.1", "10.3.4-beta"）。
 */
function compareVersions(a, b) {
  const parseVer = (v) => {
    return String(v || '')
      .replace(/^v/i, '')
      .split('-')[0] // 去掉预发布后缀
      .split('.')
      .map((s) => parseInt(s, 10) || 0);
  };
  const pa = parseVer(a);
  const pb = parseVer(b);
  const maxLen = Math.max(pa.length, pb.length);
  for (let i = 0; i < maxLen; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

// ─── 检测运行环境 ───
let electron;
let isElectron = false;
try {
  electron = require('electron');
  isElectron = !!(electron.app && electron.BrowserWindow);
} catch {
  electron = { app: null, BrowserWindow: null, ipcMain: { handle: () => {}, on: () => {} }, dialog: null };
}

// ─── ESM 模块延迟加载 ───
let createDefaultPipeline, BUSINESS_PROMPT_CATALOG, loadAllSkills, loadCustomModels, saveCustomModels, getCustomModels, newModelId;
let runAgentLoop;
let DEFAULT_TIMEOUT_MS = null; // agent-loop 内置默认超时（毫秒），设置页配置缺失/非法时 fallback
let PRESET_AGENTS, findPresetAgent;
let qccAuth, sessionStore;
let searchCompanies, exportDocument;
let log; // 统一日志器
let exportSkill, importSkill, deleteSkill;
let optmemWake, optmemExtractAndNote;
let optmemNote, optmemRecall, optmemGetAll, optmemGetStats, optmemDeleteMany, getUserMd, setUserMd;
let registerArtifact, listArtifacts; // 产物注册表（研究报告/导出文件通用）
let refreshSession = null; // 不再使用 — 保留变量名兼容，但不消费 refreshToken
let ensureValidToken = null;

async function loadModules() {
  const prompts = await import('../src/prompt-pipeline/builder.js');
  const catalog = await import('../src/prompt-pipeline/business-catalog.js');
  const skills = await import('../src/skills/loader.js');
  const models = await import('../src/config/custom-models.js');
  const agent = await import('../src/agent/agent-loop.js');
  const presetAgents = await import('../src/prompt-pipeline/preset-agents.js');
  const auth = await import('../src/auth/datasource-auth.js');
  const sessions = await import('../src/chat/session-store.js');
  const logger = await import('../src/utils/logger.js');
  const qccTools = await import('../src/agent/datasource-tools.js');
  const optmem = await import('../src/memory/optmem-bridge.js');
  const report = await import('../src/report/report-export.js');
  createDefaultPipeline = prompts.createDefaultPipeline;
  BUSINESS_PROMPT_CATALOG = catalog.BUSINESS_PROMPT_CATALOG;
  loadAllSkills = skills.loadAllSkills;
  loadCustomModels = models.loadCustomModels;
  saveCustomModels = models.saveCustomModels;
  getCustomModels = models.getCustomModels;
  newModelId = models.newModelId;
  runAgentLoop = agent.runAgentLoop;
  DEFAULT_TIMEOUT_MS = agent.DEFAULT_TIMEOUT_MS;
  PRESET_AGENTS = presetAgents.PRESET_AGENTS;
  findPresetAgent = presetAgents.findPresetAgent;
  qccAuth = auth;
  sessionStore = sessions;
  searchCompanies = qccTools.searchCompanies;
  exportDocument = qccTools.exportDocument;
  log = logger.createLogger('main');
  log.info('App 启动', { pid: process.pid, platform: process.platform });
  console.log('[Main] 模块加载完成（含 Agent Loop + PresetAgents + Auth + Sessions + SkillIO + Logger）');
  exportSkill = skills.exportSkill;
  importSkill = skills.importSkill;
  deleteSkill = skills.deleteSkill;
  optmemWake = optmem.optmemWake;
  optmemExtractAndNote = optmem.extractAndNote;
  optmemNote = optmem.optmemNote;
  optmemRecall = optmem.optmemRecall;
  optmemGetAll = optmem.optmemGetAll;
  optmemGetStats = optmem.optmemGetStats;
  optmemDeleteMany = optmem.optmemDeleteMany;
  getUserMd = optmem.getUserMd;
  setUserMd = optmem.setUserMd;
  registerArtifact = report.registerArtifact;
  listArtifacts = report.listArtifacts;
  // 不消费 refreshToken — 移除 refreshSession / ensureValidToken 赋值
  // refreshSession = auth.refreshSession;    // 已禁用：会踢掉同一账号的其他客户端登录
  // ensureValidToken = auth.ensureValidToken;
}

// ─── 启动 Skill 服务（web-search bridge 等）───
const skillServices = new Map(); // name -> { proc, port }

/**
 * 启动前主动清理占用指定端口的残留进程。
 * 这些都是 BizOwl 自己启动的子进程，安全 kill。
 */
function killProcessesOnPort(port) {
  try {
    const { execSync } = require('node:child_process');
    let pids = [];
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf8' });
      pids = [...new Set(out.trim().split('\n').map(l => l.trim().split(/\s+/).pop()))];
    } else {
      const out = execSync(`lsof -ti :${port} -sTCP:LISTEN`, { encoding: 'utf8' });
      pids = out.trim().split('\n').filter(Boolean).map(p => p.trim());
    }
    for (const pid of pids) {
      if (pid && pid !== String(process.pid)) {
        try {
          process.kill(Number(pid), 'SIGKILL');
          console.log(`[Services] 清理端口 ${port} 上的残留进程 (pid=${pid})`);
        } catch {}
      }
    }
  } catch {
    // 没有进程占用端口，正常
  }
}

function startSkillService(name, entryScript, port) {
  if (skillServices.has(name)) {
    console.log(`[Services] ${name} 已在运行，跳过`);
    return;
  }
  // 主动清理端口上的残留进程（上次 App 异常退出留下的僵尸子进程）
  killProcessesOnPort(port);

  // 子进程走真实 OS，无法读取 app.asar 内部 → 用 realPath 指向 app.asar.unpacked
  const skillsRootReal = realPath(path.join(__dirname, '..', 'skills', 'builtin'));
  const fullPath = path.join(skillsRootReal, entryScript);
  if (!fs.existsSync(fullPath)) {
    console.warn(`[Services] ${name} 入口不存在: ${fullPath}`);
    return;
  }
  // 服务进程的可写工作目录（crawlee 写 .cache/crawlee 相对 cwd；asar 内只读会失败）
  const cwd = path.join(electron.app.getPath('userData'), 'skill-services', name);
  try { fs.mkdirSync(cwd, { recursive: true }); } catch { /* 忽略，spawn 时再报 */ }
  const proc = spawn(process.execPath, [fullPath], {
    cwd,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      SKILLS_ROOT: skillsRootReal,
      BIZOWL_ELECTRON_PATH: process.execPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.on('error', (err) => {
    console.warn(`[Services] ${name} 启动失败:`, err.message);
  });
  proc.on('exit', (code) => {
    console.warn(`[Services] ${name} 退出 (code=${code})`);
    skillServices.delete(name);
    // 运行时崩溃 → 3 秒后自动重启（启动前会先清理端口，不会 EADDRINUSE）
    if (!isQuitting && code !== 0) {
      console.log(`[Services] ${name} 将在 3s 后自动重启`);
      setTimeout(() => {
        if (!isQuitting) startSkillService(name, entryScript, port);
      }, 3000);
    }
  });
  proc.stdout?.on('data', (d) => {
    const line = d.toString().trim();
    if (line) console.log(`[Services:${name}] ${line}`);
  });
  proc.stderr?.on('data', (d) => {
    const line = d.toString().trim();
    if (line && !line.includes('DeprecationWarning')) console.warn(`[Services:${name}] ${line}`);
  });
  skillServices.set(name, { proc, port });
  console.log(`[Services] ${name} 启动中 (port=${port}, pid=${proc.pid})`);
}

function startAllSkillServices() {
  // web-search bridge server (port 37823)
  startSkillService('web-search', 'web-search/dist/server/index.js', 37823);
}

let mainWindow = null;
let isQuitting = false; // Cmd+Q / 真正退出时置 true，避免被 hide 拦截

function createWindow() {
  if (!isElectron) {
    console.log('[Main] node 模式，跳过窗口创建');
    return;
  }
  const { BrowserWindow, Menu, MenuItem } = electron;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false, // 无边框：移除原生标题栏（macOS 交通灯 + Windows 原生标题栏），仅保留自定义标题栏控件，避免左右重复且左侧挡住标题
    backgroundColor: '#FFFFFF',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  // 应用菜单：frameless 窗口下显式注册「编辑菜单」角色，
  // 否则 macOS 上 Cmd+C / Cmd+V / Cmd+X / Cmd+A 等编辑快捷键不会触发。
  if (Menu) {
    const isMac = process.platform === 'darwin';
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(isMac ? [{ role: 'appMenu' }] : []),
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]));
  }

  // 右键菜单：复制 / 剪切 / 粘贴 / 全选（按当前选区与可编辑状态动态启用）
  // 原生 BrowserWindow 默认无右键菜单，需在此手动弹出，否则用户无法右键复制聊天内容。
  if (mainWindow.webContents && Menu && MenuItem) {
    mainWindow.webContents.on('context-menu', (_e, params) => {
      const menu = new Menu();
      const f = params.editFlags || {};
      if (f.canCut) menu.append(new MenuItem({ role: 'cut' }));
      if (f.canCopy) menu.append(new MenuItem({ role: 'copy' }));
      if (f.canPaste) menu.append(new MenuItem({ role: 'paste' }));
      if (f.canSelectAll) menu.append(new MenuItem({ role: 'selectAll' }));
      if (menu.items.length > 0) menu.popup(mainWindow);
    });
  }

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  // 设置 Dock / 任务栏图标（dev 模式下覆盖 Electron 默认图标）
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  if (fs.existsSync(iconPath)) {
    mainWindow.setIcon(iconPath);
    if (process.platform === 'darwin' && electron.app.dock) {
      electron.app.dock.setIcon(iconPath);
    }
  }

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  // 捕获渲染层 console 消息和加载错误（调试用）
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) console.warn(`[Renderer:warn] ${message} (${sourceId}:${line})`);
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[Load Fail] ${code} ${desc} — ${url}`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[Renderer Crash]', details.reason, details.exitCode);
  });

  // macOS：点关闭按钮/红绿灯时隐藏到 dock（保留窗口与页面状态），再次点击图标显示出来。
  // 真正退出（Cmd+Q / before-quit）时 isQuitting=true，正常关闭销毁。
  mainWindow.on('close', (e) => {
    if (!isQuitting && process.platform === 'darwin') {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// ─── IPC handlers ───
function registerIpcHandlers() {
  const { ipcMain } = electron;

  // skills:list
  ipcMain.handle('skills:list', async () => {
    const skills = loadAllSkills();
    return skills.map(s => ({
      name: s.name,
      description: s.description,
      official: s.official,
      hasScripts: s.hasScripts,
    }));
  });

  // skills:export — 弹出保存对话框 → 调 exportSkill
  ipcMain.handle('skills:export', async (_evt, skillName) => {
    if (!skillName) throw new Error('缺少 skillName');
    const dialog = electron.dialog;
    if (!dialog) throw new Error('当前环境不支持文件保存对话框');
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: `导出 Skill: ${skillName}`,
      defaultPath: `${skillName}.zip`,
      filters: [
        { name: 'ZIP 压缩包', extensions: ['zip'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (canceled || !filePath) {
      return { success: false, canceled: true };
    }
    return exportSkill(skillName, filePath);
  });

  // skills:import — 弹出文件选择对话框 → 调 importSkill
  ipcMain.handle('skills:import', async () => {
    const dialog = electron.dialog;
    if (!dialog) throw new Error('当前环境不支持文件选择对话框');
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: '导入 Skill',
      properties: ['openFile'],
      filters: [
        { name: 'Skill 压缩包', extensions: ['zip', 'tar.gz', 'tgz', 'tar'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (canceled || !filePaths || filePaths.length === 0) {
      return { success: false, canceled: true };
    }
    return importSkill(filePaths[0]);
  });

  // skills:delete — 调 deleteSkill
  ipcMain.handle('skills:delete', async (_evt, skillName) => {
    if (!skillName) throw new Error('缺少 skillName');
    return deleteSkill(skillName);
  });

  // assets:read — 读取根 assets/ 下的静态资源（避免 file:// 下 fetch 被拦截 + 路径错误）
  ipcMain.handle('assets:read', async (_evt, name) => {
    // 仅允许文件名，禁止路径穿越
    const base = path.join(__dirname, '..', 'assets');
    const resolved = path.resolve(base, path.basename(name || ''));
    if (!resolved.startsWith(base)) throw new Error('非法资源路径');
    const raw = fs.readFileSync(resolved, 'utf8');
    try { return JSON.parse(raw); } catch { return raw; }
  });

  // prompt:build — 构建 system prompt（支持 agentId/presetId/templateId 条件注入）
  ipcMain.handle('prompt:build', async (_evt, ctx = {}) => {
    const pipeline = createDefaultPipeline({ enableCommercialWall: true });

    // 如果指定了 agentId，查找预设 Agent 并注入其 systemPrompt
    let agentSystemPrompt = null;
    let activeAgent = null;
    if (ctx.agentId) {
      const agent = findPresetAgent(ctx.agentId);
      if (agent) {
        agentSystemPrompt = agent.systemPrompt;
        activeAgent = agent.name;
      }
    }

    // 异步读取 OptMem 记忆上下文（不阻塞——失败则无记忆注入，不影响功能）
    let memoryContext = null;
    try {
      memoryContext = await optmemWake();
    } catch (e) {
      console.warn('[Main] OptMem wake 失败（不影响功能）:', e.message);
    }

    const result = pipeline.build({
      ...ctx,
      agentSystemPrompt,
      activeAgent,
      memoryContext,
      businessCatalog: BUSINESS_PROMPT_CATALOG,
      skills: (loadAllSkills() || []).map(s => s.name),
      activeSkillIds: ctx.agentId ? (findPresetAgent(ctx.agentId)?.skillIds || []) : (ctx.activeSkillIds || []),
      customModels: getCustomModels(),
    });
    return {
      systemPrompt: result.systemPrompt,
      nodeCount: result.nodes.length,
      nodes: result.nodes.map(n => ({ id: n.id, priority: n.priority, reason: n.reason })),
      activeAgent,
    };
  });

  // agents:list — 返回预设 Agent 列表
  ipcMain.handle('agents:list', async () => {
    return PRESET_AGENTS.map(a => ({
      id: a.id, name: a.name, icon: a.icon,
      description: a.description, skillIds: a.skillIds,
    }));
  });

  // ─── 认证 IPC ───
  ipcMain.handle('auth:getSession', async () => qccAuth.getSessionSummary());
  ipcMain.handle('auth:sendCode', async (_evt, phone, intl, captcha) => qccAuth.sendCode(phone, intl, captcha));
  ipcMain.handle('auth:login', async (_evt, phone, code, intl) => qccAuth.login(phone, code, intl));
  ipcMain.handle('auth:logout', async () => qccAuth.logout());
  ipcMain.handle('auth:setToken', async (_evt, token, baseUrl) => qccAuth.setTokenManually(token, baseUrl));
  ipcMain.handle('auth:verify', async () => qccAuth.verifySession());
  ipcMain.handle('auth:bindInviteCode', async (_evt, code) => qccAuth.bindInviteCode(code));
  // 扫码登录
  ipcMain.handle('auth:generateQrLogin', async () => qccAuth.generateQrLoginSession());
  ipcMain.handle('auth:getQrLoginStatus', async (_evt, sid) => qccAuth.getQrLoginStatus(sid));
  ipcMain.handle('auth:getCreditsInfo', async () => {
    try { return await qccAuth.getCreditsInfo(); }
    catch (err) { console.error('[Main] getCreditsInfo failed:', err.message); return null; }
  });
  ipcMain.handle('auth:setAutoRefresh', async (_evt, enabled) => qccAuth.setAutoRefresh(enabled));

  // ─── Token 自动刷新 IPC ───
  // auth:refresh 和 auth:ensureValid 已禁用 — 消费 refreshToken 会踢掉同一账号的其他客户端
  // ipcMain.handle('auth:refresh', async () => refreshSession());
  // ipcMain.handle('auth:ensureValid', async () => ensureValidToken());

  // ─── 会话管理 IPC ───
  ipcMain.handle('session:list', async () => sessionStore.listSessions());
  ipcMain.handle('session:create', async (_evt, title, agentId) => sessionStore.createSession(title, agentId));
  ipcMain.handle('session:delete', async (_evt, id) => sessionStore.deleteSession(id));
  ipcMain.handle('session:getMessages', async (_evt, id) => sessionStore.getSessionMessages(id));
  ipcMain.handle('session:rename', async (_evt, id, title) => sessionStore.updateSession(id, { title }));
  ipcMain.handle('session:updateTokenUsage', async (_evt, id, tokenUsage) => sessionStore.updateSession(id, { tokenUsage }));
  ipcMain.handle('session:clearAll', async () => sessionStore.clearAllSessions());
  ipcMain.handle('session:appendMessage', async (_evt, id, message) => sessionStore.appendMessage(id, message));
  ipcMain.handle('session:search', async (_evt, query) => sessionStore.searchSessions(query));

  // custom-models:get
  ipcMain.handle('custom-models:get', async () => {
    return loadCustomModels();
  });

  // custom-models:newId — 生成稳定唯一 ID（渲染层新增模型时调用）
  ipcMain.handle('custom-models:newId', async () => {
    return newModelId();
  });

  // custom-models:save
  ipcMain.handle('custom-models:save', async (_evt, models) => {
    // 校验：必须是数组
    if (!Array.isArray(models)) {
      return false;
    }
    saveCustomModels(models);
    return true;
  });

  // custom-models:delete
  ipcMain.handle('custom-models:delete', async (_evt, index) => {
    const models = loadCustomModels();
    // 安全：校验 index 为有效非负整数且在数组范围内
    const idx = Number(index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= models.length) {
      return false;
    }
    models.splice(idx, 1);
    saveCustomModels(models);
    return true;
  });

  // store:get/set/remove — KV（小配置持久化到磁盘；msgs_* 等大对象仅内存，消息已走 jsonl）
  const STORE_FILE = path.join(os.homedir(), '.BizOwl', 'store.json');
  const store = new Map();
  try {
    if (fs.existsSync(STORE_FILE)) {
      const obj = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
      if (obj && typeof obj === 'object') for (const k of Object.keys(obj)) store.set(k, obj[k]);
    }
  } catch (e) { console.warn('[store] 加载失败:', e.message); }
  function persistStore() {
    try {
      const obj = {};
      for (const [k, v] of store) if (typeof k === 'string' && !k.startsWith('msgs_')) obj[k] = v;
      const dir = path.dirname(STORE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(STORE_FILE, JSON.stringify(obj, null, 2), 'utf8');
    } catch (e) { console.warn('[store] persist 失败:', e.message); }
  }
  ipcMain.handle('store:get', async (_e, key) => store.get(key));
  ipcMain.handle('store:set', async (_e, key, value) => { store.set(key, value); persistStore(); });
  ipcMain.handle('store:remove', async (_e, key) => { store.delete(key); persistStore(); });

  // 读取设置页的超时配置（秒）→ 转毫秒；缺失/非法回落 agent-loop 内置默认
  function getTimeoutConfigMs() {
    const saved = store.get('timeoutConfig');
    const defaults = DEFAULT_TIMEOUT_MS || {};
    const fields = ['firstByteNormal', 'firstByteResearch', 'streamIdleNormal', 'streamIdleResearch'];
    const out = {};
    for (const f of fields) {
      const v = Number(saved && saved[f]);
      out[f] = (Number.isFinite(v) && v > 0) ? v * 1000 : defaults[f];
    }
    return out;
  }

  // session:deleteMessage — 删除单条聊天记录（同时清理 jsonl 文件 + 内存 store 缓存 msgs_<sid>）
  ipcMain.handle('session:deleteMessage', async (_evt, sessionId, messageId) => {
    if (!sessionId || !messageId) return false;
    try {
      sessionStore.deleteMessage(sessionId, messageId);
    } catch (err) {
      console.warn('[session:deleteMessage] jsonl 删除失败:', err.message);
    }
    // 同步清理内存 store 缓存（msgs_<sid> 仅存内存、不落盘 store.json）
    const key = `msgs_${sessionId}`;
    const arr = store.get(key);
    if (Array.isArray(arr)) {
      store.set(key, arr.filter((m) => m && m.id !== messageId));
    }
    return true;
  });

  // app:getVersion
  ipcMain.handle('app:getVersion', async () => {
    const pkg = require('../package.json');
    return pkg.version;
  });

  // app:getSystemLocale
  ipcMain.handle('app:getSystemLocale', async () => {
    return electron.app.getLocale();
  });

  // app:checkUpdate — 检测 GitHub Releases 最新版本（匿名调用 GitHub API，无需 token）
  ipcMain.handle('app:checkUpdate', async () => {
    const pkg = require('../package.json');
    const currentVersion = pkg.version; // 如 "1.0.0"
    try {
      const data = await fetchJson('https://api.github.com/repos/Samge0/BizOwl/releases/latest', {
        headers: {
          'User-Agent': 'BizOwl-Update-Checker',
          'Accept': 'application/vnd.github+json',
        },
        timeout: 8000,
      });
      // tag_name 形如 "v1.0.1"，去掉前缀 v 做 semver 比较
      const tag = (data.tag_name || '').replace(/^v/i, '').trim();
      if (!tag) {
        return { hasUpdate: false, currentVersion, error: 'no tag_name in response' };
      }
      const hasUpdate = compareVersions(tag, currentVersion) > 0;
      return {
        hasUpdate,
        latestVersion: tag,
        currentVersion,
        releaseUrl: data.html_url || 'https://github.com/Samge0/BizOwl/releases',
      };
    } catch (err) {
      // 404 = 尚无 release（私有仓库或从未发版），静默忽略
      console.warn('[checkUpdate] 检测失败（不影响功能）:', err.message);
      return { hasUpdate: false, currentVersion, error: err.message };
    }
  });

  // window 控制
  const WindowIpcChannel = {
    Minimize: 'window-minimize',
    ToggleMaximize: 'window-maximize',
    Close: 'window-close',
    IsMaximized: 'window:isMaximized',
    GetState: 'window:getState',
  };
  ipcMain.handle(WindowIpcChannel.IsMaximized, async () => mainWindow?.isMaximized() || false);
  ipcMain.handle(WindowIpcChannel.GetState, async () => ({
    maximized: mainWindow?.isMaximized() || false,
    minimized: false,
    fullscreen: false,
  }));
  ipcMain.on(WindowIpcChannel.Minimize, () => mainWindow?.minimize());
  ipcMain.on(WindowIpcChannel.ToggleMaximize, () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  // 关闭按钮
  // ipcMain.on(WindowIpcChannel.Close, () => electron.app.quit());
  ipcMain.on(WindowIpcChannel.Close, () => mainWindow?.close());

  // ─── chat:send — Agent Loop 聊天 IPC ───
  // 渲染进程调用 chatSend({ model, messages, ... }) 返回 { requestId }，
  // 然后通过 onChatData / onChatTool / onChatDone / onChatError 监听事件。
  // activeRequests: Map<requestId, { controller, sessionId, onData, onProgress }>
  // 关键：agent loop 继续在后台跑，不受 UI 会话切换影响。
  // webContents.send 的目标始终是 mainWindow（全局），不随会话切换改变。
  const activeRequests = new Map();

  ipcMain.handle('chat:send', async (_evt, options) => {
    const {
      modelId, baseUrl, apiKey, messages,
      enableTools = true,
      sessionId = null,
    } = options || {};

    if (!modelId || !baseUrl || !apiKey) {
      throw new Error('模型配置不完整：需要 modelId, baseUrl, apiKey');
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('messages 不能为空');
    }

    const requestId = randomUUID();
    const controller = new AbortController();

    // 发送事件到渲染进程的辅助函数（目标始终是全局 mainWindow，不随会话切换改变）
    const send = (channel, data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(`chat:${requestId}:${channel}`, data);
      }
    };
    const onProgress = (event) => {
      console.log(`[Chat:${requestId}] 工具事件:`, event.type, event.tool);
      send('tool', event);

      // 产物检测：导出类工具成功（report_export / document_export）→ 注册产物 + 通知 renderer
      // 工具返回的是文本（含 "文件路径: xxx"），从文本中提取
      if (event.type === 'tool_end' && event.result && typeof event.result === 'string') {
        const r = event.result;
        if (r.includes('文件路径:') && !r.startsWith('[error]')) {
          const filePathMatch = r.match(/文件路径:\s*(.+)/);
          const filePath = filePathMatch ? filePathMatch[1].trim() : '';
          if (filePath && fs.existsSync(filePath)) {
            const fmtMatch = r.match(/格式:\s*([a-z]+)/i);
            const titleMatch = r.match(/标题:\s*(.+)/);
            let artifact = null;
            try {
              artifact = registerArtifact({
                kind: fmtMatch ? fmtMatch[1].toLowerCase() : 'file',
                title: titleMatch ? titleMatch[1].trim() : path.basename(filePath),
                filePath,
                format: fmtMatch ? fmtMatch[1].toLowerCase() : 'file',
                size: fs.statSync(filePath).size,
                createdAt: Date.now(),
                source: event.tool,
              });
            } catch (err) {
              console.warn(`[Chat:${requestId}] 产物注册失败:`, err.message);
            }
            if (artifact) {
              console.log(`[Chat:${requestId}] 产物已注册: ${artifact.title} (${artifact.format})`);
              send('artifact', artifact);
            }
          }
        }
      }
    };
    const onData = (delta) => {
      send('data', delta);
    };

    // Token 用量回调：agent loop 每轮迭代后汇报累计 token 消耗
    const onUsage = (usage) => {
      send('usage', usage);
    };

    // 记录活跃请求（含 sessionId 供 UI 查询"进行中"状态）
    activeRequests.set(requestId, { controller, sessionId, onData, onProgress });

    // 异步启动 agent loop（不阻塞 IPC 返回）
    (async () => {
      try {
        // 获取 QCC token（如果有数据源登录态，动态加入数据工具）
        const authState = qccAuth.loadAuthState();
        const qccToken = authState.accessToken || null;
        if (qccToken) {
          console.log(`[Chat:${requestId}] 检测到数据源 token，数据工具已启用`);
        }

        console.log(`[Chat:${requestId}] Agent Loop 启动 (session=${sessionId}, tools=${enableTools}, qcc=${!!qccToken})`);

        const finalText = await runAgentLoop({
          modelId, baseUrl, apiKey, messages,
          enableTools,
          qccToken, // 传递数据源 token
          timeoutConfig: getTimeoutConfigMs(), // 设置页超时配置（毫秒）
          signal: controller.signal,
          onProgress,
          onData,
          onUsage,
        });

        console.log(`[Chat:${requestId}] Agent Loop 完成, 回复长度: ${finalText?.length || 0}`);
        send('done');

        // 会话完成后异步提取记忆（不阻塞用户——fire and forget）
        // 从 workingMessages 中取用户消息+助手回复，判断是否值得写入 OptMem
        if (optmemExtractAndNote && messages.length > 0) {
          console.log(`[Chat:${requestId}] 异步提取记忆...`);
          optmemExtractAndNote({
            modelId, baseUrl, apiKey,
            messages: [...messages, { role: 'assistant', content: finalText }],
          }).then(() => {
            console.log(`[Chat:${requestId}] 记忆提取完成`);
          }).catch((e) => {
            console.warn(`[Chat:${requestId}] 记忆提取失败（不影响主流程）:`, e?.message || e);
          });
        }
      } catch (err) {
        // 用户主动取消（chat:cancel 已发送 done）→ 不再发送 error
        if (controller.signal.aborted || err.message === 'ABORTED') {
          console.log(`[Chat:${requestId}] Agent Loop 已取消`);
        } else {
          console.error(`[Chat:${requestId}] Agent Loop 错误:`, err.message);
          send('error', { message: err.message });
        }
      } finally {
        activeRequests.delete(requestId);
      }
    })();

    return { requestId };
  });

  // chat:cancel — 取消正在进行的请求
  ipcMain.handle('chat:cancel', async (_evt, requestId) => {
    const entry = activeRequests.get(requestId);
    if (entry) {
      entry.controller.abort();
      activeRequests.delete(requestId);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(`chat:${requestId}:done`);
      }
    }
    return true;
  });

  // chat:getActiveRequests — 返回当前所有活跃请求的 { requestId, sessionId }
  // 渲染进程切换会话时可调用，以在 UI 上显示"进行中"标记
  ipcMain.handle('chat:getActiveRequests', async () => {
    const out = [];
    for (const [requestId, entry] of activeRequests) {
      out.push({ requestId, sessionId: entry.sessionId });
    }
    return out;
  });

  // ─── 企业搜索（@提及用）IPC ───
  ipcMain.handle('qcc:searchCompanies', async (_evt, keyword) => {
    const authState = qccAuth.loadAuthState();
    const token = authState.accessToken;
    if (!token) {
      return { success: false, error: '未检测到数据源登录态，请先登录' };
    }
    try {
      const companies = await searchCompanies(token, keyword);
      return { success: true, companies };
    } catch (err) {
      console.error('[QCC:searchCompanies] 失败:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ─── 文档导出 IPC ───
  ipcMain.handle('export:document', async (_evt, { content, format, title }) => {
    if (!content) {
      return { success: false, error: 'content 不能为空' };
    }
    try {
      // 弹出保存对话框让用户选择保存位置
      const dialog = electron.dialog;
      if (!dialog) {
        // 无对话框环境（node 模式），直接保存到默认目录
        const result = await exportDocument({ content, format, title });
        return result;
      }

      const extMap = { md: 'md', pdf: 'pdf', docx: 'docx', xlsx: 'xlsx' };
      const ext = extMap[format] || 'md';
      const safeName = (title || 'export')
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 60);

      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: `导出文档 (${format.toUpperCase()})`,
        defaultPath: `${safeName}.${ext}`,
        filters: [
          { name: format.toUpperCase() + ' 文件', extensions: [ext] },
          { name: '所有文件', extensions: ['*'] },
        ],
      });

      if (canceled || !filePath) {
        return { success: false, canceled: true };
      }

      // 导出到默认目录（用户选择的路径用 fs 复制过去）
      const result = await exportDocument({ content, format, title, electronWindow: mainWindow });
      if (result.success && result.filePath && result.filePath !== filePath) {
        // 复制到用户选择的路径
        const fs = require('node:fs');
        fs.copyFileSync(result.filePath, filePath);
        return { success: true, filePath, originalPath: result.filePath, format: result.format };
      }
      return result;
    } catch (err) {
      console.error('[export:document] 失败:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ─── 产物（Artifacts）IPC — 研究报告/导出文件通用产物机制 ───
  ipcMain.handle('artifacts:list', async () => {
    try {
      return listArtifacts ? listArtifacts() : [];
    } catch (err) {
      console.error('[artifacts:list] 失败:', err.message);
      return [];
    }
  });

  // 在系统默认应用中打开产物（浏览器/PDF 阅读器）
  ipcMain.handle('artifacts:open', async (_evt, artifact) => {
    try {
      const filePath = artifact && (artifact.filePath || artifact.path);
      if (!filePath) return { success: false, error: '缺少文件路径' };
      // 安全：仅允许打开应用数据目录（~/.BizOwl）下的产物，防止渲染层被入侵后启动任意程序
      const allowedRoot = path.join(os.homedir(), '.BizOwl');
      const resolved = path.resolve(filePath);
      if (resolved !== allowedRoot && !resolved.startsWith(allowedRoot + path.sep)) {
        console.warn('[artifacts:open] 拒绝打开应用数据目录外的路径:', resolved);
        return { success: false, error: '出于安全限制，仅可打开应用生成的文件' };
      }
      if (!fs.existsSync(filePath)) return { success: false, error: '文件不存在（可能已被移动或删除）' };
      if (electron.shell) {
        await electron.shell.openPath(resolved); // openPath 比 openExternal('file://') 更安全
        return { success: true };
      }
      return { success: false, error: 'shell 不可用' };
    } catch (err) {
      console.error('[artifacts:open] 失败:', err.message);
      return { success: false, error: err.message };
    }
  });

  // ─── 调试 IPC ───
  ipcMain.handle('debug:eval', async (_evt, jsCode) => {
    if (!mainWindow || mainWindow.isDestroyed()) return { error: 'window destroyed' };
    try {
      const result = await mainWindow.webContents.executeJavaScript(jsCode);
      return { result };
    } catch (err) {
      return { error: err.message };
    }
  });

  console.log('[Main] 核心 IPC handler 注册完成');

  // ─── 日志 IPC ───
  const { dialog } = require('electron');

  // 日志：导出（弹出保存对话框）
  ipcMain.handle('logs:export', async () => {
    try {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: '导出日志',
        defaultPath: `BizOwl-logs-${new Date().toISOString().slice(0, 10)}.txt`,
        filters: [{ name: 'Text', extensions: ['txt', 'log'] }],
      });
      if (result.canceled || !result.filePath) return { success: false, canceled: true };
      const { exportLogsToFile } = await import('../src/utils/logger.js');
      const r = exportLogsToFile(result.filePath);
      log.info('日志导出', r);
      return { success: true, ...r };
    } catch (err) {
      log.error('日志导出失败', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  // 日志：获取最近日志（不弹对话框）
  ipcMain.handle('logs:get', async (_evt, maxLines = 200) => {
    const { exportLogs } = await import('../src/utils/logger.js');
    return exportLogs(maxLines);
  });

  // 日志：写入（允许 renderer 写日志到文件）
  ipcMain.handle('logs:write', async (_evt, level, tag, message) => {
    const { createLogger } = await import('../src/utils/logger.js');
    const rendererLog = createLogger(tag || 'renderer');
    // 安全：level 白名单，防止原型方法调用
    const VALID_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
    if (VALID_LEVELS.has(level)) {
      rendererLog[level](message);
    }
    return true;
  });

  // ─── 外部链接 IPC ───
  ipcMain.handle('shell:openExternal', async (_evt, url) => {
    const { shell } = electron;
    if (!shell || !url) return;
    // 安全：仅允许 http/https 协议，阻止 file://, javascript:, smb:// 等危险协议
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        console.warn('[shell:openExternal] 拒绝非 http(s) 协议:', parsed.protocol);
        return;
      }
    } catch {
      console.warn('[shell:openExternal] 无效 URL:', url);
      return;
    }
    await shell.openExternal(url);
  });

  // ─── 记忆系统 IPC（OptMem） ───
  ipcMain.handle('memory:wake', async () => {
    try { return await optmemWake(); } catch (e) { console.warn('[memory:wake]', e.message); return null; }
  });
  ipcMain.handle('memory:note', async (_evt, text) => {
    try { return await optmemNote(text); } catch (e) { console.warn('[memory:note]', e.message); return false; }
  });
  ipcMain.handle('memory:recall', async (_evt, query) => {
    try { return await optmemRecall(query); } catch (e) { return { text: e.message, hits: [] }; }
  });
  ipcMain.handle('memory:getStats', async () => {
    try { return await optmemGetStats(); } catch (e) { return { totalMemories: 0, error: e.message }; }
  });
  ipcMain.handle('memory:getAll', async () => {
    try { return await optmemGetAll(); } catch (e) { return { memories: [], total: 0 }; }
  });
  ipcMain.handle('memory:deleteMany', async (_evt, ids) => {
    try {
      const result = await optmemDeleteMany(ids);
      console.log(`[OptMem] 批量删除: ${result.deleted} 条, 剩余 ${result.remaining} 条`);
      return { ok: true, deleted: result.deleted, remaining: result.remaining };
    } catch (e) {
      console.error('[OptMem] 批量删除失败:', e.message);
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('memory:getUserMd', async () => {
    try { return await getUserMd(); } catch (e) { return ''; }
  });
  ipcMain.handle('memory:setUserMd', async (_evt, content) => {
    try { return await setUserMd(content); } catch (e) { return false; }
  });
}

// ─── Smoke Test ───
async function smokeTest() {
  console.log('[SmokeTest] ─── 开始 ───');
  await loadModules();
  console.log('[SmokeTest] ✅ 模块加载');

  const skills = loadAllSkills();
  console.log(`[SmokeTest] ✅ Skill 加载: ${skills.length} 个`);

  const pipeline = createDefaultPipeline({ enableCommercialWall: false });
  const result = pipeline.build({
    soul: '[SmokeTest]',
    identity: '[SmokeTest]',
    businessCatalog: BUSINESS_PROMPT_CATALOG,
    skills: skills.map(s => s.name),
  });
  console.log(`[SmokeTest] ✅ Prompt 构建: ${result.nodes.length} 节点`);

  const models = loadCustomModels();
  console.log(`[SmokeTest] ✅ 自定义模型: ${models.length} 个`);

  console.log('[SmokeTest] ─── 全部通过 ───\n');
  process.exit(0);
}

// ─── 入口 ───
if (isElectron) {
  const { app } = electron;
  app.whenReady().then(async () => {
    await loadModules();
    registerIpcHandlers();
    startAllSkillServices(); // 启动 web-search bridge 等服务
    createWindow();
    // 不在启动时消费 refreshToken（会踢掉同一账号的其他客户端登录）
    // 用户通过 Token 验证来确认 token 是否有效，过期则提示更新
    app.on('activate', () => {
      // dock 图标点击：优先显示隐藏的窗口（保留状态），否则新建
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      } else {
        // 窗口已被 window-all-closed 销毁，需要重新启动 skill 服务
        startAllSkillServices();
        createWindow();
      }
    });
    // Cmd+Q / 真正退出：置标志，让窗口 'close' 不再拦截为 hide
    app.on('before-quit', () => { isQuitting = true; });
  });
  app.on('window-all-closed', () => {
    // 清理所有 skill 服务
    for (const [name, { proc }] of skillServices) {
      try { proc.kill(); } catch {}
    }
    skillServices.clear();
    if (process.platform !== 'darwin') app.quit();
  });
} else {
  if (require.main === module) {
    smokeTest().catch(err => {
      console.error('[SmokeTest] ❌ 失败:', err);
      process.exit(1);
    });
  } else {
    module.exports = { loadModules, smokeTest };
  }
}
