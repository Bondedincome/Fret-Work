'use strict';
/* Song → chords (beta)
   Upload an audio file or paste a direct audio link. SongCore (songcore.js) finds the beat, key and chords;
   this file handles loading, the player, the chord sheet and the capo helper.
   Uses $, $$, Sound, store, CHORDS, chordSVG, chordMidis, pretty, currentTab, openInChordLibrary from earlier scripts. */

const SONG_SR = 22050;                 // analysis sample rate
const SONG_MAX_SEC = 600;              // analyse at most 10 minutes
const SONG_MAX_BYTES = 150 * 1024 * 1024;
const STREAM_HOSTS = /(^|\.)(youtube\.com|youtu\.be|spotify\.com|music\.apple\.com|soundcloud\.com|deezer\.com|tidal\.com|music\.amazon\.[a-z.]+|bandcamp\.com|tiktok\.com|instagram\.com)$/i;

const song = {
  feat: null, res: null, name: '', objectUrl: null, runId: 0,
  sevenths: store.get('songSevenths', false),
  capo: 0, raf: 0, lastSeg: -1, beatToSeg: null, bars: [],
};
const audio = $('#songAudio');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (s) => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/* =========================================================
   Chord shapes: library chord if there is one, otherwise a movable barre shape
   ========================================================= */
const SUFFIX_Q = { '': 'maj', m: 'min', 7: '7', maj7: 'maj7', m7: 'm7' };
const pcOfName = (n) => { const i = SongCore.SHARP_NAMES.indexOf(n); return i >= 0 ? i : SongCore.FLAT_NAMES.indexOf(n); };
const LIB = new Map();
CHORDS.forEach((c) => {
  const m = c.name.match(/^([A-G][#b]?)(.*)$/);
  const q = m && SUFFIX_Q[m[2]];
  if (!q) return;
  const k = `${pcOfName(m[1])}|${q}`;
  if (!LIB.has(k) || (LIB.get(k).barre && !c.barre)) LIB.set(k, c);
});

// Offsets from the barre fret. -1 = muted. E-shape: root on the 6th string, A-shape: root on the 5th.
const MOVABLE = {
  E: { rootOpen: 4, from: 0, shapes: {
    maj: ['0 2 2 1 0 0', '1 3 4 2 1 1'],
    min: ['0 2 2 0 0 0', '1 3 4 1 1 1'],
    7:   ['0 2 0 1 0 0', '1 3 1 2 1 1'],
    m7:  ['0 2 0 0 0 0', '1 3 1 1 1 1'],
  } },
  A: { rootOpen: 9, from: 1, shapes: {
    maj:  ['x 0 2 2 2 0', 'x 1 2 3 4 1'],
    min:  ['x 0 2 2 1 0', 'x 1 3 4 2 1'],
    7:    ['x 0 2 0 2 0', 'x 1 3 1 4 1'],
    maj7: ['x 0 2 1 2 0', 'x 1 3 2 4 1'],
    m7:   ['x 0 2 0 1 0', 'x 1 3 1 2 1'],
  } },
};

function shapeFor(root, q, flats) {
  const name = SongCore.chordName(root, q, flats);
  const lib = LIB.get(`${root}|${q}`);
  if (lib) return { ...lib, name, lib: true };
  let best = null;
  for (const S of Object.values(MOVABLE)) {
    const sh = S.shapes[q];
    if (!sh) continue;
    const fret = ((root - S.rootOpen) % 12 + 12) % 12 || 12;
    if (best && best.barre.fret <= fret) continue;
    const off = sh[0].split(' '), fg = sh[1].split(' ');
    best = {
      name, full: `${pretty(name)} (barre shape)`, lib: false, flats,
      frets: off.map((o) => (o === 'x' ? -1 : fret + Number(o))),
      fingers: fg.map((f) => (f === 'x' ? -1 : Number(f))),
      barre: { fret, from: S.from, to: 5, finger: 1 },
      base: fret,
    };
  }
  return best;
}

// Shape to play with a capo: the chord a capo-fret lower, played up the neck.
const shapeWithCapo = (c) => c && shapeFor(((c.root - song.capo) % 12 + 12) % 12, c.q, song.res.flats);
const easyShape = (s) => s && s.lib && !s.barre;

/* =========================================================
   Loading
   ========================================================= */
function setError(msg) {
  const el = $('#songError');
  el.hidden = !msg;
  el.innerHTML = msg || '';
  if (msg) $('#songProgress').hidden = true;
}
function setProgress(p, text) {
  $('#songProgress').hidden = false;
  $('#songProgressText').textContent = text;
  $('#songProgressPct').textContent = Math.round(p * 100) + '%';
  $('#songProgressFill').style.width = (p * 100).toFixed(1) + '%';
}

async function decodeToMono(arrayBuffer) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OAC(1, SONG_SR, SONG_SR);
  const buf = await new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(arrayBuffer, resolve, reject);   // callback form for older Safari
    if (p && p.then) p.then(resolve, reject);
  });
  const len = Math.min(buf.length, Math.floor(SONG_MAX_SEC * buf.sampleRate));
  const x = new Float32Array(len);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) x[i] += d[i] / buf.numberOfChannels;
  }
  return { x, sr: buf.sampleRate, truncated: buf.length > len };
}

async function loadBlob(blob, name) {
  const run = ++song.runId;
  setError('');
  if (blob.size > SONG_MAX_BYTES) { setError('That file is too big (over 150 MB). Try a shorter song or a compressed format such as MP3.'); return; }
  audio.pause();
  $('#songInput').classList.add('busy');
  setProgress(0, 'Decoding audio…');
  try {
    let dec;
    try { dec = await decodeToMono(await blob.arrayBuffer()); }
    catch { throw new Error("This file couldn't be read as audio. Try MP3, M4A, WAV or OGG."); }
    if (run !== song.runId) return;
    if (dec.x.length < dec.sr * 5) throw new Error('That clip is too short. Use at least 5 seconds of music.');

    const feat = await SongCore.analyse(dec.x, dec.sr, (p, text) => { if (run === song.runId) setProgress(p, text); });
    if (run !== song.runId) return;

    if (song.objectUrl) URL.revokeObjectURL(song.objectUrl);
    song.objectUrl = URL.createObjectURL(blob);
    audio.src = song.objectUrl;
    song.feat = feat;
    song.name = name.replace(/\.[a-z0-9]{2,5}$/i, '') || 'Your song';
    song.truncated = dec.truncated;
    relabel();
    song.capo = 0;
    renderAll();
    $('#songProgress').hidden = true;
    $('#songResult').hidden = false;
    $('#songInput').classList.add('compact');
  } catch (err) {
    if (run === song.runId) setError(esc(err.message || 'Something went wrong while analysing the song.'));
  } finally {
    if (run === song.runId) $('#songInput').classList.remove('busy');
  }
}

async function loadUrl(raw) {
  let u;
  try { u = new URL(raw.trim()); } catch { setError("That doesn't look like a web address."); return; }
  if (!/^https?:$/.test(u.protocol)) { setError('Use a link that starts with http:// or https://.'); return; }
  if (STREAM_HOSTS.test(u.hostname)) {
    setError(`<b>${esc(u.hostname.replace(/^www\./, ''))}</b> doesn't let other apps read its audio, so Fretwork can't analyse it from a link. If you have the song as a file (MP3, M4A, WAV…), upload it above.`);
    return;
  }
  const run = ++song.runId;
  setError('');
  setProgress(0, 'Downloading…');
  let res;
  try { res = await fetch(u.href); }
  catch {
    if (run === song.runId) setError("Couldn't download that file. The website doesn't allow other apps to read it. Save the file to your device and upload it instead.");
    return;
  }
  if (run !== song.runId) return;
  $('#songProgress').hidden = true;
  if (!res.ok) { setError(`The website answered with an error (${res.status}). Check the link.`); return; }
  const type = res.headers.get('content-type') || '';
  if (/^text\/html|json/.test(type)) { setError('That link opens a web page, not an audio file. Use a direct link that ends in .mp3, .m4a, .wav or .ogg.'); return; }
  const len = Number(res.headers.get('content-length')) || 0;
  if (len > SONG_MAX_BYTES) { setError('That file is too big (over 150 MB).'); return; }
  const blob = await res.blob();
  if (run !== song.runId) return;
  const file = decodeURIComponent(u.pathname.split('/').pop() || '') || u.hostname;
  loadBlob(blob, file);
}

/* =========================================================
   Analysis results
   ========================================================= */
function relabel() {
  song.res = SongCore.label(song.feat, { sevenths: song.sevenths });
  const nb = song.feat.beats.length - 1;
  song.beatToSeg = new Int32Array(nb);
  song.res.segments.forEach((s, i) => { for (let b = s.beatStart; b < s.beatEnd; b++) song.beatToSeg[b] = i; });

  // Bars of 4 beats, starting at the detected downbeat (a pickup bar first if needed).
  const bars = [];
  const phase = song.res.phase;
  if (phase > 0) bars.push({ b0: 0, b1: Math.min(phase, nb), pickup: true });
  for (let b = phase; b < nb; b += 4) bars.push({ b0: b, b1: Math.min(nb, b + 4) });
  song.bars = bars.map((bar) => {
    const segs = [];
    for (let b = bar.b0; b < bar.b1; b++) { const s = song.beatToSeg[b]; if (segs[segs.length - 1] !== s) segs.push(s); }
    return { ...bar, segs };
  });
  song.lastSeg = -1;
}

function chordStats() {
  const m = new Map();
  song.res.segments.forEach((s) => {
    if (!s.chord) return;
    const e = m.get(s.chord.name) || { chord: s.chord, dur: 0 };
    e.dur += s.end - s.start;
    m.set(s.chord.name, e);
  });
  return [...m.values()].sort((a, b) => b.dur - a.dur);
}

function suggestCapo() {
  const stats = chordStats();
  const total = stats.reduce((s, c) => s + c.dur, 0) || 1;
  const opts = [];
  for (let capo = 0; capo <= 7; capo++) {
    let easy = 0;
    stats.forEach(({ chord, dur }) => {
      if (easyShape(shapeFor(((chord.root - capo) % 12 + 12) % 12, chord.q, song.res.flats))) easy += dur;
    });
    opts.push({ capo, score: easy / total });
  }
  const best = opts.reduce((a, b) => (b.score > a.score + 0.1 ? b : a), opts[0]);
  return { ...best, none: opts[0].score, opts };
}

/* =========================================================
   Rendering
   ========================================================= */
function renderAll() {
  renderSummary();
  renderChordGrid();
  renderTimeline();
  renderSheet();
  updatePlayback(true);
}

function renderSummary() {
  const f = song.feat;
  $('#songName').textContent = song.name;
  const facts = [
    `Key: <b>${pretty(f.key.name)}</b>`,
    `Tempo: <b>${Math.round(f.bpm)} BPM</b>`,
    `Length: <b>${fmtTime(f.duration)}</b>${song.truncated ? ' (first 10 min)' : ''}`,
  ];
  if (Math.abs(f.tuningCents) >= 15) facts.push(`Tuning: <b>${f.tuningCents > 0 ? '+' : ''}${f.tuningCents} cents</b> (slightly ${f.tuningCents > 0 ? 'sharp' : 'flat'} of standard)`);
  $('#songFacts').innerHTML = facts.map((x) => `<span>${x}</span>`).join('');
  $$('#songDetail button').forEach((b) => b.classList.toggle('on', (b.dataset.d === 'sevenths') === song.sevenths));

  const sug = suggestCapo();
  $('#songCapo').innerHTML = sug.opts.map((o) =>
    `<option value="${o.capo}">${o.capo === 0 ? 'None' : 'Fret ' + o.capo}${o.capo === sug.capo && sug.capo > 0 ? ' ★' : ''} · ${Math.round(o.score * 100)}% open shapes</option>`).join('');
  $('#songCapo').value = song.capo;
  const pct = (v) => Math.round(v * 100) + '%';
  let html = song.capo > 0 ? `Capo on fret ${song.capo}: chord names show the <b>shapes you play</b>.` : '';
  if (sug.capo > 0 && song.capo === sug.capo) {
    html = `★ With a <b>capo on fret ${sug.capo}</b>, ${pct(sug.score)} of the song uses easy open shapes (${pct(sug.none)} without). Chord names show the <b>shapes you play</b>.`;
  } else if (sug.capo > 0) {
    html += ` Tip: a <b>capo on fret ${sug.capo}</b> lets you play ${pct(sug.score)} of the song with easy open shapes.`;
  }
  $('#songCapoTip').hidden = !html;
  $('#songCapoTip').innerHTML = html.trim();
}

const shapeLabel = (c) => {
  if (!c) return 'No chord';
  const s = shapeWithCapo(c);
  return pretty(s.name);
};
const soundsAs = (c) => (song.capo && c ? `<span class="song-sounds">sounds as ${pretty(c.name)}</span>` : '');

function renderChordGrid() {
  const stats = chordStats();
  const total = stats.reduce((s, c) => s + c.dur, 0) || 1;
  $('#songChordGrid').innerHTML = stats.map(({ chord, dur }) => {
    const s = shapeWithCapo(chord);
    return `<button class="chord-card song-chord" data-name="${chord.name}" aria-label="Play ${s.full || s.name}">
      <div class="cname">${pretty(s.name)}</div>${chordSVG(s)}
      <div class="song-chord-meta">${Math.max(1, Math.round((dur / total) * 100))}% of song${s.barre && !s.lib ? ' · barre' : ''}</div>
      ${soundsAs(chord)}</button>`;
  }).join('') || '<p class="sub">No chords found. Is this a recording with instruments?</p>';
}

function renderTimeline() {
  const D = song.feat.duration;
  $('#songTlTrack').innerHTML = song.res.segments.map((s, i) => {
    const w = ((s.end - s.start) / D) * 100;
    return `<div class="song-tl-seg${s.chord ? '' : ' nc'}" data-i="${i}" style="left:${(s.start / D) * 100}%;width:${w}%" title="${s.chord ? pretty(s.chord.name) : 'No chord'} · ${fmtTime(s.start)}">${w > 2.5 && s.chord ? shapeLabel(s.chord) : ''}</div>`;
  }).join('');
  $('#songDur').textContent = fmtTime(D);
  $('#songTimeline').setAttribute('aria-valuemax', Math.round(D));
}

function renderSheet() {
  const segs = song.res.segments;
  let prevLast = null;
  $('#songSheet').innerHTML = song.bars.map((bar, i) => {
    const names = bar.segs.map((si, k) => {
      const c = segs[si].chord;
      const cont = k === 0 && si === prevLast;
      return `<span class="${cont ? 'cont' : ''}${c ? '' : ' nc'}">${c ? shapeLabel(c) : 'N.C.'}</span>`;
    }).join('');
    prevLast = bar.segs[bar.segs.length - 1];
    return `<button class="song-bar${bar.pickup ? ' pickup' : ''}" data-bar="${i}" title="${fmtTime(song.feat.beats[bar.b0])}">${names}</button>`;
  }).join('');
}

/* =========================================================
   Playback sync
   ========================================================= */
function beatAt(t) {
  const B = song.feat.beats;
  let lo = 0, hi = B.length - 2;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (B[mid] <= t) lo = mid; else hi = mid - 1; }
  return lo;
}

function setChordView(prefix, c) {
  $(`#song${prefix}Name`).innerHTML = c ? shapeLabel(c) + soundsAs(c) : '–';
  $(`#song${prefix}Diagram`).innerHTML = c ? chordSVG(shapeWithCapo(c)) : '';
}

function updatePlayback(force = false) {
  if (!song.res) return;
  const t = audio.currentTime || 0, D = song.feat.duration;
  const b = beatAt(t);
  const si = song.beatToSeg[b];
  const segs = song.res.segments;

  $('#songTime').textContent = fmtTime(t);
  $('#songPlayhead').style.left = Math.min(100, (t / D) * 100) + '%';
  $('#songTimeline').setAttribute('aria-valuenow', Math.round(t));
  $('#songTimeline').setAttribute('aria-valuetext', fmtTime(t));
  const pos = ((b - song.res.phase) % 4 + 4) % 4;
  $$('#songBeats i').forEach((d, i) => d.classList.toggle('on', i === pos && !audio.paused));

  // "Next" countdown in beats.
  let nextIdx = si + 1;
  while (nextIdx < segs.length && !segs[nextIdx].chord) nextIdx++;
  const next = segs[nextIdx];
  $('#songNextIn').textContent = next ? `in ${next.beatStart - b} beat${next.beatStart - b === 1 ? '' : 's'}` : '';

  if (si === song.lastSeg && !force) return;
  const changed = si !== song.lastSeg;
  song.lastSeg = si;
  setChordView('Now', segs[si].chord);
  setChordView('Next', next && next.chord);

  $$('#songTlTrack .song-tl-seg').forEach((el) => el.classList.toggle('now', Number(el.dataset.i) === si));
  const barIdx = song.bars.findIndex((bar) => b >= bar.b0 && b < bar.b1);
  $$('#songSheet .song-bar').forEach((el, i) => el.classList.toggle('now', i === barIdx));
  const barEl = $(`#songSheet .song-bar[data-bar="${barIdx}"]`);
  if (barEl && !audio.paused && currentTab === 'song') barEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  $$('#songChordGrid .song-chord').forEach((el) => el.classList.toggle('on', segs[si].chord && el.dataset.name === segs[si].chord.name));

  if (changed && !force && !audio.paused && $('#songStrum').checked && segs[si].chord) {
    Sound.strum(chordMidis(shapeWithCapo(segs[si].chord)).map((m) => m + song.capo), 0.02);
  }
}

function loop() {
  updatePlayback();
  if (!audio.paused) song.raf = requestAnimationFrame(loop);
}
function seek(t) {
  audio.currentTime = Math.max(0, Math.min(song.feat.duration - 0.05, t));
  song.lastSeg = -1;
  updatePlayback(true);
}

audio.addEventListener('play', () => { $('#songPlay').textContent = '⏸ Pause'; cancelAnimationFrame(song.raf); song.lastSeg = -1; loop(); });
audio.addEventListener('pause', () => { $('#songPlay').textContent = '▶ Play'; cancelAnimationFrame(song.raf); updatePlayback(true); });
audio.addEventListener('seeked', () => { if (audio.paused) updatePlayback(true); });

/* =========================================================
   Events
   ========================================================= */
$('#songFile').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) loadBlob(f, f.name);
  e.target.value = '';
});
$('#songUrlForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#songUrl').value;
  if (v.trim()) loadUrl(v);
});

const drop = $('#songDrop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = [...(e.dataTransfer.files || [])].find((x) => /^audio\/|^video\//.test(x.type) || /\.(mp3|m4a|wav|ogg|oga|flac|aac|webm)$/i.test(x.name));
  if (f) loadBlob(f, f.name);
  else setError("That doesn't look like an audio file.");
});

$('#songPlay').addEventListener('click', () => {
  Sound.init();                                         // unlock Web Audio for strum-along
  if (audio.paused) audio.play().catch(() => setError("The browser couldn't play this file, but the chords below are still valid."));
  else audio.pause();
});

const tl = $('#songTimeline');
function seekFromPointer(e) {
  const r = tl.getBoundingClientRect();
  seek(((e.clientX - r.left) / r.width) * song.feat.duration);
}
tl.addEventListener('pointerdown', (e) => {
  if (!song.feat) return;
  tl.setPointerCapture(e.pointerId);
  seekFromPointer(e);
  const move = (ev) => seekFromPointer(ev);
  const up = () => { tl.removeEventListener('pointermove', move); tl.removeEventListener('pointerup', up); };
  tl.addEventListener('pointermove', move);
  tl.addEventListener('pointerup', up);
});
tl.addEventListener('keydown', (e) => {
  if (!song.feat) return;
  const step = { ArrowLeft: -5, ArrowRight: 5, PageDown: -30, PageUp: 30 }[e.key];
  if (step) { e.preventDefault(); seek(audio.currentTime + step); }
  if (e.key === 'Home') { e.preventDefault(); seek(0); }
});

$('#songSheet').addEventListener('click', (e) => {
  const b = e.target.closest('[data-bar]');
  if (b) seek(song.feat.beats[song.bars[Number(b.dataset.bar)].b0]);
});

$('#songChordGrid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-name]');
  if (!b) return;
  const c = chordStats().find((x) => x.chord.name === b.dataset.name).chord;
  Sound.strum(chordMidis(shapeWithCapo(c)).map((m) => m + song.capo));
});

$('#songDetail').addEventListener('click', (e) => {
  const b = e.target.closest('[data-d]');
  if (!b || !song.feat) return;
  song.sevenths = b.dataset.d === 'sevenths';
  store.set('songSevenths', song.sevenths);
  relabel();
  renderAll();
});

$('#songCapo').addEventListener('change', (e) => {
  song.capo = Number(e.target.value);
  renderAll();
});

$('#songCopy').addEventListener('click', async () => {
  const segs = song.res.segments;
  const lines = [`${song.name} · Key: ${song.feat.key.name} · ${Math.round(song.feat.bpm)} BPM${song.capo ? ` · Capo ${song.capo}` : ''}`, ''];
  let row = [];
  song.bars.forEach((bar) => {
    row.push(' ' + bar.segs.map((si) => (segs[si].chord ? shapeWithCapo(segs[si].chord).name : 'N.C.')).join(' ').padEnd(9));
    if (row.length === 4) { lines.push('|' + row.join('|') + '|'); row = []; }
  });
  if (row.length) lines.push('|' + row.join('|') + '|');
  const text = lines.join('\n');
  const btn = $('#songCopy');
  try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied ✓'; }
  catch { btn.textContent = 'Copy failed'; }
  setTimeout(() => { btn.textContent = 'Copy chords'; }, 1600);
});

$('#songNew').addEventListener('click', () => {
  audio.pause();
  $('#songInput').classList.remove('compact');
  $('#songInput').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#songFile').click();
});

// Pause when leaving the tab; Space toggles play on this tab.
const pauseIfHidden = () => setTimeout(() => { if (currentTab !== 'song') audio.pause(); }, 0);
$$('[data-tab], [data-goto]').forEach((b) => b.addEventListener('click', pauseIfHidden));
window.addEventListener('hashchange', pauseIfHidden);
document.addEventListener('keydown', (e) => {
  if (currentTab !== 'song' || e.code !== 'Space' || !song.feat) return;
  if (e.target.closest('input, textarea, select, button')) return;
  e.preventDefault();
  $('#songPlay').click();
});
