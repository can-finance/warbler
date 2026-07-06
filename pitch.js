/*
 * pitch.js — monophonic pitch detection via the McLeod Pitch Method (MPM).
 *
 * MPM computes the Normalized Square Difference Function (NSDF) and picks the
 * first key maximum above a fraction of the global maximum. Autocorrelation is
 * done with an FFT (O(n log n)) so large windows stay cheap; large windows are
 * what make low piano notes (A0 = 27.5 Hz) detectable.
 *
 * Runs in the browser (global `Pitch`) and in Node (module.exports) with no
 * dependencies.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Pitch = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // ---- FFT (iterative radix-2, complex, in-place) --------------------------

  function makeFFT(n) {
    // Precompute bit-reversal permutation and twiddle factors for size n.
    const rev = new Uint32Array(n);
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      rev[i] = j;
    }
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      cos[i] = Math.cos((-2 * Math.PI * i) / n);
      sin[i] = Math.sin((-2 * Math.PI * i) / n);
    }
    return function fft(re, im, invert) {
      for (let i = 0; i < n; i++) {
        const j = rev[i];
        if (i < j) {
          let t = re[i]; re[i] = re[j]; re[j] = t;
          t = im[i]; im[i] = im[j]; im[j] = t;
        }
      }
      for (let len = 2; len <= n; len <<= 1) {
        const step = n / len;
        for (let i = 0; i < n; i += len) {
          for (let k = 0; k < len / 2; k++) {
            const wRe = cos[k * step];
            const wIm = invert ? -sin[k * step] : sin[k * step];
            const a = i + k, b = i + k + len / 2;
            const uRe = re[a], uIm = im[a];
            const vRe = re[b] * wRe - im[b] * wIm;
            const vIm = re[b] * wIm + im[b] * wRe;
            re[a] = uRe + vRe; im[a] = uIm + vIm;
            re[b] = uRe - vRe; im[b] = uIm - vIm;
          }
        }
      }
      if (invert) {
        for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
      }
    };
  }

  // ---- MPM detector ---------------------------------------------------------

  /**
   * Create a reusable detector for a fixed window size and sample rate.
   * Buffers are preallocated so per-frame detection does no allocation.
   */
  function createDetector(windowSize, sampleRate, options) {
    const opts = options || {};
    const minFreq = opts.minFreq || 24;    // below piano A0
    const maxFreq = opts.maxFreq || 4500;  // above piano C8
    const kThreshold = opts.threshold || 0.9; // MPM key-maximum threshold

    const n = windowSize;
    const fftSize = 1 << Math.ceil(Math.log2(2 * n)); // zero-padded, no wrap
    const fft = makeFFT(fftSize);
    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);
    const nsdf = new Float64Array(n);

    const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
    const tauMax = Math.min(n - 1, Math.ceil(sampleRate / minFreq));

    /**
     * Detect pitch in a Float32Array/Float64Array of length windowSize.
     * Returns { frequency, clarity, rms } or null when no reliable pitch.
     */
    function detect(buf) {
      // RMS gate: don't chase noise in silence.
      let sq = 0;
      for (let i = 0; i < n; i++) sq += buf[i] * buf[i];
      const rms = Math.sqrt(sq / n);
      if (rms < (opts.rmsGate !== undefined ? opts.rmsGate : 0.004)) {
        return null;
      }

      // Autocorrelation r(tau) via FFT of the zero-padded signal.
      for (let i = 0; i < n; i++) { re[i] = buf[i]; im[i] = 0; }
      re.fill(0, n); im.fill(0, n);
      fft(re, im, false);
      for (let i = 0; i < fftSize; i++) {
        const p = re[i] * re[i] + im[i] * im[i];
        re[i] = p; im[i] = 0;
      }
      fft(re, im, true); // re[tau] is now r(tau)

      // NSDF(tau) = 2*r(tau) / m(tau), with m(tau) computed incrementally:
      // m(tau) = sum_{j=0}^{n-1-tau} (x[j]^2 + x[j+tau]^2)
      let m = 2 * re[0];
      nsdf[0] = 1;
      for (let tau = 1; tau <= tauMax; tau++) {
        m -= buf[tau - 1] * buf[tau - 1] + buf[n - tau] * buf[n - tau];
        nsdf[tau] = m > 0 ? (2 * re[tau]) / m : 0;
      }

      // Key-maximum picking: one candidate per region between a positive-going
      // and the following negative-going zero crossing.
      // Parabolic interpolation of an integer-lag peak: refines both the lag
      // and the peak value. Matters most at short lags (high notes), where the
      // integer NSDF badly undersamples narrow peaks.
      function interpolate(t) {
        if (t > 1 && t < tauMax) {
          const a = nsdf[t - 1], b = nsdf[t], c = nsdf[t + 1];
          const denom = a - 2 * b + c;
          if (denom < 0) { // proper maximum
            const dt = (0.5 * (a - c)) / denom;
            return { tau: t + dt, val: b - 0.25 * (a - c) * dt };
          }
        }
        return { tau: t, val: nsdf[t] };
      }

      let bestVal = -1;
      const peaks = [];
      let tau = 1;
      // Skip the zero-lag lobe: scan from tau=1 to its negative-going crossing.
      while (tau <= tauMax && nsdf[tau] > 0) tau++;
      while (tau <= tauMax) {
        while (tau <= tauMax && nsdf[tau] <= 0) tau++; // find rise above zero
        let peakTau = -1, peakVal = 0;
        while (tau <= tauMax && nsdf[tau] > 0) {
          if (tau >= tauMin && nsdf[tau] > peakVal) { peakVal = nsdf[tau]; peakTau = tau; }
          tau++;
        }
        if (peakTau > 0) {
          const p = interpolate(peakTau);
          peaks.push(p);
          if (p.val > bestVal) bestVal = p.val;
        }
      }
      if (bestVal < (opts.clarityGate !== undefined ? opts.clarityGate : 0.6)) {
        return null;
      }

      // First peak within kThreshold of the global max wins (avoids octave errors).
      let chosen = peaks[0];
      for (let i = 0; i < peaks.length; i++) {
        if (peaks[i].val >= kThreshold * bestVal) { chosen = peaks[i]; break; }
      }

      const frequency = sampleRate / chosen.tau;
      if (frequency < minFreq || frequency > maxFreq) return null;
      return { frequency, clarity: Math.min(1, chosen.val), rms };
    }

    return { detect, windowSize: n, sampleRate };
  }

  // ---- Note math ------------------------------------------------------------

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  /** Continuous MIDI value (69 = A4 at the given reference). */
  function freqToMidi(freq, a4) {
    return 69 + 12 * Math.log2(freq / (a4 || 440));
  }

  function midiToFreq(midi, a4) {
    return (a4 || 440) * Math.pow(2, (midi - 69) / 12);
  }

  /** Nearest note plus signed cents deviation. */
  function freqToNote(freq, a4) {
    const midi = freqToMidi(freq, a4);
    const nearest = Math.round(midi);
    return {
      midi: nearest,
      name: NOTE_NAMES[((nearest % 12) + 12) % 12],
      octave: Math.floor(nearest / 12) - 1,
      cents: (midi - nearest) * 100,
      exactMidi: midi,
    };
  }

  return { createDetector, freqToNote, freqToMidi, midiToFreq, NOTE_NAMES };
});
