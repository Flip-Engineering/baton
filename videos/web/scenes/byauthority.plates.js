// BY AUTHORITY: the plan (pure: no THREE, no DOM; node runs it in labs/devplate/byauthority_plan_test.mjs). The lightbox's layout in mm
// (the card at the origin, y up), RULE's schedule (the order of the permits), the camera (centre, k = screen px per mm, roll) and the
// light (exposure, daylight, transmitted mode) as functions of t. 84 BPM: a beat is 0.714 s, a bar 2.857 s; every time below is a beat.
// c20 (15 Oct): 23 bars, the mark at beat 92. The Crown's view is gone (no roll, no court stamp in macro, no "charged by the government");
// its bars went to the employers' passage (the turn now runs 20 beats) and to two bars of air after the Chairman's last word. FED is cut;
// SANCTION is the strikers' own sentence about the card's purpose and develops over the seated crowd's nearest faces (workers, not the
// police of the storefront plates, which are off the box). The stopped city is six different pictures held longer (two plants, two streets,
// two crowds), three of them new frames of the Pathe reel built into plates at run time. The landing is ONE crew of present-day workers
// (the person pipeline in Cycles, one scene: videos/blender/byauthority_crew_job.py) on a 14x17 in colour plate under the card; it develops
// from the edge nearest the card, large, under the Chairman's words; the last frame is the card and the crew.
// TAKES (globalThis.BYA_TAKE, set by scenes/byauthority_b.js before it imports the scene): 'a' opens on the card and WINNIPEG · 15 MAY 1919;
// 'b' opens on the card with the employers' trip to the Labor Temple as the hook (frame 0 held 8 beats), the city cut to five pictures.
//
// THE LAYOUT. Nothing lies above the card: that is where the words are read. The 1919 plates (5x7 in) lie in two columns beside the card
// and under it, 95 mm apart, so a shot that frames one plate with its top under the words has open box above it; the 2026 crew (14x17 in,
// landscape) lies under the card between the columns, 150 mm below it, out of every frame but the hinge's wide view until the landing.
export const BPM = 84, SPB = 60 / BPM, BAR = 4 * SPB;
export const T = b => b * SPB;
export const MARK = T(92);
export const TAKE = (typeof globalThis !== 'undefined' && globalThis.BYA_TAKE) || 'a';
export const F0 = TAKE === 'b' ? 8 : 4;                                     // frame 0 is held this many beats

const P57 = [177.8, 127.0], P1417 = [431.8, 355.6], GAP26 = 150;
export const CARD = { name: 'lac_e000008173', at: [0, 0], rot: 0, paper: [406.4, 271.6] };
const COLX = 203.2 + 87 + 88.9, R1 = 135.8 - 63.5, R2 = R1 - 127 - 95, R3 = R2 - 127 - 95, R4 = R3 - 127 - 95;
// the 1919 plates: name, centre (mm), a slight rotation (laid by hand); src 'bake' (assets/devplate/<name>/, baked 8 Oct) or 'reel' (a frame
// of the same Pathe reel, assets/byauthority/reel/<name>.png, made into a plate in the page: devplate.js plateFromPixels); the two the
// committee permits carry where the front begins (in the picture's own uv, v up): the empty track; the nearest faces
export const SILVER = [
  { name: 'bya_tracks_a', at: [-COLX, R1], rot: -0.004, src: 'bake', role: 'water', from: [0.5, 0.42] },
  { name: 'bya_crowd_b', at: [COLX, R1 - 2], rot: 0.006, src: 'bake', role: 'sanction', from: [0.47, 0.14] },
  { name: 'bya_crowd_a', at: [-COLX, R2 + 2], rot: 0.006, src: 'bake' },
  { name: 'bya_park_b', at: [COLX, R2], rot: -0.005, src: 'reel', px: [379, 268] },
  { name: 'bya_plant_a', at: [-COLX, R3], rot: 0.005, src: 'reel', px: [682, 483] },
  { name: 'bya_tracks_d', at: [COLX, R3 + 1], rot: -0.003, src: 'bake' },
  { name: 'bya_plant_b', at: [-COLX, R4 - 1], rot: -0.006, src: 'reel', px: [682, 483] },
  { name: 'bya_tracks_b', at: [COLX, R4], rot: 0.003, src: 'bake' },
].map(p => ({ ...p, glass: P57 }));
// the 2026 crew: one plate, the person pipeline's Cycles still of five workers at the start of a shift (assets/byauthority/crew/)
export const CREW = { name: 'bya26_crew', at: [0, -135.8 - GAP26 - P1417[1] / 2], rot: -0.003, glass: P1417, from: [0.5, 1.0] };
export const COLOUR = [CREW];
export const BOX = { size: [1500, 2400], center: [0, -280] };
// WINNIPEG · 2026 lies on the box in the gap between the card and the crew, answering frame 0's caption
export const LABEL26 = { at: [0, -135.8 - GAP26 / 2], rot: 0 };

const aabb = (at, [w, h], rot) => { const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot)), hw = (w * c + h * s) / 2, hh = (w * s + h * c) / 2; return [at[0] - hw, at[1] - hh, at[0] + hw, at[1] + hh]; };
// a picture uv (v up) -> region uv, through the plate's image rect (the glass inset 2 mm)
function pictureUV(p, [u, v]) { const [w, h] = p.glass, gu = (2 + u * (w - 4)) / w, gv = (2 + v * (h - 4)) / h; return [gu, gv]; }

// ---------------------------------------------------------------- RULE: when each plate is permitted
// water develops on OF WATER; sanction on THE SANCTION (the faces wait in negative through the sentence until it is given); the crew
// develops on HAS NOT ACQUIRED, from the edge nearest the card
export const DEV = { water: [T(29.5), 2 * SPB], sanction: [T(40.5), 2.5 * SPB], crew: [T(74.5), 3 * SPB] };
export function ruleSpec() {
  const regions = [];
  for (const p of SILVER) {
    const r = { id: p.name, box: aabb(p.at, p.glass, p.rot), shape: { rect: { aspect: 1.475 } }, edge: { noise: 0.004, scale: 0.02, seed: 7 + regions.length }, soft: 0.003, ease: 'inout' };
    if (p.role) { r.from = pictureUV(p, p.from); r.t0 = DEV[p.role][0]; r.dur = DEV[p.role][1]; } else r.from = [0.5, 0.5];
    regions.push(r);
  }
  // (v2) the crew's front is a soft wash, a tenth of the plate deep, not a hard line: at 1 fps v1 read it as a tear across the crew
  regions.push({ id: CREW.name, box: aabb(CREW.at, CREW.glass, CREW.rot), shape: { rect: { aspect: 1.475 } }, from: CREW.from, t0: DEV.crew[0], dur: DEV.crew[1],
    edge: { noise: 0.012, scale: 0.05, seed: 41 }, soft: 0.05, ease: 'inout' });
  return { regions, reverse: [], forward: [] };
}

// ---------------------------------------------------------------- the camera
const sstep = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const lerp = (a, b, u) => a + (b - a) * u;
const lerpK = (a, b, u) => a * Math.pow(b / a, u);
const byName = n => [...SILVER, ...COLOUR].find(p => p.name === n);
// a camera that puts surface point W at screen point S (px) at scale k and roll th (the screen basis: right (cos, sin), up (-sin, cos))
export function pivot([wx, wy], [sx, sy], k, th = 0) {
  const a = (sx - 540) / k, b = (960 - sy) / k, rx = Math.cos(th), ry = Math.sin(th), ux = -Math.sin(th), uy = Math.cos(th);
  return { cx: wx - rx * a - ux * b, cy: wy - ry * a - uy * b, k, roll: th };
}
// the surface point under screen point S
export function toSurfaceAt(C, [sx, sy]) { const a = (sx - 540) / C.k, b = (960 - sy) / C.k, th = C.roll || 0; return [C.cx + Math.cos(th) * a - Math.sin(th) * b, C.cy + Math.sin(th) * a + Math.cos(th) * b]; }
// a surface point -> screen px under a camera
export function toScreen(C, [x, y]) {
  const dx = x - C.cx, dy = y - C.cy, c = Math.cos(C.roll || 0), s = Math.sin(C.roll || 0);
  return [540 + C.k * (c * dx + s * dy), 960 - C.k * (-s * dx + c * dy)];
}
// frame a plate with its top at screen y `top`, its picture point `pt` (uv, v up) at screen x `sx`
function onPlate(p, k, top, pt = [0.5, 0.5], sx = 540) {
  const [w, h] = p.glass, px = p.at[0] + (pt[0] - 0.5) * (w - 4);
  return { cx: px - (sx - 540) / k, cy: p.at[1] + h / 2 - (960 - top) / k, k, roll: 0 };
}
const card = { top: 135.8, w: 406.4, h: 271.6 };
// the card's features (mm), from its meta (card_holes.json) at the 1024 px web copy: PERMITTED BY, the TLC oval, the holes
export const FEAT = { permitted: [-3.5, 71.7], oval: [-7.9, -40.4], stamp: [155.3, -32.9], holeTL: [-166.0, 98.9], holeTR: [147.1, 107.0], holeBL: [-161.5, -122.8], holeBR: [138.0, -113.9], lastE: [190.4, -79.8], label: [-3.7, -102.1] };
const K0 = 1210 / (1024 / (1001 / 406.4));   // frame 0: the 1024 px web copy shown 1210 px wide (112 % of the frame): 2.910 px per mm
// the stopped city, cut on the caption changes: six different pictures (a) or five (b), each held and pushed slowly. W: the whole plate,
// its margins and chips in view; T: tight on a picture point, at the same scale
const CITY_A = [
  { b: 4, n: 'bya_plant_a', m: 'W' }, { b: 8, n: 'bya_tracks_d', m: 'W' }, { b: 11, n: 'bya_plant_b', m: 'W' },
  { b: 14.5, n: 'bya_tracks_b', m: 'T', pt: [0.62, 0.42] }, { b: 18, n: 'bya_crowd_a', m: 'W' }, { b: 22, n: 'bya_park_b', m: 'W' },
];
const CITY_B = [
  { b: 8, n: 'bya_plant_a', m: 'W' }, { b: 12, n: 'bya_tracks_d', m: 'W' }, { b: 15, n: 'bya_plant_b', m: 'W' },
  { b: 18.5, n: 'bya_tracks_b', m: 'T', pt: [0.62, 0.42] }, { b: 21.5, n: 'bya_crowd_a', m: 'W' },
];
const CITY = TAKE === 'b' ? CITY_B : CITY_A;
export const CITY_SHOTS = CITY.map((s, i) => ({ ...s, t0: T(s.b), t1: i + 1 < CITY.length ? T(CITY[i + 1].b) : T(24) }));
// the plates' native px per mm; the scene fills this from the baked meta.json (src 'bake'), the reel plates from their pixels
export const PPM = {};
for (const p of SILVER) if (p.px) PPM[p.name] = p.px[0] / (p.glass[0] - 4);
// at most this enlargement of a plate's own pixels in a city shot; the park plate is a small crop (379 px) and is let go to 1.9x
export const MAXMAG = { bya_park_b: 1.9 };
function cityCam(s, t) {
  const p = byName(s.n), ppm = PPM[s.n] || 3.9, u = (t - s.t0) / (s.t1 - s.t0);
  const credit = TAKE === 'a' && s.t0 < T(11) - 1e-6, top = credit ? 664 : 600;   // under the credit (a: 2.857-7.857), else under the words
  const kn = Math.max(1.41, MAXMAG[s.n] ? Math.min(MAXMAG[s.n], 4.4 / ppm) : 1.41) * ppm, push = lerp(1, 1.06, sstep(u));
  // (v2) the whole plate held to the frame's width (up to 5.9 px/mm, as far as 1.41x its own pixels allows: about 990 px of 1080), not 871 px in a pale field
  if (s.m === 'W') { const k = Math.min(5.9, kn) * push; return onPlate(p, k, top + lerp(0, -10, u)); }
  const k = kn * push, sx = 540 - Math.max(-1, Math.min(1, (s.pt[0] - 0.5) * 2)) * 120;   // the subject a little off the centre
  return onPlate(p, k, top + lerp(0, -12, u), s.pt, sx);
}
// the keys of the continuous passages: [t, cam]; between keys smoothstep in centre and roll, log in k
function keysCam(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) {
    const [ta, A] = keys[i - 1], [tb, B] = keys[i], u = sstep((t - ta) / (tb - ta));
    return { cx: lerp(A.cx, B.cx, u), cy: lerp(A.cy, B.cy, u), k: lerpK(A.k, B.k, u), roll: lerp(A.roll || 0, B.roll || 0, u) };
  }
  return keys[keys.length - 1][1];
}
// the hinge (one bar, no words: the motif): from the last city plate back to the card small at the centre, among the negatives
function hingeKeys() {
  const L = CITY_SHOTS[CITY_SHOTS.length - 1], last = cityCam(L, L.t1);
  const wide = pivot([0, 0], [540, 905], 1.45);
  return [[T(24), last], [T(27.3), wide], [T(28), pivot([0, 0], [540, 900], 1.42)]];
}
// WATER, then SANCTION: the camera on each permitted plate, across the card from one to the other; the faces held as they develop, to the cut
function permitKeys() {
  const at = n => onPlate(byName(n), 4.0, 600);
  const A = at('bya_tracks_a'), B = at('bya_crowd_b');
  const settle = { ...A, k: 3.8, cy: A.cy + 4 };
  return [[T(28), settle], [T(28) + 0.7, A], [T(32), { ...A, cx: A.cx + 6 }], [T(34.2), { ...B, k: 3.9 }], [T(40.3), { ...B, cx: B.cx + 4, k: 4.05 }],
    [T(44), { ...B, cx: B.cx + 6, cy: B.cy + 3, k: 4.2 }]];
}
// THE TURN (20 beats): the card in warm raking daylight; a rail along the top edge (hole to hole), PERMITTED BY's deboss, then down to the
// bottom-left hole and across STRIKE COMMITTEE to the last E and the bottom-right hole. The card's top stays under the words.
function cardTopCam(cx, k, top) { return { cx, cy: card.top - (960 - top) / k, k, roll: 0 }; }
const tt = b => T(44 + (b - 44) * 20 / 16);                                // the old turn's 16 beats, given 20
function turnKeys() {
  // (c20) at most ~1.6x the 1024 px web copy (k 3.9) until the LAC TIFF: the rail is carried by the raking light and the lit holes
  return [[tt(44), cardTopCam(-95, 3.45, 612)], [tt(51.5), cardTopCam(85, 3.45, 612)], [tt(53), cardTopCam(-3.5, 3.75, 560)], [tt(55), cardTopCam(-3.5, 3.9, 556)],
    [tt(57.2), cardTopCam(-120, 3.7, 556)], [tt(60), cardTopCam(120, 3.4, 556)]];
}
// LENIN (64-72): the union's oval; the light climbs (lightAt)
function leninKeys() {
  const o = FEAT.oval;
  return [[T(64), cardTopCam(120, 3.4, 556)], [T(65.4), cardTopCam(o[0], 3.75, 612)], [T(71.5), cardTopCam(o[0] + 6, 3.95, 612)]];
}
// THE LANDING (72-92): from the oval down onto the crew, held large under the Chairman's words while it develops; then the two bars of air:
// one slow pull back to the last frame, the card above the crew, and it holds
const crewTop = CREW.at[1] + CREW.glass[1] / 2;
export const FINAL = (() => { const top = card.top, bot = CREW.at[1] - CREW.glass[1] / 2, k = 1470 / (top - bot); return { k, cardTop: 330, cy: (top + bot) / 2, sy: 330 + (top - (top + bot) / 2) * k }; })();
function crewCam(k, top) { return { cx: 0, cy: crewTop - (960 - top) / k, k, roll: 0 }; }
function landingKeys() {
  const L = leninKeys(), start = L[L.length - 1][1];
  const fin = pivot([0, FINAL.cy], [540, FINAL.sy], FINAL.k);
  return [[T(71.5), start], [T(73.0), crewCam(2.25, 658)], [T(85), crewCam(2.33, 656)], [T(90.6), fin], [MARK, { ...fin, k: fin.k * 1.004 }]];
}
// frame 0: a, the card centred at x 540, y 900 under its one-line caption; b, lower (centred at y 1150), the hook's words above it
export const F0Y = TAKE === 'b' ? 1150 : 900;
function frame0Cam(t) {
  const k = K0 * lerp(1, 1.025, Math.min(1, t / T(F0))), A = FEAT.permitted;
  const sA = [540 + (A[0] - 0) * K0, 960 - (A[1] - ((F0Y - 960) / K0)) * K0];   // where PERMITTED BY sits at frame 0
  return pivot(A, sA, k, 0);
}
export function camAt(t) {
  if (t < T(F0)) return { ...frame0Cam(t), shot: 'frame0' };
  if (t < T(24)) { const s = CITY_SHOTS.find(c => t >= c.t0 && t < c.t1); return { ...cityCam(s, t), shot: 'city:' + s.n + ':' + s.m }; }
  if (t < T(28)) return { ...keysCam(hingeKeys(), t), shot: 'hinge' };
  if (t < T(44)) return { ...keysCam(permitKeys(), t), shot: t < T(33) ? 'water' : 'sanction' };
  if (t < T(64)) return { ...keysCam(turnKeys(), t), shot: 'turn' };
  if (t < T(71.5)) return { ...keysCam(leninKeys(), t), shot: 'lenin' };
  if (t < MARK) return { ...keysCam(landingKeys(), t), shot: t < T(85) ? 'landing' : 'air' };
  return { ...keysCam(landingKeys(), MARK - 1e-6), shot: 'mark' };
}
// the parallax inside the plate a stopped-city shot holds (uv per unit of depth - 0.5): the living camera's push (baked plates only)
export function parAt(t) {
  const s = CITY_SHOTS.find(c => t >= c.t0 && t < c.t1); if (!s) return null;
  const u = sstep((t - s.t0) / (s.t1 - s.t0)); return { name: s.n, par: [0.004 * u, 0.006 * u] };
}

// ---------------------------------------------------------------- the light
// exposure (the camera's), daylight weight and elevation (deg; from the left), transmit (0 reflected .. 1 the box alone), the room's fill
export function lightAt(t) {
  const L = { exposure: 1.0, daylight: 0, elev: 12, transmit: 0, fill: 0.8 };
  if (t >= T(44) && t < T(72)) {                                            // the turn: daylight arrives (3300 K, 12 deg); Lenin: it climbs to 35
    L.daylight = 1; L.elev = t < T(64) ? 12 : lerp(12, 35, sstep((t - T(64)) / (T(72) - T(64))));
  }
  if (t >= T(72)) {                                                         // the landing: the daylight eases so the box carries the colour plate
    L.daylight = lerp(1, 0.5, sstep((t - T(72)) / (T(75) - T(72)))); L.elev = 35;
  }
  L.exposure = 1 / (1 + 0.42 * L.daylight) * (1 + 0.25 * L.transmit);
  return L;
}
