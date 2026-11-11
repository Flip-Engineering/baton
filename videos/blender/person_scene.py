# CYCLES step 4: build a Blender scene for one exported person (web/lib/fx/person/export.js) with the skin baked from lane B's shader
# (web/labs/human8/bake_skin.mjs + bake_post.py). Everything is built from the person record; nothing is hand-placed.
#   import person_scene as S; S.build(export_dir, maps_dir, light='over' | 'sun', register='bare' | 'dressed')
# Parts:
#   skin     Principled BSDF: albedo (baked), random-walk subsurface (skin) with mean free paths from the person's melanin and blood
#            (lane B's Cm, Ch), lane B's micro-relief as a tangent normal map, lane B's roughness for the dry lobe and its oily lobe as
#            the Coat (IOR 1.47 sebum, roughness 0.3, weight from the baked oil map); the underwear of the figure-study register as a
#            cotton knit where the baked mask says
#   hair     lane D's cards grown into strands (person_hair.py): Principled Hair BSDF (Chiang et al. 2016) with the person's eumelanin
#            and pheomelanin, grey strands by the person's grey fraction
#   eyes     lane B's globes rebuilt as organs: a sclera with a wet coat, an iris disc 3 mm behind the corneal apex seen through a
#            refracting cornea (n 1.376; transparent to shadow rays so the iris is lit), the pupil, a tear meniscus on the lower lid
#            margin, the caruncle
#   garments CLOTHING c1 fabrics as Principled materials: the dye, the fabric's roughness, its sheen (Charlie) for the fibres, the weave
#            as a bump in the garment's own (metric) coordinates
#   light    'over': a CC0 overcast sky HDRI (Poly Haven, kloofendal_overcast_puresky); 'sun': Cycles' physical sky + a sun lamp of the
#            sun's 0.53 degree disc, from the export's elevation / azimuth; a concrete ground under both
import os, math, json
import numpy as np
import bpy
from mathutils import Matrix, Vector
from person_io import Person, build_mesh, object_for, add_point_attr, add_corner_uv
import person_hair
import fabric7_cycles as f7c   # (FABRIC7, 8 Oct, opt-in on fabric6.json's version7) the shoe-part fixes, the metalness map and the tile mosaic
import cover8 as C8   # (CLOTH8, 8 Oct, opt-in: popts 'cover8' or the environment's COVER8) SHRINK, DON'T DROP: the covered skin kept, pushed in
_COVER8 = {'on': False}   # set by build(): while on, skin_material() keeps the covered texels opaque (no Transparent cut)

HDRI = {'overcast': os.path.expanduser('~/.cache/acp_human/hdri/kloofendal_overcast_puresky_2k.hdr')}
HDRI_URL = {'overcast': 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kloofendal_overcast_puresky_2k.hdr'}   # Poly Haven, Greg Zaal, CC0


def hdri_path(k):
    """the cached HDR, fetched once from Poly Haven (CC0) on a machine that lacks it (the farm)"""
    p = HDRI[k]
    if not os.path.exists(p):
        import urllib.request
        os.makedirs(os.path.dirname(p), exist_ok=True)
        urllib.request.urlretrieve(HDRI_URL[k], p + '.part'); os.replace(p + '.part', p)
    return p


def srgb2lin(c):
    c = np.asarray(c, dtype=float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def hex2lin(h):
    h = h.lstrip('#')
    return tuple(srgb2lin([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])) + (1.0,)


def mx_in(node, name):
    """a Mix node's socket by name for ITS data type (the node carries float, vector and colour sockets of the same name; a plain
    inputs['A'] is the float one, which silently left colour mixes at their grey defaults)"""
    kind = {'RGBA': 'RGBA', 'FLOAT': 'VALUE', 'VECTOR': 'VECTOR'}[node.data_type]
    if name == 'Factor':
        return next(x for x in node.inputs if x.name == 'Factor' and x.enabled)
    return next(x for x in node.inputs if x.name == name and x.type == kind)


def mx_out(node):
    kind = {'RGBA': 'RGBA', 'FLOAT': 'VALUE', 'VECTOR': 'VECTOR'}[node.data_type]
    return next(x for x in node.outputs if x.name == 'Result' and x.type == kind)


def mat_new(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    return m, nt, out


def img(path, colorspace='Non-Color'):
    im = bpy.data.images.load(path, check_existing=True)
    im.colorspace_settings.name = colorspace
    return im


def tex(nt, path, colorspace='Non-Color', uv=None, interp='Linear'):
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = img(path, colorspace)
    t.interpolation = interp
    if uv is not None:
        nt.links.new(uv.outputs['UV'], t.inputs['Vector'])
    return t


# ---------------------------------------------------------------- skin
def skin_radius(person):
    """single-scattering mean free paths (m) per channel, which is what Cycles' random walk takes as the radius (sigma_t = 1 / r; it
    inverts the albedo for the absorption). Jensen et al. 2001's measured skin gives 1 / sigma_t' = 1.29, 0.95, 0.67 mm and a diffuse
    mean free path 1 / sigma_tr = 3.67, 1.37, 0.68 mm; the first test used the diffuse ones and the lighter skin went waxy (forms
    washed out), so the radius sits between the two, red deepest: 2.0, 0.85, 0.45 mm. The person's melanin and blood shorten green
    and blue a little more (they absorb there)."""
    Cm = (person or {}).get('Cm', 0.2)
    Ch = (person or {}).get('Ch', 0.02)
    k = 1.0 - 0.25 * min(1.0, Cm / 0.5)
    b = 1.0 - 0.2 * min(1.0, Ch / 0.05)
    return (0.0020, 0.00085 * k * b, 0.00045 * k * b)


def skin_material(name, maps, a, person, register='bare', sss=1.0, rev=0):
    m, nt, out = mat_new(name)
    L = nt.links
    uv = nt.nodes.new('ShaderNodeUVMap')
    uv.uv_map = 'atlas'
    clean = register != 'bare'
    alb = tex(nt, os.path.join(maps, f'skin_albedo{"_clean" if clean else ""}_a{a}.png'), 'sRGB', uv)
    nrm = tex(nt, os.path.join(maps, f'skin_normal_a{a}.png'), 'Non-Color', uv)
    rgh = tex(nt, os.path.join(maps, f'skin_rough_a{a}.png'), 'Non-Color', uv)
    spc = tex(nt, os.path.join(maps, f'skin_spec_a{a}.png'), 'Non-Color', uv)
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    L.new(spc.outputs['Color'], sep.inputs['Color'])
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nm.space = 'TANGENT'
    nm.uv_map = 'atlas'
    L.new(nrm.outputs['Color'], nm.inputs['Color'])
    # SKIN7 c2 iteration 5 (rev 7 only; person.rev7.cycNmK, 1 = as before): the normal map's strength for both lobes, a PROBE of the deep-skin veil (grey-white speckle at grazing angles on the neck of L21 / L22)
    r7n = (person or {}).get('rev7') or None
    if r7n and r7n.get('cycNmK', 1.0) != 1.0:
        nm.inputs['Strength'].default_value = float(r7n['cycNmK'])
    # SKIN7 c2 iteration 6 (rev 7 only; person.rev7.cycNmGraze x deepK, 0 = as before): the pore normals' glints at grazing angles are the speckle on a deep skin's neck and clavicle (veil probe C: the normal map x0.5
    # removed 80 % of it but took 42 % of the face's fine energy): the normal map's strength falls toward grazing (Layer Weight Facing: 0 facing the camera, 1 at grazing) from full at facing 0.45 (about 57 deg)
    # to (1 - graze) at 1.0, so the pores stay on the face turned toward the camera. Only a person with a deep skin (deepK > 0) builds the extra nodes
    gz = float(r7n.get('cycNmGraze', 0.0)) * float(r7n.get('deepK', 0.0)) if r7n else 0.0
    if gz > 0.0:
        nmk = float(r7n.get('cycNmK', 1.0))
        lw = nt.nodes.new('ShaderNodeLayerWeight'); lw.inputs['Blend'].default_value = 0.5
        mg = nt.nodes.new('ShaderNodeMapRange'); mg.clamp = True
        mg.inputs['From Min'].default_value = 0.45; mg.inputs['From Max'].default_value = 1.0
        mg.inputs['To Min'].default_value = nmk; mg.inputs['To Max'].default_value = nmk * max(0.0, 1.0 - gz)
        L.new(lw.outputs['Facing'], mg.inputs['Value']); L.new(mg.outputs['Result'], nm.inputs['Strength'])
    p = nt.nodes.new('ShaderNodeBsdfPrincipled')
    p.subsurface_method = 'RANDOM_WALK_SKIN'
    L.new(alb.outputs['Color'], p.inputs['Base Color'])
    L.new(rgh.outputs['Color'], p.inputs['Roughness'])
    L.new(nm.outputs['Normal'], p.inputs['Normal'])
    L.new(nm.outputs['Normal'], p.inputs['Coat Normal'])
    p.inputs['IOR'].default_value = 1.4                       # Weyrich et al. 2006 ~1.38; lane B's ior 1.4
    p.inputs['Subsurface Weight'].default_value = 1.0
    R = skin_radius(person)
    opt = (person or {}).get('optics') or None
    if opt and opt.get('ld'):
        # SKIN OPTICS (8 Oct, skin `optics: true`): 'Random Walk (Skin)' reads its radius as the DIFFUSE mean free path (Cycles bssrdf_setup_radius: x sqrt(3 (1 - alpha'))
        # gives 1 / sigma_t'), so the radius is the layered model's l_d per channel (web/lib/fx/likeness/optics.js: the person's blood and baseline at Jacques 2013's
        # scattering; checked against Weyrich et al. 2006's in-vivo faces, 1.79 / 1.03 / 0.65 mm), physical, so not scaled by the export's sss (0.6)
        R = tuple(float(x) / 1000.0 for x in opt['ld']); sss = 1.0
    p.inputs['Subsurface Radius'].default_value = tuple(x / R[0] for x in R)
    p.inputs['Subsurface Scale'].default_value = R[0] * sss
    # SKIN OPTICS iteration 13 (16 Oct): THE TRANSPORT FROM THE TISSUE COLUMN. The radius per channel at every texel is the column's own l_d (web/lib/fx/likeness/
    # skin_lut.js columnLdBands: the dermis's thickness, what backs it, the site's blood, as the effective dermis that reflects what the column reflects), baked by the
    # engine's shader (lab_bake.js pass 4, bake_post.py) as sqrt(l_d / maxMm): Radius = the map squared, Scale = maxMm. A person whose record has no ldMap (skin
    # transport: false, or an older export) or whose bake wrote no map keeps the person's one radius above. light5's thickness clamp multiplies this Scale as before.
    lm = (opt or {}).get('ldMap') if opt else None
    ldp = os.path.join(maps, f'skin_ld_a{a}.png')
    if lm and os.path.exists(ldp):
        ldt = tex(nt, ldp, 'Non-Color', uv)
        sq = nt.nodes.new('ShaderNodeVectorMath'); sq.operation = 'MULTIPLY'
        L.new(ldt.outputs['Color'], sq.inputs[0]); L.new(ldt.outputs['Color'], sq.inputs[1])
        L.new(sq.outputs['Vector'], p.inputs['Subsurface Radius'])
        p.inputs['Subsurface Scale'].default_value = float(lm.get('maxMm', 4.0)) / 1000.0
    p.inputs['Subsurface IOR'].default_value = 1.4
    p.inputs['Subsurface Anisotropy'].default_value = 0.8
    # the oily lobe: sebum's index 1.47 (F0 0.036), roughness 0.3 (lane B's clearcoatRoughness), weight = lane B's oil map (likeOil)
    # SKIN7 (round 7, opt-in): skin rev 7's person carries rev7 { baseSpec, ccRough, ccRoughT, ... } (lib/fx/likeness/skin.js): the engine's lower base lobe (Specular IOR Level 0.5 is the
    # neutral value: x baseSpec) and its oily lobe's roughness range. The oily lobe's WEIGHT needs nothing here: the baked oil map (pass 2, red) already holds the engine's likeOil, which
    # carries rev 7's oil gain (skin.js: likeK2.y = oil x (1 + oilDeep x deepK)), so a gain here would count it twice. A person without the key builds exactly as before
    r7 = (person or {}).get('rev7') or None
    mo = nt.nodes.new('ShaderNodeMath'); mo.operation = 'MULTIPLY'; mo.inputs[1].default_value = 0.5   # the sharp lobe is a minority of skin's specular (lane B)
    if r7:
        # cycCoatK / cycSpecK (iteration 5's veil probes, 1 = as before): x the coat weight (0.5 x the oil map) and x the base lobe's Specular IOR Level
        mo.use_clamp = True; mo.inputs[1].default_value = 0.5 * float(r7.get('cycCoatK', 1.0)); p.inputs['Specular IOR Level'].default_value = 0.5 * r7['baseSpec'] * float(r7.get('cycSpecK', 1.0)) * (1.0 - float(r7.get('cycSpecDeep', 0.0)) * float(r7.get('deepK', 0.0)))   # (iteration 6: the deep skins' base lobe is the veil's glow: probe B, x0.5 moved it +2.5 -> +0.6 L*)
    L.new(sep.outputs['Red'], mo.inputs[0]); L.new(mo.outputs[0], p.inputs['Coat Weight'])
    p.inputs['Coat Roughness'].default_value = 0.3
    p.inputs['Coat IOR'].default_value = 1.47
    s11 = (r7 or {}).get('surface') or None
    if s11:
        # SKIN OPTICS iteration 11 (web/lib/fx/likeness/surface.js, person.rev7.surface): THE SURFACE STATE FROM THE SKIN'S OWN TISSUE. The spec map's red is now the
        # SEBUM FILM's share of the surface (the casual level by site x the person's gland activity, its coverage of the corneum's asperities; the vermilion's saliva
        # at the wet band): the coat IS the film (weight = its share, its Fresnel the film's own: Coat IOR = cycCoatIor = sebum's 1.47; its roughness the film's surface,
        # iteration 12: the bare plateau's slopes LEVELLED by the film, alpha_film = (1 - f) x alpha_plateau (surface.js 3b: Orchard 1962), with the relief's slopes
        # added, LEAN); under the film the base lobe is gone (the corneum / sebum step reflects ~nothing; Cycles' coat does not re-index the base): the bare corneum's
        # lobe (IOR = keratin with its surface water, etaC) weighs 1 - the film, at its own Fresnel (Specular IOR Level 0.5: iteration 11's Beckmann-as-GGX gain is
        # deleted). The base roughness map is the bare plateau's (rougher where dry) with the relief's Toksvig at the bake's texel. DETAIL7's fine7 wiring (its sub-texel
        # variance on both roughnesses, the pits' hidden share on both weights) attaches to these links as before.
        p.inputs['IOR'].default_value = float(s11['etaC'])
        inv = nt.nodes.new('ShaderNodeMath'); inv.operation = 'MULTIPLY_ADD'; inv.use_clamp = True
        inv.inputs[1].default_value = -float(s11['cycLevelC']); inv.inputs[2].default_value = float(s11['cycLevelC'])   # level x (1 - film)
        L.new(sep.outputs['Red'], inv.inputs[0]); L.new(inv.outputs[0], p.inputs['Specular IOR Level'])
        for lk in list(p.inputs['Coat Weight'].links): L.remove(lk)
        L.new(sep.outputs['Red'], p.inputs['Coat Weight'])
        p.inputs['Coat IOR'].default_value = float(s11['cycCoatIor'])
        # the film's roughness: the hydrated plateau's alpha levelled by the film's share, (1 - f)^2 alpha_C^2, plus the slope variance the base map carries beyond the
        # hydrated plateau (LEAN: alpha^2 += v; v = r_map^4 - r_C^4: the relief's Toksvig, and on the dry sites their extra roughness, which the film there (f 0.02-0.14)
        # is taken not to level; the engine levels the local plateau)
        p4 = nt.nodes.new('ShaderNodeMath'); p4.operation = 'POWER'; p4.inputs[1].default_value = 4.0; L.new(rgh.outputs['Color'], p4.inputs[0])
        sv = nt.nodes.new('ShaderNodeMath'); sv.operation = 'SUBTRACT'; sv.use_clamp = True; L.new(p4.outputs[0], sv.inputs[0]); sv.inputs[1].default_value = float(s11['rC']) ** 4
        om = nt.nodes.new('ShaderNodeMath'); om.operation = 'MULTIPLY_ADD'; om.use_clamp = True; L.new(sep.outputs['Red'], om.inputs[0]); om.inputs[1].default_value = -1.0; om.inputs[2].default_value = 1.0
        o2 = nt.nodes.new('ShaderNodeMath'); o2.operation = 'MULTIPLY'; L.new(om.outputs[0], o2.inputs[0]); L.new(om.outputs[0], o2.inputs[1])
        lv = nt.nodes.new('ShaderNodeMath'); lv.operation = 'MULTIPLY'; L.new(o2.outputs[0], lv.inputs[0]); lv.inputs[1].default_value = float(s11['rC']) ** 4
        ad = nt.nodes.new('ShaderNodeMath'); ad.operation = 'ADD'; L.new(sv.outputs[0], ad.inputs[0]); L.new(lv.outputs[0], ad.inputs[1])
        rt = nt.nodes.new('ShaderNodeMath'); rt.operation = 'POWER'; rt.inputs[1].default_value = 0.25; rt.use_clamp = True; L.new(ad.outputs[0], rt.inputs[0])
        L.new(rt.outputs[0], p.inputs['Coat Roughness'])
        p.inputs['Sheen Weight'].default_value = 0.04 * r7.get('sheenK', 1.0); p.inputs['Sheen Roughness'].default_value = 0.45
    elif rev >= 6:   # (integration v6, SKIN6's hand-off) skin rev 6: the coat's roughness by the oil map (0.32 dry -> 0.22 oily, as the engine's likeCC6) and a faint vellus sheen
        mr = nt.nodes.new('ShaderNodeMapRange'); mr.clamp = True
        mr.inputs['From Min'].default_value = 0.0; mr.inputs['From Max'].default_value = 0.5; mr.inputs['To Min'].default_value = r7['ccRough'] if r7 else 0.32; mr.inputs['To Max'].default_value = r7['ccRoughT'] if r7 else 0.22
        L.new(sep.outputs['Red'], mr.inputs['Value']); L.new(mr.outputs['Result'], p.inputs['Coat Roughness'])
        # SKIN7 c2 (rev 7 only): the vellus sheen follows the engine's rule (skin.js sheenK: 1 on light skins, ~0.1 on L21, ~0 on L22): on a deep skin a white sheen at 0.04 is +50-60 % of the albedo at grazing and read as a grey-white powder on the neck and the cheeks (v6 L21 / L22 Cycles, defects L21-02 and L22-01)
        p.inputs['Sheen Weight'].default_value = 0.04 * (r7.get('sheenK', 1.0) if r7 else 1.0); p.inputs['Sheen Roughness'].default_value = 0.45
    shader = p
    if register == 'bare':   # the figure-study register's underwear (painted in the bake): a cotton knit where the mask says
        uw = tex(nt, os.path.join(maps, f'skin_uw_a{a}.png'), 'Non-Color', uv)
        c = nt.nodes.new('ShaderNodeBsdfPrincipled')
        L.new(alb.outputs['Color'], c.inputs['Base Color'])
        c.inputs['Roughness'].default_value = 0.85
        c.inputs['Sheen Weight'].default_value = 0.6
        c.inputs['Sheen Roughness'].default_value = 0.5
        c.inputs['Specular IOR Level'].default_value = 0.2
        knit_bump(nt, c, scale=1450.0)
        mx = nt.nodes.new('ShaderNodeMixShader')
        L.new(uw.outputs['Color'], mx.inputs['Fac']); L.new(p.outputs['BSDF'], mx.inputs[1]); L.new(c.outputs['BSDF'], mx.inputs[2])
        shader = mx
    cover = os.path.join(maps, f'skin_cover_a{a}.png')
    if register != 'bare' and os.path.exists(cover) and not _COVER8['on']:   # dressed: the skin hero.js discards under the clothes, cut out (CLOTH8 cover8: kept, pushed in instead)
        cv = tex(nt, cover, 'Non-Color', uv, interp='Closest')
        tr = nt.nodes.new('ShaderNodeBsdfTransparent'); ms = nt.nodes.new('ShaderNodeMixShader')
        L.new(cv.outputs['Color'], ms.inputs['Fac']); L.new(shader.outputs[0], ms.inputs[1]); L.new(tr.outputs['BSDF'], ms.inputs[2]); shader = ms
    L.new(shader.outputs[0], out.inputs['Surface'])
    return m


def knit_bump(nt, bsdf, scale=1400.0, strength=0.25, coord='Object'):
    """a fine knit / weave texture as a bump (scale: courses per metre)"""
    tc = nt.nodes.new('ShaderNodeTexCoord')
    w = nt.nodes.new('ShaderNodeTexWave'); w.wave_type = 'BANDS'; w.bands_direction = 'Z'; w.wave_profile = 'SIN'
    w.inputs['Scale'].default_value = scale / 6.2832 * 6.2832 / 10.0
    w.inputs['Distortion'].default_value = 0.5
    nt.links.new(tc.outputs[coord], w.inputs['Vector'])
    b = nt.nodes.new('ShaderNodeBump'); b.inputs['Strength'].default_value = strength; b.inputs['Distance'].default_value = 0.0003
    nt.links.new(w.outputs['Fac'], b.inputs['Height']); nt.links.new(b.outputs['Normal'], bsdf.inputs['Normal'])


# ---------------------------------------------------------------- garments (CLOTHING c1 fabrics)
# the LOOKS of lib/fx/cloth/fabrics.js that matter here: roughness, sheen [amount, roughness, tint toward white], weave threads per cm
LOOKS = {
    'jersey': dict(rough=0.8, sheen=(0.35, 0.55, 0.25), epc=13, ppc=14.5, kind='jersey', spec=0.4),
    'rib': dict(rough=0.85, sheen=(0.35, 0.55, 0.25), epc=7, ppc=12, kind='rib', spec=0.4),
    'chambray': dict(rough=0.8, sheen=(0.22, 0.6, 0.3), epc=30, ppc=26, kind='plain', spec=0.45),
    'flannel': dict(rough=0.9, sheen=(0.6, 0.5, 0.3), epc=18, ppc=17, kind='twill', spec=0.35),
    'twillPC': dict(rough=0.8, sheen=(0.18, 0.55, 0.2), epc=40, ppc=22, kind='twill', spec=0.5),
    'denim': dict(rough=0.79, sheen=(0.25, 0.65, 0.3), epc=26, ppc=18, kind='twill', spec=0.4),
    'duck': dict(rough=0.86, sheen=(0.2, 0.75, 0.2), epc=18, ppc=10, kind='plain', spec=0.4),
    'hivisYG': dict(rough=0.62, sheen=(0.15, 0.4, 0.15), epc=6, ppc=6, kind='mesh', spec=0.7),
    'hivisOR': dict(rough=0.62, sheen=(0.15, 0.4, 0.15), epc=6, ppc=6, kind='mesh', spec=0.7),
    'leather': dict(rough=0.5, sheen=(0, 0.5, 0), epc=13, ppc=13, kind='leather', spec=1.0, coat=(0.35, 0.34)),
    'bootLeather': dict(rough=0.48, sheen=(0, 0.5, 0), epc=9, ppc=9, kind='leather', spec=1.0, coat=(0.3, 0.3)),
    'melton': dict(rough=0.92, sheen=(0.5, 0.55, 0.25), epc=10, ppc=10, kind='felt', spec=0.35),
    # CLOTHING K4 (the wardrobe): lib/fx/cloth/wardrobe4/fabrics4.js LOOKS4 (CYCLES4), added; no existing entry changed
    'teeJersey': dict(rough=0.82, sheen=(0.32, 0.55, 0.25), epc=14, ppc=16, kind='jersey', spec=0.4),
    'heatherJersey': dict(rough=0.84, sheen=(0.34, 0.55, 0.3), epc=14, ppc=16, kind='jersey', spec=0.4),
    'fleece': dict(rough=0.88, sheen=(0.42, 0.6, 0.3), epc=11, ppc=13, kind='jersey', spec=0.35),
    'chino': dict(rough=0.8, sheen=(0.16, 0.55, 0.22), epc=44, ppc=24, kind='twill', spec=0.45),
    'canvas': dict(rough=0.86, sheen=(0.2, 0.72, 0.2), epc=20, ppc=12, kind='plain', spec=0.4),
    'stretchDenim': dict(rough=0.77, sheen=(0.22, 0.65, 0.3), epc=28, ppc=20, kind='twill', spec=0.4),
    'woolFlannel': dict(rough=0.9, sheen=(0.55, 0.5, 0.25), epc=22, ppc=20, kind='twill', spec=0.35),
    'oxford': dict(rough=0.8, sheen=(0.2, 0.6, 0.3), epc=30, ppc=20, kind='plain', spec=0.45),
    'scrub': dict(rough=0.66, sheen=(0.14, 0.45, 0.25), epc=42, ppc=32, kind='plain', spec=0.6),
}


def fabric_material_baked(name, fabric, maps):
    """a garment with the engine's own fabric surface baked (labs/human8/lab_bake.js mode=garments): albedo, roughness and the perturbed
    normal (weave, seams) from CLOTHING c1's shader; the sheen of the fibres from the fabric's look"""
    lk = LOOKS.get(fabric, LOOKS['twillPC'])
    m, nt, out = mat_new(name); L = nt.links
    uv = nt.nodes.new('ShaderNodeUVMap'); uv.uv_map = 'atlas'
    alb = tex(nt, os.path.join(maps, 'cloth_albedo.png'), 'sRGB', uv)
    rg = tex(nt, os.path.join(maps, 'cloth_rough.png'), 'Non-Color', uv)
    nr = tex(nt, os.path.join(maps, 'cloth_normal.png'), 'Non-Color', uv)
    nm = nt.nodes.new('ShaderNodeNormalMap'); nm.space = 'TANGENT'; nm.uv_map = 'atlas'; L.new(nr.outputs['Color'], nm.inputs['Color'])
    p = nt.nodes.new('ShaderNodeBsdfPrincipled')
    L.new(alb.outputs['Color'], p.inputs['Base Color']); L.new(rg.outputs['Color'], p.inputs['Roughness']); L.new(nm.outputs['Normal'], p.inputs['Normal'])
    p.inputs['Specular IOR Level'].default_value = 0.5 * lk['spec']
    s = lk['sheen']
    p.inputs['Sheen Weight'].default_value = s[0] * 1.5; p.inputs['Sheen Roughness'].default_value = s[1]
    mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx_in(mx, 'Factor').default_value = s[2]; mx_in(mx, 'B').default_value = (1, 1, 1, 1)
    L.new(alb.outputs['Color'], mx_in(mx, 'A')); L.new(mx_out(mx), p.inputs['Sheen Tint'])
    if 'coat' in lk:
        p.inputs['Coat Weight'].default_value = lk['coat'][0]; p.inputs['Coat Roughness'].default_value = lk['coat'][1]
    shader = p
    if os.path.exists(os.path.join(maps, 'cloth_alpha.png')):   # the engine's discards (tuck, cuffs, neckline) as cut-outs
        al = tex(nt, os.path.join(maps, 'cloth_alpha.png'), 'Non-Color', uv, interp='Closest')
        tr = nt.nodes.new('ShaderNodeBsdfTransparent'); ms = nt.nodes.new('ShaderNodeMixShader')
        L.new(al.outputs['Color'], ms.inputs['Fac']); L.new(tr.outputs['BSDF'], ms.inputs[1]); L.new(p.outputs['BSDF'], ms.inputs[2]); shader = ms
    L.new(shader.outputs[0], out.inputs['Surface'])
    return m


def _sample_mask(path, uv):
    """nearest-texel values (0..1) of a mask PNG at uv (n, 2)"""
    im = bpy.data.images.load(path, check_existing=True); im.colorspace_settings.name = 'Non-Color'
    w, h = im.size; px = np.empty(w * h * 4, dtype=np.float32); im.pixels.foreach_get(px)
    a = px.reshape(h, w, 4)[..., 0]
    x = np.clip((uv[:, 0] * w).astype(int), 0, w - 1); y = np.clip((uv[:, 1] * h).astype(int), 0, h - 1)
    return a[y, x]


def fabric_material(name, fabric, colour):
    lk = LOOKS.get(fabric, LOOKS['twillPC'])
    m, nt, out = mat_new(name)
    L = nt.links
    p = nt.nodes.new('ShaderNodeBsdfPrincipled')
    col = hex2lin(colour or '#3a3a40')
    p.inputs['Base Color'].default_value = col
    p.inputs['Roughness'].default_value = lk['rough']
    p.inputs['Specular IOR Level'].default_value = 0.5 * lk['spec']
    s = lk['sheen']
    p.inputs['Sheen Weight'].default_value = s[0] * 1.5
    p.inputs['Sheen Roughness'].default_value = s[1]
    p.inputs['Sheen Tint'].default_value = tuple(col[i] * (1 - s[2]) + s[2] for i in range(3)) + (1.0,)
    if 'coat' in lk:
        p.inputs['Coat Weight'].default_value = lk['coat'][0]; p.inputs['Coat Roughness'].default_value = lk['coat'][1]
    # the weave in the garment's own coordinate (hero.js's metric uv: u along the body / limb, v round it), threads per cm from the look
    attr = nt.nodes.new('ShaderNodeAttribute'); attr.attribute_name = 'cloth_uv'; attr.attribute_type = 'GEOMETRY'
    sx = nt.nodes.new('ShaderNodeSeparateXYZ'); L.new(attr.outputs['Vector'], sx.inputs['Vector'])
    def wave(src, per_m, phase_from=None, k=1.0):
        mm = nt.nodes.new('ShaderNodeMath'); mm.operation = 'MULTIPLY'; mm.inputs[1].default_value = per_m * 2 * math.pi
        L.new(src, mm.inputs[0])
        if phase_from is not None:
            ad = nt.nodes.new('ShaderNodeMath'); ad.operation = 'MULTIPLY_ADD'; ad.inputs[1].default_value = k * per_m * 2 * math.pi
            L.new(phase_from, ad.inputs[0]); L.new(mm.outputs[0], ad.inputs[2]); mm = ad
        sn = nt.nodes.new('ShaderNodeMath'); sn.operation = 'SINE'; L.new(mm.outputs[0], sn.inputs[0])
        return sn
    if lk['kind'] != 'leather':
        warp = wave(sx.outputs['Y'], lk['epc'] * 100)
        weft = wave(sx.outputs['X'], lk['ppc'] * 100, sx.outputs['Y'] if lk['kind'] == 'twill' else None, 0.5)
        mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'
        L.new(warp.outputs[0], mul.inputs[0]); L.new(weft.outputs[0], mul.inputs[1])
        b = nt.nodes.new('ShaderNodeBump'); b.inputs['Strength'].default_value = 0.35; b.inputs['Distance'].default_value = 0.00025
        L.new(mul.outputs[0], b.inputs['Height']); L.new(b.outputs['Normal'], p.inputs['Normal'])
    else:
        n = nt.nodes.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = 900.0; n.inputs['Detail'].default_value = 4
        tc = nt.nodes.new('ShaderNodeTexCoord'); L.new(tc.outputs['Object'], n.inputs['Vector'])
        b = nt.nodes.new('ShaderNodeBump'); b.inputs['Strength'].default_value = 0.2; b.inputs['Distance'].default_value = 0.0002
        L.new(n.outputs['Fac'], b.inputs['Height']); L.new(b.outputs['Normal'], p.inputs['Normal'])
    L.new(p.outputs['BSDF'], out.inputs['Surface'])
    return m



# ---------------------------------------------------------------- FABRIC6 (round 6, opt-in): fabric rev 6 in Cycles
# Only when the export folder carries fabric6.json (labs/clothing2/fabric6_texbake.mjs writes it beside a garment atlas baked with fabric
# rev 6 on: web/lib/fx/cloth/fabric6.js); without it every garment material above is built exactly as before. Over the baked atlas (rev
# 6's wrinkles, seams, hems, wear and the far colour, from the engine's own shader) the yarn tile the engine renders from the SAME yarn
# functions (labs/clothing2/fabric6_tiles.mjs: r weft shows, g height, b end-to-end tone / 2; a fibre tile for heather) in the garment's
# pattern coordinate at the fabric's thread count: the per-yarn colour as a ratio to the far colour (so the atlas keeps its level), the
# yarn relief as a bump on the atlas normal; Principled sheen (the microfibre model) for the fibres; anisotropy along the warp.
F6_TILES = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web', 'assets', 'fabric6', 'tiles')


def fabric6_record(export_dir):
    """the export's fabric6.json (rev 6 on for its garments), or None"""
    f = os.path.join(export_dir, 'fabric6.json')
    return json.load(open(f)) if os.path.exists(f) else None


def _f7_array(path):
    """a tile PNG as a (h, w, 4) float32 array (Blender's own row order; the mosaic does not care)"""
    im = bpy.data.images.load(path, check_existing=True); im.colorspace_settings.name = 'Non-Color'
    w, h = im.size; px = np.empty(w * h * 4, dtype=np.float32); im.pixels.foreach_get(px)
    return px.reshape(h, w, 4)


def _f7_image(name, arr):
    """a generated Non-Color image from a (h, w, 4) float array (the tile mosaic), packed so it survives a save"""
    h, w, _ = arr.shape
    im = bpy.data.images.new(name, w, h, alpha=True, float_buffer=False)
    im.colorspace_settings.name = 'Non-Color'
    im.pixels.foreach_set(np.ascontiguousarray(arr, dtype=np.float32).ravel()); im.update()
    try:
        im.pack()
    except Exception:
        pass
    return im


def _f6_detail(nt, f6, fabric, colour):
    """the yarn tile's colour ratio (RGBA socket) and height (float socket) for a fabric in a garment colour; None when no tile"""
    lk = (f6.get('fabrics') or {}).get(fabric)
    per = f6.get('per', 32)
    yarn = os.path.join(F6_TILES, f'{fabric}_yarn.png')
    if not lk or not os.path.exists(yarn):
        return None
    L = nt.links
    uvc = nt.nodes.new('ShaderNodeUVMap'); uvc.uv_map = 'cloth'
    mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (lk['epc'] * 100.0 / per, lk['ppc'] * 100.0 / per, 1.0)
    L.new(uvc.outputs['UV'], mp.inputs['Vector'])
    ty = nt.nodes.new('ShaderNodeTexImage'); ty.image = img(yarn, 'Non-Color'); ty.extension = 'REPEAT'; ty.interpolation = 'Linear'; L.new(mp.outputs['Vector'], ty.inputs['Vector'])
    v7 = bool(f6.get('version7'))   # FABRIC7: a mosaic of the tile (blender/fabric7_tiles.py) for the woven tone's 32-end repeat and the heather fibre's 2 cm repeat
    if v7:
        f7c.retile(nt, ty, uvc, mp, yarn, fabric, 'yarn', _f7_array, _f7_image)
    sp = nt.nodes.new('ShaderNodeSeparateColor'); L.new(ty.outputs['Color'], sp.inputs['Color'])
    dye = hex2lin(colour or '#808080')
    weft = tuple(lk['weft']) + (1.0,) if lk.get('weft') else dye
    ws = lk.get('weftShowDetail', lk.get('weftShow', 0.0))   # the yarn model's own weft share: the ratio's mean
    het = lk.get('heather') or [0, None]
    mean = [dye[i] * (1 - ws) + weft[i] * ws for i in range(3)]
    if het[0] > 0 and het[1]:
        mean = [mean[i] * (1 - het[0]) + het[1][i] * het[0] for i in range(3)]
    # yarn colour: the warp's dye or the weft's own by r, the end-to-end tone (b x 2)
    yc = nt.nodes.new('ShaderNodeMix'); yc.data_type = 'RGBA'; mx_in(yc, 'A').default_value = dye; mx_in(yc, 'B').default_value = weft
    L.new(sp.outputs['Red'], mx_in(yc, 'Factor'))
    tn = nt.nodes.new('ShaderNodeMath'); tn.operation = 'MULTIPLY'; tn.inputs[1].default_value = 2.0; L.new(sp.outputs['Blue'], tn.inputs[0])
    ytn = nt.nodes.new('ShaderNodeMix'); ytn.data_type = 'RGBA'; ytn.blend_type = 'MULTIPLY'; mx_in(ytn, 'Factor').default_value = 1.0
    L.new(mx_out(yc), mx_in(ytn, 'A'))
    cmb = nt.nodes.new('ShaderNodeCombineColor'); L.new(tn.outputs[0], cmb.inputs['Red']); L.new(tn.outputs[0], cmb.inputs['Green']); L.new(tn.outputs[0], cmb.inputs['Blue'])
    L.new(cmb.outputs['Color'], mx_in(ytn, 'B'))
    cur = mx_out(ytn)
    fib = os.path.join(F6_TILES, f'{fabric}_fibre.png')
    if het[0] > 0 and het[1] and os.path.exists(fib):
        tf = nt.nodes.new('ShaderNodeTexImage'); tf.image = img(fib, 'Non-Color'); tf.extension = 'REPEAT'; tf.interpolation = 'Closest'; L.new(mp.outputs['Vector'], tf.inputs['Vector'])
        if v7:
            f7c.retile(nt, tf, uvc, mp, fib, fabric, 'fibre', _f7_array, _f7_image)
        hm = nt.nodes.new('ShaderNodeMix'); hm.data_type = 'RGBA'; mx_in(hm, 'B').default_value = tuple(het[1]) + (1.0,)
        L.new(cur, mx_in(hm, 'A')); L.new(tf.outputs['Color'], mx_in(hm, 'Factor')); cur = mx_out(hm)
    # the gaps between yarns in shadow (the engine's ao from the height), over the far colour: a ratio near 1 on average
    ao = nt.nodes.new('ShaderNodeMapRange'); ao.inputs['From Min'].default_value = 0.0625; ao.inputs['From Max'].default_value = 0.7125
    ao.inputs['To Min'].default_value = 0.5; ao.inputs['To Max'].default_value = 1.0; L.new(sp.outputs['Green'], ao.inputs['Value'])
    norm = lk.get('aoMean', 0.86 if lk['kind'] in ('plain', 'twill', 'duck', 'basket') else 0.8)   # the tile's own mean shadowing
    sc = nt.nodes.new('ShaderNodeMix'); sc.data_type = 'RGBA'; sc.blend_type = 'MULTIPLY'; mx_in(sc, 'Factor').default_value = 1.0
    L.new(cur, mx_in(sc, 'A'))
    cm2 = nt.nodes.new('ShaderNodeCombineColor')
    for ch in ('Red', 'Green', 'Blue'):
        L.new(ao.outputs['Result'], cm2.inputs[ch])
    L.new(cm2.outputs['Color'], mx_in(sc, 'B'))
    dv = nt.nodes.new('ShaderNodeMix'); dv.data_type = 'RGBA'; dv.blend_type = 'DIVIDE'; mx_in(dv, 'Factor').default_value = 1.0
    L.new(mx_out(sc), mx_in(dv, 'A')); mx_in(dv, 'B').default_value = tuple(max(1e-4, x * norm) for x in mean) + (1.0,)
    # a raised nap hides the weave (wool flannel, fleece): the engine draws the yarns at 1 - 0.75 nap; here the ratio and the bump alike
    hide = 1.0 - 0.75 * lk.get('nap', 0.0)
    if hide < 0.999:
        nm_ = nt.nodes.new('ShaderNodeMix'); nm_.data_type = 'RGBA'; mx_in(nm_, 'Factor').default_value = hide; mx_in(nm_, 'A').default_value = (1, 1, 1, 1)
        L.new(mx_out(dv), mx_in(nm_, 'B')); hm_ = nt.nodes.new('ShaderNodeMath'); hm_.operation = 'MULTIPLY'; hm_.inputs[1].default_value = hide
        L.new(sp.outputs['Green'], hm_.inputs[0])
        return dict(ratio=mx_out(nm_), height=hm_.outputs[0], look=lk)
    return dict(ratio=mx_out(dv), height=sp.outputs['Green'], look=lk)


def _f6_principled(nt, p, lk, height, normal_in=None):
    """the rev-6 sheen, anisotropy along the warp and the yarn bump on a Principled BSDF"""
    L = nt.links
    p.inputs['Sheen Weight'].default_value = lk['sheen'][0] * 1.5; p.inputs['Sheen Roughness'].default_value = lk['sheen'][1]
    if lk.get('aniso', 0) > 0 and 'Anisotropic' in p.inputs:
        tg = nt.nodes.new('ShaderNodeTangent'); tg.direction_type = 'UV_MAP'; tg.uv_map = 'cloth'
        p.inputs['Anisotropic'].default_value = lk['aniso']; p.inputs['Anisotropic Rotation'].default_value = 0.25; L.new(tg.outputs['Tangent'], p.inputs['Tangent'])
    if height is not None:
        b = nt.nodes.new('ShaderNodeBump'); b.inputs['Strength'].default_value = 1.0
        b.inputs['Distance'].default_value = 0.75 * 0.8 / (lk['epc'] * 100.0)   # g = (h + 0.35) / 0.8, h in warp spacings
        L.new(height, b.inputs['Height'])
        if normal_in is not None:
            L.new(normal_in, b.inputs['Normal'])
        L.new(b.outputs['Normal'], p.inputs['Normal'])


def _f7_tex(nt, path):
    """a Non-Color image texture of `path` on the garment atlas's uv (the node fabric_material_baked made), for fabric7_cycles.post_material's metalness map"""
    uv = next((n for n in nt.nodes if n.type == 'UVMAP'), None)
    return tex(nt, path, 'Non-Color', uv)


def _f7_log(name, done):
    """FABRIC7 rev 7.7: print what fabric7_cycles.post_material did to a material (c3 it2: the returned list was discarded, so the 'boot upper: coat 0.22' line never reached a log)"""
    for line in done or []:
        print(f'fabric7_cycles: {name}: {line}', flush=True)
    return done


def fabric_material_baked6(name, fabric, maps, colour, f6):
    """K4's baked garment material (the rev-6 atlas) with the yarn tile, sheen and anisotropy of fabric rev 6"""
    m = fabric_material_baked(name, fabric, maps)
    nt = m.node_tree; L = nt.links
    d = _f6_detail(nt, f6, fabric, colour)
    if d is None:
        if f6.get('version7'):
            _f7_log(name, f7c.post_material(name, m, maps, _f7_tex))
        return m
    p = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    alb = next(n for n in nt.nodes if n.type == 'TEX_IMAGE' and n.image and 'cloth_albedo' in n.image.name)
    nm = next((n for n in nt.nodes if n.type == 'NORMAL_MAP'), None)
    mul = nt.nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mx_in(mul, 'Factor').default_value = 1.0
    L.new(alb.outputs['Color'], mx_in(mul, 'A')); L.new(d['ratio'], mx_in(mul, 'B'))
    L.new(mx_out(mul), p.inputs['Base Color'])
    _f6_principled(nt, p, d['look'], d['height'], nm.outputs['Normal'] if nm else None)
    if f6.get('version7'):   # FABRIC7 (opt-in): the sole without the boot-leather clearcoat, the metalness map (the shoe eyelets) into Metallic; after the sheen above so a metal part keeps none
        _f7_log(name, f7c.post_material(name, m, maps, _f7_tex))
    return m


def fabric_material6(name, fabric, colour, f6):
    """rev 6 without an atlas (the fabric book's Cycles swatches): the far colour, the look's roughness, the yarn tile, sheen, anisotropy"""
    lk6 = (f6.get('fabrics') or {}).get(fabric)
    if not lk6:
        return fabric_material(name, fabric, colour)
    m, nt, out = mat_new(name); L = nt.links
    p = nt.nodes.new('ShaderNodeBsdfPrincipled')
    dye = hex2lin(colour or '#808080'); weft = tuple(lk6['weft']) + (1.0,) if lk6.get('weft') else dye; ws = lk6.get('weftShow', 0.0)
    far = tuple(dye[i] * (1 - ws) + weft[i] * ws for i in range(3)) + (1.0,)
    p.inputs['Roughness'].default_value = lk6['rough']; p.inputs['Specular IOR Level'].default_value = 0.5 * lk6.get('spec', 0.4)
    d = _f6_detail(nt, f6, fabric, colour)
    if d is not None:
        mul = nt.nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mx_in(mul, 'Factor').default_value = 1.0
        mx_in(mul, 'A').default_value = far; L.new(d['ratio'], mx_in(mul, 'B')); L.new(mx_out(mul), p.inputs['Base Color'])
    else:
        p.inputs['Base Color'].default_value = far
    st = lk6['sheen']; p.inputs['Sheen Tint'].default_value = tuple(far[i] * (1 - st[2]) + st[2] for i in range(3)) + (1.0,)
    _f6_principled(nt, p, lk6, d['height'] if d else None)
    L.new(p.outputs['BSDF'], out.inputs['Surface'])
    return m

# ---------------------------------------------------------------- eyes (lane B's globes as organs)
def _sphere_cap(c, R, th0, th1, nT=48, nP=96):
    """vertices and triangles of a sphere zone about +z from polar angle th0 to th1 (radians), centre c"""
    V, T = [], []
    for i in range(nT + 1):
        th = th0 + (th1 - th0) * (i / nT)
        for j in range(nP):
            ph = 2 * math.pi * j / nP
            V.append((c[0] + R * math.sin(th) * math.cos(ph), c[1] + R * math.sin(th) * math.sin(ph), c[2] + R * math.cos(th)))
    for i in range(nT):
        for j in range(nP):
            a, b = i * nP + j, i * nP + (j + 1) % nP
            T.append((a, a + nP, b)); T.append((b, a + nP, b + nP))
    return np.array(V), np.array(T)


def eye_materials(E):
    mats = {}
    # sclera: not white (lane B: 0.55-0.6, a little warm), thin scattering, the tear film as a wet coat
    m, nt, out = mat_new('eye_sclera'); p = nt.nodes.new('ShaderNodeBsdfPrincipled')
    age = E.get('age', 0.3) or 0.3
    sc = E.get('sclera')   # (integration v4, SKIN4's hand-off) the engine's sclera albedo when the export carries it (eyes rev 4), aged as render_s4 did
    p.inputs['Base Color'].default_value = (sc[0], sc[1] - 0.03 * age, sc[2] - 0.06 * age, 1) if sc else (0.62, 0.58 - 0.04 * age, 0.53 - 0.08 * age, 1)
    p.inputs['Roughness'].default_value = 0.35
    p.inputs['Subsurface Weight'].default_value = 0.5; p.subsurface_method = 'RANDOM_WALK'
    p.inputs['Subsurface Radius'].default_value = (1.0, 0.5, 0.35); p.inputs['Subsurface Scale'].default_value = 0.0015
    p.inputs['Coat Weight'].default_value = 1.0; p.inputs['Coat Roughness'].default_value = 0.03; p.inputs['Coat IOR'].default_value = 1.336
    # faint vessels: a ridged noise, stronger toward the canthi (object x)
    n = nt.nodes.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = 260.0; n.inputs['Detail'].default_value = 6; n.inputs['Distortion'].default_value = 0.6
    tc = nt.nodes.new('ShaderNodeTexCoord'); nt.links.new(tc.outputs['Object'], n.inputs['Vector'])
    cr = nt.nodes.new('ShaderNodeValToRGB'); cr.color_ramp.elements[0].position = 0.62; cr.color_ramp.elements[1].position = 0.68
    cr.color_ramp.elements[0].color = (1, 1, 1, 1); cr.color_ramp.elements[1].color = (0.8, 0.45, 0.42, 1)
    nt.links.new(n.outputs['Fac'], cr.inputs['Fac'])
    mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx_in(mx, 'Factor').default_value = 0.35
    mx_in(mx, 'A').default_value = p.inputs['Base Color'].default_value
    nt.links.new(cr.outputs['Color'], mx_in(mx, 'B')); nt.links.new(mx_out(mx), p.inputs['Base Color'])
    gm = nt.nodes.new('ShaderNodeNewGeometry'); dk = nt.nodes.new('ShaderNodeBsdfDiffuse'); dk.inputs['Color'].default_value = (0.01, 0.006, 0.005, 1)
    ms = nt.nodes.new('ShaderNodeMixShader'); nt.links.new(gm.outputs['Backfacing'], ms.inputs['Fac'])
    nt.links.new(p.outputs['BSDF'], ms.inputs[1]); nt.links.new(dk.outputs['BSDF'], ms.inputs[2])
    nt.links.new(ms.outputs['Shader'], out.inputs['Surface']); mats['sclera'] = m
    # iris: lane B's colours (linear), radial fibres in the disc's own polar uv (u = angle / 2 pi, v = radius / iris radius)
    C = E.get('irisColours') or {'base': [0.045, 0.022, 0.009], 'fibre': [0.1, 0.052, 0.02], 'center': [0.12, 0.062, 0.02], 'limbus': [0.012, 0.008, 0.006]}
    m, nt, out = mat_new('eye_iris'); p = nt.nodes.new('ShaderNodeBsdfPrincipled'); L = nt.links
    uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'polar'
    sx = nt.nodes.new('ShaderNodeSeparateXYZ'); L.new(uvn.outputs['UV'], sx.inputs['Vector'])
    cx = nt.nodes.new('ShaderNodeCombineXYZ'); mu = nt.nodes.new('ShaderNodeMath'); mu.operation = 'MULTIPLY'; mu.inputs[1].default_value = 90.0
    L.new(sx.outputs['X'], mu.inputs[0]); L.new(mu.outputs[0], cx.inputs['X'])
    mv = nt.nodes.new('ShaderNodeMath'); mv.operation = 'MULTIPLY'; mv.inputs[1].default_value = 3.0; L.new(sx.outputs['Y'], mv.inputs[0]); L.new(mv.outputs[0], cx.inputs['Y'])
    n = nt.nodes.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = 1.0; n.inputs['Detail'].default_value = 5; n.inputs['Roughness'].default_value = 0.6
    L.new(cx.outputs['Vector'], n.inputs['Vector'])
    cr = nt.nodes.new('ShaderNodeValToRGB'); cr.color_ramp.elements[0].color = tuple(C['base']) + (1,); cr.color_ramp.elements[1].color = tuple(C['fibre']) + (1,)
    cr.color_ramp.elements[0].position = 0.35; cr.color_ramp.elements[1].position = 0.75; L.new(n.outputs['Fac'], cr.inputs['Fac'])
    # radial zones: the pupillary zone (collarette inward, v < 0.45), the limbal ring (v > 0.88)
    zr = nt.nodes.new('ShaderNodeValToRGB'); e = zr.color_ramp.elements
    e[0].position = 0.40; e[0].color = tuple(C['center']) + (1,); e[1].position = 0.50; e[1].color = (1, 1, 1, 1)
    e2 = zr.color_ramp.elements.new(0.86); e2.color = (1, 1, 1, 1); e3 = zr.color_ramp.elements.new(0.97); e3.color = tuple(np.array(C['limbus']) / max(1e-4, np.mean(C['fibre']))) + (1,)
    L.new(sx.outputs['Y'], zr.inputs['Fac'])
    z1 = nt.nodes.new('ShaderNodeMix'); z1.data_type = 'RGBA'; z1.blend_type = 'MULTIPLY'; mx_in(z1, 'Factor').default_value = 1.0
    L.new(cr.outputs['Color'], mx_in(z1, 'A')); L.new(zr.outputs['Color'], mx_in(z1, 'B'))
    # inside the collarette the colour is the centre colour itself (not multiplied)
    z2 = nt.nodes.new('ShaderNodeMix'); z2.data_type = 'RGBA'; mx_in(z2, 'B').default_value = tuple(C['center']) + (1,)
    st = nt.nodes.new('ShaderNodeMath'); st.operation = 'LESS_THAN'; st.inputs[1].default_value = 0.42; L.new(sx.outputs['Y'], st.inputs[0])
    L.new(st.outputs[0], mx_in(z2, 'Factor')); L.new(mx_out(z1), mx_in(z2, 'A'))
    L.new(mx_out(z2), p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = 0.5
    # the iris lies in the aqueous humour (n 1.336 against the stroma's ~1.4: F0 < 0.1 %), not in air: no specular of its own (with
    # the default F0 of 4 % it reflected the sky as brightly as its dark stroma scatters, and dark-brown irises rendered blue-grey)
    p.inputs['Specular IOR Level'].default_value = 0.0
    bp = nt.nodes.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.6; bp.inputs['Distance'].default_value = 0.0001
    L.new(n.outputs['Fac'], bp.inputs['Height']); L.new(bp.outputs['Normal'], p.inputs['Normal'])
    L.new(p.outputs['BSDF'], out.inputs['Surface']); mats['iris'] = m
    # pupil and the eye's interior: near black
    m, nt, out = mat_new('eye_pupil'); d = nt.nodes.new('ShaderNodeBsdfDiffuse'); d.inputs['Color'].default_value = (0.004, 0.003, 0.003, 1)
    nt.links.new(d.outputs['BSDF'], out.inputs['Surface']); mats['pupil'] = m
    # cornea and tear meniscus: clear refracting surfaces, transparent to shadow rays (so the iris behind them is lit: a path tracer
    # cannot find the caustic of a sun through a 7.8 mm lens)
    for nm_, ior, rough in (('cornea', 1.376, 0.0), ('tear', 1.336, 0.02)):
        m, nt, out = mat_new('eye_' + nm_); L = nt.links
        g = nt.nodes.new('ShaderNodeBsdfPrincipled'); g.inputs['Base Color'].default_value = (1, 1, 1, 1); g.inputs['Transmission Weight'].default_value = 1.0
        g.inputs['IOR'].default_value = ior; g.inputs['Roughness'].default_value = rough
        tr = nt.nodes.new('ShaderNodeBsdfTransparent'); lp = nt.nodes.new('ShaderNodeLightPath'); mx = nt.nodes.new('ShaderNodeMixShader')
        L.new(lp.outputs['Is Shadow Ray'], mx.inputs['Fac']); L.new(g.outputs['BSDF'], mx.inputs[1]); L.new(tr.outputs['BSDF'], mx.inputs[2])
        L.new(mx.outputs['Shader'], out.inputs['Surface']); mats[nm_] = m
    m, nt, out = mat_new('eye_caruncle'); p = nt.nodes.new('ShaderNodeBsdfPrincipled')
    p.inputs['Base Color'].default_value = (0.55, 0.22, 0.2, 1); p.inputs['Roughness'].default_value = 0.25
    p.inputs['Subsurface Weight'].default_value = 1.0; p.inputs['Subsurface Scale'].default_value = 0.002
    p.inputs['Coat Weight'].default_value = 1.0; p.inputs['Coat Roughness'].default_value = 0.05
    nt.links.new(p.outputs['BSDF'], out.inputs['Surface']); mats['caruncle'] = m
    return mats


def build_eyes(E, coll):
    """lane B's fitted globes (bind space, three's frame) carried to the posed head by the exported bind -> world matrix"""
    Mh = np.array(E['headMatrix'], dtype=float).reshape(4, 4).T     # three's toArray is column-major
    mats = eye_materials(E)
    pupil = E.get('pupil', 0.0018)
    objs = []
    for e in E['globes']:
        c = np.array(e['c']); r, rc, rl, zcc, ins = e['r'], e['rc'], e['rl'], e['zcc'], e['inset']
        thL = math.asin(min(0.99, rl / r))
        parts = []
        # sclera: the globe behind the limbus (centre c - inset z)
        V, T = _sphere_cap((0, 0, -ins), r, thL, math.pi * 0.92, 40, 96); parts.append(('sclera', V, T, None))
        # cornea: the 7.8 mm cap in front of the limbus, a hair past it so no crack opens at the limbus
        thc = math.asin(min(0.999, rl / rc)) + 0.03
        V, T = _sphere_cap((0, 0, zcc - ins), rc, 0.0, thc, 24, 96); parts.append(('cornea', V, T, None))
        # iris: an annulus from the pupil to the limbus, 3 mm behind the apex, bulging 0.4 mm forward toward the pupil (the lens behind it)
        # the iris runs out to the globe's inner wall at its plane (a gap there showed the inside of the globe as a pale ring); the
        # part past the limbus is hidden under it, and the limbal ring is painted from the limbus radius
        zi, nR, nP = e['irisZ'], 14, 96
        ri = math.sqrt(max(rl * rl, r * r - (zi + ins) ** 2)) * 0.995
        V, T, UV = [], [], []
        for i in range(nR + 1):
            rr = pupil + (ri - pupil) * i / nR
            for j in range(nP + 1):
                ph = 2 * math.pi * j / nP
                V.append((rr * math.cos(ph), rr * math.sin(ph), zi + 0.0004 * (1 - (rr / ri) ** 2)))
                UV.append((j / nP, rr / rl))
        for i in range(nR):
            for j in range(nP):
                a, b = i * (nP + 1) + j, (i + 1) * (nP + 1) + j
                T.append((a, a + 1, b)); T.append((a + 1, b + 1, b))
        parts.append(('iris', np.array(V), np.array(T), np.array(UV)))
        # pupil: a dark disc just behind the iris's inner edge
        V, T = [(0, 0, zi - 0.0006)], []
        for j in range(48):
            ph = 2 * math.pi * j / 48; V.append((pupil * 1.3 * math.cos(ph), pupil * 1.3 * math.sin(ph), zi - 0.0006))
        T = [(0, 1 + j, 1 + (j + 1) % 48) for j in range(48)]
        parts.append(('pupil', np.array(V), np.array(T), None))
        # tear meniscus: a 0.25 mm tube along the lower lid margin (lane B's fissure: radius per 10 degrees, 0 temporal, 9 up, 18 nasal, 27 down)
        fis = e['fissure']; ks = list(range(18, 36)) + [0]
        pts = []
        for k in ks:
            rho = min(fis[k], r * 0.98); al = k / 36 * 2 * math.pi
            x, y = rho * math.cos(al) * e['side'], rho * math.sin(al)
            z = math.sqrt(max(0.0, r * r - rho * rho)) - ins + 0.00015
            pts.append((x, y, z))
        V, T = [], []
        tr_, ns = 0.00025, 8
        for i, p_ in enumerate(pts):
            q = np.array(pts[min(i + 1, len(pts) - 1)]) - np.array(pts[max(i - 1, 0)]); q /= np.linalg.norm(q) + 1e-9
            u = np.cross(q, (0, 0, 1)); u /= np.linalg.norm(u) + 1e-9; w = np.cross(q, u)
            for s in range(ns):
                a = 2 * math.pi * s / ns; V.append(tuple(np.array(p_) + tr_ * (math.cos(a) * u + math.sin(a) * w)))
        for i in range(len(pts) - 1):
            for s in range(ns):
                a, b = i * ns + s, i * ns + (s + 1) % ns
                T.append((a, a + ns, b)); T.append((b, a + ns, b + ns))
        parts.append(('tear', np.array(V), np.array(T), None))
        # caruncle: a small moist mound at the inner canthus
        rho = min(fis[18], r * 0.98); x = -rho * e['side'] * 0.98; z = math.sqrt(max(0.0, r * r - rho * rho)) - ins - 0.0004
        V, T = _sphere_cap((x, -0.0004, z), 0.0016, 0.0, math.pi, 10, 16); parts.append(('caruncle', V, T, None))
        for nm_, V, T, UV in parts:
            Pw = (Mh @ np.c_[V + c, np.ones(len(V))].T).T[:, :3]
            me = build_mesh(f'eye{e["side"]:+d}_{nm_}', Pw, T, smooth=True)
            if UV is not None:
                add_corner_uv(me, 'polar', UV[np.asarray(T).ravel()])
            me.materials.append(mats[nm_])
            ob = object_for(me, collection=coll); objs.append(ob)
    return objs


# ---------------------------------------------------------------- lights
def world_over(strength=1.0, rotation_deg=0.0):
    w = bpy.data.worlds.new('over'); w.use_nodes = True; nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputWorld'); bg = nt.nodes.new('ShaderNodeBackground'); et = nt.nodes.new('ShaderNodeTexEnvironment')
    et.image = bpy.data.images.load(hdri_path('overcast'), check_existing=True)
    tc = nt.nodes.new('ShaderNodeTexCoord'); mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Rotation'].default_value = (0, 0, math.radians(rotation_deg))
    nt.links.new(tc.outputs['Generated'], mp.inputs['Vector']); nt.links.new(mp.outputs['Vector'], et.inputs['Vector'])
    # the CIE standard overcast sky's gradient, L(theta) = Lz (1 + 2 cos theta) / 3 (Moon and Spencer 1942; the engine's overcast is
    # this model): the CC0 dome measures nearly flat (zenith 0.97, 30 degrees 1.44, horizon 0.66), which left the figure lit as if
    # from everywhere at once; its cloud texture and colour stay
    sx = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(tc.outputs['Generated'], sx.inputs['Vector'])
    mz = nt.nodes.new('ShaderNodeMath'); mz.operation = 'MAXIMUM'; mz.inputs[1].default_value = 0.0; nt.links.new(sx.outputs['Z'], mz.inputs[0])
    cie = nt.nodes.new('ShaderNodeMath'); cie.operation = 'MULTIPLY_ADD'; cie.inputs[1].default_value = 2.0 / 3.0 * 1.4; cie.inputs[2].default_value = 1.0 / 3.0 * 1.4
    nt.links.new(mz.outputs[0], cie.inputs[0])
    mul = nt.nodes.new('ShaderNodeVectorMath'); mul.operation = 'SCALE'
    nt.links.new(et.outputs['Color'], mul.inputs[0]); nt.links.new(cie.outputs[0], mul.inputs['Scale'])
    nt.links.new(mul.outputs['Vector'], bg.inputs['Color']); bg.inputs['Strength'].default_value = strength
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
    return w


def sun_vector(el, az):
    """the export's sunDirection (lib/fx/light/sky.js) in Blender's frame: toward the sun"""
    e, a = math.radians(el), math.radians(az)
    d3 = (math.sin(a) * math.cos(e), math.sin(e), -math.cos(a) * math.cos(e))
    return Vector((d3[0], -d3[2], d3[1]))


def world_sun(el, az, turbidity=2.5, sky_strength=1.0):
    w = bpy.data.worlds.new('sun'); w.use_nodes = True; nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputWorld'); bg = nt.nodes.new('ShaderNodeBackground'); sk = nt.nodes.new('ShaderNodeTexSky')
    sk.sky_type = 'HOSEK_WILKIE'; sk.turbidity = turbidity; sk.ground_albedo = 0.2
    d = sun_vector(el, az); sk.sun_direction = d
    nt.links.new(sk.outputs['Color'], bg.inputs['Color']); bg.inputs['Strength'].default_value = sky_strength
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
    return w


def add_sun(el, az, angle_deg=0.53, strength=4.0, coll=None):
    ld = bpy.data.lights.new('sun', 'SUN'); ld.angle = math.radians(angle_deg); ld.energy = strength
    ld.color = (1.0, 0.96, 0.9)
    ob = bpy.data.objects.new('sun', ld); (coll or bpy.context.scene.collection).objects.link(ob)
    d = sun_vector(el, az)
    ob.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    return ob


def ground(coll, albedo=(0.25, 0.235, 0.21)):
    me = build_mesh('ground', np.array([[-40, -40, 0], [40, -40, 0], [40, 40, 0], [-40, 40, 0]], float), np.array([[0, 1, 2], [0, 2, 3]]), smooth=False)
    m, nt, out = mat_new('concrete'); p = nt.nodes.new('ShaderNodeBsdfPrincipled')
    n = nt.nodes.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = 3.0; n.inputs['Detail'].default_value = 8
    tc = nt.nodes.new('ShaderNodeTexCoord'); nt.links.new(tc.outputs['Object'], n.inputs['Vector'])
    cr = nt.nodes.new('ShaderNodeValToRGB'); cr.color_ramp.elements[0].color = tuple(np.array(albedo) * 0.85) + (1,); cr.color_ramp.elements[1].color = tuple(np.array(albedo) * 1.12) + (1,)
    nt.links.new(n.outputs['Fac'], cr.inputs['Fac']); nt.links.new(cr.outputs['Color'], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = 0.9
    nt.links.new(p.outputs['BSDF'], out.inputs['Surface'])
    me.materials.append(m)
    return object_for(me, collection=coll)


# ---------------------------------------------------------------- camera
def camera_from(rec, name='cam'):
    cd = bpy.data.cameras.new(name)
    cd.sensor_fit = 'VERTICAL'
    focal = (rec.get('lens') or {}).get('focal', 50)
    cd.lens = focal
    cd.sensor_height = 2 * focal * math.tan(math.radians(rec['fovY']) / 2)
    cd.sensor_width = cd.sensor_height * rec['W'] / rec['H']
    cd.clip_start = 0.02; cd.clip_end = 500
    ob = bpy.data.objects.new(name, cd); bpy.context.scene.collection.objects.link(ob)
    M = np.array(rec['matrix'], dtype=float).reshape(4, 4).T
    ob.matrix_world = Matrix(M.tolist())
    lens = rec.get('lens') or {}
    if lens.get('fstop'):
        cd.dof.use_dof = True; cd.dof.focus_distance = lens.get('focus', 2.0); cd.dof.aperture_fstop = lens['fstop']
    return ob


# ---------------------------------------------------------------- DETAIL7: the fine tier as true displacement (round 7, opt-in)
# The export's makePerson options carry "fine7" (person_job.py --popts '{"fine7": {...}}'): the fine tier's bake (web/labs/human8/fine7_bake.mjs,
# node, the same code as the engine's: lib/fx/anatomy/fine) writes <export>/fine7/ (the head chart's uv per body vertex and the relief in
# metres); here the chart's faces (all three corners on it) get a copy of the head atlas's skin with the relief's DISPLACEMENT band as true
# displacement and its BUMP band through a Bump node after the skin's normal map, and the body a Catmull-Clark subdivision (uv kept linear, so
# the skin atlas does not swim), PRE-DICED by Blender at a level set per camera (8 Oct 22:20; Cycles' adaptive dicing until then: {"adaptive": 1}), its control mesh PRE-COMPENSATED so the limit surface passes through the export's
# vertices (the eyes, lashes, brows and hair stay seated on the lids and the scalp). The relief fades to 0 at the chart's edge, so the chart's
# faces and their undisplaced neighbours meet without a crack. An export without "fine7" builds exactly as before.
# ITERATION 3 (DETAIL7, 8 Oct): the ROOT CAUSE of iteration 2's half-bright face, and of iteration 1's 'barely visible' relief: the maps were
# GENERATED images whose pixels were written and THEN their colour space set. Setting it frees a generated image's buffers (BKE_image_signal,
# IMA_SIGNAL_COLORMANAGE) and Blender re-made them BLANK (black): no displacement and no bump ever reached Cycles, and in iteration 2 the cavity
# read 0, so the base colour went x (0.5 + 0.5 x 0) over the whole chart (the measurer's 0.50-0.61 in linear light, the specular untouched,
# a step at the chart's edge, the bright rim on the lower lip where the non-chart wet lining met the halved chart). Now ONE RGBA float image
# (is_data at creation, never re-coloured), packed, and READ BACK after everything is wired: the log's imageCheck says what Cycles will see.
FINE7_DICING = 1.0           # pixels per micropolygon edge (Cycles' default 1; the displacement band holds nothing under ~1 mm since iteration 2)
FINE7_CYC_KEYS = ('off', 'disp', 'bump', 'cav', 'dicing', 'zero', 'body', 'predice', 'lobe', 'adaptive', 'level')
# ITERATION 8 (DETAIL7, 8 Oct): THE BASE SURFACE. Iterations 1-7 ran Catmull-Clark on the export's TRIANGLES (hm08's quads, triangulated, Loop-
# subdivided once by lib/fx/body/subdiv.js) and pre-compensated its control mesh so the limit passed through every vertex. Catmull-Clark on a
# triangle mesh is the wrong scheme: every triangle becomes three quads round a valence-3 point, every vertex is extraordinary, and the limit
# surface ripples along the triangulation; the inversion (an interpolating fit) then brings the mesh's own vertex-scale content back at full
# height. The i6 'norelief' twins (relief 0, the subdivision alone) carry exactly what the critic read as this tier's lines: L22's crumpled
# crease cluster from the inner canthus down the lid-cheek junction and L05's 'corduroy' of near-parallel diagonal cheek lines (both absent in
# the 'off' twin, the raw mesh); L08's i4 'noprecomp' twin shows the cheek streaks without the inversion (so the triangles carry them). A node
# diagnostic on the current L22 body (no render; numbers describe: review/.../detail7/NOTES.md, iteration 8) reproduces both.
# The export's triangles ARE hm08's quads, split exactly: Loop's 1-to-4 split of a quad's two triangles (a, b, c), (a, c, d) re-pairs into the
# four quads Catmull-Clark's own first step makes of (a, b, c, d) (the diagonal's edge point as the face point). fine7_quads recovers them
# from the triangles alone (hm08's diagonals from assets/hero, the base vertices' indices kept by subdiv.js), so Catmull-Clark runs on the
# quad mesh it was made for; and the control mesh is no longer inverted by default (the coarse tier's surface is the smooth approximation the
# engine's shading shows; every form under ~5 mm is this tier's relief). 'quads' 0 + 'precomp' 1 = iterations 1-7's surface (the 'tri' twin).
_HM08 = {}
def _hm08_diagonals():
    """hm08's quads as the hero bundle stores them (each quad two consecutive triangles (a, b, c), (a, c, d)): (NB, diagonal keys lo*2^21+hi)"""
    if 'd' in _HM08:
        return _HM08['d']
    base = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'web', 'assets', 'hero')
    meta = json.load(open(os.path.join(base, 'hero.json'))); A = meta['arrays']
    a = A['idx_body']; T0 = np.fromfile(os.path.join(base, 'hero.bin'), dtype=np.uint32, count=int(np.prod(a['shape'])), offset=a['offset']).reshape(-1, 3).astype(np.int64)
    NB = int(next(v['shape'][0] for k, v in A.items() if k.startswith('pos_')))
    t1, t2 = T0[0::2], T0[1::2]; n = min(len(t1), len(t2)); t1, t2 = t1[:n], t2[:n]
    fan = (t1[:, 0] == t2[:, 0]) & (t1[:, 2] == t2[:, 1])            # the pair shares the diagonal (a, c)
    lo, hi = np.minimum(t1[fan, 0], t1[fan, 2]), np.maximum(t1[fan, 0], t1[fan, 2])
    _HM08['d'] = (NB, np.unique(lo * 2097152 + hi), int(n), int(fan.sum()))
    return _HM08['d']


def fine7_quads(tri, atlas=None, uv=None):
    """pair the export's triangles back into hm08's Catmull-Clark quads -> (pairs (k, 2) triangle indices, report). Rules (Loop's 1-to-4 split
    of the quad's triangles abc, acd, its diagonal ac with edge point m): the two corner triangles at a meet across (a, m), the two at c across
    (c, m); the corner at b meets abc's middle triangle across (m_ab, m_bc), the corner at d acd's across (m_cd, m_da). A triangle whose partner
    is missing (dropped faces, another atlas) stays a triangle.
    (DETAIL7 c4 iteration 13) uv (per triangle corner, (nt, 3, 2): the skin atlas, Smart UV Project on the triangles): a pair whose shared edge
    is a UV SEAM (its two ends' corner uv differ between the two triangles) stays two triangles. Joined, the quad kept three corners in one
    chart and the fourth in another, so its texture was interpolated ACROSS the atlas (gutters, other charts): the dark dashes along the seams
    of every quad-subdivided face (L22 inner canthus -> nasolabial, the jaw; L05's cheek) and the pale chips / scratch dashes on torsos, thighs,
    forearms and necks (6.4 % of the pairs on L08's export; 1165 on the head atlas). The 'tri' twin had none: it joined nothing."""
    NB, DK, nq, nfan = _hm08_diagonals()
    T = np.asarray(tri, dtype=np.int64); nt = len(T); NV = int(T.max()) + 1
    u, w = T.ravel(), np.roll(T, -1, axis=1).ravel(); tid = np.repeat(np.arange(nt), 3)
    # each edge point's two base ends (the base vertices it shares an edge with)
    m1 = (u < NB) & (w >= NB); m2 = (u >= NB) & (w < NB)
    ep = np.concatenate([w[m1], u[m2]]); bv = np.concatenate([u[m1], w[m2]])
    pr = np.unique(ep * 2097152 + bv); ep_u, bv_u = pr // 2097152, pr % 2097152
    first = np.r_[True, ep_u[1:] != ep_u[:-1]]; idx = np.cumsum(first) - 1; cnt = np.bincount(idx)
    ends = -np.ones((NV, 2), dtype=np.int64); okE = cnt == 2; heads = np.nonzero(first)[0]
    ends[ep_u[heads[okE]], 0] = bv_u[heads[okE]]; ends[ep_u[heads[okE]], 1] = bv_u[heads[okE] + 1]
    isdiag = np.zeros(NV, dtype=bool); ve = ends[:, 0] >= 0
    isdiag[ve] = np.isin(np.minimum(ends[ve, 0], ends[ve, 1]) * 2097152 + np.maximum(ends[ve, 0], ends[ve, 1]), DK)
    # interior edges and their two triangles
    ek = np.minimum(u, w) * NV + np.maximum(u, w); o = np.argsort(ek, kind='stable'); eks = ek[o]
    same = np.nonzero(eks[1:] == eks[:-1])[0]; t0, t1 = tid[o[same]], tid[o[same + 1]]
    a_, b_ = np.minimum(u, w)[o[same]], np.maximum(u, w)[o[same]]
    ok = np.zeros(len(same), dtype=bool)
    cA = (a_ < NB) & (b_ >= NB); ok[cA] = isdiag[b_[cA]]                       # (base, edge point): the diagonal's half
    cB = (a_ >= NB) & (b_ >= NB) & (ends[a_, 0] >= 0) & (ends[b_, 0] >= 0)     # (edge point, edge point): a non-diagonal corner's pair
    E1, E2 = ends[a_[cB]], ends[b_[cB]]
    c00, c01, c10, c11 = E1[:, 0] == E2[:, 0], E1[:, 0] == E2[:, 1], E1[:, 1] == E2[:, 0], E1[:, 1] == E2[:, 1]
    one = (c00.astype(int) + c01 + c10 + c11) == 1
    x1 = np.where(c00 | c01, E1[:, 1], E1[:, 0]); x2 = np.where(c00 | c10, E2[:, 1], E2[:, 0])
    ok[np.nonzero(cB)[0]] = one & np.isin(np.minimum(x1, x2) * 2097152 + np.maximum(x1, x2), DK)
    if atlas is not None:
        at = np.asarray(atlas); ok &= at[t0] == at[t1]
    P = np.stack([t0[ok], t1[ok]], 1); seams = 0
    if uv is not None:   # (iteration 13) a pair across a UV seam stays two triangles
        U = np.asarray(uv, dtype=np.float64).reshape(nt, 3, 2)
        A, Bt = T[P[:, 0]], T[P[:, 1]]; same = A[:, :, None] == Bt[:, None, :]          # (k, 3, 3): corner i of t0 is corner j of t1
        d = np.abs(U[P[:, 0]][:, :, None, :] - U[P[:, 1]][:, None, :, :]).max(-1)        # (k, 3, 3) corner uv distance
        cut = (same & (d > 1e-6)).any((1, 2))
        seams = int(cut.sum()); P = P[~cut]
    use = np.bincount(P.ravel(), minlength=nt); clash = (use[P[:, 0]] > 1) | (use[P[:, 1]] > 1)
    P = P[~clash]
    return P, {'hm08Quads': nq, 'fan': nfan, 'NB': NB, 'tris': nt, 'pairs': int(len(P)), 'trisLeft': int(nt - 2 * len(P)), 'clashes': int(clash.sum()),
               'uvSeamPairsLeft': seams if uv is not None else None}


def fine7_join_quads(me, pairs):
    """dissolve each pair's shared edge (bmesh): the two triangles become one quad, their corners' uv and the material kept"""
    import bmesh
    bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table(); E = []; miss = 0
    for i, j in pairs:
        s = set(bm.faces[int(i)].edges) & set(bm.faces[int(j)].edges)
        if len(s) == 1: E.append(s.pop())
        else: miss += 1
    bmesh.ops.dissolve_edges(bm, edges=E, use_verts=False, use_face_split=False)
    bm.to_mesh(me); bm.free(); me.update()
    return {'joined': len(E), 'noSharedEdge': miss, 'polys': len(me.polygons)}
def fine7_variant(popts):
    """the Cycles variant switch (iteration 3: an A/B inside ONE farm job): the export's popts fine7.cyc, overridden by the environment's
    FINE7_CYC (JSON): {"off": 1} the v6 control at the same commit (no bake, material or subdivision), {"bump": 0}, {"disp": 0}, {"cav": 0},
    {"dicing": px}, {"zero": 1} (DETAIL7 iteration 6: the tier's whole machinery, the bake, the 'fine' material, the pre-
    compensated Catmull-Clark subdivision with adaptive dicing, with the relief's gain at 0: no displacement, no bump, no cavity. The 'off'
    twin has no subdivision at all, so on / off also compares CC + pre-compensation with the raw mesh; on / zero isolates the relief),
    {"body": 0} (DETAIL7 iteration 7: the torso's patches' relief cleared, the face's kept: on / body 0 isolates the navel and the areolae),
    {"quads": 0} (iteration 8: Catmull-Clark on the export's triangles as iterations 1-7),
    {"adaptive": 1} (integration, 8 Oct 22:20: Cycles' adaptive dicing at {"dicing": px}, the path every whole-skin loss came from; the
    DEFAULT is now the skin pre-diced by Blender at a render level set per camera, {"level": n} fixing it; {"predice": 1} = the default).
    {"lobe": 0} (DETAIL7 iteration 9: the microstructure's sub-texel slope variance NOT added to the lobes' roughness: on / lobe 0 isolates it).
    {"mix": 0} (DETAIL7 iteration 10: iteration 9's LEAN instead of the mixture: the whole sub-texel variance into the lobes' roughness and no
    hidden share taken out of their weight: on / mix 0 isolates the mixture; fine7_job.py 'lean').
    Empty: everything on (iteration 8: the quads, no pre-compensation)."""
    v = {}
    f7 = popts.get('fine7')
    if isinstance(f7, dict) and isinstance(f7.get('cyc'), dict):
        v.update(f7['cyc'])
    env = os.environ.get('FINE7_CYC')
    if env:
        try:
            v.update(json.loads(env))
        except Exception as e:
            print('fine7: FINE7_CYC unreadable', repr(e), flush=True)
    return {k: v[k] for k in FINE7_CYC_KEYS if k in v}


# (DETAIL7 c7 iteration 21) THE NAVEL AS GEOMETRY. Cycles displaces along the surface's own normal; the bake's navel relief replaced the mesh's own
# dent (12-14 mm deep, steep, overhanging) along the dent's nearly horizontal normals, the walls crossed and the sheet tore (i20 L14: a black hole
# with pale flaps). The bake (fine7_bake.mjs, body.js navelEmbedding / navelGeometryMap) now leaves the navel out of the maps and writes
# fine7/navel.f32: over the navel patch's uv square, the injective embedding phi (R, G: m on the patch's tangent plane) and the target height
# Q(phi) + h(phi) (B: m along its normal): the abdomen's envelope plus the solved navel. Here each point p of the patch goes to
# target = c' + t1' phi_x + t2' phi_y + n0' H by a VECTOR displacement w (target - p) in object space (w 1 inside the blend's first radius,
# 0 past its second: the mesh's own surface there). Moved along ONE normal over an injective map, the navel is a graph: one closed,
# outward-facing sheet (node check: labs/human8/fine7_navel_surface.mjs). The frame (c', t1', t2', n0') is the bake's bind frame carried to
# the posed body by the rigid fit of the patch's own vertices (bind -> posed, Kabsch; its residual is logged).
def fine7_navel_frame(nav, bind, co):
    """the bake's navel frame (bind) carried to the posed mesh: a weighted rigid fit of the patch's vertices -> (cp, t1, t2, n0, rms mm)"""
    V = np.asarray(nav['verts'], dtype=np.int64)
    c, t1, t2, n0 = (np.asarray(nav[k], dtype=np.float64) for k in ('c', 't1', 't2', 'n0'))
    Bv = bind[V].astype(np.float64) - c; Lv = np.c_[Bv @ t1, Bv @ t2, Bv @ n0]; Pv = co[V].astype(np.float64)
    r = np.hypot(Lv[:, 0], Lv[:, 1]) * 1000.0; wt = np.where(r < float(nav['wMm'][1]), 1.0, 0.3)
    Lc = (wt[:, None] * Lv).sum(0) / wt.sum(); Pc = (wt[:, None] * Pv).sum(0) / wt.sum()
    Hm = ((Lv - Lc) * wt[:, None]).T @ (Pv - Pc); U, S, Vt = np.linalg.svd(Hm)
    D = np.diag([1.0, 1.0, np.sign(np.linalg.det(Vt.T @ U.T))]); R = Vt.T @ D @ U.T; t = Pc - R @ Lc
    res = Pv - (Lv @ R.T + t); rms = float(np.sqrt((wt * (res ** 2).sum(1)).sum() / wt.sum())) * 1000.0
    return t, R[:, 0], R[:, 1], R[:, 2], rms


def fine7_navel_nodes(nt, L, uvn, nav, fk):
    """the navel's vector displacement (object space) -> its Displacement output socket (world), or raises"""
    N = nt.nodes
    def vm(op, a=None, b=None, dv=None):
        n_ = N.new('ShaderNodeVectorMath'); n_.operation = op
        if a is not None: L.new(a, n_.inputs[0])
        if b is not None: L.new(b, n_.inputs[1])
        elif dv is not None: n_.inputs[1].default_value = dv
        return n_
    u0, v0, su, sv = (float(x) for x in nav['box'])
    s1 = vm('SUBTRACT', uvn.outputs['UV'], dv=(u0, v0, 0.0)); s2 = vm('MULTIPLY', s1.outputs['Vector'], dv=(1.0 / su, 1.0 / sv, 1.0))
    tx = N.new('ShaderNodeTexImage'); tx.image = nav['image']; tx.interpolation = 'Linear'; tx.extension = 'EXTEND'
    L.new(s2.outputs['Vector'], tx.inputs['Vector'])
    sp = N.new('ShaderNodeSeparateColor'); L.new(tx.outputs['Color'], sp.inputs['Color'])
    tc = N.new('ShaderNodeTexCoord')
    d = vm('SUBTRACT', tc.outputs['Object'], dv=tuple(float(x) for x in nav['cp']))
    def scaled(vec, sock):
        n_ = N.new('ShaderNodeVectorMath'); n_.operation = 'SCALE'; n_.inputs[0].default_value = tuple(float(x) for x in vec); L.new(sock, n_.inputs['Scale']); return n_
    a1, a2, a3 = scaled(nav['t1p'], sp.outputs['Red']), scaled(nav['t2p'], sp.outputs['Green']), scaled(nav['n0p'], sp.outputs['Blue'])
    tg = vm('ADD', vm('ADD', a1.outputs['Vector'], a2.outputs['Vector']).outputs['Vector'], a3.outputs['Vector'])
    d0 = vm('SUBTRACT', tg.outputs['Vector'], d.outputs['Vector'])
    cx = N.new('ShaderNodeCombineXYZ'); L.new(sp.outputs['Red'], cx.inputs['X']); L.new(sp.outputs['Green'], cx.inputs['Y'])
    ln = vm('LENGTH', cx.outputs['Vector'])
    mr = N.new('ShaderNodeMapRange'); mr.data_type = 'FLOAT'; mr.interpolation_type = 'SMOOTHSTEP'; mr.clamp = True
    L.new(ln.outputs['Value'], mr.inputs[0]); mr.inputs[1].default_value = float(nav['wMm'][0]) / 1000.0; mr.inputs[2].default_value = float(nav['wMm'][1]) / 1000.0
    mr.inputs[3].default_value = 1.0; mr.inputs[4].default_value = 0.0
    wk = N.new('ShaderNodeMath'); wk.operation = 'MULTIPLY'; L.new(mr.outputs[0], wk.inputs[0]); wk.inputs[1].default_value = float(fk)
    dd = N.new('ShaderNodeVectorMath'); dd.operation = 'SCALE'; L.new(d0.outputs['Vector'], dd.inputs[0]); L.new(wk.outputs[0], dd.inputs['Scale'])
    vd = N.new('ShaderNodeVectorDisplacement'); vd.space = 'OBJECT'; vd.inputs['Midlevel'].default_value = 0.0; vd.inputs['Scale'].default_value = 1.0
    L.new(dd.outputs['Vector'], vd.inputs['Vector'])
    return vd.outputs['Displacement']


def fine7_material(name, maps_dir, a, person, register, sss, rev, im, use_disp, use_bump, use_cav, fk, hi, cvh, imv=None, use_lobe=True, use_hide=False, nav=None):
    """one atlas's skin with the fine tier's ONE packed map on the 'fine' uv (iteration 7: a copy per atlas, the head chart's faces on atlas 0,
    the torso's patches on atlas 1): R the displacement band (true displacement), G the bump band (a Bump node after the skin's normal map, into
    Normal and Coat Normal), B its cavity on the base colour; every gain x fk. -> (material, bump record, displacement method)"""
    m2 = skin_material(name, maps_dir, a, person, register, sss, rev=rev)
    nt = m2.node_tree; L = nt.links
    outn = next(x for x in nt.nodes if x.type == 'OUTPUT_MATERIAL')
    uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'fine'
    tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = im; tx.interpolation = 'Linear'; tx.extension = 'EXTEND'
    L.new(uvn.outputs['UV'], tx.inputs['Vector'])
    sp = nt.nodes.new('ShaderNodeSeparateColor'); L.new(tx.outputs['Color'], sp.inputs['Color'])
    if use_disp:
        dn = nt.nodes.new('ShaderNodeDisplacement'); dn.inputs['Midlevel'].default_value = 0.0; dn.inputs['Scale'].default_value = 1.0 * fk
        L.new(sp.outputs['Red'], dn.inputs['Height']); L.new(dn.outputs['Displacement'], outn.inputs['Displacement'])
        if nav is not None:   # (c7 iteration 21) the navel as geometry, added to the chart's scalar displacement
            try:
                ns = fine7_navel_nodes(nt, L, uvn, nav, fk)
                ad = nt.nodes.new('ShaderNodeVectorMath'); ad.operation = 'ADD'
                L.new(dn.outputs['Displacement'], ad.inputs[0]); L.new(ns, ad.inputs[1]); L.new(ad.outputs['Vector'], outn.inputs['Displacement'])
                nav['wired'] = nav.get('wired', []) + [name]
            except Exception as e:
                print('fine7: navel geometry NOT wired on', name, repr(e), flush=True); nav['error'] = repr(e)[:300]
    bump = None
    if use_bump or use_cav:
        try:
            pb = next(x for x in nt.nodes if x.type == 'BSDF_PRINCIPLED' and getattr(x, 'subsurface_method', '') == 'RANDOM_WALK_SKIN')
            if use_bump:
                nmap = next(x for x in nt.nodes if x.type == 'NORMAL_MAP')
                bn = nt.nodes.new('ShaderNodeBump'); bn.inputs['Strength'].default_value = 1.0; bn.inputs['Distance'].default_value = 1.0 * fk
                L.new(sp.outputs['Green'], bn.inputs['Height']); L.new(nmap.outputs['Normal'], bn.inputs['Normal'])
                L.new(bn.outputs['Normal'], pb.inputs['Normal']); L.new(bn.outputs['Normal'], pb.inputs['Coat Normal'])
            src = pb.inputs['Base Color'].links[0].from_socket if pb.inputs['Base Color'].links else None
            if use_cav and src is not None:   # the pits' occlusion on the base colour: x (0.5 + 0.5 cav)
                ma = nt.nodes.new('ShaderNodeMath'); ma.operation = 'MULTIPLY_ADD'; ma.inputs[1].default_value = 0.5 * fk; ma.inputs[2].default_value = 1.0 - 0.5 * fk
                L.new(sp.outputs['Blue'], ma.inputs[0])
                vm = nt.nodes.new('ShaderNodeVectorMath'); vm.operation = 'MULTIPLY'
                L.new(src, vm.inputs[0]); L.new(ma.outputs[0], vm.inputs[1]); L.new(vm.outputs['Vector'], pb.inputs['Base Color'])
            bump = {'hiRangeUm': [round(float(hi.min()) * 1e6, 1), round(float(hi.max()) * 1e6, 1)], 'cavHiMin': round(float(cvh.min()), 3), 'cavHiMean': round(float(cvh.mean()), 4),
                    'bump': bool(use_bump), 'baseCav': bool(use_cav and src is not None)}
        except Exception as e:
            print('fine7: bump band', name, repr(e), flush=True); bump = {'error': repr(e)[:200]}
    # (iteration 9) the microstructure's sub-texel slope variance (the bake band-limits the pores and the furrow network to the texel and keeps
    # what it filtered as a variance v per texel, imv's red, (m/m)^2): both lobes widen by it, LEAN / Toksvig, alpha^2 -> alpha^2 + v with
    # Blender's alpha = roughness^2, so r -> (r^4 + fk^2 v)^(1/4) on the base lobe (the skin's roughness map) and the coat (the oil film's).
    # The relief the texel resolves stays in the bump band and the path tracer integrates it over the pixel: the highlight breaks over the
    # resolved pits and furrows and broadens with the sub-texel ones, as on skin, instead of sparkling on aliased normals
    lobe = None
    if imv is not None and use_lobe:
        try:
            pb = next(x for x in nt.nodes if x.type == 'BSDF_PRINCIPLED' and getattr(x, 'subsurface_method', '') == 'RANDOM_WALK_SKIN')
            tv = nt.nodes.new('ShaderNodeTexImage'); tv.image = imv; tv.interpolation = 'Linear'; tv.extension = 'EXTEND'
            L.new(uvn.outputs['UV'], tv.inputs['Vector'])
            spv = nt.nodes.new('ShaderNodeSeparateColor'); L.new(tv.outputs['Color'], spv.inputs['Color'])
            vk = nt.nodes.new('ShaderNodeMath'); vk.operation = 'MULTIPLY'; vk.inputs[1].default_value = fk * fk
            L.new(spv.outputs['Red'], vk.inputs[0])
            wired = []
            for sock in ('Roughness', 'Coat Roughness'):
                inp = pb.inputs[sock]; src = inp.links[0].from_socket if inp.links else None
                p4 = nt.nodes.new('ShaderNodeMath'); p4.operation = 'POWER'; p4.inputs[1].default_value = 4.0
                if src is not None: L.new(src, p4.inputs[0])
                else: p4.inputs[0].default_value = float(inp.default_value)
                ad = nt.nodes.new('ShaderNodeMath'); ad.operation = 'ADD'; L.new(p4.outputs[0], ad.inputs[0]); L.new(vk.outputs[0], ad.inputs[1])
                rt = nt.nodes.new('ShaderNodeMath'); rt.operation = 'POWER'; rt.inputs[1].default_value = 0.25; rt.use_clamp = True
                L.new(ad.outputs[0], rt.inputs[0]); L.new(rt.outputs[0], inp); wired.append(sock + ('<map' if src is not None else '<%.3f' % float(inp.default_value)))
            lobe = {'wired': wired, 'gain': round(fk * fk, 4)}
            # (iteration 10) WHAT THE LOBES SEE (micro.js HIDE): the texel's slopes are a mixture, the plateau's (its variance above, imv's red =
            # varo: only the features the lobes still see) and the steep insides of the pores and the furrows, hidden from a 45-degree key and
            # view or sending their light far outside the highlight: their share of the footprint (imv's green = hide) is taken OUT of both
            # lobes' weight (x (1 - fk hide)) instead of widening them: the highlight stays sharp on the plateau and breaks over the pits
            if use_hide:
                hk = nt.nodes.new('ShaderNodeMath'); hk.operation = 'MULTIPLY_ADD'; hk.inputs[1].default_value = -fk; hk.inputs[2].default_value = 1.0; hk.use_clamp = True
                L.new(spv.outputs['Green'], hk.inputs[0]); hid = []
                for sock in ('Specular IOR Level', 'Coat Weight'):
                    inp = pb.inputs[sock]; src = inp.links[0].from_socket if inp.links else None
                    mw = nt.nodes.new('ShaderNodeMath'); mw.operation = 'MULTIPLY'
                    if src is not None: L.new(src, mw.inputs[0])
                    else: mw.inputs[0].default_value = float(inp.default_value)
                    L.new(hk.outputs[0], mw.inputs[1]); L.new(mw.outputs[0], inp); hid.append(sock + ('<map' if src is not None else '<%.3f' % float(inp.default_value)))
                lobe['hide'] = hid
        except Exception as e:
            print('fine7: lobe', name, repr(e), flush=True); lobe = {'error': repr(e)[:200]}
    if bump is not None and lobe is not None:
        bump = dict(bump, lobe=lobe)
    elif lobe is not None:
        bump = {'lobe': lobe}
    meth = None
    for tgt in (m2, getattr(m2, 'cycles', None)):
        if tgt is not None and hasattr(tgt, 'displacement_method'):
            try:
                tgt.displacement_method = 'DISPLACEMENT' if (bump and 'error' not in bump and use_bump) else 'BOTH'; meth = tgt.displacement_method; break
            except Exception as e:
                print('fine7: displacement_method', e)
    return m2, bump, meth


def fine7_apply(export_dir, M, me, body, tri, atlas, maps_dir, register, sss, nverts):
    popts = ((M.get('spec') or {}).get('popts') or {})
    # absent / null / false = no tier; any object, the empty {} included (the defaults), = the tier on
    if popts.get('fine7') is None or popts.get('fine7') is False:
        return None
    var = fine7_variant(popts)
    if var.get('off'):
        print('person_scene fine7:', json.dumps({'variant': var, 'off': 'the v6 control at this commit: no bake, no material, no subdivision'}), flush=True)
        return None
    import subprocess, time as _t
    d = os.path.join(export_dir, 'fine7'); js = os.path.join(d, 'fine7.json')
    if not os.path.exists(js):
        videos = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); t0 = _t.time()
        r = subprocess.run(['node', 'web/labs/human8/fine7_bake.mjs', os.path.abspath(export_dir)], cwd=videos, capture_output=True, text=True)
        print(r.stdout[-2000:], flush=True)
        if r.returncode or not os.path.exists(js):
            raise RuntimeError('fine7: the bake failed (%d): %s' % (r.returncode, (r.stderr or '')[-1500:]))
        print('person_scene fine7: bake %.1f s' % (_t.time() - t0), flush=True)
    F = json.load(open(js)); W, H, n = F['W'], F['H'], F['n']
    if n != nverts:
        raise RuntimeError('fine7: the bake has %d vertices, the body %d' % (n, nverts))
    UVO = np.fromfile(os.path.join(d, 'uv.f32'), dtype=np.float32).reshape(-1, 3)
    # iteration 2: the bake splits the relief into a DISPLACEMENT band (the valleys, rolls and columns, above ~1 mm wavelength: true geometry,
    # adaptive dicing) and a BUMP band (pores, the network, the lip pleats, the creases' cores) that a Bump node adds AFTER the skin's normal
    # map (a material's method BOTH loses its bump part: the Normal Map node feeding the Principled's Normal builds on the mesh's interpolated
    # normal). The bump band's cavity darkens the base colour a little (the pits' occlusion the bump cannot cast). An iteration-1 bake
    # (height.f32 only) builds with the displacement alone (method BOTH).
    split = bool(F.get('split')) and os.path.exists(os.path.join(d, 'height_lo.f32'))
    rd = lambda nm: np.fromfile(os.path.join(d, nm), dtype=np.float32)
    hgt = rd('height_lo.f32' if split else 'height.f32')
    hi = rd('height_hi.f32') if split else np.zeros(W * H, dtype=np.float32)
    cvh = rd('cav_hi.f32') if split else np.ones(W * H, dtype=np.float32)
    if not (hgt.size == hi.size == cvh.size == W * H):
        raise RuntimeError('fine7: the maps are %d / %d / %d texels, the bake says %d x %d' % (hgt.size, hi.size, cvh.size, W, H))
    # (iteration 9) the microstructure's sub-texel slope variance (var.f32; a bake without it: no widening, as before)
    vv = rd('var.f32') if (F.get('var') and os.path.exists(os.path.join(d, 'var.f32'))) else None
    if vv is not None and vv.size != W * H:
        print('fine7: var.f32 has %d texels, the bake %d x %d: not used' % (vv.size, W, H), flush=True); vv = None
    # (iteration 10) the mixture (default): the lobes widen by the variance of the features they still see (varo.f32) and lose the hidden
    # share of the footprint (hide.f32); FINE7_CYC {"mix": 0} = iteration 9's LEAN (var.f32 whole, nothing hidden)
    vh = None
    if vv is not None and F.get('mix') and all(os.path.exists(os.path.join(d, x)) for x in ('varo.f32', 'hide.f32')):
        vo_, vh = rd('varo.f32'), rd('hide.f32')
        if vo_.size == W * H and vh.size == W * H: vv = vo_
        else: print('fine7: varo / hide have %d / %d texels: the mixture not used' % (vo_.size, vh.size), flush=True); vh = None
    # (iteration 7) the torso's patches sit in a band over the head chart (v > headV): the 'body' 0 variant clears it there
    headV = float(F.get('headV', 1.0)); bodyRows = 0
    if var.get('body', 1) == 0 and headV < 1.0:
        j0 = int(np.floor(headV * H)); bodyRows = H - j0
        hgt = hgt.copy(); hi = hi.copy(); cvh = cvh.copy(); hgt[j0 * W:] = 0.0; hi[j0 * W:] = 0.0; cvh[j0 * W:] = 1.0
        if vv is not None: vv = vv.copy(); vv[j0 * W:] = 0.0
        if vh is not None: vh = vh.copy(); vh[j0 * W:] = 0.0
    on = UVO[:, 2] > 0.5
    add_corner_uv(me, 'fine', UVO[:, :2][np.asarray(tri)].reshape(-1, 2))
    # the chart's faces: the head chart's on the head atlas (0) as before, and (iteration 7) the torso's patches (their uv in the band over
    # headV) on the body atlas (1); each atlas its own 'fine' copy. (The head chart's few faces on atlas 1 under the chin stay as before.)
    # (iteration 8) the base surface: the export's triangles paired back into hm08's quads (fine7_quads above) before anything is assigned per
    # face; a failure leaves the triangles (iterations 1-7's surface) and says why
    quads = None
    if True:   # (DETAIL7 c4 iteration 12: ruled; the triangles' surface, {"quads": 0}, is deleted: git history only)
        try:
            # (iteration 13) the atlas uv: a pair across a UV seam stays two triangles. (c5 iteration 15: RULED by the i13 L05 render
            # 1015-065044: the dashes on jaw, neck and ear are gone; iterations 8-12's pairing and its {"seam": 0} switch deleted: git history only)
            auv = None
            lu = me.uv_layers.get('atlas')
            if lu is not None and len(me.loops) == len(tri) * 3:
                auv = np.empty(len(me.loops) * 2, dtype=np.float32); lu.data.foreach_get('uv', auv); auv = auv.reshape(-1, 3, 2)
            t0q = _t.time(); pairs, quads = fine7_quads(tri, atlas, auv); quads.update(fine7_join_quads(me, pairs)); quads['s'] = round(_t.time() - t0q, 1)
        except Exception as e:
            quads = {'error': repr(e)[:300]}; print('fine7: quads', quads['error'], flush=True)
    # per polygon (a quad or a triangle): its corners' vertices; the atlas is the material index build() set (0 / 1)
    npl = len(me.polygons); ls = np.empty(npl, dtype=np.int32); me.polygons.foreach_get('loop_start', ls)
    li = np.empty(len(me.loops), dtype=np.int32); me.loops.foreach_get('vertex_index', li)
    atlas = np.empty(npl, dtype=np.int32); me.polygons.foreach_get('material_index', atlas)
    allAt = lambda flags: np.minimum.reduceat(flags[li].astype(np.int8), ls) > 0
    chart = allAt(on)
    inBand = allAt(UVO[:, 1] > headV) if headV < 1.0 else np.zeros(npl, dtype=bool)
    chart = chart & ((atlas == 0) | inBand)
    # ONE image: R the displacement band (m), G the bump band (m), B the bump band's cavity (0.45..1). is_data at creation (Non-Color) and its
    # colour space NEVER set afterwards (that re-made iterations 1-2's maps blank); packed, so nothing later can lose it
    im = bpy.data.images.new('fine7_maps', W, H, alpha=True, float_buffer=True, is_data=True)
    px = np.empty((W * H, 4), dtype=np.float32); px[:, 0] = hgt; px[:, 1] = hi; px[:, 2] = cvh; px[:, 3] = 1.0
    im.pixels.foreach_set(px.ravel()); im.update(); del px
    packed = None
    try:
        t1 = _t.time(); im.pack(); packed = round(_t.time() - t1, 1)
    except Exception as e:
        print('fine7: pack', repr(e), flush=True)
    # (iteration 9) the variance in its own float image (red), packed like the maps; a second image so the maps' alpha stays 1 (no
    # straight / premultiplied alpha question on the relief's channels)
    imv = None; vrec = None
    if vv is not None and var.get('lobe', 1) != 0:
        imv = bpy.data.images.new('fine7_var', W, H, alpha=True, float_buffer=True, is_data=True)
        px = np.zeros((W * H, 4), dtype=np.float32); px[:, 0] = vv; px[:, 3] = 1.0
        if vh is not None: px[:, 1] = vh   # (iteration 10) green: the hidden share
        imv.pixels.foreach_set(px.ravel()); imv.update(); del px
        try: imv.pack()
        except Exception as e: print('fine7: pack var', repr(e), flush=True)
        vp = vv[vv > 0]
        vrec = {'texels': int(vp.size), 'p50': round(float(np.percentile(vp, 50)), 5) if vp.size else 0, 'p90': round(float(np.percentile(vp, 90)), 5) if vp.size else 0,
                'p99': round(float(np.percentile(vp, 99)), 5) if vp.size else 0, 'max': round(float(vv.max()), 4), 'mix': vh is not None}
        if vh is not None:
            hp = vh[vh > 0]
            vrec['hide'] = {'texels': int(hp.size), 'p50': round(float(np.percentile(hp, 50)), 4) if hp.size else 0, 'p90': round(float(np.percentile(hp, 90)), 4) if hp.size else 0,
                            'mean': round(float(hp.mean()), 4) if hp.size else 0, 'max': round(float(vh.max()), 4)}
    person = (M.get('skin') or {}).get('person'); rev = (M.get('skin') or {}).get('rev', 0) or 0
    use_disp, use_bump, use_cav = var.get('disp', 1) != 0, split and var.get('bump', 1) != 0, split and var.get('cav', 1) != 0
    # (c7 iteration 21) the navel as geometry: the bake's navel.f32 (the embedding and the target height over the patch's uv square) and its
    # frame carried to the posed body; the materials of the atlases that hold the patch's faces get the vector displacement
    nav = None; navRec = None; navAt = set()
    NG = F.get('navel')
    if NG and var.get('body', 1) != 0 and os.path.exists(os.path.join(d, 'navel.f32')):
        try:
            px_ = int(NG['px']); a_nav = np.fromfile(os.path.join(d, 'navel.f32'), dtype=np.float32)
            if a_nav.size != px_ * px_ * 4: raise RuntimeError('navel.f32 has %d floats, the bake says %d^2 x 4' % (a_nav.size, px_))
            co = np.empty(len(me.vertices) * 3, dtype=np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
            ba = me.attributes.get('bind')
            if ba is not None and len(ba.data) == len(me.vertices):
                bind = np.empty(len(me.vertices) * 3, dtype=np.float32); ba.data.foreach_get('vector', bind); bind = bind.reshape(-1, 3)
            else:   # the mesh lost its point attribute somewhere: the export's own bind (the same vertices)
                _pp = Person(export_dir); bind = _pp.arr(_pp.body['bind'], 3).astype(np.float32)
            cp, t1p, t2p, n0p, rms = fine7_navel_frame(NG, bind, co)
            imN = bpy.data.images.new('fine7_navel', px_, px_, alpha=True, float_buffer=True, is_data=True)
            imN.pixels.foreach_set(a_nav); imN.update()
            try: imN.pack()
            except Exception as e: print('fine7: pack navel', repr(e), flush=True)
            nav = {'image': imN, 'box': NG['box'], 'wMm': NG['wMm'], 'cp': cp, 't1p': t1p, 't2p': t2p, 'n0p': n0p}
            vs = set(int(v) for v in NG['verts']); inPatch = np.zeros(len(me.vertices), dtype=bool); inPatch[list(vs)] = True
            navFaces = allAt(inPatch) & chart; navAt = set(int(x) for x in np.asarray(atlas)[navFaces])
            navRec = {'px': px_, 'faces': int(navFaces.sum()), 'atlases': sorted(navAt), 'fitRmsMm': round(rms, 3), 'cp': [round(float(x), 4) for x in cp],
                      'n0p': [round(float(x), 3) for x in n0p], 'wMm': NG['wMm'], 'embedding': NG.get('report')}
        except Exception as e:
            print('fine7: navel geometry not built', repr(e), flush=True); navRec = {'error': repr(e)[:300]}; nav = None
    # (integration v7, 8 Oct) the tier's gain: popts fine7.form (v7 sets it by age: 0.45 under 25 to 1 at 45; absent = 1, as before), on the
    # displacement, the bump band and the cavity's darkening alike (the engine's F.set({ form, cavity }) twin)
    _f7 = popts.get('fine7') if isinstance(popts.get('fine7'), dict) else {}
    fk = float(_f7.get('form', 1.0)) if _f7.get('form') is not None else 1.0
    if var.get('zero'):   # DETAIL7 iteration 6: the 'norelief' twin (see fine7_variant)
        fk = 0.0
    atl = np.asarray(atlas); mats = {}; bump = None; meth = None
    for a_ in sorted(set(int(x) for x in atl[chart])):
        m2, bump_a, meth_a = fine7_material(f'skin_a{a_}_fine7', maps_dir, a_, person, register, sss, rev, im, use_disp, use_bump, use_cav, fk, hi, cvh, imv=imv, use_lobe=var.get('lobe', 1) != 0, use_hide=vh is not None,
                                            nav=nav if (nav is not None and a_ in navAt) else None)
        mats[a_] = m2; meth = meth or meth_a
        if bump is None or a_ == 0:
            bump = bump_a
    mi = np.zeros(len(me.polygons), dtype=np.int32); me.polygons.foreach_get('material_index', mi)
    for a_, m2 in mats.items():
        me.materials.append(m2); idx = len(me.materials) - 1; mi[chart & (atl == a_)] = idx
    me.polygons.foreach_set('material_index', mi); me.update()
    chartByAtlas = {str(a_): int((chart & (atl == a_)).sum()) for a_ in mats}
    # iteration 3: the control mesh pre-compensated so the subdivided surface passes through the export's vertices (before the modifier below)
    # (iteration 8 turned it off; DETAIL7 c4 iteration 12 turns it back ON, on hm08's QUADS: the i10 renders (1008-234751 L05, 1008-234835
    # L22) show short straight dark strands on the cheeks, the nasojugal line and the jaw in every twin subdivided WITHOUT it ('on', 'nolobe',
    # 'norelief': relief 0) and none in the inverted 'tri' twin: Catmull-Clark sinks the surface under the export's vertices, and the facial
    # and body hair rooted just under the export surface (HAIR7's vellus / stubble, placed on makePerson's mesh, as the eyes and lashes are)
    # comes out through it: the merged person's 'dark speckles on every face' and L22's 'scratch dashes' on thighs, forearms and neck. On quads
    # the inverse limit map is well-conditioned (the corduroy i8 removed came from Catmull-Clark on TRIANGLES); {"precomp": 0} = i8-i11's
    # surface (the 'noprecomp' twin, the A/B of this change only).
    # (DETAIL7 c5 iteration 15) OFF AGAIN, by the i13 L05 render (1015-065044, face studio@5, on | noprecomp at one commit): the inversion is
    # an interpolating fit, so it SHARPENS: every fold the coarse tier carries at 2-3 mm vertex spacing comes back above its own amplitude
    # (the limit surface overshoots between the vertices), and the cheek and nasolabial folds read as deep gouged lumps; 'noprecomp' was soft
    # and age-plausible. Its premise (i12: hair coming out through a sunk surface) is refuted by the same render: 'noprecomp' carries no dark
    # specks or dashes either; they were the seam-straddling quads (i13). So the subdivided surface is Catmull-Clark's smoothing of the
    # export and never carries more relief than the export; every form under ~5 mm is this tier's relief (iteration 8's rule).
    # (DETAIL7 c5 iteration 17) RULED: the inversion and its 'precomp' switch are DELETED (git history holds them); no control-mesh fit.
    # subdivision: Catmull-Clark (smooth: the flat facets of a simple split would show in the displaced shading), uv linear
    mod = body.modifiers.new('fine7_subd', 'SUBSURF'); mod.subdivision_type = 'CATMULL_CLARK'; mod.levels = 0; mod.render_levels = 2
    try: mod.uv_smooth = 'NONE'
    except Exception as e: print('fine7: uv_smooth', e)
    sc = bpy.context.scene; adaptive = []; dice = float(var.get('dicing', FINE7_DICING))
    # Blender 5.2 (iteration 1's log): adaptive subdivision is the modifier's own (use_adaptive_subdivision, adaptive_space,
    # adaptive_pixel_size, adaptive_object_edge_length); no Experimental feature set, no scene dicing_rate
    # (integration, 8 Oct 22:20: THE VANISHING SKIN, removed at its mechanism) the skin is PRE-DICED BY DEFAULT: Blender evaluates this
    # Catmull-Clark at a render level chosen for the shot's camera (render_person -> person_guard.dice_for_camera: the head's 2.5 mm base edge
    # projected to pixels, level ceil(log2(px / dicing)) clamped 2..3: the face shot ~8 px -> 3, bust ~4.4 px -> 3, full ~1.8 px -> 2) and Cycles displaces those vertices; NO
    # adaptive dicing at render time. Every whole-skin loss on the farm (5 of 38 adaptive renders by 20:30, then L08's face in 4 of 11; 0 of
    # 132 renders without adaptive dicing) happened in Cycles' full-size adaptive tessellation, while the quarter-size meter in the same
    # process drew the skin: the path that loses it is no longer the default for anyone. {"adaptive": 1} = the adaptive path (the A/B and
    # the diagnostic's 'adaptive' variant); {"predice": 1} is accepted and means the default; {"level": n} fixes the render level.
    adaptive_on = bool(var.get('adaptive')) and not var.get('predice')
    for tgt, nm in (((getattr(body, 'cycles', None), 'use_adaptive_subdivision'), (mod, 'use_adaptive_subdivision'), (mod, 'adaptive_subdivision')) if adaptive_on else ()):
        if tgt is not None and hasattr(tgt, nm):
            try: setattr(tgt, nm, True); adaptive.append(type(tgt).__name__ + '.' + nm)
            except Exception as e: print('fine7: adaptive', nm, e)
    for tgt, nm, v in (((mod, 'adaptive_space', 'PIXEL'), (mod, 'adaptive_pixel_size', dice), (sc.cycles, 'dicing_rate', dice), (sc.cycles, 'offscreen_dicing_scale', 8.0), (mod, 'dicing_rate', dice)) if adaptive_on else ()):
        if tgt is not None and hasattr(tgt, nm):
            try: setattr(tgt, nm, v); adaptive.append(nm + '=' + str(v))
            except Exception as e: print('fine7: dicing', nm, e)
    if not adaptive_on and var.get('level') is not None:
        mod.render_levels = int(var['level'])
    # the READ-BACK (iteration 3): what the image holds now, after everything above, is what Cycles will sample
    rb = np.empty(W * H * 4, dtype=np.float32); im.pixels.foreach_get(rb); rb = rb.reshape(-1, 4)
    chk = {'source': im.source, 'packed': packed, 'size': list(im.size), 'float': bool(im.is_float),
           'rRangeUm': [round(float(rb[:, 0].min()) * 1e6, 1), round(float(rb[:, 0].max()) * 1e6, 1)], 'gRangeUm': [round(float(rb[:, 1].min()) * 1e6, 1), round(float(rb[:, 1].max()) * 1e6, 1)],
           'bMean': round(float(rb[:, 2].mean()), 4), 'maxErrUm': [round(float(np.abs(rb[:, 0] - hgt).max()) * 1e6, 3), round(float(np.abs(rb[:, 1] - hi).max()) * 1e6, 3)],
           'cavErr': round(float(np.abs(rb[:, 2] - cvh).max()), 5)}
    del rb
    lost = (float(np.abs(hgt).max()) > 0 and max(abs(chk['rRangeUm'][0]), abs(chk['rRangeUm'][1])) < 0.5 * float(np.abs(hgt).max()) * 1e6) or chk['bMean'] < 0.5 * float(cvh.mean())
    rec = {'W': W, 'H': H, 'chartFaces': int(chart.sum()), 'chartByAtlas': chartByAtlas, 'headV': headV, 'bodyRowsCleared': bodyRows, 'faces': len(me.polygons), 'method': meth, 'adaptive': adaptive, 'split': split, 'bump': bump,
           'variant': var, 'disp': bool(use_disp), 'gain': fk, 'imageCheck': chk, 'quads': quads, 'subTexelVar': vrec,
           'navelGeometry': (dict(navRec, wired=(nav or {}).get('wired', []), error=(nav or {}).get('error')) if navRec is not None else ('none: the bake has no navel.f32' if F.get('body') else None)),
           'subdiv': 'CATMULL_CLARK ' + ('render 2 (adaptive: Cycles dices)' if adaptive_on else 'pre-diced by Blender (render level %d here; render_person sets it per camera)' % mod.render_levels),
           'diced': 'cycles' if adaptive_on else 'blender', 'hRangeMm': [round(float(hgt.min()) * 1000, 3), round(float(hgt.max()) * 1000, 3)],
           'modAttrs': [a for a in dir(mod) if 'adapt' in a or 'dicing' in a], 'report': {k: F['report'].get(k) for k in ('texelMm', 'coverage', 'bindCheckMm', 'ms', 'tissue', 'version', 'body')}}
    print('person_scene fine7:', json.dumps(rec), flush=True)
    if lost:
        raise RuntimeError('fine7: the maps image does not hold the bake (imageCheck %s): refusing to render a blank relief' % json.dumps(chk))
    return rec


# ---------------------------------------------------------------- the person
def build(export_dir, maps_dir, light='over', register=None, hair_density=1.0, sss=1.0, seed=1):
    pp = Person(export_dir)
    M = pp.m
    register = register or ('bare' if M['spec']['wear'] in ('bare', 'nude') else 'dressed')   # (integrator c6) 'nude': the figure study without the bra (export.js)
    # (integration v4, SKIN4's hand-off) sss None = the export's own default (manifest skin.sss: 0.6 for skin rev 4), else 1.0 as before
    if sss is None: sss = (M.get('skin') or {}).get('sss') or 1.0
    coll = bpy.data.collections.new('person'); bpy.context.scene.collection.children.link(coll)
    # ---- body
    B = pp.body
    P, N, tri = pp.arr(B['position'], 3), pp.arr(B['normal'], 3), pp.arr(B['index'], 3)
    uv = np.fromfile(os.path.join(maps_dir, '..', 'uv.bin'), dtype=np.float32).reshape(-1, 2)
    atlas = np.fromfile(os.path.join(maps_dir, '..', 'atlas.bin'), dtype=np.uint8)
    if len(uv) != len(tri) * 3:
        raise RuntimeError(f'uv.bin has {len(uv)} corners, the body {len(tri) * 3}')
    dropped = 0
    # CLOTH8 (8 Oct, opt-in): SHRINK, DON'T DROP (blender/cover8.py): with the export's popts "cover8" (or COVER8 in the environment) the
    # covered faces are KEPT and every covered vertex pushed in along its normal (d, feathered from the mask's edge), and the skin keeps its
    # covered texels opaque, so a gap in a garment shows the body in shadow, not the empty shell (the black voids). Off: exactly as before.
    c8 = C8.options((M.get('spec') or {}).get('popts') or {}) if register != 'bare' else None
    _COVER8['on'] = c8 is not None; c8rec = None
    if register != 'bare' and all(os.path.exists(os.path.join(maps_dir, f'skin_cover_a{a}.png')) for a in (0, 1)):
        # dressed: the skin hero.js discards under the clothes (its hCover) is left out, as in the engine (a face goes when all three
        # corners and its centre are covered)
        cov = np.zeros(len(tri), dtype=bool); U3 = uv.reshape(-1, 3, 2)
        ccv = np.zeros((len(tri), 3), dtype=bool) if c8 is not None else None
        for a in (0, 1):
            k = np.nonzero(atlas == a)[0]
            pts = np.concatenate([U3[k].reshape(-1, 2), U3[k].mean(1)])
            v = _sample_mask(os.path.join(maps_dir, f'skin_cover_a{a}.png'), pts) > 0.5
            cov[k] = v[:len(k) * 3].reshape(-1, 3).all(1) & v[len(k) * 3:]
            if ccv is not None:
                ccv[k] = v[:len(k) * 3].reshape(-1, 3)
        if c8 is None:
            keep = ~cov; dropped = int(cov.sum())
            tri = tri[keep]; uv = U3[keep].reshape(-1, 2); atlas = atlas[keep]
        else:
            P, c8rec = C8.shrink(P, N, tri, ccv, c8); c8rec['facesKept'] = int(cov.sum())
            print('person_scene cover8:', json.dumps(c8rec), flush=True)
    elif c8 is not None:
        print('person_scene cover8: no skin_cover masks: nothing to push (dressed export without the bake)', flush=True)
    me = build_mesh('body', P, tri, N)
    add_corner_uv(me, 'atlas', uv)
    add_point_attr(me, 'bind', pp.arr(B['bind'], 3))
    for a in (0, 1):
        me.materials.append(skin_material(f'skin_a{a}', maps_dir, a, (M.get('skin') or {}).get('person'), register, sss, rev=(M.get('skin') or {}).get('rev', 0) or 0))
    me.polygons.foreach_set('material_index', atlas.astype(np.int32))
    body = object_for(me, collection=coll)
    out = {'body': body, 'garments': [], 'eyes': [], 'hair': [], 'coveredFaces': dropped}
    if c8rec is not None:
        out['cover8'] = c8rec
    # (DETAIL7, round 7, opt-in) the fine tier: TRUE displacement of the head's chart (only when the export's makePerson options carry "fine7")
    fine = fine7_apply(export_dir, M, me, body, tri, atlas, maps_dir, register, sss, len(P))
    if fine:
        out['fine7'] = fine
    # ---- garments (the engine's fabric surface baked into one atlas when the export has it)
    cmaps = os.path.join(export_dir, 'maps'); gidx, guv = {}, None
    f6 = fabric6_record(export_dir)   # FABRIC6: None unless the export carries fabric6.json
    if os.path.exists(os.path.join(cmaps, 'cloth_albedo.png')) and os.path.exists(os.path.join(export_dir, 'garment_uv.json')):
        gidx = {e['name']: e for e in json.load(open(os.path.join(export_dir, 'garment_uv.json')))}
        guv = np.fromfile(os.path.join(export_dir, 'garment_uv.bin'), dtype=np.float32).reshape(-1, 2)
    for rec in M['meshes'][1:]:
        if rec['kind'] != 'garment':
            continue
        gm = build_mesh(rec['name'], pp.arr(rec['position'], 3), pp.arr(rec['index'], 3), pp.arr(rec['normal'], 3))
        if 'uv' in rec:
            u = pp.arr(rec['uv'], 2); add_point_attr(gm, 'cloth_uv', np.c_[u, np.zeros(len(u))])
        e = gidx.get(rec['name'])
        if e is not None and len(gm.polygons) * 3 == e['corners']:
            add_corner_uv(gm, 'atlas', guv[e['corner']:e['corner'] + e['corners']])
            if f6 is not None and 'uv' in rec:   # FABRIC6 (opt-in: the export carries fabric6.json): the pattern uv as a UV map, rev 6's material
                add_corner_uv(gm, 'cloth', pp.arr(rec['uv'], 2)[pp.arr(rec['index'], 3).ravel()])
                gm.materials.append(fabric_material_baked6('fab_' + rec['name'], rec.get('fabric'), cmaps, rec.get('materialColor') or rec.get('dye'), f6))
            else:
                gm.materials.append(fabric_material_baked('fab_' + rec['name'], rec.get('fabric'), cmaps))
        else:
            gm.materials.append(fabric_material('fab_' + rec['name'], rec.get('fabric'), rec.get('materialColor') or rec.get('dye')))
        out['garments'].append(object_for(gm, collection=coll))
    # ---- eyes
    if M.get('eyes'):
        out['eyes'] = build_eyes(M['eyes'], coll)
    # ---- hair
    for hr in (M['hair'] if hair_density > 0 else []):
        ob = person_hair.build_part(pp, hr, coll, density=hair_density, seed=seed)
        if ob:
            out['hair'].append(ob)
    # ---- light
    L = M['lights'][light]
    sc = bpy.context.scene
    if light == 'over':
        sc.world = world_over(1.0, rotation_deg=0.0)
    else:
        lc = L['cycles']
        sc.world = world_sun(L['elevation'], L['azimuth'], lc.get('turbidity', 2.5), sky_strength=1.0)
        add_sun(L['elevation'], L['azimuth'], lc.get('angle', 0.53), strength=4.0 * lc.get('sunGain', 1.0), coll=coll)
    out['ground'] = ground(coll)
    out['register'] = register
    return pp, out
