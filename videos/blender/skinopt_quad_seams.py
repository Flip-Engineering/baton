#!/usr/bin/env python3
# SKIN OPTICS (15 Oct, c3 it1): WHERE THE DASHES COME FROM. System python3 (numpy, PIL); no Blender, no render.
#   python3 videos/blender/skinopt_quad_seams.py <export dir> [--out <dir>] [--who <name>]
# The Cycles skin is the export's triangles with a per-CORNER atlas uv (uv.bin: blender/unwrap.py, Smart UV Project on the triangles, so its
# island seams run between any two triangles, hm08's quad diagonals included). person_scene.fine7_apply then pairs the triangles back into
# hm08's quads (fine7_quads: by vertex index and the atlas only) and dissolves each pair's shared edge (fine7_join_quads, bmesh). Where the two
# triangles of a pair lie in DIFFERENT uv islands, the joined quad keeps corners from both islands and Cycles interpolates the albedo, spec,
# roughness and normal maps across whatever lies between them in the atlas: a crisp strip of foreign texels the size of the quad (the 'dark
# speckles' on light skin, the 'pale scratch dashes' on deep skin, both in parallel groups along a seam). The 'tri' twin (no join) has none.
# This counts those pairs (the shared edge's two corners' uv differ between the triangles) and draws them in atlas space.
# (SKIN OPTICS iteration 7, 15 Oct) THE THIN DARK VERTICAL LINES down the belly and thighs (the orchestrator's 15 Oct note): seams_front_<who>.png draws every
# uv SEAM EDGE of the body (an edge whose two triangles carry different uv at a shared vertex) and every atlas border, front-on and from the back, over the
# body's silhouette, so a line in a render can be put beside the seams it does or does not follow (red: seam inside one atlas; yellow: an atlas border).
import sys, os, json, ast
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
PS = os.path.join(HERE, 'person_scene.py')
sys.path.insert(0, HERE)
from person_io import Person   # json, os, numpy only


def load_pairing():
    """fine7_quads and _hm08_diagonals exactly as person_scene.py has them (its other imports need Blender)"""
    src = open(PS).read(); tree = ast.parse(src)
    keep = [n for n in tree.body if (isinstance(n, ast.FunctionDef) and n.name in ('fine7_quads', '_hm08_diagonals'))
            or (isinstance(n, ast.Assign) and any(getattr(t, 'id', '') == '_HM08' for t in n.targets))]
    ns = {'np': np, 'os': os, 'json': json, '__file__': PS}
    exec(compile(ast.Module(body=keep, type_ignores=[]), PS, 'exec'), ns)
    return ns['fine7_quads']


def main():
    a = sys.argv[1:]
    d = a[0]; out = a[a.index('--out') + 1] if '--out' in a else d; who = a[a.index('--who') + 1] if '--who' in a else os.path.basename(d.rstrip('/'))
    pp = Person(d); tri = pp.arr(pp.body['index'], 3).astype(np.int64)
    uv = np.fromfile(os.path.join(d, 'uv.bin'), dtype=np.float32).reshape(-1, 3, 2)
    atlas = np.fromfile(os.path.join(d, 'atlas.bin'), dtype=np.uint8)
    fine7_quads = load_pairing()
    P, rep = fine7_quads(tri, atlas)
    i, j = P[:, 0], P[:, 1]
    # the shared edge's two vertices, and each triangle's uv at them
    bad = np.zeros(len(P), dtype=bool); span = np.zeros(len(P))
    for k in range(len(P)):
        ti, tj = tri[i[k]], tri[j[k]]; sh = np.intersect1d(ti, tj)
        d_ = 0.0
        for v in sh:
            d_ = max(d_, float(np.abs(uv[i[k]][ti == v][0] - uv[j[k]][tj == v][0]).max()))
        span[k] = d_; bad[k] = d_ > 1e-5
    res = {'who': who, 'pairs': int(len(P)), 'seamPairs': int(bad.sum()), 'seamShare': round(float(bad.mean()) if len(P) else 0, 4),
           'byAtlas': {str(x): int((bad & (atlas[i] == x)).sum()) for x in np.unique(atlas)}, 'uvJumpP50': round(float(np.median(span[bad])) if bad.any() else 0, 4),
           'quads': rep}
    print(json.dumps(res), flush=True)
    os.makedirs(out, exist_ok=True)
    json.dump(res, open(os.path.join(out, f'quad_seams_{who}.json'), 'w'), indent=1)
    try:
        from PIL import Image, ImageDraw
        for x in np.unique(atlas):
            im = Image.new('RGB', (1024, 1024), (24, 24, 24)); dr = ImageDraw.Draw(im)
            for t in np.nonzero(atlas == x)[0][::1]:
                dr.polygon([(q[0] * 1024, (1 - q[1]) * 1024) for q in uv[t]], outline=(70, 70, 70))
            for k in np.nonzero(bad & (atlas[i] == x))[0]:
                for t in (i[k], j[k]):
                    dr.polygon([(q[0] * 1024, (1 - q[1]) * 1024) for q in uv[t]], fill=(255, 40, 40))
            im.save(os.path.join(out, f'quad_seams_{who}_a{int(x)}.png'))
    except Exception as e:
        print('quad_seams: no picture', repr(e), flush=True)
    try:
        seams_front(pp, tri, uv, atlas, out, who)
    except Exception as e:
        print('quad_seams: no seams_front', repr(e), flush=True)


def seams_front(pp, tri, uv, atlas, out, who):
    from PIL import Image, ImageDraw
    X = pp.arr(pp.body['position'], 3).astype(np.float64)
    # every triangle edge (a, b) with its two triangles; a seam = the triangles' uv differ at a or b (or the atlases differ)
    E = {}
    for t in range(len(tri)):
        for c in range(3):
            a_, b_ = int(tri[t][c]), int(tri[t][(c + 1) % 3]); k = (min(a_, b_), max(a_, b_))
            E.setdefault(k, []).append(t)
    seam, border = [], []
    for (a_, b_), ts in E.items():
        if len(ts) != 2: continue
        t0, t1 = ts
        if atlas[t0] != atlas[t1]: border.append((a_, b_, t0, t1)); continue
        u0 = {int(v): uv[t0][list(tri[t0]).index(v)] for v in (a_, b_)}; u1 = {int(v): uv[t1][list(tri[t1]).index(v)] for v in (a_, b_)}
        if max(float(np.abs(u0[v] - u1[v]).max()) for v in (a_, b_)) > 1e-5: seam.append((a_, b_, t0, t1))
    y0, y1 = np.percentile(X[:, 1], 30), np.percentile(X[:, 1], 92)   # the torso and the thighs' top (the belly lines' band)
    xs = X[:, 0]; xc = float(np.median(xs)); half = 0.32; Hh = 1400; s_ = Hh / (y1 - y0); Ww = int(2 * half * s_)
    for side, sx in (('front', 1.0), ('back', -1.0)):
        im = Image.new('RGB', (Ww, Hh), (30, 30, 30)); dr = ImageDraw.Draw(im)
        P2 = np.stack([(sx * (X[:, 0] - xc) + half) * s_, (y1 - X[:, 1]) * s_], 1); Z = X[:, 2] * sx
        nz = np.cross(X[tri[:, 1]] - X[tri[:, 0]], X[tri[:, 2]] - X[tri[:, 0]])[:, 2] * sx
        for t in np.argsort(Z[tri].mean(1)):
            if nz[t] <= 0: continue
            g = int(90 + 120 * min(1, nz[t] / (np.linalg.norm(np.cross(X[tri[t][1]] - X[tri[t][0]], X[tri[t][2]] - X[tri[t][0]])) + 1e-12)))
            dr.polygon([tuple(P2[v]) for v in tri[t]], fill=(g, g, g))
        for col, L in (((255, 40, 40), seam), ((255, 220, 40), border)):
            for a_, b_, t0, t1 in L:
                if nz[t0] <= 0 and nz[t1] <= 0: continue   # only edges on the side that faces the viewer (no depth test: a seam behind a nearer facing part still shows)
                dr.line([tuple(P2[a_]), tuple(P2[b_])], fill=col, width=2)
        dr.text((8, 8), f'{who}: uv seam edges (red) and atlas borders (yellow), {side} (orthographic, bind-ish export positions)', fill=(255, 255, 255))
        im.save(os.path.join(out, f'seams_{side}_{who}.png'))
    print(json.dumps({'who': who, 'seamEdges': len(seam), 'atlasBorderEdges': len(border)}), flush=True)


if __name__ == '__main__':
    main()
