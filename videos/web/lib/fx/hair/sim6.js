// HAIR / sim6 (HAIR6, round 6, 4 Oct; the client: "improved hair physics"): the hair's strands as chains, simulated against the posed
// body. The person's caller settles every groom with it (settleHair6 after the stance).
//
// What it simulates. Any groom's scalp mesh is read back as STRANDS: its vertices are written card by card, a node at a time (a
// ribbon's pair, a tube's ring: runs of equal aHair.x), and a card starts where aHair.x restarts (the same reading as integration v4's
// settleHairPosed). Each strand becomes a coarse CHAIN (a node every ~2 cm of arc; the curl and the card's width between chain nodes
// ride along as offsets), and the chains are moved by position-based dynamics in the style of AMD's TressFX 4 (Han and Harada 2012,
// "Real-time hair simulation with efficient hair style preservation", VRIPHYS; MIT-licensed reference code, used here as reading only):
//   - Verlet integration with gravity and a per-form air damping;
//   - GLOBAL shape matching: each node pulled toward its groomed position carried by the skinning, strongly at the root and fading
//     along the strand (the style holds at the scalp, the length falls free);
//   - LOCAL shape constraints: each edge kept at its groomed direction in its PARENT's frame (the frame parallel-transported down the
//     chain), which is the bending stiffness that keeps a wave, a ringlet or a coil its shape while the whole strand swings; stiffness
//     by form (straight hair soft, coils stiff, ropes heavy);
//   - inextensibility by follow-the-leader (Mueller, Kim and Chentanez 2012, "Fast simulation of inextensible hair and fur");
//   - COLLISION with the posed person: the skull (HAIR's own head field, in the head bone's frame), the neck (a capsule), the trunk
//     with whatever is worn on it (a signed-distance grid built once from the posed body and the garments' stand-off over it, carried
//     by the chest bone), and the upper arms and shoulder caps (capsules on their bones). Each strand rests at a margin that grows
//     with its layer (outer cards stand further off), so hair piled on a shoulder keeps a thickness without strand-strand contacts.
// Two uses:
//   SETTLE (stills): settleHair6(P) after the stance: every strand of 5 cm or more falls under gravity for a second and a half from its
//     groomed shape onto the posed body (long hair onto the shoulders and down the back instead of standing off them as grown in the
//     bind pose) and the result is written back to the bind positions and the strand tangents (no new attribute, no shader change);
//   MOTION (clips): HairSim6 on a few hundred GUIDE strands, posed each frame from MOTION's clip cache (bones, root, group), baked to a
//     small track of bind-space guide offsets (hair6_bake.mjs, encodeHair6); in the page HairPlayer6 moves every strand by its nearest
//     guides (inverse-distance weights on the root, the offset taken at the same arc length) and turns its tangent with it.
import * as THREE from 'three';
import { sstep } from './field.js';
import { faceWindow } from './v3.js';

// ---------------------------------------------------------------- per form: stiffness, damping (per 1/120 s substep)
// (damp: motion only, on the motion relative to the skinned rest (the settle uses SIM6.settleDamp); hair-hair friction in a head of hair
// damps a swing within a few tenths of a second)
// kL local (bending) stiffness, kG0 global at the root, gR the arc length (m) over which the global pull fades (from gR[0] to gR[1]) to kG1,
// damp air damping, margin0 the rest margin at the innermost layer, marginL the extra for the outermost
export const FORM6 = {
  straight: { kL: 0.07, kG0: 0.5, kG1: 0, gR: [0.03, 0.12], damp: 0.08, margin0: 0.003, marginL: 0.01, smooth: 0.006 },
  wavy: { kL: 0.09, kG0: 0.5, kG1: 0, gR: [0.03, 0.12], damp: 0.085, margin0: 0.003, marginL: 0.011, smooth: 0.01 },
  curly: { kL: 0.2, kG0: 0.55, kG1: 0, gR: [0.035, 0.13], damp: 0.12, margin0: 0.004, marginL: 0.014, smooth: 0.016 },
  coily: { kL: 0.35, kG0: 0.65, kG1: 0.05, gR: [0.03, 0.1], damp: 0.1, margin0: 0.004, marginL: 0.014, smooth: 0.012 },
  rope: { kL: 0.12, kG0: 0.55, kG1: 0, gR: [0.05, 0.16], damp: 0.07, margin0: 0.004, marginL: 0.005, smooth: 0.004 },
};
export const SIM6 = { spacing: 0.025, minLen: 0.05, settleT: 2.0, settleDt: 1 / 60, settleDamp: 0.1, sub: 2, grav: 9.81, guides: 160, fric: 0.6, fricK: 0.4, vmax: 3.0, dftl: 0.9 };

// ---------------------------------------------------------------- strands from a groom mesh
// nodes: runs of equal aHair.x (a ribbon's pair or a tube's ring); a strand restarts where aHair.x is 0 or falls
export function strandsOf(mesh) {
  const g = mesh.geometry, A = g.attributes.aHair.array, X = g.attributes.position.array, SI = g.attributes.skinIndex.array, SW = g.attributes.skinWeight.array, n = g.attributes.position.count;
  const nv0 = [], nv1 = [], strands = []; let i = 0, prevT = -1, cur = null;
  while (i < n) { let j = i + 1; while (j < n && A[j * 4] === A[i * 4] && j - i < 64) j++; const t = A[i * 4];
    if (t === 0 || t <= prevT || !cur) { cur = { a: nv0.length, b: nv0.length }; strands.push(cur); }
    nv0.push(i); nv1.push(j); cur.b = nv0.length; prevT = t; i = j; }
  const N = nv0.length, P = new Float64Array(N * 3), s = new Float64Array(N), depth = new Float32Array(N), si = new Uint16Array(N * 4), sw = new Float32Array(N * 4);
  for (let k = 0; k < N; k++) { const a = nv0[k], b = nv1[k], c = b - a; let x = 0, y = 0, z = 0; for (let v = a; v < b; v++) { x += X[v * 3]; y += X[v * 3 + 1]; z += X[v * 3 + 2]; }
    P[k * 3] = x / c; P[k * 3 + 1] = y / c; P[k * 3 + 2] = z / c; depth[k] = A[a * 4 + 1]; for (let q = 0; q < 4; q++) { si[k * 4 + q] = SI[a * 4 + q]; sw[k * 4 + q] = SW[a * 4 + q]; } }
  for (const S of strands) { let acc = 0; s[S.a] = 0; for (let k = S.a + 1; k < S.b; k++) { acc += Math.hypot(P[k * 3] - P[k * 3 - 3], P[k * 3 + 1] - P[k * 3 - 2], P[k * 3 + 2] - P[k * 3 - 1]); s[k] = acc; } S.len = acc; S.ring = nv1[S.a] - nv0[S.a]; }
  return { mesh, nv0: Int32Array.from(nv0), nv1: Int32Array.from(nv1), P, s, depth, si, sw, strands, N };
}

// a strand is HELD (not simulated) when its first vertex is flagged in the mesh's userData.hold6 (v6.js CardBuilder6, per vertex)
export function heldOf(S) { const H = S.mesh?.userData?.hold6, n = S.mesh?.geometry?.attributes?.position?.count; if (!H || H.length !== n) return () => false; return i => !!H[S.nv0[S.strands[i].a]]; }

// ---------------------------------------------------------------- skinning helpers (three's formula: W_k = M . bindInv . B_k . bind)
export function boneMats(m, out = null) {
  m.updateMatrixWorld(true); m.skeleton.update();
  const BM = m.skeleton.boneMatrices, nb = BM.length / 16, T1 = new THREE.Matrix4().multiplyMatrices(m.matrixWorld, m.bindMatrixInverse), T2 = new THREE.Matrix4(), Bk = new THREE.Matrix4();
  out = out || new Float64Array(nb * 16);
  for (let k = 0; k < nb; k++) { Bk.fromArray(BM, k * 16); T2.multiplyMatrices(T1, Bk).multiply(m.bindMatrix); for (let q = 0; q < 16; q++) out[k * 16 + q] = T2.elements[q]; }
  return out;
}
// the blended 3x4 (column-major 4x4 without the last row) of node k into M12 (12 floats at o)
function blend(W, si, sw, k, M, o) { for (let q = 0; q < 12; q++) M[o + q] = 0;
  for (let j = 0; j < 4; j++) { const w = sw[k * 4 + j]; if (!w) continue; const e = si[k * 4 + j] * 16;
    M[o] += w * W[e]; M[o + 1] += w * W[e + 1]; M[o + 2] += w * W[e + 2]; M[o + 3] += w * W[e + 4]; M[o + 4] += w * W[e + 5]; M[o + 5] += w * W[e + 6];
    M[o + 6] += w * W[e + 8]; M[o + 7] += w * W[e + 9]; M[o + 8] += w * W[e + 10]; M[o + 9] += w * W[e + 12]; M[o + 10] += w * W[e + 13]; M[o + 11] += w * W[e + 14]; } }
const xf = (M, o, x, y, z, out, oi) => { out[oi] = M[o] * x + M[o + 3] * y + M[o + 6] * z + M[o + 9]; out[oi + 1] = M[o + 1] * x + M[o + 4] * y + M[o + 7] * z + M[o + 10]; out[oi + 2] = M[o + 2] * x + M[o + 5] * y + M[o + 8] * z + M[o + 11]; };
// d_bind = A^-1 d_world (A: the blended linear part)
function invLin(M, o, dx, dy, dz, out, oi) {
  const a = M[o], b = M[o + 3], c = M[o + 6], d = M[o + 1], e = M[o + 4], f = M[o + 7], g = M[o + 2], h = M[o + 5], k = M[o + 8];
  const det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g); if (Math.abs(det) < 1e-12) { out[oi] = out[oi + 1] = out[oi + 2] = 0; return; }
  const id = 1 / det;
  out[oi] = ((e * k - f * h) * dx + (c * h - b * k) * dy + (b * f - c * e) * dz) * id;
  out[oi + 1] = ((f * g - d * k) * dx + (a * k - c * g) * dy + (c * d - a * f) * dz) * id;
  out[oi + 2] = ((d * h - e * g) * dx + (b * g - a * h) * dy + (a * e - b * d) * dz) * id;
}
const boneIdx = (h, name) => h.bones.findIndex(b => b.name === name);

// ---------------------------------------------------------------- colliders: skull, neck, trunk (SDF), arms
// Built once in the current (stance) pose from the posed body and garments; each piece rides one bone's skinning transform.
export class Colliders6 {
  constructor(P, { cell = 0.01, pad = 0.05, layerLat = 0.015 } = {}) {
    const h = P.h, body = h.body, F = P.groom?.F; this.h = h; this.F = F; this.body = body;
    h.update?.(); h.group.updateMatrixWorld(true);
    const W = boneMats(body); this.W = W;
    this.bHead = boneIdx(h, 'head'); this.bChest = boneIdx(h, 'spine01'); this.bNeck = [boneIdx(h, 'neck01'), boneIdx(h, 'head')];
    // posed body (morphs ignored: the trunk and arms carry none that matter here), with normals skinned by the linear part
    const g = body.geometry, X = g.attributes.position.array, NA = g.attributes.normal.array, SI = g.attributes.skinIndex.array, SW = g.attributes.skinWeight.array, n = X.length / 3;
    const M = new Float64Array(12), PX = new Float64Array(n * 3), PN = new Float64Array(n * 3), dom = new Int16Array(n);
    for (let v = 0; v < n; v++) { blend(W, SI, SW, v, M, 0); xf(M, 0, X[v * 3], X[v * 3 + 1], X[v * 3 + 2], PX, v * 3);
      const nx = M[0] * NA[v * 3] + M[3] * NA[v * 3 + 1] + M[6] * NA[v * 3 + 2], ny = M[1] * NA[v * 3] + M[4] * NA[v * 3 + 1] + M[7] * NA[v * 3 + 2], nz = M[2] * NA[v * 3] + M[5] * NA[v * 3 + 1] + M[8] * NA[v * 3 + 2], l = Math.hypot(nx, ny, nz) || 1;
      PN[v * 3] = nx / l; PN[v * 3 + 1] = ny / l; PN[v * 3 + 2] = nz / l; let bw = -1, bi = 0; for (let j = 0; j < 4; j++) if (SW[v * 4 + j] > bw) { bw = SW[v * 4 + j]; bi = SI[v * 4 + j]; } dom[v] = bi; }
    const name = i => h.bones[i]?.name || '', isArm = i => /^(upperarm|lowerarm|wrist|finger|metacarpal)/.test(name(i)), isHead = i => !/^(neck|spine|clavicle|shoulder|breast|root|pelvis)/.test(name(i)) && !isArm(i) && !/^(upperleg|lowerleg|foot|toe)/.test(name(i));
    const J = nm => h.joint(nm).clone(), neck01 = J('neck01'), head = J('head'), sh = J('shoulder01.L').y;
    // ---- arms: capsules shoulder01 -> upperarm01 -> lowerarm01 (each side), radius = the 70th percentile of its bones' vertices' distance
    this.caps = [];
    const capOf = (a, b, bone, test) => { const A = J(a), B = J(b), ab = B.clone().sub(A), L2 = ab.lengthSq(), ds = [];
      for (let v = 0; v < n; v++) { if (!test(dom[v])) continue; const px = PX[v * 3] - A.x, py = PX[v * 3 + 1] - A.y, pz = PX[v * 3 + 2] - A.z, t = Math.max(0, Math.min(1, (px * ab.x + py * ab.y + pz * ab.z) / L2));
        ds.push(Math.hypot(px - ab.x * t, py - ab.y * t, pz - ab.z * t)); }
      ds.sort((p, q) => p - q); const r = ds.length ? ds[Math.floor(ds.length * 0.7)] : 0.04;
      return { a, b, bone: boneIdx(h, bone), r, A: new THREE.Vector3(), B: new THREE.Vector3() }; };
    for (const s of ['L', 'R']) { const up = i => /^upperarm0[12]\./.test(name(i)) && name(i).endsWith('.' + s);
      this.caps.push(capOf(`upperarm01.${s}`, `lowerarm01.${s}`, `upperarm01.${s}`, up)); }
    this.caps.push({ ...capOf('neck01', 'head', 'neck01', i => /^neck0/.test(name(i))), neck: true });
    // ---- the trunk: a signed-distance grid in the chest bone's frame, from the posed body (no arms, no head) and the garments' stand-off
    const y0 = sh - 0.34, y1 = neck01.y + 0.04, pts = [], nrm = [];
    for (let v = 0; v < n; v++) { const y = PX[v * 3 + 1]; if (y < y0 || y > y1 || isArm(dom[v]) || isHead(dom[v])) continue; pts.push(v); }
    const np = pts.length, layer = new Float32Array(np), hc = 0.02, grid = new Map(), key = (x, y, z) => ((Math.floor(x / hc) + 512) * 1024 + Math.floor(y / hc) + 512) * 1024 + Math.floor(z / hc) + 512;
    pts.forEach((v, i) => { const k = key(PX[v * 3], PX[v * 3 + 1], PX[v * 3 + 2]); let L = grid.get(k); if (!L) grid.set(k, (L = [])); L.push(i); });
    const near = (x, y, z, r, fn) => { const R = Math.ceil(r / hc), a = Math.floor(x / hc) + 512, b = Math.floor(y / hc) + 512, c = Math.floor(z / hc) + 512;
      for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) for (let k = -R; k <= R; k++) { const L = grid.get(((a + i) * 1024 + b + j) * 1024 + c + k); if (L) for (const id of L) fn(id); } };
    // the normals smoothed over 3 cm (an armpit's or a cleavage's raw normals turn sideways; the clothes bridge them)
    const SN = new Float64Array(np * 3);
    for (let i = 0; i < np; i++) { const v = pts[i], x = PX[v * 3], y = PX[v * 3 + 1], z = PX[v * 3 + 2]; let sx = 0, sy = 0, sz = 0;
      near(x, y, z, 0.03, j => { const u = pts[j], d2 = (PX[u * 3] - x) ** 2 + (PX[u * 3 + 1] - y) ** 2 + (PX[u * 3 + 2] - z) ** 2; if (d2 > 9e-4) return; const w = 1 - d2 / 9e-4; sx += PN[u * 3] * w; sy += PN[u * 3 + 1] * w; sz += PN[u * 3 + 2] * w; });
      const l = Math.hypot(sx, sy, sz) || 1; SN[i * 3] = sx / l; SN[i * 3 + 1] = sy / l; SN[i * 3 + 2] = sz / l; }
    // the garments' stand-off over each body point (settleHairPosed's layer): the farthest garment vertex along the point's normal line
    const visibleIn = m => { for (let p = m; p; p = p.parent) if (p.visible === false) return false; return true; }; let gv = 0;
    for (const m of P.parts || []) { if (!visibleIn(m) || !m.isSkinnedMesh || !m.geometry?.attributes?.position) continue; const Wm = boneMats(m);
      const gg = m.geometry, GX = gg.attributes.position.array, GI = gg.attributes.skinIndex.array, GW = gg.attributes.skinWeight.array, q = new Float64Array(3), MM = new Float64Array(12);
      for (let v = 0; v < GX.length / 3; v++) { blend(Wm, GI, GW, v, MM, 0); xf(MM, 0, GX[v * 3], GX[v * 3 + 1], GX[v * 3 + 2], q, 0); if (q[1] < y0 || q[1] > y1) continue; gv++;
        near(q[0], q[1], q[2], layerLat, i => { const u = pts[i], dx = q[0] - PX[u * 3], dy = q[1] - PX[u * 3 + 1], dz = q[2] - PX[u * 3 + 2], hh = dx * SN[i * 3] + dy * SN[i * 3 + 1] + dz * SN[i * 3 + 2];
          if (hh < -0.004 || hh > 0.06 || dx * dx + dy * dy + dz * dz - hh * hh > layerLat * layerLat) return; if (hh > layer[i]) layer[i] = hh; }); } }
    // into the chest frame (the inverse of the chest bone's skinning transform now), the grid's box, and the signed distance per cell
    const Wc = W.subarray(this.bChest * 16, this.bChest * 16 + 16), Mc = new THREE.Matrix4().fromArray(Array.from(Wc)), Mi = Mc.clone().invert(), v3 = new THREE.Vector3(), n3 = new THREE.Vector3();
    const LP = new Float64Array(np * 3), LN = new Float64Array(np * 3); let bx0 = 1e9, by0 = 1e9, bz0 = 1e9, bx1 = -1e9, by1 = -1e9, bz1 = -1e9;
    for (let i = 0; i < np; i++) { const v = pts[i]; v3.set(PX[v * 3], PX[v * 3 + 1], PX[v * 3 + 2]).applyMatrix4(Mi); n3.set(SN[i * 3], SN[i * 3 + 1], SN[i * 3 + 2]).transformDirection(Mi);
      LP[i * 3] = v3.x; LP[i * 3 + 1] = v3.y; LP[i * 3 + 2] = v3.z; LN[i * 3] = n3.x; LN[i * 3 + 1] = n3.y; LN[i * 3 + 2] = n3.z;
      bx0 = Math.min(bx0, v3.x); by0 = Math.min(by0, v3.y); bz0 = Math.min(bz0, v3.z); bx1 = Math.max(bx1, v3.x); by1 = Math.max(by1, v3.y); bz1 = Math.max(bz1, v3.z); }
    const o = [bx0 - pad, by0 - pad, bz0 - pad], nx = Math.ceil((bx1 - bx0 + 2 * pad) / cell) + 1, ny = Math.ceil((by1 - by0 + 2 * pad) / cell) + 1, nz = Math.ceil((bz1 - bz0 + 2 * pad) / cell) + 1, NC = nx * ny * nz;
    // splat: each body point to the cells within 3 cm, the nearest point kept per cell; cells beyond: outside if reached from the box's
    // border by a flood through cells not near the surface, inside otherwise
    const best = new Int32Array(NC).fill(-1), bd = new Float32Array(NC).fill(1e9), RS = 0.03, rc = Math.ceil(RS / cell);
    for (let id = 0; id < np; id++) { const px = LP[id * 3], py = LP[id * 3 + 1], pz = LP[id * 3 + 2], ci = Math.round((px - o[0]) / cell), cj = Math.round((py - o[1]) / cell), ck = Math.round((pz - o[2]) / cell);
      for (let k = Math.max(0, ck - rc); k <= Math.min(nz - 1, ck + rc); k++) for (let j = Math.max(0, cj - rc); j <= Math.min(ny - 1, cj + rc); j++) for (let i = Math.max(0, ci - rc); i <= Math.min(nx - 1, ci + rc); i++) {
        const x = o[0] + i * cell - px, y = o[1] + j * cell - py, z = o[2] + k * cell - pz, d2 = x * x + y * y + z * z, c = (k * ny + j) * nx + i; if (d2 < bd[c]) { bd[c] = d2; best[c] = id; } } }
    // far from the surface: inside or outside by the trunk's cross-section in the cell's own height slice (star-shaped about the slice's
    // centroid: per 32 sectors the outermost surface point; a flood from the box's border went up into the trunk through its open
    // bottom and top and called its inside 'outside')
    const D = new Float32Array(NC), NSEC = 32, sx = new Float64Array(ny), sz = new Float64Array(ny), sn = new Float64Array(ny), rmax = new Float32Array(ny * NSEC);
    for (let id = 0; id < np; id++) { const j = Math.round((LP[id * 3 + 1] - o[1]) / cell); for (let jj = Math.max(0, j - 2); jj <= Math.min(ny - 1, j + 2); jj++) { sx[jj] += LP[id * 3]; sz[jj] += LP[id * 3 + 2]; sn[jj]++; } }
    for (let j = 0; j < ny; j++) if (sn[j]) { sx[j] /= sn[j]; sz[j] /= sn[j]; }
    const secOf = (dx, dz) => ((Math.floor((Math.atan2(dz, dx) + Math.PI) / (2 * Math.PI) * NSEC) % NSEC) + NSEC) % NSEC;
    for (let id = 0; id < np; id++) { const j = Math.round((LP[id * 3 + 1] - o[1]) / cell); for (let jj = Math.max(0, j - 2); jj <= Math.min(ny - 1, j + 2); jj++) { const dx = LP[id * 3] - sx[jj], dz = LP[id * 3 + 2] - sz[jj], k = jj * NSEC + secOf(dx, dz); rmax[k] = Math.max(rmax[k], Math.hypot(dx, dz)); } }
    // (far cells get the radial distance to that cross-section's boundary, signed: so deep inside the field still points out, the
    // nearest way; a flat plateau inside let a node that got in wander through the trunk and out of its front)
    const far = new Float32Array(NC);
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const c = (k * ny + j) * nx + i; if (!sn[j]) { far[c] = 0.1; continue; }
      const dx = o[0] + i * cell - sx[j], dz = o[2] + k * cell - sz[j]; far[c] = Math.max(-0.2, Math.min(0.2, Math.hypot(dx, dz) - rmax[j * NSEC + secOf(dx, dz)])); }
    for (let c = 0; c < NC; c++) { const id = best[c]; if (id < 0 || bd[c] > RS * RS) { D[c] = far[c] > 0 ? Math.max(far[c], RS) : Math.min(far[c], -RS); continue; }
      const i = c % nx, j = Math.floor(c / nx) % ny, k = Math.floor(c / (nx * ny)), dx = o[0] + i * cell - LP[id * 3], dy = o[1] + j * cell - LP[id * 3 + 1], dz = o[2] + k * cell - LP[id * 3 + 2];
      const hn = dx * LN[id * 3] + dy * LN[id * 3 + 1] + dz * LN[id * 3 + 2], dd = Math.sqrt(bd[c]);
      // near the surface the distance along the normal (minus the garment's stand-off); further out the plain distance, signed by the side
      D[c] = (dd < 0.02 ? hn : Math.sign(hn || 1) * dd) - layer[id]; }
    this.sdf = { o, cell, nx, ny, nz, D };
    this.rep = { trunkPts: np, garmentVerts: gv, layerMaxMm: +(Math.max(0, ...layer) * 1000).toFixed(1), grid: [nx, ny, nz], caps: this.caps.map(c => ({ a: c.a, b: c.b, rMm: +(c.r * 1000).toFixed(1) })) };
    // the face's window (v3.js faceWindow, the groom's own: in front of the face, from the chin to above the brows): hair kept out of it
    // sideways, as the groom keeps it (the first settle let L08's curls, L14's front braids and L12's side hair fall across the face)
    this.face = F ? faceWindow(F, { margin: 2.6, top: 4.5, below: 1.5 }) : null; this._fv = new THREE.Vector3();
    this.Mc = new Float64Array(16); this.Mci = new Float64Array(16); this.Mh = new Float64Array(16); this.Mhi = new Float64Array(16);
    this.update();
  }
  // per frame: the chest's and the head's transforms (and inverses) and the capsules' ends
  update() { const h = this.h; h.group.updateMatrixWorld(true); const W = boneMats(this.body, this.W); const T = new THREE.Matrix4();
    T.fromArray(Array.from(W.subarray(this.bChest * 16, this.bChest * 16 + 16))); this.Mc.set(T.elements); this.Mci.set(T.clone().invert().elements);
    T.fromArray(Array.from(W.subarray(this.bHead * 16, this.bHead * 16 + 16))); this.Mh.set(T.elements); this.Mhi.set(T.clone().invert().elements);
    for (const c of this.caps) { c.A.copy(h.joint(c.a)); c.B.copy(h.joint(c.b)); } }
  sdfAt(x, y, z, g) { const S = this.sdf, fx = (x - S.o[0]) / S.cell, fy = (y - S.o[1]) / S.cell, fz = (z - S.o[2]) / S.cell;
    if (fx < 0 || fy < 0 || fz < 0 || fx >= S.nx - 1 || fy >= S.ny - 1 || fz >= S.nz - 1) return 1;
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz), u = fx - i, v = fy - j, w = fz - k, nx = S.nx, nxy = S.nx * S.ny, D = S.D, b = k * nxy + j * nx + i;
    const c000 = D[b], c100 = D[b + 1], c010 = D[b + nx], c110 = D[b + nx + 1], c001 = D[b + nxy], c101 = D[b + nxy + 1], c011 = D[b + nxy + nx], c111 = D[b + nxy + nx + 1];
    const x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u, x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u, y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
    if (g) { g[0] = ((c100 - c000) * (1 - v) + (c110 - c010) * v) * (1 - w) + ((c101 - c001) * (1 - v) + (c111 - c011) * v) * w;
      g[1] = (x10 - x00) * (1 - w) + (x11 - x01) * w; g[2] = y1 - y0; const l = Math.hypot(g[0], g[1], g[2]) || 1; g[0] /= l; g[1] /= l; g[2] /= l; }
    return y0 + (y1 - y0) * w; }
  // the clearance of the world point at X[o..] (the least signed distance to the trunk, the skull and the capsules; capped at 0.1 m)
  clear(X, o) { const x = X[o], y = X[o + 1], z = X[o + 2]; let d = 0.1;
    { const M = this.Mci, lx = M[0] * x + M[4] * y + M[8] * z + M[12], ly = M[1] * x + M[5] * y + M[9] * z + M[13], lz = M[2] * x + M[6] * y + M[10] * z + M[14]; d = Math.min(d, this.sdfAt(lx, ly, lz, null)); }
    const sk = this._skull(x, y, z, null); if (sk != null) d = Math.min(d, sk);
    for (const c of this.caps) { const A = c.A, B = c.B, abx = B.x - A.x, aby = B.y - A.y, abz = B.z - A.z, px = x - A.x, py = y - A.y, pz = z - A.z, L2 = abx * abx + aby * aby + abz * abz;
      const t = Math.max(0, Math.min(1, (px * abx + py * aby + pz * abz) / L2)); d = Math.min(d, Math.hypot(px - abx * t, py - aby * t, pz - abz * t) - c.r); }
    return d; }
  // the skull: signed distance above the chin line + 3 cm (null elsewhere, or > 12 cm off the skull centre); `out` gets the head-frame point
  _skull(x, y, z, out) { const F = this.F; if (!F) return null; const M = this.Mhi, lx = M[0] * x + M[4] * y + M[8] * z + M[12], ly = M[1] * x + M[5] * y + M[9] * z + M[13], lz = M[2] * x + M[6] * y + M[10] * z + M[14];
    if (ly < F.chinY + 0.03) return null; const dx = lx - F.C.x, dy = ly - F.C.y, dz = lz - F.C.z, l = Math.hypot(dx, dy, dz); if (l < 1e-6 || l > 0.2) return null;
    const r = F.rAt(dx / l, dy / l, dz / l); if (!(r > 0)) return null; if (out) { out[0] = dx / l; out[1] = dy / l; out[2] = dz / l; out[3] = r; out[4] = l; } return l - r; }
  // push the world point at X[o..o+2] out of everything to `m` metres; returns the push length (0 if outside)
  push(X, o, m) { let moved = 0; const g = this._g || (this._g = new Float64Array(5));
    // the trunk (in the chest frame)
    { const x = X[o], y = X[o + 1], z = X[o + 2], M = this.Mci; const lx = M[0] * x + M[4] * y + M[8] * z + M[12], ly = M[1] * x + M[5] * y + M[9] * z + M[13], lz = M[2] * x + M[6] * y + M[10] * z + M[14];
      const d = this.sdfAt(lx, ly, lz, g); if (d < m) { const k = m - d, nx = lx + g[0] * k, ny = ly + g[1] * k, nz = lz + g[2] * k, C = this.Mc;
        X[o] = C[0] * nx + C[4] * ny + C[8] * nz + C[12]; X[o + 1] = C[1] * nx + C[5] * ny + C[9] * nz + C[13]; X[o + 2] = C[2] * nx + C[6] * ny + C[10] * nz + C[14]; moved += k; } }
    // the skull (in the head bone's frame, the head field's bind space)
    { const d = this._skull(X[o], X[o + 1], X[o + 2], g); if (d != null && d < m) { const F = this.F, kk = g[3] + m, nx = F.C.x + g[0] * kk, ny = F.C.y + g[1] * kk, nz = F.C.z + g[2] * kk, C = this.Mh;
      X[o] = C[0] * nx + C[4] * ny + C[8] * nz + C[12]; X[o + 1] = C[1] * nx + C[5] * ny + C[9] * nz + C[13]; X[o + 2] = C[2] * nx + C[6] * ny + C[10] * nz + C[14]; moved += m - d; } }
    // the face's window (in the head bone's frame: the groom's bind space)
    if (this.face) { const M = this.Mhi, x1 = X[o], y1 = X[o + 1], z1 = X[o + 2], v = this._fv.set(M[0] * x1 + M[4] * y1 + M[8] * z1 + M[12], M[1] * x1 + M[5] * y1 + M[9] * z1 + M[13], M[2] * x1 + M[6] * y1 + M[10] * z1 + M[14]);
      const x0 = v.x; if (this.face(v)) { const C = this.Mh; X[o] = C[0] * v.x + C[4] * v.y + C[8] * v.z + C[12]; X[o + 1] = C[1] * v.x + C[5] * v.y + C[9] * v.z + C[13]; X[o + 2] = C[2] * v.x + C[6] * v.y + C[10] * v.z + C[14]; moved += Math.abs(v.x - x0); } }
    // capsules (neck, upper arms)
    for (const c of this.caps) { const A = c.A, B = c.B, abx = B.x - A.x, aby = B.y - A.y, abz = B.z - A.z, px = X[o] - A.x, py = X[o + 1] - A.y, pz = X[o + 2] - A.z, L2 = abx * abx + aby * aby + abz * abz;
      const t = Math.max(0, Math.min(1, (px * abx + py * aby + pz * abz) / L2)), dx = px - abx * t, dy = py - aby * t, dz = pz - abz * t, d = Math.hypot(dx, dy, dz), R = c.r + m;
      if (d < R && d > 1e-6) { const k = (R - d) / d; X[o] += dx * k; X[o + 1] += dy * k; X[o + 2] += dz * k; moved += R - d; } }
    return moved; }
}

// ---------------------------------------------------------------- the chains
// HairSim6 over the strands of one scalp mesh: `pick` (optional) a list of strand indices to simulate (guides); else every strand of
// minLen or more. Each chain node is a strand node at ~`spacing` of arc (the root and the tip always); its REST is the strand's centreline
// smoothed over the form's curl scale (a ringlet's or a coil's turns are not bends the chain should hold: they ride along as offsets).
export class HairSim6 {
  constructor(P, mesh, { form = null, pick = null, spacing = SIM6.spacing, minLen = SIM6.minLen, col = null, strands = null, rest = null } = {}) {
    const S = strands || strandsOf(mesh), h = P.h; this.P = P; this.h = h; this.mesh = mesh; this.S = S; this.col = col || new Colliders6(P);
    const held = heldOf(S);   // (v6.js: gathered / bun / puff cards held)
    const f0 = form || P.groom?.form || 'straight', list = pick || S.strands.map((s, i) => i).filter(i => S.strands[i].len >= minLen && !held(i));
    const cn = [], st = [], R0 = rest || S.P;
    for (const i of list) { const Sd = S.strands[i], a = cn.length; let last = -1;
      for (let k = Sd.a; k < Sd.b; k++) { if (k === Sd.a || k === Sd.b - 1 || S.s[k] - S.s[last] >= spacing) { if (k === Sd.b - 1 && last >= 0 && S.s[k] - S.s[last] < spacing * 0.35 && cn.length - a > 1) { cn[cn.length - 1] = k; } else cn.push(k); last = k; } }
      const fm = FORM6[Sd.ring > 2 ? 'rope' : f0] || FORM6.straight; st.push({ strand: i, a, b: cn.length, F: fm }); }
    this.list = list; this.st = st; this.n = cn.length; this.cn = Int32Array.from(cn);
    const n = this.n; this.x = new Float64Array(n * 3); this.xp = new Float64Array(n * 3); this.r = new Float64Array(n * 3); this.M = new Float64Array(n * 12); this.len = new Float64Array(n); this.kG = new Float64Array(n); this.mar = new Float64Array(n); this.mar0 = new Float64Array(n);
    // the chain's rest: the strand smoothed over +-F.smooth of arc (bind)
    this.rest = new Float64Array(n * 3);
    for (const c of st) { const Sd = S.strands[c.strand], w = c.F.smooth; for (let q = c.a; q < c.b; q++) { const k = this.cn[q], s0 = S.s[k]; let sx = 0, sy = 0, sz = 0, sw = 0;
      if (q === c.a || w <= 0) { sx = R0[k * 3]; sy = R0[k * 3 + 1]; sz = R0[k * 3 + 2]; sw = 1; }
      else for (let j = Sd.a; j < Sd.b; j++) { const ds = Math.abs(S.s[j] - s0); if (ds > w) continue; const ww = 1 - ds / w; sx += R0[j * 3] * ww; sy += R0[j * 3 + 1] * ww; sz += R0[j * 3 + 2] * ww; sw += ww; }
      this.rest[q * 3] = sx / sw; this.rest[q * 3 + 1] = sy / sw; this.rest[q * 3 + 2] = sz / sw; } }
    for (const c of st) for (let q = c.a; q < c.b; q++) { const k = this.cn[q], s = S.s[k], F = c.F; this.kG[q] = q === c.a ? 1 : F.kG1 + (F.kG0 - F.kG1) * sstep(F.gR[1], F.gR[0], s); this.mar0[q] = F.margin0 + F.marginL * (1 - Math.min(1, S.depth[k])); }
    this.mar.set(this.mar0); this.W = null; this.g = SIM6.grav;
  }
  // the rest (target) world positions this frame (skinned chain rests) and the blended matrices per chain node
  pose() { this.col.update(); this.W = boneMats(this.mesh, this.W); const S = this.S, R = this.rest; if (!this.rp) this.rp = new Float64Array(this.n * 3); else this.rp.set(this.r); this._sinceP = 0;
    for (let q = 0; q < this.n; q++) { const k = this.cn[q]; blend(this.W, S.si, S.sw, k, this.M, q * 12); xf(this.M, q * 12, R[q * 3], R[q * 3 + 1], R[q * 3 + 2], this.r, q * 3); }
    if (!this._len) { for (const c of this.st) for (let q = c.a + 1; q < c.b; q++) this.len[q] = Math.hypot(this.r[q * 3] - this.r[q * 3 - 3], this.r[q * 3 + 1] - this.r[q * 3 - 2], this.r[q * 3 + 2] - this.r[q * 3 - 1]); this._len = true; } }
  // start at the chain's rest plus bind offsets D0 (per chain node; default none), skinned by the current pose; each node's margin is
  // capped at its own clearance there (a groomed card is never pushed further out than it was grown: only kept from going deeper)
  reset(D0 = null) { this.pose(); const R = this.rest;
    for (let q = 0; q < this.n; q++) { const o = q * 3; xf(this.M, q * 12, R[o] + (D0 ? D0[o] : 0), R[o + 1] + (D0 ? D0[o + 1] : 0), R[o + 2] + (D0 ? D0[o + 2] : 0), this.x, o); }
    this.xp.set(this.x); this.rp.set(this.r); for (let q = 0; q < this.n; q++) this.mar[q] = Math.max(0.0005, Math.min(this.mar0[q], this.col.clear(this.r, q * 3))); }
  step(dt, { damp = null } = {}) {
    const x = this.x, xp = this.xp, r = this.r, rp = this.rp, g = this.g * dt * dt, col = this.col, len = this.len, fric = SIM6.fric, vmax = SIM6.vmax, dF = this.dF || (this.dF = new Float64Array(this.n * 3)), rk = Math.min(1, dt / (this.poseDt || dt));
    for (const c of this.st) { const F = c.F, dmp = damp ?? F.damp, kL = F.kL, a3 = c.a * 3;
      x[a3] = r[a3]; x[a3 + 1] = r[a3 + 1]; x[a3 + 2] = r[a3 + 2]; xp[a3] = x[a3]; xp[a3 + 1] = x[a3 + 1]; xp[a3 + 2] = x[a3 + 2];
      for (let q = c.a + 1; q < c.b; q++) { const o = q * 3, kG = this.kG[q];
        // Verlet with air damping; the velocity capped at vmax (m/s): a node caught between two colliders cannot be thrown
        // (the damping acts on the motion RELATIVE to the skinned rest's own: damping the world velocity is a thick fluid the walking
        // person drags the hair through: it streamed out behind at a walk)
        const rx = (r[o] - rp[o]) * rk, ry = (r[o + 1] - rp[o + 1]) * rk, rz = (r[o + 2] - rp[o + 2]) * rk;
        let vx = rx + (x[o] - xp[o] - rx) * (1 - dmp), vy = ry + (x[o + 1] - xp[o + 1] - ry) * (1 - dmp), vz = rz + (x[o + 2] - xp[o + 2] - rz) * (1 - dmp); const vl = Math.hypot(vx, vy, vz), vc = vmax * dt;
        if (vl > vc) { const k = vc / vl; vx *= k; vy *= k; vz *= k; }
        xp[o] = x[o]; xp[o + 1] = x[o + 1]; xp[o + 2] = x[o + 2]; x[o] += vx; x[o + 1] += vy - g; x[o + 2] += vz;
        if (kG > 0) for (let j = 0; j < 3; j++) x[o + j] += kG * (r[o + j] - x[o + j]); }
      // local shape + length, root to tip; qa = the parent edge's transport rotation (rest -> now), a unit quaternion (w, x, y, z)
      let qw = 1, qx = 0, qy = 0, qz = 0;
      for (let q = c.a + 1; q < c.b; q++) { const o = q * 3, p = o - 3, L = len[q];
        let ex = r[o] - r[p], ey = r[o + 1] - r[p + 1], ez = r[o + 2] - r[p + 2];
        { // e = qa * e * qa^-1
          const tx = 2 * (qy * ez - qz * ey), ty = 2 * (qz * ex - qx * ez), tz = 2 * (qx * ey - qy * ex);
          ex += qw * tx + (qy * tz - qz * ty); ey += qw * ty + (qz * tx - qx * tz); ez += qw * tz + (qx * ty - qy * tx); }
        x[o] += kL * (x[p] + ex - x[o]); x[o + 1] += kL * (x[p + 1] + ey - x[o + 1]); x[o + 2] += kL * (x[p + 2] + ez - x[o + 2]);
        let dx = x[o] - x[p], dy = x[o + 1] - x[p + 1], dz = x[o + 2] - x[p + 2]; const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
        const fx = x[p] + dx * L, fy = x[p + 1] + dy * L, fz = x[p + 2] + dz * L; dF[o] = fx - x[o]; dF[o + 1] = fy - x[o + 1]; dF[o + 2] = fz - x[o + 2]; x[o] = fx; x[o + 1] = fy; x[o + 2] = fz;
        // the rotation from the transported rest edge to the current edge, composed onto qa
        { const el = Math.hypot(ex, ey, ez) || 1, ax = ex / el, ay = ey / el, az = ez / el, d = ax * dx + ay * dy + az * dz;
          if (d < 0.999999) { let rw = 1 + d, rx = ay * dz - az * dy, ry = az * dx - ax * dz, rz = ax * dy - ay * dx; if (rw < 1e-6) { rw = 0; rx = -ay; ry = ax; rz = 0; }
            const rl = Math.hypot(rw, rx, ry, rz); rw /= rl; rx /= rl; ry /= rl; rz /= rl;
            const nw = rw * qw - rx * qx - ry * qy - rz * qz, nx = rw * qx + rx * qw + ry * qz - rz * qy, ny = rw * qy - rx * qz + ry * qw + rz * qx, nz = rw * qz + rx * qy - ry * qx + rz * qw;
            qw = nw; qx = nx; qy = ny; qz = nz; } }
        // contact with Coulomb friction (Macklin, Mueller, Chentanez and Kim 2014, "Unified particle physics for real-time
        // applications", sec. 6.1): the tangential step this substep is removed entirely while it is under mu_s times the push
        // (hair at rest on a shoulder or a collar stays), else cut by mu_k times the push (it slides)
        const px0 = x[o], py0 = x[o + 1], pz0 = x[o + 2], dn = col.push(x, o, this.mar[q]);
        if (dn > 0) { let nx = x[o] - px0, ny = x[o + 1] - py0, nz = x[o + 2] - pz0; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
          const ddx = x[o] - xp[o], ddy = x[o + 1] - xp[o + 1], ddz = x[o + 2] - xp[o + 2], dd = ddx * nx + ddy * ny + ddz * nz, tx = ddx - nx * dd, ty = ddy - ny * dd, tz = ddz - nz * dd, tl = Math.hypot(tx, ty, tz);
          const k = tl < fric * nl ? 1 : Math.min(1, SIM6.fricK * nl / Math.max(tl, 1e-9)); xp[o] += tx * k; xp[o + 1] += ty * k; xp[o + 2] += tz * k; }
      }
      // DFTL (Mueller, Kim and Chentanez 2012): each node's velocity loses its child's follow-the-leader correction (FTL alone drags the
      // tail toward the root: a braid lying back over a shoulder was pulled over it to the front)
      for (let q = c.a + 1; q < c.b - 1; q++) { const o = q * 3, n3 = o + 3; xp[o] += SIM6.dftl * dF[n3]; xp[o + 1] += SIM6.dftl * dF[n3 + 1]; xp[o + 2] += SIM6.dftl * dF[n3 + 2]; }
    }
  }
  // settle under gravity from the current state (stance): T seconds at dt with a strong damping
  settle(T = SIM6.settleT, dt = SIM6.settleDt, damp = SIM6.settleDamp) { const ns = Math.round(T / dt); for (let i = 0; i < ns; i++) this.step(dt, { damp: damp * (i < ns * 0.6 ? 1 : 2) }); return ns; }
  // world offsets from the skinned chain rest -> bind offsets per chain node (the inverse of each node's blended linear part)
  bindOffsets(out = null) { out = out || new Float64Array(this.n * 3); const R = this.r;
    for (let q = 0; q < this.n; q++) invLin(this.M, q * 12, this.x[q * 3] - R[q * 3], this.x[q * 3 + 1] - R[q * 3 + 1], this.x[q * 3 + 2] - R[q * 3 + 2], out, q * 3); return out; }
}

// ---------------------------------------------------------------- strand nodes follow chain nodes (or guides)
// write bind offsets D (per strand node, 3) into the mesh: every vertex of a node moves with it; the strand tangent turns with the
// offset's derivative along the strand (its length, rev 5's root-distance code, kept)
export function applyNodeOffsets(S, D, { X0 = null, T0 = null } = {}) {
  const g = S.mesh.geometry, pos = g.attributes.position, X = pos.array, TA = g.attributes.aHairT, T = TA.array;
  X0 = X0 || Float32Array.from(X); T0 = T0 || Float32Array.from(T);
  for (const Sd of S.strands) for (let k = Sd.a; k < Sd.b; k++) {
    const kp = Math.max(Sd.a, k - 1), kn = Math.min(Sd.b - 1, k + 1), ds = S.s[kn] - S.s[kp];
    const gx = ds > 1e-6 ? (D[kn * 3] - D[kp * 3]) / ds : 0, gy = ds > 1e-6 ? (D[kn * 3 + 1] - D[kp * 3 + 1]) / ds : 0, gz = ds > 1e-6 ? (D[kn * 3 + 2] - D[kp * 3 + 2]) / ds : 0;
    for (let v = S.nv0[k]; v < S.nv1[k]; v++) { X[v * 3] = X0[v * 3] + D[k * 3]; X[v * 3 + 1] = X0[v * 3 + 1] + D[k * 3 + 1]; X[v * 3 + 2] = X0[v * 3 + 2] + D[k * 3 + 2];
      const tx = T0[v * 3], ty = T0[v * 3 + 1], tz = T0[v * 3 + 2], tl = Math.hypot(tx, ty, tz); if (tl < 1e-9) continue;
      const ux = tx / tl + gx, uy = ty / tl + gy, uz = tz / tl + gz, ul = Math.hypot(ux, uy, uz) || 1; T[v * 3] = ux / ul * tl; T[v * 3 + 1] = uy / ul * tl; T[v * 3 + 2] = uz / ul * tl; } }
  pos.needsUpdate = true; TA.needsUpdate = true; return { X0, T0 };
}
// chain-node offsets -> strand-node offsets (linear along the arc between chain nodes; nodes of strands not simulated: 0)
export function spreadChain(sim, Dc, out = null) {
  const S = sim.S, D = out || new Float64Array(S.N * 3); D.fill(0);
  for (const c of sim.st) { const Sd = S.strands[c.strand]; let q = c.a;
    for (let k = Sd.a; k < Sd.b; k++) { while (q + 1 < c.b - 1 && S.s[sim.cn[q + 1]] < S.s[k]) q++; const q1 = Math.min(c.b - 1, q + 1), s0 = S.s[sim.cn[q]], s1 = S.s[sim.cn[q1]], w = q1 > q && s1 > s0 ? Math.max(0, Math.min(1, (S.s[k] - s0) / (s1 - s0))) : 0;
      for (let j = 0; j < 3; j++) D[k * 3 + j] = Dc[q * 3 + j] * (1 - w) + Dc[q1 * 3 + j] * w; } }
  return D;
}

// ---------------------------------------------------------------- HAIR7 c6 iteration 2 (15 Oct; the behaviour): ROOTED WISPS
// What the Cycles L14 showed (060212, 1:1, beside box-braid photographs): small curled wisps hanging in the air beside the braids, rootless,
// 2-5 cm off any braid. Cause (node, L14): the settle simulates every strand of minLen (5 cm) or more and moves it (the braids: mean 44 mm,
// up to 39 cm, drape and stance); the SHORT cards grown off a strand (a braid's loose tail brush below its last stitch, the fuzz of
// escaping fibres along it, a clump's flyaways) are under minLen, so nothing moved them: they stayed where the braid had been groomed and
// the braid settled away from them (L14: a braid's last ring 4.5 cm p50 from its groomed end, its tail brush roots 0.13 cm from it). A
// wisp is the strand's own fibres: it goes where the strand goes. So each strand the settle did not simulate (and that is not held) whose
// ROOT lies within `reach` of a simulated strand's node at the groom takes that node's settle offset whole (a rigid carry: the wisp keeps
// its shape on its parent), fading to none between `fade` and `reach`. Hair rooted on the scalp is untouched (its neighbours' roots do
// not move); any person, any groom: whatever hangs off a strand rides it.
export const RIDE6 = { reach: 0.012, fade: 0.007 };
export function rideShort6(S, sim, D, held = () => false, o = RIDE6) {
  const simd = new Uint8Array(S.strands.length); for (const c of sim.st) simd[c.strand] = 1;
  const cell = o.reach, grid = new Map(), key = (x, y, z) => Math.floor(x / cell) + ',' + Math.floor(y / cell) + ',' + Math.floor(z / cell), P = S.P;
  for (let i = 0; i < S.strands.length; i++) if (simd[i]) { const Sd = S.strands[i]; for (let k = Sd.a; k < Sd.b; k++) { const kk = key(P[k * 3], P[k * 3 + 1], P[k * 3 + 2]); (grid.get(kk) || grid.set(kk, []).get(kk)).push(k); } }
  let rode = 0, sumMm = 0;
  for (let i = 0; i < S.strands.length; i++) { if (simd[i] || held(i)) continue; const Sd = S.strands[i], a = Sd.a, x = P[a * 3], y = P[a * 3 + 1], z = P[a * 3 + 2];
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell); let best = o.reach, bk = -1;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (const k of grid.get((cx + dx) + ',' + (cy + dy) + ',' + (cz + dz)) || []) {
      const d = Math.hypot(P[k * 3] - x, P[k * 3 + 1] - y, P[k * 3 + 2] - z); if (d < best) { best = d; bk = k; } }
    if (bk < 0) continue; const w = best <= o.fade ? 1 : 1 - (best - o.fade) / (o.reach - o.fade), dx = D[bk * 3] * w, dy = D[bk * 3 + 1] * w, dz = D[bk * 3 + 2] * w;
    if (Math.hypot(dx, dy, dz) < 1e-4) continue;
    for (let k = Sd.a; k < Sd.b; k++) { D[k * 3] += dx; D[k * 3 + 1] += dy; D[k * 3 + 2] += dz; } rode++; sumMm += Math.hypot(dx, dy, dz) * 1000; }
  return { rode, meanMm: rode ? +(sumMm / rode).toFixed(1) : 0 };
}

// ---------------------------------------------------------------- SETTLE after the stance (stills): every strand of minLen or more
// P: a built person (makePerson ... with a groom, posed in its stance; garments on). Writes the settled bind positions and tangents into
// each scalp mesh; keeps what the motion bake needs on P.groom._h6 (the groomed rest, the settled bind positions, the colliders' report).
export function settleHair6(P, o = {}) {
  const G = P.groom; if (!G) return { note: 'no groom' };
  const t0 = (globalThis.performance || Date).now(), col = new Colliders6(P, o.col || {}), rep = { col: col.rep, meshes: [] };
  const D7 = o.drape7 !== undefined ? o.drape7 : G.drape7;   // (HAIR7: the draped rest below the ears, drape7Rest)
  for (const m of G.meshes.filter(m => m.userData.hairPart === 'scalp' && m.geometry.attributes.aHair)) {
    const S = strandsOf(m), R7 = D7 && G.F ? drape7Rest(S, G.F, D7) : null, sim = new HairSim6(P, m, { col, strands: S, form: o.form, spacing: o.spacing, minLen: o.minLen, ...(R7 ? { rest: R7 } : {}) });
    if (!sim.n) { rep.meshes.push({ strands: S.strands.length, sim: 0 }); m.userData.h6 = { S, rest: Float64Array.from(S.P), settled: Float64Array.from(S.P), D: new Float64Array(S.N * 3), sim: 0 }; continue; }
    sim.reset(); const steps = sim.settle(o.T, o.dt, o.damp);
    const Dc = sim.bindOffsets(), D = spreadChain(sim, Dc);
    // (HAIR7) the simulated strands' offsets are from the draped rest: add the drape itself (bind) so they are from the groom again
    if (R7) for (const c of sim.st) { const Sd = S.strands[c.strand]; for (let i = Sd.a * 3; i < Sd.b * 3; i++) D[i] += R7[i] - S.P[i]; }
    const ride = rideShort6(S, sim, D, heldOf(S));   // (HAIR7 c6 it 2) the short wisps grown off a strand move with it
    const { X0, T0 } = applyNodeOffsets(S, D);
    // the settled strand-node bind positions (the motion bake's start) and the move's size
    const settled = Float64Array.from(S.P); let mx = 0, sum = 0, cnt = 0; for (let k = 0; k < S.N; k++) { const l = Math.hypot(D[k * 3], D[k * 3 + 1], D[k * 3 + 2]); settled[k * 3] += D[k * 3]; settled[k * 3 + 1] += D[k * 3 + 1]; settled[k * 3 + 2] += D[k * 3 + 2]; if (l > 1e-4) { mx = Math.max(mx, l); sum += l; cnt++; } }
    m.geometry.computeBoundingSphere();
    m.userData.h6 = { S, rest: Float64Array.from(S.P), settled, D, X0, T0, sim: sim.n, ...(R7 ? { rest7: R7 } : {}) };
    rep.meshes.push({ strands: S.strands.length, simStrands: sim.st.length, chainNodes: sim.n, steps, movedNodes: cnt, maxMm: +(mx * 1000).toFixed(1), meanMm: cnt ? +(sum / cnt * 1000).toFixed(1) : 0, ...(R7 ? { drape7: true } : {}), ride });
  }
  rep.ms = Math.round((globalThis.performance || Date).now() - t0); G._h6 = { col, rep }; G.report.settle6 = rep; return rep;
}

// ---------------------------------------------------------------- HAIR7 (round 7): the length below the ears HANGS
// The client's orchestrator on the Cycles L08 (8 Oct): 'from ear level down, translucent sheets of strands stand straight out sideways past
// both shoulders ... the ends float in the air at shoulder height' (defects L08-17, L12-03; in v6 and rev 7 alike). Why (node, the groom
// before and after this settle): the strands are grown over the BIND pose, whose shoulders slope out along the raised arms, so the length
// below the ears is groomed as a cape flaring out along that slope; the stance lowers the arms but the hair rides the head bone, and the
// settle's local shape constraints (each edge held at its groomed direction in its parent's frame) keep the flare against gravity. L08
// rev 7: 62 % of the scalp hair's points below the ears stood more than 15 mm off the body and garments, 1.1 % more than 3 cm outside the
// body's silhouette (arms included), up to 13 cm.
// drape7Rest: the chain's REST (the shape the local constraints keep) hangs below the ears (drape7Hang below); above (the volume beside
// the face, the temples, the crown) the groom's own shape. Gravity, the trunk's SDF (with the garments'
// stand-off), the shoulder and neck capsules and friction then lay the length on the shoulders, the chest and the back. settleHair6 runs
// it when the groom carries `drape7` (groomHero: v7.js REV7.drape) or o.drape7 is given; the offsets it writes stay offsets from
// the GROOM (the drape added back), and h6.rest7 keeps the draped rest for a motion bake (which must build its HairSim6 with rest: rest7
// and its D0 less (rest7 - rest) to agree).
export function drape7Rest(S, F, D) { return drape7Hang(S, F, D); }
// (HAIR7 iteration 3, since 8 Oct 10:50; iteration 2's per-edge cut by height is in git history) HANG FROM THE HEAD, CURL KEPT.
// What iteration 2's measurer saw at 1:1 (measures/it2.md): the cut by HEIGHT (eyes - 5 cm to - 10 cm) left the wings' outer envelope where
// it was (the strands that make it are already 5-8 cm outside the head at jaw level, where the ramp gave 10-60 %), and cutting the outward
// part of EVERY edge also cut each curl's outward half (a ratchet: L08's curls below the ears became flat ribbons and straight streaks, a
// seam at the nape, a ruler-straight cape edge). So: each strand is split into its CENTRELINE (smoothed over +-D.sm of arc, the ends
// pinned) and its RESIDUAL (the curl, the wave); only the centreline hangs, and the residual is added back turned with it. The centreline
// hangs where EITHER it is below y0 (bind, from the eyes; full by y1) OR, below the eyes, it stands more than c0..c1 outside the head's
// horizontal outline (F.rAt from the skull centre): a strand leaving the head sideways hangs from where it leaves; once a strand hangs it
// keeps hanging (the weight never falls along the strand). Short strands keep their groom (a strand's own stiffness carries it: the weight
// ramps in over D.len, so crops, an afro or a TWA are untouched). Each strand gets its own share of the outward cut (lat less up to
// D.spread, most near lat): the edge of the hanging mass is strands, not a plane. Gravity, the trunk's SDF and the capsules then lay it.
function drape7Hang(S, F, D) {
  const P0 = S.P, R = Float64Array.from(P0), eyeY = F.eyeY, y0 = eyeY + D.y0, y1 = eyeY + D.y1, ax0 = F.C.x, az0 = F.axZ ?? F.C.z;
  const lat = D.lat ?? 1, down = D.down ?? 0.9, sm = D.sm ?? 0.015, c0 = D.c0 ?? 0.01, c1 = D.c1 ?? 0.025, yl0 = eyeY + (D.yl0 ?? 0), yl1 = eyeY + (D.yl1 ?? -0.02);
  const len0 = D.len?.[0] ?? 0.1, len1 = D.len?.[1] ?? 0.18, spread = D.spread ?? 0.3, curl = D.curl ?? 1, C = F.C;
  const rH = (x, z) => { const hx = x - C.x, hz = z - C.z, l = Math.hypot(hx, hz); if (l < 1e-6) return 0; const r = F.rAt ? F.rAt(hx / l, 0, hz / l) : 0; return r > 0 ? l - r : 0; };
  const spk = D.spike ?? [1.6, 0.02], yS = eyeY + (D.y0 ?? -0.03) + 0.01;
  let Cn = new Float64Array(0), Cd = new Float64Array(0), Q = new Float64Array(0), Sq = new Float64Array(0);
  S.strands.forEach((Sd, si) => {
    const n = Sd.b - Sd.a, lw = sstep(len0, len1, Sd.len || 0); if (n < 3 || lw <= 0) return;
    if (Cn.length < n * 3) { Cn = new Float64Array(n * 3); Cd = new Float64Array(n * 3); Q = new Float64Array(n * 3); Sq = new Float64Array(n); }
    // DESPIKE (below the drape's start only): the cards' body push in the BIND pose throws single nodes out of the raised shoulder's volume
    // and back (L12: 920 runs of 3-6.5 cm at eyes - 10..12 cm, x 5 -> 11 -> 7 cm; L06's wire spikes): a node whose two edges are long
    // (> spike[1] m) and fold back (their sum > spike[0] x the chord) goes to the chord's middle; the strand loses the spike's false length
    for (let i = 0; i < n * 3; i++) Q[i] = P0[Sd.a * 3 + i];
    for (let pass = 0; pass < 2; pass++) for (let i = 1; i < n - 1; i++) { const o = i * 3; if (Q[o + 1] > yS) continue;
      const e1 = Math.hypot(Q[o] - Q[o - 3], Q[o + 1] - Q[o - 2], Q[o + 2] - Q[o - 1]), e2 = Math.hypot(Q[o + 3] - Q[o], Q[o + 4] - Q[o + 1], Q[o + 5] - Q[o + 2]), c = Math.hypot(Q[o + 3] - Q[o - 3], Q[o + 4] - Q[o - 2], Q[o + 5] - Q[o - 1]);
      if (Math.max(e1, e2) > spk[1] && e1 + e2 > spk[0] * c) { Q[o] = (Q[o - 3] + Q[o + 3]) / 2; Q[o + 1] = (Q[o - 2] + Q[o + 4]) / 2; Q[o + 2] = (Q[o - 1] + Q[o + 5]) / 2; } }
    Sq[0] = 0; for (let i = 1; i < n; i++) { const o = i * 3; Sq[i] = Sq[i - 1] + Math.hypot(Q[o] - Q[o - 3], Q[o + 1] - Q[o - 2], Q[o + 2] - Q[o - 1]); }
    // the centreline: a tent filter over +-sm of arc, narrowed to the distance to either end (the root and the tip stay where they are)
    const sB = Sq[n - 1];
    for (let i = 0; i < n; i++) { const s0 = Sq[i], w = Math.min(sm, s0, sB - s0); let x = 0, y = 0, z = 0, ws = 0;
      if (w < 1e-4) { x = Q[i * 3]; y = Q[i * 3 + 1]; z = Q[i * 3 + 2]; ws = 1; }
      else { for (let j = i; j >= 0 && s0 - Sq[j] <= w; j--) { const ww = 1 - (s0 - Sq[j]) / w; x += Q[j * 3] * ww; y += Q[j * 3 + 1] * ww; z += Q[j * 3 + 2] * ww; ws += ww; }
        for (let j = i + 1; j < n && Sq[j] - s0 <= w; j++) { const ww = 1 - (Sq[j] - s0) / w; x += Q[j * 3] * ww; y += Q[j * 3 + 1] * ww; z += Q[j * 3 + 2] * ww; ws += ww; } }
      Cn[i * 3] = x / ws; Cn[i * 3 + 1] = y / ws; Cn[i * 3 + 2] = z / ws; }
    // the hanging centreline Cd, root to tip
    const hs = ((Math.imul(si + 1, 2654435761) >>> 0) % 10007) / 10007, latS = lat - spread * hs * hs;
    Cd[0] = Cn[0]; Cd[1] = Cn[1]; Cd[2] = Cn[2]; let w = 0, first = -1;
    for (let i = 1; i < n; i++) { const o = i * 3, p = o - 3; let ex = Cn[o] - Cn[p], ey = Cn[o + 1] - Cn[p + 1], ez = Cn[o + 2] - Cn[p + 2]; const l = Math.hypot(ex, ey, ez);
      const px = Cd[p], py = Cd[p + 1], pz = Cd[p + 2];
      w = Math.max(w, lw * Math.max(sstep(y0, y1, py), sstep(c0, c1, rH(px, pz)) * sstep(yl0, yl1, py)));
      if (w <= 0 || l < 1e-9) { Cd[o] = px + ex; Cd[o + 1] = py + ey; Cd[o + 2] = pz + ez; continue; }
      if (first < 0) first = i;
      ex /= l; ey /= l; ez /= l; const ax = px - ax0, az = pz - az0, al = Math.hypot(ax, az) || 1, rad = Math.max(0, (ex * ax + ez * az) / al) * w * latS;
      ex -= rad * ax / al; ez -= rad * az / al; ey = ey * (1 - w * down) - w * down; const dl = Math.hypot(ex, ey, ez) || 1;
      Cd[o] = px + ex / dl * l; Cd[o + 1] = py + ey / dl * l; Cd[o + 2] = pz + ez / dl * l; }
    if (first < 0) return;   // nothing hangs: the groom exactly
    // the residual (groom - centreline), turned by the centreline's own turn at each node (the minimal rotation t0 -> t1), added back
    for (let i = first; i < n; i++) { const k = Sd.a + i, o = i * 3, ia = Math.max(0, i - 1) * 3, ib = Math.min(n - 1, i + 1) * 3;
      let tx = Cn[ib] - Cn[ia], ty = Cn[ib + 1] - Cn[ia + 1], tz = Cn[ib + 2] - Cn[ia + 2], ux = Cd[ib] - Cd[ia], uy = Cd[ib + 1] - Cd[ia + 1], uz = Cd[ib + 2] - Cd[ia + 2];
      const tl = Math.hypot(tx, ty, tz) || 1, ul = Math.hypot(ux, uy, uz) || 1; tx /= tl; ty /= tl; tz /= tl; ux /= ul; uy /= ul; uz /= ul;
      let rx = (Q[o] - Cn[o]) * curl, ry = (Q[o + 1] - Cn[o + 1]) * curl, rz = (Q[o + 2] - Cn[o + 2]) * curl;
      const c = tx * ux + ty * uy + tz * uz, vx = ty * uz - tz * uy, vy = tz * ux - tx * uz, vz = tx * uy - ty * ux;
      if (c > -0.999) { const f = 1 / (1 + c), d = vx * rx + vy * ry + vz * rz, qx = vy * rz - vz * ry, qy = vz * rx - vx * rz, qz = vx * ry - vy * rx;   // Rodrigues: r c + (v x r) + v (v.r) / (1 + c)
        rx = rx * c + qx + vx * d * f; ry = ry * c + qy + vy * d * f; rz = rz * c + qz + vz * d * f; }
      R[k * 3] = Cd[o] + rx; R[k * 3 + 1] = Cd[o + 1] + ry; R[k * 3 + 2] = Cd[o + 2] + rz; }
  });
  return R;
}

// ---------------------------------------------------------------- guides (the motion bake simulates these; every strand follows them)
// farthest-point sampling over the roots of the strands of minLen or more (bind), then each strand's 3 nearest guides by root distance
// and length (inverse-square weights)
export function pickGuides(S, n = SIM6.guides, minLen = SIM6.minLen) {
  const held = heldOf(S), cand = S.strands.map((s, i) => i).filter(i => S.strands[i].len >= minLen && !held(i)); if (!cand.length) return { guides: [], wts: [] };
  const R = i => S.strands[i].a, d2 = new Float64Array(cand.length).fill(1e9), out = []; let cur = 0;
  // start at the longest strand (it swings most)
  cand.forEach((i, j) => { if (S.strands[i].len > S.strands[cand[cur]].len) cur = j; });
  for (let it = 0; it < Math.min(n, cand.length); it++) { out.push(cand[cur]); const a = R(cand[cur]); let best = -1, bi = 0;
    for (let j = 0; j < cand.length; j++) { const b = R(cand[j]), d = (S.P[a * 3] - S.P[b * 3]) ** 2 + (S.P[a * 3 + 1] - S.P[b * 3 + 1]) ** 2 + (S.P[a * 3 + 2] - S.P[b * 3 + 2]) ** 2 + 0.25 * (S.strands[cand[cur]].len - S.strands[cand[j]].len) ** 2;
      if (d < d2[j]) d2[j] = d; if (d2[j] > best) { best = d2[j]; bi = j; } } cur = bi; }
  return { guides: out };
}
export function guideWeights(S, guides, minLen = SIM6.minLen) {
  const held = heldOf(S);
  const W = []; for (let i = 0; i < S.strands.length; i++) { const Sd = S.strands[i]; if (Sd.len < minLen || held(i)) { W.push(null); continue; } const a = Sd.a, best = [];
    for (let gi = 0; gi < guides.length; gi++) { const G = S.strands[guides[gi]], b = G.a, d = Math.sqrt((S.P[a * 3] - S.P[b * 3]) ** 2 + (S.P[a * 3 + 1] - S.P[b * 3 + 1]) ** 2 + (S.P[a * 3 + 2] - S.P[b * 3 + 2]) ** 2) + 0.3 * Math.abs(G.len - Sd.len);
      if (best.length < 3 || d < best[2][1]) { best.push([gi, d]); best.sort((p, q) => p[1] - q[1]); if (best.length > 3) best.pop(); } }
    const w = best.map(([, d]) => 1 / (d + 0.004) ** 2), ws = w.reduce((p, q) => p + q, 0); W.push(best.map(([gi], j) => [gi, w[j] / ws])); }
  return W;
}

// ---------------------------------------------------------------- the track (.hair6): bind-space guide chain-node offsets per key frame
// header (JSON, length-prefixed): { v: 1, fps, nf, key, guides: [strand index], nodes: [chain node strand-node index per guide chain
// node], ga: [first chain node per guide], q (m per unit), mesh: { verts, strands } } ; then Int16 [nk][nNodes][3]
export function encodeHair6(H, keys) {
  const nn = H.nodes.length; let mx = 0; for (const K of keys) for (let i = 0; i < K.length; i++) mx = Math.max(mx, Math.abs(K[i]));
  const q = Math.max(1e-5, mx / 32000), data = new Int16Array(keys.length * nn * 3); keys.forEach((K, j) => { for (let i = 0; i < nn * 3; i++) data[j * nn * 3 + i] = Math.round(K[i] / q); });
  const head = new TextEncoder().encode(JSON.stringify({ ...H, q, nk: keys.length })), pad = (4 - ((4 + head.length) % 4)) % 4, buf = new ArrayBuffer(4 + head.length + pad + data.byteLength), dv = new DataView(buf);
  dv.setUint32(0, head.length + pad, true); new Uint8Array(buf, 4, head.length).set(head); for (let i = 0; i < pad; i++) new Uint8Array(buf, 4 + head.length + i, 1)[0] = 32;
  new Int16Array(buf, 4 + head.length + pad).set(data); return buf;
}
export function decodeHair6(buf) { const dv = new DataView(buf), hl = dv.getUint32(0, true), H = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl))); return { H, data: new Int16Array(buf, 4 + hl) }; }

// ---------------------------------------------------------------- the page: every strand follows its guides
// P: the same person the track was baked on (makePerson('v5:<name>', { hair: { rev: 6 } }) + settleHair6, so the strands match).
export class HairPlayer6 {
  constructor(P, track) {
    this.P = P; const m = P.groom?.meshes.find(x => x.userData.hairPart === 'scalp' && x.userData.h6); this.m = m; this.T = track; if (!m || !track) return;
    const U = m.userData.h6, S = U.S, H = track.H; this.S = S;
    if (H.mesh && (H.mesh.verts !== m.geometry.attributes.position.count || H.mesh.strands !== S.strands.length)) { this.bad = `hair6 track for ${H.mesh.verts} verts / ${H.mesh.strands} strands, groom has ${m.geometry.attributes.position.count} / ${S.strands.length}`; return; }
    // per strand node: up to 3 (guide chain node index, frac, weight) by arc length on each guide
    const W = guideWeights(S, H.guides), ga = H.ga, nodes = H.nodes, ent = [];
    const gS = H.guides.map((gi, j) => { const a = ga[j], b = j + 1 < ga.length ? ga[j + 1] : nodes.length; return { a, b, s: nodes.slice(a, b).map(k => S.s[k]) }; });
    this.idx = new Int32Array(S.N * 3).fill(-1); this.fr = new Float32Array(S.N * 3); this.w = new Float32Array(S.N * 3);
    for (let i = 0; i < S.strands.length; i++) { const wi = W[i]; if (!wi) continue; const Sd = S.strands[i];
      for (let k = Sd.a; k < Sd.b; k++) { const s = S.s[k] - S.s[Sd.a]; wi.forEach(([gj, w], e) => { const G = gS[gj]; let q = 0; while (q + 1 < G.s.length - 1 && G.s[q + 1] - G.s[0] < s) q++;
        const s0 = G.s[q] - G.s[0], s1 = (G.s[Math.min(q + 1, G.s.length - 1)] - G.s[0]), f = s1 > s0 ? Math.max(0, Math.min(1, (s - s0) / (s1 - s0))) : 0;
        this.idx[k * 3 + e] = G.a + q; this.fr[k * 3 + e] = f; this.w[k * 3 + e] = w; }); } }
    void ent; this.D = new Float64Array(S.N * 3); this.nn = nodes.length; this.lastG = new Int32Array(this.nn).fill(0);
    this.X0 = Float32Array.from(m.geometry.attributes.position.array); this.T0 = Float32Array.from(m.geometry.attributes.aHairT.array);
  }
  apply(t) { if (!this.m || this.bad) return; const H = this.T.H, data = this.T.data, nn = this.nn, fr = Math.max(0, Math.min(H.nf - 1, t * H.fps)), kf = fr / H.key, ka = Math.min(H.nk - 1, Math.floor(kf)), kb = Math.min(H.nk - 1, ka + 1), wk = kf - ka, q = H.q;
    const Gd = this._Gd || (this._Gd = new Float64Array(nn * 3)); for (let i = 0; i < nn * 3; i++) Gd[i] = q * ((1 - wk) * data[ka * nn * 3 + i] + wk * data[kb * nn * 3 + i]);
    const D = this.D, I = this.idx, F = this.fr, Wt = this.w, S = this.S; D.fill(0);
    for (let k = 0; k < S.N; k++) for (let e = 0; e < 3; e++) { const g = I[k * 3 + e]; if (g < 0) continue; const f = F[k * 3 + e], w = Wt[k * 3 + e], g1 = Math.min(nn - 1, g + (f > 0 ? 1 : 0));
      for (let j = 0; j < 3; j++) D[k * 3 + j] += w * (Gd[g * 3 + j] * (1 - f) + Gd[g1 * 3 + j] * f); }
    applyNodeOffsets(S, D, { X0: this.X0, T0: this.T0 }); hair6Frame(this.P, fr); return fr; }
}

// the hair's stochastic coverage pattern decorrelated per frame (shade.js rev 6 h6E.w): call per frame with the frame number
export function hair6Frame(P, fr) { for (const m of P.groom?.meshes || []) { const U = m.material?.userData?.hairU; if (U?.h6E) U.h6E.value.w = (Math.round(fr) * 0.6180339) % 1; } }
// the integrator's seam (hair rev 6 in a person's motion): the guide track of <name> for <clip> (assets/hair/motion6/<clip>/<name>.hair6,
// hair6_bake.mjs) as a player, or null when there is none (the settled hair then holds still). Call after settleHair6(P).
export async function attachHair6(P, name, clip, { url = null } = {}) {
  const u = url || new URL(`../../../assets/hair/motion6/${clip}/${name}.hair6`, import.meta.url).href;
  try { const r = await fetch(u); if (!r.ok) return null; const pl = new HairPlayer6(P, decodeHair6(await r.arrayBuffer())); return pl.bad ? null : pl; } catch { return null; }
}
