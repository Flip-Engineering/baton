"""WORLDS studio c1: before/after sheets for the judge.

    python3 videos/scripts/worlds_sheet.py
      -> review/studio_worlds_c1/after/PAIR_<n>_<place>.jpg   (three current piece frames | the new still(s)), one per place
         review/studio_worlds_c1/after/SHEET_after_six_places.jpg  (all six rows, the same layout as BEFORE_six_places.jpg)
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
R = os.path.join(HERE, '..', 'review', 'studio_worlds_c1')
B, A = os.path.join(R, 'before', 'frames'), os.path.join(R, 'after')
sys.path.insert(0, HERE)

PLACES = [
    ('1', 'PLAINS AERIAL, DUSK', ['cw_15.3', 'cw_18.5', 'horde_2.5'], ['shot1']),
    ('2', 'PLAINS AT NIGHT, TOWNS + ROADS', ['cw_12.4', 'cw_2.2', 'otf_17.5'], ['shot2']),
    ('3', 'HIGHWAY + GANTRY, REAL SCALE', ['otf_0.4', 'otf_27.5', 'type_c14_highway_payoff'], ['shot3']),
    ('4', 'INDUSTRIAL PLANT AT NIGHT', ['cw_6.4', 'prod_20.5', 'civ_28.5'], ['shot4', 'shot4t']),
    ('5', 'CITY SKYLINE AT NIGHT', ['otf_25.5', 'horde_12.5', 'type_c05_skylight_hook'], ['shot5']),
    ('6', 'STORM FRONT OVER FIELDS', ['cw_0.5', 'cw_4.5', 'civ_2.5'], ['shot6', 'shot6b']),
]
TW, TH = 360, 640


def font(sz):
    for f in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf']:
        if os.path.exists(f):
            return ImageFont.truetype(f, sz)
    return ImageFont.load_default()


def tile(p, label, hi=False):
    im = Image.open(p).convert('RGB').resize((TW, TH), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, TW, 22], fill=(200, 30, 30) if hi else (0, 0, 0))
    d.text((6, 3), label, fill=(255, 255, 255), font=font(14))
    return im


def main():
    rows = []
    for n, name, before, after in PLACES:
        bt = []
        for b in before:
            p = os.path.join(B, b + '.jpg')
            if os.path.exists(p):
                bt.append(tile(p, 'BEFORE ' + b))
        at = [tile(os.path.join(A, a + '.jpg'), 'AFTER ' + a, True) for a in after if os.path.exists(os.path.join(A, a + '.jpg'))]
        row = Image.new('RGB', (TW * (len(bt) + len(at)) + 12, TH + 40), (14, 14, 14))
        d = ImageDraw.Draw(row)
        d.text((8, 8), f'{n}  {name}', fill=(240, 220, 90), font=font(22))
        x = 0
        for t in bt:
            row.paste(t, (x, 40)); x += TW
        x += 12
        for t in at:
            row.paste(t, (x, 40)); x += TW
        row.save(os.path.join(A, f'PAIR_{n}_{name.split(",")[0].split(" ")[0].lower()}.jpg'), quality=90)
        rows.append(row)
    Wd = max(r.width for r in rows)
    sheet = Image.new('RGB', (Wd, sum(r.height for r in rows)), (14, 14, 14))
    y = 0
    for r in rows:
        sheet.paste(r, (0, y)); y += r.height
    sheet.save(os.path.join(A, 'SHEET_before_after_six_places.jpg'), quality=88)
    print('sheets written;', len(rows), 'rows')


if __name__ == '__main__':
    main()
