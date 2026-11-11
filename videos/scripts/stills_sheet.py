"""Labelled contact sheet of stills (TOOLING WM1, 2026-09-28).

    python3 videos/scripts/stills_sheet.py OUT.jpg [--bpm 126] [--title machines] [--cols 6] [--cell 360] STILL ...

STILL is a jpg path, optionally "path@t@beat" (render.mjs --sheet passes these). Without @, the time is read from the
render.mjs name <scene>_<t>.jpg and the beat is t / (60/bpm) when --bpm is given. Each cell gets a strip:
"b8  3.81 s" so a sheet reads in beats, the way the scripts and briefs are written. Sorted by time.
"""
import argparse
import os
import re
import sys

from PIL import Image, ImageDraw, ImageFont


def parse(entry, bpm):
    parts = entry.split('@')
    f = parts[0]
    t = float(parts[1]) if len(parts) > 1 and parts[1] else None
    b = float(parts[2]) if len(parts) > 2 and parts[2] else None
    if t is None:
        m = re.search(r'_(-?\d+(?:\.\d+)?)\.jpe?g$', f)
        t = float(m.group(1)) if m else None
    if b is None and t is not None and bpm:
        b = round(t / (60.0 / bpm), 2)
    return f, t, b


def font(px):
    for p in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf'):
        if os.path.exists(p):
            return ImageFont.truetype(p, px)
    return ImageFont.load_default()


def sheet(out, entries, bpm=None, title=None, cols=6, cell=360):
    rows = sorted((parse(e, bpm) for e in entries), key=lambda r: (r[1] is None, r[1] or 0))
    rows = [r for r in rows if os.path.exists(r[0])]
    if not rows:
        raise SystemExit('stills_sheet: no stills found')
    cw, ch, lab = cell, cell * 16 // 9, 30
    cols = min(cols, len(rows))
    nr = (len(rows) + cols - 1) // cols
    head = 40 if title else 0
    im = Image.new('RGB', (cw * cols, head + (ch + lab) * nr), (18, 18, 18))
    d = ImageDraw.Draw(im)
    f, ft = font(18), font(24)
    if title:
        d.text((10, 8), f"{title}   {len(rows)} stills" + (f"   {bpm:g} BPM" if bpm else ''), fill=(235, 230, 215), font=ft)
    for i, (p, t, b) in enumerate(rows):
        x, y = (i % cols) * cw, head + (i // cols) * (ch + lab)
        im.paste(Image.open(p).convert('RGB').resize((cw, ch)), (x, y))
        label = ' '.join(s for s in ((f'b{b:g}' if b is not None else ''), (f'{t:.2f} s' if t is not None else os.path.basename(p))) if s)
        d.text((x + 8, y + ch + 5), label, fill=(229, 50, 57) if b is not None and float(b).is_integer() else (235, 230, 215), font=f)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    im.save(out, quality=88)
    print(f'sheet: {out} ({len(rows)} stills, {cols}x{nr})')


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('out')
    ap.add_argument('stills', nargs='+')
    ap.add_argument('--bpm', type=float)
    ap.add_argument('--title')
    ap.add_argument('--cols', type=int, default=6)
    ap.add_argument('--cell', type=int, default=360)
    a = ap.parse_args()
    sys.exit(sheet(a.out, a.stills, a.bpm, a.title, a.cols, a.cell))
