'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, WebContentsView, clipboard, ipcMain, net, session } = require('electron');
const { APP_NAME, FALLBACK_SERVER_URL, NAMU_ORIGIN } = require('./config-online.cjs');

let mainWindow = null;
let wikiView = null;
let wikiVisible = false;
let activeWikiTitle = '';
let requestedWikiBounds = { x: 16, y: 96, width: 900, height: 700 };

function normalizeTitle(value) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, '').replaceAll('_', ' ').trim().slice(0, 200)
    : '';
}

function wikiUrl(title) {
  const clean = normalizeTitle(title);
  return clean ? `${NAMU_ORIGIN}/w/${encodeURIComponent(clean)}` : null;
}

function titleFromWikiUrl(input) {
  try {
    const url = new URL(input);
    if (url.origin !== NAMU_ORIGIN || !url.pathname.startsWith('/w/')) return null;
    return normalizeTitle(decodeURIComponent(url.pathname.slice(3)));
  } catch {
    return null;
  }
}

function isWikiSearchUrl(input) {
  try {
    const url = new URL(input, NAMU_ORIGIN);
    if (url.origin !== NAMU_ORIGIN) return false;
    const pathname = url.pathname.toLowerCase();
    return pathname === '/search' || pathname.startsWith('/search/');
  } catch {
    return false;
  }
}

function normalizeServerUrl(value) {
  const url = new URL(String(value || ''));
  const localhost = ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localhost)) {
    throw new Error('온라인 서버는 HTTPS 주소여야 해요.');
  }
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.origin;
}

function configuredServerUrl() {
  const candidates = [
    process.env.NAMU_RACE_SERVER_URL,
    path.join(app.getAppPath(), 'server-url.txt'),
    path.join(path.dirname(process.execPath), 'server-url.txt'),
  ];
  for (const candidate of candidates) {
    try {
      const value = candidate && fs.existsSync(candidate) ? fs.readFileSync(candidate, 'utf8').trim() : candidate;
      if (value) return normalizeServerUrl(value);
    } catch {
      // Try the next configuration source.
    }
  }
  return FALLBACK_SERVER_URL;
}

function isHudSender(event) {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents);
}

function sendToHud(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function clampBounds(raw) {
  const content = mainWindow.getContentBounds();
  const x = Math.max(0, Math.min(content.width, Math.floor(Number(raw?.x) || 0)));
  const y = Math.max(0, Math.min(content.height, Math.floor(Number(raw?.y) || 0)));
  return {
    x,
    y,
    width: Math.max(0, Math.min(content.width - x, Math.floor(Number(raw?.width) || 0))),
    height: Math.max(0, Math.min(content.height - y, Math.floor(Number(raw?.height) || 0))),
  };
}

function applyWikiBounds() {
  if (!mainWindow || !wikiView || !wikiVisible) return;
  const bounds = clampBounds(requestedWikiBounds);
  if (bounds.width > 0 && bounds.height > 0) wikiView.setBounds(bounds);
}

function setWikiVisible(visible) {
  wikiVisible = Boolean(visible);
  if (!wikiView) return;
  wikiView.setVisible(wikiVisible);
  if (wikiVisible) applyWikiBounds();
}

function sendWikiCandidate(href) {
  if (isWikiSearchUrl(href)) {
    sendToHud('wiki-navigation-blocked', { message: '레이스 중에는 검색을 사용할 수 없어요.' });
    return;
  }
  const title = titleFromWikiUrl(href);
  if (!title) {
    sendToHud('wiki-navigation-blocked', { message: '나무위키 문서 링크만 이동할 수 있어요.' });
    return;
  }
  if (title !== activeWikiTitle) sendToHud('wiki-link-clicked', { title });
}

function createWikiView() {
  const partition = 'persist:namu-race-online-wiki';
  wikiView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition,
      preload: path.join(__dirname, 'wiki-preload.cjs'),
    },
  });
  mainWindow.contentView.addChildView(wikiView);
  wikiView.setBackgroundColor('#ffffff');
  wikiView.setVisible(false);

  const wikiSession = session.fromPartition(partition);
  wikiSession.setPermissionCheckHandler(() => false);
  wikiSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  wikiSession.on('will-download', (event) => event.preventDefault());

  wikiView.webContents.setWindowOpenHandler(({ url }) => {
    sendWikiCandidate(url);
    return { action: 'deny' };
  });
  wikiView.webContents.on('will-navigate', (event, url) => {
    if (titleFromWikiUrl(url) === activeWikiTitle) return;
    event.preventDefault();
    sendWikiCandidate(url);
  });
  wikiView.webContents.on('did-start-loading', () => sendToHud('wiki-load-state', { loading: true }));
  wikiView.webContents.on('did-stop-loading', () => sendToHud('wiki-load-state', { loading: false }));
  wikiView.webContents.on('did-navigate', (_event, url) => {
    const title = titleFromWikiUrl(url);
    if (!activeWikiTitle || !title || title === activeWikiTitle) return;
    const activeUrl = wikiUrl(activeWikiTitle);
    if (activeUrl) wikiView.webContents.loadURL(activeUrl).catch(() => undefined);
  });
  wikiView.webContents.on('did-fail-load', (_event, code, description, url, mainFrame) => {
    if (!mainFrame || code === -3) return;
    sendToHud('wiki-load-state', { loading: false, error: `나무위키를 열지 못했어요. (${description})`, url });
  });
  wikiView.webContents.on('before-input-event', (event, input) => {
    const key = String(input.key || '').toLowerCase();
    const findShortcut = (input.control || input.meta) && key === 'f';
    if (key === 'f12' || ((input.control || input.meta) && ['l', 'r', 'u', 'f', '[', ']'].includes(key)) || (input.alt && ['left', 'right'].includes(key)) || ['browserback', 'browserforward'].includes(key)) {
      event.preventDefault();
      if (findShortcut) sendToHud('wiki-navigation-blocked', { message: '레이스 중에는 검색을 사용할 수 없어요.' });
    }
  });
  wikiView.webContents.on('app-command', (event, command) => {
    if (command === 'browser-backward' || command === 'browser-forward') event.preventDefault();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#07110b',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'hud-preload-online.cjs'),
    },
  });
  createWikiView();
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.on('resize', applyWikiBounds);
  mainWindow.on('closed', () => {
    wikiView = null;
    mainWindow = null;
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.loadFile(path.join(__dirname, 'index-online.html'));
}

ipcMain.handle('get-default-server-url', (event) => isHudSender(event) ? configuredServerUrl() : '');
ipcMain.handle('online-request', async (event, request) => {
  if (!isHudSender(event)) return { ok: false, status: 403, data: { error: '허용되지 않은 요청입니다.' } };
  try {
    const origin = normalizeServerUrl(request?.serverUrl);
    const route = String(request?.path || '/');
    if (!route.startsWith('/') || route.includes('\\')) throw new Error('서버 요청 경로가 잘못되었어요.');
    const url = new URL(route, origin);
    const method = request?.method === 'POST' ? 'POST' : 'GET';
    const init = { method, headers: { Accept: 'application/json' } };
    if (method === 'POST') {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(request?.body || {});
    }
    const response = await net.fetch(url.toString(), init);
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: '온라인 서버가 올바른 응답을 보내지 않았어요.' };
    }
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    return { ok: false, status: 0, data: { error: error instanceof Error ? error.message : '온라인 서버에 연결하지 못했어요.' } };
  }
});
ipcMain.handle('copy-text', (event, text) => {
  if (!isHudSender(event)) return false;
  clipboard.writeText(String(text || '').slice(0, 500));
  return true;
});
ipcMain.on('set-wiki-bounds', (event, bounds) => {
  if (!isHudSender(event)) return;
  requestedWikiBounds = bounds;
  applyWikiBounds();
});
ipcMain.on('show-wiki', (event, title) => {
  if (!isHudSender(event) || !wikiView) return;
  const url = wikiUrl(title);
  if (!url) return;
  setWikiVisible(true);
  if (activeWikiTitle === title && wikiView.webContents.getURL()) return;
  activeWikiTitle = title;
  wikiView.webContents.loadURL(url, {
    userAgent: app.userAgentFallback.replace(/\sElectron\/\S+/, ''),
    httpReferrer: NAMU_ORIGIN,
  }).catch(() => undefined);
});
ipcMain.on('hide-wiki', (event) => {
  if (isHudSender(event)) setWikiVisible(false);
});
ipcMain.on('wiki-link-clicked-from-page', (event, href) => {
  if (wikiView && event.sender === wikiView.webContents) sendWikiCandidate(href);
});
ipcMain.on('wiki-search-blocked-from-page', (event) => {
  if (wikiView && event.sender === wikiView.webContents) {
    sendToHud('wiki-navigation-blocked', { message: '레이스 중에는 검색을 사용할 수 없어요.' });
  }
});

app.setName(APP_NAME);
app.whenReady().then(createWindow);
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
