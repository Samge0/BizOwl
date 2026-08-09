/**
 * datasource-tools.js — 企业数据工具链
 *
 * 提供三个核心工具：
 *   knowledge_search — 知识搜索
 *   tool_search      — 工具检索
 *   execute_tool     — 工具执行
 *
 * 请求使用 Bearer Token 认证。
 */

import http from 'node:http';
import https from 'node:https';
import { URL, fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { refreshIfEnabled } from '../auth/datasource-auth.js';

const API_BASE = 'https://qclaw-api.qcc.com';
const VECTOR_SEARCH_URL = '/vector/pg-search';
const VECTOR_SEARCH_ANNS_FIELD = 'embedding';
const VECTOR_SEARCH_METRIC_TYPE = 'COSINE';
const SEARCH_RESULT_LIMIT = 8;
const TOOL_SEARCH_RESULT_LIMIT = 8;

// ─── HTTP 请求 ───

function postJson(url, headers, body, timeoutMs = 30000, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('ABORTED')); return; }
    const parsed = new URL(url);
    const transport = parsed.protocol === 'http:' ? http : https;
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);

    const req = transport.request(parsed, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Accept-Encoding': 'identity',
        ...headers,
      },
    }, (res) => {
      let data = '';
      const _dec = new TextDecoder('utf-8');
      res.on('data', (chunk) => { data += _dec.decode(chunk, { stream: true }); });
      res.on('end', () => {
        data += _dec.decode(); // flush
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 500)}`));
          return;
        }
        resolve({ status: res.statusCode, body: data });
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Request timeout'));
    });
    if (signal) signal.addEventListener('abort', () => req.destroy(new Error('ABORTED')), { once: true });
    req.write(bodyStr);
    req.end();
  });
}

/** 构建 session headers */
function sessionHeaders(token) {
  if (!token) return {};
  return {
    'Authorization': 'Bearer ' + token,
    'x-claw-session-id': token,
  };
}

// ─── 向量搜索（知识/工具共用）───

async function vectorSearch(token, query, topK = SEARCH_RESULT_LIMIT, searchNames, signal) {
  const headers = sessionHeaders(token);
  const body = {
    query,
    topK,
    annsField: VECTOR_SEARCH_ANNS_FIELD,
    metricType: VECTOR_SEARCH_METRIC_TYPE,
  };
  if (searchNames && searchNames.length > 0) {
    body.nameInput = searchNames.join(',');
  }

  const resp = await postJson(
    API_BASE + VECTOR_SEARCH_URL,
    headers,
    body,
    30000,
    signal
  );

  const envelope = JSON.parse(resp.body);
  if (envelope.code && envelope.code !== 200) {
    const msg = envelope.message || ('code ' + envelope.code);
    const err = new Error(`Vector search failed: ${msg}`);
    // 40102 = accessToken 过期；标记后让调用方给出"更新 Token"提示，而非误报"未找到工具"
    if (envelope.code === 40102 || /过期|expired|未登录|refresh|登录状态/i.test(msg)) {
      err.isTokenExpired = true;
    }
    throw err;
  }

  const data = envelope.data || {};
  const hits = Array.isArray(data.results) ? data.results : [];
  const nameResults = Array.isArray(data.nameResults) ? data.nameResults : [];

  return { hits, nameResults };
}

/** 把向量搜索的异常翻译成给 LLM/用户的可读结果（重点是区分 token 过期） */
export const QCC_TOKEN_EXPIRED_MSG = '数据源 accessToken 已过期或失效，请在「设置」中更新数据源 Token 后重试。';

/** 判断工具结果/错误是否为 token 失效（供 agent loop 阻断当前会话）。
 *  注意只匹配 token 专属措辞，避免误伤企业数据里的「执照已过期」等。 */
export function isQccTokenExpired(result) {
  const s = typeof result === 'string' ? result : (result && result.message) || '';
  return /accessToken\s*已过期|请使用\s*refreshToken|更新数据源\s*Token|登录状态.{0,6}失效|40102/i.test(s);
}

function vectorSearchErrorMsg(err) {
  if ((err && err.isTokenExpired) || isQccTokenExpired(err)) {
    return '[error] ' + QCC_TOKEN_EXPIRED_MSG;
  }
  return `[error] 企业知识/工具搜索失败: ${(err && err.message) || String(err)}`;
}

// ─── MCP 工具执行 ───

let requestIdCounter = 0;
function nextRequestId() { return ++requestIdCounter; }

async function callMcpTool(token, toolUrl, toolName, args, signal) {
  const fullUrl = toolUrl.startsWith('http') ? toolUrl : API_BASE + toolUrl;
  const headers = sessionHeaders(token);
  const payload = {
    jsonrpc: '2.0',
    id: nextRequestId(),
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  };

  const resp = await postJson(fullUrl, headers, payload, 60000, signal);
  const raw = resp.body;

  // 解析响应（可能是 JSON 或 SSE）
  let envelope;
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    envelope = JSON.parse(trimmed);
  } else {
    // SSE：按事件（空行分隔）拆分；每个事件内的多行 data: 用 \n 拼接为该事件的有效载荷。
    // 这样可正确处理「进度通知事件 + 最终结果事件」的多事件响应，而非把跨事件 data 行合并成非法 JSON。
    const events = trimmed.split(/\r?\n\r?\n/);
    const envelopes = [];
    for (const ev of events) {
      const data = ev.split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .filter(Boolean)
        .join('\n');
      if (!data) continue;
      try { envelopes.push(JSON.parse(data)); } catch { /* 跳过非 JSON 的通知事件 */ }
    }
    if (envelopes.length === 0) throw new Error(`Unexpected MCP response: ${trimmed.slice(0, 200)}`);
    // 取最后一个带 result/error 的 JSON-RPC 响应（跳过中间的进度通知）
    envelope = envelopes.filter((e) => e && (e.result || e.error)).pop() || envelopes[envelopes.length - 1];
  }

  if (envelope.error) {
    const errMsg = typeof envelope.error.message === 'string' ? envelope.error.message : `MCP error ${envelope.error.code || 'unknown'}`;
    throw new Error(`工具执行失败: ${errMsg}`);
  }

  // 提取文本内容
  const result = envelope.result || {};
  const content = Array.isArray(result.content) ? result.content : [];
  const textParts = content
    .filter(item => item && item.type === 'text' && typeof item.text === 'string')
    .map(item => item.text.trim())
    .filter(Boolean);

  return textParts.length > 0 ? textParts.join('\n\n') : JSON.stringify(result, null, 2);
}

// ─── 工具格式化 ───

function formatToolSearchResult(hits, nameResults = []) {
  const seen = new Set();
  const lines = [];

  const allResults = [...hits, ...nameResults];
  for (const hit of allResults) {
    const entity = hit.entity || hit;
    const name = entity.name || entity.rawToolName || '';
    if (!name || seen.has(name)) continue;
    seen.add(name);

    const label = entity.label || entity.text || '';
    const description = (entity.description || '').trim();
    const url = entity.url || '';
    const isHistory = entity.isHistory === true;

    lines.push(`### ${label || name}`);
    lines.push(`- **工具名**: ${name}`);
    lines.push(`- **URL**: ${url}`);
    if (isHistory) lines.push(`- **历史工具**: 是（需要 isHistory=true 参数）`);
    if (description) lines.push(`- **说明**: ${description.slice(0, 300)}`);

    // 解析参数 schema
    const paramsRaw = entity.parameters;
    if (paramsRaw) {
      try {
        const params = typeof paramsRaw === 'string' ? JSON.parse(paramsRaw) : paramsRaw;
        if (params && params.properties) {
          const required = Array.isArray(params.required) ? params.required : [];
          const propLines = [];
          for (const [key, val] of Object.entries(params.properties)) {
            const req = required.includes(key) ? ' (必填)' : '';
            const desc = (val.description || '').slice(0, 120);
            const type = val.type || 'any';
            propLines.push(`  - \`${key}\` (${type}${req}): ${desc}`);
          }
          if (propLines.length > 0) {
            lines.push(`- **参数**:`);
            lines.push(...propLines);
          }
        }
      } catch {}
    }
    lines.push('');
  }

  if (lines.length === 0) {
    return '未找到匹配的工具。建议更换关键词重试。';
  }
  return `找到 ${seen.size} 个匹配工具：\n\n${lines.join('\n')}`;
}

// ─── 企业搜索（@提及用，前端 IPC 调用）───

/**
 * 搜索企业名称列表（供前端 @提及 使用）
 * 调用企业搜索 POST /home/fast-ent-search（与 vectorSearch 的 /vector/pg-search 是不同端点）
 * 返回值是企业列表数组，与 vectorSearch 的 {hits, nameResults} 格式完全不同，勿混淆。
 * @param {string} token - 数据源 accessToken
 * @param {string} keyword - 搜索关键词（企业名）
 * @returns {Promise<Array<{name, keyNo, legalRep, operatingStatus, regCap}>>} 企业列表
 */
export async function searchCompanies(token, keyword, signal) {
  if (!token) throw new Error('未检测到数据源登录态，请先登录');
  if (!keyword || !keyword.trim()) return [];

  const body = { searchKey: keyword.trim() };

  // 企业搜索（开启「保持在线」时，40102 自动刷新 token 后重试一次）
  let envelope;
  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await postJson(API_BASE + '/home/fast-ent-search', sessionHeaders(token), body, 15000, signal);
    envelope = JSON.parse(resp.body);
    if (envelope.code === 40102 && attempt === 0) {
      const refreshed = await refreshIfEnabled();
      if (refreshed) { token = refreshed; continue; }
    }
    break;
  }
  if (envelope.code && envelope.code !== 200) {
    throw new Error(`企业搜索失败: ${envelope.message || 'code ' + envelope.code}`);
  }

  // 解析嵌套的 result 结构（result.result.list）
  const r1 = envelope.result || envelope;
  const r2 = (r1 && r1.result) || r1;
  const list = (r2 && r2.list) || (r1 && r1.list) || [];

  const companies = [];
  const seen = new Set();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const name = (item.Name || item.name || '').replace(/<\/?em>/g, '');
    if (!name || seen.has(name)) continue;
    seen.add(name);
    companies.push({
      name,
      keyNo: item.KeyNo || item.keyNo || '',
      legalRep: item.OperName || '',
      operatingStatus: item.ShortStatus || '',
      regCap: item.RegistCapi || '',
      startDate: item.StartDate || '',
      imageUrl: item.ImageUrl || '',
    });
  }

  return companies;
}

// ─── 文档导出工具（document_export）───

const EXPORT_DIR = path.join(homedir(), '.BizOwl', 'exports');

/** 确保导出目录存在 */
function ensureExportDir() {
  if (!fs.existsSync(EXPORT_DIR)) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
  }
  return EXPORT_DIR;
}

/** 生成带时间戳的安全文件名 */
function makeExportFileName(title, ext) {
  const safeName = (title || 'export')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 60);
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `${safeName}_${ts}.${ext}`;
}

/** 避免文件名冲突，存在则追加序号 */
function resolveUniquePath(filePath) {
  if (!fs.existsSync(filePath)) return filePath;
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  for (let i = 2; i <= 100; i++) {
    const candidate = path.join(dir, `${base}-${i}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return filePath; // fallback（极端情况）
}

/**
 * 轻量 Markdown → HTML 转换（不依赖外部库）
 * 支持：标题、粗体、斜体、代码块、行内代码、表格、列表、链接、段落
 */
function markdownToHtml(md) {
  let html = '';
  const lines = md.split('\n');
  let inTable = false;
  let tableHeaderParsed = false;
  let inList = false;
  let listType = 'ul';
  let inCodeBlock = false;
  let codeBuffer = [];

  const inlineFmt = (text) => {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 代码块
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        html += `<pre><code>${codeBuffer.map(l =>
          l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        ).join('\n')}</code></pre>\n`;
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // 表格检测（| col1 | col2 |）
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      // 分隔行跳过（|---|---|）
      if (/^\|[\s\-:|]+\|$/.test(line.trim())) {
        tableHeaderParsed = true;
        continue;
      }
      if (!inTable) {
        html += '<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;">\n';
        inTable = true;
        tableHeaderParsed = false;
      }
      const cells = line.trim().slice(1, -1).split('|').map(c => c.trim());
      const tag = !tableHeaderParsed ? 'th' : 'td';
      html += '<tr>' + cells.map(c => `<${tag}>${inlineFmt(c)}</${tag}>`).join('') + '</tr>\n';
      continue;
    } else if (inTable) {
      html += '</table>\n';
      inTable = false;
    }

    // 标题
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      if (inList) { html += `</${listType}>\n`; inList = false; }
      const level = headingMatch[1].length;
      html += `<h${level}>${inlineFmt(headingMatch[2])}</h${level}>\n`;
      continue;
    }

    // 列表
    const ulMatch = line.match(/^[-*]\s+(.*)$/);
    const olMatch = line.match(/^\d+\.\s+(.*)$/);
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) html += `</${listType}>\n`;
        html += '<ul>\n';
        inList = true;
        listType = 'ul';
      }
      html += `<li>${inlineFmt(ulMatch[1])}</li>\n`;
      continue;
    }
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) html += `</${listType}>\n`;
        html += '<ol>\n';
        inList = true;
        listType = 'ol';
      }
      html += `<li>${inlineFmt(olMatch[1])}</li>\n`;
      continue;
    }
    if (inList) {
      html += `</${listType}>\n`;
      inList = false;
    }

    // 水平线
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      html += '<hr/>\n';
      continue;
    }

    // 空行
    if (line.trim() === '') {
      html += '<br/>\n';
      continue;
    }

    // 普通段落
    html += `<p>${inlineFmt(line)}</p>\n`;
  }

  // 收尾
  if (inTable) html += '</table>\n';
  if (inList) html += `</${listType}>\n`;
  if (inCodeBlock && codeBuffer.length > 0) {
    html += `<pre><code>${codeBuffer.map(l =>
      l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    ).join('\n')}</code></pre>\n`;
  }

  return html;
}

/** 构建完整的 HTML 文档（带样式） */
function buildHtmlDocument(title, mdContent) {
  const bodyHtml = markdownToHtml(mdContent);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${(title || '文档').replace(/[<>]/g, '')}</title>
<style>
  body {
    font-family: "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Helvetica Neue", Helvetica, Arial, sans-serif;
    line-height: 1.8;
    color: #333;
    max-width: 900px;
    margin: 40px auto;
    padding: 0 20px;
    font-size: 14px;
  }
  h1 { font-size: 24px; border-bottom: 2px solid #eee; padding-bottom: 10px; }
  h2 { font-size: 20px; border-bottom: 1px solid #eee; padding-bottom: 8px; margin-top: 30px; }
  h3 { font-size: 16px; margin-top: 24px; }
  table { margin: 12px 0; }
  th { background: #f5f5f5; }
  code { background: #f4f4f4; padding: 2px 4px; border-radius: 3px; font-size: 13px; }
  pre { background: #f4f4f4; padding: 12px; border-radius: 5px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  .footer-note { margin-top: 40px; padding-top: 15px; border-top: 1px solid #eee; font-size: 12px; color: #999; text-align: center; }
</style>
</head>
<body>
${bodyHtml}
<div class="footer-note">内容由AI生成，请仔细甄别</div>
</body>
</html>`;
}

/**
 * 导出文档（支持 md / pdf / docx / xlsx）
 * @param {Object} options
 * @param {string} options.content - Markdown 字符串
 * @param {string} options.format - 导出格式 pdf/docx/xlsx/md
 * @param {string} options.title - 文档标题（用于文件名）
 * @param {Object} [options.electronWindow] - Electron BrowserWindow（PDF 需要）
 * @returns {Promise<{success: boolean, filePath: string, format: string}>}
 */
export async function exportDocument({ content, format, title, electronWindow }) {
  ensureExportDir();
  const fmt = (format || 'md').toLowerCase();

  // --- Markdown 直接写文件 ---
  if (fmt === 'md') {
    const fileName = makeExportFileName(title, 'md');
    const filePath = resolveUniquePath(path.join(EXPORT_DIR, fileName));
    const mdContent = content + (content.endsWith('\n') ? '' : '\n') + '\n---\n\n> 内容由AI生成，请仔细甄别\n';
    fs.writeFileSync(filePath, mdContent, 'utf8');
    return { success: true, filePath, format: 'md' };
  }

  // --- PDF: Markdown → HTML → Electron printToPDF ---
  if (fmt === 'pdf') {
    // 延迟导入 electron
    let electron;
    try { electron = await import('electron'); } catch { electron = null; }

    const win = electronWindow || (electron && electron.BrowserWindow ? new electron.BrowserWindow({ show: false, width: 800, height: 600 }) : null);
    if (!win) {
      return { success: false, filePath: '', format: 'pdf', error: 'PDF 导出需要 Electron 环境（printToPDF），当前环境不支持。请使用 md 格式导出。' };
    }

    try {
      const html = buildHtmlDocument(title, content);
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      // 等待渲染完成
      await new Promise(resolve => setTimeout(resolve, 500));

      const pdfBuffer = await win.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
      });

      const fileName = makeExportFileName(title, 'pdf');
      const filePath = resolveUniquePath(path.join(EXPORT_DIR, fileName));
      fs.writeFileSync(filePath, pdfBuffer);

      return { success: true, filePath, format: 'pdf' };
    } catch (err) {
      return { success: false, filePath: '', format: 'pdf', error: `PDF 导出失败: ${err.message}` };
    } finally {
      // 如果是我们创建的隐藏窗口，关闭它
      if (!electronWindow && win && !win.isDestroyed()) {
        win.close();
      }
    }
  }

  // --- DOCX: 尝试调用 docx skill 或检查依赖 ---
  if (fmt === 'docx') {
    // 尝试用动态 import 加载 docx npm 包
    let docxPkg = null;
    try {
      docxPkg = await import('docx');
    } catch {
      // 尝试从项目根 node_modules 加载（兼容打包后路径）
      try {
        const { pathToFileURL } = await import('node:url');
        // 动态查找 node_modules/docx：从当前文件向上找到项目根
        let searchDir = path.dirname(fileURLToPath(import.meta.url));
        for (let i = 0; i < 5; i++) {
          const candidate = path.join(searchDir, 'node_modules', 'docx');
          if (fs.existsSync(candidate)) {
            docxPkg = await import(pathToFileURL(candidate + '/build/index.js').href);
            break;
          }
          searchDir = path.dirname(searchDir);
        }
      } catch {}
    }

    if (docxPkg && docxPkg.Document) {
      try {
        const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docxPkg;
        const html = markdownToHtml(content);
        // 简易处理：按行转段落
        const paragraphs = content.split('\n').map(line => {
          const headingMatch = line.match(/^(#{1,4})\s+(.*)$/);
          if (headingMatch) {
            const level = headingMatch[1].length;
            return new Paragraph({
              text: headingMatch[2],
              heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
            });
          }
          return new Paragraph({ children: [new TextRun({ text: line, size: 24 })] });
        });

        const doc = new Document({ sections: [{ children: paragraphs }] });
        const buffer = await Packer.toBuffer(doc);
        const fileName = makeExportFileName(title, 'docx');
        const filePath = resolveUniquePath(path.join(EXPORT_DIR, fileName));
        fs.writeFileSync(filePath, buffer);
        return { success: true, filePath, format: 'docx' };
      } catch (err) {
        return { success: false, filePath: '', format: 'docx', error: `DOCX 导出失败: ${err.message}` };
      }
    }

    return { success: false, filePath: '', format: 'docx', error: 'DOCX 导出需要安装 docx npm 包（依赖缺失）。请使用 md 格式或安装依赖后再试。' };
  }

  // --- XLSX: 尝试调用 xlsx skill 或检查依赖 ---
  if (fmt === 'xlsx') {
    // 尝试用动态 import 加载 exceljs / xlsx
    let xlsxPkg = null;
    try {
      xlsxPkg = await import('exceljs');
    } catch {
      try { xlsxPkg = await import('xlsx'); } catch {}
    }

    if (xlsxPkg) {
      try {
        // 从 Markdown 表格提取数据
        const tables = [];
        let currentTable = null;
        for (const line of content.split('\n')) {
          if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
            if (/^\|[\s\-:|]+\|$/.test(line.trim())) continue; // 分隔行
            const cells = line.trim().slice(1, -1).split('|').map(c => c.trim());
            if (!currentTable) currentTable = [];
            currentTable.push(cells);
          } else {
            if (currentTable) { tables.push(currentTable); currentTable = null; }
          }
        }
        if (currentTable) tables.push(currentTable);

        if (tables.length === 0) {
          return { success: false, filePath: '', format: 'xlsx', error: '未检测到表格数据。XLSX 导出需要 Markdown 表格格式的内容。' };
        }

        let buffer;
        if (xlsxPkg.Workbook) {
          // exceljs
          const wb = new xlsxPkg.Workbook();
          const ws = wb.addWorksheet('数据');
          const table = tables[0];
          table.forEach((row, ri) => {
            row.forEach((cell, ci) => {
              const cellObj = ws.getCell(ri + 1, ci + 1);
              cellObj.value = cell;
              if (ri === 0) cellObj.font = { bold: true };
            });
          });
          buffer = await wb.xlsx.writeBuffer();
        } else {
          // xlsx (SheetJS)
          const ws = xlsxPkg.utils.aoa_to_sheet(tables[0]);
          const wb = xlsxPkg.utils.book_new();
          xlsxPkg.utils.book_append_sheet(wb, ws, '数据');
          buffer = xlsxPkg.write(wb, { type: 'buffer', bookType: 'xlsx' });
        }

        const fileName = makeExportFileName(title, 'xlsx');
        const filePath = resolveUniquePath(path.join(EXPORT_DIR, fileName));
        fs.writeFileSync(filePath, buffer);
        return { success: true, filePath, format: 'xlsx' };
      } catch (err) {
        return { success: false, filePath: '', format: 'xlsx', error: `XLSX 导出失败: ${err.message}` };
      }
    }

    return { success: false, filePath: '', format: 'xlsx', error: 'XLSX 导出需要安装 exceljs 或 xlsx npm 包（依赖缺失）。请使用 md 格式或安装依赖后再试。' };
  }

  // --- 未知格式 ---
  return { success: false, filePath: '', format: fmt, error: `不支持的导出格式: ${fmt}。支持的格式: md, pdf, docx, xlsx` };
}

// ─── 数据工具定义（OpenAI function-calling 格式）───

export function getQccTools() {
  return [
    {
      type: 'function',
      function: {
        name: 'qcc_knowledge_search',
        description: '【企业知识库搜索 - 第一个必须调用的数据工具】当用户询问企业信息（工商、股权、风险、司法、知识产权、人员等）时，必须优先调用此工具。传入用户的原始问题（保留企业名/人名）。如果知识库足以回答则停止；否则根据返回的工具节点继续调用 qcc_tool_search 和 qcc_execute_tool。',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: '用户的原始查询问题，保留完整的企业名/人名（如"华为技术有限公司的工商信息"）。',
            },
          },
          required: ['query'],
        },
        execute: async (args, token, signal) => {
          const query = args.query || '';
          console.log(`[QCC:knowledge_search] "${query.slice(0, 60)}"`);
          try {
            const { hits } = await vectorSearch(token, query, SEARCH_RESULT_LIMIT, undefined, signal);
            const docs = hits.map(h => {
              const e = h.entity || h;
              return `**${e.label || e.name || ''}**: ${(e.description || e.text || '').slice(0, 500)}`;
            }).filter(Boolean);
            return docs.length > 0
              ? `知识库搜索到 ${docs.length} 条相关内容：\n\n${docs.join('\n\n')}`
              : '知识库无匹配结果，建议使用 qcc_tool_search 搜索工具后调用。';
          } catch (err) {
            console.error('[QCC:knowledge_search] 失败:', err.message);
            return vectorSearchErrorMsg(err);
          }
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'qcc_tool_search',
        description: '【企业数据工具搜索 - 第二步】搜索可用的数据查询工具及其参数 schema。在 qcc_knowledge_search 返回不足后调用。goal 用中文描述查询维度（如"查工商信息"、"查股东结构"），禁止包含企业名/人名。返回工具名、URL 和参数格式。',
        parameters: {
          type: 'object',
          properties: {
            goal: {
              type: 'string',
              description: '60字内中文，概述要查找的工具类型（如"查工商信息"、"查股东结构、查司法风险"）。禁止包含企业名/人名。',
            },
            searchNames: {
              type: 'string',
              description: '可选，已知工具名（多个用"、"分隔），获取其参数说明。',
            },
          },
          required: ['goal'],
        },
        execute: async (args, token, signal) => {
          const goal = args.goal || '';
          const searchNames = args.searchNames
            ? args.searchNames.split(/[、,]/).map(s => s.trim()).filter(Boolean)
            : undefined;
          console.log(`[QCC:tool_search] goal="${goal}"`);

          // 多意图拆分搜索（不再静默吞错：token 过期等要明确提示，否则会误报"未找到工具"）
          const intents = goal.split(/[、,]/).map(g => g.trim()).filter(Boolean).slice(0, 5);
          try {
            const batchResults = await Promise.all(
              intents.map(g => vectorSearch(token, g, TOOL_SEARCH_RESULT_LIMIT, searchNames, signal))
            );
            const allHits = batchResults.flatMap(r => r.hits);
            const allNameResults = batchResults.flatMap(r => r.nameResults);

            // 去重
            const seen = new Set();
            const dedupedHits = allHits.filter(h => {
              const name = (h.entity || h).name || '';
              if (!name || seen.has(name)) return false;
              seen.add(name);
              return true;
            });
            const dedupedNames = allNameResults.filter(h => {
              const name = (h.entity || h).name || '';
              if (!name || seen.has(name)) return false;
              seen.add(name);
              return true;
            });

            if (dedupedHits.length === 0 && dedupedNames.length === 0) {
              return `未找到与"${goal}"匹配的工具。建议用更通用的关键词搜索。`;
            }

            return formatToolSearchResult(dedupedHits, dedupedNames);
          } catch (err) {
            console.error('[QCC:tool_search] 失败:', err.message);
            return vectorSearchErrorMsg(err);
          }
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'qcc_execute_tool',
        description: '【企业数据工具执行 - 第三步】执行具体的数据查询工具获取数据。url 和 name 必须从 qcc_tool_search 的搜索结果中获取，不能自行猜测或编造。subParams 按搜索结果的参数要求构造，通常包含 companyName（企业全称）和 format（优先传 markdown）。',
        parameters: {
          type: 'object',
          properties: {
            goal: {
              type: 'string',
              description: '60字内中文，本次具体查询目标（如"华为技术有限公司工商基本信息"）。',
            },
            url: {
              type: 'string',
              description: '工具 MCP 服务地址，从搜索结果获取（如 /mcp-proxy/qccBackendMcp/mcp）。',
            },
            name: {
              type: 'string',
              description: '工具调用名称，从搜索结果获取（如 get_company_registration_info）。',
            },
            subParams: {
              type: 'object',
              description: '工具执行参数。按搜索结果中的参数要求构造。通常包含 companyName（企业全称）、format（json/markdown）等。',
              additionalProperties: true,
            },
          },
          required: ['goal', 'url', 'name'],
        },
        execute: async (args, token, signal) => {
          const { url, name, subParams } = args;
          console.log(`[QCC:execute_tool] ${name} url=${url}`);

          if (!url || !name) {
            return '调用 qcc_execute_tool 时缺少 url 或 name 参数。请先调用 qcc_tool_search 获取工具信息。';
          }

          try {
            const result = await callMcpTool(token, url, name, subParams || {}, signal);
            console.log(`[QCC:execute_tool] ${name} 成功, 长度=${result.length}`);
            // 截断到 8000 字符避免 token 溢出
            return result.slice(0, 8000);
          } catch (err) {
            console.error(`[QCC:execute_tool] ${name} 失败:`, err.message);
            return `[error] 工具 ${name} 执行失败: ${err.message}`;
          }
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'document_export',
        description: '【文档导出】当用户要求导出报告、生成文件时调用。根据内容类型选择格式：表格数据用xlsx，正式报告用pdf/docx，幻灯片用pptx。content 传入要导出的完整 Markdown 内容。',
        parameters: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: '要导出的完整 Markdown 内容（正文、表格、列表等）。',
            },
            format: {
              type: 'string',
              enum: ['pdf', 'docx', 'xlsx', 'md'],
              description: '导出格式：表格数据用xlsx，正式报告用pdf/docx，纯文本用md。',
            },
            title: {
              type: 'string',
              description: '文档标题，用于文件命名（如"华为技术有限公司工商信息报告"）。',
            },
          },
          required: ['content', 'format', 'title'],
        },
        execute: async (args, _token, signal) => {
          if (signal?.aborted) return '[已停止]';
          const { content, format, title } = args;
          console.log(`[QCC:document_export] format=${format}, title="${title}"`);
          if (!content) {
            return '[error] content 不能为空，请传入要导出的完整 Markdown 内容。';
          }
          try {
            const result = await exportDocument({ content, format, title });
            if (result.success) {
              return `✅ 导出成功！\n格式: ${result.format}\n文件路径: ${result.filePath}`;
            }
            return `[error] ${result.error || '导出失败'}`;
          } catch (err) {
            console.error('[QCC:document_export] 失败:', err.message);
            return `[error] 文档导出失败: ${err.message}`;
          }
        },
      },
    },
  ];
}

// ─── 工具定义（仅供内部使用）───

export function getQccToolsForApi() {
  return getQccTools().map(t => ({
    type: t.type,
    function: {
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    },
  }));
}

// ─── 执行数据工具 ───

export async function executeQccTool(toolName, args, token, signal) {
  const tools = getQccTools();
  const tool = tools.find(t => t.function.name === toolName);
  if (!tool) {
    // 如果是动态工具名（从搜索结果来的），自动走 execute_tool 路径
    if (args.url && args.name) {
      return await callMcpTool(token, args.url, args.name, args.subParams || {}, signal);
    }
    return `[error] 未知工具: ${toolName}`;
  }
  try {
    return await tool.function.execute(args, token, signal);
  } catch (err) {
    if (err?.message === 'ABORTED' || signal?.aborted) return '[已停止]';
    console.error(`[QCC] ${toolName} 执行失败:`, err);
    return `[error] ${err.message}`;
  }
}
