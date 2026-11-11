# FABRIC7 (8 Oct, continuation c2 iteration 1): the Cycles yarn and fibre tiles without the 32-thread repeat. numpy only (no bpy: blender/person_scene.py makes the Blender image from the
# array this returns; scripts/fabric7/test_tiles.py measures it on the real tiles with no Blender).
#
# THE FINDING (measured on web/assets/fabric6/tiles, measures/tiles7.md): the woven yarn tiles carry their TONE (blue channel; Cycles multiplies the yarn colour by 2 x it) as ONE VALUE PER
# WARP END, repeated down the thread: denim 92 % of the tone variance is per-column (std 0.054 -> +-11 % per thread), stretch denim 85 %, chambray 61 %, oxford 47 %, canvas 36 % (+ 24 % per
# pick). The tile is 256 px = 32 threads = 32 / epc cm (denim 26 epc: 12 mm), so the same 32 stripes repeat every 12 mm: the v6 Cycles stills' vertical denim pinstripes, 8-10 mm apart
# (AUDIT7 C14 in Cycles). The heather / fleece / wool FIBRE tiles are binary speckle, 256 px = 32 threads = ~2 cm, sampled 'Closest': the fine mesh on the heather tee. The knit yarn tiles
# (jersey, tee, heather, fleece, rib) are exactly periodic per thread (tone std 0.004): nothing to hide, no mosaic.
#
# THE FIX: a mosaic, nb x nb blocks, each block the tile rolled by a random whole number of weave repeats (detect_repeat reads them off the tile: 4 threads = 32 px for twill 3/1 and 2/2, 3 for
# the 2/1 twills, 2 for a plain weave's rows: the weave stays in phase inside a block; the 2/1 twill tiles, 32 threads wide, already carry a phase seam at every tile edge, so they gain none) and, for the yarn tone, each warp end and each pick given a FRESH tone drawn (with replacement) from the tile's own per-thread values:
# the same distribution of thread tones, no period shorter than nb x 32 threads, no regular stripe spacing. The fibre tile's blocks roll by any pixel offset (a speckle has no phase).
import zlib
import numpy as np

THREAD_PX = 8          # texels per thread in the 256 px / 32 thread tiles (fabric6_tiles.mjs)
REPEAT_THREADS = 4     # the largest weave repeat among the wardrobe's fabrics (twill 3/1); also divisible by plain 2, basket 2, rib 2, jersey 1
NB = 8                 # blocks a side: 256 threads = ~10 cm of denim, 14 cm of canvas


def seed_of(name):
    return zlib.crc32(('f7tile:' + str(name)).encode()) & 0xffffffff


def needs_yarn_mosaic(a):
    """True when the yarn tile's tone channel carries real thread-to-thread variation (std > 0.01 of 1): the woven tiles, not the periodic knits"""
    return float(a[..., 2].std()) > 0.01


def detect_repeat(a, axis, thread_px=THREAD_PX, cands=(1, 2, 3, 4, 6, 8, 12), need=0.85):
    """the weave repeat (threads) along an axis, from the tile itself: the smallest k whose roll of k threads leaves the red / green (the weave) 85 % unchanged. 3 for a 2/1 twill (chino,
    twillPC), 4 for 3/1 and 2/2 twill, 2 for a plain weave's rows. A tile that repeats at none of them gets 4 (the old rule)."""
    for k in cands:
        r = np.roll(a, k * thread_px, axis)
        if float((np.abs(r[..., :2] - a[..., :2]).max(-1) < 2.5 / 255).mean()) >= need:
            return k
    return REPEAT_THREADS


def tone_shares(a):
    """(share of the tone variance carried per warp end, share per pick): the pinstripe diagnostic"""
    b = np.asarray(a[..., 2], dtype=np.float64); v = max(b.var(), 1e-12)
    return float(b.mean(0).var() / v), float(b.mean(1).var() / v)


def mosaic_yarn(a, nb=NB, name=''):
    """a: (h, w, 4) float 0..1, the yarn tile; returns (nb h, nb w, 4) float32. Blocks rolled by whole weave repeats, thread tones re-drawn from the tile's own."""
    a = np.asarray(a, dtype=np.float32); h, w, _ = a.shape
    rng = np.random.default_rng(seed_of(name))
    ry, rx = detect_repeat(a, 0), detect_repeat(a, 1)                # whole weave repeats along v (rows) and along u (columns)
    ny, nx = max(1, (h // THREAD_PX) // ry), max(1, (w // THREAD_PX) // rx)
    b0 = a[..., 2]; m0 = float(b0.mean())
    colv = b0.mean(0).reshape(-1, THREAD_PX).mean(1) - m0       # the tile's per-warp-end tone values
    rowv = b0.mean(1).reshape(-1, THREAD_PX).mean(1) - m0       # ... per pick
    out = np.empty((nb * h, nb * w, 4), np.float32)
    for bi in range(nb):
        for bj in range(nb):
            blk = np.roll(a, (ry * THREAD_PX * int(rng.integers(0, ny)), rx * THREAD_PX * int(rng.integers(0, nx))), (0, 1)).copy()
            b = blk[..., 2].astype(np.float64); m = b.mean(); c = b.mean(0) - m; r = b.mean(1) - m
            resid = b - m - c[None, :] - r[:, None]                # the within-crossing structure stays
            cn = np.repeat(rng.choice(colv, size=w // THREAD_PX), THREAD_PX); rn = np.repeat(rng.choice(rowv, size=h // THREAD_PX), THREAD_PX)
            blk[..., 2] = np.clip(m + cn[None, :] + rn[:, None] + resid, 0.0, 1.0)
            out[bi * h:(bi + 1) * h, bj * w:(bj + 1) * w] = blk
    return out


def mosaic_fibre(a, nb=NB, name=''):
    """the fibre (speckle) tile, nb x nb blocks each rolled by a random pixel offset"""
    a = np.asarray(a, dtype=np.float32); h, w, _ = a.shape
    rng = np.random.default_rng(seed_of(name + ':fibre'))
    out = np.empty((nb * h, nb * w, 4), np.float32)
    for bi in range(nb):
        for bj in range(nb):
            out[bi * h:(bi + 1) * h, bj * w:(bj + 1) * w] = np.roll(a, (int(rng.integers(0, h)), int(rng.integers(0, w))), (0, 1))
    return out


def mosaic(a, kind, name='', nb=NB):
    """(array, nb) for kind 'yarn' | 'fibre', or None when the tile needs none (the periodic knit yarn tiles)"""
    if kind == 'yarn':
        return (mosaic_yarn(a, nb, name), nb) if needs_yarn_mosaic(a) else None
    if kind == 'fibre':
        return (mosaic_fibre(a, nb, name), nb) if float(np.asarray(a)[..., 0].std()) > 1e-4 else None   # a blank fibre tile (no heather) is never sampled
    return None
