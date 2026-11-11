#!/usr/bin/env python3
"""Low band A/B (TOOLING R1): what the engine's opt-in dynamic low band (low_guard; a song's master={'low_share': x})
does to a file at a setting you choose, written out to listen to. There is no target: the setting is the builder's, by ear.

  python3 videos/tools/low_guard.py FILE [FILE ...] --target 0.55 [--max-db 6] [--write OUT.wav]
  python3 videos/tools/low_guard.py --selftest

FILE: a song wav (out/.<scene>.wav) or any video (decoded by ffmpeg at 44.1 kHz). Prints the low-end share (energy under
250 Hz) of the whole file and its heaviest 4 s window, as a readout, before and after low_guard, with its cut and the
loudness change. --write saves the processed audio for a listening A/B (the real setting lives in the song's master config).
"""
import argparse
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from engine import audio  # noqa: E402


def load(path):
    if path.endswith('.wav'):
        from scipy.io import wavfile
        sr, x = wavfile.read(path)
        x = x.astype(float) / (32768.0 if x.dtype == np.int16 else 2147483648.0 if x.dtype == np.int32 else 1.0)
        if sr != audio.SR:
            from scipy.signal import resample_poly
            x = resample_poly(x, audio.SR, sr, axis=0)
        return x if x.ndim == 2 else np.stack([x, x], 1)
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vn', '-ac', '2', '-ar', str(audio.SR), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2).astype(float)


def report(tag, x):
    w = audio.low_share_windows(x)
    t, s = max(w, key=lambda r: r[1])
    print(f'  {tag:<7} low-end share: whole {audio.low_share(x):.1%}, heaviest 4 s {s:.1%} at {t:.0f} s;  {audio.lufs(x):.1f} LUFS')


def selftest():
    sr, n = audio.SR, audio.SR * 12
    t = np.arange(n) / sr
    rng = np.random.default_rng(1)
    kick = np.zeros(n)
    for b in np.arange(0, 12, 0.5):                       # 120 BPM, a 55 Hz 808 on every beat
        i = int(b * sr)
        k = np.arange(min(int(0.4 * sr), n - i)) / sr
        kick[i:i + len(k)] += np.sin(2 * np.pi * 55 * k) * np.exp(-k * 6)
    top = audio.sfilt(rng.standard_normal(n), 'high', 800, 2) * 0.2
    boom = np.where(t < 4, 0.25, 1.0)                     # quiet intro, then a heavy drop
    x = np.stack([kick * boom + top] * 2, 1)
    y, st = audio.low_guard(x, target=0.55)
    intro_b, intro_a = audio.low_share(x[: 4 * sr]), audio.low_share(y[: 4 * sr])
    print('selftest', st, f'intro {intro_b:.3f} -> {intro_a:.3f}')
    assert st['worst_after'] < st['worst_before'], st                       # the processing does what it says
    assert abs(intro_a - intro_b) < 0.02, 'a window already under the setting is untouched'
    assert np.allclose(audio.low_guard(top[:, None].repeat(2, 1), target=0.55)[0], top[:, None].repeat(2, 1), atol=1e-9)
    y2, st2 = audio.master(x, low_share=0.55, plan=None)
    print('master  ', st2['low_guard'], 'final', f'{audio.low_share(y2):.3f}')
    assert audio.low_share(y2) < audio.low_share(audio.master(x, plan=None)[0])
    print('selftest ok')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('files', nargs='*')
    ap.add_argument('--target', type=float, help='the low_guard setting to try (your choice, by ear)')
    ap.add_argument('--max-db', type=float, default=6.0)
    ap.add_argument('--write')
    ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if a.files and a.target is None:
        ap.error('--target: the setting to try (there is no default)')
    for f in a.files:
        x = load(f)
        print(f)
        report('as is', x)
        y, st = audio.low_guard(x, target=a.target, max_db=a.max_db)
        report('guarded', y)
        print(f'  low_guard cut: max {st["cut_db_max"]} dB, mean {st["cut_db_mean"]} dB (before loudness re-normalise)')
        if a.write:
            from scipy.io import wavfile
            wavfile.write(a.write, audio.SR, (np.clip(y, -1, 1) * 32767).astype(np.int16))


if __name__ == '__main__':
    main()
