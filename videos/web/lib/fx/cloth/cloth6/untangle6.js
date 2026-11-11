// CLOTH6: undo the crossings a garment already has (cloth through its own cloth), between solver stages: after the sew, after the A-pose
// settle, after each carry step, after the joint settle. A global intersection analysis after Baraff, Witkin and Kass, "Untangling Cloth"
// (SIGGRAPH 2003): every intersecting triangle pair gives the edges of one that pierce the other (the intersection contour runs through
// them); cut along those edges, the mesh falls apart into its main sheet and ISLANDS (the region a closed contour encloses: cloth on the
// wrong side of the sheet it passed through), which go back through (CLOTH5's untangle5.js did this much). On a 13.5 mm mesh most contours
// enclose NO vertex (two triangles crossed near their edges, a fold's lip through its neighbour, a hem's edge through the leg: the contour
// runs off a boundary): for each piercing edge the endpoint that lies SHALLOWER through the pierced face (the one that went through last,
// with the smaller excursion) is taken back through it, `gap` past, and the face's corners give way by a share (`share`); the moves of a
// vertex are averaged, capped (`maxMove`), and the whole is repeated a few passes, re-finding the contours each time. The vertices still
// in a crossing are returned (`tangled`, with their 1-ring): self6.js leaves their pairs side-free so the solver does not defend a crossing.
// untangle6(X, T, n, opts) -> { before, after, passes, islands, moved, tangled } (X modified in place)
import { selfIntersections } from '../cloth5/measure5.js';
export const UNTANGLE6_VERSION = 1;
function segTriHit(X, p0, p1, a, b, c) {
  const ax = X[a * 3], ay = X[a * 3 + 1], az = X[a * 3 + 2], e1x = X[b * 3] - ax, e1y = X[b * 3 + 1] - ay, e1z = X[b * 3 + 2] - az, e2x = X[c * 3] - ax, e2y = X[c * 3 + 1] - ay, e2z = X[c * 3 + 2] - az;
  const ox = X[p0 * 3], oy = X[p0 * 3 + 1], oz = X[p0 * 3 + 2], dx = X[p1 * 3] - ox, dy = X[p1 * 3 + 1] - oy, dz = X[p1 * 3 + 2] - oz;
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-14) return false;
  const inv = 1 / det, tx = ox - ax, ty = oy - ay, tz = oz - az, u = (tx * px + ty * py + tz * pz) * inv; if (u <= 1e-6 || u >= 1 - 1e-6) return false;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (dx * qx + dy * qy + dz * qz) * inv; if (v <= 1e-6 || u + v >= 1 - 1e-6) return false;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv; return t > 1e-6 && t < 1 - 1e-6;
}
const tnorm = (X, T, t, o) => { const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2], ux = X[b * 3] - X[a * 3], uy = X[b * 3 + 1] - X[a * 3 + 1], uz = X[b * 3 + 2] - X[a * 3 + 2], vx = X[c * 3] - X[a * 3], vy = X[c * 3 + 1] - X[a * 3 + 1], vz = X[c * 3 + 2] - X[a * 3 + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1; o[0] = nx / l; o[1] = ny / l; o[2] = nz / l; o[3] = X[a * 3]; o[4] = X[a * 3 + 1]; o[5] = X[a * 3 + 2]; return o; };
// the piercings: [edge u, edge v, pierced triangle] for every intersecting pair; and the hit triangles
export function piercings(X, T, n, wid = null) {
  const L = [], si = selfIntersections(X, T, { list: L, wid: wid || Int32Array.from({ length: n }, (_, i) => i) }), out = [];
  for (let k = 0; k < L.length; k += 2) { const s = L[k], u = L[k + 1];
    for (const [A, B] of [[s, u], [u, s]]) for (let e = 0; e < 3; e++) { const p = T[A * 3 + e], q = T[A * 3 + (e + 1) % 3]; if (segTriHit(X, p, q, T[B * 3], T[B * 3 + 1], T[B * 3 + 2])) out.push(p, q, B); } }
  let hit = 0; for (const h of si.hit) hit += h; return { P: out, hitTris: hit, hit: si.hit, pairs: si.pairs };
}
export function untangle6(X, T, n, { pin = null, gap = 0.0015, passes = 4, maxIsland = 0.12, maxMove = 0.012, share = 0.35, ring = true, wid = null, shallow = false, vote = false, move = true } = {}) {   // shallow (opt-in): the shallower end of each piercing edge back through (measured: it moves thousands of vertices and the count does not fall); move false: only find the tangled set
  const nbr = Array.from({ length: n }, () => []); for (let t = 0; t < T.length; t += 3) for (let e = 0; e < 3; e++) { const a = T[t + e], b = T[t + (e + 1) % 3]; nbr[a].push(b); nbr[b].push(a); }
  const rep = { before: null, after: null, passes: 0, islands: 0, moved: 0 }, D = new Float64Array(n * 3), C = new Float64Array(n), nn = new Float64Array(6);
  let PC = null;
  for (let pass = 0; pass < passes; pass++) {
    PC = piercings(X, T, n, wid); if (pass === 0) rep.before = PC.hitTris; rep.after = PC.hitTris; if (!PC.P.length || !move) break; rep.passes++;
    const P = PC.P, cut = new Set(); for (let k = 0; k < P.length; k += 3) { const a = P[k], b = P[k + 1]; cut.add(a < b ? a * n + b : b * n + a); }
    // components of the mesh cut along the piercing edges
    const comp = new Int32Array(n).fill(-1), sizes = [];
    for (let s = 0; s < n; s++) { if (comp[s] >= 0) continue; const id = sizes.length; let sz = 0; const st = [s]; comp[s] = id;
      while (st.length) { const v = st.pop(); sz++; for (const w of nbr[v]) { if (comp[w] >= 0) continue; if (cut.has(v < w ? v * n + w : w * n + v)) continue; comp[w] = id; st.push(w); } } sizes.push(sz); }
    D.fill(0); C.fill(0); const done = new Set();
    // islands: the smaller side of a piercing edge when it is a small component; its vertices go through the faces their edges pierce
    const isl = new Map(); for (let k = 0; k < P.length; k += 3) { const a = P[k], b = P[k + 1], ca = comp[a], cb = comp[b]; if (ca === cb) continue;
      const [w, o] = sizes[ca] < sizes[cb] ? [a, b] : [b, a], cw = comp[w]; if (sizes[cw] > maxIsland * n) continue; void o;
      let I = isl.get(cw); if (!I) isl.set(cw, I = { tris: new Map() }); I.tris.set(P[k + 2], (I.tris.get(P[k + 2]) || 0) + (sideOf(X, T, P[k + 2], o, nn) >= 0 ? 1 : -1)); done.add(k); }
    if (isl.size) { const verts = new Map(); for (let v = 0; v < n; v++) { const I = isl.get(comp[v]); if (I) { let a = verts.get(comp[v]); if (!a) verts.set(comp[v], a = []); a.push(v); } }
      for (const [cid, I] of isl) { rep.islands++; const tl = [...I.tris.keys()], sides = tl.map(t => Math.sign(I.tris.get(t)) || 1), nrm = tl.map(t => Float64Array.from(tnorm(X, T, t, nn)));
        for (const v of verts.get(cid) || []) { if (pin && pin[v]) continue; let best = -1, bd = Infinity;
          for (let i = 0; i < tl.length; i++) { const t = tl[i]; let cx = 0, cy = 0, cz = 0; for (let c = 0; c < 3; c++) { const w = T[t * 3 + c]; cx += X[w * 3]; cy += X[w * 3 + 1]; cz += X[w * 3 + 2]; } const d = (X[v * 3] - cx / 3) ** 2 + (X[v * 3 + 1] - cy / 3) ** 2 + (X[v * 3 + 2] - cz / 3) ** 2; if (d < bd) { bd = d; best = i; } }
          const q = nrm[best], s = sides[best], d = ((X[v * 3] - q[3]) * q[0] + (X[v * 3 + 1] - q[4]) * q[1] + (X[v * 3 + 2] - q[5]) * q[2]) * s; if (d >= gap) continue;
          const k = (gap - d) * s; D[v * 3] += q[0] * k; D[v * 3 + 1] += q[1] * k; D[v * 3 + 2] += q[2] * k; C[v]++; } } }
    // the rest: the shallower end of each piercing edge back through the face (the face's corners give way by `share`)
    if (shallow) for (let k = 0; k < P.length; k += 3) { if (done.has(k)) continue; const a = P[k], b = P[k + 1], t = P[k + 2], q = tnorm(X, T, t, nn);
      const da = (X[a * 3] - q[3]) * q[0] + (X[a * 3 + 1] - q[4]) * q[1] + (X[a * 3 + 2] - q[5]) * q[2], db = (X[b * 3] - q[3]) * q[0] + (X[b * 3 + 1] - q[4]) * q[1] + (X[b * 3 + 2] - q[5]) * q[2];
      let w = Math.abs(da) <= Math.abs(db) ? a : b; if (pin && pin[w]) w = w === a ? b : a; if (pin && pin[w]) continue;
      const dw = w === a ? da : db, mv = -dw - Math.sign(dw) * gap, fv = pin && T.slice(t * 3, t * 3 + 3).every(c => pin[c]) ? 1 : 1 - share;
      D[w * 3] += q[0] * mv * fv; D[w * 3 + 1] += q[1] * mv * fv; D[w * 3 + 2] += q[2] * mv * fv; C[w]++;
      if (fv < 1) for (let c = 0; c < 3; c++) { const v = T[t * 3 + c]; if (pin && pin[v]) continue; D[v * 3] -= q[0] * mv * share; D[v * 3 + 1] -= q[1] * mv * share; D[v * 3 + 2] -= q[2] * mv * share; C[v]++; } }
    // vote (opt-in): for each piercing edge not of an island, the side of the pierced face's plane its endpoints' neighbourhood (2-ring,
    // within 2.5 cm of the face) mostly lies on is the right one; the endpoint on the other side goes back through (gap past)
    if (vote) for (let k = 0; k < P.length; k += 3) { if (done.has(k)) continue; const a = P[k], b = P[k + 1], t = P[k + 2], q = tnorm(X, T, t, nn);
      const cx = (X[T[t * 3] * 3] + X[T[t * 3 + 1] * 3] + X[T[t * 3 + 2] * 3]) / 3, cy = (X[T[t * 3] * 3 + 1] + X[T[t * 3 + 1] * 3 + 1] + X[T[t * 3 + 2] * 3 + 1]) / 3, cz = (X[T[t * 3] * 3 + 2] + X[T[t * 3 + 1] * 3 + 2] + X[T[t * 3 + 2] * 3 + 2]) / 3;
      const sd = v => (X[v * 3] - q[3]) * q[0] + (X[v * 3 + 1] - q[4]) * q[1] + (X[v * 3 + 2] - q[5]) * q[2]; let sum = 0; const seen = new Set([a, b, T[t * 3], T[t * 3 + 1], T[t * 3 + 2]]);
      for (const s0 of [a, b]) for (const w1 of nbr[s0]) for (const w of [w1, ...nbr[w1]]) { if (seen.has(w)) continue; seen.add(w); if ((X[w * 3] - cx) ** 2 + (X[w * 3 + 1] - cy) ** 2 + (X[w * 3 + 2] - cz) ** 2 > 0.025 * 0.025) continue; const d = sd(w); if (Math.abs(d) > 1e-4) sum += Math.sign(d); }
      if (!sum) continue; const S = Math.sign(sum), da = sd(a), db = sd(b), wv = Math.sign(da) !== S ? a : b; if (pin && pin[wv]) continue;
      const dw = wv === a ? da : db, mv = S * gap - dw; if (Math.abs(mv) > maxMove) continue;
      D[wv * 3] += q[0] * mv * (1 - share); D[wv * 3 + 1] += q[1] * mv * (1 - share); D[wv * 3 + 2] += q[2] * mv * (1 - share); C[wv]++;
      for (let c = 0; c < 3; c++) { const v = T[t * 3 + c]; if (pin && pin[v]) continue; D[v * 3] -= q[0] * mv * share / 3; D[v * 3 + 1] -= q[1] * mv * share / 3; D[v * 3 + 2] -= q[2] * mv * share / 3; C[v]++; } }
    let moved = 0; for (let v = 0; v < n; v++) { if (!C[v]) continue; let dx = D[v * 3] / C[v], dy = D[v * 3 + 1] / C[v], dz = D[v * 3 + 2] / C[v]; const l = Math.hypot(dx, dy, dz); if (l > maxMove) { const s = maxMove / l; dx *= s; dy *= s; dz *= s; }
      X[v * 3] += dx; X[v * 3 + 1] += dy; X[v * 3 + 2] += dz; moved++; }
    rep.moved += moved; if (!moved) break; }
  if (rep.passes) PC = piercings(X, T, n, wid);
  rep.after = PC ? PC.hitTris : 0;
  // tangled: the corners of triangles still crossing (and their 1-ring)
  const tg = tangledSet(X, T, n, PC, nbr, { ring, maxIsland });
  rep.tangled = tg; let nt = 0; for (const x of tg) nt += x; rep.tangledN = nt;
  return rep;
}
// the tangled set: corners of triangles in a crossing (and their 1-ring), and every vertex of an island (a small component of the mesh
// cut along the piercing edges: cloth wholly on the wrong side, whose own triangles may cross nothing)
export function tangledSet(X, T, n, PC, nbr = null, { ring = true, maxIsland = 0.12 } = {}) {
  const tg = new Uint8Array(n); if (!PC || !PC.hitTris) return tg;
  if (!nbr) { nbr = Array.from({ length: n }, () => []); for (let t = 0; t < T.length; t += 3) for (let e = 0; e < 3; e++) { const a = T[t + e], b = T[t + (e + 1) % 3]; nbr[a].push(b); nbr[b].push(a); } }
  for (let t = 0; t < T.length / 3; t++) if (PC.hit[t]) for (let c = 0; c < 3; c++) tg[T[t * 3 + c]] = 1;
  if (ring) { const r2 = Uint8Array.from(tg); for (let v = 0; v < n; v++) if (tg[v]) for (const w of nbr[v]) r2[w] = 1; tg.set(r2); }
  const P = PC.P, cut = new Set(); for (let k = 0; k < P.length; k += 3) { const a = P[k], b = P[k + 1]; cut.add(a < b ? a * n + b : b * n + a); }
  const comp = new Int32Array(n).fill(-1), sizes = [];
  for (let s = 0; s < n; s++) { if (comp[s] >= 0) continue; const id = sizes.length; let sz = 0; const st = [s]; comp[s] = id;
    while (st.length) { const v = st.pop(); sz++; for (const w of nbr[v]) { if (comp[w] >= 0) continue; if (cut.has(v < w ? v * n + w : w * n + v)) continue; comp[w] = id; st.push(w); } } sizes.push(sz); }
  const isl = new Set(); for (let k = 0; k < P.length; k += 3) { const ca = comp[P[k]], cb = comp[P[k + 1]]; if (ca === cb) continue; const w = sizes[ca] < sizes[cb] ? ca : cb; if (sizes[w] <= maxIsland * n) isl.add(w); }
  if (isl.size) for (let v = 0; v < n; v++) if (isl.has(comp[v])) tg[v] = 1;
  return tg;
}
function sideOf(X, T, t, v, nn) { const q = tnorm(X, T, t, nn); return (X[v * 3] - q[3]) * q[0] + (X[v * 3 + 1] - q[4]) * q[1] + (X[v * 3 + 2] - q[5]) * q[2]; }
// a solver's cloth untangled in place (pinned particles never move); its Self6 (cl.c6) told which vertices are still tangled
export function untangleCloth6(cl, { stats = null, key = '', ...o } = {}) {
  const pin = Uint8Array.from(cl.W, w => (w === 0 ? 1 : 0)), r = untangle6(cl.X, cl.tris, cl.n, { pin, ...o });
  if (cl.c6) { cl.c6.tangled = r.tangled; cl.c6.locks = new Map(); cl.c6.vfL.fill(0); cl.c6.eeL.fill(0); }
  cl.V?.fill(0);
  if (stats) { const s = stats[key] ||= { before: 0, after: 0, moved: 0, islands: 0, tangled: 0 }; s.before += r.before ?? 0; s.after += r.after ?? 0; s.moved += r.moved; s.islands += r.islands; s.tangled += r.tangledN; }
  return r;
}

// CLOTH6: the PLACED panels (before the sew) crossing themselves: a panel laid at a clearance round a concave part of the body (the inside
// of a bent elbow, the crotch, the small of the back) is an offset surface, and an offset of a concave surface folds through itself (a
// swallowtail). The tangled vertices (and `rings` rings round them) are smoothed (uniform Laplacian over the panel's own edges, `iters`
// passes) and kept `gap` outside the body; repeated while the count falls. X modified in place. wid: the seams' welded ids (so a seam's two
// sides are not counted as crossing). body: a collide.js SurfaceMesh (posed). Returns { before, after, rounds, moved }.
export function smoothPlaced(X, T, n, { wid = null, body = null, gap = 0.006, iters = 6, rings = 2, rounds = 4, rate = 0.5 } = {}) {
  const nbr = Array.from({ length: n }, () => []); for (let t = 0; t < T.length; t += 3) for (let e = 0; e < 3; e++) { const a = T[t + e], b = T[t + (e + 1) % 3]; if (!nbr[a].includes(b)) { nbr[a].push(b); nbr[b].push(a); } }
  const rep = { before: null, after: null, rounds: 0, moved: 0 }, Y = new Float64Array(n * 3);
  for (let r = 0; r < rounds; r++) { const PC = piercings(X, T, n, wid); if (r === 0) rep.before = PC.hitTris; rep.after = PC.hitTris; if (!PC.hitTris) break;
    const sel = new Uint8Array(n); for (let t = 0; t < T.length / 3; t++) if (PC.hit[t]) for (let c = 0; c < 3; c++) sel[T[t * 3 + c]] = 1;
    for (let k = 0; k < rings; k++) { const s2 = Uint8Array.from(sel); for (let v = 0; v < n; v++) if (sel[v]) for (const w of nbr[v]) s2[w] = 1; sel.set(s2); }
    const X0 = Float64Array.from(X);
    for (let it = 0; it < iters; it++) { Y.set(X); for (let v = 0; v < n; v++) { if (!sel[v] || nbr[v].length < 3) continue; let x = 0, y = 0, z = 0; for (const w of nbr[v]) { x += Y[w * 3]; y += Y[w * 3 + 1]; z += Y[w * 3 + 2]; } const k = 1 / nbr[v].length;
        X[v * 3] += (x * k - Y[v * 3]) * rate; X[v * 3 + 1] += (y * k - Y[v * 3 + 1]) * rate; X[v * 3 + 2] += (z * k - Y[v * 3 + 2]) * rate; }
      if (body) for (let v = 0; v < n; v++) { if (!sel[v]) continue; const q = body.closest(X[v * 3], X[v * 3 + 1], X[v * 3 + 2], 0.08); if (!q || q.d >= gap) continue; const k = gap - q.d; X[v * 3] += q.nx * k; X[v * 3 + 1] += q.ny * k; X[v * 3 + 2] += q.nz * k; } }
    const after = piercings(X, T, n, wid).hitTris; if (after >= PC.hitTris) { X.set(X0); break; }
    let mv = 0; for (let v = 0; v < n; v++) if (sel[v]) mv++; rep.moved += mv; rep.rounds++; rep.after = after; }
  return rep;
}
