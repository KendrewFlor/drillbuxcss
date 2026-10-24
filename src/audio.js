// Synthesised sound — no audio files. WebAudio only starts after a user gesture.
let ctx = null;
let master = null;
let hum = null;
let enabled = true;
let gestured = false; // browsers only allow audio after a user gesture

function ensure() {
  if (!enabled || !gestured) return null;
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, start, dur, type = 'sine', gain = 0.25) {
  const c = ensure();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, c.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(master);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur + 0.05);
}

export const sound = {
  setEnabled(on) {
    enabled = on;
    if (!on) this.drilling(false);
  },
  unlock() { gestured = true; ensure(); },
  click() { tone(880, 0, 0.05, 'square', 0.05); },
  alarm() { for (let i = 0; i < 6; i++) tone(i % 2 ? 660 : 880, i * 0.22, 0.2, 'square', 0.12); },
  cash() { tone(1318, 0, 0.12, 'triangle', 0.15); tone(1760, 0.08, 0.2, 'triangle', 0.15); },
  fanfare() { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, i * 0.09, 0.35, 'sawtooth', 0.08)); },
  thud() { tone(70, 0, 0.35, 'sine', 0.4); },
  good() { tone(660, 0, 0.12, 'sine', 0.15); tone(990, 0.1, 0.25, 'sine', 0.15); },
  bad() { tone(220, 0, 0.3, 'sawtooth', 0.12); tone(165, 0.2, 0.4, 'sawtooth', 0.12); },
  /** Low rumble while the drill string turns. */
  drilling(on) {
    const c = on ? ensure() : ctx;
    if (!c) return;
    if (on && !hum) {
      const len = c.sampleRate * 2;
      const buf = c.createBuffer(1, len, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 160;
      const g = c.createGain();
      g.gain.value = 0;
      g.gain.linearRampToValueAtTime(0.5, c.currentTime + 0.4);
      src.connect(lp).connect(g).connect(master);
      src.start();
      hum = { src, g };
    } else if (!on && hum) {
      const h = hum;
      hum = null;
      h.g.gain.linearRampToValueAtTime(0, c.currentTime + 0.3);
      h.src.stop(c.currentTime + 0.35);
    }
  },
};
