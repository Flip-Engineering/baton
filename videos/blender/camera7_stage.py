# CAMERA7 (round 7) for Cycles: what render_person.py's --camera7 does, kept out of that file. Opt-in; without --camera7 render_person.py never imports this.
#   tint_sweep(rec, parts, stops, bounce)   the stage record's set.tint (a coloured seamless) multiplied into the floor / sweep material's base colour (the engine's
#                                grounds.js does the same: material.color x the paper albedo). REV 3 (bounce given): the camera and glossy rays see tint x 2^stops (the
#                                paper at its tracked level, no specular), DIFFUSE rays tint x 2^bounce (the floor still bounces into the shadow side of the face)
#   aim_bg(stg, cam)             rev 3: the bg lamp's pool is translated so its beam axis meets the wall where the CAMERA's axis does (the Cycles shots' cameras stand
#                                16 degrees off the stage axis: rev 2's pool sat at the left edge of the frame)
#   lens(rec_camera, c7)         the person camera's record with camera7's lens (focal mm, f-stop) laid over it: person_scene.camera_from sets the sensor from the
#                                field of view, so the framing is kept and the depth of field is that of an 85 mm at f/2.8 (the engine's thin lens, the same f / 2N aperture)
#   settings(argv_opt, stage_rec, skin_y)   -> dict(display params, bias stops, sharpen, lens) from --camera7 [auto | json], --c7-bias [auto | stops], --c7-display, --c7-sharpen
import json
import bpy
from camera7_display import CAMERA7_LENS, CAMERA7_SHARPEN, CAMERA7_BG, CAMERA7_BG3, skin_bias, bg_stops, bg_stops3


def tint_sweep(rec, parts, stops=0.0, bounce=None, spec_off=True):
    """the seamless's tint x 2^stops (rev 2: the paper tracks the skin compensation, camera7_display.bg_stops; 0 = the record's tint as it is).
    bounce (stops, rev 3): None = rev 2 (one tint for every ray). A number = the material reads Light Path: DIFFUSE rays (the floor's bounce on the subject) see tint x 2^bounce,
    every other ray (the camera, the cornea's and the skin's mirror) tint x 2^stops; spec_off: the camera sees no specular on the paper (a matte backdrop: the reflection of the
    fill panel was a 0.007 floor the tint could not darken, 40 % of the rev 2 paper)"""
    S = rec.get('set') or {}
    tint = S.get('tint')   # (c3 i2: a window@7 room has no seamless and no tracked wall: the window lights the wall, the exposure moves both)
    if not tint:
        return None
    return _track(('stage_floor',), tint, stops, bounce, spec_off)


def _track(prefixes, tint, stops, bounce, spec_off):
    cam_t = [v * 2.0 ** stops for v in tint]
    n = 0
    for m in bpy.data.materials:
        if any(m.name.startswith(q) for q in prefixes) and m.use_nodes:
            nt = m.node_tree
            p = next((x for x in nt.nodes if x.type == 'BSDF_PRINCIPLED'), None)
            if p is None or not p.inputs['Base Color'].links:
                continue
            link = p.inputs['Base Color'].links[0]; src = link.from_socket
            nt.links.remove(link)
            if bounce is None:
                vm = nt.nodes.new('ShaderNodeVectorMath'); vm.operation = 'MULTIPLY'; vm.inputs[1].default_value = tuple(cam_t)
                nt.links.new(src, vm.inputs[0]); nt.links.new(vm.outputs[0], p.inputs['Base Color']); n += 1
                continue
            bnc_t = [v * 2.0 ** bounce for v in tint]
            lp = nt.nodes.new('ShaderNodeLightPath')
            sc = nt.nodes.new('ShaderNodeVectorMath'); sc.operation = 'SCALE'; sc.inputs[0].default_value = tuple(b - c for b, c in zip(bnc_t, cam_t))
            nt.links.new(lp.outputs['Is Diffuse Ray'], sc.inputs['Scale'])
            ad = nt.nodes.new('ShaderNodeVectorMath'); ad.operation = 'ADD'; ad.inputs[1].default_value = tuple(cam_t)
            nt.links.new(sc.outputs[0], ad.inputs[0])
            vm = nt.nodes.new('ShaderNodeVectorMath'); vm.operation = 'MULTIPLY'
            nt.links.new(src, vm.inputs[0]); nt.links.new(ad.outputs[0], vm.inputs[1]); nt.links.new(vm.outputs[0], p.inputs['Base Color'])
            if spec_off:
                sp = next((p.inputs[k] for k in ('Specular IOR Level', 'Specular') if k in p.inputs), None)
                if sp is not None and not sp.links:
                    one = nt.nodes.new('ShaderNodeMath'); one.operation = 'SUBTRACT'; one.inputs[0].default_value = 1.0
                    nt.links.new(lp.outputs['Is Camera Ray'], one.inputs[1])
                    mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = float(sp.default_value)
                    nt.links.new(one.outputs[0], mul.inputs[0]); nt.links.new(mul.outputs[0], sp)
            n += 1
    return dict(tint=cam_t, bounce_tint=[v * 2.0 ** bounce for v in tint] if bounce is not None else None, mode='rays' if bounce is not None else 'flat', materials=n)


def aim_bg(stg, cam):
    """the stage's lamps with follow 'camera' (the background light: studio@7's bg) are placed for the NOMINAL camera (on the stage axis); here they are translated sideways
    and up with the point where THIS camera's axis meets the back wall, so the pool sits on the same part of the wall for any head and any camera yaw (a photographer lights the background
    for the lens). Twin of lib/fx/light/rig.js followCamera: shift = (hit.x, hit.height - 1.55). Blender frame: the wall is the plane y = set.back, height is z.
    Uses location / rotation_euler (matrix_world is stale until a depsgraph update)."""
    from mathutils import Vector
    rec = stg['record']; back = (rec.get('set') or {}).get('back', 3.4)
    names = {'stage_' + L['name'] for L in rec.get('lamps', []) if L.get('follow') == 'camera'}
    M = cam.matrix_world; cp = M.translation.copy(); cf = M.to_quaternion() @ Vector((0.0, 0.0, -1.0))
    if cf.y < 1e-3:
        return None
    ch = cp + cf * ((back - cp.y) / cf.y)
    sh = Vector((ch.x, 0.0, ch.z - 1.55))
    out = []
    for ob in stg.get('lights', []):
        if ob.name in names:
            was = ob.location.copy(); ob.location = was + sh
            out.append(dict(name=ob.name, shift=[round(v, 3) for v in sh], was=[round(v, 3) for v in was], hit=[round(v, 3) for v in ch]))
    return out


def lens(cam_rec, c7):
    L = c7.get('lens')
    L = CAMERA7_LENS.get(L, CAMERA7_LENS['portrait']) if isinstance(L, str) or L is None else L
    out = dict(cam_rec)
    out['lens'] = dict(cam_rec.get('lens') or {}, focal=L['focal'], fstop=L['fstop'])
    return out


def head_ipd_px(cam_rec, ipd_m=0.063):
    """pixels between the pupils at the focus plane: H / (2 focus tan(fovY / 2)) x 63 mm (the sharpening scales with the head's size: a bust's head is 0.64 of a face shot's)"""
    import math
    focus = (cam_rec.get('lens') or {}).get('focus') or 1.0
    return ipd_m * cam_rec['H'] / (2.0 * focus * math.tan(math.radians(cam_rec['fovY']) / 2.0))


def settings(spec, stage_rec, skin_y, bias_opt='auto', display_json=None, sharpen_opt='auto', cam_rec=None):
    """spec: 'auto' | '1' | a json object string. The stage record's own camera7 (studio@7: lens 'portrait56', sharpen true) is the base; json fields overlay it.
    cam_rec: the shot's camera record (fovY, H, lens.focus): the sharpening's sigma follows the head's size, and the seamless's compensation (bg_stops) follows the bias."""
    base = dict((stage_rec or {}).get('camera7') or {})
    if spec and spec not in ('auto', '1'):
        base.update(json.loads(spec))
    base.setdefault('lens', 'portrait56')
    bias = skin_bias(skin_y) if bias_opt == 'auto' else float(bias_opt)
    disp = dict(base.get('display') or {}); disp.update(json.loads(display_json) if display_json else {})
    disp['expo'] = disp.get('expo', 0.0) + bias + float(base.get('expo', 0.0))
    sh = None
    if sharpen_opt not in ('0', 'off'):
        so = base.get('sharpen'); so = so if isinstance(so, dict) else {}
        sh = dict(CAMERA7_SHARPEN, **so)
        ipd = head_ipd_px(cam_rec) if cam_rec else 175.0
        sh = dict(sigma=round(sh.get('sigma', sh['sigma_per_ipd'] * ipd), 3), amount=sh['amount'], **({'thr': sh['thr']} if 'thr' in sh else {}), **({'luma': bool(sh['luma'])} if 'luma' in sh else {})); sh['ipd_px'] = round(ipd, 1)
    bg = (stage_rec or {}).get('bg')
    return dict(c7=base, display=disp, bias=bias, sharpen=sh, skin_y=skin_y, bg_stops=(bg_stops(bias, bg) if bg else 0.0), bg3=dict(CAMERA7_BG3, **{k: bg[k] for k in ('c', 'bounce') if k in bg}) if bg else None)   # a stage may carry its own c / bounce
