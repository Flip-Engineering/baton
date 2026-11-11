#!/usr/bin/env python3
"""MODELING c3: boards for MECHA's heavy giant (designs at full size and at 270 px feed size; the site beside the painting)."""
import sys
from PIL import Image, ImageDraw, ImageFont
W = '/home/user/acp-agitprop/videos/review/studio_modeling_c3/after/work/heavy/'
O = '/home/user/acp-agitprop/videos/review/studio_modeling_c3/after/'
SRC = '/home/user/acp-agitprop/videos/sources/acp_art/'
try: F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 22); FS = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 17)
except Exception: F = FS = ImageFont.load_default()
BG = (238, 236, 230)
def designs():
    names = [('HULL', 'ship and dam: prow chest, bridge sunk between setback shoulders'), ('SETBACK', 'skyscraper: setback tiers, piers, glazed crown'), ('FRAME', "Eiffel's armature left visible: lattice limbs, cab in the cage")]
    cw, ch = 540, 960; s = Image.new('RGB', (cw * 3 + 40, ch + 290 + 110), BG); d = ImageDraw.Draw(s)
    for i, (n, idea) in enumerate(names):
        x = 10 + i * (cw + 10); s.paste(Image.open(W + f't_{n}_three.jpg'), (x, 70))
        d.text((x, 12), n, fill=(20, 20, 20), font=F); d.text((x, 40), idea, fill=(70, 70, 70), font=FS)
        sil = Image.open(W + f's_{n}.jpg').resize((152, 270), Image.LANCZOS); col = Image.open(W + f't_{n}_three.jpg').resize((152, 270), Image.LANCZOS)
        s.paste(sil, (x + 60, ch + 90)); s.paste(col, (x + 60 + 170, ch + 90))
    d.text((10, ch + 360), 'Bottom row: each design at feed size (270 px tall), silhouette on grey and in colour. Same rig, same scale (people are 1.75 m).', fill=(60, 60, 60), font=FS)
    s.save(O + '01_three_designs_full_and_270.jpg', quality=90)
def site():
    p = Image.open(SRC + '1672291989113683970.jpg').convert('RGB'); a = Image.open(W + 'site_yard.jpg')
    h = 960; p = p.resize((int(p.width * h / p.height), h), Image.LANCZOS)
    b = Image.open(W + 'site_yard_SETBACK.jpg') if len(sys.argv) < 2 else None
    ims = [p, a] + ([b] if b else []); s = Image.new('RGB', (sum(i.width for i in ims) + 10 * (len(ims) + 1), h + 60), BG); d = ImageDraw.Draw(s); x = 10
    labels = ['the party\'s own pick: blast furnace under construction (Soviet painting)', 'ours: HULL at build 0.64 (chest in red-lead)', 'SETBACK at build 0.6']
    for i, im in enumerate(ims): s.paste(im, (x, 50)); d.text((x, 14), labels[i], fill=(30, 30, 30), font=FS); x += im.width + 10
    s.save(O + '02_site_beside_the_painting.jpg', quality=90)
if __name__ == '__main__':
    designs(); site()
