// the hand: an analytic SDF of a working hand, sampled once at load and skinned on 16 bones in the vertex stage.
// palm +z, fingers +y, unit = palm width. Rest = fingers straight; poses are joint angles (open/cupped, mid, fist).
const nrm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const v3 = { add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] };
const FINGERS = [   // pinky .. index; MCP x, y, phalanx lengths, radius, splay
  { x: -0.35, y: 0.9, len: [0.33, 0.22, 0.19], r: 0.088, s: -0.2 },
  { x: -0.12, y: 0.99, len: [0.41, 0.27, 0.21], r: 0.1, s: -0.07 },
  { x: 0.12, y: 1.02, len: [0.45, 0.3, 0.22], r: 0.104, s: 0.03 },
  { x: 0.35, y: 0.97, len: [0.41, 0.26, 0.2], r: 0.098, s: 0.13 },
];
const FR = [1, 0.9, 0.8];                            // radius per phalanx
const THUMB = { base: [0.3, 0.12, 0.05], len: [0.38, 0.28, 0.23], r: [0.13, 0.118, 0.104],
  dirs: [[[0.72, 0.62, 0.3], [0.55, 0.8, 0.28], [0.42, 0.88, 0.25]],                 // open: out and up, a little forward
    [[0.5, 0.62, 0.6], [0.05, 0.66, 0.75], [-0.35, 0.45, 0.82]],
    [[0.28, 0.62, 0.73], [-0.55, 0.42, 0.72], [-0.95, 0.05, 0.3]]].map(p => p.map(nrm)) };   // fist: across the curled fingers
const POSE_CURL = [[0.28, 0.32, 0.18], [0.85, 1.05, 0.65], [1.52, 1.78, 1.2]];
const POSE_SPLAY = [1, 0.55, 0.1];
// rest chains (joint positions, dirs)
const CH = [];
for (const f of FINGERS) {
  const T = [Math.sin(f.s), Math.cos(f.s), 0], J = [[f.x, f.y, 0]];
  for (let j = 0; j < 3; j++) J.push(v3.add(J[j], v3.mul(T, f.len[j])));
  CH.push({ J, T: [T, T, T], r: FR.map(k => f.r * k), len: f.len, f });
}
{ const T = THUMB.dirs[0], J = [THUMB.base];
  for (let j = 0; j < 3; j++) J.push(v3.add(J[j], v3.mul(T[j], THUMB.len[j])));
  CH.push({ J, T, r: THUMB.r, len: THUMB.len, thumb: 1 }); }
const boneOf = (c, j) => c < 4 ? 1 + c * 3 + j : 13 + j;
const parentOf = b => b === 0 ? 0 : b >= 13 ? (b === 13 ? 0 : b - 1) : ((b - 1) % 3 === 0 ? 0 : b - 1);
// posed chain dirs for pose value q in [0, 2]
function posedDirs(c, q) {
  const k = Math.min(1, Math.floor(q)), u = q - k;
  if (CH[c].thumb) return [0, 1, 2].map(j => nrm(v3.add(v3.mul(THUMB.dirs[k][j], 1 - u), v3.mul(THUMB.dirs[k + 1][j], u))));
  const f = FINGERS[c], cu = [0, 1, 2].map(j => POSE_CURL[k][j] * (1 - u) + POSE_CURL[k + 1][j] * u);
  const s = f.s * (POSE_SPLAY[k] * (1 - u) + POSE_SPLAY[k + 1] * u);
  let a = 0; return cu.map(x => { a += x; return [Math.sin(s) * Math.cos(a), Math.cos(s) * Math.cos(a), Math.sin(a)]; });
}
// rotation taking unit a to unit b (minimal), as a 3x3 row-major array
function rotAB(a, b) {
  const v = cross(a, b), c = v3.dot(a, b), k = 1 / (1 + c + 1e-9);
  return [v[0] * v[0] * k + c, v[0] * v[1] * k - v[2], v[0] * v[2] * k + v[1],
    v[1] * v[0] * k + v[2], v[1] * v[1] * k + c, v[1] * v[2] * k - v[0],
    v[2] * v[0] * k - v[1], v[2] * v[1] * k + v[0], v[2] * v[2] * k + c];
}
// bone matrices (column-major mat4 x16) for pose q: M_j = T(Jposed_j) R_j T(-Jrest_j)
export function handBones(q) {
  const out = new Float32Array(16 * 16);
  const id = b => out.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], b * 16);
  id(0);
  CH.forEach((ch, c) => {
    const D = posedDirs(c, q); let P = ch.J[0];
    for (let j = 0; j < 3; j++) {
      const R = rotAB(ch.T[j], D[j]), Jr = ch.J[j];
      const tx = P[0] - (R[0] * Jr[0] + R[1] * Jr[1] + R[2] * Jr[2]), ty = P[1] - (R[3] * Jr[0] + R[4] * Jr[1] + R[5] * Jr[2]), tz = P[2] - (R[6] * Jr[0] + R[7] * Jr[1] + R[8] * Jr[2]);
      out.set([R[0], R[3], R[6], 0, R[1], R[4], R[7], 0, R[2], R[5], R[8], 0, tx, ty, tz, 1], boneOf(c, j) * 16);
      P = v3.add(P, v3.mul(D[j], ch.len[j]));
    }
  });
  return out;
}
// ---------------------------------------------------------------- SDF
const smin = (a, b, k) => { const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / k)); return b * (1 - h) + a * h - k * h * (1 - h); };
const sdEll = (p, c, r) => { const q = [(p[0] - c[0]) / r[0], (p[1] - c[1]) / r[1], (p[2] - c[2]) / r[2]]; return (Math.hypot(...q) - 1) * Math.min(r[0], r[1], r[2]); };
function sdSeg(p, a, b, ra, rb) {           // round cone, approximated: capsule with lerped radius
  const pa = v3.sub(p, a), ba = v3.sub(b, a), h = Math.max(0, Math.min(1, v3.dot(pa, ba) / v3.dot(ba, ba)));
  return Math.hypot(...v3.sub(pa, v3.mul(ba, h))) - (ra + (rb - ra) * h);
}
function sdRBox(p, c, b, r) { const q = [Math.abs(p[0] - c[0]) - b[0], Math.abs(p[1] - c[1]) - b[1], Math.abs(p[2] - c[2]) - b[2]];
  return Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0)) + Math.min(Math.max(q[0], q[1], q[2]), 0) - r; }
// component distances; returns [d, comp] where comp: 0 palm, 1 thenar, 2 wrist/forearm, 3 sleeve, 10+c*4+j phalanx, 30+c nail
function comps(p) {
  const out = [];
  const tp = [p[0] / (0.84 + 0.16 * Math.min(1, Math.max(0, p[1]))), p[1], p[2]];           // palm narrows to the wrist
  let palm = sdRBox(tp, [0, 0.5, -0.005], [0.4, 0.45, 0.045], 0.085);
  palm = smin(palm, sdEll(p, [-0.3, 0.42, 0.055], [0.14, 0.33, 0.09]), 0.07);                 // hypothenar
  palm = smin(palm, sdEll(p, [0.0, 0.88, 0.05], [0.42, 0.09, 0.06]), 0.08);                 // the pads under the fingers
  for (const f of FINGERS) palm = smin(palm, sdEll(p, [f.x, f.y - 0.04, -0.035], [0.1, 0.09, 0.085]), 0.05);   // knuckle heads (back)
  out.push(palm);
  out.push(sdEll(p, [0.25, 0.27, 0.06], [0.2, 0.27, 0.115]));                                // thenar
  { const q = [p[0] / 1.2, p[1], p[2] / 0.82]; out.push(sdSeg(q, [0, 0.12, -0.005], [0, -2.9, -0.33], 0.3, 0.37)); }   // wrist, forearm
  { const y = p[1], ang = Math.atan2(p[2] + 0.1, p[0]), q = [p[0] / 1.2, p[1], p[2] / 0.82];            // sleeve: canvas cuff with folds
    const fold = 0.018 * Math.sin(ang * 5 + y * 3.1) + 0.012 * Math.sin(ang * 11 - y * 7) + 0.03 * Math.exp(-(((y + 0.98) / 0.05) ** 2));
    out.push(Math.max(sdSeg(q, [0, -0.9, -0.1], [0, -3.2, -0.37], 0.37, 0.43) - fold, y + 0.93)); }
  CH.forEach((ch, c) => {
    for (let j = 0; j < 3; j++) {
      const a = ch.J[j], b = ch.J[j + 1], ra = ch.r[j] * (j ? 1.02 : 1.05), rb = j === 2 ? ch.r[j] * 0.8 : ch.r[j + 1] * 1.06;
      let d = sdSeg(p, a, b, ra, rb);
      // pads: the palm side of each phalanx bulges between the joints
      const ba = v3.sub(b, a), h = Math.max(0, Math.min(1, v3.dot(v3.sub(p, a), ba) / v3.dot(ba, ba)));
      d -= 0.012 * Math.sin(Math.PI * h) * Math.max(0, p[2] - a[2]) / ch.r[j];
      out.push(d);
    }
    // nail: a flattened shell on the back of the last phalanx
    const a = ch.J[2], T = ch.T[2], L = ch.len[2], r = ch.r[2];
    const X = nrm(cross(T, [0, 0, 1])), Zb = ch.thumb ? nrm(cross(X, T)) : [0, 0, -1];
    const c0 = v3.add(v3.add(a, v3.mul(T, L * 0.5)), v3.mul(Zb, r * 0.74)), q = v3.sub(p, c0);
    out.push(sdEll([v3.dot(q, X), v3.dot(q, T), v3.dot(q, Zb)], [0, 0, 0], [r * 0.74, L * 0.36, r * 0.2]));
  });
  return out;
}
function sdf(p) {
  const c = comps(p);
  let skin = smin(c[0], c[1], 0.09);
  skin = smin(skin, c[2], 0.13);
  for (let k = 0; k < 5; k++) {
    const base = 4 + k * 4;
    let fing = Math.min(c[base], c[base + 1], c[base + 2]);
    fing = smin(fing, Math.min(c[base], c[base + 1]), 0.02);
    skin = k === 4 ? smin(skin, fing, 0.1) : smin(skin, fing, 0.07);
    skin = Math.min(skin, c[base + 3] + 0.004);      // the nail sits proud
  }
  return Math.min(skin, c[3]);
}
const grad = p => { const e = 1e-3, d = sdf(p);
  return nrm([sdf([p[0] + e, p[1], p[2]]) - d, sdf([p[0], p[1] + e, p[2]]) - d, sdf([p[0], p[1], p[2] + e]) - d]); };
// palm creases (2D, on the palm face): heart, head, life lines; returns distance to nearest
function palmCrease(x, y) {
  const heart = Math.abs(y - (0.74 + 0.06 * Math.sin((x + 0.45) * 3.3) - 0.07 * Math.max(0, x - 0.1) * 3)) * (x < 0.32 ? 1 : 9);
  const head = Math.abs(y - (0.6 - 0.2 * (0.42 - x) * (0.42 - x))) * (x > -0.3 && x < 0.42 ? 1 : 9);
  const lr = Math.hypot((x - 0.46) / 0.36, (y - 0.12) / 0.52), life = Math.abs(lr - 1) * 0.36 * (y > 0.08 && y < 0.62 && x < 0.44 ? 1 : 9);
  return Math.min(heart, head, life);
}
// sample: returns arrays per point [pos, normal, bone, parent, w, material, crease, thin, ridge, palmness]
export function sampleHand(n, R) {
  const out = [];
  // proposal: pick a component by rough area, a point near it, then project to the surface
  const props = [
    [0.2, () => [(R() - 0.5) * 0.95, R() * 1.02, R() < 0.62 ? 0.14 : -0.13]],           // palm faces (front heavier)
    [0.05, () => [0.25 + (R() - 0.5) * 0.4, 0.27 + (R() - 0.5) * 0.5, 0.15]],
    [0.08, () => { const a = R() * Math.PI * 2, y = 0.1 - R() * 1.05; return [Math.cos(a) * 0.45, y, Math.sin(a) * 0.32 - 0.02]; }],
    [0.13, () => { const a = R() * Math.PI * 2, y = -0.9 - R() * 1.6; return [Math.cos(a) * 0.55, y, Math.sin(a) * 0.4 - 0.15]; }],
    [0.57, null],
  ];
  const cum = []; let s = 0; for (const [w] of props) cum.push(s += w);
  let tries = 0;
  while (out.length < n && tries < n * 8) {
    tries++;
    const k = R() * s; let pi = 0; while (cum[pi] < k) pi++;
    let p;
    if (props[pi][1]) p = props[pi][1]();
    else {
      const c = Math.floor(R() * 5), ch = CH[c], j = R() < 0.42 ? 0 : R() < 0.55 ? 1 : 2, u = R() * (j === 2 ? 1.35 : 1.08) - 0.04, ph = R() * Math.PI * 2;
      const T = ch.T[j], X = nrm(cross(T, [0, 0, 1])), Z = cross(X, T), r = ch.r[j];
      p = v3.add(v3.add(ch.J[j], v3.mul(T, ch.len[j] * u)), v3.add(v3.mul(X, Math.cos(ph) * r), v3.mul(Z, Math.sin(ph) * r)));
    }
    let d = 0;
    for (let it = 0; it < 6; it++) { d = sdf(p); if (Math.abs(d) < 2e-4) break; p = v3.sub(p, v3.mul(grad(p), d)); }
    if (Math.abs(d) > 2e-3 || p[1] < -2.9) continue;
    const N = grad(p), c = comps(p);
    let best = 0; for (let i = 1; i < c.length; i++) if (c[i] < c[best]) best = i;
    let bone = 0, w = 1, mat = 0, crease = 0, thin = 0, ridge = 0, palmness = 0;
    if (best === 3) mat = 2;
    else if (best >= 4) {
      const cc = Math.floor((best - 4) / 4), jj = (best - 4) % 4, ch = CH[cc];
      if (jj === 3) { mat = 1; bone = boneOf(cc, 2); }
      else {
        let j = jj, along = v3.dot(v3.sub(p, ch.J[j]), ch.T[j]);
        if (j < 2 && along > ch.len[j] - 0.5 * ch.r[j]) { along -= ch.len[j]; j++; }
        bone = boneOf(cc, j); w = Math.max(0, Math.min(1, 0.5 + along / (1.3 * ch.r[j])));
        const X = nrm(cross(ch.T[j], [0, 0, 1])), front = v3.dot(N, cross(X, ch.T[j]));   // + = palm side
        thin = 1 - Math.abs(v3.dot(N, X)) * 0.2;
        // flexion creases on the palm side at each joint; knuckle wrinkles on the back
        const ax = v3.dot(v3.sub(p, ch.J[j]), ch.T[j]), axd = v3.dot(v3.sub(p, ch.J[j + 1]), ch.T[j]);
        const cr = Math.exp(-(((ax + 0.012) / 0.011) ** 2)) + (j === 0 && !ch.thumb ? Math.exp(-(((ax - 0.05) / 0.01) ** 2)) * 0.8 : 0) + (j === 1 ? Math.exp(-(((ax + 0.035) / 0.01) ** 2)) * 0.7 : 0);
        if (front > 0.25) { crease = Math.min(1, cr); if (j === 2 && axd > -0.12) mat = 3; }
        else if (front < -0.2 && j >= 1) crease = 0.5 * Math.min(1, [-0.022, 0, 0.022].reduce((a, o) => a + Math.exp(-(((ax - o) / 0.006) ** 2)), 0));
      }
    } else if (best === 1) { bone = 13; w = 0.35; }
    if (mat === 0 && best <= 2) {
      palmness = N[2] > 0.5 && p[1] > 0 ? Math.max(0, 1 - Math.hypot(p[0] / 0.45, (p[1] - 0.5) / 0.48)) : 0;
      if (N[2] > 0.5 && p[1] > 0.02) {
        const pc = palmCrease(p[0], p[1]); crease = Math.max(crease, Math.exp(-((pc / 0.009) ** 2)));
        crease = Math.max(crease, 0.35 * Math.exp(-((Math.abs(p[1] - 0.05) / 0.01) ** 2)));             // wrist bracelet lines
        if (p[1] > 0.84 || (p[0] < -0.2 && p[1] < 0.6) ) mat = 3;                                         // calluses at the finger roots and heel
      }
      if (N[2] < -0.3 && p[1] > -0.2 && p[1] < 0.95) {                                                     // tendons to each knuckle, a vein
        for (const f of FINGERS) { const u = Math.max(0, (p[1] + 0.1) / (f.y + 0.1)), tx = f.x * (0.35 + 0.65 * u); ridge = Math.max(ridge, Math.exp(-(((p[0] - tx) / 0.026) ** 2)) * Math.sin(Math.PI * Math.min(1, u))); }
        const vx = -0.05 + 0.12 * Math.sin(p[1] * 5.5); ridge = Math.max(ridge, 0.7 * Math.exp(-(((p[0] - vx) / 0.018) ** 2)));
      }
      thin = best === 0 ? Math.max(0, 1 - Math.abs(Math.abs(p[0]) - 0.5) / 0.1) * 0.7 : 0;
    }
    out.push([p, N, bone, parentOf(bone), w, mat, crease, thin, ridge, palmness]);
  }
  return out;
}
export { FINGERS, CH };
