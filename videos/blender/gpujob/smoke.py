"""The deploy smoke test for Blender jobs on the farm (FARMGPU, 3 Oct 2026; research/capabilities/farm_gpu.md).

  sh videos/scripts/gpu_job.sh blender videos/blender/gpujob/smoke.py --gpus 1 --time 15 -- [--res 960x960] [--samples 256]

A neutral test scene built here (floor, a subsurface sphere with random-walk SSS, a glass sphere, a metal monkey head, an
area light and a sun), rendered:
  1. Cycles on the device gpu_job chose (CUDA by default)       -> cycles_<CUDA|OPTIX|CPU>.png
  2. Cycles on the other NVIDIA backend, if Blender sees it      -> cycles_<OPTIX|CUDA>.png  (both: compare the times)
  3. EEVEE, headless through EGL                                -> eevee.png (+ the GL renderer string: must name the V100)
  smoke.json: per render its time, device and result. Exits 1 if (1) fails; (2) and (3) are reported, not fatal, unless
  --strict (then every one must pass and EEVEE must not be drawing on a software renderer).
"""
import json, math, os, sys, time

import bpy

from gpujob import devices


def opts():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    o = {'res': '960x960', 'samples': '256', 'strict': False}
    i = 0
    while i < len(argv):
        if argv[i] == '--strict':
            o['strict'] = True; i += 1
        else:
            o[argv[i].lstrip('-')] = argv[i + 1]; i += 2
    return o


def build(w, h):
    for ob in list(bpy.data.objects):            # an empty scene (not read_factory_settings: that resets the device prefs)
        bpy.data.objects.remove(ob, do_unlink=True)
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = w, h, 100
    world = bpy.data.worlds.new('w'); sc.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.05, 0.06, 0.08, 1)

    def mat(name, **kw):
        m = bpy.data.materials.new(name); m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        for k, v in kw.items():
            b.inputs[k].default_value = v
        return m

    bpy.ops.mesh.primitive_plane_add(size=20)
    bpy.context.object.data.materials.append(mat('floor', **{'Base Color': (0.5, 0.5, 0.5, 1), 'Roughness': 0.6}))
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=(-2.2, 0, 1), segments=96, ring_count=48)
    bpy.ops.object.shade_smooth()
    sss = mat('sss', **{'Base Color': (0.8, 0.55, 0.45, 1), 'Subsurface Weight': 1.0, 'Subsurface Radius': (1.0, 0.35, 0.2),
                         'Subsurface Scale': 0.2, 'Roughness': 0.45})
    bpy.context.object.data.materials.append(sss)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=(0, 0.6, 1), segments=96, ring_count=48)
    bpy.ops.object.shade_smooth()
    bpy.context.object.data.materials.append(mat('glass', **{'Transmission Weight': 1.0, 'Roughness': 0.0, 'IOR': 1.45}))
    bpy.ops.mesh.primitive_monkey_add(location=(2.2, 0, 1), rotation=(0, 0, math.radians(-20)))
    bpy.ops.object.modifier_add(type='SUBSURF'); bpy.context.object.modifiers[0].levels = 2
    bpy.ops.object.shade_smooth()
    bpy.context.object.data.materials.append(mat('metal', **{'Base Color': (0.9, 0.7, 0.4, 1), 'Metallic': 1.0, 'Roughness': 0.25}))
    bpy.ops.object.light_add(type='AREA', location=(-3, -3, 5)); L = bpy.context.object
    L.data.energy, L.data.size = 1500, 3; L.rotation_euler = (math.radians(40), 0, math.radians(-45))
    bpy.ops.object.light_add(type='SUN', location=(0, 0, 10)); S = bpy.context.object
    S.data.energy = 2.0; S.rotation_euler = (math.radians(50), math.radians(10), math.radians(30))
    bpy.ops.object.camera_add(location=(0, -9, 3.2), rotation=(math.radians(78), 0, 0)); sc.camera = bpy.context.object
    return sc


def render(sc, out, name):
    sc.render.filepath = os.path.join(out, name)
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    return round(time.time() - t0, 2), os.path.isfile(sc.render.filepath)


def main():
    o = opts()
    w, h = (int(x) for x in o['res'].lower().split('x'))
    out = os.environ.get('GPU_OUT') or os.path.abspath('smoke_out')
    os.makedirs(out, exist_ok=True)
    sc = build(w, h)
    sc.render.image_settings.file_format = 'PNG'
    rep = {'blender': bpy.app.version_string, 'res': [w, h], 'samples': int(o['samples']), 'devices': dict(devices.STATE), 'renders': []}
    prefs = bpy.context.preferences.addons['cycles'].preferences
    first = devices.STATE.get('type', 'CPU')
    order = [first] + [t for t in ('CUDA', 'OPTIX') if t != first and first != 'CPU']
    for t in order:
        r = {'engine': 'CYCLES', 'device': t}
        try:
            if t != 'CPU':
                prefs.compute_device_type = t
                prefs.refresh_devices()
                gp = [d for d in prefs.devices if d.type == t]
                for d in prefs.devices:
                    d.use = d.type == t
                r['cards'] = [d.name for d in gp]
                if not gp:
                    raise RuntimeError('Blender sees no %s device' % t)
            sc.render.engine = 'CYCLES'
            sc.cycles.device = 'GPU' if t != 'CPU' else 'CPU'
            sc.cycles.samples = int(o['samples'])
            sc.cycles.use_denoising = True
            sc.cycles.denoiser = 'OPENIMAGEDENOISE'
            if hasattr(sc.cycles, 'denoising_use_gpu'):
                sc.cycles.denoising_use_gpu = t != 'CPU'
            r['seconds'], r['ok'] = render(sc, out, 'cycles_%s.png' % t)
        except Exception as e:                    # noqa: BLE001
            r['ok'], r['error'] = False, str(e)[:300]
        rep['renders'].append(r)
        print('smoke: %s' % json.dumps(r), flush=True)
    if first != 'CPU':                            # back to the device the job asked for
        prefs.compute_device_type = first
        prefs.refresh_devices()
        for d in prefs.devices:
            d.use = d.type == first
    r = {'engine': 'BLENDER_EEVEE'}
    try:
        sc.render.engine = 'BLENDER_EEVEE'
        sc.eevee.taa_render_samples = 64
        r['seconds'], r['ok'] = render(sc, out, 'eevee.png')
        r['gl'] = devices.gl_info()
        rn = (r['gl'].get('renderer') or '').lower()
        r['software'] = any(s in rn for s in ('llvmpipe', 'softpipe', 'swiftshader', 'lavapipe'))
    except Exception as e:                        # noqa: BLE001
        r['ok'], r['error'] = False, str(e)[:300]
    rep['renders'].append(r)
    print('smoke: %s' % json.dumps(r), flush=True)
    rep['pass'] = {'cycles_first': rep['renders'][0]['ok'], 'all': all(x['ok'] for x in rep['renders']),
                   'eevee_on_gpu': r.get('ok') and not r.get('software')}
    with open(os.path.join(out, 'smoke.json'), 'w') as f:
        json.dump(rep, f, indent=1)
    if not rep['pass']['cycles_first'] or (o['strict'] and not (rep['pass']['all'] and rep['pass']['eevee_on_gpu'])):
        raise SystemExit('smoke: FAILED %s' % json.dumps(rep['pass']))
    print('smoke: passed %s' % json.dumps(rep['pass']), flush=True)


main()
