#!/usr/bin/env python3
"""Per-bin loudness profile of a wav or mp4: overall, mid band, presence, low band (TOOLING c27; from ACCELERATE builder B's prof.py).

    python3 videos/tools/audio_profile.py out/.intelligence2.wav [--bin 2] [--band 250-6000]
Columns (dB re full scale, RMS per bin): all, mid (default 250 Hz-6 kHz), pres (2-6 kHz), low (<200 Hz); the last line is
the whole file. A readout to find where things are; how the mix sounds, on a phone or anywhere, is heard. mp4 is read via ffmpeg.
"""
import argparse
import os
import subprocess
import sys
import tempfile

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

ap = argparse.ArgumentParser()
ap.add_argument('src')
ap.add_argument('--bin', type=float, default=2)
ap.add_argument('--band', '--phone', dest='band', default='250-6000')
a = ap.parse_args()
src, tmp = a.src, None
if not src.lower().endswith('.wav'):
    tmp = tempfile.mktemp(suffix='.wav')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-vn', '-ac', '1', '-ar', '44100', tmp], check=True)
    src = tmp
try:
    sr, x = wavfile.read(src)
finally:
    if tmp and os.path.exists(tmp):
        os.remove(tmp)
x = x.astype(np.float32) / (32768 if x.dtype == np.int16 else 1)
if x.ndim == 2:
    x = x.mean(1)
lo, hi = [float(v) for v in a.band.split('-')]
bp = lambda l, h: sosfilt(butter(4, [l, min(h, sr / 2 - 100)], 'bandpass', fs=sr, output='sos'), x)
ph, pres = bp(lo, hi), bp(2000, 6000)
low = sosfilt(butter(4, 200, 'low', fs=sr, output='sos'), x)
db = lambda y: 20 * np.log10(np.sqrt(np.mean(y ** 2)) + 1e-9)
n = int(a.bin * sr)
print('t      all    mid  pres   low')
for i in range(0, len(x) - n + 1, n):
    s = slice(i, i + n)
    print('%5.1f %5.1f %6.1f %5.1f %5.1f' % (i / sr, db(x[s]), db(ph[s]), db(pres[s]), db(low[s])))
print('whole: all %.1f mid %.1f pres %.1f low %.1f' % (db(x), db(ph), db(pres), db(low)))
