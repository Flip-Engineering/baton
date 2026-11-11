// CLOTH8 (round 7): THE CLOTH THROUGH ITSELF, relaxed where it crosses. A solved garment that still passes through its own cloth (a sleeve
// folded through itself at the bent elbow, a chore coat's elbow, the pinched fold at an armpit, a shirt's blousing at the waist) shows the
// cloth's inside as a dark shard. The solver's untangling (CLOTH6) halved those crossings but left 9,220 triangles over the twelve. Here,
// on the FINISHED shape (the bake's stance, as the page draws it, ride off), every crossing region is relaxed: the crossing triangles'
// vertices and a few rings round them (the ring grows while a region still crosses) take Taubin smoothing steps (lambda / mu: the fold
// flattens without the cloth shrinking onto the body), held out of the body by `gap` along the body's normal, the region's outer ring
// fixed (the cloth round it keeps its solved folds). Rounds re-find the crossings; a region that no longer crosses is left alone.
// A crossing pinched against the body (an armpit: the sleeve's cloth and the side's sandwiched between arm and torso) is also SEPARATED:
// each of the two sheets is pushed to the side of the other its own normal says it belongs on (the outside of the pair keeps out).
// Plain arrays in, positions edited in place: P (posed, welded, metres), T (welded triangles: the drawn ones).
//   relax8(P, T, { body, pin, gap, rounds, iters, ring0, ringMax }) -> { before, after, moved, maxMm, rounds }
import { selfIntersections } from '../cloth5/measure5.js';
export const RELAX8_VERSION = 1;
export const RELAX8 = { gap: 0.0022, rounds: 24, iters: 8, lambda: 0.5, mu: -0.53, ring0: 2, ringMax: 12, sep: 0.0012, inverted: false, invDot: -0.5, openRings: 4, maxMove: 0.03 };

export function adjacency(T, n) {
  const nb = Array.from({ length: n }, () => new Set()), ec = new Map();
  for (let t = 0; t < T.length; t += 3) for (let k = 0; k < 3; k++) { const a = T[t + k], b = T[t + (k + 1) % 3]; nb[a].add(b); nb[b].add(a); const key = a < b ? a * n + b : b * n + a; ec.set(key, (ec.get(key) || 0) + 1); }
  const bnd = new Uint8Array(n), bnb = Array.from({ length: n }, () => []); for (const [key, c] of ec) if (c === 1) { const a = Math.floor(key / n), b = key % n; bnd[a] = 1; bnd[b] = 1; bnb[a].push(b); bnb[b].push(a); }
  return { nb: nb.map(s => Int32Array.from(s)), bnd, bnb };
}
function hitsOf(P, T, n) { const L = [], r = selfIntersections(P, T, { wid: Int32Array.from({ length: n }, (_, i) => i), list: L }); return { hit: r.hit, L }; }
// triangles turned inside out: their normal against the body's at the closest body point (measure5's test), away from the openings
export function invertedOf(P, T, body, near, dotMax = -0.5) { const nt = T.length / 3, inv = new Uint8Array(nt); if (!body) return inv;
  for (let t = 0; t < nt; t++) { const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2]; if (near && (near[a] || near[b] || near[c])) continue; const N = tnorm(P, T, t), x = (P[a * 3] + P[b * 3] + P[c * 3]) / 3, y = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3, z = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3;
    const q = body.closestAny(x, y, z, 0.12); if (!q || q.edge) continue; if (N[0] * q.nx + N[1] * q.ny + N[2] * q.nz < dotMax) inv[t] = 1; } return inv; }
const tnorm = (P, T, t) => { const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2], ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l]; };

export function relax8(P, T, { body = null, pin = null, adj = null, ...o } = {}) {
  const O = { ...RELAX8, ...o }, n = P.length / 3, A = adj || adjacency(T, n), P0 = Float64Array.from(P);
  // vertices within `openRings` of an opening (a free edge): their inside is meant to show (a collar, a cuff's mouth, a hem)
  const near = new Uint8Array(n); { let f = []; for (let v = 0; v < n; v++) if (A.bnd[v]) { near[v] = 1; f.push(v); } for (let k = 0; k < O.openRings; k++) { const nx = []; for (const v of f) for (const u of A.nb[v]) if (!near[u]) { near[u] = 1; nx.push(u); } f = nx; } }
  const invOf = () => (O.inverted && body ? invertedOf(P, T, body, near, O.invDot) : new Uint8Array(T.length / 3));
  let H = hitsOf(P, T, n), I = invOf(), before = 0, inv0 = 0; for (const x of H.hit) before += x; for (const x of I) inv0 += x; const rep = { before, after: before, inv0, inv1: inv0, rounds: 0, moved: 0, maxMm: 0, sepMoves: 0 };
  if (!before && !inv0) return rep;
  const dist = new Int32Array(n), L = new Float64Array(n * 3), stuck = new Int32Array(n);
  const lap = (ids, mov) => { for (const v of ids) { if (!mov[v]) continue; const nbv = A.bnd[v] && A.bnb[v].length >= 2 ? A.bnb[v] : A.nb[v]; let x = 0, y = 0, z = 0; for (const u of nbv) { x += P[u * 3]; y += P[u * 3 + 1]; z += P[u * 3 + 2]; } const c = nbv.length || 1; L[v * 3] = x / c - P[v * 3]; L[v * 3 + 1] = y / c - P[v * 3 + 1]; L[v * 3 + 2] = z / c - P[v * 3 + 2]; } };
  const step = (ids, mov, k) => { lap(ids, mov); for (const v of ids) if (mov[v]) { P[v * 3] += k * L[v * 3]; P[v * 3 + 1] += k * L[v * 3 + 1]; P[v * 3 + 2] += k * L[v * 3 + 2]; } };
  // kept out of the body, never deeper than the solver left it: a vertex's floor is min(its depth then, gap) (the page's body is not the
  // solver's collider to the millimetre: pushing every vertex the solver left 1 mm inside out to `gap` passed sheets through each other)
  const d0 = new Float64Array(n).fill(NaN), depth = v => { const q = body.closestAny(P0[v * 3], P0[v * 3 + 1], P0[v * 3 + 2], 0.06); return q ? q.d : Infinity; };
  const keepOut = (ids, mov) => { if (!body) return; for (const v of ids) { if (!mov[v]) continue; if (Number.isNaN(d0[v])) d0[v] = depth(v); const q = body.closestAny(P[v * 3], P[v * 3 + 1], P[v * 3 + 2], 0.06); if (!q || q.edge) continue; const fl = Math.min(d0[v], O.gap); if (q.d < fl) { const k = fl - q.d; P[v * 3] += q.nx * k; P[v * 3 + 1] += q.ny * k; P[v * 3 + 2] += q.nz * k; } } };
  for (let r = 0; r < O.rounds; r++) {
    // the crossing vertices; a vertex that has stayed in a crossing for rounds widens its region
    const core = []; dist.fill(-1); for (let t = 0; t < H.hit.length; t++) if (H.hit[t] || I[t]) for (let k = 0; k < 3; k++) { const v = T[t * 3 + k]; if (dist[v] < 0) { dist[v] = 0; core.push(v); stuck[v]++; } }
    if (!core.length) break; rep.rounds++;
    const ids = core.slice(); let front = core.slice(), maxK = 0;
    for (const v of core) maxK = Math.max(maxK, Math.min(O.ringMax, O.ring0 + stuck[v] - 1));
    for (let k = 1; k <= maxK && front.length; k++) { const nx = []; for (const v of front) { const lim = Math.min(O.ringMax, O.ring0 + stuck[v] - 1); if (dist[v] >= lim) continue; for (const u of A.nb[v]) if (dist[u] < 0) { dist[u] = k; nx.push(u); ids.push(u); } } front = nx; }
    // the outer ring is the anchor: a vertex moves if it is not on the region's edge (all its neighbours in the region) and not pinned
    const mov = new Uint8Array(n); for (const v of ids) { if (pin && pin[v]) continue; let inner = true; for (const u of A.nb[v]) if (dist[u] < 0) { inner = false; break; } if (inner) mov[v] = 1; }
    // (1) SEPARATE the sheets of each crossing pair: each triangle's corners to its own side of the other's plane, by `sep`, when the pair
    // is a sandwich (the two normals agree: two layers lying the same way, one passing through the other)
    const D = new Float64Array(n * 3), C = new Float64Array(n);
    for (let i = 0; i < H.L.length; i += 2) { const s = H.L[i], u = H.L[i + 1], ns = tnorm(P, T, s), nu = tnorm(P, T, u); const agree = ns[0] * nu[0] + ns[1] * nu[1] + ns[2] * nu[2]; if (agree < 0.6) continue;
      // which is outer: the triangle whose centroid lies farther along the shared normal
      const cen = t => { let x = 0, y = 0, z = 0; for (let k = 0; k < 3; k++) { const v = T[t * 3 + k]; x += P[v * 3]; y += P[v * 3 + 1]; z += P[v * 3 + 2]; } return [x / 3, y / 3, z / 3]; };
      const cs = cen(s), cu = cen(u), nm = [ns[0] + nu[0], ns[1] + nu[1], ns[2] + nu[2]], l = Math.hypot(...nm) || 1; for (let q = 0; q < 3; q++) nm[q] /= l;
      const ds = cs[0] * nm[0] + cs[1] * nm[1] + cs[2] * nm[2], du = cu[0] * nm[0] + cu[1] * nm[1] + cu[2] * nm[2], [outT, inT] = ds >= du ? [s, u] : [u, s];
      for (const [t, sg] of [[outT, 1], [inT, -1]]) for (let k = 0; k < 3; k++) { const v = T[t * 3 + k]; if (!mov[v]) continue; D[v * 3] += nm[0] * sg * O.sep; D[v * 3 + 1] += nm[1] * sg * O.sep; D[v * 3 + 2] += nm[2] * sg * O.sep; C[v]++; } }
    for (const v of ids) if (C[v]) { P[v * 3] += D[v * 3] / C[v]; P[v * 3 + 1] += D[v * 3 + 1] / C[v]; P[v * 3 + 2] += D[v * 3 + 2] / C[v]; rep.sepMoves++; }
    // (2) Taubin steps over the region, kept out of the body
    for (let it = 0; it < O.iters; it++) { step(ids, mov, O.lambda); step(ids, mov, O.mu); keepOut(ids, mov); }
    // no vertex further than `maxMove` from where the solver left it (the relaxation flattens a crossing, it does not re-drape a sleeve)
    for (const v of ids) { if (!mov[v]) continue; const dx = P[v * 3] - P0[v * 3], dy = P[v * 3 + 1] - P0[v * 3 + 1], dz = P[v * 3 + 2] - P0[v * 3 + 2], d = Math.hypot(dx, dy, dz); if (d > O.maxMove) { const k = O.maxMove / d; P[v * 3] = P0[v * 3] + dx * k; P[v * 3 + 1] = P0[v * 3 + 1] + dy * k; P[v * 3 + 2] = P0[v * 3 + 2] + dz * k; } }
    H = hitsOf(P, T, n); I = invOf(); let c = 0, ci = 0; for (const x of H.hit) c += x; for (const x of I) ci += x; rep.after = c; rep.inv1 = ci; if (!c && !ci) break;
  }
  for (let v = 0; v < n; v++) { const d = Math.hypot(P[v * 3] - P0[v * 3], P[v * 3 + 1] - P0[v * 3 + 1], P[v * 3 + 2] - P0[v * 3 + 2]); if (d > 1e-6) { rep.moved++; rep.maxMm = Math.max(rep.maxMm, d * 1000); } }
  rep.maxMm = +rep.maxMm.toFixed(1); return rep;
}
