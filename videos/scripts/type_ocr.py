"""TYPE c2 gate spec 2: de-rotated OCR for struck / stamped / printed type (tesseract misreads rotated, starved ink).

  python3 scripts/type_ocr.py IMG [--ink red|dark|light|any] [--box x0,y0,x1,y1] [--expect WORD] [--close px]

1. ink mask: HSV threshold on the ink (red: the stamp / spot red; dark: black ink; light: lit type on dark);
2. rotation: the angle in -25..25 deg that maximises the variance of the mask's row sums (text lines are horizontal
   when their rows are sharpest; no OpenCV on this box, so a projection search instead of minAreaRect);
3. crop to the mask's bbox, close 2 px (fills starved ink), tesseract --psm 7 and 6 at 1x and 2x, keep the best.
Prints JSON: angle, the best read, its confidence, and whether --expect was found (letters only, case-folded)."""
import json
import re
import subprocess
import sys

import numpy as np
from PIL import Image, ImageFilter


def ink_mask(im, ink):
    hsv = np.asarray(im.convert('HSV')).astype(int); rgb = np.asarray(im.convert('RGB')).astype(int)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]; lum = rgb.mean(-1)
    if ink == 'red':
        m = ((h < 14) | (h > 240)) & (s > 90) & (v > 60)
    elif ink == 'dark':
        m = lum < np.percentile(lum, 18)
    elif ink == 'light':
        m = lum > max(150, np.percentile(lum, 85))
    else:
        m = np.abs(lum - np.median(lum)) > 60
    return Image.fromarray((m * 255).astype(np.uint8))


def best_angle(mask):
    best = (-1, 0)
    for a in np.arange(-25, 25.5, 0.5):
        r = np.asarray(mask.rotate(a, resample=Image.NEAREST, expand=True)) > 127
        p = r.sum(1).astype(float); score = p.var()
        if score > best[0]:
            best = (score, float(a))
    return best[1]


def tess(img, psm):
    r = subprocess.run(['tesseract', 'stdin', 'stdout', '--psm', str(psm), '-l', 'eng', 'tsv'], input=_png(img), capture_output=True)
    words, confs = [], []
    for line in r.stdout.decode('utf8', 'replace').splitlines()[1:]:
        f = line.split('\t')
        if len(f) >= 12 and f[11].strip() and float(f[10]) >= 0:
            words.append(f[11].strip()); confs.append(float(f[10]))
    return ' '.join(words), (sum(confs) / len(confs) if confs else 0)


def _png(img):
    import io
    b = io.BytesIO(); img.save(b, 'PNG'); return b.getvalue()


def main():
    path = sys.argv[1]
    opt = lambda k, d=None: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
    im = Image.open(path).convert('RGB')
    if opt('--box'):
        im = im.crop(tuple(int(v) for v in opt('--box').split(',')))
    ink = opt('--ink', 'red')
    m = ink_mask(im, ink)
    small = m.resize((m.width // 2, m.height // 2))
    a = best_angle(small)
    cl = int(opt('--close', 5)) | 1                        # odd; ~2 px closes starved ink, ~dot pitch joins a drone / LED dot matrix
    r = m.rotate(a, resample=Image.BILINEAR, expand=True).filter(ImageFilter.MaxFilter(cl)).filter(ImageFilter.MinFilter(max(3, cl - 4) | 1))
    bb = r.getbbox()
    if bb:
        r = r.crop((max(0, bb[0] - 20), max(0, bb[1] - 20), bb[2] + 20, bb[3] + 20))
    page = Image.eval(r, lambda v: 255 - v)                 # black ink on white for tesseract
    reads = []
    for k in (1, 2):
        pg = page.resize((page.width * k // 2, page.height * k // 2)) if k == 1 else page
        for psm in (7, 6, 11):
            t, c = tess(pg, psm); reads.append({'scale': k, 'psm': psm, 'text': t, 'conf': round(c, 1)})
    exp = opt('--expect')
    fold = lambda s: re.sub('[^A-Z]', '', s.upper())
    hit = [x for x in reads if exp and fold(exp) in fold(x['text'])]
    best = max(hit or reads, key=lambda x: x['conf'])
    print(json.dumps({'image': path, 'ink': ink, 'angle': a, 'best': best, 'expect': exp, 'found': bool(hit), 'reads': reads}))


if __name__ == '__main__':
    main()
