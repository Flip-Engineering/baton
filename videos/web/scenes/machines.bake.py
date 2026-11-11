#!/usr/bin/env python3
"""WHO OWNS THE MACHINES? (machines, cycle 6): bake the found-footage shots the scene prints.

    python3 videos/web/scenes/machines.bake.py [--force]
      -> videos/sources/machines_c6/<shot>/0001.jpg ... + index.json   (gitignored; ~40 MB)

Every shot is a public-domain film from the Internet Archive (videos/sources/footage/CATALOG.md):
  Master Hands (1936, Jam Handy for Chevrolet; NFPF scan master-hands-1936, PD Mark 1.0) -> hires/mhn_*.mp4
  Steel: Man's Servant (1938, US Steel; NFPF steel-man-s-servant-1938, PD Mark 1.0)      -> steel_*.mp4
  A Great Railroad at Work, Part II (1942, Prelinger GreatRai1942_2, CC public domain)   -> GreatRai1942_2.mp4
Each shot is cut as a 3:4 portrait window (cx = its centre as a fraction of the source width) at the source's own
resolution (never upscaled here: the scene prints it through a line / dot screen at output size), 24 fps.
"""
import json
import os
import subprocess
import sys

FF = '/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2'
HERE = os.path.dirname(os.path.abspath(__file__))
VID = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(VID, 'sources', 'footage')
OUT = os.path.join(VID, 'out', '.machines_c6')

# key: (file, t0 s, dur s, cx, gray, note)
SHOTS = {
    'factory':   ('hires/mhn_2408_floor.mp4', 2.0, 2.4, 0.50, 1, 'MH IV ~02:27 high-angle assembly floor'),
    'power':     ('hires/mhn_0348_power.mp4', 68.2, 1.6, 0.36, 1, 'MH I ~04:52 generator, DANGER 4600 VOLTS'),
    'pylons':    ('steel_3550.mp4', 4.0, 1.6, 0.50, 0, 'Steel 35:54 pylons over the substation'),
    'mill':      ('steel_2005.mp4', 38.0, 1.8, 0.50, 0, 'Steel 20:43 the glowing slab on the rolls'),
    'face_tool': ('hires/mhn_0148_micro.mp4', 0.2, 1.6, 0.40, 1, 'MH I ~01:42 toolmaker'),
    'face_hul':  ('steel_0215.mp4', 74.6, 1.2, 0.46, 0, 'Steel 03:30 the Hulett operator in his window'),
    'hands':     ('hires/mhn_0148_micro.mp4', 8.0, 4.6, 0.56, 1, 'MH I ~01:50 hands on the vernier'),
    'lever':     ('hires/mhn_0348_power.mp4', 13.6, 3.6, 0.34, 1, 'MH I 03:56 the fist on the lever, thrown'),
    'interior':  ('hires/mhn_2238_interior.mp4', 0.0, 1.8, 0.50, 1, 'MH IV ~00:55 the plant in deep perspective'),
    'overhead':  ('hires/mhn_2238_interior.mp4', 16.0, 1.4, 0.58, 1, 'MH IV ~01:15 the frame line from above'),
    'line':      ('hires/mhn_2408_floor.mp4', 16.0, 6.4, 0.50, 1, 'MH IV ~02:40 men working the frames'),
    'tapper':    ('steel_1258.mp4', 1.6, 1.4, 0.40, 0, 'Steel ~13:00 the tapper at the taphole'),
    'stop':      ('hires/mhn_0348_power.mp4', 59.4, 2.6, 0.62, 1, 'MH I 04:14 the hand at the START/STOP station'),
    'nat':       ('hires/mhn_2238_interior.mp4', 8.0, 0.8, 0.50, 1, 'MH IV ~01:03 the plant, held'),
    'cranes_hold': ('steel_0215.mp4', 88.0, 0.8, 0.50, 0, 'Steel 03:43 ore bridges, held'),
    'flywheel':  ('hires/mhn_0348_power.mp4', 32.0, 1.6, 0.52, 1, 'MH I 04:20 the flywheel'),
    'tap':       ('steel_1124.mp4', 3.0, 2.2, 0.50, 0, 'Steel 11:27 tapping the open hearth'),
    'cranes':    ('steel_0215.mp4', 84.0, 0.6, 0.55, 0, 'Steel 03:39 the ore bridges'),
    'rails':     ('GreatRai1942_2.mp4', 120.5, 0.6, 0.45, 1, 'Great Railroad ~02:00 the streamlined locomotive'),
    'ships':     ('steel_0215.mp4', 45.5, 0.6, 0.50, 0, 'Steel 03:00 the ore boat from above'),
    'mills':     ('steel_2005.mp4', 26.0, 0.6, 0.55, 0, 'Steel 20:31 the slab leaves the furnace'),
    'reduce':    ('steel_1258.mp4', 8.0, 0.8, 0.40, 0, 'Steel ~13:06 the tapper'),
    'week':      ('hires/mhn_2715_profile.mp4', 1.6, 1.0, 0.42, 1, 'MH IV ~05:23 men at the line'),
    'f_foundry': ('hires/mhn_0900_foundry.mp4', 1.3, 0.9, 0.62, 1, 'MH II 04:02 the foundryman'),
    'f_rail':    ('GreatRai1942_2.mp4', 31.0, 0.9, 0.56, 1, 'Great Railroad ~00:30 the man at the cab door'),
    'f_phone':   ('steel_2005.mp4', 5.0, 0.9, 0.46, 0, 'Steel 20:10 the operator on the phone'),
    'f_profile': ('hires/mhn_0148_micro.mp4', 20.0, 0.9, 0.42, 1, 'MH I ~02:02 the second toolmaker'),
}


def probe(path):
    r = subprocess.run([FF, '-i', path], capture_output=True, text=True)
    import re
    m = re.search(r'Video:.*?(\d{3,4})x(\d{3,4})', r.stderr)
    return int(m.group(1)), int(m.group(2))


def bake(key, force=False):
    f, t0, dur, cx, gray, note = SHOTS[key]
    d = os.path.join(OUT, key)
    if os.path.exists(os.path.join(d, 'done')) and not force:
        return key, len([x for x in os.listdir(d) if x.endswith('.jpg')])
    os.makedirs(d, exist_ok=True)
    for x in os.listdir(d):
        os.remove(os.path.join(d, x))
    sw, sh = probe(os.path.join(SRC, f))
    cw = int(round(sh * 0.75 / 2)) * 2
    x0 = int(min(max(cx * sw - cw / 2, 0), sw - cw))
    vf = f'fps=24,crop={cw}:{sh}:{x0}:0' + (',format=gray' if gray else '')
    subprocess.run([FF, '-nostdin', '-loglevel', 'error', '-ss', str(t0), '-t', str(dur), '-i', os.path.join(SRC, f),
                    '-vf', vf, '-q:v', '3', os.path.join(d, '%04d.jpg')], check=True)
    n = len([x for x in os.listdir(d) if x.endswith('.jpg')])
    open(os.path.join(d, 'done'), 'w').write(note)
    return key, n


if __name__ == '__main__':
    force = '--force' in sys.argv
    os.makedirs(OUT, exist_ok=True)
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(3) as ex:
        res = dict(ex.map(lambda k: bake(k, force), SHOTS))
    idx = {k: {'n': res[k], 'fps': 24, 'file': SHOTS[k][0], 't0': SHOTS[k][1], 'gray': SHOTS[k][4], 'note': SHOTS[k][5]}
           for k in SHOTS}
    json.dump(idx, open(os.path.join(OUT, 'index.json'), 'w'), indent=1)
    print(json.dumps({k: v['n'] for k, v in idx.items()}))
