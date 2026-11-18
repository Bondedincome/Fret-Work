'use strict';
/* Live coach v2
   ─────────────
   Hand tracking : MediaPipe Hand Landmarker (21 joints per hand), run on a crop around the neck
                   so small/far hands are detected reliably. Landmarks are smoothed with a One-Euro filter.
   Neck tracking : OpenCV.js. After calibration, corner features on the neck are followed with
                   pyramidal Lucas-Kanade optical flow (forward-backward checked) and a RANSAC
                   homography keeps the 4 calibration corners glued to the moving guitar.
                   If tracking is lost, ORB feature matching against the calibration frame re-finds the neck.
   Neck space    : u = across strings (0 low E … 1 high e), v = along the neck (0 nut … 1 fret-5 wire).
   Scoring       : finger *pad* (not tip) position, tolerance bands + 8-frame voting with hysteresis.
   Uses Sound, store, $, $$, CHORDS, CHORD_CATEGORIES, chordSVG, chordMidis, pretty, STRING_NAMES,
   showTab, currentTab from app.js. */

const MP_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const CV_URL = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js';
const TIP = { 1: 8, 2: 12, 3: 16, 4: 20 };
const DIP = { 1: 7, 2: 11, 3: 15, 4: 19 };
const FINGER_WORD = { 1: 'Index', 2: 'Middle', 3: 'Ring', 4: 'Pinky' };
const HAND_LINKS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
const CAL_STEPS = [
  'Where the <b>thickest string</b> (low E) meets the <b>nut</b>',
  'Where the <b>thinnest string</b> (high e) meets the <b>nut</b>',
  'The <b>thickest string</b> on the <b>5th fret wire</b>',
  'The <b>thinnest string</b> on the <b>5th fret wire</b>',
];
const CORNER_NAMES = ['Nut · E', 'Nut · e', '5th · E', '5th · e'];
const STRICTNESS = {
  relaxed: { str: 0.7, behind: 0.45, over: 0.25, on: 5, off: 3 },
  normal: { str: 0.55, behind: 0.3, over: 0.15, on: 6, off: 4 },
  strict: { str: 0.42, behind: 0.2, over: 0.08, on: 7, off: 5 },
};
const COL = { target: '#2ec4b6', good: '#40c057', bad: '#ff6b8b', warn: '#ffb84d', grid: 'rgba(255,255,255,.55)', text: '#fff' };
const PW = 480;                                   // OpenCV processing width (px)

const live = {
  video: $('#liveVideo'), canvas: $('#liveCanvas'), stream: null, landmarker: null, loading: false,
  running: false, mirror: store.get('liveMirror', true), facing: 'user',
  base: store.get('liveCalib', null), calib: null, H: null, Hinv: null,
  calibrating: false, calibPts: [], frozen: null, adjust: false, drag: -1, pointer: null, aiming: false,
  follow: store.get('liveFollow', true), strict: store.get('liveStrict', 'normal'),
  chord: store.get('liveChord', 'C'), hands: [], fret: null, evals: [], votes: {}, okState: {}, filters: {}, lastFretSeen: 0,
  goodSince: 0, shownAt: performance.now(), done: false, clean: store.get('liveClean', 0), best: store.get('liveBest', null),
  lastVideoTime: -1, lastUi: 0, flashUntil: 0, handMissing: 0, roi: null, fps: 0, fpsN: 0, fpsT: performance.now(),
};
live.calib = live.base ? live.base.map((p) => p.slice()) : null;
const ctx = live.canvas.getContext('2d');

/* =========================================================
   Geometry
   ========================================================= */
const fretPos = (n) => (1 - 2 ** (-n / 12)) / (1 - 2 ** (-5 / 12));
function fretOf(v) {
  if (v < 0) return 0;
  for (let n = 1; n <= 15; n++) if (v <= fretPos(n)) return n;
  return 15;
}
// Heckbert: unit square (0,0),(1,0),(1,1),(0,1) → quad p0,p1,p2,p3
function squareToQuad([[x0, y0], [x1, y1], [x2, y2], [x3, y3]]) {
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let g = 0, h = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
  }
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
}
function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((x) => x / det);
}
const apply = (M, x, y) => { const w = M[6] * x + M[7] * y + M[8]; return [(M[0] * x + M[1] * y + M[2]) / w, (M[3] * x + M[4] * y + M[5]) / w]; };
const cyc = (q) => [q[0], q[1], q[3], q[2]];      // calib order → around-the-quad order

function computeH() {
  if (!live.calib) { live.H = live.Hinv = null; return; }
  const [nutLow, nutHigh, f5Low, f5High] = live.calib;
  live.H = squareToQuad([nutLow, nutHigh, f5High, f5Low]);
  live.Hinv = inv3(live.H);
}
const toUV = (x, y) => apply(live.Hinv, x, y);
const fromUV = (u, v) => apply(live.H, u, v);

/* =========================================================
   One-Euro filter (smooth when still, responsive when moving)
   ========================================================= */
class OneEuro {
  constructor(minCutoff = 1.6, beta = 8, dCutoff = 1) { Object.assign(this, { minCutoff, beta, dCutoff, x: null, dx: 0, t: null }); }
  static a(cut, dt) { const tau = 1 / (2 * Math.PI * cut); return 1 / (1 + tau / dt); }
  filter(x, t) {
    if (this.t === null) { this.t = t; this.x = x; return x; }
    const dt = Math.max(1e-3, (t - this.t) / 1000);
    this.t = t;
    const d = (x - this.x) / dt;
    this.dx += OneEuro.a(this.dCutoff, dt) * (d - this.dx);
    const cut = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.a(cut, dt) * (x - this.x);
    return this.x;
  }
}

/* =========================================================
   Chord targets & scoring
   ========================================================= */
const currentChord = () => CHORDS.find((c) => c.name === live.chord) || CHORDS[0];
function chordTargets(ch) {
  const out = [];
  let barreDone = false;
  ch.frets.forEach((f, s) => {
    if (f <= 0) return;
    const fg = ch.fingers[s];
    if (ch.barre && fg === ch.barre.finger && f === ch.barre.fret) {
      if (!barreDone) { barreDone = true; out.push({ finger: fg, string: ch.barre.from, to: ch.barre.to, fret: f, barre: true }); }
    } else out.push({ finger: fg, string: s, fret: f });
  });
  return out;
}
const targetUV = (t) => [t.string / 5, fretPos(t.fret - 1) + 0.62 * (fretPos(t.fret) - fretPos(t.fret - 1))];

function evaluate(hand) {
  const S = STRICTNESS[live.strict];
  return chordTargets(currentChord()).map((t) => {
    const tp = hand[TIP[t.finger]], dp = hand[DIP[t.finger]];
    const contact = { x: dp.x + 0.72 * (tp.x - dp.x), y: dp.y + 0.72 * (tp.y - dp.y) };   // the pad, not the nail
    const [u, v] = toUV(contact.x, contact.y);
    const sc = u * 5;
    const ds = Math.round(Math.min(5, Math.max(0, sc)));
    const df = fretOf(v);
    const w0 = fretPos(t.fret - 1), w1 = fretPos(t.fret), w = w1 - w0;
    const fretNow = v >= w0 - S.behind * w && v <= w1 + S.over * w;
    const strNow = t.barre ? true : Math.abs(sc - t.string) <= S.str;
    const hist = live.votes[t.finger] || (live.votes[t.finger] = []);
    hist.push(fretNow && strNow);
    if (hist.length > 8) hist.shift();
    const n = hist.filter(Boolean).length;
    const ok = live.okState[t.finger] ? n >= S.off : n >= S.on;
    live.okState[t.finger] = ok;
    const parts = [];
    if (!fretNow) {
      const d = Math.max(1, Math.abs(t.fret - df));
      parts.push(`${d} fret${d > 1 ? 's' : ''} ${v < w0 ? 'toward the body' : 'toward the headstock'}`);
    }
    if (!strNow) {
      const d = Math.max(1, Math.round(Math.abs(t.string - sc)));
      parts.push(`${d} string${d > 1 ? 's' : ''} ${sc < t.string ? 'toward the thin strings' : 'toward the thick strings'}`);
    }
    return { ...t, ok, hint: ok ? '' : parts.length ? 'Move ' + parts.join(' and ') : 'Nearly there. Hold it steady.', contact, ds, df };
  });
}

/* =========================================================
   Hand detection (MediaPipe) with region-of-interest crop
   ========================================================= */
const roiCanvas = document.createElement('canvas');
const roiCtx = roiCanvas.getContext('2d');

function computeRoi() {
  if (!live.H) return null;
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  [-0.8, 1.8].forEach((u) => [-0.5, 2.1].forEach((v) => { const [x, y] = fromUV(u, v); add(x, y); }));
  if (live.fret) live.fret.forEach((p) => add(p.x, p.y));
  let w = x1 - x0, h = y1 - y0;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  w = Math.max(w * 1.1, 0.4); h = Math.max(h * 1.1, 0.4);
  if (w >= 0.95 && h >= 0.95) return null;           // crop would be the whole frame anyway
  const x = Math.min(Math.max(cx - w / 2, 0), Math.max(0, 1 - w));
  const y = Math.min(Math.max(cy - h / 2, 0), Math.max(0, 1 - h));
  return { x, y, w: Math.min(w, 1), h: Math.min(h, 1) };
}

function detectHands(now) {
  const v = live.video, VW = v.videoWidth, VH = v.videoHeight;
  const roi = live.handMissing > 12 ? null : computeRoi();   // fall back to full frame when the hand is lost
  live.roi = roi;
  let res;
  try {
    if (roi) {
      const sw = roi.w * VW, sh = roi.h * VH, k = 720 / Math.max(sw, sh);
      roiCanvas.width = Math.round(sw * k); roiCanvas.height = Math.round(sh * k);
      roiCtx.drawImage(v, roi.x * VW, roi.y * VH, sw, sh, 0, 0, roiCanvas.width, roiCanvas.height);
      res = live.landmarker.detectForVideo(roiCanvas, now);
    } else res = live.landmarker.detectForVideo(v, now);
  } catch { return []; }
  const hands = (res.landmarks || []).map((h) => (roi ? h.map((p) => ({ x: roi.x + p.x * roi.w, y: roi.y + p.y * roi.h, z: p.z })) : h));
  live.handMissing = hands.length ? 0 : live.handMissing > 24 ? 0 : live.handMissing + 1;
  return hands;
}

function pickFrettingHand(hands) {
  if (!hands.length) return null;
  let best = null, bestScore = Infinity;
  hands.forEach((h) => {
    let score = 0;
    if (live.Hinv) {
      let su = 0, sv = 0;
      [8, 12, 16, 20].forEach((j) => { const [u, v] = toUV(h[j].x, h[j].y); su += u / 4; sv += v / 4; });
      score = Math.hypot(Math.max(0, Math.abs(su - 0.5) - 0.7), Math.max(0, Math.abs(sv - 0.9) - 1.4));
    }
    if (live.fret) score += 0.3 * Math.hypot(h[0].x - live.fret[0].x, h[0].y - live.fret[0].y);
    if (score < bestScore) { bestScore = score; best = h; }
  });
  return live.Hinv && bestScore > 0.7 ? null : best;
}

function smoothHand(h, now) {
  if (now - live.lastFretSeen > 400) live.filters = {};
  live.lastFretSeen = now;
  return h.map((p, j) => {
    const f = live.filters[j] || (live.filters[j] = [new OneEuro(), new OneEuro()]);
    return { x: f[0].filter(p.x, now), y: f[1].filter(p.y, now), z: p.z };
  });
}

/* =========================================================
   Neck tracking (OpenCV.js): LK optical flow + RANSAC homography, ORB re-localisation
   ========================================================= */
const NT = {
  ready: false, loading: false, prev: null, pts: [], ref: [], anchor: null, H: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  keyDesc: null, keyPts: [], orb: null, matcher: null, state: 'off', lostFrames: 0, frame: 0, PH: 270, inliers: 0,
};
const procCanvas = document.createElement('canvas');
const procCtx = procCanvas.getContext('2d', { willReadFrequently: true });

function grabGray(src) {
  const sw = src.videoWidth || src.width, sh = src.videoHeight || src.height;
  const ph = Math.round((PW * sh) / sw);
  if (procCanvas.width !== PW || procCanvas.height !== ph) { procCanvas.width = PW; procCanvas.height = ph; }
  NT.PH = ph;
  procCtx.drawImage(src, 0, 0, PW, ph);
  const rgba = cv.imread(procCanvas);
  const g = new cv.Mat();
  cv.cvtColor(rgba, g, cv.COLOR_RGBA2GRAY);
  rgba.delete();
  return g;
}
const toPx = ([x, y]) => [x * PW, y * NT.PH];

function neckMask(excludeExisting) {
  const m = cv.Mat.zeros(NT.PH, PW, cv.CV_8UC1);
  // Fretboard only (just outside the outer strings, from the nut to ~fret 9): no background, no headstock edge.
  const poly = [[-0.05, -0.12], [1.05, -0.12], [1.05, 1.7], [-0.05, 1.7]].map(([u, v]) => toPx(fromUV(u, v)));
  const pm = cv.matFromArray(4, 1, cv.CV_32SC2, poly.flat().map(Math.round));
  const vec = new cv.MatVector();
  vec.push_back(pm);
  cv.fillPoly(m, vec, new cv.Scalar(255));
  vec.delete(); pm.delete();
  const r = Math.round(PW * 0.028);
  live.hands.forEach((h) => h.forEach((p) => cv.circle(m, new cv.Point(Math.round(p.x * PW), Math.round(p.y * NT.PH)), r, new cv.Scalar(0), -1)));
  if (excludeExisting) NT.pts.forEach((p) => cv.circle(m, new cv.Point(Math.round(p[0]), Math.round(p[1])), 6, new cv.Scalar(0), -1));
  return m;
}

function detectFeatures(gray, max, excludeExisting) {
  if (max <= 0) return [];
  const mask = neckMask(excludeExisting);
  const c = new cv.Mat();
  cv.goodFeaturesToTrack(gray, c, max, 0.008, 6, mask, 5);
  mask.delete();
  const out = [];
  for (let i = 0; i < c.rows; i++) out.push([c.data32F[i * 2], c.data32F[i * 2 + 1]]);
  c.delete();
  return out;
}

function homographyFrom(src, dst, thresh) {
  if (src.length < 8) return null;
  const s = cv.matFromArray(src.length, 1, cv.CV_32FC2, src.flat());
  const d = cv.matFromArray(dst.length, 1, cv.CV_32FC2, dst.flat());
  const mask = new cv.Mat();
  const H = cv.findHomography(s, d, cv.RANSAC, thresh, mask);
  let res = null;
  if (!H.empty()) {
    const h = Array.from(H.data64F);
    const inliers = [];
    for (let i = 0; i < src.length; i++) if (mask.data[i]) inliers.push(i);
    res = { H: h.map((x) => x / h[8]), inliers };
  }
  s.delete(); d.delete(); mask.delete(); H.delete();
  return res;
}

function saneH(H) {
  const q = cyc(NT.anchor.map((p) => apply(H, p[0], p[1])));
  const area = (pts) => pts.reduce((a, p, i) => { const n = pts[(i + 1) % 4]; return a + p[0] * n[1] - n[0] * p[1]; }, 0) / 2;
  const r = area(q) / area(cyc(NT.anchor));
  if (!(r > 0.3 && r < 3.5)) return false;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const sgn = Math.sign(cr);
    if (!sgn || (sign && sgn !== sign)) return false;
    sign = sgn;
  }
  return true;
}

function setCalibFromH() {
  live.calib = NT.anchor.map((p) => { const [x, y] = apply(NT.H, p[0], p[1]); return [x / PW, y / NT.PH]; });
  computeH();
}

function anchorTracker(gray) {
  if (!NT.ready || !live.calib) return;
  NT.anchor = live.calib.map(toPx);
  NT.H = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  NT.pts = []; NT.ref = [];
  const f = detectFeatures(gray, 160, false);
  NT.pts = f; NT.ref = f.map((p) => p.slice());
  if (NT.keyDesc) { NT.keyDesc.delete(); NT.keyDesc = null; }
  const mask = neckMask(false), kp = new cv.KeyPointVector(), desc = new cv.Mat();
  NT.orb.detectAndCompute(gray, mask, kp, desc);
  NT.keyPts = [];
  for (let i = 0; i < kp.size(); i++) { const p = kp.get(i).pt; NT.keyPts.push([p.x, p.y]); }
  NT.keyDesc = desc;
  kp.delete(); mask.delete();
  if (NT.prev) NT.prev.delete();
  NT.prev = gray.clone();
  NT.state = NT.pts.length >= 12 ? 'tracking' : 'weak';
  NT.lostFrames = 0; NT.inliers = NT.pts.length;
}

// ORB match against the calibration keyframe → absolute (drift-free) homography estimate.
function orbEstimate(gray) {
  if (!NT.keyDesc || NT.keyDesc.rows < 10) return null;
  const kp = new cv.KeyPointVector(), desc = new cv.Mat(), none = new cv.Mat();
  NT.orb.detectAndCompute(gray, none, kp, desc);
  const src = [], dst = [];
  if (desc.rows >= 10) {
    const mv = new cv.DMatchVectorVector();
    NT.matcher.knnMatch(NT.keyDesc, desc, mv, 2);
    for (let i = 0; i < mv.size(); i++) {
      const m = mv.get(i);
      if (m.size() >= 2) {
        const a = m.get(0), b = m.get(1);
        if (a.distance < 0.75 * b.distance) { const p = kp.get(a.trainIdx).pt; src.push(NT.keyPts[a.queryIdx]); dst.push([p.x, p.y]); }
      }
      m.delete();
    }
    mv.delete();
  }
  kp.delete(); desc.delete(); none.delete();
  const r = homographyFrom(src, dst, 4);
  return r && r.inliers.length >= 15 && saneH(r.H) ? r : null;
}

// Replace the tracked point set with fresh features under a trusted homography.
function reseed(gray, H) {
  NT.H = H;
  setCalibFromH();
  NT.pts = []; NT.ref = [];
  const Hi = inv3(NT.H);
  detectFeatures(gray, 140, false).forEach((p) => { NT.pts.push(p); NT.ref.push(apply(Hi, p[0], p[1])); });
  NT.state = 'tracking'; NT.lostFrames = 0; NT.inliers = NT.pts.length;
}

// Max corner disagreement (processing px) between two homographies.
const cornerDiff = (A, B) => Math.max(...NT.anchor.map(([x, y]) => { const a = apply(A, x, y), b = apply(B, x, y); return Math.hypot(a[0] - b[0], a[1] - b[1]); }));

function relocalize(gray) {
  const r = orbEstimate(gray);
  if (r) reseed(gray, r.H);
}

// Periodic drift / wrong-lock check: trust ORB when it strongly disagrees with optical flow.
function verify(gray) {
  const r = orbEstimate(gray);
  if (r && r.inliers.length >= 20 && cornerDiff(r.H, NT.H) > 10) reseed(gray, r.H);
}

function trackNeck(gray) {
  if (!NT.prev || !NT.anchor) return;
  NT.frame++;
  let ok = false;
  if (NT.pts.length >= 8) {
    const n = NT.pts.length;
    const p0 = cv.matFromArray(n, 1, cv.CV_32FC2, NT.pts.flat());
    const p1 = new cv.Mat(), st = new cv.Mat(), er = new cv.Mat(), pb = new cv.Mat(), st2 = new cv.Mat(), er2 = new cv.Mat();
    const win = new cv.Size(21, 21);
    const crit = new cv.TermCriteria(cv.TERM_CRITERIA_EPS | cv.TERM_CRITERIA_COUNT, 20, 0.03);
    cv.calcOpticalFlowPyrLK(NT.prev, gray, p0, p1, st, er, win, 3, crit);
    cv.calcOpticalFlowPyrLK(gray, NT.prev, p1, pb, st2, er2, win, 3, crit);
    const src = [], dst = [];
    for (let i = 0; i < n; i++) {
      if (!st.data[i] || !st2.data[i]) continue;
      const bx = pb.data32F[i * 2] - NT.pts[i][0], by = pb.data32F[i * 2 + 1] - NT.pts[i][1];
      if (bx * bx + by * by < 1.0) { src.push(NT.ref[i]); dst.push([p1.data32F[i * 2], p1.data32F[i * 2 + 1]]); }
    }
    [p0, p1, st, er, pb, st2, er2].forEach((m) => m.delete());
    const r = homographyFrom(src, dst, 3);
    if (r && r.inliers.length >= 10 && saneH(r.H)) {
      NT.H = r.H;
      NT.ref = r.inliers.map((i) => src[i]);
      NT.pts = r.inliers.map((i) => dst[i]);
      NT.inliers = r.inliers.length;
      ok = true;
    }
  }
  if (ok) {
    NT.state = 'tracking'; NT.lostFrames = 0;
    setCalibFromH();
    if (NT.frame % 12 === 0) verify(gray);
    if (NT.pts.length < 70 && NT.frame % 5 === 0) {
      const Hi = inv3(NT.H);
      detectFeatures(gray, 130 - NT.pts.length, true).forEach((p) => { NT.pts.push(p); NT.ref.push(apply(Hi, p[0], p[1])); });
    }
  } else {
    NT.lostFrames++;
    if (NT.lostFrames > 3) NT.state = 'lost';
    if (NT.state === 'lost' && NT.frame % 6 === 0) relocalize(gray);
  }
  NT.prev.delete();
  NT.prev = gray.clone();
}

function reanchorNow(src) {
  if (!NT.ready || !live.calib) return;
  const g = grabGray(src || live.video);
  try { anchorTracker(g); } catch (e) { console.warn('anchor failed', e); }
  g.delete();
}

async function loadOpenCV() {
  if (NT.ready || NT.loading) return;
  NT.loading = true;
  try {
    if (!window.cv) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = CV_URL; s.async = true; s.onload = res; s.onerror = () => rej(new Error('OpenCV download failed'));
        document.head.appendChild(s);
      });
    }
    const t0 = performance.now();
    while (!(window.cv && window.cv.Mat && window.cv.calcOpticalFlowPyrLK)) {
      if (window.cv instanceof Promise) window.cv = await window.cv;
      if (performance.now() - t0 > 40000) throw new Error('OpenCV init timeout');
      await new Promise((r) => setTimeout(r, 100));
    }
    NT.orb = new cv.ORB(600);
    NT.matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
    NT.ready = true;
    if (live.calib && live.running && !live.frozen) reanchorNow();
  } catch (err) {
    console.error(err);
    toast('⚠️ Neck tracking (OpenCV) didn\'t load, so the guides won\'t follow the guitar. Recalibrate if it moves.', 7000);
  } finally { NT.loading = false; }
}

/* =========================================================
   Drawing
   ========================================================= */
function draw(now) {
  const src = live.frozen || live.video, c = live.canvas;
  const VW = src.videoWidth || src.width, VH = src.videoHeight || src.height;
  if (c.width !== VW || c.height !== VH) { c.width = VW; c.height = VH; }
  const W = c.width, H = c.height, k = W / 640;
  const P = (x, y) => [(live.mirror ? 1 - x : x) * W, y * H];
  const PUV = (u, v) => { const [x, y] = fromUV(u, v); return P(x, y); };

  ctx.save();
  if (live.mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
  ctx.drawImage(src, 0, 0, W, H);
  ctx.restore();
  ctx.fillStyle = live.frozen ? 'rgba(0,0,0,.05)' : 'rgba(0,0,0,.12)';
  ctx.fillRect(0, 0, W, H);

  const line = (a, b, color, w, dash) => {
    ctx.beginPath(); ctx.setLineDash(dash || []); ctx.strokeStyle = color; ctx.lineWidth = w;
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]);
  };
  const dot = (p, r, fill, label, stroke) => {
    ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.lineWidth = 2.5 * k; ctx.strokeStyle = stroke; ctx.stroke(); }
    if (label) {
      ctx.fillStyle = COL.text; ctx.font = `800 ${Math.round(r * 1.05)}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, p[0], p[1] + 1);
    }
  };
  const text = (s, p, size, color, align = 'center') => {
    ctx.font = `700 ${size}px system-ui, sans-serif`; ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3 * k; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.strokeText(s, p[0], p[1]);
    ctx.fillStyle = color; ctx.fillText(s, p[0], p[1]);
  };

  // Calibration taps
  if (live.calibrating) {
    live.calibPts.forEach((p, i) => dot(P(p[0], p[1]), 8 * k, COL.target, String(i + 1), '#fff'));
    if (live.calibPts.length >= 2) line(P(...live.calibPts[0]), P(...live.calibPts[1]), COL.target, 2 * k);
    if (live.calibPts.length >= 3) line(P(...live.calibPts[0]), P(...live.calibPts[2]), COL.target, 2 * k, [5 * k, 4 * k]);
  }

  // Neck grid + chord targets
  if (live.H && !live.calibrating) {
    const lost = live.follow && NT.ready && NT.state === 'lost';
    const gridCol = lost ? 'rgba(255,184,77,.7)' : COL.grid;
    for (let s = 0; s < 6; s++) line(PUV(s / 5, -0.02), PUV(s / 5, fretPos(7)), gridCol, (2.2 - s * 0.25) * k, lost ? [8 * k, 6 * k] : null);
    for (let n = 0; n <= 7; n++) line(PUV(-0.04, fretPos(n)), PUV(1.04, fretPos(n)), n === 0 ? 'rgba(255,255,255,.9)' : gridCol, (n === 0 ? 4 : 1.5) * k);
    [3, 5, 7].forEach((n) => text(String(n), PUV(-0.17, (fretPos(n - 1) + fretPos(n)) / 2), 13 * k, '#fff'));
    const ch = currentChord();
    ch.frets.forEach((f, s) => {
      const p = PUV(s / 5, -0.22);
      if (f === -1) text('×', p, 18 * k, COL.bad);
      if (f === 0) { ctx.beginPath(); ctx.arc(p[0], p[1], 6 * k, 0, Math.PI * 2); ctx.lineWidth = 2.5 * k; ctx.strokeStyle = '#fff'; ctx.stroke(); }
    });
    if (!live.adjust) {
      const pulse = 0.65 + 0.35 * Math.sin(now / 220);
      const evals = live.evals.length ? live.evals : chordTargets(ch).map((t) => ({ ...t, ok: false }));
      evals.forEach((e) => {
        const [tu, tv] = targetUV(e);
        const p = PUV(tu, tv);
        if (e.barre) line(PUV(e.string / 5, tv), PUV(e.to / 5, tv), e.ok ? COL.good : `rgba(46,196,182,${pulse})`, 16 * k);
        if (e.contact && !e.ok) line(P(e.contact.x, e.contact.y), p, 'rgba(255,255,255,.85)', 2 * k, [6 * k, 5 * k]);
        ctx.globalAlpha = e.ok ? 1 : pulse;
        dot(p, 12 * k, e.ok ? COL.good : COL.target, String(e.finger), '#fff');
        ctx.globalAlpha = 1;
      });
    }
  }

  // Hands
  if (!live.frozen) {
    live.hands.forEach((hand) => {
      if (live.fret && hand !== live.fret && $('#liveSkeleton').checked) HAND_LINKS.forEach(([a, b]) => line(P(hand[a].x, hand[a].y), P(hand[b].x, hand[b].y), 'rgba(255,255,255,.25)', 1.5 * k));
    });
    const hand = live.fret;
    if (hand) {
      if ($('#liveSkeleton').checked) HAND_LINKS.forEach(([a, b]) => line(P(hand[a].x, hand[a].y), P(hand[b].x, hand[b].y), 'rgba(255,255,255,.75)', 2.5 * k));
      Object.keys(TIP).forEach((f) => {
        const e = live.evals.find((x) => x.finger === +f);
        const p = e ? e.contact : { x: hand[DIP[f]].x + 0.72 * (hand[TIP[f]].x - hand[DIP[f]].x), y: hand[DIP[f]].y + 0.72 * (hand[TIP[f]].y - hand[DIP[f]].y) };
        dot(P(p.x, p.y), 8.5 * k, !e ? 'rgba(20,20,20,.65)' : e.ok ? COL.good : COL.bad, f, 'rgba(255,255,255,.9)');
      });
    }
  }

  // Fine-tune handles
  if (live.adjust && live.calib) {
    live.calib.forEach((p, i) => {
      const q = P(p[0], p[1]);
      dot(q, 11 * k, i === live.drag ? COL.warn : 'rgba(46,196,182,.9)', '', '#fff');
      ctx.beginPath(); ctx.moveTo(q[0] - 5 * k, q[1]); ctx.lineTo(q[0] + 5 * k, q[1]); ctx.moveTo(q[0], q[1] - 5 * k); ctx.lineTo(q[0], q[1] + 5 * k);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * k; ctx.stroke();
      text(CORNER_NAMES[i], [q[0], q[1] - 20 * k], 11 * k, '#fff');
    });
  }

  // Zoom loupe for precise tapping / dragging
  if (live.pointer && (live.aiming || live.drag >= 0)) {
    const [px, py] = [live.pointer[0] * W, live.pointer[1] * H];
    const R = 70 * k, zoom = 3, ly = py - R - 40 * k > 0 ? py - R - 40 * k : py + R + 40 * k;
    ctx.save();
    ctx.beginPath(); ctx.arc(px, ly, R, 0, Math.PI * 2); ctx.closePath();
    ctx.fillStyle = '#000'; ctx.fill(); ctx.clip();
    ctx.drawImage(c, px - R / zoom, py - R / zoom, (2 * R) / zoom, (2 * R) / zoom, px - R, ly - R, 2 * R, 2 * R);
    ctx.restore();
    ctx.beginPath(); ctx.arc(px, ly, R, 0, Math.PI * 2); ctx.lineWidth = 3 * k; ctx.strokeStyle = '#fff'; ctx.stroke();
    line([px - 14 * k, ly], [px + 14 * k, ly], COL.bad, 2 * k); line([px, ly - 14 * k], [px, ly + 14 * k], COL.bad, 2 * k);
  }

  // Success flash
  if (now < live.flashUntil) {
    ctx.strokeStyle = COL.good; ctx.lineWidth = 14 * k; ctx.strokeRect(0, 0, W, H);
    const label = `✓ Clean ${pretty(live.chord)}!`;
    ctx.font = `800 ${40 * k}px system-ui`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(20,20,20,.6)';
    ctx.fillRect(W / 2 - tw / 2 - 20 * k, H / 2 - 34 * k, tw + 40 * k, 68 * k);
    ctx.fillStyle = COL.good; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, W / 2, H / 2 + 2);
  }

  // Tracking HUD
  if (!live.frozen) {
    const items = [];
    const neck = !live.calib ? ['Neck: not calibrated', '#aaa']
      : !live.follow ? ['Neck: fixed', '#ddd']
        : !NT.ready ? [NT.loading ? 'Neck: loading tracker…' : 'Neck: fixed', '#ddd']
          : NT.state === 'tracking' ? [`Neck: locked (${NT.inliers})`, COL.good] : ['Neck: searching…', COL.warn];
    items.push(neck);
    items.push(live.fret ? ['Hand: tracking', COL.good] : live.landmarker ? ['Hand: not found', COL.warn] : ['Hand: loading…', '#ddd']);
    items.push([`${live.fps} fps`, '#ddd']);
    ctx.font = `700 ${11 * k}px system-ui`;
    const bw = Math.max(...items.map(([s]) => ctx.measureText(s).width)) + 30 * k;
    ctx.fillStyle = 'rgba(10,15,18,.6)';
    ctx.beginPath(); ctx.roundRect(8 * k, 8 * k, bw, (items.length * 17 + 8) * k, 8 * k); ctx.fill();
    items.forEach(([s, col], i) => {
      const y = (8 + 12 + i * 17) * k;
      ctx.beginPath(); ctx.arc(20 * k, y, 4 * k, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(s, 30 * k, y);
    });
  }
}

/* =========================================================
   Side panel
   ========================================================= */
function setStatus(html, cls = '') { const el = $('#liveStatus'); el.innerHTML = html; el.className = 'live-status ' + cls; }

function updateUi(now) {
  if (now - live.lastUi < 150) return;
  live.lastUi = now;
  if (!live.running) { setStatus('Start the camera to begin.'); $('#fingerChecks').innerHTML = ''; return; }
  if (live.calibrating) { setStatus(`📐 Calibrating: point ${live.calibPts.length + 1} of 4 (picture frozen)`); return; }
  if (live.adjust) { setStatus('✥ Drag the corner handles onto the strings. Press <b>Done</b> when the lines match.'); return; }
  if (!live.landmarker) setStatus(live.loading ? '⏳ Loading hand tracking…' : '⚠️ Hand tracking unavailable', 'warn');
  else if (!live.H) setStatus('📐 Calibrate the neck to get finger-by-finger guidance.', 'warn');
  else if (live.follow && NT.ready && NT.state === 'lost') setStatus('🔎 Lost the neck. Move the guitar back into view, or recalibrate.', 'warn');
  else if (!live.fret) setStatus('✋ Bring your fretting hand onto the neck.', 'warn');
  else if (live.done) setStatus(`🎉 Clean ${pretty(live.chord)}!`, 'good');
  else {
    const ok = live.evals.filter((e) => e.ok).length, n = live.evals.length;
    setStatus(ok === n ? '✅ Perfect. Hold it…' : `${ok} of ${n} fingers in place`, ok === n ? 'good' : '');
  }
  const targets = live.evals.length ? live.evals : chordTargets(currentChord());
  $('#fingerChecks').innerHTML = targets.map((e) => `
    <li class="${e.ok ? 'ok' : live.fret && live.H ? 'bad' : ''}">
      <span class="fc-num">${e.finger}</span>
      <span class="fc-text"><b>${FINGER_WORD[e.finger]}</b> → ${e.barre ? `barre across fret ${e.fret}` : `${STRING_NAMES[e.string]} string, fret ${e.fret}`}
      ${e.hint ? `<small>${e.hint}</small>` : ''}
      ${e.contact && !e.ok ? `<small class="seen">Seeing it on: ${STRING_NAMES[e.ds]} string · ${e.df ? 'fret ' + e.df : 'behind the nut'}</small>` : ''}</span>
      <span class="fc-mark">${e.ok ? '✓' : ''}</span>
    </li>`).join('');
}

function resetScoring() { live.evals = []; live.votes = {}; live.okState = {}; live.goodSince = 0; live.done = false; }
function renderLiveChord() {
  const ch = currentChord();
  $('#liveChord').value = ch.name;
  $('#liveDiagram').innerHTML = `<div class="ld-name">${pretty(ch.name)}</div>${chordSVG(ch)}`;
  resetScoring();
  live.shownAt = performance.now();
  live.lastUi = 0;
  updateUi(performance.now());
}
function renderLiveStats() {
  $('#liveClean').textContent = live.clean;
  $('#liveBest').textContent = live.best ? live.best.toFixed(1) + 's' : '–';
}
function setChord(name) { live.chord = name; store.set('liveChord', name); renderLiveChord(); }
function nextChord() {
  const pool = CHORDS.filter((c) => !c.barre && c.cat !== 'power' && c.name !== live.chord);
  setChord(pool[Math.floor(Math.random() * pool.length)].name);
}
function success(now) {
  live.done = true;
  live.clean++;
  const secs = (now - live.shownAt) / 1000;
  if (!live.best || secs < live.best) live.best = secs;
  store.set('liveClean', live.clean); store.set('liveBest', live.best);
  renderLiveStats();
  live.flashUntil = now + 1200;
  Sound.strum(chordMidis(currentChord()));
  if ($('#liveAuto').checked) setTimeout(() => { if (live.done) nextChord(); }, 1600);
}

/* =========================================================
   Main loop
   ========================================================= */
function loop() {
  if (!live.running) return;
  const now = performance.now(), v = live.video;
  if (v.readyState >= 2 && v.currentTime !== live.lastVideoTime && !live.frozen) {
    live.lastVideoTime = v.currentTime;
    live.fpsN++;
    if (now - live.fpsT > 1000) { live.fps = Math.round((live.fpsN * 1000) / (now - live.fpsT)); live.fpsN = 0; live.fpsT = now; }
    if (live.landmarker) live.hands = detectHands(now);
    if (NT.ready && live.follow && live.calib && NT.anchor && !live.adjust) {
      const g = grabGray(v);
      try { trackNeck(g); } catch (e) { console.warn('neck tracking error', e); NT.state = 'lost'; }
      g.delete();
    }
    const raw = live.calibrating ? null : pickFrettingHand(live.hands);
    live.fret = raw ? smoothHand(raw, now) : null;
    live.evals = live.fret && live.H && !live.adjust ? evaluate(live.fret) : [];
    const allOk = live.evals.length && live.evals.every((e) => e.ok);
    if (allOk && !live.done) {
      if (!live.goodSince) live.goodSince = now;
      else if (now - live.goodSince > 600) success(now);
    } else if (!allOk) live.goodSince = 0;
  }
  if (v.readyState >= 2) draw(now);
  updateUi(now);
  requestAnimationFrame(loop);
}

/* =========================================================
   Camera + model
   ========================================================= */
function overlay(html) {
  const o = $('#liveOverlay');
  if (!html) { o.hidden = true; return; }
  o.hidden = false;
  o.innerHTML = `<div class="live-overlay-inner">${html}</div>`;
}
function toast(msg, ms = 3500) {
  const t = $('#liveToast');
  if (!msg) { t.hidden = true; return; }
  t.innerHTML = msg; t.hidden = false;
  clearTimeout(toast.timer);
  if (ms) toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

async function loadModel() {
  if (live.landmarker || live.loading) return;
  live.loading = true;
  toast('⏳ Loading hand tracking (first time only)…', 0);
  try {
    const vision = await import(`${MP_BASE}/vision_bundle.mjs`);
    const files = await vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: HAND_MODEL, delegate }, runningMode: 'VIDEO', numHands: 2,
      minHandDetectionConfidence: 0.35, minHandPresenceConfidence: 0.35, minTrackingConfidence: 0.4,
    });
    try { live.landmarker = await vision.HandLandmarker.createFromOptions(files, opts('GPU')); }
    catch { live.landmarker = await vision.HandLandmarker.createFromOptions(files, opts('CPU')); }
    toast(live.calib ? '✋ Hand tracking ready!' : '✋ Hand tracking ready. Now press <b>Calibrate neck</b>.', 4000);
  } catch (err) {
    console.error(err);
    toast('⚠️ Couldn\'t load hand tracking. Check your internet connection and try again.', 0);
  } finally { live.loading = false; }
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    overlay(`<div class="live-icon">🔒</div><h2>Camera not available here</h2>
      <p class="sub">Your browser only allows the camera on secure pages. Open the site with <code>start.bat</code> (local server) or over https.</p>`);
    return;
  }
  overlay('<div class="live-icon">⏳</div><h2>Starting camera…</h2><p class="sub">Allow camera access when your browser asks.</p>');
  try {
    live.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: live.facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false,
    });
  } catch (err) {
    const why = {
      NotAllowedError: 'Camera permission was blocked. Click the camera icon in the address bar to allow it, then try again.',
      NotFoundError: 'No camera was found on this device.',
      NotReadableError: 'The camera is being used by another app. Close it and try again.',
    }[err.name] || `The camera couldn't start (${err.name}). If you opened the file directly, try <code>start.bat</code>.`;
    overlay(`<div class="live-icon">⚠️</div><h2>Camera didn't start</h2><p class="sub">${why}</p><button class="btn primary" data-live-start>Try again</button>`);
    return;
  }
  live.video.srcObject = live.stream;
  await live.video.play();
  $('#liveStage').style.aspectRatio = `${live.video.videoWidth} / ${live.video.videoHeight}`;
  live.running = true;
  overlay(null);
  $('#liveStart').textContent = '■ Stop camera';
  $('#liveStart').classList.remove('primary');
  ['#liveCalib', '#liveFlip'].forEach((s) => { $(s).disabled = false; });
  $('#liveAdjust').disabled = !live.calib;
  try {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    $('#liveSwitch').hidden = cams.length < 2;
  } catch { /* device list is optional */ }
  requestAnimationFrame(loop);
  loadModel();
  if (live.follow) loadOpenCV().then(() => { if (live.calib && NT.ready) reanchorNow(); });
}

function stopCamera() {
  live.running = false;
  if (live.stream) live.stream.getTracks().forEach((t) => t.stop());
  live.stream = null;
  live.hands = []; live.fret = null; live.evals = [];
  live.calibrating = false; live.frozen = null; live.aiming = false;
  if (live.adjust) toggleAdjust(false);
  $('#liveBanner').hidden = true;
  overlay(`<div class="live-icon">📷</div><h2>Camera is off</h2><p class="sub">Your video is processed on this device and never uploaded.</p><button class="btn primary big" data-live-start>Start camera</button>`);
  $('#liveStart').textContent = '📷 Start camera';
  $('#liveStart').classList.add('primary');
  ['#liveCalib', '#liveFlip', '#liveAdjust'].forEach((s) => { $(s).disabled = true; });
  toast(null);
}

/* =========================================================
   Calibration (frozen frame + loupe) and fine-tuning
   ========================================================= */
function freezeFrame() {
  const v = live.video, c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext('2d').drawImage(v, 0, 0);
  live.frozen = c;
}
function startCalibration() {
  if (live.adjust) toggleAdjust(false);
  freezeFrame();
  live.calibrating = true;
  live.calibPts = [];
  showCalibStep();
}
function showCalibStep() {
  const b = $('#liveBanner');
  b.hidden = false;
  b.innerHTML = `<span class="lb-step">${live.calibPts.length + 1}/4</span><span>${CAL_STEPS[live.calibPts.length]}. <span class="lb-hint">Press, slide to aim, release.</span></span>
    ${live.calibPts.length ? '<button class="link" data-calib-undo>Undo</button>' : ''}<button class="link" data-calib-cancel>Cancel</button>`;
}
function finishCalibration() {
  live.base = live.calibPts.map((p) => p.slice());
  live.calib = live.base.map((p) => p.slice());
  store.set('liveCalib', live.base);
  computeH();
  live.calibrating = false;
  $('#liveBanner').hidden = true;
  if (NT.ready) reanchorNow(live.frozen);        // features from the exact frame you tapped on
  live.frozen = null;
  $('#liveAdjust').disabled = false;
  resetScoring();
  toast('✅ Calibrated! Check the white lines sit on your strings. Use <b>Fine-tune corners</b> if needed.', 5000);
}
function toggleAdjust(on = !live.adjust) {
  live.adjust = on;
  const b = $('#liveAdjust');
  b.classList.toggle('on', on);
  b.textContent = on ? '✓ Done' : '✥ Fine-tune corners';
  if (!on) {
    live.drag = -1;
    if (live.calib) {
      live.base = live.calib.map((p) => p.slice());
      store.set('liveCalib', live.base);
      reanchorNow();
    }
    resetScoring();
  }
}

function pointerPos(e) {
  const r = live.canvas.getBoundingClientRect();
  const dx = (e.clientX - r.left) / r.width, dy = (e.clientY - r.top) / r.height;
  return { disp: [dx, dy], raw: [live.mirror ? 1 - dx : dx, dy] };
}
live.canvas.addEventListener('pointerdown', (e) => {
  const { disp } = pointerPos(e);
  if (live.calibrating) {
    live.aiming = true; live.pointer = disp;
    live.canvas.setPointerCapture(e.pointerId);
  } else if (live.adjust && live.calib) {
    const r = live.canvas.getBoundingClientRect();
    let best = -1, bestD = 36;
    live.calib.forEach(([x, y], i) => {
      const d = Math.hypot(((live.mirror ? 1 - x : x) - disp[0]) * r.width, (y - disp[1]) * r.height);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best >= 0) { live.drag = best; live.pointer = disp; live.canvas.setPointerCapture(e.pointerId); }
  }
});
live.canvas.addEventListener('pointermove', (e) => {
  const { disp, raw } = pointerPos(e);
  if (live.aiming) live.pointer = disp;
  if (live.drag >= 0) { live.pointer = disp; live.calib[live.drag] = raw; computeH(); }
});
live.canvas.addEventListener('pointerup', (e) => {
  const { raw } = pointerPos(e);
  if (live.aiming) {
    live.aiming = false; live.pointer = null;
    live.calibPts.push(raw);
    if (live.calibPts.length < 4) showCalibStep(); else finishCalibration();
  }
  if (live.drag >= 0) { live.drag = -1; live.pointer = null; }
});
live.canvas.addEventListener('pointercancel', () => { live.aiming = false; live.drag = -1; live.pointer = null; });

$('#liveBanner').addEventListener('click', (e) => {
  if (e.target.closest('[data-calib-undo]')) { live.calibPts.pop(); showCalibStep(); return; }
  if (!e.target.closest('[data-calib-cancel]')) return;
  live.calibrating = false; live.frozen = null;
  $('#liveBanner').hidden = true;
});

/* =========================================================
   Wiring
   ========================================================= */
$('#liveChord').innerHTML = CHORD_CATEGORIES.filter((c) => c.id !== 'all').map((cat) =>
  `<optgroup label="${cat.label}">${CHORDS.filter((c) => c.cat === cat.id).map((c) => `<option value="${c.name}">${pretty(c.name)}: ${c.full}</option>`).join('')}</optgroup>`).join('');
$('#liveChord').addEventListener('change', (e) => setChord(e.target.value));
$('#liveNext').addEventListener('click', nextChord);
$('#liveStart').addEventListener('click', () => (live.running ? stopCamera() : startCamera()));
$('#liveStage').addEventListener('click', (e) => { if (e.target.closest('[data-live-start], #liveStartBig')) startCamera(); });
$('#liveCalib').addEventListener('click', startCalibration);
$('#liveAdjust').addEventListener('click', () => toggleAdjust());
$('#liveFlip').addEventListener('click', () => {
  live.mirror = !live.mirror;
  store.set('liveMirror', live.mirror);
  toast(live.mirror ? 'Mirror view on (like a mirror)' : 'Mirror view off (as the camera sees it)', 2000);
});
$('#liveSwitch').addEventListener('click', async () => {
  live.facing = live.facing === 'user' ? 'environment' : 'user';
  stopCamera();
  await startCamera();
});
$('#liveFollow').checked = live.follow;
$('#liveFollow').addEventListener('change', (e) => {
  live.follow = e.target.checked;
  store.set('liveFollow', live.follow);
  if (live.follow && live.running) loadOpenCV().then(() => reanchorNow());
  if (!live.follow && live.base) { live.calib = live.base.map((p) => p.slice()); computeH(); }
});
$('#liveStrict').value = live.strict;
$('#liveStrict').addEventListener('change', (e) => { live.strict = e.target.value; store.set('liveStrict', live.strict); resetScoring(); });

const stopIfHidden = () => setTimeout(() => { if (currentTab !== 'live' && live.running) stopCamera(); }, 0);
$$('[data-tab], [data-goto]').forEach((b) => b.addEventListener('click', stopIfHidden));
window.addEventListener('hashchange', stopIfHidden);
document.addEventListener('visibilitychange', () => { if (document.hidden && live.running) stopCamera(); });

window.openLive = (name) => { setChord(name); showTab('live'); };

computeH();
renderLiveChord();
renderLiveStats();
