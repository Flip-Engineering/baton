#!/usr/bin/env python3
"""FABRIC7 cloth statistics: what a camera sees of a piece of cloth, as numbers, the SAME code on a photograph's patch and on one of our plates.

A patch is a cloth-only rectangle (no skin, hair, print, seam, button) of an image at a known scale (mm per pixel at the cloth). Everything is measured
in LINEAR luminance Y (sRGB decoded) after resampling the patch to a common scale (default 0.6 mm/px: 'bust 1:1', our bust plates are 0.547) with
INTER_AREA-style box averaging (a patch is never enlarged: a photograph coarser than the target scale is refused).

  hp_cv      std of Y - G(Y, 1.5 px) over mean Y: the grain a pixel carries (weave beating, fibre, noise)           [1:1 micro-contrast]
  mid_cv     std of G(Y,1.5) - G(Y,8) over mean Y: mottle at ~1-5 mm (slub, heather, yarn lanes, small wrinkles)
  low_cv     std of G(Y,8) over mean Y: panel scale (folds, tone), > 5 mm
  lane_ratio autocorrelation length (lag where the ACF of the band 1.5-8 px falls below 0.5) along y over along x: 1 isotropic, >> 1 vertical streaks
             (the AUDIT7 C14 'brushed metal / wood grain'); a patch is oriented so that y is the garment's vertical
  dL, dC     std of CIELAB L* and of chroma over the patch (colour variation over a panel)
  cr_val     p90 / p10 of the low-passed (G 8 px) Y: crest to valley luminance ratio of the patch's folds and tone

  python3 cloth_stats.py patch IMG x0 y0 x1 y1 [--mm 0.547] [--to 0.6]      one patch
  python3 cloth_stats.py baseline [--out JSON]                              the v6 baseline on the integration-6 plates (boxes below)
  python3 cloth_stats.py compare <plates_dir>                               iteration 1: v6 | rev 7 | ablations on the delivered fabric7_it1 bench plates -> measures/it1_stats.json / .md
"""
import json, math, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
VIDEOS = os.path.join(REPO, 'videos')
OUTDIR = os.path.join(VIDEOS, 'review', 'studio_clothing_c2', 'after', 'fabric7', 'measures')

def srgb_to_lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def lab_of(rgb):
    lin = srgb_to_lin(rgb.astype(np.float64))
    M = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
    xyz = lin @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)

def resample(rgb, mm_in, mm_out):
    """box-average a patch from mm_in to mm_out per px (never enlarge)"""
    if mm_in > mm_out * 1.02: raise ValueError(f'patch is coarser ({mm_in} mm/px) than the target ({mm_out}): refused')
    s = mm_out / mm_in
    if s < 1.02: return rgb
    h, w = rgb.shape[:2]; nh, nw = int(h / s), int(w / s)
    im = Image.fromarray(rgb).resize((nw, nh), Image.BOX)           # BOX = exact area average when downscaling
    return np.asarray(im)

def hp_code(rgb, mm_in, mm_out):
    """std of the 1.5 px high-pass of the luma CODE (sRGB values, 0..255; Rec.709 weights) at the target scale: the number the photograph band is quoted in (CHECK L2: it was only in the local scratch)"""
    a = resample(np.asarray(rgb)[..., :3].astype(np.uint8), mm_in, mm_out).astype(np.float64); a = a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722
    hp = a - ndi.gaussian_filter(a, 1.5); c = (slice(12, -12), slice(12, -12)) if min(a.shape) > 40 else (slice(None), slice(None))
    return round(float(hp[c].std()), 3)

def acf_len(band, axis, thr=0.5, maxlag=40):
    b = band - band.mean(); den = (b * b).mean() + 1e-18
    maxlag = max(3, min(maxlag, b.shape[axis] // 2))           # CHECK L1 (8 Oct): a 28-32 px core cannot carry lags to 40 (the loop returned 40.0 = a meaningless ratio)
    for lag in range(1, maxlag):
        if axis == 0: c = (b[lag:, :] * b[:-lag, :]).mean() / den
        else: c = (b[:, lag:] * b[:, :-lag]).mean() / den
        if c < thr: return lag - 1 + (1 - (thr - c) / max(1e-9, (prev - c))) if lag > 1 else 0.5
        prev = c
    return float(maxlag)

def stats(rgb, mm_in=0.547, mm_out=0.6):
    rgb = resample(np.asarray(rgb)[..., :3].astype(np.uint8), mm_in, mm_out)
    Y = srgb_to_lin(rgb.astype(np.float64)) @ np.array([0.2126, 0.7152, 0.0722]); m = Y.mean() + 1e-12
    g15 = ndi.gaussian_filter(Y, 1.5); g8 = ndi.gaussian_filter(Y, 8)
    hp = Y - g15; mid = g15 - g8; band = ndi.gaussian_filter(Y, 1.0) - g8
    lab = lab_of(rgb); C = np.hypot(lab[..., 1], lab[..., 2]); core = (slice(12, -12), slice(12, -12)) if min(Y.shape) > 40 else (slice(None), slice(None))
    ly, lx = acf_len(band[core], 0), acf_len(band[core], 1)
    lo = g8[core]
    pk = peaks(band[core]); pl = peaks(Y[core]); pk['peak_lf'], pk['period_lf'] = pl['peak_lf'], pl['period_lf']    # hf from the 1-8 px band (weave beat, moire grid), lf from Y itself (a plaid of tile repeats)
    return dict(**pk, n=int(Y.size), px=list(Y.shape[::-1]), mm_out=mm_out, Y=round(float(m), 4), hp_cv=round(float(hp[core].std() / m), 4), mid_cv=round(float(mid[core].std() / m), 4),
                low_cv=round(float(lo.std() / m), 4), lane_len_y=round(float(ly), 2), lane_len_x=round(float(lx), 2), lane_ratio=round(float(ly / max(lx, 0.5)), 2),
                dL=round(float(lab[..., 0][core].std()), 3), dC=round(float(C[core].std()), 3), L=round(float(lab[..., 0].mean()), 2), cr_val=round(float(np.percentile(lo, 90) / max(np.percentile(lo, 10), 1e-9)), 3))

def peaks(Y, lo_px=4.0, hi_px=14.0, lf_lo=30.0, lf_hi=140.0):
    """CHECK M1 (8 Oct): the instruments above are blind to a MOIRE GRID or a PLAID (a visible 4 % grid left lane_ratio at 1.0 and hp_cv +20 %): a narrow peak in the 2-D power spectrum is what a
    periodic pattern is. Per window: Y minus its mean, Hann window, |FFT|^2; the power of each 3 x 3 patch of bins (a windowed sinusoid spreads over them) over the TRIMMED mean power of the
    annulus at the same radius (radial bins 3 % wide; one clip at 5 x the first mean, then the mean again: the peak does not raise its own baseline). peak_hf = the largest ratio at periods
    lo_px..hi_px px (a weave beat, a moire grid), peak_lf at lf_lo..lf_hi (a plaid of tile repeats; needs a window of >= 2 periods: a 220 px box sees periods to ~110). White noise gives ~ln(bins)
    = 4-8; a periodic pattern a few percent strong gives 25-2000. Flag > 25. Also the period (px) of the peak."""
    h, w = Y.shape
    if min(h, w) < 48: return dict(peak_hf=None, period_hf=None, peak_lf=None, period_lf=None)
    y = Y - Y.mean(); win = np.outer(np.hanning(h), np.hanning(w)); P = np.abs(np.fft.fftshift(np.fft.fft2(y * win))) ** 2
    ky = (np.arange(h) - h // 2) / h; kx = (np.arange(w) - w // 2) / w; KY, KX = np.meshgrid(ky, kx, indexing='ij'); R = np.hypot(KY, KX)
    rb = np.clip(np.floor(np.log(np.maximum(R, 1e-6) / 1e-3) / np.log(1.03)).astype(int), 0, 400); nb = rb.max() + 1
    cnt = np.bincount(rb.ravel(), minlength=nb).astype(float); m1 = np.bincount(rb.ravel(), P.ravel(), minlength=nb) / np.maximum(cnt, 1)
    m2 = np.bincount(rb.ravel(), np.minimum(P, 5.0 * m1[rb]).ravel(), minlength=nb) / np.maximum(cnt, 1)
    P3 = ndi.uniform_filter(P, 3) * 9.0; ratio = P3 / np.maximum(9.0 * m2[rb], 1e-30); ratio[R < 1e-6] = 0
    per = 1.0 / np.maximum(R, 1e-9); half = (KX > 0) | ((KX == 0) & (KY > 0)); out = {}
    for nm, a, b in (('hf', lo_px, hi_px), ('lf', lf_lo, min(lf_hi, 0.5 * min(h, w)))):
        sel = (per >= a) & (per <= b) & half & (cnt[rb] >= 12)
        if not sel.any(): out['peak_' + nm] = None; out['period_' + nm] = None; continue
        v = np.where(sel, ratio, 0.0); i = np.unravel_index(np.argmax(v), v.shape)
        out['peak_' + nm] = round(float(v[i]), 1); out['period_' + nm] = round(float(per[i]), 1)
    return out

# ---------------------------------------------------------------- the v6 baseline: integration 6's 1:1 busts (0.547 mm/px: 26 deg lens at 1.6 m, 1350 px) and the 270 px row
BUST = os.path.join(VIDEOS, 'out', 'bench', 'human8_integ6f', '1004-080925-bench_human8_integ6f_36_plates')
ROW = os.path.join(VIDEOS, 'out', 'bench', 'human8_integ6r', '1004-080931-bench_human8_integ6r_14_plates')
# cloth-only boxes picked by eye on the plates (x0, y0, x1, y1)
BUST_BOXES = {
    'L08_f24_hispanic': ('heatherJersey tee', (440, 700, 800, 1040)),
    'L21_m32_black': ('fleece sweatshirt', (545, 700, 805, 1000)),
    'L22_f27_black': ('scrub poplin', (330, 800, 560, 1040)),
    'L23_m45_white': ('canvas chore coat', (550, 700, 750, 1000)),    # was x1 800: the coat opening's dark gap in the right ~45 px (CHECK M2, 8 Oct): lighting, not cloth
    'L03_m38_asian': ('oxford shirt', (400, 780, 620, 1000)),         # was x1 700: a shirt button and the placket edge (CHECK M2)
}
def baseline(out=None, bust_dir=BUST, tag='bust6'):
    res = {'bust': {}}
    for nm, (what, (x0, y0, x1, y1)) in BUST_BOXES.items():
        p = os.path.join(bust_dir, f'{tag}_studio5_{nm}.png')
        if not os.path.exists(p): continue
        im = np.asarray(Image.open(p).convert('RGB'))[y0:y1, x0:x1]
        res['bust'][nm] = {'fabric': what, 'box': [x0, y0, x1, y1], **stats(im, 0.547, 0.6)}
    if out: json.dump(res, open(out, 'w'), indent=1)
    return res


# ---------------------------------------------------------------- iteration 1: v6 as shipped (f7off) | rev 7 (f7on) | ablations, on the DELIVERED bench plates (plates7.py it1)
ROW_X0, ROW_DX = 780.0, 123.9           # row plates at 1560 px: person k's centre x = 780 + (k - 5.5) * 123.9 (the lab's own row geometry, 343 px a slot at 4320 px)
ROW_BOX = (-20, 106, 20, 172)           # x offsets from the person's centre and the y range of the chest and ribs in the FRONT band (360 px a band) at 270 px
def compare(d, out=None):
    res = {'bust': {}, 'bust2x': {}, 'row': {}}
    variants = [('v6', 'f7off'), ('rev7', 'f7on'), ('grain', 'grain'), ('tone', 'tone'), ('light', 'light'), ('fuzz', 'fuzz')]
    for nm, (what, (x0, y0, x1, y1)) in BUST_BOXES.items():
        k = nm.split('_')[0]
        for label, t in variants:
            p = os.path.join(d, f'bust7_{t}_{k}.png')
            if os.path.exists(p):
                res['bust'].setdefault(nm, {'fabric': what})[label] = stats(np.asarray(Image.open(p).convert('RGB'))[y0:y1, x0:x1], 0.547, 0.6)
        for label, t in variants[:2]:
            p = os.path.join(d, f'bust7x2_{t}_{k}.png')
            if os.path.exists(p):
                res['bust2x'].setdefault(nm, {'fabric': what})[label] = stats(np.asarray(Image.open(p).convert('RGB'))[2 * y0:2 * y1, 2 * x0:2 * x1], 0.2735, 0.6)
    people = ['L08', 'L21', 'L22', 'L11', 'L20', 'L17', 'L12', 'L03', 'L14', 'L23', 'L06', 'L05']
    for stg in ('studio5', 'yard5'):
        for label, t in variants[:2]:
            p = os.path.join(d, f'row7_{t}_{stg}_270.png')
            if not os.path.exists(p): continue
            im = np.asarray(Image.open(p).convert('RGB'))
            for k, nm in enumerate(people):
                cx = int(round(ROW_X0 + (k - 5.5) * ROW_DX)); xa, ya, xb, yb = ROW_BOX
                st = stats(im[ya:yb, cx + xa:cx + xb], 6.3, 6.3)
                res['row'].setdefault(stg, {}).setdefault(nm, {})[label] = {k2: st[k2] for k2 in ('Y', 'low_cv', 'dL', 'dC', 'L', 'cr_val')}
    if out: json.dump(res, open(out, 'w'), indent=1)
    keys = ['hp_cv', 'mid_cv', 'lane_ratio', 'dL', 'dC', 'cr_val']
    md = ['| person | fabric | variant | ' + ' | '.join(keys) + ' |', '|---|---|---|' + '---|' * len(keys)]
    for scale in ('bust', 'bust2x'):
        for nm, v in res[scale].items():
            for label, st in v.items():
                if label != 'fabric': md.append(f"| {nm.split('_')[0]} ({scale}) | {v['fabric']} | {label} | " + ' | '.join(str(st[k]) for k in keys) + ' |')
    return res, '\n'.join(md)

if __name__ == '__main__':
    a = sys.argv[1:]
    if not a or a[0] == 'baseline':
        out = a[a.index('--out') + 1] if '--out' in a else os.path.join(OUTDIR, 'baseline_v6.json')
        r = baseline(out); print(json.dumps(r, indent=1))
    elif a[0] == 'compare':
        res, md = compare(a[1], os.path.join(OUTDIR, 'it1_stats.json')); open(os.path.join(OUTDIR, 'it1_stats.md'), 'w').write(md + '\n'); print(md)
    elif a[0] == 'patch':
        img, x0, y0, x1, y1 = a[1], *map(int, a[2:6]); mm = float(a[a.index('--mm') + 1]) if '--mm' in a else 0.547; to = float(a[a.index('--to') + 1]) if '--to' in a else 0.6
        print(json.dumps(stats(np.asarray(Image.open(img).convert('RGB'))[y0:y1, x0:x1], mm, to), indent=1))
