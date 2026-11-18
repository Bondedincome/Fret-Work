'use strict';
/* Theory sub-sections: lessons, circle of fifths, chord finder, transpose & capo.
   Builds on app.js (Sound, store, fretboardInner, chordSVG…) and theory.js (KEYS, spell, diatonicChord…). */

const AUTO_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const nameFor = (pc, mode = 'auto') => (mode === 'sharp' ? SHARPS : mode === 'flat' ? FLATS : AUTO_NAMES)[((pc % 12) + 12) % 12];
const nums = (s) => s.trim().split(/\s+/).map(Number);

/* =========================================================
   Sub-navigation
   ========================================================= */
const SUBS = ['lessons', 'keys', 'circle', 'finder', 'transpose'];
let currentSub = store.get('theorySub', 'lessons');

function showSub(name) {
  if (!SUBS.includes(name)) name = 'lessons';
  currentSub = name;
  store.set('theorySub', name);
  $$('#theoryNav button').forEach((b) => b.classList.toggle('on', b.dataset.sub === name));
  $$('#panel-theory .subpanel').forEach((p) => p.classList.toggle('active', p.id === 'sub-' + name));
  const btn = $(`#theoryNav [data-sub="${name}"]`);
  btn.scrollIntoView({ block: 'nearest', inline: 'center' });
  if (name === 'circle') renderCircle();
}
$('#theoryNav').addEventListener('click', (e) => { const b = e.target.closest('[data-sub]'); if (b) showSub(b.dataset.sub); });

function goSub(name) {
  showTab('theory');
  showSub(name);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* =========================================================
   Circle of fifths
   ========================================================= */
const CX = 170, CY = 170;
function arcPath(r1, r2, a0, a1) {
  const p = (r, a) => { const t = ((a - 90) * Math.PI) / 180; return `${(CX + r * Math.cos(t)).toFixed(2)} ${(CY + r * Math.sin(t)).toFixed(2)}`; };
  return `M ${p(r2, a0)} A ${r2} ${r2} 0 0 1 ${p(r2, a1)} L ${p(r1, a1)} A ${r1} ${r1} 0 0 0 ${p(r1, a0)} Z`;
}
const polar = (r, a) => { const t = ((a - 90) * Math.PI) / 180; return [CX + r * Math.cos(t), CY + r * Math.sin(t)]; };

function renderCircle() {
  const k = theory.key;
  const outerRole = { [k]: 'I', [(k + 1) % 12]: 'V', [(k + 11) % 12]: 'IV' };
  const innerRole = { [k]: 'vi', [(k + 1) % 12]: 'iii', [(k + 11) % 12]: 'ii' };
  let s = '';
  KEYS.forEach((key, i) => {
    const a = i * 30;
    const sig = keySignature(majorScale(key));
    const sigTxt = sig.count ? sig.count + sig.sign : '–';
    const oRole = outerRole[i], iRole = innerRole[i];
    const minor = spell(key, '6');
    const [ox, oy] = polar(146, a), [sx, sy] = polar(126, a), [ix, iy] = polar(92, a), [rx, ry] = polar(75, a);
    s += `<g class="cw maj ${oRole ? 'in' : ''} ${i === k ? 'tonic' : ''}" data-k="${i}" role="button" tabindex="0" aria-label="${nStr(key)} major">
      <path d="${arcPath(110, 166, a - 15, a + 15)}"/>
      <text x="${ox}" y="${oy + 5}" class="cw-name">${nStr(key)}${i === 6 ? '' : ''}</text>
      <text x="${sx}" y="${sy + 4}" class="cw-sub">${oRole || sigTxt}</text></g>`;
    s += `<g class="cw min ${iRole ? 'in' : ''}" data-k="${i}" role="button" tabindex="0" aria-label="${nStr(minor)} minor">
      <path d="${arcPath(62, 110, a - 15, a + 15)}"/>
      <text x="${ix}" y="${iy + 4}" class="cw-name sm">${nStr(minor)}m</text>
      ${iRole ? `<text x="${rx}" y="${ry + 3}" class="cw-sub">${iRole}</text>` : ''}</g>`;
  });
  const root = KEYS[k];
  s += `<circle cx="${CX}" cy="${CY}" r="58" class="cw-center"/>
    <text x="${CX}" y="${CY - 2}" class="cw-key">${nStr(root)}</text>
    <text x="${CX}" y="${CY + 18}" class="cw-keysub">major</text>`;
  $('#circleSvg').innerHTML = s;

  const scale = majorScale(root);
  const sig = keySignature(scale);
  const chords = [0, 1, 2, 3, 4, 5, 6].map((i) => diatonicChord(scale, i, 3));
  const V = KEYS[(k + 1) % 12], IV = KEYS[(k + 11) % 12];
  $('#circleInfo').innerHTML = `
    <h2>${nStr(root)} major <span class="sub small">/ ${nStr(scale[5])} minor</span></h2>
    <p class="sub">${sig.count ? `${sig.count} ${sig.sign === '♯' ? 'sharp' : 'flat'}${sig.count > 1 ? 's' : ''}: <b>${sig.list.join(' ')}</b>` : 'No sharps or flats'}</p>
    <h3>The chords of this key</h3>
    <p class="sub small">The 6 highlighted wedges sit right next to each other. That's why these chords sound good together. Tap to hear them.</p>
    <div class="circle-chords">
      ${chords.map((c, i) => `<button class="cc ${i === 0 ? 'tonic' : ''} ${c.roman === c.roman.toLowerCase() ? 'minor' : ''}" data-ci="${i}"><span>${c.roman}</span>${c.name}</button>`).join('')}
    </div>
    <h3>Neighbours</h3>
    <ul class="tips">
      <li>Clockwise is <b>${nStr(V)} major</b> (your V chord's key). It has one more sharp (or one fewer flat).</li>
      <li>Counter-clockwise is <b>${nStr(IV)} major</b> (your IV chord's key).</li>
      <li>Neighbouring keys share 6 of their 7 notes, so songs often change key to a neighbour.</li>
    </ul>
    <h3>Memory trick</h3>
    <p class="sub small">Order of sharps: <b>F C G D A E B</b> ("Father Charles Goes Down And Ends Battle"). Flats are the same letters backwards: <b>B E A D G C F</b>.</p>
    <button class="btn" id="circleToKeys">Open ${nStr(root)} in Key explorer →</button>`;
}

$('#circleSvg').addEventListener('click', (e) => {
  const g = e.target.closest('.cw'); if (!g) return;
  setKey(+g.dataset.k);
  renderCircle();
  const sc = majorScale(KEYS[theory.key]);
  Sound.strum(chordMidisFrom(diatonicChord(sc, g.classList.contains('min') ? 5 : 0, 3).notes));
});
$('#circleSvg').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.closest('.cw')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
$('#circleInfo').addEventListener('click', (e) => {
  if (e.target.closest('#circleToKeys')) { goSub('keys'); return; }
  const b = e.target.closest('[data-ci]'); if (!b) return;
  const c = diatonicChord(majorScale(KEYS[theory.key]), +b.dataset.ci, 3);
  Sound.strum(chordMidisFrom(c.notes));
});

/* =========================================================
   Chord finder (name any shape)
   ========================================================= */
const finder = { frets: store.get('finder', [-1, 3, 2, 0, 1, 0]) };
const FORMULA_SETS = CHORD_FORMULAS.map((c) => ({
  ...c, set: [...new Set(c.iv.map((iv) => IVS[iv] % 12))].sort((a, b) => a - b),
}));

function identifyChord(frets) {
  const mids = frets.map((f, s) => (f >= 0 ? OPEN_MIDI[s] + f : null)).filter((x) => x !== null);
  const pcs = [...new Set(mids.map((m) => m % 12))];
  if (pcs.length < 2) return { mids, pcs, results: [] };
  const bass = Math.min(...mids) % 12;
  const results = [];
  pcs.forEach((r) => {
    const set = pcs.map((p) => (p - r + 12) % 12).sort((a, b) => a - b).join();
    FORMULA_SETS.forEach((f) => {
      let match = f.set.join() === set ? 'exact' : null;
      if (!match && f.set.length >= 4 && f.set.includes(7) && f.set.filter((x) => x !== 7).join() === set) match = 'no5';
      if (match) results.push({ root: r, f, match, inv: r !== bass, bass });
    });
  });
  results.sort((a, b) => (a.match === 'exact' ? 0 : 1) - (b.match === 'exact' ? 0 : 1) || a.inv - b.inv || a.f.set.length - b.f.set.length);
  return { mids, pcs, bass, results };
}
const chordLabel = (r) => nameFor(r.root) + r.f.sym + (r.inv ? '/' + nameFor(r.bass) : '');

function renderFinder() {
  const v = mqVertical.matches;
  const board = $('#finderBoard');
  board.classList.toggle('vertical', v);
  board.innerHTML = fretboardInner((s, f) => (finder.frets[s] === f
    ? { cls: 'picked', html: `<span class="fb-note hit">${nameFor(OPEN_MIDI[s] + f)}</span>` }
    : { cls: finder.frets[s] === -1 ? 'muted' : '' }), v);
  $('#finderStrings').innerHTML = finder.frets.map((f, s) =>
    `<button class="fs ${f < 0 ? 'off' : ''}" data-s="${s}" title="Mute / unmute"><b>${STRING_LETTERS[s]}</b><span>${f < 0 ? '×' : f}</span></button>`).join('');

  const id = identifyChord(finder.frets);
  const fretted = finder.frets.filter((f) => f > 0);
  const maxF = fretted.length ? Math.max(...fretted) : 0;
  const shape = {
    name: 'shape', full: 'Your chord shape', frets: finder.frets, fingers: [0, 0, 0, 0, 0, 0], barre: null,
    base: maxF > 5 ? Math.min(...fretted) : 1,
  };
  const lib = CHORDS.find((c) => c.frets.join() === finder.frets.join());
  const top = id.results[0];
  const tab = finder.frets.map((f) => (f < 0 ? 'x' : f)).join(maxF > 9 ? '-' : '');
  let html;
  if (!top) {
    html = `<div class="finder-name muted-name">${id.pcs.length < 2 ? 'Pick some notes' : 'No common name'}</div>
      <p class="sub">${id.pcs.length < 2 ? 'A chord needs at least two different notes.' : 'These notes don\'t form a standard chord. Try moving one finger.'}</p>`;
  } else {
    const ivNames = { 0: '1', 1: '♭9', 2: '9', 3: top.f.set.includes(4) ? '♯9' : '♭3', 4: '3', 5: top.f.set.includes(4) || top.f.sym.includes('11') ? '11' : '4', 6: top.f.set.includes(7) ? '♯11' : '♭5', 7: '5', 8: top.f.set.includes(7) ? '♭13' : '♯5', 9: top.f.sym.includes('°7') ? '𝄫7' : (top.f.set.includes(10) || top.f.set.includes(11)) && !['6', 'm6', '6/9'].includes(top.f.sym) ? '13' : '6', 10: '♭7', 11: '7' };
    const notes = [...new Set(id.mids.map((m) => m % 12))];
    html = `<div class="finder-name">${pretty(chordLabel(top))}</div>
      <div class="sub">${top.f.name}${top.inv ? ` with ${pretty(nameFor(top.bass))} in the bass` : ''}${top.match === 'no5' ? ' (5th left out, which is common)' : ''}</div>
      ${id.results.length > 1 ? `<p class="sub small">Also called: ${[...new Set(id.results.slice(1, 5).map((r) => pretty(chordLabel(r))))].join(', ')}</p>` : ''}
      <h3>Notes</h3>
      <div class="tone-row">${notes.map((pc) => `<span class="tone">${pretty(nameFor(pc))}<small>${ivNames[(pc - top.root + 12) % 12]}</small></span>`).join('')}</div>`;
  }
  $('#finderResult').innerHTML = `${html}
    <div class="finder-diagram">${chordSVG(shape)}</div>
    <p class="sub small center">Tab: <code>${tab}</code>${lib ? ` · <button class="link" data-chord-link="${lib.name}">Same as ${pretty(lib.name)} in the library →</button>` : ''}</p>`;
  store.set('finder', finder.frets);
}

$('#finderBoard').addEventListener('click', (e) => {
  const c = e.target.closest('.fb-cell'); if (!c) return;
  const s = +c.dataset.s, f = +c.dataset.f;
  finder.frets[s] = finder.frets[s] === f ? -1 : f;
  if (finder.frets[s] >= 0) Sound.pluck(OPEN_MIDI[s] + f);
  renderFinder();
});
$('#finderStrings').addEventListener('click', (e) => {
  const b = e.target.closest('[data-s]'); if (!b) return;
  const s = +b.dataset.s;
  finder.frets[s] = finder.frets[s] < 0 ? 0 : -1;
  renderFinder();
});
$('#finderPlay').addEventListener('click', () => Sound.strum(finder.frets.map((f, s) => (f >= 0 ? OPEN_MIDI[s] + f : null)).filter((x) => x !== null)));
$('#finderClear').addEventListener('click', () => { finder.frets = [-1, -1, -1, -1, -1, -1]; renderFinder(); });
$('#finderResult').addEventListener('click', (e) => { const l = e.target.closest('[data-chord-link]'); if (l) openInChordLibrary(l.dataset.chordLink); });

/* =========================================================
   Transpose & capo
   ========================================================= */
const tp = { shift: 0 };
const CHORD_TOKEN = /^([A-G])([#b♯♭]?)([a-zA-Z0-9#b♯♭+°ø()\-]*)(?:\/([A-G])([#b♯♭]?))?$/;
const SUFFIX_OK = /^(m|maj|min|dim|aug|sus|add|M|[0-9]|[#b♯♭+°ø()\-])*$/;
const accVal = (a) => (a === '#' || a === '♯' ? 1 : a === 'b' || a === '♭' ? -1 : 0);

function parseChordToken(tok) {
  const m = tok.match(CHORD_TOKEN);
  if (!m || !SUFFIX_OK.test(m[3])) return null;
  const pc = (LETTER_PC[LETTERS.indexOf(m[1])] + accVal(m[2]) + 12) % 12;
  const bass = m[4] ? (LETTER_PC[LETTERS.indexOf(m[4])] + accVal(m[5]) + 12) % 12 : null;
  return { pc, suffix: m[3], bass };
}
const chordToString = (c, n, mode) => nameFor(c.pc + n, mode) + c.suffix + (c.bass !== null ? '/' + nameFor(c.bass + n, mode) : '');

function renderTranspose() {
  const mode = $('#tpSpell').value;
  const n = tp.shift;
  $('#tpShift').textContent = (n > 0 ? '+' : '') + n;
  const found = [];
  const out = $('#tpInput').value.split('\n').map((line) => line.split(/(\s+|\|)/).map((tok) => {
    const c = tok && parseChordToken(tok);
    if (!c) return tok.replace(/[<>&]/g, (x) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[x]));
    found.push(c);
    return `<b>${pretty(chordToString(c, n, mode))}</b>`;
  }).join('')).join('\n');
  $('#tpOutput').innerHTML = out || '<span class="sub">Type some chords above.</span>';
  $('#tpKeyNote').textContent = found.length && n
    ? `· ${pretty(nameFor(found[0].pc))}${found[0].suffix} → ${pretty(nameFor(found[0].pc + n, mode))}${found[0].suffix}` : '';

  // Capo helper: which capo fret lets you play the transposed song with open shapes?
  const easy = new Set(CHORDS.filter((c) => !c.barre).map((c) => c.name));
  const uniq = [...new Map(found.map((c) => [`${(c.pc + n) % 12}|${c.suffix}`, c])).values()];
  if (!uniq.length) { $('#capoList').innerHTML = '<p class="sub">No chords found yet.</p>'; return; }
  const options = [];
  for (let capo = 0; capo <= 9; capo++) {
    const shapes = uniq.map((c) => {
      const name = nameFor(c.pc + n - capo) + c.suffix;
      return { name, easy: easy.has(name) };
    });
    options.push({ capo, shapes, score: shapes.filter((s) => s.easy).length / shapes.length });
  }
  const best = options.filter((o) => o.score > 0).sort((a, b) => b.score - a.score || a.capo - b.capo).slice(0, 4);
  $('#capoList').innerHTML = best.length ? best.map((o) => `
    <div class="capo-opt">
      <div class="capo-head"><b>${o.capo === 0 ? 'No capo' : `Capo on fret ${o.capo}`}</b>
        <span class="capo-score"><i style="width:${Math.round(o.score * 100)}%"></i></span>
        <span class="sub small">${Math.round(o.score * 100)}% open shapes</span></div>
      <div class="prog-chords">${o.shapes.map((s) => s.easy
        ? `<button class="pc easy" data-chord-link="${s.name}" title="See fingering">${pretty(s.name)}</button>`
        : `<span class="pc">${pretty(s.name)}</span>`).join('')}</div>
    </div>`).join('') + '<p class="sub small">Green shapes are beginner open chords. Tap one to see its fingering.</p>'
    : '<p class="sub">No easy capo position for these chords. Barre chords it is!</p>';
}
$('#tpInput').addEventListener('input', renderTranspose);
$('#tpSpell').addEventListener('change', renderTranspose);
$('#tpUp').addEventListener('click', () => { tp.shift = tp.shift >= 11 ? -11 : tp.shift + 1; renderTranspose(); });
$('#tpDown').addEventListener('click', () => { tp.shift = tp.shift <= -11 ? 11 : tp.shift - 1; renderTranspose(); });
$('#capoList').addEventListener('click', (e) => { const l = e.target.closest('[data-chord-link]'); if (l) openInChordLibrary(l.dataset.chordLink); });

/* =========================================================
   Lessons
   ========================================================= */
const LESSONS = [
  {
    t: 'Notes and frets', m: 3, h: `
    <p>Music uses only <b>12 notes</b>. After the 12th, the pattern starts again, one octave higher:</p>
    <p class="note-line">A · A♯/B♭ · B · C · C♯/D♭ · D · D♯/E♭ · E · F · F♯/G♭ · G · G♯/A♭ · <b>A</b></p>
    <p>On the guitar, <b>each fret is one step in that list</b>, called a <em>half step</em>. Two frets is a <em>whole step</em>.</p>
    <div class="callout">⚠️ There's no sharp between <b>B–C</b> and <b>E–F</b>. Those pairs are only one fret apart.</div>
    <div class="try-row">
      <button class="try" data-seq="45 46 47 48 49 50 51 52 53 54 55 56 57">▶ All 12 notes up the A string</button>
      <button class="try" data-seq="52 53">▶ Half step: E → F</button>
      <button class="try" data-seq="53 55">▶ Whole step: F → G</button>
    </div>
    <p><b>Practise:</b> on the Notes tab, highlight <b>C</b> and find every C on the neck.</p>
    <button class="btn" data-tab="notes">Open the fretboard →</button>` },
  {
    t: 'Intervals: the distance between notes', m: 4, h: `
    <p>An <b>interval</b> is the distance between two notes. Every melody, scale and chord is made of intervals, so they're the building blocks of everything else.</p>
    <table class="mini-table">
      <tr><th>Interval</th><th>Frets</th><th>Sound</th><th></th></tr>
      <tr><td>Minor 3rd</td><td>3</td><td>sad</td><td><button class="try sm" data-seq="48 51">▶</button></td></tr>
      <tr><td>Major 3rd</td><td>4</td><td>happy</td><td><button class="try sm" data-seq="48 52">▶</button></td></tr>
      <tr><td>Perfect 4th</td><td>5</td><td>open</td><td><button class="try sm" data-seq="48 53">▶</button></td></tr>
      <tr><td>Perfect 5th</td><td>7</td><td>strong</td><td><button class="try sm" data-seq="48 55">▶</button></td></tr>
      <tr><td>Octave</td><td>12</td><td>same note</td><td><button class="try sm" data-seq="48 60">▶</button></td></tr>
    </table>
    <div class="callout">💡 Thirds decide whether something sounds <b>major (happy)</b> or <b>minor (sad)</b>. You'll see this again with chords.</div>
    <button class="btn" data-tab="ear">Train your ear on intervals →</button>` },
  {
    t: 'How the major scale is built', m: 4, h: `
    <p>The major scale ("do re mi…") follows one pattern of whole (W) and half (H) steps:</p>
    <p class="pattern">W · W · H · W · W · W · H</p>
    <p>Start that pattern on <b>any</b> note and you get that note's major scale. On one string, C major is frets <b>3 · 5 · 7 · 8 · 10 · 12 · 14 · 15</b> on the A string.</p>
    <div class="try-row">
      <button class="try" data-seq="48 50 52 53 55 57 59 60">▶ C major</button>
      <button class="try" data-seq="43 45 47 48 50 52 54 55">▶ G major (same pattern)</button>
    </div>
    <div class="callout">💡 G major needs an F♯ so the pattern keeps its half step in the right place. That's where key signatures come from.</div>
    <button class="btn" data-go="keys">See every major scale in Key explorer →</button>` },
  {
    t: 'How chords are built', m: 4, h: `
    <p>A basic chord (a <b>triad</b>) is three notes: the <b>1st, 3rd and 5th</b> notes of a scale. Skip a note, take a note.</p>
    <ul>
      <li><b>Major</b> = 1 · 3 · 5 → C E G</li>
      <li><b>Minor</b> = 1 · ♭3 · 5 → C E♭ G (the 3rd is one fret lower)</li>
      <li><b>Diminished</b> = 1 · ♭3 · ♭5 &nbsp; <b>Augmented</b> = 1 · 3 · ♯5</li>
    </ul>
    <div class="try-row">
      <button class="try" data-strum="48 52 55 60 64">▶ C major</button>
      <button class="try" data-strum="48 51 55 60 63">▶ C minor</button>
      <button class="try" data-strum="48 51 54 60">▶ C dim</button>
      <button class="try" data-strum="48 52 56 60">▶ C aug</button>
    </div>
    <p>Add the 7th note and you get <b>7th chords</b>: C E G B = Cmaj7, C E G B♭ = C7.</p>
    <div class="try-row"><button class="try" data-strum="48 52 55 59 64">▶ Cmaj7</button><button class="try" data-strum="48 52 55 58 64">▶ C7</button></div>
    <button class="btn" data-go="finder">Experiment in Chord finder →</button>` },
  {
    t: 'Chords in a key and Roman numerals', m: 5, h: `
    <p>Build a triad on each note of the major scale and you get the <b>7 chords of the key</b>. Musicians number them with Roman numerals, UPPERCASE for major and lowercase for minor:</p>
    <p class="pattern">I · ii · iii · IV · V · vi · vii°</p>
    <p>In C major that's <b>C · Dm · Em · F · G · Am · B°</b>. In G major: <b>G · Am · Bm · C · D · Em · F♯°</b>. The pattern is the same in every key.</p>
    <div class="try-row">
      <button class="try" data-prog="48 52 55 60|53 57 60 65|55 59 62 67|48 52 55 60">▶ I – IV – V – I in C</button>
      <button class="try" data-prog="48 52 55 60|55 59 62 67|45 52 57 60|53 57 60 65">▶ I – V – vi – IV in C</button>
    </div>
    <div class="callout">💡 Learn songs as numbers ("1-5-6-4") and you can play them in any key.</div>
    <button class="btn" data-go="keys">Try other keys →</button>` },
  {
    t: 'The circle of fifths', m: 4, h: `
    <p>Put the 12 keys in a circle where each step clockwise is a <b>perfect 5th</b> up (7 frets). Then:</p>
    <ul>
      <li>Each step clockwise adds <b>one sharp</b>: C (0) → G (1♯) → D (2♯) → A (3♯)…</li>
      <li>Each step counter-clockwise adds <b>one flat</b>: C → F (1♭) → B♭ (2♭)…</li>
      <li>Any key's <b>I, IV and V</b> chords sit side by side, with their relative minors (vi, ii, iii) just inside.</li>
    </ul>
    <div class="callout">💡 It's a map of which chords and keys belong together. Use it to work out a song's chords or to write your own.</div>
    <button class="btn" data-go="circle">Open the circle of fifths →</button>` },
  {
    t: 'Minor keys and the relative minor', m: 3, h: `
    <p>Every major key has a <b>relative minor</b> that uses exactly the same notes but starts on the 6th note. A minor is C major starting from A:</p>
    <div class="try-row">
      <button class="try" data-seq="48 50 52 53 55 57 59 60">▶ C major (happy)</button>
      <button class="try" data-seq="45 47 48 50 52 53 55 57">▶ A minor (sad)</button>
    </div>
    <p>The minor scale has a <b>♭3, ♭6 and ♭7</b> compared with the major scale. That's what makes it sound darker.</p>
    <div class="callout">💡 Shortcut: the relative minor is <b>3 frets below</b> the major root. G → E minor, D → B minor.</div>` },
  {
    t: 'Pentatonic and blues: start soloing', m: 5, h: `
    <p>The <b>minor pentatonic</b> scale has 5 notes (1 · ♭3 · 4 · 5 · ♭7). It's used in nearly every rock and blues solo. Here's the classic "box" for <b>A minor</b> at fret 5:</p>
    <table class="mini-table tab">
      <tr><td>e</td><td>5</td><td>8</td></tr><tr><td>B</td><td>5</td><td>8</td></tr><tr><td>G</td><td>5</td><td>7</td></tr>
      <tr><td>D</td><td>5</td><td>7</td></tr><tr><td>A</td><td>5</td><td>7</td></tr><tr><td>E</td><td>5</td><td>8</td></tr>
    </table>
    <div class="try-row">
      <button class="try" data-seq="45 48 50 52 55 57 60 62 64 67 69 72">▶ A minor pentatonic</button>
      <button class="try" data-seq="45 48 50 51 52 55 57 60 62 63 64 67">▶ A blues (adds the ♭5)</button>
    </div>
    <div class="callout">💡 Slide the same box to any fret to change key. At fret 3 it's G minor, at fret 8 it's C minor.</div>
    <button class="btn" data-go="keys">See it on the full fretboard →</button>` },
  {
    t: 'Modes in plain English', m: 5, h: `
    <p>A <b>mode</b> uses the 7 notes of a major scale but treats a different note as "home". Same notes, different mood:</p>
    <ul>
      <li><b>Dorian</b>: minor with a brighter 6th. Soulful and funky.</li>
      <li><b>Mixolydian</b>: major with a ♭7. Bluesy rock.</li>
      <li><b>Lydian</b>: major with a ♯4. Dreamy.</li>
      <li><b>Phrygian</b>: minor with a ♭2. Spanish and dark.</li>
    </ul>
    <div class="try-row">
      <button class="try" data-seq="50 52 53 55 57 59 60 62">▶ D Dorian</button>
      <button class="try" data-seq="43 45 47 48 50 52 53 55">▶ G Mixolydian</button>
      <button class="try" data-seq="53 55 57 59 60 62 64 65">▶ F Lydian</button>
    </div>
    <div class="callout">💡 To hear a mode properly, play its root note over and over as a drone and improvise on top.</div>
    <button class="btn" data-go="keys">Compare all modes →</button>` },
  {
    t: 'Rhythm, beats and time signatures', m: 4, h: `
    <p>Music is organised into <b>beats</b>, grouped into <b>bars</b>. The time signature tells you how many beats are in a bar:</p>
    <ul>
      <li><b>4/4</b>: count 1-2-3-4. Most pop and rock.</li>
      <li><b>3/4</b>: count 1-2-3. Waltzes and many folk songs.</li>
      <li><b>6/8</b>: 1-2-3-4-5-6 with a lilting, swaying feel.</li>
    </ul>
    <p>A great all-purpose strum in 4/4: <b>Down, Down-Up, Up-Down-Up</b> (D · DU · UDU). Keep your hand moving down and up in eighth notes, even when you don't hit the strings.</p>
    <div class="callout">💡 Practise new things at a tempo where you make <b>no mistakes</b>, then raise it 5 BPM at a time. The metronome's speed trainer does this for you.</div>
    <button class="btn" data-tab="metronome">Open the metronome →</button>` },
  {
    t: 'Capos and transposing', m: 3, h: `
    <p>A <b>capo</b> clamps across all strings and raises everything. With a capo on fret 2, a G <em>shape</em> sounds like an <b>A</b> chord.</p>
    <p><b>Transposing</b> means moving a whole song up or down. Shift every chord by the same number of half steps and the song keeps its sound, just higher or lower. That's handy for fitting a song to your voice.</p>
    <div class="try-row">
      <button class="try" data-prog="43 47 50 55 59 67|45 49 52 57 61 69">▶ G, then G shape with capo 2 (= A)</button>
    </div>
    <div class="callout">💡 Can't play a song with barre chords? Find a capo position that turns them into easy open shapes.</div>
    <button class="btn" data-go="transpose">Try the transpose &amp; capo tool →</button>` },
];

const lessonState = { cur: store.get('lessonCur', 0), done: new Set(store.get('lessonsDone', [])) };

function renderLessons() {
  const i = lessonState.cur, L = LESSONS[i];
  const pct = Math.round((lessonState.done.size / LESSONS.length) * 100);
  $('#lpFill').style.width = pct + '%';
  $('#lpText').textContent = `${lessonState.done.size} of ${LESSONS.length} lessons complete`;
  $('#lessonList').innerHTML = LESSONS.map((l, j) =>
    `<li><button class="${j === i ? 'on' : ''} ${lessonState.done.has(j) ? 'done' : ''}" data-l="${j}">
      <span class="ln">${lessonState.done.has(j) ? '✓' : j + 1}</span><span class="lt">${l.t}</span><span class="lm">${l.m} min</span></button></li>`).join('');
  $('#lessonBody').innerHTML = `
    <div class="lesson-meta">Lesson ${i + 1} of ${LESSONS.length} · ${L.m} min read</div>
    <h2 class="lesson-title">${L.t}</h2>
    <div class="lesson-text">${L.h}</div>
    <div class="lesson-foot">
      <button class="btn" id="lessonPrev" ${i === 0 ? 'disabled' : ''}>← Previous</button>
      <button class="btn primary" id="lessonNext">${lessonState.done.has(i) && i === LESSONS.length - 1 ? 'Course complete 🎉' : i === LESSONS.length - 1 ? 'Finish course ✓' : 'Got it, next →'}</button>
    </div>`;
}
function openLesson(j) {
  lessonState.cur = Math.max(0, Math.min(LESSONS.length - 1, j));
  store.set('lessonCur', lessonState.cur);
  renderLessons();
  if (mqVertical.matches) $('#lessonBody').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

let progTimer = null;
$('#lessonBody').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.id === 'lessonPrev') { openLesson(lessonState.cur - 1); return; }
  if (b.id === 'lessonNext') {
    lessonState.done.add(lessonState.cur);
    store.set('lessonsDone', [...lessonState.done]);
    if (lessonState.cur < LESSONS.length - 1) openLesson(lessonState.cur + 1); else renderLessons();
    return;
  }
  if (b.dataset.seq) {
    Sound.init();
    const t = Sound.ctx.currentTime + 0.03;
    nums(b.dataset.seq).forEach((m, k) => Sound.pluck(m, t + k * 0.32, 0.5));
  } else if (b.dataset.strum) {
    Sound.strum(nums(b.dataset.strum));
  } else if (b.dataset.prog) {
    clearTimeout(progTimer);
    const chords = b.dataset.prog.split('|').map(nums);
    let k = 0;
    const step = () => { if (k < chords.length) { Sound.strum(chords[k++]); progTimer = setTimeout(step, 1100); } };
    step();
  } else if (b.dataset.go) {
    goSub(b.dataset.go);
  } else if (b.dataset.tab) {
    showTab(b.dataset.tab);
  }
});
$('#lessonList').addEventListener('click', (e) => { const b = e.target.closest('[data-l]'); if (b) openLesson(+b.dataset.l); });

/* =========================================================
   Init
   ========================================================= */
renderLessons();
renderFinder();
renderTranspose();
showSub(currentSub);
mqVertical.addEventListener('change', () => { renderTheory(); renderFinder(); });
