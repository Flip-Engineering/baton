// CLOTH8 c6 it2 (15 Oct): THE BODY-CONTACT SHELL. Cloth cannot lie inside the skin. On the current person (GPU 1015-082520, the critic's
// c6it1: L05's shirt front and hip show skin-coloured holes, skin through L20's cuff and forearm sleeve; the orchestrator's 13:20 look, the
// same "garment pierced by the body" class as the bra cups) the SEWN garments are drawn where the bake left them: rideDetail and
// liftOverPosed (person/build.js) lift only the underwear and unsewn parts, and the bake's own fit already had the cloth inside the body it
// was solved on (measured, labs/clothing2/cloth8/contact_probe.mjs: L05's shirt 280 vertices more than 4 mm inside its own bake body, the
// same against today's; 107 more than 4 mm inside the POSED body, down to 3-4 cm at the lower front; L20's shirt and left cuff 28 more than 2
// mm). cover8 then pushes the skin under the clothes only to dMax (12 mm): deeper than that the body wins and shows through.
// The physics a solver's collision pass would have enforced: every cloth vertex keeps a rest offset (`floor`: the cloth's half-thickness and
// the skin's give) outside the body's surface, measured where it is drawn (the person's posed body, the full detailed surface), so
//   (1) each garment vertex (group 'garment': shirts, trousers, coats, skirts) closer than `floor` to the posed skin, or inside it, gets a
//       lift along the skin's outward normal at its closest point (floor - signed height), at most `maxLift`;
//   (2) the lift is spread over the garment's own mesh (`spread` rounds of max(own, `share` x the ring's mean): the cloth's bending stiffness,
//       a fold carried out as a fold, not a spike) and re-measured `rounds` times (a lift can carry a neighbour into another limb);
//   (3) the posed displacement is taken back to the garment's bind through the inverse of each vertex's own skinning blend (so the page's
//       skinning and the export draw it there), the construction sewn on the garment (placket, hems, cuffs, collar, buttons, pockets) carried
//       with it (carry8: bound to the merged garments before, placed after), and the posed normals rebuilt as partMesh2 builds them.
// No shape is aimed at: the only number is a contact offset, the same for every garment and every person; where no cloth is inside the skin
// nothing moves (byte-identical). Called (c7 it1) as cover8's last step (cover8.js applyCover8), so it is the last geometric word on the
// garments in the engine and in the export: { cover8: { contact8: false } } is the A/B, { cover8: { contact8: {...} } } its options.
//   contactPerson8(P, o) -> report { garments: { name: { verts, inside, deep4, lifted, maxLiftMm } }, carried }
import { SurfaceMesh, boneMats, skinPose, blendInverse, vertexNormals } from '../collide.js';
import { bind8, place8 } from './carry8.js';
import { heroScale } from '../foundations.js';
import { smoothNormals8 } from './cover8.js';
// (c7 it1, 15 Oct) THE LAST WORD, ON THE SKIN AS DRAWN. The c6 checker (CHECK.md F1): with contact8 in refit8's hook, cover8 ran AFTER it, and
// the default build read 130 of L05's shirt vertices "inside" the skin again. Measured (labs/clothing2/cloth8_scratch/c7_cover_diag.mjs):
// cover8 moves no cloth, and the shirt points it "put inside" lie 2-27 mm OUTSIDE the skin before the push; what turned them "inside" was the
// SIGN: the push folds the dimple's walls and cover8 moves the nipple patch (hm08's folded star, 99 inverted normals) out by up to 8.6 mm, so
// the closest point lands on a fold whose blended vertex normal points into the body, and contact8's own lift would then have pushed that
// cloth INTO the body along the inverted normal. Two changes: (1) contact8 now runs as cover8's last step (cover8.js applyCover8: the engine
// build and the Cycles export, after CORRECT5's corrected bind there), so nothing moves the skin after it; refit8 no longer calls it;
// (2) the body surface is signed and the lift directed by the posed surface's SMOOTHED outward normal (cover8 rev 3's smoothNormals8,
// `normalRings` rings): a folded patch of a few rings is outvoted by the surface round it, as it is for cover8's own push.
// A/B: makePerson(name, { cover8: { contact8: false } }).
// (c7 it2, 15 Oct) THE LIFT AS A CLOTH SOLVE (the only path since c8 it1, 15 Oct: c7 it1's radial spread is DELETED, git history keeps it;
// the review gate is abolished and the simulated arm is the one kept). The radial lift raised each inside
// vertex to the skin + floor and spread that by max(own, 0.7 x ring mean) over 3 rings: where the bake left 3-5 cm of cloth inside the body
// (L05's lower front, L12's hips: lifts to 49 mm) that is a plateau of skin-shape with a 3-ring cliff at its edge, a lump. A cloth carries a
// lift by its own mechanics instead: here a few position-based iterations on the cloth near the contact (the inside vertices and `solveRings`
// rings round them; the rest of the garment is the boundary, held where the bake put it): (a) the skin as collider (every vertex at least
// `floor` outside, along the smoothed outward normal), (b) stretch: each edge no longer than its posed length as baked (cloth barely
// stretches; it may slacken and fold), (c) bending: each vertex keeps its bake's Laplacian (its fold relative to its ring), so the bake's
// drape is carried and the lift falls off as the cloth's own curvature allows, not as a chosen spread. No shape or number per person: the
// same contact offset, iteration count and stiffnesses for every garment and body.
export const CONTACT8_VERSION = 4;   // (c8 it1: the solve is the only cloth path; `rounds` and `maxLift` are the rigid pieces' (buttons): a piece lifts whole)
export const CONTACT8_DEFAULT = { floor: 0.0015, maxLift: 0.04, reach: 0.05, rounds: 3, groups: ['garment'], normalRings: 8,
  solveRings: 8, iters: 40, stretch: 1.0, bend: 0.5 };

// (c7 it2) the cloth solve near the contact: X posed (metres, modified in place); returns the per-vertex lift magnitude
function solveLift8(X, nb0, S, C, B) {
  // seams: vertices coincident in the bind are one point of the cloth (the panels' two edges sewn): solved as one, their rings merged
  const grp = new Map(), gid = new Int32Array(nb0.length).fill(-1), G = []; if (B) { for (let v = 0; v < nb0.length; v++) { const k = `${Math.round(B[v * 3] * 2e4)},${Math.round(B[v * 3 + 1] * 2e4)},${Math.round(B[v * 3 + 2] * 2e4)}`; let g = grp.get(k); if (g === undefined) { g = G.length; grp.set(k, g); G.push([]); } G[g].push(v); gid[v] = g; } }
  const nb = B ? nb0.map((L, v) => { const M = G[gid[v]]; if (M.length < 2) return L; const s = new Set(); for (const w of M) for (const u of nb0[w]) if (u !== v) s.add(u); for (const w of M) if (w !== v) s.delete(w); return Int32Array.from(s); }) : nb0;
  const weld = P => { for (const M of G) if (M.length > 1) { let x = 0, y = 0, z = 0; for (const v of M) { x += P[v * 3]; y += P[v * 3 + 1]; z += P[v * 3 + 2]; } const k = 1 / M.length; for (const v of M) { P[v * 3] = x * k; P[v * 3 + 1] = y * k; P[v * 3 + 2] = z * k; } } };
  const n = nb.length, X0 = Float64Array.from(X), act = new Uint8Array(n), lift = new Float64Array(n);
  let front = []; for (let v = 0; v < n; v++) { const c = S.closestAny(X[v * 3], X[v * 3 + 1], X[v * 3 + 2], C.reach); if (c && c.d < C.floor) { act[v] = 1; front.push(v); } }
  if (!front.length) return lift;
  for (let r = 0; r < C.solveRings; r++) { const nx = []; for (const v of front) for (const u of nb[v]) if (!act[u]) { act[u] = 1; nx.push(u); } front = nx; }
  for (const M of G) if (M.length > 1 && M.some(v => act[v])) for (const v of M) act[v] = 1;   // a seam point is active on both panels
  const A = []; for (let v = 0; v < n; v++) if (act[v]) A.push(v);
  // rest: the posed edge lengths and Laplacians of the cloth as baked
  const E = [], L0 = []; for (const v of A) for (const u of nb[v]) if (u > v || !act[u]) { E.push(v, u); L0.push(Math.hypot(X0[v * 3] - X0[u * 3], X0[v * 3 + 1] - X0[u * 3 + 1], X0[v * 3 + 2] - X0[u * 3 + 2])); }
  const lap = (P, v, o) => { const L = nb[v]; let x = 0, y = 0, z = 0; for (const u of L) { x += P[u * 3]; y += P[u * 3 + 1]; z += P[u * 3 + 2]; } const k = 1 / L.length; o[0] = x * k - P[v * 3]; o[1] = y * k - P[v * 3 + 1]; o[2] = z * k - P[v * 3 + 2]; };
  const D0 = new Float64Array(n * 3), t = [0, 0, 0]; for (const v of A) if (nb[v].length) { lap(X0, v, t); D0[v * 3] = t[0]; D0[v * 3 + 1] = t[1]; D0[v * 3 + 2] = t[2]; }
  const collide = () => { for (const v of A) { const c = S.closestAny(X[v * 3], X[v * 3 + 1], X[v * 3 + 2], C.reach); if (!c || c.d >= C.floor) continue; const k = C.floor - c.d; X[v * 3] += c.nx * k; X[v * 3 + 1] += c.ny * k; X[v * 3 + 2] += c.nz * k; } };
  collide();
  for (let it = 0; it < C.iters; it++) {
    // bending: move toward the bake's own fold relative to the ring (Jacobi)
    const Y = Float64Array.from(X); for (const v of A) { if (!nb[v].length) continue; lap(X, v, t); for (let q = 0; q < 3; q++) Y[v * 3 + q] += C.bend * (t[q] - D0[v * 3 + q]); } X.set(Y);
    // stretch: no edge longer than baked (inactive ends held)
    for (let e = 0; e < E.length; e += 2) { const a = E[e], b = E[e + 1], dx = X[b * 3] - X[a * 3], dy = X[b * 3 + 1] - X[a * 3 + 1], dz = X[b * 3 + 2] - X[a * 3 + 2], l = Math.hypot(dx, dy, dz), l0 = L0[e >> 1];
      if (l <= l0 || !l) continue; const wa = act[a] ? 1 : 0, wb = act[b] && b !== a ? 1 : 0, w = wa + wb; if (!w) continue; const k = C.stretch * (l - l0) / l / w;
      if (wa) { X[a * 3] += dx * k; X[a * 3 + 1] += dy * k; X[a * 3 + 2] += dz * k; } if (wb) { X[b * 3] -= dx * k; X[b * 3 + 1] -= dy * k; X[b * 3 + 2] -= dz * k; } }
    collide(); weld(X); }
  collide();
  for (const v of A) lift[v] = Math.hypot(X[v * 3] - X0[v * 3], X[v * 3 + 1] - X0[v * 3 + 1], X[v * 3 + 2] - X0[v * 3 + 2]);
  return lift;
}

// the posed body as a SurfaceMesh signed by its smoothed outward normals (rings = 0: the plain area-weighted vertex normals)
export function bodySurface8(B, T, rings = CONTACT8_DEFAULT.normalRings) {
  return new SurfaceMesh(B, T, rings > 0 ? { cell: 0.02, normals: smoothNormals8(B, T, B.length / 3, rings) } : { cell: 0.02 }); }

function adjacency(T, n) { const nb = Array.from({ length: n }, () => new Set()); for (let t = 0; t < T.length; t += 3) { const a = T[t], b = T[t + 1], c = T[t + 2]; nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b); } return nb.map(s => Int32Array.from(s)); }

// partMesh2's posed normals (person/core.js, CLOTH8 seam (b)), rebuilt after the bind moved: the cloth's normals as posed, welded across
// seams by bind position, each turned back through its vertex's blend
export function posedNormals8(g, M) {
  const X = g.attributes.position.array, n = X.length / 3, SI = g.attributes.skinIndex?.array, SW = g.attributes.skinWeight?.array, N = g.attributes.normal?.array; if (!SI || !SW || !N) return 0;
  const T = g.index.array, Pp = skinPose(Float64Array.from(X), SI, SW, M, new Float64Array(n * 3), 1), NP = vertexNormals(Pp, T, new Float64Array(n * 3));
  const key = i => `${Math.round(X[i * 3] * 2e4)},${Math.round(X[i * 3 + 1] * 2e4)},${Math.round(X[i * 3 + 2] * 2e4)}`, grp = new Map();
  for (let i = 0; i < n; i++) { const k = key(i); if (!grp.has(k)) grp.set(k, []); grp.get(k).push(i); }
  for (const L of grp.values()) if (L.length > 1) { let x = 0, y = 0, z = 0; for (const i of L) { x += NP[i * 3]; y += NP[i * 3 + 1]; z += NP[i * 3 + 2]; } for (const i of L) { NP[i * 3] = x; NP[i * 3 + 1] = y; NP[i * 3 + 2] = z; } }
  let kept = 0; for (let v = 0; v < n; v++) { const A = [0, 0, 0, 0, 0, 0, 0, 0, 0]; for (let k = 0; k < 4; k++) { const w = SW[v * 4 + k]; if (!w) continue; const m = SI[v * 4 + k] * 16; for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) A[c * 3 + r] += w * M[m + c * 4 + r]; }
    const a = A[0], b = A[3], c = A[6], d = A[1], e = A[4], f = A[7], g2 = A[2], hh = A[5], ii = A[8], det = a * (e * ii - f * hh) - b * (d * ii - f * g2) + c * (d * hh - e * g2), px = NP[v * 3], py = NP[v * 3 + 1], pz = NP[v * 3 + 2];
    if (Math.abs(det) < 1e-9 || !(px || py || pz)) { kept++; continue; }
    const nx = ((e * ii - f * hh) * px + (c * hh - b * ii) * py + (b * f - c * e) * pz) / det, ny = ((f * g2 - d * ii) * px + (a * ii - c * g2) * py + (c * d - a * f) * pz) / det, nz = ((d * hh - e * g2) * px + (b * g2 - a * hh) * py + (a * e - b * d) * pz) / det, l = Math.hypot(nx, ny, nz) || 1;
    N[v * 3] = nx / l; N[v * 3 + 1] = ny / l; N[v * 3 + 2] = nz / l; }
  g.attributes.normal.needsUpdate = true; return kept;
}

// the normals as the part was built: posed (partMesh2's posedNormals, flagged on the geometry) or the bind's own
function renormal8(m, M) { const g = m.geometry; if (g.userData.posedNormals && !m.userData.k3?.solid && g.attributes.skinIndex) posedNormals8(g, M); else g.computeVertexNormals(); }

// connected components of a mesh (a solid construction part, e.g. a row of buttons, lifts each piece as a whole)
function components(nb) { const n = nb.length, c = new Int32Array(n).fill(-1); let k = 0; for (let s = 0; s < n; s++) { if (c[s] >= 0) continue; const st = [s]; c[s] = k; while (st.length) { const v = st.pop(); for (const u of nb[v]) if (c[u] < 0) { c[u] = k; st.push(u); } } k++; } return { c, k }; }

// one skinned part kept `floor` outside the posed skin S: cloth by the solve (solveLift8), a solid part per piece (rigid), back to the
// bind. -> report
function liftPart8(m, S, M, sc, C) {
  const pg = m.geometry, n = pg.attributes.position.count, B = pg.attributes.position.array, SI = pg.attributes.skinIndex.array, SW = pg.attributes.skinWeight.array, nb = adjacency(pg.index.array, n), solid = !!m.userData.k3?.solid;
  const r = { verts: n, inside: 0, deep4: 0, lifted: 0, maxLiftMm: 0, after: 0 }, lift = new Float64Array(n), out = [0, 0, 0], CC = solid ? components(nb) : null;
  const X = skinPose(Float64Array.from(B), SI, SW, M, new Float64Array(n * 3), sc);
  if (!solid) { // (c7 it2) cloth: the solve
    for (let v = 0; v < n; v++) { const c = S.closestAny(X[v * 3], X[v * 3 + 1], X[v * 3 + 2], C.reach); if (c && c.d < 0) { r.inside++; if (c.d < -0.004) r.deep4++; } }
    lift.set(solveLift8(X, nb, S, C, B)); for (let v = 0; v < n; v++) if (lift[v] < 1e-7) lift[v] = 0; }
  else for (let round = 0; round < C.rounds; round++) {   // a rigid piece (buttons): its largest need along its mean direction, whole
    const need = new Float64Array(n), dir = new Float64Array(n * 3); let any = 0;
    for (let v = 0; v < n; v++) { const c = S.closestAny(X[v * 3], X[v * 3 + 1], X[v * 3 + 2], C.reach); if (!c) continue; dir[v * 3] = c.nx; dir[v * 3 + 1] = c.ny; dir[v * 3 + 2] = c.nz;
      if (round === 0 && c.d < 0) { r.inside++; if (c.d < -0.004) r.deep4++; }
      if (c.d < C.floor) { need[v] = Math.min(C.maxLift, C.floor - c.d); any++; } }
    if (!any) break;
    { const mx = new Float64Array(CC.k), D = new Float64Array(CC.k * 3); for (let v = 0; v < n; v++) { const k = CC.c[v]; if (need[v] > mx[k]) mx[k] = need[v]; if (need[v] > 0) for (let q = 0; q < 3; q++) D[k * 3 + q] += dir[v * 3 + q] * need[v]; }
      for (let k = 0; k < CC.k; k++) { const l = Math.hypot(D[k * 3], D[k * 3 + 1], D[k * 3 + 2]) || 1; for (let q = 0; q < 3; q++) D[k * 3 + q] /= l; }
      for (let v = 0; v < n; v++) { const k = CC.c[v]; need[v] = mx[k]; for (let q = 0; q < 3; q++) dir[v * 3 + q] = D[k * 3 + q]; } }
    for (let v = 0; v < n; v++) if (need[v] > 0) { for (let q = 0; q < 3; q++) X[v * 3 + q] += dir[v * 3 + q] * need[v]; lift[v] += need[v]; } }
  for (let v = 0; v < n; v++) { const c = S.closestAny(X[v * 3], X[v * 3 + 1], X[v * 3 + 2], C.reach); if (c && c.d < 0) r.after++; }
  // back to the bind through each vertex's blend (posed metres -> hero units)
  for (let v = 0; v < n; v++) { if (!lift[v]) continue; if (!blendInverse(SI, SW, v, M, X[v * 3] / sc, X[v * 3 + 1] / sc, X[v * 3 + 2] / sc, out)) continue;
    B[v * 3] = out[0]; B[v * 3 + 1] = out[1]; B[v * 3 + 2] = out[2]; r.lifted++; r.maxLiftMm = Math.max(r.maxLiftMm, +(lift[v] * 1000).toFixed(1)); }
  if (r.lifted) { pg.attributes.position.needsUpdate = true; renormal8(m, M); pg.computeBoundingSphere?.(); }
  return r;
}

export function contactPerson8(P, o = {}) {
  const C = { ...CONTACT8_DEFAULT, ...(o && typeof o === 'object' ? o : {}) }, h = P.h, g = h?.body?.geometry; if (!g) return { skipped: 'no body' };
  const G = (P.parts || []).filter(m => C.groups.includes(m.userData?.k3?.group) && m.geometry?.attributes?.skinIndex); if (!G.length) return { skipped: 'no garments' };
  const S8 = (P.parts || []).filter(m => m.userData?.k3?.group === 'construction' && m.geometry?.attributes?.skinIndex);
  h.update?.(); h.group.updateMatrixWorld(true); const M = boneMats(h.skeleton, h.body.matrixWorld), sc = heroScale(h);
  const T = Int32Array.from(g.userData.plan?.tri || g.index.array), bx = Float64Array.from(g.attributes.position.array);
  const S = bodySurface8(skinPose(bx, g.attributes.skinIndex.array, g.attributes.skinWeight.array, M, new Float64Array(bx.length), sc), T, C.normalRings);
  // the garments merged (bind, hero units) for carrying the construction: offsets per garment
  const offs = [], tot = G.reduce((a, m) => { offs.push(a); return a + m.geometry.attributes.position.count; }, 0), Xg0 = new Float64Array(tot * 3), Tg = [];
  G.forEach((m, i) => { Xg0.set(m.geometry.attributes.position.array, offs[i] * 3); for (const t of m.geometry.index.array) Tg.push(t + offs[i]); });
  const Tgi = Int32Array.from(Tg), carry = S8.map(m => ({ m, B: bind8(Float64Array.from(m.geometry.attributes.position.array), Xg0, Tgi, { reach: 0.03 / sc }) }));
  const rep = { version: CONTACT8_VERSION, floorMm: C.floor * 1000, garments: {}, construction: {} };
  G.forEach((m, gi) => { rep.garments[`${m.userData.k3.name}#${gi}`] = liftPart8(m, S, M, sc, C); });
  const Xg1 = new Float64Array(tot * 3); G.forEach((m, i) => Xg1.set(m.geometry.attributes.position.array, offs[i] * 3));
  // the construction sewn on the garments follows them (only where its garment triangle moved), then keeps the same offset off the skin itself
  const mv = new Uint8Array(tot); let movedAny = false; for (let v = 0; v < tot * 3; v++) if (Xg1[v] !== Xg0[v]) { mv[Math.floor(v / 3)] = 1; movedAny = true; }
  rep.carried = 0; for (const { m, B } of carry) { const a = m.geometry.attributes.position, Xq = Float64Array.from(a.array), k = movedAny ? place8(B, Xg1, Tgi, Xq, mv) : 0;
    if (k) { a.array.set(Xq); a.needsUpdate = true; rep.carried += k; renormal8(m, M); m.geometry.computeBoundingSphere?.(); }
    const r = liftPart8(m, S, M, sc, C); if (r.inside || r.lifted) rep.construction[m.userData.k3.name] = r; }
  return rep;
}
