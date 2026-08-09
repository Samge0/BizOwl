/**
 * report-export.js — 研究报告 PDF 生成（BizOwl）
 *
 * 从 Report Sage (hermes-research-report-agent) 迁移的研报渲染能力：
 * - 模板：report-template.html（封面/摘要/目录/正文/评分总表/图表/参考文献/附录）
 * - 渲染：占位符替换（与 Python 版 build_report_pdf.py 的 build_html_from_data 等价）
 * - PDF：Electron printToPDF（preferCSSPageSize 尊重 @page 的 A4 + 页码）
 * - 产物：artifacts.json 注册表（通用产物机制：pdf/docx/xlsx/md/html 都可用）
 *
 * data 结构（与 Report Sage 的 report_data.json 兼容）：
 * {
 *   "title": "主标题", "subtitle": "副标题",
 *   "report_type": "行业研究 | 方案对比 | 市场前景评估 | 主题研究 | 前瞻时间线",
 *   "date": "2026-08-08", "author": "BizOwl",
 *   "abstract": "摘要文本（\n 分段）",
 *   "total_score": 7.4, "confidence": "高|中|低",
 *   "chapters": [{ "title": "第一章 背景", "sections": [{ "heading": "1.1 ...", "body": "正文（支持 HTML）" }] }],
 *   "score_table": { "headers": ["维度","权重","得分","置信度","依据"], "rows": [["市场规模","20%","7.5","高","依据..."]] },
 *   "charts_html": "<可选，内联 HTML 图表>",
 *   "references": [{ "id": 1, "title": "来源标题", "url": "https://...", "accessed": "2026-08-08" }],
 *   "appendix": "<可选，附录 HTML>"
 * }
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, 'report-template.html');
const EXPORT_DIR = path.join(os.homedir(), '.BizOwl', 'exports');
const ARTIFACTS_FILE = path.join(os.homedir(), '.BizOwl', 'artifacts.json');

// ─── 工具函数 ───

function ensureExportDir() {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
}

function safeFileName(name) {
  return (name || 'report')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 60);
}

function makeExportFileName(title, ext) {
  const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  return `${safeFileName(title)}_${ts}.${ext}`;
}

function resolveUniquePath(filePath) {
  if (!fs.existsSync(filePath)) return filePath;
  const ext = path.extname(filePath);
  const base = filePath.slice(0, -ext.length);
  let i = 1;
  while (fs.existsSync(`${base}(${i})${ext}`)) i++;
  return `${base}(${i})${ext}`;
}

// ─── 模板渲染（Node 版 build_html_from_data）───

export function loadReportTemplate() {
  return fs.readFileSync(TEMPLATE_PATH, 'utf8');
}

// 清理 LLM 在 body 里塞入的强制分页样式/属性——避免大片空白
// 模板已统一控制分页，chapter 内不应再有 page-break
function stripInlinePageBreaks(html) {
  if (typeof html !== 'string') return '';
  return html
    // style 里的 page-break-before/after: always / break-before/after: page
    .replace(/page-break-(before|after)\s*:\s*always\s*;?/gi, '')
    .replace(/page-break-(before|after)\s*:\s*avoid\s*;?/gi, '')
    .replace(/break-(before|after)\s*:\s*(page|always)\s*;?/gi, '')
    // 空的 style 属性
    .replace(/\sstyle\s*=\s*"\s*"/gi, '')
    .replace(/\sstyle\s*=\s*'\s*'/gi, '');
}

// PDF 是 headless Chrome 静态渲染，不执行 JS。
// mermaid 代码块（```mermaid 或 <div class="mermaid">）会原样显示为代码文本。
// 把残留的 mermaid 块替换为提示文字（prompt 已禁令，这里是安全网）。
function stripMermaidBlocks(html) {
  if (typeof html !== 'string') return '';
  return html
    // <pre><code class="language-mermaid">...</code></pre> 或 ```mermaid 块
    .replace(/<pre[^>]*><code[^>]*language-mermaid[^>]*>[\s\S]*?<\/code><\/pre>/gi,
      '<div class="note">[此处为图表，请在 HTML 版本中查看]</div>')
    .replace(/<div[^>]*class="[^"]*mermaid[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
      '<div class="note">[此处为图表，请在 HTML 版本中查看]</div>')
    // 裸 ```mermaid ... ``` 代码块（markdown 未被渲染的情况）
    .replace(/```mermaid[\s\S]*?```/gi, '[此处为图表区域]');
}

// 修复 LLM 输出中被截断的表格：流式超时/长度限制可能让 <table> 写到一半就结束，
// 缺少 </table>。headless Chrome 遇到未闭合的 <table> 会把后续所有内容（标题/段落/列表）
// 都吞进表格，造成"正常内容嵌套进表格、样式错乱"。此处对未闭合的表格补全闭合标签。
// 浏览器会忽略多余的闭合标签，</tr></table> 也能隐式关闭 td/th/thead/tbody，多补是安全的。
function repairUnclosedTables(html) {
  if (typeof html !== 'string' || !html.includes('<table')) return html;
  const open = (html.match(/<table[\s>]/gi) || []).length;
  const close = (html.match(/<\/table>/gi) || []).length;
  const missing = open - close;
  if (missing <= 0) return html;
  return html + '</td></tr></table>'.repeat(missing);
}

function renderChapters(chapters) {
  if (!Array.isArray(chapters)) return '';
  const parts = [];
  for (const ch of chapters) {
    // 过滤无效章（title 为 undefined/null/空 且 sections 全空）
    const chTitle = (typeof ch.title === 'string' && ch.title.trim()) ? ch.title.trim() : '';
    const sections = Array.isArray(ch.sections) ? ch.sections.filter((s) => {
      if (!s) return false;
      const h = typeof s.heading === 'string' ? s.heading.trim() : '';
      const b = typeof s.body === 'string' ? s.body.trim() : '';
      // heading 和 body 至少有一个非空才保留
      return h || b;
    }) : [];
    // 章标题和内容都空 → 跳过（防止 undefined 章节污染报告）
    if (!chTitle && sections.length === 0) continue;

    parts.push(`<section class="chapter">`);
    if (chTitle) parts.push(`<h2>${chTitle}</h2>`);
    for (const sec of sections) {
      const h = typeof sec.heading === 'string' ? sec.heading.trim() : '';
      const b = typeof sec.body === 'string' ? sec.body : '';
      if (h) parts.push(`<h3>${h}</h3>`);
      if (b) parts.push(`<div class="section-body">${repairUnclosedTables(stripMermaidBlocks(stripInlinePageBreaks(b)))}</div>`);
    }
    parts.push('</section>');
  }
  return parts.join('\n');
}

function renderScoreTable(table) {
  if (!table || !Array.isArray(table.rows) || table.rows.length === 0) return '';
  const headers = Array.isArray(table.headers) ? table.headers : [];
  const h = headers.map((x) => `<th>${x}</th>`).join('');
  const body = table.rows
    .map((r) => '<tr>' + (Array.isArray(r) ? r.map((c) => `<td>${c}</td>`).join('') : `<td>${r}</td>`) + '</tr>')
    .join('');
  return `<table class="score-table"><thead><tr>${h}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderReferences(refs) {
  if (!Array.isArray(refs) || refs.length === 0) {
    return '<p class="muted">本报告未记录外部参考文献。</p>';
  }
  const items = refs.map((r) => {
    const url = r.url || '';
    const title = r.title || '';
    const acc = r.accessed || '';
    const link = url ? `<a href="${url}">${title || url}</a>` : title;
    return `<li>[${r.id || ''}] ${link} <span class="muted">(访问 ${acc})</span></li>`;
  });
  return `<ol class="references">\n${items.join('\n')}\n</ol>`;
}

/**
 * 把报告数据渲染成完整 HTML。
 * @param {Object} data 报告数据（见文件头注释）
 * @returns {string} 完整 HTML
 */
export function renderReportHtml(data = {}) {
  const tpl = loadReportTemplate();
  const chaptersHtml = renderChapters(data.chapters || []);
  const scoreTableHtml = renderScoreTable(data.score_table || {});
  const referencesHtml = renderReferences(data.references || []);

  const fill = {
    title: data.title || '研究报告',
    subtitle: data.subtitle || '',
    report_type: data.report_type || '',
    date: data.date || new Date().toISOString().slice(0, 10),
    author: data.author || 'BizOwl',
    abstract: (data.abstract || '').replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>'),
    total_score: data.total_score ?? '—',
    confidence: data.confidence || '—',
    chapters: chaptersHtml,
    score_table: scoreTableHtml,
    charts_html: data.charts_html || '',
    references: referencesHtml,
    appendix: data.appendix || '',
  };

  let out = tpl;
  for (const [k, v] of Object.entries(fill)) {
    out = out.split('{{' + k + '}}').join(String(v));
  }
  return out;
}

/**
 * 渲染研究报告 PDF。
 * @param {Object} options
 * @param {Object} options.data — 报告数据（renderReportHtml 的结构）
 * @param {Object} [options.electronWindow] — 复用现有 BrowserWindow（PDF 需要）
 * @param {string} [options.title] — 文件命名标题（默认 data.title）
 * @returns {Promise<{success: boolean, filePath: string, format: string, size: number, error?: string}>}
 */
export async function exportResearchReport({ data, electronWindow, title }) {
  ensureExportDir();

  // ─── 数据完整性校验（防止生成 undefined/只有框架的空报告）───
  const validTitle = (typeof title === 'string' && title.trim())
    || (typeof data?.title === 'string' && data.title.trim())
    || '';
  if (!validTitle) {
    return { success: false, filePath: '', format: 'pdf', error: '报告标题缺失（title 为空或 undefined），无法生成有效 PDF。请补充报告标题后重试。' };
  }

  const chapters = Array.isArray(data?.chapters) ? data.chapters : [];
  // 统计有效正文（heading 或 body 至少一个非空）
  const validSections = chapters.reduce((acc, ch) => {
    if (!ch || !Array.isArray(ch.sections)) return acc;
    return acc + ch.sections.filter((s) => s && (
      (typeof s.heading === 'string' && s.heading.trim()) ||
      (typeof s.body === 'string' && s.body.trim())
    )).length;
  }, 0);
  if (chapters.length === 0 || validSections === 0) {
    return { success: false, filePath: '', format: 'pdf', error: `报告内容为空（chapters 缺失或 sections 全空，共 ${chapters.length} 章 / ${validSections} 有效小节）。请先生成完整的报告内容再调用导出。` };
  }

  // 清理 charts_html / appendix 里可能的强制分页 + mermaid 残留
  const cleanedData = {
    ...data,
    title: validTitle,
    charts_html: repairUnclosedTables(stripMermaidBlocks(stripInlinePageBreaks(data?.charts_html || ''))),
    appendix: repairUnclosedTables(stripMermaidBlocks(stripInlinePageBreaks(data?.appendix || ''))),
  };

  const html = renderReportHtml(cleanedData);

  // 延迟导入 electron（Node smoke test 环境无 electron 时优雅降级）
  let electron = null;
  try {
    electron = await import('electron');
  } catch { electron = null; }

  const win = electronWindow
    || (electron && electron.BrowserWindow ? new electron.BrowserWindow({ show: false, width: 800, height: 600 }) : null);
  if (!win) {
    return { success: false, filePath: '', format: 'pdf', error: 'PDF 导出需要 Electron 环境（printToPDF），当前环境不支持。' };
  }

  try {
    // 用 loadURL 加载 HTML 并等待页面完全渲染（did-finish-load），
    // 再额外等待 CSS/字体/图片布局稳定。固定 600ms 在大报告上不够，
    // 导致 printToPDF 只捕获到部分页面（如只有目录没有正文）。
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

    // 等待页面完全加载（DOM + CSS + 图片），超时则降级用固定等待
    await Promise.race([
      new Promise((resolve) => {
        win.webContents.once('did-finish-load', resolve);
        // 如果已经加载完成（loadURL 已 resolve 说明导航已提交），立即 resolve
        if (!win.webContents.isLoading()) resolve();
      }),
      new Promise((resolve) => setTimeout(resolve, 3000)), // 最多等 3s
    ]);
    // 额外等待布局稳定（字体渲染、CSS 分页计算）
    await new Promise((resolve) => setTimeout(resolve, 800));

    const pdfBuffer = await win.webContents.printToPDF({
      preferCSSPageSize: true, // 尊重模板 @page { size: A4; margin } → 页码 counter(page) 生效
      printBackground: true,
    });

    const fileName = makeExportFileName(validTitle, 'pdf');
    const filePath = resolveUniquePath(path.join(EXPORT_DIR, fileName));
    fs.writeFileSync(filePath, pdfBuffer);

    const artifact = {
      id: makeArtifactId(),
      kind: 'pdf',
      title: validTitle,
      filePath,
      format: 'pdf',
      size: pdfBuffer.length,
      createdAt: Date.now(),
      source: 'report_export',
    };
    registerArtifact(artifact);

    return { success: true, filePath, format: 'pdf', size: pdfBuffer.length, artifact };
  } catch (err) {
    return { success: false, filePath: '', format: 'pdf', error: `PDF 导出失败: ${err.message}` };
  } finally {
    if (!electronWindow && win && !win.isDestroyed()) {
      win.close();
    }
  }
}

// ─── 产物注册表（通用产物机制）───

function makeArtifactId() {
  return 'art_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

export function getArtifactsFile() {
  return ARTIFACTS_FILE;
}

function readArtifacts() {
  try {
    if (fs.existsSync(ARTIFACTS_FILE)) {
      const arr = JSON.parse(fs.readFileSync(ARTIFACTS_FILE, 'utf8'));
      return Array.isArray(arr) ? arr : [];
    }
  } catch { /* 损坏则重建 */ }
  return [];
}

/**
 * 注册一个产物（通用：任何工具导出的文件都可注册）。
 * @param {Object} artifact { id?, kind, title, filePath, format, size, createdAt, source }
 * @returns {Object} 注册后的 artifact（含 id）
 */
export function registerArtifact(artifact) {
  const arr = readArtifacts();
  const entry = {
    id: artifact.id || makeArtifactId(),
    kind: artifact.kind || artifact.format || 'file',
    title: artifact.title || path.basename(artifact.filePath || 'file'),
    filePath: artifact.filePath,
    format: artifact.format || 'file',
    size: artifact.size || 0,
    createdAt: artifact.createdAt || Date.now(),
    source: artifact.source || 'export',
  };
  arr.unshift(entry); // 最新的在前
  // 保留最近 100 条
  const trimmed = arr.slice(0, 100);
  try {
    fs.mkdirSync(path.dirname(ARTIFACTS_FILE), { recursive: true });
    fs.writeFileSync(ARTIFACTS_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
  } catch (err) {
    console.warn('[report-export] 产物注册失败:', err.message);
  }
  return entry;
}

/** 列出全部产物（新的在前） */
export function listArtifacts() {
  return readArtifacts();
}
