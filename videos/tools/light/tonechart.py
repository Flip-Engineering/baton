"""Draw the tone-curve chart from tonechart.mjs JSON: one block per curve, rows = swatches, columns = stops."""
import json, sys, colorsys
from PIL import Image, ImageDraw, ImageFont
d = json.load(open(sys.argv[1])); out = sys.argv[2]
names = {'aces_fit': 'ACES fit (Narkowicz; sdf.js, post.js)', 'aces_hill': 'ACES Hill (three; stage, world3d)', 'neutral': 'Khronos PBR Neutral', 'acp': 'ACP display (light/display.js)'}
cw, ch, lw, pad = 64, 30, 210, 10
S, N = d['stops'], d['swatches']
W = lw + cw * len(S) + 2 * pad; bh = 34 + ch * len(N) + 16
img = Image.new('RGB', (W, 40 + bh * len(d['curves'])), (16, 16, 16)); g = ImageDraw.Draw(img)
try: f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13); fb = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 15)
except Exception: f = fb = ImageFont.load_default()
g.text((pad, 10), 'Tone curves on industrial light, -3..+8 stops (column 0 = the colour as authored)', fill=(235, 225, 205), font=fb)
y = 40
for k in d['curves']:
    g.text((pad, y + 6), names.get(k, k), fill=(255, 210, 160) if k == 'acp' else (220, 220, 220), font=fb)
    for j, s in enumerate(S): g.text((pad + lw + j * cw + 22, y + 8), f'{s:+d}' if s else '0', fill=(160, 160, 160), font=f)
    for i, n in enumerate(N):
        yy = y + 30 + i * ch; g.text((pad, yy + 7), n, fill=(200, 200, 200), font=f)
        for j, c in enumerate(d['cells'][k][i]):
            g.rectangle([pad + lw + j * cw, yy, pad + lw + (j + 1) * cw - 2, yy + ch - 2], fill=tuple(c))
    y += bh
img.save(out, quality=92); print(out, img.size)
