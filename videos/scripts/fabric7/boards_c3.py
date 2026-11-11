#!/usr/bin/env python3
"""FABRIC7 c3 (8 Oct): BEFORE | AFTER boards from DELIVERED plates (ours only: Cycles stills of CAST's lineup people and engine plates; no reference photograph).
   python3 videos/scripts/fabric7/boards_c3.py OUT.jpg --row 'TITLE|x0,y0,x1,y1|zoom|label=path,label=path,...' [--row ...] [--cell 420] [--quality 88]
One row per --row: the same pixel box cut from every plate, enlarged by `zoom` (nearest for zoom > 1 keeps the pixels honest; lanczos below 1), the label under each cell, the row's title above it; rows
stack top to bottom. Cells are centred on a dark gutter; the board is a JPEG. Example (the L21 chest, native pixels at 2x, v6 | 7.2 | 7.6):
   --row 'L21 chest 1:1 x2|700,800,956,1056|2|v6=videos/out/gpu/1007-215501/cyc_v6_L21_m32_black_bust_over_work_studior5.png,rev 7.6=videos/out/gpu/1008-095646-.../cyc_v6_L21_m32_black_bust_over_work_studior5.png'
Credit line: our own renders (OUR figures; no scan, no photograph)."""
import sys
from PIL import Image, ImageDraw, ImageFont


def font(sz):
    for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSansMono-Bold.ttf'):
        try:
            return ImageFont.truetype(f, sz)
        except Exception:
            pass
    return ImageFont.load_default()


def row(spec, gut=6, fs=15):
    title, box, zoom, cells = spec.split('|')
    x0, y0, x1, y1 = [int(v) for v in box.split(',')]
    z = float(zoom)
    ims = []
    for c in cells.split(','):
        lab, path = c.split('=', 1)
        im = Image.open(path).convert('RGB').crop((x0, y0, x1, y1))
        W, H = im.size
        im = im.resize((round(W * z), round(H * z)), Image.NEAREST if z >= 1.5 else Image.LANCZOS)
        ims.append((lab, im))
    w = sum(i.size[0] for _, i in ims) + gut * (len(ims) + 1)
    h = max(i.size[1] for _, i in ims) + 2 * fs + 14
    out = Image.new('RGB', (w, h), (18, 18, 20))
    d = ImageDraw.Draw(out)
    d.text((gut, 3), title, fill=(236, 232, 224), font=font(fs))
    x = gut
    for lab, im in ims:
        out.paste(im, (x, fs + 8))
        d.rectangle((x, fs + 8 + im.size[1] + 1, x + min(im.size[0], 9 * len(lab) + 8), fs + 8 + im.size[1] + fs + 5), fill=(0, 0, 0))
        d.text((x + 4, fs + 8 + im.size[1] + 2), lab, fill=(242, 238, 230), font=font(fs - 2))
        x += im.size[0] + gut
    return out


def main(a):
    out = a[0]
    rows = [a[i + 1] for i, v in enumerate(a) if v == '--row']
    q = int(a[a.index('--quality') + 1]) if '--quality' in a else 88
    if not rows:
        raise SystemExit(__doc__)
    R = [row(s) for s in rows]
    W = max(r.size[0] for r in R)
    H = sum(r.size[1] for r in R)
    B = Image.new('RGB', (W, H), (18, 18, 20))
    y = 0
    for r in R:
        B.paste(r, (0, y))
        y += r.size[1]
    B.save(out, quality=q)
    print(out, B.size)


if __name__ == '__main__':
    main(sys.argv[1:])
