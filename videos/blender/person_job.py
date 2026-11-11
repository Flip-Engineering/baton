# CYCLES on the farm: one person from the record to Cycles stills, the whole chain in one job (FARMGPU's job type runs it:
#   sh videos/scripts/gpu_job.sh blender videos/blender/person_job.py --id cyc_L14 --gpus 1 --time 60 -- \
#       --who lineup:L14_f42_black --shots face:over:bare,face:sun:bare,bust:sun:work --samples 256 --scale 1 [--orbit 30 --frames 48]
# Steps (each the same script the studio runs by hand; videos/blender/README.md): node export_person.mjs (bare, and work when a shot
# is dressed) -> unwrap.py (a child Blender) -> bake_skin.mjs (headless Chromium: on the farm it draws on the GPU since 8 Oct, bake_gl.mjs) -> bake_post.py
# (python3 with numpy, scipy, PIL) -> render_person.py (a child Blender per shot; GPU through gpujob's devices when GPU_JOB_DEVICE is
# set). Scratch in $GPU_TMP (or --work; it must lie under videos/, which bake_skin.mjs serves), stills to $GPU_OUT (or --out).
# --dry prints the commands only.
# LIGHT5 (round 5, opt-in): a shot may name its stage as a 4th field (face:over:work:studio@5) or --stage sets it for every shot;
# --quality farm (>= 256 spp, OIDN on the GPU) and --sss-thick auto (the thin-lid subsurface fix) pass to render_person.py; --popts
# '<json>' passes makePerson options to the export and the bake (v4 people: --who v4:L21_m32_black). The full-size farm run of the
# round-5 stills (ready; the GPU job type is not deployed, research/capabilities/farm_gpu.md):
#   sh videos/scripts/gpu_job.sh blender videos/blender/person_job.py --id cyc5_L21 --gpus 1 --time 90 -- --who v4:L21_m32_black \
#       --shots face:over:work:studio@5,face:over:work:window@5,face:over:work:yard@5,bust:over:work:studio@5,full:over:work:yard@5 \
#       --samples 256 --scale 1 --quality farm   (--sss-thick auto and --uv-fix are the defaults since 15 Oct: --sss-thick off / --no-uv-fix the arms)
# CAMERA7 (round 7, opt-in): --camera7 auto (the stage's own preset: lens, display, the skin-zone exposure rule, output sharpening) with a '@7' stage, e.g.
#   --shots face:over:work:studio@7 --camera7 auto     (blender/camera7_display.py, camera7_stage.py)
# THE PERSON (8 Oct): --who <name> is the studio's ONE current person (lib/fx/person makePerson: every lane's current result on: BODY7 on the
# figure study, face rev 8, DETAIL7's fine tier with Cycles displacement, skin rev 7, hair rev 7, the garments' bake with CLOTH8's cover8, FABRIC7's
# garment atlas); its export's manifest popts carry the person's Cycles-side options (fine7, cover8), so nothing depends on per-render flags. An
# old 'v7:' / 'latest:' prefix is accepted (stripped). Budget --mem 48 (DETAIL7's displacement: 24.4 GB on a bare body in a window shot
# with adaptive dicing; since 8 Oct 22:20 the skin is pre-diced at level 2-3, about 0.9-3.4 M quads, far less).
# Several people in one job: videos/blender/person7_job.py.
# The worker needs node 22 + playwright's Chromium (it has both: they render the studio's scenes) and python3 with numpy/scipy/PIL.
import os, sys, subprocess, shlex, time, json

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
def opt(k, d=None):
    return argv[argv.index('--' + k) + 1] if '--' + k in argv else d
HERE = os.path.dirname(os.path.abspath(__file__)); VIDEOS = os.path.dirname(HERE)
WHO = opt('who', 'L14_f42_black'); SEED = opt('seed', '1')   # the studio's one current person (an old 'v7:' / 'latest:' prefix is stripped by makePerson)
SHOTS = [(s.split(':') + [None])[:4] for s in opt('shots', 'face:over:bare').split(',')]
# (15 Oct, integrator c5: the orchestrator's audit item 10) --sss-thick auto (the thin-lid subsurface fix) and --uv-fix (unwrap.py --fix-overlap) are
# THE DEFAULTS: every lane passed them; --sss-thick off and --no-uv-fix are the diagnosis arms
STAGE, QUAL, POPTS = opt('stage'), opt('quality'), opt('popts')
THICK = None if opt('sss-thick', 'auto') == 'off' else opt('sss-thick', 'auto')
WORK = os.path.abspath(opt('work', os.environ.get('GPU_TMP') or os.path.join(VIDEOS, 'out', 'cycles_job')))
OUT = os.path.abspath(opt('out', os.environ.get('GPU_OUT') or os.path.join(WORK, 'stills')))
DRY = '--dry' in argv
try:
    import bpy
    BLENDER = bpy.app.binary_path
except ImportError:
    BLENDER = opt('blender', 'blender')
NODE = opt('node', 'node')
log = []; failed = []
def run(cmd, cwd=VIDEOS, fatal=True, tag=None, env=None):
    print('person_job $', ' '.join(shlex.quote(c) for c in cmd), ('(env ' + json.dumps(env) + ')') if env else '', flush=True)
    if DRY:
        return
    t = time.time(); r = subprocess.run(cmd, cwd=cwd, env=({**os.environ, **env} if env else None))
    log.append(dict(cmd=cmd[:4], tag=tag, s=round(time.time() - t, 1), code=r.returncode))
    if r.returncode:
        if fatal:
            raise SystemExit(f'person_job: step failed ({r.returncode}): {cmd[:4]}')
        failed.append(tag or ' '.join(cmd[:4])); print(f'person_job: render failed ({r.returncode}): {tag}', flush=True)

key = WHO.replace(':', '_')
_po = json.loads(POPTS) if POPTS else {}
# the garments' atlas: FABRIC7's texbake (the current fabric + SHOES7, its own atlas setting: samples 1, atlas 1) for every dressed person;
# --popts '{"fabric": false}' (or "fabric7": false) bakes the plain garments with bake_skin.mjs. (8 Oct 20:14, FABRIC7's hand-off: the FABRIC6
# texbake branch named a deleted page and the F7_OPTS default named options useFabric7 no longer reads: both gone; F7_OPTS set by a caller
# still reaches the page, e.g. F7_OPTS='{"cascade":0}' for an A/B.)
FAB7 = _po.get('fabric', {}) is not False and _po.get('fabric7', {}) is not False
ex = {w: os.path.join(WORK, f'{key}_{w}') for w in ('bare', 'work', 'nude')}
# (integrator c6, 16 Oct) wear 'nude': the figure study without the upper foundation (no cup, no painted band; the briefs kept): ANAT8-BODY's register for
# bust shots (build.js WEAR.nude); its own export, unwrap and skin atlas (the skin the bra covered is in its triangle list)
wears = ['bare'] + (['work'] if any(s[2] not in ('bare', 'nude') for s in SHOTS) else []) + (['nude'] if any(s[2] == 'nude' for s in SHOTS) else [])
rel = lambda p: os.path.relpath(p, VIDEOS)   # bake_skin.mjs serves paths under videos/: keep WORK under it

# Dependencies (4 Oct: the farm's GPU container has node but not videos/web/node_modules, so the first export failed with
# ERR_MODULE_NOT_FOUND): npm ci from the committed lock, and playwright's Chromium for bake_skin.mjs, both cached under
# GPU_JOB_HOME (the worker's per-environment cache) when it is set, so later jobs reuse them. A machine that has them skips both.
def ensure_deps():
    web = os.path.join(VIDEOS, 'web'); home = os.environ.get('GPU_JOB_HOME')
    env = dict(os.environ)
    if home:
        env.setdefault('npm_config_cache', os.path.join(home, 'npm-cache'))
        env.setdefault('PLAYWRIGHT_BROWSERS_PATH', os.path.join(home, 'pw-browsers'))
    # the install must be WHOLE, not just present: a worker that restarted mid-install (its 'durable stage' resume, 8 Oct) left
    # node_modules/three without its package.json, the old directory test skipped npm ci and node failed on 'three' (1008-031604)
    three = os.path.join(web, 'node_modules', 'three')
    if not all(os.path.exists(os.path.join(three, f)) for f in ('package.json', os.path.join('build', 'three.module.js'))):
        run_env(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], web, env)
    # the bake scripts import playwright from /opt/node22/...: where that is missing, install the same version locally and map
    # the absolute imports onto it with a node --import hook (videos/blender/pw_resolve.mjs)
    pw_abs = '/opt/node22/lib/node_modules/playwright'
    pw_dir = pw_abs
    if not os.path.exists(os.path.join(pw_abs, 'index.mjs')):
        pw_dir = os.path.join(web, 'node_modules', 'playwright')
        if not os.path.exists(os.path.join(pw_dir, 'index.mjs')):
            run_env(['npm', 'install', '--no-save', '--ignore-scripts', '--no-audit', '--no-fund', 'playwright@1.56.1'], web, env)
        env['ACP_PW_DIR'] = pw_dir
        hook = 'file://' + os.path.join(HERE, 'pw_resolve.mjs')
        env['NODE_OPTIONS'] = (env.get('NODE_OPTIONS', '') + ' --import ' + hook).strip()
    probe = subprocess.run([NODE, '-e', "const p=require(process.argv[1]);const fs=require('fs');process.exit(fs.existsSync(p.chromium.executablePath())?0:3)",
                            pw_dir], cwd=web, env={k: v for k, v in env.items() if k != 'NODE_OPTIONS'}, capture_output=True)
    if probe.returncode:
        run_env([NODE, os.path.join(pw_dir, 'cli.js'), 'install', 'chromium'], web, env)
    os.environ.update({k: env[k] for k in ('npm_config_cache', 'PLAYWRIGHT_BROWSERS_PATH', 'ACP_PW_DIR', 'NODE_OPTIONS') if k in env})
def run_env(cmd, cwd, env):
    print('person_job $', ' '.join(shlex.quote(c) for c in cmd), flush=True)
    if DRY:
        return
    t = time.time(); r = subprocess.run(cmd, cwd=cwd, env=env)
    log.append(dict(cmd=cmd[:4], s=round(time.time() - t, 1), code=r.returncode))
    if r.returncode:
        raise SystemExit(f'person_job: step failed ({r.returncode}): {cmd[:4]}')
if not DRY and '--no-deps' not in argv:
    ensure_deps()

# (orchestrator, 8 Oct) the unwrap is cached by exactly what it reads: unwrap.py's source and arguments, the body's bind, index and
# region, each garment's name, bind and index. Most round-7 lanes change shading, not geometry, so the same person comes back job after
# job and the 45-65 s Blender unwrap (a CPU step inside a GPU job) becomes a copy. The cache lives under GPU_JOB_HOME (the worker's
# per-environment cache; --unwrap-cache DIR overrides, --unwrap-cache off disables); the newest 300 entries are kept.
UNWRAP_OUT = ('uv.bin', 'atlas.bin', 'garment_uv.bin', 'garment_uv.json')
def unwrap_key(d, uargs):
    import hashlib
    sys.path.insert(0, HERE)
    from person_io import Person
    pp = Person(d); h = hashlib.sha256()
    with open(os.path.join(HERE, 'unwrap.py'), 'rb') as f:
        h.update(f.read())
    h.update(json.dumps(uargs).encode()); B = pp.body
    for k in ('bind', 'index'):
        h.update(pp.arr(B[k]).tobytes())
    h.update(pp.arr(B['aHero'], 4)[:, 0].tobytes())
    for r in pp.m['meshes'][1:]:
        if r.get('kind') == 'garment':
            h.update(r['name'].encode()); h.update(pp.arr(r['bind']).tobytes()); h.update(pp.arr(r['index']).tobytes())
    return h.hexdigest()[:40]
def unwrap(d):
    import shutil
    uargs = [] if '--no-uv-fix' in argv else ['--fix-overlap']
    home = os.environ.get('GPU_JOB_HOME') or os.environ.get('XDG_CACHE_HOME')   # gpu_job.py points XDG_CACHE_HOME into the worker's cache
    cdir = opt('unwrap-cache', os.path.join(home, 'unwrap-cache') if home else '')
    key = c = None
    if cdir and cdir != 'off' and not DRY:
        try:
            t = time.time(); key = unwrap_key(d, uargs); c = os.path.join(cdir, key)
            if os.path.exists(os.path.join(c, 'uv.bin')):
                for f in UNWRAP_OUT:
                    if os.path.exists(os.path.join(c, f)):
                        shutil.copyfile(os.path.join(c, f), os.path.join(d, f))
                os.utime(c); print(f'person_job: unwrap from the cache ({key[:12]}, {time.time() - t:.1f} s)', flush=True)
                log.append(dict(cmd=['unwrap-cache', key[:12]], s=round(time.time() - t, 1), code=0)); return
        except Exception as e:   # a cache problem never fails the job: unwrap as before
            print(f'person_job: unwrap cache unusable ({e}); unwrapping', flush=True); key = c = None
    run([BLENDER, '-b', '--factory-startup', '-noaudio', '--python-exit-code', '1', '-P', os.path.join(HERE, 'unwrap.py'), '--', d] + uargs)
    if c and not DRY:
        try:
            tmp = c + '.tmp%d' % os.getpid(); os.makedirs(tmp, exist_ok=True)
            for f in UNWRAP_OUT:
                if os.path.exists(os.path.join(d, f)):
                    shutil.copyfile(os.path.join(d, f), os.path.join(tmp, f))
            try:
                os.rename(tmp, c)
            except OSError:   # another job stored the same key first
                shutil.rmtree(tmp, ignore_errors=True)
            old = sorted((os.path.join(cdir, x) for x in os.listdir(cdir) if '.tmp' not in x), key=os.path.getmtime)
            for x in old[:-300]:
                shutil.rmtree(x, ignore_errors=True)
        except Exception as e:
            print(f'person_job: unwrap cache not written ({e})', flush=True)
EYE7 = {}
for w in wears:
    run([NODE, 'web/labs/human8/export_person.mjs', WHO, '--wear', w, '--seed', SEED, '--subdiv', opt('subdiv', '1'), '--out', ex[w]] + (['--popts', POPTS] if POPTS else []))
    unwrap(ex[w])
    # EYES' slot (8 Oct 22:33): a person whose eyes carry eye7 (v7lanes/EYES.json { eyes: { eye7: {} } }, or --popts) has spec.popts.eye7 in
    # its manifest: the eye7 record and maps go into the export (web/labs/eyes/eye7_maps.mjs) and every shot of that wear installs
    # blender/eye7_cycles.py before render_person.py (person_scene.build_eyes -> build_eyes7), as EYES' eye7_job.py does. Absent: unchanged.
    try:
        with open(os.path.join(ex[w], 'manifest.json')) as f:
            EYE7[w] = bool(((json.load(f).get('spec') or {}).get('popts') or {}).get('eye7'))
    except (OSError, ValueError):
        EYE7[w] = False
    if EYE7[w]:
        run([NODE, 'web/labs/eyes/eye7_maps.mjs', ex[w]])
# the bakes: on the farm the bakers' Chromium draws on the GPU (web/labs/human8/bake_gl.mjs; until 8 Oct they forced SwiftShader, the CPU);
# if a bake or bake_post.py then fails (no GPU context, an empty or broken atlas), everything is baked again on SwiftShader (BAKE_GL=swiftshader)
MAPS = {'bare': os.path.join(ex['bare'], 'maps'), 'work': os.path.join(ex['work'], 'maps'), 'nude': os.path.join(ex['nude'], 'maps')}
def bakes():
    run([NODE, 'web/labs/human8/bake_skin.mjs', rel(ex['bare'])])
    if 'nude' in wears:
        run([NODE, 'web/labs/human8/bake_skin.mjs', rel(ex['nude'])])
    if 'work' in wears:
        # 4 Oct: since K4/v5 the dressed export's body is not the bare one's (different corner counts), so the dressed person bakes
        # its own skin on its own unwrap (as integration v5's cycles_v5.sh does); the bare export's atlas is reused only when they match
        same = False
        try:
            same = os.path.getsize(os.path.join(ex['work'], 'uv.bin')) == os.path.getsize(os.path.join(ex['bare'], 'uv.bin'))
        except OSError:
            pass
        if same:
            MAPS['work'] = MAPS['bare']
            run([NODE, 'web/labs/human8/bake_skin.mjs', rel(ex['work']), '--uv', rel(ex['bare']), '--maps', rel(os.path.join(ex['bare'], 'maps')), '--prefix', 'raw_dressed', '--passes', '0'])
        else:
            run([NODE, 'web/labs/human8/bake_skin.mjs', rel(ex['work'])])
        # the garment atlas (FABRIC7's texbake writes fabric6.json too, from which person_scene.py builds the garment materials)
        run([NODE, 'web/labs/clothing2/fabric7_texbake.mjs' if FAB7 else 'web/labs/human8/bake_skin.mjs', rel(ex['work']), '--mode', 'garments', '--atlases', '0', '--passes', '0,1,2', '--prefix', 'cloth'])
def posts():
    for w in wears:
        run(['python3', os.path.join(HERE, 'bake_post.py'), ex[w]])
try:
    bakes(); posts()
except SystemExit as e:
    if DRY or os.environ.get('BAKE_GL', 'auto').lower() == 'swiftshader':
        raise
    print(f'person_job: the GPU bake failed ({e}); baking again on SwiftShader', flush=True)
    os.environ['BAKE_GL'] = 'swiftshader'; bakes(); posts()
boot = os.path.join(HERE, 'gpujob', 'boot.py')
e7of = lambda wear: ['--python', os.path.join(HERE, 'eye7_cycles.py')] if EYE7.get(wear) else []   # EYES' engine eye in Cycles (above)
for shot, light, wear, stg in SHOTS:
    pre = ['--python', boot] if os.environ.get('GPU_JOB_DEVICE') and os.path.exists(boot) else []
    stg = stg or STAGE
    l5 = (['--stage', stg] if stg else []) + (['--quality', QUAL] if QUAL else []) + (['--sss-thick', THICK] if THICK else [])
    # CAMERA7 (round 7, opt-in): --camera7 <auto|json> [--c7-bias auto|<stops>] [--c7-display <json>] [--c7-sharpen auto|0] reach render_person.py (a '@7' stage names its own camera7)
    l5 += sum(([f'--{k}', opt(k)] for k in ('camera7', 'c7-bias', 'c7-display', 'c7-sharpen', 'c7-bounce') if opt(k)), [])
    tag = f'cyc_{key}_{shot}_{light}_{wear}' + (f'_{stg.replace("@", "r")}' if stg else '')
    run([BLENDER, '-b', '--factory-startup', '-noaudio', '--python-exit-code', '1'] + pre + e7of(wear) + ['--python', os.path.join(HERE, 'render_person.py'), '--', '--export', ex[wear], '--maps', MAPS[wear],
         '--shot', shot, '--light', light, '--samples', opt('samples', '128'), '--scale', opt('scale', '1'), '--out', OUT,
         '--tag', tag] + l5, fatal=False, tag=tag)
# THE VANISHING-SKIN DIAGNOSTIC (integration, 8 Oct 20:20; off unless --aa is given): the FIRST shot rendered once per listed variant, each a
# separate render process with its own tag (<tag>_aa<i>_<variant>), to tell where the whole skin object drops out of some full-size
# Cycles renders (review/studio_human_c8/after/integration7/NOTES.md): same (as the shot: the same inputs again), noguard (render_person
# --no-guard), threads1 (render_person --threads 1: the scene sync on one CPU thread), zero (FINE7_CYC {"zero": 1}: the fine tier's whole
# machinery, adaptive dicing included, with no relief), off (FINE7_CYC {"off": 1}: no fine-tier subdivision at all). Look at each still.
# (21:30) each variant runs with --vanish record: the still is verified from its object-index pass and logged ('person_guard vanish:'), never
# rendered again, so the diagnostic sees the raw losses; 'predice' renders the skin pre-diced by Blender (the verify ladder's fallback) from the start.
# (22:20, c2 iteration 2) the skin is PRE-DICED BY DEFAULT now (person_scene fine7; level per camera: person_guard.dice_for_camera), so 'same'
# is the pre-diced person; 'adaptive' (FINE7_CYC {"adaptive": 1}) is the old path, and 'zero' / 'threads1' ride on it, to keep testing it.
AA = {'same': ([], None), 'noguard': (['--no-guard'], None), 'threads1': (['--threads', '1'], {'FINE7_CYC': '{"adaptive": 1}'}),
      'zero': ([], {'FINE7_CYC': '{"zero": 1, "adaptive": 1}'}), 'off': ([], {'FINE7_CYC': '{"off": 1}'}),
      'predice': ([], {'FINE7_CYC': '{"predice": 1}'}), 'adaptive': ([], {'FINE7_CYC': '{"adaptive": 1}'}),
      # (integration c4, 15 Oct: the face regression's bisect, render-side switches on ONE export) the relief at gain 0 on the default pre-diced
      # surface; DETAIL7's lobe work (iterations 9-11: the sub-texel variance and the mixture's hidden share) off. ('seam0' deleted 15 Oct c5:
      # person_scene no longer reads 'seam', so it rendered the same as 'same'.)
      'zerop': ([], {'FINE7_CYC': '{"zero": 1}'}), 'lobe0': ([], {'FINE7_CYC': '{"lobe": 0}'})}
if opt('aa'):
    shot, light, wear, stg = SHOTS[0]; stg = stg or STAGE
    pre = ['--python', boot] if os.environ.get('GPU_JOB_DEVICE') and os.path.exists(boot) else []
    l5 = (['--stage', stg] if stg else []) + (['--quality', QUAL] if QUAL else []) + (['--sss-thick', THICK] if THICK else [])
    base = f'cyc_{key}_{shot}_{light}_{wear}' + (f'_{stg.replace("@", "r")}' if stg else '')
    for i, v in enumerate(opt('aa').split(',')):
        if v not in AA:
            print(f'person_job: --aa variant {v!r} unknown ({", ".join(AA)})', flush=True); continue
        extra, env = AA[v]; tag = f'{base}_aa{i}_{v}'
        run([BLENDER, '-b', '--factory-startup', '-noaudio', '--python-exit-code', '1'] + pre + e7of(wear) + ['--python', os.path.join(HERE, 'render_person.py'), '--', '--export', ex[wear], '--maps', MAPS[wear],
             '--shot', shot, '--light', light, '--samples', opt('samples', '128'), '--scale', opt('scale', '1'), '--out', OUT, '--tag', tag, '--vanish', 'record'] + l5 + extra, fatal=False, tag=tag, env=env)
if opt('orbit'):   # a slow camera move round the head on the first shot (frames <tag>_orbit_NNN.png, one exposure)
    shot, light, wear, stg = SHOTS[0]
    run([BLENDER, '-b', '--factory-startup', '-noaudio', '--python-exit-code', '1'] + pre + e7of(wear) + ['--python', os.path.join(HERE, 'render_person.py'), '--', '--export', ex[wear], '--maps', MAPS[wear],
         '--shot', shot, '--light', light, '--samples', opt('orbit-samples', '64'), '--scale', opt('scale', '1'), '--out', os.path.join(OUT, 'orbit'),
         '--tag', f'cyc_{key}_orbit', '--orbit', opt('orbit'), '--frames', opt('frames', '24')], fatal=False, tag=f'cyc_{key}_orbit')
if not DRY:
    os.makedirs(OUT, exist_ok=True); json.dump(log, open(os.path.join(OUT, 'person_job_log.json'), 'w'), indent=1)
if failed:
    raise SystemExit(f'person_job: {len(failed)} render(s) failed: {", ".join(failed)} (the others are in {OUT})')
print('person_job done', flush=True)
