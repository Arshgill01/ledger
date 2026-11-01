import type { ExtractedPromise } from './types.js';

const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100 };

function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : NUM[s.toLowerCase()] ?? 0;
}

function clean(s: string): string {
  return s.replace(/^(i'?ll|i will|i'?m gonna|i am going to|i'?m going to|we'?ll|i)\s+/i, '').replace(/[.!?,]+$/, '').trim();
}

function stake(text: string): string {
  const words = text.split(/\s+/);
  return words.length <= 4 ? text : words.slice(-3).join(' ');
}

/** Offline, rule-based fallback used in demo/hybrid mode when no OpenAI key is present. Deliberately simple. */
export function heuristicExtract(transcript: string): ExtractedPromise[] {
  const out: ExtractedPromise[] = [];
  const sentences = transcript.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  for (const s of sentences) {
    let m = s.match(/if (?:we|chat|you guys|y'all) (?:hit|get|reach|get to)\s+(\d+|[a-z]+)\s+(subs?|subscribers?|followers?|follows?|bits|viewers?)[^,]*?,?\s*(?:then\s+)?(i'?ll|i will|i'?m gonna|i am going to|i'?m going to)\s+(.+)/i);
    if (m && num(m[1])) {
      const metricWord = m[2].toLowerCase();
      const metric = metricWord.startsWith('sub') ? 'subs' : metricWord.startsWith('follow') ? 'follows' : metricWord.startsWith('bit') ? 'bits' : 'viewers';
      const text = clean(m[4]);
      out.push({ text, quote: s, stake: stake(text), confidence: 0.85, condition: { kind: 'count', metric, target: num(m[1]), progress: 0, window: 'stream' } });
      continue;
    }
    m = s.match(/(\d+|[a-z]+)\s+(subs?|follows?|followers?|bits)\s+and\s+(i'?ll|i will|i'?m gonna)\s+(.+)/i);
    if (m && num(m[1])) {
      const metricWord = m[2].toLowerCase();
      const metric = metricWord.startsWith('sub') ? 'subs' : metricWord.startsWith('follow') ? 'follows' : 'bits';
      const text = clean(m[4]);
      out.push({ text, quote: s, stake: stake(text), confidence: 0.8, condition: { kind: 'count', metric, target: num(m[1]), progress: 0, window: 'stream' } });
      continue;
    }
    m = s.match(/if i (die|lose|fail|miss)[^,]*?,?\s*(?:then\s+)?(i'?ll|i will|i'?m gonna|i'?m doing|i am doing)\s+(.+)/i);
    if (m) {
      const text = clean(m[3]);
      out.push({ text, quote: s, stake: stake(text), confidence: 0.8, condition: { kind: 'event', label: s.match(/if i [^,]+/i)?.[0].toLowerCase() ?? 'if it happens' } });
      continue;
    }
    m = s.match(/i owe (?:chat|you guys|you all|y'all)\s+(.+)/i);
    if (m) {
      const text = clean(m[1]);
      out.push({ text, quote: s, stake: stake(text), confidence: 0.9, condition: { kind: 'none' } });
      continue;
    }
    m = s.match(/(i'?ll|i will|i promise (?:to|i'?ll)|i am going to|i'?m gonna)\s+(.+?)\s+(before (?:i|we) (?:sleep|log off|end|go)|tonight|this stream|by the end of (?:the )?stream)/i);
    if (m) {
      const text = clean(m[2]);
      out.push({ text, quote: s, stake: stake(text), confidence: 0.8, condition: { kind: 'time', deadline: '', label: 'end of stream' } });
      continue;
    }
  }
  return out;
}
