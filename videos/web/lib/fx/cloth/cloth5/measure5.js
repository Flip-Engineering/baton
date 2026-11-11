// CLOTH5 rulers (pure JS, no three): what the eye reads as dark shards on a dressed bake, counted on the POSED cloth as it draws.
//   selfX     triangle pairs of one garment that pass through each other (no shared vertex after a positional weld; a segment of one
//             crosses the other's interior): cloth folded through itself (a sleeve at the elbow, a hem on a shoe)
//   inverted  triangles whose winding normal points INTO the body (dot with the nearest body normal of the same family < -0.5) away from
//             an opening: the cloth's inside turned to the camera (a fold turned over, or the far side of a crossing)
// Each count is split by where it is: elbow, armpit, collar (neck), waist, knee, hem (the lowest 22 cm of a leg), other.
// measureGarment(X, T, body, J, { arm }) -> { tris, selfPairs, selfTris, inverted, byRegion: { region: [selfTris, inverted] } }
//   X Float32Array posed (m), T index, body { X, N, region (Float32Array n: hero region id), hash() }, J joints { elbowL, elbowR, ... }
export function weldIds(X, q = 1e-5) {
  const n = X.length / 3, id = new Int32Array(n), m = new Map(); let k = 0;
  for (let i = 0; i < n; i++) { const key = Math.round(X[i * 3] / q) + ',' + Math.round(X[i * 3 + 1] / q) + ',' + Math.round(X[i * 3 + 2] / q); let j = m.get(key); if (j == null) { j = k++; m.set(key, j); } id[i] = j; }
  return id;
}
// segment p0-p1 against triangle a,b,c (Moller-Trumbore), strictly inside (eps), parameter in (0,1)
function segTri(X, p0, p1, a, b, c) {
  const ax = X[a * 3], ay = X[a * 3 + 1], az = X[a * 3 + 2], e1x = X[b * 3] - ax, e1y = X[b * 3 + 1] - ay, e1z = X[b * 3 + 2] - az, e2x = X[c * 3] - ax, e2y = X[c * 3 + 1] - ay, e2z = X[c * 3 + 2] - az;
  const ox = X[p0 * 3], oy = X[p0 * 3 + 1], oz = X[p0 * 3 + 2], dx = X[p1 * 3] - ox, dy = X[p1 * 3 + 1] - oy, dz = X[p1 * 3 + 2] - oz;
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-14) return false;
  const inv = 1 / det, tx = ox - ax, ty = oy - ay, tz = oz - az, u = (tx * px + ty * py + tz * pz) * inv; if (u <= 1e-6 || u >= 1 - 1e-6) return false;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (dx * qx + dy * qy + dz * qz) * inv; if (v <= 1e-6 || u + v >= 1 - 1e-6) return false;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv; return t > 1e-6 && t < 1 - 1e-6;
}
export function triTri(X, A, B) {
  for (let k = 0; k < 3; k++) { if (segTri(X, A[k], A[(k + 1) % 3], B[0], B[1], B[2])) return true; if (segTri(X, B[k], B[(k + 1) % 3], A[0], A[1], A[2])) return true; }
  return false;
}
// self-intersecting pairs of a triangle soup (X posed, T index), adjacency by welded vertex; returns { pairs, hit (Uint8Array per tri) }
export function selfIntersections(X, T, { cell = 0.02, wid = null, list = null } = {}) {
  const nt = T.length / 3, W = wid || weldIds(X), hit = new Uint8Array(nt), ic = 1 / cell, H = new Map(); let pairs = 0;
  const bb = new Float64Array(nt * 6);
  for (let t = 0; t < nt; t++) { let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let k = 0; k < 3; k++) { const v = T[t * 3 + k]; x0 = Math.min(x0, X[v * 3]); x1 = Math.max(x1, X[v * 3]); y0 = Math.min(y0, X[v * 3 + 1]); y1 = Math.max(y1, X[v * 3 + 1]); z0 = Math.min(z0, X[v * 3 + 2]); z1 = Math.max(z1, X[v * 3 + 2]); }
    bb.set([x0, y0, z0, x1, y1, z1], t * 6);
    for (let i = Math.floor(x0 * ic); i <= Math.floor(x1 * ic); i++) for (let j = Math.floor(y0 * ic); j <= Math.floor(y1 * ic); j++) for (let k = Math.floor(z0 * ic); k <= Math.floor(z1 * ic); k++) { const key = (i * 73856093) ^ (j * 19349663) ^ (k * 83492791); let L = H.get(key); if (!L) H.set(key, L = []); L.push(t); } }
  const seen = new Set(), A = [0, 0, 0], B = [0, 0, 0];
  for (const L of H.values()) for (let x = 0; x < L.length; x++) for (let y = x + 1; y < L.length; y++) { let s = L[x], u = L[y]; if (s > u) { const tmp = s; s = u; u = tmp; }
    if (bb[s * 6] > bb[u * 6 + 3] || bb[u * 6] > bb[s * 6 + 3] || bb[s * 6 + 1] > bb[u * 6 + 4] || bb[u * 6 + 1] > bb[s * 6 + 4] || bb[s * 6 + 2] > bb[u * 6 + 5] || bb[u * 6 + 2] > bb[s * 6 + 5]) continue;
    const ws = [W[T[s * 3]], W[T[s * 3 + 1]], W[T[s * 3 + 2]]], wu = [W[T[u * 3]], W[T[u * 3 + 1]], W[T[u * 3 + 2]]]; if (ws.some(a => wu.includes(a))) continue;
    const key = s * 1e6 + u; if (seen.has(key)) continue; seen.add(key);
    for (let k = 0; k < 3; k++) { A[k] = T[s * 3 + k]; B[k] = T[u * 3 + k]; }
    if (triTri(X, A, B)) { pairs++; hit[s] = 1; hit[u] = 1; if (list) list.push(s, u); } }
  return { pairs, hit };
}
// a body for the rulers: posed positions, vertex normals, region ids, a hash for the nearest vertex of a family
export function bodyOf(X, T, region, cell = 0.03) {
  const n = X.length / 3, N = new Float64Array(n * 3);
  for (let t = 0; t < T.length; t += 3) { const a = T[t], b = T[t + 1], c = T[t + 2], ux = X[b * 3] - X[a * 3], uy = X[b * 3 + 1] - X[a * 3 + 1], uz = X[b * 3 + 2] - X[a * 3 + 2], vx = X[c * 3] - X[a * 3], vy = X[c * 3 + 1] - X[a * 3 + 1], vz = X[c * 3 + 2] - X[a * 3 + 2], nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { N[v * 3] += nx; N[v * 3 + 1] += ny; N[v * 3 + 2] += nz; } }
  for (let v = 0; v < n; v++) { const l = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) || 1; N[v * 3] /= l; N[v * 3 + 1] /= l; N[v * 3 + 2] /= l; }
  const ic = 1 / cell, H = new Map(), key = (i, j, k) => (i * 73856093) ^ (j * 19349663) ^ (k * 83492791);
  for (let v = 0; v < n; v++) { const k = key(Math.floor(X[v * 3] * ic), Math.floor(X[v * 3 + 1] * ic), Math.floor(X[v * 3 + 2] * ic)); let L = H.get(k); if (!L) H.set(k, L = []); L.push(v); }
  const fam = r => (r >= 2.5 && r <= 5.5 ? 1 : 0);
  const nearest = (x, y, z, f = null, R = 3) => { let best = -1, bd = Infinity; const ci = Math.floor(x * ic), cj = Math.floor(y * ic), ck = Math.floor(z * ic);
    for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) for (let c = -R; c <= R; c++) { const L = H.get(key(ci + a, cj + b, ck + c)); if (!L) continue; for (const v of L) { if (f != null && fam(region[v]) !== f) continue; const d = (X[v * 3] - x) ** 2 + (X[v * 3 + 1] - y) ** 2 + (X[v * 3 + 2] - z) ** 2; if (d < bd) { bd = d; best = v; } } }
    return best < 0 ? null : { v: best, d: Math.sqrt(bd) }; };
  return { X, N, region, nearest, fam };
}
// joints J: { elbowL, elbowR, shoulderL, shoulderR, neck, kneeL, kneeR, waistY, floorY } (posed, m)
export function regionOf(c, J) {
  const d = (p) => Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]);
  if (Math.min(d(J.elbowL), d(J.elbowR)) < 0.11) return 'elbow';
  if (Math.min(d(J.armpitL), d(J.armpitR)) < 0.09) return 'armpit';
  if (d(J.neck) < 0.13 && c[1] > J.neck[1] - 0.08) return 'collar';
  if (c[1] < J.floorY + 0.22) return 'hem';
  if (Math.min(d(J.kneeL), d(J.kneeR)) < 0.10) return 'knee';
  if (Math.abs(c[1] - J.waistY) < 0.06) return 'waist';
  if (Math.min(d(J.wristL), d(J.wristR)) < 0.08) return 'cuff';
  return 'other';
}
export function measureGarment(X, T, body, J, { openD = null } = {}) {
  const nt = T.length / 3, si = selfIntersections(X, T), by = {}, add = (r, k) => { (by[r] ||= [0, 0])[k]++; }; let inv = 0;
  for (let t = 0; t < nt; t++) { const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2], cx = (X[a * 3] + X[b * 3] + X[c * 3]) / 3, cy = (X[a * 3 + 1] + X[b * 3 + 1] + X[c * 3 + 1]) / 3, cz = (X[a * 3 + 2] + X[b * 3 + 2] + X[c * 3 + 2]) / 3;
    const ux = X[b * 3] - X[a * 3], uy = X[b * 3 + 1] - X[a * 3 + 1], uz = X[b * 3 + 2] - X[a * 3 + 2], vx = X[c * 3] - X[a * 3], vy = X[c * 3 + 1] - X[a * 3 + 1], vz = X[c * 3 + 2] - X[a * 3 + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz); if (l < 1e-12) continue; nx /= l; ny /= l; nz /= l;
    const r = regionOf([cx, cy, cz], J); if (si.hit[t]) add(r, 0);
    if (openD && Math.min(openD[a], openD[b], openD[c]) < 0.06) continue;   // near an opening the inside is meant to show
    const q = body.nearest(cx, cy, cz); if (!q || q.d > 0.12) continue; const v = q.v;
    if (nx * body.N[v * 3] + ny * body.N[v * 3 + 1] + nz * body.N[v * 3 + 2] < -0.5) { inv++; add(r, 1); } }
  let st = 0; for (const h of si.hit) st += h;
  return { tris: nt, selfPairs: si.pairs, selfTris: st, inverted: inv, byRegion: by };
}
