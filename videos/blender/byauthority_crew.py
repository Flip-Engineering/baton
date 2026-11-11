# BY AUTHORITY c20: the 2026 crew in ONE Cycles scene (run by byauthority_crew_job.py, a child Blender per framing).
#   blender -b --factory-startup [--python gpujob/boot.py] [--python eye7_cycles.py] --python videos/blender/byauthority_crew.py -- \
#       --spec <crew_spec.json: {people: [{who, export, maps}], stage}> --out DIR --tag crew_yard [--samples 384] [--res 2100x1500] [--frame plate|wide]
# Each exported worker is built by person_scene.build (the same build render_person.py uses), parented to an empty and set in a two-row group
# on the yard stage (stage_scene.apply: its sun, sky, earth and plaster wall; one ground, one sun for all). The camera stands a little above the
# heads, as the Pathe camera stood over the seated crowd in 1919: a 70 mm lens at about 4 m, f/8. Exposure is metered on the faces (render_person's
# rule: the lit side of the faces, p75, at the skins' own reflectance), the picture shown through the studio's display (acp_display), white
# balanced on the stage's grey card. Every worker's skin is checked in the still from the object-index pass (the vanishing skin, person_guard):
# a still that lost one is rendered again, then pre-diced.
import sys, os, time, json, math
import numpy as np
import bpy
from mathutils import Matrix, Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import person_scene as S
import stage_scene
from acp_display import acp_display, lottes_params, write_png, read_exr_bpy

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def opt(k, d=None, cast=str):
    return cast(argv[argv.index('--' + k) + 1]) if '--' + k in argv else d
SPEC = json.load(open(opt('spec')))
OUT = opt('out'); os.makedirs(OUT, exist_ok=True)
TAG = opt('tag', 'crew'); SAMPLES = opt('samples', 384, int); FRAME = opt('frame', 'plate')
W, H = [int(v) for v in opt('res', '2100x1500').split('x')]
STAGE = SPEC.get('stage') or 'yard@5'
t0 = time.time()
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene

# the places (Blender: x right, y away from the camera, z up; a worker faces -y): three behind, two in front between them; each turned a few
# degrees toward the middle, as people stand for a photograph without being arranged
PLACES = [(-0.60, 0.50, 9.0), (0.02, 0.62, 0.0), (0.62, 0.46, -8.0), (-0.31, -0.08, 6.0), (0.33, -0.12, -7.0), (-0.95, 0.10, 14.0), (0.97, 0.06, -13.0)]
people = []
for i, p in enumerate(SPEC['people'][:len(PLACES)]):
    before = set(bpy.data.collections)
    pp, parts = S.build(p['export'], p['maps'], light='sun', register=None, hair_density=1.0, sss=None, seed=1 + i)
    coll = [c for c in bpy.data.collections if c not in before]
    coll = coll[0] if coll else None
    if parts.get('ground') is not None and i > 0:
        bpy.data.objects.remove(parts['ground'], do_unlink=True); parts['ground'] = None
    x, y, yaw = PLACES[i]
    rig = bpy.data.objects.new(f'worker{i}', None); sc.collection.objects.link(rig)
    rig.location = (x, y, 0.0); rig.rotation_euler = (0.0, 0.0, math.radians(yaw))
    bpy.context.view_layer.update()
    for ob in (list(coll.objects) if coll else []):
        if ob.type == 'LIGHT' or ob is parts.get('ground'):
            continue
        ob.parent = rig                                          # the empty's transform applies to the built (world-placed) objects as they stand
    people.append(dict(who=p['who'], pp=pp, parts=parts, rig=rig, place=PLACES[i]))
    print(f'crew: built {p["who"]} at {PLACES[i]} ({time.time() - t0:.0f} s)', flush=True)
# one stage for all: apply() takes the first worker's ground and every sun the builds added
STG = stage_scene.apply(STAGE, people[0]['parts'])
for ob in list(sc.objects):
    if ob.type == 'LIGHT' and ob.name.startswith('sun'):
        bpy.data.objects.remove(ob, do_unlink=True)
bpy.context.view_layer.update()
try:
    import person_guard
    person_guard.install()
except Exception as e:   # the guard never fails a render
    print('person_guard: error', repr(e)[:300], flush=True); person_guard = None

def world_head(P):
    return P['rig'].matrix_world @ Vector(P['pp'].m['landmarks']['head'])

# ---- the camera: above the heads, looking a little down into the group (the 1919 camera over the seated crowd)
heads = [world_head(P) for P in people]
cz = float(np.mean([h.z for h in heads]))
if FRAME == 'wide':
    focal, eye, aim = 50.0, Vector((0.0, -4.6, cz + 0.42)), Vector((0.0, 0.25, cz - 0.42))
else:
    focal, eye, aim = 70.0, Vector((0.0, -4.0, cz + 0.36)), Vector((0.0, 0.25, cz - 0.30))
cd = bpy.data.cameras.new('cam'); cd.sensor_fit = 'HORIZONTAL'; cd.sensor_width = 36.0; cd.lens = focal; cd.clip_start = 0.05; cd.clip_end = 500
cam = bpy.data.objects.new('cam', cd); sc.collection.objects.link(cam)
cam.location = eye; cam.rotation_euler = (aim - eye).to_track_quat('-Z', 'Y').to_euler()
cd.dof.use_dof = True; cd.dof.focus_distance = (Vector((0.0, 0.25, cz)) - eye).length; cd.dof.aperture_fstop = 8.0
sc.camera = cam
bpy.context.view_layer.update()

# ---- Cycles (render_person's settings)
sc.render.engine = 'CYCLES'; cy = sc.cycles; cy.device = 'GPU'
cy.samples = SAMPLES; cy.use_adaptive_sampling = True; cy.adaptive_threshold = 0.01; cy.adaptive_min_samples = 32
cy.use_denoising = True
try:
    cy.denoiser = 'OPENIMAGEDENOISE'
except Exception:
    pass
cy.denoising_input_passes = 'RGB_ALBEDO_NORMAL'; cy.denoising_prefilter = 'ACCURATE'
cy.max_bounces = 12; cy.diffuse_bounces = 4; cy.glossy_bounces = 4; cy.transmission_bounces = 8; cy.transparent_max_bounces = 16
cy.caustics_reflective = False; cy.caustics_refractive = False; cy.blur_glossy = 0.5
sc.cycles_curves.shape = 'THICK'; sc.cycles_curves.subdivisions = 2
try:
    import light5
    light5.quality(sc, 'farm', SAMPLES)
except Exception as e:
    print('crew: light5 quality not applied', repr(e)[:200], flush=True)
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W, H, 100
sc.view_settings.view_transform = 'Standard'; sc.view_settings.look = 'None'; sc.view_settings.exposure = 0.0
sc.render.image_settings.file_format = 'OPEN_EXR'; sc.render.image_settings.color_depth = '32'; sc.render.image_settings.exr_codec = 'ZIP'

def render_to(path, w, h, spp, transparent=False, denoise=True):
    sc.render.resolution_x, sc.render.resolution_y = w, h
    cy.samples = spp; cy.use_denoising = denoise; sc.render.film_transparent = transparent
    sc.render.filepath = path
    t = time.time(); bpy.ops.render.render(write_still=True); return time.time() - t

def project(p):
    from bpy_extras.object_utils import world_to_camera_view
    v = world_to_camera_view(sc, cam, Vector(p)); return v.x, 1 - v.y

# ---- the fine tier pre-diced for this camera, per worker (person_guard.dice_for_camera)
dice = {}
for P in people:
    if P['parts'].get('fine7') and person_guard:
        try:
            dice[P['who']] = person_guard.dice_for_camera(sc, cam, P['parts']['body'], tuple(world_head(P)), W, H, P['parts']['fine7'])
        except Exception as e:
            dice[P['who']] = {'error': repr(e)[:200]}
print('crew dice:', json.dumps(dice), flush=True)

# ---- exposure: the lit side of the faces (p75 of their luminance) at the skins' reflectance (render_person's meter, over every face)
hide = [o for o in sc.objects if o.type == 'CURVES' or o in STG['set'] or any(o in P['parts']['garments'] for P in people)]
for o in hide:
    o.hide_render = True
mw, mh = max(96, W // 4), max(96, H // 4)
render_to(os.path.join(OUT, f'_{TAG}_meter.exr'), mw, mh, 32, transparent=True, denoise=False)
px = read_exr_bpy(os.path.join(OUT, f'_{TAG}_meter.exr')); os.remove(os.path.join(OUT, f'_{TAG}_meter.exr'))
for o in hide:
    o.hide_render = False
Ys, skinYs = [], []
for P in people:
    hd = np.array(world_head(P)); R = P['rig'].matrix_world.to_3x3()
    box = [hd + np.array(R @ Vector((dx, dy, dz))) for dx in (-0.075, 0.075) for dy in (-0.14, -0.02) for dz in (-0.06, 0.09)]
    uv = np.array([project(b) for b in box]); x0, y0 = (uv.min(0) * [mw, mh]).astype(int); x1, y1 = (uv.max(0) * [mw, mh]).astype(int)
    reg = px[max(0, y0):max(0, y1), max(0, x0):max(0, x1)]
    if reg.size == 0:
        continue
    a = reg[..., 3] > 0.99
    Y = (0.2126 * reg[..., 0] + 0.7152 * reg[..., 1] + 0.0722 * reg[..., 2])[a]
    if Y.size > 12:
        Ys.append(float(np.percentile(Y, 75)))
        sb = (P['pp'].m.get('skin') or {}).get('base') or [0.2, 0.12, 0.08]
        skinYs.append(0.2126 * sb[0] + 0.7152 * sb[1] + 0.0722 * sb[2] + 0.03)
stops = float(np.clip(np.median([math.log2(s / y) for s, y in zip(skinYs, Ys)]), -12, 12)) if Ys else 0.0
meter = dict(p75=Ys, skinY=skinYs, stops=stops)
print('crew meter', json.dumps(meter), flush=True)
gain = 2 ** stops
wb = STG['record']['wb']
if (STG['record'].get('camera') or {}).get('wb') == 'card':
    _cc = os.path.join(stage_scene.ASSETS, 'cycles_cards.json')
    _r = (json.load(open(_cc))['stages'].get(STAGE) if os.path.exists(_cc) else None)
    if _r:
        wb = (np.diag(_r['gains']) @ np.array(wb, float).reshape(3, 3)).ravel().tolist()

# ---- the still, every worker's skin checked in it (object-index pass: worker i's body is pass index 10 + i)
for vl in sc.view_layers:
    vl.use_pass_object_index = True
for i, P in enumerate(people):
    P['parts']['body'].pass_index = 10 + i

def skin_counts():
    if not person_guard:
        return None
    rr = bpy.data.images.get('Render Result'); path = os.path.join(OUT, f'_{TAG}_idx.exr')
    s = sc.render.image_settings; old = {k: getattr(s, k, None) for k in ('media_type', 'file_format', 'color_depth', 'exr_codec')}
    try:
        if hasattr(s, 'media_type'):
            s.media_type = 'MULTI_LAYER_IMAGE'
        s.file_format = 'OPEN_EXR_MULTILAYER'; s.color_depth = '32'; s.exr_codec = 'NONE'
        rr.save_render(filepath=path, scene=sc)
        chans, how = person_guard.read_exr(path, want=lambda n: 'IndexOB' in n)
        idx = next(iter(chans.values())) if chans else None
        return None if idx is None else [int((np.abs(idx - (10 + i)) < 0.5).sum()) for i in range(len(people))]
    except Exception as e:
        print('crew: skin check unavailable', repr(e)[:200], flush=True); return None
    finally:
        for k in ('media_type', 'file_format', 'color_depth', 'exr_codec'):
            if old[k] is not None:
                try:
                    setattr(s, k, old[k])
                except Exception:
                    pass
        try:
            os.remove(path)
        except OSError:
            pass

exr = os.path.join(OUT, TAG + '.exr'); attempts = []
for step in ('first', 'again', 'predice'):
    if step == 'predice' and person_guard:
        attempts.append({'predice': [person_guard.predice(P['parts']['body']) for P in people]})
    tr = render_to(exr, W, H, SAMPLES, transparent=False, denoise=True)
    n = skin_counts(); attempts.append({'step': step, 'render_s': round(tr, 1), 'skinPx': n})
    print('crew still', json.dumps(attempts[-1]), flush=True)
    if n is None or all(c > 200 for c in n):
        break
px = read_exr_bpy(exr)[..., :3] * gain
write_png(os.path.join(OUT, TAG + '.png'), acp_display(px, lottes_params(), wb))
os.remove(exr)
info = dict(tag=TAG, frame=FRAME, stage=STAGE, W=W, H=H, samples=SAMPLES, focal=focal, people=[dict(who=P['who'], place=P['place']) for P in people],
            meter=meter, dice=dice, attempts=attempts, blender=bpy.app.version_string, total_s=round(time.time() - t0, 1))
json.dump(info, open(os.path.join(OUT, TAG + '.json'), 'w'), indent=1)
print('done', json.dumps(info), flush=True)
