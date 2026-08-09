/**
 * agent-loop.js — 内置 Agent Loop
 *
 * 工作流程：
 * 1. 发送 messages + tools 给 LLM
 * 2. 如果 LLM 返回 tool_calls → 执行工具 → 把结果加入 messages → 回到步骤1
 * 3. 如果 LLM 返回普通文本 → 流式输出给用户 → 结束
 *
 * 支持：
 * - OpenAI 标准 function calling（tool_calls）
 * - 流式输出（SSE）
 * - 最大循环次数限制（防止死循环）
 * - 进度回调（通知 UI 当前在执行什么工具）
 * - Token 统计（优先使用 API 返回的 usage，降级为粗略估算）
 */

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { getToolsForApi, executeTool } from './tools.js';
import { getQccToolsForApi, executeQccTool, isQccTokenExpired, QCC_TOKEN_EXPIRED_MSG } from './datasource-tools.js';
import { refreshIfEnabled } from '../auth/datasource-auth.js';

// ─── Token 估算工具（参考 Hermes 的 estimate_tokens_rough 算法） ───
const _CJK_DENSE_RE = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/g;

/**
 * 粗略估算文本 token 数（用于 API 不返回 usage 时的降级统计）。
 * - ASCII 文本约 4 字符/token
 * - CJK/韩日文字符约 1 字符/token（tokenizer 更密集）
 */
function estimateTokensRough(text) {
  if (!text) return 0;
  text = String(text);
  if (text.isascii && text.isascii()) {
    return (text.length + 3) / 4 | 0;
  }
  // 非 ASCII：统计 CJK 密集字符
  const matches = text.match(_CJK_DENSE_RE);
  const dense = matches ? matches.length : 0;
  if (!dense) return (text.length + 3) / 4 | 0;
  const sparse = text.length - dense;
  return dense + ((sparse + 3) / 4 | 0);
}

/**
 * 粗略估算消息列表的 token 总数（含图片维度降级）
 */
function estimateMessagesTokens(messages) {
  const IMAGE_TOKEN_COST = 1500;
  let total = 0;
  for (const msg of messages) {
    if (!msg) continue;
    // content 可能是字符串或多模态数组
    if (typeof msg.content === 'string') {
      total += estimateTokensRough(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text') total += estimateTokensRough(part.text || '');
        else if (part.type === 'image_url') total += IMAGE_TOKEN_COST;
      }
    }
    // tool_calls 的参数也算
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        total += estimateTokensRough(tc.function?.arguments || '');
      }
    }
  }
  return total;
}

const MAX_ITERATIONS = 25; // 最大工具调用循环次数（企业尽调多维查询需要足够余量）

/**
 * 超时配置：区分"首字节等待"和"流传输中空闲"两种场景。
 *
 * 首字节等待（模型在 thinking / 生成 tool_call 大参数时无任何输出）：
 *   - 普通对话：90s（用户快速交互）
 *   - 研究类任务（报告生成/深度分析）：300s（模型需要长时间思考+组织结构）
 *
 * 流传输中空闲（已经收到一些数据，但中途卡住）：
 *   - 普通对话：60s（已有连接，不应长时间无数据）
 *   - 研究类任务：600s（长报告生成中，推理模型在章节间"思考"、API 网关/代理
 *     批量缓冲 SSE 都会产生 >60s 的合法间隔；60s 过于激进会把一份快写完的报告
 *     拦腰切断，丢失整段内容）
 *
 * 超时行为：不 reject（不中断 agent loop），而是 resolve 已收集的部分数据，
 * 让上层决定如何处理（生成部分结论 / 继续下一轮）。
 */
const TIMEOUT_CONFIG = {
  firstByteNormal: 90000,       // 90s 普通对话首字节等待
  firstByteResearch: 300000,    // 300s (5min) 研究类任务首字节等待
  streamIdleNormal: 60000,      // 60s 普通对话流传输中空闲超时
  streamIdleResearch: 1800000,   // 1800s (30min) 研究类任务流传输中空闲超时（长报告生成抗中断）
};

// 暴露内置默认（毫秒）供 main.cjs 在设置页配置缺失/非法时 fallback
export const DEFAULT_TIMEOUT_MS = TIMEOUT_CONFIG;

/**
 * 判断当前任务是否为"研究类"（需要更长超时）
 * 基于消息内容的关键词启发式判断
 */
function isResearchTask(messages) {
  if (!messages || messages.length === 0) return false;
  // 检查所有消息（含 system prompt）——研究类 agent 的 system prompt 包含工具列表，
  // 其中 report_export 的出现是强信号：该会话一定涉及长报告生成。
  const allText = messages
    .map(m => typeof m.content === 'string' ? m.content : '')
    .join(' ')
    .toLowerCase();
  // 如果 system prompt 中包含 report_export 工具，说明用户选择了研究类 agent
  if (allText.includes('report_export')) return true;

  // 检查最后几条用户消息
  const recentUserMsgs = messages
    .filter(m => m.role === 'user')
    .slice(-3)
    .map(m => typeof m.content === 'string' ? m.content : '');
  const combined = recentUserMsgs.join(' ').toLowerCase();
  // 研究类关键词（含常见触发词）
  const researchKeywords = [
    '研究报告', '调研', '分析报告', '深度分析', '行业报告',
    '尽调', '尽职调查', '可行性', '市场分析', '竞争分析',
    '白皮书', '可行性研究', '商业计划', '投资分析',
    '布局', '全景', '深度解读', '产业研究', '行业研究',
    'report', 'research', 'analysis', 'study',
  ];
  return researchKeywords.some(kw => combined.includes(kw));
}

/**
 * 构造 chat completions 请求 URL
 * - 已以 /chat/completions 结尾 → 原样
 * - 已带版本段（/v1 /v2 /v4 …）→ 只补 /chat/completions
 * - 否则按 OpenAI 默认补 /v1/chat/completions
 */
export function buildRequestUrl(baseUrl) {
  const u = new URL(baseUrl);
  if (u.pathname.endsWith('/chat/completions')) return u;
  if (/\/v\d+\/?$/.test(u.pathname)) {
    u.pathname = u.pathname.replace(/\/$/, '') + '/chat/completions';
  } else {
    u.pathname = u.pathname.replace(/\/$/, '') + '/v1/chat/completions';
  }
  return u;
}

/**
 * 把流式累积的 tool_calls 片段组装成 OpenAI tool_calls 数组
 * acc: { index: { id, name, arguments } }
 */
function buildToolCalls(acc) {
  return Object.keys(acc)
    .sort((a, b) => +a - +b)
    .map((i) => ({
      id: acc[i].id || `call_${i}`,
      type: 'function',
      function: { name: acc[i].name, arguments: acc[i].arguments || '{}' },
    }))
    .filter((tc) => tc.function.name);
}

/**
 * 流式请求（支持 tools）：边收边把 delta.content 推给 onData，
 * 同时累积 delta.tool_calls；返回 { text, toolCalls, timedOut, usage }。
 *
 * Token 统计：
 *   - OpenAI 兼容 API 在流式最后一个 chunk（或单独的 usage chunk）返回 usage 对象
 *   - 如果 API 不返回 usage，上层 runAgentLoop 会用粗略估算降级
 *
 * 超时策略：
 *   - 首字节等待：firstByteTimeout（普通 90s / 研究 300s）
 *   - 流传输中空闲：streamIdleTimeout（普通 60s / 研究 600s）
 *   - 超时后 resolve 已收集的部分数据（timedOut=true），不 reject
 *     → 上层 agent loop 可基于已收集数据生成部分结论
 */
function llmStreamWithTools({ modelId, baseUrl, apiKey, messages, tools, temperature = 0.7, onData, onProgress, iteration, signal, firstByteTimeout, streamIdleTimeout }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('ABORTED')); return; }
    const targetUrl = buildRequestUrl(baseUrl);
    const transport = targetUrl.protocol === 'http:' ? http : https;

    // 应用超时配置
    const fbTimeout = firstByteTimeout ?? TIMEOUT_CONFIG.firstByteNormal;
    const idleTimeout = streamIdleTimeout ?? TIMEOUT_CONFIG.streamIdleNormal;

    // stream_options: { include_usage: true } → 让 API 在流末尾返回 usage
    const body = JSON.stringify({
      model: modelId,
      messages,
      ...(tools && tools.length > 0 ? { tools } : {}),
      stream: true,
      stream_options: { include_usage: true },
      temperature,
    });

    let fullText = '';
    const toolCallsAcc = {};
    let buffer = '';
    let settled = false;
    let receivedAnyData = false;  // 是否已收到任何 SSE 数据
    let idleTimer = null;          // 空闲超时计时器
    let streamUsage = null;        // SSE 返回的 usage 对象（prompt_tokens / completion_tokens / total_tokens）
    // UTF-8 流式解码器：跨 chunk 的多字节字符不会断裂
    const decoder = new TextDecoder('utf-8', { fatal: false });

    // ─── 超时处理：优雅降级而非崩溃 ───
    // resolve 已收集的部分数据，标记 timedOut=true 让上层决定后续操作
    const handleTimeout = (reason, isFirstByte) => {
      if (settled) return;
      settled = true;
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      req.destroy();
      console.warn(`[Agent:stream] 超时降级: ${reason} (已收集 ${fullText.length} 字符文本, ${Object.keys(toolCallsAcc).length} 个工具调用片段)`);
      resolve({
        text: fullText,
        toolCalls: buildToolCalls(toolCallsAcc),
        timedOut: true,
        timeoutReason: reason,
        isFirstByteTimeout: isFirstByte,
        usage: streamUsage,
      });
    };

    // 首字节超时计时器：在收到第一个 SSE data 之前启动
    const firstByteTimer = setTimeout(() => {
      if (!receivedAnyData) {
        handleTimeout(`首字节等待超时(${fbTimeout/1000}s)`, true);
      }
    }, fbTimeout);

    const req = transport.request(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        Accept: 'text/event-stream',
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        clearTimeout(firstByteTimer);
        if (idleTimer) clearTimeout(idleTimer);
        const errDecoder = new TextDecoder('utf-8');
        let errBody = '';
        res.on('data', (c) => { errBody += errDecoder.decode(c, { stream: true }); });
        res.on('end', () => { errBody += errDecoder.decode(); reject(new Error(`API HTTP ${res.statusCode}: ${errBody.slice(0, 500)}`)); });
        return;
      }
      // 兼容旧版：保留 res.setTimeout 作为保底（但主要逻辑用自定义计时器）
      res.setTimeout(idleTimeout + 10000, () => {
        // 这是 Node.js 层面的保底超时，正常情况下自定义计时器会先触发
        if (!settled) handleTimeout('响应流保底超时', false);
      });

      res.on('data', (chunk) => {
        if (settled) return;

        // 收到第一个数据块 → 清除首字节计时器，启动空闲计时器
        if (!receivedAnyData) {
          receivedAnyData = true;
          clearTimeout(firstByteTimer);
        }
        // 重置空闲计时器：每次收到数据都重新倒计时
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          handleTimeout(`流传输空闲超时(${idleTimeout/1000}s)`, false);
        }, idleTimeout);

        // 用 TextDecoder 流式解码，避免多字节 UTF-8 字符在 chunk 边界断裂
        buffer += decoder.decode(chunk, { stream: true });
        // 兼容 \n\n 和 \r\n\r\n 两种 SSE 事件分隔符
        const parts = buffer.split(/\r?\n\r?\n/);
        buffer = parts.pop();

        for (const part of parts) {
          for (const line of part.split(/\r?\n/)) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') {
              settled = true;
              clearTimeout(firstByteTimer);
              if (idleTimer) clearTimeout(idleTimer);
              resolve({ text: fullText, toolCalls: buildToolCalls(toolCallsAcc), timedOut: false, usage: streamUsage });
              return;
            }
            try {
              const json = JSON.parse(data);
              // 捕获 usage（OpenAI 流式在最后 chunk 或单独 usage chunk 返回）
              if (json.usage) {
                streamUsage = {
                  prompt_tokens: json.usage.prompt_tokens || json.usage.input_tokens || 0,
                  completion_tokens: json.usage.completion_tokens || json.usage.output_tokens || 0,
                  total_tokens: json.usage.total_tokens || 0,
                };
              }
              const delta = json.choices?.[0]?.delta;
              if (!delta) continue;
              if (delta.content) {
                fullText += delta.content;
                if (onData) onData(delta.content);
              }
              if (Array.isArray(delta.tool_calls)) {
                for (const tc of delta.tool_calls) {
                  const idx = (tc.index ?? 0);
                  if (!toolCallsAcc[idx]) toolCallsAcc[idx] = { id: '', name: '', arguments: '', _lastReport: -Infinity };
                  if (tc.id) toolCallsAcc[idx].id = tc.id;
                  if (tc.function?.name) toolCallsAcc[idx].name = tc.function.name;
                  if (tc.function?.arguments) toolCallsAcc[idx].arguments += tc.function.arguments;
                  // 大参数工具（report_export 要把整份报告作为参数逐字生成）可能持续数分钟；
                  // 此阶段 tool_start 尚未触发、也无文本 delta，UI 会显得"卡住"。
                  // 节流上报"正在生成哪个工具的参数 + 已生成字符数"，让前端持久状态条显示实时进度。
                  const accItem = toolCallsAcc[idx];
                  if (accItem.name && onProgress) {
                    const len = accItem.arguments.length;
                    if (len - accItem._lastReport >= 800) {
                      accItem._lastReport = len;
                      onProgress({ type: 'tool_arg_progress', tool: accItem.name, argsLength: len, iteration });
                    }
                  }
                }
              }
            } catch {
              // 忽略非 JSON 行
            }
          }
        }
      });

      res.on('end', () => {
        clearTimeout(firstByteTimer);
        if (idleTimer) clearTimeout(idleTimer);
        // flush decoder 剩余字节
        const tail = decoder.decode();
        if (tail) buffer += tail;
        // 处理末尾未带分隔符的最后一个 SSE 事件（某些代理/网关在关闭前不补 \r\n\r\n）。
        if (!settled && buffer.trim()) {
          for (const line of buffer.split(/\r?\n/)) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') { settled = true; break; }
            try {
              const json = JSON.parse(data);
              // 捕获 usage（尾部 flush 同样需要检查）
              if (json.usage) {
                streamUsage = {
                  prompt_tokens: json.usage.prompt_tokens || json.usage.input_tokens || 0,
                  completion_tokens: json.usage.completion_tokens || json.usage.output_tokens || 0,
                  total_tokens: json.usage.total_tokens || 0,
                };
              }
              const delta = json.choices?.[0]?.delta;
              if (!delta) continue;
              if (delta.content) { fullText += delta.content; if (onData) onData(delta.content); }
              if (Array.isArray(delta.tool_calls)) {
                for (const tc of delta.tool_calls) {
                  const idx = (tc.index ?? 0);
                  if (!toolCallsAcc[idx]) toolCallsAcc[idx] = { id: '', name: '', arguments: '', _lastReport: -Infinity };
                  if (tc.id) toolCallsAcc[idx].id = tc.id;
                  if (tc.function?.name) toolCallsAcc[idx].name = tc.function.name;
                  if (tc.function?.arguments) toolCallsAcc[idx].arguments += tc.function.arguments;
                }
              }
            } catch { /* 忽略非 JSON 行 */ }
          }
          buffer = '';
        }
        if (!settled) resolve({ text: fullText, toolCalls: buildToolCalls(toolCallsAcc), timedOut: false, usage: streamUsage });
      });
    });

    req.on('error', (e) => {
      clearTimeout(firstByteTimer);
      if (idleTimer) clearTimeout(idleTimer);
      reject(signal?.aborted ? new Error('ABORTED') : e);
    });
    if (signal) signal.addEventListener('abort', () => {
      clearTimeout(firstByteTimer);
      if (idleTimer) clearTimeout(idleTimer);
      req.destroy();
    }, { once: true });
    req.write(body);
    req.end();
  });
}

/**
 * 运行 Agent Loop
 *
 * @param {Object} options
 * @param {string} options.modelId
 * @param {string} options.baseUrl
 * @param {string} options.apiKey
 * @param {Array} options.messages - 对话历史 [{role, content}]
 * @param {Function} options.onProgress - 进度回调 (event) => void
 * @param {Function} options.onData - 流式文本回调 (delta) => void
 * @param {AbortSignal} options.signal - 取消信号
 * @param {boolean} options.enableTools - 是否启用工具调用
 * @returns {Promise<string>} 最终回复文本
 */
export async function runAgentLoop({
  modelId, baseUrl, apiKey, messages,
  onProgress, onData, signal, enableTools = true,
  qccToken = null, // 数据源 accessToken，有值时动态加入数据工具
  timeoutConfig = {}, // 设置页传入的超时覆盖（毫秒），缺省/非法回落内置 TIMEOUT_CONFIG
  onUsage = null, // Token 用量回调 (usage) => void，每次迭代结束时调用
}) {
  // 合并工具：内置工具 + 数据工具（有 token 时）
  const builtinTools = enableTools ? getToolsForApi() : [];
  const qccTools = (enableTools && qccToken) ? getQccToolsForApi() : [];
  const tools = [...builtinTools, ...qccTools];

  // 合并内置默认与设置页传入的超时配置（外部覆盖内部）
  const tc = { ...TIMEOUT_CONFIG, ...timeoutConfig };
  // 研究类任务检测 → 使用更长首字节 & 流传输空闲超时
  const researchMode = isResearchTask(messages);
  const firstByteTimeout = researchMode ? tc.firstByteResearch : tc.firstByteNormal;
  const streamIdleTimeout = researchMode ? tc.streamIdleResearch : tc.streamIdleNormal;
  if (researchMode) {
    console.log(`[Agent:loop] 检测到研究类任务，首字节超时 ${firstByteTimeout/1000}s / 流空闲超时 ${streamIdleTimeout/1000}s`);
  }

  if (qccTools.length > 0) {
    console.log(`[Agent:loop] 工具列表: ${builtinTools.length} 内置 + ${qccTools.length} 数据源 = ${tools.length} 总计`);
  }

  let workingMessages = [...messages];
  let iteration = 0;
  let autoRefreshAttempted = false; // 保持在线：每次 runAgentLoop 最多自动刷新一次

  // ─── Token 用量统计 ───
  // 两个独立指标（参考 Hermes 的做法）：
  //   sessionTotalTokens: 累加每次 API 调用的 total（真实计费量，会含重复发送的历史）
  //   lastPromptTokens:   最后一次 API 调用的 prompt_tokens（当前上下文窗口占用）
  let sessionTotalTokens = 0;
  let lastPromptTokens = 0;
  let totalCompletionTokens = 0;
  let hasRealUsage = false;

  /**
   * 汇报当前 token 用量给上层（通过 onUsage 回调）
   * @param {boolean} final - 是否为最终汇报（对话结束时）
   */
  function reportUsage(final = false) {
    if (!onUsage) return;
    onUsage({
      // 上下文窗口占用（最后一次 API 的 prompt_tokens）— 用于超限检测
      prompt_tokens: lastPromptTokens,
      // 累加输出 token
      completion_tokens: totalCompletionTokens,
      // 真实计费总量（累加每次 API 调用）
      total_tokens: sessionTotalTokens,
      // 上下文窗口占用（同 prompt_tokens，语义明确）
      context_tokens: lastPromptTokens,
      hasRealUsage,
      final,
    });
  }

  /**
   * 累加一次 API 调用的 token 用量（优先真实 usage，降级为粗估）。
   * 三处调用点共用，保证统计口径一致：循环内每次迭代 / MAX_ITERATIONS 尾部总结 / 超时降级总结。
   * @param {{text?:string, usage?:Object}} result - llmStreamWithTools 的返回值
   */
  function tallyUsage(result) {
    const u = result?.usage;
    if (u && (u.prompt_tokens > 0 || u.completion_tokens > 0)) {
      lastPromptTokens = u.prompt_tokens || 0;
      totalCompletionTokens += u.completion_tokens || 0;
      sessionTotalTokens += u.total_tokens || (u.prompt_tokens + u.completion_tokens) || 0;
      hasRealUsage = true;
    } else {
      // API 未返回 usage → 粗略估算
      lastPromptTokens = estimateMessagesTokens(workingMessages);
      const estOut = estimateTokensRough(result?.text || '');
      totalCompletionTokens += estOut;
      sessionTotalTokens += lastPromptTokens + estOut;
    }
  }

  while (iteration < MAX_ITERATIONS) {
    // 取消检查：用户点了停止生成则立即退出循环
    if (signal?.aborted) throw new Error('ABORTED');
    iteration++;
    console.log(`[Agent:loop] 迭代 ${iteration}/${MAX_ITERATIONS}, messages=${workingMessages.length}`);

    // 流式请求（带工具）：边收边把文本 delta 推给 UI，同时累积 tool_calls
    const result = await llmStreamWithTools({
      modelId, baseUrl, apiKey,
      messages: workingMessages,
      tools,
      temperature: 0.7,
      onData,
      onProgress,
      iteration,
      signal,
      firstByteTimeout,
      streamIdleTimeout,
    });

    const { text, toolCalls, timedOut, timeoutReason } = result;

    // ─── Token 用量统计 ───
    // prompt: 记录最后一次的值（上下文窗口占用）；completion: 累加（真实新增输出）
    // sessionTotal: 累加每次 API 调用的 total（真实计费量）
    tallyUsage(result);
    reportUsage();

    // ─── 超时优雅降级 ───
    // 超时时不崩溃，而是基于已收集数据生成部分结论
    if (timedOut) {
      console.warn(`[Agent:loop] 迭代 ${iteration} 超时: ${timeoutReason}`);

      // 如果超时时已经收到部分工具调用（如 report_export 的 JSON 参数生成了一半）
      // → 仅执行参数 JSON 已完整可解析的工具；参数不完整的不执行（避免生成半成品 PDF）
      if (toolCalls.length > 0) {
        const validCalls = toolCalls.filter(tc => {
          if (!tc.function.arguments || tc.function.arguments.length <= 10) return false;
          try { JSON.parse(tc.function.arguments); return true; }
          catch { 
            console.warn(`[Agent:loop] 超时降级: 工具 ${tc.function.name} 的参数 JSON 不完整，跳过执行`);
            return false;
          }
        });
        if (validCalls.length > 0) {
          console.log(`[Agent:loop] 超时降级: ${validCalls.length}/${toolCalls.length} 个工具调用参数完整，执行`);
          // 仅保留参数完整的工具调用，丢弃不完整的
          toolCalls.length = 0;
          toolCalls.push(...validCalls);
          // 走和正常工具调用一样的路径
        } else {
          console.warn(`[Agent:loop] 超时降级: 所有工具调用参数均不完整，放弃执行`);
          // 没有可执行的工具 → 走文本降级路径
          const timeoutNotice = `\n\n---\n⚠️ **报告生成超时**：LLM 在生成报告参数时超时（${timeoutReason}），报告数据不完整无法导出。建议重新尝试，或简化报告范围后重试。`;
          if (onData) onData(timeoutNotice);
          return (text || '') + timeoutNotice;
        }
      } else if (text && text.trim().length > 20) {
        // 超时但已有文本输出 → 直接返回已生成的内容 + 超时说明
        const timeoutNotice = `\n\n---\n⚠️ **部分结果**：LLM 响应超时（${timeoutReason}），以上为已生成的内容。可能原因：模型推理负载高/网络波动/任务复杂度超时。您可以重新提问或换个角度继续。`;
        if (onData) onData(timeoutNotice);
        return text + timeoutNotice;
      } else {
        // 完全没有数据 → 生成基于已有上下文的部分结论
        const hasPriorContext = workingMessages.some(m => m.role === 'tool');
        if (hasPriorContext) {
          console.log('[Agent:loop] 超时无数据，但已有工具结果 → 生成部分结论');
          if (onData) onData('\n\n⚠️ LLM 响应超时，正在基于已收集的数据生成部分结论...\n\n');
          // 不带工具再请求一次，让模型总结已有信息
          workingMessages.push({
            role: 'user',
            content: `注意：上一轮 LLM 请求超时（${timeoutReason}）。请基于以上已收集的全部信息，整理并输出完整、结构化的分析结论。对于未能覆盖的维度，明确标注"由于超时未获取"。不要调用任何工具，直接输出结论。`,
          });
          const summaryResult = await llmStreamWithTools({
            modelId, baseUrl, apiKey,
            messages: workingMessages,
            tools: [], // 无工具 → 纯文本总结
            temperature: 0.7,
            onData,
            onProgress,
            iteration,
            signal,
            firstByteTimeout: TIMEOUT_CONFIG.firstByteNormal, // 总结用普通超时
            streamIdleTimeout, // 研究类总结同样是长文本生成，沿用研究空闲超时抗中断
          });
          // 超时降级总结调用的 token 也计入（与正常尾部总结口径一致，避免少算）
          tallyUsage(summaryResult);
          reportUsage(true);
          if (summaryResult.timedOut && (!summaryResult.text || summaryResult.text.trim().length < 20)) {
            return '⚠️ LLM 连续超时，无法生成结果。已收集的数据保留在上下文中。请检查网络/模型可用性后重试。';
          }
          return summaryResult.text || '⚠️ 超时后未能生成结论文本。';
        }
        // 没有任何工具结果 → 真正的超时失败，但仍不 reject
        return `⚠️ LLM 响应超时（${timeoutReason}）。请求未能获得任何有效数据。\n\n可能原因：\n- 模型服务负载高，推理时间过长\n- 网络波动导致连接中断\n- 查询过于复杂，模型需要更多时间\n\n建议：\n- 稍后重试\n- 简化查询后重新提问\n- 检查 API 密钥和模型可用性`;
      }
    }

    // 情况 1：LLM 要调用工具
    if (toolCalls.length > 0) {
      // 把 assistant 的 tool_call 消息加入历史（content 为已流式输出的文本，通常为空）
      workingMessages.push({
        role: 'assistant',
        content: text || '',
        tool_calls: toolCalls,
      });

      // 执行所有工具调用
      for (const toolCall of toolCalls) {
        if (signal?.aborted) throw new Error('ABORTED');
        const toolName = toolCall.function.name;
        let toolArgs = {};
        try {
          toolArgs = JSON.parse(toolCall.function.arguments || '{}');
        } catch {
          toolArgs = { _raw: toolCall.function.arguments };
        }

        // 通知 UI 正在执行工具
        if (onProgress) {
          onProgress({
            type: 'tool_start',
            tool: toolName,
            args: toolArgs,
            iteration,
          });
        }

        console.log(`[Agent:loop] 执行工具: ${toolName}`, toolArgs);

        // 路由：数据工具（qcc_ 前缀）走 executeQccTool，内置工具走 executeTool
        const isQccTool = toolName.startsWith('qcc_');
        const toolResult = isQccTool
          ? await executeQccTool(toolName, toolArgs, qccToken, signal)
          : await executeTool(toolName, toolArgs, signal);

        if (onProgress) {
          onProgress({
            type: 'tool_end',
            tool: toolName,
            result: toolResult, // 完整结果（UI 预览可折叠/限高，复制需完整）
            iteration,
          });
        }

        // token 失效：若开启「保持在线」则刷新 token 后重试当前工具一次；否则阻断会话
        if (isQccTokenExpired(toolResult)) {
          if (isQccTool && !autoRefreshAttempted && !signal?.aborted) {
            autoRefreshAttempted = true;
            const newToken = await refreshIfEnabled();
            if (newToken) {
              qccToken = newToken; // 刷新后续工具调用复用新 token，避免连续过期
              console.log('[Agent:loop] 保持在线：token 已刷新，重试工具', toolName);
              const retryResult = await executeQccTool(toolName, toolArgs, qccToken, signal);
              if (onProgress) onProgress({ type: 'tool_end', tool: toolName, result: retryResult, iteration });
              if (!isQccTokenExpired(retryResult)) {
                workingMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: retryResult });
                continue; // 重试成功，跳过阻断、继续下一个工具调用
              }
            }
          }
          const finalMsg = '⚠️ ' + QCC_TOKEN_EXPIRED_MSG;
          console.warn('[Agent:loop] 数据源 token 已过期，阻断当前会话');
          if (onData) onData(finalMsg);
          return finalMsg;
        }

        // 把工具结果加入消息历史
        workingMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolResult,
        });
      }

      // 继续循环，让 LLM 处理工具结果
      continue;
    }

    // 情况 2：无工具调用 → 最终回复（已在流式过程中逐字推给 UI）
    reportUsage(true);
    return text;
  }

  // 达到最大工具调用次数：不再提供工具，让模型基于已获取的信息自然给出最终结论。
  // （类比预算：超出预算的不买了，把已经买到的带回家——已查数据全部保留在上下文，不丢弃。）
  workingMessages.push({
    role: 'user',
    content: '请直接基于以上已查询到的全部信息，整理并输出完整、结构化的最终分析结论。（已无需再调用工具做进一步查询；若个别维度尚未覆盖，简要说明即可。）',
  });
  const tailResult = await llmStreamWithTools({
    modelId, baseUrl, apiKey,
    messages: workingMessages,
    tools: [], // 不再提供工具 → 模型自然转入文本结论
    temperature: 0.7,
    onData,
    onProgress,
    iteration,
    signal,
    firstByteTimeout, // 研究类任务总结也用长超时
    streamIdleTimeout,
  });
  // 尾部总结超时 → 仍然不崩溃，给出已有内容。
  // 本轮采集的工具结果已随助手消息持久化，并在下一轮上下文中折算为文本（见 renderer 的 buildConversationHistory），
  // 因此直接回复"继续"即可基于这些数据重新生成，无需重新采集。
  // 通过 onData 推送，确保提示真的显示在 UI（runAgentLoop 的返回值不被 main.cjs 转发给 renderer，只有 onData 流才会显示）。

  // 尾部总结的 token 也累加
  tallyUsage(tailResult);
  reportUsage(true);

  if (tailResult.timedOut) {
    if (tailResult.text && tailResult.text.trim().length > 20) {
      const notice = `\n\n---\n⚠️ 总结阶段超时（${tailResult.timeoutReason}），以上为部分结论。本轮采集的数据已随消息保留，可直接回复"继续"基于这些数据重新生成。`;
      if (onData) onData(notice);
      return tailResult.text + notice;
    }
    const tailMsg = '⚠️ 已完成数据收集，但在生成最终总结时超时。本轮采集的数据已随消息保留，直接回复"继续"即可基于这些数据重新生成报告（无需重新采集）。';
    if (onData) onData(tailMsg);
    return tailMsg;
  }
  return tailResult.text;
}
