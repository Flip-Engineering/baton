// CIVILIZATION c15, b20-34 and b50-62: the world the argument happens on, in solid ink (land black, home red, bases as red roundels, gold arcs).
//   b20 one soldier ships out of Akron to Ramstein: the plant left, then he did . b24-34 the tally on the globe (the count; EIGHTY YEARS; 1945; 2026, NATO)
//   b50 the garrison goes home along the same globe . b52 the board, filling up, row by row . b60 ALL 750 HOME: the arcs converge, the lights come on
import * as K from './empire5.kit.js';
import * as Wd from './empire5.world.js';
import { ticker } from './empire5.shots8.js';
const { P, g, RED, BLK, GOLD, PAPER, TAU, k, r, d, W, H, clamp, lerp, ease, rng, fillP, rect, circle, ring, lineP, strokeP, poly, text, knock, sg } = K;
const fr = K.frame;
const { BASES, TOWN, FLIGHT, view, drawGlobe, drawBases, arcPts, strokeArc, strip, abroad, v3 } = Wd;

const CX = 540, CY = 1280, GR = 470;
const lerpAng = (a, b, f) => a + (b - a) * f;
const bigText = (s, y, size, col) => text(s, 540, y, size, col, { font: 'Anton' });
const label = (s, x, y, size, { align = 'left', col = k(1) } = {}) => { g.font = `${size}px "Oswald"`; g.textAlign = align; g.textBaseline = 'alphabetic'; const tw = g.measureText(s).width;
  const kp = new Path2D(); kp.rect(align === 'right' ? x - tw - 8 : align === 'center' ? x - tw / 2 - 8 : x - 8, y - size + 2, tw + 16, size + 10); knock(kp); g.fillStyle = col; g.fillText(s, x, y); };

// ---------------------------------------------------------------- b20 soldiers ship abroad: from Akron, where the plant was, to Ramstein
export function shotAbroad(b, t) {
  const age = b - 20;
  const V = view(-40, 45, CX, 1300, 470 + 40 * clamp(age / 4));
  drawGlobe(V);
  const ak = TOWN.AKRON, ra = [7.6, 49.44];
  const A = V.ll(ak[0], ak[1]), Rm = V.ll(ra[0], ra[1]);
  const f = ease.inOutCubic(fr(b, 21.0, 23.2));
  const pts = arcPts(V, v3(ak[0], ak[1]), v3(ra[0], ra[1]), 1, 1, 0.2, 40);
  if (f > 0) { const cut = pts.slice(0, Math.max(2, Math.round(f * pts.length))); strokeArc(cut, { w: 11 }); }
  // Akron: the plant's ring, empty, and the man standing in it until he goes
  ring(A[0], A[1], 22, 7, PAPER); ring(A[0], A[1], 22, 4, k(1));
  label('AKRON, OHIO', A[0] + 34, A[1] + 76, 60);
  if (f > 0.97) { circle(Rm[0], Rm[1], 20, PAPER); circle(Rm[0], Rm[1], 15, r(1)); label('RAMSTEIN', Rm[0] + 26, Rm[1] - 40, 58); }
  const idx = Math.min(pts.length - 1, Math.round(f * (pts.length - 1))), pp = f > 0 && f < 1 ? pts[idx] : A;
  if (f < 0.97) { circle(pp[0], pp[1] - 110, 112, PAPER); sg('soldier', pp[0], pp[1] - 6, 230, k(1), { lod: 2 }); }
  ticker(b, t, { pick: ['ARMS  ▲ 3.4', 'DEFENSE  ▲ 3.8', 'PLANT CLOSED  ▲ 6.1', 'RENT  ▲ 4.9'] });
  return { misreg: 1.6 + 3 * Math.exp(-age * 6) };
}

// ---------------------------------------------------------------- b24 the tally: 750 bases on the globe, the years running
export function shotTally(b, t) {
  const age = b - 24;
  const counting = b < 28.5;
  const fill = ease.inOutCubic(fr(b, 24.1, 28.2)), n = b >= 28.4 ? 750 : Math.floor(750 * fill);
  const year = b >= 29.8 ? 2026 : b >= 28.5 ? 1945 + Math.round(81 * ease.outCubic(fr(b, 28.5, 29.8))) : 1945 + Math.round(81 * fill);
  const spin = ease.inOutCubic(fr(b, 24, 28.4));
  const lon = lerp(95, 14, spin), lat = lerp(26, 46, spin);
  const V = view(lon, lat, CX, CY, GR);
  drawGlobe(V);
  let shown = BASES.filter(x => x.i < n);
  if (b >= 30 && b < 32) shown = BASES.filter(x => x.ger).slice(0, 40);
  else if (b >= 32) shown = BASES;
  const pg = x => { if (b >= 28.4) return 0; const a = (x.i - (n - 34)); return a > 0 ? 1 - a / 34 : 0; };
  drawBases(V, shown, { rr: 12, ping: b < 28.4 ? pg : null });
  if (counting) {
    bigText(String(n), 620, 480, r(1));
    text('BASES ABROAD', 540, 770, 140, k(1), { font: 'Anton' });
    strip(null, year);
  } else if (b < 30) { strip(750, year); }
  else if (b < 32) { bigText('1945', 570, 420, k(1)); text('U.S. TROOPS', 540, 705, 118, r(1), { font: 'Anton' }); text('IN GERMANY', 540, 828, 118, k(1), { font: 'Anton' }); strip(null, 1945); }
  else { bigText('2026', 570, 420, r(1)); text('STILL THERE.', 540, 715, 150, k(1), { font: 'Anton' }); text('NATO · 1949–', 540, 805, 76, k(1), { font: 'Oswald' }); strip(750, 2026); }
  const hit = b >= 28.5 ? 6 * Math.exp(-(b - 28.5) * 8) : 0;
  return { misreg: 1.6 + hit + (b >= 30 ? 5 * Math.exp(-(b - 30) * 8) : 0) + (b >= 32 ? 5 * Math.exp(-(b - 32) * 8) : 0) + 3 * Math.exp(-age * 6), flash: b >= 28.5 && b < 28.566 ? 0.3 : 0 };
}

// ---------------------------------------------------------------- the reel: the garrison goes home along the same globe
const PAIRS = [['AVIANO', 'AKRON', 52.2, [12.6, 46.03], 'AKRON', -36, 40], ['RAMSTEIN', 'RICHMOND', 54.2, [7.6, 49.44], 'RICHMOND', -52, 42],
  ['BAHRAIN', 'BUFFALO', 56.2, [50.6, 26.2], 'BUFFALO', -14, 38], ['OKINAWA', 'OKLAHOMA', 58.2, [127.8, 26.4], 'OKLAHOMA', -165, 34]];
const PF = 0.9;
const arrivedAt = (b) => { const m = new Map(); for (const x of BASES) if (b >= x.T) m.set(x.home, (m.get(x.home) || 0) + 1); for (const p of PAIRS) if (b >= p[2]) m.set(p[4], (m.get(p[4]) || 0) + 6); return m; };
function viewAt(b) {
  if (b < 52.0) return [lerp(-26, -36, ease.inOutCubic(fr(b, 50.4, 52))), 40];
  let lon = -36, lat = 40;
  for (let i = 0; i < 4; i++) { const p = PAIRS[i], t0 = p[2] - 0.9; if (b >= t0 - 0.05) { const f = ease.inOutCubic(fr(b, t0 - 0.7, t0 + 0.3)); const prev = i ? [PAIRS[i - 1][5], PAIRS[i - 1][6]] : [-36, 40];
    lon = lerpAng(prev[0], p[5], f); lat = lerp(prev[1], p[6], f); } }
  return [lon, lat];
}
function reel(b, { lonLat = null, R = GR } = {}) {
  const [lon, lat] = lonLat || viewAt(b);
  const V = view(lon, lat, CX, CY, R);
  const arr = arrivedAt(b);
  drawGlobe(V);
  const stay = BASES.filter(x => b < x.D);
  drawBases(V, stay, { rr: 10 });
  for (const x of BASES) { if (x.i % 4 || b < x.D || b >= x.T) continue; const f = ease.inOutCubic((b - x.D) / FLIGHT); const h = TOWN[x.home];
    const pts = arcPts(V, x.v, v3(h[0], h[1]), f, 0.34, 0.12, 18); strokeArc(pts, { w: 5 }); }
  PAIRS.forEach(p => { const t1 = p[2] + 0.1, t0 = t1 - PF; if (b < t0) return; const h = TOWN[p[4]], f = ease.outCubic(clamp((b - t0) / PF));
    const pts = arcPts(V, v3(p[3][0], p[3][1]), v3(h[0], h[1]), f, 1, 0.16, 30); strokeArc(pts, { w: 9 });
    if (b < t1 + 0.3) { const q = V.ll(p[3][0], p[3][1]); if (q[2] > 0.05 && b < t1) { g.strokeStyle = k(1); g.lineWidth = 6; g.beginPath(); g.arc(q[0], q[1], 20, 0, TAU); g.stroke(); } } });
  for (const [nm, c] of arr) { const q = V.ll(TOWN[nm][0], TOWN[nm][1]); if (q[2] < 0.05) continue; const rr = Math.min(9 + c * 0.9, 26); circle(q[0], q[1], rr + 5, k(1)); circle(q[0], q[1], rr, d(1)); }
  return { V, count: abroad(b) };
}

// ---------------------------------------------------------------- b50 we're coming home: the arcs reeled in
export function shotPeel(b, t) {
  const { count } = reel(b);
  strip(count, null);
  return { misreg: 1.6 + 6 * Math.exp(-(b - 50) * 7) };
}

// ---------------------------------------------------------------- b52 the board: each pair flips as its arc lands, and stays; the board fills up
const hashc = (a, bb) => { const x = Math.sin(a * 127.1 + bb * 311.7) * 43758.5453; return x - Math.floor(x); };
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function tileRow(name, y0, state, { ph }) {
  const TW = 108, TH = 140, GAP = 14, n = 8, x0 = (W - (n * TW + (n - 1) * GAP)) / 2;
  const off = Math.floor((n - name.length) / 2);
  for (let i = 0; i < n; i++) {
    const x = x0 + i * (TW + GAP), ch = name[i - off] || '';
    let col = k(1), letter = '', sq = 1;
    if (state === 0) { letter = ch; }
    else if (state === 2) { const lp = clamp(ph * 1.6 - i * 0.07); if (lp <= 0) { letter = ''; } else if (lp >= 1) { col = r(1); letter = ch; } else { letter = ch ? LETTERS[Math.floor(hashc(i, Math.floor(lp * 6)) * 26)] : ''; sq = Math.abs(Math.cos(lp * Math.PI)); } }
    else if (state === 3) { col = r(1); letter = ch; }
    const hh = TH * Math.max(0.12, sq), yy = y0 + (TH - hh) / 2;
    rect(x, yy, TW, hh, col);
    if (letter && sq > 0.5) text(letter, x + TW / 2, yy + hh * 0.5 + 52 * Math.min(1, sq), 146 * Math.min(1, sq), PAPER, { font: 'Anton' });
  }
}
export function shotBoard(b, t) {
  const { count } = reel(b);
  let pi = 0; PAIRS.forEach((p, i) => { if (b >= p[2] - 0.2) pi = i; });
  const [from, to, tf] = PAIRS[pi], y0 = 70;
  rect(0, 0, W, 800, PAPER);
  tileRow(from, y0, 0, {});
  const ph = clamp((b - tf) / 0.55), st = b < tf ? 1 : ph < 1 ? 2 : 3;
  tileRow(to, y0 + 170, st, { ph });
  poly([[540 - 30, y0 + 142], [540 + 30, y0 + 142], [540, y0 + 168]], d(1));
  let row = 0;
  PAIRS.forEach((p, i) => { if (i >= pi) return; const yy = 470 + row * 86; row++;
    text(p[0], 80, yy, 72, k(1), { font: 'Anton', align: 'left' }); text('›', 540, yy - 6, 70, d(1), { font: 'Anton' }); text(p[1], W - 80, yy, 66, r(1), { font: 'Anton', align: 'right' }); });
  strip(count, null);
  const last = PAIRS.reduce((m, p) => b >= p[2] && b - p[2] < 0.07 ? p[2] : m, -1);
  return { misreg: 1.6 + (last > 0 ? 5 * Math.exp(-(b - last) * 10) : 0) };
}

// ---------------------------------------------------------------- b60 ALL 750 HOME: the last arcs converge, the continent lights
export function shotHomes(b, t) {
  const f = ease.outCubic(fr(b, 60.0, 61.0));
  const lon = lerp(-36, -97, ease.inOutCubic(fr(b, 59.4, 61.2))), lat = lerp(40, 38, f);
  const { V } = reel(Math.min(b, 60.0 + 1.3), { lonLat: [lon, lat], R: lerp(GR, 600, ease.inOutCubic(fr(b, 60.0, 61.4))) });
  const lights = Wd.LIGHTS;
  if (lights && b > 60.1) { const n = Math.floor(lights.length * ease.outCubic(fr(b, 60.2, 61.6))), pth = new Path2D();
    for (let i = 0; i < n; i++) { const p = V.ll(lights[i][0], lights[i][1]); if (p[2] < 0.1) continue; pth.moveTo(p[0] + 4.6, p[1]); pth.arc(p[0], p[1], 4.6, 0, TAU); }
    g.fillStyle = d(1); g.fill(pth); }
  strip(0, null, { gold: true });
  return { misreg: 1.6 + 6 * Math.exp(-(b - 60) * 7), flash: b - 60 < 0.066 ? 0.3 : 0 };
}
