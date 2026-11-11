#!/usr/bin/env python3
"""Bake the footage time volume once: out/.footage/vol_<w>x<h>.r8 + rowmed_160.r8 + index.json.

lib/fx/footage.js fetches these instead of decoding 511 JPEGs in the browser on every launch
(7-12 s, 118 MB of createImageBitmap resizes). The key is a sha1 over the source frames' bytes,
so editing or replacing a frame rebuilds; an unchanged set is a no-op (~0.1 s).

  python3 scripts/bake_footage.py [--vol 360x640] [--force]

Outputs (all gitignored under out/.footage/):
  vol_WxH.r8     N layers of W*H uint8 (R channel), layer i = frame i (0-based), row-major, top row first
  rowmed_160.r8  N rows of 160 uint8: the median of each row of the 90x160 thumbnail (crowd matte, horizon)
  index.json     {key, n, vol, files, track: [[x, y, m, hz], ...]}  (smoothed rider track + horizon per frame)
"""
import hashlib, json, os, sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'web', 'assets', 'riders')
OUT = os.path.join(ROOT, 'out', '.footage')


def load(args):
    path, vw, vh = args
    im = Image.open(path)
    r = im.getchannel('R') if im.mode != 'L' else im
    vol = np.asarray(r.resize((vw, vh), Image.LANCZOS), dtype=np.uint8)
    th = np.asarray(r.resize((90, 160), Image.BOX), dtype=np.int32)
    return vol, th


def locate(th):
    """Dark upright mass in the horizon band: darker than its row's median (same rule as the JS _locate)."""
    med = np.sort(th, axis=1)[:, 45]
    band = th[50:100]
    w = np.maximum(0, med[50:100, None] - band - 14).astype(np.float64)
    # the rider is the tallest dark column blob; distant hills spread thin mass across the width, so take
    # the centroid only within +-11 columns of the column-mass peak (the plain centroid drifted 0.2 toward the hills)
    col = w.sum(0)
    c = int(np.convolve(col, np.ones(5), 'same').argmax())
    w[:, :max(0, c - 11)] = 0
    w[:, c + 12:] = 0
    m = w.sum()
    if m <= 0:
        x, y = 0.5, 0.5
    else:
        ys, xs = np.mgrid[50:100, 0:90]
        x, y = (w * xs).sum() / m / 90, (w * ys).sum() / m / 160
    # horizon: first row below y=0.35 whose median falls under 72% of the sky median (rows 20..56)
    sky = float(np.median(med[20:56])) or 1.0
    hz = 0.52
    for yy in range(56, 120):
        if med[yy] < 0.72 * sky:
            hz = yy / 160
            break
    return med.astype(np.uint8), (x, y, m / 1e4, hz)


def main():
    vw, vh = 360, 640
    if '--vol' in sys.argv:
        vw, vh = map(int, sys.argv[sys.argv.index('--vol') + 1].split('x'))
    files = sorted(f for f in os.listdir(SRC) if f.endswith('.jpg'))
    h = hashlib.sha1(f'{vw}x{vh}:v3'.encode())
    for f in files:
        with open(os.path.join(SRC, f), 'rb') as fh:
            h.update(fh.read())
    key = h.hexdigest()[:16]
    idx_path = os.path.join(OUT, 'index.json')
    vol_name = f'vol_{vw}x{vh}.r8'
    if '--force' not in sys.argv and os.path.exists(idx_path):
        try:
            old = json.load(open(idx_path))
            if old.get('key') == key and os.path.getsize(os.path.join(OUT, vol_name)) == vw * vh * len(files):
                print(f'footage cache ok ({key})')
                return
        except Exception:
            pass
    os.makedirs(OUT, exist_ok=True)
    n = len(files)
    with ProcessPoolExecutor(max_workers=3) as ex:
        res = list(ex.map(load, [(os.path.join(SRC, f), vw, vh) for f in files], chunksize=16))
    vol = np.stack([r[0] for r in res])
    meds, raw = zip(*[locate(r[1]) for r in res])
    raw = np.array(raw)
    trk = []
    for i in range(n):                                   # smooth +-4 frames, mass-weighted (as the JS loader did)
        ks = [min(n - 1, max(0, i + d)) for d in range(-4, 5)]
        w = raw[ks, 2] + 1e-3
        trk.append([round(float((raw[ks, 0] * w).sum() / w.sum()), 5), round(float((raw[ks, 1] * w).sum() / w.sum()), 5),
                    round(float(raw[ks, 2].sum() / 9), 5), round(float(np.median(raw[ks, 3])), 5)])
    vol.tofile(os.path.join(OUT, vol_name + '.tmp'))
    os.replace(os.path.join(OUT, vol_name + '.tmp'), os.path.join(OUT, vol_name))
    np.stack(meds).tofile(os.path.join(OUT, 'rowmed_160.r8'))
    json.dump({'key': key, 'n': n, 'vol': [vw, vh], 'files': {'vol': vol_name, 'rowmed': 'rowmed_160.r8'}, 'track': trk},
              open(idx_path, 'w'))
    print(f'footage cache baked ({key}): {n} frames, {vol.nbytes / 1e6:.0f} MB')


if __name__ == '__main__':
    main()
