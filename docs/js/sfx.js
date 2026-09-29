// Tiny synthesized interface sounds (WebAudio, no assets). Off by default.

let ctx = null;
let enabled = false;

try {
  enabled = localStorage.getItem('meridian.sfx') === 'on';
} catch { /* storage unavailable */ }

function audio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, { dur = 0.07, type = 'sine', vol = 0.035, at = 0, slide = 0 } = {}) {
  if (!enabled) return;
  const a = audio();
  const t0 = a.currentTime + at;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(freq * slide, t0 + dur);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sfx = {
  get enabled() { return enabled; },
  set(on) {
    enabled = on;
    try { localStorage.setItem('meridian.sfx', on ? 'on' : 'off'); } catch { /* ignore */ }
    if (on) tone(880, { dur: 0.09 });
  },
  hover() { tone(1760, { dur: 0.025, type: 'square', vol: 0.008 }); },
  lock() {
    tone(620, { dur: 0.08, type: 'triangle' });
    tone(930, { dur: 0.08, type: 'triangle', at: 0.07 });
    tone(1240, { dur: 0.14, type: 'triangle', at: 0.14, vol: 0.03 });
  },
  release() { tone(700, { dur: 0.16, type: 'sine', slide: 0.5 }); },
  commit() {
    tone(520, { dur: 0.06, type: 'square', vol: 0.015 });
    tone(1040, { dur: 0.12, type: 'sine', at: 0.06 });
  },
  error() { tone(180, { dur: 0.22, type: 'sawtooth', vol: 0.03, slide: 0.7 }); },
  done() {
    [660, 880, 1320].forEach((f, i) => tone(f, { dur: 0.12, type: 'triangle', at: i * 0.09, vol: 0.03 }));
  },
};
