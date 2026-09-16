import { createContext, useContext, useRef, useState, useLayoutEffect } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
export const NavigationContext = createContext(null);
export const useNavigation = () => useContext(NavigationContext);
export function usePageHistory() {
  const nextId = useRef(1);
  const [history, setHistory] = useState({ entries: [{ id: 0, view: 'library' }], index: 0 });
  const saveScroll = () => document.querySelector('.base-view:not([hidden]) > section')?.scrollTop || 0;
  const push = (route) => {
    const id = nextId.current++, scroll = saveScroll();
    setHistory(h => {
      const entries = h.entries.slice(0, h.index + 1);
      entries[h.index] = { ...entries[h.index], scroll };
      entries.push({ ...route, id });
      return { entries, index: entries.length - 1 };
    });
    return id;
  };
  const update = (id, patch) => setHistory(h => ({ ...h, entries: h.entries.map(e => e.id === id ? { ...e, ...(typeof patch === 'function' ? patch(e) : patch) } : e) }));
  const travel = (delta) => {
    const scroll = saveScroll();
    setHistory(h => ({ entries: h.entries.map((e, i) => i === h.index ? { ...e, scroll } : e), index: Math.max(0, Math.min(h.entries.length - 1, h.index + delta)) }));
  };
  const route = history.entries[history.index];
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      const element = document.querySelector('.base-view:not([hidden]) > section');
      if (element) element.scrollTop = route.scroll || 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [route.id]);
  return { route, push, update, travel, canBack: history.index > 0, canForward: history.index < history.entries.length - 1 };
}
export function PageNavigation({ onTravel }) {
  const nav = useNavigation(), { route } = nav;
  let parent, label;
  if (route.view === 'playlists' && route.playlistKey) { parent = { view: 'playlists' }; label = '返回我的歌单'; }
  else if (route.view === 'search' && route.entityDetail) { parent = { view: 'search' }; label = '返回搜索结果'; }
  else if (['recent', 'daily'].includes(route.view)) { parent = { view: 'library' }; label = '返回首页'; }
  return <nav className="page-navigation" aria-label="页面导航">
    {parent && <button className="page-return" type="button" onClick={() => nav.push(parent)}><ArrowLeft size={16} />{label}</button>}
    <button type="button" aria-label="后退到上一页" title="后退到上一页" disabled={!nav.canBack} onClick={() => { onTravel(); nav.travel(-1); }}><ChevronLeft size={18} /></button>
    <button type="button" aria-label="前进到下一页" title="前进到下一页" disabled={!nav.canForward} onClick={() => { onTravel(); nav.travel(1); }}><ChevronRight size={18} /></button>
  </nav>;
}
