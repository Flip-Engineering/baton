# SEVERAL PEOPLE IN ONE GPU JOB (integration, 8 Oct): person_job.py for SEVERAL people in turn (the pattern of cover8_job.py), so a Cycles A/B of
# the studio's person costs one queue slot, not one per person. Every argument but --who passes to person_job.py unchanged; each person
# runs in its own work folder under the job's (removed after that person, so the worker's disk holds one export at a time), and every
# person's stills land in the one --out (GPU_OUT) under person_job's own tags (cyc_<who>_<shot>_<light>_<wear>_<stage>.png); an A/B of the same
# person passes --popts per run in separate jobs. A person whose chain fails does not stop the next.
#   python3 videos/scripts/farm.py gpu --blender videos/blender/person7_job.py --time 180 --mem 48 --no-wait --by INTEGRATION-v7 --title <t> -- \
#       --who L08_f24_hispanic,L12_f39_white,L22_f27_black \
#       --shots face:over:work:studio@5,bust:over:work:studio@5,full:over:work:studio@5 --samples 256 --scale 1 --quality farm --sss-thick auto --uv-fix
# (--mem 48: DETAIL7's displacement in Cycles took 24.4 GB on a bare body in a window shot.) <out>/person7_job.json: each person's exit code
# and seconds. --who takes person_job's --who (a name of the twelve); --popts applies to every person; --aa (person_job's vanishing-skin
# diagnostic) runs for the FIRST person only.
import os, sys, json, shlex, subprocess, time, shutil

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
def opt(k, d=None):
    return argv[argv.index('--' + k) + 1] if '--' + k in argv else d
HERE = os.path.dirname(os.path.abspath(__file__)); VIDEOS = os.path.dirname(HERE)
# --runs '<json>' (integration c4, 15 Oct: a bisect in one job): a list of {"who": name, "tag": t, "popts": {...}?, "aa": "v1,v2"?, "shots": "s1,s2"?};
# each run is one person_job (its own export, so its own makePerson options) and its stills land in <out>/<tag>/; --who / --popts / --aa then
# unused. (c5 it3) a run's "shots" replaces the job's --shots for that run only, so an arm (one layer off) renders only the shot that shows it.
RUNS = json.loads(opt('runs')) if opt('runs') else None
WHO = [r['who'] for r in RUNS] if RUNS else [w for w in (opt('who') or '').split(',') if w]
if not WHO:
    raise SystemExit('person7_job: --who a,b,c')
rest = []
i = 0
while i < len(argv):
    if argv[i] in ('--who', '--work', '--out', '--aa', '--runs') or (RUNS and argv[i] == '--popts'):
        i += 2; continue
    rest.append(argv[i]); i += 1
if not RUNS:
    RUNS = [{'who': w, 'tag': None, 'aa': opt('aa') if k == 0 else None} for k, w in enumerate(WHO)]
try:
    import bpy
    BLENDER = bpy.app.binary_path
except ImportError:
    BLENDER = opt('blender', 'blender')
WORK = os.path.abspath(opt('work', os.environ.get('GPU_TMP') or os.path.join(VIDEOS, 'out', 'cycles_job')))
OUT = os.path.abspath(opt('out', os.environ.get('GPU_OUT') or os.path.join(WORK, 'stills')))
os.makedirs(OUT, exist_ok=True)
log = {'who': WHO, 'args': rest, 'runs': []}
code_all = 0
for R in RUNS:
    w = R['who']; OUT_R = os.path.join(OUT, R['tag']) if R.get('tag') else OUT; os.makedirs(OUT_R, exist_ok=True)
    pw = os.path.join(WORK, 'p7_' + (R.get('tag') or w.replace(':', '_')))
    rest_r = list(rest)
    if R.get('shots'):
        if '--shots' in rest_r: rest_r[rest_r.index('--shots') + 1] = R['shots']
        else: rest_r += ['--shots', R['shots']]
    cmd = [BLENDER, '-b', '--factory-startup', '-noaudio', '--python-exit-code', '1', '--python', os.path.join(HERE, 'person_job.py'), '--',
           '--who', w] + rest_r + ['--work', pw, '--out', OUT_R] + (['--aa', R['aa']] if R.get('aa') else []) + \
          (['--popts', json.dumps(R['popts'])] if R.get('popts') else [])
    print('person7_job $', ' '.join(shlex.quote(c) for c in cmd), flush=True)
    t = time.time(); r = subprocess.run(cmd, cwd=VIDEOS)
    log['runs'].append({'who': w, 'tag': R.get('tag'), 'popts': R.get('popts'), 'aa': R.get('aa'), 'shots': R.get('shots'), 'code': r.returncode, 's': round(time.time() - t, 1)}); code_all = code_all or r.returncode
    print(f'person7_job: {w} exited {r.returncode} after {time.time() - t:.0f} s', flush=True)
    # person_job's own log of this person (its steps and seconds) beside the stills, then this person's exports and maps go
    pj = os.path.join(OUT_R, 'person_job_log.json')
    if os.path.exists(pj):
        shutil.move(pj, os.path.join(OUT_R, 'person_job_log_' + w.replace(':', '_') + '.json'))
    shutil.rmtree(pw, ignore_errors=True)
    json.dump(log, open(os.path.join(OUT, 'person7_job.json'), 'w'), indent=1)
print('person7_job done', json.dumps(log['runs']), flush=True)
if code_all:
    raise SystemExit(f'person7_job: a person failed ({code_all}); the others are in {OUT}')
