#!/usr/bin/env python3
# FABRIC7 c3 (8 Oct): the knit-moire gate on Cycles stills, in millimetres of cloth. Python numpy/PIL/scipy only; reads PNGs.
#   python3 videos/scripts/fabric7/knit_period.py [--mm 0.555] [--box x0,y0,x1,y1] label=path [label=path ...]
# For each plate: the luminance of the box, the shading above ~13 mm taken out (Gaussian sigma 24 px at 0.555 mm/px), then the std and the share of the windowed 2-D power spectrum by PERIOD in mm.
# The first Cycles stills of rev 7 (7.2 atlas) against v6 on the same boxes (bust 1080 x 1350, 0.555 mm/px at the chest):
#   L21 chest box 700,800,956,1056: v6 std 0.0123 share 3-12 mm 0.30 | rev 7.2 std 0.0246 share 3-12 mm 0.61  (the swirl: the yarn drawn into the atlas, beating against the texel grid)
#   L08 tee box 600,900,856,1156:   v6 std 0.0241 share 6-12 mm 0.09 | rev 7.2 std 0.0332 share 6-12 mm 0.19
# GATE (iteration 2 reads it): rev 7.5 / the control at the same boxes: the share at 3-12 mm back near v6's and the std near v6's = the moire is gone.
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

BANDS = [(0, 1.5), (1.5, 3), (3, 6), (6, 12), (12, 30), (30, 1e9)]


def shares(path, box, mm, sigma_px=24):
    a = np.asarray(Image.open(path).convert('RGB'), dtype=np.float32) / 255
    l = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    x0, y0, x1, y1 = box
    p = l[y0:y1, x0:x1].astype(np.float64)
    p = p - ndimage.gaussian_filter(p, sigma_px)
    w = np.hanning(p.shape[0])[:, None] * np.hanning(p.shape[1])[None, :]
    F = np.fft.fftshift(np.abs(np.fft.fft2(p * w)) ** 2)
    cy, cx = p.shape[0] // 2, p.shape[1] // 2
    F[cy - 2:cy + 3, cx - 2:cx + 3] = 0
    tot = F.sum()
    yy, xx = np.indices(F.shape)
    r = np.hypot((yy - cy) / p.shape[0], (xx - cx) / p.shape[1])
    per = np.where(r > 0, 1 / np.maximum(r, 1e-9), 1e9) * mm
    out = {f'{a_:g}-{b_:g}mm' if b_ < 1e8 else f'{a_:g}-infmm': round(float(F[(per >= a_) & (per < b_)].sum() / tot), 3) for a_, b_ in BANDS}
    out['share_3_12'] = round(out['3-6mm'] + out['6-12mm'], 3)
    return float(p.std()), out


def main():
    a = sys.argv[1:]
    mm = float(a[a.index('--mm') + 1]) if '--mm' in a else 0.555
    box = tuple(int(x) for x in a[a.index('--box') + 1].split(',')) if '--box' in a else (700, 800, 956, 1056)
    items = [x for i, x in enumerate(a) if '=' in x and not a[i - 1].startswith('--')]
    for it in items:
        lab, path = it.split('=', 1)
        sd, sh = shares(path, box, mm)
        print(f'{lab:28s} hp std {sd:.4f}  share 3-12 mm {sh["share_3_12"]:.3f}  by period {sh}')


if __name__ == '__main__':
    main()
