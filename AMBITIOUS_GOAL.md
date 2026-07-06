# Ambitious Goal: Per-Piano Stretch Tuning

## The vision

Build a phone-based tuner that **measures the inharmonicity of the specific piano
in front of it** and generates a custom stretch-tuning curve — matching what
professional apps (TuneLab, Verituner, CyberTuner) do, entirely client-side on an
ordinary iPhone/Android mic.

This is the "pro mode" endgame, not the MVP. Ship the simple tuner and a fixed
average-curve piano mode first; layer this on top.

**Status of this document:** reviewed against the working Warbler codebase
(2026-07-05). Verdict: feasible, and the plan below is the right one. The
difficulty is unevenly distributed, though — two complications that weren't in
the original draft are now called out, and the head start we already have is
bigger than the draft assumed.

## Why it matters

There is **no universal stretch table** — inharmonicity depends on each piano's
string physics (stiffness, length, tension). A small spinet needs far more stretch
than a 9-foot concert grand, so a fixed curve is only an approximation. Measuring
per-piano is what separates a serious tuning tool from a toy.

The phone mic is **not** the bottleneck: frequency accuracy depends on DSP
(timing/frequency resolution), not mic quality. This holds up in practice —
B is fitted from partials 2–8, which sit comfortably in a phone mic's range
even for bass notes whose fundamentals the mic barely captures.

## How it works

For each played note, don't just find the fundamental — find its overtones
(partials) and measure how sharp each one is.

1. Play one note; capture a sustained chunk (~1–2 s, after the attack settles).
2. FFT it; locate the fundamental plus the first several partials (2nd–8th).
   The MPM fundamental the tuner already detects seeds the search: partial *n*
   is expected near n · f₀ · √(1 + B·n²), so the hunt is narrow.
3. Measure each partial's exact frequency. On a real string, partial *n* sits at:

   **fₙ = n · f₀ · √(1 + B·n²)**

   where **B** is that note's inharmonicity coefficient.
4. Fit **B** from the measured partials. Squaring the model makes it *linear*
   least squares — (fₙ / n·f₀)² = 1 + B·n² — roughly ten lines of code.
5. Repeat for a sparse sample of notes across the keyboard (~5–15, not all 88),
   then interpolate B for the rest. Sample around bass/tenor string breaks.
6. Build the per-note cents-offset stretch curve from the fitted B values,
   tailored to that specific piano. **This step is a design decision, not
   arithmetic — see below.**

## Head start already in the codebase

- `pitch.js` has a hand-rolled radix-2 FFT and an MPM fundamental detector
  verified to a few cents from A0 to C8 — the partial search builds directly
  on both.
- The Node test harness (`test/pitch.test.mjs`) already validates DSP against
  synthetic tones with known ground truth. The same trick fully de-risks this
  feature: **synthesize tones with a known B, assert we recover it** — before
  any real piano is involved.
- Sub-cent numbers check out: 0.1 cent at A4 ≈ 0.025 Hz. A 1.4 s capture gives
  ~0.7 Hz bins; windowed parabolic/Gaussian peak interpolation reaches a small
  fraction of a bin at decent SNR (~0.01–0.04 Hz), and phase-difference methods
  do better still. With 1–2 s captures, sub-cent partial measurement on a phone
  is realistic.

## The genuinely hard parts

### 1. Sub-cent precision (as originally identified)

A naive FFT is far too coarse (4096 points at 44.1 kHz ≈ 10 Hz bins = many
cents). The solution is **not** a giant FFT but sub-bin peak interpolation:

- Parabolic / Gaussian interpolation across the peak bin and its neighbors, or
- Phase-vocoder / phase-difference methods between successive frames, or
- Longer time windows for the bass (low notes need more cycles to resolve).

Well-documented DSP — just more careful than the autocorrelation good enough
for the live tuner display.

### 2. Unison strings (missed by the original draft)

Above the bass, each piano "note" is **two or three strings struck together**,
always slightly detuned from one another. Every partial is therefore not one
spectral peak but a cluster of beating peaks; naive interpolation on the
composite peak measures a moving average that wobbles as the strings beat.
This is a real accuracy limiter, not an edge case, and it's where the most
iteration should be expected. Mitigations: longer windows, measuring during a
stable stretch of the decay, capture-quality gating with automatic retry
prompts. (Pros mute to a single string; that's unrealistic without tools.)

### 3. Choosing what the stretch aligns (missed by the original draft)

Once B is known per note, the curve still depends on *which partial pairs the
octaves align*: 2:1 in the treble, 4:2 mid-keyboard, 6:3 in the low bass, and
how to blend between them. Different choices are audibly different tunings —
this is much of what distinguishes Verituner's "styles." A sensible default
(4:2 mid, 6:3 low bass, 2:1 top) yields a musically credible curve, but budget
real reading-and-listening time here.

## Difficulty breakdown (revised)

| Task | Difficulty |
|---|---|
| Detect fundamental | Done — MPM in `pitch.js`, tested |
| Detect several partials via FFT | Medium — FFT exists, search is seeded by MPM |
| Sub-cent peak interpolation | Medium — known algorithms, careful work |
| Handle unison-string beating | **Medium-hard — the main accuracy limiter** |
| Fit B per note | Easy — linear least squares |
| Interpolate B across keyboard | Medium — handle string breaks |
| Choose octave-alignment style | Medium — design/listening decision, not code |
| Measurement UX (guide, gate, retry) | Medium — comparable in size to the DSP itself |
| **Whole per-piano stretch feature** | Ambitious but genuinely doable |

## The real catch

The difficulty isn't the physics — it's the **precision engineering and
validation**: reliable sub-cent accuracy across all 88 notes, in noisy rooms,
with the piano's decaying, beating tone. That's what commercial apps spent
years refining.

Validation strategy in order of strength: (1) synthetic tones with known B in
the Node harness — proves the math end-to-end; (2) sanity-check fitted B values
against published ranges (B rises steeply into the high treble, jumps at the
bass string break); (3) ears, on the actual piano.

A first version measuring B on the middle 4–5 octaves and producing a visibly
better-than-equal-temperament curve is very achievable. Matching Verituner's
polish is a long road, and not the goal.

## Scope guidance

- **Flute** → no stretch, ever. Straight equal temperament.
- **Piano MVP** → fixed average (Railsback-style) curve as a "Piano (stretched)"
  toggle. A lookup table applied to note targets the app already computes —
  roughly an afternoon, immediately useful, and it builds the per-note-offset
  plumbing pro mode will later feed.
- **Piano pro mode (this goal)** → per-piano measurement. Reuses the FFT work;
  a natural extension, not a rewrite. Expect the DSP core (with synthetic
  validation) and the measurement UX to be similar amounts of work.

## Tech context

- Web Audio API (`getUserMedia` + `AnalyserNode`) pulls raw samples — already
  wired up in `index.html`.
- Partial detection and B-fitting written by hand, like the existing MPM
  detector. No libraries, no backend, no ML, fully client-side.
- Runs in the mobile browser as the existing PWA; no store wrapper needed for
  personal use.
- Testing footnote: the in-browser `__tone()` debug hook uses `PeriodicWave`,
  which can only produce *harmonic* partials. Browser-side inharmonicity tests
  need one oscillator per partial; the Node harness has no such limitation and
  is the primary validation path.
