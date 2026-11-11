# ALL POWER c20: one exported person (person_job.py's export + bakes) rendered at NIGHT in Cycles, as a cut-out plate for the scene
# (scenes/allpower_a.js composites it over the town / the work light). Not a studio stage: the person's own lights are removed and the
# piece's lights are set instead.
#   blender -b --factory-startup -P videos/blender/allpower_night.py -- --export <dir> --maps <dir> --look strobe|town|face
#       [--turn DEG] [--samples 256] [--out DIR] [--tag NAME] [--res 1080x1350]
# Looks (Blender: the person faces -y, z up):
#   strobe  a present-day line worker at the truck: a white work flood high camera-left, the boom's amber strobe as the rim from behind
#           right, a cold sky fill; bust, camera a little below the eyes.
#   town    the payoff: the town coming back on below lights the face from low front (sodium, broad and soft), the strobe rims from
#           behind left, a cold sky fill; bust, three-quarter, camera low so the face is against clear sky.
#   face    a closer crop of `strobe` (head and shoulders), for the word CLASS.
# Writes <out>/<tag>.png (RGBA: the display transform of lib/fx/light/display.js on the colour, Cycles' alpha) and <tag>.json.
import sys, os, json, math, time
import numpy as np
import bpy
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import person_scene as S
from acp_display import acp_display, lottes_params, read_exr_bpy
import zlib, struct

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def opt(k, d=None, cast=str):
    return cast(argv[argv.index('--' + k) + 1]) if '--' + k in argv else d
EXP = opt('export'); MAPS = opt('maps', os.path.join(EXP, 'maps'))
LOOK = opt('look', 'strobe'); TURN = opt('turn', None, float); SPP = opt('samples', 256, int)
OUT = opt('out', os.environ.get('GPU_OUT') or os.path.join(EXP, 'night')); os.makedirs(OUT, exist_ok=True)
TAG = opt('tag', f'{os.path.basename(os.path.normpath(EXP))}_{LOOK}')
RW, RH = [int(x) for x in opt('res', '1080x1350').split('x')]
ON_FARM = 'GPU_JOB_DEVICE' in os.environ or 'GPU_OUT' in os.environ
t0 = time.time()

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
pp, parts = S.build(EXP, MAPS, light='sun')
M = pp.m
# the person's own light goes: no sun, no ground; the night is set below
for o in list(sc.objects):
    if o.type == 'LIGHT':
        bpy.data.objects.remove(o, do_unlink=True)
if parts.get('ground'):
    parts['ground'].hide_render = True
w = bpy.data.worlds.new('night'); w.use_nodes = True
bg = w.node_tree.nodes.get('Background'); bg.inputs[0].default_value = (0.006, 0.009, 0.016, 1); bg.inputs[1].default_value = 1.0
sc.world = w

head = Vector(M['landmarks']['head'])
eye = head + Vector((0, -0.02, 0.03))
# three-quarter: the person turns on the spot (all of it: body, garments, eyes, hair)
turn = TURN if TURN is not None else {'strobe': 28.0, 'town': -32.0, 'face': 22.0}[LOOK]
piv = Matrix.Translation(Vector((head.x, head.y, 0))) @ Matrix.Rotation(math.radians(turn), 4, 'Z') @ Matrix.Translation(Vector((-head.x, -head.y, 0)))
for o in sc.objects:
    if o.type in ('MESH', 'CURVES', 'CURVE') and o.parent is None and o is not parts.get('ground'):
        o.matrix_world = piv @ o.matrix_world

def area(name, loc, target, color, power, size):
    ld = bpy.data.lights.new(name, 'AREA'); ld.shape = 'DISK'; ld.size = size; ld.energy = power; ld.color = color
    ob = bpy.data.objects.new(name, ld); sc.collection.objects.link(ob); ob.location = loc
    d = (Vector(target) - Vector(loc)).normalized(); ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return ob

AMBER = (1.0, 0.5, 0.12); SODIUM = (1.0, 0.62, 0.32); FLOOD = (0.92, 0.95, 1.0); SKY = (0.45, 0.6, 1.0)
h = head
# (round 2, --light 2: harder and darker, a night not a studio: the flood narrower and off to the side, the rim stronger, almost no fill;
#  the camera closer, head and shoulders)
R2 = opt('light', '1') == '2'
if LOOK in ('strobe', 'face'):
    area('flood', h + Vector((-2.6, -1.6, 1.6)), h, FLOOD, 170 if R2 else 260, 0.35 if R2 else 0.6)   # the truck's work flood, high camera-left
    area('strobe', h + Vector((1.6, 2.0, 0.6)), h, AMBER, 900 if R2 else 520, 0.25)                    # the boom-tip strobe behind right: the rim
    area('sky', h + Vector((0.0, 1.0, 3.0)), h, SKY, 12 if R2 else 40, 3.0)                             # the cold night above
    if R2:
        cam_d, cam_up, look_dz, fov = (1.45 if LOOK == 'strobe' else 1.05), -0.1, -0.1 if LOOK == 'strobe' else -0.03, 28.0
    else:
        cam_d, cam_up, look_dz, fov = (2.1 if LOOK == 'strobe' else 1.25), -0.12, -0.12 if LOOK == 'strobe' else -0.03, 30.0
else:   # town
    area('town', h + Vector((0.7, -2.2, -1.9)), h, (1.0, 0.5, 0.2) if R2 else SODIUM, 420 if R2 else 300, 1.6 if R2 else 2.5)   # the town below in front, warm, from under
    area('strobe', h + Vector((-1.7, 1.8, 0.7)), h, AMBER, 900 if R2 else 480, 0.25)                 # the strobe behind left: the rim
    area('sky', h + Vector((0.0, 1.0, 3.0)), h, SKY, 18 if R2 else 55, 3.0)
    cam_d, cam_up, look_dz, fov = (1.6, -0.38, -0.12, 30.0) if R2 else (2.2, -0.42, -0.08, 32.0)

cd = bpy.data.cameras.new('cam'); cd.sensor_fit = 'VERTICAL'; cd.lens = 50
cd.sensor_height = 2 * 50 * math.tan(math.radians(fov) / 2); cd.sensor_width = cd.sensor_height * RW / RH
cd.clip_start = 0.02; cd.clip_end = 100
cam = bpy.data.objects.new('cam', cd); sc.collection.objects.link(cam); sc.camera = cam
cam.location = eye + Vector((0, -cam_d, cam_up))
tgt = eye + Vector((0, 0, look_dz))
cam.rotation_euler = (tgt - cam.location).normalized().to_track_quat('-Z', 'Y').to_euler()

sc.render.engine = 'CYCLES'; cy = sc.cycles
cy.device = 'GPU' if ON_FARM else 'CPU'
cy.samples = SPP; cy.use_adaptive_sampling = True; cy.adaptive_threshold = 0.01; cy.adaptive_min_samples = 32
cy.use_denoising = True
try:
    cy.denoiser = 'OPENIMAGEDENOISE'
except Exception:
    pass
cy.max_bounces = 12; cy.diffuse_bounces = 4; cy.glossy_bounces = 4; cy.transmission_bounces = 8; cy.transparent_max_bounces = 16
sc.cycles_curves.shape = 'THICK'; sc.cycles_curves.subdivisions = 2
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = RW, RH, 100
sc.render.film_transparent = True
sc.view_settings.view_transform = 'Standard'; sc.view_settings.look = 'None'
sc.render.image_settings.file_format = 'OPEN_EXR'; sc.render.image_settings.color_depth = '32'; sc.render.image_settings.exr_codec = 'ZIP'
exr = os.path.join(OUT, TAG + '.exr'); sc.render.filepath = exr
t1 = time.time(); bpy.ops.render.render(write_still=True); tr = time.time() - t1
px = read_exr_bpy(exr)
rgb, a = px[..., :3], px[..., 3:4]
# exposure: the lit side of the face (p90 of the person's luminance inside the head's box) to a night value, not to a studio grey
from bpy_extras.object_utils import world_to_camera_view
def proj(p):
    v = world_to_camera_view(sc, cam, Vector(p)); return v.x, 1 - v.y
hp = piv @ head
box = [hp + Vector((dx, dy, dz)) for dx in (-0.1, 0.1) for dy in (-0.15, 0.1) for dz in (-0.12, 0.12)]
uv = np.array([proj(p) for p in box]); x0, y0 = (uv.min(0) * [RW, RH]).astype(int); x1, y1 = (uv.max(0) * [RW, RH]).astype(int)
reg = px[max(0, y0):max(1, y1), max(0, x0):max(1, x1)]
Y = (0.2126 * reg[..., 0] + 0.7152 * reg[..., 1] + 0.0722 * reg[..., 2])[reg[..., 3] > 0.98]
p90 = float(np.percentile(Y, 90)) if Y.size > 20 else 0.18
gain = float(np.clip((0.3 if R2 else 0.42) / max(p90, 1e-5), 1 / 64, 64))
img = acp_display(np.where(a > 1e-4, rgb / np.maximum(a, 1e-4), 0) * gain, lottes_params(), None)
rgba = np.concatenate([np.clip(img, 0, 1), np.clip(a, 0, 1)], -1)
q = np.clip(np.rint(rgba * 255), 0, 255).astype(np.uint8)
raw = b''.join(b'\x00' + q[y].tobytes() for y in range(q.shape[0]))
def chunk(t, d):
    return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
with open(os.path.join(OUT, TAG + '.png'), 'wb') as f:
    f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', q.shape[1], q.shape[0], 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))
os.remove(exr)
json.dump(dict(tag=TAG, look=LOOK, turn=turn, samples=SPP, res=[RW, RH], p90=p90, gain=gain, render_s=round(tr, 1), total_s=round(time.time() - t0, 1),
               head_px=[int((x0 + x1) / 2), int((y0 + y1) / 2)], who=os.path.basename(os.path.normpath(EXP))), open(os.path.join(OUT, TAG + '.json'), 'w'), indent=1)
print('allpower_night done', TAG, round(tr, 1), 's')
