# CYCLES: read a person written by web/lib/fx/person/export.js (manifest.json + person.bin) into numpy, and build Blender meshes.
# Blender's own Python (bpy, numpy are bundled). Frames: the export is already in Blender's (z up, metres); 'bind' attributes stay in
# three's frame (they are texture coordinates: lane B's skin, the weave, the bake atlas are functions of them).
import json, os
import numpy as np

DT = {'Float32Array': np.float32, 'Uint32Array': np.uint32, 'Uint16Array': np.uint16, 'Uint8Array': np.uint8, 'Int32Array': np.int32}


class Person:
    def __init__(self, d):
        self.dir = d
        with open(os.path.join(d, 'manifest.json')) as f:
            self.m = json.load(f)
        self.raw = np.fromfile(os.path.join(d, 'person.bin'), dtype=np.uint8)

    def arr(self, rec, cols=None):
        """a buffer by its manifest record ({key, type, length}) or key; reshaped to (-1, cols)"""
        key = rec['key'] if isinstance(rec, dict) else rec
        f = self.m['files'][key]
        a = np.frombuffer(self.raw, dtype=DT[f['type']], count=f['count'], offset=f['offset'])
        return a.reshape(-1, cols) if cols else a

    def mesh(self, name):
        return next((x for x in self.m['meshes'] if x['name'] == name), None)

    @property
    def body(self):
        return self.m['meshes'][0]


def build_mesh(name, P, tri, N=None, smooth=True):
    """a Blender mesh from positions (n,3), triangles (t,3) and optional custom normals (n,3)"""
    import bpy
    me = bpy.data.meshes.new(name)
    nv, nt = len(P), len(tri)
    me.vertices.add(nv)
    me.vertices.foreach_set('co', np.ascontiguousarray(P, dtype=np.float32).ravel())
    me.loops.add(nt * 3)
    me.loops.foreach_set('vertex_index', np.ascontiguousarray(tri, dtype=np.int32).ravel())
    me.polygons.add(nt)
    me.polygons.foreach_set('loop_start', np.arange(0, nt * 3, 3, dtype=np.int32))
    me.update(calc_edges=True)
    me.validate(clean_customdata=False)
    if smooth:
        me.polygons.foreach_set('use_smooth', np.ones(len(me.polygons), dtype=bool))
    if N is not None and len(me.vertices) == nv:
        n = np.asarray(N, dtype=np.float32)
        n = n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
        me.normals_split_custom_set_from_vertices([tuple(x) for x in n])
    return me


def add_point_attr(me, name, a, kind=None):
    a = np.asarray(a, dtype=np.float32)
    cols = 1 if a.ndim == 1 else a.shape[1]
    kind = kind or {1: 'FLOAT', 2: 'FLOAT2', 3: 'FLOAT_VECTOR', 4: 'FLOAT_COLOR'}[cols]
    at = me.attributes.new(name, kind, 'POINT')
    key = {'FLOAT': 'value', 'FLOAT2': 'vector', 'FLOAT_VECTOR': 'vector', 'FLOAT_COLOR': 'color'}[kind]
    at.data.foreach_set(key, a.ravel())
    return at


def add_corner_uv(me, name, uv):
    """uv: (t*3, 2) per triangle corner in face order"""
    layer = me.uv_layers.new(name=name)
    layer.data.foreach_set('uv', np.ascontiguousarray(uv, dtype=np.float32).ravel())
    return layer


def object_for(me, name=None, collection=None):
    import bpy
    ob = bpy.data.objects.new(name or me.name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    return ob


# hero.js regions (HERO_REGIONS): the head atlas holds head, jaw and neck
REG = dict(head=0, neck=1, torso=2, uarm=3, farm=4, hand=5, finger=6, pelvis=7, thigh=8, shin=9, foot=10, jaw=11)
HEAD_REGIONS = (0, 1, 11)


def atlas_of_triangles(region, tri):
    """0 = head atlas (head, jaw, neck), 1 = body atlas; by the majority region of a triangle's corners"""
    r = np.rint(region[tri]).astype(int)
    h = np.isin(r, HEAD_REGIONS).sum(axis=1)
    return (h < 2).astype(np.uint8)
