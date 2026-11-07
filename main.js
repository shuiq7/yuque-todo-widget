'use strict';

const { app, BrowserWindow, ipcMain, shell, Menu, Tray, screen, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const WIDTH = 348;
const MIN_HEIGHT = 64;
const MAX_HEIGHT = 920;
const REFRESH_MS = 5 * 60 * 1000;
const SCRAPER = path.join(__dirname, 'scraper.mjs');
const DEFAULT_DOC_URL = 'https://pkuschool.yuque.com/ggicnw/hxnoxy/hdocbvbfqcppgrif';

let win = null;
let tray = null;
let timer = null;
let pinned = false;
let dragState = null;
let snapshot = { status: 'loading', doc: null, items: [], fetchedAt: null, error: null };
let startedAt = 0;

app.setAppUserModelId('local.desktop-todo-widget');

function resolveDataDir() {
  const fallback = path.join(path.dirname(process.execPath), 'data');
  let appData = '';
  try {
    appData = app.getPath('appData');
  } catch (error) {
    appData = '';
  }
  if (appData && fs.existsSync(path.dirname(appData))) {
    const preferred = path.join(appData, 'DesktopTodoWidget');
    try {
      fs.mkdirSync(preferred, { recursive: true });
      fs.accessSync(preferred, fs.constants.W_OK);
      return preferred;
    } catch (error) {
      /* fall through to a folder next to the executable */
    }
  }
  try {
    fs.mkdirSync(fallback, { recursive: true });
  } catch (error) {
    /* last resort: default userData path */
  }
  return fallback;
}

if (process.platform === 'win32') app.setPath('userData', resolveDataDir());

function configFile() {
  return path.join(app.getPath('userData'), 'window.json');
}

function readConfig() {
  try {
    // 有些编辑器（以及 PowerShell 的 Set-Content）会写 UTF-8 BOM，JSON.parse 认不出来。
    const raw = fs.readFileSync(configFile(), 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  try {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify(next, null, 2), 'utf8');
  } catch (error) {
    /* persistence is best effort */
  }
  return next;
}

function clampToScreen(bounds) {
  const area = screen.getDisplayMatching(bounds).workArea;
  const width = Math.min(bounds.width || WIDTH, area.width);
  const height = Math.min(Math.max(bounds.height || 320, MIN_HEIGHT), area.height);
  const x = Math.min(Math.max(bounds.x, area.x + 8), area.x + area.width - width - 8);
  const y = Math.min(Math.max(bounds.y, area.y + 8), area.y + area.height - height - 8);
  return { x, y, width, height };
}

function defaultBounds() {
  const area = screen.getPrimaryDisplay().workArea;
  return clampToScreen({
    width: WIDTH,
    height: 360,
    x: area.x + area.width - WIDTH - 24,
    y: area.y + 72,
  });
}

function loadBounds() {
  const config = readConfig();
  if (typeof config.x === 'number' && typeof config.y === 'number') {
    return clampToScreen({ x: config.x, y: config.y, width: WIDTH, height: config.height || 360 });
  }
  return defaultBounds();
}

function effectiveDocUrl() {
  const configured = readConfig().docUrl;
  const value = typeof configured === 'string' ? configured.trim() : '';
  return /^https?:\/\//i.test(value) ? value : DEFAULT_DOC_URL;
}

function currentPayload() {
  return { ...snapshot, startedAt, pinned, docUrl: effectiveDocUrl() };
}

function broadcast() {
  if (win && !win.isDestroyed()) win.webContents.send('todo:data', currentPayload());
  sendBubbleCount();
}

async function refresh(reason) {
  try {
    const module = await import(pathToFileURL(SCRAPER).href + '?mtime=' + Date.now());
    const result = await module.scrapeTodos(effectiveDocUrl());
    snapshot = {
      status: 'ready',
      doc: result.doc || null,
      items: Array.isArray(result.items) ? result.items : [],
      fetchedAt: result.fetchedAt || new Date().toISOString(),
      error: null,
    };
  } catch (error) {
    const message = String((error && error.message) || error);
    snapshot = {
      ...snapshot,
      status: snapshot.items && snapshot.items.length ? 'ready' : 'error',
      error: message,
    };
    console.error('[desktop-widget] scrape failed (' + (reason || 'auto') + '):', message);
  }
  broadcast();
}

function scheduleRefresh() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => refresh('timer'), REFRESH_MS);
  if (timer.unref) timer.unref();
}

function resetPosition() {
  if (!win || win.isDestroyed()) return;
  const bounds = defaultBounds();
  win.setBounds(bounds);
  writeConfig({ x: bounds.x, y: bounds.y, height: bounds.height });
}

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: '立即刷新', click: () => refresh('manual') },
    {
      label: '置顶显示',
      type: 'checkbox',
      checked: pinned,
      click: (item) => setPinned(item.checked),
    },
    { label: '回到右上角', click: () => resetPosition() },
    {
      label: '最小化到托盘',
      click: () => hideWidget(),
    },
    { type: 'separator' },
    { label: '退出挂件', click: () => app.quit() },
  ]);
}

function setPinned(value) {
  pinned = Boolean(value);
  if (win && !win.isDestroyed()) {
    win.setAlwaysOnTop(pinned, 'floating');
    win.webContents.send('widget:pinned', pinned);
  }
  writeConfig({ pinned });
}

function createWindow() {
  const config = readConfig();
  pinned = config.pinned === true;
  const bounds = loadBounds();
  win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: WIDTH,
    maxWidth: WIDTH,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: pinned,
    show: false,
    title: '待办',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(pinned, 'floating');
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'index.html'));

  win.once('ready-to-show', () => {
    win.showInactive();
  });

  let moveTimer = null;
  win.on('moved', () => {
    if (moveTimer) clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      const [x, y] = win.getPosition();
      const [, height] = win.getSize();
      writeConfig({ x, y, height });
    }, 350);
  });

  win.on('closed', () => {
    win = null;
    closeBubble();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (/^https?:\/\//i.test(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  win.webContents.on('context-menu', () => {
    buildMenu().popup({ window: win });
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[desktop-widget] renderer gone:', details && details.reason);
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'icon.png');
  if (!fs.existsSync(iconPath)) return;
  try {
    const base = nativeImage.createFromPath(iconPath);
    const small = base.isEmpty() ? base : base.resize({ width: 16, height: 16, quality: 'best' });
    tray = new Tray(small);
    tray.setToolTip('桌面待办挂件（点击显示 / 隐藏）');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示挂件', click: () => showWidget() },
        { label: '隐藏挂件', click: () => hideWidget() },
        { label: '立即刷新', click: () => refresh('tray') },
        { type: 'separator' },
        { label: '退出挂件', click: () => app.quit() },
      ]),
    );
    tray.on('click', () => {
      if (win && win.isVisible()) hideWidget();
      else showWidget();
    });
    tray.on('double-click', () => showWidget());
  } catch (error) {
    tray = null;
    console.warn('[desktop-widget] 托盘不可用，改用折叠方式收起:', (error && error.message) || error);
  }
}

function showWidget() {
  if (!win || win.isDestroyed()) return;
  closeBubble();
  win.showInactive();
  win.setSkipTaskbar(true);
  // 从托盘叫回来的时候给个焦点，否则用户点了没反应感
  win.focus();
}

function hideWidget() {
  if (!win || win.isDestroyed()) return;
  if (!tray) {
    // 没有托盘图标就别把窗口藏起来，否则用户找不回来：改成收起成一条。
    win.webContents.send('widget:force-collapse');
    return;
  }
  win.hide();
  createBubble();
  const config = readConfig();
  if (!config.trayHintShown) {
    writeConfig({ trayHintShown: true });
    try {
      tray.displayBalloon({
        title: '待办挂件已收进托盘',
        content: '点击任务栏右下角的托盘图标（可能在 ^ 展开里）就能叫回来。',
        icon: nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 32, height: 32 }),
        noSound: true,
        respectQuietTime: true,
      });
    } catch (error) {
      /* 托盘气泡不是关键路径 */
    }
  }
}

const BUBBLE_SIZE = 68;
let bubble = null;
let bubbleDrag = null;

function sendBubbleCount() {
  if (!bubble || bubble.isDestroyed()) return;
  const count = snapshot && Array.isArray(snapshot.items) ? snapshot.items.length : 0;
  bubble.webContents.send('widget:bubble-count', count);
}

function closeBubble() {
  if (bubble && !bubble.isDestroyed()) bubble.destroy();
  bubble = null;
}

// 收进托盘后留一个屏幕边上的小圆点：这台机器的 Windows 会把新托盘图标塞进 ^ 里，
// 光靠托盘图标用户根本找不回来，所以给一个看得见的把手。
function createBubble() {
  if (bubble && !bubble.isDestroyed()) {
    bubble.showInactive();
    sendBubbleCount();
    return bubble;
  }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  const stored = readConfig();
  const fallback = win && !win.isDestroyed() ? win.getPosition() : [area.x + area.width - 380, area.y + 80];
  const wanted = [
    Number.isFinite(stored.bubbleX) ? stored.bubbleX : fallback[0],
    Number.isFinite(stored.bubbleY) ? stored.bubbleY : fallback[1],
  ];
  const x = Math.min(Math.max(wanted[0], area.x + 8), area.x + area.width - BUBBLE_SIZE - 8);
  const y = Math.min(Math.max(wanted[1], area.y + 8), area.y + area.height - BUBBLE_SIZE - 8);
  bubble = new BrowserWindow({
    x,
    y,
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    title: '待办',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'bubble-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  bubble.setAlwaysOnTop(true, 'floating');
  bubble.loadFile(path.join(__dirname, 'bubble.html'));
  bubble.once('ready-to-show', () => {
    if (!bubble || bubble.isDestroyed()) return;
    bubble.showInactive();
    sendBubbleCount();
  });
  bubble.on('closed', () => {
    bubble = null;
  });
  return bubble;
}

ipcMain.on('widget:ready', (event) => {
  if (!win || event.sender !== win.webContents) return;
  event.sender.send('todo:data', currentPayload());
  refresh('startup');
});

ipcMain.on('widget:height', (event, height) => {
  if (!win || event.sender !== win.webContents) return;
  const next = Math.round(Number(height) || 0);
  if (!next) return;
  const clamped = Math.min(Math.max(next, MIN_HEIGHT), MAX_HEIGHT);
  const [width, current] = win.getContentSize();
  if (Math.abs(current - clamped) < 1) return;
  win.setContentSize(width, clamped);
  const [, size] = win.getSize();
  writeConfig({ height: size });
});

ipcMain.on('widget:refresh', (event) => {
  if (!win || event.sender !== win.webContents) return;
  refresh('manual');
});

ipcMain.on('widget:pin', (event, value) => {
  if (!win || event.sender !== win.webContents) return;
  setPinned(value);
});

ipcMain.on('widget:minimize', (event) => {
  if (!win || event.sender !== win.webContents) return;
  hideWidget();
});

ipcMain.on('widget:doc-url', (event, value) => {
  if (!win || event.sender !== win.webContents) return;
  const url = typeof value === 'string' ? value.trim() : '';
  if (!/^https?:\/\/\S+$/i.test(url)) return;
  writeConfig({ docUrl: url });
  snapshot = { ...snapshot, status: 'loading', error: null };
  broadcast();
  refresh('settings');
});

ipcMain.on('widget:bubble-open', () => {
  showWidget();
});

ipcMain.on('widget:bubble-drag-start', (event, screenX, screenY) => {
  if (!bubble || bubble.isDestroyed() || event.sender !== bubble.webContents) return;
  const [x, y] = bubble.getPosition();
  bubbleDrag = {
    winX: x,
    winY: y,
    screenX: Number(screenX) || 0,
    screenY: Number(screenY) || 0,
  };
});

ipcMain.on('widget:bubble-drag-move', (event, screenX, screenY) => {
  if (!bubble || bubble.isDestroyed() || event.sender !== bubble.webContents || !bubbleDrag) return;
  const nextX = bubbleDrag.winX + (Number(screenX) || 0) - bubbleDrag.screenX;
  const nextY = bubbleDrag.winY + (Number(screenY) || 0) - bubbleDrag.screenY;
  bubble.setPosition(Math.round(nextX), Math.round(nextY));
});

ipcMain.on('widget:bubble-drag-end', (event) => {
  if (!bubble || bubble.isDestroyed() || event.sender !== bubble.webContents) return;
  bubbleDrag = null;
  const [x, y] = bubble.getPosition();
  writeConfig({ bubbleX: x, bubbleY: y });
});

ipcMain.on('widget:drag-start', (event, screenX, screenY) => {
  if (!win || event.sender !== win.webContents) return;
  const [x, y] = win.getPosition();
  dragState = {
    winX: x,
    winY: y,
    screenX: Number(screenX) || 0,
    screenY: Number(screenY) || 0,
  };
});

ipcMain.on('widget:drag-move', (event, screenX, screenY) => {
  if (!win || event.sender !== win.webContents || !dragState) return;
  const nextX = dragState.winX + (Number(screenX) || 0) - dragState.screenX;
  const nextY = dragState.winY + (Number(screenY) || 0) - dragState.screenY;
  win.setPosition(Math.round(nextX), Math.round(nextY));
});

ipcMain.on('widget:drag-end', (event) => {
  if (!win || event.sender !== win.webContents) return;
  dragState = null;
  const [x, y] = win.getPosition();
  const [, height] = win.getSize();
  writeConfig({ x, y, height });
});

ipcMain.on('widget:menu', (event) => {
  if (!win || event.sender !== win.webContents) return;
  buildMenu().popup({ window: win });
});

ipcMain.on('widget:quit', () => app.quit());

const PID_FILE = path.join(app.getPath('userData'), 'instance.pid');

function livingInstancePid() {
  try {
    const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
    if (!pid || pid === process.pid) return 0;
    process.kill(pid, 0);
    return pid;
  } catch (error) {
    return 0;
  }
}

let hasLock = false;
try {
  hasLock = app.requestSingleInstanceLock();
} catch (error) {
  hasLock = false;
  console.warn('[todo] single instance lock unavailable:', (error && error.message) || error);
}

// 第二个实例只负责把已经在跑的那个叫回前台，然后自己退出；
// 如果拿不到锁但其实没有别的实例（用户数据目录异常等），照常启动，绝不能让挂件悄悄死掉。
const secondary = !hasLock && livingInstancePid() > 0;

if (secondary) {
  console.warn('[todo] another instance is running, handing over.');
  app.quit();
} else {
  try {
    fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
  } catch (error) {
    /* best effort */
  }

  // 已经有一个挂件在跑（比如缩到托盘里）时，再双击一次快捷方式就把它叫回前台。
  app.on('second-instance', () => {
    showWidget();
  });

  app.whenReady().then(() => {
    startedAt = Date.now();
    createWindow();
    createTray();
    scheduleRefresh();
    refresh('boot');
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    if (timer) clearInterval(timer);
    try {
      fs.unlinkSync(PID_FILE);
    } catch (error) {
      /* best effort */
    }
  });
}

