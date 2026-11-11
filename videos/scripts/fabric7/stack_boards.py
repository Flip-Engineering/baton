#!/usr/bin/env python3
"""Stack pattern-map boards (pattern_map.py outputs) one above the other with a label each: python3 stack_boards.py out.png scale 'LABEL=a.png' 'LABEL=b.png' ... (OUR function plots only)."""
import sys
from PIL import Image, ImageDraw
out, sc = sys.argv[1], float(sys.argv[2]); items = [a.rsplit('=', 1) for a in sys.argv[3:]]
ims = [(l, Image.open(p).convert('RGB')) for l, p in items]; W = max(i.width for _, i in ims); H = sum(i.height + 18 for _, i in ims)
img = Image.new('RGB', (W, H), (8, 8, 8)); d = ImageDraw.Draw(img); y = 0
for l, i in ims:
    d.text((6, y + 3), l, fill=(255, 220, 120)); img.paste(i, (0, y + 18)); y += i.height + 18
if sc != 1: img = img.resize((int(img.width * sc), int(img.height * sc)), Image.LANCZOS)
img.save(out); print(out, img.size)
