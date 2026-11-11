"""FARM GPU device setup inside Blender (FARMGPU, 3 Oct 2026; research/capabilities/farm_gpu.md).

gpu_job.sh runs `blender -b --factory-startup [FILE.blend] --python gpujob/boot.py --python YOUR_SCRIPT.py -- ARGS`.
boot.py calls setup() once, before your script:
  - Cycles: the compute device type from GPU_JOB_DEVICE (cuda default, optix, auto = CUDA then OptiX, cpu), every visible
    card of that type switched on, the CPU device off; every scene's cycles.device = 'GPU'. Both are applied again after any
    file load, including read_factory_settings() (a persistent load_post handler), and at the start of every render
    (render_init), so a scene your script creates, opens or resets still renders on the cards. With GPU_JOB_REQUIRE_GPU=1 (the farm) no usable card is a failure, never a silent CPU run.
  - What was chosen goes to $GPU_TMP/blender_devices_<shard>.json, which gpu_job.py puts in the receipt.
In your script:  from gpujob import devices;  devices.apply(scene);  devices.STATE  (what was chosen)
EEVEE needs nothing here: Blender 5 renders it headless through EGL (libEGL.so.1 + the NVIDIA EGL vendor file on the worker).
"""
import json, os

import bpy

STATE = {}


def _scenes(scene=None):
    return [scene] if scene is not None else list(bpy.data.scenes)


def apply(scene=None):
    """put this scene (or every scene) on the chosen device; returns the device ('GPU' or 'CPU')"""
    dev = 'GPU' if STATE.get('type') not in (None, 'CPU') else 'CPU'
    for sc in _scenes(scene):
        try:
            sc.cycles.device = dev
        except AttributeError:
            pass
    return dev


def _prefs():
    """(re)select the chosen backend and its cards in the preferences: read_factory_settings() in a job script resets them"""
    t = STATE.get('type')
    if t in (None, 'CPU'):
        return
    prefs = bpy.context.preferences.addons['cycles'].preferences
    if prefs.compute_device_type != t:
        prefs.compute_device_type = t
        prefs.refresh_devices()
    for d in prefs.devices:
        d.use = d.type == t


@bpy.app.handlers.persistent
def _on_load(*_):
    _prefs()
    apply()


@bpy.app.handlers.persistent
def _on_render(scene, *_):
    _prefs()
    apply(scene)


def setup():
    want = os.environ.get('GPU_JOB_DEVICE', 'cuda').lower()
    require = os.environ.get('GPU_JOB_REQUIRE_GPU') == '1'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    order = {'cuda': ['CUDA'], 'optix': ['OPTIX'], 'auto': ['CUDA', 'OPTIX'], 'cpu': []}.get(want, ['CUDA'])
    tried, chosen, used = [], 'CPU', []
    for t in order:
        try:
            prefs.compute_device_type = t
        except (TypeError, ValueError) as e:
            tried.append('%s: not in this Blender (%s)' % (t, e))
            continue
        prefs.refresh_devices()
        gpus = [d for d in prefs.devices if d.type == t]
        if not gpus:
            tried.append('%s: no device found' % t)
            continue
        for d in prefs.devices:
            d.use = d.type == t
        chosen, used = t, [d.name for d in gpus]
        break
    if chosen == 'CPU':
        try:
            prefs.compute_device_type = 'NONE'
        except (TypeError, ValueError):
            pass
    STATE.update({'blender': bpy.app.version_string, 'asked': want, 'type': chosen, 'devices': used, 'tried': tried,
                  'cuda_visible_devices': os.environ.get('CUDA_VISIBLE_DEVICES'), 'shard': os.environ.get('GPU_JOB_SHARD', '0'),
                  'threads': bpy.context.scene.render.threads if bpy.context.scene else None})
    tmp = os.environ.get('GPU_TMP')
    if tmp and os.path.isdir(tmp):
        with open(os.path.join(tmp, 'blender_devices_%s.json' % STATE['shard']), 'w') as f:
            json.dump(STATE, f, indent=1)
    print('gpujob: Cycles device %s %s%s' % (chosen, used or '', ('; tried: ' + '; '.join(tried)) if tried else ''), flush=True)
    if chosen == 'CPU' and require:
        raise SystemExit('GPU_JOB: no usable %s device in Blender (%s) but GPU_JOB_REQUIRE_GPU=1' % (
            '/'.join(order) or 'GPU', '; '.join(tried) or 'asked for cpu'))
    apply()
    if _on_load not in bpy.app.handlers.load_post:
        bpy.app.handlers.load_post.append(_on_load)
    if _on_render not in bpy.app.handlers.render_init:
        bpy.app.handlers.render_init.append(_on_render)
    return STATE


def gl_info():
    """the GPU backend EEVEE drew with (after an EEVEE render; None before a GL/Vulkan context exists)"""
    try:
        import gpu
        return {'backend': gpu.platform.backend_type_get(), 'renderer': gpu.platform.renderer_get(),
                'vendor': gpu.platform.vendor_get(), 'version': gpu.platform.version_get()}
    except Exception as e:                       # noqa: BLE001 (no context yet, or an older API)
        return {'error': str(e)[:200]}
