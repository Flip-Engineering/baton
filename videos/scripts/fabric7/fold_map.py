#!/usr/bin/env python3
"""Maps of fold7.js's geometry (a function plot of OUR mesh, no render of a person, no photograph): per garment, left to right, the height of the folds the stage built (mm; 0 .. --vmax) in the garment's own
flat pattern (u, v), seen from the front (x, y) and from the side (z, y). Input: the <dir> of `node web/labs/clothing2/fabric7_fold_probe.mjs <who> --dump <dir>`.
   python3 videos/scripts/fabric7/fold_map.py <dir> <out.png> [--parts top,trousers,outer] [--person L08] [--vmax 15] [--w 280]"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw
d, out = sys.argv[1], sys.argv[2]
arg = lambda k, dflt: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else dflt
parts = arg('--parts', 'top,trousers,outer').split(','); who = arg('--person', ''); VMAX = float(arg('--vmax', '15')); W = int(arg('--w', '280'))
def heat(x):   # 0 dark blue .. 1 yellow-white
    x = np.clip(x, 0, 1); r = np.clip(3 * x - 0.6, 0, 1); g = np.clip(3 * x - 1.4, 0, 1); b = np.clip(0.55 - 2.5 * np.abs(x - 0.18), 0.12, 1)
    return np.stack([r, g, b], -1)
def raster(xs, ys, tri, val, width, flipy=True):
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max(); s = width / max(x1 - x0, 1e-9); H = int((y1 - y0) * s) + 4
    im = Image.new('RGB', (width + 4, H), (14, 14, 14)); dr = ImageDraw.Draw(im); T = np.array(tri).reshape(-1, 3)
    order = np.argsort(-(val[T].mean(1)))[::-1] if False else np.argsort(val[T].mean(1))   # tall folds drawn last: seen
    for a, b, c in T[order]:
        v = (val[a] + val[b] + val[c]) / 3; col = tuple(int(q * 255) for q in heat(np.array([v / VMAX]))[0])
        dr.polygon([((xs[i] - x0) * s + 2, ((y1 - ys[i]) if flipy else (ys[i] - y0)) * s + 2) for i in (a, b, c)], fill=col)
    return im
rows = []
for f in sorted(os.listdir(d)):
    if not f.endswith('.json') or not f.startswith(who): continue
    o = json.load(open(os.path.join(d, f)))
    if o['part'] not in parts: continue
    u, v, x, y, z, h = (np.array(o[k]) for k in ('u', 'v', 'x', 'y', 'z', 'h'))
    tiles = [raster(u, v, o['tri'], h, W, False), raster(x, y, o['tri'], h, W), raster(z, y, o['tri'], h, int(W * 0.7))]
    hh = h[h > 0.01]; lab = f"{o['person'][:3]} {o['part']}: folds p50 {np.percentile(hh, 50) if len(hh) else 0:.1f} p90 {np.percentile(hh, 90) if len(hh) else 0:.1f} max {h.max():.1f} mm"
    Wt = sum(t.width for t in tiles) + 24; Ht = max(t.height for t in tiles) + 18
    im = Image.new('RGB', (Wt, Ht), (14, 14, 14)); dr = ImageDraw.Draw(im); xx = 0
    for t, l in zip(tiles, ('pattern (u, v)', 'front (x, y)', 'side (z, y)')):
        im.paste(t, (xx, 16)); dr.text((xx + 2, 2), l + ('   ' + lab if l.startswith('pattern') else ''), fill=(225, 225, 225)); xx += t.width + 12
    rows.append(im)
Wm = max(r.width for r in rows); Hm = sum(r.height for r in rows); R = Image.new('RGB', (Wm, Hm), (14, 14, 14)); y0 = 0
for r in rows: R.paste(r, (0, y0)); y0 += r.height
R.save(out); print(out, R.size, f'(yellow = {VMAX:g} mm)')
