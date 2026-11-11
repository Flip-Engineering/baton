"""Render a still list or a frame range of a Blender scene on the farm (FARMGPU, 3 Oct 2026; research/capabilities/farm_gpu.md).

A job script for gpu_job.sh (kind blender). The scene comes from a committed .blend (gpu_job.sh --blend FILE), from a scene
builder script (--scene videos/blender/....py, run first with --scene-args as its sys.argv; it builds into the current
scene), or both (the builder runs after the .blend opened). Then:

  --still TAG=FRAME[@CAMERA]   one still (repeatable): out stills/TAG.<ext> at that frame, through that camera object
  --frames A-B[:STEP]          a frame range: out frames/NNNN.<ext>
  (neither: the scene's current frame as stills/still.<ext>)
  --samples N    Cycles samples (EEVEE: TAA samples)          --res WxH   --percent P (resolution percentage)
  --engine cycles|eevee|keep (default keep: what the scene says)
  --denoise oidn|optix|none|keep (default keep)               --format png|png16|exr|jpg (default png)
  --seed N       --view keep|AgX|Standard|Filmic|Khronos PBR Neutral (view transform)     --save-blend (out scene.blend)

With gpu_job.sh --per-gpu the items (stills first, then frames) are dealt round-robin over the cards (GPU_JOB_SHARD of
GPU_JOB_SHARDS). Each process writes stills_report_<shard>.json: per image its frame, camera, seconds, engine, device,
samples, size, plus the devices chosen and (for EEVEE) the GL renderer that drew it.
Example (a still list of a scene builder, two cards, one process each):
  sh videos/scripts/gpu_job.sh blender videos/blender/gpujob/stills.py --gpus 2 --per-gpu -- \
     --scene videos/blender/bakeoff/build.py --scene-args "--who L14" --still face=1@cam_face --still full=1@cam_full --samples 512
"""
import json, os, re, runpy, shlex, sys, time

import bpy

from gpujob import devices

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
FORMATS = {'png': ('PNG', '8', 'png'), 'png16': ('PNG', '16', 'png'), 'exr': ('OPEN_EXR', '16', 'exr'), 'jpg': ('JPEG', '8', 'jpg')}


def die(msg):
    raise SystemExit('stills: ' + msg)


def args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    o = {'scene': None, 'scene_args': '', 'still': [], 'frames': None, 'samples': None, 'res': None, 'percent': None,
         'engine': 'keep', 'denoise': 'keep', 'format': 'png', 'seed': None, 'view': 'keep', 'save_blend': False}
    i = 0
    while i < len(argv):
        k = argv[i].lstrip('-').replace('-', '_')
        if k == 'save_blend':
            o['save_blend'] = True; i += 1; continue
        if k not in o or i + 1 >= len(argv):
            die('unknown option or missing value: %s' % argv[i])
        v = argv[i + 1]
        if k == 'still':
            o['still'].append(v)
        else:
            o[k] = v
        i += 2
    return o


def repo_file(p, under='videos/blender/'):
    if p.startswith('/') or '..' in p.split('/') or not p.startswith(under) or not p.endswith('.py'):
        die('--scene %s: a .py under %s, relative to the repo root, no ".."' % (p, under))
    full = os.path.join(REPO, p)
    if os.path.realpath(full) != os.path.join(os.path.realpath(REPO), p) or not os.path.isfile(full):
        die('--scene %s: not a regular file at its own path (missing, or a symlink)' % p)
    return full


def items(o, scene):
    out = []
    for s in o['still']:
        m = re.fullmatch(r'([A-Za-z0-9_.-]{1,64})=(-?\d+)(?:@(.+))?', s)
        if not m:
            die('--still %s: TAG=FRAME[@CAMERA]' % s)
        out.append({'tag': m.group(1), 'frame': int(m.group(2)), 'camera': m.group(3), 'dir': 'stills'})
    if o['frames']:
        m = re.fullmatch(r'(-?\d+)-(-?\d+)(?::(\d+))?', o['frames'])
        if not m:
            die('--frames %s: A-B[:STEP]' % o['frames'])
        a, b, st = int(m.group(1)), int(m.group(2)), int(m.group(3) or 1)
        out += [{'tag': '%04d' % f, 'frame': f, 'camera': None, 'dir': 'frames'} for f in range(a, b + 1, max(1, st))]
    if not out:
        out.append({'tag': 'still', 'frame': scene.frame_current, 'camera': None, 'dir': 'stills'})
    tags = [(x['dir'], x['tag']) for x in out]
    if len(set(tags)) != len(tags):
        die('two stills share a tag')
    return out


def configure(o, scene):
    if o['engine'] != 'keep':
        scene.render.engine = {'cycles': 'CYCLES', 'eevee': 'BLENDER_EEVEE'}.get(o['engine']) or die('--engine cycles|eevee|keep')
    if o['res']:
        w, h = (int(x) for x in o['res'].lower().split('x'))
        scene.render.resolution_x, scene.render.resolution_y = w, h
    if o['percent']:
        scene.render.resolution_percentage = int(o['percent'])
    if o['samples']:
        if scene.render.engine == 'CYCLES':
            scene.cycles.samples = int(o['samples'])
        else:
            scene.eevee.taa_render_samples = int(o['samples'])
    if o['seed'] is not None and scene.render.engine == 'CYCLES':
        scene.cycles.seed = int(o['seed'])
    if o['denoise'] != 'keep' and scene.render.engine == 'CYCLES':
        scene.cycles.use_denoising = o['denoise'] != 'none'
        if o['denoise'] in ('oidn', 'optix'):
            scene.cycles.denoiser = 'OPENIMAGEDENOISE' if o['denoise'] == 'oidn' else 'OPTIX'
            if hasattr(scene.cycles, 'denoising_use_gpu'):
                scene.cycles.denoising_use_gpu = True
    if o['view'] != 'keep':
        scene.view_settings.view_transform = o['view']
    fmt, depth, ext = FORMATS.get(o['format']) or die('--format png|png16|exr|jpg')
    ims = scene.render.image_settings
    if hasattr(ims, 'media_type'):
        try:
            ims.media_type = 'IMAGE'
        except (TypeError, ValueError):
            pass
    ims.file_format = fmt
    ims.color_depth = depth
    if fmt == 'JPEG':
        ims.quality = 95
    if fmt == 'OPEN_EXR':
        ims.exr_codec = 'ZIP'
    scene.render.use_persistent_data = scene.render.engine == 'CYCLES'
    return ext


def main():
    o = args()
    if o['scene']:
        full = repo_file(o['scene'])
        sys.argv = [full] + shlex.split(o['scene_args'])
        sys.path.insert(0, os.path.dirname(full))
        t0 = time.time()
        runpy.run_path(full, run_name='__main__')
        print('stills: scene %s built in %.1f s' % (o['scene'], time.time() - t0), flush=True)
    scene = bpy.context.scene
    devices.apply()
    ext = configure(o, scene)
    out = os.environ.get('GPU_OUT') or os.path.abspath('gpujob_out')
    shard, shards = int(os.environ.get('GPU_JOB_SHARD', '0')), int(os.environ.get('GPU_JOB_SHARDS', '1'))
    todo = [x for i, x in enumerate(items(o, scene)) if i % shards == shard]
    rows = []
    for x in todo:
        if x['camera']:
            cam = bpy.data.objects.get(x['camera'])
            if cam is None or cam.type != 'CAMERA':
                die('camera %r: no camera object of that name (cameras: %s)' % (
                    x['camera'], ', '.join(c.name for c in bpy.data.objects if c.type == 'CAMERA') or 'none'))
            scene.camera = cam
        if scene.camera is None:
            die('the scene has no camera')
        scene.frame_set(x['frame'])
        os.makedirs(os.path.join(out, x['dir']), exist_ok=True)
        path = os.path.join(out, x['dir'], '%s.%s' % (x['tag'], ext))
        scene.render.filepath = path
        t0 = time.time()
        bpy.ops.render.render(write_still=True)
        dt = time.time() - t0
        if not os.path.isfile(path):
            die('render of %s wrote nothing' % x['tag'])
        rows.append({'tag': x['tag'], 'file': os.path.relpath(path, out), 'frame': x['frame'], 'camera': scene.camera.name,
                     'seconds': round(dt, 2), 'bytes': os.path.getsize(path)})
        print('stills: %s (frame %d, %s) %.1f s' % (rows[-1]['file'], x['frame'], scene.camera.name, dt), flush=True)
    rep = {'blender': bpy.app.version_string, 'engine': scene.render.engine, 'devices': devices.STATE,
           'cycles_device': scene.cycles.device if scene.render.engine == 'CYCLES' else None,
           'samples': scene.cycles.samples if scene.render.engine == 'CYCLES' else scene.eevee.taa_render_samples,
           'denoise': (scene.cycles.use_denoising and scene.cycles.denoiser) if scene.render.engine == 'CYCLES' else None,
           'resolution': [scene.render.resolution_x * scene.render.resolution_percentage // 100,
                          scene.render.resolution_y * scene.render.resolution_percentage // 100],
           'view_transform': scene.view_settings.view_transform, 'shard': shard, 'shards': shards,
           'scene': {'builder': o['scene'], 'scene_args': o['scene_args'], 'blend': bpy.data.filepath and os.path.relpath(bpy.data.filepath, REPO),
                     'objects': len(scene.objects), 'meshes': sum(1 for ob in scene.objects if ob.type == 'MESH'),
                     'lights': sum(1 for ob in scene.objects if ob.type == 'LIGHT')},
           'images': rows, 'render_s': round(sum(r['seconds'] for r in rows), 2)}
    if scene.render.engine != 'CYCLES':
        rep['gl'] = devices.gl_info()
    with open(os.path.join(out, 'stills_report_%d.json' % shard), 'w') as f:
        json.dump(rep, f, indent=1)
    if o['save_blend'] and shard == 0:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, 'scene.blend'), compress=True, copy=True)
    print('stills: %d image(s), %.1f s rendering' % (len(rows), rep['render_s']), flush=True)


main()
