'use strict';
/* Song analysis core: audio samples → beats, key and chords.
   No DOM. Runs in the browser (global SongCore) or in Node (module.exports) for testing.

   Pipeline
   ────────
   1. Onset envelope   : spectral flux on a 1024-pt STFT (hop 512).
   2. Tempo            : autocorrelation of the onset envelope, weighted toward ~120 BPM.
   3. Beats            : dynamic-programming beat tracker (Ellis 2007).
   4. Chroma           : spectral peaks of an 8192-pt STFT (hop 2048), tuning-corrected and folded
                         into 12 pitch classes. Separate treble (100–2100 Hz) and bass (40–250 Hz) chroma.
   5. Beat-sync        : chroma averaged between beats, so each beat gets one chord.
   6. Key              : Krumhansl–Kessler profile correlation on the whole-song chroma.
   7. Chords           : template matching (+ bass root bonus, + small in-key bonus),
                         smoothed with a Viterbi pass that penalises chord changes. */

const SongCore = (() => {
  const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT_NAMES  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const mod12 = (n) => ((n % 12) + 12) % 12;
  const yieldUI = () => new Promise((r) => setTimeout(r, 0));

  /* ---------- FFT (iterative radix-2, in place) ---------- */
  function makeFFT(n) {
    const bits = Math.round(Math.log2(n));
    const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = Math.sin((2 * Math.PI * i) / n); }
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) { r = (r << 1) | ((i >> b) & 1); }
      rev[i] = r;
    }
    const win = new Float64Array(n);
    for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    const re = new Float64Array(n), im = new Float64Array(n), mag = new Float64Array(n / 2 + 1);

    // Windowed magnitude spectrum of x[start … start+n).
    return function spectrum(x, start) {
      for (let i = 0; i < n; i++) {
        const j = start + i;
        re[rev[i]] = (j >= 0 && j < x.length ? x[j] : 0) * win[i];
        im[i] = 0;
      }
      for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1, step = n / size;
        for (let i = 0; i < n; i += size) {
          for (let j = 0, k = 0; j < half; j++, k += step) {
            const a = i + j, b = a + half;
            const tr = re[b] * cos[k] + im[b] * sin[k];
            const ti = im[b] * cos[k] - re[b] * sin[k];
            re[b] = re[a] - tr; im[b] = im[a] - ti;
            re[a] += tr; im[a] += ti;
          }
        }
      }
      for (let k = 0; k <= n / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
      return mag;
    };
  }

  /* ---------- 1. Onset envelope ---------- */
  async function onsetEnvelope(x, sr, progress) {
    const N = 1024, H = 512, spec = makeFFT(N);
    const frames = Math.max(1, Math.floor(x.length / H));
    const env = new Float64Array(frames);
    const kMax = Math.min(N / 2, Math.round((8000 / sr) * N));
    let prev = new Float64Array(kMax + 1);
    for (let t = 0; t < frames; t++) {
      const mag = spec(x, t * H - N / 2);
      let flux = 0;
      for (let k = 1; k <= kMax; k++) {
        const v = Math.log1p(mag[k] * 4);
        if (v > prev[k]) flux += v - prev[k];
        prev[k] = v;
      }
      env[t] = flux;
      if (t % 2000 === 0) { progress(t / frames); await yieldUI(); }
    }
    // Remove the slowly varying part (local mean over ~1 s), keep the positive part, normalise.
    const w = Math.round(sr / H / 2);
    const out = new Float64Array(frames);
    let sum = 0, cnt = 0;
    for (let t = 0; t < Math.min(frames, w); t++) { sum += env[t]; cnt++; }
    for (let t = 0; t < frames; t++) {
      if (t + w < frames) { sum += env[t + w]; cnt++; }
      if (t - w - 1 >= 0) { sum -= env[t - w - 1]; cnt--; }
      out[t] = Math.max(0, env[t] - sum / cnt);
    }
    let sq = 0; for (let t = 0; t < frames; t++) sq += out[t] * out[t];
    const sd = Math.sqrt(sq / frames) || 1;
    for (let t = 0; t < frames; t++) out[t] /= sd;
    return { env: out, fps: sr / H };
  }

  /* ---------- 2. Tempo ---------- */
  function estimatePeriod(env, fps) {
    const n = env.length;
    const minLag = Math.max(2, Math.floor((fps * 60) / 210)), maxLag = Math.min(n - 1, Math.ceil((fps * 60) / 55));
    const ac = new Float64Array(maxLag + 2);
    let best = -Infinity, bestLag = Math.round((fps * 60) / 120);
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0;
      for (let i = lag; i < n; i++) s += env[i] * env[i - lag];
      const bpm = (60 * fps) / lag;
      const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
      ac[lag] = (s / (n - lag)) * prior;
      if (ac[lag] > best) { best = ac[lag]; bestLag = lag; }
    }
    // Slow reading of a fast song? Prefer the double tempo when the half-period beat is nearly as strong.
    const half = Math.round(bestLag / 2);
    if ((60 * fps) / bestLag < 88 && half >= minLag && ac[half] > 0) {
      const raw = (lag) => ac[lag] / Math.exp(-0.5 * Math.pow(Math.log2((60 * fps) / lag / 120) / 0.9, 2));
      if (raw(half) > 0.55 * raw(bestLag)) bestLag = half;
    }
    // Sub-frame precision.
    let period = bestLag;
    if (bestLag > minLag && bestLag < maxLag) {
      const a = ac[bestLag - 1], b = ac[bestLag], c = ac[bestLag + 1];
      const d = a - 2 * b + c;
      if (d < 0) period = bestLag + (0.5 * (a - c)) / d;
    }
    return period;
  }

  /* ---------- 3. Beats (dynamic programming) ---------- */
  function trackBeats(env, period, alpha = 120) {
    const n = env.length;
    const score = new Float64Array(n), back = new Int32Array(n).fill(-1);
    const lo = Math.max(1, Math.round(period / 2)), hi = Math.round(period * 2);
    for (let t = 0; t < n; t++) {
      let bestV = 0, bestP = -1;
      for (let p = Math.max(0, t - hi); p <= t - lo; p++) {
        const d = Math.log((t - p) / period);
        const v = score[p] - alpha * d * d;
        if (v > bestV) { bestV = v; bestP = p; }
      }
      score[t] = env[t] + bestV;
      back[t] = bestP;
    }
    let t = n - 1, bv = -Infinity;
    for (let i = Math.max(0, n - Math.round(period)); i < n; i++) if (score[i] > bv) { bv = score[i]; t = i; }
    const beats = [];
    while (t >= 0) { beats.push(t); t = back[t]; }
    return beats.reverse();
  }

  /* ---------- 4. Chroma ---------- */
  async function chromaFrames(x, sr, progress) {
    const N = 8192, H = 2048, spec = makeFFT(N);
    const binHz = sr / N;
    const kLo = Math.max(2, Math.ceil(40 / binHz)), kHi = Math.min(N / 2 - 1, Math.floor(2100 / binHz));
    const frames = Math.max(1, Math.ceil(x.length / H));
    const peaks = [];           // per frame: [freq, weight, freq, weight, …]
    const energy = new Float64Array(frames);
    let tuneX = 0, tuneY = 0;
    for (let t = 0; t < frames; t++) {
      const start = t * H - N / 2;
      let e = 0;
      for (let i = Math.max(0, start); i < Math.min(x.length, start + N); i++) e += x[i] * x[i];
      energy[t] = Math.sqrt(e / N);
      const mag = spec(x, start);
      let max = 0;
      for (let k = kLo; k <= kHi; k++) if (mag[k] > max) max = mag[k];
      const thr = Math.max(max * 0.03, 1e-4 * N);
      const list = [];
      for (let k = kLo; k <= kHi; k++) {
        const m = mag[k];
        if (m <= thr || m <= mag[k - 1] || m < mag[k + 1]) continue;
        const a = Math.log(mag[k - 1] + 1e-9), b = Math.log(m), c = Math.log(mag[k + 1] + 1e-9);
        const den = a - 2 * b + c;
        const p = den < 0 ? (0.5 * (a - c)) / den : 0;
        const f = (k + p) * binHz;
        const amp = m / (N / 4);                     // ≈ sinusoid amplitude (Hann window)
        const w = Math.log1p(amp * 200);
        list.push(f, amp);
        const midi = 69 + 12 * Math.log2(f / 440);
        const ang = 2 * Math.PI * (midi - Math.round(midi));
        tuneX += w * Math.cos(ang); tuneY += w * Math.sin(ang);
      }
      peaks.push(list);
      if (t % 150 === 0) { progress(t / frames); await yieldUI(); }
    }
    const tuning = Math.atan2(tuneY, tuneX) / (2 * Math.PI);   // semitones, −0.5…0.5

    const treble = [], bass = [];
    for (const list of peaks) {
      const tr = new Float64Array(12), bs = new Float64Array(12);
      suppressHarmonics(list);
      for (let i = 0; i < list.length; i += 2) {
        if (list[i + 1] <= 0) continue;
        const f = list[i], w = Math.log1p(list[i + 1] * 200);
        const midi = 69 + 12 * Math.log2(f / 440) - tuning;
        const r = Math.round(midi);
        const fit = Math.cos(Math.PI * (midi - r)) ** 2;
        const pc = mod12(r);
        if (f >= 100) tr[pc] += w * fit;
        if (f <= 250) bs[pc] += w * fit * (f < 130 ? 1.5 : 1);
      }
      treble.push(tr); bass.push(bs);
    }
    return { treble, bass, energy, fps: sr / H, offset: 0, tuning };
  }

  // Overtones of a note (2×, 3×, 5×… its frequency) look like other notes: the 3rd harmonic of E is B,
  // which would turn C major into Cmaj7. Remove the part of each peak that a lower peak explains.
  // list = [f0, amp0, f1, amp1, …] sorted by frequency; amplitudes are reduced in place.
  function suppressHarmonics(list) {
    for (let i = 2; i < list.length; i += 2) {
      const f = list[i];
      let explained = 0;
      for (let j = 0; j < i; j += 2) {
        const r = f / list[j];
        const h = Math.round(r);
        if (h < 2 || h > 6 || Math.abs(r - h) > 0.012 * h) continue;
        explained = Math.max(explained, list[j + 1] * Math.pow(0.55, h - 1));
      }
      list[i + 1] = Math.max(0, list[i + 1] - explained);
    }
  }

  /* ---------- 6. Key ---------- */
  const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  function corr(a, b) {
    const ma = a.reduce((s, v) => s + v, 0) / 12, mb = b.reduce((s, v) => s + v, 0) / 12;
    let n = 0, da = 0, db = 0;
    for (let i = 0; i < 12; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
    return n / (Math.sqrt(da * db) || 1);
  }
  function detectKey(total) {
    let best = { score: -Infinity };
    for (let tonic = 0; tonic < 12; tonic++) {
      const rot = (prof) => Array.from({ length: 12 }, (_, i) => prof[mod12(i - tonic)]);
      const sMaj = corr(total, rot(KK_MAJOR)), sMin = corr(total, rot(KK_MINOR));
      if (sMaj > best.score) best = { tonic, mode: 'major', score: sMaj };
      if (sMin > best.score) best = { tonic, mode: 'minor', score: sMin };
    }
    const relMajor = best.mode === 'major' ? best.tonic : mod12(best.tonic + 3);
    best.flats = [5, 10, 3, 8, 1].includes(relMajor);            // F B♭ E♭ A♭ D♭ (and their relative minors)
    best.name = (best.flats ? FLAT_NAMES : SHARP_NAMES)[best.tonic] + (best.mode === 'major' ? ' major' : ' minor');
    best.confidence = Math.max(0, Math.min(1, best.score));
    return best;
  }

  // Chords that belong to a key: [root offset from the relative major, quality].
  const DIATONIC = [[0, 'maj'], [0, 'maj7'], [2, 'min'], [2, 'm7'], [4, 'min'], [4, 'm7'], [5, 'maj'], [5, 'maj7'],
    [7, 'maj'], [7, '7'], [9, 'min'], [9, 'm7']];
  function diatonicSet(key) {
    const rel = key.mode === 'major' ? key.tonic : mod12(key.tonic + 3);
    const s = new Set(DIATONIC.map(([o, q]) => `${mod12(rel + o)}|${q}`));
    if (key.mode === 'minor') s.add(`${mod12(key.tonic + 7)}|maj`).add(`${mod12(key.tonic + 7)}|7`);   // harmonic-minor V
    return s;
  }

  /* ---------- 7. Chord templates ---------- */
  const QUALITIES = {
    maj:  { iv: [0, 4, 7],      w: [1, 1, 1],       sfx: '' },
    min:  { iv: [0, 3, 7],      w: [1, 1, 1],       sfx: 'm' },
    7:    { iv: [0, 4, 7, 10],  w: [1, 1, 0.9, 0.85], sfx: '7' },
    maj7: { iv: [0, 4, 7, 11],  w: [1, 1, 0.9, 0.85], sfx: 'maj7' },
    m7:   { iv: [0, 3, 7, 10],  w: [1, 1, 0.9, 0.85], sfx: 'm7' },
  };
  const SEVENTH_PENALTY = 0.01;          // a 7th chord must clearly beat its triad to be chosen
  // Real notes have overtones: harmonic h of a note lands on these pitch classes (octave, 5th, 3rd…).
  // Building them into the templates stops e.g. the E in A7 (whose 5th harmonic is G♯) reading as Amaj7.
  const HARMONICS = [[0, 1], [0, 0.6], [7, 0.36], [0, 0.22], [4, 0.13], [7, 0.08]];

  function templates(qualities) {
    const list = [];
    for (const q of qualities) {
      const def = QUALITIES[q];
      for (let root = 0; root < 12; root++) {
        const v = new Float64Array(12);
        def.iv.forEach((iv, i) => HARMONICS.forEach(([off, a]) => { v[mod12(root + iv + off)] += def.w[i] * a; }));
        const norm = Math.hypot(...v);
        for (let i = 0; i < 12; i++) v[i] /= norm;
        list.push({ root, q, v, penalty: def.iv.length > 3 ? SEVENTH_PENALTY : 0 });
      }
    }
    return list;
  }

  function chordName(root, q, flats) {
    return (flats ? FLAT_NAMES : SHARP_NAMES)[mod12(root)] + QUALITIES[q].sfx;
  }

  /* ---------- Main analysis ---------- */
  async function analyse(input, sr, onProgress = () => {}) {
    // Normalise loudness so thresholds behave the same for quiet and loud files.
    let sq = 0;
    for (let i = 0; i < input.length; i++) sq += input[i] * input[i];
    const rms = Math.sqrt(sq / Math.max(1, input.length)) || 1;
    const x = new Float32Array(input.length);
    const g = 0.1 / rms;
    for (let i = 0; i < input.length; i++) x[i] = input[i] * g;
    const duration = input.length / sr;

    onProgress(0, 'Finding the beat…');
    const on = await onsetEnvelope(x, sr, (p) => onProgress(p * 0.25, 'Finding the beat…'));
    const period = estimatePeriod(on.env, on.fps);
    let beatFrames = trackBeats(on.env, period);
    const bpm = (60 * on.fps) / period;

    // Beat times (s). Extend the grid to cover the whole song.
    const beatSec = period / on.fps;
    let beats = beatFrames.map((f) => f / on.fps);
    if (!beats.length) beats = [0];
    while (beats[0] - beatSec > 0.05) beats.unshift(beats[0] - beatSec);
    if (beats[0] > 0.05) beats.unshift(0);
    while (beats[beats.length - 1] + beatSec < duration) beats.push(beats[beats.length - 1] + beatSec);
    beats.push(duration);

    onProgress(0.25, 'Listening for notes…');
    const ch = await chromaFrames(x, sr, (p) => onProgress(0.25 + p * 0.7, 'Listening for notes…'));

    onProgress(0.95, 'Working out the chords…');
    await yieldUI();

    // Beat-synchronous averaging.
    const nb = beats.length - 1;
    const bTreble = [], bBass = [], bEnergy = new Float64Array(nb);
    const total = new Float64Array(12);
    for (let b = 0; b < nb; b++) {
      const t0 = beats[b], t1 = beats[b + 1];
      let f0 = Math.ceil(t0 * ch.fps), f1 = Math.floor(t1 * ch.fps);
      if (f1 < f0) { f0 = f1 = Math.min(ch.treble.length - 1, Math.round(((t0 + t1) / 2) * ch.fps)); }
      f1 = Math.min(f1, ch.treble.length - 1);
      const tr = new Float64Array(12), bs = new Float64Array(12);
      let e = 0, n = 0;
      for (let f = Math.max(0, f0); f <= f1; f++, n++) {
        for (let i = 0; i < 12; i++) { tr[i] += ch.treble[f][i]; bs[i] += ch.bass[f][i]; }
        e += ch.energy[f];
      }
      n = Math.max(1, n);
      for (let i = 0; i < 12; i++) { tr[i] /= n; bs[i] /= n; total[i] += tr[i] * (t1 - t0); }
      bTreble.push(tr); bBass.push(bs); bEnergy[b] = e / n;
    }

    const feat = { duration, bpm, beats, tuningCents: Math.round(ch.tuning * 100), bTreble, bBass, bEnergy };
    feat.key = keyFromChords(label({ ...feat, key: null }, { sevenths: false }).segments, detectKey(Array.from(total)));
    onProgress(1, 'Done');
    return feat;
  }

  // Key from a first chord pass: the key whose chords cover most of the song, with weight on the tonic chord.
  function keyFromChords(segments, profileKey) {
    const dur = new Map();
    let total = 0;
    segments.forEach((s) => {
      if (!s.chord) return;
      const k = `${s.chord.root}|${s.chord.q}`, d = s.end - s.start;
      dur.set(k, (dur.get(k) || 0) + d); total += d;
    });
    if (!total) return profileKey;
    const chorded = segments.filter((s) => s.chord);
    const first = chorded[0].chord, last = chorded[chorded.length - 1].chord;
    let best = null;
    for (let tonic = 0; tonic < 12; tonic++) for (const mode of ['major', 'minor']) {
      const key = { tonic, mode };
      const set = diatonicSet(key);
      let s = 0;
      dur.forEach((d, k) => { if (set.has(k)) s += d; });
      const tq = mode === 'major' ? 'maj' : 'min';
      const tonicDur = dur.get(`${tonic}|${tq}`) || 0;
      s += 0.6 * tonicDur;
      [first, last].forEach((c) => { if (c.root === tonic && c.q === tq) s += 0.08 * total; });
      if (profileKey.tonic === tonic && profileKey.mode === mode) s += 0.03 * total;
      if (!best || s > best.s) best = { ...key, s };
    }
    const relMajor = best.mode === 'major' ? best.tonic : mod12(best.tonic + 3);
    const flats = [5, 10, 3, 8, 1].includes(relMajor);
    return {
      tonic: best.tonic, mode: best.mode, flats,
      name: (flats ? FLAT_NAMES : SHARP_NAMES)[best.tonic] + (best.mode === 'major' ? ' major' : ' minor'),
      confidence: Math.min(1, best.s / (1.6 * total)),
    };
  }

  /* ---------- Labelling (fast, can be re-run with other options) ---------- */
  function label(feat, { sevenths = false, stickiness = 1 } = {}) {
    const qs = sevenths ? ['maj', 'min', '7', 'maj7', 'm7'] : ['maj', 'min'];
    const T = templates(qs);
    const inKey = feat.key ? diatonicSet(feat.key) : new Set();
    const nb = feat.bTreble.length;
    const sortedE = Array.from(feat.bEnergy).sort((a, b) => a - b);
    const loudRef = sortedE[Math.floor(sortedE.length * 0.9)] || 1;

    // Emission scores. State T.length = "no chord".
    const S = T.length + 1, NC = T.length;
    const emit = [];
    for (let b = 0; b < nb; b++) {
      const tr = feat.bTreble[b], bs = feat.bBass[b];
      const tn = Math.hypot(...tr) || 1;
      const bmax = Math.max(...bs) || 1;
      const quiet = feat.bEnergy[b] < loudRef * 0.06;
      const row = new Float64Array(S);
      for (let s = 0; s < T.length; s++) {
        const t = T[s];
        let dot = 0;
        for (let i = 0; i < 12; i++) dot += (tr[i] / tn) * t.v[i];
        row[s] = dot + 0.12 * (bs[t.root] / bmax) + (inKey.has(`${t.root}|${t.q}`) ? 0.04 : 0) - t.penalty;
      }
      row[NC] = quiet ? 2 : 0.25;
      emit.push(row);
    }

    // Viterbi: score = κ·emission − change penalty.
    const kappa = 14, change = 1.6 * stickiness;
    let prev = Float64Array.from(emit[0] || [], (v) => kappa * v);
    const back = [];
    for (let b = 1; b < nb; b++) {
      let bestS = 0;
      for (let s = 1; s < S; s++) if (prev[s] > prev[bestS]) bestS = s;
      const cur = new Float64Array(S), bk = new Int32Array(S);
      for (let s = 0; s < S; s++) {
        const stay = prev[s], move = prev[bestS] - change;
        if (stay >= move) { cur[s] = stay; bk[s] = s; } else { cur[s] = move; bk[s] = bestS; }
        cur[s] += kappa * emit[b][s];
      }
      back.push(bk);
      prev = cur;
    }
    const path = new Int32Array(nb);
    if (nb) {
      let s = 0;
      for (let i = 1; i < S; i++) if (prev[i] > prev[s]) s = i;
      path[nb - 1] = s;
      for (let b = nb - 1; b > 0; b--) { s = back[b - 1][s]; path[b - 1] = s; }
    }

    const flats = !!feat.key?.flats;
    const perBeat = Array.from(path, (s) => (s === NC ? null : {
      root: T[s].root, q: T[s].q, name: chordName(T[s].root, T[s].q, flats),
    }));

    // Merge into segments.
    const segments = [];
    for (let b = 0; b < nb; b++) {
      const c = perBeat[b], last = segments[segments.length - 1];
      if (last && (last.chord?.name ?? null) === (c?.name ?? null)) { last.end = feat.beats[b + 1]; last.beatEnd = b + 1; }
      else segments.push({ start: feat.beats[b], end: feat.beats[b + 1], beatStart: b, beatEnd: b + 1, chord: c });
    }

    // Fold slivers (< 0.3 s, e.g. the last partial beat) into the previous segment.
    for (let i = segments.length - 1; i > 0; i--) {
      const s = segments[i];
      if (s.end - s.start < 0.3) { segments[i - 1].end = s.end; segments[i - 1].beatEnd = s.beatEnd; segments.splice(i, 1); }
    }
    for (let i = segments.length - 1; i > 0; i--) {            // re-merge neighbours that became equal
      if ((segments[i].chord?.name ?? null) === (segments[i - 1].chord?.name ?? null)) {
        segments[i - 1].end = segments[i].end; segments[i - 1].beatEnd = segments[i].beatEnd; segments.splice(i, 1);
      }
    }

    // Bar phase (assume 4/4): put the downbeat where chord changes happen most.
    const votes = [0, 0, 0, 0];
    segments.forEach((s) => { if (s.chord && s.beatStart > 0) votes[s.beatStart % 4] += 1; });
    const phase = votes.indexOf(Math.max(...votes));

    return { perBeat, segments, phase, flats };
  }

  return { analyse, label, chordName, QUALITIES, SHARP_NAMES, FLAT_NAMES, _internal: { makeFFT, estimatePeriod, trackBeats, detectKey } };
})();

if (typeof module !== 'undefined') module.exports = SongCore;
