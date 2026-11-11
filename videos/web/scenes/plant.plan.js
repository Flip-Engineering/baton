// THE PLANT THAT WOULD NOT DIE: the plan (no DOM; web/labs/lantern/plant_check.mjs checks it in node). research/october/PLANT_brief.md.
// The timeline (60 BPM: beats are seconds), the words (verbatim, each with its source in the brief), the line and its cards, the
// exterior, and every shot's camera and torch as pure functions of t, so a --seg render begun anywhere is exact.
import * as THREE from 'three';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, u) => a + (b - a) * u;
export const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const ease = u => { u = clamp(u); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const h01 = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
// piecewise keys [[t, v], ...] eased between keys
function keyed(keys, t, f = ease) {
  if (t <= keys[0][0]) return keys[0][1]; const n = keys.length; if (t >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 0; while (i < n - 2 && t >= keys[i + 1][0]) i++;
  const [t0, a] = keys[i], [t1, b] = keys[i + 1]; return t1 > t0 ? lerp(a, b, f((t - t0) / (t1 - t0))) : b;
}
export const linear = (keys, t) => keyed(keys, t, u => u);

// ------------------------------------------------------------------ the timeline
export const TL = { beam: 0, slide: 2.6, sheets: 4.0, stamp: 4.4, windows: 6.6, jobs: 8.4, net: 10.0, inside: 12.4, off: 13.4, swing: 17.1,
  breaker: 21.1, run: 22.55, dark: 23.6, spells: 26.0, msub: 26.6, watch: 28.8, eyes: 29.0, lamp: 30.4, dsub: 31.0, crew: 32.4, ext: 35.0,
  open: 36.0, mark: 38.6, end: 42.0 };
export const BAYS_T = [6.8, 7.4, 8.0, 8.6, 9.2];
export const LANDINGS = [17.3, 18.2, 19.1, 20.0];
export const POWERS_T = { shafts: 24.2, gears: 25.4, flywheel: 26.8 };

// ------------------------------------------------------------------ the words (house bands, bands.js: [from, to, lines, first baseline, size, style])
// Every line is set at a size it keeps (Big Shoulders Display 900 measured: no line is shrunk under size 98 by the band's 902 px fit),
// so the brief's lines are broken shorter; the words and their order are the sources' own. The only colour is WE OPEN IT.
export const Y0 = 410;                                         // the first band's top at about y 300: the top of the safe area
export const CUES = [
  [TL.beam, TL.sheets, ['MIDNIGHT.', 'THE PLANT IS CLOSED.'], Y0, 112, 'main'],
  // GM's word, in its quotation marks and without a full stop, over the sheeted row (the house band, complete on its hit)
  [TL.stamp, TL.windows, ['\u201CUNALLOCATED\u201D'], 980, 144, 'main'],
  [TL.windows, TL.net, ['FIVE PLANTS IN', 'THE U.S. AND CANADA.'], Y0, 108, 'main'],
  [TL.jobs, TL.net, ['6,705 JOBS.'], 760, 150, 'main'],
  [TL.net, TL.inside, ['THAT YEAR GM NETTED', '$8.0 BILLION.'], Y0, 108, 'main'],
  [TL.off, TL.swing, ['MODERN BOURGEOIS', 'SOCIETY, WITH ITS', 'RELATIONS OF', 'PRODUCTION,', 'OF EXCHANGE AND', 'OF PROPERTY,'], Y0, 104, 'main'],
  [TL.swing, TL.breaker, ['A SOCIETY THAT HAS', 'CONJURED UP', 'SUCH GIGANTIC', 'MEANS OF PRODUCTION', 'AND OF EXCHANGE,'], Y0, 104, 'main'],
  [TL.breaker, TL.dark, ['IS LIKE', 'THE SORCERER', 'WHO IS NO LONGER', 'ABLE'], Y0 + 10, 124, 'main'],
  [TL.dark, TL.spells, ['TO CONTROL', 'THE POWERS', 'OF THE NETHER', 'WORLD'], Y0 + 10, 124, 'main'],
  [TL.spells, TL.watch, ['WHOM HE HAS', 'CALLED UP', 'BY HIS SPELLS.'], Y0 + 10, 124, 'main'],
  // Debs: the card builds and holds to 35.0
  [TL.watch, TL.ext, ['WHEN YOU HAVE', 'ORGANIZED INDUSTRIALLY'], Y0, 98, 'main'],
  [TL.lamp, TL.ext, ['YOU WILL SOON LEARN', 'THAT YOU CAN MANAGE'], Y0 + 2 * 98 * 1.22, 98, 'main'],
  [TL.crew, TL.ext, ['AS WELL AS OPERATE', 'INDUSTRY.'], Y0 + 4 * 98 * 1.22, 98, 'main'],
  [TL.open, TL.mark, ['WE OPEN IT.'], 780, 160, 'red'],
];
// subs: [from, to, line, baseline, size] (ink on stock, under their card, inside the safe band)
export const SUBS = [
  [TL.stamp, TL.windows, 'GM · 26 NOV 2018', 1066, 40],
  [TL.jobs, TL.net, "BY GM'S OWN COUNT · MEDIA FACT SHEET · 26 NOV 2018", 852, 38],
  [TL.net, TL.inside, 'NET INCOME, 2018 · GM FORM 10-K', 632, 40],
  [TL.msub, TL.watch, 'MARX AND ENGELS', 806, 40],
  [TL.msub, TL.watch, 'MANIFESTO OF THE COMMUNIST PARTY · 1848', 858, 40],
  [TL.dsub, TL.crew, 'EUGENE V. DEBS · CANTON, OHIO · 16 JUNE 1918', 850, 38],
  [TL.crew, TL.ext, 'EUGENE V. DEBS · CANTON, OHIO · 16 JUNE 1918', 1088, 38],
];
// the cue table for planLoad (type_world.js): [{ s, e, text }] in beats
export const loadCues = () => CUES.map(([s, e, l]) => ({ s, e, text: l.join(' ') }));

// ------------------------------------------------------------------ the hall and its line (metres; y up; the line runs along x, the presses face +z)
export const LINE = { x0: 0.35, dx: 2.0, i0: -16, i1: 10, pressZ: -1.0, cardZ: 0.5, cardW: 1.6, cardH: 1.6 * 16 / 9, cardY0: -0.62,
  colZ: 1.1, colW: 0.15, colX0: 0.12, colDx: 4.0, colK0: -12, colK1: 5, roofY: 7.4, west: -50, east: 24, north: -10, south: 16 };
export const stationX = i => LINE.x0 + LINE.dx * i;
export const columnX = k => LINE.colX0 + LINE.colDx * k;
// the plates at the stations: frame 0's man at the former; the second and third stations the line of men at the frames; then round
const PLATE_OF = ['formerrun', 'linefull', 'chassis'];
export const STATIONS = [];
for (let i = LINE.i0; i <= LINE.i1; i++) {
  const plate = i === 0 ? 'formerrun' : i === 1 || i === 2 || i === -2 ? 'linefull' : PLATE_OF[((i % 3) + 3) % 3];
  STATIONS.push({ i, x: stationX(i), plate, off: i === 0 ? 0.75 : h01(i * 3.7) * 4, rate: 1 });
}
// the moon comes through broken panes of the north-light glazing: it travels south (+z) and down; where its patches land
export const MOON_DIR = V3(0.22, -0.6, 0.77).normalize();
export const MOON_PATCHES = [[-3.2, 3.4], [-9.4, 4.6], [-15.6, 2.6], [-21.2, 5.2], [-27.5, 3.6], [-34, 4.4], [5.4, 4.2], [11.8, 3.2], [-12.2, -0.4], [-19.8, -0.6], [-31.6, -0.5]];
export const holeOf = ([x, z], y = 0) => { const s = (LINE.roofY - y) / -MOON_DIR.y; return [x - MOON_DIR.x * s, z - MOON_DIR.z * s]; };
export const PUDDLES = [[-3.0, 3.6, 1.3, 0.7], [-9.0, 4.9, 0.9, 0.5], [-21.0, 5.0, 1.6, 0.8], [5.8, 4.5, 1.1, 0.6], [-15.4, 2.9, 0.7, 0.45]];
export const EXIT_SIGN = V3(-12.0, 3.3, 2.6);
export const DISCONNECT = { k: -6, side: 1 };                  // the main disconnect on the line column at x columnX(-6), the aisle side
// the powers: depth cards at empty stations, each machine by its own light
export const POWER_CARDS = [
  { name: 'shafts', plate: 'shafts', t: POWERS_T.shafts, pos: [-18.2, 3.9, -1.2], w: 4.6, face: 'cam' },
  { name: 'gears', plate: 'gears', t: POWERS_T.gears, pos: [-15.7, 1.35, 0.2], w: 2.5, face: 'z' },
  { name: 'flywheel', plate: 'flywheel', t: POWERS_T.flywheel, pos: [-23.7, 1.62, 0.0], w: 3.2, face: 'z' },
];
// the four landings of banishing 2: a big card each, the plate the light finds there; cam, look, the torch's hand
export const LAND = [
  { t: LANDINGS[0], plate: 'vast', cam: [-6.0, 2.0, 3.4], look: [-49, 2.6, 0.4], card: [-46.0, 5.0, 0.6], w: 10.5, hand: [-5.55, 1.35, 3.1] },
  { t: LANDINGS[1], plate: 'floorhigh', cam: [-12.0, 6.3, 6.0], look: [-17.0, 0.6, -3.5], card: [-17.2, 0.4, -4.0], w: 9.5, hand: [-11.6, 5.95, 5.65] },
  { t: LANDINGS[2], plate: 'presses', cam: [-18.2, 1.7, 4.2], look: [-27.0, 2.4, -5.5], card: [-26.0, 2.6, -4.4], w: 7.0, hand: [-17.8, 1.35, 3.9] },
  { t: LANDINGS[3], plate: 'chassis', cam: [-22.0, 1.85, 3.3], look: [21.5, 1.8, 0.2], card: [21.0, 2.8, 0.4], w: 9.5, hand: [-21.55, 1.4, 3.0] },
];

// ------------------------------------------------------------------ the exterior: a long low auto plant, five bays of steel-sash windows
export const EXT = { bays: 5, bayW: 8.5, x0: -21.25, eave: 7.6, rise: 3.4, depth: 30, winY0: 2.3, winY1: 6.1, winM: 0.45, cols: 10, rows: 5,
  cardZ: -3.0, cardW: 9.0, cardV: 0.45, plates: ['floorhigh', 'chassis', 'vast', 'linefull', 'presses'], pole: [9.5, 0, 46], poleH: 9.2 };
export const bayX = b => EXT.x0 + EXT.bayW * (b + 0.5);
export const bayLit = (b, t) => (t >= TL.ext ? 1 : sstep(BAYS_T[b], BAYS_T[b] + 0.18, t));
// the coin of torchlight inside, on the cards' plane: x along the facade, y (m)
export function coinAt(t) {
  const K = [[TL.windows, bayX(0) - 3.2], [BAYS_T[0], bayX(0)], [BAYS_T[1], bayX(1)], [BAYS_T[2], bayX(2)], [BAYS_T[3], bayX(3)], [BAYS_T[4], bayX(4)], [9.75, bayX(3) + 1.5], [10.3, bayX(2) + 1.2]];
  let x = linear(K, t); if (t > 10.3) x = bayX(2) + 1.2 * Math.cos((t - 10.3) * 1.15) + 0.6 * Math.sin((t - 10.3) * 2.3);
  const y = 3.7 + 0.35 * Math.sin(t * 2.1) + 0.2 * Math.sin(t * 5.3 + 1);
  return { x, y, on: t < TL.inside ? 1 : 0 };
}

// ------------------------------------------------------------------ the shots: camera (p, l, fov) and set
export const SHOTS = [
  ['beam', TL.beam, 'hall'], ['sheets', TL.sheets, 'hall'], ['windows', TL.windows, 'ext'], ['push', TL.net, 'ext'], ['inside', TL.inside, 'hall'],
  ['swing', TL.swing, 'hall'], ['breaker', TL.breaker, 'hall'], ['powers', TL.dark, 'hall'], ['watch', TL.watch, 'hall'], ['lamp', TL.lamp, 'hall'],
  ['crew', TL.crew, 'hall'], ['ext2', TL.ext, 'ext'], ['mark', TL.mark, 'ext']];
export function shotAt(t) { let s = SHOTS[0]; for (const x of SHOTS) if (t >= x[1] - 1e-9) s = x; return { name: s[0], t0: s[1], set: s[2] }; }

// frame 0's torch: the guard's hand low and right of the lens, steady; the disc on station 0, then along the line to 1 and 2
const BEAM_TX = [[TL.beam, 0.38], [TL.slide, 0.38], [3.3, 2.38], [3.45, 2.38], [4.0, 4.38]];
export const beamTarget = t => V3(keyed(BEAM_TX, t), 1.36, LINE.cardZ);
const SHEETS_TX = [[TL.sheets, 3.4], [4.35, 0.4], [4.75, -4.6], [5.2, -1.6], [5.6, -8.6], [6.05, -4.6], [6.6, -12.6]];
// the hand's drift for each shot (Lantern.drift: seed, amp rad)
export const DRIFT = { beam: { seed: 7, amp: 0.0045 }, sheets: { seed: 11, amp: 0.012 }, inside: { seed: 13, amp: 0.006 }, swing: { seed: 17, amp: 0.03 }, breaker: { seed: 19, amp: 0.02 } };

export function camAt(t) {
  const S = shotAt(t), u = t - S.t0;
  switch (S.name) {
    case 'beam': { const tx = keyed(BEAM_TX, t - 0.14), m = ease((t - TL.slide) / 1.4);
      return { ...S, p: V3(-1.15 + 1.3 * m, 1.72, 6.55), l: V3(0.3 + (tx - 0.38) * 0.92, 1.42, LINE.cardZ), fov: 37.6 }; }
    case 'sheets': { const k = ease(u / 2.6);
      return { ...S, p: V3(9.45 - 0.35 * k, 2.02 - 0.05 * k, 4.75 + 0.25 * k), l: V3(-8.0, 0.95, -1.15), fov: 40 }; }
    case 'windows': return { ...S, p: V3(0, 1.55, 142), l: V3(0, 4.6, 0), fov: 36 };
    case 'push': { const k = ease(u / 2.4); return { ...S, p: V3(lerp(0, 0.6, k), lerp(1.55, 2.0, k), lerp(142, 58, k)), l: V3(lerp(0, bayX(2) * 0.15, k), lerp(4.6, 4.3, k), 0), fov: 36 }; }
    case 'inside': { const k = ease(u / 4.7); return { ...S, p: V3(-3.4 - 0.05 * k, 2.99 - 0.03 * k, 14.4 - 0.3 * k), l: V3(-3.65, 1.05, LINE.cardZ), fov: 12.6 }; }
    case 'swing': return { ...S, ...swingCam(t), fov: 40 };
    case 'breaker': return { ...S, p: V3(-46.5, 2.7, 5.2), l: V3(-14.0, 1.4, 1.2), fov: 34 };
    case 'powers': { const k = ease(u / 5.2); return { ...S, p: V3(lerp(-5.5, -13.5, k), lerp(2.1, 1.95, k), lerp(4.4, 3.9, k)), l: V3(lerp(-16, -24, k), lerp(1.6, 1.75, k), lerp(0.0, -0.4, k)), fov: 38 }; }
    case 'watch': { const k = ease(u / 1.6); return { ...S, p: V3(-7.95 + 0.04 * k, 1.66, 3.55 - 0.06 * k), l: V3(-8.0, 1.6, 2.6), fov: 30 }; }
    case 'lamp': return { ...S, p: V3(-5.7, 1.5, 2.85), l: V3(-6.22, 0.97, 1.2), fov: 36 };
    case 'crew': { const k = ease(u / 2.6); return { ...S, p: V3(6.0 - 0.5 * k, 1.7, 5.4 - 0.2 * k), l: V3(-12.0, 1.1, 0.6), fov: 40 }; }
    default: return { ...S, p: V3(0, 1.55, 142), l: V3(0, 4.6, 0), fov: 36 };          // ext2 and the mark: the lock-off of 6.6
  }
}
// banishing 2: four landings, each preceded by a whip (0.2 s); the camera holds (handheld) between
function swingCam(t) {
  let k = 0; while (k < LAND.length - 1 && t >= LAND[k + 1].t - 0.2) k++;
  const L = LAND[k], P = k > 0 ? LAND[k - 1] : null, w = P ? ease((t - (L.t - 0.2)) / 0.2) : 1;
  const p = P ? V3(...P.cam).lerp(V3(...L.cam), w) : V3(...L.cam);
  const dP = P ? V3(...P.look).sub(V3(...P.cam)).normalize() : null, dL = V3(...L.look).sub(V3(...L.cam)).normalize();
  const d = P ? dP.clone().lerp(dL, w).normalize() : dL;
  return { p, l: p.clone().add(d), land: k, whip: P ? 1 - Math.abs(2 * w - 1) : 0 };
}

// the torch: { on, pos, target, ref, hold ('guard': the hero grips it; the scene aims it at target) }
export function torchAt(t) {
  const S = shotAt(t), u = t - S.t0;
  switch (S.name) {
    case 'beam': return { on: 1, pos: V3(0.92 + 1.6 * clamp((t - TL.slide) / 1.4), 1.02, 4.45), target: beamTarget(t), ref: 4.2, drift: DRIFT.beam };
    case 'sheets': return { on: 1, target: V3(keyed(SHEETS_TX, t), 1.2, LINE.cardZ), ref: 7.5, hold: 'guard', drift: DRIFT.sheets };
    case 'inside': return { on: 1 - sstep(TL.off - 0.02, TL.off + 0.06, t), target: V3(-3.65, 1.22, LINE.cardZ), ref: 7.6, hold: 'guard', drift: DRIFT.inside };
    case 'swing': { const c = swingCam(t), L = LAND[c.land], cam = c.p, hand = V3(...L.hand).add(cam.clone().sub(V3(...L.cam))), ph = (t - L.t) * 2.2;
      const card = V3(...L.card), R = L.w * 0.22, tgt = c.whip > 0.02 ? cam.clone().add(c.l.clone().sub(cam).multiplyScalar(30)) : card.clone().add(V3(R * Math.cos(ph), R * 0.8 * Math.sin(ph * 1.3), 0));
      return { on: sstep(TL.swing, TL.swing + 0.06, t), pos: hand, target: tgt, ref: card.distanceTo(cam) * 0.62, drift: DRIFT.swing, land: c.land, whip: c.whip }; }
    case 'breaker': return { on: 1 - sstep(TL.dark - 0.02, TL.dark + 0.02, t), ref: 6, hold: 'runner', drift: DRIFT.breaker };
    case 'lamp': return { on: sstep(TL.lamp + 0.05, TL.lamp + 0.12, t), pos: V3(-6.55, 0.935, 1.38), target: V3(-6.0, 1.0, 1.12), ref: 0.75, bench: true };
    case 'crew': return { on: 1, pos: V3(-6.55, 0.935, 1.38), target: V3(-6.0, 1.0, 1.12), ref: 0.75, bench: true };
    default: return { on: 0 };
  }
}
// the cover the staging gives (for plant_check.mjs): the share of the visible cards' area lit at or over the knee
export const KNEE = 0.15;

// ------------------------------------------------------------------ the guard and the crew
export const GUARD = { sheets: { pos: [7.68, 0, 3.85], face: [-0.96, -0.28] }, inside: { pos: [-3.3, 0, 8.4], face: [-0.04, -1] } };
// banishing 3: he runs from the aisle to the disconnect and hauls the handle down (Lever, its first downstroke only)
export const RUN = { from: [-19.6, 3.25], t0: TL.breaker, t1: TL.run, period: (TL.dark - TL.run) / 0.42 };
// where the double is (his base on the floor) and where his torch is, as pure functions (the live frame and the persist replay share them)
export const STAND_AT = () => [columnX(DISCONNECT.k), LINE.colZ + LINE.colW / 2 + 0.52];
export function runnerAt(t) {
  const [sx, sz] = STAND_AT(), [fx, fz] = RUN.from, u = clamp((t - RUN.t0) / (RUN.t1 - RUN.t0)), e = u * u * (3 - 2 * u) * 0.35 + u * 0.65;
  return { x: fx + (sx - fx) * e, z: fz + (sz - fz) * e, heading: t < RUN.t1 ? Math.atan2(sx - fx, sz - fz) : Math.PI, running: t < RUN.t1 };
}
export function runnerTorch(t) {
  const r = runnerAt(t), f = V3(Math.sin(r.heading), 0, Math.cos(r.heading)), rt = V3(-f.z, 0, f.x), bob = Math.sin((t - RUN.t0) * 13.5);
  if (r.running) return { pos: V3(r.x, 1.12 + 0.04 * bob, r.z).addScaledVector(f, 0.32).addScaledVector(rt, 0.22), dir: f.clone().add(V3(0.25 * bob, -0.42 + 0.08 * bob, 0)).normalize() };
  return { pos: V3(r.x, 1.38, r.z).addScaledVector(f, 0.3).addScaledVector(rt, 0.2), dir: f.clone().add(V3(0.1, -0.55, 0)).normalize() };
}
export const CREW = [];
// two at a station, facing the aisle (the way the 1936 men face the lens in the plates), each at a jig in front of him: one working it with
// blows, one stooped over it; the jigs clear the columns (0.23 m left of every second station) and the presses' control pedestals
for (let i = -9; i <= 2; i++) for (const s of [-1, 1]) {
  const n = CREW.length; if (i === -3 && s === 1) continue;   // the lamp's bench stands here
  CREW.push({ n, i, x: stationX(i) + (s < 0 ? 0.25 : 1.05) + (h01(n * 2.3) - 0.5) * 0.06, z: 0.55, heading: (h01(n * 7.7) - 0.5) * 0.3,
    trade: n % 3 === 1 ? 'rail' : 'overalls', act: s < 0 ? 'work' : 'stoop', ph: h01(n * 1.9) });
}
// the guard's torch hand (the wrist target his arm is solved to; the torch's lens sits just past it): in front of his right shoulder
export function guardHand(name) {
  const G = GUARD[name], f = V3(G.face[0], 0, G.face[1]).normalize(), r = V3(-f.z, 0, f.x);
  return V3(...G.pos).addScaledVector(f, 0.42).addScaledVector(r, 0.2).add(V3(0, 1.3, 0));
}
