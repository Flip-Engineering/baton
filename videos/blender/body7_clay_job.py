# BODY7 (HUMAN c8 round 7, 8 Oct 2026; c3: one current version): clay figure studies of THE LATEST PERSON in Cycles on the farm's GPU, side by side
# when an A/B is asked. Clay shows the FORM alone (no skin colour, no hair): what the figure's anatomy reads as under a raking light.
# Steps: node exports the posed nude bodies (labs/human8/body7_export.mjs, no GL: makePerson('latest:<name>'), the figure-study register, its own kin
# stance, every lane's current geometry: BODY7's rev 7 body with the girdle and NAC7 v2, FACE7, ANAT8 hooks as landed); Blender builds each body
# as clay (smooth-shaded, the exporter's Blender frame: x lateral, y depth with the front at -y, z up, metres), one raking key from camera-left, a
# grey world as the fill, a floor, an orthographic camera (2.1 m tall), and renders to $GPU_OUT/stills/<tag>.png.
#   python3 videos/scripts/farm.py gpu --blender videos/blender/body7_clay_job.py --time 45 --mem 16 --no-wait --by BODY7 -- \
#       --pairs L08_f24_hispanic:front,L08_f24_hispanic:profile [--sides latest,soft] [--chest L08_f24_hispanic:three4] [--samples 96]
# Views: front | three4 (the figure turned -0.75 rad) | profile | back. Sides (left to right): latest (the latest person as it is), soft (+ the
# membrane fit onto ANAT8-BODY's solved breast; body7_export --soft), nonac (NAC7 off: its A/B), glayer (+ THE GIRDLE LAYER: the neck base and the
# clavicles from the person's own bones, the typed girdle forms out: c3 iteration 8; body7_export --girdle), nopelvis (ANAT8-PELVIS's landed region
# OFF: c6 iteration 1, the women's belly trough's cause; body7_export --no-pelvis; the sides noslide / nosheet / noaxilla / axv1 went with the KEEP
# rulings of SL7 and AX7 v2), pelvisnext (ANAT8-PELVIS's v9 bakes under test, assets/anatomy/pelvis/next/), abdwall (c6 it2: v9 with the linea
# alba binding the SFS, not the dermis: labs/human8/body7_abdwall/, BODY7's proposal to ANAT8-PELVIS). --chest adds a CLOSE-UP
# of each figure alone, one still per side (clay_<name>_<view>_chest_<side>.png, --chest-res 1000x1100, an orthographic frame --chest-h 0.6 m
# tall centred at --chest-z 0.73 of the figure's height). OUR renders only (no photograph is read or written).
# (c3: the sides v6 / r73-r77, which rendered superseded revisions, are DELETED; git history has them.)
import bpy, os, sys, json, math, subprocess, time
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def opt(k, d=None):
    return argv[argv.index('--' + k) + 1] if '--' + k in argv else d
HERE = os.path.dirname(os.path.abspath(__file__)); VIDEOS = os.path.dirname(HERE); WEB = os.path.join(VIDEOS, 'web')
OUT = os.path.abspath(os.environ.get('GPU_OUT') or os.path.join(VIDEOS, 'out', 'body7_clay'))
TMP = os.path.abspath(os.environ.get('GPU_TMP') or os.path.join(OUT, 'tmp'))
PAIRS = [tuple(p.split(':')) for p in opt('pairs', 'L23_m45_white:front').split(',') if p]
SAMPLES = int(opt('samples', '96')); W, H = map(int, opt('res', '1000x1100').split('x'))
ELEV, AZ = math.radians(float(opt('elev', '25'))), math.radians(float(opt('az', '55')))
VIEW = {'front': 0.0, 'three4': -0.75, 'profile': -math.pi / 2, 'back': math.pi}
GAP = float(opt('gap', '0.92'))
SIDES = [t for t in opt('sides', 'latest').split(',') if t]
SIDE_ARGS = {'latest': [], 'soft': ['--soft'], 'nonac': ['--no-nac'], 'glayer': ['--girdle'], 'nopelvis': ['--no-pelvis'],
             'pelvisnext': ['--pelvis-set', 'next'], 'abdwall': ['--pelvis-set', '../../../labs/human8/body7_abdwall']}
CHEST = [tuple(p.split(':')) for p in opt('chest', '').split(',') if p]
CW, CH = map(int, opt('chest-res', '1000x1100').split('x')); CHEST_H = float(opt('chest-h', '0.6')); CHEST_Z = float(opt('chest-z', '0.73'))
report = {'pairs': [], 'steps': []}

def run(cmd, cwd=WEB, env=None):
    t = time.time(); print('body7_clay $', ' '.join(cmd), flush=True)
    r = subprocess.run(cmd, cwd=cwd, env=env)
    report['steps'].append({'cmd': cmd[:3], 's': round(time.time() - t, 1), 'code': r.returncode})
    if r.returncode:
        raise SystemExit(f'body7_clay: step failed ({r.returncode}): {cmd[:3]}')

# node's packages (the GPU container has node but not videos/web/node_modules: person_job.py's rule, npm ci from the committed lock)
def ensure_deps():
    env = dict(os.environ); home = os.environ.get('GPU_JOB_HOME')
    if home:
        env.setdefault('npm_config_cache', os.path.join(home, 'npm-cache'))
    three = os.path.join(WEB, 'node_modules', 'three')
    if not all(os.path.exists(os.path.join(three, f)) for f in ('package.json', os.path.join('build', 'three.module.js'))):
        run(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], WEB, env)

def load(d, tag, name):
    meta = json.load(open(os.path.join(d, f'{tag}_{name}.json'))); b = open(os.path.join(d, f'{tag}_{name}.bin'), 'rb').read()
    nv, nt = meta['verts'], meta['tris']
    P = np.frombuffer(b, np.float32, nv * 3, 0).reshape(-1, 3).astype(np.float64)
    T = np.frombuffer(b, np.uint32, nt * 3, nv * 12).reshape(-1, 3).astype(np.int64)
    return meta, P, T

def clay_material():
    m = bpy.data.materials.new('body7_clay'); m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (0.58, 0.55, 0.51, 1.0); bsdf.inputs['Roughness'].default_value = 0.55
    return m

def body_object(name, P, T, mat):
    c = P[:, :2].mean(axis=0); Q = P.copy(); Q[:, 0] -= c[0]; Q[:, 1] -= c[1]          # each figure about its own vertical axis
    me = bpy.data.meshes.new(name); me.from_pydata(Q.tolist(), [], T.tolist()); me.validate(); me.update()
    try:
        me.shade_smooth()
    except AttributeError:
        me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    return ob

def main():
    t0 = time.time(); os.makedirs(os.path.join(OUT, 'stills'), exist_ok=True); os.makedirs(TMP, exist_ok=True)
    names = sorted({n for n, _ in PAIRS} | {n for n, _ in CHEST})
    ensure_deps()
    dirs = {}
    for tag in SIDES:
        dirs[tag] = os.path.join(TMP, tag)
        run(['node', 'labs/human8/body7_export.mjs', *names, '--tag', tag, '--out', dirs[tag], *SIDE_ARGS[tag]])
    # the scene
    for o in list(bpy.data.objects):                     # the startup scene's cube, lamp and camera (no factory reset: the GPU choice stays)
        bpy.data.objects.remove(o, do_unlink=True)
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'
    try:
        from gpujob import devices; devices.apply(sc)
    except Exception as e:
        print('body7_clay: gpujob.devices not applied:', e, flush=True)
    sc.cycles.samples = SAMPLES; sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W, H, 100
    sc.render.image_settings.file_format = 'PNG'; sc.render.film_transparent = False
    world = bpy.data.worlds.new('body7_world'); world.use_nodes = True; sc.world = world
    bg = world.node_tree.nodes.get('Background'); bg.inputs['Color'].default_value = (0.20, 0.20, 0.21, 1.0); bg.inputs['Strength'].default_value = 1.0
    fl = bpy.data.meshes.new('floor'); fl.from_pydata([(-10, -10, 0), (10, -10, 0), (10, 10, 0), (-10, 10, 0)], [], [(0, 1, 2, 3)])
    fm = bpy.data.materials.new('floor'); fm.use_nodes = True; fb_ = fm.node_tree.nodes.get('Principled BSDF')
    fb_.inputs['Base Color'].default_value = (0.32, 0.31, 0.30, 1.0); fb_.inputs['Roughness'].default_value = 0.85; fl.materials.append(fm)
    sc.collection.objects.link(bpy.data.objects.new('floor', fl))
    sun = bpy.data.lights.new('key', 'SUN'); sun.energy = 3.2; sun.angle = math.radians(3)
    so = bpy.data.objects.new('key', sun); sc.collection.objects.link(so)
    Lto = Vector((-math.sin(AZ) * math.cos(ELEV), -math.cos(AZ) * math.cos(ELEV), math.sin(ELEV)))   # toward the light: camera-left, in front, up
    so.rotation_euler = (-Lto).to_track_quat('-Z', 'Y').to_euler()
    cam = bpy.data.cameras.new('cam'); cam.type = 'ORTHO'; cam.ortho_scale = 2.1 * max(1.0, W / H)
    co = bpy.data.objects.new('cam', cam); sc.collection.objects.link(co); sc.camera = co
    co.location = (0.0, -10.0, 0.95); co.rotation_euler = (math.pi / 2, 0.0, 0.0)
    mat = clay_material(); obs = {}
    for n in names:
        for tag, d in dirs.items():
            meta, P, T = load(d, tag, n); meta['_z'] = (float(P[:, 2].min()), float(P[:, 2].max())); obs[(tag, n)] = (body_object(f'{tag}_{n}', P, T, mat), meta)
    for (tag, n), (ob, _) in obs.items():
        ob.hide_render = True
    for n, v in PAIRS:
        t = time.time(); ang = VIEW.get(v, 0.0); shown = []
        for k, (tag, x) in enumerate((t, (k - (len(SIDES) - 1) / 2) * GAP) for k, t in enumerate(SIDES)):
            ob, meta = obs[(tag, n)]; ob.hide_render = False; ob.location = (x, 0.0, 0.0); ob.rotation_euler = (0.0, 0.0, ang); shown.append(ob)
        tag_out = f'clay_{n}_{v}'; sc.render.filepath = os.path.join(OUT, 'stills', tag_out + '.png')
        bpy.ops.render.render(write_still=True)
        for ob in shown:
            ob.hide_render = True
        gs = {tag: obs[(tag, n)][1].get('girdle') or {} for tag in SIDES}
        report['pairs'].append({'tag': tag_out, 's': round(time.time() - t, 1), 'sides': SIDES,
                                'girdle': {tag: {k: g.get(k) for k in ('L', 'R', 'clear', 'relax')} for tag, g in gs.items()}})
        print(f'body7_clay: {tag_out} {time.time() - t:.1f} s', flush=True)
    # the close-ups: each figure alone at the centre, the frame CHEST_H tall at CHEST_Z of its height (the same light)
    if CHEST:
        sc.render.resolution_x, sc.render.resolution_y = CW, CH; cam.ortho_scale = CHEST_H * max(1.0, CW / CH)
        for n, v in CHEST:
            ang = VIEW.get(v, 0.0)
            for tag in SIDES:
                t = time.time(); ob, meta = obs[(tag, n)]; z0, z1 = meta['_z']
                ob.hide_render = False; ob.location = (0.0, 0.0, 0.0); ob.rotation_euler = (0.0, 0.0, ang)
                co.location = (0.0, -10.0, z0 + CHEST_Z * (z1 - z0))
                tag_out = f'clay_{n}_{v}_chest_{tag}'; sc.render.filepath = os.path.join(OUT, 'stills', tag_out + '.png')
                bpy.ops.render.render(write_still=True); ob.hide_render = True
                report['pairs'].append({'tag': tag_out, 's': round(time.time() - t, 1), 'side': tag, 'chest': {'h': CHEST_H, 'z': CHEST_Z, 'res': [CW, CH]},
                                        'nipple7': meta.get('nipple7')})
                print(f'body7_clay: {tag_out} {time.time() - t:.1f} s', flush=True)
    report.update(samples=SAMPLES, res=[W, H], elev=math.degrees(ELEV), az=math.degrees(AZ), total_s=round(time.time() - t0, 1),
                  device=getattr(sc.cycles, 'device', None))
    json.dump(report, open(os.path.join(OUT, 'body7_clay_report.json'), 'w'), indent=1)
    print('body7_clay: done', round(time.time() - t0, 1), 's', flush=True)

main()
