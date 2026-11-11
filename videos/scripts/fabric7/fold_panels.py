#!/usr/bin/env python3
"""Maps of fold7.js's geometry PER PANEL (our function plot, no render of a person, no photograph): for each garment, the height of the folds (mm; 0 .. --vmax) in each panel's own flat pattern (u, v)
(panels overlap in one (u, v) frame, so each gets its own tile), then the garment from the front (x, y) and from the side (z, y). Input: JSON files with u, v, x, y, z (cm) h (mm), pan, tri per vertex
(fabric7_fold_probe.mjs --dump, or fabric7_scratch/dev_place.mjs).
   python3 videos/scripts/fabric7/fold_panels.py out.png a.json=label b.json=label ... [--vmax 15] [--w 200]"""
import json, sys
import numpy as np
from PIL import Image, ImageDraw
args = [a for a in sys.argv[1:]]
def opt(k, d):
    if k in args: i = args.index(k); v = args[i + 1]; del args[i:i + 2]; return v
    return d
VMAX = float(opt('--vmax', '15')); W = int(opt('--w', '200')); out, files = args[0], args[1:]
def heat(x):
    x = np.clip(x, 0, 1); r = np.clip(3 * x - 0.6, 0, 1); g = np.clip(3 * x - 1.4, 0, 1); b = np.clip(0.55 - 2.5 * np.abs(x - 0.18), 0.12, 1)
    return np.stack([r, g, b], -1)
def raster(xs, ys, tri, val, width, flipy=True, panel=None, pan=None):
    sel = np.ones(len(xs), bool) if panel is None else (pan == panel)
    x0, x1, y0, y1 = xs[sel].min(), xs[sel].max(), ys[sel].min(), ys[sel].max(); s = width / max(x1 - x0, 1e-9); H = int((y1 - y0) * s) + 4
    im = Image.new('RGB', (width + 4, H), (14, 14, 14)); dr = ImageDraw.Draw(im); T = np.array(tri).reshape(-1, 3)
    if panel is not None: T = T[pan[T[:, 0]] == panel]
    T = T[np.argsort(val[T].mean(1))]
    for a, b, c in T:
        v = (val[a] + val[b] + val[c]) / 3; col = tuple(int(q * 255) for q in heat(np.array([v / VMAX]))[0])
        dr.polygon([((xs[i] - x0) * s + 2, ((y1 - ys[i]) if flipy else (ys[i] - y0)) * s + 2) for i in (a, b, c)], fill=col)
    return im
rows = []
for f in files:
    f, _, tag = f.partition('=')
    o = json.load(open(f)); u, v, x, y, z, h = (np.array(o[k]) for k in ('u', 'v', 'x', 'y', 'z', 'h')); pan = np.array(o['pan'])
    hh = h[h > 0.01]; lab = f"{tag + ': ' if tag else ''}{o['person'][:3]} {o['part']} {o.get('fabric', '')}: p50 {np.percentile(hh, 50) if len(hh) else 0:.1f} p90 {np.percentile(hh, 90) if len(hh) else 0:.1f} max {h.max():.1f} mm"
    tiles = [(raster(u, v, o['tri'], h, W, False, p, pan), f'panel {p}') for p in sorted(set(pan.tolist()))]
    tiles += [(raster(x, y, o['tri'], h, int(W * 1.5)), 'front (x, y)'), (raster(z, y, o['tri'], h, int(W * 1.05)), 'side (z, y)')]
    Wt = sum(t.width + 8 for t, _ in tiles); Ht = max(t.height for t, _ in tiles) + 30
    im = Image.new('RGB', (Wt, Ht), (14, 14, 14)); dr = ImageDraw.Draw(im); dr.text((2, 2), lab, fill=(235, 235, 235)); xx = 0
    for t, l in tiles: im.paste(t, (xx, 26)); dr.text((xx + 2, 14), l, fill=(160, 160, 160)); xx += t.width + 8
    rows.append(im)
Wm = max(r.width for r in rows); Hm = sum(r.height for r in rows); R = Image.new('RGB', (Wm, Hm), (14, 14, 14)); y0 = 0
for r in rows: R.paste(r, (0, y0)); y0 += r.height
R.save(out); print(out, R.size, f'(yellow = {VMAX:g} mm)')
