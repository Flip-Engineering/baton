"""Contact sheet: python3 scripts/type_c2_sheet.py out.jpg img1 img2 ... [--h 640] [--labels a,b,..] [--band]
--band draws the safe band (y 270 / 1250, cyan) and the UI line (y 1400, magenta) on each cell."""
import sys
from PIL import Image, ImageDraw
args = [a for a in sys.argv[1:] if not a.startswith('--')]
opt = lambda k, d=None: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
out, imgs = args[0], [a for a in args[1:] if a != opt('--h') and a != opt('--labels')]
H = int(opt('--h', 640)); labels = opt('--labels', '').split(',') if opt('--labels') else []
cells = []
for i, p in enumerate(imgs):
    im = Image.open(p).convert('RGB'); w = round(im.width * H / im.height); im = im.resize((w, H), Image.LANCZOS)
    d = ImageDraw.Draw(im); k = H / 1920
    if '--band' in sys.argv:
        for y, c in ((270, (0, 255, 255)), (1250, (0, 255, 255)), (1400, (255, 0, 255))): d.line([(0, y * k), (w, y * k)], fill=c, width=1)
    if i < len(labels) and labels[i]: d.rectangle([0, 0, 8 * len(labels[i]) + 8, 16], fill=(0, 0, 0)); d.text((4, 2), labels[i], fill=(255, 255, 0))
    cells.append(im)
S = Image.new('RGB', (sum(c.width for c in cells) + 4 * (len(cells) - 1), H), (40, 40, 40)); x = 0
for c in cells: S.paste(c, (x, 0)); x += c.width + 4
S.save(out, quality=90)
