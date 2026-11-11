# ALL POWER c20: present-day line workers from the person pipeline, lit at night, as cut-out plates for scenes/allpower_a.js.
# One farm GPU job: for each person, person_job.py's chain (export, unwrap, bakes; one small reference still) into a kept work
# folder, then allpower_night.py once per look.
#   python3 videos/scripts/farm.py gpu --blender videos/blender/allpower_people_job.py --gpus 1 --time 180 --mem 48 --by ALL_POWER-c20 -- \
#       --people v7:L21_m32_black=town+strobe,v7:L08_f24_hispanic=strobe+face,v7:L05_m59_black=strobe,v7:L06_f53_white=strobe --samples 256
# Stills land in GPU_OUT as ap_<name>_<look>.png (RGBA) + .json; person_job's reference stills under ref/.
import os, sys, subprocess, shlex, json, time, shutil

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
def opt(k, d=None):
    return argv[argv.index('--' + k) + 1] if '--' + k in argv else d
HERE = os.path.dirname(os.path.abspath(__file__)); VIDEOS = os.path.dirname(HERE)
try:
    import bpy
    BLENDER = bpy.app.binary_path
except ImportError:
    BLENDER = opt('blender', 'blender')
OUT = os.path.abspath(opt('out', os.environ.get('GPU_OUT') or os.path.join(VIDEOS, 'out', 'allpower_people')))
# person_job's bakes are served from under videos/: keep the work folder there (GPU_TMP is under videos/out/gpu/<id>/ on the farm)
WORK = os.path.abspath(opt('work', os.environ.get('GPU_TMP') or os.path.join(VIDEOS, 'out', 'allpower_people_work')))
os.makedirs(OUT, exist_ok=True); os.makedirs(WORK, exist_ok=True)
SPP = opt('samples', '256')
# --gear '{"v7:L21_m32_black": {"wear": {...}}}': makePerson options for one person (e.g. a hard hat and a hi-vis vest; person/index.js wearFor)
GEAR = json.loads(opt('gear', '{}'))
LIGHT = opt('light', '1')
boot = os.path.join(HERE, 'gpujob', 'boot.py')
pre = ['--python', boot] if os.environ.get('GPU_JOB_DEVICE') and os.path.exists(boot) else []
log = []
for item in (opt('people') or '').split(','):
    if not item:
        continue
    who, looks = item.split('=')
    key = who.replace(':', '_'); pw = os.path.join(WORK, 'p_' + key)
    t = time.time()
    cmd = [BLENDER, '-b', '--factory-startup', '-noaudio', '--python-exit-code', '1', '--python', os.path.join(HERE, 'person_job.py'), '--',
           '--who', who, '--shots', 'bust:sun:work', '--samples', '32', '--scale', '0.5', '--work', pw, '--out', os.path.join(OUT, 'ref'), '--uv-fix'] + \
          (['--popts', json.dumps(GEAR[who])] if who in GEAR else [])
    print('allpower_people $', ' '.join(shlex.quote(c) for c in cmd), flush=True)
    r = subprocess.run(cmd, cwd=VIDEOS)
    rec = dict(who=who, chain=r.returncode, chain_s=round(time.time() - t, 1), looks=[])
    exp = os.path.join(pw, f'{key}_work')
    maps = os.path.join(exp, 'maps')
    if not any(f.startswith('skin_') for f in (os.listdir(maps) if os.path.isdir(maps) else [])):
        maps = os.path.join(pw, f'{key}_bare', 'maps')
    if os.path.isdir(exp):
        for look in looks.split('+'):
            tag = f'ap_{key.split("_", 1)[1]}_{look}' + ('' if LIGHT == '1' else f'_r{LIGHT}')
            c2 = [BLENDER, '-b', '--factory-startup', '-noaudio', '--python-exit-code', '1'] + pre + ['--python', os.path.join(HERE, 'allpower_night.py'), '--',
                  '--export', exp, '--maps', maps, '--look', look, '--samples', SPP, '--out', OUT, '--tag', tag, '--light', LIGHT]
            print('allpower_people $', ' '.join(shlex.quote(c) for c in c2), flush=True)
            t2 = time.time(); r2 = subprocess.run(c2, cwd=VIDEOS)
            rec['looks'].append(dict(look=look, tag=tag, code=r2.returncode, s=round(time.time() - t2, 1)))
    log.append(rec)
    shutil.rmtree(pw, ignore_errors=True)   # one person's export on the worker's disk at a time
    json.dump(log, open(os.path.join(OUT, 'allpower_people.json'), 'w'), indent=1)
bad = [r for r in log if r['chain'] or any(l['code'] for l in r['looks'])]
print('allpower_people:', json.dumps(log))
if not log or all(r['chain'] for r in log):
    raise SystemExit('allpower_people: no person made it through the chain')
