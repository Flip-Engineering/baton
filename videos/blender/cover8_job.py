# CLOTH8 c2 (round 7, 8 Oct): ONE farm GPU job = person_job.py for several people in turn (the same arguments for each), for the
# 'shrink, don't drop' gate (lib/fx/cloth/cloth8/cover8.js, blender/cover8.py: the covered skin kept and pushed in, opt-in by
# --popts '{"cover8": {...}}'). The controls are the v6 Cycles jobs with the same shots (1007-215504 L03, 1007-215501 L21, 1008-031604 L22).
#   python3 videos/scripts/farm.py gpu --blender videos/blender/cover8_job.py --time 150 --mem 24 --no-wait --by CLOTH8 --title <t> -- \
#       --who v6:L03_m38_asian,v6:L21_m32_black,v6:L22_f27_black --shots face:over:work:studio@5,bust:over:work:studio@5 \
#       --samples 256 --scale 1 --quality farm --sss-thick auto --uv-fix --popts '{"cover8":{"d":0.004}}'
# Every argument but --who goes to person_job.py unchanged; stills land in one --out (GPU_OUT) under person_job's own tags; a person whose
# chain fails does not stop the next. <out>/cover8_job.json: each person's exit code and seconds.
# (c2 it2, 8 Oct) VARIANTS: --variants '<json>' = an ordered map name -> popts; every person runs once per variant, each with that
# popts (in place of --popts), its own work folder (removed after the run: the worker's disk) and its stills in <out>/<name>/ (the tags
# are person_job's, so the variants of one person share tags and differ by folder). A popts "bake" may be a map by person name with
# "*" as the default ({"L21_m32_black": "v8c/dress7", "*": "v8c"}: v6 poses L21 from MOTION's dressed bake). For the cover8 rev 2 gate:
#   ... cover8_job.py --time 150 --mem 24 ... -- --who v6:L03_m38_asian,v6:L21_m32_black --shots face:over:work:studio@5,bust:over:work:studio@5 \
#       --samples 256 --scale 1 --quality farm --sss-thick auto --uv-fix \
#       --variants '{"off":{},"c8r2":{"cover8":{"d":0.004,"clear":0.006}},"v8c":{"bake":{"L21_m32_black":"v8c/dress7","*":"v8c"},"cover8":{"d":0.004,"clear":0.006}}}'
import os, sys, json, shlex, subprocess, time, shutil

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
def opt(k, d=None):
    return argv[argv.index('--' + k) + 1] if '--' + k in argv else d
HERE = os.path.dirname(os.path.abspath(__file__)); VIDEOS = os.path.dirname(HERE)
WHO = [w for w in (opt('who') or '').split(',') if w]
VARIANTS = json.loads(opt('variants'), object_pairs_hook=lambda kv: dict(kv)) if opt('variants') else None
rest = []
i = 0
while i < len(argv):
    if argv[i] in (('--who', '--variants', '--popts', '--work', '--out') if VARIANTS else ('--who',)):
        i += 2; continue
    rest.append(argv[i]); i += 1
try:
    import bpy
    BLENDER = bpy.app.binary_path
except ImportError:
    BLENDER = opt('blender', 'blender')
WORK = os.path.abspath(opt('work', os.environ.get('GPU_TMP') or os.path.join(VIDEOS, 'out', 'cycles_job')))
OUT = os.path.abspath(opt('out', os.environ.get('GPU_OUT') or os.path.join(WORK, 'stills')))
log = {'who': WHO, 'args': rest, 'runs': []}
code_all = 0
def popts_for(po, w):
    po = dict(po); b = po.get('bake'); name = w.split(':')[-1]
    if isinstance(b, dict):
        b = b.get(name, b.get('*'))
        if b is None: po.pop('bake', None)
        else: po['bake'] = b
    return po
for w in WHO:
    for vname, po in (VARIANTS.items() if VARIANTS else [(None, None)]):
        extra = []
        if vname is not None:
            vw = os.path.join(WORK, 'c8v_' + vname); extra = ['--popts', json.dumps(popts_for(po, w)), '--work', vw, '--out', os.path.join(OUT, vname)]
        cmd = [BLENDER, '-b', '--factory-startup', '-noaudio', '--python-exit-code', '1', '--python', os.path.join(HERE, 'person_job.py'), '--', '--who', w] + rest + extra
        print('cover8_job $', ' '.join(shlex.quote(c) for c in cmd), flush=True)
        t = time.time(); r = subprocess.run(cmd, cwd=VIDEOS)
        log['runs'].append({'who': w, 'variant': vname, 'popts': extra[1] if extra else None, 'code': r.returncode, 's': round(time.time() - t, 1)}); code_all = code_all or r.returncode
        print(f'cover8_job: {w} {vname or ""} exited {r.returncode} after {time.time() - t:.0f} s', flush=True)
        if vname is not None:
            shutil.rmtree(vw, ignore_errors=True)   # this run's own work folder only (exports, maps): the stills are in <out>/<variant>
os.makedirs(OUT, exist_ok=True)
json.dump(log, open(os.path.join(OUT, 'cover8_job.json'), 'w'), indent=1)
print('cover8_job done', json.dumps(log['runs']), flush=True)
if code_all:
    raise SystemExit(f'cover8_job: a person failed ({code_all}); the others are in {OUT}')
