import { useEffect, useState } from 'react';
import { Droplets, Music2, Play } from 'lucide-react';
const DEFAULT = { enabled: true, transparency: 75, gloss: 70, frosted: false };
const KEY = 'rain_liquid_window_v1';
let value = { ...DEFAULT }, revision = 0, timer;
const listeners = new Set();
try { const s = JSON.parse(localStorage.getItem(KEY)); if (s) value = { enabled: s.enabled !== false, transparency: Number.isFinite(s.transparency) ? Math.max(0, Math.min(100, s.transparency)) : 75, gloss: Number.isFinite(s.gloss) ? Math.max(0, Math.min(100, s.gloss)) : 70, frosted: s.frosted === true }; } catch {}
function paint() {
  const root = document.documentElement;
  root.dataset.liquid = value.enabled ? 'on' : 'off';
  root.dataset.liquidClear = value.transparency === 100 ? 'true' : 'false';
  root.style.setProperty('--window-tint', String(1 - value.transparency / 100));
  root.style.setProperty('--pane-tint', String(.12 + (1 - value.transparency / 100) * .7));
  root.style.setProperty('--liquid-gloss', String(value.gloss / 100));
  listeners.forEach(fn => fn({ ...value }));
}
paint();
function change(next) {
  revision++; value = next; paint();
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch {}
  void window.musicBridge?.applyWindowAppearance?.({ ...value, persist: false }).then(result => { if (result?.ok === false) window.dispatchEvent(new CustomEvent('liquid-error', { detail: result.message })); }).catch(() => {});
  clearTimeout(timer);
  timer = setTimeout(() => { void window.musicBridge?.applyWindowAppearance?.({ ...value, persist: true }).catch(() => {}); }, 250);
}
export function LiquidWindowEffects() {
  useEffect(() => {
    const start = revision;
    void window.musicBridge?.getWindowAppearance?.().then(result => { if (result?.ok && revision === start) { value = result.appearance; paint(); } }).catch(() => {});
    let frame = 0, target;
    const move = (event) => {
      if (!value.enabled || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const pane = event.target.closest?.('.liquid-preview-pane, .mini-player, .window-controls, .page-navigation, .liquid-settings');
      if (!pane) return;
      target = { pane, x: event.clientX, y: event.clientY };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0; const r = target.pane.getBoundingClientRect();
        target.pane.style.setProperty('--shine-x', `${target.x - r.left}px`);
        target.pane.style.setProperty('--shine-y', `${target.y - r.top}px`);
      });
    };
    document.addEventListener('pointermove', move, { passive: true });
    return () => { cancelAnimationFrame(frame); document.removeEventListener('pointermove', move); };
  }, []);
  return null;
}
function GlassRange({ id, label, amount, disabled, onChange }) {
  const drag = event => { const r = event.currentTarget.getBoundingClientRect(); onChange(Math.round(Math.max(0, Math.min(100, (event.clientX - r.left - 9) / Math.max(1, r.width - 18) * 100)))); };
  return <div className="liquid-range"><label htmlFor={id}>{label}<output htmlFor={id}>{amount}%</output></label><input id={id} type="range" min="0" max="100" step="1" value={amount} disabled={disabled} onChange={e => onChange(Number(e.target.value))} onPointerDown={e => { if (!e.isPrimary || e.button !== 0) return; e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); drag(e); }} onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) drag(e); }} onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }} style={{ '--range-value': `${amount}%` }} /></div>;
}
export default function LiquidGlassSettings() {
  const [settings, setSettings] = useState(() => ({ ...value }));
  const [error, setError] = useState('');
  useEffect(() => { listeners.add(setSettings); const fail = e => setError(e.detail || '系统材质应用失败'); window.addEventListener('liquid-error', fail); return () => { listeners.delete(setSettings); window.removeEventListener('liquid-error', fail); }; }, []);
  const update = patch => { setError(''); change({ ...value, ...patch }); };
  return <section className="liquid-settings" aria-labelledby="liquid-heading">
    <header><span className="liquid-mark"><Droplets size={23} /></span><div><small>LIQUID GLASS · 实验外观</small><h2 id="liquid-heading">让桌面，成为背景</h2></div><button type="button" role="switch" aria-label="液态玻璃效果" aria-checked={settings.enabled} className="liquid-toggle" onClick={() => update({ enabled: !settings.enabled })}><i /></button></header>
    <div className="liquid-preview"><div className="liquid-preview-scene" aria-hidden="true"><b>RAIN</b></div><div className="liquid-preview-pane"><Music2 size={29} /><div><strong>通透，不止于界面</strong><span>实时材质预览</span></div><Play size={22} fill="currentColor" /></div><small>{settings.transparency === 100 ? '背景全透明 · 桌面直接透出' : '背景示意 · 软件窗口同步变化'}</small></div>
    <GlassRange id="liquid-transparency" label="整个窗口的背景透明度" amount={settings.transparency} disabled={!settings.enabled} onChange={transparency => update({ transparency })} />
    <div className="liquid-scale"><span>0% 不透明</span><span>100% 看见桌面</span></div>
    <GlassRange id="liquid-gloss" label="玻璃边缘与高光强度" amount={settings.gloss} disabled={!settings.enabled} onChange={gloss => update({ gloss })} />
    <label className="liquid-frost"><input type="checkbox" checked={settings.frosted} disabled={!settings.enabled} onChange={e => update({ frosted: e.target.checked })} /><span>系统磨砂<small>Windows 11 支持时启用；100% 透明时自动关闭，让下方内容清晰可见。</small></span></label>
    <p>拖动即作用于真实窗口。文字、封面与按钮保持可见，透明区域不会主动开启鼠标穿透。背景过亮时可降低透明度。</p>
    <p className="liquid-accessibility">系统要求减少透明度或提高对比度，已优先使用实色背景。</p>
    {error && <p role="alert">{error}</p>}
    <footer><button type="button" className="secondary-button" onClick={() => update({ enabled: false })}>恢复不透明外观</button><button type="button" className="text-button" onClick={() => change({ ...DEFAULT })}>恢复试用默认值</button></footer>
  </section>;
}
