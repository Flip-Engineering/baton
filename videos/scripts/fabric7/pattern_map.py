#!/usr/bin/env python3
"""Shade the pattern maps of labs/clothing2/fabric7_pattern_map.mjs: per garment, left to right (1) the compression the solved cloth carries (eps, the excess length: dark = taut, bright = slack), on the
garment's own pattern; (2) the wrinkle model's relief over it under a raking light (a function evaluated on the real strain field: no render of a person); (3) the same cloth seen from the front (the
bind-space x, y of each pixel) in the same light, so the creases can be judged against the body they sit on. Usage: python3 pattern_map.py <dir> <out.png> [--parts top,trousers] [--zoom 2] [--person L08]
Never has a photograph in it."""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw
d, out = sys.argv[1], sys.argv[2]
arg = lambda k, dflt: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else dflt
parts = arg('--parts', 'top,trousers').split(','); Z = int(arg('--zoom', '2')); az, el = 225.0, 40.0
meta = json.load(open(os.path.join(d, 'meta.json')))
Lv = np.array([np.cos(np.radians(el)) * np.cos(np.radians(az)), np.cos(np.radians(el)) * np.sin(np.radians(az)), np.sin(np.radians(el))])
def shade(gx, gy):
    n = np.stack([-gx, -gy, np.ones_like(gx)], -1); n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return np.clip(0.5 * (n @ Lv) / Lv[2], 0, 1)
def heat(x):   # 0 dark blue .. 1 yellow-white
    x = np.clip(x, 0, 1); r = np.clip(3 * x - 0.6, 0, 1); g = np.clip(3 * x - 1.4, 0, 1); b = np.clip(0.55 - 2.5 * np.abs(x - 0.18), 0.12, 1)
    return np.stack([r, g, b], -1)
who = arg('--person', ''); sel = [m for m in meta if m['part'] in parts and m['person'].startswith(who)]
tiles = []
for m in sel:
    W, H = m['W'], m['H']; a = np.fromfile(os.path.join(d, m['file']), dtype=np.float32).reshape(H, W, 6); cov = np.fromfile(os.path.join(d, m['file'].replace('.f32', '.cov')), dtype=np.uint8).reshape(H, W) > 0
    eps = a[..., 3]; sh = shade(a[..., 1], a[..., 2])
    im1 = heat(eps / 0.02); im1[~cov] = 0.08
    im2 = np.repeat(sh[..., None], 3, -1); im2[~cov] = 0.08
    # the front view: scatter the pixels by their bind-space x, y (cm) at 2 mm a pixel
    X, Y = a[..., 4][cov], a[..., 5][cov]; s = sh[cov]; x0, x1, y0, y1 = X.min(), X.max(), Y.min(), Y.max(); FW, FH = int((x1 - x0) / 0.2) + 3, int((y1 - y0) / 0.2) + 3
    fr = np.full((FH, FW), 0.08, np.float32); zb = np.full((FH, FW), -1e9, np.float32)
    ix = ((X - x0) / 0.2).astype(int) + 1; iy = (FH - 2 - ((Y - y0) / 0.2).astype(int)); fr[iy, ix] = s
    # holes of the scatter (the front panel's sparse pixels): a 3x3 max filter on the covered mask
    mask = np.zeros((FH, FW), bool); mask[iy, ix] = True
    for _ in range(2):
        mk = mask.copy(); fr2 = fr.copy()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                sm = np.roll(np.roll(mask, dy, 0), dx, 1); sf = np.roll(np.roll(fr, dy, 0), dx, 1); put = sm & ~mk; fr2[put] = sf[put]; mk |= sm
        fr, mask = fr2, mk
    im3 = np.repeat(fr[..., None], 3, -1)
    tiles.append((m, [im1, im2, im3], np.percentile(eps[cov], [50, 90]), float(cov.mean()), float(np.mean(eps[cov] > 0.0005))))
pad = 6; Hh = max(max(t[1][0].shape[0], t[1][2].shape[0]) for t in tiles) * Z + 22
Wt = sum(sum(i.shape[1] for i in t[1]) * Z + pad * 4 for t in tiles)
img = Image.new('RGB', (Wt, Hh * 1), (14, 14, 14)); dr = ImageDraw.Draw(img); x = 0
for m, ims, q, covf, wr in tiles:
    for k, im in enumerate(ims):
        p = Image.fromarray((im * 255).astype(np.uint8)).resize((im.shape[1] * Z, im.shape[0] * Z), Image.NEAREST); img.paste(p, (x, 20)); x += p.width + pad
    dr.text((x - sum(i.shape[1] for i in ims) * Z - 3 * pad, 4), f"{m['person'][:3]} {m['part']} {m['fabric']}: eps p50 {q[0]:.4f} p90 {q[1]:.4f}; lambda0 {m['lamMm']:.1f} mm, fold {m['foldMm']} mm, {m['octaves']} octaves; share with eps > 0.05 %: {wr:.2f}" + (f"; direction field band-limited to sigma {m['dirSigmaMm']} mm ({m['dirPasses']} passes, {m['dirCoherence']:.2f} of the excess kept)" if m.get('dirPasses') else ""), fill=(235, 235, 235)); x += pad
img.save(out); print(out, img.size)
