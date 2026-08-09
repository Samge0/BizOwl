#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const DEFAULT_SERVER_URL = 'http://127.0.0.1:37823';
const DEFAULT_SERVER_PORT = 37823;
const BRIDGE_SERVICE_NAME = 'web-search-bridge';
const BRIDGE_API_VERSION = 2;
const MIN_NODE_MAJOR = 18;
const DEFAULT_SERVER_WAIT_TIMEOUT_MS = 30000;
const SERVER_WAIT_INTERVAL_MS = 1000;

function ensureSupportedRuntime() {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (Number.isFinite(major) && major >= MIN_NODE_MAJOR) {
    return;
  }

  const electronPath = process.env.BIZOWL_ELECTRON_PATH;
  if (!electronPath || electronPath === process.execPath) {
    console.error(`Search failed: Node.js ${MIN_NODE_MAJOR}+ is required. Current runtime is ${process.version}.`);
    process.exit(1);
  }

  const result = spawnSync(electronPath, [__filename, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    },
  });

  if (result.error) {
    console.error(`Search failed: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

ensureSupportedRuntime();

function usage() {
  console.error('Usage: node scripts/search.cjs [--json] [--out utf8-file] <query|@utf8-file> [max_results]');
  process.exit(1);
}

function expandUserPath(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    return filePath;
  }
  if (filePath === '~') {
    return os.homedir();
  }
  if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

function readUtf8QueryFile(filePath) {
  return fs.readFileSync(expandUserPath(filePath), 'utf8').replace(/^\uFEFF/, '').trim();
}

function parseArgs(argv) {
  const args = [...argv];
  let outputFormat = 'markdown';
  let outFile = '';
  while (args.length > 0) {
    if (args[0] === '--json') {
      outputFormat = 'json';
      args.shift();
      continue;
    }
    if (args[0] === '--out') {
      args.shift();
      outFile = expandUserPath(args.shift() || '');
      if (!outFile) {
        usage();
      }
      continue;
    }
    break;
  }
  if (args.length < 1) {
    usage();
  }

  const queryArg = args[0];
  const queryFile = queryArg.startsWith('@') ? expandUserPath(queryArg.slice(1)) : '';
  const query = queryFile
    ? readUtf8QueryFile(queryFile)
    : queryArg;
  const maxResults = Number.parseInt(args[1] || '10', 10);

  return {
    outputFormat,
    outFile,
    query,
    queryFile,
    maxResults: Number.isFinite(maxResults) ? maxResults : 10,
  };
}

async function isServerHealthy(serverUrl) {
  const parsed = await getHealthBody(serverUrl);
  return isCompatibleHealthBody(parsed);
}

async function getHealthBody(serverUrl) {
  try {
    const response = await fetch(`${serverUrl}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      return false;
    }
    return await response.json().catch(() => null);
  } catch {
    return null;
  }
}

function isCompatibleHealthBody(parsed) {
  return parsed?.success === true
    && parsed?.data?.service === BRIDGE_SERVICE_NAME
    && parsed?.data?.apiVersion === BRIDGE_API_VERSION;
}

function getServerWaitTimeoutMs() {
  const seconds = Number.parseInt(process.env.WEB_SEARCH_REPAIR_WAIT_TIMEOUT || '', 10);
  return Number.isFinite(seconds) && seconds > 0
    ? seconds * 1000
    : DEFAULT_SERVER_WAIT_TIMEOUT_MS;
}

function killListenersOnDefaultPort() {
  if (process.platform === 'win32') {
    const result = spawnSync('netstat', ['-ano', '-p', 'tcp'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    const pids = new Set();
    for (const line of output.split(/\r?\n/)) {
      if (!line.includes(`:${DEFAULT_SERVER_PORT}`) || !/\bLISTENING\b/i.test(line)) {
        continue;
      }
      const match = line.trim().match(/\s(\d+)$/);
      if (match) {
        pids.add(match[1]);
      }
    }
    for (const pid of pids) {
      spawnSync('taskkill', ['/PID', pid, '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    }
    return;
  }

  const result = spawnSync('lsof', ['-ti', `tcp:${DEFAULT_SERVER_PORT}`, '-sTCP:LISTEN'], {
    encoding: 'utf8',
  });
  const pids = new Set((result.stdout || '').split(/\s+/).filter(Boolean));
  for (const pid of pids) {
    try {
      process.kill(Number(pid), 'SIGTERM');
    } catch {
      // Ignore processes that exit between lsof and kill.
    }
  }
}

function startLocalBridgeServer() {
  const projectDir = path.resolve(__dirname, '..');
  const serverEntry = path.join(projectDir, 'dist', 'server', 'index.js');
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Bridge Server entry not found: ${serverEntry}`);
  }

  const logFile = path.join(projectDir, '.launcher.log');
  const logFd = fs.openSync(logFile, 'a');
  let child;
  try {
    child = spawn(process.execPath, [serverEntry], {
      cwd: projectDir,
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: {
        ...process.env,
        ...(process.env.ELECTRON_RUN_AS_NODE ? { ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE } : {}),
      },
      windowsHide: true,
    });
  } finally {
    fs.closeSync(logFd);
  }

  if (child.pid) {
    fs.writeFileSync(path.join(projectDir, '.server.pid'), String(child.pid));
  }
  child.unref();
}

async function ensureServerAvailable(serverUrl) {
  const initialHealth = await getHealthBody(serverUrl);
  if (isCompatibleHealthBody(initialHealth)) {
    return;
  }

  if (serverUrl !== DEFAULT_SERVER_URL) {
    throw new Error(`Bridge Server is unavailable: ${serverUrl}/api/health`);
  }

  if (process.env.WEB_SEARCH_FORCE_REPAIR === '1' || initialHealth?.success === true) {
    killListenersOnDefaultPort();
    await new Promise(resolve => setTimeout(resolve, SERVER_WAIT_INTERVAL_MS));
  }

  startLocalBridgeServer();

  const deadline = Date.now() + getServerWaitTimeoutMs();
  while (Date.now() < deadline) {
    if (await isServerHealthy(serverUrl)) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, SERVER_WAIT_INTERVAL_MS));
  }

  throw new Error(`Bridge Server did not become healthy within ${getServerWaitTimeoutMs() / 1000}s`);
}

async function requestJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(text || `HTTP ${response.status}`);
  }
  if (!response.ok || !parsed.success) {
    throw new Error(parsed.error || `HTTP ${response.status}`);
  }
  return parsed.data;
}

function formatMarkdown(data, query) {
  const engine = data.engine || 'unknown';
  const results = Array.isArray(data.results) ? data.results : [];
  const total = typeof data.totalResults === 'number' ? data.totalResults : results.length;
  const duration = typeof data.duration === 'number' ? data.duration : 0;
  const lines = [
    `# Search Results: ${query}`,
    '',
    `**Query:** ${query}  `,
    `**Engine:** ${engine}  `,
    `**Results:** ${total}  `,
    `**Time:** ${duration}ms  `,
    '',
    '---',
    '',
  ];

  for (const result of results) {
    const title = result.title || '';
    const url = result.url || '';
    const snippet = result.snippet || '';
    lines.push(`## ${title}`, '', `**URL:** [${url}](${url})`, '', snippet, '', '---', '');
  }

  return lines.join('\n');
}

async function main() {
  const { outputFormat, outFile, query, maxResults } = parseArgs(process.argv.slice(2));
  const serverUrl = (process.env.WEB_SEARCH_SERVER || DEFAULT_SERVER_URL).replace(/\/+$/, '');
  const fallbackOrder = (process.env.WEB_SEARCH_FALLBACK_ORDER || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  const payload = {
    query,
    maxResults,
    engine: process.env.WEB_SEARCH_ENGINE || 'auto',
  };
  if (fallbackOrder.length > 0) {
    payload.fallbackOrder = fallbackOrder;
  }

  await ensureServerAvailable(serverUrl);
  const data = await requestJson(`${serverUrl}/api/search`, payload);
  let output;
  if (outputFormat === 'json') {
    output = `${JSON.stringify(data, null, 2)}\n`;
    if (outFile) {
      fs.writeFileSync(outFile, output, 'utf8');
      process.stderr.write(`Wrote UTF-8 search results to ${outFile}\n`);
      return;
    }
    process.stdout.write(output);
    return;
  }

  const total = typeof data.totalResults === 'number'
    ? data.totalResults
    : Array.isArray(data.results) ? data.results.length : 0;
  const duration = typeof data.duration === 'number' ? data.duration : 0;
  const engine = data.engine || 'unknown';
  process.stderr.write(`Found ${total} results in ${duration}ms (engine: ${engine})\n\n`);
  output = formatMarkdown(data, query);
  if (outFile) {
    fs.writeFileSync(outFile, output, 'utf8');
    process.stderr.write(`Wrote UTF-8 search results to ${outFile}\n`);
    return;
  }
  process.stdout.write(output);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Search failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

module.exports = {
  ensureServerAvailable,
  expandUserPath,
  isCompatibleHealthBody,
  isServerHealthy,
  parseArgs,
};
