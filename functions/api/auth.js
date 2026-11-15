import { json, sha256, safeEqual, issueToken, isAdmin, clientIp } from '../_lib.js';

const MAX_FAILS = 5;
const WINDOW = 300; // 5 分钟内最多失败 5 次

export const onRequest = async ({ request, env }) => {
  if (!env.nav) return json({ error: 'KV_NOT_BOUND', message: '未绑定名为 nav 的 KV 命名空间' }, 500);

  // GET：校验当前会话是否仍然有效（前端启动时调用）
  if (request.method === 'GET') {
    return json({ admin: await isAdmin(request, env) });
  }

  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  // fail-closed：没配密码就彻底关闭写入口，绝不用空字符串兜底
  if (!env.TOKEN) {
    return json(
      { error: 'TOKEN_NOT_CONFIGURED', message: '服务端未配置 TOKEN 环境变量，管理功能已禁用' },
      500,
    );
  }

  const ip = clientIp(request);
  const rlKey = `rl:${ip}`;
  const rl = await env.nav.get(rlKey, 'json').catch(() => null);
  const withinWindow = rl && Date.now() - rl.ts < WINDOW * 1000;

  if (withinWindow && rl.n >= MAX_FAILS) {
    return json(
      { error: 'TOO_MANY_ATTEMPTS', message: `尝试次数过多，请 ${Math.ceil((WINDOW * 1000 - (Date.now() - rl.ts)) / 60000)} 分钟后再试` },
      429,
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'BAD_JSON' }, 400);
  }

  const password = typeof body?.password === 'string' ? body.password.slice(0, 256) : '';
  const [inputHash, realHash] = await Promise.all([sha256(password), sha256(env.TOKEN)]);

  if (!safeEqual(inputHash, realHash)) {
    const next = { n: (withinWindow ? rl.n : 0) + 1, ts: Date.now() };
    await env.nav.put(rlKey, JSON.stringify(next), { expirationTtl: WINDOW }).catch(() => {});
    return json({ error: 'INVALID_PASSWORD', message: '密码错误' }, 401);
  }

  await env.nav.delete(rlKey).catch(() => {});
  const { token, exp } = await issueToken(env);
  return json({ ok: true, token, exp });
};
