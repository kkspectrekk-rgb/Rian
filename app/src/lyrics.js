const timePattern = /\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\]/g;

function parseLayer(raw = '') {
  const rows = [];
  const lines = String(raw).split(/\r?\n/);
  lines.forEach((line) => {
    const text = line.replace(timePattern, '').trim();
    const stamps = [...line.matchAll(timePattern)];
    stamps.forEach((stamp) => rows.push({
      time: Number(stamp[1]) * 60 + Number(stamp[2]),
      text,
    }));
  });
  const timed = rows.filter((row) => row.text).sort((a, b) => a.time - b.time);
  if (timed.length) return timed;
  return lines.map((line) => line.trim()).filter((line) => line && !/^\[(ar|al|ti|by|offset|re|ve):/i.test(line)).map((text, index) => ({ time: index * 4, text }));
}

function nearestText(rows, time) {
  let best = null;
  let gap = 0.35;
  rows.forEach((row) => {
    const nextGap = Math.abs(row.time - time);
    if (nextGap <= gap) {
      best = row.text;
      gap = nextGap;
    }
  });
  return best || '';
}

function graphemes(text) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((part) => part.segment);
  }
  return Array.from(text);
}

function approximateWords(text, start, end) {
  const parts = graphemes(text);
  const available = Math.max(0.8, end - start);
  const weights = parts.map((part) => (/\s/.test(part) ? 0.28 : /[，。！？、,.!?]/.test(part) ? 0.5 : 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  let cursor = start;
  return parts.map((part, index) => {
    const duration = available * (weights[index] / total);
    const word = { text: part, start: cursor, end: cursor + duration };
    cursor += duration;
    return word;
  });
}

function parseEnhanced(raw = '') {
  const lines = [];
  String(raw).split(/\r?\n/).forEach((line) => {
    const header = line.match(/^\[(\d+),(\d+)\]/);
    if (!header) return;
    const lineStartMs = Number(header[1]);
    const lineDurationMs = Number(header[2]);
    const words = [];
    const pattern = /\((\d+),(\d+),\d+\)([^()]*)/g;
    for (const match of line.matchAll(pattern)) {
      let wordStartMs = Number(match[1]);
      if (wordStartMs < lineStartMs) wordStartMs += lineStartMs;
      words.push({ text: match[3], start: wordStartMs / 1000, end: (wordStartMs + Number(match[2])) / 1000 });
    }
    if (!words.length) return;
    lines.push({
      time: lineStartMs / 1000,
      duration: lineDurationMs / 1000,
      text: words.map((word) => word.text).join('').trim(),
      words,
    });
  });
  return lines.sort((a, b) => a.time - b.time);
}

export function parseLyrics(original, translated, romanized, wordOriginal = '') {
  const base = parseLayer(original);
  const trans = parseLayer(translated);
  const roman = parseLayer(romanized);
  const enhanced = parseEnhanced(wordOriginal);
  const source = enhanced.length ? enhanced : base;
  return source.map((row, index) => ({
    ...row,
    translation: nearestText(trans, row.time),
    roman: nearestText(roman, row.time),
    words: row.words || approximateWords(row.text, row.time, source[index + 1]?.time || row.time + Math.min(8, Math.max(2.2, graphemes(row.text).length * 0.32))),
  }));
}
