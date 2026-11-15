/** 数据层：远程 KV 读写 + 本地缓存 + 登录态 */

const LS_TOKEN = 'startab:token';
const LS_CACHE = 'startab:cache';
const LS_WALL = 'startab:wallpaper';

export const engines = [
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=%s' },
  { id: 'baidu', name: '百度', url: 'https://www.baidu.com/s?wd=%s' },
  { id: 'ddg', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  { id: 'github', name: 'GitHub', url: 'https://github.com/search?q=%s' },
  { id: 'bili', name: 'B站', url: 'https://search.bilibili.com/all?keyword=%s' },
  { id: 'zhihu', name: '知乎', url: 'https://www.zhihu.com/search?type=content&q=%s' },
];

export const DEFAULT_SETTINGS = {
  siteTitle: 'StarTab',
  theme: 'auto',
  accent: '#5b8cff',
  blur: 14,
  iconSize: 54,
  columns: 7,
  dim: 0.34,
  wallpaper: { type: 'bing', value: '' },
  searchEngine: 'bing',
  openInNewTab: true,
  weather: { name: '北京', lat: 39.9042, lon: 116.4074, unit: 'c' },
  hotSource: 'weibo',
  widgets: { clock: true, weather: true, hot: true, todo: true, countdown: true },
};

/** 首次加载 / 离线兜底数据 */
export const FALLBACK = {
  version: 1,
  settings: DEFAULT_SETTINGS,
  categories: [
    { id: 'c1', name: '常用', icon: '⭐', hidden: false },
    { id: 'c2', name: '开发', icon: '🛠', hidden: false },
    { id: 'c3', name: 'AI', icon: '🤖', hidden: false },
  ],
  items: [
    { id: 'i1', catId: 'c1', title: 'GitHub', url: 'https://github.com', icon: '', color: '#24292f' },
    { id: 'i2', catId: 'c1', title: 'Gmail', url: 'https://mail.google.com', icon: '', color: '#ea4335' },
    { id: 'i3', catId: 'c1', title: '哔哩哔哩', url: 'https://www.bilibili.com', icon: '', color: '#fb7299' },
    { id: 'i4', catId: 'c1', title: '知乎', url: 'https://www.zhihu.com', icon: '', color: '#0084ff' },
    { id: 'i5', catId: 'c2', title: 'MDN', url: 'https://developer.mozilla.org', icon: '', color: '#000000' },
    { id: 'i6', catId: 'c2', title: 'Stack Overflow', url: 'https://stackoverflow.com', icon: '', color: '#f48024' },
    { id: 'i7', catId: 'c2', title: 'V2EX', url: 'https://www.v2ex.com', icon: '', color: '#333333' },
    { id: 'i8', catId: 'c2', title: '掘金', url: 'https://juejin.cn', icon: '', color: '#1e80ff' },
    { id: 'i9', catId: 'c3', title: 'ChatGPT', url: 'https://chatgpt.com', icon: '', color: '#10a37f' },
    { id: 'i10', catId: 'c3', title: 'Claude', url: 'https://claude.ai', icon: '', color: '#d97757' },
    { id: 'i11', catId: 'c3', title: 'Gemini', url: 'https://gemini.google.com', icon: '', color: '#4285f4' },
    { id: 'i12', catId: 'c3', title: 'Hugging Face', url: 'https://huggingface.co', icon: '', color: '#ffcc4d' },
  ],
  todos: [],
  countdowns: [],
};

export const state = {
  data: null,
  admin: false,
  token: localStorage.getItem(LS_TOKEN) || '',
  activeCat: '',
  online: true,
  saving: false,
};

export const uid = (prefix = 'x') =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* ---------- 提示 ---------- */
let toastTimer = 0;
export const toast = (message, ms = 2200) => {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
};

/* ---------- 缓存 ---------- */
const readCache = () => {
  try {
    return JSON.parse(localStorage.getItem(LS_CACHE) || 'null');
  } catch {
    return null;
  }
};

const writeCache = (data) => {
  try {
    localStorage.setItem(LS_CACHE, JSON.stringify(data));
  } catch {
    /* 容量超限时忽略，不影响使用 */
  }
};

export const localWallpaper = {
  get: () => localStorage.getItem(LS_WALL) || '',
  set: (v) => {
    try {
      if (v) localStorage.setItem(LS_WALL, v);
      else localStorage.removeItem(LS_WALL);
    } catch {
      toast('图片过大，本地保存失败');
    }
  },
};

/* ---------- 请求 ---------- */
const authHeaders = () => (state.token ? { Authorization: `Bearer ${state.token}` } : {});

const request = async (url, options = {}) => {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(options.headers || {}) },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = new Error(body?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = body?.error;
    throw err;
  }
  return body;
};

/** 启动时加载：先用本地缓存秒开，再用远程数据覆盖 */
export const loadData = async () => {
  const cached = readCache();
  state.data = cached || structuredClone(FALLBACK);
  state.activeCat = state.data.categories[0]?.id || '';

  try {
    const remote = await request('/api/config');
    if (remote?.data) {
      state.data = remote.data;
      state.admin = Boolean(remote.admin);
      state.online = true;
      writeCache(remote.data);
      if (!state.data.categories.some((c) => c.id === state.activeCat)) {
        state.activeCat = state.data.categories[0]?.id || '';
      }
      return { wallpaperUrl: remote.wallpaperUrl || '', fresh: true };
    }
  } catch {
    state.online = false;
  }
  return { wallpaperUrl: '', fresh: false };
};

/** 校验本地 token 是否仍然有效 */
export const checkSession = async () => {
  if (!state.token) return false;
  try {
    const r = await request('/api/auth');
    state.admin = Boolean(r?.admin);
    if (!state.admin) {
      state.token = '';
      localStorage.removeItem(LS_TOKEN);
    }
    return state.admin;
  } catch {
    return false;
  }
};

export const login = async (password) => {
  const r = await request('/api/auth', { method: 'POST', body: JSON.stringify({ password }) });
  state.token = r.token;
  state.admin = true;
  localStorage.setItem(LS_TOKEN, r.token);
  return true;
};

export const logout = () => {
  state.token = '';
  state.admin = false;
  localStorage.removeItem(LS_TOKEN);
};

/* ---------- 保存（防抖 + 串行） ---------- */
let saveTimer = 0;
let savingPromise = null;

const flush = async () => {
  if (!state.admin) return;
  if (savingPromise) {
    await savingPromise.catch(() => {});
  }
  state.saving = true;
  savingPromise = request('/api/config', {
    method: 'PUT',
    body: JSON.stringify(state.data),
  })
    .then(() => {
      writeCache(state.data);
      state.online = true;
      return true;
    })
    .catch((err) => {
      state.online = false;
      if (err.status === 401) {
        logout();
        renderAdminStateSafe();
        toast('登录已过期，请重新登录');
      } else {
        toast(`云端保存失败：${err.message}`);
      }
      return false;
    })
    .finally(() => {
      state.saving = false;
      savingPromise = null;
    });
  return savingPromise;
};

export const save = (immediate = false) => {
  writeCache(state.data); // 无论是否登录都先落本地，保证刷新不丢
  if (!state.admin) return Promise.resolve(false);
  if (immediate) {
    clearTimeout(saveTimer);
    return flush();
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 700);
  return Promise.resolve(true);
};

/** 登录状态变化后通知 UI（避免循环依赖，用事件解耦） */
const renderAdminStateSafe = () => document.dispatchEvent(new CustomEvent('startab:admin'));

export const notifyAdminChange = () => renderAdminStateSafe();
