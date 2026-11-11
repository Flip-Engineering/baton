// CLOTH6 (round 6): cloth SELF-COLLISION that holds on K2's 13.5 mm mesh, as an opt-in hook of xpbd.js's Cloth (cl.c6 = new Self6(cl, o)).
// Without it nothing changes (xpbd's run() calls it only when cl.c6 is set).
//
// Why K1's selfTri (CLOTH5's self5) did not move the totals: its side memory is re-taken from the CURRENT positions every 6-8 substeps,
// so any crossing that survived one refresh (a push capped at 1 mm, a skin jump in the carry, a pinch against the body) became the side
// it then defended; and a pair first seen already crossed was held crossed. Here:
//   PROXIMITY   vertex-triangle and edge-edge pairs within reach (a spatial hash of the triangles' and edges' boxes, rebuilt every `every`
//               substeps), held `gap` apart (the two cloths' half-thicknesses: th[i] per particle).
//   SIDES       taken from the START of the substep (P: the last state the solver left, intersection-free where it was), and LOCKED while the
//               vertex stays over the face (vertex-triangle) or the closest points stay inside both edges (edge-edge); a lock is dropped
//               only when the pair separates sideways. A pair whose vertices are TANGLED (in a crossing that already exists: untangle6.js
//               marks them) takes no side at all: it is left to the untangling, not held crossed.
//   CONTINUOUS  between P and X each substep: a vertex whose signed distance to a face changes sign while (linearly interpolated) inside
//               the face, or two edges whose triple product changes sign while their closest points are interior and touching, has
//               crossed: it is pushed back to P's side (Bridson, Fedkiw and Anderson 2002, "Robust treatment of collisions, contact and
//               friction for cloth animation": proximity plus a continuous check; the sign test is their coplanarity test linearised over
//               one substep of <= 1.5 mm travel).
//   FRICTION    Coulomb on the relative tangential travel over the substep, bounded by mu x the normal push (folds stay where they fell).
//   LAYERS      with `layer` (Uint8Array n, 1 = innermost) and `order`, a pair between DIFFERENT layers takes its side from the layer order
//               and the outer garment's winding (outward) where that face looks away from the body (`up` dot > 0.2): an inner garment never
//               passes through an outer one, even if they were crossed before (one-sided); same-layer pairs use the locked sides.
//   STRAIN      strainLimit(cl, smax): edges stretched past (1 + smax) are shortened (Provot 1995; Bridson 2002 s.6) with a few Gauss-Seidel
//               sweeps, after the self projection (cloth held apart by collision must not stay over-stretched).
// Pure JS on typed arrays, deterministic. Units: metres.
import { piercings, tangledSet, untangle6 } from './untangle6.js';
export const SELF6_VERSION = 1;
const KEY = (i, j, k) => ((i + 4096) * 8192 + (j + 4096)) * 8192 + (k + 4096);

export class Self6 {
  // cl: an xpbd Cloth (X, W, tris, E, n). o: { th (half-thickness, m, number | Float64Array n), every (4), maxPush (m per projection, 0.004),
  // mu (0.3), layer (Uint8Array n), order (bool), vis (Uint8Array n: pairs whose outer element is not drawn are left out), same (true: a
  // layer's own pairs too), ee (true), ccd (true), margin (m: extra reach for the substeps between refreshes) }
  constructor(cl, o = {}) {
    const n = cl.n; this.cl = cl; this.n = n;
    this.th = typeof o.th === 'number' || o.th == null ? new Float64Array(n).fill(o.th ?? 0.0012) : Float64Array.from(o.th);
    this.every = o.every ?? 4; this.maxPush = o.maxPush ?? 0.004; this.mu = o.mu ?? 0.3; this.layer = o.layer || null; this.order = !!o.order && !!o.layer;
    this.vis = o.vis || null; this.same = o.same !== false; this.ee = o.ee !== false; this.ccd = o.ccd !== false; this.margin = o.margin ?? 0.004;
    this.freeSame = o.freeSame || null;   // Uint8Array n (opt-in): particles whose same-layer pairs are left out (a garment solved without self-collision; its layer order kept)
    this.travel = o.travel ?? 0.003; this.stride = o.stride ?? 1; this.S = null; this.tangleEvery = o.tangleEvery ?? 0; this.tangleMove = o.tangleMove ?? 0; this.strain = o.strain ?? 0; this.last = o.last !== false; this.lastPush = o.lastPush ?? 0.0015;
    this.tangled = new Uint8Array(n); this.up = null;   // up: Float64Array n*3 (the body's outward normal near each particle), for the layer order
    this.stats = { refresh: 0, vf: 0, ee: 0, pushVF: 0, pushEE: 0, ccdVF: 0, ccdEE: 0, ms: 0 };
    // the 1-ring (CSR): a vertex never collides with a face that shares a corner or a corner's neighbour. o.wid (Int32Array n): the
    // particles' welded ids (sewing: the two sides of a seam are one particle once sewn, so never a colliding pair)
    const wid = this.wid = o.wid ? Int32Array.from(o.wid) : null, nw = wid ? Math.max(...wid) + 1 : n, E0 = cl.E, Ew = [];
    for (let e = 0; e < E0.length; e += 2) { const a = wid ? wid[E0[e]] : E0[e], b = wid ? wid[E0[e + 1]] : E0[e + 1]; if (a !== b) Ew.push(a, b); }
    const cnt = new Int32Array(nw + 1); for (let e = 0; e < Ew.length; e++) cnt[Ew[e] + 1]++; for (let i = 0; i < nw; i++) cnt[i + 1] += cnt[i];
    const nb = new Int32Array(cnt[nw]), fill = cnt.slice(0, nw); for (let e = 0; e < Ew.length; e += 2) { const a = Ew[e], b = Ew[e + 1]; nb[fill[a]++] = b; nb[fill[b]++] = a; }
    this.nbo = cnt; this.nbr = nb; this.mark = new Int32Array(nw).fill(-1); this.nw = nw; this.ring = !!o.ring;   // ring (opt-in): K1's exclusion of the corners' 1-ring too (a fold tighter than two triangles then goes unseen)
    this.vfP = new Int32Array(0); this.vfL = new Int8Array(0); this.eeP = new Int32Array(0); this.eeL = new Int8Array(0); this.locks = new Map();
    this._q = new Float64Array(8);
  }
  // candidate pairs within reach of the current positions (the boxes inflated by R); locks carried over from the last list
  refresh(X) {
    this._keep(); const t0 = now(), n = this.n, T = this.cl.tris, m = T.length / 3, th = this.th, W = this.cl.W, LY = this.layer, same = this.same, VIS = this.vis;
    let thMax = 0; for (let i = 0; i < n; i++) if (th[i] > thMax) thMax = th[i];
    let NB = 1024; while (NB < 4 * m) NB <<= 1;
    const R = 2 * thMax + this.margin, ic = 1 / 0.02, nbo = this.nbo, nbr = this.nbr, mark = this.mark, WD = this.wid, RING = this.ring, MK = NB - 1;
    // a hashed grid in CSR (typed arrays; cells of 2 cm hashed into 2^17 buckets, a collision only adds candidates the distance test drops)
    const bucket = (i, j, k) => (((i * 73856093) ^ (j * 19349663) ^ (k * 83492791)) >>> 0) & MK;
    const grid = (cnt, boxOf) => { const head = new Int32Array(NB + 1), B = new Int32Array(6);
      for (let t = 0; t < cnt; t++) { boxOf(t, B); for (let i = B[0]; i <= B[1]; i++) for (let j = B[2]; j <= B[3]; j++) for (let k = B[4]; k <= B[5]; k++) head[bucket(i, j, k) + 1]++; }
      for (let b = 0; b < NB; b++) head[b + 1] += head[b]; const fill = head.slice(0, NB), item = new Int32Array(head[NB]);
      for (let t = 0; t < cnt; t++) { boxOf(t, B); for (let i = B[0]; i <= B[1]; i++) for (let j = B[2]; j <= B[3]; j++) for (let k = B[4]; k <= B[5]; k++) item[fill[bucket(i, j, k)]++] = t; }
      return { head, item }; };
    const triBox = (t, B) => { const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
      B[0] = Math.floor((Math.min(X[a], X[b], X[c]) - R) * ic); B[1] = Math.floor((Math.max(X[a], X[b], X[c]) + R) * ic); B[2] = Math.floor((Math.min(X[a + 1], X[b + 1], X[c + 1]) - R) * ic); B[3] = Math.floor((Math.max(X[a + 1], X[b + 1], X[c + 1]) + R) * ic); B[4] = Math.floor((Math.min(X[a + 2], X[b + 2], X[c + 2]) - R) * ic); B[5] = Math.floor((Math.max(X[a + 2], X[b + 2], X[c + 2]) + R) * ic); };
    const TB = new Float64Array(m * 6); for (let t = 0; t < m; t++) { const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3; for (let d = 0; d < 3; d++) { TB[t * 6 + d] = Math.min(X[a + d], X[b + d], X[c + d]) - R; TB[t * 6 + 3 + d] = Math.max(X[a + d], X[b + d], X[c + d]) + R; } }
    const GT = grid(m, triBox), stamp = new Int32Array(Math.max(m, this.cl.E.length / 2)).fill(-1);
    const old = this.locks, locks = new Map(), vf = [], vfl = [], q = this._q, R2 = R * R;
    for (let p = 0; p < n; p++) { const x = X[p * 3], y = X[p * 3 + 1], z = X[p * 3 + 2], hb = bucket(Math.floor(x * ic), Math.floor(y * ic), Math.floor(z * ic)), h0 = GT.head[hb], h1 = GT.head[hb + 1]; if (h0 === h1) continue;
      const pw = WD ? WD[p] : p; mark[pw] = p; if (RING) for (let j = nbo[pw]; j < nbo[pw + 1]; j++) mark[nbr[j]] = p;
      for (let li = h0; li < h1; li++) { const t = GT.item[li]; if (stamp[t] === p) continue; stamp[t] = p; const o6 = t * 6; if (x < TB[o6] || x > TB[o6 + 3] || y < TB[o6 + 1] || y > TB[o6 + 4] || z < TB[o6 + 2] || z > TB[o6 + 5]) continue; const i0 = T[t * 3], i1 = T[t * 3 + 1], i2 = T[t * 3 + 2];
        if (WD ? (mark[WD[i0]] === p || mark[WD[i1]] === p || mark[WD[i2]] === p) : (mark[i0] === p || mark[i1] === p || mark[i2] === p)) continue;
        if (LY && !same && LY[i0] === LY[p]) continue;
        if (W[p] === 0 && W[i0] === 0 && W[i1] === 0 && W[i2] === 0) continue;
        if (VIS && LY && LY[i0] !== LY[p] && (LY[p] > LY[i0] ? !VIS[p] : !(VIS[i0] && VIS[i1] && VIS[i2]))) continue;
        closestTri(X, x, y, z, i0, i1, i2, q); const dx = x - q[0], dy = y - q[1], dz = z - q[2]; if (dx * dx + dy * dy + dz * dz > R2) continue;
        const key = p * m + t; vf.push(p, t); const lk = old.get(key) || 0; vfl.push(lk); if (lk) locks.set(key, lk); } }
    mark.fill(-1);
    this.vfP = Int32Array.from(vf); this.vfL = Int8Array.from(vfl); const t1 = now(); this.stats.vfMs = (this.stats.vfMs || 0) + t1 - t0;
    if (this.ee) { const E = this.cl.E, ne = E.length / 2, ee = [], eel = [], r = this._q;
      const edgeBox = (e, B, pad = R) => { const a = E[e * 2] * 3, b = E[e * 2 + 1] * 3;
        B[0] = Math.floor((Math.min(X[a], X[b]) - pad) * ic); B[1] = Math.floor((Math.max(X[a], X[b]) + pad) * ic); B[2] = Math.floor((Math.min(X[a + 1], X[b + 1]) - pad) * ic); B[3] = Math.floor((Math.max(X[a + 1], X[b + 1]) + pad) * ic); B[4] = Math.floor((Math.min(X[a + 2], X[b + 2]) - pad) * ic); B[5] = Math.floor((Math.max(X[a + 2], X[b + 2]) + pad) * ic); };
      const GE = grid(ne, edgeBox), B = new Int32Array(6); stamp.fill(-1);
      const EB = new Float64Array(ne * 6); for (let e = 0; e < ne; e++) { const a = E[e * 2] * 3, b = E[e * 2 + 1] * 3; for (let d = 0; d < 3; d++) { EB[e * 6 + d] = Math.min(X[a + d], X[b + d]); EB[e * 6 + 3 + d] = Math.max(X[a + d], X[b + d]); } }
      for (let e = 0; e < ne; e++) { const a = E[e * 2], b = E[e * 2 + 1];
        const tag = -2 - e, aw = WD ? WD[a] : a, bw = WD ? WD[b] : b; mark[aw] = tag; mark[bw] = tag; if (RING) { for (let j = nbo[aw]; j < nbo[aw + 1]; j++) mark[nbr[j]] = tag; for (let j = nbo[bw]; j < nbo[bw + 1]; j++) mark[nbr[j]] = tag; }
        edgeBox(e, B, 0);   // the edge's own cells: every edge whose inflated box reaches them
        for (let i = B[0]; i <= B[1]; i++) for (let j = B[2]; j <= B[3]; j++) for (let k = B[4]; k <= B[5]; k++) { const hb = bucket(i, j, k);
          for (let li = GE.head[hb]; li < GE.head[hb + 1]; li++) { const f = GE.item[li]; if (f <= e || stamp[f] === e) continue; stamp[f] = e; const e6 = e * 6, f6 = f * 6;
            if (EB[e6] > EB[f6 + 3] + R || EB[f6] > EB[e6 + 3] + R || EB[e6 + 1] > EB[f6 + 4] + R || EB[f6 + 1] > EB[e6 + 4] + R || EB[e6 + 2] > EB[f6 + 5] + R || EB[f6 + 2] > EB[e6 + 5] + R) continue; const c = E[f * 2], d = E[f * 2 + 1]; if (mark[WD ? WD[c] : c] === tag || mark[WD ? WD[d] : d] === tag) continue;
            if (LY && !same && LY[c] === LY[a]) continue; if (W[a] + W[b] === 0 && W[c] + W[d] === 0) continue;
            if (VIS && LY && LY[a] !== LY[c] && (LY[a] > LY[c] ? !(VIS[a] && VIS[b]) : !(VIS[c] && VIS[d]))) continue;
            segSeg(X, a, b, c, d, r); const dx = r[0] - r[3], dy = r[1] - r[4], dz = r[2] - r[5]; if (dx * dx + dy * dy + dz * dz > R2) continue;
            const key = e * ne + f; ee.push(e, f); const lk = old.get(-1 - key) || 0; eel.push(lk); if (lk) locks.set(-1 - key, lk); } } }
      mark.fill(-1);
      this.eeP = Int32Array.from(ee); this.eeL = Int8Array.from(eel); }
    this.locks = locks; this.stats.refresh++; this.stats.vf = this.vfP.length / 2; this.stats.ee = this.eeP.length / 2; this.stats.ms += now() - t0; this.stats.refreshMs = (this.stats.refreshMs || 0) + now() - t0;
  }
  // xpbd.js run() calls pre() where K1's self projection is (after the cloth's own constraints, before the body contacts) and post()
  // after the contacts (a pinched fold keeps its order and sinks into the culled body rather than through itself)
  // stride (opt-in, > 1): the projection every stride-th substep only, its continuous check from its own snapshot (the state it last left)
  pre(step, X, P) { if (this.tangleEvery && step % this.tangleEvery === 0) this.updateTangled(X); if (step % this.every === 0) this.refresh(X); if (this.strain > 0) strainLimit(this.cl, this.strain, 1);
    if (this.stride > 1) { this._on = step % this.stride === 0; if (!this._on) return; if (!this.S || this.S.length !== X.length) this.S = Float64Array.from(P); this.project(X, this.S); if (!this.last) this.S.set(X); return; }
    this.project(X, P); }
  post(X, P) { if (this.stride > 1) { if (!this._on) return; if (this.last) this.project(X, this.S, { friction: false, maxPush: this.lastPush }); this.S.set(X); return; } if (this.last) this.project(X, P, { friction: false, maxPush: this.lastPush }); }
  // the tangled set found again from the cloth as it is (untangle6.js tangledSet): what came apart takes sides again, what crossed since
  // stops defending a side
  // tangleMove (opt-in, m): each time, one untangling pass too (islands + the vote, moves capped at tangleMove): the solver then smooths what moved
  updateTangled(X) { const t0 = now(); let PC, tg;
    if (this.tangleMove > 0) { this._pin ||= Uint8Array.from(this.cl.W, w => (w === 0 ? 1 : 0)); const r = untangle6(X, this.cl.tris, this.n, { pin: this._pin, passes: 1, vote: true, maxMove: this.tangleMove, wid: this.wid }); tg = r.tangled; PC = { hitTris: r.after }; this.stats.tangleMoved = (this.stats.tangleMoved || 0) + r.moved; }
    else { PC = piercings(X, this.cl.tris, this.n, this.wid); tg = tangledSet(X, this.cl.tris, this.n, PC, null, { ring: true }); }
    const was = this.tangled; for (let i = 0; i < this.n; i++) if (tg[i] !== was[i]) { this._dirty = true; break; } this.tangled = tg; this.stats.tangleMs = (this.stats.tangleMs || 0) + now() - t0; this.stats.tangledLast = PC.hitTris; }
  // write the current locks back to the map (so a refresh keeps them)
  _keep() { const m = this.cl.tris.length / 3, ne = this.cl.E.length / 2, L = new Map(), vf = this.vfP, vl = this.vfL, ee = this.eeP, el = this.eeL;
    for (let k = 0; k < vl.length; k++) if (vl[k]) L.set(vf[k * 2] * m + vf[k * 2 + 1], vl[k]);
    for (let k = 0; k < el.length; k++) if (el[k]) L.set(-1 - (ee[k * 2] * ne + ee[k * 2 + 1]), el[k]); this.locks = L; }
  // one projection over the candidates: X now, P the start of the substep (the side it came from)
  project(X, P, { friction = true, maxPush = this.maxPush, fast = true } = {}) {   // fast: a locked pair clear on its side, or an unlocked pair farther than `travel`, is not looked at at P
    const t0 = now(), T = this.cl.tris, W = this.cl.W, th = this.th, TG = this.tangled, FS = this.freeSame, LY = this.order ? this.layer : null, UP = this.up, mu = friction ? this.mu : 0, tr = this.travel;
    const vf = this.vfP, vl = this.vfL, nv = vl.length; let pushVF = 0, ccdVF = 0;
    for (let k = 0; k < nv; k++) { const p = vf[k * 2], t = vf[k * 2 + 1], a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
      const diff = LY && LY[p] !== LY[a], tgd = TG[p] || TG[a] || TG[b] || TG[c] || (FS && (FS[p] || FS[a]));
      if (!diff && tgd) { vl[k] = 0; continue; }
      const s1 = faceDist(X, X[p * 3], X[p * 3 + 1], X[p * 3 + 2], a, b, c, _f1); if (s1 === null) continue;
      const in1 = _f1[4] > -0.05 && _f1[5] > -0.05 && _f1[6] > -0.05, gap = th[p] + (th[a] + th[b] + th[c]) / 3;
      if (fast && !diff) { const lk = vl[k]; if (lk) { if (lk * s1 >= (in1 ? gap : 0)) { if (!in1) vl[k] = 0; continue; } } else if (s1 > tr || s1 < -tr) continue; }
      // at P: plane distance and barycentrics
      const s0 = faceDist(P, P[p * 3], P[p * 3 + 1], P[p * 3 + 2], a, b, c, _f0); if (s0 === null) continue;
      const in0 = _f0[4] > -0.05 && _f0[5] > -0.05 && _f0[6] > -0.05;
      let side = vl[k];
      if (diff) { // different layers: the order (outer on the outward side of an inner face), where the face looks outward
        const fo = LY[p] > LY[a] ? 1 : -1, ux = UP ? UP[a * 3] + UP[b * 3] + UP[c * 3] : 0, uy = UP ? UP[a * 3 + 1] + UP[b * 3 + 1] + UP[c * 3 + 1] : 0, uz = UP ? UP[a * 3 + 2] + UP[b * 3 + 2] + UP[c * 3 + 2] : 0, ul = Math.hypot(ux, uy, uz);
        if (ul > 0 && (_f1[0] * ux + _f1[1] * uy + _f1[2] * uz) / ul > 0.2) side = fo; else if (tgd) { vl[k] = 0; continue; } }
      let hit = false;
      if (!in0 && !in1) { // not over the face at either end: only a crossing through the face in between counts
        if (!this.ccd || (s0 > 0) === (s1 > 0)) { vl[k] = 0; continue; }
        const tau = s0 / (s0 - s1); if (!insideAt(P, X, p, a, b, c, tau)) { vl[k] = 0; continue; } hit = true; ccdVF++; side = s0 >= 0 ? 1 : -1; }
      if (!side) side = Math.abs(s0) > 1e-7 ? (s0 > 0 ? 1 : -1) : (s1 >= 0 ? 1 : -1);
      vl[k] = side;
      const d = side * s1; if (d >= gap) continue;
      if (!in1 && !hit && d >= 0) continue;   // beside the face on its side: the edge-edge pairs hold it
      const u = Math.max(0, _f1[4]), v = Math.max(0, _f1[5]), w = Math.max(0, _f1[6]), sm = u + v + w || 1, bu = u / sm, bv = v / sm, bw = w / sm;
      const den = W[p] + bu * bu * W[a] + bv * bv * W[b] + bw * bw * W[c]; if (den <= 0) continue;
      const l = Math.min(gap - d, maxPush) / den, nx = _f1[0] * side, ny = _f1[1] * side, nz = _f1[2] * side;
      X[p * 3] += W[p] * l * nx; X[p * 3 + 1] += W[p] * l * ny; X[p * 3 + 2] += W[p] * l * nz;
      let f = bu * W[a] * l; X[a * 3] -= f * nx; X[a * 3 + 1] -= f * ny; X[a * 3 + 2] -= f * nz;
      f = bv * W[b] * l; X[b * 3] -= f * nx; X[b * 3 + 1] -= f * ny; X[b * 3 + 2] -= f * nz;
      f = bw * W[c] * l; X[c * 3] -= f * nx; X[c * 3 + 1] -= f * ny; X[c * 3 + 2] -= f * nz;
      pushVF++;
      if (mu > 0) { // friction: the relative tangential travel over the substep, cut by mu x the normal push
        const rx = (X[p * 3] - P[p * 3]) - (bu * (X[a * 3] - P[a * 3]) + bv * (X[b * 3] - P[b * 3]) + bw * (X[c * 3] - P[c * 3])), ry = (X[p * 3 + 1] - P[p * 3 + 1]) - (bu * (X[a * 3 + 1] - P[a * 3 + 1]) + bv * (X[b * 3 + 1] - P[b * 3 + 1]) + bw * (X[c * 3 + 1] - P[c * 3 + 1])), rz = (X[p * 3 + 2] - P[p * 3 + 2]) - (bu * (X[a * 3 + 2] - P[a * 3 + 2]) + bv * (X[b * 3 + 2] - P[b * 3 + 2]) + bw * (X[c * 3 + 2] - P[c * 3 + 2]));
        const rn = rx * nx + ry * ny + rz * nz, tx = rx - rn * nx, ty = ry - rn * ny, tz = rz - rn * nz, tl = Math.sqrt(tx * tx + ty * ty + tz * tz); if (tl < 1e-9) continue;
        const k2 = Math.min(1, mu * l * den / tl) / den; // the share of the tangential travel removed
        X[p * 3] -= W[p] * k2 * tx; X[p * 3 + 1] -= W[p] * k2 * ty; X[p * 3 + 2] -= W[p] * k2 * tz;
        f = bu * W[a] * k2; X[a * 3] += f * tx; X[a * 3 + 1] += f * ty; X[a * 3 + 2] += f * tz; f = bv * W[b] * k2; X[b * 3] += f * tx; X[b * 3 + 1] += f * ty; X[b * 3 + 2] += f * tz; f = bw * W[c] * k2; X[c * 3] += f * tx; X[c * 3 + 1] += f * ty; X[c * 3 + 2] += f * tz; } }
    const E = this.cl.E, ee = this.eeP, el = this.eeL, ne2 = el.length, r = _r; let pushEE = 0, ccdEE = 0;
    for (let k = 0; k < ne2; k++) { const e = ee[k * 2], g = ee[k * 2 + 1], a = E[e * 2], b = E[e * 2 + 1], c = E[g * 2], d = E[g * 2 + 1];
      const tg = TG[a] || TG[b] || TG[c] || TG[d] || (FS && (FS[a] || FS[c])), diffE = LY && LY[a] !== LY[c];
      if (!diffE && tg) { el[k] = 0; continue; }
      const q1 = eeDist(X, a, b, c, d, _e1); if (q1 === null) { el[k] = 0; continue; }
      const in1 = _e1[4] > 1e-3 && _e1[4] < 1 - 1e-3 && _e1[5] > 1e-3 && _e1[5] < 1 - 1e-3, gapE = (th[a] + th[b] + th[c] + th[d]) / 2;
      if (fast && !diffE) { const lk = el[k]; if (lk) { if (lk * q1 >= 0 && (!in1 || lk * q1 >= gapE || _e1[6] > gapE)) { if (!in1) el[k] = 0; continue; } } else if (q1 > tr || q1 < -tr) continue; }
      const q0 = eeDist(P, a, b, c, d, _e0); if (q0 === null) { el[k] = 0; continue; }
      const in0 = _e0[4] > 1e-3 && _e0[4] < 1 - 1e-3 && _e0[5] > 1e-3 && _e0[5] < 1 - 1e-3;
      // the signed distance along the lines' common normal (n = (b - a) x (d - c), continuous in time) at P and X
      let side = el[k], hit = false;
      if (LY && LY[a] !== LY[c] && this.up) { const io = LY[a] > LY[c], U = this.up, ux = U[c * 3] + U[d * 3] + U[a * 3] + U[b * 3], uy = U[c * 3 + 1] + U[d * 3 + 1] + U[a * 3 + 1] + U[b * 3 + 1], uz = U[c * 3 + 2] + U[d * 3 + 2] + U[a * 3 + 2] + U[b * 3 + 2], ul = Math.hypot(ux, uy, uz);
        if (ul > 0) { const dn = (_e1[0] * ux + _e1[1] * uy + _e1[2] * uz) / ul; if (Math.abs(dn) > 0.3) side = (io ? 1 : -1) * (dn > 0 ? 1 : -1); else if (tg) { el[k] = 0; continue; } } else if (tg) { el[k] = 0; continue; } }
      else if (tg) { el[k] = 0; continue; }
      if (!in0 && !in1) { if (!this.ccd || (q0 > 0) === (q1 > 0)) { el[k] = 0; continue; }
        const tau = q0 / (q0 - q1); if (!edgesMeetAt(P, X, a, b, c, d, tau, th[a] + th[c])) { el[k] = 0; continue; } hit = true; ccdEE++; side = q0 >= 0 ? 1 : -1; }
      if (!side) side = Math.abs(q0) > 1e-7 ? (q0 > 0 ? 1 : -1) : (q1 >= 0 ? 1 : -1);
      el[k] = side;
      const gap = (th[a] + th[b] + th[c] + th[d]) / 2, dd = side * q1; if (dd >= gap) continue; if (!in1 && !hit) continue;
      if (!hit && dd >= 0 && _e1[3 + 3] > gap) continue;   // apart (the closest points farther than the gap): only the side matters
      const s = Math.min(1, Math.max(0, _e1[4])), tt = Math.min(1, Math.max(0, _e1[5])), den = (1 - s) * (1 - s) * W[a] + s * s * W[b] + (1 - tt) * (1 - tt) * W[c] + tt * tt * W[d]; if (den <= 0) continue;
      const l = Math.min(gap - dd, maxPush) / den, nx = _e1[0] * side, ny = _e1[1] * side, nz = _e1[2] * side;
      let f = (1 - s) * W[a] * l; X[a * 3] += f * nx; X[a * 3 + 1] += f * ny; X[a * 3 + 2] += f * nz; f = s * W[b] * l; X[b * 3] += f * nx; X[b * 3 + 1] += f * ny; X[b * 3 + 2] += f * nz;
      f = (1 - tt) * W[c] * l; X[c * 3] -= f * nx; X[c * 3 + 1] -= f * ny; X[c * 3 + 2] -= f * nz; f = tt * W[d] * l; X[d * 3] -= f * nx; X[d * 3 + 1] -= f * ny; X[d * 3 + 2] -= f * nz;
      pushEE++; }
    this.stats.pushVF += pushVF; this.stats.pushEE += pushEE; this.stats.ccdVF += ccdVF; this.stats.ccdEE += ccdEE; this.stats.ms += now() - t0;
    return pushVF + pushEE;
  }
}
const now = () => (globalThis.performance ? performance.now() : Date.now());
const _f0 = new Float64Array(7), _f1 = new Float64Array(7), _e0 = new Float64Array(7), _e1 = new Float64Array(7), _r = new Float64Array(8);
// signed distance of (px, py, pz) to the plane of (a, b, c) along its unit normal (winding); out = [nx, ny, nz, d, u, v, w] (unclamped
// barycentrics of the projection); null if degenerate
function faceDist(X, px, py, pz, a, b, c, out) {
  const ax = X[a * 3], ay = X[a * 3 + 1], az = X[a * 3 + 2], e1x = X[b * 3] - ax, e1y = X[b * 3 + 1] - ay, e1z = X[b * 3 + 2] - az, e2x = X[c * 3] - ax, e2y = X[c * 3 + 1] - ay, e2z = X[c * 3 + 2] - az;
  const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x, n2 = nx * nx + ny * ny + nz * nz; if (n2 < 1e-20) return null;
  const wx = px - ax, wy = py - ay, wz = pz - az, cx = e1y * wz - e1z * wy, cy = e1z * wx - e1x * wz, cz = e1x * wy - e1y * wx, g = (cx * nx + cy * ny + cz * nz) / n2;
  const dx = wy * e2z - wz * e2y, dy = wz * e2x - wx * e2z, dz = wx * e2y - wy * e2x, bb = (dx * nx + dy * ny + dz * nz) / n2, l = Math.sqrt(n2);
  out[0] = nx / l; out[1] = ny / l; out[2] = nz / l; out[3] = (wx * nx + wy * ny + wz * nz) / l; out[4] = 1 - g - bb; out[5] = bb; out[6] = g; return out[3];
}
// is p (moving P -> X) over the face (moving too) at time tau
function insideAt(P, X, p, a, b, c, tau) { const Y = _Y; for (const [i, k] of [[p, 0], [a, 1], [b, 2], [c, 3]]) for (let j = 0; j < 3; j++) Y[k * 3 + j] = P[i * 3 + j] + (X[i * 3 + j] - P[i * 3 + j]) * tau;
  if (faceDist(Y, Y[0], Y[1], Y[2], 1, 2, 3, _f2) === null) return false; return _f2[4] > -0.02 && _f2[5] > -0.02 && _f2[6] > -0.02; }
const _Y = new Float64Array(12), _f2 = new Float64Array(7);
// edge-edge: closest points (params s, t) and the signed distance along the unit common normal n = (b - a) x (d - c); out = [nx, ny, nz, dist, s, t]
function eeDist(X, a, b, c, d, out) {
  const d1x = X[b * 3] - X[a * 3], d1y = X[b * 3 + 1] - X[a * 3 + 1], d1z = X[b * 3 + 2] - X[a * 3 + 2], d2x = X[d * 3] - X[c * 3], d2y = X[d * 3 + 1] - X[c * 3 + 1], d2z = X[d * 3 + 2] - X[c * 3 + 2];
  const nx = d1y * d2z - d1z * d2y, ny = d1z * d2x - d1x * d2z, nz = d1x * d2y - d1y * d2x, nl = Math.sqrt(nx * nx + ny * ny + nz * nz), L1 = Math.sqrt(d1x * d1x + d1y * d1y + d1z * d1z), L2 = Math.sqrt(d2x * d2x + d2y * d2y + d2z * d2z);
  if (nl < 0.05 * L1 * L2 || L1 < 1e-9 || L2 < 1e-9) return null;   // near parallel: the vertex-face pairs have it
  segSeg(X, a, b, c, d, _r); out[0] = nx / nl; out[1] = ny / nl; out[2] = nz / nl; out[4] = _r[6]; out[5] = _r[7];
  out[3] = ((_r[0] - _r[3]) * nx + (_r[1] - _r[4]) * ny + (_r[2] - _r[5]) * nz) / nl; out[6] = Math.hypot(_r[0] - _r[3], _r[1] - _r[4], _r[2] - _r[5]); return out[3];
}
function edgesMeetAt(P, X, a, b, c, d, tau, tol) { const Y = _Y; for (const [i, k] of [[a, 0], [b, 1], [c, 2], [d, 3]]) for (let j = 0; j < 3; j++) Y[k * 3 + j] = P[i * 3 + j] + (X[i * 3 + j] - P[i * 3 + j]) * tau;
  segSeg(Y, 0, 1, 2, 3, _r); if (_r[6] <= 1e-3 || _r[6] >= 1 - 1e-3 || _r[7] <= 1e-3 || _r[7] >= 1 - 1e-3) return false; return Math.hypot(_r[0] - _r[3], _r[1] - _r[4], _r[2] - _r[5]) < Math.max(tol, 0.0005); }
// closest point on a triangle (Ericson 5.1.5): out = [x, y, z]
function closestTri(X, px, py, pz, ia, ib, ic, out) {
  const ax = X[ia * 3], ay = X[ia * 3 + 1], az = X[ia * 3 + 2], bx = X[ib * 3], by = X[ib * 3 + 1], bz = X[ib * 3 + 2], cx = X[ic * 3], cy = X[ic * 3 + 1], cz = X[ic * 3 + 2];
  const set = (u, v, w) => setB(out, ax, ay, az, bx, by, bz, cx, cy, cz, u, v, w);
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az, apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz; if (d1 <= 0 && d2 <= 0) return set(1, 0, 0);
  const bpx = px - bx, bpy = py - by, bpz = pz - bz, d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz; if (d3 >= 0 && d4 <= d3) return set(0, 1, 0);
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return set(1 - v, v, 0); }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz, d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz; if (d6 >= 0 && d5 <= d6) return set(0, 0, 1);
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return set(1 - w, 0, w); }
  const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return set(0, 1 - w, w); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; return set(1 - v - w, v, w);
}
function setB(out, ax, ay, az, bx, by, bz, cx, cy, cz, u, v, w) { out[0] = ax * u + bx * v + cx * w; out[1] = ay * u + by * v + cy * w; out[2] = az * u + bz * v + cz * w; return out; }
// closest points of segments ab and cd (Ericson 5.1.9): out = [p1 xyz, p2 xyz, s, t]
function segSeg(X, a, b, c, d, out) {
  const p1x = X[a * 3], p1y = X[a * 3 + 1], p1z = X[a * 3 + 2], p2x = X[c * 3], p2y = X[c * 3 + 1], p2z = X[c * 3 + 2];
  const d1x = X[b * 3] - p1x, d1y = X[b * 3 + 1] - p1y, d1z = X[b * 3 + 2] - p1z, d2x = X[d * 3] - p2x, d2y = X[d * 3 + 1] - p2y, d2z = X[d * 3 + 2] - p2z, rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
  const A = d1x * d1x + d1y * d1y + d1z * d1z, Ee = d2x * d2x + d2y * d2y + d2z * d2z, F = d2x * rx + d2y * ry + d2z * rz; let s = 0, t = 0;
  if (A <= 1e-14 && Ee <= 1e-14) { s = t = 0; } else if (A <= 1e-14) { s = 0; t = Math.min(1, Math.max(0, F / Ee)); }
  else { const C = d1x * rx + d1y * ry + d1z * rz; if (Ee <= 1e-14) { t = 0; s = Math.min(1, Math.max(0, -C / A)); }
    else { const B = d1x * d2x + d1y * d2y + d1z * d2z, den = A * Ee - B * B; s = den > 1e-14 ? Math.min(1, Math.max(0, (B * F - C * Ee) / den)) : 0; t = (B * s + F) / Ee;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -C / A)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (B - C) / A)); } } }
  out[0] = p1x + d1x * s; out[1] = p1y + d1y * s; out[2] = p1z + d1z * s; out[3] = p2x + d2x * t; out[4] = p2y + d2y * t; out[5] = p2z + d2z * t; out[6] = s; out[7] = t; return out;
}
// ---------------------------------------------------------------- strain limiting
// edges of the cloth (its stretch constraints) longer than (1 + smax) x rest are shortened to it (mass-weighted), `passes` Gauss-Seidel
// sweeps over the over-stretched ones only; returns how many were limited in the first sweep
export function strainLimit(cl, smax = 0.1, passes = 2) {
  const X = cl.X, W = cl.W, A = cl.sA, B = cl.sB, L = cl.sL; let first = 0;
  for (let it = 0; it < passes; it++) { let k = 0;
    for (let c = 0; c < A.length; c++) { const a = A[c], b = B[c], ws = W[a] + W[b]; if (ws === 0) continue; const a3 = a * 3, b3 = b * 3, dx = X[b3] - X[a3], dy = X[b3 + 1] - X[a3 + 1], dz = X[b3 + 2] - X[a3 + 2], d2 = dx * dx + dy * dy + dz * dz, Lm = L[c] * (1 + smax);
      if (d2 <= Lm * Lm) continue; const d = Math.sqrt(d2), s = (d - Lm) / d / ws; X[a3] += dx * s * W[a]; X[a3 + 1] += dy * s * W[a]; X[a3 + 2] += dz * s * W[a]; X[b3] -= dx * s * W[b]; X[b3 + 1] -= dy * s * W[b]; X[b3 + 2] -= dz * s * W[b]; k++; }
    if (it === 0) first = k; if (!k) break; }
  return first;
}
