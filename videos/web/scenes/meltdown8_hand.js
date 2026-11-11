// MELTDOWN v9: the worker's hand. A real right hand and forearm in a rolled work-shirt sleeve, built once at load.
//   skinD(): an anatomical signed-distance field (palm, thenar, hypothenar, metacarpal heads, fifteen phalanges with
//   pads and knobbed joints, nail beds, extensor tendons, dorsal and forearm veins, wrist tendons and styloid, a
//   muscled forearm); sleeveD(): the rolled chambray sleeve (a double roll, folds, a felled seam). Each is meshed by
//   surface nets on a narrow band, with per-vertex bones, rest-pose occlusion and thickness. The fine skin (palm and
//   joint creases, knuckle wrinkles, prints, nails, the scar, calluses, pores, hair, grease) is drawn per fragment
//   from the rest position (HAND_FS). Poses are dual-quaternion skinned on 17 bones; contact shadows and occlusion
//   come from 19 posed capsules per vertex.
// Built locally for this scene: the shared crowd-figure module draws whole bodies (mitten hands at crowd scale); this is one hand at
// full frame. Rest space: palm +z, fingers +y, thumb toward +x (a right hand, palm to camera), unit = palm width
// (about 8.5 cm), wrist crease at y = 0, forearm down -y. Bones: 0 palm (root), 1..12 fingers (pinky..index x
// proximal, middle, distal), 13..15 thumb (metacarpal, proximal, distal), 16 forearm (pivots at the wrist).
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
const smin = (a, b, k) => { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return b + (a - b) * h - k * h * (1 - h); };
const smax = (a, b, k) => -smin(-a, -b, k);
const nrm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

// ------------------------------------------------------------------ skeleton (rest pose)
// fingers pinky..index: MCP joint centre, phalanx lengths (joint to joint; the last to the tip centre), radii at
// MCP / PIP / DIP / tip, rest splay (rad, about +z)
export const FINGERS = [
  { x: -0.36, y: 0.965, z: -0.012, len: [0.37, 0.235, 0.205], r: [0.102, 0.091, 0.08, 0.066], s: -0.17 },
  { x: -0.123, y: 1.07, z: -0.012, len: [0.46, 0.29, 0.23], r: [0.113, 0.101, 0.088, 0.072], s: -0.055 },
  { x: 0.123, y: 1.1, z: -0.012, len: [0.5, 0.31, 0.24], r: [0.118, 0.105, 0.091, 0.075], s: 0.02 },
  { x: 0.36, y: 1.04, z: -0.012, len: [0.46, 0.28, 0.225], r: [0.115, 0.101, 0.088, 0.072], s: 0.11 },
];
for (const f of FINGERS) {
  f.cs = Math.cos(f.s); f.sn = Math.sin(f.s); f.Y1 = f.len[0]; f.Y2 = f.len[0] + f.len[1]; f.Y3 = f.Y2 + f.len[2];
  f.J = [0, f.Y1, f.Y2, f.Y3].map(a => [f.x + f.sn * a, f.y + f.cs * a, f.z]);
}
// thumb: CMC, segment lengths, radii at CMC / MCP / IP / tip; direction keys for q = 0 (open, the rest pose), 1 (cupped), 2 (fist)
export const THUMB = { base: [0.27, 0.21, 0.05], len: [0.5, 0.34, 0.285], r: [0.15, 0.13, 0.12, 0.101],
  dirs: [[[0.6, 0.72, 0.34], [0.5, 0.81, 0.3], [0.4, 0.87, 0.28]],
    [[0.47, 0.7, 0.54], [0.12, 0.74, 0.66], [-0.22, 0.6, 0.77]],
    [[0.325, 0.718, 0.615], [-0.22, 0.7, 0.68], [-0.9, 0.22, 0.38]]].map(k => k.map(nrm)) };
{ const T = THUMB.dirs[0]; let P = THUMB.base; THUMB.J = [P];
  for (let j = 0; j < 3; j++) { P = add(P, mul(T[j], THUMB.len[j])); THUMB.J.push(P); }
  // the thumbnail faces out and back: dorsal direction of each segment in the rest pose
  THUMB.D = T.map(t => { const d0 = [0.78, -0.32, -0.52], k = dot(d0, t); return nrm(sub(d0, mul(t, k))); });
  THUMB.X = T.map((t, j) => cross(t, THUMB.D[j])); }
export const WRIST = [0.02, -0.03, -0.01];
export const NB = 17;
export const boneOf = (c, j) => c < 4 ? 1 + c * 3 + j : 13 + j;

// ------------------------------------------------------------------ poses
// q in [0, 2]: 0 the open receiving hand (a little curl, fingers spread), 1 cupped round the light, 2 the fist.
const FLEX = [[0.1, 0.13, 0.07], [0.72, 0.98, 0.55], [1.56, 1.9, 1.3]];
const FLEX_F = [[1.35, 1.15, 1, 0.75], [1.1, 1.05, 1, 0.95], [1.02, 1, 1, 0.98]];   // pinky curls first, index last
const SPLAY = [1.18, 0.45, -0.3];
const lerpA = (A, q) => { const k = Math.min(A.length - 2, Math.floor(q)), u = q - k; return [A[k], A[k + 1], u]; };
function rotX(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; }
function rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
const mm = (A, B) => { const o = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]; return o; };
const mv = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
function rotAB(a, b) {        // minimal rotation taking unit a to unit b (row-major 3x3)
  const v = cross(a, b), c = dot(a, b), k = 1 / (1 + c + 1e-9);
  return [v[0] * v[0] * k + c, v[0] * v[1] * k - v[2], v[0] * v[2] * k + v[1], v[1] * v[0] * k + v[2], v[1] * v[1] * k + c, v[1] * v[2] * k - v[0], v[2] * v[0] * k - v[1], v[2] * v[1] * k + v[0], v[2] * v[2] * k + c];
}
function quatOf(R) {          // row-major 3x3 -> [x, y, z, w]
  const t = R[0] + R[4] + R[8]; let x, y, z, w;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; w = 0.25 * s; x = (R[7] - R[5]) / s; y = (R[2] - R[6]) / s; z = (R[3] - R[1]) / s; }
  else if (R[0] > R[4] && R[0] > R[8]) { const s = Math.sqrt(1 + R[0] - R[4] - R[8]) * 2; w = (R[7] - R[5]) / s; x = 0.25 * s; y = (R[1] + R[3]) / s; z = (R[2] + R[6]) / s; }
  else if (R[4] > R[8]) { const s = Math.sqrt(1 + R[4] - R[0] - R[8]) * 2; w = (R[2] - R[6]) / s; x = (R[1] + R[3]) / s; y = 0.25 * s; z = (R[5] + R[7]) / s; }
  else { const s = Math.sqrt(1 + R[8] - R[0] - R[4]) * 2; w = (R[3] - R[1]) / s; x = (R[2] + R[6]) / s; y = (R[5] + R[7]) / s; z = 0.25 * s; }
  const l = Math.hypot(x, y, z, w); return [x / l, y / l, z / l, w / l];
}
// pose(q, o): o.wrist = wrist extension (rad; the forearm swings toward the back of the hand), o.fl = [5] per-finger
// extra flex (a live tremor), o.spread (extra splay). Returns bone matrices (column-major mat4 x 17), dual quaternions
// (17 x [real xyzw, dual xyzw]), posed joints per chain, flex per finger (for the wrinkle shader).
export function pose(q, o = {}) {
  const R = [], T = [], chains = [];
  const put = (b, Rm, P, Jr) => { R[b] = Rm; T[b] = sub(P, mv(Rm, Jr)); };
  put(0, [1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0], [0, 0, 0]);
  put(16, rotX(o.wrist || 0), WRIST, WRIST);
  const [F0, F1, u] = lerpA(FLEX, q), [S0, S1] = lerpA(SPLAY, q), [G0, G1] = lerpA(FLEX_F, q);
  const flexOut = [];
  FINGERS.forEach((f, c) => {
    const g = G0[c] * (1 - u) + G1[c] * u, sp = f.s * (S0 * (1 - u) + S1 * u) + (o.spread || 0) * (c - 1.5) * 0.06;
    let a = 0, P = f.J[0]; const J = [P];
    for (let j = 0; j < 3; j++) {
      a += (F0[j] * (1 - u) + F1[j] * u) * g + (o.fl ? o.fl[c] * [0.6, 1, 0.7][j] : 0);
      const Rm = mm(rotZ(-sp), mm(rotX(a), rotZ(f.s)));        // undo the rest splay, flex about x, apply the posed splay
      put(boneOf(c, j), Rm, P, f.J[j]);
      P = add(P, mv(Rm, sub(f.J[j + 1], f.J[j]))); J.push(P);
    }
    chains.push(J); flexOut.push(a / 4.3);
  });
  { let P = THUMB.base, Rp = null; const J = [P];
    const k = Math.min(1, Math.floor(q)), uu = q - k;
    for (let j = 0; j < 3; j++) {
      const d = nrm(add(mul(THUMB.dirs[k][j], 1 - uu), mul(THUMB.dirs[k + 1][j], uu)));
      const Rm = Rp ? mm(rotAB(mv(Rp, THUMB.dirs[0][j]), d), Rp) : rotAB(THUMB.dirs[0][j], d);   // children keep their parent's twist
      put(13 + j, Rm, P, THUMB.J[j]); P = add(P, mul(d, THUMB.len[j])); J.push(P); Rp = Rm;
    }
    chains.push(J); flexOut.push(q / 2); }
  const mats = new Float32Array(NB * 16), dq = new Float32Array(NB * 8);
  for (let b = 0; b < NB; b++) {
    const r = R[b], t = T[b];
    mats.set([r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0, t[0], t[1], t[2], 1], b * 16);
    const [x, y, z, w] = quatOf(r);                           // dual part = 0.5 * (t, 0) * qr
    dq.set([x, y, z, w, 0.5 * (w * t[0] + t[1] * z - t[2] * y), 0.5 * (w * t[1] + t[2] * x - t[0] * z), 0.5 * (w * t[2] + t[0] * y - t[1] * x), -0.5 * (t[0] * x + t[1] * y + t[2] * z)], b * 8);
  }
  return { mats, dq, chains, flex: flexOut, R, T };
}
// a rest point through bone b of a pose
export const xform = (P, b, v) => add(mv(P.R[b], v), P.T[b]);
// capsules for contact shadows and occlusion: [a, b, radius, bone] in posed hand space (19)
export function capsules(P) {
  const out = [];
  FINGERS.forEach((f, c) => { const J = P.chains[c]; for (let j = 0; j < 3; j++) out.push([J[j], J[j + 1], (f.r[j] + f.r[j + 1]) * 0.5, boneOf(c, j)]); });
  { const J = P.chains[4]; for (let j = 0; j < 3; j++) out.push([J[j], J[j + 1], (THUMB.r[j] + THUMB.r[j + 1]) * 0.5 * (j ? 1 : 1.1), 13 + j]); }
  for (const x of [-0.26, 0, 0.26]) out.push([[x, 0.2, 0.0], [x * 1.08, 0.86, -0.01], 0.15, 0]);
  out.push([xform(P, 16, [0.0, -0.15, 0.0]), xform(P, 16, [0.03, -2.4, 0.02]), 0.36, 16]);
  return out;
}

// ------------------------------------------------------------------ distance functions
function rc2(rho, y, y0, y1, r0, r1) {          // exact 2D round cone along the y axis (radial rho)
  const L = y1 - y0, l2 = L * L, rr = r0 - r1, a2 = l2 - rr * rr, il2 = 1 / l2;
  const yy = (y - y0) * L, z = yy - l2, x2 = rho * rho * l2 * l2, y2 = yy * yy * l2, z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r1;
  if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r0;
  return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r0;
}
function seg3(a, b, r1, r2) { const ba = sub(b, a), l2 = dot(ba, ba), rr = r1 - r2; return { ax: a[0], ay: a[1], az: a[2], bx: ba[0], by: ba[1], bz: ba[2], l2, rr, a2: l2 - rr * rr, il2: 1 / l2, r1, r2 }; }
function rc3(px, py, pz, s) {                   // exact 3D round cone
  const pax = px - s.ax, pay = py - s.ay, paz = pz - s.az, y = pax * s.bx + pay * s.by + paz * s.bz, z = y - s.l2;
  const qx = pax * s.l2 - s.bx * y, qy = pay * s.l2 - s.by * y, qz = paz * s.l2 - s.bz * y;
  const x2 = qx * qx + qy * qy + qz * qz, y2 = y * y * s.l2, z2 = z * z * s.l2, k = Math.sign(s.rr) * s.rr * s.rr * x2;
  if (Math.sign(z) * s.a2 * z2 > k) return Math.sqrt(x2 + z2) * s.il2 - s.r2;
  if (Math.sign(y) * s.a2 * y2 < k) return Math.sqrt(x2 + y2) * s.il2 - s.r1;
  return (Math.sqrt(x2 * s.a2 * s.il2) + y * s.rr) * s.il2 - s.r1;
}
function ell(x, y, z, cx, cy, cz, rx, ry, rz) { const a = (x - cx) / rx, b = (y - cy) / ry, c = (z - cz) / rz, k0 = Math.sqrt(a * a + b * b + c * c);
  const k1 = Math.sqrt(a * a / (rx * rx) + b * b / (ry * ry) + c * c / (rz * rz)); return k0 * (k0 - 1) / (k1 || 1e-9); }
function segDist2(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1), ex = px - ax - dx * t, ey = py - ay - dy * t; return ex * ex + ey * ey; }
function polyDist(px, py, P, sx = 1) { let d = 1e9; for (let i = 0; i + 1 < P.length; i++) d = Math.min(d, segDist2(px, py, P[i][0] * sx, P[i][1], P[i + 1][0] * sx, P[i + 1][1])); return Math.sqrt(d); }

// veins: on the back of the hand as (x, y) polylines (z < 0 side), on the forearm as (angle, y) polylines, where the
// angle runs round the arm from the thumb side: 0 radial (+x), pi/2 the palm side (+z), -pi/2 the back (-z)
export const DVEIN = [
  [[0.34, 0.9], [0.26, 0.66], [0.22, 0.42], [0.27, 0.18], [0.3, 0.0], [0.32, -0.12]],
  [[0.1, 0.96], [0.11, 0.74], [0.2, 0.52]],
  [[-0.14, 0.97], [-0.1, 0.74], [-0.03, 0.56], [0.09, 0.47], [0.22, 0.44]],
  [[-0.37, 0.86], [-0.31, 0.62], [-0.26, 0.4], [-0.29, 0.16], [-0.33, 0.0], [-0.34, -0.12]],
  [[-0.26, 0.42], [-0.09, 0.3], [0.1, 0.26], [0.26, 0.2]],
];
export const FVEIN = [
  [[-0.55, 0.05], [-0.2, -0.45], [0.12, -0.95], [0.28, -1.5], [0.36, -2.3]],
  [[1.3, -0.12], [1.42, -0.7], [1.6, -1.3], [1.52, -1.85], [1.45, -2.35]],
  [[2.35, -0.05], [2.55, -0.75], [2.5, -1.45], [2.3, -2.3]],
  [[1.52, -1.85], [1.0, -2.05], [0.45, -2.25]],
  [[-1.25, -0.08], [-1.35, -0.85], [-1.15, -1.7], [-1.3, -2.3]],
  [[1.08, 0.02], [1.18, -0.45]], [[1.95, 0.02], [1.78, -0.55]],
];
// the limb's cross-section keys, from the knuckle line down the palm, through the wrist and the forearm to the upper
// arm: y, half-extents +x (thumb side), -x, +z (palm side), -z (back), superellipse power (a flat palm, a round arm)
export const FA = [[1.02, 0.47, 0.47, 0.12, 0.105, 2.6], [0.75, 0.465, 0.46, 0.13, 0.115, 2.6], [0.45, 0.44, 0.44, 0.13, 0.12, 2.5], [0.2, 0.39, 0.39, 0.135, 0.13, 2.4],
  [0.0, 0.345, 0.345, 0.16, 0.145, 2.2], [-0.3, 0.365, 0.355, 0.2, 0.175, 2.0], [-0.75, 0.44, 0.395, 0.26, 0.22, 2.0], [-1.25, 0.535, 0.45, 0.33, 0.27, 2.0],
  [-1.75, 0.595, 0.5, 0.38, 0.31, 2.0], [-2.25, 0.625, 0.52, 0.405, 0.335, 2.0], [-2.85, 0.625, 0.53, 0.42, 0.35, 2.0], [-3.45, 0.55, 0.5, 0.4, 0.36, 2.0], [-6, 0.48, 0.46, 0.4, 0.38, 2.0]];
const faKey = y => {                // Catmull-Rom through the keys (a smoothstep per span would rib the arm at every key)
  let i = 0; while (i < FA.length - 2 && y < FA[i + 1][0]) i++;
  const k0 = FA[Math.max(0, i - 1)], k1 = FA[i], k2 = FA[i + 1], k3 = FA[Math.min(FA.length - 1, i + 2)], f = clamp((y - k1[0]) / (k2[0] - k1[0]), 0, 1);
  return [1, 2, 3, 4, 5].map(k => { const p0 = k0[k], p1 = k1[k], p2 = k2[k], p3 = k3[k];
    return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f); }); };
function armEll(x, y, z) {          // signed distance to the limb's section at y (first order), the angle round it, mean radius
  const [hp, hn, zp, zn, n] = faKey(y), hx = x > 0 ? hp : hn, hz = z > 0 ? zp : zn;
  const a = Math.abs(x / hx) + 1e-9, c = Math.abs(z / hz) + 1e-9, e = Math.pow(Math.pow(a, n) + Math.pow(c, n), 1 / n);
  const k = Math.pow(e, 1 - n), gx = k * Math.pow(a, n - 1) / hx, gz = k * Math.pow(c, n - 1) / hz;
  return [(e - 1) / (Math.hypot(gx, gz) || 1e-9), Math.atan2(z / hz, x / hx), (hx + hz) * 0.5];
}
const TH = [0, 1, 2].map(j => seg3(THUMB.J[j], THUMB.J[j + 1], THUMB.r[j], THUMB.r[j + 1]));
const THENAR = seg3(add(THUMB.base, [-0.04, 0.03, 0.02]), add(THUMB.J[0], add(mul(sub(THUMB.J[1], THUMB.J[0]), 0.62), [-0.03, 0, 0.02])), 0.17, 0.135);

export function fingerLocal(c, x, y, z) { const f = FINGERS[c], dx = x - f.x, dy = y - f.y; return [dx * f.cs - dy * f.sn, dx * f.sn + dy * f.cs, z - f.z]; }
// the nail's footprint on the finger's back, in finger-local (lx, ly): negative inside (mirrored in HAND_FS)
function nailFoot(c, lx, ly) {
  const f = FINGERS[c], y0 = f.Y2 + 0.36 * f.len[2], y1 = f.Y3 + 0.52 * f.r[3], hw = 0.7 * f.r[2], hl = (y1 - y0) * 0.5, cy = (y0 + y1) * 0.5;
  const rc = ly < cy ? hw * 0.62 : hw * 0.35, qx = Math.abs(lx) - hw + rc, qy = Math.abs(ly - cy) - hl + rc;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rc;
}
function fingerD(c, lx, ly, lz) {
  const f = FINGERS[c], L2 = f.len[2];
  const tipU = clamp((ly - f.Y2 - 0.3 * L2) / (0.7 * L2), 0, 1);
  let sz = lz - 0.014 * tipU;                                          // the pad is fuller than the nail side
  if (lz < 0 && ly < 0.16) sz *= 1 + 0.28 * sstep(0.16, 0.0, ly);        // the back of the finger's root sits under the knuckle
  if (sz < 0) sz *= 1 + 0.16 * tipU;                                   // flatter over the nail bed
  const sx = lx / 1.1, ax = Math.abs(sx), az = Math.abs(sz), rho = Math.pow(Math.pow(ax, 2.15) + Math.pow(az, 2.15), 1 / 2.15), side = rho > 1e-6 ? sz / rho : 0;   // rounded-square phalanges
  let d = Math.min(rc2(rho, ly, 0, f.Y1, f.r[0], f.r[1]), rc2(rho, ly, f.Y1, f.Y2, f.r[1], f.r[2]), rc2(rho, ly, f.Y2, f.Y3, f.r[2], f.r[3]));
  const kn = sstep(0.35, -0.2, side), lat = rho > 1e-6 ? Math.abs(sx) / rho : 0;
  d -= kn * (0.3 + 0.7 * lat) * (0.011 * Math.exp(-(((ly - f.Y1) / 0.05) ** 2)) + 0.006 * Math.exp(-(((ly - f.Y2) / 0.04) ** 2)));   // knobbed joints, mostly at the sides
  { const u1 = clamp(ly / f.Y1, 0, 1), u2 = clamp((ly - f.Y1) / (f.Y2 - f.Y1), 0, 1); d += 0.005 * lat * lat * (Math.sin(Math.PI * u1) * (ly < f.Y1 ? 1 : 0) + Math.sin(Math.PI * u2) * (ly >= f.Y1 && ly < f.Y2 ? 1 : 0)); }   // waisted shafts
  if (side > 0) {                                                       // pads between the joints, folds at them
    const j = ly < f.Y1 ? 0 : ly < f.Y2 ? 1 : 2, a = [0, f.Y1, f.Y2][j], b = [f.Y1, f.Y2, f.Y3 + 0.4 * f.r[3]][j], u = clamp((ly - a) / (b - a), 0, 1);
    d -= [0.011, 0.012, 0.016][j] * side * side * Math.sin(Math.PI * u);
    d += 0.0025 * side * side * (Math.exp(-(((ly - f.Y1 + 0.012) / 0.012) ** 2)) + Math.exp(-(((ly - f.Y2 + 0.006) / 0.011) ** 2)));
  }
  if (side < -0.3 && ly > f.Y2) { const nd = nailFoot(c, lx, ly); d -= 0.0055 * sstep(0.006, -0.004, nd) * sstep(-0.3, -0.55, side); }
  return d;
}
function dorsalRelief(x, y, z) {           // back of the hand: extensor tendons and veins (only where z < 0)
  if (z > 0.02 || y < -0.35 || y > 1.05) return 0;
  const m = sstep(0.02, -0.07, z);
  let t = 0;
  for (let c = 0; c < 4; c++) { const f = FINGERS[c]; if (Math.abs(x - f.x * 0.7) > 0.25) continue; const d = Math.sqrt(segDist2(x, y, f.x * 0.42 + 0.02, 0.02, f.x, f.y - 0.06)), u = clamp((y - 0.02) / (f.y - 0.08), 0, 1);
    t = Math.max(t, [0.55, 0.85, 1, 0.95][c] * Math.exp(-((d / 0.034) ** 2)) * Math.pow(Math.sin(Math.PI * clamp(u * 1.05, 0, 1)), 0.6)); }
  { const d = Math.sqrt(segDist2(x, y, 0.2, -0.05, THUMB.J[1][0] - 0.05, THUMB.J[1][1] - 0.05)); t = Math.max(t, 0.8 * Math.exp(-((d / 0.03) ** 2)) * sstep(-0.1, 0.15, y)); }   // the thumb's long extensor
  let v = 0; for (const P of DVEIN) v = Math.max(v, Math.exp(-((polyDist(x, y, P) / 0.026) ** 2)));
  return m * (0.008 * t + 0.0075 * v);
}
function palmD(x, y, z) {
  let d = 1e3;
  d = smin(d, ell(x, y, z, -0.33, 0.42, 0.065, 0.15, 0.38, 0.1), 0.08);                      // hypothenar
  d = smin(d, rc3(x, y, z, THENAR), 0.1);                                                   // thenar mass round the thumb's metacarpal
  for (const f of FINGERS) {
    d = smin(d, ell(x, y, z, f.x, f.y - 0.01, -0.045, 0.088, 0.095, 0.078), 0.03);             // metacarpal heads (knuckles)
    d = smin(d, ell(x, y, z, f.x * 1.02, f.y + 0.03, 0.07, 0.13, 0.12, 0.06), 0.08);         // palm pads (calluses)
  }
  return d;
}
function limbD(x, y, z) {                  // palm body, wrist and forearm in one section
  const e = armEll(x, y, z); let d = smax(e[0], y - (1.0 - 0.42 * x * x + 0.04 * sstep(0.0, -0.09, z)), 0.12);   // the palm ends in the knuckles' arc
  if (y < 0.1) {
    if (z > 0) {                                                           // palm-side wrist tendons
      const w = sstep(0.12, -0.05, y) * sstep(-0.95, -0.3, y), tz = Math.exp(-(((x - 0.02) / 0.022) ** 2)) + 0.8 * Math.exp(-(((x - 0.13) / 0.024) ** 2));
      d -= 0.008 * w * tz;
    }
    let v = 0; const ax = e[1] * e[2];
    for (const P of FVEIN) { if (y > P[0][1] + 0.1 || y < P[P.length - 1][1] - 0.1) continue; v = Math.max(v, Math.exp(-((polyDist(ax, y, P, e[2]) / 0.03) ** 2))); }
    d -= 0.01 * v;
    // the groove between the flexors and the thumb-side muscle, and the flexor mass itself
    const span = sstep(-0.35, -0.9, y) * sstep(-2.4, -1.7, y);
    d += 0.013 * Math.exp(-((((e[1] - 0.62) * e[2]) / 0.06) ** 2)) * span;
    d -= 0.012 * Math.exp(-((((e[1] - 1.45) * e[2]) / 0.16) ** 2)) * span;
  }
  return smin(d, ell(x, y, z, -0.3, -0.05, -0.09, 0.07, 0.07, 0.06), 0.04);                    // ulnar styloid
}
function thumbD(x, y, z) {
  let d = Math.min(rc3(x, y, z, TH[0]), rc3(x, y, z, TH[1]), rc3(x, y, z, TH[2]));
  const J1 = THUMB.J[1], J2 = THUMB.J[2];
  d -= 0.012 * Math.exp(-((Math.hypot(x - J1[0], y - J1[1], z - J1[2]) / 0.12) ** 2)) + 0.008 * Math.exp(-((Math.hypot(x - J2[0], y - J2[1], z - J2[2]) / 0.1) ** 2));
  return d;
}
export function skinD(x, y, z) {
  let d = 1e3;
  d = limbD(x, y, z);
  if (y > -0.5 && y < 1.35) d = smin(d, palmD(x, y, z), 0.07);
  if (x > 0.02 && y > 0.0) d = smin(d, thumbD(x, y, z), 0.085);
  if (y > 0.72) {
    let fd = 1e3;
    for (let c = 0; c < 4; c++) { const f = FINGERS[c]; if (Math.abs(x - f.x - f.sn * 0.5) > 0.4) continue; const L = fingerLocal(c, x, y, z); if (L[1] < -0.2) continue; fd = Math.min(fd, fingerD(c, L[0], L[1], L[2])); }
    d = smin(d, fd, 0.06);
  }
  if (y > 0.15 && y < 1.0 && z > 0) d = smax(d, -ell(x, y, z, 0.02, 0.56, 0.255, 0.25, 0.3, 0.13), 0.07);   // the hollow of the palm
  d -= dorsalRelief(x, y, z);
  return Math.max(d, -(y + 2.32));           // ends inside the sleeve
}
// the rolled sleeve: two rolls of chambray above the forearm's widest part, then the loose sleeve to the elbow and past
export const CUFF_Y = [-1.93, -2.2];         // top and bottom of the roll
export function sleeveD(x, y, z) {
  if (y > -1.8) return y + 1.86;
  const [ad, ang] = armEll(x, y, z);
  const th = 0.052 * (1 + 0.16 * Math.sin(ang * 3 + 0.4) + 0.08 * Math.sin(ang * 7 - 1.1)), yc = -2.065 + 0.018 * Math.sin(ang * 2 + 0.7) + 0.008 * Math.sin(ang * 5);
  const hh = 0.12 + 0.01 * Math.sin(ang * 4 - 0.8);
  const rq = (ad - 0.012 - th) / th, yq = (y - yc) / hh, re = Math.sqrt(rq * rq + yq * yq);
  let d = (re - 1) * Math.min(th, hh) * 0.9;                                                   // the roll: a flattened ring of doubled cloth
  d = smin(d, Math.hypot(ad - 0.03 - 0.026, y - (yc + hh * 0.86)) - 0.026, 0.012);             // the turned edge on top
  const u = -2.2 - y, below = sstep(0, 0.08, u), drop = sstep(0.1, 1.5, u);
  const fold = below * ((0.013 * Math.sin(u * 21 + 1.8 * Math.sin(ang * 2 + u * 3.1) + 0.9 * Math.sin(ang * 5 - 1)) + 0.008 * Math.sin(u * 37 - 2.3 * Math.sin(ang * 3 + 0.5))) * (0.5 + 0.5 * Math.sin(ang * 2.3 + u * 1.7)) * Math.exp(-u * 0.9)
    + 0.018 * Math.sin(ang * 3 + 0.8 * Math.sin(u * 1.4)) * drop
    + 0.009 * Math.sin(ang * 7 - u * 2.5) * drop) + 0.008 * Math.exp(-(((ang - 2.75) / 0.05) ** 2));   // compression rings, drape, the felled seam
  const body = Math.max(ad - (0.035 + 0.075 * drop + fold), y + 2.14);
  return Math.min(d, Math.max(body, -(y + 5.6)));
}

// ------------------------------------------------------------------ surface nets on a narrow band
function surfaceNets(f, lo, hi, h, B = 8) {
  const nx = Math.ceil((hi[0] - lo[0]) / h), ny = Math.ceil((hi[1] - lo[1]) / h), nz = Math.ceil((hi[2] - lo[2]) / h);
  const bx = Math.ceil(nx / B), by = Math.ceil(ny / B), bz = Math.ceil(nz / B), n1 = B + 1;
  const rB = B * h * 0.866 * 1.3 + 0.02, vals = new Float32Array(n1 * n1 * n1);
  const cellV = new Map(), pos = [], flags = [];
  const key = (i, j, k) => (k * ny + j) * nx + i;
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const CO = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const cv = new Float32Array(8);
  for (let K = 0; K < bz; K++) for (let J = 0; J < by; J++) for (let I = 0; I < bx; I++) {
    const cx = lo[0] + (I * B + B / 2) * h, cy = lo[1] + (J * B + B / 2) * h, cz = lo[2] + (K * B + B / 2) * h;
    if (Math.abs(f(cx, cy, cz)) > rB) continue;
    for (let k = 0; k < n1; k++) for (let j = 0; j < n1; j++) for (let i = 0; i < n1; i++)
      vals[(k * n1 + j) * n1 + i] = f(lo[0] + (I * B + i) * h, lo[1] + (J * B + j) * h, lo[2] + (K * B + k) * h);
    for (let k = 0; k < B; k++) for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
      const gi = I * B + i, gj = J * B + j, gk = K * B + k; if (gi >= nx || gj >= ny || gk >= nz) continue;
      let m = 0;
      for (let c = 0; c < 8; c++) { const o = CO[c]; cv[c] = vals[((k + o[2]) * n1 + j + o[1]) * n1 + i + o[0]]; if (cv[c] < 0) m |= 1 << c; }
      if (m === 0 || m === 255) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const [a, b] of E) { const va = cv[a], vb = cv[b]; if ((va < 0) === (vb < 0)) continue; const t = va / (va - vb), A = CO[a], Bc = CO[b];
        sx += A[0] + (Bc[0] - A[0]) * t; sy += A[1] + (Bc[1] - A[1]) * t; sz += A[2] + (Bc[2] - A[2]) * t; n++; }
      cellV.set(key(gi, gj, gk), pos.length / 3);
      pos.push(lo[0] + (gi + sx / n) * h, lo[1] + (gj + sy / n) * h, lo[2] + (gk + sz / n) * h);
      const s0 = m & 1;
      flags.push(gi, gj, gk, s0 | ((((m >> 1) & 1) !== s0) ? 2 : 0) | ((((m >> 2) & 1) !== s0) ? 4 : 0) | ((((m >> 4) & 1) !== s0) ? 8 : 0));
    }
  }
  const idx = [];
  const quad = (a, b, c, d) => {
    const v = [cellV.get(a), cellV.get(b), cellV.get(c), cellV.get(d)]; if (v.some(x => x === undefined)) return;
    const D = (p, q) => (pos[p * 3] - pos[q * 3]) ** 2 + (pos[p * 3 + 1] - pos[q * 3 + 1]) ** 2 + (pos[p * 3 + 2] - pos[q * 3 + 2]) ** 2;
    if (D(v[0], v[2]) < D(v[1], v[3])) idx.push(v[0], v[1], v[2], v[0], v[2], v[3]); else idx.push(v[0], v[1], v[3], v[1], v[2], v[3]);
  };
  for (let q = 0; q < flags.length; q += 4) {
    const i = flags[q], j = flags[q + 1], k = flags[q + 2], fl = flags[q + 3];
    if (fl & 2 && j > 0 && k > 0) quad(key(i, j, k), key(i, j - 1, k), key(i, j - 1, k - 1), key(i, j, k - 1));
    if (fl & 4 && i > 0 && k > 0) quad(key(i, j, k), key(i, j, k - 1), key(i - 1, j, k - 1), key(i - 1, j, k));
    if (fl & 8 && i > 0 && j > 0) quad(key(i, j, k), key(i - 1, j, k), key(i - 1, j - 1, k), key(i, j - 1, k));
  }
  return { pos: new Float32Array(pos), idx };
}
const EPS = 1.2e-3, TET = [[1, -1, -1], [-1, -1, 1], [-1, 1, -1], [1, 1, 1]];
function gradOf(f, x, y, z) { let gx = 0, gy = 0, gz = 0; for (const k of TET) { const v = f(x + k[0] * EPS, y + k[1] * EPS, z + k[2] * EPS); gx += k[0] * v; gy += k[1] * v; gz += k[2] * v; } const l = Math.hypot(gx, gy, gz) || 1; return [gx / l, gy / l, gz / l]; }

// ------------------------------------------------------------------ skinning weights
function skinBones(x, y, z) {        // -> [bone0, bone1, w1, part]; part: 0-3 finger, 4 thumb, 5 palm, 6 forearm
  const wristW = sstep(-0.17, 0.12, y);
  if (y < 0.14) { if (wristW <= 0) return [16, 16, 0, 6]; if (!(x > 0.12 && y > -0.02)) return [16, 0, wristW, y < 0 ? 6 : 5]; }
  let best = -1, bs = 1e9, bl = null;
  for (let c = 0; c < 4; c++) { const L = fingerLocal(c, x, y, z); if (L[1] < -0.24) continue; const s = Math.hypot(L[0] / 1.07, L[2]) / FINGERS[c].r[0] + Math.max(0, -L[1]) * 3; if (s < bs) { bs = s; best = c; bl = L; } }
  let tb = 1e9, tj = 0, tt = 0;
  for (let j = 0; j < 3; j++) { const a = THUMB.J[j], b = THUMB.J[j + 1], ba = sub(b, a), t = clamp(dot(sub([x, y, z], a), ba) / dot(ba, ba), -0.3, 1.2), c = add(a, mul(ba, clamp(t, 0, 1)));
    const s = Math.hypot(x - c[0], y - c[1], z - c[2]) / THUMB.r[j]; if (s < tb) { tb = s; tj = j; tt = t; } }
  if (tb < 1.9 && tb < bs * 1.15) {
    if (wristW < 1) return [16, 0, wristW, 4];
    const L = THUMB.len, al = tt * L[tj] + (tj > 0 ? L[0] : 0) + (tj > 1 ? L[1] : 0), J1 = L[0], J2 = L[0] + L[1];
    if (al < J1 - 0.09) return [0, 13, sstep(0.12, 0.42, al) * (1 - sstep(1.25, 1.9, tb)) * 0.9, 4];
    if (al < J1 + 0.09) return [13, 14, sstep(J1 - 0.09, J1 + 0.09, al), 4];
    if (al < J2 - 0.07) return [14, 14, 0, 4];
    return [14, 15, sstep(J2 - 0.07, J2 + 0.07, al), 4];
  }
  if (best >= 0 && bs < 2.2) {
    const f = FINGERS[best], [lx, ly, lz] = bl, rr = Math.hypot(lx / 1.07, lz) || 1e-6, pal = Math.max(0, lz / rr);
    const le = ly - 0.085 * pal * pal + 0.02 * Math.max(0, -lz / rr);       // the palm side bends later (the crease sits past the joint)
    if (le < 0.1) return [0, boneOf(best, 0), sstep(-0.075, 0.1, le), best];
    const bw1 = 0.075, bw2 = 0.06;
    if (le < f.Y1 - bw1) return [boneOf(best, 0), boneOf(best, 0), 0, best];
    if (le < f.Y1 + bw1) return [boneOf(best, 0), boneOf(best, 1), sstep(f.Y1 - bw1, f.Y1 + bw1, le), best];
    if (le < f.Y2 - bw2) return [boneOf(best, 1), boneOf(best, 1), 0, best];
    if (le < f.Y2 + bw2) return [boneOf(best, 1), boneOf(best, 2), sstep(f.Y2 - bw2, f.Y2 + bw2, le), best];
    return [boneOf(best, 2), boneOf(best, 2), 0, best];
  }
  return [0, 0, 0, 5];
}

// ------------------------------------------------------------------ build: meshes + per-vertex attributes
function finishMesh(f, raw, isSleeve) {
  const { pos } = raw, I = raw.idx, n = pos.length / 3;
  const nor = new Float32Array(n * 3), skin = new Float32Array(n * 4), aux = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    let x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    let g = gradOf(f, x, y, z); const d = f(x, y, z); x -= g[0] * d; y -= g[1] * d; z -= g[2] * d;
    pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z; g = gradOf(f, x, y, z); nor.set(g, v * 3);
    let occ = 0, tot = 0; for (const [s, w] of [[0.012, 1], [0.03, 0.85], [0.055, 0.65], [0.09, 0.45], [0.14, 0.3]]) { occ += Math.max(0, s - f(x + g[0] * s, y + g[1] * s, z + g[2] * s)) * w; tot += s * w; }
    let th = 0; for (const s of [0.03, 0.06, 0.1, 0.16, 0.25]) th = Math.max(th, -f(x - g[0] * s, y - g[1] * s, z - g[2] * s));
    let vein = 0;
    if (!isSleeve) {
      if (z < 0.02 && y > -0.35 && y < 1.05) { let dv = 0; for (const P of DVEIN) dv = Math.max(dv, Math.exp(-((polyDist(x, y, P) / 0.026) ** 2))); vein = dv * sstep(0.05, -0.2, g[2]); }
      if (y < 0.1) { const e = armEll(x, y, z); let fv = 0; for (const P of FVEIN) fv = Math.max(fv, Math.exp(-((polyDist(e[1] * e[2], y, P, e[2]) / 0.03) ** 2))); vein = Math.max(vein, fv * sstep(0.1, -0.1, y)); }
    }
    aux.set([clamp(1 - 1.7 * occ / tot, 0, 1), th * 2, vein, 0], v * 4);
    skin.set(isSleeve ? [16, 16, 0, 7] : skinBones(x, y, z), v * 4);
  }
  for (let t = 0; t < I.length; t += 3) {        // consistent winding: face normals agree with the field
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const fn = cross([pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]], [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]]);
    if (fn[0] * (nor[a] + nor[b] + nor[c]) + fn[1] * (nor[a + 1] + nor[b + 1] + nor[c + 1]) + fn[2] * (nor[a + 2] + nor[b + 2] + nor[c + 2]) < 0) { const s = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = s; }
  }
  return { pos, nor, skin, aux, idx: n > 65535 ? new Uint32Array(I) : new Uint16Array(I), n, tris: I.length / 3 };
}
export function buildHand({ h = 0.0105, hs = 0.02 } = {}) {
  const t0 = performance.now();
  const skin = finishMesh(skinD, surfaceNets(skinD, [-0.62, -2.36, -0.44], [1.08, 2.42, 0.58], h), false);
  const sleeve = finishMesh(sleeveD, surfaceNets(sleeveD, [-0.78, -5.62, -0.6], [0.8, -1.76, 0.66], hs), true);
  // palm-face height map for the pool of light (z of the palm's surface over x in [-0.45, 0.45], y in [0.05, 1.05])
  const PH = new Float32Array(33 * 33);
  for (let j = 0; j < 33; j++) for (let i = 0; i < 33; i++) {
    const x = -0.45 + 0.9 * i / 32, y = 0.05 + j / 32; let z = 0.5;
    for (let it = 0; it < 40; it++) { const d = skinD(x, y, z); if (d < 1e-4) break; z -= Math.max(d, 1e-3); if (z < -0.3) break; }
    PH[j * 33 + i] = z;
  }
  const ms = performance.now() - t0;
  console.log(`[hand] skin ${skin.n} verts ${skin.tris} tris, sleeve ${sleeve.n} verts ${sleeve.tris} tris, built in ${(ms / 1000).toFixed(1)}s`);
  return { skin, sleeve, ms, palmZ: (x, y) => { const u = clamp((x + 0.45) / 0.9, 0, 1) * 32, v = clamp(y - 0.05, 0, 1) * 32, i = Math.min(31, Math.floor(u)), j = Math.min(31, Math.floor(v)), a = u - i, b = v - j;
    return (PH[j * 33 + i] * (1 - a) + PH[j * 33 + i + 1] * a) * (1 - b) + (PH[(j + 1) * 33 + i] * (1 - a) + PH[(j + 1) * 33 + i + 1] * a) * b; } };
}
// area-weighted surface samples of both meshes (the particles that leave the fist): [pos, normal, bone0, bone1, w1, part]
export function sampleSurface(H, n, R) {
  const parts = [H.skin, H.sleeve], tris = [], cum = []; let S = 0;
  parts.forEach((m, mi) => { const p = m.pos, I = m.idx; for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    S += Math.hypot(...cross([p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]])) * (mi ? 0.4 : 1);
    cum.push(S); tris.push(mi, t); } });
  const out = [];
  for (let k = 0; k < n; k++) {
    const r = R() * S; let lo = 0, hi = cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < r) lo = m + 1; else hi = m; }
    const m = parts[tris[lo * 2]], t = tris[lo * 2 + 1], I = m.idx; let u = R(), v = R(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w = [1 - u - v, u, v], vi = [I[t], I[t + 1], I[t + 2]], P = [0, 0, 0], N = [0, 0, 0];
    for (let q = 0; q < 3; q++) for (let c = 0; c < 3; c++) { P[c] += m.pos[vi[q] * 3 + c] * w[q]; N[c] += m.nor[vi[q] * 3 + c] * w[q]; }
    const near = vi[w[0] > w[1] ? (w[0] > w[2] ? 0 : 2) : (w[1] > w[2] ? 1 : 2)], s = m.skin;
    out.push([P, nrm(N), s[near * 4], s[near * 4 + 1], s[near * 4 + 2], s[near * 4 + 3]]);
  }
  return out;
}

// ------------------------------------------------------------------ GL: the hand and sleeve shaders
const G = v => v.toFixed(5);
// the shaders' tables are uniforms, not const arrays: a dynamically indexed const array is copied into every
// invocation's local memory by the SPIR-V path (ANGLE -> SwiftShader), which cost more than the whole hand
export const HAND_TABLES = {
  F_MCP: FINGERS.map(q => [q.x, q.y, q.z, 0]), F_CS: FINGERS.map(q => [q.cs, q.sn, 0, 0]), F_Y: FINGERS.map(q => [q.Y1, q.Y2, q.Y3, q.len[2]]), F_R: FINGERS.map(q => q.r),
  FA_K: FA.map(k => k.slice(1, 5)), FA_Y: FA.map(k => [k[0], 0, 0, 0]) };
export function setHandTables(gl, u) { for (const k in HAND_TABLES) if (u[k] != null) gl.uniform4fv(u[k], new Float32Array(HAND_TABLES[k].flat())); }
const GLSL_CONST = (() => {
  const t = THUMB, va = a => `vec4(${a.map(G).join(', ')})`, v3 = a => `vec3(${a.map(G).join(', ')})`;
  return `
uniform vec4 F_MCP[4], F_CS[4], F_Y[4], F_R[4];
const vec3 T_J2 = ${v3(t.J[2])}, T_T2 = ${v3(t.dirs[0][2])}, T_D2 = ${v3(t.D[2])}, T_X2 = ${v3(t.X[2])};
const vec3 T_J1 = ${v3(t.J[1])}, T_T1 = ${v3(t.dirs[0][1])}, T_D1 = ${v3(t.D[1])};
const vec4 T_L = ${va([...t.len, t.r[3]])}, T_R = ${va(t.r)};
const int FA_N = ${FA.length}; uniform vec4 FA_K[${FA.length}], FA_Y[${FA.length}];
const vec2 CUFF = vec2(${CUFF_Y.map(G).join(', ')});`;
})();

export const HAND_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aRest; layout(location=1) in vec3 aNrm; layout(location=2) in vec4 aSkin; layout(location=3) in vec4 aAux;
uniform mat4 uVP; uniform vec4 uDQ[34]; uniform mat3 uHandM; uniform vec3 uHandO; uniform float uHandS;
uniform vec4 uCapA[19], uCapB[19]; uniform vec3 uKeyDir, uPoolPos; uniform int uShadow;
out vec3 vW, vN, vR, vA; out vec4 vL; flat out float vPart;   // (few varyings: each costs every fragment)
float capShadow(vec3 ro, vec3 rd, vec3 a, vec3 b, float r, float k, float tmax){
  vec3 ba = b - a, oa = ro - a;
  float oad = dot(oa, rd), dba = dot(rd, ba), baba = dot(ba, ba), oaba = dot(oa, ba);
  vec2 th = vec2(-oad*baba + dba*oaba, oaba - oad*dba)/max(baba - dba*dba, 1e-6);
  th.x = max(th.x, 1e-4); th.y = clamp(th.y, 0., 1.);
  if (th.x > tmax) return 1.;
  vec3 p = a + ba*th.y, q = ro + rd*th.x; float d = length(p - q) - r;
  float s = clamp(k*d/th.x + 0.5, 0., 1.); return s*s*(3. - 2.*s); }
void main(){
  int b0 = int(aSkin.x + .5), b1 = int(aSkin.y + .5); float w1 = aSkin.z;
  vec4 r0 = uDQ[b0*2], d0 = uDQ[b0*2 + 1], r1 = uDQ[b1*2], d1 = uDQ[b1*2 + 1];
  if (dot(r0, r1) < 0.) { r1 = -r1; d1 = -d1; }
  vec4 r = r0*(1. - w1) + r1*w1, d = d0*(1. - w1) + d1*w1; float l = length(r); r /= l; d /= l;
  vec3 p = aRest + 2.*cross(r.xyz, cross(r.xyz, aRest) + r.w*aRest) + 2.*(r.w*d.xyz - d.w*r.xyz + cross(r.xyz, d.xyz));
  vec3 n = aNrm + 2.*cross(r.xyz, cross(r.xyz, aNrm) + r.w*aNrm);
  vec3 W = uHandO + uHandM*p*uHandS, N = normalize(uHandM*n);
  vW = W; vN = N; vR = aRest; vA = vec3(aNrm.z, aAux.y, aAux.z); vPart = aSkin.w;
  float sk = 1., sp = 1., occ = 0.;
  if (uShadow == 1 && !(b0 == 16 && b1 == 16)) {          // the forearm and sleeve below the wrist skip the capsules
    vec3 ro = W + N*0.006*uHandS; vec3 pd = uPoolPos - ro; float pl = length(pd); pd /= pl;
    // a capsule's own flesh doesn't shadow itself: exclusion follows the vertex's (continuous) weight on that bone, so
    // shadow edges never follow the bone-assignment seams; palm, forearm and thumb metacarpal count as one body
    float w0 = 1. - w1;
    for (int i = 0; i < 19; i++) {
      vec4 A = uCapA[i], Bc = uCapB[i]; int bi = int(Bc.w + .5);
      float own = (bi == b0 ? w0 : 0.) + (bi == b1 ? w1 : 0.);
      if (bi == 0) own += (b0 == 16 || b0 == 13 ? w0 : 0.) + (b1 == 16 || b1 == 13 ? w1 : 0.);
      if (bi == 16 || bi == 13) own += (b0 == 0 ? w0 : 0.) + (b1 == 0 ? w1 : 0.);
      own = clamp(own*1.6, 0., 1.);
      vec3 ab = Bc.xyz - A.xyz, c = A.xyz + ab*clamp(dot(W - A.xyz, ab)/dot(ab, ab), 0., 1.), v = c - W;
      float dd = max(dot(v, v), 1e-6);
      occ += min(1., A.w*A.w/dd)*max(dot(N, v)*inversesqrt(dd), 0.)*(1. - 0.7*own);
      if (own > 0.999) continue;
      if (b0 != 16) sk = min(sk, mix(capShadow(ro, uKeyDir, A.xyz, Bc.xyz, A.w, 5., 1e4), 1., own));   // the falls are a wide curtain: the arm below stays lit
      sp = min(sp, mix(capShadow(ro, pd, A.xyz, Bc.xyz, A.w, 4., pl), 1., own));
    }
  }
  vL = vec4(sk, sp, clamp(1. - occ*1.25, 0.12, 1.), aAux.x);
  gl_Position = uVP*vec4(W, 1.);
}`;

export const HAND_FS = `#version 300 es
precision highp float; precision highp sampler3D;
in vec3 vW, vN, vR, vA; in vec4 vL; flat in float vPart;
uniform vec3 uEye, uKeyDir, uKeyCol, uPoolPos, uPoolCol, uRimCol, uAmbUp, uAmbDn, uRimDir;
uniform float uHandS, uB, uDis, uFlex[5], uTrans, uSleeve, uGlow; uniform int uDebug; uniform vec3 uFillDir, uFillCol;
uniform sampler3D tN; uniform sampler2D tVor;
out vec4 o;
${GLSL_CONST}
float sat(float x){ return clamp(x, 0., 1.); }
float h1(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x*p.y); }
float n3(vec3 p){ return texture(tN, p).r; }
vec4 n4(vec3 p){ return texture(tN, p); }
float fbm3(vec3 p){ vec4 a = texture(tN, p); return a.r*0.55 + a.g*0.3 + a.b*0.15; }
float line(float d, float w){ return exp(-d*d/(w*w)); }

// fade a periodic feature (phase in cycles) as it gets finer than the pixels: no moire at a distance
float fadeC(float cyc){ return sat(1.6 - 2.2*fwidth(cyc)); }
float fadeV(vec3 q){ vec3 w = fwidth(q); return sat(1.6 - 2.2*max(w.x, max(w.y, w.z))); }
// the arm's elliptical section: angle round it (0 thumb side, pi/2 palm side) and mean radius
// angle round the arm (0 thumb side, pi/2 palm side) from a fixed section: close enough for hair and weave
vec2 armAng(vec3 p){ float hx = p.x > 0. ? 0.56 : 0.49, hz = p.z > 0. ? 0.37 : 0.31; return vec2(atan(p.z/hz, p.x/hx), 0.5*(hx + hz)); }
struct S { vec3 alb; float h, rough, sss, spec, grime, nail; };
vec4 NL, NP;                 // the two noise taps every skin feature shares: coarse (blotches, grease) and fine (pores)
float sn(vec3 q){ return 0.5 + 0.25*(sin(dot(q, vec3(7.1, 3.3, 5.7))) + sin(dot(q, vec3(-4.3, 8.9, 2.1)) + 1.7)); }   // cheap ALU noise
void palmDetail(vec3 p, inout S s){
  float x = p.x, y = p.y;
  // principal creases: heart, head, life (thenar), a faint fate line, the wrist bracelets
  float heart = abs(y - (0.84 + 0.1*(x + 0.5) + 0.1*smoothstep(-0.05, 0.3, x)))*(x < 0.3 ? 1. : 8.);
  float head = abs(y - (0.79 - 0.3*(0.5 - x)*(0.5 - x) - 0.06*(0.5 - x)))*(x > -0.36 && x < 0.47 ? 1. : 8.);
  vec2 lq = (p.xy - vec2(0.64, 0.33))/vec2(0.52, 0.5); float life = abs(length(lq) - 1.)*0.5*(y > 0.05 && y < 0.8 && x < 0.47 ? 1. : 8.);
  float fate = abs(x - 0.05 - 0.05*y)*(y > 0.15 && y < 0.7 ? 1. : 8.);
  float wr = min(abs(y - 0.02 - 0.05*x*x), abs(y + 0.04 - 0.04*x*x))*(abs(x) < 0.26 ? 1. : 3.);
  float brk = 0.45 + 0.8*NL.g;                       // creases fade in and out along their length
  float c = (line(heart, 0.005 + 0.003*brk) + line(head, 0.005 + 0.003*brk) + line(life, 0.006 + 0.002*brk))*brk + 0.35*line(fate, 0.004)*brk + 0.3*line(wr, 0.004)*brk;
  for (int k = 0; k < 4; k++) { vec4 m = F_MCP[k]; float yb = m.y + 0.2 - 0.02*abs(x - m.x)/0.1; c += 0.8*line(abs(y - yb), 0.005)*step(abs(x - m.x), 0.12) + 0.5*line(abs(y - yb - 0.02), 0.004)*step(abs(x - m.x), 0.1); }
  vec4 vr = texture(tVor, p.xy*vec2(0.9, 1.1) + 0.37);
  float net = (1. - smoothstep(0., 0.035, vr.g))*fadeC(p.x*14.)*0.5;
  s.h -= 0.004*c + 0.0007*net; s.grime = max(s.grime, sat(c*0.45) + net*0.12);
  // the scar: an old stitched cut across the palm, heel to the index root
  vec2 a = vec2(-0.33, 0.24), b = vec2(0.21, 0.86), ba = b - a; float t = clamp(dot(p.xy - a, ba)/dot(ba, ba), 0., 1.);
  vec2 cp = a + ba*t, nn = normalize(vec2(-ba.y, ba.x)); float wob = (sn(vec3(t*3.1, 0.2, 0.7)) - 0.5)*0.022, sdn = dot(p.xy - cp, nn) - wob;
  float taper = smoothstep(0., 0.12, t)*smoothstep(1., 0.85, t), sw = 0.028*taper + 0.004;
  float sc = smoothstep(sw, sw*0.35, abs(sdn));
  float along = abs(fract(t*16.) - 0.5)*length(ba)/16.;
  float st = smoothstep(0.006, 0.0025, along)*line(abs(sdn) - 0.034, 0.006)*taper;
  s.alb = mix(s.alb, vec3(0.6, 0.38, 0.33), sc*0.8); s.rough = mix(s.rough, 0.26, sc); s.sss *= 1. - 0.45*sc; s.h += 0.0032*sc*(0.8 + 0.4*sn(vec3(t*9., 0.5, 0.5))) - 0.0012*smoothstep(sw*0.3, 0., abs(sdn))*taper;
  s.alb = mix(s.alb, vec3(0.55, 0.34, 0.3), st*0.5); s.h += 0.0012*st;
  // calluses: finger roots, the heel of the index; an old burn low on the heel
  float cal = 0.; for (int k = 0; k < 4; k++) { vec4 m = F_MCP[k]; vec2 q = (p.xy - vec2(m.x*1.02, m.y + 0.035))/vec2(0.1, 0.075); cal = max(cal, exp(-dot(q, q)*1.6)*(k == 0 ? 0.5 : 1.)); }
  { vec2 q = (p.xy - vec2(0.36, 0.86))/vec2(0.1, 0.08); cal = max(cal, exp(-dot(q, q)*1.4)*0.8); }
  cal *= smoothstep(0.35, 0.65, cal + 0.25*NL.b);
  s.alb = mix(s.alb, vec3(0.6, 0.44, 0.26), cal*0.75); s.rough = mix(s.rough, 0.72, cal); s.sss *= 1. - 0.45*cal; s.h += 0.0018*cal*(NP.g - 0.5);
  { vec2 q = (p.xy - vec2(-0.3, 0.2))/vec2(0.07, 0.05); float d0 = length(q); if (d0 < 1.3) { vec4 nb = vec4(NL.a, NP.r, 0., 0.);
    float bn = smoothstep(1., 0.6, d0 + 0.35*(nb.r - 0.5)); s.alb = mix(s.alb, vec3(0.64, 0.4, 0.36), bn*0.6); s.rough = mix(s.rough, 0.3, bn); s.h += 0.0012*bn*(nb.g - 0.4); } }
}
void fingerDetail(int k, vec3 p, inout S s){
  vec4 m = F_MCP[k], cs = F_CS[k], Y = F_Y[k], R = F_R[k];
  vec2 d2 = p.xy - m.xy; float lx = d2.x*cs.x - d2.y*cs.y, ly = d2.x*cs.y + d2.y*cs.x, lz = p.z - m.z;
  float rr = length(vec2(lx/1.07, lz)), side = lz/max(rr, 1e-4), r = ly < Y.x ? R.x : ly < Y.y ? R.y : R.z;
  float fl = uFlex[k];
  if (side < -0.1) {                                   // back of the finger: knuckle wrinkles, flattening as the finger bends
    float dorsal = smoothstep(-0.1, -0.5, side), stretch = 1. - 0.95*sat(fl*1.7);
    for (int j = 0; j < 2; j++) {
      float yj = j == 0 ? Y.x : Y.y, sp = j == 0 ? 0.0145 : 0.012, ext = j == 0 ? 0.05 : 0.032;
      float u = ly - yj - 0.008, w = u + 0.5*lx*lx/r;
      float env = exp(-u*u/(ext*ext))*exp(-lx*lx/(0.8*r*r));
      float wr = pow(0.5 + 0.5*cos(6.2831*w/sp + 3.*sn(vec3(lx*1.3, ly*0.4, float(k)*0.3)*5.)), 6.)*env*fadeC(w/sp);
      s.h -= 0.0035*wr*dorsal*stretch; s.grime = max(s.grime, wr*dorsal*0.55*stretch);
      s.alb *= 1. - 0.12*env*dorsal;                    // worked knuckles are darker
    }
    float kn = exp(-(ly*ly)/0.006)*exp(-lx*lx/(r*r))*dorsal; s.rough = mix(s.rough, 0.66, kn); s.alb *= 1. - 0.1*kn;
    // the nail: plate, lunula, free edge with grease under it, the cuticle fold; the index nail is chipped
    float y0 = Y.y + 0.36*Y.w, y1 = Y.z + 0.52*R.w, hw = 0.7*R.z, hl = (y1 - y0)*0.5, cy = (y0 + y1)*0.5;
    float rc = ly < cy ? hw*0.62 : hw*0.35; vec2 qn = vec2(abs(lx) - hw + rc, abs(ly - cy) - hl + rc);
    float nd = length(max(qn, 0.)) + min(max(qn.x, qn.y), 0.) - rc;
    float nside = smoothstep(-0.25, -0.45, side), inN = smoothstep(0.0015, -0.0015, nd)*nside;
    if (nd < 0.014) {
      float lun = smoothstep(1.05, 0.9, length(vec2(lx/(0.62*hw), (ly - y0 + 0.01)/(0.2*(y1 - y0)))));
      float chip = k == 3 ? step(0.55, sn(vec3(lx*60., 0.3, 0.1)))*smoothstep(y1 - 0.045, y1 - 0.03, ly) : 0.;
      float free = sat(smoothstep(y1 - 0.03, y1 - 0.018, ly) + chip);
      vec3 na = mix(vec3(0.62, 0.36, 0.33), vec3(0.8, 0.66, 0.6), lun*0.7);
      na = mix(na, vec3(0.78, 0.72, 0.62), free);
      na = mix(na, vec3(0.08, 0.05, 0.04), line(ly - (y1 - 0.024), 0.004)*0.9);
      float ridges = 0.5 + 0.5*sin(lx*420. + sin(ly*40. + lx*9.)*1.5);
      s.alb = mix(s.alb, na*(0.95 + 0.08*ridges), inN); s.rough = mix(s.rough, 0.14 + 0.1*free, inN); s.spec = mix(s.spec, 1.6, inN);
      s.h += (0.0025*smoothstep(0.004, -0.006, nd) + 0.0002*ridges*fadeC(lx*67.))*nside;
      s.nail = inN; s.sss = mix(s.sss, 0.5, inN);
      float fold = exp(-(nd - 0.004)*(nd - 0.004)/0.00003)*nside*(ly < cy + 0.3*hl ? 1. : 0.3);
      s.grime = max(s.grime, fold*0.9); s.rough = mix(s.rough, 0.7, fold*(1. - inN)); s.h -= 0.0015*fold;
    }
  } else if (side > 0.15) {                             // palm side: joint creases and prints
    float pal = smoothstep(0.15, 0.55, side);
    float brk = 0.5 + 0.7*sn(vec3(lx*25., ly*6., float(k)*3.));
    float c = (line(ly - Y.x + 0.018 + 0.01*lx, 0.0035) + 0.7*line(ly - Y.x + 0.004 - 0.008*lx, 0.003) + line(ly - Y.y + 0.006, 0.0035))*exp(-lx*lx/(0.5*r*r))*brk;
    s.h -= 0.0035*c*pal; s.grime = max(s.grime, c*pal*0.4);
    if (ly > Y.y + 0.05) {
      float tipc = Y.y + 0.55*Y.w; vec2 q = vec2(lx, (ly - tipc)/1.35); float a = atan(q.y, q.x);
      float rr2 = length(q) + 0.012*sin(a + 1.3) + 0.006*sin(2.*a) + 0.003*sin(a*5. + float(k));
      float pr = sin(rr2*6.2831/0.0068)*fadeC(rr2/0.0068)*smoothstep(0.1, 0.045, length(q))*pal;
      s.h += 0.0005*pr; s.rough = mix(s.rough, 0.6, pal*0.5);
      float cal = (k >= 2 ? 0.7 : 0.35)*smoothstep(0.08, 0.02, length(q))*pal; s.alb = mix(s.alb, vec3(0.6, 0.44, 0.28), cal*0.5); s.sss *= 1. - 0.3*cal;
    }
  }
  float gs = smoothstep(0.5, 0.85, NL.a)*(1. - min(abs(side), 1.))*0.7; s.grime = max(s.grime, gs*0.45);   // grease on the sides
}
void thumbDetail(vec3 p, inout S s){
  vec3 q = p - T_J2; float ax = dot(q, T_T2), dz = dot(q, T_D2), dx = dot(q, T_X2);
  float rr = length(vec2(dx, dz)), side = dz/max(rr, 1e-4);     // +1 on the nail side
  if (side > 0.3 && ax > 0.04) {
    float y0 = 0.1, y1 = T_L.z + 0.5*T_L.w, hw = 0.72*T_R.z, hl = (y1 - y0)*0.5, cy = (y0 + y1)*0.5, rc = ax < cy ? hw*0.6 : hw*0.35;
    vec2 qn = vec2(abs(dx) - hw + rc, abs(ax - cy) - hl + rc); float nd = length(max(qn, 0.)) + min(max(qn.x, qn.y), 0.) - rc;
    float ns = smoothstep(0.3, 0.5, side), inN = smoothstep(0.0015, -0.0015, nd)*ns;
    float lun = smoothstep(1.05, 0.9, length(vec2(dx/(0.6*hw), (ax - y0 + 0.01)/(0.22*(y1 - y0)))));
    float free = smoothstep(y1 - 0.03, y1 - 0.016, ax);
    vec3 na = mix(mix(vec3(0.62, 0.36, 0.33), vec3(0.8, 0.66, 0.6), lun*0.7), vec3(0.78, 0.72, 0.62), free);
    s.alb = mix(s.alb, na, inN); s.rough = mix(s.rough, 0.15, inN); s.spec = mix(s.spec, 1.6, inN); s.nail = inN;
    s.h += 0.0025*smoothstep(0.004, -0.006, nd)*ns;
    float fold = exp(-(nd - 0.004)*(nd - 0.004)/0.00003)*ns; s.grime = max(s.grime, fold*0.9); s.h -= 0.0015*fold;
  }
  vec3 q1 = p - T_J1; float a1 = dot(q1, T_T1), z1 = dot(q1, T_D1);
  float wr = pow(0.5 + 0.5*cos(6.2831*a1/0.014), 6.)*exp(-a1*a1/0.0025)*smoothstep(0., 0.08, z1)*fadeC(a1/0.014);
  s.h -= 0.003*wr*(1. - 0.6*uFlex[4]); s.grime = max(s.grime, wr*0.5);
  if (side < -0.3) { float c = line(a1 + 0.01, 0.004) + line(ax + 0.004, 0.004); s.h -= 0.004*c; s.grime = max(s.grime, c*0.6); }
}
S skinSurf(vec3 p, vec3 rn){
  S s; s.alb = vec3(0.42, 0.285, 0.215); s.h = 0.; s.rough = 0.38;
  // colour zones: a paler, yellower palm (thick skin), a darker tanned back, blood in the fingertips
  s.alb = mix(s.alb, vec3(0.49, 0.35, 0.26), smoothstep(0.2, 0.7, rn.z)*step(-0.1, p.y)*0.8);
  s.alb = mix(s.alb, vec3(0.36, 0.22, 0.155), smoothstep(-0.2, -0.7, rn.z)*0.7);
  if (p.y > 1.3) { float tip = smoothstep(1.55, 1.9, p.y + 0.25*abs(p.x)); s.alb = mix(s.alb, vec3(0.5, 0.22, 0.16), tip*0.45); } s.sss = 1.; s.spec = 1.; s.grime = 0.; s.nail = 0.;
  // weathered skin: blotches, pores, the dermal crosshatch; sun spots on the back
  NL = n4(p*0.3); NP = n4(p*3.4);
  float bl = NL.r*0.65 + NL.g*0.35; s.alb *= 0.88 + 0.24*bl; s.alb.r *= 1. + 0.1*(NL.b - 0.5);
  float pore = NP.r*0.6 + NP.g*0.4; s.h += 0.00035*(pore - 0.5)*fadeV(p*218.); s.rough += 0.08*(pore - 0.5);
  float c1 = sin((p.x + p.y)*260. + NP.b*6.), c2 = sin((p.x - p.y*0.7)*230. + NP.a*6.);
  s.h += 0.00014*(c1 + c2)*fadeV(p*41.4);
  if (rn.z < -0.25 && p.y > -2.3 && p.y < 1.05) { float spot = smoothstep(0.66, 0.78, NL.a*0.6 + NP.b*0.4); s.alb = mix(s.alb, vec3(0.34, 0.16, 0.09), spot*0.45); }
  s.alb = mix(s.alb, s.alb*vec3(0.74, 0.8, 1.08), vA.z*0.6);          // veins show blue-green through the skin (per vertex)
  if (p.y > 0.72 && vPart < 3.5) {
    int best = 0; float bd = 9.;
    for (int k = 0; k < 4; k++) { vec4 m = F_MCP[k], cs = F_CS[k]; vec2 d2 = p.xy - m.xy; float lx = d2.x*cs.x - d2.y*cs.y; if (abs(lx) < bd) { bd = abs(lx); best = k; } }
    vec4 m = F_MCP[best], cs = F_CS[best]; vec2 d2 = p.xy - m.xy; float ly = d2.x*cs.y + d2.y*cs.x;
    if (ly > -0.08) fingerDetail(best, p, s);
  }
  if (vPart > 3.5 && vPart < 4.5) thumbDetail(p, s);
  if (rn.z > 0.15 && p.y > -0.12 && p.y < 1.3 && abs(p.x) < 0.62) palmDetail(p, s);
  if (p.y < 0.05) {                                    // forearm: hair on the back and the thumb side, veins
    vec2 aa = armAng(p); float ang = aa.x, R = aa.y;
    vec2 hq = vec2(ang*R, p.y)*vec2(38., 26.), ci = floor(hq), cf = fract(hq) - 0.5;
    float hh = h1(ci), dens = smoothstep(0.6, -1.2, ang)*0.8 + 0.12;
    vec2 dir = normalize(vec2(0.35*(hh - 0.5), -1.)); float along = dot(cf - (vec2(h1(ci + 3.), h1(ci + 7.)) - 0.5)*0.4, dir), acr = dot(cf, vec2(-dir.y, dir.x));
    float hair = step(1. - dens, hh)*smoothstep(0.07, 0.02, abs(acr))*smoothstep(0.45, 0.2, abs(along))*fadeC(hq.x)*smoothstep(0.02, -0.25, p.y);
    s.alb = mix(s.alb, vec3(0.16, 0.08, 0.05), hair*0.3);
  }
  s.alb = mix(s.alb, vec3(0.09, 0.06, 0.045), sat(s.grime)*0.6);
  return s;
}
// chambray: indigo warp, pale weft, a 3/1 twill; the roll shows the fabric's pale back; gold topstitching on the seam
vec3 cloth(vec3 p, out float h){
  vec2 aa = armAng(p); float ang = aa.x, u = ang*0.46, v = p.y;
  float tw = fract((u + v)*42.5), warp = step(0.25, tw), fine = 0.5 + 0.5*sin(u*680.)*sin(v*680.);
  vec3 indigo = vec3(0.19, 0.3, 0.56)*(0.8 + 0.4*fbm3(vec3(u*0.5, v*0.5, 0.2))), weft = vec3(0.7, 0.7, 0.68);
  vec3 c = mix(weft, indigo, warp*0.85 + 0.1)*(0.88 + 0.24*fbm3(vec3(u*0.2, v*3., 3.)));
  float roll = smoothstep(CUFF.x + 0.02, CUFF.x - 0.01, p.y)*smoothstep(CUFF.y - 0.02, CUFF.y + 0.01, p.y);
  c = mix(c, mix(vec3(0.44, 0.47, 0.54), vec3(0.2, 0.25, 0.38), warp*0.5), roll*0.8);
  float seamA = abs(ang - 2.75), st = step(0.5, fract(v*55.))*(line(seamA*0.46 - 0.012, 0.0022) + line(seamA*0.46 + 0.012, 0.0022));
  c = mix(c, vec3(0.9, 0.6, 0.25), st*0.8*(1. - roll));
  c = mix(c, vec3(0.7, 0.72, 0.74), line(p.y - CUFF.x + 0.03, 0.01)*roll*0.4);
  h = 0.0012*(warp - 0.5)*fadeC((u + v)*42.5) + 0.0008*fine*fadeC(u*108.) + 0.0006*st;
  return c;
}
void main(){
  if (uDebug == 5) { o = vec4(0.5, 0.3, 0.2, 1.); return; }
  vec3 V = normalize(uEye - vW), N0 = normalize(vN);
  bool back = !gl_FrontFacing; if (back) N0 = -N0;
  // dissolving into light at the gear (b64.3+): the knuckle row first; the inside of the fist is full of light
  float burn = 0.;
  if (uDis > 0.) {
    float nz = sn(vR*3.)*0.6 + sn(vR*9. + 2.)*0.4;
    float k0 = 64.44 + clamp(abs(vR.y - 0.93)*1.1 + nz*0.3, 0., 1.35);
    if (uB > k0) discard;
    burn = smoothstep(k0 - 0.1, k0, uB);
  }
  if (back) { o = vec4(vec3(1., 0.62, 0.25)*(1.5 + 3.*uDis), 1.); return; }
  S s;           // two programs (SwiftShader runs every branch under lane masks, so skin and cloth never share one)
#ifdef SLEEVE
  { float hh; s.alb = cloth(vR, hh); s.h = hh; s.rough = 0.8; s.sss = 0.; s.spec = 0.25; s.grime = 0.; s.nail = 0.; }
#elif defined(NOSURF)
  s.alb = vec3(0.42, 0.285, 0.215); s.h = 0.; s.rough = 0.4; s.sss = 1.; s.spec = 1.; s.grime = 0.; s.nail = 0.;
#else
  s = skinSurf(vR, vec3(0., 0., vA.x));      // only the rest normal's z (palm side +) is used
#endif
  // bump from the height field (world units), surface-gradient method
  float H = s.h*uHandS;
  vec3 dpx = dFdx(vW), dpy = dFdy(vW); float dhx = dFdx(H), dhy = dFdy(H);
  vec3 r1 = cross(dpy, N0), r2 = cross(N0, dpx); float det = dot(dpx, r1);
  vec3 Nb = abs(det)*N0 - sign(det)*(dhx*r1 + dhy*r2); vec3 N = dot(Nb, Nb) > 1e-20 ? normalize(Nb) : N0;
  float ndv = sat(dot(N, V));
  if (uDebug == 3) { float k = vPart; o = vec4(0.5 + 0.5*cos(6.2831*(k/8. + vec3(0., 0.33, 0.67))), 1.)*(0.3 + 0.7*sat(dot(N0, V))); return; }
  if (uDebug == 4) { o = vec4(vec3(sat(dot(N, V))), 1.)*vec4(1., vL.x, vL.z, 1.); return; }
  if (uDebug > 0) { vec3 L = normalize(V + vec3(0.3, 0.5, 0.)); vec3 Nd = uDebug == 1 ? N0 : N; o = vec4(vec3(0.55)*(0.15 + 0.85*sat(dot(Nd, L))) + 0.2*vec3(vL.x, vL.z, vL.w)*0., 1.); return; }
  float ao = vL.z*mix(1., vL.w, 0.85)*(1. - 0.35*sat(s.grime));
  // key: the falls above. skin: red bleeds past the terminator and into the shadow's edge
  float nl = dot(N, uKeyDir), sk = clamp(vL.x, 0., 1.);   // (interpolation can dip below 0 at edges: sqrt below)
  vec3 wrapW = s.sss*vec3(0.42, 0.16, 0.09) + uSleeve*0.2;
  vec3 dif = clamp((vec3(nl) + wrapW)/(1. + wrapW), 0., 1.);
  vec3 col = s.alb*uKeyCol*dif*mix(vec3(sk), vec3(sqrt(sk), sk, sk*sk), s.sss);
  vec3 Hh = normalize(uKeyDir + V); float nh = sat(dot(N, Hh));
  float a2 = pow(s.rough, 4.), dd = nh*nh*(a2 - 1.) + 1., ggx = min(a2/(3.1416*dd*dd), 40.);
  float fr = 0.028 + 0.972*pow(1. - sat(dot(Hh, V)), 5.);
  col += uKeyCol*(ggx*1.2 + 0.25*pow(nh, 14.))*fr*sat(nl)*sk*s.spec*(1. - 0.8*sat(s.grime));
  // the pool of light in the palm
  vec3 pd = uPoolPos - vW; float pl = length(pd); pd /= pl;
  float att = 1./(1. + pow(pl/(0.55*uHandS), 2.)), pn = dot(N, pd);
  col += s.alb*uPoolCol*clamp((vec3(pn) + wrapW)/(1. + wrapW), 0., 1.)*att*vL.y;
  { vec3 Hp = normalize(pd + V); float np = sat(dot(N, Hp)), ap = pow(max(s.rough, 0.3), 4.), dp = np*np*(ap - 1.) + 1.;
    col += uPoolCol*att*vL.y*min(ap/(3.1416*dp*dp), 40.)*0.04*sat(pn)*s.spec; }
  // fill: the glow of the falls and the room from the front, unshadowed
  float nf = dot(N, uFillDir); col += s.alb*uFillCol*clamp((vec3(nf) + wrapW)/(1. + wrapW), 0., 1.)*ao;
  // the red room: hemisphere ambient and a hot rim from behind
  col += s.alb*mix(uAmbDn, uAmbUp, 0.5 + 0.5*N.y)*ao*(1. + 1.5*uSleeve);
  float rim = pow(1. - ndv, 3.2)*(0.35 + 0.65*sat(dot(N, uRimDir) + 0.3));
  col += uRimCol*rim*(0.25 + 0.75*s.spec*(1. - s.rough*0.6))*ao*(1. - 0.6*uSleeve);
  // translucency: thin flesh lit from behind glows red
  float tr = exp(-max(vA.y, 0.05)*9.)*s.sss;
  col += vec3(1., 0.16, 0.05)*tr*(sat(-nl + 0.3)*length(uKeyCol)*0.35*sk + sat(dot(-N, uRimDir) + 0.4)*uTrans*pow(1. - ndv, 1.5))*(1. - uSleeve);
  col *= mix(1., ao, 0.35);
  col += vec3(1., 0.5, 0.15)*burn*burn*2.5 + vec3(1., 0.85, 0.6)*pow(burn, 10.)*3.;
  col += vec3(1., 0.4, 0.1)*uGlow*(0.4 + pow(1. - ndv, 2.))*(1. - uSleeve);
  o = vec4(any(isnan(col)) || any(isinf(col)) ? vec3(0.) : col, 1.);
}`;

export const HAND_FS_SKIN = HAND_FS, HAND_FS_SLEEVE = HAND_FS.replace('#version 300 es\n', '#version 300 es\n#define SLEEVE\n');
// noise volume for pores and cloth: 64^3 RGBA, trilinear, repeating
export function noiseTex3D(gl, R) {
  const n = 64, d = new Uint8Array(n * n * n * 4); for (let i = 0; i < d.length; i++) d[i] = Math.floor(R() * 256);
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, t);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, n, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return t;
}
export function meshVAO(gl, m) {
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  [[m.pos, 3], [m.nor, 3], [m.skin, 4], [m.aux, 4]].forEach(([a, k], i) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, a, gl.STATIC_DRAW); gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, k, gl.FLOAT, false, 0, 0); });
  const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: m.idx.length, type: m.idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
}
