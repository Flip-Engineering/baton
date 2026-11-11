# DETAIL7 (round 7, iteration 3): ONE farm GPU job = the fine tier's Cycles A/B for one person at ONE commit, with its own check.
#   python3 videos/scripts/farm.py gpu --blender videos/blender/fine7_job.py --time 120 --mem 24 --no-wait --by DETAIL7 --title <t> -- \
#       --who v6:L08_f24_hispanic --shots face:over:work:studio@5,face:over:bare:window@5 --samples 256 --scale 1.3333 \
#       --quality farm --sss-thick auto --uv-fix --popts '{"fine7":{"res":4096}}' \
#       --variants off:face:over:work:studio@5,off:face:over:bare:window@5,nobump:face:over:work:studio@5
# 1. person_job.py (a child Blender, exactly as the farm runs it): the whole chain (export, unwrap, bakes) and the --shots rendered with the
#    fine tier ON (FINE7_CYC unset), each with its own meter, tags cyc_<who>_<shot>_<light>_<wear>[_<stage>] as always.
# 2. each --variants entry name:shot:light:wear[:stage] rendered again from the same exports with FINE7_CYC set (person_scene.fine7_variant):
#    off = the v6 control at this commit (no bake, no material, no subdivision); nobump / nodisp / nocav / noprecomp = one part of the tier left
#    out; full = everything again. Tags <person_job tag>_f7<name>; the same render settings and their own meter.
#    (iteration 6) norelief = everything (bake, 'fine' material, pre-compensated Catmull-Clark, adaptive dicing) with the relief's gain at 0: on /
#    norelief isolates the relief; the check compares 'on' with every off AND norelief twin.
#    (iteration 9) nolobe = everything with the microstructure's sub-texel slope variance kept off both lobes' roughness (on / nolobe isolates it).
#    (iteration 10) lean = iteration 9's lobes (LEAN: the whole sub-texel variance into both roughnesses, no hidden share taken out of their
#    weight); 'on' is now the MIXTURE (micro.js HIDE): on / lean isolates it, on / nolobe shows the lobes' whole change since iteration 8.
#    (iteration 8) tri = iterations 1-7's base surface (Catmull-Clark on the export's triangles, the control mesh inverted); 'on' and every
#    other twin now subdivide hm08's recovered quads without the inversion (person_scene fine7_quads).
#    (iteration 7) a variant entry may end with s=<scale> (its own --scale), c=<x0/y0/x1/y1> (render_person's --crop, fractions, y down) and
#    t=<label> (appended to its tag): close crops of the torso at a higher scale from the same exports, e.g.
#    full:bust:over:bare:window@5:s=4:c=@navel/0.09:t=navel  and  nobody:bust:over:bare:window@5:s=4:c=@navel/0.09:t=navel (c=@navel|@chest/<half
#    height>: centred on the person's own navel or nipples as the export's camera sees them; c=x0/y0/x1/y1 a fixed box)
#    (c7 iteration 21) c=@mouth/<half height>[/<width:height>]: centred on the person's mouth (the cheilia and the stomion); any @ crop takes a third
#    field, the box's width : height in pixels (default 1, square)
# 3. the CHECK, in this log ('fine7_job check') and <out>/fine7_check.json: for every shot that has an 'off' twin, the scene-linear (pre-
#    exposure) EXR mean on / off per channel in a central face box and in the bottom strip (neck, clothes), and the two meters' p75. The tier
#    redistributes light inside the face; it must not move the face's mean (gate: within 5 % in R, G and B; the strip within 1 %; the
#    meters within 5 %). Iteration 2's half-bright chart (0.50-0.61) would have failed it in this log.
import os, sys, json, shlex, subprocess, time
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
def opt(k, d=None):
    return argv[argv.index('--' + k) + 1] if '--' + k in argv else d
HERE = os.path.dirname(os.path.abspath(__file__)); VIDEOS = os.path.dirname(HERE)
VARS = {'off': {'off': 1}, 'full': {}, 'nobump': {'bump': 0}, 'nodisp': {'disp': 0}, 'nocav': {'cav': 0},
        'norelief': {'zero': 1},   # iteration 6: the subdivision + pre-compensation + the 'fine' material with the relief at 0 (on / norelief isolates the relief)
        'nobody': {'body': 0},     # iteration 7: the torso's patches cleared, the face's relief kept (on / nobody isolates the navel and the areolae)
        'nolobe': {'lobe': 0}}
# (c5 iteration 17) 'precomp' deleted with fine7_precompensate (ruled by i13 L05 1015-065044 and the orchestrator 15 Oct 11:40).
# (c5 iteration 15) 'seamquads' deleted (the seam-safe pairing ruled in by 1015-065044) and 'noprecomp' is now the default; 'precomp' =
# iterations 12-14's inverted control mesh, the A/B of this ruling only
# (c4 iteration 12) 'tri' (iteration 8's A/B: quads ruled in) and 'lean' (iteration 10's: the mixture ruled in) deleted; 'noprecomp' is now the
# A/B of iteration 12 (the control mesh NOT inverted on the quads: iterations 8-11's surface)
REFS = ('off', 'norelief', 'nobody', 'nolobe')   # the twins the check compares 'on' with
VSPEC = [s.split(':') for s in (opt('variants') or '').split(',') if s]
pj_args = []
i = 0
while i < len(argv):   # every argument but --variants goes to person_job.py
    if argv[i] in ('--variants', '--check'):
        i += 2; continue
    pj_args.append(argv[i]); i += 1
try:
    import bpy
    BLENDER = bpy.app.binary_path
except ImportError:
    bpy = None; BLENDER = opt('blender', 'blender')
# (c7 iteration 21) SEVERAL PEOPLE IN ONE JOB: --who a,b,c runs this script once per person in turn (its own work folder, removed after that
# person so the worker's disk holds one person's exports at a time; every still in the one --out; each person's check in
# fine7_check_<who>.json); every other argument, --variants included, applies to each person. A person whose chain fails does not stop the next.
_WHO_ALL = [w for w in (opt('who') or 'lineup:L14_f42_black').split(',') if w]
if len(_WHO_ALL) > 1:
    import shutil
    _work = os.path.abspath(opt('work', os.environ.get('GPU_TMP') or os.path.join(VIDEOS, 'out', 'cycles_job')))
    _out = os.path.abspath(opt('out', os.environ.get('GPU_OUT') or os.path.join(_work, 'stills')))
    _rest = []; i = 0
    while i < len(argv):
        if argv[i] in ('--who', '--work', '--out', '--check'):
            i += 2; continue
        _rest.append(argv[i]); i += 1
    _boot = os.path.join(HERE, 'gpujob', 'boot.py'); _pre = ['--python', _boot] if os.environ.get('GPU_JOB_DEVICE') and os.path.exists(_boot) else []
    _log = {'who': _WHO_ALL, 'runs': []}
    for w in _WHO_ALL:
        k = w.replace(':', '_'); wk = os.path.join(_work, 'f7_' + k); os.makedirs(wk, exist_ok=True); t = time.time()
        cmd = [BLENDER, '-b', '--factory-startup', '-noaudio', '--python-exit-code', '1'] + _pre + ['--python', os.path.abspath(__file__), '--', '--who', w, '--work', wk, '--out', _out, '--check', f'fine7_check_{k}.json'] + _rest
        print('fine7_job (several) $', ' '.join(shlex.quote(c) for c in cmd), flush=True)
        r = subprocess.run(cmd, cwd=VIDEOS); _log['runs'].append({'who': w, 'code': r.returncode, 's': round(time.time() - t, 1)})
        pj = os.path.join(_out, 'person_job_log.json')
        if os.path.exists(pj): shutil.move(pj, os.path.join(_out, f'person_job_log_{k}.json'))
        shutil.rmtree(wk, ignore_errors=True)
        os.makedirs(_out, exist_ok=True); json.dump(_log, open(os.path.join(_out, 'fine7_job_people.json'), 'w'), indent=1)
    print('fine7_job (several) done', json.dumps(_log), flush=True)
    sys.exit(0)
WHO = opt('who', 'lineup:L14_f42_black'); key = WHO.replace(':', '_')
WORK = os.path.abspath(opt('work', os.environ.get('GPU_TMP') or os.path.join(VIDEOS, 'out', 'cycles_job')))
OUT = os.path.abspath(opt('out', os.environ.get('GPU_OUT') or os.path.join(WORK, 'stills')))
STAGE, QUAL, THICK = opt('stage'), opt('quality'), opt('sss-thick')
ex = {w: os.path.join(WORK, f'{key}_{w}') for w in ('bare', 'work')}
log = {'who': WHO, 'variants': [':'.join(v) for v in VSPEC], 'steps': []}
def run(cmd, env=None, tag=None):
    print('fine7_job $', ' '.join(shlex.quote(c) for c in cmd), flush=True)
    t = time.time(); r = subprocess.run(cmd, cwd=VIDEOS, env=env)
    log['steps'].append(dict(tag=tag, s=round(time.time() - t, 1), code=r.returncode)); return r.returncode
def tag_of(shot, light, wear, stg):
    return f'cyc_{key}_{shot}_{light}_{wear}' + (f'_{stg.replace("@", "r")}' if stg else '')

# 0. the root-cause PROBE (no render): iteration 1-2's maps were generated float images whose pixels were written and THEN their colour space
#    set. On this Blender: does setting it keep or lose the pixels? (and the order iteration 3 uses: is_data at creation, never re-coloured)
if bpy is not None:
    probe = {}
    for name, recolour in (('pixels_then_colourspace', True), ('is_data_only', False)):
        im = bpy.data.images.new('f7probe_' + name, 64, 48, alpha=True, float_buffer=True, is_data=True)
        px = np.full(64 * 48 * 4, 0.7, dtype=np.float32); im.pixels.foreach_set(px)
        if recolour:
            im.colorspace_settings.name = 'Non-Color'
        rb = np.empty(64 * 48 * 4, dtype=np.float32); im.pixels.foreach_get(rb)
        probe[name] = {'mean': round(float(rb.mean()), 4), 'kept': bool(abs(float(rb[0::4].mean()) - 0.7) < 1e-3)}
        bpy.data.images.remove(im)
    probe['blender'] = bpy.app.version_string
    log['probe'] = probe; print('fine7_job probe', json.dumps(probe), flush=True)

# 1. the chain and the fine tier ON
env0 ={k: v for k, v in os.environ.items() if k != 'FINE7_CYC'}
code = run([BLENDER, '-b', '--factory-startup', '-noaudio', '--python-exit-code', '1', '--python', os.path.join(HERE, 'person_job.py'), '--'] + pj_args, env=env0, tag='person_job')
if code:
    print(f'fine7_job: person_job exited {code}; the variants render from whatever exports exist', flush=True)
# the maps person_job used (its own rule: the dressed export reuses the bare atlas when the corner counts match)
MAPS = {'bare': os.path.join(ex['bare'], 'maps'), 'work': os.path.join(ex['work'], 'maps')}
try:
    if os.path.getsize(os.path.join(ex['work'], 'uv.bin')) == os.path.getsize(os.path.join(ex['bare'], 'uv.bin')):
        MAPS['work'] = MAPS['bare']
except OSError:
    pass

# (c7 iteration 22) THE MOUTH'S COLOUR INPUT: a crop of the baked skin albedo (the engine's diffuseColor after every skin hook, lab_bake.js
# pass 0) round the lips, per atlas, so a critic can tell paint from light: a contour or a band that is IN the albedo is a layer's colour; one
# that is not is form, shading or the path tracer. Native texels, then x4 nearest (c7 i23: x2 / x1 for a larger box; 30 mm round the stomion). albedo_mouth_<who>_<wear>_a<k>.png (+ the uv box in the log).
def albedo_mouth(wear):
    if bpy is None:
        return
    sys.path.insert(0, HERE)
    try:
        from person_io import Person
        pp = Person(ex[wear]); P = pp.arr(pp.body['position'], 3).astype(np.float64); tri = pp.arr(pp.body['index'], 3).astype(np.int64)
        uv = np.fromfile(os.path.join(ex[wear], 'uv.bin'), dtype=np.float32).reshape(-1, 2); at = np.fromfile(os.path.join(ex[wear], 'atlas.bin'), dtype=np.uint8)
        sto = P[493]; near = (np.linalg.norm(P[tri] - sto, axis=2) < 0.03).all(1)   # (c7 i23) 30 mm: the commissures too (the lips' half-width ~26 mm)
        rep = {}
        for a in sorted(set(at[near].tolist())):
            sel = np.nonzero(near & (at == a))[0]; c = uv.reshape(-1, 3, 2)[sel].reshape(-1, 2)
            u0, v0 = c.min(0); u1, v1 = c.max(0); mu, mv = 0.08 * (u1 - u0) + 0.002, 0.08 * (v1 - v0) + 0.002
            u0, v0, u1, v1 = max(0.0, u0 - mu), max(0.0, v0 - mv), min(1.0, u1 + mu), min(1.0, v1 + mv)
            p = os.path.join(MAPS[wear], f'skin_albedo_a{a}.png')
            if not os.path.exists(p):
                rep[a] = 'no ' + os.path.basename(p); continue
            im = bpy.data.images.load(p); W, H = im.size; px = np.empty(W * H * 4, dtype=np.float32); im.pixels.foreach_get(px); px = px.reshape(H, W, 4)
            x0, x1, y0, y1 = int(u0 * W), int(np.ceil(u1 * W)), int(v0 * H), int(np.ceil(v1 * H))
            if (x1 - x0) * (y1 - y0) > 2000 * 2000:
                rep[a] = f'uv box too large ({x1 - x0} x {y1 - y0} texels): skipped'; bpy.data.images.remove(im); continue
            zk = 4 if max(x1 - x0, y1 - y0) <= 600 else 2 if max(x1 - x0, y1 - y0) <= 1200 else 1   # nearest x4 / x2 / x1 by the box's size
            cr = np.repeat(np.repeat(px[y0:y1, x0:x1], zk, 0), zk, 1)
            o = bpy.data.images.new(f'albm_{a}', cr.shape[1], cr.shape[0], alpha=True); o.pixels.foreach_set(np.ascontiguousarray(cr).ravel())
            o.filepath_raw = os.path.join(OUT, f'albedo_mouth_{key}_{wear}_a{a}.png'); o.file_format = 'PNG'; o.save()
            rep[a] = {'tris': int(len(sel)), 'texels': [x1 - x0, y1 - y0], 'zoom': zk, 'uv': [round(float(x), 4) for x in (u0, v0, u1, v1)], 'atlas': [W, H]}
            bpy.data.images.remove(o); bpy.data.images.remove(im)
        log.setdefault('albedoMouth', {})[wear] = rep; print('fine7_job albedo mouth', wear, json.dumps(rep), flush=True)
    except Exception as e:
        print('fine7_job albedo mouth', wear, 'failed:', repr(e)[:300], flush=True)
for _w in ('bare', 'work'):
    if os.path.exists(os.path.join(ex[_w], 'manifest.json')):
        albedo_mouth(_w)

# 3. (defined before the variants since iteration 4: the check is WRITTEN after every 'off' twin renders, so a late failure, e.g. a RAM limit
#    in a later shot, keeps the earlier checks: iteration 3's L08 job died in its second shot and delivered no check at all)
def read_exr(p):
    if bpy is None:
        return None
    sys.path.insert(0, HERE)
    from acp_display import read_exr_bpy
    return read_exr_bpy(p)[..., :3].astype(np.float64)
def box_means(a, x0, y0, x1, y1):
    h, w = a.shape[:2]; r = a[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)].reshape(-1, 3); return r.mean(0)
def check_all(final=False):
    checks = []
    for v in VSPEC:
        if v[0] not in REFS or any('=' in x for x in v):   # (a crop twin is not checked: its own frame)
            continue
        shot, light, wear = v[1:4]; stg = v[4] if len(v) > 4 else STAGE; t_on = tag_of(shot, light, wear, stg); t_off = t_on + '_f7' + v[0]
        p_on, p_off = os.path.join(OUT, t_on + '.exr'), os.path.join(OUT, t_off + '.exr')
        if not (os.path.exists(p_on) and os.path.exists(p_off)):
            checks.append({'on': t_on, 'off': t_off, 'error': 'missing render'}); continue
        try:
            A, B = read_exr(p_on), read_exr(p_off)
            if A is None or A.shape != B.shape:
                checks.append({'on': t_on, 'off': t_off, 'error': 'unreadable or different sizes'}); continue
            face = box_means(A, 0.38, 0.30, 0.62, 0.62) / np.maximum(box_means(B, 0.38, 0.30, 0.62, 0.62), 1e-9)
            strip = box_means(A, 0.0, 0.92, 1.0, 1.0) / np.maximum(box_means(B, 0.0, 0.92, 1.0, 1.0), 1e-9)
            Y = lambda a: 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
            ya, yb = Y(A), Y(B); m = yb > 1e-4; diff = np.abs(ya - yb)[m] / yb[m]
            meters = []
            for t in (t_on, t_off):
                try:
                    meters.append((json.load(open(os.path.join(OUT, t + '.json'))).get('meter') or {}).get('p75'))
                except Exception:
                    meters.append(None)
            mr = (meters[0] / meters[1]) if (meters[0] and meters[1]) else None
            ok = bool(np.all(np.abs(face - 1) <= 0.05) and np.all(np.abs(strip - 1) <= 0.01) and (mr is None or abs(mr - 1) <= 0.05))
            checks.append({'on': t_on, 'off': t_off, 'faceRatioRGB': [round(float(x), 4) for x in face], 'stripRatioRGB': [round(float(x), 4) for x in strip],
                           'meterP75': meters, 'meterRatio': round(mr, 4) if mr else None, 'pixelsChanged1pct': round(float((diff > 0.01).mean()), 4),
                           'pixelsChanged10pct': round(float((diff > 0.10).mean()), 4), 'pass': ok})
        except Exception as e:
            checks.append({'on': t_on, 'off': t_off, 'error': repr(e)[:200]})
    log['checks'] = checks; log['final'] = final
    os.makedirs(OUT, exist_ok=True)
    json.dump(log, open(os.path.join(OUT, opt('check', 'fine7_check.json')), 'w'), indent=1)
    print('fine7_job check', json.dumps(checks), flush=True)
    return checks

# (iteration 7) c=@navel/<half> / c=@chest/<half>: a crop box centred on the person's navel (hm08's omphalion, vertex 4121) or the mid-point of
# the nipples (the bake's own patches: BODY7's nippleAt) as THIS export's camera sees them (posed, Blender frame), <half> of the frame's height
def auto_crop(spec, wear, shot):
    import math
    sys.path.insert(0, HERE)
    from person_io import Person
    try:
        parts = spec[1:].split('/'); what, half = parts[0], float(parts[1]); wh = float(parts[2]) if len(parts) > 2 else 1.0; pp = Person(ex[wear]); M = pp.m
        P = pp.arr(pp.body['position'], 3).astype(np.float64); bind = pp.arr(pp.body['bind'], 3).astype(np.float64)
        if what == 'navel':
            pts = [P[4121]]
        elif what == 'mouth':   # (c7 iteration 21) the cheilia and the stomion (assets/face/landmarks.json ch_L 7129, ch_R 369, sto 493)
            pts = [P[7129], P[369], P[493]]
        else:
            F = json.load(open(os.path.join(ex[wear], 'fine7', 'fine7.json'))); cs = [q['c'] for q in ((F['report'].get('body') or {}).get('patches') or []) if q.get('kind') == 'nac' and q.get('c')]
            pts = [P[int(np.argmin(((bind - np.array(c)) ** 2).sum(1)))] for c in cs]
        q = np.mean(pts, 0); cam = M['cameras'][shot]; Mw = np.array(cam['matrix'], dtype=float).reshape(4, 4).T
        pc = np.linalg.inv(Mw) @ np.array([q[0], q[1], q[2], 1.0]); t = math.tan(math.radians(cam['fovY']) / 2); asp = cam['W'] / cam['H']
        fx = 0.5 + 0.5 * (pc[0] / -pc[2]) / (t * asp); fy = 0.5 - 0.5 * (pc[1] / -pc[2]) / t; hw = half * wh / asp   # wh: the box's width : height in pixels
        box = [max(0.0, fx - hw), max(0.0, fy - half), min(1.0, fx + hw), min(1.0, fy + half)]
        log.setdefault('crops', {})[spec] = {'shot': shot, 'centre': [round(fx, 4), round(fy, 4)], 'box': [round(x, 4) for x in box]}
        print('fine7_job crop', spec, json.dumps(log['crops'][spec]), flush=True)
        return ','.join('%.4f' % x for x in box)
    except Exception as e:
        print('fine7_job crop', spec, 'failed:', repr(e)[:300], flush=True); return None

# 2. the variants
boot = os.path.join(HERE, 'gpujob', 'boot.py')
pre = ['--python', boot] if os.environ.get('GPU_JOB_DEVICE') and os.path.exists(boot) else []
for v in VSPEC:
    kv = dict(x.split('=', 1) for x in v[4:] if '=' in x); v = [x for x in v if '=' not in x]   # iteration 7: s=, c=, t=
    name, shot, light, wear = v[:4]; stg = v[4] if len(v) > 4 else STAGE
    if name not in VARS:
        print(f'fine7_job: unknown variant {name} (known: {", ".join(VARS)})', flush=True); continue
    if not os.path.exists(os.path.join(ex[wear], 'manifest.json')):
        print(f'fine7_job: no {wear} export for {name}; skipped', flush=True); continue
    l5 = (['--stage', stg] if stg else []) + (['--quality', QUAL] if QUAL else []) + (['--sss-thick', THICK] if THICK else [])
    env = dict(env0); env['FINE7_CYC'] = json.dumps(VARS[name])
    tg = tag_of(shot, light, wear, stg) + '_f7' + name + (('_' + kv['t']) if kv.get('t') else '')
    cs = auto_crop(kv['c'], wear, shot) if kv.get('c', '').startswith('@') else (kv['c'].replace('/', ',') if kv.get('c') else None)
    if kv.get('c') and not cs:
        continue
    crop = ['--crop', cs] if cs else []
    run([BLENDER, '-b', '--factory-startup', '-noaudio', '--python-exit-code', '1'] + pre + ['--python', os.path.join(HERE, 'render_person.py'), '--', '--export', ex[wear], '--maps', MAPS[wear],
         '--shot', shot, '--light', light, '--samples', opt('samples', '128'), '--scale', kv.get('s', opt('scale', '1')), '--out', OUT, '--tag', tg] + crop + l5, env=env, tag=tg)
    if name in REFS and not crop:
        check_all()

# 3. the final check (also written after every 'off' twin above)
check_all(final=True)
print('fine7_job done', flush=True)
