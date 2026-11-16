// Effects are short synth hits made in the browser. Music is two recorded loops (base game and The Getaway)
// listed in assets/audio/loops.json; if they fail to load, a synthesized four-chord loop plays instead.

let ctx, master, musicBus, fxBus, started = false, muted = false;
const mood = { free: false, heat: 0 };

export function start() { // browsers only allow sound after a click or key press
  if (started) return;
  started = true;
  ctx = new AudioContext();
  master = ctx.createGain();
  const squash = ctx.createDynamicsCompressor(); // keeps stacked hits from clipping
  master.connect(squash).connect(ctx.destination);
  musicBus = ctx.createGain(); musicBus.gain.value = 0.5; musicBus.connect(master);
  fxBus = ctx.createGain(); fxBus.gain.value = 0.8; fxBus.connect(master);
  setInterval(schedule, 40);
  loadLoops();
}
export function toggleMute() {
  muted = !muted;
  if (master) master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.03);
  return muted;
}
export const setMood = (m) => { Object.assign(mood, m); mixLoops(); };
export const audioState = () => ({ started, muted, state: ctx?.state, time: ctx?.currentTime, mood: { ...mood }, loops: Object.keys(loops) }); // for checks

// ---- recorded music. Each loop plays from a file that keeps a little audio either side of the loop points,
// so the repeat is cut by the player on exact bar lines and never by the MP3's own padding.
const loops = {};
async function loadLoops() {
  try {
    const list = await fetch('assets/audio/loops.json', { cache: 'no-cache' }).then((r) => r.json());
    for (const [name, at] of Object.entries(list)) {
      const buffer = await ctx.decodeAudioData(await fetch(`assets/audio/${at.file}`).then((r) => r.arrayBuffer()));
      const src = ctx.createBufferSource(), tone = ctx.createBiquadFilter(), gain = ctx.createGain();
      src.buffer = buffer; src.loop = true; src.loopStart = at.start; src.loopEnd = at.end;
      tone.type = 'lowpass'; tone.frequency.value = 20000;
      gain.gain.value = 0;
      src.connect(tone).connect(gain).connect(musicBus);
      src.start(0, at.start);
      loops[name] = { gain, tone };
    }
    mixLoops();
  } catch { /* no files: the synth loop below keeps playing */ }
}
const OPEN = [3200, 5000, 8000, 12000, 16000, 20000]; // the base track brightens as Heat climbs
function mixLoops() {
  if (!loops.base || !loops.chase) return;
  const t = ctx.currentTime;
  loops.base.gain.gain.setTargetAtTime(mood.free ? 0 : 1, t, 0.25);
  loops.chase.gain.gain.setTargetAtTime(mood.free ? 1 : 0, t, 0.25);
  loops.base.tone.frequency.setTargetAtTime(OPEN[mood.heat] ?? 20000, t, 0.2);
}

// ---- building blocks
function tone(bus, freq, at, dur, { type = 'sine', gain = 0.2, to, cutoff } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (to) o.frequency.exponentialRampToValueAtTime(to, at + dur);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
  let node = o;
  if (cutoff) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; o.connect(f); node = f; }
  node.connect(g).connect(bus);
  o.start(at); o.stop(at + dur + 0.03);
}
let noiseBuf;
function noise(bus, at, dur, { gain = 0.2, type = 'highpass', freq = 6000, to } = {}) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; s.loop = true;
  f.type = type; f.frequency.setValueAtTime(freq, at);
  if (to) f.frequency.exponentialRampToValueAtTime(to, at + dur);
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
  s.connect(f).connect(g).connect(bus);
  s.start(at); s.stop(at + dur + 0.03);
}
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const fx = (fn) => (...a) => { if (started) fn(ctx.currentTime, ...a); };

// ---- effects
export const sfx = {
  click: fx((t) => tone(fxBus, 900, t, 0.05, { type: 'square', gain: 0.08 })),
  spin: fx((t) => noise(fxBus, t, 0.35, { gain: 0.18, type: 'bandpass', freq: 400, to: 2400 })),
  land: fx((t) => { tone(fxBus, 110, t, 0.12, { gain: 0.3, to: 55 }); noise(fxBus, t, 0.05, { gain: 0.1 }); }),
  // each win in a chain rings a step higher
  hit: fx((t, chain = 1) => [0, 4, 7].forEach((n, i) => tone(fxBus, hz(69 + chain * 2 + n), t + i * 0.06, 0.3, { type: 'triangle', gain: 0.16 }))),
  pop: fx((t) => { tone(fxBus, 520, t, 0.12, { gain: 0.14, to: 1400 }); noise(fxBus, t, 0.08, { gain: 0.08 }); }),
  heat: fx((t, big) => {
    noise(fxBus, t, 0.3, { gain: 0.22, type: 'bandpass', freq: 5000, to: 600 });
    tone(fxBus, 1600, t, 0.35, { type: 'sawtooth', gain: 0.12, to: 180 });
    if (big) tone(fxBus, 70, t, 0.6, { gain: 0.4, to: 35 });
  }),
  scatter: fx((t) => [0, 0.16].forEach((d) => { tone(fxBus, 880, t + d, 0.14, { type: 'square', gain: 0.1 }); tone(fxBus, 660, t + d + 0.08, 0.14, { type: 'square', gain: 0.1 }); })),
  siren: fx((t) => { for (let i = 0; i < 4; i++) tone(fxBus, i % 2 ? 620 : 880, t + i * 0.3, 0.3, { type: 'sawtooth', gain: 0.1, to: i % 2 ? 880 : 620, cutoff: 2200 }); }),
  car: fx((t) => { tone(fxBus, 90, t, 1.1, { type: 'sawtooth', gain: 0.2, to: 240, cutoff: 900 }); noise(fxBus, t + 0.15, 0.5, { gain: 0.12, type: 'bandpass', freq: 3000, to: 1800 }); }),
  upgrade: fx((t) => [0, 3, 7, 12, 15].forEach((n, i) => tone(fxBus, hz(72 + n), t + i * 0.07, 0.2, { type: 'square', gain: 0.09 }))),
  glitch: fx((t) => { for (let i = 0; i < 6; i++) tone(fxBus, 1900, t + i * 0.12, 0.06, { type: 'square', gain: 0.12 }); tone(fxBus, 55, t, 0.7, { gain: 0.3 }); }),
  tick: fx((t) => tone(fxBus, 1500, t, 0.03, { type: 'square', gain: 0.05 })),
  tier: fx((t, level) => { // 1-4: a longer, higher fanfare each step
    const run = [0, 4, 7, 12, 16, 19, 24].slice(0, 3 + level);
    run.forEach((n, i) => tone(fxBus, hz(64 + n), t + i * 0.09, 0.5, { type: 'sawtooth', gain: 0.13, cutoff: 3000 }));
    tone(fxBus, 60, t, 0.8, { gain: 0.45, to: 30 });
    if (level >= 3) noise(fxBus, t, 1.2, { gain: 0.12, freq: 4000 });
  }),
  busted: fx((t) => { tone(fxBus, 220, t, 1.4, { type: 'sawtooth', gain: 0.2, to: 45, cutoff: 800 }); tone(fxBus, 50, t, 1.6, { gain: 0.5, to: 28 }); }),
};

// ---- music: A minor, one chord a bar (Am F C G), sixteenth-note grid
const CHORDS = [[45, 57, 60, 64], [41, 53, 57, 60], [48, 55, 60, 64], [43, 55, 59, 62]]; // bass note, then the triad
let step = 0, nextAt = 0;
function schedule() {
  if (ctx.state !== 'running' || loops.base) return; // recorded music has taken over
  const bpm = mood.free ? 126 : 96, sixteenth = 60 / bpm / 4;
  if (nextAt < ctx.currentTime) nextAt = ctx.currentTime + 0.05;
  while (nextAt < ctx.currentTime + 0.15) { play(step, nextAt, sixteenth); nextAt += sixteenth; step = (step + 1) % 64; }
}
function play(s, t, d) {
  const [root, ...triad] = CHORDS[(s / 16) | 0], beat = s % 16;
  const level = mood.free ? 5 : mood.heat; // 0-5: how many layers are in
  if (beat === 0) triad.forEach((n) => tone(musicBus, hz(n), t, d * 16, { type: 'triangle', gain: 0.045 })); // pad
  if (beat % 2 === 0) tone(musicBus, hz(root - (beat % 8 === 6 ? 0 : 12) + 12), t, d * 1.8, { type: 'sawtooth', gain: 0.13, cutoff: 500 + level * 160 }); // bass
  if (beat % 4 === 0) tone(musicBus, 120, t, 0.16, { gain: 0.34, to: 42 }); // kick
  if (level >= 1 && beat % 8 === 4) noise(musicBus, t, 0.14, { gain: 0.13, type: 'bandpass', freq: 1900 }); // snare
  if (level >= 2) tone(musicBus, hz(triad[[0, 1, 2, 1][beat % 4]] + 12), t, d * 0.9, { type: 'square', gain: 0.035, cutoff: 2400 }); // arpeggio
  if (level >= 3 && (beat % 2 === 0 || level >= 5)) noise(musicBus, t, 0.03, { gain: 0.05, freq: 8000 }); // hats: eighths, then sixteenths
  if (level >= 4 && beat % 16 === 0) tone(musicBus, hz(triad[2] + 24), t, d * 8, { type: 'sawtooth', gain: 0.03, cutoff: 3200 }); // high lead
}
