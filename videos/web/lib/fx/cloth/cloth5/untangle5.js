// CLOTH5: undo a garment's crossings with itself (cloth folded THROUGH cloth), after Baraff, Witkin and Kass, "Untangling cloth"
// (SIGGRAPH 2003): the intersection contour cuts the mesh; a region it encloses (an ISLAND: the mesh minus the edges that pass through a
// triangle falls apart into the main sheet and small pieces) is cloth on the wrong side of the sheet it passed through. Of each island
// and its partner (the piece of the other sheet inside the same contour) the smaller is moved back through: every island vertex on the
// wrong side of the nearest crossed triangle goes to `gap` on the right side (the side its own sheet's uncrossed neighbours are on).
// Run between solver stages; the solver's point-triangle / edge-edge self-collision (xpbd selfTri, side memory) then keeps the sides.
// untangle(X, tris, n, { pin, gap, maxIsland, passes }) -> { before, after, moved, islands, passes } (X modified in place)
import { selfIntersections } from './measure5.js';
function segTriHit(X, p0, p1, a, b, c) {
  const ax = X[a * 3], ay = X[a * 3 + 1], az = X[a * 3 + 2], e1x = X[b * 3] - ax, e1y = X[b * 3 + 1] - ay, e1z = X[b * 3 + 2] - az, e2x = X[c * 3] - ax, e2y = X[c * 3 + 1] - ay, e2z = X[c * 3 + 2] - az;
  const ox = X[p0 * 3], oy = X[p0 * 3 + 1], oz = X[p0 * 3 + 2], dx = X[p1 * 3] - ox, dy = X[p1 * 3 + 1] - oy, dz = X[p1 * 3 + 2] - oz;
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-14) return false;
  const inv = 1 / det, tx = ox - ax, ty = oy - ay, tz = oz - az, u = (tx * px + ty * py + tz * pz) * inv; if (u <= 1e-6 || u >= 1 - 1e-6) return false;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (dx * qx + dy * qy + dz * qz) * inv; if (v <= 1e-6 || u + v >= 1 - 1e-6) return false;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv; return t > 1e-6 && t < 1 - 1e-6;
}
const tnorm = (X, T, t) => { const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2], ux = X[b * 3] - X[a * 3], uy = X[b * 3 + 1] - X[a * 3 + 1], uz = X[b * 3 + 2] - X[a * 3 + 2], vx = X[c * 3] - X[a * 3], vy = X[c * 3 + 1] - X[a * 3 + 1], vz = X[c * 3 + 2] - X[a * 3 + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l, X[a * 3], X[a * 3 + 1], X[a * 3 + 2]]; };
// the crossing edges: for every intersecting triangle pair, which edges of one pass through the other ({ key lo*n+hi -> [tri, ...] })
export function crossingEdges(X, T, n) {
  const L = [], si = selfIntersections(X, T, { list: L, wid: Int32Array.from({ length: n }, (_, i) => i) }), E = new Map();
  const add = (p, q, t) => { const k = p < q ? p * n + q : q * n + p; let a = E.get(k); if (!a) E.set(k, a = []); if (!a.includes(t)) a.push(t); };
  for (let k = 0; k < L.length; k += 2) { const s = L[k], u = L[k + 1];
    for (const [A, B] of [[s, u], [u, s]]) for (let e = 0; e < 3; e++) { const p = T[A * 3 + e], q = T[A * 3 + (e + 1) % 3]; if (segTriHit(X, p, q, T[B * 3], T[B * 3 + 1], T[B * 3 + 2])) add(p, q, B); } }
  return { pairs: si.pairs, hitTris: si.hit.reduce((a, b) => a + b, 0), E };
}
export function untangle(X, T, n, { pin = null, gap = 0.0015, maxIsland = 0.15, passes = 3, minIsland = 1 } = {}) {
  const nbr = Array.from({ length: n }, () => []); for (let t = 0; t < T.length; t += 3) for (let e = 0; e < 3; e++) { const a = T[t + e], b = T[t + (e + 1) % 3]; nbr[a].push(b); nbr[b].push(a); }
  const rep = { before: null, after: null, moved: 0, islands: 0, passes: 0 };
  for (let pass = 0; pass < passes; pass++) {
    const C = crossingEdges(X, T, n); if (pass === 0) rep.before = C.hitTris; rep.after = C.hitTris; if (!C.pairs) break; rep.passes++;
    const cut = k => C.E.has(k), comp = new Int32Array(n).fill(-1), sizes = [];
    for (let s = 0; s < n; s++) { if (comp[s] >= 0) continue; const id = sizes.length; let sz = 0; const st = [s]; comp[s] = id;
      while (st.length) { const v = st.pop(); sz++; for (const w of nbr[v]) { if (comp[w] >= 0) continue; if (cut(v < w ? v * n + w : w * n + v)) continue; comp[w] = id; st.push(w); } } sizes.push(sz); }
    // the main sheet of each connected piece of cloth is its largest component; islands are the small ones next to a crossing edge
    const isl = new Map();   // comp -> { verts, tris: Map(tri -> sideRef) }
    for (const [k, tl] of C.E) { const p = Math.floor(k / n), q = k % n; if (comp[p] === comp[q]) continue;
      for (const [a, b] of [[p, q], [q, p]]) { const ca = comp[a]; if (sizes[ca] > maxIsland * n || sizes[ca] < minIsland) continue; if (sizes[ca] >= sizes[comp[b]]) continue;
        let I = isl.get(ca); if (!I) isl.set(ca, I = { id: ca, size: sizes[ca], tris: new Map(), partners: new Set() });
        for (const t of tl) { const nn = tnorm(X, T, t), sb = (X[b * 3] - nn[3]) * nn[0] + (X[b * 3 + 1] - nn[4]) * nn[1] + (X[b * 3 + 2] - nn[5]) * nn[2]; const prev = I.tris.get(t) || 0; I.tris.set(t, prev + (sb >= 0 ? 1 : -1));
          for (let c = 0; c < 3; c++) I.partners.add(comp[T[t * 3 + c]]); } } }
    if (!isl.size) break;
    const order = [...isl.values()].sort((a, b) => a.size - b.size), done = new Set(); let movedPass = 0;
    const verts = new Map(); for (let v = 0; v < n; v++) { const c = comp[v]; if (isl.has(c)) { let a = verts.get(c); if (!a) verts.set(c, a = []); a.push(v); } }
    for (const I of order) { if ([...I.partners].some(c => done.has(c))) continue; done.add(I.id); rep.islands++;
      const tl = [...I.tris.keys()], sides = tl.map(t => Math.sign(I.tris.get(t)) || 1), nns = tl.map(t => tnorm(X, T, t));
      for (const v of verts.get(I.id) || []) { if (pin && pin[v]) continue; let best = -1, bd = Infinity;
        for (let i = 0; i < tl.length; i++) { const t = tl[i]; let cx = 0, cy = 0, cz = 0; for (let c = 0; c < 3; c++) { const w = T[t * 3 + c]; cx += X[w * 3]; cy += X[w * 3 + 1]; cz += X[w * 3 + 2]; } const d = (X[v * 3] - cx / 3) ** 2 + (X[v * 3 + 1] - cy / 3) ** 2 + (X[v * 3 + 2] - cz / 3) ** 2; if (d < bd) { bd = d; best = i; } }
        if (best < 0) continue; const nn = nns[best], s = sides[best], d = ((X[v * 3] - nn[3]) * nn[0] + (X[v * 3 + 1] - nn[4]) * nn[1] + (X[v * 3 + 2] - nn[5]) * nn[2]) * s;
        if (d >= gap) continue; const k = (gap - d) * s; X[v * 3] += nn[0] * k; X[v * 3 + 1] += nn[1] * k; X[v * 3 + 2] += nn[2] * k; movedPass++; } }
    rep.moved += movedPass; if (!movedPass) break; }
  if (rep.passes) rep.after = crossingEdges(X, T, n).hitTris;
  return rep;
}
// a solver's cloth (xpbd Cloth: X, tris, n, W) untangled in place; pinned particles (W 0) never move. stats: an object the counts add to
export function untangleCloth(cl, { stats = null, key = '', ...o } = {}) {
  const pin = Uint8Array.from(cl.W, w => (w === 0 ? 1 : 0)), r = untangle(cl.X, cl.tris, cl.n, { pin, ...o });
  if (stats) { const s = stats[key] ||= { before: 0, after: 0, moved: 0, islands: 0 }; s.before += r.before ?? 0; s.after += r.after ?? 0; s.moved += r.moved; s.islands += r.islands; }
  return r;
}
// CLOTH5: the crossings that are not islands (a fold through its neighbour whose contour runs off an edge, or two sheets pressed through each
// other between the arm and the torso) resolved by LAYER ORDER: for each crossing pair, the triangle standing farther out along the body's
// normal is the outer one; the inner one's corners above the outer's plane go under it and the outer's corners under the inner's plane go
// over it (half each, gap apart), averaged over all pairs, a few passes. The fold keeps its shape to a few mm; nothing crosses where it
// worked. bodyAt(x, y, z) -> { px, py, pz, nx, ny, nz } | null (the posed body's nearest point and normal).
export function flattenCrossings(X, T, n, bodyAt, { pin = null, gap = 0.0012, passes = 4, rate = 0.5 } = {}) {
  const rep = { before: null, after: null, passes: 0, moved: 0 }, D = new Float64Array(n * 3), C = new Float64Array(n);
  const cen = t => { const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2]; return [(X[a * 3] + X[b * 3] + X[c * 3]) / 3, (X[a * 3 + 1] + X[b * 3 + 1] + X[c * 3 + 1]) / 3, (X[a * 3 + 2] + X[b * 3 + 2] + X[c * 3 + 2]) / 3]; };
  for (let pass = 0; pass < passes; pass++) {
    const L = [], si = selfIntersections(X, T, { list: L, wid: Int32Array.from({ length: n }, (_, i) => i) }); let hit = 0; for (const x of si.hit) hit += x;
    if (pass === 0) rep.before = hit; rep.after = hit; if (!L.length) break; rep.passes++; D.fill(0); C.fill(0);
    for (let k = 0; k < L.length; k += 2) { const s = L[k], u = L[k + 1], cs = cen(s), cu = cen(u), m = [(cs[0] + cu[0]) / 2, (cs[1] + cu[1]) / 2, (cs[2] + cu[2]) / 2], q = bodyAt(m[0], m[1], m[2]); if (!q) continue;
      const nb = [q.nx, q.ny, q.nz], rs = (cs[0] - q.px) * nb[0] + (cs[1] - q.py) * nb[1] + (cs[2] - q.pz) * nb[2], ru = (cu[0] - q.px) * nb[0] + (cu[1] - q.py) * nb[1] + (cu[2] - q.pz) * nb[2];
      const [o, i] = rs >= ru ? [s, u] : [u, s], no = tnorm(X, T, o), ni = tnorm(X, T, i); if (no[0] * nb[0] + no[1] * nb[1] + no[2] * nb[2] < 0) for (let c = 0; c < 3; c++) no[c] = -no[c]; if (ni[0] * nb[0] + ni[1] * nb[1] + ni[2] * nb[2] < 0) for (let c = 0; c < 3; c++) ni[c] = -ni[c];
      for (let c = 0; c < 3; c++) { const v = T[i * 3 + c], d = (X[v * 3] - no[3]) * no[0] + (X[v * 3 + 1] - no[4]) * no[1] + (X[v * 3 + 2] - no[5]) * no[2]; if (d > -gap) { const k2 = -(d + gap) * rate; D[v * 3] += no[0] * k2; D[v * 3 + 1] += no[1] * k2; D[v * 3 + 2] += no[2] * k2; C[v]++; } }
      for (let c = 0; c < 3; c++) { const v = T[o * 3 + c], d = (X[v * 3] - ni[3]) * ni[0] + (X[v * 3 + 1] - ni[4]) * ni[1] + (X[v * 3 + 2] - ni[5]) * ni[2]; if (d < gap) { const k2 = (gap - d) * rate; D[v * 3] += ni[0] * k2; D[v * 3 + 1] += ni[1] * k2; D[v * 3 + 2] += ni[2] * k2; C[v]++; } } }
    for (let v = 0; v < n; v++) { if (!C[v] || (pin && pin[v])) continue; for (let c = 0; c < 3; c++) X[v * 3 + c] += Math.max(-0.006, Math.min(0.006, D[v * 3 + c] / C[v])); rep.moved++; } }
  if (rep.passes) { let hit = 0; for (const x of selfIntersections(X, T, { wid: Int32Array.from({ length: n }, (_, i) => i) }).hit) hit += x; rep.after = hit; }
  return rep;
}
export function flattenCloth(cl, bodyMesh, { stats = null, key = '', ...o } = {}) {
  const pin = Uint8Array.from(cl.W, w => (w === 0 ? 1 : 0)), at = (x, y, z) => { const q = bodyMesh.closest(x, y, z, 0.12); return q ? { px: q.px, py: q.py, pz: q.pz, nx: q.nx, ny: q.ny, nz: q.nz } : null; };
  const r = flattenCrossings(cl.X, cl.tris, cl.n, at, { pin, ...o });
  if (stats) { const s = stats[key] ||= { before: 0, after: 0, moved: 0 }; s.before += r.before ?? 0; s.after += r.after ?? 0; s.moved += r.moved; }
  return r;
}
