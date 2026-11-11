// MOTION c1 / CLOTH IN MOTION (HUMAN c8 round 5, 3 Oct): the dressed person's garments, hair and face through a clip, baked per clip in
// node, played in the page from a small cache. NEW FILE, opt-in: nothing imports it but the MOTION labs and bake tools.
//
// The garments of a v3 / v4 bake are skinned meshes (CARRY / CLOTH4: sewn in the A-pose, carried into the stance, their weights from the
// body). Under motion, linear skinning alone moves them with the bones. This module adds, per clip, two cached layers on top of it:
//   1. SECONDARY (a per-vertex spring layer, not a cloth solve): every garment vertex with freedom f > 0 lags its skinned target as a damped
//      spring driven by that target's own acceleration (d'' = -w^2 d - 2 zeta w d' - f a_skinned), capped; f is 0 where the garment is held
//      (waistband, seat, collar and yoke, the cuff at the wrist, the tucked tail) and rises toward free cloth (the trouser legs below the knee
//      to the hem, the sleeve between elbow and cuff a little, the shirt's back blousing a little). Neighbours share the field (a few passes
//      of smoothing over the mesh's edges), so the cloth moves as cloth, not as vertices.
//   2. CONTACT: after the secondary offset, each garment vertex is kept at least at its REST clearance from the posed body (its signed
//      distance along the body's normal in the bake's own stance, floored at 2 mm), pushed out along that normal when the motion takes it
//      deeper (elbow, knee, armpit, waist); construction parts (bands, cuffs, buttons) are pushed with their garment.
// Both are written as BIND-SPACE offsets (the inverse of each vertex's blended skin matrix), so the page adds them to the bind positions
// and three.js skins the result: no cloth is solved in the page. Rulers per frame (measure()): skin through cloth at the elbows, knees,
// armpits and waist (drawn body vertices outside the garment that covers them), cloth inside the body near drawn skin, and the tuck.
//
//   bake side (node):  const S = skinState(P)                    // posed body and parts per frame (CPU skinning, three's own formula)
//                      const C = new ClothMotion(P, opts); C.start(); per frame: pose the hero, C.step(dt) -> { offsets, measure }
//                      encodeTrack(...) / decodeTrack(buf)      // the cache (see the format below)
//   page side:         const pl = new ClothPlayer(P, track); pl.apply(frameFloat)   // writes the bind positions of the parts it carries
import * as THREE from 'three';
import { FABRICS } from '../cloth/fabrics.js';
import { SETTLE9 } from '../cloth/cloth9/settle9.js';   // (the garment solver's own contact gap: the cloth stands off the skin by what it was solved to stand off by)

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const meanY = P => { let y = 0; for (let i = 1; i < P.length; i += 3) y += P[i]; return y / (P.length / 3); };
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- CPU skinning (three's skinning_vertex chunk, per vertex)
// out[i] = M_mesh . bindInv . sum_k w_k B_k . bind . p   (B_k = skeleton.boneMatrices[k]); also the 3x3 linear part per vertex (A) when asked
export function skinMesh(m, out = null, { A = null, src = null } = {}) {
  const g = m.geometry, P = src || g.attributes.position.array, SI = g.attributes.skinIndex.array, SW = g.attributes.skinWeight.array, n = P.length / 3;
  m.updateMatrixWorld(true); m.skeleton.update();
  const BM = m.skeleton.boneMatrices, b = m.bindMatrix.elements, bi = m.bindMatrixInverse.elements, mw = m.matrixWorld.elements;
  // pre-multiply: W_k = M_mesh . bindInv . B_k . bind (one 4x4 per bone), then blend per vertex
  const nb = BM.length / 16, W = new Float64Array(nb * 16), T1 = new THREE.Matrix4(), T2 = new THREE.Matrix4(), Bk = new THREE.Matrix4(), mm = new THREE.Matrix4().fromArray(mw), bim = new THREE.Matrix4().fromArray(bi), bm = new THREE.Matrix4().fromArray(b);
  T1.multiplyMatrices(mm, bim);
  for (let k = 0; k < nb; k++) { Bk.fromArray(BM, k * 16); T2.multiplyMatrices(T1, Bk).multiply(bm); W.set(T2.elements, k * 16); }
  out = out || new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; let ox = 0, oy = 0, oz = 0, a0 = 0, a1 = 0, a2 = 0, a3 = 0, a4 = 0, a5 = 0, a6 = 0, a7 = 0, a8 = 0;
    for (let j = 0; j < 4; j++) { const w = SW[i * 4 + j]; if (!w) continue; const e = SI[i * 4 + j] * 16;
      ox += w * (W[e] * x + W[e + 4] * y + W[e + 8] * z + W[e + 12]); oy += w * (W[e + 1] * x + W[e + 5] * y + W[e + 9] * z + W[e + 13]); oz += w * (W[e + 2] * x + W[e + 6] * y + W[e + 10] * z + W[e + 14]);
      if (A) { a0 += w * W[e]; a1 += w * W[e + 1]; a2 += w * W[e + 2]; a3 += w * W[e + 4]; a4 += w * W[e + 5]; a5 += w * W[e + 6]; a6 += w * W[e + 8]; a7 += w * W[e + 9]; a8 += w * W[e + 10]; } }
    out[i * 3] = ox; out[i * 3 + 1] = oy; out[i * 3 + 2] = oz;
    if (A) { const o = i * 9; A[o] = a0; A[o + 1] = a1; A[o + 2] = a2; A[o + 3] = a3; A[o + 4] = a4; A[o + 5] = a5; A[o + 6] = a6; A[o + 7] = a7; A[o + 8] = a8; }
  }
  return out;
}
// d_bind = A^-1 d_world (A column-major 3x3 as stored above)
export function invApply(A, o, dx, dy, dz, out, oi) {
  const a = A[o], b = A[o + 3], c = A[o + 6], d = A[o + 1], e = A[o + 4], f = A[o + 7], g = A[o + 2], h = A[o + 5], k = A[o + 8];
  const det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g); if (Math.abs(det) < 1e-12) { out[oi] = 0; out[oi + 1] = 0; out[oi + 2] = 0; return; }
  const id = 1 / det;
  out[oi] = ((e * k - f * h) * dx + (c * h - b * k) * dy + (b * f - c * e) * dz) * id;
  out[oi + 1] = ((f * g - d * k) * dx + (a * k - c * g) * dy + (c * d - a * f) * dz) * id;
  out[oi + 2] = ((d * h - e * g) * dx + (b * g - a * h) * dy + (a * e - b * d) * dz) * id;
}
// vertex normals of a posed triangle list (only the triangles given: a culled body keeps its full index elsewhere)
export function normalsOf(X, I, out = null) {
  const n = X.length / 3; out = out || new Float32Array(n * 3); out.fill(0);
  for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2], vx = X[c] - X[a], vy = X[c + 1] - X[a + 1], vz = X[c + 2] - X[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const q of [a, b, c]) { out[q] += nx; out[q + 1] += ny; out[q + 2] += nz; } }
  for (let i = 0; i < n; i++) { const l = Math.hypot(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]) || 1; out[i * 3] /= l; out[i * 3 + 1] /= l; out[i * 3 + 2] /= l; }
  return out;
}
// a uniform grid over points (cell metres): near(x, y, z, r) -> indices within r
export class Grid {
  constructor(X, cell = 0.02, mask = null) { this.X = X; this.c = cell; this.M = new Map(); const n = X.length / 3;
    for (let i = 0; i < n; i++) { if (mask && !mask[i]) continue; const k = this.key(X[i * 3], X[i * 3 + 1], X[i * 3 + 2]); let L = this.M.get(k); if (!L) this.M.set(k, L = []); L.push(i); } }
  key(x, y, z) { return ((Math.floor(x / this.c) + 512) * 1024 + (Math.floor(y / this.c) + 512)) * 1024 + (Math.floor(z / this.c) + 512); }
  nearest(x, y, z, r = 0.03) { const c = this.c, k = Math.ceil(r / c), X = this.X; let best = -1, bd = r * r;
    const ix = Math.floor(x / c), iy = Math.floor(y / c), iz = Math.floor(z / c);
    for (let a = -k; a <= k; a++) for (let b = -k; b <= k; b++) for (let d = -k; d <= k; d++) { const L = this.M.get(((ix + a + 512) * 1024 + (iy + b + 512)) * 1024 + (iz + d + 512)); if (!L) continue;
      for (const i of L) { const dx = X[i * 3] - x, dy = X[i * 3 + 1] - y, dz = X[i * 3 + 2] - z, q = dx * dx + dy * dy + dz * dz; if (q < bd) { bd = q; best = i; } } }
    return best; }
}

// ---------------------------------------------------------------- body regions by the hero's bones (for the rulers)
// a body vertex's region: the bone carrying most of its weight, and how near it is to the joint that names the region
export const REGIONS = { elbow: ['upperarm02', 'lowerarm01'], knee: ['upperleg02', 'lowerleg01'], armpit: ['upperarm01', 'clavicle', 'shoulder01', 'breast', 'spine02', 'spine03'], waist: ['spine05', 'spine04', 'pelvis', 'root', 'spine03'] };
function regionOfBody(h, bodyMesh, Xbind) {
  const SI = bodyMesh.geometry.attributes.skinIndex.array, SW = bodyMesh.geometry.attributes.skinWeight.array, n = SI.length / 4, R = new Uint8Array(n), nm = h.bones.map(B => B.name.replace(/\.(L|R)$/, ''));
  const joint = nmj => { const P = []; for (const s of ['L', 'R']) { const i = h.idx[`${nmj}.${s}`]; if (i != null) P.push(h.head0[i]); } return P; };
  const J = { elbow: joint('lowerarm01'), knee: joint('lowerleg01'), armpit: joint('upperarm01'), waist: [] };
  const sp = h.idx.spine04 != null ? h.head0[h.idx.spine04] : null; if (sp) J.waist.push(sp);
  const keys = Object.keys(REGIONS);
  for (let v = 0; v < n; v++) { let bi = SI[v * 4], bw = SW[v * 4]; for (let k = 1; k < 4; k++) if (SW[v * 4 + k] > bw) { bw = SW[v * 4 + k]; bi = SI[v * 4 + k]; }
    const bn = nm[bi]; for (let r = 0; r < keys.length; r++) { if (!REGIONS[keys[r]].some(p => bn.startsWith(p))) continue;
      const x = Xbind[v * 3], y = Xbind[v * 3 + 1], z = Xbind[v * 3 + 2];
      const near = keys[r] === 'waist' ? J.waist.some(p => Math.abs(y - p.y) < 0.09) : J[keys[r]].some(p => Math.hypot(x - p.x, y - p.y, z - p.z) < (keys[r] === 'armpit' ? 0.1 : 0.08));
      if (near) { R[v] = r + 1; break; } } }
  return { R, keys };
}

// the family of each vertex of a skinned geometry by its dominant bone (cloth: a hand-weighted cuff goes with its arm, a foot-weighted hem with its leg)
const FAM = [[/^(root|pelvis|spine0|breast|clavicle|neck01)/, 1], [/^(shoulder01|upperarm0\d|lowerarm0\d)\.L$/, 2], [/^(shoulder01|upperarm0\d|lowerarm0\d)\.R$/, 3], [/^(upperleg0\d|lowerleg0\d)\.L$/, 4], [/^(upperleg0\d|lowerleg0\d)\.R$/, 5]];
const FAMC = [[/^(wrist|finger|metacarpal)\S*\.L$/, 2], [/^(wrist|finger|metacarpal)\S*\.R$/, 3], [/^(foot|toe)\S*\.L$/, 4], [/^(foot|toe)\S*\.R$/, 5], [/^(neck|head|jaw)/, 1]];
export function famOf(h, g, cloth) { const SI = g.attributes.skinIndex.array, SW = g.attributes.skinWeight.array, n = SI.length / 4, F = new Uint8Array(n), nm = h.bones.map(B => B.name), byBone = nm.map(b => { for (const [re, f] of FAM) if (re.test(b)) return f; if (cloth) for (const [re, f] of FAMC) if (re.test(b)) return f; return 0; });
  for (let v = 0; v < n; v++) { let bi = SI[v * 4], bw = SW[v * 4]; for (let k = 1; k < 4; k++) if (SW[v * 4 + k] > bw) { bw = SW[v * 4 + k]; bi = SI[v * 4 + k]; } F[v] = byBone[bi]; }
  return F; }

// the anchor weight of each vertex of a skinned geometry: 1 where one bone owns it (skinning is exact there), 0 where the weight is split across a joint (smooth between 0.75 and 0.97 of the dominant weight)
export function anchorOf(g) { const SW = g.attributes.skinWeight.array, n = SW.length / 4, A = new Float32Array(n);
  for (let v = 0; v < n; v++) { let m = 0, t = 0; for (let k = 0; k < 4; k++) { m = Math.max(m, SW[v * 4 + k]); t += SW[v * 4 + k]; } m /= t || 1; A[v] = sstep(0.75, 0.97, m); }
  return A; }
// ---------------------------------------------------------------- freedom per garment vertex (0 held .. 1 free), from the BIND pose
// trousers: free below the knee, most at the hem (the leg swings in the trouser); shirt: the sleeve between elbow and cuff a little, the
// back above the waistband a little (the blousing), held at the yoke, collar, cuff and the tucked tail. Construction follows its garment.
export function freedomOf(h, part, { trouserHem = 0.3, sleeve = 0.15, blouse = 0.2 } = {}) {
  const P = part.geometry.attributes.position.array, n = P.length / 3, f = new Float32Array(n), k3 = part.userData.k3 || {}, nm = (k3.name || '').toLowerCase();
  const J = name => h.head0[h.idx[name]];
  const kneeY = (J('lowerleg01.L').y + J('lowerleg01.R').y) / 2, ankY = (J('foot.L').y + J('foot.R').y) / 2, waistY = J('spine04').y, hipY = (J('upperleg01.L').y + J('upperleg01.R').y) / 2;
  if (/trouser/.test(nm)) for (let i = 0; i < n; i++) { const y = P[i * 3 + 1]; f[i] = trouserHem * sstep(kneeY + 0.04, ankY + 0.06, y) * (y < hipY ? 1 : 0); }
  else if (/shirt/.test(nm)) for (let i = 0; i < n; i++) { const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], s = x > 0 ? 'L' : 'R';
    const S = J(`upperarm01.${s}`), E = J(`lowerarm01.${s}`), W = J(`wrist.${s}`);
    const out = Math.abs(x) - Math.abs(S.x) + 0.03;   // past the shoulder joint, outward: the sleeve (A-pose: the arm runs out and down)
    if (out > 0) { const ax = W.clone().sub(S), L = ax.length(), u = clamp(((x - S.x) * ax.x + (y - S.y) * ax.y + (z - S.z) * ax.z) / (L * L));
      const ue = S.distanceTo(E) / L; f[i] = sleeve * sstep(ue * 0.6, ue + 0.1, u) * (1 - sstep(0.86, 0.97, u)); }
    else f[i] = blouse * sstep(waistY - 0.02, waistY + 0.06, y) * (1 - sstep(waistY + 0.1, waistY + 0.2, y)) * (z < J('spine04').z ? 1 : 0.4); }
  return f;
}

// ---------------------------------------------------------------- the bake side
// P: a makePerson result (P.h, P.parts). opts: { hz (Hz), zeta, cap (m), smooth (passes), floor (rest clearance floor, m), tol, maxPush, sub,
//   contact, seamContact (default true: after the final weld, re-project each seam group against every member's family wall), secondary, relax,
//   stretch, stretchKnit, squeeze, squeezeK, warm }
export class ClothMotion {
  constructor(P, { hz = 3.5, zeta = 0.5, cap = 0.025, smooth = 3, floor = 0.002, tol = 0.0015, maxPush = 0.04, sub = 4, freedom = {}, contact = true, seamContact = true, secondary = true, relax = 16, stretch = 0.04, stretchKnit = 0.15, squeeze = 0.15, squeezeK = 0.5, warm = true } = {}) {
    Object.assign(this, { P, h: P.h, hz, zeta, cap, smooth, floor, tol, maxPush, sub, contact, seamContact, secondary, relax, stretch, stretchKnit, squeeze, squeezeK, warm });
    const h = P.h; this.body = h.body;
    // the parts this layer carries: garments and their construction (bands, cuffs, buttons); underwear rides under them by skinning only
    this.parts = P.parts.filter(m => ['garment', 'construction'].includes(m.userData.k3?.group));
    this.bodyI = this.body.geometry.index.array;                        // the DRAWN triangles (culled ones are out of the index)
    const nb = this.body.geometry.attributes.position.count; this.drawn = new Uint8Array(nb); for (const v of this.bodyI) this.drawn[v] = 1;
    this.reg = regionOfBody(h, this.body, this.body.geometry.attributes.position.array);
    // colliders by FAMILY (the dominant bone): 1 trunk (root, pelvis, spine, breasts, clavicles, neck01), 2 / 3 the left / right arm (shoulder,
    // upper and lower arm), 4 / 5 the left / right leg (upper and lower leg); hands, fingers, head and feet are none (a hand resting on the
    // trousers must not push them). A cloth vertex collides with (and covers, for the rulers) the body of its OWN family, from its own
    // skin weights (a sleeve with its arm, a trouser leg with its leg, the waist and the yoke with the trunk; a cuff weighted to the hand
    // goes with that arm, a hem over the boot with that leg)
    this.fam = famOf(h, this.body.geometry, false);
    const hipY = (h.head0[h.idx['upperleg01.L']].y + h.head0[h.idx['upperleg01.R']].y) / 2;
    // each part: rest arrays, freedom, edges (for the smoothing), the garment it belongs to (construction follows the nearest garment's field)
    this.st = this.parts.map(m => { const g = m.geometry, n = g.attributes.position.count, I = g.index.array;
      const E = new Map(); for (let t = 0; t < I.length; t += 3) for (const [a, b] of [[I[t], I[t + 1]], [I[t + 1], I[t + 2]], [I[t + 2], I[t]]]) { const k = a < b ? a * n + b : b * n + a; if (!E.has(k)) E.set(k, [Math.min(a, b), Math.max(a, b)]); }
      const ed = Int32Array.from([...E.values()].flat());
      return { m, n, X0: Float32Array.from(g.attributes.position.array), f: m.userData.k3.group === 'garment' && secondary ? freedomOf(h, m, freedom) : new Float32Array(n), ed,
        d: new Float32Array(n * 3), v: new Float32Array(n * 3), prevS: null, prevS2: null, rest: null, off: new Float32Array(n * 3), A: new Float32Array(n * 9), S: new Float32Array(n * 3),
        fam: famOf(h, g, true), aw: anchorOf(g), jN: new Int32Array(n).fill(-1), el0: null, gapC: SETTLE9.gap + ((FABRICS[m.userData.k3?.fabric] || {}).mm || 0.6) / 2000,
        smax: 1 + (/knit|rib|mesh/.test((FABRICS[m.userData.k3?.fabric] || {}).construction || '') ? stretchKnit : stretch) }; });   // (a knit gives 15 %, a woven 4 %: the strain limit is the fabric's)
    // construction parts: borrow the freedom of the nearest garment vertex (bind space) so a cuff or the hem band moves with its cloth
    const gar = this.st.filter(s => s.m.userData.k3.group === 'garment');
    for (const s of this.st) if (s.m.userData.k3.group === 'construction' && secondary) { const best = { d: 1e9 };
      for (const gs of gar) { const G = new Grid(gs.X0, 0.02); for (let i = 0; i < s.n; i++) { const j = G.nearest(s.X0[i * 3], s.X0[i * 3 + 1], s.X0[i * 3 + 2], 0.04); if (j >= 0) s.f[i] = Math.max(s.f[i], gs.f[j]); } } void best; }
    // SEAMS: a garment is drawn as separate panels whose seam vertices coincide in the bind (and so in the bake's stance); their skin weights
    // differ (a sleeve's armhole row rides the arm, the body's rides the trunk), so skinning alone opens the seam as the arm moves, and the
    // layers above would too. Each group of coincident vertices (0.1 mm, any carried part) is welded in the POSED frame every step
    this.weld = (() => { const M = new Map(); this.st.forEach((s, k) => { for (let i = 0; i < s.n; i++) { const key = `${Math.round(s.X0[i * 3] * 1e4)},${Math.round(s.X0[i * 3 + 1] * 1e4)},${Math.round(s.X0[i * 3 + 2] * 1e4)}`; let L = M.get(key); if (!L) M.set(key, L = []); L.push(k, i); } });
      return [...M.values()].filter(L => L.length > 2); })();
  }
  // posed body (world positions + normals of every vertex; normals from the FULL triangle list when the body keeps one, else the drawn one)
  // (normals: the bind normals through each vertex's blended skin matrix, so the culled, undrawn body under the cloth has them too)
  _body() { const g = this.body.geometry, n = g.attributes.position.count; this._bA ||= new Float32Array(n * 9);
    const X = skinMesh(this.body, this._bx, { A: this._bA }); this._bx = X; const N0 = g.attributes.normal.array, A = this._bA, N = this._bn ||= new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const o = i * 9, x = N0[i * 3], y = N0[i * 3 + 1], z = N0[i * 3 + 2], nx = A[o] * x + A[o + 3] * y + A[o + 6] * z, ny = A[o + 1] * x + A[o + 4] * y + A[o + 7] * z, nz = A[o + 2] * x + A[o + 5] * y + A[o + 8] * z, l = Math.hypot(nx, ny, nz) || 1;
      N[i * 3] = nx / l; N[i * 3 + 1] = ny / l; N[i * 3 + 2] = nz / l; }
    this._kp = null; this._grid = new Grid(X, 0.02); this._gF = [null, 1, 2, 3, 4, 5].map(f => f && new Grid(X, 0.02, this.fam.map(x => x === f ? 1 : 0))); return X; }
  // call once with the hero in the bake's own stance (frame 0 of a clip that starts there, or the stance itself): the rest clearances
  rest() { const X = this._body(), N = this._bn;
    for (const s of this.st) { const S = skinMesh(s.m, s.S); s.rest = new Float32Array(s.n); s.restB = new Int32Array(s.n);
      for (let i = 0; i < s.n; i++) { const G = this._gF[s.fam[i]]; if (!G) { s.restB[i] = -1; s.rest[i] = 1; continue; } const j = G.nearest(S[i * 3], S[i * 3 + 1], S[i * 3 + 2], 0.06); s.restB[i] = j; s.rest[i] = j < 0 ? 1 : (S[i * 3] - X[j * 3]) * N[j * 3] + (S[i * 3 + 1] - X[j * 3 + 1]) * N[j * 3 + 1] + (S[i * 3 + 2] - X[j * 3 + 2]) * N[j * 3 + 2]; } }
    for (const s of this.st) { s.S = skinMesh(s.m, s.S, { A: s.A }); const ed = s.ed, S = s.S; s.el0 = new Float32Array(ed.length / 2);   // (the garment's edge lengths AT THE STANCE: the cloth as it sits on the body it is worn on; the strain limiter's rest lengths)
      for (let e = 0; e < ed.length; e += 2) { const a = ed[e] * 3, b = ed[e + 1] * 3; s.el0[e >> 1] = Math.hypot(S[a] - S[b], S[a + 1] - S[b + 1], S[a + 2] - S[b + 2]); }
      s.emax = new Float32Array(s.n); for (let e = 0; e < ed.length; e += 2) { const l = s.el0[e >> 1]; if (l > s.emax[ed[e]]) s.emax[ed[e]] = l; if (l > s.emax[ed[e + 1]]) s.emax[ed[e + 1]] = l; } }   // (and the longest edge at each vertex: the chord that can cut a convex bump of the body between two vertices)
    const rf = this.measure({ zero: true, flags: true }); this._restF = rf.flags; this.coveredRest = rf.covered; this._t = 0; return this; }
  // one frame (the hero already posed for it): advance the springs by dt, push out of the body, return the bind offsets and the rulers
  step(dt, { first = false, measure = true } = {}) {
    const X = this._body(), N = this._bn, w = 2 * Math.PI * this.hz, z = this.zeta, cap = this.cap, rep = { push: 0, pushed: 0, maxPushMm: 0, maxSecMm: 0 };
    for (const s of this.st) {
      const S = skinMesh(s.m, s.S, { A: s.A }), n = s.n, d = s.d, v = s.v;
      // secondary: the skinned target's acceleration from the last two frames drives the lag (first frame: at rest)
      if (this.secondary && s.prevS && s.prevS2 && !first) { const h2 = dt / this.sub, ax = new Float32Array(n * 3);
        for (let i = 0; i < n * 3; i++) ax[i] = (S[i] - 2 * s.prevS[i] + s.prevS2[i]) / (dt * dt);
        for (let k = 0; k < this.sub; k++) for (let i = 0; i < n; i++) { const fi = s.f[i]; if (!fi) continue;
          for (let c = 0; c < 3; c++) { const q = i * 3 + c; v[q] += h2 * (-w * w * d[q] - 2 * z * w * v[q] - fi * ax[q]); d[q] += h2 * v[q]; } }
        // the field as cloth: smooth d over the mesh edges (weighted by freedom so held cloth stays held), then cap
        for (let p = 0; p < this.smooth; p++) { const acc = new Float32Array(n * 3), cnt = new Float32Array(n);
          for (let e = 0; e < s.ed.length; e += 2) { const a = s.ed[e], b = s.ed[e + 1]; for (let c = 0; c < 3; c++) { acc[a * 3 + c] += d[b * 3 + c]; acc[b * 3 + c] += d[a * 3 + c]; } cnt[a]++; cnt[b]++; }
          for (let i = 0; i < n; i++) { if (!cnt[i]) continue; const fi = s.f[i]; for (let c = 0; c < 3; c++) d[i * 3 + c] = (0.5 * d[i * 3 + c] + 0.5 * acc[i * 3 + c] / cnt[i]) * (fi > 0 ? 1 : 0); } }
        for (let i = 0; i < n; i++) { const l = Math.hypot(d[i * 3], d[i * 3 + 1], d[i * 3 + 2]), m = cap * s.f[i]; if (l > m && l > 0) { const k = m / l; for (let c = 0; c < 3; c++) { d[i * 3 + c] *= k; v[i * 3 + c] *= 0.5; } } rep.maxSecMm = Math.max(rep.maxSecMm, Math.min(l, m) * 1000); } }
      s.prevS2 = s.prevS ? s.prevS : Float32Array.from(S); s.prevS = Float32Array.from(S);
      // contact: never deeper into the posed body than at rest (floored at `floor`), along the body's normal at the nearest body vertex
      const off = s.off, wo = s.wo ||= new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { let dx = d[i * 3], dy = d[i * 3 + 1], dz = d[i * 3 + 2];
        const G = this._gF[s.fam[i]]; s.jN[i] = -1;
        if (this.contact && s.rest && G) { const px = S[i * 3] + dx, py = S[i * 3 + 1] + dy, pz = S[i * 3 + 2] + dz, j = G.nearest(px, py, pz, 0.05); s.jN[i] = j;
          // (a tolerance: within `tol` of its rest clearance the cloth is left where skinning puts it; deeper, it comes back to rest - tol)
          if (j >= 0) { const sd = (px - X[j * 3]) * N[j * 3] + (py - X[j * 3 + 1]) * N[j * 3 + 1] + (pz - X[j * 3 + 2]) * N[j * 3 + 2], want = Math.min(this.floor, s.rest[i]) - this.tol;
            if (sd < want && s.rest[i] > -0.01) { const pu = Math.min(this.maxPush, want - sd); dx += pu * N[j * 3]; dy += pu * N[j * 3 + 1]; dz += pu * N[j * 3 + 2]; rep.push += pu; rep.pushed++; rep.maxPushMm = Math.max(rep.maxPushMm, pu * 1000); } } }
        wo[i * 3] = dx; wo[i * 3 + 1] = dy; wo[i * 3 + 2] = dz; }
    }
    if (this.relax > 0 && this.contact) this._relax(rep, this.warm && !first);
    // weld the seams (the coincident vertices meet at the mean of their posed positions), then into the bind frame
    let wmax = 0;
    for (const L of this.weld) { let x = 0, y = 0, z = 0; const m = L.length / 2;
      for (let a = 0; a < L.length; a += 2) { const s = this.st[L[a]], i = L[a + 1]; x += s.S[i * 3] + s.wo[i * 3]; y += s.S[i * 3 + 1] + s.wo[i * 3 + 1]; z += s.S[i * 3 + 2] + s.wo[i * 3 + 2]; }
      x /= m; y /= m; z /= m;
      for (let a = 0; a < L.length; a += 2) { const s = this.st[L[a]], i = L[a + 1], nx = x - s.S[i * 3], ny = y - s.S[i * 3 + 1], nz = z - s.S[i * 3 + 2]; wmax = Math.max(wmax, Math.hypot(nx - s.wo[i * 3], ny - s.wo[i * 3 + 1], nz - s.wo[i * 3 + 2])); s.wo[i * 3] = nx; s.wo[i * 3 + 1] = ny; s.wo[i * 3 + 2] = nz; } }
    rep.weldMaxMm = wmax * 1000;
    if (this.contact && this.seamContact) this._weldContact(rep);
    for (const s of this.st) { for (let i = 0; i < s.n; i++) invApply(s.A, i * 9, s.wo[i * 3], s.wo[i * 3 + 1], s.wo[i * 3 + 2], s.off, i * 3); s.has = true; }   // (s.has: this part has a previous frame's relaxed cloth to start from; a restored or fresh ClothMotion starts cold)
    rep.pushMeanMm = rep.pushed ? +(rep.push / rep.pushed * 1000).toFixed(2) : 0; delete rep.push;
    if (measure) { rep.poke = this.measure(); if (measure === 'both') rep.base = this.measure({ zero: true }); }
    return rep;
  }
  // the body's curvature at body vertex j (1/m, >= 0): the largest normal curvature among its neighbours within ~2.5 cm, (N_k - N_j) . (X_k - X_j) / |X_k - X_j|^2 (the shape operator along each chord). Cached per frame.
  _kappa(j) { const nb = this._bn.length / 3, K = this._kp ||= new Float32Array(nb).fill(-1); if (K[j] >= 0) return K[j];
    const X = this._bx, N = this._bn, G = this._grid, c = G.c, x = X[j * 3], y = X[j * 3 + 1], z = X[j * 3 + 2], ix = Math.floor(x / c), iy = Math.floor(y / c), iz = Math.floor(z / c); let kmax = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) { const L = G.M.get(((ix + a + 512) * 1024 + (iy + b + 512)) * 1024 + (iz + d + 512)); if (!L) continue;
      for (const k of L) { if (k === j) continue; const dx = X[k * 3] - x, dy = X[k * 3 + 1] - y, dz = X[k * 3 + 2] - z, q = dx * dx + dy * dy + dz * dz; if (q < 9e-6 || q > 6.25e-4) continue;
        const kn = ((N[k * 3] - N[j * 3]) * dx + (N[k * 3 + 1] - N[j * 3 + 1]) * dy + (N[k * 3 + 2] - N[j * 3 + 2]) * dz) / q; if (kn > kmax) kmax = kn; } }
    return K[j] = Math.min(kmax, 120); }
  // the margin a vertex wall needs (m): the sagitta of the longest cloth chord at vertex i of part s across the body's curvature at its wall vertex j: cloth between two vertices cuts a convex bump (the elbow's point, the
  // knuckle of the shoulder) by e^2 kappa / 8, which a wall of vertices cannot see. Geometry, not a number (it was a 3 mm constant tuned on two persons' elbows until c5 it3); capped at 8 mm.
  _sag(s, i, j) { const e = s.emax[i]; return Math.min(0.008, this._kappa(j) * e * e / 8); }
  // THE CLOTH AS CLOTH (rev 2, c5 it2). Skinning is exact only where one bone owns a vertex; across a joint (the armhole row, the crook of the elbow) its blend collapses the cloth, and the contact pass above then pushed
  // single vertices out of the body by up to 4 cm with nothing to hold their neighbours: a 1 mm edge stretched 32x at the armpit, a 7 mm edge squeezed to 0.3 mm at the elbow (node, L03, the raised arm): shards and
  // dark gashes. So after the contact pass the garments are RELAXED as cloth, in the same frame: every vertex whose skin weight sits on one bone is a SOFT anchor (skinning is right there: it is
  // drawn back half way each sweep and moves a seventh as easily as a free vertex), every blended vertex is free; the cloth's edges may not stretch more than `stretch` (4 % for a woven under body loads, `stretchKnit` 15 % for a knit: the part's fabric says which; Provot's strain limiting) and are pushed back out of a squeeze
  // beyond `squeeze` (15 %, at `squeezeK` of the correction: cloth compresses into folds, it does not collapse); coincident seam vertices stay together; and the body is a one-sided wall (the contact rule again, on the
  // nearest body vertex found by the contact pass). The rest lengths are the garment's own edges at the stance. Gauss-Seidel, `relax` sweeps.
  // REV 3 (c5 it3): (a) the sweeps START from the previous frame's relaxed cloth carried by this frame's skinning (`warm`: the bind-space offset of the last step through this frame's blended skin matrices), not from skinning's collapse:
  // the sweeps of a whole clip add up, where a frame's 16 cannot move cloth centimetres across a dense armhole, and the cloth no longer pops between frames (node, L03's raised arm, hold 1.4-3.0 s: edges outside 0.4x-1.5x 494 -> 317,
  // the worst stretch 9.5x -> 5.0x, at the same cost); a fresh or restored ClothMotion (motion_snap.js) starts cold. The result is no longer a pure function of the pose: frames are stepped in order, as the bake does. (b) the wall is where the GARMENT
  // SOLVER stood the cloth off the skin (settle9's contact gap + half the fabric's thickness), never deeper than the stance had it, plus the SAGITTA of the vertex's longest chord across the body's curvature there (`_sag`), not a 3 mm constant.
  _relax(rep, warm = false) {
    const X = this._bx, N = this._bn, K = this.relax, cmin = 1 - this.squeeze; let mv = 0;
    for (const s of this.st) { const n3 = s.n * 3, S = s.S, wo = s.wo, P = s.pw ||= new Float32Array(n3), P0 = s.p0 ||= new Float32Array(n3); for (let i = 0; i < n3; i++) P0[i] = S[i] + wo[i]; s.pa0 = false;
      // the start of the sweeps: where skinning and the contact pass put the cloth (cold), or, in a clip, the PREVIOUS frame's relaxed cloth carried by this frame's skinning (warm: its bind-space offset through this frame's blended skin matrix): the cloth keeps
      // the shape it was relaxed into instead of starting each frame from skinning's collapse, so the sweeps of the whole clip add up (a frame's few sweeps cannot move cloth centimetres across a dense armhole) and the cloth does not pop between frames
      if (warm && s.has) { const A = s.A, o = s.off; for (let i = 0; i < s.n; i++) { const q = i * 9, k = i * 3, dx = o[k], dy = o[k + 1], dz = o[k + 2]; P[k] = S[k] + A[q] * dx + A[q + 3] * dy + A[q + 6] * dz; P[k + 1] = S[k + 1] + A[q + 1] * dx + A[q + 4] * dy + A[q + 7] * dz; P[k + 2] = S[k + 2] + A[q + 2] * dx + A[q + 5] * dy + A[q + 8] * dz; } }
      else P.set(P0); }
    for (let it = 0; it < K; it++) {
      // (1) the anchors: skinning is exact where one bone owns the vertex, so each is drawn back toward where skinning and the contact pass put it, but only SOFTLY (half way per sweep): a seam between two anchored
      // vertices that skinning has pulled apart (the armhole, where the sleeve's bone and the trunk's meet) must be able to give; the cloth's own lengths then win over the bones' weights
      for (const s of this.st) { const P = s.pw, P0 = s.p0, aw = s.aw; for (let i = 0; i < s.n; i++) { const w = aw[i] * 0.5, q = i * 3; if (w > 0) { P[q] += (P0[q] - P[q]) * w; P[q + 1] += (P0[q + 1] - P[q + 1]) * w; P[q + 2] += (P0[q + 2] - P[q + 2]) * w; } } }
      // (2) the seams: coincident vertices of different panels meet at the mean
      for (const L of this.weld) { let x = 0, y = 0, z = 0; const m = L.length / 2; for (let a = 0; a < L.length; a += 2) { const P = this.st[L[a]].pw, i = L[a + 1] * 3; x += P[i]; y += P[i + 1]; z += P[i + 2]; } x /= m; y /= m; z /= m;
        for (let a = 0; a < L.length; a += 2) { const P = this.st[L[a]].pw, i = L[a + 1] * 3; P[i] = x; P[i + 1] = y; P[i + 2] = z; } }
      // (3) the cloth's lengths (strain limit, soft squeeze limit): an anchored vertex moves a seventh as easily as a free one
      for (const s of this.st) { const P = s.pw, ed = s.ed, E0 = s.el0, aw = s.aw, smax = s.smax; if (!E0) continue;
        for (let e = 0; e < ed.length; e += 2) { const l0 = E0[e >> 1]; if (!(l0 > 2e-5)) continue; const ia = ed[e], ib = ed[e + 1], a = ia * 3, b = ib * 3, dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2], L = Math.hypot(dx, dy, dz); if (L < 1e-9) continue;
          let tgt, k = 1; if (L > l0 * smax) tgt = l0 * smax; else if (L < l0 * cmin) { tgt = l0 * cmin; k = this.squeezeK; } else continue;
          const wa = 0.15 + 0.85 * (1 - aw[ia]), wb = 0.15 + 0.85 * (1 - aw[ib]), sw = wa + wb, c = (L - tgt) / L * k, ca = c * wa / sw, cb = c * wb / sw;
          P[a] += dx * ca; P[a + 1] += dy * ca; P[a + 2] += dz * ca; P[b] -= dx * cb; P[b + 1] -= dy * cb; P[b + 2] -= dz * cb; } }
      // (4) the body is a one-sided wall (the contact rule: never deeper into the posed body than at rest, floored at `floor`, minus the tolerance). The wall is the NEAREST body vertex's plane, and the
      // relaxation moves cloth by centimetres, so every fourth sweep each vertex that has moved more than 4 mm since its wall was found looks for its nearest body vertex again
      if (it % 4 === 3 || it === 0) for (const s of this.st) { const P = s.pw, jN = s.jN, PA = s.pa ||= new Float32Array(s.n * 3), fam = s.fam; if (!s.pa0) { PA.set(s.p0); s.pa0 = true; }
        for (let i = 0; i < s.n; i++) { const q = i * 3, G = this._gF[fam[i]]; if (!G || jN[i] < 0) continue; if (Math.hypot(P[q] - PA[q], P[q + 1] - PA[q + 1], P[q + 2] - PA[q + 2]) < 0.004) continue;
          const j = G.nearest(P[q], P[q + 1], P[q + 2], 0.05); PA[q] = P[q]; PA[q + 1] = P[q + 1]; PA[q + 2] = P[q + 2]; if (j >= 0) jN[i] = j; } }
      for (const s of this.st) { const P = s.pw, jN = s.jN, rest = s.rest; if (!rest) continue;
        for (let i = 0; i < s.n; i++) { const j = jN[i]; if (j < 0) continue; const q = i * 3;
          const sd = (P[q] - X[j * 3]) * N[j * 3] + (P[q + 1] - X[j * 3 + 1]) * N[j * 3 + 1] + (P[q + 2] - X[j * 3 + 2]) * N[j * 3 + 2], want = Math.min(rest[i], s.gapC) + this._sag(s, i, j);   // (the relaxation's wall: where the garment solver stood the cloth off the skin (its contact gap + half the fabric's thickness), never deeper than the stance had it, plus the sagitta: see _sag)
          if (sd < want && rest[i] > -0.01) { const pu = Math.min(this.maxPush, want - sd); P[q] += pu * N[j * 3]; P[q + 1] += pu * N[j * 3 + 1]; P[q + 2] += pu * N[j * 3 + 2]; } } } }
    for (const s of this.st) { const P = s.pw, S = s.S, wo = s.wo, n3 = s.n * 3; for (let i = 0; i < n3; i++) { wo[i] = P[i] - S[i]; } for (let i = 0; i < s.n; i++) { const d = Math.hypot(P[i * 3] - s.p0[i * 3], P[i * 3 + 1] - s.p0[i * 3 + 1], P[i * 3 + 2] - s.p0[i * 3 + 2]); if (d > mv) mv = d; } }
    rep.relaxMaxMm = +(mv * 1000).toFixed(1);
  }
  // (issue #87 S2) THE SEAM AS ONE CONTACT POINT. The final weld above averages the panels' offsets AFTER the wall pass; where the panels meet
  // different body families (an armhole row: the sleeve collides with the arm, the body panel with the trunk) that mean can put the welded seam
  // back inside one of the two walls. In the deterministic two-family fixture this left the seam 4.25 mm inside the trunk (weldMaxMm 4.75).
  // Project each welded group against every member's own family wall AS A GROUP, with the same target the relaxation wall uses (the stance
  // clearance capped by the garment solver's gap + half the fabric's thickness, plus the sagitta). The group moves together, so the seam stays
  // sewn; a panel that is already outside is untouched. Seams are re-projected every frame because the final weld runs every frame.
  _weldContact(rep) {
    const X = this._bx, N = this._bn, st = this.st; let mmax = 0, before = 0, pushed = 0, passes = 0;
    for (const L of this.weld) { const m = L.length / 2; let px = 0, py = 0, pz = 0;
      for (let a = 0; a < L.length; a += 2) { const s = st[L[a]], i = L[a + 1]; px += s.S[i * 3] + s.wo[i * 3]; py += s.S[i * 3 + 1] + s.wo[i * 3 + 1]; pz += s.S[i * 3 + 2] + s.wo[i * 3 + 2]; }
      px /= m; py /= m; pz /= m; const sx = px, sy = py, sz = pz; let moved = 0; const lim = this.maxPush;   // the same per-frame cap the contact pass uses; the warm start carries the rest to the next frame
      // the weld's own violation, before the group projection (the A/B number the comparison records)
      for (let a = 0; a < L.length; a += 2) { const s = st[L[a]], i = L[a + 1]; if (!s.rest || s.rest[i] <= -0.01) continue;
        const G = this._gF[s.fam[i]]; if (!G) continue; const j = G.nearest(px, py, pz, 0.05); if (j < 0) continue;
        const sd = (px - X[j * 3]) * N[j * 3] + (py - X[j * 3 + 1]) * N[j * 3 + 1] + (pz - X[j * 3 + 2]) * N[j * 3 + 2], pen = Math.min(s.rest[i], s.gapC) + this._sag(s, i, j) - sd;
        if (pen > before) before = pen; }
      // Gauss-Seidel over the members, a few passes: a push out of one family's wall can expose the seam to the other member's wall.
      for (let pass = 0; pass < 4; pass++) { let any = 0;
        for (let a = 0; a < L.length; a += 2) { const s = st[L[a]], i = L[a + 1]; if (!s.rest || s.rest[i] <= -0.01) continue;
          const G = this._gF[s.fam[i]]; if (!G) continue; const j = G.nearest(px, py, pz, 0.05); if (j < 0) continue; s.jN[i] = j;
          const sd = (px - X[j * 3]) * N[j * 3] + (py - X[j * 3 + 1]) * N[j * 3 + 1] + (pz - X[j * 3 + 2]) * N[j * 3 + 2], want = Math.min(s.rest[i], s.gapC) + this._sag(s, i, j);
          if (sd >= want - 1e-7) continue; let pu = Math.min(this.maxPush, want - sd);   // 1e-7 m: below float32 paint resolution, keeps the passes from chasing their own rounding
          if (moved + pu > lim) pu = lim - moved; if (!(pu > 1e-9)) continue;
          px += pu * N[j * 3]; py += pu * N[j * 3 + 1]; pz += pu * N[j * 3 + 2]; moved += pu; pushed++; any++; }
        passes++; if (!any) break; }
      const disp = Math.hypot(px - sx, py - sy, pz - sz);
      if (disp > 1e-9) { for (let a = 0; a < L.length; a += 2) { const s = st[L[a]], i = L[a + 1]; s.wo[i * 3] = px - s.S[i * 3]; s.wo[i * 3 + 1] = py - s.S[i * 3 + 1]; s.wo[i * 3 + 2] = pz - s.S[i * 3 + 2]; } if (disp > mmax) mmax = disp; } }
    rep.seamPushed = pushed; rep.seamPasses = passes; rep.seamMoveMm = +(mmax * 1000).toFixed(2); rep.seamDeficitMm = +(before * 1000).toFixed(2);
  }
  _domBone(v) { const g = this.body.geometry, SI = g.attributes.skinIndex.array, SW = g.attributes.skinWeight.array; let bi = SI[v * 4], bw = SW[v * 4]; for (let k = 1; k < 4; k++) if (SW[v * 4 + k] > bw) { bw = SW[v * 4 + k]; bi = SI[v * 4 + k]; } return this.h.bones[bi].name; }
  // write the offsets into the parts' bind positions (so a render or a ruler sees the corrected cloth); off: false restores the rest
  write(on = true) { for (const s of this.st) { const A = s.m.geometry.attributes.position.array; for (let i = 0; i < s.n * 3; i++) A[i] = s.X0[i] + (on ? s.off[i] : 0); s.m.geometry.attributes.position.needsUpdate = true; } }
  // RULERS on the posed frame (offsets applied): per region, drawn body vertices outside the garment covering them (skin through cloth),
  // and garment vertices inside the body by > 2 mm whose nearest body vertex is DRAWN (cloth sunk into visible skin). A body vertex is
  // 'covered' when a garment vertex lies within 2.5 cm of it along its normal line (lateral < 1.2 cm); it pokes when that cloth is BELOW it.
  measure({ zero = false, flags = false } = {}) {
    const X = this._bx, RF = flags ? null : this._restF, FS = flags ? new Uint8Array(this.drawn.length) : null, FC = [], N = this._bn, R = this.reg.R, keys = this.reg.keys, out = Object.fromEntries(keys.map(k => [k, { skin: 0, sunk: 0 }])); out.all = { skin: 0, sunk: 0, covered: 0 };
    // the posed cloth with this frame's offsets, by family; a body vertex is checked against the cloth of its own family
    const sets = [[], [], [], [], [], []]; for (const s of this.st) { const S = s.S; for (let i = 0; i < s.n; i++) { const f = s.fam[i]; if (!f) continue; // S + A . off
        const a = s.A, q = i * 9, dx = zero ? 0 : s.off[i * 3], dy = zero ? 0 : s.off[i * 3 + 1], dz = zero ? 0 : s.off[i * 3 + 2];
        sets[f].push(S[i * 3] + a[q] * dx + a[q + 3] * dy + a[q + 6] * dz, S[i * 3 + 1] + a[q + 1] * dx + a[q + 4] * dy + a[q + 7] * dz, S[i * 3 + 2] + a[q + 2] * dx + a[q + 5] * dy + a[q + 8] * dz); } }
    const CXs = sets.map(L => Float32Array.from(L)), CGs = CXs.map(A => new Grid(A, 0.02));
    // skin through cloth: only DRAWN body vertices that a garment covered in the rest pose (cloth on or outside them along their normal,
    // within 2.5 cm, lateral < 1.2 cm: the cuff's wrist, the collar's neck, the hems' edges, the waist's edge, skin left drawn under loose cloth)
    const cov = flags ? (this._cov = new Uint8Array(this.drawn.length)) : this._cov;
    for (let v = 0; v < this.drawn.length; v++) { const f = this.fam[v]; if (!f || !this.drawn[v] || (!flags && !cov[v])) continue; const x = X[v * 3], y = X[v * 3 + 1], z = X[v * 3 + 2], nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2];
      const A = CXs[f], j = CGs[f].nearest(x, y, z, 0.025); if (j < 0) continue; const dx = A[j * 3] - x, dy = A[j * 3 + 1] - y, dz = A[j * 3 + 2] - z, along = dx * nx + dy * ny + dz * nz, lat = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - along * along));
      if (lat > 0.012) continue; if (flags) { if (along > -0.001) cov[v] = 1; continue; } out.all.covered++; if (along < -0.001) { out.all.skin++; if (R[v]) out[keys[R[v] - 1]].skin++; if (this.debug) { const b = this._domBone(v); (out.dbg ||= {})[b] = (out.dbg[b] || 0) + 1; } } }
    // cloth sunk into DRAWN skin (> 2 mm inside the body where the skin is drawn), each family against its own collider
    // and INSIDE: cloth more than 3 mm inside the posed body of its own family, drawn skin or not (the interpenetration the contact pass
    // undoes; under culled skin it does not show as skin, but as cloth folding through cloth and into the hollow body)
    for (const k of keys) out[k].inside = 0; out.all.inside = 0;
    for (let f = 1; f < 6; f++) { const A = CXs[f], BG = this._gF[f]; for (let j = 0; j < A.length / 3; j++) { const b = BG.nearest(A[j * 3], A[j * 3 + 1], A[j * 3 + 2], 0.03); if (b < 0) continue;
      const sd = (A[j * 3] - X[b * 3]) * N[b * 3] + (A[j * 3 + 1] - X[b * 3 + 1]) * N[b * 3 + 1] + (A[j * 3 + 2] - X[b * 3 + 2]) * N[b * 3 + 2];
      if (sd < -0.003) { const key = f * 1e7 + j; if (flags) (this._restIn ||= new Set()).add(key); else if (!this._restIn?.has(key)) { out.all.inside++; if (R[b]) out[keys[R[b] - 1]].inside++; } }
      if (!this.drawn[b]) continue; if (sd < -0.002) { const key = f * 1e7 + j; if (flags) FC.push(key); if (RF && RF.sunk.has(key)) continue; out.all.sunk++; if (R[b]) out[keys[R[b] - 1]].sunk++; } } }
    if (flags) { out.flags = { sunk: new Set(FC) }; out.covered = cov.reduce((a, b) => a + b, 0); }
    return out;
  }
}

// ---------------------------------------------------------------- the cache: one file per person per clip (.mot4)
// 'MOT4', u32 header length, JSON header { fps, nf, bones: [index...], parts: [{ name, n, active: count }], key (cloth keyframe step), chans },
// then: pose  nf x (bones x 4 int16 quaternion, root xyz int16 mm), group nf x (x, z mm int32, yaw int16 x 1e4);
//       chans nf x C float32 (eyes yaw / pitch, smile, blink ...: named in the header);
//       cloth per part: active indices (u16), then per KEYFRAME (every `key` frames) active x 3 int8 (bind offset, `q` m per unit)
export function encodeTrack(meta, frames, cloth) {
  const nf = frames.length, bones = meta.bones, nb = bones.length, chans = meta.chans || [], C = chans.length;
  const parts = (cloth?.parts || []).map(p => ({ name: p.name, n: p.n, active: p.active.length, q: p.q }));
  const hdr = new TextEncoder().encode(JSON.stringify({ ...meta, nf, parts, key: cloth?.key || 1, v: 1 }));
  const L = [];
  const pose = new Int16Array(nf * (nb * 4 + 3)); frames.forEach((f, i) => { let o = i * (nb * 4 + 3); for (const b of bones) { const q = f.q[b]; for (let k = 0; k < 4; k++) pose[o++] = Math.round(clamp(q[k], -1, 1) * 32767); } for (let k = 0; k < 3; k++) pose[o++] = Math.round(clamp(f.root[k], -32.7, 32.7) * 1000); });
  const grp = new Int32Array(nf * 3); frames.forEach((f, i) => { grp[i * 3] = Math.round((f.g?.[0] || 0) * 1000); grp[i * 3 + 1] = Math.round((f.g?.[1] || 0) * 1000); grp[i * 3 + 2] = Math.round((f.g?.[2] || 0) * 1e4); });
  const ch = new Float32Array(nf * C); frames.forEach((f, i) => chans.forEach((c, k) => { ch[i * C + k] = f.c?.[c] ?? 0; }));
  L.push(pose.buffer, grp.buffer, ch.buffer);
  for (const p of cloth?.parts || []) { const ai = Uint16Array.from(p.active); L.push(ai.buffer); if (ai.length % 2) L.push(new ArrayBuffer(2)); L.push(p.data.buffer); const pad = (4 - p.data.byteLength % 4) % 4; if (pad) L.push(new ArrayBuffer(pad)); }
  const hl = hdr.length, hp = (4 - (8 + hl) % 4) % 4, total = 8 + hl + hp + L.reduce((a, b) => a + b.byteLength, 0), buf = new Uint8Array(total), dv = new DataView(buf.buffer);
  buf.set([77, 79, 84, 52]); dv.setUint32(4, hl, true); buf.set(hdr, 8); let o = 8 + hl + hp; for (const b of L) { buf.set(new Uint8Array(b), o); o += b.byteLength; }
  return buf.buffer;
}
export function decodeTrack(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf); if (String.fromCharCode(...u8.subarray(0, 4)) !== 'MOT4') throw new Error('not a MOT4 track');
  const hl = dv.getUint32(4, true), H = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + hl))), nf = H.nf, nb = H.bones.length, C = (H.chans || []).length;
  let o = 8 + hl + (4 - (8 + hl) % 4) % 4;
  const pose = new Int16Array(buf.slice(o, o + nf * (nb * 4 + 3) * 2)); o += nf * (nb * 4 + 3) * 2;
  const grp = new Int32Array(buf.slice(o, o + nf * 12)); o += nf * 12;
  const ch = new Float32Array(buf.slice(o, o + nf * C * 4)); o += nf * C * 4;
  const nk = Math.floor((nf - 1) / H.key) + 1, parts = [];
  for (const p of H.parts) { const ai = new Uint16Array(buf.slice(o, o + p.active * 2)); o += p.active * 2; if (p.active % 2) o += 2; const n = nk * p.active * 3, data = new Int8Array(buf.slice(o, o + n)); o += n; o += (4 - n % 4) % 4; parts.push({ ...p, active: ai, data }); }
  return { H, nf, pose, grp, ch, parts, nk };
}

// ---------------------------------------------------------------- the page side: play a decoded track on a built person
export class TrackPlayer {
  constructor(P, T, { parts = null } = {}) {
    this.P = P; this.h = P.h; this.T = T; this.fps = T.H.fps || 30; this.duration = (T.nf - 1) / this.fps;
    this.bones = T.H.bones.map(i => this.h.bones[i]); this.root = this.h.bone('root');
    this.g0 = { p: this.h.group.position.clone(), yaw: this.h.group.rotation.y };
    // the cloth parts by name and order (the bake writes them in P.parts order among garments + construction)
    const ps = parts || P.parts.filter(m => ['garment', 'construction'].includes(m.userData.k3?.group));
    this.cloth = T.parts.map((p, k) => { const m = ps[k]; if (!m || m.geometry.attributes.position.count !== p.n) return null; return { m, p, X0: Float32Array.from(m.geometry.attributes.position.array) }; });
    this.qa = new THREE.Quaternion(); this.qb = new THREE.Quaternion();
  }
  chan(name, fr) { const C = this.T.H.chans || [], k = C.indexOf(name); if (k < 0) return 0; const i = Math.floor(fr), j = Math.min(this.T.nf - 1, i + 1), w = fr - i, n = C.length; return this.T.ch[i * n + k] * (1 - w) + this.T.ch[j * n + k] * w; }
  frameOf(t) { return clamp(t * this.fps, 0, this.T.nf - 1); }
  apply(t, { cloth = true, group = true } = {}) {
    const T = this.T, fr = this.frameOf(t), i = Math.floor(fr), j = Math.min(T.nf - 1, i + 1), w = fr - i, nb = this.bones.length, st = nb * 4 + 3, s = 1 / 32767;
    for (let b = 0; b < nb; b++) { const a = i * st + b * 4, c = j * st + b * 4; this.qa.set(T.pose[a] * s, T.pose[a + 1] * s, T.pose[a + 2] * s, T.pose[a + 3] * s).normalize(); this.qb.set(T.pose[c] * s, T.pose[c + 1] * s, T.pose[c + 2] * s, T.pose[c + 3] * s).normalize(); this.bones[b].quaternion.copy(this.qa).slerp(this.qb, w); }
    const ra = i * st + nb * 4, rb = j * st + nb * 4; this.root.position.set(((1 - w) * T.pose[ra] + w * T.pose[rb]) / 1000, ((1 - w) * T.pose[ra + 1] + w * T.pose[rb + 1]) / 1000, ((1 - w) * T.pose[ra + 2] + w * T.pose[rb + 2]) / 1000);
    if (T.H.still) T.H.still.forEach((q, b) => { if (q) this.h.bones[b].quaternion.set(q[0], q[1], q[2], q[3]); });
    // the breath's bone scales (life.js breathe): spine03 and spine02 from the channels, spine01 and the breasts counter-scaled
    const s3x = this.chan('s3x', fr) || 1, s3z = this.chan('s3z', fr) || 1, s2x = this.chan('s2x', fr) || 1, s2z = this.chan('s2z', fr) || 1, B3 = this.h.bone('spine03'), B2 = this.h.bone('spine02');
    B3.scale.set(s3x, 1, s3z); B2.scale.set(s2x, 1, s2z); const kx = s3x * s2x, kz = s3z * s2z; for (const n of ['spine01', 'breast.L', 'breast.R']) { const B = this.h.bone(n); if (B) B.scale.set(1 / kx, 1, 1 / kz); }
    if (group) { const G = T.grp, gx = ((1 - w) * G[i * 3] + w * G[j * 3]) / 1000, gz = ((1 - w) * G[i * 3 + 1] + w * G[j * 3 + 1]) / 1000, gy = ((1 - w) * G[i * 3 + 2] + w * G[j * 3 + 2]) / 1e4;
      const c = Math.cos(this.g0.yaw), sn = Math.sin(this.g0.yaw); this.h.group.position.set(this.g0.p.x + c * gx + sn * gz, this.g0.p.y, this.g0.p.z - sn * gx + c * gz); this.h.group.rotation.y = this.g0.yaw + gy; }
    if (cloth) { const K = T.H.key, kf = fr / K, ka = Math.min(T.nk - 1, Math.floor(kf)), kb = Math.min(T.nk - 1, ka + 1), wk = kf - ka;
      for (const c of this.cloth) { if (!c) continue; const A = c.m.geometry.attributes.position.array, act = c.p.active, na = act.length, D = c.p.data, q = c.p.q;
        A.set(c.X0); for (let a = 0; a < na; a++) { const v = act[a] * 3, o1 = (ka * na + a) * 3, o2 = (kb * na + a) * 3; for (let k = 0; k < 3; k++) A[v + k] += q * ((1 - wk) * D[o1 + k] + wk * D[o2 + k]); }
        c.m.geometry.attributes.position.needsUpdate = true; } }
    this.h.update(); return fr;
  }
}

// ---------------------------------------------------------------- HAIR in motion: HAIR4's aSway driven (braids, locs), long hair by its length
// Three damped pendulums a head (left, right, back: their own frequency, ~0.8-1.0 Hz for a 25-35 cm rope, zeta 0.25), driven by the
// acceleration of the base of the skull (neck03) in the world, capped at 5 cm; each hair vertex moves by its weight x its group's
// displacement. The weight: HAIR4's aSway where the groom has it (0 where a rope rests on the body, rising along the free part), else
// for long hair the strand's own length past the chin (aHair.x, 0 root .. 1 tip; below the jaw only). Stored per frame as WORLD vectors
// (channels hair<G>x..z); the page turns them into the bind frame by the chest's world rotation (ropes rest on the chest and back).
export const HAIR_GROUPS = ['L', 'R', 'C'];
export function hairWeights(h, mesh) { const g = mesh.geometry, P = g.attributes.position.array, n = P.length / 3, S = g.attributes.aSway?.array, A = g.attributes.aHair?.array, w = new Float32Array(n), grp = new Uint8Array(n);
  const jawY = h.head0[h.idx.jaw].y - 0.04, eyeY = (h.eyeL.y + h.eyeR.y) / 2;
  for (let i = 0; i < n; i++) { const x = P[i * 3], y = P[i * 3 + 1]; grp[i] = x > 0.045 ? 0 : x < -0.045 ? 1 : 2;
    if (S) w[i] = S[i]; else if (A) w[i] = 0.7 * sstep(0.35, 1, A[i * 4]) * sstep(jawY, jawY - 0.14, y) * (y < eyeY ? 1 : 0); }
  return { w, grp, any: w.some(x => x > 0.02), src: S ? 'aSway' : 'length' }; }
export class HairSway {
  constructor(h, { hz = [0.95, 1.0, 0.85], zeta = 0.25, cap = 0.05, gain = 1 } = {}) { Object.assign(this, { h, hz, zeta, cap, gain }); this.D = HAIR_GROUPS.map(() => V()); this.Vv = HAIR_GROUPS.map(() => V()); this.p1 = null; this.p2 = null; }
  step(dt, sub = 6) { const p = this.h.joint('neck03'), out = {};
    // (a hanging rope swings, it does not bounce: only the horizontal acceleration drives it)
    if (this.p1 && this.p2) { const a = p.clone().sub(this.p1.clone().multiplyScalar(2)).add(this.p2).multiplyScalar(1 / (dt * dt)), hs = dt / sub; a.y = 0;
      HAIR_GROUPS.forEach((_, k) => { const w = 2 * Math.PI * this.hz[k], D = this.D[k], Vv = this.Vv[k];
        for (let s = 0; s < sub; s++) { Vv.addScaledVector(D, -w * w * hs).addScaledVector(Vv, -2 * this.zeta * w * hs).addScaledVector(a, -this.gain * hs); D.addScaledVector(Vv, hs); }
        if (D.length() > this.cap) { D.setLength(this.cap); Vv.multiplyScalar(0.5); } }); }
    this.p2 = this.p1; this.p1 = p.clone();
    HAIR_GROUPS.forEach((g, k) => { out['hair' + g + 'x'] = this.D[k].x; out['hair' + g + 'y'] = this.D[k].y; out['hair' + g + 'z'] = this.D[k].z; });
    return out; }
}
function V() { return new THREE.Vector3(); }
export const HAIR_CHANS = HAIR_GROUPS.flatMap(g => ['x', 'y', 'z'].map(a => 'hair' + g + a));
// the page: hair meshes of the groom (scalp) moved by the cached pendulums
export class HairPlayer {
  constructor(P, track) { this.P = P; this.h = P.h; this.track = track; this.meshes = (P.groom?.meshes || []).filter(m => m.userData.hairPart === 'scalp').map(m => { const W = hairWeights(P.h, m); return W.any ? { m, ...W, X0: Float32Array.from(m.geometry.attributes.position.array) } : null; }).filter(Boolean); }
  apply(tp, fr) { if (!this.meshes.length) return; const q = new THREE.Quaternion(); this.h.bone('spine03').getWorldQuaternion(q); q.invert();
    const D = HAIR_GROUPS.map(g => new THREE.Vector3(tp.chan('hair' + g + 'x', fr), tp.chan('hair' + g + 'y', fr), tp.chan('hair' + g + 'z', fr)).applyQuaternion(q));
    for (const M of this.meshes) { const A = M.m.geometry.attributes.position.array; for (let i = 0; i < M.w.length; i++) { const w = M.w[i]; if (w < 0.01) continue; const d = D[M.grp[i]]; A[i * 3] = M.X0[i * 3] + w * d.x; A[i * 3 + 1] = M.X0[i * 3 + 1] + w * d.y; A[i * 3 + 2] = M.X0[i * 3 + 2] + w * d.z; }
      M.m.geometry.attributes.position.needsUpdate = true; } }
}
// the page: the eyes' gaze (the globe meshes of likeness/eyes.js rotated about each eye's centre; aEyeL = the vertex in the eye's frame)
export class EyePlayer {
  constructor(P) { const h = P.h; this.m = h.meshes.filter(m => m.userData.part === 'eye' && m.geometry.attributes.aEyeL); this.st = this.m.map(m => { const g = m.geometry; return { m, X0: Float32Array.from(g.attributes.position.array), N0: g.attributes.normal ? Float32Array.from(g.attributes.normal.array) : null, L: g.attributes.aEyeL.array }; }); }
  apply(yaw, pitch) { if (!this.st.length) return; const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, yaw, 0, 'YXZ')), v = new THREE.Vector3();
    for (const s of this.st) { const g = s.m.geometry, A = g.attributes.position.array, N = g.attributes.normal?.array, n = A.length / 3;
      for (let i = 0; i < n; i++) { const lx = s.L[i * 4], ly = s.L[i * 4 + 1], lz = s.L[i * 4 + 2], cx = s.X0[i * 3] - lx, cy = s.X0[i * 3 + 1] - ly, cz = s.X0[i * 3 + 2] - lz;
        v.set(lx, ly, lz).applyQuaternion(q); A[i * 3] = cx + v.x; A[i * 3 + 1] = cy + v.y; A[i * 3 + 2] = cz + v.z;
        if (N && s.N0) { v.set(s.N0[i * 3], s.N0[i * 3 + 1], s.N0[i * 3 + 2]).applyQuaternion(q); N[i * 3] = v.x; N[i * 3 + 1] = v.y; N[i * 3 + 2] = v.z; } }
      g.attributes.position.needsUpdate = true; if (N) g.attributes.normal.needsUpdate = true; } }
}
