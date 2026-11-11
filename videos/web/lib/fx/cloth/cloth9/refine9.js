// CLOTH9 c3 it2 (8 Oct): THE FALL BAND AT THE CLOTH'S OWN SCALE. A trouser leg breaks on the shoe in folds whose size is the fabric's
// (its bending length, 3-3.5 cm for chino and denim: a fold a few cm across); K4's legs are a 13-14 mm triangle lattice, which draws one
// such fold with two or three edges and buckles everything smaller into a faceted crumple at the lattice's own scale (CLOTH9 c3 it1's
// plots: a diamond of facets above the hem). So the cloth that is going to fall is cut finer before it falls: every triangle of the part
// in a region (here: the legs below the knee) is split 1 -> 4 at its edge midpoints (Loop's split, no smoothing: the shape is the
// bake's), with a conforming closure (red-green: a triangle with two split edges gets its third; one split edge bisects it) so the
// region's border has no T-junction. The split is decided on WELDED edges (positions), so a seam's two panel copies split alike and
// still weld. New vertices: bind position, uv and panel at the midpoint; skin weights the two ends' blended (top four, renormalised).
// T and Tfull (a dressed part's full index) are split with the same midpoints. In place; returns { added, tris: [before, after] }.
//   refine9(part, sel)  sel(i) -> true for an (unwelded) vertex in the region; a triangle with every corner selected is split
export const REFINE9_VERSION = 1;
export function refine9(p, sel, { key = 1e5 } = {}) {
  const n = p.X.length / 3, X = p.X, kf = i => `${Math.round(X[i * 3] * key)},${Math.round(X[i * 3 + 1] * key)},${Math.round(X[i * 3 + 2] * key)}`;
  const wmap = new Map(), wid = new Int32Array(n); for (let i = 0; i < n; i++) { const k = kf(i); let w = wmap.get(k); if (w == null) { w = wmap.size; wmap.set(k, w); } wid[i] = w; }
  const m = wmap.size, ek = (i, j) => { const a = wid[i], b = wid[j]; return a < b ? a * m + b : b * m + a; };
  const lists = [p.T, p.Tfull].filter(Boolean), split = new Set();
  // the region: triangles with every corner selected (in any index list)
  for (const T of lists) for (let t = 0; t < T.length; t += 3) if (sel(T[t]) && sel(T[t + 1]) && sel(T[t + 2])) for (let k = 0; k < 3; k++) split.add(ek(T[t + k], T[t + (k + 1) % 3]));
  // the conforming closure: a triangle with two split edges gets its third
  for (let changed = true; changed;) { changed = false;
    for (const T of lists) for (let t = 0; t < T.length; t += 3) { let c = 0, miss = -1; for (let k = 0; k < 3; k++) { if (split.has(ek(T[t + k], T[t + (k + 1) % 3]))) c++; else miss = k; }
      if (c === 2) { split.add(ek(T[t + miss], T[t + (miss + 1) % 3])); changed = true; } } }
  // one new vertex per split pre-weld edge (a seam's two copies get one each, at the same place)
  const mid = new Map(), nX = [], nUV = [], nP = [], nSI = [], nSW = [], hasUV = !!p.uv, hasP = !!p.panel;
  const midOf = (i, j) => { const a = i < j ? i : j, b = i < j ? j : i, k = a * n + b; let v = mid.get(k); if (v != null) return v; v = n + nX.length / 3; mid.set(k, v);
    for (let c = 0; c < 3; c++) nX.push((X[a * 3 + c] + X[b * 3 + c]) / 2);
    if (hasUV) nUV.push((p.uv[a * 2] + p.uv[b * 2]) / 2, (p.uv[a * 2 + 1] + p.uv[b * 2 + 1]) / 2);
    if (hasP) nP.push(p.panel[a]);
    const w = new Map(); for (const s of [a, b]) for (let k = 0; k < 4; k++) { const bi = p.SI[s * 4 + k], ww = p.SW[s * 4 + k] * 0.5; if (ww > 0) w.set(bi, (w.get(bi) || 0) + ww); }
    const top = [...w].sort((x, y) => y[1] - x[1]).slice(0, 4), sum = top.reduce((s, x) => s + x[1], 0) || 1;
    for (let k = 0; k < 4; k++) { nSI.push(top[k] ? top[k][0] : 0); nSW.push(top[k] ? top[k][1] / sum : 0); }
    return v; };
  const out = lists.map(T => { const o = [];
    for (let t = 0; t < T.length; t += 3) { const v = [T[t], T[t + 1], T[t + 2]], s = [0, 1, 2].map(k => split.has(ek(v[k], v[(k + 1) % 3]))), c = s.filter(Boolean).length;
      if (!c) { o.push(v[0], v[1], v[2]); continue; }
      if (c === 3) { const ab = midOf(v[0], v[1]), bc = midOf(v[1], v[2]), ca = midOf(v[2], v[0]); o.push(v[0], ab, ca, ab, v[1], bc, ca, bc, v[2], ab, bc, ca); continue; }
      const k = s.indexOf(true), a = v[k], b = v[(k + 1) % 3], cc = v[(k + 2) % 3], mm = midOf(a, b); o.push(a, mm, cc, mm, b, cc); }   // c === 1 (the closure leaves no 2)
    return o; });
  const nn = n + nX.length / 3, cat = (A, B, C) => { const r = new C(A.length + B.length); r.set(A); r.set(B, A.length); return r; };
  const before = p.T.length / 3;
  p.X = cat(p.X, nX, Float64Array); p.SI = cat(p.SI, nSI, p.SI.constructor); p.SW = cat(p.SW, nSW, p.SW.constructor);
  if (hasUV) p.uv = cat(p.uv, nUV, p.uv.constructor); if (hasP) p.panel = cat(p.panel, nP, p.panel.constructor);
  const TC = nn > 65535 ? Uint32Array : p.T.constructor; p.T = TC.from(out[0]); if (p.Tfull) p.Tfull = TC.from(out[1]);
  return { added: nn - n, split: split.size, tris: [before, p.T.length / 3] };
}
