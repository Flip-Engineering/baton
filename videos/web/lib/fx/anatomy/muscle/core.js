// ANATOMY / MUSCLE / CORE (ANAT8-BODY, 8 Oct 2026, iteration 3): the builders that turn ATTACHMENTS ON THE BONES into muscle VOLUMES (NOTES.md D3,
// M1-M3). Metres, the person's bind space (x lateral, L = +x; y up; z forward), the same SDF primitives as the skeleton (skeleton/sdf.js: one part a
// muscle or a head, smooth union inside it, a HARD MIN between parts so the grooves between muscles exist).
//
//   layerOf(parts, maxD)                       a layer to drape on: { parts, d(x, y, z) } (bone + the deeper muscles)
//   dropOn(U, A, n, gap)                       sphere-trace from far outside along -n toward A: the outermost point where U.d = gap (null: no hit)
//   fanSheet(spec) -> part                     a SHEET / FAN muscle: fibres from an origin line to an insertion line, draped on the layer below
//   strap(spec) -> part                        a STRAP (SCM): a band along a path, width and thickness per station
//   slab(name, rows, T, o) -> part             a FILL: a given mid-surface grid with a thickness per point (erectors, the fossae)
//   spindle(name, pts, radii, o) -> part       a FUSIFORM belly along a path (teres major)
//   volumeOf(part, h) / insideFraction(part, layer, h)    numbers for the tests (cm3; the share of a muscle inside bone)
//
// THE DRAPE (why): a sheet muscle's DEEP face lies on what is under it (bone, the deeper muscles, the intercostal wall), at a small gap (fascia,
// bursa); its thickness is the person's (by muscularity), so its OUTER face carries the forms of the layer below plus its own belly. Each grid point of
// the fibre field is pushed onto the layer along an outward direction given per muscle (radial from the trunk's axis, from the humeral head, from the
// hip), with a weight: 1 where the muscle lies on the layer, 0 where it bridges free (the axillary folds), so a fold is a fold and a belly a belly.
import { part as part0, sdParts, sdPart, sheet, ribbon, tube, accelPart } from '../skeleton/sdf.js';
const part = (n, prims, o) => accelPart(part0(n, prims, o));   // muscle parts carry a BVH (hundreds of thick triangles a sheet)

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = a => Math.hypot(a[0], a[1], a[2]), nrm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mad = (o, ...t) => { const r = o.slice(); for (let i = 0; i < t.length; i += 2) { r[0] += t[i][0] * t[i + 1]; r[1] += t[i][1] * t[i + 1]; r[2] += t[i][2] * t[i + 1]; } return r; };
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x)), ss = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
// a bump on [a, b] peaking at m (0 outside), smooth: the thickness profiles of bellies between tendons
export const bump = (t, a = 0, m = 0.5, b = 1, p = 1) => t <= a || t >= b ? 0 : Math.pow(t < m ? Math.sin(Math.PI / 2 * (t - a) / (m - a)) : Math.sin(Math.PI / 2 * (b - t) / (b - m)), p);

export function layerOf(parts, maxD = 0.12) { return { parts, d: (x, y, z) => sdParts(parts, x, y, z, maxD).d }; }

// sphere-trace inward along the ray A + n t from t = from: the outermost t where U.d <= gap (refined by bisection); null when the ray reaches A without
// meeting the layer (the point is over a hollow or beyond the layer's edge: the caller keeps its guide)
export function dropOn(U, A, n, gap, { from = 0.3, minT = 0, eps = 2e-4 } = {}) {
  // start just outside the layer: from 'from' (the guide's distance + a margin, given by the caller) outward until the layer is left behind (a guide
  // inside the cage starts at the cage's own outer face, not across the body)
  let t = from; for (let i = 0; i < 40 && U.d(A[0] + n[0] * t, A[1] + n[1] * t, A[2] + n[2] * t) <= gap; i++) t += 0.01;
  let prev = t, d = U.d(A[0] + n[0] * t, A[1] + n[1] * t, A[2] + n[2] * t);
  for (let i = 0; i < 400 && t > minT; i++) {
    if (d <= gap) { let lo = t, hi = prev; for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; if (U.d(A[0] + n[0] * m, A[1] + n[1] * m, A[2] + n[2] * m) <= gap) lo = m; else hi = m; } return lo; }
    prev = t; t -= Math.max(0.75 * (d - gap), eps); d = U.d(A[0] + n[0] * t, A[1] + n[1] * t, A[2] + n[2] * t); }
  return null;
}
// a polyline resampled to n points evenly by arc length
export function resample(P, n) {
  if (P.length === 1) return Array.from({ length: n }, () => P[0].slice());
  const a = [0]; for (let i = 1; i < P.length; i++) a.push(a[i - 1] + len(sub(P[i], P[i - 1])));
  const L = a[a.length - 1] || 1, out = [];
  for (let k = 0; k < n; k++) { const s = k / (n - 1) * L; let i = 1; while (i < P.length - 1 && a[i] < s) i++; const t = (s - a[i - 1]) / Math.max(1e-9, a[i] - a[i - 1]); out.push(lerp(P[i - 1], P[i], clamp(t, 0, 1))); }
  return out;
}
// a point on a polyline at arc fraction s
export const along = (P, s) => resample(P, 81)[Math.round(clamp(s, 0, 1) * 80)];
// Catmull-Rom upsampling of a grid in both directions (k points per span): smooth outer faces from a coarse fibre field
function upGrid(G, k) {
  const up1 = row => { const out = []; for (let i = 0; i + 1 < row.length; i++) { const p0 = row[Math.max(0, i - 1)], p1 = row[i], p2 = row[i + 1], p3 = row[Math.min(row.length - 1, i + 2)];
      for (let s = 0; s < k; s++) { const t = s / k, t2 = t * t, t3 = t2 * t; out.push(p1.map((_, c) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3))); } }
    out.push(row[row.length - 1].slice()); return out; };
  const rows = G.map(up1), cols = rows[0].map((_, j) => up1(rows.map(r => r[j])));
  return cols[0].map((_, i) => cols.map(c => c[i]));
}
// THE SHEET / FAN builder
//   spec = { name, group, O: origin polyline, I: insertion polyline (or a point), nu, nv, vs: v stations (optional, non-uniform: notches),
//     U: layer below, dir(p, u, v) -> { A, n } (the drape ray's base and outward direction at the guide point), gap(u, v) (m),
//     w(u, v): drape weight (1 on the layer, 0 a free bridge), T(u, v): full thickness (m), bulge(u, v): the guide's outward bow (m),
//     guide(u, v): a custom guide point (overrides O / I interpolation), smooth: Laplacian passes on the draped grid, up: upsampling (default 2) }
export function fanSheet(s) {
  const nu = s.nu || 9, nv = s.nv || 11, vs = s.vs || Array.from({ length: nv }, (_, i) => i / (nv - 1)), us = Array.from({ length: nu }, (_, i) => i / (nu - 1));
  const O = resample(s.O, nu), I = Array.isArray(s.I[0]) ? resample(s.I, nu) : us.map(() => s.I.slice());
  const gap = s.gap || (() => 0.0015), W = s.w || (() => 1), bulge = s.bulge || (() => 0);
  const D = [], Nn = [], meta = { miss: 0, n: 0 };
  for (let i = 0; i < nu; i++) { const row = [], rn = []; for (let j = 0; j < vs.length; j++) { const u = us[i], v = vs[j];
      let G = s.guide ? s.guide(u, v, O[i], I[i]) : lerp(O[i], I[i], v); const { A, n } = s.dir(G, u, v); const b = bulge(u, v); if (b) G = mad(G, n, b);
      const w = W(u, v); let P = G; meta.n++;
      if (w > 0) { const t = dropOn(s.U, A, n, gap(u, v), { from: Math.max(0.01, dot(sub(G, A), n)) + (s.reach ?? 0.04) }); if (t != null) P = lerp(G, mad(A, n, t), w); else if (w > 0.5) meta.miss++; }
      row.push(P); rn.push(n); } D.push(row); Nn.push(rn); }
  // relax the draped grid (bridges small hollows: the intercostal spaces, the gutter beside a spinous process), then keep it on or outside the layer
  for (let it = 0; it < (s.smooth ?? 2); it++) {
    const C = D.map(r => r.map(p => p.slice()));
    for (let i = 1; i < nu - 1; i++) for (let j = 1; j < vs.length - 1; j++) for (let c = 0; c < 3; c++) C[i][j][c] = 0.5 * D[i][j][c] + 0.125 * (D[i - 1][j][c] + D[i + 1][j][c] + D[i][j - 1][c] + D[i][j + 1][c]);
    for (let i = 0; i < nu; i++) for (let j = 0; j < vs.length; j++) { const p = C[i][j], g = gap(us[i], vs[j]); if (W(us[i], vs[j]) > 0.5 && s.U.d(p[0], p[1], p[2]) < g) { const { A, n } = s.dir(p, us[i], vs[j]); const t = dropOn(s.U, A, n, g, { from: Math.max(0.01, dot(sub(p, A), n)) + 0.02 }); if (t != null) C[i][j] = mad(A, n, t); } D[i][j] = C[i][j]; } }
  // the outer normal per grid point (the grid's own, oriented by the drape direction), the mid-surface half a thickness out
  const T = D.map((r, i) => r.map((_, j) => Math.max(0.0016, s.T(us[i], vs[j]))));
  const M = D.map((r, i) => r.map((p, j) => { const du = sub(D[Math.min(nu - 1, i + 1)][j], D[Math.max(0, i - 1)][j]), dv = sub(r[Math.min(r.length - 1, j + 1)], r[Math.max(0, j - 1)]);
    let nn = nrm(crs(du, dv)); if (!(len(nn) > 0.5)) nn = Nn[i][j]; if (dot(nn, Nn[i][j]) < 0) nn = mul(nn, -1); return mad(p, nn, T[i][j] / 2); }));
  const up = s.up ?? 2, Mu = up > 1 ? upGrid(M, up) : M, Tu = up > 1 ? upGrid(T.map(r => r.map(t => [t, 0, 0])), up).map(r => r.map(q => Math.max(0.0008, q[0] / 2))) : T.map(r => r.map(t => t / 2));
  const P = part(s.name, sheet(Mu, Tu), { k: s.k ?? 0.003, group: s.group || 'muscle', kind: 'muscle', meta: { ...(s.meta || {}), drape: meta } });
  P.grid = { D, M, T, us, vs }; return P;
}
// a STRAP: a band along a path, width per station across 'up' (a vector or per station), full thickness per station: three rows across (the edges
// at 45 % of the thickness: a lens-shaped section)
export function strap(name, path, up, width, T, o = {}) {
  const n = path.length, U = i => Array.isArray(up[0]) ? up[i] : up, W = typeof width === 'number' ? path.map(() => width / 2) : width.map(w => w / 2), Th = typeof T === 'number' ? path.map(() => T / 2) : T.map(t => t / 2);
  const rows = [path.map((p, i) => mad(p, U(i), W[i])), path.map(p => p.slice()), path.map((p, i) => mad(p, U(i), -W[i]))];
  const th = [Th.map(t => Math.max(0.0008, 0.45 * t)), Th.map(t => Math.max(0.0008, t)), Th.map(t => Math.max(0.0008, 0.45 * t))];
  return part(name, sheet(rows, th), { k: o.k ?? 0.004, group: o.group || 'muscle', kind: 'muscle', meta: o.meta || {} });
}
// a FILL: a mid-surface grid and a full thickness per point
export function slab(name, rows, T, o = {}) {
  const Tu = T.map(r => r.map(t => Math.max(0.0008, t / 2)));
  const up = o.up ?? 1, R = up > 1 ? upGrid(rows, up) : rows, TT = up > 1 ? upGrid(Tu.map(r => r.map(t => [t, 0, 0])), up).map(r => r.map(q => Math.max(0.0008, q[0]))) : Tu;
  return part(name, sheet(R, TT), { k: o.k ?? 0.004, group: o.group || 'muscle', kind: 'muscle', meta: o.meta || {} });
}
export function spindle(name, pts, radii, o = {}) { return part(name, tube(pts, radii), { k: o.k ?? 0.004, group: o.group || 'muscle', kind: 'muscle', meta: o.meta || {} }); }
function bbOf(prims) { const bb = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9]; for (const P of prims) for (let a = 0; a < 3; a++) { bb[a] = Math.min(bb[a], P.bb[a]); bb[a + 3] = Math.max(bb[a + 3], P.bb[a + 3]); } return bb; }
// ---------------------------------------------------------------- numbers for the tests
// the volume (cm3) by counting the cells inside (h: the cell, m); with a layer, also the share of that volume inside it (muscle inside bone)
export function volumeOf(P, h = 0.004, L = null) {
  const b = P.bb; let n = 0, nin = 0;
  for (let z = b[2] + h / 2; z < b[5]; z += h) for (let y = b[1] + h / 2; y < b[4]; y += h) for (let x = b[0] + h / 2; x < b[3]; x += h) {
    if (sdPart(P, x, y, z, h) < 0) { n++; if (L && L.d(x, y, z) < 0) nin++; } }
  return { cm3: +(n * h * h * h * 1e6).toFixed(1), inside: n ? +(nin / n).toFixed(3) : 0 };
}
