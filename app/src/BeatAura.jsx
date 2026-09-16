import { useEffect, useRef } from 'react';
import { createAuraEnvelope } from './aura-envelope.mjs';
export default function BeatAura({ graphRef, playing, visible, trackKey }) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current, reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0, last = 0;
    let envelope = createAuraEnvelope();
    const samples = new Float32Array(512);
    const reset = () => { node.style.opacity = '.16'; node.style.transform = 'scale(1)'; };
    const tick = (time) => {
      frame = requestAnimationFrame(tick);
      if (time - last < 33) return;
      const elapsed = last ? (time - last) / 1000 : 1 / 30;
      last = time;
      const analyser = graphRef.current?.analyser;
      if (!analyser) return;
      analyser.getFloatTimeDomainData(samples);
      const level = envelope(samples, elapsed);
      node.style.opacity = String(.16 + level * .72);
      node.style.transform = `scale(${1 + level * .22})`;
    };
    const refresh = () => {
      cancelAnimationFrame(frame); reset(); last = 0; envelope = createAuraEnvelope();
      if (playing && visible && !document.hidden && !reduced.matches) frame = requestAnimationFrame(tick);
    };
    refresh(); document.addEventListener('visibilitychange', refresh); reduced.addEventListener('change', refresh);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', refresh); reduced.removeEventListener('change', refresh); reset(); };
  }, [playing, visible, trackKey, graphRef]);
  return <span ref={ref} className="beat-aura" aria-hidden="true" />;
}
