'use strict';
/* Key explorer (scales, modes, chords and progressions for any key) and ear training.
   Uses $, $$, Sound, store, metro, showTab and chord-library helpers from app.js. */

/* =========================================================
   Note spelling: every scale/chord is written with interval
   names ("b3", "#4"…), so notes are spelled correctly
   (e.g. F♯ major contains E♯, not F).
   ========================================================= */
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
const IVS = {
  '1': 0, 'b2': 1, '2': 2, '#2': 3, 'b3': 3, '3': 4, 'b4': 4, '4': 5, '#4': 6, 'b5': 6, '5': 7,
  '#5': 8, 'b6': 8, '6': 9, 'bb7': 9, 'b7': 10, '7': 11, '8': 12,
  'b9': 1, '9': 2, '#9': 3, '11': 5, '#11': 6, 'b13': 8, '13': 9,
};
const ivNum = (iv) => parseInt(iv.replace(/[^0-9]/g, ''), 10);
const ivPos = (iv) => IVS[iv] + (ivNum(iv) >= 8 ? 12 : 0);        // semitones above root, compound aware
const parseNote = (s) => {
  const l = LETTERS.indexOf(s[0]);
  const acc = [...s.slice(1)].reduce((a, c) => a + (c === '#' ? 1 : c === 'b' ? -1 : 0), 0);
  return { l, acc, pc: (((LETTER_PC[l] + acc) % 12) + 12) % 12 };
};
function spell(root, iv) {
  const l = (root.l + ivNum(iv) - 1) % 7;
  const pc = (root.pc + IVS[iv]) % 12;
  let acc = (((pc - LETTER_PC[l]) % 12) + 12) % 12;
  if (acc > 6) acc -= 12;
  return { l, acc, pc };
}
const nStr = (n) => LETTERS[n.l] + (n.acc > 0 ? '♯'.repeat(n.acc) : '♭'.repeat(-n.acc));
const nAscii = (n) => LETTERS[n.l] + (n.acc > 0 ? '#'.repeat(n.acc) : 'b'.repeat(-n.acc));
const ivStr = (iv) => iv.replace(/b/g, '♭').replace(/#/g, '♯');
const baseMidi = (pc) => 45 + ((pc - 9 + 12) % 12);              // A2 … G♯3

/* =========================================================
   Data
   ========================================================= */
const KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'].map(parseNote);
const MAJOR = ['1', '2', '3', '4', '5', '6', '7'];
const HARM_MINOR = ['1', '2', 'b3', '4', '5', 'b6', '7'];

const MAJOR_MODES = [
  { name: 'Ionian', aka: 'the major scale', roman: 'I', iv: MAJOR, desc: 'Bright, happy and resolved. The reference every other scale is compared to.' },
  { name: 'Dorian', aka: 'minor', roman: 'ii', iv: ['1', '2', 'b3', '4', '5', '6', 'b7'], desc: 'Minor with a raised 6th: smooth and soulful. Funk, jazz, Latin rock.' },
  { name: 'Phrygian', aka: 'minor', roman: 'iii', iv: ['1', 'b2', 'b3', '4', '5', 'b6', 'b7'], desc: 'Minor with a ♭2: dark and Spanish-sounding. Flamenco and metal.' },
  { name: 'Lydian', aka: 'major', roman: 'IV', iv: ['1', '2', '3', '#4', '5', '6', '7'], desc: 'Major with a ♯4: dreamy and floating. Film scores and fusion.' },
  { name: 'Mixolydian', aka: 'major', roman: 'V', iv: ['1', '2', '3', '4', '5', '6', 'b7'], desc: 'Major with a ♭7: bluesy and confident. Classic rock and country.' },
  { name: 'Aeolian', aka: 'natural minor', roman: 'vi', iv: ['1', '2', 'b3', '4', '5', 'b6', 'b7'], desc: 'The natural minor scale: sad and serious. The relative minor of the key.' },
  { name: 'Locrian', aka: 'half diminished', roman: 'vii°', iv: ['1', 'b2', 'b3', '4', 'b5', 'b6', 'b7'], desc: 'With a ♭2 and ♭5 it never feels settled. Rare, tense, unstable.' },
];
const HARM_MODES = [
  { name: 'Harmonic minor', aka: 'Aeolian ♮7', roman: 'i', iv: HARM_MINOR, desc: 'Minor with a raised 7th. That big leap gives the classical / neoclassical sound.' },
  { name: 'Locrian ♮6', aka: 'half diminished', roman: 'ii°', iv: ['1', 'b2', 'b3', '4', 'b5', '6', 'b7'], desc: 'Locrian with a natural 6th. Dark and exotic.' },
  { name: 'Ionian ♯5', aka: 'augmented', roman: 'III+', iv: ['1', '2', '3', '4', '#5', '6', '7'], desc: 'Major with a raised 5th. Suspenseful and bright at once.' },
  { name: 'Dorian ♯4', aka: 'Romanian minor', roman: 'iv', iv: ['1', '2', 'b3', '#4', '5', '6', 'b7'], desc: 'Minor with a ♯4. Eastern European folk and klezmer.' },
  { name: 'Phrygian dominant', aka: 'Spanish', roman: 'V', iv: ['1', 'b2', '3', '4', '5', 'b6', 'b7'], desc: 'Major 3rd with a ♭2. Flamenco, Middle-Eastern and metal riffs.' },
  { name: 'Lydian ♯2', aka: 'major', roman: 'VI', iv: ['1', '#2', '3', '#4', '5', '6', '7'], desc: 'Major with a ♯2 and ♯4. Rare and very colourful.' },
  { name: 'Ultralocrian', aka: 'diminished', roman: 'vii°', iv: ['1', 'b2', 'b3', 'b4', 'b5', 'b6', 'bb7'], desc: 'Extremely tense, built around the diminished 7th chord.' },
];
const OTHER_SCALES = [
  { name: 'Major pentatonic', from: 'key', iv: ['1', '2', '3', '5', '6'], desc: 'Five notes with no clashes over major chords. Country, pop and happy solos.' },
  { name: 'Minor pentatonic', from: 'rel', iv: ['1', 'b3', '4', '5', 'b7'], desc: 'THE rock & blues soloing scale. If you learn one scale first, make it this one.' },
  { name: 'Blues scale', from: 'rel', iv: ['1', 'b3', '4', 'b5', '5', 'b7'], desc: 'Minor pentatonic plus the ♭5 "blue note". Bend into it!' },
  { name: 'Melodic minor', from: 'key', iv: ['1', '2', 'b3', '4', '5', '6', '7'], desc: 'Minor with raised 6th and 7th. A favourite of jazz players.' },
  { name: 'Whole tone', from: 'key', iv: ['1', '2', '3', '#4', '#5', 'b7'], desc: 'Only whole steps, so it has no "home". Dreamy and unresolved.' },
  { name: 'Diminished', from: 'key', aka: 'whole–half', iv: ['1', '2', 'b3', '4', 'b5', 'b6', 'bb7', '7'], desc: 'Alternating whole and half steps. Use it over diminished 7th chords.' },
];
const CHORD_FORMULAS = [
  { g: 'triads', name: 'Major triad', sym: '', iv: ['1', '3', '5'], desc: 'Bright and stable.' },
  { g: 'triads', name: 'Minor triad', sym: 'm', iv: ['1', 'b3', '5'], desc: 'Sad and soft. Lower the 3rd by one fret.' },
  { g: 'triads', name: 'Diminished triad', sym: '°', iv: ['1', 'b3', 'b5'], desc: 'Tense: two minor 3rds stacked.' },
  { g: 'triads', name: 'Augmented triad', sym: '+', iv: ['1', '3', '#5'], desc: 'Suspenseful: two major 3rds stacked.' },
  { g: 'triads', name: 'Suspended 2nd', sym: 'sus2', iv: ['1', '2', '5'], desc: 'Open and airy. No 3rd, so neither major nor minor.' },
  { g: 'triads', name: 'Suspended 4th', sym: 'sus4', iv: ['1', '4', '5'], desc: 'Wants to resolve back to the major chord.' },
  { g: 'triads', name: 'Power chord', sym: '5', iv: ['1', '5', '8'], desc: 'Root + 5th only. Rock and metal with distortion.' },
  { g: 'sevenths', name: 'Dominant 7th', sym: '7', iv: ['1', '3', '5', 'b7'], desc: 'Bluesy, pulls strongly to the I chord.' },
  { g: 'sevenths', name: 'Major 7th', sym: 'maj7', iv: ['1', '3', '5', '7'], desc: 'Lush and jazzy.' },
  { g: 'sevenths', name: 'Minor 7th', sym: 'm7', iv: ['1', 'b3', '5', 'b7'], desc: 'Mellow and smooth.' },
  { g: 'sevenths', name: 'Minor major 7th', sym: 'm(maj7)', iv: ['1', 'b3', '5', '7'], desc: 'Mysterious, spy-movie sound.' },
  { g: 'sevenths', name: 'Half-diminished', sym: 'm7♭5', iv: ['1', 'b3', 'b5', 'b7'], desc: 'The vii chord of a major key. Leads to minor chords.' },
  { g: 'sevenths', name: 'Diminished 7th', sym: '°7', iv: ['1', 'b3', 'b5', 'bb7'], desc: 'All minor 3rds: perfectly symmetrical and very tense.' },
  { g: 'sevenths', name: 'Major 6th', sym: '6', iv: ['1', '3', '5', '6'], desc: 'Sweet, vintage sound.' },
  { g: 'sevenths', name: 'Minor 6th', sym: 'm6', iv: ['1', 'b3', '5', '6'], desc: 'Dark, gypsy-jazz flavour.' },
  { g: 'sevenths', name: '7 sharp 5', sym: '7♯5', iv: ['1', '3', '#5', 'b7'], desc: 'Augmented dominant: extra pull to resolve.' },
  { g: 'sevenths', name: '7 flat 5', sym: '7♭5', iv: ['1', '3', 'b5', 'b7'], desc: 'Altered dominant used in jazz.' },
  { g: 'extended', name: 'Add 9', sym: 'add9', iv: ['1', '3', '5', '9'], desc: 'Major chord with sparkle. No 7th.' },
  { g: 'extended', name: 'Dominant 9th', sym: '9', iv: ['1', '3', '5', 'b7', '9'], desc: 'Funk and R&B staple.' },
  { g: 'extended', name: 'Minor 9th', sym: 'm9', iv: ['1', 'b3', '5', 'b7', '9'], desc: 'Silky neo-soul minor.' },
  { g: 'extended', name: 'Major 9th', sym: 'maj9', iv: ['1', '3', '5', '7', '9'], desc: 'Dreamy, lush ballad chord.' },
  { g: 'extended', name: 'Six-nine', sym: '6/9', iv: ['1', '3', '5', '6', '9'], desc: 'Final chord of countless jazz tunes.' },
  { g: 'extended', name: '7 sharp 9', sym: '7♯9', iv: ['1', '3', '5', 'b7', '#9'], desc: 'The gritty "Hendrix chord".' },
  { g: 'extended', name: '7 flat 9', sym: '7♭9', iv: ['1', '3', '5', 'b7', 'b9'], desc: 'Dark dominant, resolves to minor.' },
  { g: 'extended', name: 'Dominant 11th', sym: '11', iv: ['1', '5', 'b7', '9', '11'], desc: 'Open, modern gospel sound (3rd left out).' },
  { g: 'extended', name: 'Dominant 13th', sym: '13', iv: ['1', '3', '5', 'b7', '9', '13'], desc: 'Big-band jazz dominant.' },
];
const PROGRESSIONS = [
  { name: 'The classic', degs: [0, 3, 4, 0], tip: 'The backbone of rock, folk and country.' },
  { name: 'Pop anthem', degs: [0, 4, 5, 3], tip: 'Used in hundreds of chart hits.' },
  { name: '50s doo-wop', degs: [0, 5, 3, 4], tip: 'Ballads and old-school love songs.' },
  { name: 'Emotional', degs: [5, 3, 0, 4], tip: 'Same chords as the pop anthem, starting on the minor vi.' },
  { name: 'Jazz ii–V–I', degs: [1, 4, 0], sev: true, tip: 'The most important move in jazz.' },
  { name: '12-bar blues', degs: [0, 0, 0, 0, 3, 3, 0, 0, 4, 3, 0, 4], dom7: true, tip: 'Every chord a dominant 7th. One chord per bar.' },
];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/* =========================================================
   Key explorer
   ========================================================= */
const theory = {
  key: store.get('key', 0), view: 'relative', labels: 'notes', chords: 3, formulaGroup: 'triads',
  open: null, items: new Map(), prog: { timer: null, el: null },
};

const majorScale = (root) => MAJOR.map((iv) => spell(root, iv));

function diatonicChord(scale, i, size, forceDom7 = false) {
  const root = scale[i];
  let notes = [0, 2, 4, 6].slice(0, size).map((k) => scale[(i + k) % 7]);
  if (forceDom7) notes = ['1', '3', '5', 'b7'].map((iv) => spell(root, iv));
  const st = notes.map((n) => (n.pc - root.pc + 12) % 12);
  const [t, f, s] = [st[1], st[2], st[3]];
  let sym = '', ascii = '', roman = ROMAN[i];
  const minorish = t === 3;
  if (minorish) roman = roman.toLowerCase();
  if (size === 3) {
    if (t === 4 && f === 7) { sym = ''; }
    else if (t === 3 && f === 7) { sym = 'm'; ascii = 'm'; }
    else if (t === 3 && f === 6) { sym = '°'; ascii = 'dim'; roman += '°'; }
    else if (t === 4 && f === 8) { sym = '+'; ascii = 'aug'; roman += '+'; }
  } else {
    const key = `${t},${f},${s}`;
    const map = {
      '4,7,11': ['maj7', 'maj7', 'maj7'], '4,7,10': ['7', '7', '7'], '3,7,10': ['m7', 'm7', '7'],
      '3,6,10': ['m7♭5', 'm7b5', 'ø7'], '3,6,9': ['°7', 'dim7', '°7'], '3,7,11': ['m(maj7)', 'mmaj7', 'maj7'], '4,8,11': ['+maj7', 'augmaj7', '+maj7'],
    }[key] || ['', '', ''];
    [sym, ascii] = map; roman += map[2];
  }
  return { root, notes, name: nStr(root) + sym, ascii: nAscii(root) + ascii, roman };
}

function chordMidisFrom(notes) {
  // Guitar-like voicing: low root (+5th if present), then the chord tones an octave up.
  const r = baseMidi(notes[0].pc);
  const offs = notes.map((n) => (n.pc - notes[0].pc + 12) % 12);
  const out = [r];
  if (offs.includes(7)) out.push(r + 7);
  offs.forEach((o) => out.push(r + 12 + o));
  return [...new Set(out)].sort((a, b) => a - b);
}

function keySignature(scale) {
  const sharps = ['F', 'C', 'G', 'D', 'A', 'E', 'B'], flats = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
  const s = scale.filter((n) => n.acc > 0), f = scale.filter((n) => n.acc < 0);
  if (s.length) return { count: s.length, sign: '♯', list: sharps.filter((l) => s.some((n) => LETTERS[n.l] === l)).map((l) => l + '♯') };
  if (f.length) return { count: f.length, sign: '♭', list: flats.filter((l) => f.some((n) => LETTERS[n.l] === l)).map((l) => l + '♭') };
  return { count: 0, sign: '', list: [] };
}

function stepPattern(offsets) {
  const all = [...offsets, 12];
  return all.slice(1).map((o, i) => ({ 1: 'H', 2: 'W', 3: 'W½' }[o - all[i]] || '?')).join(' ');
}

function theoryFretboard(item) {
  const map = new Map(item.notes.map((n, i) => [n.pc, { n, iv: item.ivs[i] }]));
  const rootPc = item.notes[0].pc;
  const v = mqVertical.matches;
  return `<div class="fretboard-scroll"><div class="fretboard ${v ? 'vertical' : ''}">${fretboardInner((s, f) => {
    const midi = OPEN_MIDI[s] + f, x = map.get(midi % 12);
    if (!x) return null;
    const label = theory.labels === 'notes' ? nStr(x.n) : ivStr(x.iv === '8' ? '1' : x.iv);
    return { html: `<span class="fb-note ${midi % 12 === rootPc ? 'hit' : ''}">${label}</span>` };
  }, v)}</div></div>`;
}

function srRow(id, head, item, cols) {
  theory.items.set(id, item);
  const open = theory.open === id;
  const notes = item.ivs.map((iv, i) => ({ iv, n: item.notes[i], off: ivPos(iv) }));
  return `<div class="sr-item ${open ? 'open' : ''}" data-id="${id}">
    <div class="sr-head">
      ${head.deg ? `<span class="sr-deg">${head.deg}</span>` : ''}
      <span class="sr-title">${head.title}</span>${head.aka ? `<span class="sr-aka">${head.aka}</span>` : ''}
      ${head.steps ? `<span class="sr-steps" title="W = whole step (2 frets), H = half step (1 fret)">${head.steps}</span>` : ''}
      <span class="sr-play" aria-hidden="true">▶</span>
    </div>
    <div class="sr-scroll"><div class="sr-track" style="--n:${cols}">
      ${notes.map((x) => `<div class="sr-note ${x.iv === '1' || x.iv === '8' ? 'root' : ''}" style="grid-column:${x.off + 1}"><b>${nStr(x.n)}</b><small>${ivStr(x.iv)}</small></div>`).join('')}
    </div></div>
    ${open ? `<div class="sr-expand"><p class="sub small">${head.desc || ''}</p>${theoryFretboard(item)}<p class="sub small fb-hint">Highlighted = root. Tap any dot to hear it. ${theory.labels === 'notes' ? 'Switch to <b>Intervals</b> to see each note\'s role.' : ''}</p></div>` : ''}
  </div>`;
}

function scaleItem(root, ivs, withOctave = true) {
  const list = withOctave ? [...ivs, '8'] : ivs;
  return { root, ivs: list, notes: list.map((iv) => spell(root, iv)), kind: 'scale' };
}

function renderTheory() {
  const root = KEYS[theory.key];
  const scale = majorScale(root);
  const rel = scale[5];
  const sig = keySignature(scale);
  theory.items.clear();

  $('#keyName').textContent = `${nStr(root)} major`;
  $('#keyInfo').innerHTML = `<span class="badge">${sig.count ? sig.count + sig.sign : 'no ♯/♭'}</span> ${sig.count ? sig.list.join(' ') : 'All natural notes'} · Relative minor: <b>${nStr(rel)} minor</b>`;
  $('#keySlider').value = theory.key;
  $$('#keyTicks button').forEach((b, i) => b.classList.toggle('on', i === theory.key));

  // Diatonic chords
  $('#diaGrid').innerHTML = scale.map((_, i) => {
    const c = diatonicChord(scale, i, theory.chords);
    const lib = CHORDS.find((x) => x.name === c.ascii);
    return `<div class="dia ${c.roman === c.roman.toLowerCase() ? 'minor' : ''}" data-i="${i}" role="button" tabindex="0">
      <div class="dia-roman">${c.roman}</div><div class="dia-name">${c.name}</div>
      <div class="dia-notes">${c.notes.map(nStr).join(' ')}</div>
      ${lib ? `<button class="link" data-chord-link="${lib.name}">Fingering →</button>` : ''}
    </div>`;
  }).join('');

  // Progressions
  $('#progList').innerHTML = PROGRESSIONS.map((p, pi) => {
    const chords = p.degs.map((d) => diatonicChord(scale, d, p.sev ? 4 : 3, p.dom7));
    const romans = chords.map((c) => c.roman);
    return `<div class="prog" data-p="${pi}">
      <button class="prog-play" aria-label="Play ${p.name}">▶</button>
      <div class="prog-body">
        <div class="prog-name">${p.name} <span class="sub small">${p.dom7 ? 'I7 · IV7 · V7' : romans.join(' – ')}</span></div>
        <div class="prog-chords">${chords.map((c) => `<span class="pc">${p.dom7 ? nStr(c.root) + '7' : c.name}</span>`).join('')}</div>
        <div class="sub small">${p.tip}</div>
      </div>
    </div>`;
  }).join('');

  // Scales & modes
  const relHarm = HARM_MINOR.map((iv) => spell(rel, iv));
  const par = theory.view === 'parallel';
  $('#modeHint').innerHTML = par
    ? `Every scale starts on <b>${nStr(root)}</b>, so you can compare how each one changes the sound. Notes that differ from the major scale show up as ♭ or ♯ in the numbers.`
    : `Each mode starts on a different note of <b>${nStr(root)} major</b> but uses the same notes. The harmonic minor modes come from the relative minor, <b>${nStr(rel)}</b>.`;
  let html = `<h3>Major scale modes</h3>`;
  MAJOR_MODES.forEach((m, i) => {
    const r = par ? root : scale[i];
    const it = scaleItem(r, m.iv);
    html += srRow('m' + i, { deg: par ? '' : m.roman, title: `${nStr(r)} ${m.name}`, aka: m.aka, steps: stepPattern(m.iv.map((iv) => IVS[iv])), desc: m.desc }, it, 13);
  });
  html += `<h3>Harmonic minor modes</h3>`;
  HARM_MODES.forEach((m, i) => {
    const r = par ? root : relHarm[i];
    const it = scaleItem(r, m.iv);
    html += srRow('h' + i, { deg: par ? '' : m.roman, title: `${nStr(r)} ${m.name}`, aka: m.aka, steps: stepPattern(m.iv.map((iv) => IVS[iv])), desc: m.desc }, it, 13);
  });
  html += `<h3>More scales</h3>`;
  OTHER_SCALES.forEach((m, i) => {
    const r = !par && m.from === 'rel' ? rel : root;
    const it = scaleItem(r, m.iv);
    html += srRow('o' + i, { title: `${nStr(r)} ${m.name}`, aka: m.aka, steps: stepPattern(m.iv.map((iv) => IVS[iv])), desc: m.desc }, it, 13);
  });
  $('#scaleList').innerHTML = html;

  // Chord formulas
  $('#chordRootName').textContent = nStr(root);
  $$('#formulaFilter .chip').forEach((c) => c.classList.toggle('on', c.dataset.g === theory.formulaGroup));
  const forms = CHORD_FORMULAS.filter((c) => c.g === theory.formulaGroup);
  const cols = theory.formulaGroup === 'extended' ? 22 : 13;
  $('#formulaList').innerHTML = forms.map((c) => {
    const i = CHORD_FORMULAS.indexOf(c);
    const it = { root, ivs: c.iv, notes: c.iv.map((iv) => spell(root, iv)), kind: 'chord' };
    return srRow('c' + i, { title: `${nStr(root)}${c.sym}`, aka: c.name, desc: c.desc }, it, cols);
  }).join('');

  $$('.labelSeg button').forEach((b) => b.classList.toggle('on', b.dataset.l === theory.labels));
}

function playItem(item) {
  Sound.init();
  if (item.kind === 'chord') {
    const r = baseMidi(item.root.pc);
    const mids = item.ivs.map((iv) => r + ivPos(iv));
    Sound.arpeggio(mids);
    setTimeout(() => Sound.strum(mids, 0.025), mids.length * 320 + 200);
  } else {
    const r = baseMidi(item.root.pc);
    const t = Sound.ctx.currentTime + 0.03;
    item.ivs.forEach((iv, k) => Sound.pluck(r + ivPos(iv), t + k * 0.26, 0.5));
  }
}

function stopProgression() {
  clearTimeout(theory.prog.timer);
  if (theory.prog.el) {
    theory.prog.el.classList.remove('playing');
    $$('.pc', theory.prog.el).forEach((x) => x.classList.remove('now'));
    $('.prog-play', theory.prog.el).textContent = '▶';
  }
  theory.prog.el = null;
}

function playProgression(el) {
  const same = theory.prog.el === el;
  stopProgression();
  if (same) return;
  const p = PROGRESSIONS[+el.dataset.p];
  const scale = majorScale(KEYS[theory.key]);
  const chords = p.degs.map((d) => diatonicChord(scale, d, p.sev ? 4 : 3, p.dom7));
  const chips = $$('.pc', el);
  theory.prog.el = el;
  el.classList.add('playing');
  $('.prog-play', el).textContent = '■';
  const beat = 60000 / metro.bpm;
  const per = beat * (p.dom7 ? 4 : 2);
  let k = 0;
  const step = () => {
    if (k >= chords.length) { stopProgression(); return; }
    chips.forEach((c, j) => c.classList.toggle('now', j === k));
    const mids = chordMidisFrom(chords[k].notes);
    Sound.strum(mids);
    if (p.dom7 || per > beat * 1.5) setTimeout(() => { if (theory.prog.el === el) Sound.strum(mids, 0.012); }, beat * (p.dom7 ? 2 : 1));
    k++;
    theory.prog.timer = setTimeout(step, per);
  };
  step();
}

function openInChordLibrary(name) {
  chordState.cat = 'all'; chordState.query = ''; chordState.selected = name;
  $('#chordSearch').value = '';
  renderChordFilters(); renderChordGrid(); renderChordDetail();
  showTab('chords');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setKey(i) {
  theory.key = (i + 12) % 12;
  store.set('key', theory.key);
  stopProgression();
  renderTheory();
}

// Key picker
$('#keyTicks').innerHTML = KEYS.map((k, i) => `<button data-k="${i}">${nStr(k)}</button>`).join('');
$('#keyTicks').addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) setKey(+b.dataset.k); });
$('#keySlider').addEventListener('input', (e) => setKey(+e.target.value));
$('#keyPrev').addEventListener('click', () => setKey(theory.key - 1));
$('#keyNext').addEventListener('click', () => setKey(theory.key + 1));
$('#playKeyScale').addEventListener('click', () => playItem(scaleItem(KEYS[theory.key], MAJOR)));

$('#diaSeg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-d]'); if (!b) return;
  theory.chords = +b.dataset.d;
  $$('#diaSeg button').forEach((x) => x.classList.toggle('on', x === b));
  renderTheory();
});
$('#diaGrid').addEventListener('click', (e) => {
  const link = e.target.closest('[data-chord-link]');
  if (link) { openInChordLibrary(link.dataset.chordLink); return; }
  const d = e.target.closest('.dia'); if (!d) return;
  const c = diatonicChord(majorScale(KEYS[theory.key]), +d.dataset.i, theory.chords);
  Sound.strum(chordMidisFrom(c.notes));
  d.classList.add('flash'); setTimeout(() => d.classList.remove('flash'), 350);
});
$('#diaGrid').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('dia')) e.target.click(); });
$('#progList').addEventListener('click', (e) => { const p = e.target.closest('.prog'); if (p) playProgression(p); });

$('#modeView').addEventListener('click', (e) => {
  const b = e.target.closest('[data-v]'); if (!b) return;
  theory.view = b.dataset.v; theory.open = null;
  $$('#modeView button').forEach((x) => x.classList.toggle('on', x === b));
  renderTheory();
});
$$('.labelSeg').forEach((seg) => seg.addEventListener('click', (e) => {
  const b = e.target.closest('[data-l]'); if (!b) return;
  theory.labels = b.dataset.l;
  renderTheory();
}));
$('#formulaFilter').addEventListener('click', (e) => {
  const b = e.target.closest('[data-g]'); if (!b) return;
  theory.formulaGroup = b.dataset.g; theory.open = null;
  renderTheory();
});
$('#panel-theory').addEventListener('click', (e) => {
  const cell = e.target.closest('.sr-expand .fb-cell');
  if (cell) { Sound.pluck(+cell.dataset.midi); return; }
  if (e.target.closest('.sr-expand')) return;
  const row = e.target.closest('.sr-item'); if (!row) return;
  const id = row.dataset.id;
  const item = theory.items.get(id);
  theory.open = theory.open === id ? null : id;
  renderTheory();
  if (theory.open) playItem(item);
});

renderTheory();

/* =========================================================
   Ear training
   ========================================================= */
const EAR_INTERVALS = [
  { id: 'm2', s: 1, name: 'Minor 2nd', hint: 'Very tense. Think of the shark theme from "Jaws".' },
  { id: 'M2', s: 2, name: 'Major 2nd', hint: 'One whole step, the first two notes of "Happy Birthday".' },
  { id: 'm3', s: 3, name: 'Minor 3rd', hint: 'Sad-sounding. Start of "Greensleeves".' },
  { id: 'M3', s: 4, name: 'Major 3rd', hint: 'Happy-sounding. Start of "When the Saints Go Marching In".' },
  { id: 'P4', s: 5, name: 'Perfect 4th', hint: 'Start of "Here Comes the Bride".' },
  { id: 'TT', s: 6, name: 'Tritone', hint: 'Unstable and spooky. Start of "The Simpsons" theme.' },
  { id: 'P5', s: 7, name: 'Perfect 5th', hint: 'Strong and open, like a power chord. Start of the "Star Wars" theme.' },
  { id: 'm6', s: 8, name: 'Minor 6th', hint: 'Bittersweet. The big leap in "The Entertainer".' },
  { id: 'M6', s: 9, name: 'Major 6th', hint: 'Start of "My Bonnie Lies Over the Ocean".' },
  { id: 'm7', s: 10, name: 'Minor 7th', hint: 'Like a dominant 7th chord. Start of "Somewhere" (West Side Story).' },
  { id: 'M7', s: 11, name: 'Major 7th', hint: 'One fret short of an octave: dreamy and tense.' },
  { id: 'P8', s: 12, name: 'Octave', hint: 'Same note, higher. Start of "Somewhere Over the Rainbow".' },
];
const EAR_CHORDS = [
  { id: 'maj', s: [0, 4, 7], name: 'Major', hint: 'Bright, stable, happy.' },
  { id: 'min', s: [0, 3, 7], name: 'Minor', hint: 'Darker and sadder than major.' },
  { id: 'dim', s: [0, 3, 6], name: 'Diminished', hint: 'Tense and spooky, like something is about to happen.' },
  { id: 'aug', s: [0, 4, 8], name: 'Augmented', hint: 'Suspenseful, dream-sequence sound.' },
  { id: 'sus4', s: [0, 5, 7], name: 'Sus4', hint: 'Open, unresolved. Wants to fall back to major.' },
  { id: 'dom7', s: [0, 4, 7, 10], name: 'Dominant 7', hint: 'Bluesy, pulls toward home.' },
  { id: 'maj7', s: [0, 4, 7, 11], name: 'Major 7', hint: 'Soft, jazzy, lush.' },
  { id: 'm7', s: [0, 3, 7, 10], name: 'Minor 7', hint: 'Mellow and smooth.' },
];
const EAR_LEVELS = {
  intervals: [['M3', 'P4', 'P5', 'P8'], ['M2', 'm3', 'M3', 'P4', 'P5', 'M6', 'm7', 'P8'], EAR_INTERVALS.map((x) => x.id)],
  chords: [['maj', 'min'], ['maj', 'min', 'dim', 'aug', 'sus4'], EAR_CHORDS.map((x) => x.id)],
};

const ear = {
  mode: 'intervals', level: 0, dir: 'up', q: null, base: 48, answered: false,
  score: 0, total: 0, streak: 0, stats: store.get('ear', {}),
};
const earList = () => (ear.mode === 'intervals' ? EAR_INTERVALS : EAR_CHORDS);
const earPool = () => earList().filter((x) => EAR_LEVELS[ear.mode][ear.level].includes(x.id));

function earSound(item, base = ear.base) {
  Sound.init();
  const t = Sound.ctx.currentTime + 0.03;
  if (ear.mode === 'intervals') {
    const lo = base, hi = base + item.s;
    if (ear.dir === 'up') { Sound.pluck(lo, t, 0.55); Sound.pluck(hi, t + 0.75, 0.55); }
    else if (ear.dir === 'down') { Sound.pluck(hi, t, 0.55); Sound.pluck(lo, t + 0.75, 0.55); }
    else { Sound.pluck(lo, t, 0.5); Sound.pluck(hi, t, 0.5); }
  } else {
    const mids = item.s.map((s) => base + s);
    Sound.strum([base - 12, ...mids], 0.035);
  }
}

function renderEarAnswers() {
  $('#earAnswers').innerHTML = earPool().map((x) =>
    `<button class="ear-ans" data-id="${x.id}"><b>${x.name}</b>${ear.mode === 'intervals' ? `<small>${x.s} fret${x.s > 1 ? 's' : ''}</small>` : ''}</button>`).join('');
}

function renderEarStats() {
  const rows = earList().map((x) => ({ x, st: ear.stats[x.id] })).filter((r) => r.st && r.st.t);
  $('#earStats').innerHTML = rows.length
    ? rows.map(({ x, st }) => {
      const pct = Math.round((st.r / st.t) * 100);
      return `<div class="acc-row"><span>${x.name}</span><div class="acc-bar"><i style="width:${pct}%" class="${pct < 60 ? 'low' : ''}"></i></div><span class="acc-num">${st.r}/${st.t}</span></div>`;
    }).join('')
    : '<p class="sub small">Answer a few questions and your accuracy for each one will appear here. Weak spots are shown in pink so you know what to practise.</p>';
  $('#earScore').textContent = `${ear.score} / ${ear.total}`;
  $('#earStreak').textContent = ear.streak;
}

function earNext() {
  const pool = earPool();
  let q;
  do { q = pool[Math.floor(Math.random() * pool.length)]; } while (pool.length > 1 && ear.q && q.id === ear.q.id);
  ear.q = q;
  ear.base = ear.mode === 'intervals' ? 45 + Math.floor(Math.random() * 12) : 48 + Math.floor(Math.random() * 7);
  ear.answered = false;
  $$('.ear-ans').forEach((b) => b.classList.remove('right', 'wrong'));
  $('#earFeedback').innerHTML = `What did you hear? <span class="sub">Replay as often as you like.</span>`;
  $('#earFeedback').className = 'ear-feedback';
  $('#earPlay').textContent = '↻ Replay';
  $('#earNext').hidden = true;
  earSound(q);
}

$('#earPlay').addEventListener('click', () => { if (!ear.q) earNext(); else earSound(ear.q); });
$('#earNext').addEventListener('click', earNext);
$('#earAnswers').addEventListener('click', (e) => {
  const b = e.target.closest('.ear-ans'); if (!b) return;
  const item = earList().find((x) => x.id === b.dataset.id);
  if (!ear.q || ear.answered) { earSound(item); return; }   // after answering: tap to compare sounds
  const right = item.id === ear.q.id;
  ear.answered = true;
  ear.total++;
  ear.score += right ? 1 : 0;
  ear.streak = right ? ear.streak + 1 : 0;
  const st = ear.stats[ear.q.id] || { r: 0, t: 0 };
  st.t++; if (right) st.r++;
  ear.stats[ear.q.id] = st;
  store.set('ear', ear.stats);
  b.classList.add(right ? 'right' : 'wrong');
  $(`.ear-ans[data-id="${ear.q.id}"]`).classList.add('right');
  const fb = $('#earFeedback');
  fb.className = 'ear-feedback ' + (right ? 'good' : 'bad');
  fb.innerHTML = `${right ? '✓ Correct!' : `✗ It was <b>${ear.q.name}</b>.`} <span class="hint">${ear.q.hint}</span>
    <span class="sub small">Tip: tap any answer now to hear it and compare.</span>`;
  $('#earNext').hidden = false;
  $('#earNext').focus();
  renderEarStats();
});
$('#earModeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-m]'); if (!b) return;
  ear.mode = b.dataset.m; ear.q = null;
  $$('#earModeSeg button').forEach((x) => x.classList.toggle('on', x === b));
  $('#earDirField').hidden = ear.mode !== 'intervals';
  $('#earPlay').textContent = '▶ Play';
  $('#earNext').hidden = true;
  $('#earFeedback').innerHTML = ear.mode === 'intervals'
    ? 'Press <b>Play</b> to hear two notes, then name the distance between them.'
    : 'Press <b>Play</b> to hear a chord, then name its type.';
  renderEarAnswers(); renderEarStats();
});
$('#earLevel').addEventListener('change', (e) => { ear.level = +e.target.value; ear.q = null; $('#earPlay').textContent = '▶ Play'; $('#earNext').hidden = true; renderEarAnswers(); });
$('#earDir').addEventListener('change', (e) => { ear.dir = e.target.value; });
$('#earReset').addEventListener('click', () => { ear.stats = {}; store.set('ear', {}); ear.score = ear.total = ear.streak = 0; renderEarStats(); });

renderEarAnswers();
renderEarStats();
