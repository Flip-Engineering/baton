// CIVILIZATION c15: the guard goes all the way through. This file is everything that happens to him and to the museum's answer:
//   b8   the exchange (the real front, no wires) with the market's ticker under it       . b34 the plan, an order sheet that Wall Street signs
//   b38  the sheet is torn (EXPROPRIATE THE PLANNERS, on the red)                         . b40.6 the gallery, silent: his back
//   b42.3 ABOUT FACE: he turns, the push-in, the face; b48 the helmet comes off, the hard hat goes on
//   b62  the doors open and he walks out into a city that runs; b70 Richmond, 1942; b72 the museum answered
import * as K from './empire5.kit.js';
import { gilt, guardBack } from './empire5.shots1.js';
import { figureFront, workerBack, head } from './empire5.folk.js';
import { wipe } from '../lib/fx/printkit.js';
const { P, g, SIL, RED, BLK, GOLD, PAPER, TAU, k, r, d, W, H, clamp, lerp, ease, rng, fillP, rect, circle, ring, lineP, strokeP, poly, text, knock, mkPath, rectPath, circPath, xf, sg, sign, signAt } = K;
const fr = K.frame;
const P2 = f => { const q = new Path2D(); f(q); return q; };
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
const ART = {};
for (const [kk, f] of [['vermeer', 'met437881_young_woman_with_a_water_pitcher.jpg'], ['harvesters', 'met435809_the_harvesters.jpg'], ['socrates', 'met436105_the_death_of_socrates.jpg']]) ART[kk] = await loadImg('../assets/art_pd/' + f);
function hang(img, x, y, w, h, fx = 0.5, fy = 0.5, zoom = 1) {
  knock(rectPath(x, y, w, h));
  const s = Math.max(w / img.width, h / img.height) * zoom, sw = w / s, sh = h / s;
  P.photo(img, (img.width - sw) * fx, (img.height - sh) * fy, sw, sh, x, y, w, h);
}

// the texts that go on screen outside the type press (the shots' own words)
export const REV_TEXT = ['ABOUT FACE.', 'THE ORDERS NOW COME FROM', 'THE WORKING CLASS.', "GUARD DUTY'S OVER.", 'EXPROPRIATE THE PLANNERS.'];

// ---------------------------------------------------------------- the ticker: the market's reading of the orders, one band at the foot of b8-24
const TAPE = ['RENT  ▲ 4.9', 'PLANT CLOSED  ▲ 6.1', 'ARMS  ▲ 3.4', 'REITS  ▲ 2.2', 'OFFSHORE  ▲ 5.7', 'DEFENSE  ▲ 3.8', 'LANDLORDS  ▲ 4.4', 'SHARE BUYBACK  ▲ 7.0'];
export function ticker(b, t, { y = 1792, h = 100, speed = 260, pick = null } = {}) {
  rect(0, y, W, H - y, k(1)); rect(0, y, W, 6, d(1));
  g.font = '64px "Plex Bold"'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  const items = pick || TAPE, sp = 70; let total = 0; const ws = items.map(s => { const w = g.measureText(s).width + sp; total += w; return w; });
  let x = -((t * speed) % total);
  for (let rep = 0; rep < 3 && x < W + 400; rep++) for (let i = 0; i < items.length; i++) {
    const s = items[i]; const tri = s.indexOf('▲'); const a = tri >= 0 ? s.slice(0, tri) : s, c = tri >= 0 ? s.slice(tri) : '';
    g.fillStyle = PAPER; g.fillText(a, x, y + 70); if (c) { g.fillStyle = d(1); g.fillText(c, x + g.measureText(a).width, y + 70); }
    x += ws[i];
  }
}

// ---------------------------------------------------------------- the exchange: the real front. Six Corinthian columns on a podium and steps, the pediment's
// sculpture group cut in paper, a plain frieze that carries the name. It is the same architecture as the museum's gallery (that is the point).
export function exchange(cx, by, w, h, { label = 'WALL ST', flute = true, tone = k(1), cut = PAPER } = {}) {
  const x0 = cx - w / 2, stepH = h * 0.06, podH = h * 0.06, colH = h * 0.5, capH = h * 0.045, friezeH = h * 0.1, pedH = h * 0.2;
  const body = new Path2D();
  for (let j = 0; j < 4; j++) body.rect(x0 - (3 - j) * w * 0.016, by - (j + 1) * stepH / 4, w + (3 - j) * w * 0.032, stepH / 4 + 0.5);
  const py0 = by - stepH - podH; body.rect(x0, py0, w, podH + 0.5);
  const cy1 = py0, cy0 = cy1 - colH, colW = w * 0.082, xs = [];
  for (let i = 0; i < 6; i++) { const x = x0 + w * 0.075 + (i + 0.5) * (w * 0.85) / 6; xs.push(x); body.rect(x - colW / 2, cy0 + capH, colW, colH - capH);
    body.rect(x - colW * 0.74, cy0, colW * 1.48, capH * 0.6); body.rect(x - colW * 0.6, cy0 + capH * 0.6, colW * 1.2, capH * 0.4);       // the capital: abacus and a deeper bell
    body.rect(x - colW * 0.64, cy1 - capH * 0.5, colW * 1.28, capH * 0.5); }                                                                // the base
  const fy0 = cy0 - friezeH; body.rect(x0 - w * 0.01, fy0, w * 1.02, friezeH + 0.5);
  const apx = cx, apy = fy0 - pedH; body.moveTo(x0 - w * 0.025, fy0); body.lineTo(apx, apy); body.lineTo(x0 + w * 1.025, fy0); body.closePath();
  g.fillStyle = tone; g.fill(body);
  // the fluting and the line under the cornice, in bare stock
  g.strokeStyle = cut; g.lineWidth = Math.max(2, w * 0.0035);
  if (flute) for (const x of xs) for (const f of [-0.26, 0, 0.26]) { g.beginPath(); g.moveTo(x + f * colW, cy0 + capH + 10); g.lineTo(x + f * colW, cy1 - capH * 0.5 - 10); g.stroke(); }
  g.lineWidth = Math.max(3, w * 0.005); g.beginPath(); g.moveTo(x0 + 6, fy0); g.lineTo(x0 + w - 6, fy0); g.stroke();
  g.beginPath(); g.moveTo(x0 + w * 0.045, fy0 - 6); g.lineTo(apx, apy + h * 0.045); g.lineTo(x0 + w * 0.955, fy0 - 6); g.stroke();                       // the raking cornice's inner line
  // the pediment sculpture: a standing figure with outstretched arms, a seated group each side, a reclining one in each corner
  g.save(); g.fillStyle = cut; const sy = fy0 - 8, u = pedH / 100;
  const fig = (x, hh, wd) => { g.beginPath(); g.ellipse(x, sy - hh, wd * 0.28, wd * 0.3, 0, 0, TAU); g.fill(); g.beginPath(); g.moveTo(x - wd * 0.5, sy); g.lineTo(x - wd * 0.28, sy - hh * 0.92); g.lineTo(x + wd * 0.28, sy - hh * 0.92); g.lineTo(x + wd * 0.5, sy); g.closePath(); g.fill(); };
  fig(cx, 74 * u, 14 * u * 2); g.fillRect(cx - 30 * u, sy - 54 * u, 60 * u, 4 * u);
  for (const sx of [-1, 1]) { fig(cx + sx * 26 * u, 42 * u, 11 * u * 2); fig(cx + sx * 42 * u, 34 * u, 10 * u * 2); fig(cx + sx * 58 * u, 26 * u, 10 * u * 2);
    g.beginPath(); g.moveTo(cx + sx * 70 * u, sy); g.lineTo(cx + sx * 90 * u, sy); g.lineTo(cx + sx * 86 * u, sy - 14 * u); g.lineTo(cx + sx * 74 * u, sy - 20 * u); g.closePath(); g.fill(); }
  g.restore();
  if (label) { const sz = friezeH * 0.7; g.font = `${sz}px "Anton"`; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = cut; g.fillText(label, cx, fy0 + friezeH * 0.5 + sz * 0.36); }
  return { fy0, apy, cy0, cy1, x0, x1: x0 + w, cx, by };
}

// ---------------------------------------------------------------- b8 the orders come from Wall Street: the exchange, the market under it
export function shotOrders(b, t) {
  const age = b - 8, z = 1 + 0.05 * Math.exp(-age * 6) + age * 0.008, by = 1670;
  rect(0, 0, W, H, d(0.5));
  g.save(); g.translate(540, by); g.scale(z, z); g.translate(-540, -by);
  exchange(540, by, 1000, 900);
  g.restore();
  ticker(b, t, { pick: ['ORDERS  ▲ ', 'RENT  ▲ 4.9', 'PLANT CLOSED  ▲ 6.1', 'ARMS  ▲ 3.4'] });
  return { misreg: 1.6 + 7 * Math.exp(-age * 7), flash: age < 0.066 ? 0.3 : 0 };
}

// ---------------------------------------------------------------- b34 the plan: Wall Street's order sheet, typed and signed
function sheet(cx, cy, w, h, b0, b, { signed = true } = {}) {
  const x = cx - w / 2, y = cy - h / 2;
  rect(x + 16, y + 16, w, h, k(0.3));
  rect(x, y, w, h, PAPER); g.strokeStyle = k(1); g.lineWidth = 6; g.strokeRect(x, y, w, h);
  // letterhead: the exchange, small, and the plan's title
  exchange(x + 120, y + 190, 170, 130, { label: null, flute: false });
  text('THE PLAN', x + w - 36, y + 120, 112, k(1), { font: 'Anton', align: 'right' });
  text('ISSUED BY WALL ST · 1945–', x + w - 36, y + 176, 38, k(1), { font: 'Plex Bold', align: 'right' });
  rect(x + 30, y + 214, w - 60, 8, k(1));
  const ITEMS = [['RENTS', 'UP'], ['FACTORIES', 'OFFSHORE'], ['TROOPS', 'ABROAD']];
  ITEMS.forEach(([a, c], i) => {
    const yy = y + 330 + i * 150, u = clamp((b - (b0 + 0.3 + i * 0.7)) / 0.35);
    if (u <= 0) return;
    text(String(i + 1) + '.', x + 40, yy, 66, k(1), { font: 'Plex Bold', align: 'left' });
    text(a, x + 110, yy, 76, k(1), { font: 'Anton', align: 'left' });
    g.font = '76px "Anton"'; const aw = g.measureText(a).width;
    g.fillStyle = k(1); for (let dx = x + 110 + aw + 24; dx < x + w - 60 - g.measureText(c).width - 24 && dx < x + 110 + aw + 24 + 400 * u; dx += 18) g.fillRect(dx, yy - 4, 7, 7);
    const cw = g.measureText(c).width; if (u > 0.55) text(c, x + w - 40, yy, 76, r(1), { font: 'Anton', align: 'right' });
  });
  // the signature and the seal
  const sg0 = ease.outBack ? 0 : 0;
  rect(x + 40, y + h - 130, 320, 5, k(1)); text('SIGNED', x + 40, y + h - 146, 36, k(1), { font: 'Plex Bold', align: 'left' });
  const su = clamp((b - (b0 + 2.1)) / 0.12);
  if (signed && su > 0) { const sx = x + w - 190, sy = y + h - 130, sc = 1 + 0.5 * (1 - su);
    g.save(); g.translate(sx, sy); g.scale(sc, sc); g.globalAlpha = 1;
    circle(0, 0, 118, k(1)); circle(0, 0, 108, d(1)); ring(0, 0, 90, 5, k(1)); text('WALL ST', 0, 24, 66, k(1), { font: 'Anton' }); g.restore(); }
}
export function shotPlanned(b, t) {
  const age = b - 34, hit = b >= 36.1 ? Math.exp(-(b - 36.1) * 7) : 0;
  g.save(); g.translate(540, 1370); g.rotate(-0.025); g.translate(-540, -1370);
  sheet(540, 1370, 800, 880, 34, b);
  g.restore();
  return { misreg: 1.6 + 5 * Math.exp(-age * 7) + 6 * hit, shake: b >= 36.1 && b < 36.5 ? 4 : 0 };
}

// ---------------------------------------------------------------- b38 the sheet is torn: EXPROPRIATE THE PLANNERS, on the red
export function shotTear(b, t) {
  const age = b - 38, u = clamp(age / 1.4);
  rect(0, 0, W, H, r(1));
  const R = rng(6), edge = []; for (let i = 0; i <= 12; i++) edge.push((R() - 0.5) * 70);
  const cy = 1370, h = 880, y0 = cy - h / 2, y1 = cy + h / 2;
  const half = side => {
    const e = ease.inCubic(u), ang = side * (0.1 + 0.9 * e), dx = side * (30 + 900 * e), dy = 40 + 1100 * e * e;
    g.save(); g.translate(540 + dx, cy + dy); g.rotate(ang); g.translate(-540, -cy);
    g.rotate(0.025 * 0); const clip = new Path2D();
    clip.moveTo(side < 0 ? -200 : 540 + edge[0], y0 - 60); for (let i = 0; i <= 12; i++) clip.lineTo(540 + edge[i], y0 - 60 + (y1 - y0 + 120) * i / 12);
    clip.lineTo(side < 0 ? -200 : W + 200, y1 + 60); clip.lineTo(side < 0 ? -200 : W + 200, y0 - 60); if (side < 0) { clip.closePath(); }
    const cl = new Path2D(); cl.moveTo(540 + edge[0], y0 - 60); for (let i = 1; i <= 12; i++) cl.lineTo(540 + edge[i], y0 - 60 + (y1 - y0 + 120) * i / 12);
    if (side < 0) { cl.lineTo(-300, y1 + 60); cl.lineTo(-300, y0 - 60); } else { cl.lineTo(W + 300, y1 + 60); cl.lineTo(W + 300, y0 - 60); } cl.closePath();
    g.clip(cl); g.translate(540, cy); g.rotate(-0.025); g.translate(-540, -cy); sheet(540, cy, 800, 880, 34, 40); g.restore(); };
  half(-1); half(1);
  return { misreg: 1.6 + 7 * Math.exp(-age * 8), flash: age < 0.066 ? 0.35 : 0, shake: age < 0.3 ? 5 * (1 - age / 0.3) : 0 };
}

// ---------------------------------------------------------------- the gallery: the red wall, its paintings, the rope; one camera
// cam = { z, wx, wy, cx, cy }: a world point (wx, wy) sits at the screen point (cx, cy) with the world scaled by z
const camOf = c => ({ X: x => c.cx + (x - c.wx) * c.z, Y: y => c.cy + (y - c.wy) * c.z, S: v => v * c.z });
function gallery(cam, { rope = true, skip = [] } = {}) {
  const { X, Y, S } = camOf(cam);
  rect(0, 0, W, H, r(1));
  rect(0, Y(1530), W, H, k(1));
  g.strokeStyle = d(1); g.lineWidth = 6; g.beginPath(); g.moveTo(0, Y(1530)); g.lineTo(W, Y(1530)); g.stroke();
  g.strokeStyle = k(1); g.lineWidth = 4; g.beginPath(); g.moveTo(0, Y(1380)); g.lineTo(W, Y(1380)); g.stroke();
  const FR = [[ART.socrates, 270, 800, 540, 520, 46, 0.5, 0.4], [ART.vermeer, -170, 880, 340, 420, 34, 0.5, 0.3], [ART.harvesters, 890, 900, 330, 300, 30, 0.45, 0.5]];
  FR.forEach(([img, x, y, w, h, th, fx, fy], fi) => { if (skip.includes(fi)) return; const X0 = X(x), Y0 = Y(y), W0 = S(w), H0 = S(h), T0 = S(th);
    if (X0 > W + 40 || X0 + W0 < -40 || Y0 > H + 40 || Y0 + H0 < -40) return;
    rect(X0 + S(14), Y0 + S(14), W0, H0, k(1)); hang(img, X0 + T0, Y0 + T0, W0 - 2 * T0, H0 - 2 * T0, fx, fy); gilt(X0, Y0, W0, H0, T0, { shade: false }); });
  if (rope) { const ry = Y(1470), posts = [X(110), X(1010)];
    for (const px of posts) { rect(px - S(10), ry - S(26), S(20), S(150), d(1)); circle(px, ry - S(30), S(20), d(1)); strokeP(K.circPath(px, ry - S(30), S(20)), k(1), 3); g.strokeStyle = k(1); g.lineWidth = 3; g.strokeRect(px - S(10), ry - S(26), S(20), S(150)); }
    const rp = new Path2D(); rp.moveTo(posts[0], ry); rp.quadraticCurveTo((posts[0] + posts[1]) / 2, ry + S(140), posts[1], ry); g.lineCap = 'round'; strokeP(rp, k(1), S(28)); strokeP(rp, r(1), S(20)); }
  return camOf(cam);
}

// ---------------------------------------------------------------- b40.6-50: the guard's arc. His back; ABOUT FACE; the push-in to his face; the helmet off, the hard hat on
const GX = 610, GY = 1960, GH = 1090, HEADW = [GX, GY - 0.848 * GH];
export function shotGuardArc(b, t) {
  const T0 = 42.3, TURN = 0.42, CUT = 43.3;
  const bust = b >= CUT;
  const z = bust ? 3.3 + 0.08 * (b - CUT) : 1 + 0.012 * Math.max(0, b - 40.6);
  const cam = bust ? { z, wx: HEADW[0], wy: HEADW[1], cx: 540, cy: 1190 } : { z, wx: 560, wy: 1200, cx: 560, cy: 1200 };
  let X, Y, S;
  if (bust) { rect(0, 0, W, H, r(1)); ({ X, Y, S } = camOf(cam)); }       // the cut: his face on the plain red wall
  else ({ X, Y, S } = gallery(cam));
  const gx = X(GX), gy = Y(GY), gh = S(GH);
  const a = clamp((b - T0) / TURN) * Math.PI, c = Math.cos(a), frontShow = a > Math.PI / 2;
  const sway = Math.sin(t * 1.1) * 0.003;
  const sx = Math.max(0.04, Math.abs(c));
  g.save(); g.translate(gx, 0); g.scale(sx, 1); g.translate(-gx, 0);
  if (!frontShow) {
    const pcs = guardBack(gx, gy, gh, b < T0 ? sway : 0);
    for (const p of pcs) { g.save(); g.translate(7 * cam.z, -6 * cam.z); g.fillStyle = d(1); g.fill(p); g.restore(); }
    for (const p of pcs) knock(p, 0);
    for (const p of pcs) { g.save(); g.translate(7 * cam.z, -6 * cam.z); g.fillStyle = d(1); g.fill(p); g.restore(); }
    for (const p of pcs) fillP(p, k(1));
  } else {
    const sw = fr(b, 48.3, 49.2);
    const o = { rifle: !bust, lookX: 0 };
    if (b < 48.3) figureFront(gx, gy, gh, { ...o, hat: 'helmet' });
    else if (sw < 0.45) figureFront(gx, gy, gh, { ...o, hat: 'helmet', hatLift: -sw * 3.2, hatRot: -sw * 1.6 });
    else figureFront(gx, gy, gh, { ...o, hat: 'hard', hatLift: -(1 - ease.outBack(clamp((sw - 0.45) / 0.4))) * 3.0 });
  }
  g.restore();
  const turning = b >= T0 && b < T0 + TURN + 0.2;
  return { misreg: 1.6 + (turning ? 6 : 0) + 4 * Math.exp(-(b - T0) * 6) * (b >= T0 ? 1 : 0) + (bust ? 6 * Math.exp(-(b - CUT) * 8) : 0), shake: b >= T0 && b < T0 + 0.5 ? 3 : 0, flash: (b >= T0 && b < T0 + 0.07) || (b >= CUT && b < CUT + 0.07) ? 0.3 : 0 };
}

// ---------------------------------------------------------------- the city that runs, for the walk-out and the end
function tower(x, base, w, h, col, win = true, seed = 1) {
  rect(x, base - h, w, h, col);
  if (win && col === k(1)) { const R = rng(seed + Math.floor(x)); for (let yy = base - h + 26; yy < base - 40; yy += 30) for (let xx = x + 12; xx < x + w - 14; xx += 22) if (R() < 0.42) { g.fillStyle = PAPER; g.fillRect(xx, yy, 8, 12); } }
}
export function skyline(cx, base, sc, { seed = 3 } = {}) {
  // a row of buildings, drawn about (cx, base) at scale sc
  const R = rng(seed), blds = []; let x = -700;
  while (x < 700) { const w = 70 + R() * 90, h = 160 + R() * 480 * (1 - Math.abs(x) / 1400); blds.push([x, w, h]); x += w + 6 + R() * 12; }
  g.save(); g.translate(cx, base); g.scale(sc, sc);
  for (const [bx, w, h] of blds) tower(bx, 0, w, h, k(1), true, seed);
  // two tall ones with crowns and a mast
  g.fillStyle = k(1); g.fillRect(-60, -820, 120, 820); g.fillRect(-40, -880, 80, 60); g.fillRect(-6, -1010, 12, 130);
  g.fillStyle = PAPER; for (let yy = -790; yy < -40; yy += 34) for (let xx = -46; xx < 46; xx += 24) g.fillRect(xx, yy, 10, 14);
  g.restore();
}
// a train, side-on and long, with a bullet nose: black, a gold band of windows (cut paper), a red cab roof
export function trainSide(x, y, h, cars = 5, dir = 1) {
  const cw = h * 3.2, nose = h * 1.6;
  g.save(); g.translate(x, y); g.scale(dir, 1);
  // the cars, behind the nose (the train runs toward +x)
  g.fillStyle = k(1);
  for (let i = 0; i < cars; i++) { const x0 = -(i + 1) * (cw + 8); g.fillRect(x0, -h, cw, h * 0.84); g.fillRect(x0 + 8, -h * 0.18, cw - 16, h * 0.1);
    g.fillStyle = PAPER; for (let j = 0; j < 7; j++) g.fillRect(x0 + 24 + j * (cw - 48) / 7, -h * 0.82, (cw - 48) / 7 - 12, h * 0.26); g.fillStyle = k(1); }
  // the power car and its nose
  g.beginPath(); g.moveTo(-cw, -h); g.lineTo(0, -h); g.bezierCurveTo(nose * 0.7, -h, nose * 1.0, -h * 0.6, nose * 1.02, -h * 0.34); g.lineTo(nose * 1.02, -h * 0.16); g.lineTo(-cw, -h * 0.16); g.closePath(); g.fill();
  g.fillStyle = PAPER; g.beginPath(); g.moveTo(nose * 0.28, -h * 0.9); g.lineTo(nose * 0.55, -h * 0.9); g.bezierCurveTo(nose * 0.78, -h * 0.9, nose * 0.9, -h * 0.64, nose * 0.94, -h * 0.5); g.lineTo(nose * 0.28, -h * 0.5); g.closePath(); g.fill();
  g.fillStyle = r(1); g.fillRect(-cw, -h * 0.5, cw + nose * 0.95, h * 0.1);
  g.restore();
}
function viaduct(y, x0, x1, col) {
  rect(x0, y, x1 - x0, 18, col);
  g.fillStyle = col; for (let x = x0 + 30; x < x1; x += 130) { g.fillRect(x, y, 40, 160); }
  g.strokeStyle = col; g.lineWidth = 14; for (let x = x0 + 30; x < x1; x += 130) { g.beginPath(); g.arc(x + 85, y + 18, 45, Math.PI, 0); g.stroke(); }
}
function cityBackdrop(t, b, sc = 1, trainX = null) {
  // sky: the flat gold wash; the city, black; a crane or two; a viaduct with a train on it
  rect(0, 0, W, H, d(0.5));
  const base = 1530;
  skyline(300, base, 0.88 * sc, { seed: 5 }); skyline(790, base, 0.74 * sc, { seed: 9 });
  sg('crane', 130, base, 520 * sc, k(1), { lod: 2 }); sg('crane', 960, base, 420 * sc, k(1), { lod: 2, flip: true });
  rect(0, base - 12, W, 12, k(1));
  if (trainX != null) { trainSide(trainX, base - 14, 150 * sc, 4, 1); }
  rect(0, base, W, H - base, k(1));
  g.strokeStyle = PAPER; g.lineWidth = 6; g.beginPath(); g.moveTo(0, base + 60); for (let x = 0; x < W; x += 60) g.lineTo(x, base + 60); g.stroke();
}

// ---------------------------------------------------------------- b62-70: the doors open. He walks out in his work hat, no rifle, a pail in his hand
export function shotWalkout(b, t) {
  const age = b - 62, walk = ease.inOutCubic(clamp(age / 7.2));
  const op = 1;
  // the wall, with its paintings, and the opening in it
  gallery({ z: 1, wx: 540, wy: 960, cx: 540, cy: 960 }, { rope: false, skip: [0] });
  const DX0 = 200, DX1 = 880, DY0 = 790, DY1 = 1530;                                       // the doorway
  const door = new Path2D(); door.rect(DX0, DY0, DX1 - DX0, DY1 - DY0);
  knock(door);
  g.save(); g.clip(door);
  const cz = lerp(1, 1.9, walk);
  g.translate(540, 1530); g.scale(cz, cz); g.translate(-540, -1530);
  cityBackdrop(t, b, 0.62, lerp(-900, 1500, clamp((b - 63) / 5.5)));
  g.restore();
  // the frame of the doorway: a black jamb, a gold keyline
  g.strokeStyle = k(1); g.lineWidth = 22; g.strokeRect(DX0 - 11, DY0 - 11, DX1 - DX0 + 22, DY1 - DY0 + 22); g.strokeStyle = d(1); g.lineWidth = 6; g.strokeRect(DX0 - 25, DY0 - 25, DX1 - DX0 + 50, DY1 - DY0 + 50);
  // the floor: the stone tint, so the legs read against it
  rect(0, DY1, W, H - DY1, k(0.3));
  g.strokeStyle = d(1); g.lineWidth = 6; g.beginPath(); g.moveTo(0, DY1); g.lineTo(W, DY1); g.stroke();
  // him: the work hat from behind; small as he goes
  const hs = lerp(560, 300, walk), fy = lerp(1700, 1580, walk), bob = Math.sin(t * 6.2) * 4 * (1 - walk * 0.5);
  workerBack(540, fy + bob, hs, { stride: Math.sin(t * 6.2) });
  return { misreg: 1.6 + 5 * Math.exp(-age * 7) };
}

// ---------------------------------------------------------------- b72 the museum answered: the doors are open on the whole street, the placard turned round
export function shotAnswer(b, t) {
  const age = b - 72, open = ease.outExpo(clamp(age / 0.5));
  cityBackdrop(t, b, 1, lerp(1000, 1500, clamp((b - 72) / 4)));
  // the walls swing off to each side as the doors open
  const wl = lerp(0, -560, open), wr = lerp(0, 560, open);
  if (open < 0.999) { rect(wl, 0, 540, 1530, r(1)); rect(540 + wr, 0, 540, 1530, r(1)); rect(wl, 1530, 540, 8, d(1)); rect(540 + wr, 1530, 540, 8, d(1)); }
  const hs = 400, fy = 1700;
  workerBack(lerp(540, 600, clamp((b - 72) / 4)), fy, hs, { stride: Math.sin(t * 6.2) });
  // the placard, same card as the museum's, answered
  const px = 150, py = 1716, pw = 780, ph = 174;
  rect(px + 16, py + 16, pw, ph, k(0.3)); rect(px, py, pw, ph, k(1)); g.strokeStyle = d(1); g.lineWidth = 6; g.strokeRect(px + 12, py + 12, pw - 24, ph - 24);
  text('AMERICA · 2026–', px + pw / 2, py + 92, 80, PAPER, { font: 'Oswald' });
  text('WORK IN PROGRESS', px + pw / 2, py + 142, 44, PAPER, { font: 'Oswald' });
  return { misreg: 1.6 + 6 * Math.exp(-age * 7), flash: age < 0.066 ? 0.3 : 0 };
}

// ---------------------------------------------------------------- b70 Richmond, 1942: the people already did it once
export function shotRichmond(b, t) {
  const age = b - 70;
  rect(0, 0, W, H, k(1));
  text('RICHMOND, CALIFORNIA · 1942', 540, 300, 62, PAPER, { font: 'Oswald' });
  text('SHIPYARD WORKERS BUILT', 540, 400, 66, PAPER, { font: 'Oswald' });
  text('ONE SHIP, KEEL TO LAUNCH, IN', 540, 480, 66, PAPER, { font: 'Oswald' });
  rect(150, 530, 780, 8, d(1));
  text('4', 540, 1215, 760, d(1), { font: 'Anton' });
  text('DAYS', 540, 1560, 360, PAPER, { font: 'Anton' });
  text('15 HRS 29 MIN', 540, 1700, 84, d(1), { font: 'Oswald' });
  return { misreg: 1.6 + 7 * Math.exp(-age * 8), flash: age < 0.066 ? 0.25 : 0 };
}
