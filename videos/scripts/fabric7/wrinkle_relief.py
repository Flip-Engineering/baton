#!/usr/bin/env python3
"""Shade the wrinkle field of labs/clothing2/fabric7_wrinkle_field.mjs (height m, slope x, slope y per pixel; a flat 20 x 20 cm patch of pattern at 0.5 mm a pixel) with a raking light and lay the fabrics
out as one board: columns the single-scale wrinkles (cascade off) | the ridge cascade (on), one row a fabric. It is a picture of a FUNCTION (the shader's normal perturbation), not a render of a person: what it shows is
whether the model draws contour lines or folds. Usage: python3 wrinkle_relief.py <field dir> <out.png> [--light az,el]"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw
d = sys.argv[1]; out = sys.argv[2]
az, el = (float(x) for x in (sys.argv[sys.argv.index('--light') + 1].split(',') if '--light' in sys.argv else '225,45'.split(',')))
meta = json.load(open(os.path.join(d, 'field.json'))); N = meta['N']
L = np.array([np.cos(np.radians(el)) * np.cos(np.radians(az)), np.cos(np.radians(el)) * np.sin(np.radians(az)), np.sin(np.radians(el))])
def shade(f):
    a = np.fromfile(f, dtype=np.float32).reshape(N, N, 3); gx, gy = a[..., 1], a[..., 2]
    n = np.stack([-gx, -gy, np.ones_like(gx)], -1); n /= np.linalg.norm(n, axis=-1, keepdims=True)
    s = (n @ L) / L[2]            # a flat patch is 1.0
    return np.clip(0.5 * s, 0, 1), np.std(s)
tiles, sd = [], []
for r in meta['rows']:
    row = []
    for mode in ('rev6', 'cascade'):
        im, s = shade(os.path.join(d, f"{r['fab']}_{mode}.f32")); row.append(im); sd.append((r['fab'], mode, round(float(s), 4)))
    tiles.append(row)
W = N * 2 + 6; H = (N + 4) * len(tiles)
img = Image.new('L', (W, H), 20)
dr = ImageDraw.Draw(img)
for j, row in enumerate(tiles):
    for i, im in enumerate(row):
        img.paste(Image.fromarray((im * 255).astype(np.uint8)), (i * (N + 6), j * (N + 4)))
    r = meta['rows'][j]; dr.text((6, j * (N + 4) + 4), f"{r['fab']}  lambda0 {r['lamMm']} mm  octaves {r['octaves']}  fold {r['foldMm']} mm  A0 {r['A_mm']} mm", fill=255)
dr.text((N + 12, 18), 'ridge cascade (on)', fill=255); dr.text((6, 18), 'single scale (off)', fill=255)
img.save(out); print(out, 'relief std (flat = 0):', sd)
