#!/usr/bin/env python3
"""Audio moments: interior gaps, the end tail, and the notes sounding at a time (TOOLING c31).

    python3 videos/tools/audio_moment.py FILE [--gaps] [--tail] [--at 23.4-25.0 ...] [--section 12.8-23 ...]
    python3 videos/tools/audio_moment.py --selftest
FILE is a wav or mp4 (ffmpeg). With no flags it does gaps and tail.
--gaps    every stretch where the whole-mix level (20 ms RMS) falls under --floor dB (default -50) for >= --min s
          (default 0.12), with start/end and the level either side; the first and last 0.3 s are ignored. Meant to
          catch a silence nobody asked for (MELTDOWN v15: a 0.25 s hole at 36.5 s that the chord then cut across).
--tail    where the sound ends: time the level last stays above -40 dB, and the length of the final fade (time from
          -3 dB under the last held level to -40 dB). A fade of ~0.6 s is the finishing stage's hang.
--at A-B  (repeatable) the notes in that window: the 12 pitch classes (folded from 40-4000 Hz, tonal peaks only) in dB
          below the loudest, the strongest as the root guess and the third (major/minor/none), so a person can check the
          chord by ear. Root = strongest class unless --root NAME (C, F#, ...) is given.
          Then the partials that beat (MUSIC c14): the pitch-class fold says which notes are there, not how they sound
          together; partials of different notes 20-60 Hz apart beat whatever their names. It lists the pairs among the 40
          strongest spectral peaks (40-5000 Hz) that beat hardest, with their beat rates (Plomp-Levelt / Sethares), as
          information. Whether a chord is rough, or bright, is heard.
--section A-B  (repeatable) mean level, peak level and the loudest 0.4 s of the window, as a plain readout.
Levels are dB re full scale. Reads only; touches nothing.
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np

PROM = 1e-2  # peak prominence vs the loudest bin; lower picks up noise as notes
NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


def load(path):
    from scipy.io import wavfile
    tmp = None
    if not path.lower().endswith('.wav'):
        tmp = tempfile.mktemp(suffix='.wav')
        ff = shutil.which('ffmpeg')
        if not ff:
            try:
                import imageio_ffmpeg
                ff = imageio_ffmpeg.get_ffmpeg_exe()
            except Exception:
                raise SystemExit('no ffmpeg on PATH (and no imageio_ffmpeg); pass a wav')
        subprocess.run([ff, '-v', 'error', '-y', '-i', path, '-vn', '-ac', '1', '-ar', '44100', tmp], check=True)
        path = tmp
    try:
        sr, x = wavfile.read(path)
    finally:
        if tmp and os.path.exists(tmp):
            os.remove(tmp)
    x = x.astype(np.float32) / (32768 if x.dtype == np.int16 else 1)
    if x.ndim == 2:
        x = x.mean(1)
    return sr, x


def env_db(x, sr, win=0.02):
    n = max(1, int(win * sr))
    m = len(x) // n
    r = np.sqrt((x[:m * n].reshape(m, n) ** 2).mean(1))
    return 20 * np.log10(r + 1e-9), n / sr


def find_gaps(x, sr, floor=-50, minlen=0.12, edge=0.3):
    e, dt = env_db(x, sr)
    out, i = [], 0
    while i < len(e):
        if e[i] < floor:
            j = i
            while j < len(e) and e[j] < floor:
                j += 1
            t0, t1 = i * dt, j * dt
            if t1 - t0 >= minlen and t0 > edge and t1 < len(x) / sr - edge:
                a = e[max(0, i - 10):i].mean() if i else float('nan')
                b = e[j:j + 10].mean() if j < len(e) else float('nan')
                out.append((t0, t1, a, b))
            i = j
        else:
            i += 1
    return out


def tail(x, sr):
    e, dt = env_db(x, sr, 0.05)
    live = np.where(e > -40)[0]
    if not len(live):
        return None
    last = live[-1]
    held = np.percentile(e[max(0, last - 120):last + 1], 90)
    k = last
    while k > 0 and e[k] < held - 3:
        k -= 1
    return last * dt, (last - k) * dt, held


def pitch_classes(x, sr, t0, t1):
    seg = x[int(t0 * sr):int(t1 * sr)]
    if len(seg) < 4096:
        raise SystemExit('window too short')
    N = 1 << int(np.ceil(np.log2(len(seg))))
    sp = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), N)) ** 2
    f = np.fft.rfftfreq(N, 1 / sr)
    band = (f >= 40) & (f <= 4000)
    # tonal peaks only: local maxima well above the local median
    from scipy.signal import find_peaks
    pk, _ = find_peaks(sp, prominence=sp[band].max() * PROM)
    pk = [p for p in pk if band[p]]
    pc = np.zeros(12)
    for p in pk:
        midi = 69 + 12 * np.log2(f[p] / 440)
        k = int(round(midi)) % 12
        if abs(midi - round(midi)) < 0.35:
            pc[k] += sp[p]
    pc_db = 10 * np.log10(pc / (pc.max() + 1e-30) + 1e-9)
    return pc_db


def chord_report(pc_db, root=None):
    r = NOTES.index(root) if root else int(np.argmax(pc_db))
    rel = lambda s: pc_db[(r + s) % 12]
    third = 'major' if rel(4) > rel(3) + 3 else 'minor' if rel(3) > rel(4) + 3 else 'ambiguous/none'
    lines = ['root %s, third: %s (maj %.1f, min %.1f dB)' % (NOTES[r], third, rel(4), rel(3))]
    lines.append(' '.join('%s%s%.0f' % (NOTES[(r + s) % 12], '*' if s == 0 else '', rel(s)) for s in range(12)))
    return lines


def roughness_report(x, sr, t0, t1, n=40):
    from scipy.signal import find_peaks
    seg = x[int(t0 * sr):int(t1 * sr)]
    N = 1 << int(np.ceil(np.log2(max(len(seg), 16384))))
    X = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), N))
    f = np.fft.rfftfreq(N, 1 / sr)
    band = (f >= 40) & (f <= 5000)
    pk, _ = find_peaks(np.where(band, X, 0), distance=max(2, int(6 / (f[1] - f[0]))))
    pk = pk[np.argsort(-X[pk])][:n]
    F, A = f[pk], X[pk] / (X[pk].max() + 1e-12)
    A = A / np.sqrt((A ** 2).sum() + 1e-12)
    pairs = []
    for i in range(len(F)):
        for j in range(i + 1, len(F)):
            lo, hi = min(F[i], F[j]), max(F[i], F[j])
            s_ = 0.24 / (0.021 * lo + 19.0)
            d = A[i] * A[j] * (np.exp(-3.5 * s_ * (hi - lo)) - np.exp(-5.75 * s_ * (hi - lo)))
            pairs.append((d, lo, hi))
    pairs.sort(reverse=True)
    nm = lambda fr: '%s%d%+.0fc' % (NOTES[int(round(69 + 12 * np.log2(fr / 440))) % 12], int(round(69 + 12 * np.log2(fr / 440))) // 12 - 1,
                                     100 * (69 + 12 * np.log2(fr / 440) - round(69 + 12 * np.log2(fr / 440))))
    worst = '; '.join('%s/%s beating %.0f Hz' % (nm(a), nm(b), b - a) for d, a, b in pairs[:3] if d > 1e-4)
    return 'partials that beat (Plomp-Levelt over the %d strongest peaks; information, listen to it): %s' % (
        len(F), worst or 'none to speak of')


def section(x, sr, t0, t1):
    seg = x[int(t0 * sr):int(t1 * sr)]
    db = lambda y: 20 * np.log10(np.sqrt(np.mean(y ** 2)) + 1e-9)
    w = int(0.4 * sr)
    best, bt = -999, t0
    for i in range(0, max(1, len(seg) - w), w // 4):
        v = db(seg[i:i + w])
        if v > best:
            best, bt = v, t0 + i / sr
    return db(seg), 20 * np.log10(np.abs(seg).max() + 1e-9), best, bt


def rng(s):
    a, b = s.split('-')
    return float(a), float(b)


def selftest():
    sr = 44100
    t = np.arange(int(sr * 6)) / sr
    x = 0.3 * np.sin(2 * np.pi * 110 * t)
    x[int(2.0 * sr):int(2.3 * sr)] = 0
    x *= np.clip((6 - t) / 0.6, 0, 1)
    g = find_gaps(x, sr)
    assert len(g) == 1 and abs(g[0][0] - 2.0) < 0.05 and abs(g[0][1] - 2.3) < 0.05, g
    tl = tail(x, sr)
    assert tl and 0.3 < tl[1] < 0.8, tl
    A = 220.0
    maj = sum(np.sin(2 * np.pi * A * m * t) for m in (1, 2 ** (7 / 12), 2 ** (4 / 12)))
    pc = pitch_classes(0.2 * maj, sr, 0.5, 1.5)
    assert NOTES[int(np.argmax(pc))] in ('A', 'E', 'C#') and 'major' in chord_report(pc, 'A')[0], chord_report(pc)
    harm = lambda f0: sum(0.6 ** k * np.sin(2 * np.pi * f0 * (k + 1) * t) for k in range(6))
    B = 440.0
    triad = harm(B) + harm(B * 2 ** (4 / 12)) + harm(B * 2 ** (7 / 12))
    clus = harm(B) + harm(B * 2 ** (1 / 12)) + harm(B * 2 ** (6 / 12))
    assert 'beating' in roughness_report(0.1 * clus, sr, 0.5, 1.5), roughness_report(0.1 * clus, sr, 0.5, 1.5)
    assert roughness_report(0.1 * triad, sr, 0.5, 1.5).startswith('partials that beat')
    print('selftest ok')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('src', nargs='?')
    ap.add_argument('--gaps', action='store_true')
    ap.add_argument('--tail', action='store_true')
    ap.add_argument('--at', action='append', default=[])
    ap.add_argument('--section', action='append', default=[])
    ap.add_argument('--root')
    ap.add_argument('--floor', type=float, default=-50)
    ap.add_argument('--min', type=float, default=0.12)
    ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()
    if a.selftest:
        selftest()
        sys.exit(0)
    if not a.src:
        ap.error('FILE required')
    sr, x = load(a.src)
    if not (a.gaps or a.tail or a.at or a.section):
        a.gaps = a.tail = True
    print('%s: %.2f s' % (a.src, len(x) / sr))
    if a.gaps:
        g = find_gaps(x, sr, a.floor, a.min)
        print('interior gaps under %.0f dB (>= %.2f s): %s' % (a.floor, a.min, 'none' if not g else ''))
        for t0, t1, p, q in g:
            print('  %.2f-%.2f s (%.2f s), level before %.1f dB, after %.1f dB' % (t0, t1, t1 - t0, p, q))
    if a.tail:
        r = tail(x, sr)
        print('tail: ' + ('none' if r is None else 'sound ends %.2f s, final fade %.2f s from held %.1f dB%s' % (
            r[0], r[1], r[2], ' (a deliberate hang, not a cut)' if r[1] > 0.3 else ' (clean cut)')))
    for s in a.at:
        t0, t1 = rng(s)
        print('notes %.2f-%.2f s' % (t0, t1))
        for l in chord_report(pitch_classes(x, sr, t0, t1), a.root):
            print('  ' + l)
        print('  ' + roughness_report(x, sr, t0, t1))
    for s in a.section:
        t0, t1 = rng(s)
        m, pk, lb, bt = section(x, sr, t0, t1)
        print('section %.1f-%.1f s: mean %.1f dB, peak %.1f dB, loudest 0.4 s %.1f dB at %.1f s' % (t0, t1, m, pk, lb, bt))
