# ANAT8-BODY (HUMAN c8 round 7, c2 iteration 1, 8 Oct 2026): clay CUTAWAY panels of the body built from the skeleton out, in Cycles on the farm's GPU.
# Our geometry only (no photograph, no atlas, no scan). Steps: node exports each person's layers (videos/web/labs/human8/anat8b/export_layers.mjs, no GL:
# skeleton v2 and v3 with the costal cartilages apart, muscles v1 and the breasts on v3, v6's bind skin, the marks); Blender renders, per person and view,
# FOUR panels, each alone (no panel shades another): 'p1' skeleton v2 | 'p2' skeleton v3 | 'p3' v3 + muscles (+ the breasts) | 'p4' v6's skin with the
# nipple-areola complex placed by the anatomy (green) and hm08's fixed nipple vertex (blue). Every panel carries two short red rods at ANSUR II's chest
# height under the person's own suprasternale (men: the nipple; women: the bust point). Torso framing, orthographic, 1 mm a pixel (0.75 x 0.80 m).
#   python3 videos/scripts/farm_gpu.py run --blender videos/blender/anat8b_cutaway_job.py --time 40 --mem 16 --by ANAT8-BODY --no-wait --yes \
#       --dep ... -- --people L08,L21,L06,L03 --views front,three4 [--profile L08,L06] [--samples 64] [--mmpx 1.0] [--set i5|i6]
# --set i9 (lane iteration 9 = c3 iteration 2, the default now): the women's breasts SOLVED by the soft-tissue solver (soft/breast.js v2): 'p1' skeleton v3 +
# muscles v2 + breast v2 + NAC v2 (BEFORE, as the i6 plates) | 'p2' the same with the SOLVED region standing ('soft9': the breast and the chest's subcutaneous
# layer over the region's box, a closed slab whose flat walls are the region's cuts) and the clay NAC at the solve's tracked nipple | 'p3' v6's skin with
# the marks (green = the solved nipple, orange = breast v2's NAC, blue = hm08's vertex) | 'p4' the solve's UNLOADED reference ('soft9u'); ticks at the MCLs:
# red = ANSUR II bust point, yellow = the imaging fold, cyan = the solved fold; profile without the arm's bones and muscles; no zoom panel.
# --set i7 (lane iteration 7): the women's breast v2 (BEFORE) | v3 (AFTER: the standing fold, no shear, clean rims), each with a clay
# areola and nipple at its NAC along its axis: 'p1' skeleton v3 + muscles v2 + breast v2 + NAC v2 | 'p2' the same with breast v3 + NAC v3 | 'p3' v6's skin
# with the NACs (green v3, orange v2, blue hm08) | 'p4' = p2 at 2x on the chest; ticks at the MCLs: red = ANSUR II bust point, yellow = the imaging fold,
# cyan = the standing fold (v3); profile without the arm's bones and muscles.
# --set i6 (lane iteration 6): 'p1' skeleton v3 + muscles v1 + breast v1 (BEFORE) | 'p2' skeleton v3 + muscles v2 + breast v2 (AFTER) |
# 'p3' v6's skin with the NACs: green = v2 (anatomy), orange = v1, blue = hm08's fixed vertex | 'p4' = p2 at 2x on the chest (0.5 mm a pixel, centred on
# the v2 NAC's height); in the 'profile' view the arm's bones and muscles are left out (they hide the lateral cage). Every panel carries ANSUR II's chest
# height as a thin red rod ACROSS the chest (the panel's whole width) with short vertical ticks at the two midclavicular lines (front view), and the
# sourced inframammary fold level as a short yellow tick at each MCL (women). --set i5: the c2 iteration-1 panels (skeleton v2 | v3 | v3 + muscles + breast | skin).
# Outputs: $GPU_OUT/stills/<name>_<view>_<p1..p4>.png and anat8b_cutaway_report.json. The runner composes the four panels side by side (boards).
import bpy, os, sys, json, math, subprocess, time
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def opt(k, d=None):
    return argv[argv.index('--' + k) + 1] if '--' + k in argv else d
HERE = os.path.dirname(os.path.abspath(__file__)); VIDEOS = os.path.dirname(HERE); WEB = os.path.join(VIDEOS, 'web')
OUT = os.path.abspath(os.environ.get('GPU_OUT') or os.path.join(VIDEOS, 'out', 'anat8b_cutaway'))
TMP = os.path.abspath(os.environ.get('GPU_TMP') or os.path.join(OUT, 'tmp'))
PEOPLE = [p for p in opt('people', 'L08,L21').split(',') if p]
VIEWS = [v for v in opt('views', 'front,three4').split(',') if v]
PROFILE = [p for p in opt('profile', '').split(',') if p]
SAMPLES = int(opt('samples', '64')); MMPX = float(opt('mmpx', '1.0'))
PW, PH = 0.75, 0.80                                   # the panel's window (m): torso framing
W, H = int(round(PW * 1000 / MMPX)), int(round(PH * 1000 / MMPX))
VIEW = {'front': 0.0, 'three4': -0.75, 'profile': -math.pi / 2, 'back': math.pi}
SET = 'current'   # (lane iteration 10: the old sets i5 / i6 / i7 deleted with their revisions; the current layers, as export_layers.mjs writes them)
PANELS = {'p1': ['bone3', 'cart3', 'muscle2', 'breast2', 'nac2'], 'p2': ['bone3', 'cart3', 'muscle2', 'soft9', 'nac9'], 'p3': ['skin', 'marks'], 'p4': ['bone3', 'cart3', 'muscle2', 'soft9u', 'nac9u']}
PANELS_PROFILE = {'p1': ['bone3t', 'cart3t', 'muscle2t', 'breast2', 'nac2'], 'p2': ['bone3t', 'cart3t', 'muscle2t', 'soft9', 'nac9'], 'p3': ['skin', 'marks'], 'p4': ['bone3t', 'cart3t', 'muscle2t', 'soft9u', 'nac9u']}
ZOOM = {}
BONE, CART, MUSC, FAT = (0.80, 0.76, 0.66), (0.52, 0.66, 0.74), (0.50, 0.19, 0.16), (0.86, 0.68, 0.30)
COL = {'bone3': BONE, 'bone3t': BONE, 'cart3': CART, 'cart3t': CART, 'muscle2': MUSC, 'muscle2t': MUSC,
       'breast2': FAT, 'skin': (0.58, 0.55, 0.51), 'nac2': (0.55, 0.30, 0.24),
       'soft9': FAT, 'soft9u': FAT, 'nac9': (0.55, 0.30, 0.24), 'nac9u': (0.55, 0.30, 0.24)}
report = {'stills': [], 'steps': []}

def run(cmd, cwd=WEB, env=None):
    t = time.time(); print('anat8b_cutaway $', ' '.join(cmd), flush=True)
    r = subprocess.run(cmd, cwd=cwd, env=env)
    report['steps'].append({'cmd': cmd[:3], 's': round(time.time() - t, 1), 'code': r.returncode})
    if r.returncode:
        raise SystemExit(f'anat8b_cutaway: step failed ({r.returncode}): {cmd[:3]}')

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

def material(name, rgb, rough=0.55, emit=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*rgb, 1.0); b.inputs['Roughness'].default_value = rough
    if emit > 0:
        for key in ('Emission Color', 'Emission'):
            if key in b.inputs:
                b.inputs[key].default_value = (*rgb, 1.0); break
        if 'Emission Strength' in b.inputs:
            b.inputs['Emission Strength'].default_value = emit
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

def _bm_object(name, build, mat, parent=None, loc=(0.0, 0.0, 0.0)):
    import bmesh
    me = bpy.data.meshes.new(name); bm = bmesh.new(); build(bm); bm.to_mesh(me); bm.free(); me.materials.append(mat)
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob); ob.location = loc
    if parent is not None:
        ob.parent = parent
    return ob

def sphere(name, c, r, mat, parent, off):
    import bmesh
    return _bm_object(name, lambda bm: bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=r), mat, parent, (c[0] - off[0], c[1] - off[1], c[2]))

def rod(name, x0, x1, z, mat, r=0.0018):               # a thin bar along x at height z, in front of the figures (the camera's frame, not the figure's)
    import bmesh
    def build(bm):
        bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=r, radius2=r, depth=abs(x1 - x0))
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=__import__('mathutils').Matrix.Rotation(math.pi / 2, 3, 'Y'))
    return _bm_object(name, build, mat, None, ((x0 + x1) / 2, -0.30, z))

def tick(name, x, z, h, mat, r=0.0012):                # a short vertical bar centred at (x, z), in front of the figures (camera frame)
    import bmesh
    def build(bm):
        bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=r, radius2=r, depth=h)
    return _bm_object(name, build, mat, None, (x, -0.31, z))

def main():
    t0 = time.time(); os.makedirs(os.path.join(OUT, 'stills'), exist_ok=True); os.makedirs(TMP, exist_ok=True)
    ensure_deps()
    dl = os.path.join(TMP, 'layers')
    run(['node', 'labs/human8/anat8b/export_layers.mjs', *sorted(set(PEOPLE + PROFILE)), '--out', dl])
    for o in list(bpy.data.objects):                  # the startup scene's cube, lamp and camera (no factory reset: the GPU choice stays)
        bpy.data.objects.remove(o, do_unlink=True)
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'
    try:
        from gpujob import devices; devices.apply(sc)
    except Exception as e:
        print('anat8b_cutaway: gpujob.devices not applied:', e, flush=True)
    sc.cycles.samples = SAMPLES; sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W, H, 100
    sc.render.image_settings.file_format = 'PNG'; sc.render.film_transparent = False
    world = bpy.data.worlds.new('anat8b_world'); world.use_nodes = True; sc.world = world
    bg = world.node_tree.nodes.get('Background'); bg.inputs['Color'].default_value = (0.20, 0.20, 0.21, 1.0); bg.inputs['Strength'].default_value = 1.0
    sun = bpy.data.lights.new('key', 'SUN'); sun.energy = 3.2; sun.angle = math.radians(3)
    so = bpy.data.objects.new('key', sun); sc.collection.objects.link(so)
    elev, az = math.radians(30), math.radians(40)
    Lto = Vector((-math.sin(az) * math.cos(elev), -math.cos(az) * math.cos(elev), math.sin(elev)))
    so.rotation_euler = (-Lto).to_track_quat('-Z', 'Y').to_euler()
    cam = bpy.data.cameras.new('cam'); cam.type = 'ORTHO'; cam.ortho_scale = max(PW, PH)
    co = bpy.data.objects.new('cam', cam); sc.collection.objects.link(co); sc.camera = co; co.rotation_euler = (math.pi / 2, 0.0, 0.0)
    mats = {k: material('m_' + k, v) for k, v in COL.items()}
    m_green, m_blue, m_red = material('m_nac', (0.10, 0.85, 0.25), 0.4, 2.0), material('m_hm08', (0.15, 0.35, 0.95), 0.4, 2.0), material('m_ansur', (0.85, 0.08, 0.08), 0.4, 1.5)
    m_orange, m_yellow = material('m_nac1', (0.95, 0.50, 0.05), 0.4, 2.0), material('m_fold', (0.95, 0.85, 0.10), 0.4, 1.5)
    m_cyan = material('m_fold_stand', (0.10, 0.80, 0.90), 0.4, 1.5)
    for n_ in sorted(set(PEOPLE + PROFILE)):
        name = next((f[:-11] for f in os.listdir(dl) if f.startswith(n_) and f.endswith('_marks.json')), None)
        if not name:
            print('anat8b_cutaway: no export for', n_, flush=True); continue
        mk = json.load(open(os.path.join(dl, name + '_marks.json'))); skin = load(dl, name, 'skin'); off = skin[0][:, :2].mean(axis=0)
        root = bpy.data.objects.new('root_' + name, None); sc.collection.objects.link(root)
        objs = {}
        for layer in COL:
            m = load(dl, name, layer)
            if m is not None:
                objs[layer] = mesh_object(f'{name}_{layer}', m[0], m[1], mats[layer], root, off)
        marks = [sphere(f'{name}_nac{i}', c, 0.007, m_green, root, off) for i, c in enumerate(mk['nacAnat'])] + \
                [sphere(f'{name}_hm08{i}', c, 0.0055, m_blue, root, off) for i, c in enumerate(mk['nipHm08'])] + \
                [sphere(f'{name}_nac1_{i}', c, 0.0055, m_orange, root, off) for i, c in enumerate(mk.get('nacAnat1') or [])]
        if True:                                      # the rod across the chest; ticks at the MCLs (front view only: the camera frame does not turn)
            rods = [rod(f'{name}_ansur', -0.24, 0.24, mk['ansurChestZ'], m_red, 0.0011)]
            ticks = [tick(f'{name}_mcl{i}', x - off[0], mk['ansurChestZ'], 0.03, m_red) for i, x in enumerate(mk.get('mclX') or [])]
            if mk.get('sex') == 'f' and mk.get('foldZ') is not None:
                ticks += [tick(f'{name}_fold{i}', x - off[0], mk['foldZ'], 0.016, m_yellow, 0.0016) for i, x in enumerate(mk.get('mclX') or [])]
            if mk.get('sex') == 'f' and mk.get('foldStandZ') is not None:
                ticks += [tick(f'{name}_foldS{i}', x - off[0], mk['foldStandZ'], 0.016, m_cyan, 0.0016) for i, x in enumerate(mk.get('mclX') or [])]
        allobs = list(objs.values()) + marks + rods + ticks
        views = VIEWS + (['profile'] if n_ in PROFILE else [])
        for v in views:
            root.rotation_euler = (0.0, 0.0, VIEW.get(v, 0.0))
            for pk, layers in (PANELS_PROFILE if v == 'profile' else PANELS).items():
                z = ZOOM.get(pk, 1.0); cam.ortho_scale = max(PW, PH) / z
                co.location = (0.0, -10.0, mk.get('nacZ', mk['centreZ']) if z > 1 else mk['centreZ'])
                for ob in allobs:
                    ob.hide_render = True
                for layer in layers:
                    if layer in objs:
                        objs[layer].hide_render = False
                    if layer == 'marks':
                        for ob in marks:
                            ob.hide_render = False
                for ob in rods:
                    ob.hide_render = False
                for ob in ticks:
                    ob.hide_render = (v != 'front')
                t = time.time(); tag = f'{name}_{v}_{pk}'; sc.render.filepath = os.path.join(OUT, 'stills', tag + '.png')
                bpy.ops.render.render(write_still=True)
                report['stills'].append({'tag': tag, 's': round(time.time() - t, 1)}); print(f'anat8b_cutaway: {tag} {time.time() - t:.1f} s', flush=True)
        for ob in allobs + [root]:
            bpy.data.objects.remove(ob, do_unlink=True)
    report.update(set=SET, samples=SAMPLES, res=[W, H], mmpx=MMPX, total_s=round(time.time() - t0, 1), device=getattr(sc.cycles, 'device', None))
    json.dump(report, open(os.path.join(OUT, 'anat8b_cutaway_report.json'), 'w'), indent=1)
    print('anat8b_cutaway: done', round(time.time() - t0, 1), 's', flush=True)

main()
