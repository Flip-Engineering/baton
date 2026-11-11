#!/usr/bin/env python3
"""tone_drift.py: the piece's colour, second by second, as a readout and a strip to look at.

Per second of a video: warmth (mean R-B, -100..+100), cast (the hue of the frame's mean colour, as a word),
chroma and luma, and the halves side by side. Descriptive: whether a piece keeps one colour world, or shifts it on
purpose, is the director's call on the strip and the piece.

  python3 videos/tools/tone_drift.py out/farm/ironhot_share.mp4 [--png strip.png] [--ref-first 12]
  python3 videos/tools/tone_drift.py --selftest

--ref-first S : the opening is the first S seconds (default 12); its commonest cast and warmth range are printed for
reference. Reads at 4 fps, 90x160, one ffmpeg pass.
"""
import argparse, colorsys, os, shutil, subprocess, sys
import numpy as np

def _ffmpeg():
    for p in (os.environ.get('ACP_FFMPEG'), shutil.which('ffmpeg')):
        if p and os.path.exists(p):
            return p
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        raise SystemExit('tone_drift: no ffmpeg (set ACP_FFMPEG)')

W, H, FPS = 90, 160, 4

def decode(path):
    cmd = [_ffmpeg(), '-v', 'error', '-i', path, '-vf', f'fps={FPS},scale={W}:{H}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    n = len(raw) // (W * H * 3)
    return np.frombuffer(raw[:n * W * H * 3], np.uint8).reshape(n, H, W, 3)

WORDS = [(15, 'red'), (45, 'orange'), (70, 'amber'), (160, 'green'), (200, 'teal'), (255, 'blue'), (290, 'purple'), (345, 'magenta'), (361, 'red')]

def cast_word(rgb):
    h, s, v = colorsys.rgb_to_hsv(*(float(c) / 255 for c in rgb))
    if s < 0.08 or v < 0.06:
        return 'neutral'
    d = h * 360
    for lim, w in WORDS:
        if d < lim:
            return w
    return 'red'

def per_second(arr):
    rows = []
    for s in range(len(arr) // FPS):
        f = arr[s * FPS:(s + 1) * FPS].astype(np.float32)
        m = f.reshape(-1, 3).mean(0)
        warm = float((f[..., 0] - f[..., 2]).mean() / 255 * 100)
        chroma = float((f.max(-1) - f.min(-1)).mean())
        luma = float((0.2126 * f[..., 0] + 0.7152 * f[..., 1] + 0.0722 * f[..., 2]).mean())
        rows.append(dict(t=s, warm=warm, chroma=chroma, luma=luma, cast=cast_word(m), rgb=tuple(int(x) for x in m)))
    return rows

def analyse(rows, ref_first=12):
    ref = rows[:max(2, ref_first)]
    wmin = min(r['warm'] for r in ref)
    words = [r['cast'] for r in ref]
    base = max(set(words), key=words.count)
    half = len(rows) // 2
    def avg(rs, k): return sum(r[k] for r in rs) / max(1, len(rs))
    return dict(base=base, wmin=wmin, first=rows[:half], second=rows[half:], avg=avg)

def report(rows, a):
    out = [f"opening cast {a['base']}, opening warmth min {a['wmin']:+.0f}"]
    for name, rs in (('first half', a['first']), ('second half', a['second'])):
        out.append(f"{name:12s} warmth {a['avg'](rs,'warm'):+6.1f}  chroma {a['avg'](rs,'chroma'):5.1f}  luma {a['avg'](rs,'luma'):5.1f}  casts " +
                   ','.join(f'{w}{sum(1 for r in rs if r["cast"]==w)}' for w in sorted({r['cast'] for r in rs})))
    out.append(' t   warm chroma luma cast')
    for r in rows:
        out.append(f"{r['t']:3d} {r['warm']:+5.0f} {r['chroma']:5.0f} {r['luma']:5.0f}  {r['cast']}")
    return '\n'.join(out)

def strip_png(rows, path, cell=12):
    from PIL import Image
    im = Image.new('RGB', (len(rows) * cell, cell * 2), (0, 0, 0))
    px = im.load()
    for i, r in enumerate(rows):
        wv = int(max(0, min(255, 128 + r['warm'] * 2.5)))
        for x in range(cell):
            for y in range(cell): px[i * cell + x, y] = r['rgb']
            for y in range(cell, cell * 2): px[i * cell + x, y] = (wv, 90, 255 - wv)
    im.save(path)

def selftest():
    warm = np.zeros((4 * 20, H, W, 3), np.uint8); warm[...] = (200, 120, 60)
    cold = np.zeros((4 * 10, H, W, 3), np.uint8); cold[...] = (60, 80, 200)
    rows = per_second(np.concatenate([warm, cold])); a = analyse(rows, 12)
    assert a['base'] == 'orange', a['base']
    assert rows[25]['warm'] < 0 < rows[5]['warm'] and rows[25]['cast'] != 'orange', rows[25]
    assert 'second half' in report(rows, a)
    print('tone_drift selftest ok'); return 0

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('video', nargs='?'); ap.add_argument('--png'); ap.add_argument('--ref-first', type=int, default=12)
    ap.add_argument('--selftest', action='store_true'); A = ap.parse_args()
    if A.selftest: return selftest()
    if not A.video: ap.error('video required')
    rows = per_second(decode(A.video)); a = analyse(rows, A.ref_first)
    print(report(rows, a))
    if A.png: strip_png(rows, A.png); print('strip:', A.png)
    return 0

if __name__ == '__main__':
    sys.exit(main())
