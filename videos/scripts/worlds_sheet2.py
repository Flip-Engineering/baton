"""WORLDS studio c1 pass 2: the three-way sheets for the judge.

    python3 videos/scripts/worlds_sheet2.py
      -> review/studio_worlds_c1/after/r2/THREE_<n>_<place>.jpg  (current pieces | c1 build | pass-2 build), one per place
         review/studio_worlds_c1/after/SHEET_three_ways_six_places.jpg (all six rows)
"""
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
R = os.path.join(HERE, '..', 'review', 'studio_worlds_c1')
B, A1, A2 = os.path.join(R, 'before', 'frames'), os.path.join(R, 'after'), os.path.join(R, 'after', 'r2')
PLACES = [
    ('1', 'PLAINS AERIAL, DUSK', ['cw_15.3', 'cw_18.5', 'horde_2.5'], ['shot1'], ['shot1', 'shot1_horde']),
    ('2', 'PLAINS AT NIGHT, TOWNS + ROADS', ['cw_12.4', 'cw_2.2', 'otf_17.5'], ['shot2'], ['shot2']),
    ('3', 'HIGHWAY + GANTRY, REAL SCALE', ['otf_0.4', 'otf_27.5', 'type_c14_highway_payoff'], ['shot3'], ['shot3', 'shot3_type']),
    ('4', 'INDUSTRIAL PLANT AT NIGHT', ['cw_6.4', 'prod_20.5', 'civ_28.5'], ['shot4', 'shot4t'], ['shot4', 'shot4t']),
    ('5', 'CITY SKYLINE AT NIGHT', ['otf_25.5', 'horde_12.5', 'type_c05_skylight_hook'], ['shot5'], ['shot5']),
    ('6', 'STORM FRONT OVER FIELDS', ['cw_0.5', 'cw_4.5', 'civ_2.5'], ['shot6', 'shot6b'], ['shot6', 'shot6b', 'shot6m']),
]
TW, TH = 300, 533


def font(sz):
    return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', sz)


def tile(p, label, col):
    im = Image.open(p).convert('RGB').resize((TW, TH), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, TW, 20], fill=col)
    d.text((5, 3), label, fill=(255, 255, 255), font=font(12))
    return im


def main():
    rows = []
    for n, name, before, c1, r2 in PLACES:
        groups = [[tile(os.path.join(B, b + '.jpg'), 'NOW ' + b, (0, 0, 0)) for b in before if os.path.exists(os.path.join(B, b + '.jpg'))],
                  [tile(os.path.join(A1, a + '.jpg'), 'C1 ' + a, (90, 90, 90)) for a in c1 if os.path.exists(os.path.join(A1, a + '.jpg'))],
                  [tile(os.path.join(A2, a + '.jpg'), 'PASS 2 ' + a, (200, 30, 30)) for a in r2 if os.path.exists(os.path.join(A2, a + '.jpg'))]]
        w = sum(len(g) for g in groups) * TW + 2 * 14
        row = Image.new('RGB', (w, TH + 36), (14, 14, 14))
        ImageDraw.Draw(row).text((8, 7), f'{n}  {name}', fill=(240, 220, 90), font=font(20))
        x = 0
        for g in groups:
            for t in g:
                row.paste(t, (x, 36)); x += TW
            x += 14
        row.save(os.path.join(A2, f'THREE_{n}_{name.split(",")[0].split(" ")[0].lower()}.jpg'), quality=90)
        rows.append(row)
    Wd = max(r.width for r in rows)
    sheet = Image.new('RGB', (Wd, sum(r.height for r in rows)), (14, 14, 14))
    y = 0
    for r in rows:
        sheet.paste(r, (0, y)); y += r.height
    sheet.save(os.path.join(A1, 'SHEET_three_ways_six_places.jpg'), quality=86)
    print('three-way sheet', sheet.size)


if __name__ == '__main__':
    main()
