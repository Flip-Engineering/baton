// ANAT8 layer core: SIGNED DISTANCE FIELDS (ANAT8-HEAD, 8 Oct; shared with ANAT8-BODY). Units are whatever the caller builds in (the head
// and body anatomies use millimetres in their own frame). Every primitive is a SOLID with a signed distance d(x, y, z) (< 0 inside), an
// axis-aligned box that contains it (for culling) and a LABEL (an integer: the tissue or part it belongs to, for colouring and cutaways).
// A SCENE is an ordered list of steps (add | smooth | sub | inter) over primitives or other scenes; scene.d(x, y, z) is the combined
// distance and scene.label the label of the solid nearest the point (after the last d() call). Pure JS, no dependencies.
//   const S = scene([], 'skull'); S.add(ellipsoid([0, 40, 0], [70, 75, 92]), 0).smooth(tube(pts, radii), 3).sub(ellipsoid(..), 2);
//   S.d(x, y, z); S.label; gradient(S, x, y, z) -> [gx, gy, gz] (unit)
// Exactness: sphere, capsule, round cone, triangle slabs, boxes, torus are exact distances; the ellipsoid is IQ's bound (good near the
// surface, which is all the solver and the mesher need); smooth union / subtraction are exact only far from the blend.
const sqrt = Math.sqrt, abs = Math.abs, min = Math.min, max = Math.max;
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
// polynomial smooth min / max (IQ): k = blend radius
export function smin(a, b, k) { if (k <= 0) return a < b ? a : b; const h = max(k - abs(a - b), 0) / k; return min(a, b) - h * h * k * 0.25; }
export function smax(a, b, k) { if (k <= 0) return a > b ? a : b; const h = max(k - abs(a - b), 0) / k; return max(a, b) + h * h * k * 0.25; }
// ---------------------------------------------------------------- vectors (plain arrays)
export const v3 = { add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len: a => sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]), cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: a => { const l = sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }, lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  dist: (a, b) => sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2), mirrorX: a => [-a[0], a[1], a[2]] };
// an orthonormal basis from a primary axis (w) and a hint for the second (u ~ hint, made orthogonal)
export function basis(w, hint = [1, 0, 0]) { const W = v3.norm(w); let U = v3.sub(hint, v3.mul(W, v3.dot(hint, W))); if (v3.len(U) < 1e-6) U = v3.sub([0, 1, 0], v3.mul(W, W[1])); U = v3.norm(U); return [U, v3.cross(W, U), W]; }
// distance from a point to a box [x0, y0, z0, x1, y1, z1] (0 inside)
export function boxDist(b, x, y, z) { const dx = max(b[0] - x, 0, x - b[3]), dy = max(b[1] - y, 0, y - b[4]), dz = max(b[2] - z, 0, z - b[5]); return sqrt(dx * dx + dy * dy + dz * dz); }
const bbOf = (pts, pad) => { const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; pts.forEach((p, i) => { const r = Array.isArray(pad) ? pad[i] : pad; for (let a = 0; a < 3; a++) { b[a] = min(b[a], p[a] - r); b[a + 3] = max(b[a + 3], p[a] + r); } }); return b; };
const prim = (kind, d, aabb, o = {}) => ({ kind, d, aabb, label: o.label ?? 0, name: o.name || kind, meta: o.meta || null });

// ---------------------------------------------------------------- primitives
export function sphere(c, r, o) { const [cx, cy, cz] = c; return prim('sphere', (x, y, z) => sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2) - r, bbOf([c], r), o); }
// an oriented ellipsoid: centre c, radii r = [ru, rv, rw] along the basis B = [U, V, W] (default the axes); IQ's bound
export function ellipsoid(c, r, o = {}) {
  const B = o.basis || [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [U, V, W] = B, [a, b, cc] = r, [cx, cy, cz] = c;
  const ext = [0, 1, 2].map(k => sqrt((U[k] * a) ** 2 + (V[k] * b) ** 2 + (W[k] * cc) ** 2));
  return prim('ellipsoid', (x, y, z) => { const px = x - cx, py = y - cy, pz = z - cz, u = px * U[0] + py * U[1] + pz * U[2], v = px * V[0] + py * V[1] + pz * V[2], w = px * W[0] + py * W[1] + pz * W[2];
    const k0 = sqrt((u / a) ** 2 + (v / b) ** 2 + (w / cc) ** 2), k1 = sqrt((u / (a * a)) ** 2 + (v / (b * b)) ** 2 + (w / (cc * cc)) ** 2);
    return k1 < 1e-12 ? -min(a, b, cc) : k0 * (k0 - 1) / k1; }, [cx - ext[0], cy - ext[1], cz - ext[2], cx + ext[0], cy + ext[1], cz + ext[2]], o);
}
// round cone between a (radius ra) and b (radius rb): IQ's exact distance (a capsule when ra = rb)
export function roundCone(a, b, ra, rb, o) {
  const ba = v3.sub(b, a), l2 = v3.dot(ba, ba), rr = ra - rb;
  if (l2 < 1e-12 || sqrt(l2) <= abs(rr) + 1e-9) return ra >= rb ? sphere(a, ra, o) : sphere(b, rb, o);
  const a2 = l2 - rr * rr, il2 = 1 / l2, [ax, ay, az] = a, [bx, by, bz] = ba;
  return prim('roundCone', (x, y, z) => { const px = x - ax, py = y - ay, pz = z - az, yy = px * bx + py * by + pz * bz, zz = yy - l2;
    const qx = px * l2 - bx * yy, qy = py * l2 - by * yy, qz = pz * l2 - bz * yy, x2 = qx * qx + qy * qy + qz * qz, y2 = yy * yy * l2, z2 = zz * zz * l2, k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zz) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - rb;
    if (Math.sign(yy) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - ra;
    return (sqrt(x2 * a2 * il2) + yy * rr) * il2 - ra; }, bbOf([a, b], [ra, rb]), o);
}
export const capsule = (a, b, r, o) => roundCone(a, b, r, r, o);
// a TUBE along a polyline with a radius per point (round cones smooth-unioned by k); closed: the last point joins the first
export function tube(pts, radii, o = {}) {
  const R = Array.isArray(radii) ? radii : pts.map(() => radii), n = pts.length, segs = [], k = o.k ?? 0;
  for (let i = 0; i + 1 < n + (o.closed ? 1 : 0); i++) { const j = (i + 1) % n; segs.push(roundCone(pts[i], pts[j], R[i], R[j])); }
  const aabb = bbOf(pts, R);
  return prim('tube', (x, y, z) => { let d = Infinity; for (const s of segs) { if (boxDist(s.aabb, x, y, z) >= d + k) continue; d = smin(d, s.d(x, y, z), k); } return d; }, aabb, { ...o, meta: { pts, radii: R, ...(o.meta || {}) } });
}
// a rounded oriented box: centre c, half sizes h, basis B, corner radius rc
export function box(c, h, o = {}) {
  const [U, V, W] = o.basis || [[1, 0, 0], [0, 1, 0], [0, 0, 1]], rc = o.round ?? 0, [cx, cy, cz] = c, hx = h[0] - rc, hy = h[1] - rc, hz = h[2] - rc;
  const ext = [0, 1, 2].map(k => abs(U[k] * h[0]) + abs(V[k] * h[1]) + abs(W[k] * h[2]));
  return prim('box', (x, y, z) => { const px = x - cx, py = y - cy, pz = z - cz, qx = abs(px * U[0] + py * U[1] + pz * U[2]) - hx, qy = abs(px * V[0] + py * V[1] + pz * V[2]) - hy, qz = abs(px * W[0] + py * W[1] + pz * W[2]) - hz;
    const ox = max(qx, 0), oy = max(qy, 0), oz = max(qz, 0); return sqrt(ox * ox + oy * oy + oz * oz) + min(max(qx, qy, qz), 0) - rc; }, [cx - ext[0], cy - ext[1], cz - ext[2], cx + ext[0], cy + ext[1], cz + ext[2]], o);
}
// a torus in the plane normal to axis W of basis B: major radius R, minor r
export function torus(c, R, r, o = {}) {
  const [U, V, W] = o.basis || [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [cx, cy, cz] = c;
  return prim('torus', (x, y, z) => { const px = x - cx, py = y - cy, pz = z - cz, u = px * U[0] + py * U[1] + pz * U[2], v = px * V[0] + py * V[1] + pz * V[2], w = px * W[0] + py * W[1] + pz * W[2];
    const q = sqrt(u * u + v * v) - R; return sqrt(q * q + w * w) - r; }, bbOf([c], R + r), o);
}
// a half-space: the solid side is where dot(p - p0, n) < 0 (n points OUT of the solid); unbounded
export function halfSpace(p0, n, o) { const N = v3.norm(n), [px, py, pz] = p0; return prim('half', (x, y, z) => (x - px) * N[0] + (y - py) * N[1] + (z - pz) * N[2], [-1e9, -1e9, -1e9, 1e9, 1e9, 1e9], o); }

// ---------------------------------------------------------------- triangles: closest point (Ericson), slabs and SHEETS
// closest point on triangle abc to p: writes [qx, qy, qz, u, v, w] (barycentrics) into out; returns the squared distance
export function closestTri(px, py, pz, A, B, C, out) {
  const abx = B[0] - A[0], aby = B[1] - A[1], abz = B[2] - A[2], acx = C[0] - A[0], acy = C[1] - A[1], acz = C[2] - A[2], apx = px - A[0], apy = py - A[1], apz = pz - A[2];
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz; let u, v, w;
  if (d1 <= 0 && d2 <= 0) { u = 1; v = 0; w = 0; }
  else { const bpx = px - B[0], bpy = py - B[1], bpz = pz - B[2], d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { u = 0; v = 1; w = 0; }
    else { const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const t = d1 / (d1 - d3); u = 1 - t; v = t; w = 0; }
      else { const cpx = px - C[0], cpy = py - C[1], cpz = pz - C[2], d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) { u = 0; v = 0; w = 1; }
        else { const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const t = d2 / (d2 - d6); u = 1 - t; v = 0; w = t; }
          else { const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const t = (d4 - d3) / ((d4 - d3) + (d5 - d6)); u = 0; v = 1 - t; w = t; }
            else { const den = 1 / (va + vb + vc); v = vb * den; w = vc * den; u = 1 - v - w; } } } } } }
  const qx = u * A[0] + v * B[0] + w * C[0], qy = u * A[1] + v * B[1] + w * C[1], qz = u * A[2] + v * B[2] + w * C[2];
  out[0] = qx; out[1] = qy; out[2] = qz; out[3] = u; out[4] = v; out[5] = w; return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
}
// a SHEET: a grid of points rows x cols (a lofted patch) with a half-thickness per point, as a solid slab of rounded edges; the
// thickness is interpolated at the closest point (continuous across the triangles). The workhorse for plates (bone), muscle sheets
// and fat pads. grid: [[p, ..], ..] (rows of points), half: same shape (numbers) or one number.
export function sheet(grid, half, o = {}) {
  const rows = grid.length, cols = grid[0].length, H = typeof half === 'number' ? grid.map(r => r.map(() => half)) : half, tris = [];
  for (let i = 0; i + 1 < rows; i++) for (let j = 0; j + 1 < cols; j++) { const a = grid[i][j], b = grid[i][j + 1], c = grid[i + 1][j + 1], d = grid[i + 1][j], ha = H[i][j], hb = H[i][j + 1], hc = H[i + 1][j + 1], hd = H[i + 1][j];
    tris.push({ A: a, B: b, C: c, h: [ha, hb, hc], bb: bbOf([a, b, c], max(ha, hb, hc)), core: bbOf([a, b, c], 0), pad: max(ha, hb, hc) }, { A: a, B: c, C: d, h: [ha, hc, hd], bb: bbOf([a, c, d], max(ha, hc, hd)), core: bbOf([a, c, d], 0), pad: max(ha, hc, hd) }); }
  const aabb = bbOf(grid.flat(), H.flat()), out = new Float64Array(6);
  // a bounding-volume tree over the triangles once there are more than a few (rev 2: dense, smooth sheets stay fast)
  const T = tris.length > 24 ? bvh(tris, t => t.core, 4, t => t.pad) : null;
  const one = (t, x, y, z) => { const d2 = closestTri(x, y, z, t.A, t.B, t.C, out); return sqrt(d2) - (out[3] * t.h[0] + out[4] * t.h[1] + out[5] * t.h[2]); };
  return prim('sheet', T ? (x, y, z) => T.min(x, y, z, one) : (x, y, z) => { let best = Infinity;
    for (const t of tris) { if (boxDist(t.core, x, y, z) - t.pad >= best) continue; const d = one(t, x, y, z); if (d < best) best = d; }
    return best; }, aabb, { ...o, meta: { grid, half: H, ...(o.meta || {}) } });
}
// ---------------------------------------------------------------- rev 2 (8 Oct, it2): smooth lofts, sweeps, a BVH, custom fields
// Catmull-Rom through pts (arrays of numbers of any length), n samples per segment; the last point included
export function catmull(pts, n = 4) { if (pts.length < 2 || n <= 1) return pts.map(p => p.slice()); const out = [], P = [pts[0], ...pts, pts[pts.length - 1]], K = pts[0].length;
  for (let i = 1; i + 2 < P.length; i++) for (let s = 0; s < n; s++) { const t = s / n, t2 = t * t, t3 = t2 * t, a = P[i - 1], b = P[i], c = P[i + 1], d = P[i + 2], q = new Array(K);
    for (let k = 0; k < K; k++) q[k] = 0.5 * (2 * b[k] + (-a[k] + c[k]) * t + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t2 + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t3); out.push(q); }
  out.push(pts[pts.length - 1].slice()); return out; }
// a bounding-volume tree over items: T.min(x, y, z, fn) = the minimum of fn(item, x, y, z, best) over the items, visiting only the nodes
// whose LOWER BOUND (the distance to the node's box of the items' cores, less the largest pad) is below the best so far. Each item gives
// its core box (e.g. a triangle's or a segment's own box) and a pad (its largest thickness or radius): fn >= boxDist(core) - pad must hold,
// which keeps the bound valid INSIDE the solid too (negative distances).
export function bvh(items, bbOfItem, leaf = 4, padOf = () => 0) {
  const B = items.map(bbOfItem), Pd = items.map(padOf), C = B.map(b => [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]);
  const build = ids => { const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; let pad = 0; for (const i of ids) { pad = max(pad, Pd[i]); for (let a = 0; a < 3; a++) { bb[a] = min(bb[a], B[i][a]); bb[a + 3] = max(bb[a + 3], B[i][a + 3]); } }
    if (ids.length <= leaf) return { bb, pad, items: ids.map(i => items[i]) };
    let ax = 0, ext = -1; for (let a = 0; a < 3; a++) { let lo = Infinity, hi = -Infinity; for (const i of ids) { lo = min(lo, C[i][a]); hi = max(hi, C[i][a]); } if (hi - lo > ext) { ext = hi - lo; ax = a; } }
    const s = ids.slice().sort((p, q) => C[p][ax] - C[q][ax]), h = s.length >> 1; return { bb, pad, l: build(s.slice(0, h)), r: build(s.slice(h)) }; };
  const root = build(items.map((_, i) => i));
  return { root, min: (x, y, z, fn) => { let best = Infinity; const st = [root];
    while (st.length) { const nd = st.pop(); if (boxDist(nd.bb, x, y, z) - nd.pad >= best) continue;
      if (nd.items) { for (const it of nd.items) { const d = fn(it, x, y, z, best); if (d < best) best = d; } continue; }
      const dl = boxDist(nd.l.bb, x, y, z) - nd.l.pad, dr = boxDist(nd.r.bb, x, y, z) - nd.r.pad; if (dl < dr) { st.push(nd.r, nd.l); } else { st.push(nd.l, nd.r); } }
    return best; } };
}
// a SMOOTH SHEET: a coarse control grid (rows x cols of points, half-thicknesses) refined by Catmull-Rom in both directions (nu along the
// rows' index, nv along the columns') before it becomes a sheet: no corrugation from the control spacing
export function smoothSheet(ctrl, half, o = {}) {
  const nu = o.nu ?? 3, nv = o.nv ?? 3, Hc = typeof half === 'number' ? ctrl.map(r => r.map(() => half)) : half;
  const rowsR = ctrl.map((r, i) => catmull(r.map((p, j) => [p[0], p[1], p[2], Hc[i][j]]), nv));   // refine along each row
  const cols = rowsR[0].length, dense = []; for (let j = 0; j < cols; j++) { const col = catmull(rowsR.map(r => r[j]), nu); col.forEach((p, i) => { (dense[i] ||= [])[j] = p; }); }
  return sheet(dense.map(r => r.map(p => [p[0], p[1], p[2]])), dense.map(r => r.map(p => max(0.05, p[3]))), o);
}
// a SWEEP: a solid along a spine (control points, refined by Catmull-Rom: o.sub samples per span) with a cross-section per control point in
// the plane normal to the spine: an asymmetric superellipse with half-widths a = [a+, a-] along U (o.up, a vector or one per control point,
// made normal to the spine) and b = [b+, b-] along V = T x U, exponent n (2 an ellipse, 3-4 a rounded rectangle). sec[i] = { a, b, n } (a, b:
// numbers or pairs). Flat caps at the two ends (taper the radii there to round them); the slices overlap a little at the joints. The
// workhorse for bones with a section (the mandible's body, the ramus, the zygomatic arch, the rims) and, later, muscle bellies and ribbons.
export function sweep(spine, sec, o = {}) {
  const sub = o.sub ?? 4, ups = Array.isArray(o.up?.[0]) ? o.up : spine.map(() => o.up || [0, 1, 0]);
  const pair = v => (Array.isArray(v) ? v : [v, v]);
  const ctl = spine.map((p, i) => { const s = sec[i] || sec[sec.length - 1], a = pair(s.a), b = pair(s.b); return [p[0], p[1], p[2], a[0], a[1], b[0], b[1], s.n ?? 2, ups[i][0], ups[i][1], ups[i][2]]; });
  const R = catmull(ctl, sub), n = R.length, Pp = R.map(r => [r[0], r[1], r[2]]);
  const T = Pp.map((p, i) => v3.norm(v3.sub(Pp[min(n - 1, i + 1)], Pp[max(0, i - 1)])));
  const U = R.map((r, i) => { const u0 = [r[8], r[9], r[10]], t = T[i]; let u = v3.sub(u0, v3.mul(t, v3.dot(u0, t))); if (v3.len(u) < 1e-6) u = basis(t)[0]; return v3.norm(u); });
  const V = U.map((u, i) => v3.cross(T[i], u));
  const segs = []; for (let i = 0; i + 1 < n; i++) { const A = Pp[i], D = v3.sub(Pp[i + 1], A), len = v3.len(D) || 1e-9, rmax = max(R[i][3], R[i][4], R[i][5], R[i][6], R[i + 1][3], R[i + 1][4], R[i + 1][5], R[i + 1][6]);
    // the slices overlap at a joint by what the bend needs (r sin(angle / 2)) to close the wedge on the outside of the bend
    const bend = j => (j <= 0 || j >= n - 1) ? 0 : Math.acos(clamp(v3.dot(v3.norm(v3.sub(Pp[j], Pp[j - 1])), v3.norm(v3.sub(Pp[j + 1], Pp[j]))), -1, 1));
    const ov0 = i === 0 ? 0 : 0.05 + rmax * Math.sin(bend(i) / 2), ov1 = i + 2 === n ? 0 : 0.05 + rmax * Math.sin(bend(i + 1) / 2);
    segs.push({ A, D, len, Ts: v3.mul(D, 1 / len), i, ov0, ov1, rmax, first: i === 0, last: i + 2 === n, bb: bbOf([A, Pp[i + 1]], rmax + 0.8 + max(ov0, ov1)), core: bbOf([A, Pp[i + 1]], 0), pad: rmax + 0.8 + max(ov0, ov1) }); }
  const lerpN = (a, b, t) => a + (b - a) * t;
  const one = (s, x, y, z, best = Infinity) => { const i = s.i, qx = x - s.A[0], qy = y - s.A[1], qz = z - s.A[2], ax = qx * s.Ts[0] + qy * s.Ts[1] + qz * s.Ts[2], t = ax <= 0 ? 0 : ax >= s.len ? 1 : ax / s.len;
    const r0 = R[i], r1 = R[i + 1], cx = s.A[0] + s.D[0] * t, cy = s.A[1] + s.D[1] * t, cz = s.A[2] + s.D[2] * t, px = x - cx, py = y - cy, pz = z - cz;
    if (best < Infinity && sqrt(px * px + py * py + pz * pz) - s.rmax - 1 >= best) return Infinity;
    let ux = lerpN(U[i][0], U[i + 1][0], t), uy = lerpN(U[i][1], U[i + 1][1], t), uz = lerpN(U[i][2], U[i + 1][2], t), vx = lerpN(V[i][0], V[i + 1][0], t), vy = lerpN(V[i][1], V[i + 1][1], t), vz = lerpN(V[i][2], V[i + 1][2], t);
    const lu = sqrt(ux * ux + uy * uy + uz * uz) || 1, lv = sqrt(vx * vx + vy * vy + vz * vz) || 1, u = (px * ux + py * uy + pz * uz) / lu, v = (px * vx + py * vy + pz * vz) / lv;
    const a = u >= 0 ? lerpN(r0[3], r1[3], t) : lerpN(r0[4], r1[4], t), b = v >= 0 ? lerpN(r0[5], r1[5], t) : lerpN(r0[6], r1[6], t), ne = lerpN(r0[7], r1[7], t);
    let d2;
    if (abs(ne - 2) < 1e-3) { const k0 = sqrt((u / a) ** 2 + (v / b) ** 2), k1 = sqrt((u / (a * a)) ** 2 + (v / (b * b)) ** 2); d2 = k1 < 1e-12 ? -min(a, b) : k0 * (k0 - 1) / k1; }
    else { const ua = abs(u) / a, vb = abs(v) / b, f = Math.pow(ua ** ne + vb ** ne, 1 / ne); if (f < 1e-9) d2 = -min(a, b); else { const fp = Math.pow(f, 1 - ne), gu = fp * ua ** (ne - 1) / a, gv = fp * vb ** (ne - 1) / b, g = sqrt(gu * gu + gv * gv); d2 = g < 1e-12 ? -min(a, b) : (f - 1) / g; } }
    // the caps: real at the sweep's two ends; at an interior joint only the overshoot beyond the (slightly extended) slice counts, so a
    // point inside the solid near a joint keeps its true in-plane depth (no fake internal cap surfaces)
    const wS = s.first ? -ax : ax < -s.ov0 ? -ax - s.ov0 : -Infinity, wE = s.last ? ax - s.len : ax > s.len + s.ov1 ? ax - s.len - s.ov1 : -Infinity, w = max(wS, wE);
    if (w === -Infinity) return d2;
    return min(max(d2, w), 0) + sqrt(max(d2, 0) ** 2 + max(w, 0) ** 2); };
  const TT = bvh(segs, s => s.core, 4, s => s.pad), aabb = [0, 1, 2].map(k => min(...segs.map(s => s.bb[k]))).concat([0, 1, 2].map(k => max(...segs.map(s => s.bb[k + 3]))));
  return prim('sweep', (x, y, z) => TT.min(x, y, z, one), aabb, { ...o, meta: { spine: Pp, frames: { T, U, V }, R, ...(o.meta || {}) } });
}
// a CUSTOM solid: any distance-like function with a box (the caller vouches that d is a distance bound near the surface)
export const custom = (d, aabb, o = {}) => prim(o.kind || 'custom', d, aabb, o);
// shorten a solid on one side of a plane (axis = c), smoothly: the stretch of the coordinate grows from 1 at the plane to s over `ramp`
// mm (then stays s), and d is divided by the local stretch (a bound near the surface); no crease at the plane. Used to shorten the vault's
// back without moving its front.
export function squeeze(P, c, axis, s, side = -1, o = {}) { const b = P.aabb.slice(), R = o.ramp ?? 40;
  const out = (x, y, z) => { const q = [x, y, z], t = (q[axis] - c) * side; if (t <= 0) return P.d(x, y, z);
    const w = t >= R ? 1 : (t / R) * (t / R) * (3 - 2 * t / R), I = t >= R ? R / 2 + (t - R) : t * t * t / (R * R) - t * t * t * t / (2 * R * R * R);   // I = integral of w
    const tt = t + (s - 1) * I; q[axis] = c + side * tt; return P.d(q[0], q[1], q[2]) / (1 + (s - 1) * w); };
  if (side < 0) b[axis] = c + (b[axis] - c) / s; else b[axis + 3] = c + (b[axis + 3] - c) / s; return prim(P.kind + '^', out, b, { label: o.label ?? P.label, name: o.name || P.name, meta: P.meta }); }
// a triangle slab (one triangle, one half-thickness) and a quad slab
export const triSlab = (a, b, c, h, o) => sheet([[a, b], [c, c]], h, o);
export const quadSlab = (a, b, c, d, h, o) => sheet([[a, b], [d, c]], h, o);

// ---------------------------------------------------------------- transforms of a primitive
// mirror in x (left <-> right): the anatomy is built on the left (+x) and mirrored
export function mirrorX(P, o = {}) { const b = P.aabb; return prim(P.kind + '~', (x, y, z) => P.d(-x, y, z), [-b[3], b[1], b[2], -b[0], b[4], b[5]], { label: o.label ?? P.label, name: o.name || P.name + '_R', meta: P.meta }); }
// a variable OFFSET of a solid: d - t(x, y, z) (t >= 0 grows it); maxT bounds t for the box
export function offset(P, t, maxT, o = {}) { const b = P.aabb; return prim('offset', typeof t === 'number' ? (x, y, z) => P.d(x, y, z) - t : (x, y, z) => P.d(x, y, z) - t(x, y, z),
  [b[0] - maxT, b[1] - maxT, b[2] - maxT, b[3] + maxT, b[4] + maxT, b[5] + maxT], { label: o.label ?? P.label, name: o.name || P.name + '+', meta: P.meta }); }

// ---------------------------------------------------------------- scenes
// scene(steps?, name): steps are { op: 'add' | 'smooth' | 'sub' | 'inter', p: primitive or scene, k }. A scene is itself a primitive
// (nest them: a bone is a scene, the skull a scene of bones). d() sets scene.label (the label of the nearest added solid) and
// scene.part (its name).
export function scene(steps = [], name = 'scene', o = {}) {
  const S = { kind: 'scene', name, label: o.label ?? 0, steps: [], aabb: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], part: null, meta: o.meta || null };
  const grow = b => { for (let a = 0; a < 3; a++) { S.aabb[a] = min(S.aabb[a], b[a]); S.aabb[a + 3] = max(S.aabb[a + 3], b[a + 3]); } };
  // k: a blend radius, or (rev 2) a function k(x, y, z) of position with k.max its bound (a margin sharp in one place, rounded in another)
  S.push = (op, p, k = 0) => { if (!p) return S; const kf = typeof k === 'function' ? k : null, km = kf ? (kf.max ?? 4) : k; S.steps.push({ op, p, k: km, kf }); if (op === 'add' || op === 'smooth') grow(p.aabb.map((x, i) => x + (i < 3 ? -km : km))); return S; };
  S.add = (p, k = 0) => S.push(typeof k === 'function' || k > 0 ? 'smooth' : 'add', p, k); S.smooth = (p, k) => S.push('smooth', p, k); S.sub = (p, k = 0) => S.push('sub', p, k); S.inter = (p, k = 0) => S.push('inter', p, k);
  S.d = (x, y, z) => { let d = Infinity, lab = S.label, part = null;
    for (const st of S.steps) { const p = st.p, k = st.k;
      if (st.op === 'add' || st.op === 'smooth') { if (boxDist(p.aabb, x, y, z) >= d + k) continue; const dp = p.d(x, y, z); if (dp < d) { lab = p.kind === 'scene' ? p.label_ : p.label; part = p.kind === 'scene' ? p.part : p.name; } d = st.op === 'add' ? min(d, dp) : smin(d, dp, st.kf ? st.kf(x, y, z) : k); }
      else if (st.op === 'sub') { if (boxDist(p.aabb, x, y, z) >= k + max(0, -d) + 1e-9) continue; d = smax(d, -p.d(x, y, z), st.kf ? st.kf(x, y, z) : k); }   // (a cutter farther than k + max(0, -d) cannot change d)
      else d = smax(d, p.d(x, y, z), st.kf ? st.kf(x, y, z) : k); }
    S.label_ = lab; S.part = part; return d; };
  for (const st of steps) S.push(st.op, st.p, st.k);
  return S;
}
// the label and part at a point (after evaluating)
export function labelAt(S, x, y, z) { const d = S.d(x, y, z); return { d, label: S.kind === 'scene' ? S.label_ : S.label, part: S.kind === 'scene' ? S.part : S.name }; }
// unit gradient by central differences (h in the scene's units)
export function gradient(S, x, y, z, h = 0.2, out = [0, 0, 0]) {
  const gx = S.d(x + h, y, z) - S.d(x - h, y, z), gy = S.d(x, y + h, z) - S.d(x, y - h, z), gz = S.d(x, y, z + h) - S.d(x, y, z - h), l = sqrt(gx * gx + gy * gy + gz * gz) || 1;
  out[0] = gx / l; out[1] = gy / l; out[2] = gz / l; return out;
}
// march from p along dir until the field crosses 0 (the first surface hit); returns the distance or null
export function rayHit(S, p, dir, maxT = 200, eps = 0.05) { let t = 0; for (let i = 0; i < 256 && t < maxT; i++) { const d = S.d(p[0] + dir[0] * t, p[1] + dir[1] * t, p[2] + dir[2] * t); if (abs(d) < eps) return t; t += max(abs(d) * 0.9, eps); } return null; }
// project a point onto the surface (Newton steps along the gradient)
export function project(S, p, iters = 8) { let q = [...p]; const g = [0, 0, 0]; for (let i = 0; i < iters; i++) { const d = S.d(q[0], q[1], q[2]); if (abs(d) < 1e-3) break; gradient(S, q[0], q[1], q[2], 0.15, g); q = [q[0] - d * g[0], q[1] - d * g[1], q[2] - d * g[2]]; } return q; }
// a HEIGHT SLAB: the solid between a front surface z = f(x, y) and a parallel back surface t(x, y) behind it (t > 0, measured along the
// surface's normal, so a steep part keeps its thickness, up to twice t along the height axis; o.axis 'z' | 'x' | 'y' names the height
// axis, the other two in order: for 'x' the surface is x = f(y, z)), inside a region of the other two coordinates given as a 2-D signed
// distance region(u, v) (negative inside), the slab's edges rounded by o.k. The distance is the height difference over the surface's slope
// (a bound near the surface). The workhorse for forward-facing plates (the brow, the maxilla's front, the bony nasal pyramid): their form
// is an analytic function (a profile, a plan curvature, a fossa, an eminence), so it is smooth and every feature is a parameter.
export function heightSlab(f, t, region, o = {}) {
  const ax = o.axis || 'z', k = o.k ?? 1.5, e = 0.4, sgn = o.dir ?? 1;
  const map = ax === 'z' ? (x, y, z) => [x, y, z] : ax === 'x' ? (x, y, z) => [y, z, x] : (x, y, z) => [z, x, y];
  const tf = typeof t === 'number' ? () => t : t;
  return prim('slab', (x, y, z) => { const [u, v, h] = map(x, y, z), F = f(u, v), fu = (f(u + e, v) - f(u - e, v)) / (2 * e), fv = (f(u, v + e) - f(u, v - e)) / (2 * e), g = sqrt(1 + fu * fu + fv * fv);
    const t = tf(u, v), hs = sgn * (h - F), ds = max(hs, -min(t * g, 2 * t) - hs) / g, r = region(u, v); return smax(ds, r, k); }, o.aabb || [-1e3, -1e3, -1e3, 1e3, 1e3, 1e3], o);
}
// 2-D regions for heightSlab: a rounded box [u0, v0, u1, v1] and a polygon (the signed distance to a closed polyline)
export const regionBox = (u0, v0, u1, v1, r = 0) => (u, v) => { const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2, hu = (u1 - u0) / 2 - r, hv = (v1 - v0) / 2 - r, qu = abs(u - cu) - hu, qv = abs(v - cv) - hv; return sqrt(max(qu, 0) ** 2 + max(qv, 0) ** 2) + min(max(qu, qv), 0) - r; };
export function regionPoly(pts) { const n = pts.length; return (u, v) => { let d = Infinity, s = 1;
  for (let i = 0, j = n - 1; i < n; j = i++) { const [ax, ay] = pts[j], [bx, by] = pts[i], ex = bx - ax, ey = by - ay, wx = u - ax, wy = v - ay, t = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey || 1), 0, 1), dx = wx - ex * t, dy = wy - ey * t; d = min(d, dx * dx + dy * dy);
    const c1 = v >= ay, c2 = v < by, c3 = ex * wy > ey * wx; if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s; }
  return s * sqrt(d); }; }
