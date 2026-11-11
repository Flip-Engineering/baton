// CIVILIZATION v15 (2 Oct, c17): one world, one shot. A single globe carries every line as an event on it, from the Europe hook to the mark.
// The camera never cuts (civ.geo.js: one orthographic sphere, keyframed centre / roll / radius), the type is set in the shot (no bands),
// and the ink logic is v14's: black = the world and what is gone, red = the United States only, gold = money only, paper = sea.
//
//   b0  Europe, garrisoned: the hook .......... b4 IT'S A MUSEUM: the rope and the placard on the map .... b6 WE'RE THE GUARDS: the push into the roundels
//   b8  THE ORDERS COME FROM: the dive to the foot of Manhattan, WALL ST on the real street grid
//   b12 PARASITIC RENTS RISE AT HOME: gold runs from the metros to that one point .... b16 FACTORIES SHIP OUT: the Great Lakes plants lift off
//   b20 SOLDIERS SHIP ABROAD: helmets ride the arcs, bases stamp .... b24 the count: bases and years run together in the corner counter
//   b30 WE LIVE IN A PLANNED ECONOMY, PLANNED ON WALL STREET: every order drawn from one point .... b34 EXPROPRIATE THE PLANNERS: the network re-anchors on the towns
//   b36.9 the silence .... b38.3 GUARD DUTY'S OVER, WE'RE COMING HOME: the arcs run back .... b42 AVIANO TO AKRON, RAMSTEIN TO RICHMOND, BAHRAIN TO BUFFALO, OKINAWA TO OKLAHOMA
//   b50 ALL 750 HOME, the plants come down lit .... b53 the helmet becomes the hard hat .... b56 the works between the towns, the lights, the mark .... b66 A CIVILIZATION RISING. b70 lockup
import { W, H, clamp, lerp, ease, ctx, P, stencilF, RED, BLK, PAPER, knock } from './empire5.kit.js';
import { loadBeats, sigil, line } from '../lib/kit.js';
import { setBlock, riso, typeAudit } from '../lib/fx/type_world.js';
import { loadWorld, view, makeCam, camOnArc } from './civ.geo.js';
import { TOWNS, PAIRS } from './civ.data.js';
import * as S from './civ.shots.js';

const B = await loadBeats(window.CIV_SCENE || 'empire5');      // c20: a take (empire5_a.html) loads its own song's beats
window.SPB = B.spb;
const WD = await loadWorld();
S.init(WD);
// v18 (5 Oct): Hudson's super imperialism spliced in at old b30 (between the tally and WE LIVE IN A PLANNED ECONOMY), 20 beats; the scene
// keeps its old timeline (bs) and maps the new beat onto it: b < 30 -> b, 30 <= b < 50 -> the Hudson section (bs = 1000 + hb), b >= 50 -> b - 20.
const INS0 = 30, INS = S.HUD_LEN;
const LOCKB = 70 + INS;
const toOld = b => b < INS0 ? b : b < INS0 + INS ? 1000 + (b - INS0) : b - INS;

// ---------------------------------------------------------------- the words (beats at 120 BPM)
const C = (s, e, text, o = {}) => ({ s, e, text, ...o });
export const CUES = [
  C(0, 3.6, 'SHUT THE FUCK UP\nABOUT EUROPE.'), C(4, 5.6, "IT'S A MUSEUM."), C(6, 7.7, "WE'RE THE GUARDS."),
  C(8, 11.4, 'THE ORDERS COME FROM'), C(12, 15.4, 'PARASITIC RENTS RISE AT HOME,'), C(16, 19, 'FACTORIES SHIP OUT,'), C(20, 23, 'SOLDIERS SHIP OUT.'),
  C(1000, 1005.6, "FINANCING AMERICA'S WARS WITH OTHER NATIONS' RESOURCES"), C(1006, 1011.4, 'FORCED FOREIGN CENTRAL BANKS TO USE THEIR DOLLARS TO BUY U.S. BONDS'),
  C(1012, 1015.6, 'A FREE LUNCH IN THE FORM OF COMPULSORY FOREIGN LOANS'), C(1016, 1019.7, 'TO FINANCE U.S. GOVERNMENT POLICY.'),
  C(30, 32, 'WE LIVE IN A PLANNED ECONOMY,'), C(32, 34, 'PLANNED ON WALL STREET.'), C(34, 36.5, 'EXPROPRIATE THE PLANNERS.'),
  // c20: the band releases on b36.5 and the room rings; GUARD DUTY'S OVER. comes back with it on b38. One pair said (the rest land on
  // the map's tags); ALL 750 HOME. is gone (the counter's 0 says it); the second dive's one line names the class where it acts.
  C(38, 40, "GUARD DUTY'S OVER."), C(40, 42, "WE'RE COMING HOME."),
  C(42, 44, 'AVIANO TO AKRON.'),
  C(54, 57, 'THE WORKING CLASS BUILDS.'), C(66, 70, 'A CIVILIZATION RISING.'),
];
const PLANT_CAP = 165;
// [line, cap, flags ('c' = the key word, red), sx] per row; y = the block's centre
export const TYPESET = {
  'SHUT THE FUCK UP\nABOUT EUROPE.': { rows: [['SHUT THE FUCK UP', 172, 0, 0.74], ['ABOUT', 172], ['EUROPE.', 240, 'c']], y: 548, role: 'plant', gap: 0.1 },
  "IT'S A MUSEUM.": { rows: [["IT'S A", 230], ['MUSEUM.', 230, 'c']], y: 500, role: 'shout' },
  "WE'RE THE GUARDS.": { rows: [["WE'RE THE", 190], ['GUARDS.', 270, 'c']], y: 470, role: 'shout' },
  'THE ORDERS COME FROM': { rows: [['THE ORDERS', 210], ['COME FROM', 210, 'c']], y: 470, role: 'shout' },
  'PARASITIC RENTS RISE AT HOME,': { rows: [['PARASITIC', 200, 'c'], ['RENTS RISE', 200], ['AT HOME,', 200]], y: 560, role: 'shout' },
  'FACTORIES SHIP OUT,': { rows: [['FACTORIES', 250, 'c'], ['SHIP OUT,', 250]], y: 560, role: 'shout' },
  'SOLDIERS SHIP OUT.': { rows: [['SOLDIERS', 250, 'c'], ['SHIP OUT.', 250]], y: 560, role: 'shout' },   // c20: the pun the homecoming answers
  // v18: Michael Hudson, Super Imperialism (2nd ed. 2003): the chapter title, then the preface's two sentences (research/THEORY_CORPUS.md SI5, SI3, SI2)
  "FINANCING AMERICA'S WARS WITH OTHER NATIONS' RESOURCES": { rows: [['FINANCING', 160, 'c'], ["AMERICA'S WARS", 140], ['WITH OTHER', 120], ["NATIONS'", 120], ['RESOURCES', 170, 'c'], ['MICHAEL HUDSON · SUPER IMPERIALISM', 44]], y: 430, role: 'shout', gap: 0.12 },
  'FORCED FOREIGN CENTRAL BANKS TO USE THEIR DOLLARS TO BUY U.S. BONDS': { rows: [['FORCED FOREIGN', 130], ['CENTRAL BANKS', 150, 'c'], ['TO USE THEIR DOLLARS', 100], ['TO BUY', 120], ['U.S. BONDS', 180, 'c']], y: 420, role: 'shout', gap: 0.12 },
  'A FREE LUNCH IN THE FORM OF COMPULSORY FOREIGN LOANS': { rows: [['A FREE LUNCH', 180, 'c'], ['IN THE FORM OF', 115], ['COMPULSORY', 165, 'c'], ['FOREIGN LOANS', 140]], y: 400, role: 'shout', gap: 0.12 },
  'TO FINANCE U.S. GOVERNMENT POLICY.': { rows: [['TO FINANCE', 140], ['U.S. GOVERNMENT', 130], ['POLICY.', 230, 'c']], y: 400, role: 'shout', gap: 0.12 },
  'WE LIVE IN A PLANNED ECONOMY,': { rows: [['WE LIVE IN A', 160], ['PLANNED', 240, 'c'], ['ECONOMY,', 200]], y: 470, role: 'shout' },
  'PLANNED ON WALL STREET.': { rows: [['PLANNED ON', 200], ['WALL STREET.', 230, 'c']], y: 430, role: 'shout' },
  'EXPROPRIATE THE PLANNERS.': { rows: [['EXPROPRIATE', 190, 'c'], ['THE PLANNERS.', 190]], y: 520, role: 'shout' },
  "GUARD DUTY'S OVER.": { rows: [["GUARD DUTY'S", 160], ['OVER.', 300]], y: 440, role: 'shout' },   // v19: OVER. in black (it was red on the red continent)
  "WE'RE COMING HOME.": { rows: [["WE'RE", 200], ['COMING', 200], ['HOME.', 230, 'c']], y: 540, role: 'shout' },
  'AVIANO TO AKRON.': { rows: [['AVIANO TO', 200], ['AKRON.', 280, 'c']], y: 440, role: 'shout' },
  'THE WORKING CLASS BUILDS.': { rows: [['THE WORKING', 175], ['CLASS', 270, 'c'], ['BUILDS.', 250]], y: 430, role: 'shout' },
  'A CIVILIZATION RISING.': { rows: [['A', 170], ['CIVILIZATION', PLANT_CAP, 0, 0.86], ['RISING.', 420, 0, 0.74]], y: 600, role: 'payoff', gap: 0.08 },   // 4 Oct: A on its own line (it closed up to ACIVILIZATION at phone size), RISING. in black (it was red on the red continent)
};
typeAudit.plantCap = PLANT_CAP;
const inkDrum = riso({ seed: 11, speckle: 0.12, streak: 0.02 });
const blockCache = new Map();
function blockOf(text) {
  if (blockCache.has(text)) return blockCache.get(text);
  const T0 = TYPESET[text], rows = T0.rows;
  const blk = setBlock(stencilF, rows.map(([t, cap, f, sx]) => ({ text: t, cap, max: cap, fill: true, sx: sx || 1 })), { role: T0.role, y: T0.y, gap: T0.gap ?? 0.16 });
  const chant = rows.map((r0, i) => r0[2] === 'c' ? i : -1).filter(i => i >= 0), plain = rows.map((r0, i) => i).filter(i => !chant.includes(i));
  const path = new Path2D(); for (const G of blk.glyphs) path.addPath(G.path, new DOMMatrix().translateSelf(G.ox, G.oy));
  const o = { blk, path, chant, plain, T0 };
  blockCache.set(text, o); return o;
}
const liveCue = beat => CUES.find(c => beat >= c.s && beat < c.e);
const riseOf = (text, beat) => text === 'A CIVILIZATION RISING.' ? (1 - ease.outExpo(clamp((beat - 66) / 0.55))) * 1300 : 0;
function typeKnock(beat) {
  const cu = liveCue(beat); if (!cu) return;
  const { path: path0 } = blockOf(cu.text), ry = riseOf(cu.text, beat);
  const path = ry ? (() => { const q = new Path2D(); q.addPath(path0, new DOMMatrix().translateSelf(0, ry)); return q; })() : path0;
  knock(path, 11);
}
function strike(Pl, age, reg, alpha = 1) {
  if (age < 0) return;
  const f = Math.floor(age * 30 + 1e-6);
  if (f === 0) { for (const [dy, a] of [[40, 0.2], [24, 0.3], [0, 0.9]]) inkDrum.print(ctx, Pl, 0.05, { reg: [reg[0], reg[1] + dy], alpha: alpha * a }); return; }
  if (f === 1) { inkDrum.print(ctx, Pl, 0.05, { reg: [reg[0] * 1.6, reg[1] * 1.6 + 6], rot: 0.022, alpha }); return; }
  inkDrum.print(ctx, Pl, 0.05, { reg, alpha });
}
function drawType(beat) {
  typeAudit.reset();
  const cu = liveCue(beat); if (!cu) return;
  const { blk, chant, plain } = blockOf(cu.text); let age = (beat - cu.s) * B.spb;
  if (cu.s === 0) age = Math.max(age, 0.2);
  let off = [5, -4], rise = 0;
  if (cu.text === 'A CIVILIZATION RISING.') { const kz = 1 - ease.inOutCubic(clamp((beat - 67.6) / 0.4)); off = [7 * kz, -6 * kz]; rise = riseOf(cu.text, beat); }
  const slap = cu.s > 0 && age < 0.1 ? lerp(1.03, 1, age / 0.1) : 1, [cx, cy] = [(blk.bbox.x1 + blk.bbox.x2) / 2, (blk.bbox.y1 + blk.bbox.y2) / 2];
  ctx.save(); ctx.translate(0, rise); ctx.translate(cx, cy); ctx.scale(slap, slap); ctx.translate(-cx, -cy);
  if (plain.length) strike(inkDrum.plate(blk, BLK, { only: plain, key: 'k' }), age, [0, 0]);
  if (chant.length) strike(inkDrum.plate(blk, RED, { only: chant, key: 'c' }), age, off);
  ctx.restore();
  typeAudit.add(blk, { role: blk.role, read: age >= 0.067 && rise < 2 ? 1 : 0.6, s: slap, dy: rise });
}
window.typeInfo = () => typeAudit.items;

// ---------------------------------------------------------------- the lockup, on the piece's own red
function lockup(c, age) {
  c.fillStyle = RED; c.fillRect(0, 0, W, H);
  const kz = Math.exp(-age * 12), a = clamp(0.6 + age / 0.1), s = 230 * (1 + 0.25 * kz);
  c.save(); c.globalCompositeOperation = 'multiply'; sigil(c, W / 2 - 14 * kz, 866 + 10 * kz, s, { color: BLK, alpha: 0.35 * a }); c.restore();
  sigil(c, W / 2, 860, s, { color: PAPER, accent: BLK, alpha: a });
  line(c, 'ACP.US', W / 2, 1190, { family: 'Archivo Black', size: 76, color: PAPER, alpha: clamp(0.5 + age * 4) });
}

// ---------------------------------------------------------------- the camera: one path through the world
const WSx = [-74.0085, 40.7048];                           // the foot of Manhattan, framed so WALL ST has room above the exchange
const KF = (b, lon, lat, R, o = {}) => ({ b, lon, lat, R, ax: 540, ay: 1150, roll: 0, ...o });
const arcCams = PAIRS.map(p => camOnArc(p.bll, TOWNS[p.town], { span: 740, ay: 1190 }));
const LAKES = [-82.0, 41.9];
const arcPac = camOnArc([114.06, 22.54], [-82.7, 41.9], { span: 1180, ay: 1100 });
const TAKE = (window.CIV_TAKE || 'a');
export const CAMPATH = [
  KF(0, 11, 50.5, 1450, { ay: 1300 }),
  KF(4, 10.3, 49.8, 2300, { ay: 1360 }),
  KF(6, 8.9, 49.7, 4300, { ay: 1300 }),
  KF(8, 8.3, 49.7, 4700, { ay: 1250 }),
  KF(9.2, -32, 47, 1000, { ay: 1120, stop: true }),
  KF(10.8, WSx[0], WSx[1], 2.7e6, { ay: 1060, stop: true, mode: 'dive' }),
  KF(12.4, WSx[0] + 0.0004, WSx[1] + 0.0009, 2.9e6, { ay: 1060, stop: true }),
  KF(14.1, -96, 38.5, 1180, { ay: 1120, mode: 'lag' }),
  KF(15.5, -91, 40, 1230, { ay: 1120 }),
  KF(16.6, -82.7, 41.9, 6000, { ay: 1170, stop: true }),
  KF(18.0, -82.4, 42.3, 6400, { ay: 1170, stop: true }),
  { b: 19.6, lon: arcPac.lon, lat: arcPac.lat, R: arcPac.R, ax: 540, ay: 1100, roll: arcPac.roll },
  KF(21.0, -52, 43, 780, { ay: 1160 }),
  KF(22.6, -20, 42, 810, { ay: 1160 }),
  KF(24.0, 34, 38, 840, { ay: 1160 }),
  KF(25.6, 128, 34, 880, { ay: 1150 }),
  KF(27.4, 90, 30, 860, { ay: 1150 }),
  KF(29.2, 10, 49, 1500, { ay: 1160 }),
  KF(30.2, -50, 46, 640, { ay: 1160 }),
  // c20 EXPROPRIATE: take a holds the whole of America so the point reads as Manhattan, on the north-east coast; take b dives back down
  ...(TAKE === 'b' ? [
    KF(32.6, -66, 42, 720, { ay: 1160, stop: true }),
    KF(34.2, WSx[0], WSx[1], 2.7e6, { ay: 1060, stop: true, mode: 'dive' }),
    KF(36.5, WSx[0] + 0.0003, WSx[1] + 0.0006, 2.8e6, { ay: 1060, stop: true }),
    KF(38.2, -80, 42, 1250, { ay: 1120, mode: 'lag' }),
  ] : [
    KF(32.4, -62, 43, 700, { ay: 1160 }),
    KF(33.9, -92, 39.5, 1150, { ay: 1120, stop: true }),
    KF(36.5, -92, 39.5, 1190, { ay: 1120, stop: true }),
    KF(38.2, -80, 42, 1250, { ay: 1120 }),
  ]),
  KF(39.6, -40, 46, 740, { ay: 1160 }),
  KF(41.4, -35, 44, 780, { ay: 1160 }),
  { b: 42.15, lon: arcCams[0].lon, lat: arcCams[0].lat, R: arcCams[0].R, ax: 540, ay: 1190, roll: arcCams[0].roll, stop: true },
  { b: 43.75, lon: arcCams[0].lon, lat: arcCams[0].lat, R: arcCams[0].R * 1.03, ax: 540, ay: 1190, roll: arcCams[0].roll },
  KF(44.7, 2, 38, 700, { ay: 1160 }),                                     // Ramstein, Bahrain: the arcs leave Europe and the Gulf
  KF(45.8, -92, 37, 820, { ay: 1160 }),                                   // Okinawa comes in over the Pacific to Oklahoma
  KF(47.2, -84, 41, 2600, { ay: 1160 }),                                  // the plants come home to the lakes, lit
  KF(48.3, -82.3, 41.5, 5200, { ay: 1180, stop: true }),
  // c20: the second dive: to Akron, E Market St at Goodyear Blvd (where the orders come from, b8; where the work is done, here)
  KF(50.0, S.AKRON_CAM[0], S.AKRON_CAM[1] - 0.004, 2.3e6, { ay: 1200, stop: true, mode: 'dive' }),
  KF(55.3, S.AKRON_CAM[0], S.AKRON_CAM[1] - 0.004, 2.36e6, { ay: 1200, stop: true }),
  KF(57.4, -83.5, 41.2, 4800, { ay: 1160, mode: 'lag' }),
  KF(60, -93, 39.5, 1300, { ay: 1170 }),                                 // (v18 tried framing north for Canada: d3's horizon clip dropped the continents on some frames; v17's path keeps them)
  KF(64, -96, 38.5, 1420, { ay: 1190 }),
  KF(70, -96, 38.5, 1500, { ay: 1200 }),
];
const CAM = makeCam(CAMPATH);
// v18: the Hudson section's own path: from where the old b30 was, out over Eurasia (bases to banks), over the pole (banks to New York), back
const C30 = CAM(30), KC = (b, c) => ({ b, lon: c.lon, lat: c.lat, R: c.R, ax: c.ax, ay: c.ay, roll: c.roll || 0 });
const HCAM = makeCam([KC(0, C30), KF(1.8, 72, 38, 470, { ay: 1300 }), KF(5.8, 82, 40, 490, { ay: 1300 }), KF(7.6, 30, 55, 450, { ay: 1300 }),
  KF(10.8, -42, 48, 470, { ay: 1300 }), KF(13.0, -32, 44, 500, { ay: 1290 }), KF(18.6, -38, 45, 560, { ay: 1250 }), KC(20, C30)]);
const camOf = bs => bs >= 1000 ? HCAM(bs - 1000) : CAM(bs);
window.camAt = b => camOf(toOld(b));

// ---------------------------------------------------------------- the frame
const SHOTS_END = LOCKB;
window.renderFrame = async (t) => {
  const beat = B.beat(t), t0 = performance.now();
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  const LOCK = 1.4 / B.spb;
  if (beat >= LOCKB) { lockup(ctx, (beat - LOCKB) * B.spb); return; }   // c20 finish: held to the last frame (a/b cut back to frame 0 at 47.4 s)
  P.begin();
  const bs = beat >= LOCKB + LOCK ? 0 : toOld(beat);
  const cam = camOf(bs), V = view(cam);
  if (location.search.includes("dbg")) console.log("cam", JSON.stringify(cam));
  const res = (bs >= 1000 ? S.hudson(V, WD, bs - 1000) : S.draw(V, WD, bs, t)) || {};
  if (bs > 48.5 && bs < 50.5 && cam.R > 5e4 && cam.R < 9e4) res.flash = 0.8 * (1 - Math.log(cam.R / 5e4) / Math.log(1.8));
  typeKnock(bs);
  for (const gg of P.g) gg.getImageData(0, 0, 1, 1);   // flush the plates' queued drawing before the press reads them
  P.print(ctx, { t, misreg: res.misreg ?? 1.6 });
  drawType(bs);
  if (res.after) res.after(ctx);
  if (res.flash) { ctx.fillStyle = `rgba(239,226,196,${res.flash})`; ctx.fillRect(0, 0, W, H); }
  if (window.__timing) console.log(`frame b=${beat.toFixed(2)} ${(performance.now() - t0).toFixed(0)}ms`);
};
window.sceneReady = true;
