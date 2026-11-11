# NOSE AND MOUTH (round 7 studio, 8 Oct 2026): ONE farm GPU job = (1) the CURRENT person (latest:<name>, the studio default: every lane's
# current work) in Cycles, face and bust, through person7_job.py (person_job.py per person: the same chain every lane renders), and (2) the
# CLAY PANELS of our nose and mouth anatomy (lib/fx/anatomy/head/nose/, mouth/) on ANAT8-HEAD's skull, in Cycles, at the same four views
# per person: 'current' (the current person's face surface, hm08's mesh in the craniometric frame) | 'anatomy' (the skin our nose and lips
# make, joined to ANAT8-HEAD's skull-out face, unloaded and unwrapped: what the membrane will carry) | 'cutaway' (the person's left half
# without skin: bone, the cartilages, the alar lobules, the perioral parts; the right half the anatomy's skin). Our geometry only: no
# photograph, no scan, no atlas.
#   python3 videos/scripts/farm.py gpu --blender videos/blender/nosemouth_job.py --time 150 --mem 24 --no-wait --by NOSEMOUTH --title <t> -- \
#       --people L08_f24_hispanic,L22_f27_black,L03_m38_asian,L05_m59_black [--views front,q35,profile,basal] [--samples 128] [--px 900]
#       [--no-person] [--person-shots face:over:work:studio@5,bust:over:work:studio@5] [--person-samples 256]
#       [--no-clay] [--person-popts '<json>'] (makePerson's options for the person: iteration 2's wrap rides the caller's module hook,
#       '{"pelvis": {"module": "anatomy/head/nose/wrap.js", "fn": "nosemouth7"}}', until the person has a nosemouth slot)
#       [--person-before L08_f24_hispanic] (these people also WITHOUT the popts, same commit: the control, stills under before/)
#       [--wrap] (= --person-popts with the wrap's hook, without quoting a JSON through the farm's shell)
# Outputs ($GPU_OUT): clay/<name>_<panel>_<view>.png, person stills (person_job's tags: cyc_latest_<name>_<shot>_..png), nosemouth_job.json
# (steps, seconds, the build report per person). The runner composes the boards (review/studio_human_c8/after/nosemouth/measures/tools/).
import bpy, os, sys, json, math, subprocess, time, shutil
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def opt(k, d=None):
    return argv[argv.index('--' + k) + 1] if '--' + k in argv else d
HERE = os.path.dirname(os.path.abspath(__file__)); VIDEOS = os.path.dirname(HERE); WEB = os.path.join(VIDEOS, 'web')
OUT = os.path.abspath(os.environ.get('GPU_OUT') or os.path.join(VIDEOS, 'out', 'nosemouth_job'))
TMP = os.path.abspath(os.environ.get('GPU_TMP') or os.path.join(OUT, 'tmp'))
PEOPLE = [p for p in opt('people', 'L08_f24_hispanic,L22_f27_black,L03_m38_asian,L05_m59_black').split(',') if p]
VIEWS = [v for v in opt('views', 'front,q35,profile,basal').split(',') if v]
SAMPLES = int(opt('samples', '128')); PX = int(opt('px', '900'))
report = {'people': PEOPLE, 'views': VIEWS, 'steps': [], 'stills': []}

def run(cmd, cwd=WEB, env=None, fatal=True):
    t = time.time(); print('nosemouth_job $', ' '.join(cmd), flush=True)
    r = subprocess.run(cmd, cwd=cwd, env=env)
    report['steps'].append({'cmd': cmd[:4], 's': round(time.time() - t, 1), 'code': r.returncode})
    if r.returncode and fatal:
        raise SystemExit(f'nosemouth_job: step failed ({r.returncode}): {cmd[:4]}')
    return r.returncode

def ensure_deps():                                    # node's packages from the committed lock (person_job.py's rule)
    env = dict(os.environ); home = os.environ.get('GPU_JOB_HOME')
    if home:
        env.setdefault('npm_config_cache', os.path.join(home, 'npm-cache'))
    three = os.path.join(WEB, 'node_modules', 'three')
    if not all(os.path.exists(os.path.join(three, f)) for f in ('package.json', os.path.join('build', 'three.module.js'))):
        run(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], WEB, env)

def read_ply(path):                                   # nm_build.mjs's binary PLY: xyz float, label uchar; faces uchar 3 + int32 x 3
    b = open(path, 'rb').read(); end = b.index(b'end_header\n') + len(b'end_header\n'); head = b[:end].decode('latin1').split('\n')
    nv = int([l for l in head if l.startswith('element vertex')][0].split()[2]); nf = int([l for l in head if l.startswith('element face')][0].split()[2])
    V = np.frombuffer(b, dtype=np.dtype([('p', '<f4', 3), ('l', 'u1')]), count=nv, offset=end); F = np.frombuffer(b, dtype=np.dtype([('n', 'u1'), ('i', '<i4', 3)]), count=nf, offset=end + nv * 13)
    return V['p'].astype(np.float64), V['l'].astype(np.int32), F['i'].astype(np.int64)

def material(name, rgb, rough=0.5, sss=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*rgb, 1.0); b.inputs['Roughness'].default_value = rough
    for k in ('Specular IOR Level', 'Specular'):
        if k in b.inputs:
            b.inputs[k].default_value = 0.35; break
    return m

def to_blender(P):                                   # the craniometric frame (mm: x left, y up, z forward) -> Blender metres (X left, Y back, Z up)
    Q = np.empty_like(P); Q[:, 0] = P[:, 0] * 1e-3; Q[:, 1] = -P[:, 2] * 1e-3; Q[:, 2] = P[:, 1] * 1e-3; return Q

def mesh_object(name, P, T, mat, keep=None):
    if keep is not None:
        T = T[keep(P, T)]
    Q = to_blender(P)
    me = bpy.data.meshes.new(name); me.from_pydata(Q.tolist(), [], T.tolist()); me.validate(); me.update()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me); ob.data.materials.append(mat); bpy.context.scene.collection.objects.link(ob)
    return ob

def main():
    t0 = time.time(); os.makedirs(os.path.join(OUT, 'clay'), exist_ok=True); os.makedirs(TMP, exist_ok=True)
    ensure_deps()
    # (1) our anatomy, exported per person by node (no GL), then the clay panels
    ex = os.path.join(TMP, 'nm')
    if '--no-clay' in argv:
        return person(t0)
    run(['node', 'labs/nosemouth/nm_build.mjs', '--people', ','.join(PEOPLE), '--export', ex, '--out', os.path.join(OUT, 'nm_build_report.json')])
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'
    try:
        from gpujob import devices; devices.apply(sc)
    except Exception as e:
        print('nosemouth_job: gpujob.devices not applied:', e, flush=True)
    sc.cycles.samples = SAMPLES; sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
    sc.render.resolution_x = sc.render.resolution_y = PX; sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'; sc.render.film_transparent = False
    world = bpy.data.worlds.new('nm_world'); world.use_nodes = True; sc.world = world
    bg = world.node_tree.nodes.get('Background'); bg.inputs['Color'].default_value = (0.30, 0.30, 0.31, 1.0); bg.inputs['Strength'].default_value = 0.6
    # a portrait key: a soft sun up and to the camera's left (the studio's 'over' direction; ANAT8-BODY's clay strength), a dim fill from the right
    key = bpy.data.lights.new('key', 'SUN'); key.energy = 3.2; key.angle = math.radians(8)
    ko = bpy.data.objects.new('key', key); sc.collection.objects.link(ko)
    fill = bpy.data.lights.new('fill', 'SUN'); fill.energy = 0.7; fill.angle = math.radians(25)
    fo = bpy.data.objects.new('fill', fill); sc.collection.objects.link(fo)
    cam = bpy.data.cameras.new('cam'); cam.type = 'ORTHO'; co = bpy.data.objects.new('cam', cam); sc.collection.objects.link(co); sc.camera = co
    M = {'clay': material('clay', (0.60, 0.57, 0.53)), 'clay_cur': material('clay_cur', (0.52, 0.53, 0.55)), 'bone': material('bone', (0.80, 0.76, 0.66), 0.6),
         'cart': material('cart', (0.50, 0.66, 0.78), 0.35), 'lobule': material('lobule', (0.88, 0.70, 0.32), 0.5), 'muscle': material('muscle', (0.55, 0.17, 0.14), 0.45),
         'gland': material('gland', (0.86, 0.52, 0.55), 0.45), 'teeth': material('teeth', (0.93, 0.91, 0.84), 0.3)}
    for nm in PEOPLE:
        d = os.path.join(ex, nm)
        if not os.path.exists(os.path.join(d, 'frame.json')):
            print('nosemouth_job: no export for', nm, flush=True); continue
        fr = json.load(open(os.path.join(d, 'frame.json'))); sk = fr['skull']; nose = fr['nose']['lm']; mouth = fr['mouth']['lm']
        objs = {}
        def load(key, fname, mat, keep=None):
            p = os.path.join(d, fname)
            if not os.path.exists(p):
                return None
            P, L, T = read_ply(p); ob = mesh_object(f'{nm}_{key}', P, T, mat, keep); objs[key] = ob; return ob
        right = lambda P, T: P[T].mean(axis=1)[:, 0] < 0.3       # the person's right half (x < 0): the cutaway keeps the skin there
        cur = load('current', 'current.ply', M['clay_cur'])
        if cur is not None:                          # hm08's head as the person's export carries it: Catmull-Clark (person_job --subdiv 1; 2 here for the clay)
            sm = cur.modifiers.new('subd', 'SUBSURF'); sm.levels = 2; sm.render_levels = 2
        load('skin_nm', 'skin_nm.ply', M['clay']); load('skin_face', 'skin_face.ply', M['clay'])
        load('skin_nm_half', 'skin_nm.ply', M['clay'], right); load('skin_face_half', 'skin_face.ply', M['clay'], right)
        load('bone', 'bone.ply', M['bone']); load('cart', 'nose_cart.ply', M['cart']); load('lobule', 'nose_lobule.ply', M['lobule'])
        # the perioral parts by label (6 muscle, 12 glands and mucosa)
        pm = os.path.join(d, 'mouth_parts.ply')
        if os.path.exists(pm):
            P, L, T = read_ply(pm); lab = L[T].max(axis=1)
            for key, lv, mat in (('muscle', 6, M['muscle']), ('gland', 12, M['gland'])):
                sel = T[lab == lv]
                if len(sel):
                    objs['mouth_' + key] = mesh_object(f'{nm}_mouth_{key}', P, sel, mat)
        PANELS = {'current': ['current'], 'anatomy': ['skin_nm', 'skin_face'], 'cutaway': ['skin_nm_half', 'skin_face_half', 'bone', 'cart', 'lobule', 'mouth_muscle', 'mouth_gland']}
        # framing: the nose and the mouth with the radix and the chin (orthographic; the same scale every panel and view)
        yTop, yBot = sk['N'][1] + 6, sk['Me'][1] - 6; cy = 0.5 * (yTop + yBot); scale = (yTop - yBot) * 1.08e-3
        tz = 0.5 * (nose['prn'][2] + sk['ANS'][2]) if nose.get('prn') else sk['ANS'][2] + 10
        target = Vector((0.0, -tz * 1e-3, cy * 1e-3)); cam.ortho_scale = scale
        VIEW = {'front': (0.0, 0.0), 'q35': (35.0, 0.0), 'profile': (90.0, 0.0), 'basal': (20.0, -58.0)}
        for view in VIEWS:
            yaw, pitch = VIEW[view]; a, b = math.radians(yaw), math.radians(pitch)
            # the camera on a sphere round the target: yaw toward the person's left (+X), pitch below (negative: from beneath)
            dirv = Vector((math.sin(a) * math.cos(b), -math.cos(a) * math.cos(b), math.sin(b)))
            co.location = target + dirv * 0.8; co.rotation_euler = (-dirv).to_track_quat('-Z', 'Y').to_euler()
            cam.clip_start, cam.clip_end = 0.05, 2.0
            if view == 'basal':
                cam.ortho_scale = scale * 0.72; co.location = Vector((0.0, -tz * 1e-3, (nose['prn'][1] if nose.get('prn') else cy) * 1e-3)) + dirv * 0.8
            else:
                cam.ortho_scale = scale
            # the key above and to the camera's left, the fill to its right (both turn with the camera)
            right_v = dirv.cross(Vector((0, 0, 1))).normalized() if abs(dirv.z) < 0.99 else Vector((1, 0, 0))
            kd = (dirv * 0.75 - right_v * 0.55 + Vector((0, 0, 0.55))).normalized(); fd = (dirv * 0.8 + right_v * 0.6 - Vector((0, 0, 0.1))).normalized()
            ko.location = target + kd * 0.9; ko.rotation_euler = (-kd).to_track_quat('-Z', 'Y').to_euler()
            fo.location = target + fd * 1.1; fo.rotation_euler = (-fd).to_track_quat('-Z', 'Y').to_euler()
            for panel, keys in PANELS.items():
                for k, ob in objs.items():
                    ob.hide_render = k not in keys
                sc.render.filepath = os.path.join(OUT, 'clay', f'{nm}_{panel}_{view}.png')
                t = time.time(); bpy.ops.render.render(write_still=True)
                report['stills'].append({'name': nm, 'panel': panel, 'view': view, 's': round(time.time() - t, 1)})
                print(f'nosemouth_job: {nm} {panel} {view} {time.time() - t:.1f} s', flush=True)
        for ob in list(objs.values()):
            bpy.data.objects.remove(ob, do_unlink=True)
        json.dump(report, open(os.path.join(OUT, 'nosemouth_job.json'), 'w'), indent=1)
    shutil.rmtree(ex, ignore_errors=True)
    person(t0)

def person(t0):
    # (2) the current person in Cycles (person7_job.py: person_job.py per person); --person-popts for the change, --person-before the control
    if '--no-person' not in argv:                     # after the clay (the new work renders first if the job runs long)
        shots = opt('person-shots', 'face:over:work:studio@5,bust:over:work:studio@5')
        def p7(who, out, popts):
            cmd = [bpy.app.binary_path, '-b', '--factory-startup', '-noaudio', '--python-exit-code', '1', '--python', os.path.join(HERE, 'person7_job.py'), '--',
                   '--who', ','.join(who), '--shots', shots, '--samples', opt('person-samples', '256'), '--scale', '1', '--quality', 'farm', '--sss-thick', 'auto', '--uv-fix',
                   '--work', os.path.join(TMP, 'person'), '--out', out] + (['--popts', popts] if popts else [])
            os.makedirs(out, exist_ok=True); run(cmd, cwd=VIDEOS, fatal=False); shutil.rmtree(os.path.join(TMP, 'person'), ignore_errors=True)
        # --wrap: the person WITH the nose-and-mouth wrap (no quoting through the farm's shell): the caller's module hook of the pelvis slot
        WRAP = '{"pelvis":{"module":"anatomy/head/nose/wrap.js","fn":"nosemouth7"}}'
        p7(PEOPLE, OUT, WRAP if '--wrap' in argv else opt('person-popts'))
        before = [p for p in (opt('person-before') or '').split(',') if p]
        if before:
            p7(before, os.path.join(OUT, 'before'), None)
    report['s'] = round(time.time() - t0, 1); json.dump(report, open(os.path.join(OUT, 'nosemouth_job.json'), 'w'), indent=1)
    print('nosemouth_job done', flush=True)

main()
