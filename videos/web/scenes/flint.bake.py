#!/usr/bin/env python3
"""TODAY. #1 FLINT bake (7 Oct 2026): Master Hands (1936), shot in Chevrolet's Flint plants the year of the sit-down, cut into
540x960 gray plates.
   python3 videos/web/scenes/flint.bake.py [shot ...] [--force]     -> videos/web/assets/flint/plates/<shot>/0001.jpg ... + index.json

Source (public domain: Prelinger Archives MasterHa1936 / _2 / _4, CC public domain; videos/sources/footage/CATALOG.md §1),
read from the local copies in videos/sources/footage. 640x480; a 270x480 portrait window is cut and scaled 2x (the scene prints it
through a gravure screen, which is coarser than the source). The film is never labelled in the piece.
"""
import json, os, subprocess, sys
import numpy as np
from PIL import Image
FF = '/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2'
HERE = os.path.dirname(os.path.abspath(__file__))
VID = os.path.abspath(os.path.join(HERE, '..', '..'))
SRC = os.path.join(VID, 'sources', 'footage')
OUT = os.path.join(VID, 'web', 'assets', 'flint', 'plates')
PW, PH = 540, 960
# name: (file, t0 s, dur s, cx0, cx1 (fractions of source width: a pan), reverse, note)
SHOTS = {
    # the line running (the speed-up)
    'vast':     ('MasterHa1936_4.mp4', 54.5, 2.4, 0.50, 0.50, 0, 'MH IV: the plant in deep perspective'),
    'frames':   ('MasterHa1936_4.mp4', 93.0, 2.6, 0.40, 0.60, 0, 'MH IV: the line of men working the frames'),
    'press5':   ('MasterHa1936_4.mp4', 84.0, 2.0, 0.45, 0.45, 0, 'MH IV: a man at press 5'),
    'former':   ('MasterHa1936_4.mp4', 129.0, 2.0, 0.55, 0.55, 0, 'MH IV: the frame-forming machine, a man at the controls'),
    'floor':    ('MasterHa1936_4.mp4', 160.0, 2.6, 0.40, 0.60, 0, 'MH IV: the assembly floor from high, dozens at work'),
    'chassis':  ('MasterHa1936_4.mp4', 231.0, 2.4, 0.50, 0.50, 0, 'MH IV: the chassis line to the far wall'),
    'overhead': ('MasterHa1936_4.mp4', 441.5, 2.4, 0.50, 0.50, 0, 'MH IV: the line from above, men at the cars'),
    'fender':   ('MasterHa1936_4.mp4', 433.0, 2.0, 0.50, 0.50, 0, 'MH IV: men fitting the fenders'),
    'drop':     ('MasterHa1936_4.mp4', 453.5, 3.0, 0.50, 0.50, 0, 'MH IV: the body drops onto the chassis'),
    'grille':   ('MasterHa1936_4.mp4', 421.0, 2.0, 0.50, 0.50, 0, 'MH IV: two men carry the grille'),
    'wheel':    ('MasterHa1936_4.mp4', 492.5, 1.8, 0.50, 0.50, 0, 'MH IV: a wheel on'),
    'rolloff':  ('MasterHa1936_4.mp4', 501.0, 2.8, 0.40, 0.60, 0, 'MH IV: the finished cars down the line'),
    'presses':  ('MasterHa1936_4.mp4', 337.0, 2.4, 0.50, 0.50, 0, 'MH IV: the press flywheels, the floor below'),
    'hands':    ('MasterHa1936.mp4', 110.5, 3.0, 0.55, 0.55, 0, 'MH I: hands on the micrometer'),
    'lathe':    ('MasterHa1936.mp4', 142.5, 3.0, 0.45, 0.45, 0, 'MH I: a toolmaker at his lathe'),
    'panels':   ('MasterHa1936_4.mp4', 402.0, 2.6, 0.50, 0.50, 0, 'MH IV: men carrying body panels from the presses'),
    'hoist':    ('MasterHa1936.mp4', 264.0, 2.6, 0.50, 0.50, 0, 'MH I: a man hauling a chain hoist overhead'),
    'glove':    ('MasterHa1936_2.mp4', 260.6, 2.6, 0.45, 0.45, 0, 'MH II: a hand pulling on a leather work glove'),
    # the stop and the start
    'lever':    ('MasterHa1936.mp4', 236.6, 2.4, 0.55, 0.55, 0, 'MH I: the fist on the lever, thrown'),
    'flywheel': ('MasterHa1936.mp4', 240.5, 3.0, 0.50, 0.50, 0, 'MH I: the great flywheel turning'),
    # the people who held the plant
    'face1':    ('MasterHa1936.mp4', 90.5, 3.0, 0.50, 0.50, 0, 'MH I: a toolmaker, eyes down'),
    'face2':    ('MasterHa1936.mp4', 100.5, 3.0, 0.50, 0.50, 0, 'MH I: a toolmaker at the bench'),
    'face3':    ('MasterHa1936.mp4', 158.5, 3.0, 0.55, 0.55, 0, 'MH I: an older toolmaker in round glasses'),
    'face4':    ('MasterHa1936_2.mp4', 239.2, 2.6, 0.55, 0.55, 0, 'MH II: a man in his cap, lit by the pour'),
    'face5':    ('MasterHa1936_2.mp4', 253.0, 2.6, 0.55, 0.55, 0, 'MH II: a man at the pour in profile'),
    'face6':    ('MasterHa1936_4.mp4', 327.0, 2.0, 0.55, 0.55, 0, 'MH IV: an older worker in profile, glasses and cap'),
    'face7':    ('MasterHa1936.mp4', 134.0, 2.6, 0.55, 0.55, 0, 'MH I: an older man at the drill-press wheel'),
}


def bake(name, force=False):
    f, t0, dur, cx0, cx1, rev, note = SHOTS[name]
    d = os.path.join(OUT, name)
    if os.path.exists(os.path.join(d, 'done')) and not force:
        return len([x for x in os.listdir(d) if x.endswith('.jpg')])
    os.makedirs(d, exist_ok=True)
    for x in os.listdir(d): os.remove(os.path.join(d, x))
    sw, sh = 640, 480
    ch = sh - 8; cw = int(round(ch * 9 / 16))
    xs = lambda c: min(max(0, c * sw - cw / 2), sw - cw)
    x_expr = "%f+(%f)*t/%f" % (xs(cx0), xs(cx1) - xs(cx0), dur)
    vf = "crop=w=%d:h=%d:x='%s':y=4:exact=1,scale=%d:%d:flags=lanczos,format=gray,fps=24" % (cw, ch, x_expr, PW, PH)
    if rev: vf += ',reverse'
    raw = subprocess.run([FF, '-nostdin', '-loglevel', 'error', '-ss', str(t0), '-t', str(dur), '-i', os.path.join(SRC, f), '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], capture_output=True).stdout
    n = len(raw) // (PW * PH)
    for i in range(n):
        im = np.frombuffer(raw, np.uint8, PW * PH, i * PW * PH).reshape(PH, PW)
        Image.fromarray(im, 'L').save(os.path.join(d, '%04d.jpg' % (i + 1)), quality=86)
    open(os.path.join(d, 'done'), 'w').write(note)
    return n


if __name__ == '__main__':
    force = '--force' in sys.argv
    names = [a for a in sys.argv[1:] if not a.startswith('--')] or list(SHOTS)
    os.makedirs(OUT, exist_ok=True)
    ip = os.path.join(OUT, 'index.json')
    idx = json.load(open(ip)) if os.path.exists(ip) else {}
    for n in names:
        idx[n] = {'n': bake(n, force), 'fps': 24, 'note': SHOTS[n][-1]}; print(n, idx[n]['n'], flush=True)
    json.dump(idx, open(ip, 'w'), indent=1)
