#!/usr/bin/env python3
"""Vendor curated CMU mocap takes (BVH, cgspeed 2010 conversion) into videos/sources/mocap/cmu/ at 30 fps.

    python3 videos/scripts/vendor_mocap.py <cmu-mocap checkout>   # github.com/una-dinosauria/cmu-mocap (data/NNN/NN_NN.bvh)

Frame 0 of every file stays the cgspeed T-pose (the retarget reference). Licence: CMU Graphics Lab Motion Capture
Database, "free for all uses", may be included in commercial products, may not be resold as mocap data
(see videos/sources/mocap/README.md). SOURCES.csv lists what each take is used for.
"""
import os, sys, csv

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'sources', 'mocap', 'cmu')
TAKES = [  # take, subject, description (CMU index), our use
    ('02_01', 2, 'walk', 'crowd walker A'), ('05_01', 5, 'walk', 'crowd walker B'), ('06_01', 6, 'walk', 'crowd walker C'),
    ('07_01', 7, 'walk', 'crowd walker D'), ('08_01', 8, 'walk', 'crowd walker E'), ('12_01', 12, 'walk', 'crowd walker F'),
    ('16_15', 16, 'walk', 'crowd walker G'), ('26_01', 26, 'walk', 'crowd walker H'), ('35_01', 35, 'walk', 'crowd walker I'),
    ('38_01', 38, 'walk', 'crowd walker J'), ('45_01', 45, 'walk', 'crowd walker K'), ('46_01', 46, 'walk', 'crowd walker L'),
    ('49_01', 49, 'walk', 'crowd walker M'),
    ('17_08', 17, "muscular, heavyset person's walk", 'heavy walker'), ('17_01', 17, 'walk with anger, frustration', 'angry stride'),
    ('20_06', 20, 'soldiers march', 'march'),
    ('13_33', 13, 'climb ladder', 'ladder climb (hero)'), ('14_33', 14, 'climb ladder', 'ladder climb (second climber)'),
    ('01_12', 1, 'playground - climb, pull up, dangle', 'pull-up / lattice climb'),
    ('62_07', 62, 'hammering a nail', 'hammer blow (hand-at-tool reference)'), ('62_10', 62, 'hammering sequence', 'hammer sequence'),
    ('56_02', 56, 'vignettes - fists up, ...', 'fists up'), ('02_05', 2, 'punch/strike', 'strike'),
]

def downsample(src, dst, step):
    lines = open(src).read().splitlines()
    m = lines.index('MOTION')
    frames = lines[m + 3:]
    keep = [frames[0]] + frames[1::step]          # T-pose + every step-th frame
    ft = float(lines[m + 2].split(':')[1]) * step
    with open(dst, 'w') as f:
        f.write('\n'.join(lines[:m + 1]) + '\n')
        f.write(f'Frames: {len(keep)}\nFrame Time: {ft:.7f}\n')
        for fr in keep: f.write(' '.join(f'{float(v):.3f}'.rstrip('0').rstrip('.') if '.' in f'{float(v):.3f}' else v for v in fr.split()) + '\n')

def main():
    root = sys.argv[1]
    os.makedirs(OUT, exist_ok=True)
    rows = []
    for take, subj, desc, use in TAKES:
        src = os.path.join(root, 'data', f'{subj:03d}', f'{take}.bvh')
        downsample(src, os.path.join(OUT, f'{take}.bvh'), 4)       # 120 fps -> 30 fps
        rows.append({'take': take, 'subject': subj, 'cmu_description': desc, 'use': use,
                     'source': f'https://github.com/una-dinosauria/cmu-mocap/blob/master/data/{subj:03d}/{take}.bvh',
                     'original': 'http://mocap.cs.cmu.edu (CMU Graphics Lab Motion Capture Database, NSF EIA-0196217)',
                     'licence': 'free for all uses incl. commercial products; not for resale as mocap data', 'fps': 30})
    with open(os.path.join(OUT, '..', 'SOURCES.csv'), 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
    print(len(rows), 'takes ->', os.path.normpath(OUT))

if __name__ == '__main__':
    main()
