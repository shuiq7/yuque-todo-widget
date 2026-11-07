'use strict';

const WEEKDAY = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

const ICON = {
  refresh:
    '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a5 5 0 1 1 1.6 3.7"/><path d="M3 4.2V8h3.8"/></svg>',
  pin: (active) =>
    active
      ? '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.2 2h3.6l-.5 3.1 2.1 2.1v1.3H4.6V7.2l2.1-2.1z"/><path d="M8 8.5V14" fill="none"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6.2 2h3.6l-.5 3.1 2.1 2.1v1.3H4.6V7.2l2.1-2.1z"/><path d="M8 8.5V14"/></svg>',
  minimize:
    '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 8h8"/></svg>',
  moon:
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8z"/></svg>',
  sun:
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="3.1"/><path d="M8 1.4v1.6M8 13v1.6M1.4 8h1.6M13 8h1.6M3.3 3.3l1.1 1.1M11.6 11.6l1.1 1.1M12.7 3.3l-1.1 1.1M4.4 11.6l-1.1 1.1"/></svg>',
  settings:
    '<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" fill-rule="evenodd"><path d="M6.74 1.52L9.26 1.52L9.84 3.46L11.02 4.14L12.98 3.67L12.98 3.67L14.24 5.85L12.85 7.32L12.85 8.68L14.24 10.15L14.24 10.15L12.98 12.33L11.02 11.86L9.84 12.54L9.26 14.48L9.26 14.48L6.74 14.48L6.16 12.54L4.98 11.86L3.02 12.33L3.02 12.33L1.76 10.15L3.15 8.68L3.15 7.32L1.76 5.85L1.76 5.85L3.02 3.67L4.98 4.14L6.16 3.46L6.74 1.52Z M10.05 8A2.05 2.05 0 1 1 5.95 8A2.05 2.05 0 1 1 10.05 8Z"/></svg>',
  close:
    '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>',
  arrow:
    '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h7v7"/><path d="M13 3L4 12"/></svg>',
};

const panel = document.getElementById('panel');
const head = document.getElementById('head');
const headtext = document.getElementById('headtext');
const dot = document.getElementById('dot');
const count = document.getElementById('count');
const dateMain = document.getElementById('date-main');
const dateWeek = document.getElementById('date-week');
const list = document.getElementById('list');
const foot = document.getElementById('foot');
const docEl = document.getElementById('doc');
const stampEl = document.getElementById('stamp');
const refreshBtn = document.getElementById('refresh');
const themeBtn = document.getElementById('theme');
const pinBtn = document.getElementById('pin');
const minimizeBtn = document.getElementById('minimize');
const settingsBtn = document.getElementById('settings');
const settingsPanel = document.getElementById('settings-panel');
const docInput = document.getElementById('doc-url');
const settingsHint = document.getElementById('settings-hint');
const settingsSave = document.getElementById('settings-save');
const settingsCancel = document.getElementById('settings-cancel');

let lastPayload = null;
// 收起状态不跨启动保留：每次打开都先完整显示，避免用户看到只剩一条时以为出错了。
let collapsed = false;
let pinned = false;
let settingsOpen = false;
const DEFAULT_HINT =
  '文档里的一级标题（或 1 / 2 / 3 这种序号）用来分隔事项，事项下面附的链接会变成卡片。';
let dragState = null;
let spinning = false;
let resizeQueued = false;

function pad(value) {
  return String(value).padStart(2, '0');
}

function renderDate() {
  const now = new Date();
  dateMain.textContent = `${now.getMonth() + 1}月${now.getDate()}日`;
  dateWeek.textContent = WEEKDAY[now.getDay()];
}

function clockLabel(iso) {
  if (!iso) return '';
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  return `${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

function glyphFor(card) {
  const source = String(card.site || card.label || '?').trim();
  return source ? source.slice(0, 1) : '·';
}

function subFor(card) {
  if (card.note) return card.note;
  if (card.site) return card.site;
  try {
    return new URL(card.url).hostname.replace(/^www\./, '');
  } catch (error) {
    return card.url || '';
  }
}

function buildCard(card) {
  const link = document.createElement('a');
  link.className = 'card';
  link.href = card.url;
  link.target = '_blank';
  link.rel = 'noreferrer noopener';
  link.title = card.url;

  const glyph = document.createElement('span');
  glyph.className = 'card-glyph';
  glyph.textContent = glyphFor(card);

  const text = document.createElement('span');
  text.className = 'card-text';

  const label = document.createElement('span');
  label.className = 'card-label';
  label.textContent = card.label || card.url;

  const sub = document.createElement('span');
  sub.className = 'card-sub';
  sub.textContent = subFor(card);

  text.append(label, sub);

  const arrow = document.createElement('span');
  arrow.className = 'card-arrow';
  arrow.innerHTML = ICON.arrow;

  link.append(glyph, text, arrow);
  return link;
}

function buildItem(item) {
  const wrap = document.createElement('div');
  wrap.className = 'item';
  wrap.setAttribute('role', 'listitem');

  const head = document.createElement('div');
  head.className = 'item-head';

  const bullet = document.createElement('span');
  bullet.className = 'item-dot';

  const title = document.createElement('span');
  title.className = 'item-title';
  title.textContent = item.title || '';
  title.title = item.title || '';

  head.append(bullet, title);
  wrap.append(head);

  const cards = Array.isArray(item.cards) ? item.cards.filter((card) => card && card.url) : [];
  if (cards.length) {
    const stack = document.createElement('div');
    stack.className = 'cards';
    cards.forEach((card) => stack.append(buildCard(card)));
    wrap.append(stack);
  }

  return wrap;
}

function render(payload) {
  lastPayload = payload || null;
  const items = payload && Array.isArray(payload.items) ? payload.items : [];
  const status = (payload && payload.status) || 'loading';

  if (payload && typeof payload.pinned === 'boolean' && payload.pinned !== pinned) {
    pinned = payload.pinned;
    applyPinned();
  }

  dot.dataset.state = status;
  count.textContent = items.length ? `· ${items.length} 项` : '';

  list.replaceChildren();
  if (!items.length) {
    const hint = document.createElement('div');
    if (status === 'unconfigured') {
      hint.className = 'chip';
      hint.textContent = '还没设置语雀文档，点右上角齿轮填链接';
      hint.dataset.action = 'settings';
      hint.addEventListener('click', () => openSettings());
    } else {
      hint.className = 'chip';
      hint.textContent = status === 'loading' ? '正在同步语雀…' : '今天没有待办';
    }
    list.append(hint);
  } else {
    items.forEach((item) => list.append(buildItem(item)));
    if (payload && payload.error) {
      const notice = document.createElement('div');
      notice.className = 'notice';
      notice.textContent = '同步失败：' + payload.error;
      list.append(notice);
    }
  }

  const docTitle = payload && payload.doc && payload.doc.title ? payload.doc.title : '';
  docEl.textContent = docTitle ? `语雀 · ${docTitle}` : '语雀 · 未设置文档';
  stampEl.textContent = payload && payload.fetchedAt ? `更新于 ${clockLabel(payload.fetchedAt)}` : '';

  if (spinning) {
    spinning = false;
    refreshBtn.dataset.spin = 'false';
  }

  queueResize();
}

function queueResize() {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    if (!window.widget) return;
    const measured = Math.ceil(document.body.getBoundingClientRect().height);
    window.widget.resize(measured);
  });
}

function applyCollapsed() {
  panel.dataset.collapsed = collapsed ? 'true' : 'false';
  headtext.title = collapsed ? '展开' : '收起';
  headtext.setAttribute('aria-label', headtext.title);
  queueResize();
}

function applyPinned() {
  pinBtn.dataset.active = pinned ? 'true' : 'false';
  pinBtn.innerHTML = ICON.pin(pinned);
  pinBtn.title = pinned ? '取消置顶' : '置顶（总在最前）';
  pinBtn.setAttribute('aria-label', pinBtn.title);
  pinBtn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
}

function toggleCollapsed() {
  collapsed = !collapsed;
  applyCollapsed();
}

refreshBtn.innerHTML = ICON.refresh;
minimizeBtn.innerHTML = ICON.minimize;
settingsBtn.innerHTML = ICON.settings;
applyPinned();
applyCollapsed();
renderDate();

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function applyThemeIcon() {
  const isDark = darkQuery.matches;
  themeBtn.innerHTML = isDark ? ICON.sun : ICON.moon;
  const label = isDark ? '切换到浅色模式' : '切换到深色模式';
  themeBtn.title = label;
  themeBtn.setAttribute('aria-label', label);
}

applyThemeIcon();
if (typeof darkQuery.addEventListener === 'function') {
  darkQuery.addEventListener('change', applyThemeIcon);
} else if (typeof darkQuery.addListener === 'function') {
  darkQuery.addListener(applyThemeIcon);
}

themeBtn.addEventListener('click', () => {
  if (window.widget) window.widget.setTheme(darkQuery.matches ? 'light' : 'dark');
});

refreshBtn.addEventListener('click', () => {
  spinning = true;
  refreshBtn.dataset.spin = 'true';
  if (window.widget) window.widget.refresh();
});

pinBtn.addEventListener('click', () => {
  pinned = !pinned;
  applyPinned();
  if (window.widget) window.widget.pin(pinned);
});

function openSettings() {
  settingsOpen = true;
  docInput.value = (lastPayload && lastPayload.docUrl) || '';
  settingsHint.textContent = DEFAULT_HINT;
  settingsHint.dataset.state = 'idle';
  settingsPanel.hidden = false;
  panel.dataset.settings = 'true';
  settingsBtn.dataset.active = 'true';
  queueResize();
  setTimeout(() => {
    docInput.focus();
    docInput.select();
  }, 30);
}

function closeSettings() {
  settingsOpen = false;
  settingsPanel.hidden = true;
  panel.dataset.settings = 'false';
  settingsBtn.dataset.active = 'false';
  queueResize();
}

function saveSettings() {
  const url = docInput.value.trim();
  if (!/^https?:\/\/\S+$/i.test(url)) {
    settingsHint.textContent = '链接要以 http:// 或 https:// 开头';
    settingsHint.dataset.state = 'error';
    docInput.focus();
    return;
  }
  if (window.widget) window.widget.saveDocUrl(url);
  closeSettings();
  spinning = true;
  refreshBtn.dataset.spin = 'true';
}

settingsBtn.addEventListener('click', () => {
  if (settingsOpen) closeSettings();
  else openSettings();
});

settingsSave.addEventListener('click', saveSettings);

settingsCancel.addEventListener('click', closeSettings);

docInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    saveSettings();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeSettings();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && settingsOpen) {
    event.preventDefault();
    closeSettings();
  }
});

minimizeBtn.addEventListener('click', () => {
  if (window.widget) window.widget.minimize();
});

headtext.addEventListener('click', (event) => {
  if (event.detail === 0) toggleCollapsed();
});

headtext.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    toggleCollapsed();
  }
});

head.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  if (event.target.closest('.actions')) return;
  dragState = { x: event.screenX, y: event.screenY, moved: false };
  if (window.widget) window.widget.dragStart(event.screenX, event.screenY);
});

window.addEventListener('mousemove', (event) => {
  if (!dragState) return;
  if (!dragState.moved) {
    const dx = event.screenX - dragState.x;
    const dy = event.screenY - dragState.y;
    if (Math.hypot(dx, dy) < 3) return;
    dragState.moved = true;
    document.body.dataset.dragging = 'true';
  }
  if (window.widget) window.widget.dragMove(event.screenX, event.screenY);
});

window.addEventListener('mouseup', () => {
  if (!dragState) return;
  const moved = dragState.moved;
  dragState = null;
  delete document.body.dataset.dragging;
  if (window.widget) window.widget.dragEnd();
  if (!moved) toggleCollapsed();
});

document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  if (window.widget) window.widget.menu();
});

list.addEventListener('scroll', () => {
  if (foot) foot.dataset.scrolled = 'true';
});

if (window.widget) {
  window.widget.onData(render);
  if (window.widget.onPinned) {
    window.widget.onPinned((value) => {
      pinned = value;
      applyPinned();
    });
  }
  if (window.widget.onForceCollapse) {
    // 没有托盘图标时主进程不会把窗口藏起来，退化成收起成一条。
    window.widget.onForceCollapse(() => {
      collapsed = true;
      applyCollapsed();
      queueResize();
    });
  }
  window.widget.ready();
}

setInterval(renderDate, 60 * 1000);
window.addEventListener('resize', queueResize);
