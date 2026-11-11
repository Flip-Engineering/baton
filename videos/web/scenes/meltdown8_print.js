// MELTDOWN v10: the piece's 2D worlds, drawn on canvas and composited over (or into) the GL cloud.
//   board()      the split-flap price board (SEARCH b0-11, PERIOD b21-24): every cell a price, swept by the search
//                beam; each cell the beam pings flips red and is pulled into the centre. b8: the cells flip to
//                machines (EVERY MACHINE.). b21: every price flips to $0.00 on one hit.
//   facade()     the exchange: a columned temple front, no names, no marks. 'gold' in BIRTH (the gold pours out of
//                its door), 'ice' in FREEZE (fragments, then the whole front) and the MELT (it comes apart in chunks
//                along the three cracks and falls as light).
//   crowd()      the Klutsis sea: hundreds of raised hands and forearms in backlit silhouette under the one hand.
//   impact()     the two-tone impact frame (art_research §post IMPACT), with radial speed lines.
// Built for this piece only; stateless in t.
import { W, H, C, clamp, lerp, ease, rng } from '../lib/kit.js';

const TAU = Math.PI * 2;
const hsh = (a, b = 0) => { let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x9e37, 0x165667b1); h = Math.imul(h ^ h >>> 15, 0x85ebca6b); h ^= h >>> 13; return ((h >>> 0) % 100000) / 100000; };
const sm = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// ================================================================ the board
export const BOARD = { cols: 16, rows: 17, cw: 58, ch: 98, px: 66, py: 112 };
BOARD.x0 = (W - BOARD.cols * BOARD.px + (BOARD.px - BOARD.cw)) / 2; BOARD.y0 = (H - BOARD.rows * BOARD.py + (BOARD.py - BOARD.ch)) / 2;
const FLAP = '0123456789$.,+-%';
function priceRow(r, k) {                      // 16 chars: '$' + 8-char price + ' ' + 6-char change
  const R = rng(r * 131 + k * 7 + 3), v = Math.pow(10, 1 + R() * 3.2) * (0.5 + R());
  const p = v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const ch = ((R() - 0.45) * 9).toFixed(1); const cs = (ch[0] === '-' ? '' : '+') + ch + '%';
  return ('$' + p.padStart(8)).slice(-9) + ' ' + cs.padStart(6);
}
const ZERO = '$    0.00   0.0%';
const CELLS = [];
for (let r = 0; r < BOARD.rows; r++) for (let c = 0; c < BOARD.cols; c++) {
  const i = r * BOARD.cols + c;
  CELLS.push({ r, c, i, x: BOARD.x0 + c * BOARD.px, y: BOARD.y0 + r * BOARD.py,
    upd: 0.9 + hsh(i, 1) * 2.6, ph: hsh(i, 2) * 3,        // ticker updates: every 0.9-3.5 s a 0.12 s flip
    lap: hsh(i, 3) < 0.55 ? 0 : 1, hit: hsh(i, 4) < 0.62, fly: 0.35 + hsh(i, 5) * 0.55 });
}
// tPing(cell) from the scene: the time the beam's sweep crosses the cell (null: never)
export function boardPings(timeAt) { for (const k of CELLS) k.tp = k.hit ? timeAt((k.x + BOARD.cw / 2 + 60) / 1180 + k.lap) : null; }
export const beamX = A => -60 + ((A * 2 / TAU) % 1) * 1180;

// glyph cell: one split-flap tile with its char; flip = 0..1 progress of a flip in progress (-1 none)
function tile(g, x, y, ch, col, flip, lit = 0) {
  const { cw, ch: hh } = BOARD;
  g.fillStyle = lit > 0 ? `rgb(${24 + 60 * lit},${10 + 6 * lit},${12 + 6 * lit})` : '#141011'; g.fillRect(x, y, cw, hh);
  g.fillStyle = 'rgba(255,255,255,0.045)'; g.fillRect(x, y, cw, 3);
  if (ch !== ' ') { g.fillStyle = col; g.fillText(ch, x + cw / 2, y + hh / 2 + 4); }
  if (flip >= 0) {
    const s = Math.cos(flip * Math.PI);
    g.save(); g.beginPath(); g.rect(x, y, cw, hh / 2); g.clip();
    g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(x, y, cw, hh / 2);
    g.translate(0, y + hh / 2); g.scale(1, Math.max(0.03, Math.abs(s))); g.fillStyle = '#2a2020'; g.fillRect(x, -hh / 2, cw, hh / 2);
    g.restore();
  }
  g.fillStyle = '#000'; g.fillRect(x, y + hh / 2 - 1.5, cw, 3);
}

// board(g, t, o): o.mode 'search' | 'zero'; o.A beam angle; o.cam [sx, shear, tx, ty, rot]; o.zeroT the hit;
// o.pull (0..1: everything left flies to the centre, b10-11.25); o.alpha
export function board(g, t, o) {
  const { cw } = BOARD, cam = o.cam || [1, 0, 0, 0, 0], cx = W / 2, cy = H * 0.47;
  g.save(); g.globalAlpha = o.alpha ?? 1;
  g.fillStyle = '#050304'; if ((o.alpha ?? 1) >= 1 && !o.clear) g.fillRect(0, 0, W, H);
  g.translate(cx + cam[2], cy + cam[3]); g.rotate(cam[4]); g.transform(cam[0], cam[1] * 0.3, cam[1], cam[0], 0, 0); g.translate(-cx, -cy);
  g.font = `${Math.round(cw * 1.42)}px "Anton"`; g.textAlign = 'center'; g.textBaseline = 'middle';
  const flying = [];
  for (const k of CELLS) {
    const rowS = o.mode === 'zero' ? ZERO : priceRow(k.r, Math.floor((t + k.ph) / k.upd));
    let chr = rowS[k.c], col = k.c === 0 ? '#9a8d7a' : C.cream, flip = -1, lit = 0;
    const ut = (t + k.ph) % k.upd; if (ut < 0.12 && o.mode !== 'zero') { flip = ut / 0.12; chr = FLAP[Math.floor(hsh(k.i, Math.floor(t * 24)) * FLAP.length)]; }
    if (rowS[k.c] === '-' || (rowS[14] === '-' && k.c > 9)) col = '#e8a090';
    if (o.mode === 'zero') {                                         // every cell lands on zero on the hit
      const a = t - o.zeroT;
      if (a < 0) { chr = FLAP[Math.floor(hsh(k.i, Math.floor(t * 30)) * FLAP.length)]; flip = (t * 30) % 1; }
      else { col = rowS[k.c] === ' ' ? col : '#ff2a3a'; lit = Math.exp(-a * 5) * (rowS[k.c] === ' ' ? 0.2 : 1); }
    } else if (k.tp != null && t >= k.tp) {                          // pinged: flips red, then is pulled to the centre
      const a = t - k.tp;
      col = '#ff2436'; lit = Math.exp(-a * 3.5);
      if (a < 0.12) { flip = a / 0.12; }
      if (a > k.fly) { flying.push([k, a - k.fly, chr]); g.fillStyle = '#070506'; g.fillRect(k.x, k.y, cw, BOARD.ch); continue; }
    }
    if (o.pull > 0) { const d = hsh(k.i, 9) * 0.5; if (o.pull > d) { flying.push([k, (o.pull - d) * 1.4, chr, 1]); g.fillStyle = '#070506'; g.fillRect(k.x, k.y, cw, BOARD.ch); continue; } }
    tile(g, k.x, k.y, chr, col, flip, lit);
  }
  // cells in flight: a spiral into the centre, shrinking, red-hot
  for (const [k, a, chr, pulled] of flying) {
    const u = clamp(a / (pulled ? 0.8 : 0.7)); if (u >= 1) continue;
    const e = ease.inOutCubic(u), ang = e * (2.2 + hsh(k.i, 6)), px = k.x + cw / 2, py = k.y + BOARD.ch / 2;
    const dx = px - cx, dy = py - cy, cs = Math.cos(ang), sn = Math.sin(ang), f = 1 - e;
    const x = cx + (dx * cs - dy * sn) * f, y = cy + (dx * sn + dy * cs) * f, s = 1 - 0.85 * e;
    g.save(); g.translate(x, y); g.rotate(ang * 1.5); g.scale(s, s);
    g.globalCompositeOperation = 'lighter'; g.fillStyle = `rgba(255,40,50,${0.5 * (1 - u)})`; g.fillRect(-cw * 0.7, -BOARD.ch * 0.6, cw * 1.4, BOARD.ch * 1.2);
    g.globalCompositeOperation = 'source-over'; tile(g, -cw / 2, -BOARD.ch / 2, chr, '#ff4050', -1, 1 - u);
    g.restore();
  }
  // the search beam: a vertical sheet of blue-white light swept across the board
  if (o.A != null && o.beam > 0) {
    const bx = beamX(o.A);
    g.globalCompositeOperation = 'lighter';
    const gr = g.createLinearGradient(bx - 260, 0, bx + 30, 0);
    gr.addColorStop(0, 'rgba(60,110,255,0)'); gr.addColorStop(0.8, `rgba(90,150,255,${0.28 * o.beam})`); gr.addColorStop(0.97, `rgba(200,225,255,${0.9 * o.beam})`); gr.addColorStop(1, 'rgba(200,225,255,0)');
    g.fillStyle = gr; g.fillRect(bx - 260, -200, 290, H + 400);
    g.fillStyle = `rgba(235,245,255,${o.beam})`; g.fillRect(bx - 3, -200, 5, H + 400);
    g.globalCompositeOperation = 'source-over';
  }
  g.restore();
  if (o.rings) for (const [x, y, age] of o.rings) {                  // the ping rings
    if (age < 0 || age > 0.9) continue;
    g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = `rgba(255,40,60,${0.9 * (1 - age / 0.9)})`; g.lineWidth = 6 * (1 - age);
    g.beginPath(); g.arc(x, y, 30 + age * 520, 0, TAU); g.stroke(); g.restore();
  }
}

// ================================================================ machines (b8: every cell flips to a machine)
const MACH = [
  function factory(g) { g.beginPath(); g.moveTo(0, 100); g.lineTo(0, 55); for (let i = 0; i < 4; i++) { g.lineTo(i * 18 + 12, 40); g.lineTo(i * 18 + 18, 55); } g.lineTo(72, 55); g.lineTo(72, 100); g.fill();
    g.fillRect(76, 18, 9, 82); g.fillRect(89, 30, 8, 70); g.fillRect(72, 64, 28, 36); },
  function crane(g) { g.fillRect(30, 20, 8, 80); g.fillRect(4, 18, 94, 6); g.beginPath(); g.moveTo(34, 18); g.lineTo(40, 4); g.lineTo(46, 18); g.fill(); g.fillRect(84, 24, 2, 38); g.fillRect(79, 62, 12, 8); g.fillRect(18, 94, 34, 6); g.fillRect(6, 24, 12, 10); },
  function turbine(g) { g.beginPath(); g.moveTo(47, 100); g.lineTo(49, 34); g.lineTo(53, 34); g.lineTo(55, 100); g.fill();
    for (let k = 0; k < 3; k++) { g.save(); g.translate(51, 32); g.rotate(k * TAU / 3 + 0.3); g.beginPath(); g.moveTo(-3, 0); g.quadraticCurveTo(-5, -20, 0, -34); g.lineTo(3, 0); g.fill(); g.restore(); }
    g.beginPath(); g.arc(51, 32, 5, 0, TAU); g.fill(); },
  function arm(g) { g.fillRect(20, 88, 44, 12); g.fillRect(34, 70, 16, 20); g.save(); g.translate(42, 72); g.rotate(-0.55); g.fillRect(-6, -46, 12, 50); g.translate(0, -44); g.rotate(1.35); g.fillRect(-5, -38, 10, 40); g.translate(0, -38); g.fillRect(-9, -8, 18, 8); g.fillRect(-9, -18, 4, 12); g.fillRect(5, -18, 4, 12); g.restore();
    g.beginPath(); g.arc(42, 72, 9, 0, TAU); g.fill(); },
  function rack(g) { g.fillRect(22, 4, 56, 96); g.fillStyle = '#140f10'; for (let i = 0; i < 8; i++) g.fillRect(27, 9 + i * 11, 46, 7); g.fillStyle = '#ff2a3a'; for (let i = 0; i < 8; i++) g.fillRect(64, 11 + i * 11, 4, 3); },
  function pylon(g) { g.lineWidth = 3.2; g.beginPath(); g.moveTo(30, 100); g.lineTo(46, 8); g.lineTo(54, 8); g.lineTo(70, 100); g.moveTo(22, 30); g.lineTo(78, 30); g.moveTo(26, 50); g.lineTo(74, 50);
    for (let y = 16; y < 96; y += 14) { const a = 46 - (y - 8) * 0.18, b = 54 + (y - 8) * 0.18, a2 = 46 - (y + 6) * 0.18, b2 = 54 + (y + 6) * 0.18; g.moveTo(a, y); g.lineTo(b2, y + 14); g.moveTo(b, y); g.lineTo(a2, y + 14); }
    g.stroke(); g.fillRect(20, 30, 4, 10); g.fillRect(76, 30, 4, 10); g.fillRect(24, 50, 4, 10); g.fillRect(72, 50, 4, 10); },
  function press(g) { g.fillRect(14, 10, 72, 16); g.fillRect(18, 26, 10, 74); g.fillRect(72, 26, 10, 74); g.fillRect(36, 26, 28, 30); g.fillRect(30, 70, 40, 10); g.fillRect(8, 92, 84, 8); },
  function chip(g) { g.fillRect(24, 24, 52, 52); g.fillStyle = '#140f10'; g.fillRect(34, 34, 32, 32); g.fillStyle = g.strokeStyle; for (let i = 0; i < 6; i++) { g.fillRect(28 + i * 8, 12, 4, 12); g.fillRect(28 + i * 8, 76, 4, 12); g.fillRect(12, 28 + i * 8, 12, 4); g.fillRect(76, 28 + i * 8, 12, 4); } },
];
export function machines(g, t, t0, o = {}) {
  const cols = 3, rows = 5, pw = 346, ph = 372, x0 = (W - cols * pw) / 2 + 6, y0 = (H - rows * ph) / 2 + 6;
  g.save(); g.fillStyle = '#050304'; g.fillRect(0, 0, W, H);
  const zoom = 1 + (t - t0) * 0.05; g.translate(W / 2, H / 2); g.scale(zoom, zoom); g.translate(-W / 2, -H / 2);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, x = x0 + c * pw, y = y0 + r * ph, a = t - t0 - (r * cols + c) * 0.012;
    g.fillStyle = '#120d0e'; g.fillRect(x, y, pw - 12, ph - 12);
    const glow = Math.exp(-Math.max(0, a) * 2.2);
    if (a > 0) {
      g.save(); g.translate(x + 23, y + 30); g.scale(3.0, 3.0);
      const col = i % 3 === 1 ? '#ff2a3a' : C.cream;
      g.fillStyle = col; g.strokeStyle = col; g.shadowColor = '#ff3040'; g.shadowBlur = 12 * glow + 3;
      MACH[(i * 5 + 3) % MACH.length](g); g.restore();
      if (a < 0.1) { const s = Math.cos(a / 0.1 * Math.PI); g.save(); g.beginPath(); g.rect(x, y, pw - 12, (ph - 12) / 2); g.clip(); g.translate(0, y + (ph - 12) / 2); g.scale(1, Math.max(0.03, Math.abs(s))); g.fillStyle = '#2a2020'; g.fillRect(x, -(ph - 12) / 2, pw - 12, (ph - 12) / 2); g.restore(); }
    }
    g.fillStyle = '#000'; g.fillRect(x, y + (ph - 12) / 2 - 2, pw - 12, 4);
    g.fillStyle = `rgba(255,40,50,${0.25 * glow})`; g.fillRect(x, y + ph - 18, pw - 12, 6);
  }
  if (o.beamX != null) { g.globalCompositeOperation = 'lighter'; g.fillStyle = 'rgba(210,230,255,0.9)'; g.fillRect(o.beamX - 3, 0, 5, H); g.globalCompositeOperation = 'source-over'; }
  g.restore();
}

// ================================================================ the exchange facade (local units: 1000 wide, 0..1100 tall)
export const FAC = { w: 1000, h: 1100, cols: [110, 266, 422, 578, 734, 890] };
function facadeShapes() {                    // [path, part]: parts 'wall' 'door' 'step' 'col' 'base' 'cap' 'arch' 'frieze' 'cornice' 'ped' 'tymp'
  const S = [], P = () => new Path2D();
  { const p = P(); p.rect(40, 380, 920, 620); S.push([p, 'wall']); }
  { const p = P(); p.moveTo(466, 1000); p.lineTo(466, 560); p.arc(500, 560, 34, Math.PI, 0); p.lineTo(534, 1000); p.closePath(); S.push([p, 'door']); }
  for (const [y, hw, hh] of [[1000, 480, 34], [1034, 500, 33], [1067, 520, 33]]) { const p = P(); p.rect(500 - hw, y, hw * 2, hh); S.push([p, 'step']); }
  for (const x of FAC.cols) {
    { const p = P(); p.moveTo(x - 42, 980); p.bezierCurveTo(x - 44, 800, x - 40, 560, x - 36, 384); p.lineTo(x + 36, 384); p.bezierCurveTo(x + 40, 560, x + 44, 800, x + 42, 980); p.closePath(); S.push([p, 'col', x]); }
    { const p = P(); p.rect(x - 54, 986, 108, 14); p.ellipse(x, 978, 52, 10, 0, 0, TAU); S.push([p, 'base', x]); }
    { const p = P(); p.rect(x - 62, 340, 124, 12); p.rect(x - 50, 350, 100, 26); p.ellipse(x, 380, 40, 7, 0, 0, TAU); S.push([p, 'cap', x]); }
  }
  { const p = P(); p.rect(20, 290, 960, 50); S.push([p, 'arch']); }
  { const p = P(); p.rect(20, 222, 960, 68); S.push([p, 'frieze']); }
  { const p = P(); p.rect(0, 200, 1000, 22); S.push([p, 'cornice']); }
  { const p = P(); p.moveTo(-10, 200); p.lineTo(500, 34); p.lineTo(1010, 200); p.closePath(); S.push([p, 'ped']); }
  { const p = P(); p.moveTo(70, 186); p.lineTo(500, 58); p.lineTo(930, 186); p.closePath(); S.push([p, 'tymp']); }
  return S;
}
const FSH = facadeShapes();
function detail(g, x, style) {                // per column: fluting, volute spirals, egg-and-dart
  const ice = style === 'ice';
  g.save(); g.lineWidth = 2.2;
  for (let k = -3; k <= 3; k++) { const xx = x + k * 10.5; g.strokeStyle = ice ? 'rgba(10,40,80,0.55)' : 'rgba(0,0,0,0.55)'; g.beginPath(); g.moveTo(xx * 0.995 + x * 0.005, 390); g.lineTo(xx, 975); g.stroke();
    g.strokeStyle = ice ? 'rgba(210,240,255,0.35)' : 'rgba(255,190,90,0.18)'; g.beginPath(); g.moveTo(xx + 3, 390); g.lineTo(xx + 3, 975); g.stroke(); }
  for (const sx of [-1, 1]) {                  // the volutes: a rolled scroll, lit on its upper face, a spiral groove
    const vx = x + sx * 50, vy = 364;
    const gr = g.createRadialGradient(vx - 6, vy - 8, 2, vx, vy, 21);
    gr.addColorStop(0, ice ? 'rgba(235,250,255,0.98)' : 'rgba(255,215,140,0.95)'); gr.addColorStop(0.6, ice ? 'rgba(90,160,220,0.95)' : 'rgba(120,70,20,0.95)'); gr.addColorStop(1, ice ? 'rgba(10,40,90,0.95)' : 'rgba(20,10,4,0.95)');
    g.fillStyle = gr; g.beginPath(); g.arc(vx, vy, 20, 0, TAU); g.fill();
    g.strokeStyle = ice ? 'rgba(6,26,60,0.85)' : 'rgba(0,0,0,0.8)'; g.lineWidth = 2.6; g.beginPath();
    for (let a = 0; a < 3.4 * Math.PI; a += 0.12) { const r = 18 * (1 - a / (3.6 * Math.PI)); const px = vx + Math.cos(a * sx) * r, py = vy + Math.sin(a) * r; if (a === 0) g.moveTo(px, py); else g.lineTo(px, py); }
    g.stroke(); g.fillStyle = ice ? '#eaf8ff' : '#ffd890'; g.beginPath(); g.arc(vx, vy, 3.2, 0, TAU); g.fill();
  }
  g.fillStyle = ice ? 'rgba(220,245,255,0.6)' : 'rgba(255,190,90,0.5)';
  for (let k = -3; k <= 3; k++) { g.beginPath(); g.ellipse(x + k * 13, 360, 4.5, 6, 0, 0, TAU); g.fill(); }
  g.restore();
}
// facadeCanvas(style, scale): the whole front rendered once
export function facadeCanvas(style, s = 1) {
  const c = mk(Math.ceil(FAC.w * s) + 40, Math.ceil(FAC.h * s) + 40), g = c.getContext('2d');
  g.translate(20, 20); g.scale(s, s); drawFacade(g, style); return c;
}
export function drawFacade(g, style, o = {}) {
  const ice = style === 'ice';
  const fillOf = (part, x) => {
    if (part === 'door' || part === 'door2') return ice ? 'rgba(4,14,34,0.95)' : (part === 'door' ? '#ffd27a' : '#6a3a0a');
    if (part === 'wall') { if (!ice) return '#0c0704'; const gr = g.createLinearGradient(0, 380, 0, 1000); gr.addColorStop(0, '#0a2446'); gr.addColorStop(1, '#03101f'); return gr; }
    if (ice) { const gr = g.createLinearGradient(x ? x - 45 : 0, 0, x ? x + 45 : 1000, 0); gr.addColorStop(0, 'rgba(150,215,255,0.95)'); gr.addColorStop(0.45, 'rgba(40,110,190,0.9)'); gr.addColorStop(1, 'rgba(8,32,72,0.95)'); return gr; }
    const gr = g.createLinearGradient(x ? x - 45 : 0, 0, x ? x + 45 : 1000, 0); gr.addColorStop(0, '#3a2210'); gr.addColorStop(0.5, '#1a0f07'); gr.addColorStop(1, '#070403'); return gr;
  };
  for (const [p, part, x] of FSH) {
    g.fillStyle = fillOf(part, x); g.fill(p);
    if (part === 'tymp') { g.fillStyle = ice ? 'rgba(20,60,110,0.9)' : '#120a05'; g.fill(p); }
    if (part === 'cap') detail(g, x, style);
    const rim = ice ? 'rgba(235,250,255,0.95)' : (part === 'door' ? '#fff3cf' : 'rgba(255,190,80,0.85)');
    if (part !== 'wall') { g.strokeStyle = rim; g.lineWidth = part === 'col' ? 2.5 : 3; g.stroke(p); }
  }
  if (!ice) {                                  // uplight from the door onto the undersides
    g.save(); g.globalCompositeOperation = 'lighter';
    const gr = g.createRadialGradient(500, 1000, 20, 500, 900, 560); gr.addColorStop(0, 'rgba(255,190,80,0.55)'); gr.addColorStop(1, 'rgba(255,120,20,0)');
    g.fillStyle = gr; g.fillRect(0, 300, 1000, 800); g.restore();
  } else {                                     // frost, fracture veils and trapped air
    const R = rng(77); g.save(); g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 1400; i++) { const x = R() * 1000, y = 40 + R() * 1060; g.fillStyle = `rgba(200,235,255,${0.08 + 0.3 * R() * R()})`; g.fillRect(x, y, 1 + R() * 2.5, 1 + R() * 2.5); }
    g.strokeStyle = 'rgba(200,240,255,0.22)'; g.lineWidth = 1.2;
    for (let i = 0; i < (o.veils ?? 60); i++) { let x = R() * 1000, y = 60 + R() * 1000; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (R() - 0.5) * 70; y += (R() - 0.5) * 70; g.lineTo(x, y); } g.stroke(); }
    g.restore();
  }
}
// place(fc, cx, cy, width): draw the pre-rendered front at a centre and a width (local units map by width/1000)
export function placeFacade(g, fc, cx, cy, wpx, alpha = 1) {
  const s = wpx / FAC.w, w = fc.width * s * (FAC.w / (fc.width - 40)), h = fc.height * s * (FAC.w / (fc.width - 40));
  g.save(); g.globalAlpha = alpha; g.drawImage(fc, cx - w / 2, cy - h / 2, w, h); g.restore();
}

// the melt (b40-43): the front breaks along the three crack lines (screen y cy[]) and three jagged verticals into 12
// chunks on rigid trajectories; ice heats to gold on the way down and burns out to light
export function toppling(g, fc, rect, t, cyL) {
  const [rx, ry, rw, rh] = rect, xs = [rx - 20, rx + rw * 0.36, rx + rw * 0.66, rx + rw + 20], ys = [ry - 40, ...cyL, ry + rh + 40];
  for (let b = 0; b < 4; b++) for (let c = 0; c < 3; c++) {
    const k = b * 3 + c, R = rng(k * 17 + 5);
    const vx = (c - 1) * 380 + (R() - 0.5) * 300, vy = b === 0 ? -420 : b === 3 ? 260 : -120 + R() * 200, w0 = (R() - 0.5) * 1.6;
    const tt = Math.max(0, t), X = vx * tt, Y = vy * tt + 0.5 * 2600 * tt * tt, rot = w0 * tt;
    const heat = sm(0.05, 0.5, tt), burn = sm(0.55, 1.5, tt);
    if (burn >= 1) continue;
    const pcx = (xs[c] + xs[c + 1]) / 2, pcy = (ys[b] + ys[b + 1]) / 2;
    g.save(); g.translate(pcx + X, pcy + Y); g.rotate(rot); g.translate(-pcx, -pcy);
    g.beginPath();                               // jagged chunk outline
    const J = (x, y, s) => [x + (hsh(k, s) - 0.5) * 36, y + (hsh(k, s + 50) - 0.5) * 18];
    const pts = [J(xs[c], ys[b], 1), J(xs[c + 1], ys[b], 2), J(xs[c + 1], ys[b + 1], 3), J(xs[c], ys[b + 1], 4)];
    g.moveTo(...pts[0]); for (let i = 1; i <= 4; i++) { const a = pts[(i - 1) % 4], bb = pts[i % 4]; g.lineTo((a[0] + bb[0]) / 2 + (hsh(k, i + 9) - 0.5) * 40, (a[1] + bb[1]) / 2 + (hsh(k, i + 19) - 0.5) * 30); g.lineTo(...bb); }
    g.closePath(); g.clip();
    g.globalAlpha = 1 - burn; g.drawImage(fc, rx, ry, rw, rh);
    if (heat > 0) { g.globalCompositeOperation = 'source-atop'; g.fillStyle = `rgba(255,${Math.round(150 + 80 * burn)},${Math.round(60 + 120 * burn)},${0.75 * heat})`; g.fillRect(rx - 400, ry - 400, rw + 800, rh + 800); }
    g.restore();
    if (heat > 0 && burn < 1) {                  // the crack edges burn white
      g.save(); g.translate(pcx + X, pcy + Y); g.rotate(rot); g.translate(-pcx, -pcy); g.globalCompositeOperation = 'lighter';
      g.strokeStyle = `rgba(255,230,170,${0.9 * (1 - burn)})`; g.lineWidth = 5; g.beginPath(); g.moveTo(...pts[0]); for (let i = 1; i <= 4; i++) g.lineTo(...pts[i % 4]); g.stroke(); g.restore();
    }
  }
}

// the gold pour (BIRTH): a molten stream from the exchange's door down through the frame
export function pour(g, t, y0, alpha = 1) {
  g.save(); g.globalAlpha = alpha; g.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 3; k++) {
    const w = [70, 38, 16][k], col = ['rgba(255,140,20,0.35)', 'rgba(255,200,90,0.6)', 'rgba(255,245,210,0.95)'][k];
    g.fillStyle = col; g.beginPath(); g.moveTo(540 - w * 0.6, y0);
    for (let y = y0; y <= H + 40; y += 40) g.lineTo(540 - w * (0.6 + 0.4 * (y - y0) / 900) + Math.sin(y * 0.02 - t * 9 + k) * 6, y);
    for (let y = H + 40; y >= y0; y -= 40) g.lineTo(540 + w * (0.6 + 0.4 * (y - y0) / 900) + Math.sin(y * 0.02 - t * 9 + k + 2) * 6, y);
    g.closePath(); g.fill();
  }
  const R = rng(5);                                   // droplets thrown off the stream
  for (let i = 0; i < 160; i++) { const ph = (R() + t * (0.6 + R())) % 1, x = 540 + (R() - 0.5) * 120 * (0.3 + ph * 2), y = y0 + ph * (H - y0 + 100);
    g.fillStyle = `rgba(255,${190 + R() * 60 | 0},90,${0.8 * (1 - ph)})`; g.fillRect(x, y, 3 + R() * 4, 6 + R() * 12); }
  g.restore();
}

// ================================================================ the crowd of raised hands (payoff), backlit
const HANDS = [];
{ const R = rng(1917);
  const row = (n, y0, y1, s0, s1, far) => { for (let i = 0; i < n; i++) { const d = R(); HANDS.push({ x: -60 + R() * (W + 120), y: lerp(y0, y1, d), s: lerp(s0, s1, d) * (0.85 + 0.3 * R()),
    fist: R() < 0.3, tilt: (R() - 0.5) * 0.32, ph: R(), far, rise: R(), splay: 0.7 + R() * 0.6, arm: 2.6 + R() * 1.4 }); } };
  row(260, 1250, 1330, 7, 12, 2); row(120, 1320, 1470, 13, 26, 1); row(46, 1470, 1860, 30, 58, 0);
  HANDS.sort((a, b) => a.y - b.y); }
function handPath(p, u, fist, splay) {         // a raised right hand in palm units (u px = palm width), wrist at (0,0), up = -y
  p.moveTo(-0.46 * u, 0); p.lineTo(-0.52 * u, -0.95 * u); p.lineTo(0.52 * u, -0.98 * u); p.lineTo(0.46 * u, 0); p.closePath();
  if (fist) { p.roundRect(-0.56 * u, -1.3 * u, 1.12 * u, 0.5 * u, 0.12 * u);
    for (let i = 0; i < 4; i++) { p.moveTo(-0.42 * u + i * 0.28 * u + 0.15 * u, -1.28 * u); p.arc(-0.42 * u + i * 0.28 * u, -1.28 * u, 0.15 * u, 0, TAU); }
    p.ellipse(0.46 * u, -0.8 * u, 0.17 * u, 0.34 * u, -0.5, 0, TAU); return; }
  const F = [[-0.36, 0.72], [-0.12, 0.9], [0.12, 0.96], [0.36, 0.88]];
  F.forEach(([fx, L], i) => { const a = (i - 1.5) * 0.09 * splay, x0 = fx * u, y0 = -0.9 * u, x1 = x0 + Math.sin(a) * L * u, y1 = y0 - Math.cos(a) * L * u, r = 0.12 * u;
    p.moveTo(x0 + r, y0); p.lineTo(x1 + r, y1); p.arc(x1, y1, r, 0, Math.PI, true); p.lineTo(x0 - r, y0); p.closePath(); });
  p.moveTo(0.4 * u, -0.25 * u); p.lineTo(0.86 * u, -0.72 * u); p.arc(0.8 * u, -0.8 * u, 0.12 * u, 0.6, -2.2, true); p.lineTo(0.36 * u, -0.6 * u); p.closePath();
}
// crowd(g, t, o): o.rise 0..1 (the hands come up), o.pump (kick envelope), o.light [x, y] (the hot source), o.rim colour
export function crowd(g, t, o) {
  const [lx, ly] = o.light || [W / 2, 1150], rim = o.rim || '#ffb070';
  g.save();
  if (o.zoom) { const [zs, zx, zy] = o.zoom; g.translate(zx, zy); g.scale(zs, zs); g.translate(-zx, -zy); }
  // the mass of heads and shoulders under the hands, one dark ground from the horizon down
  const gr = g.createLinearGradient(0, 1240, 0, H); gr.addColorStop(0, 'rgba(8,2,3,0)'); gr.addColorStop(0.08, '#0a0203'); gr.addColorStop(1, '#040102');
  g.fillStyle = gr; g.fillRect(0, 1240, W, H - 1240);
  for (const h of HANDS) {
    const up = sm(h.rise * 0.6, h.rise * 0.6 + 0.4, o.rise ?? 1); if (up <= 0) continue;
    const u = h.s, bob = (o.pump || 0) * u * 0.35 * (0.5 + h.ph), lift = (1 - up) * u * (h.arm + 2);
    const bx = h.x, by = h.y + lift - bob;
    // head and shoulders
    g.fillStyle = '#060102';
    if (h.far < 2) { g.beginPath(); g.ellipse(bx - u * 0.9, by + u * 0.4, u * 0.55, u * 0.66, 0, 0, TAU); g.fill(); g.beginPath(); g.ellipse(bx - u * 0.9, by + u * 1.9, u * 1.6, u * 0.9, 0, 0, TAU); g.fill(); }
    // the raised forearm and hand (near vertical: a raised hand, never forward)
    const ang = h.tilt + Math.sin(t * 2.2 + h.ph * 6) * 0.04, L = u * h.arm;
    const p = new Path2D(), m = new DOMMatrix().translate(bx, by).rotate(ang * 57.3).translate(0, -L);
    const q = new Path2D(); q.moveTo(-0.34 * u, 0); q.lineTo(-0.5 * u, L + u * 3); q.lineTo(0.5 * u, L + u * 3); q.lineTo(0.34 * u, 0); q.closePath();
    handPath(q, u, h.fist, h.splay); p.addPath(q, m);
    // rim toward the light, then the body in black
    const dx = lx - bx, dy = ly - by, dl = Math.hypot(dx, dy) || 1, off = Math.max(1.2, u * 0.07);
    g.save(); g.translate(dx / dl * off, dy / dl * off - off * 0.6); g.fillStyle = rim; g.globalAlpha = h.far === 2 ? 0.55 : 0.95; g.fill(p); g.restore();
    g.fillStyle = h.far === 2 ? '#1a0406' : '#050102'; g.fill(p);
  }
  g.restore();
}

// ================================================================ impact frame: two tones, inverted on the 2nd frame, radial lines
export function impact(ctx, k, cx = W / 2, cy = H / 2, dark = '#0b0203', light = '#f4e6d0') {
  if (!k) return;
  const im = ctx.getImageData(0, 0, W, H), d = im.data, n = W * H, hist = new Uint32Array(64);
  for (let i = 0; i < n; i += 7) hist[(d[i * 4] * 0.2126 + d[i * 4 + 1] * 0.7152 + d[i * 4 + 2] * 0.0722) >> 2]++;
  let acc = 0, med = 32; const tot = Math.ceil(n / 7); for (let b = 0; b < 64; b++) { acc += hist[b]; if (acc > tot * 0.55) { med = b; break; } }
  const th = Math.max(med * 4, 40), A = hexRGB(dark), B = hexRGB(light), inv = k === 2;
  for (let i = 0; i < n; i++) { const l = d[i * 4] * 0.2126 + d[i * 4 + 1] * 0.7152 + d[i * 4 + 2] * 0.0722; const on = (l > th) !== inv, c = on ? B : A; d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; }
  ctx.putImageData(im, 0, 0);
  ctx.save(); ctx.fillStyle = inv ? light : dark; const R = rng(k * 31 + 7);
  for (let i = 0; i < 90; i++) { const a = R() * TAU, w = 0.004 + R() * 0.01, r0 = 260 + R() * 380; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a - w) * r0, cy + Math.sin(a - w) * r0); ctx.lineTo(cx + Math.cos(a) * 2400, cy + Math.sin(a) * 2400); ctx.lineTo(cx + Math.cos(a + w) * r0, cy + Math.sin(a + w) * r0); ctx.fill(); }
  ctx.restore();
}
const hexRGB = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

// the emblem's four stripes, measured from the emblem image: [{y0, y1, x0, x1}] in emblem pixels
export function stripeRows(img) {
  const c = mk(img.width, img.height), g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data, x = Math.round(img.width * 0.86), rows = [];
  let on = false, y0 = 0;
  for (let y = 0; y < img.height; y++) { const a = d[(y * img.width + x) * 4 + 3] > 128; if (a && !on) { on = true; y0 = y; } if (!a && on) { on = false; rows.push({ y0, y1: y }); } }
  for (const r of rows) { const ym = Math.round((r.y0 + r.y1) / 2); let x0 = x; while (x0 > 0 && d[(ym * img.width + x0 - 1) * 4 + 3] > 128) x0--; let x1 = x; while (x1 < img.width - 1 && d[(ym * img.width + x1 + 1) * 4 + 3] > 128) x1++; r.x0 = x0; r.x1 = x1; }
  return rows;
}
