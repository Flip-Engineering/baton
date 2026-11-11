// Deterministic two-panel, two-family fixture for the cloth-motion contact path (issue #87 S2, CPU only).
//
// The body is two quads in the z=0 plane: a trunk panel on the left (x -0.1..0) weighted to a bone that can translate in +z, and an arm panel
// on the right (x 0..0.1) weighted to a static bone. The garment is the same two quads 3 mm above it, one panel weighted to the trunk family
// and one to the arm family, with their x=0 vertices coincident: a seam between two panels that collide with different body families. This is
// the minimal shape of the armhole row (the sleeve's wall is the arm, the body panel's wall is the trunk) that the final weld in
// ClothMotion.step averages after the wall pass. No person bake, no assets, no GL: the fixture runs in milliseconds and is identical on
// every machine.
import * as THREE from 'three';

const IDENT = Float64Array.from(new THREE.Matrix4().elements);

function mesh({ pos, idx, normals, si, sw, k3 }) {
  return {
    geometry: {
      attributes: {
        position: { array: Float32Array.from(pos), count: pos.length / 3 },
        normal: { array: Float32Array.from(normals) },
        skinIndex: { array: Uint16Array.from(si) },
        skinWeight: { array: Float32Array.from(sw) },
      },
      index: { array: Uint32Array.from(idx) },
      userData: { plan: { tri: idx.slice() } },
    },
    userData: { k3 },
    updateMatrixWorld() {},
    matrixWorld: new THREE.Matrix4(),
    bindMatrix: new THREE.Matrix4(),
    bindMatrixInverse: new THREE.Matrix4(),
    skeleton: { boneMatrices: null, update() {} },
  };
}

export function makeClothFixture({ fabric = 'chambray' } = {}) {
  // three bones: root (static), spine01 (the trunk body's mover), upperarm01.L (the arm family, static)
  const boneMats = new Float32Array(48); boneMats.set(IDENT, 0); boneMats.set(IDENT, 16); boneMats.set(IDENT, 32);
  const bodyPos = [-0.1, -0.1, 0, 0, -0.1, 0, 0, 0.1, 0, -0.1, 0.1, 0,
    0, -0.1, 0, 0.1, -0.1, 0, 0.1, 0.1, 0, 0, 0.1, 0];
  const bodyIdx = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
  const bodyN = Array(24).fill(0); for (let i = 2; i < bodyN.length; i += 3) bodyN[i] = 1;
  const bodySI = [], bodySW = [];
  for (let v = 0; v < 8; v++) { bodySI.push(v < 4 ? 1 : 2, 0, 0, 0); bodySW.push(1, 0, 0, 0); }
  const body = mesh({ pos: bodyPos, idx: bodyIdx, normals: bodyN, si: bodySI, sw: bodySW, k3: { group: 'body' } });

  const gPos = [-0.1, -0.1, 0.003, 0, -0.1, 0.003, 0, 0.1, 0.003, -0.1, 0.1, 0.003,
    0, -0.1, 0.003, 0.1, -0.1, 0.003, 0.1, 0.1, 0.003, 0, 0.1, 0.003];
  const gN = Array(24).fill(0); for (let i = 2; i < gN.length; i += 3) gN[i] = 1;
  const one = (bone) => [bone, 0, 0, 0, bone, 0, 0, 0, bone, 0, 0, 0, bone, 0, 0, 0];
  const oneW = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  const left = mesh({ pos: gPos.slice(0, 12), idx: [0, 1, 2, 0, 2, 3], normals: gN.slice(0, 12), si: one(0), sw: oneW,
    k3: { group: 'garment', name: 'fixture.left', fabric } });
  const right = mesh({ pos: gPos.slice(12), idx: [0, 1, 2, 0, 2, 3], normals: gN.slice(12), si: one(2), sw: oneW,
    k3: { group: 'garment', name: 'fixture.right', fabric } });
  left.skeleton.boneMatrices = boneMats; right.skeleton.boneMatrices = boneMats; body.skeleton.boneMatrices = boneMats;

  const h = {
    body,
    bones: [{ name: 'root' }, { name: 'spine01' }, { name: 'upperarm01.L' }],
    // ClothMotion's freedom/region helpers read these by name; the fixture's garment names match neither trousers nor shirts, so only the
    // constructor's hip lookup and the region joints need a valid rest position.
    idx: { 'lowerleg01.L': 0, 'lowerleg01.R': 0, 'foot.L': 0, 'foot.R': 0, 'spine04': 0, 'upperleg01.L': 0, 'upperleg01.R': 0, 'upperarm01.L': 0 },
    head0: [{ x: 0, y: 0, z: 0 }],
  };
  return {
    P: { h, parts: [left, right] }, boneMats,
    pose(dz) { const m = new THREE.Matrix4().makeTranslation(0, 0, dz); boneMats.set(m.elements, 16); },
    reset() { boneMats.set(IDENT, 16); },
  };
}

// posed position of one carried vertex: S + A . off (the page's skinning of the bind offset)
export function posed(C, s, i) {
  const o = i * 3, q = i * 9, A = s.A;
  return [s.S[o] + A[q] * s.off[o] + A[q + 3] * s.off[o + 1] + A[q + 6] * s.off[o + 2],
    s.S[o + 1] + A[q + 1] * s.off[o] + A[q + 4] * s.off[o + 1] + A[q + 7] * s.off[o + 2],
    s.S[o + 2] + A[q + 2] * s.off[o] + A[q + 5] * s.off[o + 1] + A[q + 8] * s.off[o + 2]];
}

// signed clearance to the nearest body vertex of the vertex's own family, and the wall target the solver aims at
export function wall(C, s, i, p = posed(C, s, i)) {
  const G = C._gF[s.fam[i]]; if (!G) return null;
  const j = G.nearest(p[0], p[1], p[2], 0.05); if (j < 0) return null;
  const X = C._bx, N = C._bn;
  const d = (p[0] - X[j * 3]) * N[j * 3] + (p[1] - X[j * 3 + 1]) * N[j * 3 + 1] + (p[2] - X[j * 3 + 2]) * N[j * 3 + 2];
  return { j, d, want: Math.min(s.rest[i], s.gapC) + C._sag(s, i, j) };
}

// the seam groups' positions and wall state after a step
export function seamMetrics(C) {
  const members = [], coins = [];
  for (const L of C.weld) { const ps = [];
    for (let a = 0; a < L.length; a += 2) { const s = C.st[L[a]], i = L[a + 1], p = posed(C, s, i); ps.push(p);
      const w = wall(C, s, i, p); if (w) members.push({ part: L[a], i, name: s.m.userData.k3.name, ...w, pen: Math.max(0, -w.d), deficit: Math.max(0, w.want - w.d) }); }
    let coin = 0; for (let a = 1; a < ps.length; a++) coin = Math.max(coin, Math.hypot(ps[a][0] - ps[0][0], ps[a][1] - ps[0][1], ps[a][2] - ps[0][2]));
    coins.push(coin * 1000); }
  return {
    members,
    coincidenceMm: coins.length ? Math.max(...coins) : 0,
    minClearanceMm: members.length ? Math.min(...members.map(m => m.d)) * 1000 : null,
    penetrationMm: members.length ? Math.max(...members.map(m => m.pen)) * 1000 : null,
    deficitMm: members.length ? Math.max(...members.map(m => m.deficit)) * 1000 : null,
  };
}

// cloth inside its family wall (max depth, mm) and the largest posed/stance edge ratio over every carried garment edge
export function garmentMetrics(C) {
  let pen = 0, stretch = 0, edges = 0;
  for (const s of C.st) {
    const garment = s.m.userData.k3.group === 'garment';
    if (garment) for (let i = 0; i < s.n; i++) { const w = wall(C, s, i); if (w && -w.d > pen) pen = -w.d; }
    for (let e = 0; e < s.ed.length; e += 2) { const l0 = s.el0[e >> 1]; if (!(l0 > 2e-5)) continue;
      const a = s.ed[e], b = s.ed[e + 1], pa = posed(C, s, a), pb = posed(C, s, b);
      const k = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]) / l0; if (k > stretch) stretch = k; edges++; }
  }
  return { penetrationMm: pen * 1000, stretch, edges };
}
