import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Album,
  ArrowLeft,
  BarChart3,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Crop,
  Download,
  Ellipsis,
  Heart,
  HardDrive,
  Home,
  KeyRound,
  Keyboard,
  Library,
  ListOrdered,
  ListMusic,
  LoaderCircle,
  Maximize2,
  Minus,
  Minimize2,
  Music2,
  Pause,
  Play,
  Power,
  Repeat1,
  RotateCcw,
  Search,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Upload,
  UserRound,
  Volume2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  apiRequest,
  cacheAudio,
  cacheTrackKey,
  checkForUpdates,
  clearApiKey,
  downloadUpdate,
  extractLyricPayload,
  getCachedSearch,
  getCachedTrack,
  getLocalFilePath,
  readLocalMetadata,
  getQuotaStatus,
  getSettings,
  hydrateCachedTracks,
  makeCoverReadable,
  normalizeDetail,
  normalizePlaylist,
  normalizeSearch,
  onCloseRequested,
  onQuotaUpdated,
  onUpdateProgress,
  openQuotaLogin,
  putCachedSearch,
  putCachedTrack,
  installUpdate,
  resolveClose,
  saveApiKey,
  saveCloseAction,
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow,
  isWindowMaximized,
  onWindowMaximized,
} from './api';
import { parseLyrics } from './lyrics';
import rainIcon from './assets/rain-icon.png';

const SOURCE_META = {
  netease: { label: '网易云音乐', short: '网易云', color: '#fb3b58' },
  qq: { label: 'QQ 音乐', short: 'QQ 音乐', color: '#31d583' },
  kugou: { label: '酷狗音乐', short: '酷狗', color: '#55a8ff' },
  local: { label: '本地音乐', short: '本地', color: '#b7bcc5' },
};
const ONLINE_SOURCES = ['netease', 'qq', 'kugou'];

const QUALITY_OPTIONS = {
  netease: [
    ['standard', '标准 · 128 kbps'], ['exhigh', '极高 · 320 kbps'], ['lossless', '无损 · FLAC'], ['hires', 'Hi-Res · 高解析度'],
    ['jyeffect', '沉浸环绕 · 空间音频'], ['sky', '天空音频 · 空间音频'], ['jymaster', '超清母带 · Master'],
  ],
  qq: [['128k', '标准 · 128 kbps'], ['320k', '高品质 · 320 kbps'], ['flac', '无损 · FLAC'], ['hires', 'Hi-Res · 高解析度'], ['master', '母带 · Master']],
  kugou: [['128k', '标准 · 128 kbps'], ['320k', '高品质 · 320 kbps'], ['flac', '无损 · FLAC'], ['hires', 'Hi-Res · 高解析度'], ['master', '母带 · Master']],
  local: [['local', '本地原声']],
  empty: [['none', '未播放']],
};

const DEFAULT_QUALITIES = { netease: 'lossless', qq: 'flac', kugou: 'flac' };

function loadDefaultQualities() {
  try {
    const stored = JSON.parse(localStorage.getItem('rain_default_qualities_v1') || '{}');
    return Object.fromEntries(ONLINE_SOURCES.map((source) => {
      const requested = stored[source];
      const valid = QUALITY_OPTIONS[source].some(([value]) => value === requested);
      return [source, valid ? requested : DEFAULT_QUALITIES[source]];
    }));
  } catch {
    return { ...DEFAULT_QUALITIES };
  }
}

const PLAY_MODE_META = {
  sequence: { label: '顺序播放', toast: '已改为顺序播放' },
  shuffle: { label: '随机播放', toast: '已改为随机播放' },
  repeat: { label: '单曲循环', toast: '已改为单曲循环' },
};

const CLOSE_ACTION_OPTIONS = [
  ['ask', '每次关闭时询问'],
  ['tray', '最小化到系统托盘'],
  ['quit', '直接退出 Rain'],
];

const SHORTCUT_ACTIONS = [
  ['togglePlay', '播放 / 暂停', '控制当前歌曲'],
  ['previous', '上一首', '切换到播放队列中的上一首'],
  ['next', '下一首', '切换到播放队列中的下一首'],
  ['volumeUp', '增加音量', '每次增加 5%'],
  ['volumeDown', '降低音量', '每次降低 5%'],
];

const DEFAULT_SHORTCUTS = {
  togglePlay: { code: 'Space', key: ' ', ctrl: false, alt: false, shift: false, meta: false },
  previous: { code: 'ArrowLeft', key: 'ArrowLeft', ctrl: false, alt: true, shift: false, meta: false },
  next: { code: 'ArrowRight', key: 'ArrowRight', ctrl: false, alt: true, shift: false, meta: false },
  volumeUp: { code: 'ArrowUp', key: 'ArrowUp', ctrl: false, alt: true, shift: false, meta: false },
  volumeDown: { code: 'ArrowDown', key: 'ArrowDown', ctrl: false, alt: true, shift: false, meta: false },
};

const MODIFIER_CODES = new Set(['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight']);

function eventPhysicalCode(event) {
  if (event.code && event.code !== 'Unidentified') return event.code;
  const fallback = { ' ': 'Space', Spacebar: 'Space', Control: 'ControlLeft', Alt: 'AltLeft', Shift: 'ShiftLeft', Meta: 'MetaLeft' };
  if (fallback[event.key]) return fallback[event.key];
  if (/^Arrow(Left|Right|Up|Down)$/.test(event.key || '') || /^F\d{1,2}$/.test(event.key || '')) return event.key;
  if (/^[a-z]$/i.test(event.key || '')) return `Key${event.key.toUpperCase()}`;
  if (/^\d$/.test(event.key || '')) return `Digit${event.key}`;
  return event.key || '';
}

function loadKeyboardShortcuts() {
  try {
    const stored = JSON.parse(localStorage.getItem('rain_keyboard_shortcuts_v1') || '{}');
    return Object.fromEntries(Object.keys(DEFAULT_SHORTCUTS).map((action) => {
      const shortcut = stored[action];
      return [action, shortcut?.code ? { ...DEFAULT_SHORTCUTS[action], ...shortcut } : DEFAULT_SHORTCUTS[action]];
    }));
  } catch {
    return DEFAULT_SHORTCUTS;
  }
}

function shortcutFromEvent(event) {
  const code = eventPhysicalCode(event);
  if (!code || MODIFIER_CODES.has(code)) return null;
  return { code, key: event.key, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey };
}

function shortcutIdentity(shortcut) {
  return `${shortcut.ctrl ? '1' : '0'}${shortcut.alt ? '1' : '0'}${shortcut.shift ? '1' : '0'}${shortcut.meta ? '1' : '0'}:${shortcut.code}`;
}

function codeLabel(shortcut) {
  const labels = { Space: '空格', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc', Backspace: '退格', Delete: 'Delete', Enter: 'Enter', Tab: 'Tab' };
  if (labels[shortcut.code]) return labels[shortcut.code];
  if (/^Key[A-Z]$/.test(shortcut.code)) return shortcut.code.slice(3);
  if (/^Digit\d$/.test(shortcut.code)) return shortcut.code.slice(5);
  if (/^Numpad\d$/.test(shortcut.code)) return `小键盘 ${shortcut.code.slice(6)}`;
  return shortcut.key?.length === 1 ? shortcut.key.toUpperCase() : shortcut.key || shortcut.code;
}

function formatShortcut(shortcut) {
  if (!shortcut) return '未设置';
  return [...(shortcut.ctrl ? ['Ctrl'] : []), ...(shortcut.alt ? ['Alt'] : []), ...(shortcut.shift ? ['Shift'] : []), ...(shortcut.meta ? ['Win'] : []), codeLabel(shortcut)].join(' + ');
}

function shortcutMatches(event, shortcut) {
  return eventPhysicalCode(event) === shortcut.code && event.ctrlKey === Boolean(shortcut.ctrl) && event.altKey === Boolean(shortcut.alt) && event.shiftKey === Boolean(shortcut.shift) && event.metaKey === Boolean(shortcut.meta);
}

function isTypingTarget(target) {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || Boolean(target.closest('[role="dialog"], [role="menu"], [role="listbox"]')));
}

const EMPTY_TRACK = {
  id: 'rain-empty', source: 'empty', title: '未播放歌曲', artist: '选择歌曲后开始播放',
  album: 'Rain', cover: rainIcon, duration: 0, audioUrl: '', lyricRaw: '', wordLyricRaw: '',
  translationRaw: '', romanRaw: '', quality: 'none', empty: true,
};

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

function initials(title = '') {
  return title.trim().slice(0, 1).toUpperCase() || '♪';
}

function useEdgePalette(cover) {
  const [palette, setPalette] = useState(['#d49176', '#6e668f', '#382d4c', '#c46e68']);
  useEffect(() => {
    if (!cover) return;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 56;
        canvas.height = 56;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0, 56, 56);
        const sample = (side) => {
          const values = [];
          for (let i = 3; i < 53; i += 4) {
            const [x, y] = side === 0 ? [i, 2] : side === 1 ? [53, i] : side === 2 ? [i, 53] : [2, i];
            const pixel = context.getImageData(x, y, 1, 1).data;
            if (pixel[3] > 10) values.push(pixel);
          }
          const rgb = [0, 1, 2].map((channel) => Math.round(values.reduce((sum, value) => sum + value[channel], 0) / values.length));
          const lifted = rgb.map((value) => Math.min(235, Math.max(42, Math.round(value * 0.92 + 18))));
          return `rgb(${lifted.join(',')})`;
        };
        setPalette([0, 1, 2, 3].map(sample));
      } catch {
        setPalette(['#d49176', '#6e668f', '#382d4c', '#c46e68']);
      }
    };
    image.src = cover;
  }, [cover]);
  return palette;
}

function IconButton({ label, children, className = '', ...props }) {
  return <button className={`icon-button ${className}`} aria-label={label} title={label} {...props}>{children}</button>;
}

function SourceMark({ source }) {
  const meta = SOURCE_META[source] || SOURCE_META.netease;
  return <span className="source-mark" style={{ '--source-color': meta.color }}>{meta.short}</span>;
}

function trackKey(track) {
  return `${track?.source || 'unknown'}:${track?.id || track?.title || ''}`;
}

function persistableTrack(track) {
  if (!track) return null;
  const { raw, ...clean } = track;
  if (clean.audioUrl?.startsWith('blob:')) delete clean.audioUrl;
  return clean;
}

function withLocalMetadata(track, metadata = {}) {
  return {
    ...track,
    title: metadata.title || track.title,
    artist: metadata.artist || metadata.albumArtist || (track.artist === '本地音乐' ? '未知艺术家' : track.artist) || '未知艺术家',
    album: metadata.album || (track.album === '已导入' ? '本地音乐' : track.album) || '本地音乐',
    cover: metadata.cover || track.cover || rainIcon,
    duration: Number(metadata.duration || track.duration || 0),
    bitrate: Number(metadata.bitrate || track.bitrate || 0),
    sampleRate: Number(metadata.sampleRate || track.sampleRate || 0),
    bitsPerSample: Number(metadata.bitsPerSample || track.bitsPerSample || 0),
    format: metadata.format || track.format || '',
    lossless: Boolean(metadata.lossless ?? track.lossless),
    lyricRaw: metadata.lyricRaw || track.lyricRaw || '',
    translationRaw: metadata.translationRaw || track.translationRaw || '',
    romanRaw: metadata.romanRaw || track.romanRaw || '',
    metadataVersion: 2,
  };
}

function formatLocalBitrate(bitrate) {
  const value = Number(bitrate);
  if (!Number.isFinite(value) || value <= 0) return '';
  const kbps = value / 1000;
  return `${Number.isInteger(kbps) ? kbps : kbps.toFixed(1).replace(/\.0$/, '')} kbps`;
}

function formatSampleRate(sampleRate) {
  const value = Number(sampleRate);
  if (!Number.isFinite(value) || value <= 0) return '';
  const khz = value / 1000;
  return `${Number.isInteger(khz) ? khz : khz.toFixed(1).replace(/\.0$/, '')} kHz`;
}

function localQualityLabel(track) {
  const bitrate = formatLocalBitrate(track?.bitrate);
  if (!bitrate) return '本地原声';
  const format = String(track?.format || '').trim().toUpperCase();
  const sampleRate = formatSampleRate(track?.sampleRate);
  return [format, bitrate, sampleRate].filter(Boolean).join(' · ');
}

function qualityOptionsForTrack(track) {
  if (track?.source === 'local') return [['local', localQualityLabel(track)]];
  return QUALITY_OPTIONS[track?.source] || QUALITY_OPTIONS.netease;
}

function loadCollection(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function artPlaceholder(item, fallback = '♪') {
  if (item?.cover) return { style: { backgroundImage: `url(${item.cover})` } };
  const label = String(item?.album || item?.artist || item?.title || item?.name || fallback);
  let hash = 0;
  for (const character of label) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return {
    className: 'art-placeholder',
    'data-art-label': initials(label),
    style: { '--art-hue': Math.abs(hash) % 360 },
  };
}

function saveCollection(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function systemDayLabel(date = new Date()) {
  return `星期${['日', '一', '二', '三', '四', '五', '六'][date.getDay()]}`;
}

function localDateKey(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function emptyListeningStats() {
  return { totalSeconds: 0, totalTracks: 0, days: {} };
}

function loadListeningStats() {
  try {
    const saved = JSON.parse(localStorage.getItem('rain_listening_stats_v1') || 'null');
    return saved && typeof saved === 'object' ? { ...emptyListeningStats(), ...saved, days: saved.days || {} } : emptyListeningStats();
  } catch { return emptyListeningStats(); }
}

function aggregateEntities(results, kind) {
  const map = new Map();
  results.forEach((track) => {
    const names = kind === 'artist' ? String(track.artist || '未知艺人').split(/\s*[/、]\s*/).filter(Boolean) : [track.album || '未知专辑'];
    names.forEach((name) => {
      const key = `${track.source}:${name}`;
      const previous = map.get(key);
      map.set(key, previous ? { ...previous, tracks: [...previous.tracks, track] } : {
        id: key, type: kind, source: track.source, name, artist: kind === 'album' ? track.artist : '', cover: track.cover, tracks: [track],
      });
    });
  });
  return [...map.values()];
}

function parsePlaylistUrl(value) {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    const params = url.searchParams;
    if (host.includes('163.com')) return { source: 'netease', id: params.get('id'), url: url.toString() };
    if (host.includes('qq.com')) return { source: 'qq', id: params.get('id') || params.get('dirid') || params.get('disstid'), url: url.toString() };
    if (host.includes('kugou.com')) return { source: 'kugou', id: params.get('id') || params.get('listid') || params.get('global_collection_id'), url: url.toString() };
  } catch {}
  return null;
}

function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    isWindowMaximized().then(setMaximized);
    return onWindowMaximized(setMaximized);
  }, []);
  return (
    <div className="window-controls" aria-label="窗口控制">
      <button type="button" aria-label="最小化" onClick={minimizeWindow}><Minus size={16} /></button>
      <button type="button" aria-label={maximized ? '还原窗口' : '最大化'} onClick={() => toggleMaximizeWindow().then((result) => result && setMaximized(Boolean(result.maximized)))}>{maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
      <button className="window-close" type="button" aria-label="关闭" onClick={closeWindow}><X size={17} /></button>
    </div>
  );
}

function ProfileMenu({ avatar, userName, stats }) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [range, setRange] = useState('week');
  const rootRef = useRef(null);
  const open = hovered || pinned;
  useEffect(() => {
    if (!pinned) return undefined;
    const close = (event) => { if (!rootRef.current?.contains(event.target)) setPinned(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [pinned]);
  const today = stats.days?.[localDateKey()] || { seconds: 0, tracks: 0 };
  const count = range === 'day' ? 1 : range === 'week' ? 7 : 30;
  const bars = Array.from({ length: count }, (_, offset) => {
    const date = new Date(); date.setDate(date.getDate() - (count - 1 - offset));
    return stats.days?.[localDateKey(date)]?.seconds || 0;
  });
  const max = Math.max(...bars, 60);
  return (
    <div className="profile-root" data-open={open} ref={rootRef} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button className="round-avatar" type="button" aria-expanded={open} onClick={() => setPinned((value) => !value)}>{avatar ? <img src={avatar} alt="用户头像" /> : initials(userName || 'R')}</button>
      <div className="profile-popover" data-open={open} aria-hidden={!open}>
        <div className="profile-title"><span>{userName || 'Rain 用户'}</span><small>听歌概览</small></div>
        <div className="stat-grid"><span><strong>{Math.floor(stats.totalSeconds / 60)}</strong><small>累计分钟</small></span><span><strong>{stats.totalTracks}</strong><small>累计歌曲</small></span><span><strong>{Math.floor(today.seconds / 60)}</strong><small>今日分钟</small></span><span><strong>{today.tracks}</strong><small>今日歌曲</small></span></div>
        <div className="chart-tabs"><BarChart3 size={14} />{[['day','日'],['week','周'],['month','月']].map(([value, label]) => <button type="button" className={range === value ? 'active' : ''} key={value} onClick={() => setRange(value)}>{label}</button>)}</div>
        <div className="listening-chart" aria-label={`${range}听歌趋势`}>{bars.map((value, index) => <i key={index} title={`${Math.floor(value / 60)} 分钟`} style={{ transform: `scaleY(${Math.max(.06, value / max)})` }} />)}</div>
      </div>
    </div>
  );
}

function CustomSelect({ value, onChange, options, label, icon, disabled = false, className = '' }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef(null);
  const selectedIndex = Math.max(0, options.findIndex(([optionValue]) => optionValue === value));

  useEffect(() => {
    if (!open) return undefined;
    setActiveIndex(selectedIndex);
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open, selectedIndex]);

  const choose = (index) => {
    const option = options[index];
    if (!option) return;
    onChange(option[0]);
    setOpen(false);
  };

  const onKeyDown = (event) => {
    if (disabled) return;
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) return setOpen(true);
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((index) => (index + delta + options.length) % options.length);
    }
    if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault();
      choose(activeIndex);
    }
  };

  return (
    <div className={`custom-select ${className} ${open ? 'open' : ''}`} ref={rootRef} onKeyDown={onKeyDown}>
      <button className="select-trigger" type="button" disabled={disabled} aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((state) => !state)}>
        {icon}
        <span>{options[selectedIndex]?.[1] || value}</span>
        {disabled ? <LoaderCircle className="spin" size={14} /> : <ChevronDown className="select-chevron" size={14} />}
      </button>
      <div className="select-menu" data-open={open} role="listbox" aria-label={label} aria-hidden={!open}>
          {options.map(([optionValue, optionLabel], index) => (
            <button key={optionValue} type="button" tabIndex={open ? 0 : -1} role="option" aria-selected={optionValue === value} data-active={index === activeIndex} onPointerMove={() => setActiveIndex(index)} onClick={() => choose(index)}>
              <span>{optionLabel}</span>{optionValue === value && <Check size={14} />}
            </button>
          ))}
      </div>
    </div>
  );
}

function QuotaStatus({ quota, onConnect }) {
  if (!quota?.connected) {
    return (
      <button className="quota-card disconnected" type="button" onClick={onConnect}>
        <span className="quota-status-dot" />
        <span><strong>{quota?.state === 'checking' ? '正在连接' : '未连接'}</strong><small>登录 API 站点同步剩余次数</small></span>
        <span className="quota-arrow">↗</span>
      </button>
    );
  }
  return (
    <div className="quota-card" aria-label="API 调用额度">
      <span><small>今日请求</small><strong>{quota.requests ?? '—'}</strong></span>
      <span><small>免费剩余</small><strong>{quota.free ?? '—'}{quota.freeTotal ? ` / ${quota.freeTotal}` : ''}</strong></span>
      <span><small>兑换剩余</small><strong>{quota.paid ?? '—'}</strong></span>
      <span><small>速率</small><strong>{quota.rpm || 20} RPM</strong></span>
    </div>
  );
}

function TrackRows({ tracks, emptyTitle, emptyCopy, onPlay, activeRequest, onRemove }) {
  if (!tracks.length) {
    return <div className="empty-state"><Heart /><strong>{emptyTitle}</strong><span>{emptyCopy}</span></div>;
  }
  return (
    <div className="results-list collection-list">
      {tracks.map((item, index) => (
        <div className="saved-track-row" key={trackKey(item)}>
          <button className="saved-track-main" onClick={() => onPlay(item)} disabled={Boolean(activeRequest)}>
            <span className="result-index">{activeRequest === trackKey(item) ? <LoaderCircle className="spin" size={16} /> : String(index + 1).padStart(2, '0')}</span>
            <span className="result-art" style={{ backgroundImage: `url(${item.cover || rainIcon})` }} />
            <span className="result-title"><strong>{item.title}</strong><small>{item.artist}</small></span>
            <span className="result-album">{item.album}</span>
            <SourceMark source={item.source} />
            <span className="result-play"><Play size={14} fill="currentColor" /></span>
          </button>
          {onRemove && <IconButton className="saved-remove" label={`从喜欢的音乐中移除 ${item.title}`} onClick={() => onRemove(item)}><X size={15} /></IconButton>}
        </div>
      ))}
    </div>
  );
}

function AvatarCropDialog({ source, onCancel, onSave }) {
  const size = 280;
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const imageRef = useRef(null);
  const dragRef = useRef(null);
  const baseScale = size / Math.min(imageSize.width, imageSize.height);
  const renderedWidth = imageSize.width * baseScale * zoom;
  const renderedHeight = imageSize.height * baseScale * zoom;
  const clampOffset = (next, nextZoom = zoom) => {
    const width = imageSize.width * baseScale * nextZoom;
    const height = imageSize.height * baseScale * nextZoom;
    return {
      x: Math.max(-(width - size) / 2, Math.min((width - size) / 2, next.x)),
      y: Math.max(-(height - size) / 2, Math.min((height - size) / 2, next.y)),
    };
  };
  const changeZoom = (value) => {
    const next = Number(value);
    setZoom(next);
    setOffset((current) => clampOffset(current, next));
  };
  const save = () => {
    const image = imageRef.current;
    if (!image) return;
    const outputSize = 512;
    const ratio = outputSize / size;
    const canvas = document.createElement('canvas');
    canvas.width = outputSize; canvas.height = outputSize;
    const context = canvas.getContext('2d');
    context.fillStyle = '#151417'; context.fillRect(0, 0, outputSize, outputSize);
    context.drawImage(image, (size / 2 - renderedWidth / 2 + offset.x) * ratio, (size / 2 - renderedHeight / 2 + offset.y) * ratio, renderedWidth * ratio, renderedHeight * ratio);
    onSave(canvas.toDataURL('image/jpeg', .9));
  };
  return <div className="avatar-crop-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}><div className="avatar-crop-dialog" role="dialog" aria-modal="true" aria-labelledby="avatar-crop-title"><header><div><p>个人头像</p><h2 id="avatar-crop-title">调整圆形裁剪</h2></div><IconButton label="取消裁剪" onClick={onCancel}><X size={18} /></IconButton></header><div className="avatar-crop-stage" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: offset }; }} onPointerMove={(event) => { const drag = dragRef.current; if (!drag || drag.id !== event.pointerId) return; setOffset(clampOffset({ x: drag.origin.x + event.clientX - drag.x, y: drag.origin.y + event.clientY - drag.y })); }} onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }}><img ref={imageRef} src={source} alt="待裁剪头像" draggable="false" onLoad={(event) => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} style={{ width: renderedWidth, height: renderedHeight, transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)` }} /><div className="avatar-crop-mask" aria-hidden="true" /></div><div className="avatar-zoom"><ZoomOut size={16} /><input aria-label="头像缩放" type="range" min="1" max="3" step=".01" value={zoom} onChange={(event) => changeZoom(event.target.value)} /><ZoomIn size={16} /></div><p className="crop-help"><Crop size={15} />拖动图片选择头像范围，使用滑杆缩放。</p><div className="crop-actions"><button className="text-button" type="button" onClick={onCancel}>取消</button><button className="primary-button" type="button" onClick={save}><Check size={16} />使用此头像</button></div></div></div>;
}

function ShortcutRecorder({ shortcut, recording, onStart, onCancel, onCommit }) {
  const pressedRef = useRef(new Set());
  const candidateRef = useRef(null);
  const commitRef = useRef(onCommit);
  const cancelRef = useRef(onCancel);
  const [draft, setDraft] = useState('');
  commitRef.current = onCommit;
  cancelRef.current = onCancel;

  useEffect(() => {
    pressedRef.current.clear();
    candidateRef.current = null;
    setDraft('');
    if (!recording) return undefined;

    const onKeyDown = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      const code = eventPhysicalCode(event);
      if (code === 'Escape' && pressedRef.current.size === 0) {
        cancelRef.current();
        return;
      }
      pressedRef.current.add(code);
      const candidate = shortcutFromEvent(event);
      if (candidate) {
        candidateRef.current = candidate;
        setDraft(formatShortcut(candidate));
        return;
      }
      const modifiers = [event.ctrlKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', event.metaKey ? 'Win' : ''].filter(Boolean);
      setDraft(modifiers.length ? `${modifiers.join(' + ')} + …` : '请继续按下按键');
    };
    const onKeyUp = (event) => {
      event.preventDefault();
      event.stopPropagation();
      pressedRef.current.delete(eventPhysicalCode(event));
      if (pressedRef.current.size || !candidateRef.current) return;
      const candidate = candidateRef.current;
      candidateRef.current = null;
      setDraft('');
      commitRef.current(candidate);
    };
    const onBlur = () => {
      pressedRef.current.clear();
      candidateRef.current = null;
      setDraft('');
      cancelRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [recording]);

  return (
    <button className="shortcut-recorder" data-recording={recording} type="button" aria-label={recording ? '正在录制快捷键，松开全部按键后保存' : `当前快捷键 ${formatShortcut(shortcut)}，点击修改`} aria-pressed={recording} onClick={() => recording ? onCancel() : onStart()}>
      <Keyboard size={15} />
      <span aria-live="polite">{recording ? (draft || '请按组合键…') : formatShortcut(shortcut)}</span>
    </button>
  );
}

function SettingsView({ hasApiKey, onSaved, notify, onOpenAccount, closeAction, onCloseAction, avatar, onAvatar, userName, shortcuts, onShortcut, onResetShortcuts, defaultQualities, onDefaultQuality, onCheckUpdate, updateChecking }) {
  const [key, setKey] = useState('');
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cropSource, setCropSource] = useState('');
  const [recordingShortcut, setRecordingShortcut] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    const result = await saveApiKey(key);
    setSaving(false);
    if (!result.ok) return notify(result.message, 'error');
    setKey('');
    onSaved(true);
    notify('API Key 已使用 Windows 安全存储加密保存', 'success');
  };

  const remove = async () => {
    await clearApiKey();
    onSaved(false);
    setKey('');
    notify('已从本机移除 API Key');
  };

  return (
    <section className="settings-view content-enter">
      <header className="page-heading"><p>偏好设置</p><h1>设置</h1></header>
      <div className="settings-card">
        <div className="setting-icon"><KeyRound size={21} /></div>
        <div className="setting-copy">
          <h2>ChKSz API</h2>
          <p>用于搜索、解析播放地址与读取歌词。密钥只保存在这台 Windows 设备上。</p>
        </div>
        <span className={`status-pill ${hasApiKey ? 'connected' : ''}`}>{hasApiKey ? '已连接' : '未设置'}</span>
      </div>
      <form className="key-form" onSubmit={submit}>
        <label htmlFor="api-key">API Key</label>
        <div className="key-field">
          <input id="api-key" value={key} onChange={(event) => setKey(event.target.value)} type={visible ? 'text' : 'password'} placeholder={hasApiKey ? '输入新 Key 以替换当前密钥' : 'chksz_••••••••••••••••'} autoComplete="off" spellCheck="false" />
          <button type="button" onClick={() => setVisible((value) => !value)}>{visible ? '隐藏' : '显示'}</button>
        </div>
        <div className="key-actions">
          <button className="primary-button" disabled={!key.trim() || saving} type="submit">{saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}保存密钥</button>
          {hasApiKey && <button className="text-button danger" type="button" onClick={remove}>移除密钥</button>}
        </div>
      </form>
      <div className="privacy-note"><Sparkles size={17} /><p>桌面版通过 Electron 主进程请求 API，Key 不会进入界面日志或项目源码。请勿在截图或公开链接中分享密钥。</p></div>
      <button className="login-link" type="button" onClick={onOpenAccount}>登录 API 网站、获取或管理 API Key <span>↗</span></button>
      <div className="settings-card update-card">
        <div className="setting-icon update-setting-icon"><RotateCcw size={20} /></div>
        <div className="setting-copy"><h2>软件更新</h2><p>检查 GitHub 上的 Rain 最新便携版，并下载替换当前版本。</p></div>
        <button className="secondary-button" type="button" disabled={updateChecking} onClick={onCheckUpdate}>{updateChecking ? <LoaderCircle className="spin" size={14} /> : <RotateCcw size={14} />}检查更新</button>
      </div>
      <div className="profile-setting settings-card">
        <div className="settings-avatar">{avatar ? <img src={avatar} alt="当前头像" /> : initials(userName || 'R')}</div>
        <div className="setting-copy"><h2>个人头像</h2><p>{userName || '登录 API 网站后可同步用户名'}。头像只保存在这台设备上。</p></div>
        <label className="secondary-button">更换头像<input className="sr-only" type="file" accept="image/*" onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          if (file.size > 3 * 1024 * 1024) return notify('头像文件请小于 3 MB', 'error');
          const reader = new FileReader();
          reader.onload = () => setCropSource(String(reader.result || ''));
          reader.readAsDataURL(file);
        }} /></label>
        {avatar && <button className="text-button danger" type="button" onClick={() => onAvatar('')}>移除</button>}
      </div>
      <section className="quality-preference" aria-labelledby="quality-preference-heading">
        <header className="quality-preference-heading">
          <div className="setting-icon quality-setting-icon"><SlidersHorizontal size={20} /></div>
          <div className="setting-copy">
            <h2 id="quality-preference-heading">默认播放音质</h2>
            <p>按平台设置首次解析时使用的音质；播放中仍可在歌词详细页单独切换。</p>
          </div>
        </header>
        <div className="quality-preference-list">
          {ONLINE_SOURCES.map((source) => (
            <div className="quality-preference-row" key={source}>
              <div>
                <strong>{SOURCE_META[source].label}</strong>
                <span>接口参数 · {source === 'netease' ? 'level' : 'size'}</span>
              </div>
              <CustomSelect className="default-quality-select" label={`${SOURCE_META[source].label}默认音质`} value={defaultQualities[source]} options={QUALITY_OPTIONS[source]} onChange={(value) => onDefaultQuality(source, value)} />
            </div>
          ))}
        </div>
        <p className="quality-preference-help">128 kbps 与 320 kbps 为文档明确的原生档位；FLAC、Hi-Res、空间音频及母带的实际采样率以平台返回的音频文件为准。</p>
      </section>
      <section className="shortcut-preference" aria-labelledby="shortcut-heading">
        <header className="shortcut-heading">
          <div className="setting-icon shortcut-setting-icon"><Keyboard size={20} /></div>
          <div className="setting-copy">
            <h2 id="shortcut-heading">键盘快捷键</h2>
            <p>只在 Rain 窗口处于前台时生效；输入文字和操作弹窗时会自动停用。</p>
          </div>
          <button className="secondary-button shortcut-reset" type="button" onClick={() => { setRecordingShortcut(''); onResetShortcuts(); notify('快捷键已恢复默认设置', 'success'); }}><RotateCcw size={14} />恢复默认</button>
        </header>
        <div className="shortcut-list">
          {SHORTCUT_ACTIONS.map(([action, label, description]) => (
            <div className="shortcut-row" key={action}>
              <div><strong>{label}</strong><span>{description}</span></div>
              <ShortcutRecorder
                shortcut={shortcuts[action]}
                recording={recordingShortcut === action}
                onStart={() => setRecordingShortcut(action)}
                onCancel={() => setRecordingShortcut('')}
                onCommit={(candidate) => {
                  const result = onShortcut(action, candidate);
                  if (!result.ok) return notify(result.message, 'error');
                  setRecordingShortcut('');
                  notify(`${label}：${formatShortcut(candidate)}`, 'success');
                }}
              />
            </div>
          ))}
        </div>
        <p className="shortcut-help">点击右侧键位后输入按键或组合键，全部松开时自动保存；按 Esc 取消。Windows 保留的系统快捷键可能无法被 Rain 使用。</p>
      </section>
      <div className="close-preference">
        <div className="setting-icon close-setting-icon"><Power size={20} /></div>
        <div className="setting-copy">
          <h2>关闭窗口时</h2>
          <p>选择关闭 Rain、保留在系统托盘，或每次关闭时询问。</p>
        </div>
        <CustomSelect className="close-action-select" label="关闭窗口行为" value={closeAction} options={CLOSE_ACTION_OPTIONS} onChange={onCloseAction} />
      </div>
      {cropSource && <AvatarCropDialog source={cropSource} onCancel={() => setCropSource('')} onSave={(nextAvatar) => { onAvatar(nextAvatar); setCropSource(''); notify('头像已裁剪并保存在本机', 'success'); }} />}
    </section>
  );
}

function CloseBehaviorDialog({ onChoose, onCancel }) {
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div className="close-dialog-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className="close-dialog" role="dialog" aria-modal="true" aria-labelledby="close-dialog-title" aria-describedby="close-dialog-description">
        <div className="close-dialog-icon"><Power size={22} /></div>
        <h2 id="close-dialog-title">关闭 Rain？</h2>
        <p id="close-dialog-description">你可以完全退出软件，或让 Rain 留在系统托盘中继续运行。</p>
        <label className="remember-close-choice">
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          <span><Check size={13} /></span>
          下次不再询问
        </label>
        <div className="close-dialog-actions">
          <button className="dialog-button tray-button" type="button" autoFocus onClick={() => onChoose('tray', remember)}><Minimize2 size={17} />最小化到托盘</button>
          <button className="dialog-button quit-button" type="button" onClick={() => onChoose('quit', remember)}><Power size={17} />关闭软件</button>
        </div>
        <button className="dialog-cancel" type="button" onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}

function UpdateDialog({ info, downloading, progress, onClose, onUpdate }) {
  return (
    <div className="close-dialog-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget && !downloading) onClose(); }}>
      <div className="close-dialog update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-dialog-title">
        <div className="close-dialog-icon"><Download size={22} /></div>
        <h2 id="update-dialog-title">发现新版本</h2>
        <p className="update-version">{info.name || `Rain ${info.version}`}</p>
        <div className="update-notes">{info.notes || '这个版本没有提供更新说明。'}</div>
        {downloading ? (
          <div className="update-progress"><span>{progress}%</span><i><b style={{ transform: `scaleX(${progress / 100})` }} /></i></div>
        ) : (
          <button className="primary-button" type="button" onClick={onUpdate}><Download size={16} />前往下载安装版</button>
        )}
        {!downloading && <button className="dialog-cancel" type="button" onClick={onClose}>稍后再说</button>}
      </div>
    </div>
  );
}

function SearchView({ active, hasApiKey, onNeedKey, onSelect, onPlayAll, activeRequest, quota, onOpenAccount, savedArtists, savedAlbums, onSaveArtist, onSaveAlbum, entityRequest, liked, onToggleLike }) {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('netease');
  const [results, setResults] = useState([]);
  const [tab, setTab] = useState('all');
  const [history, setHistory] = useState(() => loadCollection('rain_search_history'));
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [entityDetail, setEntityDetail] = useState(null);

  const enrich = async (items) => {
    const cached = await hydrateCachedTracks(items);
    return items.map((item) => {
      const saved = cached[`${item.source}:${item.id}`];
      if (!saved) return item;
      const artistMissing = !item.artist || item.artist === '未知艺人' || item.artist === '[object Object]';
      return {
        ...item,
        cover: item.cover || saved.cover || '',
        artist: artistMissing ? saved.artist : item.artist,
        album: !item.album || item.album === '未知专辑' ? saved.album : item.album,
      };
    });
  };

  const search = async (event, force = false, override = null) => {
    event?.preventDefault();
    const keyword = (override?.query ?? query).trim();
    const nextSource = override?.source ?? source;
    if (!keyword) return;
    setEntityDetail(null);
    if (override) { setQuery(keyword); setSource(nextSource); }
    setLoading(true);
    setError('');
    setSearched(true);
    const nextHistory = [{ query: keyword, source: nextSource, at: Date.now() }, ...history.filter((item) => item.query !== keyword || item.source !== nextSource)].slice(0, 15);
    setHistory(nextHistory); saveCollection('rain_search_history', nextHistory);
    const searchCacheKey = `${nextSource}:${keyword.toLocaleLowerCase()}`;
    if (!force) {
      const saved = await getCachedSearch(searchCacheKey);
      if (saved?.length) {
        setResults(await enrich(saved));
        setFromCache(true);
        setLoading(false);
        return;
      }
    }
    if (!hasApiKey) {
      setLoading(false);
      return onNeedKey();
    }
    setFromCache(false);
    const endpoint = nextSource === 'netease' ? '/api/163_search' : nextSource === 'qq' ? '/api/qq_music' : '/api/kugou_music';
    const params = nextSource === 'netease' ? { keyword, limit: 30, offset: 0 } : { msg: keyword, num: 30 };
    const response = await apiRequest(endpoint, params);
    setLoading(false);
    if (!response.ok) {
      setResults([]);
      setError(response.message || '搜索失败');
      return;
    }
    const normalized = normalizeSearch(response.data, nextSource).map((item) => ({ ...item, searchKeyword: keyword }));
    await putCachedSearch(searchCacheKey, normalized);
    setResults(await enrich(normalized));
  };

  const playResult = async (item, items) => {
    const detail = await onSelect(item, items);
    if (!detail) return;
    setResults((current) => current.map((track) => trackKey(track) === trackKey(detail) ? { ...track, ...detail } : track));
    setEntityDetail((current) => current ? { ...current, tracks: (current.tracks || []).map((track) => trackKey(track) === trackKey(detail) ? { ...track, ...detail } : track) } : current);
  };

  const openEntity = async (entity, kind) => {
    const cacheKey = `entity:${kind}:${entity.source}:${entity.name.toLocaleLowerCase()}`;
    setEntityDetail({ ...entity, kind, loading: true, error: '' });
    const cached = await getCachedSearch(cacheKey);
    if (cached?.length) {
      setEntityDetail({ ...entity, kind, loading: false, fromCache: true, tracks: await enrich(cached) });
      return;
    }
    if (!hasApiKey) { setEntityDetail(null); onNeedKey(); return; }
    const endpoint = entity.source === 'netease' ? '/api/163_search' : entity.source === 'qq' ? '/api/qq_music' : '/api/kugou_music';
    const params = entity.source === 'netease' ? { keyword: entity.name, limit: 50, offset: 0 } : { msg: entity.name, num: 50 };
    const response = await apiRequest(endpoint, params);
    if (!response.ok) { setEntityDetail({ ...entity, kind, loading: false, error: response.message || '无法获取完整曲目' }); return; }
    const all = normalizeSearch(response.data, entity.source).map((track) => ({ ...track, searchKeyword: entity.name }));
    const name = entity.name.toLocaleLowerCase();
    const matched = all.filter((track) => kind === 'artist' ? String(track.artist).toLocaleLowerCase().split(/\s*[/、]\s*/).includes(name) : String(track.album).toLocaleLowerCase() === name);
    const tracks = matched.length ? matched : all;
    await putCachedSearch(cacheKey, tracks);
    setEntityDetail({ ...entity, kind, loading: false, tracks: await enrich(tracks) });
  };

  useEffect(() => {
    if (active && entityRequest?.requestId) void openEntity(entityRequest.entity, entityRequest.kind);
  }, [active, entityRequest?.requestId]);

  const closeResults = () => { setQuery(''); setResults([]); setSearched(false); setError(''); setFromCache(false); setEntityDetail(null); setTab('all'); };

  const artists = useMemo(() => aggregateEntities(results, 'artist'), [results]);
  const albums = useMemo(() => aggregateEntities(results, 'album'), [results]);
  const entityRows = (items, kind) => <div className="entity-grid">{items.map((item) => {
    const saved = (kind === 'artist' ? savedArtists : savedAlbums).some((entry) => entry.id === item.id);
    const art = artPlaceholder(item, kind === 'artist' ? '人' : '辑');
    return <article className="entity-card" key={item.id}><button className="entity-main" type="button" onClick={() => openEntity(item, kind)}><span className={`entity-art ${kind} ${art.className || ''}`} data-art-label={art['data-art-label']} style={art.style} /><div><strong>{item.name}</strong><small>{kind === 'artist' ? `${item.tracks.length} 首匹配歌曲` : item.artist}</small></div></button><button type="button" className={`entity-save ${saved ? 'saved' : ''}`} aria-label={saved ? '取消收藏' : '收藏到资料库'} onClick={() => (kind === 'artist' ? onSaveArtist : onSaveAlbum)(item)}><Heart size={17} fill={saved ? 'currentColor' : 'none'} /></button></article>;
  })}</div>;

  const trackRows = (items = results) => <div className="results-list">{items.map((item, index) => {
    const isLiked = liked.some((track) => trackKey(track) === trackKey(item));
    return (
      <div className="saved-track-row search-track-row" key={`${item.source}-${item.id}-${index}`}>
        <button className="saved-track-main result-row" onClick={() => playResult(item, items)} disabled={Boolean(activeRequest)}>
          <span className="result-index">{activeRequest === trackKey(item) ? <LoaderCircle className="spin" size={16} /> : String(index + 1).padStart(2, '0')}</span>
          {(() => { const art = artPlaceholder(item); return <span className={`result-art ${art.className || ''}`} data-art-label={art['data-art-label']} style={art.style} />; })()}
          <span className="result-title"><strong>{item.title}</strong><small>{item.artist}</small></span><span className="result-album">{item.album}</span><SourceMark source={item.source} /><span className="result-play"><Play size={14} fill="currentColor" /></span>
        </button>
        <IconButton className={`saved-remove search-favorite ${isLiked ? 'liked' : ''}`} label={isLiked ? `取消喜欢 ${item.title}` : `喜欢 ${item.title}`} onClick={() => onToggleLike(item)}><Heart size={15} fill={isLiked ? 'currentColor' : 'none'} /></IconButton>
      </div>
    );
  })}</div>;

  if (entityDetail) return <section className="search-view entity-detail-view content-enter"><header className="entity-detail-heading"><button className="entity-back" type="button" onClick={() => setEntityDetail(null)}><ArrowLeft size={18} />返回搜索结果</button></header><div className="entity-detail-hero">{(() => { const art = artPlaceholder(entityDetail); return <span className={`entity-detail-art ${entityDetail.kind} ${art.className || ''}`} data-art-label={art['data-art-label']} style={art.style} />; })()}<div><p>{entityDetail.kind === 'artist' ? '歌手' : '专辑'} · {SOURCE_META[entityDetail.source]?.label}</p><h1>{entityDetail.name}</h1><span>{entityDetail.loading ? '正在使用一次调用获取完整曲目…' : entityDetail.error ? entityDetail.error : `${entityDetail.tracks?.length || 0} 首曲目${entityDetail.fromCache ? ' · 本地缓存' : ''}`}</span>{!entityDetail.loading && !entityDetail.error && entityDetail.tracks?.length > 0 && <button className="primary-button play-all-inline" type="button" onClick={() => onPlayAll(entityDetail.tracks)}><Play size={16} />全部播放</button>}</div></div>{entityDetail.loading ? <div className="empty-state"><LoaderCircle className="spin" /><strong>正在获取完整曲目</strong><span>完成后再次打开会直接使用本地缓存。</span></div> : entityDetail.error ? <div className="empty-state error-state"><span className="error-dot">!</span><strong>无法加载详情</strong><span>{entityDetail.error}</span></div> : trackRows(entityDetail.tracks || [])}</section>;

  return (
    <section className="search-view content-enter" aria-hidden={!active}>
      <header className="page-heading"><p>跨平台发现</p><h1>搜索</h1></header>
      <div className="search-topline">
        <form className="search-box" onSubmit={search}>
          <Search size={19} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="歌曲、艺人或专辑" autoFocus={active} />
          <CustomSelect
            className="source-select"
            label="搜索源"
            value={source}
            options={ONLINE_SOURCES.map((value) => [value, SOURCE_META[value].label])}
            onChange={(nextSource) => { setSource(nextSource); setResults([]); setSearched(false); setFromCache(false); }}
          />
        </form>
        <QuotaStatus quota={quota} onConnect={onOpenAccount} />
      </div>
      {!searched && history.length > 0 && <div className="search-history"><div><span>最近搜索</span>{history.slice(0, showAllHistory ? 15 : 5).map((item) => <button type="button" key={`${item.source}:${item.query}`} onClick={() => search(null, false, item)}>{item.query}<small>{SOURCE_META[item.source]?.short}</small></button>)}</div>{history.length > 5 && <button className="text-button" type="button" onClick={() => setShowAllHistory((value) => !value)}>{showAllHistory ? '收起' : '显示更多'}</button>}</div>}
      <div className="search-meta">
        <span>{searched ? `${SOURCE_META[source].label} · ${results.length} 个结果${fromCache ? ' · 本地缓存' : ''}` : '选择音乐源后开始搜索'}</span>
        {searched && !loading && <span className="search-result-actions"><button className="text-button" onClick={() => search(null, true)}>重新搜索</button><button className="search-close" type="button" onClick={closeResults}><X size={14} />关闭结果</button></span>}
      </div>
      {searched && !loading && !error && <div className="search-tabs" role="tablist">{[['all','综合'],['tracks','单曲'],['artists','歌手'],['albums','专辑']].map(([value, label]) => <button type="button" role="tab" aria-selected={tab === value} className={tab === value ? 'active' : ''} key={value} onClick={() => setTab(value)}>{label}</button>)}</div>}
      <div aria-live="polite">
        {loading && <div className="empty-state"><LoaderCircle className="spin" /><strong>正在搜索</strong><span>从 {SOURCE_META[source].label} 获取结果…</span></div>}
        {!loading && error && <div className="empty-state error-state"><span className="error-dot">!</span><strong>无法完成搜索</strong><span>{error}</span></div>}
        {!loading && searched && !error && results.length === 0 && <div className="empty-state"><Music2 /><strong>没有找到结果</strong><span>试试歌曲名、艺人名或更短的关键词。</span></div>}
        {!loading && results.length > 0 && tab === 'tracks' && trackRows()}
        {!loading && results.length > 0 && tab === 'artists' && entityRows(artists, 'artist')}
        {!loading && results.length > 0 && tab === 'albums' && entityRows(albums, 'album')}
        {!loading && results.length > 0 && tab === 'all' && <div className="combined-results"><div className="result-section-title"><h2>单曲</h2><button className="text-button" onClick={() => setTab('tracks')}>查看全部</button></div>{trackRows(results.slice(0, 5))}<div className="result-section-title"><h2>歌手</h2><button className="text-button" onClick={() => setTab('artists')}>查看全部</button></div>{entityRows(artists.slice(0, 6), 'artist')}<div className="result-section-title"><h2>专辑</h2><button className="text-button" onClick={() => setTab('albums')}>查看全部</button></div>{entityRows(albums.slice(0, 6), 'album')}</div>}
      </div>
    </section>
  );
}

function LibraryView({ onImport, onOpenLikes, onOpenRecent, current, likedCount, avatar, userName, stats }) {
  const fileInput = useRef(null);
  const [now, setNow] = useState(new Date());
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(timer); }, []);
  return (
    <section className="library-view content-enter">
      <header className="library-toolbar"><p>{systemDayLabel(now)} · {now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</p></header>
      <div className="section-title"><div className="section-title-copy"><div><h2>你的音乐</h2><p>本地收藏与最近播放</p></div><ProfileMenu avatar={avatar} userName={userName} stats={stats} /></div></div>
      <input ref={fileInput} onChange={onImport} className="sr-only" type="file" accept="audio/*" multiple />
      <div className="collection-grid">
        <button className="collection-card favorite" onClick={onOpenLikes}><div className="collection-art"><Heart size={38} fill="white" /></div><strong>喜欢的音乐</strong><small>{likedCount ? `${likedCount} 首歌曲` : '你的收藏'}</small></button>
        <button className="collection-card" onClick={onOpenRecent}><div className="collection-art recent" style={{ backgroundImage: `url(${current.cover})` }} /><strong>最近播放</strong><small>{current.title}</small></button>
        <button className="collection-card dashed" onClick={() => fileInput.current?.click()}><div className="collection-art import-art"><Upload size={30} /></div><strong>导入本地音乐</strong><small>MP3、FLAC、WAV 等</small></button>
      </div>
    </section>
  );
}

function RecentView({ tracks, onPlay, onPlayAll, onBack, activeRequest }) {
  return (
    <section className="liked-view content-enter">
      <header className="page-heading recent-heading">
        <button className="entity-back recent-back" type="button" onClick={onBack}><ArrowLeft size={18} />返回首页</button>
        <div className="liked-symbol recent-symbol"><Clock3 size={34} /></div>
        <div><p>你的资料库</p><h1>最近播放</h1><span>{tracks.length} 首歌曲</span></div>
        <button className="primary-button" type="button" disabled={!tracks.length} onClick={() => onPlayAll(tracks)}><Play size={16} />全部播放</button>
      </header>
      <TrackRows tracks={tracks} onPlay={onPlay} activeRequest={activeRequest} emptyTitle="还没有最近播放" emptyCopy="播放过的歌曲会出现在这里。" />
    </section>
  );
}

function LikesView({ liked, onPlay, onPlayAll, onRemove, activeRequest }) {
  return (
    <section className="liked-view content-enter">
      <header className="page-heading liked-heading">
        <div className="liked-symbol"><Heart size={34} fill="currentColor" /></div>
        <div><p>你的资料库</p><h1>喜欢的音乐</h1><span>{liked.length} 首歌曲</span></div>
        <button className="primary-button" type="button" disabled={!liked.length} onClick={() => onPlayAll(liked)}><Play size={16} />全部播放</button>
      </header>
      <TrackRows tracks={liked} onPlay={onPlay} onRemove={onRemove} activeRequest={activeRequest} emptyTitle="还没有喜欢的音乐" emptyCopy="在播放栏点击爱心，歌曲会出现在这里。" />
    </section>
  );
}

function EntityLibraryView({ title, subtitle, items, kind, onToggle, onOpen }) {
  return <section className="entity-library content-enter"><header className="page-heading"><p>你的资料库</p><h1>{title}</h1><span>{items.length} 个收藏</span></header>{items.length ? <div className="library-entity-grid">{items.map((item) => <article className="library-entity-card" key={item.id}><button className="library-entity-main" type="button" onClick={() => onOpen(item, kind)}><span className={`library-entity-art ${kind}`} style={{ backgroundImage: `url(${item.cover || rainIcon})` }} /><span><strong>{item.name}</strong><small>{item.artist || `${item.tracks?.length || 0} 首歌曲`}</small></span></button><button className="entity-save saved" type="button" onClick={() => onToggle(item)} aria-label="取消收藏"><Heart size={17} fill="currentColor" /></button></article>)}</div> : <div className="empty-state"><Album /><strong>还没有收藏{title}</strong><span>{subtitle}</span></div>}</section>;
}

function LocalMusicView({ tracks, onImport, onPlay, onPlayAll, activeRequest }) {
  const fileRef = useRef(null);
  const [query, setQuery] = useState('');
  const [artist, setArtist] = useState('all');
  const [album, setAlbum] = useState('all');
  const artists = useMemo(() => [...new Set(tracks.map((track) => track.artist).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN')), [tracks]);
  const albums = useMemo(() => [...new Set(tracks.map((track) => track.album).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN')), [tracks]);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return tracks.filter((track) => (artist === 'all' || track.artist === artist) && (album === 'all' || track.album === album) && (!keyword || [track.title, track.artist, track.album].some((value) => String(value || '').toLocaleLowerCase().includes(keyword))));
  }, [tracks, query, artist, album]);
  return <section className="local-music-view content-enter">
    <header className="page-heading collection-page-heading"><div><p>这台 Windows 设备</p><h1>本地歌曲</h1><span>{filtered.length === tracks.length ? `${tracks.length} 首歌曲` : `${filtered.length} / ${tracks.length} 首歌曲`}</span><button className="primary-button play-all-inline" type="button" disabled={!tracks.length} onClick={() => onPlayAll(tracks)}><Play size={16} />全部播放</button></div><button className="primary-button" type="button" onClick={() => fileRef.current?.click()}><Upload size={16} />添加文件</button></header>
    <input ref={fileRef} className="sr-only" type="file" accept="audio/*" multiple onChange={onImport} />
    <div className="local-tools"><label className="local-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索歌曲、歌手或专辑" /></label><CustomSelect label="歌手筛选" value={artist} onChange={setArtist} options={[["all", "全部歌手"], ...artists.map((value) => [value, value])]} /><CustomSelect label="专辑筛选" value={album} onChange={setAlbum} options={[["all", "全部专辑"], ...albums.map((value) => [value, value])]} /></div>
    <TrackRows tracks={filtered} onPlay={onPlay} activeRequest={activeRequest} emptyTitle={tracks.length ? '没有匹配的本地歌曲' : '还没有本地歌曲'} emptyCopy={tracks.length ? '试试其他关键词或清除筛选条件。' : '点击“添加文件”导入 MP3、FLAC、WAV 等音频。'} />
  </section>;
}

function PlaylistDetailView({ playlist, onBack, onPlay, onPlayAll, activeRequest }) {
  return (
    <section className="playlists-view playlist-detail-view content-enter">
      <header className="entity-detail-heading">
        <button className="entity-back" type="button" onClick={onBack}><ArrowLeft size={18} />返回我的歌单</button>
      </header>
      <div className="entity-detail-hero playlist-detail-hero">
        <span className="playlist-detail-cover" style={{ backgroundImage: `url(${playlist.cover || rainIcon})` }} />
        <div><p>歌单 · {SOURCE_META[playlist.source]?.label}</p><h1>{playlist.title}</h1><span>{playlist.tracks?.length || 0} 首歌曲</span>{playlist.tracks?.length > 0 && <button className="primary-button play-all-inline" type="button" onClick={() => onPlayAll(playlist.tracks)}><Play size={16} />全部播放</button>}</div>
      </div>
      <TrackRows tracks={playlist.tracks || []} onPlay={onPlay} activeRequest={activeRequest} emptyTitle="链接已保存" emptyCopy="当前 API 文档没有这个平台的歌单详情接口。" />
    </section>
  );
}

function PlaylistsView({ playlists, onAdd, onPlay, onPlayAll, onRemove, activeRequest, loading }) {
  const [url, setUrl] = useState('');
  const [selectedKey, setSelectedKey] = useState('');
  const selected = playlists.find((playlist) => `${playlist.source}:${playlist.id}:${playlist.url}` === selectedKey);
  const submit = async (event) => { event.preventDefault(); if (await onAdd(url)) setUrl(''); };
  if (selected) return <PlaylistDetailView playlist={selected} onBack={() => setSelectedKey('')} onPlay={onPlay} onPlayAll={onPlayAll} activeRequest={activeRequest} />;
  return (
    <section className="playlists-view content-enter">
      <header className="page-heading"><p>跨平台收藏</p><h1>我的歌单</h1><span>{playlists.length} 个歌单</span></header>
      <form className="playlist-import" onSubmit={submit}><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="粘贴网易云、QQ 音乐或酷狗歌单分享长链接" /><button className="primary-button" disabled={!url.trim() || loading} type="submit">{loading ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}导入歌单</button></form>
      <p className="playlist-note">网易云歌单使用文档提供的单次接口补全全部歌曲；QQ 音乐与酷狗会先保存分享链接，等待 API 提供歌单详情接口。</p>
      <div className="playlist-list">
        {playlists.map((playlist) => (
          <article className="playlist-card" key={`${playlist.source}:${playlist.id}:${playlist.url}`}>
            <button type="button" className="playlist-summary" onClick={() => setSelectedKey(`${playlist.source}:${playlist.id}:${playlist.url}`)}><span className="playlist-cover" style={{ backgroundImage: `url(${playlist.cover || rainIcon})` }} /><span><strong>{playlist.title}</strong><small>{SOURCE_META[playlist.source]?.label} · {playlist.tracks?.length || 0} 首歌曲</small></span></button>
            <IconButton className="saved-remove playlist-remove" label={`删除歌单 ${playlist.title}`} onClick={() => onRemove(playlist)}><X size={15} /></IconButton>
          </article>
        ))}
      </div>
    </section>
  );
}

function LyricsView({ track, currentTime, duration, playing, onToggle, onPrevious, onNext, onClose, onSeek, quality, onQuality, qualityLoading, playMode, visible, liked, onToggleLike, onCyclePlayMode }) {
  const lyrics = useMemo(() => parseLyrics(track.lyricRaw, track.translationRaw, track.romanRaw, track.wordLyricRaw), [track.lyricRaw, track.translationRaw, track.romanRaw, track.wordLyricRaw]);
  const activeIndex = lyrics.findLastIndex((line) => line.time <= currentTime + 0.04);
  const scrollRef = useRef(null);
  const manualScrollUntilRef = useRef(0);
  const [showTranslation, setShowTranslation] = useState(true);
  const [showRoman, setShowRoman] = useState(true);
  const hasTranslation = lyrics.some((line) => line.translation);
  const hasRoman = lyrics.some((line) => line.roman);
  const onSeekRef = useRef(onSeek);
  onSeekRef.current = onSeek;
  const lyricList = useMemo(() => lyrics.map((line, index) => (
    <button key={`${line.time}-${index}`} className="lyric-line" data-active={index === activeIndex} onClick={() => onSeekRef.current(line.time)}>
      {showRoman && line.roman && <span className="roman">{line.roman}</span>}
      <strong aria-label={line.text}>{line.text}</strong>
      {showTranslation && line.translation && <span>{line.translation}</span>}
    </button>
  )), [lyrics, activeIndex, showTranslation, showRoman]);

  useEffect(() => {
    if (Date.now() < manualScrollUntilRef.current) return;
    const scroller = scrollRef.current;
    const active = scroller?.querySelector('[data-active="true"]');
    if (active && scroller) {
      const top = active.offsetTop - (scroller.clientHeight - active.offsetHeight) / 2;
      scroller.scrollTo({ top: Math.max(0, top), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  }, [activeIndex]);

  return (
    <section className="lyrics-view" data-open={visible}>
      <div className="lyrics-toolbar">
        <span className="lyrics-drag-zone" aria-hidden="true" />
        <div className="lyrics-options">
          <button className={`lyric-toggle ${showTranslation ? 'active' : ''}`} type="button" disabled={!hasTranslation} aria-pressed={showTranslation} onClick={() => setShowTranslation((state) => !state)}>翻译</button>
          <button className={`lyric-toggle ${showRoman ? 'active' : ''}`} type="button" disabled={!hasRoman} aria-pressed={showRoman} onClick={() => setShowRoman((state) => !state)}>音标</button>
          <CustomSelect className="quality-select" label="音质" icon={<SlidersHorizontal size={15} />} value={quality} onChange={onQuality} disabled={qualityLoading || track.empty} options={qualityOptionsForTrack(track)} />
        </div>
      </div>
      <div className="lyrics-layout">
        <div className="art-column">
          <div className="album-frame"><IconButton className="lyrics-close" label="收起歌词" onClick={onClose}><X size={19} /></IconButton><img src={track.cover || rainIcon} alt={`${track.album} 封面`} /></div>
          <div className="track-heading"><div><h2>{track.title}</h2><p>{track.artist} · {track.album}</p></div><div className="track-actions"><div className="track-action-buttons"><IconButton label="更多"><Ellipsis /></IconButton></div><span className="play-mode-status">{PLAY_MODE_META[playMode].label}</span></div></div>
          <div className="lyrics-controls">
            <div className="timeline">
              <div className="timeline-track"><span style={{ transform: `scaleX(${duration ? currentTime / duration : 0})` }} /></div>
              <input aria-label="播放进度" type="range" min="0" max={duration || 1} step="0.1" value={Math.min(currentTime, duration || 1)} onChange={(event) => onSeek(Number(event.target.value))} />
              <span className="timeline-thumb" style={{ left: `${Math.max(0, Math.min(100, duration ? (currentTime / duration) * 100 : 0))}%` }} />
              <small>{formatTime(currentTime)}</small><small>-{formatTime(Math.max(0, duration - currentTime))}</small>
            </div>
            <div className="main-controls"><IconButton className={`heart-button ${liked ? 'liked' : ''}`} label={liked ? '取消喜欢' : '加入喜欢的音乐'} aria-pressed={liked} onClick={onToggleLike}><Heart size={19} fill={liked ? 'currentColor' : 'none'} /></IconButton><IconButton label="上一首" onClick={onPrevious}><SkipBack size={26} fill="currentColor" /></IconButton><button className="large-play" onClick={onToggle} aria-label={playing ? '暂停' : '播放'}>{playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button><IconButton label="下一首" onClick={onNext}><SkipForward size={26} fill="currentColor" /></IconButton><IconButton className="mode-active" label={PLAY_MODE_META[playMode].label} aria-pressed="true" onClick={onCyclePlayMode}>{playMode === 'repeat' ? <Repeat1 size={19} /> : playMode === 'shuffle' ? <Shuffle size={19} /> : <ListOrdered size={19} />}</IconButton></div>
          </div>
        </div>
        <div className="lyric-scroll" ref={scrollRef} tabIndex="0" aria-label="同步歌词" onWheel={() => { manualScrollUntilRef.current = Date.now() + 5000; }} onPointerDown={() => { manualScrollUntilRef.current = Date.now() + 5000; }}>
          <div className="lyric-spacer" />
          {lyrics.length ? lyricList : <div className="no-lyrics"><Music2 /><strong>{track.empty ? '未播放歌曲' : '暂无歌词'}</strong><span>{track.empty ? '选择一首歌曲后，这里会显示同步歌词。' : '这首歌曲没有返回可用的歌词。'}</span></div>}
          <div className="lyric-spacer" />
        </div>
      </div>
    </section>
  );
}

function QueueMenu({ tracks, onPlay }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.key === 'Escape' || (event.type === 'pointerdown' && !rootRef.current?.contains(event.target))) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <div className="recent-menu-root" ref={rootRef}>
      <IconButton className={open ? 'active' : ''} label="当前列表" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((state) => !state)}><ListMusic size={18} /></IconButton>
      <div className="recent-popover" data-open={open} role="dialog" aria-label="当前列表" aria-hidden={!open}>
          <div className="recent-popover-title"><span>当前列表</span><small>{tracks.length} 首</small></div>
          <div className="recent-popover-list">
            {tracks.length ? tracks.map((item) => (
              <button key={trackKey(item)} type="button" tabIndex={open ? 0 : -1} onClick={() => { onPlay(item); setOpen(false); }}>
                <span className="recent-art" style={{ backgroundImage: `url(${item.cover || rainIcon})` }} />
                <span><strong>{item.title}</strong><small>{item.artist}</small></span>
                <Play size={13} fill="currentColor" />
              </button>
            )) : <div className="recent-empty">当前列表还没有歌曲</div>}
          </div>
      </div>
    </div>
  );
}

function MiniPlayer({ track, playing, currentTime, duration, onToggle, onPrevious, onNext, onOpen, onSeek, volume, onVolume, liked, onToggleLike, queue, onPlayQueue, playMode, onCyclePlayMode }) {
  return (
    <footer className="mini-player">
      <button className="mini-track" onClick={onOpen}><span className="mini-art"><img src={track.cover || rainIcon} alt="" /></span><span><strong>{track.title}</strong><small>{track.artist}</small></span></button>
      <div className="mini-center">
        <div className="mini-controls"><IconButton className={`heart-button ${liked ? 'liked' : ''}`} label={liked ? '取消喜欢' : '加入喜欢的音乐'} aria-pressed={liked} onClick={onToggleLike}><Heart size={18} fill={liked ? 'currentColor' : 'none'} /></IconButton><IconButton label="上一首" onClick={onPrevious}><SkipBack size={17} fill="currentColor" /></IconButton><button className="mini-play" onClick={onToggle} aria-label={playing ? '暂停' : '播放'}>{playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button><IconButton label="下一首" onClick={onNext}><SkipForward size={17} fill="currentColor" /></IconButton><IconButton className="mode-active" label={PLAY_MODE_META[playMode].label} aria-pressed="true" onClick={onCyclePlayMode}>{playMode === 'repeat' ? <Repeat1 size={18} /> : playMode === 'shuffle' ? <Shuffle size={18} /> : <ListOrdered size={18} />}</IconButton></div>
        <div className="mini-progress"><span>{formatTime(currentTime)}</span><div className="mini-scrubber"><div><i style={{ transform: `scaleX(${duration ? currentTime / duration : 0})` }} /></div><input aria-label="播放进度" type="range" min="0" max={duration || 1} step="0.1" value={Math.min(currentTime, duration || 1)} disabled={track.empty || !duration} onChange={(event) => onSeek(Number(event.target.value))} /><span className="scrubber-thumb" style={{ left: `${Math.max(0, Math.min(100, duration ? (currentTime / duration) * 100 : 0))}%` }} /></div><span>-{formatTime(Math.max(0, duration - currentTime))}</span></div>
      </div>
      <div className="mini-actions"><QueueMenu tracks={queue} onPlay={onPlayQueue} /><Volume2 size={17} /><input aria-label="音量" type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => onVolume(Number(event.target.value))} /></div>
    </footer>
  );
}

function App() {
  const [view, setView] = useState('library');
  const [lyricsMounted, setLyricsMounted] = useState(false);
  const [lyricsVisible, setLyricsVisible] = useState(false);
  const [current, setCurrent] = useState(EMPTY_TRACK);
  const [queue, setQueue] = useState([]);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [volumeFeedback, setVolumeFeedback] = useState(null);
  const [shortcuts, setShortcuts] = useState(loadKeyboardShortcuts);
  const [defaultQualities, setDefaultQualities] = useState(loadDefaultQualities);
  const [quality, setQuality] = useState('none');
  const [playMode, setPlayMode] = useState(() => {
    const saved = localStorage.getItem('rain_play_mode');
    return PLAY_MODE_META[saved] ? saved : 'sequence';
  });
  const [qualityLoading, setQualityLoading] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [closeAction, setCloseAction] = useState('ask');
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [activeRequest, setActiveRequest] = useState('');
  const [toast, setToast] = useState(null);
  const [liked, setLiked] = useState(() => loadCollection('aurora_liked_tracks'));
  const [recent, setRecent] = useState(() => loadCollection('aurora_recent_tracks'));
  const [savedArtists, setSavedArtists] = useState(() => loadCollection('rain_saved_artists'));
  const [savedAlbums, setSavedAlbums] = useState(() => loadCollection('rain_saved_albums'));
  const [entityRequest, setEntityRequest] = useState(null);
  const [localTracks, setLocalTracks] = useState(() => loadCollection('rain_local_tracks'));
  const [playlists, setPlaylists] = useState(() => loadCollection('rain_playlists'));
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [avatar, setAvatar] = useState(() => localStorage.getItem('rain_profile_avatar') || '');
  const [listeningStats, setListeningStats] = useState(loadListeningStats);
  const [quota, setQuota] = useState({ connected: false, state: 'checking' });
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateDownloading, setUpdateDownloading] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const audioRef = useRef(null);
  const loadedAudioUrlRef = useRef('');
  const pendingSeekRef = useRef(null);
  const lyricCloseTimer = useRef(null);
  const volumeFeedbackTimer = useRef(null);
  const listeningRef = useRef({ lastTime: 0, pending: 0, track: '' });
  const palette = useEdgePalette(current.cover || rainIcon);

  const rootStyle = {
    '--edge-top': palette[0], '--edge-right': palette[1], '--edge-bottom': palette[2], '--edge-left': palette[3],
  };

  useEffect(() => {
    getSettings().then((settings) => {
      setHasApiKey(settings.hasApiKey);
      setCloseAction(CLOSE_ACTION_OPTIONS.some(([value]) => value === settings.closeAction) ? settings.closeAction : 'ask');
    });
    getQuotaStatus().then(setQuota);
    const removeQuotaListener = onQuotaUpdated(setQuota);
    const removeCloseListener = onCloseRequested(() => setCloseDialogOpen(true));
    return () => {
      removeQuotaListener();
      removeCloseListener();
    };
  }, []);
  useEffect(() => {
    void checkForUpdates().then((result) => {
      if (result.ok && result.update) {
        setUpdateInfo(result.update);
        setUpdateDialogOpen(true);
      }
    });
    return onUpdateProgress(({ percent }) => setUpdateProgress(percent));
  }, []);
  useEffect(() => {
    const savedTracks = [...liked, ...recent];
    if (!savedTracks.length) return;
    void hydrateCachedTracks(savedTracks).then((cached) => {
      const enrich = (tracks) => tracks.map((track) => {
        const saved = cached[`${track.source}:${track.id}`];
        return saved ? { ...track, ...saved } : track;
      });
      setLiked(enrich);
      setRecent(enrich);
    });
  }, []);
  useEffect(() => {
    const staleTracks = localTracks.filter((track) => track.filePath && track.metadataVersion !== 2);
    if (!staleTracks.length) return;
    let cancelled = false;
    void Promise.all(staleTracks.map(async (track) => {
      const result = await readLocalMetadata(track.filePath);
      return result?.ok ? withLocalMetadata(track, result.metadata) : track;
    })).then((updated) => {
      if (cancelled) return;
      const byId = new Map(updated.map((track) => [track.id, track]));
      setLocalTracks((tracks) => tracks.map((track) => byId.get(track.id) || track));
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { localStorage.setItem('aurora_liked_tracks', JSON.stringify(liked.map(persistableTrack))); }, [liked]);
  useEffect(() => { localStorage.setItem('aurora_recent_tracks', JSON.stringify(recent.map(persistableTrack))); }, [recent]);
  useEffect(() => { localStorage.setItem('rain_play_mode', playMode); }, [playMode]);
  useEffect(() => { saveCollection('rain_saved_artists', savedArtists.map((item) => ({ ...item, tracks: (item.tracks || []).map(persistableTrack) }))); }, [savedArtists]);
  useEffect(() => { saveCollection('rain_saved_albums', savedAlbums.map((item) => ({ ...item, tracks: (item.tracks || []).map(persistableTrack) }))); }, [savedAlbums]);
  useEffect(() => { saveCollection('rain_local_tracks', localTracks.map(persistableTrack)); }, [localTracks]);
  useEffect(() => { saveCollection('rain_playlists', playlists.map((playlist) => ({ ...playlist, tracks: (playlist.tracks || []).map(persistableTrack) }))); }, [playlists]);
  useEffect(() => { localStorage.setItem('rain_profile_avatar', avatar); }, [avatar]);
  useEffect(() => { localStorage.setItem('rain_listening_stats_v1', JSON.stringify(listeningStats)); }, [listeningStats]);
  useEffect(() => { localStorage.setItem('rain_keyboard_shortcuts_v1', JSON.stringify(shortcuts)); }, [shortcuts]);
  useEffect(() => { localStorage.setItem('rain_default_qualities_v1', JSON.stringify(defaultQualities)); }, [defaultQualities]);
  useEffect(() => () => { if (volumeFeedbackTimer.current) clearTimeout(volumeFeedbackTimer.current); }, []);
  useEffect(() => {
    if (!current || current.empty) return;
    setRecent((tracks) => [current, ...tracks.filter((item) => trackKey(item) !== trackKey(current))].slice(0, 30));
    setLiked((tracks) => tracks.some((item) => trackKey(item) === trackKey(current)) ? tracks.map((item) => trackKey(item) === trackKey(current) ? { ...item, ...current } : item) : tracks);
  }, [current]);
  useEffect(() => {
    if (!current || current.empty) return;
    const key = trackKey(current);
    if (listeningRef.current.counted === key) return;
    listeningRef.current = { ...listeningRef.current, counted: key, track: key, lastTime: 0 };
    const day = localDateKey();
    setListeningStats((stats) => ({ ...stats, totalTracks: stats.totalTracks + 1, days: { ...stats.days, [day]: { ...(stats.days[day] || { seconds: 0, tracks: 0 }), tracks: (stats.days[day]?.tracks || 0) + 1 } } }));
  }, [current]);
  useEffect(() => {
    if (!toast) return undefined;
    const timeout = setTimeout(() => setToast(null), 3400);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [lyricsMounted]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || current.empty) return;
    if (loadedAudioUrlRef.current === (current.audioUrl || '')) return;
    loadedAudioUrlRef.current = current.audioUrl || '';
    audio.src = current.audioUrl || '';
    audio.load();
    if (playing && current.audioUrl) audio.play().catch(() => setPlaying(false));
  }, [current.audioUrl, current.empty]);
  useEffect(() => {
    if (!playing || current.empty) return undefined;
    let frame;
    let previous = 0;
    const update = (timestamp) => {
      if (timestamp - previous >= 45 && audioRef.current) {
        previous = timestamp;
        setCurrentTime(audioRef.current.currentTime);
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [playing, current.empty]);
  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume]);

  const notify = (message, type = 'neutral') => setToast({ message, type });
  const showVolumeFeedback = (nextVolume) => {
    if (volumeFeedbackTimer.current) clearTimeout(volumeFeedbackTimer.current);
    setVolumeFeedback(Math.round(nextVolume * 100));
    volumeFeedbackTimer.current = setTimeout(() => setVolumeFeedback(null), 1200);
  };
  const openLyrics = () => {
    if (lyricCloseTimer.current) clearTimeout(lyricCloseTimer.current);
    setLyricsMounted(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setLyricsVisible(true)));
  };
  const closeLyrics = () => {
    setLyricsVisible(false);
    lyricCloseTimer.current = setTimeout(() => setLyricsMounted(false), 230);
  };
  const navigate = (nextView) => { setView(nextView); closeLyrics(); };
  const changeCloseAction = async (nextAction) => {
    const result = await saveCloseAction(nextAction);
    if (!result?.ok) return notify('无法保存关闭窗口设置', 'error');
    setCloseAction(result.closeAction || nextAction);
    notify(`关闭窗口时：${CLOSE_ACTION_OPTIONS.find(([value]) => value === nextAction)?.[1] || nextAction}`, 'success');
  };
  const changeDefaultQuality = (source, nextQuality) => {
    if (!ONLINE_SOURCES.includes(source) || !QUALITY_OPTIONS[source].some(([value]) => value === nextQuality)) return;
    setDefaultQualities((currentQualities) => ({ ...currentQualities, [source]: nextQuality }));
  };
  const chooseCloseAction = async (action, remember) => {
    setCloseDialogOpen(false);
    const result = await resolveClose({ action, remember });
    if (remember && result?.ok) setCloseAction(result.closeAction || action);
  };
  const cancelClose = () => {
    setCloseDialogOpen(false);
    void resolveClose({ action: 'cancel', remember: false });
  };
  const changePlayMode = (mode) => {
    if (!PLAY_MODE_META[mode]) return;
    setPlayMode(mode);
    notify(PLAY_MODE_META[mode].toast, 'success');
  };
  const cyclePlayMode = () => {
    const order = ['sequence', 'shuffle', 'repeat'];
    const next = order[(order.indexOf(playMode) + 1) % order.length];
    changePlayMode(next);
  };
  const changeShortcut = (action, candidate) => {
    if (!DEFAULT_SHORTCUTS[action] || !candidate?.code) return { ok: false, message: '没有识别到有效按键，请重新输入' };
    if (candidate.alt && candidate.code === 'F4') return { ok: false, message: 'Alt + F4 是 Windows 关闭窗口快捷键，不能覆盖' };
    const conflict = Object.entries(shortcuts).find(([otherAction, shortcut]) => otherAction !== action && shortcutIdentity(shortcut) === shortcutIdentity(candidate));
    if (conflict) {
      const conflictLabel = SHORTCUT_ACTIONS.find(([otherAction]) => otherAction === conflict[0])?.[1] || '其他操作';
      return { ok: false, message: `这个键位已用于“${conflictLabel}”` };
    }
    setShortcuts((current) => ({ ...current, [action]: candidate }));
    return { ok: true };
  };
  const resetShortcuts = () => setShortcuts(Object.fromEntries(Object.entries(DEFAULT_SHORTCUTS).map(([action, shortcut]) => [action, { ...shortcut }])));
  const openAccount = async () => {
    await openQuotaLogin();
    notify('请在打开的 API 窗口中登录，额度会自动同步');
  };

  const checkForAppUpdate = async () => {
    setUpdateChecking(true);
    const result = await checkForUpdates();
    setUpdateChecking(false);
    if (!result.ok) return notify(result.message || '检查更新失败', 'error');
    if (result.update) {
      setUpdateInfo(result.update);
      setUpdateDialogOpen(true);
      return;
    }
    notify('当前已经是最新版本', 'success');
  };

  const handleUpdateNow = () => {
    window.open('https://github.com/kkspectrekk-rgb/Rian/releases/latest', '_blank', 'noopener,noreferrer');
    notify('已打开下载页，请下载安装版客户端');
  };

  const resolveTrack = async (item, nextQuality = quality) => {
    const mediaKey = cacheTrackKey(item, nextQuality);
    const cached = await getCachedTrack(mediaKey);
    const cachedAudioReady = cached?.audioUrl?.startsWith('rain-cache:') || (cached?.audioUrl && Date.now() - (cached.cachedAt || 0) < 6 * 60 * 60 * 1000);
    if (cachedAudioReady) {
      return { ...item, ...cached, quality: nextQuality, cover: await makeCoverReadable(cached.cover || item.cover) };
    }
    const endpoint = item.source === 'netease' ? '/api/163_music' : item.source === 'qq' ? '/api/qq_music' : '/api/kugou_music';
    let params;
    if (item.source === 'netease') params = { id: item.id, level: nextQuality, type: 'json' };
    else if (item.source === 'qq') params = item.mid ? { mid: item.mid, size: nextQuality } : { msg: item.searchKeyword, n: item.n, size: nextQuality };
    else params = { id: item.id, size: nextQuality };
    const detailResponse = await apiRequest(endpoint, params);
    if (!detailResponse.ok) throw new Error(detailResponse.message || '无法解析歌曲');
    let detail = normalizeDetail(detailResponse.data, item);
    if (item.source === 'netease') {
      const lyricResponse = await apiRequest('/api/163_lyric', { id: item.id });
      if (lyricResponse.ok) detail = { ...detail, ...extractLyricPayload(lyricResponse.data) };
    }
    detail.cover = await makeCoverReadable(detail.cover);
    detail.quality = nextQuality;
    await putCachedTrack(mediaKey, detail);
    if (/^https?:/i.test(detail.audioUrl || '')) {
      void cacheAudio(mediaKey, detail.audioUrl).then(async (result) => {
        if (result?.ok) await putCachedTrack(mediaKey, { ...detail, audioUrl: result.url, cachedAudio: true });
      }).catch(() => {});
    }
    return detail;
  };

  const selectSearchResult = async (item, results) => {
    setActiveRequest(trackKey(item));
    try {
      const defaultQuality = defaultQualities[item.source] || DEFAULT_QUALITIES[item.source] || 'flac';
      const detail = await resolveTrack(item, defaultQuality);
      setQueue(results);
      setCurrent(detail);
      setQuality(defaultQuality);
      setCurrentTime(0);
      pendingSeekRef.current = 0;
      setDuration(detail.duration > 10000 ? detail.duration / 1000 : detail.duration || 0);
      setPlaying(true);
      notify(`正在播放 · ${detail.title}`, 'success');
      return detail;
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setActiveRequest('');
    }
  };

  const playSavedTrack = async (item) => {
    setActiveRequest(trackKey(item));
    try {
      if (item.source === 'local') {
        if (!/^(blob:|file:)/i.test(item.audioUrl || '')) throw new Error('本地文件已失效，请重新导入这首歌曲');
        setCurrent(item);
        setQueue([item]);
        setQuality('local');
        setCurrentTime(0);
        pendingSeekRef.current = 0;
        setDuration(item.duration || 0);
        setPlaying(true);
      } else {
        const nextQuality = item.quality || defaultQualities[item.source] || DEFAULT_QUALITIES[item.source] || 'flac';
        const detail = await resolveTrack(item, nextQuality);
        setCurrent(detail);
        setQueue([item]);
        setQuality(nextQuality);
        setCurrentTime(0);
        pendingSeekRef.current = 0;
        setDuration(detail.duration > 10000 ? detail.duration / 1000 : detail.duration || 0);
        setPlaying(true);
      }
      notify(`正在播放 · ${item.title}`, 'success');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setActiveRequest('');
    }
  };

  const playQueueItem = async (item) => {
    if (!item) return;
    setActiveRequest(trackKey(item));
    try {
      if (item.source === 'local' || item.audioUrl) {
        setCurrent(item);
        setQuality(item.source === 'local' ? 'local' : (item.quality || quality));
        setCurrentTime(0);
        pendingSeekRef.current = 0;
        setDuration(item.duration || 0);
        setPlaying(true);
      } else {
        const nextQuality = item.quality || defaultQualities[item.source] || DEFAULT_QUALITIES[item.source] || 'flac';
        const detail = await resolveTrack(item, nextQuality);
        setCurrent(detail);
        setQuality(nextQuality);
        setCurrentTime(0);
        pendingSeekRef.current = 0;
        setDuration(detail.duration > 10000 ? detail.duration / 1000 : detail.duration || 0);
        setPlaying(true);
      }
      notify(`正在播放 · ${item.title}`, 'success');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setActiveRequest('');
    }
  };

  const playAll = async (tracks) => {
    const items = (tracks || []).filter((item) => item && !item.empty);
    if (!items.length) return notify('列表中没有歌曲');
    setPlayMode('sequence');
    setQueue(items);
    const first = items[0];
    setActiveRequest(trackKey(first));
    try {
      if (first.source === 'local' || first.audioUrl) {
        setCurrent(first);
        setQuality(first.source === 'local' ? 'local' : (first.quality || quality));
        setCurrentTime(0);
        pendingSeekRef.current = 0;
        setDuration(first.duration || 0);
        setPlaying(true);
      } else {
        const nextQuality = first.quality || defaultQualities[first.source] || DEFAULT_QUALITIES[first.source] || 'flac';
        const detail = await resolveTrack(first, nextQuality);
        setCurrent(detail);
        setQuality(nextQuality);
        setCurrentTime(0);
        pendingSeekRef.current = 0;
        setDuration(detail.duration > 10000 ? detail.duration / 1000 : detail.duration || 0);
        setPlaying(true);
      }
      notify(`全部播放 · ${items.length} 首`, 'success');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setActiveRequest('');
    }
  };

  const toggleLike = (item = current) => {
    if (item.empty) return notify('请先播放一首歌曲');
    const key = trackKey(item);
    const isLiked = liked.some((track) => trackKey(track) === key);
    setLiked((tracks) => isLiked ? tracks.filter((track) => trackKey(track) !== key) : [item, ...tracks]);
    notify(isLiked ? '已从喜欢的音乐中移除' : `已加入喜欢的音乐 · ${item.title}`, isLiked ? 'neutral' : 'success');
  };

  const changeQuality = async (nextQuality) => {
    if (current.source === 'local' || current.empty) { setQuality(nextQuality); return; }
    setQualityLoading(true);
    try {
      const previousTime = currentTime;
      const updated = await resolveTrack(current, nextQuality);
      pendingSeekRef.current = previousTime;
      setCurrent(updated);
      setQuality(nextQuality);
      setCurrentTime(previousTime);
      notify(`已切换至 ${QUALITY_OPTIONS[current.source].find(([value]) => value === nextQuality)?.[1] || nextQuality}`, 'success');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setQualityLoading(false);
    }
  };

  const togglePlay = () => {
    const next = !playing;
    if (current.empty) return notify('请先选择一首歌曲');
    if (!current.audioUrl) return notify('当前歌曲没有可用的播放地址', 'error');
    setPlaying(next);
    if (audioRef.current) {
      if (next) audioRef.current.play().catch(() => { setPlaying(false); notify('无法开始播放，请尝试其他音质', 'error'); });
      else audioRef.current.pause();
    }
  };

  const seek = (time) => {
    const audio = audioRef.current;
    const availableDuration = Number.isFinite(audio?.duration) && audio.duration > 0 ? audio.duration : duration;
    const target = Math.max(0, Math.min(Number(time) || 0, availableDuration || Number(time) || 0));
    setCurrentTime(target);
    if (!current.empty && audio) {
      if (audio.readyState >= 1) {
        pendingSeekRef.current = null;
        try { audio.currentTime = target; } catch {}
      } else {
        pendingSeekRef.current = target;
      }
    }
  };

  const importLocal = async (event) => {
    const files = [...event.target.files];
    event.target.value = '';
    if (!files.length) return;
    const items = await Promise.all(files.map(async (file, index) => {
      const filePath = getLocalFilePath(file);
      const durableUrl = filePath ? `file:///${filePath.replaceAll('\\', '/').replaceAll('#', '%23')}` : URL.createObjectURL(file);
      const baseTrack = {
        id: `local-${file.name}-${file.lastModified}-${index}`,
        source: 'local', title: file.name.replace(/\.[^.]+$/, ''), artist: '未知艺术家', album: '本地音乐',
        cover: rainIcon, audioUrl: durableUrl, filePath, lyricRaw: '', wordLyricRaw: '', translationRaw: '', romanRaw: '', duration: 0,
      };
      const result = filePath ? await readLocalMetadata(filePath) : null;
      return result?.ok ? withLocalMetadata(baseTrack, result.metadata) : baseTrack;
    }));
    setQueue(items);
    setLocalTracks((tracks) => [...items, ...tracks.filter((track) => !items.some((item) => item.id === track.id))]);
    setCurrent(items[0]);
    setQuality('local');
    setCurrentTime(0);
    pendingSeekRef.current = 0;
    setPlaying(true);
    closeLyrics();
    notify(`已导入 ${items.length} 首本地音乐`, 'success');
  };

  const playAdjacent = async (direction) => {
    if (queue.length < 2) return notify('播放队列中没有其他歌曲');
    const index = queue.findIndex((item) => item.id === current.id && item.source === current.source);
    let nextIndex;
    if (playMode === 'shuffle') {
      do { nextIndex = Math.floor(Math.random() * queue.length); } while (nextIndex === index && queue.length > 1);
    } else {
      nextIndex = (Math.max(0, index) + direction + queue.length) % queue.length;
    }
    const item = queue[nextIndex];
    if (item.source === 'local' || item.audioUrl) {
      setCurrent(item);
      setQuality(item.source === 'local' ? 'local' : (item.quality || quality));
      setCurrentTime(0);
      pendingSeekRef.current = 0;
      setDuration(item.duration || 0);
      setPlaying(true);
      return;
    }
    await selectSearchResult(item, queue);
  };

  const handleEnded = () => {
    if (playMode === 'repeat') {
      seek(0);
      setPlaying(true);
      audioRef.current?.play().catch(() => setPlaying(false));
      return;
    }
    if (queue.length > 1) void playAdjacent(1);
    else setPlaying(false);
  };

  const needKey = () => { navigate('settings'); notify('请先连接你的 ChKSz API Key'); };

  const toggleEntity = (setter) => (item) => setter((items) => items.some((entry) => entry.id === item.id) ? items.filter((entry) => entry.id !== item.id) : [item, ...items]);
  const openSavedEntity = (entity, kind) => {
    closeLyrics();
    setEntityRequest({ entity, kind, requestId: Date.now() });
    setView('search');
  };
  const addPlaylist = async (value) => {
    const parsed = parsePlaylistUrl(value);
    if (!parsed) { notify('无法识别这个歌单链接', 'error'); return false; }
    if (parsed.source !== 'netease') {
      setPlaylists((items) => [{ id: parsed.id || `link-${Date.now()}`, source: parsed.source, title: `${SOURCE_META[parsed.source].short}分享歌单`, url: parsed.url, tracks: [] }, ...items.filter((item) => item.url !== parsed.url)]);
      notify(`已保存${SOURCE_META[parsed.source].label}链接；当前 API 文档未提供歌单详情接口`);
      return true;
    }
    if (!parsed.id) { notify('链接里没有找到网易云歌单 ID', 'error'); return false; }
    if (!hasApiKey) { needKey(); return false; }
    setPlaylistLoading(true);
    const response = await apiRequest('/api/163_playlist', { id: parsed.id });
    setPlaylistLoading(false);
    if (!response.ok) { notify(response.message || '歌单导入失败', 'error'); return false; }
    const playlist = { ...normalizePlaylist(response.data, 'netease'), url: parsed.url };
    setPlaylists((items) => [playlist, ...items.filter((item) => !(item.source === playlist.source && item.id === playlist.id))]);
    notify(`已用一次调用导入 ${playlist.tracks.length} 首歌曲`, 'success');
    return true;
  };
  const removePlaylist = (playlist) => {
    setPlaylists((items) => items.filter((item) => !(item.source === playlist.source && item.id === playlist.id && item.url === playlist.url)));
    notify('已删除歌单', 'neutral');
  };

  const handleAudioTimeUpdate = (event) => {
    const nextTime = event.currentTarget.currentTime;
    const pendingSeek = pendingSeekRef.current;
    if (pendingSeek !== null) {
      if (Math.abs(nextTime - pendingSeek) > .75) return;
      pendingSeekRef.current = null;
    }
    setCurrentTime(nextTime);
    const key = trackKey(current);
    const state = listeningRef.current;
    if (state.track !== key) { state.track = key; state.lastTime = nextTime; state.pending = 0; return; }
    const delta = nextTime - state.lastTime;
    state.lastTime = nextTime;
    if (!playing || current.empty || delta <= 0 || delta > 3) return;
    state.pending += delta;
    if (state.pending < 5) return;
    const seconds = state.pending; state.pending = 0;
    const day = localDateKey();
    setListeningStats((stats) => ({ ...stats, totalSeconds: stats.totalSeconds + seconds, days: { ...stats.days, [day]: { ...(stats.days[day] || { seconds: 0, tracks: 0 }), seconds: (stats.days[day]?.seconds || 0) + seconds } } }));
  };

  const handleLoadedMetadata = (event) => {
    setDuration(event.currentTarget.duration);
    const pendingSeek = pendingSeekRef.current;
    if (pendingSeek === null || pendingSeek <= 0) return;
    try { event.currentTarget.currentTime = Math.min(pendingSeek, event.currentTarget.duration || pendingSeek); } catch {}
    setCurrentTime(pendingSeek);
  };

  useEffect(() => {
    const onShortcutKeyDown = (event) => {
      if (event.repeat || event.defaultPrevented || isTypingTarget(event.target) || document.querySelector('[aria-modal="true"]')) return;
      const match = Object.entries(shortcuts).find(([, shortcut]) => shortcutMatches(event, shortcut));
      if (!match) return;
      event.preventDefault();
      event.stopPropagation();
      const [action] = match;
      if (action === 'togglePlay') togglePlay();
      else if (action === 'previous') void playAdjacent(-1);
      else if (action === 'next') void playAdjacent(1);
      else if (action === 'volumeUp') {
        const nextVolume = Math.min(1, Math.round((volume + .05) * 100) / 100);
        setVolume(nextVolume);
        showVolumeFeedback(nextVolume);
      } else if (action === 'volumeDown') {
        const nextVolume = Math.max(0, Math.round((volume - .05) * 100) / 100);
        setVolume(nextVolume);
        showVolumeFeedback(nextVolume);
      }
    };
    window.addEventListener('keydown', onShortcutKeyDown, true);
    return () => window.removeEventListener('keydown', onShortcutKeyDown, true);
  }, [shortcuts, current.empty, current.audioUrl, current.id, current.source, playing, queue, playMode, quality, volume]);

  const nonSearchView = view === 'settings' ? <SettingsView hasApiKey={hasApiKey} onSaved={setHasApiKey} notify={notify} onOpenAccount={openAccount} closeAction={closeAction} onCloseAction={changeCloseAction} avatar={avatar} onAvatar={setAvatar} userName={quota.userName} shortcuts={shortcuts} onShortcut={changeShortcut} onResetShortcuts={resetShortcuts} defaultQualities={defaultQualities} onDefaultQuality={changeDefaultQuality} onCheckUpdate={checkForAppUpdate} updateChecking={updateChecking} />
    : view === 'liked' ? <LikesView liked={liked} onPlay={playSavedTrack} onPlayAll={playAll} onRemove={toggleLike} activeRequest={activeRequest} />
    : view === 'recent' ? <RecentView tracks={recent} onPlay={playSavedTrack} onPlayAll={playAll} onBack={() => navigate('library')} activeRequest={activeRequest} />
    : view === 'albums' ? <EntityLibraryView title="专辑" subtitle="在搜索的专辑分类中点击爱心收藏。" items={savedAlbums} kind="album" onToggle={toggleEntity(setSavedAlbums)} onOpen={openSavedEntity} />
    : view === 'artists' ? <EntityLibraryView title="歌手" subtitle="在搜索的歌手分类中点击爱心收藏。" items={savedArtists} kind="artist" onToggle={toggleEntity(setSavedArtists)} onOpen={openSavedEntity} />
    : view === 'local' ? <LocalMusicView tracks={localTracks} onImport={importLocal} onPlay={playSavedTrack} onPlayAll={playAll} activeRequest={activeRequest} />
    : view === 'playlists' ? <PlaylistsView playlists={playlists} onAdd={addPlaylist} onPlay={playSavedTrack} onPlayAll={playAll} onRemove={removePlaylist} activeRequest={activeRequest} loading={playlistLoading} />
    : <LibraryView current={current} onOpenLikes={() => navigate('liked')} onOpenRecent={() => navigate('recent')} onImport={importLocal} likedCount={liked.length} avatar={avatar} userName={quota.userName} stats={listeningStats} />;

  return (
    <div className={`app-shell ${lyricsMounted ? 'lyrics-mode' : ''}`} style={rootStyle}>
      <div className="color-atmosphere" aria-hidden="true"><i /><i /><i /><i /></div>
      <div className="window-drag" aria-hidden="true" />
      <WindowControls />
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark rain-brand-mark"><img src={rainIcon} alt="" /></span><span>Rain</span></div>
        <nav>
          <p>浏览</p>
          <button className={view === 'library' && !lyricsMounted ? 'active' : ''} onClick={() => navigate('library')}><Home size={18} />首页</button>
          <button className={view === 'search' && !lyricsMounted ? 'active' : ''} onClick={() => navigate('search')}><Search size={18} />搜索</button>
          <p>资料库</p>
          <button className={view === 'liked' && !lyricsMounted ? 'active' : ''} onClick={() => navigate('liked')}><Heart size={18} />喜欢的音乐</button>
          <button className={view === 'albums' && !lyricsMounted ? 'active' : ''} onClick={() => navigate('albums')}><Album size={18} />专辑</button>
          <button className={view === 'artists' && !lyricsMounted ? 'active' : ''} onClick={() => navigate('artists')}><UserRound size={18} />歌手</button>
          <button className={view === 'local' && !lyricsMounted ? 'active' : ''} onClick={() => navigate('local')}><HardDrive size={18} />本地歌曲</button>
          <button className={view === 'playlists' && !lyricsMounted ? 'active' : ''} onClick={() => navigate('playlists')}><ListMusic size={18} />我的歌单</button>
        </nav>
        <button className={`settings-link ${view === 'settings' && !lyricsMounted ? 'active' : ''}`} onClick={() => navigate('settings')}><Settings size={18} />设置<span className={`connection-dot ${hasApiKey ? 'on' : ''}`} /></button>
      </aside>
      <main className="main-panel">
        <div className="base-view search-keeper" hidden={view !== 'search'}><SearchView active={view === 'search'} hasApiKey={hasApiKey} onNeedKey={needKey} onSelect={selectSearchResult} onPlayAll={playAll} activeRequest={activeRequest} quota={quota} onOpenAccount={openAccount} savedArtists={savedArtists} savedAlbums={savedAlbums} onSaveArtist={toggleEntity(setSavedArtists)} onSaveAlbum={toggleEntity(setSavedAlbums)} entityRequest={entityRequest} liked={liked} onToggleLike={toggleLike} /></div>
        <div className="base-view" hidden={view === 'search'}>{nonSearchView}</div>
        {lyricsMounted && <LyricsView visible={lyricsVisible} track={current} currentTime={currentTime} duration={duration} playing={playing} onToggle={togglePlay} onPrevious={() => playAdjacent(-1)} onNext={() => playAdjacent(1)} onClose={closeLyrics} onSeek={seek} quality={quality} onQuality={changeQuality} qualityLoading={qualityLoading} playMode={playMode} liked={!current.empty && liked.some((track) => trackKey(track) === trackKey(current))} onToggleLike={() => toggleLike(current)} onCyclePlayMode={cyclePlayMode} />}
      </main>
      {!lyricsMounted && <MiniPlayer track={current} playing={playing} currentTime={currentTime} duration={duration} onToggle={togglePlay} onPrevious={() => playAdjacent(-1)} onNext={() => playAdjacent(1)} onOpen={openLyrics} onSeek={seek} volume={volume} onVolume={setVolume} liked={!current.empty && liked.some((track) => trackKey(track) === trackKey(current))} onToggleLike={() => toggleLike(current)} queue={queue} onPlayQueue={playQueueItem} playMode={playMode} onCyclePlayMode={cyclePlayMode} />}
      <audio ref={audioRef} onTimeUpdate={handleAudioTimeUpdate} onLoadedMetadata={handleLoadedMetadata} onEnded={handleEnded} />
      {volumeFeedback !== null && <div className={`volume-feedback ${lyricsMounted ? 'in-lyrics' : ''}`} role="status" aria-live="polite"><Volume2 size={17} /><div><span>音量</span><strong>{volumeFeedback}%</strong><i><b style={{ transform: `scaleX(${volumeFeedback / 100})` }} /></i></div></div>}
      {toast && <div className={`toast ${toast.type}`} role="status"><span>{toast.type === 'success' ? <Check size={16} /> : toast.type === 'error' ? '!' : <Sparkles size={16} />}</span>{toast.message}</div>}
      {closeDialogOpen && <CloseBehaviorDialog onChoose={chooseCloseAction} onCancel={cancelClose} />}
      {updateDialogOpen && updateInfo && <UpdateDialog info={updateInfo} downloading={updateDownloading} progress={updateProgress} onClose={() => setUpdateDialogOpen(false)} onUpdate={handleUpdateNow} />}
    </div>
  );
}

export default App;
