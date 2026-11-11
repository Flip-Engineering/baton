# FABRIC7 on the farm's GPUs: person_job.py (the whole chain: export -> unwrap -> bakes -> bake_post -> Cycles stills) for a `latest:` person, plus what FABRIC7 adds around it. person_job.py chooses
# labs/clothing2/fabric7_texbake.mjs for the garment atlas itself (fabric rev 7 + SHOES7: tone, grain, the strain-driven wrinkle cascade, the shoes' construction drawn in); its fabric6.json carries rev 7's
# sheen, so blender/person_scene.py builds the garments' Principled sheen from it unchanged. This file swaps in / adds, in the person_job.py text it then runs:
#   * the EXPORT through labs/clothing2/fabric7_export.mjs (export_person.mjs after useShoes7({ geometryOnly: 1 }): the last's own coordinate and caps are in Blender's mesh, the 'cloth' uv layer and
#     the bake page's mesh alike; no material is touched);
#   * --atlas-px N: the garments' atlas size (default 4096; the garment atlas was 20 % covered at 0.72-0.88 mm a texel); only the garment bake (fabric7_texbake.mjs --size N);
#   * --f7opts <json | k=v,k=v> -> F7_OPTS, the bake page's f7opts = useFabric7's options (samples, atlas, age, cascade: e.g. --f7opts cascade=0 is the A/B control of the wrinkle cascade);
#   * --f6opts <json | k=v,k=v> -> F6_OPTS, the bake page's f6opts = useFabric6's options (e.g. wrinkles=0: rev 6's strain wrinkles off);
#   * after the last render blender/fabric7_atlas_report.py measures the garment atlas in millimetres (texel size, tone bands, spectrum peaks of the knit) and leaves atlas7/ in the job's out/ folder
#     (--no-atlas-report skips it); atlas7/fabric6.json is the record the bake WROTE (its atlas7 block holds the options the page really ran with, and bakeGL, the WebGL renderer of the bake).
#   python3 videos/scripts/farm.py gpu --blender videos/blender/fabric7_job.py --time 120 --mem 48 --no-wait --by FABRIC7 -- --who latest:L08_f24_hispanic \
#       --shots bust:over:work:studio@5,full:over:work:studio@5 --samples 256 --scale 1 --quality farm --sss-thick auto --uv-fix [--f7opts cascade=0] [--atlas-px 8192]
# Options of person_job.py pass through. Needs --who latest:<name> (or v7:<name>).
import os, sys, json
_a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]


def _kv(v):
    v = v.strip()
    if v.startswith('{'):
        return v
    return json.dumps({k: (float(x) if x.replace('.', '', 1).replace('-', '', 1).isdigit() else x) for k, x in (kv.split('=') for kv in v.split(',') if kv)})


for _flag, _env in (('--f7opts', 'F7_OPTS'), ('--f6opts', 'F6_OPTS')):
    if _flag in _a:
        os.environ[_env] = _kv(_a[_a.index(_flag) + 1])
        print('fabric7_job:', _env, '=', os.environ[_env], flush=True)
HERE = os.path.dirname(os.path.abspath(__file__))
PJ = os.path.join(HERE, 'person_job.py')
src = open(PJ).read()
EXP_OLD = "'web/labs/human8/export_person.mjs', WHO"
if EXP_OLD in src:
    src = src.replace(EXP_OLD, "'web/labs/clothing2/fabric7_export.mjs', WHO"); print('fabric7_job: export = fabric7_export.mjs (export_person.mjs + the last\'s geometry)', flush=True)
else:
    print('fabric7_job: person_job.py no longer names export_person.mjs in the form this wrapper replaces: the export is unchanged (the bake page still applies the last fix)', flush=True)
if '--atlas-px' in _a:
    _px = int(_a[_a.index('--atlas-px') + 1]); _O2 = "'--mode', 'garments', '--atlases', '0',"
    if _O2 in src:
        src = src.replace(_O2, "'--size', '%d', " % _px + _O2); print('fabric7_job: garment atlas', _px, 'px', flush=True)
    else:
        print('fabric7_job: --atlas-px: person_job.py no longer names the garment bake in the form this wrapper replaces; atlas size unchanged', flush=True)
g = {'__file__': PJ, '__name__': '__main__', '__builtins__': __builtins__}
try:
    exec(compile(src, PJ, 'exec'), g)
finally:   # the atlas in millimetres (a failure here never fails the job)
    if '--no-atlas-report' not in _a and '--dry' not in _a:
        try:
            import subprocess
            _ex = g.get('ex') or {}; _out = g.get('OUT')
            if _ex.get('work') and _out:
                _o = os.path.join(_out, 'atlas7'); os.makedirs(_o, exist_ok=True)
                import shutil as _sh
                _py = _sh.which('python3') or _sh.which('python') or sys.executable   # the SYSTEM python3 (numpy, scipy, PIL), the one person_job.py runs bake_post.py with; sys.executable is Blender's own, which has no PIL
                print('fabric7_job: atlas report with', _py, flush=True)
                _r = subprocess.run([_py, os.path.join(HERE, 'fabric7_atlas_report.py'), _ex['work'], _o], timeout=900)
                print('fabric7_job: atlas report exit', _r.returncode, '->', _o, flush=True)
                for _f in ('fabric6.json',):
                    if os.path.exists(os.path.join(_ex['work'], _f)):
                        import shutil; shutil.copyfile(os.path.join(_ex['work'], _f), os.path.join(_o, _f))
        except Exception as _e:
            print('fabric7_job: atlas report not made:', repr(_e), flush=True)
