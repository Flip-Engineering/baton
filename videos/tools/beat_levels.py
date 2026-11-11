#!/usr/bin/env python3
"""Per-beat loudness table, to find your way around a song (TOOLING c37).

    python3 videos/tools/beat_levels.py FILE --scene NAME | --bpm 150 [--sub 1] [--from B] [--to B]
        [--payoff B --build A-B] [--cues 42,60] [--hold-from B] [--csv OUT]
    python3 videos/tools/beat_levels.py --selftest
FILE is a wav or mp4 (mp4 via ffmpeg). --scene reads the bpm from out/.NAME.hits.json. --sub 2 = half-beat rows.
Columns: beat, RMS dB re full scale over that beat (mono sum), change from the row before, a bar.
Readout lines (each only when asked for):
  loudest      the loudest row, and whether it is the --payoff beat.
  payoff       --payoff B --build A-B: level of the payoff beat (loudest 1-beat window within B..B+1), and its difference
               from the mean and the loudest level of the build.
  cues         --cues b,b: each cue row's level beside the mean of the two rows before (the louder of the cue's row and
               the one after).
  ending       --hold-from B: rows from B to the end; least-squares slope in dB/s and the spread.
Reads only. It meters; whether a payoff arrives, a cue is heard or an ending holds is heard by listening.
"""
import argparse, json, os, subprocess, sys, tempfile
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), 'out')
FLOOR = -90.0


def load(src):
    from scipy.io import wavfile
    tmp = None
    if not src.lower().endswith('.wav'):
        tmp = tempfile.mktemp(suffix='.wav')
        import shutil
        ff = shutil.which('ffmpeg')
        if not ff:
            import imageio_ffmpeg
            ff = imageio_ffmpeg.get_ffmpeg_exe()
        subprocess.run([ff, '-v', 'error', '-y', '-i', src, '-vn', '-ac', '2', '-ar', '44100', tmp], check=True)
        src = tmp
    sr, x = wavfile.read(src)
    if tmp:
        os.remove(tmp)
    if x.dtype.kind in 'iu':
        x = x.astype(np.float64) / np.iinfo(x.dtype).max
    x = x.astype(np.float64)
    return sr, (x.mean(1) if x.ndim > 1 else x)


def levels(m, sr, bpm, sub=1, b0=0.0, b1=None):
    spb = 60.0 / bpm
    nb = len(m) / sr / spb
    b1 = nb if b1 is None else min(b1, nb)
    step = 1.0 / sub
    rows, b = [], b0
    while b + step <= b1 + 1e-9:
        s = m[int(b * spb * sr):int((b + step) * spb * sr)]
        d = 10 * np.log10(np.mean(s ** 2) + 1e-12) if len(s) else FLOOR
        rows.append((round(b, 4), max(float(d), FLOOR)))
        b += step
    return rows, spb


def payoff(rows, pb, build, sub):
    win = [d for b, d in rows if pb - 1e-9 <= b < pb + 1]
    bl = [d for b, d in rows if build[0] - 1e-9 <= b < build[1] - 1e-9]
    if not win or not bl:
        return None
    p, mean = max(win), 10 * np.log10(np.mean([10 ** (d / 10) for d in bl]))
    return p, p - mean, p - max(bl)


def cue_check(rows, cb):
    d = dict(rows)
    ks = sorted(d)
    prev = [d[k] for k in ks if cb - 2 - 1e-9 <= k < cb - 1e-9]
    at = [d[k] for k in ks if cb - 1e-9 <= k < cb + 1 - 1e-9]
    if not prev or not at:
        return None
    pm = 10 * np.log10(np.mean([10 ** (v / 10) for v in prev]))
    return max(at), max(at) - pm, pm


def ending(rows, spb, sub, hb):
    seg = [(b, d) for b, d in rows if b >= hb - 1e-9]
    if len(seg) < 2:
        return None
    t = np.array([b * spb for b, _ in seg]); y = np.array([d for _, d in seg])
    k = np.polyfit(t, y, 1)[0]
    span = t[-1] - t[0] + spb / sub
    return k, y.max() - y.min(), span


def selftest():
    sr, bpm = 8000, 120
    t = np.arange(int(sr * 16)) / sr
    x = 0.1 * np.sin(2 * np.pi * 220 * t)
    x[int(8 * .5 * sr):int(9 * .5 * sr)] *= 0.02
    x[int(10 * .5 * sr):int(11 * .5 * sr)] *= 4
    x[int(12 * .5 * sr):] *= np.exp(-(t[int(12 * .5 * sr):] - 6) * 2.2)
    rows, spb = levels(x, sr, bpm)
    assert abs(rows[0][1] - (-23.0)) < 0.2, rows[0]
    c = cue_check(rows, 8); assert c and c[1] < -6, c
    p = payoff(rows, 10, (4, 8), 1); assert p and p[1] > 10, p
    e = ending(rows, spb, 1, 12); assert e and e[0] < -1, e
    flat = [(float(b), -12.0) for b in range(12, 16)]
    assert abs(ending(flat, spb, 1, 12)[1]) < 1e-6
    print('selftest ok')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('src', nargs='?')
    ap.add_argument('--scene'); ap.add_argument('--bpm', type=float)
    ap.add_argument('--sub', type=int, default=1)
    ap.add_argument('--from', dest='b0', type=float, default=0.0); ap.add_argument('--to', dest='b1', type=float)
    ap.add_argument('--payoff', type=float); ap.add_argument('--build')
    ap.add_argument('--cues'); ap.add_argument('--hold-from', type=float)
    ap.add_argument('--csv'); ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if not a.src:
        ap.error('FILE needed')
    bpm = a.bpm
    if bpm is None and a.scene:
        bpm = json.load(open(os.path.join(OUT, f'.{a.scene}.hits.json')))['bpm']
    if not bpm:
        ap.error('give --bpm or --scene')
    sr, m = load(a.src)
    rows, spb = levels(m, sr, bpm, a.sub, a.b0, a.b1)
    top = max(d for _, d in rows)
    prev = None
    print(f'{os.path.basename(a.src)}  {len(m)/sr:.2f} s  {bpm:g} bpm  ({spb:.3f} s/beat)')
    for b, d in rows:
        bar = '#' * max(0, int((d + 50) / 50 * 40))
        print(f'b{b:7.2f}  {d:6.1f}  {"" if prev is None else f"{d-prev:+5.1f}"}  {bar}')
        prev = d
    lb, ld = max(rows, key=lambda r: r[1])
    print(f'loudest: b{lb:g} at {ld:.1f} dB' + (f'  ({"IS" if abs(lb-a.payoff)<1 else "is NOT"} the payoff beat b{a.payoff:g})' if a.payoff is not None else ''))
    if a.payoff is not None and a.build:
        b0, b1 = map(float, a.build.split('-'))
        p = payoff(rows, a.payoff, (b0, b1), a.sub)
        if p:
            print(f'payoff b{a.payoff:g}: {p[0]:.1f} dB, {p[1]:+.1f} against the build mean, {p[2]:+.1f} against its loudest beat')
    for c in (a.cues or '').split(','):
        if c.strip():
            r = cue_check(rows, float(c))
            print(f'cue b{c}: ' + (f'{r[0]:.1f} dB vs {r[2]:.1f} before ({r[1]:+.1f})' if r else 'out of range'))
    if a.hold_from is not None:
        e = ending(rows, spb, a.sub, a.hold_from)
        if e:
            print(f'ending from b{a.hold_from:g}: slope {e[0]:+.2f} dB/s, spread {e[1]:.1f} dB over {e[2]:.1f} s')
    if a.csv:
        open(a.csv, 'w').write('beat,db\n' + ''.join(f'{b},{d:.2f}\n' for b, d in rows))


if __name__ == '__main__':
    main()
