/**
 * tools.js — Agent 工具注册表
 *
 * 每个工具有：
 * - name:        OpenAI function-calling 格式的工具名
 * - description: 告诉 LLM 何时使用
 * - parameters:  JSON Schema 参数定义
 * - execute:     async (args) => string  实际执行函数
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { skillsRoot: getSkillsRootReal } = require('../skills/paths.cjs');

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const SKILLS_ROOT = path.join(PROJECT_ROOT, 'skills', 'builtin');

// 敏感凭证路径：阻止 prompt-injection 诱导 agent 读取/覆盖本地密钥。
// 注意：shell 工具仍可执行任意命令（本地受信 Agent 的既定能力），此处只收口文件工具。
const HOME = os.homedir();
const SENSITIVE_PATH_PREFIXES = [
  path.join(HOME, '.BizOwl', 'auth.json'),   // 本应用 token 存储（精确匹配）
  path.join(HOME, '.ssh') + path.sep,        // SSH 私钥
  path.join(HOME, '.gnupg') + path.sep,      // GPG 密钥环
  path.join(HOME, '.aws') + path.sep,        // 云凭证
];
function isSensitivePath(p) {
  const resolved = path.resolve(p);
  return SENSITIVE_PATH_PREFIXES.some((prefix) =>
    prefix.endsWith(path.sep) ? resolved.startsWith(prefix) : resolved === prefix
  );
}

/** 组合「超时」与「用户中止」信号：任一触发即取消 fetch */
function withAbort(timeoutMs, signal) {
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (signal) signals.push(signal);
  return AbortSignal.any(signals);
}

/** 运行 shell 命令（受控） */
async function runShell(cmd, timeoutMs = 30000, signal) {
  try {
    const { stdout, stderr } = await execFileAsync('bash', ['-c', cmd], {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 5,
      env: { ...process.env, SKILLS_ROOT },
      ...(signal ? { signal } : {}),
    });
    return (stdout || '') + (stderr ? `\n[stderr]\n${stderr}` : '');
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) return '[已停止]';
    return `[error] ${err.message}\n${err.stdout || ''}${err.stderr || ''}`;
  }
}

/** 运行脚本文件（安全模式：只允许 skills 目录下的脚本） */
async function runScript(scriptPath, args = [], timeoutMs = 30000) {
  const absPath = path.resolve(scriptPath);
  // 安全检查：脚本必须在项目目录内
  if (!absPath.startsWith(PROJECT_ROOT)) {
    return `[error] 脚本不在允许的目录内: ${absPath}`;
  }
  if (!fs.existsSync(absPath)) {
    return `[error] 脚本不存在: ${absPath}`;
  }
  try {
    const { stdout, stderr } = await execFileAsync(absPath, args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 5,
      env: { ...process.env, SKILLS_ROOT },
    });
    return (stdout || '') + (stderr ? `\n[stderr]\n${stderr}` : '');
  } catch (err) {
    return `[error] ${err.message}\n${err.stdout || ''}${err.stderr || ''}`;
  }
}

/**
 * web_search 回退：bridge server 不可用时，直接跑 skill 的 CLI。
 * 平台相关：Windows 无 bash → 用 Electron-as-node 跑 search.cjs；
 * mac/linux → bash 跑 search.sh。脚本路径指向 app.asar.unpacked 真实目录。
 */
async function runSearchFallback(query, max, timeoutMs = 60000, signal) {
  const root = getSkillsRootReal();
  const baseEnv = {
    ...process.env,
    SKILLS_ROOT: root,
    BIZOWL_ELECTRON_PATH: process.execPath,
    WEB_SEARCH_SKIP_BUILD_CHECK: '1',
  };
  // 可写 cwd：crawlee 相对 cwd 写 .cache/crawlee；asar 内只读会失败
  let cwd;
  try {
    const electron = require('electron');
    cwd = path.join(electron.app.getPath('userData'), 'skill-services', 'web-search');
    fs.mkdirSync(cwd, { recursive: true });
  } catch {
    cwd = undefined; // dev / node 模式无 electron，用默认 cwd
  }
  const opts = { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 5, env: baseEnv, cwd, ...(signal ? { signal } : {}) };
  try {
    const { stdout, stderr } = process.platform === 'win32'
      ? await execFileAsync(process.execPath,
          [path.join(root, 'web-search', 'scripts', 'search.cjs'), query, String(max)],
          { ...opts, env: { ...baseEnv, ELECTRON_RUN_AS_NODE: '1' } })
      : await execFileAsync('bash',
          [path.join(root, 'web-search', 'scripts', 'search.sh'), query, String(max)], opts);
    return (stdout || '') + (stderr ? `\n[stderr]\n${stderr}` : '');
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) return '[已停止]';
    return `[error] ${err.message}\n${err.stdout || ''}${err.stderr || ''}`;
  }
}

/**
 * 格式化搜索结果 JSON → 紧凑文本（给 LLM 看）
 * 显示相关性评分和来源引擎，让 Agent 知道结果质量
 */
function formatSearchResults(rawJson, maxResults) {
  try {
    const parsed = JSON.parse(rawJson);
    const data = parsed.data || parsed;
    const results = data.results || [];
    if (!Array.isArray(results) || results.length === 0) {
      return '[无搜索结果]';
    }
    const engine = data.engine || data.multiSearch ? 'multi' : 'unknown';
    const isMulti = data.multiSearch === true || engine === 'multi';
    const header = isMulti
      ? `[多引擎聚合搜索] 查询: "${data.query}" | 引擎: ${(data.sources || []).map(s => `${s.engine}(${s.resultCount})`).join(', ')} | 去重后: ${data.rawTotal || results.length}条 → 相关性筛选后: ${results.length}条`
      : `[搜索] 查询: "${data.query}" | 引擎: ${engine} | 结果: ${results.length}条`;

    const lines = results.slice(0, maxResults).map((r, i) => {
      const score = r._relevanceScore !== undefined ? ` [相关性:${r._relevanceScore}]` : '';
      const src = r.source ? ` (${r.source})` : '';
      const title = r.title || '(无标题)';
      const snippet = r.snippet || '';
      const url = r.url || '';
      return `${i + 1}. ${title}${score}${src}\n   ${snippet}\n   ${url}`;
    });
    const text = header + '\n\n' + lines.join('\n\n');
    return text.slice(0, 8000);
  } catch {
    // JSON 解析失败，返回原始文本
    return rawJson.slice(0, 8000) || '[无搜索结果]';
  }
}

// ─── 外部搜索源（Tavily / Serper / SearXNG）───
// 配置存储在 ~/.BizOwl/store.json 的 tavily/serper/searxng 字段
// 三个源并行调用，与本地多引擎聚合结果合并

const STORE_JSON = path.join(HOME, '.BizOwl', 'store.json');

function readStoreConfig() {
  try {
    if (!fs.existsSync(STORE_JSON)) return {};
    return JSON.parse(fs.readFileSync(STORE_JSON, 'utf8'));
  } catch { return {}; }
}

/**
 * 调用 Tavily AI 搜索 API
 * 返回提取的内容文本 + 自带相关性分
 */
async function searchTavily(query, maxResults, apiKey, signal) {
  if (!apiKey) return [];
  try {
    const resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        search_depth: 'advanced',
      }),
      signal: withAbort(20000, signal),
    });
    if (!resp.ok) {
      console.warn(`[Tavily] HTTP ${resp.status}`);
      return [];
    }
    const data = await resp.json();
    return (data.results || []).map((r, i) => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.content || '',
      source: 'tavily',
      position: i + 1,
      _relevanceScore: typeof r.score === 'number' ? Math.round(r.score * 100) : undefined,
    }));
  } catch (e) {
    console.warn('[Tavily] 搜索失败:', e.message);
    return [];
  }
}

/**
 * 调用 Serper.dev Google 搜索 API
 */
async function searchSerper(query, maxResults, apiKey, signal) {
  if (!apiKey) return [];
  try {
    const resp = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
      body: JSON.stringify({ q: query, num: maxResults, gl: 'cn', hl: 'zh-cn' }),
      signal: withAbort(15000, signal),
    });
    if (!resp.ok) {
      console.warn(`[Serper] HTTP ${resp.status}`);
      return [];
    }
    const data = await resp.json();
    return (data.organic || []).slice(0, maxResults).map((r, i) => ({
      title: r.title || '',
      url: r.link || r.url || '',
      snippet: r.snippet || '',
      source: 'serper',
      position: i + 1,
      _relevanceScore: typeof r.position === 'number' ? Math.max(10, 100 - r.position * 5) : undefined,
    }));
  } catch (e) {
    console.warn('[Serper] 搜索失败:', e.message);
    return [];
  }
}

/**
 * 调用用户自建的 SearXNG 实例
 */
async function searchSearXNG(query, maxResults, baseUrl, signal) {
  if (!baseUrl) return [];
  let url = baseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url)) url = 'http://' + url;
  try {
    const searchUrl = `${url}/search?q=${encodeURIComponent(query)}&format=json&pageno=1`;
    const resp = await fetch(searchUrl, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'BizOwl/1.0' },
      signal: withAbort(20000, signal),
    });
    if (!resp.ok) {
      console.warn(`[SearXNG] HTTP ${resp.status}`);
      return [];
    }
    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      console.warn('[SearXNG] 实例未启用 JSON 输出');
      return [];
    }
    const data = await resp.json();
    return (data.results || []).slice(0, maxResults).map((r, i) => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.content || '',
      source: 'searxng',
      position: i + 1,
      _relevanceScore: r.engines
        ? Math.min(90, 40 + (Array.isArray(r.engines) ? r.engines.length : Object.keys(r.engines).length) * 10)
        : undefined,
    }));
  } catch (e) {
    console.warn('[SearXNG] 搜索失败:', e.message);
    return [];
  }
}

/**
 * 并行调用所有已启用的外部搜索源
 * @returns {Promise<{results: Array, sources: Array}>}
 */
async function searchAllExternal(query, maxResults, signal) {
  const config = readStoreConfig();
  const tasks = [];

  if (config.tavily?.enabled && config.tavily.apiKey?.trim()) {
    tasks.push({ name: 'tavily', fn: () => searchTavily(query, maxResults, config.tavily.apiKey.trim(), signal) });
  }
  if (config.serper?.enabled && config.serper.apiKey?.trim()) {
    tasks.push({ name: 'serper', fn: () => searchSerper(query, maxResults, config.serper.apiKey.trim(), signal) });
  }
  if (config.searxng?.enabled && config.searxng.url?.trim()) {
    tasks.push({ name: 'searxng', fn: () => searchSearXNG(query, maxResults, config.searxng.url.trim(), signal) });
  }

  if (tasks.length === 0) return { results: [], sources: [] };

  const settled = await Promise.allSettled(
    tasks.map(async (t) => {
      try {
        const results = await t.fn();
        return { name: t.name, results, success: true };
      } catch (e) {
        return { name: t.name, results: [], success: false, error: e.message };
      }
    })
  );

  const allResults = [];
  const sourceStats = [];
  for (const sr of settled) {
    if (sr.status === 'fulfilled') {
      allResults.push(...sr.value.results);
      sourceStats.push({
        engine: sr.value.name,
        resultCount: sr.value.results.length,
        success: sr.value.success,
        ...(sr.value.error ? { error: sr.value.error } : {}),
      });
    }
  }

  return { results: allResults, sources: sourceStats };
}

/**
 * 企业信息查询（多源聚合，不依赖单一平台）
 * 通过 web_search 从公开渠道查询企业工商信息
 */
async function enterpriseLookup(companyName, dimensions = [], signal) {
  const sources = [
    '国家企业信用信息公示系统 gsxt.gov.cn',
    '天眼查 tianyancha.com',
    '爱企查 aiqicha.baidu.com',
    '企查猫 qichamao.com',
    '百度百科 baike.baidu.com',
  ];
  const dimMap = {
    'basic': '工商基本信息 统一社会信用代码 法定代表人 注册资本 成立日期 经营状态',
    'equity': '股东信息 股权结构 持股比例 实际控制人',
    'risk': '行政处罚 失信记录 被执行人 经营异常',
    'business': '经营范围 主营业务 产品服务',
    'finance': '注册资本 实缴资本 融资历史',
  };
  const dims = dimensions.length > 0 ? dimensions : ['basic'];
  const dimText = dims.map(d => dimMap[d] || d).join(' ');

  // 构造搜索查询
  const query = `${companyName} ${dimText}`;
  console.log(`[Agent:tool] enterprise_lookup: "${query.slice(0, 80)}"`);

  // 用 web_search 搜索多个来源
  const results = [];
  for (const source of sources.slice(0, 3)) {
    const q = `${companyName} ${dimText} site:${source.split(' ')[1]}`;
    try {
      const searchUrl = `http://127.0.0.1:37823/api/search`;
      const resp = await fetch(searchUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, maxResults: 3 }),
        signal: withAbort(15000, signal),
      });
      if (resp.ok) {
        const data = await resp.text();
        results.push(`--- 来源: ${source.split(' ')[0]} ---\n${data.slice(0, 2000)}`);
      }
    } catch {}
  }

  // 补充通用搜索
  try {
    const searchUrl = `http://127.0.0.1:37823/api/search`;
    const resp = await fetch(searchUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, maxResults: 5 }),
      signal: withAbort(15000, signal),
    });
    if (resp.ok) {
      const data = await resp.text();
      results.push(`--- 综合搜索 ---\n${data.slice(0, 3000)}`);
    }
  } catch {}

  if (results.length === 0) {
    // 回退到 search.sh
    const fallback = await runSearchFallback(query, 5, 30000, signal);
    results.push(fallback.slice(0, 3000));
  }

  const header = `【${companyName}】企业信息查询结果（来自公开网页，未经数据源平台核验）\n查询维度: ${dims.join(', ')}\n`;
  return header + results.join('\n\n').slice(0, 8000);
}

/**
 * 工具定义 — OpenAI function-calling 格式
 */
export const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '搜索网络获取最新信息、新闻、网页内容。当需要查询实时数据、最新资讯、或不确定的事实时使用。自动同时查询多个搜索引擎（360/Bing/百度等），合并去重并按相关性排序，过滤词典/百科等低质量结果。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索关键词',
          },
          max_results: {
            type: 'integer',
            description: '最大返回结果数，默认8',
            default: 8,
          },
        },
        required: ['query'],
      },
      execute: async (args, signal) => {
        const query = args.query;
        const max = args.max_results || 8;
        console.log(`[Agent:tool] web_search: "${query}" (max=${max})`);

        // 并行启动：本地多引擎搜索 + 外部搜索源（Tavily/Serper/SearXNG）
        const localSearchPromise = (async () => {
          // 优先调用多引擎并行搜索端点（聚合 + 相关性排序）
          try {
            const searchUrl = `http://127.0.0.1:37823/api/search/multi`;
            const resp = await fetch(searchUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ query, maxResults: max }),
              signal: withAbort(45000, signal),
            });
            if (resp.ok) {
              return { type: 'multi', data: await resp.text() };
            }
          } catch (e) {
            if (signal?.aborted) return null;
            console.warn('[Agent:tool] multi-search 失败，尝试单引擎:', e.message);
          }
          // 单引擎搜索 fallback
          try {
            const searchUrl = `http://127.0.0.1:37823/api/search`;
            const resp = await fetch(searchUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ query, maxResults: max }),
              signal: withAbort(30000, signal),
            });
            if (resp.ok) {
              return { type: 'single', data: await resp.text() };
            }
          } catch (e) {
            if (signal?.aborted) return null;
            console.warn('[Agent:tool] bridge server 搜索失败:', e.message);
          }
          return null;
        })();

        const externalSearchPromise = searchAllExternal(query, max, signal).catch(() => ({ results: [], sources: [] }));

        // 等待两者完成
        const [localResult, externalResult] = await Promise.all([localSearchPromise, externalSearchPromise]);

        if (signal?.aborted) return '[已停止]';

        // 如果本地和外部都有结果 → 合并
        if (localResult && externalResult.results.length > 0) {
          // 解析本地结果
          let localText = '';
          let localData = null;
          try {
            const parsed = JSON.parse(localResult.data);
            localData = parsed.data || parsed;
          } catch {}

          // 合并结果
          if (localData?.results) {
            // URL 去重
            const seen = new Set(localData.results.map(r => r.url));
            const newExternal = externalResult.results.filter(r => r.url && !seen.has(r.url));
            localData.results = [...localData.results, ...newExternal];

            // 更新来源信息
            const allSources = [
              ...(localData.sources || []),
              ...externalResult.sources,
            ];
            localData.sources = allSources;
            localData.externalSources = externalResult.sources.map(s => s.engine);

            localText = formatSearchResults(JSON.stringify({ data: localData }), max);
          } else {
            localText = formatSearchResults(localResult.data, max);
          }

          return localText || '[无搜索结果]';
        }

        // 只有外部搜索结果（本地搜索失败/无结果）
        if (!localResult && externalResult.results.length > 0) {
          const data = {
            query,
            engine: 'external',
            results: externalResult.results,
            totalResults: externalResult.results.length,
            sources: externalResult.sources,
            multiSearch: true,
          };
          return formatSearchResults(JSON.stringify({ data }), max);
        }

        // 只有本地搜索结果
        if (localResult) {
          return formatSearchResults(localResult.data, max);
        }

        // 回退到 skill CLI
        const result = await runSearchFallback(query, max, 60000, signal);
        return result.slice(0, 8000) || '[无搜索结果]';
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'enterprise_lookup',
      description: '查询企业公开信息（无需登录数据源平台）。从国家企业信用信息公示系统、天眼查、爱企查、百度百科等多个公开来源聚合企业工商、股东、风险等信息。当用户没有配置数据源凭证或数据源工具不可用时，优先使用此工具。',
      parameters: {
        type: 'object',
        properties: {
          company_name: {
            type: 'string',
            description: '企业全称或简称',
          },
          dimensions: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['basic', 'equity', 'risk', 'business', 'finance'],
            },
            description: '查询维度：basic=工商基本信息，equity=股东股权，risk=风险信息，business=经营范围，finance=资本财务。默认 basic。',
          },
        },
        required: ['company_name'],
      },
      execute: async (args, signal) => {
        return await enterpriseLookup(args.company_name, args.dimensions || [], signal);
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'shell',
      description: '在本地终端执行 bash 命令。用于运行脚本、安装包、检查系统状态、git 操作等。有 30 秒超时限制。',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: '要执行的 bash 命令',
          },
        },
        required: ['command'],
      },
      execute: async (args, signal) => {
        const cmd = args.command;
        console.log(`[Agent:tool] shell: ${cmd.slice(0, 100)}`);
        const result = await runShell(cmd, 30000, signal);
        return result.slice(0, 8000) || '[命令执行完成，无输出]';
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取本地文件内容。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '文件绝对路径或相对路径',
          },
        },
        required: ['path'],
      },
      execute: async (args) => {
        const filePath = path.resolve(args.path);
        console.log(`[Agent:tool] read_file: ${filePath}`);
        if (isSensitivePath(filePath)) return '[error] 出于安全限制，拒绝读取敏感凭证文件';
        if (!fs.existsSync(filePath)) return `[error] 文件不存在: ${filePath}`;
        if (fs.statSync(filePath).size > 1024 * 1024 * 2) return '[error] 文件过大（>2MB）';
        return fs.readFileSync(filePath, 'utf8').slice(0, 8000);
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '写入内容到本地文件（覆盖模式）。',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '文件绝对路径',
          },
          content: {
            type: 'string',
            description: '要写入的内容',
          },
        },
        required: ['path', 'content'],
      },
      execute: async (args) => {
        const filePath = args.path;
        console.log(`[Agent:tool] write_file: ${filePath}`);
        if (isSensitivePath(filePath)) return '[error] 出于安全限制，拒绝写入敏感凭证文件';
        try {
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(filePath, args.content, 'utf8');
          return `[成功] 已写入 ${args.content.length} 字符到 ${filePath}`;
        } catch (err) {
          return `[error] ${err.message}`;
        }
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memory_note',
      description: '记录一条关于用户的长期记忆（偏好、习惯、专业领域、重要决定、纠正了你错误的反馈等）。每次只记一条，≤280字节。只记录有长期价值的信息，避免重复。',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: '一条记忆内容（≤280字节，单行无换行）。例如："用户偏好用 Apple 设计风格的 UI" 或 "用户是 Python 全栈工程师"',
          },
        },
        required: ['text'],
      },
      execute: async (args) => {
        const memo = await import('../memory/memo.js');
        const os = await import('node:os');
        const d = path.join(os.homedir(), '.BizOwl', 'memory');
        console.log(`[Agent:tool] memory_note: ${args.text?.slice(0, 50)}...`);
        try {
          const result = await memo.cmd_note(d, args.text || '');
          return result.text || JSON.stringify(result);
        } catch (e) { return `[error] memory_note 失败: ${e.message}`; }
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memory_recall',
      description: '搜索历史记忆。用关键词或正则表达式回忆用户之前提到的偏好、习惯或历史信息。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索关键词或正则表达式。例如："UI偏好" 或 "python|爬虫"',
          },
        },
        required: ['query'],
      },
      execute: async (args) => {
        const memo = await import('../memory/memo.js');
        const os = await import('node:os');
        const d = path.join(os.homedir(), '.BizOwl', 'memory');
        console.log(`[Agent:tool] memory_recall: ${args.query}`);
        try {
          const result = memo.cmd_recall(d, args.query || '');
          return result.text || 'No match.';
        } catch (e) { return `[error] memory_recall 失败: ${e.message}`; }
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_skills',
      description: '列出当前可用的所有技能（skills）及其描述。当不确定有哪些能力可用时，先调用此工具。',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        console.log('[Agent:tool] list_skills');
        // 直接用 dynamic import 调用 loader（避免 execFile 无法运行 ESM 模块）
        try {
          const { loadAllSkills } = await import('../skills/loader.js');
          const skills = loadAllSkills();
          if (skills.length === 0) return '[无 skills]';
          return skills.map(s => `- ${s.name}: ${s.description.slice(0, 80)}`).join('\n');
        } catch (err) {
          return `[error] list_skills 失败: ${err.message}`;
        }
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'report_export',
      description: '【研究报告导出】将深度研究报告渲染为专业 PDF（含封面/摘要/目录/正文/评分总表/图表/参考文献/附录）。当用户要求"深度研究报告/研报/行业研究/方案对比打分/市场前景评估 + 输出 PDF"时，在完成多源数据采集与多维度打分后调用此工具。区别于 document_export：本工具产出结构化研究报告版式（封面+评分卡+评分总表），document_export 只做普通文档排版。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '报告主标题（如"2026 年低空经济行业研究报告"）' },
          subtitle: { type: 'string', description: '副标题（可空）' },
          report_type: { type: 'string', enum: ['行业研究', '方案对比', '市场前景评估', '主题研究', '前瞻时间线'], description: '报告类型' },
          abstract: { type: 'string', description: '摘要文本（核心结论 + 总评分说明），多段用 \\n 分隔' },
          total_score: { type: 'string', description: '综合加权评分（如 "7.4"）' },
          confidence: { type: 'string', enum: ['高', '中', '低'], description: '综合置信度' },
          chapters: {
            type: 'array',
            description: '正文章节数组（背景/市场/竞争/技术/政策/风险等）',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                sections: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      heading: { type: 'string' },
                      body: { type: 'string', description: '正文内容，支持 HTML（<ul><li>、<table>、<strong> 等）' },
                    },
                  },
                },
              },
            },
          },
          score_table: {
            type: 'object',
            description: '评分总表 { headers: ["维度","权重","得分","置信度","依据"], rows: [[...]] }',
            properties: {
              headers: { type: 'array', items: { type: 'string' } },
              rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
            },
          },
          charts_html: { type: 'string', description: '图表 HTML（可选）：用 <div class="chart-box"><div class="chart-title">标题</div>...</div> 包裹；柱状图用 .bar-row/.bar-label/.bar-track/.bar-fill/.bar-val 结构；评分卡用 .score-card' },
          references: {
            type: 'array',
            description: '参考文献 [{id, title, url, accessed}]',
            items: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                title: { type: 'string' },
                url: { type: 'string' },
                accessed: { type: 'string', description: '访问日期 YYYY-MM-DD' },
              },
            },
          },
          appendix: { type: 'string', description: '附录 HTML（可选）：数据缺口说明/术语表/方法论' },
        },
        required: ['title', 'abstract', 'total_score', 'confidence', 'chapters', 'score_table', 'references'],
      },
      execute: async (args, signal) => {
        if (signal?.aborted) return '[已停止]';
        console.log(`[Agent:tool] report_export: "${args.title}"`);
        const { exportResearchReport } = await import('../report/report-export.js');
        try {
          const result = await exportResearchReport({
            data: {
              title: args.title,
              subtitle: args.subtitle || '',
              report_type: args.report_type || '主题研究',
              abstract: args.abstract || '',
              total_score: args.total_score ?? '—',
              confidence: args.confidence || '—',
              chapters: Array.isArray(args.chapters) ? args.chapters : [],
              score_table: args.score_table || {},
              charts_html: args.charts_html || '',
              references: Array.isArray(args.references) ? args.references : [],
              appendix: args.appendix || '',
            },
            title: args.title,
          });
          if (result.success) {
            return `✅ 研究报告已生成！\n格式: ${result.format}\n文件路径: ${result.filePath}\n标题: ${args.title}`;
          }
          return `[error] ${result.error || '报告导出失败'}`;
        } catch (err) {
          console.error('[Agent:tool] report_export 失败:', err.message);
          return `[error] 报告导出失败: ${err.message}`;
        }
      },
    },
  },
];

/** 获取工具的 OpenAI API 格式（去掉 execute 函数） */
export function getToolsForApi() {
  return AGENT_TOOLS.map((t) => ({
    type: t.type,
    function: {
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    },
  }));
}

/** 根据名称查找工具并执行 */
export async function executeTool(toolName, args, signal) {
  const tool = AGENT_TOOLS.find((t) => t.function.name === toolName);
  if (!tool) {
    return `[error] 未知工具: ${toolName}`;
  }
  try {
    const result = await tool.function.execute(args || {}, signal);
    return result;
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) return '[已停止]';
    console.error(`[Agent:tool] ${toolName} 执行失败:`, err);
    return `[error] 工具 ${toolName} 执行失败: ${err.message}`;
  }
}
