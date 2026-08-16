const { app, BrowserWindow, ipcMain, safeStorage, protocol, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { pathToFileURL } = require('node:url');

const API_BASE = 'https://api.chksz.com';
const ACCOUNT_URL = `${API_BASE}/login.html`;
const LEGACY_USER_DATA = path.join(app.getPath('appData'), 'Aurora Music');
app.setPath('userData', LEGACY_USER_DATA);
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
let quotaTimer;
let quitting = false;
let quotaStatus = { connected: false, state: 'checking', updatedAt: 0 };

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
    const saved = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
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
  fs.writeFileSync(settingsPath(), JSON.stringify({ apiKey: encrypted }), { mode: 0o600 });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1420,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: '#151417',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#f7f7f8', height: 44 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
    if (process.platform !== 'darwin' && !quitting) app.quit();
  });
  win.once('ready-to-show', () => win.show());
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(() => {
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
  ipcMain.handle('settings:get', () => ({ hasApiKey: Boolean(readEncryptedKey()) }));
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
    try { fs.rmSync(settingsPath(), { force: true }); } catch {}
    return { ok: true };
  });

  ipcMain.handle('quota:get', async () => {
    createAccountWindow(false);
    return readQuotaFromAccountPage();
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
  createAccountWindow(false);
  quotaTimer = setInterval(readQuotaFromAccountPage, 30000);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  quitting = true;
  if (quotaTimer) clearInterval(quotaTimer);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
