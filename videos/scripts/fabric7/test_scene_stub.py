#!/usr/bin/env python3
"""FABRIC7: blender/person_scene.py's rev 7.3 call sites (the part seam, the tile mosaic) run against a PERMISSIVE bpy STUB, so a crash (a NameError, a wrong argument) shows here and not in a GPU job.
   python3 videos/scripts/fabric7/test_scene_stub.py
The stub accepts any node kind and socket name, so it proves the Python runs, the wiring calls are made in order and the numpy / PIL parts work on the real tiles; it does NOT prove Blender 5.2 accepts
the sockets (the farm's first denim and shoe crops do). Without version7 in the record the materials must be built exactly as before (the same node and link counts as a build with the new code off)."""
import os, sys, types, tempfile, collections
import numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
BL = os.path.join(ROOT, 'videos', 'blender'); sys.path.insert(0, BL)

KIND = {'ShaderNodeBsdfPrincipled': 'BSDF_PRINCIPLED', 'ShaderNodeTexImage': 'TEX_IMAGE', 'ShaderNodeNormalMap': 'NORMAL_MAP', 'ShaderNodeUVMap': 'UVMAP', 'ShaderNodeMapping': 'MAPPING',
        'ShaderNodeMix': 'MIX', 'ShaderNodeMapRange': 'MAP_RANGE', 'ShaderNodeOutputMaterial': 'OUTPUT_MATERIAL'}

class Sock:
    def __init__(self, name, type_='VALUE'):
        self.name = name; self.type = type_; self.enabled = True; self.default_value = (0.0, 0.0, 0.0, 1.0) if type_ == 'RGBA' else 0.0; self.links = []

class Socks:
    def __init__(self, preset=()):
        self.d = collections.OrderedDict((n, Sock(n, t)) for n, t in preset)
    def __getitem__(self, k):
        if k not in self.d: self.d[k] = Sock(k)
        return self.d[k]
    def __contains__(self, k): return k in self.d
    def __iter__(self): return iter(list(self.d.values()))

class Node:
    def __init__(self, kind):
        self.kind = kind; self.type = KIND.get(kind, kind); self.image = None; self.data_type = 'RGBA'; self.blend_type = 'MIX'; self.clamp = False
        mixes = [('Factor', 'VALUE')] + [(n, t) for t in ('VALUE', 'VECTOR', 'RGBA') for n in ('A', 'B')]
        self.inputs = Socks(mixes if kind == 'ShaderNodeMix' else [('Metallic', 'VALUE'), ('Coat Weight', 'VALUE'), ('Sheen Weight', 'VALUE'), ('Roughness', 'VALUE')] if self.type == 'BSDF_PRINCIPLED' else ())
        self.outputs = Socks([('Result', t) for t in ('VALUE', 'VECTOR', 'RGBA')] if kind == 'ShaderNodeMix' else ())
    def __setattr__(self, k, v): object.__setattr__(self, k, v)

class Nodes(list):
    def new(self, kind): n = Node(kind); self.append(n); return n
    def remove(self, n): super().remove(n)

class Links(list):
    def new(self, a, b): l = (a, b); self.append(l); b.links.append(l); return l
    def remove(self, l): super().remove(l); l[1].links.remove(l)

class Tree:
    def __init__(self): self.nodes = Nodes(); self.links = Links()

class Mat:
    def __init__(self, name): self.name = name; self.use_nodes = False; self.node_tree = Tree()

class Image:
    def __init__(self, name, w=0, h=0, path=None):
        self.name = name; self.size = (w, h); self.colorspace_settings = types.SimpleNamespace(name='sRGB'); self.path = path; self.packed = False; self._px = None
        self.pixels = self
    def foreach_get(self, buf):
        if self._px is None: raise RuntimeError('no pixels')
        buf[:] = self._px.ravel()
    def foreach_set(self, vals): self._px = np.asarray(vals, dtype=np.float32).reshape(self.size[1], self.size[0], 4)
    def update(self): pass
    def pack(self): self.packed = True

class Images:
    def __init__(self): self.items = {}
    def load(self, path, check_existing=False):
        if check_existing and path in self.items: return self.items[path]
        a = np.asarray(Image_open(path).convert('RGBA')).astype(np.float32) / 255.0 if path.endswith('.png') and os.path.getsize(path) > 8 else np.zeros((4, 4, 4), np.float32)
        im = Image(os.path.basename(path), a.shape[1], a.shape[0], path); im._px = a; self.items[path] = im; return im
    def new(self, name, w, h, alpha=True, float_buffer=False):
        im = Image(name, w, h); self.items['new:' + name] = im; return im

Image_open = Image_open_ = None
from PIL import Image as _PILImage
Image_open = _PILImage.open
bpy = types.ModuleType('bpy'); bpy.data = types.SimpleNamespace(materials=types.SimpleNamespace(new=lambda name: Mat(name)), images=Images())
sys.modules['bpy'] = bpy
mu = types.ModuleType('mathutils'); mu.Matrix = mu.Vector = object; sys.modules['mathutils'] = mu
pio = types.ModuleType('person_io'); pio.Person = pio.build_mesh = pio.object_for = pio.add_point_attr = pio.add_corner_uv = None; sys.modules['person_io'] = pio
sys.modules['person_hair'] = types.ModuleType('person_hair')
import person_scene as S

ok = True
def check(c, what):
    global ok
    print(('ok   ' if c else 'FAIL ') + what); ok = ok and c

maps = tempfile.mkdtemp()
for f in ('cloth_albedo.png', 'cloth_rough.png', 'cloth_normal.png'):
    Image_open and _PILImage.fromarray((np.random.rand(16, 16, 3) * 255).astype(np.uint8)).save(os.path.join(maps, f))
f6_base = {'per': 32, 'fabrics': {
    'denim': {'epc': 26, 'ppc': 18, 'kind': 'twill', 'weft': [0.4, 0.35, 0.28], 'weftShow': 0.09, 'sheen': [0.25, 0.65, 0.3], 'aniso': 0.45, 'nap': 0.7, 'rough': 0.79, 'spec': 0.4},
    'heatherJersey': {'epc': 14, 'ppc': 16, 'kind': 'jersey', 'weftShow': 0.0, 'heather': [0.2, [0.5, 0.5, 0.5]], 'sheen': [0.34, 0.55, 0.3], 'aniso': 0.1, 'nap': 0.9, 'rough': 0.84, 'spec': 0.4},
    'teeJersey': {'epc': 14, 'ppc': 16, 'kind': 'jersey', 'weftShow': 0.0, 'sheen': [0.32, 0.55, 0.25], 'aniso': 0.1, 'nap': 0.8, 'rough': 0.82, 'spec': 0.4},
    'bootLeather': {'epc': 9, 'ppc': 9, 'kind': 'leather', 'weftShow': 0.0, 'sheen': [0.0, 0.5, 0.0], 'aniso': 0.0, 'nap': 0.05, 'rough': 0.48, 'spec': 1.0}}}

def counts(m): return len(m.node_tree.nodes), len(m.node_tree.links)
def imgs(m): return sorted(n.image.name for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image)

# rev 6 record (no version7): the build is the old one
base = {}
for fab in ('denim', 'heatherJersey', 'teeJersey', 'bootLeather'):
    base[fab] = S.fabric_material_baked6('fab_k3_pants.leg', fab, maps, '#3a4a66', dict(f6_base));
    check(not any(n.image and n.image.name.startswith('f7_') for n in base[fab].node_tree.nodes if n.type == 'TEX_IMAGE'), f'{fab}: no version7 -> no mosaic image, no part post-processing')
# rev 7 record
f7 = dict(f6_base, version7=3)
for fab in ('denim', 'heatherJersey', 'teeJersey'):
    m = S.fabric_material_baked6('fab_k3_pants.leg', fab, maps, '#3a4a66', f7); n6 = counts(base[fab])
    mos = [n.image.name for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image and n.image.name.startswith('f7_')]
    want = {'denim': ['f7_denim_yarn'], 'heatherJersey': ['f7_heatherJersey_fibre'], 'teeJersey': []}[fab]
    check(sorted(mos) == want, f'{fab}: mosaic images {mos} (want {want})')
    check(counts(m)[0] == n6[0] + len(want), f'{fab}: one extra Mapping node per mosaic ({n6[0]} -> {counts(m)[0]} nodes)')
sole = S.fabric_material_baked6('fab_k3_shoe.sole.L', 'bootLeather', maps, '#222', f7)
check(True, 'bootLeather (no tile) sole built with version7 without an exception')
open(os.path.join(maps, 'cloth_metal.png'), 'wb').write(open(os.path.join(maps, 'cloth_albedo.png'), 'rb').read())
eye = S.fabric_material_baked6('fab_k3_shoe.eyelets.L', 'bootLeather', maps, '#222', f7)
p = next(n for n in eye.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
check(len(p.inputs['Metallic'].links) == 1 and p.inputs['Metallic'].links[0][0].name == 'Color', 'eyelets: Metallic is wired from a texture when cloth_metal.png exists')
eye6 = S.fabric_material_baked6('fab_k3_shoe.eyelets.L', 'bootLeather', maps, '#222', dict(f6_base))
p6 = next(n for n in eye6.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
check(len(p6.inputs['Metallic'].links) == 0, 'the same export without version7: Metallic untouched (v6 as it was)')
im = [i for i in bpy.data.images.items.values() if i.name == 'f7_denim_yarn'][0]
check(im.size == (2048, 2048) and im.packed and im._px.shape == (2048, 2048, 4) and im.colorspace_settings.name == 'Non-Color', 'the denim mosaic image: 2048 x 2048, Non-Color, packed')
print('ALL OK' if ok else 'FAILED'); sys.exit(0 if ok else 1)
