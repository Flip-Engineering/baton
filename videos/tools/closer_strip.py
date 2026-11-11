"""python3 tools/closer_strip.py out.jpg img1 img2 ... [--h 640]  -> side-by-side contact strip (labels = file stems)"""
import sys
from PIL import Image, ImageDraw
a = sys.argv[1:]; H = 640
if '--h' in a: i = a.index('--h'); H = int(a[i + 1]); del a[i:i + 2]
out, files = a[0], a[1:]
ims = [Image.open(f).convert('RGB') for f in files]; ims = [im.resize((int(im.width * H / im.height), H)) for im in ims]
S = Image.new('RGB', (sum(i.width for i in ims) + 6 * (len(ims) - 1), H), (20, 20, 20)); x = 0
for im, f in zip(ims, files):
    S.paste(im, (x, 0)); ImageDraw.Draw(S).text((x + 4, 4), f.split('/')[-1].replace('closer_lab_', '').replace('.jpg', ''), fill=(255, 230, 120)); x += im.width + 6
S.save(out, quality=88)
