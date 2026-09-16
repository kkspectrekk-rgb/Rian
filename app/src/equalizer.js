export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_STORAGE_KEY = 'rain_equalizer_v1';
export const clampGain = (value) => Math.max(-12, Math.min(12, Math.round(Number(value) || 0)));
export const bandLabel = (frequency) => frequency >= 1000 ? `${frequency / 1000}k` : String(frequency);
export function loadEqualizer() {
  try {
    const saved = JSON.parse(localStorage.getItem(EQ_STORAGE_KEY));
    return EQ_FREQUENCIES.map((_, index) => clampGain(saved?.[index]));
  } catch { return EQ_FREQUENCIES.map(() => 0); }
}

export function createEqualizerGraph(context, audio) {
  const source = context.createMediaElementSource(audio);
  const preamp = context.createGain();
  const filters = EQ_FREQUENCIES.map((frequency) => {
    const filter = context.createBiquadFilter();
    filter.type = 'peaking';
    filter.frequency.value = Math.min(frequency, context.sampleRate / 2 - 1);
    filter.Q.value = 1.4;
    return filter;
  });
  source.connect(preamp);
  filters.reduce((previous, filter) => { previous.connect(filter); return filter; }, preamp).connect(context.destination);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = .65;
  filters[filters.length - 1].connect(analyser);
  return { context, source, preamp, filters, analyser };
}

export function applyEqualizer(graph, gains) {
  const { context, filters, preamp } = graph;
  filters.forEach((filter, index) => {
    filter.gain.cancelScheduledValues(context.currentTime);
    filter.gain.setTargetAtTime(clampGain(gains[index]), context.currentTime, .015);
  });
  // Reserve headroom for boosted bands; attenuation remains neutral at 0 dB.
  const boost = Math.max(0, ...gains.map(clampGain));
  preamp.gain.setTargetAtTime(10 ** (-boost / 20), context.currentTime, .015);
}
