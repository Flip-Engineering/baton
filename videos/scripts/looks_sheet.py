"""LOOKS studio: reel sheets + value metrics.

    python3 scripts/looks_sheet.py [after_dir]   -> reel_sheet.jpg (8 looks x 3 sources + source column),
                                                   reel_feed270.jpg (270 px cells), value_metrics.txt
Value metric (same as before/value_metrics.txt): luma at 270x480, 3-value k-means; notan_fit = 1 - within/var,
notan_spread = lightest centre - darkest centre. Praised published frames: spread 0.57-0.85, fit >= 0.88.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

LOOKS = ['KLUTSIS', 'SERIGRAPH', 'INTAGLIO', 'RISO', 'NEWSREEL', 'BROADSIDE', 'SODIUM', 'NOTAN']
SRCS = ['plant', 'crowd', 'payoff']


def notan(img):
    a = np.asarray(img.convert('RGB').resize((270, 480), Image.BILINEAR), dtype=np.float32) / 255.0
    l = (0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]).ravel()
    c = np.percentile(l, [15, 50, 85])
    for _ in range(30):
        lab = np.argmin(np.abs(l[:, None] - c[None, :]), axis=1)
        c = np.array([l[lab == k].mean() if np.any(lab == k) else c[k] for k in range(3)])
    lab = np.argmin(np.abs(l[:, None] - c[None, :]), axis=1)
    within = sum(((l[lab == k] - c[k]) ** 2).sum() for k in range(3)) / len(l)
    var = l.var() + 1e-9
    hsv = np.asarray(img.convert('RGB').resize((270, 480)).convert('HSV'), dtype=np.float32) / 255.0
    return round(float(1 - within / var), 3), round(float(c.max() - c.min()), 2), round(float(l.std()), 3), round(float((hsv[..., 1] > 0.35).mean()), 2)


def main():
    d = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'review', 'studio_looks_c1', 'after')
    st = os.path.join(d, 'stills')
    cols = ['SOURCE'] + LOOKS
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22)
        fs = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 14)
    except OSError:
        font = fs = ImageFont.load_default()
    rows = [s for s in SRCS if os.path.exists(os.path.join(st, f'{s}_SOURCE.jpg'))]
    lines = ['frame  notan_fit  notan_spread  luma_std  sat_frac']
    for cw, name, lab in [(540, 'reel_sheet.jpg', font), (270, 'reel_feed270.jpg', fs)]:
        ch = cw * 16 // 9
        sheet = Image.new('RGB', (cw * len(cols), (ch + 30) * len(rows) + 34), (24, 22, 20))
        dr = ImageDraw.Draw(sheet)
        for i, c in enumerate(cols):
            dr.text((i * cw + 8, 6), c, fill=(240, 230, 210), font=lab)
        for r, s in enumerate(rows):
            for i, c in enumerate(cols):
                p = os.path.join(st, f'{s}_{c}.jpg')
                if not os.path.exists(p):
                    continue
                im = Image.open(p)
                y = 34 + r * (ch + 30)
                sheet.paste(im.resize((cw, ch), Image.LANCZOS), (i * cw, y))
                if cw == 540:
                    m = notan(im)
                    lines.append(f'{s}_{c} {m[0]} {m[1]} {m[2]} {m[3]}')
                    ok = m[1] >= 0.55 and m[0] >= 0.88
                    dr.text((i * cw + 8, y + ch + 4), f'{s} fit {m[0]} spread {m[1]}', fill=(120, 220, 120) if ok else (230, 120, 100), font=fs)
        sheet.save(os.path.join(d, name), quality=90)
    # the published best counterpart of each source beside the looks (the acceptance comparison), 270 px cells
    pub = os.path.join(d, '..', 'before', 'published')
    best = {'plant': 'civ_28.5', 'crowd': 'rw_16.5', 'payoff': 'horde_34.5'}
    cw, ch = 270, 480
    cmp_ = Image.new('RGB', (cw * 10, (ch + 24) * len(rows) + 30), (24, 22, 20)); dr = ImageDraw.Draw(cmp_)
    for i, c in enumerate(['PUBLISHED BEST', 'SOURCE'] + LOOKS):
        dr.text((i * cw + 6, 8), c, fill=(240, 230, 210), font=fs)
    for r, s_ in enumerate(rows):
        y = 30 + r * (ch + 24)
        pb = os.path.join(pub, best[s_] + '.jpg')
        if os.path.exists(pb):
            im = Image.open(pb); cmp_.paste(im.resize((cw, ch), Image.LANCZOS), (0, y)); m = notan(im)
            dr.text((6, y + ch + 4), f'{best[s_]} spread {m[1]}', fill=(200, 200, 200), font=fs)
            lines.append(f'published_{best[s_]} {m[0]} {m[1]} {m[2]} {m[3]}')
        for i, c in enumerate(['SOURCE'] + LOOKS):
            q = os.path.join(st, f'{s_}_{c}.jpg')
            if os.path.exists(q):
                cmp_.paste(Image.open(q).resize((cw, ch), Image.LANCZOS), ((i + 1) * cw, y))
    cmp_.save(os.path.join(d, 'compare_vs_published.jpg'), quality=90)
    with open(os.path.join(d, 'value_metrics.txt'), 'w') as f:
        f.write('\n'.join(lines) + '\n')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
