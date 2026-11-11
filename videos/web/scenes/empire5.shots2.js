// CIVILIZATION v12, b12-50: rents, factories, the troopship, the wall of 750, the strings, the hand, the peel, the board, the homes.
import * as K from './empire5.kit.js';
import { gilt, temple } from './empire5.shots1.js';
import { drawHand } from './empire5.hand.js';
const { P, g, RED, BLK, GOLD, PAPER, TAU, k, r, d, W, H, clamp, lerp, ease, rng, fillP, rect, circle, ring, lineP, strokeP, poly, text, knock, mkPath, rectPath, circPath, xf, sg, sign, signAt, signOut } = K;
const fr = K.frame;
const BAR = (x, y, w, h, col) => rect(x, y, w, h, col);

// ---------------------------------------------------------------- b12 rents: five houses, five towers of coin
export function shotRents(b, t) {
  const age = b - 12, base = 1800;
  rect(0, base, W, H - base, k(1));
  const X = [140, 345, 550, 755, 960], RATE = [0.9, 1.3, 0.6, 1.5, 1.0];
  X.forEach((x, i) => {
    const n = Math.min(14, Math.floor(age * 3.4 * RATE[i] * 1.0 + (age > 0.05 ? 1 : 0)));
    const topY = base - 306;
    for (let c = 0; c < n; c++) { const cy = topY - 50 - c * 36; circle(x, cy, 52, k(1)); circle(x, cy, 47, d(1)); ring(x, cy, 36, 3, k(1)); }
    // the top coin of a stack is lit: a star, to read as a coin and not a disc
    if (n > 0) { const cy = topY - 50 - (n - 1) * 36; const p = new Path2D(); for (let j = 0; j < 10; j++) { const rr = j % 2 ? 7 : 18, a = -Math.PI / 2 + j * Math.PI / 5; j ? p.lineTo(x + rr * Math.cos(a), cy + rr * Math.sin(a)) : p.moveTo(x + rr * Math.cos(a), cy + rr * Math.sin(a)); } p.closePath(); fillP(p, k(1)); }
    sg('rent', x, base, 300, k(1), { lod: 2 });
  });
  return { misreg: 1.6 + 3 * Math.exp(-age * 6) };
}

// ---------------------------------------------------------------- b16 factories ship out: six factories, a red field, leaving in bands
export function shotFactories(b, t) {
  const age = b - 16, base = 1830;
  rect(0, 1090, W, base - 1090, r(1));
  rect(0, base, W, H - base, k(1));
  const POS = [[190, 1470], [540, 1470], [890, 1470], [190, 1820], [540, 1820], [890, 1820]];
  const ORDER = [2, 5, 1, 4, 0, 3];
  POS.forEach(([x, y], i) => {
    const li = ORDER.indexOf(i), p = fr(age, 0.5 + li * 0.42, 1.0 + li * 0.42);
    if (p >= 1) return;
    g.save(); g.fillStyle = k(1); signOut(g, 'factory', x, y, 300, p, { pitch: 14, lod: 2 }); g.restore();
  });
  return { misreg: 1.6 + 3 * Math.exp(-age * 6) };
}

// ---------------------------------------------------------------- b20 the troopship: head on, red on a black sea, a gold sun behind
export function shotShip(b, t) {
  const age = b - 20, z = 1 + 0.04 * age, wl = 1600;
  rect(0, 960, W, wl - 960, d(0.5));
  g.save(); g.translate(540, wl); g.scale(z, z); g.translate(-540, -wl);
  // the sea, black, ruled with paper waves
  g.restore();
  const bw = 620 * z;
  g.save(); g.fillStyle = r(1); sign(g, 'bow', 540, wl + 6, bw, { lod: 2 }); g.restore();
  // her outline
  rect(0, wl, W, H - wl, k(1));
  g.strokeStyle = PAPER; g.lineWidth = 7;
  for (let j = 0; j < 7; j++) { const y = wl + 40 + j * 52 + (j % 2) * 10, ph = t * 1.5 + j * 1.7; g.beginPath(); for (let x = -20; x <= W + 20; x += 24) { const yy = y + Math.sin(x * 0.02 + ph) * 6; x === -20 ? g.moveTo(x, yy) : g.lineTo(x, yy); } g.stroke(); }
  return { misreg: 1.6 + 3 * Math.exp(-age * 6) };
}

// ---------------------------------------------------------------- the wall: 750 signs, 30 across, 25 down, in one grid
export const WC = 30, WR = 25, PXs = 36, PYs = 40, WY0 = 880, WSH = 32;
const wallXY = i => { const c = i % WC, rw = Math.floor(i / WC); return [PXs * (c + 0.5), WY0 + PYs * (rw + 1) - 5]; };
// the wall's own base sign: a bold barracks under a bold flag (signs.js's lod-0 base has a pole 1 px wide at this size)
const WBASE = (() => { const q = new Path2D(); q.rect(8, -30, 84, 30); q.moveTo(0, -28); q.lineTo(50, -52); q.lineTo(100, -28); q.closePath();
  q.rect(45, -100, 10, 60); q.moveTo(55, -100); q.lineTo(98, -100); q.lineTo(98, -70); q.lineTo(55, -70); q.closePath();
  const cut = new Path2D(); cut.moveTo(44, -4); cut.lineTo(56, -4); cut.lineTo(56, -22); cut.lineTo(44, -22); cut.closePath(); q.addPath(cut); return { path: q, w: 100 }; })();
export function wallPath(name, from, to) {
  const p = new Path2D(), { path, w } = name === 'base' ? WBASE : K.signPath(name, 0), s = WSH / 100;
  for (let i = from; i < to; i++) { const [x, y] = wallXY(i); p.addPath(path, new DOMMatrix().translateSelf(x - w * s / 2, y).scaleSelf(s, s)); }
  return p;
}
function bigNum(s0, y, size, col) { text(s0, 540, y, size, col, { font: 'Anton' }); }
export function shotTally(b, t) {
  const age = b - 24, fill = ease.inOutCubic(fr(b, 24.1, 27.6)), n = Math.min(750, Math.floor(750 * fill));
  if (b >= 28 && b < 28.4) { fillP(wallPath('base', 0, 750), k(1)); }
  else if (b < 28.4) {
    fillP(wallPath('base', 0, n), k(1));
    bigNum(String(n), 660, 560, r(1));
    text('BASES ABROAD', 540, 840, 150, k(1), { font: 'Anton' });
  } else {
    // the dates, as hard cuts on the same image: 1945, then 2026
    fillP(wallPath('base', 0, 750), k(1));
    const second = b >= 29.1;
    if (!second) { bigNum('1945', 560, 420, k(1)); text('U.S. TROOPS', 540, 690, 120, r(1), { font: 'Anton' }); text('IN GERMANY', 540, 815, 120, k(1), { font: 'Anton' }); }
    else { bigNum('2026', 560, 420, r(1)); text('STILL THERE.', 540, 730, 150, k(1), { font: 'Anton' }); text('750 BASES ABROAD', 540, 830, 90, k(1), { font: 'Anton' }); }
  }
  return { misreg: 1.6 + (b >= 28 && b < 28.6 ? 6 * Math.exp(-(b - 28) * 8) : 0) + 3 * Math.exp(-age * 6) };
}

// ---------------------------------------------------------------- b30 the planned economy: the exchange, and three strings
export function shotPlanned(b, t) {
  const age = b - 30, hit = b >= 32 ? Math.exp(-(b - 32) * 7) : 0;
  const by = 1290; temple(540, by, 640, 360, { cols: 6, label: null, flute: false });
  const pup = [[200, 1870, 'rent', 380], [540, 1870, 'factory', 340], [880, 1870, 'soldier', 400]];
  const src = [[380, by - 30], [540, by - 30], [700, by - 30]];
  pup.forEach(([x, y, nm, h], i) => {
    const bob = Math.sin(t * 6 + i * 2) * 5 * (b >= 32 ? 1.5 : 1) - 22 * hit * (i === 1 ? 1 : 0.6);
    const top = y - h + bob, tp = [x, top + 24];
    lineP([src[i], tp], k(1), 16); lineP([src[i], tp], d(1), 8);
    const q = ((age * 2 + i * 0.33) % 1), px = lerp(src[i][0], tp[0], q), py = lerp(src[i][1], tp[1], q); circle(px, py, 17, k(1)); circle(px, py, 11, PAPER); circle(px, py, 7, d(1));
    sg(nm, x, y + bob, h, k(1), { lod: 2 });
  });
  return { misreg: 1.6 + 6 * Math.exp(-age * 6) + 6 * hit };
}

// ---------------------------------------------------------------- b34 expropriate: the hand takes the gold
export function shotHand(b, t) {
  const age = b - 34, frz = b >= 37.0;
  // the exchange, smaller, with the planners' gold at its foot
  const by = 1020; temple(540, by, 560, 330, { cols: 6, label: 'WALL ST', labelSize: 44 });
  const heap = new Path2D(); heap.moveTo(250, by + 6); heap.quadraticCurveTo(540, by - 150, 830, by + 6); heap.closePath();
  const goneP = fr(b, 35.7, 36.4), heapScale = 1 - goneP;
  if (heapScale > 0.02) { g.save(); g.translate(540, by + 6); g.scale(1, heapScale); g.translate(-540, -by - 6); fillP(heap, d(1)); strokeP(heap, k(1), 5); g.restore(); }
  const rise = ease.outCubic(clamp(age / 0.9)), close = ease.inOutCubic(clamp((b - 36.0) / 0.9)), pool = ease.outCubic(clamp((b - 34.8) / 1.0));
  const spill = clamp((b - 36.5) / 0.25) * (1 - clamp((b - 37.4) / 0.5));
  const S = 430 * (1 + 0.04 * age);
  const ret = drawHand({ rise, close, pool, S, cx0: 540, cy0: 1500, t, frz, spillT: spill });
  // the gold from the exchange runs down into the palm: one stream, a few coins falling in it
  const pour = clamp((b - 34.5) / 1.2);
  if (pour > 0 && ret.any && close < 0.85) { const p0 = [540, by - 20], p1 = [ret.palm[0], ret.palm[1] - 30], e = pour, R = rng(11);
    const pts = []; for (let j = 0; j <= 20; j++) { const f = j / 20 * e; pts.push([lerp(p0[0], p1[0], f) + Math.sin(f * 9 + t * 4) * 16 * f, lerp(p0[1], p1[1], f)]); }
    lineP(pts, k(1), 30); lineP(pts, d(1), 20);
    for (let c = 0; c < 6; c++) { const q = ((t * 1.3 + c / 6) % 1) * e, cx = lerp(p0[0], p1[0], q) + Math.sin(q * 9 + t * 4) * 16 * q + (R() - 0.5) * 40, cy = lerp(p0[1], p1[1], q); circle(cx, cy, 22, k(1)); circle(cx, cy, 16, d(1)); } }
  const shake = frz ? 1.5 + 9 * clamp((b - 37.0) / 0.6) ** 2 : 0;
  return { misreg: 1.6 + (b >= 36.0 && b < 37.0 ? 3 * close * (1 - close) * 4 : 0), shake, freeze: frz, flash: age < 0.05 ? 0.2 : 0 };
}

// ---------------------------------------------------------------- b38.3 guard duty's over: the wall peels, then homes come
export function shotPeel(b, t) {
  // b38.3-40 the bases go row by row from the top; b40-42 the homes come up from the bottom
  const peel = clamp((b - 38.6) / 1.3), rowsGone = Math.floor(peel * WR);
  const baseFrom = rowsGone * WC;
  if (b < 40) fillP(wallPath('base', baseFrom, 750), k(1));
  const hp = fr(b, 40.2, 42.0), homes = Math.floor(hp * 0.45 * 750 / WC) * WC;
  if (homes > 0) fillP(wallPath('home', 750 - homes, 750), r(1));
  return { misreg: 1.6 + 6 * Math.exp(-(b - 38.3) * 7) };
}

// ---------------------------------------------------------------- b42 the arrivals board: four pairs, flipped in place
const PAIRS = [['AVIANO', 'AKRON', 42.2], ['RAMSTEIN', 'RICHMOND', 43.7], ['BAHRAIN', 'BUFFALO', 45.2], ['OKINAWA', 'OKLAHOMA', 46.7]];
const hashc = (a, bb) => { const x = Math.sin(a * 127.1 + bb * 311.7) * 43758.5453; return x - Math.floor(x); };
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function tileRow(name, y0, state, { tint, ph }) {   // state: 0 base name (black tiles); 1 blank; 2 flipping (ph 0..1); 3 arrived (red)
  const TW = 108, TH = 140, GAP = 14, n = 8, x0 = (W - (n * TW + (n - 1) * GAP)) / 2;
  for (let i = 0; i < n; i++) {
    const x = x0 + i * (TW + GAP), ch = name[i] || '';
    let col = k(1), letter = '', sq = 1;
    if (state === 0) { col = k(1); letter = ch; }
    else if (state === 1) { col = k(1); letter = ''; }
    else if (state === 2) { const lp = clamp(ph * 1.6 - i * 0.07); if (lp <= 0) { col = k(1); letter = ''; } else if (lp >= 1) { col = r(1); letter = ch; } else { col = k(1); letter = LETTERS[Math.floor(hashc(i, Math.floor(lp * 6)) * 26)]; sq = Math.abs(Math.cos(lp * Math.PI * 3)); } }
    else { col = r(1); letter = ch; }
    const hh = TH * Math.max(0.12, sq), yy = y0 + (TH - hh) / 2;
    rect(x, yy, TW, hh, col);
    if (letter && sq > 0.5) text(letter, x + TW / 2, yy + hh * 0.5 + 54 * Math.min(1, sq), 150 * Math.min(1, sq), PAPER, { font: 'Anton' });
  }
}
export function shotBoard(b, t) {
  const BY0 = 250, PITCH = 372;
  PAIRS.forEach(([from, to, tf], i) => {
    const y0 = BY0 + i * PITCH;
    tileRow(from, y0, 0, {});
    const ph = clamp((b - tf) / 0.55), st = b < tf ? 1 : ph < 1 ? 2 : 3;
    tileRow(to, y0 + 190, st, { ph });
    // the word between the two rows: a gold chevron pointing down, the arrow of the line
    const cy = y0 + 160, ax = 540;
    poly([[ax - 36, cy - 10], [ax + 36, cy - 10], [ax, cy + 22]], d(1));
  });
  const last = PAIRS.reduce((m, p) => b >= p[2] && b - p[2] < 0.07 ? p[2] : m, -1);
  return { misreg: 1.6 + (last > 0 ? 5 * Math.exp(-(b - last) * 10) : 0) };
}

// ---------------------------------------------------------------- b48 all 750 home: the wall of homes, complete
export function shotHomes(b, t) {
  const hp = fr(b, 48.0, 48.7), homes = Math.floor(lerp(0.45, 1, ease.outCubic(hp)) * 750 / WC) * WC;
  fillP(wallPath('home', 750 - homes, 750), r(1));
  return { misreg: 1.6 + 6 * Math.exp(-(b - 48) * 7), flash: b - 48 < 0.066 ? 0.3 : 0 };
}
