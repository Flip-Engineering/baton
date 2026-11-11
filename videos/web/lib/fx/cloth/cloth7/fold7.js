// CLOTH7 (round 6): CONSTRUCTION AS CLOTH. A turned hem, a cuff's facing, a front's facing built as a LAYER OF THE GARMENT'S OWN MESH:
// the band of the garment's own (solved, posed) triangles within `depth` of a free edge (flat-pattern distance, per panel, to that edge's
// own segments), duplicated, cut clean at the stitch line (depth), laid to the INSIDE along the cloth's own normal, and joined to the
// garment's edge by a rounded FOLD (the fold's first row is the garment's edge itself). Every vertex carries the skin weights of the
// garment vertex it duplicates (a stitch-line point: of the nearer end of its edge), so the layer moves with the garment in every pose
// (the stance, MOTION's key poses, a clip): nothing can slide between the two.
// The layer COLLIDES like cloth: its offset (target `off`, the hem's thickness) is clamped where another layer of cloth, the body or a
// shoe lies closer along the inward normal (a ray, 0.45 of the free distance), the fold's bulge past the edge likewise along the edge's
// outward tangent, the offsets smoothed (a min-preserving relaxation over the layer: a turned hem is stiffer than its cloth), then checked
// with CLOTH5's ruler (triangle pairs against every garment, quantised to the bake's 0.1 mm and posed as the page poses): a layer
// triangle that still crosses halves the offsets at its corners (to `minOff`), a few rounds.
// Built in two steps so MOTION's keys share the stance's topology: plan7 (which garment vertices, which stitch-line points, the
// triangles, the weights: flat-pattern only, pose-free) and realize7 (positions for one pose of the garment). Plain data in, plain data
// out (bake parts: X bind metres, T, SI, SW); nothing here is imported by an existing file.
import { skinPose, blendInverse, vertexNormals } from '../collide.js';
import { boundaryLoops } from '../foundations.js';
import { selfIntersections } from '../cloth5/measure5.js';
export const FOLD7_VERSION = 1;

// ---------------------------------------------------------------- the garment, welded (a sewn part's panels share exact positions at seams)
export function weldGarment(p) {
  const n = p.X.length / 3, key = i => `${Math.round(p.X[i * 3] * 1e5)},${Math.round(p.X[i * 3 + 1] * 1e5)},${Math.round(p.X[i * 3 + 2] * 1e5)}`, map = new Map(), wid = new Int32Array(n), rep = [], dups = [];
  for (let i = 0; i < n; i++) { const k = key(i); let w = map.get(k); if (w == null) { w = rep.length; map.set(k, w); rep.push(i); dups.push([]); } wid[i] = w; dups[w].push(i); }
  const m = rep.length, Tw = []; for (let t = 0; t < p.T.length; t += 3) { const a = wid[p.T[t]], b = wid[p.T[t + 1]], c = wid[p.T[t + 2]]; if (a === b || b === c || a === c) continue; Tw.push(a, b, c); }
  // pre-weld edge (i, j) of each welded edge (a free edge has one): its panel and flat segment
  const pe = new Map(); for (let t = 0; t < p.T.length; t += 3) for (let k = 0; k < 3; k++) { const i = p.T[t + k], j = p.T[t + (k + 1) % 3], a = wid[i], b = wid[j], kk = a < b ? a * m + b : b * m + a; if (!pe.has(kk)) pe.set(kk, [i, j]); }
  const T = Int32Array.from(Tw); return { n, m, wid, rep: Int32Array.from(rep), dups, T, pe, loops: boundaryLoops(T, m) };
}
// posed positions of a part (bind metres -> posed metres, the page's skinning)
export function posePart(p, M, scale, X = p.X) { return skinPose(Float64Array.from(X, x => x / scale), p.SI, p.SW, M, new Float64Array(X.length), scale); }

// ---------------------------------------------------------------- plan: the layer's topology (pose-free)
// run: welded ids along a free edge (a closed loop or an open run). depth: the turned layer's width (m, flat). Returns null if empty.
export function plan7(p, Wg, run, { depth = 0.025, closed = true, name = 'hem', kAr = 4 } = {}) {
  const m = Wg.m, segs = new Map();   // panel -> [[u0, v0, u1, v1]]
  const ne = closed ? run.length : run.length - 1;
  for (let k = 0; k < ne; k++) { const a = run[k], b = run[(k + 1) % run.length], e = Wg.pe.get(a < b ? a * m + b : b * m + a); if (!e) continue; const [i, j] = e, pn = p.panel ? p.panel[i] : 0;
    (segs.get(pn) || segs.set(pn, []).get(pn)).push([p.uv[i * 2], p.uv[i * 2 + 1], p.uv[j * 2], p.uv[j * 2 + 1]]); }
  const sd = (x, y, s) => { const dx = s[2] - s[0], dy = s[3] - s[1], l2 = dx * dx + dy * dy, t = l2 > 0 ? Math.max(0, Math.min(1, ((x - s[0]) * dx + (y - s[1]) * dy) / l2)) : 0; return Math.hypot(x - s[0] - dx * t, y - s[1] - dy * t); };
  const d = new Float64Array(m).fill(Infinity);
  for (let w = 0; w < m; w++) for (const i of Wg.dups[w]) { const L = segs.get(p.panel ? p.panel[i] : 0); if (!L) continue; const x = p.uv[i * 2], y = p.uv[i * 2 + 1]; for (const s of L) { const q = sd(x, y, s); if (q < d[w]) d[w] = q; } }
  for (const w of run) d[w] = 0;
  // only cloth CONNECTED to the run within depth (a panel's far region in reach of its own edge segments in the flat is not taken)
  const T = Wg.T, adj = Array.from({ length: m }, () => []); for (let t = 0; t < T.length; t += 3) for (let k = 0; k < 3; k++) adj[T[t + k]].push(T[t + (k + 1) % 3], T[t + (k + 2) % 3]);
  const conn = new Uint8Array(m), st = [...run]; for (const w of run) conn[w] = 1; while (st.length) { const v = st.pop(); for (const u of adj[v]) if (!conn[u] && d[u] < depth + 0.03) { conn[u] = 1; st.push(u); } }
  // clip every triangle to d <= depth
  const vix = new Map(), recs = [], tri = [], vid = w => { const k = 'v' + w; let i = vix.get(k); if (i == null) { i = recs.length; vix.set(k, i); recs.push({ w, a: w, b: w, t: 0 }); } return i; };
  const eid = (a, b) => { const k = 'e' + Math.min(a, b) + '_' + Math.max(a, b); let i = vix.get(k); if (i == null) { const t = (depth - d[a]) / (d[b] - d[a]); i = recs.length; vix.set(k, i); recs.push({ w: t < 0.5 ? a : b, a, b, t }); } return i; };
  for (let t = 0; t < T.length; t += 3) { const v = [T[t], T[t + 1], T[t + 2]]; if (!conn[v[0]] || !conn[v[1]] || !conn[v[2]]) continue; const ins = v.map(w => d[w] <= depth), ni = ins.filter(Boolean).length; if (!ni) continue;
    if (ni === 3) { tri.push(vid(v[0]), vid(v[1]), vid(v[2])); continue; }
    for (let k = 0; k < 3; k++) { const a = v[k], b = v[(k + 1) % 3], c = v[(k + 2) % 3], ia = ins[k], ib = ins[(k + 1) % 3], ic = ins[(k + 2) % 3];
      if (ni === 2 && !ic && ia && ib) { const A = vid(a), B = vid(b), Pbc = eid(b, c), Pca = eid(c, a); tri.push(A, B, Pbc, A, Pbc, Pca); break; }
      if (ni === 1 && ia) { tri.push(vid(a), eid(a, b), eid(c, a)); break; } } }
  if (!tri.length) return null;
  // the fold: per run vertex, kAr - 1 arc points between the garment's edge (row 0, the garment vertex itself) and the layer's run vertex
  const nr = run.length, fold = [], f0 = recs.length; for (let k = 0; k < nr; k++) { const w = run[k]; for (let r = 0; r < kAr; r++) fold.push(recs.push({ w, a: w, b: w, t: 0, fold: r, run: k }) - 1); }
  const lay = run.map(w => vix.get('v' + w)), ft = [];
  for (let k = 0; k < (closed ? nr : nr - 1); k++) { const k2 = (k + 1) % nr, row = (kk, r) => (r < kAr ? f0 + kk * kAr + r : lay[kk]);
    for (let r = 0; r < kAr; r++) { const a = row(k, r), b = row(k2, r), c = row(k, r + 1), e = row(k2, r + 1); if (c == null || e == null) continue; ft.push(a, b, c, b, e, c); } }
  const all = Int32Array.from([...tri, ...ft]); orientConsistent(all, recs.length);
  return { name, depth, closed, run: Int32Array.from(run), d, recs, T: all, nSheet: tri.length / 3, kAr, f0 };
}
// make a manifold triangle list's winding consistent (BFS over shared edges); the global sign is set by realize7
function orientConsistent(T, n) {
  const nt = T.length / 3, E = new Map(), ek = (a, b) => (a < b ? a * n + b : b * n + a);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) { const kk = ek(T[t * 3 + k], T[t * 3 + (k + 1) % 3]); (E.get(kk) || E.set(kk, []).get(kk)).push(t); }
  const done = new Uint8Array(nt), dir = (t, a, b) => { for (let k = 0; k < 3; k++) if (T[t * 3 + k] === a && T[t * 3 + (k + 1) % 3] === b) return 1; return -1; };
  for (let s = 0; s < nt; s++) { if (done[s]) continue; done[s] = 1; const q = [s];
    while (q.length) { const t = q.pop(); for (let k = 0; k < 3; k++) { const a = T[t * 3 + k], b = T[t * 3 + (k + 1) % 3]; for (const u of E.get(ek(a, b))) { if (u === t || done[u]) continue;
      if (dir(u, a, b) > 0) { const x = T[u * 3 + 1]; T[u * 3 + 1] = T[u * 3 + 2]; T[u * 3 + 2] = x; } done[u] = 1; q.push(u); } } } }
}

// ---------------------------------------------------------------- the ray / triangle grid (everything the layer may meet, posed)
export class TriGrid {
  constructor(cell = 0.008) { this.cell = cell; this.H = new Map(); this.X = []; this.T = []; this.tag = []; }
  add(X, T, tag) { const o = this.X.length / 3; for (const x of X) this.X.push(x); const ic = 1 / this.cell;
    for (let t = 0; t < T.length; t += 3) { const id = this.T.length / 3; this.T.push(T[t] + o, T[t + 1] + o, T[t + 2] + o); this.tag.push(tag); let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let k = 0; k < 3; k++) { const v = T[t + k]; x0 = Math.min(x0, X[v * 3]); x1 = Math.max(x1, X[v * 3]); y0 = Math.min(y0, X[v * 3 + 1]); y1 = Math.max(y1, X[v * 3 + 1]); z0 = Math.min(z0, X[v * 3 + 2]); z1 = Math.max(z1, X[v * 3 + 2]); }
      for (let i = Math.floor(x0 * ic); i <= Math.floor(x1 * ic); i++) for (let j = Math.floor(y0 * ic); j <= Math.floor(y1 * ic); j++) for (let k = Math.floor(z0 * ic); k <= Math.floor(z1 * ic); k++) { const kk = this.key(i, j, k); (this.H.get(kk) || this.H.set(kk, []).get(kk)).push(id); } } }
  key(i, j, k) { return ((i + 2048) * 4096 + (j + 2048)) * 4096 + (k + 2048); }
  // nearest hit of the segment o + s d (0 < s <= len, d unit) past `eps`; returns s or Infinity
  ray(ox, oy, oz, dx, dy, dz, len, eps = 2e-5) { const ic = 1 / this.cell, X = this.X, T = this.T; let best = Infinity; const seen = new Set();
    const ex = ox + dx * len, ey = oy + dy * len, ez = oz + dz * len;
    for (let i = Math.floor(Math.min(ox, ex) * ic); i <= Math.floor(Math.max(ox, ex) * ic); i++) for (let j = Math.floor(Math.min(oy, ey) * ic); j <= Math.floor(Math.max(oy, ey) * ic); j++) for (let k = Math.floor(Math.min(oz, ez) * ic); k <= Math.floor(Math.max(oz, ez) * ic); k++) {
      const L = this.H.get(this.key(i, j, k)); if (!L) continue;
      for (const t of L) { if (seen.has(t)) continue; seen.add(t); const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
        const e1x = X[b] - X[a], e1y = X[b + 1] - X[a + 1], e1z = X[b + 2] - X[a + 2], e2x = X[c] - X[a], e2y = X[c + 1] - X[a + 1], e2z = X[c + 2] - X[a + 2];
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-14) continue; const id = 1 / det;
        const tx = ox - X[a], ty = oy - X[a + 1], tz = oz - X[a + 2], u = (tx * px + ty * py + tz * pz) * id; if (u < -1e-6 || u > 1 + 1e-6) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (dx * qx + dy * qy + dz * qz) * id; if (v < -1e-6 || u + v > 1 + 1e-6) continue;
        const s = (e2x * qx + e2y * qy + e2z * qz) * id; if (s > eps && s <= len && s < best) best = s; } }
    return best; }
}

// ---------------------------------------------------------------- realize: positions of a planned layer for one pose of its garment
// Pp: the garment's posed positions (pre-weld, metres); Wg: weldGarment; body: { X, T } posed (outward winding) or null; grid: a TriGrid of
// everything else (other garments, the body, shoes, kept construction) AND this garment (its own other folds); M, scale: the pose (for bind)
// Returns { X (bind metres), Xp (posed), SI, SW, T, report }.
export function realize7(p, Wg, pl, Pp, { M, scale, grid = null, off = 0.0011, minOff = 0.0003, bulge = 0.0009, smooth = 3, check = null, rounds = 3, sign = null, drop = true } = {}) {
  const m = Wg.m, Pw = new Float64Array(m * 3); for (let w = 0; w < m; w++) { const i = Wg.rep[w]; Pw[w * 3] = Pp[i * 3]; Pw[w * 3 + 1] = Pp[i * 3 + 1]; Pw[w * 3 + 2] = Pp[i * 3 + 2]; }
  const Nw = vertexNormals(Pw, Wg.T); const sg = sign ?? 1; if (sg < 0) for (let i = 0; i < Nw.length; i++) Nw[i] = -Nw[i];
  const R = pl.recs, nv = R.length, kA = pl.kAr;
  // per record: base point B (on the garment), normal N, offset target
  const B = new Float64Array(nv * 3), N = new Float64Array(nv * 3), O = new Float64Array(nv), A = new Float64Array(nv * 3);   // A: the fold's outward tangent (run records)
  for (let r = 0; r < nv; r++) { const q = R[r], t = q.t; for (let c = 0; c < 3; c++) { B[r * 3 + c] = Pw[q.a * 3 + c] * (1 - t) + Pw[q.b * 3 + c] * t; N[r * 3 + c] = Nw[q.a * 3 + c] * (1 - t) + Nw[q.b * 3 + c] * t; }
    const l = Math.hypot(N[r * 3], N[r * 3 + 1], N[r * 3 + 2]) || 1; for (let c = 0; c < 3; c++) N[r * 3 + c] /= l; O[r] = off; }
  // the fold's outward tangent per run vertex: away from the cloth's interior neighbours, in the tangent plane
  const run = pl.run, nr = run.length, onRun = new Map(); run.forEach((w, k) => onRun.set(w, k)); const acc = new Float64Array(nr * 4);
  for (let t = 0; t < Wg.T.length; t += 3) for (let k = 0; k < 3; k++) { const a = Wg.T[t + k], ka = onRun.get(a); if (ka == null) continue; for (const b of [Wg.T[t + (k + 1) % 3], Wg.T[t + (k + 2) % 3]]) { if (onRun.has(b)) continue; acc[ka * 4] += Pw[b * 3]; acc[ka * 4 + 1] += Pw[b * 3 + 1]; acc[ka * 4 + 2] += Pw[b * 3 + 2]; acc[ka * 4 + 3]++; } }
  const tan = new Float64Array(nr * 3); for (let k = 0; k < nr; k++) { const w = run[k]; let ox = 0, oy = 0, oz = 0;
    if (acc[k * 4 + 3]) { ox = Pw[w * 3] - acc[k * 4] / acc[k * 4 + 3]; oy = Pw[w * 3 + 1] - acc[k * 4 + 1] / acc[k * 4 + 3]; oz = Pw[w * 3 + 2] - acc[k * 4 + 2] / acc[k * 4 + 3]; }
    const nx = Nw[w * 3], ny = Nw[w * 3 + 1], nz = Nw[w * 3 + 2], dn = ox * nx + oy * ny + oz * nz; ox -= dn * nx; oy -= dn * ny; oz -= dn * nz; const l = Math.hypot(ox, oy, oz) || 1; tan[k * 3] = ox / l; tan[k * 3 + 1] = oy / l; tan[k * 3 + 2] = oz / l; }
  // the sheet's neighbours (for smoothing)
  const nb = Array.from({ length: nv }, () => new Set()); for (let t = 0; t < pl.T.length; t += 3) for (let k = 0; k < 3; k++) { const a = pl.T[t + k], b = pl.T[t + (k + 1) % 3]; nb[a].add(b); nb[b].add(a); }
  const isFold = r => R[r].fold != null;
  // (1) clamp along the inward normal by the free distance to anything (0.45 of it), (2) the bulge along the tangent
  let clamped = 0; const bul = new Float64Array(nr).fill(bulge);
  if (grid) { for (let r = 0; r < nv; r++) { if (isFold(r)) continue; const s = grid.ray(B[r * 3], B[r * 3 + 1], B[r * 3 + 2], -N[r * 3], -N[r * 3 + 1], -N[r * 3 + 2], off * 2.6); if (s < off * 2.6) { O[r] = Math.max(minOff, Math.min(off, 0.45 * s)); clamped++; } }
    for (let k = 0; k < nr; k++) { const w = run[k], cx = Pw[w * 3] - Nw[w * 3] * off * 0.5, cy = Pw[w * 3 + 1] - Nw[w * 3 + 1] * off * 0.5, cz = Pw[w * 3 + 2] - Nw[w * 3 + 2] * off * 0.5; const s = grid.ray(cx, cy, cz, tan[k * 3], tan[k * 3 + 1], tan[k * 3 + 2], bulge * 2.5); if (s < bulge * 2.5) bul[k] = Math.max(0.0002, 0.4 * s); } }
  // min-preserving relaxation: a vertex never more than its neighbours' mean + 15 % (a stiff turned layer, no steps)
  for (let it = 0; it < smooth; it++) { const O2 = Float64Array.from(O); for (let r = 0; r < nv; r++) { if (isFold(r)) continue; let s = 0, c = 0; for (const u of nb[r]) if (!isFold(u)) { s += O[u]; c++; } if (c) O2[r] = Math.max(minOff, Math.min(O[r], s / c * 1.15)); } O.set(O2); }
  const layKey = new Map(); for (let k = 0; k < nr; k++) layKey.set(k, R.findIndex(q => q.fold == null && q.a === run[k] && q.b === run[k]));
  const out = { SI: new Uint16Array(nv * 4), SW: new Float32Array(nv * 4) }; for (let r = 0; r < nv; r++) { const i = Wg.rep[R[r].w]; out.SI.set(p.SI.subarray(i * 4, i * 4 + 4), r * 4); out.SW.set(p.SW.subarray(i * 4, i * 4 + 4), r * 4); }
  const place = () => { const Xp = new Float64Array(nv * 3);
    for (let r = 0; r < nv; r++) { const q = R[r]; if (q.fold == null) { for (let c = 0; c < 3; c++) Xp[r * 3 + c] = B[r * 3 + c] - N[r * 3 + c] * O[r]; continue; }
      const k = q.run, lr = layKey.get(k), o = O[lr], th = q.fold / kA * Math.PI, w = run[k], hb = o * 0.5;
      for (let c = 0; c < 3; c++) Xp[r * 3 + c] = Pw[w * 3 + c] - Nw[w * 3 + c] * hb + Nw[w * 3 + c] * hb * Math.cos(th) + tan[k * 3 + c] * bul[k] * Math.sin(th); }
    return Xp; };
  // bind (through each vertex's own weights) quantised as the bake stores it, posed again: what the page draws
  const toBind = Xp => { const X = new Float64Array(nv * 3), tmp = [0, 0, 0]; for (let r = 0; r < nv; r++) { blendInverse(out.SI, out.SW, r, M, Xp[r * 3] / scale, Xp[r * 3 + 1] / scale, Xp[r * 3 + 2] / scale, tmp, 0); for (let c = 0; c < 3; c++) X[r * 3 + c] = Math.round(tmp[c] * scale * 1e4) / 1e4; } return X; };
  let Xp = place(), X = toBind(Xp), hits = 0, fixed = 0, lastBad = null, selfBad = null;
  // (3) CLOTH5's ruler against the garments (check: { X, T } posed, all garments): crossing layer triangles halve their corners' offsets
  for (let round = 0; check && round <= rounds; round++) { const Xq = skinPose(Float64Array.from(X, x => x / scale), out.SI, out.SW, M, new Float64Array(nv * 3), scale), nG = check.X.length / 3;
    const XX = new Float64Array(check.X.length + Xq.length); XX.set(check.X); XX.set(Xq, check.X.length); const TT = new Int32Array(check.T.length + pl.T.length); TT.set(check.T); for (let i = 0; i < pl.T.length; i++) TT[check.T.length + i] = pl.T[i] + nG;
    const L = []; selfIntersections(XX, TT, { list: L }); const ntG = check.T.length / 3, bad = new Set(); selfBad = new Set(); for (let i = 0; i < L.length; i += 2) { const a = L[i] >= ntG, b = L[i + 1] >= ntG; if (a !== b) bad.add((a ? L[i] : L[i + 1]) - ntG); else if (a && b) { selfBad.add(L[i] - ntG); selfBad.add(L[i + 1] - ntG); } }
    hits = bad.size; lastBad = bad; if (!hits || round === rounds) break;
    for (const t of bad) for (let k = 0; k < 3; k++) { const r = pl.T[t * 3 + k], q = R[r]; if (q.fold != null) { bul[q.run] = Math.max(0.0002, bul[q.run] * 0.5); const lr = layKey.get(q.run); O[lr] = Math.max(minOff, O[lr] * 0.6); } else O[r] = Math.max(minOff, O[r] * 0.5); fixed++; }
    Xp = place(); X = toBind(Xp); }
  // the global winding: the layer's sheet faces the wearer (-N), the continuation of the garment's outside round the fold
  let s = 0; for (let t = 0; t < pl.nSheet * 3; t += 3) { const a = pl.T[t], b = pl.T[t + 1], c = pl.T[t + 2], ux = Xp[b * 3] - Xp[a * 3], uy = Xp[b * 3 + 1] - Xp[a * 3 + 1], uz = Xp[b * 3 + 2] - Xp[a * 3 + 2], vx = Xp[c * 3] - Xp[a * 3], vy = Xp[c * 3 + 1] - Xp[a * 3 + 1], vz = Xp[c * 3 + 2] - Xp[a * 3 + 2];
    s += (uy * vz - uz * vy) * N[a * 3] + (uz * vx - ux * vz) * N[a * 3 + 1] + (ux * vy - uy * vx) * N[a * 3 + 2]; }
  let T = Int32Array.from(pl.T); if (s > 0) for (let t = 0; t < T.length; t += 3) { const x = T[t + 1]; T[t + 1] = T[t + 2]; T[t + 2] = x; }
  // what still crosses after the rounds (the garment's own cloth crossed there, or pinched under minOff) is left out of the layer: hidden
  // inside the garment it is a hole no one sees; drawn, it is a shard on the outside (counted: dropSheet inside, dropFold at the edge)
  let dropSheet = 0, dropFold = 0; if (drop && (lastBad?.size || selfBad?.size)) { const keep = []; for (let t = 0; t < T.length / 3; t++) { if (lastBad?.has(t) || selfBad?.has(t)) { if (t < pl.nSheet) dropSheet++; else dropFold++; continue; } keep.push(T[t * 3], T[t * 3 + 1], T[t * 3 + 2]); } T = Int32Array.from(keep); }
  let mo = 0; for (let r = 0; r < nv; r++) if (!isFold(r)) mo += O[r]; mo /= Math.max(1, nv - nr * kA);
  return { X, Xp, SI: out.SI, SW: out.SW, T, report: { verts: nv, tris: T.length / 3, clamped, meanOffMm: +(mo * 1000).toFixed(2), crossing: hits, fixed, dropSheet, dropFold } };
}

// the garment's outward sign: its vertex normals against the posed body's (nearest body vertex: the cloth faces away from the skin)
export function outwardSign(Pw, Nw, body, sample = 400) {
  if (!body) return 1; const n = Pw.length / 3, step = Math.max(1, Math.floor(n / sample)), cell = 0.03, H = new Map(), key = (i, j, k) => ((i + 512) * 1024 + (j + 512)) * 1024 + (k + 512), BX = body.X, nb = BX.length / 3;
  for (let v = 0; v < nb; v++) { const k = key(Math.floor(BX[v * 3] / cell), Math.floor(BX[v * 3 + 1] / cell), Math.floor(BX[v * 3 + 2] / cell)); (H.get(k) || H.set(k, []).get(k)).push(v); }
  let s = 0; for (let v = 0; v < n; v += step) { const x = Pw[v * 3], y = Pw[v * 3 + 1], z = Pw[v * 3 + 2], ci = Math.floor(x / cell), cj = Math.floor(y / cell), ck = Math.floor(z / cell); let best = -1, bd = Infinity;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) for (const u of H.get(key(ci + a, cj + b, ck + c)) || []) { const d = (BX[u * 3] - x) ** 2 + (BX[u * 3 + 1] - y) ** 2 + (BX[u * 3 + 2] - z) ** 2; if (d < bd) { bd = d; best = u; } }
    if (best < 0) continue; s += Math.sign((x - BX[best * 3]) * Nw[v * 3] + (y - BX[best * 3 + 1]) * Nw[v * 3 + 1] + (z - BX[best * 3 + 2]) * Nw[v * 3 + 2]); }
  return s >= 0 ? 1 : -1;
}
