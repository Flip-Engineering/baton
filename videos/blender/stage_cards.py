# LIGHT5 (round 5): the GREY CARD and SKIN SWATCH plate of a stage in Cycles, the twin of web/labs/human8/lab_light5.html (engine).
#   blender -b --factory-startup -noaudio -P videos/blender/stage_cards.py -- --stage studio@5 --out <dir> [--samples 64] [--w 1400 --h 440]
#       [--threads 2]
# The stage from stages.json (stage_scene.py: the same set, key, environment file and lamps the engine builds), a row of matte cards at
# face height where the people stand, facing the lens (the lab's CARD record), the same camera. Exposure: the 18 % card at 0.18
# scene-linear from the stage's card illuminant (stages.json 'cards', wb.js) and stage_scene's unit scale, the same rule as the engine;
# shown through lib/fx/light/display.js (acp_display.py) with the record's white balance. Writes <out>/cyc_<stage>.png + .json (the mean
# linear rgb of each card's centre before the display: what the renderer delivered) and removes its .exr.
import sys, os, json, math, time
import numpy as np
import bpy
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stage_scene
from person_scene import mat_new
from acp_display import acp_display, lottes_params, write_png, read_exr_bpy

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def opt(k, d=None, cast=str):
    return cast(argv[argv.index('--' + k) + 1]) if '--' + k in argv else d
NAME, OUT = opt('stage', 'studio@5'), opt('out', '.')
SPP, W, H, THREADS = opt('samples', 64, int), opt('w', 1400, int), opt('h', 440, int), opt('threads', 2, int)
os.makedirs(OUT, exist_ok=True)
# the lab's record (lab_light5.js SWATCHES / CARD)
SWATCHES = [('grey18', (0.18, 0.18, 0.18)), ('white90', (0.9, 0.9, 0.9)), ('black04', (0.04, 0.04, 0.04)),
            ('skin_L12', (0.6057, 0.4399, 0.3634)), ('skin_L20', (0.5821, 0.4131, 0.3302)), ('skin_L08', (0.4549, 0.2885, 0.1863)),
            ('skin_L21', (0.1715, 0.0838, 0.0412)), ('skin_L22', (0.092, 0.0487, 0.0335))]
CARD = dict(y=1.55, size=0.13, pitch=0.16, cam=(0, 1.55, 4.0), fov=18)
B = lambda v: Vector((v[0], -v[2], v[1]))

t0 = time.time()
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
parts = {'ground': None}
STG = stage_scene.apply(NAME, parts)
coll = bpy.data.collections.new('cards'); sc.collection.children.link(coll)
n = len(SWATCHES)
for i, (nm, a) in enumerate(SWATCHES):
    bpy.ops.mesh.primitive_plane_add(size=CARD['size'])
    ob = bpy.context.active_object; ob.name = nm
    ob.location = B(((i - (n - 1) / 2) * CARD['pitch'], CARD['y'], 0.0)); ob.rotation_euler = (math.radians(90), 0, 0)
    for c0 in ob.users_collection:
        c0.objects.unlink(ob)
    coll.objects.link(ob)
    m, nt, out = mat_new('card_' + nm); p = nt.nodes.new('ShaderNodeBsdfPrincipled')
    p.inputs['Base Color'].default_value = tuple(a) + (1,); p.inputs['Roughness'].default_value = 1.0; p.inputs['Metallic'].default_value = 0.0
    for k in ('Specular IOR Level', 'Specular'):
        if k in p.inputs:
            p.inputs[k].default_value = 0.0; break
    nt.links.new(p.outputs['BSDF'], out.inputs['Surface']); ob.data.materials.append(m)
cd = bpy.data.cameras.new('cam'); cd.sensor_fit = 'VERTICAL'; cd.lens_unit = 'FOV'; cd.angle = math.radians(CARD['fov'])
cam = bpy.data.objects.new('cam', cd); sc.collection.objects.link(cam); cam.location = B(CARD['cam']); cam.rotation_euler = (math.radians(90), 0, 0); sc.camera = cam
sc.render.engine = 'CYCLES'; cy = sc.cycles; cy.device = 'CPU'; cy.samples = SPP; cy.use_denoising = True
sc.render.threads_mode = 'FIXED'; sc.render.threads = THREADS
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W, H, 100
sc.view_settings.view_transform = 'Standard'; sc.view_settings.look = 'None'
sc.render.image_settings.file_format = 'OPEN_EXR'; sc.render.image_settings.color_depth = '32'
exr = os.path.join(OUT, f'_cards_{NAME}.exr'); sc.render.filepath = exr
tr = time.time(); bpy.ops.render.render(write_still=True); tr = time.time() - tr
px = read_exr_bpy(exr)[..., :3]; os.remove(exr)
# exposure: the grey card at 0.18 (its radiance 0.18 E / pi, in stage_scene's units: cd/m2 x C)
rec = json.load(open(os.path.join(stage_scene.ASSETS, 'stages.json')))
E = rec['cards'][NAME]['rgb']; EY = 0.2126 * E[0] + 0.7152 * E[1] + 0.0722 * E[2]
gain = math.pi / (EY * STG['C'])
wb = STG['record']['wb']
write_png(os.path.join(OUT, f'cyc_{NAME.replace("@", "_r")}.png'), acp_display(px * gain, lottes_params(), wb))
# each card's centre (the middle 60 %), projected
from bpy_extras.object_utils import world_to_camera_view
res = {}
for i, (nm, a) in enumerate(SWATCHES):
    c = ((i - (n - 1) / 2) * CARD['pitch'], CARD['y']); h = CARD['size'] * 0.3
    uv = [world_to_camera_view(sc, cam, B((c[0] + dx, c[1] + dy, 0.0))) for dx, dy in ((-h, -h), (h, h))]
    x0, x1 = sorted(int(round(u.x * W)) for u in uv); y0, y1 = sorted(int(round((1 - u.y) * H)) for u in uv)
    lin = px[y0:y1, x0:x1].reshape(-1, 3).mean(0) * gain
    res[nm] = dict(albedo=a, linear=[round(float(v), 5) for v in lin], box=[x0, y0, x1, y1])
# the residual Cycles adds over the record's card illuminant (the set's real bounce: the earth, the boards, the wall): per-channel gains
# that bring the measured grey card (after the record's balance) to neutral, kept in web/assets/stage/cycles_cards.json for
# render_person.py (applied on '@5' stages only, --no-card-residual to skip). --residual writes it.
g = np.array(res['grey18']['linear']); W3 = np.array(wb, float).reshape(3, 3); gb = W3 @ g; Yg = 0.2126 * gb[0] + 0.7152 * gb[1] + 0.0722 * gb[2]
resid = [round(float(Yg / max(v, 1e-9)), 5) for v in gb]
if '--residual' in argv:
    pth = os.path.join(stage_scene.ASSETS, 'cycles_cards.json'); R = json.load(open(pth)) if os.path.exists(pth) else {'note': 'blender/stage_cards.py --residual: per-channel gains over the record balance that make the 18 % card neutral in Cycles (the set bounce the record does not model)', 'stages': {}}
    R['stages'][NAME] = dict(gains=resid, samples=SPP); json.dump(R, open(pth, 'w'), indent=1)
json.dump(dict(stage=NAME, W=W, H=H, samples=SPP, residual=resid, render_s=round(tr, 1), total_s=round(time.time() - t0, 1), gain=gain, C=STG['C'], cardLux=E, wb=wb, cards=res),
          open(os.path.join(OUT, f'cyc_{NAME.replace("@", "_r")}.json'), 'w'), indent=1)
print('cards', NAME, json.dumps({k: v['linear'] for k, v in res.items()}))
