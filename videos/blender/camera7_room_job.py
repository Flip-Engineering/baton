# CAMERA7 c4: THE ROOM IN CYCLES, WITHOUT A PERSON. A window@7 stage (blender/stage_scene.py: the window as one emitter, the furniture as real geometry) with a STAND-IN for the sitter (two
# ellipsoids in a mid-tone skin albedo on the seat's mark: the same stand-in labs/human8/lab_room7.js draws), rendered from the views the engine's lab draws, metered on the stand-in's head,
# through camera7's display. It exists to look at what the person plates cannot show: the furniture lit by the window (the shelf's interior, the casing's shadow, the cloth's folds, the leaves),
# the sitter's soft shadow on the wall and the clear zone behind the seat.
#   sh videos/scripts/gpu_job.sh blender videos/blender/camera7_room_job.py --id room7 --gpus 1 --time 60 --mem 16 -- [--stage window@7] [--views wide,left,right,face30,bust35,bust-35] [--samples 128] [--control wide]
# c4 iteration 2: the portrait views are the STUDIO'S PORTRAIT CAMERAS (<shot><azimuth>: face30, bust35, bust-35, full35 ...; the cameras are read from the stage record's set.room.seat.cameras, which
# lib/fx/stage/frusta.js derived the seat from, so the views and the seat can't disagree), at camera7's lens for the shot and the plate size of the shot; the wide views also SHOW THE WINDOW (the emitter is
# camera-visible there; it never is in a portrait view: the room test shows no portrait camera sees it).
# Writes $GPU_OUT/room7_<view>.png (the display), room7_<view>_control.png (the same view with the furniture hidden: what the room's geometry adds), room7.json (the meter, the settings).
import sys, os, time, json, math
import numpy as np
import bpy
from mathutils import Matrix, Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import person_scene as S
import stage_scene, camera7_stage, camera7_display as c7d, light5
from acp_display import write_png, read_exr_bpy

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def opt(k, d=None, cast=str):
    return cast(argv[argv.index('--' + k) + 1]) if '--' + k in argv else d
STAGE, VIEWS, SAMPLES = opt('stage', 'window@7'), opt('views', 'wide,left,right,face30,bust35,bust-35').split(','), opt('samples', 128, int)
CONTROL = [v for v in opt('control', 'wide').split(',') if v]
OUT = opt('out', os.environ.get('GPU_OUT') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'out', 'room7_job')); os.makedirs(OUT, exist_ok=True)
W, H = opt('w', 1600, int), opt('h', 900, int)
FOCAL, FSTOP = opt('lens', 35.0, float), opt('fstop', 8.0, float)
t0 = time.time()
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
STG = stage_scene.apply(STAGE, {'ground': None})
B = stage_scene.B     # three's frame -> Blender's

# ---- the stand-in: a 1.7 m figure on the seat's mark (labs/human8/lab_room7.js draws the same two ellipsoids)
SKIN = (0.36, 0.22, 0.16)
m, nt, out = S.mat_new('standin'); p = nt.nodes.new('ShaderNodeBsdfPrincipled'); p.inputs['Base Color'].default_value = SKIN + (1,); p.inputs['Roughness'].default_value = 0.6
nt.links.new(p.outputs['BSDF'], out.inputs['Surface'])
def ellipsoid(name, c, r):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=32, radius=1.0, location=tuple(B(c)))
    ob = bpy.context.active_object; ob.name = name; ob.scale = (r[0], r[2], r[1]); ob.data.materials.append(m)
    for q in ob.data.polygons: q.use_smooth = True
    return ob
body = ellipsoid('standin_body', (0, 1.0, 0), (0.2, 0.62, 0.17)); head = ellipsoid('standin_head', (0, 1.6, 0), (0.095, 0.12, 0.105))

# ---- the cameras (three's frame in, Blender's record out): the same views as lab_room7.js
CAMS = (((STG['record'].get('set') or {}).get('room') or {}).get('seat') or {}).get('cameras') or {}    # the portrait cameras the seat was derived from (frusta.js PORTRAIT_SHOTS)
def portrait_view(name):
    """'bust-35' -> the portrait camera of that shot swung round the sitter by that angle (negative = camera left), as frusta.js shotCamera7 places it; None for any other name"""
    import re
    m = re.match(r'^([a-z]+)(-?\d+)$', name)
    if not m or m.group(1) not in CAMS: return None
    c, a = CAMS[m.group(1)], math.radians(int(m.group(2)))
    return dict(shot=m.group(1), pos=(c['d'] * math.sin(a), c['y'], c['d'] * math.cos(a)), at=(0, c['aimY'], 0), fov=c['vfov'], aspect=c['aspect'], lens=c['lens'])
def look(pos, at, fov, name, W=None, H=None, lens=None):
    p, a = B(pos), B(at); fwd = (a - p).normalized(); q = fwd.to_track_quat('-Z', 'Y')
    Mw = Matrix.Translation(p) @ q.to_matrix().to_4x4()
    focal, fstop = (c7d.CAMERA7_LENS[lens]['focal'], c7d.CAMERA7_LENS[lens]['fstop']) if lens else (FOCAL, FSTOP)   # a portrait view is camera7's own lens for the shot (85 mm f/5.6 for a face or a bust: the wall behind the head is far out of focus); the room views a 35 mm at f/8
    return dict(matrix=np.array(Mw).T.flatten().tolist(), fovY=fov, W=W or globals()['W'], H=H or globals()['H'], lens=dict(focal=focal, fstop=fstop, focus=float((a - p).length)))
VIEWDEF = {
    'wide': ((0, 1.6, 5.4), (0, 2.3, -3.2), 62), 'left': ((-1.2, 1.5, 3.6), (-3.6, 1.45, -3.2), 34), 'right': ((1.2, 1.5, 3.6), (3.6, 1.45, -3.2), 34),
}
# ---- render settings (render_person.py's)
sc.render.engine = 'CYCLES'; cy = sc.cycles; cy.device = 'GPU'; cy.samples = SAMPLES; cy.use_adaptive_sampling = True; cy.adaptive_threshold = 0.01
cy.max_bounces = 12; cy.diffuse_bounces = 4; cy.glossy_bounces = 4; cy.transmission_bounces = 8; cy.caustics_reflective = False; cy.caustics_refractive = False; cy.blur_glossy = 0.5
print('light5 quality', light5.quality(sc, 'farm', SAMPLES))
sc.render.film_transparent = False
sc.view_settings.view_transform = 'Standard'; sc.view_settings.look = 'None'; sc.view_settings.exposure = 0.0
sc.render.image_settings.file_format = 'OPEN_EXR'; sc.render.image_settings.color_depth = '32'; sc.render.image_settings.exr_codec = 'ZIP'
def render_to(path, w, h, spp, transparent=False, denoise=True):
    sc.render.resolution_x, sc.render.resolution_y = w, h; cy.samples = spp; cy.use_denoising = denoise; sc.render.film_transparent = transparent; sc.render.filepath = path
    t = time.time(); bpy.ops.render.render(write_still=True); return time.time() - t
def use_camera(rec, name='cam'):
    for o in [o for o in sc.objects if o.type == 'CAMERA']:
        bpy.data.objects.remove(o, do_unlink=True)
    cam = S.camera_from(rec, name); sc.camera = cam; return cam

# ---- exposure: the studio's rule (render_person.py): the lit side of the face (p75 of its luminance) lands at the skin's reflectance (+ 0.03 for the surface); here the face is the stand-in's head,
# metered once from the face camera at 30 degrees on a quarter-size render with only the stand-in visible; the camera's skin-zone compensation follows from the same skinY
skinY = 0.2126 * SKIN[0] + 0.7152 * SKIN[1] + 0.0722 * SKIN[2] + 0.03
PM = portrait_view('face30'); rec_m = look(PM['pos'], PM['at'], PM['fov'], 'meter', 1080, 1350, PM['lens']); cam = use_camera(rec_m, 'meter')
hide = [o for o in STG['set']]
for o in hide: o.hide_render = True
mw, mh = 1080 // 4, 1350 // 4; tm = render_to(os.path.join(OUT, '_meter.exr'), mw, mh, 24, transparent=True, denoise=False)
for o in hide: o.hide_render = False
px = read_exr_bpy(os.path.join(OUT, '_meter.exr')); os.remove(os.path.join(OUT, '_meter.exr'))
from bpy_extras.object_utils import world_to_camera_view
def project(pw):
    v = world_to_camera_view(sc, cam, Vector(pw)); return v.x, 1 - v.y
hc = B((0, 1.6, 0)); box = [hc + Vector((dx, dy, dz)) for dx in (-0.08, 0.08) for dy in (-0.09, 0.09) for dz in (-0.08, 0.08)]
uv = np.array([project(q) for q in box]); x0, y0 = (uv.min(0) * [mw, mh]).astype(int); x1, y1 = (uv.max(0) * [mw, mh]).astype(int)
reg = px[max(0, y0):max(0, y1), max(0, x0):max(0, x1)]; a = reg[..., 3] > 0.99
Yl = (0.2126 * reg[..., 0] + 0.7152 * reg[..., 1] + 0.0722 * reg[..., 2])[a]
p75 = float(np.percentile(Yl, 75)) if Yl.size > 20 else None
meter = dict(p75=p75, skinY=skinY, stops=float(np.clip(math.log2(skinY / p75), -12, 12)) if p75 else 0.0, pixels=int(Yl.size), ms=round(tm * 1000)); print('meter', meter)
gain = 2 ** meter['stops']
C7 = camera7_stage.settings(None, STG['record'], skinY, 'auto', None, '0', cam_rec=rec_m); print('camera7', json.dumps({k: v for k, v in C7.items() if k != 'c7'}))
wb = STG['record']['wb']
info = dict(stage=STAGE, W=W, H=H, samples=SAMPLES, views=VIEWS, meter=meter, camera7=dict(C7), blender=bpy.app.version_string, frames=[], room=(STG['record'].get('set') or {}).get('room'),
            note='a stand-in sitter (two ellipsoids, skin albedo %s), no person; display = camera7 (no sharpening, no vignette: the engine\'s lens vignette is not in the Cycles chain)' % (SKIN,))
def shoot(view, tag, hide_room=False):
    pv = portrait_view(view)
    if pv: rec = look(pv['pos'], pv['at'], pv['fov'], 'cam_' + view, int(round(1350 * pv['aspect'])), 1350, pv['lens'])
    else: rec = look(*VIEWDEF[view][:2], VIEWDEF[view][2], 'cam_' + view)
    cam = use_camera(rec, 'cam_' + view)
    for e in STG['lights']:
        if e.name.startswith('stage_window'): e.visible_camera = (pv is None)    # the window shows in the wide views only
    room = [o for o in STG['set'] if o.name.startswith('stage_room')]
    for o in (room if hide_room else []): o.hide_render = True
    exr = os.path.join(OUT, tag + '.exr'); tr = render_to(exr, rec['W'], rec['H'], SAMPLES)
    for o in room: o.hide_render = False
    px = read_exr_bpy(exr)[..., :3] * gain; os.remove(exr)
    img = c7d.display7(px, c7d.params7(**C7['display']), wb); write_png(os.path.join(OUT, tag + '.png'), img)
    info['frames'].append(dict(tag=tag, view=view, control=hide_room, render_s=round(tr, 1), W=rec['W'], H=rec['H'], lens=rec['lens'])); print(f'{tag}: {tr:.1f} s', flush=True)
for v in VIEWS:
    shoot(v, f'room7_{v}')
for v in CONTROL:
    if v in VIEWDEF or portrait_view(v):
        shoot(v, f'room7_{v}_control', hide_room=True)
info['total_s'] = round(time.time() - t0, 1)
json.dump(info, open(os.path.join(OUT, 'room7.json'), 'w'), indent=1)
print('done', json.dumps(info)[:600])
