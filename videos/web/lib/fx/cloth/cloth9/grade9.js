// CLOTH9 c6 it2 (15 Oct): THE CUT FOR THE BODY IT IS WORN ON (the grade of seat9 rev 3).
// Why: every garment is drafted from its wearer's tailor measures (K2's tailor.js: girths as a tape takes them, the convex hull of a
// slice, plus the cut's ease) and draped on the body as it was at the bake. The person build then keeps moving the body under the cloth
// (BODY7's girdle and girdle layer, ANAT8-BODY's soft solve, ANAT8-PELVIS: the women's hips and thighs 3-7 cm out), so the cut no longer
// fits the body it is worn on: the ease is used up where the body grew and the cloth, pushed out of the skin with the bake's own lengths,
// is stretched round the new body and takes every bump of it (critic c6-1 on job 1015-114630: L06's chinos 'riding breeches', L12's
// jeans 'a lateral thigh bulge with a ridge': 'twill never takes the exact shape of whatever is under it').
// A real pair is cut for the wearer: a body with a bigger hip gets a bigger pattern, not a stretched one. So the build re-grades the
// cloth by the tailor's own rule, at the body it ends with: at each point of a garment, the girth of the body under it is taped round
// the ring of skin that the garment's weft goes round (the plane across the cloth's warp, the warp read off the pattern), on the final
// body and, for the same material points of skin, on the body the garment was cut and draped on (X0); the cloth's weft lengths there
// take the ratio. Nothing is aimed at a shape: the grade is the ratio of two tapes of the same skin; where the body did not change it
// is 1 and the cloth is untouched; the ease the cut had stays the cut's (CLOTH8 / K4's draft).
//   gradeGarment9({ q, Wg, Pw, Pp, body, O }) -> { g: Float64Array(m) per welded vertex (1 = no change), P0: the tape on X0 (m), stats }
//     q: the garment record (T, uv per vertex), Wg: its weld (m, wid, T), Pw: welded posed positions, Pp: posed per vertex;
//     body: { X1, X0 (posed, the same vertices), surf (SurfaceMesh of X1 over the skin's triangles), ET (edgeTris9(T, X1): the welded skin) }
import { adjacency } from '../cloth8/relax8.js';
export const GRADE9 = { cell: 0.015, reach: 0.06, maxSteps: 6000, minTape: 0.08, gMin: 0.75, gMax: 1.5, smooth: 4, fillIters: 400 };

// every edge of the skin -> its triangles (a closed skin has two), over the skin WELDED by position (a vertex split at a uv seam is one
// point of skin: the ring must walk across the seam): { E, T (the triangles over each vertex's representative), n }
export function edgeTris9(T0, X) {
  const n = X.length / 3, rep = new Int32Array(n), H = new Map();
  for (let v = 0; v < n; v++) { const k = `${Math.round(X[v * 3] * 1e5)},${Math.round(X[v * 3 + 1] * 1e5)},${Math.round(X[v * 3 + 2] * 1e5)}`, r = H.get(k); if (r == null) { H.set(k, v); rep[v] = v; } else rep[v] = r; }
  const T = Int32Array.from(T0, v => rep[v]), E = new Map();
  for (let t = 0, nt = T.length / 3; t < nt; t++) for (let k = 0; k < 3; k++) { const a = T[t * 3 + k], b = T[t * 3 + (k + 1) % 3]; if (a === b) continue; const key = a < b ? a * n + b : b * n + a, L = E.get(key); if (L) L.push(t); else E.set(key, [t]); }
  return { E, T, n };
}
// a tape's length: the convex hull's perimeter of 2D points (Andrew's monotone chain)
export function hullPerimeter9(pts) {
  const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (P.length < 3) return 0;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  const H = lo.slice(0, -1).concat(up.slice(0, -1)); let L = 0; for (let i = 0; i < H.length; i++) { const j = (i + 1) % H.length; L += Math.hypot(H[j][0] - H[i][0], H[j][1] - H[i][1]); } return L;
}
// the ring of skin through p in the plane across `nr`: traced triangle to triangle from t0 (the skin's triangle closest to the cloth) until
// it closes; its tape on the final body (X1) and, for the same material points (each crossing's edge and fraction), on X0. null: open
// (a boundary of the skin) or too long
export function ring9(X1, X0, T, nv, ET, t0, p, nr, maxSteps = GRADE9.maxSteps) {
  const sd = v => ((X1[v * 3] - p[0]) * nr[0] + (X1[v * 3 + 1] - p[1]) * nr[1] + (X1[v * 3 + 2] - p[2]) * nr[2]) >= 0;
  const cuts = t => { const r = []; for (let k = 0; k < 3; k++) { const a = T[t * 3 + k], b = T[t * 3 + (k + 1) % 3]; if (sd(a) !== sd(b)) r.push(a < b ? [a, b] : [b, a]); } return r; };
  const c0 = cuts(t0); if (c0.length !== 2) return null;
  const a0 = Math.abs(nr[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]; let u = [nr[1] * a0[2] - nr[2] * a0[1], nr[2] * a0[0] - nr[0] * a0[2], nr[0] * a0[1] - nr[1] * a0[0]]; const ul = Math.hypot(...u) || 1; u = u.map(x => x / ul);
  const w = [nr[1] * u[2] - nr[2] * u[1], nr[2] * u[0] - nr[0] * u[2], nr[0] * u[1] - nr[1] * u[0]], P1 = [], P0 = [];
  const at = ([a, b]) => { const da = (X1[a * 3] - p[0]) * nr[0] + (X1[a * 3 + 1] - p[1]) * nr[1] + (X1[a * 3 + 2] - p[2]) * nr[2], db = (X1[b * 3] - p[0]) * nr[0] + (X1[b * 3 + 1] - p[1]) * nr[1] + (X1[b * 3 + 2] - p[2]) * nr[2], s = da / ((da - db) || 1e-12);
    for (const [X, out] of [[X1, P1], [X0, P0]]) { const x = X[a * 3] + (X[b * 3] - X[a * 3]) * s - p[0], y = X[a * 3 + 1] + (X[b * 3 + 1] - X[a * 3 + 1]) * s - p[1], z = X[a * 3 + 2] + (X[b * 3 + 2] - X[a * 3 + 2]) * s - p[2]; out.push([x * u[0] + y * u[1] + z * u[2], x * w[0] + y * w[1] + z * w[2]]); } };
  let t = t0, enter = c0[0], steps = 0; at(enter);
  for (;;) { const cs = cuts(t), ex = cs[0][0] === enter[0] && cs[0][1] === enter[1] ? cs[1] : cs[0]; if (!ex) return null;
    const L = ET.get(ex[0] * nv + ex[1]); if (!L || L.length !== 2) return null; const tn = L[0] === t ? L[1] : L[0];
    if (tn === t0) break; if (++steps > maxSteps) return null; at(ex); const cn = cuts(tn); if (cn.length !== 2) return null; t = tn; enter = ex; }
  return { tape1: hullPerimeter9(P1), tape0: hullPerimeter9(P0), n: P1.length };
}
// the warp's direction at each welded vertex of a garment (the 3D direction the pattern's v runs, per triangle, averaged with a common sign)
function warpDirs(q, Wg, Pp) {
  const m = Wg.m, D = new Float64Array(m * 3), set = new Uint8Array(m), UV = q.uv, T = q.T;
  for (let t = 0; t < T.length; t += 3) { const i0 = T[t], i1 = T[t + 1], i2 = T[t + 2], du1 = UV[i1 * 2] - UV[i0 * 2], dv1 = UV[i1 * 2 + 1] - UV[i0 * 2 + 1], du2 = UV[i2 * 2] - UV[i0 * 2], dv2 = UV[i2 * 2 + 1] - UV[i0 * 2 + 1], det = du1 * dv2 - du2 * dv1;
    if (Math.abs(det) < 1e-12) continue; const d = [0, 0, 0]; for (let c = 0; c < 3; c++) { const e1 = Pp[i1 * 3 + c] - Pp[i0 * 3 + c], e2 = Pp[i2 * 3 + c] - Pp[i0 * 3 + c]; d[c] = (e2 * du1 - e1 * du2) / det; }
    const l = Math.hypot(...d); if (!(l > 1e-9)) continue;
    for (const i of [i0, i1, i2]) { const v = Wg.wid[i], s = set[v] && d[0] * D[v * 3] + d[1] * D[v * 3 + 1] + d[2] * D[v * 3 + 2] < 0 ? -1 : 1; for (let c = 0; c < 3; c++) D[v * 3 + c] += s * d[c] / l; set[v] = 1; } }
  for (let v = 0; v < m; v++) { const l = Math.hypot(D[v * 3], D[v * 3 + 1], D[v * 3 + 2]); if (l > 1e-9) for (let c = 0; c < 3; c++) D[v * 3 + c] /= l; }
  return D;
}
export function gradeGarment9({ q, Wg, Pw, Pp, body, O: Oin = {} }) {
  const O = { ...GRADE9, ...Oin }, m = Wg.m, D = warpDirs(q, Wg, Pp), { X1, X0, surf } = body, { E: ET, T, n: nv } = body.ET;
  const g = new Float64Array(m).fill(NaN), P0 = new Float64Array(m).fill(NaN), seen = new Set(), st = { samples: 0, rings: 0, open: 0, far: 0, odd: 0 };
  const ic = 1 / O.cell;
  for (let v = 0; v < m; v++) { const k = `${Math.floor(Pw[v * 3] * ic)},${Math.floor(Pw[v * 3 + 1] * ic)},${Math.floor(Pw[v * 3 + 2] * ic)}`; if (seen.has(k)) continue; seen.add(k); st.samples++;
    const nr = [D[v * 3], D[v * 3 + 1], D[v * 3 + 2]]; if (!(Math.abs(nr[0]) + Math.abs(nr[1]) + Math.abs(nr[2]) > 0.5)) continue;
    const c = surf.closestAny(Pw[v * 3], Pw[v * 3 + 1], Pw[v * 3 + 2], O.reach); if (!c || c.tri < 0) { st.far++; continue; }
    const r = ring9(X1, X0, T, nv, ET, c.tri, [c.px, c.py, c.pz], nr, O.maxSteps); if (!r) { st.open++; continue; }
    if (r.tape0 < O.minTape || r.tape1 < O.minTape) { st.odd++; continue; } const k1 = r.tape1 / r.tape0; if (!(k1 > O.gMin && k1 < O.gMax)) { st.odd++; continue; }
    g[v] = k1; P0[v] = r.tape0; st.rings++; }
  // between the tapes: filled along the cloth (each unknown vertex the mean of its known neighbours, wave by wave), then smoothed (the
  // grade is a property of the cut, not of one ring of skin)
  const A = adjacency(Wg.T, m).nb;
  for (let it = 0; it < O.fillIters; it++) { let any = 0; const ng = Float64Array.from(g), np = Float64Array.from(P0);
    for (let v = 0; v < m; v++) { if (!Number.isNaN(g[v])) continue; let s = 0, s2 = 0, k = 0; for (const u of A[v]) if (!Number.isNaN(g[u])) { s += g[u]; s2 += P0[u]; k++; } if (k) { ng[v] = s / k; np[v] = s2 / k; any++; } }
    g.set(ng); P0.set(np); if (!any) break; }
  for (let v = 0; v < m; v++) if (Number.isNaN(g[v])) { g[v] = 1; P0[v] = 0; }
  for (let it = 0; it < O.smooth; it++) { const ng = Float64Array.from(g); for (let v = 0; v < m; v++) { let s = g[v], k = 1; for (const u of A[v]) { s += g[u]; k++; } ng[v] = s / k; } g.set(ng); }
  const srt = Array.from(g).sort((a, b) => a - b), pc = f => +srt[Math.floor(f * (m - 1))].toFixed(3);
  return { g, P0, stats: { ...st, p05: pc(0.05), p50: pc(0.5), p95: pc(0.95), max: +srt[m - 1].toFixed(3), min: +srt[0].toFixed(3) } };
}
