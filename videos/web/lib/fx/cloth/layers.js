// LAYERS (CLOTHING c2, K1): what happens between garments in a stack. Thickness and its compression, the gap one layer keeps from the
// layer under it, the joint settle (the two-way coupling: an outer garment's weight and tension press the inner, the inner's bulk
// holds the outer out), and the measures a stack is read by (inner-through-outer crossings, particles outside the layer over them,
// accumulated thickness at cuffs, collars and the waist). Pure JS on typed arrays; used by stack.js.
//
//   Compression   each fabric has a free thickness T0 (fabrics.js `mm`, read as the thickness under ~50 Pa) and a compressed one Tm (under
//                 ~5 kPa), Tm = T0 (1 - EMC), EMC the KES-FB3 compressibility (Kawabata, "The standardization and analysis of hand
//                 evaluation", 2nd ed., 1980: woven shirtings ~25-35 %, brushed and napped cloth and knits 40-55 %, leather and duck
//                 10-15 %). t(p) = Tm + (T0 - Tm) exp(-p / P0), P0 = 600 Pa: half the loft goes by ~400 Pa (a waistband, a strap). Our
//                 numbers per construction (EMC below) are typical values, NOT measurements of these fabrics; K4 should replace them
//                 with a column in fabrics.js (`mmC`) when the fabric book measures them.
//   Contact gap   between layers i (under) and j (over): HARD at (Tm_i + Tm_j) / 2 + 0.3 mm (fully compressed), SOFT out to
//                 (T0_i + T0_j) / 2 + 0.6 mm (free loft), the soft band a compliant XPBD contact of stiffness K A_p, K = P0 / (T0 - Tm)
//                 (the slope of t(p) at p = 0) over the particle's area A_p (collide.js Contacts soft). So a coat resting on a sweater
//                 keeps the loft where it hangs and squeezes it where it is in tension; the accumulated thickness is then a measure.
//   Joint settle  the layers of a zone, solved one by one from the inside out, are then run TOGETHER for a short time (0.15 s): one cloth
//                 (xpbd.js with a fabric per triangle), each garment's holds and tethers kept, the inter-layer contact as point-triangle
//                 and edge-edge self-collision between different layers only (with side memory, so an inner layer cannot end up outside
//                 an outer one), the body and rigid accessories as colliders. Outer tension compresses the inner; the inner pushes back.
import { Cloth, ptTri, segSeg } from './xpbd.js';
import { SurfaceMesh, Contacts, vertexNormals } from './collide.js';
import { FABRICS, phys } from './fabrics.js';
export const LAYERS_VERSION = 1;
export const P0 = 600, AIR_HARD = 0.0003, AIR_SOFT = 0.0006;
// KES-FB3 compressibility (EMC, fraction of T0 lost by 5 kPa) by construction: typical values (see the header), not measurements
export const EMC = { knit: 0.45, rib: 0.5, plain: 0.28, twill22: 0.45, twill21: 0.3, twill31: 0.22, duck: 0.15, mesh: 0.4, leather: 0.12, felt: 0.45, suede: 0.18, fleece: 0.6, quilt: 0.7, elastic: 0.2 };
// thickness record of a fabric (name or fabrics.js entry): T0, Tm (m), K (Pa / m)
export function thick(fabric) { const f = typeof fabric === 'string' ? FABRICS[fabric] : fabric, T0 = (f.mmC != null ? f.mm : f.mm) / 1000, e = f.mmC != null ? 1 - f.mmC / f.mm : (EMC[f.construction] ?? 0.3), Tm = T0 * (1 - e);
  return { T0, Tm, K: P0 / Math.max(1e-6, T0 - Tm), emc: e }; }
export const thicknessAt = (fabric, p) => { const t = thick(fabric); return t.Tm + (t.T0 - t.Tm) * Math.exp(-p / P0); };
// the contact between an under layer (fabric a) and an over layer (b): hard and soft gaps (m) and the soft band's stiffness per area (Pa/m)
export function layerGap(a, b) { const A = thick(a), B = thick(b); return { hard: (A.Tm + B.Tm) / 2 + AIR_HARD, soft: (A.T0 + B.T0) / 2 + AIR_SOFT, K: 1 / (1 / A.K + 1 / B.K) }; }
// a collider entry for collide.js Contacts: the layer under (its posed SurfaceMesh) as seen by a cloth of fabric `over` with particle
// areas Ap (Float64Array n, m^2): hard gap, soft band, compliance per particle
export function layerContact(under, over, Ap, extra = {}) { const g = layerGap(under.fabric, over), n = Ap.length, al = new Float64Array(n); for (let i = 0; i < n; i++) al[i] = 1 / (g.K * Math.max(Ap[i], 1e-6));
  return { mesh: under.surf, gap: g.hard, soft: { gap: g.soft, alpha: al }, mu: 0.45, reach: 0.05, garment: true, ...extra, _gap: g }; }
// particle areas (a third of each adjacent triangle) of a cloth
export function particleAreas(X, tris, n) { const A = new Float64Array(n); for (let t = 0; t < tris.length; t += 3) { const a = tris[t], b = tris[t + 1], c = tris[t + 2];
  const ux = X[b * 3] - X[a * 3], uy = X[b * 3 + 1] - X[a * 3 + 1], uz = X[b * 3 + 2] - X[a * 3 + 2], vx = X[c * 3] - X[a * 3], vy = X[c * 3 + 1] - X[a * 3 + 1], vz = X[c * 3 + 2] - X[a * 3 + 2];
  const s = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 3; A[a] += s; A[b] += s; A[c] += s; } return A; }

// ---------------------------------------------------------------- measures
// edges of the INNER cloth that pass through triangles of the OUTER (a segment-triangle test over a hash of the outer's triangles):
// the inner showing through the outer. inner/outer: { X (posed n*3), tris }. Returns { crossings, edges }
export function crossings(inner, outer, { cell = 0.03 } = {}) {
  const XO = outer.X, TO = outer.tris, ic = 1 / cell, key = (i, j, k) => ((i + 4096) * 8192 + (j + 4096)) * 8192 + (k + 4096), H = new Map();
  for (let t = 0; t < TO.length / 3; t++) { let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let k = 0; k < 3; k++) { const v = TO[t * 3 + k]; x0 = Math.min(x0, XO[v * 3]); x1 = Math.max(x1, XO[v * 3]); y0 = Math.min(y0, XO[v * 3 + 1]); y1 = Math.max(y1, XO[v * 3 + 1]); z0 = Math.min(z0, XO[v * 3 + 2]); z1 = Math.max(z1, XO[v * 3 + 2]); }
    for (let i = Math.floor(x0 * ic); i <= Math.floor(x1 * ic); i++) for (let j = Math.floor(y0 * ic); j <= Math.floor(y1 * ic); j++) for (let k = Math.floor(z0 * ic); k <= Math.floor(z1 * ic); k++) { const kk = key(i, j, k), L = H.get(kk); if (L) L.push(t); else H.set(kk, [t]); } }
  const XI = inner.X, TI = inner.tris, seen = new Set(); let hits = 0, ne = 0; const hitV = new Uint8Array(XI.length / 3);
  for (let t = 0; t < TI.length; t += 3) for (let k = 0; k < 3; k++) { const a = TI[t + k], b = TI[t + (k + 1) % 3], ek = a < b ? a * 1e7 + b : b * 1e7 + a; if (seen.has(ek)) continue; seen.add(ek); ne++;
    const ax = XI[a * 3], ay = XI[a * 3 + 1], az = XI[a * 3 + 2], bx = XI[b * 3], by = XI[b * 3 + 1], bz = XI[b * 3 + 2], cand = new Set();
    for (let i = Math.floor(Math.min(ax, bx) * ic); i <= Math.floor(Math.max(ax, bx) * ic); i++) for (let j = Math.floor(Math.min(ay, by) * ic); j <= Math.floor(Math.max(ay, by) * ic); j++) for (let kk = Math.floor(Math.min(az, bz) * ic); kk <= Math.floor(Math.max(az, bz) * ic); kk++) { const L = H.get(key(i, j, kk)); if (L) for (const q of L) cand.add(q); }
    for (const q of cand) if (segTri(ax, ay, az, bx, by, bz, XO, TO[q * 3], TO[q * 3 + 1], TO[q * 3 + 2])) { hits++; hitV[a] = 1; hitV[b] = 1; break; } }
  return { crossings: hits, edges: ne, hitV };
}
function segTri(px, py, pz, qx, qy, qz, X, a, b, c) {   // Moller-Trumbore on the segment p..q
  const ax = X[a * 3], ay = X[a * 3 + 1], az = X[a * 3 + 2], e1x = X[b * 3] - ax, e1y = X[b * 3 + 1] - ay, e1z = X[b * 3 + 2] - az, e2x = X[c * 3] - ax, e2y = X[c * 3 + 1] - ay, e2z = X[c * 3 + 2] - az;
  const dx = qx - px, dy = qy - py, dz = qz - pz, hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x, det = e1x * hx + e1y * hy + e1z * hz; if (Math.abs(det) < 1e-14) return false;
  const f = 1 / det, sx = px - ax, sy = py - ay, sz = pz - az, u = f * (sx * hx + sy * hy + sz * hz); if (u < 0 || u > 1) return false;
  const qx2 = sy * e1z - sz * e1y, qy2 = sz * e1x - sx * e1z, qz2 = sx * e1y - sy * e1x, v = f * (dx * qx2 + dy * qy2 + dz * qz2); if (v < 0 || u + v > 1) return false;
  const t = f * (e2x * qx2 + e2y * qy2 + e2z * qz2); return t > 1e-6 && t < 1 - 1e-6;
}
// particles of a cloth (X, n) lying OUTSIDE the outer layer's surface (outward normals) where that layer covers them (the closest point
// not on its open boundary, within reach) or closer than `gap` to it from inside: { outside, near, min (signed mm) }
export function outsideOf(X, n, outerSurf, { gap = 0, reach = 0.04, skip = null } = {}) {
  let out = 0, near = 0, mn = Infinity; const flag = new Uint8Array(n);
  for (let i = 0; i < n; i++) { if (skip && skip[i]) continue; const q = outerSurf.closest(X[i * 3], X[i * 3 + 1], X[i * 3 + 2], reach); if (!q || q.edge) continue; const d = -q.d;   // > 0: inside the outer
    mn = Math.min(mn, d); if (d < 0) { out++; flag[i] = 1; } else if (d < gap) near++; }
  return { outside: out, near, min: Number.isFinite(mn) ? mn * 1000 : null, flag };
}
// inner particles found outside (or within `gap` inside) the outer surface are moved in to `gap` under it (a last geometric guard after
// the joint settle; reported, so it never hides a bad solve; a particle further out than maxMove is left where it is: moving it would tear). Returns how many moved and the largest move (mm).
export function keepInside(X, n, outerSurf, { gap = 0.001, reach = 0.04, skip = null, floor = null, floorGap = 0, maxMove = Infinity } = {}) {
  let moved = 0, mx = 0;
  for (let i = 0; i < n; i++) { if (skip && skip[i]) continue; const q = outerSurf.closest(X[i * 3], X[i * 3 + 1], X[i * 3 + 2], reach); if (!q || q.edge) continue; const d = -q.d; if (d >= gap) continue;
    let k = gap - d; if (k > maxMove) continue; if (floor) { const r = floor.closest(X[i * 3], X[i * 3 + 1], X[i * 3 + 2], reach); if (r) k = Math.min(k, Math.max(0, r.d - floorGap)); } if (k <= 0) continue;
    X[i * 3] -= q.nx * k; X[i * 3 + 1] -= q.ny * k; X[i * 3 + 2] -= q.nz * k; moved++; mx = Math.max(mx, k); }
  return { moved, maxMm: mx * 1000 };
}
// accumulated thickness: for particles of the OUTERMOST layer selected by `pick(i)`, the distance to the skin (signed, posed), against the
// sum of the compressed thicknesses of the layers counted there. Returns { n, meanMm, minMm, maxMm }
// closest point, falling back to the nearest vertex that has triangles (the welded body keeps a few loose vertices: when the hash's
// nearest is one of them, closest() has no fan to test and returns null)
export const closestSafe = (S, x, y, z, reach) => S.closestAny(x, y, z, reach);
export function depthOver(body, X, n, pick, reach = 0.08) { let s = 0, k = 0, mn = Infinity, mx = -Infinity;
  for (let i = 0; i < n; i++) { if (!pick(i)) continue; const q = closestSafe(body, X[i * 3], X[i * 3 + 1], X[i * 3 + 2], reach); if (!q) continue; s += q.d; k++; mn = Math.min(mn, q.d); mx = Math.max(mx, q.d); }
  return { n: k, meanMm: k ? s / k * 1000 : 0, minMm: k ? mn * 1000 : 0, maxMm: k ? mx * 1000 : 0 }; }

// ---------------------------------------------------------------- the joint settle
// layers: [{ key, cl (its xpbd Cloth, solved: X, pin, rest, tris, warp in .warpIn), fabric, flip (its winding faces the body), vis (Uint8Array: drawn particles), solve: { soft attachments [{ i, x, alpha }], restAngle,
//            gapBody } }] innermost first. colliders: [{ mesh, gap, mu, reach, garment, mask(layer, i) -> bool }] (body, boots, layers left out).
// The cloth particles are concatenated; each layer keeps its pins, tethers, soft holds and bending; layers touch through self-collision
// between different layers. Returns { ms, pairs, X: [per layer Float64Array] } and writes each layer's X in place (cl.X).
export function jointSettle(layers, colliders, { T = 0.15, hz = 900, gravity = [0, -9.81, 0], iters = 2, self = true, same = false, c6 = null, metric6 = false } = {}) {   // c6 (CLOTH6, opt-in): (cloth, { lay, vis, th, offs }) attaches cloth6/self6.js   // same (CLOTH5, opt-in): each layer's own folds collide too
  const t0 = (globalThis.performance ? performance.now() : Date.now()), offs = [], fabs = [], fidx = new Map(); let n = 0, m = 0;
  for (const L of layers) { offs.push(n); n += L.cl.n; m += L.cl.tris.length / 3; if (!fidx.has(L.fabric)) { fidx.set(L.fabric, fabs.length); fabs.push(phys(L.fabric)); } }
  // CLOTH4 (opt-in: a layer's triFabs { fabs, triFab }, its per-triangle fabrics, e.g. an interfaced band): kept in the joint settle
  const tfo = layers.map(L => { if (!L.triFabs) return null; const map = L.triFabs.fabs.map(F => { fabs.push(F); return fabs.length - 1; }); return { map, tf: L.triFabs.triFab }; });
  const VIS = new Uint8Array(n).fill(1), rest = new Float64Array(n * 3), X0 = new Float64Array(n * 3), tris = new Int32Array(m * 3), triFab = new Uint8Array(m), pin = new Uint8Array(n), warp = new Float64Array(n * 3), ra = new Float64Array(n), lay = new Uint8Array(n), th = new Float64Array(n);
  let tt = 0; const soft = [];
  layers.forEach((L, li) => { const o = offs[li], c = L.cl, f = fidx.get(L.fabric), tk = thick(L.fabric);
    rest.set(c.rest, o * 3); X0.set(c.X, o * 3); if (c.warpIn) warp.set(c.warpIn, o * 3); if (L.vis) VIS.set(L.vis, o);
    for (let i = 0; i < c.n; i++) { pin[o + i] = c.pin[i]; ra[o + i] = typeof L.solve.restAngle === 'number' ? L.solve.restAngle : (L.solve.restAngle ? L.solve.restAngle[i] : 0); lay[o + i] = li + 1; th[o + i] = tk.Tm / 2 + AIR_HARD / 2; }
    for (let t = 0; t < c.tris.length; t++) tris[tt * 3 + t] = c.tris[t] + o; if (L.flip) for (let t = 0; t < c.tris.length; t += 3) { const b = tris[tt * 3 + t + 1]; tris[tt * 3 + t + 1] = tris[tt * 3 + t + 2]; tris[tt * 3 + t + 2] = b; }   // wound outward (the layer order needs it)
    for (let t = 0; t < c.tris.length / 3; t++) triFab[tt + t] = tfo[li] && tfo[li].tf.length === c.tris.length / 3 ? tfo[li].map[tfo[li].tf[t]] : f; tt += c.tris.length / 3;
    for (const a of L.solve.soft || []) soft.push({ i: a.i + o, x: a.x, alpha: a.alpha }); });
  // metric6 (CLOTH6, opt-in): every layer that carries its flat-pattern metric (cl._met6, stack.js with o.self6) keeps it here (without it the
  // joint cloth took its rest lengths from the A-pose sewn shape, and its first substeps pulled each garment toward them: folds through itself)
  let MET6 = null; if (metric6 && layers.every(L => L.cl._met6 && L.cl._met6.metric.length === L.cl.tris.length * 2)) { MET6 = { metric: new Float64Array(m * 6), grain: new Float64Array(m * 2) }; let t6 = 0;
    layers.forEach(L => { const M = L.cl._met6, k = L.cl.tris.length / 3; MET6.metric.set(M.metric, t6 * 6); MET6.grain.set(M.grain, t6 * 2);
      if (L.flip) for (let t = t6; t < t6 + k; t++) { const o6 = t * 6; let x = MET6.metric[o6 + 2]; MET6.metric[o6 + 2] = MET6.metric[o6 + 4]; MET6.metric[o6 + 4] = x; x = MET6.metric[o6 + 3]; MET6.metric[o6 + 3] = MET6.metric[o6 + 5]; MET6.metric[o6 + 5] = x; }
      t6 += k; }); }
  const cl = new Cloth(rest, tris, fabs[0], { X0, pin, warp, fabs, triFab, restAngle: ra, ...(MET6 ? { metric: MET6.metric, grain: MET6.grain } : {}), compress: 0.25, gravity, damping: 8, vmax: 0.6, self: 0, stretchIters: iters, slack: 0.015,
    ...(self ? { selfTri: th, selfTriLayers: lay, selfTriOrder: true, selfTriVis: VIS, selfTriEvery: 6, selfTriEE: true, ...(same ? { selfTriSame: true } : {}) } : {}) });
  if (soft.length) cl.attach(soft);
  if (c6) c6(cl, { lay, vis: VIS, th, offs });
  const surf = colliders.map(C => { const mask = C.mask ? new Uint8Array(n) : null; if (mask) layers.forEach((L, li) => { for (let i = 0; i < L.cl.n; i++) mask[offs[li] + i] = C.mask(li, i) ? 1 : 0; });
    let gap = C.gap; if (typeof gap === 'function') { const g = new Float64Array(n); layers.forEach((L, li) => { for (let i = 0; i < L.cl.n; i++) g[offs[li] + i] = gap(li, i); }); gap = g; }
    return { mesh: C.mesh, gap, mu: C.mu ?? 0.45, reach: C.reach ?? 0.05, garment: !!C.garment, mask }; });
  const ct = new Contacts(n, surf, { safe: true });
  cl.run(T, { hz, contacts: ct, every: 6 });
  layers.forEach((L, li) => { const o = offs[li]; L.cl.X.set(cl.X.subarray(o * 3, (o + L.cl.n) * 3)); });
  return { ms: Math.round((globalThis.performance ? performance.now() : Date.now()) - t0), particles: n, triPairs: cl.stats.triPairs || 0, edgePairs: cl.stats.edgePairs || 0, offs, ...(MET6 ? { metric6: true } : {}) };
}
