// ANATOMY / PELVIS (ANAT8-PELVIS, round 7, 8 Oct 2026; NOTES: review/studio_human_c8/after/anat8_pelvis/NOTES.md): the HIPS, WAIST, GROIN and
// BUTTOCKS built from the anatomy, for the soft-tissue solver (ANAT8-BODY's lib/fx/anatomy/soft/) to load under gravity. Opt-in: nothing imports this
// unless it asks; v6 and every rev untouched. Version 1 (iteration 1): the region's muscles, the fat compartments UNLOADED, the zones of adherence,
// and the solver's input as a LAYERED TET MESH (prisms between the deep fascia, the SFS and the fat's outer face, split into tetrahedra).
//   import { pelvisRegion } from '.../lib/fx/anatomy/pelvis/index.js';
//   const R = pelvisRegion(B, K, M, { rec })     B = bodyOf(...), K = buildSkeleton(B), M = buildMuscles(B, K, { rec })
//   R = { name: 'pelvis', version, X0 (Float64Array, nodes x 3, metres, bind space: x lateral (L = +x), y up, z forward), tets (Uint32Array x 4),
//         tetMat (Uint8Array: index into mats), mats: [{ name, E (Pa), nu, rho (kg/m3), source }],
//         layers: { nv, deep: [node...], sfs: [node...], outer: [node...] }  (node = layer * nv + vertex: 0 the deep fascia, 1 the SFS, 2 the fat's face),
//         surf: { tri (the region's triangles, vertex ids), skin: { nodes: outer, E, t, nu, bend }, sfs: { nodes: sfs, E, t, nu } },
//         boundary: { deep: { nodes, mode: 'slide' | 'bonded' per node (Uint8: 1 slide), d (the deep layer's SDF) }, held: [node...] },
//         tethers: [{ name, skin: [node...], anchor: [[x, y, z]...], k (N/m per cm of line, relative), slackMm }],
//         gravity: [0, -9.81, 0], pose: 'bind', parts: { muscles (the region's new muscle parts), lines (the zones of adherence) }, fat (the build), info }
import { buildPelvisMuscles } from './muscles.js';
import { adherenceLines } from './tethers.js';
import { buildPelvisFat } from './fat.js';
import { sdParts } from '../skeleton/sdf.js';
export { buildPelvisMuscles, PELVIS_MUSCLE_REF, femurFrame } from './muscles.js';
export { buildThigh, THIGH_MUSCLES, PELVIS_THIGH_VERSION } from './thigh.js';
export { adherenceLines } from './tethers.js';
export { buildPelvisFat, regionMesh, DEPOTS, SIGMA, ADIPOSE_PER_LIPID } from './fat.js';
export const PELVIS_VERSION = 17;   // (lane iteration 21) the deep fascia a TENSION MEMBRANE over the packed muscles (fat v10): spans by its tension, follows by the pressure over it, fused to the periosteum, no cap to the body before; earlier versions: git history
// the tissues' moduli (initial, small-strain; the solver's inputs, to verify): subcutaneous fat ~1-3 kPa (Samani et al 2007, Phys Med Biol 52:1565:
// breast fat 3.25 +- 0.91 kPa; Comley and Fleck 2010, ~1 kPa in slow loading): the deep layer's large loose lobules softer than the superficial
// layer's small septate ones (Markman and Barton 1987: the structure; the ratio is this model's assumption); the SFS a collagenous membrane (MPa
// range; an estimate); the skin ~0.4 MPa young to ~0.85 MPa older, 1.8-2.1 mm thick (Agache et al 1980).
export function tissueMats(B) {
  const age = B.age ?? 35, skinE = 0.42e6 + 0.0105e6 * Math.max(0, age - 20);
  return { mats: [{ name: 'fatSuperficial', E: 2.5e3, nu: 0.49, rho: 920, source: 'Samani 2007; Comley and Fleck 2010 (range)' },
    { name: 'fatDeep', E: 1.2e3, nu: 0.49, rho: 920, source: 'softer than the superficial (Markman and Barton 1987: looser lobules; ratio assumed)' }],
    skin: { E: skinE, nu: 0.48, t: B.sex === 'f' ? 0.0018 : 0.0021, bend: 1, source: 'Agache et al 1980 (E by age, recalled)' },
    sfs: { E: 2.0e6, nu: 0.45, t: 0.0006, source: 'collagenous membrane, MPa range (an estimate)' } };
}
export function pelvisRegion(B, K, M, opts = {}) {
  const t0 = Date.now(), PM = opts.muscles || buildPelvisMuscles(B, K, M, opts), lines = adherenceLines(B, K, opts);
  const deepParts = K.parts.concat(M ? M.parts : [], PM.parts), Fz = buildPelvisFat(B, K, deepParts, lines, opts);
  const { n, deep: Q, deepN: Md, tri } = Fz.mesh, minT = 0.0015, X0 = new Float64Array(3 * n * 3);
  for (let i = 0; i < n; i++) { const d = Math.max(minT, Fz.t[i]), s = Math.max(minT, Fz.s[i]);
    for (let c = 0; c < 3; c++) { X0[i * 3 + c] = Q[i * 3 + c]; X0[(n + i) * 3 + c] = Q[i * 3 + c] + Md[i * 3 + c] * d; X0[(2 * n + i) * 3 + c] = Q[i * 3 + c] + Md[i * 3 + c] * (d + s); } }
  // prisms -> tets: each triangle's vertices sorted (a < b < c); (a b c a') (b c a' b') (c a' b' c'): conforming across shared quads (the diagonal
  // always joins the top of the smaller index to the bottom of the larger)
  const tets = [], mat = [], vol = (p, q, r, s) => { const a = [0, 1, 2].map(c => X0[q * 3 + c] - X0[p * 3 + c]), b = [0, 1, 2].map(c => X0[r * 3 + c] - X0[p * 3 + c]), d = [0, 1, 2].map(c => X0[s * 3 + c] - X0[p * 3 + c]);
    return (a[0] * (b[1] * d[2] - b[2] * d[1]) - a[1] * (b[0] * d[2] - b[2] * d[0]) + a[2] * (b[0] * d[1] - b[1] * d[0])) / 6; };
  let flipped = 0;
  for (let L = 0; L < 2; L++) for (let k = 0; k < tri.length; k += 3) { const v = [tri[k], tri[k + 1], tri[k + 2]].sort((p, q) => p - q); if (v.some(i => Fz.held[i])) continue;
    const lo = v.map(i => L * n + i), hi = v.map(i => (L + 1) * n + i);
    for (const T of [[lo[0], lo[1], lo[2], hi[0]], [lo[1], lo[2], hi[0], hi[1]], [lo[2], hi[0], hi[1], hi[2]]]) { if (vol(...T) < 0) { [T[0], T[1]] = [T[1], T[0]]; flipped++; } tets.push(...T); mat.push(L === 0 ? 1 : 0); } }
  const nv = n, layer = L => Array.from({ length: nv }, (_, i) => L * nv + i);
  // the region's edge (top, bottom) and the held perineum: held; the deep layer slides on the deep fascia except where the SFS is bound (adherence)
  const edge = new Uint8Array(n), cnt = new Map(); for (let k = 0; k < tri.length; k += 3) for (const [a, b] of [[tri[k], tri[k + 1]], [tri[k + 1], tri[k + 2]], [tri[k + 2], tri[k]]]) { const key = a < b ? a * 1e7 + b : b * 1e7 + a; cnt.set(key, (cnt.get(key) || 0) + 1); }
  for (const [key, c] of cnt) if (c === 1) { edge[Math.floor(key / 1e7)] = 1; edge[key % 1e7] = 1; }
  const held = []; for (let i = 0; i < n; i++) if (edge[i] || Fz.held[i]) held.push(i, n + i, 2 * n + i);
  const slide = new Uint8Array(n); for (let i = 0; i < n; i++) slide[i] = Fz.pinned[i] ? 0 : 1;
  const tethers = Fz.lines.map((L, k) => { const nodes = [], anchor = []; if (L.binds !== 'sfs') for (let i = 0; i < n; i++) if (Fz.pinBy[i] === k && !Fz.held[i]) { nodes.push(2 * n + i); anchor.push([Q[i * 3], Q[i * 3 + 1], Q[i * 3 + 2]]); }
    return { name: L.name, skin: nodes, anchor, k: L.k, slackMm: L.slackMm, source: L.source }; }).filter(t => t.skin.length);
  const TM = tissueMats(B), parts = deepParts.filter(p => p.bb[1] < Fz.region.yHi + 0.05 && p.bb[4] > Fz.region.yLo - 0.05);
  return { name: 'pelvis', version: PELVIS_VERSION, X0, tets: Uint32Array.from(tets), tetMat: Uint8Array.from(mat), mats: TM.mats,
    layers: { nv, deep: layer(0), sfs: layer(1), outer: layer(2) }, surf: { tri, skin: { nodes: layer(2), ...TM.skin }, sfs: { nodes: layer(1), ...TM.sfs } },
    boundary: { deep: { nodes: layer(0), slide, d: (x, y, z) => sdParts(parts, x, y, z, 0.12).d }, held },
    tethers, gravity: [0, -9.81, 0], pose: 'bind', parts: { muscles: PM.parts, lines }, fat: Fz,
    info: { ms: Date.now() - t0, nodes: X0.length / 3, tets: tets.length / 4, flipped, muscles: PM.info, fat: Fz.info } };
}

// THE SOFT/ CONTRACT (ANAT8-BODY's soft/index.js buildSoft(R), the API adopted in their NOTES S5 with its DIFFs; iteration 1 builds the adapter, the
// solve is iteration 2's change). From the region's per-vertex layers (deep point Q, normal, deep t, superficial s) it answers:
//   fieldF(u, v, w) -> { d (< 0 inside the fat, ~metres), comp (0 superficial, 1 deep), label ('base' near the deep fascia, 'skin' near the outer
//   face, 'cut' at the region's open edges and at the held perineum) }; solids.dg (the deep fascia, signed, from the same vertices); the skin membrane
//   (J-curve as soft/breast.js), the deep interface 'base' sliding (the loose areolar layer under the deep fat), the zones of adherence as line tethers
//   (the IMF's stiffness class: 5000 N/m a point at ~1 cm, x the line's relative k), the region's top and bottom planes held, the track points.
// (v12, lane iteration 15) THE OTHER THIGH: below the perineum each thigh's skin is kept on its own side of the contact face (the midplane, resolved to
// half a grid cell: fat.js 7b), the contact of two soft bodies symmetric about it (each against the other = each against a wall at the face). Unilateral
// (soft/'s colliders): a skin point is pushed back only where it would cross; nothing is placed. The medial quarter of each thigh's skin is tested.
export function contactColliders(yCt, gap) {
  if (!Number.isFinite(yCt) || !(gap > 0)) return [];
  const near = (p0, lab, s) => lab === 'skin' && s * p0[0] > 0 && s * p0[0] < 0.06 && p0[1] < yCt + 0.01;
  return [{ name: 'the other thigh (left skin)', dg: (x, y, z, g) => { if (g) { g[0] = 1; g[1] = 0; g[2] = 0; } return x; }, applies: (p0, lab) => near(p0, lab, 1), margin: gap },
    { name: 'the other thigh (right skin)', dg: (x, y, z, g) => { if (g) { g[0] = -1; g[1] = 0; g[2] = 0; } return -x; }, applies: (p0, lab) => near(p0, lab, -1), margin: gap }];
}
export function pelvisSoftRegion(B, R, opts = {}) {
  const Fz = R.fat, { n, deep: Q, deepN: Md } = Fz.mesh, T = new Float64Array(n), skinT = R.surf.skin.t, h = opts.h ?? 0.006, cellS = 0.02, hash = new Map();
  const V2 = true;   // (one current version: the switch is gone; the name kept for the lines below)
  for (let i = 0; i < n; i++) T[i] = Fz.held[i] ? 0 : Fz.s[i] + Fz.t[i] + skinT;
  // v2: the layer's outer face is the (seam-blended) envelope itself: its offset from the deep point along the normal
  if (V2 && Fz.blend) { const E = Fz.envelope; for (let i = 0; i < n; i++) T[i] = Fz.held[i] ? 0 : Math.max(0, (E[i * 3] - Q[i * 3]) * Md[i * 3] + (E[i * 3 + 1] - Q[i * 3 + 1]) * Md[i * 3 + 1] + (E[i * 3 + 2] - Q[i * 3 + 2]) * Md[i * 3 + 2]); }
  const edge = new Uint8Array(n); for (let i = 0; i < R.boundary.held.length; i += 3) edge[R.boundary.held[i]] = 1;
  // the HELD STRIP's margin (iteration 2 restart): the perineum and the inner thighs' root are not modelled (v6 kept), and within a 6-8 mm grid the
  // two thighs' and the perineum's sheets fall into the same cells, whose contradictory deep-fascia constraints blew the solve up at the groin at
  // t = 0.05 s. The tissue within MARGIN (along the skin) of the strip is left OUT of the solve (its skin keeps the envelope, which the seam blend
  // already brings to v6 there); the solved tissue's edge there is a free boundary.
  const excl = new Uint8Array(n); if (V2) { const MARGIN = opts.heldMargin ?? 0.015, adj = Array.from({ length: n }, () => []), tri0 = Fz.mesh.tri, X = Fz.mesh.pos;
    for (let k = 0; k < tri0.length; k += 3) for (const [a, b] of [[tri0[k], tri0[k + 1]], [tri0[k + 1], tri0[k + 2]], [tri0[k + 2], tri0[k]]]) { adj[a].push(b); adj[b].push(a); }
    const dist = new Float64Array(n).fill(Infinity), queue = []; for (let i = 0; i < n; i++) if (Fz.held[i]) { dist[i] = 0; queue.push(i); }
    for (let it = 0; it < 400 && queue.length; it++) { const next = []; for (const i of queue) for (const j of adj[i]) { const d = dist[i] + Math.hypot(X[i * 3] - X[j * 3], X[i * 3 + 1] - X[j * 3 + 1], X[i * 3 + 2] - X[j * 3 + 2]); if (d < dist[j] && d < MARGIN * 2) { dist[j] = d; next.push(j); } } queue.length = 0; queue.push(...new Set(next)); }
    for (let i = 0; i < n; i++) if (Fz.held[i] || dist[i] < MARGIN) { excl[i] = 1; T[i] = 0; } }
  const kk = (a, b, c) => (a * 73856093) ^ (b * 19349663) ^ (c * 83492791);
  // (v12, lane iteration 15) THE TWO THIGHS ARE TWO BODIES below the perineum (fat.js 7b): a point there reads only its own thigh's columns (sideX),
  // the grid's cells never span both (the box below puts the midplane at a cell centre and the field is empty within the contact gap of it), and each
  // thigh's skin is kept on its own side of the contact face by the other thigh (the colliders below). Above the perineum's bottom the region is one
  // body across the midline, as before.
  const CT = Fz.contact || { gap: 0, yTop: -Infinity }, yCt = Number.isFinite(CT.yTop) ? CT.yTop : -Infinity, gapC = CT.gap || 0, Xm = Fz.mesh.pos;
  const lowCol = new Uint8Array(n), sideX = new Int8Array(n); for (let i = 0; i < n; i++) { sideX[i] = Xm[i * 3] >= 0 ? 1 : -1; lowCol[i] = Xm[i * 3 + 1] < yCt + 0.02 ? 1 : 0; }
  const otherThigh = (i, x, y) => lowCol[i] && y < yCt + 0.02 && sideX[i] !== (x >= 0 ? 1 : -1);
  // the lookup (iteration 2 fix, the solve exploded at the groin and the cleft: the old one ranked a region vertex by its IN-PLANE distance only, so a
  // point in the left inner thigh's fat could take the right thigh's vertex across the gap as its nearest, its w measured on the wrong plane): each
  // vertex's COLUMN (the deep point Q to the fat's face Q + n T, and 12 mm past it) is hashed in every cell it crosses, and a vertex ranks by the 3D
  // distance from the point to its column (d2 = in-plane r2 + the overshoot along n beyond [0, T]), so a point always reads the layer it is in.
  const colTop = i => T[i] + 0.012, stamp = new Int32Array(n).fill(-1); let qid = 0;
  for (let i = 0; i < n; i++) { const L = colTop(i), ns = Math.max(1, Math.ceil((L + 0.004) / (cellS / 2))), seen = new Set();
    for (let s = 0; s <= ns; s++) { const w = -0.004 + (L + 0.004) * s / ns, x = Q[i * 3] + Md[i * 3] * w, y = Q[i * 3 + 1] + Md[i * 3 + 1] * w, z = Q[i * 3 + 2] + Md[i * 3 + 2] * w;
      const k = kk(Math.floor(x / cellS), Math.floor(y / cellS), Math.floor(z / cellS)); if (seen.has(k)) continue; seen.add(k); if (!hash.has(k)) hash.set(k, []); hash.get(k).push(i); } }
  // every column within RC of the point, weighted by a compactly supported kernel (1 - d2 / RC^2)^2: the field and the deep fascia's distance are then
  // CONTINUOUS as a point moves (a K-nearest set with inverse-distance weights jumps when the set changes: in the groin's crease, where the columns'
  // normals disagree, the solve's sliding interface read a jumping plane and blew up at t = 0.05 s, iteration 2 restart)
  const RC = 0.02, RC2 = RC * RC;
  const near = (x, y, z, K = 0) => { const cx = Math.floor(x / cellS), cy = Math.floor(y / cellS), cz = Math.floor(z / cellS), best = []; qid++;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) { const L = hash.get(kk(cx + a, cy + b, cz + c)); if (!L) continue;
      for (const i of L) { if (stamp[i] === qid) continue; stamp[i] = qid; if (otherThigh(i, x, y)) continue; const dx = x - Q[i * 3], dy = y - Q[i * 3 + 1], dz = z - Q[i * 3 + 2], w = dx * Md[i * 3] + dy * Md[i * 3 + 1] + dz * Md[i * 3 + 2], r2 = Math.max(0, dx * dx + dy * dy + dz * dz - w * w);
        const ov = w < 0 ? -w : w > T[i] ? w - T[i] : 0, d2 = r2 + ov * ov; if (d2 >= RC2) continue; const k = 1 - d2 / RC2; best.push({ i, r2, w, d2, a: k * k }); } }
    best.sort((p, q) => p.d2 - q.d2); return K > 0 ? best.slice(0, K) : best; };
  const fieldF = (x, y, z) => { const N = near(x, y, z); if (!N.length) return { d: 0.04, comp: 0, label: 'cut' };
    let sw = 0, w = 0, t = 0, td = 0, ed = 0, ex = 0; for (const q of N) { const a = q.a; sw += a; w += a * q.w; t += a * T[q.i]; td += a * Fz.t[q.i]; ed += a * (edge[q.i] || Fz.held[q.i] ? 1 : 0); ex += a * excl[q.i]; }
    w /= sw; t /= sw; td /= sw; ed /= sw; ex /= sw; const r = Math.sqrt(N[0].r2);
    let d = Math.max(-w, w - t); if (r > 0.012) d = Math.max(d, r - 0.012); if (ex > 0.5) { d = Math.max(d, 0.002); }                                   // beyond the region's surface parameterisation: outside
    let label = ed > 0.5 || ex > 0.3 || r > 0.012 ? 'cut' : (w < t - w ? 'base' : 'skin');
    if (y < yCt && Math.abs(x) < gapC) { d = Math.max(d, gapC - Math.abs(x)); if (label !== 'cut') label = 'skin'; }                                   // (v12) the contact face: between the thighs, nothing
    return { d, comp: w > td ? 0 : 1, label }; };
  // the deep fascia's signed distance for the sliding interface: w(x) = sum a_i w_i / sum a_i over the columns in reach, its gradient ANALYTIC (the
  // kernel's own gradient included), returned as the unit direction with w / |grad w| (iteration 2 restart: the blended NORMAL used as the gradient was not
  // the constraint's gradient in the groin's crease, and the stiff interface pumped energy into the solve until it exploded)
  // the solve calls dg ~10^4 times a step at the base points, which barely move: their columns are cached per 5 mm cell (every column within RC + the
  // cell's half-diagonal of the cell's centre: the triangle inequality keeps every column within RC of any point in the cell)
  const DC = 0.005, dcache = new Map(), RCc = RC + DC * 0.87;
  const nearC = (x, y, z) => { const ix = Math.floor(x / DC), iy = Math.floor(y / DC), iz = Math.floor(z / DC), key = kk(ix, iy, iz); let L = dcache.get(key);
    if (!L) { const cx = (ix + 0.5) * DC, cy = (iy + 0.5) * DC, cz = (iz + 0.5) * DC, hx = Math.floor(cx / cellS), hy = Math.floor(cy / cellS), hz = Math.floor(cz / cellS), out = []; qid++;
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let c = -2; c <= 2; c++) { const H = hash.get(kk(hx + a, hy + b, hz + c)); if (!H) continue;
        for (const i of H) { if (stamp[i] === qid) continue; stamp[i] = qid; if (otherThigh(i, cx, cy)) continue; const dx = cx - Q[i * 3], dy = cy - Q[i * 3 + 1], dz = cz - Q[i * 3 + 2], w = dx * Md[i * 3] + dy * Md[i * 3 + 1] + dz * Md[i * 3 + 2], r2 = Math.max(0, dx * dx + dy * dy + dz * dz - w * w), ov = w < 0 ? -w : w > T[i] ? w - T[i] : 0;
          if (r2 + ov * ov < RCc * RCc) out.push(i); } }
      L = Int32Array.from(out); dcache.set(key, L); }
    const best = []; for (const i of L) { const dx = x - Q[i * 3], dy = y - Q[i * 3 + 1], dz = z - Q[i * 3 + 2], w = dx * Md[i * 3] + dy * Md[i * 3 + 1] + dz * Md[i * 3 + 2], r2 = Math.max(0, dx * dx + dy * dy + dz * dz - w * w);
      const ov = w < 0 ? -w : w > T[i] ? w - T[i] : 0, d2 = r2 + ov * ov; if (d2 >= RC2) continue; const k = 1 - d2 / RC2; best.push({ i, r2, w, d2, a: k * k }); }
    return best; };
  // a point with no column in reach (a surface-nets vertex just past the last column, at the field's edge): NO constraint (0, a zero gradient), never a
  // made-up distance (a fallback of 5 cm along +z blew L21's solve up at the anterior hip, iteration 2)
  const dg = (x, y, z, g) => { const N = nearC(x, y, z); if (!N.length) { if (g) { g[0] = 0; g[1] = 0; g[2] = 0; } return 0; }
    let S0 = 0, S1 = 0; const gA = [0, 0, 0], gB = [0, 0, 0];   // S0 = sum a, S1 = sum a w; gA = sum grad a, gB = sum (a n + w grad a)
    for (const q of N) { const i = q.i, nx = Md[i * 3], ny = Md[i * 3 + 1], nz = Md[i * 3 + 2], dx = x - Q[i * 3], dy = y - Q[i * 3 + 1], dz = z - Q[i * 3 + 2], w = q.w, t = T[i];
      const ovs = w < 0 ? w : w > t ? w - t : 0, k = 1 - q.d2 / RC2, ga = -4 * k / RC2;   // a = k^2, grad a = 2 k (-1 / RC2) grad d2, grad d2 = 2 (d - w n) + 2 ovs n
      const gdx = 2 * (dx - w * nx) + 2 * ovs * nx, gdy = 2 * (dy - w * ny) + 2 * ovs * ny, gdz = 2 * (dz - w * nz) + 2 * ovs * nz;
      const gax = ga * gdx / 2, gay = ga * gdy / 2, gaz = ga * gdz / 2;
      S0 += q.a; S1 += q.a * w; gA[0] += gax; gA[1] += gay; gA[2] += gaz; gB[0] += q.a * nx + w * gax; gB[1] += q.a * ny + w * gay; gB[2] += q.a * nz + w * gaz; }
    const W = S1 / S0, gx = (gB[0] - W * gA[0]) / S0, gy = (gB[1] - W * gA[1]) / S0, gz = (gB[2] - W * gA[2]) / S0, l = Math.hypot(gx, gy, gz);
    if (!(l > 1e-6)) { let ax = 0, ay = 0, az = 0; for (const q of N) { ax += q.a * Md[q.i * 3]; ay += q.a * Md[q.i * 3 + 1]; az += q.a * Md[q.i * 3 + 2]; } const m = Math.hypot(ax, ay, az) || 1; if (g) { g[0] = ax / m; g[1] = ay / m; g[2] = az / m; } return W; }
    if (g) { g[0] = gx / l; g[1] = gy / l; g[2] = gz / l; } return W / l; };
  const E = Fz.envelope, bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { bb[c] = Math.min(bb[c], E[i * 3 + c], Q[i * 3 + c]); bb[c + 3] = Math.max(bb[c + 3], E[i * 3 + c], Q[i * 3 + c]); }
  // (v12) the midplane at a cell CENTRE (x = 0 mid-cell): with the field empty within the contact gap of it, no cell (and no node) is shared by the
  // two thighs below the perineum
  const kx = Math.ceil((0.01 - bb[0]) / h), box = [-(kx + 0.5) * h, Fz.region.yLo, bb[2] - 0.01, bb[3] + 0.01, Fz.region.yHi, bb[5] + 0.01];
  const age = B.age ?? 35, aw = Math.min(1, Math.max(0, (age - 30) / 30)), lax = Math.max(0, (age - 35) / 55 * 0.8) * 0.1;
  const tethers = R.tethers.map(t => { let L0 = 0; for (let m = 0; m < t.skin.length; m++) { const p = R.X0.subarray(t.skin[m] * 3, t.skin[m] * 3 + 3), a = t.anchor[m]; L0 += Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]); } L0 /= Math.max(1, t.skin.length);
    return { name: t.name, kind: 'retinaculum', skin: t.skin.map(nd => [E[(nd % n) * 3], E[(nd % n) * 3 + 1], E[(nd % n) * 3 + 2]]), anchor: t.anchor, k: 5000 * t.k, slack: t.slackMm / 1000 / Math.max(0.004, L0), source: t.source }; });
  const track = []; for (const L of Fz.lines) if (/^(infragluteal|dimple|lateralGluteal|inguinal)/.test(L.name)) L.deep.forEach((p, m) => { if (m % 3 === 0) { const N = near(...p, 1); if (N.length) { const i = N[0].i; track.push({ name: L.name + ':' + m, p: [E[i * 3], E[i * 3 + 1], E[i * 3 + 2]] }); } } });
  // v2: every hm08 vertex of the region (not held) is a TRACKED material point on the skin: its loaded position is where the solve carries that
  // point of the skin (the correspondence a membrane fit needs; nothing is projected)
  if (V2) for (let i = 0; i < n; i++) if (!Fz.held[i] && !excl[i] && T[i] >= 0.003) track.push({ name: 'v:' + i, p: [E[i * 3], E[i * 3 + 1], E[i * 3 + 2]] });   // (iteration 3) the midpoints too: level 1's vertices
  // v2 MODULI (the solver's tissue model, iteration 2): ANAT8-BODY's finding 26 (soft/breast.js v2): the ex vivo small-strain moduli (Samani 2007, 3.25 kPa)
  // move soft tissue ~1 cm under gravity; the in vivo, gravity-calibrated values are an order lower (Mazier and Bordas 2024, Clin Biomech 111:106153,
  // PubMed 38061204: fat-dominated breast 0.32 kPa, skin 22.7 kPa, calibrated together). v2 relaxes the fat's SHEAR by their ratio (muScale 0.32 / 3.25)
  // with the bulk kept (nearly incompressible), keeps v1's superficial / deep ratio, takes the calibration's skin toe (x v1's age factor) and the
  // small-cell mass floor (R.massFloor 1, ANAT8-BODY's iteration 9).
  const mats = R.mats.map(m => ({ ...m, muScale: 0.32 / 3.25, source: m.source + '; in vivo relaxation x 0.098 (Mazier and Bordas 2024 / Samani 2007)' }));
  const skinM = { name: 'skin', label: 'skin', E: 22.7e3 * (1 + aw), Elin: 20e6, lock: 0.25, t: skinT, laxity: lax, tension: 'field', bend: true, source: 'in vivo toe 22.7 kPa (Mazier and Bordas 2024) x age (Agache 1980, as v1); lock and linear as soft/breast.js; a tension field with its plate bending (soft/ WRINKLING)' };
  return { name: 'pelvis', h, surfH: opts.surfH ?? h, box, frame: { O: [0, 0, 0], ax: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }, fieldF,
    compartments: [{ name: 'fatSuperficial', kind: 'fat', mat: mats[0] }, { name: 'fatDeep', kind: 'fat', mat: mats[1] }],
    solids: { dg, d: (x, y, z) => dg(x, y, z, null) },
    interfaces: [{ label: 'base', kind: 'sliding', G: 300, t: 0.003, kn: 1e6, source: 'the loose areolar layer under the deep fat (soft/breast.js retro: an estimate, to source)' }],
    membranes: [skinM],
    tethers, colliders: contactColliders(yCt, gapC), cuts: [{ p: [0, Fz.region.yHi, 0], n: [0, 1, 0], kind: 'held' }, { p: [0, Fz.region.yLo, 0], n: [0, -1, 0], kind: 'held' }],
    gravity: [0, -9.81, 0], pose: 'bind', track, massFloor: opts.massFloor ?? 1, version: PELVIS_VERSION };
}

// THE SOLVE of the region under gravity in the bind pose (iteration 2), the zones of adherence bound (iteration 3), and the loaded skin on the body
// at Loop level 1 (iteration 3).
//   const P = solvePelvis(B, R, { h, solve, beta })   R = pelvisRegion(B, K, M, { rec })
//   -> { RS, info (buildSoft's), stats (solveSoft's), loaded: Float64Array (n x 3: the region mesh's vertices placed on the solve's loaded skin, the
//        seam blend applied; held = the body before), region: { d, dU } (the fitted displacement of every region vertex from the body before, loaded /
//        at rest), hm: { src: [hm08 id...], pos, envFit } (the control vertices), l1: { edges: [a, b, ...] (hm08 edges), d, dU } (level 1's edge vertices) }
// The SEAM (until BODY7's membrane fit): the solve's displacement u is faded by the region's blend weight (1 at the cuts and the held strip, 0 beyond
// 3 cm), final = envelope + (1 - blend) u, so the region meets the body without a step.
export async function solvePelvis(B, R, opts = {}) {
  const SOFT = await import('../soft/index.js');
  const RS = pelvisSoftRegion(B, R, opts), S = SOFT.buildSoft(RS), so = { dt: 0.001, maxTime: 4, damping: 40, tolMm: 0.02, minTime: 0.4, ...(opts.solve || {}) };
  boundSkin(S, R);
  const L = SOFT.solveSoft(S, so), T = transferSkin(B, R, L, opts);
  return { RS, info: S.info, stats: L.stats, track: L.track, surface: L.surface, ...T };
}

// THE SOLVE'S SKIN ON THE BODY (iteration 3; lane iteration 16: split out of solvePelvis): the region mesh's
// vertices placed on the solve's own skin (material points), then hm08's skin fitted onto them as a membrane (skinFit), loaded and at rest.
//   const T = transferSkin(B, R, L, opts)   L = soft/'s solveSoft result -> { loaded, region: { d, dU }, hm, l1, fit }
export function transferSkin(B, R, L, opts = {}) {
  const Fz = R.fat, { n, src, tri, par } = Fz.mesh, E = Fz.envelope, X = Fz.mesh.pos, bl = Fz.blend || new Float64Array(n);
  // THE SKIN'S MATERIAL POINTS (iteration 3): each region vertex reads the solve's OWN SKIN SURFACE (soft/'s fine surface, the field's zero set, which the
  // skin membrane is), not its own envelope column: the columns (deep point + normal x thickness) cross in the concave creases and zig-zag by 3-10 mm
  // where neighbouring normals disagree, so a material point taken at the column's top carried that zig-zag into the body (iteration 2 then needed a
  // 2-edge bending fit on hm08's 2-5 cm control mesh to hide it, which also erased the lower pole and the fold the region builds). Here the envelope
  // point is projected onto the REST skin surface (closest point, within `reach`), and its loaded position is the same point of the LOADED skin
  // (barycentric on the same triangle). A vertex with no skin within reach keeps its tracked material point (the column's).
  const SP = skinPoints(L.surface, E, n, Fz.held, opts.reach ?? 0.015);
  // (lane iteration 16) THE FOLD IS THE SKIN'S: the fit's outlier test (skinFit: a target that turns a triangle over is spanned, not followed) is made
  // against the SOLVE'S OWN SKIN where each vertex lies on it (its normal, loaded or at rest), not against the body before. v12 tested every loaded
  // triangle against the body before's normal, so wherever the solve's skin turned more than ~78 deg from the body before (the buttock's lower pole
  // hanging over the infragluteal line, the groin's crease) the fit spanned it from the neighbours: the fold the solve made never reached the body.
  // A triangle whose three targets lie on the solve's skin and face the way that skin faces IS the skin, however far it turned.
  const refN = solveSkinNormals(L.surface, SP, E, tri, n);
  const place = loaded => { const Ps = loaded ? L.surface.pos : L.surface.pos0, out = new Float64Array(n * 3), got = new Uint8Array(n);
    for (let i = 0; i < n; i++) { if (Fz.held[i]) { for (let c = 0; c < 3; c++) out[i * 3 + c] = X[i * 3 + c]; got[i] = 1; continue; }
      let p = null; const q = SP[i]; if (q) { p = [0, 0, 0]; for (let k = 0; k < 3; k++) { const v = L.surface.tri[q.t + k]; for (let c = 0; c < 3; c++) p[c] += q.w[k] * Ps[v * 3 + c]; } }
      else if (loaded) p = L.track['v:' + i] || null;
      if (!p) continue; for (let c = 0; c < 3; c++) out[i * 3 + c] = E[i * 3 + c] + (1 - bl[i]) * (p[c] - E[i * 3 + c]); got[i] = 1; }
    // any vertex with neither: the mean of its placed neighbours' displacements over the envelope
    const nb = Array.from({ length: n }, () => []); for (let k = 0; k < tri.length; k += 3) for (const [a, b] of [[tri[k], tri[k + 1]], [tri[k + 1], tri[k + 2]], [tri[k + 2], tri[k]]]) { nb[a].push(b); nb[b].push(a); }
    for (let pass = 0; pass < 6; pass++) for (let i = 0; i < n; i++) { if (got[i]) continue; let c = 0; const d = [0, 0, 0]; for (const j of nb[i]) if (got[j] === 1) { for (let q = 0; q < 3; q++) d[q] += out[j * 3 + q] - E[j * 3 + q]; c++; }
      if (c) { for (let q = 0; q < 3; q++) out[i * 3 + q] = E[i * 3 + q] + d[q] / c; got[i] = 2; } }
    for (let i = 0; i < n; i++) if (!got[i]) for (let q = 0; q < 3; q++) out[i * 3 + q] = E[i * 3 + q];
    return out; };
  const out = place(true), outU = place(false);
  // THE SKIN ON THE BODY, AT THE RENDER'S RESOLUTION (iteration 3): the region mesh IS the person's Loop level 1 there (hm08's triangles split once: the
  // render draws level 1, ~1.3 cm edges at the buttock, against hm08's 2.6 cm mean, up to 5 cm), so the fit is made on the region mesh and written to
  // level 1 vertex by vertex (hook.js), not low-passed onto the control mesh. A light membrane (beta 1: ~one 1.3 cm edge) takes out the surface nets'
  // sampling; the zones of adherence hold their targets (w 4: the skin is bound there, so the crease stays where the solve puts it); the region's open
  // edges and the held strip hold the body before (w 10: the seam); the navel's pit rides on the skin round it.
  const wIn = new Float64Array(n).fill(1); for (let i = 0; i < n; i++) { if (Fz.held[i] || bl[i] >= 0.999) wIn[i] = 10; else if (Fz.pinBy[i] >= 0 && Fz.lines[Fz.pinBy[i]]?.binds !== 'sfs') wIn[i] = 4; }
  const om = B.lm?.omphalion, free = []; if (om) for (let i = 0; i < n; i++) if (Math.hypot(X[i * 3] - om[0], X[i * 3 + 1] - om[1], X[i * 3 + 2] - om[2]) < (opts.navelR ?? 0.025)) free.push(i);
  // the skin's BENDING by where it is bound: a dermis under tension spans the deep layer's sub-centimetre undulations (the bellies under a thin fat
  // layer, the surface nets' sampling) and creases only where it is held, so the membrane's smoothing is beta (~1.7 edges) away from the zones of
  // adherence and falls to betaLine (~0.7 edges) within 1-4 cm of a line on the deep fascia (dAdh): the fold, the dimple and the crease stay
  const bF = opts.beta ?? 3, bL = opts.betaLine ?? 0.5, betaIn = new Float64Array(n); for (let i = 0; i < n; i++) { const a = Math.min(1, Math.max(0, ((Fz.dAdhD?.[i] ?? Fz.dAdh?.[i] ?? 1) - 0.01) / 0.03)); betaIn[i] = bL + (bF - bL) * a * a * (3 - 2 * a); }
  const all = Array.from({ length: n }, (_, i) => i), fo = { beta: bF, betaIn, iters: opts.fitIters ?? 80, free, wIn };
  const FL = skinFit(X, tri, n, all, out, { ...fo, refN: refN.loaded }), FU = skinFit(X, tri, n, all, outU, { ...fo, refN: refN.rest });
  FL.stats.kinks = kinks(X, tri, FL.d); FU.stats.kinks = kinks(X, tri, FU.d);
  // the control mesh (hm08's vertices of the region) and level 1's edge vertices (the midpoints: their hm08 edge in par)
  const hm = { src: [], pos: [], envFit: [] }, l1 = { edges: [], d: [], dU: [] };
  for (let i = 0; i < n; i++) { if (src[i] >= 0) { hm.src.push(src[i]); for (let c = 0; c < 3; c++) { hm.pos.push(X[i * 3 + c] + FL.d[i * 3 + c]); hm.envFit.push(X[i * 3 + c] + FU.d[i * 3 + c]); } }
    else if (par && par[i]) { l1.edges.push(par[i][0], par[i][1]); for (let c = 0; c < 3; c++) { l1.d.push(FL.d[i * 3 + c]); l1.dU.push(FU.d[i * 3 + c]); } } }
  let onSkin = 0; for (let i = 0; i < n; i++) if (SP[i]) onSkin++;
  return { loaded: out, region: { d: FL.d, dU: FU.d }, hm, l1, fit: { loaded: FL.stats, unloaded: FU.stats, onSkin, n } };
}

// the solve's skin normal at each region vertex's material point (SP: skinPoints), loaded and at rest, oriented as the region mesh faces (soft/'s
// surface-nets winding is taken against the envelope's own vertex normals, by the majority); NaN where a vertex has no material point
export function solveSkinNormals(Sf, SP, E, tri, n) {
  const triN = (P, t) => { const a = Sf.tri[t], b = Sf.tri[t + 1], c = Sf.tri[t + 2], u = [0, 1, 2].map(k => P[b * 3 + k] - P[a * 3 + k]), v = [0, 1, 2].map(k => P[c * 3 + k] - P[a * 3 + k]);
    const x = u[1] * v[2] - u[2] * v[1], y = u[2] * v[0] - u[0] * v[2], z = u[0] * v[1] - u[1] * v[0], l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
  const vn = new Float64Array(n * 3);
  for (let k = 0; k < tri.length; k += 3) { const a = tri[k], b = tri[k + 1], c = tri[k + 2], u = [0, 1, 2].map(q => E[b * 3 + q] - E[a * 3 + q]), v = [0, 1, 2].map(q => E[c * 3 + q] - E[a * 3 + q]);
    const N = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; for (const i of [a, b, c]) for (let q = 0; q < 3; q++) vn[i * 3 + q] += N[q]; }
  let agree = 0; for (let i = 0; i < n; i++) { const q = SP[i]; if (!q) continue; const N = triN(Sf.pos0, q.t); agree += Math.sign(N[0] * vn[i * 3] + N[1] * vn[i * 3 + 1] + N[2] * vn[i * 3 + 2]); }
  const sg = agree < 0 ? -1 : 1, loaded = new Float64Array(n * 3).fill(NaN), rest = new Float64Array(n * 3).fill(NaN);
  for (let i = 0; i < n; i++) { const q = SP[i]; if (!q) continue; const Nl = triN(Sf.pos, q.t), Nr = triN(Sf.pos0, q.t); for (let c = 0; c < 3; c++) { loaded[i * 3 + c] = sg * Nl[c]; rest[i * 3 + c] = sg * Nr[c]; } }
  return { loaded, rest, sign: sg };
}

// each region vertex's closest point on the solve's skin surface at rest (soft/'s fine surface: triangles with two or more 'skin' vertices), within reach:
// { t (the triangle's first index into tri), w (barycentric weights) } or null
export function skinPoints(Sf, E, n, held, reach = 0.015) {
  const P0 = Sf.pos0, T = Sf.tri, lab = Sf.label, sk = Sf.labels.indexOf('skin'), cs = 0.01, H = new Map(), key = (a, b, c) => (a * 73856093) ^ (b * 19349663) ^ (c * 83492791);
  for (let t = 0; t < T.length; t += 3) { const a = T[t], b = T[t + 1], c = T[t + 2]; if ((lab[a] === sk) + (lab[b] === sk) + (lab[c] === sk) < 2) continue;
    const lo = [0, 1, 2].map(k => Math.floor(Math.min(P0[a * 3 + k], P0[b * 3 + k], P0[c * 3 + k]) / cs)), hi = [0, 1, 2].map(k => Math.floor(Math.max(P0[a * 3 + k], P0[b * 3 + k], P0[c * 3 + k]) / cs));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) { const k = key(x, y, z); if (!H.has(k)) H.set(k, []); H.get(k).push(t); } }
  const out = new Array(n).fill(null), R = Math.ceil(reach / cs), W = [0, 0, 0];
  for (let i = 0; i < n; i++) { if (held[i]) continue; const p = [E[i * 3], E[i * 3 + 1], E[i * 3 + 2]], cx = Math.floor(p[0] / cs), cy = Math.floor(p[1] / cs), cz = Math.floor(p[2] / cs); let best = reach * reach, bt = -1, bw = null; const seen = new Set();
    for (let x = cx - R; x <= cx + R; x++) for (let y = cy - R; y <= cy + R; y++) for (let z = cz - R; z <= cz + R; z++) { const L = H.get(key(x, y, z)); if (!L) continue;
      for (const t of L) { if (seen.has(t)) continue; seen.add(t); const d2 = closestOnTri(p, P0, T[t], T[t + 1], T[t + 2], W); if (d2 < best) { best = d2; bt = t; bw = W.slice(); } } }
    if (bt >= 0) out[i] = { t: bt, w: bw }; }
  return out;
}
// squared distance from p to triangle (a, b, c) of P, the closest point's barycentric weights in W (Ericson, Real-Time Collision Detection 5.1.5)
function closestOnTri(p, P, ia, ib, ic, W) {
  const a = [P[ia * 3], P[ia * 3 + 1], P[ia * 3 + 2]], b = [P[ib * 3], P[ib * 3 + 1], P[ib * 3 + 2]], c = [P[ic * 3], P[ic * 3 + 1], P[ic * 3 + 2]];
  const sb = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]], dt = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const ab = sb(b, a), ac = sb(c, a), ap = sb(p, a), d1 = dt(ab, ap), d2 = dt(ac, ap); let u = 1, v = 0, w = 0;
  if (d1 <= 0 && d2 <= 0) { u = 1; v = 0; w = 0; }
  else { const bp = sb(p, b), d3 = dt(ab, bp), d4 = dt(ac, bp);
    if (d3 >= 0 && d4 <= d3) { u = 0; v = 1; w = 0; }
    else { const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const s = d1 / (d1 - d3); u = 1 - s; v = s; w = 0; }
      else { const cp = sb(p, c), d5 = dt(ab, cp), d6 = dt(ac, cp);
        if (d6 >= 0 && d5 <= d6) { u = 0; v = 0; w = 1; }
        else { const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const s = d2 / (d2 - d6); u = 1 - s; v = 0; w = s; }
          else { const va = d3 * d6 - d5 * d4;
            if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const s = (d4 - d3) / ((d4 - d3) + (d5 - d6)); u = 0; v = 1 - s; w = s; }
            else { const den = 1 / (va + vb + vc); v = vb * den; w = vc * den; u = 1 - v - w; } } } } } }
  W[0] = u; W[1] = v; W[2] = w; const q = [u * a[0] + v * b[0] + w * c[0], u * a[1] + v * b[1] + w * c[1], u * a[2] + v * b[2] + w * c[2]];
  return (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
}

// THE SKIN ON THE LOADED SURFACE (iteration 2): hm08's skin fitted as a MEMBRANE WITH BENDING onto the region's target positions (the solve's material
// points, or the unloaded envelope): minimise sum_i w_i |d_i - t_i|^2 + beta sum_i |d_i - mean_j d_j|^2 over the displacement d from the body before
// (so the skin keeps its own fine curvature, hm08's, and bends toward the target only at the scale the skin's stiffness allows: ~sqrt(beta) edges);
// every vertex outside the region holds d = 0 (the seam is the membrane's own boundary condition). OUTLIERS: a vertex whose target folds a triangle
// over (the offset of a concave deep surface by a thick layer, in the groin's crease: 350 edges > 30 deg on L08's envelope) takes w = 0, so the membrane
// spans it from its neighbours instead of following the fold. Jacobi, `iters` sweeps. Returns d (Float64Array, 3 per entry of src) and the stats.
//   const F = skinFit(B.pos, B.tri, B.nb, src, target, { beta, iters })
export function skinFit(X0, tri, nb, src, target, { beta = 4, iters = 80, foldDot = 0.2, free = null, wIn = null, betaIn = null, refN = null } = {}) {
  const m = src.length, slot = new Int32Array(nb).fill(-1); for (let k = 0; k < m; k++) if (src[k] < nb) slot[src[k]] = k;
  const dt = new Float64Array(m * 3); for (let k = 0; k < m; k++) for (let c = 0; c < 3; c++) dt[k * 3 + c] = target[k * 3 + c] - X0[src[k] * 3 + c];
  const nbr = Array.from({ length: m }, () => new Set());
  for (let t = 0; t < tri.length; t += 3) { const v = [tri[t], tri[t + 1], tri[t + 2]]; if (v.some(x => x >= nb)) continue;
    for (const [a, b] of [[v[0], v[1]], [v[1], v[2]], [v[2], v[0]]]) { if (slot[a] >= 0) nbr[slot[a]].add(b); if (slot[b] >= 0) nbr[slot[b]].add(a); } }
  // outliers: the triangles the target turns over against the body before
  const w = new Float64Array(m).fill(1), P1 = i => slot[i] >= 0 ? [X0[i * 3] + dt[slot[i] * 3], X0[i * 3 + 1] + dt[slot[i] * 3 + 1], X0[i * 3 + 2] + dt[slot[i] * 3 + 2]] : [X0[i * 3], X0[i * 3 + 1], X0[i * 3 + 2]];
  const nrm = (a, b, c) => { const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], x = u[1] * v[2] - u[2] * v[1], y = u[2] * v[0] - u[0] * v[2], z = u[0] * v[1] - u[1] * v[0], l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
  let flipped = 0; const bad = new Uint8Array(m);
  for (let t = 0; t < tri.length; t += 3) { const v = [tri[t], tri[t + 1], tri[t + 2]]; if (v.some(x => x >= nb) || !v.some(x => slot[x] >= 0)) continue;
    let n0 = nrm(...v.map(x => [X0[x * 3], X0[x * 3 + 1], X0[x * 3 + 2]])); const n1 = nrm(...v.map(P1));
    // (lane iteration 16) refN: the target surface's own normal at each entry (the solve's skin): the triangle is tested against the surface it samples
    if (refN && v.every(x => slot[x] >= 0 && refN[slot[x] * 3] === refN[slot[x] * 3])) { const r = [0, 0, 0]; for (const x of v) for (let c = 0; c < 3; c++) r[c] += refN[slot[x] * 3 + c]; const l = Math.hypot(...r); if (l > 1e-9) n0 = [r[0] / l, r[1] / l, r[2] / l]; }
    if (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2] < foldDot) { flipped++; for (const x of v) if (slot[x] >= 0) bad[slot[x]] = 1; } }
  for (let k = 0; k < m; k++) if (bad[k]) { w[k] = 0; for (const j of nbr[k]) if (slot[j] >= 0) w[slot[j]] = Math.min(w[slot[j]], 0.25); }
  // wIn (iteration 3): per-entry weights on the targets (a bound zone of adherence holds its target; the seam holds the body before)
  if (wIn) for (let k = 0; k < m; k++) if (w[k] > 0 || wIn[k] >= 10) w[k] = (w[k] || 1) * wIn[k];
  // `free` (vertex ids): features the region's layer model does not build (the navel's pit): the membrane carries them with the skin around them
  if (free) for (const v of free) if (v < nb && slot[v] >= 0) w[slot[v]] = 0;
  // Jacobi on d (neighbours outside the region: 0)
  let d = Float64Array.from(dt), d2 = new Float64Array(m * 3); const nl = nbr.map(s => [...s]);
  for (let it = 0; it < iters; it++) { for (let k = 0; k < m; k++) { const L = nl[k]; if (!L.length) { for (let c = 0; c < 3; c++) d2[k * 3 + c] = dt[k * 3 + c]; continue; }
      const a = [0, 0, 0]; for (const j of L) { const s = slot[j]; if (s >= 0) { a[0] += d[s * 3]; a[1] += d[s * 3 + 1]; a[2] += d[s * 3 + 2]; } } const inv = 1 / L.length;
      const bk = betaIn ? betaIn[k] : beta; for (let c = 0; c < 3; c++) d2[k * 3 + c] = (w[k] * dt[k * 3 + c] + bk * a[c] * inv) / (w[k] + bk); }
    [d, d2] = [d2, d]; }
  let res = 0; for (let k = 0; k < m; k++) if (w[k] === 1) res = Math.max(res, Math.hypot(d[k * 3] - dt[k * 3], d[k * 3 + 1] - dt[k * 3 + 1], d[k * 3 + 2] - dt[k * 3 + 2]));
  return { d, stats: { beta, iters, flippedTris: flipped, outliers: bad.reduce((s, x) => s + x, 0), maxOffTargetMm: +(res * 1000).toFixed(1) } };
}

// hm08 vertices within r of the omphalion (the navel's pit and rim)
export function navelRing(B, r = 0.025) { const o = B.lm?.omphalion; if (!o) return []; const out = []; for (let v = 0; v < B.nb; v++) if (Math.hypot(B.pos[v * 3] - o[0], B.pos[v * 3 + 1] - o[1], B.pos[v * 3 + 2] - o[2]) < r) out.push(v); return out; }

// THE ZONES OF ADHERENCE BIND THE SKIN (iteration 3). soft/'s tether is a unilateral DISTANCE (the skin point no farther from its anchor on the deep fascia
// than at rest): it stops the skin lifting away, but a point on a sphere round its anchor slides along the fascia almost freely (the stretch is second
// order in the slide), so under gravity the 'retaining line' sank with the fat above it and no fold could form (iteration 2: the fold's tracked points
// moved 2-8 mm with the mass). A zone of adherence is dense fibrous septa from the dermis to the deep fascia (Lockwood 1991; Rohrich et al 2001): they hold
// the skin where it is ON the fascia, against sliding as much as against lifting. Here each tether's skin point is held to its own REST position (the
// deep fascia is kinematic in this solve, so a point fixed relative to it is fixed in space) within the septa's GIVE (the line's slackMm: 1 mm at 25,
// + 0.6 mm a decade, tethers.js; an assumption to measure), with the septa's compliance (1 / k, as before). The fat above a bound line can then hang over
// it: the fold, the dimple, the crease are where the free skin turns back to the bound skin. On S (buildSoft's result; soft/ itself untouched).
export function boundSkin(S, R) {
  const P0 = S.surf.pos0, give = new Map(R.tethers.map(t => [t.name, (t.slackMm ?? 1) / 1000])); let n = 0;
  for (const c of S.cons.teth) { const v = c.v, g = give.get(c.name) ?? 0.001; c.a = [P0[v * 3], P0[v * 3 + 1], P0[v * 3 + 2]]; c.L = g; c.L0 = g; c.bound = true; n++; }
  S.info.bound = n; return n;
}
// the region mesh's edges whose dihedral angle the displacement d sharpens by more than 20 / 30 degrees (a description of creases and kinks)
export function kinks(X, tri, d) {
  const nT = tri.length / 3, N0 = new Float64Array(nT * 3), N1 = new Float64Array(nT * 3), E = new Map();
  const nrm3 = (P, a, b, c, o, N) => { const u = [P(b, 0) - P(a, 0), P(b, 1) - P(a, 1), P(b, 2) - P(a, 2)], v = [P(c, 0) - P(a, 0), P(c, 1) - P(a, 1), P(c, 2) - P(a, 2)], x = u[1] * v[2] - u[2] * v[1], y = u[2] * v[0] - u[0] * v[2], z = u[0] * v[1] - u[1] * v[0], l = Math.hypot(x, y, z) || 1; N[o] = x / l; N[o + 1] = y / l; N[o + 2] = z / l; };
  const P0 = (i, c) => X[i * 3 + c], P1 = (i, c) => X[i * 3 + c] + d[i * 3 + c];
  for (let t = 0; t < nT; t++) { const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2]; nrm3(P0, a, b, c, t * 3, N0); nrm3(P1, a, b, c, t * 3, N1);
    for (const [p, q] of [[a, b], [b, c], [c, a]]) { const k = p < q ? p * 1e7 + q : q * 1e7 + p; const e = E.get(k); if (e) e.push(t); else E.set(k, [t]); } }
  let k20 = 0, k30 = 0; const ang = (N, s, t) => Math.acos(Math.max(-1, Math.min(1, N[s * 3] * N[t * 3] + N[s * 3 + 1] * N[t * 3 + 1] + N[s * 3 + 2] * N[t * 3 + 2]))) * 180 / Math.PI;
  for (const ts of E.values()) if (ts.length === 2) { const inc = ang(N1, ts[0], ts[1]) - ang(N0, ts[0], ts[1]); if (inc > 20) k20++; if (inc > 30) k30++; }
  return { over20: k20, over30: k30 };
}
