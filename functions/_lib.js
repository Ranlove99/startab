/**
 * 公共工具：JSON 响应、哈希、常量时间比较、会话签发与校验
 * 注意：文件名以 _ 开头，Cloudflare Pages 不会为它生成路由。
 */

export const json = (data, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });

export const sha256 = async (text) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** 常量时间比较，避免通过响应时间推测密码 */
export const safeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const hmac = async (secret, msg) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
};

/** 会话有效期 7 天 */
export const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

const secretOf = (env) => env.SESSION_SECRET || env.TOKEN || '';

export const issueToken = async (env) => {
  const exp = Date.now() + SESSION_TTL;
  const payload = String(exp);
  const sig = b64url(await hmac(secretOf(env), payload));
  return { token: `${payload}.${sig}`, exp };
};

export const verifyToken = async (env, token) => {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  const exp = Number(payload);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expect = b64url(await hmac(secretOf(env), payload));
  return safeEqual(sig, expect);
};

export const isAdmin = async (request, env) => {
  if (!env.TOKEN) return false; // fail-closed：未配置密码时任何人都不是管理员
  const header = request.headers.get('Authorization') || '';
  const matched = header.match(/^Bearer\s+(.+)$/i);
  if (!matched) return false;
  return verifyToken(env, matched[1].trim());
};

export const clientIp = (request) =>
  request.headers.get('CF-Connecting-IP') ||
  (request.headers.get('X-Forwarded-For') || '').split(',')[0].trim() ||
  'unknown';

/** 带超时的外部请求，避免上游卡死整个 Function */
export const fetchWithTimeout = async (url, options = {}, ms = 6000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

export const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
