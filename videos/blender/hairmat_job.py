# HAIRMAT (round 7, 8 Oct): ONE farm GPU job = a Cycles A/B of the hair fibre model on SEVERAL current people, each exported and baked
# ONCE: person_job.py renders every shot as the CONTROL (the current person: the fibre model as landed in
# videos/web/assets/person/v7lanes/HAIRMAT.json, which person_hair.build_part applies through hairmat7.dress), then for each shot the
# variants re-render the same export with render_person.py under the A/B switches (blender/hairmat7.py):
#   off   HAIRMAT=off: person_hair.py's own material and fibres (the hair before the fibre model)
#   full  HAIRMAT=full HAIRMAT_CHILD=rigid: the fibre model with iteration 1's render children (the landed law)
#   lock  HAIRMAT=full HAIRMAT_CHILD=lock: the fibre model with the children as fibres of the lock (iteration 2, under measurement)
#   python3 videos/scripts/farm.py gpu --blender videos/blender/hairmat_job.py --time 150 --mem 48 --no-wait --by HAIRMAT --title <t> -- \
#       --who latest:L08_f24_hispanic,latest:L22_f27_black --shots face:over:work:studio@5,bust:over:work:studio@5 \
#       --variants face=lock,bust=lock --samples 256 --scale 1 --quality farm --sss-thick auto --uv-fix
# Stills: <out>/cyc_<who>_<shot>_<light>_<wear>_<stage>.png (control, person_job's own tag) and the same tag + '_hm<variant>' for each variant;
# <out>/hairmat_params_<who>.json (what the model set); <out>/hairmat_job.json (each step's exit code and seconds); the 'hairmat7 {...}'
# lines of log.txt (fibres, children law, seconds) for every render.
import os, sys, json, shlex, subprocess, time, shutil

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
def opt(k, d=None):
    return argv[argv.index('--' + k) + 1] if '--' + k in argv else d
HERE = os.path.dirname(os.path.abspath(__file__)); VIDEOS = os.path.dirname(HERE)
WHO = [w for w in (opt('who') or '').split(',') if w]
if not WHO:
    raise SystemExit('hairmat_job: --who a,b,c')
SHOTS = [(s.split(':') + [None])[:4] for s in opt('shots', 'face:over:work:studio@5').split(',')]
ENVS = {'off': dict(HAIRMAT='off'), 'full': dict(HAIRMAT='full', HAIRMAT_CHILD='rigid'), 'lock': dict(HAIRMAT='full', HAIRMAT_CHILD='lock')}
VAR = {}
for item in (opt('variants') or '').split(','):
    if '=' in item:
        k, v = item.split('=', 1); VAR[k] = [x for x in v.split('+') if x in ENVS]
DEFV = ['lock']
rest, i = [], 0
while i < len(argv):   # every argument but ours passes to person_job.py
    if argv[i] in ('--who', '--work', '--out', '--variants', '--blender', '--node'):
        i += 2; continue
    rest.append(argv[i]); i += 1
try:
    import bpy
    BLENDER = bpy.app.binary_path
except ImportError:
    BLENDER = opt('blender', 'blender')
NODE = opt('node', 'node')
WORK = os.path.abspath(opt('work', os.environ.get('GPU_TMP') or os.path.join(VIDEOS, 'out', 'cycles_job')))
OUT = os.path.abspath(opt('out', os.environ.get('GPU_OUT') or os.path.join(WORK, 'stills')))
os.makedirs(OUT, exist_ok=True)
os.environ['PYTHONHASHSEED'] = '0'
boot = os.path.join(HERE, 'gpujob', 'boot.py')
pre = ['--python', boot] if os.environ.get('GPU_JOB_DEVICE') and os.path.exists(boot) else []
log = {'who': WHO, 'shots': SHOTS, 'variants': VAR or 'lock for every shot', 'args': rest, 'runs': []}
def step(tag, cmd, env=None):
    print('hairmat_job $', ' '.join(shlex.quote(c) for c in cmd), flush=True)
    t = time.time(); r = subprocess.run(cmd, cwd=VIDEOS, env=env)
    log['runs'].append({'tag': tag, 'code': r.returncode, 's': round(time.time() - t, 1)})
    json.dump(log, open(os.path.join(OUT, 'hairmat_job.json'), 'w'), indent=1)
    print(f'hairmat_job: {tag} exited {r.returncode} after {time.time() - t:.0f} s', flush=True)
    return r.returncode
code_all = 0
for w in WHO:
    key = w.replace(':', '_'); pw = os.path.join(WORK, 'hm_' + key)
    # 1. the control: person_job.py as any lane runs it (export, unwrap, bakes, every shot): the current person, the hair as landed
    env0 = dict(os.environ)
    for k in ('HAIRMAT', 'HAIRMAT_PARAMS', 'HAIRMAT_CHILD'):
        env0.pop(k, None)
    rc = step(f'{w} control', [BLENDER, '-b', '--factory-startup', '-noaudio', '--python-exit-code', '1', '--python', os.path.join(HERE, 'person_job.py'), '--',
                               '--who', w] + rest + ['--work', pw, '--out', OUT], env0)
    code_all = code_all or rc
    pj = os.path.join(OUT, 'person_job_log.json')
    if os.path.exists(pj):
        shutil.move(pj, os.path.join(OUT, 'person_job_log_' + key + '.json'))
    ex = {x: os.path.join(pw, f'{key}_{x}') for x in ('bare', 'work')}
    MAPS = {x: os.path.join(ex[x], 'maps') for x in ex}
    try:   # person_job.py's rule: the dressed export reuses the bare atlas when their unwraps match
        if os.path.getsize(os.path.join(ex['work'], 'uv.bin')) == os.path.getsize(os.path.join(ex['bare'], 'uv.bin')):
            MAPS['work'] = MAPS['bare']
    except OSError:
        pass
    # 2. the person's fibre model (from the export's own cast record)
    params = {}
    for x in ex:
        if os.path.exists(os.path.join(ex[x], 'manifest.json')):
            pth = os.path.join(ex[x], 'hairmat_params.json')
            if step(f'{w} fibre_params {x}', [NODE, 'web/labs/hairmat/fibre_params.mjs', ex[x], '--out', pth]) == 0:
                params[x] = pth
                if x == 'work' or 'work' not in ex or not os.path.exists(os.path.join(ex['work'], 'manifest.json')):
                    shutil.copyfile(pth, os.path.join(OUT, f'hairmat_params_{key}.json'))
    # 3. the variants: the same render command person_job.py ran (render_person.py), under the variant's switches
    for shot, light, wear, stg in SHOTS:
        stg = stg or opt('stage')
        if wear not in params:
            code_all = code_all or 3; print(f'hairmat_job: no export / params for {w} {wear}: variants skipped', flush=True); continue
        l5 = (['--stage', stg] if stg else []) + (['--quality', opt('quality')] if opt('quality') else []) + (['--sss-thick', opt('sss-thick')] if opt('sss-thick') else [])
        l5 += sum(([f'--{k}', opt(k)] for k in ('camera7', 'c7-bias', 'c7-display', 'c7-sharpen', 'c7-paper', 'c7-bounce') if opt(k)), [])
        tag = f'cyc_{key}_{shot}_{light}_{wear}' + (f'_{stg.replace("@", "r")}' if stg else '')
        for v in VAR.get(shot, DEFV):
            env = dict(os.environ, HAIRMAT_PARAMS=params[wear], **ENVS[v])
            rc = step(f'{w} {shot} hm{v}', [BLENDER, '-b', '--factory-startup', '-noaudio', '--python-exit-code', '1'] + pre + ['--python', os.path.join(HERE, 'render_person.py'), '--',
                      '--export', ex[wear], '--maps', MAPS[wear], '--shot', shot, '--light', light, '--samples', opt('samples', '128'), '--scale', opt('scale', '1'),
                      '--out', OUT, '--tag', tag + '_hm' + v] + l5, env)
            code_all = code_all or rc
    shutil.rmtree(pw, ignore_errors=True)   # the worker's disk holds one person at a time
# the scene-linear EXRs are not needed for the boards (the PNGs are the display): keep the delivery small
for f in os.listdir(OUT):
    if f.endswith('.exr'):
        try:
            os.remove(os.path.join(OUT, f))
        except OSError:
            pass
print('hairmat_job done', json.dumps(log['runs']), flush=True)
if code_all:
    raise SystemExit(f'hairmat_job: a step failed ({code_all}); the others are in {OUT}')
