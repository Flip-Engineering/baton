// CIVILIZATION c13, b50-68: the build. The plant lights its three shifts; the soldier's helmet becomes a PUBLIC WORKS hard hat on the beat; the Richmond
// slipway has its day board running 244 -> 42; the lights of the continent thicken along the rails and gather into the gear over v12's sunburst.
import { feature, mesh } from '../node_modules/topojson-client/src/index.js';
import { geoAlbers, geoPath } from 'd3-geo';
import * as K from './empire5.kit.js';
import { wipe } from '../lib/fx/printkit.js';
import { LIGHTS } from './empire5.world.js';
const { P, g, RED, BLK, GOLD, PAPER, TAU, k, r, d, W, H, clamp, lerp, ease, rng, BRAND, fillP, rect, circle, ring, lineP, strokeP, poly, text, knock, sg } = K;
const fr = K.frame;
const J = async u => (await fetch(u)).json();
const [tUS, USJ] = await Promise.all([J('../node_modules/us-atlas/states-10m.json'), J('../assets/geo/us.json')]);
const L48 = s => +s.id <= 56 && s.id !== '02' && s.id !== '15';
const US48 = { type: 'FeatureCollection', features: feature(tUS, tUS.objects.states).features.filter(L48) };
const STATE_LINES = mesh(tUS, tUS.objects.states, (a, b) => a !== b && L48(a) && L48(b));
const P2 = (proj, obj) => new Path2D(geoPath(proj)(obj) || '');

// ---------------------------------------------------------------- b50 three shifts: one plant, three lamps, the windows lit shift by shift
export function shotShifts(b, t) {
  const age = b - 50, lit = [age >= 0.4, age >= 0.9, age >= 1.4], punch = [0.4, 0.9, 1.4].reduce((m, x) => age >= x && age - x < 0.12 ? x : m, -1);
  rect(0, 700, W, 1220, d(0.5));
  // the day, as a dial above the plant: three eight-hour sectors that fill in as each shift lights (gold day, red evening, black night)
  { const cx = 540, cy = 420, R = 230; ring(cx, cy, R + 14, 10, k(1));
    const cols = [d(1), r(1), k(1)];
    for (let j = 0; j < 3; j++) { if (!lit[j]) continue; const a0 = -Math.PI / 2 + j * TAU / 3, p = new Path2D(); p.moveTo(cx, cy); p.arc(cx, cy, R, a0, a0 + TAU / 3); p.closePath(); fillP(p, cols[j]); }
    g.strokeStyle = PAPER; g.lineWidth = 7; for (let j = 0; j < 3; j++) { const a = -Math.PI / 2 + j * TAU / 3; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.stroke(); }
    circle(cx, cy, 20, PAPER); ring(cx, cy, 20, 5, k(1)); }
  // the plant: a long shed, five saw-teeth, two stacks; fifteen windows in three groups of five
  const bx = 70, bw = 940, by = 1500, bh = 360;
  const body = new Path2D(); body.rect(bx, by - bh, bw, bh);
  for (let j = 0; j < 5; j++) { const x = bx + j * bw * 0.158 + 6; body.moveTo(x, by - bh); body.lineTo(x, by - bh - 120); body.lineTo(x + bw * 0.158 - 6, by - bh); body.closePath(); }
  body.rect(bx + bw - 130, by - bh - 330, 56, 340); body.rect(bx + bw - 54, by - bh - 250, 46, 260);
  fillP(body, k(1));
  for (let gi = 0; gi < 3; gi++) for (let w = 0; w < 5; w++) { const x = bx + 34 + gi * 300 + w * 52, y = by - bh + 70, ww = 40, hh = 96;
    rect(x - 3, y - 3, ww + 6, hh + 6, PAPER); rect(x, y, ww, hh, lit[gi] ? d(1) : k(0.3)); }
  rect(0, by, W, H - by, k(1));
  // the lamps: 1ST 2ND 3RD, each lit in turn and left lit
  ['1ST', '2ND', '3RD'].forEach((s, i) => { const x = 60 + i * 322, y = 1585, w = 300, h = 270, on = lit[i];
    rect(x, y, w, h, on ? d(1) : k(1)); g.strokeStyle = on ? k(1) : PAPER; g.lineWidth = 8; g.strokeRect(x + 12, y + 12, w - 24, h - 24);
    text(s, x + w / 2, y + 190, 170, on ? k(1) : PAPER, { font: 'Anton' }); });
  return { misreg: 1.6 + 5 * Math.exp(-age * 7) + (punch > 0 ? 5 * Math.exp(-(age - punch) * 12) : 0) };
}

// ---------------------------------------------------------------- b52 every soldier builds: the helmet becomes the hard hat on the beat
function bust(kind, a) {              // kind 'soldier' | 'worker'
  const cx = 540;
  // shoulders and the neck
  const sh = new Path2D(); sh.moveTo(110, 1930); sh.lineTo(110, 1760); sh.bezierCurveTo(110, 1640, 220, 1590, 360, 1560); sh.lineTo(460, 1520); sh.lineTo(620, 1520); sh.lineTo(720, 1560); sh.bezierCurveTo(860, 1590, 970, 1640, 970, 1760); sh.lineTo(970, 1930); sh.closePath();
  fillP(sh, k(1));
  const neck = new Path2D(); neck.rect(470, 1420, 140, 130); fillP(neck, k(1));
  const head = new Path2D(); head.ellipse(cx, 1290, 168, 215, 0, 0, TAU); fillP(head, k(1));
  g.strokeStyle = PAPER; g.lineWidth = 7;
  if (kind === 'soldier') {          // collar, buttons
    g.beginPath(); g.moveTo(430, 1560); g.lineTo(540, 1700); g.lineTo(650, 1560); g.stroke();
    g.beginPath(); g.moveTo(540, 1700); g.lineTo(540, 1930); g.stroke();
    for (const y of [1760, 1830, 1900]) { g.fillStyle = PAPER; g.beginPath(); g.arc(560, y, 9, 0, TAU); g.fill(); }
    // the steel helmet: a dome, a flared rim, a chin strap; kept off the head by a line of bare stock
    const hm = new Path2D(); hm.ellipse(cx, 1240, 232, 200, 0, Math.PI, TAU); hm.lineTo(cx + 262, 1250); hm.quadraticCurveTo(cx + 262, 1278, cx + 226, 1282); hm.lineTo(cx - 226, 1282); hm.quadraticCurveTo(cx - 262, 1278, cx - 262, 1250); hm.closePath();
    knock(hm, 8); fillP(hm, k(1));
    g.strokeStyle = PAPER; g.lineWidth = 6; g.beginPath(); g.moveTo(cx - 200, 1262); g.lineTo(cx + 200, 1262); g.stroke();
    g.strokeStyle = k(1); g.lineWidth = 12; g.beginPath(); g.moveTo(cx - 168, 1285); g.lineTo(cx - 150, 1420); g.moveTo(cx + 168, 1285); g.lineTo(cx + 150, 1420); g.stroke();
  } else {                            // overall straps, and the hard hat
    g.beginPath(); g.moveTo(400, 1570); g.lineTo(420, 1930); g.moveTo(680, 1570); g.lineTo(660, 1930); g.stroke();
    g.fillStyle = PAPER; g.fillRect(380, 1780, 90, 56); g.fillRect(610, 1780, 90, 56);
    const hd = new Path2D(); hd.ellipse(cx, 1262, 226, 218, 0, Math.PI, TAU); hd.lineTo(cx + 262, 1268); hd.lineTo(cx + 262, 1296); hd.lineTo(cx - 262, 1296); hd.lineTo(cx - 262, 1268); hd.closePath();
    knock(hd, 8); fillP(hd, PAPER); strokeP(hd, k(1), 8);
    // the ridge and the band: PUBLIC WORKS cut in the band
    g.strokeStyle = k(1); g.lineWidth = 8; g.beginPath(); g.moveTo(cx, 1046); g.lineTo(cx, 1130); g.stroke();
    g.beginPath(); g.moveTo(cx - 70, 1056); g.quadraticCurveTo(cx - 62, 1100, cx - 66, 1132); g.moveTo(cx + 70, 1056); g.quadraticCurveTo(cx + 62, 1100, cx + 66, 1132); g.stroke();
    rect(cx - 238, 1174, 476, 92, k(1));
    text('PUBLIC WORKS', cx, 1245, 70, PAPER, { font: 'Oswald' });
    rect(cx - 262, 1268, 524, 28, PAPER); strokeP(new Path2D('M' + (cx - 262) + ' 1268 H' + (cx + 262) + ' V1296 H' + (cx - 262) + ' Z'), k(1), 6);
  }
}
export function shotSoldier(b, t) {
  const age = b - 52, p = fr(b, 52.9, 52.94);
  rect(0, 940, W, H - 940, d(0.5));
  circle(540, 1400, 470, r(1));
  bust(p >= 1 ? 'worker' : 'soldier');
  const snap = b >= 52.9 ? Math.exp(-(b - 52.9) * 9) : 0;
  return { misreg: 1.6 + 5 * Math.exp(-age * 7) + 9 * snap, flash: b >= 52.9 && b < 52.97 ? 0.35 : 0, shake: b >= 52.9 && b < 53.2 ? 6 * snap : 0 };
}

// ---------------------------------------------------------------- b60 we build everything: the ship laid keel to launch; the day board on the slipway runs 244 -> 42
export function shotYard(b, t) {
  const age = b - 60, prog = ease.inOutCubic(clamp((age - 0.1) / 1.7)), wl = 1640;
  rect(0, 1080, W, wl - 1080, d(0.5));
  rect(0, wl, W, H - wl, k(1));
  sg('crane', 100, wl, 540, k(1), { lod: 2 }); sg('crane', 990, wl, 470, k(1), { lod: 2, flip: true });
  g.save(); g.clip(wipe(prog, { angle: 0, edge: 'saw', teeth: 11, amp: 36, box: [100, 1300, 980, wl] })); sg('ship', 540, wl + 4, 370, r(1), { lod: 2 }); g.restore();
  g.strokeStyle = PAPER; g.lineWidth = 6;
  for (let j = 0; j < 2; j++) { const y = wl + 30 + j * 40, ph = t * 1.4 + j * 1.9; g.beginPath(); for (let x = -20; x <= W + 20; x += 24) { const yy = y + Math.sin(x * 0.02 + ph) * 5; x === -20 ? g.moveTo(x, yy) : g.lineTo(x, yy); } g.stroke(); }
  // the day board: DAYS ON THE WAYS, the number running down as the hull goes up
  const n = Math.round(lerp(244, 42, ease.inOutCubic(clamp((age - 0.1) / 1.7))));
  rect(50, 1735, W - 100, 170, PAPER); rect(60, 1745, W - 120, 150, k(1));
  text('DAYS ON', 80, 1812, 56, PAPER, { font: 'Oswald', align: 'left' }); text('THE WAYS', 80, 1876, 56, PAPER, { font: 'Oswald', align: 'left' });
  text(String(n), 770, 1872, 150, n <= 42 ? d(1) : PAPER, { font: 'Anton', align: 'right' }); text('DAYS', 800, 1872, 56, PAPER, { font: 'Oswald', align: 'left' });
  return { misreg: 1.6 + 5 * Math.exp(-age * 7) };
}

// ---------------------------------------------------------------- b64 a civilization rising: the continent's lights thicken along the rails and gather into the gear
const tintC = new Map();
function tintedMark(col) { if (tintC.has(col)) return tintC.get(col); const M = BRAND.acp_mark, c = document.createElement('canvas'); c.width = M.width; c.height = M.height; const x = c.getContext('2d');
  x.drawImage(M, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = col; x.fillRect(0, 0, c.width, c.height); tintC.set(col, c); return c; }
const RAIL = Object.values(USJ.rail);
export function shotRising(b, t) {
  const u = ease.outCubic(clamp((b - 64) / 1.6)), push = 1 + 0.03 * Math.max(0, b - 66);
  const A = geoAlbers().scale(lerp(1500, 1230, u) * push).translate([0, 0]).precision(0.6), q = A([-96.5, 38.5]);
  A.translate([540, lerp(2000, 1730, u) - q[1] * 0 - q[1]]);
  const gcx = 540, gcy = lerp(1700, 1520, ease.outCubic(clamp((b - 64) / 2))) - 12 * Math.max(0, b - 66), gs = 540 * push;
  g.save(); const sky = new Path2D(); sky.rect(0, 900, W, gcy + 60 - 900); g.clip(sky);
  for (let j = 0; j < 19; j++) { const a0 = Math.PI + j * Math.PI / 19, a1 = a0 + Math.PI / 38, L = (gcy - 960) - gs * 0.5, r0 = gs * 0.5, p = new Path2D();
    p.moveTo(gcx + Math.cos(a0) * r0, gcy + Math.sin(a0) * r0); p.lineTo(gcx + Math.cos(a0) * (r0 + L), gcy + Math.sin(a0) * (r0 + L)); p.lineTo(gcx + Math.cos(a1) * (r0 + L), gcy + Math.sin(a1) * (r0 + L)); p.lineTo(gcx + Math.cos(a1) * r0, gcy + Math.sin(a1) * r0); p.closePath();
    fillP(p, j % 2 ? d(1) : r(1)); }
  g.restore();
  fillP(P2(A, US48), r(1)); g.strokeStyle = k(1); g.lineWidth = 3.5; g.stroke(P2(A, STATE_LINES));
  // the lights: the rails first (gold lines along the real lines), then the towns, thickening; then the whole lot runs into the gear
  const grow = ease.inOutCubic(fr(b, 64.4, 66.3)), gather = ease.inCubic(fr(b, 66.4, 67.6));
  if (grow > 0 && gather < 1) {
    const rail = new Path2D(); for (const ln of RAIL) { const n = Math.max(2, Math.ceil(ln.length * grow)); ln.slice(0, n).forEach(([lo, la], i) => { const p = A([lo, la]); i ? rail.lineTo(p[0], p[1]) : rail.moveTo(p[0], p[1]); }); }
    g.lineJoin = 'round'; strokeP(rail, k(1), 11); strokeP(rail, d(1), 6);
    const n = Math.floor(LIGHTS.length * grow * 0.55), dots = new Path2D(), dots2 = new Path2D();
    for (let i = 0; i < n; i++) { const p = A([LIGHTS[i][0], LIGHTS[i][1]]); if (p[1] < gcy - 40 && gather === 0) { }
      const x = lerp(p[0], gcx, gather), y = lerp(p[1], gcy, gather), rr = 5.2 * (1 - 0.6 * gather); dots.moveTo(x + rr, y); dots.arc(x, y, rr, 0, TAU); dots2.moveTo(x + rr * 0.62, y); dots2.arc(x, y, rr * 0.62, 0, TAU); }
    g.fillStyle = k(1); g.fill(dots); g.fillStyle = d(1); g.fill(dots2);
  }
  const M = BRAND.acp_mark, mh = gs * M.height / Math.max(M.width, M.height), mw = gs * M.width / Math.max(M.width, M.height), rot = Math.max(0, b - 66) * 0.05;
  const lay = (img, dx, dy) => { g.save(); g.translate(gcx + dx, gcy + dy); g.rotate(rot); g.drawImage(img, -mw / 2, -mh / 2, mw, mh); g.restore(); };
  const lit = b >= 67.5, PP = tintedMark(lit ? GOLD : PAPER); for (let j = 0; j < 12; j++) lay(PP, Math.cos(j * TAU / 12) * (lit ? 13 : 9), Math.sin(j * TAU / 12) * (lit ? 13 : 9));
  lay(tintedMark(BLK), 0, 0);
  return { misreg: 1.6 + 5 * Math.exp(-(b - 64) * 7) + 4 * (b >= 66 ? Math.exp(-(b - 66) * 7) : 0), flash: b >= 64 && b < 64.07 ? 0.3 : 0 };
}
