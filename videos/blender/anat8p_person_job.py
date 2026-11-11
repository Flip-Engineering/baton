# ANAT8-PELVIS (round 7, 8 Oct 2026; review/studio_human_c8/after/anat8_pelvis/NOTES.md): the ONE CURRENT person (makePerson('<name>')) WITHOUT and WITH the
# lane's solved pelvic region, in one farm GPU job: person_job.py run once per person per side, as person7_job.py does (one queue slot), each side's
# stills in its own folder so the tags do not collide:
#   <out>/off/cyc_<name>_<shot>...png            the current person as every other lane renders it today
#   <out>/on/cyc_<name>_<shot>...png             the same person with --popts {"pelvis": {"module": "anatomy/pelvis/hook.js", "fn": "pelvis7"}}: the
#                                                region's solve (lib/fx/anatomy/pelvis, baked per person in assets/anatomy/pelvis/<name>.json) laid on
#                                                the body's bind through the person's pelvis slot (makePerson's `pelvis` option; iteration 3: was `soft`)
#   python3 videos/scripts/farm.py gpu --blender videos/blender/anat8p_person_job.py --time 180 --mem 48 --no-wait --by ANAT8-PELVIS --title <t> -- \
#       --who L08_f24_hispanic,L12_f39_white --sides off,on --shots full:over:bare:studio@5 --samples 256 --scale 1.4 --quality farm --sss-thick auto \
#       --uv-fix --orbit 360 --frames 9 --orbit-samples 128
# Every argument but --who / --sides / --work / --out passes to person_job.py unchanged. --orbit 360 --frames 9 turns the camera round the figure in
# 45 degree steps from the back (frame 0) through the person's RIGHT profile (2: the camera on the -x side), the front (4) and the LEFT profile (6)
# to the back again (8).
# <out>/anat8p_person_job.json: each run's exit code and seconds. A run that fails does not stop the next.
import os, sys, json, shlex, subprocess, time, shutil

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
def opt(k, d=None):
    return argv[argv.index('--' + k) + 1] if '--' + k in argv else d
HERE = os.path.dirname(os.path.abspath(__file__)); VIDEOS = os.path.dirname(HERE)
WHO = [w for w in (opt('who') or '').split(',') if w]
SIDES = [s for s in (opt('sides') or 'off,on').split(',') if s]
if not WHO:
    raise SystemExit('anat8p_person_job: --who a,b,c (lineup names: the one current person each)')
# (lane iteration 5) 'off' says pelvis: false: since the orchestrator LANDED the pelvis for the four women (v7lanes/ANAT8_PELVIS.json, 8 Oct 23:33),
# the current person carries it by default, so 'off' must switch it off to stay the person WITHOUT the region
POPTS = {'off': {'pelvis': False}, 'on': {'pelvis': {'module': 'anatomy/pelvis/hook.js', 'fn': 'pelvis7'}},
         'unloaded': {'pelvis': {'module': 'anatomy/pelvis/hook.js', 'fn': 'pelvis7', 'which': 'unloaded'}}}
# (lane iteration 14) the 'next' side (assets/anatomy/pelvis/next/, the A/B before a change landed) is deleted with the review gate (15 Oct 17:15):
# the bakes in assets/anatomy/pelvis/ are the current system's; 'on' renders them
rest = []
i = 0
while i < len(argv):
    if argv[i] in ('--who', '--sides', '--work', '--out', '--popts'):
        i += 2; continue
    rest.append(argv[i]); i += 1
try:
    import bpy
    BLENDER = bpy.app.binary_path
except ImportError:
    BLENDER = opt('blender', 'blender')
WORK = os.path.abspath(opt('work', os.environ.get('GPU_TMP') or os.path.join(VIDEOS, 'out', 'anat8p_job')))
OUT = os.path.abspath(opt('out', os.environ.get('GPU_OUT') or os.path.join(WORK, 'stills')))
os.makedirs(OUT, exist_ok=True)
log = {'who': WHO, 'sides': SIDES, 'args': rest, 'popts': {s: POPTS.get(s) for s in SIDES}, 'runs': []}
code_all = 0
for w in WHO:
    name = w.split(':', 1)[1] if ':' in w else w
    for side in SIDES:
        if side not in POPTS:
            raise SystemExit('anat8p_person_job: --sides takes off, on, unloaded')
        pw = os.path.join(WORK, 'p_' + name + '_' + side); po = os.path.join(OUT, side); os.makedirs(po, exist_ok=True)
        cmd = [BLENDER, '-b', '--factory-startup', '-noaudio', '--python-exit-code', '1', '--python', os.path.join(HERE, 'person_job.py'), '--',
               '--who', name] + (['--popts', json.dumps(POPTS[side], separators=(',', ':'))] if POPTS[side] else []) + rest + ['--work', pw, '--out', po]
        print('anat8p_person_job $', ' '.join(shlex.quote(c) for c in cmd), flush=True)
        t = time.time(); r = subprocess.run(cmd, cwd=VIDEOS)
        log['runs'].append({'who': name, 'side': side, 'code': r.returncode, 's': round(time.time() - t, 1)}); code_all = code_all or r.returncode
        print(f'anat8p_person_job: {name} {side} exited {r.returncode} after {time.time() - t:.0f} s', flush=True)
        pj = os.path.join(po, 'person_job_log.json')
        if os.path.exists(pj):
            shutil.move(pj, os.path.join(po, 'person_job_log_' + name + '.json'))
        # the scene-linear EXRs are large and the boards read the PNGs: keep the delivery small
        for root, _, files in os.walk(po):
            for f in files:
                if f.endswith('.exr'):
                    os.remove(os.path.join(root, f))
        shutil.rmtree(pw, ignore_errors=True)
        json.dump(log, open(os.path.join(OUT, 'anat8p_person_job.json'), 'w'), indent=1)
print('anat8p_person_job done', json.dumps(log['runs']), flush=True)
if code_all:
    raise SystemExit(f'anat8p_person_job: a run failed ({code_all}); the others are in {OUT}')
