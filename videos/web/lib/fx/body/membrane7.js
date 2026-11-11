// BODY / MEMBRANE 7 (HUMAN c8 round 7, BODY7 c3 iteration 1, 8 Oct 2026): THE MEMBRANE FIT. hm08's skin laid onto a SOLVED soft-tissue envelope.
// The seam ANAT8-BODY and BODY7 agreed (anat8_body NOTES iteration 8-9: 'BODY7 fits hm08 onto soft/'s loaded surface; soft/ supplies the surface and
// the tracked points'; the orchestrator, 13:55: 'the breast's visible skin will be hm08 fitted as a MEMBRANE onto its solved envelope'). Nothing here
// shapes the breast: the form is the SOLVER's (lib/fx/anatomy/soft/: gland and fat as tetrahedra under gravity, the anchoring ring, the skin a
// membrane; ANAT8-BODY's), and this file only carries the person's own skin (its topology, its UVs, its fine relief, its skinning) onto that form.
//
//   fitSkin7(P, { name, register, sides, solve, ... })   makePerson7's soft hook (lib/fx/person/v7.js: assets/anatomy/soft/landed.json
//                                                       { module: 'body/membrane7.js', fn: 'fitSkin7' }, or the option soft: { module, fn } that
//                                                       forces it): solves ANAT8-BODY's breast on this person's own rev 7 prior body (P.p.built,
//                                                       the hero's bind frame) and fits the hero's bind skin onto it; women, figure study only
//   fitMembrane7(h, envs, opts)                         the fit alone, on any supplied envelope: envs = [{ pos, tri, label, labels, weightAt(q) }]
//
// THE FIT (on the hero's BIND positions, at whatever subdivision level; the stance's skinning carries it, so the export and Cycles get it):
//  1. the region: the torso's vertices within the envelope's skin box (+ MF7.reach), and MF7.ring rings beyond, the last one held where it was;
//  2. each outer step (MF7.outer) casts every region vertex's RAY along its SMOOTHED normal (Taubin lambda / mu, MF7.smooth passes: the fine
//     relief does not steer it), both ways up to MF7.reach, onto the envelope's 'skin' triangles (a uniform grid; each envelope's winding read
//     from its own front, so the mirrored side works): the nearest hit facing the same way (dot > MF7.facing) is the vertex's target, along its
//     normal (no tangential slide: the UVs and the paint stay on their skin);
//  3. a WEIGHT per hit: the supplier's own (weightAt: here 1 inside the breast's footprint, falling to 0 between rho MF7.rho0 and MF7.rho1, so the
//     solved breast replaces the skin and the chest outside it stays the person's own) times a falloff to 0 over MF7.edge from the envelope
//     patch's open boundary (its cut walls); none inside the held discs (NAC7's nipple-areola: MF7.holdR areola radii round nippleAt's point);
//  4. a NON-RIGID ICP with LAPLACIAN COORDINATES (detail-preserving membrane; Sorkine et al. 2004 'Laplacian surface editing'; the decreasing
//     stiffness of Amberg et al. 2007 'Optimal step nonrigid ICP'): MF7.sweeps Gauss-Seidel sweeps of x = (w c + a (neighbours' mean + delta)) /
//     (w + a), delta the vertex's rest Laplacian turned with the surface (Rodrigues, rest smoothed normal -> current), a from MF7.a0 to MF7.a1:
//     the triangles keep their shape, the papilla stays a papilla, a missed ray or a noisy hit never reaches the skin as a spike;
//  5. the edit is written into the bind positions (and into girdle7's saved copy, so a later girdleReset7 keeps it), the normals are rebuilt over
//     the touched area, and SKIN7's painted areola centre (likeAreo0 / 1, bind space) moves with the skin under it.
// The fit transmits the envelope's form faithfully, its faults included (it does not smooth a crease the solver made: that would be shaping).
// Cost: the solve is ANAT8-BODY's (17-46 s a side in node); the fit 0.3-1.5 s a side. The page never runs the solve (the export and the clay job do).
// What it does NOT do (said plainly): it does not move the nipple-areola to the solve's tracked nipple (NAC7 keeps it at nippleAt's rule point;
// the report gives the distance), and it does not fit the men (no envelope from soft/ for the male chest yet).
import { nippleAt } from './nipple.js';
export const MEMBRANE7_VERSION = 1;
export const MF7 = { smooth: 12, lam: 0.5, mu: -0.53, reach: 0.045, facing: 0.35, rho0: 1.05, rho1: 1.45, edge: 0.015, outer: 10, sweeps: 30, a0: 4, a1: 1, ring: 8, cell: 0.01, holdR: 1.4 };
const TORSO = 2;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- topology of the hero's body geometry (cached per geometry)
const _topo = new WeakMap();
function topoOf(g) {
  const I = g.index.array, n = g.attributes.position.count; let T = _topo.get(g); if (T && T.nI === I.length) return T;
  const deg = new Int32Array(n + 1), tdeg = new Int32Array(n + 1), seen = new Set(), E = [];
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) { const a = I[t + e], b = I[t + (e + 1) % 3], k = a < b ? a * n + b : b * n + a; tdeg[a + 1]++;
    if (seen.has(k)) continue; seen.add(k); E.push(a, b); deg[a + 1]++; deg[b + 1]++; }
  for (let v = 0; v < n; v++) { deg[v + 1] += deg[v]; tdeg[v + 1] += tdeg[v]; }
  const nb = new Int32Array(deg[n]), fill = deg.slice(0, n); for (let i = 0; i < E.length; i += 2) { const a = E[i], b = E[i + 1]; nb[fill[a]++] = b; nb[fill[b]++] = a; }
  const vt = new Int32Array(tdeg[n]), tf = tdeg.slice(0, n); for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) vt[tf[I[t + e]]++] = t / 3;
  T = { nI: I.length, off: deg, nb, toff: tdeg, vt }; _topo.set(g, T); return T;
}
function normalsAt(X, I, T, verts, out) {   // area-weighted normals of the listed vertices from the positions X
  for (const v of verts) { let nx = 0, ny = 0, nz = 0;
    for (let k = T.toff[v]; k < T.toff[v + 1]; k++) { const t = T.vt[k], a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
      const ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2], wx = X[c] - X[a], wy = X[c + 1] - X[a + 1], wz = X[c + 2] - X[a + 2];
      nx += uy * wz - uz * wy; ny += uz * wx - ux * wz; nz += ux * wy - uy * wx; }
    const l = Math.hypot(nx, ny, nz) || 1; out[3 * v] = nx / l; out[3 * v + 1] = ny / l; out[3 * v + 2] = nz / l; }
}

// ---------------------------------------------------------------- the envelope: its skin triangles in a grid, its open boundary
function envIndex(E, cell) {
  const P = E.pos, L = E.label, iSkin = E.labels.indexOf('skin'), T = E.tri, tris = [];
  for (let t = 0; t < T.length; t += 3) if (L[T[t]] === iSkin && L[T[t + 1]] === iSkin && L[T[t + 2]] === iSkin) tris.push(t);
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (let e = 0; e < 3; e++) { const o = 3 * T[t + e]; for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], P[o + j]); hi[j] = Math.max(hi[j], P[o + j]); } }
  const dim = [0, 1, 2].map(j => Math.max(1, Math.ceil((hi[j] - lo[j]) / cell) + 1)), grid = new Map(), key = (i, j, k) => (k * dim[1] + j) * dim[0] + i;
  for (const t of tris) { const a = 3 * T[t], b = 3 * T[t + 1], c = 3 * T[t + 2];
    const i0 = [0, 1, 2].map(j => Math.floor((Math.min(P[a + j], P[b + j], P[c + j]) - lo[j]) / cell)), i1 = [0, 1, 2].map(j => Math.floor((Math.max(P[a + j], P[b + j], P[c + j]) - lo[j]) / cell));
    for (let k = i0[2]; k <= i1[2]; k++) for (let j = i0[1]; j <= i1[1]; j++) for (let i = i0[0]; i <= i1[0]; i++) { const q = key(i, j, k); let l = grid.get(q); if (!l) grid.set(q, l = []); l.push(t); } }
  // the open boundary of the skin patch (edges used by one skin triangle): its vertices, in a coarse grid for the distance falloff
  const ec = new Map(); for (const t of tris) for (let e = 0; e < 3; e++) { const a = T[t + e], b = T[t + (e + 1) % 3], k = a < b ? a + ',' + b : b + ',' + a; ec.set(k, (ec.get(k) || 0) + 1); }
  const bv = new Set(); for (const [k, c] of ec) if (c === 1) { const [a, b] = k.split(',').map(Number); bv.add(a); bv.add(b); }
  const bgrid = new Map(), bc = 0.02, bkey = p => [0, 1, 2].map(j => Math.floor((p[j] - lo[j]) / bc)).join(',');
  for (const v of bv) { const p = [P[3 * v], P[3 * v + 1], P[3 * v + 2]], q = bkey(p); let l = bgrid.get(q); if (!l) bgrid.set(q, l = []); l.push(p); }
  const edgeDist = (p, maxD) => { const c = [0, 1, 2].map(j => Math.floor((p[j] - lo[j]) / bc)), r = Math.ceil(maxD / bc); let best = maxD;
    for (let k = -r; k <= r; k++) for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) { const l = bgrid.get((c[0] + i) + ',' + (c[1] + j) + ',' + (c[2] + k)); if (!l) continue;
      for (const q of l) best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])); } return best; };
  return { P, T, tris: tris.length, lo, hi, cell, dim, grid, key, boundary: bv.size, edgeDist };
}
// the nearest hit of the ray o + t d (|t| <= reach) on the envelope's skin, the triangle facing along d; null if none
function castRay(G, o, d, reach, facing, sgn = 1) {
  const { P, T, lo, cell, dim, grid, key } = G, seen = new Set(); let best = null;
  const steps = Math.ceil(2 * reach / (0.5 * cell));
  for (let s = 0; s <= steps; s++) { const t = -reach + (2 * reach) * s / steps, p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    const i = Math.floor((p[0] - lo[0]) / cell), j = Math.floor((p[1] - lo[1]) / cell), k = Math.floor((p[2] - lo[2]) / cell);
    for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj, kk = k + dk;
      if (ii < 0 || jj < 0 || kk < 0 || ii >= dim[0] || jj >= dim[1] || kk >= dim[2]) continue; const l = grid.get(key(ii, jj, kk)); if (!l) continue;
      for (const tr of l) { if (seen.has(tr)) continue; seen.add(tr);
        const a = 3 * T[tr], b = 3 * T[tr + 1], c = 3 * T[tr + 2], A = [P[a], P[a + 1], P[a + 2]], e1 = [P[b] - A[0], P[b + 1] - A[1], P[b + 2] - A[2]], e2 = [P[c] - A[0], P[c + 1] - A[1], P[c + 2] - A[2]];
        const nt = crs(e1, e2), nl = Math.hypot(...nt) || 1; if (sgn * dot(nt, d) / nl < facing) continue;            // the envelope's outward skin, facing the same way
        const pv = crs(d, e2), det = dot(e1, pv); if (Math.abs(det) < 1e-14) continue; const inv = 1 / det, tv = sub(o, A), u = dot(tv, pv) * inv; if (u < -1e-6 || u > 1 + 1e-6) continue;
        const qv = crs(tv, e1), v = dot(d, qv) * inv; if (v < -1e-6 || u + v > 1 + 1e-6) continue; const tt = dot(e2, qv) * inv; if (Math.abs(tt) > reach) continue;
        if (!best || Math.abs(tt) < Math.abs(best.t)) best = { t: tt, tri: tr, q: [o[0] + d[0] * tt, o[1] + d[1] * tt, o[2] + d[2] * tt] }; } } }
  return best;
}

// ---------------------------------------------------------------- the fit on any envelope
// h: the hero (h.body.geometry: bind positions, index, aHero); envs: [{ name, pos, tri, label, labels, weightAt?(q) -> 0..1 }] in the hero's bind
// units; base: optional Float array of the as-built bind (3 x vertices) to fit from (default the geometry's current positions). Returns
// { D, verts, stats }: D the bind displacement per vertex (not yet applied), verts the vertices it may touch.
// The solve is a NON-RIGID ICP with LAPLACIAN COORDINATES (detail-preserving membrane; Sorkine et al. 2004, 'Laplacian surface editing'; the
// iterated closest-point pull of Amberg et al. 2007, 'Optimal step nonrigid ICP', with a decreasing stiffness): each outer step casts every
// region vertex's ray along its CURRENT normal onto the envelope (step 2 above: the target is along the normal), then MF7.sweeps Gauss-Seidel
// sweeps of  x_v = (w_v c_v + a (mean of its neighbours + delta0_v)) / (w_v + a)  with delta0_v the vertex's rest Laplacian (its fine relief and
// its place among its neighbours: the triangles keep their shape and nothing folds), the stiffness a from MF7.a0 down to MF7.a1; the region's
// outer ring (MF7.ring rings past the last weighted vertex) is held where it was, so the fitted area meets the skin without a step.
export function fitMembrane7(h, envs, { base = null, hold = [], ...o } = {}) {
  const K = { ...MF7, ...o }, g = h.body.geometry, X0 = base || g.attributes.position.array, I = g.index.array, n = g.attributes.position.count, T = topoOf(g);
  const REG = g.attributes.aHero?.array, rst = g.attributes.aHero?.itemSize || 4, sc = h.scale || 1, t0 = Date.now();
  const inTri = new Uint8Array(n); for (let i = 0; i < I.length; i++) inTri[I[i]] = 1;
  const torso = v => inTri[v] && (!REG || Math.round(REG[v * rst]) === TORSO);
  const stats = { version: MEMBRANE7_VERSION, envs: [] };
  // the envelopes, indexed; each one's orientation (its skin faces +z, the front, near its own centre: the mirrored side's winding is flipped)
  const Gs = envs.map(E => { const G = envIndex(E, K.cell / sc); G.E = E; let sz = 0; const P = E.pos, Tr = E.tri, L = E.label, iS = E.labels.indexOf('skin');
    for (let t = 0; t < Tr.length; t += 3) { if (L[Tr[t]] !== iS || L[Tr[t + 1]] !== iS || L[Tr[t + 2]] !== iS) continue; const a = 3 * Tr[t], b = 3 * Tr[t + 1], c = 3 * Tr[t + 2];
      sz += (P[b] - P[a]) * (P[c + 1] - P[a + 1]) - (P[b + 1] - P[a + 1]) * (P[c] - P[a]); }
    G.sgn = sz >= 0 ? 1 : -1; return G; });
  // the region: torso vertices within any envelope's skin box (+ the reach); then the rings beyond it (held at the last)
  const pad = K.reach / sc, lev = new Int32Array(n).fill(-1), reg = [];
  for (let v = 0; v < n; v++) { if (!torso(v)) continue; const x = X0[3 * v], y = X0[3 * v + 1], z = X0[3 * v + 2];
    if (Gs.some(G => x > G.lo[0] - pad && x < G.hi[0] + pad && y > G.lo[1] - pad && y < G.hi[1] + pad && z > G.lo[2] - pad && z < G.hi[2] + pad)) { lev[v] = 0; reg.push(v); } }
  let front = reg.slice(); for (let r = 1; r <= K.ring; r++) { const nf = []; for (const v of front) for (let k = T.off[v]; k < T.off[v + 1]; k++) { const u = T.nb[k]; if (lev[u] < 0 && inTri[u]) { lev[u] = r; nf.push(u); } } front = nf; }
  const free = []; for (let v = 0; v < n; v++) if (lev[v] >= 0 && lev[v] < K.ring) free.push(v);
  // the rest Laplacian (uniform) of the free vertices, and the working positions
  const X = Float64Array.from(X0), d0 = new Float64Array(3 * n);
  for (const v of free) { const c = T.off[v + 1] - T.off[v]; if (!c) continue; for (let j = 0; j < 3; j++) { let m = 0; for (let k = T.off[v]; k < T.off[v + 1]; k++) m += X0[3 * T.nb[k] + j]; d0[3 * v + j] = X0[3 * v + j] - m / c; } }
  const Nw = new Float64Array(3 * n), C = new Float64Array(3 * n), W = new Float64Array(n);
  // the smoothed normals of the start (Taubin over the region: the fine relief does not steer the rays)
  const smoothNormals = () => { const S = Float64Array.from(X), tmp = new Float64Array(3 * n);
    for (let pass = 0; pass < 2 * K.smooth; pass++) { const f = pass % 2 ? K.mu : K.lam;
      for (const v of free) { const c = T.off[v + 1] - T.off[v]; if (!c) continue; for (let j = 0; j < 3; j++) { let m = 0; for (let k = T.off[v]; k < T.off[v + 1]; k++) m += S[3 * T.nb[k] + j]; tmp[3 * v + j] = S[3 * v + j] + f * (m / c - S[3 * v + j]); } }
      for (const v of free) for (let j = 0; j < 3; j++) S[3 * v + j] = tmp[3 * v + j]; }
    normalsAt(S, I, T, free, Nw); return S; };
  let outer = 0, hitsLast = 0, sweepRes = 0; const perEnv = Gs.map(() => ({ hits: 0, ring: [] }));
  // the held discs (no data inside: the nipple-areola's relief rides on the fitted skin by its Laplacian coordinates, never pulled flat)
  const held = v => hold.some(q => Math.hypot(X0[3 * v] - q.p[0], X0[3 * v + 1] - q.p[1], X0[3 * v + 2] - q.p[2]) < q.r);
  const N0 = new Float64Array(3 * n), dR = new Float64Array(3 * n);
  for (; outer < K.outer; outer++) {
    const S = smoothNormals(), a = K.a0 * Math.pow(K.a1 / K.a0, outer / Math.max(1, K.outer - 1));
    if (outer === 0) N0.set(Nw);
    // the rest Laplacians turned with the surface (the rotation taking the rest smoothed normal to the current one, Rodrigues): a relief stays a
    // relief where the breast's surface tilts (uniform Laplacian coordinates are not rotation-invariant; without this the papilla shears)
    for (const v of free) { const a3 = [N0[3 * v], N0[3 * v + 1], N0[3 * v + 2]], b3 = [Nw[3 * v], Nw[3 * v + 1], Nw[3 * v + 2]], k3 = crs(a3, b3), sn = Math.hypot(...k3), cs = dot(a3, b3), d = [d0[3 * v], d0[3 * v + 1], d0[3 * v + 2]];
      if (sn < 1e-9) { dR[3 * v] = d[0]; dR[3 * v + 1] = d[1]; dR[3 * v + 2] = d[2]; continue; } const k = k3.map(x => x / sn), kd = crs(k, d), kk = dot(k, d);
      for (let j = 0; j < 3; j++) dR[3 * v + j] = d[j] * cs + kd[j] * sn + k[j] * kk * (1 - cs); }
    // targets: the ray from the smoothed point along the smoothed normal; the hit's weight (supplier x edge falloff); several envelopes: the nearest
    W.fill(0); let hits = 0;
    for (const v of reg) { const o3 = [S[3 * v], S[3 * v + 1], S[3 * v + 2]], d3 = [Nw[3 * v], Nw[3 * v + 1], Nw[3 * v + 2]]; let best = null, bg = -1;
      Gs.forEach((G, gi) => { const r = castRay(G, o3, d3, K.reach / sc, K.facing, G.sgn); if (r && (!best || Math.abs(r.t) < Math.abs(best.t))) { best = r; bg = gi; } });
      if (!best || held(v)) continue; const G = Gs[bg], wS = G.E.weightAt ? G.E.weightAt(best.q) : 1, w = wS * ss(0, K.edge / sc, G.edgeDist(best.q, 2 * K.edge / sc)); if (w <= 0) continue;
      hits++; W[v] = w; for (let j = 0; j < 3; j++) C[3 * v + j] = X[3 * v + j] + d3[j] * best.t;    // the target moves the vertex itself along the base normal
      if (outer === K.outer - 1) { perEnv[bg].hits++; if (wS > 0.05 && wS < 0.6) perEnv[bg].ring.push(Math.abs(best.t)); } }
    hitsLast = hits;
    // the screened Laplacian-coordinates solve (Gauss-Seidel), the stiffness a
    for (let it = 0; it < K.sweeps; it++) { sweepRes = 0;
      for (const v of free) { if (lev[v] >= K.ring) continue; const c = T.off[v + 1] - T.off[v]; if (!c) continue; const w = W[v];
        for (let j = 0; j < 3; j++) { let m = 0; for (let k = T.off[v]; k < T.off[v + 1]; k++) m += X[3 * T.nb[k] + j];
          const tgt = (w * C[3 * v + j] + a * (m / c + dR[3 * v + j])) / (w + a), dl = tgt - X[3 * v + j]; X[3 * v + j] = tgt; sweepRes = Math.max(sweepRes, Math.abs(dl)); } } } }
  const D = new Float64Array(3 * n); let moved = 0, mx = 0, sum = 0, resid = [];
  for (const v of free) { for (let j = 0; j < 3; j++) D[3 * v + j] = X[3 * v + j] - X0[3 * v + j]; const d = Math.hypot(D[3 * v], D[3 * v + 1], D[3 * v + 2]) * sc * 1000; if (d > 0.1) { moved++; sum += d; mx = Math.max(mx, d); }
    if (W[v] > 0.9) resid.push(Math.hypot(C[3 * v] - X[3 * v], C[3 * v + 1] - X[3 * v + 1], C[3 * v + 2] - X[3 * v + 2]) * sc * 1000); }
  resid.sort((p, q) => p - q); const pc = (A, p) => A.length ? +A[Math.floor(p * (A.length - 1))].toFixed(1) : null;
  Gs.forEach((G, gi) => { const r = perEnv[gi].ring.sort((p, q) => p - q); stats.envs.push({ name: G.E.name, envTris: G.tris, envBoundary: G.boundary, flipped: G.sgn < 0, hits: perEnv[gi].hits,
    blendRingMm: r.length ? { p50: pc(r.map(x => x * sc * 1000), 0.5), p90: pc(r.map(x => x * sc * 1000), 0.9), n: r.length } : null }); });
  Object.assign(stats, { region: reg.length, free: free.length, outer, sweeps: K.sweeps, hits: hitsLast, res: +(sweepRes * sc * 1000).toExponential(2), moved, meanMm: +(sum / Math.max(1, moved)).toFixed(2), maxMm: +mx.toFixed(1),
    residMm: { p50: pc(resid, 0.5), p90: pc(resid, 0.9), max: pc(resid, 1), n: resid.length }, ms: Date.now() - t0 });
  return { D, verts: free, stats };
}

// ---------------------------------------------------------------- ANAT8-BODY's solved breast on this person (node; the page never runs it)
export async function breastEnvelopes7(P, { sides = ['L', 'R'], solve = {}, h: hh = null } = {}) {
  const p = P.p; if (!p?.built) throw new Error('membrane7: no prior body (P.p.built)');
  const [K8, M8, SB, BS] = await Promise.all([import('../anatomy/skeleton/index.js'), import('../anatomy/muscle/index.js'), import('../anatomy/soft/breast.js'), import('./index.js')]);
  const S0 = p._S || await BS.loadBodyStudio(), t0 = Date.now(), B = K8.bodyOf(S0, p.built, p), K = K8.buildSkeleton(B), M = M8.buildMuscles(B, K, { rec: p, version: 2 }), tA = Date.now() - t0;
  const sc = P.h.scale || 1, out = [];
  for (const side of sides) {
    const t1 = Date.now(), Z = SB.solveBreast(B, K, M, { rec: p, side, ...(hh ? { h: hh } : {}), ...(solve.opts || {}), solve: solve.solve || {} }), L = Z.L, m = Z.R.meta;
    const pos = Float64Array.from(L.surface.pos, x => x / sc);      // the solve's metres -> the hero's bind units
    const weightAt = q => { const w = [q[0] * sc, q[1] * sc, q[2] * sc], a = m.ab(w), r = m.rhoAt(a[0], a[1]); return 1 - ss(MF7.rho0, MF7.rho1, r); };
    const nip = L.track?.nipple || null;
    out.push({ name: 'breast' + side, side, pos, tri: L.surface.tri, label: L.surface.label, labels: L.surface.labels, weightAt, nipple: nip ? nip.map(x => x / sc) : null,
      report: { converged: L.stats?.converged, steps: L.stats?.steps, ms: Date.now() - t1, checks: Z.report?.checks ? Object.fromEntries(Object.entries(Z.report.checks).filter(([, v]) => typeof v !== 'object')) : null, version: SB.SOFT_BREAST_VERSION } });
  }
  return { envs: out, anatomyMs: tA };
}

// ---------------------------------------------------------------- the soft hook (lib/fx/person/v7.js: fn(P, { name, register, ...opts }))
export async function fitSkin7(P, { name = null, register = 'bare', sides = ['L', 'R'], solve = {}, fit = {} } = {}) {
  const h = P?.h, g = h?.body?.geometry, sex = P?.p?.sex || h?.sex;
  if (register !== 'bare') return { skipped: 'dressed register (form 1): the membrane fit acts on the figure study only' };
  if (sex !== 'f') return { skipped: 'no envelope for the male chest yet (soft/ solves the breast)' };
  if (!g?.index) return { skipped: 'no body geometry' };
  const t0 = Date.now(), X = g.attributes.position.array, n = g.attributes.position.count;
  // the as-built bind (girdle7's relax is a pose-time bind correction over its band: fit from the as-built skin, then add the same edit to both)
  let G7 = null; try { G7 = await import('./girdle7.js'); } catch (e) { G7 = null; }
  const sv = G7?.girdleSaved7?.(h), base = Float64Array.from(X); if (sv) for (let i = 0; i < sv.idx.length; i++) for (let j = 0; j < 3; j++) base[3 * sv.idx[i] + j] = sv.pos[3 * i + j];
  const E = await breastEnvelopes7(P, { sides, solve });
  // NAC7's nipple-areola (nippleAt's point) is a held disc: no data inside it, its relief rides on the fitted skin
  const nipBefore = (() => { try { return nippleAt(h, { sex: 'f', scale: 1 / (h.scale || 1) }); } catch (e) { return null; } })();
  const hold = nipBefore && nipBefore.source !== 'landmark' ? ['L', 'R'].map(k => ({ p: nipBefore[k], r: (fit.holdR ?? MF7.holdR) * nipBefore.r })) : [];
  const F = fitMembrane7(h, E.envs, { base, hold, ...fit }), D = F.D;
  // 5. write: the bind positions, girdle7's saved copy, the normals, SKIN7's areola centres
  for (const v of F.verts) { X[3 * v] += D[3 * v]; X[3 * v + 1] += D[3 * v + 1]; X[3 * v + 2] += D[3 * v + 2]; }
  const kept = G7?.girdleBindEdit7 ? G7.girdleBindEdit7(h, D) : 0;
  const T = topoOf(g), ring = new Set(F.verts); for (const v of F.verts) for (let k = T.off[v]; k < T.off[v + 1]; k++) ring.add(T.nb[k]);
  normalsAt(X, g.index.array, T, ring, g.attributes.normal.array);
  const U = h.likeness?.skin?.U, areo = [];
  for (const key of ['likeAreo0', 'likeAreo1']) { const u = U?.[key]?.value; if (!u || !(u.x || u.y || u.z)) continue; let vb = -1, bd = Infinity;
    for (let v = 0; v < n; v++) { const d = (base[3 * v] - u.x) ** 2 + (base[3 * v + 1] - u.y) ** 2 + (base[3 * v + 2] - u.z) ** 2; if (d < bd) { bd = d; vb = v; } }
    if (vb >= 0) { u.x += D[3 * vb]; u.y += D[3 * vb + 1]; u.z += D[3 * vb + 2]; areo.push(+(Math.hypot(D[3 * vb], D[3 * vb + 1], D[3 * vb + 2]) * (h.scale || 1) * 1000).toFixed(1)); } }
  g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true; g.computeBoundingSphere?.();
  // the NAC against the solve's own nipple (NAC7 stays at nippleAt's rule point: the distance, so the measurer sees how far apart they are)
  const sc = h.scale || 1, nipAfter = (() => { try { return nippleAt(h, { sex: 'f', scale: 1 / sc }); } catch (e) { return null; } })();
  const nac = E.envs.map(e => { const q = nipAfter?.[e.side], s = e.nipple; return q && s ? { side: e.side, dxMm: +((q[0] - s[0]) * sc * 1000).toFixed(1), dyMm: +((q[1] - s[1]) * sc * 1000).toFixed(1), dzMm: +((q[2] - s[2]) * sc * 1000).toFixed(1) } : null; });
  return { version: MEMBRANE7_VERSION, name, fit: F.stats, girdleSavedEdited: kept, areolaMovedMm: areo, nacMinusSolvedNipple: nac,
    nippleAtShiftMm: nipBefore && nipAfter ? ['L', 'R'].map(s => +(Math.hypot(...[0, 1, 2].map(j => nipAfter[s][j] - nipBefore[s][j])) * sc * 1000).toFixed(1)) : null,
    solve: E.envs.map(e => ({ side: e.side, ...e.report })), anatomyMs: E.anatomyMs, ms: Date.now() - t0 };
}
