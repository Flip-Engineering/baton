"""LOOKS c2: contact sheets and crowd metrics.
    python3 scripts/looks2_sheet.py sheet OUT.jpg --w 270 --cols N FILE[:label] ...
    python3 scripts/looks2_sheet.py metrics FILE ...     (dark fraction, largest dark region, value spread at 270 px)
"""
import sys, json
import numpy as np
from PIL import Image, ImageDraw


def sheet(out, files, w=270, cols=None, lab=14):
    ims = []
    for f in files:
        p, _, label = f.partition(':')
        im = Image.open(p).convert('RGB'); h = round(im.height * w / im.width)
        ims.append((im.resize((w, h), Image.LANCZOS), label or p.split('/')[-1].rsplit('.', 1)[0]))
    cols = cols or len(ims); rows = (len(ims) + cols - 1) // cols; h = max(i.height for i, _ in ims)
    S = Image.new('RGB', (cols * w, rows * (h + lab)), (12, 12, 12)); d = ImageDraw.Draw(S)
    for k, (im, label) in enumerate(ims):
        x, y = (k % cols) * w, (k // cols) * (h + lab)
        S.paste(im, (x, y + lab)); d.text((x + 3, y + 1), label[:40], fill=(235, 220, 90))
    S.save(out, quality=90); print(out, S.size)


def metrics(p, dark=0.14):
    im = Image.open(p).convert('L').resize((270, 480), Image.LANCZOS); L = np.asarray(im, np.float32) / 255
    from scipy import ndimage
    lab, n = ndimage.label(L <= dark); big = np.bincount(lab.ravel())[1:].max() / L.size if n else 0
    return {'file': p.split('/')[-1], 'dark': round(float((L <= dark).mean()), 3), 'darkMax': round(float(big), 3),
            'p10': round(float(np.percentile(L, 10)), 3), 'p90': round(float(np.percentile(L, 90)), 3)}


if __name__ == '__main__':
    a = sys.argv[1:]
    if a[0] == 'sheet':
        out = a[1]; w = 270; cols = None; rest = []
        i = 2
        while i < len(a):
            if a[i] == '--w': w = int(a[i + 1]); i += 2
            elif a[i] == '--cols': cols = int(a[i + 1]); i += 2
            else: rest.append(a[i]); i += 1
        sheet(out, rest, w, cols)
    else:
        for p in a[1:]: print(json.dumps(metrics(p)))
