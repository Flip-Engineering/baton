// COLLIDE (CLOTHING c1): what a garment drapes ON. The posed body (and the garments already draped under this one) as triangle
// surfaces in the solver's frame, and a Contacts object the XPBD cloth (xpbd.js) calls every substep. Pure JS, no three.js.
//
//   skinPose(...)   CPU linear-blend skinning of a SkinnedMesh's bind positions with per-bone matrices M_b = G^-1 Bw_b Binv_b
//                   (G the mesh frame, Bw the bone's world matrix, Binv its inverse bind): the same sum three's applyBoneTransform
//                   does, unrolled on typed arrays so the 19k-vertex body poses in a few ms. boneMats() builds the M_b once per pose;
//                   blendInverse() is the per-vertex inverse (sum w M_b)^-1 drape.js uses to write a draped shape back to bind space.
//   SurfaceMesh     a triangle surface with area-weighted vertex normals, vertex -> triangle fans and a uniform hash of its vertices.
//                   closest() finds the nearest vertex in the hash, then the closest point over the triangle fans of that vertex and
//                   its 1-ring (Ericson, "Real-Time Collision Detection" 5.1.5, closest point on a triangle by Voronoi regions): for a
//                   body mesh with 1-2 cm triangles that is the true closest point in all but pathological spots, at ~30 triangle
//                   tests instead of a BVH walk. The sign is the barycentric blend of the vertex normals (an angle-weighted pseudo-
//                   normal is exact; the blend is enough for points within a few cm of a smooth body).
//   Contacts        per particle, up to one contact plane per surface (refresh: point c, normal n, the gap to hold, friction mu);
//                   project() pushes a particle that is closer than its gap back out along n and applies Coulomb friction to the
//                   substep's tangential motion (static when the tangential slip is under mu x the push, kinetic otherwise): the
//                   position-level friction of Mueller et al., "Position Based Dynamics" (2007), 3.5, as Macklin et al. use it in
//                   "Unified Particle Physics for Real-Time Applications" (2014), 6.1. Planes are re-found every few substeps
//                   (a draping garment moves millimetres between refreshes). A garment surface ignores contacts whose closest point is
//                   on its open boundary (a trouser leg passing under the hem of a shirt is not "inside" the shirt).
// Layers: drape.js builds one SurfaceMesh for the posed body (gap = a skin allowance + half the fabric's thickness) and one per
// garment already draped under this one (gap = half of each fabric's thickness + 1 mm), so a coat lies on the trousers that lie on
// the body. Units: whatever the caller's frame is (drape.js works in metres).

// ---------------------------------------------------------------- skinning
// bone matrices (column-major, three's Matrix4.elements) as a Float64Array(nb * 16): M_b = inv(meshWorld) x boneWorld_b x boneInverse_b
export function boneMats(skeleton, meshWorld, out = null) {
  const nb = skeleton.bones.length, M = out || new Float64Array(nb * 16), G = invert(meshWorld.elements), T = new Float64Array(16), U = new Float64Array(16);
  for (let b = 0; b < nb; b++) { mul(skeleton.bones[b].matrixWorld.elements, skeleton.boneInverses[b].elements, T); mul(G, T, U); M.set(U, b * 16); }
  return M;
}
// LBS: P (bind, n*3) with SI / SW (n*4) -> out (n*3) x scale
export function skinPose(P, SI, SW, M, out, scale = 1) {
  const n = P.length / 3;
  for (let v = 0; v < n; v++) { const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2]; let ox = 0, oy = 0, oz = 0, ws = 0;
    for (let k = 0; k < 4; k++) { const w = SW[v * 4 + k]; if (w === 0) continue; const m = SI[v * 4 + k] * 16; ws += w;
      ox += w * (M[m] * x + M[m + 4] * y + M[m + 8] * z + M[m + 12]); oy += w * (M[m + 1] * x + M[m + 5] * y + M[m + 9] * z + M[m + 13]); oz += w * (M[m + 2] * x + M[m + 6] * y + M[m + 10] * z + M[m + 14]); }
    if (ws > 0 && Math.abs(ws - 1) > 1e-6) { ox /= ws; oy /= ws; oz /= ws; }
    out[v * 3] = ox * scale; out[v * 3 + 1] = oy * scale; out[v * 3 + 2] = oz * scale; }
  return out;
}
// the blended matrix of one vertex (12 floats: the 3x4 affine part, column-major) and its inverse applied to a posed point
export function blendInverse(SI, SW, v, M, px, py, pz, out, o = 0) {
  const A = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; let ws = 0;
  for (let k = 0; k < 4; k++) { const w = SW[v * 4 + k]; if (w === 0) continue; const m = SI[v * 4 + k] * 16; ws += w;
    A[0] += w * M[m]; A[1] += w * M[m + 1]; A[2] += w * M[m + 2]; A[3] += w * M[m + 4]; A[4] += w * M[m + 5]; A[5] += w * M[m + 6];
    A[6] += w * M[m + 8]; A[7] += w * M[m + 9]; A[8] += w * M[m + 10]; A[9] += w * M[m + 12]; A[10] += w * M[m + 13]; A[11] += w * M[m + 14]; }
  if (ws > 0 && Math.abs(ws - 1) > 1e-6) for (let i = 0; i < 12; i++) A[i] /= ws;
  // solve [a0 a3 a6; a1 a4 a7; a2 a5 a8] b = p - t
  const bx = px - A[9], by = py - A[10], bz = pz - A[11];
  const c00 = A[4] * A[8] - A[7] * A[5], c01 = A[6] * A[5] - A[3] * A[8], c02 = A[3] * A[7] - A[6] * A[4];
  const det = A[0] * c00 + A[1] * c01 + A[2] * c02;
  if (Math.abs(det) < 1e-12) { out[o] = px; out[o + 1] = py; out[o + 2] = pz; return false; }
  const id = 1 / det;
  const i00 = c00 * id, i01 = c01 * id, i02 = c02 * id;
  const i10 = (A[7] * A[2] - A[1] * A[8]) * id, i11 = (A[0] * A[8] - A[6] * A[2]) * id, i12 = (A[6] * A[1] - A[0] * A[7]) * id;
  const i20 = (A[1] * A[5] - A[4] * A[2]) * id, i21 = (A[3] * A[2] - A[0] * A[5]) * id, i22 = (A[0] * A[4] - A[3] * A[1]) * id;
  out[o] = i00 * bx + i01 * by + i02 * bz; out[o + 1] = i10 * bx + i11 * by + i12 * bz; out[o + 2] = i20 * bx + i21 * by + i22 * bz;
  return true;
}
function mul(a, b, o) { for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o; }
function invert(m) {   // general 4x4 inverse (column-major), three's Matrix4.invert
  const n11 = m[0], n21 = m[1], n31 = m[2], n41 = m[3], n12 = m[4], n22 = m[5], n32 = m[6], n42 = m[7], n13 = m[8], n23 = m[9], n33 = m[10], n43 = m[11], n14 = m[12], n24 = m[13], n34 = m[14], n44 = m[15];
  const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44, t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44,
    t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44, t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;
  const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14, o = new Float64Array(16); if (det === 0) return o; const d = 1 / det;
  o[0] = t11 * d; o[1] = (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * d; o[2] = (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * d; o[3] = (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * d;
  o[4] = t12 * d; o[5] = (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * d; o[6] = (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * d; o[7] = (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * d;
  o[8] = t13 * d; o[9] = (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * d; o[10] = (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * d; o[11] = (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * d;
  o[12] = t14 * d; o[13] = (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * d; o[14] = (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * d; o[15] = (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * d;
  return o;
}

// ---------------------------------------------------------------- surfaces
// area-weighted vertex normals of a triangle mesh (winding gives the outside)
export function vertexNormals(X, tris, out = null) {
  const n = X.length / 3, N = out || new Float64Array(n * 3); N.fill(0);
  for (let t = 0; t < tris.length; t += 3) { const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    const ux = X[b * 3] - X[a * 3], uy = X[b * 3 + 1] - X[a * 3 + 1], uz = X[b * 3 + 2] - X[a * 3 + 2], vx = X[c * 3] - X[a * 3], vy = X[c * 3 + 1] - X[a * 3 + 1], vz = X[c * 3 + 2] - X[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { N[v * 3] += nx; N[v * 3 + 1] += ny; N[v * 3 + 2] += nz; } }
  for (let v = 0; v < n; v++) { const l = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) || 1; N[v * 3] /= l; N[v * 3 + 1] /= l; N[v * 3 + 2] /= l; }
  return N;
}

export class SurfaceMesh {
  // X: Float64Array n*3 (copied), tris: Int32Array (winding = outside), opts: { cell, normals (n*3, outward), boundary (true: flag open-edge vertices) }
  constructor(X, tris, { cell = 0.02, normals = null, boundary = false } = {}) {
    const n = X.length / 3; this.n = n; this.X = Float64Array.from(X); this.tris = tris; this.cell = cell;
    this.N = normals ? Float64Array.from(normals) : vertexNormals(this.X, tris);
    // vertex -> triangles (CSR) and vertex -> neighbours (CSR)
    const cnt = new Int32Array(n + 1); for (let t = 0; t < tris.length; t++) cnt[tris[t] + 1]++;
    for (let v = 0; v < n; v++) cnt[v + 1] += cnt[v]; const fan = new Int32Array(tris.length), fill = cnt.slice(0, n);
    for (let t = 0; t < tris.length; t += 3) for (let k = 0; k < 3; k++) fan[fill[tris[t + k]]++] = t / 3;
    this.fo = cnt; this.fan = fan;
    const nb = Array.from({ length: n }, () => new Set()); for (let t = 0; t < tris.length; t += 3) { const a = tris[t], b = tris[t + 1], c = tris[t + 2]; nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b); }
    const no = new Int32Array(n + 1); for (let v = 0; v < n; v++) no[v + 1] = no[v] + nb[v].size; const nbr = new Int32Array(no[n]); for (let v = 0; v < n; v++) { let i = no[v]; for (const u of nb[v]) nbr[i++] = u; }
    this.no = no; this.nbr = nbr;
    // open boundary: vertices on an edge used by one triangle
    this.bnd = null;
    if (boundary) { const E = new Map(); for (let t = 0; t < tris.length; t += 3) for (let k = 0; k < 3; k++) { const a = tris[t + k], b = tris[t + (k + 1) % 3], key = a < b ? a * n + b : b * n + a; E.set(key, (E.get(key) || 0) + 1); }
      this.bnd = new Uint8Array(n); for (const [key, c] of E) if (c === 1) { this.bnd[Math.floor(key / n)] = 1; this.bnd[key % n] = 1; } }
    // vertex hash: numeric keys on a cell lattice
    this.hash = new Map(); const ic = 1 / cell;
    for (let v = 0; v < n; v++) { const k = this._key(Math.floor(this.X[v * 3] * ic), Math.floor(this.X[v * 3 + 1] * ic), Math.floor(this.X[v * 3 + 2] * ic)); const L = this.hash.get(k); if (L) L.push(v); else this.hash.set(k, [v]); }
    this._q = { px: 0, py: 0, pz: 0, nx: 0, ny: 0, nz: 0, d: 0, tri: -1, edge: false };
  }
  _key(i, j, k) { return ((i + 4096) * 8192 + (j + 4096)) * 8192 + (k + 4096); }
  // CLOTHING c2 (K1): closest(), falling back to the nearest vertex that HAS triangles: the welded body keeps loose vertices, and when the
  // hash's nearest is one of them closest() has no fan to test and returns null (the particle then has no contact for that refresh)
  closestAny(x, y, z, rmax, hint = -1) { const q = this.closest(x, y, z, rmax, hint); if (q) return q; const v0 = this.lastV; if (v0 < 0 || this.fo[v0 + 1] > this.fo[v0]) return null; const ic = 1 / this.cell, r = Math.max(1, Math.ceil(rmax * ic)), ci = Math.floor(x * ic), cj = Math.floor(y * ic), ck = Math.floor(z * ic); let best = -1, bd = rmax * rmax;
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) { const L = this.hash.get(this._key(ci + a, cj + b, ck + c)); if (!L) continue; for (const v of L) { if (this.fo[v + 1] === this.fo[v]) continue; const d = (this.X[v * 3] - x) ** 2 + (this.X[v * 3 + 1] - y) ** 2 + (this.X[v * 3 + 2] - z) ** 2; if (d < bd) { bd = d; best = v; } } }
    return best < 0 ? null : this.closest(x, y, z, rmax, best); }
  // CLOTHING c2 (K1): new positions for the same triangles (normals recomputed with the same orientation; flip = -1 keeps an inverted
  // surface inverted), the hash rebuilt. For colliders that move between solves (a layer in a joint settle, a body in motion).
  refit(X, { flip = 1 } = {}) { this.X.set(X); vertexNormals(this.X, this.tris, this.N); if (flip < 0) for (let i = 0; i < this.N.length; i++) this.N[i] = -this.N[i];
    this.hash = new Map(); const ic = 1 / this.cell;
    for (let v = 0; v < this.n; v++) { const k = this._key(Math.floor(this.X[v * 3] * ic), Math.floor(this.X[v * 3 + 1] * ic), Math.floor(this.X[v * 3 + 2] * ic)); const L = this.hash.get(k); if (L) L.push(v); else this.hash.set(k, [v]); }
    return this; }
  nearestVertex(x, y, z, rmax) {
    const ic = 1 / this.cell, r = Math.max(1, Math.ceil(rmax * ic)), ci = Math.floor(x * ic), cj = Math.floor(y * ic), ck = Math.floor(z * ic), X = this.X;
    let best = -1, bd = rmax * rmax;
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) { const L = this.hash.get(this._key(ci + a, cj + b, ck + c)); if (!L) continue;
      for (let i = 0; i < L.length; i++) { const v = L[i], dx = X[v * 3] - x, dy = X[v * 3 + 1] - y, dz = X[v * 3 + 2] - z, d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = v; } } }
    return best;
  }
  // the closest surface point within rmax (null if none): { px, py, pz (point), nx, ny, nz (blended normal), d (signed distance), tri, edge (on an open boundary) }
  // walk from a hint vertex to a local minimum of the distance on the vertex graph (a particle moves millimetres between refreshes,
  // so the walk is a step or two; the hash is only needed for the first query)
  walk(x, y, z, v) { const X = this.X; let bd = (X[v * 3] - x) ** 2 + (X[v * 3 + 1] - y) ** 2 + (X[v * 3 + 2] - z) ** 2;
    for (let guard = 0; guard < 64; guard++) { let best = -1; for (let j = this.no[v]; j < this.no[v + 1]; j++) { const u = this.nbr[j], d = (X[u * 3] - x) ** 2 + (X[u * 3 + 1] - y) ** 2 + (X[u * 3 + 2] - z) ** 2; if (d < bd) { bd = d; best = u; } }
      if (best < 0) break; v = best; } return v; }
  closest(x, y, z, rmax, hint = -1) {
    const v0 = hint >= 0 ? this.walk(x, y, z, hint) : this.nearestVertex(x, y, z, rmax); this.lastV = v0; if (v0 < 0) return null;
    const X = this.X, T = this.tris, q = this._q; let bd = Infinity, bt = -1, bu = 0, bv = 0, bw = 0, bx = 0, by = 0, bz = 0;
    const test = t => { const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2]; const r = closestOnTri(x, y, z, X, a, b, c);
      const dx = r[0] - x, dy = r[1] - y, dz = r[2] - z, d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; bt = t; bx = r[0]; by = r[1]; bz = r[2]; bu = r[3]; bv = r[4]; bw = r[5]; } };
    for (let i = this.fo[v0]; i < this.fo[v0 + 1]; i++) test(this.fan[i]);
    for (let j = this.no[v0]; j < this.no[v0 + 1]; j++) { const u = this.nbr[j]; for (let i = this.fo[u]; i < this.fo[u + 1]; i++) test(this.fan[i]); }
    if (bt < 0 || bd > rmax * rmax) return null;
    const a = T[bt * 3], b = T[bt * 3 + 1], c = T[bt * 3 + 2], N = this.N;
    let nx = N[a * 3] * bu + N[b * 3] * bv + N[c * 3] * bw, ny = N[a * 3 + 1] * bu + N[b * 3 + 1] * bv + N[c * 3 + 1] * bw, nz = N[a * 3 + 2] * bu + N[b * 3 + 2] * bv + N[c * 3 + 2] * bw;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    q.px = bx; q.py = by; q.pz = bz; q.nx = nx; q.ny = ny; q.nz = nz; q.d = (x - bx) * nx + (y - by) * ny + (z - bz) * nz; q.tri = bt;
    q.edge = !!this.bnd && ((this.bnd[a] && bu > 0.34) || (this.bnd[b] && bv > 0.34) || (this.bnd[c] && bw > 0.34));
    return q;
  }
}
// closest point on triangle abc to p (Ericson 5.1.5): [x, y, z, u, v, w] (barycentrics of a, b, c)
const _r = [0, 0, 0, 0, 0, 0];
function setR(ax, ay, az, bx, by, bz, cx, cy, cz, u, v, w) { _r[0] = ax * u + bx * v + cx * w; _r[1] = ay * u + by * v + cy * w; _r[2] = az * u + bz * v + cz * w; _r[3] = u; _r[4] = v; _r[5] = w; return _r; }
function closestOnTri(px, py, pz, X, ia, ib, ic) {
  const ax = X[ia * 3], ay = X[ia * 3 + 1], az = X[ia * 3 + 2], bx = X[ib * 3], by = X[ib * 3 + 1], bz = X[ib * 3 + 2], cx = X[ic * 3], cy = X[ic * 3 + 1], cz = X[ic * 3 + 2];
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az, apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return setR(ax, ay, az, bx, by, bz, cx, cy, cz, 1, 0, 0);
  const bpx = px - bx, bpy = py - by, bpz = pz - bz, d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return setR(ax, ay, az, bx, by, bz, cx, cy, cz, 0, 1, 0);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return setR(ax, ay, az, bx, by, bz, cx, cy, cz, 1 - v, v, 0); }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz, d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return setR(ax, ay, az, bx, by, bz, cx, cy, cz, 0, 0, 1);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return setR(ax, ay, az, bx, by, bz, cx, cy, cz, 1 - w, 0, w); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return setR(ax, ay, az, bx, by, bz, cx, cy, cz, 0, 1 - w, w); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; return setR(ax, ay, az, bx, by, bz, cx, cy, cz, 1 - v - w, v, w);
}

// CLOTHING c2 (K1): a rigid accessory (a boot, a glove, a belt, a hard hat) as a collider with OUTWARD normals. hero.js's c7 boots are
// wound inward (signed volume about -900 cm3 per piece), so a SurfaceMesh made from their winding pushed the trouser hem INTO the boot
// (c1's buried boots: the hem ring 1.7-4.7 mm inside the boot, 5-9 cm below where it was cut). Each connected piece is flipped when its
// signed volume (about its own centroid) is negative. X: posed positions (n*3), tris: Int32Array.
export function rigidSurface(X, tris, { cell = 0.03 } = {}) {
  const n = X.length / 3, T = Int32Array.from(tris), comp = new Int32Array(n).fill(-1), adj = Array.from({ length: n }, () => []);
  for (let t = 0; t < T.length; t += 3) for (let k = 0; k < 3; k++) { const a = T[t + k], b = T[t + (k + 1) % 3]; adj[a].push(b); adj[b].push(a); }
  let nc = 0; for (let v = 0; v < n; v++) { if (comp[v] >= 0 || !adj[v].length) continue; const st = [v]; comp[v] = nc; while (st.length) { const u = st.pop(); for (const w of adj[u]) if (comp[w] < 0) { comp[w] = nc; st.push(w); } } nc++; }
  const cen = new Float64Array(nc * 4); for (let v = 0; v < n; v++) { const c = comp[v]; if (c < 0) continue; cen[c * 4] += X[v * 3]; cen[c * 4 + 1] += X[v * 3 + 1]; cen[c * 4 + 2] += X[v * 3 + 2]; cen[c * 4 + 3]++; }
  const vol = new Float64Array(nc);
  for (let t = 0; t < T.length; t += 3) { const a = T[t], b = T[t + 1], d = T[t + 2], c = comp[a], k = cen[c * 4 + 3] || 1, cx = cen[c * 4] / k, cy = cen[c * 4 + 1] / k, cz = cen[c * 4 + 2] / k;
    const ax = X[a * 3] - cx, ay = X[a * 3 + 1] - cy, az = X[a * 3 + 2] - cz, bx = X[b * 3] - cx, by = X[b * 3 + 1] - cy, bz = X[b * 3 + 2] - cz, dx = X[d * 3] - cx, dy = X[d * 3 + 1] - cy, dz = X[d * 3 + 2] - cz;
    vol[c] += ax * (by * dz - bz * dy) - ay * (bx * dz - bz * dx) + az * (bx * dy - by * dx); }
  let flipped = 0; for (let t = 0; t < T.length; t += 3) if (vol[comp[T[t]]] < 0) { const b = T[t + 1]; T[t + 1] = T[t + 2]; T[t + 2] = b; flipped++; }
  const S = new SurfaceMesh(X, T, { cell }); S.pieces = nc; S.flipped = flipped; S.volume = Array.from(vol, v => Math.abs(v) / 6); return S;
}

// ---------------------------------------------------------------- contacts
// surfaces: [{ mesh: SurfaceMesh, gap: number | Float64Array(n) (per particle), mu, reach, garment (true: skip open-boundary hits), mask (Uint8Array n:
//            only these particles see this surface; a ceiling, a layer OVER the cloth given with inward normals, must only hold what is under it) }]
export class Contacts {
  constructor(n, surfaces, { reach = 0.04, safe = false } = {}) {   // safe (c2): closestAny instead of closest
    this.n = n; this.safe = safe; this.S = surfaces.map(s => ({ reach, mu: 0.4, ...s })); const k = this.S.length;
    this.hint = new Int32Array(n * k).fill(-1); this.C = new Float64Array(n * k * 3); this.Nn = new Float64Array(n * k * 3); this.G = new Float64Array(n * k); this.on = new Uint8Array(n * k); this.mu = new Float64Array(n * k);
    this.stats = { refresh: 0 };
    // CLOTHING c2 (K1, layers.js): a surface may carry soft: { gap: number | Float64Array(n), alpha (m/N per particle) }: between the
    // hard gap and soft.gap the particle is pushed out compliantly (XPBD), the loft of the layers between them compressing under it
    this.soft = this.S.some(s => s.soft) ? { G: new Float64Array(n * k), Al: new Float64Array(n * k) } : null;
  }
  refresh(X) {
    const n = this.n, k = this.S.length; if (this.stats.refresh % 8 === 7) this.hint.fill(-1);   // re-seed from the hash now and then (a walk can stop in a local minimum)
    for (let s = 0; s < k; s++) { const S = this.S[s], gap = S.gap;
      for (let i = 0; i < n; i++) { const j = i * k + s; if (S.mask && !S.mask[i]) { this.on[j] = 0; continue; } const q = this.safe ? S.mesh.closestAny(X[i * 3], X[i * 3 + 1], X[i * 3 + 2], S.reach, this.hint[j]) : S.mesh.closest(X[i * 3], X[i * 3 + 1], X[i * 3 + 2], S.reach, this.hint[j]);
        this.hint[j] = S.mesh.lastV;
        if (!q || (S.garment && q.edge)) { this.on[j] = 0; continue; }
        this.on[j] = 1; this.C[j * 3] = q.px; this.C[j * 3 + 1] = q.py; this.C[j * 3 + 2] = q.pz; this.Nn[j * 3] = q.nx; this.Nn[j * 3 + 1] = q.ny; this.Nn[j * 3 + 2] = q.nz;
        this.G[j] = typeof gap === 'number' ? gap : gap[i]; this.mu[j] = S.mu;
        if (this.soft) { const sf = S.soft; this.soft.G[j] = sf ? (typeof sf.gap === 'number' ? sf.gap : sf.gap[i]) : 0; this.soft.Al[j] = sf ? (typeof sf.alpha === 'number' ? sf.alpha : sf.alpha[i]) : 0; } } }
    this.stats.refresh++;
  }
  // push X out of every contact plane closer than its gap; friction on the motion since P (h = 0: no friction)
  project(X, P, W, h) {
    const n = this.n, k = this.S.length, C = this.C, Nn = this.Nn, G = this.G, on = this.on, MU = this.mu;
    for (let i = 0; i < n; i++) { if (W[i] === 0) continue; const i3 = i * 3;
      for (let s = 0; s < k; s++) { const j = i * k + s; if (!on[j]) continue; const nx = Nn[j * 3], ny = Nn[j * 3 + 1], nz = Nn[j * 3 + 2];
        const d = (X[i3] - C[j * 3]) * nx + (X[i3 + 1] - C[j * 3 + 1]) * ny + (X[i3 + 2] - C[j * 3 + 2]) * nz - G[j];
        if (d >= 0) { if (this.soft && h > 0) { const sg = this.soft.G[j] - G[j]; if (sg > 0 && d < sg) { const k = (sg - d) * W[i] / (W[i] + this.soft.Al[j] / (h * h)); X[i3] += nx * k; X[i3 + 1] += ny * k; X[i3 + 2] += nz * k; } } continue; }
        X[i3] -= nx * d; X[i3 + 1] -= ny * d; X[i3 + 2] -= nz * d;
        if (h > 0 && MU[j] > 0) { let tx = X[i3] - P[i3], ty = X[i3 + 1] - P[i3 + 1], tz = X[i3 + 2] - P[i3 + 2]; const dn = tx * nx + ty * ny + tz * nz; tx -= nx * dn; ty -= ny * dn; tz -= nz * dn;
          const tl = Math.sqrt(tx * tx + ty * ty + tz * tz), lim = MU[j] * -d; if (tl < 1e-12) continue;
          const f = tl <= lim ? 1 : lim / tl; X[i3] -= tx * f; X[i3 + 1] -= ty * f; X[i3 + 2] -= tz * f; } } }
  }
  // signed distances of X to surface s (skip: particles to leave out): { min, mean of those within `near`, count, inside } (for reports)
  measure(X, s = 0, near = 0.05, skip = null) {
    const S = this.S[s], n = this.n; let mn = Infinity, sum = 0, cnt = 0, pen = 0;
    for (let i = 0; i < n; i++) { if (skip && skip[i]) continue; const q = S.mesh.closest(X[i * 3], X[i * 3 + 1], X[i * 3 + 2], near); if (!q || (S.garment && q.edge)) continue; mn = Math.min(mn, q.d); if (q.d < 0) pen++; sum += q.d; cnt++; }
    return { min: cnt ? mn : 0, mean: cnt ? sum / cnt : 0, count: cnt, inside: pen };
  }
}
