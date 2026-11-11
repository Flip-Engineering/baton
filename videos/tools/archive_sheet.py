#!/usr/bin/env python3
"""Time-stamped frame strips for ARCHIVE SCENES reviews.
  python3 videos/tools/archive_sheet.py OUT.jpg A.mp4[:t0] [B.mp4[:t0] ...] --n 10 --dur 3.0 [--w 216]
One row per clip (label = file name), n frames from t0 over dur seconds, timestamps burnt in (no ffmpeg drawtext needed). Deletes nothing."""
import sys, cv2
from PIL import Image, ImageDraw
opt = {sys.argv[i]: sys.argv[i + 1] for i in range(len(sys.argv) - 1) if sys.argv[i].startswith('--')}
a = [x for i, x in enumerate(sys.argv[1:], 1) if not x.startswith('--') and not (sys.argv[i - 1].startswith('--'))]
n, dur, w = int(opt.get('--n', 10)), float(opt.get('--dur', 3)), int(opt.get('--w', 216))
rows = []
for spec in a[1:]:
    f, _, t0 = spec.partition(':'); t0 = float(t0 or 0)
    cap = cv2.VideoCapture(f); fps = cap.get(cv2.CAP_PROP_FPS) or 30; H = int(w * 16 / 9)
    row = Image.new('RGB', (n * w, H + 16), (20, 20, 20)); d = ImageDraw.Draw(row)
    for i in range(n):
        t = t0 + dur * i / n; cap.set(cv2.CAP_PROP_POS_FRAMES, int(round(t * fps))); ok, fr = cap.read()
        if ok: row.paste(Image.fromarray(cv2.cvtColor(cv2.resize(fr, (w, H), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB)), (i * w, 16))
        d.text((i * w + 3, 2), f'{t:.2f}', fill=(255, 255, 0))
    d.text((n * w - 300, 2), f.split('/')[-1][:44], fill=(200, 200, 200)); rows.append(row)
out = Image.new('RGB', (rows[0].width, sum(r.height for r in rows))); y = 0
for r in rows: out.paste(r, (0, y)); y += r.height
out.save(a[0], quality=88)
