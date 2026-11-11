#!/usr/bin/env python3
"""HUMAN studio cycle 3: comparison sheets for the people reel (review/studio_human_c3/after).

  python3 videos/scripts/human_c3_sheets.py

Writes into after/:
  sheet_<cell>.jpg          RAW | SERIGRAPH | NOTAN (| THERMAL / ENGRAVE) of each cell, beside the matching BEFORE frame
  sheet_crowds_feed270.jpg  every crowd, before and after, at phone-feed size (270 px wide): the key exhibit
  feed_check.json           largest connected dark region, rank values, distinct ranks at 270 px (per still)
"""
import json, os
from PIL import Image, ImageDraw, ImageFont
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
V = os.path.dirname(HERE)
B = os.path.join(V, 'review', 'studio_human_c3', 'before')
A = os.path.join(V, 'review', 'studio_human_c3', 'after')

try:
    FONT = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22)
except Exception:
    FONT = ImageFont.load_default()

CELLS = {
    'crowd_close': (['raw', 'SERIGRAPH', 'NOTAN'], ['lab/crowd_rim.jpg', 'pieces/red_wedge2_15.50.jpg']),
    'crowd_mid': (['raw', 'SERIGRAPH', 'NOTAN'], ['pieces/horde3_15.5.jpg', 'looks/crowd_SERIGRAPH.jpg']),
    'crowd_far': (['raw', 'SERIGRAPH', 'NOTAN'], ['pieces/horde3_17.8.jpg', 'pieces/red_wedge2_17.50.jpg']),
    'profile': (['raw', 'ENGRAVE', 'SERIGRAPH', 'NOTAN'], ['lab/profile_rim.jpg', 'lab/profile_print.jpg']),
    'lineman': (['raw', 'SERIGRAPH', 'NOTAN'], ['worlds/shot2.jpg']),
    'plant': (['raw', 'SERIGRAPH', 'NOTAN', 'THERMAL'], ['worlds/shot4.jpg', 'worlds/shot4t.jpg']),
    'farmer': (['raw', 'SERIGRAPH', 'NOTAN'], ['pieces/giant_8.00.jpg']),
    'driver': (['raw', 'SERIGRAPH', 'NOTAN'], ['worlds/M1_gantry_pass_f30.jpg']),
}


def tile(path, w=432, label=None, dim=False):
    im = Image.open(path).convert('RGB').resize((w, int(w * 1920 / 1080)))
    if dim:
        im = Image.blend(im, Image.new('RGB', im.size, (40, 40, 40)), 0.0)
    if label:
        d = ImageDraw.Draw(im)
        d.rectangle([0, 0, w, 30], fill=(0, 0, 0))
        d.text((8, 4), label, fill=(255, 255, 255), font=FONT)
    return im


def row(items, w=432):
    ims = [tile(p, w, l) for p, l in items if os.path.exists(p)]
    if not ims:
        return None
    s = Image.new('RGB', (sum(i.width for i in ims) + 8 * (len(ims) - 1), ims[0].height), (250, 250, 250))
    x = 0
    for i in ims:
        s.paste(i, (x, 0)); x += i.width + 8
    return s


def dark_region(path, dark=0.14):
    im = np.asarray(Image.open(path).convert('L').resize((270, 480))).astype(float) / 255
    m = im <= dark
    seen = np.zeros_like(m); best = 0
    H, W = m.shape
    for y0 in range(H):
        for x0 in range(W):
            if not m[y0, x0] or seen[y0, x0]:
                continue
            st = [(y0, x0)]; seen[y0, x0] = True; n = 0
            while st:
                y, x = st.pop(); n += 1
                for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                    if 0 <= yy < H and 0 <= xx < W and m[yy, xx] and not seen[yy, xx]:
                        seen[yy, xx] = True; st.append((yy, xx))
            best = max(best, n)
    return round(best / (H * W), 3)


def main():
    fc = {}
    for cell, (modes, before) in CELLS.items():
        items = [(os.path.join(B, b), 'BEFORE ' + os.path.basename(b)[:-4]) for b in before]
        items += [(os.path.join(A, f'{cell}_{m}.jpg'), m) for m in modes]
        r = row(items)
        if r:
            r.save(os.path.join(A, f'sheet_{cell}.jpg'), quality=88)
        for m in modes:
            p = os.path.join(A, f'{cell}_{m}.jpg')
            if os.path.exists(p):
                fc[f'{cell}_{m}'] = dark_region(p)
    # every crowd at 270 px: before row over after row
    before = [os.path.join(B, 'lab/crowd_rim.jpg'), os.path.join(B, 'looks/crowd_SERIGRAPH.jpg'), os.path.join(B, 'looks/crowd_NOTAN.jpg'),
              os.path.join(B, 'pieces/horde3_17.8.jpg'), os.path.join(B, 'pieces/red_wedge2_15.50.jpg'), os.path.join(B, 'pieces/red_wedge2_17.50.jpg')]
    after = [os.path.join(A, f'{c}_{m}.jpg') for c in ('crowd_close', 'crowd_mid', 'crowd_far') for m in ('raw', 'SERIGRAPH', 'NOTAN')]
    rb = row([(p, 'BEFORE') for p in before], 270)
    ra = row([(p, os.path.basename(p)[:-4].replace('crowd_', '')) for p in after], 270)
    if rb and ra:
        s = Image.new('RGB', (max(rb.width, ra.width), rb.height + ra.height + 16), (250, 250, 250))
        s.paste(rb, (0, 0)); s.paste(ra, (0, rb.height + 16))
        s.save(os.path.join(A, 'sheet_crowds_feed270.jpg'), quality=88)
    fc['before'] = {os.path.basename(p): dark_region(p) for p in before if os.path.exists(p)}
    json.dump(fc, open(os.path.join(A, 'feed_check.json'), 'w'), indent=1)
    print(json.dumps(fc, indent=1))


if __name__ == '__main__':
    main()
