/** 主逻辑：渲染、搜索、拖拽、设置、登录 */
import {
  state, engines, loadData, checkSession, login, logout, save, toast, uid, localWallpaper,
} from './store.js';
import {
  startClock, loadWeather, searchCity, renderHot, renderTodos, addTodo, renderCountdowns,
  applyWidgetVisibility,
} from './widgets.js';

const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let bingWallpaperUrl = '';
let editingItemId = null;
let dragId = null;

/* ================= 主题 / 壁纸 ================= */
const resolveTheme = (theme) => {
  if (theme === 'light' || theme === 'dark') return theme;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
};

const applyTheme = () => {
  const theme = resolveTheme(state.data?.settings?.theme || 'auto');
  document.documentElement.dataset.theme = theme;
  $('themeBtn').textContent = theme === 'light' ? '☾' : '☀';
  $('themeBtn').title = theme === 'light' ? '切换到深色' : '切换到浅色';
};

const safeCssUrl = (url) => String(url).replace(/["'\\\n\r]/g, '');

const applyWallpaper = () => {
  const s = state.data?.settings;
  if (!s) return;
  const el = $('wallpaper');
  const type = s.wallpaper.type;
  const value = (s.wallpaper.value || '').trim();
  document.body.dataset.wall = type;

  if (type === 'color') {
    el.style.backgroundImage = 'none';
    el.style.backgroundColor = value || '#0b0f17';
    return;
  }
  if (type === 'gradient') {
    el.style.backgroundColor = '#0b0f17';
    el.style.backgroundImage = value || 'linear-gradient(135deg, #1b2a4a 0%, #3d1f4d 55%, #0b0f17 100%)';
    return;
  }
  if (type === 'upload') {
    const local = localWallpaper.get();
    el.style.backgroundColor = '#0b0f17';
    el.style.backgroundImage = local ? `url("${safeCssUrl(local)}")` : 'none';
    return;
  }
  const url = type === 'url' ? value : bingWallpaperUrl;
  el.style.backgroundColor = '#0b0f17';
  el.style.backgroundImage = url ? `url("${safeCssUrl(url)}")` : 'linear-gradient(160deg,#16233c,#0b0f17 70%)';
};

const applySettings = () => {
  const s = state.data?.settings;
  if (!s) return;
  const root = document.documentElement.style;
  root.setProperty('--accent', s.accent);
  root.setProperty('--blur', `${s.blur}px`);
  root.setProperty('--icon-size', `${s.iconSize}px`);
  root.setProperty('--columns', String(s.columns));
  root.setProperty('--dim', String(s.dim));
  document.title = `${s.siteTitle} · 我的起始页`;
  $('siteTitle').textContent = s.siteTitle;
  $('veil').style.background = `rgba(4, 8, 16, ${s.dim})`;
  applyTheme();
  applyWallpaper();
  $('engineBtn').textContent = engines.find((e) => e.id === s.searchEngine)?.name || 'Bing';
};

/* ================= 图标 ================= */
const hashHue = (text) => {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
};

const letterTile = (item) => {
  const span = document.createElement('span');
  span.className = 'letter';
  span.textContent = (item.title || '?').trim().charAt(0).toUpperCase();
  const color = item.color || `hsl(${hashHue(item.title || 'x')} 62% 46%)`;
  span.style.background = color;
  return span;
};

const buildIcon = (item) => {
  const box = document.createElement('div');
  box.className = 'ico';

  const raw = (item.icon || '').trim();
  if (raw && !/^(https?:|data:image|\/)/i.test(raw)) {
    const emoji = document.createElement('span');
    emoji.className = 'emoji';
    emoji.textContent = raw.slice(0, 4);
    box.appendChild(emoji);
    return box;
  }

  let host = '';
  try {
    host = new URL(item.url).hostname;
  } catch {
    host = '';
  }

  const sources = raw
    ? [raw]
    : host
      ? [`https://favicon.im/${host}?larger=true`, `https://${host}/favicon.ico`]
      : [];

  if (!sources.length) {
    box.appendChild(letterTile(item));
    return box;
  }

  const img = document.createElement('img');
  img.alt = '';
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  let idx = 0;
  img.addEventListener('error', () => {
    idx += 1;
    if (idx < sources.length) {
      img.src = sources[idx];
    } else {
      img.remove();
      box.appendChild(letterTile(item));
    }
  });
  img.src = sources[0];
  box.appendChild(img);
  return box;
};

/* ================= 渲染 ================= */
const renderCats = () => {
  const nav = $('cats');
  nav.textContent = '';
  const cats = (state.data?.categories || []).filter((c) => !c.hidden || state.admin);
  if (!cats.some((c) => c.id === state.activeCat)) state.activeCat = cats[0]?.id || '';

  for (const cat of cats) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `cat${cat.id === state.activeCat ? ' on' : ''}`;
    if (cat.hidden) btn.style.opacity = '0.5';
    if (cat.icon) {
      const em = document.createElement('span');
      em.className = 'cat-emoji';
      em.textContent = cat.icon;
      btn.appendChild(em);
    }
    const label = document.createElement('span');
    label.textContent = cat.name;
    btn.appendChild(label);
    btn.addEventListener('click', () => {
      state.activeCat = cat.id;
      renderCats();
      renderGrid();
    });
    nav.appendChild(btn);
  }
};

const currentItems = () => (state.data?.items || []).filter((it) => it.catId === state.activeCat);

const renderGrid = () => {
  const grid = $('grid');
  grid.textContent = '';
  const items = currentItems();
  const frag = document.createDocumentFragment();

  for (const item of items) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.dataset.id = item.id;
    tile.tabIndex = 0;
    tile.setAttribute('role', 'link');
    tile.setAttribute('aria-label', item.title);
    tile.draggable = state.admin;

    const ico = buildIcon(item);
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = item.title;

    const open = () => {
      if (state.data.settings.openInNewTab) window.open(item.url, '_blank', 'noopener');
      else window.location.href = item.url;
    };
    tile.addEventListener('click', (e) => {
      if (e.target.closest('.ops')) return;
      open();
    });
    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });

    const ops = document.createElement('div');
    ops.className = 'ops';
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = '✎';
    editBtn.title = '编辑';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openItemDialog(item);
    });
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.textContent = '✕';
    delBtn.title = '删除';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm(`删除「${item.title}」？`)) return;
      state.data.items = state.data.items.filter((i) => i.id !== item.id);
      save();
      renderGrid();
      toast('已删除');
    });
    ops.append(editBtn, delBtn);

    tile.append(ico, name, ops);
    attachDrag(tile, item);
    frag.appendChild(tile);
  }

  grid.appendChild(frag);
  $('emptyTip').hidden = items.length > 0;
  $('addTile').hidden = !state.admin;
};

/* ================= 拖拽排序 ================= */
const persistOrder = (orderedCatItems) => {
  const catId = state.activeCat;
  const positions = [];
  state.data.items.forEach((it, i) => {
    if (it.catId === catId) positions.push(i);
  });
  orderedCatItems.forEach((it, i) => {
    state.data.items[positions[i]] = it;
  });
  save();
};

const attachDrag = (tile, item) => {
  if (!state.admin) return;

  tile.addEventListener('dragstart', (e) => {
    dragId = item.id;
    tile.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id);
  });

  tile.addEventListener('dragend', () => {
    tile.classList.remove('dragging');
    $$('.tile.drop-target').forEach((el) => el.classList.remove('drop-target'));
    dragId = null;
  });

  tile.addEventListener('dragover', (e) => {
    if (!dragId || dragId === item.id) return;
    e.preventDefault();
    tile.classList.add('drop-target');
  });

  tile.addEventListener('dragleave', () => tile.classList.remove('drop-target'));

  tile.addEventListener('drop', (e) => {
    e.preventDefault();
    tile.classList.remove('drop-target');
    if (!dragId || dragId === item.id) return;

    const list = currentItems();
    const from = list.findIndex((i) => i.id === dragId);
    const to = list.findIndex((i) => i.id === item.id);
    if (from < 0 || to < 0) return;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    persistOrder(list);
    renderGrid();
  });
};

/* ================= 搜索 ================= */
const isUrlLike = (text) => /^https?:\/\//i.test(text) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(text);

const doSearch = () => {
  const input = $('searchInput');
  const raw = input.value.trim();
  if (!raw) return;
  if (isUrlLike(raw)) {
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    if (state.data.settings.openInNewTab) window.open(url, '_blank', 'noopener');
    else window.location.href = url;
    return;
  }
  const engine = engines.find((e) => e.id === state.data.settings.searchEngine) || engines[0];
  const url = engine.url.replace('%s', encodeURIComponent(raw));
  window.location.href = url;
};

/* ================= 设置抽屉 ================= */
const openDrawer = () => {
  $('drawer').classList.add('open');
  $('drawer').setAttribute('aria-hidden', 'false');
  $('scrim').classList.add('show');
  fillSettings();
};

const closeDrawer = () => {
  $('drawer').classList.remove('open');
  $('drawer').setAttribute('aria-hidden', 'true');
  $('scrim').classList.remove('show');
};

const fillSettings = () => {
  const s = state.data.settings;
  $('setTheme').value = s.theme;
  $('setAccent').value = s.accent;
  $('setBlur').value = s.blur;
  $('blurVal').textContent = s.blur;
  $('setIconSize').value = s.iconSize;
  $('iconVal').textContent = s.iconSize;
  $('setColumns').value = s.columns;
  $('colVal').textContent = s.columns;
  $('setWallType').value = s.wallpaper.type;
  $('setWallValue').value = s.wallpaper.value;
  $('setDim').value = s.dim;
  $('dimVal').textContent = Number(s.dim).toFixed(2);
  $('setNewTab').checked = s.openInNewTab;
  $('setCity').value = s.weather.name;
  $('wClock').checked = s.widgets.clock;
  $('wWeather').checked = s.widgets.weather;
  $('wHot').checked = s.widgets.hot;
  $('wTodo').checked = s.widgets.todo;
  $('wCountdown').checked = s.widgets.countdown;

  const engineSelect = $('setEngine');
  engineSelect.textContent = '';
  for (const e of engines) {
    const opt = document.createElement('option');
    opt.value = e.id;
    opt.textContent = e.name;
    engineSelect.appendChild(opt);
  }
  engineSelect.value = s.searchEngine;

  $('loginBtn').hidden = state.admin;
  $('logoutBtn').hidden = !state.admin;
  $('adminHint').textContent = state.admin
    ? '已登录：可以编辑网站、分类与小组件，改动会自动同步到云端。'
    : '登录后可编辑网站、分类与小组件；未登录时为只读访客视图。';
  renderCatManager();
};

const updateSetting = (patch) => {
  Object.assign(state.data.settings, patch);
  applySettings();
  save();
};

const bindSettings = () => {
  $('setTheme').addEventListener('change', (e) => updateSetting({ theme: e.target.value }));
  $('setAccent').addEventListener('input', (e) => updateSetting({ accent: e.target.value }));
  $('setBlur').addEventListener('input', (e) => {
    $('blurVal').textContent = e.target.value;
    updateSetting({ blur: Number(e.target.value) });
  });
  $('setIconSize').addEventListener('input', (e) => {
    $('iconVal').textContent = e.target.value;
    updateSetting({ iconSize: Number(e.target.value) });
  });
  $('setColumns').addEventListener('input', (e) => {
    $('colVal').textContent = e.target.value;
    updateSetting({ columns: Number(e.target.value) });
  });
  $('setDim').addEventListener('input', (e) => {
    $('dimVal').textContent = Number(e.target.value).toFixed(2);
    updateSetting({ dim: Number(e.target.value) });
  });
  $('setWallType').addEventListener('change', (e) => {
    state.data.settings.wallpaper.type = e.target.value;
    applyWallpaper();
    save();
  });
  $('setWallValue').addEventListener('input', (e) => {
    state.data.settings.wallpaper.value = e.target.value;
    applyWallpaper();
    save();
  });
  $('setWallFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImage(file);
      localWallpaper.set(dataUrl);
      state.data.settings.wallpaper.type = 'upload';
      $('setWallType').value = 'upload';
      applyWallpaper();
      save();
      toast('壁纸已更新（仅保存在本机）');
    } catch {
      toast('图片处理失败，换一张试试');
    }
  });
  $('setNewTab').addEventListener('change', (e) => updateSetting({ openInNewTab: e.target.checked }));
  $('setEngine').addEventListener('change', (e) => updateSetting({ searchEngine: e.target.value }));

  const widgetMap = {
    wClock: 'clock', wWeather: 'weather', wHot: 'hot', wTodo: 'todo', wCountdown: 'countdown',
  };
  for (const [id, key] of Object.entries(widgetMap)) {
    $(id).addEventListener('change', (e) => {
      state.data.settings.widgets[key] = e.target.checked;
      applyWidgetVisibility();
      save();
    });
  }

  let cityTimer = 0;
  $('setCity').addEventListener('input', (e) => {
    clearTimeout(cityTimer);
    const value = e.target.value;
    cityTimer = setTimeout(() => searchCity(value), 450);
  });

  $('exportBtn').addEventListener('click', exportJson);
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', importJson);
  $('resetBtn').addEventListener('click', async () => {
    if (!state.admin) return toast('请先登录');
    if (!confirm('恢复默认配置会覆盖当前所有网站、分类与待办，确定吗？')) return;
    try {
      const res = await fetch('/api/config', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${state.token}` },
      });
      if (!res.ok) throw new Error('重置失败');
      localStorage.removeItem('startab:cache');
      location.reload();
    } catch (err) {
      toast(err.message || '重置失败');
    }
  });
};

const compressImage = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = reject;
  reader.onload = () => {
    const img = new Image();
    img.onerror = reject;
    img.onload = () => {
      const maxW = 1920;
      const scale = Math.min(1, maxW / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

/* ================= 分类管理 ================= */
const renderCatManager = () => {
  const box = $('catManager');
  if (!box) return;
  box.textContent = '';
  if (!state.admin) return;

  for (const cat of state.data.categories) {
    const row = document.createElement('div');
    row.className = 'cm-row';

    const emoji = document.createElement('span');
    emoji.textContent = cat.icon || '📁';

    const name = document.createElement('span');
    name.className = 'cm-name';
    name.textContent = cat.name;

    const count = document.createElement('span');
    count.className = 'cm-count';
    count.textContent = `${state.data.items.filter((i) => i.catId === cat.id).length} 个`;

    const hideBtn = document.createElement('button');
    hideBtn.type = 'button';
    hideBtn.textContent = cat.hidden ? '👁' : '🚫';
    hideBtn.title = cat.hidden ? '显示' : '隐藏';
    hideBtn.addEventListener('click', () => {
      cat.hidden = !cat.hidden;
      save();
      renderCatManager();
      renderCats();
      renderGrid();
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '✕';
    del.title = '删除分类';
    del.addEventListener('click', () => {
      if (!confirm(`删除分类「${cat.name}」及其下所有网站？`)) return;
      state.data.categories = state.data.categories.filter((c) => c.id !== cat.id);
      state.data.items = state.data.items.filter((i) => i.catId !== cat.id);
      if (state.activeCat === cat.id) state.activeCat = state.data.categories[0]?.id || '';
      save();
      renderCats();
      renderGrid();
      renderCatManager();
    });

    row.append(emoji, name, count, hideBtn, del);
    box.appendChild(row);
  }
};

/* ================= 弹窗 ================= */
const openItemDialog = (item = null) => {
  if (!state.admin) return toast('请先登录');
  editingItemId = item?.id || null;
  $('itemDialogTitle').textContent = item ? '编辑网站' : '添加网站';
  $('itemTitle').value = item?.title || '';
  $('itemUrl').value = item?.url || '';
  $('itemIcon').value = item?.icon || '';
  $('itemColor').value = item?.color || '#5b8cff';

  const select = $('itemCat');
  select.textContent = '';
  for (const cat of state.data.categories) {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.name;
    select.appendChild(opt);
  }
  select.value = item?.catId || state.activeCat;
  $('itemDialog').showModal();
};

const submitItem = (e) => {
  e.preventDefault();
  const title = $('itemTitle').value.trim();
  let url = $('itemUrl').value.trim();
  if (!title) return;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    new URL(url);
  } catch {
    toast('网址格式不正确');
    return;
  }

  const payload = {
    catId: $('itemCat').value,
    title: title.slice(0, 60),
    url,
    icon: $('itemIcon').value.trim().slice(0, 500),
    color: $('itemColor').value,
  };

  if (editingItemId) {
    const target = state.data.items.find((i) => i.id === editingItemId);
    if (target) Object.assign(target, payload);
  } else {
    state.data.items.push({ id: uid('i'), ...payload });
  }
  save();
  $('itemDialog').close();
  state.activeCat = payload.catId;
  renderCats();
  renderGrid();
  toast(editingItemId ? '已保存' : '已添加');
  editingItemId = null;
};

/* ================= 登录 ================= */
const refreshAdminUI = () => {
  document.body.classList.toggle('admin', state.admin);
  $('addTile').hidden = !state.admin;
  $('loginBtn').hidden = state.admin;
  $('logoutBtn').hidden = !state.admin;
  renderCats();
  renderGrid();
  applyWidgetVisibility();
  renderTodos();
  renderCountdowns();
  renderCatManager();
};

const bindAuth = () => {
  $('loginBtn').addEventListener('click', () => {
    $('loginError').textContent = '';
    $('passwordInput').value = '';
    $('loginDialog').showModal();
    setTimeout(() => $('passwordInput').focus(), 60);
  });

  $('logoutBtn').addEventListener('click', () => {
    logout();
    refreshAdminUI();
    fillSettings();
    toast('已退出登录');
  });

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('loginSubmit');
    btn.disabled = true;
    btn.textContent = '登录中…';
    try {
      await login($('passwordInput').value);
      $('loginDialog').close();
      refreshAdminUI();
      fillSettings();
      toast('登录成功');
      loadWeather(true);
    } catch (err) {
      $('loginError').textContent = err.message || '登录失败';
    } finally {
      btn.disabled = false;
      btn.textContent = '登录';
    }
  });

  document.addEventListener('startab:admin', refreshAdminUI);
};

/* ================= 导入导出 ================= */
const exportJson = () => {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `startab-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('已导出');
};

const importJson = (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!state.admin) return toast('请先登录');
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.categories) || !Array.isArray(data.items)) throw new Error('格式不正确');
      state.data = data;
      state.activeCat = data.categories[0]?.id || '';
      save(true);
      applySettings();
      renderCats();
      renderGrid();
      renderTodos();
      renderCountdowns();
      applyWidgetVisibility();
      fillSettings();
      toast('导入成功');
    } catch (err) {
      toast(`导入失败：${err.message}`);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
};

/* ================= 启动 ================= */
const bindGlobal = () => {
  $('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });
  $('searchGo').addEventListener('click', doSearch);

  $('engineBtn').addEventListener('click', () => {
    const idx = engines.findIndex((e) => e.id === state.data.settings.searchEngine);
    const next = engines[(idx + 1) % engines.length];
    state.data.settings.searchEngine = next.id;
    $('engineBtn').textContent = next.name;
    save();
    toast(`搜索引擎：${next.name}`);
  });

  $('themeBtn').addEventListener('click', () => {
    const current = resolveTheme(state.data.settings.theme);
    state.data.settings.theme = current === 'dark' ? 'light' : 'dark';
    applyTheme();
    save();
  });

  $('settingsBtn').addEventListener('click', openDrawer);
  $('drawerClose').addEventListener('click', closeDrawer);
  $('scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
    if (e.key === '/' && document.activeElement !== $('searchInput')) {
      e.preventDefault();
      $('searchInput').focus();
    }
  });

  $('addTile').addEventListener('click', () => openItemDialog());
  $('itemForm').addEventListener('submit', submitItem);

  $$('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('dialog')?.close());
  });

  $('todoForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!state.admin) return toast('请先登录');
    const input = $('todoInput');
    if (addTodo(input.value)) input.value = '';
  });

  $('countdownAdd').addEventListener('click', () => {
    if (!state.admin) return toast('请先登录');
    $('cdTitle').value = '';
    $('cdDate').value = '';
    $('countdownDialog').showModal();
  });

  $('countdownForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = $('cdTitle').value.trim();
    const date = $('cdDate').value;
    if (!title || !date) return;
    state.data.countdowns.push({ id: uid('d'), title: title.slice(0, 40), date });
    save();
    renderCountdowns();
    $('countdownDialog').close();
  });

  $('hotTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-source]');
    if (!btn) return;
    $$('#hotTabs button').forEach((b) => b.classList.toggle('on', b === btn));
    state.data.settings.hotSource = btn.dataset.source;
    save();
    renderHot(btn.dataset.source, true);
  });

  $('hotRefresh').addEventListener('click', () => renderHot(state.data.settings.hotSource, true));
  $('weatherCity').addEventListener('click', () => {
    openDrawer();
    setTimeout(() => $('setCity').focus(), 300);
  });

  $('addCatBtn').addEventListener('click', () => {
    if (!state.admin) return toast('请先登录');
    const name = prompt('新分类名称');
    if (!name?.trim()) return;
    const icon = prompt('分类图标 emoji（可留空）') || '📁';
    state.data.categories.push({ id: uid('c'), name: name.trim().slice(0, 30), icon: icon.slice(0, 4), hidden: false });
    save();
    renderCats();
    renderCatManager();
    fillSettings();
  });

  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (state.data?.settings?.theme === 'auto') applyTheme();
  });

  window.addEventListener('online', () => { state.online = true; });
};

const registerSW = () => {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  navigator.serviceWorker.register('/sw.js').catch(() => {});
};

const boot = async () => {
  bindGlobal();
  bindSettings();
  bindAuth();

  const { wallpaperUrl } = await loadData();
  bingWallpaperUrl = wallpaperUrl;

  applySettings();
  startClock();
  renderCats();
  renderGrid();
  renderTodos();
  renderCountdowns();
  applyWidgetVisibility();
  loadWeather();
  renderHot(state.data.settings.hotSource);

  const tab = $$('#hotTabs button').find((b) => b.dataset.source === state.data.settings.hotSource);
  if (tab) $$('#hotTabs button').forEach((b) => b.classList.toggle('on', b === tab));

  if (state.token) {
    await checkSession();
    refreshAdminUI();
    if (state.admin) loadWeather(true);
  }

  if (!state.online) toast('当前为离线模式，显示的是本地缓存', 3000);
  registerSW();
};

boot();
