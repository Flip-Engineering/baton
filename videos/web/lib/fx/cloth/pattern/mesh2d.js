// PATTERN / MESH2D (CLOTHING c2, lane K2): a 2D panel -> a triangle mesh for the XPBD cloth. Pure JS, deterministic, no dependencies.
//
//   triangulate(boundary, h, { grain, smooth }) -> { V: Float64Array (n x 2, metres), T: Int32Array (m x 3, counter-clockwise),
//                                                    nb (the first nb vertices ARE the boundary, in its order), quality }
// The boundary is the panel's outline already resampled for sewing (build.js: matched counts on both sides of every seam), so this
// module never adds or moves a boundary vertex: the seam pairing stays exact. Inside it puts a hexagonal lattice of spacing h laid
// along the grain (rows along the warp, so a triangle edge runs warp-wise: the orthotropic stretch in xpbd.js sees clean warp
// edges), keeps lattice points at least 0.55 h from the boundary, triangulates everything (Bowyer-Watson Delaunay), recovers any
// boundary edge the Delaunay mesh lacks by edge flips (Sloan 1993, "A fast algorithm for generating constrained Delaunay
// triangulations"), drops the triangles outside, and relaxes the interior points a few Laplacian passes (a move that would invert
// a triangle is not taken). Edge length about h: 1.5 cm for hero drapes, 2.5-3 cm for a quick sew (NOTES "resolution").
//   quality: { tris, verts, minAngle (deg), p5Angle, below20 (share of triangles with an angle under 20 deg), edgeMean, edgeCv }

// ---------------------------------------------------------------- geometry helpers
const orient = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
function inPoly(x, y, B) { let c = false; const n = B.length / 2; for (let i = 0, j = n - 1; i < n; j = i++) { const xi = B[i * 2], yi = B[i * 2 + 1], xj = B[j * 2], yj = B[j * 2 + 1];
  if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
function segDist(x, y, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0; return Math.hypot(ax + dx * t - x, ay + dy * t - y); }
function distToPoly(x, y, B) { let d = Infinity; const n = B.length / 2; for (let i = 0; i < n; i++) { const j = (i + 1) % n; d = Math.min(d, segDist(x, y, B[i * 2], B[i * 2 + 1], B[j * 2], B[j * 2 + 1])); } return d; }
// proper intersection of segments pq and ab (shared endpoints do not count)
function crosses(P, p, q, a, b) {
  if (p === a || p === b || q === a || q === b) return false;
  const px = P[p * 2], py = P[p * 2 + 1], qx = P[q * 2], qy = P[q * 2 + 1], ax = P[a * 2], ay = P[a * 2 + 1], bx = P[b * 2], by = P[b * 2 + 1];
  const d1 = orient(ax, ay, bx, by, px, py), d2 = orient(ax, ay, bx, by, qx, qy), d3 = orient(px, py, qx, qy, ax, ay), d4 = orient(px, py, qx, qy, bx, by);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// ---------------------------------------------------------------- Bowyer-Watson
function delaunay(P, n) {
  // super triangle
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (let i = 0; i < n; i++) { x0 = Math.min(x0, P[i * 2]); y0 = Math.min(y0, P[i * 2 + 1]); x1 = Math.max(x1, P[i * 2]); y1 = Math.max(y1, P[i * 2 + 1]); }
  const d = Math.max(x1 - x0, y1 - y0) * 20, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  P[n * 2] = cx - d; P[n * 2 + 1] = cy - d; P[n * 2 + 2] = cx + d; P[n * 2 + 3] = cy - d; P[n * 2 + 4] = cx; P[n * 2 + 5] = cy + d;
  let T = [[n, n + 1, n + 2]], C = [circum(P, n, n + 1, n + 2)];
  for (let i = 0; i < n; i++) {
    const x = P[i * 2], y = P[i * 2 + 1], bad = [];
    for (let t = 0; t < T.length; t++) { const c = C[t]; if ((x - c[0]) ** 2 + (y - c[1]) ** 2 < c[2] * (1 - 1e-12)) bad.push(t); }
    // the cavity's boundary: edges of bad triangles not shared by two bad triangles
    const cnt = new Map(); for (const t of bad) { const [a, b, c] = T[t]; for (const [u, v] of [[a, b], [b, c], [c, a]]) { const k = u < v ? u * 1e6 + v : v * 1e6 + u; const e = cnt.get(k); if (e) e.n++; else cnt.set(k, { n: 1, u, v }); } }
    const keep = new Uint8Array(T.length).fill(1); for (const t of bad) keep[t] = 0;
    const T2 = [], C2 = []; for (let t = 0; t < T.length; t++) if (keep[t]) { T2.push(T[t]); C2.push(C[t]); }
    for (const e of cnt.values()) if (e.n === 1) { let a = e.u, b = e.v; if (orient(P[a * 2], P[a * 2 + 1], P[b * 2], P[b * 2 + 1], x, y) < 0) [a, b] = [b, a]; T2.push([a, b, i]); C2.push(circum(P, a, b, i)); }
    T = T2; C = C2;
  }
  return T;
}
function circum(P, a, b, c) {
  const ax = P[a * 2], ay = P[a * 2 + 1], bx = P[b * 2], by = P[b * 2 + 1], cx = P[c * 2], cy = P[c * 2 + 1], d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-20) return [0, 0, Infinity];
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy, ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d, uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  return [ux, uy, (ax - ux) ** 2 + (ay - uy) ** 2];
}

// ---------------------------------------------------------------- edge structure for flips
class Mesh {
  constructor(T, nAll) { this.T = T; this.N = nAll; this.E = new Map(); T.forEach((t, i) => this._add(i)); }
  key(a, b) { return a < b ? a * this.N + b : b * this.N + a; }
  _add(i) { const t = this.T[i]; if (!t) return; for (let k = 0; k < 3; k++) { const a = t[k], b = t[(k + 1) % 3], kk = this.key(a, b); let e = this.E.get(kk); if (!e) this.E.set(kk, e = []); e.push(i); } }
  _del(i) { const t = this.T[i]; for (let k = 0; k < 3; k++) { const kk = this.key(t[k], t[(k + 1) % 3]), e = this.E.get(kk); if (!e) continue; const j = e.indexOf(i); if (j >= 0) e.splice(j, 1); if (!e.length) this.E.delete(kk); } }
  has(a, b) { return this.E.has(this.key(a, b)); }
  // flip the edge a-b shared by two triangles if the quad is strictly convex; returns the new edge [c, d] or null
  flip(P, a, b) {
    const e = this.E.get(this.key(a, b)); if (!e || e.length !== 2) return null; const [t1, t2] = e, A = this.T[t1], B = this.T[t2];
    const c = A.find(v => v !== a && v !== b), d = B.find(v => v !== a && v !== b);
    // convex: c and d on opposite sides of ab, a and b on opposite sides of cd
    const s1 = orient(P[c * 2], P[c * 2 + 1], P[d * 2], P[d * 2 + 1], P[a * 2], P[a * 2 + 1]), s2 = orient(P[c * 2], P[c * 2 + 1], P[d * 2], P[d * 2 + 1], P[b * 2], P[b * 2 + 1]);
    if (!(s1 * s2 < 0)) return null;
    this._del(t1); this._del(t2);
    const mk = (x, y, z) => orient(P[x * 2], P[x * 2 + 1], P[y * 2], P[y * 2 + 1], P[z * 2], P[z * 2 + 1]) > 0 ? [x, y, z] : [x, z, y];
    this.T[t1] = mk(c, d, a); this.T[t2] = mk(d, c, b); this._add(t1); this._add(t2);
    return [c, d];
  }
}
function recover(P, M, a, b) {
  if (M.has(a, b)) return true;
  let list = []; for (const [k, e] of M.E) { const u = Math.floor(k / M.N), v = k - u * M.N; if (crosses(P, u, v, a, b)) list.push([u, v]); }
  let guard = 0;
  while (list.length && guard++ < 20000) {
    const [u, v] = list.shift(); if (!M.has(u, v)) continue;
    const f = M.flip(P, u, v); if (!f) { list.push([u, v]); continue; }
    if (crosses(P, f[0], f[1], a, b)) list.push(f);
  }
  return M.has(a, b);
}

// ---------------------------------------------------------------- the panel mesh
export function triangulate(boundary, h, { grain = [0, 1], smooth = 4, margin = 0.55 } = {}) {
  const B = boundary instanceof Float64Array ? boundary : Float64Array.from(boundary.flat ? boundary.flat() : boundary), nb = B.length / 2;
  // the hex lattice along the grain: e1 = warp x h, e2 = e1 turned 60 deg
  const g = [grain[0], grain[1]], gl = Math.hypot(...g) || 1; g[0] /= gl; g[1] /= gl; const w = [-g[1], g[0]];
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;   // bounds in the lattice frame (s along weft w, t along warp g)
  for (let i = 0; i < nb; i++) { const x = B[i * 2], y = B[i * 2 + 1], s = x * w[0] + y * w[1], t = x * g[0] + y * g[1]; u0 = Math.min(u0, s); u1 = Math.max(u1, s); v0 = Math.min(v0, t); v1 = Math.max(v1, t); }
  const pts = []; const dt = h * Math.sqrt(3) / 2;   // rows along the warp: points spaced h along g, rows spaced dt along w
  for (let r = 0, s = u0; s <= u1; r++, s += dt) for (let t = v0 + (r % 2 ? h / 2 : 0); t <= v1; t += h) {
    const x = s * w[0] + t * g[0], y = s * w[1] + t * g[1]; if (!inPoly(x, y, B)) continue; if (distToPoly(x, y, B) < margin * h) continue; pts.push(x, y); }
  const n = nb + pts.length / 2, P = new Float64Array((n + 3) * 2); P.set(B); P.set(pts, nb * 2);
  const T0 = delaunay(P, n), M = new Mesh(T0.map(t => t.slice()), n + 3);
  let lost = 0; for (let i = 0; i < nb; i++) if (!recover(P, M, i, (i + 1) % nb)) lost++;
  // keep the triangles inside: no super vertex, centroid inside the boundary
  const T = [];
  for (const t of M.T) { if (!t || t[0] >= n || t[1] >= n || t[2] >= n) continue; const cx = (P[t[0] * 2] + P[t[1] * 2] + P[t[2] * 2]) / 3, cy = (P[t[0] * 2 + 1] + P[t[1] * 2 + 1] + P[t[2] * 2 + 1]) / 3;
    if (!inPoly(cx, cy, B)) continue; T.push(t[0], t[1], t[2]); }
  const V = new Float64Array(P.subarray(0, n * 2)), Ti = Int32Array.from(T);
  if (smooth) relax(V, Ti, nb, n, smooth);
  return { V, T: Ti, nb, n, lost, quality: quality(V, Ti) };
}
// Laplacian relaxation of the interior vertices; a move that inverts or flattens a triangle is undone
function relax(V, T, nb, n, passes) {
  const nbr = Array.from({ length: n }, () => new Set()), tri = Array.from({ length: n }, () => []);
  for (let t = 0; t < T.length; t += 3) for (let k = 0; k < 3; k++) { const a = T[t + k]; nbr[a].add(T[t + (k + 1) % 3]).add(T[t + (k + 2) % 3]); tri[a].push(t); }
  const okTri = t => orient(V[T[t] * 2], V[T[t] * 2 + 1], V[T[t + 1] * 2], V[T[t + 1] * 2 + 1], V[T[t + 2] * 2], V[T[t + 2] * 2 + 1]) > 1e-12;
  for (let it = 0; it < passes; it++) for (let v = nb; v < n; v++) { if (!nbr[v].size) continue; let x = 0, y = 0; for (const u of nbr[v]) { x += V[u * 2]; y += V[u * 2 + 1]; } x /= nbr[v].size; y /= nbr[v].size;
    const ox = V[v * 2], oy = V[v * 2 + 1]; V[v * 2] = ox + 0.6 * (x - ox); V[v * 2 + 1] = oy + 0.6 * (y - oy); if (!tri[v].every(okTri)) { V[v * 2] = ox; V[v * 2 + 1] = oy; } }
}
export function quality(V, T) {
  const ang = [], el = []; let bad = 0;
  for (let t = 0; t < T.length; t += 3) { const p = [0, 1, 2].map(k => [V[T[t + k] * 2], V[T[t + k] * 2 + 1]]); let mn = 180;
    for (let k = 0; k < 3; k++) { const a = p[k], b = p[(k + 1) % 3], c = p[(k + 2) % 3], ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - a[0], vy = c[1] - a[1];
      const A = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1)))) * 180 / Math.PI; mn = Math.min(mn, A); el.push(Math.hypot(ux, uy)); }
    ang.push(mn); if (mn < 20) bad++; }
  ang.sort((a, b) => a - b); const em = el.reduce((a, b) => a + b, 0) / Math.max(1, el.length), sd = Math.sqrt(el.reduce((a, b) => a + (b - em) ** 2, 0) / Math.max(1, el.length));
  return { tris: T.length / 3, verts: V.length / 2, minAngle: +(ang[0] ?? 0).toFixed(1), p5Angle: +(ang[Math.floor(ang.length * 0.05)] ?? 0).toFixed(1), below20: +(bad / Math.max(1, ang.length)).toFixed(4), edgeMean: +em.toFixed(4), edgeCv: +(sd / (em || 1)).toFixed(3) };
}
// signed area of a triangle list (positive: counter-clockwise), for checks
export function meshArea(V, T) { let s = 0; for (let t = 0; t < T.length; t += 3) s += orient(V[T[t] * 2], V[T[t] * 2 + 1], V[T[t + 1] * 2], V[T[t + 1] * 2 + 1], V[T[t + 2] * 2], V[T[t + 2] * 2 + 1]) / 2; return s; }
