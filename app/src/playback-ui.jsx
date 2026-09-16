import { createContext, useContext, useRef } from 'react';
import { LocateFixed } from 'lucide-react';

export const PlaybackUiContext = createContext({ current: null, onSearch: () => {} });

// Clickable metadata is independent of the row's play/open action.
export function MetadataLink({ item, kind, name }) {
  const { onSearch } = useContext(PlaybackUiContext);
  const value = String(name ?? item?.[kind] ?? '').trim();
  if (!value || /^(未知艺人|未知艺术家|未知专辑|本地音乐|未播放)$/.test(value)) return <span>{value}</span>;
  const names = kind === 'artist' ? value.split(/\s*[/、]\s*/).filter(Boolean) : [value];
  return <>{names.map((text, index) => <span key={`${text}-${index}`}>
    {index > 0 && ' / '}
    <button className="metadata-link" type="button" title={`搜索${kind === 'artist' ? '歌手' : '专辑'}：${text}`} onClick={(event) => { event.stopPropagation(); onSearch(text, item?.source, kind); }}>{text}</button>
  </span>)}</>;
}

export function ActionSurface({ children, onClick, disabled, tabIndex = 0, type: _type, ...props }) {
  return <div {...props} role="button" tabIndex={disabled ? -1 : tabIndex} aria-disabled={Boolean(disabled)} onClick={(event) => { if (!disabled) onClick?.(event); }} onKeyDown={(event) => {
    if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    if (!disabled) onClick?.(event);
  }}>{children}</div>;
}

export const identity = (track) => `${track?.source || 'unknown'}:${track?.id || track?.title || ''}`;

export function TrackListFrame({ tracks, children, className = '' }) {
  const { current } = useContext(PlaybackUiContext);
  const root = useRef(null);
  const canLocate = !current?.empty && tracks.some((track) => identity(track) === identity(current));
  const locate = () => {
    const row = [...(root.current?.querySelectorAll('[data-track-key]') || [])].find((element) => element.dataset.trackKey === identity(current));
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    row.querySelector('[role="button"], button')?.focus({ preventScroll: true });
  };
  return <div className={`track-list-frame ${className}`} ref={root}>
    {children}
    {canLocate && <div className="locate-track-anchor"><button type="button" className="locate-track-button" onClick={locate} title="定位正在播放的歌曲"><LocateFixed size={17} />正在播放</button></div>}
  </div>;
}
