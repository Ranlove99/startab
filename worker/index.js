/**
 * Cloudflare Workers 入口（Workers Builds + Workers Assets）
 *
 * 把 /api/* 路由到 functions/api/* 里已有的处理器，其余请求交给静态资源。
 * 这样同一套接口代码既能跑 Pages Functions，也能跑 Workers。
 */
import { onRequest as configHandler } from '../functions/api/config.js';
import { onRequest as authHandler } from '../functions/api/auth.js';
import { onRequest as weatherHandler } from '../functions/api/weather.js';
import { onRequest as hotHandler } from '../functions/api/hot.js';

const API = {
  '/api/config': configHandler,
  '/api/auth': authHandler,
  '/api/weather': weatherHandler,
  '/api/hot': hotHandler,
};

const json = (data, status = 404) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json;charset=UTF-8', 'Cache-Control': 'no-store' },
  });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    const handler = API[path];
    if (handler) {
      return handler({
        request,
        env,
        params: {},
        data: {},
        functionPath: path,
        next: async () => env.ASSETS.fetch(request),
        waitUntil: (p) => ctx.waitUntil(p),
        passThroughOnException: () => ctx.passThroughOnException(),
      });
    }

    // 未实现的接口明确返回 404，避免被静态资源兜底成 HTML
    if (path.startsWith('/api/')) return json({ error: 'NOT_FOUND' }, 404);

    if (!env.ASSETS) return json({ error: 'ASSETS_NOT_BOUND', message: '未绑定静态资源' }, 500);

    const res = await env.ASSETS.fetch(request);
    // 单页应用兜底：其余 GET 路径回到首页
    if (res.status === 404 && request.method === 'GET') {
      return env.ASSETS.fetch(new Request(new URL('/', url).toString(), request));
    }
    return res;
  },
};
