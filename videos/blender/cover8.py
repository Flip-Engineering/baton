# CLOTH8 (round 7, c2, 8 Oct): SHRINK, DON'T DROP. The covered skin of a dressed person KEPT and pushed INWARD, in place of the v6 drop.
# The cause it answers (the orchestrator's 08:04 PRIORITY; gpu_cycles/defects/DEFECTS.md): person_scene.build() dropped every body face the
# bake's skin_cover mask calls covered, and the skin material cut every covered texel to a Transparent BSDF ('as in the engine': hero.js
# hCover discards the same skin). Wherever a garment stands off the body, crumples or opens (collars, elbows, cuffs, hems, the arm-torso gap,
# the tuck), the eye then looks through the opening into an EMPTY SHELL (the far side's inside faces, unlit): the black voids. Real garments
# show skin, in shadow, in a gap. Here every covered vertex goes in along its own normal by d (3-6 mm), feathered from 0 at the cover mask's
# edge to d over `feather` of surface distance (so the drawn skin at the mask's edge does not step), which keeps the old reason for the drop
# (no skin through tight cloth: the skin now lies d under where it was) and fills every gap with skin.
# Pure numpy (no bpy): person_scene.build() calls options() and shrink(); a box without Blender tests it (labs/clothing2/cloth8/cover8_test.py).
#   options: the export's makePerson options carry "cover8" (true or {d, feather, ease, minIsland}: person_job.py --popts '{"cover8": {...}}'),
#   overridden by the environment's COVER8 (JSON: '{}' on with the defaults, '{"d": 0.006}', '{"off": 1}' off): cover8_job.py's A/B.
#   Absent: None, and person_scene builds exactly as before (the drop and the cut).
import os, json, time
import numpy as np

DEFAULT = {'d': 0.004, 'feather': 0.02, 'ease': 'out', 'minIsland': 40}
KEYS = tuple(DEFAULT)


def options(popts=None, env=None):
    """None (off: the v6 drop) or the options dict"""
    o = None
    c = (popts or {}).get('cover8')
    if c:
        o = dict(DEFAULT)
        if isinstance(c, dict):
            o.update({k: c[k] for k in KEYS if k in c})
    env = os.environ.get('COVER8') if env is None else env
    if env:
        try:
            e = json.loads(env)
        except Exception as ex:
            print('cover8: COVER8 unreadable', repr(ex), flush=True); e = None
        if isinstance(e, dict):
            if e.get('off'):
                return None
            o = dict(o or DEFAULT); o.update({k: e[k] for k in KEYS if k in e})
    return o


def _edges(tri):
    e = np.concatenate([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]]); e.sort(1)
    return np.unique(e, axis=0)


def _components(n, mask, e):
    """labels (n,) of the connected components of the vertices where mask is true (edges e with both ends in the mask); -1 elsewhere"""
    lab = np.where(mask, np.arange(n), -1)
    ue = e[mask[e[:, 0]] & mask[e[:, 1]]]
    if not len(ue):
        return lab
    idx = np.nonzero(mask)[0]
    for _ in range(10000):
        m = np.minimum(lab[ue[:, 0]], lab[ue[:, 1]])
        nl = lab.copy(); np.minimum.at(nl, ue[:, 0], m); np.minimum.at(nl, ue[:, 1], m)
        nl[idx] = nl[nl[idx]]; nl[idx] = nl[nl[idx]]   # pointer jumping
        if np.array_equal(nl, lab):
            break
        lab = nl
    return lab


def shrink(P, N, tri, corner_cov, o):
    """P (n,3) the body's positions, N (n,3) its normals, tri (t,3), corner_cov (t,3) bool (the cover mask at each corner's uv), o = options().
    -> (P2, rec): a vertex is covered when every corner of it is (the mask's edge stays where it is); uncovered islands of fewer than
    minIsland vertices (mask specks deep under the cloth) count as covered, or each would pull a feather-wide dimple back to the cloth;
    the surface distance to the uncovered skin over the mesh's edges (exact graph distance, capped at the feather); the push
    d * ease(dist / feather) along -N."""
    t0 = time.time()
    P = np.asarray(P, dtype=np.float64); N = np.asarray(N, dtype=np.float64); tri = np.asarray(tri, dtype=np.int64)
    n = len(P); d = float(o.get('d', DEFAULT['d'])); F = max(float(o.get('feather', DEFAULT['feather'])), 1e-6)
    cc = np.asarray(corner_cov, dtype=bool).reshape(-1, 3)
    used = np.zeros(n, dtype=bool); used[tri.ravel()] = True
    cov = np.ones(n, dtype=bool); np.logical_and.at(cov, tri.ravel(), cc.ravel()); cov &= used
    e = _edges(tri)
    unc = used & ~cov
    lab = _components(n, unc, e)
    sizes = np.bincount(lab[unc], minlength=n) if unc.any() else np.zeros(n, dtype=np.int64)
    small = unc & (sizes[np.maximum(lab, 0)] < int(o.get('minIsland', DEFAULT['minIsland'])))
    src = unc & ~small                                   # the skin the push is measured from
    L = np.linalg.norm(P[e[:, 0]] - P[e[:, 1]], axis=1)
    dist = np.where(src, 0.0, F)
    it = 0
    for it in range(1, 2001):                            # Bellman-Ford over the edges, capped at F (converges in ~F / shortest edge rounds)
        nd = dist.copy()
        np.minimum.at(nd, e[:, 0], dist[e[:, 1]] + L); np.minimum.at(nd, e[:, 1], dist[e[:, 0]] + L)
        nd = np.minimum(nd, F)
        if np.array_equal(nd, dist):
            break
        dist = nd
    t = np.clip(dist / F, 0.0, 1.0)
    ease = o.get('ease', 'out')
    s = t * (2.0 - t) if ease == 'out' else (t * t * (3.0 - 2.0 * t) if ease == 'smooth' else t)
    push = np.where(used & ~src, d * s, 0.0)
    nn = np.linalg.norm(N, axis=1); ok = nn > 1e-9
    push[~ok] = 0.0
    Nn = np.zeros_like(N); Nn[ok] = N[ok] / nn[ok, None]
    P2 = P - Nn * push[:, None]
    moved = push > 1e-5
    rec = {'d': d, 'feather': F, 'ease': ease, 'minIsland': int(o.get('minIsland', DEFAULT['minIsland'])), 'verts': int(n),
           'coveredVerts': int(cov.sum()), 'speckVerts': int(small.sum()), 'speckIslands': int(len(np.unique(lab[small]))) if small.any() else 0,
           'movedVerts': int(moved.sum()), 'fullPushVerts': int((push >= d - 1e-6).sum()), 'maxMm': round(float(push.max()) * 1000, 3) if n else 0.0,
           'meanMovedMm': round(float(push[moved].mean()) * 1000, 3) if moved.any() else 0.0, 'rounds': it, 'ms': round((time.time() - t0) * 1000)}
    return P2.astype(np.float32), rec
