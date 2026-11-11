#!/usr/bin/env python3
"""Bake the HERO bodies for lib/fx/hero.js from the CC0 MakeHuman base mesh, rig and targets.

    python3 videos/scripts/bake_hero.py        # -> videos/web/assets/hero/hero.json + hero.bin

Reads videos/sources/makehuman/ (see its README). Writes one binary with every array the runtime needs:
  - the vertex positions of each body VARIANT (a mix of macro targets + face targets = a specific man), metres,
    feet on y = 0, facing +Z, left = +X;
  - skin indices / weights (4 per vertex, from the default rig's weights), a per-vertex region code (what the
    vertex belongs to: head, neck, torso, upper arm, forearm, hand, finger, pelvis, thigh, shin, foot...) and
    the position along the limb (0 at the proximal joint, 1 at the distal) for sleeve / trouser hems;
  - triangle lists per group (body skin, tights helper, teeth, tongue) and the fitted high-poly eyes;
  - expression morph deltas (mouth open, brows down, eye slit, nose flare, lip retraction) shared by all variants;
  - the rig: 163 bones (name, parent, head, tail per variant). Bind rotations are identity: a pose is a local
    rotation per bone in the parent's (world-aligned) bind frame, which is what the BVH retarget writes.
"""
import json, os, re, struct, math
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MH = os.path.join(HERE, '..', 'sources', 'makehuman')
OUT = os.path.join(HERE, '..', 'web', 'assets', 'hero')
T = lambda p: os.path.join(MH, 'targets', p)

# body variants: (name, [(target, weight)], note)
MACRO = 'macrodetails/'
VARIANTS = [
    ('forge', [(MACRO + 'caucasian-male-young.target', 0.7), (MACRO + 'african-male-young.target', 0.15), (MACRO + 'asian-male-young.target', 0.15),
               (MACRO + 'universal-male-young-maxmuscle-averageweight.target', 0.75), (MACRO + 'universal-male-young-averagemuscle-averageweight.target', 0.25),
               (MACRO + 'proportions/male-young-maxmuscle-averageweight-idealproportions.target', 0.6),
               (MACRO + 'height/male-young-maxmuscle-averageweight-maxheight.target', 0.25),
               ('chin/chin-prominent-incr.target', 0.55), ('chin/chin-width-incr.target', 0.5), ('nose/nose-hump-incr.target', 0.6),
               ('nose/nose-scale-vert-incr.target', 0.35), ('nose/nose-point-down.target', 0.3), ('eyebrows/eyebrows-trans-forward.target', 0.6),
               ('eyebrows/eyebrows-angle-down.target', 0.35), ('head/head-square.target', 0.45), ('cheek/l-cheek-bones-incr.target', 0.5),
               ('cheek/r-cheek-bones-incr.target', 0.5), ('neck/neck-scale-horiz-incr.target', 0.5)],
     'lean-muscled steelworker: square jaw, hooked nose, heavy brow'),
    ('plains', [(MACRO + 'african-male-young.target', 0.75), (MACRO + 'caucasian-male-young.target', 0.25),
                (MACRO + 'universal-male-young-maxmuscle-maxweight.target', 0.45), (MACRO + 'universal-male-young-averagemuscle-averageweight.target', 0.55),
                (MACRO + 'height/male-young-maxmuscle-averageweight-maxheight.target', 0.4),
                ('chin/chin-width-incr.target', 0.4), ('eyebrows/eyebrows-trans-forward.target', 0.35), ('cheek/l-cheek-bones-incr.target', 0.3),
                ('cheek/r-cheek-bones-incr.target', 0.3), ('neck/neck-scale-horiz-incr.target', 0.7)],
     'broad heavy-shouldered man'),
    ('heavy', [(MACRO + 'caucasian-male-young.target', 0.9), (MACRO + 'asian-male-young.target', 0.1),
               (MACRO + 'universal-male-young-averagemuscle-maxweight.target', 0.7), (MACRO + 'universal-male-young-maxmuscle-maxweight.target', 0.3),
               ('nose/nose-hump-incr.target', 0.3), ('head/head-square.target', 0.6), ('chin/chin-prominent-incr.target', 0.3), ('neck/neck-scale-horiz-incr.target', 0.9)],
     'heavy older-built man with a thick neck'),
]

# ---- HUMAN c6: a POPULATION, not three men. MakeHuman's own macro rule (makehuman/apps/humanmodifier.py MacroModifier):
# a race target {race}-{gender}-{age} weighs race x gender x age, a universal target {gender}-{age}-{muscle}-{weight}
# weighs gender x age x muscle x weight; age 25 y = 'young', 90 y = 'old' (linear between); muscle and weight 0.5 = average,
# 1 = max, 0 = min. So a 52-year-old woman of average muscle and above-average weight is a real point of that space, not a
# scaled man. Face targets on top give each person a face of their own. The first three variants above stay byte-identical
# (old pieces render exactly as before); fetch the extra targets with scripts/fetch_mh_targets.py.
def macro(races, gender, age, muscle=0.5, weight=0.5, cup=None):
    gw = {'male': gender, 'female': 1 - gender}
    old = min(1.0, max(0.0, (age - 25) / 65)); aw = {'young': 1 - old, 'old': old}
    def tri(v):
        if v >= 0.5: return {'max': (v - 0.5) * 2, 'average': 1 - (v - 0.5) * 2, 'min': 0.0}
        return {'min': (0.5 - v) * 2, 'average': 1 - (0.5 - v) * 2, 'max': 0.0}
    mw, ww = tri(muscle), tri(weight)
    out = []
    for g, gv in gw.items():
        if gv <= 0: continue
        for a, av in aw.items():
            if av <= 0: continue
            for r, rv in races.items(): out.append((f'{MACRO}{r}-{g}-{a}.target', rv * gv * av))
            for m, mv in mw.items():
                for w, wv in ww.items():
                    k = gv * av * mv * wv
                    if k > 1e-4: out.append((f'{MACRO}universal-{g}-{a}-{m}muscle-{w}weight.target', k))
            if g == 'female' and cup is not None:
                out.append((f'breast/female-{a}-averagemuscle-averageweight-{"maxcup" if cup >= 0 else "mincup"}-averagefirmness.target', abs(cup) * av * gv))
    return out
POP = [   # (name, macro mix + face, note). Ages and builds chosen to span a real workforce; each face is its own.
    ('ada', macro({'african': 0.6, 'caucasian': 0.25, 'asian': 0.15}, 0, 34, muscle=0.68, weight=0.5, cup=0.25) +
            [('nose/nose-width1-incr.target', 0.45), ('nose/nose-nostrils-width-incr.target', 0.4), ('mouth/mouth-scale-horiz-incr.target', 0.3), ('mouth/mouth-lowerlip-height-incr.target', 0.4),
             ('head/head-oval.target', 0.4), ('chin/chin-height-incr.target', 0.2), ('cheek/l-cheek-bones-incr.target', 0.35), ('cheek/r-cheek-bones-incr.target', 0.35)],
     'woman, 34, strong-armed, broad nose and full mouth'),
    ('june', macro({'caucasian': 0.85, 'asian': 0.15}, 0, 52, muscle=0.5, weight=0.78, cup=0.22) +
             [('stomach/stomach-pregnant-incr.target', 0.18), ('head/head-round.target', 0.35), ('nose/nose-scale-horiz-incr.target', 0.3), ('head/head-age-incr.target', 0.25),
              ('cheek/l-cheek-volume-incr.target', 0.4), ('cheek/r-cheek-volume-incr.target', 0.4), ('chin/chin-prominent-decr.target', 0.3)],
     'woman, 52, heavy-set, round face, soft jaw'),
    ('mei', macro({'asian': 0.85, 'caucasian': 0.15}, 0, 26, muscle=0.5, weight=0.3, cup=-0.3) +
            [('head/head-triangular.target', 0.3), ('nose/nose-scale-horiz-decr.target', 0.2), ('eyes/r-eye-scale-decr.target', 0.2), ('eyes/l-eye-scale-decr.target', 0.2),
             ('chin/chin-width-decr.target', 0.3), ('mouth/mouth-upperlip-height-incr.target', 0.3)],
     'woman, 26, slight, narrow jaw'),
    ('rosa', macro({'caucasian': 0.5, 'african': 0.25, 'asian': 0.25}, 0, 43, muscle=0.85, weight=0.66, cup=0.15) +
             [('head/head-square.target', 0.35), ('chin/chin-width-incr.target', 0.3), ('nose/nose-hump-incr.target', 0.45), ('nose/nose-point-down.target', 0.25),
              ('eyebrows/eyebrows-trans-forward.target', 0.3), ('neck/neck-scale-horiz-incr.target', 0.3), ('torso/torso-vshape-incr.target', 0.15)],
     'woman, 43, muscular and square, hooked nose'),
    ('walt', macro({'caucasian': 0.9, 'asian': 0.1}, 1, 63, muscle=0.55, weight=0.32) +
             [('head/head-age-incr.target', 0.5), ('nose/nose-scale-vert-incr.target', 0.45), ('ears/r-ear-scale-incr.target', 0.45), ('ears/l-ear-scale-incr.target', 0.45),
              ('cheek/l-cheek-bones-incr.target', 0.4), ('cheek/r-cheek-bones-incr.target', 0.4), ('head/head-rectangular.target', 0.3), ('neck/neck-scale-horiz-decr.target', 0.3)],
     'man, 63, wiry, long face, big ears'),
    ('otis', macro({'african': 0.85, 'caucasian': 0.15}, 1, 57, muscle=0.6, weight=0.85) +
             [('stomach/stomach-pregnant-incr.target', 0.3), ('head/head-round.target', 0.3), ('neck/neck-scale-horiz-incr.target', 0.6), ('nose/nose-width1-incr.target', 0.4),
              ('head/head-fat-incr.target', 0.3), ('chin/chin-height-decr.target', 0.2), ('eyebrows/eyebrows-angle-down.target', 0.3)],
     'man, 57, heavy, thick neck, broad nose'),
    ('kai', macro({'asian': 0.6, 'caucasian': 0.4}, 1, 21, muscle=0.45, weight=0.28) + [(MACRO + 'height/male-young-averagemuscle-averageweight-maxheight.target', 0.35)] +
            [('head/head-oval.target', 0.45), ('chin/chin-prominent-decr.target', 0.2), ('nose/nose-trans-up.target', 0.2), ('ears/r-ear-flap-incr.target', 0.3), ('ears/l-ear-flap-incr.target', 0.3)],
     'man, 21, lanky, oval face'),
    ('ray', macro({'african': 0.4, 'caucasian': 0.4, 'asian': 0.2}, 1, 39, muscle=0.62, weight=0.55) +
            [('nose/nose-width1-incr.target', 0.35), ('mouth/mouth-lowerlip-height-incr.target', 0.35), ('eyebrows/eyebrows-trans-forward.target', 0.4), ('head/head-square.target', 0.25),
             ('chin/chin-prominent-incr.target', 0.3), ('forehead/forehead-trans-backward.target', 0.3)],
     'man, 39, square brow, prominent chin'),
]
POP_SEX = {'ada': 'f', 'june': 'f', 'mei': 'f', 'rosa': 'f', 'walt': 'm', 'otis': 'm', 'kai': 'm', 'ray': 'm'}
POP_AGE = {'ada': 34, 'june': 52, 'mei': 26, 'rosa': 43, 'walt': 63, 'otis': 57, 'kai': 21, 'ray': 39}
if all(os.path.exists(T(t)) for _, mix, _ in POP for t, _ in mix): VARIANTS = VARIANTS + POP
else: print('bake_hero: c6 population targets missing (run scripts/fetch_mh_targets.py); baking the three cycle-1 men only')
EXPR = ['mouth-open', 'eyebrows-left-down', 'eyebrows-right-down', 'eye-left-slit', 'eye-right-slit', 'nose-left-elevation',
        'nose-right-elevation', 'mouth-upward-retraction', 'mouth-depression-retraction', 'mouth-corner-puller', 'neck-platysma']

# region codes (shared with hero.js)
REG = {'head': 0, 'neck': 1, 'torso': 2, 'uarm': 3, 'farm': 4, 'hand': 5, 'finger': 6, 'pelvis': 7, 'thigh': 8, 'shin': 9, 'foot': 10, 'jaw': 11}

def region_of(bone):
    b = bone.split('.')[0]
    if b in ('head', 'special05', 'eye', 'orbicularis03', 'orbicularis04', 'oculi01', 'levator05', 'levator06', 'special04', 'temporalis01', 'temporalis02', 'oris01', 'oris03', 'oris05', 'oris07', 'risorius03') : return 'head'
    if b in ('jaw',) or b.startswith('tongue'): return 'jaw'
    if b.startswith('neck'): return 'neck'
    if b.startswith('spine') or b in ('clavicle', 'breast', 'shoulder01'): return 'torso'
    if b.startswith('upperarm'): return 'uarm'
    if b.startswith('lowerarm'): return 'farm'
    if b in ('wrist',) or b.startswith('metacarpal'): return 'hand'
    if b.startswith('finger'): return 'finger'
    if b in ('root', 'pelvis'): return 'pelvis'
    if b.startswith('upperleg'): return 'thigh'
    if b.startswith('lowerleg'): return 'shin'
    if b in ('foot',) or b.startswith('toe'): return 'foot'
    return 'torso'

def load_obj(path):
    V, faces, group = [], {}, None
    for line in open(path):
        if line.startswith('v '): V.append([float(x) for x in line.split()[1:4]])
        elif line.startswith('g '): group = line.split()[1]
        elif line.startswith('f '):
            idx = [int(tok.split('/')[0]) - 1 for tok in line.split()[1:]]
            faces.setdefault(group, []).append(idx)
    return np.array(V, dtype=np.float64), faces

def load_target(path, n):
    d = np.zeros((n, 3))
    for line in open(path):
        if not line.strip() or line.startswith('#'): continue
        p = line.split()
        if len(p) == 4: d[int(p[0])] = [float(p[1]), float(p[2]), float(p[3])]
    return d

def tris(quads):
    out = []
    for f in quads:
        if len(f) == 3: out.append(f)
        else:
            for k in range(1, len(f) - 1): out.append([f[0], f[k], f[k + 1]])
    return np.array(out, dtype=np.uint32)

def fit_proxy(mhclo, obj, base):
    """MakeHuman proxy fitting: each proxy vertex = barycentric mix of 3 base vertices + an offset scaled by the
    base mesh's own measured x/y/z scales (x_scale v1 v2 dist: |v1 - v2| / dist)."""
    lines = open(mhclo).read().splitlines()
    sc = {}
    for l in lines:
        m = re.match(r'([xyz])_scale (\d+) (\d+) ([\d.]+)', l)
        if m: sc[m.group(1)] = (int(m.group(2)), int(m.group(3)), float(m.group(4)))
    k = lines.index('verts 0') + 1
    refs = []
    while k < len(lines) and lines[k].strip() and not lines[k].startswith(('delete', 'material', '#')):
        p = lines[k].split()
        if len(p) == 9: refs.append(([int(x) for x in p[:3]], [float(x) for x in p[3:6]], [float(x) for x in p[6:9]]))
        elif len(p) == 1: refs.append(([int(p[0])] * 3, [1, 0, 0], [0, 0, 0]))
        k += 1
    s = np.array([abs(base[sc[a][0]][i] - base[sc[a][1]][i]) / sc[a][2] for i, a in enumerate('xyz')])
    P = np.array([sum(w * base[v] for v, w in zip(vs, ws)) + np.array(off) * s for vs, ws, off in refs])
    V, F = load_obj(obj)
    return P, refs, F

def main():
    os.makedirs(OUT, exist_ok=True)
    base, faces = load_obj(os.path.join(MH, '3dobjs', 'base.obj'))
    n = len(base)
    skel = json.load(open(os.path.join(MH, 'rigs', 'default.mhskel')))
    wts = json.load(open(os.path.join(MH, 'rigs', 'default_weights.mhw')))['weights']
    names = list(skel['bones'].keys())
    # topological order (parents first)
    order, seen = [], set()
    def visit(b):
        if b in seen: return
        p = skel['bones'][b]['parent']
        if p: visit(p)
        seen.add(b); order.append(b)
    for b in names: visit(b)
    bidx = {b: i for i, b in enumerate(order)}
    parents = [bidx[skel['bones'][b]['parent']] if skel['bones'][b]['parent'] else -1 for b in order]

    # skin weights: top 4 per vertex, normalised
    per = [[] for _ in range(n)]
    for b, lst in wts.items():
        for v, w in lst: per[v].append((w, bidx[b]))
    SI = np.zeros((n, 4), dtype=np.uint16); SW = np.zeros((n, 4), dtype=np.float32); region = np.zeros(n, dtype=np.uint8)
    for v in range(n):
        p = sorted(per[v], reverse=True)[:4]
        tot = sum(w for w, _ in p) or 1
        for k, (w, b) in enumerate(p): SI[v, k] = b; SW[v, k] = w / tot
        if not p: SW[v, 0] = 1; SI[v, 0] = bidx['root']
        region[v] = REG[region_of(order[SI[v, 0]])]

    def joint(Vx, name):
        return Vx[skel['joints'][name]].mean(axis=0)

    to_m = 0.1  # MakeHuman units are decimetres
    bodyV = np.unique(tris(faces['body']))
    variants = []
    for vname, mix, note in VARIANTS:
        Vx = base.copy()
        for tp, w in mix: Vx += w * load_target(T(tp), n)
        heads = np.array([joint(Vx, skel['bones'][b]['head']) for b in order]); tails = np.array([joint(Vx, skel['bones'][b]['tail']) for b in order])
        ground = Vx[bodyV][:, 1].min()
        off = np.array([0, -ground, 0])
        variants.append({'name': vname, 'note': note, 'V': (Vx + off) * to_m, 'heads': (heads + off) * to_m, 'tails': (tails + off) * to_m, 'base': Vx, 'off': off})

    # limb parameter: position along the proximal->distal joint segment of the vertex's dominant limb (variant 0)
    V0, H0, T0 = variants[0]['V'], variants[0]['heads'], variants[0]['tails']
    def seg(v, a, b):
        A, Bp = H0[bidx[a]], H0[bidx[b]]
        d = Bp - A; return float(np.clip(np.dot(V0[v] - A, d) / np.dot(d, d), -0.5, 1.5))
    along = np.zeros(n, dtype=np.float32)
    for v in range(n):
        r = region[v]; side = 'L' if V0[v][0] > 0 else 'R'
        if r == REG['uarm']: along[v] = seg(v, f'upperarm01.{side}', f'lowerarm01.{side}')
        elif r == REG['farm'] or r == REG['hand']: along[v] = seg(v, f'lowerarm01.{side}', f'wrist.{side}')
        elif r == REG['thigh']: along[v] = seg(v, f'upperleg01.{side}', f'lowerleg01.{side}')
        elif r == REG['shin'] or r == REG['foot']: along[v] = seg(v, f'lowerleg01.{side}', f'foot.{side}')
        elif r in (REG['torso'], REG['pelvis'], REG['neck']): along[v] = seg(v, 'spine05', 'neck01') if r != REG['neck'] else 1.0
        elif r == REG['finger']:
            # fingers: 3 + phalanx (0 proximal .. 2 distal) + position along that phalanx; the thumb counts from its CMC
            b = order[SI[v, 0]]; m = re.match(r'finger(\d)-(\d)\.(L|R)', b)
            if m:
                ph = int(m.group(2)) - 1; i = bidx[b]; A, Bq = H0[i], T0[i]; d = Bq - A
                along[v] = 3 + ph + float(np.clip(np.dot(V0[v] - A, d) / np.dot(d, d), 0, 0.999))

    # expression morphs (on variant 0's scale; they are small offsets and transfer to every variant)
    expr = [load_target(T(f'expression/{e}.target'), n) * to_m for e in EXPR]

    # eyes: fitted per variant (they sit in the sockets of that head)
    eyesP = []
    for vr in variants:
        P, refs, EF = fit_proxy(os.path.join(MH, 'eyes', 'high-poly', 'high-poly.mhclo'), os.path.join(MH, 'eyes', 'high-poly', 'high-poly.obj'), vr['base'])
        eyesP.append((P + vr['off']) * to_m)
    # eye positions share the same offset as the body
    eyeF = tris(EF[list(EF.keys())[0]] if len(EF) == 1 else sum(EF.values(), []))
    ne = len(eyesP[0])
    eye_side = np.array([1 if p[0] > 0 else 0 for p in eyesP[0]], dtype=np.uint8)

    groups = {g: tris(faces[g]) for g in ['body', 'helper-tights', 'helper-upper-teeth', 'helper-lower-teeth', 'helper-tongue']}

    # ---- write
    blob = bytearray(); meta = {'n': n, 'ne': ne, 'bones': [], 'variants': [], 'groups': {}, 'expr': EXPR, 'regions': REG, 'arrays': {}}
    def put(key, arr):
        arr = np.ascontiguousarray(arr)
        while len(blob) % 4: blob.append(0)
        meta['arrays'][key] = {'offset': len(blob), 'dtype': str(arr.dtype), 'shape': list(arr.shape)}
        blob.extend(arr.tobytes())
    for vi, vr in enumerate(variants):
        put(f'pos_{vr["name"]}', vr['V'].astype(np.float32))
        put(f'eyes_{vr["name"]}', eyesP[vi].astype(np.float32))
        meta['variants'].append({'name': vr['name'], 'note': vr['note'], 'sex': POP_SEX.get(vr['name'], 'm'), 'age': POP_AGE.get(vr['name']), 'heads': np.round(vr['heads'], 5).tolist(), 'tails': np.round(vr['tails'], 5).tolist(),
                                 'height': float(vr['V'][np.unique(groups['body'])][:, 1].max())})
    put('skinIndex', SI); put('skinWeight', SW); put('region', region); put('along', along)
    for g, a in groups.items(): put('idx_' + g, a)
    put('idx_eyes', eyeF); put('eye_side', eye_side)
    for e, d in zip(EXPR, expr): put('expr_' + e, d.astype(np.float32))
    meta['bones'] = [{'name': b, 'parent': parents[i]} for i, b in enumerate(order)]
    json.dump(meta, open(os.path.join(OUT, 'hero.json'), 'w'))
    open(os.path.join(OUT, 'hero.bin'), 'wb').write(bytes(blob))
    print('hero bake:', n, 'verts,', len(groups['body']), 'body tris,', len(order), 'bones,', len(variants), 'variants,', f'{len(blob) / 1e6:.1f} MB')
    for vr, m in zip(variants, meta['variants']): print(f"  {vr['name']}: height {m['height']:.3f} m  ({vr['note']})")

if __name__ == '__main__':
    main()
