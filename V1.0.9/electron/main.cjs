const { app, BrowserWindow, ipcMain, safeStorage, protocol, net, Tray, Menu, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { pathToFileURL } = require('node:url');

const API_BASE = 'https://api.chksz.com';
const ACCOUNT_URL = `${API_BASE}/login.html`;
const LEGACY_USER_DATA = path.join(app.getPath('appData'), 'Aurora Music');
const DEV_INSTANCE = process.env.RAIN_DEV_INSTANCE === '1';
app.setPath('userData', DEV_INSTANCE ? path.join(app.getPath('appData'), 'Rain Music Dev') : LEGACY_USER_DATA);
protocol.registerSchemesAsPrivileged([{ scheme: 'rain-cache', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const ALLOWED_PATHS = new Set([
  '/api/163_music',
  '/api/163_search',
  '/api/163_lyric',
  '/api/163_playlist',
  '/api/qq_music',
  '/api/kugou_music',
]);

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const mediaCachePath = () => path.join(app.getPath('userData'), 'rain-media-cache');
const cacheIndexPath = () => path.join(mediaCachePath(), 'index.json');
let mainWindow;
let accountWindow;
let tray;
let quotaTimer;
let startupShowTimer;
let closePromptPending = false;
let pendingSecondInstance = false;
let quitting = false;
let quotaStatus = { connected: false, state: 'checking', updatedAt: 0 };
let musicMetadataModule;

const CLOSE_ACTIONS = new Set(['ask', 'quit', 'tray']);

function readSettingsData() {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeSettingsData(settings) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  const temporary = `${settingsPath()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(settings), { mode: 0o600 });
  try {
    fs.renameSync(temporary, settingsPath());
  } catch {
    fs.copyFileSync(temporary, settingsPath());
    fs.rmSync(temporary, { force: true });
  }
}

function getCloseAction() {
  const value = readSettingsData().closeAction;
  return CLOSE_ACTIONS.has(value) ? value : 'ask';
}

function saveCloseAction(value) {
  if (!CLOSE_ACTIONS.has(value)) return false;
  writeSettingsData({ ...readSettingsData(), closeAction: value });
  return true;
}

function readCacheIndex() {
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheIndexPath(), 'utf8'));
    return { tracks: parsed.tracks || {}, searches: parsed.searches || {} };
  } catch {
    return { tracks: {}, searches: {} };
  }
}

function writeCacheIndex(index) {
  fs.mkdirSync(mediaCachePath(), { recursive: true });
  const temporary = `${cacheIndexPath()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(index));
  fs.renameSync(temporary, cacheIndexPath());
}

function cacheUrl(kind, filename) {
  return `rain-cache://${kind}/${encodeURIComponent(filename)}`;
}

function extensionFor(contentType, remoteUrl, kind) {
  const pathname = new URL(remoteUrl).pathname;
  const candidate = path.extname(pathname).toLowerCase();
  if (/^\.(mp3|flac|m4a|aac|ogg|wav|webm|jpg|jpeg|png|webp)$/.test(candidate)) return candidate;
  const mime = String(contentType || '').toLowerCase();
  if (mime.includes('flac')) return '.flac';
  if (mime.includes('mpeg')) return kind === 'cover' ? '.jpg' : '.mp3';
  if (mime.includes('mp4')) return '.m4a';
  if (mime.includes('ogg')) return '.ogg';
  if (mime.includes('wav')) return '.wav';
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  return kind === 'cover' ? '.jpg' : '.audio';
}

async function downloadToCache(kind, remoteUrl, key, maxBytes) {
  const parsed = new URL(remoteUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('不支持的媒体地址');
  const directory = path.join(mediaCachePath(), kind);
  fs.mkdirSync(directory, { recursive: true });
  const digest = crypto.createHash('sha256').update(`${kind}:${key}`).digest('hex');
  const existing = fs.readdirSync(directory).find((name) => name.startsWith(`${digest}.`) && !name.endsWith('.part'));
  if (existing) return cacheUrl(kind, existing);

  const response = await fetch(parsed, { signal: AbortSignal.timeout(kind === 'audio' ? 180000 : 20000), redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`媒体缓存失败（${response.status}）`);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > maxBytes) throw new Error('媒体文件超过缓存大小限制');
  const extension = extensionFor(response.headers.get('content-type'), response.url || remoteUrl, kind);
  const filename = `${digest}${extension}`;
  const finalPath = path.join(directory, filename);
  const temporaryPath = `${finalPath}.part`;
  let received = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      callback(received > maxBytes ? new Error('媒体文件超过缓存大小限制') : null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(response.body), limiter, fs.createWriteStream(temporaryPath));
    fs.renameSync(temporaryPath, finalPath);
    return cacheUrl(kind, filename);
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }); } catch {}
    throw error;
  }
}

function embeddedCoverUrl(picture, filePath) {
  if (!picture?.data?.length) return '';
  const mime = String(picture.format || 'image/jpeg').toLowerCase();
  const extension = mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : '.jpg';
  const bytes = Buffer.from(picture.data);
  if (bytes.length > 18 * 1024 * 1024) return '';
  const digest = crypto.createHash('sha256').update(filePath).update(bytes).digest('hex');
  const directory = path.join(mediaCachePath(), 'cover');
  const filename = `${digest}${extension}`;
  const destination = path.join(directory, filename);
  if (!fs.existsSync(destination)) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(destination, bytes);
  }
  return cacheUrl('cover', filename);
}

function lyricText(value) {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  return entries.map((entry) => {
    if (typeof entry === 'string') return entry;
    if (!entry || typeof entry !== 'object') return '';
    if (Array.isArray(entry.syncText) && entry.syncText.length) {
      return entry.syncText.map((line) => {
        const totalSeconds = Math.max(0, Number(line.timestamp || 0) / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = (totalSeconds % 60).toFixed(2).padStart(5, '0');
        return `[${String(minutes).padStart(2, '0')}:${seconds}]${line.text || ''}`;
      }).join('\n');
    }
    return entry.text || entry.lyrics || entry.value || '';
  }).filter(Boolean).join('\n');
}

function embeddedLyrics(metadata) {
  const common = lyricText(metadata.common?.lyrics);
  if (common) return common;
  for (const tags of Object.values(metadata.native || {})) {
    for (const tag of tags || []) {
      if (/^(USLT|SYLT|LYRICS|UNSYNCEDLYRICS)$/i.test(String(tag.id || ''))) {
        const text = lyricText(tag.value);
        if (text) return text;
      }
    }
  }
  return '';
}

function readSidecar(filePath, suffixes) {
  const base = filePath.slice(0, -path.extname(filePath).length);
  for (const suffix of suffixes) {
    const candidate = `${base}${suffix}`;
    try {
      if (fs.statSync(candidate).size <= 2 * 1024 * 1024) return fs.readFileSync(candidate, 'utf8');
    } catch {}
  }
  return '';
}

async function readLocalMetadata(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !/\.(mp3|flac|m4a|aac|ogg|oga|wav|wave|opus|webm)$/i.test(filePath)) {
    throw new Error('不支持的本地音频文件');
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024 * 1024) throw new Error('本地音频文件不可用');
  musicMetadataModule ||= import('music-metadata');
  const { parseFile } = await musicMetadataModule;
  const metadata = await parseFile(filePath, { duration: true, skipCovers: false });
  const common = metadata.common || {};
  return {
    title: common.title || '',
    artist: common.artist || common.albumartist || '',
    albumArtist: common.albumartist || '',
    album: common.album || '',
    year: Number(common.year || 0),
    duration: Number(metadata.format?.duration || 0),
    cover: embeddedCoverUrl(common.picture?.[0], filePath),
    lyricRaw: readSidecar(filePath, ['.lrc', '.LRC']) || embeddedLyrics(metadata),
    translationRaw: readSidecar(filePath, ['.trans.lrc', '.translation.lrc', '.翻译.lrc']),
    romanRaw: readSidecar(filePath, ['.roma.lrc', '.roman.lrc', '.音标.lrc']),
  };
}

function isAllowedAccountUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.origin === API_BASE || url.hostname === 'linux.do' || url.hostname.endsWith('.linux.do'));
  } catch {
    return false;
  }
}

function publishQuota(nextStatus) {
  quotaStatus = { ...nextStatus, updatedAt: Date.now() };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('quota:updated', quotaStatus);
  }
  return quotaStatus;
}

async function readQuotaFromAccountPage() {
  if (!accountWindow || accountWindow.isDestroyed() || accountWindow.webContents.isLoading()) {
    return quotaStatus;
  }
  try {
    const snapshot = await accountWindow.webContents.executeJavaScript(`(() => {
      const read = (id) => document.getElementById(id)?.textContent?.trim() || '';
      return {
        requests: read('usageRequests'),
        free: read('usageFreeRemaining'),
        paid: read('usagePaidRemaining'),
        userName: document.querySelector('[data-user-name], #userName, #username, .user-name, .username, .profile-name')?.textContent?.trim() || '',
        body: document.body?.innerText?.slice(0, 1200) || ''
      };
    })()`);
    const freeMatch = snapshot.free.match(/([\d,]+)\s*\/\s*([\d,]+)/);
    const requests = Number((snapshot.requests.match(/[\d,]+/) || [])[0]?.replaceAll(',', ''));
    const paid = Number((snapshot.paid.match(/[\d,]+/) || [])[0]?.replaceAll(',', ''));
    if (!freeMatch || !Number.isFinite(requests) || !Number.isFinite(paid)) {
      return publishQuota({ connected: false, state: 'disconnected' });
    }
    return publishQuota({
      connected: true,
      state: 'connected',
      requests,
      free: Number(freeMatch[1].replaceAll(',', '')),
      freeTotal: Number(freeMatch[2].replaceAll(',', '')),
      paid,
      rpm: 20,
      userName: snapshot.userName || '',
    });
  } catch {
    return publishQuota({ connected: false, state: 'disconnected' });
  }
}

function createAccountWindow(show = false) {
  if (accountWindow && !accountWindow.isDestroyed()) {
    if (show) {
      accountWindow.show();
      accountWindow.focus();
    }
    return accountWindow;
  }
  accountWindow = new BrowserWindow({
    width: 920,
    height: 760,
    minWidth: 720,
    minHeight: 620,
    show,
    backgroundColor: '#f4f6f8',
    title: 'ChKSz API 登录与额度',
    autoHideMenuBar: true,
    webPreferences: {
      partition: 'persist:chksz-account',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  accountWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank' || isAllowedAccountUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 560,
          height: 720,
          minWidth: 460,
          minHeight: 620,
          autoHideMenuBar: true,
          backgroundColor: '#f4f6f8',
          title: 'LinuxDo 登录',
          webPreferences: {
            partition: 'persist:chksz-account',
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      };
    }
    return { action: 'deny' };
  });
  accountWindow.webContents.on('did-create-window', (child) => {
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    child.webContents.on('will-navigate', (event, url) => {
      if (url !== 'about:blank' && !isAllowedAccountUrl(url)) event.preventDefault();
    });
    child.on('closed', () => {
      if (accountWindow && !accountWindow.isDestroyed()) {
        accountWindow.webContents.reloadIgnoringCache();
        setTimeout(readQuotaFromAccountPage, 1600);
      }
    });
  });
  accountWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedAccountUrl(url)) event.preventDefault();
  });
  accountWindow.webContents.on('did-finish-load', () => {
    setTimeout(readQuotaFromAccountPage, 900);
  });
  accountWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      accountWindow.hide();
    }
  });
  accountWindow.loadURL(ACCOUNT_URL);
  return accountWindow;
}

function readEncryptedKey() {
  try {
    const saved = readSettingsData();
    if (!saved.apiKey) return '';
    const encrypted = Buffer.from(saved.apiKey, 'base64');
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(encrypted)
      : '';
  } catch {
    return '';
  }
}

function writeEncryptedKey(value) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows 安全存储当前不可用，未保存 API Key。');
  }
  const encrypted = safeStorage.encryptString(value.trim()).toString('base64');
  writeSettingsData({ ...readSettingsData(), apiKey: encrypted });
}

function createTray() {
  if (tray && !tray.isDestroyed()) return tray;
  const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? path.join(__dirname, '..', 'build', 'icon.png') : icon);
  tray.setToolTip('Rain');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 Rain', click: () => showMainWindow() },
    { type: 'separator' },
    {
      label: '退出 Rain',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]));
  tray.on('click', () => showMainWindow());
  tray.on('double-click', () => showMainWindow());
  return tray;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (app.isReady()) createWindow();
    else pendingSecondInstance = true;
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (process.platform === 'win32') mainWindow.moveTop();
}

function hideMainWindow() {
  createTray();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
}

function requestCloseChoice(win) {
  if (closePromptPending || win.isDestroyed()) return;
  closePromptPending = true;
  if (!win.webContents.isDestroyed()) {
    win.webContents.send('app:close-requested');
  } else {
    closePromptPending = false;
    hideMainWindow();
  }
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showMainWindow();
    return mainWindow;
  }
  const win = new BrowserWindow({
    width: 1420,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: '#151417',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  mainWindow = win;
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  let retriedLoad = false;
  const revealWindow = () => {
    if (startupShowTimer) {
      clearTimeout(startupShowTimer);
      startupShowTimer = null;
    }
    if (!win.isDestroyed()) {
      win.show();
      win.focus();
    }
  };
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    const closeAction = getCloseAction();
    if (closeAction === 'quit') {
      quitting = true;
      setImmediate(() => app.quit());
    } else if (closeAction === 'tray') {
      hideMainWindow();
    } else {
      requestCloseChoice(win);
    }
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  const publishMaximized = () => {
    if (!win.isDestroyed()) win.webContents.send('window:maximized-changed', win.isMaximized());
  };
  win.on('maximize', publishMaximized);
  win.on('unmaximize', publishMaximized);
  win.once('ready-to-show', revealWindow);
  win.webContents.once('did-finish-load', revealWindow);
  win.webContents.on('did-fail-load', (_event, _code, _description, _url, isMainFrame) => {
    if (!isMainFrame || retriedLoad || win.isDestroyed()) return;
    retriedLoad = true;
    setTimeout(() => {
      if (devUrl) win.loadURL(devUrl);
      else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
    }, 250);
  });
  win.on('unresponsive', revealWindow);
  startupShowTimer = setTimeout(revealWindow, 2200);
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  return win;
}

async function startApplication() {
  app.setAppUserModelId('com.aurora.music');
  protocol.handle('rain-cache', (request) => {
    try {
      const url = new URL(request.url);
      const kind = url.hostname;
      const filename = decodeURIComponent(url.pathname.slice(1));
      if (!['audio', 'cover'].includes(kind) || path.basename(filename) !== filename || !/^[a-f0-9]{64}\.[a-z0-9]+$/i.test(filename)) {
        return new Response('Not found', { status: 404 });
      }
      const filePath = path.join(mediaCachePath(), kind, filename);
      if (!fs.existsSync(filePath)) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(filePath).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
  ipcMain.handle('settings:get', () => ({ hasApiKey: Boolean(readEncryptedKey()), closeAction: getCloseAction() }));
  ipcMain.handle('settings:save-key', (_event, apiKey) => {
    if (typeof apiKey !== 'string' || !/^chksz_[A-Za-z0-9_-]+$/.test(apiKey.trim())) {
      return { ok: false, message: 'API Key 格式应为 chksz_ 开头。' };
    }
    try {
      writeEncryptedKey(apiKey);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  });
  ipcMain.handle('settings:clear-key', () => {
    const settings = readSettingsData();
    delete settings.apiKey;
    writeSettingsData(settings);
    return { ok: true };
  });
  ipcMain.handle('settings:save-close-action', (_event, closeAction) => ({
    ok: saveCloseAction(closeAction),
    closeAction: CLOSE_ACTIONS.has(closeAction) ? closeAction : getCloseAction(),
  }));
  ipcMain.handle('app:resolve-close', (_event, decision) => {
    const action = decision?.action;
    const remember = Boolean(decision?.remember);
    closePromptPending = false;
    if (!['quit', 'tray', 'cancel'].includes(action)) return { ok: false };
    if (remember && action !== 'cancel') saveCloseAction(action);
    if (action === 'tray') hideMainWindow();
    if (action === 'quit') {
      quitting = true;
      setImmediate(() => app.quit());
    }
    return { ok: true, closeAction: getCloseAction() };
  });
  ipcMain.handle('window:minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
    return { ok: true };
  });
  ipcMain.handle('window:toggle-maximize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, maximized: false };
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return { ok: true, maximized: mainWindow.isMaximized() };
  });
  ipcMain.handle('window:close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    return { ok: true };
  });
  ipcMain.handle('window:is-maximized', () => Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized()));

  ipcMain.handle('local:metadata', async (_event, filePath) => {
    try {
      return { ok: true, metadata: await readLocalMetadata(filePath) };
    } catch (error) {
      return { ok: false, message: error.message || '无法读取本地歌曲信息' };
    }
  });

  ipcMain.handle('quota:get', () => {
    setTimeout(() => {
      if (!quitting) {
        createAccountWindow(false);
        setTimeout(readQuotaFromAccountPage, 900);
      }
    }, 1800);
    return quotaStatus;
  });
  ipcMain.handle('quota:open-login', async () => {
    const win = createAccountWindow(true);
    if (win.webContents.getURL() !== ACCOUNT_URL && !win.webContents.getURL().startsWith(API_BASE)) {
      await win.loadURL(ACCOUNT_URL);
    }
    setTimeout(readQuotaFromAccountPage, 1200);
    return { ok: true };
  });

  ipcMain.handle('cache:get-track', (_event, key) => {
    if (typeof key !== 'string' || key.length > 300) return null;
    return readCacheIndex().tracks[key] || null;
  });
  ipcMain.handle('cache:put-track', (_event, key, track) => {
    if (typeof key !== 'string' || key.length > 300 || !track || typeof track !== 'object') return { ok: false };
    const clean = JSON.parse(JSON.stringify(track));
    delete clean.raw;
    const serialized = JSON.stringify(clean);
    if (serialized.length > 3_000_000) return { ok: false };
    const index = readCacheIndex();
    index.tracks[key] = { ...clean, cachedAt: Date.now() };
    writeCacheIndex(index);
    return { ok: true };
  });
  ipcMain.handle('cache:hydrate-tracks', (_event, items) => {
    if (!Array.isArray(items)) return {};
    const index = readCacheIndex();
    const values = Object.values(index.tracks);
    const result = {};
    items.slice(0, 100).forEach((item) => {
      const identity = `${item?.source || ''}:${item?.id || ''}`;
      const match = values.filter((track) => `${track.source}:${track.id}` === identity).sort((a, b) => (b.cachedAt || 0) - (a.cachedAt || 0))[0];
      if (match) result[identity] = match;
    });
    return result;
  });
  ipcMain.handle('cache:audio', async (_event, key, remoteUrl) => {
    try {
      const url = await downloadToCache('audio', remoteUrl, key, 300 * 1024 * 1024);
      return { ok: true, url };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  });
  ipcMain.handle('cache:get-search', (_event, key) => {
    if (typeof key !== 'string' || key.length > 500) return null;
    const saved = readCacheIndex().searches[key];
    if (!saved || Date.now() - saved.cachedAt > 24 * 60 * 60 * 1000) return null;
    return saved.results;
  });
  ipcMain.handle('cache:put-search', (_event, key, results) => {
    if (typeof key !== 'string' || key.length > 500 || !Array.isArray(results)) return { ok: false };
    const clean = results.slice(0, 50).map(({ raw, ...item }) => item);
    const index = readCacheIndex();
    index.searches[key] = { results: clean, cachedAt: Date.now() };
    writeCacheIndex(index);
    return { ok: true };
  });

  ipcMain.handle('api:request', async (_event, request) => {
    const { path: apiPath, params = {} } = request || {};
    if (!ALLOWED_PATHS.has(apiPath)) return { ok: false, status: 400, message: '不允许的 API 路径。' };
    const apiKey = readEncryptedKey();
    if (!apiKey) return { ok: false, status: 401, message: '请先在设置中保存 API Key。' };

    const url = new URL(apiPath, API_BASE);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });
    url.searchParams.set('apikey', apiKey);

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const contentType = response.headers.get('content-type') || '';
      const data = contentType.includes('json') ? await response.json() : await response.text();
      const message = typeof data === 'object' ? (data.msg || data.message) : data;
      const freeHeader = response.headers.get('x-quota-free-remaining');
      const paidHeader = response.headers.get('x-quota-paid-remaining');
      if (freeHeader !== null || paidHeader !== null) {
        const free = Number(freeHeader);
        const paid = Number(paidHeader);
        publishQuota({
          ...quotaStatus,
          connected: true,
          state: 'connected',
          free: Number.isFinite(free) ? free : quotaStatus.free,
          paid: Number.isFinite(paid) ? paid : quotaStatus.paid,
          rpm: 20,
        });
      }
      return {
        ok: response.ok,
        status: response.status,
        data,
        message: response.ok ? '' : (message || `请求失败（${response.status}）`),
        quota: {
          limit: response.headers.get('x-ratelimit-limit'),
          free: response.headers.get('x-quota-free-remaining'),
          paid: response.headers.get('x-quota-paid-remaining'),
          retryAfter: response.headers.get('retry-after'),
        },
      };
    } catch (error) {
      return { ok: false, status: 0, message: error.name === 'TimeoutError' ? '请求超时，请稍后再试。' : '无法连接音乐服务。' };
    }
  });

  ipcMain.handle('cover:fetch', async (_event, coverUrl) => {
    try {
      const localUrl = await downloadToCache('cover', coverUrl, coverUrl, 12 * 1024 * 1024);
      return { ok: true, dataUrl: localUrl };
    } catch {
      return { ok: false };
    }
  });

  createWindow();
  quotaTimer = setInterval(readQuotaFromAccountPage, 30000);
  if (pendingSecondInstance) {
    pendingSecondInstance = false;
    showMainWindow();
  }
  app.on('activate', () => {
    showMainWindow();
  });
}

const gotSingleInstanceLock = DEV_INSTANCE || app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (app.isReady()) showMainWindow();
    else pendingSecondInstance = true;
  });
  app.whenReady().then(startApplication);
}

app.on('before-quit', () => {
  quitting = true;
  if (quotaTimer) clearInterval(quotaTimer);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !tray && !quitting) app.quit();
});
