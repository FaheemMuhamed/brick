// Synthesized ABS-plastic sound cues (no audio files). Every cue is a few milliseconds of shaped noise
// plus a short resonant "body" tone, randomised slightly so repeated actions never sound robotic.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = (() => { try { return localStorage.getItem('brick-atelier:muted') === '1'; } catch { return false; } })();

function audio() {
  if (muted) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
    } catch { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem('brick-atelier:muted', m ? '1' : '0'); } catch { /* storage blocked */ }
}

const jitter = (v: number, amt = 0.08) => v * (1 + (Math.random() * 2 - 1) * amt);

function noiseBurst(c: AudioContext, at: number, dur: number, freq: number, q: number, gain: number) {
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(bp).connect(g).connect(master!);
  src.start(at);
}

function tone(c: AudioContext, at: number, freq: number, dur: number, gain: number, type: OscillatorType = 'sine') {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  o.frequency.exponentialRampToValueAtTime(freq * 0.7, at + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(master!);
  o.start(at);
  o.stop(at + dur + 0.02);
}

/** Part locks onto studs: a crisp double click; bigger parts sound lower and fuller. size = studs in footprint. */
export function snap(size = 2) {
  const c = audio(); if (!c) return;
  const t = c.currentTime;
  const body = jitter(Math.max(380, 1500 / Math.sqrt(size)));
  noiseBurst(c, t, 0.012, jitter(5200), 1.4, 0.9);
  noiseBurst(c, t + jitter(0.018, 0.2), 0.02, jitter(3400), 2.2, 0.55);
  tone(c, t, body, 0.07, 0.22, 'triangle');
}

/** Ghost hops to a new stud: a barely-there tick. */
let lastTick = 0;
export function tick() {
  const c = audio(); if (!c) return;
  const now = c.currentTime;
  if (now - lastTick < 0.035) return;
  lastTick = now;
  noiseBurst(c, now, 0.006, jitter(7000, 0.15), 3, 0.12);
}

/** Part removed or dropped back: a hollow clack. */
export function clack() {
  const c = audio(); if (!c) return;
  const t = c.currentTime;
  noiseBurst(c, t, 0.03, jitter(1800), 1.2, 0.7);
  tone(c, t, jitter(260), 0.09, 0.25, 'triangle');
}

/** Blocked placement: a dull, low thud. */
export function bump() {
  const c = audio(); if (!c) return;
  tone(c, c.currentTime, 140, 0.12, 0.35, 'sine');
}

/** Opening a parts drawer: a short rustle of loose plastic. */
export function rustle() {
  const c = audio(); if (!c) return;
  const t = c.currentTime;
  for (let i = 0; i < 9; i++) noiseBurst(c, t + Math.random() * 0.22, 0.008 + Math.random() * 0.01, jitter(4200, 0.4), 2, 0.12 + Math.random() * 0.12);
}

/** Paint / pick colour: a soft pop. */
export function pop() {
  const c = audio(); if (!c) return;
  tone(c, c.currentTime, jitter(880), 0.06, 0.12, 'sine');
}
