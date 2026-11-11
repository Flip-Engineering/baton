# CYCLES step 2: a UV atlas for the exported body (two atlases: 0 head + jaw + neck, 1 the rest), so lane B's skin can be baked from its
# own shader (web/labs/human8/bake_skin.mjs) and read back by Cycles. Unwrapped on the BIND mesh (least stretch), Smart UV Project per
# atlas, islands packed into 0..1 each.
#   blender -b --factory-startup -P videos/blender/unwrap.py -- <export dir> [--angle 66] [--margin 0.004]
# -> <export dir>/uv.bin (float32 u, v per triangle corner, face order = the export's index order) + atlas.bin (uint8 per triangle)
import sys, os, time, math, json
import numpy as np
import bpy
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from person_io import Person, build_mesh, object_for, atlas_of_triangles

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
d = argv[0]
angle = float(argv[argv.index('--angle') + 1]) if '--angle' in argv else 66.0
margin = float(argv[argv.index('--margin') + 1]) if '--margin' in argv else 0.004
# (LIGHT5, opt-in) --fix-overlap: Smart UV Project can lay a fold of the bind surface (the armpit beside the chest, the elbow of a folded
# arm, the ear, the inner lip) over itself inside one island: those texels then hold another part's skin and Cycles shows a patch with a
# sharp edge (judge c10: L21's chest, L08's shoulder). After the first pack, the faces on overlapping UVs are cut out as their own
# islands, unwrapped again with a tighter angle, and everything repacked; repeated while any overlap remains (at most 4 times).
FIX = '--fix-overlap' in argv
t0 = time.time()
pp = Person(d)
B = pp.body
bind = pp.arr(B['bind'], 3)
tri = pp.arr(B['index'], 3)
reg = pp.arr(B['aHero'], 4)[:, 0]
atlas = atlas_of_triangles(reg, tri)
# bind is three's frame; turn it to Blender's for a natural projection (it does not matter for the atlas)
P = np.stack([bind[:, 0], -bind[:, 2], bind[:, 1]], axis=1)
bpy.ops.wm.read_factory_settings(use_empty=True)
# one mesh per atlas (packing the two in one mesh let the second pack take the first atlas's islands with it)
uv = np.zeros((len(tri) * 3, 2), dtype=np.float32)
for a in (0, 1):
    k = np.nonzero(atlas == a)[0]
    me = build_mesh('atlas%d' % a, P, tri[k], smooth=False)
    ob = object_for(me)
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.scene.objects:
        o.select_set(o is ob)
    me.uv_layers.new(name='atlas')
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    if FIX:
        import bmesh
        for it in range(4):
            bm = bmesh.from_edit_mesh(me); bm.faces.ensure_lookup_table()
            bpy.ops.mesh.select_all(action='DESELECT'); bpy.ops.uv.select_all(action='DESELECT')
            bpy.context.scene.tool_settings.use_uv_select_sync = True
            bpy.ops.uv.select_overlap()
            bm = bmesh.from_edit_mesh(me); sel = [f for f in bm.faces if f.select]
            print(f'unwrap atlas {a}: pass {it}: {len(sel)} faces on overlapping UVs')
            if not sel:
                break
            # grow by one ring, cut the selection out as its own islands, unwrap it with a tighter angle, repack all
            bpy.ops.mesh.select_more(); bpy.ops.mesh.mark_seam(clear=False); bpy.ops.mesh.region_to_loop(); bpy.ops.mesh.mark_seam(clear=False)
            bpy.ops.mesh.select_all(action='DESELECT'); bm = bmesh.from_edit_mesh(me)
            for f in sel:
                f.select = True
            bpy.ops.mesh.select_more()
            bpy.ops.uv.smart_project(angle_limit=math.radians(max(20.0, angle * 0.5 ** (it + 1))), island_margin=margin, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
            bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.uv.select_all(action='SELECT')
            bpy.ops.uv.average_islands_scale()      # the re-unwrapped pieces come back scaled to the unit square: one texel density again
            pk = dict(x.split('=') for x in os.environ.get('L5_PACK', 'shape_method=CONCAVE,margin_method=FRACTION').split(','))
            bpy.ops.uv.pack_islands(rotate=True, margin=margin, **pk)
        bpy.context.scene.tool_settings.use_uv_select_sync = False
    bpy.ops.object.mode_set(mode='OBJECT')
    u = np.zeros(len(me.loops) * 2, dtype=np.float32)
    me.uv_layers['atlas'].data.foreach_get('uv', u)
    # build_mesh keeps face order and corner order, but validate() may drop nothing here: check the counts
    assert len(me.polygons) == len(k), 'unwrap: polygons dropped by validate'
    uv.reshape(-1, 3, 2)[k] = u.reshape(-1, 3, 2)
uv.astype(np.float32).tofile(os.path.join(d, 'uv.bin'))
# ---- garments: all of them in ONE atlas (garment_uv.bin: float32 u, v per triangle corner, the manifest's garment order, each
# garment's triangles in its index order; garment_uv.json: per garment the corner offset and count)
G = [r for r in pp.m['meshes'][1:] if r.get('kind') == 'garment']
if G:
    Ps, Ts, o = [], [], 0
    for r in G:
        b = pp.arr(r['bind'], 3); t = pp.arr(r['index'], 3)
        Ps.append(np.stack([b[:, 0], -b[:, 2], b[:, 1]], axis=1)); Ts.append(t + o); o += len(b)
    me = build_mesh('garments', np.concatenate(Ps), np.concatenate(Ts), smooth=False)
    ob = object_for(me); bpy.context.view_layer.objects.active = ob
    for x in bpy.context.scene.objects:
        x.select_set(x is ob)
    me.uv_layers.new(name='atlas')
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.select_all(action='SELECT'); bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')
    assert len(me.polygons) == sum(len(t) for t in Ts), 'unwrap: garment polygons dropped'
    gu = np.zeros(len(me.loops) * 2, dtype=np.float32); me.uv_layers['atlas'].data.foreach_get('uv', gu)
    gu.astype(np.float32).tofile(os.path.join(d, 'garment_uv.bin'))
    idx, c = [], 0
    for r, t in zip(G, Ts):
        idx.append(dict(name=r['name'], corner=c, corners=len(t) * 3)); c += len(t) * 3
    json.dump(idx, open(os.path.join(d, 'garment_uv.json'), 'w'), indent=1)
    print(f'garments: {len(G)} meshes, {c // 3} triangles in one atlas')
atlas.astype(np.uint8).tofile(os.path.join(d, 'atlas.bin'))
# texel density per atlas (bind m per texel at 4096): sqrt(surface area / uv area) / 4096
def area3(Pa):
    return 0.5 * np.linalg.norm(np.cross(Pa[:, 1] - Pa[:, 0], Pa[:, 2] - Pa[:, 0]), axis=1)
T3 = bind[tri]
U3 = uv.reshape(-1, 3, 2)
ua = 0.5 * np.abs((U3[:, 1, 0] - U3[:, 0, 0]) * (U3[:, 2, 1] - U3[:, 0, 1]) - (U3[:, 2, 0] - U3[:, 0, 0]) * (U3[:, 1, 1] - U3[:, 0, 1]))
sa = area3(T3)
for a in (0, 1):
    k = atlas == a
    print(f'atlas {a}: {k.sum()} triangles, surface {sa[k].sum():.3f} m2, uv coverage {ua[k].sum():.2f}, texel at 4096 = {math.sqrt(sa[k].sum() / max(ua[k].sum(), 1e-9)) / 4096 * 1000:.3f} mm')
print(f'unwrap done in {time.time() - t0:.1f} s -> {d}/uv.bin')
