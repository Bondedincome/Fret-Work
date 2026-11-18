# Fretwork

A guitar practice app that runs in the browser. It has a chord library, a fretboard note trainer, music theory lessons, ear training, a metronome, a practice timer, and a camera-based **Live coach** that checks your finger placement in real time.

Fretwork is plain HTML, CSS and JavaScript. There is no build step, no framework and no backend. Everything runs on your device, and your progress is saved in the browser's `localStorage`.

## Features

| Tab | What it does |
| --- | --- |
| **Chords** | A library of 42 common chords (major, minor, 7th, maj7, m7, sus/add, power) with finger diagrams and audio playback. Search and filter by type. |
| **Live** *(beta)* | Point your camera at the guitar neck. The coach shows where each finger goes, marks each finger correct or incorrect, and scores clean chord changes. |
| **Song** *(beta)* | Upload an audio file, or paste a direct link to one. Fretwork detects the tempo, key and chords and shows a synced player (current and next chord diagrams), a clickable timeline, a bar-by-bar chord sheet you can copy, and a capo helper. |
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

## Publishing on cPanel

Fretwork is a static site, so it needs no database, PHP or Node.js on the server. Any cPanel host works.

### 1. Build the upload package

From the project folder in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File deploy.ps1
```

This creates `fretwork-site.zip` (and the same files in `dist/`). The package contains only the website files, with no README or `.git`. The script also checks that every referenced file exists and adds a version number to the CSS/JS links, so visitors get the new version after each update.

### 2. Turn on HTTPS

In cPanel open **Security → SSL/TLS Status** and make sure your domain has a valid certificate. If it doesn't, click **Run AutoSSL**. HTTPS is required: browsers block the camera (Live coach) and clipboard (Copy chords) on plain `http://` pages.

### 3. Upload

1. Open **Files → File Manager → `public_html`**. To put the site in a subfolder (e.g. `yourdomain.com/fretwork`), create that folder and open it instead. All paths are relative, so either works.
2. Click **Upload** and choose `fretwork-site.zip`.
3. Back in File Manager, right-click the zip, choose **Extract**, then delete the zip.
4. To see the `.htaccess` file, click **Settings → Show Hidden Files (dotfiles)**.

Then open `https://yourdomain.com` and check that the icon shows in the tab and that the Song and Live tabs work.

If you prefer FTP (FileZilla, etc.), upload the **contents** of `dist/` to `public_html`, including the hidden `.htaccess`.

### Updating the site

Run `deploy.ps1` again, upload the new zip, and extract it over the old files (allow overwriting). Visitors get the new version on their next visit.

### What `.htaccess` does

- Redirects `http://` to `https://`, keeping `/.well-known/` reachable so AutoSSL can renew the certificate.
- Serves the correct file types (e.g. `.webmanifest`), compresses text files, and stops visitors from browsing folder listings, hidden files and dev files.
- Caching: HTML, CSS and JS are re-checked on each visit, so updates show up right away. Images are cached for 30 days.
- Security headers: `nosniff`, `SAMEORIGIN` framing, a strict referrer policy, and a `Permissions-Policy` that allows the camera only for this site.
- After HTTPS works, you can uncomment the `Strict-Transport-Security` line for extra protection.

### Troubleshooting

| Problem | Fix |
| --- | --- |
| **500 Internal Server Error** right after upload | Rename `.htaccess` to `htaccess.off`. If the site then loads, your host doesn't allow one of its settings; ask the host or delete lines until it works. |
| **"Too many redirects"** behind Cloudflare | In Cloudflare, set **SSL/TLS** mode to **Full** (not *Flexible*). |
| Camera doesn't start | The page must be opened with `https://`, and the visitor must allow camera access. |
| Old version still showing | Hard-refresh (Ctrl+F5). Make sure you uploaded the newly built zip, not old files. |
| A song link won't load in the Song tab | The other website blocks cross-site downloads (CORS). Download the file and upload it instead. |

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

## Using Song to chords

1. Open the **Song** tab and drop in an audio file (MP3, M4A, WAV, OGG, FLAC; up to 10 minutes), or paste a **direct** link to an audio file.
2. Wait a few seconds while Fretwork finds the beat, the key and the chords.
3. Press **Play**. The big diagram shows the chord to play now, and the smaller one shows the next chord with a beat countdown. Tap the timeline or any bar in the chord sheet to jump there.
4. Optional:
   - **With 7ths** also detects 7, maj7 and m7 chords.
   - **Capo** shows the shapes to play with a capo, and suggests the capo position that gives the most easy open shapes.
   - **Strum chord changes** plays each new chord as the song reaches it.
   - **Copy chords** copies a text chord sheet.

Links from streaming sites (YouTube, Spotify, Apple Music, SoundCloud…) can't be analysed, because those sites don't let other web apps read their audio. Links to other websites only work if the server allows cross-origin requests (CORS). Otherwise, download the file and upload it.

### How the chord detection works

All analysis runs in the browser ([songcore.js](songcore.js)), and the audio is never uploaded.

- **Beat:** a spectral-flux onset envelope, an autocorrelation tempo estimate (with a half/double-tempo check), and a dynamic-programming beat tracker.
- **Notes:** an 8192-point FFT. Spectral peaks are tuning-corrected, overtones are suppressed, and the result is folded into treble and bass chroma (12 pitch classes), averaged per beat.
- **Chords:** templates with harmonic weighting are matched for major and minor chords (plus 7ths when enabled), with a bonus for the bass note and for chords in the key. A Viterbi pass smooths the result so chords don't flicker.
- **Key:** worked out from which key's chords cover most of the song, with weight on the tonic chord.

Detection works best on clear recordings with a steady beat, where guitar or piano carries the harmony. Treat the results as a starting point and trust your ears.

## Project structure

```text
index.html   Page layout and markup for every tab
style.css    All styling, including light/dark themes and the responsive layout
chords.js    Chord data: frets, fingerings, barres, categories
app.js       Core: helpers, audio engine (Web Audio), storage, tabs, chords, notes, metronome, timer
theory.js    Key explorer (scales, modes, diatonic chords, progressions) and ear training
learn.js     Theory lessons, circle of fifths, chord finder, transpose and capo
live.js      Live coach: camera, hand/neck tracking, calibration, scoring
songcore.js  Song analysis engine (beats, key, chords); no DOM, also runs in Node
song.js      Song tab: file/link loading, synced player, timeline, chord sheet, capo helper
favicon.ico      Browser-tab icon (16/32/48 px) for older browsers
site.webmanifest App name, colours and icons for "Add to Home Screen"
.htaccess        Server settings for Apache/LiteSpeed (HTTPS, caching, security headers)
robots.txt       Lets search engines index the site
deploy.ps1       Builds dist/ and fretwork-site.zip for uploading (see "Publishing on cPanel")
icons/           logo-light-mode.png / logo-dark-mode.png (header logo, swapped with the theme),
                 icon.svg (tab icon that follows the system light/dark setting), home-screen PNGs
```

The scripts are classic (non-module) scripts that share globals. They must load in the order used in `index.html`: `chords.js` → `app.js` → `theory.js` → `learn.js` → `live.js` → `songcore.js` → `song.js`.

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

The new chord appears automatically in the library, the Live coach and the chord finder. The Song tab also uses it whenever it detects that chord, in place of a generic barre shape.

## Data and privacy

- All settings, stats and practice history are stored in `localStorage` under keys prefixed with `fretwork:`. Clearing your browser's site data resets them.
- The camera feed and any songs you analyse never leave your device.
- The only network requests are for Google Fonts, the Live coach's libraries and model, and any audio link you paste into the Song tab.

## Browser notes

- Sound starts only after your first click or tap, because browsers block audio until you interact with the page.
- The Live coach performs best in Chromium-based browsers on a laptop or a recent phone.
