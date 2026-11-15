/** 小组件：时钟、天气、热搜、待办、倒计时 */
import { state, save, toast, uid } from './store.js';

const $ = (id) => document.getElementById(id);

/* ---------------- 时钟 ---------------- */
const GREETS = [
  [5, '夜深了，早点休息'],
  [9, '早上好，新的一天'],
  [12, '上午好，专注一会儿'],
  [14, '中午好，记得午休'],
  [18, '下午好，来杯咖啡'],
  [23, '晚上好，今天辛苦了'],
];

const greetOf = (hour) => {
  for (const [until, text] of GREETS) if (hour < until) return text;
  return '夜深了，早点休息';
};

export const startClock = () => {
  const timeEl = $('clockTime');
  const dateEl = $('clockDate');
  const greetEl = $('clockGreet');
  if (!timeEl) return;

  const tick = () => {
    const now = new Date();
    timeEl.textContent = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    dateEl.textContent = now.toLocaleDateString('zh-CN', {
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    });
    greetEl.textContent = greetOf(now.getHours());
  };
  tick();
  setInterval(tick, 1000 * 15);
};

/* ---------------- 天气 ---------------- */
const WMO = {
  0: ['☀️', '晴'], 1: ['🌤', '大部晴朗'], 2: ['⛅', '局部多云'], 3: ['☁️', '阴'],
  45: ['🌫', '有雾'], 48: ['🌫', '雾凇'],
  51: ['🌦', '小毛毛雨'], 53: ['🌦', '毛毛雨'], 55: ['🌧', '大毛毛雨'],
  56: ['🌧', '冻毛毛雨'], 57: ['🌧', '冻毛毛雨'],
  61: ['🌦', '小雨'], 63: ['🌧', '中雨'], 65: ['🌧', '大雨'],
  66: ['🌧', '冻雨'], 67: ['🌧', '强冻雨'],
  71: ['🌨', '小雪'], 73: ['🌨', '中雪'], 75: ['❄️', '大雪'], 77: ['🌨', '雪粒'],
  80: ['🌦', '阵雨'], 81: ['🌧', '强阵雨'], 82: ['⛈', '暴雨'],
  85: ['🌨', '阵雪'], 86: ['❄️', '强阵雪'],
  95: ['⛈', '雷阵雨'], 96: ['⛈', '雷暴冰雹'], 99: ['⛈', '强雷暴冰雹'],
};

const weatherOf = (code) => WMO[code] || ['🌡', '未知'];

let weatherLoadedAt = 0;

export const loadWeather = async (force = false) => {
  const w = state.data?.settings?.weather;
  if (!w) return;
  if (!force && Date.now() - weatherLoadedAt < 10 * 60 * 1000) return;

  const iconEl = $('weatherIcon');
  const tempEl = $('weatherTemp');
  const descEl = $('weatherDesc');
  const metaEl = $('weatherMeta');
  if (!iconEl) return;

  try {
    const qs = new URLSearchParams({
      lat: String(w.lat),
      lon: String(w.lon),
      unit: w.unit || 'c',
      name: w.name || '',
    });
    const res = await fetch(`/api/weather?${qs}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    if (d.error) throw new Error(d.error);

    const [emoji, text] = weatherOf(d.code);
    iconEl.textContent = emoji;
    tempEl.textContent = `${d.temp}°`;
    descEl.textContent = `${w.name || d.name} · ${text}`;
    metaEl.textContent = '';
    const bits = [
      `体感 ${d.feels}°`,
      `湿度 ${d.humidity}%`,
      `风 ${d.wind} km/h`,
      `最高 ${d.max}° / 最低 ${d.min}°`,
    ];
    for (const b of bits) {
      const span = document.createElement('span');
      span.textContent = b;
      metaEl.appendChild(span);
    }
    weatherLoadedAt = Date.now();
  } catch {
    descEl.textContent = '天气暂不可用';
    metaEl.textContent = '可在设置中更换城市，或稍后重试';
  }
};

export const searchCity = async (keyword) => {
  const box = $('cityResults');
  if (!box) return;
  box.textContent = '';
  const q = keyword.trim();
  if (!q) return;
  try {
    const res = await fetch(`/api/weather?q=${encodeURIComponent(q)}`);
    const d = await res.json();
    const list = d.results || [];
    if (!list.length) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = '没有找到这个城市';
      box.appendChild(p);
      return;
    }
    for (const c of list) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `${c.name}${c.region ? ` · ${c.region}` : ''}`;
      btn.addEventListener('click', () => {
        state.data.settings.weather = { name: c.name, lat: c.lat, lon: c.lon, unit: state.data.settings.weather.unit };
        save();
        box.textContent = '';
        $('setCity').value = c.name;
        loadWeather(true);
        toast(`已切换到 ${c.name}`);
      });
      box.appendChild(btn);
    }
  } catch {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = '城市搜索失败';
    box.appendChild(p);
  }
};

/* ---------------- 热搜 ---------------- */
let hotLoadedAt = 0;
let hotLoading = false;

export const renderHot = async (source, force = false) => {
  const listEl = $('hotList');
  if (!listEl) return;
  const src = source || state.data?.settings?.hotSource || 'weibo';
  if (!force && hotLoading) return;
  if (!force && Date.now() - hotLoadedAt < 5 * 60 * 1000 && listEl.childElementCount > 0) return;

  hotLoading = true;
  listEl.textContent = '';
  const loading = document.createElement('li');
  loading.className = 'empty';
  loading.textContent = '加载中…';
  listEl.appendChild(loading);

  try {
    const res = await fetch(`/api/hot?source=${encodeURIComponent(src)}`);
    const d = await res.json();
    listEl.textContent = '';
    if (!d.items?.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = '数据源暂时不可用，稍后再试';
      listEl.appendChild(li);
      return;
    }
    for (const item of d.items) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = item.url || '#';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = item.title;
      a.appendChild(t);
      li.appendChild(a);
      listEl.appendChild(li);
    }
    hotLoadedAt = Date.now();
  } catch {
    listEl.textContent = '';
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '热搜加载失败';
    listEl.appendChild(li);
  } finally {
    hotLoading = false;
  }
};

/* ---------------- 待办 ---------------- */
export const renderTodos = () => {
  const listEl = $('todoList');
  const countEl = $('todoCount');
  if (!listEl) return;
  const todos = state.data?.todos || [];
  listEl.textContent = '';

  const undone = todos.filter((t) => !t.done).length;
  if (countEl) countEl.textContent = todos.length ? `${undone}/${todos.length}` : '';

  if (!todos.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.style.color = 'var(--muted)';
    li.style.fontSize = '12.5px';
    li.textContent = state.admin ? '还没有待办，添加一条试试' : '登录后可添加待办';
    listEl.appendChild(li);
    return;
  }

  for (const todo of todos) {
    const li = document.createElement('li');
    if (todo.done) li.classList.add('done');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = todo.done;
    cb.disabled = !state.admin;
    cb.addEventListener('change', () => {
      todo.done = cb.checked;
      save();
      renderTodos();
    });

    const txt = document.createElement('span');
    txt.className = 'txt';
    txt.textContent = todo.text;

    const del = document.createElement('button');
    del.className = 'del';
    del.type = 'button';
    del.textContent = '✕';
    del.title = '删除';
    del.addEventListener('click', () => {
      state.data.todos = state.data.todos.filter((t) => t.id !== todo.id);
      save();
      renderTodos();
    });

    li.append(cb, txt, del);
    listEl.appendChild(li);
  }
};

export const addTodo = (text) => {
  const value = text.trim();
  if (!value) return false;
  state.data.todos.unshift({ id: uid('t'), text: value.slice(0, 200), done: false, createdAt: Date.now() });
  save();
  renderTodos();
  return true;
};

/* ---------------- 倒计时 ---------------- */
const daysBetween = (dateStr) => {
  const target = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
};

export const renderCountdowns = () => {
  const listEl = $('countdownList');
  if (!listEl) return;
  listEl.textContent = '';
  const items = (state.data?.countdowns || [])
    .map((d) => ({ ...d, days: daysBetween(d.date) }))
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0));

  if (!items.length) {
    const li = document.createElement('li');
    li.style.color = 'var(--muted)';
    li.style.fontSize = '12.5px';
    li.textContent = state.admin ? '添加一个值得期待的日子' : '登录后可添加倒计时';
    listEl.appendChild(li);
    return;
  }

  for (const d of items) {
    const li = document.createElement('li');

    const days = document.createElement('span');
    days.className = 'cd-days';
    if (d.days === null) {
      days.textContent = '—';
    } else if (d.days === 0) {
      days.textContent = '今天';
    } else if (d.days > 0) {
      days.textContent = String(d.days);
      const small = document.createElement('small');
      small.textContent = '天';
      days.appendChild(small);
    } else {
      days.textContent = `+${Math.abs(d.days)}`;
    }

    const title = document.createElement('span');
    title.className = 'cd-title';
    title.textContent = d.title;

    const date = document.createElement('span');
    date.className = 'cd-date';
    date.textContent = d.date;

    const del = document.createElement('button');
    del.className = 'del';
    del.type = 'button';
    del.textContent = '✕';
    del.addEventListener('click', () => {
      state.data.countdowns = state.data.countdowns.filter((x) => x.id !== d.id);
      save();
      renderCountdowns();
    });

    li.append(days, title, date, del);
    listEl.appendChild(li);
  }
};

/* ---------------- 可见性 ---------------- */
export const applyWidgetVisibility = () => {
  const s = state.data?.settings;
  if (!s) return;
  const map = {
    clockCard: s.widgets.clock,
    weatherCard: s.widgets.weather,
    hotCard: s.widgets.hot,
    todoCard: s.widgets.todo && state.admin,
    countdownCard: s.widgets.countdown && state.admin,
  };
  for (const [id, visible] of Object.entries(map)) {
    const el = $(id);
    if (el) el.hidden = !visible;
  }
};
