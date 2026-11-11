#!/usr/bin/env python3
"""HUMAN c8 lane A: the body studio's own anatomy layers on MakeHuman's hm08 mesh, and the shape basis lib/fx/body/ mixes at runtime.

    python3 videos/scripts/bake_body.py              # author our fields -> videos/sources/body/, pack -> videos/web/assets/body/basis.{json,bin}
    python3 videos/scripts/bake_body.py preview      # clay previews of every field (scratch PNGs, see --out)
    python3 videos/scripts/bake_body.py cast         # fit and write the demo cast (runs web/labs/human8/lab_body_cast.mjs in node)

A body here is built the way a figure-drawing teacher explains one, in layers over a measured frame (lib/fx/body/mix.js does the
mixing; this script authors the layers). Everything below is authored on the hm08 base mesh (13,380 body vertices, closed and
manifold) in bind space, by rules from the rig's joint centres and from named surface landmarks, so it transfers to every body
MakeHuman's macro space makes (same topology). Each layer is DATA:
  - LANDMARKS: named vertices (suprasternale, xiphoid, omphalion, ASIS, iliac crest, C7, PSIS dimples, acromion, olecranon,
    patella, malleoli, heel, toe tip, MET3, gonion ...), picked by a ray from a joint centre to the surface (the vertex nearest the
    ray, inside the right body region). The bench overlays them; the kinematic model takes its de Leva endpoints from them.
  - FAT DEPOTS (scalar thickness fields, peak 1): a field is a seed (a point or a polyline of surface vertices) grown by an
    ANISOTROPIC geodesic distance (Dijkstra on the edge graph with the edge lengths scaled per axis), a gaussian of that distance,
    a facing term (the side of the body the depot sits on) and Laplacian smoothing. At runtime it displaces along the person's own
    smoothed bind normal: P += a * field * N. The depot list and its sex and age weights follow Richer 1920 (La femme: pl. 12-15,
    29-30, 51-52) and Wells 2007 / Kuk et al. 2009 for the shifts; the weights are calibrated to NHANES DXA in lib/fx/body/.
  - MUSCLES (scalar fields): a belly between origin and insertion (Scheepers, Parent, Carlson and May 1997: an ellipsoidal belly
    whose thickness profile runs along the line of action; Wilhelms and Van Gelder 1997), seeded along that line on the surface,
    profile b(u) = sin(pi u^k)^p peaking where the belly is thickest, gaussian across. Static (no pose bulge yet).
  - RELIEF (signed scalar fields): the bony and tendinous landmarks a student draws first (clavicle, sternal notch, costal margin,
    ASIS, iliac crest, patella, tibial crest, malleoli, C7, scapular spine and border, spinal furrow, sacral dimples, olecranon,
    ulnar head, knuckles) and the folds fat makes (gluteal fold, inguinal fold, navel crease, flank crease, submental fold). Mode
    'bone' fades with the local fat thickness (exp(-T / 6 mm)); mode 'fold' grows with it.
  - MASKS: segment labels for the kinematic model's voxels, breast footprint, abdomen (pregnancy), sag masks (gravity on soft
    tissue with laxity), head and pelvis frame weights, contact sides (the thighs meet, they do not interpenetrate).
The MakeHuman targets the generator also mixes (macro race/sex/age/muscle/weight, breast cup x firmness, measure lengths, face
targets) are packed unchanged from sources/makehuman/targets/ (CC0). Our fields are written to sources/body/fields/ as plain text
(vertex value) and, for depots and muscles, also as MakeHuman-format .target files at 1 cm peak so they can be used in MakeHuman
itself. All of sources/body/ is ours, CC0 1.0 (see its README).
"""
import os, sys, json, re, math, struct, functools, subprocess
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
VID = os.path.join(HERE, '..')
sys.path.insert(0, HERE)
import bake_hero as BH

MH = BH.MH
SRC = os.path.join(VID, 'sources', 'body')
OUT = os.path.join(VID, 'web', 'assets', 'body')
NB = 13380                     # hm08 body vertices are 0..13379 (helpers follow)

# ---------------------------------------------------------------- the base: mesh, rig, regions, graph
BASE, FACES = BH.load_obj(os.path.join(MH, '3dobjs', 'base.obj')); N_ALL = len(BASE)
TRI = BH.tris(FACES['body']).astype(np.int64)
SKEL = json.load(open(os.path.join(MH, 'rigs', 'default.mhskel')))
WTS = json.load(open(os.path.join(MH, 'rigs', 'default_weights.mhw')))['weights']
GROUND = BASE[:NB, 1].min()
P0 = (BASE - [0, GROUND, 0]) * 0.1          # metres, feet on y = 0 (the base is 1.666 m)
PB = P0[:NB]

def vnormals(P, tri=TRI):
    f = np.cross(P[tri[:, 1]] - P[tri[:, 0]], P[tri[:, 2]] - P[tri[:, 0]]); N = np.zeros((len(P), 3))
    for k in range(3): np.add.at(N, tri[:, k], f)
    return N / (np.linalg.norm(N, axis=1)[:, None] + 1e-12)
NRM = vnormals(P0)[:NB]
def J(b, end='head', P=P0): return P[SKEL['joints'][SKEL['bones'][b][end]]].mean(0)

DOM = [''] * N_ALL; _best = np.zeros(N_ALL)
BONEW = {}                                   # bone -> (vertex ids, weights)
for b, lst in WTS.items():
    ids = np.array([v for v, _ in lst]); ww = np.array([w for _, w in lst]); BONEW[b] = (ids, ww)
    for v, w in lst:
        if w > _best[v]: _best[v] = w; DOM[v] = b
REGION = np.array([BH.REG[BH.region_of(d)] if d else 2 for d in DOM])
def reg(*r): return np.isin(REGION[:NB], r)
def bone_weight(prefixes):
    w = np.zeros(N_ALL)
    for b, (ids, ww) in BONEW.items():
        if b.split('.')[0].startswith(prefixes): np.add.at(w, ids, ww)
    return np.clip(w, 0, 1)

E = np.concatenate([TRI[:, [0, 1]], TRI[:, [1, 2]], TRI[:, [2, 0]]]); E = np.unique(np.sort(E, 1), axis=0)
import scipy.sparse as sp
from scipy.sparse.csgraph import dijkstra
def graph(scale=(1, 1, 1)):
    d = (PB[E[:, 0]] - PB[E[:, 1]]) / np.array(scale, float); w = np.linalg.norm(d, axis=1) + 1e-9
    return sp.coo_matrix((np.r_[w, w], (np.r_[E[:, 0], E[:, 1]], np.r_[E[:, 1], E[:, 0]])), shape=(NB, NB)).tocsr()
_G = {}
def geo(seeds, scale=(1, 1, 1), limit=0.6):
    key = tuple(scale)
    if key not in _G: _G[key] = graph(scale)
    d = dijkstra(_G[key], indices=np.atleast_1d(seeds), min_only=True, limit=limit)
    return np.where(np.isfinite(d), d, limit)
ADJ = sp.coo_matrix((np.ones(2 * len(E)), (np.r_[E[:, 0], E[:, 1]], np.r_[E[:, 1], E[:, 0]])), shape=(NB, NB)).tocsr()
DEG = np.asarray(ADJ.sum(1)).ravel()
def smooth(f, it=10, lam=0.5, fix=None):
    f = f.astype(float).copy()
    for _ in range(it):
        g = (ADJ @ f) / DEG; f = f + lam * (g - f)
        if fix is not None: f[fix] = 0
    return f
# mirror map (hm08 is symmetric): v -> its partner across x = 0
from scipy.spatial import cKDTree
_kd = cKDTree(PB); MIRROR = _kd.query(PB * [-1, 1, 1])[1]
def mirror_sym(f): g = f[MIRROR]; return np.where(np.abs(g) > np.abs(f), g, f)
sst = lambda e0, e1, x: np.clip((x - e0) / (e1 - e0), 0, 1) ** 2 * (3 - 2 * np.clip((x - e0) / (e1 - e0), 0, 1))

# ---------------------------------------------------------------- landmarks (named surface vertices on hm08)
def ray_pick(p0, d, mask, maxd=0.3, cone=0.35, retry=True):
    d = np.asarray(d, float); d = d / np.linalg.norm(d); q = PB - p0; t = q @ d; perp = np.linalg.norm(q - t[:, None] * d, axis=1)
    ok = mask & (t > 0) & (t < maxd) & (perp < np.tan(cone) * t + 0.004); ix = np.where(ok)[0]
    if not len(ix):
        if retry: return ray_pick(np.asarray(p0, float) - 0.06 * d, d, mask, maxd, cone, retry=False)     # the start was outside the skin: back up along the ray
        raise RuntimeError(f'landmark ray found nothing from {p0} along {d}')
    return int(ix[np.argmin(perp[ix] + 0.02 * np.maximum(0, -(NRM[ix] @ d)))])
def nearest(p, mask): d = np.where(mask, np.linalg.norm(PB - p, axis=1), 9); return int(np.argmin(d))
side = lambda p, s: np.array(p, float) * [s, 1, 1]
def landmarks():
    L, how = {}, {}
    torso = reg(1, 2, 7); back = reg(1, 2, 3, 7)
    def put(k, v, h): L[k] = v; how[k] = h
    put('vertex', int(np.argmax(PB[:, 1])), 'highest vertex of the head (VERT)')
    put('suprasternale', ray_pick([0, 1.352, 0], [0, 0, 1], torso | reg(1)), 'jugular notch: anterior midline at the sternoclavicular joints (+1.6 cm)')
    put('xiphoid', ray_pick([0, 1.185, 0], [0, 0, 1], torso), 'xiphoid: anterior midline 10.0 % of stature below the notch (sternum length)')
    cand = np.where(torso & (np.abs(PB[:, 0]) < 0.012) & (PB[:, 1] > 0.92) & (PB[:, 1] < 1.07) & (PB[:, 2] > 0.05))[0]
    ring = lambda v: PB[np.linalg.norm(PB - PB[v], axis=1) < 0.025][:, 2].mean() - PB[v, 2]
    put('omphalion', int(cand[np.argmax([ring(v) for v in cand])]), 'navel: deepest point of the abdominal midline relative to its 2.5 cm ring')
    put('pubis', ray_pick([0, 0.86, 0], [0, 0.2, 1], torso), 'top of the pubic symphysis (mons), anterior midline')
    put('cervicale', ray_pick([0, 1.405, 0.0], [0, 0.15, -1], reg(1, 2)), 'C7 spinous process: posterior midline at the neck base (CERV)')
    put('sacrum', ray_pick([0, 0.93, 0], [0, 0, -1], torso), 'posterior midline over S2, top of the gluteal cleft')
    put('menton', int(np.where(reg(0, 11) & (np.abs(PB[:, 0]) < 0.006) & (PB[:, 2] > 0.04))[0][np.argmin(PB[reg(0, 11) & (np.abs(PB[:, 0]) < 0.006) & (PB[:, 2] > 0.04)][:, 1])]), 'lowest midline point of the chin')
    for s, S in ((1, 'L'), (-1, 'R')):
        put('acromion' + S, ray_pick(side([0.165, 1.33, 0.015], s), [0.45 * s, 1, 0], reg(2, 3)), 'acromion: superolateral from the shoulder joint centre')
        put('clavicleMid' + S, ray_pick(J('clavicle.L', 'head') * [s, 1, 1] * 0.5 + J('clavicle.L', 'tail') * [s, 1, 1] * 0.5, [0, 0.55, 1], torso | reg(1, 3)), 'midshaft of the clavicle, anterosuperior surface')
        put('asis' + S, ray_pick(side([0.08, 0.955, 0.0], s), [0.45 * s, 0, 1], torso), 'anterior superior iliac spine')
        put('iliacCrest' + S, ray_pick(side([0.0, 0.995, 0.0], s), [s, 0, 0], torso), 'iliac crest, lateral (iliac tubercle level): the NHANES waist tape level')
        put('psis' + S, ray_pick(side([0.038, 0.935, 0.0], s), [0, 0, -1], torso), 'posterior superior iliac spine: the sacral dimple')
        put('trochanter' + S, ray_pick(side([0.11, 0.86, 0.0], s), [s, 0, 0], reg(7, 8)), 'greater trochanter, lateral')
        put('gluteFold' + S, ray_pick(side([0.085, 0.775, 0.0], s), [0, 0, -1], reg(7, 8)), 'gluteal fold, mid-thigh line (ANSUR thigh circumference level)')
        put('patella' + S, ray_pick(side([0.157, 0.465, 0.03], s), [0, 0, 1], reg(8, 9)), 'patella, anterior centre')
        put('tibialTub' + S, ray_pick(side([0.165, 0.405, 0.03], s), [0, 0, 1], reg(9)), 'tibial tuberosity')
        put('latMalleolus' + S, ray_pick(side([0.22, 0.068, -0.005], s), [s, -0.1, -0.15], reg(9, 10)), 'lateral malleolus')
        put('medMalleolus' + S, ray_pick(side([0.21, 0.076, 0.002], s), [-s, 0, 0.1], reg(9, 10)), 'medial malleolus')
        foot = reg(10) & (np.sign(PB[:, 0]) == s)
        put('heel' + S, int(np.where(foot)[0][np.argmin(PB[foot][:, 2])]), 'most posterior point of the heel (HEEL)')
        put('toeTip' + S, int(np.where(foot)[0][np.argmax(PB[foot][:, 2])]), 'tip of the longest toe (TTIP)')
        el = J(f'lowerarm01.{"L" if s > 0 else "R"}'); sh = J(f'upperarm01.{"L" if s > 0 else "R"}'); a = (el - sh) / np.linalg.norm(el - sh)
        lat = np.array([-a[1], a[0], 0.0]); lat = lat if lat[1] > 0 else -lat
        put('olecranon' + S, ray_pick(el, [0, 0.1, -1], reg(3, 4)), 'olecranon, posterior elbow')
        put('latEpicondyle' + S, ray_pick(el, lat, reg(3, 4)), 'lateral epicondyle of the humerus')
        put('medEpicondyle' + S, ray_pick(el, -lat, reg(3, 4)), 'medial epicondyle of the humerus')
        X = 'L' if s > 0 else 'R'; wr = J(f'wrist.{X}'); fa = (wr - el) / np.linalg.norm(wr - el); pk = J(f'finger5-1.{X}') - J(f'finger2-1.{X}'); pk /= np.linalg.norm(pk)
        put('ulnarHead' + S, ray_pick(wr - 0.025 * fa, pk, reg(4, 5)), 'head of the ulna, dorsal-ulnar wrist')
        put('radialStyloid' + S, ray_pick(wr - 0.01 * fa, -pk, reg(4, 5)), 'radial styloid')
        put('met3' + S, nearest(J(f'finger3-1.{X}'), reg(5, 6)), 'third metacarpal head (MET3, de Leva hand endpoint)')
        put('gonion' + S, ray_pick([0, 1.49, 0.02], [s, -0.55, -0.35], reg(0, 11, 1)), 'angle of the mandible (MIDG = mid-gonion, de Leva head endpoint)')
        put('scapRoot' + S, ray_pick(side([0.065, 1.29, 0.0], s), [0, 0, -1], back), 'root of the spine of the scapula (vertebral border, T3)')
        put('scapInf' + S, ray_pick(side([0.085, 1.175, 0.0], s), [0, 0, -1], back, cone=0.6), 'inferior angle of the scapula (T7)')
        br = torso & (np.abs(PB[:, 0] - s * 0.085) < 0.04) & (PB[:, 1] > 1.13) & (PB[:, 1] < 1.27)
        put('nipple' + S, int(np.where(br)[0][np.argmax(PB[br][:, 2])]), 'bust apex on the base mesh (the breast model moves it)')
        put('rib10' + S, ray_pick(side([0.06, 1.045, 0.0], s), [s, 0, 0.55], torso), 'tenth rib, lateral costal margin (ANSUR tenth-rib height)')
        put('axillaFront' + S, ray_pick(side([0.13, 1.255, 0.02], s), [0.2 * s, -0.2, 1], torso | reg(3)), 'anterior axillary fold')
        put('axillaBack' + S, ray_pick(side([0.13, 1.255, 0.0], s), [0.2 * s, -0.2, -1], back), 'posterior axillary fold')
        put('kneeBack' + S, ray_pick(side([0.155, 0.45, 0.02], s), [0, 0, -1], reg(8, 9)), 'popliteal fossa')
        put('calfMax' + S, ray_pick(side([0.17, 0.34, 0.0], s), [0, 0, -1], reg(9)), 'calf, greatest posterior protrusion')
        put('tragion' + S, ray_pick([0, 1.535, 0.0], [s, 0, 0.1], reg(0, 11)), 'side of the head at the ear')
    return L, how

# ---------------------------------------------------------------- field primitives
def seeds_on_line(a, b, mask, out_dir, k=12, cone=0.5):
    """surface vertices over a 3-D line a->b: a ray from each of k points along it, in out_dir (a vector or a function of the point)"""
    vs = []
    for t in np.linspace(0, 1, k):
        p = a + (b - a) * t; d = out_dir(p) if callable(out_dir) else out_dir
        try: vs.append(ray_pick(p, d, mask, maxd=0.35, cone=cone))
        except RuntimeError: pass
    return np.unique(vs)
def facing(dirn, lo=-0.1, hi=0.45):
    d = np.asarray(dirn, float); d = d / np.linalg.norm(d); return sst(lo, hi, NRM @ d)
def blobfield(seed, sigma, scale=(1, 1, 1), mask=None, face=None, it=15, power=2.0):
    d = geo(seed, scale, limit=4 * sigma); f = np.exp(-0.5 * (d / sigma) ** power)
    if face is not None: f = f * face
    if mask is not None: f = f * mask
    f = smooth(f, it); return f / (f.max() + 1e-12)
def belly(seedline, a, b, sigma, peak=0.5, p=1.0, scale=(1, 1, 1), mask=None, it=12, ends=(0.0, 1.0)):
    """muscle: thickness = b(u) * gaussian(geodesic distance to the line's surface seeds); u = projection on a->b"""
    d = geo(seedline, scale, limit=4 * sigma); ab = b - a; u = np.clip(((PB - a) @ ab) / (ab @ ab), -0.3, 1.3)
    k = math.log(0.5) / math.log(peak); uu = np.clip((u - ends[0]) / (ends[1] - ends[0]), 0, 1)
    prof = np.sin(np.pi * uu ** k) ** p
    f = prof * np.exp(-0.5 * (d / sigma) ** 2)
    if mask is not None: f = f * mask
    f = smooth(f, it); return f / (f.max() + 1e-12)
def linefield(seedline, sigma, mask=None, it=6):
    d = geo(seedline, (1, 1, 1), limit=4 * sigma); f = np.exp(-0.5 * (d / sigma) ** 2)
    if mask is not None: f = f * mask
    f = smooth(f, it); return f / (f.max() + 1e-12)
def chain(points, mask, out_dir, k=8, cone=0.5):
    vs = []
    for a, b in zip(points[:-1], points[1:]): vs += list(seeds_on_line(np.asarray(a, float), np.asarray(b, float), mask, out_dir, k, cone))
    return np.unique(vs)
def surface_chain(vids, k=6):
    """a polyline through surface vertices (landmarks), resampled onto the surface by nearest vertex"""
    out = []
    for a, b in zip(vids[:-1], vids[1:]):
        for t in np.linspace(0, 1, k): out.append(nearest(PB[a] * (1 - t) + PB[b] * t, np.ones(NB, bool)))
    return np.unique(out)

# ---------------------------------------------------------------- the layers (L side authored, mirrored; metres on the 1.666 m base)
def author(L):
    F = {}                                              # name -> dict(kind, f (NB,) float, meta)
    torso = reg(1, 2, 7); trunk = reg(2, 7); legs = reg(7, 8, 9, 10); arms = reg(3, 4, 5, 6)
    P = lambda k: PB[L[k]]
    radial = lambda p: (lambda q: (lambda d: d / (np.linalg.norm(d) + 1e-9))(np.array([q[0], 0, q[2] - 0.03])))   # out from the trunk axis
    def put(name, kind, f, **meta): F[name] = {'kind': kind, 'f': np.clip(mirror_sym(f) if meta.pop('sym', True) else f, -1, 1), **meta}
    def ray_seeds(pts, d, mask, cone=0.5):
        out = []
        for p in pts:
            try: out.append(ray_pick(np.asarray(p, float), d if not callable(d) else d(np.asarray(p, float)), mask, cone=cone))
            except RuntimeError: pass
        return np.unique(out)
    grid = lambda xs, ys, z=0.0: [[x, y, z] for x in xs for y in ys]
    FRONT, BACK = [0, 0, 1], [0, 0, -1]
    # ---- FAT DEPOTS (thickness fields, peak 1; the sampler sets each one's amplitude in metres)
    put('abdUpper', 'depot', blobfield(ray_seeds(grid([0, 0.03], np.linspace(1.03, 1.11, 4)), FRONT, trunk), 0.07, (1.5, 1.0, 1.0), face=facing(FRONT, -0.45, 0.35), mask=1 - sst(1.13, 1.19, PB[:, 1])), group='trunk', note='upper abdomen, xiphoid to navel')
    put('abdLower', 'depot', blobfield(ray_seeds(grid([0, 0.035, 0.06], np.linspace(0.905, 0.975, 4)), FRONT, trunk), 0.06, (1.4, 0.9, 1.0), face=facing(FRONT, -0.45, 0.35), mask=sst(0.865, 0.905, PB[:, 1])),
        group='trunk', note='lower abdomen (hypogastric), navel to the pubic line: the womans belly of Richer pl. 29')
    put('visceral', 'depot', blobfield(ray_seeds(grid([0, 0.04], [0.99, 1.03, 1.07]), FRONT, trunk), 0.10, (1.2, 1.05, 1.0), face=facing(FRONT, -0.3, 0.5), power=2.6), group='trunk', dir=[0, 0, 1.6],
        note='firm (android, visceral) belly: a dome pushed mostly forward, no sag')
    crest = [[0.105, 0.985, 0.075], [0.13, 0.99, 0.03], [0.135, 0.99, -0.01], [0.12, 0.985, -0.045], [0.075, 0.975, -0.065]]
    put('flank', 'depot', blobfield(chain(crest, trunk, radial(None), k=4), 0.035, (1.0, 0.7, 1.0), face=facing([1, 0, -0.2], -0.5, 0.4), mask=sst(0.9, 0.96, PB[:, 1])), group='trunk', note='flank roll over the iliac crest (Richer pl. 13, 30)')
    put('back', 'depot', blobfield(ray_seeds(grid([0.04, 0.08, 0.11], [1.10, 1.16, 1.21]), BACK, torso), 0.06, (1.2, 1.0, 1.0), face=facing(BACK, -0.4, 0.4)), group='trunk', note='subscapular and mid back (the NHANES subscapular skinfold site)')
    bra = [[0.03, 1.165, -0.07], [0.08, 1.168, -0.07], [0.12, 1.168, -0.03], [0.135, 1.16, 0.02], [0.115, 1.15, 0.06]]
    put('braLine', 'depot', blobfield(chain(bra, torso, radial(None), k=4), 0.022, (1.0, 0.6, 1.0)), group='trunk', note='bra-line roll across the back and under the arm (Richer pl. 14)')
    put('nape', 'depot', blobfield([L['cervicale']] + list(ray_seeds([[0, 1.38, 0], [0.03, 1.39, 0]], BACK, torso | reg(1))), 0.035, (1.4, 1.0, 1.0), face=facing([0, 0.4, -1], -0.4, 0.4)),
        group='trunk', note='cervicodorsal pad over C7 (Richer pl. 14; the older back)')
    put('glute', 'depot', blobfield(ray_seeds([[0.08, 0.85, 0], [0.06, 0.82, 0], [0.1, 0.83, 0]], BACK, reg(7, 8)), 0.065, (1.0, 1.0, 1.0), face=facing(BACK, -0.45, 0.35)), group='gluteofemoral', note='buttock')
    put('troch', 'depot', blobfield(ray_seeds([[0.12, 0.80, 0.0], [0.12, 0.77, -0.01]], [1, 0, -0.1], reg(7, 8)), 0.055, (1.0, 1.0, 1.0), face=facing([1, 0, -0.15], -0.4, 0.4)), group='gluteofemoral',
        note='trochanteric fat below the greater trochanter (Richer pl. 15 E-G)')
    put('subtroch', 'depot', blobfield(ray_seeds([[0.13, 0.70, 0.0], [0.13, 0.66, 0.0]], [1, 0, 0], reg(8)), 0.055, (1.0, 1.35, 1.0), face=facing([1, 0, 0.1], -0.4, 0.4)), group='gluteofemoral', note='sub-trochanteric, lateral mid-thigh')
    put('innerThigh', 'depot', blobfield(ray_seeds([[0.11, 0.72, 0.02], [0.115, 0.66, 0.02]], [-1, 0, 0.1], reg(8, 7)), 0.05, (1.0, 1.3, 1.0), face=facing([-1, 0, 0.15], -0.4, 0.4)), group='gluteofemoral',
        note='inner thigh, the thighs meet (contact clamp at runtime)')
    put('kneeInner', 'depot', blobfield(ray_seeds([[0.15, 0.53, 0.03]], [-1, 0, 0.45], reg(8, 9)), 0.028, (1.0, 1.0, 1.0), face=facing([-1, 0, 0.5], -0.3, 0.5)), group='gluteofemoral',
        note='fat pad above and inside the knee ("un des caracteres distinctifs du genou feminin", Richer pl. 51-52)')
    put('thighFront', 'depot', blobfield(ray_seeds([[0.13, 0.68, 0.0], [0.13, 0.62, 0]], FRONT, reg(8)), 0.07, (1.1, 1.5, 1.0), face=facing(FRONT, -0.5, 0.3)), group='gluteofemoral', note='anterior thigh')
    put('calf', 'depot', blobfield([L['calfMaxL']], 0.06, (1.2, 1.5, 1.0), mask=reg(9, 8) * sst(0.1, 0.2, PB[:, 1])), group='limb', note='lower leg (calf and the medial ankle at high BMI)')
    sh, el, wr = J('upperarm01.L'), J('lowerarm01.L'), J('wrist.L')
    put('tricepsFat', 'depot', blobfield(seeds_on_line(sh + 0.25 * (el - sh), sh + 0.85 * (el - sh), reg(3), [0, -0.25, -1], k=8), 0.035, (1.0, 1.0, 1.0), face=facing([0, -0.3, -1], -0.5, 0.35)),
        group='arm', note='back of the upper arm (the NHANES triceps skinfold site; Richer pl. 15 A-D)')
    put('armGen', 'depot', smooth(reg(3) * 1.0 + reg(4) * 0.55 + reg(5) * 0.12 + reg(6) * 0.04, 25), group='arm', note='whole arm, thin')
    put('chestFat', 'depot', blobfield([L['nippleL']], 0.05, (1.0, 0.9, 1.0), face=facing([0, -0.1, 1], -0.3, 0.4)), group='trunk', note='pectoral fat (both sexes; the male breast with adiposity)')
    put('axillary', 'depot', blobfield(ray_seeds([[0.115, 1.235, 0.02]], [0.2, -0.1, 1], torso), 0.03, (1.0, 1.0, 1.0)), group='trunk', note='anterior axillary fat, between breast and arm')
    put('mons', 'depot', blobfield([L['pubis']], 0.028, (1.3, 0.8, 1.0), face=facing(FRONT, -0.2, 0.5)), group='trunk', note='mons pubis')
    throat = ray_pick(np.array([0, 1.425, 0.0]), FRONT, reg(1, 0, 11))
    put('submental', 'depot', blobfield(surface_chain([L['menton'], throat], 6), 0.022, (1.3, 1.0, 1.0), face=facing([0, -1, 0.6], -0.3, 0.5)), group='head', note='submental (double chin) and the front of the neck')
    put('neckFat', 'depot', smooth(reg(1) * 1.0, 20), group='head', note='neck, all round')
    cheek = ray_seeds([[0.045, 1.49, 0.02], [0.05, 1.46, 0.0]], [0.3, 0, 1], reg(0, 11), cone=0.5)
    put('faceFat', 'depot', blobfield(cheek, 0.02, (1.0, 1.0, 1.0), mask=reg(0, 11)), group='head', note='buccal and jowl fat pads (facial adiposity follows BMI; Coetzee et al. 2009)')
    # the diffuse subcutaneous layer, in four parts (a partition of unity across the region borders) so the fit can set arms and legs apart
    rw = {0: 0.18, 11: 0.35, 1: 0.7, 2: 1.0, 7: 1.0, 8: 1.0, 9: 0.55, 10: 0.22, 3: 0.85, 4: 0.55, 5: 0.18, 6: 0.04}
    g = smooth(np.array([rw[r] for r in REGION[:NB]]), 30)
    g = g * (1 - 0.85 * reg(7) * sst(0.35, 0.8, -NRM[:, 1]))          # not under the perineum (the crotch point does not drop with fat)
    parts = {'genTrunk': (1, 2, 7), 'genLeg': (8, 9, 10), 'genArm': (3, 4, 5, 6), 'genHead': (0, 11)}
    ind = {k: smooth(reg(*r).astype(float), 12) for k, r in parts.items()}; tot = sum(ind.values()) + 1e-9
    for k in parts: put(k, 'depot', g * ind[k] / tot, group='general', note=f'diffuse subcutaneous layer, {k[3:].lower()} part (thin over the face, hands and feet)')
    # ---- the BREAST (women; the model in lib/fx/body/breast.js drives these and MakeHuman's cup x firmness targets)
    nip = L['nippleL']; upper = PB[:, 1] > PB[nip, 1]
    d_up = geo([nip], (1.05, 1.35, 1.0), 0.3); d_lo = geo([nip], (1.05, 0.85, 1.0), 0.3)
    mound = np.exp(-0.5 * (np.where(upper, d_up, d_lo) / 0.05) ** 2.4) * facing([0.15, 0, 1], -0.3, 0.35) * torso
    put('breastMound', 'breast', smooth(mound, 12) / smooth(mound, 12).max(), note='our breast volume beyond the cup targets: a mound on the chest wall from the 2nd rib to the fold, fuller lower pole')
    foot = np.exp(-0.5 * (geo([nip], (1.0, 1.0, 1.0), 0.3) / 0.07) ** 2) * torso
    put('breastFoot', 'mask', smooth(foot, 8) / smooth(foot, 8).max(), note='breast footprint (chest-wall membrane for the volume measure; support and ptosis act inside it)')
    # ---- MUSCLES (bellies by origin and insertion; groups for the FFMI and occupation patterns)
    lat = (lambda a: (lambda l: l if l[1] > 0 else -l)(np.array([-a[1], a[0], 0.0])))((el - sh) / np.linalg.norm(el - sh))
    M = lambda name, a, b, out, sigma, peak, group, p=1.0, mask=None, k=10, ends=(0.0, 1.0), note='':\
        put(name, 'muscle', belly(seeds_on_line(np.asarray(a, float), np.asarray(b, float), mask if mask is not None else np.ones(NB, bool), out, k=k), np.asarray(a, float), np.asarray(b, float), sigma, peak, p, mask=None, ends=ends), group=group, note=note)
    ins = sh + 0.45 * (el - sh) + 0.015 * lat
    f = np.zeros(NB)
    for o, d in (([0.13, 1.372, 0.05], [0, 0.2, 1]), ([0.188, 1.381, 0.009], lat), ([0.14, 1.365, -0.045], [0.2, 0.2, -1])):
        f = np.maximum(f, belly(seeds_on_line(np.array(o), ins, reg(2, 3), d, k=8), np.array(o), ins, 0.03, 0.38))
    put('deltoid', 'muscle', f, group='upper', note='deltoid, three heads from clavicle, acromion and scapular spine to the deltoid tuberosity')
    f = np.zeros(NB); axf = PB[L['axillaFrontL']] + [0.02, 0.0, 0.0]
    for o in ([0.012, 1.33, 0.09], [0.018, 1.27, 0.12], [0.022, 1.215, 0.14], [0.06, 1.352, 0.07]):
        f = np.maximum(f, belly(seeds_on_line(np.array(o), axf, torso | reg(3), [0.1, 0.05, 1], k=8), np.array(o), axf, 0.033, 0.42))
    put('pectoral', 'muscle', f * facing([0.1, 0, 1], -0.2, 0.4), group='upper', note='pectoralis major, sternal and clavicular heads to the humerus')
    M('trapUpper', [0.02, 1.47, -0.03], [0.125, 1.385, -0.005], [0.2, 1, -0.6], 0.024, 0.5, 'neck', mask=reg(1, 2), note='upper trapezius: the neck-shoulder slope')
    M('trapMid', [0.0, 1.35, -0.05], [0.13, 1.36, -0.04], BACK, 0.03, 0.4, 'upper', mask=torso | reg(3))
    M('trapLower', [0.0, 1.21, -0.04], [0.075, 1.32, -0.05], BACK, 0.025, 0.4, 'upper', mask=torso)
    f = np.zeros(NB); lt = np.array([0.13, 1.245, -0.02])
    for o in ([0.02, 1.08, -0.05], [0.07, 1.0, -0.06], [0.03, 1.17, -0.06]):
        f = np.maximum(f, belly(seeds_on_line(np.array(o), lt, torso | reg(3), [0.4, 0, -1], k=8), np.array(o), lt, 0.04, 0.55))
    put('latissimus', 'muscle', f, group='upper', note='latissimus dorsi, lumbar fascia and lower ribs to the humerus (the back of the axilla)')
    M('erector', [0.03, 0.95, -0.06], [0.03, 1.28, -0.05], BACK, 0.018, 0.3, 'trunk', mask=torso, note='erector spinae columns either side of the spinal furrow')
    M('rectusAbd', [0.035, 0.885, 0.1], [0.05, 1.19, 0.14], FRONT, 0.022, 0.55, 'trunk', p=0.6, mask=trunk, note='rectus abdominis (intersections in the relief layer)')
    M('oblique', [0.11, 0.985, 0.05], [0.12, 1.12, 0.03], [1, 0, 0.6], 0.035, 0.4, 'trunk', mask=trunk, note='external oblique: the flank above the crest')
    M('serratus', [0.115, 1.15, 0.04], [0.12, 1.24, 0.02], [1, 0, 0.7], 0.02, 0.5, 'trunk', mask=torso)
    M('gluteMax', [0.035, 0.93, -0.07], [0.15, 0.78, -0.04], BACK, 0.05, 0.45, 'lower', mask=reg(7, 8), note='gluteus maximus, sacrum to the gluteal tuberosity')
    M('gluteMed', [0.12, 0.99, -0.01], [0.165, 0.87, -0.01], [1, 0.2, 0], 0.035, 0.5, 'lower', mask=reg(7, 8, 2))
    M('biceps', sh + [0.0, -0.03, 0.03], el + [0.0, 0.015, 0.03], [0, 0.1, 1], 0.022, 0.62, 'upper', p=1.2, mask=reg(3, 4))
    M('triceps', sh + [0.0, -0.02, -0.03], PB[L['olecranonL']] + [0, 0.02, 0], [0, -0.1, -1], 0.025, 0.4, 'upper', mask=reg(3, 4))
    fa = (wr - el) / np.linalg.norm(wr - el)
    M('forearmExt', PB[L['latEpicondyleL']], el + 0.55 * (wr - el) + 0.02 * lat, lat + [0, 0, 0.3], 0.022, 0.25, 'forearm', mask=reg(4, 3), note='brachioradialis and the wrist extensors')
    M('forearmFlex', PB[L['medEpicondyleL']], el + 0.55 * (wr - el) - 0.02 * lat, -lat + [0, 0, 0.5], 0.022, 0.3, 'forearm', mask=reg(4, 3))
    M('rectusFem', [0.11, 0.83, 0.07], [0.15, 0.49, 0.08], FRONT, 0.03, 0.45, 'lower', mask=reg(8), note='rectus femoris')
    M('vastusLat', [0.16, 0.80, 0.0], [0.175, 0.50, 0.04], [1, 0, 0.4], 0.035, 0.5, 'lower', mask=reg(8, 7))
    M('vastusMed', [0.10, 0.66, 0.05], [0.135, 0.49, 0.06], [-1, 0, 0.8], 0.025, 0.78, 'lower', mask=reg(8), note='vastus medialis: the teardrop above and inside the knee')
    M('adductors', [0.035, 0.80, 0.03], [0.12, 0.60, 0.01], [-1, 0, 0.2], 0.035, 0.35, 'lower', mask=reg(8, 7))
    M('hamstrings', [0.085, 0.78, -0.07], [0.15, 0.48, -0.03], BACK, 0.035, 0.45, 'lower', mask=reg(8))
    f = np.maximum(belly(seeds_on_line(np.array([0.14, 0.44, -0.02]), np.array([0.16, 0.26, -0.03]), reg(9, 8), BACK, k=8), np.array([0.14, 0.44, -0.02]), np.array([0.16, 0.26, -0.03]), 0.022, 0.35),
                   belly(seeds_on_line(np.array([0.18, 0.44, -0.02]), np.array([0.185, 0.29, -0.03]), reg(9, 8), BACK, k=8), np.array([0.18, 0.44, -0.02]), np.array([0.185, 0.29, -0.03]), 0.02, 0.35))
    put('gastroc', 'muscle', f, group='lower', note='gastrocnemius, medial and lateral heads')
    M('soleus', [0.17, 0.36, -0.02], [0.2, 0.14, -0.02], [0.3, 0, -1], 0.025, 0.6, 'lower', mask=reg(9))
    M('tibialisAnt', [0.175, 0.40, 0.05], [0.205, 0.12, 0.06], [0.3, 0, 1], 0.016, 0.3, 'lower', mask=reg(9))
    M('scm', [0.045, 1.52, -0.005], [0.012, 1.36, 0.075], [0.6, 0, 1], 0.012, 0.4, 'neck', mask=reg(1, 0, 11, 2), note='sternocleidomastoid')
    # ---- RELIEF (signed; 'bone' fades under fat, 'fold' grows with it); peak 1 = the amplitude in meta (metres)
    def R(name, seeds, sigma, amp, mode, note='', sym=True): put(name, 'relief', linefield(np.atleast_1d(seeds), sigma) * np.sign(amp), amp=abs(amp), mode=mode, note=note, sym=sym)
    clav = surface_chain([ray_pick(np.array([0.03, 1.35, 0.06]), [0, 0.4, 1], torso | reg(1)), L['clavicleMidL'], ray_pick(np.array([0.15, 1.375, 0.03]), [0, 1, 0.4], torso | reg(3))], 6)
    R('clavicle', clav, 0.008, 0.0035, 'bone', 'clavicle ridge')
    R('supraclavFossa', surface_chain([ray_pick(np.array([0.06, 1.37, 0.03]), [0, 1, 0.5], torso | reg(1)), ray_pick(np.array([0.12, 1.385, 0.02]), [0, 1, 0.3], torso | reg(1, 3))], 5), 0.012, -0.004, 'bone')
    R('sternalNotch', [L['suprasternale']], 0.012, -0.005, 'bone', 'jugular notch', sym=False)
    R('costalMargin', surface_chain([L['xiphoid'], ray_pick(np.array([0.06, 1.12, 0.05]), FRONT, trunk), ray_pick(np.array([0.1, 1.07, 0.03]), [0.6, 0, 1], trunk), L['rib10L']], 5), 0.01, 0.0025, 'bone', 'rib-cage edge')
    R('lineaAlba', surface_chain([L['xiphoid'], L['omphalion'], L['pubis']], 10), 0.006, -0.0018, 'bone', 'linea alba', sym=False)
    R('rectusInt', np.concatenate([seeds_on_line(np.array([0.01, y, 0.1]), np.array([0.075, y + 0.008, 0.1]), trunk, FRONT, k=5) for y in (1.06, 1.12)]), 0.005, -0.0015, 'bone', 'tendinous intersections of the rectus')
    R('asis', [L['asisL']], 0.012, 0.003, 'bone', 'ASIS')
    R('iliacCrestLine', surface_chain([L['asisL'], L['iliacCrestL'], L['psisL']], 6), 0.009, 0.002, 'bone', 'iliac crest')
    ing = surface_chain([L['asisL'], ray_pick(np.array([0.03, 0.875, 0.05]), [0.3, -0.3, 1], torso)], 6)
    R('inguinal', ing, 0.008, -0.003, 'fold', 'inguinal fold (deepens with fat over it)')
    R('patellaR', [L['patellaL']], 0.02, 0.004, 'bone', 'patella')
    R('tibialCrest', surface_chain([L['tibialTubL'], ray_pick(np.array([0.2, 0.2, 0.04]), [-0.2, 0, 1], reg(9)), L['medMalleolusL']], 6), 0.007, 0.0022, 'bone', 'tibial crest (the shin)')
    R('malleoli', [L['latMalleolusL'], L['medMalleolusL']], 0.011, 0.003, 'bone', 'malleoli')
    ach = seeds_on_line(np.array([0.215, 0.2, -0.03]), np.array([0.22, 0.06, -0.04]), reg(9, 10), BACK, k=6)
    R('achilles', ach, 0.007, 0.0025, 'bone', 'Achilles tendon')
    R('c7', [L['cervicale']], 0.01, 0.003, 'bone', 'C7 spinous process', sym=False)
    R('spinalFurrow', np.concatenate([seeds_on_line(np.array([0.0, 0.95, -0.05]), np.array([0.0, 1.38, -0.04]), torso, BACK, k=14)]), 0.009, -0.0035, 'bone', 'spinal furrow', sym=False)
    R('scapSpine', surface_chain([L['acromionL'], L['scapRootL']], 8), 0.009, 0.0025, 'bone', 'spine of the scapula')
    R('scapBorder', surface_chain([L['scapRootL'], L['scapInfL']], 8), 0.01, 0.002, 'bone', 'vertebral border of the scapula')
    R('sacralDimples', [L['psisL']], 0.01, -0.0035, 'bone', 'sacral dimples (PSIS)')
    R('olecranonR', [L['olecranonL']], 0.01, 0.003, 'bone', 'olecranon')
    R('ulnarHeadR', [L['ulnarHeadL']], 0.007, 0.002, 'bone', 'head of the ulna')
    kn = [ray_pick(J(f'finger{i}-1.L'), d, reg(5, 6)) for i, d in ((2, [0.2, 1, 0]), (3, [0.2, 1, 0]), (4, [0.2, 1, 0]), (5, [0.2, 1, 0]))]
    R('knuckles', kn, 0.006, 0.0015, 'bone', 'metacarpal heads')
    R('gluteFoldLine', surface_chain([ray_pick(np.array([0.035, 0.785, -0.02]), BACK, reg(7, 8)), L['gluteFoldL'], ray_pick(np.array([0.14, 0.79, -0.02]), [0.5, 0, -1], reg(7, 8))], 6), 0.008, -0.004, 'fold', 'gluteal fold')
    R('navelCrease', seeds_on_line(np.array([0.0, 0.985, 0.1]), np.array([0.11, 0.99, 0.05]), trunk, [0.4, 0, 1], k=8), 0.008, -0.003, 'fold', 'transverse abdominal crease at the navel (heavier bodies)')
    R('flankCrease', chain([[0.12, 0.965, 0.04], [0.135, 0.968, 0.0], [0.12, 0.962, -0.04]], trunk, radial(None), k=4), 0.007, -0.0035, 'fold', 'crease under the flank roll')
    R('submentalFold', surface_chain([ray_pick(np.array([0.0, 1.44, 0.02]), [0, -0.2, 1], reg(1, 0, 11)), ray_pick(np.array([0.04, 1.445, 0.0]), [1, -0.2, 0.7], reg(1, 0, 11))], 5), 0.006, -0.0025, 'fold')
    # ---- MASKS and frame weights
    put('abdomen', 'mask', smooth(sst(0.86, 0.9, PB[:, 1]) * (1 - sst(1.14, 1.2, PB[:, 1])) * facing(FRONT, -0.6, 0.3) * trunk, 15), note='where a pregnancy can push (pubis to the costal margin, front)')
    sagw = {'abdLower': 1.0, 'glute': 0.8, 'tricepsFat': 1.0, 'submental': 0.8, 'kneeInner': 0.7, 'breast': 1.0}
    put('sag', 'mask', smooth(np.maximum.reduce([F['abdLower']['f'], F['glute']['f'] * 0.8, F['tricepsFat']['f'], F['submental']['f'] * 0.8, F['kneeInner']['f'] * 0.7, F['innerThigh']['f'] * 0.5, F['flank']['f'] * 0.5]), 6),
        note='gravity sag of soft tissue with laxity (age, parity, weight loss): lower belly, buttock, upper arm, chin, knee, inner thigh')
    put('contactThigh', 'mask', smooth(reg(8, 7) * sst(0.55, 0.62, PB[:, 1]) * (1 - sst(0.84, 0.88, PB[:, 1])) * facing([-1, 0, 0], -0.2, 0.3), 6), note='medial thigh: clamped at the midline so heavy thighs meet')
    hw = bone_weight(('head', 'jaw', 'eye', 'neck03', 'special', 'orbicularis', 'oculi', 'levator', 'oris', 'risorius', 'temporalis', 'tongue'))
    F['headW'] = {'kind': 'weight', 'f': hw, 'note': 'skin weight of the head bones (head scale, the head canon from stature); all vertices incl. helpers'}
    pg = np.zeros(N_ALL); pg[:NB] = smooth(np.isin(REGION[:NB], (2, 7, 8)) * sst(0.74, 0.84, PB[:, 1]) * (1 - sst(1.04, 1.12, PB[:, 1])), 12)
    F['pelvisW'] = {'kind': 'weight', 'f': np.clip(pg, 0, 1), 'note': 'the pelvic girdle band, crest to below the trochanters (bicristal / hip breadth: x scaled about the midline)'}
    F['legW'] = {'kind': 'weight', 'f': bone_weight(('upperleg', 'lowerleg', 'foot', 'toe')), 'note': 'legs: carried sideways with the hip joint when the pelvis widens'}
    return F

# ---------------------------------------------------------------- previews (numpy rasterizer: clay, orthographic; scratch only)
def raster(P, view='front', W=300, H=560, col=None, ext=None, tri=TRI):
    from PIL import Image
    R = {'front': np.eye(3), 'back': np.diag([-1., 1, -1]), 'side': np.array([[0., 0, -1], [0, 1, 0], [1, 0, 0]]),
         'q34': (lambda a: np.array([[math.cos(a), 0, math.sin(a)], [0, 1, 0], [-math.sin(a), 0, math.cos(a)]]))(-0.75)}[view]
    Q = P @ R.T
    if ext is None: ext = (-0.62, 0.62, -0.02, 1.9)
    x0, x1, y0, y1 = ext; sc = min(W / (x1 - x0), H / (y1 - y0)); X = (Q[:, 0] - x0) * sc; Y = (y1 - Q[:, 1]) * sc; Z = Q[:, 2]
    f = np.cross(Q[tri[:, 1]] - Q[tri[:, 0]], Q[tri[:, 2]] - Q[tri[:, 0]]); fl = np.linalg.norm(f, axis=1) + 1e-12; fn = f / fl[:, None]
    vn = np.zeros_like(Q)
    for k in range(3): np.add.at(vn, tri[:, k], f)
    vn /= np.linalg.norm(vn, axis=1)[:, None] + 1e-12
    Lg = np.array([-0.45, 0.55, 0.7]); Lg /= np.linalg.norm(Lg); sh = np.clip(vn @ Lg, 0, 1) * 0.78 + 0.18
    vc = (col if col is not None else np.tile([0.78, 0.74, 0.70], (len(P), 1))) * sh[:, None]
    img = np.full((H, W, 3), 0.1); zb = np.full((H, W), -1e9)
    for t in np.where(fn[:, 2] > -0.05)[0]:
        ia, ib, ic = tri[t]; xs = (X[ia], X[ib], X[ic]); ys = (Y[ia], Y[ib], Y[ic])
        mx0, mx1 = max(0, int(min(xs))), min(W - 1, int(max(xs)) + 1); my0, my1 = max(0, int(min(ys))), min(H - 1, int(max(ys)) + 1)
        if mx1 < mx0 or my1 < my0: continue
        gx, gy = np.meshgrid(np.arange(mx0, mx1 + 1) + 0.5, np.arange(my0, my1 + 1) + 0.5)
        dd = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2])
        if abs(dd) < 1e-12: continue
        w0 = ((ys[1] - ys[2]) * (gx - xs[2]) + (xs[2] - xs[1]) * (gy - ys[2])) / dd; w1 = ((ys[2] - ys[0]) * (gx - xs[2]) + (xs[0] - xs[2]) * (gy - ys[2])) / dd; w2 = 1 - w0 - w1
        m = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
        if not m.any(): continue
        z = w0 * Z[ia] + w1 * Z[ib] + w2 * Z[ic]; sub = zb[my0:my1 + 1, mx0:mx1 + 1]; up = m & (z > sub)
        if not up.any(): continue
        sub[up] = z[up]; img[my0:my1 + 1, mx0:mx1 + 1][up] = (w0[..., None] * vc[ia] + w1[..., None] * vc[ib] + w2[..., None] * vc[ic])[up]
    return (np.clip(img, 0, 1) ** (1 / 1.6) * 255).astype(np.uint8)
def save_sheet(rows, path, label=None):
    from PIL import Image, ImageDraw
    h = sum(max(i.shape[0] for i in r) for r in rows); w = max(sum(i.shape[1] for i in r) for r in rows); out = np.zeros((h, w, 3), np.uint8); y = 0
    for r in rows:
        x = 0; rh = max(i.shape[0] for i in r)
        for i in r: out[y:y + i.shape[0], x:x + i.shape[1]] = i; x += i.shape[1]
        y += rh
    im = Image.fromarray(out)
    if label: ImageDraw.Draw(im).text((6, 4), label, fill=(230, 230, 230))
    im.save(path)
def preview(F, out, base=None, amp=None):
    os.makedirs(out, exist_ok=True); P = P0[:NB] if base is None else base
    Nn = vnormals(np.vstack([P, P0[NB:]]))[:NB]
    for name, fd in F.items():
        if fd['kind'] in ('weight',): continue
        f = fd['f']; a = amp or {'depot': 0.035, 'muscle': 0.015, 'relief': 0.006, 'breast': 0.04, 'mask': 0.0}[fd['kind']]
        d = Nn if 'dir' not in fd else (lambda v: v / np.linalg.norm(v, axis=1)[:, None])(Nn + np.array(fd['dir']))
        Q = P + (a * f)[:, None] * d * (fd.get('amp', 1) / (fd.get('amp', 1)) if fd['kind'] != 'relief' else 1)
        col = np.tile([0.78, 0.74, 0.70], (NB, 1)); c = np.abs(f)[:, None]; col = col * (1 - 0.6 * c) + np.where(f[:, None] >= 0, [0.85, 0.25, 0.15], [0.15, 0.35, 0.85]) * 0.6 * c
        views = ('front', 'side', 'back')
        save_sheet([[raster(Q, v, col=col) for v in views]], os.path.join(out, f'{fd["kind"]}_{name}.png'), f'{name} ({fd["kind"]}) {fd.get("note", "")[:60]}')

# ---------------------------------------------------------------- packing: our fields + the MakeHuman targets the generator mixes
def hero_bone_order():
    names = list(SKEL['bones'].keys()); order, seen = [], set()
    def visit(b):
        if b in seen: return
        p = SKEL['bones'][b]['parent']
        if p: visit(p)
        seen.add(b); order.append(b)
    for b in names: visit(b)
    return order
def mh_list():
    T = os.path.join(MH, 'targets'); out = []
    for r in ('african', 'asian', 'caucasian'):
        for g in ('male', 'female'):
            for a in ('young', 'old'): out.append(f'macrodetails/{r}-{g}-{a}.target')
    for g in ('male', 'female'):
        for a in ('young', 'old'):
            for m in ('min', 'average', 'max'):
                for w in ('min', 'average', 'max'): out.append(f'macrodetails/universal-{g}-{a}-{m}muscle-{w}weight.target')
    for a in ('young', 'old'):
        for w in ('min', 'average', 'max'):
            for c in ('min', 'average', 'max'):
                for f in ('min', 'average', 'max'):
                    if c == 'average' and f == 'average': continue
                    out.append(f'breast/female-{a}-averagemuscle-{w}weight-{c}cup-{f}firmness.target')
    out += [f'breast/breast-{k}.target' for k in ('dist-decr', 'dist-incr', 'point-decr', 'point-incr', 'trans-down', 'trans-up', 'volume-vert-down', 'volume-vert-up')]
    out += [f'measure/measure-{k}-{d}.target' for k in ('shoulder-dist', 'upperarm-length', 'lowerarm-length', 'upperleg-height', 'lowerleg-height', 'napetowaist-dist', 'neck-height', 'waist-circ') for d in ('decr', 'incr')]
    out += [f'armslegs/{k}-{d}.target' for k in ('upperlegs-height', 'lowerlegs-height') for d in ('decr', 'incr')]
    out += [f'armslegs/{s}-{k}-{d}.target' for s in 'lr' for k in ('leg-valgus', 'hand-scale', 'foot-scale') for d in ('decr', 'incr')]
    out += ['neck/neck-double-incr.target', 'neck/neck-double-decr.target', 'neck/neck-scale-horiz-incr.target', 'neck/neck-scale-horiz-decr.target']
    for grp in ('head', 'nose', 'mouth', 'chin', 'cheek', 'forehead', 'eyebrows', 'eyes', 'ears'):
        for f in sorted(os.listdir(os.path.join(T, grp))):
            if f.endswith('.target') and not f.startswith('head-scale'): out.append(f'{grp}/{f}')
    return [t for t in dict.fromkeys(out) if os.path.exists(os.path.join(T, t))]
def pack(L, how, F):
    os.makedirs(OUT, exist_ok=True); blob = bytearray(); meta = {'version': 1, 'n': int(N_ALL), 'nb': NB, 'targets': {}, 'fields': {}, 'weights': {}}
    def put(arr):
        arr = np.ascontiguousarray(arr)
        while len(blob) % 4: blob.append(0)
        o = len(blob); blob.extend(arr.tobytes()); return o
    meta['base'] = {'o': put(BASE.astype(np.float32)), 'unit': 'dm (MakeHuman), as base.obj'}
    for t in mh_list():
        d = BH.load_target(BH.T(t), N_ALL); ix = np.where(np.abs(d).max(1) > 0)[0]; s = float(np.abs(d[ix]).max()) / 32767 if len(ix) else 1
        q = np.round(d[ix] / s).astype(np.int16); o = put(ix.astype(np.uint16)); put(q)
        meta['targets'][t[:-7]] = {'o': o, 'k': int(len(ix)), 's': s}
    for name, fd in F.items():
        f = fd['f']
        if fd['kind'] == 'weight':
            ix = np.where(f > 1e-3)[0]; o = put(ix.astype(np.uint16)); put(np.round(f[ix] * 65535).astype(np.uint16)); meta['weights'][name] = {'o': o, 'k': int(len(ix)), 'note': fd.get('note', '')}; continue
        ix = np.where(np.abs(f) > 2e-3)[0]; s = float(np.abs(f[ix]).max()) / 32767
        o = put(ix.astype(np.uint16)); put(np.round(f[ix] / s).astype(np.int16))
        meta['fields'][name] = {'o': o, 'k': int(len(ix)), 's': s, **{k: v for k, v in fd.items() if k not in ('f',)}}
    # the rig: bones in hero.json's order, each joint = mean of its MakeHuman vertex group
    order = hero_bone_order(); jn = sorted({SKEL['bones'][b][e] for b in order for e in ('head', 'tail')}); ji = {j: i for i, j in enumerate(jn)}
    meta['joints'] = [SKEL['joints'][j] for j in jn]; meta['bones'] = [{'name': b, 'head': ji[SKEL['bones'][b]['head']], 'tail': ji[SKEL['bones'][b]['tail']]} for b in order]
    # the eye proxy (MakeHuman proxy fitting: barycentric + offset scaled by the mesh's own x/y/z measures)
    lines = open(os.path.join(MH, 'eyes', 'high-poly', 'high-poly.mhclo')).read().splitlines(); sc = {}
    for l in lines:
        m = re.match(r'([xyz])_scale (\d+) (\d+) ([\d.]+)', l)
        if m: sc[m.group(1)] = [int(m.group(2)), int(m.group(3)), float(m.group(4))]
    k = lines.index('verts 0') + 1; refs = []
    while k < len(lines) and lines[k].strip() and not lines[k].startswith(('delete', 'material', '#')):
        p = lines[k].split()
        if len(p) == 9: refs.append(([int(x) for x in p[:3]], [float(x) for x in p[3:6]], [float(x) for x in p[6:9]]))
        elif len(p) == 1: refs.append(([int(p[0])] * 3, [1, 0, 0], [0, 0, 0]))
        k += 1
    o = put(np.array([r[0] for r in refs], np.uint32)); put(np.array([r[1] for r in refs], np.float32)); put(np.array([r[2] for r in refs], np.float32))
    meta['eyes'] = {'o': o, 'ne': len(refs), 'scale': sc}
    meta['landmarks'] = L; meta['landmarkNotes'] = how
    hero = json.load(open(os.path.join(VID, 'web', 'assets', 'hero', 'hero.json')))
    assert [b['name'] for b in hero['bones']] == order, 'bone order differs from hero.json'
    assert hero['ne'] == len(refs) and hero['n'] == N_ALL
    meta['provenance'] = {'mh': 'MakeHuman hm08 base mesh, rig joints, eye proxy and targets (github.com/makehumancommunity/makehuman a8bc2d5, makehuman/data; CC0 1.0)',
                          'ours': 'fields, landmarks and masks: scripts/bake_body.py (HUMAN c8 lane A), CC0 1.0; text copies in sources/body/'}
    json.dump(meta, open(os.path.join(OUT, 'basis.json'), 'w'), separators=(',', ':'))
    open(os.path.join(OUT, 'basis.bin'), 'wb').write(bytes(blob))
    print(f'basis: {len(meta["targets"])} MakeHuman targets, {len(meta["fields"])} fields, {len(meta["weights"])} weights, {len(blob) / 1e6:.2f} MB')
def write_sources(L, how, F):
    fd_dir = os.path.join(SRC, 'fields'); tg_dir = os.path.join(SRC, 'targets'); os.makedirs(fd_dir, exist_ok=True); os.makedirs(tg_dir, exist_ok=True)
    head = '# HUMAN c8 lane A (scripts/bake_body.py). CC0 1.0. hm08 vertex index, value. {kind} field "{name}": {note}\n'
    for name, fd in F.items():
        f = fd['f']; ix = np.where(np.abs(f) > 2e-3)[0]
        with open(os.path.join(fd_dir, f'{name}.field'), 'w') as o:
            o.write(head.format(kind=fd['kind'], name=name, note=fd.get('note', '')))
            for v in ix: o.write(f'{v} {f[v]:.4f}\n')
        if fd['kind'] in ('depot', 'muscle', 'breast'):
            d = (NRM if 'dir' not in fd else (lambda v: v / np.linalg.norm(v, axis=1)[:, None])(NRM + np.array(fd['dir']))) * f[:, None] * 0.1   # 1 cm peak, in MakeHuman decimetres
            with open(os.path.join(tg_dir, f'body-{fd["kind"]}-{name}.target'), 'w') as o:
                o.write(f'# HUMAN c8 lane A body studio, CC0 1.0. {fd["kind"]} "{name}" at 1 cm peak along the hm08 base normals. {fd.get("note", "")}\n')
                for v in ix: o.write(f'{v} {d[v, 0]:.5f} {d[v, 1]:.5f} {d[v, 2]:.5f}\n')
    json.dump({'landmarks': L, 'how': how, 'note': 'named hm08 body vertices (scripts/bake_body.py landmarks()); CC0 1.0'}, open(os.path.join(SRC, 'landmarks.json'), 'w'), indent=1)

def main():
    L, how = landmarks(); F = author(L)
    if 'preview' in sys.argv:
        out = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else '/tmp/body_preview'; preview(F, out); print('previews in', out); return
    if 'cast' in sys.argv:
        sys.exit(subprocess.call(['node', os.path.join(VID, 'web', 'labs', 'human8', 'lab_body_cast.mjs')] + sys.argv[sys.argv.index('cast') + 1:]))
    write_sources(L, how, F); pack(L, how, F)

if __name__ == '__main__':
    main()
