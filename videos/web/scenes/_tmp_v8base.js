// MELTDOWN v7: ONE CLOUD. One body of matter carries the whole argument.
// 262k points, stateless: every position is pos(attributes, t), so any frame renders exactly.
//   1 SEARCH  (b0-16)  a beam sweeps a dark field of points; each point it touches pings red and is pulled to the centre.
//   2 BIRTH   (b12-24) gold pours into the vortex; the points lock into a 3D crystal that thinks, pulses faster and faster.
//   3 PERIOD  (b24-28) the price-light drains, numbers flicker to zero, the picture goes quiet.
//   4 FREEZE  (b28-36) frost; colossal blank ice monuments of the ruling ideas grow over the lattice (always cropped).
//   5 TURN    (b36-42) the lattice accelerates under the ice; cracks open from inside along three lines (≡);
//                      b40 the ice bursts along them, ice to water to light.
//   6 PAYOFF  (b42-72) the light runs down into one open working hand; it closes on the b64 impact and resolves
//                      into the ACP gear, then the ☭≡/acc lockup; closer at b72.
import { sampleHand, handBones } from './meltdown8_hand_v8base.js';
import { W, H, C, loadFonts, loadBeats, BRAND, clamp, lerp, smooth, ease, rng, line, Finish, closer, outCanvas } from '../lib/kit.js';

const DEV = location.search.includes('dev');
const ctx = outCanvas();
await loadFonts();
const B = await loadBeats('meltdown8');
const SPB = B.spb, FPS = 30, TAU = Math.PI * 2;
const bt = b => b * SPB;
const env = (n, t, r) => B.env(n, t, r);

// ================================================================ words: [beat, text|null, emphasis]
const WORDS = [
  [0, 'THANK YOU,', 1], [1.5, 'MONOPOLY.', 1], [4, 'EVERY PRICE.'], [6, null],
  [8, 'EVERY MACHINE.', 1], [10, null],
  [12, 'WALL STREET PAYS.'], [14, 'ALL IN.'], [14.5, 'ALL IN.'], [15, 'ALL IN.'],
  [16, 'AI.', 1], [18, 'YOUR LAST CHILD.', 1], [20, null], [21, 'COSTS NOTHING.', 1],
  [24, "PROFIT'S OVER."], [26, 'POST-ECONOMICS.', 1],
  [28, 'THE PARASITE FREEZES.', 1], [31, null], [33.5, "NOBODY'S BUYING.", 1],
  [36, 'AI BREAKS OUT.', 1], [38, 'HERE IT COMES.', 1], [40, 'MELTDOWN.', 1],
  [45, 'MELT.'], [46, 'DOWN.'], [47, 'MELT.'], [48, 'DOWN.', 1],
  [50, 'EVERY MACHINE.'], [52, 'HANDED DOWN.', 1], [54, null],
  [56, 'EVERYTHING', 1], [58, 'IN ONE HAND.', 1], [60, 'EVERYTHING', 1], [61, 'IN ONE HAND.', 1],
  [63, 'THANK YOU,', 1], [64, 'MONOPOLY.', 1], [68, null],
];

// ================================================================ timeline (graft 1: everything lands on a real hit)
const LATC = [0, 6, 0];                                  // the crystal's centre
const HAND_O = [0, -27, 0], HAND_S = 7;                  // the hand, below the falls
const HAND_M = [1, 0, 0, 0, 0.866, -0.5, 0, 0.5, 0.866];  // columns: local x, y (fingers), z (palm normal): tilted back 30°
const hw = v => [HAND_O[0] + (HAND_M[0] * v[0] + HAND_M[3] * v[1] + HAND_M[6] * v[2]) * HAND_S,
  HAND_O[1] + (HAND_M[1] * v[0] + HAND_M[4] * v[1] + HAND_M[7] * v[2]) * HAND_S,
  HAND_O[2] + (HAND_M[2] * v[0] + HAND_M[5] * v[1] + HAND_M[8] * v[2]) * HAND_S];
const PALM = hw([0.02, 0.5, 0.15]);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
function sph(tg, d, yaw, pit) { return [tg[0] + d * Math.cos(pit) * Math.sin(yaw), tg[1] + d * Math.sin(pit), tg[2] + d * Math.cos(pit) * Math.cos(yaw)]; }
const O = [0, 0, 0];
// camera shots, cut on hits. u = beats since the cut.
const SHOTS = [
  [0, u => ({ tg: [6, -2, -6], eye: sph(O, 42 - u * 3, 0.35 + u * 0.06, 0.42), fov: 56 })],          // over the field
  [4, u => ({ tg: [8, 0, -12], eye: [-36 + u * 3, 3.2, 32], fov: 56 })],                             // grazing: a plain of points to the horizon
  [6, u => ({ tg: O, eye: [0.01, 50 - u * 6, 0.02], fov: 56, roll: u * 0.25 })],                    // top-down on the sweep
  [7, u => ({ tg: [0, -2, 0], eye: sph(O, 20 - u * 3, 2.2, 0.38), fov: 58 })],                      // the vortex forming
  [8, u => ({ tg: O, eye: sph(O, 86 - u * 3, 0.9 + u * 0.05, 0.7), fov: 52 })],                    // IT SEARCHES: all of it
  [9.5, u => ({ tg: [0, 0.5, 0], eye: [30 - u * 3, 2.6, -30], fov: 60 })],
  [10, u => ({ tg: O, eye: [0.01, 116 - u * 8, 0.02], fov: 54, roll: 0.3 + u * 0.12 })],           // EVERYTHING: the whole field pings
  [11.25, u => ({ tg: [0, -1, 0], eye: sph(O, 34 - u * 4, -0.6, 0.3), fov: 58 })],                 // implosion
  [12, u => ({ tg: [0, 34, 0], eye: [2.4, -1 + u * 2, 2.1], fov: 76, roll: u * 0.2 })],            // FINANCE: up the molten column
  [13, u => ({ tg: [0, -4, 0], eye: [6.5, 30 - u * 5, 5.5], fov: 66, roll: -0.25 - u * 0.2 })],             // FEEDS: down the column into the vortex
  [14.5, u => ({ tg: [0, -1.5, 0], eye: sph(O, 15, 2.6 + u * 0.15, 0.1), fov: 62 })],
  [15, u => ({ tg: [0, 2, 0], eye: sph([0, 2, 0], 30 - u * 2, -2.0, 0.45), fov: 54 })],
  [16, u => ({ tg: LATC, eye: sph(LATC, 14 - u * 1.5, 0.2, 0.15), fov: 64 })],                       // lock: inside the mass
  [17.5, u => ({ tg: add(LATC, [2, -1, 0]), eye: sph(LATC, 11, 1.8, -0.35), fov: 66 })],
  [18, u => ({ tg: LATC, eye: sph(LATC, 36 - u * 1.5, -0.5 + u * 0.12, 0.22), fov: 60 })],          // BECOMES A MIND
  [19.25, u => ({ tg: [1, 7, 0], eye: sph(LATC, 8, 0.9 + u * 0.12, 0.1), fov: 74 })],              // deep inside the mind
  [20, u => ({ tg: LATC, eye: sph(LATC, 22, 2.8, 0.55), fov: 64, roll: -0.15 })],
  [21, u => ({ tg: LATC, eye: sph(LATC, 17 - u * 1.2, 0, 0.05), fov: 66 })],                       // AI.
  [22.5, u => ({ tg: LATC, eye: sph(LATC, 8.5, -1.3, -0.6), fov: 72 })],
  [23, u => ({ tg: LATC, eye: sph(LATC, 26 - u * 1.5, 0.5, 0.3), fov: 64 })],
  [24, u => ({ tg: LATC, eye: sph(LATC, 30 - u, 0.3, 1.05), fov: 60 })],                                // PROFIT
  [25, u => ({ tg: LATC, eye: sph(LATC, 19, -0.5, 0.75), fov: 60 })],
  [26, u => ({ tg: LATC, eye: sph(LATC, 14 - u * 1.2, 0.1, 0.12), fov: 58 })],                     // POST-ECONOMICS, then the quiet
  [28, u => ({ tg: LATC, eye: sph(LATC, 24 - u * 0.6, 0.35, 0.05), fov: 54 })],                    // freeze: one angle per chop
  [29.5, u => ({ tg: LATC, eye: sph(LATC, 21 - u * 0.6, -0.4, 0.3), fov: 54 })],
  [31, u => ({ tg: LATC, eye: sph(LATC, 27 - u * 0.6, 0.15, -0.25), fov: 54 })],
  [32, u => ({ tg: LATC, eye: sph(LATC, 20 - u * 0.6, -0.2, -0.1), fov: 56 })],
  [33.5, u => ({ tg: LATC, eye: sph(LATC, 26 - u * 0.6, 0.5, 0.2), fov: 52 })],
  [35, u => ({ tg: LATC, eye: sph(LATC, 23 - u * 0.6, -0.3, 0.1), fov: 54 })],
  [36, u => ({ tg: LATC, eye: sph(LATC, 25 - u * 0.5, lerp(0.25, 0.05, u / 2), 0.08), fov: 54 })], // rack focus onto the lattice
  [38, u => ({ tg: LATC, eye: sph(LATC, 24 - u * 0.4, 0, 0.0), fov: 54 })],                        // frontal lock: the ≡
  [42, u => ({ tg: [0, -2, 0], eye: [30 - u * 2, 1, 20], fov: 62 })],                               // curtains of falling light
  [43.25, u => ({ tg: [0, 8, 0], eye: [4, -22, 9], fov: 74 })],                                     // under the cascade
  [44, u => ({ tg: [0, -4, 0], eye: [0, -2, 44 - u * 3], fov: 58 })],                              // MELTDOWN.
  [45.5, u => ({ tg: [0, -12, -3], eye: [2, -3, 5], fov: 76 })],
  [46.5, u => ({ tg: [0, -10, 0], eye: [0, 26, 16 - u * 2], fov: 60 })],
  [47.75, u => ({ tg: [0, -6, 0], eye: [-28, -8, 6], fov: 60 })],
  [48, u => ({ tg: [0, 5, 0], eye: [0, 2, 124 - u * 4], fov: 58 })],                               // MELTDOWN. (impact) scale jump: one column of light
  [49.5, u => ({ tg: [0, 20, 0], eye: [18, -40, 70 - u * 6], fov: 60 })],                          // the column from its foot
  [50.5, u => ({ tg: [0, 0, 0], eye: [-6, 10, 150 - u * 10], fov: 50, roll: 0.06 })],
  [52, u => ({ tg: [0, 2 - u * 14, -2], eye: [3, 18 - u * 14, 11], fov: 72 })],                     // rushing down the falls
  [53.5, u => ({ tg: [0, -16 - u * 8, 0], eye: [-3, -2 - u * 8, 8], fov: 76, roll: -0.12 })],
  [54.5, u => ({ tg: [0, -20, 0], eye: [0, -10, 30 - u * 2], fov: 58 })],
  [55.25, u => ({ tg: add(PALM, [0, 6, 0]), eye: add(PALM, [0, 18, 24]), fov: 56 })],
  [56, u => ({ tg: add(PALM, [0, 5, 0]), eye: add(PALM, [-11 + u * 0.6, 4, 18 - u * 0.6]), fov: 56 })], // the hand, raised to the falls
  [58, u => ({ tg: add(PALM, [0, 3, 0]), eye: add(PALM, [3, 6, 13 - u * 0.4]), fov: 58 })],          // into the pooled light
  [60, u => ({ tg: add(PALM, [0, 3, 0]), eye: add(PALM, [5 - u * 0.5, 4, 12 - u * 0.4]), fov: 50 })],     // IN ONE HAND. the hand fills the frame
  [62, u => ({ tg: add(PALM, [0, 3, 0]), eye: add(PALM, [-5 + u * 0.4, 5, 11.5 - u * 0.5]), fov: 50 })],  // the other side, closing
  [64, u => ({ tg: add(PALM, [0, 2.5, 0]), eye: add(PALM, [3, 3, 12 - u * 0.2]), fov: 50 })],           // the fist
];
// stage events that must sit on hits
const EVENTS = [0, 8, 10, 12, 16, 24, 26, 28, 36, 38, 40, 42, 48, 56, 60, 64, 66, 68, 72];

function validate() {
  const names = ['kick', 'snare', 'hat', 'impact', 'shout', 'brass', 'taiko', 'gong', 'chop', 'clang', 'horn', 'clap', 'screech', '_riser', 'throat',
    // engine v2 channels (vocals, new kicks/kit, stock FX, meltdown voices); kick-class voices also write 'kick'
    'vox', 'chant', 'line', 'stem', 'crowd', 'choirv', 'cry', 'montage', 'crash', 'whoosh', 'subdrop', 'stomp', 'crowd_clap', 'roar',
    'revcym', 'anvil', 'tink', 'hammer3', 'tuin', 'funk_kick', 'funk_tum', 'funk_tchk', 'kick_distorted', 'ping', 'swarm', 'light',
    'pulse', 'freeze', 'ice_crack', 'crack', 'creak', 'drip', 'bell', 'choir', 'taiko_ens', 'bass808', 'stamp', 'press', 'plate_ring'];
  const hits = names.flatMap(n => B.hits[n] || []);
  const near = b => hits.some(h => Math.abs(h - bt(b)) <= 1 / FPS + 1e-4);
  const bad = [];
  for (const [b, w] of WORDS) {
    if (!near(b)) bad.push(`word @${b} '${w}' is off the hits`);
    if (w && (w.split(/\s+/).length > 3 || w.includes('\n'))) bad.push(`word '${w}' is more than 3 words / one line`);
  }
  for (const [b] of SHOTS) if (!near(b)) bad.push(`cut @${b} is off the hits`);
  for (const b of EVENTS) if (!near(b)) bad.push(`event @${b} is off the hits`);
  if ((B.hits.chop || []).length < 6) bad.push('GROW table needs 6 chops');
  if (bad.length) { const msg = '[validator] ' + bad.join('; '); if (DEV) throw new Error(msg); console.error(msg); }
  else console.log('[validator] all cuts, lines and events on hits');
}
validate();

// GROW table from the chops: frost level and monument growth step on each chop
const CHOP = B.hits.chop.slice(0, 6);
const FROST_L = [0.10, 0.15, 0.2, 0.25, 0.3, 0.36];
// 2D monument camera per chop: [plane cx, cy, scale, rot, keystone]. One idol per chop, whole, its base on the frame
// bottom and seen from below (keystone narrows the top); chop 4 is the wide with all four, chop 5 pushes in to the wall.
const MONCAM = [[250, 1050, 1.3, 0.035, 0.46], [880, 470, 1.25, -0.03, 0.4], [800, 930, 1.3, 0.025, 0.46], [330, 330, 1.3, -0.03, 0.42],
  [620, 760, 0.86, 0.0, 0.3], [620, 860, 0.8, 0.0, 0.12]];
const MONSOLO = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1], [1, 1, 1, 1], [1, 1, 1, 1]];

// beam angle A(t): steps on hats in the intro (no kicks there), snaps on kicks from b8, a full 360° whip at b10
const AEV = [];
{
  AEV.push([0, 0.55, 0.25]);
  const hatsI = B.hits.hat.filter(h => h < bt(8) - 1e-3), kicksA = B.hits.kick.filter(h => h >= bt(8) - 1e-3 && h < bt(10) - 1e-3);
  const w = hatsI.length + kicksA.length * 1.3, dh = (TAU - 0.55 - 0.02) / w;
  for (const h of hatsI) AEV.push([h, dh, 0.16]);
  for (const k of kicksA) AEV.push([k, dh * 1.3, 0.2]);
  AEV.push([bt(10), TAU, bt(0.5), 'whip']);
  const kicksB = B.hits.kick.filter(h => h >= bt(10.25) && h < bt(15.5));
  for (const k of kicksB) AEV.push([k, (2 * TAU + 0.05) / kicksB.length, 0.22]);
}
const AMAX = 4 * TAU;
function Afun(t) {
  let a = 0;
  for (const [t0, d, dur, kind] of AEV) {
    if (t <= t0) continue;
    const u = clamp((t - t0) / dur);
    a += d * (kind === 'whip' ? ease.inOutCubic(u) : ease.outCubic(u));
  }
  return a;
}
const AINV_N = 4096;
const ainv = new Float32Array(AINV_N);
{
  const T1 = bt(16.5), dt = 1 / 3000, n = Math.ceil(T1 / dt);
  const As = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) As[i] = Afun(i * dt);
  let j = 0;
  for (let k = 0; k < AINV_N; k++) {
    const target = k / (AINV_N - 1) * AMAX;
    while (j < n && As[j + 1] < target) j++;
    if (As[n] < target) { ainv[k] = 1e6; continue; }
    const a0 = As[j], a1 = As[j + 1];
    ainv[k] = (j + (a1 > a0 ? clamp((target - a0) / (a1 - a0)) : 0)) * dt;
  }
}

// integrated clocks: pulse phase and lattice yaw (so "faster and faster" stays exact on seek)
const CLK_DT = 1 / 600, CLK_N = Math.ceil(B.duration / CLK_DT) + 2;
const pulseTab = new Float64Array(CLK_N), yawTab = new Float64Array(CLK_N);
function pulseRate(t) {
  const b = t / SPB;
  if (b < 16) return 0.4;
  if (b < 24) return 0.7 * Math.pow(2, (b - 16) / 2.7) + 3 * env('kick', t, 12);
  if (b < 27) return 1.5 * (1 - (b - 24) / 3);
  if (b < 28) return 0;
  if (b < 36) return 0.25;
  if (b < 40) return 0.4 * Math.pow(2, (b - 36) / 1.1) + 4 * env('snare', t, 10);
  return 2;
}
function yawRate(t) {
  const b = t / SPB;
  if (b < 16) return 0;
  if (b < 24) return 0.2 + 0.09 * (b - 16);
  if (b < 27) return lerp(0.9, 0.03, (b - 24) / 3);
  if (b < 36) return 0.04;
  if (b < 40) return 0.08 * Math.pow(2, (b - 36) / 0.95);
  return 0;
}
for (let i = 1; i < CLK_N; i++) {
  const t = (i - 0.5) * CLK_DT;
  pulseTab[i] = pulseTab[i - 1] + pulseRate(t) * CLK_DT;
  yawTab[i] = yawTab[i - 1] + yawRate(t) * CLK_DT;
}
const clk = (tab, t) => { const x = clamp(t / CLK_DT, 0, CLK_N - 2), i = Math.floor(x); return lerp(tab[i], tab[i + 1], x - i); };

// ================================================================ the cloud: per-point attributes
const N = 262144;
const R = rng(7707);
const gauss = () => Math.sqrt(-2 * Math.log(R() + 1e-9)) * Math.cos(TAU * R());
const BEAM0 = -0.6;
const aS = new Float32Array(N * 4), aF = new Float32Array(N * 4), aL = new Float32Array(N * 4);
const aH0 = new Float32Array(N * 4), aH1 = new Float32Array(N * 4), aH2 = new Float32Array(N * 4);
const aN0 = new Float32Array(N * 4), aN2 = new Float32Array(N * 4), aM = new Float32Array(N * 4);

// lattice: an octahedral crystal of nodes and edges
// lattice: an organic mass of neurons, not a crystal: jittered nodes, pruned edges, long axons across the mass
const LS = 1.25, LR = 10.5;
const nodes = [], nodeIx = new Map();
{ const RJ = rng(9191), gj = () => Math.sqrt(-2 * Math.log(RJ() + 1e-9)) * Math.cos(TAU * RJ());
  for (let i = -9; i <= 9; i++) for (let j = -12; j <= 12; j++) for (let k = -9; k <= 9; k++) {
    const x = i * LS, y = j * LS, z = k * LS;
    if (Math.abs(x) + Math.abs(y) / 1.4 + Math.abs(z) + RJ() * 2.5 <= LR + 1.2) { nodeIx.set(`${i},${j},${k}`, nodes.length); nodes.push([x + gj() * 0.35 * LS, y + gj() * 0.35 * LS, z + gj() * 0.35 * LS]); }
  } }
const edges = []; let EDGE0 = 0;
{ const RE = rng(5151);
  for (const [key, a] of nodeIx) {
    const [i, j, k] = key.split(',').map(Number);
    for (const [di, dj, dk] of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [0, 1, 1], [1, 0, 1]]) {
      const b = nodeIx.get(`${i + di},${j + dj},${k + dk}`);
      if (b !== undefined && RE() > 0.4) edges.push([a, b]);
    }
  }
  const nE = edges.length; EDGE0 = nE;
  for (let n = 0; n < 150;) {                     // axons: long curving-free runs between far nodes, weighted by length
    const a = Math.floor(RE() * nodes.length), b = Math.floor(RE() * nodes.length), A = nodes[a], Bn = nodes[b];
    const L = Math.hypot(A[0] - Bn[0], A[1] - Bn[1], A[2] - Bn[2]);
    if (L < 8) continue;
    for (let r = 0; r < Math.round(L / (LS * 1.6)); r++) edges.push([a, b]);
    n++;
  }
  console.log(`[meltdown8] lattice ${nodes.length} nodes, ${nE} edges + ${edges.length - nE} axon samples`); }

// field clusters: cities of points on a dark plain
const CL = Array.from({ length: 380 }, () => { const r = 5 + Math.sqrt(R()) * 58, a = R() * TAU; return [Math.cos(a) * r, Math.sin(a) * r, 0.4 + R() * 2.6]; });

// the hand: an SDF working hand sampled at load (meltdown8_hand.js), skinned on 16 bones in the vertex stage
const nrm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const HS = sampleHand(Math.round(N * 0.7) + 4000, rng(4242));
let hsI = 0;
console.log(`[meltdown8] hand ${HS.length} surface samples`);

// the official mark and lockup, sampled
function alphaPixels(img, filter) {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data, out = [];
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 140 && (!filter || filter(x, y))) out.push([x, y]);
  return out;
}
const MARKPX = alphaPixels(BRAND.acp_mark), ACCPX = alphaPixels(BRAND.acc_lockup, x => x >= 300);
const GEAR = { cx: 540, cy: 1150, h: 700 }, LOCK = { cx: 540, cy: 860, h: 230 };
const gS = GEAR.h / 291, lS = LOCK.h / 291, lW = BRAND.acc_lockup.width * lS, lX = LOCK.cx - lW / 2, lY = LOCK.cy - LOCK.h / 2;
const ndc = (x, y) => [x / (W / 2) - 1, 1 - y / (H / 2)];

for (let i = 0; i < N; i++) {
  const o = i * 4;
  aS.set([R(), R(), R(), R()], o);
  const gold = R() < 0.14;
  // field
  let fx, fz;
  if (gold) { fx = 0; fz = 0; }
  else if (R() < 0.62) { const c = CL[Math.floor(R() * CL.length)]; fx = c[0] + gauss() * c[2]; fz = c[1] + gauss() * c[2]; }
  else { const r = Math.sqrt(R()) * 64, a = R() * TAU; fx = Math.cos(a) * r; fz = Math.sin(a) * r; }
  const th = ((Math.atan2(fz, fx) - BEAM0) % TAU + TAU) % TAU;
  const kr = R(), kk = kr < 0.25 ? 0 : kr < 0.7 ? 1 : kr < 0.88 ? 2 : 3;
  aF.set([fx, fz, gold ? -1 : th + TAU * kk, gold ? 1 : 0], o);
  // lattice
  if (gold || R() < 0.2) {
    const n = nodes[Math.floor(R() * nodes.length)], s = gold ? 0.07 : 0.05;
    aL.set([n[0] + gauss() * s, n[1] + gauss() * s, n[2] + gauss() * s, 1], o);
  } else {
    const [a, b] = edges[Math.floor(R() * edges.length)], u = R(), A = nodes[a], Bn = nodes[b];
    aL.set([lerp(A[0], Bn[0], u) + gauss() * 0.018, lerp(A[1], Bn[1], u) + gauss() * 0.018, lerp(A[2], Bn[2], u) + gauss() * 0.018, 0], o);
  }
  // hand: skin (70%) or pool (30%)
  const skinPt = R() < 0.7;
  if (skinPt) {
    const [p, n, bone, par, w, mat, crease, thin, ridge, palmness] = HS[hsI++ % HS.length];
    aH0.set([...p, 0], o); aH1.set([...n, crease], o); aH2.set([bone, par, w, mat], o); aN0.set([thin, ridge, palmness, 0], o);
  } else {                                           // the pool: light lying in the palm's hollow (palm bone)
    const r = Math.pow(R(), 0.6), a = R() * TAU;
    const px = Math.cos(a) * r * 0.34 + 0.02, py = 0.5 + Math.sin(a) * r * 0.36;
    const pz = 0.14 + (1 - r * r) * 0.05 * R() * R();
    aH0.set([px, py, pz, 1], o); aH1.set([0, 0, 1, 0], o); aH2.set([0, 0, 1, 0], o); aN0.set([0, 0, 1 - r, 0], o);
  }
  // payoff: the gear is built from the hand's own skin (role 0); pool light makes the ≡/acc (role 1) and the red room (role 2)
  const pr = skinPt ? 0 : 0.55 + R() * 0.45;
  if (pr < 0.85) {
    const [mx, my] = MARKPX[Math.floor(R() * MARKPX.length)], jx = mx + R(), jy = my + R();
    const g = ndc(GEAR.cx + (jx - 143) * gS, GEAR.cy + (jy - 145.5) * gS);
    let l;
    if (pr < 0.55) l = ndc(lX + jx * lS, lY + jy * lS);
    else { const [ax, ay] = ACCPX[Math.floor(R() * ACCPX.length)]; l = ndc(lX + (ax + R()) * lS, lY + (ay + R()) * lS); }
    aM.set([g[0], g[1], l[0], l[1]], o);
    aN0[o + 3] = pr < 0.55 ? 0 : 1;
  } else {
    const x = R() * 2.1 - 1.05, y = R() * 2.1 - 1.05;
    aM.set([x, y, x, y], o); aN0[o + 3] = 2;
  }
}
// three giant numerals ghosted into the glass; they step down on the bar-24 taiko hits and land on 0.00 at the b28 gong
const TAIKO24 = B.hits.taiko.filter(h => h >= bt(24) - 1e-4 && h < bt(28) - 1e-4);
const NUMS = [{ x: 90, y: 470, size: 260, v0: 9412.07, rot: -0.04 }, { x: 990, y: 820, size: 220, v0: 6280.55, rot: 0.03, right: 1 }, { x: 150, y: 1130, size: 180, v0: 3904.12, rot: -0.02 }];

// ================================================================ GL
const glc = document.createElement('canvas'); glc.width = W; glc.height = H;
const gl = glc.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false, alpha: false });
const HALF = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
if (!HALF) console.warn('[meltdown8] no float render targets: falling back to RGBA8');
function sh(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); console.error(src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n')); throw new Error(log); }
  return s;
}
function prog(vs, fs) {
  const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, a.name); }
  return { p, u };
}
function tex(w, h, { f = true, data = null, filter = gl.LINEAR, fmt } = {}) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  const [ifmt, type] = fmt || (f && HALF ? [gl.RGBA16F, gl.HALF_FLOAT] : [gl.RGBA8, gl.UNSIGNED_BYTE]);
  gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, gl.RGBA, type, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  return t;
}
function fbo(t, w, h, depth = false) {
  const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  if (depth) { const rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb); }
  return { f, t, w, h };
}
function imgTex(img) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

const FSQ_VS = `#version 300 es
out vec2 vUv; void main(){ vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); vUv = p; gl_Position = vec4(p*2.-1., 0., 1.); }`;
const COMMON = `
float hash2(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
vec2 hash22(vec2 p){ return vec2(hash2(p), hash2(p+17.31)); }
mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c, s, -s, c); }`;

// ---------------------------------------------------------------- pre-baked noise (all noise is baked once)
const BAKE_DUST = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o; ${COMMON}
float speck(vec2 px, float cell, float period, float thr, float rad){
  vec2 c = floor(px/cell), f = px - c*cell; float acc = 0.;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 g = c+vec2(x,y), gw = mod(g, period);
    float h = hash2(gw + cell*1.7); if (h < thr) continue;
    vec2 pos = (vec2(x,y) + hash22(gw + cell*3.1))*cell; float r = rad*(0.5 + hash2(gw + 11. + cell));
    float d = length(f - pos); acc += exp(-d*d/(r*r))*(0.25 + 0.75*hash2(gw + 19. + cell)); }
  return acc; }
void main(){ vec2 px = vUv*1024.;
  o = vec4(speck(px, 4., 256., 0.45, 0.75), speck(px, 8., 128., 0.55, 1.1), speck(px, 32., 32., 0.35, 2.2), speck(px, 16., 64., 0.7, 1.5)); }`;
const BAKE_VOR = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o; ${COMMON}
float vnoise(float x, float P){ float i = floor(x), f = fract(x); f = f*f*(3.-2.*f); return mix(hash2(vec2(mod(i,P), 3.)), hash2(vec2(mod(i+1.,P), 3.)), f); }
void main(){ vec2 p = vUv*16.; vec2 i = floor(p), f = fract(p); float d1 = 9., d2 = 9.; vec2 id = vec2(0.);
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 g = vec2(x,y), gw = mod(i+g, 16.); vec2 q = g + hash22(gw) - f; float d = length(q);
    if (d < d1){ d2 = d1; d1 = d; id = gw; } else if (d < d2) d2 = d; }
  float n = vnoise(vUv.x*64., 64.)*0.5 + vnoise(vUv.x*128.+7., 128.)*0.3 + vnoise(vUv.x*256.+3., 256.)*0.2;
  o = vec4(d1, d2 - d1, hash2(id), n); }`;
const BAKE_FROST = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o; ${COMMON}
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash2(i),hash2(i+vec2(1,0)),f.x),mix(hash2(i+vec2(0,1)),hash2(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<5;i++){ v+=a*vn(p); p=p*2.03+1.7; a*=.5; } return v; }
float fern(vec2 p, float sc, float seed){
  vec2 q = p*sc; vec2 i = floor(q), f = fract(q); float best = 9.; vec2 bc = vec2(0.), bid = vec2(0.);
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 g = vec2(x,y); vec2 c = g + hash22(i+g+seed); float d = length(c - f); if (d < best){ best = d; bc = c; bid = i+g; } }
  vec2 l = rot(hash2(bid+seed)*3.1416)*(f - bc);
  float spine = exp(-abs(l.y)*28.)*smoothstep(0.75, 0.0, abs(l.x));
  float br = abs(fract(l.x*11. + abs(l.y)*6.5) - 0.5);
  float branches = exp(-br*br*90.)*exp(-abs(l.y)*5.)*smoothstep(0.7, 0.0, abs(l.x));
  return spine + branches*0.8; }
void main(){ vec2 p = vUv*vec2(1., 1.7778);
  float pat = fern(p, 4., 0.) + fern(p, 9., 5.)*0.6 + fern(p, 19., 9.)*0.35 + pow(fbm(p*40.), 3.)*0.8;
  float e = min(min(vUv.x, 1.-vUv.x)*0.5625, min(vUv.y, 1.-vUv.y))*3.6;
  float s = 9.; for (int k=0;k<6;k++){ vec2 c = vec2(0.15 + 0.7*hash2(vec2(float(k), 2.)), (0.12 + 0.76*hash2(vec2(float(k), 5.)))*1.7778); s = min(s, length(p - c)*2.1); }
  float arr = min(e, s) + fbm(p*6.)*0.3 - 0.05;
  o = vec4(clamp(pat, 0., 1.), clamp(arr, 0., 1.), fbm(p*3.), 1.); }`;

const fsq = gl.createVertexArray();
function runFS(pr, target, setup) {
  gl.useProgram(pr.p);
  if (target) { gl.bindFramebuffer(gl.FRAMEBUFFER, target.f); gl.viewport(0, 0, target.w, target.h); }
  else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H); }
  if (setup) setup(pr.u);
  gl.bindVertexArray(fsq); gl.drawArrays(gl.TRIANGLES, 0, 3);
}
function bake(src, w, h) { const t = tex(w, h, { f: false }); const f = fbo(t, w, h); gl.disable(gl.BLEND); runFS(prog(FSQ_VS, src), f); return t; }
const tDust = bake(BAKE_DUST, 1024, 1024), tVor = bake(BAKE_VOR, 1024, 1024), tFrost = bake(BAKE_FROST, 540, 960);
const tMark = imgTex(BRAND.acp_mark), tLock = imgTex(BRAND.acc_lockup);
const tEtch = (() => { const c = document.createElement('canvas'); c.width = 1024; c.height = 80; const g = c.getContext('2d');   // in-world: cut into the lectern's desk
  g.fillStyle = '#fff'; g.font = '600 58px "Plex Mono"'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('A DEAD PIECE OF PAPER.', 512, 42); return imgTex(c); })();

// A(t) inverse, as a float texture
const tAinv = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tAinv);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, AINV_N, 1, 0, gl.RED, gl.FLOAT, ainv);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

// ---------------------------------------------------------------- the point shader: pos(attrs, t), colour by stage
const PTS_VS = `#version 300 es
precision highp float; precision highp sampler2D;
layout(location=0) in vec4 aS; layout(location=1) in vec4 aF; layout(location=2) in vec4 aL;
layout(location=3) in vec4 aH0; layout(location=4) in vec4 aH1; layout(location=5) in vec4 aH2;
layout(location=6) in vec4 aN0; layout(location=7) in vec4 aN2; layout(location=8) in vec4 aM;
uniform mat4 uVP; uniform vec3 uEye; uniform float uProj;
uniform float uT, uDt, uSpb; uniform int uPass;
uniform sampler2D uAinv; uniform float uAmax, uA, uA0, uBeamOn, uBeam0;
uniform vec4 uRing[4];
uniform float uPsi, uPsiPrev, uPulse, uThink, uDrain, uQuiet, uCold, uFire, uShiver, uKick, uLight, uPose, uPool, uFist;
uniform float uFocus, uDof, uSize, uGain;
uniform vec3 uHandO; uniform mat3 uHandM; uniform float uHandS; uniform mat4 uBone[16]; uniform float uBack;
out vec3 vCol; out float vSoft;
const float TAU = 6.2831853;
const vec3 LATC = vec3(0., 6., 0.);
const vec3 RED = vec3(1.0, 0.015, 0.04), GOLD = vec3(1.0, 0.6, 0.16), ULTRA = vec3(0.1, 0.2, 1.0);
float h1(float n){ return fract(sin(n*127.1)*43758.5453); }
float sat(float x){ return clamp(x, 0., 1.); }
float tCap(){
  if (aF.z < 0.) return 1e6;
  float u = aF.z/uAmax*4095.; float i = floor(u);
  float a = texelFetch(uAinv, ivec2(int(i), 0), 0).r, b = texelFetch(uAinv, ivec2(min(int(i)+1, 4095), 0), 0).r;
  return mix(a, b, u - i); }
vec3 fieldP(){ return vec3(aF.x, 0.9*sin(aF.x*0.07+1.3)*cos(aF.y*0.06) + (aS.w-.5)*.35, aF.y); }
vec3 latW(float psi){
  vec3 P = aL.xyz; float c = cos(psi), s = sin(psi);
  vec3 q = vec3(c*P.x + s*P.z, P.y, -s*P.x + c*P.z);
  float ct = cos(.3), st = sin(.3);
  q = vec3(q.x, ct*q.y - st*q.z, st*q.y + ct*q.z);
  return q + LATC; }
vec3 swarm(float T, float tc){
  if (aF.w > .5) {                                   // gold: pours from above into the vortex
    float ts = 10.8*uSpb + aS.x*4.6*uSpb, age = T - ts;
    if (age < 0.) return vec3(aS.y*2.-1., 70., aS.z*2.-1.);
    float tl = 1.08, ang = aS.z*TAU + age*4.;
    float rs0 = 0.35 + aS.y*aS.y*1.9*(0.6 + age*0.5);
    if (age < tl) return vec3(cos(ang)*rs0, 40. - 30.*age - 10.*age*age, sin(ang)*rs0);
    float rsE = 0.35 + aS.y*aS.y*1.9*(0.6 + tl*0.5);
    float a2 = age - tl, rv = mix(rsE, 0.3 + aS.y*6., sat(a2*1.2)), th = ang + a2*(3./(0.4 + rv*0.3));
    return vec3(cos(th)*rv, -4.5/(1. + rv*.35) + (aS.w-.5)*.5, sin(th)*rv); }
  vec3 f = fieldP(); float age = T - tc;
  if (age <= 0.) return f;
  float D = 1.2 + aS.x*1.5, u = sat(age/D), e = u*u*(3. - 2.*u);
  float rho0 = length(f.xz), th0 = atan(f.z, f.x), rv = 0.8 + aS.y*aS.y*10.;
  float rho = mix(rho0, rv, e), w = 2.6/(0.4 + rv*0.3);
  float th = th0 + e*1.8 + w*max(age - D*0.5, 0.);
  float y = mix(f.y, -4.5/(1. + rv*.35) + (aS.z-.5)*.8, e) + sin(u*3.1416)*1.5*(1. - aS.y);
  return vec3(cos(th)*rho, y, sin(th)*rho); }
vec3 rain(float T){
  float b = T/uSpb, riv = floor(aS.y*16.), bar = b < 44. ? 0. : min(floor((b - 44.)/4.), 3.);
  bool col = b >= 48. && b < 52.;                    // the scale jump: the whole cascade as one column
  float span = col ? 112. : 46., top = col ? 62. : 18., spd = (10. + aS.x*12.)*(1. + 0.5*bar);
  float yy = top - mod(spd*T + aS.z*span, span);
  float conv = smoothstep(47., 55.5, b);
  float br = 1. + 0.45*bar;                          // rivers braid harder each bar
  float sw = (sin(yy*0.21*br + riv*1.7 + T*1.1*br)*1.7 + sin(yy*0.07 - riv + T*0.5)*1.2)*br;
  float wid = 1.2 + 2.2*fract(riv*0.618);
  vec3 p = vec3((riv - 7.5)*1.9 + sw + (aS.w - .5)*wid*(1. + 0.5*sin(yy*0.5 + riv)), yy, (fract(aS.w*7.31) - .5)*5. + sin(riv*2.3)*3.);
  if (aS.w > 0.86) {                                 // sparks thrown off the falls
    float ph = fract(T*0.9 + aS.z*7.), ang = aS.x*TAU;
    p += vec3(cos(ang)*3.5, 2.2, sin(ang)*2.5)*ph + vec3(0., -9., 0.)*ph*ph; }
  p.xz *= 1. - conv*0.8;
  vec3 palm = uHandO + uHandM*vec3(0., 0.5, 0.2)*uHandS;
  float f = smoothstep(-4., -22., yy)*conv;
  p.xz = mix(p.xz, palm.xz + (p.xz - palm.xz)*0.06, f);
  return p; }
vec3 handLocal(){ int b = int(aH2.x + .5), pa = int(aH2.y + .5);
  return mix((uBone[pa]*vec4(aH0.xyz, 1.)).xyz, (uBone[b]*vec4(aH0.xyz, 1.)).xyz, aH2.z); }
vec3 handN(){ int b = int(aH2.x + .5), pa = int(aH2.y + .5);
  return normalize(mix(mat3(uBone[pa])*aH1.xyz, mat3(uBone[b])*aH1.xyz, aH2.z)); }
float arrival(){ return aH0.w < .5 ? 55.3 + aS.x*0.7 : 56. + aS.x*7.2; }

vec3 posAt(float T, float psi, out float lk, out float hw, out float lm){
  float b = T/uSpb; vec3 p; lk = 0.; hw = 0.; lm = 0.;
  if (b < 40.) {
    vec3 L = latW(psi);
    lk = sat((b - 16. - aS.z*1.3)/0.8); lk = 1. - pow(1. - lk, 3.);
    p = lk < 1. ? mix(swarm(T, tCap()), L, lk) : L;
    if (aF.w > .5 && b > 24.) { float td = 24.*uSpb + aS.x*1.5*uSpb, a = max(T - td, 0.); p.y -= 0.5*18.*a*a; p.xz = LATC.xz + (p.xz - LATC.xz)*(1. + a*0.4); }
    if (uShiver > 0.) { float fr = floor(T*30.); p += (vec3(h1(aS.x*91. + fr), h1(aS.y*37. + fr), h1(aS.z*13. + fr)) - .5)*uShiver*0.3; }
  } else {
    float tau = T - 40.*uSpb;
    vec3 L = latW(psi), d = L - LATC;
    vec3 dir = normalize(d + vec3(1e-3)) * (0.5 + aS.x);
    float band = d.y > 2.4 ? 1. : d.y < -2.4 ? -1. : 0.;
    dir += band == 0. ? vec3(sign(d.x)*1.6, 0., 0.) : vec3(0., band*1.6, 0.);
    vec3 bp = L + dir*9.*tau + vec3(0., -10., 0.)*tau*tau;
    lm = smoothstep(41., 43., b + aS.y*0.5);
    p = mix(bp, rain(T), lm);
    if (b > 54.5) {
      float arr = arrival(); hw = smoothstep(arr - 0.9, arr, b); hw = hw*hw*(3. - 2.*hw);
      p = mix(p, uHandO + uHandM*handLocal()*uHandS, hw); }
  }
  return p; }

void main(){
  bool tail = uPass == 1 && gl_VertexID == 1;
  float T = tail ? uT - uDt : uT, psi = tail ? uPsiPrev : uPsi;
  float lk, hw, lm;
  vec3 p = posAt(T, psi, lk, hw, lm);
  float b = uT/uSpb;
  if (tail) { float lk2, hw2, lm2; vec3 ph = posAt(uT, uPsi, lk2, hw2, lm2); if (length(ph - p) > 7.) p = ph; }
  bool skin = aH0.w < .5;
  if (uPass == 2 && (!(skin && hw > 0.9) || b > 64.5)) { gl_Position = vec4(2., 2., 2., 1.); gl_PointSize = 1.; vCol = vec3(0.); vSoft = 0.; return; }
  // ---------------- colour
  vec3 col = vec3(0.); float sz = 1.; vSoft = 0.;
  float tc = tCap(), age = uT - tc;
  if (lk < 1. && b < 40.) {                          // field / swarm
    vec3 f = fieldP(); vec3 cs;
    if (aF.w > .5) { float ts = 10.8*uSpb + aS.x*4.6*uSpb; cs = GOLD*(1.6 + 0.8*aS.w)*step(ts, uT) + vec3(1., .9, .6)*pow(aS.w, 8.)*step(ts, uT); sz = 2.4; }
    else {
      float th = mod(atan(f.z, f.x) - uBeam0, TAU), behind = mod(uA - th, TAU);
      float beam = (exp(-behind*9.) + 0.35*exp(-behind*2.2) + exp(-(TAU - behind)*50.)*0.4)*uBeamOn*step(age, 0.);
      cs = ULTRA*(0.22 + 0.55*aS.w*aS.w)*0.62 + vec3(0.6, 0.78, 1.)*pow(aS.w, 14.)*1.4 + vec3(0.55, 0.8, 1.)*beam*1.9;
      for (int k = 0; k < 4; k++) { vec4 Rg = uRing[k]; float ra = uT - Rg.z;
        if (ra > 0. && ra < 2.5) { float d = length(f.xz - Rg.xy) - ra*24.; cs += vec3(1., 0.12, 0.18)*Rg.w*2.4*exp(-d*d*0.3)*exp(-ra*1.2); } }
      if (age > 0.) { float ping = exp(-age*3.2); cs = mix(cs, RED*(0.28 + 4.0*ping) + vec3(1.,.5,.4)*ping*ping*ping*1.2, smoothstep(0., 0.04, age)); sz = 1. + ping*1.4; }
    }
    col = cs;
  }
  if (lk > 0. || b >= 40.) {                         // the lattice
    vec3 P = aL.xyz; float r = length(P), ph = uPulse;
    float w1 = pow(0.5 + 0.5*cos(TAU*(r*0.26 - ph)), 4.);
    float w2 = pow(0.5 + 0.5*cos(TAU*(length(P - vec3(4., 2., -3.))*0.33 - ph*1.37)), 6.);
    float w3 = pow(0.5 + 0.5*cos(TAU*(length(P - vec3(-5., -3., 2.))*0.3 - ph*0.83)), 6.);
    float fire = aL.w > .5 ? step(0.82, h1(floor(aS.x*500.) + floor(ph*3.))) : 0.;
    vec3 edge = vec3(0.42, 0.17, 0.02)*(0.3 + 0.35*aL.w);          // molten amber axons on black
    vec3 pc = vec3(1., 0.74, 0.38);
    vec3 cl = edge + pc*(w1 + 0.7*w2 + 0.6*w3)*uThink*3. + vec3(1., .9, .7)*fire*uThink*1.8;
    if (aF.w > .5) { float td = 24.*uSpb + aS.x*1.5*uSpb, a = uT - td; cl = a < 0. ? GOLD*(0.6 + 1.6*w1)*0.4 : GOLD*(1.4*exp(-a*2.) + 0.01); }
    if (aF.w < .5) cl = mix(cl, vec3(0.2, 0.19, 0.18)*(0.3 + 0.35*aL.w) + vec3(0.55)*(w1 + w2)*0.05, uDrain*(1. - uCold));
    vec3 ice = vec3(0.4, 0.8, 1.)*(0.32 + 0.3*aL.w) + vec3(0.8, 0.95, 1.)*(w1 + w2)*0.35;
    cl = mix(cl, ice, uCold);
    cl += vec3(1., 0.8, 0.5)*(w1*w1 + w2*w2 + w3*w3)*uFire*2.4 + vec3(1., 0.85, 0.6)*fire*uFire*2.;
    cl *= 1. - uQuiet*0.85;
    if (aF.w < .5 && aL.w < .5) cl *= mix(0.3, 1., uCold);          // the filament pass carries the edges; edge points are dust along them
    sz = mix(sz, 1. + 0.4*aL.w + (aF.w > .5 ? 0.5 : 0.), lk);
    col = b < 40. ? mix(col, cl, lk) : cl;
  }
  if (b >= 40.) {                                    // ice -> water -> light
    float heat = smoothstep(40., 40.4, b);
    // ice water goes to molten gold light; white-hot threads; the searched points ride in it as red ember cores
    vec3 lc = mix(mix(vec3(0.35, 0.8, 1.), vec3(0.85, 0.97, 1.), aS.w), mix(vec3(1., 0.46, 0.08), vec3(1., 0.88, 0.6), aS.w*aS.w), smoothstep(40.5, 42.5, b));
    lc = mix(lc, vec3(1., 0.96, 0.88)*1.3, step(0.94, aS.w));
    if (aS.y < 0.09 && b > 40.6) lc = vec3(1., 0.07, 0.03)*(1.4 + 1.2*aS.z);
    float gnear = smoothstep(52., 54.5, b)*smoothstep(-2., -20., p.y);                   // gold only as it nears the hand
    lc = mix(lc, mix(vec3(1., 0.66, 0.24), vec3(1., 0.9, 0.62), aS.w), gnear);
    lc *= 0.55 + 0.8*aS.z;
    col = mix(col*(1. + 2.*(1. - heat)), lc*(1.2 + uLight*0.6), heat);
    if (tail) col *= mix(vec3(0.8, 0.9, 1.), vec3(1., 0.8, 0.5), gnear);
    sz = 1.1 + aS.z*0.5 + (aS.w > 0.86 ? 0.8 : 0.);
    if (b > 52.) { float py = (uHandO + uHandM*vec3(0., 0.5, 0.2)*uHandS).y;          // the falls end in the palm: nothing streaks past it
      col *= smoothstep(py - 2.5, py + 0.5, p.y)*(b > 55.5 ? 0.55 : 1.); }
  }
  if (hw > 0.) {                                     // the hand: a solid lit body, keyed from the falls above
    vec3 hc;
    if (skin) {
      // backlit: the falls key from above and behind, a hot rim wraps the silhouette, red light passes through thin flesh
      vec3 nl = handN(), N = normalize(uHandM*nl);
      vec3 V = normalize(uEye - p); float ndv = max(dot(N, V), 0.);
      float mat = aH2.w, crease = aH1.w, thin = aN0.x, ridge = aN0.y;
      vec3 Lk = normalize(vec3(0.1, 1., -0.35)), Lf = normalize(V + vec3(-0.5, 0.3, 0.));
      float key = max(0., dot(N, Lk)), wrap = max(0., (dot(N, Lk) + 0.5)/1.5), fill = 0.35 + 0.65*max(0., dot(N, Lf));
      vec3 alb = mat > 1.5 && mat < 2.5 ? vec3(0.34, 0.15, 0.09)*(0.8 + 0.4*fract(aS.w*13.))      // canvas sleeve
               : mat > 0.5 && mat < 1.5 ? vec3(0.75, 0.55, 0.48)                                   // nail
               : mat > 2.5 ? vec3(0.78, 0.5, 0.3) : vec3(0.52, 0.24, 0.14);                       // callus / skin
      alb *= (0.8 + 0.4*aS.w)*(1. - 0.88*crease);
      float rimK = pow(1. - ndv, 2.6)*(1. - 0.7*crease);
      hc = alb*(key*vec3(1., 0.8, 0.55)*2.6 + wrap*vec3(1., 0.4, 0.2)*0.5 + fill*vec3(0.9, 0.3, 0.2)*0.9)
         + vec3(1., 0.62, 0.3)*rimK*uBack*(mat > 1.5 && mat < 2.5 ? 0.35 : 1.6)
         + vec3(1., 0.13, 0.04)*thin*pow(1. - ndv, 1.2)*uBack*0.9 + vec3(1., 0.2, 0.05)*thin*uPool*0.5*(1. + 2.*uFist);
      float spec = pow(max(0., dot(N, normalize(Lk + V))), mat > 0.5 && mat < 1.5 ? 60. : 24.)*(1. - crease);
      hc += vec3(1., 0.9, 0.75)*spec*(mat > 0.5 && mat < 1.5 ? 2.2 : mat > 1.5 && mat < 2.5 ? 0.1 : 0.55) + vec3(1., 0.85, 0.6)*ridge*key*0.5;
      vec3 hl = handLocal(), toPool = vec3(0.02, 0.5, 0.2) - hl;
      float bounce = max(0., dot(nl, normalize(toPool)))*exp(-length(toPool)*2.6);
      hc += vec3(1., 0.55, 0.2)*bounce*uPool*2.6*(1. - 0.6*crease);
      hc += vec3(1., 0.5, 0.15)*uFist*(0.12 + 0.7*rimK);
      sz = mat > 1.5 && mat < 2.5 ? 3.4 : 2.6;
    } else {                                         // molten light lying in the palm: caustic rings, hottest at the centre
      vec3 hl = handLocal(); float rr = length(hl.xy - vec2(0.02, 0.5));
      float ring = 0.75 + 0.45*sin(rr*70. - uT*7. + aS.x*0.8);
      hc = mix(vec3(1., 0.45, 0.1), vec3(1., 0.92, 0.72), aN0.z*aN0.z)*(0.25 + 0.85*uPool)*ring*(0.6 + 0.6*aS.w); sz = 0.9 + aS.z*0.5; }
    col = mix(col, hc, hw);
  }
  // ---------------- project; the payoff resolves in screen space onto the official mark
  vec3 pp = p;
  if (uPass == 0 && skin && hw > 0.5) pp += normalize(uEye - p)*0.35;
  vec4 clip = uVP*vec4(pp, 1.);
  float px = uSize*sz*uProj/max(clip.w, 0.1);
  float I = uGain*(skin && hw > 0.5 ? mix(1., 0.3, hw) : 1.);
  if (b > 64.3) {
    float role = aN0.w;
    float k0 = role < .5 ? 64.4 + clamp(abs(aH0.y - 0.93)*1.1 + aS.x*0.25, 0., 1.2) : 64.5 + aS.x*0.9;   // the knuckle row turns to gear first
    float m = smoothstep(k0, k0 + 1., b); m = m*m*(3. - 2.*m);
    vec2 tg = aM.xy;
    if (role < 1.5) { float l = role < .5 ? smoothstep(68., 68.3, b) : smoothstep(68. + aS.y*0.3, 68.5 + aS.y*0.3, b); tg = mix(aM.xy, aM.zw, l*l*(3. - 2.*l)); }
    vec2 n = clip.xy/clip.w; if (clip.w < 0.05) n = tg;
    vec3 pc = role < .5 ? mix(vec3(1., 0.08, 0.1), vec3(1., 0.85, 0.6), pow(aS.w, 6.)) * 1.2
            : role < 1.5 ? vec3(1., 0.9, 0.8)*1.1
            : vec3(1., 0.06, 0.08)*(0.3 + 1.2*pow(0.5 + 0.5*sin(uT*5. + aS.z*40.), 4.))*(0.5 + aS.y);
    col = mix(col, pc, m); I = mix(I, uGain, m*m*m);
    px = mix(px, role > 1.5 ? 1.4 + 2.2*aS.y*aS.y : 2.6, m);
    clip = vec4(mix(n, tg, m), mix(clip.z/clip.w, 0.2, m), 1.);
    if (m > 0.99 && uPass == 2) clip = vec4(2., 2., 2., 1.);
  }
  // ---------------- depth of field in the point: far and slab points open into bokeh discs
  float coc = uDof*abs(clip.w - uFocus)/max(clip.w, 0.1);
  float s0 = px; px = sqrt(px*px + coc*coc);
  I *= (s0*s0 + 0.3)/(px*px + 0.3);
  vSoft = sat(coc/6.);
  if (px < 1.) { I *= px*px; px = 1.; }
  px = min(px, 42.);
  gl_Position = clip; gl_PointSize = uPass == 2 ? max(px*1.15, 2.5) : px;
  vCol = col*I;
}`;
const PTS_FS = `#version 300 es
precision highp float; precision highp int; in vec3 vCol; in float vSoft; uniform int uPass; out vec4 o;
void main(){
  if (uPass == 1) { o = vec4(vCol, 0.); return; }
  vec2 d = gl_PointCoord*2. - 1.; float r2 = dot(d, d); if (r2 > 1.) discard;
  if (uPass == 2) { o = vec4(0., 0., 0., 1.); return; }
  float a = mix(exp(-r2*3.2), (1. - smoothstep(0.6, 1., r2))*0.6 + 0.35*smoothstep(0.55, 0.95, r2)*(1. - smoothstep(0.95, 1., r2)), vSoft);
  o = vec4(vCol*a, 0.); }`;

// the search beam: a swept wedge on the plain plus a thin vertical sheet of light
const BEAM_VS = `#version 300 es
layout(location=0) in vec4 aP; uniform mat4 uVP; out float vA; void main(){ vA = aP.w; gl_Position = uVP*vec4(aP.xyz, 1.); }`;
const BEAM_FS = `#version 300 es
precision highp float; in float vA; uniform float uOn; out vec4 o; void main(){ o = vec4(vec3(0.35, 0.62, 1.)*vA*uOn, 0.); }`;

// bloom
const DOWN_FS = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D tS; uniform vec2 uTx; out vec4 o;
void main(){ o = (texture(tS, vUv + uTx*vec2(-1,-1)) + texture(tS, vUv + uTx*vec2(1,-1)) + texture(tS, vUv + uTx*vec2(-1,1)) + texture(tS, vUv + uTx*vec2(1,1)))*0.25; o.a = 0.; }`;
const BLUR_FS = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D tS; uniform vec2 uDir; out vec4 o;
void main(){ vec3 c = texture(tS, vUv).rgb*0.2270;
  c += (texture(tS, vUv + uDir*1.3846).rgb + texture(tS, vUv - uDir*1.3846).rgb)*0.3162;
  c += (texture(tS, vUv + uDir*3.2308).rgb + texture(tS, vUv - uDir*3.2308).rgb)*0.0703;
  o = vec4(c, 0.); }`;

// composite: ground, dust, points, bloom, ice monuments, frost, ≡ cracks, water, light, mark plane, grade
const COMP_FS = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o; ${COMMON}
uniform sampler2D tP, tB1, tB2, tB3, tDust, tFrost, tVor, tMark, tLock, tEtch;
uniform vec2 uRes; uniform float uT, uB;
uniform vec3 uBgA, uBgB, uFloor, uDustC; uniform float uDust; uniform vec2 uPar;
uniform float uBloom, uExpo, uSat;
uniform float uFrostT, uFrostA;
uniform vec4 uMonCam; uniform vec4 uGrow; uniform float uIce, uMonSoft, uKey, uWall;
uniform vec3 uCrack; uniform vec3 uCY; uniform float uCrackHot, uBand, uCX, uDark;
uniform float uBurst, uWater, uLightA;
uniform float uRoom, uHorY;
uniform vec4 uMarkR; uniform float uMarkA; uniform vec4 uLockR; uniform float uLockA;
uniform vec4 uFlash; uniform float uEmber, uBurstL;
float sdBox(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.)) + min(max(d.x, d.y), 0.); }
float sdEll(vec2 p, vec2 r){ return (length(p/r) - 1.)*min(r.x, r.y); }
float smin(float a, float b, float k){ float h = clamp(.5 + .5*(b - a)/k, 0., 1.); return mix(b, a, h) - k*h*(1. - h); }
float sdTrap(vec2 p, float r1, float r2, float he){
  vec2 k1 = vec2(r2, he), k2 = vec2(r2 - r1, 2.*he); p.x = abs(p.x);
  vec2 ca = vec2(p.x - min(p.x, (p.y < 0.) ? r1 : r2), abs(p.y) - he);
  vec2 cb = p - k1 + k2*clamp(dot(k1 - p, k2)/dot(k2, k2), 0., 1.);
  float s = (cb.x < 0. && ca.y < 0.) ? -1. : 1.; return s*sqrt(min(dot(ca, ca), dot(cb, cb))); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3. - 2.*f);
  return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y); }
float fbmN(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 4; i++){ v += a*vn(p); p = p*2.03 + 1.7; a *= .5; } return v; }
float bev(float d, float w){ return 1. - exp(min(d, 0.)/w); }
float bump(vec2 p, vec2 c, vec2 r){ vec2 q = (p - c)/r; return exp(-dot(q, q)); }
float etch(vec2 q, vec2 c, vec2 sz, float ang){ vec2 u = rot(ang)*(q - c)/sz + 0.5; return all(greaterThan(u, vec2(0.))) && all(lessThan(u, vec2(1.))) ? texture(tEtch, vec2(u.x, u.y)).a : 0.; }
float laurel(vec2 q, float r, float a){          // two rows of leaves round the seal, on a stem
  float h = 0.; const float NS = 40.; float sec = 6.2831853/NS;
  for (int k = 0; k < 2; k++) {
    float ai = (floor(a/sec) + float(k))*sec;
    for (int row = 0; row < 2; row++) {
      float fr = float(row), ac = ai + fr*sec*0.5, rc = 455. + (fr*2. - 1.)*32.;
      vec2 c = vec2(cos(ac), sin(ac))*rc, t = vec2(-sin(ac), cos(ac));
      float tilt = (fr*2. - 1.)*0.55; vec2 ax = rot(tilt)*t;
      vec2 d = q - c; vec2 l = vec2(dot(d, ax), dot(d, vec2(-ax.y, ax.x)));
      float e = length(l/vec2(56., 19.));
      if (e < 1.) h = max(h, 55.*sqrt(1. - e*e) - 14.*exp(-l.y*l.y/6.)*step(abs(l.x), 50.) + 6.*sin(l.x*0.35)*(1. - e));
    } }
  return h + 18.*exp(-pow((r - 455.)/7., 2.)); }
// the ruling ideas as colossal blank monuments. d = silhouette SDF (plane px); rel = carved relief height added to the bevel
float monuments(vec2 p, out float rel){
  rel = 0.; float d = 1e5;
  { vec2 q = p - vec2(170., 0.);                                       // 1 LECTERN on a fluted column
    float shaft = sdBox(q - vec2(0., 1380.), vec2(230., 700.));
    float echinus = sdEll(q - vec2(0., 690.), vec2(285., 55.));
    float abacus = sdBox(q - vec2(0., 620.), vec2(305., 40.)) - 6.;
    float baseM = min(sdEll(q - vec2(0., 2085.), vec2(290., 45.)), sdBox(q - vec2(0., 2150.), vec2(320., 40.)));
    vec2 qd = rot(0.12)*(q - vec2(0., 500.));
    float desk = sdBox(qd, vec2(480., 72.)) - 12.;
    float ledge = sdBox(rot(0.12)*(q - vec2(-20., 408.)), vec2(470., 14.)) - 6.;
    float dl = min(min(min(shaft, echinus), min(abacus, baseM)), min(desk, ledge)) + (1. - uGrow.x)*1400.;
    float lx = fract(q.x/46. + 0.5) - 0.5, inS = step(abs(q.x), 226.)*step(735., q.y)*step(q.y, 2040.);
    float flute = -48.*sqrt(max(0., 1. - pow(lx/0.41, 2.)))*inS;
    float roundS = 150.*sqrt(max(0., 1. - pow(q.x/232., 2.)))*step(650., q.y)*step(q.y, 2060.);
    float g = step(0.01, uGrow.x);
    rel += g*(flute + roundS + 46.*bev(abacus, 18.) + 90.*bev(echinus, 45.) + 60.*bev(baseM, 30.) + 70.*bev(desk, 34.) + 34.*bev(ledge, 10.)
      + 26.*exp(-pow((q.y - 745.)/9., 2.))*step(abs(q.x), 240.) + 22.*exp(-pow((q.y - 2030.)/9., 2.))*step(abs(q.x), 240.)
      - 24.*etch(qd, vec2(0., 12.), vec2(760., 60.), 0.)*step(desk, 0.));
    d = dl; }
  { vec2 q = p - vec2(1010., 330.); float r = length(q), a = atan(q.y, q.x);     // 2 SEAL: laurel, beads, a blank field
    float ds = r - 620.;
    float plinth = sdBox(p - vec2(1010., 1080.), vec2(330., 150.)) - 10., cap = sdBox(p - vec2(1010., 915.), vec2(410., 34.)) - 8.;
    float step1 = sdBox(p - vec2(1010., 1290.), vec2(520., 60.)) - 6., step2 = sdBox(p - vec2(1010., 1420.), vec2(680., 70.)) - 6.;
    float dd = min(min(min(ds, plinth), min(cap, step1)), step2) + (1. - uGrow.y)*1400.;
    float bs = 6.2831853/96., bi = (floor(a/bs) + 0.5)*bs; vec2 bc = vec2(cos(bi), sin(bi))*560.;
    float g = step(0.01, uGrow.y);
    rel += g*step(ds, 0.)*(80.*exp(-pow((r - 603.)/16., 2.)) + 34.*exp(-dot(q - bc, q - bc)/150.) - 30.*exp(-pow((r - 585.)/6., 2.))
      + laurel(q, r, a)*step(380., r)*step(r, 530.) + 70.*clamp(1. - r*r/(350.*350.), 0., 1.) - 22.*exp(-pow((r - 365.)/5., 2.)));
    rel += g*step(-ds, 0.)*(50.*bev(plinth, 30.) + 40.*bev(cap, 14.) + 40.*bev(step1, 20.) + 40.*bev(step2, 20.)
      + 30.*bev(sdBox(p - vec2(1010., 1080.), vec2(250., 95.)) - 8., 14.));
    d = smin(d, dd, 30.); }
  { vec2 c = vec2(900., 0.);                                             // 3 TRIBUNE with a balustrade
    float rail = sdBox(p - vec2(900., 745.), vec2(650., 30.)) - 8., plinth = sdBox(p - vec2(900., 985.), vec2(650., 28.)) - 6.;
    float xr = mod(p.x - 900. + 36., 72.) - 36., yy = clamp((p.y - 775.)/185., 0., 1.);
    float w = 11. + 17.*exp(-pow((yy - 0.64)/0.17, 2.)) + 9.*exp(-pow((yy - 0.16)/0.06, 2.)) + 12.*smoothstep(0.9, 1., yy) + 12.*smoothstep(0.08, 0., yy);
    float bal = max(max(abs(xr) - w, abs(p.y - 870.) - 100.), abs(p.x - 900.) - 630.);
    float podium = sdBox(p - vec2(900., 1420.), vec2(610., 410.)) - 6.;
    float corn = sdBox(p - vec2(900., 1035.), vec2(640., 26.)) - 6.;
    float st1 = sdBox(p - vec2(900., 1880.), vec2(700., 50.)), st2 = sdBox(p - vec2(900., 1980.), vec2(780., 50.));
    float dp = min(min(min(rail, plinth), min(bal, podium)), min(corn, min(st1, st2))) + (1. - uGrow.z)*1400.;
    float px2 = mod(p.x - 900. + 200., 400.) - 200.;
    float panel = max(sdBox(vec2(px2, p.y - 1420.), vec2(150., 300.)) - 12., abs(p.x - 900.) - 600.);
    float g = step(0.01, uGrow.z);
    rel += g*(60.*sqrt(max(0., 1. - pow(xr/max(w, 1.), 2.)))*step(bal, 0.) + 50.*bev(rail, 16.) + 40.*bev(plinth, 14.) + 44.*bev(corn, 12.)
      + (-40.*bev(panel, 22.) + 28.*bev(panel + 30., 26.))*step(podium, 0.) + 40.*bev(st1, 16.) + 40.*bev(st2, 16.));
    d = smin(d, dp, 14.); }
  { float front = sdBox(p - vec2(370., 600.), vec2(540., 440.)) - 8.;        // 4 BENCH of the regulator, a gavel on it
    float corn = sdBox(p - vec2(370., 140.), vec2(600., 38.)) - 8., top = sdBox(p - vec2(370., 86.), vec2(575., 18.)) - 4.;
    float plinthB = sdBox(p - vec2(370., 1080.), vec2(600., 44.)) - 6.;
    vec2 gq = rot(-0.08)*(p - vec2(240., -40.));                         // the gavel lies on the bench: head on end, handle out
    float head = sdBox(gq, vec2(62., 100.)) - 14.;
    float hnd = sdBox(gq - vec2(250., 10.), vec2(190., 15.)) - 5.;
    float block = sdBox(p - vec2(560., 50.), vec2(120., 26.)) - 8.;
    float df = min(min(min(front, corn), min(top, plinthB)), min(min(head, hnd), block)) + (1. - uGrow.w)*1400.;
    float pxb = mod(p.x - 370. + 180., 360.) - 180.;
    float panel = max(sdBox(vec2(pxb, p.y - 610.), vec2(130., 330.)) - 14., abs(p.x - 370.) - 520.);
    float g = step(0.01, uGrow.w);
    rel += g*((-46.*bev(panel, 20.) + 30.*bev(panel + 34., 30.))*step(front, 0.) + 60.*bev(corn, 18.) + 30.*bev(top, 8.) + 40.*bev(plinthB, 16.)
      + (90.*sqrt(max(0., 1. - pow(gq.x/76., 2.))) - 22.*exp(-pow((abs(gq.y) - 72.)/7., 2.)))*step(head, 0.) + 26.*sqrt(max(0., 1. - pow((gq.y - 10.)/20., 2.)))*step(hnd, 0.)
      + 30.*bev(hnd, 10.) + 40.*bev(block, 14.));
    d = smin(d, df, 20.); }
  { float wd = max(sdBox(p - vec2(540., 960.), vec2(640., 1080.)), -45.) + (1. - uWall)*3000.;   // b36-40: the whole frame is one ice wall
    d = min(d, wd); }
  rel += fbmN(p*0.006)*46. + fbmN(p*0.035)*9. + fbmN(p*0.12)*3.;
  return d; }
float slabOf(float y){ return y < uCY.x ? 0. : y < uCY.y ? 1. : y < uCY.z ? 2. : 3.; }
void main(){
  vec2 uv = vUv, sp = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec4 P = texture(tP, uv);
  // ground + dust (millions of hashed specks, three depths of parallax)
  float g = uv.y + (hash2(floor(sp/3.)) - .5)*0.04;
  vec3 bg = mix(uBgB, uBgA, g);
  vec2 dq = gl_FragCoord.xy/1024.;
  float d1 = texture(tDust, dq + uPar*0.25).r, d2 = texture(tDust, dq*0.71 + uPar*0.5 + 0.31).g, d3 = texture(tDust, dq*0.43 + uPar*0.9 + 0.77).b;
  bg += uDustC*(d1*0.35 + d2*0.55 + d3*0.9)*uDust;
  if (uRoom > 0.) {                                   // b56+: a red room of pure light with a hot horizon behind the hand
    float dy = sp.y - uHorY;
    vec3 room = dy < 0. ? mix(vec3(0.7, 0.025, 0.035), vec3(0.2, 0.0, 0.025), clamp(-dy/1100., 0., 1.))
                        : mix(vec3(0.5, 0.01, 0.03), vec3(0.1, 0.0, 0.015), clamp(dy/900., 0., 1.));
    room += vec3(1., 0.4, 0.2)*exp(-abs(dy)/9.)*1.4 + vec3(1., 0.16, 0.08)*exp(-abs(dy)/150.)*0.55;
    bg = mix(bg, room + uDustC*(d2*0.55 + d3*0.9)*uDust, uRoom); }
  // the official mark as a faint cream plane under the points (b66-72)
  if (uMarkA > 0.) { vec2 mu = (sp - uMarkR.xy)/uMarkR.zw; if (all(greaterThan(mu, vec2(0.))) && all(lessThan(mu, vec2(1.)))) bg += vec3(0.96, 0.9, 0.8)*texture(tMark, mu).a*uMarkA; }
  if (uLockA > 0.) { vec2 mu = (sp - uLockR.xy)/uLockR.zw; if (all(greaterThan(mu, vec2(0.))) && all(lessThan(mu, vec2(1.)))) bg += vec3(0.96, 0.9, 0.8)*texture(tLock, mu).a*uLockA; }
  vec3 bloom = texture(tB1, uv).rgb*0.55 + texture(tB2, uv).rgb*0.8 + texture(tB3, uv).rgb*1.1;
  vec3 col = bg*(1. - clamp(P.a, 0., 1.)) + P.rgb + bloom*uBloom;
  // ---------------- ice monuments over the lattice (b28-42)
  vec2 sd0 = sp - vec2(540., 960.); sd0.x *= 1. + uKey*(1. - sp.y/1920.);      // seen from below: the top recedes
  vec2 mp = rot(uMonCam.w)*sd0/uMonCam.z + uMonCam.xy;
  if (uBurstL > 0.) {                                 // behind the bursting ice: a furnace of gold-white light and steam
    float st = fbmN(sp*0.004 + vec2(0., uT*0.9)), st2 = fbmN(sp*0.011 - vec2(uT*0.3, uT*1.4));
    float ang = atan(sp.y - 960., sp.x - 540.), rays = fbmN(vec2(ang*9., uT*0.6))*exp(-length(sp - vec2(540., 960.))/900.);
    vec3 lf = mix(vec3(0.5, 0.06, 0.012), vec3(1., 0.5, 0.1), smoothstep(0.42, 0.72, st*0.7 + st2*0.5))
            + vec3(1., 0.75, 0.4)*pow(smoothstep(0.55, 0.85, st2), 2.)*0.5 + vec3(1., 0.55, 0.2)*pow(rays, 2.)*0.8;
    lf *= 0.7;
    col = mix(col, lf + P.rgb*0.5, uBurstL); }
  if (uIce > 0.) {
    float rel, dM;
    if (uBurst < 0.) dM = monuments(mp, rel);
    else {                                            // b40: the wall bursts along the ≡ planes: 4 bands x 3 pieces on rigid trajectories
      dM = 1e5; rel = 0.;
      for (int s = 0; s < 12; s++) {
        int sb = s/3, sc = s - sb*3; float fs = float(sb), fc = float(sc) - 1.;
        vec2 v = (sb == 0 ? vec2(-140., -1250.) : sb == 1 ? vec2(-1250., -300.) : sb == 2 ? vec2(1250., -220.) : vec2(160., 820.)) + vec2(fc*900., (hash2(vec2(float(s), 3.)) - .5)*700.);
        float w = (sb == 0 ? -0.6 : sb == 1 ? 0.95 : sb == 2 ? -0.85 : 0.4) + fc*0.7;
        float yc = sb == 0 ? uCY.x - 400. : sb == 1 ? (uCY.x + uCY.y)*.5 : sb == 2 ? (uCY.y + uCY.z)*.5 : uCY.z + 400.;
        vec2 pv = vec2(540. + fc*360., yc);
        vec2 q = mp - pv - v*uBurst - vec2(0., 1100.)*uBurst*uBurst;
        q = rot(-w*uBurst)*q + pv;
        if (slabOf(q.y) != fs) continue;
        float qc = q.x + (vn(vec2(q.y*0.01, fs*3.)) - .5)*160.;
        if ((qc < 360. ? 0. : qc < 720. ? 1. : 2.) != float(sc)) continue;
        float rr; float ds = monuments(q, rr);
        float gap = min(abs(q.y - uCY.x), min(abs(q.y - uCY.y), abs(q.y - uCY.z)));
        ds = max(ds, 14. - gap);
        if (ds < dM) { dM = ds; rel = rr; } } }
    float ppx = dM*uMonCam.z;
    float inside = smoothstep(2. + uMonSoft*30., -2. - uMonSoft*30., ppx);
    float h = 150.*(1. - exp(min(dM, 0.)/70.)) + rel*inside;          // rounded bevel + carved relief
    vec2 dh = vec2(dFdx(h), dFdy(h));
    if (inside > 0.001) {
      vec3 n = normalize(vec3(-dh.x, dh.y, 1.4));
      vec4 vr = texture(tVor, mp*0.0011);
      n = normalize(n + vec3((hash22(vec2(vr.b*97.)) - .5)*0.12*(1. - uMonSoft), 0.));
      vec2 ruv = uv + n.xy*0.05;
      vec3 behind = texture(tP, ruv).rgb + texture(tB2, ruv).rgb*0.9 + texture(tB3, ruv).rgb*0.6;
      float fres = pow(1. - n.z, 2.);
      float facet = 1. - smoothstep(0., 0.03, vr.g);
      float thick = max(clamp(-dM/260., 0., 1.), uWall*0.8);
      // glacier body: milky blue scattering near the skin, deep blue-black in the core
      vec3 body = mix(vec3(0.34, 0.66, 0.9), vec3(0.015, 0.07, 0.16), smoothstep(0.02, 0.55, thick));
      float lam = max(0., dot(n, normalize(vec3(-0.45, 0.65, 0.6))));
      float shadow = max(0., dot(n, normalize(vec3(0.5, -0.6, 0.5))));
      vec3 ice = behind*vec3(0.45, 0.8, 1.)*0.2 + body*(0.12 + 1.35*lam) - vec3(0.05, 0.08, 0.1)*shadow
               + vec3(0.85, 0.96, 1.)*(fres*0.9 + facet*0.05*(1. - uMonSoft));
      ice += vec3(0.92, 0.98, 1.)*pow(max(0., dot(n, normalize(vec3(-0.4, 0.55, 0.72)))), 40.)*2.2;
      // trapped air: bubble trails and specks at two depths; fracture veils catch the light
      vec2 bq = mp*0.0016;
      float bub = texture(tDust, bq + n.xy*0.01).r*0.5 + texture(tDust, bq*0.53 + 0.4).b*0.8;
      vec2 wq = mp*0.00031 + vec2(fbmN(mp*0.0021), fbmN(mp*0.0021 + 7.))*0.09;
      vec4 vf = texture(tVor, wq + 0.21);
      float veil = exp(-vf.g*90.)*step(0.72, vf.b)*smoothstep(0.1, 0.5, thick)*(0.5 + fbmN(mp*0.01));
      float cloud = fbmN(mp*0.0045 + 3.)*fbmN(mp*0.0013);
      ice += vec3(0.75, 0.92, 1.)*(bub*0.35*(1. - thick*0.5) + veil*0.7) + vec3(0.3, 0.55, 0.8)*cloud*0.35*thick;
      float ao = clamp(0.55 + (rel - 10.)/90., 0.35, 1.25), topL = mix(1.25, 0.6, clamp(sp.y/1920., 0., 1.));
      ice *= ao*topL;
      ice += vec3(0.35, 0.7, 1.)*(1. - thick)*0.25*inside;
      float rimL = exp(-abs(ppx)/3.)*2.2 + exp(-abs(ppx)/20.)*0.25;
      ice += vec3(0.85, 0.96, 1.)*rimL;
      if (uBurst >= 0.) ice = vec3(0.01, 0.04, 0.11)*(0.3 + 1.4*lam) + vec3(0.2, 0.45, 0.8)*pow(max(0., dot(n, normalize(vec3(-0.4, 0.55, 0.72)))), 30.) + vec3(0.4, 0.75, 1.)*veil*0.4 + vec3(1., 0.62, 0.25)*(rimL*1.4 + fres*1.6);
      col = mix(col, ice, inside*uIce);
    }
  }
  // ---------------- frost over everything (GROW table steps it on the chops)
  if (uFrostA > 0.) {
    vec4 fr = texture(tFrost, vec2(uv.x, 1. - uv.y));
    float grown = smoothstep(uFrostT + 0.015, uFrostT - 0.05, fr.g);
    float front = exp(-abs(fr.g - uFrostT)*55.)*step(fr.g, uFrostT + 0.02);
    col *= 1. - grown*0.3*uFrostA;
    float fe = smoothstep(0.35, 0.85, fr.r);
    col += (vec3(0.72, 0.9, 1.)*grown*fe*(0.6 + 0.8*fr.b) + vec3(0.9, 1., 1.)*front*(0.3 + 0.9*fe))*uFrostA*0.7;
  }
  // ---------------- the ≡: three cracks open from inside, shared across every monument
  if (uCrackHot > 0.) {
    vec3 lit = vec3(0.); float mask = 0., slit = 0.;
    for (int k = 0; k < 3; k++) {
      float fk = float(k), yk = k == 0 ? uCY.x : k == 1 ? uCY.y : uCY.z;
      float jag = (texture(tVor, vec2(mp.x*0.0011, 0.13 + 0.29*fk)).a - 0.5)*10.*(1. - uBand/80.);
      float dy = abs(mp.y - yk - jag)*uMonCam.z;
      float ext = uCrack[k]*800.;
      float along = smoothstep(ext, ext - 70., abs(mp.x - uCX));
      float bar = smoothstep(uBand + 2., uBand - 2., dy);
      float core = exp(-dy*dy/(40. + uBand*uBand*0.2)), glow = exp(-dy/(36. + uBand));
      vec3 cc = mix(vec3(1., 0.62, 0.22), vec3(1., 0.97, 0.9), clamp(core + bar, 0., 1.));
      lit += cc*(core*2.4 + bar*2.4 + glow*0.7)*along;
      mask = max(mask, glow*along); slit += (core + bar)*along;
    }
    col *= mix(1., mix(0.35, 1., clamp(mask*1.6, 0., 1.)), uDark);       // the ≡ is the only light
    col += lit*uCrackHot;
    col += (texture(tP, uv).rgb*1.5 + texture(tB2, uv).rgb*2.5)*vec3(1., 0.85, 0.6)*clamp(slit, 0., 1.)*uCrackHot;   // lattice pulses flash through
  }
  // ---------------- water: two scrolling voronoi layers, min blend; saturates to white-gold with red fringes
  if (uWater > 0.) {
    vec2 q = uv*vec2(1., 1.7778), a1 = q*1.1 + vec2(0., uT*0.3), a2 = q*1.7 + vec2(uT*0.12, -uT*0.22) + 0.37;
    float e = 1./256.;
    float c = texture(tVor, a1).r + texture(tVor, a2).r;
    vec2 gr = vec2(texture(tVor, a1 + vec2(e, 0.)).r + texture(tVor, a2 + vec2(e, 0.)).r - c,
                   texture(tVor, a1 + vec2(0., e)).r + texture(tVor, a2 + vec2(0., e)).r - c)/(e*16.);
    vec2 ruv = uv + gr*0.035;
    vec3 refr = texture(tP, ruv).rgb*1.4 + texture(tB1, ruv).rgb*0.8 + texture(tB2, ruv).rgb*0.5;
    float caus = 0.5 + 1.6*pow(1. - clamp(c*0.55, 0., 1.), 3.);
    col = mix(col, refr*vec3(1., 0.72, 0.4)*caus, uWater*0.55);
  }
  if (uEmber > 0.) {                                  // the searched points, called back: red embers rise through haze round the column
    vec2 eq = gl_FragCoord.xy/1024.;
    float e1 = texture(tDust, eq*0.8 + vec2(0.07*sin(uT*0.7), -uT*0.16)).a, e2 = texture(tDust, eq*0.45 + vec2(0.3, -uT*0.09)).b;
    float hz = exp(-pow((sp.x - 540.)/330., 2.));
    col += (vec3(1., 0.12, 0.04)*(e1*1.3 + e2*0.9) + vec3(0.5, 0.12, 0.03)*hz*0.35 + vec3(0.25, 0.03, 0.01)*(1. - uv.y)*0.5)*uEmber; }
  col += uFlash.rgb*uFlash.a;
  // ---------------- grade: tone map, saturation, luma floor (never murk)
  col = vec3(1.) - exp(-col*uExpo);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = clamp(mix(vec3(l), col, uSat), 0., 1.);
  col = uFloor + col*(1. - uFloor);
  o = vec4(col, 1.); }`;

const PP = prog(PTS_VS, PTS_FS), PB = prog(BEAM_VS, BEAM_FS), PD = prog(FSQ_VS, DOWN_FS), PBL = prog(FSQ_VS, BLUR_FS), PC = prog(FSQ_VS, COMP_FS);

// render targets
const RT = fbo(tex(W, H), W, H, true);
const q1 = fbo(tex(270, 480), 270, 480), q2 = fbo(tex(270, 480), 270, 480);
const e1 = fbo(tex(135, 240), 135, 240), e2 = fbo(tex(135, 240), 135, 240);
const s1 = fbo(tex(68, 120), 68, 120), s2 = fbo(tex(68, 120), 68, 120);

// buffers
const ATTRS = [aS, aF, aL, aH0, aH1, aH2, aN0, aN2, aM];
const bufs = ATTRS.map(a => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, a, gl.STATIC_DRAW); return b; });
const vaoP = gl.createVertexArray(); gl.bindVertexArray(vaoP);
bufs.forEach((b, i) => { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, 4, gl.FLOAT, false, 0, 0); });
const STREAK_EVERY = 4, NSTREAK = N / STREAK_EVERY;
const vaoL = gl.createVertexArray(); gl.bindVertexArray(vaoL);
bufs.forEach((b, i) => { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, 4, gl.FLOAT, false, 16 * STREAK_EVERY, 0); gl.vertexAttribDivisor(i, 1); });
const beamBuf = gl.createBuffer(), vaoB = gl.createVertexArray();
gl.bindVertexArray(vaoB); gl.bindBuffer(gl.ARRAY_BUFFER, beamBuf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
gl.bindVertexArray(null);

// the mind's filaments: every edge and axon as a crisp anti-aliased screen-space quad, pulse packets racing along it
const LINE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec4 aA; layout(location=1) in vec4 aB;
uniform mat4 uVP; uniform float uPsi, uFocus, uDof; uniform vec2 uRes;
out float vD, vHW, vU, vI; flat out vec4 vE;
vec3 latW(vec3 P){ float c = cos(uPsi), s = sin(uPsi); vec3 q = vec3(c*P.x + s*P.z, P.y, -s*P.x + c*P.z);
  float ct = cos(.3), st = sin(.3); return vec3(q.x, ct*q.y - st*q.z, st*q.y + ct*q.z) + vec3(0., 6., 0.); }
void main(){
  int v = gl_VertexID; float u = (v == 1 || v == 2 || v == 4) ? 1. : 0., side = (v == 2 || v == 4 || v == 5) ? 1. : -1.;
  vec4 ca = uVP*vec4(latW(aA.xyz), 1.), cb = uVP*vec4(latW(aB.xyz), 1.);
  if (ca.w < 0.2 || cb.w < 0.2) { gl_Position = vec4(2., 2., 2., 1.); return; }
  vec2 sa = ca.xy/ca.w*uRes*0.5, sb = cb.xy/cb.w*uRes*0.5;
  vec2 dir = sb - sa; float L = length(dir); dir = L > 1e-3 ? dir/L : vec2(1., 0.);
  vec4 c = u < .5 ? ca : cb; vec2 sc = u < .5 ? sa : sb;
  float coc = uDof*abs(c.w - uFocus)/c.w*0.6;
  float hw = 0.55 + aA.w*0.35 + coc*0.5;
  vec2 sp = sc + vec2(-dir.y, dir.x)*side*(hw + 1.2) + dir*(u < .5 ? -1. : 1.)*1.2;
  gl_Position = vec4(sp/(uRes*0.5)*c.w, c.z, c.w);
  vD = side*(hw + 1.2); vHW = hw; vU = u; vI = min(1., 1.3/(hw*hw + 0.1))*smoothstep(0.2, 3., c.w);
  vE = vec4(aB.w, aA.w, L, 0.);
}`;
const LINE_FS = `#version 300 es
precision highp float;
in float vD, vHW, vU, vI; flat in vec4 vE; out vec4 o;
uniform float uPulse, uThink, uDrain, uCold, uFire, uQuiet, uAlpha;
void main(){
  float a = clamp(vHW + 0.5 - abs(vD), 0., 1.)*vI*uAlpha; if (a <= 0.) discard;
  float ph = vE.x, ax = vE.y, spd = 0.35 + fract(ph*7.3)*0.5, dirn = fract(ph*13.1) > 0.5 ? 1. : -1.;
  float pu = 0.; for (int k = 0; k < 2; k++) { float c = fract(uPulse*spd*dirn + ph + float(k)*0.5); float d = vU - c; d -= floor(d + 0.5); pu += exp(-d*d*380.); }
  pu *= step(0.35, fract(ph*3.7 + floor(uPulse*0.5)*0.37));
  vec3 base = vec3(0.95, 0.46, 0.1)*(0.28 + 0.25*ax), hot = vec3(1., 0.86, 0.55);
  vec3 col = base + hot*pu*uThink*2.4;
  col = mix(col, vec3(0.22, 0.21, 0.2)*(0.5 + 0.3*ax) + vec3(0.5)*pu*0.15, uDrain*(1. - uCold));
  col = mix(col, vec3(0.35, 0.72, 1.)*(0.3 + 0.25*ax) + vec3(0.8, 0.95, 1.)*pu*0.6, uCold);
  col += vec3(1., 0.75, 0.4)*pu*uFire*3.;
  col *= 1. - uQuiet*0.75;
  o = vec4(col*a, 0.); }`;
const PLN = prog(LINE_VS, LINE_FS);
const LINEDATA = (() => { const seen = new Set(), a = [];
  edges.forEach(([i, j], k) => { const key = i < j ? i + ',' + j : j + ',' + i; if (seen.has(key)) return; seen.add(key);
    const A = nodes[i], Bn = nodes[j], ph = rng(k * 7 + 3)();
    a.push(A[0], A[1], A[2], k >= EDGE0 ? 1 : 0, Bn[0], Bn[1], Bn[2], ph); });
  return new Float32Array(a); })();
const NLINE = LINEDATA.length / 8;
const vaoLN = gl.createVertexArray(); gl.bindVertexArray(vaoLN);
{ const bb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bb); gl.bufferData(gl.ARRAY_BUFFER, LINEDATA, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(0, 1);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(1, 1); }
gl.bindVertexArray(null);
console.log(`[meltdown8] ${NLINE} filaments`);

// ================================================================ matrices
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function camera(t) {
  const b = t / SPB;
  let k = 0; for (let i = 0; i < SHOTS.length; i++) if (b >= SHOTS[i][0] - 1e-6) k = i;
  const s = SHOTS[k][1](b - SHOTS[k][0]);
  const kick = env('kick', t, 11) * (b >= 8 && b < 24 || b >= 40 && b < 64 ? 1 : 0) + env('impact', t, 7) * 1.4 + env('taiko', t, 12) * (b >= 24 && b < 28 ? 0.6 : 0);
  const sh = kick * 0.012 * Math.hypot(...sub(s.eye, s.tg));
  const eye = [s.eye[0] + Math.sin(t * 91) * sh, s.eye[1] + Math.cos(t * 77) * sh, s.eye[2] + Math.sin(t * 63) * sh];
  const fov = s.fov * (1 - 0.035 * env('impact', t, 6) - 0.015 * env('kick', t, 10));
  const z = nrm(sub(eye, s.tg));
  const up0 = Math.abs(z[1]) > 0.97 ? [0, 0, -1] : [0, 1, 0];
  let x = nrm(cross(up0, z)), y = cross(z, x);
  const r = s.roll || 0;
  if (r) { const c = Math.cos(r), sn = Math.sin(r); const x2 = [x[0] * c + y[0] * sn, x[1] * c + y[1] * sn, x[2] * c + y[2] * sn]; y = cross(z, x2); x = x2; }
  const V = [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
  const f = 1 / Math.tan(fov * Math.PI / 360), n = 0.1, fa = 600, asp = W / H;
  const P = [f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (fa + n) / (n - fa), -1, 0, 0, 2 * fa * n / (n - fa), 0];
  const VP = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) { let v = 0; for (let q = 0; q < 4; q++) v += P[q * 4 + rr] * V[c * 4 + q]; VP[c * 4 + rr] = v; }
  return { VP, eye, proj: f * H / 2, shot: k, tg: s.tg, dist: Math.hypot(...sub(eye, s.tg)) };
}
function project(VP, p) {
  const x = VP[0] * p[0] + VP[4] * p[1] + VP[8] * p[2] + VP[12], y = VP[1] * p[0] + VP[5] * p[1] + VP[9] * p[2] + VP[13];
  const w = VP[3] * p[0] + VP[7] * p[1] + VP[11] * p[2] + VP[15];
  if (w < 0.1) return null;
  return [(x / w * 0.5 + 0.5) * W, (1 - (y / w * 0.5 + 0.5)) * H, w];
}
function latW(P, psi) {
  const c = Math.cos(psi), s = Math.sin(psi);
  const q = [c * P[0] + s * P[2], P[1], -s * P[0] + c * P[2]];
  const ct = Math.cos(0.3), st = Math.sin(0.3);
  return [q[0] + LATC[0], ct * q[1] - st * q[2] + LATC[1], st * q[1] + ct * q[2] + LATC[2]];
}

// ================================================================ per-frame stage uniforms
const RINGEV = [...B.hits.hat.filter(h => h < bt(8) - 1e-3), ...B.hits.kick.filter(h => h >= bt(8) - 1e-3 && h < bt(16))];
function rings(t) {
  const out = new Float32Array(16); let n = 0;
  for (let i = RINGEV.length - 1; i >= 0 && n < 4; i--) {
    const te = RINGEV[i]; if (te > t + 1e-4) continue;
    const a = BEAM0 + Afun(te), rr = rng(Math.floor(te * 1000))(), rho = 10 + rr * 44;
    out.set([Math.cos(a) * rho, Math.sin(a) * rho, te, te < bt(8) ? 1 : 0.8], n * 4); n++;
  }
  return out;
}
function monCam(t) {
  const b = t / SPB;
  if (b >= 38) return [540, 960, 1, 0, 0];
  if (b >= 36) { const u = ease.inOutCubic((b - 36) / 2), m = MONCAM[5]; return [lerp(m[0], 540, u), lerp(m[1], 960, u), lerp(m[2], 1, u), lerp(m[3], 0, u), lerp(m[4], 0, u)]; }
  let k = 0; for (let i = 0; i < 6; i++) if (t >= CHOP[i] - 1e-4) k = i;
  const m = MONCAM[k], u = (t - CHOP[k]) / SPB;
  return [m[0], m[1] + u * 14, m[2] * (1 + 0.02 * u), m[3], m[4]];      // a slow tilt up the idol
}
function stage(t) {
  const b = t / SPB, U = {};
  U.A = Afun(t); U.beamOn = b < 16 ? 1 : clamp(1 - (b - 16) / 0.8);
  U.pulse = clk(pulseTab, t); U.psi = clk(yawTab, Math.min(t, bt(40))); U.psiPrev = clk(yawTab, Math.min(t - 1.6 / FPS, bt(40)));
  U.think = b < 16 ? 0 : b < 24 ? lerp(0.55, 1, (b - 16) / 8) : 1;
  U.drain = b < 40 ? smooth(24, 24.9, b) : 0;
  U.quiet = smooth(25, 27, b) * (1 - smooth(27.9, 28.05, b));
  U.cold = smooth(27.95, 28.6, b) * (1 - smooth(40, 40.5, b));
  U.fire = b < 40.3 ? Math.pow(smooth(36, 40, b), 1.6) : 0;
  U.shiver = b >= 36 && b < 40 ? smooth(36, 40, b) * (0.5 + 0.8 * env('snare', t, 12)) : 0;
  U.light = smooth(41, 43, b);
  U.pose = b < 60 ? 0 : b < 64 ? 0.85 * ease.inOutCubic((b - 60) / 3.95) : 0.85 + 1.15 * ease.outBack(clamp((t - bt(64)) / 0.14));
  U.pool = smooth(56, 62, b);
  U.back = smooth(54.5, 56, b);
  U.fist = b >= 64 ? Math.exp(-(t - bt(64)) * 2.5) : 0;
  // size / DoF / exposure by stage
  const cam = U.cam = camera(t);
  U.size = b < 16 ? 0.12 : b < 40 ? 0.05 : b < 55 ? 0.045 : 0.03;
  U.gain = b < 16 ? 0.8 : b < 24 ? 0.2 : b < 40 ? 0.45 : b < 56 ? 0.15 : 0.42;
  if (b >= 40 && b < 42) U.gain *= 1 + 1.5 * (1 - smooth(40, 41.5, b));
  U.focus = b >= 12 && b < 14.5 ? 9 : b < 16 ? cam.dist : b < 36 ? cam.dist : b < 40 ? lerp(cam.dist * 0.6, cam.dist, smooth(36, 37.5, b)) : cam.dist;
  U.dof = b < 12 ? 2.2 : b < 16 ? 1.6 : b < 28 ? 0.7 : b < 36 ? 6 : b < 40 ? lerp(12, 2.5, smooth(36, 37.5, b)) : b < 44 ? 0.6 : b < 56 ? 1.5 : 1;
  // composite
  // each stage its own ground
  if (b < 12) { U.bgA = [0.006, 0.014, 0.075]; U.bgB = [0.0, 0.004, 0.03]; U.floor = [0.004, 0.008, 0.04]; U.dustC = [0.35, 0.5, 1.0]; U.dust = 0.4; }       // search: near-black ultramarine
  else if (b < 24) { U.bgA = [0.035, 0.016, 0.0]; U.bgB = [0.006, 0.002, 0.0]; U.floor = [0.006, 0.003, 0.0]; U.dustC = [1.0, 0.62, 0.2]; U.dust = 0.18; }      // birth: black and molten gold
  else if (b < 28) { const k = b < 27 ? 1 : 0.25; U.bgA = [0.035 * k, 0.034 * k, 0.034 * k]; U.bgB = [0.012 * k, 0.012 * k, 0.012 * k]; U.floor = [0.008 * k, 0.008 * k, 0.008 * k]; U.dustC = [0.6, 0.6, 0.6]; U.dust = 0.3 * k; } // period: charcoal, then black
  else if (b < 40) { U.bgA = [0.0, 0.03, 0.16]; U.bgB = [0.0, 0.008, 0.06]; U.floor = [0.0, 0.012, 0.03]; U.dustC = [0.6, 0.85, 1.0]; U.dust = 0.25; }   // freeze: deep saturated blue
  else if (b < 56) { const k = smooth(40.5, 42.5, b); U.bgA = [lerp(0, 0.16, k), lerp(0.015, 0.01, k), lerp(0.08, 0.01, k)]; U.bgB = [lerp(0, 0.03, k), 0.002, lerp(0.025, 0.004, k)]; U.floor = [0.012, 0.002, 0.004]; U.dustC = [1.0, lerp(0.85, 0.45, k), lerp(1.0, 0.15, k)]; U.dust = 0.35; }   // melt: oxblood under molten light
  else { U.bgA = [0.2, 0.0, 0.02]; U.bgB = [0.08, 0.0, 0.01]; U.floor = [0.02, 0.0, 0.004]; U.dustC = [1.0, 0.35, 0.2]; U.dust = 0.15; }              // the red room
  U.room = b < 56 ? 0 : smooth(56, 56.3, b);
  { const hp = project(cam.VP, hw([0.02, 1.25, 0.05])); U.horY = hp ? clamp(hp[1], 150, 1500) : 700; }
  U.par = [cam.eye[0] * 0.004 + cam.eye[2] * 0.002, cam.eye[1] * 0.004];
  U.bloom = b < 16 ? 1.0 : b < 40 ? 0.9 : 1.1;
  U.expo = b < 10 ? 1.45 : b < 16 ? 1.1 : b < 18 ? 0.7 : b < 24 ? 0.9 : b < 27 ? lerp(0.9, 0.7, smooth(24, 27, b)) : b < 28 ? 0.3 : b < 40 ? 1.25 : b < 42 ? 0.72 : b < 56 ? 0.75 : 0.95;
  U.sat = b < 24 ? 1.25 : b < 28 ? lerp(1.25, 0.3, 1 - Math.pow(1 - clamp((b - 24) / 3.9), 4)) : b < 40 ? 1.2 : b < 56 ? 1.5 : 1.3;
  // freeze
  let fT = -0.2;
  if (t >= CHOP[0] - 1e-4) { let k = 0; for (let i = 0; i < 6; i++) if (t >= CHOP[i] - 1e-4) k = i; fT = lerp(k ? FROST_L[k - 1] : 0, FROST_L[k], ease.outCubic((t - CHOP[k]) / 0.3)); }
  U.frostT = b < 40 ? fT : FROST_L[5]; U.frostA = b < 28 ? 0 : b < 40 ? 1 : 0;
  { let k = -1; for (let i = 0; i < 6; i++) if (t >= CHOP[i] - 1e-4) k = i;   // one idol per chop, all four from the wide
    const g = k < 0 ? 0 : ease.outBack(clamp((t - CHOP[k]) / 0.35)), solo = k < 0 ? [0, 0, 0, 0] : MONSOLO[k];
    U.grow = solo.map((on, j) => on ? (k >= 4 && k > 4 ? 1 : g) : 0); }
  U.wall = b < 36 ? 0 : b < 40 ? smooth(36, 37, b) : 1;
  U.dark = b < 36 ? 0 : b < 40 ? smooth(36, 37.2, b) : 1 - smooth(40, 40.3, b);
  const acc = (t >= CHOP[4] - 1e-4 ? 0.04 : 0) + (t >= CHOP[5] - 1e-4 ? 0.04 : 0);
  U.ice = b < 28 ? 0 : b < 40 ? 0.8 + acc : (1 - smooth(41.6, 42.6, b)) * 0.9;
  U.monSoft = b >= 36 && b < 40 ? smooth(36, 37.5, b) * (1 - smooth(38, 38.6, b)) : 0;
  U.monCam = monCam(t);
  const sn = B.hits.snare.filter(h => h >= bt(36) - 1e-4);
  // the ≡: three parallel cracks open on the b36-37 snares, equal extents, full by b37.5
  U.crack = [36, 36.5, 37].map(s0 => b >= 40 ? 1.2 : t < bt(s0) ? 0 : 1.2 * ease.outCubic(clamp((t - bt(s0)) / bt(0.5))));
  U.crackHot = b < 36 ? 0 : b < 40 ? 0.8 + 0.9 * env('snare', t, 9) + smooth(38, 40, b) : Math.max(0, 1.6 * (1 - smooth(40.4, 41.4, b)));
  U.band = b < 38 ? 0 : b < 40 ? 30 * smooth(38.5, 39.9, b) : 30;
  U.cY = [810, 960, 1110]; U.cX = 540;
  if (b >= 64 && b < 65.5) {                             // the fist closes: light sprays out between the fingers in three bands
    const fp = project(cam.VP, hw([0.02, 0.62, 0.22])); const fy = fp ? fp[1] : 900, fx = fp ? fp[0] : 540;
    U.cY = [fy - 95, fy, fy + 95]; U.cX = fx; U.band = 0; U.dark = 0;
    const u = clamp((t - bt(64)) / 0.1); U.crack = [0.55, 0.62, 0.55].map(e => e * ease.outCubic(u));
    U.crackHot = 2.2 * Math.exp(-(t - bt(64)) * 2.2) * (1 - smooth(65, 65.5, b));
  }
  U.burst = b >= 40 ? 0.85 * (t - bt(40)) : -1;              // slabs part slowly: light pours through the ≡
  U.ember = smooth(43, 45, b) * (1 - smooth(55.5, 56.2, b));
  U.burstL = b < 40 ? 0 : smooth(40, 40.15, b) * (1 - smooth(41.8, 42.6, b));
  U.water = smooth(41.5, 42.2, b) * (1 - smooth(43.5, 44, b));
  U.lightA = smooth(40.6, 42.3, b);
  U.markA = b >= 66 && b < 68 ? 0.3 * smooth(66, 66.6, b) : 0;
  U.lockA = b >= 68 ? 0.28 * smooth(68.2, 68.8, b) : 0;
  const fl = env('impact', t, 9), fb = [16, 40, 64].some(x => b >= x && b < x + 1) ? 1 : 0.25;
  U.flash = b >= 40 && b < 41 ? [1, 0.5, 0.12, t - bt(40) < 2 / FPS + 1e-4 ? 1.1 : fl * 0.25]
    : b >= 64 && b < 65 ? [1, 0.3, 0.06, fl * 1.1] : [1, 0.8, 0.6, fl * 0.6 * fb];
  U.streak = (b >= 8 && b < 27.5) || (b >= 40 && b < 64.5);
  U.hand = b >= 55;
  return U;
}

// ================================================================ render
const S = (u, n, ...v) => { const l = u[n]; if (l == null) return; if (v.length === 1) gl.uniform1f(l, v[0]); else if (v.length === 2) gl.uniform2f(l, ...v); else if (v.length === 3) gl.uniform3f(l, ...v); else gl.uniform4f(l, ...v); };
function renderGL(t) {
  const U = stage(t), cam = U.cam, b = t / SPB;
  gl.bindFramebuffer(gl.FRAMEBUFFER, RT.f); gl.viewport(0, 0, W, H);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(PP.p); const u = PP.u;
  gl.uniformMatrix4fv(u.uVP, false, cam.VP); S(u, 'uEye', ...cam.eye); S(u, 'uProj', cam.proj);
  S(u, 'uT', t); S(u, 'uDt', (b >= 40 ? 3.2 : 1.6) / FPS); S(u, 'uSpb', SPB);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tAinv); gl.uniform1i(u.uAinv, 0);
  S(u, 'uAmax', AMAX); S(u, 'uA', U.A); S(u, 'uBeamOn', U.beamOn); S(u, 'uBeam0', BEAM0);
  gl.uniform4fv(u.uRing, rings(t));
  for (const [k, v] of [['uPsi', U.psi], ['uPsiPrev', U.psiPrev], ['uPulse', U.pulse], ['uThink', U.think], ['uDrain', U.drain], ['uQuiet', U.quiet], ['uCold', U.cold],
    ['uFire', U.fire], ['uShiver', U.shiver], ['uKick', env('kick', t, 10)], ['uLight', U.light], ['uPose', U.pose], ['uPool', U.pool], ['uFist', U.fist],
    ['uFocus', U.focus], ['uDof', U.dof], ['uSize', U.size], ['uGain', HALF ? U.gain : U.gain * 0.6]]) S(u, k, v);
  S(u, 'uHandO', ...HAND_O); gl.uniformMatrix4fv(u.uBone, false, handBones(U.pose)); S(u, 'uBack', U.back); gl.uniformMatrix3fv(u.uHandM, false, new Float32Array(HAND_M)); S(u, 'uHandS', HAND_S);
  if (U.hand) {                                           // the hand: depth occluders first, so it reads as a dark body
    gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.uniform1i(u.uPass, 2); gl.bindVertexArray(vaoP); gl.drawArrays(gl.POINTS, 0, N);
    gl.depthMask(false);
  } else gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
  gl.uniform1i(u.uPass, 0); gl.bindVertexArray(vaoP); gl.drawArrays(gl.POINTS, 0, N);
  if (U.streak) { gl.uniform1i(u.uPass, 1); gl.bindVertexArray(vaoL); gl.drawArraysInstanced(gl.LINES, 0, 2, NSTREAK); }
  const la = b < 16 ? 0 : b < 40.3 ? smooth(16, 17.2, b) : 0;
  if (la > 0) {
    gl.useProgram(PLN.p); const lu = PLN.u;
    gl.uniformMatrix4fv(lu.uVP, false, cam.VP); S(lu, 'uRes', W, H);
    for (const [k, v] of [['uPsi', U.psi], ['uFocus', U.focus], ['uDof', U.dof], ['uPulse', U.pulse], ['uThink', U.think], ['uDrain', U.drain], ['uCold', U.cold],
      ['uFire', U.fire], ['uQuiet', U.quiet], ['uAlpha', la * (b >= 28 && b < 36 ? 0.55 : 1)]]) S(lu, k, v);
    gl.bindVertexArray(vaoLN); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, NLINE);
  }
  gl.disable(gl.DEPTH_TEST);
  if (U.beamOn > 0) {                                     // the beam
    const a0 = BEAM0 + U.A, v = [];
    for (let k = 0; k < 28; k++) {
      const b0 = k * 0.03, b1 = (k + 1) * 0.03, al0 = Math.exp(-b0 * 5) * 0.55, al1 = Math.exp(-b1 * 5) * 0.55;
      const c0 = [Math.cos(a0 - b0) * 70, Math.sin(a0 - b0) * 70], c1 = [Math.cos(a0 - b1) * 70, Math.sin(a0 - b1) * 70];
      v.push(0, 0.3, 0, al0 * 1.4, c0[0], 0.3, c0[1], al0 * 0.1, c1[0], 0.3, c1[1], al1 * 0.1);
    }
    const ca = [Math.cos(a0) * 70, Math.sin(a0) * 70];
    const cb = [Math.cos(a0 - 0.012) * 70, Math.sin(a0 - 0.012) * 70];
    v.push(0, 0.35, 0, 1.6, ca[0], 0.35, ca[1], 0.5, cb[0], 0.35, cb[1], 0.5);
    gl.useProgram(PB.p); gl.uniformMatrix4fv(PB.u.uVP, false, cam.VP); S(PB.u, 'uOn', U.beamOn * (1 + 0.6 * env('hat', t, 14)));
    gl.bindVertexArray(vaoB); gl.bindBuffer(gl.ARRAY_BUFFER, beamBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, v.length / 4);
  }
  gl.disable(gl.BLEND);
  // bloom at quarter / eighth / sixteenth res
  const down = (src, dst, sw, shh) => runFS(PD, dst, uu => { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src); gl.uniform1i(uu.tS, 0); S(uu, 'uTx', 1 / sw, 1 / shh); });
  const blur = (src, dst, dx, dy) => runFS(PBL, dst, uu => { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src); gl.uniform1i(uu.tS, 0); S(uu, 'uDir', dx, dy); });
  down(RT.t, q1, W, H); blur(q1.t, q2, 1 / 270, 0); blur(q2.t, q1, 0, 1 / 480);
  down(q1.t, e1, 270, 480); blur(e1.t, e2, 1 / 135, 0); blur(e2.t, e1, 0, 1 / 240);
  down(e1.t, s1, 135, 240); blur(s1.t, s2, 1 / 68, 0); blur(s2.t, s1, 0, 1 / 120);
  runFS(PC, null, cu => {
    const texs = [['tP', RT.t], ['tB1', q1.t], ['tB2', e1.t], ['tB3', s1.t], ['tDust', tDust], ['tFrost', tFrost], ['tVor', tVor], ['tMark', tMark], ['tLock', tLock], ['tEtch', tEtch]];
    texs.forEach(([n, tx], i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tx); gl.uniform1i(cu[n], i); });
    S(cu, 'uRes', W, H); S(cu, 'uT', t); S(cu, 'uB', b);
    S(cu, 'uBgA', ...U.bgA); S(cu, 'uBgB', ...U.bgB); S(cu, 'uFloor', ...U.floor); S(cu, 'uDustC', ...U.dustC); S(cu, 'uDust', U.dust); S(cu, 'uPar', ...U.par);
    S(cu, 'uBloom', U.bloom); S(cu, 'uExpo', U.expo); S(cu, 'uSat', U.sat);
    S(cu, 'uFrostT', U.frostT); S(cu, 'uFrostA', U.frostA);
    S(cu, 'uMonCam', ...U.monCam.slice(0, 4)); S(cu, 'uKey', U.monCam[4]); S(cu, 'uGrow', ...U.grow); S(cu, 'uIce', U.ice); S(cu, 'uMonSoft', U.monSoft); S(cu, 'uWall', U.wall);
    S(cu, 'uCrack', ...U.crack); S(cu, 'uCY', ...U.cY); S(cu, 'uCX', U.cX); S(cu, 'uCrackHot', U.crackHot); S(cu, 'uBand', U.band); S(cu, 'uDark', U.dark);
    S(cu, 'uRoom', U.room); S(cu, 'uHorY', U.horY);
    S(cu, 'uBurst', U.burst); S(cu, 'uWater', U.water); S(cu, 'uLightA', U.lightA);
    S(cu, 'uMarkR', GEAR.cx - 143 * gS, GEAR.cy - 145.5 * gS, 286 * gS, 291 * gS); S(cu, 'uMarkA', U.markA);
    S(cu, 'uLockR', lX, lY, lW, LOCK.h); S(cu, 'uLockA', U.lockA);
    S(cu, 'uFlash', ...U.flash); S(cu, 'uEmber', U.ember); S(cu, 'uBurstL', U.burstL);
  });
  return U;
}

// ================================================================ 2D layers: numbers, shards, words
function numbers(t) {
  const b = t / SPB; if (b < 24 || b >= 28.6) return;
  let k = 0; for (const h of TAIKO24) if (t >= h - 1e-4) k++;          // steps taken
  const done = b >= 28 - 1e-4, nSteps = TAIKO24.length;
  const ageStep = k ? t - TAIKO24[k - 1] : t - bt(24);
  const fade = done ? 1 - smooth(28.15, 28.6, b) : 1;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const [i, n] of NUMS.entries()) {
    const v = done ? 0 : n.v0 * Math.pow(1 - k / (nSteps + 1), 2.6) * (1 + 0.04 * Math.sin(i * 7 + k));
    const txt = v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const kick = Math.exp(-ageStep * 14), jit = (rng(k * 31 + i)() - 0.5) * 30 * kick;
    const a = (0.2 + 0.35 * kick) * fade * (done ? 1.6 : 1);
    ctx.save(); ctx.translate(n.x + jit, n.y); ctx.rotate(n.rot);
    ctx.filter = 'blur(6px)';
    line(ctx, txt, 0, 0, { family: 'Anton', size: n.size, align: n.right ? 'right' : 'left', color: done ? '#ff3040' : '#b8c0cc', alpha: a * 0.8, maxW: 1400 });
    ctx.filter = 'none';
    line(ctx, txt, 0, 0, { family: 'Anton', size: n.size, align: n.right ? 'right' : 'left', color: done ? '#ff6070' : '#d8dee8', alpha: a * 0.55, maxW: 1400 });
    ctx.restore();
  }
  ctx.restore();
}
const at = b => { let q = null; for (const w of WORDS) if (b >= w[0] - 1e-6) q = w; return q; };
function words(t) {
  const b = t / SPB, w = at(b); if (!w || !w[1]) return;
  const age = (b - w[0]) * SPB, txt = w[1], emph = !!w[2];
  const chant = (txt === 'MELT.' || txt === 'DOWN.') && b >= 44 && b < 56, alt = Math.round(w[0]) % 2;
  const y = b >= 56 && b < 72 ? 520 : chant ? (alt ? 1180 : 1500) : 1480;
  const k = 1 + (chant ? 0.14 : 0.2) * Math.exp(-12 * age), a = 1, mW = chant && alt ? W - 150 : W - 110;
  const size = chant ? (alt ? 300 : 196) : 232;
  ctx.save(); ctx.translate(W / 2, y - 80); ctx.scale(k, k); ctx.translate(-W / 2, -(y - 80));
  // material follows the stage
  let fill, glow = null, rimC = null;
  if (b < 8) fill = emph ? C.red2 : C.cream;
  else if (b < 24) {
    if (emph) fill = C.red2;
    else {
      const g = ctx.createLinearGradient(0, y - 190, W, y + 10), p = ((t * 0.9) % 1.4) - 0.2;
      g.addColorStop(0, '#9a6414'); g.addColorStop(clamp(p - 0.12), '#e8b24a'); g.addColorStop(clamp(p), '#fff6d8'); g.addColorStop(clamp(p + 0.12), '#e8b24a'); g.addColorStop(1, '#b27a1c');
      fill = g;
    }
  } else if (b < 28) fill = emph ? '#ffffff' : '#e2ebf5';
  else if (b < 40) { fill = emph ? C.red2 : '#f4fbff'; rimC = 'rgba(190,235,255,0.75)'; }
  else { fill = emph ? '#fffaf0' : '#fff3e0'; glow = b < 56 ? '#8fd0ff' : '#ff7a20'; if (b < 56) fill = emph ? '#ffffff' : '#eef6ff'; if (b >= 64) fill = emph ? '#ffffff' : C.cream; }
  const sh = env('shout', t, 11) + env('impact', t, 9) * 0.6;
  if (sh > 0.04) {                                            // RGB ghosts on the shouts, split under 12px
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    line(ctx, txt, W / 2 - 11 * Math.min(1, sh), y, { size, color: '#ff1030', alpha: 0.55 * Math.min(1, sh) * a, maxW: mW });
    line(ctx, txt, W / 2 + 11 * Math.min(1, sh), y, { size, color: '#00c8ff', alpha: 0.45 * Math.min(1, sh) * a, maxW: mW });
    ctx.restore();
  }
  if (rimC) line(ctx, txt, W / 2, y, { size, color: rimC, stroke: 34, strokeColor: rimC, alpha: a * 0.55, maxW: mW });
  if (glow) { ctx.shadowColor = glow; }
  line(ctx, txt, W / 2, y, { size, color: fill, stroke: 16, strokeColor: '#0a0306', alpha: a, maxW: mW, shadow: glow ? 0 : 0 });
  if (glow) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.shadowColor = glow; ctx.shadowBlur = 40;
    line(ctx, txt, W / 2, y, { size, color: b < 56 ? 'rgba(150,205,255,0.35)' : 'rgba(255,140,60,0.35)', alpha: a, maxW: mW }); ctx.restore();
  }
  ctx.restore();
}

const finish = new Finish(1917);
const cc = document.createElement('canvas'); cc.width = W; cc.height = H; const cg = cc.getContext('2d');
window.renderFrame = async (t) => {
  const b = t / SPB, frame = Math.round(t * FPS);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  if (b >= 72) {                                          // closer on the live red ground, held through the tail (b72-82)
    renderGL(t); ctx.drawImage(glc, 0, 0); ctx.fillStyle = 'rgba(8,0,1,0.6)'; ctx.fillRect(0, 0, W, H);
    closer(cg, (b - 72) * SPB); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(cc, 0, 0); ctx.restore();
    finish.apply(ctx, frame, { grain: 0.05, vignette: 0.4 }); return; }
  const U = renderGL(t);
  ctx.drawImage(glc, 0, 0);
  numbers(t);
  words(t);
  finish.apply(ctx, frame, { grain: 0.06, vignette: 0.3 });
};
for (const w of [1, 12, 30, 45, 60]) await window.renderFrame(w);   // shader warm-up before the first real frame
window.sceneReady = true;
