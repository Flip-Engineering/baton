// DRAPE REFINE (CLOTHINT, round 7, 8 Oct 2026): the render-time refinement of a SETTLED sheet. A function of the settled positions, never fed back into the simulation, so determinism and
// resume are untouched.
//
// The sim's grid is 2-2.3 cm; drawn as it is the sheet is faceted and its triangles are chords that cut through whatever the cloth lies on. The sheet is refined `sub` times by Catmull-Rom
// interpolation (a smooth surface through the same vertices; the result is again a regular grid, nx*sub x nz*sub, so gridGeometry / attachFabric / the fabric shader take it unchanged), then
// kept out of every solid it lies on, because a cubic through vertices that were a few mm off a ridge (a toe, the nose, a table's edge) overshoots into it:
//   * the SKIN (`body`: a SurfaceMesh, colliders.js peopleMesh(P, { parts: true }).mesh, the skin lifted to the underwear): pushed out along the surface normal to `clearance` (3 mm);
//   * the UNDERWEAR's vertices (`points`: peopleMesh parts' points): held `pointClearance` above each, so no triangle that spans a garment vertex passes under it;
//   * a BOX (`boxes`, main's `{ s: 'box', min, max }`: a table slab) in two stages: a vertex inside the box grown by `boxClearance` is pushed out through the nearest top or side face, exactly as the
//     solver's box contact does; then every TRIANGLE (sampled on a barycentric lattice) is checked against the box itself, and the triangle's three vertices are pushed out along the box's own
//     normal at the deepest sample until none of its points is within `triClearance` (1 mm: a cloth's thickness) of the steel. The second stage is the one that matters at an edge: two vertices
//     that are each `boxClearance` clear of the slab can span a chord that cuts the slab's convex edge (the plates' black slits on every hang view, 468 triangles up to 4.6 mm after the vertex
//     stage alone).
//
//   const R = refineSheet(cl.p, cl.nx, cl.nz, cl.w, cl.l, { sub: 3, body: col.mesh, points: col.points, boxes: [tableBox] });   // R = { nx, nz, p: Float32Array, stats }
//   const g = gridGeometry(R.nx, R.nz); g.attributes.position.array.set(R.p); g.computeVertexNormals();
// Units: metres. Pure JS, typed arrays.
export const REFINE_VERSION = 1;

// Catmull-Rom interpolation of the settled positions p (Float32Array / Float64Array (nx+1)(nz+1)*3, id = j*(nx+1)+i) on a sub-times finer regular grid
export function subdivide(p, nx, nz, sub) {
  const NX = nx * sub, NZ = nz * sub, out = new Float64Array((NX + 1) * (NZ + 1) * 3), wt = new Float64Array(sub * 4), cl = (v, m) => (v < 0 ? 0 : v > m ? m : v), col = new Float64Array((nx + 1) * 3);
  for (let a = 0; a < sub; a++) { const t = a / sub, t2 = t * t, t3 = t2 * t; wt[a * 4] = -0.5 * t3 + t2 - 0.5 * t; wt[a * 4 + 1] = 1.5 * t3 - 2.5 * t2 + 1; wt[a * 4 + 2] = -1.5 * t3 + 2 * t2 + 0.5 * t; wt[a * 4 + 3] = 0.5 * t3 - 0.5 * t2; }
  for (let J = 0; J <= NZ; J++) {   // along z first, for every column of the coarse grid, then along x
    const j = J === NZ ? nz : Math.floor(J / sub), b = J === NZ ? 0 : J - j * sub;
    for (let i = 0; i <= nx; i++) for (let c = 0; c < 3; c++) { let s = 0; for (let k = 0; k < 4; k++) s += wt[b * 4 + k] * p[(cl(j - 1 + k, nz) * (nx + 1) + i) * 3 + c]; col[i * 3 + c] = s; }
    for (let I = 0; I <= NX; I++) { const i = I === NX ? nx : Math.floor(I / sub), a = I === NX ? 0 : I - i * sub, o = (J * (NX + 1) + I) * 3;
      for (let c = 0; c < 3; c++) { let s = 0; for (let k = 0; k < 4; k++) s += wt[a * 4 + k] * col[cl(i - 1 + k, nx) * 3 + c]; out[o + c] = s; } } }
  return out;
}
// A cubic through the settled vertices overshoots toward the body where the cloth leaves a ridge (a toe, the nose): about 1 % of the fine vertices of a sheet on a person end up under the skin (up to 8 mm
// on the mesh sheet). `body` (a SurfaceMesh, e.g. peopleMesh(P).mesh) pushes those out along the surface normal to `clearance` (default 3 mm): only the vertices whose closest surface point is within 2 cm
// (farther, a blended-normal plane reads a sheet bridging a breast as 'behind' it: a sign artefact).
function clearBody(out, S, clearance, stats) {
  if (!S._bb) { const X = S.X; let b = [1e9, -1e9, 1e9, -1e9, 1e9, -1e9]; for (let v = 0; v < X.length; v += 3) for (let c = 0; c < 3; c++) { b[c * 2] = Math.min(b[c * 2], X[v + c]); b[c * 2 + 1] = Math.max(b[c * 2 + 1], X[v + c]); } S._bb = b; }
  const b = S._bb, m = 0.04; let pushed = 0, mx = 0;
  for (let k = 0; k < out.length; k += 3) { const x = out[k], y = out[k + 1], z = out[k + 2]; if (x < b[0] - m || x > b[1] + m || y < b[2] - m || y > b[3] + m || z < b[4] - m || z > b[5] + m) continue;
    const q = S.closestAny(x, y, z, 0.03, -1); if (!q || Math.hypot(x - q.px, y - q.py, z - q.pz) >= 0.02 || q.d >= clearance) continue;
    const d = clearance - q.d; out[k] += q.nx * d; out[k + 1] += q.ny * d; out[k + 2] += q.nz * d; pushed++; mx = Math.max(mx, d); }
  stats.clearedBody = pushed; stats.maxClearMm = +(mx * 1000).toFixed(1);
}
// RUN c4: points (Float64Array, x y z nx ny nz per obstacle: colliders.js peopleMesh(P, { parts: true }).points, the vertices of the underwear standing on the skin and the skin's outward normal there). The
// lifted skin covers a garment that lies on it to ~0.4 mm (p95); a refined vertex within `pointR` (9 mm: a fine cell's diagonal) of an obstacle point, sideways, is held `pointClearance` (2.5 mm) above it along the
// normal, so no triangle that spans a garment vertex can pass under it (the pokeThrough ruler's gate). Obstacle points that bridge a hollow (a bra's gore) are held too.
function clearPoints(out, pts, clearance, R, stats, depth = 0.004) {
  const n = pts.length / 6, cell = R, ic = 1 / cell, key = (i, j, k) => ((i + 4096) * 8192 + (j + 4096)) * 8192 + (k + 4096), H = new Map(); let pushed = 0, mx = 0;
  for (let i = 0; i < n; i++) { const kk = key(Math.floor(pts[i * 6] * ic), Math.floor(pts[i * 6 + 1] * ic), Math.floor(pts[i * 6 + 2] * ic)), L = H.get(kk); if (L) L.push(i); else H.set(kk, [i]); }
  const R2 = R * R;
  for (let k = 0; k < out.length; k += 3) { const x = out[k], y = out[k + 1], z = out[k + 2], ci = Math.floor(x * ic), cj = Math.floor(y * ic), ck = Math.floor(z * ic); let need = 0, nx = 0, ny = 0, nz = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) { const L = H.get(key(ci + a, cj + b, ck + c)); if (!L) continue;
      for (let m = 0; m < L.length; m++) { const o = L[m] * 6, dx = x - pts[o], dy = y - pts[o + 1], dz = z - pts[o + 2], h = dx * pts[o + 3] + dy * pts[o + 4] + dz * pts[o + 5], lat2 = dx * dx + dy * dy + dz * dz - h * h; if (lat2 > R2 || h > clearance || h < -depth) continue; const d = clearance - h; if (d > need) { need = d; nx = pts[o + 3]; ny = pts[o + 4]; nz = pts[o + 5]; } } }
    if (need > 0) { out[k] += nx * need; out[k + 1] += ny * need; out[k + 2] += nz * need; pushed++; if (need > mx) mx = need; } }
  stats.clearedPoints = pushed; stats.maxPointPushMm = +(mx * 1000).toFixed(1);
}
// BOXES (main's collider format { s: 'box', min, max }: a table slab). Stage 1, by vertex: a refined vertex inside the box grown by `clearance` is pushed out through the nearest top or side face (never the bottom: a
// cloth does not get under a table top), exactly as the solver's box contact does. Stage 2, by triangle: the lattice samples of every triangle near the box are tested against the box itself; a sample within
// `triClearance` of it moves its three vertices out along the box's normal there (outside the box: from the closest point on it; inside: through the nearest top or side face), by what the deepest sample needs,
// until a pass finds none (at most `passes`). The refined grid is regular (the winding of gridGeometry: tris (a, c, b), (b, c, d) for a = id(i, j), b = id(i+1, j), c = id(i, j+1), d = id(i+1, j+1)).
function clearBoxes(out, NX, NZ, boxes, clearance, triClearance, stats, passes = 12, lat = 6, byTriangle = true) {
  let pushed = 0, mx = 0, triPushed = 0, triMax = 0, iters = 0;
  for (const B of boxes) { if (!B || B.s !== 'box') continue; const rr = B.round > 0 ? B.round : 0;   // a box with `round` r (the solid's own edge radius, as drape_sheet.js's box contact): the inner box grown by r
    const m0 = rr ? B.min.map(v => v + rr) : B.min, m1 = rr ? B.max.map(v => v - rr) : B.max, c = clearance + rr;
    const eC = clearance + rr;   // stage 2's clearance from the inner box
    for (let k = 0; k < out.length; k += 3) { const x = out[k], y = out[k + 1], z = out[k + 2];
      if (x < m0[0] - c || x > m1[0] + c || y < m0[1] - c || y > m1[1] + c || z < m0[2] - c || z > m1[2] + c) continue;
      if (rr && (x < m0[0] || x > m1[0] || y < m0[1] || y > m1[1] || z < m0[2] || z > m1[2])) {   // outside the inner box: the rounded offset, along the true normal
        const qx = Math.min(m1[0], Math.max(m0[0], x)), qy = Math.min(m1[1], Math.max(m0[1], y)), qz = Math.min(m1[2], Math.max(m0[2], z)), ux = x - qx, uy = y - qy, uz = z - qz, d = Math.hypot(ux, uy, uz);
        if (d < c && d > 1e-9) { const bp = c - d; out[k] += ux / d * bp; out[k + 1] += uy / d * bp; out[k + 2] += uz / d * bp; pushed++; if (bp > mx) mx = bp; }
        continue; }
      let bp = m1[1] + c - y, dx = 0, dy = 1, dz = 0, t;
      t = x - (m0[0] - c); if (t < bp) { bp = t; dx = -1; dy = 0; dz = 0; } t = m1[0] + c - x; if (t < bp) { bp = t; dx = 1; dy = 0; dz = 0; }
      t = z - (m0[2] - c); if (t < bp) { bp = t; dx = 0; dy = 0; dz = -1; } t = m1[2] + c - z; if (t < bp) { bp = t; dx = 0; dy = 0; dz = 1; }
      if (!(bp > 0)) continue; out[k] += dx * bp; out[k + 1] += dy * bp; out[k + 2] += dz * bp; pushed++; if (bp > mx) mx = bp; }
    if (!byTriangle) continue;
    // stage 2: the triangles near the box. The cell index of each triangle; its samples against the box; the push on its three vertices
    const e = triClearance + rr, id = (i, j) => j * (NX + 1) + i, mn = [m0[0] - e, m0[1] - e, m0[2] - e], mxb = [m1[0] + e, m1[1] + e, m1[2] + e], W = [];
    for (let a = 0; a <= lat; a++) for (let b = 0; a + b <= lat; b++) W.push([a / lat, b / lat, 1 - a / lat - b / lat]);
    const one = (A, Bv, Cv, push) => {   // returns the deepest need (m) of this triangle's samples; push = [dx, dy, dz] of the deepest
      let need = 0;
      for (const w of W) { const x = out[A] * w[0] + out[Bv] * w[1] + out[Cv] * w[2], y = out[A + 1] * w[0] + out[Bv + 1] * w[1] + out[Cv + 1] * w[2], z = out[A + 2] * w[0] + out[Bv + 2] * w[1] + out[Cv + 2] * w[2];
        if (x < mn[0] || x > mxb[0] || y < mn[1] || y > mxb[1] || z < mn[2] || z > mxb[2]) continue;
        const qx = Math.min(m1[0], Math.max(m0[0], x)), qy = Math.min(m1[1], Math.max(m0[1], y)), qz = Math.min(m1[2], Math.max(m0[2], z)), ux = x - qx, uy = y - qy, uz = z - qz, d = Math.hypot(ux, uy, uz);
        let n, nx, ny, nz;
        if (d > 1e-9) { n = e - d; nx = ux / d; ny = uy / d; nz = uz / d; }
        else { let bp = m1[1] - y, bx = 0, by = 1, bz = 0, t;   // inside the box: out through the nearest top or side face
          t = x - m0[0]; if (t < bp) { bp = t; bx = -1; by = 0; bz = 0; } t = m1[0] - x; if (t < bp) { bp = t; bx = 1; by = 0; bz = 0; }
          t = z - m0[2]; if (t < bp) { bp = t; bx = 0; by = 0; bz = -1; } t = m1[2] - z; if (t < bp) { bp = t; bx = 0; by = 0; bz = 1; }
          n = bp + e; nx = bx; ny = by; nz = bz; }
        if (n > need) { need = n; push[0] = nx; push[1] = ny; push[2] = nz; } }
      return need; };
    const pv = [0, 0, 0];
    for (let pass = 0; pass < passes; pass++) { let any = 0; iters = pass + 1;
      for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const a = id(i, j) * 3, b = id(i + 1, j) * 3, cc = id(i, j + 1) * 3, dd = id(i + 1, j + 1) * 3;
        for (const T of [[a, cc, b], [b, cc, dd]]) {
          const lo = Math.min(out[T[0] + 1], out[T[1] + 1], out[T[2] + 1]); if (lo > mxb[1]) continue;   // a cheap early out: the triangle is above the box
          const x0 = Math.min(out[T[0]], out[T[1]], out[T[2]]), x1 = Math.max(out[T[0]], out[T[1]], out[T[2]]); if (x1 < mn[0] || x0 > mxb[0]) continue;
          const z0 = Math.min(out[T[0] + 2], out[T[1] + 2], out[T[2] + 2]), z1 = Math.max(out[T[0] + 2], out[T[1] + 2], out[T[2] + 2]); if (z1 < mn[2] || z0 > mxb[2]) continue;
          const hi = Math.max(out[T[0] + 1], out[T[1] + 1], out[T[2] + 1]); if (hi < mn[1]) continue;
          const need = one(T[0], T[1], T[2], pv); if (!(need > 1e-5)) continue; any++; triPushed++; if (need > triMax) triMax = need;
          for (const v of T) { out[v] += pv[0] * need; out[v + 1] += pv[1] * need; out[v + 2] += pv[2] * need; } } }
      if (!any) break; } }
  stats.clearedBoxes = pushed; stats.maxBoxPushMm = +(mx * 1000).toFixed(1); stats.boxTriPushes = triPushed; stats.maxBoxTriPushMm = +(triMax * 1000).toFixed(2); stats.boxTriPasses = iters;
}
// opts: sub (3); body (SurfaceMesh) + clearance (m, 0.003): keep the refined sheet out of the skin; points (Float64Array x y z nx ny nz) + pointClearance (2.5 mm) + pointR (9 mm) + pointDepth (4 mm): and above the K3
// underwear's vertices; boxes ([{ s: 'box', min, max }]) + boxClearance (m, default clearance) + triClearance (m, 0.001) + boxTriangles (false = the vertex stage alone: for a before | after): and out of the table (BOXES above).
export function refineSheet(p, nx, nz, w, l, o = {}) {
  const sub = o.sub ?? 3, NX = nx * sub, NZ = nz * sub, P = subdivide(p, nx, nz, sub), out = Float32Array.from(P), stats = { v: REFINE_VERSION, sub, nx: NX, nz: NZ };
  if (o.body) clearBody(out, o.body, o.clearance ?? 0.003, stats);
  if (o.points) clearPoints(out, o.points, o.pointClearance ?? 0.0025, o.pointR ?? 0.009, stats, o.pointDepth ?? 0.004);
  if (o.boxes) clearBoxes(out, NX, NZ, o.boxes, o.boxClearance ?? o.clearance ?? 0.003, o.triClearance ?? 0.001, stats, 12, 6, o.boxTriangles !== false);
  return { nx: NX, nz: NZ, p: out, stats };
}
