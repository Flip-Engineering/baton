// ANATOMY / SDF (ANAT8-BODY, 8 Oct 2026): the one representation every anatomical layer uses (bone, muscle, fat offset, skin envelope):
// signed distance fields of anatomically placed primitives. Metres; negative inside. No three.js (node and page alike).
//
//   const P = cone(a, b, ra, rb)          a rounded cone (capsule when ra = rb): exact distance
//   const P = ell(c, axes, r)             an ellipsoid: axes = [ux, uy, uz] unit rows (the local frame), r = [rx, ry, rz]; iq's bound (not exact)
//   const P = box(c, axes, h, rr)         a rounded box: half extents h, rounding rr
//   const P = tri(a, b, c, th)            a thick triangle (sheets: scapula, iliac wing, sternum plates): distance to the triangle - th
//   tube(points, radii) -> cones          a polyline of rounded cones (ribs' cartilage, clavicle, rami, phalanges)
//   sheet(rows, th) -> tris               a grid of points [row][col] -> thick triangles (th: a number or rows of numbers)
//   ribbon(points, up, hw, th) -> tris    a band along a path: half-width hw (number or per point) along 'up' (vector or per point), thickness th
//   const B = part(name, prims, { k, group, meta })   one bone or muscle: smooth union (k: blend radius, m) of its primitives
//   sdPart(B, x, y, z) / sdParts(parts, x, y, z, maxD) / gradPart(B, x, y, z)
//   meshPart(B, h) -> { pos: Float32Array, idx: Uint32Array, nrm: Float32Array }   surface nets on the part's own box, cell h (m)
// Why SDFs: the skin solver needs depth and direction to the layer below from any point; the cutaway needs watertight meshes at any
// resolution; primitives are placed by parameters and cost milliseconds (NOTES.md D1).
const sq = x => x * x;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const BIG = 1e9;
// ---------------------------------------------------------------- primitives (plain objects; the evaluator switches on .t)
export function cone(a, b, ra, rb = ra) {
  const ba = sub(b, a), l2 = Math.max(1e-12, dot(ba, ba)), l = Math.sqrt(l2);
  if (Math.abs(ra - rb) >= l * 0.98) { const r = Math.max(ra, rb), c = ra > rb ? a : b; return sphere(c, r); }   // degenerate: one sphere swallows the other
  const rr = ra - rb, r = Math.max(ra, rb);
  return { t: 1, a: a.slice(), b: b.slice(), ra, rb, ba, l2, rr, a2: l2 - rr * rr, il2: 1 / l2,
    bb: [Math.min(a[0] - ra, b[0] - rb), Math.min(a[1] - ra, b[1] - rb), Math.min(a[2] - ra, b[2] - rb), Math.max(a[0] + ra, b[0] + rb), Math.max(a[1] + ra, b[1] + rb), Math.max(a[2] + ra, b[2] + rb)], r };
}
export function sphere(c, r) { return { t: 0, c: c.slice(), r, bb: [c[0] - r, c[1] - r, c[2] - r, c[0] + r, c[1] + r, c[2] + r] }; }
// axes: [u, v, w] unit vectors (rows of the local frame); a point's local coords are (p-c).u, (p-c).v, (p-c).w
export function ell(c, axes, r) {
  const e = Math.max(r[0], r[1], r[2]); const ext = [0, 1, 2].map(k => Math.abs(axes[0][k]) * r[0] + Math.abs(axes[1][k]) * r[1] + Math.abs(axes[2][k]) * r[2]);
  return { t: 2, c: c.slice(), u: axes[0].slice(), v: axes[1].slice(), w: axes[2].slice(), r: r.slice(), bb: [c[0] - ext[0], c[1] - ext[1], c[2] - ext[2], c[0] + ext[0], c[1] + ext[1], c[2] + ext[2]], rmax: e };
}
export function box(c, axes, h, rr = 0) {
  const ext = [0, 1, 2].map(k => Math.abs(axes[0][k]) * h[0] + Math.abs(axes[1][k]) * h[1] + Math.abs(axes[2][k]) * h[2]);
  return { t: 3, c: c.slice(), u: axes[0].slice(), v: axes[1].slice(), w: axes[2].slice(), h: h.map(x => Math.max(0, x - rr)), rr, bb: [c[0] - ext[0], c[1] - ext[1], c[2] - ext[2], c[0] + ext[0], c[1] + ext[1], c[2] + ext[2]] };
}
export function tri(a, b, c, th) {
  const ba = sub(b, a), cb = sub(c, b), ac = sub(a, c), nor = crs(ba, ac);
  return { t: 4, a: a.slice(), b: b.slice(), c: c.slice(), th, ba, cb, ac, nor, n2: Math.max(1e-18, dot(nor, nor)), cba: crs(ba, nor), ccb: crs(cb, nor), cac: crs(ac, nor),
    iba: 1 / Math.max(1e-18, dot(ba, ba)), icb: 1 / Math.max(1e-18, dot(cb, cb)), iac: 1 / Math.max(1e-18, dot(ac, ac)),
    bb: [Math.min(a[0], b[0], c[0]) - th, Math.min(a[1], b[1], c[1]) - th, Math.min(a[2], b[2], c[2]) - th, Math.max(a[0], b[0], c[0]) + th, Math.max(a[1], b[1], c[1]) + th, Math.max(a[2], b[2], c[2]) + th] };
}
// a CHAIN (prims sharing .g) combines by a hard min inside, so a tube's joints and a sheet's shared edges do not bulge; chains blend by smin
let _chain = 1;
const chain = list => { const g = _chain++; for (const P of list) P.g = g; return list; };
export function tube(pts, radii) {
  const r = typeof radii === 'number' ? pts.map(() => radii) : radii, out = [];
  for (let i = 0; i + 1 < pts.length; i++) out.push(cone(pts[i], pts[i + 1], r[i], r[i + 1]));
  return chain(out);
}
export function sheet(rows, th) {
  const out = [], T = (i, j) => typeof th === 'number' ? th : th[i][j];
  for (let i = 0; i + 1 < rows.length; i++) for (let j = 0; j + 1 < rows[i].length; j++) {
    const a = rows[i][j], b = rows[i][j + 1], c = rows[i + 1][j + 1], d = rows[i + 1][j];
    out.push(tri(a, b, c, (T(i, j) + T(i, j + 1) + T(i + 1, j + 1)) / 3), tri(a, c, d, (T(i, j) + T(i + 1, j + 1) + T(i + 1, j)) / 3));
  }
  return chain(out);
}
export function ribbon(pts, up, hw, th) {
  const U = i => Array.isArray(up[0]) ? up[i] : up, W = i => typeof hw === 'number' ? hw : hw[i];
  const top = pts.map((p, i) => [p[0] + U(i)[0] * W(i), p[1] + U(i)[1] * W(i), p[2] + U(i)[2] * W(i)]);
  const bot = pts.map((p, i) => [p[0] - U(i)[0] * W(i), p[1] - U(i)[1] * W(i), p[2] - U(i)[2] * W(i)]);
  return sheet([top, bot], th);
}
// ---------------------------------------------------------------- evaluation
export function sdPrim(P, x, y, z) {
  switch (P.t) {
    case 0: return Math.hypot(x - P.c[0], y - P.c[1], z - P.c[2]) - P.r;
    case 1: {   // iq's sdRoundCone
      const pa0 = x - P.a[0], pa1 = y - P.a[1], pa2 = z - P.a[2], ba = P.ba, l2 = P.l2;
      const yy = pa0 * ba[0] + pa1 * ba[1] + pa2 * ba[2], zz = yy - l2;
      const xv0 = pa0 * l2 - ba[0] * yy, xv1 = pa1 * l2 - ba[1] * yy, xv2 = pa2 * l2 - ba[2] * yy, x2 = xv0 * xv0 + xv1 * xv1 + xv2 * xv2;
      const y2 = yy * yy * l2, z2 = zz * zz * l2, rr = P.rr, a2 = P.a2, il2 = P.il2, k = Math.sign(rr) * rr * rr * x2;
      if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - P.rb;
      if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - P.ra;
      return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - P.ra;
    }
    case 2: {   // iq's ellipsoid bound
      const dx = x - P.c[0], dy = y - P.c[1], dz = z - P.c[2];
      const lx = (dx * P.u[0] + dy * P.u[1] + dz * P.u[2]) / P.r[0], ly = (dx * P.v[0] + dy * P.v[1] + dz * P.v[2]) / P.r[1], lz = (dx * P.w[0] + dy * P.w[1] + dz * P.w[2]) / P.r[2];
      const k0 = Math.hypot(lx, ly, lz), k1 = Math.hypot(lx / P.r[0], ly / P.r[1], lz / P.r[2]);
      return k1 < 1e-12 ? -Math.min(P.r[0], P.r[1], P.r[2]) : k0 * (k0 - 1) / k1;
    }
    case 3: {
      const dx = x - P.c[0], dy = y - P.c[1], dz = z - P.c[2];
      const qx = Math.abs(dx * P.u[0] + dy * P.u[1] + dz * P.u[2]) - P.h[0], qy = Math.abs(dx * P.v[0] + dy * P.v[1] + dz * P.v[2]) - P.h[1], qz = Math.abs(dx * P.w[0] + dy * P.w[1] + dz * P.w[2]) - P.h[2];
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - P.rr;
    }
    case 4: {   // iq's udTriangle, minus the half thickness
      const pa = [x - P.a[0], y - P.a[1], z - P.a[2]], pb = [x - P.b[0], y - P.b[1], z - P.b[2]], pc = [x - P.c[0], y - P.c[1], z - P.c[2]];
      const s = Math.sign(dot(P.cba, pa)) + Math.sign(dot(P.ccb, pb)) + Math.sign(dot(P.cac, pc));
      let d2;
      if (s < 2) {
        const t1 = Math.min(1, Math.max(0, dot(P.ba, pa) * P.iba)), t2 = Math.min(1, Math.max(0, dot(P.cb, pb) * P.icb)), t3 = Math.min(1, Math.max(0, dot(P.ac, pc) * P.iac));
        d2 = Math.min(sq(P.ba[0] * t1 - pa[0]) + sq(P.ba[1] * t1 - pa[1]) + sq(P.ba[2] * t1 - pa[2]), sq(P.cb[0] * t2 - pb[0]) + sq(P.cb[1] * t2 - pb[1]) + sq(P.cb[2] * t2 - pb[2]), sq(P.ac[0] * t3 - pc[0]) + sq(P.ac[1] * t3 - pc[1]) + sq(P.ac[2] * t3 - pc[2]));
      } else d2 = sq(dot(P.nor, pa)) / P.n2;
      return Math.sqrt(d2) - P.th;
    }
  }
  return BIG;
}
const bbDist = (b, x, y, z) => Math.hypot(Math.max(b[0] - x, 0, x - b[3]), Math.max(b[1] - y, 0, y - b[4]), Math.max(b[2] - z, 0, z - b[5]));
// polynomial smooth min (k in metres: the blend radius)
export function smin(a, b, k) { if (k <= 0) return Math.min(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
// a part: one bone or one muscle
export function part(name, prims, { k = 0.003, group = name, meta = {}, kind = 'bone' } = {}) {
  const bb = [BIG, BIG, BIG, -BIG, -BIG, -BIG];
  for (const P of prims) for (let a = 0; a < 3; a++) { bb[a] = Math.min(bb[a], P.bb[a]); bb[a + 3] = Math.max(bb[a + 3], P.bb[a + 3]); }
  return { name, group, kind, prims, k, bb, meta };
}
export function sdPart(B, x, y, z, cut = BIG) {
  if (B.fn) return bbDist(B.bb, x, y, z) > cut ? cut : B.fn(x, y, z);   // a FIELD part (fat/: the breast's height field): its own function, no primitives
  if (B.bvh) return sdPartBvh(B, x, y, z, cut);
  let d = BIG, cm = BIG, cg = 0; const k = B.k, pr = B.prims;
  if (bbDist(B.bb, x, y, z) > cut) return cut;
  for (let i = 0; i < pr.length; i++) { const P = pr[i], g = P.g || 0;
    if (cg && g !== cg) { d = d >= BIG ? cm : cm >= BIG ? d : smin(d, cm, k); cm = BIG; cg = 0; }
    const lb = bbDist(P.bb, x, y, z); if (lb > Math.min(d, cm) + k) continue; const e = sdPrim(P, x, y, z);
    if (g) { cg = g; if (e < cm) cm = e; } else d = d >= BIG ? e : smin(d, e, k); }
  if (cg && cm < BIG) d = d >= BIG ? cm : smin(d, cm, k);
  return d;
}
// the union of many parts (hard min: joints stay jointed); maxD bounds the search; returns { d, i } (the nearest part's index)
export function sdParts(parts, x, y, z, maxD = 1) {
  let d = maxD, best = -1;
  for (let i = 0; i < parts.length; i++) { const B = parts[i]; if (bbDist(B.bb, x, y, z) >= d) continue; const e = sdPart(B, x, y, z, d); if (e < d) { d = e; best = i; } }
  return { d, i: best };
}
export function gradPart(B, x, y, z, e = 2e-4) {
  const gx = sdPart(B, x + e, y, z) - sdPart(B, x - e, y, z), gy = sdPart(B, x, y + e, z) - sdPart(B, x, y - e, z), gz = sdPart(B, x, y, z + e) - sdPart(B, x, y, z - e), l = Math.hypot(gx, gy, gz) || 1;
  return [gx / l, gy / l, gz / l];
}
// ---------------------------------------------------------------- surface nets (Gibson 1998; the naive dual method): a vertex per sign-changing cell, a quad per sign-changing edge
export function meshPart(B, h = 0.003, { pad = 2, normals = true } = {}) {
  const x0 = B.bb[0] - pad * h, y0 = B.bb[1] - pad * h, z0 = B.bb[2] - pad * h;
  const nx = Math.ceil((B.bb[3] + pad * h - x0) / h) + 1, ny = Math.ceil((B.bb[4] + pad * h - y0) / h) + 1, nz = Math.ceil((B.bb[5] + pad * h - z0) / h) + 1;
  const F = new Float32Array(nx * ny * nz), id = (i, j, k) => i + nx * (j + ny * k);
  // coarse pass (4h): a fine node whose nearest coarse node is farther from the surface than the gap between them keeps the coarse value (the
  // field is ~1-Lipschitz, so its sign is known); only the band around the surface is evaluated exactly
  const Hc = 4 * h, mx = Math.ceil((nx - 1) / 4) + 1, my = Math.ceil((ny - 1) / 4) + 1, mz = Math.ceil((nz - 1) / 4) + 1, C = new Float32Array(mx * my * mz), far = 6 * h;
  for (let k = 0; k < mz; k++) for (let j = 0; j < my; j++) for (let i = 0; i < mx; i++) C[i + mx * (j + my * k)] = sdPart(B, x0 + i * Hc, y0 + j * Hc, z0 + k * Hc, 16 * h);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = C[Math.round(i / 4) + mx * (Math.round(j / 4) + my * Math.round(k / 4))];
    F[id(i, j, k)] = Math.abs(c) > far ? c : sdPart(B, x0 + i * h, y0 + j * h, z0 + k * h, 4 * h); }
  const cx = nx - 1, cy = ny - 1, cz = nz - 1, cid = (i, j, k) => i + cx * (j + cy * k), CV = new Int32Array(cx * cy * cz).fill(-1), pos = [];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]], OFF = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const f = new Float64Array(8);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    let m = 0; for (let c = 0; c < 8; c++) { f[c] = F[id(i + OFF[c][0], j + OFF[c][1], k + OFF[c][2])]; if (f[c] < 0) m |= 1 << c; }
    if (m === 0 || m === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of E) { if ((f[a] < 0) === (f[b] < 0)) continue; const t = f[a] / (f[a] - f[b]); sx += OFF[a][0] + t * (OFF[b][0] - OFF[a][0]); sy += OFF[a][1] + t * (OFF[b][1] - OFF[a][1]); sz += OFF[a][2] + t * (OFF[b][2] - OFF[a][2]); n++; }
    CV[cid(i, j, k)] = pos.length / 3; pos.push(x0 + (i + sx / n) * h, y0 + (j + sy / n) * h, z0 + (k + sz / n) * h);
  }
  const idx = [], quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d); };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {   // x edges
    const a = F[id(i, j, k)] < 0, b = F[id(i + 1, j, k)] < 0; if (a === b) continue;
    quad(CV[cid(i, j - 1, k - 1)], CV[cid(i, j, k - 1)], CV[cid(i, j, k)], CV[cid(i, j - 1, k)], !a); }
  for (let k = 1; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {   // y edges
    const a = F[id(i, j, k)] < 0, b = F[id(i, j + 1, k)] < 0; if (a === b) continue;
    quad(CV[cid(i - 1, j, k - 1)], CV[cid(i - 1, j, k)], CV[cid(i, j, k)], CV[cid(i, j, k - 1)], !a); }
  for (let k = 0; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {   // z edges
    const a = F[id(i, j, k)] < 0, b = F[id(i, j, k + 1)] < 0; if (a === b) continue;
    quad(CV[cid(i - 1, j - 1, k)], CV[cid(i, j - 1, k)], CV[cid(i, j, k)], CV[cid(i - 1, j, k)], !a); }
  const P = new Float32Array(pos), I = new Uint32Array(idx); let N = null;
  if (normals) { N = new Float32Array(P.length); for (let v = 0; v < P.length; v += 3) { const g = gradPart(B, P[v], P[v + 1], P[v + 2]); N[v] = g[0]; N[v + 1] = g[1]; N[v + 2] = g[2]; } }
  return { pos: P, idx: I, nrm: N };
}
// merge meshes (one draw call a layer)
export function mergeMeshes(list) {
  let nv = 0, ni = 0; for (const m of list) { nv += m.pos.length; ni += m.idx.length; }
  const pos = new Float32Array(nv), nrm = new Float32Array(nv), idx = new Uint32Array(ni); let o = 0, oi = 0;
  for (const m of list) { pos.set(m.pos, o); if (m.nrm) nrm.set(m.nrm, o); const base = o / 3; for (let i = 0; i < m.idx.length; i++) idx[oi + i] = m.idx[i] + base; o += m.pos.length; oi += m.idx.length; }
  return { pos, nrm, idx };
}
// translate a part rigidly (all its primitives) by d (metres); the precomputed edge vectors are translation-invariant
export function shiftPart(B, d) {
  const sh = p => { p[0] += d[0]; p[1] += d[1]; p[2] += d[2]; }, sb = b => { for (let a = 0; a < 3; a++) { b[a] += d[a]; b[a + 3] += d[a]; } };
  for (const P of B.prims) { if (P.a) sh(P.a); if (P.b) sh(P.b); if (P.c) sh(P.c); sb(P.bb); }
  sb(B.bb); return B;
}

// ---------------------------------------------------------------- acceleration for parts made of large chains (the muscle sheets: hundreds of thick
// triangles): a bounding-volume hierarchy per chain (the chain's hard min found by a nearest-first descent), the chains then smooth-unioned as in
// sdPart. Opt-in per part (accelPart); the bones never carry one, so their fields are unchanged.
const bbOfList = L => { const b = [BIG, BIG, BIG, -BIG, -BIG, -BIG]; for (const P of L) for (let a = 0; a < 3; a++) { b[a] = Math.min(b[a], P.bb[a]); b[a + 3] = Math.max(b[a + 3], P.bb[a + 3]); } return b; };
function bvhOf(L) {
  const bb = bbOfList(L); if (L.length <= 6) return { bb, leaf: L };
  const ext = [bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]], ax = ext[0] >= ext[1] && ext[0] >= ext[2] ? 0 : ext[1] >= ext[2] ? 1 : 2;
  const S = L.slice().sort((p, q) => (p.bb[ax] + p.bb[ax + 3]) - (q.bb[ax] + q.bb[ax + 3])), h = S.length >> 1;
  return { bb, l: bvhOf(S.slice(0, h)), r: bvhOf(S.slice(h)) };
}
function bvhMin(N, x, y, z, best) {
  if (bbDist(N.bb, x, y, z) >= best) return best;
  if (N.leaf) { for (const P of N.leaf) { if (bbDist(P.bb, x, y, z) >= best) continue; const e = sdPrim(P, x, y, z); if (e < best) best = e; } return best; }
  const dl = bbDist(N.l.bb, x, y, z), dr = bbDist(N.r.bb, x, y, z);
  if (dl <= dr) { best = bvhMin(N.l, x, y, z, best); return bvhMin(N.r, x, y, z, best); }
  best = bvhMin(N.r, x, y, z, best); return bvhMin(N.l, x, y, z, best);
}
export function accelPart(B) {
  const ch = new Map(), loose = []; for (const P of B.prims) { if (P.g) { if (!ch.has(P.g)) ch.set(P.g, []); ch.get(P.g).push(P); } else loose.push(P); }
  B.bvh = { chains: [...ch.values()].map(bvhOf), loose }; return B;
}
function sdPartBvh(B, x, y, z, cut) {
  if (bbDist(B.bb, x, y, z) > cut) return cut;
  const k = B.k; let d = BIG;
  for (const N of B.bvh.chains) { const e = bvhMin(N, x, y, z, Math.min(BIG, (d < BIG ? d : cut) + k + 1e-9)); if (e >= BIG) continue; d = d >= BIG ? e : smin(d, e, k); }
  for (const P of B.bvh.loose) { if (bbDist(P.bb, x, y, z) > Math.min(d, cut) + k) continue; const e = sdPrim(P, x, y, z); d = d >= BIG ? e : smin(d, e, k); }
  return d >= BIG ? cut : d;
}
