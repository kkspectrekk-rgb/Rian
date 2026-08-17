const API_BASE = 'https://api.chksz.com';

const bridge = window.musicBridge;

export async function getSettings() {
  if (bridge) return bridge.getSettings();
  return { hasApiKey: Boolean(localStorage.getItem('aurora_api_key')), closeAction: localStorage.getItem('rain_close_action') || 'ask' };
}

export async function saveApiKey(apiKey) {
  if (bridge) return bridge.saveApiKey(apiKey);
  if (!/^chksz_[A-Za-z0-9_-]+$/.test(apiKey.trim())) return { ok: false, message: 'API Key 格式应为 chksz_ 开头。' };
  localStorage.setItem('aurora_api_key', apiKey.trim());
  return { ok: true };
}

export async function clearApiKey() {
  if (bridge) return bridge.clearApiKey();
  localStorage.removeItem('aurora_api_key');
  return { ok: true };
}

export async function saveCloseAction(closeAction) {
  if (bridge?.saveCloseAction) return bridge.saveCloseAction(closeAction);
  localStorage.setItem('rain_close_action', closeAction);
  return { ok: true, closeAction };
}

export async function resolveClose(decision) {
  if (bridge?.resolveClose) return bridge.resolveClose(decision);
  return { ok: true, closeAction: decision?.remember ? decision.action : 'ask' };
}

export function onCloseRequested(callback) {
  return bridge?.onCloseRequested ? bridge.onCloseRequested(callback) : () => {};
}

export async function minimizeWindow() { return bridge?.minimizeWindow?.(); }
export async function toggleMaximizeWindow() { return bridge?.toggleMaximizeWindow?.(); }
export async function closeWindow() { return bridge?.closeWindow?.(); }
export async function isWindowMaximized() { return bridge?.isWindowMaximized?.() || false; }
export function onWindowMaximized(callback) { return bridge?.onWindowMaximized ? bridge.onWindowMaximized(callback) : () => {}; }
export function getLocalFilePath(file) { return bridge?.getLocalFilePath ? bridge.getLocalFilePath(file) : ''; }

export async function getQuotaStatus() {
  if (bridge) return bridge.getQuotaStatus();
  return { connected: false, state: 'unavailable' };
}

export async function openQuotaLogin() {
  if (bridge) return bridge.openQuotaLogin();
  window.open('https://api.chksz.com/login.html', '_blank', 'noopener,noreferrer');
  return { ok: true };
}

export function onQuotaUpdated(callback) {
  return bridge?.onQuotaUpdated ? bridge.onQuotaUpdated(callback) : () => {};
}

export function cacheTrackKey(track, quality) {
  return `${track?.source || 'unknown'}:${track?.id || track?.mid || track?.title || ''}:${quality || track?.quality || 'default'}`;
}

export async function getCachedTrack(key) {
  return bridge?.getCachedTrack ? bridge.getCachedTrack(key) : null;
}

export async function putCachedTrack(key, track) {
  return bridge?.putCachedTrack ? bridge.putCachedTrack(key, track) : { ok: false };
}

export async function hydrateCachedTracks(items) {
  return bridge?.hydrateCachedTracks ? bridge.hydrateCachedTracks(items) : {};
}

export async function cacheAudio(key, url) {
  return bridge?.cacheAudio ? bridge.cacheAudio(key, url) : { ok: false };
}

export async function getCachedSearch(key) {
  return bridge?.getCachedSearch ? bridge.getCachedSearch(key) : null;
}

export async function putCachedSearch(key, results) {
  return bridge?.putCachedSearch ? bridge.putCachedSearch(key, results) : { ok: false };
}

export async function apiRequest(path, params) {
  if (bridge) return bridge.apiRequest(path, params);
  const apiKey = localStorage.getItem('aurora_api_key');
  if (!apiKey) return { ok: false, status: 401, message: '请先在设置中保存 API Key。' };
  const url = new URL(path, API_BASE);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  url.searchParams.set('apikey', apiKey);
  try {
    const response = await fetch(url);
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('json') ? await response.json() : await response.text();
    return { ok: response.ok, status: response.status, data, message: response.ok ? '' : (data?.msg || data?.message || `请求失败（${response.status}）`) };
  } catch {
    return { ok: false, status: 0, message: '浏览器受到跨域限制，请使用 Electron 桌面版。' };
  }
}

export async function makeCoverReadable(url) {
  if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('rain-cache:')) return url;
  if (bridge) {
    const result = await bridge.fetchCover(url);
    return result?.ok ? result.dataUrl : url;
  }
  return url;
}

function first(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function artistName(item) {
  const artists = first(item?.artists, item?.ar, item?.singers, item?.singer, item?.artist, item?.author);
  if (Array.isArray(artists)) return artists.map((artist) => typeof artist === 'string' ? artist : first(artist?.name, artist?.title, artist?.singer, '')).filter(Boolean).join(' / ') || '未知艺人';
  if (artists && typeof artists === 'object') return first(artists.name, artists.title, artists.singer, '未知艺人');
  return String(first(artists, '未知艺人'));
}

function albumName(item, fallback = '未知专辑') {
  const album = first(item?.album, item?.al, item?.albumname, item?.albumName);
  if (album && typeof album === 'object') return first(album.name, album.title, fallback);
  return String(first(album, fallback));
}

function coverUrl(item) {
  let cover = first(
    item?.cover, item?.pic, item?.picUrl, item?.picurl, item?.image, item?.img,
    item?.album?.picUrl, item?.album?.cover, item?.al?.picUrl, item?.album_img,
  );
  if (typeof cover === 'string' && cover.includes('{size}')) cover = cover.replaceAll('{size}', '400');
  if (cover) return cover;
  const albumMid = first(item?.albummid, item?.albumMid, item?.album?.mid, item?.album?.id);
  if (albumMid && /^[A-Za-z0-9]+$/.test(String(albumMid))) return `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`;
  return '';
}

export function normalizeSearch(data, source) {
  const root = data?.data ?? data?.result ?? data ?? {};
  const list = root.list ?? root.songs ?? root.data?.list ?? root.data?.songs ?? data?.list ?? data?.songs ?? [];
  return (Array.isArray(list) ? list : []).map((item, index) => ({
    source,
    id: String(first(item.id, item.songid, item.songId, item.mid, index + 1)),
    mid: first(item.mid, item.songmid),
    n: Number(first(item.n, index + 1)),
    title: first(item.name, item.songname, item.title, '未知歌曲'),
    artist: artistName(item),
    album: albumName(item),
    cover: coverUrl(item),
    duration: Number(first(item.duration, item.interval, item.dt, 0)),
    raw: item,
  }));
}

export function normalizeDetail(data, fallback) {
  const root = data?.data ?? data?.result ?? data ?? {};
  const url = first(root.url, root.musicUrl, root.play_url, root.src, data?.url, '');
  return {
    ...fallback,
    id: String(first(root.id, root.mid, fallback.id)),
    title: first(root.name, root.songname, fallback.title),
    artist: artistName({ ...fallback, ...root }),
    album: albumName(root, fallback.album),
    cover: first(coverUrl(root), fallback.cover),
    audioUrl: url,
    lyricRaw: first(root.lrc?.lyric, root.lrc, root.lyric, root.klyric, ''),
    translationRaw: first(root.tlyric?.lyric, root.trans, root.translation, ''),
    romanRaw: first(root.romalrc?.lyric, root.romalrc, root.roma, ''),
    wordLyricRaw: first(root.yrc?.lyric, root.yrc, root.wordLyric, ''),
    bitrate: first(root.bitrate, root.br, ''),
    format: first(root.format, root.type, ''),
    duration: Number(first(root.interval, root.duration, fallback.duration, 0)),
  };
}

export function extractLyricPayload(data) {
  const root = data?.data ?? data?.result ?? data ?? {};
  return {
    lyricRaw: first(root.lrc?.lyric, root.lrc, root.lyric, ''),
    translationRaw: first(root.tlyric?.lyric, root.tlyric, root.trans, root.translation, ''),
    romanRaw: first(root.romalrc?.lyric, root.romalrc, root.roma, ''),
    wordLyricRaw: first(root.yrc?.lyric, root.yrc, root.wordLyric, ''),
  };
}

export function normalizePlaylist(data, source = 'netease') {
  const root = data?.data?.playlist ?? data?.playlist ?? data?.data ?? data?.result ?? data ?? {};
  const rawTracks = root.tracks ?? root.songs ?? root.list ?? [];
  const tracks = (Array.isArray(rawTracks) ? rawTracks : []).map((item, index) => ({
    source,
    id: String(first(item.id, item.songid, item.songId, item.mid, index + 1)),
    mid: first(item.mid, item.songmid),
    n: Number(first(item.n, index + 1)),
    title: first(item.name, item.songname, item.title, '未知歌曲'),
    artist: artistName(item),
    album: albumName(item),
    cover: coverUrl(item) || coverUrl(root),
    duration: Number(first(item.duration, item.interval, item.dt, 0)),
    raw: item,
  }));
  return {
    id: String(first(root.id, root.playlistId, Date.now())),
    source,
    title: first(root.name, root.title, '导入的歌单'),
    creator: first(root.creator?.nickname, root.creator?.name, root.author, ''),
    cover: coverUrl(root),
    tracks,
  };
}
