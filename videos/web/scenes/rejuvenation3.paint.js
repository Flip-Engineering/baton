// REJUVENATION v3 painters: the young state of every world, drawn flat in "precisionist noon" (a 2-stop sky, one sun,
// hard cast shadows, clean ink colours: cobalt, concrete white, safety yellow, ACP red). The old state is not painted:
// rejuvenation3.js prints this same picture as foxed sepia halftone newsprint through its AGE pass, so age is a medium
// and the reverse wave is the boundary between the two. Everything here is deterministic in its arguments.
import { W, H, clamp, lerp, ease, smooth, rng } from '../lib/kit.js';

export const P = {
  cobalt: '#1d3f9e', cobalt2: '#2f5cc4', skyHor: '#cfe1ea', skyTop: '#2346a8',
  conc: '#efebe2', concSh: '#b7b3aa', concDeep: '#57555a', concLine: '#d8d3c8',
  yellow: '#f2bf1d', red: '#c91f37', red2: '#bd1818', ink: '#141112', steel: '#5d7189', steelHi: '#9fb3c8', steelSh: '#34424f',
  brick: '#9a4630', brickSh: '#5e2819', brickHi: '#bc6446', mortar: '#caa98c', rust: '#9b4a1c', rustDk: '#56240e',
  wheat: '#d9b457', wheatSh: '#b48f3a', green: '#6f8d3c', green2: '#8aa64a', soil: '#8b6a45', river: '#2c56b8',
  plume: '#f6f3ec', plumeSh: '#c9ced6', black: '#0a0a0c',
};

// ---------------------------------------------------------------- basics
export function sky(g, y0 = 0, y1 = H, top = P.skyTop, hor = P.skyHor) {
  const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, top); gr.addColorStop(1, hor);
  g.fillStyle = gr; g.fillRect(0, y0, W, y1 - y0);
}
export function poly(g, pts, fill) { g.fillStyle = fill; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); g.fill(); }
export function rect(g, x, y, w, h, fill) { g.fillStyle = fill; g.fillRect(x, y, w, h); }

// seeded value noise on a small canvas (tileable enough), cached by key; returns a Float32Array field
const _nz = new Map();
export function noiseField(key, w, h, scale, oct = 5, seed = 1) {
  const k = `${key}:${w}:${h}:${scale}:${oct}:${seed}`; if (_nz.has(k)) return _nz.get(k);
  const r = rng(seed), G = 64, grid = new Float32Array(G * G); for (let i = 0; i < G * G; i++) grid[i] = r();
  const vn = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = grid[((yi & 63) * G) + (xi & 63)], b = grid[((yi & 63) * G) + ((xi + 1) & 63)], c = grid[(((yi + 1) & 63) * G) + (xi & 63)], d = grid[(((yi + 1) & 63) * G) + ((xi + 1) & 63)];
    return lerp(lerp(a, b, u), lerp(c, d, u), v); };
  const f = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, a = 0.5, fx = x / scale, fy = y / scale; for (let o = 0; o < oct; o++) { s += a * vn(fx, fy); fx *= 2.03; fy *= 2.03; a *= 0.5; } f[y * w + x] = s; }
  _nz.set(k, f); return f;
}

// ---------------------------------------------------------------- plume: a column that returns (p = 0 dead .. 1 full)
export function plume(g, x, y, p, { scale = 1, t = 0, wind = 0.55, seed = 3, maxH = 900, sh = P.plumeSh, col = P.plume } = {}) {
  if (p <= 0.001) return;
  const r = rng(seed), n = 26, hTop = maxH * p;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1), hh = u * hTop, rr = (40 + 170 * Math.pow(u, 0.8)) * scale * (0.85 + 0.3 * r());
    const dx = wind * hh * (0.25 + 0.75 * u) + Math.sin(u * 7 + t * 1.3 + seed) * 16 * scale * u;
    pts.push([x + dx, y - hh * scale, rr]);
  }
  // shade side (down-right) then the lit body
  g.fillStyle = sh; for (const [px, py, rr] of pts) { g.beginPath(); g.arc(px + rr * 0.18, py + rr * 0.16, rr, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = col; for (const [px, py, rr] of pts) { g.beginPath(); g.arc(px - rr * 0.06, py - rr * 0.08, rr * 0.9, 0, Math.PI * 2); g.fill(); }
}

// ---------------------------------------------------------------- cooling tower (hyperboloid), lit from the left
export function coolingTower(g, cx, baseY, h, { waist = 0.62, rBase = 0.42, rTop = 0.3, lit = true, struts = true, dark = false } = {}) {
  const yw = baseY - h * waist, rb = h * rBase, rt = h * rTop, rw = Math.min(rb, rt) * 0.78;
  const R = y => { const k = y > yw ? (y - yw) / (baseY - yw) : (yw - y) / (yw - (baseY - h)); const re = y > yw ? rb : rt; return rw + (re - rw) * k * k; };
  const N = 40, L = [], Rt = [];
  for (let i = 0; i <= N; i++) { const y = baseY - h * i / N; L.push([cx - R(y), y]); Rt.push([cx + R(y), y]); }
  const body = [...L, ...Rt.reverse()];
  const gr = g.createLinearGradient(cx - rb, 0, cx + rb, 0);
  if (dark) { gr.addColorStop(0, '#6b6862'); gr.addColorStop(1, '#3e3c3a'); }
  else { gr.addColorStop(0, P.concSh); gr.addColorStop(0.18, P.conc); gr.addColorStop(0.42, '#e6e1d6'); gr.addColorStop(0.58, P.concSh); gr.addColorStop(1, '#8e8a84'); }
  poly(g, body, gr);
  // flat precisionist bands: a hard terminator at 58 %
  g.save(); g.beginPath(); g.moveTo(body[0][0], body[0][1]); for (const q of body) g.lineTo(q[0], q[1]); g.closePath(); g.clip();
  g.fillStyle = 'rgba(40,40,52,0.16)'; g.fillRect(cx + rb * 0.12, baseY - h - 10, rb * 2, h + 20);
  // horizontal pour lifts (thin)
  g.strokeStyle = 'rgba(80,76,70,0.18)'; g.lineWidth = 1.2; for (let k = 1; k < 16; k++) { const y = baseY - h * k / 16; g.beginPath(); g.moveTo(cx - R(y) - 2, y); g.lineTo(cx + R(y) + 2, y); g.stroke(); }
  g.restore();
  // top rim, dark mouth
  const ytop = baseY - h; g.fillStyle = '#2a2a2e'; g.beginPath(); g.ellipse(cx, ytop, R(ytop), R(ytop) * 0.12, 0, 0, Math.PI * 2); g.fill();
  if (struts) { g.fillStyle = '#6a665f'; for (let k = -6; k <= 6; k++) { const x = cx + k * rb / 6.5; g.beginPath(); g.moveTo(x - 5, baseY); g.lineTo(x + 5 + k * 1.5, baseY - h * 0.06); g.lineTo(x + 12 + k * 1.5, baseY - h * 0.06); g.lineTo(x + 3, baseY); g.fill(); } }
  return { top: [cx, ytop], rTop: R(ytop) };
}

// ---------------------------------------------------------------- brick chimney that topples (c = 0 standing .. 1 rubble)
// the stack breaks at the base and in two mid joints; each segment rotates about the base hinge while it falls, the
// upper pieces lag and separate (the classic felled stack); on the ground the bricks scatter and the dust billows.
// Run c backwards and it is Lumière's wall: the stack rising out of its own dust.
export function chimney(g, c, { cx = 560, baseY = 1560, h = 1180, wb = 250, wt = 150, seed = 5, sun = true } = {}) {
  const r = rng(seed);
  const fall = clamp(c / 0.62), land = clamp((c - 0.55) / 0.45);
  const segs = [[0, 0.42], [0.42, 0.74], [0.74, 1]];
  const ang = k => { const lag = [0, 0.1, 0.2][k], f = clamp((fall - lag * 0.4) / (1 - lag * 0.4)); return ease.inCubic(f) * (Math.PI * 0.46 + k * 0.05); };
  const width = u => lerp(wb, wt, u);
  // ground shadow of the standing stack (the sun is up-left): a long flat shadow to the right, shrinking as it falls
  if (sun) { g.save(); g.globalAlpha = 0.35 * (1 - fall); poly(g, [[cx - wb / 2, baseY], [cx + wb / 2, baseY], [cx + wb / 2 + 520, baseY + 70], [cx + wb / 2 + 420, baseY + 90]], '#3a2c22'); g.restore(); }
  // dust: billows out low along the ground and up behind the falling mass
  const dust = Math.sin(clamp(c / 1) * Math.PI) * 0.8 + land * 0.5;
  const drawDust = (front) => {
    if (dust <= 0.01) return; const rr = rng(seed + 9);
    for (let i = 0; i < 70; i++) {
      const u = rr(), v = rr(), side = rr() < 0.5 ? -1 : 1, spread = (0.2 + 0.8 * c) * (340 + 420 * u);
      const x = cx + side * spread * (0.3 + v) + 260 * c, y = baseY - 30 - v * v * 560 * (0.35 + c), rad = (60 + 150 * rr()) * (0.3 + dust);
      if ((i % 3 === 0) !== front) continue;
      g.fillStyle = i % 4 ? 'rgba(214,196,168,0.55)' : 'rgba(170,150,124,0.6)'; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
    }
  };
  drawDust(false);
  // rubble heap (grows as the pieces land)
  const heap = 0.15 + 0.85 * land;
  g.fillStyle = P.brickSh; g.beginPath(); g.moveTo(cx - 420 * heap - 120, baseY + 8);
  for (let i = 0; i <= 24; i++) { const u = i / 24, x = lerp(cx - 420 * heap - 120, cx + 820 * heap + 160, u); const y = baseY - (Math.sin(u * Math.PI) * 170 * heap + (r() - 0.5) * 30 * heap); g.lineTo(x, y); }
  g.lineTo(cx + 820 * heap + 160, baseY + 8); g.closePath(); g.fill();
  for (let i = 0; i < 160 * heap; i++) { const x = lerp(cx - 400 * heap - 100, cx + 800 * heap + 140, r()), y = baseY - r() * 140 * heap * Math.sin(clamp((x - cx + 400 * heap + 100) / (1200 * heap + 240)) * Math.PI);
    g.save(); g.translate(x, y); g.rotate(r() * 3); g.fillStyle = r() < 0.5 ? P.brick : P.brickHi; g.fillRect(-14, -6, 28, 12); g.restore(); }
  // the segments
  const hinge = [cx + wb / 2, baseY];
  segs.forEach(([u0, u1], k) => {
    if (land > 0.2 + k * 0.25) return;            // this piece has broken up on the ground
    const a = ang(k), gap = fall * k * 26;
    g.save(); g.translate(hinge[0], hinge[1]); g.rotate(a); g.translate(-hinge[0], -hinge[1]); g.translate(0, -gap);
    const y0 = baseY - u0 * h, y1 = baseY - u1 * h, w0 = width(u0), w1 = width(u1);
    const q = [[cx - w0 / 2, y0], [cx + w0 / 2, y0], [cx + w1 / 2, y1], [cx - w1 / 2, y1]];
    poly(g, q, P.brick);
    poly(g, [[cx + w0 * 0.12, y0], [cx + w0 / 2, y0], [cx + w1 / 2, y1], [cx + w1 * 0.12, y1]], P.brickSh);   // shade side (sun up-left)
    poly(g, [[cx - w0 / 2, y0], [cx - w0 * 0.34, y0], [cx - w1 * 0.34, y1], [cx - w1 / 2, y1]], P.brickHi);
    // courses
    g.strokeStyle = 'rgba(60,24,14,0.45)'; g.lineWidth = 1.4;
    for (let y = y0 - 14; y > y1; y -= 14) { const u = (baseY - y) / h, ww = width(u); g.beginPath(); g.moveTo(cx - ww / 2, y); g.lineTo(cx + ww / 2, y); g.stroke(); }
    if (u1 === 1) {      // the corbelled cap and a white band
      poly(g, [[cx - w1 / 2 - 22, y1 + 60], [cx + w1 / 2 + 22, y1 + 60], [cx + w1 / 2 + 22, y1], [cx - w1 / 2 - 22, y1]], P.brickSh);
      poly(g, [[cx - w1 / 2 - 22, y1 + 60], [cx + w1 * 0.12, y1 + 60], [cx + w1 * 0.12, y1], [cx - w1 / 2 - 22, y1]], P.brick);
      rect(g, cx - w1 / 2, y1 + 110, w1, 26, '#e9e1d2'); rect(g, cx + w1 * 0.12, y1 + 110, w1 * 0.38, 26, '#b4ab9c');
    }
    // the break: ragged top edge of lower pieces
    g.restore();
  });
  // loose bricks in the air (shed from the break joints)
  if (fall > 0.05 && land < 0.9) {
    const rr = rng(seed + 3);
    for (let i = 0; i < 60; i++) {
      const u = 0.42 + (rr() < 0.5 ? 0 : 0.32) + (rr() - 0.5) * 0.06, a = ang(u > 0.6 ? 1 : 0), d = u * h;
      const bx = hinge[0] - Math.sin(-a) * 0 + Math.sin(a) * d - wb / 2 * Math.cos(a), by = hinge[1] - Math.cos(a) * d;
      const drop = Math.pow(clamp(fall - 0.2), 2) * (300 + 500 * rr());
      g.save(); g.translate(bx + (rr() - 0.5) * 200 * fall, by + drop); g.rotate(rr() * 6 + c * 8); g.fillStyle = rr() < 0.5 ? P.brick : P.brickSh; g.fillRect(-15, -6, 30, 12); g.restore();
    }
  }
  drawDust(true);
}

// ---------------------------------------------------------------- the fortress (the client's white megastructure)
// tiers from the base up; `levels` (float) is how far it has poured: a partial tier is formwork rising.
export function fortress(g, cx, baseY, s, { levels = 99, sun = [-1, -0.6], emblemSlot = null, fins = true, shadow = true } = {}) {
  const T = [[1.0, 0.22], [0.8, 0.2], [0.62, 0.18], [0.44, 0.17], [0.2, 0.3]];   // [width share, height share]
  const Wd = 900 * s, Hd = 1300 * s, side = 110 * s;    // side face depth (to the right, in shade)
  let y = baseY; const out = { faces: [] };
  if (shadow) { g.save(); g.globalAlpha = 0.5; poly(g, [[cx - Wd / 2, baseY], [cx + Wd / 2 + side, baseY], [cx + Wd / 2 + side + 700 * s, baseY + 180 * s], [cx - Wd / 2 + 500 * s, baseY + 180 * s]], '#44403c'); g.restore(); }
  T.forEach(([ws, hs], i) => {
    const lv = clamp(levels - i); if (lv <= 0) return;
    const w = Wd * ws, h = Hd * hs, x0 = cx - w / 2, sd = side * (1 - i * 0.12), hh = h * (lv < 1 ? ease.outCubic(lv) : 1);
    const cured = lv >= 1;
    // side (shade) face
    poly(g, [[x0 + w, y], [x0 + w + sd, y - sd * 0.35], [x0 + w + sd, y - hh - sd * 0.35], [x0 + w, y - hh]], cured ? P.concSh : '#6f6a64');
    // top face
    if (cured) poly(g, [[x0, y - hh], [x0 + w, y - hh], [x0 + w + sd, y - hh - sd * 0.35], [x0 + sd, y - hh - sd * 0.35]], '#fbf9f4');
    // front face
    rect(g, x0, y - hh, w, hh, cured ? P.conc : '#8d877f');
    if (!cured) { g.strokeStyle = 'rgba(40,34,30,0.5)'; g.lineWidth = 2; for (let x = x0 + 14; x < x0 + w; x += 26 * s + 4) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - hh); g.stroke(); }
      rect(g, x0 - 6, y - hh - 8, w + 12, 10, P.yellow); }                                   // the pour lip / formwork walers
    else if (fins) {
      const n = Math.max(3, Math.round(w / (46 * s)));
      for (let k = 1; k < n; k++) { const x = x0 + w * k / n; rect(g, x, y - hh, 7 * s, hh, P.concLine); rect(g, x + 7 * s, y - hh, 10 * s, hh, '#c9c4b9'); }
      rect(g, x0, y - hh, w, 10 * s, '#ffffff'); rect(g, x0, y - 14 * s, w, 14 * s, '#d9d4ca');
    }
    out.faces.push({ x0, y0: y - hh, w, h: hh, i });
    y -= hh + (cured ? sd * 0.0 : 0);
  });
  out.top = y; out.W = Wd; out.H = Hd;
  return out;
}

// ---------------------------------------------------------------- a steel beam flange with rivets, rust receding
// k = rust amount (1 = scaled over, 0 = bare steel). noise baked once at half-res.
export function steelBeam(g, k, { t = 0, seed = 7 } = {}) {
  sky(g, 0, H, P.skyTop, '#9fbad6');
  // the beam runs diagonally, a web and two flanges, seen close from below
  g.save(); g.translate(W / 2, H / 2); g.rotate(-0.42); g.translate(-W / 2, -H / 2);
  rect(g, -400, 620, W + 800, 680, P.steel);            // web
  rect(g, -400, 560, W + 800, 90, P.steelHi);            // top flange (lit)
  rect(g, -400, 1270, W + 800, 110, P.steelSh);          // bottom flange (shade)
  rect(g, -400, 650, W + 800, 22, '#44556a');
  // rivet rows
  for (let x = -380; x < W + 400; x += 86) for (const y of [700, 1230]) {
    g.fillStyle = P.steelSh; g.beginPath(); g.arc(x + 3, y + 4, 17, 0, Math.PI * 2); g.fill();
    g.fillStyle = P.steelHi; g.beginPath(); g.arc(x, y, 15, 0, Math.PI * 2); g.fill(); }
  g.restore();
  // rust overlay: threshold a baked fbm field; the scale recedes as k falls (edges carry a dark rim)
  const S = 3, w = Math.ceil(W / S), h = Math.ceil(H / S), f = noiseField('rust', w, h, 38, 5, seed);
  const c = _rustC || (_rustC = Object.assign(document.createElement('canvas'), { width: w, height: h })), cg = c.getContext('2d');
  const id = cg.createImageData(w, h), d = id.data, thr = lerp(0.78, 0.3, k);
  for (let i = 0; i < w * h; i++) {
    const v = f[i]; if (v < thr) { d[i * 4 + 3] = 0; continue; }
    const e = v - thr, dark = e < 0.02; const col = dark ? [86, 36, 14] : e > 0.09 ? [120, 52, 22] : [160, 78, 32];
    d[i * 4] = col[0]; d[i * 4 + 1] = col[1]; d[i * 4 + 2] = col[2]; d[i * 4 + 3] = 255;
  }
  cg.putImageData(id, 0, 0);
  g.save(); g.imageSmoothingEnabled = true;
  g.beginPath(); g.save(); g.translate(W / 2, H / 2); g.rotate(-0.42); g.translate(-W / 2, -H / 2); g.rect(-400, 560, W + 800, 820); g.restore(); g.clip();
  g.drawImage(c, 0, 0, W, H); g.restore();
}
let _rustC = null;

// ---------------------------------------------------------------- the punch clock (a time recorder), hands running
export function punchClock(g, hoursAngle, minAngle, { card = 0, stamp = 0 } = {}) {
  rect(g, 0, 0, W, H, '#2a3a52');
  // wall: painted block, lit from the upper left
  for (let y = 0; y < H; y += 96) for (let x = (y / 96) % 2 ? -110 : 0; x < W; x += 220) { rect(g, x + 3, y + 3, 214, 90, '#31445f'); }
  // cabinet
  const cx = 540, top = 250, cw = 760, ch = 1320;
  rect(g, cx - cw / 2 + 26, top + 26, cw, ch, 'rgba(10,14,20,0.55)');
  rect(g, cx - cw / 2, top, cw, ch, '#2b2522');
  rect(g, cx - cw / 2, top, cw, 14, '#5a4a3e'); rect(g, cx - cw / 2, top, 14, ch, '#4a3d33');
  // dial
  const dy = top + 400, R = 300;
  g.fillStyle = '#12100f'; g.beginPath(); g.arc(cx, dy, R + 26, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#f1ead9'; g.beginPath(); g.arc(cx, dy, R, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#d9d0bb'; g.beginPath(); g.arc(cx + 14, dy + 14, R, -0.2, Math.PI * 0.9); g.arc(cx, dy, R, Math.PI * 0.9, -0.2, true); g.fill();
  g.fillStyle = P.ink; g.font = '700 64px "Archivo Black"'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let k = 1; k <= 12; k++) { const a = k / 12 * Math.PI * 2 - Math.PI / 2; g.fillText(String(k), cx + Math.cos(a) * R * 0.78, dy + Math.sin(a) * R * 0.78); }
  for (let k = 0; k < 60; k++) { const a = k / 60 * Math.PI * 2; const r0 = k % 5 ? R * 0.93 : R * 0.9; g.strokeStyle = P.ink; g.lineWidth = k % 5 ? 3 : 7;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, dy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * R * 0.98, dy + Math.sin(a) * R * 0.98); g.stroke(); }
  const hand = (a, len, wd, col) => { g.save(); g.translate(cx, dy); g.rotate(a); g.fillStyle = col; g.beginPath(); g.moveTo(-wd, 30); g.lineTo(wd, 30); g.lineTo(wd * 0.4, -len); g.lineTo(-wd * 0.4, -len); g.closePath(); g.fill(); g.restore(); };
  hand(hoursAngle, R * 0.52, 16, P.ink); hand(minAngle, R * 0.84, 11, P.ink);
  g.fillStyle = P.red; g.beginPath(); g.arc(cx, dy, 18, 0, Math.PI * 2); g.fill();
  // the card slot and the time card going in
  const sy = top + 830;
  rect(g, cx - 200, sy, 400, 250, '#1a1614'); rect(g, cx - 170, sy + 90, 340, 22, '#050404');
  const cy = sy + 101 - lerp(420, 0, ease.outCubic(card));
  g.save(); g.beginPath(); g.rect(0, 0, W, sy + 101); g.clip();
  rect(g, cx - 150, cy - 360, 300, 360, '#e6d7ae');
  g.strokeStyle = 'rgba(80,60,30,0.6)'; g.lineWidth = 2; for (let k = 1; k < 9; k++) { g.beginPath(); g.moveTo(cx - 140, cy - 360 + k * 38); g.lineTo(cx + 140, cy - 360 + k * 38); g.stroke(); }
  if (stamp > 0) { g.fillStyle = `rgba(150,20,30,${0.85 * stamp})`; g.font = '700 30px "Plex Mono"'; g.fillText('IN  7:00', cx, cy - 40); }
  g.restore();
  // the stamp lever
  const lv = stamp > 0 && stamp < 1 ? 1 : 0;
  rect(g, cx + 230, sy + 30 + lv * 60, 60, 190, '#8f1a26');
  rect(g, cx - cw / 2 + 60, top + ch - 110, cw - 120, 40, '#3b322c');
}

// ---------------------------------------------------------------- transmission pylon (ink silhouette)
export function pylon(g, x, baseY, h, { col = P.ink, lw = 1 } = {}) {
  const w = h * 0.3, arm = h * 0.42;
  g.save(); g.strokeStyle = col; g.lineWidth = Math.max(1, h * 0.012) * lw; g.lineJoin = 'round';
  const Lx = y => x - w / 2 * (1 - (baseY - y) / h * 0.85), Rx = y => x + w / 2 * (1 - (baseY - y) / h * 0.85);
  g.beginPath(); g.moveTo(Lx(baseY), baseY); g.lineTo(Lx(baseY - h), baseY - h); g.moveTo(Rx(baseY), baseY); g.lineTo(Rx(baseY - h), baseY - h); g.stroke();
  g.lineWidth *= 0.6; g.beginPath();
  for (let k = 0; k < 8; k++) { const y0 = baseY - h * k / 8, y1 = baseY - h * (k + 1) / 8; g.moveTo(Lx(y0), y0); g.lineTo(Rx(y1), y1); g.moveTo(Rx(y0), y0); g.lineTo(Lx(y1), y1); g.moveTo(Lx(y1), y1); g.lineTo(Rx(y1), y1); }
  for (const f of [0.72, 0.88]) { const y = baseY - h * f; g.moveTo(x - arm * (f === 0.72 ? 1 : 0.75), y); g.lineTo(x + arm * (f === 0.72 ? 1 : 0.75), y); g.moveTo(x - arm * (f === 0.72 ? 1 : 0.75), y); g.lineTo(Lx(y - h * 0.06), y - h * 0.06); g.moveTo(x + arm * (f === 0.72 ? 1 : 0.75), y); g.lineTo(Rx(y - h * 0.06), y - h * 0.06); }
  g.moveTo(Lx(baseY - h), baseY - h); g.lineTo(x, baseY - h * 1.08); g.lineTo(Rx(baseY - h), baseY - h);
  g.stroke(); g.restore();
  const y1 = baseY - h * 0.72, y2 = baseY - h * 0.88;
  return [[x - arm, y1 + h * 0.03], [x + arm, y1 + h * 0.03], [x - arm * 0.75, y2 + h * 0.03], [x + arm * 0.75, y2 + h * 0.03]];   // four conductors
}

// ---------------------------------------------------------------- the plains (americana, painted): horizon, bands, river, rail
export function plains(g, { hor = 1020, t = 0, river = true, rail = true, vp = 540 } = {}) {
  sky(g, 0, hor, P.skyTop, P.skyHor);
  // far haze band
  rect(g, 0, hor - 6, W, 30, '#a9b8a8');
  // field bands in perspective: rows of patches whose depth compresses toward the horizon
  const r = rng(11);
  let z = 1.0;
  for (let row = 0; row < 26; row++) {
    const z1 = z * 1.28, y0 = hor + 900 / z1 * 0.9, y1 = hor + 900 / z * 0.9;
    let x = -600 + r() * 200;
    while (x < W + 600) {
      const wdt = (260 + r() * 420); const col = [P.wheat, P.green, P.wheatSh, P.green2, P.soil, P.wheat][Math.floor(r() * 6)];
      const X = (xx, y) => vp + (xx - vp) * (y - hor) / (y1 - hor + 1e-3) * 1;
      poly(g, [[X(x, y1), y1], [X(x + wdt, y1), y1], [vp + (x + wdt - vp) * (y0 - hor) / (y1 - hor), y0], [vp + (x - vp) * (y0 - hor) / (y1 - hor), y0]], col);
      x += wdt;
    }
    z = z1; if (y0 - hor < 3) break;
  }
  // furrow lines converge on the vanishing point
  g.strokeStyle = 'rgba(70,50,20,0.16)'; g.lineWidth = 2; for (let k = -30; k <= 30; k++) { g.beginPath(); g.moveTo(vp + k * 4, hor); g.lineTo(vp + k * 170, H + 40); g.stroke(); }
  if (river) {        // a river winding in from the lower left to the horizon
    g.fillStyle = P.river; g.beginPath();
    const pts = []; for (let i = 0; i <= 40; i++) { const u = i / 40, y = lerp(H + 20, hor + 2, Math.pow(u, 0.55)), wdt = lerp(300, 4, u), cxr = lerp(120, vp - 160, u) + Math.sin(u * 9) * 170 * (1 - u); pts.push([cxr, y, wdt]); }
    g.moveTo(pts[0][0] - pts[0][2], pts[0][1]); for (const [x, y, w] of pts) g.lineTo(x - w, y); for (let i = pts.length - 1; i >= 0; i--) g.lineTo(pts[i][0] + pts[i][2], pts[i][1]); g.closePath(); g.fill();
    g.fillStyle = 'rgba(207,225,234,0.5)'; for (const [x, y, w] of pts.filter((_, i) => i % 3 === 0)) g.fillRect(x - w * 0.5, y, w * 0.6, Math.max(1, w * 0.03));
  }
  if (rail) {         // the rail line: ballast, ties, two rails running to the horizon at the right of the vanishing point
    const bx = vp + 40; const X = (dx, y) => bx + dx * (y - hor) / (H - hor);
    poly(g, [[X(-40, hor), hor], [X(40, hor), hor], [X(700, H), H], [X(260, H), H]], '#8c8378');
    for (let k = 0; k < 60; k++) { const y = hor + (H - hor) * Math.pow(k / 60, 2.2); const a = X(330, y), b = X(630, y); g.fillStyle = '#4a3a2c'; g.fillRect(a, y, b - a, Math.max(1, (y - hor) * 0.02)); }
    g.strokeStyle = '#d9dde2'; g.lineWidth = 3; g.beginPath(); g.moveTo(X(0, hor), hor); g.lineTo(X(380, H), H); g.moveTo(X(10, hor), hor); g.lineTo(X(580, H), H); g.stroke();
  }
  return hor;
}

// ---------------------------------------------------------------- the red light room (the second world)
export function redRoom(g, { k = 0, aperture = [300, 520, 480, 760], reveal = 0 } = {}) {
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#3a0406'); gr.addColorStop(0.55, '#b00d14'); gr.addColorStop(1, '#2a0304');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const [ax, ay, aw, ah] = aperture;
  const rg = g.createRadialGradient(ax + aw / 2, ay + ah / 2, 40, ax + aw / 2, ay + ah / 2, 900);
  rg.addColorStop(0, 'rgba(255,90,70,0.9)'); rg.addColorStop(1, 'rgba(255,40,30,0)'); g.fillStyle = rg; g.fillRect(0, 0, W, H);
  rect(g, ax, ay, aw, ah, '#ff4a36'); rect(g, ax + aw * 0.08, ay + ah * 0.06, aw * 0.84, ah * 0.88, '#ff7a52');
  // the floor plane: a hard line and a reflected glow
  const fy = ay + ah + 120; rect(g, 0, fy, W, H - fy, '#5a0508');
  const fg = g.createRadialGradient(ax + aw / 2, fy, 10, ax + aw / 2, fy, 700); fg.addColorStop(0, 'rgba(255,80,50,0.55)'); fg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = fg; g.fillRect(0, fy, W, H - fy);
  return fy;
}

// ---------------------------------------------------------------- a worker's back, poster scale (the crew chief / the welder standing)
// drawn as a designed silhouette: hard hat or lowered hood, work jacket, a hand closed; a rim toward the sun
export function backFigure(g, x, footY, h, { hat = 'hard', ink = P.ink, rim = '#fff3d6', rimSide = -1, fist = false, hood = false, beard = null } = {}) {
  const s = h / 1000;
  const path = () => {
    g.beginPath();
    g.moveTo(x - 150 * s, footY);                        // left boot
    g.lineTo(x - 128 * s, footY - 460 * s);              // outer leg
    g.lineTo(x - 176 * s, footY - 520 * s);              // jacket hem
    g.lineTo(x - 190 * s, footY - 700 * s);
    g.quadraticCurveTo(x - 200 * s, footY - 790 * s, x - 150 * s, footY - 815 * s);   // shoulder
    g.quadraticCurveTo(x - 90 * s, footY - 835 * s, x - 48 * s, footY - 840 * s);      // trapezius to the neck
    g.lineTo(x - 44 * s, footY - 870 * s);
    g.quadraticCurveTo(x - 62 * s, footY - 960 * s, x, footY - 968 * s);             // back of the head
    g.quadraticCurveTo(x + 62 * s, footY - 960 * s, x + 46 * s, footY - 870 * s);
    g.lineTo(x + 50 * s, footY - 840 * s);
    g.quadraticCurveTo(x + 92 * s, footY - 835 * s, x + 150 * s, footY - 815 * s);
    g.quadraticCurveTo(x + 200 * s, footY - 790 * s, x + 190 * s, footY - 700 * s);
    g.lineTo(x + 176 * s, footY - 520 * s);
    g.lineTo(x + 128 * s, footY - 460 * s);
    g.lineTo(x + 150 * s, footY);
    g.lineTo(x + 30 * s, footY); g.lineTo(x + 10 * s, footY - 420 * s); g.lineTo(x - 10 * s, footY - 420 * s); g.lineTo(x - 30 * s, footY);
    g.closePath();
    // arms hanging, a closed hand at each side
    g.moveTo(x - 190 * s, footY - 700 * s); g.lineTo(x - 214 * s, footY - 470 * s); g.lineTo(x - 176 * s, footY - 440 * s); g.lineTo(x - 168 * s, footY - 680 * s); g.closePath();
    g.moveTo(x + 190 * s, footY - 700 * s); g.lineTo(x + 214 * s, footY - 470 * s); g.lineTo(x + 176 * s, footY - 440 * s); g.lineTo(x + 168 * s, footY - 680 * s); g.closePath();
    g.moveTo(x - 196 * s + 30 * s, footY - 450 * s); g.arc(x - 196 * s, footY - 450 * s, 30 * s, 0, Math.PI * 2);
    g.moveTo(x + 196 * s + 30 * s, footY - 450 * s); g.arc(x + 196 * s, footY - 450 * s, 30 * s, 0, Math.PI * 2);
    if (hat === 'hard') {      // V-Gard from behind: egg crown, drip rim
      g.moveTo(x - 92 * s, footY - 925 * s); g.quadraticCurveTo(x - 86 * s, footY - 1040 * s, x, footY - 1046 * s);
      g.quadraticCurveTo(x + 86 * s, footY - 1040 * s, x + 92 * s, footY - 925 * s); g.lineTo(x + 100 * s, footY - 918 * s); g.lineTo(x - 100 * s, footY - 918 * s); g.closePath();
    }
    if (hood) {                // welding hood down, seen from behind: a squared shell over the head and its harness
      g.moveTo(x - 80 * s, footY - 880 * s); g.lineTo(x - 88 * s, footY - 1000 * s); g.quadraticCurveTo(x, footY - 1050 * s, x + 88 * s, footY - 1000 * s); g.lineTo(x + 80 * s, footY - 880 * s); g.closePath();
    }
  };
  // rim: the shape, offset away from the light, cut out of a lit copy
  g.save(); g.fillStyle = rim; path(); g.fill('nonzero'); g.restore();
  g.save(); g.translate(-rimSide * Math.max(2, 9 * s), 3 * s); g.fillStyle = ink; path(); g.fill('nonzero'); g.restore();
  if (hat === 'hard') { g.save(); g.fillStyle = P.yellow; g.translate(-rimSide * 9 * s, 3 * s); g.beginPath();
    g.moveTo(x - 92 * s, footY - 925 * s); g.quadraticCurveTo(x - 86 * s, footY - 1040 * s, x, footY - 1046 * s); g.quadraticCurveTo(x + 86 * s, footY - 1040 * s, x + 92 * s, footY - 925 * s); g.lineTo(x + 100 * s, footY - 918 * s); g.lineTo(x - 100 * s, footY - 918 * s); g.closePath(); g.fill();
    g.fillStyle = '#b88a0c'; g.beginPath(); g.moveTo(x + 20 * s, footY - 1040 * s); g.quadraticCurveTo(x + 86 * s, footY - 1030 * s, x + 92 * s, footY - 925 * s); g.lineTo(x + 100 * s, footY - 918 * s); g.lineTo(x + 40 * s, footY - 918 * s); g.closePath(); g.fill(); g.restore(); }
  // jacket seam and a reflective band (safety yellow) across the back
  g.save(); g.translate(-rimSide * 9 * s, 3 * s); g.fillStyle = 'rgba(242,191,29,0.9)'; g.fillRect(x - 186 * s, footY - 640 * s, 372 * s, 26 * s); g.restore();
}

// ---------------------------------------------------------------- the welder in lost profile under a lifted hood
// seen from behind his left shoulder, face turned away toward the arc (right); lit only by the arc: a rim on the brow,
// cheekbone, beard and throat, the ear's helix, the hood's edge. `age` 1 -> 0 steps him younger: the beard and the hair
// at the nape grey -> dark, the head drops forward less, the shoulders square. hood 0 = tipped up on the crown, 1 = down.
export function welder(g, { age = 1, hood = 0, flash = 0, rimCol = '#e4eeff', dx = -18, dy = 7, ox = 0, oy = 0, sc = 1 } = {}) {
  const tilt = 0.05 + age * 0.16, drop = age * 34, slump = age * 40;
  const rim = lerpCol(rimCol, '#ffffff', flash);
  g.save(); g.translate(ox, oy); g.translate(540, 1920); g.scale(sc, sc); g.translate(-540, -1920);
  // body: trapezius, collar of the leather jacket, the right shoulder falling toward the arc
  const body = new Path2D();
  body.moveTo(-60, 1960); body.lineTo(-60, 1420 + slump);
  body.bezierCurveTo(90, 1330 + slump, 250, 1270 + slump * 0.7, 360, 1190 + slump * 0.4);
  body.lineTo(395, 1080 + drop * 0.5);                   // back of the neck
  body.lineTo(640, 1130 + drop * 0.5);                   // throat, under the beard
  body.bezierCurveTo(690, 1190, 720, 1240, 790, 1270 + slump * 0.3);   // collar front
  body.bezierCurveTo(900, 1320 + slump * 0.3, 990, 1420 + slump * 0.2, 1030, 1600);
  body.lineTo(1080, 1960); body.closePath();
  const collar = new Path2D(); collar.moveTo(360, 1190 + slump * 0.4); collar.lineTo(420, 1140 + drop * 0.5); collar.lineTo(650, 1175 + drop * 0.4); collar.lineTo(790, 1270 + slump * 0.3); collar.lineTo(700, 1300); collar.lineTo(420, 1230); collar.closePath();
  // the head, pivoting forward about the neck with age
  const piv = [520, 1110];
  g.save();
  const headT = (fn) => { g.save(); g.translate(piv[0], piv[1] + drop * 0.6); g.rotate(tilt); g.translate(-piv[0], -piv[1]); fn(); g.restore(); };
  const head = new Path2D();
  head.moveTo(430, 1100);
  head.bezierCurveTo(340, 1040, 300, 900, 320, 790);              // back of the skull
  head.bezierCurveTo(340, 640, 450, 560, 560, 560);                // crown
  head.bezierCurveTo(650, 562, 712, 610, 728, 690);                // forehead turning away
  head.bezierCurveTo(736, 720, 730, 745, 722, 760);                // brow ridge
  head.bezierCurveTo(726, 790, 742, 805, 748, 835);                // under the brow: the cheekbone rises
  head.lineTo(764, 862); head.lineTo(750, 872);                     // the nose tip, just past the cheek
  head.bezierCurveTo(748, 905, 744, 930, 750, 960);                // cheek into the beard
  head.bezierCurveTo(756, 1010, 748, 1060, 722, 1092);             // beard to the point of the chin
  head.bezierCurveTo(700, 1120, 660, 1132, 632, 1134);             // under the jaw, back to the throat
  head.lineTo(430, 1100); head.closePath();
  const beardP = new Path2D();
  beardP.moveTo(600, 880); beardP.bezierCurveTo(660, 900, 720, 900, 746, 915);
  beardP.bezierCurveTo(744, 930, 744, 945, 750, 960); beardP.bezierCurveTo(756, 1010, 748, 1060, 722, 1092);
  beardP.bezierCurveTo(700, 1120, 660, 1132, 632, 1134); beardP.lineTo(560, 1112); beardP.bezierCurveTo(590, 1040, 590, 950, 600, 880); beardP.closePath();
  const hairP = new Path2D();          // short hair over the back of the skull, cut above the ear, the nape line
  hairP.moveTo(440, 1060); hairP.bezierCurveTo(350, 1010, 312, 890, 326, 790); hairP.bezierCurveTo(345, 650, 450, 570, 560, 568);
  hairP.bezierCurveTo(640, 570, 690, 610, 706, 660); hairP.bezierCurveTo(640, 680, 600, 740, 560, 780); hairP.bezierCurveTo(520, 820, 500, 900, 520, 980); hairP.bezierCurveTo(500, 1020, 470, 1050, 440, 1060); hairP.closePath();
  const ear = new Path2D();            // the ear from behind: the helix curling toward us
  ear.moveTo(560, 800); ear.bezierCurveTo(520, 800, 510, 860, 522, 900); ear.bezierCurveTo(532, 940, 560, 950, 578, 930); ear.bezierCurveTo(570, 880, 584, 830, 560, 800); ear.closePath();
  // the hood: a shell tipped up on the crown (pivot at the temple), swinging down over the face
  const down = hood >= 0.5;
  const hp = [610, 760], ha = down ? lerp(-0.5, 0, (hood - 0.5) * 2) : lerp(0, 0.9, hood * 2);
  const hoodP = new Path2D(), lens = new Path2D();
  if (!down) {        // tipped up on the crown: a deep shell, its face plate toward the sky
    hoodP.moveTo(372, 660); hoodP.bezierCurveTo(390, 500, 540, 420, 700, 440); hoodP.bezierCurveTo(800, 452, 868, 500, 900, 566);
    hoodP.lineTo(862, 640); hoodP.bezierCurveTo(820, 600, 740, 575, 650, 578); hoodP.bezierCurveTo(540, 580, 460, 610, 430, 690); hoodP.closePath();
    lens.moveTo(760, 470); lens.lineTo(860, 512); lens.lineTo(848, 548); lens.lineTo(748, 506); lens.closePath();
  } else {            // down: the shield over the face, from the brow to below the chin
    hoodP.moveTo(560, 560); hoodP.bezierCurveTo(660, 540, 760, 580, 790, 680); hoodP.bezierCurveTo(816, 780, 820, 960, 800, 1060);
    hoodP.bezierCurveTo(790, 1120, 740, 1160, 660, 1160); hoodP.bezierCurveTo(640, 1080, 640, 900, 620, 760); hoodP.bezierCurveTo(610, 680, 590, 610, 560, 560); hoodP.closePath();
    lens.moveTo(760, 790); lens.lineTo(806, 794); lens.lineTo(808, 850); lens.lineTo(760, 846); lens.closePath();
  }
  const drawHood = (fill, off = [0, 0]) => { g.save(); g.translate(hp[0], hp[1]); g.rotate(ha); g.translate(-hp[0] + off[0], -hp[1] + off[1]); g.fillStyle = fill; g.fill(hoodP); g.restore(); };
  // 1. rim pass (everything in the arc's colour), 2. the dark forms offset away from the arc
  g.fillStyle = rim; g.fill(body);
  headT(() => { g.fillStyle = rim; g.fill(head); });
  drawHood(rim);
  g.save(); g.translate(dx, dy); g.fillStyle = '#07080b'; g.fill(body); g.restore();
  g.fillStyle = '#0d0e12'; g.fill(collar);
  headT(() => {
    g.save(); g.translate(dx, dy); g.fillStyle = '#08090c'; g.fill(head); g.restore();
    // grey hair and beard catch the arc's spill; dark hair and beard stay in the silhouette
    const hc = age > 0.02 ? lerpCol('#141418', '#77767a', age) : '#101014';
    g.save(); g.clip(head); g.translate(dx * 0.4, dy * 0.4); g.fillStyle = hc; g.globalAlpha = 0.9; g.fill(hairP); g.restore();
    const bc = lerpCol('#140f0c', '#a9a6a0', age);
    g.save(); g.clip(head); g.fillStyle = bc; g.globalAlpha = 0.35 + 0.55 * age; g.fill(beardP);
    g.strokeStyle = lerpCol('#241a14', '#d6d3cc', age); g.lineWidth = 2.2; g.globalAlpha = 0.6 + 0.3 * age;
    for (let k = 0; k < 40; k++) { const u = k / 39, y = lerp(905, 1128, u), x = lerp(746, 640, Math.pow(u, 2.2)) - 4; g.beginPath(); g.moveTo(x - 14, y - 3); g.lineTo(x + 9, y + 6); g.stroke(); }
    g.restore();
    // the ear: dark, its helix edge lit
    g.save(); g.fillStyle = rim; g.globalAlpha = 0.55; g.translate(6, -2); g.fill(ear); g.restore();
    g.fillStyle = '#0a0b0e'; g.fill(ear);
    drawHood('#0e1014', [dx * 0.7, dy * 0.7]);
    g.save(); g.translate(hp[0], hp[1]); g.rotate(ha); g.translate(-hp[0], -hp[1]); g.fillStyle = lerpCol('#1a2a1c', '#e2cf62', down ? 0.35 + 0.65 * flash : 0.2 + 0.3 * flash); g.fill(lens);
    g.restore(); if (!down) { g.strokeStyle = '#2a2d33'; g.lineWidth = 7; g.beginPath(); g.moveTo(440, 720); g.quadraticCurveTo(540, 700, 640, 745); g.stroke(); }
  });
  g.restore(); g.restore();
}
export function lerpCol(a, b, u) {
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16)), pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16)); u = clamp(u);
  return `rgb(${pa.map((v, i) => Math.round(lerp(v, pb[i], u))).join(',')})`;
}

// the arc: a white star with a blue corona and flying sparks (the only light in the welder's world)
export function arcLight(g, x, y, k, t, { sparks = 60, seed = 4, big = 1 } = {}) {
  const R = (120 + 220 * k) * big;
  const rg = g.createRadialGradient(x, y, 2, x, y, R * 3); rg.addColorStop(0, `rgba(210,230,255,${0.6 * k})`); rg.addColorStop(0.3, `rgba(90,140,255,${0.22 * k})`); rg.addColorStop(1, 'rgba(0,0,40,0)');
  g.fillStyle = rg; g.fillRect(x - R * 3, y - R * 3, R * 6, R * 6);
  g.save(); g.translate(x, y); g.fillStyle = '#ffffff';
  for (let i = 0; i < 4; i++) { g.rotate(Math.PI / 4); g.beginPath(); g.moveTo(-R * 0.9, 0); g.lineTo(0, -R * 0.035); g.lineTo(R * 0.9, 0); g.lineTo(0, R * 0.035); g.closePath(); g.fill(); }
  g.beginPath(); g.arc(0, 0, R * 0.12, 0, Math.PI * 2); g.fill(); g.restore();
  const r = rng(seed + Math.floor(t * 30));
  g.strokeStyle = '#ffd98a'; g.lineCap = 'round';
  for (let i = 0; i < sparks * k; i++) { const a = -Math.PI * (0.05 + 0.9 * r()), d = (60 + 520 * r()) * big, l = (20 + 60 * r()) * big; g.lineWidth = 1.5 + 2.5 * r();
    const x0 = x + Math.cos(a) * d, y0 = y + Math.sin(a) * d * 0.7 + d * d * 0.0006; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + Math.cos(a) * l, y0 + Math.sin(a) * l * 0.7 + l * 0.3); g.stroke(); }
}

// ---------------------------------------------------------------- a mill town from above (the wave sweeps it)
export function millTown(g, { t = 0, seed = 21 } = {}) {
  rect(g, 0, 0, W, H, '#c9c1b0');
  const r = rng(seed);
  // streets: a grid rotated a little, the river through it
  g.save(); g.translate(W / 2, H / 2); g.rotate(0.18); g.translate(-W / 2, -H / 2);
  const bs = 150;
  for (let by = -300; by < H + 300; by += bs) for (let bx = -300; bx < W + 300; bx += bs) {
    const kind = r();
    rect(g, bx + 12, by + 12, bs - 24, bs - 24, '#ddd6c6');
    if (kind < 0.55) {        // row houses: small roofs with their shadows to the lower right
      for (let k = 0; k < 4; k++) { const x = bx + 18 + k * 30, y = by + 20; rect(g, x + 8, y + 8, 24, 50, 'rgba(40,36,34,0.45)'); rect(g, x, y, 24, 50, k % 2 ? '#b8543a' : '#a0442e'); rect(g, x, y, 12, 50, '#c86a4c');
        rect(g, x + 8, y + 70, 24, 40, 'rgba(40,36,34,0.45)'); rect(g, x, y + 62, 24, 40, '#7d8a94'); }
    } else if (kind < 0.8) {  // a works: sawtooth roof and a stack
      rect(g, bx + 32, by + 32, bs - 44, bs - 44, 'rgba(40,36,34,0.45)');
      for (let k = 0; k < 5; k++) { rect(g, bx + 20, by + 20 + k * 22, bs - 44, 11, '#e9e6de'); rect(g, bx + 20, by + 31 + k * 22, bs - 44, 11, '#8f9aa5'); }
      g.fillStyle = 'rgba(40,36,34,0.5)'; g.beginPath(); g.moveTo(bx + 110, by + 40); g.lineTo(bx + 250, by + 120); g.lineTo(bx + 256, by + 110); g.lineTo(bx + 118, by + 30); g.fill();
      g.fillStyle = P.brick; g.beginPath(); g.arc(bx + 112, by + 36, 11, 0, Math.PI * 2); g.fill();
    } else {                  // a yard with a water tower
      rect(g, bx + 20, by + 20, bs - 40, bs - 40, '#9fa96a');
      g.fillStyle = 'rgba(40,36,34,0.45)'; g.beginPath(); g.ellipse(bx + 95, by + 95, 30, 14, 0.6, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#d8dde3'; g.beginPath(); g.arc(bx + 75, by + 75, 24, 0, Math.PI * 2); g.fill(); g.fillStyle = '#9aa4ad'; g.beginPath(); g.arc(bx + 80, by + 80, 18, 0, Math.PI * 2); g.fill();
    }
  }
  g.restore();
  // the river across the lower third
  g.fillStyle = P.river; g.beginPath(); g.moveTo(-40, 1380); g.bezierCurveTo(300, 1300, 700, 1560, W + 40, 1440); g.lineTo(W + 40, 1600); g.bezierCurveTo(700, 1720, 300, 1470, -40, 1560); g.closePath(); g.fill();
}
