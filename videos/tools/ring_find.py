#!/usr/bin/env python3
"""Find bells and pitched rings in audio: narrow spectral lines that stand out from their neighbours (TOOLING c29; from the HORDE v18 review).

    python3 videos/tools/ring_find.py FILE.wav|.mp4|.mp3 [--from S] [--to S] [--min-db 10] [--fmin 600] [--fmax 8000] [--top 8] [--csv]
    python3 videos/tools/ring_find.py --selftest

Why. HORDE v18 swapped forge samples for a real locomotive take and varispeed hammers; the director then found, by hand, a 1.93 kHz line
repeating every 0.8 s and hammer rings at 1.7/2.45/3.5 kHz. Band meters (audio_profile.py) do not see a narrow line. Run this on a
CANDIDATE SAMPLE before it goes in a song, and on the finished .wav (out/.X.wav) before rendering.

How. STFT (8192-point, 50% overlap, ~5.9 Hz bins at 48 kHz; a hit must last 2+ frames). For each frame and bin, prominence = bin level minus the median level of
neighbours 40-150 Hz either side (a line is narrow; a band of noise is not). A bin is a ring when prominence >= --min-db (default 10 dB)
and it is in the frame's top quarter by level. Lines are grouped by frequency (within 3%), and per line we report: seconds present, the
span, strikes per second (onsets of the line: absent-to-present), the median spacing between strikes, peak prominence and where it peaks.
Output: how many lines were found, the --top lines by weight with when they strike, and with --csv one row per line. Always exits 0:
it lists what is there and never judges it. A brass note, a sung chant or a bowed drone are lines too, and wanted ones: listen.
Reading it: a bell is a line that repeats (strikes/s 1-3) and stands well out; a held whine or hum is present much of the time with no strikes.
Limits: it hears pitch, not timbre (a dull bell with a smeared line can pass; run `ears` for that); a sample varispeeded after this check
has its lines moved, so check the processed output. mp4 is read via ffmpeg.
"""
import argparse, os, subprocess, sys, tempfile
import numpy as np
from scipy.io import wavfile
from scipy.signal import stft


def _ffmpeg():
    """System ffmpeg if there is one, else the imageio_ffmpeg binary (c35: ring_find failed on an mp4 where no system ffmpeg exists)."""
    import shutil
    f = shutil.which('ffmpeg')
    if f: return f
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        raise SystemExit('no ffmpeg on PATH and imageio_ffmpeg is not installed')


def load(src):
    if not src.lower().endswith('.wav'):
        t = tempfile.mktemp(suffix='.wav')
        subprocess.run([_ffmpeg(), '-v', 'error', '-y', '-i', src, '-vn', '-ac', '1', '-ar', '48000', t], check=True)
        sr, x = wavfile.read(t); os.remove(t)
    else:
        sr, x = wavfile.read(src)
    x = x.astype(np.float64)
    if x.dtype.kind != 'f' or np.abs(x).max() > 2: x = x / (32768.0 if np.abs(x).max() > 2 else 1.0)
    if x.ndim > 1: x = x.mean(axis=1)
    return sr, x


def find(sr, x, t0=0, t1=None, min_db=10.0, fmin=600, fmax=8000, gate_db=None):
    x = x[int(t0 * sr): int((t1 if t1 else len(x) / sr) * sr)]
    nper = 8192
    f, t, Z = stft(x, sr, nperseg=nper, noverlap=nper // 2, window='hann')
    P = 20 * np.log10(np.abs(Z) + 1e-9)
    df = f[1]
    lo, hi = np.searchsorted(f, fmin), np.searchsorted(f, fmax)
    n_near, n_far = max(2, int(40 / df)), int(150 / df)
    # neighbour median via offsets, excluding the +-40 Hz core
    offs = list(range(-n_far, -n_near + 1)) + list(range(n_near, n_far + 1))
    prom = np.full((hi - lo, P.shape[1]), -99.0)
    for i in range(lo, hi):
        nb = np.stack([P[i + o] for o in offs if 0 <= i + o < P.shape[0]])
        prom[i - lo] = P[i] - np.median(nb, axis=0)
    band = P[lo:hi]
    thr = np.percentile(band, 75, axis=0)
    hit = (prom >= min_db) & (band >= thr)
    if gate_db is not None:  # c32: ignore near-silent frames (a stem's noise floor gives huge 'prominence'): frame power in the search band vs the loudest frame
        fp = 10 * np.log10((10 ** (band / 10)).sum(axis=0) + 1e-18)
        hit &= (fp >= fp.max() - gate_db)[None, :]
    h2 = hit.copy(); h2[:, 1:-1] = hit[:, 1:-1] & (hit[:, :-2] | hit[:, 2:]); h2[:, 0] = False; h2[:, -1] = False
    hit = h2  # a ring lasts at least two frames; a noise fluctuation in one bin does not
    # local maxima across frequency only
    pk = np.zeros_like(hit)
    pk[1:-1] = hit[1:-1] & (prom[1:-1] >= prom[:-2]) & (prom[1:-1] >= prom[2:])
    lines = []
    freqs = f[lo:hi]
    for i in np.where(pk.any(axis=1))[0]:
        lines.append((freqs[i], pk[i], prom[i]))
    lines.sort(key=lambda a: a[0])
    groups = []
    for fr, p, pr in lines:
        if groups and fr <= groups[-1]['f'] * 1.03:
            g = groups[-1]; g['p'] |= p; g['pr'] = np.maximum(g['pr'], pr * p + (-99 * ~p)); g['fs'].append(fr)
        else:
            groups.append({'f': fr, 'p': p.copy(), 'pr': np.where(p, pr, -99.0), 'fs': [fr]})
    hop = t[1] - t[0] if len(t) > 1 else 1
    out = []
    for g in groups:
        p = g['p']
        # bridge one-frame gaps so a single ring is one strike
        pb = p.copy(); pb[1:-1] |= p[:-2] & p[2:]
        on = np.where(pb[1:] & ~pb[:-1])[0] + 1
        if pb[0]: on = np.r_[0, on]
        frac = p.mean()
        pk_i = int(np.argmax(g['pr']))
        sp = float(np.median(np.diff(t[on]))) if len(on) >= 2 else 0.0
        steady = len(on) >= 3 and np.std(np.diff(t[on])) < 0.25 * max(sp, 1e-6)
        out.append(dict(hz=float(np.mean(g['fs'])), frac=float(frac), secs=float(p.sum() * hop), strikes=int(len(on)),
                                                spacing=sp, steady=bool(steady), prom=float(g['pr'].max()), at=float(t0 + t[pk_i]),
                        first=float(t0 + t[np.where(p)[0][0]]), last=float(t0 + t[np.where(p)[0][-1]])))
    out.sort(key=lambda d: -(d['frac'] * d['prom']))
    return out


def lasting(lines):
    """The lines that last (present in 4% of frames, or striking 3+ times at a steady spacing, for 0.4 s or more): a detection
    setting for the listing and the selftest, not a verdict on the mix."""
    return [l for l in lines if (l['frac'] >= 0.04 and l['secs'] >= 0.4) or (l['steady'] and l['strikes'] >= 3 and l['secs'] >= 0.4)]


def selftest():
    sr = 48000; n = sr * 6
    rng = np.random.default_rng(1)
    x = rng.normal(0, 0.05, n)
    for k in range(7):  # bell: 1930 Hz ping every 0.8 s, 0.5 s decay
        s = int((0.5 + 0.8 * k) * sr); m = int(0.5 * sr); tt = np.arange(m) / sr
        x[s:s + m] += 0.3 * np.sin(2 * np.pi * 1930 * tt) * np.exp(-tt * 6)
    r = find(sr, x)
    ok1 = bool(lasting(r)) and any(abs(l['hz'] - 1930) < 40 and l['strikes'] >= 5 and l['steady'] for l in r)
    y = rng.normal(0, 0.05, n)  # noise only
    ok2 = not lasting(find(sr, y))
    # filtered noise band (wide) must not read as a ring
    from scipy.signal import butter, sosfilt
    z = sosfilt(butter(4, [1500, 2500], 'bp', fs=sr, output='sos'), rng.normal(0, 0.2, n))
    ok3 = not lasting(find(sr, z + rng.normal(0, 0.02, n)))
    print('bell found at 1930 Hz, steady:', ok1, '| no line in noise:', ok2, '| no line in a wide band:', ok3)
    return 0 if ok1 and ok2 and ok3 else 1


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('src', nargs='?'); ap.add_argument('--from', dest='t0', type=float, default=0); ap.add_argument('--to', type=float)
    ap.add_argument('--min-db', type=float, default=10); ap.add_argument('--fmin', type=float, default=600)
    ap.add_argument('--fmax', type=float, default=8000); ap.add_argument('--top', type=int, default=8)
    ap.add_argument('--csv', action='store_true'); ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()
    if a.selftest: sys.exit(selftest())
    if not a.src: ap.error('file or --selftest')
    sr, x = load(a.src)
    L = find(sr, x, a.t0, a.to, a.min_db, a.fmin, a.fmax)
    if a.csv:
        print('hz,frac,secs,strikes,spacing,steady,prom_db,first,last')
        for l in L: print(f"{l['hz']:.0f},{l['frac']:.3f},{l['secs']:.2f},{l['strikes']},{l['spacing']:.2f},{int(l['steady'])},{l['prom']:.1f},{l['first']:.2f},{l['last']:.2f}")
    else:
        print(f'ring_find: {len(L)} lines >= {a.min_db:g} dB prominence, {a.fmin:g}-{a.fmax:g} Hz ({len(lasting(L))} that last); listen to them')
        for l in L[:a.top]:
            print(f"  {l['hz']:7.0f} Hz  present {l['frac']*100:4.1f}% ({l['secs']:.1f}s)  strikes {l['strikes']:3d}"
                  + (f", every {l['spacing']:.2f}s{' steady' if l['steady'] else ''}" if l['strikes'] >= 2 else '')
                  + f"  prom {l['prom']:.0f} dB (peak at {l['at']:.1f}s)  {l['first']:.1f}-{l['last']:.1f}s")
    sys.exit(0)   # a report, never a pass/fail: a tonal instrument playing a note is a 'line' too (the client, 2 Oct)
