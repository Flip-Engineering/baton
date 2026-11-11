#!/usr/bin/env python3
"""WHO OWNS THE MACHINES? c11: the extra shots v4 prints (machines.bake.py bakes the rest into the same sources/machines_c6/).
    python3 videos/web/scenes/machines_c11.bake.py   -> sources/machines_c6/<shot>/NNNN.jpg + index.json entries
Master Hands (1936, Jam Handy for Chevrolet; Prelinger MasterHa1936 / _2, public domain): the dial (THE AI.: an instrument we read), the hands that turn the valve
wheel (the people who run it), and two faces lit by the pour (the demand lands on people).  640x480 sources: cropped to the 3:4 portrait window, 24 fps."""
import json, os, subprocess
FF = '/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2'
HERE = os.path.dirname(os.path.abspath(__file__)); VID = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(VID, 'sources', 'footage'); OUT = os.path.join(VID, 'out', '.machines_c6')
SHOTS = {  # key: (file, t0, dur, cx, note)
    'dial':   ('MasterHa1936.mp4', 217.2, 4.2, 0.50, 'MH I ~03:38 the 0-125 dial, needle climbing'),
    'wheel':  ('MasterHa1936.mp4', 214.4, 2.8, 0.46, 'MH I ~03:36 hands turn the valve wheel'),
    'glow1':  ('MasterHa1936_2.mp4', 240.0, 2.2, 0.60, 'MH II ~04:00 a man lit by the pour'),
    'glow3':  ('MasterHa1936_2.mp4', 252.4, 2.2, 0.58, 'MH II ~04:12 a man in his cap at the pour'),
}
idx = json.load(open(os.path.join(OUT, 'index.json')))
for k, (f, t0, dur, cx, note) in SHOTS.items():
    d = os.path.join(OUT, k); os.makedirs(d, exist_ok=True)
    for x in os.listdir(d): os.remove(os.path.join(d, x))
    sw, sh = 640, 480; cw = int(round(sh * 0.75 / 2)) * 2; x0 = int(min(max(cx * sw - cw / 2, 0), sw - cw))
    subprocess.run([FF, '-nostdin', '-loglevel', 'error', '-ss', str(t0), '-t', str(dur), '-i', os.path.join(SRC, f), '-vf', f'fps=24,crop={cw}:{sh}:{x0}:0,format=gray',
                    '-q:v', '3', os.path.join(d, '%04d.jpg')], check=True)
    n = len([x for x in os.listdir(d) if x.endswith('.jpg')])
    idx[k] = {'n': n, 'fps': 24, 'file': f, 't0': t0, 'gray': 1, 'note': note}
json.dump(idx, open(os.path.join(OUT, 'index.json'), 'w'), indent=1)
print({k: idx[k]['n'] for k in SHOTS})
