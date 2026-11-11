// CIVILIZATION v10: the working hand that takes the planners' gold, as a point cloud printed on the press.
// The geometry is MELTDOWN v8's point-cloud working hand (scenes/meltdown7.js, the payoff the client asked back:
// "the old monopoly fist animation"), copied here so this piece owns it: a palm slab with thenar and hypothenar pads,
// four fingers of three phalanges with knuckle pads and nail beds, an opposable thumb, the forearm, and three poses
// (0 open and cupped, 1 half closed, 2 the fist). Added for v10: a rolled work-shirt cuff at the forearm, the knuckle
// heads of the fist, nail plates, and the palm's creases as polylines (life, head, heart lines), so the hand can be
// drawn as an engraving (black stipple in the shadows, the red tone for the body, bare stock for the lights).
//
// Local frame: palm +z (toward the camera at rest), fingers +y, thumb toward +x (a right hand), unit = palm width,
// wrist crease at y = 0, forearm down -y. makeHand(seed, n) -> { n, P0, P1, P2 (xyz per pose), N0, N2, kind, tone, crease }
// kind: 0 skin, 1 pool (the gold held in the palm), 2 cuff, 3 nail. tone: a stable per-point threshold in [0, 1).

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const nrm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export const FINGERS = [   // pinky .. index; x, base y, lengths, radius, splay (meltdown7 v8 values)
  { x: -0.37, y: 0.93, len: [0.34, 0.21, 0.17], r: 0.092, s: -0.34 },
  { x: -0.125, y: 1.0, len: [0.43, 0.27, 0.2], r: 0.104, s: -0.11 },
  { x: 0.13, y: 1.02, len: [0.46, 0.3, 0.21], r: 0.108, s: 0.06 },
  { x: 0.375, y: 0.98, len: [0.41, 0.26, 0.19], r: 0.102, s: 0.24 },
];
const CURL = [[0.32, 0.36, 0.2], [0.8, 0.98, 0.62], [1.5, 1.75, 1.15]];
const SPLAY = [1, 0.5, 0];
const THUMB = {
  base: [0.46, 0.2, 0.06], len: [0.36, 0.28, 0.22], r: [0.125, 0.115, 0.1],
  dirs: [[[0.75, 0.55, 0.25], [0.55, 0.8, 0.22], [0.35, 0.92, 0.2]],
    [[0.5, 0.6, 0.55], [0.0, 0.62, 0.72], [-0.4, 0.4, 0.75]],
    [[0.2, 0.6, 0.75], [-0.62, 0.35, 0.7], [-0.92, -0.1, 0.38]]].map(p => p.map(nrm)),
};

function fingerFrame(f, seg, u, pose) {   // the centre point, tangent and side axes along a finger
  const c = CURL[pose], s = f.s * SPLAY[pose];
  let P = [f.x, f.y, 0], ang = 0;
  for (let j = 0; j <= seg; j++) {
    ang += c[j];
    const T = [Math.sin(s) * Math.cos(ang), Math.cos(s) * Math.cos(ang), Math.sin(ang)];
    const L = f.len[j] * (j === seg ? u : 1);
    P = [P[0] + T[0] * L, P[1] + T[1] * L, P[2] + T[2] * L];
    if (j === seg) { const X = [Math.cos(s), -Math.sin(s), 0], U = cross(T, X); return { P, T, X, U }; }
  }
}
function fingerPoint(f, seg, u, phi, pose) {
  const { P, X, U } = fingerFrame(f, seg, u, pose);
  // radius: tapering phalanges, a swelling at each joint (the knuckle pads), the rounded tip
  const joint = Math.exp(-(((u - 0.02) / 0.1) ** 2)) * 0.14 + (seg === 0 ? Math.exp(-(((u - 0.0) / 0.14) ** 2)) * 0.12 * Math.max(0, Math.sin(phi)) : 0);
  const r = f.r * (1 - 0.12 * seg - 0.08 * u) * (1 + joint) * (seg === 2 && u > 0.8 ? Math.sqrt(Math.max(0.05, 1 - ((u - 0.8) / 0.25) ** 2)) : 1);
  const n = [X[0] * Math.cos(phi) + U[0] * Math.sin(phi), X[1] * Math.cos(phi) + U[1] * Math.sin(phi), X[2] * Math.cos(phi) + U[2] * Math.sin(phi)];
  return [[P[0] + n[0] * r, P[1] + n[1] * r, P[2] + n[2] * r], n];
}
function thumbPoint(seg, u, phi, pose) {
  let P = THUMB.base.slice();
  for (let j = 0; j <= seg; j++) {
    const T = THUMB.dirs[pose][j], L = THUMB.len[j] * (j === seg ? u : 1);
    P = [P[0] + T[0] * L, P[1] + T[1] * L, P[2] + T[2] * L];
    if (j === seg) {
      const X = nrm(cross(T, [0, 0, 1])), U = cross(T, X);
      const r = THUMB.r[j] * (1 + Math.exp(-(((u - 0.02) / 0.1) ** 2)) * 0.1) * (seg === 2 && u > 0.8 ? Math.sqrt(Math.max(0.05, 1 - ((u - 0.8) / 0.25) ** 2)) : 1);
      const n = [X[0] * Math.cos(phi) + U[0] * Math.sin(phi), X[1] * Math.cos(phi) + U[1] * Math.sin(phi), X[2] * Math.cos(phi) + U[2] * Math.sin(phi)];
      return [[P[0] + n[0] * r, P[1] + n[1] * r, P[2] + n[2] * r], n];
    }
  }
}
function palmPoint(R) {       // rounded slab with thenar/hypothenar pads; returns [pos, normal]
  const k = R();
  if (k < 0.62) {             // palm face (z+) and back (z-)
    const front = R() < 0.62, x = (R() - 0.5) * 0.98, y = 0.02 + R() * 0.96;
    const pad = Math.exp(-(((x - 0.28) / 0.2) ** 2 + ((y - 0.28) / 0.26) ** 2)) * 0.09 + Math.exp(-(((x + 0.3) / 0.18) ** 2 + ((y - 0.35) / 0.3) ** 2)) * 0.05
      + Math.exp(-(((y - 0.9) / 0.07) ** 2)) * 0.05;
    const cup = -0.07 * (1 - 4 * x * x) * Math.sin(Math.PI * y);
    // the back of the hand: the four metacarpal ridges running to the knuckle heads
    const ridge = front ? 0 : FINGERS.reduce((a, f) => a + Math.exp(-(((x - f.x * 0.9) / 0.06) ** 2)) * 0.025 * y, 0) + Math.exp(-(((y - 0.93) / 0.06) ** 2)) * 0.04;
    const z = front ? 0.14 + pad + cup : -0.13 - 0.02 * Math.sin(Math.PI * y) - ridge;
    return [[x, y, z], front ? nrm([-(x * 0.3), -0.05, 1]) : [0, 0, -1]];
  }
  const a = R() * TAU, y = R();  // rim around the palm
  const x = Math.cos(a) * 0.5, z = Math.sin(a) * 0.14;
  if (R() < 0.7) return [[Math.sign(x) * 0.5 + (x - Math.sign(x) * 0.5) * 0.3, y, z], nrm([Math.sign(x), 0, Math.sin(a) * 0.6])];
  return [[(R() - 0.5), 0.02, z], [0, -1, 0]];
}
function forearmPoint(R) {
  const u = R(), phi = R() * TAU, r = lerp(0.34, 0.44, u);
  const P = [0, lerp(0.05, -1.55, u), lerp(-0.01, -0.2, u)];
  const n = [Math.cos(phi), 0, Math.sin(phi)];
  return [[P[0] + n[0] * r * 1.25, P[1], P[2] + n[2] * r * 0.8], n];
}
// the rolled work-shirt sleeve: a thick double roll (two tori) and the sleeve below it, with folds
function cuffPoint(R) {
  const phi = R() * TAU, k = R();
  const n = [Math.cos(phi), 0, Math.sin(phi)];
  if (k < 0.55) {             // the roll: two stacked rounded bands
    const band = R() < 0.5 ? 0 : 1, th = R() * TAU, y0 = -1.55 - band * 0.2, rr = 0.1;
    const R0 = 0.5 + 0.03 * Math.sin(phi * 3 + band) + 0.02 * Math.sin(phi * 7);
    const y = y0 + Math.sin(th) * rr, rad = R0 + Math.cos(th) * rr;
    return [[n[0] * rad * 1.22, y, -0.2 + n[2] * rad * 0.82], nrm([n[0] * Math.cos(th), Math.sin(th), n[2] * Math.cos(th)])];
  }
  const y = lerp(-1.85, -3.0, R()), fold = 0.03 * Math.sin(phi * 5 + y * 6) + 0.02 * Math.sin(phi * 11 - y * 3);
  const rad = 0.55 + fold + (y < -2.5 ? (y + 2.5) * -0.08 : 0);
  return [[n[0] * rad * 1.22, y, -0.22 + n[2] * rad * 0.82], n];
}

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function makeHand(seed = 1936, n = 60000) {
  const R = rng(seed);
  const P0 = new Float32Array(n * 3), P1 = new Float32Array(n * 3), P2 = new Float32Array(n * 3);
  const N0 = new Float32Array(n * 3), N2 = new Float32Array(n * 3), kind = new Uint8Array(n), tone = new Float32Array(n);
  const put = (A, i, v) => { A[i * 3] = v[0]; A[i * 3 + 1] = v[1]; A[i * 3 + 2] = v[2]; };
  for (let i = 0; i < n; i++) {
    tone[i] = R();
    const k = R();
    let p0, p1, p2, n0, n2, kd = 0;
    if (k < 0.12) { const [p, q] = forearmPoint(R); p0 = p1 = p2 = p; n0 = n2 = q; }
    else if (k < 0.2) { const [p, q] = cuffPoint(R); p0 = p1 = p2 = p; n0 = n2 = q; kd = 2; }
    else if (k < 0.43) { const [p, q] = palmPoint(R); p0 = p1 = p2 = p; n0 = n2 = q; }
    else if (k < 0.76) {
      const f = FINGERS[Math.floor(R() * 4)], sr = R(), seg = sr < 0.45 ? 0 : sr < 0.77 ? 1 : 2, u = R() * 1.05, phi = R() * TAU;
      [p0, n0] = fingerPoint(f, seg, u, phi, 0); [p1] = fingerPoint(f, seg, u, phi, 1); [p2, n2] = fingerPoint(f, seg, u, phi, 2);
      // the nail plate: the back of the distal phalanx (U = T x X points to the back, -z, at rest)
      if (seg === 2 && u > 0.35 && u < 0.95 && Math.sin(phi) > 0.72) kd = 3;
    } else if (k < 0.88) {
      const sr = R(), seg = sr < 0.42 ? 0 : sr < 0.75 ? 1 : 2, u = R() * 1.05, phi = R() * TAU;
      [p0, n0] = thumbPoint(seg, u, phi, 0); [p1] = thumbPoint(seg, u, phi, 1); [p2, n2] = thumbPoint(seg, u, phi, 2);
      if (seg === 2 && u > 0.35 && u < 0.95 && Math.sin(phi) > 0.72) kd = 3;
    } else {                  // the pool: what the palm holds, pressed small as the hand closes
      const r = Math.pow(R(), 0.6), a = R() * TAU;
      const px = Math.cos(a) * r * 0.36, py = 0.5 + Math.sin(a) * r * 0.36, pz = 0.15 + (1 - r * r) * 0.12 * R() + 0.02;
      p0 = [px, py, pz]; p1 = [px * 0.7, lerp(py, 0.55, 0.3), pz * 0.9 + 0.05]; p2 = [px * 0.25, 0.52 + (py - 0.5) * 0.25, 0.2 + (pz - 0.16) * 0.3];
      n0 = n2 = [0, 0, 1]; kd = 1;
    }
    put(P0, i, p0); put(P1, i, p1); put(P2, i, p2); put(N0, i, n0); put(N2, i, n2); kind[i] = kd;
  }
  // the palm creases (open pose only; they fold away as the hand closes): life, head and heart lines, the wrist crease
  const crease = [
    [[0.18, 0.08], [0.1, 0.22], [0.06, 0.38], [0.1, 0.52], [0.2, 0.62], [0.34, 0.66]],           // life line, round the thenar pad
    [[0.34, 0.64], [0.14, 0.6], [-0.08, 0.56], [-0.28, 0.5], [-0.42, 0.44]],                      // head line
    [[-0.48, 0.78], [-0.3, 0.8], [-0.1, 0.8], [0.08, 0.84], [0.24, 0.9]],                          // heart line
    [[-0.44, 0.03], [-0.2, 0.01], [0.05, 0.0], [0.3, 0.02], [0.44, 0.05]],                         // wrist crease
  ].map(l => l.map(([x, y]) => [x, y, 0.14 + Math.exp(-(((x - 0.28) / 0.2) ** 2 + ((y - 0.28) / 0.26) ** 2)) * 0.09 - 0.07 * (1 - 4 * x * x) * Math.sin(Math.PI * y) + 0.004]));
  return { n, P0, P1, P2, N0, N2, kind, tone, crease };
}

// pose u in [0, 2]: 0 open, 1 half, 2 fist (per-point linear blend between the three baked poses)
export function posed(H, i, u, out) {
  const a = u < 1 ? H.P0 : H.P1, b = u < 1 ? H.P1 : H.P2, t = u < 1 ? u : u - 1, j = i * 3;
  out[0] = a[j] + (b[j] - a[j]) * t; out[1] = a[j + 1] + (b[j + 1] - a[j + 1]) * t; out[2] = a[j + 2] + (b[j + 2] - a[j + 2]) * t;
  return out;
}
