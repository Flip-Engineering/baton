// CIVILIZATION v12, b50-68: the build. Three shifts, a soldier becomes a worker, bridges, rails, power, one ship in four days, a civilization rising.
import { feature, mesh } from '../node_modules/topojson-client/src/index.js';
import { geoAlbers, geoPath } from 'd3-geo';
import * as K from './empire5.kit.js';
import { WC, wallPath } from './empire5.shots2.js';
const { P, g, SIL, RED, BLK, GOLD, PAPER, TAU, k, r, d, W, H, clamp, lerp, ease, rng, BRAND, fillP, rect, circle, ring, lineP, strokeP, poly, text, knock, mkPath, rectPath, circPath, xf, sg, sign, signAt, signOut } = K;
const fr = K.frame;
import { wipe, blinds, sunburst, bandCloud } from '../lib/fx/printkit.js';

const J = async u => (await fetch(u)).json();
const tUS = await J('../node_modules/us-atlas/states-10m.json');
const L48 = s => +s.id <= 56 && s.id !== '02' && s.id !== '15';
const US48 = { type: 'FeatureCollection', features: feature(tUS, tUS.objects.states).features.filter(L48) };
const STATE_LINES = mesh(tUS, tUS.objects.states, (a, b) => a !== b && L48(a) && L48(b));
const P2 = (proj, obj) => new Path2D(geoPath(proj)(obj) || '');

// ---------------------------------------------------------------- shared
function crewFig(type, pose, x, y, h, flip = false) {
  const c = SIL.cell(type, pose); if (!c) return;
  g.save(); g.fillStyle = k(1); SIL.fill(g, c, x, y, h, { flip }); g.restore();
}
const CREW = [[0, 'sledge'], [1, 'shovel'], [2, 'heave'], [3, 'standC'], [4, 'walk3'], [5, 'standA']];
function crew(list, t) { list.forEach(([x, y, h, i, flip], j) => { const [ty, ps] = CREW[i % CREW.length]; crewFig(ty, ps === 'walk3' ? 'walk' + (Math.floor(t * 4 + j * 3) % 8) : ps, x, y, h, !!flip); }); }

// ---------------------------------------------------------------- b50 three shifts: the day as a dial, a mill at its hub
export function shotShifts(b, t) {
  const age = b - 50, step = Math.floor(age * 2 + 1e-6), rot = step * (Math.PI / 6), cx = 540, cy = 1210, R = 500;
  // three eight-hour sectors: gold (day), red (evening), black (night); a step of 30 degrees on each 8th
  const cols = [d(1), r(1), k(1)];
  for (let j = 0; j < 3; j++) { const a0 = -Math.PI / 2 + rot + j * TAU / 3, p = new Path2D(); p.moveTo(cx, cy); p.arc(cx, cy, R, a0, a0 + TAU / 3); p.closePath(); fillP(p, cols[j]); }
  // the hour ticks, cut in bare stock; a keyline
  g.strokeStyle = PAPER; g.lineWidth = 6;
  for (let h = 0; h < 24; h++) { const a = -Math.PI / 2 + rot + h * TAU / 24, L0 = h % 3 === 0 ? R - 70 : R - 38; g.beginPath(); g.moveTo(cx + Math.cos(a) * L0, cy + Math.sin(a) * L0); g.lineTo(cx + Math.cos(a) * (R - 8), cy + Math.sin(a) * (R - 8)); g.stroke(); }
  ring(cx, cy, R, 8, k(1));
  circle(cx, cy, 275, PAPER); ring(cx, cy, 275, 8, k(1));
  sg('factory', cx, cy + 115, 275, k(1), { lod: 2 });
  // the pointer: a black wedge at twelve o'clock
  poly([[cx - 34, cy - R - 54], [cx + 34, cy - R - 54], [cx, cy - R + 18]], k(1));
  return { misreg: 1.6 + 5 * Math.exp(-(age * 2 - step) * 8) };
}

// ---------------------------------------------------------------- b52 every soldier builds: the soldier becomes the worker
export function shotSoldier(b, t) {
  const age = b - 52, base = 1900, h = 920;
  rect(0, 1000, W, H - 1000, d(0.5));
  circle(540, 1400, 400, r(1));
  rect(0, base - 20, W, H, k(1));
  const p = fr(b, 52.9, 53.35);
  if (p <= 0) sg('soldier', 540, base - 20, h, k(1), { lod: 2 });
  else if (p >= 1) sg('worker', 540, base - 20, h, k(1), { lod: 2 });
  else {
    const m = blinds(p, { n: 14, angle: 0, box: [0, base - 20 - h - 60, W, base - 20 + 10] });
    g.save(); g.clip(m); sg('worker', 540, base - 20, h, k(1), { lod: 2 }); g.restore();
    const inv = new Path2D(); inv.rect(0, 0, W, H); inv.addPath(m);
    g.save(); g.clip(inv, 'evenodd'); sg('soldier', 540, base - 20, h, k(1), { lod: 2 }); g.restore();
  }
  return { misreg: 1.6 + 5 * Math.exp(-age * 7) + (p > 0 && p < 1 ? 4 : 0) };
}

// ---------------------------------------------------------------- b54 bridges: a cantilever span closes, a red sun behind it
export function shotBridge(b, t) {
  const age = b - 54, close = ease.inOutCubic(clamp((age - 0.2) / 1.5)), wl = 1530;
  circle(540, 1180, 330, r(1));
  rect(0, wl, W, H - wl, k(1));
  // the bridge, closing from both banks
  const bh = 540, bw = 2.2 * bh, bx = 540;
  g.save(); const cl = new Path2D(); cl.rect(0, 0, 540 - bw * 0.5 * (1 - close) + 2, H); cl.rect(540 + bw * 0.5 * (1 - close) - 2, 0, W, H); cl.addPath(new Path2D());
  const reveal = new Path2D(); reveal.rect(0, 0, 540 - (bw / 2) * (1 - close), H); reveal.rect(540 + (bw / 2) * (1 - close), 0, W, H);
  g.clip(reveal); sg('bridge', bx, wl, bh, k(1), { lod: 2 }); g.restore();
  // paper waves in the river
  g.strokeStyle = PAPER; g.lineWidth = 6;
  for (let j = 0; j < 4; j++) { const y = wl + 36 + j * 40, ph = t * 1.4 + j * 1.9; g.beginPath(); for (let x = -20; x <= W + 20; x += 24) { const yy = y + Math.sin(x * 0.02 + ph) * 5; x === -20 ? g.moveTo(x, yy) : g.lineTo(x, yy); } g.stroke(); }
  // the crew on the near bank
  const ground = new Path2D(); ground.moveTo(0, 1700); ground.lineTo(W, 1640); ground.lineTo(W, H); ground.lineTo(0, H); ground.closePath(); fillP(ground, d(1));
  crew([[130, 1830, 360, 0], [330, 1850, 380, 1], [540, 1870, 400, 3], [770, 1850, 380, 4, 1], [950, 1830, 360, 2, 1]], t);
  return { misreg: 1.6 + 5 * Math.exp(-age * 7) };
}

// ---------------------------------------------------------------- b56 rails: the line laid to the horizon, black on gold
export function shotRails(b, t) {
  const age = b - 56, lay = ease.inOutCubic(clamp((age - 0.1) / 1.6));
  rect(0, 0, W, H, d(1));
  rect(0, 1560, W, H - 1560, d(0.5));                                   // the plain
  circle(540, 1560, 230, r(1));                                          // a red sun on the horizon
  rect(0, 1560, W, H - 1560, d(0.5)); rect(0, 1560, W, 6, k(1));
  // the rails sign, big, revealed from the near end toward the horizon (the laying head runs away)
  const rh = 1000, rw = rh, by = 1900;
  g.save(); const rev = new Path2D(); const top = by - rh * lay; rev.rect(0, top, W, by - top + 10); g.clip(rev); sg('rails', 540, by, rh, k(1), { lod: 2 }); g.restore();
  // the laying head: three sparks at the end of the steel
  if (lay < 0.98) { const R = rng(5); for (let j = 0; j < 7; j++) { const a = R() * TAU, q = (t * 3 + j * 0.31) % 1; circle(540 + Math.cos(a) * 36 * q, top + 6 + Math.sin(a) * 20 * q, 7 * (1 - q), k(1)); } }
  const ground = new Path2D(); ground.moveTo(0, 1800); ground.lineTo(W, 1760); ground.lineTo(W, H); ground.lineTo(0, H); ground.closePath();
  crew([[110, 1860, 360, 0], [300, 1880, 380, 1], [800, 1880, 380, 3, 1], [980, 1860, 360, 2, 1]], t);
  return { misreg: 1.6 + 5 * Math.exp(-age * 7) };
}

// ---------------------------------------------------------------- b58 power: the towers raised across a red sky, the line goes live
export function shotPower(b, t) {
  const age = b - 58, up = ease.outCubic(clamp(age / 0.9)), live = clamp((age - 0.9) / 0.4);
  rect(0, 0, W, H, r(1));
  circle(300, 1640, 260, d(1));                                          // the sun going down behind the line
  rect(0, 1640, W, H - 1640, d(0.5)); rect(0, 1640, W, 8, k(1));
  const T0 = [[220, 1640, 980], [820, 1640, 760]], tops = [];
  T0.forEach(([x, y, h], i) => { const hh = h * clamp(up * 1.15 - i * 0.12); if (hh > 4) { sg('pylon', x, y, hh, k(1), { lod: 2 }); } tops.push([x, y - h * (hh / h) * 0.86, hh / h]); });
  // wires between the arms: three catenaries; gold pulses once the line is live
  if (up > 0.8) for (let j = 0; j < 3; j++) {
    const [x0, y0] = [220 + (j - 1) * 34, 1640 - 980 * (0.82 - j * 0.2)], [x1, y1] = [820 + (j - 1) * 24, 1640 - 760 * (0.82 - j * 0.2)], pts = [];
    for (let s = 0; s <= 30; s++) { const f = s / 30; pts.push([lerp(x0, x1, f), lerp(y0, y1, f) + Math.sin(Math.PI * f) * 70]); }
    lineP(pts, k(1), 5);
    if (live > 0) { const q = ((age * 1.3 + j * 0.3) % 1), n = Math.floor(q * 30); circle(pts[n][0], pts[n][1], 12, k(1)); circle(pts[n][0], pts[n][1], 7, d(1)); }
  }
  // wires off the right-hand tower to the edge
  for (let j = 0; j < 3; j++) lineP([[820 + (j - 1) * 24, 1640 - 760 * (0.82 - j * 0.2)], [W + 40, 1640 - 760 * (0.82 - j * 0.2) + 90]], k(1), 5);
  for (let j = 0; j < 3; j++) lineP([[-40, 1640 - 980 * (0.82 - j * 0.2) + 110], [220 + (j - 1) * 34, 1640 - 980 * (0.82 - j * 0.2)]], k(1), 5);
  crew([[300, 1850, 330, 3], [520, 1870, 360, 4], [700, 1860, 340, 5, 1]], t);
  return { misreg: 1.6 + 5 * Math.exp(-age * 7) };
}

// ---------------------------------------------------------------- b60 we build everything: one ship, keel to launch, between two cranes
export function shotYard(b, t) {
  const age = b - 60, prog = ease.inOutCubic(clamp((age - 0.1) / 1.7)), wl = 1700;
  rect(0, 1100, W, wl - 1100, d(0.5));
  rect(0, wl, W, H - wl, k(1));
  sg('crane', 100, wl, 540, k(1), { lod: 2 }); sg('crane', 990, wl, 470, k(1), { lod: 2, flip: true });
  // the ship, laid from keel to launch: a saw-toothed edge runs left to right
  g.save(); g.clip(wipe(prog, { angle: 0, edge: 'saw', teeth: 11, amp: 36, box: [100, 1300, 980, wl] })); sg('ship', 540, wl + 4, 370, r(1), { lod: 2 }); g.restore();
  g.strokeStyle = PAPER; g.lineWidth = 6;
  for (let j = 0; j < 3; j++) { const y = wl + 38 + j * 46, ph = t * 1.4 + j * 1.9; g.beginPath(); for (let x = -20; x <= W + 20; x += 24) { const yy = y + Math.sin(x * 0.02 + ph) * 5; x === -20 ? g.moveTo(x, yy) : g.lineTo(x, yy); } g.stroke(); }
  return { misreg: 1.6 + 5 * Math.exp(-age * 7) };
}
export function shotDays(b, t) {
  const age = b - 62;
  rect(0, 0, W, H, k(1));
  text('ONE SHIP, KEEL TO LAUNCH', 540, 400, 84, PAPER, { font: 'Oswald' });
  rect(150, 450, 780, 8, d(1));
  text('4', 540, 1135, 760, d(1), { font: 'Anton' });
  text('DAYS', 540, 1500, 360, PAPER, { font: 'Anton' });
  text('15 HRS 29 MIN', 540, 1620, 84, d(1), { font: 'Oswald' });
  text('RICHMOND, CALIFORNIA \u00B7 1942', 540, 1730, 62, PAPER, { font: 'Oswald' });
  return { misreg: 1.6 + 7 * Math.exp(-age * 8), flash: age < 0.066 ? 0.25 : 0 };
}

// ---------------------------------------------------------------- b64 a civilization rising: the mark up over the red continent, its rays across the sky
const tintC = new Map();
function tintedMark(col) { if (tintC.has(col)) return tintC.get(col); const M = BRAND.acp_mark, c = document.createElement('canvas'); c.width = M.width; c.height = M.height; const x = c.getContext('2d');
  x.drawImage(M, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = col; x.fillRect(0, 0, c.width, c.height); tintC.set(col, c); return c; }
export function shotRising(b, t) {
  const u = ease.outCubic(clamp((b - 64) / 1.6)), push = 1 + 0.03 * Math.max(0, b - 66);
  const A = geoAlbers().scale(lerp(1700, 1500, u) * push).translate([0, 0]).precision(0.6), q = A([lerp(-93, -96.5, u), lerp(39, 38.5, u)]);
  A.translate([540 - q[0], lerp(2040, 1900, u) - q[1]]);
  const gcx = 540, gcy = lerp(1700, 1520, ease.outCubic(clamp((b - 64) / 2))) - 12 * Math.max(0, b - 66), gs = 540 * push;
  // the rays, alternating red and gold, from behind the mark, clipped above the continent's horizon
  g.save(); const sky = new Path2D(); sky.rect(0, 900, W, gcy + 60 - 900); g.clip(sky);
  for (let j = 0; j < 19; j++) { const a0 = Math.PI + j * Math.PI / 19, a1 = a0 + Math.PI / 38, L = (gcy - 960) - gs * 0.5, r0 = gs * 0.5, p = new Path2D();
    p.moveTo(gcx + Math.cos(a0) * r0, gcy + Math.sin(a0) * r0); p.lineTo(gcx + Math.cos(a0) * (r0 + L), gcy + Math.sin(a0) * (r0 + L)); p.lineTo(gcx + Math.cos(a1) * (r0 + L), gcy + Math.sin(a1) * (r0 + L)); p.lineTo(gcx + Math.cos(a1) * r0, gcy + Math.sin(a1) * r0); p.closePath();
    fillP(p, j % 2 ? d(1) : r(1)); }
  g.restore();
  fillP(P2(A, US48), r(1)); g.strokeStyle = k(1); g.lineWidth = 3.5; g.stroke(P2(A, STATE_LINES));
  // the mark: a bare-stock keyline, then press black
  const M = BRAND.acp_mark, mh = gs * M.height / Math.max(M.width, M.height), mw = gs * M.width / Math.max(M.width, M.height), rot = Math.max(0, b - 66) * 0.05;
  const lay = (img, dx, dy) => { g.save(); g.translate(gcx + dx, gcy + dy); g.rotate(rot); g.drawImage(img, -mw / 2, -mh / 2, mw, mh); g.restore(); };
  const PP = tintedMark(PAPER); for (let j = 0; j < 12; j++) lay(PP, Math.cos(j * TAU / 12) * 9, Math.sin(j * TAU / 12) * 9);
  lay(tintedMark(BLK), 0, 0);
  return { misreg: 1.6 + 5 * Math.exp(-(b - 64) * 7) + 4 * (b >= 66 ? Math.exp(-(b - 66) * 7) : 0), flash: b >= 64 && b < 64.07 ? 0.3 : 0 };
}
