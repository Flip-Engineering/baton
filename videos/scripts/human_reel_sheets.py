#!/usr/bin/env python3
"""human_reel_sheets.py: contact sheets for the HUMAN studio reel (cycle 2).

For each subject: its renderings side by side at half size, each with its FEED-SIZE TWIN underneath (the frame shrunk
to 390x693, the size a phone feed shows it, then shown 1:1), so every cell is judged at the size it is seen. Also a
before/after pair per subject when --before is given (same file names).

    python3 videos/scripts/human_reel_sheets.py review/studio_human_c2/after [--before review/studio_human_c2/before]
"""
import argparse
import os

from PIL import Image, ImageDraw, ImageFont

SUBJECTS = ['profile', 'hand', 'climb', 'crowd', 'rider', 'face']
MODES = ['rim', 'print', 'lit']
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'


def font(n):
    try:
        return ImageFont.truetype(FONT, n)
    except Exception:
        return ImageFont.load_default()


def cell(path, label):
    im = Image.open(path).convert('RGB')
    half = im.resize((540, 960), Image.LANCZOS)
    feed = im.resize((390, 693), Image.LANCZOS)
    c = Image.new('RGB', (540, 960 + 693 + 60), (16, 16, 16))
    c.paste(half, (0, 30))
    c.paste(feed, ((540 - 390) // 2, 960 + 50))
    d = ImageDraw.Draw(c)
    d.text((6, 6), label, fill=(235, 235, 235), font=font(16))
    d.text((6, 960 + 32), 'feed size (390x693, 1:1)', fill=(170, 170, 170), font=font(12))
    return c


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dir')
    ap.add_argument('--before')
    ap.add_argument('--extra', default='crowd:halftone,crowd:rim_sea,crowd:rim_column')
    a = ap.parse_args()
    for s in SUBJECTS:
        cells = [cell(os.path.join(a.dir, f'{s}_{m}.jpg'), f'{s} {m}') for m in MODES if os.path.exists(os.path.join(a.dir, f'{s}_{m}.jpg'))]
        if s == 'crowd':
            for e in a.extra.split(','):
                f = os.path.join(a.dir, e.replace(':', '_') + '.jpg')
                if os.path.exists(f):
                    cells.append(cell(f, e.replace('crowd:', 'crowd ')))
        if not cells:
            continue
        sheet = Image.new('RGB', (540 * len(cells), cells[0].height), (8, 8, 8))
        for k, c in enumerate(cells):
            sheet.paste(c, (540 * k, 0))
        sheet.save(os.path.join(a.dir, f'sheet_{s}.jpg'), quality=84)
        if a.before:
            pairs = [(os.path.join(a.before, f'{s}_{m}.jpg'), os.path.join(a.dir, f'{s}_{m}.jpg'), m) for m in MODES]
            pairs = [p for p in pairs if os.path.exists(p[0]) and os.path.exists(p[1])]
            if pairs:
                ab = Image.new('RGB', (540 * 2 * len(pairs), 990), (8, 8, 8))
                d = ImageDraw.Draw(ab)
                for k, (b, af, m) in enumerate(pairs):
                    ab.paste(Image.open(b).convert('RGB').resize((540, 960)), (1080 * k, 30))
                    ab.paste(Image.open(af).convert('RGB').resize((540, 960)), (1080 * k + 540, 30))
                    d.text((1080 * k + 6, 6), f'{s} {m}: BEFORE (cycle 1)', fill=(200, 200, 200), font=font(16))
                    d.text((1080 * k + 546, 6), f'{s} {m}: AFTER (cycle 2)', fill=(255, 220, 120), font=font(16))
                ab.save(os.path.join(a.dir, f'ab_{s}.jpg'), quality=84)
    print('sheets in', a.dir)


if __name__ == '__main__':
    main()
