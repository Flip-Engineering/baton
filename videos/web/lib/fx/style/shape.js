// STYLE / shape: one person, styled at the level of the body itself (HUMAN c8, lane E: the style layer, stage 4 of
// research/PERSON_PIPELINE.md). A style is derived from the anatomy, not filtered onto a mesh: what a figure teacher does
// with a real body when he simplifies it, and what a monument sculptor does when he re-proportions it.
//
//   import { readPerson, bakeRest, styleShape } from '../lib/fx/style/shape.js';
//   const base = bakeRest(readPerson(data, 'rosa'), apply);                // CREW8: castHero's bone scales baked into the bind
//   const P = styleShape(base, { level: { default: 2, head: 0.5, hands: 0 }, canon: 'monumental' });
//   const h = new Hero(P, { ...opts, variant: P.name, height: opts.height }); P.finish(h);   // clothes are cut on the styled body
//   P.kin, P.measures, P.anchors                                            // recomputed on the styled body
//
// A person is a hero data object ({ meta, arr }, lane A's contract: "a person IS a hero data object"); styleShape returns
// another one with one more meta.variants entry and arr() delegating every shared array, so hero.js, garment.js and CLOTHING
// build on it unchanged and nothing that does not ask for a style changes.
//
// THE SIMPLIFICATION LADDER (Bridgman, Constructive Anatomy 1920, PD: "the masses of the head, chest and pelvis are
// wedged ... the arm and leg are overlapping forms"; Loomis's mannequin; the Asaro planes of the head). Levels are
// continuous and set per region (per mass; skin weights blend them across every joint, so a monumental figure can have
// simplified limbs and a detailed head and hands):
//   L0   the body as built (every layer).
//   L0.5 SMALL FORMS gone: veins, minor muscles, skin folds and relief (features under ~1.2 cm of a 1.75 m person).
//   L1   MASSES: muscle groups merged into the masses an artist draws, fat as a smooth envelope over them. Built as a
//        band-pass of the surface's own normal height field: h = (X - G_s X).n, d = h - G_s h (the slowly varying part of
//        h is a smoothing's shrink and the big masses, so it is kept), creases (d < 0) are FILLED and bumps (d > 0) cut,
//        so a cylinder or a belly survives and only what is smaller than the mass scale goes (Taubin 1995's point that a
//        plain Laplacian low-pass shrinks the form is why the shrink is measured and kept rather than suffered).
//   L2   PLANES: each mass reduced to its major planes, the turn of form at the plane breaks. folk_worlds' planeHead
//        (k-means of normals on the head) generalised to the body as Variational Shape Approximation (Cohen-Steiner,
//        Alliez and Desbrun 2004: Lloyd clustering of normals into planar proxies), per mass, mirrored for symmetry
//        (the sternum, the linea alba and the bridge of the nose fall on a break, as Bridgman draws them); vertices move
//        part-way onto their plane (a plane through an outer percentile, so forms are cut like a stone, not shrunk) and
//        take its normal.
//   L3   PRIMITIVES: the mannequin, fitted to this person and sitting on the true joint centres: tapered elliptical
//        cylinders joint to joint for the limbs and neck, superellipsoids (Barr 1981) for the head, ribcage, waist,
//        pelvis, hands and feet; blended across joints by the skin weights.
//   L4   SILHOUETTE / NOTAN: a read, not a shape: the L1 masses printed in two values (surface.js 'notan').
// ANCHORS survive every level: bony landmarks (sternal notch, clavicles, C7, acromion, rib margin, iliac crest and ASIS,
// sacral dimples, inguinal line, patella, tibial crest, malleoli, olecranon, ulnar head; chin, nose, cheekbone, jaw angle)
// and the joint centres are fixed; a geodesic falloff field holds them and simplification smooths BETWEEN them, so the
// rhythm of forms stays and a strong heavy woman simplified is still a strong heavy woman. Proxies are measured off the
// mesh and skeleton (after Richer 1890 pl. 74-76 and Richer 1920 pl. 2-4, 41, 49); lane A's S.landmarks (vertex ids)
// replace them when passed as src.landmarkIds.
// With lane A's layers (opts.layers: [{ kind: 'muscle'|'fat'|'relief'|'breast'|..., group, D: Float32Array n*3 }] as bind
// displacements already in the positions) L1 works per layer instead: relief dropped, each mass's muscle fields merged and
// low-passed, fat enveloped. On CREW8 (no layers) the band-pass approximates it; CREW8's soft base meshes have little small
// form to lose, so L0 -> L1 is a small step on the body and a real one on the face, hands and feet (NOTES).
//
// PROPORTION CANONS through the skeleton: segment lengths along each bone, breadths and girths across it, the head, hands
// and feet uniformly, carried down the hierarchy (a child's joint moves with its parent's transform); the skin follows
// by linear blend skinning plus a displacement relaxation where weights mix (the corrective); the feet are put back on
// the floor and the kinematic model is recomputed from the styled mesh, so a monumental figure poses, balances and
// carries a load as the body it is. Canons are RELATIVE to the person (heroic = her own head count + 0.7), so the
// person's own proportions, and so identity, survive; women's canons act on women's frames (Mukhina's Worker and
// Kolkhoz Woman, 1937, is a pair: both broad-shouldered, both small-headed, her pelvis is still hers).
//   natural     the person as measured (Richer's 7.5 heads for men, 7 1/3 for women, are means, not targets)
//   heroic      +0.8 heads (men) / +0.7 (women): the head smaller, the freed length mostly to the legs (Loomis's 8-8.5)
//   monumental  Deineka, Mukhina, the WPA murals: head x0.86-0.88, broad shoulders and neck, big hands and forearms
//   caricature  the person's offset from their group mean scaled by k (Benson and Perrett 1991; k < 1 anti-caricature)
//
// KINEMATICS: kinOf() voxelises the styled mesh at 1 cm, assigns voxels to de Leva's segments by the nearest joint-to-
// joint capsule, and integrates mass (Dempster's segment densities, via Winter 2009 table 4.1), centres of mass and
// inertia tensors; whole-body COM height / stature; a stance width from the hip joints; soft-tissue flexion deltas at the
// elbow and knee from the girths (the ranges themselves are lane A's p.kin.ranges, carried through).
import * as THREE from 'three';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const REG = { head: 0, neck: 1, torso: 2, uarm: 3, farm: 4, hand: 5, finger: 6, pelvis: 7, thigh: 8, shin: 9, foot: 10, jaw: 11 };

// ---------------------------------------------------------------- masses (Bridgman's), groups for per-region levels
export const MASSES = ['head', 'neck', 'chest', 'breast.L', 'breast.R', 'abdomen', 'pelvis', 'uarm.L', 'uarm.R', 'farm.L', 'farm.R', 'hand.L', 'hand.R', 'thigh.L', 'thigh.R', 'shin.L', 'shin.R', 'foot.L', 'foot.R'];
export const MASS_ID = Object.fromEntries(MASSES.map((m, i) => [m, i]));
const pair = b => [b + '.L', b + '.R'];
export const GROUPS = { head: ['head'], neck: ['neck'], chest: ['chest', 'breast.L', 'breast.R'], breast: pair('breast'), abdomen: ['abdomen'], pelvis: ['pelvis'], trunk: ['chest', 'breast.L', 'breast.R', 'abdomen', 'pelvis'],
  arms: [...pair('uarm'), ...pair('farm')], hands: pair('hand'), legs: [...pair('thigh'), ...pair('shin')], feet: pair('foot'),
  limbs: [...pair('uarm'), ...pair('farm'), ...pair('thigh'), ...pair('shin')], uarm: pair('uarm'), farm: pair('farm'), thigh: pair('thigh'), shin: pair('shin'), hand: pair('hand'), foot: pair('foot') };
export function massOfBone(n) {
  const s = n.endsWith('.L') ? '.L' : n.endsWith('.R') ? '.R' : '';
  if (/^neck0/.test(n)) return 'neck';
  if (/^breast/.test(n)) return 'breast' + s;          // the breast (and a man's pectoral) is its own mass on the chest, at every level
  if (/^(spine01|spine02|clavicle|shoulder01)/.test(n)) return 'chest';
  if (/^(spine03|spine04)/.test(n)) return 'abdomen';
  if (/^(spine05|root|pelvis)/.test(n)) return 'pelvis';
  if (/^upperarm/.test(n)) return 'uarm' + s;
  if (/^lowerarm/.test(n)) return 'farm' + s;
  if (/^(wrist|metacarpal|finger)/.test(n)) return 'hand' + s;
  if (/^upperleg/.test(n)) return 'thigh' + s;
  if (/^lowerleg/.test(n)) return 'shin' + s;
  if (/^(foot|toe)/.test(n)) return 'foot' + s;
  return 'head';                                       // head, jaw, eyes, the face and tongue bones
}

// ---------------------------------------------------------------- the person record
// src: a hero data object ({ meta, arr }, optionally name / height / landmarkIds / kin / layers), or { data, variant }
export function readPerson(src, variant = null) {
  const D = src.data && src.data.meta ? src.data : src, meta = D.meta, arr = D.arr;
  const name = variant || src.variant || src.name || meta.variants[0].name, V = meta.variants.find(v => v.name === name);
  if (!V) throw new Error(`style/shape: no variant ${name}`);
  const names = meta.bones.map(b => b.name);
  return { meta, arr, V, name, sex: V.sex || 'm', age: V.age ?? null, n: meta.n, ne: meta.ne, names, idx: Object.fromEntries(names.map((nm, i) => [nm, i])), parent: meta.bones.map(b => b.parent),
    pos: Float32Array.from(arr('pos_' + name)), eyes: Float32Array.from(arr('eyes_' + name)), heads: V.heads.map(h => [...h]), tails: V.tails.map(t => [...t]),
    tris: arr('idx_body'), reg: arr('region'), SI: arr('skinIndex'), SW: arr('skinWeight'), bindH: V.height, height: src.height ?? null,
    landmarkIds: src.landmarkIds || null, relief: src.relief || null, kin0: src.kin || null, layers: src.layers || null, label: src.label || name };
}

// CREW8's bodies are hm08 variants plus bone scales set at runtime (workforce castHero -> rig/body.js applyBody lengths).
// Bake them into the bind (a bone shim with the same hierarchy as Hero: identity rotations at the heads), so a styled
// variant renders the same person with no apply() and the shape operators see the body that renders.
export function bakeRest(P, apply) {
  if (!apply) return P;
  const bones = P.names.map(nm => Object.assign(new THREE.Bone(), { name: nm }));
  P.parent.forEach((p, i) => { const h = P.heads[i], q = p >= 0 ? P.heads[p] : [0, 0, 0]; bones[i].position.set(h[0] - q[0], h[1] - q[1], h[2] - q[2]); if (p >= 0) bones[p].add(bones[i]); });
  const grp = new THREE.Group(); grp.add(bones[P.idx.root]); grp.updateMatrixWorld(true);
  const inv = bones.map(B => B.matrixWorld.clone().invert());
  const shim = { bones, names: P.names, idx: P.idx, bone: nm => bones[P.idx[nm]], update() { grp.updateMatrixWorld(true); }, scale: 1, group: grp };
  apply(shim); grp.updateMatrixWorld(true);
  const K = bones.map((B, i) => B.matrixWorld.clone().multiply(inv[i]).elements);
  const out = { ...P, pos: new Float32Array(P.pos.length), eyes: new Float32Array(P.eyes.length) };
  const xf = (e, x, y, z, o) => { o[0] = e[0] * x + e[4] * y + e[8] * z + e[12]; o[1] = e[1] * x + e[5] * y + e[9] * z + e[13]; o[2] = e[2] * x + e[6] * y + e[10] * z + e[14]; return o; };
  const t = [0, 0, 0];
  for (let v = 0; v < P.n; v++) { let x = 0, y = 0, z = 0; const px = P.pos[v * 3], py = P.pos[v * 3 + 1], pz = P.pos[v * 3 + 2];
    for (let k = 0; k < 4; k++) { const w = P.SW[v * 4 + k]; if (!w) continue; xf(K[P.SI[v * 4 + k]], px, py, pz, t); x += w * t[0]; y += w * t[1]; z += w * t[2]; }
    out.pos[v * 3] = x; out.pos[v * 3 + 1] = y; out.pos[v * 3 + 2] = z; }
  const Kh = K[P.idx.head]; for (let k = 0; k < P.ne; k++) { xf(Kh, P.eyes[k * 3], P.eyes[k * 3 + 1], P.eyes[k * 3 + 2], t); out.eyes.set(t, k * 3); }
  out.heads = bones.map(B => new THREE.Vector3().setFromMatrixPosition(B.matrixWorld).toArray());
  out.tails = P.tails.map((tl, i) => xf(K[i], tl[0], tl[1], tl[2], [0, 0, 0]));
  out.baked = true;
  return out;
}

// ---------------------------------------------------------------- topology, fields on the surface
const TOPO = new WeakMap();
export function topo(P) {
  let T = TOPO.get(P.tris); if (T) return T;
  const n = P.n, tris = P.tris, used = new Uint8Array(n); for (let i = 0; i < tris.length; i++) used[tris[i]] = 1;
  const seen = new Map(), E = [];
  for (let t = 0; t < tris.length; t += 3) for (let k = 0; k < 3; k++) { let a = tris[t + k], b = tris[t + (k + 1) % 3]; if (a > b) [a, b] = [b, a]; const key = a * n + b; if (!seen.has(key)) { seen.set(key, 1); E.push(a, b); } }
  const off = new Uint32Array(n + 1); for (const v of E) off[v + 1]++; for (let i = 0; i < n; i++) off[i + 1] += off[i];
  const fill = off.slice(0, n), adj = new Uint32Array(E.length);
  for (let e = 0; e < E.length; e += 2) { const a = E[e], b = E[e + 1]; adj[fill[a]++] = b; adj[fill[b]++] = a; }
  const list = []; for (let v = 0; v < n; v++) if (used[v]) list.push(v);
  T = { n, used, off, adj, E: Uint32Array.from(E), list: Uint32Array.from(list) };
  TOPO.set(P.tris, T); return T;
}
// per-vertex mean squared edge length
function edge2(T, X) { const h2 = new Float32Array(T.n);
  for (const v of T.list) { let s = 0, c = 0; for (let j = T.off[v]; j < T.off[v + 1]; j++) { const u = T.adj[j], dx = X[u * 3] - X[v * 3], dy = X[u * 3 + 1] - X[v * 3 + 1], dz = X[u * 3 + 2] - X[v * 3 + 2]; s += dx * dx + dy * dy + dz * dz; c++; } h2[v] = c ? s / c : 0; }
  return h2; }
// Gaussian-like low-pass of a dim-component field over the surface, width sigma (m): explicit averaging steps, each vertex
// moving a fraction beta_i = min(1, 2 sigma^2 / (N h_i^2)) toward its neighbours' mean (a grid diffusion adds beta h^2 / 2
// of variance per step), N chosen so the fine end of the mesh (p10 edge) still reaches sigma, capped at 400 steps.
export function diffuse(T, X, F, dim, sigma, { rate = null } = {}) {
  const h2 = edge2(T, X), hs = Array.from(T.list, v => h2[v]).sort((a, b) => a - b), h10 = hs[Math.floor(hs.length * 0.1)] || 1e-4;
  const N = Math.min(400, Math.max(2, Math.ceil(2 * sigma * sigma / (0.5 * h10))));
  const beta = new Float32Array(T.n); for (const v of T.list) beta[v] = h2[v] > 0 ? Math.min(1, 2 * sigma * sigma / (N * h2[v])) * (rate ? rate[v] : 1) : 0;
  let A = Float32Array.from(F), B = new Float32Array(F.length);
  for (let it = 0; it < N; it++) {
    B.set(A);
    for (const v of T.list) { const o = T.off[v], c = T.off[v + 1] - o; if (!c) continue; const b = beta[v];
      for (let d = 0; d < dim; d++) { let s = 0; for (let j = o; j < o + c; j++) s += A[T.adj[j] * dim + d]; B[v * dim + d] = A[v * dim + d] + b * (s / c - A[v * dim + d]); } }
    [A, B] = [B, A];
  }
  return A;
}
export function vertexNormals(X, tris, n) {
  const N = new Float32Array(n * 3);
  for (let t = 0; t < tris.length; t += 3) { const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    const ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2], vx = X[c] - X[a], vy = X[c + 1] - X[a + 1], vz = X[c + 2] - X[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { N[i] += nx; N[i + 1] += ny; N[i + 2] += nz; } }
  for (let i = 0; i < n; i++) { const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1; N[i * 3] /= l; N[i * 3 + 1] /= l; N[i * 3 + 2] /= l; }
  return N;
}
// binary-heap Dijkstra over the edge graph from sources; cost(u, v, len) -> edge cost. Returns { dist, prev }
function dijkstra(T, X, sources, { cost = null, maxD = Infinity } = {}) {
  const n = T.n, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), H = [], push = (d, v) => { H.push([d, v]); let i = H.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (H[p][0] <= H[i][0]) break; [H[p], H[i]] = [H[i], H[p]]; i = p; } };
  const pop = () => { const top = H[0], last = H.pop(); if (H.length) { H[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < H.length && H[l][0] < H[m][0]) m = l; if (r < H.length && H[r][0] < H[m][0]) m = r; if (m === i) break; [H[m], H[i]] = [H[i], H[m]]; i = m; } } return top; };
  for (const s of sources) { if (s == null) continue; dist[s] = 0; push(0, s); }
  while (H.length) { const [d, v] = pop(); if (d > dist[v] || d > maxD) continue;
    for (let j = T.off[v]; j < T.off[v + 1]; j++) { const u = T.adj[j], len = Math.hypot(X[u * 3] - X[v * 3], X[u * 3 + 1] - X[v * 3 + 1], X[u * 3 + 2] - X[v * 3 + 2]), c = cost ? cost(v, u, len) : len, nd = d + c;
      if (nd < dist[u]) { dist[u] = nd; prev[u] = v; push(nd, u); } } }
  return { dist, prev };
}
function pathTo(T, X, a, b, cost) { if (a == null || b == null) return []; const { prev } = dijkstra(T, X, [a], { cost }); const p = []; for (let v = b; v >= 0 && p.length < 4000; v = prev[v]) { p.push(v); if (v === a) break; } return p.reverse(); }
// the mirror vertex of every used vertex (hm08 is symmetric; nearest neighbour of (-x, y, z) on a 1 cm hash grid)
export function mirrorMap(T, X) {
  const g = new Map(), k = (x, y, z) => `${Math.floor(x / 0.01)},${Math.floor(y / 0.01)},${Math.floor(z / 0.01)}`;
  for (const v of T.list) { const key = k(X[v * 3], X[v * 3 + 1], X[v * 3 + 2]); (g.get(key) || g.set(key, []).get(key)).push(v); }
  const M = new Int32Array(T.n).fill(-1);
  for (const v of T.list) { const x = -X[v * 3], y = X[v * 3 + 1], z = X[v * 3 + 2]; let best = -1, bd = Infinity;
    for (let r = 0; r <= 2 && best < 0; r++) for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (let l = -r; l <= r; l++) {
      const L = g.get(`${Math.floor(x / 0.01) + i},${Math.floor(y / 0.01) + j},${Math.floor(z / 0.01) + l}`); if (!L) continue;
      for (const u of L) { const d = (X[u * 3] - x) ** 2 + (X[u * 3 + 1] - y) ** 2 + (X[u * 3 + 2] - z) ** 2; if (d < bd) { bd = d; best = u; } } }
    M[v] = best; }
  return M;
}
const statureOf = (T, X) => { let lo = Infinity, hi = -Infinity; for (const v of T.list) { const y = X[v * 3 + 1]; if (y < lo) lo = y; if (y > hi) hi = y; } return { lo, hi, H: hi - lo }; };

// ---------------------------------------------------------------- masses per vertex, skin-weighted mass memberships
function massTables(P) {
  const boneMass = P.names.map(nm => MASS_ID[massOfBone(nm)]), n = P.n, dom = new Uint8Array(n), memb = new Float32Array(n * MASSES.length);
  for (let v = 0; v < n; v++) { let bw = -1, bm = 0; for (let k = 0; k < 4; k++) { const w = P.SW[v * 4 + k]; if (!w) continue; const m = boneMass[P.SI[v * 4 + k]]; memb[v * MASSES.length + m] += w; if (w > bw) { bw = w; bm = m; } } dom[v] = bm; }
  return { boneMass, dom, memb };
}

// ---------------------------------------------------------------- anchors: bony landmarks and the lines between them
// Proxies measured on the mesh and the joints, scaled to the person (s = stature / 1.75 m). Each is a vertex so it rides
// any pose; lines are geodesic paths through waypoints (where an engraver puts the clavicle, the rib arch, the crest).
export function landmarkProxies(P, X, T = topo(P)) {
  const { reg, idx } = P, J = nm => P.heads[idx[nm]], { lo, H } = statureOf(T, X), s = H / 1.75;
  const x = i => X[i * 3], y = i => X[i * 3 + 1] - lo, z = i => X[i * 3 + 2], jy = nm => J(nm)[1] - lo;
  const best = (f, score) => { let bi = null, bs = -Infinity; for (const i of T.list) { if (!f(i)) continue; const sc = score(i); if (sc > bs) { bs = sc; bi = i; } } return bi; };
  const inR = (...rs) => i => rs.includes(reg[i]), L = {}, lines = {};
  const nk = J('neck01'), cl = J('clavicle.L');
  L.suprasternale = best(i => Math.abs(x(i)) < 0.012 * s && z(i) > nk[2] && Math.abs(y(i) - (cl[1] - lo + 0.006 * s)) < 0.018 * s && inR(REG.neck, REG.torso)(i), i => z(i));
  L.cervicale = best(i => Math.abs(x(i)) < 0.012 * s && z(i) < nk[2] && Math.abs(y(i) - (jy('neck01') - 0.012 * s)) < 0.025 * s && inR(REG.neck, REG.torso)(i), i => -z(i));
  L.xiphoid = best(i => Math.abs(x(i)) < 0.016 * s && reg[i] === REG.torso && Math.abs(y(i) - (jy('spine01') - 0.045 * s)) < 0.018 * s, i => z(i));
  const hipY = (jy('upperleg01.L') + jy('upperleg01.R')) / 2;
  L.pubis = best(i => Math.abs(x(i)) < 0.016 * s && (reg[i] === REG.pelvis || reg[i] === REG.torso) && Math.abs(y(i) - (hipY - 0.01 * s)) < 0.02 * s, i => z(i));
  L.sacrum = best(i => Math.abs(x(i)) < 0.016 * s && (reg[i] === REG.pelvis || reg[i] === REG.torso) && Math.abs(y(i) - (hipY + 0.05 * s)) < 0.02 * s, i => -z(i));
  { const hv = []; for (const i of T.list) if (reg[i] === REG.head || reg[i] === REG.jaw) hv.push(z(i)); hv.sort((a, b) => a - b); const z60 = hv[Math.floor(hv.length * 0.6)];
    const eyeY = jy('head') + 0.07 * s;      // refined below from the eye proxies
    L.vertex = best(inR(REG.head), i => y(i));
    L.menton = best(i => (reg[i] === REG.head || reg[i] === REG.jaw) && z(i) > z60 && Math.abs(x(i)) < 0.012 * s, i => -y(i));
    let ey = 0; for (let k = 0; k < P.ne; k++) ey += P.eyes[k * 3 + 1] - lo; ey = P.ne ? ey / P.ne : eyeY;
    let ez = -Infinity; for (let k = 0; k < P.ne; k++) ez = Math.max(ez, P.eyes[k * 3 + 2]);
    L.pronasale = best(i => (reg[i] === REG.head) && Math.abs(x(i)) < 0.01 * s && y(i) < ey && y(i) > ey - 0.06 * s, i => z(i));
    L.nasion = best(i => reg[i] === REG.head && Math.abs(x(i)) < 0.008 * s && Math.abs(y(i) - (ey + 0.004 * s)) < 0.006 * s && z(i) > ez - 0.01, i => z(i));
    L.glabella = best(i => reg[i] === REG.head && Math.abs(x(i)) < 0.01 * s && Math.abs(y(i) - (ey + 0.02 * s)) < 0.01 * s, i => z(i));
    for (const sd of ['L', 'R']) { const sg = sd === 'L' ? 1 : -1;
      L['zygion_' + sd] = best(i => (reg[i] === REG.head) && sg * x(i) > 0 && Math.abs(y(i) - (ey - 0.022 * s)) < 0.01 * s && z(i) > ez - 0.05 * s, i => sg * x(i));
      L['gonion_' + sd] = best(i => (reg[i] === REG.jaw || reg[i] === REG.head) && sg * x(i) > 0.02 * s && y(i) < ey - 0.07 * s && y(i) > ey - 0.11 * s, i => sg * x(i) * 0.6 - z(i) * 0.4 - y(i) * 0.5); } }
  for (const sd of ['L', 'R']) { const sg = sd === 'L' ? 1 : -1, S = sd, sh = J('upperarm01.' + S), kn = J('lowerleg01.' + S), an = J('foot.' + S), el = J('lowerarm01.' + S), wr = J('wrist.' + S), hj = J('upperleg01.' + S);
    L['acromion_' + S] = best(i => reg[i] === REG.torso && sg * x(i) > 0 && y(i) > sh[1] - lo - 0.01 * s, i => sg * x(i) + 0.6 * y(i));
    L['scapula_' + S] = best(i => reg[i] === REG.torso && Math.abs(sg * x(i) - 0.075 * s) < 0.015 * s && Math.abs(y(i) - (sh[1] - lo - 0.035 * s)) < 0.02 * s, i => -z(i));
    L['ribside_' + S] = best(i => reg[i] === REG.torso && sg * x(i) > 0.06 * s && Math.abs(y(i) - (jy('spine03') + 0.01 * s)) < 0.015 * s, i => sg * x(i) * 0.7 + z(i));
    L['asis_' + S] = best(i => (reg[i] === REG.pelvis || reg[i] === REG.torso) && Math.abs(sg * x(i) - Math.abs(hj[0]) * 1.05) < 0.03 * s && Math.abs(y(i) - (hj[1] - lo + 0.05 * s)) < 0.02 * s, i => z(i));
    L['crest_' + S] = best(i => (reg[i] === REG.pelvis || reg[i] === REG.torso) && Math.abs(y(i) - (hj[1] - lo + 0.09 * s)) < 0.015 * s && sg * x(i) > 0, i => sg * x(i));
    L['psis_' + S] = best(i => (reg[i] === REG.pelvis || reg[i] === REG.torso) && Math.abs(sg * x(i) - 0.04 * s) < 0.012 * s && Math.abs(y(i) - (hj[1] - lo + 0.06 * s)) < 0.02 * s, i => -z(i));
    L['patella_' + S] = best(i => (reg[i] === REG.thigh || reg[i] === REG.shin) && Math.abs(y(i) - (kn[1] - lo + 0.01 * s)) < 0.02 * s && Math.abs(x(i) - kn[0]) < 0.05 * s, i => z(i));
    L['tuberosity_' + S] = best(i => reg[i] === REG.shin && Math.abs(y(i) - (kn[1] - lo - 0.06 * s)) < 0.015 * s && Math.abs(x(i) - kn[0]) < 0.05 * s, i => z(i));
    L['shinfront_' + S] = best(i => reg[i] === REG.shin && Math.abs(y(i) - (an[1] - lo + 0.07 * s)) < 0.015 * s && Math.abs(x(i) - an[0]) < 0.05 * s, i => z(i) - 0.3 * sg * (x(i) - an[0]));
    L['malleolusLat_' + S] = best(i => (reg[i] === REG.shin || reg[i] === REG.foot) && Math.abs(y(i) - (an[1] - lo)) < 0.015 * s && Math.abs(z(i) - an[2]) < 0.04 * s, i => sg * x(i));
    L['malleolusMed_' + S] = best(i => (reg[i] === REG.shin || reg[i] === REG.foot) && Math.abs(y(i) - (an[1] - lo + 0.008 * s)) < 0.015 * s && Math.abs(z(i) - an[2]) < 0.04 * s, i => -sg * x(i));
    L['olecranon_' + S] = best(i => (reg[i] === REG.uarm || reg[i] === REG.farm) && Math.hypot(x(i) - el[0], y(i) - (el[1] - lo), z(i) - el[2]) < 0.045 * s, i => -z(i));
    L['ulnar_' + S] = best(i => (reg[i] === REG.farm || reg[i] === REG.hand) && Math.hypot(x(i) - wr[0], y(i) - (wr[1] - lo), z(i) - wr[2]) < 0.035 * s, i => -z(i) * 0.5 + sg * x(i) * 0.5);
  }
  // lane A's landmarks (basis.json, vertex ids on the same topology) replace the proxies they name, before the lines are
  // routed through them; the rest of lane A's list is kept under its own names
  if (P.landmarkIds) for (const [k, v] of Object.entries(P.landmarkIds)) { if (!Number.isInteger(v)) continue; const m = /^(.*?)([LR])$/.exec(k), pk = LANE_A[k] || (m && LANE_A[m[1]] ? LANE_A[m[1]] + '_' + m[2] : null); L[pk || k] = v; }
  // lines: geodesic paths kept on their own regions (a path that cuts across the armpit is not a clavicle)
  const keep = (...rs) => (a, b, len) => rs.includes(reg[b]) ? len : len * 30;
  const route = (pts, ...rs) => { const out = []; for (let k = 0; k + 1 < pts.length; k++) { const p = pathTo(T, X, pts[k], pts[k + 1], keep(...rs)); out.push(...(k ? p.slice(1) : p)); } return out; };
  for (const S of ['L', 'R']) {
    lines['clavicle_' + S] = route([L.suprasternale, L['acromion_' + S]], REG.torso, REG.neck);
    lines['ribarch_' + S] = route([L.xiphoid, L['ribside_' + S]], REG.torso);
    lines['crest_' + S] = route([L['asis_' + S], L['crest_' + S], L['psis_' + S]], REG.torso, REG.pelvis);
    lines['inguinal_' + S] = route([L['asis_' + S], L.pubis], REG.torso, REG.pelvis, REG.thigh);
    lines['scapula_' + S] = route([L['acromion_' + S], L['scapula_' + S]], REG.torso);
    lines['tibia_' + S] = route([L['tuberosity_' + S], L['shinfront_' + S]], REG.shin);
    lines['jaw_' + S] = route([L.menton, L['gonion_' + S]], REG.head, REG.jaw);
  }
  lines.spine = route([L.cervicale, L.sacrum], REG.neck, REG.torso, REG.pelvis);
  lines.linea = route([L.xiphoid, L.pubis], REG.torso, REG.pelvis);
  lines.nose = route([L.glabella, L.pronasale], REG.head);
  return { points: L, lines, s, lo, H, source: P.landmarkIds ? 'lane A basis landmarks (proxies where it has none)' : 'proxies' };
}
// lane A's names -> the proxies' (side suffix _L/_R added for the paired ones)
const LANE_A = { acromion: 'acromion', asis: 'asis', iliacCrest: 'crest', psis: 'psis', patella: 'patella', tibialTub: 'tuberosity', latMalleolus: 'malleolusLat',
  medMalleolus: 'malleolusMed', olecranon: 'olecranon', ulnarHead: 'ulnar', gonion: 'gonion', scapRoot: 'scapula', rib10: 'ribside' };
// the anchor field: 1 on a landmark, falling off geodesically (rho 2 cm at points, 1.4 cm along lines, at 1.75 m); with lane
// A's relief fields (P.relief: { name: { ix, f, mode } }) the bony ridges are anchors with their own profile (a fold, which
// deepens with fat, holds at half strength: the form around it may simplify)
export function anchorField(P, X, A, T = topo(P), { rhoP = 0.02, rhoL = 0.014 } = {}) {
  const f = new Float32Array(P.n), s = A.s;
  const pts = Object.values(A.points).filter(v => v != null), lns = [].concat(...Object.values(A.lines));
  for (const [src, rho] of [[pts, rhoP * s], [lns, rhoL * s]]) { if (!src.length) continue; const { dist } = dijkstra(T, X, src, { maxD: rho * 3 });
    for (const v of T.list) if (isFinite(dist[v])) f[v] = Math.max(f[v], Math.exp(-((dist[v] / rho) ** 2))); }
  if (P.relief) for (const r of Object.values(P.relief)) { const k = r.mode === 'fold' ? 0.5 : 1; for (let i = 0; i < r.ix.length; i++) { const v = r.ix[i]; f[v] = Math.max(f[v], k * Math.min(1, 1.25 * Math.abs(r.f[i]))); } }
  return f;
}

// ---------------------------------------------------------------- L1: masses (band-pass of the normal height field)
function bandFlatten(P, T, X, sigma, kCut, kFill, keep) {
  const B = diffuse(T, X, X, 3, sigma), N = vertexNormals(B, P.tris, P.n), h = new Float32Array(P.n);
  for (const v of T.list) h[v] = (X[v * 3] - B[v * 3]) * N[v * 3] + (X[v * 3 + 1] - B[v * 3 + 1]) * N[v * 3 + 1] + (X[v * 3 + 2] - B[v * 3 + 2]) * N[v * 3 + 2];
  const hs = diffuse(T, X, h, 1, sigma), out = Float32Array.from(X);
  for (const v of T.list) { const d = h[v] - hs[v], g = (d > 0 ? kCut : kFill) * d * (1 - keep[v]);
    out[v * 3] -= g * N[v * 3]; out[v * 3 + 1] -= g * N[v * 3 + 1]; out[v * 3 + 2] -= g * N[v * 3 + 2]; }
  return out;
}
// with lane A's layers: relief dropped, muscle fields merged per mass and low-passed (the groups' boundaries go), fat
// low-passed and never allowed below its own envelope (creases filled). D are bind displacements included in X.
function layerMasses(P, T, X, layers, sigma, keep) {
  const out = Float32Array.from(X), acc = (D, k) => { for (const v of T.list) for (let d = 0; d < 3; d++) out[v * 3 + d] += k * D[v * 3 + d] * (1 - keep[v]); };
  for (const Ly of layers) {
    if (Ly.kind === 'relief') { acc(Ly.D, -1); continue; }
    // a breast layer is a mass: kept as it is
    if (Ly.kind === 'muscle' || Ly.kind === 'fat') { const S = diffuse(T, X, Ly.D, 3, Ly.kind === 'fat' ? sigma * 0.7 : sigma);
      if (Ly.kind === 'fat') for (const v of T.list) for (let d = 0; d < 3; d++) { const a = Ly.D[v * 3 + d], b = S[v * 3 + d]; S[v * 3 + d] = Math.abs(b) > Math.abs(a) ? b : lerp(a, b, 0.5); }
      for (const v of T.list) for (let d = 0; d < 3; d++) out[v * 3 + d] += (S[v * 3 + d] - Ly.D[v * 3 + d]) * (1 - keep[v]); }
  }
  return out;
}

// ---------------------------------------------------------------- L2: planes (VSA proxies per mass, mirrored)
// planes per mass (central masses split in halves and mirrored): Bridgman's few big planes, not a faceting. First run: chest 12,
// abdomen 6, pelvis 8, limbs 6-7 read as camouflage patches in clay (03 Oct board); halved toward his counts.
export const PLANES_K = { breast: 4, head: 28, neck: 4, chest: 8, abdomen: 4, pelvis: 6, uarm: 4, farm: 4, hand: 5, thigh: 5, shin: 4, foot: 4 };
export const PLANE_WN = 0.22;   // normal weight in the clustering feature (m per unit of normal): planes are normal-coherent, not spatial blobs
function kmeans(F, dim, k, iters, rnd) {
  const m = F.length / dim; if (m <= k) return { lab: Int32Array.from({ length: m }, (_, i) => i), C: F.slice() };
  const C = new Float64Array(k * dim), d2 = new Float64Array(m).fill(Infinity), lab = new Int32Array(m);
  let first = Math.floor(rnd() * m); C.set(F.subarray(first * dim, first * dim + dim), 0);
  for (let c = 1; c < k; c++) { let tot = 0; for (let i = 0; i < m; i++) { let d = 0; for (let q = 0; q < dim; q++) d += (F[i * dim + q] - C[(c - 1) * dim + q]) ** 2; d2[i] = Math.min(d2[i], d); tot += d2[i]; }
    let r = rnd() * tot, pick = m - 1; for (let i = 0; i < m; i++) { r -= d2[i]; if (r <= 0) { pick = i; break; } } C.set(F.subarray(pick * dim, pick * dim + dim), c * dim); }
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < m; i++) { let b = 0, bd = Infinity; for (let c = 0; c < k; c++) { let d = 0; for (let q = 0; q < dim; q++) d += (F[i * dim + q] - C[c * dim + q]) ** 2; if (d < bd) { bd = d; b = c; } } lab[i] = b; }
    const S = new Float64Array(k * dim), cnt = new Float64Array(k); for (let i = 0; i < m; i++) { cnt[lab[i]]++; for (let q = 0; q < dim; q++) S[lab[i] * dim + q] += F[i * dim + q]; }
    for (let c = 0; c < k; c++) if (cnt[c]) for (let q = 0; q < dim; q++) C[c * dim + q] = S[c * dim + q] / cnt[c];
  }
  return { lab, C };
}
function planesOf(P, T, X, M, mirror, { wN = PLANE_WN, q = 0.62, seed = 5 } = {}) {
  // normals of a lightly smoothed surface (an eyelid crease is not a plane)
  const N = vertexNormals(diffuse(T, X, X, 3, 0.008), P.tris, P.n), pid = new Int32Array(P.n).fill(-1), PN = new Float32Array(P.n * 3), PD = new Float32Array(P.n), planes = [];
  let r = seed * 9301 + 49297; const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  for (const mass of MASSES) {
    if (mass.endsWith('.R')) continue;
    const mi = MASS_ID[mass], central = !mass.includes('.'), base = mass.split('.')[0], k = Math.max(2, Math.round((PLANES_K[base] || 6) / (central ? 2 : 1)));
    const vs = []; for (const v of T.list) if (M.dom[v] === mi && (!central || X[v * 3] >= -1e-4)) vs.push(v);
    if (vs.length < k * 3) continue;
    const F = new Float64Array(vs.length * 6); vs.forEach((v, i) => { for (let d = 0; d < 3; d++) { F[i * 6 + d] = X[v * 3 + d]; F[i * 6 + 3 + d] = N[v * 3 + d] * wN; } });
    const { lab } = kmeans(F, 6, k, 12, rnd);
    const groups = Array.from({ length: k }, () => []); vs.forEach((v, i) => groups[lab[i]].push(v));
    for (const g of groups) { if (!g.length) continue; let nx = 0, ny = 0, nz = 0; for (const v of g) { nx += N[v * 3]; ny += N[v * 3 + 1]; nz += N[v * 3 + 2]; }
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      const ds = g.map(v => X[v * 3] * nx + X[v * 3 + 1] * ny + X[v * 3 + 2] * nz).sort((a, b) => a - b), d = ds[Math.min(ds.length - 1, Math.floor(ds.length * q))];
      const c = [0, 0, 0]; for (const v of g) for (let e = 0; e < 3; e++) c[e] += X[v * 3 + e] / g.length;
      const id = planes.length; planes.push({ mass, n: [nx, ny, nz], d, c, count: g.length });
      // its mirror image: the other side of a paired mass, or the other half of a central one
      const mid = planes.length; planes.push({ mass: central ? mass : base + '.R', n: [-nx, ny, nz], d, c: [-c[0], c[1], c[2]], count: g.length, mirrorOf: id });
      for (const v of g) { pid[v] = id; PN.set([nx, ny, nz], v * 3); PD[v] = d; const u = mirror[v];
        if (u < 0 || u === v || (central && X[u * 3] > -1e-4)) continue;          // a midline vertex: its mirror is on this side too
        pid[u] = mid; PN.set([-nx, ny, nz], u * 3); PD[u] = d; } }
  }
  // any vertex left (a mirror miss): its nearest assigned neighbour's plane
  for (let pass = 0; pass < 4; pass++) for (const v of T.list) if (pid[v] < 0) for (let j = T.off[v]; j < T.off[v + 1]; j++) { const u = T.adj[j]; if (pid[u] >= 0) { pid[v] = pid[u]; PN.set(PN.subarray(u * 3, u * 3 + 3), v * 3); PD[v] = PD[u]; break; } }
  return { pid, PN, PD, planes, N, wN };
}
// the plane table the shader uses (surface.js): planes sorted by mass, a [start, count] range per mass. A FRAGMENT picks its
// plane with the clustering's own rule, argmin |x - c|^2 + wN^2 |n - n_j|^2 over its mass's planes, on its interpolated bind
// position and smooth bind normal: the plane breaks fall where the k-means boundaries lie, as smooth curves across the
// triangles instead of the mesh's staircase of per-vertex labels.
export function planeTable(planes, wN = PLANE_WN) {
  const order = planes.map((p, i) => i).sort((a, b) => MASS_ID[planes[a].mass] - MASS_ID[planes[b].mass] || a - b), np = order.length;
  const c = new Float32Array(np * 3), n = new Float32Array(np * 3), d = new Float32Array(np), range = MASSES.map(() => [0, 0]), remap = new Int32Array(planes.length);
  order.forEach((i, k) => { c.set(planes[i].c, k * 3); n.set(planes[i].n, k * 3); d[k] = planes[i].d; remap[i] = k; const m = MASS_ID[planes[i].mass]; if (!range[m][1]) range[m][0] = k; range[m][1]++; });
  return { c, n, d, range, wN, count: np, remap };
}
export function planeAt(PT, mass, p, nrm) { const [s0, cnt] = PT.range[mass]; let best = -1, bd = Infinity, w2 = PT.wN * PT.wN;
  for (let k = s0; k < s0 + cnt; k++) { const dc = (p[0] - PT.c[k * 3]) ** 2 + (p[1] - PT.c[k * 3 + 1]) ** 2 + (p[2] - PT.c[k * 3 + 2]) ** 2, dn = (nrm[0] - PT.n[k * 3]) ** 2 + (nrm[1] - PT.n[k * 3 + 1]) ** 2 + (nrm[2] - PT.n[k * 3 + 2]) ** 2, q = dc + w2 * dn; if (q < bd) { bd = q; best = k; } }
  return best; }
function planeShape(P, T, X, PL, keep, kGeo = 0.7) {
  const out = Float32Array.from(X);
  for (const v of T.list) { if (PL.pid[v] < 0) continue; const nx = PL.PN[v * 3], ny = PL.PN[v * 3 + 1], nz = PL.PN[v * 3 + 2], e = X[v * 3] * nx + X[v * 3 + 1] * ny + X[v * 3 + 2] * nz - PL.PD[v], k = kGeo * (1 - 0.6 * keep[v]);
    out[v * 3] -= k * e * nx; out[v * 3 + 1] -= k * e * ny; out[v * 3 + 2] -= k * e * nz; }
  return out;
}

// ---------------------------------------------------------------- L3: primitives on the joint centres
// limbs: tapered elliptical (superelliptic p 2.2) cylinders from joint centre to joint centre, the section's centre offset
// toward the mass (the calf behind the tibia) and tapered to zero at both joints; trunk, head, hands, feet: superellipsoids
// fitted to the mass in its own frame. Projection is radial (from the axis / the centre).
const LIMB = { uarm: ['upperarm01', 'lowerarm01'], farm: ['lowerarm01', 'wrist'], thigh: ['upperleg01', 'lowerleg01'], shin: ['lowerleg01', 'foot'] };
function pct(a, q) { const s = Float64Array.from(a).sort(); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))] : 0; }
function frameFrom(u, hint = [0, 0, 1]) { const ul = Math.hypot(...u); u = u.map(c => c / ul); let e1 = hint.map((c, i) => c - u[i] * (hint[0] * u[0] + hint[1] * u[1] + hint[2] * u[2])); let l = Math.hypot(...e1);
  if (l < 1e-3) { e1 = [1, 0, 0].map((c, i) => c - u[i] * u[0]); l = Math.hypot(...e1); } e1 = e1.map(c => c / l); const e2 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]]; return { u, e1, e2 }; }
function fitPrimitives(P, T, X, M) {
  const J = nm => P.heads[P.idx[nm]], prims = {};
  for (const mass of MASSES) {
    const mi = MASS_ID[mass], [base, sd] = mass.split('.'), vs = []; for (const v of T.list) if (M.dom[v] === mi && !(base === 'hand' && /^finger/.test(P.names[P.SI[v * 4]]) && P.SW[v * 4] > 0.5)) vs.push(v); if (vs.length < 8) continue;
    if (LIMB[base]) { const A = J(LIMB[base][0] + '.' + sd), B = J(LIMB[base][1] + '.' + sd), d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L = Math.hypot(...d), F = frameFrom(d, [0, 0, 1]);
      const S = 8, sl = Array.from({ length: S }, () => ({ a: [], b: [], o1: [], o2: [] }));
      for (const v of vs) { const q = [X[v * 3] - A[0], X[v * 3 + 1] - A[1], X[v * 3 + 2] - A[2]], t = (q[0] * F.u[0] + q[1] * F.u[1] + q[2] * F.u[2]) / L; if (t < 0.08 || t > 0.92) continue;
        const k = Math.min(S - 1, Math.floor(t * S)); const c1 = q[0] * F.e1[0] + q[1] * F.e1[1] + q[2] * F.e1[2], c2 = q[0] * F.e2[0] + q[1] * F.e2[1] + q[2] * F.e2[2]; sl[k].o1.push(c1); sl[k].o2.push(c2); sl[k].a.push(c1); sl[k].b.push(c2); }
      // per slice: centre (mid-range) and half-extents (p96); a linear fit over t for each
      const rows = sl.map((s0, k) => s0.a.length > 4 ? { t: (k + 0.5) / S, a: (pct(s0.a, 0.97) - pct(s0.a, 0.03)) / 2, b: (pct(s0.b, 0.97) - pct(s0.b, 0.03)) / 2, o1: (pct(s0.a, 0.97) + pct(s0.a, 0.03)) / 2, o2: (pct(s0.b, 0.97) + pct(s0.b, 0.03)) / 2 } : null).filter(Boolean);
      const lin = key => { const n = rows.length; if (n < 2) return [rows[0]?.[key] || 0.04, 0]; let st = 0, sy = 0, stt = 0, sty = 0; for (const r of rows) { st += r.t; sy += r[key]; stt += r.t * r.t; sty += r.t * r[key]; } const b = (n * sty - st * sy) / Math.max(1e-9, n * stt - st * st); return [(sy - b * st) / n, b]; };
      let om1 = 0, om2 = 0; for (const r of rows) { om1 += r.o1; om2 += r.o2; } om1 /= rows.length || 1; om2 /= rows.length || 1;
      prims[mass] = { kind: 'cyl', A, L, F, a: lin('a'), b: lin('b'), o: [om1, om2], p: 2.2 };
    } else {
      // superellipsoid in a frame: the head and trunk in the body axes, a hand along wrist -> middle knuckle, a foot heel -> toes
      let F = { u: [0, 1, 0], e1: [0, 0, 1], e2: [1, 0, 0] }, p = { head: 2.4, neck: 2.2, chest: 3.2, abdomen: 2.6, pelvis: 3.4, hand: 4, foot: 3.6 }[base] || 3;
      if (base === 'breast') { const bi = P.idx['breast.' + sd]; F = frameFrom([P.tails[bi][0] - P.heads[bi][0], P.tails[bi][1] - P.heads[bi][1], P.tails[bi][2] - P.heads[bi][2]], [0, 1, 0]); p = 2.1; }
      if (base === 'hand') F = frameFrom([J('finger3-1.' + sd)[0] - J('wrist.' + sd)[0], J('finger3-1.' + sd)[1] - J('wrist.' + sd)[1], J('finger3-1.' + sd)[2] - J('wrist.' + sd)[2]], [0, 0, 1]);
      if (base === 'foot') { const a = J('foot.' + sd), b = J('toe3-1.' + sd); F = frameFrom([b[0] - a[0], 0, b[2] - a[2]], [0, 1, 0]); }
      const loc = v => { const q = [X[v * 3], X[v * 3 + 1], X[v * 3 + 2]]; return [q[0] * F.u[0] + q[1] * F.u[1] + q[2] * F.u[2], q[0] * F.e1[0] + q[1] * F.e1[1] + q[2] * F.e1[2], q[0] * F.e2[0] + q[1] * F.e2[1] + q[2] * F.e2[2]]; };
      const Q = vs.map(loc), ax = [0, 1, 2].map(k => [pct(Q.map(r => r[k]), 0.01), pct(Q.map(r => r[k]), 0.99)]);
      const c = ax.map(([a, b]) => (a + b) / 2), hl = ax.map(([a, b]) => Math.max(0.01, (b - a) / 2));
      prims[mass] = { kind: 'box', F, c, h: hl, p };
    }
  }
  // fingers: one cylinder per phalanx (head -> tail of the bone), radius the median distance of its vertices from the axis
  P.names.forEach((nm, bi) => { if (!/^finger/.test(nm)) return; const A = P.heads[bi], B = P.tails[bi], d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L = Math.hypot(...d); if (L < 1e-4) return; const F = frameFrom(d, [0, 0, 1]), r = [];
    for (const v of T.list) { if (P.SI[v * 4] !== bi || P.SW[v * 4] < 0.5) continue; const q = [X[v * 3] - A[0], X[v * 3 + 1] - A[1], X[v * 3 + 2] - A[2]], t = q[0] * F.u[0] + q[1] * F.u[1] + q[2] * F.u[2]; r.push(Math.hypot(q[0] - t * F.u[0], q[1] - t * F.u[1], q[2] - t * F.u[2])); }
    if (r.length > 3) { const rr = pct(r, 0.6); prims['bone:' + nm] = { kind: 'cyl', A, L, F, a: [rr, 0], b: [rr * 0.9, 0], o: [0, 0], p: 2 }; } });
  // the neck as a cylinder from its base to the skull's (neck01 -> head)
  { const A = J('neck01'), B = J('head'), d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L = Math.hypot(...d), F = frameFrom(d, [0, 0, 1]), vs = []; for (const v of T.list) if (M.dom[v] === MASS_ID.neck) vs.push(v);
    const ra = [], rb = []; for (const v of vs) { const q = [X[v * 3] - A[0], X[v * 3 + 1] - A[1], X[v * 3 + 2] - A[2]]; ra.push(q[0] * F.e1[0] + q[1] * F.e1[1] + q[2] * F.e1[2]); rb.push(q[0] * F.e2[0] + q[1] * F.e2[1] + q[2] * F.e2[2]); }
    if (vs.length > 8) prims.neck = { kind: 'cyl', A, L, F, a: [(pct(ra, 0.97) - pct(ra, 0.03)) / 2, 0], b: [(pct(rb, 0.97) - pct(rb, 0.03)) / 2, 0], o: [(pct(ra, 0.97) + pct(ra, 0.03)) / 2, (pct(rb, 0.97) + pct(rb, 0.03)) / 2], p: 2.2 }; }
  return prims;
}
function projectPrim(pr, x, y, z, out) {
  if (pr.kind === 'cyl') { const q = [x - pr.A[0], y - pr.A[1], z - pr.A[2]], F = pr.F, tl = q[0] * F.u[0] + q[1] * F.u[1] + q[2] * F.u[2], t = clamp(tl / pr.L, 0, 1);
    const ofs = 4 * t * (1 - t), o1 = pr.o[0] * ofs, o2 = pr.o[1] * ofs, c1 = q[0] * F.e1[0] + q[1] * F.e1[1] + q[2] * F.e1[2] - o1, c2 = q[0] * F.e2[0] + q[1] * F.e2[1] + q[2] * F.e2[2] - o2;
    const a = Math.max(0.006, pr.a[0] + pr.a[1] * t), b = Math.max(0.006, pr.b[0] + pr.b[1] * t), th = Math.atan2(c2, c1), ct = Math.abs(Math.cos(th)), st = Math.abs(Math.sin(th));
    const rr = Math.pow(Math.pow(ct / a, pr.p) + Math.pow(st / b, pr.p), -1 / pr.p), k = rr / Math.max(1e-6, Math.hypot(c1, c2));
    const n1 = o1 + c1 * k, n2 = o2 + c2 * k;
    for (let d = 0; d < 3; d++) out[d] = pr.A[d] + F.u[d] * tl + F.e1[d] * n1 + F.e2[d] * n2; return out; }
  const F = pr.F, l = [x * F.u[0] + y * F.u[1] + z * F.u[2] - pr.c[0], x * F.e1[0] + y * F.e1[1] + z * F.e1[2] - pr.c[1], x * F.e2[0] + y * F.e2[1] + z * F.e2[2] - pr.c[2]];
  const s = Math.pow(Math.pow(Math.abs(l[0] / pr.h[0]), pr.p) + Math.pow(Math.abs(l[1] / pr.h[1]), pr.p) + Math.pow(Math.abs(l[2] / pr.h[2]), pr.p), 1 / pr.p) || 1;
  const g = [pr.c[0] + l[0] / s, pr.c[1] + l[1] / s, pr.c[2] + l[2] / s];
  for (let d = 0; d < 3; d++) out[d] = F.u[d] * g[0] + F.e1[d] * g[1] + F.e2[d] * g[2]; return out;
}
function primShape(P, T, X, M, prims, keep) {
  const out = Float32Array.from(X), t = [0, 0, 0], NM = MASSES.length, hands = [MASS_ID['hand.L'], MASS_ID['hand.R']];
  for (const v of T.list) { let x = 0, y = 0, z = 0, ws = 0; const px = X[v * 3], py = X[v * 3 + 1], pz = X[v * 3 + 2];
    for (let m = 0; m < NM; m++) { const w = M.memb[v * NM + m]; if (w < 1e-3) continue;
      if (hands.includes(m)) { for (let k = 0; k < 4; k++) { const wb = P.SW[v * 4 + k], bi = P.SI[v * 4 + k]; if (!wb || M.boneMass[bi] !== m) continue; const pr = prims['bone:' + P.names[bi]] || prims[MASSES[m]]; if (!pr) continue;
        projectPrim(pr, px, py, pz, t); x += wb * t[0]; y += wb * t[1]; z += wb * t[2]; ws += wb; } continue; }
      const pr = prims[MASSES[m]]; if (!pr) continue; projectPrim(pr, px, py, pz, t); x += w * t[0]; y += w * t[1]; z += w * t[2]; ws += w; }
    // the mannequin's head is Loomis's egg and jaw: the face anchors (identity at L0-L2) give way here; the joints do not move
    if (ws < 1e-3) continue; const hd = P.reg[v] === 0 || P.reg[v] === 11, k = (1 - 0.5 * keep[v] * (hd ? 0.25 : 1)) * Math.min(1, ws);
    out[v * 3] = lerp(px, x / ws, k); out[v * 3 + 1] = lerp(py, y / ws, k); out[v * 3 + 2] = lerp(pz, z / ws, k); }
  return out;
}

// ---------------------------------------------------------------- levels per region
// level: a number, or { default, head, hands, limbs, trunk, ... } (GROUPS keys or mass names; later keys win)
export function levelPerMass(level) {
  const L = new Float32Array(MASSES.length); const spec = typeof level === 'number' ? { default: level } : { default: 0, ...level };
  L.fill(spec.default ?? 0);
  for (const [k, val] of Object.entries(spec)) { if (k === 'default') continue; for (const m of (GROUPS[k] || (MASS_ID[k] != null ? [k] : []))) L[MASS_ID[m]] = val; }
  return L;
}

// ---------------------------------------------------------------- canons
export const CANONS = {
  natural: { m: {}, f: {} },
  heroic: { m: { heads: 0.8, legShare: 0.72, shoulders: 1.08, chest: 1.04, waist: 0.97, neck: [1.04, 1.06], uarmG: 1.05, farmG: 1.05, hand: 1.03 },
    f: { heads: 0.7, legShare: 0.72, shoulders: 1.05, chest: 1.02, waist: 0.98, neck: [1.03, 1.03], uarmG: 1.04, farmG: 1.04, hand: 1.02 } },
  monumental: { m: { head: 0.86, legShare: 0.6, shoulders: 1.22, chest: 1.08, waist: 1.03, hips: 1.03, neck: [1.0, 1.25], uarmG: 1.12, farmG: 1.22, farmL: 1.04, hand: 1.2, thighG: 1.08, calfG: 1.08, foot: 1.1 },
    f: { head: 0.88, legShare: 0.55, shoulders: 1.17, chest: 1.05, waist: 1.03, hips: 1.04, neck: [1.0, 1.18], uarmG: 1.12, farmG: 1.18, farmL: 1.03, hand: 1.16, thighG: 1.08, calfG: 1.08, foot: 1.08 } },
};
// the person's head canon from the proxies: stature / (vertex - menton)
export function headCanon(P, X, T = topo(P), A = null) { A ||= landmarkProxies(P, X, T); const { H } = statureOf(T, X), hh = X[A.points.vertex * 3 + 1] - X[A.points.menton * 3 + 1]; return { stature: H, headH: hh, heads: H / hh }; }
function boneAxis(P, i) { const h = P.heads[i], t = P.tails[i], d = [t[0] - h[0], t[1] - h[1], t[2] - h[2]], l = Math.hypot(...d) || 1; return d.map(c => c / l); }
// per-bone scale spec -> 3x3 (row-major) S = I + (len-1) u u^T + (gx-1) ex ex^T + (gz-1) ez ez^T (ex, ez spanning the plane across u)
function scaleMat(u, len, gx, gz) {   // gx: breadth along world x (or z for a bone along x), gz: the remaining direction across u
  const ref = Math.abs(u[0]) > 0.9 ? [0, 0, 1] : [1, 0, 0], k = ref[0] * u[0] + ref[1] * u[1] + ref[2] * u[2]; let ex = ref.map((c, i) => c - k * u[i]); const l = Math.hypot(...ex) || 1; ex = ex.map(c => c / l);
  const ez = [u[1] * ex[2] - u[2] * ex[1], u[2] * ex[0] - u[0] * ex[2], u[0] * ex[1] - u[1] * ex[0]];
  const S = [1, 0, 0, 0, 1, 0, 0, 0, 1]; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r * 3 + c] += (len - 1) * u[r] * u[c] + (gx - 1) * ex[r] * ex[c] + (gz - 1) * ez[r] * ez[c]; return S; }
export function applyCanon(P, canon, { T = topo(P), A = null } = {}) {
  const spec = typeof canon === 'string' ? (CANONS[canon] || CANONS.natural)[P.sex === 'f' ? 'f' : 'm'] : canon;
  if (!spec || !Object.keys(spec).length) return P;
  const X = P.pos, J = nm => P.heads[P.idx[nm]], hc = headCanon(P, X, T, A), sh = spec.head ?? (spec.heads ? hc.heads / (hc.heads + spec.heads) : 1);
  // the vertical budget the smaller head frees (the head shrinks about the top of the neck), shared legs : trunk : neck
  const freed = (1 - sh) * hc.headH, legV = (J('upperleg01.L')[1] + J('upperleg01.R')[1]) / 2 - (J('foot.L')[1] + J('foot.R')[1]) / 2, trunkV = J('neck01')[1] - J('spine05')[1], neckV = J('head')[1] - J('neck01')[1];
  const ls = spec.legShare ?? 0.65, fLeg = 1 + ls * freed / legV, fTrunk = 1 + (1 - ls) * 0.75 * freed / trunkV, fNeck = (spec.neck ? spec.neck[0] : 1) * (1 + (1 - ls) * 0.25 * freed / neckV);
  const fArm = 1 + 0.8 * (fLeg - 1), g = (k, d = 1) => spec[k] ?? d;
  // per-bone [length, girth x, girth z] or { uni } (uniform about the bone's head)
  const S = new Array(P.names.length).fill(null), set = (re, v) => P.names.forEach((nm, i) => { if (re.test(nm)) S[i] = v; });
  set(/^(spine05|spine04|spine03)$/, [fTrunk, g('waist'), g('waist')]); set(/^(spine02|spine01)$/, [fTrunk, g('chest'), g('chest') ** 0.5]);
  set(/^root$/, [1, g('hips'), 1]); set(/^pelvis\./, [g('hips'), 1, 1]);
  set(/^neck0/, [fNeck, spec.neck ? spec.neck[1] : 1, spec.neck ? spec.neck[1] : 1]);
  set(/^clavicle\./, [g('shoulders'), 1, 1]); set(/^shoulder01\./, [g('shoulders'), g('uarmG') ** 0.5, g('uarmG') ** 0.5]);   // the girdle spans both: clavicle + the acromial end
  set(/^upperarm0/, [fArm, g('uarmG'), g('uarmG')]); set(/^lowerarm0/, [fArm * g('farmL'), g('farmG'), g('farmG')]);
  set(/^upperleg0/, [fLeg, g('thighG'), g('thighG')]); set(/^lowerleg0/, [fLeg, g('calfG'), g('calfG')]);
  const uni = { head: sh, wrist: g('hand'), foot: g('foot') };
  // affine per bone, down the hierarchy: T_b(x) = H'_b + S_b (x - H_b); H'_b = T_parent(H_b); bones without a spec inherit
  const n = P.names.length, Mx = new Array(n), Hn = new Array(n), mul = (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
  const matmul = (A2, B2) => { const C = new Array(9).fill(0); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) C[r * 3 + c] += A2[r * 3 + k] * B2[k * 3 + c]; return C; };
  const order = []; const vis = new Uint8Array(n); const visit = i => { if (vis[i]) return; if (P.parent[i] >= 0) visit(P.parent[i]); vis[i] = 1; order.push(i); }; for (let i = 0; i < n; i++) visit(i);
  const xform = (i, x) => { const d = [x[0] - P.heads[i][0], x[1] - P.heads[i][1], x[2] - P.heads[i][2]], r = mul(Mx[i], d); return [Hn[i][0] + r[0], Hn[i][1] + r[1], Hn[i][2] + r[2]]; };
  for (const i of order) { const p = P.parent[i], nm = P.names[i];
    Hn[i] = p >= 0 ? xform(p, P.heads[i]) : [...P.heads[i]];
    const base = nm.replace(/\.(L|R)$/, '');
    if (uni[base] != null) Mx[i] = [uni[base], 0, 0, 0, uni[base], 0, 0, 0, uni[base]];
    else if (S[i]) Mx[i] = scaleMat(boneAxis(P, i), ...S[i]);
    else Mx[i] = p >= 0 ? Mx[p] : [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }
  const out = { ...P, pos: new Float32Array(P.pos.length), eyes: new Float32Array(P.eyes.length) };
  const disp = new Float32Array(P.n * 3), mixed = new Float32Array(P.n);
  for (let v = 0; v < P.n; v++) { const x = [P.pos[v * 3], P.pos[v * 3 + 1], P.pos[v * 3 + 2]]; let a = [0, 0, 0], wmax = 0;
    for (let k = 0; k < 4; k++) { const w = P.SW[v * 4 + k]; if (!w) continue; const y = xform(P.SI[v * 4 + k], x); a = [a[0] + w * y[0], a[1] + w * y[1], a[2] + w * y[2]]; wmax = Math.max(wmax, w); }
    out.pos.set(a, v * 3); for (let d = 0; d < 3; d++) disp[v * 3 + d] = a[d] - x[d]; mixed[v] = clamp((0.92 - wmax) / 0.4); }
  // the corrective: relax the displacement where weights mix (a joint between two differently scaled bones), so the blend
  // has no crease; the joint centres themselves do not move
  if (T) { const sm = diffuse(T, P.pos, disp, 3, 0.02, { rate: mixed }); for (const v of T.list) for (let d = 0; d < 3; d++) out.pos[v * 3 + d] = P.pos[v * 3 + d] + sm[v * 3 + d]; }
  const hi = P.idx.head; for (let k = 0; k < P.ne; k++) out.eyes.set(xform(hi, [P.eyes[k * 3], P.eyes[k * 3 + 1], P.eyes[k * 3 + 2]]), k * 3);
  out.heads = Hn; out.tails = P.tails.map((tl, i) => xform(i, tl));
  floor(out, T);
  out.canon = { name: typeof canon === 'string' ? canon : 'custom', head: +sh.toFixed(3), leg: +fLeg.toFixed(3), trunk: +fTrunk.toFixed(3), neck: +fNeck.toFixed(3), arm: +fArm.toFixed(3), from: +hc.heads.toFixed(2) };
  return out;
}
function floor(P, T) { const { lo } = statureOf(T, P.pos); if (Math.abs(lo) < 1e-6) return;
  for (let i = 1; i < P.pos.length; i += 3) P.pos[i] -= lo; for (let i = 1; i < P.eyes.length; i += 3) P.eyes[i] -= lo; P.heads = P.heads.map(h => [h[0], h[1] - lo, h[2]]); P.tails = P.tails.map(h => [h[0], h[1] - lo, h[2]]); }

// ---------------------------------------------------------------- caricature (Benson and Perrett 1991)
// the mean of a group of persons on the same topology (each scaled to the subject's stature about the floor centre)
export function meanPerson(list, T) {
  const n = list[0].n, pos = new Float32Array(n * 3), eyes = new Float32Array(list[0].eyes.length), heads = list[0].heads.map(() => [0, 0, 0]), tails = list[0].tails.map(() => [0, 0, 0]);
  for (const Q of list) { const s = 1 / statureOf(T, Q.pos).H; for (let i = 0; i < pos.length; i++) pos[i] += Q.pos[i] * s / list.length; for (let i = 0; i < eyes.length; i++) eyes[i] += Q.eyes[i] * s / list.length;
    Q.heads.forEach((h, i) => { for (let d = 0; d < 3; d++) heads[i][d] += h[d] * s / list.length; }); Q.tails.forEach((h, i) => { for (let d = 0; d < 3; d++) tails[i][d] += h[d] * s / list.length; }); }
  return { pos, eyes, heads, tails, unit: true, count: list.length };
}
export function caricature(P, mean, k, T = topo(P)) {
  const H = statureOf(T, P.pos).H, s = mean.unit ? H : 1, ex = (a, m) => m * s + k * (a - m * s);
  const out = { ...P, pos: P.pos.map((a, i) => ex(a, mean.pos[i])), eyes: P.eyes.map((a, i) => ex(a, mean.eyes[i])), heads: P.heads.map((h, i) => h.map((a, d) => ex(a, mean.heads[i][d]))), tails: P.tails.map((h, i) => h.map((a, d) => ex(a, mean.tails[i][d]))) };
  floor(out, T); out.caricature = { k, of: mean.count }; return out;
}

// ---------------------------------------------------------------- kinematics from the styled mesh
// Dempster 1955 segment densities (kg/l, Winter 2009 table 4.1); segments as de Leva 1996's, joint centre to joint centre
const DENS = { head: 1.11, thorax: 0.92, abdomen: 1.01, pelvis: 1.01, uarm: 1.07, farm: 1.13, hand: 1.16, thigh: 1.05, shank: 1.09, foot: 1.10 };
function kinSegments(J) {
  const S = [['head', J('neck01'), J('head'), 'head'], ['thorax', J('spine02'), J('neck01'), 'thorax'], ['abdomen', J('spine04'), J('spine02'), 'abdomen'], ['pelvis', J('root'), J('spine04'), 'pelvis']];
  for (const s of ['L', 'R']) S.push(['uarm.' + s, J('upperarm01.' + s), J('lowerarm01.' + s), 'uarm'], ['farm.' + s, J('lowerarm01.' + s), J('wrist.' + s), 'farm'], ['hand.' + s, J('wrist.' + s), J('finger3-1.' + s), 'hand'],
    ['thigh.' + s, J('upperleg01.' + s), J('lowerleg01.' + s), 'thigh'], ['shank.' + s, J('lowerleg01.' + s), J('foot.' + s), 'shank'], ['foot.' + s, J('foot.' + s), J('toe3-1.' + s), 'foot']);
  return S;
}
export function kinOf(P, X = P.pos, { scale = 1, cell = 0.01, T = topo(P), heads = P.heads } = {}) {
  const J = nm => heads[P.idx[nm]].map(c => c * scale), tris = P.tris, s = scale;
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (const v of T.list) for (let d = 0; d < 3; d++) { lo[d] = Math.min(lo[d], X[v * 3 + d] * s); hi[d] = Math.max(hi[d], X[v * 3 + d] * s); }
  const nx = Math.ceil((hi[0] - lo[0]) / cell) + 1, ny = Math.ceil((hi[1] - lo[1]) / cell) + 1, cols = new Map();
  const jx = 0.371 * cell, jy = 0.613 * cell;   // column centres off the grid's lattice (no ray through a vertex)
  for (let t = 0; t < tris.length; t += 3) { const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3, A = [X[a] * s, X[a + 1] * s, X[a + 2] * s], B = [X[b] * s, X[b + 1] * s, X[b + 2] * s], C = [X[c] * s, X[c + 1] * s, X[c + 2] * s];
    const x0 = Math.floor((Math.min(A[0], B[0], C[0]) - lo[0] - jx) / cell), x1 = Math.ceil((Math.max(A[0], B[0], C[0]) - lo[0] - jx) / cell), y0 = Math.floor((Math.min(A[1], B[1], C[1]) - lo[1] - jy) / cell), y1 = Math.ceil((Math.max(A[1], B[1], C[1]) - lo[1] - jy) / cell);
    const den = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]); if (Math.abs(den) < 1e-14) continue;
    for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) { const px = lo[0] + jx + ix * cell, py = lo[1] + jy + iy * cell;
      const l1 = ((B[1] - C[1]) * (px - C[0]) + (C[0] - B[0]) * (py - C[1])) / den, l2 = ((C[1] - A[1]) * (px - C[0]) + (A[0] - C[0]) * (py - C[1])) / den, l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue; const key = ix * ny + iy; (cols.get(key) || cols.set(key, []).get(key)).push(l1 * A[2] + l2 * B[2] + l3 * C[2]); } }
  const SEG = kinSegments(J), acc = SEG.map(() => ({ m: 0, c: [0, 0, 0], I: [0, 0, 0, 0, 0, 0] })), V = cell ** 3;
  const segD = (p, A, B) => { const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], l2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2, t = clamp(((p[0] - A[0]) * d[0] + (p[1] - A[1]) * d[1] + (p[2] - A[2]) * d[2]) / (l2 || 1)); return Math.hypot(p[0] - A[0] - t * d[0], p[1] - A[1] - t * d[1], p[2] - A[2] - t * d[2]); };
  let nVox = 0;
  for (const [key, zs] of cols) { if (zs.length < 2) continue; zs.sort((a, b) => a - b); const ix = Math.floor(key / ny), iy = key % ny, px = lo[0] + jx + ix * cell, py = lo[1] + jy + iy * cell;
    for (let k = 0; k + 1 < zs.length; k += 2) for (let z = Math.ceil((zs[k] - lo[2]) / cell) * cell + lo[2]; z < zs[k + 1]; z += cell) {
      const p = [px, py, z]; let bi = 0, bd = Infinity; for (let j = 0; j < SEG.length; j++) { const d = segD(p, SEG[j][1], SEG[j][2]); if (d < bd) { bd = d; bi = j; } }
      const m = V * 1000 * DENS[SEG[bi][3]], a = acc[bi]; a.m += m; a.c[0] += m * p[0]; a.c[1] += m * p[1]; a.c[2] += m * p[2]; a.I[0] += m * p[0] * p[0]; a.I[1] += m * p[1] * p[1]; a.I[2] += m * p[2] * p[2]; a.I[3] += m * p[0] * p[1]; a.I[4] += m * p[0] * p[2]; a.I[5] += m * p[1] * p[2]; nVox++; } }
  const segments = {}; let M = 0; const com = [0, 0, 0];
  SEG.forEach(([name, A, B], j) => { const a = acc[j]; if (!a.m) return; const c = a.c.map(q => q / a.m), xx = a.I[0] / a.m - c[0] ** 2, yy = a.I[1] / a.m - c[1] ** 2, zz = a.I[2] / a.m - c[2] ** 2, xy = a.I[3] / a.m - c[0] * c[1], xz = a.I[4] / a.m - c[0] * c[2], yz = a.I[5] / a.m - c[1] * c[2];
    const L = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]), tC = ((c[0] - A[0]) * (B[0] - A[0]) + (c[1] - A[1]) * (B[1] - A[1]) + (c[2] - A[2]) * (B[2] - A[2])) / (L * L || 1);
    segments[name] = { mass: +a.m.toFixed(3), com: c.map(q => +q.toFixed(4)), comFrac: +tC.toFixed(3), length: +L.toFixed(4), proximal: A.map(q => +q.toFixed(4)), distal: B.map(q => +q.toFixed(4)),
      inertia: [a.m * (yy + zz), a.m * (xx + zz), a.m * (xx + yy), -a.m * xy, -a.m * xz, -a.m * yz].map(q => +q.toFixed(5)) };
    M += a.m; for (let d = 0; d < 3; d++) com[d] += a.m * c[d]; });
  for (let d = 0; d < 3; d++) com[d] /= M || 1;
  const stature = hi[1] - lo[1], hipL = J('upperleg01.L'), hipR = J('upperleg01.R'), hipJ = Math.hypot(hipL[0] - hipR[0], hipL[2] - hipR[2]);
  const ft = ['L', 'R'].map(sd => { const a = J('foot.' + sd), b = J('toe3-1.' + sd); return { heel: a[2] - 0.05 * scale, toe: b[2] + 0.03 * scale }; });
  const out = { schema: 'style/shape kin v1', mass: +M.toFixed(2), com: com.map(q => +q.toFixed(4)), comH: +((com[1] - lo[1]) / stature).toFixed(4), stature: +stature.toFixed(4), segments,
    stance: { hipJoints: +hipJ.toFixed(4), footSpacing: +(hipJ * (P.sex === 'f' ? 0.9 : 1.0)).toFixed(4), comOverFeet: com[2] > Math.min(ft[0].heel, ft[1].heel) && com[2] < Math.max(ft[0].toe, ft[1].toe) },
    voxels: nVox, cell, method: '1 cm voxels, nearest joint-to-joint capsule, Dempster densities (Winter 2009 t4.1); de Leva 1996 segments' };
  return out;
}
// soft-tissue flexion limit deltas (deg) between two kins: two cylinders hinged at the joint meet earlier when they are thicker
function flexLimit(seg, a, b) { if (!seg[a] || !seg[b]) return null; const r = s => Math.sqrt(s.mass / (1060 * Math.PI * s.length)); const ra = r(seg[a]), rb = r(seg[b]), d = 0.45 * (seg[a].length + seg[b].length);
  return 180 - 2 * Math.atan((ra + rb) / d) * 180 / Math.PI; }
export function softTissue(kin, kin0) { const out = {}; for (const [k, a, b] of [['elbowFlex.L', 'uarm.L', 'farm.L'], ['elbowFlex.R', 'uarm.R', 'farm.R'], ['kneeFlex.L', 'thigh.L', 'shank.L'], ['kneeFlex.R', 'thigh.R', 'shank.R']]) {
  const x = flexLimit(kin.segments, a, b), y = kin0 ? flexLimit(kin0.segments, a, b) : null; out[k] = x == null ? null : +(y == null ? 0 : x - y).toFixed(1); } return out; }

// ---------------------------------------------------------------- measures (enough to read a style by; the bench has the full set)
export function measuresOf(P, X, T, A, kin = null) {
  const hc = headCanon(P, X, T, A), J = nm => P.heads[P.idx[nm]], d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), pt = k => A.points[k] != null ? [X[A.points[k] * 3], X[A.points[k] * 3 + 1], X[A.points[k] * 3 + 2]] : null;
  let sh = 0; const sy = J('upperarm01.L')[1]; for (const v of T.list) if (Math.abs(X[v * 3 + 1] - sy - 0.01) < 0.02 && (P.reg[v] === REG.torso)) sh = Math.max(sh, Math.abs(X[v * 3]));
  let hip = 0; const hy = J('upperleg01.L')[1]; for (const v of T.list) if (Math.abs(X[v * 3 + 1] - hy + 0.02) < 0.03 && (P.reg[v] === REG.pelvis || P.reg[v] === REG.thigh)) hip = Math.max(hip, Math.abs(X[v * 3]));
  return { stature: +hc.stature.toFixed(4), headH: +hc.headH.toFixed(4), heads: +hc.heads.toFixed(2), biacromial: +(2 * sh).toFixed(4), hipBreadth: +(2 * hip).toFixed(4),
    upperArm: +d(J('upperarm01.L'), J('lowerarm01.L')).toFixed(4), foreArm: +d(J('lowerarm01.L'), J('wrist.L')).toFixed(4), thigh: +d(J('upperleg01.L'), J('lowerleg01.L')).toFixed(4), shank: +d(J('lowerleg01.L'), J('foot.L')).toFixed(4),
    hipJointY: +(((J('upperleg01.L')[1] + J('upperleg01.R')[1]) / 2) / hc.stature).toFixed(3), mass: kin ? kin.mass : null, comH: kin ? kin.comH : null, unit: 'bind metres (x render scale for metres)' };
}

// ---------------------------------------------------------------- the styled person
// opts: level (number | per-region object), canon ('natural'|'heroic'|'monumental'|spec), caricature: { mean, k },
// layers (lane A), keepFace (anchor the eyes and mouth harder), height (rendered stature for kin), name, planes { wN, q, kGeo }
export function styleShape(src, opts = {}) {
  let P = src.pos && src.heads ? src : readPerson(src, opts.variant);
  const T = topo(P), A0 = landmarkProxies(P, P.pos, T);
  if (opts.caricature && opts.caricature.mean) P = caricature(P, opts.caricature.mean, opts.caricature.k ?? 1.5, T);
  if (opts.canon && opts.canon !== 'natural') P = applyCanon(P, opts.canon, { T, A: A0 });
  const X0 = P.pos, A = landmarkProxies(P, X0, T), anchor = anchorField(P, X0, A, T), M = massTables(P);
  // per-vertex level: the masses' levels blended by the skin weights (smooth across every joint), then a light diffusion
  const LM = levelPerMass(opts.level ?? 0), NM = MASSES.length; let lev = new Float32Array(P.n);
  for (let v = 0; v < P.n; v++) { let s = 0, w = 0; for (let m = 0; m < NM; m++) { const q = M.memb[v * NM + m]; s += q * LM[m]; w += q; } lev[v] = w ? s / w : LM[0]; }
  lev = diffuse(T, X0, lev, 1, 0.015);
  const maxL = Math.max(...LM);
  // the face keeps its eyes, mouth and nostrils a little harder than the rest (identity lives there): keepFace 0..1
  const keep = Float32Array.from(anchor), kf = opts.keepFace ?? 0.5;
  if (kf > 0) { const eyes = [[0, 0, 0], [0, 0, 0]]; let cnt = [0, 0]; const es = P.arr('eye_side'); for (let k = 0; k < P.ne; k++) { const sd = es[k] ? 0 : 1; for (let d = 0; d < 3; d++) eyes[sd][d] += P.eyes[k * 3 + d]; cnt[sd]++; }
    eyes.forEach((e, i) => e.forEach((_, d) => { e[d] /= cnt[i] || 1; }));
    for (const v of T.list) { const p = [X0[v * 3], X0[v * 3 + 1], X0[v * 3 + 2]]; let q = 0; for (const e of eyes) q = Math.max(q, Math.exp(-(((p[0] - e[0]) ** 2 + (p[1] - e[1]) ** 2 + (p[2] - e[2]) ** 2) / (0.022 * A.s) ** 2)));
      keep[v] = Math.max(keep[v], kf * q); } }
  const stops = [X0]; let X1 = X0, Xs = X0;
  if (maxL > 0) {
    const sig1 = 0.012 * A.s, sig2 = 0.03 * A.s;
    if (P.layers || opts.layers) { Xs = layerMasses(P, T, X0, (opts.layers || P.layers).filter(l => l.kind === 'relief'), sig1, keep); X1 = layerMasses(P, T, X0, opts.layers || P.layers, sig2, keep); }
    else { Xs = bandFlatten(P, T, X0, sig1, 0.8, 1.0, keep); X1 = bandFlatten(P, T, Xs, sig2, 0.55, 0.9, keep); }
  }
  stops.push(Xs, X1);
  let X2 = X1, PL = null, X3 = X1, prims = null;
  if (maxL > 1) { PL = planesOf(P, T, X1, M, mirrorMap(T, X1), opts.planes || {}); X2 = planeShape(P, T, X1, PL, keep, opts.planes?.kGeo ?? 0.4); }
  if (maxL > 2) { prims = fitPrimitives(P, T, X1, M); X3 = primShape(P, T, X2, M, prims, keep); }
  stops.push(X2, X3);
  // L4 is a read over the masses: its geometry is L1's (the silhouette of the masses), its surface two values (surface.js)
  const at = [0, 0.5, 1, 2, 3], pos = new Float32Array(P.pos.length);
  for (let v = 0; v < P.n; v++) { const l = lev[v] > 3 ? 1 : lev[v]; let k = 0; while (k < 3 && l > at[k + 1]) k++; const u = clamp((l - at[k]) / (at[k + 1] - at[k]));
    for (let d = 0; d < 3; d++) pos[v * 3 + d] = lerp(stops[k][v * 3 + d], stops[k + 1][v * 3 + d], u); }
  // normals for the finish: smooth (computed by hero.js) blended toward the plane normals between L1 and L3
  let NS = null;
  if (PL) { const Ngeo = vertexNormals(pos, P.tris, P.n); NS = new Float32Array(P.n * 3);
    for (const v of T.list) { const l = lev[v] > 3 ? 1 : lev[v], w = PL.pid[v] >= 0 ? clamp(l - 1) * (l <= 2 ? 1 : clamp(3 - l + 0.35)) : 0;
      for (let d = 0; d < 3; d++) NS[v * 3 + d] = lerp(Ngeo[v * 3 + d], PL.PN[v * 3 + d], w);
      const ln = Math.hypot(NS[v * 3], NS[v * 3 + 1], NS[v * 3 + 2]) || 1; for (let d = 0; d < 3; d++) NS[v * 3 + d] /= ln; } }
  // a per-vertex style attribute for surface.js and line.js: mass id, plane id, anchor weight, level
  const PTab = PL ? planeTable(PL.planes, PL.wN) : null;
  const aStyle = new Float32Array(P.n * 4); for (let v = 0; v < P.n; v++) { aStyle[v * 4] = M.dom[v]; aStyle[v * 4 + 1] = PL && PL.pid[v] >= 0 ? PTab.remap[PL.pid[v]] : -1; aStyle[v * 4 + 2] = anchor[v]; aStyle[v * 4 + 3] = lev[v]; }
  // the new variant: bind stature kept (so hero.js's group scale gives the person's stature at the same o.height)
  const nm = opts.name || `${P.name}~${typeof opts.canon === 'string' ? opts.canon : opts.canon ? 'canon' : 'nat'}${opts.caricature ? '~k' + opts.caricature.k : ''}~L${typeof opts.level === 'number' ? opts.level : JSON.stringify(opts.level ?? 0).replace(/[^a-z0-9.]+/gi, '')}`;
  const Pn = { ...P, pos }; floor(Pn, T);
  const hNew = statureOf(T, Pn.pos).H, hSrc = statureOf(T, src.pos && src.heads ? src.pos : readPerson(src, opts.variant).pos).H, Vh = P.bindH * hNew / hSrc;
  const V = { ...P.V, name: nm, heads: Pn.heads, tails: Pn.tails, height: Vh, note: `${P.V.note || P.name}; style: ${nm}` };
  const meta = { ...P.meta, variants: [...P.meta.variants.filter(x => x.name !== nm), V] }, arr0 = P.arr;
  const arr = k => k === 'pos_' + nm ? Pn.pos : k === 'eyes_' + nm ? Pn.eyes : arr0(k);
  const renderScale = (opts.height || src.height || P.height || P.bindH) / Vh;
  const kin = opts.kin === false ? null : kinOf(Pn, Pn.pos, { scale: renderScale, T });
  const kin0 = opts.kin === false ? null : (src.kin || P.kin0 || null);
  const headL = LM[MASS_ID.head];
  const out = {
    meta, arr, name: nm, height: opts.height || src.height || null, sex: P.sex, age: P.age, label: P.label, src: P.name,
    pos: Pn.pos, eyes: Pn.eyes, heads: Pn.heads, tails: Pn.tails, n: P.n, ne: P.ne, names: P.names, idx: P.idx, parent: P.parent, tris: P.tris, reg: P.reg, SI: P.SI, SW: P.SW, V, bindH: Vh,
    anchors: A, anchorField: anchor, levels: lev, massTable: M, planes: PL ? PL.planes : null, planeTable: PTab, planeNormals: PL ? PL.N : null, prims, aStyle, normals: NS,
    kin, softTissue: kin && kin0 && kin0.segments && String(kin0.schema || '').startsWith('style') ? softTissue(kin, kin0) : null, kinSource: kin0 ? 'lane A ranges carried' : 'no source ranges (lane A p.kin.ranges)', ranges: kin0 && kin0.ranges ? kin0.ranges : null,
    measures: measuresOf(Pn, Pn.pos, T, A, kin), canon: P.canon || null, caricature: P.caricature || null, level: opts.level ?? 0,
    // after new Hero(...): the style attributes; bakeNormals writes the plane normals into the mesh for a renderer without
    // surface.js (the surface patch picks planes per fragment instead, with smooth breaks)
    finish(h, { bakeNormals = false } = {}) {
      const g = h.body.geometry;
      if (PL) g.setAttribute('aStyleN', new THREE.BufferAttribute(PL.N, 3));
      if (NS && bakeNormals) { const Nn = g.attributes.normal.array; for (const v of T.list) for (let d = 0; d < 3; d++) Nn[v * 3 + d] = NS[v * 3 + d]; g.attributes.normal.needsUpdate = true; }
      g.setAttribute('aStyle', new THREE.BufferAttribute(aStyle, 4));
      if (h.eyes) h.eyes.visible = headL < 2.6;     // kept through L2 (hidden eyes leave empty sockets); the L3 egg has none
      h.style = { person: out, level: opts.level ?? 0, headLevel: headL };
      return h;
    },
  };
  return out;
}
// a CREW8 person (or any bundle variant) with castHero's apply baked in: the record every style starts from
export function personFrom(data, variant, { apply = null, height = null, label = null } = {}) { const P = bakeRest(readPerson(data, variant), apply); floor(P, topo(P)); P.height = height; P.label = label || variant; P.kin = kinOf(P, P.pos, { scale: (height || P.bindH) / P.bindH }); return P; }
