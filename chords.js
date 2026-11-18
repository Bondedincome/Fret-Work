// Chord library.
// f  = frets per string, low E -> high e. "x" = muted, "0" = open.
// fg = finger per string (1 index, 2 middle, 3 ring, 4 pinky), "x"/"0" = none.
// b  = barre [fret, fromString, toString, finger=1]  (string index 0 = low E)
// base = first fret shown in the diagram (defaults to 1)
const CHORD_CATEGORIES = [
  { id: 'all',   label: 'All' },
  { id: 'major', label: 'Major' },
  { id: 'minor', label: 'Minor' },
  { id: 'dom7',  label: '7th' },
  { id: 'maj7',  label: 'Maj 7' },
  { id: 'm7',    label: 'Minor 7' },
  { id: 'sus',   label: 'Sus & Add' },
  { id: 'power', label: 'Power' },
];

const CHORDS = [
  // Major
  { n: 'C',  full: 'C major',  cat: 'major', f: 'x32010', fg: 'x32010' },
  { n: 'D',  full: 'D major',  cat: 'major', f: 'xx0232', fg: 'xx0132' },
  { n: 'E',  full: 'E major',  cat: 'major', f: '022100', fg: '023100' },
  { n: 'F',  full: 'F major',  cat: 'major', f: '133211', fg: '134211', b: [1, 0, 5] },
  { n: 'G',  full: 'G major',  cat: 'major', f: '320003', fg: '210003' },
  { n: 'A',  full: 'A major',  cat: 'major', f: 'x02220', fg: 'x01230' },
  { n: 'B',  full: 'B major',  cat: 'major', f: 'x24442', fg: 'x12341', b: [2, 1, 5] },
  { n: 'Bb', full: 'B♭ major', cat: 'major', f: 'x13331', fg: 'x12341', b: [1, 1, 5], flats: true },

  // Minor
  { n: 'Am',  full: 'A minor',  cat: 'minor', f: 'x02210', fg: 'x02310' },
  { n: 'Dm',  full: 'D minor',  cat: 'minor', f: 'xx0231', fg: 'xx0231' },
  { n: 'Em',  full: 'E minor',  cat: 'minor', f: '022000', fg: '023000' },
  { n: 'Bm',  full: 'B minor',  cat: 'minor', f: 'x24432', fg: 'x13421', b: [2, 1, 5] },
  { n: 'F#m', full: 'F♯ minor', cat: 'minor', f: '244222', fg: '134111', b: [2, 0, 5] },
  { n: 'Fm',  full: 'F minor',  cat: 'minor', f: '133111', fg: '134111', b: [1, 0, 5], flats: true },
  { n: 'Cm',  full: 'C minor',  cat: 'minor', f: 'x35543', fg: 'x13421', b: [3, 1, 5], base: 3, flats: true },
  { n: 'Gm',  full: 'G minor',  cat: 'minor', f: '355333', fg: '134111', b: [3, 0, 5], base: 3, flats: true },

  // Dominant 7th
  { n: 'A7', full: 'A dominant 7th', cat: 'dom7', f: 'x02020', fg: 'x02030' },
  { n: 'B7', full: 'B dominant 7th', cat: 'dom7', f: 'x21202', fg: 'x21304' },
  { n: 'C7', full: 'C dominant 7th', cat: 'dom7', f: 'x32310', fg: 'x32410', flats: true },
  { n: 'D7', full: 'D dominant 7th', cat: 'dom7', f: 'xx0212', fg: 'xx0213' },
  { n: 'E7', full: 'E dominant 7th', cat: 'dom7', f: '020100', fg: '020100' },
  { n: 'G7', full: 'G dominant 7th', cat: 'dom7', f: '320001', fg: '320001' },

  // Major 7th
  { n: 'Cmaj7', full: 'C major 7th', cat: 'maj7', f: 'x32000', fg: 'x32000' },
  { n: 'Dmaj7', full: 'D major 7th', cat: 'maj7', f: 'xx0222', fg: 'xx0123' },
  { n: 'Emaj7', full: 'E major 7th', cat: 'maj7', f: '021100', fg: '031200' },
  { n: 'Fmaj7', full: 'F major 7th', cat: 'maj7', f: 'xx3210', fg: 'xx3210' },
  { n: 'Gmaj7', full: 'G major 7th', cat: 'maj7', f: '320002', fg: '320001' },
  { n: 'Amaj7', full: 'A major 7th', cat: 'maj7', f: 'x02120', fg: 'x02130' },

  // Minor 7th
  { n: 'Am7', full: 'A minor 7th', cat: 'm7', f: 'x02010', fg: 'x02010' },
  { n: 'Dm7', full: 'D minor 7th', cat: 'm7', f: 'xx0211', fg: 'xx0211', b: [1, 4, 5] },
  { n: 'Em7', full: 'E minor 7th', cat: 'm7', f: '022030', fg: '012030' },
  { n: 'Bm7', full: 'B minor 7th', cat: 'm7', f: 'x20202', fg: 'x10203' },

  // Sus & add
  { n: 'Dsus2', full: 'D suspended 2nd', cat: 'sus', f: 'xx0230', fg: 'xx0130' },
  { n: 'Dsus4', full: 'D suspended 4th', cat: 'sus', f: 'xx0233', fg: 'xx0123' },
  { n: 'Asus2', full: 'A suspended 2nd', cat: 'sus', f: 'x02200', fg: 'x01200' },
  { n: 'Asus4', full: 'A suspended 4th', cat: 'sus', f: 'x02230', fg: 'x01230' },
  { n: 'Esus4', full: 'E suspended 4th', cat: 'sus', f: '022200', fg: '023400' },
  { n: 'Cadd9', full: 'C add 9',         cat: 'sus', f: 'x32033', fg: 'x21034' },

  // Power chords
  { n: 'E5', full: 'E power chord', cat: 'power', f: '022xxx', fg: '012xxx' },
  { n: 'A5', full: 'A power chord', cat: 'power', f: 'x022xx', fg: 'x012xx' },
  { n: 'D5', full: 'D power chord', cat: 'power', f: 'xx023x', fg: 'xx012x' },
  { n: 'G5', full: 'G power chord', cat: 'power', f: '355xxx', fg: '134xxx', base: 3 },
].map((c) => {
  const parse = (s) => [...s].map((ch) => (ch === 'x' ? -1 : Number(ch)));
  return {
    name: c.n,
    full: c.full,
    cat: c.cat,
    frets: parse(c.f),
    fingers: parse(c.fg),
    barre: c.b ? { fret: c.b[0], from: c.b[1], to: c.b[2], finger: c.b[3] || 1 } : null,
    base: c.base || 1,
    flats: !!c.flats,
  };
});
