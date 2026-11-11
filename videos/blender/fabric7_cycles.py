# FABRIC7 for Cycles: what blender/person_scene.py calls when the export's fabric6.json carries `version7` (written by labs/clothing2/fabric7_texbake.mjs: cycles7()). No bpy import here:
# everything works on any object with the Blender node-tree surface it touches (nodes[].type / .image / .inputs[name].default_value, nodes.new, links.new), so
# scripts/fabric7/test_cycles.py runs it against stand-ins on a box without Blender.
#
#   post_material(name, m, maps, tex)   per-part fixes on a garment material (person_scene.fabric_material_baked6 calls it):
#       1. SOLE: person_scene builds every shoe part from the manifest fabric; the sole's is 'bootLeather' (LOOKS coat 0.3 / 0.3) even on the sneaker, a clearcoat the engine's SHOES7 satin
#          rubber (roughness 0.62, no coat) does not have -> Coat Weight 0 on `shoe|boot.sole.*`.
#       2. BOOT UPPER: the leather's coat is a broad polish (weight 0.22, roughness 0.45), not a star (a narrow lobe with the scuff fan centred on it).
#       3. METAL: the engine draws the shoe eyelets as metal (metalness 0.92, roughness 0.3; the sneaker's heel tab and the boot's toe-cap seam tube are webbing / thread, metalness 0). bake_post.py
#          keeps pass 2's metalness channel as cloth_metal.png (only when some texel is metallic): wired into Principled 'Metallic' of every garment material (cloth is 0 there). Without that
#          file the eyelets get Metallic from the roughness map by a Map Range (roughness 0.30 -> 0.92, 0.82 -> 0). A metal part keeps no coat and no sheen.
#   retile(...)                         the woven yarn tile's per-warp-end tone (32 ends = 12 mm of denim: the vertical pinstripes of the first Cycles stills) and the heather fibre tile's
#                                       2 cm repeat, replaced by blender/fabric7_tiles.py's mosaic (8 x 8 blocks of the tile) on its own Mapping node.
import os
import re

PART = re.compile(r'(?:^|[^A-Za-z0-9])(shoe|boot)\.(upper|sole|laces|eyelets)\.([LR])(?![A-Za-z0-9])')


def classify(name):
    """('shoe'|'boot', 'upper'|'sole'|'laces'|'eyelets', 'L'|'R') from a material or mesh name such as 'fab_k3_shoe.sole.L', else None"""
    m = PART.search(name or '')
    return (m.group(1), m.group(2), m.group(3)) if m else None


def _principled(nt):
    return next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)


def _set(p, key, value):
    try:
        p.inputs[key].default_value = value
        return True
    except (KeyError, TypeError):
        return False


def post_material(name, m, maps=None, tex=None):
    """apply the per-part fixes to a material person_scene built for mesh `name`; returns a list of what was done (empty: nothing to do).
    maps: the export's maps dir (cloth_metal.png is looked for there); tex(nt, path): a Non-Color image texture node on the atlas uv (person_scene._f7_tex)"""
    nt = getattr(m, 'node_tree', None)
    if nt is None:
        return []
    p = _principled(nt)
    if p is None:
        return []
    done = []
    c = classify(name)
    fam, part = (c[0], c[1]) if c else (None, None)
    if part == 'sole' and _set(p, 'Coat Weight', 0.0):
        done.append('sole: coat off')
    if fam == 'boot' and part == 'upper':   # the boot leather's coat a broad polish, not a star (a coat lobe of roughness 0.3 at weight 0.3 with the scuff fan centred on it)
        if _set(p, 'Coat Roughness', 0.45) and _set(p, 'Coat Weight', 0.22):
            done.append('boot upper: coat 0.22 / roughness 0.45 (broad polish)')
    metal = os.path.join(maps, 'cloth_metal.png') if maps else None
    if metal and tex is not None and os.path.exists(metal) and 'Metallic' in getattr(p, 'inputs', {}):
        try:
            t = tex(nt, metal)
            nt.links.new(t.outputs['Color'], p.inputs['Metallic'])
            done.append('metallic from cloth_metal.png')
            if part == 'eyelets':
                _set(p, 'Coat Weight', 0.0); _set(p, 'Sheen Weight', 0.0)
            return done
        except Exception as e:                      # fall through to the roughness-map route below
            done.append(f'metalness map not wired ({e!r})')
    if part == 'eyelets':
        _set(p, 'Coat Weight', 0.0); _set(p, 'Sheen Weight', 0.0)
        rough = next((n for n in nt.nodes if n.type == 'TEX_IMAGE' and getattr(n, 'image', None) is not None and 'cloth_rough' in n.image.name), None)
        if rough is None:
            done.append('eyelets: no roughness map, stays dielectric')
        else:
            mr = nt.nodes.new('ShaderNodeMapRange')
            mr.clamp = True
            for k, v in (('From Min', 0.30), ('From Max', 0.82), ('To Min', 0.92), ('To Max', 0.0)):
                mr.inputs[k].default_value = v
            nt.links.new(rough.outputs['Color'], mr.inputs['Value'])
            nt.links.new(mr.outputs['Result'], p.inputs['Metallic'])
            done.append('eyelets: metallic from the roughness map (0.30 -> 0.92, 0.82 -> 0)')
    return done


def retile(nt, node, uvc, mp, path, fabric, kind, load_array, make_image, log=print):
    """replace the Image Texture `node` (yarn or fibre tile of `fabric`) by the mosaic of `path` on a Mapping node of its own (the base mapping's scale / nb). Returns nb, or None when the tile
    needs none (the periodic knit yarn tiles, a blank fibre tile) or anything fails: then the node stays exactly as person_scene built it."""
    try:
        import fabric7_tiles as T
        r = T.mosaic(load_array(path), kind, fabric)
        if r is None:
            return None
        arr, nb = r
        im = make_image(f'f7_{fabric}_{kind}', arr)
        s = mp.inputs['Scale'].default_value
        m2 = nt.nodes.new('ShaderNodeMapping')
        m2.inputs['Scale'].default_value = (s[0] / nb, s[1] / nb, s[2])
        for l in list(getattr(node.inputs['Vector'], 'links', [])):
            nt.links.remove(l)
        nt.links.new(uvc.outputs['UV'], m2.inputs['Vector'])
        nt.links.new(m2.outputs['Vector'], node.inputs['Vector'])
        node.image = im
        log(f'fabric7_cycles: {fabric} {kind} tile -> {nb} x {nb} mosaic')
        return nb
    except Exception as e:
        log(f'fabric7_cycles: {fabric} {kind} tile mosaic not applied ({e!r})')
        return None
