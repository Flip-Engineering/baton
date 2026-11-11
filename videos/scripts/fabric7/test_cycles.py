#!/usr/bin/env python3
"""FABRIC7 Cycles fixes (blender/fabric7_cycles.py) against stand-in node trees: no Blender, no bpy, nothing rendered.
   python3 videos/scripts/fabric7/test_cycles.py
Checks the name rule, the sole's coat, the eyelets' Metallic wiring (the cloth_metal.png map when the export has it, else a Map Range from the roughness map), the untouched garment, the tile
mosaic's node surgery (retile: its own Mapping at scale / nb, the old vector link removed, the real tiles). What it cannot check: that Blender 5.2's node and socket names are the ones used (the sockets are the ones person_scene.py itself
uses, plus ShaderNodeMapRange 'From Min', 'From Max', 'To Min', 'To Max', 'Value' / 'Result' and Principled 'Metallic'); the farm's first Cycles shoe crop is that test."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'blender'))
import fabric7_cycles as C


class Sock:
    def __init__(self, v=None): self.default_value = v; self.links = []


class Node:
    def __init__(self, type_, ins=(), outs=(), image=None):
        self.type = type_; self.inputs = {k: Sock(0.0) for k in ins}; self.outputs = {k: Sock() for k in outs}; self.image = image


class Img:
    def __init__(self, name): self.name = name


class Nodes(list):
    def new(self, kind):
        n = {'ShaderNodeMapRange': Node('MAP_RANGE', ('From Min', 'From Max', 'To Min', 'To Max', 'Value'), ('Result',)),
             'ShaderNodeMapping': Node('MAPPING', ('Scale', 'Vector'), ('Vector',))}[kind]
        self.append(n); return n


class Links(list):
    def new(self, a, b): self.append((a, b))
    def remove(self, l): super().remove(l)


class Tree:
    def __init__(self, rough=True):
        self.nodes = Nodes(); self.links = Links()
        self.p = Node('BSDF_PRINCIPLED', ('Coat Weight', 'Sheen Weight', 'Metallic', 'Roughness', 'Coat Roughness'), ('BSDF',)); self.nodes.append(self.p)
        self.alb = Node('TEX_IMAGE', (), ('Color',), Img('cloth_albedo.png')); self.nodes.append(self.alb)
        self.rg = Node('TEX_IMAGE', (), ('Color',), Img('cloth_rough.png')) if rough else None
        if self.rg: self.nodes.append(self.rg)
        self.p.inputs['Coat Weight'].default_value = 0.3; self.p.inputs['Sheen Weight'].default_value = 0.4


class Mat:
    def __init__(self, rough=True): self.node_tree = Tree(rough)


ok = True
def check(c, what):
    global ok
    print(('ok   ' if c else 'FAIL ') + what)
    ok = ok and c


for n, want in (('fab_k3_shoe.sole.L', ('shoe', 'sole', 'L')), ('fab_k3_boot.eyelets.R', ('boot', 'eyelets', 'R')), ('shoe.upper.L.001', ('shoe', 'upper', 'L')),
                ('fab_k3_shirt.body', None), ('fab_k3_shoe.soleplate.L', None), ('', None), (None, None)):
    check(C.classify(n) == want, f'classify({n!r}) = {want}')

m = Mat(); d = C.post_material('fab_k3_shoe.sole.L', m)
check(m.node_tree.p.inputs['Coat Weight'].default_value == 0.0 and d == ['sole: coat off'], 'sole: coat 0.3 -> 0')
check(m.node_tree.p.inputs['Sheen Weight'].default_value == 0.4, 'sole: sheen untouched')

m = Mat(); d = C.post_material('fab_k3_boot.eyelets.L', m); t = m.node_tree
mr = next(n for n in t.nodes if n.type == 'MAP_RANGE')
check(t.p.inputs['Coat Weight'].default_value == 0.0 and t.p.inputs['Sheen Weight'].default_value == 0.0, 'eyelets: coat and sheen off')
check((mr.inputs['From Min'].default_value, mr.inputs['From Max'].default_value, mr.inputs['To Min'].default_value, mr.inputs['To Max'].default_value) == (0.30, 0.82, 0.92, 0.0) and mr.clamp,
      'eyelets: Map Range 0.30 -> 0.92, 0.82 -> 0, clamped')
check((t.rg.outputs['Color'], mr.inputs['Value']) in t.links and (mr.outputs['Result'], t.p.inputs['Metallic']) in t.links, 'eyelets: roughness map -> Map Range -> Metallic')
check(t.alb.outputs['Color'] not in [a for a, _ in t.links], 'eyelets: the albedo map is not wired into it')

m = Mat(rough=False); d = C.post_material('fab_k3_shoe.eyelets.R', m)
check(m.node_tree.p.inputs['Metallic'].default_value == 0.0 and 'no roughness map' in d[0], 'eyelets without a roughness map stay dielectric and say so')

for n in ('fab_k3_shoe.upper.L', 'fab_k3_shoe.laces.R', 'fab_k3_tee.body'):
    m = Mat(); before = (m.node_tree.p.inputs['Coat Weight'].default_value, len(m.node_tree.nodes), len(m.node_tree.links))
    check(C.post_material(n, m) == [] and before == (0.3, len(m.node_tree.nodes), len(m.node_tree.links)), f'{n}: untouched')
check(C.post_material('fab_k3_shoe.sole.L', type('X', (), {'node_tree': None})()) == [], 'a material without a node tree: nothing')


# ---- the metalness map (iteration 4): wired into Metallic when cloth_metal.png exists and a tex factory is given
import tempfile
tmp = tempfile.mkdtemp(); open(os.path.join(tmp, 'cloth_metal.png'), 'wb').write(b'x')
made = []
def tex(nt, path):
    n = Node('TEX_IMAGE', (), ('Color',), Img(os.path.basename(path))); nt.nodes.append(n); made.append(path); return n
m = Mat(); d = C.post_material('fab_k3_shoe.eyelets.L', m, tmp, tex); t = m.node_tree
check(d == ['metallic from cloth_metal.png'] and (made[-1].endswith('cloth_metal.png') and (t.nodes[-1].outputs['Color'], t.p.inputs['Metallic']) in t.links), 'eyelets with cloth_metal.png: the map goes into Metallic (no Map Range)')
check(not any(n.type == 'MAP_RANGE' for n in t.nodes) and t.p.inputs['Coat Weight'].default_value == 0.0 and t.p.inputs['Sheen Weight'].default_value == 0.0, 'eyelets with the map: no Map Range, coat and sheen off')
m = Mat(); d = C.post_material('fab_k3_tee.body', m, tmp, tex)
check(d == ['metallic from cloth_metal.png'] and m.node_tree.p.inputs['Coat Weight'].default_value == 0.3, 'a cloth garment with the map: Metallic wired (the map is black there), coat untouched')
m = Mat(); d = C.post_material('fab_k3_shoe.sole.R', m, tmp, tex)
check('sole: coat off' in d and m.node_tree.p.inputs['Coat Weight'].default_value == 0.0, 'sole with the map: coat off and Metallic wired')
m = Mat(); d = C.post_material('fab_k3_shoe.eyelets.L', m, tempfile.mkdtemp(), tex); t = m.node_tree
check(any(n.type == 'MAP_RANGE' for n in t.nodes), 'no cloth_metal.png in maps: the Map Range fallback')
# ---- the boot upper's coat a broad polish (weight 0.22, roughness 0.45), never the sneaker's upper
import json
ex = tempfile.mkdtemp(); mp = os.path.join(ex, 'maps'); os.makedirs(mp)
m = Mat(); m.node_tree.p.inputs['Coat Roughness'].default_value = 0.3; d = C.post_material('fab_k3_boot.upper.L', m, mp)
p_ = m.node_tree.p.inputs
check(p_['Coat Roughness'].default_value == 0.45 and p_['Coat Weight'].default_value == 0.22 and len(d) == 1, 'boot upper: coat a broad polish')
m = Mat(); m.node_tree.p.inputs['Coat Roughness'].default_value = 0.3
check(C.post_material('fab_k3_shoe.upper.L', m, mp) == [] and m.node_tree.p.inputs['Coat Roughness'].default_value == 0.3, 'the sneaker upper: untouched')
check(C.post_material('fab_k3_boot.upper.L', Mat()) != [], 'no maps dir given: the part fixes still apply (and no exception)')
def bad_tex(nt, path): raise RuntimeError('no such image')
m = Mat(); d = C.post_material('fab_k3_boot.eyelets.L', m, tmp, bad_tex)
check(any('not wired' in x for x in d) and any(n.type == 'MAP_RANGE' for n in m.node_tree.nodes), 'a failing metalness texture falls back to the Map Range and says so')

# ---- the tile mosaic's node surgery on stand-ins, with the real tiles
import numpy as np
from PIL import Image
TILES = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'web', 'assets', 'fabric6', 'tiles')
load = lambda p: np.asarray(Image.open(p).convert('RGBA')).astype(np.float32) / 255.0
def mk(name, arr): i = Img(name); i.shape = arr.shape; return i
def rig():
    t = Tree(); mp = t.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (26 * 100 / 32, 18 * 100 / 32, 1.0)
    uvc = Node('UVMAP', (), ('UV',)); node = Node('TEX_IMAGE', ('Vector',), ('Color',), Img('denim_yarn.png')); t.nodes.append(node)
    old = (mp.outputs['Vector'], node.inputs['Vector']); t.links.append(old); node.inputs['Vector'].links.append(old)
    return t, mp, uvc, node, old
t, mp, uvc, node, old = rig(); logs = []
nb = C.retile(t, node, uvc, mp, os.path.join(TILES, 'denim_yarn.png'), 'denim', 'yarn', load, mk, log=logs.append)
m2 = t.nodes[-1]
check(nb == 8 and node.image.name == 'f7_denim_yarn' and node.image.shape == (2048, 2048, 4), 'retile denim yarn: an 8 x 8 mosaic image (2048 px) on the node')
check(m2.type == 'MAPPING' and np.allclose(m2.inputs['Scale'].default_value, (26 * 100 / 32 / 8, 18 * 100 / 32 / 8, 1.0)), 'retile: its own Mapping at scale / nb (the base mapping untouched)')
check(old not in t.links and (uvc.outputs['UV'], m2.inputs['Vector']) in t.links and (m2.outputs['Vector'], node.inputs['Vector']) in t.links, 'retile: the old vector link removed, uv -> new Mapping -> texture')
t, mp, uvc, node, old = rig(); nodes0 = len(t.nodes)
check(C.retile(t, node, uvc, mp, os.path.join(TILES, 'jersey_yarn.png'), 'jersey', 'yarn', load, mk, log=logs.append) is None and len(t.nodes) == nodes0 and old in t.links and node.image.name == 'denim_yarn.png',
      'retile: a periodic knit tile is left exactly as built')
t, mp, uvc, node, old = rig()
check(C.retile(t, node, uvc, mp, os.path.join(TILES, 'denim_yarn.png'), 'denim', 'yarn', lambda p: 1 / 0, mk, log=logs.append) is None and old in t.links and any('not applied' in x for x in logs), 'retile: a failing step is logged and the node stays as built')
t, mp, uvc, node, old = rig()
check(C.retile(t, node, uvc, mp, os.path.join(TILES, 'heatherJersey_fibre.png'), 'heatherJersey', 'fibre', load, mk, log=logs.append) == 8, 'retile: the heather fibre tile gets its mosaic')

print('ALL OK' if ok else 'FAILED')
sys.exit(0 if ok else 1)
