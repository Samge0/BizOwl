/**
 * optmem-bridge.js — BizOwl ↔ OptMem 记忆桥接（内置 Node.js 版）
 *
 * 职责：
 * 1. wake()：读取记忆上下文（~96 行压缩摘要），注入 system prompt
 * 2. note()：写入一条记忆
 * 3. extractAndNote()：用 LLM 从对话中提取值得记住的信息并写入
 * 4. getUserMd() / setUserMd()：读取/写入用户画像文件
 *
 * 存储目录：~/.BizOwl/memory/（LOG.txt + TREE/ + USER.md）
 * 核心引擎：./memo.js（纯 Node.js，零外部依赖）
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { buildRequestUrl } from '../agent/agent-loop.js';
import * as memo from './memo.js';

const MEMORY_DIR = path.join(os.homedir(), '.BizOwl', 'memory');
const USER_MD_PATH = path.join(MEMORY_DIR, 'USER.md');

const USER_MD_TEMPLATE = `# 用户画像

<!-- BizOwl 会在对话中逐步填充此文件。你也可以手动编辑。 -->

## 基本信息
- **称呼**:
- **行业/职业**:
- **时区**:

## 偏好
- **语言**:
- **回复风格**:
- **分析深度**:

## 常用工具/技术栈

## 重要备注
`;

/**
 * 读取记忆上下文（wake）
 * @returns {Promise<string|null>} 记忆上下文文本，无记忆时返回 null
 */
export async function optmemWake() {
  try {
    const result = await memo.cmd_wake(MEMORY_DIR);
    if (result?.text) {
      // 去掉无用的状态行
      return result.text;
    }
    return null;
  } catch (e) {
    console.warn('[OptMem] wake 失败:', e.message);
    return null;
  }
}

/**
 * 写入一条记忆
 */
export async function optmemNote(text) {
  if (!text || !text.trim()) return false;
  try {
    const result = await memo.cmd_note(MEMORY_DIR, text.trim());
    console.log('[OptMem] 记忆已写入:', text.slice(0, 60));
    return true;
  } catch (e) {
    console.warn('[OptMem] note 失败:', e.message);
    return false;
  }
}

/**
 * 搜索记忆
 */
export async function optmemRecall(query) {
  try {
    const result = memo.cmd_recall(MEMORY_DIR, query);
    return result;
  } catch (e) {
    return { text: `Search error: ${e.message}`, hits: [] };
  }
}

/**
 * 获取全部记忆（UI 展示用）
 */
export async function optmemGetAll() {
  return memo.cmd_getAll(MEMORY_DIR);
}

/**
 * 获取统计信息（UI 展示用）
 */
export async function optmemGetStats() {
  return memo.cmd_getStats(MEMORY_DIR);
}

/**
 * 批量删除记忆
 * @param {number[]} ids  要删除的记忆 ID 数组
 * @returns {Promise<{ deleted: number, remaining: number }>}
 */
export async function optmemDeleteMany(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return { deleted: 0, remaining: 0 };
  return await memo.cmd_deleteMany(MEMORY_DIR, ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id)));
}

/**
 * 读取 USER.md
 */
export async function getUserMd() {
  try {
    if (!fs.existsSync(USER_MD_PATH)) {
      // 首次访问，创建模板
      memo.ensureStore(MEMORY_DIR);
      fs.writeFileSync(USER_MD_PATH, USER_MD_TEMPLATE, 'utf8');
      return USER_MD_TEMPLATE;
    }
    return fs.readFileSync(USER_MD_PATH, 'utf8');
  } catch (e) {
    console.warn('[OptMem] getUserMd 失败:', e.message);
    return USER_MD_TEMPLATE;
  }
}

/**
 * 写入 USER.md
 */
export async function setUserMd(content) {
  try {
    memo.ensureStore(MEMORY_DIR);
    fs.writeFileSync(USER_MD_PATH, content || '', 'utf8');
    return true;
  } catch (e) {
    console.warn('[OptMem] setUserMd 失败:', e.message);
    return false;
  }
}

/**
 * 用 LLM 从一轮对话中提取值得记住的信息，写入记忆
 *
 * 策略：把用户消息 + 助手回复发给 LLM，让它判断是否包含值得长期记住的
 * 用户偏好/决策/经验/事实，如果有则输出 ≤280 字节的记忆条目。
 */
export async function extractAndNote({ modelId, baseUrl, apiKey, messages }) {
  try {
    // 只取最近几条消息（控制 token 消耗）
    const recent = messages.slice(-6);
    const conversation = recent
      .map(m => `${m.role === 'user' ? '用户' : '助手'}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
      .join('\n\n');

    const extractPrompt = `分析以下对话，提取值得记住的信息。像一个人回忆今天做过的事一样——不仅是偏好，也包括查了什么、关注了什么。

提取这些类型的信息：

**A. 行为轨迹（必记）**
- 用户查询了哪家企业/产品/人物，属于什么行业、地区、企业类型
- 用户关注了哪些维度（如注册资本、股权结构、风险、财务、知识产权）
- 用户做了什么操作（如对比、导出、深入某个方向）

**B. 用户画像（必记）**
- 用户透露的行业、职业、工作场景
- 语言偏好、回复风格偏好、分析深度偏好
- 常用的工具或技术栈

**C. 决策与结论**
- 用户做出的判断或决定
- 用户纠正了你错误的反馈

规则：
- 每条记忆不超过 280 字节（约 90 个中文字）
- 用简洁的事实陈述句，如"用户查询了华为技术（通信设备制造，广东深圳），关注注册资本和法定代表人"
- 同一对话可输出多条，用换行分隔
- 只有完全无意义的对话（如纯打招呼）才回复 NONE
- 不要输出解释，直接输出记忆条目

对话内容：
${conversation}`;

    const result = await llmOneShot({
      modelId, baseUrl, apiKey,
      messages: [
        { role: 'system', content: '你是一个记忆提取器。从对话中提取行为轨迹（查了什么企业/关注什么维度）、用户画像和偏好、决策结论。像人一样——做过的事也值得记。每条不超过 280 字节，多条用换行分隔。纯打招呼才输出 NONE。' },
        { role: 'user', content: extractPrompt },
      ],
      temperature: 0.3,
    });

    if (!result || result.trim() === 'NONE' || result.trim().length < 5) return;

    // 可能包含多条记忆（用分号或换行分隔），逐条写入
    const notes = result
      .split(/[;\n；]/)
      .map(s => s.trim())
      .filter(s => s.length >= 5 && s.length <= 280);

    for (const note of notes.slice(0, 3)) {
      await optmemNote(note);
    }
  } catch (err) {
    console.warn('[OptMem] 记忆提取失败（不影响主流程）:', err.message);
  }
}

/**
 * 一次性 LLM 调用（非流式），用于记忆提取
 */
function llmOneShot({ modelId, baseUrl, apiKey, messages, temperature = 0.3 }) {
  return new Promise((resolve, reject) => {
    const targetUrl = buildRequestUrl(baseUrl);
    const transport = targetUrl.protocol === 'http:' ? http : https;

    const body = JSON.stringify({ model: modelId, messages, temperature, stream: false });

    // 总超时（30s）：req.setTimeout 只检测 socket idle，缓慢但持续的数据流会不断重置它。
    // 用独立定时器保证整个请求不会超过 30s。
    let settled = false;
    const totalTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      req.destroy(new Error('总超时（30s）'));
      reject(new Error('LLM 提取请求总超时（30s）'));
    }, 30000);

    const req = transport.request(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    }, (res) => {
      const dec = new TextDecoder('utf-8');
      let data = '';
      res.on('data', (c) => { data += dec.decode(c, { stream: true }); });
      res.on('end', () => {
        if (settled) return;
        settled = true;
        clearTimeout(totalTimer);
        data += dec.decode();
        // 非 200（如 401/429/500）：明确报错，而非把错误体当空内容静默吞掉
        if (res.statusCode !== 200) {
          reject(new Error(`LLM 提取请求失败: HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
          return;
        }
        try {
          const json = JSON.parse(data);
          const content = json.choices?.[0]?.message?.content;
          resolve(content || '');
        } catch (e) {
          reject(new Error(`LLM parse error: ${e.message}`));
        }
      });
    });

    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      reject(err);
    });
    req.setTimeout(15000, () => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      req.destroy();
      reject(new Error('timeout'));
    });
    req.write(body);
    req.end();
  });
}
