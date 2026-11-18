# Fretwork

A guitar practice app that runs in the browser. It has a chord library, a fretboard note trainer, music theory lessons, ear training, a metronome, a practice timer, and a camera-based **Live coach** that checks your finger placement in real time.

Fretwork is plain HTML, CSS and JavaScript. There is no build step, no framework and no backend. Everything runs on your device, and your progress is saved in the browser's `localStorage`.

## Features

| Tab | What it does |
| --- | --- |
| **Chords** | A library of 42 common chords (major, minor, 7th, maj7, m7, sus/add, power) with finger diagrams and audio playback. Search and filter by type. |
| **Live** *(beta)* | Point your camera at the guitar neck. The coach shows where each finger goes, marks each finger correct or incorrect, and scores clean chord changes. |
| **Notes** | An interactive fretboard with sharps/flats, highlighting for a chosen note, a "naturals only" view, a fretboard quiz and a tuning reference. |
| **Theory** | 11 short lessons (intervals, scales, chord building, Roman numerals, circle of fifths, modes, rhythm, capos…), plus a key explorer, an interactive circle of fifths, a chord finder ("what chord am I holding?") and a transpose and capo helper. |
| **Ear Training** | Interval and chord-type recognition at three difficulty levels, with session and all-time accuracy stats. |
| **Metronome** | 30–250 BPM, tap tempo, time signatures from 2/4 to 7/8, subdivisions, accent on beat one, and a speed trainer that raises the tempo gradually. **Space** starts and stops it. |
| **Timer** | Countdown or stopwatch with presets, a "practising" label, and daily, weekly and streak totals. |

Other details: light and dark themes, a mobile-friendly layout, and status pills that show a running metronome or timer while you are on other tabs.

## Getting started

You only need a modern browser (a recent Chrome, Edge, Firefox or Safari).

### Quick start

Open `index.html` in your browser. Every tab except **Live** works this way.

### Recommended: use a local server

The Live coach uses the camera and loads WebAssembly models. Browsers only allow that from `http://localhost` or HTTPS, not from `file://`. Start any static server from the project folder, for example:

```bash
# Python 3
python -m http.server 8000

# or Node.js
npx serve .
```

Then go to <http://localhost:8000>.

To use it on a phone, serve it over HTTPS (for example with a tunnel or a static host such as GitHub Pages). Mobile browsers block camera access on plain-HTTP LAN addresses.

## Using the Live coach

1. Place the camera so it sees the neck from the **headstock to about the 7th fret**, as large as possible.
2. Press **Start camera**, then **Calibrate neck**. The picture freezes: tap the 4 corner points of the neck, using the zoom loupe to aim.
3. Use **Fine-tune corners** if a guide line is slightly off.
4. Choose a chord. Ghost dots show where each finger goes and turn green when a finger is in place. Hold the chord briefly to score it.
5. Keep **Follow guitar movement** turned on so the guides stay on the neck when the guitar moves.

Tips: use bright, even light, avoid having a window behind you, and wear plain clothing behind the neck. Video is processed locally and never uploaded.

### How it works

- **Hand tracking:** [MediaPipe Hand Landmarker](https://developers.google.com/mediapipe/solutions/vision/hand_landmarker) finds 21 joints per hand. It runs on a crop around the neck so that small or distant hands are still detected, and a One-Euro filter smooths the results.
- **Neck tracking:** [OpenCV.js](https://docs.opencv.org/4.x/d5/d10/tutorial_js_root.html) follows corner features with pyramidal Lucas-Kanade optical flow and fits a RANSAC homography to keep the calibration corners on the moving neck. If tracking is lost, ORB feature matching finds the neck again.
- **Scoring:** compares each finger pad's position to the target, using tolerance bands and frame voting to avoid flicker. The **Strictness** setting adjusts how close a finger must be.

Both libraries load from jsDelivr / Google Cloud Storage the first time you open the Live tab, so that tab needs an internet connection.

## Project structure

```text
index.html   Page layout and markup for every tab
style.css    All styling, including light/dark themes and the responsive layout
chords.js    Chord data: frets, fingerings, barres, categories
app.js       Core: helpers, audio engine (Web Audio), storage, tabs, chords, notes, metronome, timer
theory.js    Key explorer (scales, modes, diatonic chords, progressions) and ear training
learn.js     Theory lessons, circle of fifths, chord finder, transpose and capo
live.js      Live coach: camera, hand/neck tracking, calibration, scoring
```

The scripts are classic (non-module) scripts that share globals. They must load in the order used in `index.html`: `chords.js` → `app.js` → `theory.js` → `learn.js` → `live.js`.

### Adding a chord

Add an entry to `CHORDS` in [chords.js](chords.js):

```js
{ n: 'F', full: 'F major', cat: 'major', f: '133211', fg: '134211', b: [1, 0, 5] }
```

- `f`: fret for each string, low E to high e (`x` = muted, `0` = open)
- `fg`: finger for each string (1 = index … 4 = pinky)
- `b` *(optional)*: barre as `[fret, fromString, toString]`, where string 0 is low E
- `base` *(optional)*: first fret shown in the diagram
- `flats` *(optional)*: spell notes with flats

The new chord appears automatically in the library, the Live coach and the chord finder.

## Data and privacy

- All settings, stats and practice history are stored in `localStorage` under keys prefixed with `fretwork:`. Clearing your browser's site data resets them.
- The camera feed never leaves your device.
- The only network requests are for Google Fonts and the Live coach's libraries and model.

## Browser notes

- Sound starts only after your first click or tap, because browsers block audio until you interact with the page.
- The Live coach performs best in Chromium-based browsers on a laptop or a recent phone.
