"""WORLDS studio c1 pass 2: the in-piece swaps, one per target piece, through that piece's own grade.

    python3 videos/scripts/worlds_swaps.py
      -> review/studio_worlds_c1/after/r2/SWAP_<piece>.jpg   (the published frame | the pass-2 world in the piece's grade + line)
         review/studio_worlds_c1/after/SWAPS_in_piece.jpg     (all swaps on one sheet)

How each swap takes the piece's grade:
  native     the lab renders the world with the piece's look (HORDE_RED; PRODUCTIVE's FLIR v2; the OTF / TYPE legends are set
             on the gantry panel itself, at MUTCD scale, lit by the headlights)
  transfer   the piece's colour statistics are moved onto the pass-2 still (Reinhard, per channel in Lab, measured on the
             piece frame with its type masked out), for pieces whose grade lives in their own post chain (COMMON WEALTH, OTF)
  print      CIVILIZATION: an AM halftone in the piece's ink on its paper (the engraved-plate grammar), built here in numpy
The line is re-set in the piece's position and weight (League Spartan 900 / Overpass 900, as the kit's type faces).
"""
import io
import os

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
R = os.path.join(HERE, '..', 'review', 'studio_worlds_c1')
B, A2 = os.path.join(R, 'before', 'frames'), os.path.join(R, 'after', 'r2')
FONTS = os.path.join(HERE, '..', 'web', 'assets', 'fonts')


def ttf(name, size):
    """woff -> ttf (fontTools) once, then a PIL font."""
    out = os.path.join('/tmp', name.replace('.woff', '.ttf'))
    if not os.path.exists(out):
        from fontTools.ttLib import TTFont
        f = TTFont(os.path.join(FONTS, name))
        f.flavor = None
        f.save(out)
    return ImageFont.truetype(out, size)


def lab_stats(img, mask=None):
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
    px = lab[mask] if mask is not None else lab.reshape(-1, 3)
    return px.mean(0), px.std(0) + 1e-3


def transfer(src_bgr, ref_bgr, k=0.85):
    """Reinhard colour transfer ref -> src; the reference's type (saturated, bright glyph pixels) is masked out."""
    hsv = cv2.cvtColor(ref_bgr, cv2.COLOR_BGR2HSV)
    mask = ~((hsv[..., 1] > 150) & (hsv[..., 2] > 200))
    ms, ss = lab_stats(src_bgr)
    mr, sr = lab_stats(ref_bgr, mask)
    lab = cv2.cvtColor(src_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    out = (lab - ms) / ss * sr + mr
    out = lab * (1 - k) + out * k
    return cv2.cvtColor(np.clip(out, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)


def halftone(bgr, cell=9, ink=(34, 30, 168), paper=(206, 222, 232), angle=15):
    """AM halftone of the luminance in one ink on paper (BGR)."""
    g = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.
    lo, hi = np.percentile(g, 2), np.percentile(g, 99.5)                 # a night plate prints as a day engraving: stretch, lift the mids
    g = np.clip((g - lo) / max(hi - lo, 1e-3), 0, 1) ** 0.45
    g = cv2.GaussianBlur(g, (0, 0), cell * 0.35)
    H, W = g.shape
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    a = np.radians(angle)
    u = (xx * np.cos(a) + yy * np.sin(a)) / cell
    v = (-xx * np.sin(a) + yy * np.cos(a)) / cell
    du, dv = u - np.floor(u) - 0.5, v - np.floor(v) - 0.5
    d = np.sqrt(du * du + dv * dv)
    rad = np.sqrt(np.clip(1 - g, 0, 1) / np.pi) * 1.05             # dot area ~ ink coverage
    cov = np.clip((rad - d) * cell * 0.9 + 0.5, 0, 1)
    out = np.empty((H, W, 3), np.float32)
    for c in range(3):
        out[..., c] = paper[c] * (1 - cov) + ink[c] * cov
    noise = np.random.default_rng(3).normal(0, 4, (H, W, 1))
    return np.clip(out + noise, 0, 255).astype(np.uint8)


def text(img, line, y, font, fill, glow=None, stroke=None, box=None, squeeze=0.86):
    """Set one line, centred, horizontally squeezed (a condensed cut of the face), with optional neon glow or a box."""
    W, H = img.size
    tmp = Image.new('RGBA', (W * 2, font.size * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(tmp)
    tw = d.textlength(line, font=font)
    d.text((20, 10), line, font=font, fill=fill, stroke_width=stroke[0] if stroke else 0, stroke_fill=stroke[1] if stroke else None)
    bb = tmp.getbbox()
    tmp = tmp.crop(bb)
    tmp = tmp.resize((int(tmp.width * squeeze), tmp.height), Image.LANCZOS)
    x = (W - tmp.width) // 2
    base = img.convert('RGBA')
    if box:
        bd = ImageDraw.Draw(base)
        pad = 22
        bd.rectangle([x - pad, y - pad * 0.6, x + tmp.width + pad, y + tmp.height + pad * 0.6], fill=box)
    if glow:
        g = Image.new('RGBA', base.size, (0, 0, 0, 0))
        g.paste(tmp, (x, y), tmp)
        r, gg, b, a = g.split()
        col = Image.new('RGBA', base.size, glow + (0,))
        col.putalpha(a.filter(ImageFilter.GaussianBlur(18)).point(lambda v: min(255, v * 2)))
        base = Image.alpha_composite(base, col)
    base.paste(tmp, (x, y), tmp)
    return base.convert('RGB')


def cv2pil(a):
    return Image.fromarray(cv2.cvtColor(a, cv2.COLOR_BGR2RGB))


def load(p):
    return cv2.imread(p)


def swap(name, before, still, how, **k):
    ref = load(os.path.join(B, before + '.jpg'))
    src = load(os.path.join(A2, still + '.jpg'))
    if src is None or ref is None:
        print('missing', before, still)
        return None
    if how == 'transfer':
        out = cv2pil(transfer(src, ref, k.get('amt', 0.85)))
    elif how == 'print':
        out = cv2pil(halftone(src))
    else:
        out = cv2pil(src)
    if k.get('line'):
        L = k['line']
        out = text(out, L['text'], L['y'], ttf(L.get('font', 'league-spartan-latin-900-normal.woff'), L['size']), L['fill'],
                   glow=L.get('glow'), stroke=L.get('stroke'), box=L.get('box'), squeeze=L.get('squeeze', 0.86))
    out.save(os.path.join(A2, f'SWAP_{name}.jpg'), quality=92)
    return name, before, cv2pil(ref), out


SWAPS = [
    ('cw_night_aerial', 'cw_12.4', 'shot2', 'transfer', dict(amt=0.7, line=dict(text='THE NEXT TOWN.', y=820, size=112, fill=(255, 120, 40, 255), glow=(255, 90, 20)))),
    ('cw_storm', 'cw_0.5', 'shot6', 'transfer', dict(amt=0.55, line=dict(text='OHIO GOES RED.', y=560, size=110, fill=(38, 36, 40, 255)))),
    ('otf_exit', 'otf_0.4', 'shot3_otf', 'transfer', dict(amt=0.6)),
    ('type_c14', 'type_c14_highway_payoff', 'shot3_type', 'native', {}),
    ('horde_plains', 'horde_2.5', 'shot1_horde', 'native', {}),
    ('prod_flir', 'prod_20.5', 'shot4t', 'native', dict(line=dict(text='HUMANITY RUNS HOT.', y=1060, size=96, fill=(255, 255, 255, 255), box=(92, 20, 140, 235),
                                                                  font='overpass-latin-900-normal.woff', squeeze=0.8))),
    ('civ_plant', 'civ_28.5', 'shot4', 'print', dict(line=dict(text='WE BUILD EVERYTHING.', y=330, size=84, fill=(24, 20, 20, 255), font='overpass-latin-900-normal.woff', squeeze=0.8))),
]


def main():
    tiles = []
    TW, TH = 360, 640
    f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 14)
    for name, before, still, how, k in SWAPS:
        r = swap(name, before, still, how, **k)
        if not r:
            continue
        _, _, ref, out = r
        pair = Image.new('RGB', (TW * 2 + 8, TH + 26), (14, 14, 14))
        for i, (im, lab) in enumerate([(ref, f'NOW {before}'), (out, f'PASS 2 {still} ({how})')]):
            t = im.resize((TW, TH), Image.LANCZOS)
            pair.paste(t, (i * (TW + 8), 26))
            ImageDraw.Draw(pair).text((i * (TW + 8) + 4, 5), lab, font=f, fill=(240, 220, 90) if i else (200, 200, 200))
        tiles.append(pair)
    cols = 2
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * (TW * 2 + 24), rows * (TH + 40)), (8, 8, 8))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % cols) * (TW * 2 + 24), (i // cols) * (TH + 40)))
    sheet.save(os.path.join(R, 'after', 'SWAPS_in_piece.jpg'), quality=88)
    print('swaps', len(tiles))


if __name__ == '__main__':
    main()
