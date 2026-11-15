import { json, fetchWithTimeout, UA } from '../_lib.js';

const TTL = 600; // 10 分钟

const sources = {
  weibo: {
    name: '微博热搜',
    url: 'https://weibo.com/ajax/side/hotSearch',
    headers: { Referer: 'https://weibo.com/' },
    parse: (d) =>
      (d?.data?.realtime || [])
        .filter((x) => x && x.word && !x.is_ad)
        .slice(0, 15)
        .map((x) => ({
          title: x.word,
          url: `https://s.weibo.com/weibo?q=${encodeURIComponent(`#${x.word}#`)}`,
          hot: x.num ? String(x.num) : '',
        })),
  },
  baidu: {
    name: '百度热搜',
    url: 'https://top.baidu.com/api/board?platform=wise&tab=realtime',
    headers: { Referer: 'https://top.baidu.com/' },
    parse: (d) => {
      const card = (d?.data?.cards || []).find((c) => c?.component === 'tabTextList');
      const list = card?.content?.[0]?.content || [];
      return list
        .filter((x) => x && x.word)
        .slice(0, 15)
        .map((x) => ({ title: x.word, url: x.url || '', hot: '' }));
    },
  },
  bili: {
    name: 'B站热搜',
    url: 'https://api.bilibili.com/x/web-interface/search/square?limit=20',
    headers: { Referer: 'https://www.bilibili.com/' },
    parse: (d) =>
      (d?.data?.trending?.list || [])
        .filter((x) => x && x.keyword)
        .slice(0, 15)
        .map((x) => ({
          title: x.keyword,
          url: `https://search.bilibili.com/all?keyword=${encodeURIComponent(x.keyword)}`,
          hot: x.heat_score ? String(x.heat_score) : '',
        })),
  },
};

export const onRequest = async ({ request, env }) => {
  const url = new URL(request.url);
  const key = url.searchParams.get('source') || 'weibo';
  const src = sources[key];
  if (!src) return json({ error: 'UNKNOWN_SOURCE' }, 400);

  const cacheKv = `hot:${key}`;
  if (env.nav) {
    const cached = await env.nav.get(cacheKv, 'json').catch(() => null);
    if (cached && Date.now() - cached.updated < TTL * 1000) {
      return json({ ...cached, cached: true });
    }
  }

  try {
    const res = await fetchWithTimeout(src.url, { headers: { 'User-Agent': UA, ...src.headers } }, 7000);
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const data = await res.json();
    const items = src.parse(data);
    if (!items.length) throw new Error('empty result');

    const payload = { source: key, name: src.name, items, updated: Date.now() };
    if (env.nav) {
      await env.nav.put(cacheKv, JSON.stringify(payload), { expirationTtl: 900 }).catch(() => {});
    }
    return json(payload);
  } catch (err) {
    // 上游偶发风控很常见：返回空列表让前端优雅降级，而不是抛 5xx
    return json({ source: key, name: src.name, items: [], updated: Date.now(), error: String(err) });
  }
};
