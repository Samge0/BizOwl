/**
 * datasource-auth.js — 数据源认证服务
 *
 * 支持两种认证方式：
 * 1. 手机号 + 验证码登录
 * 2. 手动输入已有 Token（高级设置）
 *
 * Token 仅存储在本地（~/.BizOwl/auth.json），不会上传到任何服务器。
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { homedir } from 'node:os';

// Single-flight 保护：并发调用 refreshIfEnabled 时复用同一个 Promise，
// 避免 refreshToken 被多次消费（一次性轮换会导致后续调用失败）。
let _refreshPromise = null;

const CONFIG_DIR = path.join(homedir(), '.BizOwl');
const AUTH_FILE = path.join(CONFIG_DIR, 'auth.json');

const DEFAULT_API_BASE = 'https://qclaw-api.qcc.com';

/** 默认状态 */
function createDefaultState() {
  return {
    accessToken: null,
    refreshToken: null,
    phone: null,
    internationalCode: '+86',
    userInfo: null, // { userId, phone, nickname, avatarUrl }
    apiBaseUrl: DEFAULT_API_BASE,
    autoRefresh: false, // 是否自动刷新 token（仅扫码/验证码登录可开启）
  };
}

/** 读取认证状态 */
export function loadAuthState() {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      const raw = fs.readFileSync(AUTH_FILE, 'utf8');
      const data = JSON.parse(raw);
      return { ...createDefaultState(), ...data };
    }
  } catch (err) {
    console.warn('[QccAuth] 读取认证状态失败:', err.message);
  }
  return createDefaultState();
}

/** 保存认证状态 */
export function saveAuthState(state) {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    // mode 仅在创建时生效；显式 chmod 确保已存在的文件也被收紧为仅属主可读写
    fs.writeFileSync(AUTH_FILE, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(AUTH_FILE, 0o600); } catch {}
    return true;
  } catch (err) {
    console.error('[QccAuth] 保存认证状态失败:', err.message);
    return false;
  }
}

/** 清除认证 */
export function clearAuthState() {
  return saveAuthState(createDefaultState());
}

/** 获取 session summary（不返回 token 明文） */
export function getSessionSummary() {
  const state = loadAuthState();
  return {
    isLoggedIn: !!state.accessToken,
    phone: state.phone,
    internationalCode: state.internationalCode,
    userInfo: state.userInfo,
    apiBaseUrl: state.apiBaseUrl,
    hasToken: !!state.accessToken,
    autoRefresh: !!state.autoRefresh,
    // 是否具备刷新凭证（扫码/验证码登录有 refreshToken；手动配置 token 没有）
    hasRefreshToken: !!state.refreshToken,
  };
}

/** 设置 autoRefresh 开关 */
export function setAutoRefresh(enabled) {
  const state = loadAuthState();
  state.autoRefresh = !!enabled;
  saveAuthState(state);
  console.log('[QccAuth] autoRefresh:', enabled);
  return getSessionSummary();
}

/** 构建 session headers */
export function buildSessionHeaders(token) {
  return {
    'Authorization': 'Bearer ' + token,
    'x-claw-session-id': token,
  };
}

/** 发送 HTTP 请求到 QCC API */
function qccRequest(authState, apiPath, options = {}) {
  return new Promise((resolve, reject) => {
    const baseUrl = authState.apiBaseUrl || DEFAULT_API_BASE;
    const url = new URL(apiPath, baseUrl + '/').toString();
    const parsedUrl = new URL(url);
    const transport = parsedUrl.protocol === 'http:' ? http : https;

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers,
    };

    // 如果有 token，注入 session headers
    if (authState.accessToken) {
      Object.assign(headers, buildSessionHeaders(authState.accessToken));
    }

    const body = options.body ? JSON.stringify(options.body) : null;

    const req = transport.request(parsedUrl, {
      method: options.method || 'GET',
      headers,
    }, (res) => {
      let data = '';
      const _dec = new TextDecoder('utf-8');
      res.on('data', (chunk) => { data += _dec.decode(chunk, { stream: true }); });
      res.on('end', () => {
        data += _dec.decode(); // flush
        console.log(`[QccAuth] ${apiPath} → HTTP ${res.statusCode}, body length: ${data.length}`);
        if (res.statusCode !== 200) {
          reject(new Error(`QCC API HTTP ${res.statusCode}: ${data.slice(0, 500)}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });

    // 超时 15 秒
    req.setTimeout(15000, () => {
      req.destroy(new Error('请求超时（15s）'));
    });

    req.on('error', (err) => {
      console.error(`[QccAuth] ${apiPath} 请求错误:`, err.message);
      reject(err);
    });
    if (body) req.write(body);
    req.end();
  });
}

/**
 * 发送验证码（集成极验 GeeTest4 人机验证）
 *
 * 流程：
 * 1. 渲染层先通过 GeeTest4 SDK 完成人机验证，获得 captcha result
 * 2. 将 captcha result + phone 发到 /auth/send-code-with-geetest
 */
export async function sendCode(phone, internationalCode = '+86', captcha = null) {
  const state = loadAuthState();
  // 与原版一致：internationalCode 带 "+" 前缀
  const intl = (internationalCode?.trim() || '+86');
  const normalizedIntl = intl.startsWith('+') ? intl : '+' + intl;
  console.log(`[QccAuth] 发送验证码到 ${normalizedIntl} ${phone}`);

  if (!captcha) {
    return { success: false, message: '请先完成人机验证' };
  }

  try {
    const result = await qccRequest(state, '/auth/send-code-with-geetest', {
      method: 'POST',
      body: {
        phone,
        internationalCode: normalizedIntl,
        geeLotNumber: captcha.lot_number,
        geeCaptchaOutput: captcha.captcha_output,
        geePassToken: captcha.pass_token,
        geeGenTime: captcha.gen_time,
      },
    });
    console.log('[QccAuth] send-code 响应:', JSON.stringify(result));

    // ⚠️ HTTP 200 不代表短信真正发出——必须检查业务状态码。
    // QCC API 约定：code/status === 0 或 200 表示成功，其他均为失败。
    // 有些错误响应仍然返回 HTTP 200（如频率限制、验证码失效、手机号异常）。
    const bizCode = result.code ?? result.status ?? null;
    const bizMsg = result.msg || result.message || '';

    // 明确失败：code/status 为非零非 200 的值
    if (bizCode !== null && bizCode !== 0 && bizCode !== 200 && bizCode !== '0' && bizCode !== '200') {
      console.warn('[QccAuth] send-code 业务失败:', bizCode, bizMsg);
      return { success: false, message: bizMsg || `服务端返回错误码: ${bizCode}`, raw: result };
    }

    // 有些响应用 success:false 表示失败
    if (result.success === false) {
      return { success: false, message: bizMsg || '发送失败', raw: result };
    }

    return { success: true, message: bizMsg || '验证码已发送', raw: result };
  } catch (err) {
    console.error('[QccAuth] 发送验证码失败:', err.message);
    return { success: false, message: err.message };
  }
}

/**
 * 登录
 */
export async function login(phone, code, internationalCode = '+86') {
  const state = loadAuthState();
  // 与原版一致：internationalCode 带 "+" 前缀（如 "+86"）
  // 不带 "+" 可能导致服务端返回无资格的 token
  const normalizedIntl = internationalCode?.trim() || '+86';
  if (!normalizedIntl.startsWith('+')) {
    // 兼容前端传入 "86" 的情况
    console.warn(`[QccAuth] internationalCode 不带 "+" 前缀，自动修正: "${internationalCode}" → "+${normalizedIntl}"`);
  }
  const intl = normalizedIntl.startsWith('+') ? normalizedIntl : '+' + normalizedIntl;
  console.log(`[QccAuth] 登录: ${intl} ${phone}`);
  const payload = await qccRequest(state, '/auth/login', {
    method: 'POST',
    body: { phone, code, internationalCode: intl },
  });

  // 解析返回（兼容 getEnvelopeResult 的多形态封装）
  const data = payload.data || payload.result || payload;
  const accessToken = data.accessToken || data.token;
  if (!accessToken) {
    throw new Error('登录返回未包含 accessToken');
  }

  const userInfo = data.userInfo || null;
  const refreshToken = data.refreshToken || null;

  // 保存
  const nextState = {
    ...state,
    accessToken,
    refreshToken,
    phone,
    internationalCode: intl,
    userInfo: userInfo ? {
      userId: userInfo.userId || userInfo.guid || '',
      phone: userInfo.phone || phone,
      nickname: userInfo.nickname || phone,
      avatarUrl: userInfo.avatarUrl || userInfo.faceimg || null,
      checkInvite: userInfo.checkInvite === true,
    } : null,
  };
  saveAuthState(nextState);
  console.log('[QccAuth] 登录成功, userId:', nextState.userInfo?.userId);
  return getSessionSummary();
}

// ─────────────────────────────────────────────
// 扫码登录
// ─────────────────────────────────────────────

/**
 * 生成二维码登录会话
 * 返回 { sessionId, qrCodeUrl }
 */
export async function generateQrLoginSession() {
  const state = loadAuthState();
  console.log('[QccAuth] 生成扫码登录会话');
  const payload = await qccRequest(state, '/auth/generate-login-QR-code', {
    method: 'POST',
  });
  const data = payload.data || payload.result || payload;
  const sessionId = typeof data.sessionId === 'string' ? data.sessionId.trim() : '';
  if (!sessionId) {
    throw new Error('二维码登录响应未包含 sessionId');
  }
  const qrCodeUrl = `https://claw.qcc.com/qrcode_login?sid=${sessionId}`;
  console.log('[QccAuth] 扫码会话已创建, sessionId:', sessionId.slice(0, 8) + '...');
  return { sessionId, qrCodeUrl };
}

/**
 * 查询二维码扫码状态
 * 返回 { status: 'waiting'|'scanned'|'confirmed', login: null|sessionSummary }
 */
export async function getQrLoginStatus(sessionId) {
  const state = loadAuthState();
  const payload = await qccRequest(state, '/auth/get-login-QR-code-status', {
    method: 'POST',
    body: { sessionId },
  });
  const data = payload.data || payload.result || payload;
  const rawStatus = typeof data.status === 'number' ? data.status : null;

  // status: 2=scanned, 3/5=confirmed
  if (rawStatus === 3 || rawStatus === 5 || (rawStatus !== null && rawStatus >= 3)) {
    // 已确认 — 提取 token
    const accessToken = (data.token || data.accessToken || '').trim();
    if (!accessToken) {
      throw new Error('扫码登录确认响应未包含 token');
    }
    const refreshToken = (data.refreshToken || '').trim() || null;
    const userInfoRecord = data.userInfo || null;
    const userInfo = userInfoRecord ? {
      userId: userInfoRecord.userId || userInfoRecord.guid || '',
      phone: userInfoRecord.phone || '',
      nickname: userInfoRecord.nickname || userInfoRecord.phone || '',
      avatarUrl: userInfoRecord.avatarUrl || userInfoRecord.faceimg || null,
      checkInvite: userInfoRecord.checkInvite === true,
    } : null;

    const nextState = {
      ...state,
      accessToken,
      refreshToken,
      phone: userInfo?.phone || '',
      internationalCode: '+86',
      userInfo,
    };
    saveAuthState(nextState);
    console.log('[QccAuth] 扫码登录成功, userId:', nextState.userInfo?.userId);
    return { status: 'confirmed', login: getSessionSummary() };
  }

  if (rawStatus === 2) {
    return { status: 'scanned', login: null };
  }

  return { status: 'waiting', login: null };
}

/**
 * 绑定邀请码（激活试用资格）
 * 登录后如果 checkInvite 为 true，需要调用此接口绑定 8 位邀请码，
 * 否则积分接口返回 40106 "请先申请试用资格"。
 */
export async function bindInviteCode(inviteCode) {
  const code = String(inviteCode || '').replace(/\s+/g, '').trim();
  if (!code) throw new Error('邀请码不能为空');
  const state = loadAuthState();
  const payload = await qccRequest(state, '/auth/bind-invite-code', {
    method: 'POST',
    body: { inviteCode: code },
  });
  console.log('[QccAuth] bind-invite-code 响应:', JSON.stringify(payload));
  // 绑定成功后重新拉取用户信息，更新 checkInvite 状态
  try {
    const userResp = await qccRequest(state, '/auth/user-info-by-token', { method: 'POST' });
    const userData = userResp.result || userResp.data || userResp;
    if (userData) {
      saveAuthState({
        ...state,
        userInfo: {
          userId: userData.userId || userData.guid || state.userInfo?.userId || '',
          phone: userData.phone || state.userInfo?.phone || state.phone || '',
          nickname: userData.nickname || userData.phone || state.userInfo?.nickname || '用户',
          avatarUrl: userData.avatarUrl || userData.faceimg || state.userInfo?.avatarUrl || null,
          checkInvite: userData.checkInvite === true,
        },
      });
    }
  } catch (e) {
    console.warn('[QccAuth] 绑定后获取用户信息失败:', e.message);
  }
  return { success: true, message: payload.msg || payload.message || '邀请码绑定成功' };
}

/**
 * 获取积分信息
 * 返回 { balance, totalEarned, totalConsumed }
 */
export async function getCreditsInfo() {
  const state = loadAuthState();
  const payload = await qccRequest(state, '/credits/info', {
    method: 'POST',
  });
  const data = payload.data || payload.result || payload;
  // result 可能是 null（如 40106 "请先申请试用资格"），需要保护
  const safeData = data || {};
  return {
    balance: typeof safeData.balance === 'number' ? safeData.balance : 0,
    totalEarned: typeof safeData.totalEarned === 'number' ? safeData.totalEarned : 0,
    totalConsumed: typeof safeData.totalConsumed === 'number' ? safeData.totalConsumed : 0,
  };
}

/**
 * 手动设置 Token（高级设置，跳过登录）
 */
export function setTokenManually(token, apiBaseUrl) {
  const state = loadAuthState();
  const nextState = {
    ...state,
    accessToken: token,
    apiBaseUrl: apiBaseUrl || state.apiBaseUrl || DEFAULT_API_BASE,
  };
  saveAuthState(nextState);
  console.log('[QccAuth] Token 已手动设置');
  return getSessionSummary();
}

/**
 * 登出
 */
export function logout() {
  clearAuthState();
  console.log('[QccAuth] 已登出');
  return getSessionSummary();
}

/**
 * 验证当前 token 是否有效
 *
 * 与原版一致：用 POST /auth/user-info-by-token 验证（而非 /model/chat）。
 * 原因：验证码/扫码登录拿到的 token 在 /model/chat 可能返回非标准响应
 * （如积分不足、模型未授权等业务错误，body 很小但 HTTP 200），
 * 之前用 /model/chat 验证会把这类业务响应误判为 token 失效 → 立即登出。
 * /auth/user-info-by-token 只检查 token 本身是否有效，不受模型权限干扰。
 * 验证通过后自动更新 userInfo（nickname/phone/avatarUrl）。
 */
export async function verifySession() {
  // 最多两轮：第一轮 token 可能已过期 → 若开启「保持在线」则刷新后重试一轮
  for (let attempt = 0; attempt < 2; attempt++) {
    const state = loadAuthState();
    if (!state.accessToken) return { valid: false, reason: '无 token' };
    let expired = false;
    try {
      const resp = await qccRequest(state, '/auth/user-info-by-token', {
        method: 'POST',
      });

      // ✅ token 有效：能拿到用户信息（或至少服务端没有报 401/过期）
      const userData = resp.result || resp.data || resp;
      if (userData && (userData.userId || userData.guid || userData.nickname || userData.phone)) {
        // 更新 userInfo
        const nextState = {
          ...state,
          userInfo: {
            userId: userData.userId || userData.guid || state.userInfo?.userId || '',
            phone: userData.phone || state.userInfo?.phone || state.phone || '',
            nickname: userData.nickname || userData.phone || state.userInfo?.nickname || '用户',
            avatarUrl: userData.avatarUrl || userData.faceimg || state.userInfo?.avatarUrl || null,
            checkInvite: userData.checkInvite === true,
          },
        };
        saveAuthState(nextState);
        console.log('[QccAuth] token 有效, 用户:', nextState.userInfo.nickname);
        return { valid: true };
      }

      // 服务端返回了明确的过期/未登录
      if (resp && (resp.code === 401 || resp.code === 40102 || resp.status === 401)) {
        expired = true;
      } else {
        // 既没有 userInfo 也不是明确过期——可能是非标准响应格式
        // 保守处理：不判定为失效（避免误杀有效 token），只记录警告
        console.warn('[QccAuth] user-info-by-token 响应格式异常，不判定 token 失效:', JSON.stringify(resp).slice(0, 200));
        return { valid: true };
      }
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('401') || msg.includes('403') || msg.includes('40102')) {
        expired = true;
      } else {
        // 网络错误等——不判定 token 失效
        console.warn('[QccAuth] 验证请求失败（不判定 token 失效）:', msg);
        return { valid: true };
      }
    }
    // 本轮判定为过期：开启「保持在线」则刷新后进入下一轮重试
    if (expired && attempt === 0) {
      const refreshed = await refreshIfEnabled();
      if (refreshed) continue;
    }
    return { valid: false, reason: 'Token 已过期或失效，请在设置中更新 Token' };
  }
  return { valid: false, reason: 'Token 已过期或失效，请在设置中更新 Token' };
}

// ─── Token 自动刷新（被动 401 驱动） ───

/**
 * ⛔ 已禁用：refreshSession — 使用 refreshToken 换取新的 accessToken
 *
 * 出于安全考虑，本项目不主动消费 refreshToken。
 * 策略：只使用用户提供的 accessToken，过期后提示用户手动更新。
 * token 过期或验证不通过时，提示用户更新 Token。
 *
 * 函数体保留供参考，但不再被任何 IPC handler 调用。
 */
export async function refreshSession() {
  const state = loadAuthState();
  if (!state.refreshToken) {
    return { success: false, error: '无 refreshToken，无法刷新' };
  }

  // 最多重试 3 次
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[QccAuth] 刷新 Token (第 ${attempt}/${MAX_RETRIES} 次)...`);
      const payload = await qccRequest(
        { ...state, accessToken: null },
        '/auth/refresh',
        { method: 'POST', body: { refreshToken: state.refreshToken } }
      );
      const data = payload.data || payload.result || payload;
      const newAccessToken = data.token || data.accessToken;
      const newRefreshToken = data.refreshToken;
      if (!newAccessToken || !newRefreshToken) {
        throw new Error('刷新返回未包含 token/refreshToken');
      }
      // 一次性轮换：用新的替换旧的并持久化
      const nextState = {
        ...state,
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      };
      saveAuthState(nextState);
      console.log('[QccAuth] Session 刷新成功');
      return {
        success: true,
        token: newAccessToken,
        refreshToken: newRefreshToken,
        session: getSessionSummary(),
      };
    } catch (err) {
      console.warn(`[QccAuth] 第 ${attempt} 次刷新失败:`, err.message);
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 1000 * attempt)); // 指数退避
        continue;
      }
    }
  }

  // 全部重试失败 → 清除认证状态
  console.error('[QccAuth] refreshToken 刷新彻底失败，清除认证状态');
  clearAuthState();
  return { success: false, error: 'Token 刷新失败，已自动退出' };
}

/**
 * 保持在线：当用户开启了 autoRefresh 且具备 refreshToken 时，单次尝试刷新 accessToken。
 * - 成功 → 持久化新 token（含轮换后的 refreshToken）并返回新 accessToken；
 * - 未开启 / 无 refreshToken / 刷新失败 → 返回 null（不改动现有认证状态）。
 *
 * 注意：刷新会轮换 refreshToken，可能与同一账号的其他客户端（如数据源官方 App）互相踢下线——
 * 这正是用户主动开启「保持在线」时所接受的取舍。
 */
export async function refreshIfEnabled() {
  const state = loadAuthState();
  if (!state.autoRefresh || !state.refreshToken) return null;

  // Single-flight：如果已有刷新在进行中，复用同一个 Promise，
  // 避免 refreshToken 被并发请求重复消费（一次性轮换会导致第二次调用必败）。
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async () => {
    try {
      const payload = await qccRequest(
        { ...state, accessToken: null },
        '/auth/refresh',
        { method: 'POST', body: { refreshToken: state.refreshToken } }
      );
      const data = payload.data || payload.result || payload;
      const newAccessToken = data.token || data.accessToken;
      const newRefreshToken = data.refreshToken;
      if (!newAccessToken || !newRefreshToken) {
        console.warn('[QccAuth] 保持在线：刷新返回缺少 token/refreshToken');
        return null;
      }
      saveAuthState({ ...state, accessToken: newAccessToken, refreshToken: newRefreshToken });
      console.log('[QccAuth] 保持在线：Token 已自动刷新');
      return newAccessToken;
    } catch (err) {
      console.warn('[QccAuth] 保持在线：刷新失败:', err.message);
      return null;
    } finally {
      _refreshPromise = null;
    }
  })();

  return _refreshPromise;
}

/**
 * ⛔ 已禁用：ensureValidToken — 启动时确保 token 有效
 * 不再调用 refreshSession（出于安全考虑不自动刷新）。
 * Lite 版只在用户主动验证时检查 token 有效性，过期则提示用户更新。
 */
export async function ensureValidToken() {
  const state = loadAuthState();
  if (state.accessToken) {
    console.log('[QccAuth] 已有 accessToken，假定有效');
    return { ok: true, action: 'none', session: getSessionSummary() };
  }
  // 不消费 refreshToken — 提示用户需要手动提供 token
  console.log('[QccAuth] 无 accessToken，需要用户手动提供 Token');
  return { ok: false, action: 'token_required' };
}

// 过期判定关键词与 code
const SESSION_EXPIRED_KEYWORDS = ['已过期', '未登录', '登录已过期'];
const SESSION_EXPIRED_CODES = new Set([401, 40102]);

/** 判断响应 body 是否表示 session 过期 */
function isSessionExpired(body) {
  if (!body || typeof body !== 'object') return false;
  if (SESSION_EXPIRED_CODES.has(body.code)) return true;
  const msg = String(body.message || body.msg || '');
  return SESSION_EXPIRED_KEYWORDS.some((kw) => msg.includes(kw));
}

/**
 * 带 session 重试的请求（被动 401 刷新）
 * - 发请求 → 如果响应 body 表示 session 过期 → 调 refreshSession → 用新 token 重试
 * - refreshSession 失败 → 清除认证 + 抛出错误
 * @param {string} apiPath API 路径
 * @param {object} options { method, body, headers }
 * @returns {Promise<object>} 响应 body
 */
export async function requestWithSessionRetry(apiPath, options = {}) {
  const state = loadAuthState();
  const response = await qccRequest(state, apiPath, options);

  if (!isSessionExpired(response)) {
    return response;
  }

  // 不消费 refreshToken — 直接提示 token 已过期，需要用户更新
  console.warn('[QccAuth] Token 已过期，请更新 Token');
  const err = new Error('Token 已过期或失效，请在设置中更新 Token');
  err.code = 'TOKEN_EXPIRED';
  throw err;
}
