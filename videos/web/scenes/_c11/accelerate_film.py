"""ACCELERATE c11: cut the real-film clips into grey sprite atlases (15 fps, 400x300 cells, 8 across) for the scene.
Sources (all public domain, Prelinger Archives via archive.org; the Otto engine clip is Wikimedia Commons):
  ms  = "Machine: Master or Slave?" (Educational Film Institute of NYU, 1941)  archive.org/details/machine-master_or_slave
  sg  = "On Guard! The Story of SAGE" (1956)                                  archive.org/details/OnGuard1956
  otto = Commons "Otto Engine - Governor Camwheel closeup.ogv"
Usage: python3 accelerate_film.py <dir with ms_hi.mp4 sage_hi.mp4 and the otto ogv>   -> videos/web/assets/intelligence/c11/<clip>.jpg + clips.json
"""
import json, os, subprocess, sys, math
FF = '/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2'
SRC = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'intelligence', 'c11')
mm = lambda m, s: m * 60 + s
CLIPS = {  # name: (file, start s, duration s)
    'otto':   ('otto.ogv', 0.0, 4.0),
    'stack':  ('ms_hi.mp4', mm(1, 18.0), 4.5),
    'gate':   ('ms_hi.mp4', mm(1, 28.0), 4.0),
    'order':  ('ms_hi.mp4', mm(3, 32.5), 9.0),
    'bow':    ('ms_hi.mp4', mm(3, 47.0), 5.5),
    'face':   ('ms_hi.mp4', mm(4, 4.5), 8.0),
    'wheel':  ('ms_hi.mp4', mm(4, 14.5), 11.0),
    'work':   ('ms_hi.mp4', mm(2, 8.0), 8.0),
    'smile':  ('ms_hi.mp4', mm(1, 52.0), 7.0),
    'room':   ('sage_hi.mp4', mm(4, 48.5), 7.5),
    'scope':  ('sage_hi.mp4', mm(5, 18.0), 7.0),
    'scope2': ('sage_hi.mp4', mm(5, 38.0), 8.0),
    'op':     ('sage_hi.mp4', mm(5, 14.0), 5.0),
    'op2':    ('sage_hi.mp4', mm(5, 49.0), 9.0),
    'draft':  ('sage_hi.mp4', mm(7, 24.0), 12.0),
    'racks':  ('sage_hi.mp4', mm(7, 15.0), 8.0),
}
FPS, CW, CH, COLS = 15, 400, 300, 8
meta = {}
for name, (f, t0, dur) in CLIPS.items():
    n = int(dur * FPS)
    rows = math.ceil(n / COLS)
    out = os.path.join(OUT, name + '.jpg')
    subprocess.run([FF, '-y', '-loglevel', 'error', '-ss', str(t0), '-t', str(dur), '-i', os.path.join(SRC, f),
                    '-vf', f'fps={FPS},scale={CW}:{CH},format=gray,tile={COLS}x{rows}:padding=0', '-frames:v', '1', '-q:v', '3', out], check=True)
    meta[name] = {'n': n, 'cols': COLS, 'cw': CW, 'ch': CH, 'fps': FPS, 'src': f, 't0': t0}
json.dump(meta, open(os.path.join(OUT, 'clips.json'), 'w'), indent=1)
print({k: v['n'] for k, v in meta.items()})
