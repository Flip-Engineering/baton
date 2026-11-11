// THE CHASM: the plan. Pure functions of the beat (100 BPM, songs2/the_chasm_e.py): where the crew's cage is, where the owner's glass
// car is, how high the tower stands, the shots, and the words. No three.js and no DOM here, so node can check it (the_chasm.check.mjs).
//
// The tower is the nation's output. It goes up one floor a bar, on the downbeat. The crew's hoist cage climbs at a working hoist's
// speed (0.9 m/s): wages may rise. The owner's glass car starts below them, passes them at b20 and climbs disproportionately faster,
// until it rides just under the top, which keeps rising; the open bay of the facade between the two is the chasm, and it widens
// from 0 to 137 m. At b72 the operator stops the hoist beside the painted number, and the tower stops with them: no floor goes up,
// the crane holds, the glass car stops (it can only go as high as the crew have built). At b78 they start it again, on their terms.
export const BPM = 100, SPB = 60 / BPM;
export const STOP = 72, BACK = 78, CLOSE = 94;
export const END = CLOSE * SPB + 1.4 + 0.25;                     // the published cut is the lock + 1.4 s; a few frames of margin
export const FLOOR = 3.6;
export const MARK_FLOOR = 18;                                     // the floor the cage stops at; the number is painted there
export const STOP_Y = MARK_FLOOR * FLOOR;                         // 64.8 m: the cage floor at the stop, level with the landing
const V0 = 0.9, V2 = 1.25;                                        // m/s: the hoist, and the hoist on the crew's terms
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const lerp = (a, b, u) => a + (b - a) * u;
export const tOf = beat => beat * SPB;

// the crew's cage floor (m) at beat b: steady from frame 0, a working stop at b72 (a 0.25 s ease), the start again at b78
const Y0 = STOP_Y - V0 * tOf(STOP);
export function cageY(b) {
  if (b <= STOP) return Y0 + V0 * tOf(b);
  if (b <= BACK) return STOP_Y;
  const s = tOf(b - BACK); return STOP_Y + V2 * Math.max(0, s - 0.35) + 0.5 * V2 * Math.min(s, 0.35) ** 2 / 0.35;
}
// the tower's top deck (m): floor 42 at b0, one floor a bar, each one jacked up over the bar's first beat; nothing between the stop and
// the start; then a floor a bar again from b78
export const TOP0 = 42;
export function topFloors(b) {
  const climb = bb => Math.floor(bb / 4) + sstep(0, 1, (bb % 4) / 1.0);
  if (b < STOP) return TOP0 + climb(b);
  if (b < BACK) return TOP0 + STOP / 4;
  return TOP0 + STOP / 4 + climb(b - BACK);
}
export const topY = b => topFloors(b) * FLOOR;
// the glass car (its floor, m): from under the crew, past them at b20, then away, until it rides 14 m under the top; it stops with the tower
const GAP = [[0, -16], [12, -11], [16, -5], [20, 0], [26, 9], [32, 28], [40, 62], [48, 105], [56, 160], [72, 260]];
function gapAt(b) { for (let i = 1; i < GAP.length; i++) if (b <= GAP[i][0]) { const [b0, g0] = GAP[i - 1], [b1, g1] = GAP[i]; return lerp(g0, g1, sstep(0, 1, (b - b0) / (b1 - b0)) * 0.5 + (b - b0) / (b1 - b0) * 0.5); } return GAP[GAP.length - 1][1]; }
const smin = (a, c, k = 6) => { const h = clamp(0.5 + 0.5 * (c - a) / k); return lerp(c, a, h) - k * h * (1 - h); };
export function carY(b) {
  const bb = Math.min(b, STOP);
  const y = smin(cageY(bb) + gapAt(bb), topY(bb) - 14);
  if (b <= STOP) return y;
  const ov = 0.35 * Math.exp(-tOf(b - STOP) * 3.5) * Math.sin(tOf(b - STOP) * 14);   // the stop takes it with a small bounce on its ropes
  return y + ov;
}
export const chasm = b => carY(b) - (cageY(b) + 2.6);             // the open bay between the cage's roof and the car's floor (m)

// ---------------------------------------------------------------- the shots
// Each shot: [b0, b1, id, cam(b) -> { pos [x,y,z], look [x,y,z], fov (vertical, deg) }]. The facade is the plane z = 0, facing +z; the
// cage is at x -9.6..-6.4 (front z 2.7), the stair core with the number at x -6.2..-3.2, the glass car on the core's far side at
// x -2.9..-0.5: the chasm is the run of open floors up that bay, between the cage's roof and the car's floor.
export const CAGE_X = -8.0, CAR_X = -1.7, CORE = [-6.2, -3.2];
export const SHOTS = [
  // the climb: close on the five, rising with them in the low sun (the camera on a drone off the cage's front-right)
  [0, 16, 'climb', b => { const y = cageY(b), u = b / 16; return { pos: [lerp(-4.5, -4.9, u), y + 1.45 - 0.15 * u, 6.7 + 0.4 * u], look: [CAGE_X + 0.2, y + 1.95, 1.9], fov: 52 }; }],
  // the car comes up from below and passes them; the lens backs off and lifts to keep both
  [16, 32, 'pass', b => { const u = sstep(16, 32, b), yc = cageY(b), yg = carY(b), mid = lerp(yc + 1.4, (yc + yg) / 2 + 1.6, u);
    return { pos: [lerp(-4.6, -4.2, u), mid + lerp(0.8, 2.0, u), lerp(18, 34, u)], look: [lerp(-5.0, -4.8, u), mid, 0], fov: 48 }; }],
  // the chasm opens: a long pull back holding both ends of it
  [32, 48, 'open', b => { const u = sstep(32, 48, b), yc = cageY(b), yg = carY(b), mid = (yc + yg + 2.6) / 2, span = yg + 4 - yc;
    const d = Math.max(36, span * 0.62 / Math.tan(24 * Math.PI / 180) * 1.05);
    return { pos: [lerp(-4.2, -2, u), mid + 0.024 * d, d], look: [lerp(-4.8, -3.5, u), mid, 0], fov: 48 }; }],
  // the whole tower: the crew a speck at the bottom of the bay, the car riding just under the lit top, the crane
  [48, 60, 'tower', b => { const u = sstep(48, 60, b), yc = cageY(b), top = topY(b) + 12, mid = (yc - 6 + top) / 2, span = top - yc + 10;
    const d = span * 0.5 / Math.tan(25 * Math.PI / 180) * 1.02;
    return { pos: [lerp(3, -14, u), mid - 0.08 * d, d], look: [-1.5, mid, 0], fov: 50 }; }],
  // the number: a still frame on the stair core at the mark's floor; the cage rises into it and stops beside the number
  [60, 74, 'mark', () => ({ pos: [-6.0, STOP_Y + 2.1, 15], look: [-6.0, STOP_Y + 1.7, 0], fov: 46 })],
  // the stop, seen whole: nothing moves
  [74, 78, 'still', () => { const yc = STOP_Y, top = topY(STOP) + 12, mid = (yc - 6 + top) / 2, span = top - yc + 10, d = span * 0.5 / Math.tan(25 * Math.PI / 180) * 1.02;
    return { pos: [-14, mid - 0.08 * d, d], look: [-1.5, mid, 0], fov: 50 }; }],
  // on their terms: close again, rising with them, faces up
  [78, 84, 'rise', b => { const y = cageY(b), u = sstep(78, 84, b); return { pos: [lerp(-4.4, -4.8, u), y + 1.15 - 0.35 * u, 6.2], look: [CAGE_X + 0.3, y + 1.9 + 0.5 * u, 1.9], fov: 52 }; }],
  // all of it: the tower from the street, going up again
  [84, CLOSE + 3, 'all', b => { const u = sstep(84, CLOSE, b), top = topY(b) + 14;
    return { pos: [lerp(10, 4, u), 1.7, lerp(92, 86, u)], look: [-1.0, lerp(top * 0.46, top * 0.5, u), 0], fov: lerp(62, 64, u) }; }],
];
export function shotAt(b) { for (const s of SHOTS) if (b >= s[0] && b < s[1]) return { b0: s[0], b1: s[1], id: s[2], cam: s[3](b) }; const s = SHOTS[SHOTS.length - 1]; return { b0: s[0], b1: s[1], id: s[2], cam: s[3](b) }; }

// ---------------------------------------------------------------- the crew
// Five in the cage, facing out (+z): yaw 0 faces +z and the person's left is +x. The operator (front right) has the control box at her
// left hand. Grip points are in the cage's own frame (x across, y up from the cage floor, z out from the facade).
export const CREW = [
  { id: 'A', name: 'L22_f27_black', hat: 'white', at: [-9.15, 2.2] },
  { id: 'B', name: 'L05_m59_black', hat: 'yellow', at: [-8.4, 2.22] },
  { id: 'C', name: 'L17_m28_hispanic', hat: 'blue', at: [-7.65, 2.2] },
  { id: 'D', name: 'L12_f39_white', hat: 'yellow', at: [-8.0, 1.5] },
  { id: 'E', name: 'L03_m38_asian', hat: 'white', at: [-7.0, 2.17], op: true },
];
export const RAIL = { z: 2.66, y: 1.06 };
export const BOX = { lever: [-6.62, 1.29, 2.22], stop: [-6.68, 1.34, 2.04] };
// each person's head through the piece (pitch: + down, - up; turn: + toward +x, radians)
export function gazeOf(id, b) {
  const k = { A: 0.0, B: 0.35, C: 0.7, D: 0.5, E: 0.2 }[id] || 0;
  let pitch = 0.05, turn = { A: 0.12, B: 0.04, C: -0.05, D: 0.0, E: -0.15 }[id] || 0;
  // the car going by (b16-30): they look down at it, follow it past and up, to the right
  const pass = sstep(17 + k, 21 + k, b), away = sstep(22 + k, 30 + k, b);
  pitch += lerp(0, 0.25, sstep(15 + k, 18 + k, b) * (1 - pass)) - 0.45 * pass - 0.25 * away;
  turn += 0.55 * pass * (1 - 0.3 * away);
  // after it: forward again, the work in front of them
  const back = sstep(34 + k, 38 + k, b); pitch = lerp(pitch, 0.08, back); turn = lerp(turn, { A: 0.08, B: 0, C: -0.08, D: 0.05, E: 0.1 }[id] || 0, back);
  // at the mark (b66 on): the operator looks to her box; the others to the number beside them
  if (b >= 64) { const m = sstep(64 + k, 67 + k, b); pitch = lerp(pitch, id === 'E' ? 0.35 : 0.12, m); turn = lerp(turn, id === 'E' ? 0.55 : 0.6, m); }
  // the stop: heads come up and level, looking out
  if (b >= STOP) { const s = sstep(STOP + 0.5 + k, STOP + 2.5 + k, b); pitch = lerp(pitch, -0.05, s); turn = lerp(turn, { A: 0.05, B: -0.05, C: 0.08, D: 0.0, E: 0.0 }[id] || 0, s); }
  // on their terms: chins up, toward the top
  if (b >= BACK) { const s = sstep(BACK + 0.3 + k * 0.5, BACK + 3 + k * 0.5, b); pitch = lerp(pitch, -0.42, s); turn = lerp(turn, 0.18, s); }
  return { pitch, turn };
}
// the operator's left hand: on the lever; the stop button at b72 (reach over b71-72, press, hold); back on the lever at b77.5
export function opHand(b) {
  const reach = sstep(STOP - 1.2, STOP - 0.1, b) * (1 - sstep(BACK - 1.2, BACK - 0.2, b));
  const press = b >= STOP - 0.1 && b < BACK - 1.2 ? 0.018 * sstep(STOP - 0.1, STOP + 0.05, b) : 0;
  const push = b >= BACK - 0.2 ? 0.06 * sstep(BACK - 0.2, BACK + 0.3, b) : 0;
  const [lx, ly, lz] = BOX.lever, [sx, sy, sz] = BOX.stop;
  return [lerp(lx, sx, reach) + press, lerp(ly, sy, reach) + 0.02 * Math.sin(Math.PI * reach), lerp(lz, sz, reach) + push];
}
export const leverAngle = b => b < STOP - 1 ? 0.35 : b < BACK - 0.2 ? lerp(0.35, 0, sstep(STOP - 1, STOP, b)) : 0.45 * sstep(BACK - 0.2, BACK + 0.3, b);
export const buttonIn = b => b >= STOP && b < BACK - 0.5 ? 1 : 0;
// breath and sway: the cage rides a rack; people shift their weight
export function swayOf(id, b) { const t = tOf(b), k = { A: 0.3, B: 1.1, C: 2.0, D: 2.7, E: 3.5 }[id] || 0, live = b >= STOP && b < BACK ? 0.25 : 1;
  return { lean: 0.03 + 0.015 * Math.sin(t * 1.3 + k) * live, sx: 0.012 * Math.sin(t * 0.7 + k * 1.7) * live }; }

// ---------------------------------------------------------------- the words (research/scripts_final/the_chasm.json; checked against it)
// [b0, b1, lines, { y (cap-top of the first line, px), cap (px), credit }]
export const CARDS = [
  [0, 7.6, ['IF CAPITAL', 'GROWS RAPIDLY,'], { y: 330, cap: 86 }],
  [8, 15.6, ['WAGES MAY RISE,'], { y: 330, cap: 86 }],
  [16, 21.6, ['BUT THE PROFIT', 'OF CAPITAL'], { y: 330, cap: 86 }],
  [22, 31.6, ['RISES', 'DISPROPORTIONATELY', 'FASTER.'], { y: 330, cap: 72 }],
  [32, 39.6, ['THE MATERIAL POSITION', 'OF THE WORKER', 'HAS IMPROVED,'], { y: 330, cap: 62 }],
  [40, 47.6, ['BUT AT THE COST', 'OF HIS SOCIAL', 'POSITION.'], { y: 330, cap: 70 }],
  [48, 53.6, ['THE SOCIAL CHASM', 'THAT SEPARATES HIM'], { y: 330, cap: 66 }],
  [54, 60.0, ['FROM THE CAPITALIST', 'HAS WIDENED.'], { y: 330, cap: 66, credit: 'KARL MARX, WAGE LABOUR AND CAPITAL, 1847' }],
  [62, 66.6, ['THE SHARE OF OUTPUT', 'PAID TO WORKERS'], { y: 330, cap: 62 }],
  [67, 72.0, ['THE LOWEST', 'ON RECORD.'], { y: 330, cap: 78, credit: 'US NONFARM BUSINESS, Q2 2026. BUREAU OF LABOR STATISTICS. RECORDS BEGIN 1947' }],
  [74.5, 78.0, ['NOTHING RISES'], { y: 330, cap: 86 }],
  [78, 83.6, ['WITHOUT US.'], { y: 330, cap: 104 }],
  [84, CLOSE, ['WE BUILT', 'ALL OF IT.'], { y: 330, cap: 104 }],
];
export const NUMBER = { text: '52.8%', note: 'BLS USDL 26-1434, 3 Sep 2026: labor share 52.8 percent in Q2 2026, nonfarm business; re-letter from the 5 Nov 2026 release' };
