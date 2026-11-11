# ANAT8-BODY (c5 run iteration 1, 15 Oct 2026): THE SOFT-TISSUE SOLVE'S BAKES MADE ON THE FARM, IN PARALLEL, THEN THE RENDERS THAT READ THEM, IN ONE JOB.
# The person build solves a woman's breast on a missing or stale key and writes the bake (lib/fx/person/soft7.js, the integrator's; ANAT8-BODY's
# soft/breast.js and soft/envelope.js): 13-75 min a woman, one side after the other. A render job pays that once per person in its export, again in
# the skin bake's page (which never solves: it reports the bake missing), and nobody else gets the bake. Here every woman named is built ONCE in
# parallel (node labs/human8/anat8b/soft_bake.mjs NAME: the build's own writer, lib/fx/anatomy/soft/hook.js bakeSoft, keyed as the build keys it, into
# assets/anatomy/soft/NAME.json in the job's checkout), the bakes are delivered (GPU_OUT/bakes/, for the studio to commit), and then the renders run on the same checkout and read them:
#   1. clay  videos/blender/body7_clay_job.py (a child Blender): the nude form, the latest person (the soft slot ON)  -> GPU_OUT/clay/
#   2. Cycles videos/blender/person7_job.py (a child Blender): the merged person, every lane on                       -> GPU_OUT/cycles/
#   python3 videos/scripts/farm.py gpu --blender videos/blender/anat8b_soft_job.py --time 240 --mem 48 --no-wait --by ANAT8-BODY --title T -- \
#       --bake L08_f24_hispanic,L06_f53_white,... --clay '<body7_clay_job args>' [--clay-ab 'ENV=VALUE'] --cycles '<person7_job args>'
# (--clay / --cycles: the child's own arguments as one string; either may be omitted.) OUR renders and our solve only.
# (lane iteration 22, 16 Oct) BAKE BEFORE LAND: --candidate PATCH[,PATCH] (repo-relative unified diffs COMMITTED at the pin, e.g.
# videos/web/labs/human8/anat8b/candidates/skeleton_v4.patch) applies a change of the anatomy to THIS JOB'S CHECKOUT ONLY (git apply --check, then
# git apply; the job stops if it does not apply) before the bakes, so the bakes a change makes stale (soft: sk / mu / so / br; ANAT8-PELVIS: sk / mu /
# so / pv) are made on the farm's CPU with the change's own key, and the change lands in the tree WITH them, in one commit (no window in which every
# node build re-solves on a miss and every page skips the region). With --clay, the clay is rendered TWICE at the same pin: FIRST as committed (the
# tree before the candidate, its committed bakes: GPU_OUT/clay_pin/), then after the candidate and its bakes (GPU_OUT/clay/): before | after in one job.
# --pelvis NAMES re-bakes ANAT8-PELVIS's region for those people (labs/human8/anat8b/pelvis_bake.mjs: their own writer, read only) in parallel with the
# soft bakes; delivered to GPU_OUT/bakes_pelvis/. The candidate's sha256 and the files it touched are in anat8b_soft_job.json ('candidate').
import os, sys, json, shlex, subprocess, time, shutil, glob

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
def opt(k, d=None):
    return argv[argv.index('--' + k) + 1] if '--' + k in argv else d
HERE = os.path.dirname(os.path.abspath(__file__)); VIDEOS = os.path.dirname(HERE); WEB = os.path.join(VIDEOS, 'web')
OUT = os.path.abspath(os.environ.get('GPU_OUT') or os.path.join(VIDEOS, 'out', 'anat8b_soft_job'))
TMP = os.path.abspath(os.environ.get('GPU_TMP') or os.path.join(OUT, 'tmp'))
os.makedirs(OUT, exist_ok=True); os.makedirs(TMP, exist_ok=True)
try:
    import bpy
    BLENDER = bpy.app.binary_path
except ImportError:
    BLENDER = opt('blender', 'blender')
NODE = opt('node', 'node')
log = {'steps': [], 'bakes': {}}
def save():
    json.dump(log, open(os.path.join(OUT, 'anat8b_soft_job.json'), 'w'), indent=1)

def classify_bake_completion(name, code, child_log, output_exists, output_mtime, started, elapsed):
    written = bool(output_exists and output_mtime >= started - 5)
    prefix = f'soft_bake: {name}: the bake is current ('
    reused_current = bool(code == 0 and output_exists and any(
        line.startswith(prefix) and line.endswith(')') for line in child_log.splitlines()
    ))
    success = bool(code == 0 and output_exists and (written or reused_current))
    if code != 0:
        state = 'failed'
    elif not output_exists:
        state = 'missing'
    elif written:
        state = 'written'
    elif reused_current:
        state = 'reused-current'
    else:
        state = 'unverified'
    return {'code': code, 's': round(elapsed, 1), 'written': written,
            'reused_current': reused_current, 'success': success, 'state': state,
            'kb': None}
def run(cmd, cwd=WEB, env=None, name=None):
    t = time.time(); print('anat8b_soft $', ' '.join(shlex.quote(c) for c in cmd), flush=True)
    r = subprocess.run(cmd, cwd=cwd, env=env)
    log['steps'].append({'step': name or cmd[0], 's': round(time.time() - t, 1), 'code': r.returncode}); save()
    return r.returncode

# node's packages (person_job.py's rule: npm ci from the committed lock, cached under GPU_JOB_HOME)
env = dict(os.environ); home = os.environ.get('GPU_JOB_HOME')
if home:
    env.setdefault('npm_config_cache', os.path.join(home, 'npm-cache'))
three = os.path.join(WEB, 'node_modules', 'three')
if not all(os.path.exists(os.path.join(three, f)) for f in ('package.json', os.path.join('build', 'three.module.js'))):
    if run(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], WEB, env, 'npm ci'):
        raise SystemExit('anat8b_soft: npm ci failed')

def child(script, args, sub, extra=None):
    e = dict(os.environ); e.update(extra or {}); e['GPU_OUT'] = os.path.join(OUT, sub); e['GPU_TMP'] = os.path.join(TMP, sub)
    os.makedirs(e['GPU_OUT'], exist_ok=True); os.makedirs(e['GPU_TMP'], exist_ok=True)
    cmd = [BLENDER, '-b', '--factory-startup', '-noaudio', '--python-exit-code', '1', '--python', os.path.join(HERE, script), '--'] + shlex.split(args)
    code = run(cmd, VIDEOS, e, script)
    shutil.rmtree(e['GPU_TMP'], ignore_errors=True)
    return code
codes = []

# 0. (lane iteration 22) BAKE BEFORE LAND: the pin as committed first (the 'before' clay), then the candidate applied to this checkout only
CAND = [c for c in (opt('candidate') or '').split(',') if c]
if CAND:
    ROOT = os.path.dirname(VIDEOS); import hashlib
    if opt('clay'):
        codes.append(child('body7_clay_job.py', opt('clay'), 'clay_pin'))
    log['candidate'] = []
    for c in CAND:
        cp = os.path.join(ROOT, c)
        if not os.path.exists(cp):
            save(); raise SystemExit(f'anat8b_soft: candidate {c} is not in the checkout (commit it before posting)')
        sha = hashlib.sha256(open(cp, 'rb').read()).hexdigest()
        files = [l[6:].strip() for l in open(cp, encoding='utf-8', errors='replace') if l.startswith('+++ b/')]
        if run(['git', 'apply', '--check', cp], ROOT, env, 'candidate check ' + c) or run(['git', 'apply', cp], ROOT, env, 'candidate apply ' + c):
            log['candidate'].append({'patch': c, 'sha256': sha, 'files': files, 'applied': False}); save()
            raise SystemExit(f'anat8b_soft: candidate {c} does not apply to the pin; nothing baked')
        log['candidate'].append({'patch': c, 'sha256': sha, 'files': files, 'applied': True}); save()
        print(f'anat8b_soft: candidate {c} applied ({sha[:12]}; {files})', flush=True)

# 1. the bakes, in parallel: one node process a woman (soft_bake.mjs: skipped when the bake in the checkout is already current), and (lane iteration 22)
# ANAT8-PELVIS's region for --pelvis NAMES (pelvis_bake.mjs: their writer), all at once
BAKE = [w for w in (opt('bake') or '').split(',') if w]
PELV = [w for w in (opt('pelvis') or '').split(',') if w]
SOFT = os.path.join(WEB, 'assets', 'anatomy', 'soft'); PELVD = os.path.join(WEB, 'assets', 'anatomy', 'pelvis')
if BAKE or PELV:
    procs = []; t0 = time.time()
    for kind, names, tool, sub, d in (('soft', BAKE, 'soft_bake.mjs', 'bakes', SOFT), ('pelvis', PELV, 'pelvis_bake.mjs', 'bakes_pelvis', PELVD)):
        if not names:
            continue
        os.makedirs(os.path.join(OUT, sub), exist_ok=True)
        for w in names:
            lf = open(os.path.join(OUT, sub, f'bake_{w}.log'), 'w')
            cmd = [NODE, 'labs/human8/anat8b/' + tool, w]
            print('anat8b_soft $', ' '.join(cmd), flush=True)
            procs.append((kind, w, sub, d, subprocess.Popen(cmd, cwd=WEB, env=env, stdout=lf, stderr=subprocess.STDOUT), lf, time.time()))
    for kind, w, sub, d, p, lf, t in procs:
        code = p.wait(); lf.close(); f = os.path.join(d, w + '.json')
        exists = os.path.exists(f); mtime = os.path.getmtime(f) if exists else 0
        if kind == 'soft':
            with open(lf.name) as bake_log_file:
                child_log = bake_log_file.read()
            rec = classify_bake_completion(w, code, child_log, exists, mtime, t0, time.time() - t)
            rec['kb'] = round(os.path.getsize(f) / 1024) if exists else None
            log['bakes'][w] = rec
        else:
            ok = exists and mtime >= t0 - 5
            rec = {'code': code, 's': round(time.time() - t, 1), 'written': ok, 'kb': round(os.path.getsize(f) / 1024) if exists else None}
            log.setdefault('bakes_pelvis', {})[w] = rec
        if os.path.exists(f):
            shutil.copy(f, os.path.join(OUT, sub, w + '.json'))
        print(f'anat8b_soft: {kind} bake {w} exited {code} ({rec})', flush=True); save()

# 2. clay, 3. Cycles: child Blenders on the same checkout (they read the bakes just written)
if opt('clay'):
    codes.append(child('body7_clay_job.py', opt('clay'), 'clay'))
# --clay-ab 'NAME=VALUE[,NAME=VALUE]' (lane iteration 18): the same clay again with those environment variables set for its node export (the
# hook's one A/B arm, e.g. ANAT8_SOFT_NAC=rule), into GPU_OUT/clay_ab/: before | after in one job, the same checkout and bakes
if opt('clay') and opt('clay-ab'):
    ab = dict(kv.split('=', 1) for kv in opt('clay-ab').split(',') if '=' in kv); log['clay_ab'] = ab
    codes.append(child('body7_clay_job.py', opt('clay'), 'clay_ab', ab))
if opt('cycles'):
    codes.append(child('person7_job.py', opt('cycles') + ' --out ' + shlex.quote(os.path.join(OUT, 'cycles')), 'cycles'))
# the EXR beside every PNG is not needed for the reads (disk): keep the PNGs and the JSON
for f in glob.glob(os.path.join(OUT, '**', '*.exr'), recursive=True):
    os.remove(f)
save(); print('anat8b_soft done', json.dumps(log), flush=True)
if any(codes):
    raise SystemExit(f'anat8b_soft: a child failed ({codes}); the rest is in {OUT}')
