// XPBD (CLOTHING c1): a cloth solver for garments draped on a posed body. Pure JS on typed arrays, deterministic (fixed order,
// no randomness), the same in node and the browser. It solves for a settled drape, not for an animation: the garment is dropped
// from its pattern shape in the posed space and run until it stops.
//
//   Integration     XPBD, Macklin, Mueller and Chentanez, "XPBD: Position-Based Simulation of Compliant Constrained Dynamics"
//                   (MIG 2016): every constraint has a compliance alpha = 1 / stiffness in real units, so a fabric's measured
//                   stiffness gives the same cloth at any step size. With ONE iteration per substep and many substeps (Macklin,
//                   Storey, Lu, Terdiman, Chentanez, Mueller, "Small Steps in Physics Simulation", SCA 2019) the lambda
//                   accumulator is zero at the start of each solve, so dl = -C / (sum w |grad C|^2 + alpha / h^2).
//   Stretch         one distance constraint per edge. A membrane of 2D modulus Y (N/m) as a triangle lattice: k_edge = 3 Y A_e / L^2
//                   (A_e = a third of the two adjacent triangles' area; exact for an equilateral lattice, where Y = 2k/sqrt3).
//                   Wovens are orthotropic: Y(theta) from the warp, weft and shear (bias) stiffness, 1/Y = c^4/Y1 + s^4/Y2 +
//                   c^2 s^2 (1/G - 2 nu/Y1), theta the angle between the edge and the warp (the caller gives a warp direction per
//                   vertex: along the limb on sleeves and legs, down the body on the torso). Compression is softer (`compress`, a
//                   fraction of tension): cloth buckles into folds long before it shortens in plane.
//   Bending         one dihedral-angle constraint per interior edge, C = theta - theta0, gradients from Bridson, Marino and Fedkiw,
//                   "Simulation of clothing with folds and wrinkles" (SCA 2003). Energy B |e|^2 / (A1 + A2) theta^2 per hinge, which
//                   is B/2 kappa^2 per unit area for cylindrical bending on an equilateral lattice in any direction (B the KES
//                   bending rigidity per width, N.m). Held to Peirce's cantilever in drape_test.mjs. theta0 = restAngle x the
//                   pattern's own dihedral (1 keeps the sewn shape, 0 flat panels); a hinge folded past `foldMax` (a turned hem) is
//                   held by a wing-to-wing distance constraint instead (the angle's gradient is singular near pi).
//   Long range      Kim, Chentanez and Mueller, "Long Range Attachments" (SCA 2012): each free particle is tethered to its nearest
//                   pin by the GEODESIC rest distance on the pattern (Dijkstra over the edges), as an inequality |x - pin| <= L (1 +
//                   slack). Heavy cloth cannot sag-stretch away from where it is held however few iterations run.
//   Pins            inverse mass 0 (hard), or soft attachments with their own compliance.
//   Contact         a collider object (collide.js Contacts) projects particles out of the posed body (and the layers under the
//                   garment) at the fabric's thickness with Coulomb friction, every substep; `refresh` re-finds candidates.
//   Self contact    optional particle-particle repulsion between particles that are far apart on the pattern (two trouser legs,
//                   a sleeve against the body of the shirt): a cheap stand-in for full cloth self-collision.
//   Damping         velocity decay exp(-damping h) and a speed cap (a deep initial contact must not launch a particle).
// Units: metres, kilograms, seconds. rest / X are Float64Array(n*3); tris Int32Array(m*3) in pattern winding.
// CLOTHING c2 (K1) additions, all opt-in (without these options the solver is byte-identical to c1; stack_test.mjs c1 checks it):
//   metric / grain   a flat-pattern rest metric per triangle (sewn panels: lengths and areas from the 2D pattern, warp from its grain)
//   fabs / triFab    a fabric per triangle (a garment with a lining or rib cuffs; several garments solved together in a joint settle)
//   stitch()         zero-length (or short) distance constraints between seam pairs, compliance ramped by the caller (sew.js)
//   selfTri          point-triangle and edge-edge self-collision between non-adjacent cloth, per-particle half-thickness, with side memory
//                    (a pair is pushed back to the side it was on when found, so a fast crossing is undone, not completed); selfTriLayers
//                    limits it to pairs from different layers (layers.js joint settle); selfTriOrder takes each pair's side from the
//                    layer order and the winding (outward) instead of the side found, so a crossing that happened unseen is undone;
//                    selfTriVis (Uint8Array n) leaves out pairs whose outer element is not drawn cloth (the margin past a shader cut). Bridson, Fedkiw, Anderson, "Robust treatment of
//                    collisions, contact and friction for cloth animation" (SIGGRAPH 2002) for the proximity tests; no CCD (substeps are small).
export const XPBD_VERSION = 1;
const G0 = [0, -9.81, 0];

// edges and hinges of a triangle mesh: E[2e], wing[2e] (-1 on a boundary), bad: edges shared by more than two triangles
export function topology(tris, n) {
  const map = new Map(), E = [], W = [];
  const add = (a, b, c) => { const lo = a < b ? a : b, hi = a < b ? b : a, k = lo * n + hi; let e = map.get(k);
    if (e == null) { e = E.length / 2; map.set(k, e); E.push(lo, hi); W.push(c, -1); } else if (W[e * 2 + 1] === -1) W[e * 2 + 1] = c; else W[e * 2 + 1] = -2; };
  for (let t = 0; t < tris.length; t += 3) { const a = tris[t], b = tris[t + 1], c = tris[t + 2]; add(a, b, c); add(b, c, a); add(c, a, b); }
  return { E: Int32Array.from(E), wing: Int32Array.from(W), ne: E.length / 2 };
}

const triArea = (X, a, b, c) => { const ux = X[b * 3] - X[a * 3], uy = X[b * 3 + 1] - X[a * 3 + 1], uz = X[b * 3 + 2] - X[a * 3 + 2], vx = X[c * 3] - X[a * 3], vy = X[c * 3 + 1] - X[a * 3 + 1], vz = X[c * 3 + 2] - X[a * 3 + 2];
  return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx); };

// the signed dihedral angle of the stencil (edge p3-p4, wings p1, p2) and its gradient (Bridson 2003): writes g[12] (x1 x2 x3 x4)
export function dihedral(X, i1, i2, i3, i4, g) {
  const x3x = X[i3 * 3], x3y = X[i3 * 3 + 1], x3z = X[i3 * 3 + 2], x4x = X[i4 * 3], x4y = X[i4 * 3 + 1], x4z = X[i4 * 3 + 2];
  const x1x = X[i1 * 3], x1y = X[i1 * 3 + 1], x1z = X[i1 * 3 + 2], x2x = X[i2 * 3], x2y = X[i2 * 3 + 1], x2z = X[i2 * 3 + 2];
  const ex = x4x - x3x, ey = x4y - x3y, ez = x4z - x3z, el = Math.sqrt(ex * ex + ey * ey + ez * ez);
  // N1 = (x1 - x3) x (x1 - x4), N2 = (x2 - x4) x (x2 - x3)
  const ax = x1x - x3x, ay = x1y - x3y, az = x1z - x3z, bx = x1x - x4x, by = x1y - x4y, bz = x1z - x4z;
  const n1x = ay * bz - az * by, n1y = az * bx - ax * bz, n1z = ax * by - ay * bx;
  const cx = x2x - x4x, cy = x2y - x4y, cz = x2z - x4z, dx = x2x - x3x, dy = x2y - x3y, dz = x2z - x3z;
  const n2x = cy * dz - cz * dy, n2y = cz * dx - cx * dz, n2z = cx * dy - cy * dx;
  const l1 = n1x * n1x + n1y * n1y + n1z * n1z, l2 = n2x * n2x + n2y * n2y + n2z * n2z;
  if (el < 1e-9 || l1 < 1e-18 || l2 < 1e-18) return NaN;
  const s1 = Math.sqrt(l1), s2 = Math.sqrt(l2);
  const cs = (n1x * n2x + n1y * n2y + n1z * n2z) / (s1 * s2);
  const crx = n1y * n2z - n1z * n2y, cry = n1z * n2x - n1x * n2z, crz = n1x * n2y - n1y * n2x;
  const sn = (crx * ex + cry * ey + crz * ez) / (s1 * s2 * el);
  const th = Math.atan2(sn, cs);
  if (g) { const k1 = -el / l1, k2 = -el / l2;   // d theta / dx = -u (Bridson's u_i point the other way for this sign of theta; checked by finite differences in drape_test.mjs)
    const d1 = (ax * ex + ay * ey + az * ez) / el, d2 = (dx * ex + dy * ey + dz * ez) / el, d3 = (bx * ex + by * ey + bz * ez) / el, d4 = (cx * ex + cy * ey + cz * ez) / el;
    // u1 = |E| N1/|N1|^2, u2 = |E| N2/|N2|^2, u3 = (x1-x4).E/|E| N1/|N1|^2 + (x2-x4).E/|E| N2/|N2|^2, u4 = -(x1-x3).E/|E| N1/|N1|^2 - (x2-x3).E/|E| N2/|N2|^2
    g[0] = n1x * k1; g[1] = n1y * k1; g[2] = n1z * k1; g[3] = n2x * k2; g[4] = n2y * k2; g[5] = n2z * k2;
    g[6] = -(d3 * n1x / l1 + d4 * n2x / l2); g[7] = -(d3 * n1y / l1 + d4 * n2y / l2); g[8] = -(d3 * n1z / l1 + d4 * n2z / l2);
    g[9] = d1 * n1x / l1 + d2 * n2x / l2; g[10] = d1 * n1y / l1 + d2 * n2y / l2; g[11] = d1 * n1z / l1 + d2 * n2z / l2; }
  return th;
}

// geodesic rest distance from the pinned set to every particle (Dijkstra on the edge graph); returns { dist, src }
export function geodesic(rest, E, n, pinned, elen = null) {   // elen (c2): per-edge rest lengths (a flat-pattern metric) instead of |rest_a - rest_b|
  const adj = Array.from({ length: n }, () => []);
  for (let e = 0; e < E.length; e += 2) { const a = E[e], b = E[e + 1], l = elen ? elen[e >> 1] : Math.hypot(rest[a * 3] - rest[b * 3], rest[a * 3 + 1] - rest[b * 3 + 1], rest[a * 3 + 2] - rest[b * 3 + 2]); adj[a].push(b, l); adj[b].push(a, l); }
  const dist = new Float64Array(n).fill(Infinity), src = new Int32Array(n).fill(-1), heap = [];
  const push = (d, v) => { heap.push([d, v]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  for (let v = 0; v < n; v++) if (pinned[v]) { dist[v] = 0; src[v] = v; push(0, v); }
  while (heap.length) { const [d, v] = pop(); if (d > dist[v]) continue; const A = adj[v]; for (let i = 0; i < A.length; i += 2) { const u = A[i], nd = d + A[i + 1]; if (nd < dist[u]) { dist[u] = nd; src[u] = src[v]; push(nd, u); } } }
  return { dist, src };
}

// Y(theta) of an orthotropic membrane: c = cos of the angle to the warp
const modulus = (c2, Y1, Y2, Gs, nu = 0.3) => { const s2 = 1 - c2; return 1 / (c2 * c2 / Y1 + s2 * s2 / Y2 + c2 * s2 * (1 / Gs - 2 * nu / Y1)); };

export class Cloth {
  // rest: the pattern (metres, the sim frame), X0: start positions (default rest), tris, fab: fabrics.js phys() record
  // opts: warp (Float64Array n*3 | null), pin (Uint8Array n: 1 = hard pin at X0), mass scale, compress, restAngle (number, or per particle:
  //       a hinge takes the mean of its edge's two), foldMax,
  //       bendScale, stretchScale, tether (bool), slack, gravity [3], damping (1/s), vmax (m/s), self (radius m | 0)
  constructor(rest, tris, fab, o = {}) {
    const n = rest.length / 3; this.n = n;
    const { X0 = rest, warp = null, pin = null, compress = 0.2, restAngle = 1, foldMax = 2.4, bendScale = 1, stretchScale = 1, tether = true, slack = 0.01,
      gravity = G0, damping = 6, vmax = 1.5, self = 0, selfSkip = 3, stretchIters = 2 } = o;
    Object.assign(this, { gravity, damping, vmax, selfR: self, fab, stretchIters });
    this.X = new Float64Array(X0); this.P = new Float64Array(X0); this.V = new Float64Array(n * 3); this.rest = rest;
    this.tris = tris;
    this.pin = pin || new Uint8Array(n); this._elen = null;
    if (o.metric || o.fabs) buildC2(this, rest, tris, fab, o, n);   // CLOTHING c2 (K1): a flat-pattern metric and / or a fabric per triangle (sew.js, layers.js)
    else {
      // masses: rho x a third of each triangle's area
      const M = new Float64Array(n); for (let t = 0; t < tris.length; t += 3) { const A = triArea(rest, tris[t], tris[t + 1], tris[t + 2]) / 3; M[tris[t]] += A; M[tris[t + 1]] += A; M[tris[t + 2]] += A; }
      this.W = new Float64Array(n);
      for (let i = 0; i < n; i++) { const m = Math.max(M[i] * fab.rho, 1e-7); M[i] = m; this.W[i] = this.pin[i] ? 0 : 1 / m; } this.M = M;
      const { E, wing, ne } = topology(tris, n); this.E = E;
      // edge areas (a third of the adjacent triangles) for the stretch stiffness
      const Ae = new Float64Array(ne), ekey = new Map(); for (let e = 0; e < ne; e++) ekey.set(E[e * 2] * n + E[e * 2 + 1], e);
      for (let t = 0; t < tris.length; t += 3) { const A = triArea(rest, tris[t], tris[t + 1], tris[t + 2]) / 3; for (const [a, b] of [[tris[t], tris[t + 1]], [tris[t + 1], tris[t + 2]], [tris[t + 2], tris[t]]]) { const e = ekey.get(Math.min(a, b) * n + Math.max(a, b)); Ae[e] += A; } }
      // stretch
      const [Y1, Y2] = fab.k, Gs = fab.shear, Yiso = (Y1 + modulus(0.5, Y1, Y2, Gs) + Y2) / 3, sA = [], sB = [], sL = [], sK = [];   // no grain given: the mean over warp, bias and weft
      const pushS = (a, b, L, k) => { if (L < 1e-6) return; sA.push(a); sB.push(b); sL.push(L); sK.push(k); };
      for (let e = 0; e < ne; e++) { const a = E[e * 2], b = E[e * 2 + 1], dx = rest[b * 3] - rest[a * 3], dy = rest[b * 3 + 1] - rest[a * 3 + 1], dz = rest[b * 3 + 2] - rest[a * 3 + 2], L = Math.hypot(dx, dy, dz);
        let c2 = 0.5; if (warp) { let wx = warp[a * 3] + warp[b * 3], wy = warp[a * 3 + 1] + warp[b * 3 + 1], wz = warp[a * 3 + 2] + warp[b * 3 + 2]; const wl = Math.hypot(wx, wy, wz); if (wl > 1e-9 && L > 0) { const c = (dx * wx + dy * wy + dz * wz) / (wl * L); c2 = c * c; } }
        const Y = warp ? modulus(c2, Y1, Y2, Gs) : Yiso;
        pushS(a, b, L, 3 * Y * Math.max(Ae[e], 1e-9) / (L * L) * stretchScale); }
      // bending, and folds held by distance
      const bI = [], bT = [], bK = [], g = new Float64Array(12); let folds = 0;
      for (let e = 0; e < ne; e++) { const w1 = wing[e * 2], w2 = wing[e * 2 + 1]; if (w1 < 0 || w2 < 0) continue; const a = E[e * 2], b = E[e * 2 + 1];
        const A1 = triArea(rest, w1, a, b), A2 = triArea(rest, w2, a, b); if (A1 < 1e-10 || A2 < 1e-10) continue;
        const th = dihedral(rest, w1, w2, a, b, null); if (!Number.isFinite(th)) continue;
        if (Math.abs(th) > foldMax) { const L = Math.hypot(rest[w1 * 3] - rest[w2 * 3], rest[w1 * 3 + 1] - rest[w2 * 3 + 1], rest[w1 * 3 + 2] - rest[w2 * 3 + 2]); pushS(w1, w2, L, Y1 * (A1 + A2) / Math.max(L * L, 1e-8)); folds++; continue; }
        const el2 = (rest[a * 3] - rest[b * 3]) ** 2 + (rest[a * 3 + 1] - rest[b * 3 + 1]) ** 2 + (rest[a * 3 + 2] - rest[b * 3 + 2]) ** 2;
        bI.push(w1, w2, a, b); bT.push(th * (typeof restAngle === 'number' ? restAngle : (restAngle[a] + restAngle[b]) / 2)); bK.push(1.5 * fab.B * bendScale * el2 / (A1 + A2)); }
      this.sA = Int32Array.from(sA); this.sB = Int32Array.from(sB); this.sL = Float64Array.from(sL); this.sAl = Float64Array.from(sK, k => 1 / k); this.compress = compress;
      this.bI = Int32Array.from(bI); this.bT = Float64Array.from(bT); this.bAl = Float64Array.from(bK, k => 1 / k); this.folds = folds; this._g = g;
    }
    // long range attachments to the nearest pin (geodesic on the pattern)
    this.tV = new Int32Array(0); this.tP = new Int32Array(0); this.tL = new Float64Array(0);
    this._dist = null;
    if (this.pin.some(Boolean)) { const { dist, src } = geodesic(rest, this.E, n, this.pin, this._elen), tv = [], tp = [], tl = []; this._dist = dist; if (tether) {
      for (let i = 0; i < n; i++) if (!this.pin[i] && src[i] >= 0 && Number.isFinite(dist[i])) { tv.push(i); tp.push(src[i]); tl.push(dist[i] * (1 + slack)); }
      this.tV = Int32Array.from(tv); this.tP = Int32Array.from(tp); this.tL = Float64Array.from(tl); } }
    // stretch constraints in order of their distance from the pins (Gauss-Seidel then carries the support from where the garment is
    // held down through the whole garment in one sweep, instead of a few edges per substep)
    // (c2: a component no pin reaches has distance Infinity, and Infinity - Infinity is NaN, which scrambles the whole sort: keyed instead)
    if (this._dist) { const D = this._dist, kq = (o.metric || o.fabs) ? Float64Array.from(this.sL.keys(), c => { const d = Math.min(D[this.sA[c]], D[this.sB[c]]); return Number.isFinite(d) ? d : 1e9; }) : null;
      const ord = kq ? Array.from(this.sL.keys()).sort((p, q) => kq[p] - kq[q] || p - q) : Array.from(this.sL.keys()).sort((p, q) => Math.min(D[this.sA[p]], D[this.sB[p]]) - Math.min(D[this.sA[q]], D[this.sB[q]]));
      this.sA = Int32Array.from(ord, c => this.sA[c]); this.sB = Int32Array.from(ord, c => this.sB[c]); this.sL = Float64Array.from(ord, c => this.sL[c]); this.sAl = Float64Array.from(ord, c => this.sAl[c]); }
    this._lam = new Float64Array(this.sL.length);
    // soft attachments: [particle, target xyz, compliance]
    this.aV = new Int32Array(0); this.aX = new Float64Array(0); this.aAl = new Float64Array(0);
    // self contact: pattern distance per pair is checked against selfSkip x radius
    this.selfSkip = selfSkip; this._pairs = null;
    this.stats = { stretch: this.sA.length, bend: this.bT.length, folds: this.folds, tethers: this.tV.length, substeps: 0, iterations: 1 };
    // CLOTHING c2 (K1): stitches and triangle self-collision, both off unless asked for (stitch(), selfTri)
    this.stA = new Int32Array(0); this.stB = new Int32Array(0); this.stL = new Float64Array(0); this.stAl = new Float64Array(0);
    this.triTh = o.selfTri ? (typeof o.selfTri === 'number' ? new Float64Array(n).fill(o.selfTri) : Float64Array.from(o.selfTri)) : null; this.triEvery = o.selfTriEvery ?? 8; this.triEE = o.selfTriEE ?? true; this.triLayers = o.selfTriLayers || null; this.triOrder = !!o.selfTriOrder; this.triVis = o.selfTriVis || null; this.triMaxPush = o.selfTriMaxPush ?? 0.001; this.triSame = !!o.selfTriSame; this.triLast = !!o.selfTriLast;   // CLOTH5 (opt-in selfTriLast): the self projection again AFTER the body contacts (a pinched fold keeps its layer order and sinks into the culled body instead of through itself)   // CLOTH5 (opt-in selfTriSame): with selfTriLayers, a layer's own pairs too (side found, not the order) this._tp = null; this._ep = null; this._nbr = null;
  }
  // CARRY (round 3b, opt-in): soft PLANE holds [{ i, x: [3], n: [3] (unit), alpha }]: the particle is held on the plane through x normal to
  // n (free to slide in it): a cuff kept at the wrist's height along the forearm, free to turn round the wrist and to sit on it
  attachPlane(list) { this.qV = Int32Array.from(list.map(a => a.i)); this.qX = Float64Array.from(list.flatMap(a => a.x)); this.qN = Float64Array.from(list.flatMap(a => a.n)); this.qAl = Float64Array.from(list.map(a => a.alpha ?? 1e-6)); }
  attach(list) {   // [{ i, x: [3], alpha }] soft pins (alpha = compliance, m/N)
    this.aV = Int32Array.from(list.map(a => a.i)); this.aX = Float64Array.from(list.flatMap(a => a.x)); this.aAl = Float64Array.from(list.map(a => a.alpha ?? 1e-6)); this.stats.attach = list.length; }

  // run T seconds at hz substeps per second; contacts: collide.js Contacts (or null), refresh every `every` substeps
  run(T, { hz = 1200, contacts = null, every = 12, selfEvery = 24, onStep = null } = {}) {
    const h = 1 / hz, N = Math.max(1, Math.round(T * hz)), n = this.n, X = this.X, P = this.P, V = this.V, W = this.W, gx = this.gravity[0] * h, gy = this.gravity[1] * h, gz = this.gravity[2] * h;
    const decay = Math.exp(-this.damping * h), vmax = this.vmax, ih2 = 1 / (h * h);
    const sA = this.sA, sB = this.sB, sL = this.sL, sAl = this.sAl, cmp = this.compress, ns = sA.length, lam = this._lam, sIt = this.stretchIters;
    const bI = this.bI, bT = this.bT, bAl = this.bAl, nb = bT.length, g = this._g;
    const tV = this.tV, tP = this.tP, tL = this.tL, nt = tV.length, aV = this.aV, aX = this.aX, aAl = this.aAl, na = aV.length;
    if (contacts) { contacts.refresh(X); contacts.project(X, X, W, 0); P.set(X); }
    for (let step = 0; step < N; step++) {
      for (let i = 0; i < n; i++) { const i3 = i * 3; P[i3] = X[i3]; P[i3 + 1] = X[i3 + 1]; P[i3 + 2] = X[i3 + 2]; if (W[i] === 0) continue; V[i3] += gx; V[i3 + 1] += gy; V[i3 + 2] += gz; X[i3] += V[i3] * h; X[i3 + 1] += V[i3 + 1] * h; X[i3 + 2] += V[i3 + 2] * h; }
      // stretch: stretchIters XPBD iterations (lambda accumulated within the substep): a woven is near inextensible, and one
      // iteration per substep leaves it as stiff as m / h^2 allows, not as the fabric (the hung square in drape_test.mjs)
      lam.fill(0);
      for (let it = 0; it < sIt; it++) for (let c = 0; c < ns; c++) { const a = sA[c], b = sB[c], wa = W[a], wb = W[b], ws = wa + wb; if (ws === 0) continue; const a3 = a * 3, b3 = b * 3;
        const dx = X[b3] - X[a3], dy = X[b3 + 1] - X[a3 + 1], dz = X[b3 + 2] - X[a3 + 2], d = Math.sqrt(dx * dx + dy * dy + dz * dz); if (d < 1e-12) continue;
        const C = d - sL[c], al = (C < 0 ? sAl[c] / cmp : sAl[c]) * ih2, dlam = (-C - al * lam[c]) / (ws + al), dl = dlam / d; lam[c] += dlam;
        X[a3] -= wa * dl * dx; X[a3 + 1] -= wa * dl * dy; X[a3 + 2] -= wa * dl * dz; X[b3] += wb * dl * dx; X[b3 + 1] += wb * dl * dy; X[b3 + 2] += wb * dl * dz; }
      // bending
      for (let c = 0; c < nb; c++) { const i1 = bI[c * 4], i2 = bI[c * 4 + 1], i3 = bI[c * 4 + 2], i4 = bI[c * 4 + 3], w1 = W[i1], w2 = W[i2], w3 = W[i3], w4 = W[i4]; if (w1 + w2 + w3 + w4 === 0) continue;
        const th = dihedral(X, i1, i2, i3, i4, g); if (th !== th) continue;
        let C = th - bT[c]; if (C > Math.PI) C -= 2 * Math.PI; else if (C < -Math.PI) C += 2 * Math.PI;
        const s = w1 * (g[0] * g[0] + g[1] * g[1] + g[2] * g[2]) + w2 * (g[3] * g[3] + g[4] * g[4] + g[5] * g[5]) + w3 * (g[6] * g[6] + g[7] * g[7] + g[8] * g[8]) + w4 * (g[9] * g[9] + g[10] * g[10] + g[11] * g[11]);
        const dl = -C / (s + bAl[c] * ih2); if (!(Math.abs(dl) < 1e3)) continue;
        X[i1 * 3] += w1 * g[0] * dl; X[i1 * 3 + 1] += w1 * g[1] * dl; X[i1 * 3 + 2] += w1 * g[2] * dl; X[i2 * 3] += w2 * g[3] * dl; X[i2 * 3 + 1] += w2 * g[4] * dl; X[i2 * 3 + 2] += w2 * g[5] * dl;
        X[i3 * 3] += w3 * g[6] * dl; X[i3 * 3 + 1] += w3 * g[7] * dl; X[i3 * 3 + 2] += w3 * g[8] * dl; X[i4 * 3] += w4 * g[9] * dl; X[i4 * 3 + 1] += w4 * g[10] * dl; X[i4 * 3 + 2] += w4 * g[11] * dl; }
      // long range attachments (unilateral: only when farther than the geodesic rest distance)
      for (let c = 0; c < nt; c++) { const v = tV[c], p = tP[c], v3 = v * 3, p3 = p * 3, dx = X[v3] - X[p3], dy = X[v3 + 1] - X[p3 + 1], dz = X[v3 + 2] - X[p3 + 2], d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d <= tL[c]) continue; const k = (d - tL[c]) / d; X[v3] -= dx * k; X[v3 + 1] -= dy * k; X[v3 + 2] -= dz * k; }
      // soft attachments
      for (let c = 0; c < na; c++) { const v = aV[c], w = W[v]; if (w === 0) continue; const v3 = v * 3, dl = 1 / (w + aAl[c] * ih2);
        X[v3] += (aX[c * 3] - X[v3]) * w * dl; X[v3 + 1] += (aX[c * 3 + 1] - X[v3 + 1]) * w * dl; X[v3 + 2] += (aX[c * 3 + 2] - X[v3 + 2]) * w * dl; }
      if (this.qV) { const qV = this.qV, qX = this.qX, qN = this.qN, qAl = this.qAl; for (let c = 0; c < qV.length; c++) { const v = qV[c], w = W[v]; if (w === 0) continue; const v3 = v * 3, c3 = c * 3;
          const d = (X[v3] - qX[c3]) * qN[c3] + (X[v3 + 1] - qX[c3 + 1]) * qN[c3 + 1] + (X[v3 + 2] - qX[c3 + 2]) * qN[c3 + 2], k = d * w / (w + qAl[c] * ih2); X[v3] -= qN[c3] * k; X[v3 + 1] -= qN[c3 + 1] * k; X[v3 + 2] -= qN[c3 + 2] * k; } }
      // stitches (c2, sew.js): seam pairs pulled together
      if (this.stA.length) this._stitchProject(ih2);
      // self contact, then the body and the layers under it
      if (this.selfR > 0) { if (step % selfEvery === 0) this._selfPairs(); this._selfProject(); }
      if (this.triTh) { if (step % this.triEvery === 0) this._triPairs(); this._triProject(); }   // c2: point-triangle and edge-edge self-collision
      if (this.c6) this.c6.pre(step, X, P);   // CLOTH6 (opt-in cl.c6, cloth6/self6.js): self-collision with locked sides and a continuous check
      if (contacts) { if (step % every === 0) contacts.refresh(X); contacts.project(X, P, W, h); }
      if (this.triTh && this.triLast) this._triProject();
      if (this.c6) this.c6.post(X, P);
      for (let i = 0; i < n; i++) { const i3 = i * 3; if (W[i] === 0) { V[i3] = V[i3 + 1] = V[i3 + 2] = 0; continue; }
        let vx = (X[i3] - P[i3]) / h * decay, vy = (X[i3 + 1] - P[i3 + 1]) / h * decay, vz = (X[i3 + 2] - P[i3 + 2]) / h * decay; const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (sp > vmax) { const k = vmax / sp; vx *= k; vy *= k; vz *= k; } V[i3] = vx; V[i3 + 1] = vy; V[i3 + 2] = vz; }
      if (onStep) onStep(step);
    }
    this.stats.substeps += N; this.stats.hz = hz;
    return this;
  }
  // ---------------------------------------------------------------- CLOTHING c2 (K1): stitches and triangle self-collision
  // stitches: pairs [a0, b0, a1, b1, ...] held at rest length L (0 = sewn edge to edge) with compliance alpha (m/N). Call again with a
  // smaller alpha to tighten (the sewing ramp in sew.js); stitch([]) removes them.
  stitch(pairs, { alpha = 1e-6, L = 0 } = {}) {
    const k = pairs.length >> 1; this.stA = new Int32Array(k); this.stB = new Int32Array(k);
    for (let i = 0; i < k; i++) { this.stA[i] = pairs[i * 2]; this.stB[i] = pairs[i * 2 + 1]; }
    this.stL = typeof L === 'number' ? new Float64Array(k).fill(L) : Float64Array.from(L); this.stAl = new Float64Array(k).fill(alpha); this.stats.stitches = k; return this; }
  _stitchProject(ih2) {
    const X = this.X, W = this.W, A = this.stA, B = this.stB, L = this.stL, Al = this.stAl;
    for (let c = 0; c < A.length; c++) { const a = A[c], b = B[c], wa = W[a], wb = W[b], ws = wa + wb; if (ws === 0) continue; const a3 = a * 3, b3 = b * 3;
      const dx = X[b3] - X[a3], dy = X[b3 + 1] - X[a3 + 1], dz = X[b3 + 2] - X[a3 + 2], d = Math.sqrt(dx * dx + dy * dy + dz * dz); if (d < 1e-9) continue;
      const C = d - L[c], dl = -C / (ws + Al[c] * ih2) / d;
      X[a3] -= wa * dl * dx; X[a3 + 1] -= wa * dl * dy; X[a3 + 2] -= wa * dl * dz; X[b3] += wb * dl * dx; X[b3 + 1] += wb * dl * dy; X[b3 + 2] += wb * dl * dz; }
  }
  // the 1-ring of every particle (CSR), for "non-adjacent" in the self-collision
  _ring() { if (this._nbr) return; const n = this.n, E = this.E, cnt = new Int32Array(n + 1);
    for (let e = 0; e < E.length; e++) cnt[E[e] + 1]++; for (let i = 0; i < n; i++) cnt[i + 1] += cnt[i];
    const nb = new Int32Array(cnt[n]), fill = cnt.slice(0, n); for (let e = 0; e < E.length; e += 2) { const a = E[e], b = E[e + 1]; nb[fill[a]++] = b; nb[fill[b]++] = a; }
    this._nbo = cnt; this._nbr = nb; this._mark = new Int32Array(n).fill(-1); }
  // candidate pairs within reach now: point-triangle (particle not in the triangle and not in the 1-ring of its corners) and edge-edge
  // (no shared particle and no corner of one in the 1-ring of the other); each with the side it is on now (the side memory: a pair that
  // has crossed by the next substep is pushed back to the side it came from, not through). opts.selfTriLayers (Uint8Array n): only pairs
  // between different layers (a joint settle of several garments: each garment's own folds are its particle self contact).
  _triPairs() {
    this._ring(); const n = this.n, X = this.X, T = this.tris, m = T.length / 3, th = this.triTh, LY = this.triLayers || null, nbo = this._nbo, nbr = this._nbr, mark = this._mark;
    let thMax = 0; for (let i = 0; i < n; i++) if (th[i] > thMax) thMax = th[i];
    const R = 2 * thMax + Math.max(0.004, 1.5 * this.vmax * this.triEvery / (this.stats.hz || 900)), cell = 0.025, ic = 1 / cell, key = (i, j, k) => ((i + 4096) * 8192 + (j + 4096)) * 8192 + (k + 4096), H = new Map();
    for (let t = 0; t < m; t++) { const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
      const k = key(Math.floor((X[a * 3] + X[b * 3] + X[c * 3]) / 3 * ic), Math.floor((X[a * 3 + 1] + X[b * 3 + 1] + X[c * 3 + 1]) / 3 * ic), Math.floor((X[a * 3 + 2] + X[b * 3 + 2] + X[c * 3 + 2]) / 3 * ic));
      const L = H.get(k); if (L) L.push(t); else H.set(k, [t]); }
    // selfTriOrder (layers): the side is the layer order, not the side found now: a particle of an outer layer belongs on the outward
    // (winding) side of an inner layer's triangle and vice versa, so a pair that crossed before it was found is still pushed back out
    const VIS = this.triVis, ORD = this.triOrder && LY, VN = ORD && this.triEE ? vNormals(X, T, n) : null;
    const tp = [], ts = [], q = [0, 0, 0, 0, 0, 0];
    for (let p = 0; p < n; p++) { if (LY == null && this.W[p] === 0) { /* a pinned particle can still be hit: keep it */ }
      const x = X[p * 3], y = X[p * 3 + 1], z = X[p * 3 + 2], ci = Math.floor(x * ic), cj = Math.floor(y * ic), ck = Math.floor(z * ic);
      mark[p] = p; for (let j = nbo[p]; j < nbo[p + 1]; j++) mark[nbr[j]] = p;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) { const L = H.get(key(ci + a, cj + b, ck + c)); if (!L) continue;
        for (let li = 0; li < L.length; li++) { const t = L[li], i0 = T[t * 3], i1 = T[t * 3 + 1], i2 = T[t * 3 + 2];
          if (mark[i0] === p || mark[i1] === p || mark[i2] === p) continue; if (LY && LY[i0] === LY[p] && !this.triSame) continue;
          if (VIS && (LY && LY[p] > LY[i0] ? !VIS[p] : !(VIS[i0] && VIS[i1] && VIS[i2]))) continue;   // the outer of the two must be drawn cloth
          if (this.W[p] === 0 || (this.W[i0] === 0 && this.W[i1] === 0 && this.W[i2] === 0)) continue;   // a pinned particle (or triangle) is not pushed: the other side would take the whole push
          ptTri(X, x, y, z, i0, i1, i2, q); const dx = x - q[0], dy = y - q[1], dz = z - q[2]; if (dx * dx + dy * dy + dz * dz > R * R) continue;
          const nn = triNormal(X, i0, i1, i2); if (!nn) continue; const s = ORD && LY[p] !== LY[i0] ? (LY[p] > LY[i0] ? 1 : -1) : dx * nn[0] + dy * nn[1] + dz * nn[2];
          tp.push(p, t); ts.push(s >= 0 ? 1 : -1); } } }
    this._tp = Int32Array.from(tp); this._ts = Int8Array.from(ts);
    // edge-edge: edges hashed by their midpoints
    if (this.triEE) { const E = this.E, ne = E.length / 2, HE = new Map();
      for (let e = 0; e < ne; e++) { const a = E[e * 2], b = E[e * 2 + 1], k = key(Math.floor((X[a * 3] + X[b * 3]) / 2 * ic), Math.floor((X[a * 3 + 1] + X[b * 3 + 1]) / 2 * ic), Math.floor((X[a * 3 + 2] + X[b * 3 + 2]) / 2 * ic)); const L = HE.get(k); if (L) L.push(e); else HE.set(k, [e]); }
      const ep = [], en = [], r = [0, 0, 0, 0, 0, 0, 0, 0];
      for (let e = 0; e < ne; e++) { const a = E[e * 2], b = E[e * 2 + 1], ci = Math.floor((X[a * 3] + X[b * 3]) / 2 * ic), cj = Math.floor((X[a * 3 + 1] + X[b * 3 + 1]) / 2 * ic), ck = Math.floor((X[a * 3 + 2] + X[b * 3 + 2]) / 2 * ic);
        const tag = -2 - e; mark[a] = tag; mark[b] = tag; for (let j = nbo[a]; j < nbo[a + 1]; j++) mark[nbr[j]] = tag; for (let j = nbo[b]; j < nbo[b + 1]; j++) mark[nbr[j]] = tag;
        for (let u = -1; u <= 1; u++) for (let v = -1; v <= 1; v++) for (let w = -1; w <= 1; w++) { const L = HE.get(key(ci + u, cj + v, ck + w)); if (!L) continue;
          for (let li = 0; li < L.length; li++) { const f = L[li]; if (f <= e) continue; const c = E[f * 2], d = E[f * 2 + 1]; if (mark[c] === tag || mark[d] === tag) continue; if (LY && LY[c] === LY[a] && !this.triSame) continue;
            if (this.W[a] + this.W[b] === 0 || this.W[c] + this.W[d] === 0) continue; if (VIS && LY && (LY[a] > LY[c] ? !(VIS[a] && VIS[b]) : !(VIS[c] && VIS[d]))) continue;
            segSeg(X, a, b, c, d, r); const dx = r[0] - r[3], dy = r[1] - r[4], dz = r[2] - r[5], dd = Math.sqrt(dx * dx + dy * dy + dz * dz); if (dd > R || dd < 1e-9) continue;
            if (r[6] <= 1e-6 || r[6] >= 1 - 1e-6 || r[7] <= 1e-6 || r[7] >= 1 - 1e-6) continue;   // an end point: the point-triangle test has it
            if (VN && LY[a] !== LY[c]) { const io = LY[a] > LY[c], u = io ? c : a, w = io ? d : b, sg = io ? 1 : -1; let nx = VN[u * 3] + VN[w * 3], ny = VN[u * 3 + 1] + VN[w * 3 + 1], nz = VN[u * 3 + 2] + VN[w * 3 + 2]; const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
              ep.push(e, f); en.push(sg * nx / nl, sg * ny / nl, sg * nz / nl); continue; }
            ep.push(e, f); en.push(dx / dd, dy / dd, dz / dd); } } }
      this._ep = Int32Array.from(ep); this._en = Float64Array.from(en); }
    for (let i = 0; i < n; i++) mark[i] = -1;
    this.stats.triPairs = this._tp.length / 2; this.stats.edgePairs = this._ep ? this._ep.length / 2 : 0;
  }
  _triProject() {
    const X = this.X, W = this.W, T = this.tris, th = this.triTh, P = this._tp, S = this._ts, q = [0, 0, 0, 0, 0, 0];
    if (P) for (let k = 0; k < P.length; k += 2) { const p = P[k], t = P[k + 1], i0 = T[t * 3], i1 = T[t * 3 + 1], i2 = T[t * 3 + 2];
      const x = X[p * 3], y = X[p * 3 + 1], z = X[p * 3 + 2]; if (!planeBary(X, x, y, z, i0, i1, i2, q)) continue; const nn = _tn;   // over the face only (edges: edge-edge)
      const s = S[k >> 1], nx = nn[0] * s, ny = nn[1] * s, nz = nn[2] * s, d = (x - q[0]) * nx + (y - q[1]) * ny + (z - q[2]) * nz, gap = th[p] + (th[i0] + th[i1] + th[i2]) / 3;
      if (d >= gap) continue; const u = q[3], v = q[4], w = q[5], den = W[p] + u * u * W[i0] + v * v * W[i1] + w * w * W[i2]; if (den <= 0) continue; const l = Math.min(gap - d, this.triMaxPush) / den;
      X[p * 3] += W[p] * l * nx; X[p * 3 + 1] += W[p] * l * ny; X[p * 3 + 2] += W[p] * l * nz;
      for (const [i, b] of [[i0, u], [i1, v], [i2, w]]) { const f = b * W[i] * l; X[i * 3] -= f * nx; X[i * 3 + 1] -= f * ny; X[i * 3 + 2] -= f * nz; } }
    const EP = this._ep, EN = this._en, E = this.E, r = [0, 0, 0, 0, 0, 0, 0, 0];
    if (EP) for (let k = 0; k < EP.length; k += 2) { const e = EP[k], f = EP[k + 1], a = E[e * 2], b = E[e * 2 + 1], c = E[f * 2], d = E[f * 2 + 1];
      segSeg(X, a, b, c, d, r); const nx = EN[k / 2 * 3], ny = EN[k / 2 * 3 + 1], nz = EN[k / 2 * 3 + 2], ex = r[0] - r[3], ey = r[1] - r[4], ez = r[2] - r[5], dn = ex * nx + ey * ny + ez * nz, gap = (th[a] + th[b] + th[c] + th[d]) / 2;
      if (dn >= gap) continue; if (this.triOrder && ex * ex + ey * ey + ez * ez - dn * dn > (0.0005 + 0.3 * Math.abs(dn)) ** 2) continue;   // ordered sides: only stacked edges
      const s = r[6], t = r[7], den = (1 - s) * (1 - s) * W[a] + s * s * W[b] + (1 - t) * (1 - t) * W[c] + t * t * W[d]; if (den <= 0) continue; const l = Math.min(gap - dn, this.triMaxPush) / den;
      for (const [i, wt] of [[a, (1 - s)], [b, s]]) { const g = wt * W[i] * l; X[i * 3] += g * nx; X[i * 3 + 1] += g * ny; X[i * 3 + 2] += g * nz; }
      for (const [i, wt] of [[c, (1 - t)], [d, t]]) { const g = wt * W[i] * l; X[i * 3] -= g * nx; X[i * 3 + 1] -= g * ny; X[i * 3 + 2] -= g * nz; } }
  }
  // particle pairs within 2 r now that are farther apart than selfSkip x r on the pattern (a spatial hash on the current positions)
  _selfPairs() {
    const n = this.n, X = this.X, R = this.rest, r = this.selfR, cs = 2 * r, inv = 1 / cs, cells = new Map(), pairs = [], skip2 = (this.selfSkip * r) ** 2, near2 = (2 * r) ** 2;
    for (let i = 0; i < n; i++) { const k = `${Math.floor(X[i * 3] * inv)},${Math.floor(X[i * 3 + 1] * inv)},${Math.floor(X[i * 3 + 2] * inv)}`; (cells.get(k) || cells.set(k, []).get(k)).push(i); }
    for (let i = 0; i < n; i++) { const cx = Math.floor(X[i * 3] * inv), cy = Math.floor(X[i * 3 + 1] * inv), cz = Math.floor(X[i * 3 + 2] * inv);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) { const L = cells.get(`${cx + a},${cy + b},${cz + c}`); if (!L) continue;
        for (const j of L) { if (j <= i) continue; const dx = X[j * 3] - X[i * 3], dy = X[j * 3 + 1] - X[i * 3 + 1], dz = X[j * 3 + 2] - X[i * 3 + 2]; if (dx * dx + dy * dy + dz * dz > near2) continue;
          const rx = R[j * 3] - R[i * 3], ry = R[j * 3 + 1] - R[i * 3 + 1], rz = R[j * 3 + 2] - R[i * 3 + 2]; if (rx * rx + ry * ry + rz * rz < skip2) continue; pairs.push(i, j); } } }
    this._pairs = Int32Array.from(pairs);
  }
  _selfProject() {
    const pr = this._pairs; if (!pr) return; const X = this.X, W = this.W, r = this.selfR;
    for (let k = 0; k < pr.length; k += 2) { const i = pr[k], j = pr[k + 1], wi = W[i], wj = W[j], ws = wi + wj; if (ws === 0) continue;
      const dx = X[j * 3] - X[i * 3], dy = X[j * 3 + 1] - X[i * 3 + 1], dz = X[j * 3 + 2] - X[i * 3 + 2], d = Math.sqrt(dx * dx + dy * dy + dz * dz); if (d >= r || d < 1e-9) continue;
      const s = (r - d) / d / ws; X[i * 3] -= dx * s * wi; X[i * 3 + 1] -= dy * s * wi; X[i * 3 + 2] -= dz * s * wi; X[j * 3] += dx * s * wj; X[j * 3 + 1] += dy * s * wj; X[j * 3 + 2] += dz * s * wj; }
  }
  // strain per stretch constraint (length / rest - 1): { mean, max, p95 } of the positive part, in per cent (free: skip edges between two pins)
  // maxL: the max over edges at least minL long at rest (a sliver edge of 0.3 mm drawn to 2 mm is 500 % and nothing to see)
  strain(free = false, minL = 0.004) { const X = this.X, out = []; let s = 0, mx = 0, mxL = 0;
    for (let c = 0; c < this.sA.length; c++) { const a = this.sA[c], b = this.sB[c]; if (free && this.W[a] === 0 && this.W[b] === 0) continue; const d = Math.hypot(X[b * 3] - X[a * 3], X[b * 3 + 1] - X[a * 3 + 1], X[b * 3 + 2] - X[a * 3 + 2]), e = Math.max(0, d / this.sL[c] - 1); out.push(e); s += e; mx = Math.max(mx, e); if (this.sL[c] >= minL) mxL = Math.max(mxL, e); }
    out.sort((a, b) => a - b); return { mean: 100 * s / Math.max(1, out.length), max: 100 * mx, maxL: 100 * mxL, p95: 100 * (out[Math.floor(out.length * 0.95)] || 0), p99: 100 * (out[Math.floor(out.length * 0.99)] || 0) }; }
}

// ---------------------------------------------------------------- CLOTHING c2 (K1) helpers
// the constructor's masses, stretch and bending when a flat-pattern METRIC (o.metric: Float64Array(m*6), each triangle's corners in the
// flat panel, metres; o.grain: Float64Array(m*2), the warp in that frame) and / or a FABRIC PER TRIANGLE (o.fabs: [phys records],
// o.triFab: Uint8Array(m) index) is given. Rest lengths and areas come from the metric (a sewn garment keeps its panels' lengths, so
// darts and ease are in the cloth, not in its starting shape); rest dihedrals still come from the 3D `rest` x restAngle (the sewn shape).
// An edge on a seam (two panels) takes the mean of its two lengths; its stiffness the area-weighted mean of its triangles' moduli.
function buildC2(cl, rest, tris, fab, o, n) {
  const { warp = null, compress = 0.2, restAngle = 1, foldMax = 2.4, bendScale = 1, stretchScale = 1 } = o, MET = o.metric || null, GR = o.grain || null, FABS = o.fabs || [fab], TF = o.triFab || null, m = tris.length / 3;
  const fOf = t => FABS[TF ? TF[t] : 0], TA = new Float64Array(m);
  for (let t = 0; t < m; t++) TA[t] = MET ? Math.abs((MET[t * 6 + 2] - MET[t * 6]) * (MET[t * 6 + 5] - MET[t * 6 + 1]) - (MET[t * 6 + 4] - MET[t * 6]) * (MET[t * 6 + 3] - MET[t * 6 + 1])) / 2 : triArea(rest, tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]);
  const M = new Float64Array(n); for (let t = 0; t < m; t++) { const A = TA[t] / 3 * fOf(t).rho; M[tris[t * 3]] += A; M[tris[t * 3 + 1]] += A; M[tris[t * 3 + 2]] += A; }
  cl.W = new Float64Array(n); for (let i = 0; i < n; i++) { const mm = Math.max(M[i], 1e-7); M[i] = mm; cl.W[i] = cl.pin[i] ? 0 : 1 / mm; } cl.M = M;
  const { E, wing, ne } = topology(tris, n); cl.E = E; const ekey = new Map(); for (let e = 0; e < ne; e++) ekey.set(E[e * 2] * n + E[e * 2 + 1], e);
  const Ls = new Float64Array(ne), Lc = new Float64Array(ne), Ae = new Float64Array(ne), Yw = new Float64Array(ne), Aw = new Float64Array(ne), et1 = new Int32Array(ne).fill(-1), et2 = new Int32Array(ne).fill(-1);
  const Yiso = F => (F.k[0] + modulus(0.5, F.k[0], F.k[1], F.shear) + F.k[1]) / 3;
  for (let t = 0; t < m; t++) for (let k = 0; k < 3; k++) { const ka = k, kb = (k + 1) % 3, a = tris[t * 3 + ka], b = tris[t * 3 + kb], e = ekey.get(Math.min(a, b) * n + Math.max(a, b));
    let L, c2 = 0.5;
    if (MET) { const du = MET[t * 6 + kb * 2] - MET[t * 6 + ka * 2], dv = MET[t * 6 + kb * 2 + 1] - MET[t * 6 + ka * 2 + 1]; L = Math.hypot(du, dv); if (GR && L > 0) { const c = (du * GR[t * 2] + dv * GR[t * 2 + 1]) / L; c2 = c * c; } }
    else { const dx = rest[b * 3] - rest[a * 3], dy = rest[b * 3 + 1] - rest[a * 3 + 1], dz = rest[b * 3 + 2] - rest[a * 3 + 2]; L = Math.hypot(dx, dy, dz);
      if (warp) { const wx = warp[a * 3] + warp[b * 3], wy = warp[a * 3 + 1] + warp[b * 3 + 1], wz = warp[a * 3 + 2] + warp[b * 3 + 2], wl = Math.hypot(wx, wy, wz); if (wl > 1e-9 && L > 0) { const c = (dx * wx + dy * wy + dz * wz) / (wl * L); c2 = c * c; } } }
    const F = fOf(t), Y = (MET ? GR : warp) ? modulus(c2, F.k[0], F.k[1], F.shear) : Yiso(F);
    Ls[e] += L; Lc[e]++; Ae[e] += TA[t] / 3; Yw[e] += Y * TA[t]; Aw[e] += TA[t]; if (et1[e] < 0) et1[e] = t; else et2[e] = t; }
  const elen = new Float64Array(ne); for (let e = 0; e < ne; e++) elen[e] = Lc[e] ? Ls[e] / Lc[e] : 0; cl._elen = elen;
  const sA = [], sB = [], sL = [], sK = [], pushS = (a, b, L, k) => { if (L < 1e-6) return; sA.push(a); sB.push(b); sL.push(L); sK.push(k); };
  for (let e = 0; e < ne; e++) { const L = elen[e], Y = Aw[e] > 0 ? Yw[e] / Aw[e] : Yiso(fab); pushS(E[e * 2], E[e * 2 + 1], L, 3 * Y * Math.max(Ae[e], 1e-9) / (L * L) * stretchScale); }
  const bI = [], bT = [], bK = []; let folds = 0;
  for (let e = 0; e < ne; e++) { const w1 = wing[e * 2], w2 = wing[e * 2 + 1]; if (w1 < 0 || w2 < 0) continue; const a = E[e * 2], b = E[e * 2 + 1], t1 = et1[e], t2 = et2[e]; if (t1 < 0 || t2 < 0) continue;
    const A1 = TA[t1], A2 = TA[t2]; if (A1 < 1e-10 || A2 < 1e-10) continue;
    const th = dihedral(rest, w1, w2, a, b, null); if (!Number.isFinite(th)) continue;
    if (Math.abs(th) > foldMax) { const L = Math.hypot(rest[w1 * 3] - rest[w2 * 3], rest[w1 * 3 + 1] - rest[w2 * 3 + 1], rest[w1 * 3 + 2] - rest[w2 * 3 + 2]); pushS(w1, w2, L, fOf(t1).k[0] * (A1 + A2) / Math.max(L * L, 1e-8)); folds++; continue; }
    const B = (fOf(t1).B * A1 + fOf(t2).B * A2) / (A1 + A2);
    bI.push(w1, w2, a, b); bT.push(th * (typeof restAngle === 'number' ? restAngle : (restAngle[a] + restAngle[b]) / 2)); bK.push(1.5 * B * bendScale * elen[e] * elen[e] / (A1 + A2)); }
  cl.sA = Int32Array.from(sA); cl.sB = Int32Array.from(sB); cl.sL = Float64Array.from(sL); cl.sAl = Float64Array.from(sK, k => 1 / k); cl.compress = compress;
  cl.bI = Int32Array.from(bI); cl.bT = Float64Array.from(bT); cl.bAl = Float64Array.from(bK, k => 1 / k); cl.folds = folds; cl._g = new Float64Array(12);
}
// area-weighted vertex normals (winding = outward)
function vNormals(X, T, n) { const N = new Float64Array(n * 3); for (let t = 0; t < T.length; t += 3) { const a = T[t], b = T[t + 1], c = T[t + 2], ux = X[b * 3] - X[a * 3], uy = X[b * 3 + 1] - X[a * 3 + 1], uz = X[b * 3 + 2] - X[a * 3 + 2], vx = X[c * 3] - X[a * 3], vy = X[c * 3 + 1] - X[a * 3 + 1], vz = X[c * 3 + 2] - X[a * 3 + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; for (const v of [a, b, c]) { N[v * 3] += nx; N[v * 3 + 1] += ny; N[v * 3 + 2] += nz; } }
  for (let v = 0; v < n; v++) { const l = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) || 1; N[v * 3] /= l; N[v * 3 + 1] /= l; N[v * 3 + 2] /= l; } return N; }
// unit normal of a triangle now (null if degenerate)
const _tn = [0, 0, 0];
function triNormal(X, a, b, c) { const ux = X[b * 3] - X[a * 3], uy = X[b * 3 + 1] - X[a * 3 + 1], uz = X[b * 3 + 2] - X[a * 3 + 2], vx = X[c * 3] - X[a * 3], vy = X[c * 3 + 1] - X[a * 3 + 1], vz = X[c * 3 + 2] - X[a * 3 + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.sqrt(nx * nx + ny * ny + nz * nz); if (l < 1e-14) return null; _tn[0] = nx / l; _tn[1] = ny / l; _tn[2] = nz / l; return _tn; }
// p projected on the plane of triangle (a, b, c): out = [x, y, z, u, v, w] (barycentrics, clamped to the face); false if the projection falls
// outside the face by more than `tol` (relative) or the triangle is degenerate. Sets _tn to the unit normal (winding).
function planeBary(X, px, py, pz, ia, ib, ic, out, tol = 0.08) {
  const ax = X[ia * 3], ay = X[ia * 3 + 1], az = X[ia * 3 + 2], e1x = X[ib * 3] - ax, e1y = X[ib * 3 + 1] - ay, e1z = X[ib * 3 + 2] - az, e2x = X[ic * 3] - ax, e2y = X[ic * 3 + 1] - ay, e2z = X[ic * 3 + 2] - az;
  const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x, n2 = nx * nx + ny * ny + nz * nz; if (n2 < 1e-20) return false;
  const wx = px - ax, wy = py - ay, wz = pz - az;
  // barycentrics by the sub-triangle areas (Heidrich's projected point, JGT 2005)
  const cx = e1y * wz - e1z * wy, cy = e1z * wx - e1x * wz, cz = e1x * wy - e1y * wx, g = (cx * nx + cy * ny + cz * nz) / n2;
  const dx = wy * e2z - wz * e2y, dy = wz * e2x - wx * e2z, dz = wx * e2y - wy * e2x, b = (dx * nx + dy * ny + dz * nz) / n2, a = 1 - g - b;
  if (a < -tol || b < -tol || g < -tol) return false;
  const u = Math.max(0, a), v = Math.max(0, b), w = Math.max(0, g), sm = u + v + w, l = Math.sqrt(n2); _tn[0] = nx / l; _tn[1] = ny / l; _tn[2] = nz / l;
  out[3] = u / sm; out[4] = v / sm; out[5] = w / sm; out[0] = ax + e1x * out[4] + e2x * out[5]; out[1] = ay + e1y * out[4] + e2y * out[5]; out[2] = az + e1z * out[4] + e2z * out[5]; return true;
}
// closest point on triangle (a, b, c) to p (Ericson, Real-Time Collision Detection 5.1.5): out = [x, y, z, u, v, w]
export function ptTri(X, px, py, pz, ia, ib, ic, out) {
  const ax = X[ia * 3], ay = X[ia * 3 + 1], az = X[ia * 3 + 2], bx = X[ib * 3], by = X[ib * 3 + 1], bz = X[ib * 3 + 2], cx = X[ic * 3], cy = X[ic * 3 + 1], cz = X[ic * 3 + 2];
  const set = (u, v, w) => { out[0] = ax * u + bx * v + cx * w; out[1] = ay * u + by * v + cy * w; out[2] = az * u + bz * v + cz * w; out[3] = u; out[4] = v; out[5] = w; return out; };
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az, apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz; if (d1 <= 0 && d2 <= 0) return set(1, 0, 0);
  const bpx = px - bx, bpy = py - by, bpz = pz - bz, d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz; if (d3 >= 0 && d4 <= d3) return set(0, 1, 0);
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return set(1 - v, v, 0); }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz, d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz; if (d6 >= 0 && d5 <= d6) return set(0, 0, 1);
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return set(1 - w, 0, w); }
  const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return set(0, 1 - w, w); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; return set(1 - v - w, v, w);
}
// closest points of segments ab and cd (Ericson 5.1.9): out = [p1 xyz, p2 xyz, s, t]
export function segSeg(X, a, b, c, d, out) {
  const p1x = X[a * 3], p1y = X[a * 3 + 1], p1z = X[a * 3 + 2], q1x = X[b * 3], q1y = X[b * 3 + 1], q1z = X[b * 3 + 2], p2x = X[c * 3], p2y = X[c * 3 + 1], p2z = X[c * 3 + 2], q2x = X[d * 3], q2y = X[d * 3 + 1], q2z = X[d * 3 + 2];
  const d1x = q1x - p1x, d1y = q1y - p1y, d1z = q1z - p1z, d2x = q2x - p2x, d2y = q2y - p2y, d2z = q2z - p2z, rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
  const A = d1x * d1x + d1y * d1y + d1z * d1z, Ee = d2x * d2x + d2y * d2y + d2z * d2z, F = d2x * rx + d2y * ry + d2z * rz; let s = 0, t = 0;
  if (A <= 1e-14 && Ee <= 1e-14) { s = t = 0; } else if (A <= 1e-14) { s = 0; t = Math.min(1, Math.max(0, F / Ee)); }
  else { const C = d1x * rx + d1y * ry + d1z * rz; if (Ee <= 1e-14) { t = 0; s = Math.min(1, Math.max(0, -C / A)); }
    else { const B = d1x * d2x + d1y * d2y + d1z * d2z, den = A * Ee - B * B; s = den > 1e-14 ? Math.min(1, Math.max(0, (B * F - C * Ee) / den)) : 0; t = (B * s + F) / Ee;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -C / A)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (B - C) / A)); } } }
  out[0] = p1x + d1x * s; out[1] = p1y + d1y * s; out[2] = p1z + d1z * s; out[3] = p2x + d2x * t; out[4] = p2y + d2y * t; out[5] = p2z + d2z * t; out[6] = s; out[7] = t; return out;
}
