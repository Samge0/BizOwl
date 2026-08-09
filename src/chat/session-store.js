/**
 * session-store.js — 对话记录本地持久化
 *
 * 存储 ~/.BizOwl/sessions/
 *   ├── index.json          — 会话列表 [{ id, title, createdAt, updatedAt, agentId }]
 *   └── {sessionId}.jsonl   — 每条消息一行 JSON
 *
 * 消息格式: { id, role, content, timestamp, toolCalls?, toolResults? }
 */

import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

const CONFIG_DIR = path.join(homedir(), '.BizOwl');
const SESSIONS_DIR = path.join(CONFIG_DIR, 'sessions');
const INDEX_FILE = path.join(SESSIONS_DIR, 'index.json');

function ensureDirs() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

/** 校验 sessionId 形如 UUID，防止 IPC 传入 ../ 路径穿越 */
function isValidSessionId(id) {
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/** 读取会话索引 */
export function listSessions() {
  ensureDirs();
  try {
    if (fs.existsSync(INDEX_FILE)) {
      const raw = fs.readFileSync(INDEX_FILE, 'utf8');
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data.sort((a, b) =>
        new Date(b.updatedAt) - new Date(a.updatedAt)
      ) : [];
    }
  } catch (err) {
    console.warn('[SessionStore] 读取索引失败:', err.message);
  }
  return [];
}

/** 保存会话索引（原子写：先写 .tmp 再 rename，避免崩溃导致索引截断、侧栏会话全部消失） */
function saveIndex(sessions) {
  ensureDirs();
  const tmp = INDEX_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(sessions, null, 2), 'utf8');
  fs.renameSync(tmp, INDEX_FILE);
}

/** 创建新会话 */
export function createSession(title = '新对话', agentId = null) {
  ensureDirs();
  const id = randomUUID();
  const now = new Date().toISOString();
  const session = { id, title, createdAt: now, updatedAt: now, agentId };
  const sessions = listSessions();
  sessions.push(session);
  saveIndex(sessions);
  // 创建空 jsonl 文件
  fs.writeFileSync(path.join(SESSIONS_DIR, `${id}.jsonl`), '', 'utf8');
  console.log(`[SessionStore] 创建会话: ${id}`);
  return session;
}

/** 更新会话元信息 */
export function updateSession(id, updates) {
  if (!isValidSessionId(id)) return null;
  const sessions = listSessions();
  const idx = sessions.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  sessions[idx] = { ...sessions[idx], ...updates, updatedAt: new Date().toISOString() };
  saveIndex(sessions);
  return sessions[idx];
}

/** 删除会话 */
export function deleteSession(id) {
  if (!isValidSessionId(id)) return false;
  const sessions = listSessions().filter((s) => s.id !== id);
  saveIndex(sessions);
  const filePath = path.join(SESSIONS_DIR, `${id}.jsonl`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  console.log(`[SessionStore] 删除会话: ${id}`);
  return true;
}

/** 追加消息到会话 */
export function appendMessage(sessionId, message) {
  if (!isValidSessionId(sessionId)) return false;
  ensureDirs();
  const filePath = path.join(SESSIONS_DIR, `${sessionId}.jsonl`);
  const entry = JSON.stringify({
    id: message.id || randomUUID(),
    role: message.role,
    content: message.content,
    timestamp: message.timestamp || new Date().toISOString(),
    ...(message.toolCalls ? { toolCalls: message.toolCalls } : {}),
    ...(message.toolResults ? { toolResults: message.toolResults } : {}),
    ...(message.agentId ? { agentId: message.agentId } : {}),
    ...(message.attachments ? { attachments: message.attachments } : {}),
    ...(message.fileAttachments ? { fileAttachments: message.fileAttachments } : {}),
    // 产物消息（研究报告 PDF / 导出文件卡片）— 必须保留 artifact 对象，否则重载后卡片丢失
    ...(message.artifact ? { artifact: message.artifact } : {}),
  });
  fs.appendFileSync(filePath, entry + '\n', 'utf8');

  // 更新索引时间戳
  const sessions = listSessions();
  const idx = sessions.findIndex((s) => s.id === sessionId);
  if (idx !== -1) {
    sessions[idx].updatedAt = new Date().toISOString();
    // 如果是第一条用户消息，更新标题
    if (message.role === 'user' && (sessions[idx].title === '新对话' || !sessions[idx].title)) {
      const contentStr = typeof message.content === 'string' ? message.content : '[多模态消息]';
      sessions[idx].title = contentStr.slice(0, 30) + (contentStr.length > 30 ? '...' : '');
    }
    saveIndex(sessions);
  }
  return true;
}

/** 删除会话中的单条消息（按 message.id 匹配），原子重写 jsonl 文件 */
export function deleteMessage(sessionId, messageId) {
  if (!isValidSessionId(sessionId) || !messageId) return false;
  const filePath = path.join(SESSIONS_DIR, `${sessionId}.jsonl`);
  if (!fs.existsSync(filePath)) return false;
  const messages = getSessionMessages(sessionId);
  const filtered = messages.filter((m) => !m || m.id !== messageId);
  // 未命中任何消息则不重写（避免无谓 IO）
  if (filtered.length === messages.length) return false;
  // 原子重写：先写 .tmp 再 rename（与 saveIndex 同策略，避免崩溃截断）
  const tmp = filePath + '.tmp';
  const data = filtered.map((m) => JSON.stringify(m)).join('\n') + (filtered.length > 0 ? '\n' : '');
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, filePath);
  // 更新索引时间戳
  const sessions = listSessions();
  const idx = sessions.findIndex((s) => s.id === sessionId);
  if (idx !== -1) {
    sessions[idx].updatedAt = new Date().toISOString();
    saveIndex(sessions);
  }
  console.log(`[SessionStore] 删除消息: ${messageId} (session=${sessionId})`);
  return true;
}

/** 读取会话消息（逐行解析：单行损坏只跳过该行，不丢弃整个会话历史） */
export function getSessionMessages(sessionId) {
  if (!isValidSessionId(sessionId)) return [];
  const filePath = path.join(SESSIONS_DIR, `${sessionId}.jsonl`);
  if (!fs.existsSync(filePath)) return [];
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.warn('[SessionStore] 读取消息文件失败:', err.message);
    return [];
  }
  const messages = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      messages.push(JSON.parse(trimmed));
    } catch (err) {
      // 跳过损坏的单行（如崩溃时 append 写了一半），不丢弃整个会话
      console.warn('[SessionStore] 跳过损坏的消息行:', err.message);
    }
  }
  return messages;
}

/**
 * 搜索会话历史（标题 + 消息内容全文匹配）
 * @param {string} query - 搜索关键词
 * @returns {Array<{id, title, snippet, updatedAt}>} 命中的会话（按更新时间倒序）
 */
export function searchSessions(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  ensureDirs();
  const sessions = listSessions();
  const results = [];
  for (const s of sessions) {
    // 标题命中
    const titleHit = (s.title || '').toLowerCase().includes(q);
    let snippet = '';
    if (titleHit) snippet = (s.title || '');

    // 内容命中：扫描 jsonl
    if (!titleHit) {
      const msgs = getSessionMessages(s.id);
      const hit = msgs.find((m) => {
        const c = (m && typeof m.content === 'string') ? m.content : '';
        return c.toLowerCase().includes(q);
      });
      if (!hit) continue;
      // 截取命中处附近片段
      const c = hit.content || '';
      const idx = c.toLowerCase().indexOf(q);
      const start = Math.max(0, idx - 20);
      snippet = (start > 0 ? '…' : '') + c.slice(start, start + 60) + (c.length > start + 60 ? '…' : '');
    }
    results.push({
      id: s.id,
      title: s.title || '新对话',
      snippet,
      updatedAt: s.updatedAt,
    });
  }
  return results.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

/** 清空所有会话 */
export function clearAllSessions() {
  const sessions = listSessions();
  for (const s of sessions) {
    const fp = path.join(SESSIONS_DIR, `${s.id}.jsonl`);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
  saveIndex([]);
  console.log('[SessionStore] 清空所有会话');
  return true;
}
