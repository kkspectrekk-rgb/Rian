import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Album,
  Check,
  ChevronDown,
  Clock3,
  Ellipsis,
  Heart,
  Home,
  KeyRound,
  Library,
  ListOrdered,
  ListMusic,
  LoaderCircle,
  Minimize2,
  Music2,
  Pause,
  Play,
  Power,
  Repeat1,
  Search,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Volume2,
  X,
} from 'lucide-react';
import {
  apiRequest,
  cacheAudio,
  cacheTrackKey,
  clearApiKey,
  extractLyricPayload,
  getCachedSearch,
  getCachedTrack,
  getQuotaStatus,
  getSettings,
  hydrateCachedTracks,
  makeCoverReadable,
  normalizeDetail,
  normalizeSearch,
  onCloseRequested,
  onQuotaUpdated,
  openQuotaLogin,
  putCachedSearch,
  putCachedTrack,
  resolveClose,
  saveApiKey,
  saveCloseAction,
} from './api';
import { parseLyrics } from './lyrics';
import rainIcon from './assets/rain-icon.png';

const SOURCE_META = {
  netease: { label: '网易云音乐', short: '网易云', color: '#fb3b58' },
  qq: { label: 'QQ 音乐', short: 'QQ 音乐', color: '#31d583' },
  kugou: { label: '酷狗音乐', short: '酷狗', color: '#55a8ff' },
};

const QUALITY_OPTIONS = {
  netease: [
    ['standard', '标准'], ['exhigh', '极高'], ['lossless', '无损'], ['hires', 'Hi-Res'],
    ['jyeffect', '沉浸环绕'], ['sky', '天空音频'], ['jymaster', '超清母带'],
  ],
  qq: [['128k', '标准'], ['320k', '高品质'], ['flac', '无损'], ['hires', 'Hi-Res'], ['master', '母带']],
  kugou: [['128k', '标准'], ['320k', '高品质'], ['flac', '无损'], ['hires', 'Hi-Res'], ['master', '母带']],
  local: [['local', '本地原声']],
  empty: [['none', '未播放']],
};

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

function loadCollection(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
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

function SettingsView({ hasApiKey, onSaved, notify, onOpenAccount, closeAction, onCloseAction }) {
  const [key, setKey] = useState('');
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);

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
      <div className="close-preference">
        <div className="setting-icon close-setting-icon"><Power size={20} /></div>
        <div className="setting-copy">
          <h2>关闭窗口时</h2>
          <p>选择关闭 Rain、保留在系统托盘，或每次关闭时询问。</p>
        </div>
        <CustomSelect className="close-action-select" label="关闭窗口行为" value={closeAction} options={CLOSE_ACTION_OPTIONS} onChange={onCloseAction} />
      </div>
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

function SearchView({ hasApiKey, onNeedKey, onSelect, activeRequest, quota, onOpenAccount }) {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('netease');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const [fromCache, setFromCache] = useState(false);

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

  const search = async (event, force = false) => {
    event?.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    setSearched(true);
    const keyword = query.trim();
    const searchCacheKey = `${source}:${keyword.toLocaleLowerCase()}`;
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
    const endpoint = source === 'netease' ? '/api/163_search' : source === 'qq' ? '/api/qq_music' : '/api/kugou_music';
    const params = source === 'netease' ? { keyword, limit: 30, offset: 0 } : { msg: keyword, num: 30 };
    const response = await apiRequest(endpoint, params);
    setLoading(false);
    if (!response.ok) {
      setResults([]);
      setError(response.message || '搜索失败');
      return;
    }
    const normalized = normalizeSearch(response.data, source).map((item) => ({ ...item, searchKeyword: keyword }));
    await putCachedSearch(searchCacheKey, normalized);
    setResults(await enrich(normalized));
  };

  return (
    <section className="search-view content-enter">
      <header className="page-heading"><p>跨平台发现</p><h1>搜索</h1></header>
      <div className="search-topline">
        <form className="search-box" onSubmit={search}>
          <Search size={19} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="歌曲、艺人或专辑" autoFocus />
          <CustomSelect
            className="source-select"
            label="搜索源"
            value={source}
            options={Object.entries(SOURCE_META).map(([value, meta]) => [value, meta.label])}
            onChange={(nextSource) => { setSource(nextSource); setResults([]); setSearched(false); setFromCache(false); }}
          />
        </form>
        <QuotaStatus quota={quota} onConnect={onOpenAccount} />
      </div>
      <div className="search-meta">
        <span>{searched ? `${SOURCE_META[source].label} · ${results.length} 个结果${fromCache ? ' · 本地缓存' : ''}` : '选择音乐源后开始搜索'}</span>
        {searched && !loading && <button className="text-button" onClick={() => search(null, true)}>重新搜索</button>}
      </div>
      <div className="results-list" aria-live="polite">
        {loading && <div className="empty-state"><LoaderCircle className="spin" /><strong>正在搜索</strong><span>从 {SOURCE_META[source].label} 获取结果…</span></div>}
        {!loading && error && <div className="empty-state error-state"><span className="error-dot">!</span><strong>无法完成搜索</strong><span>{error}</span></div>}
        {!loading && searched && !error && results.length === 0 && <div className="empty-state"><Music2 /><strong>没有找到结果</strong><span>试试歌曲名、艺人名或更短的关键词。</span></div>}
        {!loading && results.map((item, index) => (
          <button className="result-row" key={`${item.source}-${item.id}-${index}`} onClick={() => onSelect(item, results)} disabled={Boolean(activeRequest)}>
            <span className="result-index">{activeRequest === trackKey(item) ? <LoaderCircle className="spin" size={16} /> : String(index + 1).padStart(2, '0')}</span>
            <span className="result-art" style={{ backgroundImage: `url(${item.cover || rainIcon})` }} />
            <span className="result-title"><strong>{item.title}</strong><small>{item.artist}</small></span>
            <span className="result-album">{item.album}</span>
            <SourceMark source={item.source} />
            <span className="result-play"><Play size={14} fill="currentColor" /></span>
          </button>
        ))}
      </div>
    </section>
  );
}

function LibraryView({ onOpenLyrics, onImport, onOpenLikes, current, likedCount }) {
  const fileInput = useRef(null);
  return (
    <section className="library-view content-enter">
      <header className="page-heading browse-heading"><div><p>星期日 · 为你精选</p><h1>现在就听</h1></div><button className="round-avatar">K</button></header>
      <button className="hero-card" onClick={onOpenLyrics}>
        <div className="hero-copy"><span>沉浸空间</span><h2>让音乐填满整个房间。</h2><p>封面的色彩沿着窗口流动，逐行歌词随节拍自然推进。</p><span className="hero-cta">打开歌词 <span>→</span></span></div>
        <div className="hero-visual"><div className="hero-disc" style={{ backgroundImage: `url(${current.cover})` }} /><div className="hero-reflection" /></div>
      </button>
      <div className="section-title"><div><h2>你的音乐</h2><p>本地收藏与最近播放</p></div><button className="text-button" onClick={() => fileInput.current?.click()}>导入音乐</button></div>
      <input ref={fileInput} onChange={onImport} className="sr-only" type="file" accept="audio/*" multiple />
      <div className="collection-grid">
        <button className="collection-card favorite" onClick={onOpenLikes}><div className="collection-art"><Heart size={38} fill="white" /></div><strong>喜欢的音乐</strong><small>{likedCount ? `${likedCount} 首歌曲` : '你的收藏'}</small></button>
        <button className="collection-card" onClick={onOpenLyrics}><div className="collection-art recent" style={{ backgroundImage: `url(${current.cover})` }} /><strong>最近播放</strong><small>{current.title}</small></button>
        <button className="collection-card dashed" onClick={() => fileInput.current?.click()}><div className="collection-art import-art"><Upload size={30} /></div><strong>导入本地音乐</strong><small>MP3、FLAC、WAV 等</small></button>
      </div>
    </section>
  );
}

function LikesView({ liked, onPlay, onRemove, activeRequest }) {
  return (
    <section className="liked-view content-enter">
      <header className="page-heading liked-heading">
        <div className="liked-symbol"><Heart size={34} fill="currentColor" /></div>
        <div><p>你的资料库</p><h1>喜欢的音乐</h1><span>{liked.length} 首歌曲</span></div>
      </header>
      <TrackRows tracks={liked} onPlay={onPlay} onRemove={onRemove} activeRequest={activeRequest} emptyTitle="还没有喜欢的音乐" emptyCopy="在播放栏点击爱心，歌曲会出现在这里。" />
    </section>
  );
}

function LyricsView({ track, currentTime, duration, playing, onToggle, onPrevious, onNext, onClose, onSeek, quality, onQuality, qualityLoading, playMode, onSetPlayMode }) {
  const lyrics = useMemo(() => parseLyrics(track.lyricRaw, track.translationRaw, track.romanRaw, track.wordLyricRaw), [track.lyricRaw, track.translationRaw, track.romanRaw, track.wordLyricRaw]);
  const activeIndex = lyrics.findLastIndex((line) => line.time <= currentTime + 0.04);
  const scrollRef = useRef(null);
  const [showTranslation, setShowTranslation] = useState(true);
  const [showRoman, setShowRoman] = useState(true);
  const hasTranslation = lyrics.some((line) => line.translation);
  const hasRoman = lyrics.some((line) => line.roman);

  useEffect(() => {
    const active = scrollRef.current?.querySelector('[data-active="true"]');
    if (active) active.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [activeIndex]);

  return (
    <section className="lyrics-view content-enter">
      <div className="lyrics-toolbar">
        <IconButton label="关闭歌词" onClick={onClose}><X size={19} /></IconButton>
        <span>{track.empty ? '未播放' : '正在播放'}</span>
        <div className="lyrics-options">
          <button className={`lyric-toggle ${showTranslation ? 'active' : ''}`} type="button" disabled={!hasTranslation} aria-pressed={showTranslation} onClick={() => setShowTranslation((state) => !state)}>翻译</button>
          <button className={`lyric-toggle ${showRoman ? 'active' : ''}`} type="button" disabled={!hasRoman} aria-pressed={showRoman} onClick={() => setShowRoman((state) => !state)}>音标</button>
          <CustomSelect className="quality-select" label="音质" icon={<SlidersHorizontal size={15} />} value={quality} onChange={onQuality} disabled={qualityLoading || track.empty} options={QUALITY_OPTIONS[track.source] || QUALITY_OPTIONS.netease} />
        </div>
      </div>
      <div className="lyrics-layout">
        <div className="art-column">
          <div className="album-frame"><img src={track.cover || rainIcon} alt={`${track.album} 封面`} /></div>
          <div className="track-heading"><div><h2>{track.title}</h2><p>{track.artist} · {track.album}</p></div><div className="track-actions"><IconButton label="更多"><Ellipsis /></IconButton><span className="play-mode-status">{PLAY_MODE_META[playMode].label}</span></div></div>
          <div className="lyrics-controls">
            <div className="timeline">
              <div className="timeline-track"><span style={{ transform: `scaleX(${duration ? currentTime / duration : 0})` }} /></div>
              <input aria-label="播放进度" type="range" min="0" max={duration || 1} step="0.1" value={Math.min(currentTime, duration || 1)} onChange={(event) => onSeek(Number(event.target.value))} />
              <small>{formatTime(currentTime)}</small><small>-{formatTime(Math.max(0, duration - currentTime))}</small>
            </div>
            <div className="main-controls"><IconButton className={playMode === 'shuffle' ? 'mode-active' : ''} label="随机播放" aria-pressed={playMode === 'shuffle'} onClick={() => onSetPlayMode('shuffle')}><Shuffle size={19} /></IconButton><IconButton label="上一首" onClick={onPrevious}><SkipBack size={26} fill="currentColor" /></IconButton><button className="large-play" onClick={onToggle} aria-label={playing ? '暂停' : '播放'}>{playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button><IconButton label="下一首" onClick={onNext}><SkipForward size={26} fill="currentColor" /></IconButton><IconButton className={playMode === 'repeat' ? 'mode-active' : ''} label="单曲循环" aria-pressed={playMode === 'repeat'} onClick={() => onSetPlayMode('repeat')}><Repeat1 size={19} /></IconButton></div>
          </div>
        </div>
        <div className="lyric-scroll" ref={scrollRef} tabIndex="0" aria-label="同步歌词">
          <div className="lyric-spacer" />
          {lyrics.length ? lyrics.map((line, index) => (
            <button key={`${line.time}-${index}`} className="lyric-line" data-active={index === activeIndex} onClick={() => onSeek(line.time)}>
              {showRoman && line.roman && <span className="roman">{line.roman}</span>}
              <strong className={index === activeIndex ? 'karaoke-text' : ''} aria-label={line.text}>
                {index === activeIndex ? line.words.map((word, wordIndex) => {
                  const state = currentTime < word.start ? 'future' : currentTime < word.end ? 'current' : 'passed';
                  return <span className={`karaoke-word ${state}`} key={`${word.start}-${wordIndex}`}>{word.text}</span>;
                }) : line.text}
              </strong>
              {showTranslation && line.translation && <span>{line.translation}</span>}
            </button>
          )) : <div className="no-lyrics"><Music2 /><strong>{track.empty ? '未播放歌曲' : '暂无歌词'}</strong><span>{track.empty ? '选择一首歌曲后，这里会显示同步歌词。' : '这首歌曲没有返回可用的歌词。'}</span></div>}
          <div className="lyric-spacer" />
        </div>
      </div>
    </section>
  );
}

function RecentMenu({ tracks, onPlay }) {
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
      <IconButton className={open ? 'active' : ''} label="最近播放" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((state) => !state)}><Clock3 size={18} /></IconButton>
      <div className="recent-popover" data-open={open} role="dialog" aria-label="最近播放" aria-hidden={!open}>
          <div className="recent-popover-title"><span>最近播放</span><small>{tracks.length} 首</small></div>
          <div className="recent-popover-list">
            {tracks.length ? tracks.map((item) => (
              <button key={trackKey(item)} type="button" tabIndex={open ? 0 : -1} onClick={() => { onPlay(item); setOpen(false); }}>
                <span className="recent-art" style={{ backgroundImage: `url(${item.cover || rainIcon})` }} />
                <span><strong>{item.title}</strong><small>{item.artist}</small></span>
                <Play size={13} fill="currentColor" />
              </button>
            )) : <div className="recent-empty">播放过的歌曲会出现在这里</div>}
          </div>
      </div>
    </div>
  );
}

function MiniPlayer({ track, playing, currentTime, duration, onToggle, onPrevious, onNext, onOpen, volume, onVolume, liked, onToggleLike, recent, onPlayRecent, playMode, onSetPlayMode }) {
  return (
    <footer className="mini-player">
      <button className="mini-track" onClick={onOpen}><span className="mini-art"><img src={track.cover || rainIcon} alt="" /></span><span><strong>{track.title}</strong><small>{track.artist}</small></span></button>
      <div className="mini-center">
        <div className="mini-controls"><IconButton className={`heart-button ${liked ? 'liked' : ''}`} label={liked ? '取消喜欢' : '加入喜欢的音乐'} aria-pressed={liked} onClick={onToggleLike}><Heart size={18} fill={liked ? 'currentColor' : 'none'} /></IconButton><IconButton label="上一首" onClick={onPrevious}><SkipBack size={17} fill="currentColor" /></IconButton><button className="mini-play" onClick={onToggle} aria-label={playing ? '暂停' : '播放'}>{playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button><IconButton label="下一首" onClick={onNext}><SkipForward size={17} fill="currentColor" /></IconButton><IconButton className={playMode === 'sequence' ? 'mode-active' : ''} label="按顺序播放" aria-pressed={playMode === 'sequence'} onClick={() => onSetPlayMode('sequence')}><ListOrdered size={18} /></IconButton></div>
        <div className="mini-progress"><span>{formatTime(currentTime)}</span><div><i style={{ transform: `scaleX(${duration ? currentTime / duration : 0})` }} /></div><span>-{formatTime(Math.max(0, duration - currentTime))}</span></div>
      </div>
      <div className="mini-actions"><RecentMenu tracks={recent} onPlay={onPlayRecent} /><Volume2 size={17} /><input aria-label="音量" type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => onVolume(Number(event.target.value))} /></div>
    </footer>
  );
}

function App() {
  const [view, setView] = useState('library');
  const [lyricsOpen, setLyricsOpen] = useState(true);
  const [current, setCurrent] = useState(EMPTY_TRACK);
  const [queue, setQueue] = useState([]);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
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
  const [quota, setQuota] = useState({ connected: false, state: 'checking' });
  const audioRef = useRef(null);
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
  useEffect(() => { localStorage.setItem('aurora_liked_tracks', JSON.stringify(liked.map(persistableTrack))); }, [liked]);
  useEffect(() => { localStorage.setItem('aurora_recent_tracks', JSON.stringify(recent.map(persistableTrack))); }, [recent]);
  useEffect(() => { localStorage.setItem('rain_play_mode', playMode); }, [playMode]);
  useEffect(() => {
    if (!current || current.empty) return;
    setRecent((tracks) => [current, ...tracks.filter((item) => trackKey(item) !== trackKey(current))].slice(0, 30));
    setLiked((tracks) => tracks.some((item) => trackKey(item) === trackKey(current)) ? tracks.map((item) => trackKey(item) === trackKey(current) ? { ...item, ...current } : item) : tracks);
  }, [current]);
  useEffect(() => {
    if (!toast) return undefined;
    const timeout = setTimeout(() => setToast(null), 3400);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || current.empty) return;
    audio.src = current.audioUrl || '';
    audio.load();
    if (playing && current.audioUrl) audio.play().catch(() => setPlaying(false));
  }, [current]);
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
  const changeCloseAction = async (nextAction) => {
    const result = await saveCloseAction(nextAction);
    if (!result?.ok) return notify('无法保存关闭窗口设置', 'error');
    setCloseAction(result.closeAction || nextAction);
    notify(`关闭窗口时：${CLOSE_ACTION_OPTIONS.find(([value]) => value === nextAction)?.[1] || nextAction}`, 'success');
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
  const openAccount = async () => {
    await openQuotaLogin();
    notify('请在打开的 API 窗口中登录，额度会自动同步');
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
      const defaultQuality = item.source === 'netease' ? 'lossless' : 'flac';
      const detail = await resolveTrack(item, defaultQuality);
      setQueue(results);
      setCurrent(detail);
      setQuality(defaultQuality);
      setCurrentTime(0);
      setDuration(detail.duration > 10000 ? detail.duration / 1000 : detail.duration || 0);
      setPlaying(true);
      setLyricsOpen(true);
      notify(`正在播放 · ${detail.title}`, 'success');
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
        if (!item.audioUrl?.startsWith('blob:')) throw new Error('本地文件已失效，请重新导入这首歌曲');
        setCurrent(item);
        setQueue([item]);
        setQuality('local');
        setCurrentTime(0);
        setDuration(item.duration || 0);
        setPlaying(true);
      } else {
        const nextQuality = item.quality || (item.source === 'netease' ? 'lossless' : 'flac');
        const detail = await resolveTrack(item, nextQuality);
        setCurrent(detail);
        setQueue([item]);
        setQuality(nextQuality);
        setCurrentTime(0);
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
      setCurrent(updated);
      setQuality(nextQuality);
      requestAnimationFrame(() => {
        if (audioRef.current) audioRef.current.currentTime = previousTime;
        setCurrentTime(previousTime);
      });
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
    setCurrentTime(time);
    if (!current.empty && audioRef.current) audioRef.current.currentTime = time;
  };

  const importLocal = (event) => {
    const files = [...event.target.files];
    if (!files.length) return;
    const items = files.map((file, index) => ({
      id: `local-${file.name}-${file.lastModified}-${index}`,
      source: 'local', title: file.name.replace(/\.[^.]+$/, ''), artist: '本地音乐', album: '已导入',
      cover: rainIcon, audioUrl: URL.createObjectURL(file), lyricRaw: '', wordLyricRaw: '', translationRaw: '', romanRaw: '', duration: 0,
    }));
    setQueue(items);
    setCurrent(items[0]);
    setQuality('local');
    setCurrentTime(0);
    setPlaying(true);
    setLyricsOpen(false);
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

  const needKey = () => { setView('settings'); setLyricsOpen(false); notify('请先连接你的 ChKSz API Key'); };

  return (
    <div className="app-shell" style={rootStyle}>
      <div className="color-atmosphere" aria-hidden="true"><i /><i /><i /><i /></div>
      <div className="window-drag" aria-hidden="true" />
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark rain-brand-mark"><img src={rainIcon} alt="" /></span><span>Rain</span></div>
        <nav>
          <p>浏览</p>
          <button className={view === 'library' && !lyricsOpen ? 'active' : ''} onClick={() => { setView('library'); setLyricsOpen(false); }}><Home size={18} />现在就听</button>
          <button className={view === 'search' && !lyricsOpen ? 'active' : ''} onClick={() => { setView('search'); setLyricsOpen(false); }}><Search size={18} />搜索</button>
          <p>资料库</p>
          <button className={view === 'liked' && !lyricsOpen ? 'active' : ''} onClick={() => { setView('liked'); setLyricsOpen(false); }}><Heart size={18} />喜欢的音乐</button>
          <button><Album size={18} />专辑</button>
          <button><ListMusic size={18} />歌曲</button>
        </nav>
        <button className={`settings-link ${view === 'settings' && !lyricsOpen ? 'active' : ''}`} onClick={() => { setView('settings'); setLyricsOpen(false); }}><Settings size={18} />设置<span className={`connection-dot ${hasApiKey ? 'on' : ''}`} /></button>
      </aside>
      <main className="main-panel">
        {lyricsOpen ? <LyricsView track={current} currentTime={currentTime} duration={duration} playing={playing} onToggle={togglePlay} onPrevious={() => playAdjacent(-1)} onNext={() => playAdjacent(1)} onClose={() => setLyricsOpen(false)} onSeek={seek} quality={quality} onQuality={changeQuality} qualityLoading={qualityLoading} playMode={playMode} onSetPlayMode={changePlayMode} /> : view === 'search' ? <SearchView hasApiKey={hasApiKey} onNeedKey={needKey} onSelect={selectSearchResult} activeRequest={activeRequest} quota={quota} onOpenAccount={openAccount} /> : view === 'settings' ? <SettingsView hasApiKey={hasApiKey} onSaved={setHasApiKey} notify={notify} onOpenAccount={openAccount} closeAction={closeAction} onCloseAction={changeCloseAction} /> : view === 'liked' ? <LikesView liked={liked} onPlay={playSavedTrack} onRemove={toggleLike} activeRequest={activeRequest} /> : <LibraryView current={current} onOpenLyrics={() => setLyricsOpen(true)} onOpenLikes={() => setView('liked')} onImport={importLocal} likedCount={liked.length} />}
      </main>
      <MiniPlayer track={current} playing={playing} currentTime={currentTime} duration={duration} onToggle={togglePlay} onPrevious={() => playAdjacent(-1)} onNext={() => playAdjacent(1)} onOpen={() => setLyricsOpen(true)} volume={volume} onVolume={setVolume} liked={!current.empty && liked.some((track) => trackKey(track) === trackKey(current))} onToggleLike={() => toggleLike(current)} recent={recent} onPlayRecent={playSavedTrack} playMode={playMode} onSetPlayMode={changePlayMode} />
      <audio ref={audioRef} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)} onEnded={handleEnded} />
      {toast && <div className={`toast ${toast.type}`} role="status"><span>{toast.type === 'success' ? <Check size={16} /> : toast.type === 'error' ? '!' : <Sparkles size={16} />}</span>{toast.message}</div>}
      {closeDialogOpen && <CloseBehaviorDialog onChoose={chooseCloseAction} onCancel={cancelClose} />}
    </div>
  );
}

export default App;
