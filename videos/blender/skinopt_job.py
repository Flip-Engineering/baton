# SKIN OPTICS (studio, 8 Oct): person7_job.py for the skin studio's A/B, which also KEEPS THE SKIN'S BAKED MAPS. The renders show the skin through the
# light, the subsurface transport and the camera; the baked albedo is the colour the skin model put on each texel before any of that, so a patch,
# a seam or a hue can be told apart as the albedo's or the transport's. Everything is person7_job.py's (several people in one GPU job, each through
# person_job.py in its own work folder, removed after that person), plus: after each person, every skin_albedo*_a*.png and skin_spec_a*.png under its
# work folder is saved beside the stills as maps/<who>__<folder>__<name>.jpg (the albedo at full size, JPEG q 90; the spec map, whose red is the
# oily lobe's weight, the roughness map and the tangent normal map at half size; it2 c2 added the last two: the specular's diagnosis), our own textures only.
# (c3 it1, 15 Oct) the maps are written by skinopt_maps.py in the system python3 (Blender's has no PIL), and skinopt_quad_seams.py checks every export
# for joined quads that straddle a uv seam (quad_seams/: json + atlas pictures).
#   python3 videos/scripts/farm.py gpu --blender videos/blender/skinopt_job.py --time 180 --mem 48 --no-wait --by SKIN7 --title <t> -- \
#       --who L08_f24_hispanic,L22_f27_black --shots face:over:work:studio@5,face:over:work:window@5 --samples 256 --scale 1 --quality farm \
#       --sss-thick auto --uv-fix [--popts '{"skin":{"chem":true}}']
import os, sys, json, shlex, subprocess, time, shutil, glob

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
def opt(k, d=None):
    return argv[argv.index('--' + k) + 1] if '--' + k in argv else d
HERE = os.path.dirname(os.path.abspath(__file__)); VIDEOS = os.path.dirname(HERE)
# --runs '<json>' (c4 it8, 16 Oct: an A/B in ONE job, the farm's one-open-job-a-lane rule): a list of {"who": name, "tag": t, "popts": {...}?, "shots": "s1,s2"?}
# as person7_job.py's: each run one person_job (its own export) with its stills in <out>/<tag>/ and its maps in <out>/<tag>/maps/; --who / --popts then unused.
RUNS = json.loads(opt('runs')) if opt('runs') else None
WHO = [r['who'] for r in RUNS] if RUNS else [w for w in (opt('who') or '').split(',') if w]
if not WHO:
    raise SystemExit('skinopt_job: --who a,b,c')
rest = []
i = 0
while i < len(argv):
    if argv[i] in ('--who', '--work', '--out', '--runs') or (RUNS and argv[i] == '--popts'):
        i += 2; continue
    rest.append(argv[i]); i += 1
if not RUNS:
    RUNS = [{'who': w, 'tag': None} for w in WHO]
try:
    import bpy
    BLENDER = bpy.app.binary_path
except ImportError:
    BLENDER = opt('blender', 'blender')
WORK = os.path.abspath(opt('work', os.environ.get('GPU_TMP') or os.path.join(VIDEOS, 'out', 'cycles_job')))
OUT = os.path.abspath(opt('out', os.environ.get('GPU_OUT') or os.path.join(WORK, 'stills')))
MAPS = os.path.join(OUT, 'maps')
os.makedirs(MAPS, exist_ok=True)
SEAMS = os.path.join(OUT, 'quad_seams')
PY3 = shutil.which('python3') or '/usr/bin/python3'
log = {'who': WHO, 'args': rest, 'runs': [], 'maps': []}
code_all = 0


def keep_maps(pw, who, MAPS=MAPS, SEAMS=SEAMS):
    """(c3 it1, 15 Oct) the maps and the quad-seam check run in the SYSTEM python3 (numpy, scipy, PIL: bake_post.py's), not Blender's, which
    has no PIL (it3's maps all failed 'No module named PIL'); a failure here never fails the job"""
    for cmd, tag in (([PY3, os.path.join(HERE, 'skinopt_maps.py'), pw, MAPS, who], 'maps'),):
        try:
            r = subprocess.run(cmd, cwd=VIDEOS, capture_output=True, text=True, timeout=600)
            print(r.stdout[-4000:], r.stderr[-2000:], flush=True)
            log['maps'].append({'who': who, 'step': tag, 'code': r.returncode, 'tail': (r.stdout + r.stderr)[-600:]})
        except Exception as e:
            log['maps'].append({'who': who, 'step': tag, 'error': repr(e)[:200]})
    # the quad-seam check on every export of this person (bare and work): the joined quads whose two triangles lie in different uv islands
    for ex in sorted(glob.glob(os.path.join(pw, '*', 'uv.bin'))):
        d = os.path.dirname(ex)
        try:
            r = subprocess.run([PY3, os.path.join(HERE, 'skinopt_quad_seams.py'), d, '--out', SEAMS, '--who', who.replace(':', '_') + '__' + os.path.basename(d)],
                               cwd=VIDEOS, capture_output=True, text=True, timeout=600)
            print(r.stdout[-3000:], r.stderr[-2000:], flush=True)
            log['maps'].append({'who': who, 'step': 'quad_seams', 'export': os.path.basename(d), 'code': r.returncode, 'tail': (r.stdout + r.stderr)[-800:]})
        except Exception as e:
            log['maps'].append({'who': who, 'step': 'quad_seams', 'error': repr(e)[:200]})


for R in RUNS:
    w = R['who']; OUT_R = os.path.join(OUT, R['tag']) if R.get('tag') else OUT; os.makedirs(OUT_R, exist_ok=True)
    pw = os.path.join(WORK, 'p7_' + (R.get('tag') or '') + '_' + w.replace(':', '_'))
    rest_r = list(rest)
    if R.get('shots'):
        if '--shots' in rest_r: rest_r[rest_r.index('--shots') + 1] = R['shots']
        else: rest_r += ['--shots', R['shots']]
    cmd = [BLENDER, '-b', '--factory-startup', '-noaudio', '--python-exit-code', '1', '--python', os.path.join(HERE, 'person_job.py'), '--',
           '--who', w] + rest_r + ['--work', pw, '--out', OUT_R] + (['--popts', json.dumps(R['popts'])] if R.get('popts') else [])
    print('skinopt_job $', ' '.join(shlex.quote(c) for c in cmd), flush=True)
    t = time.time(); r = subprocess.run(cmd, cwd=VIDEOS)
    log['runs'].append({'who': w, 'tag': R.get('tag'), 'popts': R.get('popts'), 'shots': R.get('shots'), 'code': r.returncode, 's': round(time.time() - t, 1)}); code_all = code_all or r.returncode
    print(f'skinopt_job: {w} ({R.get("tag")}) exited {r.returncode} after {time.time() - t:.0f} s', flush=True)
    pj = os.path.join(OUT_R, 'person_job_log.json')
    if os.path.exists(pj):
        shutil.move(pj, os.path.join(OUT_R, 'person_job_log_' + w.replace(':', '_') + '.json'))
    if R.get('tag'):
        os.makedirs(os.path.join(OUT_R, 'maps'), exist_ok=True); keep_maps(pw, w, os.path.join(OUT_R, 'maps'), os.path.join(OUT_R, 'quad_seams'))
    else:
        keep_maps(pw, w)
    shutil.rmtree(pw, ignore_errors=True)
    json.dump(log, open(os.path.join(OUT, 'skinopt_job.json'), 'w'), indent=1)
print('skinopt_job done', json.dumps(log['runs']), flush=True)
if code_all:
    raise SystemExit(f'skinopt_job: a person failed ({code_all}); the others are in {OUT}')
