// ANAT8 layer core: SAMPLED FIELDS and MESHING (ANAT8-HEAD, 8 Oct; shared with ANAT8-BODY).
//   const G = sampleField(S, box, h, { band })     // S: an sdf.js scene (or any { d(x,y,z) }), box [x0,y0,z0,x1,y1,z1], h the spacing
//   G.value(x, y, z); G.grad(x, y, z, out)          // trilinear value and its (unnormalised -> normalised) gradient: the solver's fast phi
//   const M = surfaceNets(G, { labels: S })         // a closed mesh of the zero level set: { pos: Float32Array, idx: Uint32Array,
//                                                   //   label: Int16Array per vertex (the scene's label nearest the vertex), part: [] }
// Coarse-to-fine: the scene is evaluated exactly on a coarse grid (4h) and then only at fine nodes within `band` (+ a cell diagonal) of
// the surface; the rest of the fine grid takes the coarse trilinear value (far from the surface only the sign and a rough distance
// matter). A 200 x 250 x 230 mm head at h = 1.25 mm is ~5.9 M floats (24 MB).
const floor = Math.floor, sqrt = Math.sqrt, abs = Math.abs, min = Math.min, max = Math.max;
export function sampleField(S, box, h, o = {}) {
  const band = o.band ?? 3 * h, C = o.coarse ?? 4, H = h * C;
  const nx = Math.ceil((box[3] - box[0]) / h) + 1, ny = Math.ceil((box[4] - box[1]) / h) + 1, nz = Math.ceil((box[5] - box[2]) / h) + 1;
  const cx = Math.ceil((nx - 1) / C) + 1, cy = Math.ceil((ny - 1) / C) + 1, cz = Math.ceil((nz - 1) / C) + 1, x0 = box[0], y0 = box[1], z0 = box[2];
  const Cg = new Float32Array(cx * cy * cz); let evals = 0;
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) { Cg[(k * cy + j) * cx + i] = S.d(x0 + i * H, y0 + j * H, z0 + k * H); evals++; }
  const F = new Float32Array(nx * ny * nz), near = H * sqrt(3) + band;
  for (let K = 0; K + 1 < cz || (K === 0 && cz === 1); K++) for (let J = 0; J + 1 < cy; J++) for (let I = 0; I + 1 < cx; I++) {
    const c = (a, b, d) => Cg[((K + d) * cy + (J + b)) * cx + (I + a)], v000 = c(0, 0, 0), v100 = c(1, 0, 0), v010 = c(0, 1, 0), v110 = c(1, 1, 0), v001 = c(0, 0, 1), v101 = c(1, 0, 1), v011 = c(0, 1, 1), v111 = c(1, 1, 1);
    const mn = min(abs(v000), abs(v100), abs(v010), abs(v110), abs(v001), abs(v101), abs(v011), abs(v111)), exact = mn < near;
    const i1 = min(nx - 1, (I + 1) * C), j1 = min(ny - 1, (J + 1) * C), k1 = min(nz - 1, (K + 1) * C);
    for (let k = K * C; k <= k1; k++) for (let j = J * C; j <= j1; j++) for (let i = I * C; i <= i1; i++) {
      const idx = (k * ny + j) * nx + i;
      if (exact) { F[idx] = S.d(x0 + i * h, y0 + j * h, z0 + k * h); evals++; }
      else { const u = (i - I * C) / C, v = (j - J * C) / C, w = (k - K * C) / C;
        F[idx] = (1 - w) * ((1 - v) * ((1 - u) * v000 + u * v100) + v * ((1 - u) * v010 + u * v110)) + w * ((1 - v) * ((1 - u) * v001 + u * v101) + v * ((1 - u) * v011 + u * v111)); } } }
  return makeField(F, [nx, ny, nz], [x0, y0, z0], h, { evals });
}
// a field object over a dense grid (F[(k*ny + j)*nx + i] at (x0 + i h, ...)); outside the grid the value clamps to the border + distance
export function makeField(F, dims, origin, h, info = {}) {
  const [nx, ny, nz] = dims, [x0, y0, z0] = origin, ih = 1 / h;
  const value = (x, y, z) => {
    let fx = (x - x0) * ih, fy = (y - y0) * ih, fz = (z - z0) * ih, out = 0;
    if (fx < 0) { out += -fx * h; fx = 0; } else if (fx > nx - 1.0001) { out += (fx - nx + 1.0001) * h; fx = nx - 1.0001; }
    if (fy < 0) { out += -fy * h; fy = 0; } else if (fy > ny - 1.0001) { out += (fy - ny + 1.0001) * h; fy = ny - 1.0001; }
    if (fz < 0) { out += -fz * h; fz = 0; } else if (fz > nz - 1.0001) { out += (fz - nz + 1.0001) * h; fz = nz - 1.0001; }
    const i = floor(fx), j = floor(fy), k = floor(fz), u = fx - i, v = fy - j, w = fz - k, b = (k * ny + j) * nx + i, sy = nx, sz = nx * ny;
    const r = (1 - w) * ((1 - v) * ((1 - u) * F[b] + u * F[b + 1]) + v * ((1 - u) * F[b + sy] + u * F[b + sy + 1])) + w * ((1 - v) * ((1 - u) * F[b + sz] + u * F[b + sz + 1]) + v * ((1 - u) * F[b + sz + sy] + u * F[b + sz + sy + 1]));
    return r + out; };
  const grad = (x, y, z, o = [0, 0, 0], e = h * 0.5) => { const gx = value(x + e, y, z) - value(x - e, y, z), gy = value(x, y + e, z) - value(x, y - e, z), gz = value(x, y, z + e) - value(x, y, z - e), l = sqrt(gx * gx + gy * gy + gz * gz) || 1;
    o[0] = gx / l; o[1] = gy / l; o[2] = gz / l; return o; };
  return { F, dims, origin, h, value, grad, d: value, info };
}
// combine two fields node by node (same grid): fn(a, b) -> value (e.g. min for a union, a - t for an offset)
export function mapField(A, B, fn) { const F = new Float32Array(A.F.length); for (let i = 0; i < F.length; i++) F[i] = fn(A.F[i], B ? B.F[i] : 0, i); return makeField(F, A.dims, A.origin, A.h); }

// ---------------------------------------------------------------- surface nets (a closed quad mesh of the zero level set, triangulated)
// labels: an sdf.js scene evaluated at each vertex for its label and part name (optional); iso: the level (default 0)
export function surfaceNets(G, o = {}) {
  const { F, dims: [nx, ny, nz], origin: [x0, y0, z0], h } = G, iso = o.iso ?? 0, cellId = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1), pos = [];
  const fv = (i, j, k) => F[(k * ny + j) * nx + i] - iso, cid = (i, j, k) => (k * (ny - 1) + j) * (nx - 1) + i;
  const E = [[0, 0, 0, 1, 0, 0], [0, 1, 0, 1, 1, 0], [0, 0, 1, 1, 0, 1], [0, 1, 1, 1, 1, 1], [0, 0, 0, 0, 1, 0], [1, 0, 0, 1, 1, 0], [0, 0, 1, 0, 1, 1], [1, 0, 1, 1, 1, 1], [0, 0, 0, 0, 0, 1], [1, 0, 0, 1, 0, 1], [0, 1, 0, 0, 1, 1], [1, 1, 0, 1, 1, 1]];
  for (let k = 0; k + 1 < nz; k++) for (let j = 0; j + 1 < ny; j++) for (let i = 0; i + 1 < nx; i++) {
    let neg = 0; for (let c = 0; c < 8; c++) if (fv(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1)) < 0) neg++;
    if (neg === 0 || neg === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const e of E) { const a = fv(i + e[0], j + e[1], k + e[2]), b = fv(i + e[3], j + e[4], k + e[5]); if ((a < 0) === (b < 0)) continue; const t = a / (a - b);
      sx += e[0] + (e[3] - e[0]) * t; sy += e[1] + (e[4] - e[1]) * t; sz += e[2] + (e[5] - e[2]) * t; n++; }
    cellId[cid(i, j, k)] = pos.length / 3; pos.push(x0 + (i + sx / n) * h, y0 + (j + sy / n) * h, z0 + (k + sz / n) * h); }
  const idx = [], quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d); };
  // each grid edge with a sign change gets the quad of the four cells around it (only edges whose four cells exist), oriented outward
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const inA = fv(i, j, k) < 0;
    if (i + 1 < nx && j >= 1 && j <= ny - 2 && k >= 1 && k <= nz - 2 && inA !== (fv(i + 1, j, k) < 0))
      quad(cellId[cid(i, j - 1, k - 1)], cellId[cid(i, j, k - 1)], cellId[cid(i, j, k)], cellId[cid(i, j - 1, k)], !inA);
    if (j + 1 < ny && i >= 1 && i <= nx - 2 && k >= 1 && k <= nz - 2 && inA !== (fv(i, j + 1, k) < 0))
      quad(cellId[cid(i - 1, j, k - 1)], cellId[cid(i - 1, j, k)], cellId[cid(i, j, k)], cellId[cid(i, j, k - 1)], !inA);
    if (k + 1 < nz && i >= 1 && i <= nx - 2 && j >= 1 && j <= ny - 2 && inA !== (fv(i, j, k + 1) < 0))
      quad(cellId[cid(i - 1, j - 1, k)], cellId[cid(i, j - 1, k)], cellId[cid(i, j, k)], cellId[cid(i - 1, j, k)], !inA);
  }
  const P = Float32Array.from(pos), out = { pos: P, idx: Uint32Array.from(idx) };
  if (o.labels) { const L = new Int16Array(P.length / 3), parts = new Array(P.length / 3); for (let v = 0; v < L.length; v++) { o.labels.d(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); L[v] = o.labels.kind === 'scene' ? o.labels.label_ : o.labels.label; parts[v] = o.labels.part; } out.label = L; out.part = parts; }
  return out;
}
// mesh checks: every edge shared by exactly two triangles (closed, manifold edges), Euler characteristic, area, volume (mesh units)
export function meshStats(M) {
  const E = new Map(), idx = M.idx, P = M.pos; let area = 0, vol = 0;
  for (let t = 0; t < idx.length; t += 3) { const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) { const key = u < v ? u * 4294967296 + v : v * 4294967296 + u; E.set(key, (E.get(key) || 0) + 1); }
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2], bx = P[b * 3] - ax, by = P[b * 3 + 1] - ay, bz = P[b * 3 + 2] - az, cx = P[c * 3] - ax, cy = P[c * 3 + 1] - ay, cz = P[c * 3 + 2] - az;
    const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx; area += 0.5 * sqrt(nx * nx + ny * ny + nz * nz); vol += (ax * nx + ay * ny + az * nz) / 6; }
  let open = 0, nonman = 0; for (const c of E.values()) { if (c === 1) open++; else if (c > 2) nonman++; }
  const V = P.length / 3, F = idx.length / 3; return { V, F, E: E.size, euler: V - E.size + F, open, nonManifold: nonman, area: +area.toFixed(1), volume: +vol.toFixed(1) };
}
// connected components of a triangle mesh (rev 2, it2): { count, sizes (vertices, largest first), comp: Int32Array per vertex (by size rank) }
export function meshComponents(M) {
  const n = M.pos.length / 3, par = new Int32Array(n); for (let i = 0; i < n; i++) par[i] = i;
  const find = a => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  for (let t = 0; t < M.idx.length; t += 3) { const a = find(M.idx[t]), b = find(M.idx[t + 1]), c = find(M.idx[t + 2]); if (a !== b) par[a] = b; const bb = find(b); if (find(c) !== bb) par[find(c)] = bb; }
  const size = new Map(); for (let i = 0; i < n; i++) { const r = find(i); size.set(r, (size.get(r) || 0) + 1); }
  const order = [...size.entries()].sort((a, b) => b[1] - a[1]), rank = new Map(order.map(([r], k) => [r, k])), comp = new Int32Array(n);
  for (let i = 0; i < n; i++) comp[i] = rank.get(find(i));
  return { count: order.length, sizes: order.map(o => o[1]), comp };
}
// drop the components smaller than minVerts (stray shards from features thinner than the net): a new mesh with the same fields
export function dropSmall(M, minVerts = 60) {
  const C = meshComponents(M), keep = new Uint8Array(C.count); C.sizes.forEach((s, k) => { keep[k] = s >= minVerts ? 1 : 0; });
  const n = M.pos.length / 3, map = new Int32Array(n).fill(-1); let m = 0; for (let v = 0; v < n; v++) if (keep[C.comp[v]]) map[v] = m++;
  const pos = new Float32Array(m * 3), idx = [], out = { pos }; for (let v = 0; v < n; v++) if (map[v] >= 0) { pos[map[v] * 3] = M.pos[v * 3]; pos[map[v] * 3 + 1] = M.pos[v * 3 + 1]; pos[map[v] * 3 + 2] = M.pos[v * 3 + 2]; }
  for (let t = 0; t < M.idx.length; t += 3) { const a = map[M.idx[t]], b = map[M.idx[t + 1]], c = map[M.idx[t + 2]]; if (a >= 0 && b >= 0 && c >= 0) idx.push(a, b, c); }
  out.idx = Uint32Array.from(idx); if (M.label) { out.label = new Int16Array(m); out.part = new Array(m); for (let v = 0; v < n; v++) if (map[v] >= 0) { out.label[map[v]] = M.label[v]; out.part[map[v]] = M.part?.[v]; } }
  out.dropped = C.sizes.filter(s => s < minVerts).length; return out;
}
// (rev 2.1, it3) PER-PART MESHING: several closed meshes (each part's own scene meshed on its own: a jaw that touches the skull in life
// stays its own closed piece) concatenated into one { pos, idx, label, part, piece } (piece: the index of the source mesh per vertex)
export function concatMeshes(list) {
  let nv = 0, ni = 0; for (const M of list) { nv += M.pos.length / 3; ni += M.idx.length; }
  const pos = new Float32Array(nv * 3), idx = new Uint32Array(ni), label = new Int16Array(nv), piece = new Int16Array(nv), part = new Array(nv); let ov = 0, oi = 0;
  list.forEach((M, k) => { const n = M.pos.length / 3; pos.set(M.pos, ov * 3); for (let t = 0; t < M.idx.length; t++) idx[oi + t] = M.idx[t] + ov;
    for (let v = 0; v < n; v++) { label[ov + v] = M.label ? M.label[v] : 0; piece[ov + v] = k; part[ov + v] = M.part?.[v]; } ov += n; oi += M.idx.length; });
  return { pos, idx, label, part, piece };
}
// the non-manifold edges (shared by more than two triangles) as vertex pairs: to say WHERE a mesh is not clean
export function nonManifoldEdges(M) { const E = new Map(), idx = M.idx;
  for (let t = 0; t < idx.length; t += 3) { const a = idx[t], b = idx[t + 1], c = idx[t + 2]; for (const [u, v] of [[a, b], [b, c], [c, a]]) { const key = u < v ? u * 4294967296 + v : v * 4294967296 + u; E.set(key, (E.get(key) || 0) + 1); } }
  const out = []; for (const [k, c] of E) if (c > 2) out.push([Math.floor(k / 4294967296), k % 4294967296]); return out; }
// (rev 3, it4) REDISTANCE: a sampled field whose zero level is right but whose magnitude away from it is not a distance (an SDF of
// height slabs, sweeps and smooth unions under-reads: the it3 measurer found 18.8 % of the points 1-25 mm off the skull reading >= 3 mm
// too close, ~20 mm at worst) made a TRUE EUCLIDEAN DISTANCE to its zero level, by CLOSEST-POINT PROPAGATION: the seeds are the zero
// crossings on the grid's edges (linear along each edge: a field scaled by any factor crosses at the same place), every node takes the
// nearest seed its neighbours know (raster sweeps forward and backward, repeated), the sign kept from the input. Within `keep` of the
// surface (half a cell) the input stays (exact there, finer than the seeds), blended over one more `keep` (a wider keep blends in an
// input that may already under-read: tested, 1.6 mm at keep 1.5 h). The distance to a set of
// seeds spaced s apart over-reads the distance to the surface by ~ s^2 / 8d: < 0.2 mm beyond 3 mm at h 2.
//   const G2 = redistance(G, { keep: 0.5 * h, passes: 2 })   // -> a field over the same grid; G2.info.redistance { seeds, ms, changed }
export function redistance(G, o = {}) {
  const t0 = Date.now(), { F, dims: [nx, ny, nz], origin: [x0, y0, z0], h } = G, N = F.length, sxy = nx * ny, keep = o.keep ?? 0.5 * h, passes = o.passes ?? 2;
  // the seeds: one per edge with a sign change
  const S = []; const seedOf = new Int32Array(N).fill(-1), d2 = new Float32Array(N).fill(Infinity);
  const put = (n, s) => { const dx = x0 + (n % nx) * h - S[s * 3], dy = y0 + (Math.floor(n / nx) % ny) * h - S[s * 3 + 1], dz = z0 + Math.floor(n / sxy) * h - S[s * 3 + 2], e = dx * dx + dy * dy + dz * dz; if (e < d2[n]) { d2[n] = e; seedOf[n] = s; } };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const n = (k * ny + j) * nx + i, a = F[n];
    for (const [di, dj, dk, st] of [[1, 0, 0, 1], [0, 1, 0, nx], [0, 0, 1, sxy]]) { if (i + di >= nx || j + dj >= ny || k + dk >= nz) continue; const b = F[n + st]; if ((a < 0) === (b < 0)) continue;
      const t = a / (a - b), s = S.length / 3; S.push(x0 + (i + di * t) * h, y0 + (j + dj * t) * h, z0 + (k + dk * t) * h); put(n, s); put(n + st, s); } }
  // the propagation: 13 neighbours before a node in raster order (forward), the 13 after it (backward)
  const NB = []; for (let dk = -1; dk <= 0; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (dk === 0 && (dj > 0 || (dj === 0 && di >= 0))) continue; NB.push([di, dj, dk]); }
  const sweep = sg => { const ks = sg > 0 ? [0, nz, 1] : [nz - 1, -1, -1], js = sg > 0 ? [0, ny, 1] : [ny - 1, -1, -1], is = sg > 0 ? [0, nx, 1] : [nx - 1, -1, -1];
    for (let k = ks[0]; k !== ks[1]; k += ks[2]) for (let j = js[0]; j !== js[1]; j += js[2]) for (let i = is[0]; i !== is[1]; i += is[2]) { const n = (k * ny + j) * nx + i;
      for (const [a, b, c] of NB) { const ii = i + sg * a, jj = j + sg * b, kk = k + sg * c; if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue; const s = seedOf[(kk * ny + jj) * nx + ii]; if (s >= 0 && s !== seedOf[n]) put(n, s); } } };
  for (let p = 0; p < passes; p++) { sweep(1); sweep(-1); }
  const out = new Float32Array(N); let changed = 0;
  for (let n = 0; n < N; n++) { const a = F[n]; if (seedOf[n] < 0) { out[n] = a; continue; } const d = Math.sqrt(d2[n]), m = Math.abs(a); let r;
    if (m <= keep) r = m; else if (m >= 2 * keep) r = d; else { const w = (m - keep) / keep; r = m * (1 - w) + d * w; }
    if (Math.abs(r - m) > 0.5) changed++; out[n] = a < 0 ? -r : r; }
  return makeField(out, [nx, ny, nz], [x0, y0, z0], h, { ...G.info, redistance: { seeds: S.length / 3, ms: Date.now() - t0, changed } });
}
// (rev 3, it4) a separable GAUSSIAN BLUR of a sampled field (sigma mm; the kernel cut at 2.5 sigma): on a distance field it rounds every
// feature narrower than ~2 sigma (a rod, a bead, a slit) and leaves a surface whose radii are >> sigma where it was (shrink ~ sigma^2 / 2R)
export function blurField(G, sigma) {
  const { F, dims: [nx, ny, nz], h } = G, r = Math.max(1, Math.ceil(2.5 * sigma / h)), K = []; let ks = 0; for (let i = -r; i <= r; i++) { const w = Math.exp(-0.5 * (i * h / sigma) ** 2); K.push(w); ks += w; } for (let i = 0; i < K.length; i++) K[i] /= ks;
  let A = Float32Array.from(F), B = new Float32Array(F.length); const st = [1, nx, nx * ny], len = [nx, ny, nz];
  for (let ax = 0; ax < 3; ax++) { const s = st[ax], L = len[ax];
    for (let n = 0; n < A.length; n++) { const c = ax === 0 ? n % nx : ax === 1 ? Math.floor(n / nx) % ny : Math.floor(n / (nx * ny)); let acc = 0;
      for (let q = -r; q <= r; q++) { const cc = Math.min(L - 1, Math.max(0, c + q)); acc += K[q + r] * A[n + (cc - c) * s]; } B[n] = acc; }
    [A, B] = [B, A]; }
  return makeField(A, G.dims, G.origin, h, { ...G.info, blur: sigma });
}
// (rev 3, it4) keep only the inside components (F < 0) of a sampled field that contain a seed node (seed(i, j, k, x, y, z) -> bool): the
// rest (islands: a strap or a bead floating off the solid) become outside (+h). Returns the new field and how many nodes were cleared.
export function keepComponents(G, seed) {
  const { F, dims: [nx, ny, nz], origin: [x0, y0, z0], h } = G, N = F.length, sxy = nx * ny, mark = new Uint8Array(N), st = [];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const n = (k * ny + j) * nx + i; if (F[n] < 0 && seed(i, j, k, x0 + i * h, y0 + j * h, z0 + k * h)) { mark[n] = 1; st.push(n); } }
  while (st.length) { const n = st.pop(), i = n % nx, j = Math.floor(n / nx) % ny, k = Math.floor(n / sxy);
    for (const [a, b, c] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) { const ii = i + a, jj = j + b, kk = k + c; if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue; const m = (kk * ny + jj) * nx + ii; if (!mark[m] && F[m] < 0) { mark[m] = 1; st.push(m); } } }
  const out = Float32Array.from(F); let cleared = 0; for (let n = 0; n < N; n++) if (F[n] < 0 && !mark[n]) { out[n] = h; cleared++; }
  return { G: makeField(out, G.dims, G.origin, h, { ...G.info, cleared }), cleared };
}
