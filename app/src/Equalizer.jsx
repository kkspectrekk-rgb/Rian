import { useEffect, useRef, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { bandLabel, clampGain, EQ_FREQUENCIES } from './equalizer.js';

function GainInput({ value, label, onChange }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => { const next = clampGain(draft); setDraft(String(next)); onChange(next); };
  return <input className="eq-number" type="text" inputMode="numeric" aria-label={`${label} Hz 增益（整数 dB）`} value={draft}
    onChange={(event) => { const next = event.target.value; if (/^-?\d{0,3}$/.test(next)) { setDraft(next); if (/^-?\d+$/.test(next) && Number(next) >= -12 && Number(next) <= 12) onChange(Number(next)); } }}
    onBlur={commit} onKeyDown={(event) => {
      if (event.key === 'Enter') { commit(); event.currentTarget.blur(); }
      if (['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); const next = clampGain(value + (event.key === 'ArrowUp' ? 1 : -1)); setDraft(String(next)); onChange(next); }
    }} />;
}

export default function Equalizer({ gains, onChange, onClose }) {
  const panel = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.querySelector('button')?.focus();
    const keydown = (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
      if (event.key !== 'Tab') return;
      const controls = [...panel.current.querySelectorAll('button, input')];
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [onClose]);
  const points = gains.map((gain, index) => `${(index + .5) * 100 / gains.length},${(12 - gain) * 100 / 24}`).join(' ');
  const dragGain = (event, index) => {
    const bounds = event.currentTarget.parentElement.getBoundingClientRect();
    onChange(index, clampGain(12 - 24 * (event.clientY - bounds.top) / bounds.height));
  };
  return <div className="eq-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="eq-panel" ref={panel} role="dialog" aria-modal="true" aria-labelledby="eq-title">
      <header><div><h2 id="eq-title">均衡器</h2><p>拖动圆点或输入整数，调整后立即生效</p></div><button className="icon-button" aria-label="关闭均衡器" onClick={onClose}><X size={19} /></button></header>
      <div className="eq-scroll"><div className="eq-chart">
        <div className="eq-scale"><span>+12 dB</span><span>0 dB</span><span>−12 dB</span></div>
        <div className="eq-bands">
          <div className="eq-lines" aria-hidden="true"><i /><i /><i /><svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg></div>
          {EQ_FREQUENCIES.map((frequency, index) => <div className="eq-band" key={frequency}>
            <div className="eq-slider-area"><span className="eq-rail" /><span className="eq-dot" style={{ top: `${(12 - gains[index]) * 100 / 24}%` }} />
              <input type="range" className="eq-slider" min="-12" max="12" step="1" value={gains[index]} aria-label={`${bandLabel(frequency)} Hz`} aria-valuetext={`${gains[index]} dB`} onChange={(event) => onChange(index, clampGain(event.target.value))}
                onPointerDown={(event) => { if (event.button !== 0 || !event.isPrimary) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); dragGain(event, index); }}
                onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) dragGain(event, index); }}
                onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} />
            </div>
            <label><span>{bandLabel(frequency)}<small> Hz</small></span><GainInput value={gains[index]} label={bandLabel(frequency)} onChange={(value) => onChange(index, value)} /><small>dB</small></label>
          </div>)}
        </div>
      </div></div>
      <footer><span>设置自动保存到本机</span><button className="secondary-button" type="button" onClick={() => onChange(null, 0)}><RotateCcw size={15} />恢复 0 dB</button></footer>
    </section>
  </div>;
}
