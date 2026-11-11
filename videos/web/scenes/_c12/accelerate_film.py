"""ACCELERATE c12: cut Master Hands (1936, Prelinger / archive.org, public domain) into grey sprite atlases for the scene.
The workers, hands and machines of the piece are the film's own (Flint, Michigan, 1936). Source files: videos/sources/footage/MasterHa1936*.mp4
(see videos/sources/footage/CATALOG.md for the shot log and the licence line). Usage: python3 accelerate_film.py [clip ...]
Writes videos/web/assets/intelligence/c12/<clip>.jpg + clips.json (cells 480x360, 8 across)."""
import json, os, subprocess, sys, math
FF = '/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2'
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', '..', '..', 'sources', 'footage')
OUT = os.path.join(HERE, '..', '..', 'assets', 'intelligence', 'c12')
mm = lambda m, s: m * 60 + s
M1, M3, M4 = 'MasterHa1936.mp4', 'MasterHa1936_3.mp4', 'MasterHa1936_4.mp4'
CLIPS = {  # name: (file, start s, duration s, fps)
    'fist':     (M1, mm(3, 55.0), 3.5, 30),    # a fist grips a lever and throws it
    'start':    (M1, mm(4, 11.0), 4.0, 30),    # a finger presses START
    'flywheel': (M1, mm(4, 0.0), 6.0, 15),
    'wheelB':   (M1, mm(3, 41.0), 6.0, 15),
    'faceA':    (M1, mm(1, 28.5), 3.5, 15),
    'faceB':    (M1, mm(1, 40.0), 5.0, 15),
    'faceC':    (M1, mm(2, 40.0), 4.0, 15),
    'micro':    (M1, mm(1, 49.0), 6.0, 15),
    'drill':    (M1, mm(2, 15.0), 4.0, 15),
    'valve':    (M1, mm(3, 35.0), 3.0, 15),
    'forgeFace':(M3, 19.0, 4.0, 15),
    'forgeGlow':(M3, 34.0, 6.0, 15),
    'table':    (M4, 9.0, 14.0, 15),
    'press5':   (M4, mm(1, 21.0), 10.0, 15),
    'frameline':(M4, mm(1, 36.0), 12.0, 15),
    'leverhand':(M4, mm(1, 50.0), 7.0, 15),
    'floor':    (M4, mm(2, 27.0), 20.0, 15),
    'bigpress': (M4, mm(4, 51.0), 15.0, 15),
    'flyhi':    (M4, mm(5, 34.0), 9.0, 15),
    'engine':   (M4, mm(4, 27.0), 15.0, 15),
    'panel':    (M4, mm(6, 0.0), 8.0, 15),
    'grille':   (M4, mm(7, 0.0), 10.0, 15),
    'chassis':  (M4, mm(7, 18.0), 12.0, 15),
    'oldman':   (M4, mm(5, 26.0), 3.5, 15),
    # "Machine: Master or Slave?" (1941, Prelinger, public domain; /tmp/o/ms_hi.mp4 = the 640x480 derivative from archive.org/details/machine-master_or_slave)
    'build':    ('/tmp/o/ms_hi.mp4', mm(14, 57.0), 6.0, 15),
    'board':    ('/tmp/o/ms_hi.mp4', mm(13, 56.0), 8.0, 15),
    'fish':     ('/tmp/o/ms_hi.mp4', mm(15, 42.0), 4.0, 15),
    'road':     ('/tmp/o/ms_hi.mp4', mm(15, 58.0), 6.0, 15),
    'pressmen': ('/tmp/o/ms_hi.mp4', mm(1, 42.0), 8.0, 15),
}
CW, CH, COLS = 480, 360, 8
want = sys.argv[1:] or list(CLIPS)
os.makedirs(OUT, exist_ok=True)
mp = os.path.join(OUT, 'clips.json')
meta = json.load(open(mp)) if os.path.exists(mp) else {}
for name in want:
    f, t0, dur, fps = CLIPS[name]
    n = int(dur * fps); rows = math.ceil(n / COLS)
    subprocess.run([FF, '-y', '-loglevel', 'error', '-ss', str(t0), '-t', str(dur), '-i', f if os.path.isabs(f) else os.path.join(SRC, f),
                    '-vf', f'fps={fps},scale={CW}:{CH},format=gray,tile={COLS}x{rows}:padding=0', '-frames:v', '1', '-q:v', '3', os.path.join(OUT, name + '.jpg')], check=True)
    meta[name] = {'n': n, 'cols': COLS, 'cw': CW, 'ch': CH, 'fps': fps, 'src': f, 't0': t0}
json.dump(meta, open(mp, 'w'), indent=1)
print({k: meta[k]['n'] for k in want})
