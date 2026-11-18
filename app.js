'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/* =========================================================
   Music basics
   ========================================================= */
const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const OPEN_MIDI = [40, 45, 50, 55, 59, 64];                 // E2 A2 D3 G3 B3 E4
const STRING_LETTERS = ['E', 'A', 'D', 'G', 'B', 'e'];
const STRING_NAMES = ['low E (6th)', 'A (5th)', 'D (4th)', 'G (3rd)', 'B (2nd)', 'high E (1st)'];
const FINGER_NAMES = { 1: 'index', 2: 'middle', 3: 'ring', 4: 'pinky' };
const pretty = (n) => n.replace(/#/g, '♯').replace(/([A-G])b/g, '$1♭');
const midiFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
const pcOf = (m) => ((m % 12) + 12) % 12;
const noteName = (pc, flats) => pretty((flats ? FLATS : SHARPS)[pc]);
const isNatural = (pc) => !SHARPS[pc].includes('#');

const store = {
  get(k, fallback) {
    try { const v = localStorage.getItem('fretwork:' + k); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(k, v) { try { localStorage.setItem('fretwork:' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

/* =========================================================
   Sound (Web Audio): plucked strings + metronome clicks
   ========================================================= */
const Sound = {
  ctx: null, master: null, metroGain: null, cache: new Map(),

  init() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      this.metroGain = this.ctx.createGain();
      this.metroGain.gain.value = 0.8;
      this.metroGain.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },

  // Karplus–Strong plucked string, cached per pitch.
  stringBuffer(midi) {
    if (this.cache.has(midi)) return this.cache.get(midi);
    const ctx = this.ctx, sr = ctx.sampleRate;
    const len = Math.floor(sr * 2.8);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const N = Math.max(2, Math.round(sr / midiFreq(midi)));
    const ring = new Float32Array(N);
    let prev = 0, mean = 0;
    for (let i = 0; i < N; i++) { prev = prev * 0.45 + (Math.random() * 2 - 1) * 0.55; ring[i] = prev; mean += prev; }
    mean /= N;
    for (let i = 0; i < N; i++) ring[i] -= mean;
    let idx = 0;
    for (let i = 0; i < len; i++) {
      const nxt = idx + 1 === N ? 0 : idx + 1;
      const v = ring[idx];
      d[i] = v;
      ring[idx] = 0.4985 * (v + ring[nxt]);
      idx = nxt;
    }
    const fade = Math.floor(sr * 0.4);
    for (let i = 0; i < fade; i++) d[len - fade + i] *= 1 - i / fade;
    this.cache.set(midi, buf);
    return buf;
  },

  pluck(midi, when = 0, gain = 0.5) {
    const ctx = this.init();
    const t = Math.max(when, ctx.currentTime);
    const src = ctx.createBufferSource();
    src.buffer = this.stringBuffer(midi);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 4200;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(lp).connect(g).connect(this.master);
    src.start(t);
  },

  strum(midis, gap = 0.03) {
    const ctx = this.init();
    const t = ctx.currentTime + 0.02;
    midis.forEach((m, i) => this.pluck(m, t + i * gap, 0.38));
  },

  arpeggio(midis) {
    const ctx = this.init();
    const t = ctx.currentTime + 0.02;
    midis.forEach((m, i) => this.pluck(m, t + i * 0.32, 0.5));
  },

  click(t, kind) {
    const ctx = this.ctx;
    const freq = { accent: 1760, beat: 1180, sub: 820 }[kind];
    const vol = { accent: 1, beat: 0.65, sub: 0.32 }[kind];
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g).connect(this.metroGain);
    o.start(t); o.stop(t + 0.07);
  },

  chime() {
    const ctx = this.init();
    const t = ctx.currentTime + 0.05;
    [76, 79, 83, 88].forEach((m, i) => this.pluck(m, t + i * 0.18, 0.55));
    [76, 79, 83, 88].forEach((m, i) => this.pluck(m, t + 1.1 + i * 0.18, 0.55));
  },
};

/* =========================================================
   Theme: Auto (follow system) → Light → Dark
   ========================================================= */
const THEME_ICONS = {
  auto: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17Z" fill="currentColor"/></svg>',
  light: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/></svg>',
};
const THEME_LABEL = { auto: 'Theme: automatic (follows your device)', light: 'Theme: light', dark: 'Theme: dark' };
const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
let theme = store.get('theme', 'auto');

function applyTheme() {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const btn = $('#themeBtn');
  btn.innerHTML = THEME_ICONS[theme];
  btn.title = THEME_LABEL[theme] + ' · click to change';
  btn.setAttribute('aria-label', THEME_LABEL[theme]);
  const isDark = theme === 'dark' || (theme === 'auto' && darkMq.matches);
  $('meta[name="theme-color"]').setAttribute('content', isDark ? '#131a1f' : '#2a9d8f');
}
$('#themeBtn').addEventListener('click', () => {
  theme = { auto: 'light', light: 'dark', dark: 'auto' }[theme];
  store.set('theme', theme);
  applyTheme();
});
darkMq.addEventListener('change', applyTheme);
applyTheme();

/* =========================================================
   Tabs
   ========================================================= */
const TABS = ['chords', 'live', 'notes', 'theory', 'ear', 'metronome', 'timer'];
let currentTab = 'chords';

function showTab(name) {
  if (!TABS.includes(name)) name = 'chords';
  if (name !== currentTab) window.scrollTo(0, 0);
  currentTab = name;
  $$('.tab').forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
  });
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + name));
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
}
$$('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
$$('[data-goto]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.goto)));
window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));

/* =========================================================
   Chords
   ========================================================= */
const chordState = { cat: 'all', query: '', selected: CHORDS[0].name };

function coveredByBarre(ch, i) {
  const b = ch.barre;
  return !!b && ch.frets[i] === b.fret && i >= b.from && i <= b.to && ch.fingers[i] === b.finger;
}

function chordSVG(ch) {
  const L = 28, S = 18, T = 36, F = 24, NF = 5;
  const W = L + 5 * S + 14, H = T + NF * F + 20;
  const x = (i) => L + i * S;
  const yMid = (f) => T + (f - ch.base + 0.5) * F;
  let s = `<svg class="diagram" viewBox="0 0 ${W} ${H}" role="img" aria-label="${ch.full} chord diagram">`;

  for (let j = 0; j <= NF; j++) s += `<line class="d-fret" x1="${L}" y1="${T + j * F}" x2="${x(5)}" y2="${T + j * F}"/>`;
  for (let i = 0; i < 6; i++) s += `<line class="d-string" x1="${x(i)}" y1="${T}" x2="${x(i)}" y2="${T + NF * F}" stroke-width="${(1.9 - i * 0.22).toFixed(2)}"/>`;

  if (ch.base === 1) s += `<rect class="d-nut" x="${L - 1}" y="${T - 5}" width="${5 * S + 2}" height="5" rx="1.5"/>`;
  else s += `<text class="d-base" x="${L - 7}" y="${yMid(ch.base) + 3}" text-anchor="end">${ch.base}fr</text>`;

  ch.frets.forEach((f, i) => {
    if (f === -1) s += `<text class="d-mute" x="${x(i)}" y="${T - 10}" text-anchor="middle">×</text>`;
    if (f === 0) s += `<circle class="d-open" cx="${x(i)}" cy="${T - 14}" r="4.5"/>`;
  });

  if (ch.barre) {
    const b = ch.barre, y = yMid(b.fret);
    s += `<rect class="d-dot" x="${x(b.from) - 8.5}" y="${y - 8.5}" width="${x(b.to) - x(b.from) + 17}" height="17" rx="8.5"/>`;
    s += `<text class="d-fing" x="${x(b.from)}" y="${y + 3.5}" text-anchor="middle">${b.finger}</text>`;
  }

  ch.frets.forEach((f, i) => {
    if (f > 0 && !coveredByBarre(ch, i)) {
      const y = yMid(f);
      s += `<circle class="d-dot" cx="${x(i)}" cy="${y}" r="8.5"/>`;
      if (ch.fingers[i] > 0) s += `<text class="d-fing" x="${x(i)}" y="${y + 3.5}" text-anchor="middle">${ch.fingers[i]}</text>`;
    }
  });

  STRING_LETTERS.forEach((l, i) => { s += `<text class="d-lbl" x="${x(i)}" y="${H - 4}" text-anchor="middle">${l}</text>`; });
  return s + '</svg>';
}

const chordMidis = (ch) => ch.frets.map((f, i) => (f >= 0 ? OPEN_MIDI[i] + f : null)).filter((m) => m !== null);

function chordSteps(ch) {
  const steps = [];
  const listStrings = (idx) => idx.map((i) => STRING_NAMES[i]).join(', ');
  if (ch.barre) {
    const b = ch.barre;
    const full = b.from === 0 && b.to === 5;
    steps.push(`<b>Barre:</b> lay your ${FINGER_NAMES[b.finger]} finger (${b.finger}) flat across <b>fret ${b.fret}</b>, ${full ? 'covering all six strings' : `from the ${STRING_NAMES[b.from]} to the ${STRING_NAMES[b.to]} string`}. Press with the bony edge of the finger, just behind the fret wire.`);
  }
  const placed = [];
  ch.frets.forEach((f, i) => { if (f > 0 && !coveredByBarre(ch, i)) placed.push(i); });
  placed.sort((a, b) => (ch.fingers[a] || 9) - (ch.fingers[b] || 9));
  placed.forEach((i) => {
    const fg = ch.fingers[i];
    steps.push(`Put your <b>${FINGER_NAMES[fg]} finger (${fg})</b> on the <b>${STRING_NAMES[i]}</b> string, <b>fret ${ch.frets[i]}</b>.`);
  });
  const muted = ch.frets.map((f, i) => (f === -1 ? i : -1)).filter((i) => i >= 0);
  const open = ch.frets.map((f, i) => (f === 0 ? i : -1)).filter((i) => i >= 0);
  if (open.length) steps.push(`Let ${open.length === 1 ? 'this string' : 'these strings'} ring <b>open</b>: ${listStrings(open)}.`);
  if (muted.length) steps.push(`<b>Don't play</b> ${muted.length === 1 ? 'the' : 'these'} ${listStrings(muted)} string${muted.length > 1 ? 's' : ''} (×). Start your strum below ${muted.length > 1 ? 'them' : 'it'}, or lightly touch ${muted.length > 1 ? 'them' : 'it'} to mute.`);
  const first = ch.frets.findIndex((f) => f >= 0);
  steps.push(`Strum from the <b>${STRING_NAMES[first]}</b> string down. Then pick each string one at a time: every note should ring clearly. If one buzzes, press closer to the fret or arch that finger more.`);
  return steps;
}

function renderChordFilters() {
  $('#chordFilters').innerHTML = CHORD_CATEGORIES.map((c) =>
    `<button class="chip ${c.id === chordState.cat ? 'on' : ''}" data-cat="${c.id}">${c.label}</button>`).join('');
}

function visibleChords() {
  const q = chordState.query.trim().toLowerCase().replace('♯', '#').replace('♭', 'b');
  return CHORDS.filter((c) =>
    (chordState.cat === 'all' || c.cat === chordState.cat) &&
    (!q || c.name.toLowerCase().includes(q) || c.full.toLowerCase().replace('♯', '#').replace('♭', 'b').includes(q)));
}

function renderChordGrid() {
  const list = visibleChords();
  $('#chordGrid').innerHTML = list.length
    ? list.map((c) => `<button class="chord-card ${c.name === chordState.selected ? 'on' : ''}" data-chord="${c.name}" aria-label="${c.full}">
        <div class="cname">${pretty(c.name)}</div>${chordSVG(c)}</button>`).join('')
    : `<div class="empty">No chords match “${chordState.query}”.</div>`;
}

function renderChordDetail() {
  const ch = CHORDS.find((c) => c.name === chordState.selected);
  const tones = [...new Set(chordMidis(ch).map(pcOf))];
  const level = ch.barre ? '<span class="badge inter">Barre · intermediate</span>' : '<span class="badge">Beginner friendly</span>';
  $('#chordDetail').innerHTML = `
    <div class="cd-head"><div class="cd-name">${pretty(ch.name)}</div>${level}</div>
    <div class="cd-full">${ch.full}</div>
    <div class="cd-diagram">${chordSVG(ch)}</div>
    <div class="cd-play">
      <button class="btn primary" id="strumBtn">▶ Strum</button>
      <button class="btn" id="arpBtn">▶ String by string</button>
    </div>
    <button class="btn live-link" id="liveBtn">📷 Practise with the camera coach</button>
    <h3>How to play it</h3>
    <ol class="steps">${chordSteps(ch).map((s) => `<li>${s}</li>`).join('')}</ol>
    <h3>Notes in this chord</h3>
    <div class="tone-row">${tones.map((p) => `<span class="tone">${noteName(p, ch.flats)}</span>`).join('')}</div>
    <div class="legend">
      <span><b>1</b> index</span><span><b>2</b> middle</span><span><b>3</b> ring</span><span><b>4</b> pinky</span>
      <span>○ open string</span><span>× don't play</span><span>Thickest string on the left</span>
    </div>`;
  $('#strumBtn').onclick = () => Sound.strum(chordMidis(ch));
  $('#arpBtn').onclick = () => Sound.arpeggio(chordMidis(ch));
  $('#liveBtn').onclick = () => window.openLive && window.openLive(ch.name);
}

$('#chordFilters').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]'); if (!b) return;
  chordState.cat = b.dataset.cat;
  renderChordFilters(); renderChordGrid();
});
$('#chordSearch').addEventListener('input', (e) => { chordState.query = e.target.value; renderChordGrid(); });
$('#chordGrid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-chord]'); if (!b) return;
  chordState.selected = b.dataset.chord;
  $$('.chord-card').forEach((c) => c.classList.toggle('on', c === b));
  renderChordDetail();
  const ch = CHORDS.find((c) => c.name === chordState.selected);
  Sound.strum(chordMidis(ch));
  b.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
});

renderChordFilters();
renderChordGrid();
renderChordDetail();

/* =========================================================
   Notes / fretboard
   ========================================================= */
const FRETS = 12;
const fbState = { flats: store.get('flats', false), selected: null, showAll: true, naturalsOnly: false };
const quiz = { active: false, string: 0, pc: 0, score: 0, total: 0, locked: false };

function renderNoteFilters() {
  const names = fbState.flats ? FLATS : SHARPS;
  $('#noteFilters').innerHTML = `<button class="chip ${fbState.selected === null ? 'on' : ''}" data-pc="">All</button>` +
    names.map((n, pc) => `<button class="chip ${fbState.selected === pc ? 'on' : ''}" data-pc="${pc}">${pretty(n)}</button>`).join('');
}

/* Shared fretboard builder. Horizontal on wide screens; vertical (nut at top,
   low E on the left, like a chord chart) on phones so all 12 frets fit. */
const mqVertical = window.matchMedia('(max-width: 640px)');
function fretboardInner(cellFn, vertical = mqVertical.matches, frets = FRETS) {
  const thick = (s) => (1 + (5 - s) * 0.45).toFixed(2);
  const cell = (s, f) => {
    const c = cellFn(s, f) || {};
    return `<button class="fb-cell ${f === 0 ? 'open' : ''} ${c.cls || ''}" data-s="${s}" data-f="${f}" data-midi="${OPEN_MIDI[s] + f}" style="--thick:${thick(s)}px" aria-label="${STRING_NAMES[s]} string, fret ${f}">${c.html || ''}</button>`;
  };
  const dots = (f) => `<div class="dots">${'<i></i>'.repeat(f === 12 ? 2 : [3, 5, 7, 9].includes(f) ? 1 : 0)}</div>`;
  const range = (n) => [...Array(n).keys()];
  let h = '';
  if (!vertical) {
    h += '<div class="fb-body">';
    for (let s = 5; s >= 0; s--) h += `<div class="fb-row"><div class="fb-label">${STRING_LETTERS[s]}</div>${range(frets + 1).map((f) => cell(s, f)).join('')}</div>`;
    h += `</div><div class="fb-marks"><div></div>${range(frets + 1).map((f) => `<div class="fb-mark">${dots(f)}${f}</div>`).join('')}</div>`;
  } else {
    h += `<div class="fbv-head"><div></div>${range(6).map((s) => `<div class="fb-label">${STRING_LETTERS[s]}</div>`).join('')}</div><div class="fbv-body">`;
    for (let f = 0; f <= frets; f++) h += `<div class="fbv-row"><div class="fbv-num">${f}${dots(f)}</div>${range(6).map((s) => cell(s, f)).join('')}</div>`;
    h += '</div>';
  }
  return h;
}

function renderFretboard() {
  const el = $('#fretboard');
  el.classList.toggle('vertical', mqVertical.matches);
  el.innerHTML = fretboardInner((s, f) => {
    const pc = pcOf(OPEN_MIDI[s] + f);
    return {
      cls: quiz.active && quiz.string === s ? 'target' : '',
      html: `<span class="fb-note ${isNatural(pc) ? '' : 'sharp'}" data-pc="${pc}">${noteName(pc, fbState.flats)}</span>`,
    };
  });
  applyNoteVisibility();
}

function applyNoteVisibility() {
  $$('#fretboard .fb-note').forEach((el) => {
    const pc = Number(el.dataset.pc);
    el.classList.remove('hit', 'dim', 'hide');
    if (quiz.active) { el.classList.add('hide'); return; }
    if (fbState.selected !== null) {
      el.classList.add(pc === fbState.selected ? 'hit' : (fbState.showAll ? 'dim' : 'hide'));
    } else if (!fbState.showAll || (fbState.naturalsOnly && !isNatural(pc))) {
      el.classList.add('hide');
    }
    if (fbState.selected === null && fbState.naturalsOnly && !isNatural(pc)) el.classList.add('hide');
  });
}

function renderReference() {
  $('#tuning').innerHTML = OPEN_MIDI.map((m, i) =>
    `<button data-midi="${m}" aria-label="Play ${STRING_NAMES[i]} string">${STRING_LETTERS[i].toUpperCase()}<small>${7 - (i + 1)}${['th', 'th', 'th', 'rd', 'nd', 'st'][i]}</small></button>`).join('');
  $('#chromatic').innerHTML = SHARPS.map((n, pc) => {
    const label = isNatural(pc) ? n : `${pretty(n)}/${pretty(FLATS[pc])}`;
    return `<button class="${isNatural(pc) ? '' : 'acc'}" data-midi="${60 + pc}">${label}</button>`;
  }).join('');
}

$('#tuning').addEventListener('click', (e) => { const b = e.target.closest('[data-midi]'); if (b) Sound.pluck(+b.dataset.midi); });
$('#chromatic').addEventListener('click', (e) => { const b = e.target.closest('[data-midi]'); if (b) Sound.pluck(+b.dataset.midi); });

$('#noteFilters').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pc]'); if (!b) return;
  fbState.selected = b.dataset.pc === '' ? null : Number(b.dataset.pc);
  renderNoteFilters(); applyNoteVisibility();
  if (fbState.selected !== null) Sound.pluck(52 + ((fbState.selected - 4 + 12) % 12));
});
$('#accidentalSeg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-acc]'); if (!b) return;
  fbState.flats = b.dataset.acc === 'flat';
  store.set('flats', fbState.flats);
  $$('#accidentalSeg button').forEach((x) => x.classList.toggle('on', x === b));
  renderNoteFilters(); renderFretboard();
  if (quiz.active) setQuizPrompt();
});
$('#showAllNotes').addEventListener('change', (e) => { fbState.showAll = e.target.checked; applyNoteVisibility(); });
$('#naturalsOnly').addEventListener('change', (e) => { fbState.naturalsOnly = e.target.checked; applyNoteVisibility(); });

$('#fretboard').addEventListener('click', (e) => {
  const cell = e.target.closest('.fb-cell'); if (!cell) return;
  const s = +cell.dataset.s, f = +cell.dataset.f, midi = OPEN_MIDI[s] + f;
  Sound.pluck(midi);
  if (!quiz.active || quiz.locked) return;
  const note = $('.fb-note', cell);
  const right = s === quiz.string && pcOf(midi) === quiz.pc;
  quiz.total++;
  const fb = $('#quizFeedback');
  if (right) {
    quiz.score++;
    note.classList.remove('hide'); note.classList.add('good');
    fb.textContent = `Yes! ${noteName(quiz.pc, fbState.flats)} is at fret ${f}.`;
    fb.className = 'quiz-feedback good';
  } else {
    note.classList.remove('hide'); note.classList.add('bad');
    $$(`#fretboard .fb-cell[data-s="${quiz.string}"] .fb-note`).forEach((n) => {
      if (+n.dataset.pc === quiz.pc) { n.classList.remove('hide'); n.classList.add('good'); }
    });
    fb.textContent = `That was ${noteName(pcOf(midi), fbState.flats)}${s !== quiz.string ? ` on the ${STRING_NAMES[s]} string` : ''}. The answer is shown in green.`;
    fb.className = 'quiz-feedback bad';
  }
  $('#quizScore').textContent = `${quiz.score} / ${quiz.total}`;
  quiz.locked = true;
  setTimeout(() => { if (quiz.active) nextQuestion(); }, right ? 900 : 1800);
});

function setQuizPrompt() {
  $('#quizPrompt').innerHTML = `Find <b>${noteName(quiz.pc, fbState.flats)}</b> on the <b>${STRING_NAMES[quiz.string]}</b> string.`;
}
function nextQuestion() {
  const prev = [quiz.string, quiz.pc];
  do {
    quiz.string = Math.floor(Math.random() * 6);
    const pool = fbState.naturalsOnly ? [0, 2, 4, 5, 7, 9, 11] : [...Array(12).keys()];
    quiz.pc = pool[Math.floor(Math.random() * pool.length)];
  } while (quiz.string === prev[0] && quiz.pc === prev[1]);
  quiz.locked = false;
  setQuizPrompt();
  renderFretboard();
}
$('#quizToggle').addEventListener('click', () => {
  quiz.active = !quiz.active;
  const btn = $('#quizToggle');
  if (quiz.active) {
    quiz.score = 0; quiz.total = 0;
    $('#quizScore').textContent = '0 / 0';
    $('#quizFeedback').textContent = '';
    btn.textContent = 'Stop quiz'; btn.classList.add('running');
    nextQuestion();
    $('#fretboard').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    btn.textContent = 'Start quiz'; btn.classList.remove('running');
    $('#quizPrompt').textContent = `Final score: ${quiz.score} / ${quiz.total}. Start again whenever you like.`;
    $('#quizFeedback').textContent = '';
    renderFretboard();
  }
});

$$('#accidentalSeg button').forEach((b) => b.classList.toggle('on', (b.dataset.acc === 'flat') === fbState.flats));
renderNoteFilters();
renderFretboard();
renderReference();

/* =========================================================
   Metronome
   ========================================================= */
const metro = {
  bpm: store.get('bpm', 90), beats: 4, sub: 1, accent: true, running: false,
  nextTime: 0, tick: 0, bar: 0, timer: null, queue: [], taps: [],
};

function tempoName(b) {
  if (b < 60) return 'Largo';
  if (b < 66) return 'Larghetto';
  if (b < 76) return 'Adagio';
  if (b < 108) return 'Andante';
  if (b < 120) return 'Moderato';
  if (b < 168) return 'Allegro';
  if (b < 200) return 'Presto';
  return 'Prestissimo';
}

function setBpm(v) {
  metro.bpm = Math.max(30, Math.min(250, Math.round(v)));
  $('#bpmNum').textContent = metro.bpm;
  $('#tempoName').textContent = tempoName(metro.bpm);
  $('#bpmSlider').value = metro.bpm;
  store.set('bpm', metro.bpm);
  updatePills();
}

function renderBeats() {
  $('#beatDots').innerHTML = Array.from({ length: metro.beats }, (_, i) =>
    `<div class="beat ${i === 0 && metro.accent ? 'accent' : ''}"></div>`).join('');
}

function schedule() {
  const ctx = Sound.ctx;
  while (metro.nextTime < ctx.currentTime + 0.12) {
    const perBar = metro.beats * metro.sub;
    const pos = metro.tick % perBar;
    const isBeat = pos % metro.sub === 0;
    const beat = Math.floor(pos / metro.sub);

    if (pos === 0 && metro.tick > 0) {
      metro.bar++;
      if ($('#trainerOn').checked) {
        const every = Math.max(1, +$('#trainerBars').value || 4);
        const step = Math.max(1, +$('#trainerStep').value || 5);
        const max = Math.min(250, +$('#trainerMax').value || 250);
        if (metro.bar % every === 0 && metro.bpm < max) {
          const nb = Math.min(max, metro.bpm + step);
          metro.queue.push({ time: metro.nextTime, bpmChange: nb });
          metro.bpm = nb; // affects timing immediately; UI updates when the beat sounds
        }
      }
    }

    const kind = !isBeat ? 'sub' : (beat === 0 && metro.accent ? 'accent' : 'beat');
    Sound.click(metro.nextTime, kind);
    if (isBeat) metro.queue.push({ time: metro.nextTime, beat });
    metro.nextTime += 60 / metro.bpm / metro.sub;
    metro.tick++;
  }
}

function drawMetro() {
  if (!metro.running) return;
  const now = Sound.ctx.currentTime;
  let latest = null;
  while (metro.queue.length && metro.queue[0].time <= now) {
    const ev = metro.queue.shift();
    if (ev.bpmChange) setBpm(ev.bpmChange); else latest = ev;
  }
  if (latest) {
    $$('#beatDots .beat').forEach((d, i) => d.classList.toggle('lit', i === latest.beat));
    const num = $('#bpmNum');
    num.classList.add('pulse');
    setTimeout(() => num.classList.remove('pulse'), 80);
  }
  requestAnimationFrame(drawMetro);
}

function startMetro() {
  Sound.init();
  metro.running = true;
  metro.tick = 0; metro.bar = 0; metro.queue = [];
  metro.nextTime = Sound.ctx.currentTime + 0.06;
  metro.timer = setInterval(schedule, 25);
  schedule();
  requestAnimationFrame(drawMetro);
  const b = $('#metroToggle'); b.textContent = 'Stop'; b.classList.add('running');
  updatePills();
}
function stopMetro() {
  metro.running = false;
  clearInterval(metro.timer);
  $$('#beatDots .beat').forEach((d) => d.classList.remove('lit'));
  const b = $('#metroToggle'); b.textContent = 'Start'; b.classList.remove('running');
  updatePills();
}
const toggleMetro = () => (metro.running ? stopMetro() : startMetro());

$('#metroToggle').addEventListener('click', toggleMetro);
$('#bpmSlider').addEventListener('input', (e) => setBpm(+e.target.value));
$$('[data-bpm]').forEach((b) => b.addEventListener('click', () => setBpm(metro.bpm + +b.dataset.bpm)));
$('#beatsPerBar').addEventListener('change', (e) => { metro.beats = +e.target.value; metro.tick = 0; renderBeats(); });
$('#subdivision').addEventListener('change', (e) => { metro.sub = +e.target.value; metro.tick = 0; });
$('#accentFirst').addEventListener('change', (e) => { metro.accent = e.target.checked; renderBeats(); });
$('#metroVolume').addEventListener('input', (e) => { Sound.init(); Sound.metroGain.gain.value = (+e.target.value / 100) ** 1.5; });
$('#tapBtn').addEventListener('click', () => {
  const now = performance.now();
  metro.taps = metro.taps.filter((t) => now - t < 2500);
  metro.taps.push(now);
  if (metro.taps.length >= 2) {
    const recent = metro.taps.slice(-5);
    const avg = (recent[recent.length - 1] - recent[0]) / (recent.length - 1);
    setBpm(60000 / avg);
  }
});

/* =========================================================
   Practice timer
   ========================================================= */
const RING_LEN = 2 * Math.PI * 90;
const timer = {
  mode: 'countdown', duration: store.get('duration', 600), elapsed: 0,
  running: false, last: 0, interval: null, done: false, logged: 0,
};
const ring = $('#ringFg');
ring.style.strokeDasharray = RING_LEN;

const fmt = (sec) => {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
};
const fmtMins = (sec) => {
  const m = Math.floor(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function renderPresets() {
  $('#presets').innerHTML = [1, 5, 10, 15, 20, 30, 45].map((m) =>
    `<button class="chip ${timer.duration === m * 60 ? 'on' : ''}" data-min="${m}">${m} min</button>`).join('');
  $('#presets').hidden = timer.mode !== 'countdown';
}

function renderTimer() {
  const cd = timer.mode === 'countdown';
  const shown = cd ? timer.duration - timer.elapsed : timer.elapsed;
  $('#timeDisplay').textContent = fmt(cd ? Math.ceil(shown) : Math.floor(shown));
  const frac = cd ? Math.min(1, timer.elapsed / timer.duration) : (timer.elapsed % 60) / 60;
  ring.style.strokeDashoffset = cd ? RING_LEN * frac : RING_LEN * (1 - frac);
  $('#timeLabel').textContent = timer.done ? 'Great work! 🎉' : timer.running ? (cd ? 'remaining' : 'elapsed') : (timer.elapsed ? 'Paused' : 'Ready');
  $('.timer-main').classList.toggle('done', timer.done);
  updatePills();
}

function logPractice(sec) {
  const log = store.get('log', {});
  const k = dayKey();
  log[k] = (log[k] || 0) + sec;
  store.set('log', log);
}

function saveSession() {
  if (timer.elapsed < 10) return;
  const sessions = store.get('sessions', []);
  sessions.unshift({ what: $('#focusInput').value.trim() || 'Practice', secs: Math.round(timer.elapsed), at: Date.now() });
  store.set('sessions', sessions.slice(0, 30));
}

function renderStats() {
  const log = store.get('log', {});
  const today = log[dayKey()] || 0;
  let week = 0, streak = 0;
  for (let i = 0; i < 7; i++) { const d = new Date(); d.setDate(d.getDate() - i); week += log[dayKey(d)] || 0; }
  for (let i = 0; i < 3650; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    if ((log[dayKey(d)] || 0) >= 60) streak++;
    else if (i > 0) break;          // today not practiced yet doesn't break the streak
  }
  $('#todayTotal').textContent = fmtMins(today);
  $('#weekTotal').textContent = fmtMins(week);
  $('#streak').textContent = streak;

  const sessions = store.get('sessions', []).slice(0, 6);
  $('#sessions').innerHTML = sessions.length
    ? sessions.map((s) => {
      const d = new Date(s.at);
      const when = dayKey(d) === dayKey() ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      const what = s.what.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
      return `<li><span class="what">${what}</span><span class="when">${fmt(s.secs)} · ${when}</span></li>`;
    }).join('')
    : '<li class="none">No sessions yet. Start the timer to log one.</li>';
}

function tickTimer() {
  const now = performance.now();
  const dt = (now - timer.last) / 1000;
  timer.last = now;
  timer.elapsed += dt;
  timer.logged += dt;
  if (timer.logged >= 5) { logPractice(Math.round(timer.logged)); timer.logged -= Math.round(timer.logged); renderStats(); }
  if (timer.mode === 'countdown' && timer.elapsed >= timer.duration) {
    timer.elapsed = timer.duration;
    timer.done = true;
    pauseTimer();
    saveSession();
    renderStats();
    Sound.chime();
  }
  renderTimer();
}

function startTimer() {
  if (timer.done) resetTimer(false);
  Sound.init();
  timer.running = true;
  timer.last = performance.now();
  timer.interval = setInterval(tickTimer, 200);
  const b = $('#timerToggle'); b.textContent = 'Pause'; b.classList.add('running');
  renderTimer();
}
function pauseTimer() {
  timer.running = false;
  clearInterval(timer.interval);
  if (timer.logged > 0.5) { logPractice(Math.round(timer.logged)); timer.logged = 0; renderStats(); }
  const b = $('#timerToggle'); b.textContent = timer.elapsed && !timer.done ? 'Resume' : 'Start'; b.classList.remove('running');
  renderTimer();
}
function resetTimer(save = true) {
  if (timer.running) pauseTimer();
  if (save && !timer.done) saveSession();
  timer.elapsed = 0; timer.done = false;
  $('#timerToggle').textContent = 'Start';
  renderStats();
  renderTimer();
}
const toggleTimer = () => (timer.running ? pauseTimer() : startTimer());

$('#timerToggle').addEventListener('click', toggleTimer);
$('#timerReset').addEventListener('click', () => resetTimer(true));
$('#timerPlus').addEventListener('click', () => {
  if (timer.mode !== 'countdown') return;
  if (timer.done) { timer.done = false; }
  timer.duration += 60;
  renderPresets(); renderTimer();
});
$('#presets').addEventListener('click', (e) => {
  const b = e.target.closest('[data-min]'); if (!b) return;
  timer.duration = +b.dataset.min * 60;
  store.set('duration', timer.duration);
  if (!timer.running) { timer.elapsed = 0; timer.done = false; $('#timerToggle').textContent = 'Start'; }
  renderPresets(); renderTimer();
});
$('#timerModeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]'); if (!b || b.dataset.mode === timer.mode) return;
  resetTimer(true);
  timer.mode = b.dataset.mode;
  $$('#timerModeSeg button').forEach((x) => x.classList.toggle('on', x === b));
  $('#timerPlus').disabled = timer.mode !== 'countdown';
  renderPresets(); renderTimer();
});
window.addEventListener('beforeunload', () => { if (timer.logged > 0.5) logPractice(Math.round(timer.logged)); });

renderPresets();
renderTimer();
renderStats();

/* =========================================================
   Header status pills + keyboard
   ========================================================= */
function updatePills() {
  const mp = $('#metroPill'), tp = $('#timerPill');
  mp.hidden = !metro.running;
  mp.textContent = `♩ ${metro.bpm}`;
  tp.hidden = !timer.running;
  if (timer.running) tp.textContent = `⏱ ${$('#timeDisplay').textContent}`;
}

document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat) return;
  const tag = document.activeElement?.tagName;
  if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(tag)) return;
  if (currentTab === 'metronome') { e.preventDefault(); toggleMetro(); }
  else if (currentTab === 'timer') { e.preventDefault(); toggleTimer(); }
});

setBpm(metro.bpm);
renderBeats();
mqVertical.addEventListener('change', renderFretboard);
showTab(location.hash.slice(1) || 'chords');
