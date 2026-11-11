// CLOTH9 c3 it2 (8 Oct): THE SHOE AS A CLOSED SOLID for the cloth that falls on it. A shoe is modelled as its parts (upper, sole,
// tongue, laces as 3 mm tubes, eyelets): open shells with gaps between them and an open mouth round the leg. As colliders each part
// pushes cloth off its own surface, so a trouser hem can slip between two lace tubes, between the laces and the tongue, or down into the
// boot's mouth between shaft and leg (a 3 cm gap on L12's boots), and the render shows the shoe's pieces through the cloth (CLOTH9 c3
// it1's plots: shard facets at L12's boot mouth). Cloth that falls on a shoe meets it as one solid: the volume inside its outline.
// So: the foot's shoe parts voxelised (h); at every height the solid is the CONVEX OUTLINE of the shoe's material at that height (a
// horizontal slice through a shaft is a ring round the leg: its outline is the filled shaft, the mouth capped at every height up to the
// rim; through the forefoot it is the shoe's plan outline; the laces and the gaps under them fall inside it); the profile (the instep's
// concave run from the shaft to the toe, the heel) is kept, since each height has its own outline. Then its signed distance field
// (exact Euclidean transforms: Felzenszwalb and Huttenlocher, "Distance transforms of sampled functions", ToC 2012). The object answers
// the collider queries of collide.js Contacts (closestAny / closest: the nearest point of the solid's surface, its normal, the signed
// distance), trilinear in the field, the normal its gradient.
//   const S = closedShoe9([{ X, T }, ...], { h, margin }); a Contacts surface { mesh: S, gap, mu }
export const SHOE9_VERSION = 1;
const INF = 1e20;
// 1D squared EDT of f (in place on the line) (Felzenszwalb-Huttenlocher)
function edt1(f, n, d, v, z) { let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) { let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); } k++; v[k] = q; z[k] = s; z[k + 1] = INF; }
  k = 0; for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; } }
// squared distance (voxels) from every voxel to the nearest voxel with seed[i] = 1
function edt3(seed, nx, ny, nz) { const N = nx * ny * nz, D = new Float64Array(N); for (let i = 0; i < N; i++) D[i] = seed[i] ? 0 : INF;
  const L = Math.max(nx, ny, nz), f = new Float64Array(L), d = new Float64Array(L), v = new Int32Array(L), z = new Float64Array(L + 1);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) { const o = (k * ny + j) * nx; for (let i = 0; i < nx; i++) f[i] = D[o + i]; edt1(f, nx, d, v, z); for (let i = 0; i < nx; i++) D[o + i] = d[i]; }
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { for (let j = 0; j < ny; j++) f[j] = D[(k * ny + j) * nx + i]; edt1(f, ny, d, v, z); for (let j = 0; j < ny; j++) D[(k * ny + j) * nx + i] = d[j]; }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { for (let k = 0; k < nz; k++) f[k] = D[(k * ny + j) * nx + i]; edt1(f, nz, d, v, z); for (let k = 0; k < nz; k++) D[(k * ny + j) * nx + i] = d[k]; }
  return D; }
export function closedShoe9(meshes, { h = 0.002, margin = 0.03 } = {}) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const { X, T } of meshes) { for (let t = 0; t < T.length; t++) { const i = T[t]; for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], X[i * 3 + c]); hi[c] = Math.max(hi[c], X[i * 3 + c]); } } }
  for (let c = 0; c < 3; c++) { lo[c] -= margin; hi[c] += margin; }
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 1, ny = Math.ceil((hi[1] - lo[1]) / h) + 1, nz = Math.ceil((hi[2] - lo[2]) / h) + 1, N = nx * ny * nz, idx = (i, j, k) => (k * ny + j) * nx + i;
  // the surfaces into voxels: each triangle sampled at h/2
  const surf = new Uint8Array(N), inb = (x, y, z) => x >= lo[0] && x <= hi[0] && y >= lo[1] && y <= hi[1] && z >= lo[2] && z <= hi[2];
  for (const { X, T } of meshes) for (let t = 0; t < T.length; t += 3) { const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
    if (!inb(X[a], X[a + 1], X[a + 2]) && !inb(X[b], X[b + 1], X[b + 2]) && !inb(X[c], X[c + 1], X[c + 2])) continue;
    const e = Math.max(Math.hypot(X[a] - X[b], X[a + 1] - X[b + 1], X[a + 2] - X[b + 2]), Math.hypot(X[b] - X[c], X[b + 1] - X[c + 1], X[b + 2] - X[c + 2]), Math.hypot(X[c] - X[a], X[c + 1] - X[a + 1], X[c + 2] - X[a + 2])), s = Math.max(1, Math.ceil(e / (h * 0.5)));
    for (let u = 0; u <= s; u++) for (let w = 0; w <= s - u; w++) { const fu = u / s, fw = w / s, fv = 1 - fu - fw, x = X[a] * fv + X[b] * fu + X[c] * fw, y = X[a + 1] * fv + X[b + 1] * fu + X[c + 1] * fw, z = X[a + 2] * fv + X[b + 2] * fu + X[c + 2] * fw;
      const i = Math.round((x - lo[0]) / h), j = Math.round((y - lo[1]) / h), k = Math.round((z - lo[2]) / h); if (i >= 0 && i < nx && j >= 0 && j < ny && k >= 0 && k < nz) surf[idx(i, j, k)] = 1; } }
  // each height's solid: the convex outline (monotone chain) of that height's surface voxels, filled
  const S = new Uint8Array(N); let solid = 0;
  for (let j = 0; j < ny; j++) { const pts = []; for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) if (surf[idx(i, j, k)]) pts.push([i, k]); if (!pts.length) continue;
    pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]); const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), Lo = [], Up = [];
    for (const p of pts) { while (Lo.length >= 2 && cr(Lo[Lo.length - 2], Lo[Lo.length - 1], p) <= 0) Lo.pop(); Lo.push(p); }
    for (let t = pts.length - 1; t >= 0; t--) { const p = pts[t]; while (Up.length >= 2 && cr(Up[Up.length - 2], Up[Up.length - 1], p) <= 0) Up.pop(); Up.push(p); }
    const H = Lo.slice(0, -1).concat(Up.slice(0, -1)); let i0 = Infinity, i1 = -Infinity, k0 = Infinity, k1 = -Infinity; for (const [i, k] of pts) { i0 = Math.min(i0, i); i1 = Math.max(i1, i); k0 = Math.min(k0, k); k1 = Math.max(k1, k); }
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) { let inside = true;   // inside or within half a voxel of every edge (counter-clockwise hull)
      if (H.length >= 3) for (let e = 0; e < H.length && inside; e++) { const a = H[e], b = H[(e + 1) % H.length], ex = b[0] - a[0], ez = b[1] - a[1], l = Math.hypot(ex, ez); if ((ex * (k - a[1]) - ez * (i - a[0])) / l < -0.5) inside = false; }
      else inside = surf[idx(i, j, k)] === 1;
      if (inside) { S[idx(i, j, k)] = 1; solid++; } } }
  // the signed distance (metres): outside + dist to S, inside - dist to not-S, each from voxel centres (half a voxel to the boundary)
  const notS = Uint8Array.from(S, s => 1 - s), dIn = edt3(S, nx, ny, nz), dOut = edt3(notS, nx, ny, nz), phi = new Float32Array(N);
  for (let i = 0; i < N; i++) phi[i] = S[i] ? -(Math.sqrt(dOut[i]) - 0.5) * h : (Math.sqrt(dIn[i]) - 0.5) * h;
  const field = (x, y, z) => { const fx = (x - lo[0]) / h, fy = (y - lo[1]) / h, fz = (z - lo[2]) / h; if (fx < 0 || fy < 0 || fz < 0 || fx >= nx - 1 || fy >= ny - 1 || fz >= nz - 1) return NaN;
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz), u = fx - i, v = fy - j, w = fz - k, o = idx(i, j, k), sx = 1, sy = nx, sz = nx * ny;
    return ((phi[o] * (1 - u) + phi[o + sx] * u) * (1 - v) + (phi[o + sy] * (1 - u) + phi[o + sy + sx] * u) * v) * (1 - w) + ((phi[o + sz] * (1 - u) + phi[o + sz + sx] * u) * (1 - v) + (phi[o + sz + sy] * (1 - u) + phi[o + sz + sy + sx] * u) * v) * w; };
  const self = { nx, ny, nz, h, lo, hi, solid, lastV: -1, phi: field,
    closestAny(x, y, z, reach) { const d = field(x, y, z); if (!(d <= reach)) return null; const e = h * 0.5;
      let gx = field(x + e, y, z) - field(x - e, y, z), gy = field(x, y + e, z) - field(x, y - e, z), gz = field(x, y, z + e) - field(x, y, z - e); const gl = Math.hypot(gx, gy, gz); if (!(gl > 1e-12)) return null; gx /= gl; gy /= gl; gz /= gl;
      return { px: x - gx * d, py: y - gy * d, pz: z - gz * d, nx: gx, ny: gy, nz: gz, d, edge: false, tri: -1 }; } };
  self.closest = self.closestAny;
  return self;
}
