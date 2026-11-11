"""python3 tools/closer_ba.py out.jpg beforeDir afterDir [--h 420]: two rows (before / after), frames in name order."""
import sys, glob
from PIL import Image, ImageDraw
a = sys.argv[1:]; H = 420
if '--h' in a: i = a.index('--h'); H = int(a[i + 1]); del a[i:i + 2]
out, b, c = a
rows = []
for d, lab in ((b, 'BEFORE'), (c, 'AFTER')):
    fs = sorted(glob.glob(d + '/*.jpg')); ims = [Image.open(f).convert('RGB') for f in fs]; ims = [im.resize((int(im.width * H / im.height), H)) for im in ims]
    R = Image.new('RGB', (sum(i.width for i in ims) + 4 * len(ims), H), (15, 15, 15)); x = 0
    for im, f in zip(ims, fs):
        R.paste(im, (x, 0)); ImageDraw.Draw(R).text((x + 4, 4), lab + ' ' + f.rsplit('_', 1)[1][:-4], fill=(255, 230, 120)); x += im.width + 4
    rows.append(R)
S = Image.new('RGB', (max(r.width for r in rows), sum(r.height for r in rows) + 6), (0, 0, 0)); y = 0
for r in rows: S.paste(r, (0, y)); y += r.height + 6
S.save(out, quality=88)
