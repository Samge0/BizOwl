// preload.js — Electron 预加载脚本
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clawAPI', {
  // Skills
  listSkills: () => ipcRenderer.invoke('skills:list'),
  exportSkill: (skillName) => ipcRenderer.invoke('skills:export', skillName),
  importSkill: () => ipcRenderer.invoke('skills:import'),
  deleteSkill: (skillName) => ipcRenderer.invoke('skills:delete', skillName),

  // Prompt
  buildPrompt: (ctx) => ipcRenderer.invoke('prompt:build', ctx),

  // Preset Agents
  listAgents: () => ipcRenderer.invoke('agents:list'),

  // Auth (数据源认证)
  authGetSession: () => ipcRenderer.invoke('auth:getSession'),
  authSendCode: (phone, intl, captcha) => ipcRenderer.invoke('auth:sendCode', phone, intl, captcha),
  authLogin: (phone, code, intl) => ipcRenderer.invoke('auth:login', phone, code, intl),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  authSetToken: (token, baseUrl) => ipcRenderer.invoke('auth:setToken', token, baseUrl),
  authVerify: () => ipcRenderer.invoke('auth:verify'),
  authBindInviteCode: (code) => ipcRenderer.invoke('auth:bindInviteCode', code),
  // 扫码登录
  authGenerateQrLogin: () => ipcRenderer.invoke('auth:generateQrLogin'),
  authGetQrLoginStatus: (sid) => ipcRenderer.invoke('auth:getQrLoginStatus', sid),
  authGetCreditsInfo: () => ipcRenderer.invoke('auth:getCreditsInfo'),
  authSetAutoRefresh: (enabled) => ipcRenderer.invoke('auth:setAutoRefresh', enabled),
  // authRefresh / authEnsureValid 已禁用 — 出于安全考虑不自动刷新 Token

  // Sessions (对话记录)
  sessionList: () => ipcRenderer.invoke('session:list'),
  sessionCreate: (title, agentId) => ipcRenderer.invoke('session:create', title, agentId),
  sessionDelete: (id) => ipcRenderer.invoke('session:delete', id),
  sessionGetMessages: (id) => ipcRenderer.invoke('session:getMessages', id),
  sessionRename: (id, title) => ipcRenderer.invoke('session:rename', id, title),
  sessionUpdateTokenUsage: (id, tokenUsage) => ipcRenderer.invoke('session:updateTokenUsage', id, tokenUsage),
  sessionClearAll: () => ipcRenderer.invoke('session:clearAll'),
  sessionAppendMessage: (id, message) => ipcRenderer.invoke('session:appendMessage', id, message),
  sessionDeleteMessage: (id, messageId) => ipcRenderer.invoke('session:deleteMessage', id, messageId),
  sessionSearch: (query) => ipcRenderer.invoke('session:search', query),
  readAsset: (name) => ipcRenderer.invoke('assets:read', name),
  
  // Custom Models
  getCustomModels: () => ipcRenderer.invoke('custom-models:get'),
  saveCustomModels: (models) => ipcRenderer.invoke('custom-models:save', models),
  deleteCustomModel: (index) => ipcRenderer.invoke('custom-models:delete', index),
  newModelId: () => ipcRenderer.invoke('custom-models:newId'),
  
  // Store
  storeGet: (key) => ipcRenderer.invoke('store:get', key),
  storeSet: (key, value) => ipcRenderer.invoke('store:set', key, value),
  storeRemove: (key) => ipcRenderer.invoke('store:remove', key),
  
  // App
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getSystemLocale: () => ipcRenderer.invoke('app:getSystemLocale'),
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  
  // Window
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  getState: () => ipcRenderer.invoke('window:getState'),
  minimize: () => ipcRenderer.send('window-minimize'),
  toggleMaximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // Chat — 流式聊天 + Agent 工具调用
  // chatSend 返回 { requestId }，渲染进程通过以下事件监听：
  //   onChatData  — 流式文本片段
  //   onChatTool  — 工具执行进度（tool_start/tool_end）
  //   onChatDone  — 完成
  //   onChatError — 错误
  chatSend: (options) => ipcRenderer.invoke('chat:send', options),
  chatCancel: (requestId) => ipcRenderer.invoke('chat:cancel', requestId),
  getActiveRequests: () => ipcRenderer.invoke('chat:getActiveRequests'),
  onChatData: (requestId, callback) => {
    const channel = `chat:${requestId}:data`;
    const handler = (_event, delta) => callback(delta);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  onChatTool: (requestId, callback) => {
    const channel = `chat:${requestId}:tool`;
    const handler = (_event, info) => callback(info);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  onChatDone: (requestId, callback) => {
    const channel = `chat:${requestId}:done`;
    const handler = () => callback();
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  onChatError: (requestId, callback) => {
    const channel = `chat:${requestId}:error`;
    const handler = (_event, error) => callback(error);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  // Token 用量事件：agent loop 每轮迭代后推送累计 token 消耗
  onChatUsage: (requestId, callback) => {
    const channel = `chat:${requestId}:usage`;
    const handler = (_event, usage) => callback(usage);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  // 产物事件：导出工具成功 → 主进程注册产物并推送（研究报告 PDF / 导出文件通用）
  onChatArtifact: (requestId, callback) => {
    const channel = `chat:${requestId}:artifact`;
    const handler = (_event, artifact) => callback(artifact);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  // Artifacts（产物注册表 — 研究报告/导出文件）
  artifactsList: () => ipcRenderer.invoke('artifacts:list'),
  artifactsOpen: (artifact) => ipcRenderer.invoke('artifacts:open', artifact),

  // Logs (统一日志)
  exportLogs: () => ipcRenderer.invoke('logs:export'),
  getLogs: (maxLines) => ipcRenderer.invoke('logs:get', maxLines),
  writeLog: (level, tag, message) => ipcRenderer.invoke('logs:write', level, tag, message),

  // 企业搜索（@提及）
  searchCompanies: (keyword) => ipcRenderer.invoke('qcc:searchCompanies', keyword),

  // 文档导出
  exportDocument: ({ content, format, title }) => ipcRenderer.invoke('export:document', { content, format, title }),

  // 记忆系统 (OptMem)
  memoryWake: () => ipcRenderer.invoke('memory:wake'),
  memoryNote: (text) => ipcRenderer.invoke('memory:note', text),
  memoryRecall: (query) => ipcRenderer.invoke('memory:recall', query),
  memoryGetStats: () => ipcRenderer.invoke('memory:getStats'),
  memoryGetAll: () => ipcRenderer.invoke('memory:getAll'),
  memoryDeleteMany: (ids) => ipcRenderer.invoke('memory:deleteMany', ids),
  memoryGetUserMd: () => ipcRenderer.invoke('memory:getUserMd'),
  memorySetUserMd: (content) => ipcRenderer.invoke('memory:setUserMd', content),

  // 在默认浏览器中打开外部链接
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // 调试：在渲染进程执行 JS（临时）
  debugEval: (jsCode) => ipcRenderer.invoke('debug:eval', jsCode),
});
