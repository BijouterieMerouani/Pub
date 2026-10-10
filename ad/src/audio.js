import { rng } from './util.js';

// Fully synthesized 10-second score, rendered offline so it is sample-exact
// and identical in the live player and in the exported MP4.
//
// Sync map (seconds):
//   0.0  sub drone + air          2.0  lid opens: whoosh, thud    2.3  gold shimmer
//   2.5  pulse builds             4.0  cut into macro             4.55 hairline tick
//   4.75 crack + cinematic boom   5.2 / 6.1 whooshes on the cuts  6.15 pour, 6.6 splash
//   7.0  flare, Hijaz oud phrase, darbuka (maqsum)                8.3  riser
//   8.92 breath of silence        9.0  logo impact + bell chord

export const SAMPLE_RATE = 48000;
const LEN = 10;

export const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
// D Hijaz: D Eb F# G A Bb C
export const D3 = 50, Eb3 = 51, Fs3 = 54, G3 = 55, A3 = 57, Bb3 = 58, C4 = 60, D4 = 62;

// Shared synthesis kit: mix bus, hall reverb, noise and the instruments used by
// every score (whoosh, thump, bell, Karplus-Strong pluck, pad).
export function createKit(sr, len, seed) {
  const ctx = new OfflineAudioContext(2, sr * len, sr);
  const R = rng(seed);

  const master = ctx.createGain();
  master.gain.value = 0.85;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 6;
  comp.ratio.value = 5;
  comp.attack.value = 0.003;
  comp.release.value = 0.18;
  master.connect(comp).connect(ctx.destination);

  // Hall reverb from a synthesized impulse.
  const verb = ctx.createConvolver();
  {
    const n = sr * 3.0;
    const ir = ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < n; i++) {
        const x = i / sr;
        d[i] = (R() * 2 - 1) * Math.pow(1 - i / n, 2.2) * Math.exp(-x * 1.4) * (x < 0.012 ? x / 0.012 : 1);
      }
    }
    verb.buffer = ir;
  }
  const verbOut = ctx.createGain();
  verbOut.gain.value = 0.45;
  verb.connect(verbOut).connect(master);

  const noise = ctx.createBuffer(1, sr * len, sr);
  {
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = R() * 2 - 1;
  }

  // Route a node to the mix with optional reverb send and pan.
  const out = (node, { gain = 1, wet = 0.2, pan = 0 } = {}) => {
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    node.connect(g).connect(p);
    p.connect(master);
    if (wet) {
      const w = ctx.createGain();
      w.gain.value = wet;
      p.connect(w).connect(verb);
    }
    return g;
  };

  const env = (param, pts) => {
    param.setValueAtTime(pts[0][1], pts[0][0]);
    for (let i = 1; i < pts.length; i++) {
      const [t, v, kind] = pts[i];
      if (kind === 'exp') param.exponentialRampToValueAtTime(Math.max(v, 1e-5), t);
      else if (kind === 'set') param.setValueAtTime(v, t);
      else param.linearRampToValueAtTime(v, t);
    }
  };

  const osc = (type, freq, start, stop) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    o.start(start);
    o.stop(stop);
    return o;
  };

  const noiseSrc = (start, dur) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.start(start, (R() * (len - dur - 0.1)) % (len - dur), dur);
    return s;
  };

  const filter = (type, f, Q = 0.7) => {
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = Q;
    return b;
  };

  // --- Dark pad: Dm -> Bb -> D (Hijaz colour) through a slowly opening filter.
  const pad = (notes, t0, t1, peak, f0, f1) => {
    const lp = filter('lowpass', f0, 0.9);
    env(lp.frequency, [[t0, f0], [t1, f1, 'exp']]);
    const a = ctx.createGain();
    env(a.gain, [[t0, 0], [t0 + 0.5, peak], [t1 - 0.25, peak], [t1, 0]]);
    lp.connect(a);
    out(a, { wet: 0.5 });
    for (const n of notes) for (const det of [-7, 7]) {
      const o = osc('sawtooth', midi(n), t0, t1 + 0.05);
      o.detune.value = det;
      o.connect(lp);
    }
  };

  // --- Whoosh helper.
  const whoosh = (t, dur, f0, f1, gain, pan = 0) => {
    const s = noiseSrc(t, dur);
    const bp = filter('bandpass', f0, 1.4);
    env(bp.frequency, [[t, f0], [t + dur, f1, 'exp']]);
    const a = ctx.createGain();
    env(a.gain, [[t, 0], [t + dur * 0.65, gain], [t + dur, 0]]);
    s.connect(bp).connect(a);
    out(a, { wet: 0.35, pan });
  };

  // --- Low thump helper (pitch-dropping sine).
  const thump = (t, f0, f1, dur, gain) => {
    const o = osc('sine', f0, t, t + dur + 0.05);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const a = ctx.createGain();
    env(a.gain, [[t, 0], [t + 0.004, gain], [t + dur, 0.0001, 'exp']]);
    o.connect(a);
    out(a, { wet: 0.15 });
  };

  // --- Bell: inharmonic partials with exponential decay.
  const bell = (t, f, gain, decay = 2.2, pan = 0) => {
    for (const [ratio, g] of [[1, 1], [2.0, 0.45], [2.76, 0.35], [4.07, 0.18], [5.43, 0.1]]) {
      const o = osc('sine', f * ratio, t, Math.min(len, t + decay));
      const a = ctx.createGain();
      env(a.gain, [[t, 0], [t + 0.003, gain * g], [Math.min(len, t + decay / ratio), 0.0001, 'exp']]);
      o.connect(a);
      out(a, { wet: 0.6, pan });
    }
  };

  // --- Plucked oud-like string (Karplus-Strong).
  const pluck = (t, f, gain, dur = 1.2, pan = 0) => {
    const n = Math.floor(sr * dur);
    const buf = ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    const period = sr / f;
    const N = Math.floor(period);
    const frac = period - N;
    const line = new Float32Array(N + 2);
    for (let i = 0; i < line.length; i++) line[i] = (R() * 2 - 1) * (1 - i / line.length * 0.5);
    let idx = 0, prev = 0;
    for (let i = 0; i < n; i++) {
      const a = line[idx % line.length];
      const b = line[(idx + 1) % line.length];
      const v = a * (1 - frac) + b * frac;
      const y = 0.996 * (0.5 * v + 0.5 * prev);
      prev = v;
      line[idx % line.length] = y;
      d[i] = y;
      idx++;
    }
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const body = filter('peaking', 280, 1.2);
    body.gain.value = 6;
    const lp = filter('lowpass', 3200, 0.6);
    const a = ctx.createGain();
    a.gain.value = gain;
    s.connect(body).connect(lp).connect(a);
    out(a, { wet: 0.35, pan });
    s.start(t);
  };

  async function finish(fade = 0.25) {
    const buf = await ctx.startRendering();
    // Short fade on the last frames so playback ends without a click.
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      const n = Math.floor(sr * fade);
      for (let i = 0; i < n; i++) d[d.length - n + i] *= Math.pow(1 - i / n, 1.5);
    }
    return buf;
  }
  return { ctx, R, master, verb, out, env, osc, noiseSrc, filter, pad, whoosh, thump, bell, pluck, finish };
}

// EBCORE 10 s score. variant 'crack' (3D cut: bonbon cracks, shards, pour) or
// 'tour' (photo cut: four macro shots on the beat at 4.0 / 4.75 / 5.5 / 6.25 s).
export async function renderSoundtrack(sr = SAMPLE_RATE, { variant = 'crack' } = {}) {
  const { ctx, R, out, env, osc, noiseSrc, filter, pad, whoosh, thump, bell, pluck, finish } = createKit(sr, LEN, 1987);

  // --- Sub drone (D1 + A1), carries the darkness, cut for the final breath.
  for (const [f, g] of [[36.71, 0.55], [55.0, 0.28], [73.42, 0.1]]) {
    const o = osc('sine', f, 0, 8.93);
    const a = ctx.createGain();
    env(a.gain, [[0, 0], [1.6, g], [4.6, g], [4.75, g * 0.4], [5.6, g * 0.9], [8.6, g], [8.92, 0]]);
    o.connect(a);
    out(a, { wet: 0 });
  }

  // --- Air: filtered noise bed that swells into the lid opening.
  {
    const s = noiseSrc(0, 9.0);
    const bp = filter('bandpass', 300, 0.8);
    env(bp.frequency, [[0, 220], [1.95, 2600, 'exp'], [2.2, 900, 'exp'], [8.9, 700]]);
    const a = ctx.createGain();
    env(a.gain, [[0, 0.0], [0.6, 0.05], [1.95, 0.32], [2.25, 0.05], [8.9, 0.04], [8.92, 0]]);
    s.connect(bp).connect(a);
    out(a, { wet: 0.4 });
  }

  pad([D3 - 12, D3, 53, A3], 0.3, 4.75, 0.05, 160, 1400);
  pad([Bb3 - 12, D3, 53, Bb3], 4.75, 7.0, 0.045, 500, 900);
  pad([D3 - 12, D3, Fs3, A3], 7.0, 8.92, 0.05, 700, 2200);


  // ===== Timeline =====

  // 2.0 Lid opens.
  whoosh(1.75, 0.6, 300, 2400, 0.35);
  thump(2.02, 95, 38, 0.6, 0.6);
  {
    // Soft hinge creak: a rough, resonant scrape.
    const s = noiseSrc(2.0, 0.45);
    const bp = filter('bandpass', 1300, 9);
    env(bp.frequency, [[2.0, 1100], [2.45, 1700]]);
    const a = ctx.createGain();
    env(a.gain, [[2.0, 0], [2.08, 0.05], [2.45, 0]]);
    s.connect(bp).connect(a);
    out(a, { wet: 0.3, pan: -0.2 });
  }
  // 2.3 Shimmer of gold.
  [D4 + 24, Fs3 + 36, A3 + 36, D4 + 36].forEach((n, i) => bell(2.3 + i * 0.09, midi(n), 0.05, 2.4, (i - 1.5) * 0.4));
  for (let i = 0; i < 26; i++) {
    const t = 2.35 + R() * 1.5;
    bell(t, 3000 + R() * 5000, 0.006 + R() * 0.01, 0.6, R() * 2 - 1);
  }

  // 2.5-4.4 Pulse: a heartbeat kick and a rising tick.
  [2.5, 3.0, 3.5, 3.75, 4.0, 4.25].forEach((t, i) => thump(t, 120, 42, 0.32, 0.28 + i * 0.06));
  for (let i = 0; i < 22; i++) {
    const t = 3.0 + i * 0.0625;
    if (t > 4.38) break;
    const s = noiseSrc(t, 0.03);
    const hp = filter('highpass', 7000, 0.7);
    const a = ctx.createGain();
    env(a.gain, [[t, 0.02 + i * 0.002], [t + 0.03, 0.0001, 'exp']]);
    s.connect(hp).connect(a);
    out(a, { wet: 0.1, pan: i % 2 ? 0.3 : -0.3 });
  }
  // 4.0 Cut into the macro world: reverse-style swell into the cut.
  whoosh(3.7, 0.32, 600, 5000, 0.22);
  // 4.35-4.75 Pressure: rising tension tone.
  {
    const o = osc('sine', 600, 4.3, 4.76);
    o.frequency.exponentialRampToValueAtTime(1400, 4.75);
    const a = ctx.createGain();
    env(a.gain, [[4.3, 0], [4.74, 0.05], [4.75, 0]]);
    o.connect(a);
    out(a, { wet: 0.4 });
  }

  // Photo cut: one accent per chocolate, rising through the Hijaz scale.
  const tourAccents = () => {
    [[4.0, D4 + 12], [4.75, Fs3 + 24], [5.5, A3 + 24], [6.25, D4 + 24]].forEach(([t, n], i) => {
      if (i) whoosh(t - 0.22, 0.24, 500, 4200, 0.16, i % 2 ? 0.35 : -0.35);
      thump(t, 140, 48, 0.3, 0.42);
      bell(t + 0.01, midi(n), 0.045, 1.6, (i - 1.5) * 0.3);
      for (let j = 0; j < 4; j++) bell(t + 0.08 + R() * 0.5, 2600 + R() * 4000, 0.007, 0.5, R() * 2 - 1);
    });
    // A soft swell under the last shot, then into the flare at 7.0.
    const s = noiseSrc(6.3, 0.7);
    const lp = filter('lowpass', 700, 0.7);
    const a = ctx.createGain();
    env(a.gain, [[6.3, 0], [6.95, 0.08], [7.0, 0]]);
    s.connect(lp).connect(a);
    out(a, { wet: 0.4 });
  };
  const crackSection = () => {
    // Chocolate snap: a cluster of bright, resonant micro-cracks.
    const crack = (t, count, spread, gain) => {
      for (let i = 0; i < count; i++) {
        const tt = t + (i === 0 ? 0 : Math.pow(R(), 1.6) * spread);
        const len = 0.004 + R() * 0.01;
        const s = noiseSrc(tt, len + 0.02);
        const bp = filter('bandpass', 2200 + R() * 4200, 3 + R() * 6);
        const a = ctx.createGain();
        const g = gain * (i === 0 ? 1 : 0.25 + R() * 0.6);
        env(a.gain, [[tt, 0], [tt + 0.0008, g], [tt + len, 0.0001, 'exp']]);
        s.connect(bp).connect(a);
        out(a, { wet: 0.25, pan: (R() - 0.5) * 0.6 });
      }
    };
    crack(4.55, 3, 0.02, 0.35);
    crack(4.75, 14, 0.09, 1.0);
    thump(4.75, 180, 70, 0.12, 0.5);
    // Cinematic boom under the crack.
    thump(4.76, 70, 26, 1.6, 0.95);
    {
      const s = noiseSrc(4.75, 1.2);
      const lp = filter('lowpass', 260, 0.7);
      const a = ctx.createGain();
      env(a.gain, [[4.75, 0], [4.77, 0.5], [5.9, 0.0001, 'exp']]);
      s.connect(lp).connect(a);
      out(a, { wet: 0.6 });
    }
    // Slow-motion shards: delicate tinkles.
    for (let i = 0; i < 9; i++) bell(4.9 + i * 0.13 + R() * 0.05, 1800 + R() * 2600, 0.01, 0.5, R() * 2 - 1);

    // 5.2 and 6.1 cut whooshes.
    whoosh(5.0, 0.32, 400, 3500, 0.2, 0.4);
    whoosh(5.9, 0.32, 350, 3000, 0.2, -0.4);

    // 6.15-7.0 Pour: low gloopy liquid with a soft splash on landing.
    {
      const s = noiseSrc(6.15, 0.9);
      const lp = filter('lowpass', 500, 4);
      env(lp.frequency, [[6.15, 300], [6.6, 900, 'exp'], [7.0, 450]]);
      const a = ctx.createGain();
      env(a.gain, [[6.15, 0], [6.3, 0.12], [6.9, 0.16], [7.0, 0]]);
      s.connect(lp).connect(a);
      out(a, { wet: 0.25 });
      for (let i = 0; i < 6; i++) {
        const t = 6.58 + i * 0.065 + R() * 0.03;
        const o = osc('sine', 340 - i * 20, t, t + 0.12);
        o.frequency.exponentialRampToValueAtTime(140, t + 0.1);
        const g = ctx.createGain();
        env(g.gain, [[t, 0], [t + 0.005, 0.1], [t + 0.1, 0.0001, 'exp']]);
        o.connect(g);
        out(g, { wet: 0.2 });
      }
    }
  };
  variant === 'tour' ? tourAccents() : crackSection();

  // 7.0 Flare + Hijaz phrase + darbuka.
  whoosh(6.75, 0.3, 500, 6000, 0.3);
  bell(7.0, midi(D4 + 12), 0.06, 2.0);
  const phrase = [
    [7.0, D4], [7.18, Eb3 + 12], [7.32, Fs3 + 12], [7.46, G3 + 12], [7.62, A3 + 12],
    [7.92, Bb3 + 12], [8.06, A3 + 12], [8.22, G3 + 12], [8.36, Fs3 + 12], [8.5, Eb3 + 12], [8.66, D4],
  ];
  phrase.forEach(([t, n], i) => {
    pluck(t, midi(n), 0.55, 1.1, -0.15);
    if (i % 2 === 0) pluck(t + 0.012, midi(n - 12), 0.25, 1.1, 0.15);
  });
  // Maqsum at 120 bpm: D T . T D . T .
  const doum = (t, g) => {
    thump(t, 110, 58, 0.28, g);
    const s = noiseSrc(t, 0.05);
    const lp = filter('lowpass', 900, 0.7);
    const a = ctx.createGain();
    env(a.gain, [[t, 0], [t + 0.002, g * 0.3], [t + 0.05, 0.0001, 'exp']]);
    s.connect(lp).connect(a);
    out(a, { wet: 0.2 });
  };
  const tek = (t, g) => {
    const s = noiseSrc(t, 0.06);
    const bp = filter('bandpass', 3200, 1.5);
    const a = ctx.createGain();
    env(a.gain, [[t, 0], [t + 0.001, g], [t + 0.05, 0.0001, 'exp']]);
    s.connect(bp).connect(a);
    out(a, { wet: 0.2, pan: 0.25 });
    const o = osc('triangle', 820, t, t + 0.05);
    const ag = ctx.createGain();
    env(ag.gain, [[t, 0], [t + 0.001, g * 0.3], [t + 0.04, 0.0001, 'exp']]);
    o.connect(ag);
    out(ag, { wet: 0.2, pan: 0.25 });
  };
  for (let bar = 0; bar < 2; bar++) {
    const b = 7.0 + bar * 1.0;
    const step = 0.125;
    [[0, 'D'], [1, 'T'], [3, 'T'], [4, 'D'], [6, 'T']].forEach(([k, kind]) => {
      const t = b + k * step;
      if (t > 8.85) return;
      kind === 'D' ? doum(t, 0.5) : tek(t, 0.22);
    });
  }

  // 8.3-8.92 Riser, then a breath of silence.
  {
    const s = noiseSrc(8.3, 0.62);
    const hp = filter('bandpass', 800, 1.2);
    env(hp.frequency, [[8.3, 600], [8.9, 9000, 'exp']]);
    const a = ctx.createGain();
    env(a.gain, [[8.3, 0], [8.88, 0.32], [8.92, 0]]);
    s.connect(hp).connect(a);
    out(a, { wet: 0.3 });
    const o = osc('sawtooth', 110, 8.3, 8.93);
    o.frequency.exponentialRampToValueAtTime(440, 8.9);
    const lp = filter('lowpass', 1200, 0.7);
    const g = ctx.createGain();
    env(g.gain, [[8.3, 0], [8.88, 0.06], [8.92, 0]]);
    o.connect(lp).connect(g);
    out(g, { wet: 0.3 });
  }

  // 9.0 Logo impact.
  thump(9.0, 62, 27, 1.0, 1.0);
  {
    const s = noiseSrc(9.0, 1.0);
    const lp = filter('lowpass', 1800, 0.7);
    env(lp.frequency, [[9.0, 2400], [9.6, 200, 'exp']]);
    const a = ctx.createGain();
    env(a.gain, [[9.0, 0], [9.003, 0.55], [9.9, 0.0001, 'exp']]);
    s.connect(lp).connect(a);
    out(a, { wet: 0.7 });
  }
  // Warm, piano-like chord (D major with A in the bass) plus bells.
  for (const n of [D3 - 12, A3 - 12, D3, Fs3, A3]) {
    for (const [h, g] of [[1, 1], [2, 0.4], [3, 0.15]]) {
      const o = osc('sine', midi(n) * h, 9.0, 10);
      const a = ctx.createGain();
      env(a.gain, [[9.0, 0], [9.01, 0.06 * g], [10, 0.006 * g, 'exp']]);
      o.connect(a);
      out(a, { wet: 0.5 });
    }
  }
  bell(9.02, midi(D4 + 12), 0.07, 2.5, -0.2);
  bell(9.1, midi(A3 + 24), 0.05, 2.5, 0.2);
  bell(9.45, midi(Fs3 + 36), 0.03, 2.0, 0.35);

  return finish();
}

// ASSEL 20 s score. Sync map (seconds):
//   0-4   drone, air, light shimmer, heartbeat, riser   4.0  lid swings open, 4.95 lands
//   6/9/12/15  a chocolate lifts (rising tone), its world appears at +0.9 (impact + bell),
//         theme ambience (sea / forest / cold wind / desert), whoosh back at +2.55
//   15-18 climax: Hijaz oud phrase, full darbuka      17.92 breath    18.0 logo impact
export async function renderAsselSoundtrack(sr = SAMPLE_RATE, themes = ['mer', 'foret', 'montagne', 'desert']) {
  const LEN2 = 20;
  const { ctx, R, out, env, osc, noiseSrc, filter, pad, whoosh, thump, bell, pluck, finish } = createKit(sr, LEN2, 2024);
  const END = 17.92;

  // Sub drone in D, dipping under each reveal impact.
  for (const [f, g] of [[36.71, 0.5], [55.0, 0.25], [73.42, 0.09]]) {
    const o = osc('sine', f, 0, END + 0.01);
    const a = ctx.createGain();
    env(a.gain, [[0, 0], [2.0, g], [END - 0.3, g], [END, 0]]);
    o.connect(a);
    out(a, { wet: 0 });
  }
  // Air bed swelling into the opening.
  {
    const s = noiseSrc(0, END);
    const bp = filter('bandpass', 250, 0.8);
    env(bp.frequency, [[0, 220], [3.95, 2400, 'exp'], [4.6, 800, 'exp'], [END, 900]]);
    const a = ctx.createGain();
    env(a.gain, [[0, 0], [0.8, 0.05], [3.95, 0.26], [4.6, 0.05], [END - 0.1, 0.05], [END, 0]]);
    s.connect(bp).connect(a);
    out(a, { wet: 0.4 });
  }
  // Harmony: Dm -> Bb -> Gm -> A -> D (Hijaz colour on the climax).
  pad([D3 - 12, D3, 53, A3], 0.3, 6.0, 0.045, 160, 1300);
  pad([Bb3 - 12, D3, 53, Bb3], 6.0, 9.0, 0.045, 500, 1100);
  pad([G3 - 12, Bb3 - 12, D3, G3], 9.0, 12.0, 0.045, 600, 1300);
  pad([A3 - 12, 61 - 12, 64 - 12, A3], 12.0, 15.0, 0.05, 700, 1700);
  pad([D3 - 12, D3, Fs3, A3, D4], 15.0, END, 0.055, 900, 2800);

  // 0-4: light shimmer, heartbeat, riser.
  for (let i = 0; i < 18; i++) bell(1.0 + R() * 2.6, 2600 + R() * 4500, 0.005 + R() * 0.008, 0.7, R() * 2 - 1);
  [2.0, 2.5, 3.0, 3.25, 3.5, 3.75].forEach((t, i) => thump(t, 115, 42, 0.32, 0.25 + i * 0.05));
  {
    const o = osc('sine', 300, 3.3, 4.02);
    o.frequency.exponentialRampToValueAtTime(900, 4.0);
    const a = ctx.createGain();
    env(a.gain, [[3.3, 0], [3.98, 0.045], [4.0, 0]]);
    o.connect(a);
    out(a, { wet: 0.4 });
  }
  // 4.0 the lid swings open, lands at ~4.95.
  whoosh(3.85, 0.7, 250, 2200, 0.32);
  {
    const s = noiseSrc(4.05, 0.75);
    const bp = filter('bandpass', 1200, 9);
    env(bp.frequency, [[4.05, 1000], [4.8, 1600]]);
    const a = ctx.createGain();
    env(a.gain, [[4.05, 0], [4.2, 0.045], [4.8, 0]]);
    s.connect(bp).connect(a);
    out(a, { wet: 0.3, pan: -0.15 });
  }
  thump(4.95, 90, 36, 0.7, 0.75);
  [D4 + 24, Fs3 + 36, A3 + 36, D4 + 36].forEach((n, i) => bell(5.0 + i * 0.08, midi(n), 0.045, 2.2, (i - 1.5) * 0.4));
  for (let i = 0; i < 16; i++) bell(5.05 + R() * 1.0, 3000 + R() * 5000, 0.006 + R() * 0.008, 0.6, R() * 2 - 1);

  // Rhythm 6-18: kick on the half beat, ticks from 9, darbuka (maqsum) from 12.
  for (let t = 6.0; t < END - 0.05; t += 0.5) thump(t, 120, 44, 0.3, t < 12 ? 0.26 : 0.34);
  for (let t = 9.0; t < END - 0.05; t += 0.125) {
    const s = noiseSrc(t, 0.03);
    const hp = filter('highpass', 7500, 0.7);
    const a = ctx.createGain();
    env(a.gain, [[t, 0.012 + (t > 15 ? 0.01 : 0)], [t + 0.03, 0.0001, 'exp']]);
    s.connect(hp).connect(a);
    out(a, { wet: 0.1, pan: Math.round(t * 8) % 2 ? 0.3 : -0.3 });
  }
  const doum = (t, g) => {
    thump(t, 110, 58, 0.26, g);
    const s = noiseSrc(t, 0.05);
    const lp = filter('lowpass', 900, 0.7);
    const a = ctx.createGain();
    env(a.gain, [[t, 0], [t + 0.002, g * 0.3], [t + 0.05, 0.0001, 'exp']]);
    s.connect(lp).connect(a);
    out(a, { wet: 0.2 });
  };
  const tek = (t, g) => {
    const s = noiseSrc(t, 0.06);
    const bp = filter('bandpass', 3200, 1.5);
    const a = ctx.createGain();
    env(a.gain, [[t, 0], [t + 0.001, g], [t + 0.05, 0.0001, 'exp']]);
    s.connect(bp).connect(a);
    out(a, { wet: 0.2, pan: 0.25 });
  };
  for (let b = 12.0; b < END - 0.1; b += 1.0) {
    [[0, 'D'], [1, 'T'], [3, 'T'], [4, 'D'], [6, 'T'], [7, b >= 15 ? 'T' : '']].forEach(([k, kind]) => {
      const t = b + k * 0.125;
      if (!kind || t > END - 0.05) return;
      kind === 'D' ? doum(t, b >= 15 ? 0.55 : 0.4) : tek(t, b >= 15 ? 0.24 : 0.16);
    });
  }

  // Theme ambiences.
  const ambience = {
    mer(t0, t1) {
      // Waves: swelling low noise with a foamy top.
      for (let w = t0; w < t1; w += 0.9) {
        const s = noiseSrc(w, 1.2);
        const lp = filter('lowpass', 900, 0.6);
        env(lp.frequency, [[w, 400], [w + 0.5, 1800, 'exp'], [w + 1.2, 500, 'exp']]);
        const a = ctx.createGain();
        env(a.gain, [[w, 0], [w + 0.45, 0.16], [w + 1.2, 0]]);
        s.connect(lp).connect(a);
        out(a, { wet: 0.35, pan: R() - 0.5 });
      }
    },
    foret(t0, t1) {
      const s = noiseSrc(t0, t1 - t0);
      const bp = filter('bandpass', 700, 0.5);
      const a = ctx.createGain();
      env(a.gain, [[t0, 0], [t0 + 0.4, 0.06], [t1 - 0.3, 0.06], [t1, 0]]);
      s.connect(bp).connect(a);
      out(a, { wet: 0.4 });
      // Bird calls: quick warbling chirps.
      for (let i = 0; i < 7; i++) {
        const t = t0 + 0.2 + R() * (t1 - t0 - 0.5);
        const f = 2600 + R() * 1800;
        for (let j = 0; j < 3; j++) {
          const tt = t + j * 0.07;
          const o = osc('sine', f, tt, tt + 0.06);
          o.frequency.exponentialRampToValueAtTime(f * (1.3 + R() * 0.3), tt + 0.05);
          const g = ctx.createGain();
          env(g.gain, [[tt, 0], [tt + 0.01, 0.025], [tt + 0.06, 0.0001, 'exp']]);
          o.connect(g);
          out(g, { wet: 0.5, pan: R() * 1.6 - 0.8 });
        }
      }
    },
    montagne(t0, t1) {
      const s = noiseSrc(t0, t1 - t0);
      const bp = filter('bandpass', 1800, 1.2);
      env(bp.frequency, [[t0, 1400], [t0 + (t1 - t0) / 2, 2400, 'exp'], [t1, 1500, 'exp']]);
      const a = ctx.createGain();
      env(a.gain, [[t0, 0], [t0 + 0.5, 0.07], [t1 - 0.3, 0.07], [t1, 0]]);
      s.connect(bp).connect(a);
      out(a, { wet: 0.5 });
      for (let i = 0; i < 10; i++) bell(t0 + R() * (t1 - t0 - 0.3), 3500 + R() * 4000, 0.008, 1.2, R() * 2 - 1);
    },
    desert(t0, t1) {
      const s = noiseSrc(t0, t1 - t0);
      const bp = filter('bandpass', 420, 0.7);
      const a = ctx.createGain();
      env(a.gain, [[t0, 0], [t0 + 0.4, 0.08], [t1 - 0.3, 0.08], [t1, 0]]);
      s.connect(bp).connect(a);
      out(a, { wet: 0.4 });
      // Hijaz oud phrase over the climax.
      const ph = [[0, D4], [0.16, Eb3 + 12], [0.3, Fs3 + 12], [0.44, G3 + 12], [0.6, A3 + 12], [0.9, Bb3 + 12],
        [1.04, A3 + 12], [1.2, G3 + 12], [1.34, Fs3 + 12], [1.5, Eb3 + 12], [1.66, D4]];
      ph.forEach(([dt, n], i) => {
        pluck(t0 + 0.05 + dt, midi(n), 0.55, 1.1, -0.15);
        if (i % 2 === 0) pluck(t0 + 0.062 + dt, midi(n - 12), 0.25, 1.1, 0.15);
      });
    },
  };

  // Chocolate segments.
  const notes = [D4 + 12, Fs3 + 24, A3 + 24, D4 + 24];
  themes.forEach((name, i) => {
    const s = 6 + i * 3;
    const last = i === themes.length - 1;
    // Lift: a soft glide upward.
    const o = osc('sine', 420, s, s + 1.0);
    o.frequency.exponentialRampToValueAtTime(840, s + 0.95);
    const g = ctx.createGain();
    env(g.gain, [[s, 0], [s + 0.85, 0.04], [s + 0.95, 0]]);
    o.connect(g);
    out(g, { wet: 0.5 });
    whoosh(s + 0.55, 0.35, 400, 5000, 0.2);
    // Reveal impact.
    thump(s + 0.9, 70, 30, last ? 1.3 : 0.9, last ? 0.85 : 0.6);
    bell(s + 0.91, midi(notes[i]), last ? 0.07 : 0.05, 2.2, (i - 1.5) * 0.25);
    if (last) bell(s + 0.93, midi(A3 + 24), 0.04, 2.0, 0.3);
    (ambience[name] || ambience.desert)(s + 0.75, s + 2.75);
    // Back into the box.
    whoosh(s + 2.5, 0.38, 3000, 500, 0.16, i % 2 ? 0.3 : -0.3);
    thump(s + 2.96, 160, 70, 0.12, 0.25);
  });

  // 18.0 logo impact.
  thump(18.0, 62, 27, 1.2, 1.0);
  {
    const s = noiseSrc(18.0, 1.4);
    const lp = filter('lowpass', 1800, 0.7);
    env(lp.frequency, [[18.0, 2400], [18.8, 200, 'exp']]);
    const a = ctx.createGain();
    env(a.gain, [[18.0, 0], [18.003, 0.5], [19.4, 0.0001, 'exp']]);
    s.connect(lp).connect(a);
    out(a, { wet: 0.7 });
  }
  for (const n of [D3 - 12, A3 - 12, D3, Fs3, A3]) {
    for (const [h, g] of [[1, 1], [2, 0.4], [3, 0.15]]) {
      const o2 = osc('sine', midi(n) * h, 18.0, LEN2);
      const a = ctx.createGain();
      env(a.gain, [[18.0, 0], [18.01, 0.06 * g], [LEN2, 0.004 * g, 'exp']]);
      o2.connect(a);
      out(a, { wet: 0.5 });
    }
  }
  bell(18.02, midi(D4 + 12), 0.07, 2.0, -0.2);
  bell(18.12, midi(A3 + 24), 0.05, 1.9, 0.2);
  bell(18.5, midi(Fs3 + 36), 0.03, 1.5, 0.35);
  return finish(0.4);
}

// 16-bit PCM WAV encoder.
export function encodeWav(buffer) {
  const ch = buffer.numberOfChannels, sr = buffer.sampleRate, n = buffer.length;
  const data = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  data.setUint32(4, 36 + n * ch * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, ch, true);
  data.setUint32(24, sr, true);
  data.setUint32(28, sr * ch * 2, true);
  data.setUint16(32, ch * 2, true);
  data.setUint16(34, 16, true);
  str(36, 'data');
  data.setUint32(40, n * ch * 2, true);
  const chans = [...Array(ch)].map((_, c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return data.buffer;
}
