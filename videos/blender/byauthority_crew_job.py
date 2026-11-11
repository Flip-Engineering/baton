# BY AUTHORITY (AUTHORITY ep. 1) c20: THE 2026 CREW, one farm GPU job. The landing's picture is one crew of present-day workers at the start of a
# shift, photographed together the way the Pathe camera found the 1919 seated crowd: a group, faces at several depths, the camera a little above
# them. The person pipeline renders one person per still, so this job runs person_job.py for each worker in turn (export, unwrap, bakes, and one
# bust still on the same stage: the fallback plates), KEEPS each export, and then builds all of them in ONE Cycles scene on the yard stage
# (videos/blender/byauthority_crew.py): one sun, one ground, real shadows and occlusion between them.
#   python3 videos/scripts/farm.py gpu --blender videos/blender/byauthority_crew_job.py --gpus 1 --time 200 --mem 64 --no-wait --by BY_AUTHORITY \
#       --title "BY AUTHORITY c20: the 2026 crew" -- [--who a,b,c] [--samples 384] [--res 2100x1500] [--bust-samples 160]
# Out ($GPU_OUT): crew_yard.png (+ .json), crew_yard_wide.png (a second framing), cyc_<who>_bust_sun_work_yardr5.png per worker, crew_job.json.
import os, sys, json, shlex, subprocess, time, shutil

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
def opt(k, d=None):
    return argv[argv.index('--' + k) + 1] if '--' + k in argv else d
HERE = os.path.dirname(os.path.abspath(__file__)); VIDEOS = os.path.dirname(HERE)
# five workers, women and men, 24 to 59; the four with a MOTION c2 dressed pose (folded arms, clasped hands, a hand in a pocket) and one in the
# plain stance, so nobody stands as anybody else does
WHO = [w for w in (opt('who') or 'L06_f53_white,L21_m32_black,L20_f29_asian,L05_m59_black,L08_f24_hispanic').split(',') if w]
STAGE = opt('stage', 'yard@5')
try:
    import bpy
    BLENDER = bpy.app.binary_path
except ImportError:
    BLENDER = opt('blender', 'blender')
WORK = os.path.abspath(opt('work', os.environ.get('GPU_TMP') or os.path.join(VIDEOS, 'out', 'byauthority_crew')))
OUT = os.path.abspath(opt('out', os.environ.get('GPU_OUT') or os.path.join(WORK, 'out')))
os.makedirs(OUT, exist_ok=True)
log = {'who': WHO, 'stage': STAGE, 'people': [], 'crew': []}
done = []
for w in WHO:
    pw = os.path.join(WORK, 'p_' + w)
    cmd = [BLENDER, '-b', '--factory-startup', '-noaudio', '--python-exit-code', '1', '--python', os.path.join(HERE, 'person_job.py'), '--',
           '--who', w, '--shots', f'bust:sun:work:{STAGE}', '--samples', opt('bust-samples', '160'), '--scale', '1', '--quality', 'farm',
           '--sss-thick', 'auto', '--uv-fix', '--work', pw, '--out', OUT]
    print('crew_job $', ' '.join(shlex.quote(c) for c in cmd), flush=True)
    t = time.time(); r = subprocess.run(cmd, cwd=VIDEOS)
    key = w.replace(':', '_'); ex = {k: os.path.join(pw, f'{key}_{k}') for k in ('bare', 'work')}
    ok = os.path.exists(os.path.join(ex['work'], 'manifest.json'))
    # the dressed person's skin maps: its own, or the bare export's when the two unwraps match (person_job's own rule)
    maps = os.path.join(ex['work'], 'maps')
    try:
        if os.path.getsize(os.path.join(ex['work'], 'uv.bin')) == os.path.getsize(os.path.join(ex['bare'], 'uv.bin')):
            maps = os.path.join(ex['bare'], 'maps')
    except OSError:
        pass
    log['people'].append({'who': w, 'code': r.returncode, 's': round(time.time() - t, 1), 'export': ex['work'] if ok else None, 'maps': maps})
    pj = os.path.join(OUT, 'person_job_log.json')
    if os.path.exists(pj):
        shutil.move(pj, os.path.join(OUT, 'person_job_log_' + key + '.json'))
    if ok:
        done.append({'who': w, 'export': ex['work'], 'maps': maps})
    print(f'crew_job: {w} exited {r.returncode} after {time.time() - t:.0f} s (export {"kept" if ok else "MISSING"})', flush=True)
    json.dump(log, open(os.path.join(OUT, 'crew_job.json'), 'w'), indent=1)

# the crew together: one scene, two framings (the plate, and a wider one with the yard's wall)
spec = os.path.join(WORK, 'crew_spec.json'); json.dump({'people': done, 'stage': STAGE}, open(spec, 'w'), indent=1)
boot = os.path.join(HERE, 'gpujob', 'boot.py')
pre = ['--python', boot] if os.environ.get('GPU_JOB_DEVICE') and os.path.exists(boot) else []
eye7 = ['--python', os.path.join(HERE, 'eye7_cycles.py')] if os.path.exists(os.path.join(HERE, 'eye7_cycles.py')) else []
for frame, extra in (('yard', []), ('yard_wide', ['--frame', 'wide'])):
    if len(done) < 2:
        break
    cmd = [BLENDER, '-b', '--factory-startup', '-noaudio', '--python-exit-code', '1'] + pre + eye7 + ['--python', os.path.join(HERE, 'byauthority_crew.py'), '--',
           '--spec', spec, '--out', OUT, '--tag', 'crew_' + frame, '--samples', opt('samples', '384'), '--res', opt('res', '2100x1500')] + extra
    print('crew_job $', ' '.join(shlex.quote(c) for c in cmd), flush=True)
    t = time.time(); r = subprocess.run(cmd, cwd=VIDEOS)
    log['crew'].append({'frame': frame, 'code': r.returncode, 's': round(time.time() - t, 1)})
    json.dump(log, open(os.path.join(OUT, 'crew_job.json'), 'w'), indent=1)
# (15 Oct) clear what this job put in WORK, never WORK itself: when WORK is the harness's $GPU_TMP, gpu_job.py lists it after the run and
# removes it, and deleting it here failed 1015-083617 after every picture had rendered (FileNotFoundError on .../tmp).
for d in [os.path.join(WORK, 'p_' + w) for w in WHO] + [spec]:
    shutil.rmtree(d, ignore_errors=True) if os.path.isdir(d) else (os.path.exists(d) and os.remove(d))
print('crew_job done', json.dumps(log), flush=True)
if not any(c['code'] == 0 for c in log['crew']) and not any(p['code'] == 0 for p in log['people']):
    raise SystemExit('crew_job: nothing rendered')
