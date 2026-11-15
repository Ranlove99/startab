import { json, isAdmin, fetchWithTimeout, UA } from '../_lib.js';
import { seedData } from '../_seed.js';

const MAX_BODY = 512 * 1024; // 512KB，防止刷爆 KV 配额
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const bool = (v, def = false) => (typeof v === 'boolean' ? v : def);
const num = (v, min, max, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const safeUrl = (v) => {
  const s = str(v, 500).trim();
  return /^https?:\/\//i.test(s) ? s : '';
};

const cleanSettings = (input = {}, base = seedData.settings) => {
  const s = input && typeof input === 'object' ? input : {};
  const w = s.wallpaper && typeof s.wallpaper === 'object' ? s.wallpaper : {};
  const wt = ['bing', 'url', 'color', 'gradient', 'upload'].includes(w.type) ? w.type : base.wallpaper.type;
  const weather = s.weather && typeof s.weather === 'object' ? s.weather : {};
  const widgets = s.widgets && typeof s.widgets === 'object' ? s.widgets : {};
  return {
    siteTitle: str(s.siteTitle, 40) || base.siteTitle,
    theme: ['auto', 'light', 'dark'].includes(s.theme) ? s.theme : base.theme,
    accent: /^#[0-9a-f]{6}$/i.test(s.accent || '') ? s.accent : base.accent,
    blur: num(s.blur, 0, 40, base.blur),
    iconSize: num(s.iconSize, 36, 96, base.iconSize),
    columns: num(s.columns, 3, 12, base.columns),
    dim: num(s.dim, 0, 0.8, base.dim),
    wallpaper: { type: wt, value: str(w.value, 600) },
    searchEngine: str(s.searchEngine, 20) || base.searchEngine,
    openInNewTab: bool(s.openInNewTab, base.openInNewTab),
    weather: {
      name: str(weather.name, 40) || base.weather.name,
      lat: num(weather.lat, -90, 90, base.weather.lat),
      lon: num(weather.lon, -180, 180, base.weather.lon),
      unit: weather.unit === 'f' ? 'f' : 'c',
    },
    hotSource: ['weibo', 'baidu', 'bili'].includes(s.hotSource) ? s.hotSource : base.hotSource,
    widgets: {
      clock: bool(widgets.clock, true),
      weather: bool(widgets.weather, true),
      hot: bool(widgets.hot, true),
      todo: bool(widgets.todo, true),
      countdown: bool(widgets.countdown, true),
    },
  };
};

/** 严格白名单清洗，拒绝任何未定义字段落库 */
export const sanitize = (raw) => {
  const src = raw && typeof raw === 'object' ? raw : {};
  const categories = (Array.isArray(src.categories) ? src.categories : [])
    .slice(0, 40)
    .map((c, i) => ({
      id: str(c?.id, 40) || `c${i}`,
      name: str(c?.name, 30) || '未命名',
      icon: str(c?.icon, 12),
      hidden: bool(c?.hidden, false),
    }));

  const catIds = new Set(categories.map((c) => c.id));
  const fallbackCat = categories[0]?.id || 'c1';

  const items = (Array.isArray(src.items) ? src.items : [])
    .slice(0, 1000)
    .map((it, i) => ({
      id: str(it?.id, 40) || `i${i}`,
      catId: catIds.has(str(it?.catId, 40)) ? str(it?.catId, 40) : fallbackCat,
      title: str(it?.title, 60) || '未命名',
      url: safeUrl(it?.url),
      icon: str(it?.icon, 500),
      color: /^#[0-9a-f]{6}$/i.test(it?.color || '') ? it.color : '',
    }))
    .filter((it) => it.url);

  const todos = (Array.isArray(src.todos) ? src.todos : []).slice(0, 300).map((t, i) => ({
    id: str(t?.id, 40) || `t${i}`,
    text: str(t?.text, 200),
    done: bool(t?.done, false),
    createdAt: num(t?.createdAt, 0, Number.MAX_SAFE_INTEGER, 0),
  })).filter((t) => t.text);

  const countdowns = (Array.isArray(src.countdowns) ? src.countdowns : []).slice(0, 60).map((d, i) => ({
    id: str(d?.id, 40) || `d${i}`,
    title: str(d?.title, 40),
    date: /^\d{4}-\d{2}-\d{2}$/.test(d?.date || '') ? d.date : '',
  })).filter((d) => d.title && d.date);

  return {
    version: 1,
    settings: cleanSettings(src.settings),
    categories,
    items,
    todos,
    countdowns,
  };
};

const bingWallpaper = async (env) => {
  const cached = await env.nav.get('wallpaper', 'json').catch(() => null);
  if (cached?.url && cached.exp > Date.now()) return cached.url;
  const fallback = 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?q=80&w=1920&auto=format&fit=crop';
  try {
    const res = await fetchWithTimeout(
      'https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN',
      { headers: { 'User-Agent': UA } },
    );
    if (!res.ok) return fallback;
    const data = await res.json();
    const path = data?.images?.[0]?.url;
    if (!path) return fallback;
    const url = `https://www.bing.com${path}`;
    await env.nav.put('wallpaper', JSON.stringify({ url, exp: Date.now() + 12 * 3600 * 1000 }));
    return url;
  } catch {
    return fallback;
  }
};

export const onRequestGet = async ({ request, env }) => {
  if (!env.nav) return json({ error: 'KV_NOT_BOUND', message: '未绑定名为 nav 的 KV 命名空间' }, 500);

  const admin = await isAdmin(request, env);
  const stored = await env.nav.get('config', 'json').catch(() => null);
  const data = stored ? sanitize(stored) : seedData;

  // 游客看不到隐藏项，也拿不到待办/倒计时这类个人数据
  const visible = admin
    ? data
    : {
        ...data,
        categories: data.categories.filter((c) => !c.hidden),
        items: data.items.filter((it) => {
          const cat = data.categories.find((c) => c.id === it.catId);
          return !cat?.hidden;
        }),
        todos: [],
        countdowns: [],
      };

  const wallpaperUrl = data.settings.wallpaper.type === 'bing' ? await bingWallpaper(env) : '';

  return json({
    data: visible,
    admin,
    wallpaperUrl,
    serverTime: Date.now(),
    seeded: Boolean(stored),
  });
};

export const onRequestPut = async ({ request, env }) => {
  if (!env.nav) return json({ error: 'KV_NOT_BOUND' }, 500);
  if (!env.TOKEN) return json({ error: 'TOKEN_NOT_CONFIGURED', message: '请先配置 TOKEN 环境变量' }, 500);
  if (!(await isAdmin(request, env))) return json({ error: 'UNAUTHORIZED', message: '请先登录' }, 401);

  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_BODY) return json({ error: 'PAYLOAD_TOO_LARGE', message: '数据超过 512KB' }, 413);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'BAD_JSON' }, 400);
  }

  const data = sanitize(body);
  const payload = JSON.stringify(data);
  if (payload.length > MAX_BODY) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);

  await env.nav.put('config', payload);
  return json({ ok: true, size: payload.length, updatedAt: Date.now() });
};

export const onRequestDelete = async ({ request, env }) => {
  if (!env.nav) return json({ error: 'KV_NOT_BOUND' }, 500);
  if (!(await isAdmin(request, env))) return json({ error: 'UNAUTHORIZED', message: '请先登录' }, 401);
  await env.nav.delete('config');
  return json({ ok: true, message: '已恢复默认配置' });
};

export const onRequest = async (ctx) => {
  if (ctx.request.method === 'GET') return onRequestGet(ctx);
  if (ctx.request.method === 'PUT') return onRequestPut(ctx);
  if (ctx.request.method === 'DELETE') return onRequestDelete(ctx);
  return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
};
