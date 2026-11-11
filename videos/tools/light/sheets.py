"""LIGHTING c1 after-sheets: before/after pairs at full size, a 270 px contact sheet (phone feed width), the impact strip.
  python3 videos/tools/light/sheets.py <after_dir>
Reads <after_dir>/raw/{after,before}_<light>_1.00.jpg, board_1.00.jpg, impact_frames/impact_f*.jpg; writes <after_dir>/sheets/.
"""
import sys, os, glob
from PIL import Image, ImageDraw, ImageFont
D = sys.argv[1]; R = os.path.join(D, 'raw'); O = os.path.join(D, 'sheets'); os.makedirs(O, exist_ok=True)
try:
    F = lambda s: ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', s)
    f = lambda s: ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', s)
except Exception:
    F = f = lambda s: ImageFont.load_default()
LIGHTS = [('dawn', 'low dawn sun through haze'), ('noon', 'overcast noon'), ('night', 'night: sodium masts, mercury flood, welding arc'), ('furnace', 'furnace tap: molten metal, sparks, smoke')]

def cap(im, text, sub=None, size=34):
    g = ImageDraw.Draw(im); w = g.textlength(text, font=F(size)); g.rectangle([0, 0, w + 36, size + 26 + (size if sub else 0)], fill=(10, 10, 10))
    g.text((18, 10), text, fill=(236, 228, 212), font=F(size))
    if sub: g.text((18, 14 + size), sub, fill=(190, 182, 168), font=f(int(size * 0.7)))
    return im

# full-size before / after pairs
for L, desc in LIGHTS:
    a, b = os.path.join(R, f'after_{L}_1.00.jpg'), os.path.join(R, f'before_{L}_1.00.jpg')
    if not (os.path.exists(a) and os.path.exists(b)): continue
    A, B = Image.open(a).convert('RGB'), Image.open(b).convert('RGB')
    o = Image.new('RGB', (A.width * 2 + 20, A.height), (16, 16, 16)); o.paste(cap(B.copy(), 'BEFORE: today\'s default', 'objects/stage.js: ACES, key+hemi+rim, GTAO, plain materials'), (0, 0)); o.paste(cap(A.copy(), 'AFTER: light/ pipeline', desc), (A.width + 20, 0))
    o.save(os.path.join(O, f'ba_{L}.jpg'), quality=90)

# 270 px contact: before row, after row
W = 270; H = 480
cells = [(f'before_{L}', f'before: {L}') for L, _ in LIGHTS] + [(f'after_{L}', f'after: {L}') for L, _ in LIGHTS]
o = Image.new('RGB', (4 * (W + 10) + 10, 2 * (H + 40) + 70), (14, 14, 14)); g = ImageDraw.Draw(o)
g.text((12, 14), 'LIGHTING c1: the same set, today\'s default (top) and the light/ pipeline (bottom), at 270 px', fill=(236, 228, 212), font=F(20))
for i, (k, t) in enumerate(cells):
    p = os.path.join(R, k + '_1.00.jpg')
    if not os.path.exists(p): continue
    x, y = 10 + (i % 4) * (W + 10), 60 + (i // 4) * (H + 40)
    o.paste(Image.open(p).convert('RGB').resize((W, H), Image.LANCZOS), (x, y)); g.text((x, y + H + 6), t, fill=(200, 196, 186), font=f(16))
o.save(os.path.join(O, 'contact_270.jpg'), quality=92)

# board at 270 and the impact strip
bp = os.path.join(R, 'board_1.00.jpg')
fr = sorted(glob.glob(os.path.join(R, 'impact_frames', 'impact_f*.jpg')))
if fr:
    sel = [fr[round(i * (len(fr) - 1) / 7)] for i in range(8)] if len(fr) >= 8 else fr
    s = Image.new('RGB', (len(sel) * (W + 6) + 6, H + 50), (14, 14, 14)); g = ImageDraw.Draw(s)
    for i, p in enumerate(sel):
        s.paste(Image.open(p).convert('RGB').resize((W, H), Image.LANCZOS), (6 + i * (W + 6), 6))
        n = int(os.path.basename(p)[len('impact_f'):-4]); g.text((8 + i * (W + 6), H + 14), f'{n / 30:.2f} s', fill=(200, 196, 186), font=f(18))
    s.save(os.path.join(O, 'impact_strip_270.jpg'), quality=90)
print('sheets in', O)
