// Synthetic-tone tests for the MPM detector in pitch.js.
// Run: node test/pitch.test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Pitch = require('../pitch.js');

const SR = 48000;
const N = 4096;
const detector = Pitch.createDetector(N, SR);

// Deterministic pseudo-noise so runs are reproducible.
let seed = 42;
function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff - 0.5;
}

/**
 * Generate a tone: sum of harmonics with given relative amplitudes + noise.
 * Harmonics at/above Nyquist are skipped — a real recording would never
 * contain them (the ADC's anti-aliasing filter removes them).
 */
function tone(freq, harmonics, noise = 0.01) {
  const buf = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let h = 0; h < harmonics.length; h++) {
      if (freq * (h + 1) >= 0.45 * SR) break;
      s += harmonics[h] * Math.sin(2 * Math.PI * freq * (h + 1) * (i / SR) + h * 1.3);
    }
    buf[i] = s * 0.25 + noise * rand();
  }
  return buf;
}

const FLUTE = [1.0, 0.35, 0.12, 0.04];               // near-pure, strong fundamental
const PIANO_BASS = [0.25, 1.0, 0.8, 0.5, 0.3, 0.15]; // weak fundamental, rich overtones
const PIANO_TREBLE = [1.0, 0.45, 0.15];              // top octaves are fundamental-dominant
const SINE = [1.0];
const pianoSpectrum = (f) => (f < 1500 ? PIANO_BASS : PIANO_TREBLE);

function centsOff(detected, expected) {
  return 1200 * Math.log2(detected / expected);
}

let pass = 0, fail = 0;
function check(label, freq, harmonics, tolCents) {
  const r = detector.detect(tone(freq, harmonics));
  if (!r) {
    console.log(`FAIL ${label} @ ${freq} Hz: no detection`);
    fail++;
    return;
  }
  const off = centsOff(r.frequency, freq);
  if (Math.abs(off) <= tolCents) {
    pass++;
  } else {
    console.log(`FAIL ${label} @ ${freq} Hz: got ${r.frequency.toFixed(2)} Hz (${off.toFixed(1)}c off, clarity ${r.clarity.toFixed(2)})`);
    fail++;
  }
}

// Piano range: A0 to C8. Flute range: C4 to C7.
const pianoFreqs = [27.5, 41.2, 55, 82.4, 110, 164.8, 261.63, 440, 880, 1760, 2793.8, 4186];
const fluteFreqs = [261.63, 349.23, 440, 587.33, 880, 1174.66, 1568, 2093];

for (const f of pianoFreqs) check('piano', f, pianoSpectrum(f), f > 2000 ? 10 : 5);
for (const f of fluteFreqs) check('flute', f, FLUTE, f > 2000 ? 10 : 5);
for (const f of [100, 442, 1000, 3000]) check('sine', f, SINE, f > 2000 ? 10 : 5);

// Off-center pitches (detuned) must report accurate frequency, not snap.
for (const f of [443.7, 259.1, 891.2]) check('detuned', f, FLUTE, 5);

// Gate hysteresis: a very quiet sustained tone (decayed piano, iOS-suppressed
// steady tone) is rejected by onset-level gates but tracked with sustain gates.
{
  const quiet = tone(442, FLUTE, 0.0005);
  for (let i = 0; i < quiet.length; i++) quiet[i] *= 0.004; // rms ≈ 0.0008
  if (detector.detect(quiet) === null) pass++;
  else { console.log('FAIL quiet tone passed onset gate'); fail++; }
  const r = detector.detect(quiet, { rmsGate: 0.0006, clarityGate: 0.5 });
  if (r && Math.abs(centsOff(r.frequency, 442)) <= 5) pass++;
  else { console.log('FAIL quiet tone under sustain gates:', r && r.frequency); fail++; }
}

// Silence and pure noise must return null.
{
  const silence = new Float32Array(N);
  const noiseBuf = new Float32Array(N);
  for (let i = 0; i < N; i++) noiseBuf[i] = 0.3 * rand();
  if (detector.detect(silence) === null) pass++; else { console.log('FAIL silence: detected something'); fail++; }
  if (detector.detect(noiseBuf) === null) pass++; else { console.log('FAIL noise: detected something'); fail++; }
}

// Note math sanity.
{
  const n = Pitch.freqToNote(442, 442);
  if (n.name === 'A' && n.octave === 4 && Math.abs(n.cents) < 0.01) pass++;
  else { console.log('FAIL note math A4@442', JSON.stringify(n)); fail++; }
  const m = Pitch.freqToNote(447, 440); // ~+27c above A4
  if (m.name === 'A' && m.octave === 4 && m.cents > 20 && m.cents < 35) pass++;
  else { console.log('FAIL note math sharp A4', JSON.stringify(m)); fail++; }
}

// Rough speed check: detection must be far faster than real time.
{
  const buf = tone(440, PIANO_BASS);
  const t0 = process.hrtime.bigint();
  const iters = 200;
  for (let i = 0; i < iters; i++) detector.detect(buf);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / iters;
  console.log(`speed: ${ms.toFixed(2)} ms per detection (window is ${(N / SR * 1000).toFixed(0)} ms)`);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
