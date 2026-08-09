/**
 * logger.js — 统一日志系统
 *
 * 日志存储：~/.BizOwl/logs/app-YYYY-MM-DD.log
 * 支持级别：debug / info / warn / error
 * 按天滚动，保留最近 7 天
 */

import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

const LOG_DIR = path.join(homedir(), '.BizOwl', 'logs');
const MAX_LOG_DAYS = 7;
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB 单文件上限

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function getLogFilePath() {
  const today = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `app-${today}.log`);
}

/** 清理过期日志文件 */
function cleanOldLogs() {
  try {
    const files = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.log'));
    const cutoff = Date.now() - MAX_LOG_DAYS * 24 * 60 * 60 * 1000;
    for (const f of files) {
      const fp = path.join(LOG_DIR, f);
      const stat = fs.statSync(fp);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(fp);
      }
    }
  } catch {}
}

/** 写日志到文件 */
function writeLog(level, tag, message, extra) {
  ensureLogDir();
  cleanOldLogs();

  const time = new Date().toISOString();
  const line = `[${time}] [${level.toUpperCase()}] [${tag}] ${message}${extra ? ' ' + JSON.stringify(extra) : ''}\n`;

  // 控制台输出
  if (level === 'error') console.error(line.trim());
  else if (level === 'warn') console.warn(line.trim());
  else console.log(line.trim());

  // 文件写入
  try {
    const fp = getLogFilePath();
    // 检查文件大小，超过上限时重命名归档
    if (fs.existsSync(fp) && fs.statSync(fp).size > MAX_LOG_SIZE) {
      const archive = fp.replace('.log', `-${Date.now()}.log`);
      fs.renameSync(fp, archive);
    }
    fs.appendFileSync(fp, line, 'utf8');
  } catch (err) {
    console.error('[Logger] 写日志失败:', err.message);
  }
}

/** 创建带 tag 的日志器 */
export function createLogger(tag) {
  return {
    debug: (msg, extra) => writeLog('debug', tag, msg, extra),
    info: (msg, extra) => writeLog('info', tag, msg, extra),
    warn: (msg, extra) => writeLog('warn', tag, msg, extra),
    error: (msg, extra) => writeLog('error', tag, msg, extra),
  };
}

/** 导出日志（返回全部日志内容字符串） */
export function exportLogs(maxLines = 2000) {
  ensureLogDir();
  const files = fs.readdirSync(LOG_DIR)
    .filter(f => f.endsWith('.log'))
    .sort()
    .reverse(); // 最近的在前

  const lines = [];
  for (const f of files) {
    const content = fs.readFileSync(path.join(LOG_DIR, f), 'utf8');
    const fileLines = content.trim().split('\n');
    lines.push(`\n===== ${f} =====\n`);
    lines.push(...fileLines);
    if (lines.length >= maxLines) break;
  }

  return lines.slice(0, maxLines).join('\n');
}

/** 导出日志到指定文件路径 */
export function exportLogsToFile(destPath, maxLines = 5000) {
  const content = exportLogs(maxLines);
  fs.writeFileSync(destPath, content, 'utf8');
  return { path: destPath, size: content.length, lines: content.split('\n').length };
}

/** 获取日志目录路径 */
export function getLogDir() {
  return LOG_DIR;
}
