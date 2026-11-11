"""A tiny neutral scene builder for testing stills.py (FARMGPU): a floor, a cube that turns over frames 1-10, two cameras
(Cam_A, Cam_B) and a sun. --size S scales the cube. Used by gpu_job_selftest.py and as the example of a scene builder."""
import math, sys

import bpy

size = float(sys.argv[sys.argv.index('--size') + 1]) if '--size' in sys.argv else 1.0
for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)
sc = bpy.context.scene
sc.frame_start, sc.frame_end = 1, 10
bpy.ops.mesh.primitive_plane_add(size=10)
bpy.ops.mesh.primitive_cube_add(size=size, location=(0, 0, size / 2 + 0.2))
cube = bpy.context.object
cube.rotation_euler = (0, 0, 0); cube.keyframe_insert('rotation_euler', frame=1)
cube.rotation_euler = (0, 0, math.radians(90)); cube.keyframe_insert('rotation_euler', frame=10)
bpy.ops.object.light_add(type='SUN', location=(0, 0, 5)); bpy.context.object.data.energy = 3
bpy.ops.object.camera_add(location=(0, -6, 2.5), rotation=(math.radians(72), 0, 0)); bpy.context.object.name = 'Cam_A'
sc.camera = bpy.context.object
bpy.ops.object.camera_add(location=(5, -3, 3), rotation=(math.radians(65), 0, math.radians(58))); bpy.context.object.name = 'Cam_B'
print('selftest_scene: built, cube size %g' % size)
