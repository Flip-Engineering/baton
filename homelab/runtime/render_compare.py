"""Actual rendered comparison for issue #87 (Blender Workbench, CPU).

Renders the same seed-derived human proxy (capsule body, head, cloth plane)
twice -- photorealistic vs stylized material register -- at 320x568, and
records PNG SHA-256 + pixel statistics. No GPU render is launched, so farm
GPU admission / duplicate-render policies are untouched; check with
farm admission_policy before any farm submission.
Usage: python3 render_compare.py [--out DIR] [--blender PATH]
"""
import argparse, hashlib, json, pathlib, subprocess, sys

BLENDER_SCRIPT = r'''
import bpy, json, math, random, sys
argv = sys.argv[sys.argv.index('--') + 1:]
out, seed, style = argv[0], int(argv[1]), argv[2]
rng = random.Random(seed)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'MATERIAL'
scene.render.resolution_x, scene.render.resolution_y = 320, 568
scene.render.resolution_percentage = 100
world = bpy.data.worlds.new('W'); scene.world = world; world.color = (0.02, 0.02, 0.03)
def mat(name, rgb, metallic=0.0, rough=0.6):
    m = bpy.data.materials.new(name); m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = rough
    if style == 'photorealistic': bsdf.inputs['Subsurface Weight'].default_value = 0.25
    else: bsdf.inputs['Emission Strength'].default_value = 0.15
    m.diffuse_color = (*rgb, 1); return m
skin = mat('skin', (0.72, 0.48, 0.36) if style == 'photorealistic' else (0.95, 0.62, 0.42), rough=0.55)
cloth_c = (0.55, 0.08, 0.07) if style == 'photorealistic' else (0.9, 0.12, 0.1)
cloth = mat('cloth', cloth_c, rough=0.85)
# body: capsule proxy; head; cloth plane displaced by seeded wave (cloth proxy)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.32, location=(0, 0, 1.62)); head = bpy.context.object; head.data.materials.append(skin); head.scale = (0.85, 0.9, 1.05)
bpy.ops.mesh.primitive_cylinder_add(radius=0.34, depth=1.15, location=(0, 0, 0.95)); body = bpy.context.object; body.data.materials.append(cloth)
bpy.ops.mesh.primitive_plane_add(size=1.1, location=(0.45, -0.25, 0.75)); plane = bpy.context.object; plane.rotation_euler = (math.radians(75), 0, 0.3)
mesh = plane.data
for v in mesh.vertices: v.co.z += 0.08 * math.sin(v.co.x * 6 + rng.random()) + 0.04 * math.cos(v.co.y * 5)
plane.data.materials.append(cloth)
bpy.ops.object.light_add(type='AREA', location=(2.5, -2.5, 3.2)); bpy.context.object.data.energy = 900
bpy.ops.object.camera_add(location=(0, -3.4, 1.25)); cam = bpy.context.object; cam.rotation_euler = (math.radians(88), 0, 0); scene.camera = cam
scene.render.filepath = out; bpy.ops.render.render(write_still=True)
img = bpy.data.images.load(out); px = img.pixels[:]
rgb = []
for ch in range(3):
    vals = px[ch::4][::97]
    rgb.append(sum(vals) / max(1, len(vals)))
print('RENDER_STATS ' + json.dumps({'style': style, 'seed': seed, 'mean_rgb_sampled': [round(c, 4) for c in rgb]}))
'''

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', default='/tmp/human-sim-render-compare')
    ap.add_argument('--blender', default='/opt/blender/blender'); a = ap.parse_args()
    sys.path.insert(0, str(pathlib.Path(__file__).parent))
    import human_sim
    out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)
    script = out / 'proxy_scene.py'; script.write_text(BLENDER_SCRIPT)
    results = {}
    for style in ('photorealistic', 'stylized'):
        seed = human_sim.derive_seed(human_sim.ISSUE87_SEED, 'skin')
        png = out / f'proxy_{style}.png'
        run = subprocess.run([a.blender, '--background', '--python', str(script), '--', str(png), str(seed), style],
                             capture_output=True, text=True, timeout=300)
        stats = [l for l in run.stdout.splitlines() if l.startswith('RENDER_STATS ')]
        if run.returncode or not png.is_file() or not stats:
            raise SystemExit(f'render failed ({style}): rc={run.returncode} {run.stderr[-500:]}')
        results[style] = {'png': str(png), 'sha256': hashlib.sha256(png.read_bytes()).hexdigest(),
                          'bytes': png.stat().st_size, **json.loads(stats[0][13:])}
    report = {'tool': 'Blender 5.2.2 LTS', 'engine': 'BLENDER_WORKBENCH (CPU, no GPU render)',
              'script_sha256': hashlib.sha256(script.read_bytes()).hexdigest(),
              'module_sha256': hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),
              'results': results, 'differ': results['photorealistic']['sha256'] != results['stylized']['sha256']}
    (out / 'comparison.json').write_text(json.dumps(report, indent=1, sort_keys=True))
    print(json.dumps(report, indent=1, sort_keys=True))

if __name__ == '__main__': main()
