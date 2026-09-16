// Audio-driven envelope: no timer-generated or fake beats.
export function createAuraEnvelope() {
  let peak = .04, baseline = 0, level = 0;
  return (samples, seconds = 1 / 30) => {
    const dt = Math.max(.001, Math.min(.1, seconds));
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    const rms = Math.sqrt(sum / Math.max(1, samples.length));
    peak = Math.max(.04, rms, peak * Math.exp(-dt / 3));
    const onset = Math.max(0, rms - baseline) / Math.max(.008, baseline);
    const body = Math.max(0, rms - .002) / peak;
    const target = rms < .002 ? 0 : Math.min(1, body * .55 + onset * .7);
    baseline += (rms - baseline) * (1 - Math.exp(-dt / .5));
    level += (target - level) * (1 - Math.exp(-dt / (target > level ? .065 : .2)));
    return level;
  };
}
