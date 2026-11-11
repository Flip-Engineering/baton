# EYES: ONE farm GPU job = for each person, person_job.py (export, unwrap, bake, the eye7 record and maps, and the shots: the CURRENT person,
# whose eyes are eye7 since 15 Oct c5: build.js DEFAULTS eyes { eye7: {} }; --popts '{"eyes":{"eye7":{}}}' is passed too, so the job says the
# same whatever the defaults), then the MACRO: the first shot again at --macro x the scale, cropped to both eyes and their lids (eye_crop
# below, from the export's camera and globes), on the same export, bake and stage. Each person's work folder is removed after it.
#   python3 videos/scripts/farm.py gpu --blender videos/blender/eye7_job.py --time 180 --mem 48 --no-wait --by EYES --title <t> -- \
#       --who latest:L08_f24_hispanic,latest:L22_f27_black --shots face:over:work:studio@5,bust:over:work:studio@5 --macro 3 \
#       --samples 256 --scale 1 --quality farm --sss-thick auto --uv-fix
# Stills: <out>/cyc_<who>_<shot>_<light>_<wear>_<stage>.png (person_job's tags) and the first shot's tag + '_eye7macro'; eye7_cycles' log
# lines in the job log ('eye7_cycles:' the pupil, the margin per eye; 'eye7_cycles gaze:'); <out>/eye7_job.json: per person, every step.
# (c5 it 1) The old control (the superseded eye) and the transport A/B are gone: eye7 is the person's eye, and the A/B (MNEE vs the straight
# shadow ray) came out pixel-identical (it 11), so MNEE was deleted from eye7_cycles.py. A before is a delivered earlier render.
import os, sys, json, shlex, subprocess, time, shutil, math

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
def opt(k, d=None):
    return argv[argv.index('--' + k) + 1] if '--' + k in argv else d
HERE = os.path.dirname(os.path.abspath(__file__)); VIDEOS = os.path.dirname(HERE)
WHO = [w for w in (opt('who') or '').split(',') if w]
if not WHO:
    raise SystemExit('eye7_job: --who a,b,c')
POPTS = json.dumps({**json.loads(opt('popts') or '{}'), 'eyes': {'eye7': {}}})   # eye7 on, whatever the defaults
SHOTS = [(s.split(':') + [None])[:4] for s in opt('shots', 'face:over:work:studio@5').split(',')]
try:
    import bpy
    BLENDER = bpy.app.binary_path
except ImportError:
    BLENDER = opt('blender', 'blender')
NODE = opt('node', 'node')
WORK = os.path.abspath(opt('work', os.environ.get('GPU_TMP') or os.path.join(VIDEOS, 'out', 'cycles_job')))
OUT = os.path.abspath(opt('out', os.environ.get('GPU_OUT') or os.path.join(WORK, 'stills')))
os.makedirs(OUT, exist_ok=True)
# the arguments person_job.py takes unchanged (everything but ours)
pj_args, i = [], 0
while i < len(argv):
    if argv[i] in ('--who', '--work', '--out', '--shots', '--node', '--blender', '--macro', '--popts'):
        i += 2; continue
    pj_args.append(argv[i]); i += 1
boot = os.path.join(HERE, 'gpujob', 'boot.py')
log = {'who': WHO, 'shots': SHOTS, 'popts': POPTS, 'args': pj_args, 'people': []}
code_all = 0

def run(cmd, rec, tag, env=None):
    print('eye7_job $', ' '.join(shlex.quote(c) for c in cmd), ('(env %s)' % env) if env else '', flush=True)
    t = time.time(); r = subprocess.run(cmd, cwd=VIDEOS, env=({**os.environ, **env} if env else None))
    rec['steps'].append({'tag': tag, 'code': r.returncode, 's': round(time.time() - t, 1)}); return r.returncode


def eye_crop(export, shot='face'):
    """the crop (x0, y0, x1, y1 as fractions, y down: render_person's --crop) that holds both eyes with their lids, the canthi and the
    brows' lower edge, from the export's own camera record and globes (the head frame: x across, y up, z forward)"""
    import numpy as np
    M = json.load(open(os.path.join(export, 'manifest.json'))); rec = M['cameras'][shot]; E = M['eyes']
    Ci = np.linalg.inv(np.array(rec['matrix'], float).reshape(4, 4).T); Mh = np.array(E['headMatrix'], float).reshape(4, 4).T
    cs = np.array([g['c'] for g in E['globes']]); mid = cs.mean(0)
    box = [np.array([x, mid[1] + y, mid[2] + z]) for x in (cs[:, 0].min() - 0.026, cs[:, 0].max() + 0.026) for y in (-0.017, 0.024) for z in (-0.012, 0.012)]
    t = math.tan(math.radians(rec['fovY']) / 2); asp = rec['W'] / rec['H']; uv = []
    for p in box:
        q = Ci @ (Mh @ np.r_[p, 1.0]); x, y = q[0] / -q[2], q[1] / -q[2]
        uv.append((0.5 + x / (2 * t * asp), 0.5 - y / (2 * t)))
    uv = np.clip(np.array(uv), 0, 1)
    return [round(float(v), 4) for v in (*uv.min(0), *uv.max(0))]

for w in WHO:
    key = w.replace(':', '_'); pw = os.path.join(WORK, 'e7_' + key); rec = {'who': w, 'steps': []}; log['people'].append(rec)
    # 1. person_job: export (eye7 on: the record and maps go into the export), unwrap, bake, and every shot
    code = run([BLENDER, '-b', '--factory-startup', '-noaudio', '--python-exit-code', '1', '--python', os.path.join(HERE, 'person_job.py'), '--',
                '--who', w, '--shots', ','.join(':'.join(x for x in sh if x) for sh in SHOTS), '--popts', POPTS] + pj_args + ['--work', pw, '--out', OUT], rec, 'person_job')
    pjl = os.path.join(OUT, 'person_job_log.json')
    if os.path.exists(pjl):
        shutil.move(pjl, os.path.join(OUT, 'person_job_log_' + key + '.json'))
    ex = {wr: os.path.join(pw, f'{key}_{wr}') for wr in ('bare', 'work')}
    maps = {'bare': os.path.join(ex['bare'], 'maps'), 'work': os.path.join(ex['work'], 'maps')}
    try:
        if os.path.getsize(os.path.join(ex['work'], 'uv.bin')) == os.path.getsize(os.path.join(ex['bare'], 'uv.bin')):
            maps['work'] = maps['bare']
    except OSError:
        pass
    # 2. the macro of the first shot: both eyes, cropped, at --macro x the scale (eye7_cycles installed, as person_job does for an eye7 person)
    shot, light, wear, stg = SHOTS[0]
    if opt('macro') and os.path.exists(os.path.join(ex[wear], 'manifest.json')):
        if not (json.load(open(os.path.join(ex[wear], 'manifest.json'))).get('eyes') or {}).get('eye7'):
            run([NODE, 'web/labs/eyes/eye7_maps.mjs', ex[wear]], rec, 'eye7_maps_' + wear)   # person_job writes them for an eye7 person; this only if it did not
        pre = ['--python', boot] if os.environ.get('GPU_JOB_DEVICE') and os.path.exists(boot) else []
        l5 = (['--stage', stg] if stg else []) + sum(([f'--{k}', opt(k)] for k in ('quality', 'sss-thick', 'camera7', 'c7-bias', 'c7-display', 'c7-sharpen') if opt(k)), [])
        tg = f'cyc_{key}_{shot}_{light}_{wear}' + (f'_{stg.replace("@", "r")}' if stg else '') + '_eye7macro'
        try:
            crop = eye_crop(ex[wear], shot); rec.setdefault('crop', crop)
        except Exception as e:
            crop = None; rec['steps'].append({'tag': 'eye_crop', 'code': repr(e)[:200]})
        if crop:
            c = run([BLENDER, '-b', '--factory-startup', '-noaudio', '--python-exit-code', '1'] + pre + ['--python', os.path.join(HERE, 'eye7_cycles.py'),
                     '--python', os.path.join(HERE, 'render_person.py'), '--', '--export', ex[wear], '--maps', maps[wear], '--shot', shot, '--light', light,
                     '--samples', opt('samples', '256'), '--scale', str(float(opt('scale', '1')) * float(opt('macro'))), '--crop', ','.join(map(str, crop)),
                     '--out', OUT, '--tag', tg] + l5, rec, tg)
            code = code or c
    elif opt('macro'):
        rec['steps'].append({'tag': 'macro', 'code': 'no export'}); code = code or 1
    # keep the eye7 record (small) beside the stills; the export goes
    for wr, d in ex.items():
        j = os.path.join(d, 'eye7', 'eye7.json')
        if os.path.exists(j):
            shutil.copyfile(j, os.path.join(OUT, f'eye7_{key}_{wr}.json'))
    shutil.rmtree(pw, ignore_errors=True)
    rec['code'] = code; code_all = code_all or code
    json.dump(log, open(os.path.join(OUT, 'eye7_job.json'), 'w'), indent=1)
    print(f'eye7_job: {w} done, code {code}', flush=True)
print('eye7_job done', json.dumps([(p['who'], p.get('code')) for p in log['people']]), flush=True)
if code_all:
    raise SystemExit(f'eye7_job: a step failed ({code_all}); the others are in {OUT}')
