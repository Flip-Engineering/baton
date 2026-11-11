// ANATOMY / TISSUE9 / GRID (TISSUE9-LIMB, round 8, 16 Oct 2026; DESIGN: review/studio_human_c8/after/tissue9_limb/DESIGN.md): the region's voxel
// grid and the field tools the growth (grow.js), the skin extraction and the sections share. World frame: metres, the person's bind space (x lateral,
// L = +x; y up, ground 0; z forward). A grid is axis-aligned: { o: [x0, y0, z0] (the centre of voxel 0), h, nx, ny, nz, n }; voxel v = i + nx (j + ny k).
import { sdPart } from '../skeleton/sdf.js';

export function makeGrid(box, h) {
  const [x0, y0, z0, x1, y1, z1] = box, nx = Math.ceil((x1 - x0) / h) + 1, ny = Math.ceil((y1 - y0) / h) + 1, nz = Math.ceil((z1 - z0) / h) + 1;
  const G = { o: [x0, y0, z0], h, nx, ny, nz, n: nx * ny * nz };
  G.at = (i, j, k) => i + nx * (j + ny * k);
  G.pos = (v, out = [0, 0, 0]) => { const i = v % nx, j = Math.floor(v / nx) % ny, k = Math.floor(v / (nx * ny)); out[0] = x0 + i * h; out[1] = y0 + j * h; out[2] = z0 + k * h; return out; };
  G.ijk = v => [v % nx, Math.floor(v / nx) % ny, Math.floor(v / (nx * ny))];
  G.cell = p => [Math.round((p[0] - x0) / h), Math.round((p[1] - y0) / h), Math.round((p[2] - z0) / h)];
  G.inside = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz;
  return G;
}

// a normalised 1-D Gaussian (sigma in voxels), radius ceil(3 sigma)
export function gauss1(sigma) { const r = Math.max(1, Math.ceil(3 * sigma)), w = new Float32Array(2 * r + 1); let s = 0;
  for (let i = -r; i <= r; i++) { w[i + r] = Math.exp(-0.5 * i * i / (sigma * sigma)); s += w[i + r]; } for (let i = 0; i < w.length; i++) w[i] /= s; return { r, w }; }
// separable Gaussian of a box array A (dims [a, b, c], x fastest), in place; zero outside the box (the box is padded by the caller)
const _tmp = { a: new Float32Array(0) };
export function blurBox(A, dims, K) {
  const [a, b, c] = dims, { r, w } = K, m = Math.max(a, b, c);
  if (_tmp.a.length < m) _tmp.a = new Float32Array(m * 2);
  const T = _tmp.a;
  // x
  for (let k = 0; k < c; k++) for (let j = 0; j < b; j++) { const o = a * (j + b * k);
    for (let i = 0; i < a; i++) T[i] = A[o + i];
    for (let i = 0; i < a; i++) { let s = 0; const lo = Math.max(0, i - r), hi = Math.min(a - 1, i + r); for (let q = lo; q <= hi; q++) s += T[q] * w[q - i + r]; A[o + i] = s; } }
  // y
  for (let k = 0; k < c; k++) for (let i = 0; i < a; i++) { const o = i + a * b * k;
    for (let j = 0; j < b; j++) T[j] = A[o + a * j];
    for (let j = 0; j < b; j++) { let s = 0; const lo = Math.max(0, j - r), hi = Math.min(b - 1, j + r); for (let q = lo; q <= hi; q++) s += T[q] * w[q - j + r]; A[o + a * j] = s; } }
  // z
  for (let j = 0; j < b; j++) for (let i = 0; i < a; i++) { const o = i + a * j, st = a * b;
    for (let k = 0; k < c; k++) T[k] = A[o + st * k];
    for (let k = 0; k < c; k++) { let s = 0; const lo = Math.max(0, k - r), hi = Math.min(c - 1, k + r); for (let q = lo; q <= hi; q++) s += T[q] * w[q - k + r]; A[o + st * k] = s; } }
  return A;
}

// the squared Euclidean distance transform (voxels^2) of a set (Felzenszwalb and Huttenlocher 2012), 3-D, separable
function edt1(f, n, d, v, z) { let k = 0; v[0] = 0; z[0] = -1e20; z[1] = 1e20;
  for (let q = 1; q < n; q++) { let s; do { const r = v[k]; s = ((f[q] + q * q) - (f[r] + r * r)) / (2 * q - 2 * r); if (s <= z[k]) k--; else break; } while (k >= 0); k++; v[k] = q; z[k] = s; z[k + 1] = 1e20; }
  k = 0; for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const r = v[k]; d[q] = (q - r) * (q - r) + f[r]; } }
export function edt3(inSet, nx, ny, nz) {
  const D = new Float32Array(nx * ny * nz), m = Math.max(nx, ny, nz), f = new Float64Array(m), d = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);
  for (let i = 0; i < D.length; i++) D[i] = inSet[i] ? 0 : 1e20;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) { const o = nx * (j + ny * k); for (let i = 0; i < nx; i++) f[i] = D[o + i]; edt1(f, nx, d, v, z); for (let i = 0; i < nx; i++) D[o + i] = d[i]; }
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { const o = i + nx * ny * k; for (let j = 0; j < ny; j++) f[j] = D[o + nx * j]; edt1(f, ny, d, v, z); for (let j = 0; j < ny; j++) D[o + nx * j] = d[j]; }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const o = i + nx * j, st = nx * ny; for (let k = 0; k < nz; k++) f[k] = D[o + st * k]; edt1(f, nz, d, v, z); for (let k = 0; k < nz; k++) D[o + st * k] = d[k]; }
  return D;
}

// the bones' signed distance on the grid (m), exact within `band` of a bone's box, +band elsewhere
export function partsField(G, parts, band = 0.02) {
  const F = new Float32Array(G.n).fill(band), { o: [x0, y0, z0], h, nx, ny, nz } = G;
  for (const P of parts) { const b = P.bb, i0 = Math.max(0, Math.floor((b[0] - band - x0) / h)), i1 = Math.min(nx - 1, Math.ceil((b[3] + band - x0) / h)), j0 = Math.max(0, Math.floor((b[1] - band - y0) / h)), j1 = Math.min(ny - 1, Math.ceil((b[4] + band - y0) / h));
    const k0 = Math.max(0, Math.floor((b[2] - band - z0) / h)), k1 = Math.min(nz - 1, Math.ceil((b[5] + band - z0) / h));
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const v = i + nx * (j + ny * k), d = sdPart(P, x0 + i * h, y0 + j * h, z0 + k * h, band); if (d < F[v]) F[v] = d; } }
  return F;
}

// the inside of a closed (or nearly closed) triangle mesh on the grid by ray parity along z (a column per (i, j)); keepTri(t) filters triangles
export function meshInside(G, pos, tri, keepTri = null) {
  const { o: [x0, y0, z0], h, nx, ny, nz } = G, cols = new Map();
  for (let t = 0; t < tri.length / 3; t++) { if (keepTri && !keepTri(t)) continue;
    const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2], ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2], bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2], cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
    const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - x0) / h)), i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - x0) / h)), j0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - y0) / h)), j1 = Math.min(ny - 1, Math.floor((Math.max(ay, by, cy) - y0) / h));
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(den) < 1e-14) continue;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const px = x0 + i * h, py = y0 + j * h, l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den, l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den, l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue; const z = l1 * az + l2 * bz + l3 * cz, key = i + nx * j; let L = cols.get(key); if (!L) cols.set(key, L = []); L.push(z); } }
  const In = new Uint8Array(G.n);
  for (const [key, L] of cols) { L.sort((p, q) => p - q); const i = key % nx, j = Math.floor(key / nx);
    // de-duplicate hits closer than a hair (a ray through a shared edge counts twice)
    const Z = []; for (const z of L) if (!Z.length || z - Z[Z.length - 1] > 1e-6) Z.push(z);
    for (let q = 0; q + 1 < Z.length; q += 2) { const k0 = Math.max(0, Math.ceil((Z[q] - z0) / h)), k1 = Math.min(nz - 1, Math.floor((Z[q + 1] - z0) / h)); for (let k = k0; k <= k1; k++) In[i + nx * (j + ny * k)] = 1; } }
  return In;
}

// trilinear sample of a grid field at a world point
export function sample(G, F, x, y, z) {
  const fx = (x - G.o[0]) / G.h, fy = (y - G.o[1]) / G.h, fz = (z - G.o[2]) / G.h, i = Math.max(0, Math.min(G.nx - 2, Math.floor(fx))), j = Math.max(0, Math.min(G.ny - 2, Math.floor(fy))), k = Math.max(0, Math.min(G.nz - 2, Math.floor(fz)));
  const tx = Math.max(0, Math.min(1, fx - i)), ty = Math.max(0, Math.min(1, fy - j)), tz = Math.max(0, Math.min(1, fz - k)), nx = G.nx, nxy = G.nx * G.ny, v = i + nx * j + nxy * k;
  const c00 = F[v] * (1 - tx) + F[v + 1] * tx, c10 = F[v + nx] * (1 - tx) + F[v + nx + 1] * tx, c01 = F[v + nxy] * (1 - tx) + F[v + nxy + 1] * tx, c11 = F[v + nxy + nx] * (1 - tx) + F[v + nxy + nx + 1] * tx;
  return (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
}
