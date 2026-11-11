#!/usr/bin/env python3
"""HUMAN c5: the demo boards. Published panels (from before/) above the same subject through the rig (after/stills), at 540 px with the
skeleton overlay and at 270 px without. Usage: python3 scripts/human_c5_boards.py   (run from videos/)"""
import os
from PIL import Image, ImageDraw, ImageFont
R = 'review/studio_human_c5'; B, A = f'{R}/before', f'{R}/after'
def font(sz):
    for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
        if os.path.exists(f): return ImageFont.truetype(f, sz)
    return ImageFont.load_default()
def pub(name, idx, w=540):
    im = Image.open(f'{B}/{name}'); pw = im.width // (im.width // 540); n = im.width // 540
    p = im.crop((idx * 540, 20, idx * 540 + 540, 976)); return p.resize((w, int(w * 960 / 540)))
def aft(tag, t, w=540): return Image.open(f'{A}/stills/{tag}_{t}.jpg').resize((w, int(w * 1920 / 1080)))
def board(fn, rows, w=540, title=''):
    """rows: [(label, [images])]"""
    h = int(w * 960 / 540); cols = max(len(r[1]) for r in rows); lab = 34 if w >= 540 else 22
    S = Image.new('RGB', (cols * w, len(rows) * (h + lab) + (44 if title else 0)), (12, 12, 12)); d = ImageDraw.Draw(S)
    y = 0
    if title: d.text((10, 8), title, fill=(255, 255, 255), font=font(24 if w >= 540 else 14)); y = 44
    for label, ims in rows:
        d.text((8, y + 4), label, fill=(255, 208, 138), font=font(20 if w >= 540 else 12))
        for i, im in enumerate(ims): S.paste(im.convert('RGB').resize((w, h)), (i * w, y + lab))
        y += h + lab
    S.save(fn, quality=88); print(fn, S.size)
os.makedirs(f'{A}/boards', exist_ok=True)
SHOTS = {
  'cw': ('COMMON WEALTH SAME HANDS. (v12): published vs the rig (the piece\'s own cobot and terminal, lab lighting)', ('CW12_same_hands_540.jpg', [1, 2, 3], '13.5s 13.9s 14.1s'), ('cw', ['0.10', '0.50', '0.90', '1.50'])),
  'lineman': ('ALL POWER lineman on the conductor (v2): published vs the rig (3/4 view, both hands on the stick)', ('AP2_lineman_540.jpg', [1, 2, 3], '10.6s 12.3s 13.7s'), ('lineman', ['0.20', '1.20', '2.60'])),
  'rope': ('THE GIANT rope team (v1): published vs the rig (hands on the rope, lean against the load, feet planted)', ('GIANT_people_540.jpg', [0, 2], '3.1s 8.3s'), ('rope', ['0.40', '0.90', '1.30'])),
}
for k, (title, (src, idx, lab), (tag, ts)) in SHOTS.items():
    pubs = [pub(src, i) for i in idx]
    for w, sfx in ((540, '540'), (270, '270')):
        rows = [(f'PUBLISHED  {lab}', [pub(src, i, w) for i in idx]), ('AFTER, rig (clean)', [aft(f'{tag}_clean', t, w) for t in ts])]
        if w == 540: rows.append(('AFTER + skeleton diagnostic (pins, hand rings in mm and px, COM over support)', [aft(f'{tag}_diag', t, w) for t in ts]))
        board(f'{A}/boards/BOARD_{k}_{sfx}.jpg', rows, w, title=title if w == 540 else '')
# film: the film frames, the published typed striker (IRON v9), the rig-driven body
f = [Image.open(f'{A}/stills/film_clean_{t}.jpg') for t in ('0.50', '1.50', '2.50', '3.50')]
fd = [Image.open(f'{A}/stills/film_diag_{t}.jpg') for t in ('0.50', '1.50', '2.50', '3.50')]
strip = Image.open(f'{B}/IRON9_striker_frames.jpg'); pw = strip.width // 4
pubf = [strip.crop((i * pw, 22, (i + 1) * pw, strip.height - 22)) for i in range(4)]
for w, sfx in ((540, '540'), (270, '270')):
    rows = [('PUBLISHED IRON v9 striker (typed pose, frozen 2.4 s; for scale)', pubf), ('AFTER: film man (top) drives the CG body (bottom), rig, feet locked', f)]
    if w == 540: rows.append(('AFTER + diagnostic', fd))
    board(f'{A}/boards/BOARD_film_{sfx}.jpg', rows, w, title='A working man from 1938 film (Steel: Man\'s Servant, NFPF, PD) through MediaPipe, cleaned, retargeted' if w == 540 else '')
# walk and reach: contact sheets of the clips' key frames
for tag, ts, title in (('walk', ('0.60', '1.20', '1.80', '2.40'), 'WALK: typed (top half of each frame) vs rig (bottom half); ground ticks every 0.25 m'), ('reach', ('0.60', '1.50', '1.85', '2.60'), 'REACH AND GRIP: step, look, reach, close, lift with counter-lean')):
    for w, sfx in ((540, '540'), (270, '270')):
        rows = [('AFTER (clean)', [aft(f'{tag}_clean', t, w) for t in ts])]
        if w == 540: rows.append(('AFTER + diagnostic', [aft(f'{tag}_diag', t, w) for t in ts]))
        board(f'{A}/boards/BOARD_{tag}_{sfx}.jpg', rows, w, title=title if w == 540 else '')
