# Warbler

A pitch detector and tuner for flute and piano. Point your phone's microphone
at the instrument and Warbler shows the note, how many cents sharp or flat it
is, the exact frequency, and a scrolling trace of your pitch over time.

The design is borrowed from the prothonotary warbler: golden yellow when you're
in tune, slate blue-gray when you're flat, on warm field-guide paper.

- **Detection**: McLeod Pitch Method (MPM) with FFT-accelerated autocorrelation,
  accurate to a few cents from piano A0 (27.5 Hz) to C8 (4186 Hz). All analysis
  happens on-device; no audio ever leaves the phone.
- **A₄ reference**: adjustable 415–466 Hz (remembered between sessions).
- **In-tune reward**: hold a note within ±5 cents for 1.5 s and the warbler
  lands above the note.
- **PWA**: installable to the home screen, works offline after first load.

No frameworks, no build step, no dependencies. Plain HTML + JS.

## Files

| File | Purpose |
|---|---|
| `index.html` | The whole app: UI, audio capture, drawing |
| `pitch.js` | MPM pitch detection + note math (also runs in Node) |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | PWA install/offline support |
| `test/pitch.test.mjs` | Synthetic-tone tests for the detector |

## Run locally

```
npx http-server -p 8123 -c-1 .
```

Open http://localhost:8123. Browsers only allow the microphone on `localhost`
or HTTPS. Without a mic you can test from DevTools: `__tone(442)` plays a
synthetic flute-like tone into the analyser, `__tone(0)` stops it.

Run the detector tests with:

```
node test/pitch.test.mjs
```

## Put it on your phone (GitHub Pages)

One-time setup:

1. Create a repo on GitHub (e.g. `warbler`), then from this folder:
   ```
   git init
   git add index.html pitch.js sw.js manifest.webmanifest icon-192.png icon-512.png apple-touch-icon.png README.md test
   git commit -m "Warbler tuner"
   git remote add origin https://github.com/<you>/warbler.git
   git push -u origin main
   ```
2. On GitHub: repo **Settings → Pages → Source: Deploy from a branch**,
   branch `main`, folder `/ (root)`. Wait a minute.
3. Your app is at `https://<you>.github.io/warbler/`.

On the phone:

- **iPhone**: open the URL in Safari → Share → **Add to Home Screen**.
- **Android**: open in Chrome → menu → **Add to Home screen** (or "Install app").

Launching from the home screen icon gives you full screen and (on iOS) a
remembered microphone permission. After any code change, `git push` and
reopen the app — the service worker fetches fresh files whenever the phone is
online, and falls back to its cache offline. If an update ever seems stuck,
bump the `CACHE` name in `sw.js`.

## Notes for tuning practice

- The needle turns **gold** within ±5 cents, **rust** when sharp, **slate
  blue** when flat.
- The trace view shows pitch in semitone space — vibrato width, note attacks,
  and whether long tones sag are all visible at a glance.
- Piano's upper octaves are intentionally tuned slightly sharp ("stretch");
  a correct piano will read a few cents sharp up high. That's the piano being
  right, not the app being wrong.
