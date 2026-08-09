/**
 * memo.js — OptMem 核心引擎（Node.js 移植版）
 *
 * 基于 github.com/VictorTaelin/OptMem (MIT, by Victor Taelin)
 * 移植为 Node.js ESM 模块，零外部依赖。
 *
 * 核心：固定宽度记录 + 二叉合并树 = 时间衰减压缩的 append-only 记忆。
 * 无论存了多少条记忆，wake 始终输出 ≤96 行（~8k tokens）。
 *
 * 既是模块（import { wake, note, ... } from './memo.js'），
 * 也是 CLI（node memo.js wake / note "..." / recall <regex>）。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// ─── 常量 ───
const LOG_REC = 320;   // 每条记忆固定 320 字节
const TREE_REC = 288;  // 每条摘要固定 288 字节
const RAW_MAX = 16;    // 从原始日志压缩的最大块大小

const DEFAULT_KNOBS = {
  WAKE_LINES: 96,    // wake 输出的最大行数（~8k tokens）
  ENTRY_CHARS: 280,  // 单条记忆最大字节
  PART_CHARS: 20000, // 单页最大字节
  PART_LINES: 500,   // 单页最大行数
};

// ─── 路径 ───
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function defaultMemoryDir() {
  return path.join(os.homedir(), '.BizOwl', 'memory');
}

function logPath(d) { return path.join(d, 'LOG.txt'); }
function treePath(d, size) { return path.join(d, 'TREE', String(size)); }
function configPath(d) { return path.join(d, 'config'); }
function lockPath(d) { return path.join(d, '.lock'); }

// ─── 工具函数 ───

function byteLen(s) {
  return Buffer.byteLength(s, 'utf8');
}

/**
 * 字节安全的字符串截断。
 * String.slice 按字符数切，中文 1 字符 = 3 字节会导致截断后仍超字节限制。
 * 此函数按字节边界截取，确保返回的字符串 UTF-8 字节数 ≤ maxBytes。
 */
function truncateToBytes(s, maxBytes) {
  if (byteLen(s) <= maxBytes) return s;
  const buf = Buffer.from(s, 'utf8');
  // 确保不截断到多字节字符的中间字节（会产生 U+FFFD 乱码）
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xC0) === 0x80) end--; // 回退到 UTF-8 字符首字节
  return buf.slice(0, end).toString('utf8');
}

function pad(text, rec) {
  const b = Buffer.from(text, 'utf8');
  if (b.length > rec - 1) {
    throw new Error(`Too long: ${b.length} bytes. The record holds ${rec - 1}.`);
  }
  const out = Buffer.alloc(rec, 0x20); // 空格填充
  b.copy(out);
  out[rec - 1] = 0x0a; // 换行
  return out;
}

function unpad(buf) {
  // 去掉尾部空格和换行，返回 UTF-8 字符串
  let end = buf.length;
  while (end > 0 && (buf[end - 1] === 0x20 || buf[end - 1] === 0x0a || buf[end - 1] === 0x00)) end--;
  return buf.slice(0, end).toString('utf8');
}

function countRecords(filePath, rec) {
  try {
    const stat = fs.statSync(filePath);
    return Math.floor(stat.size / rec);
  } catch {
    return 0;
  }
}

function repair(filePath, rec) {
  try {
    const n = fs.statSync(filePath).size;
    if (n % rec !== 0) {
      fs.truncateSync(filePath, n - (n % rec));
    }
  } catch { /* file doesn't exist, nothing to repair */ }
}

function parse(line) {
  // 格式: #<id> <date> <text>
  const s = unpad(Buffer.from(line, 'utf8'));
  const sp1 = s.indexOf(' ');
  const id = parseInt(s.slice(1, sp1), 10);
  const sp2 = s.indexOf(' ', sp1 + 1);
  const date = s.slice(sp1 + 1, sp2);
  const text = s.slice(sp2 + 1);
  return [id, date, text];
}

function recordsFromBuf(buf, rec = LOG_REC) {
  const out = [];
  const n = Math.floor(buf.length / rec);
  for (let i = 0; i < n; i++) {
    const slice = buf.slice(i * rec, (i + 1) * rec);
    out.push(parse(slice));
  }
  return out;
}

function logLen(d) {
  return countRecords(logPath(d), LOG_REC);
}

function logSlice(d, lo, hi) {
  const fd = fs.openSync(logPath(d), 'r');
  try {
    const buf = Buffer.alloc((hi - lo) * LOG_REC);
    fs.readSync(fd, buf, 0, buf.length, lo * LOG_REC);
    return recordsFromBuf(buf);
  } finally {
    fs.closeSync(fd);
  }
}

function logGet(d, i) {
  return logSlice(d, i, i + 1)[0];
}

function logScan(d) {
  // 流式读取整个日志（避免一次性加载到内存）
  const fd = fs.openSync(logPath(d), 'r');
  const chunkSize = LOG_REC * 4096;
  const results = [];
  try {
    while (true) {
      const buf = Buffer.alloc(chunkSize);
      const bytesRead = fs.readSync(fd, buf, 0, chunkSize, null);
      if (bytesRead === 0) break;
      const actual = buf.slice(0, bytesRead);
      const recs = recordsFromBuf(actual);
      for (const r of recs) results.push(r);
    }
  } finally {
    fs.closeSync(fd);
  }
  return results;
}

function treeGet(d, lo, hi) {
  const size = hi - lo;
  const p = treePath(d, size);
  if (!fs.existsSync(p)) return null;
  const fd = fs.openSync(p, 'r');
  try {
    const offset = Math.floor(lo / size) * TREE_REC;
    const stat = fs.fstatSync(fd);
    if (offset >= stat.size) return null;
    const buf = Buffer.alloc(TREE_REC);
    fs.readSync(fd, buf, 0, TREE_REC, offset);
    const s = unpad(buf);
    return s || null;
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

// ─── 文件锁（并发安全）───
// 两层防护：
//   1. 进程内 Promise 队列 — 确保 Node 单进程内的并发调用串行化
//   2. O_EXCL 锁文件 — 跨进程互斥（防止多个 BizOwl 实例同时写）
const _lockQueues = new Map(); // dir → Promise chain

/**
 * async lock — O_EXCL 跨进程互斥 + setTimeout 异步退避（不阻塞事件循环）。
 * 与 withLock 的进程内 Promise 队列配合，实现两层并发保护。
 */
function tryLock(d) {
  const p = lockPath(d);
  try {
    const fd = fs.openSync(p, 'wx'); // O_EXCL：文件已存在则失败
    fs.writeFileSync(fd, String(process.pid));
    return fd;
  } catch (e) {
    if (e.code === 'EEXIST') {
      // 检查是否为陈旧锁（持有 > 10s 视为僵死）
      try {
        const stat = fs.statSync(p);
        if (Date.now() - stat.mtimeMs > 10000) {
          fs.unlinkSync(p); // 清理陈旧锁
          return tryLock(d); // 递归重试一次
        }
      } catch {}
      return null; // 锁被占用，需要等待
    }
    throw e;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function lock(d) {
  const maxRetries = 50;
  for (let i = 0; i < maxRetries; i++) {
    const fd = tryLock(d);
    if (fd !== null) return fd;
    // 异步退避：让出事件循环，不阻塞 IPC/动画/用户输入
    await sleep(100);
  }
  throw new Error('Lock timeout: 无法获取记忆锁');
}

function unlock(d, fd) {
  try { fs.closeSync(fd); } catch {}
  try { fs.unlinkSync(lockPath(d)); } catch {}
}

/**
 * 在锁保护下执行函数（进程内串行 + 跨进程互斥）。
 * 所有写操作（logAppend / treePut / cmd_deleteMany）通过 withLock 调用，
 * 确保同一目录的写操作排队执行 + 不阻塞事件循环。
 */
async function withLock(d, fn) {
  // 进程内串行化：同一目录的写操作排队执行
  const prev = _lockQueues.get(d) || Promise.resolve();
  let resolve, reject;
  const curr = new Promise((res, rej) => { resolve = res; reject = rej; });
  _lockQueues.set(d, curr);

  prev.then(async () => {
    const fd = await lock(d);
    try {
      const result = await fn();
      if (_lockQueues.get(d) === curr) _lockQueues.delete(d);
      resolve(result);
    } catch (err) {
      if (_lockQueues.get(d) === curr) _lockQueues.delete(d);
      reject(err);
    } finally {
      unlock(d, fd);
    }
  }).catch((err) => {
    // 前一个操作失败时（prev 被 reject），清理队列再 reject，
    // 否则 _lockQueues 会永久保留一个 rejected Promise，导致该目录上所有后续写操作都失败。
    if (_lockQueues.get(d) === curr) _lockQueues.delete(d);
    reject(err);
  });

  return curr;
}

// ─── 写入（全部通过 withLock 调用，async + 进程内串行化）───

async function logAppend(d, items) {
  // items = [{ date, text }]
  return withLock(d, () => {
    repair(logPath(d), LOG_REC);
    const base = logLen(d);
    const chunks = [];
    for (let k = 0; k < items.length; k++) {
      const { date, text } = items[k];
      const line = `#${base + k} ${date} ${text}`;
      chunks.push(pad(line, LOG_REC));
    }
    const buf = Buffer.concat(chunks);
    fs.appendFileSync(logPath(d), buf);
    return base;
  });
}

async function treePut(d, lo, hi, text) {
  const size = hi - lo;
  return withLock(d, () => {
    const p = treePath(d, size);
    repair(p, TREE_REC);
    if (countRecords(p, TREE_REC) !== Math.floor(lo / size)) return false;
    fs.appendFileSync(p, pad(text, TREE_REC));
    return true;
  });
}

async function treeDrop(d, lo, hi) {
  const gone = [];
  let size = hi - lo;
  await withLock(d, () => {
    const T = logLen(d);
    while (size <= T) {
      const p = treePath(d, size);
      const k = Math.floor(lo / size);
      const n = countRecords(p, TREE_REC);
      if (n > k) {
        for (let i = k; i < n; i++) {
          gone.push([i * size, (i + 1) * size]);
        }
        fs.truncateSync(p, k * TREE_REC);
      }
      size *= 2;
    }
  });
  return gone;
}

// ─── 核心：二叉合并树覆盖算法 ───

function _cover(T, alpha) {
  let root = 1;
  while (root < T) root *= 2;
  const out = [];
  const stack = [[0, root]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    if (lo >= T) continue;
    const size = hi - lo;
    if (size > 1 && (hi > T || size > alpha * (T - lo))) {
      const mid = Math.floor((lo + hi) / 2);
      stack.push([mid, hi]);
      stack.push([lo, mid]);
    } else {
      out.push([lo, hi]);
    }
  }
  out.sort((a, b) => a[0] - b[0]);
  return out;
}

function cover(T, budget) {
  if (T <= 0) return [];
  if (T <= budget) {
    const out = [];
    for (let i = 0; i < T; i++) out.push([i, i + 1]);
    return out;
  }
  let lo = 0.0, hi = 1.0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (_cover(T, mid).length > budget) lo = mid;
    else hi = mid;
  }
  let out = _cover(T, hi);
  // 用剩余预算细化最近的块（细节在最近最有价值）
  while (out.length < budget) {
    let idx = -1;
    for (let i = 0; i < out.length; i++) {
      if (out[i][1] - out[i][0] > 1) { idx = i; break; }
    }
    if (idx === -1) break;
    const [lo2, hi2] = out[idx];
    const mid = Math.floor((lo2 + hi2) / 2);
    out.splice(idx, 1, [lo2, mid], [mid, hi2]);
  }
  return out;
}

// ─── Config ───

function readConfig(d) {
  const out = {};
  const p = configPath(d);
  if (!fs.existsSync(p)) return out;
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  for (const line of lines) {
    const stripped = line.split('#')[0].trim();
    if (!stripped.includes('=')) continue;
    const [k, ...rest] = stripped.split('=');
    const key = k.trim().toUpperCase();
    const val = parseInt(rest.join('=').trim(), 10);
    if (key in DEFAULT_KNOBS && val > 0) out[key] = val;
  }
  return out;
}

function getKnobs(d) {
  return { ...DEFAULT_KNOBS, ...readConfig(d) };
}

function writeConfig(d, overrides) {
  const lines = [
    '# OptMem sizes for this memory. A commented line means: follow the',
    '# tool\'s default.',
    '',
  ];
  for (const [k, defaultVal] of Object.entries(DEFAULT_KNOBS)) {
    const val = overrides[k] ?? defaultVal;
    const commented = k in overrides ? '' : '# ';
    lines.push(`${commented}${k.padEnd(12)} = ${String(val).padEnd(7)} # size knob`);
  }
  fs.writeFileSync(configPath(d), lines.join('\n') + '\n', 'utf8');
}

// ─── 压缩队列 ───

function pending(d, T, limit) {
  const todo = [];
  let size = 2;
  while (size <= T) {
    const have = countRecords(treePath(d, size), TREE_REC);
    const max = Math.floor(T / size);
    for (let k = have; k < max; k++) {
      todo.push([k * size, (k + 1) * size]);
      if (limit && todo.length >= limit) return todo;
    }
    size *= 2;
  }
  return todo;
}

function pendingCount(d, T) {
  let n = 0, size = 2;
  while (size <= T) {
    n += Math.max(0, Math.floor(T / size) - countRecords(treePath(d, size), TREE_REC));
    size *= 2;
  }
  return n;
}

function napPrompt(d, lo, hi, left, knobs) {
  const entryChars = knobs.ENTRY_CHARS;
  if (hi - lo <= RAW_MAX) {
    const recs = logSlice(d, lo, hi);
    const body = recs.map(([id, date, text]) => `  #${id} ${date} ${text}`).join('\n');
    return formatNapPrompt(lo, hi, entryChars, body, left);
  } else {
    const mid = Math.floor((lo + hi) / 2);
    const halves = [];
    for (const [a, b] of [[lo, mid], [mid, hi]]) {
      const s = treeGet(d, a, b);
      if (s === null) {
        throw new Error(`The summary of #${a}-${b - 1} is blank. Run: forget ${a}-${b - 1}`);
      }
      halves.push(`  #${a}-${b - 1} ${s}`);
    }
    return formatNapPrompt(lo, hi, entryChars, halves.join('\n'), left);
  }
}

function formatNapPrompt(lo, hi, entryChars, body, left) {
  const tail = left === 0 ? '' :
    left === 1 ? '\n1 compression remains after this one.' :
    `\n${left} compressions remain after this one.`;
  return (
    `Compress memories #${lo}-${hi - 1} into one line of at most ${entryChars} bytes.\n` +
    `Keep what has lasting effect, drop what does not. Invent nothing.\n\n` +
    `${body}\n${tail}`
  );
}

function nextNap(d, T, knobs) {
  const todo = pending(d, T, 1);
  if (!todo.length) return null;
  const [lo, hi] = todo[0];
  return napPrompt(d, lo, hi, pendingCount(d, T) - 1, knobs);
}

// ─── 分页 ───

function paginate(lines, knobs) {
  const parts = [];
  let cur = [];
  let size = 0;
  for (const line of lines) {
    const n = byteLen(line) + 1;
    if (cur.length > 0 && (cur.length >= knobs.PART_LINES || size + n > knobs.PART_CHARS)) {
      parts.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(line);
    size += n;
  }
  if (cur.length > 0) parts.push(cur);
  return parts;
}

// ─── 文本校验 ───

function check(text, entryChars) {
  text = text.trim();
  if (!text) throw new Error('Empty. A memory is one line of text.');
  if (text.includes('\n') || text.includes('\r')) {
    throw new Error('Multiple lines. A memory is one line.');
  }
  const n = byteLen(text);
  if (n > entryChars) {
    // 自动字节安全截断（而非抛异常），确保 LLM 输出的超长中文记忆不会导致崩溃
    text = truncateToBytes(text, entryChars);
  }
  return text;
}

function blockId(s) {
  const m = /^(\d+)-(\d+)$/.exec(s);
  if (!m) throw new Error(`'${s}' is not a block id.`);
  const lo = parseInt(m[1], 10);
  const hi = parseInt(m[2], 10) + 1;
  const n = hi - lo;
  if (n < 2 || (n & (n - 1)) !== 0 || lo % n !== 0) {
    throw new Error(`${s} is not a block. Copy the id from wake.`);
  }
  return [lo, hi];
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function plural(n, word) {
  if (n === 1) return `1 ${word}`;
  return `${n} ${word}s`;
}

// ─── ensureStore：确保记忆目录存在（BizOwl 自动初始化）───

export function ensureStore(d) {
  if (!d) d = defaultMemoryDir();
  if (!fs.existsSync(d)) {
    fs.mkdirSync(d, { recursive: true });
  }
  if (!fs.existsSync(path.join(d, 'TREE'))) {
    fs.mkdirSync(path.join(d, 'TREE'), { recursive: true });
  }
  if (!fs.existsSync(logPath(d))) {
    fs.writeFileSync(logPath(d), '', 'utf8');
  }
  if (!fs.existsSync(configPath(d))) {
    writeConfig(d, {});
  }
  return d;
}

// ─── autoCompress：自动批量压缩所有 pending 块 ───
// BizOwl 场景：Agent 无法保证每次都手动 nap，
// 所以在 wake 前自动用简单规则压缩（取前N字+计数），
// 确保 wake 始终能输出完整的压缩视图。
// 这比 OptMem 原版的"拒绝 wake + 等 Agent nap"更适合桌面 App。

function makeAutoSummary(d, lo, hi, knobs) {
  const recs = logSlice(d, lo, hi);
  const entryChars = knobs.ENTRY_CHARS;
  // 策略：取第一条的日期 + 所有记忆的共同主题词 + 总数
  // 例如："2026-08-07 ×4: Event #5 user asked… Event #8 user asked…"
  const first = recs[0];
  const last = recs[recs.length - 1];
  const count = recs.length;

  // 尝试提取共同前缀作为主题
  let prefix = '';
  const firstText = first[2];
  for (let i = 0; i < Math.min(firstText.length, 40); i++) {
    const ch = firstText[i];
    let allSame = true;
    for (const r of recs) {
      if (r[2][i] !== ch) { allSame = false; break; }
    }
    if (allSame) prefix += ch;
    else break;
  }
  // 去掉尾部非字母数字
  prefix = prefix.replace(/[\s\d#:]+$/, '').trim();

  let summary;
  if (prefix && prefix.length >= 4) {
    summary = `${first[1]} ×${count}: ${prefix}… (+${count - 1} similar)`;
  } else {
    // 没有共同前缀，取首尾拼接
    const head = truncateToBytes(first[2], Math.floor(entryChars / 3));
    const tail = truncateToBytes(last[2], Math.floor(entryChars / 3));
    summary = `${first[1]} ×${count}: ${head} | … | ${tail}`;
  }

  // 确保不超限（字节安全的截断）
  if (byteLen(summary) > entryChars) {
    summary = truncateToBytes(summary, entryChars - 3) + '…';
  }
  return summary;
}

/**
 * autoCompress — 自动完成所有 pending 压缩
 * 返回压缩的块数量
 */
export async function cmd_autoCompress(d) {
  d = ensureStore(d);
  const knobs = getKnobs(d);
  let compressed = 0;
  let maxRounds = 50; // 安全阀

  while (maxRounds-- > 0) {
    const T = logLen(d);
    const todo = pending(d, T, 1);
    if (!todo.length) break;

    const [lo, hi] = todo[0];
    const summary = makeAutoSummary(d, lo, hi, knobs);
    if (!(await treePut(d, lo, hi, summary))) break;
    compressed++;
  }

  return { compressed };
}

// ═══════════════════════════════════════════
// 命令实现（返回字符串，不直接 console.log）
// ═══════════════════════════════════════════

/**
 * init — 初始化记忆目录
 */
export function cmd_init(d) {
  d = ensureStore(d);
  const fresh = logLen(d) === 0;
  const knobs = getKnobs(d);
  if (fresh) {
    return `Created ${d}: BizOwl's permanent memory.\n` +
      `Sizes: WAKE_LINES=${knobs.WAKE_LINES}, ENTRY_CHARS=${knobs.ENTRY_CHARS}`;
  }
  return `Found ${d}: ${plural(logLen(d), 'memory')}.`;
}

/**
 * wake — 读取记忆上下文（会话启动时调用）
 * 返回压缩后的记忆视图，≤ WAKE_LINES 行
 * BizOwl 改进：先自动压缩所有 pending 块，确保 wake 不会因缺失摘要而中断。
 */
export async function cmd_wake(d, part = 1, T = null) {
  d = ensureStore(d);
  // 先自动完成所有 pending 压缩（BizOwl 改进）
  await cmd_autoCompress(d);

  const knobs = getKnobs(d);
  const now = logLen(d);
  if (T === null) T = now;
  if (T > now) T = now;

  if (T === 0) {
    return { text: 'No memories yet. The first conversation will create one.', memories: 0 };
  }

  const lines = [];
  for (const [lo, hi] of cover(T, knobs.WAKE_LINES)) {
    if (hi - lo === 1) {
      const [id, date, text] = logGet(d, lo);
      lines.push(`#${id} ${date} ${text}`);
    } else {
      let s = treeGet(d, lo, hi);
      if (s === null) {
        // 需要压缩但还没做 — 自动触发压缩提示
        const nap = nextNap(d, T, knobs);
        if (nap) {
          return {
            text: `Cannot wake fully: #${lo}-${hi - 1} needs compression.\n\n${nap}`,
            needsCompression: true,
            block: [lo, hi],
          };
        }
        s = treeGet(d, lo, hi); // 并行会话可能已完成
      }
      if (s === null) continue;
      lines.push(`#${lo}-${hi - 1} ${s}`);
    }
  }

  const parts = paginate(lines, knobs);
  if (part < 1 || part > parts.length) {
    return `No part ${part}: the memory has ${plural(parts.length, 'part')}.`;
  }

  let output = '';
  if (parts.length > 1) {
    output += `Your memory, part ${part} of ${parts.length}, oldest first (${plural(T, 'memory')}).\n`;
  }
  output += parts[part - 1].join('\n');

  const nap = nextNap(d, T, knobs);
  if (nap) output += '\n\n' + nap;

  return { text: output, parts: parts.length, currentPart: part };
}

/**
 * note — 追加一条记忆
 */
export async function cmd_note(d, text) {
  d = ensureStore(d);
  const knobs = getKnobs(d);
  text = check(text, knobs.ENTRY_CHARS);
  const i = await logAppend(d, [{ date: todayISO(), text }]);
  const nap = nextNap(d, i + 1, knobs);
  let output = `Saved as #${i}.`;
  if (nap) output += '\n\n' + nap;
  return { text: output, id: i, nap: nap || null };
}

/**
 * nap — 压缩一个块
 */
export async function cmd_nap(d, blockIdStr, summary) {
  d = ensureStore(d);
  const knobs = getKnobs(d);
  const T = logLen(d);
  const todo = pending(d, T, 1);

  if (!todo.length) {
    return { text: 'Nothing left to compress.' };
  }

  if (blockIdStr) {
    const [lo, hi] = blockId(blockIdStr);
    if (lo !== todo[0][0] || hi !== todo[0][1]) {
      const existing = treeGet(d, lo, hi);
      if (existing !== null) {
        return { text: `${blockIdStr} is already settled.` };
      }
      throw new Error(`Wrong block: ${blockIdStr}. The next is ${todo[0][0]}-${todo[0][1] - 1}.`);
    }
    summary = check(summary, knobs.ENTRY_CHARS);
    if (!(await treePut(d, lo, hi, summary))) {
      return { text: `${blockIdStr} was settled or forgotten meanwhile.` };
    }
  }

  const nap = nextNap(d, T, knobs);
  if (!nap) return { text: 'Nothing left to compress.' };
  return { text: nap, done: blockIdStr ? `${blockIdStr} saved.` : '' };
}

/**
 * recall — 全文正则搜索
 */
export function cmd_recall(d, pattern) {
  d = ensureStore(d);
  const knobs = getKnobs(d);
  let regex;
  try {
    regex = new RegExp(pattern, 'i');
  } catch (e) {
    throw new Error(`Bad regex: ${e.message}`);
  }

  const all = logScan(d);
  const hits = [];
  for (const [id, date, text] of all) {
    const line = `#${id} ${date} ${text}`;
    if (regex.test(line)) hits.push(line);
  }

  if (!hits.length) return { text: 'No match.', hits: [] };

  // 只返回最新的，不超过 PART_CHARS
  const out = [];
  let size = 0;
  for (let i = hits.length - 1; i >= 0; i--) {
    const n = byteLen(hits[i]) + 1;
    if (size + n > knobs.PART_CHARS && out.length > 0) break;
    out.unshift(hits[i]);
    size += n;
  }

  let text = out.join('\n');
  if (out.length < hits.length) {
    text += `\nNewest ${out.length} of ${plural(hits.length, 'match')}. Narrow the regex.`;
  }
  return { text, hits: out, total: hits.length, shown: out.length };
}

/**
 * zoom — 展开一个树节点
 */
export function cmd_zoom(d, blockIdStr) {
  d = ensureStore(d);
  const [lo, hi] = blockId(blockIdStr);
  const T = logLen(d);
  if (lo >= T) {
    return { text: `#${blockIdStr} is beyond the memory: it holds ${plural(T, 'memory')}.` };
  }
  const mid = Math.floor((lo + hi) / 2);
  const lines = [];
  for (const [a, b] of [[lo, mid], [mid, hi]]) {
    if (a >= T) continue;
    if (b - a === 1) {
      const [id, date, text] = logGet(d, a);
      lines.push(`#${id} ${date} ${text}`);
    } else {
      const s = treeGet(d, a, b);
      lines.push(`#${a}-${b - 1} ${s || 'not compressed yet'}`);
    }
  }
  return { text: lines.join('\n') };
}

/**
 * forget — 丢弃一个摘要（nap 会重建）
 */
export async function cmd_forget(d, blockIdStr) {
  d = ensureStore(d);
  const [lo, hi] = blockId(blockIdStr);
  const gone = await treeDrop(d, lo, hi);
  if (!gone.length) throw new Error(`No summary at ${blockIdStr}.`);
  return {
    text: `Forgot ${plural(gone.length, 'summary')}, from ${gone[0][0]}-${gone[0][1] - 1} up.`,
  };
}

/**
 * getAllMemories — 获取全部记忆（UI 展示用，非 OptMem 原生命令）
 */
export function cmd_getAll(d) {
  d = ensureStore(d);
  const T = logLen(d);
  if (T === 0) return { memories: [], total: 0 };
  const all = logScan(d);
  return {
    memories: all.map(([id, date, text]) => ({ id, date, text })),
    total: T,
  };
}

/**
 * config — 读取/设置尺寸
 */
export function cmd_config(d, changes = {}) {
  d = ensureStore(d);
  const overrides = readConfig(d);
  for (const [k, v] of Object.entries(changes)) {
    const key = k.toUpperCase();
    if (!(key in DEFAULT_KNOBS)) continue;
    if (v === null || v === undefined || v === '') {
      delete overrides[key];
    } else {
      overrides[key] = parseInt(v, 10);
    }
  }
  writeConfig(d, overrides);
  const knobs = getKnobs(d);
  return { knobs, overrides };
}

/**
 * getStats — 统计信息（UI 用）
 */
export function cmd_getStats(d) {
  d = ensureStore(d);
  const T = logLen(d);
  const knobs = getKnobs(d);
  const treeSizes = [];
  const treeDir = path.join(d, 'TREE');
  if (fs.existsSync(treeDir)) {
    for (const f of fs.readdirSync(treeDir)) {
      const sz = parseInt(f, 10);
      if (!isNaN(sz)) {
        treeSizes.push({ size: sz, count: countRecords(path.join(treeDir, f), TREE_REC) });
      }
    }
  }
  const pendingCompressions = pendingCount(d, T);
  return { totalMemories: T, knobs, pendingCompressions, treeLevels: treeSizes };
}

/**
 * deleteMany — 批量删除记忆（BizOwl 扩展）
 *
 * LOG.txt 是 append-only 的固定宽度记录，无法直接删除中间行。
 * 方案：读取全部记录 → 过滤掉指定 ID → 重写 LOG.txt（ID 自动重新编号）
 *      → 清空 TREE/ → autoCompress 重建树。
 *
 * @param {string} d  记忆目录
 * @param {number[]} ids  要删除的记忆 ID 数组
 * @returns {{ deleted: number, remaining: number }}
 */
export async function cmd_deleteMany(d, ids) {
  d = ensureStore(d);
  const idSet = new Set(ids);
  const T = logLen(d);
  if (T === 0) return { deleted: 0, remaining: 0 };

  const all = logScan(d); // [[id, date, text], ...]
  const survivors = [];
  let deleted = 0;

  for (const [id, date, text] of all) {
    if (idSet.has(id)) {
      deleted++;
    } else {
      survivors.push({ date, text });
    }
  }

  if (deleted === 0) return { deleted: 0, remaining: T };

  // 重写 LOG.txt（通过 withLock 保护）
  await withLock(d, () => {
    const chunks = [];
    for (let k = 0; k < survivors.length; k++) {
      const { date, text } = survivors[k];
      // 只截断 text 部分，保护前缀（#id date）不被破坏
      const prefix = `#${k} ${date} `;
      const maxTextBytes = LOG_REC - 1 - byteLen(prefix);
      const safeText = truncateToBytes(text, Math.max(0, maxTextBytes));
      const line = prefix + safeText;
      chunks.push(pad(line, LOG_REC));
    }
    const buf = Buffer.concat(chunks);
    fs.writeFileSync(logPath(d), buf);
  });

  // 清空 TREE/（所有摘要失效，因为 ID 全部重新编号了）
  const treeDir = path.join(d, 'TREE');
  if (fs.existsSync(treeDir)) {
    for (const f of fs.readdirSync(treeDir)) {
      fs.truncateSync(path.join(treeDir, f), 0);
    }
  }

  // autoCompress 重建树
  if (survivors.length > 0) {
    await cmd_autoCompress(d);
  }

  return { deleted, remaining: survivors.length };
}

// ─── CLI 入口（node memo.js <cmd> [args]）───

async function cliMain() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: memo <init|wake|note|nap|recall|zoom|forget|config|stats>');
    process.exit(1);
  }

  const cmd = args[0];
  const d = defaultMemoryDir();

  try {
    let result;
    switch (cmd) {
      case 'init':
        result = cmd_init(d); break;
      case 'wake':
        result = await cmd_wake(d, parseInt(args[1] || '1', 10),
          args[2] ? parseInt(args[2], 10) : null); break;
      case 'note':
        result = await cmd_note(d, args[1] || ''); break;
      case 'nap':
        result = await cmd_nap(d, args[1], args[2]); break;
      case 'recall':
        result = cmd_recall(d, args[1] || ''); break;
      case 'zoom':
        result = cmd_zoom(d, args[1]); break;
      case 'forget':
        result = await cmd_forget(d, args[1]); break;
      case 'config':
        result = cmd_config(d); break;
      case 'stats':
        result = cmd_getStats(d); break;
      case 'all':
        result = cmd_getAll(d); break;
      default:
        console.error(`Unknown command: ${cmd}`);
        process.exit(1);
    }
    if (typeof result === 'string') console.log(result);
    else if (result?.text) console.log(result.text);
    else console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

// 当直接执行时运行 CLI
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  cliMain();
}
