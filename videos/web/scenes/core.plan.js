// THE CORE (TRUE SCALE ep. 1): the plan. Bars of 7/16 at q = 100 (a bar 1.05 s, a sixteenth 0.15 s), the shots, the lay-ins (this
// episode's join), the cards' bands, the stations of the hall, and each shot's plan camera. Pure data and pure functions of t.
import { mulberry } from '../lib/fx/truescale/corestack.js';

export const BAR = 1.05, S16 = 0.15;
export const T = (b, s = 0) => +(b * BAR + s * S16).toFixed(6);
export const TLB = { hook: 0, eight: 4, gantry: 8, push: 11, out: 14, anarchy2: 21, demand: 24, short: 27, late: 30, reform: 34, turn: 35, plan: 36,
  closed: 41, pull: 42, chair2: 47, chair3: 51, unlay: 52, mark: 54, end: 55.33 };
export const TL = Object.fromEntries(Object.entries(TLB).map(([k, b]) => [k, T(b)]));
TL.end = 58.10;
export const MARK_BEAT = 94.5;                     // logo_at.json "core" (beats at BPM 100): bar 54

// ---------------------------------------------------------------- the hall: one building, its stations (world metres; y up, plan x right,
// z down-screen). The main flat core (A), the gantry table (B), the active part (C), the winding machine (D), a finished tank (E)
export const ST = { A: [-10, -16], B: [10, -16], C: [0, 0], D: [-11, 10.5], E: [12.5, 11.5] };   // c20: D and E drawn in, clear of the foot's cards
export const DECK = 0.40;                           // the stacking tables' deck (c20: a low table, as real ones are: the crew lays at waist height)
export const HALF = 3150;                           // sheets laid at frame 0 (c20): past the widest packet, so four terraces of the stepped
                                                    // section stand round the top packet, each with its own seven-step stair at the mitres
export const STEP_FROM = 560;                       // the time-lapse in the STEP shot lays 2,590 sheets: the stack widens packet by packet
                                                    // to the widest, then the terraces step in (the circle section forming)
export const TAKE = (globalThis.CORE_TAKE || 'a');  // c20 takes: 'a' the brief (the heap: one, two, three pads a bar); 'b' fewer, larger,
                                                    // slower pads (the waste seen in detail)

// ---------------------------------------------------------------- the shots and the order they are laid in
// Every shot arrives by a lay-in (corestack layInQuad). k counts the lay-ins: k mod 7 is the step the sheet rests at (0 = flush).
// The anarchy's pads are crooked (off-step and out of square, seeded); the turn (bar 35) is square, one step off; the mark is flush.
export function layers() {
  const L = [];
  const add = (o) => { L.push({ kind: 'shot', dur: 0.45, crooked: 0, seed: 1880, ...o }); };
  add({ id: 'hook', shot: 'hook', t0: -1, dur: 0.01, edge: 'L', k: 0 });
  add({ id: 'eight', shot: 'eight', t0: T(4), edge: 'L', k: 1 });
  add({ id: 'gantry', shot: 'gantry', t0: T(8), edge: 'B', k: 2 });
  add({ id: 'step', shot: 'step', t0: T(11), edge: 'R', k: 3 });
  // the anarchy. Take a: pads, one a bar (14-17), two a bar (18-23), three a bar (24-29, with holes from 27), then the late sites one a
  // bar. Take b: one a bar (14-23), two a bar (24-29, holes from 26), each seen closer. c20: every pad its own world (the ground, the
  // stone, what lies waiting), framed wide enough that its surroundings are in the frame (v1's 18 m frame showed only gravel)
  const R = mulberry(1880 * 3 + 1), kinds = ['substation', 'collector', 'datahall', 'switchyard', 'datahall', 'town'];
  let k = 4, n = 0;
  const B = TAKE === 'b';
  const pad = (b, s, rate, crook) => {
    let kind = b < 18 ? ['substation', 'collector', 'datahall', 'town'][b - 14] : kinds[Math.floor(R() * kinds.length)];
    if (b >= 21 && b <= 23 && n % 5 === 2) kind = 'town';
    if (b >= (B ? 26 : 27) && R() < 0.42) kind = 'stone';                       // holes: an empty basin of crushed stone
    const edge = 'LBRT'[k % 4], w = B ? 22 + 6 * R() : rate === 1 ? 30 + 6 * R() : 34 + 12 * R();
    add({ id: `pad${n}`, shot: 'pad', tile: { kind, seed: 100 + n, w, cx: (R() - 0.5) * 4, cz: (R() - 0.5) * 6 }, t0: T(b, s), dur: rate === 3 ? 0.28 : rate === 2 ? 0.34 : 0.4, edge, k, crooked: crook * (B ? 0.6 : 1.6), seed: 1880 + n });
    k++; n++;
  };
  if (B) { for (let b = 14; b < 24; b++) pad(b, 0, 1, 0.35); for (let b = 24; b < 30; b++) for (const s of [0, 4]) pad(b, s, 2, 1); }
  else {
    for (let b = 14; b < 18; b++) pad(b, 0, 1, 0.35);
    for (let b = 18; b < 24; b++) for (const s of [0, 4]) pad(b, s, 2, 1);
    for (let b = 24; b < 30; b++) for (const s of [0, 2, 4]) pad(b, s, 3, 1);
  }
  const sites = ['extension', 'pour', 'extension', 'pour'];
  for (let b = 30; b < 34; b++) { add({ id: `site${b}`, shot: 'site', tile: { kind: sites[b - 30], seed: 300 + b, frame: b - 30 }, t0: T(b), dur: 0.42, edge: 'LBRT'[k % 4], k, crooked: 0.7, seed: 1880 + b }); k++; }
  // the turn: square, exactly one step off (a new cycle); the active part, then the hall as the frame opens (one live shot)
  add({ id: 'lace', shot: 'lace', t0: T(35), edge: 'LBRT'[k % 4], k: 1 });
  add({ id: 'mark', shot: 'mark', t0: T(54), edge: 'L', k: 0, dur: 0.45 });
  // freeze times: a buried sheet shows the frame it carried when the next sheet began to cover it
  for (let i = 0; i < L.length - 1; i++) L[i].freezeAt = L[i + 1].t0;
  return L;
}

// ---------------------------------------------------------------- the cards: pressboard strips in bands, laid from the left or the right,
// covered by the next card in the band, by a shot's lay-in, or by a cover strip carrying the picture (bar 12). y, h: screen px.
// lines come from assets/core/cards.json (generated from research/scripts_final/core.json); here: when, where, how big.
export const CARDS = [
  { n: 2, t0: T(4), edge: 'L', y: 140, h: 360, until: T(8) },
  { n: 3, t0: T(8), edge: 'R', y: 160, h: 300, until: T(12), cover: 'strip' },
  // c20: v1 kept every card in one top band, so the film read as a slideshow over grey; now they land where the picture leaves room,
  // like sheets on a heap in the anarchy, and at the foot of the frame from the turn on (the active part and the hall's stations stay seen)
  { n: 4, t0: T(14), edge: 'L', y: 250, h: 330, until: T(19) },
  { n: '5b', t0: T(16), edge: 'L', y: 700, h: 400, until: T(21) },   // v4: the capital rush, laid among the pads
  { n: 5, t0: T(19), edge: 'R', y: 1180, h: 450, until: T(24) },
  { n: 6, t0: T(24), edge: 'L', y: 610, h: 300, until: T(27) },
  { n: 7, t0: T(27), edge: 'R', y: 1390, h: 300, until: T(30) },
  { n: '8a', t0: T(30), edge: 'L', y: 230, h: 290, until: T(35) },
  { n: '8b', t0: T(32), edge: 'R', y: 540, h: 290, until: T(35) },
  { n: 9, t0: T(36), edge: 'L', y: 1440, h: 380, until: T(42) },
  { n: 10, t0: T(42), edge: 'R', y: 1440, h: 380, until: T(47) },
  { n: 11, t0: T(47), edge: 'L', y: 1440, h: 380, until: T(51) },
  { n: 12, t0: T(51), edge: 'R', y: 1480, h: 330, until: T(54) },
];

// ---------------------------------------------------------------- the cameras (planRig.set(width, x, z, ref) per shot, as a function of t)
const ease = u => { u = Math.min(1, Math.max(0, u)); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };
export function camOf(shot, t, o = {}) {
  const [ax, az] = ST.A, [bx, bz] = ST.B, [cx, cz] = ST.C;
  if (shot === 'hook') return { w: 3.6, x: ax, z: az - 0.8, ref: o.top ?? 1.35 };
  if (shot === 'eight') return { w: 7.2, x: ax, z: az - 0.5, ref: o.top ?? 1.35 };
  if (shot === 'gantry') return { w: 9.0, x: bx, z: bz + 0.9, ref: 1.0 };
  if (shot === 'step') {                                              // c20: the push onto the bottom-left outer corner, where the terraces'
    // corners stand one inside the other, each a stair of seven sheets: 7.2 m -> 0.7 m (1,540 px/m: a step of 5 mm is 8 px)
    const u = ease((t - T(11)) / (T(14) - T(11))), w = 7.2 * Math.pow(0.7 / 7.2, u);
    const x = ax + (-2.70) * u, z = az + (-0.5 + (2.13 + 0.5) * u);
    return { w, x, z, ref: o.top ?? 1.35 };
  }
  if (shot === 'lace') {                                              // 120 px/m on the active part; from bar 42 the pull-out to 36 m
    const u = ease((t - T(42)) / (T(51) - T(42))), w = 9 * Math.pow(36 / 9, u);
    return { w, x: cx, z: cz + 0.4 - 2.4 * u, ref: 4.94 - 2.4 * u };
  }
  if (shot === 'pad') return { w: o.tile?.w ?? 34, x: o.tile?.cx ?? 0, z: o.tile?.cz ?? 0, ref: 0 };
  if (shot === 'site') return { w: 24, x: 0, z: 0, ref: 0 };
  return { w: 3.6, x: 0, z: 0, ref: 0 };
}
export const IN_HALL = s => s === 'hook' || s === 'eight' || s === 'gantry' || s === 'step' || s === 'lace';
