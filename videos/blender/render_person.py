# CYCLES step 5: render an exported person in Cycles, metered at the face and shown through the studio's own display transform.
#   blender -b --factory-startup -P videos/blender/render_person.py -- --export <export dir> [--maps <dir with skin_*.png>]
#       --shot face|bust|full --light over|sun [--register bare|dressed] [--samples 256] [--scale 1] [--threads 2] [--device CPU|GPU]
#       [--out <dir>] [--tag name] [--orbit deg --frames n] [--exposure-from <json>] [--no-meter]
#       [--vanish retry|record|off]   (integration, 8 Oct 21:30: every still is VERIFIED from its own object-index pass: a render that lost the
#       skin object is rendered again, then pre-diced (blender/person_guard.py verify_render; 'record' only logs it; default retry)
#       (22:20: the fine tier's skin is PRE-DICED by default at a level set for this camera (person_guard.dice_for_camera; the json's 'dice'):
#       the adaptive dicing every loss came from runs only with FINE7_CYC {"adaptive": 1})
#       [--stage studio|window|yard|lot|shop]   (STAGE round 4, opt-in: blender/stage_scene.py replaces the ground and the light with lib/fx/stage's)
#       [--stage studio@5|window@5|yard@5|overcast|record ...] [--sss-thick auto|<ref mm>] [--quality still|farm]   (LIGHT5 round 5, opt-in:
#       the round-5 stages with the grey-card white balance; subsurface limited by the skin's thickness (the orange lower lid); the
#       still / farm sampling and denoise presets: blender/light5.py)
#       [--camera7 auto|<json>] [--c7-bias auto|<stops>] [--c7-display <json>] [--c7-sharpen auto|0]   (CAMERA7 round 7, opt-in: the photographic display (blender/camera7_display.py, the
#       numpy twin of lib/fx/light/camera7.js), the photographer's skin-zone exposure rule, an 85 mm f/5.6 lens, output sharpening, and a '@7' stage's coloured seamless)
#       [--c7-bounce <stops>]   (a '@7' stage with camera7 on: the backdrop seen by the camera at its tracked level -(meter + bias) + c, no specular, the floor's DIFFUSE bounce kept at <stops> of
#       the record's tint; the stage's background light (follow 'camera') is placed for this camera: camera7_stage.aim_bg)
# Writes <out>/<tag>.png (display: lib/fx/light/display.js), <tag>.exr (scene-linear, the pass a scene composites), <tag>.json (times,
# samples, exposure, counts). --orbit/--frames renders a slow camera move round the vertical axis through the head (frames numbered).
import sys, os, time, json, math
import numpy as np
import bpy
from mathutils import Matrix, Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import person_scene as S
from acp_display import acp_display, lottes_params, write_png, read_exr_bpy

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def opt(k, d=None, cast=str):
    return cast(argv[argv.index('--' + k) + 1]) if '--' + k in argv else d
EXP = opt('export'); MAPS = opt('maps', os.path.join(EXP, 'maps'))
SHOT, LIGHT, REG = opt('shot', 'face'), opt('light', 'over'), opt('register', None)
# on the farm (FARMGPU's gpujob/boot.py has already chosen the cards and sets cycles.device = GPU at every render) the defaults follow it
ON_FARM = 'GPU_JOB_DEVICE' in os.environ or 'GPU_OUT' in os.environ
SAMPLES, SCALE, THREADS, DEVICE = opt('samples', 256, int), opt('scale', 1.0, float), opt('threads', 0 if ON_FARM else 2, int), opt('device', 'GPU' if ON_FARM else 'CPU')
OUT = opt('out', os.environ.get('GPU_OUT') or os.path.join(EXP, 'renders')); os.makedirs(OUT, exist_ok=True)
TAG = opt('tag', f'{os.path.basename(os.path.normpath(EXP))}_{SHOT}_{LIGHT}')
ORBIT, FRAMES = opt('orbit', 0.0, float), opt('frames', 1, int)
HAIR = opt('hair', 1.0, float); SSS = opt('sss', None, float)   # (integration v4) absent: the export's manifest skin.sss (0.6 for skin rev 4), else 1.0
CROP = [float(x) for x in opt('crop', '').split(',')] if opt('crop') else None   # x0,y0,x1,y1 as fractions, y down
t0 = time.time()
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
pp, parts = S.build(EXP, MAPS, light=LIGHT, register=REG, hair_density=HAIR, sss=SSS)
if '--no-guard' not in argv:   # (integration, 8 Oct) the person's Cycles guard: no non-finite displacement can drop the skin object (blender/person_guard.py)
    try:
        import person_guard
        person_guard.install(parts)
    except Exception as _e:   # the guard never fails a render
        print('person_guard: error', repr(_e)[:300], flush=True)
VAN = opt('vanish', 'retry'); VST = None   # (integration, 8 Oct 21:30) the vanishing skin: verify every still (person_guard.verify_render)
if VAN != 'off':
    try:
        import person_guard
        VST = person_guard.arm_vanish(sc, parts['body'])
        if not VST.get('on'):
            print('person_guard vanish: not armed', VST, flush=True); VAN = 'off'
    except Exception as _e:
        print('person_guard vanish: error', repr(_e)[:300], flush=True); VAN = 'off'
STAGE = opt('stage', None); STG = None
if STAGE:
    import stage_scene
    STG = stage_scene.apply(STAGE, parts)
C7 = None
C7_ON = ('--camera7' in argv and opt('camera7') != 'off') or (bool(STAGE) and STAGE.endswith('@7') and opt('camera7') != 'off')   # CAMERA7 (opt-in): a '@7' stage carries its camera; --camera7 off renders its light alone
if C7_ON or (STG and (STG['record'].get('set') or {}).get('tint')):
    import camera7_stage, camera7_display as c7d
L5T, L5Q, L5 = opt('sss-thick', None), opt('quality', None), {}
if L5T or L5Q:
    import light5
if L5T:   # LIGHT5: the subsurface radius scaled by the skin's local thickness (opt-in)
    sss_used = SSS if SSS is not None else ((pp.m.get('skin') or {}).get('sss') or 1.0)
    t5 = time.time(); L5['sssThick'] = light5.thickness_sss(parts, None if L5T == 'auto' else float(L5T), sss=sss_used); L5['sssThick']['s'] = round(time.time() - t5, 1)
    print('light5 sss-thick', L5['sssThick'])
M = pp.m
rec = M['cameras'][SHOT]
if C7_ON:   # CAMERA7 settings (needs the skin's reflectance for the exposure rule: lane B's skinY, the meter's target)
    _sb = (M.get('skin') or {}).get('base') or [0.2, 0.12, 0.08]
    _sy = 0.2126 * _sb[0] + 0.7152 * _sb[1] + 0.0722 * _sb[2] + 0.03
    C7 = camera7_stage.settings(opt('camera7') if opt('camera7') != 'off' else None, STG['record'] if STG else None, _sy, opt('c7-bias', 'auto'), opt('c7-display'), opt('c7-sharpen', 'auto'), cam_rec=rec)
    rec = camera7_stage.lens(rec, C7['c7']); print('camera7', json.dumps({k: v for k, v in C7.items() if k != 'c7'}), 'lens', rec['lens'])
C7_BG3 = bool(C7 and C7.get('bg3'))   # camera7 on a stage that tracks its backdrop: camera-ray tint at -(meter + bias) + c, diffuse bounce kept, the background light follows the camera
if STG and (C7_ON or (STG['record'].get('set') or {}).get('tint')) and not C7_BG3:   # a '@7' stage's coloured seamless (the engine's grounds.js tints the same material), whether or not its camera is on; with the camera on the paper tracks the skin compensation (rev 2)
    _tr = camera7_stage.tint_sweep(STG['record'], parts, C7['bg_stops'] if C7 else 0.0)
    if _tr: print('camera7 seamless', json.dumps(_tr))
cam = S.camera_from(rec); sc.camera = cam
if C7_BG3:   # the background light follows the camera's wall point (the tint waits for the meter below: the backdrop's level is -(meter + bias) + c)
    _am = camera7_stage.aim_bg(STG, cam); print('camera7 bg lamp', json.dumps(_am))
W, H = int(round(rec['W'] * SCALE)), int(round(rec['H'] * SCALE))
t_build = time.time() - t0

# ---- render settings: Cycles, path tracing, OIDN, adaptive sampling
sc.render.engine = 'CYCLES'
cy = sc.cycles
cy.device = 'GPU' if DEVICE == 'GPU' else 'CPU'
if DEVICE == 'GPU' and not ON_FARM:
    pr = bpy.context.preferences.addons['cycles'].preferences
    for kind in ('OPTIX', 'CUDA', 'HIP', 'ONEAPI'):
        try:
            pr.compute_device_type = kind; pr.get_devices(); break
        except Exception:
            continue
    for d in pr.devices:
        d.use = d.type != 'CPU'
if THREADS:
    sc.render.threads_mode = 'FIXED'; sc.render.threads = THREADS
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
if L5Q:   # LIGHT5: the still (this CPU, 64-128 spp) or farm (GPU, >= 256 spp, full size) sampling and denoise preset (opt-in)
    L5['quality'] = light5.quality(sc, L5Q, SAMPLES); print('light5 quality', L5['quality'])
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W, H, 100
sc.render.film_transparent = False
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

# ---- (integration, 8 Oct 22:20) the fine tier's skin PRE-DICED for this camera (person_guard.dice_for_camera: the Catmull-Clark render
# level from the head's base edge in pixels, 2..3; no adaptive dicing unless FINE7_CYC {"adaptive": 1}): the vanishing skin's mechanism
DICE = None
if parts.get('fine7'):
    try:
        import person_guard
        DICE = person_guard.dice_for_camera(sc, cam, parts['body'], M['landmarks']['head'], W, H, parts['fine7'])
    except Exception as _e:   # the level stays the scene's (2): the render goes on
        DICE = {'error': repr(_e)[:300]}
    print('person_guard dice:', json.dumps(DICE), flush=True)

# ---- exposure: lane B's rule (expose.js meterFace / person meterPeople): the lit side of the face (p75 of its luminance) lands at the
# skin's own reflectance (its base albedo + 0.03 surface reflection). Metered on a quick render with only the body and eyes visible.
skin_base = (M.get('skin') or {}).get('base') or [0.2, 0.12, 0.08]
skinY = 0.2126 * skin_base[0] + 0.7152 * skin_base[1] + 0.0722 * skin_base[2] + 0.03
meter = None
if '--exposure-from' in argv:
    meter = json.load(open(opt('exposure-from')))['meter']
elif '--no-meter' not in argv:
    hide = [o for o in sc.objects if o.type in ('CURVES',) or o in parts['garments'] or o is parts['ground'] or o in parts.get('stage', [])]
    for o in hide:
        o.hide_render = True
    mw, mh = max(64, W // 4), max(64, H // 4)
    hd = np.array(M['landmarks']['head'])
    # the face box: from the chin to the brow, a head's width, in front of the head joint (Blender: the person faces -y)
    box = [hd + np.array([dx, dy, dz]) for dx in (-0.075, 0.075) for dy in (-0.14, -0.02) for dz in (-0.06, 0.09)]
    uv = np.array([project(p) for p in box]); x0, y0 = (uv.min(0) * [mw, mh]).astype(int); x1, y1 = (uv.max(0) * [mw, mh]).astype(int)
    tm = 0.0; meter_tries = 0
    while True:   # (integration, 8 Oct 21:30) a meter render that lost the skin (no opaque pixel in the face box) is rendered again, twice at most
        meter_tries += 1
        tm += render_to(os.path.join(OUT, f'_{TAG}_meter.exr'), mw, mh, 24, transparent=True, denoise=False)
        px = read_exr_bpy(os.path.join(OUT, f'_{TAG}_meter.exr')); os.remove(os.path.join(OUT, f'_{TAG}_meter.exr'))
        reg = px[max(0, y0):max(0, y1), max(0, x0):max(0, x1)]
        a = reg[..., 3] > 0.99
        if VAN == 'off' or int(a.sum()) > 20 or meter_tries >= 3:
            break
        print(f'person_guard vanish: the meter found no skin in the face box (try {meter_tries}); rendering it again', flush=True)
    for o in hide:
        o.hide_render = False
    Y = (0.2126 * reg[..., 0] + 0.7152 * reg[..., 1] + 0.0722 * reg[..., 2])[a]
    p75 = float(np.percentile(Y, 75)) if Y.size > 20 else None
    meter = dict(p75=p75, skinY=skinY, stops=float(np.clip(math.log2(skinY / p75), -12, 12)) if p75 else 0.0, pixels=int(Y.size), ms=round(tm * 1000), tries=meter_tries)
    print('meter', meter)
gain = 2 ** meter['stops'] if meter else 1.0
if C7_BG3:   # the backdrop's tint now the metered exposure is known (the meter render hid the set, so the order does not change the meter)
    _bs = camera7_stage.bg_stops3(C7['bias'], meter['stops'] if meter else 0.0, C7['bg3'])   # c2: the stage's own c (window@7's wall); the default dict is CAMERA7_BG3
    _bo = float(opt('c7-bounce', C7['bg3']['bounce']))
    _tr = camera7_stage.tint_sweep(STG['record'], parts, _bs, bounce=_bo); C7['bg_stops'] = _bs; C7['bg3'] = dict(C7['bg3'], stops=_bs, bounce=_bo, lamp=_am)
    print('camera7 seamless (rays)', json.dumps(_tr))
wb = STG['record']['wb'] if STG else M['lights'][LIGHT].get('wb')
if STG and (STG['record'].get('camera') or {}).get('wb') == 'card' and '--no-card-residual' not in argv:
    # LIGHT5: on a grey-card stage, the residual Cycles' own grey card measured (the set's real bounce: blender/stage_cards.py --residual)
    _cc = os.path.join(stage_scene.ASSETS, 'cycles_cards.json')
    _r = (json.load(open(_cc))['stages'].get(STAGE) if os.path.exists(_cc) else None)
    if _r:
        wb = (np.diag(_r['gains']) @ np.array(wb, float).reshape(3, 3)).ravel().tolist(); print('light5 card residual', _r['gains'])

# ---- render (one still, or an orbit)
info = dict(tag=TAG, shot=SHOT, light=LIGHT, stage=STAGE, register=parts['register'], W=W, H=H, samples=SAMPLES, threads=THREADS, device=DEVICE, build_s=round(t_build, 1), meter=meter,
            display='lib/fx/light/display.js acpDisplay (numpy port), white balance ' + (('stage ' + STAGE + (' (grey card)' if (STG['record'].get('camera') or {}).get('wb') == 'card' else '')) if STG else str(M['lights'][LIGHT].get('wbK')) + ' K'), frames=[],
            hair={o.name: dict(strands=o.get('strands'), points=o.get('points')) for o in parts['hair']}, blender=bpy.app.version_string, light5=L5 or None, camera7=(dict(C7) if C7 else None), dice=DICE)
cam0 = cam.matrix_world.copy(); pivot = Vector(M['landmarks']['head']); pivot.z -= 0.25
# the vanishing skin: is the skin in view? the meter saw it in the face box (hair and clothes hidden) -> yes; otherwise (a crop, no meter)
# quick probes of the same camera decide when a still shows none
VAN_EXPECT = True if (meter and (meter.get('pixels') or 0) > 20 and not CROP) else None
info['vanish'] = [] if VAN != 'off' else None; info['vanishArm'] = VST
def probe_skin():
    p = os.path.join(OUT, f'_{TAG}_probe.exr')
    render_to(p, max(64, W // 4), max(64, H // 4), 16, transparent=False, denoise=False)
    n, _how = person_guard.skin_pixels(sc, os.path.join(OUT, f'_{TAG}_probe_check.exr'))
    try:
        os.remove(p)
    except OSError:
        pass
    return n or 0
for f in range(FRAMES):
    if FRAMES > 1:
        ang = math.radians(ORBIT) * (f / (FRAMES - 1) - 0.5)
        R = Matrix.Translation(pivot) @ Matrix.Rotation(ang, 4, 'Z') @ Matrix.Translation(-pivot)
        cam.matrix_world = R @ cam0
        name = f'{TAG}_{f:03d}'
    else:
        name = TAG
    exr = os.path.join(OUT, name + '.exr')
    if CROP:
        sc.render.use_border = True; sc.render.use_crop_to_border = True
        sc.render.border_min_x, sc.render.border_max_x = CROP[0], CROP[2]; sc.render.border_min_y, sc.render.border_max_y = 1 - CROP[3], 1 - CROP[1]
    if VAN != 'off':   # the still, verified: the skin traced, or rendered again (person_guard.verify_render)
        tr, _vr = person_guard.verify_render(lambda: render_to(exr, W, H, SAMPLES, transparent=False, denoise=True), sc, parts['body'], OUT, name,
                                             mode=VAN, expected=VAN_EXPECT, probe=probe_skin, log=lambda m: print(m, flush=True))
        info['vanish'].append(_vr)
    else:
        tr = render_to(exr, W, H, SAMPLES, transparent=False, denoise=True)
    sc.render.use_border = False
    px = read_exr_bpy(exr)[..., :3] * gain
    if C7:   # CAMERA7: the photographic display (exposure compensation inside), then output sharpening on the display-referred plate, as a camera's JPEG engine does
        px = c7d.vignette(px, rec['fovY'], CROP)   # the lens' natural fall-off (cos^4 of the field angle): the engine's final pass uses the same formula
        img = c7d.display7(px, c7d.params7(**C7['display']), wb)
        if C7['sharpen']:
            img = c7d.sharpen(img, **{k: v for k, v in C7['sharpen'].items() if k in ('sigma', 'amount', 'thr', 'luma')})
        write_png(os.path.join(OUT, name + '.png'), img)
    else:
        write_png(os.path.join(OUT, name + '.png'), acp_display(px, lottes_params(), wb))
    if FRAMES > 1 and f > 0:
        os.remove(exr)
    info['frames'].append(dict(name=name, render_s=round(tr, 1)))
    print(f'frame {name}: {tr:.1f} s')
info['total_s'] = round(time.time() - t0, 1)
json.dump(info, open(os.path.join(OUT, TAG + '.json'), 'w'), indent=1)
print('done', json.dumps(info))
