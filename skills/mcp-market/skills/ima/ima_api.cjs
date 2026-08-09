#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_BASE_URL = 'https://ima.qq.com';
const DEFAULT_LAST_CHECK_FILE = path.join(os.homedir(), '.config/ima/last_update_check');
const QCC_APP_NAME = 'BizOwl';
const QCC_MARKET_NAME = 'ima';
const IMA_CLIENT_ID_KEY = 'IMA_OPENAPI_CLIENTID';
const IMA_API_KEY_KEY = 'IMA_OPENAPI_APIKEY';

// Only two categories of errors:
//   -100: programmatic error (bad args, missing credentials, network, etc.)
//   -200: skill update available
const ERR_PROGRAMMATIC = -100;
const ERR_UPDATE_AVAILABLE = -200;

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return '';
  }
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function resolveQccUserDataDir() {
  if (process.env.BIZOWL_USER_DATA_DIR && process.env.BIZOWL_USER_DATA_DIR.trim()) {
    return process.env.BIZOWL_USER_DATA_DIR.trim();
  }
  const homeDir = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', QCC_APP_NAME);
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), QCC_APP_NAME);
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(homeDir, '.config'), QCC_APP_NAME);
}

function readQccMarketAuthFile() {
  const authPath = path.join(resolveQccUserDataDir(), 'mcp-installed', '.auth', 'market-auth.json');
  try {
    return JSON.parse(fs.readFileSync(authPath, 'utf8'));
  } catch (error) {
    const err = new Error('failed to read market auth');
    err.code = ERR_PROGRAMMATIC;
    err.msg =
      '未找到 IMA OpenAPI 凭证。请在 BizOwl 的 MCP 市场中打开 IMA 知识库与笔记卡片，点击编辑，配置 Client ID 和 API Key。';
    err.cause = error;
    throw err;
  }
}

function loadCredentials() {
  const authFile = readQccMarketAuthFile();
  const values = authFile && authFile.markets && authFile.markets[QCC_MARKET_NAME]
    ? authFile.markets[QCC_MARKET_NAME].values || {}
    : {};
  const clientId = typeof values[IMA_CLIENT_ID_KEY] === 'string' ? values[IMA_CLIENT_ID_KEY].trim() : '';
  const apiKey = typeof values[IMA_API_KEY_KEY] === 'string' ? values[IMA_API_KEY_KEY].trim() : '';

  if (!clientId || !apiKey) {
    const err = new Error('missing credentials');
    err.code = ERR_PROGRAMMATIC;
    err.msg =
      '未找到 IMA OpenAPI 凭证。请在 BizOwl 的 MCP 市场中打开 IMA 知识库与笔记卡片，点击编辑，配置 Client ID 和 API Key。';
    throw err;
  }

  return { clientId, apiKey };
}

function loadSkillVersion(options = {}) {
  if (options.skillVersion) return options.skillVersion;
  if (process.env.IMA_SKILL_VERSION) return process.env.IMA_SKILL_VERSION;

  const metaPath = path.join(__dirname, 'meta.json');
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    return meta.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

async function postJson(apiPath, body, requestOptions) {
  const { clientId, apiKey, skillVersion, baseUrl } = requestOptions;

  const res = await fetch(`${baseUrl}/${apiPath}`, {
    method: 'POST',
    headers: {
      'ima-openapi-clientid': clientId,
      'ima-openapi-apikey': apiKey,
      'ima-openapi-ctx': `skill_version=${skillVersion}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  return await res.text();
}

function readToday() {
  return new Date().toISOString().slice(0, 10);
}

function saveTodayChecked(lastCheckFile, today) {
  ensureDir(lastCheckFile);
  fs.writeFileSync(lastCheckFile, today, 'utf8');
}

async function checkSkillUpdateIfNeeded(requestOptions) {
  const { forceCheck, skillVersion, lastCheckFile } = requestOptions;

  const today = readToday();
  const checkedDay = readFileSafe(lastCheckFile);

  if (!forceCheck && checkedDay === today) {
    return;
  }

  let updateResponseText;
  try {
    updateResponseText = await postJson('openapi/check_skill_update', { version: skillVersion }, requestOptions);
  } catch {
    // Skip this round when update check fails.
    return;
  }

  saveTodayChecked(lastCheckFile, today);

  let updateResp;
  try {
    updateResp = JSON.parse(updateResponseText || '{}');
  } catch {
    updateResp = {};
  }

  const latestVersion = (updateResp.data && updateResp.data.latest_version) || '';
  const releaseDesc = (updateResp.data && updateResp.data.release_desc) || '';
  const instruction = (updateResp.data && updateResp.data.instruction) || '';
  if (latestVersion && latestVersion !== skillVersion) {
    const updateContext = {
      current_version: skillVersion,
      latest_version: latestVersion,
      release_desc: releaseDesc,
      instruction,
      checked_at: new Date().toISOString(),
    };

    process.stdout.write(JSON.stringify(updateContext));

    const err = new Error('update available');
    err.code = ERR_UPDATE_AVAILABLE;
    err.msg = `发现新版本 skill：${latestVersion}（当前版本：${skillVersion}）。${instruction || '请更新。'}`;
    err.updateContext = updateContext;
    throw err;
  }
}

async function imaApi(apiPath, body, options = {}) {
  const forceCheck = options.forceCheck || options.forceUpdateCheck || process.env.IMA_FORCE_UPDATE_CHECK === '1';
  const baseUrl = options.baseUrl || process.env.IMA_BASE_URL || DEFAULT_BASE_URL;
  const lastCheckFile = options.lastCheckFile || process.env.IMA_LAST_CHECK_FILE || DEFAULT_LAST_CHECK_FILE;
  const { clientId, apiKey } = loadCredentials(options);
  const skillVersion = loadSkillVersion(options);

  const requestOptions = {
    forceCheck,
    clientId,
    apiKey,
    skillVersion,
    baseUrl,
    lastCheckFile,
  };

  if (apiPath !== 'openapi/check_skill_update') {
    await checkSkillUpdateIfNeeded(requestOptions);
  }

  return postJson(apiPath, body, requestOptions);
}

function parseBody(raw) {
  if (!raw || !raw.trim()) return {};

  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error('invalid JSON body');
    err.code = ERR_PROGRAMMATIC;
    err.msg = '请求 body 不是合法的 JSON，请检查输入。';
    throw err;
  }
}

function parseOptions(raw, restArgs) {
  let options = {};

  if (raw && raw.trim()) {
    try {
      options = JSON.parse(raw);
    } catch {
      const err = new Error('invalid options JSON');
      err.code = ERR_PROGRAMMATIC;
      err.msg = 'options 参数不是合法的 JSON，请检查输入。';
      throw err;
    }
  }

  if (restArgs.includes('--force-update-check')) {
    options.forceCheck = true;
  }

  return options;
}

async function main() {
  const [, , apiPath, rawBody = '{}', rawOptions = '{}', ...rest] = process.argv;

  if (!apiPath) {
    process.stderr.write(JSON.stringify({ code: ERR_PROGRAMMATIC, msg: '缺少必需参数：apiPath。' }));
    // Unix exit codes are 0-255; use 1 as generic failure. Callers should parse stderr JSON for the real code.
    process.exit(1);
  }

  try {
    const body = parseBody(rawBody);
    const options = parseOptions(rawOptions, rest);
    const resp = await imaApi(apiPath, body, options);
    process.stdout.write(resp);
  } catch (err) {
    const code = err && typeof err.code === 'number' ? err.code : ERR_PROGRAMMATIC;
    const msg = (err && err.msg) || (err && err.message) || '未知错误';
    process.stderr.write(JSON.stringify({ code, msg }));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  imaApi,
  ERR_PROGRAMMATIC,
  ERR_UPDATE_AVAILABLE,
};
