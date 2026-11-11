# EYES (round 7 studio, 8 Oct): the eye in Cycles as the organ and the optics it is, from the record and maps lib/fx/face/eye/ makes
# (web/labs/eyes/eye7_maps.mjs writes them into the export: <export>/eye7/, manifest eyes.eye7). Sources: web/lib/fx/face/eye/model.js.
#   - the GLOBE (r 12 mm) where FACE7 seated the lids (likeness/eyes.js fitEyes' centre and inset), the CORNEA one refracting surface
#     (r 7.8 mm, the keratometric index 1.3375: the iris's refraction and the tear film's 2 % Fresnel reflection, the catchlight, from one
#     surface; the stage's lights reach the iris through it along the straight shadow ray: see THE KEY INTO THE CHAMBER below), meeting the sclera at a horizontal-ellipse limbus 11.7 x 10.8 mm, the sclera
#     fading in over the limbal band (the opaque sclera's bevel over the clear cornea: through it the iris root in the angle: the limbal ring)
#   - the IRIS as geometry: a shallow cone from the pupil margin (on the lens, ACD(age) behind the apex) back to its root under the limbus,
#     displaced by the grown stroma relief (collarette, trabeculae, crypts, furrows, ruff), its albedo from the stroma's optics; the PUPIL
#     sized by the stage's light (Watson and Yellott 2012); behind it the dark globe
#   - the SCLERA: the grown vessel and melanosis map, Kubelka-Munk albedo, random-walk subsurface with its short mean free path, the tear
#     film as a coat
#   - from the EXPORTED SKIN itself (the body object already built): the lid margin per 2 degrees round each globe, and on it the lower and
#     upper TEAR MENISCUS (a concave water surface in the lid-globe corner: the wet line's highlight), the CARUNCLE and the PLICA at the
#     inner canthus, coloured by the person's skin model
#   - (EYE7_VERSION 2) THE LID MARGIN AS A TISSUE (margin_rim): each lid's free margin with its thickness (the intermarginal strip: wet lid
#     wiper, mucocutaneous junction, meibomian orifices, grey line; the rounded anterior border) and the tarsal plate's minimum thickness
#     behind it, its anterior surface the lid's own skin material (uv projected from the skin), a closed loop with FACE7's lid (it passes
#     under wherever the skin already stands that far from the eye); the lashes' roots moved onto the anterior border (shift_lashes)
#   - (EYE7_VERSION 4) THE SEAM WITH FACE7's LID: where the lid has a margin of its own (FACE7's lid tissue: the skin >= ANAT.margin.own[1] W
#     off the eye just beyond the posterior border) the rim takes the lid's own thickness, so it adds no second margin and only the wet strip,
#     the meniscus and the orifices show on FACE7's margin; on a knife-edge lid (< own[0] W) it is it 2's margin; smooth between
#   - THE KEY INTO THE CHAMBER: the cornea is transparent to shadow rays, so a lamp reaches the iris along the straight line through it, and
#     the iris's lit half is where the lid, the lashes and the opaque sclera at the limbus let the key in. (it 5 added MNEE shadow caustics to
#     bend that line at the cornea; c4's A/B, it 11's renders 1015-102124 / -102127, came out pixel-identical with and without it on all four
#     people, so it did nothing here and was deleted in c5 it 1: one transport. it 5's probe found the straight and the refracted key-lit
#     shares of the iris nearly equal on L08: 77 % vs 74 %.)
#   - (EYE7_VERSION 10) THE IRIS AS A LAYERED TRANSLUCENT TISSUE: a closed stromal slab (iris_mesh thick=...) with random-walk scattering
#     from the stroma's own coefficients under the border layer as an absorbing coat (materials7); the melanin's measured amount (model.js)
#   - (EYE7_VERSION 9) THE IRIS'S RELIEF IN GEOMETRY: the grown stroma network (iris.js: trabeculae ~0.03-0.055 mm in sleeve radius, the
#     collarette's arcades, crypts) is split at the mesh's own resolution: the mesh (1024 round x 192 radial, ~0.02-0.03 mm) is displaced by
#     the low-passed relief, the bump carries only the residual finer than it (iris_relief_split), so no slope is counted twice
#   - (EYE7_VERSION 6) THE GAZE: each eye FIXATES a target (by default the render's camera: a sitter looks at the lens), so the globe, the
#     cornea and the iris turn together about the globe's centre (the eye rotates about a point ~13 mm behind the corneal apex, close to
#     the globe's centre: Fry and Hill 1962, Am J Optom 39:581) by the rotation LISTING'S LAW gives from the primary position (the axis in
#     the head's frontal plane, no torsion: Tweed and Vilis 1990, Vision Res 30:111), each eye aimed at the target from its own centre (so
#     the vergence comes out of the geometry). (EYE7_VERSION 8) A HELD fixation is SHARED between eye and head: the eye takes up to the
#     eye-only range (17.5 deg, the middle of the cited 15-20: Bahill et al. 1975, Stahl 1999; the record's gaze.eyeOnlyDeg, model.js
#     GAZE / eyeHeadSplit, the same rule as the engine), the head the rest (Freedman 2008; Guitton and Volle 1987's ~40-50 deg is the
#     mechanical range, reached only transiently). The eye cannot turn the head: it takes its share, looking toward the target, and the
#     log's 'head_deg' is the head's share for whoever poses the head. The lids, the margin, the meniscus, the caruncle and the plica stay with the skin (the lid's
#     own following of vertical gaze is FACE7's form). Set at render time (aim_gaze, a render_pre handler, from scene.camera) as an
#     object transform, so the same build serves every camera. --gaze camera (default) | ahead | x,y,z (metres, world).
# Use: person_scene.build() calls build_eyes(M['eyes'], coll); run this file as a Blender --python script BEFORE render_person.py and it
# replaces that call with build_eyes7 when the export carries eyes.eye7 (videos/blender/eye7_job.py does this on the farm). As a module:
#   import eye7_cycles as E7; objs = E7.build_eyes7(M['eyes'], coll)
import os, sys, math, json
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
MM = 0.001
_LOG = {}
_GAZE = []    # (it 6) per eye: {'side', 'objs': [the globe's parts], 'cw': the globe's centre (world), 'R3': the head's rotation (world <- head)}
GAZE_LIMIT = math.radians(17.5)   # (EYE7_VERSION 8) the eye's share of a held fixation: the record's gaze.eyeOnlyDeg (model.js GAZE, eyeHeadSplit) overrides it


def listing_rotation(d_local, limit=GAZE_LIMIT):
    """(it 6) the eye's rotation (3x3, head frame: x across, y up, z forward) that turns the primary direction +z onto d_local by Listing's
    law (the axis z x d, in the frontal plane), the angle held to `limit`. Returns (R, angle_deg, clamped)"""
    d = np.asarray(d_local, float); n = np.linalg.norm(d)
    if n < 1e-9:
        return np.eye(3), 0.0, False
    d = d / n; z = np.array([0.0, 0.0, 1.0])
    ax = np.cross(z, d); sa = np.linalg.norm(ax); ang = math.atan2(sa, float(d @ z))
    if sa < 1e-9:
        return np.eye(3), 0.0, False
    ax /= sa; clamped = ang > limit; ang = min(ang, limit)   # the excess is the head's share (model.js eyeHeadSplit)
    K = np.array([[0, -ax[2], ax[1]], [ax[2], 0, -ax[0]], [-ax[1], ax[0], 0]])
    R = np.eye(3) + math.sin(ang) * K + (1 - math.cos(ang)) * (K @ K)
    return R, math.degrees(ang), clamped


def _argv(k, d=None):
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    return a[a.index('--' + k) + 1] if '--' + k in a else d


# ---------------------------------------------------------------- geometry helpers (pure numpy: mm, the eye's local frame)
def grid_tris(nr, nc):
    """triangles of an (nr x nc) vertex grid, row-major"""
    i, j = np.meshgrid(np.arange(nr - 1), np.arange(nc - 1), indexing='ij')
    a = (i * nc + j).ravel(); b = a + 1; c = a + nc; d = c + 1
    return np.concatenate([np.stack([a, c, b], 1), np.stack([b, c, d], 1)])


def orient(V, T, outward):
    """flip triangles whose normal points against outward (n,3 per triangle or a callable of the centroid)"""
    A, B, C = V[T[:, 0]], V[T[:, 1]], V[T[:, 2]]
    n = np.cross(B - A, C - A); o = outward((A + B + C) / 3) if callable(outward) else np.broadcast_to(np.asarray(outward, float), n.shape)
    bad = np.einsum('ij,ij->i', n, o) < 0
    T = T.copy(); T[bad] = T[bad][:, [0, 2, 1]]
    return T


class Eye:
    """the eye's surface in its local frame (mm; +z forward, origin = likeness/eyes.js' local origin, the bind centre c)"""
    def __init__(self, g, J):
        A = J['anatomy']
        self.side = g['side']; self.R = A['globeR']; self.rc = A['rc']; self.rl = A['rl']; self.rlv = A['rlv']
        self.zg = -g['inset'] * 1000.0                                  # the globe's centre: where FACE7 seated the lids
        self.zcc = self.zg + math.sqrt(self.R ** 2 - self.rl ** 2) - math.sqrt(self.rc ** 2 - self.rl ** 2)   # cornea meets globe at rl
        self.apex = self.zcc + self.rc
        self.acd = A['acd']; self.rootR = A['irisRootR']; self.rootDepth = A['irisRootDepth']
        self.back = 0.0

    def set_back(self, d):
        """move the whole eye back along its axis by d mm (the lids then rest on its true front surface, the cornea included)"""
        self.zg -= d; self.zcc -= d; self.apex -= d; self.back += d

    def z_sphere(self, rho):
        return self.zg + np.sqrt(np.maximum(0, self.R ** 2 - np.asarray(rho, float) ** 2))

    def z_surface(self, rho):
        rho = np.asarray(rho, float)
        zgl = self.zg + np.sqrt(np.maximum(0, self.R ** 2 - rho ** 2))
        zco = np.where(rho < self.rc, self.zcc + np.sqrt(np.maximum(0, self.rc ** 2 - rho ** 2)), -1e9)
        return np.maximum(zgl, zco)

    def limbus_rho(self, al):
        return 1.0 / np.sqrt((np.cos(al) / self.rl) ** 2 + (np.sin(al) / self.rlv) ** 2)

    def xy(self, rho, al):
        return self.side * rho * np.cos(al), rho * np.sin(al)


def sclera_mesh(E, NP=256, NT=110, th_end=math.radians(179)):
    al = np.linspace(0, 2 * np.pi, NP + 1)
    rl = E.limbus_rho(al)
    th0 = np.arcsin(np.clip(rl / E.R, 0, 0.99))                         # on the globe sphere about its centre
    t = np.linspace(0, 1, NT) ** 1.6
    TH = th0[None, :] + (th_end - th0[None, :]) * t[:, None]
    AL = np.broadcast_to(al[None, :], TH.shape)
    rho = E.R * np.sin(TH); x, y = E.xy(rho, AL)
    # the sclera rides over the cornea where the cornea stands in front (the vertical limbus: the overlap)
    z = np.where(TH < np.pi / 2, np.maximum(E.zg + E.R * np.cos(TH), E.z_surface(rho) + 0.012), E.zg + E.R * np.cos(TH))
    V = np.stack([x, y, z], -1).reshape(-1, 3)
    u = (AL / (2 * np.pi)).ravel(); v = np.clip(1 - TH.ravel() / math.radians(100), -1, 1)   # the map: v = theta / 100 deg (image rows top-down)
    T = orient(V, grid_tris(NT, NP + 1), lambda p: p - np.array([0, 0, E.zg]))
    return V, T, np.stack([u, v], 1)


def cornea_mesh(E, NP=256, NT=56, edge=6.0):
    al = np.linspace(0, 2 * np.pi, NP + 1); thc = math.asin(min(0.999, edge / E.rc))
    th = np.linspace(0, 1, NT) ** 1.3 * thc
    TH, AL = np.meshgrid(th, al, indexing='ij')
    rho = E.rc * np.sin(TH); x, y = E.xy(rho, AL); z = E.zcc + E.rc * np.cos(TH)
    V = np.stack([x, y, z], -1).reshape(-1, 3)
    T = orient(V, grid_tris(NT, NP + 1), lambda p: p - np.array([0, 0, E.zcc]))
    return V, T


def iris_relief_split(hmap, sig_u=None, sig_v=None, NP=1024, NR=192):
    """(EYE7_VERSION 9) the relief map (rows: s from the pupil margin, values 0..1 of the height range) split at the iris mesh's resolution:
    a Gaussian low-pass of about one mesh cell (periodic round the iris) for the geometry, the residual for the bump"""
    H, W = hmap.shape
    su = sig_u if sig_u is not None else 0.5 * W / NP          # in map pixels: half a mesh column, half a mesh row
    sv = sig_v if sig_v is not None else 0.5 * H / NR
    def blur1(a, sg, axis, wrap):
        if sg < 0.3:
            return a
        r = int(math.ceil(3 * sg)); k = np.exp(-0.5 * (np.arange(-r, r + 1) / sg) ** 2); k /= k.sum()
        pad = [(0, 0), (0, 0)]; pad[axis] = (r, r)
        ap = np.pad(a, pad, mode='wrap' if wrap else 'edge')
        out = np.zeros_like(a)
        for i, w in enumerate(k):
            sl = [slice(None), slice(None)]; sl[axis] = slice(i, i + a.shape[axis]); out += w * ap[tuple(sl)]
        return out
    lo = blur1(blur1(hmap.astype(np.float64), su, 1, True), sv, 0, False)
    return lo, hmap - lo


def iris_mesh(E, pupil_r, hmap, hlo, hhi, NP=1024, NR=192, thick=None):
    """the iris annulus from the pupil margin to the root, displaced by the relief map (rows: s from the pupil margin, top row = s 0),
    sampled bilinearly (periodic round the iris). (EYE7_VERSION 10) with thick (mm: the border layer + the stroma, the record's iris.sss.thick)
    a CLOSED SLAB: the displaced anterior surface, the posterior surface (the pigment epithelium's face: the cone thick behind the iris at
    rest, kept >= 0.04 mm behind the anterior one, so a crypt leaves a thin floor), and the pupil margin's and the root's walls (their own
    vertices, so smooth shading does not round the margin): the random walk's medium, light reaching the back is lost as the epithelium
    absorbs it"""
    al = np.linspace(0, 2 * np.pi, NP + 1); s = np.linspace(0, 1, NR)
    S, AL = np.meshgrid(s, al, indexing='ij')
    rho = pupil_r + S * (E.rootR - pupil_r); x, y = E.xy(rho, AL)
    H, W = hmap.shape
    fu = (AL / (2 * np.pi)) * W - 0.5; fv = np.clip(S * H - 0.5, 0, H - 1)
    u0 = np.floor(fu).astype(int); tu = fu - u0; v0 = np.clip(np.floor(fv).astype(int), 0, H - 1); tv = fv - v0
    u0w = u0 % W; u1w = (u0 + 1) % W; v1 = np.clip(v0 + 1, 0, H - 1)
    hv = (hmap[v0, u0w] * (1 - tu) + hmap[v0, u1w] * tu) * (1 - tv) + (hmap[v1, u0w] * (1 - tu) + hmap[v1, u1w] * tu) * tv
    h = hlo + hv * (hhi - hlo)
    cone = E.apex - E.acd - (E.rootDepth - E.acd) * S ** 1.2
    z = cone + h
    V = np.stack([x, y, z], -1).reshape(-1, 3)
    T = orient(V, grid_tris(NR, NP + 1), np.array([0.0, 0.0, 1.0]))
    UV = np.stack([(AL / (2 * np.pi)).ravel(), 1 - S.ravel()], 1)
    if not thick:
        return V, T, UV
    n = len(V); zb = np.minimum(cone - float(thick), z - 0.04)
    Vb = np.stack([x, y, zb], -1).reshape(-1, 3)
    Tb = orient(Vb, grid_tris(NR, NP + 1), np.array([0.0, 0.0, -1.0])) + n
    parts_V, parts_T, parts_UV = [V, Vb], [T, Tb], [UV, UV]
    off = 2 * n
    for row, sgn in ((0, -1.0), (NR - 1, 1.0)):              # the pupil margin's wall (faces the axis), the root's (faces out)
        a = np.stack([x[row], y[row], z[row]], -1); b = np.stack([x[row], y[row], zb[row]], -1)
        Vr = np.concatenate([a, b]); Tr = grid_tris(2, NP + 1) + off
        Tr = orient(np.concatenate(parts_V + [Vr]), Tr, lambda p, sg=sgn: sg * np.c_[p[:, 0], p[:, 1], np.zeros(len(p))])
        uvr = np.stack([al / (2 * np.pi), np.full(NP + 1, 1 - s[row])], 1)
        parts_V.append(Vr); parts_T.append(Tr); parts_UV.append(np.concatenate([uvr, uvr])); off += len(Vr)
    return np.concatenate(parts_V), np.concatenate(parts_T), np.concatenate(parts_UV)


# ---------------------------------------------------------------- the lid margin, read from the exported skin
def skin_field(E, P, NA=180, dR=0.1, RMAX=16.0):
    """the skin's frontmost z over the eye, per (2 degree, 0.1 mm) polar bin: P = the skin's triangle sample points in the eye frame (mm)"""
    x, y, z = P[:, 0] * E.side, P[:, 1], P[:, 2]
    rho = np.hypot(x, y); al = np.mod(np.arctan2(y, x), 2 * np.pi)
    k = (rho / dR).astype(int); a = (al / (2 * np.pi) * NA + 0.5).astype(int) % NA
    m = k < int(RMAX / dR)
    H = np.full((NA, int(RMAX / dR)), -1e9)
    np.maximum.at(H, (a[m], k[m]), z[m])
    return H


def skin_edge(E, H, dR=0.1):
    """the lid margin per angle: the skin's inner edge (the first radius at which the skin lies within 0.3 mm of, or in front of, the globe's
    SPHERE where FACE7 seated the lids; the hidden pocket folded back behind the globe is ignored), smoothed round the circle"""
    NA, NR = H.shape; rr = (np.arange(NR) + 0.5) * dR
    over = H - E.z_sphere(rr)[None, :] > -0.3
    m = np.where(over.any(1), over.argmax(1), NR - 1) * dR + dR * 0.5
    pad = np.concatenate([m[-4:], m, m[:4]])
    med = np.array([np.median(pad[i:i + 5]) for i in range(2, 2 + NA)])
    pad = np.concatenate([med[-2:], med, med[:2]])
    return np.convolve(pad, np.ones(5) / 5, 'valid')


def seat_depth(E, H, m, arcs, dR=0.1):
    """how far the eye's true front surface (the corneal bulge over the sphere) stands in front of the lid's edge: the lid must rest ON the
    eye, so the eye goes back by this much (FACE7 seats the lids on the sphere; the cornea stands up to ~1 mm in front of it)"""
    pen = np.array([float(E.z_surface(m[i])) - skin_z(E, H, i, m[i] + 0.05) for i in arcs])
    pen = pen[(pen > -1.0) & (pen < 2.0)]
    return max(0.0, float(np.percentile(pen, 75))) if len(pen) else 0.0


def skin_z(E, H, al_idx, rho, dR=0.1):
    """the skin's z near (angle bin, rho): the frontmost sample in the neighbouring bins (3 angles x 4 radii), searching outward"""
    NA, NR = H.shape; k = int(rho / dR)
    for kk in range(k, min(NR - 3, k + 15)):
        blk = H[[(al_idx - 1) % NA, al_idx % NA, (al_idx + 1) % NA], kk:kk + 4]
        if blk.max() > -1e8:
            return float(blk.max())
    return float(E.z_surface(rho))


def med5(a):
    a = np.asarray(a, float); pad = np.concatenate([a[:1], a[:1], a, a[-1:], a[-1:]])
    return np.array([np.median(pad[i:i + 5]) for i in range(len(a))])


def lower_upper_arcs(m, NA=180):
    """the angle bins of the lower lid (the long arc through 270 degrees) and the upper (through 90), canthus to canthus: the canthi are the
    two bins of greatest margin radius near 0 and 180 degrees"""
    deg = np.arange(NA) * 360.0 / NA
    def pick(lo, hi):
        idx = [i for i in range(NA) if (lo <= deg[i] <= hi) or (lo < 0 and deg[i] >= 360 + lo)]
        return max(idx, key=lambda i: m[i])
    tmp, nas = pick(-25, 25), pick(155, 205)
    low = [(nas + i) % NA for i in range(((tmp - nas) % NA) + 1)]
    up = [(tmp + i) % NA for i in range(((nas - tmp) % NA) + 1)]
    return tmp, nas, low, up


# ---------------------------------------------------------------- the lid margin as a tissue (EYE7_VERSION 2, iteration 2)
# The free margin of each lid is a body of its own thickness (model.js ANAT.margin; Wolff's ch. 2, Knop et al. 2011): the intermarginal strip W
# mm from the POSTERIOR border (square, resting on the eye in the tear film, where FACE7's lid meets the eye: the margin's PLACE stays FACE7's)
# out along the eye's normal to the rounded ANTERIOR border (the lash rows), its anterior surface running D mm on before it meets the lid's
# own skin. Across the strip from behind: the wet lid wiper, the mucocutaneous junction, the meibomian orifices, the grey line (the eye7
# mucosa material, uv v 0 -> 1); from the grey line forward the margin is skin (the body's own skin material, its uv projected from the
# nearest point of the skin, so the margin and the lid are one surface to the eye). A closed tube (the back face rests on the eye), so the
# subsurface walk is bounded by the tissue's real thickness. CLOSED LOOP WITH THE LID: the anterior surface is the margin's form blended INTO
# the skin's own height over the eye; where the skin already stands W proud (a lid with its tarsal thickness), the rim lies inside it and only
# the strip and the tear meniscus show. Nothing here moves the aperture.
def ray_r(E, th):
    """the eye's front surface: its distance from the globe's centre along the direction th (radians from the axis): the sclera's sphere
    or the corneal bulge (the ray from the globe's centre against the cornea's sphere, centre zcc, radius rc)"""
    th = np.asarray(th, float); b = np.cos(th) * (E.zg - E.zcc); c = (E.zg - E.zcc) ** 2 - E.rc ** 2
    tc = -b + np.sqrt(np.maximum(0.0, b * b - c))
    return np.maximum(E.R, np.where(np.sin(th) * tc < E.rc, tc, 0.0))


def skin_h(E, H, i, th):
    """the lid's skin over the eye at (angle bin i, theta): the FRONTMOST skin (the z-buffer H that finds the lid's margin, as a viewer in
    front of the face sees it, so a fold or the nose further out never stands in for the lid) above the eye's surface point, along the
    eye's normal (z height x cos theta)"""
    r_s = float(ray_r(E, th)); rho = r_s * math.sin(th); zs = E.zg + r_s * math.cos(th)
    return (skin_z(E, H, i, rho) - zs) * math.cos(th)


def margin_rim(E, Hz, m, arc, Wd, Ht, MA, inward, NA=180, dip=0.2, delta=0.3):
    """one lid's margin rim along its arc (canthus to canthus): -> V (mm, eye frame), T, per-triangle kind (0 mucosa, 1 skin), uv 'eye7'
    (u = arc length mm, v = 0 at the posterior border .. 1 at the grey line), per-vertex thickness (mm) and kind, the meniscus's (Q, K, Cc)
    in (rho, z), and the columns (angle bin, theta_Q, r_Q, Wq) for the lashes' roots"""
    rA, g, tap = MA['rA'], MA['grey'], MA['taper']
    o0, o1 = MA.get('own', [0.4, 0.75])
    n = len(arc); cols, prof_all, QK, OWN = [], [], [], []
    for q, i in enumerate(arc):
        f = math.sin(math.pi * (q + 0.5) / n) ** 0.5
        Wq = Wd * (tap + (1 - tap) * f)
        rq = m[i] - inward * (0.3 + 0.7 * f)
        zq = float(E.z_surface(rq)); thQ = math.atan2(rq, zq - E.zg); rQ = float(ray_r(E, thQ))
        # (EYE7_VERSION 4) THE SEAM WITH FACE7's LID: a lid that already has a margin of its own (FACE7's lid tissue: the skin standing
        # >= o1 W off the eye within 0.3-0.7 mm of the posterior border) keeps it: the rim takes the lid's own thickness there and only the
        # wet strip shows on it; a knife-edge lid (< o0 W) gets the rim's W (the margin as a tissue, it 2); smooth between
        hm = max(skin_h(E, Hz, i, thQ + sv / rQ) for sv in (0.3, 0.5, 0.7))
        x = min(1.0, max(0.0, (hm - o0 * Wq) / max(1e-6, (o1 - o0) * Wq))); tw = x * x * (3 - 2 * x)
        Wq = Wq * (1 - tw) + max(0.3, min(hm, Wq)) * tw; OWN.append(tw)
        ra = min(rA, 0.4 * Wq)
        # the profile (s along the eye from the posterior border, h over the eye's surface), a closed loop; kind 0 mucosa, 1 skin
        pr = [(0.0, -0.03, 0, 0.0)]
        for h in np.array([0.0, 0.33, 0.66, 1.0]) * g * Wq:
            pr.append((0.0, float(h), 0, float(h / (g * Wq))))
        for h in np.linspace(g * Wq, Wq - ra, 3)[1:]:
            pr.append((0.0, float(h), 1, 1.0))
        for ph in np.linspace(math.pi, math.pi / 2, 6)[1:]:
            pr.append((ra + ra * math.cos(ph), Wq - ra + ra * math.sin(ph), 1, 1.0))
        # the anterior surface over the tarsal plate: the lid's thickness T(s) from W at the margin to Ttop x W at the tarsus' upper border
        # (its height Ht at the centre, a crescent toward the canthi), then handing over to the lid's skin over Ld; wherever the skin
        # already stands at least that far from the eye the tissue passes under it (the closed loop with FACE7's lid)
        Hq = max(1.2, Ht * f); Tt = MA['Ttop'] * Wq; Ld = MA['Ld']; under = None
        for sv in np.concatenate([ra + (Hq - ra) * np.linspace(0, 1, 14)[1:] ** 1.3, Hq + Ld * np.linspace(0, 1, 5)[1:]]):
            if under is not None:   # gone under the lid's skin: the rest of the section closes there (zero-area faces)
                pr.append(under); continue
            if sv <= Hq + 1e-9:
                T = Wq + (Tt - Wq) * (sv - ra) / max(1e-6, Hq - ra)
            else:
                u = (sv - Hq) / Ld; T = Tt * (1 - u * u * (3 - 2 * u))
            hs = skin_h(E, Hz, i, thQ + sv / rQ)
            x = min(1.0, max(0.0, (hs - T + delta) / (2 * delta))); sg = x * x * (3 - 2 * x)
            pr.append((float(sv), float(T + (hs - dip - T) * sg), 1, 1.0))
            if sg > 0.999:
                under = pr[-1]
        # (EYES-FIX, 16 Oct) WHERE THE LID HAS ITS OWN MARGIN, THE RIM IS THE WET STRIP ONLY (the seam as it 4 stated it: "only the wet strip,
        # the meniscus and the orifices are mine there"). Until now the rim took the lid's thickness (Wq -> hm, the MAX of the skin's height
        # 0.3-0.7 mm out) but still built its own keratinised part on it: the anterior border's rounding and the surface over the tarsus,
        # 0.3-0.4 mm PROUD of the lid's own skin at the rounding (L08 lower lid: Wq 1.2-1.7 against the skin's 0.8-1.2 at 0.5 mm) and then
        # diving 0.2 mm under it: a second, smooth skin surface over the lid's own (a separate closed subsurface volume, no fine relief) with a
        # crease behind it, the pale rubbery rim of the 1015-203508 renders (labs/eyes/eye7_fissure.mjs --dump + the scratch python probe:
        # from the face camera the lower lid showed ~1 mm of the rim, two thirds of it this skin part). Now each keratinised point (kind 1)
        # lies at most `dip` under the lid's own skin at its place (read >= 0.3 mm out, as hm is), in proportion to the lid's own share tw:
        # tw 1 (FACE7's lid tissue carries the margin) leaves the wet strip from the posterior border to the lid's own skin; tw 0 (a knife
        # edge) is it 2's margin unchanged. The wall above the strip keeps at least the strip's top, so the section never folds.
        if tw > 0:
            for k_, (sv, h, kd, v) in enumerate(pr):
                if kd != 1:
                    continue
                cap = skin_h(E, Hz, i, thQ + max(sv, 0.3) / rQ) - dip
                floor_ = g * Wq if sv <= 0.0 else 0.05
                h2 = max(floor_, min(h, cap))
                pr[k_] = (sv, float(h + tw * (h2 - h)), kd, v)
        e = pr[-1][1]; hb = min(0.015, e - 0.02); D = pr[-1][0]
        for sv in (0.75 * D, 0.5 * D, 0.25 * D, 0.03):
            pr.append((sv, hb, 0, 0.0))
        prof_all.append(pr); cols.append((i, thQ, rQ, Wq))
        Q = np.array([rq, zq]); dn = np.array([math.sin(thQ), math.cos(thQ)])
        QK.append((Q, Q + dn * Wq, Q + dn * 0.5 * Wq))
    npf = len(prof_all[0])
    V, UV, TH, KV = [], [], [], []
    u_acc, prev = 0.0, None
    for q, (i, thQ, rQ, Wq) in enumerate(cols):
        al = i * 2 * np.pi / NA
        pQ = np.array([*E.xy(rQ * math.sin(thQ), al), E.zg + rQ * math.cos(thQ)])
        u_acc += 0.0 if prev is None else float(np.linalg.norm(pQ - prev)); prev = pQ
        for sv, h, kd, v in prof_all[q]:
            th = thQ + sv / rQ; r = float(ray_r(E, th)) + h
            x, y = E.xy(r * math.sin(th), al); V.append((x, y, E.zg + r * math.cos(th))); UV.append((u_acc, v)); TH.append(max(h, 0.02)); KV.append(kd)
    V = np.array(V); KV = np.array(KV)
    T, K, OUT = [], [], []
    for q in range(n - 1):
        a0, b0 = q * npf, (q + 1) * npf
        i, thQ = cols[q][0], cols[q][1]; al = i * 2 * np.pi / NA
        er = np.array([E.side * math.sin(thQ) * math.cos(al), math.sin(thQ) * math.sin(al), math.cos(thQ)])
        et = np.array([E.side * math.cos(thQ) * math.cos(al), math.cos(thQ) * math.sin(al), -math.sin(thQ)])
        for k in range(npf):
            k2 = (k + 1) % npf
            kd = 1 if (KV[a0 + k] == 1 and KV[a0 + k2] == 1) else 0
            # the loop runs clockwise in (s, h) (up the strip, out along the anterior face, back along the eye): outward is the left normal
            ds, dh = prof_all[q][k2][0] - prof_all[q][k][0], prof_all[q][k2][1] - prof_all[q][k][1]
            o = -dh * et + ds * er
            T += [(a0 + k, b0 + k, a0 + k2), (a0 + k2, b0 + k, b0 + k2)]; K += [kd, kd]; OUT += [o, o]
    T = np.array(T); K = np.array(K)
    cen = np.array([V[q * npf:(q + 1) * npf].mean(0) for q in range(n)])
    T = orient(V, T, np.array(OUT))
    # the canthal ends: a fan from the section's centre (the tissue's cut, inside the canthus), facing out of the tube's end
    caps, kc = [], []
    for q, q2 in ((0, 1), (n - 1, n - 2)):
        a0 = q * npf; cidx = len(V); V = np.vstack([V, cen[q]]); UV.append((UV[a0][0], 0.0)); TH.append(0.5); KV = np.append(KV, 0)
        Tc = np.array([(cidx, a0 + k, a0 + (k + 1) % npf) for k in range(npf)])
        # (EYES-FIX, 16 Oct) the cut shows the section's own layers: each fan triangle takes the kind of the profile segment it closes
        # (the wet strip mucosa, the keratinised margin and the surface over the tarsus the lid's skin). It was all mucosa: on L22 the
        # canthal ends showed as an orange fringe (the record's mucosa, L* 41, against her skin's ~20) where the lids meet.
        caps.append(orient(V, Tc, cen[q] - cen[q2])); kc += [1 if (KV[a0 + k] == 1 and KV[a0 + (k + 1) % npf] == 1) else 0 for k in range(npf)]
    T = np.vstack([T] + caps); K = np.concatenate([K, kc])
    # a section that closed under the skin leaves zero-area faces: drop them (Blender's mesh would keep them, but nothing needs them)
    A, Bv, C = V[T[:, 0]], V[T[:, 1]], V[T[:, 2]]; keep = np.linalg.norm(np.cross(Bv - A, C - A), axis=1) > 1e-7
    margin_rim.own = OWN   # (EYE7_VERSION 4) per column, the lid's own margin's share (1 = FACE7's lid carries it; 0 = the rim does)
    return V, T[keep], K[keep], np.array(UV), np.array(TH), KV, QK, cols


def meniscus(E, arc, QK, h_globe, h_lid, NA=180, ns=7):
    """a concave water surface in the corner between the eye and the lid's posterior margin: from the eye (h_globe mm inside the margin) to
    the margin (h_lid mm up its surface), bowing into the corner (a quadratic through the corner point: the liquid fills the corner)"""
    V, UVs = [], []
    n = len(arc)
    for q, (i, (Q, K, Cc)) in enumerate(zip(arc, QK)):
        al = i * 2 * np.pi / NA; f = math.sin(math.pi * (q + 0.5) / n) ** 0.5   # thinner toward the canthi
        ra = Q[0] - h_globe * (0.35 + 0.65 * f)
        A = np.array([ra, float(E.z_surface(ra)) + 0.004]); C = np.array([Q[0], float(E.z_surface(Q[0]))])
        dqk = (Cc - Q) / max(1e-6, np.linalg.norm(Cc - Q)); B = Q + dqk * h_lid * (0.35 + 0.65 * f) + np.array([0, 0.01])
        for t in np.linspace(0, 1, ns):
            p = (1 - t) ** 2 * A + 2 * t * (1 - t) * C + t * t * B
            x, y = E.xy(p[0], al); V.append((x, y, p[1])); UVs.append((q / max(1, n - 1), t))
    V = np.array(V); T = grid_tris(n, ns)
    T = orient(V, T, lambda p: p - np.array([0, 0, E.zg]))
    return V, T, np.array(UVs)


def ellipsoid(c, ax, R, nu=24, nv=16):
    """an ellipsoid at c with semi-axes ax along the columns of R (3x3)"""
    u = np.linspace(0, 2 * np.pi, nu, endpoint=False); v = np.linspace(0.04, np.pi - 0.04, nv)
    U, Vv = np.meshgrid(u, v, indexing='ij')
    p = np.stack([np.sin(Vv) * np.cos(U) * ax[0], np.sin(Vv) * np.sin(U) * ax[1], np.cos(Vv) * ax[2]], -1).reshape(-1, 3)
    P = c + p @ R.T
    T = []
    for i in range(nu):
        for j in range(nv - 1):
            a, b = i * nv + j, ((i + 1) % nu) * nv + j
            T += [(a, b, a + 1), (b, b + 1, a + 1)]
    P = np.vstack([P, c + R @ np.array([0, 0, ax[2]]), c - R @ np.array([0, 0, ax[2]])]); top, bot = len(P) - 2, len(P) - 1
    for i in range(nu):
        T += [(top, ((i + 1) % nu) * nv, i * nv), (bot, i * nv + nv - 1, ((i + 1) % nu) * nv + nv - 1)]
    T = orient(P, np.array(T), lambda q: q - c)
    return P, T


def canthus_parts(E, H, m, nas, J, NA=180):
    """the caruncle (an ellipsoid in the medial canthus, flush with the lids) and the plica (a crescent on the globe lateral to it)"""
    A = J['anatomy']; car, pl = A['caruncle'], A['plica']
    deg = np.arange(NA) * 2 * np.pi / NA
    xs = m * np.cos(deg); ys = m * np.sin(deg)                           # the aperture in the side-free frame (x < 0 nasal)
    xn = xs[nas]
    # the room the lids leave between the limbus and the medial canthus: anatomically ~4-5 mm of sclera, the plica ~2, the caruncle ~5;
    # where the aperture is shorter than that (FACE7's lids), the caruncle and plica take what is left after >= 2.5 mm of sclera
    room = max(0.0, -xn - E.rl - 2.5)
    cw = float(np.clip(room * 0.65, 1.8, car['w'])); pw = float(np.clip(room * 0.25, 0.8, pl['w']))
    car = {**car, 'w': cw, 'h': car['h'] * (0.6 + 0.4 * cw / 5.0), 'd': car['d'] * (0.6 + 0.4 * cw / 5.0)}; pl = {**pl, 'w': pw}
    def vspan(x0):
        near = np.abs(xs - x0) < 0.35
        if near.sum() < 2:
            return -0.8, 0.8
        yy = ys[near]; return float(yy.min()), float(yy.max())
    xc = xn + car['w'] * 0.42                                            # its centre inside the corner (x grows toward the axis)
    y0, y1 = vspan(xc); h = min(car['h'], max(1.2, 0.95 * (y1 - y0))); yc = 0.5 * (y0 + y1)
    rho = math.hypot(xc, yc); zc = float(E.z_surface(rho)) + 0.25
    nrm = np.array([xc * E.side, yc, zc - E.zg]); nrm /= np.linalg.norm(nrm)
    ex = np.array([E.side, 0.0, 0.0]); ex -= nrm * ex.dot(nrm); ex /= np.linalg.norm(ex); ey = np.cross(nrm, ex)
    Rm = np.stack([ex, ey, nrm], 1)
    Pc, Tc = ellipsoid(np.array([xc * E.side, yc, zc]), (car['w'] / 2, h / 2, car['d'] / 2), Rm)
    # the plica: a crescent band just lateral to the caruncle, on the globe
    xp = xc + car['w'] / 2 + pl['w'] / 2
    py0, py1 = vspan(xp); hh = max(1.0, min(pl['h'], (py1 - py0) * 1.05))
    V, UV = [], []
    for i, t in enumerate(np.linspace(-1, 1, 15)):
        yy = 0.5 * (py0 + py1) + t * hh / 2; bow = 0.45 * (1 - t * t)       # concave laterally
        for k, sx in enumerate(np.linspace(-0.5, 0.5, 5)):
            xx = xp + sx * pl['w'] - bow; r = math.hypot(xx, yy)
            z = float(E.z_surface(r)) + pl['t'] * (1 - (2 * sx) ** 2) + 0.01
            V.append((xx * E.side, yy, z)); UV.append((k / 4, i / 14))
    V = np.array(V); Tp = orient(V, grid_tris(15, 5), lambda q: q - np.array([0, 0, E.zg]))
    return (Pc, Tc), (V, Tp, np.array(UV)), {'caruncle': [round(xc, 2), round(yc, 2), round(cw, 2), round(h, 2)], 'plica_x': round(xp, 2), 'room': round(room, 2)}


def skin_points(body, Minv, c, k=10):
    """the body's triangles near an eye, sampled, in the eye's local frame (mm)"""
    me = body.data; n = len(me.vertices)
    co = np.empty(n * 3, dtype=np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3).astype(float)
    Mw = np.array(body.matrix_world); co = (Mw @ np.c_[co, np.ones(n)].T).T[:, :3]
    loc = (Minv @ np.c_[co, np.ones(n)].T).T[:, :3] - c                  # bind frame, then the eye's
    loc *= 1000.0
    me.calc_loop_triangles()
    li = np.empty(len(me.loop_triangles) * 3, dtype=np.int32)
    me.loop_triangles.foreach_get('vertices', li); T = li.reshape(-1, 3)
    near = (np.hypot(loc[:, 0], loc[:, 1]) < 22) & (loc[:, 2] > -8) & (loc[:, 2] < 30)
    T = T[near[T].all(1)]
    w = [(i / k, j / k) for i in range(k + 1) for j in range(k + 1 - i)]
    A, B, C = loc[T[:, 0]], loc[T[:, 1]], loc[T[:, 2]]
    return np.concatenate([A * a + B * b + C * (1 - a - b) for a, b in w])


def eye_parts(g, J, Pk, pupil_r, hp):
    """every part of one eye in its local frame (mm): [(material, V, T, UV)], and a report. Pk: the skin's sample points (mm, eye frame) or None"""
    e = Eye(g, J); A = J['anatomy']; hr = J.get('heightRange', [-0.4, 0.25]); parts = []; er = {'side': g['side']}
    lid = None
    if Pk is not None and len(Pk):
        H = skin_field(e, Pk); m = skin_edge(e, H)
        tmp, nas, low, up = lower_upper_arcs(m)
        d = seat_depth(e, H, m, low + up); e.set_back(min(1.2, d + 0.05))
        lid = (H, m, tmp, nas, low, up)
    er.update({'apex_mm': round(e.apex, 3), 'zg_mm': round(e.zg, 3), 'set_back_mm': round(e.back, 3)})
    er['_eye'] = e
    V, T, UV = sclera_mesh(e); parts.append(('sclera', V, T, UV))
    V, T = cornea_mesh(e); parts.append(('cornea', V, T, None))
    thick = ((J.get('iris') or {}).get('sss') or {}).get('thick') if (J.get('files') or {}).get('R', {}).get('irisSSS') or (J.get('files') or {}).get('L', {}).get('irisSSS') else None
    V, T, UV = iris_mesh(e, pupil_r, hp, hr[0], hr[1], thick=thick); parts.append(('iris', V, T, UV))   # (v10) a closed stromal slab when the maps carry it
    if lid is None:
        er['lids'] = 'no skin: no margin, meniscus, caruncle'; return parts, er
    H, m, tmp, nas, low, up = lid
    MA = A.get('margin') or {}
    if isinstance(MA.get('up'), dict):
        # (iteration 2) the lid margin as a tissue: the lower rim leaves the two canthal bins to the upper (no coincident sections)
        low = low[1:-1]
        Vr, Tr, Kr, UVr, THr, KVr, QKl, cl = margin_rim(e, H, m, low, MA['low']['W'], MA['low']['Ht'], MA, 0.25)
        own_lo = list(margin_rim.own)
        parts.append(('rim', {'lid': 'low', 'V': Vr, 'T': Tr, 'K': Kr, 'UV': UVr, 'TH': THr, 'KV': KVr, 'cols': cl}))
        Vr, Tr, Kr, UVr, THr, KVr, QKu, cu = margin_rim(e, H, m, up, MA['up']['W'], MA['up']['Ht'], MA, 0.15)
        parts.append(('rim', {'lid': 'up', 'V': Vr, 'T': Tr, 'K': Kr, 'UV': UVr, 'TH': THr, 'KV': KVr, 'cols': cu}))
        # what the rim added: the skin's own height over the eye 0.5 mm beyond the posterior border, against W (the closed loop with the lid)
        own_up = list(margin_rim.own)
        own = lambda cols: [round(skin_h(e, H, i, th + 0.5 / rq), 2) for (i, th, rq, w) in cols[len(cols) // 4: 3 * len(cols) // 4 + 1: max(1, len(cols) // 8)]]
        wq = lambda cols: [round(w, 2) for (i, th, rq, w) in cols[len(cols) // 4: 3 * len(cols) // 4 + 1: max(1, len(cols) // 8)]]
        er['rim'] = {'W_mm': {'up': MA['up']['W'], 'low': MA['low']['W']}, 'skin_h_0p5mm_up': own(cu), 'skin_h_0p5mm_low': own(cl),
                     'W_used_up': wq(cu), 'W_used_low': wq(cl), 'lid_own_share': {'up': round(float(np.mean(own_up)), 2), 'low': round(float(np.mean(own_lo)), 2)}}
        e.rim = {'up': cu, 'low': cl}
    else:
        raise ValueError('eye7_cycles: the record carries no ANAT.margin (up / low): an eye7 record older than EYE7_VERSION 2')
    V, T, UV = meniscus(e, low, QKl, A['tear']['lowH'], A['tear']['lowH'] * 0.8); parts.append(('tear', V, T, UV))
    V, T, UV = meniscus(e, up, QKu, A['tear']['upH'], A['tear']['upH']); parts.append(('tear', V, T, UV))
    (Pc, Tc), (Vp, Tp, UVp), cr = canthus_parts(e, H, m, nas, J)
    parts.append(('caruncle', Pc, Tc, None)); parts.append(('plica', Vp, Tp, UVp))
    er.update({'margin_mm': {'up': round(float(m[45]), 2), 'down': round(float(m[135]), 2), 'nasal': round(float(m[nas]), 2), 'temporal': round(float(m[tmp]), 2)},
               'canthi_deg': [tmp * 2, nas * 2], 'samples': int(len(Pk)), **{k: [float(x) for x in v] if isinstance(v, list) else float(v) for k, v in cr.items()}})
    return parts, er


# ---------------------------------------------------------------- the rim on the skin: its uv, material and the lashes' roots (Blender)
def skin_project(body, Pw, c_world, radius=0.03):
    """for each world point: the body's nearest surface point -> every uv layer of the body interpolated there, and that polygon's material
    index (so the margin's anterior surface is the lid's own skin to the shader: the same maps, the same material)"""
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    from mathutils.interpolate import poly_3d_calc
    me = body.data; Mw = np.array(body.matrix_world)
    co = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3).astype(float)
    Vw = (Mw @ np.c_[co, np.ones(len(co))].T).T[:, :3]
    npl = len(me.polygons); ls = np.empty(npl, np.int32); lt = np.empty(npl, np.int32); mi = np.empty(npl, np.int32)
    me.polygons.foreach_get('loop_start', ls); me.polygons.foreach_get('loop_total', lt); me.polygons.foreach_get('material_index', mi)
    li = np.empty(len(me.loops), np.int32); me.loops.foreach_get('vertex_index', li)
    near = np.linalg.norm(Vw - np.asarray(c_world), axis=1) < radius
    sel = [p for p in range(npl) if near[li[ls[p]:ls[p] + lt[p]]].any()]
    bvh = BVHTree.FromPolygons([Vector(v) for v in Vw], [list(li[ls[p]:ls[p] + lt[p]]) for p in sel], epsilon=0.0)
    uvs = {}
    for lay in me.uv_layers:
        a = np.empty(len(me.loops) * 2, np.float32); lay.data.foreach_get('uv', a); uvs[lay.name] = a.reshape(-1, 2)
    out = {k: np.zeros((len(Pw), 2), np.float32) for k in uvs}; mat = np.zeros(len(Pw), np.int32); miss = 0
    for j, p in enumerate(Pw):
        loc, nrm, idx, dist = bvh.find_nearest(Vector(p))
        if idx is None:
            miss += 1; continue
        pi = sel[idx]; loops = range(ls[pi], ls[pi] + lt[pi])
        w = poly_3d_calc([Vector(Vw[li[l]]) for l in loops], loc)
        for k, a in uvs.items():
            out[k][j] = sum(wk * a[l] for wk, l in zip(w, loops))
        mat[j] = mi[pi]
    return out, mat, {'polys_near': len(sel), 'missed': miss, 'layers': list(uvs)}


_RIMS = []   # per eye: (side, c, Mh, the Eye, {'up': columns, 'low': columns}) for the lashes' roots


def shift_lashes(hair):
    """HAIR7's lashes are rooted on the lid's edge where it meets the eye (lidMargins7: FACE7's margin, the posterior border); the lashes grow
    from the ANTERIOR border (the lash rows of the margin's anterior third). Each lash whose root lies on a rim's posterior border moves out
    along the eye's normal to 0.8 W (rigidly: its shape is HAIR7's). Returns counts."""
    rep = {'lashes': 0, 'moved': 0, 'objects': 0}
    if not _RIMS:
        return rep
    for ob in hair:
        if not ob.name.startswith('hair_lash'):
            continue
        cv = ob.data; npnt = len(cv.points); rep['objects'] += 1
        P = np.empty(npnt * 3, np.float32); cv.position_data.foreach_get('vector', P); P = P.reshape(-1, 3).astype(float)
        try:
            off = np.empty(len(cv.curves) + 1, np.int32); cv.curve_offset_data.foreach_get('value', off)
        except Exception:
            off = np.array([c.first_point_index for c in cv.curves] + [npnt], np.int32)
        Mo = np.array(ob.matrix_world); Moi = np.linalg.inv(Mo)
        roots = (Mo @ np.c_[P[off[:-1]], np.ones(len(off) - 1)].T).T[:, :3]
        best = []
        for side, c, Mh, e, rim in _RIMS:
            loc = ((np.linalg.inv(Mh) @ np.c_[roots, np.ones(len(roots))].T).T[:, :3] - c) * 1000.0
            best.append(np.linalg.norm(loc - np.array([0, 0, e.zg]), axis=1))
        which = np.argmin(np.array(best), 0)
        for k in range(len(roots)):
            rep['lashes'] += 1
            side, c, Mh, e, rim = _RIMS[which[k]]
            l = ((np.linalg.inv(Mh) @ np.r_[roots[k], 1.0])[:3] - c) * 1000.0
            x, y, z = l[0] * side, l[1], l[2]; rho = math.hypot(x, y); al = math.atan2(y, x) % (2 * np.pi)
            i = int(al / (2 * np.pi) * 180 + 0.5) % 180; th = math.atan2(rho, z - e.zg); r = math.hypot(rho, z - e.zg)
            col = None
            for lid in ('up', 'low'):
                for (ci, thQ, rQ, Wq) in rim.get(lid) or []:
                    if ci == i and abs(th - thQ) * rQ < 1.5:
                        col = (thQ, rQ, Wq)
            if col is None:
                continue
            h = r - float(ray_r(e, th)); d = 0.8 * col[2] - h
            if d <= 0 or h > 0.6 * col[2]:
                continue
            er_l = np.array([l[0], l[1], l[2] - e.zg]) / max(1e-9, r)          # the eye's normal at the root (the eye's frame, real x)
            dw = Mh[:3, :3] @ (er_l * d / 1000.0); do = Moi[:3, :3] @ dw
            P[off[k]:off[k + 1]] += do; rep['moved'] += 1
        cv.position_data.foreach_set('vector', P.astype(np.float32).ravel())
        cv.update_tag() if hasattr(cv, 'update_tag') else None
    return rep


# ---------------------------------------------------------------- materials
def _img(path, colorspace):
    import bpy
    im = bpy.data.images.load(path, check_existing=True)
    im.colorspace_settings.name = colorspace
    return im


def _pixels(im):
    a = np.empty(im.size[0] * im.size[1] * im.channels, dtype=np.float32); im.pixels.foreach_get(a)
    return a.reshape(im.size[1], im.size[0], im.channels)[::-1]           # top row first (the PNG's row order)


def _float_image(name, a):
    """a single-channel float image datablock from an array whose top row is first (as _pixels returns)"""
    import bpy
    H, W = a.shape
    im = bpy.data.images.new(name, W, H, alpha=False, float_buffer=True, is_data=True)
    px = np.zeros((H, W, 4), np.float32); px[..., 0] = px[..., 1] = px[..., 2] = a[::-1]; px[..., 3] = 1.0
    im.pixels.foreach_set(px.ravel()); im.colorspace_settings.name = 'Non-Color'
    return im


def materials7(J, d, side_key, iris_fine=None):
    import bpy
    import person_scene as PS
    f = J['files'][side_key]; mats = {}
    # ---- sclera: the grown map, subsurface with the sclera's short mean free path, the tear film coat; fading in over the limbal band
    m, nt, out = PS.mat_new('eye7_sclera_' + side_key); L = nt.links
    uv = nt.nodes.new('ShaderNodeUVMap'); uv.uv_map = 'eye7'
    tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = _img(os.path.join(d, f['sclera']), 'sRGB'); tx.extension = 'EXTEND'; tx.interpolation = 'Cubic'
    L.new(uv.outputs['UV'], tx.inputs['Vector'])
    p = nt.nodes.new('ShaderNodeBsdfPrincipled'); L.new(tx.outputs['Color'], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = 0.3
    p.inputs['Subsurface Weight'].default_value = 1.0; p.subsurface_method = 'RANDOM_WALK'
    p.inputs['Subsurface Radius'].default_value = (0.35, 0.25, 0.18); p.inputs['Subsurface Scale'].default_value = 0.001
    p.inputs['Coat Weight'].default_value = 1.0; p.inputs['Coat Roughness'].default_value = 0.04; p.inputs['Coat IOR'].default_value = 1.336
    tr = nt.nodes.new('ShaderNodeBsdfTransparent'); mx = nt.nodes.new('ShaderNodeMixShader')
    L.new(tx.outputs['Alpha'], mx.inputs['Fac']); L.new(tr.outputs['BSDF'], mx.inputs[1]); L.new(p.outputs['BSDF'], mx.inputs[2])
    gm = nt.nodes.new('ShaderNodeNewGeometry'); dk = nt.nodes.new('ShaderNodeBsdfDiffuse'); dk.inputs['Color'].default_value = (0.012, 0.005, 0.004, 1)
    ms = nt.nodes.new('ShaderNodeMixShader'); L.new(gm.outputs['Backfacing'], ms.inputs['Fac']); L.new(mx.outputs['Shader'], ms.inputs[1]); L.new(dk.outputs['BSDF'], ms.inputs[2])
    L.new(ms.outputs['Shader'], out.inputs['Surface']); mats['sclera'] = m
    # ---- cornea: one refracting surface, the keratometric index; transparent to shadow rays
    for nm, ior, rough in (('cornea', J['anatomy'].get('nCornea', 1.3375), 0.0),):
        m, nt, out = PS.mat_new('eye7_' + nm + '_' + side_key); L = nt.links
        g = nt.nodes.new('ShaderNodeBsdfPrincipled'); g.inputs['Base Color'].default_value = (1, 1, 1, 1); g.inputs['Transmission Weight'].default_value = 1.0
        g.inputs['IOR'].default_value = ior; g.inputs['Roughness'].default_value = rough
        t2 = nt.nodes.new('ShaderNodeBsdfTransparent'); lp = nt.nodes.new('ShaderNodeLightPath'); mx = nt.nodes.new('ShaderNodeMixShader')
        L.new(lp.outputs['Is Shadow Ray'], mx.inputs['Fac']); L.new(g.outputs['BSDF'], mx.inputs[1]); L.new(t2.outputs['BSDF'], mx.inputs[2])
        L.new(mx.outputs['Shader'], out.inputs['Surface']); mats[nm] = m
    # ---- iris: the relief finer than the mesh as a bump (EYE7_VERSION 9: iris_relief_split's residual, full strength: the mesh carries the
    # rest, so no slope is counted twice); in the aqueous: no specular of its own. (EYE7_VERSION 10) THE LAYERED TISSUE: the stroma a random-walk
    # medium (its walk albedo map, its distance per channel from its own mu_a and mu_s': the record's iris.sss.d, mm) in the closed slab
    # iris_mesh builds, under the border layer as an absorbing COAT (its tint map: the layer's diffuse transmittance IN AND OUT, since Cycles
    # applies Coat Tint once along the view as tint^(1/cos), svm/closure.h 4.2-5.2; its index over the aqueous, Gladstone and Dale:
    # iris.sss.coatIOR). (EYE7_VERSION 11) The maps carry the melanins' measured absorption and the blood of the grown vessels: no change here.
    # An export without the v10 maps keeps v9's opaque albedo.
    m, nt, out = PS.mat_new('eye7_iris_' + side_key); L = nt.links
    uv = nt.nodes.new('ShaderNodeUVMap'); uv.uv_map = 'eye7'
    sss = (J.get('iris') or {}).get('sss') or {}
    layered = bool(f.get('irisSSS') and f.get('irisTint') and sss.get('d'))
    ta = nt.nodes.new('ShaderNodeTexImage'); ta.image = _img(os.path.join(d, f['irisSSS'] if layered else f['iris']), 'sRGB'); ta.interpolation = 'Cubic'
    th = nt.nodes.new('ShaderNodeTexImage'); th.interpolation = 'Cubic'
    th.image = iris_fine if iris_fine is not None else _img(os.path.join(d, f['irisH']), 'Non-Color')
    L.new(uv.outputs['UV'], ta.inputs['Vector']); L.new(uv.outputs['UV'], th.inputs['Vector'])
    p = nt.nodes.new('ShaderNodeBsdfPrincipled'); L.new(ta.outputs['Color'], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = 0.6; p.inputs['Specular IOR Level'].default_value = 0.0
    hr = J.get('heightRange', [-0.4, 0.25])
    bp = nt.nodes.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = 1.0 if iris_fine is not None else 0.5
    bp.inputs['Distance'].default_value = (hr[1] - hr[0]) * MM
    L.new(th.outputs['Color'], bp.inputs['Height']); L.new(bp.outputs['Normal'], p.inputs['Normal'])
    if layered:
        p.subsurface_method = 'RANDOM_WALK'
        p.inputs['Subsurface Weight'].default_value = 1.0
        p.inputs['Subsurface Radius'].default_value = tuple(float(v) for v in sss['d'][:3])
        p.inputs['Subsurface Scale'].default_value = MM
        # (the stroma in the aqueous is index matched: for RANDOM_WALK Cycles 5.2 takes the interface index from the Principled's own eta, which
        # 'Specular IOR Level' 0 above drives to 1.0 (bssrdf_setup clamps it to 1.01); the 'Subsurface IOR' socket is read only by
        # RANDOM_WALK_SKIN, so it is not set: the it 13 critic's reading of the 5.2.0 source)
        tt = nt.nodes.new('ShaderNodeTexImage'); tt.image = _img(os.path.join(d, f['irisTint']), 'sRGB'); tt.interpolation = 'Cubic'
        L.new(uv.outputs['UV'], tt.inputs['Vector'])
        p.inputs['Coat Weight'].default_value = 1.0; p.inputs['Coat Roughness'].default_value = 0.5
        p.inputs['Coat IOR'].default_value = max(1.0, float(sss.get('coatIOR', 1.028)))
        L.new(tt.outputs['Color'], p.inputs['Coat Tint'])
        if 'Coat Normal' in p.inputs:
            L.new(bp.outputs['Normal'], p.inputs['Coat Normal'])
    _LOG.setdefault('iris_material', {})[side_key] = {'layered': layered, 'd_mm': sss.get('d'), 'thick_mm': sss.get('thick'), 'coatIOR': sss.get('coatIOR'),
                                                      'pig': (J.get('iris') or {}).get('pig')}
    print('eye7_cycles iris:', json.dumps({side_key: _LOG['iris_material'][side_key]}), flush=True)
    L.new(p.outputs['BSDF'], out.inputs['Surface']); mats['iris'] = m
    # ---- tear meniscus: a water surface on tissue (Fresnel reflection, the tissue seen through it; shadow rays pass)
    m, nt, out = PS.mat_new('eye7_tear_' + side_key); L = nt.links
    gl = nt.nodes.new('ShaderNodeBsdfGlossy'); gl.inputs['Roughness'].default_value = 0.015; gl.inputs['Color'].default_value = (1, 1, 1, 1)
    tr = nt.nodes.new('ShaderNodeBsdfTransparent'); fr = nt.nodes.new('ShaderNodeFresnel'); fr.inputs['IOR'].default_value = 1.336
    mx = nt.nodes.new('ShaderNodeMixShader'); L.new(fr.outputs['Fac'], mx.inputs['Fac']); L.new(tr.outputs['BSDF'], mx.inputs[1]); L.new(gl.outputs['BSDF'], mx.inputs[2])
    lp = nt.nodes.new('ShaderNodeLightPath'); m2 = nt.nodes.new('ShaderNodeMixShader'); t2 = nt.nodes.new('ShaderNodeBsdfTransparent')
    L.new(lp.outputs['Is Shadow Ray'], m2.inputs['Fac']); L.new(mx.outputs['Shader'], m2.inputs[1]); L.new(t2.outputs['BSDF'], m2.inputs[2])
    L.new(m2.outputs['Shader'], out.inputs['Surface']); mats['tear'] = m
    # ---- mucosa: the wet lid margin (orifices along it; its outer edge fading into the skin), the caruncle, the plica
    col = J['colours']
    def mucosa(nm, rgb, sss, alpha=None, orifices=False, bump=0.0, to_skin=None, layout=None):
        m, nt, out = PS.mat_new('eye7_' + nm + '_' + side_key); L = nt.links
        p = nt.nodes.new('ShaderNodeBsdfPrincipled'); p.inputs['Base Color'].default_value = tuple(rgb) + (1,)
        if to_skin is not None:   # v = 0 the wet mucosa at the globe, v = 1 the lid's skin at the lash line (the mucocutaneous junction between)
            uvs = nt.nodes.new('ShaderNodeUVMap'); uvs.uv_map = 'eye7'; sxs = nt.nodes.new('ShaderNodeSeparateXYZ'); L.new(uvs.outputs['UV'], sxs.inputs['Vector'])
            fs = nt.nodes.new('ShaderNodeMapRange'); fs.interpolation_type = 'SMOOTHSTEP'; fs.inputs['From Min'].default_value = 0.45; fs.inputs['From Max'].default_value = 0.9
            if layout:   # the mucocutaneous junction: wet conjunctiva behind it, the keratinised margin in front (to the grey line, v 1)
                fs.inputs['From Min'].default_value = layout['mcj'] - 0.08; fs.inputs['From Max'].default_value = layout['mcj'] + 0.12
            L.new(sxs.outputs['Y'], fs.inputs['Value'])
            mc = nt.nodes.new('ShaderNodeMix'); mc.data_type = 'RGBA'; PS.mx_in(mc, 'A').default_value = tuple(rgb) + (1,); PS.mx_in(mc, 'B').default_value = tuple(to_skin) + (1,)
            mc.name = 'eye7_to_skin'   # (EYES-FIX) strip_skin links the lid's own skin albedo here once the rim carries the skin's uv
            L.new(fs.outputs['Result'], PS.mx_in(mc, 'Factor')); L.new(PS.mx_out(mc), p.inputs['Base Color'])
            rr = nt.nodes.new('ShaderNodeMapRange'); rr.inputs['To Min'].default_value = 0.3; rr.inputs['To Max'].default_value = 0.5; L.new(fs.outputs['Result'], rr.inputs['Value'])
            L.new(rr.outputs['Result'], p.inputs['Roughness'])
        p.inputs['Roughness'].default_value = 0.35
        p.inputs['Subsurface Weight'].default_value = 1.0; p.subsurface_method = 'RANDOM_WALK'
        p.inputs['Subsurface Radius'].default_value = sss; p.inputs['Subsurface Scale'].default_value = 0.001
        p.inputs['Coat Weight'].default_value = 1.0; p.inputs['Coat Roughness'].default_value = 0.06; p.inputs['Coat IOR'].default_value = 1.336
        shader = p.outputs['BSDF']
        if orifices or bump:
            uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'eye7'
        if orifices:   # meibomian orifices ~1 mm apart along the margin (u = arc length, mm), in the band's outer half
            sx = nt.nodes.new('ShaderNodeSeparateXYZ'); L.new(uvn.outputs['UV'], sx.inputs['Vector'])
            cx = nt.nodes.new('ShaderNodeCombineXYZ'); L.new(sx.outputs['X'], cx.inputs['X'])
            mv = nt.nodes.new('ShaderNodeMath'); mv.operation = 'MULTIPLY'; mv.inputs[1].default_value = 0.8; L.new(sx.outputs['Y'], mv.inputs[0]); L.new(mv.outputs[0], cx.inputs['Y'])
            vo = nt.nodes.new('ShaderNodeTexVoronoi'); vo.inputs['Scale'].default_value = 1.0 / J['anatomy']['margin'].get('orifices', 1.0)
            vo.inputs['Randomness'].default_value = 0.35; L.new(cx.outputs['Vector'], vo.inputs['Vector'])
            cr = nt.nodes.new('ShaderNodeMapRange'); cr.inputs['From Min'].default_value = 0.06; cr.inputs['From Max'].default_value = 0.16
            L.new(vo.outputs['Distance'], cr.inputs['Value'])
            band = nt.nodes.new('ShaderNodeMapRange'); band.inputs['From Min'].default_value = 0.35; band.inputs['From Max'].default_value = 0.55; L.new(sx.outputs['Y'], band.inputs['Value'])
            if layout:   # one row, just in front of the junction: a band round v = orif
                band.inputs['From Min'].default_value = layout['orif'] - 0.12; band.inputs['From Max'].default_value = layout['orif'] - 0.04
                b2 = nt.nodes.new('ShaderNodeMapRange'); b2.inputs['From Min'].default_value = layout['orif'] + 0.04; b2.inputs['From Max'].default_value = layout['orif'] + 0.12
                b2.inputs['To Min'].default_value = 1.0; b2.inputs['To Max'].default_value = 0.0; L.new(sx.outputs['Y'], b2.inputs['Value'])
                bm = nt.nodes.new('ShaderNodeMath'); bm.operation = 'MULTIPLY'; L.new(band.outputs['Result'], bm.inputs[0]); L.new(b2.outputs['Result'], bm.inputs[1])
                band = bm
            inv = nt.nodes.new('ShaderNodeMath'); inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 1.0; L.new(cr.outputs['Result'], inv.inputs[1])
            dot = nt.nodes.new('ShaderNodeMath'); dot.operation = 'MULTIPLY'; L.new(inv.outputs[0], dot.inputs[0]); L.new(band.outputs[0], dot.inputs[1])
            bp = nt.nodes.new('ShaderNodeBump'); bp.invert = True; bp.inputs['Strength'].default_value = 0.6; bp.inputs['Distance'].default_value = 0.00004
            L.new(dot.outputs[0], bp.inputs['Height']); L.new(bp.outputs['Normal'], p.inputs['Normal'])
        elif bump:
            nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 2500.0; nz.inputs['Detail'].default_value = 3
            tc = nt.nodes.new('ShaderNodeTexCoord'); L.new(tc.outputs['Object'], nz.inputs['Vector'])
            bp = nt.nodes.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = bump; bp.inputs['Distance'].default_value = 0.0001
            L.new(nz.outputs['Fac'], bp.inputs['Height']); L.new(bp.outputs['Normal'], p.inputs['Normal'])
        if alpha is not None:   # the outer edge fades into the skin (v = 0 at the globe, 1 at the outer edge)
            uva = nt.nodes.new('ShaderNodeUVMap'); uva.uv_map = 'eye7'; sx2 = nt.nodes.new('ShaderNodeSeparateXYZ'); L.new(uva.outputs['UV'], sx2.inputs['Vector'])
            fa = nt.nodes.new('ShaderNodeMapRange'); fa.inputs['From Min'].default_value = alpha[0]; fa.inputs['From Max'].default_value = alpha[1]
            fa.inputs['To Min'].default_value = 1.0; fa.inputs['To Max'].default_value = 0.0; L.new(sx2.outputs['Y'], fa.inputs['Value'])
            tr = nt.nodes.new('ShaderNodeBsdfTransparent'); mx = nt.nodes.new('ShaderNodeMixShader')
            L.new(fa.outputs['Result'], mx.inputs['Fac']); L.new(tr.outputs['BSDF'], mx.inputs[1]); L.new(shader, mx.inputs[2]); shader = mx.outputs['Shader']
        L.new(shader, out.inputs['Surface']); return m
    MA = J['anatomy'].get('margin') or {}
    if isinstance(MA.get('up'), dict):   # (iteration 2) the strip's own layout: v = fraction of the way from the posterior border to the grey line
        lay = {'mcj': MA['mcj'] / MA['grey'], 'orif': MA['orif'] / MA['grey']}
    else:
        lay = None
    mats['margin'] = mucosa('margin', col['margin'], (0.6, 0.25, 0.15), orifices=True, to_skin=col.get('skin', col['margin']), layout=lay)
    mats['caruncle'] = mucosa('caruncle', col['caruncle'], (0.9, 0.35, 0.2), bump=0.15)
    mats['plica'] = mucosa('plica', col['plica'], (0.5, 0.25, 0.15), alpha=None)
    return mats


# ---------------------------------------------------------------- the build
def strip_skin(mat, bm, matv):
    """(EYES-FIX, 16 Oct) the margin strip's keratinised part (from the mucocutaneous junction to the grey line, materials7's 'to_skin' end)
    is the LID'S OWN SKIN: the body's albedo atlas, sampled at the rim's projected uv (skin_project), in place of the record's colours.skin.
    That constant came from the eye record's skin spectrum of the person's base pigments: SKIN7 renders the lid with its own zones and
    tissue column (the under-eye's blood, the lid site), so the strip's skin end did not match the lid it joins: paler and bluer on L08
    (record linear 0.51 / 0.33 / 0.25 against the cast hex's 0.52 / 0.28 / 0.15), lighter on L22 (L* 28.9 against 20.3), the band read as a
    separate pale or orange rim. The wet mucosa behind the junction keeps the record's mucosa colour. Once per material (both rims of an
    eye share it); the body material is the one the rim's own skin faces project to most."""
    if mat is None or not mat.use_nodes or not bm or matv is None or not len(matv):
        return 'no body material'
    nt = mat.node_tree; mc = nt.nodes.get('eye7_to_skin')
    if mc is None:
        return 'no to_skin mix'
    if mat.get('eye7_strip_skin'):
        return mat['eye7_strip_skin']
    k = int(np.bincount(np.asarray(matv, int)).argmax()); bmat = bm[k] if k < len(bm) else None
    img, uvname = None, 'atlas'
    if bmat is not None and bmat.use_nodes:
        for n in bmat.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image is not None and 'skin_albedo' in (n.image.name + ' ' + n.image.filepath):
                img = n.image
                lk = n.inputs['Vector'].links
                if lk and lk[0].from_node.type == 'UVMAP' and lk[0].from_node.uv_map:
                    uvname = lk[0].from_node.uv_map
                break
    if img is None:
        mat['eye7_strip_skin'] = 'no skin albedo image: the record colour kept'
        return mat['eye7_strip_skin']
    uv = nt.nodes.new('ShaderNodeUVMap'); uv.uv_map = uvname
    tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = img; tx.interpolation = 'Linear'
    nt.links.new(uv.outputs['UV'], tx.inputs['Vector'])
    import person_scene as PS
    nt.links.new(tx.outputs['Color'], PS.mx_in(mc, 'B'))
    mat['eye7_strip_skin'] = f'{bmat.name}: {img.name} ({uvname})'
    return mat['eye7_strip_skin']


def build_eyes7(E, coll):
    import bpy
    from person_io import build_mesh, object_for, add_corner_uv
    J = E['eye7']
    d = J.get('absdir') or os.path.join(_argv('export', '.'), J.get('dir', 'eye7'))
    Mh = np.array(E['headMatrix'], dtype=float).reshape(4, 4).T; Minv = np.linalg.inv(Mh)
    stage = (_argv('stage') or _argv('light') or 'studio').split('@')[0]
    pupil_d = J['pupil'].get(stage, J['pupil'].get('studio', 3.0)); pr = pupil_d / 2
    global GAZE_LIMIT
    GAZE_LIMIT = math.radians(float((J.get('gaze') or {}).get('eyeOnlyDeg', math.degrees(GAZE_LIMIT))))   # (v8) one rule with the engine
    body = bpy.data.objects.get('body')
    objs, rep = [], {'stage': stage, 'pupil_mm': pupil_d, 'eyes': []}
    for g in E['globes']:
        side_key = 'R' if g['side'] > 0 else 'L'
        if side_key not in J['files']:
            continue
        him = _img(os.path.join(d, J['files'][side_key]['irisH']), 'Non-Color'); hp = _pixels(him)[:, :, 0]
        h_lo, h_fine = iris_relief_split(hp)                    # (v9) the mesh takes the low-pass, the bump the residual
        mats = materials7(J, d, side_key, _float_image(f'eye7_irisFine_{side_key}', h_fine.astype(np.float32)))
        c = np.array(g['c'])
        Pk = skin_points(body, Minv, c) if body is not None else None
        parts, er = eye_parts(g, J, Pk, pr, h_lo)
        e = er.pop('_eye', None)
        if getattr(e, 'rim', None):
            _RIMS.append((g['side'], c, Mh, e, e.rim))
        gz = {'side': g['side'], 'objs': [], 'cw': (Mh @ np.r_[c + np.array([0.0, 0.0, e.zg * MM]), 1.0])[:3] if e is not None else None,
              'R3': None}
        A3 = Mh[:3, :3]; U, _s, Vt = np.linalg.svd(A3); gz['R3'] = U @ Vt     # the head's rotation without its scale
        for nm, *rest in parts:
            if nm == 'rim':
                rp = rest[0]; V, T = rp['V'], rp['T']
                Pw = (Mh @ np.c_[V * MM + c, np.ones(len(V))].T).T[:, :3]
                me = build_mesh(f'eye7{g["side"]:+d}_rim_{rp["lid"]}', Pw, np.asarray(T), smooth=True)
                add_corner_uv(me, 'eye7', np.asarray(rp['UV'])[np.asarray(T).ravel()])
                me.materials.append(mats['margin'])
                bm = list(body.data.materials) if body is not None else []
                for m_ in bm:
                    me.materials.append(m_)
                fi = np.zeros(len(T), np.int32)
                if bm and len(me.polygons) == len(T):
                    cw = (Mh @ np.r_[c + np.array([0.0, 0.0, e.zg * MM]), 1.0])[:3]
                    uvp, matv, pinfo = skin_project(body, Pw, cw)
                    for k_, a_ in uvp.items():
                        add_corner_uv(me, k_, a_[np.asarray(T).ravel()])
                    fi = np.where(np.asarray(rp['K']) == 1, 1 + matv[np.asarray(T)[:, 0]], 0).astype(np.int32)
                    er.setdefault('rim_proj', {})[rp['lid']] = pinfo
                    try:
                        er.setdefault('strip_skin', {})[rp['lid']] = strip_skin(mats['margin'], bm, matv)
                    except Exception as ex_:   # the strip keeps the record's colour; the eye is built whatever happens here
                        er.setdefault('strip_skin', {})[rp['lid']] = 'failed: ' + repr(ex_)[:160]
                if len(me.polygons) == len(T):
                    me.polygons.foreach_set('material_index', fi)
                else:
                    er.setdefault('rim_warn', []).append(f'{rp["lid"]}: {len(me.polygons)} polygons for {len(T)} triangles: one material')
                if len(me.vertices) == len(rp['TH']):   # the tissue's own thickness for LIGHT5's subsurface scale (the skin material reads 'l5_thick')
                    at = me.attributes.new('l5_thick', 'FLOAT', 'POINT'); at.data.foreach_set('value', (np.asarray(rp['TH']) * MM).astype(np.float32))
                objs.append(object_for(me, collection=coll))
                continue
            V, T, UV = rest
            Pw = (Mh @ np.c_[V * MM + c, np.ones(len(V))].T).T[:, :3]
            me = build_mesh(f'eye7{g["side"]:+d}_{nm}', Pw, np.asarray(T), smooth=True)
            if UV is not None:
                add_corner_uv(me, 'eye7', np.asarray(UV)[np.asarray(T).ravel()])
            me.materials.append(mats[nm])
            ob = object_for(me, collection=coll); objs.append(ob)
            if nm in ('sclera', 'cornea', 'iris'):
                gz['objs'].append(ob)
        rep['eyes'].append(er)
        if gz['cw'] is not None and gz['objs']:
            _GAZE.append(gz)
    print('eye7_cycles:', json.dumps(rep), flush=True)
    _LOG.update(rep)
    return objs


try:
    from bpy.app.handlers import persistent as _persistent
except ImportError:
    _persistent = lambda f: f


_GAZE_REP = {}
@_persistent
def aim_gaze(*_a):
    """(it 6) each eye turned to fixate the target (the scene's camera unless --gaze says otherwise) by Listing's law about the globe's
    centre, as an absolute object transform (idempotent: every render recomputes it from the build's pose). Prints once per state"""
    import bpy
    from mathutils import Matrix
    if not _GAZE:
        return
    mode = (_argv('gaze') or os.environ.get('EYE7_GAZE') or 'camera').strip().lower()
    tgt = None
    if mode == 'camera':
        cam = bpy.context.scene.camera
        tgt = np.array(cam.matrix_world.translation) if cam is not None else None
    elif mode not in ('ahead', 'none', 'off'):
        try:
            tgt = np.array([float(v) for v in mode.split(',')][:3])
        except ValueError:
            tgt = None
    rep = {'gaze': mode, 'eyes': []}
    for gz in _GAZE:
        cw = np.asarray(gz['cw'], float); R3 = gz['R3']
        if tgt is None:
            Rl, ang, cl, tdeg = np.eye(3), 0.0, False, 0.0
        else:
            dl = R3.T @ (tgt - cw)
            Rl, ang, cl = listing_rotation(dl, GAZE_LIMIT)
            tdeg = math.degrees(math.atan2(math.hypot(dl[0], dl[1]), dl[2]))
        Rw = R3 @ Rl @ R3.T
        M = np.eye(4); M[:3, :3] = Rw; M[:3, 3] = cw - Rw @ cw
        for ob in gz['objs']:
            try:
                ob.matrix_world = Matrix(M.tolist())
            except ReferenceError:
                continue
        fwd = Rl @ np.array([0.0, 0.0, 1.0])
        rep['eyes'].append({'side': gz['side'], 'deg': round(ang, 2), 'clamped': bool(cl), 'head_deg': round(max(0.0, tdeg - ang), 2),
                            'yaw_deg': round(math.degrees(math.atan2(fwd[0], fwd[2])), 2), 'pitch_deg': round(math.degrees(math.asin(max(-1, min(1, fwd[1])))), 2)})
    sig = json.dumps(rep, sort_keys=True)
    if _GAZE_REP.get('sig') != sig:
        _GAZE_REP['sig'] = sig
        print('eye7_cycles gaze:', sig, flush=True)
        _LOG['gaze'] = rep


def install():
    """replace person_scene.build_eyes with build_eyes7 for exports that carry eyes.eye7 (the others keep the old eye)"""
    import person_scene as PS
    old = PS.build_eyes
    if getattr(old, '_eye7', False):
        return
    def build_eyes(E, coll):
        if E.get('eye7'):
            return build_eyes7(E, coll)
        return old(E, coll)
    build_eyes._eye7 = True
    PS.build_eyes = build_eyes
    old_build = PS.build
    def build(*a, **k):
        _RIMS.clear(); _GAZE.clear()
        pp, out = old_build(*a, **k)
        if _RIMS:
            try:
                rep = shift_lashes(out.get('hair') or [])
            except Exception as ex:
                rep = {'error': repr(ex)[:300]}
            print('eye7_cycles lashes:', json.dumps(rep), flush=True)
        return pp, out
    PS.build = build
    import bpy
    if aim_gaze not in bpy.app.handlers.render_pre:
        bpy.app.handlers.render_pre.append(aim_gaze)
    print('eye7_cycles: installed (person_scene.build_eyes -> build_eyes7 when the export carries eyes.eye7; the gaze aimed at render time)', flush=True)


if __name__ == '__main__':
    try:
        import bpy  # noqa: F401
        install()
    except ImportError:
        pass
