// HAIR / field: the head as ground to grow hair on (HUMAN c8 lane D). Everything here is in the hero's BIND space (the space
// h.body.geometry's positions live in, before h.group's scale), so it serves every hero variant and survives every pose: a card
// is skinned with the weights of the skin it grows from, so it follows the head, the jaw and the lids as the skin does.
//
//   const F = headField(h);              // once per hero (about 60-120 ms in node)
//   F.cast(dir) -> { r, tri, b1, b2 }    // the outermost head / jaw / neck surface along a ray from the skull centre
//   F.surf(tri, b1, b2) -> { p, n, si, sw }   // a point ON the mesh: position, normal, 4 bone indices and weights
//   F.push(p, off)                       // move p out of the skull, the neck and the shoulders to `off` metres above them
//   F.hat                                // the inner volume of h.hatGroup (hero.js / CLOTHING's hat, read only) or null
//   F.lids, F.brow, F.zones              // lid margins (for lashes), the brow line, the beard zone
//
// How the surface is found: a CUBE-MAP RAY RASTER about the skull centre. Every head, jaw and neck triangle is projected onto the
// six faces of a cube round the centre (gnomonic projection keeps triangles triangles, so there is no pole at the crown, the
// problem a latitude-longitude map has exactly where hair grows) and each cell keeps the outermost ray hit (Moller and Trumbore
// 1997, exact barycentrics), so a root sampled in a cell lies on the real mesh and carries that triangle's skin weights and
// expression morph deltas. hm08's body is a closed surface (the eye sockets are tubes into the head, no boundary edges), so the
// lid margin is found the way it is seen: a front orthographic depth raster of the skin against the eyeball sphere; the margin is
// where the lid starts to cover the globe.
import * as THREE from 'three';

export const REG = { head: 0, neck: 1, torso: 2, uarm: 3, farm: 4, hand: 5, finger: 6, pelvis: 7, thigh: 8, shin: 9, foot: 10, jaw: 11 };
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
export function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// cube faces: major axis, then the two in-face axes (u, v)
const FACE = [[0, 2, 1, 1], [0, 2, 1, -1], [1, 0, 2, 1], [1, 0, 2, -1], [2, 0, 1, 1], [2, 0, 1, -1]];   // [major, a, b, sign]
function dirFace(d) {
  const ax = Math.abs(d[0]), ay = Math.abs(d[1]), az = Math.abs(d[2]);
  const f = ax >= ay && ax >= az ? (d[0] > 0 ? 0 : 1) : ay >= az ? (d[1] > 0 ? 2 : 3) : (d[2] > 0 ? 4 : 5);
  const [m, a, b] = FACE[f], w = Math.abs(d[m]);
  return [f, d[a] / w, d[b] / w];
}
export function faceDir(f, u, v, out) { const [m, a, b, s] = FACE[f]; out[m] = s; out[a] = u; out[b] = v; const l = Math.hypot(out[0], out[1], out[2]); out[0] /= l; out[1] /= l; out[2] /= l; return out; }

// Moller-Trumbore from origin o along d (unit); returns [t, b1, b2] or null (b1, b2: weights of vertices 1 and 2)
function rayTri(o, d, A, B, C, eps = 1e-4) {
  const e1x = B[0] - A[0], e1y = B[1] - A[1], e1z = B[2] - A[2], e2x = C[0] - A[0], e2y = C[1] - A[1], e2z = C[2] - A[2];
  const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x, det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det, tx = o[0] - A[0], ty = o[1] - A[1], tz = o[2] - A[2], u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -eps || u > 1 + eps) return null;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
  if (v < -eps || u + v > 1 + eps) return null;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 0 ? [t, u, v] : null;
}

export function headField(h, { N = 128 } = {}) {
  if (h._hairField && h._hairField.N === N) return h._hairField;
  const g = h.body.geometry, P = g.attributes.position.array, NR = h.nrm, AH = h.aHero, IDX = g.index.array, n = h.meta.n;
  const SI = g.attributes.skinIndex.array, SW = g.attributes.skinWeight.array, I = h.idx;
  const eL = h.eyeL, eR = h.eyeR, eyeY = (eL.y + eR.y) / 2, hc = h.head0[I.head];
  const reg = v => AH[v * 4];
  // the cranium: its top, and its width and depth at the temples (head-region vertices within 1 cm of a level)
  let top = -1e9; for (let v = 0; v < n; v++) if (reg(v) === REG.head) top = Math.max(top, P[v * 3 + 1]);
  const slice = y => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (let v = 0; v < n; v++) { if (reg(v) !== REG.head || Math.abs(P[v * 3 + 1] - y) > 0.01) continue;
    x0 = Math.min(x0, P[v * 3]); x1 = Math.max(x1, P[v * 3]); z0 = Math.min(z0, P[v * 3 + 2]); z1 = Math.max(z1, P[v * 3 + 2]); } return { rx: (x1 - x0) / 2, rz: (z1 - z0) / 2, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, z0, z1 }; };
  const s0 = slice(eyeY + 0.045);
  const C = V(0, eyeY + 0.03, s0.cz - 0.004);                                   // a little behind the middle: the face is not cranium
  const rx = s0.rx * 0.93, rz = s0.rz, ry = top - C.y;                          // (rx without the ears' stand-off)
  // ---------------------------------------------------------------- the cube-map ray raster (head, jaw, neck)
  const NC = 6 * N * N, R = new Float32Array(NC), TRI = new Int32Array(NC).fill(-1), BB = new Float32Array(NC * 2);
  const o = [C.x, C.y, C.z], d = [0, 0, 0], A = [0, 0, 0], B = [0, 0, 0], Cc = [0, 0, 0];
  const okReg = r => r === REG.head || r === REG.jaw || r === REG.neck;
  const rel = new Float32Array(n * 3); for (let v = 0; v < n; v++) { rel[v * 3] = P[v * 3] - C.x; rel[v * 3 + 1] = P[v * 3 + 1] - C.y; rel[v * 3 + 2] = P[v * 3 + 2] - C.z; }
  for (let t = 0; t < IDX.length; t += 3) {
    const a = IDX[t], b = IDX[t + 1], c = IDX[t + 2];
    if (!okReg(reg(a)) || !okReg(reg(b)) || !okReg(reg(c))) continue;
    for (let k = 0; k < 3; k++) { A[k] = P[a * 3 + k]; B[k] = P[b * 3 + k]; Cc[k] = P[c * 3 + k]; }
    for (let f = 0; f < 6; f++) {
      const [m, fa, fb, s] = FACE[f]; let ok = true, u0 = 9, u1 = -9, v0 = 9, v1 = -9;
      for (const vv of [a, b, c]) { const w = rel[vv * 3 + m] * s; if (w <= 1e-5) { ok = false; break; } const u = rel[vv * 3 + fa] / w, v = rel[vv * 3 + fb] / w; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
      if (!ok || u1 < -1 || u0 > 1 || v1 < -1 || v0 > 1) continue;
      const i0 = Math.max(0, Math.floor((u0 + 1) / 2 * N - 0.5)), i1 = Math.min(N - 1, Math.ceil((u1 + 1) / 2 * N - 0.5)), j0 = Math.max(0, Math.floor((v0 + 1) / 2 * N - 0.5)), j1 = Math.min(N - 1, Math.ceil((v1 + 1) / 2 * N - 0.5));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        faceDir(f, (i + 0.5) / N * 2 - 1, (j + 0.5) / N * 2 - 1, d);
        const hit = rayTri(o, d, A, B, Cc, 0.002); if (!hit) continue;
        const ci = (f * N + j) * N + i; if (hit[0] > R[ci]) { R[ci] = hit[0]; TRI[ci] = t; BB[ci * 2] = hit[1]; BB[ci * 2 + 1] = hit[2]; }
      }
    }
  }
  // holes (a cell between triangle centres that no ray hit, a few under the chin): take the neighbours' outermost
  for (let pass = 0; pass < 2; pass++) for (let f = 0; f < 6; f++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const ci = (f * N + j) * N + i; if (R[ci] > 0) continue;
    let best = -1; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue; const cj = (f * N + jj) * N + ii; if (R[cj] > 0 && (best < 0 || R[cj] > R[best])) best = cj; }
    if (best >= 0) { R[ci] = R[best]; TRI[ci] = TRI[best]; BB[ci * 2] = BB[best * 2]; BB[ci * 2 + 1] = BB[best * 2 + 1]; } }
  const cellOf = (dx, dy, dz) => { const [f, u, v] = dirFace([dx, dy, dz]); const i = clamp(Math.floor((u + 1) / 2 * N), 0, N - 1), j = clamp(Math.floor((v + 1) / 2 * N), 0, N - 1); return (f * N + j) * N + i; };
  // radius along a direction, bilinear within the face (a smooth collision surface); 0 where nothing was hit
  const rAt = (dx, dy, dz) => { const [f, u, v] = dirFace([dx, dy, dz]); const x = clamp((u + 1) / 2 * N - 0.5, 0, N - 1.001), y = clamp((v + 1) / 2 * N - 0.5, 0, N - 1.001), i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const c = (ii, jj) => R[(f * N + jj) * N + ii]; const r00 = c(i, j), r10 = c(i + 1, j), r01 = c(i, j + 1), r11 = c(i + 1, j + 1);
    if (!(r00 > 0 && r10 > 0 && r01 > 0 && r11 > 0)) return Math.max(r00, r10, r01, r11);
    return (r00 * (1 - fx) + r10 * fx) * (1 - fy) + (r01 * (1 - fx) + r11 * fx) * fy; };
  // ---------------------------------------------------------------- points on the mesh
  const surf = (tri, b1, b2) => {
    const a = IDX[tri], b = IDX[tri + 1], c = IDX[tri + 2], b0 = 1 - b1 - b2, p = V(), nn = V();
    for (const [vv, w] of [[a, b0], [b, b1], [c, b2]]) { p.x += P[vv * 3] * w; p.y += P[vv * 3 + 1] * w; p.z += P[vv * 3 + 2] * w; nn.x += NR[vv * 3] * w; nn.y += NR[vv * 3 + 1] * w; nn.z += NR[vv * 3 + 2] * w; }
    nn.normalize();
    const acc = new Map(); for (const [vv, w] of [[a, b0], [b, b1], [c, b2]]) for (let k = 0; k < 4; k++) { const bw = SW[vv * 4 + k] * w; if (bw > 0) acc.set(SI[vv * 4 + k], (acc.get(SI[vv * 4 + k]) || 0) + bw); }
    const top4 = [...acc.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4), s = top4.reduce((q, e) => q + e[1], 0) || 1;
    const si = [0, 0, 0, 0], sw = [0, 0, 0, 0]; top4.forEach((e, k) => { si[k] = e[0]; sw[k] = e[1] / s; });
    return { p, n: nn, si, sw, tri, b1, b2, verts: [a, b, c], bw: [b0, b1, b2] };
  };
  // the morph deltas of a mesh point (for face cards: brows, lashes, beard follow h.expr)
  const MA = g.morphAttributes.position || [];
  const morphAt = sp => MA.map(m => { const M = m.array; let x = 0, y = 0, z = 0; sp.verts.forEach((vv, k) => { const w = sp.bw[k]; x += M[vv * 3] * w; y += M[vv * 3 + 1] * w; z += M[vv * 3 + 2] * w; }); return [x, y, z]; });
  // cast a ray from the centre: the outermost surface point
  const cast = (dx, dy, dz) => { const l = Math.hypot(dx, dy, dz), dd = [dx / l, dy / l, dz / l], ci = cellOf(dd[0], dd[1], dd[2]); const t = TRI[ci]; if (t < 0) return null;
    for (let k = 0; k < 3; k++) { A[k] = P[IDX[t] * 3 + k]; B[k] = P[IDX[t + 1] * 3 + k]; Cc[k] = P[IDX[t + 2] * 3 + k]; }
    const hit = rayTri(o, dd, A, B, Cc, 0.5); if (hit) { const b1 = clamp(hit[1], 0, 1), b2 = clamp(hit[2], 0, 1 - b1); return { r: hit[0], tri: t, b1, b2 }; }
    return { r: R[ci], tri: t, b1: BB[ci * 2], b2: BB[ci * 2 + 1] }; };

  // ---------------------------------------------------------------- the ears (no roots on them), from the raster's own bumps
  // an ear stands 1-2.5 cm off the skull: compare each cell's radius with a wide box blur of the radii in the same face
  const EAR = new Uint8Array(NC);
  { const Rb = new Float32Array(NC), K = Math.round(N * 0.12);
    for (let f = 0; f < 6; f++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { let s = 0, c = 0; for (let jj = Math.max(0, j - K); jj <= Math.min(N - 1, j + K); jj += 2) for (let ii = Math.max(0, i - K); ii <= Math.min(N - 1, i + K); ii += 2) { const r = R[(f * N + jj) * N + ii]; if (r > 0) { s += r; c++; } } Rb[(f * N + j) * N + i] = c ? s / c : 0; }
    const dd = [0, 0, 0];
    for (let f = 0; f < 6; f++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const ci = (f * N + j) * N + i; faceDir(f, (i + 0.5) / N * 2 - 1, (j + 0.5) / N * 2 - 1, dd);
      const r = R[ci], x = C.x + dd[0] * r, y = C.y + dd[1] * r, z = C.z + dd[2] * r;
      if (Math.abs(x) > rx * 0.7 && y < eyeY + 0.045 && y > eyeY - 0.075 && z < eL.z - 0.03 && r > Rb[ci] + 0.006) EAR[ci] = 1; }
    // dilate by ~5 mm so the hairline clears the ear's rim
    const dil = Math.max(1, Math.round(N * 0.035)); const E2 = EAR.slice();
    for (let f = 0; f < 6; f++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { if (!EAR[(f * N + j) * N + i]) continue; for (let jj = Math.max(0, j - dil); jj <= Math.min(N - 1, j + dil); jj++) for (let ii = Math.max(0, i - dil); ii <= Math.min(N - 1, i + dil); ii++) E2[(f * N + jj) * N + ii] = 1; }
    EAR.set(E2); }
  // the ear's extent (azimuth from the front, heights): the hairline curves round it
  let earF = Math.PI, earB = 0, earTop = -1e9, earBot = 1e9;
  { const dd = [0, 0, 0]; for (let f = 0; f < 6; f++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const ci = (f * N + j) * N + i; if (!EAR[ci]) continue; faceDir(f, (i + 0.5) / N * 2 - 1, (j + 0.5) / N * 2 - 1, dd);
    const r = R[ci], x = dd[0] * r, y = C.y + dd[1] * r, z = dd[2] * r, ph = Math.abs(Math.atan2(x, z)); earF = Math.min(earF, ph); earB = Math.max(earB, ph); earTop = Math.max(earTop, y); earBot = Math.min(earBot, y); } }
  if (earF > earB) { earF = 1.35; earB = 1.95; earTop = eyeY + 0.02; earBot = eyeY - 0.045; }

  // ---------------------------------------------------------------- the neck and shoulders: a cylinder profile about the neck's axis
  // max radius of torso / neck / shoulder-cap vertices per (height, azimuth); long hair, tails and braids rest on it
  const nk = h.head0[I.neck01], shY = h.head0[I['upperarm01.L']].y, NY = 90, NP = 48, y0b = nk.y - 0.42, dyb = 0.005, BR = new Float32Array(NY * NP);
  const axZ = nk.z;
  for (let v = 0; v < n; v++) { const r = reg(v), y = P[v * 3 + 1]; if (y < y0b || y > C.y) continue;
    if (!(r === REG.torso || r === REG.neck || r === REG.pelvis || (r === REG.uarm && y > shY - 0.06) || ((r === REG.head || r === REG.jaw) && y < eyeY - 0.03))) continue;
    const x = P[v * 3], z = P[v * 3 + 2] - axZ, yi = Math.floor((y - y0b) / dyb); if (yi < 0 || yi >= NY) continue;
    const pi = Math.floor((Math.atan2(x, z) / (2 * Math.PI) + 0.5) * NP) % NP, rr = Math.hypot(x, z); if (rr > BR[yi * NP + pi]) BR[yi * NP + pi] = rr; }
  // close gaps between rows and azimuths (a max over the neighbours: the profile is an envelope)
  { const T = BR.slice(); for (let yi = 0; yi < NY; yi++) for (let pi = 0; pi < NP; pi++) { let m = 0; for (let dy = -1; dy <= 1; dy++) for (let dp = -1; dp <= 1; dp++) { const y2 = yi + dy; if (y2 < 0 || y2 >= NY) continue; m = Math.max(m, T[y2 * NP + (pi + dp + NP) % NP]); } BR[yi * NP + pi] = m; } }
  const bodyR = (x, y, z) => { const yi = Math.floor((y - y0b) / dyb); if (yi < 0 || yi >= NY) return 0; const pi = Math.floor((Math.atan2(x, z - axZ) / (2 * Math.PI) + 0.5) * NP) % NP; return BR[yi * NP + pi]; };

  // ---------------------------------------------------------------- push out of the head and body
  // the skull test runs above the jaw's lower edge only (below it the neck profile takes over)
  const chinY = h.mouth.y - 0.05, tmp = V();
  const push = (p, off = 0.002) => {
    const dx = p.x - C.x, dy = p.y - C.y, dz = p.z - C.z, l = Math.hypot(dx, dy, dz);
    if (l > 1e-6 && p.y > chinY - 0.02) { const r = rAt(dx / l, dy / l, dz / l); if (r > 0 && l < r + off) { const k = (r + off) / l; p.set(C.x + dx * k, C.y + dy * k, C.z + dz * k); } }
    if (p.y < eyeY - 0.02) { const br = bodyR(p.x, p.y, p.z), x = p.x, z = p.z - axZ, l2 = Math.hypot(x, z); if (br > 0 && l2 < br + off) { const k = (br + off) / Math.max(l2, 1e-6); p.x = x * k; p.z = axZ + z * k; } }
    return p;
  };
  const inside = (p, off = 0) => { const dx = p.x - C.x, dy = p.y - C.y, dz = p.z - C.z, l = Math.hypot(dx, dy, dz); if (p.y > chinY - 0.02) { const r = rAt(dx / l, dy / l, dz / l); if (r > 0 && l < r + off) return true; }
    if (p.y < eyeY - 0.02) { const br = bodyR(p.x, p.y, p.z); if (br > 0 && Math.hypot(p.x, p.z - axZ) < br + off) return true; } return false; };

  // head units <-> bind space: a style's points are written relative to the skull (x / rx, (y - C.y) / ry, (z - C.z) / rz)
  const fromHU = (a, out = V()) => out.set(C.x + a[0] * rx, C.y + a[1] * ry, C.z + a[2] * rz);
  const toHU = p => [(p.x - C.x) / rx, (p.y - C.y) / ry, (p.z - C.z) / rz];
  // project a head-unit direction onto the scalp: the surface point along the ray from the centre through it
  const onScalp = (a, off = 0.003) => { const q = fromHU(a), dd = q.clone().sub(C).normalize(), r = rAt(dd.x, dd.y, dd.z) || Math.hypot(rx, rz); return C.clone().addScaledVector(dd, r + off); };

  const F = { h, N, C, rx, ry, rz, top, eyeY, eL, eR, hc, mouth: h.mouth, chinY, earF, earB, earTop, earBot, R, TRI, BB, EAR, cellOf, rAt, cast, surf, morphAt, push, inside, bodyR, fromHU, toHU, onScalp,
    faceDir, sex: h.sex, nk, axZ, shY };
  F.hat = hatVolume(h, F);
  F.lids = lidMargins(h, F);
  h._hairField = F;
  return F;
}

// ---------------------------------------------------------------- the hat's inner volume (hero.js _hat, read only)
// Every mesh under h.hatGroup is put back into bind space (the group sits in the head bone's frame, offset by -head; in bind the head
// bone has no rotation), then binned by height and azimuth about the skull's vertical axis: the MINIMUM radius of all hat surfaces
// in a bin is the inside of the crown, the suspension band or the beanie's cuff. Hair above the hat's lowest edge is kept inside it;
// below the edge (temples, nape, a tail) it hangs free.
function hatVolume(h, F) {
  const hg = h.hatGroup; if (!hg) return null;
  const hc = h.head0[h.idx.head], NYH = 120, NPH = 32, y0 = F.eyeY - 0.03, dy = 0.002, RM = new Float32Array(NYH * NPH).fill(1e9), RIM = new Float32Array(NPH).fill(1e9);
  let topY = -1e9; const v = V(), M = new THREE.Matrix4(), T = new THREE.Matrix4().makeTranslation(hc.x, hc.y, hc.z);
  hg.updateMatrix(); const meshes = []; hg.traverse(m => { if (m.isMesh) meshes.push(m); });
  const pts = [];
  for (const m of meshes) { m.updateMatrix(); M.copy(T).multiply(hg.matrix); const chain = []; let q = m; while (q && q !== hg) { chain.unshift(q); q = q.parent; } for (const c of chain) { c.updateMatrix(); M.multiply(c.matrix); }
    const pa = m.geometry.attributes.position; for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i).applyMatrix4(M); pts.push(v.x, v.y, v.z); } }
  // the crown's radius at the band: points further out than the skull + 4 cm are brim / peak / bill, not the crown
  for (let k = 0; k < pts.length; k += 3) { const x = pts[k] - F.C.x, y = pts[k + 1], z = pts[k + 2] - F.C.z, r = Math.hypot(x, z), ph = Math.atan2(x, z);
    const sk = Math.hypot(F.rx * Math.sin(ph), F.rz * Math.cos(ph)); if (r > sk + 0.045) continue;
    const yi = Math.floor((y - y0) / dy), pi = Math.floor((ph / (2 * Math.PI) + 0.5) * NPH) % NPH;
    if (yi >= 0 && yi < NYH) RM[yi * NPH + pi] = Math.min(RM[yi * NPH + pi], r);
    RIM[pi] = Math.min(RIM[pi], y); topY = Math.max(topY, y); }
  // azimuth bins no vertex fell in (a lathe of 36 segments): the rim from the nearest filled neighbour
  for (let it = 0; it < NPH; it++) { let done = true; for (let pi = 0; pi < NPH; pi++) if (RIM[pi] > 1e8) { const a = RIM[(pi + 1) % NPH], b = RIM[(pi + NPH - 1) % NPH], m = Math.min(a, b); if (m < 1e8) RIM[pi] = m; else done = false; } if (done) break; }
  // fill empty bins between the rim and the top by the nearest row below (a crown's sides are sparse in height at the lathe's steps)
  for (let pi = 0; pi < NPH; pi++) { let last = 1e9; for (let yi = 0; yi < NYH; yi++) { const y = y0 + yi * dy; if (y < RIM[pi]) continue; const k = yi * NPH + pi; if (RM[k] < 1e8) last = RM[k]; else if (y < topY) RM[k] = last; } }
  // smooth across azimuth (the lathe has 40-64 segments; bins without a vertex take their neighbours)
  { const T2 = RM.slice(); for (let yi = 0; yi < NYH; yi++) for (let pi = 0; pi < NPH; pi++) { let m = T2[yi * NPH + pi]; for (const dp of [-1, 1]) m = Math.min(m, T2[yi * NPH + (pi + dp + NPH) % NPH] + 0.002); RM[yi * NPH + pi] = m; } }
  const hat = { kind: h.o.hat, topY, RIM, RM, y0, dy, NYH, NPH,
    // compress p into the hat (margin: how far inside the shell hair stops); returns true when it moved
    clamp(p, margin = 0.003) {
      const x = p.x - F.C.x, z = p.z - F.C.z, ph = Math.atan2(x, z), pi = Math.floor((ph / (2 * Math.PI) + 0.5) * NPH) % NPH;
      if (p.y < RIM[pi] - 0.001) return false;
      let moved = false;
      if (p.y > topY - margin - 0.004) { p.y = topY - margin - 0.004; moved = true; }
      const yi = Math.floor((p.y - y0) / dy); const rm = yi >= 0 && yi < NYH ? RM[yi * NPH + pi] : 1e9;
      if (rm < 1e8) { const r = Math.hypot(x, z), lim = rm - margin; if (r > lim) { const k = Math.max(lim, 0.001) / r; p.x = F.C.x + x * k; p.z = F.C.z + z * k; moved = true; } }
      return moved; },
    rimAt(ph) { return RIM[Math.floor((ph / (2 * Math.PI) + 0.5) * NPH) % NPH]; } };
  return hat;
}

// ---------------------------------------------------------------- lid margins (front orthographic depth raster per eye)
// For each column across the eye: the skin's front depth zs(x, y) against the eyeball's zb(x, y) = c.z + sqrt(R^2 - rho^2). The
// palpebral fissure is where the globe is in front of the skin; its upper and lower edges are the lid margins. The margin point
// is the skin there (the lid's edge), with the skin's triangle, so lashes carry the lid's skin weights and the eye-slit morphs.
function lidMargins(h, F) {
  const g = h.body.geometry, P = g.attributes.position.array, IDX = g.index.array, AH = h.aHero, EP = h.eyes.geometry.attributes.position.array, out = {};
  for (const [side, c] of [['L', h.eyeL], ['R', h.eyeR]]) {
    let Rg = 0, cnt = 0; for (let k = 0; k < EP.length / 3; k++) { if (Math.sign(EP[k * 3]) !== Math.sign(c.x)) continue; Rg += Math.hypot(EP[k * 3] - c.x, EP[k * 3 + 1] - c.y, EP[k * 3 + 2] - c.z); cnt++; } Rg /= cnt;
    const res = 0.0002, W = 0.036, Hh = 0.03, nx = Math.round(W / res), ny = Math.round(Hh / res), x0 = c.x - W / 2, y0 = c.y - Hh / 2;
    const ZS = new Float32Array(nx * ny).fill(-1e9), TS = new Int32Array(nx * ny).fill(-1), B1 = new Float32Array(nx * ny), B2 = new Float32Array(nx * ny);
    for (let t = 0; t < IDX.length; t += 3) { const a = IDX[t], b = IDX[t + 1], cc = IDX[t + 2];
      if (AH[a * 4] !== REG.head) continue;
      const ax = P[a * 3], ay = P[a * 3 + 1], bx = P[b * 3], by = P[b * 3 + 1], cx = P[cc * 3], cy = P[cc * 3 + 1];
      const mnx = Math.min(ax, bx, cx), mxx = Math.max(ax, bx, cx), mny = Math.min(ay, by, cy), mxy = Math.max(ay, by, cy);
      if (mxx < x0 || mnx > x0 + W || mxy < y0 || mny > y0 + Hh) continue;
      const az = P[a * 3 + 2], bz = P[b * 3 + 2], cz = P[cc * 3 + 2]; if (Math.max(az, bz, cz) < c.z - 0.004) continue;
      const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(den) < 1e-14) continue;
      const i0 = Math.max(0, Math.floor((mnx - x0) / res)), i1 = Math.min(nx - 1, Math.ceil((mxx - x0) / res)), j0 = Math.max(0, Math.floor((mny - y0) / res)), j1 = Math.min(ny - 1, Math.ceil((mxy - y0) / res));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const x = x0 + (i + 0.5) * res, y = y0 + (j + 0.5) * res;
        const w0 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den, w1 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den, w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue; const z = w0 * az + w1 * bz + w2 * cz, k = j * nx + i;
        if (z > ZS[k]) { ZS[k] = z; TS[k] = t; B1[k] = w1; B2[k] = w2; } } }
    // per column: the open fissure rows (globe in front of the skin by > 0.15 mm)
    const up = [], lo = [];
    for (let i = 0; i < nx; i++) { const x = x0 + (i + 0.5) * res, dx = x - c.x; if (Math.abs(dx) > Rg) continue; let jt = -1, jb = -1;
      for (let j = 0; j < ny; j++) { const y = y0 + (j + 0.5) * res, rho2 = dx * dx + (y - c.y) * (y - c.y); if (rho2 > Rg * Rg) continue; const zb = c.z + Math.sqrt(Rg * Rg - rho2), k = j * nx + i;
        if (zb > ZS[k] + 0.00015) { if (jb < 0) jb = j; jt = j; } }
      if (jt < 0 || jt - jb < 3) continue;
      // the margin: the first skin row just outside the open span (with its triangle)
      const pick = j => { const k = j * nx + i; return TS[k] >= 0 ? { x, y: y0 + (j + 0.5) * res, z: ZS[k], tri: TS[k], b1: B1[k], b2: B2[k] } : null; };
      const a = pick(Math.min(ny - 1, jt + 1)), b = pick(Math.max(0, jb - 1)); if (a) up.push(a); if (b) lo.push(b); }
    // the canthi: the first and last open columns; keep the margin points in medial -> lateral order
    const order = arr => arr.sort((p, q) => Math.abs(p.x) - Math.abs(q.x));
    out[side] = { c, R: Rg, upper: order(up), lower: order(lo) };
  }
  return out;
}
