// NOSE AND MOUTH (round 7 studio, 8 Oct, iteration 2): THE SKIN ONTO THE PERSON. hm08's nose and lips (the current person's face mesh,
// FACE7's face on hm08) carried onto the skin OUR anatomy makes (nose/index.js, mouth/index.js on ANAT8-HEAD's skull), at full bandwidth,
// with hm08's feature rings HELD on the anatomy's own curves: its nostril rims on the nostrils' margins, the lips' free edges on the
// stomion line, the painted vermilion border on the border the marginal orbicularis makes. Two halves:
//   THE FIT (node; labs/nosemouth/nm_wrap.mjs bakes it per person): fitWrap(mesh, target, o) -> the displacement of every vertex in the
//     nose-and-mouth window (control mesh and Loop level 1), in mm in the craniometric frame:
//       1. a thin-plate warp (3-D, phi = r, affine part) from the held pairs (landmarks + ring vertices -> the anatomy's points) and fixed
//          anchors round the window (identity there): the features are brought onto the anatomy's;
//       2. each OUTER vertex (its normal escapes the mesh) projected along its warped normal onto the target skin (the nearest crossing
//          within 6 mm), by its core weight (1 on the nose and the lips, easing to 0 over the window's margin); each INNER vertex (the
//          nostril's tunnel, the mouth's lining: its normal meets the mesh again) onto the nostril's vestibule wall where it is near, else
//          carried by the warp;
//       3. the displacement relaxed (umbrella smoothing, the held pairs fixed, the outer core re-projected), three rounds;
//     the report: the moved vertices, the mean / max displacement, the triangles that turned over, the outer vertices left off the skin.
//   THE HOOK (runtime, engine and export): nosemouth7(P, { name, url }) reads the person's bake (assets/person/nosemouth/<name>.json) and
//     adds its displacement to the body's bind geometry (the control mesh and the subdivided level, as ANAT8-PELVIS's hook does), renormals
//     the moved vertices and their ring, and gives the skin's painted vermilion (likeness/skin.js useLipLine's rows) and DETAIL7's lip lines
//     (h.mouth5.m.lines) OUR vermilion borders, so the red lip, its border's roll and the geometry are one. No bake for the person = nothing.
// Not a sculpt: the target is the skin the anatomy makes (cartilage, lobules, envelope; the lips' layers on the teeth) joined to the person's
// own face; hm08 only supplies the vertices (its topology and UVs: the skin's maps stay on it). Pure JS, no three.js.
// REV 2 (c4 it1, 16 Oct): THE WRAP IS FITTED ON THE FACE IT LANDS ON AND FOUND BY THAT FACE. Rev 1's bakes were found by the person's NAME
// and fitted (8 Oct) on the face WITHOUT face9; once face9 went on (15 Oct) the hook ADDED them to face9's face, so the nose and the lips
// moved twice where the two agreed and landed from a face that no longer existed elsewhere (integration7 measures/wrap_vs_face9_c5it3.txt;
// the it19 bench: ridges from the ala past the mouth's corner, slits, doubled lips). Now:
//   wrapKey(X, index): a digest of the FACE AT THIS HOOK (the region round the nose and the mouth, chosen by TOPOLOGY: the vertices within
//     REGION_RINGS rings of hm08's sn / sto / prn / n on the control mesh, so the region never depends on the geometry; 48 blocks of it,
//     each block's centroid at 0.2 mm, averaging float noise away so node and the page agree) + WRAP_CODE (this module's, the nose's and the
//     mouth's versions and the head anatomy's code the bake's skull came from). Whatever moved the face upstream (face9, FACE7, the eyes'
//     seat, a new ANAT8_CODE) gives a new key: a stale wrap is never added; the hook reports the key as missing with the command to bake it.
//   wrapProbe (a chain step for the baker only: labs/nosemouth/nm_wrap.mjs): hands the baker the face at this hook (control + level 1, the
//     lip lines) and its key; it moves nothing.
//   The bakes: assets/person/nosemouth/cache/<key>.json.
export const WRAP_VERSION = 2;
import { NOSE_VERSION } from './index.js';
import { MOUTH_VERSION } from '../mouth/index.js';
import { ANAT8_CODE } from '../../../face/face9.js';
export const WRAP_CODE = `wr${WRAP_VERSION}.no${NOSE_VERSION}.mo${MOUTH_VERSION}|${ANAT8_CODE}`;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- mesh helpers (positions: Float64Array n * 3, tri: index array)
export function vertexNormals(X, tri, n) {
  const N = new Float64Array(n * 3);
  for (let t = 0; t < tri.length; t += 3) { const a = tri[t], b = tri[t + 1], c = tri[t + 2]; if (a >= n || b >= n || c >= n) continue;
    const ux = X[b * 3] - X[a * 3], uy = X[b * 3 + 1] - X[a * 3 + 1], uz = X[b * 3 + 2] - X[a * 3 + 2], wx = X[c * 3] - X[a * 3], wy = X[c * 3 + 1] - X[a * 3 + 1], wz = X[c * 3 + 2] - X[a * 3 + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; for (const v of [a, b, c]) { N[v * 3] += nx; N[v * 3 + 1] += ny; N[v * 3 + 2] += nz; } }
  for (let v = 0; v < n; v++) { const l = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) || 1; N[v * 3] /= l; N[v * 3 + 1] /= l; N[v * 3 + 2] /= l; }
  return N;
}
export function neighbours(tri, n) {
  const S = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < tri.length; t += 3) { const a = tri[t], b = tri[t + 1], c = tri[t + 2]; if (a >= n || b >= n || c >= n) continue; S[a].add(b).add(c); S[b].add(a).add(c); S[c].add(a).add(b); }
  return S.map(s => Int32Array.from(s));
}
// does a ray from p along d meet the triangles (index list `tris`) within maxT? (Moller-Trumbore; the vertex's own fan skipped by eps)
function rayMeets(X, tris, p, d, maxT, skipV = -1) {
  for (let k = 0; k < tris.length; k += 3) { const a = tris[k], b = tris[k + 1], c = tris[k + 2]; if (a === skipV || b === skipV || c === skipV) continue;
    const e1x = X[b * 3] - X[a * 3], e1y = X[b * 3 + 1] - X[a * 3 + 1], e1z = X[b * 3 + 2] - X[a * 3 + 2], e2x = X[c * 3] - X[a * 3], e2y = X[c * 3 + 1] - X[a * 3 + 1], e2z = X[c * 3 + 2] - X[a * 3 + 2];
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x, det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det, tx = p[0] - X[a * 3], ty = p[1] - X[a * 3 + 1], tz = p[2] - X[a * 3 + 2], u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (v < 0 || u + v > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv; if (t > 0.05 && t < maxT) return true; }
  return false;
}
// INNER vertices: the normal meets the mesh again within maxT (the nostril's tunnel, the mouth's lining and the lips' inner faces)
export function innerVertices(X, tri, n, N, list, maxT = 9) {
  const keep = new Set(list), tris = []; for (let t = 0; t < tri.length; t += 3) { const a = tri[t], b = tri[t + 1], c = tri[t + 2]; if (keep.has(a) || keep.has(b) || keep.has(c)) tris.push(a, b, c); }
  const inner = new Uint8Array(n);
  for (const v of list) { const p = [X[v * 3] + N[v * 3] * 0.06, X[v * 3 + 1] + N[v * 3 + 1] * 0.06, X[v * 3 + 2] + N[v * 3 + 2] * 0.06]; if (rayMeets(X, tris, p, [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]], maxT, v)) inner[v] = 1; }
  return inner;
}
// ---------------------------------------------------------------- the thin-plate warp (3-D: phi(r) = r, an affine part; lambda = smoothing)
export function tpsWarp(src, dst, lambda = 0) {
  const n = src.length, m = n + 4, A = Array.from({ length: m }, () => new Float64Array(m)), B = Array.from({ length: m }, () => new Float64Array(3));
  for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) A[i][j] = Math.hypot(src[i][0] - src[j][0], src[i][1] - src[j][1], src[i][2] - src[j][2]); A[i][i] += lambda;
    const P = [1, src[i][0], src[i][1], src[i][2]]; for (let k = 0; k < 4; k++) { A[i][n + k] = P[k]; A[n + k][i] = P[k]; } for (let a = 0; a < 3; a++) B[i][a] = dst[i][a] - src[i][a]; }
  // Gaussian elimination with partial pivoting (m ~ 100-300)
  for (let c = 0; c < m; c++) { let p = c; for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) continue; [A[c], A[p]] = [A[p], A[c]]; [B[c], B[p]] = [B[p], B[c]];
    for (let r = 0; r < m; r++) { if (r === c) continue; const f = A[r][c] / A[c][c]; if (!f) continue; for (let k = c; k < m; k++) A[r][k] -= f * A[c][k]; for (let a = 0; a < 3; a++) B[r][a] -= f * B[c][a]; } }
  const W = B.map((b, i) => Math.abs(A[i][i]) < 1e-12 ? [0, 0, 0] : [b[0] / A[i][i], b[1] / A[i][i], b[2] / A[i][i]]);
  return p => { const out = [p[0], p[1], p[2]]; for (let i = 0; i < n; i++) { const r = Math.hypot(p[0] - src[i][0], p[1] - src[i][1], p[2] - src[i][2]); out[0] += W[i][0] * r; out[1] += W[i][1] * r; out[2] += W[i][2] * r; }
    const P = [1, p[0], p[1], p[2]]; for (let k = 0; k < 4; k++) { out[0] += W[n + k][0] * P[k]; out[1] += W[n + k][1] * P[k]; out[2] += W[n + k][2] * P[k]; } return out; };
}
// the nearest crossing of a field's zero level along p + t d, |t| <= maxT (step h); null if none
export function crossAlong(F, p, d, maxT = 6, h = 0.2, level = 0) {
  const f0 = F(p[0], p[1], p[2]) - level; if (Math.abs(f0) < 1e-4) return 0;
  let best = null;
  for (const sg of [1, -1]) { let tp = 0, fp = f0;
    for (let t = h; t <= maxT + 1e-9; t += h) { const tt = sg * t, f = F(p[0] + d[0] * tt, p[1] + d[1] * tt, p[2] + d[2] * tt) - level;
      if ((f < 0) !== (fp < 0)) { const tc = tp + (tt - tp) * fp / (fp - f); if (best == null || Math.abs(tc) < Math.abs(best)) best = tc; break; } tp = tt; fp = f; if (best != null && t > Math.abs(best)) break; } }
  return best;
}

// the nearest point of a field's zero level by gradient steps (a fallback where no crossing lies along the normal), within maxT; null if none
export function closest(F, p, maxT = 6, it = 6) { let q = [p[0], p[1], p[2]]; const h = 0.15;
  for (let i = 0; i < it; i++) { const f = F(q[0], q[1], q[2]), gx = (F(q[0] + h, q[1], q[2]) - F(q[0] - h, q[1], q[2])) / (2 * h), gy = (F(q[0], q[1] + h, q[2]) - F(q[0], q[1] - h, q[2])) / (2 * h), gz = (F(q[0], q[1], q[2] + h) - F(q[0], q[1], q[2] - h)) / (2 * h), g2 = gx * gx + gy * gy + gz * gz;
    if (g2 < 1e-8) return null; q = [q[0] - f * gx / g2, q[1] - f * gy / g2, q[2] - f * gz / g2]; if (Math.abs(f) < 0.02) break; }
  const d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]); return d <= maxT && Math.abs(F(q[0], q[1], q[2])) < 0.1 ? q : null; }
const faceN = (P, a, b, c) => { const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], wx = P[c * 3] - P[a * 3], wy = P[c * 3 + 1] - P[a * 3 + 1], wz = P[c * 3 + 2] - P[a * 3 + 2]; return [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx]; };

// ---------------------------------------------------------------- THE SKIN THAT DID NOT LAND IS A PLATE (c4 it3)
// Where the projection could not put hm08's skin on the anatomy (the conflicted vertices, the soft set: weight 0), rev 2 filled the
// displacement as a membrane under TENSION ONLY (harmonic: each vertex the mean of its ring). A tension-only membrane spans a hole with
// straight lines: across the nose's tip the fill was a TENT, a gable apex between the alae (the c4 it2 critic's L12 plot: the wrapped tip
// pointier than both the face under it and the anatomy's two domes, 3-5 mm behind them; the subnasale a sharp corner). Skin is not a soap
// film: it is a plate of finite thickness under a small pre-tension, and it carries the slope of the skin round a hole into it (C1), so a
// lobule stays round and a corner becomes a fillet. Energy (data where the projection landed; tension over every edge; bending as the
// square of the discrete Laplacian, on the rows `bend` = the unlanded skin and its ring, so the anatomy's own skin decides wherever it landed):
//   sum_i w_i |D_i - D*_i|^2 + lam sum_edges |D_i - D_j|^2 + kb sum_{k in bend} |D_k - mean_{N(k)} D|^2
// solved for the unknown vertices U (every other vertex keeps its D; outside the window D = 0) by conjugate gradients on
// (W + lam Lg + kb M^T M) delta = -grad. kb / lam from the plate's bending length ell = sqrt(B / T) (B = E h^3 / 12 (1 - nu^2), T = E eps0 h:
// ell = h / sqrt(12 eps0 (1 - nu^2)); h the envelope's thickness, eps0 the skin's resting pre-strain; Timoshenko and Woinowsky-Krieger
// 1959 ch. 1; the skin's pre-stretch ~1.1-1.2 in vivo, Jor et al. 2013, Flynn et al. 2011, as recalled): on a mesh of edge e, the umbrella
// is ~ e^2/4 the Laplacian and a vertex's area ~0.87 e^2, so kb / lam = 24 (ell / e)^2 (plateKb).
export const plateEll = (hSkin, eps0 = 0.12, nu = 0.49) => hSkin / Math.sqrt(12 * eps0 * (1 - nu * nu));
export const plateKb = (ell, edge, lam = 1) => lam * 24 * (ell / edge) ** 2;
export function plateSolve(D, o) {
  const { U, nb, n } = o, lam = o.lam ?? 1, kb = o.kb ?? 0, w = o.w || null, Ds = o.Dstar || null, iters = o.iters ?? 1200, tol = o.tol ?? 1e-7;
  if (!U.length) return { iters: 0 };
  const isU = new Uint8Array(n); for (const v of U) isU[v] = 1;
  // the bending rows: o.bend (a mask) or U; with their ring, so the plate meets the landed skin's slope
  const rowS = new Uint8Array(n); for (let v = 0; v < n; v++) if (o.bend ? o.bend[v] : isU[v]) { rowS[v] = 1; for (const u of nb[v]) rowS[u] = 1; }
  const rows = []; for (let v = 0; v < n; v++) if (rowS[v] && nb[v].length) rows.push(v);
  const umb = new Float64Array(n * 3);
  // y = (lam Lg + kb M^T M) x on U (x: full size)
  const op = (x, y) => {
    if (kb) for (const k of rows) { const r = nb[k], m = r.length; let sx = 0, sy = 0, sz = 0; for (const u of r) { sx += x[u * 3]; sy += x[u * 3 + 1]; sz += x[u * 3 + 2]; } umb[k * 3] = x[k * 3] - sx / m; umb[k * 3 + 1] = x[k * 3 + 1] - sy / m; umb[k * 3 + 2] = x[k * 3 + 2] - sz / m; }
    for (const i of U) { const r = nb[i]; let gx = 0, gy = 0, gz = 0;
      for (const j of r) { gx += lam * (x[i * 3] - x[j * 3]); gy += lam * (x[i * 3 + 1] - x[j * 3 + 1]); gz += lam * (x[i * 3 + 2] - x[j * 3 + 2]); }
      if (kb) { if (rowS[i]) { gx += kb * umb[i * 3]; gy += kb * umb[i * 3 + 1]; gz += kb * umb[i * 3 + 2]; }
        for (const k of r) { if (!rowS[k]) continue; const m = nb[k].length; gx -= kb * umb[k * 3] / m; gy -= kb * umb[k * 3 + 1] / m; gz -= kb * umb[k * 3 + 2] / m; } }
      y[i * 3] = gx; y[i * 3 + 1] = gy; y[i * 3 + 2] = gz; } };
  const g = new Float64Array(n * 3); op(D, g);
  if (w) for (const i of U) for (let a = 0; a < 3; a++) g[i * 3 + a] += w[i] * (D[i * 3 + a] - (Ds ? Ds[i * 3 + a] : 0));
  const r = new Float64Array(n * 3), p = new Float64Array(n * 3), Ap = new Float64Array(n * 3), del = new Float64Array(n * 3);
  let rr = 0; for (const i of U) for (let a = 0; a < 3; a++) { r[i * 3 + a] = -g[i * 3 + a]; p[i * 3 + a] = r[i * 3 + a]; rr += r[i * 3 + a] ** 2; }
  const rr0 = rr || 1; let it = 0;
  for (; it < iters && rr > tol * rr0; it++) { op(p, Ap); if (w) for (const i of U) for (let a = 0; a < 3; a++) Ap[i * 3 + a] += w[i] * p[i * 3 + a];
    let pAp = 0; for (const i of U) for (let a = 0; a < 3; a++) pAp += p[i * 3 + a] * Ap[i * 3 + a]; if (!(pAp > 0)) break;
    const al = rr / pAp; let rn = 0; for (const i of U) for (let a = 0; a < 3; a++) { const q = i * 3 + a; del[q] += al * p[q]; r[q] -= al * Ap[q]; rn += r[q] * r[q]; }
    const be = rn / rr; rr = rn; for (const i of U) for (let a = 0; a < 3; a++) { const q = i * 3 + a; p[q] = r[q] + be * p[q]; } }
  for (const i of U) for (let a = 0; a < 3; a++) D[i * 3 + a] += del[i * 3 + a];
  return { iters: it, rel: +Math.sqrt(rr / rr0).toExponential(1), rows: rows.length };
}

// ---------------------------------------------------------------- THE FIT
// mesh { X (Float64Array n*3, mm), tri, n }; target { S (the skin field), vest (the vestibules' field: negative in the cavity) | null }
// (c4 it3) o.plate { kb }: the unlanded skin's fills (the soft set, the bridge, the settle's weight-0 set) as a plate (plateSolve);
// absent = rev 2's tension-only fills
// o { win: Float32Array (0..1: 1 = the window's core, 0 = untouched), warp: Float32Array (the warp's reach: 1 inside, 0 outside),
//     pairs: Map(v -> [x, y, z]) held, anchors: [v] fixed, inner: Uint8Array, rounds, lambda }
export function fitWrap(mesh, target, o) {
  const { X, tri, n } = mesh, { S, vest } = target, win = o.win, reach = o.warp, inner = o.inner, pairs = o.pairs, t0 = Date.now();
  // (rev 2) o.soft: vertices NOT projected (the nostril's underside and tunnel, the commissures' fold, the linings: where hm08's topology
  // cannot follow the anatomy's form): the warp carries them, and at the end they take the membrane's equilibrium between the projected skin
  // round them (harmonic: below, 'the bridge')
  const softV = o.soft || new Uint8Array(n);
  const list = []; for (let v = 0; v < n; v++) if (reach[v] > 0) list.push(v);
  // 1. the warp
  const src = [], dst = []; for (const [v, q] of pairs) { src.push([X[v * 3], X[v * 3 + 1], X[v * 3 + 2]]); dst.push(q); }
  for (const v of o.anchors) { const p = [X[v * 3], X[v * 3 + 1], X[v * 3 + 2]]; src.push(p); dst.push(p); }
  const W = tpsWarp(src, dst, o.lambda ?? 0.0);
  const Y = Float64Array.from(X);
  for (const v of list) { const p = [X[v * 3], X[v * 3 + 1], X[v * 3 + 2]], q = W(p), k = reach[v]; for (let a = 0; a < 3; a++) Y[v * 3 + a] = p[a] + k * (q[a] - p[a]); }
  for (const [v, q] of pairs) for (let a = 0; a < 3; a++) Y[v * 3 + a] = q[a];
  // 2-3. project, relax, re-project
  const nb = neighbours(tri, n), held = new Uint8Array(n); for (const v of pairs.keys()) held[v] = 1;
  // the projection's directions: the warped mesh's normals smoothed over two rings (a single vertex's normal swings where the warp
  // bunches the mesh, and neighbours then cross the target on different sides: folds); o.dirAt(v, p, n) may set a vertex's own (the
  // nose's underside projects vertically: its normals fan round the small hm08 nostril)
  const smoothN = () => { let N = vertexNormals(Y, tri, n); for (let it = 0; it < 2; it++) { const M = Float64Array.from(N); for (const v of list) { const r = nb[v]; let sx = N[v * 3], sy = N[v * 3 + 1], sz = N[v * 3 + 2]; for (const u of r) { sx += N[u * 3]; sy += N[u * 3 + 1]; sz += N[u * 3 + 2]; } const l = Math.hypot(sx, sy, sz) || 1; M[v * 3] = sx / l; M[v * 3 + 1] = sy / l; M[v * 3 + 2] = sz / l; } N = M; } return N; };
  const project = (maxT, frac = 1) => { const N = smoothN(); let on = 0, off = 0;
    for (const v of list) { const w = win[v]; if (w <= 0 || held[v] || softV[v]) continue; const p = [Y[v * 3], Y[v * 3 + 1], Y[v * 3 + 2]]; let d = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]];
      if (o.dirAt && !inner[v]) d = o.dirAt(v, p, d) || d;
      let t = null; if (!inner[v]) t = crossAlong(S, p, d, maxT); else if (vest) t = crossAlong(vest, p, d, Math.min(3, maxT));
      if (t == null && !inner[v]) { const q = closest(S, p, maxT); if (q) { on++; for (let a = 0; a < 3; a++) Y[v * 3 + a] = p[a] + frac * w * (q[a] - p[a]); continue; } }
      if (t == null) { if (!inner[v]) off++; continue; } on++; for (let a = 0; a < 3; a++) Y[v * 3 + a] = p[a] + frac * w * t * d[a]; }
    return { on, off }; };
  // the UNTANGLING: a turned-over triangle's free vertices toward their rings' means (positions), the outer core re-projected; until none
  // turns over or 12 passes
  const N0t = (() => { const F = []; for (let t = 0; t < tri.length; t += 3) { const a = tri[t], b = tri[t + 1], c = tri[t + 2]; if (a >= n || b >= n || c >= n) { F.push(null); continue; } F.push(faceN(X, a, b, c)); } return F; })();
  const untangle = (passes) => { let last = 0;
    for (let ps = 0; ps < passes; ps++) { const bad = new Set(); for (let t = 0, f = 0; t < tri.length; t += 3, f++) { const a = tri[t], b = tri[t + 1], c = tri[t + 2]; if (!N0t[f] || !(reach[a] > 0 || reach[b] > 0 || reach[c] > 0)) continue; const m = faceN(Y, a, b, c), o0 = N0t[f]; if (m[0] * o0[0] + m[1] * o0[1] + m[2] * o0[2] < 0) { bad.add(a); bad.add(b); bad.add(c); } }
      last = bad.size; if (!bad.size) break;
      const grow = new Set(bad); for (const v of bad) for (const u of nb[v]) grow.add(u);
      for (const v of grow) { if (held[v] || !(reach[v] > 0)) continue; const r = nb[v]; let mx = 0, my = 0, mz = 0; for (const u of r) { mx += Y[u * 3]; my += Y[u * 3 + 1]; mz += Y[u * 3 + 2]; } const k = bad.has(v) ? 0.7 : 0.35;
        Y[v * 3] += k * (mx / r.length - Y[v * 3]); Y[v * 3 + 1] += k * (my / r.length - Y[v * 3 + 1]); Y[v * 3 + 2] += k * (mz / r.length - Y[v * 3 + 2]); }
      const N = vertexNormals(Y, tri, n); for (const v of grow) { if (held[v] || inner[v] || softV[v] || !(win[v] > 0.5)) continue; const p = [Y[v * 3], Y[v * 3 + 1], Y[v * 3 + 2]], t = crossAlong(S, p, [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]], 1.5, 0.1); if (t != null) for (let a = 0; a < 3; a++) Y[v * 3 + a] = p[a] + win[v] * t * N[v * 3 + a]; } }
    return last; };
  const relax = (iters) => { const D = new Float64Array(n * 3); for (const v of list) for (let a = 0; a < 3; a++) D[v * 3 + a] = Y[v * 3 + a] - X[v * 3 + a];
    for (let it = 0; it < iters; it++) for (const v of list) { if (held[v]) continue; const r = nb[v]; if (!r.length) continue; const beta = inner[v] ? 0.6 : lerpN(0.6, 0.25, win[v]);
      let sx = 0, sy = 0, sz = 0; for (const u of r) { sx += D[u * 3]; sy += D[u * 3 + 1]; sz += D[u * 3 + 2]; } const m = r.length;
      D[v * 3] += beta * (sx / m - D[v * 3]); D[v * 3 + 1] += beta * (sy / m - D[v * 3 + 1]); D[v * 3 + 2] += beta * (sz / m - D[v * 3 + 2]); }
    for (const v of list) for (let a = 0; a < 3; a++) Y[v * 3 + a] = X[v * 3 + a] + D[v * 3 + a]; };
  // tangential relaxation of the outer core: each vertex toward its ring's mean IN ITS TANGENT PLANE (the spacing evens out along the skin
  // where the projection bunched it, e.g. both sides of the alar-facial crease onto the crease), then re-projected
  const tangential = (iters) => { for (let it = 0; it < iters; it++) { const N = vertexNormals(Y, tri, n);
    for (const v of list) { if (held[v] || inner[v] || softV[v] || win[v] < 0.3) continue; const r = nb[v]; if (!r.length) continue; let mx = 0, my = 0, mz = 0; for (const u of r) { mx += Y[u * 3]; my += Y[u * 3 + 1]; mz += Y[u * 3 + 2]; }
      let dx = mx / r.length - Y[v * 3], dy = my / r.length - Y[v * 3 + 1], dz = mz / r.length - Y[v * 3 + 2]; const dn = dx * N[v * 3] + dy * N[v * 3 + 1] + dz * N[v * 3 + 2]; dx -= dn * N[v * 3]; dy -= dn * N[v * 3 + 1]; dz -= dn * N[v * 3 + 2];
      const k = 0.5 * win[v]; Y[v * 3] += k * dx; Y[v * 3 + 1] += k * dy; Y[v * 3 + 2] += k * dz; } } };
  const flipCount = () => { let c = 0; const at = []; for (let t = 0, f = 0; t < tri.length; t += 3, f++) { const a = tri[t], b = tri[t + 1], cc = tri[t + 2]; if (!N0t[f] || inner[a] || inner[b] || inner[cc] || !(reach[a] > 0 || reach[b] > 0 || reach[cc] > 0)) continue; const m = faceN(Y, a, b, cc), o0 = N0t[f]; if (m[0] * o0[0] + m[1] * o0[1] + m[2] * o0[2] < 0) { c++; if (at.length < 60) at.push([+X[a * 3].toFixed(1), +X[a * 3 + 1].toFixed(1), held[a] + held[b] + held[cc]]); } } return { c, at }; };
  const rounds = [{ afterWarp: flipCount() }];
  // PROGRESSIVE: the mesh glides onto the skin in steps (each a share of the remaining way, then relaxed and untangled), so neighbours
  // never jump to opposite sides of a crease in one move; then the exact projection
  // THE SKIN AS A MEMBRANE ON THE ENVELOPE (c3 it1): after the projection hm08's vertices sit on the anatomy's skin, but with hm08's own
  // spacing bent to the new shape: where the anatomy's alar base, sill and nostril floor differ from hm08's (a small tunnel under the tip
  // meeting the alar crease in a fan of slivers: the 'notch' at the nostril's lateral corner), triangles are crushed or folded. Real skin
  // there is a continuous membrane: the dermis over the fibrofatty lobule rolls into the vestibule (Oneal and Beil 2010; the soft
  // triangle and the sill as skin, not a crease) and it carries in-plane tension, so it neither bunches into slivers nor folds tighter
  // than its own thickness. The membrane step: each free vertex moves IN THE SKIN'S TANGENT PLANE under edge springs whose rest
  // lengths are the person's own skin spacing (hm08's edges on the current face, scaled by the window's mean stretch so the membrane is
  // under uniform pre-tension, never a target shape), then goes back onto the envelope (outer: the skin S along its normal; inner: the
  // vestibule's wall where near); BENDING: an edge whose two faces fold sharper than the skin's own radius allows (dihedral over
  // o.membrane.maxBend, from the dermis + the lobule's half thickness) relaxes its four vertices toward their rings (umbrella), re-projected.
  // o.membrane = { iters, k, maxBend (deg) }; off when absent.
  const membrane = (M) => { if (!M) return null; const iters = M.iters ?? 40, k = M.k ?? 0.35, maxBend = (M.maxBend ?? 50) * Math.PI / 180;
    const core = list.filter(v => !held[v] && !softV[v] && win[v] > 0.05), E = []; const seen = new Set();
    for (const v of list) for (const u of nb[v]) { const key = v < u ? v * 4194304 + u : u * 4194304 + v; if (seen.has(key)) continue; seen.add(key); E.push(v, u); }
    const L0 = new Float64Array(E.length / 2); let s0 = 0, s1 = 0;
    for (let e = 0; e < E.length; e += 2) { const a = E[e], b = E[e + 1]; L0[e / 2] = Math.hypot(X[a * 3] - X[b * 3], X[a * 3 + 1] - X[b * 3 + 1], X[a * 3 + 2] - X[b * 3 + 2]); s0 += L0[e / 2]; s1 += Math.hypot(Y[a * 3] - Y[b * 3], Y[a * 3 + 1] - Y[b * 3 + 1], Y[a * 3 + 2] - Y[b * 3 + 2]); }
    const pre = s1 / (s0 || 1); for (let i = 0; i < L0.length; i++) L0[i] *= pre;
    // face list touching the core, and edge -> faces for the bending check
    const inL = new Uint8Array(n); for (const v of list) inL[v] = 1; const F = []; for (let t = 0; t < tri.length; t += 3) { const a = tri[t], b = tri[t + 1], c = tri[t + 2]; if (a < n && b < n && c < n && (inL[a] && inL[b] && inL[c])) F.push(a, b, c); }
    const EF = new Map(); for (let f = 0; f < F.length; f += 3) for (let q = 0; q < 3; q++) { const a = F[f + q], b = F[f + (q + 1) % 3], key = a < b ? a * 4194304 + b : b * 4194304 + a; (EF.get(key) || EF.set(key, []).get(key)).push(f); }
    const bendCount = () => { let c = 0; const bad = new Set(); for (const [key, fs] of EF) { if (fs.length !== 2) continue; const n1 = faceN(Y, F[fs[0]], F[fs[0] + 1], F[fs[0] + 2]), n2 = faceN(Y, F[fs[1]], F[fs[1] + 1], F[fs[1] + 2]); const l = Math.hypot(...n1) * Math.hypot(...n2); if (!l) continue; const cs = (n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]) / l; if (Math.acos(clamp(cs, -1, 1)) > maxBend) { c++; for (const f of fs) for (let q = 0; q < 3; q++) bad.add(F[f + q]); } } return { c, bad }; };
    const b0 = bendCount().c; let last = b0;
    const G = new Float64Array(n * 3);
    for (let it = 0; it < iters; it++) {
      G.fill(0); for (let e = 0; e < E.length; e += 2) { const a = E[e], b = E[e + 1]; const dx = Y[b * 3] - Y[a * 3], dy = Y[b * 3 + 1] - Y[a * 3 + 1], dz = Y[b * 3 + 2] - Y[a * 3 + 2], l = Math.hypot(dx, dy, dz) || 1e-9, f = (l - L0[e / 2]) / l * 0.5;
        G[a * 3] += f * dx; G[a * 3 + 1] += f * dy; G[a * 3 + 2] += f * dz; G[b * 3] -= f * dx; G[b * 3 + 1] -= f * dy; G[b * 3 + 2] -= f * dz; }
      const N = vertexNormals(Y, tri, n);
      for (const v of core) { const r = nb[v].length || 1; let gx = G[v * 3] / r, gy = G[v * 3 + 1] / r, gz = G[v * 3 + 2] / r; const gn = gx * N[v * 3] + gy * N[v * 3 + 1] + gz * N[v * 3 + 2]; gx -= gn * N[v * 3]; gy -= gn * N[v * 3 + 1]; gz -= gn * N[v * 3 + 2];
        const w = k * win[v]; Y[v * 3] += w * gx; Y[v * 3 + 1] += w * gy; Y[v * 3 + 2] += w * gz; }
      // bending: the over-folded edges' vertices toward their rings
      const { c, bad } = bendCount(); last = c;
      for (const v of bad) { if (held[v] || !(win[v] > 0.05)) continue; const rr = nb[v]; let mx = 0, my = 0, mz = 0; for (const u of rr) { mx += Y[u * 3]; my += Y[u * 3 + 1]; mz += Y[u * 3 + 2]; } const w = 0.5 * win[v];
        Y[v * 3] += w * (mx / rr.length - Y[v * 3]); Y[v * 3 + 1] += w * (my / rr.length - Y[v * 3 + 1]); Y[v * 3 + 2] += w * (mz / rr.length - Y[v * 3 + 2]); }
      // back onto the envelope
      const N2 = vertexNormals(Y, tri, n);
      for (const v of core) { const p = [Y[v * 3], Y[v * 3 + 1], Y[v * 3 + 2]], d = [N2[v * 3], N2[v * 3 + 1], N2[v * 3 + 2]]; let t = null;
        if (!inner[v]) t = crossAlong(S, p, d, 1.5, 0.1); else if (vest) t = crossAlong(vest, p, d, 1.0, 0.1);
        if (t != null) for (let a = 0; a < 3; a++) Y[v * 3 + a] = p[a] + win[v] * t * d[a]; } }
    return { bendBefore: b0, bendAfter: last, pretension: +pre.toFixed(3), iters }; };
  const K = o.steps ?? 6;
  for (let s = 1; s <= K; s++) { const pr = project(s <= K / 2 ? 10 : 6, 1 / (K + 1 - s)); relax(3); tangential(3); const u = untangle(4); rounds.push({ step: s, ...pr, untangle: u }); }
  rounds.push(project(1.5)); rounds.push({ untangled: untangle(10), final: flipCount().c });
  if (o.membrane) { const mr = membrane(o.membrane); rounds.push({ membrane: mr, untangled: untangle(10), final: flipCount().c }); }
  // (rev 2, c4 it1) THE BRIDGE: where hm08's topology cannot follow the anatomy (its small nostril tunnel against the anatomy's long nostril;
  // its blunt commissure against the corner the anatomy tucks into the cheek), projection leaves triangles turned over and edges folded
  // sharper than skin can fold. There the skin is a membrane under uniform tension spanning between the vertices that DID land on the
  // anatomy: their displacement is held, and the displacement of the conflicted vertices (every vertex of a turned triangle or of a fold
  // over o.bridge.maxFold degrees, grown by o.bridge.grow rings, never a held pair) is the membrane's equilibrium: harmonic (each the mean of
  // its ring), solved by Gauss-Seidel. Not re-projected: the skin bridges the conflict instead of being dragged through it. Repeated with one
  // more ring while anything is still turned (o.bridge.rounds). Off when o.bridge is absent.
  const bridge = (Bo) => { if (!Bo) return null; const maxFold = (Bo.maxFold ?? 70) * Math.PI / 180, out = [];
    const inL = new Uint8Array(n); for (const v of list) inL[v] = 1;
    const EF = new Map(); for (let t = 0; t < tri.length; t += 3) { const a = tri[t], b = tri[t + 1], c = tri[t + 2]; if (a >= n || b >= n || c >= n || !(inL[a] && inL[b] && inL[c])) continue; for (let q = 0; q < 3; q++) { const x = tri[t + q], y = tri[t + (q + 1) % 3], key = x < y ? x * 4194304 + y : y * 4194304 + x; (EF.get(key) || EF.set(key, []).get(key)).push(t); } }
    const conflicted = () => { const bad = new Set(); let turned = 0, folded = 0;
      for (let t = 0, f = 0; t < tri.length; t += 3, f++) { const a = tri[t], b = tri[t + 1], c = tri[t + 2]; if (!N0t[f] || !(inL[a] && inL[b] && inL[c])) continue; const m = faceN(Y, a, b, c), o0 = N0t[f]; if (m[0] * o0[0] + m[1] * o0[1] + m[2] * o0[2] < 0) { turned++; bad.add(a); bad.add(b); bad.add(c); } }
      for (const fs of EF.values()) { if (fs.length !== 2) continue; const t1 = fs[0], t2 = fs[1], n1 = faceN(Y, tri[t1], tri[t1 + 1], tri[t1 + 2]), n2 = faceN(Y, tri[t2], tri[t2 + 1], tri[t2 + 2]), l = Math.hypot(...n1) * Math.hypot(...n2); if (!l) continue;
        const ang = Math.acos(clamp((n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]) / l, -1, 1)); if (ang <= maxFold) continue;
        const m1 = faceN(X, tri[t1], tri[t1 + 1], tri[t1 + 2]), m2 = faceN(X, tri[t2], tri[t2 + 1], tri[t2 + 2]), l0 = Math.hypot(...m1) * Math.hypot(...m2), a0 = l0 ? Math.acos(clamp((m1[0] * m2[0] + m1[1] * m2[1] + m1[2] * m2[2]) / l0, -1, 1)) : 0;
        if (ang <= a0 + 0.05) continue;   // a fold the person's own skin already had (the nostril's rim, the lips' meeting line) is not the fit's
        folded++; for (const t of fs) for (let q = 0; q < 3; q++) bad.add(tri[t + q]); }
      return { bad, turned, folded }; };
    let grow = Bo.grow ?? 2;
    for (let r = 0; r < (Bo.rounds ?? 4); r++) { const { bad, turned, folded } = conflicted(); out.push({ turned, folded, verts: bad.size }); if (!bad.size) break;
      let set = new Set(bad); for (let g = 0; g < grow; g++) { const nx = new Set(set); for (const v of set) for (const u of nb[v]) if (inL[u]) nx.add(u); set = nx; }
      const free = [...set].filter(v => !held[v] && inL[v] && reach[v] > 0); if (!free.length) break;
      const isFree = new Uint8Array(n); for (const v of free) isFree[v] = 1;
      const D = new Float64Array(n * 3); for (const v of list) for (let a = 0; a < 3; a++) D[v * 3 + a] = Y[v * 3 + a] - X[v * 3 + a];
      // (c4 it3) the fill is the plate's equilibrium (kb 0: rev 2's harmonic membrane)
      const ps = plateSolve(D, { U: free, nb, n, lam: 1, kb: o.plate?.kb ?? 0, iters: Bo.iters ?? 1200 }); out[out.length - 1].plate = ps;
      for (const v of free) for (let a = 0; a < 3; a++) Y[v * 3 + a] = X[v * 3 + a] + D[v * 3 + a];
      grow++; }
    const last = conflicted(); out.push({ turned: last.turned, folded: last.folded, verts: last.bad.size, final: true }); return out; };
  if (o.soft) { const free = list.filter(v => softV[v] && !held[v]), D = new Float64Array(n * 3); for (const v of list) for (let a = 0; a < 3; a++) D[v * 3 + a] = Y[v * 3 + a] - X[v * 3 + a];
    const ps = plateSolve(D, { U: free, nb, n, lam: 1, kb: o.plate?.kb ?? 0 });   // (c4 it3) the plate's equilibrium (kb 0: harmonic)
    for (const v of free) for (let a = 0; a < 3; a++) Y[v * 3 + a] = X[v * 3 + a] + D[v * 3 + a];
    rounds.push({ soft: free.length, plate: ps, final: flipCount().c }); }
  if (o.bridge) rounds.push({ bridge: bridge(o.bridge), final: flipCount().c });
  // (rev 2) THE SETTLE: the skin as a membrane under tension fitted to what the projection found (a screened Poisson problem on the
  // displacement: each vertex's data = where projection put it, weighted 1 on the outer skin that landed cleanly, 4 on the held rings, 0 on the
  // soft set and on every vertex of a turned triangle or an over-folded edge; the edges' tension lambda couples neighbours, the window's
  // border is held at zero). Its length scale sqrt(lambda) edges is the skin's own: it cannot carry a fold sharper than its thickness over an
  // edge, so the conflicts settle into smooth skin and the rest stays on the anatomy. Rounds: the conflicted set re-found and grown by one
  // ring each time while triangles are still turned.
  if (o.settle) { const lam = o.settle.lambda ?? 1, out = [], inL = new Uint8Array(n); for (const v of list) inL[v] = 1;
    const Dstar = new Float64Array(n * 3); for (const v of list) for (let a = 0; a < 3; a++) Dstar[v * 3 + a] = Y[v * 3 + a] - X[v * 3 + a];
    const turnedSet = () => { const bad = new Set(); for (let t = 0, f = 0; t < tri.length; t += 3, f++) { const a = tri[t], b = tri[t + 1], c = tri[t + 2]; if (!N0t[f] || !(inL[a] || inL[b] || inL[c])) continue; const m = faceN(Y, a, b, c), o0 = N0t[f]; if (m[0] * o0[0] + m[1] * o0[1] + m[2] * o0[2] < 0) { bad.add(a); bad.add(b); bad.add(c); } } return bad; };
    let conf = turnedSet(), ring = 1;
    for (let r = 0; r < (o.settle.rounds ?? 4); r++) {
      let set = new Set(conf); for (let g = 0; g < ring; g++) { const nx = new Set(set); for (const v of set) for (const u of nb[v]) nx.add(u); set = nx; }
      const w = new Float64Array(n), wd = o.settle.data ?? 1, wr = o.settle.rings ?? 4; for (const v of list) w[v] = held[v] ? wr : (softV[v] || inner[v] || set.has(v)) ? 0 : wd * win[v];
      const D = new Float64Array(n * 3); for (const v of list) for (let a = 0; a < 3; a++) D[v * 3 + a] = Y[v * 3 + a] - X[v * 3 + a];
      // (the held rings take a weight, not a pin: an L22 trial with the rings pinned and data 3 turned 53 outer triangles against 7: the rings'
      // own correspondence onto the anatomy's curves is what folds; the membrane may move them ~1-4 mm off the curve to stay smooth)
      // (c4 it3) solved exactly (CG; rev 2 ran 250 Gauss-Seidel sweeps); the bending rows on the weight-0 skin and its ring (kb 0: rev 2's)
      const bend = new Uint8Array(n); for (const v of list) if (!(w[v] > 0)) bend[v] = 1;
      const ps = plateSolve(D, { U: list, nb, n, lam, kb: o.plate?.kb ?? 0, w, Dstar, bend });
      for (const v of list) for (let a = 0; a < 3; a++) Y[v * 3 + a] = X[v * 3 + a] + D[v * 3 + a];
      const now = turnedSet(); out.push({ conflicted: set.size, turnedVerts: now.size, plate: ps }); if (!now.size) break; for (const v of now) conf.add(v); ring++; }
    rounds.push({ settle: out, final: flipCount().c }); }
  // the report
  const N0 = vertexNormals(X, tri, n), N1 = vertexNormals(Y, tri, n); let flips = 0, flipsIn = 0, flipsOut = 0, moved = 0, sum = 0, mx = 0, offSkin = 0, innerN = 0; const flipAt = [];
  const inL = new Uint8Array(n); for (const v of list) inL[v] = 1;
  for (let t = 0; t < tri.length; t += 3) { const a = tri[t], b = tri[t + 1], c = tri[t + 2]; if (a >= n || b >= n || c >= n || !(inL[a] || inL[b] || inL[c])) continue;
    const fn = (P) => { const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], wx = P[c * 3] - P[a * 3], wy = P[c * 3 + 1] - P[a * 3 + 1], wz = P[c * 3 + 2] - P[a * 3 + 2]; return [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx]; };
    const f0 = fn(X), f1 = fn(Y); if (f0[0] * f1[0] + f0[1] * f1[1] + f0[2] * f1[2] < 0) { flips++; if (inner[a] || inner[b] || inner[c]) flipsIn++; else { flipsOut++; const cy = (Y[a * 3 + 1] + Y[b * 3 + 1] + Y[c * 3 + 1]) / 3, cx = (Y[a * 3] + Y[b * 3] + Y[c * 3]) / 3; flipAt.push([+cx.toFixed(1), +cy.toFixed(1), +Math.max(win[a], win[b], win[c]).toFixed(2)]); } } }
  const D = new Float64Array(n * 3);
  for (const v of list) { const dx = Y[v * 3] - X[v * 3], dy = Y[v * 3 + 1] - X[v * 3 + 1], dz = Y[v * 3 + 2] - X[v * 3 + 2], l = Math.hypot(dx, dy, dz); D[v * 3] = dx; D[v * 3 + 1] = dy; D[v * 3 + 2] = dz;
    if (l > 0.02) { moved++; sum += l; mx = Math.max(mx, l); } if (inner[v]) innerN++; else if (win[v] > 0.95 && Math.abs(S(Y[v * 3], Y[v * 3 + 1], Y[v * 3 + 2])) > 0.6) offSkin++; }
  void N0; void N1;
  // the skin's sharp folds in the window (outer faces only; dihedral > 45 deg), before (the person's own) and after
  const sharp = (P) => { const EF = new Map(); for (let t = 0; t < tri.length; t += 3) { const a = tri[t], b = tri[t + 1], c = tri[t + 2]; if (a >= n || b >= n || c >= n || inner[a] || inner[b] || inner[c] || !(win[a] > 0.3 && win[b] > 0.3 && win[c] > 0.3)) continue; for (let q = 0; q < 3; q++) { const x = tri[t + q], y = tri[t + (q + 1) % 3], key = x < y ? x * 4194304 + y : y * 4194304 + x; (EF.get(key) || EF.set(key, []).get(key)).push(t); } }
    let c45 = 0, c70 = 0; for (const fs of EF.values()) { if (fs.length !== 2) continue; const n1 = faceN(P, tri[fs[0]], tri[fs[0] + 1], tri[fs[0] + 2]), n2 = faceN(P, tri[fs[1]], tri[fs[1] + 1], tri[fs[1] + 2]), l = Math.hypot(...n1) * Math.hypot(...n2); if (!l) continue; const ang = Math.acos(clamp((n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]) / l, -1, 1)) * 180 / Math.PI; if (ang > 45) c45++; if (ang > 70) c70++; } return { over45: c45, over70: c70 }; };
  const sharpness = { before: sharp(X), after: sharp(Y) };
  return { D, Y, list, report: { sharpness, verts: list.length, moved, meanMm: +(sum / Math.max(1, moved)).toFixed(2), maxMm: +mx.toFixed(2), flips, flipsIn, flipsOut, flipAt: flipAt.slice(0, 400), offSkin, inner: innerN, pairs: pairs.size, anchors: o.anchors.length, rounds, ms: Date.now() - t0 } };
}
const lerpN = (a, b, t) => a + (b - a) * clamp(t, 0, 1);

// ---------------------------------------------------------------- THE KEY: what the face at the hook is (rev 2)
// hm08's landmark vertices (FACE P2's ids: sn, sto, prn, n) seed the region; REGION_RINGS rings on the control mesh's topology (~45 mm round
// the nose and the mouth at hm08's ~2.9 mm edges): the window the fit moves and the anchors it holds lie inside it
export const REGION_SEEDS = [5072, 493, 297, 132], REGION_RINGS = 16, HEAD_NB = 13380;
const _regions = new Map();
export function wrapRegion(index, nb = HEAD_NB) {
  const k = index.length + ':' + nb; if (_regions.has(k)) return _regions.get(k);
  const nbr = Array.from({ length: nb }, () => []);
  for (let t = 0; t < index.length; t += 3) { const a = index[t], b = index[t + 1], c = index[t + 2]; if (a >= nb || b >= nb || c >= nb) continue; nbr[a].push(b, c); nbr[b].push(a, c); nbr[c].push(a, b); }
  const ring = new Int32Array(nb).fill(-1); let front = REGION_SEEDS.filter(v => v < nb); for (const v of front) ring[v] = 0;
  for (let r = 1; r <= REGION_RINGS; r++) { const next = []; for (const v of front) for (const u of nbr[v]) if (ring[u] < 0) { ring[u] = r; next.push(u); } front = next; }
  const list = []; for (let v = 0; v < nb; v++) if (ring[v] >= 0) list.push(v);
  const out = Int32Array.from(list); _regions.set(k, out); return out;
}
// FNV-1a over a string, two lanes -> 16 hex (face9.js's construction; our own copy so the two keys stay independent)
function fnv(s) { let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b ^ c, 0x01000193 + 2 * 0x100) >>> 0; b = (b ^ (b >>> 13)) >>> 0; }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0'); }
// X: the control mesh's positions (bind metres); index: its triangles (the full list: the hook runs with the draw cull lifted)
export function wrapDigest(X, index, k = 48) { const R = wrapRegion(index), out = [], step = Math.ceil(R.length / k);
  for (let b = 0; b < k; b++) { const i0 = b * step, i1 = Math.min(R.length, i0 + step); let x = 0, y = 0, z = 0, n = 0; for (let i = i0; i < i1; i++) { const v = R[i]; x += X[v * 3]; y += X[v * 3 + 1]; z += X[v * 3 + 2]; n++; }
    if (n) out.push(Math.round(x / n * 5000), Math.round(y / n * 5000), Math.round(z / n * 5000)); }
  return out; }
export const wrapKey = (X, index, code = WRAP_CODE) => fnv(code + '#' + wrapDigest(X, index).join(','));

// ---------------------------------------------------------------- THE HOOK (runtime): the bake for THIS face onto its bind geometry
const ASSETS = new URL('../../../../../assets/person/nosemouth/cache/', import.meta.url).href;
const _bakes = new Map();
export async function wrapBake(key, { url = null } = {}) {
  const u = (url || ASSETS) + key + '.json';
  if (!_bakes.has(u)) _bakes.set(u, fetch(u).then(r => (r.ok ? r.json() : null)).catch(() => null));
  return _bakes.get(u);
}
// the level-1 geometry the person carries (Loop level 1 of the control mesh), if any
const level1Of = (body, g0) => { const subs = Object.entries(body.userData?.geoms || {}).filter(([k, g]) => +k > 0 && g !== g0).map(([, g]) => g);
  if (body.geometry !== g0 && !subs.includes(body.geometry)) subs.push(body.geometry); return subs.find(g => (g.userData?.subdiv?.levels ?? 0) === 1) || null; };
// THE PROBE (the baker's chain step; moves nothing): o.probe receives the face at this hook
export async function wrapProbe(P, o = {}) {
  const h = P?.h, body = h?.body, g0 = body?.userData?.geomL0 || body?.geometry; if (!g0?.index) return { skipped: 'no body geometry' };
  const X0 = Float32Array.from(g0.attributes.position.array), idx = Uint32Array.from(g0.index.array), key = wrapKey(X0, idx), g1 = level1Of(body, g0);
  const lines = h.mouth5?.m?.lines || h.likeness?.skin?.lipLine?.lines || null;
  if (typeof o.probe === 'function') o.probe({ key, code: WRAP_CODE, X0, index: idx, n0: g0.attributes.position.count,
    L1: g1 ? { X: Float32Array.from(g1.attributes.position.array), n: g1.attributes.position.count, nIn: g1.userData.subdiv?.nIn ?? null, index: Uint32Array.from(g1.index.array) } : null,
    lines: lines ? JSON.parse(JSON.stringify(lines)) : null, name: o.name, register: o.register });
  return { probe: key };
}
// renormal the moved vertices and their one-ring (area-weighted)
export function renormal(g, moved) {
  const N = g.attributes.normal?.array; if (!N) return; const X = g.attributes.position.array, I = g.index.array, nV = g.attributes.position.count, touch = new Uint8Array(nV);
  for (let t = 0; t < I.length; t += 3) if (moved[I[t]] || moved[I[t + 1]] || moved[I[t + 2]]) { touch[I[t]] = touch[I[t + 1]] = touch[I[t + 2]] = 1; }
  const acc = new Float64Array(nV * 3);
  for (let t = 0; t < I.length; t += 3) { const a = I[t], b = I[t + 1], d = I[t + 2]; if (!(touch[a] || touch[b] || touch[d])) continue;
    const ux = X[b * 3] - X[a * 3], uy = X[b * 3 + 1] - X[a * 3 + 1], uz = X[b * 3 + 2] - X[a * 3 + 2], wx = X[d * 3] - X[a * 3], wy = X[d * 3 + 1] - X[a * 3 + 1], wz = X[d * 3 + 2] - X[a * 3 + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; for (const v of [a, b, d]) { acc[v * 3] += nx; acc[v * 3 + 1] += ny; acc[v * 3 + 2] += nz; } }
  for (let v = 0; v < nV; v++) if (touch[v]) { const l = Math.hypot(acc[v * 3], acc[v * 3 + 1], acc[v * 3 + 2]); if (l > 0) { N[v * 3] = acc[v * 3] / l; N[v * 3 + 1] = acc[v * 3 + 1] / l; N[v * 3 + 2] = acc[v * 3 + 2] / l; } }
  g.attributes.normal.needsUpdate = true;
}
// P: a built person (person/build.js); o.name (reports only), o.url (a bake folder elsewhere), o.bake (the object itself), o.lines (false = keep
// MOUTH's paint lines). The bake is the one for THIS face (wrapKey); none = nothing moves (reported missing with its key)
export async function nosemouth7(P, o = {}) {
  const h = P?.h, body = h?.body, g0 = body?.userData?.geomL0 || body?.geometry; if (!g0?.index) return { skipped: 'no body geometry' };
  const name = o.name || P?.info?.name || P?.name, key = wrapKey(g0.attributes.position.array, g0.index.array), J = o.bake || await wrapBake(key, { url: o.url });
  if (!J) return { missing: key, version: WRAP_VERSION, code: WRAP_CODE, build: 'node web/labs/nosemouth/nm_wrap.mjs --people ' + (name || '<name>') + ' (fits the wrap on the face at this hook and writes assets/person/nosemouth/cache/' + key + '.json)' };
  if (J.key && J.key !== key) return { missing: key, stale: J.key, version: WRAP_VERSION };
  const u = J.unit || 1e-4, n0 = g0.attributes.position.count, rep = { version: WRAP_VERSION, bake: J.version ?? null, key, name };
  // a dense displacement per geometry (bind metres), then added: the control mesh, Loop level 1 (the control vertices keep their indices;
  // each edge vertex is found by its edge's two ends, the first two columns of its stencil row), any other level not fitted (said)
  const dense = (nV, ids, d) => { const D = new Float32Array(nV * 3); let c = 0; for (let k = 0; k < ids.length; k++) { const v = ids[k]; if (v == null || v < 0 || v >= nV) continue; for (let q = 0; q < 3; q++) D[v * 3 + q] = d[k * 3 + q] * u; c++; } return { D, c }; };
  const apply = (g, D) => { const X = g.attributes.position.array, nV = g.attributes.position.count, moved = new Uint8Array(nV);
    for (let v = 0; v < nV; v++) { const o3 = v * 3; if (D[o3] === 0 && D[o3 + 1] === 0 && D[o3 + 2] === 0) continue; X[o3] += D[o3]; X[o3 + 1] += D[o3 + 1]; X[o3 + 2] += D[o3 + 2]; moved[v] = 1; }
    renormal(g, moved); g.attributes.position.needsUpdate = true; g.computeBoundingSphere?.(); g.computeBoundingBox?.(); };
  const d0 = dense(n0, J.c0.ids, J.c0.d); apply(g0, d0.D); rep.c0 = d0.c; const byLen = new Map([[n0 * 3, d0.D]]);
  const subs = Object.entries(body.userData?.geoms || {}).filter(([k, g]) => +k > 0 && g !== g0).map(([, g]) => g);
  if (body.geometry !== g0 && !subs.includes(body.geometry)) subs.push(body.geometry);
  const lvl = g => g.userData?.subdiv?.levels ?? 0; subs.sort((a, b) => lvl(a) - lvl(b));
  for (const g of subs) {
    if (lvl(g) !== 1 || !J.l1) { rep['level' + lvl(g)] = 'not fitted (level 1 only)'; continue; }
    const nV = g.attributes.position.count, nIn = g.userData.subdiv?.nIn ?? n0;
    let St = g.userData.plan?.levels?.[0]?.S;
    if (!St) { try { const SD = await import('../../../body/subdiv.js'); St = SD.loopPlan(g0.index.array, n0, 1, 'hm08:' + g0.index.count + ':' + n0).levels[0].S; } catch (e) { St = null; } }
    const a = dense(nV, J.l1.ids, J.l1.d); let re = 0;
    if (St && J.l1.edges) { const key = (x, y) => x < y ? x * 4194304 + y : y * 4194304 + x, id = new Map(); for (let r = nIn; r < nV; r++) { const of = St.rowOff[r]; id.set(key(St.col[of], St.col[of + 1]), r); }
      const E = J.l1.edges; for (let k = 0; k < E.length / 2; k++) { const r = id.get(key(E[k * 2], E[k * 2 + 1])); if (r === undefined) continue; for (let q = 0; q < 3; q++) a.D[r * 3 + q] = J.l1.de[k * 3 + q] * u; re++; } }
    apply(g, a.D); byLen.set(nV * 3, a.D); rep.l1 = { orig: a.c, edges: re, plan: !!St }; }
  // CORRECT5's corrected-bind base (export.js writes it over the bind before the export): if it was captured before this hook, it moves too
  const cb = body.userData?.correctBase, dc = cb && byLen.get(cb.length); if (dc) { for (let i = 0; i < cb.length; i++) cb[i] += dc[i]; rep.correctBase = true; }
  // the vermilion's lines: the skin's painted lip (useLipLine's rows) and DETAIL7's lip lines take OUR borders (bind rows)
  if (o.lines !== false && J.lines?.rows?.length) {
    const L = J.lines; if (h.mouth5?.m) { h.mouth5.m.lines = L; rep.lines = 'mouth5'; }
    const LL = h.likeness?.skin?.lipLine; if (LL?.U?.likeLipG) { const V = LL.U.likeLipG.value, rows = L.rows; for (let i = 0; i < V.length; i++) { const q = rows[Math.min(i, rows.length - 1)]; V[i].set(q[0], q[1], q[2], q[3]); }
      LL.U.likeLipK.value.x = L.half; LL.U.likeLipK.value.y = L.z; LL.U.likeLipK.value.w = L.center ?? 0; LL.lines = L; rep.lines = (rep.lines ? rep.lines + ' + ' : '') + 'paint'; } }
  h.update?.();
  return rep;
}
