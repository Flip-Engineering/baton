// ANATOMY / FINE / BAKE (DETAIL7, 8 Oct 2026): the fine tier of ONE person rasterized into the head chart: a height field (mm) holding the
// feature curves' profiles and the microstructure, its gradient (the engine's normal), a cavity term and region masks. Pure JS, the same
// code in the browser (the engine's maps, at page build) and in node (Cycles' displacement map, on the farm). No GL. Ours, CC0.
//
//   const S = fineSurface(P, K, A)                      // the chart's triangles in the person's bind space (mm, FACE6's anchor frame), a grid
//   const B = bakeFine(S, feats, st, { res, pores, net, lips })
//     B = { W, H, h (Float32 mm), grad (Float32 2 x W x H: dh/du, dh/dv in METRES per uv unit), cav (Float32 0.3..1.1: the relief's own
//           occlusion in context x the micro cavity; iteration 2), mask (Uint8 RGBA: pore size class, pore depth / 0.12 mm, vermilion, lid),
//           hLo / hHi / cavHi (with split: the displacement band, the bump band, the bump band's cavity: Cycles), report }
// Iteration 2 (8 Oct): profile distances in true millimetres (the chart's per-triangle metric), the 'valley' profile, the horizon occlusion.
// Texel (i, j) is uv ((i + 0.5) / W, (j + 0.5) / H), row 0 at v = 0 (WebGL with flipY false and Blender's pixels both start there).
import { microHeight, HIDE } from './micro.js';
import { lipPrint, lipZGrid } from './lips.js';
import { regionMicro, FINE_NUMBERS } from './features.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sst = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- the surface: chart triangles in mm, uv in chart units (u, v * aspect)
export function fineSurface(Pbind, K, A, aspect) {
  const nt = K.tris.length / 3, n = K.n, X = new Float32Array(n * 3), on = K.on;
  for (let v = 0; v < n; v++) if (on[v]) { const q = A.toMm([Pbind[v * 3], Pbind[v * 3 + 1], Pbind[v * 3 + 2]]); X[v * 3] = q[0]; X[v * 3 + 1] = q[1]; X[v * 3 + 2] = q[2]; }
  // grid over the triangles' bboxes (3 mm cells)
  const cs = 3, lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < K.tris.length; i++) { const v = K.tris[i]; for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], X[v * 3 + k]); hi[k] = Math.max(hi[k], X[v * 3 + k]); } }
  const dims = [0, 1, 2].map(k => Math.max(1, Math.ceil((hi[k] - lo[k]) / cs) + 1)), cell = new Map();
  const cid = (a, b, c) => (a * dims[1] + b) * dims[2] + c;
  for (let t = 0; t < nt; t++) { const a = K.tris[t * 3], b = K.tris[t * 3 + 1], c = K.tris[t * 3 + 2], m0 = [], m1 = [];
    for (let k = 0; k < 3; k++) { const xs = [X[a * 3 + k], X[b * 3 + k], X[c * 3 + k]]; m0.push(Math.floor((Math.min(...xs) - lo[k]) / cs)); m1.push(Math.floor((Math.max(...xs) - lo[k]) / cs)); }
    for (let i = m0[0]; i <= m1[0]; i++) for (let j = m0[1]; j <= m1[1]; j++) for (let k = m0[2]; k <= m1[2]; k++) { const id = cid(i, j, k); let l = cell.get(id); if (!l) cell.set(id, l = []); l.push(t); } }
  // per vertex: the mean scale (mm per chart unit) of its triangles; the chart's boundary loops (vertex ids, ordered)
  const vs = new Float32Array(n), vc = new Float32Array(n), ecount = new Map(), ek = (a, b) => a < b ? a * 4194304 + b : b * 4194304 + a;
  for (let t = 0; t < nt; t++) { const id = [K.tris[t * 3], K.tris[t * 3 + 1], K.tris[t * 3 + 2]], U = id.map(v => [K.uv[v * 2], K.uv[v * 2 + 1] * aspect]), P3 = id.map(v => [X[v * 3], X[v * 3 + 1], X[v * 3 + 2]]);
    const E1 = P3[1].map((x, k) => x - P3[0][k]), E2 = P3[2].map((x, k) => x - P3[0][k]), a3 = 0.5 * Math.hypot(E1[1] * E2[2] - E1[2] * E2[1], E1[2] * E2[0] - E1[0] * E2[2], E1[0] * E2[1] - E1[1] * E2[0]);
    const a2 = 0.5 * Math.abs((U[1][0] - U[0][0]) * (U[2][1] - U[0][1]) - (U[2][0] - U[0][0]) * (U[1][1] - U[0][1])), sc = a2 > 1e-14 ? Math.sqrt(a3 / a2) : 0;
    if (sc > 0) for (const v of id) { vs[v] += sc; vc[v]++; }
    for (let q = 0; q < 3; q++) { const kk = ek(id[q], id[(q + 1) % 3]); ecount.set(kk, (ecount.get(kk) || 0) + 1); } }
  for (let v = 0; v < n; v++) if (vc[v]) vs[v] /= vc[v];
  const nb = new Map(); for (const [kk, c] of ecount) if (c === 1) { const a = Math.floor(kk / 4194304), b = kk % 4194304; (nb.get(a) || nb.set(a, []).get(a)).push(b); (nb.get(b) || nb.set(b, []).get(b)).push(a); }
  const loops = [], seen = new Set();
  for (const s0 of nb.keys()) { if (seen.has(s0)) continue; const L = [s0]; seen.add(s0); let cur = s0;
    for (;;) { const nx = (nb.get(cur) || []).find(x => !seen.has(x)); if (nx == null) break; seen.add(nx); L.push(nx); cur = nx; } loops.push(L); }
  return { X, K, nt, n, lo, cs, dims, cell, cid, aspect, A, vscale: vs, loops };
}
// the lid margins: the chart's eye-hole boundary (the line between the skin and the socket's lining), split at the canthi into the upper
// and the lower arc, both ordered medial -> lateral; each point { cu, s, side (away from the opening), v }
export function marginArcs(S, sg) {
  const A = S.A, en = A.side('en', sg), ex = A.side('ex', sg), c = [(en[0] + ex[0]) / 2, (en[1] + ex[1]) / 2, (en[2] + ex[2]) / 2], X = S.X;
  const d3 = (v, p) => Math.hypot(X[v * 3] - p[0], X[v * 3 + 1] - p[1], X[v * 3 + 2] - p[2]);
  let loop = null, bd = 1e9; for (const L of S.loops) { if (L.length < 8) continue; const m = L.reduce((s, v) => s + d3(v, c), 0) / L.length; if (m < bd) { bd = m; loop = L; } }
  if (!loop || bd > 20) return null;
  const n = loop.length, iEn = loop.reduce((b, v, i) => d3(v, en) < d3(loop[b], en) ? i : b, 0), iEx = loop.reduce((b, v, i) => d3(v, ex) < d3(loop[b], ex) ? i : b, 0);
  const walk = (i0, i1, st) => { const o = []; for (let i = i0; ; i = (i + st + n) % n) { o.push(loop[i]); if (i === i1) break; } return o; };
  const a1 = walk(iEn, iEx, 1), a2 = walk(iEn, iEx, -1), my = L => L.reduce((s, v) => s + X[v * 3 + 1], 0) / L.length;
  const up = my(a1) > my(a2) ? a1 : a2, lo = up === a1 ? a2 : a1;
  const hole = loop.reduce((s, v) => [s[0] + S.K.uv[v * 2] / n, s[1] + S.K.uv[v * 2 + 1] * S.aspect / n], [0, 0]);
  // the scale (mm per chart unit) of the lids: the median over the chart's vertices within 14 mm of the fissure's centre, the boundary's own
  // left out (the triangles that meet the opening are slivers, their scale runs to 10-50x the lids')
  const bset = new Set(loop), sc = []; for (let v = 0; v < S.K.n; v++) if (S.K.on[v] && !bset.has(v) && S.vscale[v] > 0 && d3(v, c) < 14) sc.push(S.vscale[v]);
  sc.sort((a, b) => a - b); const sEye = sc.length ? sc[sc.length >> 1] : 330;
  const arc = L => L.map((v, i) => { const cu = [S.K.uv[v * 2], S.K.uv[v * 2 + 1] * S.aspect], a = L[Math.max(0, i - 1)], b = L[Math.min(L.length - 1, i + 1)];
    let t = [S.K.uv[b * 2] - S.K.uv[a * 2], (S.K.uv[b * 2 + 1] - S.K.uv[a * 2 + 1]) * S.aspect]; const tl = Math.hypot(...t) || 1; t = [t[0] / tl, t[1] / tl];
    let nn = [-t[1], t[0]]; if ((cu[0] - hole[0]) * nn[0] + (cu[1] - hole[1]) * nn[1] < 0) nn = [-nn[0], -nn[1]];
    return { cu, s: sEye, side: nn, v, p: [X[v * 3], X[v * 3 + 1], X[v * 3 + 2]] }; });
  return { up: arc(up), lo: arc(lo), loop, sEye };
}
// a curve offset from another inside the chart by H(t) mm on its + side (a parallel curve: the crease over the margin), smoothed
export function offsetArc(arc, Hfn, smooth = 3) {
  let pts = arc.map((q, i) => { const t = i / (arc.length - 1), H = Hfn(t) / (q.s || 1); return { cu: [q.cu[0] + q.side[0] * H, q.cu[1] + q.side[1] * H], s: q.s, side: q.side.slice() }; });
  for (let it = 0; it < smooth; it++) pts = pts.map((q, i) => i === 0 || i === pts.length - 1 ? q : { ...q, cu: [0.25 * pts[i - 1].cu[0] + 0.5 * q.cu[0] + 0.25 * pts[i + 1].cu[0], 0.25 * pts[i - 1].cu[1] + 0.5 * q.cu[1] + 0.25 * pts[i + 1].cu[1]] });
  return pts;
}
const cuOf = (S, v) => [S.K.uv[v * 2], S.K.uv[v * 2 + 1] * S.aspect];

// Moller-Trumbore against one triangle (mm); returns [t, b1, b2] or null
function rayTri(S, t, o, d) {
  const X = S.X, a = S.K.tris[t * 3] * 3, b = S.K.tris[t * 3 + 1] * 3, c = S.K.tris[t * 3 + 2] * 3;
  const e1 = [X[b] - X[a], X[b + 1] - X[a + 1], X[b + 2] - X[a + 2]], e2 = [X[c] - X[a], X[c + 1] - X[a + 1], X[c + 2] - X[a + 2]];
  const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]], det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
  if (Math.abs(det) < 1e-12) return null; const inv = 1 / det, s = [o[0] - X[a], o[1] - X[a + 1], o[2] - X[a + 2]];
  const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * inv; if (u < -1e-6 || u > 1 + 1e-6) return null;
  const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]], v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv;
  if (v < -1e-6 || u + v > 1 + 1e-6) return null; const tt = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv; return tt > 0 ? [tt, u, v] : null;
}
// the first chart hit along a ray (mm); -> { t, tri, b: [w0, w1, w2], p }
export function rayHit(S, o, d, maxT = 90) {
  const l = Math.hypot(...d); d = d.map(x => x / l); const seen = new Set(); let best = null;
  for (let s = 0; s <= maxT; s += S.cs * 0.5) {
    const q = [o[0] + d[0] * s, o[1] + d[1] * s, o[2] + d[2] * s], i = Math.floor((q[0] - S.lo[0]) / S.cs), j = Math.floor((q[1] - S.lo[1]) / S.cs), k = Math.floor((q[2] - S.lo[2]) / S.cs);
    if (i < 0 || j < 0 || k < 0 || i >= S.dims[0] || j >= S.dims[1] || k >= S.dims[2]) { if (best) break; continue; }
    const l2 = S.cell.get(S.cid(i, j, k)); if (l2) for (const t of l2) { if (seen.has(t)) continue; seen.add(t); const r = rayTri(S, t, o, d); if (r && (!best || r[0] < best.t)) best = { t: r[0], tri: t, b: [1 - r[1] - r[2], r[1], r[2]] }; }
    if (best && best.t < s - S.cs) break;
  }
  if (best) best.p = [o[0] + d[0] * best.t, o[1] + d[1] * best.t, o[2] + d[2] * best.t];
  return best;
}
// the closest chart point to q (mm), searching the cells within r
export function closestHit(S, q, r = 6) {
  const X = S.X, i0 = Math.floor((q[0] - r - S.lo[0]) / S.cs), i1 = Math.floor((q[0] + r - S.lo[0]) / S.cs), j0 = Math.floor((q[1] - r - S.lo[1]) / S.cs), j1 = Math.floor((q[1] + r - S.lo[1]) / S.cs), k0 = Math.floor((q[2] - r - S.lo[2]) / S.cs), k1 = Math.floor((q[2] + r - S.lo[2]) / S.cs);
  let best = null; const seen = new Set(), scratch = {};
  for (let i = Math.max(0, i0); i <= Math.min(S.dims[0] - 1, i1); i++) for (let j = Math.max(0, j0); j <= Math.min(S.dims[1] - 1, j1); j++) for (let k = Math.max(0, k0); k <= Math.min(S.dims[2] - 1, k1); k++) {
    const l = S.cell.get(S.cid(i, j, k)); if (!l) continue;
    for (const t of l) { if (seen.has(t)) continue; seen.add(t); const a = S.K.tris[t * 3], b = S.K.tris[t * 3 + 1], c = S.K.tris[t * 3 + 2];
      closestOnTriFlat(q, X, a * 3, b * 3, c * 3, scratch);
      if (!best || scratch.d < best.d) best = { d: scratch.d, tri: t, w0: scratch.w0, w1: scratch.w1, w2: scratch.w2, x: scratch.x, y: scratch.y, z: scratch.z }; } }
  return best && { d: best.d, tri: best.tri, b: [best.w0, best.w1, best.w2], p: [best.x, best.y, best.z] };
}
// Ericson's closest point on a triangle with barycentrics
function closestOnTriFlat(p, X, a, b, c, out) {
  const ab0 = X[b] - X[a], ab1 = X[b + 1] - X[a + 1], ab2 = X[b + 2] - X[a + 2];
  const ac0 = X[c] - X[a], ac1 = X[c + 1] - X[a + 1], ac2 = X[c + 2] - X[a + 2];
  const ap0 = p[0] - X[a], ap1 = p[1] - X[a + 1], ap2 = p[2] - X[a + 2];
  const d1 = ab0 * ap0 + ab1 * ap1 + ab2 * ap2, d2 = ac0 * ap0 + ac1 * ap1 + ac2 * ap2;
  let w0, w1, w2;
  if (d1 <= 0 && d2 <= 0) { w0 = 1; w1 = 0; w2 = 0; }
  else {
    const bp0 = p[0] - X[b], bp1 = p[1] - X[b + 1], bp2 = p[2] - X[b + 2];
    const d3 = ab0 * bp0 + ab1 * bp1 + ab2 * bp2, d4 = ac0 * bp0 + ac1 * bp1 + ac2 * bp2;
    if (d3 >= 0 && d4 <= d3) { w0 = 0; w1 = 1; w2 = 0; }
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); w0 = 1 - v; w1 = v; w2 = 0; }
      else {
        const cp0 = p[0] - X[c], cp1 = p[1] - X[c + 1], cp2 = p[2] - X[c + 2];
        const d5 = ab0 * cp0 + ab1 * cp1 + ab2 * cp2, d6 = ac0 * cp0 + ac1 * cp1 + ac2 * cp2;
        if (d6 >= 0 && d5 <= d6) { w0 = 0; w1 = 0; w2 = 1; }
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const t = d2 / (d2 - d6); w0 = 1 - t; w1 = 0; w2 = t; }
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const t = (d4 - d3) / ((d4 - d3) + (d5 - d6)); w0 = 0; w1 = 1 - t; w2 = t; }
            else { const den = 1 / (va + vb + vc), v = vb * den, ww = vc * den; w0 = 1 - v - ww; w1 = v; w2 = ww; }
          }
        }
      }
    }
  }
  const x = X[a] * w0 + X[b] * w1 + X[c] * w2;
  const y = X[a + 1] * w0 + X[b + 1] * w1 + X[c + 1] * w2;
  const z = X[a + 2] * w0 + X[b + 2] * w1 + X[c + 2] * w2;
  out.w0 = w0; out.w1 = w1; out.w2 = w2; out.x = x; out.y = y; out.z = z;
  out.d = Math.hypot(p[0] - x, p[1] - y, p[2] - z);
}
// a hit -> its uv (chart units), its triangle's scale (mm per chart unit) and the 3-D -> uv map of a tangent direction
function hitInfo(S, hit) {
  const t = hit.tri, ids = [S.K.tris[t * 3], S.K.tris[t * 3 + 1], S.K.tris[t * 3 + 2]], U = ids.map(v => cuOf(S, v)), Xv = ids.map(v => [S.X[v * 3], S.X[v * 3 + 1], S.X[v * 3 + 2]]);
  const cu = [0, 1].map(k => U[0][k] * hit.b[0] + U[1][k] * hit.b[1] + U[2][k] * hit.b[2]);
  const E1 = Xv[1].map((x, k) => x - Xv[0][k]), E2 = Xv[2].map((x, k) => x - Xv[0][k]), e1 = [U[1][0] - U[0][0], U[1][1] - U[0][1]], e2 = [U[2][0] - U[0][0], U[2][1] - U[0][1]];
  const a3 = 0.5 * Math.hypot(E1[1] * E2[2] - E1[2] * E2[1], E1[2] * E2[0] - E1[0] * E2[2], E1[0] * E2[1] - E1[1] * E2[0]), a2 = 0.5 * Math.abs(e1[0] * e2[1] - e1[1] * e2[0]);
  const scale = Math.sqrt(a3 / Math.max(a2, 1e-14));
  // J (3x2): [E1 E2] = J [e1 e2]; uv of a 3-D direction d: the least-squares solve (J^T J)^-1 J^T d
  const det = e1[0] * e2[1] - e1[1] * e2[0] || 1e-14, inv = [[e2[1] / det, -e2[0] / det], [-e1[1] / det, e1[0] / det]];   // [e1 e2]^-1 (rows)
  const J = [0, 1, 2].map(k => [E1[k] * inv[0][0] + E2[k] * inv[1][0], E1[k] * inv[0][1] + E2[k] * inv[1][1]]);
  const toUv = d => { const g00 = J.reduce((s, r) => s + r[0] * r[0], 0), g01 = J.reduce((s, r) => s + r[0] * r[1], 0), g11 = J.reduce((s, r) => s + r[1] * r[1], 0);
    const b0 = J.reduce((s, r, k) => s + r[0] * d[k], 0), b1 = J.reduce((s, r, k) => s + r[1] * d[k], 0), dd = g00 * g11 - g01 * g01 || 1e-14; return [(g11 * b0 - g01 * b1) / dd, (g00 * b1 - g01 * b0) / dd]; };
  return { cu, scale, toUv };
}

// ---------------------------------------------------------------- a feature -> a snapped polyline in chart units
export function snapFeature(S, f) {
  const out = f.uv ? f.uv.map(q => ({ cu: q.cu, s: q.s, side: q.side, p: q.p || null })) : [];
  if (!f.uv) for (const p of f.pts) {
    let hit = null;
    if (f.snap === 'closest' || !f.ray) hit = closestHit(S, p, 8);
    else { const d = f.ray, l = Math.hypot(...d), o = [p[0] - d[0] / l * 30, p[1] - d[1] / l * 30, p[2] - d[2] / l * 30]; hit = rayHit(S, o, d, 80) || closestHit(S, p, 6); }
    if (!hit || (hit.d != null && hit.d > 6)) continue;
    const I = hitInfo(S, hit), side = I.toUv(f.side.length === 3 && typeof f.side[0] === 'number' ? f.side : f.side[out.length]), sl = Math.hypot(...side) || 1;
    out.push({ cu: I.cu, s: I.scale, side: [side[0] / sl, side[1] / sl], p: hit.p });
  }
  // densify in uv so no segment is longer than ~0.6 mm (a straight line in the chart is near-geodesic over that length)
  const pts = [];
  for (let i = 0; i < out.length; i++) { pts.push(out[i]); if (i + 1 < out.length) { const a = out[i], b = out[i + 1], dl = Math.hypot(b.cu[0] - a.cu[0], b.cu[1] - a.cu[1]) * 0.5 * (a.s + b.s), k = Math.ceil(dl / 0.6);
    for (let j = 1; j < k; j++) { const t = j / k; pts.push({ cu: [a.cu[0] + (b.cu[0] - a.cu[0]) * t, a.cu[1] + (b.cu[1] - a.cu[1]) * t], s: a.s + (b.s - a.s) * t, side: [a.side[0] + (b.side[0] - a.side[0]) * t, a.side[1] + (b.side[1] - a.side[1]) * t] }); } } }
  let L = 0; const along = [0]; for (let i = 1; i < pts.length; i++) { L += Math.hypot(pts[i].cu[0] - pts[i - 1].cu[0], pts[i].cu[1] - pts[i - 1].cu[1]) * 0.5 * (pts[i].s + pts[i - 1].s); along.push(L); }
  return { pts, along, L, snapped: out.length, of: (f.uv || f.pts).length, p3: out.filter(o => o.p).map(o => o.p.map(x => +x.toFixed(2))) };
}

const knot = (ks, t) => { if (!ks) return 1; if (t <= ks[0][0]) return ks[0][1]; for (let i = 1; i < ks.length; i++) if (t <= ks[i][0]) { const [t0, a] = ks[i - 1], [t1, b] = ks[i]; return a + (b - a) * (t - t0) / ((t1 - t0) || 1); } return ks[ks.length - 1][1]; };
// iteration 2: 'valley', the crease as the photographs show it (tools/xsect7.py: the alar-facial, nasolabial and lid creases are 2-4 mm wide
// soft occlusion bands, asymmetric, with at most a thin line in the floor; iteration 1's 0.3-0.5 mm grooves read as incised outlines):
//   valley  -D exp(-(s/W(s))^2)  with W = Wm on the - side, Wp on the + side (the two walls: a steep one and a gentle one)
//           - Dc exp(-(s/Wc)^2)  the fold's floor (a narrow core, what reads at 2:1)
//           + O exp(-((s - c)/Wr)^2)  the skin standing proud on one side (the hood over the lid crease, the cheek over the nasolabial line)
export function profileAt(kind, P, s) {
  if (kind === 'valley') { let v = -P.D * Math.exp(-((s / (s < 0 ? P.Wm : P.Wp)) ** 2)); if (P.Dc) v -= P.Dc * Math.exp(-((s / P.Wc) ** 2)); if (P.O) v += P.O * Math.exp(-(((s - P.c) / P.Wr) ** 2)); return v; }
  if (kind === 'groove') return -P.D * Math.exp(-((s / P.W) ** 2));
  if (kind === 'ridge') return P.D * Math.exp(-(((s - (P.c || 0)) / P.W) ** 2));
  // iteration 4: an ASYMMETRIC ridge (the white roll: a gentle flank Wp on the skin side that faces the key light, a steep one Wm down to the
  // border). A symmetric ridge under a top light is a bright line over a dark one whose mean is ~0: the photographs' roll is a PALE BAND
  if (kind === 'ridge2') { const d = s - (P.c || 0); return P.D * Math.exp(-((d / (d < 0 ? P.Wm : P.Wp)) ** 2)); }
  if (kind === 'fold') return -P.D * Math.exp(-((s / P.W) ** 2)) + P.O * sst(0, P.Wo, s) * Math.exp(-((Math.max(0, s - P.Ro) / P.Fo) ** 2));
  // iteration 6: 'crease', a SET fold (skin_age.js): the sheet hinged at its floor, a cusp sharpest there (creases in soft solids: Hong, Zhao
  // and Suo 2009), each wall w (Wm on the - side, Wp on the +) about a third of the skin's thickness, the floor rounded over r (a texel can
  // sample it): -D exp(-(sqrt(s^2 + r^2) - r) / w). Half its depth lies within 0.69 w of the floor (a Gaussian valley of the same depth and
  // half-width has a flat floor and no occlusion to speak of: iteration 5's lines read in neither renderer)
  if (kind === 'crease') { const r = P.r ?? 0.04; return -P.D * Math.exp(-(Math.sqrt(s * s + r * r) - r) / (s < 0 ? P.Wm : P.Wp)); }
  return 0;
}
const support = (kind, P) => kind === 'valley' ? Math.max(2.6 * P.Wm, 2.6 * P.Wp, P.O ? Math.abs(P.c) + 2.6 * P.Wr : 0, P.Dc ? 3 * P.Wc : 0)
  : kind === 'fold' ? Math.max(3 * P.W, P.Ro + 2.2 * P.Fo + P.Wo) : kind === 'ridge' ? Math.abs(P.c || 0) + 3 * P.W
  : kind === 'ridge2' ? Math.abs(P.c || 0) + 2.8 * Math.max(P.Wm, P.Wp) : kind === 'crease' ? (P.r ?? 0.04) + 4.6 * Math.max(P.Wm, P.Wp) : 3 * P.W;
// iteration 4: a profile that changes ALONG its curve (f.profAlong: [[t, { D, Wm, ... }], ...], linear in t; keys not given keep f.prof's) and a
// TAPER (f.taper = k: every width x (k + (1 - k) x the end fade), so a crease ends by narrowing AND shallowing, as a real one does, instead of
// stopping as a stub at full width: the nostril-sill 'ticks' of iteration 3 were the alar-facial crease's 3 mm-long remnant between two fades)
const WKEYS = ['W', 'Wm', 'Wp', 'Wc', 'Wr', 'c'];
function profKnot(ks, t, P) {
  if (t <= ks[0][0]) return { ...P, ...ks[0][1] }; for (let i = 1; i < ks.length; i++) if (t <= ks[i][0]) { const [t0, a] = ks[i - 1], [t1, b] = ks[i], u = (t - t0) / ((t1 - t0) || 1), o = { ...P };
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const va = a[k] ?? P[k], vb = b[k] ?? P[k]; o[k] = va + (vb - va) * u; } return o; }
  return { ...P, ...ks[ks.length - 1][1] };
}
function taperProf(P, k) { const o = { ...P }; for (const w of WKEYS) if (o[w] != null) o[w] *= k; return o; }
const supportOf = f => { let s = support(f.kind, f.prof); if (f.profAlong) for (const [, q] of f.profAlong) s = Math.max(s, support(f.kind, { ...f.prof, ...q })); return s; };
// the chart's METRIC per triangle (iteration 2): G = J^T J (mm^2 per chart unit^2), J the 3-D <- chart map. The chart is 2-3x anisotropic at the
// nose base and on the upper lip (fine7_scratch/texel_probe.mjs: columella, upper lip, alar base 1.6-3.1 : 1), so iteration 1's isotropic
// scale drew the profiles up to sqrt(3) too narrow one way and too wide the other: the 'scored' philtral lines, the weak white roll
function triMetric(S) {
  const K = S.K, X = S.X, nt = K.tris.length / 3, G = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) { const a = K.tris[t * 3], b = K.tris[t * 3 + 1], c = K.tris[t * 3 + 2], ua = cuOf(S, a), ub = cuOf(S, b), uc = cuOf(S, c);
    const e1 = [ub[0] - ua[0], ub[1] - ua[1]], e2 = [uc[0] - ua[0], uc[1] - ua[1]], det = e1[0] * e2[1] - e2[0] * e1[1];
    if (Math.abs(det) < 1e-16) { G[t * 3] = G[t * 3 + 2] = -1; continue; }
    const E1 = [0, 1, 2].map(k => X[b * 3 + k] - X[a * 3 + k]), E2 = [0, 1, 2].map(k => X[c * 3 + k] - X[a * 3 + k]);
    const Ju = E1.map((x, k) => (x * e2[1] - E2[k] * e1[1]) / det), Jv = E1.map((x, k) => (-x * e2[0] + E2[k] * e1[0]) / det);
    G[t * 3] = Ju[0] * Ju[0] + Ju[1] * Ju[1] + Ju[2] * Ju[2]; G[t * 3 + 1] = Ju[0] * Jv[0] + Ju[1] * Jv[1] + Ju[2] * Jv[2]; G[t * 3 + 2] = Jv[0] * Jv[0] + Jv[1] * Jv[1] + Jv[2] * Jv[2]; }
  return G;
}
// the smallest scale (mm per chart unit) a metric allows in any direction
const minScale = (g00, g01, g11) => { const m = 0.5 * (g00 + g11), d = Math.sqrt(0.25 * (g00 - g11) ** 2 + g01 * g01); return Math.sqrt(Math.max(1e-12, m - d)); };

// ---------------------------------------------------------------- the bake
export function bakeFine(S, feats, st, { res = 2048, pores = true, net = true, lips = null, lipLines = true, fadeOuter = 3, fadeHole = 0.35, keepPos = false, ao = true, split = false, aoR = 4.0, lipO = null, body = null } = {}) {
  const t0 = Date.now(), W = res, H = Math.round(res * S.aspect), WH = W * H, h = new Float32Array(WH), cov = new Uint8Array(WH), mask = new Uint8Array(WH * 4);
  const A = S.A, K = S.K, X = S.X, rep = { W, H, features: [], ms: {}, version: 2 }, pos = keepPos ? new Float32Array(WH * 3) : null;
  const triT = new Int32Array(WH).fill(-1), Gt = triMetric(S);
  const sizes = []; for (let t = 0; t < K.tris.length / 3; t += 7) { const a = K.tris[t * 3], b = K.tris[t * 3 + 1]; const ua = cuOf(S, a), ub = cuOf(S, b), l3 = Math.hypot(X[b * 3] - X[a * 3], X[b * 3 + 1] - X[a * 3 + 1], X[b * 3 + 2] - X[a * 3 + 2]), luv = Math.hypot(ub[0] - ua[0], ub[1] - ua[1]); if (luv > 0) sizes.push(l3 / luv / W); }
  sizes.sort((a, b) => a - b); const texMm0 = sizes[sizes.length >> 1] || 0.1;
  // the occlusion's own grid (iteration 2): about 1024 wide whatever the bake's size; bind positions at its texel centres
  const aoS = Math.max(1, Math.round(res / 1024)), AW = Math.ceil(W / aoS), AH = Math.ceil(H / aoS), aoP = ao ? new Float32Array(AW * AH * 3) : null, aoC = ao ? new Uint8Array(AW * AH) : null;
  // per chart vertex: the region's micro parameters (smooth: interpolated per texel); the vermilion test is per texel (sharp)
  const RV = new Float32Array(K.n * 6);
  // (iteration 7) the body's patch charts (body.js) carry no pores or network (the rest of the body has none from this tier: a textured disc would show)
  for (let v = 0; v < K.n; v++) if (K.on[v] && !(K.part && K.part[v])) { const r = regionMicro(A, st, [X[v * 3], X[v * 3 + 1], X[v * 3 + 2]]); RV.set([r.pore[0], r.pore[1], r.pore[2], r.net[0], r.net[1], r.lid], v * 6); }
  const BP = body, bodyMax = BP ? BP.patches.map(() => 0) : null, bodyTex = BP ? BP.patches.map(() => 0) : null;
  // (c6 iteration 20) the vermilion's furrows: the WRINKLING of its thin stiff film under the orbicularis' compression (lips.js: the film's
  // wavelength, onset and amplitude from its hydration and thickness, the pattern a Swift-Hohenberg phase field driven by the compression
  // field and its direction, seeded per person); iterations 2-4's jittered comb at a fitted 1.35 mm spacing is gone (git history)
  const lipAt = lips ? lipTester(lips) : null, LP = lips && lipLines ? lipPrint(lips, st, lipZGrid(lips, K.tris, X, K.on), lipO || {}) : null;
  if (LP) rep.lipPrint = LP.report;
  const fis = LP ? new Float32Array(WH) : null, flk = LP ? new Float32Array(WH) : null, poreO = pores ? new Float32Array(WH) : null, mo = { occ: 0, v: 0 };
  // (iteration 9) the microstructure BAND-LIMITED to the texel (micro.js: each pit and furrow seen through the texel's Gaussian footprint,
  // sigma 0.35 texel, the engine twin's pixel rule) and its sub-texel slope variance kept per texel (vMap: (mm/mm)^2) for the lobes' roughness
  const sigH = 0.35 * texMm0, vMap = split ? new Float32Array(WH) : null, nrm = [0, 0, 1];
  // (iteration 10) what the lobes see of it (micro.js HIDE): voMap the variance of the unhidden features, fMap the hidden share of the footprint
  const voMap = split ? new Float32Array(WH) : null, fMap = split ? new Float32Array(WH) : null;
  // 1. rasterize: coverage, micro, masks, the texel's triangle (its metric), the occlusion grid's positions
  const nt = K.tris.length / 3, R = new Float32Array(6), p = [0, 0, 0];
  for (let t = 0; t < nt; t++) {
    const a = K.tris[t * 3], b = K.tris[t * 3 + 1], c = K.tris[t * 3 + 2];
    const ua = [K.uv[a * 2] * W, K.uv[a * 2 + 1] * H], ub = [K.uv[b * 2] * W, K.uv[b * 2 + 1] * H], uc = [K.uv[c * 2] * W, K.uv[c * 2 + 1] * H];
    const den = (ub[1] - uc[1]) * (ua[0] - uc[0]) + (uc[0] - ub[0]) * (ua[1] - uc[1]); if (Math.abs(den) < 1e-12) continue;
    { const e1 = [X[b * 3] - X[a * 3], X[b * 3 + 1] - X[a * 3 + 1], X[b * 3 + 2] - X[a * 3 + 2]], e2 = [X[c * 3] - X[a * 3], X[c * 3 + 1] - X[a * 3 + 1], X[c * 3 + 2] - X[a * 3 + 2]];
      const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0], nl = Math.hypot(nx, ny, nz) || 1; nrm[0] = nx / nl; nrm[1] = ny / nl; nrm[2] = nz / nl; }
    const i0 = Math.max(0, Math.floor(Math.min(ua[0], ub[0], uc[0]) - 0.5)), i1 = Math.min(W - 1, Math.ceil(Math.max(ua[0], ub[0], uc[0]) + 0.5));
    const j0 = Math.max(0, Math.floor(Math.min(ua[1], ub[1], uc[1]) - 0.5)), j1 = Math.min(H - 1, Math.ceil(Math.max(ua[1], ub[1], uc[1]) + 0.5));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = i + 0.5, y = j + 0.5, w0 = ((ub[1] - uc[1]) * (x - uc[0]) + (uc[0] - ub[0]) * (y - uc[1])) / den, w1 = ((uc[1] - ua[1]) * (x - uc[0]) + (ua[0] - uc[0]) * (y - uc[1])) / den, w2 = 1 - w0 - w1;
      if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
      const k = j * W + i; if (cov[k] && (w0 < 0 || w1 < 0 || w2 < 0)) continue;   // an inside sample wins over an edge-tolerance one
      for (let q = 0; q < 3; q++) p[q] = X[a * 3 + q] * w0 + X[b * 3 + q] * w1 + X[c * 3 + q] * w2;
      for (let q = 0; q < 6; q++) R[q] = RV[a * 6 + q] * w0 + RV[b * 6 + q] * w1 + RV[c * 6 + q] * w2;
      if (BP && t >= BP.t0) {   // (iteration 7) a body patch: the tissue's relief at the texel's patch-local position (mm), nothing else
        const pi = BP.triPatch[t - BP.t0], L = BP.PL, x = L[a * 3] * w0 + L[b * 3] * w1 + L[c * 3] * w2, y = L[a * 3 + 1] * w0 + L[b * 3 + 1] * w1 + L[c * 3 + 1] * w2, dd = L[a * 3 + 2] * w0 + L[b * 3 + 2] * w1 + L[c * 3 + 2] * w2;
        const hb = BP.relief(pi, x, y, dd); h[k] = hb; cov[k] = 1; triT[k] = t; bodyMax[pi] = Math.max(bodyMax[pi], Math.abs(hb)); bodyTex[pi]++;
        if (pos) { pos[k * 3] = p[0]; pos[k * 3 + 1] = p[1]; pos[k * 3 + 2] = p[2]; }
        if (aoP && i % aoS === 0 && j % aoS === 0) { const q = (j / aoS) * AW + i / aoS; aoP[q * 3] = p[0]; aoP[q * 3 + 1] = p[1]; aoP[q * 3 + 2] = p[2]; aoC[q] = 1; }
        mask[k * 4] = mask[k * 4 + 1] = mask[k * 4 + 2] = mask[k * 4 + 3] = 0; continue; }
      const verm = lipAt ? lipAt(p) : 0;
      let hv = 0;
      mo.occ = 0;
      mo.v = 0; mo.vo = 0; mo.f = 0;
      if (pores || net) hv = microHeight(p, { pore: pores ? [R[0], R[1] * (1 - verm), R[2]] : null, net: net ? [R[3], R[4] * (1 - verm)] : null, sig: 0.5 * texMm0, sigH, nrm }, 7, mo);
      if (poreO) poreO[j * W + i] = mo.occ;
      if (vMap) { vMap[k] = mo.v; voMap[k] = mo.vo; fMap[k] = mo.f; }
      if (verm > 0 && LP) { // the lip print at the texel: the buckled film's section and the pucker's creases (lips.js 5), their occlusion
        // in the valley (the ripple's by its amplitude near its floor, a crease's by its own depth there), the dry crests paler
        const q = LP.at(p[0], p[1]);
        if (q && (q.A > 0 || q.c > 0)) { hv += verm * q.h; const a = Math.min(1.3, q.A / LP.film.Aref) * verm;
          fis[k] = LP.film.occ * verm * Math.min(1.3, (Math.min(1.3, q.A / LP.film.Aref) * Math.exp(-((q.d / LP.film.Wo) ** 2))) + q.c / LP.film.Aref);
          flk[k] = LP.film.flake * a * q.dry * Math.max(0, q.s) ** 2; }
      }
      h[k] = hv; cov[k] = 1; triT[k] = t; if (pos) { pos[k * 3] = p[0]; pos[k * 3 + 1] = p[1]; pos[k * 3 + 2] = p[2]; }
      if (aoP && i % aoS === 0 && j % aoS === 0) { const q = (j / aoS) * AW + i / aoS; aoP[q * 3] = p[0]; aoP[q * 3 + 1] = p[1]; aoP[q * 3 + 2] = p[2]; aoC[q] = 1; }
      mask[k * 4] = Math.round(clamp((R[0] - 0.08) / 0.19) * 255); mask[k * 4 + 1] = Math.round(clamp(R[1] / 0.12) * 255); mask[k * 4 + 2] = Math.round(verm * 255); mask[k * 4 + 3] = Math.round(clamp(R[5]) * 255);
    }
  }
  rep.ms.raster = Date.now() - t0; rep.coverage = +(cov.reduce((s, x) => s + x, 0) / WH).toFixed(3);
  if (BP) BP.patches.forEach((q, i) => rep.features.push({ id: q.id, kind: 'body:' + q.kind, snapped: 1, of: 1, L: 0, texels: bodyTex[i], maxMm: +bodyMax[i].toFixed(3), info: q.kind === 'navel' ? { solved: q.Q.key, tissue: q.Q.T, reliefMm: q.Q.rangeMm } : { ra: +q.Q.ra.toFixed(1), rb: q.Q.rb, tubercles: q.Q.tubs.length } }));
  // 2. the features: distances in MILLIMETRES through the texel's own metric (the nearest point on each segment in that metric too)
  const t1 = Date.now(), floors = [];
  const texAt = cu => { const i = Math.min(W - 1, Math.max(0, Math.floor(cu[0] * W))), j = Math.min(H - 1, Math.max(0, Math.floor(cu[1] / S.aspect * H))); return j * W + i; };
  for (const f of feats) {
    const sf = snapFeature(S, f), P = f.prof; if (sf.pts.length < 2) { rep.features.push({ id: f.id, snapped: sf.snapped, of: sf.of, skipped: true }); continue; }
    const sup = supportOf(f), best = new Map();   // texel -> [|d| mm, signed s mm, along mm]
    for (let i = 0; i + 1 < sf.pts.length; i++) {
      const A0 = sf.pts[i], B0 = sf.pts[i + 1], ta = triT[texAt(A0.cu)], tb = triT[texAt(B0.cu)];
      let lmin = Math.min(A0.s, B0.s) / 3;
      for (const tq of [ta, tb]) if (tq >= 0 && Gt[tq * 3] > 0) lmin = Math.min(Math.max(lmin, 1e-6), minScale(Gt[tq * 3], Gt[tq * 3 + 1], Gt[tq * 3 + 2]));
      const ax = A0.cu[0] * W, ay = A0.cu[1] / S.aspect * H, bx = B0.cu[0] * W, by = B0.cu[1] / S.aspect * H, rt = sup / lmin * W + 1;
      const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - rt)), i1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + rt)), j0 = Math.max(0, Math.floor(Math.min(ay, by) - rt)), j1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + rt));
      const ex = bx - ax, ey = by - ay, sAB = 0.5 * (A0.s + B0.s);
      for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) { const k = j * W + ii; if (!cov[k]) continue;
        const tq = triT[k]; let g00, g01, g11;
        if (tq >= 0 && Gt[tq * 3] > 0) { g00 = Gt[tq * 3]; g01 = Gt[tq * 3 + 1]; g11 = Gt[tq * 3 + 2]; } else { g00 = g11 = sAB * sAB; g01 = 0; }
        const x = ii + 0.5, y = j + 0.5, px = x - ax, py = y - ay, eGe = ex * ex * g00 + 2 * ex * ey * g01 + ey * ey * g11;
        const tt = eGe > 0 ? clamp((px * ex * g00 + (px * ey + py * ex) * g01 + py * ey * g11) / eGe) : 0, cx = ax + ex * tt - x, cy = ay + ey * tt - y;
        const dmm = Math.sqrt(Math.max(0, cx * cx * g00 + 2 * cx * cy * g01 + cy * cy * g11)) / W; if (dmm > sup) continue;
        const b = best.get(k); if (b && b[0] <= dmm) continue;
        const sx = A0.side[0] + (B0.side[0] - A0.side[0]) * tt, sy = A0.side[1] + (B0.side[1] - A0.side[1]) * tt;
        const sgn = ((-cx) * sx + (-cy) * sy) >= 0 ? 1 : -1;
        best.set(k, [dmm, sgn * dmm, sf.along[i] + (sf.along[i + 1] - sf.along[i]) * tt]); }
    }
    let mx = 0; const fl = [];
    for (const [k, [, s, al]] of best) { const t = al / (sf.L || 1), endF = sst(0, f.fade || 1, al) * sst(0, f.fade || 1, sf.L - al), env = knot(f.along, t) * endF;
      let Pk = f.profAlong ? profKnot(f.profAlong, t, P) : P; if (f.taper != null) Pk = taperProf(Pk, f.taper + (1 - f.taper) * endF);
      const v = profileAt(f.kind, Pk, s) * env; h[k] += v; mx = Math.max(mx, Math.abs(v));
      if (Math.abs(s) < 0.25 && env > 0.6) fl.push(k); }
    floors.push(fl);
    let p3 = sf.p3; if (!p3.length && pos) p3 = sf.pts.filter((_, i) => i % 2 === 0).map(q => { const k = texAt(q.cu); return cov[k] ? [+pos[k * 3].toFixed(2), +pos[k * 3 + 1].toFixed(2), +pos[k * 3 + 2].toFixed(2)] : null; }).filter(Boolean);
    rep.features.push({ id: f.id, kind: f.kind, snapped: sf.snapped, of: sf.of, L: +sf.L.toFixed(1), texels: best.size, maxMm: +mx.toFixed(3), ...(f.info ? { info: f.info } : {}), p3 });
  }
  rep.ms.features = Date.now() - t1;
  // 3. the chart's boundary: the relief fades to 0 there (Cycles displaces the chart's faces only; their neighbours do not move): 3 mm at
  //    the outer edge, 0.35 mm at the eyes' and the mouth's openings (the lid margin roll sits 0.6-0.75 mm in)
  const t2 = Date.now(), ecount = new Map(), ek = (a, b) => a < b ? a * 4194304 + b : b * 4194304 + a;
  for (let i = 0; i < K.tris.length; i += 3) for (let q = 0; q < 3; q++) { const a = K.tris[i + q], b = K.tris[i + (q + 1) % 3], kk = ek(a, b); ecount.set(kk, (ecount.get(kk) || 0) + 1); }
  const fade = new Float32Array(WH).fill(1e9), eyes = [1, -1].map(sg => { const e = A.side('en', sg), x = A.side('ex', sg); return [(e[0] + x[0]) / 2, (e[1] + x[1]) / 2, (e[2] + x[2]) / 2]; }), sto = A.lm('sto');
  const near = (q, c, r) => Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]) < r;
  for (const [kk, n] of ecount) { if (n !== 1) continue; const a = Math.floor(kk / 4194304), b = kk % 4194304, qa = [X[a * 3], X[a * 3 + 1], X[a * 3 + 2]];
    const hole = near(qa, eyes[0], 22) || near(qa, eyes[1], 22) || near(qa, sto, 32), fw = hole ? fadeHole : fadeOuter;
    const ua = cuOf(S, a), ub = cuOf(S, b);
    const l3 = Math.hypot(X[b * 3] - X[a * 3], X[b * 3 + 1] - X[a * 3 + 1], X[b * 3 + 2] - X[a * 3 + 2]), luv = Math.hypot(ub[0] - ua[0], ub[1] - ua[1]) || 1e-9, sc = l3 / luv;
    const ax = ua[0] * W, ay = ua[1] / S.aspect * H, bx = ub[0] * W, by = ub[1] / S.aspect * H, rt = fw / sc * W * 3 + 1.5;
    const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - rt)), i1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + rt)), j0 = Math.max(0, Math.floor(Math.min(ay, by) - rt)), j1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + rt));
    const ex = bx - ax, ey = by - ay, el = ex * ex + ey * ey || 1e-12;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * W + i; const x = i + 0.5, y = j + 0.5, tt = clamp(((x - ax) * ex + (y - ay) * ey) / el), cx = ax + ex * tt - x, cy = ay + ey * tt - y;
      const tq = triT[k], d = (tq >= 0 && Gt[tq * 3] > 0) ? Math.sqrt(Math.max(0, cx * cx * Gt[tq * 3] + 2 * cx * cy * Gt[tq * 3 + 1] + cy * cy * Gt[tq * 3 + 2])) / W : Math.hypot(cx, cy) / W * sc;
      const f = sst(0, fw, d); if (f < fade[k]) fade[k] = f; } }
  for (let k = 0; k < WH; k++) if (fade[k] < 1) { h[k] *= fade[k]; if (vMap) { vMap[k] *= fade[k] * fade[k]; voMap[k] *= fade[k] * fade[k]; fMap[k] *= fade[k]; } }
  rep.ms.fade = Date.now() - t2;
  // 4. dilate 3 texels past the chart (bilinear filtering at the edges reads them), then the gradient
  dilate(h, cov, W, H, 3); dilateMask(mask, cov, W, H, 3);
  if (vMap) { const vs = []; for (let k = 0; k < WH; k += 7) if (cov[k]) vs.push(vMap[k]); vs.sort((a, b) => a - b);
    const q = f => +(vs[Math.min(vs.length - 1, Math.floor(vs.length * f))] || 0).toFixed(5); rep.subTexelVar = { sigHmm: +sigH.toFixed(4), p50: q(0.5), p90: q(0.9), p99: q(0.99), mean: +(vs.reduce((s, x) => s + x, 0) / Math.max(1, vs.length)).toFixed(5) };
    // (iteration 10) the same statistics for what the lobes see: the unhidden variance and the hidden share
    const st = a => { const xs = []; for (let k = 0; k < WH; k += 7) if (cov[k]) xs.push(a[k]); xs.sort((x, y) => x - y); const qq = f => +(xs[Math.min(xs.length - 1, Math.floor(xs.length * f))] || 0).toFixed(5);
      return { p50: qq(0.5), p90: qq(0.9), p99: qq(0.99), mean: +(xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length)).toFixed(5) }; };
    rep.lobeSees = { hide: { ...HIDE }, vo: st(voMap), f: st(fMap) };
    dilate(vMap, cov, W, H, 3); dilate(voMap, cov, W, H, 3); dilate(fMap, cov, W, H, 3); }
  const grad = new Float32Array(WH * 2);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = j * W + i, l = h[j * W + Math.max(0, i - 1)], r = h[j * W + Math.min(W - 1, i + 1)], d = h[Math.max(0, j - 1) * W + i], u = h[Math.min(H - 1, j + 1) * W + i];
    grad[k * 2] = (r - l) * 0.001 / (2 / W); grad[k * 2 + 1] = (u - d) * 0.001 / (2 / H); }
  const texMm = texMm0; rep.texelMm = +texMm.toFixed(4);
  // 5. the CAVITY = the relief's own occlusion in context (iteration 2): (a) a horizon-based ambient visibility of the bind surface WITH the
  //    relief over the one WITHOUT it low-passed to a vertex's reach (so FACE's mesh-scale occlusion, which lane B's per-vertex AO already
//    carries, is not counted twice, while the sharp occlusion of the mesh's own corners, which no vertex holds, is kept),
  //    radius aoR mm, 8 azimuths, on the ~1024 grid; a crease of depth D and wall width W darkens a band as wide as its walls (the soft
  //    occlusion bands of the photographs), a ridge brightens a little; (b) the micro cavity (pores, the furrow network, a crease's core):
  //    how far a texel lies under its 0.3 mm neighbourhood
  const t3 = Date.now(), cav = new Float32Array(WH).fill(1);
  let aoRatio = null;
  if (ao) { aoRatio = horizonAO(h, W, H, aoS, aoP, aoC, AW, AH, aoR, A); rep.ao = aoRatio.report;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = j * W + i; if (!cov[k]) continue; const x = (i + 0.5) / aoS - 0.5, y = (j + 0.5) / aoS - 0.5, ix = Math.max(0, Math.min(AW - 2, Math.floor(x))), iy = Math.max(0, Math.min(AH - 2, Math.floor(y))), fx = clamp(x - ix), fy = clamp(y - iy);
      const r = aoRatio.R, q = iy * AW + ix; cav[k] = (r[q] * (1 - fx) + r[q + 1] * fx) * (1 - fy) + (r[q + AW] * (1 - fx) + r[q + AW + 1] * fx) * fy; } }
  const hb = blur(h, W, H, 0.3 / texMm), cavMicro = new Float32Array(WH);
  if (fis) { dilate(fis, cov, W, H, 3); dilate(flk, cov, W, H, 3); } if (poreO) dilate(poreO, cov, W, H, 3);
  for (let k = 0; k < WH; k++) { cavMicro[k] = clamp(1 - 1.6 * Math.max(0, hb[k] - h[k]), 0.45, 1) * (1 - (fis ? fis[k] : 0)) * (1 - (poreO ? poreO[k] : 0)) * (1 + (flk ? flk[k] : 0)); cav[k] = clamp(cav[k] * cavMicro[k], 0.3, 1.1); }
  rep.ms.cavity = Date.now() - t3;
  // the occlusion on each feature's floor (for the measurer: what the bake predicts the crease does to the ambient light)
  rep.features.forEach((r, i) => { const fl = floors[i]; if (!fl || !fl.length) return; let s = 0; for (const k of fl) s += cav[k]; r.aoFloor = +(s / fl.length).toFixed(3); });
  // 6. the split for Cycles (iteration 2): the true displacement takes the relief above ~1 mm wavelength (the valleys, rolls, columns: what
  //    adaptive dicing at ~1 px resolves and what should shape the silhouette), the BUMP takes the rest (pores, the network, pleats, the cores),
  //    chained after the skin's normal map (iteration 1's method BOTH lost its bump part there: the Normal Map node ignores it)
  let hLo = null, hHi = null, cavHi = null;
  if (split) { hLo = blur(h, W, H, 0.25 / texMm); hHi = new Float32Array(WH); cavHi = cavMicro; for (let k = 0; k < WH; k++) hHi[k] = h[k] - hLo[k]; }
  let hmin = 0, hmax = 0; for (let k = 0; k < WH; k++) { if (h[k] < hmin) hmin = h[k]; if (h[k] > hmax) hmax = h[k]; }
  let cmin = 1; for (let k = 0; k < WH; k++) if (cov[k] && cav[k] < cmin) cmin = cav[k];
  rep.hRange = [+hmin.toFixed(3), +hmax.toFixed(3)]; rep.cavMin = +cmin.toFixed(3); rep.ms.total = Date.now() - t0;
  return { W, H, h, grad, cav, mask, cov, pos, hLo, hHi, cavHi, vHi: vMap, voHi: voMap, fHi: fMap, report: rep };
}

// horizon-based ambient visibility on the chart's grid (bind mm), with and without the relief; -> { R (ratio, AW x AH), report }
function horizonAO(h, W, H, aoS, P, C, AW, AH, Rmm, A) {
  const t0 = Date.now(), n = AW * AH, N = new Float32Array(n * 3), hA = new Float32Array(n), Rr = new Float32Array(n).fill(1), VF = new Float32Array(n).fill(-1), VM = new Float32Array(n).fill(1);
  // the relief on the grid: the mean of each aoS x aoS block (no aliasing of the pores into the occlusion)
  for (let j = 0; j < AH; j++) for (let i = 0; i < AW; i++) { let s = 0, c = 0; for (let b = 0; b < aoS; b++) for (let a = 0; a < aoS; a++) { const x = i * aoS + a, y = j * aoS + b; if (x < W && y < H) { s += h[y * W + x]; c++; } } hA[j * AW + i] = c ? s / c : 0; }
  // normals from the grid's positions (central differences), outward (away from a point behind the face)
  const ctr = [0, -25, -85];
  for (let j = 0; j < AH; j++) for (let i = 0; i < AW; i++) { const q = j * AW + i; if (!C[q]) continue;
    const qa = i > 0 && C[q - 1] ? q - 1 : q, qb = i < AW - 1 && C[q + 1] ? q + 1 : q, qc = j > 0 && C[q - AW] ? q - AW : q, qd = j < AH - 1 && C[q + AW] ? q + AW : q;
    if (qa === qb || qc === qd) continue;
    const du = [P[qb * 3] - P[qa * 3], P[qb * 3 + 1] - P[qa * 3 + 1], P[qb * 3 + 2] - P[qa * 3 + 2]], dv = [P[qd * 3] - P[qc * 3], P[qd * 3 + 1] - P[qc * 3 + 1], P[qd * 3 + 2] - P[qc * 3 + 2]];
    let nx = du[1] * dv[2] - du[2] * dv[1], ny = du[2] * dv[0] - du[0] * dv[2], nz = du[0] * dv[1] - du[1] * dv[0]; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    // (iteration 7) the body's patches (more than 180 mm under the eyes: the chest and the abdomen) face +z in the bind: a point behind the
    // face would turn the upper slope of a breast inward
    if (P[q * 3 + 1] < -180 ? nz < 0 : nx * (P[q * 3] - ctr[0]) + ny * (P[q * 3 + 1] - ctr[1]) + nz * (P[q * 3 + 2] - ctr[2]) < 0) { nx = -nx; ny = -ny; nz = -nz; }
    N[q * 3] = nx; N[q * 3 + 1] = ny; N[q * 3 + 2] = nz; }
  const R2 = Rmm * Rmm, ND = 8, dirs = []; for (let d = 0; d < ND; d++) dirs.push([Math.cos(2 * Math.PI * (d + 0.5) / ND), Math.sin(2 * Math.PI * (d + 0.5) / ND)]);
  let sumR = 0, cntR = 0, minR = 1;
  for (let j = 0; j < AH; j++) for (let i = 0; i < AW; i++) { const q = j * AW + i; if (!C[q] || (N[q * 3] === 0 && N[q * 3 + 1] === 0 && N[q * 3 + 2] === 0)) continue;
    const nx = N[q * 3], ny = N[q * 3 + 1], nz = N[q * 3 + 2], hp = hA[q] * 1, px = P[q * 3], py = P[q * 3 + 1], pz = P[q * 3 + 2];
    let occF = 0, occM = 0;
    for (const [dx, dy] of dirs) { let mF = 0, mM = 0;
      for (let m = 1; m <= 40; m++) { const ii = Math.round(i + dx * m), jj = Math.round(j + dy * m); if (ii < 0 || jj < 0 || ii >= AW || jj >= AH) break; const r = jj * AW + ii; if (!C[r]) break;
        const vx = P[r * 3] - px, vy = P[r * 3 + 1] - py, vz = P[r * 3 + 2] - pz, d2 = vx * vx + vy * vy + vz * vz; if (d2 > R2) break; if (d2 < 1e-12) continue;
        const dist = Math.sqrt(d2), att = 1 - d2 / R2, eM = (vx * nx + vy * ny + vz * nz) / dist;
        // with the relief: both points moved along their normals by their heights (mm); the elevation over p's tangent plane
        const hr = hA[r], wx = vx + N[r * 3] * hr - nx * hp, wy = vy + N[r * 3 + 1] * hr - ny * hp, wz = vz + N[r * 3 + 2] * hr - nz * hp, dw = Math.sqrt(wx * wx + wy * wy + wz * wz) || 1e-6, eF = (wx * nx + wy * ny + wz * nz) / dw;
        if (eM * att > mM) mM = eM * att; if (eF * att > mF) mF = eF * att; }
      occF += mF; occM += mM; }
    VF[q] = 1 - occF / ND; VM[q] = 1 - occM / ND; }
  // divide by the mesh's occlusion LOW-PASSED to what a per-vertex AO can hold (lane B's vLikeA, on a 2-3 mm mesh: sigma ~1.5 mm): the sharp
  // occlusion of the mesh's own concave corners (the alar base, the lid fold, the commissures), which no vertex carries, stays in
  let sp = []; for (let j = 0; j < AH; j += 7) for (let i = 0; i + 1 < AW; i += 7) { const q = j * AW + i; if (C[q] && C[q + 1]) sp.push(Math.hypot(P[q * 3 + 3] - P[q * 3], P[q * 3 + 4] - P[q * 3 + 1], P[q * 3 + 5] - P[q * 3 + 2])); }
  sp.sort((a, b) => a - b); const gmm = sp.length ? sp[sp.length >> 1] : 0.35;
  for (let q = 0; q < n; q++) if (!C[q]) VM[q] = 1;
  const VMl = blur(VM, AW, AH, 1.5 / gmm);
  for (let q = 0; q < n; q++) { if (!C[q] || VF[q] < 0) continue; const r = Math.min(1.03, Math.max(0.25, VF[q] / Math.max(0.05, VMl[q])));   // iteration 4: 1.03 (was 1.08: a ridge lifted the indirect light 8 %, the pale philtral wedge)
    Rr[q] = r; sumR += r; cntR++; if (r < minR) minR = r; }
  return { R: Rr, report: { grid: [AW, AH], gridMm: +gmm.toFixed(3), radiusMm: Rmm, mean: +(sumR / Math.max(1, cntR)).toFixed(4), min: +minR.toFixed(3), ms: Date.now() - t0 } };
}

// the vermilion: inside MOUTH's upper and lower borders (bind rows -> mm), within the lips' front zone; soft by 0.15 mm
function lipTester(L) {
  return p => { const x = Math.abs(p[0] - L.cx); if (x > L.halfMm) return 0; const top = L.yAt(x, 2), bot = L.yAt(x, 3); if (p[2] < L.zFrontMm - 9) return 0;
    return sst(-0.15, 0.15, top - p[1]) * sst(-0.15, 0.15, p[1] - bot); };
}
// MOUTH's rows (bind metres) -> the tester's frame (mm, A frame)
export function lipsInMm(A, lines) {
  if (!lines?.rows?.length) return null;
  const o = A.o, rows = lines.rows.map(r => [r[0] * 1000, (r[1] - o[1]) * 1000, (r[2] - o[1]) * 1000, (r[3] - o[1]) * 1000]);
  const yAt = (ax, k) => { if (ax <= rows[0][0]) return rows[0][k]; for (let i = 1; i < rows.length; i++) if (ax <= rows[i][0]) { const t = (ax - rows[i - 1][0]) / (rows[i][0] - rows[i - 1][0] || 1); return rows[i - 1][k] + (rows[i][k] - rows[i - 1][k]) * t; } return rows[rows.length - 1][k]; };
  return { yAt, halfMm: lines.half * 1000, cx: ((lines.center || 0) - o[0]) * 1000, ymMm: rows[0][1], zFrontMm: (lines.z - o[2]) * 1000 };
}
function dilate(a, cov, W, H, n) { let c = cov.slice();
  for (let it = 0; it < n; it++) { const c2 = c.slice(); for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = j * W + i; if (c[k]) continue; let s = 0, m = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue; const kk = jj * W + ii; if (c[kk]) { s += a[kk]; m++; } }
      if (m) { a[k] = s / m; c2[k] = 1; } } c = c2; } }
function dilateMask(a, cov, W, H, n) { let c = cov.slice();
  for (let it = 0; it < n; it++) { const c2 = c.slice(); for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = j * W + i; if (c[k]) continue;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue; const kk = jj * W + ii; if (c[kk]) { for (let q = 0; q < 4; q++) a[k * 4 + q] = a[kk * 4 + q]; c2[k] = 1; break; } } } c = c2; } }
function blur(a, W, H, sig) {
  const r = Math.ceil(sig * 2.5), w = []; let s = 0; for (let i = -r; i <= r; i++) { const v = Math.exp(-0.5 * (i / sig) ** 2); w.push(v); s += v; } for (let i = 0; i < w.length; i++) w[i] /= s;
  const t = new Float32Array(W * H), o = new Float32Array(W * H);
  const span = w.length, padded = new Float64Array(W + 2 * r);
  for (let j = 0; j < H; j++) {
    const row = j * W;
    padded.fill(a[row], 0, r);
    for (let i = 0; i < W; i++) padded[r + i] = a[row + i];
    padded.fill(a[row + W - 1], r + W);
    for (let i = 0; i < W; i++) { let v = 0; for (let q = 0; q < span; q++) v += padded[i + q] * w[q]; t[row + i] = v; }
  }
  const rows = new Float64Array(span);
  for (let j = 0; j < H; j++) {
    for (let q = -r; q <= r; q++) rows[q + r] = Math.min(H - 1, Math.max(0, j + q)) * W;
    for (let i = 0; i < W; i++) { let v = 0; for (let q = 0; q < span; q++) v += t[rows[q] + i] * w[q]; o[j * W + i] = v; }
  }
  return o;
}
