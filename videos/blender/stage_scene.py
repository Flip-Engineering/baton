# STAGE (round 4): the stages of lib/fx/stage in Cycles, from the records the engine builds them from (web/assets/stage/stages.json,
# written by web/labs/human8/stage_export.mjs from lib/fx/stage/stages.js) and the SAME files: the ground texture sets
# (stage_textures.py) and each stage's environment (<stage>_env.hdr: the room the engine fills with, or the engine's physical sky bake).
#   import stage_scene; stage_scene.apply('window', parts)      # after person_scene.build(): replaces its ground and world
#   render_person.py --stage <studio | window | yard | lot | shop>  (opt-in; without it CYCLES' calls are unchanged)
# CAMERA7 c3 i2: a '@7' window is ONE EMITTER: a stage whose key record carries `emitter` (window.js: centre, right, up, size, the radiance image window_r7_emit.hdr) gets an emissive
# rectangle at the window's place instead of a sun (build_light) and the environment holds only the room.
# CAMERA7 c4: the room's furniture (set.room) is REAL GEOMETRY: lib/fx/stage/room.js's triangles, packed by roompack.js into assets/stage/<set.room.file> (base64 float32 / uint32), built here as
# two meshes (flat-shaded boxes, smooth cloth / leaves / pot) with the albedo as a point colour attribute: Cycles traces the window's light across them (build_room).
# Frames: the records are in three's frame (+y up, camera on +z); Blender is (x, -z, y). Units: the engine's lux and cd/m2 times one
# scale C (1 / the key's lux) so a white card facing the key reads ~1/pi; the render is metered at the face afterwards anyway.
import os, json, math
import numpy as np
import bpy
from mathutils import Vector
from person_io import build_mesh, object_for
from person_scene import mat_new

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.normpath(os.path.join(HERE, '..', 'web', 'assets', 'stage'))
B = lambda v: Vector((v[0], -v[2], v[1]))     # three -> Blender


def records():
    return json.load(open(os.path.join(ASSETS, 'stages.json')))['stages']


def _img(name, colorspace):
    im = bpy.data.images.load(os.path.join(ASSETS, name), check_existing=True); im.colorspace_settings.name = colorspace
    return im


def stage_material(ground, tile=2.0, tint=None, macro=True, name=None):
    """the engine's stageMaterial (lib/fx/stage/grounds.js): albedo x macro (2 x the 16 m macro map at world (x, y_b) / 16), roughness,
    tangent normal (OpenGL), on the mesh's world-metre UVs"""
    m, nt, out = mat_new(name or 'stage_' + ground)
    p = nt.nodes.new('ShaderNodeBsdfPrincipled'); p.inputs['Metallic'].default_value = 0.0
    uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'UVMap'

    def tx(fn, cs, vec):
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = _img(fn, cs); t.interpolation = 'Linear'; t.extension = 'REPEAT'
        nt.links.new(vec, t.inputs['Vector']); return t
    alb = tx(f'{ground}_albedo.jpg', 'sRGB', uvn.outputs['UV'])
    col = alb.outputs['Color']
    if macro:
        geo = nt.nodes.new('ShaderNodeNewGeometry'); sc = nt.nodes.new('ShaderNodeVectorMath'); sc.operation = 'SCALE'; sc.inputs['Scale'].default_value = 1 / 16.0
        nt.links.new(geo.outputs['Position'], sc.inputs[0])
        mac = tx(f'{ground}_macro.jpg', 'Non-Color', sc.outputs['Vector'])
        k = nt.nodes.new('ShaderNodeMath'); k.operation = 'MULTIPLY'; k.inputs[1].default_value = 2.0; nt.links.new(mac.outputs['Color'], k.inputs[0])
        mm = nt.nodes.new('ShaderNodeVectorMath'); mm.operation = 'SCALE'; nt.links.new(col, mm.inputs[0]); nt.links.new(k.outputs[0], mm.inputs['Scale']); col = mm.outputs['Vector']
    if tint:
        tn = nt.nodes.new('ShaderNodeVectorMath'); tn.operation = 'MULTIPLY'; tn.inputs[1].default_value = tuple(tint); nt.links.new(col, tn.inputs[0]); col = tn.outputs['Vector']
    nt.links.new(col, p.inputs['Base Color'])
    rg = tx(f'{ground}_rough.jpg', 'Non-Color', uvn.outputs['UV']); nt.links.new(rg.outputs['Color'], p.inputs['Roughness'])
    nm = tx(f'{ground}_normal.jpg', 'Non-Color', uvn.outputs['UV'])
    nn = nt.nodes.new('ShaderNodeNormalMap'); nn.space = 'TANGENT'; nn.uv_map = 'UVMap'; nn.inputs['Strength'].default_value = 1.0
    nt.links.new(nm.outputs['Color'], nn.inputs['Color']); nt.links.new(nn.outputs['Normal'], p.inputs['Normal'])
    nt.links.new(p.outputs['BSDF'], out.inputs['Surface'])
    return m


def _quad_mesh(name, P, UV, faces):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in P], [], faces); me.update()
    uv = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            uv.data[li].uv = UV[me.loops[li].vertex_index]
    return me


def sweep_profile(back=3.4, cove=1.6, height=7, front=16, n=24, **_):
    """lib/fx/stage/grounds.js sweepProfile: (y, z, s) in three's frame"""
    P, R = [(0.0, front, 0.0)], cove
    s = front + back; P.append((0.0, -back, s))
    for i in range(1, n + 1):
        th = i / n * math.pi / 2; P.append((R - R * math.cos(th), -back - R * math.sin(th), s + R * th))
    s += R * math.pi / 2; P.append((height, -back - R, s + height - R))
    return P


def build_set(rec, coll):
    S, T = rec['set'], rec.get('tile', 2.0)
    objs = []
    floor_mat = stage_material(rec['ground'], T, name='stage_floor')
    if S['kind'] == 'sweep':
        prof, w = sweep_profile(**S), S.get('width', 30) / 2
        P, UV, F = [], [], []
        for (y, z, s) in prof:
            for x in (-w, w):
                P.append(B((x, y, z))); UV.append((x / T, (s - S.get('front', 16)) / T))
        for i in range(len(prof) - 1):
            a = i * 2; F.append((a, a + 1, a + 3, a + 2))
        me = _quad_mesh('stage_floor', P, UV, F)
        for p in me.polygons:
            p.use_smooth = True
    else:
        h = 200.0 if S['kind'] == 'yard' else 60.0
        P = [B((-h, 0, h)), B((h, 0, h)), B((h, 0, -h)), B((-h, 0, -h))]
        UV = [(v[0] / T, v[1] / T) for v in P]       # (x, -z) / T: Blender's y is -z
        me = _quad_mesh('stage_floor', P, UV, [(0, 1, 2, 3)])
    me.materials.append(floor_mat); objs.append(object_for(me, collection=coll))
    if S['kind'] in ('room', 'yard'):
        back, w, hh = S['back'], S['width'] / 2, S['height']
        P = [B((-w, 0, -back)), B((w, 0, -back)), B((w, hh, -back)), B((-w, hh, -back))]
        UV = [(-w / T, 0), (w / T, 0), (w / T, hh / T), (-w / T, hh / T)]
        wm = _quad_mesh('stage_wall', P, UV, [(0, 1, 2, 3)])
        wm.materials.append(stage_material(S.get('wall', 'plaster'), T, tint=S.get('wallTint'), name='stage_wall')); objs.append(object_for(wm, collection=coll))
    if S['kind'] == 'room' and S.get('room'):
        objs.extend(build_room(S['room'], coll))
    if S['kind'] == 'room' and S.get('skirting'):
        objs.append(_box('stage_skirting', (0, S['skirting'] / 2, -S['back'] + 0.01), (S['width'], S['skirting'], 0.02), (0.07, 0.065, 0.06), 0.45, coll))
    if S['kind'] == 'yard':
        objs.append(_box('stage_cap', (0, S['height'] + 0.04, -S['back'] + 0.08), (S['width'], 0.08, 0.32), (0.2, 0.195, 0.185), 0.85, coll))
    return objs


def room_material():
    """the furniture's material: the point colour attribute 'Col' (linear albedo) on a Principled BSDF, roughness 0.62 (paint, paper, wood and cloth: a satin that is none of them exactly; the engine's room uses the same)"""
    m, nt, out = mat_new('stage_room')
    p = nt.nodes.new('ShaderNodeBsdfPrincipled'); p.inputs['Metallic'].default_value = 0.0; p.inputs['Roughness'].default_value = 0.62
    at = nt.nodes.new('ShaderNodeAttribute'); at.attribute_type = 'GEOMETRY'; at.attribute_name = 'Col'
    nt.links.new(at.outputs['Color'], p.inputs['Base Color']); nt.links.new(p.outputs['BSDF'], out.inputs['Surface'])
    return m


def build_room(R, coll):
    """CAMERA7 c4: the furniture of set.room (room.js via roompack.js): two meshes, 'flat' (boxes: one vertex per face corner, flat shading) and 'smooth' (the curtain's pleats, the leaves, the pot: shared vertices,
    smooth shading); positions are three's frame (the wall is the plane z = -back), converted to Blender's (x, -z, y); vertex colour = the linear albedo"""
    import base64
    from person_io import add_point_attr
    d = json.load(open(os.path.join(ASSETS, R['file'])))
    mat, objs = room_material(), []
    for key, smooth in (('flat', False), ('smooth', True)):
        g = d[key]
        if not g['t']:
            continue
        P = np.frombuffer(base64.b64decode(g['p']), dtype='<f4').reshape(-1, 3).astype(np.float32)
        C = np.frombuffer(base64.b64decode(g['c']), dtype='<f4').reshape(-1, 3).astype(np.float32)
        T = np.frombuffer(base64.b64decode(g['i']), dtype='<u4').reshape(-1, 3).astype(np.int32)
        assert len(P) == g['n'] and len(T) == g['t'], 'room file: counts'
        Pb = np.stack([P[:, 0], -P[:, 2], P[:, 1]], 1)
        me = build_mesh('stage_room_' + key, Pb, T, N=None, smooth=smooth)
        add_point_attr(me, 'Col', np.concatenate([C, np.ones((len(C), 1), np.float32)], 1), 'FLOAT_COLOR')
        me.materials.append(mat)
        objs.append(object_for(me, collection=coll))
    return objs


def _box(name, c, size, rgb, rough, coll):
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    ob = bpy.context.active_object; ob.name = name
    ob.scale = (size[0], size[2], size[1]); ob.location = B(c)
    for c0 in ob.users_collection:
        c0.objects.unlink(ob)
    coll.objects.link(ob)
    m, nt, out = mat_new(name); p = nt.nodes.new('ShaderNodeBsdfPrincipled'); p.inputs['Base Color'].default_value = tuple(rgb) + (1,); p.inputs['Roughness'].default_value = rough
    nt.links.new(p.outputs['BSDF'], out.inputs['Surface']); ob.data.materials.append(m)
    return ob


def window_emitter(K, coll, C):
    """CAMERA7 c3 i2: a window as ONE emitter (lib/fx/stage/window.js). The key's rectangle (centre, right, up, w x h m, in three's frame) becomes an emissive mesh whose colour is the radiance image
    window_r7_emit.hdr (cd/m2: the sky's gradient, the mullions; derived from the lux the face must receive) times C, one-sided (it emits toward the sitter), invisible to the camera, a shadow
    caster for nothing, seen by glossy and diffuse rays: the cornea mirrors a window with its panes at its true radiance, the skin's sheen is the window's, the wall behind is lit by it."""
    Wd = K['emitter']
    c, r, u = B(Wd['centre']), B(Wd['right']), B(Wd['up']); n_want = B(Wd['normal']).normalized()
    hw, hh = Wd['w'] / 2.0, Wd['h'] / 2.0
    corners = [(-1, -1), (-1, 1), (1, 1), (1, -1)]
    P = [c + r * (hw * a) + u * (hh * b) for a, b in corners]
    ngeo = (P[1] - P[0]).cross(P[2] - P[0])
    if ngeo.dot(n_want) < 0:      # the winding is the emitting side's: front faces the sitter
        corners = corners[::-1]; P = P[::-1]
    me = bpy.data.meshes.new('stage_window'); me.from_pydata([tuple(p) for p in P], [], [(0, 1, 2, 3)]); me.update()
    uv = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            a, b = corners[me.loops[li].vertex_index]; uv.data[li].uv = ((a + 1) / 2.0, (b + 1) / 2.0)
    m, nt, out = mat_new('stage_window_emitter')
    uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'UVMap'
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = _img(Wd['image'], 'Non-Color'); t.interpolation = 'Linear'; t.extension = 'EXTEND'
    nt.links.new(uvn.outputs['UV'], t.inputs['Vector'])
    em = nt.nodes.new('ShaderNodeEmission'); nt.links.new(t.outputs['Color'], em.inputs['Color'])
    geo = nt.nodes.new('ShaderNodeNewGeometry'); inv = nt.nodes.new('ShaderNodeMath'); inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 1.0
    nt.links.new(geo.outputs['Backfacing'], inv.inputs[1])
    st = nt.nodes.new('ShaderNodeMath'); st.operation = 'MULTIPLY'; st.inputs[1].default_value = float(C); nt.links.new(inv.outputs[0], st.inputs[0])
    nt.links.new(st.outputs[0], em.inputs['Strength']); nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    me.materials.append(m); ob = object_for(me, collection=coll)
    ob.visible_camera = False; ob.visible_shadow = False; ob.visible_glossy = True; ob.visible_diffuse = True; ob.visible_transmission = True; ob.visible_volume_scatter = False
    return ob


def build_light(rec, coll, C):
    sc = bpy.context.scene
    w = bpy.data.worlds.new('stage_' + rec['name']); w.use_nodes = True; nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputWorld'); bg = nt.nodes.new('ShaderNodeBackground'); et = nt.nodes.new('ShaderNodeTexEnvironment')
    et.image = bpy.data.images.load(os.path.join(ASSETS, rec['env']['file']), check_existing=True); et.interpolation = 'Linear'
    nt.links.new(et.outputs['Color'], bg.inputs['Color']); bg.inputs['Strength'].default_value = C
    nt.links.new(bg.outputs['Background'], out.inputs['Surface']); sc.world = w
    objs = []
    K = rec.get('key')
    if K and K.get('emitter'):
        objs.append(window_emitter(K, coll, C))   # CAMERA7 c3 i2: the window is the key (no sun)
    elif K and max(K['rgbLux']) > 0:
        E = np.array(K['rgbLux'], float); mx = float(E.max())
        ld = bpy.data.lights.new('stage_key', 'SUN'); ld.angle = math.radians(K['angleDeg']); ld.energy = mx * C; ld.color = tuple(E / mx)
        ob = bpy.data.objects.new('stage_key', ld); coll.objects.link(ob)
        d = B(K['dir']).normalized(); ob.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler(); objs.append(ob)
    for L in rec.get('lamps', []):
        rgb = np.array(L.get('rgb', [1, 1, 1]), float); mx = float(rgb.max())
        ld = bpy.data.lights.new('stage_' + L.get('name', 'lamp'), 'SPOT'); ld.energy = 4 * math.pi * L['cd'] * mx * C; ld.color = tuple(rgb / mx)
        ld.spot_size = 2 * L.get('half', 0.6); ld.spot_blend = L.get('pen', 0.5); ld.shadow_soft_size = L.get('size', 0.2) / 2
        ob = bpy.data.objects.new(ld.name, ld); coll.objects.link(ob); ob.location = B(L['pos'])
        aim = (B(L['aim']) - B(L['pos'])).normalized(); ob.rotation_euler = aim.to_track_quat('-Z', 'Y').to_euler()
        if L.get('shadow') is False:
            ld.use_shadow = False
        objs.append(ob)
    return objs


def apply(name, parts):
    """after person_scene.build(): remove its ground (and any sun it added), build the stage; returns the stage record + objects.
    parts['ground'] becomes None and parts['stage'] lists what the meter should hide (the set)"""
    rec = records()[name]
    sc = bpy.context.scene
    if parts.get('ground') is not None:
        bpy.data.objects.remove(parts['ground'], do_unlink=True); parts['ground'] = None
    for ob in list(sc.objects):
        if ob.type == 'LIGHT' and ob.name.startswith('sun'):
            bpy.data.objects.remove(ob, do_unlink=True)
    coll = bpy.data.collections.new('stage'); sc.collection.children.link(coll)
    key = rec.get('key') or {}
    lum = 0.2126 * key['rgbLux'][0] + 0.7152 * key['rgbLux'][1] + 0.0722 * key['rgbLux'][2] if key and max(key['rgbLux']) > 0 else 17000.0
    C = 1.0 / lum
    set_objs = build_set(rec, coll)
    light_objs = build_light(rec, coll, C)
    parts['stage'] = set_objs
    return dict(record=rec, set=set_objs, lights=light_objs, C=C)
