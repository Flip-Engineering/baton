# ANAT8-PELVIS (HUMAN c8 round 7, lane iteration 13, 15 Oct 2026; review/studio_human_c8/after/anat8_pelvis/NOTES.md): the TISSUE CUTAWAY of the hips and
# thighs in Cycles on the farm's GPU: which tissue makes each bump. Our geometry only (no photograph, no atlas, no scan). Node exports each person's layers
# (videos/web/labs/human8/anat8p/export_cutaway.mjs: the skeleton, ANAT8-BODY's muscles and this lane's thigh packed from origin to insertion, meshed from
# their fields; the region's LOADED skin from the bake in assets/anatomy/pelvis; the body before), then Blender renders, per person and view, THREE
# panels with the same camera and light: 'skin' the loaded skin (clay) | 'muscle' bone + the muscles by group (quadriceps red, adductors purple,
# hamstrings green, sartorius / gracilis ochre, the hip's iliopsoas / minimus / TFL / tract brown, ANAT8-BODY's gluteals dark red, the trunk's grey-red,
# the thigh's intermuscular tissue pale yellow) with the loaded skin as a faint ghost | 'before' the body before (clay). Hips-and-thighs framing,
# orthographic, 1 mm a pixel (0.70 x 0.86 m).
#   python3 videos/scripts/farm.py gpu --blender videos/blender/anat8p_cutaway_job.py --time 60 --mem 24 --no-wait --by ANAT8-PELVIS --title <t> -- \
#       --people L08,L12,L22,L06 --views front,back,left,three4 [--samples 64]
# Outputs: $GPU_OUT/stills/<name>_<view>_<panel>.png and anat8p_cutaway_report.json; the runner composes the panels side by side.
import bpy, os, sys, json, math, subprocess, time
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def opt(k, d=None):
    return argv[argv.index('--' + k) + 1] if '--' + k in argv else d
HERE = os.path.dirname(os.path.abspath(__file__)); VIDEOS = os.path.dirname(HERE); WEB = os.path.join(VIDEOS, 'web')
OUT = os.path.abspath(os.environ.get('GPU_OUT') or os.path.join(VIDEOS, 'out', 'anat8p_cutaway'))
TMP = os.path.abspath(os.environ.get('GPU_TMP') or os.path.join(OUT, 'tmp'))
PEOPLE = [p for p in opt('people', 'L08,L22').split(',') if p]
VIEWS = [v for v in opt('views', 'front,back,left,three4').split(',') if v]
SAMPLES = int(opt('samples', '64')); MMPX = float(opt('mmpx', '1.0'))
PW, PH = 0.70, 0.86
W, H = int(round(PW * 1000 / MMPX)), int(round(PH * 1000 / MMPX))
VIEW = {'front': 0.0, 'three4': -0.75, 'left': -math.pi / 2, 'back': math.pi, 'right': math.pi / 2}
COL = {'bone': (0.80, 0.76, 0.66), 'quads': (0.62, 0.12, 0.10), 'adductors': (0.30, 0.18, 0.52), 'hamstrings': (0.12, 0.42, 0.26), 'straps': (0.78, 0.56, 0.12),
       'hip': (0.46, 0.26, 0.16), 'glutes': (0.40, 0.10, 0.10), 'trunk': (0.48, 0.30, 0.28), 'intermuscular': (0.92, 0.86, 0.55), 'skin': (0.62, 0.58, 0.54), 'before': (0.62, 0.58, 0.54)}
PANELS = {'skin': ['skin'], 'muscle': ['bone', 'quads', 'adductors', 'hamstrings', 'straps', 'hip', 'glutes', 'trunk', 'intermuscular', 'ghost'], 'before': ['before']}
report = {'stills': [], 'steps': []}

def run(cmd, cwd=WEB, env=None):
    t = time.time(); print('anat8p_cutaway $', ' '.join(cmd), flush=True)
    r = subprocess.run(cmd, cwd=cwd, env=env)
    report['steps'].append({'cmd': cmd[:3], 's': round(time.time() - t, 1), 'code': r.returncode})
    if r.returncode:
        raise SystemExit(f'anat8p_cutaway: step failed ({r.returncode}): {cmd[:3]}')

def ensure_deps():                                    # node's packages from the committed lock (person_job.py's rule)
    env = dict(os.environ); home = os.environ.get('GPU_JOB_HOME')
    if home:
        env.setdefault('npm_config_cache', os.path.join(home, 'npm-cache'))
    three = os.path.join(WEB, 'node_modules', 'three')
    if not all(os.path.exists(os.path.join(three, f)) for f in ('package.json', os.path.join('build', 'three.module.js'))):
        run(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], WEB, env)

def load(d, name, layer):
    pj = os.path.join(d, f'{name}_{layer}.json')
    if not os.path.exists(pj):
        return None
    meta = json.load(open(pj)); b = open(os.path.join(d, f'{name}_{layer}.bin'), 'rb').read()
    nv, nt = meta['verts'], meta['tris']
    P = np.frombuffer(b, np.float32, nv * 3, 0).reshape(-1, 3).astype(np.float64)
    T = np.frombuffer(b, np.uint32, nt * 3, nv * 12).reshape(-1, 3).astype(np.int64)
    return P, T

def material(name, rgb, rough=0.55, alpha=1.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*rgb, 1.0); b.inputs['Roughness'].default_value = rough
    if alpha < 1.0:
        b.inputs['Alpha'].default_value = alpha
        try:
            m.blend_method = 'BLEND'
        except Exception:
            pass
    return m

def mesh_object(name, P, T, mat, parent, off, smooth=True):
    Q = P.copy(); Q[:, 0] -= off[0]; Q[:, 1] -= off[1]
    me = bpy.data.meshes.new(name); me.from_pydata(Q.tolist(), [], T.tolist()); me.validate(); me.update()
    if smooth:
        try:
            me.shade_smooth()
        except AttributeError:
            me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob); ob.parent = parent
    return ob

def main():
    t0 = time.time(); os.makedirs(os.path.join(OUT, 'stills'), exist_ok=True); os.makedirs(TMP, exist_ok=True)
    ensure_deps()
    dl = os.path.join(TMP, 'layers')
    run(['node', 'labs/human8/anat8p/export_cutaway.mjs', *PEOPLE, '--out', dl])
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'
    try:
        from gpujob import devices; devices.apply(sc)
    except Exception as e:
        print('anat8p_cutaway: gpujob.devices not applied:', e, flush=True)
    sc.cycles.samples = SAMPLES; sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W, H, 100
    sc.render.image_settings.file_format = 'PNG'; sc.render.film_transparent = False
    world = bpy.data.worlds.new('anat8p_world'); world.use_nodes = True; sc.world = world
    bg = world.node_tree.nodes.get('Background'); bg.inputs['Color'].default_value = (0.20, 0.20, 0.21, 1.0); bg.inputs['Strength'].default_value = 1.0
    sun = bpy.data.lights.new('key', 'SUN'); sun.energy = 3.2; sun.angle = math.radians(3)
    so = bpy.data.objects.new('key', sun); sc.collection.objects.link(so)
    elev, az = math.radians(30), math.radians(40)
    Lto = Vector((-math.sin(az) * math.cos(elev), -math.cos(az) * math.cos(elev), math.sin(elev)))
    so.rotation_euler = (-Lto).to_track_quat('-Z', 'Y').to_euler()
    cam = bpy.data.cameras.new('cam'); cam.type = 'ORTHO'; cam.ortho_scale = max(PW, PH)
    co = bpy.data.objects.new('cam', cam); sc.collection.objects.link(co); sc.camera = co; co.rotation_euler = (math.pi / 2, 0.0, 0.0)
    mats = {k: material('m_' + k, v) for k, v in COL.items()}
    mats['ghost'] = material('m_ghost', (0.85, 0.85, 0.85), 0.5, 0.18)
    for n_ in PEOPLE:
        name = next((f[:-11] for f in os.listdir(dl) if f.startswith(n_) and f.endswith('_marks.json')), None)
        if not name:
            print('anat8p_cutaway: no export for', n_, flush=True); continue
        mk = json.load(open(os.path.join(dl, name + '_marks.json'))); skin = load(dl, name, 'skin'); off = skin[0][:, :2].mean(axis=0)
        root = bpy.data.objects.new('root_' + name, None); sc.collection.objects.link(root)
        objs = {}
        for layer in COL:
            m = load(dl, name, layer)
            if m is not None:
                objs[layer] = mesh_object(f'{name}_{layer}', m[0], m[1], mats[layer], root, off)
        objs['ghost'] = mesh_object(f'{name}_ghost', skin[0], skin[1], mats['ghost'], root, off)
        for v in VIEWS:
            root.rotation_euler = (0.0, 0.0, VIEW.get(v, 0.0))
            for pk, layers in PANELS.items():
                co.location = (0.0, -10.0, mk['centreZ'] - 0.04)
                for ob in objs.values():
                    ob.hide_render = True
                for layer in layers:
                    if layer in objs:
                        objs[layer].hide_render = False
                t = time.time(); tag = f'{name}_{v}_{pk}'; sc.render.filepath = os.path.join(OUT, 'stills', tag + '.png')
                bpy.ops.render.render(write_still=True)
                report['stills'].append({'tag': tag, 's': round(time.time() - t, 1)}); print(f'anat8p_cutaway: {tag} {time.time() - t:.1f} s', flush=True)
        for ob in list(objs.values()) + [root]:
            bpy.data.objects.remove(ob, do_unlink=True)
    report['s'] = round(time.time() - t0, 1)
    json.dump(report, open(os.path.join(OUT, 'anat8p_cutaway_report.json'), 'w'), indent=1)
    print('anat8p_cutaway done', report['s'], 's', flush=True)

main()
