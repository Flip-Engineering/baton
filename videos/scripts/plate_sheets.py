#!/usr/bin/env python3
"""PLATE c1 sheets: boards (source | published | rebuilt, at 270 px and at 1:1), clip strips and encode measures.

  python3 videos/scripts/plate_sheets.py clip <tag> [--at 0.4,1.9] [--roi x0,y0,x1,y1] [--keep]
      decode <after>/<tag>_share.mp4: frames at the given song times -> <tag>_s<T>.png, a 12-frame strip, frame-to-frame
      luma change (shimmer, /255) inside the roi, crf19 and share bitrates; then deletes the two mp4s unless --keep.
  python3 videos/scripts/plate_sheets.py board <out.jpg> <title> <label=path[@crop]> ...  [--h 650] [--one x0,y0,w,h]
      panels scaled to height --h (the 270 px board: full frames at 270 wide); with --one, a 1:1 crop (1080x1920 space).
      A label starting with 'SRC ' is framed green, 'PUB ' red, 'OLD ' amber, 'NEW ' blue (the before/ boards' colours).
"""
import json, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

VID = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AFTER = os.path.join(VID, 'review', 'studio_plate_c1', 'after')
FF = '/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2'
try:
    FONT = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 15); FONTB = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 20)
except OSError:
    FONT = FONTB = ImageFont.load_default()
COL = {'SRC': (80, 200, 110), 'PUB': (230, 90, 80), 'OLD': (230, 180, 70), 'NEW': (90, 160, 240)}


def decode(mp4, n0, n1):
    """frames n0..n1-1 as float luma + rgb"""
    tmp = mp4 + '_%03d.png'
    subprocess.run([FF, '-y', '-loglevel', 'error', '-i', mp4, '-vf', f'select=between(n\\,{n0}\\,{n1 - 1})', '-vsync', '0', tmp], check=True)
    out = []
    for k in range(1, n1 - n0 + 1):
        p = tmp % k
        if not os.path.exists(p): break
        out.append(np.asarray(Image.open(p).convert('RGB'))); os.remove(p)
    return out


def clip(tag, at=None, roi=None, keep=False):
    info = json.load(open(os.path.join(AFTER, tag + '.json'))); a0, n = info['a0'], info['n']
    sh = os.path.join(AFTER, tag + '_share.mp4'); mp4 = os.path.join(AFTER, tag + '.mp4')
    fr = decode(sh, 0, n)
    L = [f.astype(np.float32) @ [.2126, .7152, .0722] for f in fr]
    x0, y0, x1, y1 = roi or (0, 0, 1080, 1920)
    d = [float(np.abs(L[i + 1] - L[i])[y0:y1, x0:x1].mean()) for i in range(len(L) - 1)]
    for t in (at or []):
        i = int(round((t - a0) * 30)); i = max(0, min(len(fr) - 1, i))
        Image.fromarray(fr[i]).save(os.path.join(AFTER, f'{tag}_s{t}.jpg'), quality=95, subsampling=0)
    # strip: 12 frames evenly spaced, 180 px wide, with the frame change under each
    idx = np.linspace(0, len(fr) - 1, 12).astype(int); cw = 180; ch = 320
    S = Image.new('RGB', (cw * 12, ch + 40), (17, 17, 17)); g = ImageDraw.Draw(S)
    for k, i in enumerate(idx):
        S.paste(Image.fromarray(fr[i]).resize((cw, ch), Image.LANCZOS), (k * cw, 0))
        g.text((k * cw + 4, ch + 4), f'{a0 + i / 30:.2f}s  d{(d[i - 1] if i else 0):.1f}', font=FONT, fill=(220, 220, 220))
    S.save(os.path.join(AFTER, f'{tag}_strip.jpg'), quality=88)
    secs = n / 30
    res = dict(tag=tag, frames=len(fr), crf19_mbit=round(info['bytes']['crf19'] * 8 / secs / 1e6, 2), share_mbit=round(info['bytes']['share'] * 8 / secs / 1e6, 2),
               shimmer_mean=round(float(np.mean(d)), 2), shimmer_med=round(float(np.median(d)), 2), shimmer_max=round(float(np.max(d)), 2), roi=[x0, y0, x1, y1],
               dframe=[round(v, 2) for v in d])
    json.dump(res, open(os.path.join(AFTER, f'{tag}_measure.json'), 'w'))
    print(json.dumps({k: v for k, v in res.items() if k != 'dframe'}))
    if not keep:
        for p in (sh, mp4):
            if os.path.exists(p): os.remove(p)
    return res


def board(out, title, items, h=650, one=None):
    panels = []
    for it in items:
        lab, p = it.split('=', 1); crop = None; off = None
        if '#' in p: p, o = p.split('#'); off = [int(v) for v in o.split(',')]   # a per-panel 1:1 offset
        if '@' in p: p, c = p.split('@'); crop = [int(v) for v in c.split(',')]
        im = Image.open(os.path.join(VID, p) if not os.path.isabs(p) else p).convert('RGB')
        if crop: im = im.crop((crop[0], crop[1], crop[0] + crop[2], crop[1] + crop[3]))
        if one:   # 1:1: bring the panel to 1080 wide first (a 720p published frame is scaled up, as a phone would)
            if im.size[0] != 1080: im = im.resize((1080, round(im.size[1] * 1080 / im.size[0])), Image.LANCZOS)
            x, y, w, hh = one
            if off: x, y = off
            im = im.crop((x, y, x + w, y + hh))
        else:
            im = im.resize((round(im.size[0] * 270 / im.size[0]), round(im.size[1] * 270 / im.size[0])), Image.LANCZOS)
        panels.append((lab, im))
    ph = max(p[1].size[1] for p in panels); pw = sum(p[1].size[0] + 12 for p in panels) + 12
    B = Image.new('RGB', (pw, ph + 110), (17, 17, 17)); g = ImageDraw.Draw(B); g.text((12, 10), title, font=FONTB, fill=(240, 240, 240))
    x = 12
    for lab, im in panels:
        c = COL.get(lab.split(' ')[0], (160, 160, 160))
        B.paste(im, (x, 46)); g.rectangle((x - 2, 44, x + im.size[0] + 1, 46 + im.size[1] + 1), outline=c, width=2)
        for k, line in enumerate(lab.split('|')):
            g.text((x, 52 + im.size[1] + k * 17), line, font=FONT, fill=c if k == 0 else (200, 200, 200))
        x += im.size[0] + 12
    B.save(out, quality=90); print(out, B.size)


if __name__ == '__main__':
    a = sys.argv[1:]
    opt = lambda k, d=None: a[a.index(k) + 1] if k in a else d
    if a[0] == 'clip':
        clip(a[1], at=[float(v) for v in opt('--at', '').split(',') if v], roi=[int(v) for v in opt('--roi').split(',')] if opt('--roi') else None, keep='--keep' in a)
    elif a[0] == 'board':
        rest = [x for i, x in enumerate(a[3:]) if not x.startswith('--') and (i == 0 or not a[3:][i - 1].startswith('--'))]
        board(a[1], a[2], rest, one=[int(v) for v in opt('--one').split(',')] if opt('--one') else None)
