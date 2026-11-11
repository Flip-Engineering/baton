#!/usr/bin/env python3
"""FABRIC7 tile mosaic (blender/fabric7_tiles.py) measured on the real tiles of web/assets/fabric6/tiles: no Blender, nothing rendered.
   python3 videos/scripts/fabric7/test_tiles.py [--write measures/tiles7.md]
Per fabric: (1) the tone's per-warp-end share, (2) the period peak (power at the tile period 32 threads and its harmonics over the broadband mean of the per-end tone sequence along u: a periodic
tile is a spike, a mosaic is flat), (3) the largest autocorrelation of the per-end tone sequence at lags 8..120 threads (1.0 = exact repeat), (4) the weave stays in phase (red / green channels of
the mosaic equal the plain tiling's where the tile is exactly periodic), (5) the tone distribution is kept (mean, std), (6) for fibre tiles: the autocorrelation of the 16 px low-pass at lag 256 px.
No claim about how it LOOKS in Cycles: that is the farm's first denim crop."""
import os, sys, glob
import numpy as np
from PIL import Image
from scipy import ndimage
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'videos', 'blender'))
import fabric7_tiles as T
TILES = os.path.join(ROOT, 'videos', 'web', 'assets', 'fabric6', 'tiles')
ok = True
def check(c, what):
    global ok
    print(('ok   ' if c else 'FAIL ') + what); ok = ok and c

def load(f): return np.asarray(Image.open(f).convert('RGBA')).astype(np.float32) / 255.0

def per_end(a):
    """the per-warp-end tone sequence along u: column means of the tone channel, one value a thread"""
    return a[..., 2].mean(0).reshape(-1, T.THREAD_PX).mean(1)

def period_peak(seq, period=32):
    s = seq - seq.mean(); P = np.abs(np.fft.rfft(s)) ** 2; n = len(s)
    k0 = n // period; harm = [P[k] for k in range(k0, len(P), k0)]
    return float(np.sum(harm) / max(1e-12, np.sum(P[1:]) ) ), float(max(harm) / max(1e-12, np.median(P[1:])))

def max_ac(seq, lo=8, hi=120):
    s = seq - seq.mean(); v = (s * s).mean()
    return max(abs((s * np.roll(s, k)).mean() / v) for k in range(lo, hi + 1))

rows = []; md = ['| fabric | tile | tone per-end share | period share (tiled -> mosaic) | max autocorr lag 8-120 (tiled -> mosaic) | weave seam jump ratio (tiled -> mosaic) | tone std (tile -> mosaic) |', '|---|---|---|---|---|---|---|']
for f in sorted(glob.glob(os.path.join(TILES, '*_yarn.png'))):
    nm = os.path.basename(f)[:-9]; a = load(f); need = T.needs_yarn_mosaic(a)
    r = T.mosaic(a, 'yarn', nm)
    if not need:
        check(r is None, f'{nm}: periodic knit / flat-tone tile (tone std {a[..., 2].std():.4f}): no mosaic')
        continue
    mos, nb = r
    check(mos.shape == (nb * 256, nb * 256, 4) and mos.dtype == np.float32 and 0 <= mos.min() and mos.max() <= 1, f'{nm}: mosaic {mos.shape} float32 in 0..1')
    tiled = np.tile(a, (nb, nb, 1)); sc, sr = T.tone_shares(a)
    # a long strip of per-end tones: the tile repeated vs the mosaic's first block row
    st = per_end(tiled[:256]); sm = per_end(mos[:256])
    pt, _ = period_peak(st); pm, _ = period_peak(sm); at, am = max_ac(st), max_ac(sm)
    check(pt > 0.9 and pm < 0.5, f'{nm}: tone period share {pt:.2f} tiled -> {pm:.2f} mosaic' if sc > 0.3 else f'{nm}: (weak per-end tone, share {sc:.2f}) period share {pt:.2f} -> {pm:.2f}')
    if sc > 0.3: check(am < 0.6 and at > 0.99, f'{nm}: max per-end autocorr {at:.2f} tiled -> {am:.2f} mosaic')
    # weave phase: the jump of the red / green channels across block seams (every 256 px) against the jump between ordinary neighbouring columns, plain tiling vs mosaic
    def seam(x):
        d = np.abs(np.diff(x[..., :2], axis=1)).mean((0, 2)); idx = np.arange(1, x.shape[1]); at = (idx % 256) == 0; edge = (idx % T.THREAD_PX) == 0   # (thread edges, where the weave jumps anyway, are the ordinary ones)
        return float(d[at].mean() / max(1e-9, d[edge & ~at].mean()))
    st_, sm_ = seam(tiled), seam(mos); rpt = (T.detect_repeat(a, 0), T.detect_repeat(a, 1))
    check(sm_ <= max(1.5, st_ * 1.15), f'{nm}: weave repeat (rows, cols) {rpt} threads; seam jump / thread-edge jump: plain tiling {st_:.2f}, mosaic {sm_:.2f} (no new phase seams)')
    check(abs(mos[..., 2].mean() - a[..., 2].mean()) < 0.01 and 0.7 < mos[..., 2].std() / a[..., 2].std() < 1.3, f'{nm}: tone mean {a[..., 2].mean():.3f} -> {mos[..., 2].mean():.3f}, std {a[..., 2].std():.4f} -> {mos[..., 2].std():.4f}')
    md.append(f'| {nm} | yarn | {sc:.2f} | {pt:.2f} -> {pm:.2f} | {at:.2f} -> {am:.2f} | {st_:.2f} -> {sm_:.2f} | {a[..., 2].std():.4f} -> {mos[..., 2].std():.4f} |')
md += ['', '| fabric | fibre tile | autocorr of the 16 px low-pass at lag 256 px (tiled -> mosaic) | mean (tile -> mosaic) |', '|---|---|---|---|']
for f in sorted(glob.glob(os.path.join(TILES, '*_fibre.png'))):
    nm = os.path.basename(f)[:-10]; a = load(f); r = T.mosaic(a, 'fibre', nm)
    if r is None:
        check(a[..., 0].std() < 1e-4, f'{nm} fibre: blank tile (no heather): no mosaic'); continue
    mos, nb = r
    tiled = np.tile(a, (nb, nb, 1))
    def ac256(x):
        lp = ndimage.uniform_filter(x[..., 0].astype(np.float64), 16, mode='wrap'); lp -= lp.mean(); return float((lp[:, :-256] * lp[:, 256:]).mean() / (lp * lp).mean())
    at, am = ac256(tiled), ac256(mos)
    check(at > 0.95 and am < 0.4 and abs(mos[..., 0].mean() - a[..., 0].mean()) < 0.01, f'{nm} fibre: low-pass autocorr at 256 px {at:.2f} -> {am:.2f}; mean {a[..., 0].mean():.3f} -> {mos[..., 0].mean():.3f}')
    md.append(f'| {nm} | fibre | {at:.2f} -> {am:.2f} | {a[..., 0].mean():.3f} -> {mos[..., 0].mean():.3f} |')
a1, a2 = T.mosaic(load(os.path.join(TILES, 'denim_yarn.png')), 'yarn', 'denim')[0], T.mosaic(load(os.path.join(TILES, 'denim_yarn.png')), 'yarn', 'denim')[0]
check(np.array_equal(a1, a2), 'deterministic: the same fabric name gives the same mosaic')
print('ALL OK' if ok else 'FAILED')
if '--write' in sys.argv:
    p = sys.argv[sys.argv.index('--write') + 1]
    open(p, 'w').write('# tile mosaic (blender/fabric7_tiles.py) on the real tiles, `scripts/fabric7/test_tiles.py`\n\n' + '\n'.join(md) + '\n'); print('wrote', p)
sys.exit(0 if ok else 1)
