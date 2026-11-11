// BODY / SUBDIV (P1, ANATOMY AT RESOLUTION, 3 Oct 2026): per-person Loop subdivision of the hm08 body, with everything a Hero's body
// carries taken through it, so small anatomical forms (detail.js) have vertices to live on. Ours, CC0.
//
//   const plan = loopPlan(tri, nv, levels)          // topology only (cached per (mesh, levels)): the linear stencils and the new triangles
//   const g = subdivideGeometry(geom, plan, opts)   // a new BufferGeometry: position (shrink-compensated), skinIndex / skinWeight (stencil
//                                                   // union, top 4, renormalised), aHero (region and side by the dominant stencil vertex,
//                                                   // limb coordinate and dorsal flag interpolated), uv and any other float attribute
//                                                   // (lane B's aLikeA / aLikeB ...) interpolated, the expression morphs through the same stencils
//   subdivideHero(h, { levels })                    // replaces h.body.geometry from OUTSIDE hero.js (no hook): h.nrm and h.aHero follow;
//                                                   // the original geometry is kept on h.body.userData.geomL0 (LOD: setBodyLevel(h, 0 | k))
//
// Loop (1987): edge point 3/8 (a + b) + 1/8 (c + d); vertex point (1 - n beta) v + beta sum(ring), beta = (5/8 - (3/8 + cos(2 pi / n) / 4)^2) / n.
// The body is closed and manifold (0 boundary edges); a boundary rule (1/2, 1/2 and 1/8, 3/4, 1/8) is kept for other meshes.
// Original vertices KEEP THEIR INDICES (0..n-1; helpers past the body's vertices are copied unchanged): garments, finger pads, landmarks
// and every index-based lookup in hero.js and the labs keep working. New edge vertices follow, level by level.
// Shrink compensation: Loop's limit surface lies inside the control mesh (a convex form loses ~0.5 x its local Laplacian); the person's
// measures were taken on the control mesh, so the control points are first pushed out by one step of the inverse:
// C = P + k (P - Lim(P)), Lim the Loop limit stencil (1 - n g) v + g sum(ring), g = 1 / (n + 3 / (8 beta)). k = 1 by default.
import * as THREE from 'three';
const beta = n => (5 / 8 - (3 / 8 + Math.cos(2 * Math.PI / n) / 4) ** 2) / n;
const _plans = new Map();
// one level: tri (Uint32Array or any index array), nv vertices in the array (vertices not in any triangle are copied)
function oneLevel(tri, nv) {
  const nt = tri.length / 3, emap = new Map(), ev = [];          // ev: per new edge vertex [a, b, c, d] (d = -1 on a boundary)
  const key = (a, b) => a < b ? a * 4194304 + b : b * 4194304 + a;
  const etri = new Int32Array(nt * 3);
  for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) { const a = tri[t * 3 + e], b = tri[t * 3 + (e + 1) % 3], c = tri[t * 3 + (e + 2) % 3], k = key(a, b);
    let id = emap.get(k); if (id === undefined) { id = ev.length; emap.set(k, id); ev.push([a, b, c, -1]); } else ev[id][3] = c; etri[t * 3 + e] = id; }
  // vertex rings (and boundary neighbours)
  const deg = new Int32Array(nv), bdeg = new Int32Array(nv);
  for (const [a, b, , d] of ev) { deg[a]++; deg[b]++; if (d < 0) { bdeg[a]++; bdeg[b]++; } }
  const off = new Int32Array(nv + 1); for (let v = 0; v < nv; v++) off[v + 1] = off[v] + deg[v];
  const ring = new Int32Array(off[nv]), fill = off.slice(0, nv), isB = new Uint8Array(nv);
  for (const [a, b, , d] of ev) { ring[fill[a]++] = b; ring[fill[b]++] = a; if (d < 0) { isB[a] = 1; isB[b] = 1; } }
  // stencils: rows for the nv old vertices then the edge vertices; CSR (rowOff, col, w)
  const rowOff = [0], col = [], w = [], lim = { rowOff: [0], col: [], w: [] };
  for (let v = 0; v < nv; v++) {
    const n = deg[v];
    if (!n) { col.push(v); w.push(1); lim.col.push(v); lim.w.push(1); }
    else if (isB[v]) { const bn = []; for (let j = off[v]; j < off[v + 1]; j++) { const u = ring[j], k = key(v, u); if (ev[emap.get(k)][3] < 0) bn.push(u); }
      col.push(v, ...bn); w.push(3 / 4, ...bn.map(() => 1 / 8 * 2 / bn.length)); lim.col.push(v, ...bn); lim.w.push(2 / 3, ...bn.map(() => 1 / 6 * 2 / bn.length)); }
    else { const b = beta(n), g = 1 / (n + 3 / (8 * b)); col.push(v); w.push(1 - n * b); lim.col.push(v); lim.w.push(1 - n * g);
      for (let j = off[v]; j < off[v + 1]; j++) { col.push(ring[j]); w.push(b); lim.col.push(ring[j]); lim.w.push(g); } }
    rowOff.push(col.length); lim.rowOff.push(lim.col.length);
  }
  for (const [a, b, c, d] of ev) { if (d < 0) { col.push(a, b); w.push(0.5, 0.5); } else { col.push(a, b, c, d); w.push(3 / 8, 3 / 8, 1 / 8, 1 / 8); } rowOff.push(col.length); }
  const out = new Uint32Array(nt * 12);
  for (let t = 0; t < nt; t++) { const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2], ab = nv + etri[t * 3], bc = nv + etri[t * 3 + 1], ca = nv + etri[t * 3 + 2], o = t * 12;
    out[o] = a; out[o + 1] = ab; out[o + 2] = ca; out[o + 3] = ab; out[o + 4] = b; out[o + 5] = bc; out[o + 6] = ca; out[o + 7] = bc; out[o + 8] = c; out[o + 9] = ab; out[o + 10] = bc; out[o + 11] = ca; }
  return { nIn: nv, nOut: nv + ev.length, tri: out, S: { rowOff: Int32Array.from(rowOff), col: Int32Array.from(col), w: Float32Array.from(w) },
    lim: { rowOff: Int32Array.from(lim.rowOff), col: Int32Array.from(lim.col), w: Float32Array.from(lim.w) }, nEdges: ev.length };
}
export function loopPlan(tri, nv, levels = 1, cacheKey = null) {
  const k = cacheKey ? cacheKey + ':' + levels : null; if (k && _plans.has(k)) return _plans.get(k);
  const L = []; let t = tri, n = nv;
  for (let i = 0; i < levels; i++) { const p = oneLevel(t, n); L.push(p); t = p.tri; n = p.nOut; }
  const plan = { levels: L, nIn: nv, nOut: n, tri: t, triIn: tri };
  if (k) _plans.set(k, plan); return plan;
}
// y = S x for an attribute of itemSize k (rows of the stencil); x length nIn * k
function applyRows(St, nOut, x, k) {
  const y = new Float32Array(nOut * k), { rowOff, col, w } = St;
  for (let r = 0; r < nOut; r++) { const o = r * k; for (let j = rowOff[r]; j < rowOff[r + 1]; j++) { const c = col[j] * k, ww = w[j]; for (let q = 0; q < k; q++) y[o + q] += ww * x[c + q]; } }
  return y;
}
// the dominant stencil entry of each row (categorical attributes)
function dominantRows(St, nOut) { const d = new Int32Array(nOut), { rowOff, col, w } = St; for (let r = 0; r < nOut; r++) { let b = -1, bw = -Infinity; for (let j = rowOff[r]; j < rowOff[r + 1]; j++) if (w[j] > bw) { bw = w[j]; b = col[j]; } d[r] = b; } return d; }
// skin weights: the stencil's union of (bone, weight), top 4, renormalised
function skinRows(St, nOut, SI, SW) {
  const si = new Uint16Array(nOut * 4), sw = new Float32Array(nOut * 4), { rowOff, col, w } = St, acc = new Map();
  for (let r = 0; r < nOut; r++) { acc.clear();
    for (let j = rowOff[r]; j < rowOff[r + 1]; j++) { const c = col[j], ww = w[j]; for (let q = 0; q < 4; q++) { const bw = SW[c * 4 + q]; if (bw <= 0) continue; const b = SI[c * 4 + q]; acc.set(b, (acc.get(b) || 0) + ww * bw); } }
    const top = [...acc].filter(e => e[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 4), s = top.reduce((a, e) => a + e[1], 0) || 1;
    top.forEach(([b, v], q) => { si[r * 4 + q] = b; sw[r * 4 + q] = v / s; }); }
  return { si, sw };
}
// positions: shrink-compensate the control points with the FIRST level's limit stencil (only the vertices in triangles move), then subdivide
export function subdividePositions(plan, P, { compensate = 1 } = {}) {
  let x = P;
  if (compensate) { const L0 = plan.levels[0], lim = applyRows(L0.lim, L0.nIn, P, 3); x = new Float32Array(P.length); for (let i = 0; i < P.length; i++) x[i] = P[i] + compensate * (P[i] - lim[i]); }
  for (const L of plan.levels) x = applyRows(L.S, L.nOut, x, 3);
  return x;
}
export function subdivideAttr(plan, A, k, mode = 'linear') {
  let x = A;
  for (const L of plan.levels) {
    if (mode === 'linear') x = applyRows(L.S, L.nOut, x, k);
    else { const d = dominantRows(L.S, L.nOut), y = new (x.constructor)(L.nOut * k); for (let r = 0; r < L.nOut; r++) for (let q = 0; q < k; q++) y[r * k + q] = x[d[r] * k + q]; x = y; }
  }
  return x;
}
export function subdivideSkin(plan, SI, SW) { let si = SI, sw = SW; for (const L of plan.levels) ({ si, sw } = skinRows(L.S, L.nOut, si, sw)); return { si, sw }; }
// a whole hero body geometry -> its subdivided twin
export function subdivideGeometry(geom, plan, { compensate = 1, morphs = true } = {}) {
  const g = new THREE.BufferGeometry(), A = geom.attributes, nOut = plan.nOut;
  g.setAttribute('position', new THREE.BufferAttribute(subdividePositions(plan, A.position.array, { compensate }), 3));
  if (A.skinIndex) { const { si, sw } = subdivideSkin(plan, A.skinIndex.array, A.skinWeight.array); g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4)); }
  if (A.aHero) { const a = A.aHero.array, lin = subdivideAttr(plan, a, 4, 'linear'), dom = subdivideAttr(plan, a, 4, 'dominant'), o = new Float32Array(nOut * 4);
    for (let v = 0; v < nOut; v++) { o[v * 4] = dom[v * 4]; o[v * 4 + 1] = lin[v * 4 + 1]; o[v * 4 + 2] = dom[v * 4 + 2]; o[v * 4 + 3] = lin[v * 4 + 3]; }
    g.setAttribute('aHero', new THREE.BufferAttribute(o, 4)); }
  for (const [name, at] of Object.entries(A)) { if (['position', 'normal', 'skinIndex', 'skinWeight', 'aHero'].includes(name) || !(at.array instanceof Float32Array)) continue;
    g.setAttribute(name, new THREE.BufferAttribute(subdivideAttr(plan, at.array, at.itemSize, 'linear'), at.itemSize)); }
  if (morphs && geom.morphAttributes.position?.length) {
    g.morphAttributes.position = geom.morphAttributes.position.map(m => { const y = subdividePositions(plan, m.array, { compensate }); const b = new THREE.BufferAttribute(y, 3); b.name = m.name; return b; });
    g.morphTargetsRelative = geom.morphTargetsRelative; }
  g.setIndex(new THREE.BufferAttribute(plan.tri, 1)); g.computeVertexNormals();
  g.userData.subdiv = { levels: plan.levels.length, nIn: plan.nIn, nOut, tris: plan.tri.length / 3 };
  return g;
}
// on a built Hero, from outside: h.body's geometry -> the subdivided one; h.nrm and h.aHero follow (index-compatible for 0..n-1)
export function subdivideHero(h, { levels = 1, compensate = 1, morphs = true } = {}) {
  const g0 = h.body.userData.geomL0 || h.body.geometry; h.body.userData.geomL0 = g0;
  h.body.userData.nrmL0 ||= h.nrm; h.body.userData.aHeroL0 ||= h.aHero;
  if (!levels) { setBodyLevel(h, 0); return g0; }
  const t0 = performance.now(), plan = loopPlan(g0.index.array, g0.attributes.position.count, levels, 'hm08:' + g0.index.count + ':' + g0.attributes.position.count);
  const g = subdivideGeometry(g0, plan, { compensate, morphs }); g.userData.subdiv.ms = Math.round(performance.now() - t0); g.userData.plan = plan;
  (h.body.userData.geoms ||= {})[levels] = g; setBodyLevel(h, levels);
  return g;
}
// LOD: swap between the original and an already-built subdivided geometry (a hero far from the camera needs none of it)
export function setBodyLevel(h, level) {
  const ud = h.body.userData, g = level ? ud.geoms?.[level] : ud.geomL0; if (!g) return false;
  h.body.geometry = g; h.nrm = level ? g.attributes.normal.array : ud.nrmL0; h.aHero = level ? g.attributes.aHero.array : ud.aHeroL0; ud.level = level;
  return true;
}
// a level for a framing: the person's height on screen in pixels (stature / the view's height at that distance x the image height)
export const levelForPixels = px => px < 700 ? 0 : px < 2200 ? 1 : 2;
export function levelForView(h, camera, imageHeightPx) {
  const p = new THREE.Vector3(); h.group.getWorldPosition(p); const d = Math.max(0.1, p.distanceTo(camera.position)), vh = 2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / (camera.zoom || 1);
  return levelForPixels(h.o.height / vh * imageHeightPx);
}
