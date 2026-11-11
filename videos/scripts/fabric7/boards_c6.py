#!/usr/bin/env python3
"""FABRIC7 c6 (15 Oct): BEFORE | AFTER boards from DELIVERED plates (ours only: the lab's bench plates of CAST's lineup people and the Cycles stills; no reference photograph). One command for the runner once the bench is fetched:
   python3 videos/scripts/fabric7/boards_c6.py PLATEDIR OUT_DIR [--cyc L08=videos/out/gpu/<id>,L23=videos/out/gpu/<id>] [--box tag=x0,y0,x1,y1 ...]
PLATEDIR holds <tag>.png (farm_bench.py --extract: videos/out/bench/fabric7_c6_it3/plates). Rows that need a plate that is not there are skipped and said. The tags are plates7.py set c6i3 (c12<view>_<arm>_<person>); the
arms: on = latest | norelief = the worn lines as colour only (setrelief=0) | nomotion = no wear field (motion=0) | nocontact = the creases without the touching layers folding together (contact=0).
Boxes are guesses made WITHOUT a plate (the lab's close-up camera centres the garment's part): look at the whole plate first (the 'overview' row) and pass --box where the part sits elsewhere.
Credit line: our own renders (OUR figures; no scan, no photograph)."""
import os, sys, subprocess
H = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, H)
import boards_c3 as B
from PIL import Image

ROWS = [   # (board, title, [(label, tag)], default box (the 1080 x 1350 plate), zoom)
    ('hip_L08', 'L08 hip: the worn lines as set creases (on) | colour only (norelief) | no wear (nomotion), 1:1', [('on', 'c12hip_on_L08'), ('norelief', 'c12hip_norelief_L08'), ('nomotion', 'c12hip_nomotion_L08')], (240, 380, 840, 980), 1),
    ('hip_L08_x2', 'L08 hip x2 (nearest)', [('on', 'c12hip_on_L08'), ('norelief', 'c12hip_norelief_L08'), ('nomotion', 'c12hip_nomotion_L08')], (390, 530, 690, 830), 2),
    ('kneeb_L08', 'L08 back of the knee: on | norelief, 1:1', [('on', 'c12kneeb_on_L08'), ('norelief', 'c12kneeb_norelief_L08')], (240, 380, 840, 980), 1),
    ('knee_seat_L08', 'L08 front of the knee | seat (on), 1:1', [('knee', 'c12knee_on_L08'), ('seat', 'c12seat_on_L08')], (240, 380, 840, 980), 1),
    ('hip_L23', 'L23 hip (a darker blue jean), on, 1:1 and x2', [('1:1', 'c12hip_on_L23')], (240, 380, 840, 980), 1),
    ('slit_bust_L23', 'L23 bust, the armscye (person\'s right shoulder, viewer\'s left): on | nocontact, x2', [('on', 'c12bust_on_L23'), ('nocontact', 'c12bust_nocontact_L23')], (60, 560, 360, 960), 2),
    ('slit_elbow_L23', 'L23 the crook of the elbow: on | nocontact, 1:1', [('on', 'c12elbow_on_L23'), ('nocontact', 'c12elbow_nocontact_L23')], (240, 380, 840, 980), 1),
    ('solos', 'solos (on): L08 front, L08 back, L23 front', [('L08 front', 'c12solo_on_L08'), ('L08 back', 'c12solob_on_L08'), ('L23', 'c12solo_on_L23')], (0, 0, 1080, 1350), 0.5),
    ('overview_hip', 'overview: L08 hip on | norelief | nomotion (the whole plate)', [('on', 'c12hip_on_L08'), ('norelief', 'c12hip_norelief_L08'), ('nomotion', 'c12hip_nomotion_L08')], (0, 0, 1080, 1350), 0.4),
    ('row270', 'the dressed row at 270 px (on)', [('on', 'c12row_on_studio5_270')], None, 1),
]


def main(a):
    if len(a) < 2:
        raise SystemExit(__doc__)
    pd, od = a[0], a[1]
    os.makedirs(od, exist_ok=True)
    boxes = {}
    for i, v in enumerate(a):
        if v == '--box':
            t, b = a[i + 1].split('=', 1); boxes[t] = tuple(int(x) for x in b.split(','))
    made = []
    for name, title, cells, box, zoom in ROWS:
        paths = [(lab, os.path.join(pd, tag + '.png')) for lab, tag in cells]
        miss = [p for _, p in paths if not os.path.exists(p)]
        if miss:
            print('skip', name, '(missing', ', '.join(os.path.basename(m) for m in miss) + ')'); continue
        if any(os.path.exists(p[:-4] + '.ERROR.png') for _, p in paths):
            print('NOTE', name, 'has a plate with a lab error (*.ERROR.png): a lab error, not a picture')
        im0 = Image.open(paths[0][1])
        bx = boxes.get(name) or box or (0, 0, im0.size[0], im0.size[1])
        spec = f'{title.replace("|", "/")}|{bx[0]},{bx[1]},{bx[2]},{bx[3]}|{zoom}|' + ','.join(f'{l}={p}' for l, p in paths)
        out = os.path.join(od, f'c6_it3_{name}.jpg')
        B.main([out, '--row', spec]); made.append(out)
    for k, d in (x.split('=', 1) for x in (a[a.index('--cyc') + 1].split(',') if '--cyc' in a else [])):
        for shot in ('bust', 'full'):
            for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
                if shot in f and f.endswith('studior5.png'):
                    print('Cycles still', k, shot, os.path.join(d, f))
    print(len(made), 'boards in', od)


if __name__ == '__main__':
    main(sys.argv[1:])
