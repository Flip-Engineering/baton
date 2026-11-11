# HAIRMAT (round 7, 8 Oct): the Cycles side of the HAIR FIBRE MODEL (videos/web/lib/fx/hair/material/fibre.js is the model; this file
# applies its parameters to every render fibre person_hair.py grows). Numpy only at import (testable outside Blender); bpy only inside
# material() and _write(). What it sets, per fibre and along its length:
#   optics   Principled Hair BSDF (Chiang et al. 2016; Marschner et al. 2003's lobes): IOR 1.55, cuticle tilt 3 deg, longitudinal width
#            6 deg at the root -> 9 deg at weathered lengths (Cycles roughness 0.127 -> 0.180), azimuthal 0.30; pigment per POINT
#            (hm_mel, hm_red: the cast's eumelanin / pheomelanin x a per-fibre lognormal x the sun oxidation of the lengths), the grey
#            fibres unpigmented (HAIR7's per-fibre 'grey' is a FRACTION: a hairline intermediate carries 0.18-0.35); roughness per POINT
#   shaft    the fibre's own diameter by ancestry x its CALIBRE (HAIR7's per-fibre 'cal': 1 a terminal hair, < 1 the hairline's
#            intermediate hairs), constant along the shaft (+-10 % fibre to fibre), a cut end tapering over its last 4 mm (a natural point
#            over 10 mm on ~15 % of fibres)
#   density  (scalp) RENDER CHILDREN: each fibre person_hair.py grows (HAIR7's placement, curl, locks and follicles, untouched) gets
#            children so the head carries the measured scalp density (fibres / cm2 x the area its roots cover); rope clumps get none.
#            Two laws (CHILD_LAW below): 'rigid' (iteration 1, LANDED): k - 1 children at a constant offset within half a millimetre of
#            the parent; 'lock' (iteration 2, the A/B under measurement): the children are the other fibres of the parent's lock: an
#            intermediate hair is a single-hair unit (no children), and each child WANDERS within the lock, its offset from the parent a
#            smooth path whose reach grows from the follicular unit's pore spacing at the root as the lock's cohesion falls toward the
#            dry ends (the sebum film that binds fibres thins with distance from the gland), so fibres cross at small angles (a tress is
#            not a bundle of parallel copies: its specular peak is broader than a single fibre's) and the ends open into frizz; and each
#            child LEAVES THE SCALP at its own angle (its own follicle's axis), gathered by the lock over the elastocapillary length, so a
#            crop's fibres are not parallel copies either (lane iteration 4).
# LANDED (8 Oct, iteration 2: the iteration-1 measurer, 'full' BETTER than the control on L08, L22, L03, L05, 'should become the Cycles
# default'): person_hair.build_part ends in hairmat7.dress(ob, pp, hr, seed), which re-dresses the scalp and the beard by the lane file
# videos/web/assets/person/v7lanes/HAIRMAT.json ({ "cycles": { "mode": "full", "children": "rigid" } }), so every Cycles render of
# every lane carries the fibre model. The person's fibre JSON is made once per export by node (videos/web/labs/hairmat/fibre_params.mjs
# <export dir>, the one model, fibre.js) and kept beside the export (hairmat_params.json). Any failure leaves the hair exactly as
# person_hair.py built it and says so in the log ('hairmat7: NOT applied').
# The A/B switches (env, win over the lane file; for before / after renders only): HAIRMAT = off | full (off = person_hair.py's own
# material and fibres), HAIRMAT_CHILD = rigid | lock, HAIRMAT_PARAMS = a fibre JSON to use instead of the export's.
# (The optics-only 'mat' arm of iteration 1 is deleted: the measurer found it the SAME as the control on all four.)
import json, math, os, subprocess, zlib
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); VIDEOS = os.path.dirname(HERE)
LANE_FILE = os.path.join(VIDEOS, 'web', 'assets', 'person', 'v7lanes', 'HAIRMAT.json')

PARTS = ('scalp', 'beard')
_P = None


_LANE = None


def lane():
    global _LANE
    if _LANE is None:
        try:
            with open(LANE_FILE) as f:
                _LANE = json.load(f)
        except (OSError, ValueError):
            _LANE = {}
    return _LANE


def mode():
    """env HAIRMAT (the A/B) wins; else the lane file's cycles.mode; else off"""
    e = (os.environ.get('HAIRMAT') or '').strip().lower()
    if e:
        return 'full' if e == 'full' else 'off'
    m = str(((lane().get('cycles') or {}).get('mode')) or 'off').lower()
    return 'full' if m == 'full' else 'off'


def child_law():
    """the render children's law: env HAIRMAT_CHILD (the A/B) wins; else the lane file's cycles.children; else 'rigid' (landed)"""
    e = (os.environ.get('HAIRMAT_CHILD') or '').strip().lower() or str(((lane().get('cycles') or {}).get('children')) or 'rigid').lower()
    return 'lock' if e == 'lock' else 'rigid'


_PD = {}


def params(pp=None):
    """the person's fibre JSON: env HAIRMAT_PARAMS, else <export>/hairmat_params.json (made here by node from the export's manifest)"""
    global _P
    p = os.environ.get('HAIRMAT_PARAMS')
    if p:
        if _P is None:
            if not os.path.exists(p):
                raise RuntimeError(f'HAIRMAT_PARAMS {p!r} does not exist')
            with open(p) as f:
                _P = json.load(f)
        return _P
    d = getattr(pp, 'dir', None)
    if not d:
        raise RuntimeError('no export dir to make the fibre JSON from')
    d = os.path.abspath(d)
    if d not in _PD:
        out = os.path.join(d, 'hairmat_params.json')
        if not os.path.exists(out):
            node = os.environ.get('NODE') or 'node'
            r = subprocess.run([node, os.path.join('web', 'labs', 'hairmat', 'fibre_params.mjs'), d, '--out', out], cwd=VIDEOS, capture_output=True, text=True, timeout=120)
            if r.returncode != 0 or not os.path.exists(out):
                raise RuntimeError(f'fibre_params.mjs failed ({r.returncode}): {(r.stderr or r.stdout)[-400:]}')
        with open(out) as f:
            _PD[d] = json.load(f)
    return _PD[d]


def active(part, pp=None):
    """this part's fibre (fibre.js partFibre) when the switch is on for it, else None"""
    if mode() == 'off' or part not in PARTS:
        return None
    P = params(pp)
    return (P.get('parts') or {}).get(part) or P.get('fibre')


def rng_for(part, seed=1):
    # a stream of its own (the strand placement's stream stays the one person_hair.py uses); crc32, not hash(): stable across processes
    return np.random.default_rng(seed * 104729 + zlib.crc32(('hairmat:' + part).encode()) % 100003)


# ---------------------------------------------------------------- the roughness law (Chiang 2016 / Cycles: sqrt(v) = 0.726 r + 0.812 r^2 + 3.7 r^20)
_R = np.linspace(0, 1, 4001)
_B = 0.726 * _R + 0.812 * _R ** 2 + 3.7 * _R ** 20


def rough_of_beta(beta):
    return np.interp(beta, _B, _R)


# ---------------------------------------------------------------- the scalp area the roots cover (for the measured density)
def scalp_area_cm2(roots):
    """roots (n,3) m: least-squares sphere through them, then the area of the equal-area direction bins (~1 cm2) the roots fall in,
    with interior holes (a bin with >= 6 of its 8 neighbours occupied) filled: rows of cards a centimetre apart leave such holes"""
    X = np.asarray(roots, dtype=np.float64)
    if len(X) < 8:
        return 0.0, {}
    A = np.c_[2 * X, np.ones(len(X))]; b = (X ** 2).sum(1)
    sol, *_ = np.linalg.lstsq(A, b, rcond=None); c = sol[:3]; R = math.sqrt(max(1e-6, sol[3] + c @ c))
    if not (0.05 < R < 0.2):   # not a head-sized sphere: fall back to the roots' mean radius about their centroid
        c = X.mean(0); R = float(np.linalg.norm(X - c, axis=1).mean())
    U = (X - c) / np.maximum(np.linalg.norm(X - c, axis=1, keepdims=True), 1e-9)
    total = 4 * math.pi * (R * 100) ** 2; n = max(8, int(round(math.sqrt(total))))   # n x n bins of ~1 cm2
    zi = np.clip(((U[:, 2] + 1) / 2 * n).astype(int), 0, n - 1); fi = np.clip(((np.arctan2(U[:, 1], U[:, 0]) + math.pi) / (2 * math.pi) * n).astype(int), 0, n - 1)
    occ = np.zeros((n, n), bool); occ[zi, fi] = True
    nb = sum(np.roll(np.roll(occ, dz, 0), df, 1).astype(int) for dz in (-1, 0, 1) for df in (-1, 0, 1) if dz or df)
    nb[0, :] = 0; nb[-1, :] = 0   # no wrap across the poles
    filled = occ | (nb >= 6)
    area = filled.sum() * total / (n * n)
    return float(area), dict(R_cm=round(R * 100, 2), bins=int(n * n), occupied=int(occ.sum()), filled=int(filled.sum()))


def density_factor(F, roots, base_count):
    """render fibres a card carries x k, so the head carries F.density.perCm2 x the scalp area"""
    area, info = scalp_area_cm2(roots)
    target = F['density']['perCm2'] * area
    k = target / max(1, base_count)
    k = float(np.clip(k, 1.0, 8.0))   # never thinner than the current groom; 8x is the render budget's ceiling (a head <= ~200 k fibres)
    return k, dict(info, area_cm2=round(area, 1), target=int(target), base=int(base_count), k=round(k, 2))


# ---------------------------------------------------------------- per fibre and along it
def arc(P_all, sizes):
    """s (metres from each fibre's root) per point, and each fibre's length, for points concatenated fibre after fibre"""
    sizes = np.asarray(sizes, int); start = np.r_[0, np.cumsum(sizes)[:-1]]
    d = np.r_[0.0, np.linalg.norm(np.diff(P_all, axis=0), axis=1)]
    d[start] = 0.0
    cs = np.cumsum(d); s = cs - np.repeat(cs[start], sizes)
    L = s[start + sizes - 1]
    return s, L, start


def radii(F, P_all, sizes, rng, part='scalp', cal=None):
    """('full') the fibre's own radius (m) per point: the ancestry's shaft x the fibre's calibre (HAIR7's 'cal': < 1 the hairline's
    intermediate hairs), constant along the shaft, a cut end over its last 4 mm (or a natural point over 10 mm)"""
    S = F['shaft']; s, L, start = arc(P_all, sizes); nF = len(sizes)
    r0 = S['dUm'] * 0.5e-6 * np.clip(1 + rng.normal(0, S['sd'], nF), 0.75, 1.3)
    if cal is not None:
        r0 = r0 * np.clip(np.asarray(cal, float), 0.2, 1.5)
    nat = rng.random(nF) < S['natural']['share']
    mm = np.where(nat, S['natural']['mm'], S['cut']['mm']) * 1e-3; kk = np.where(nat, S['natural']['k'], S['cut']['k'])
    u = np.repeat(L, sizes) - s   # distance to the tip
    mmP, kP = np.repeat(mm, sizes), np.repeat(kk, sizes)
    prof = np.where(u < mmP, kP + (1 - kP) * np.clip(u / np.maximum(mmP, 1e-9), 0, 1), 1.0)
    return (np.repeat(r0, sizes) * prof).astype(np.float32)


def attributes(F, P_all, sizes, grey_flags, rng):
    """per point: hm_mel (Cycles Melanin, 0..1), hm_red (Melanin Redness), hm_rough (Roughness), from the fibre model"""
    pg, op, we = F['pigment'], F['optics'], F['weather']
    s, L, start = arc(P_all, sizes); nF = len(sizes)
    growth = F['density']['growthCmPerMonth']
    w = 1 - np.exp(-(s * 100.0 / growth) / we['tauMonths'])            # the weathering of the lengths, 0 at the root
    fm = np.exp(rng.normal(0, pg['spread'], nF))                          # per-fibre pigment (lognormal)
    fr = np.clip(1 + rng.normal(0, op['spread'], nF), 0.7, 1.3)          # per-fibre roughness
    # the curve attribute 'grey' is the fibre's unpigmented FRACTION (1 = a white fibre; HAIR7's hairline intermediates carry 0.18-0.35)
    g = np.repeat(np.clip(np.asarray(grey_flags, float), 0, 1), sizes)
    keep = 1 - we['bleach'] * w
    eu = (1 - g) * pg['eu'] * np.repeat(fm, sizes) * keep + g * pg['white']['eu']
    ph = (1 - g) * pg['ph'] * np.repeat(fm, sizes) * keep + g * pg['white']['ph']
    q = eu + ph
    mel = 1 - np.exp(-q); red = np.where(q > 0, ph / np.maximum(q, 1e-9), 0)
    beta = np.radians(op['betaRootDeg'] + (op['betaTipDeg'] - op['betaRootDeg']) * w)
    rough = np.clip(rough_of_beta(beta) * np.repeat(fr, sizes), 0.03, 0.6)
    return mel.astype(np.float32), red.astype(np.float32), rough.astype(np.float32), dict(
        mel_p50=float(np.median(mel)), red_p50=float(np.median(red)), rough_p50=float(np.median(rough)), w_max=float(w.max()) if len(w) else 0.0)


# ---------------------------------------------------------------- render children (the measured density)
CHILD_R = 0.0005     # m: a child's place at the root, within half a millimetre of its parent (the follicular unit's pore spacing)
CHILD_TRIM = 0.06    # a child's length: its parent's x U(1 - 0.06, 1)
CLUMP_R = 0.00015    # a 'fibre' wider than this at its root is a rope clump (person_hair.rope_strands): no children
# the 'lock' law (iteration 2). A child is another fibre of its parent's lock, held to it by the lock's cohesion (capillary bridges of
# sebum and water between fibres: the cohesion of HAIR7's locks, Daviet 2020; the wisp models of Plante et al. 2001, Bertails et al. 2006).
# Sebum is secreted into the follicle and spreads along the shaft from the root, so the binding is strongest near the scalp and the dry
# ends separate (Robbins, Chemical and Physical Behavior of Human Hair, 5th ed. 2012: the hair's lipids; curly fibres carry it least far
# along their arc). Between contacts a fibre follows its own slightly different curvature (each follicle bends its fibre a little
# differently), so neighbouring fibres cross at small angles: the reason a tress's specular peak is broader than one fibre's
# (Stamm, Garcia, Fuchs 1977, J Soc Cosmet Chem 28:571; Reich & Robbins 1993, J Soc Cosmet Chem 44:221). Parameters with a physical
# meaning, set once from these scales and fitted to nothing:
LOCK_REACH = 0.0015       # m: how far a fibre strays from its neighbour where the lock no longer binds it (a fraction of a lock's width,
                          # HAIR7's 4-8 mm)
LOCK_COH = 0.12           # m of arc: the e-folding length of the binding along the shaft (the sebum film's reach; not measured here)
LOCK_WAVE = (0.03, 0.10)  # m: wavelengths of a fibre's own deviation from its neighbour (a few centimetres between contacts)
# the EMERGENCE of a child (lane iteration 4). The hairs of a follicular unit share one ostium but each grows from its own follicle with
# its own axis, so they leave the scalp a few degrees apart (Headington 1984, Arch Dermatol 120:449, the follicular unit; the follicle's
# own angle, Lindelof et al. 1988). A fibre only joins its neighbour where it is long enough for the capillary bridge to bend it over:
# the elastocapillary length (Bico, Roman, Moulin, Boudaoud 2004, Nature 432:690, 'Elastocapillary coalescence in wet hair': a few cm for
# a hair). So a child leaves at its own angle and the lock gathers it over about that length: its lateral offset is
# theta L_ec (1 - exp(-s / L_ec)), the angle theta at the root decaying as exp(-s / L_ec). On a crop shorter than L_ec the fibres keep
# their own angles (a crop is not in locks: the fibres cross and the highlight breaks up); on long hair it adds a bounded spread near
# the root before the lock law's own reach takes over. Two physical scales set once, fitted to nothing:
EMERGE_SD = math.radians(3.0)   # rad: the s.d. of a child's emergence angle from its parent's (each of two directions)
L_EC = 0.03                      # m: the elastocapillary length of a hair (Bico et al. 2004: centimetres)
CAL_SINGLE = 0.95         # a fibre below this calibre is an intermediate hair (the hairline's transition zone): a single-hair unit
CHUNK_PTS = 3.0e6         # padded child points per chunk (memory: ~70 MB an array whatever the fibre's point count)


def transport_frames(Pp, sizes):
    """a parallel-transported normal N1 along each fibre (padded (n, mL, 3)); N2 = T x N1"""
    n, mL, _ = Pp.shape
    T = np.zeros_like(Pp); T[:, 1:-1] = Pp[:, 2:] - Pp[:, :-2]; T[:, 0] = Pp[:, 1] - Pp[:, 0]; T[:, -1] = Pp[:, -1] - Pp[:, -2]
    nl = np.linalg.norm(T, axis=2, keepdims=True); T = np.where(nl > 1e-12, T / np.maximum(nl, 1e-12), 0)
    for i in range(1, mL):   # a padded tail repeats its last point: keep the last good tangent
        bad = np.linalg.norm(T[:, i], axis=1) < 0.5; T[bad, i] = T[bad, i - 1]
    ref = np.where(np.abs(T[:, 0, 2:3]) < 0.9, np.array([[0, 0, 1.0]]), np.array([[1.0, 0, 0]]))
    N = np.zeros_like(Pp); v = np.cross(T[:, 0], ref); N[:, 0] = v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-12)
    for i in range(1, mL):
        v = N[:, i - 1] - (N[:, i - 1] * T[:, i]).sum(1, keepdims=True) * T[:, i]
        ln = np.linalg.norm(v, axis=1, keepdims=True); N[:, i] = np.where(ln > 1e-9, v / np.maximum(ln, 1e-12), N[:, i - 1])
    return T, N, np.cross(T, N)


def children(P_all, sizes, radius, grey, cal, k, grey_share, rng, law='rigid'):
    """parents (concatenated points, sizes, per-point radius, per-fibre grey and calibre) -> parents + children in the same layout,
    each fibre's parent index (-1 for the parents themselves), and what the law did"""
    sizes = np.asarray(sizes, int); nP = len(sizes); start = np.r_[0, np.cumsum(sizes)[:-1]]
    grey = np.asarray(grey, float); cal = np.ones(nP) if cal is None else np.asarray(cal, float)
    clump = radius[start] > CLUMP_R
    if law == 'lock':
        single = clump | (cal < CAL_SINGLE)
        nel = int((~single).sum())
        kk = float(np.clip((k * nP - single.sum()) / max(1, nel), 1.0, 8.0)) if nel else 1.0   # the singles' share carried by the others
        nc = np.floor(kk - 1 + rng.random(nP)).astype(int); nc[single] = 0
    else:
        single = clump; kk = k
        nc = np.floor(k - 1 + rng.random(nP)).astype(int); nc[clump] = 0
    info = dict(law=law, k_eff=round(kk, 2), singles=int(single.sum()), intermediates=int((cal < CAL_SINGLE).sum()))
    if nc.sum() == 0:
        return P_all, sizes, radius, grey, cal, np.full(nP, -1), info
    outP, outS, outR, outG, outC, outI = [P_all], [sizes], [radius], [grey], [cal], [np.full(nP, -1)]
    chunk = max(50, int(CHUNK_PTS / (max(1, int(sizes.max())) * max(1.0, kk - 1))))
    for c0 in range(0, nP, chunk):
        sl = slice(c0, min(nP, c0 + chunk)); sz = sizes[sl]
        if nc[sl].sum() == 0:
            continue
        st = start[sl]; mL = int(sz.max()); I = st[:, None] + np.minimum(np.arange(mL)[None, :], sz[:, None] - 1)   # padded with each fibre's last point
        Pp = P_all[I].astype(np.float64); T, N1, N2 = transport_frames(Pp, sz)
        par = np.repeat(np.arange(len(sz)), nc[sl]); m = len(par)
        a = rng.random(m) * 2 * math.pi; rr = CHILD_R * np.sqrt(rng.random(m))
        x = np.cos(a) * rr; y = np.sin(a) * rr
        if law == 'lock':   # the child's own path in the lock: its reach grows as the binding falls along the arc
            sa = np.concatenate([np.zeros((len(sz), 1)), np.cumsum(np.linalg.norm(np.diff(Pp, axis=1), axis=2), axis=1)], axis=1)[par]
            reach = LOCK_REACH * (1 - np.exp(-sa / LOCK_COH))
            l1, l2 = rng.uniform(*LOCK_WAVE, m), rng.uniform(*LOCK_WAVE, m); p1, p2 = rng.uniform(0, 2 * math.pi, m), rng.uniform(0, 2 * math.pi, m)
            wx = 0.5 * (np.sin(2 * math.pi * sa / l1[:, None] + p1[:, None]) - np.sin(p1)[:, None])
            wy = 0.5 * (np.sin(2 * math.pi * sa / l2[:, None] + p2[:, None]) - np.sin(p2)[:, None])
            gath = L_EC * (1 - np.exp(-sa / L_EC))   # the emergence angle, gathered by the lock over the elastocapillary length
            ex, ey = rng.normal(0, EMERGE_SD, m), rng.normal(0, EMERGE_SD, m)
            X = x[:, None] + reach * wx + ex[:, None] * gath; Y = y[:, None] + reach * wy + ey[:, None] * gath
            Q = Pp[par] + X[:, :, None] * N1[par] + Y[:, :, None] * N2[par]
        else:
            Q = Pp[par] + (x[:, None, None] * N1[par] + y[:, None, None] * N2[par])
        ln = np.maximum(3, np.round(sz[par] * rng.uniform(1 - CHILD_TRIM, 1, m)).astype(int))
        keep = np.arange(mL)[None, :] < ln[:, None]
        outP.append(Q[keep].astype(P_all.dtype)); outS.append(ln)
        outR.append(radius[I][par][keep].astype(np.float32))
        gp = grey[c0 + par]
        outG.append(np.where(rng.random(m) < 0.5, gp, (rng.random(m) < grey_share).astype(float)))
        outC.append(cal[c0 + par]); outI.append(c0 + par)
    return np.concatenate(outP), np.concatenate(outS), np.concatenate(outR), np.concatenate(outG), np.concatenate(outC), np.concatenate(outI), info


# ---------------------------------------------------------------- re-dress a built part (Blender)
def _read(cv):
    nPt, nC = len(cv.points), len(cv.curves)
    P = np.empty(nPt * 3, np.float32)
    try:
        cv.position_data.foreach_get('vector', P)
    except AttributeError:   # (an API without position_data: the generic attribute)
        cv.attributes['position'].data.foreach_get('vector', P)
    P = P.reshape(-1, 3)
    try:
        off = np.empty(nC + 1, np.int32); cv.curve_offset_data.foreach_get('value', off)
    except AttributeError:
        off = np.r_[[c.first_point_index for c in cv.curves], nPt].astype(np.int32)
    sizes = np.diff(off).astype(int)
    R = np.empty(nPt, np.float32); cv.attributes['radius'].data.foreach_get('value', R)
    G = np.zeros(nC, np.float32)
    if 'grey' in cv.attributes:
        cv.attributes['grey'].data.foreach_get('value', G)
    C = np.ones(nC, np.float32)   # (HAIR7 c3) the fibre's calibre relative to a terminal hair; absent = all terminal
    if 'cal' in cv.attributes:
        cv.attributes['cal'].data.foreach_get('value', C)
    return P, sizes, R, G, C


def _write(name, P, sizes, R, G, attrs, C=None):
    import bpy
    cv = bpy.data.hair_curves.new(name); cv.add_curves([int(x) for x in sizes])
    cv.position_data.foreach_set('vector', np.ascontiguousarray(P, np.float32).ravel())
    ra = cv.attributes.get('radius') or cv.attributes.new('radius', 'FLOAT', 'POINT'); ra.data.foreach_set('value', np.ascontiguousarray(R, np.float32))
    ga = cv.attributes.new('grey', 'FLOAT', 'CURVE'); ga.data.foreach_set('value', np.ascontiguousarray(G, np.float32))
    if C is not None:
        ca = cv.attributes.new('cal', 'FLOAT', 'CURVE'); ca.data.foreach_set('value', np.ascontiguousarray(C, np.float32))
    for k, v in attrs.items():
        a = cv.attributes.new(k, 'FLOAT', 'POINT'); a.data.foreach_set('value', np.ascontiguousarray(v, np.float32))
    return cv


def retouch(ob, F, md, part, seed=1):
    import time
    t = time.time(); cv = ob.data; P, sizes, R, G, C = _read(cv); info = dict(part=part, mode=md, parents=int(len(sizes)), parent_points=int(len(P)))
    rng = rng_for(part, seed)
    if md == 'full':
        if part == 'scalp':
            start = np.r_[0, np.cumsum(sizes)[:-1]]
            k, kinfo = density_factor(F, P[start], len(sizes)); info['density'] = kinfo
            P, sizes, R, G, C, _, cinfo = children(P, sizes, R, G, C, k, F['pigment']['grey'], rng, child_law()); info['children'] = cinfo
        Rn = radii(F, P, sizes, rng, part, C)
        start = np.r_[0, np.cumsum(sizes)[:-1]]
        clump = np.repeat(R[start] > CLUMP_R, sizes)
        R = np.where(clump, R, Rn)
    mel, red, rough, st = attributes(F, P, sizes, G, rng); info['attrs'] = {k: round(v, 4) for k, v in st.items()}
    cv2 = _write(cv.name, P, sizes, R, G, {F['cycles']['attrs']['melanin']: mel, F['cycles']['attrs']['redness']: red, F['cycles']['attrs']['roughness']: rough}, C)
    cv2.materials.append(material('hairmat7_' + part, F))
    ob.data = cv2
    ob['strands'] = int(len(sizes)); ob['points'] = int(len(P)); ob['hairmat'] = md
    info.update(fibres=int(len(sizes)), points=int(len(P)), radius_um_p50=round(float(np.median(R)) * 1e6, 1), s=round(time.time() - t, 1))
    print('hairmat7', json.dumps(info), flush=True)
    return info


def dress(ob, pp, hr, seed=1):
    """person_hair.build_part's last step (landed): re-dress a built scalp / beard part by the fibre model when the mode is on; any
    failure leaves the part exactly as person_hair.py built it"""
    if ob is None or hr.get('part') not in PARTS or mode() == 'off':
        return ob
    try:
        F = active(hr['part'], pp)
        if F is not None:
            retouch(ob, F, mode(), hr['part'], seed)
    except Exception as e:   # never break a render: the pre-landing hair, and the log says why
        print(f'hairmat7: NOT applied to {hr.get("part")} ({type(e).__name__}: {e}); the hair is person_hair.py\'s own', flush=True)
    return ob


def material(name, F):
    """the Principled Hair BSDF (Chiang) reading the per-point attributes"""
    import bpy
    C = F['cycles']
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree
    for nd in list(nt.nodes):
        nt.nodes.remove(nd)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    h = nt.nodes.new('ShaderNodeBsdfHairPrincipled'); h.model = 'CHIANG'; h.parametrization = 'MELANIN'
    h.inputs['Tint'].default_value = (1, 1, 1, 1)
    h.inputs['Radial Roughness'].default_value = C['radialRoughness']
    h.inputs['Coat'].default_value = C['coat']
    h.inputs['IOR'].default_value = C['ior']
    h.inputs['Offset'].default_value = C['offsetRad']
    h.inputs['Random Color'].default_value = C['randomColor']
    h.inputs['Random Roughness'].default_value = C['randomRoughness']
    for sock, an in (('Melanin', C['attrs']['melanin']), ('Melanin Redness', C['attrs']['redness']), ('Roughness', C['attrs']['roughness'])):
        at = nt.nodes.new('ShaderNodeAttribute'); at.attribute_name = an; at.attribute_type = 'GEOMETRY'
        nt.links.new(at.outputs['Fac'], h.inputs[sock])
    hi = nt.nodes.new('ShaderNodeHairInfo'); nt.links.new(hi.outputs['Random'], h.inputs['Random'])
    nt.links.new(h.outputs['BSDF'], out.inputs['Surface'])
    return m
