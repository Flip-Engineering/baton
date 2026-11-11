// THE FACTORY (machines_e1): the worlds. Plant, gate, banners, machines, the four stations, the stipple rings, the
// print treatment and the figure overlays. Everything is 2D canvas, near-black silhouettes against light: the
// machinery is monumental black geometry behind the man (Sheeler's River Rouge, Ferriss's light from below, Rivera's
// stamping press), never the hero image; people are silhouettes, backs, or print.
//
// Exports (frame px unless noted):
//   bgA(o)          the cold gate at 5:40 a.m. (sky, fog, the plant on the horizon, fence, lamps) -> canvas
//   bgB(o)          the plant behind the gate at sodium dawn (conveyor bridges, sawtooth roof, the open bay) -> canvas
//   pressLine(g, u) the press line inside the bay (slides on the beat), robots, sparks: drawn live over bgB
//   gate(g, geo)    the gate posts, the steel sign frame (truss), the fence leaves
//   Banners         the UNDER NEW MANAGEMENT layers (picture text): make, slap, wrinkle, tear
//   station(g, k, x, y, s, u)   the four exaggerated station silhouettes of world C (press, weld arm, paint booth,
//                   conveyor); returns the working point
//   stipple(g, cx, cy, R, o)    one cream stipple ring;  halftone(g, src, o)  a Klutsis dot screen of a tone canvas
//   defenders(g, u, o)  the ear defenders + the glasses on the brim, in the trucker's local head units
//   backWorker(g, o)    the line worker from behind (cap, the defenders' band and cups, jacket, the lunch pail)
//   SilRim            SIL atlas cells as ink + rim (the crowd), cached per cell
import { spline, rough, tracePath, CAPPIV, TRUCKER } from './machines.figures.js';

export const W = 1080, H = 1920;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, x) => a + (b - a) * x;
export function hash(i) { let x = Math.imul((i | 0) ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; }
const cnv = (w = W, h = H) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const ctx2 = c => c.getContext('2d', { willReadFrequently: true });
function grad(g, y0, y1, stops) { const G = g.createLinearGradient(0, y0, 0, y1); for (const [o, c] of stops) G.addColorStop(o, c); return G; }
function rect(g, x, y, w, h) { g.fillRect(x, y, w, h); }

// ---------------------------------------------------------------- a steel truss (Sheeler's conveyor bridges, the sign frame)
// from (x0,y0) to (x1,y1), depth d px, panel length p, chord width cw, web width ww
export function truss(g, x0, y0, x1, y1, d, { p = null, cw = 4, ww = 2, fill = null } = {}) {
  const L = Math.hypot(x1 - x0, y1 - y0), a = Math.atan2(y1 - y0, x1 - x0);
  p = p || d * 1.1;
  g.save(); g.translate(x0, y0); g.rotate(a);
  if (fill) { g.fillStyle = fill; g.fillRect(0, -d / 2, L, d); }
  g.fillRect(0, -d / 2 - cw / 2, L, cw); g.fillRect(0, d / 2 - cw / 2, L, cw);
  g.lineWidth = ww; g.beginPath();
  const n = Math.max(1, Math.round(L / p));
  for (let i = 0; i <= n; i++) {
    const x = i * L / n; g.moveTo(x, -d / 2); g.lineTo(x, d / 2);
    if (i < n) { const x2 = (i + 1) * L / n; if (i % 2) { g.moveTo(x, -d / 2); g.lineTo(x2, d / 2); } else { g.moveTo(x, d / 2); g.lineTo(x2, -d / 2); } }
  }
  g.stroke(); g.restore();
}

// ---------------------------------------------------------------- the water tower (a tank on splayed, X-braced legs)
function waterTower(g, cx, top, s) {
  const tw = 0.85 * s, th = 0.62 * s, legTop = top + th + 0.28 * s, base = top + 2.9 * s;
  g.beginPath(); g.moveTo(cx - tw * 0.08, top - 0.05 * s); g.lineTo(cx, top - 0.2 * s); g.lineTo(cx + tw * 0.08, top - 0.05 * s); g.fill();   // finial
  g.beginPath(); g.moveTo(cx - tw / 2, top + 0.12 * s); g.lineTo(cx, top - 0.06 * s); g.lineTo(cx + tw / 2, top + 0.12 * s); g.fill();       // roof cone
  g.fillRect(cx - tw / 2, top + 0.1 * s, tw, th);
  g.beginPath(); g.ellipse(cx, top + 0.1 * s + th, tw / 2, 0.22 * s, 0, 0, Math.PI); g.fill();                                    // the bowl
  g.fillRect(cx - tw / 2 - 3, top + 0.1 * s + th * 0.3, tw + 6, 3);                                                                  // catwalk
  g.lineWidth = Math.max(2, 0.05 * s);
  const legs = [-0.42, -0.14, 0.14, 0.42];
  g.beginPath();
  for (const l of legs) { g.moveTo(cx + l * tw * 0.8, legTop); g.lineTo(cx + l * tw * 1.25, base); }
  g.stroke();
  g.lineWidth = Math.max(1, 0.02 * s); g.beginPath();
  for (let k = 0; k < 3; k++) {
    const ya = lerp(legTop, base, k / 3), yb = lerp(legTop, base, (k + 1) / 3);
    const xa = lerp(0.42 * 0.8, 0.42 * 1.25, k / 3) * tw, xb = lerp(0.42 * 0.8, 0.42 * 1.25, (k + 1) / 3) * tw;
    g.moveTo(cx - xa, ya); g.lineTo(cx + xb, yb); g.moveTo(cx + xa, ya); g.lineTo(cx - xb, yb);
    g.moveTo(cx - xb, yb); g.lineTo(cx + xb, yb);
  }
  g.moveTo(cx, legTop); g.lineTo(cx, base); g.stroke();
}

// ---------------------------------------------------------------- a sawtooth roof run (teeth face right, glazing lit)
function sawtooth(g, x0, x1, y, per, h, glaze = null, glazeA = 0.4) {
  g.beginPath(); g.moveTo(x0, y + 40);
  for (let x = x0; x < x1; x += per) { g.lineTo(x, y); g.lineTo(x + per * 0.8, y - h); g.lineTo(x + per * 0.8, y); }
  g.lineTo(x1, y); g.lineTo(x1, y + 40); g.closePath(); g.fill();
  if (glaze) {
    const f = g.fillStyle; g.save(); g.globalAlpha = glazeA; g.fillStyle = glaze;
    for (let x = x0; x < x1; x += per) g.fillRect(x + per * 0.8 - 2.2, y - h + 3, 2.2, h - 5);
    g.restore(); g.fillStyle = f;
  }
}

function fogBands(g, y0, y1, col, n, seed, amp) {
  for (let i = 0; i < n; i++) {
    const y = lerp(y0, y1, hash(seed + i * 3)), h = 20 + 90 * hash(seed + i * 7), x = -200 + 1480 * hash(seed + i * 11) - 400;
    const G = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    G.addColorStop(0, col.replace('A', String(amp * (0.4 + 0.6 * hash(seed + i))))); G.addColorStop(1, col.replace('A', '0'));
    g.save(); g.translate(x + 400, y); g.scale(500 + 500 * hash(seed + i * 5), h); g.fillStyle = G; g.fillRect(-1, -1, 2, 2); g.restore();
  }
}

// ================================================================ WORLD A: the cold gate, 5:40 a.m.
export const HZ_A = 1370;                       // the horizon in A (frame px at zoom 1)
export const GATE_A = { x0: 540, x1: 860, top: 1196, base: 1492, bx: 700, by: 1212, bw: 300, bh: 74 };
export function bgA({ red = false } = {}) {
  const c = cnv(), g = ctx2(c);
  if (red) {                                    // A-red: the sky turned the dot's colour, flat poster red
    g.fillStyle = '#C91F37'; g.fillRect(0, 0, W, H);
    g.fillStyle = grad(g, HZ_A - 500, HZ_A, [[0, 'rgba(120,8,20,0)'], [1, 'rgba(120,8,20,0.55)']]); g.fillRect(0, HZ_A - 500, W, 500);
  } else {
    g.fillStyle = grad(g, 0, HZ_A, [[0, '#191d23'], [0.42, '#22272D'], [0.72, '#2B3036'], [0.93, '#4b525b'], [1, '#6a727c']]);
    g.fillRect(0, 0, W, HZ_A);
    fogBands(g, 300, HZ_A - 80, 'rgba(120,130,142,A)', 14, 17, 0.07);
    fogBands(g, HZ_A - 260, HZ_A - 20, 'rgba(150,160,170,A)', 10, 41, 0.12);
  }
  const ink = red ? '#1a0406' : '#171b20', ink2 = red ? '#240709' : '#20252b';
  // the far plant: long sawtooth sheds, the press hall with its monitor roof, the water tower (no stacks)
  g.fillStyle = ink2;
  sawtooth(g, -40, 1140, HZ_A - 34, 40, 20, red ? null : '#76808b', 0.3);
  g.fillRect(-40, HZ_A - 34, 1180, 34);
  g.fillStyle = ink;
  g.fillRect(90, HZ_A - 190, 330, 190); g.fillRect(140, HZ_A - 222, 220, 34);                  // the press hall + monitor
  for (let i = 0; i < 9; i++) { g.fillStyle = red ? 'rgba(255,120,90,0.12)' : 'rgba(150,165,180,0.10)'; g.fillRect(150 + i * 24, HZ_A - 214, 12, 18); }
  g.fillStyle = ink;
  g.fillRect(430, HZ_A - 120, 330, 120);
  waterTower(g, 950, HZ_A - 510, 176);
  // lamps along the fence (sodium, the only warm light in the cold)
  for (const [x, h] of [[40, 250], [470, 230], [1060, 260]]) {
    g.fillStyle = ink; g.fillRect(x - 2, HZ_A - h, 4, h + 90);
    g.fillRect(x - 14, HZ_A - h, 28, 7);
    if (!red) {
      const G = g.createRadialGradient(x, HZ_A - h + 9, 0, x, HZ_A - h + 9, 70);
      G.addColorStop(0, 'rgba(255,170,90,0.55)'); G.addColorStop(0.15, 'rgba(255,150,70,0.18)'); G.addColorStop(1, 'rgba(255,140,60,0)');
      g.fillStyle = G; g.fillRect(x - 70, HZ_A - h - 60, 140, 140);
      g.fillStyle = '#ffd08a'; g.fillRect(x - 8, HZ_A - h + 6, 16, 3);
    }
  }
  // the lot
  g.fillStyle = grad(g, HZ_A, H, red ? [[0, '#4a0a10'], [0.4, '#3a0609'], [1, '#2a0508']] : [[0, '#3c434c'], [0.35, '#2a3038'], [1, '#1c2026']]); g.fillRect(0, HZ_A, W, H - HZ_A);
  if (!red) for (const [x, h] of [[40, 250], [470, 230], [1060, 260]]) { g.fillStyle = grad(g, HZ_A, HZ_A + 420, [[0, 'rgba(255,160,80,0.22)'], [1, 'rgba(255,160,80,0)']]); g.fillRect(x - 5, HZ_A, 10, 420); }
  g.fillStyle = grad(g, HZ_A, HZ_A + 60, [[0, red ? 'rgba(200,40,50,0.25)' : 'rgba(110,120,130,0.22)'], [1, 'rgba(0,0,0,0)']]); g.fillRect(0, HZ_A, W, 60);
  // the fence: chain-link panels either side of the gate
  g.strokeStyle = red ? 'rgba(20,3,5,0.8)' : 'rgba(18,21,25,0.85)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, HZ_A + 20); g.lineTo(GATE_A.x0, HZ_A + 32); g.moveTo(0, HZ_A + 118); g.lineTo(GATE_A.x0, HZ_A + 122); g.stroke();
  g.lineWidth = 1; g.globalAlpha = 0.5; g.beginPath();
  for (let x = 0; x < GATE_A.x0; x += 7) { g.moveTo(x, HZ_A + 20 + x * 0.017); g.lineTo(x + 50, HZ_A + 120); g.moveTo(x + 50, HZ_A + 20 + x * 0.017); g.lineTo(x, HZ_A + 120); }
  g.stroke(); g.globalAlpha = 1;
  return c;
}

// the gate in A (posts, the sign frame, barbed wire); `empty` frames are the same (the banner layers are drawn after)
export function gateA(g, { red = false, stencil = true } = {}) {
  const G = GATE_A, ink = red ? '#14030a' : '#101318';
  g.fillStyle = ink; g.strokeStyle = ink;
  g.fillRect(G.x0 - 9, G.top - 10, 18, G.base - G.top + 10); g.fillRect(G.x1 - 9, G.top - 10, 18, G.base - G.top + 10);
  g.fillRect(G.x0 - 14, G.top - 16, 28, 8); g.fillRect(G.x1 - 14, G.top - 16, 28, 8);
  truss(g, G.x0, G.top + 4, G.x1, G.top + 4, 16, { cw: 3.5, ww: 1.6 });
  // barbed wire arms
  g.lineWidth = 2; g.beginPath(); g.moveTo(G.x0, G.top - 10); g.lineTo(G.x0 - 22, G.top - 34); g.moveTo(G.x1, G.top - 10); g.lineTo(G.x1 + 22, G.top - 34); g.stroke();
  // the gate leaves, swung open, chain-link in perspective
  g.lineWidth = 3; g.beginPath(); g.moveTo(G.x0, G.base - 150); g.lineTo(G.x0 + 70, G.base - 140); g.lineTo(G.x0 + 70, G.base - 10); g.lineTo(G.x0, G.base); g.stroke();
  // the post stencil (picture text)
  if (stencil) {
    g.save(); g.fillStyle = red ? 'rgba(255,200,190,0.28)' : 'rgba(170,180,190,0.30)'; g.font = '700 13px "Big Shoulders Stencil Display"';
    g.translate(G.x0 + 1, G.top + 120); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText('1966', 0, 4); g.restore();
  }
}

// ================================================================ WORLD B: the plant behind the gate, sodium-red dawn
export const HZ_B = 1330;
export const BAY = { x0: 330, x1: 760, top: 1030, base: 1450, vx: 545, vy: 1250 };
export const GATE_B = { x0: 120, x1: 980, top: 660, base: 1640, bx: 550, by: 690, bw: 560, bh: 148 };
export function bgB() {
  const c = cnv(), g = ctx2(c);
  g.fillStyle = grad(g, 0, HZ_B, [[0, '#2a0604'], [0.35, '#5a1208'], [0.62, '#7E1A0C'], [0.86, '#C23A14'], [0.96, '#D2461A'], [1, '#F07A2A']]);
  g.fillRect(0, 0, W, HZ_B);
  // the sun's glow behind the hall (low, right of centre)
  const S = g.createRadialGradient(700, HZ_B - 40, 0, 700, HZ_B - 40, 700);
  S.addColorStop(0, 'rgba(255,170,80,0.55)'); S.addColorStop(0.25, 'rgba(240,110,40,0.25)'); S.addColorStop(1, 'rgba(200,60,20,0)');
  g.fillStyle = S; g.fillRect(0, 0, W, HZ_B + 100);
  fogBands(g, 200, 900, 'rgba(255,120,60,A)', 12, 5, 0.07);
  const ink = '#0a0605';
  g.fillStyle = ink; g.strokeStyle = ink;
  // the criss-crossed conveyor bridges (Sheeler, River Rouge 1927) across the dawn
  truss(g, -120, 560, 800, 1010, 44, { cw: 6, ww: 3, p: 50 });
  truss(g, 1200, 470, 330, 990, 40, { cw: 6, ww: 3, p: 46 });
  truss(g, 980, 820, 1200, 700, 30, { cw: 5, ww: 2.5, p: 36 });
  for (const [x, y] of [[180, 700], [620, 925], [860, 610], [1040, 516]]) { g.fillRect(x - 7, y, 14, 1200 - y); truss(g, x, y, x, HZ_B - 150, 20, { cw: 3, ww: 1.5 }); }
  // the water tower and a gantry beyond
  waterTower(g, 950, 690, 150);
  // the halls: stepped blocks, sawtooth sheds with their glazing lit from inside (sodium)
  g.fillStyle = ink;
  sawtooth(g, -40, 1140, HZ_B - 250, 62, 38, '#ffae5a', 0.55);
  g.fillRect(-40, HZ_B - 250, 1180, 300);
  g.fillRect(250, 900, 580, 200); g.fillRect(320, 860, 440, 44);          // the press hall and its monitor roof
  for (let i = 0; i < 14; i++) { g.save(); g.globalAlpha = 0.22 + 0.3 * hash(i); g.fillStyle = '#ffb45e'; g.fillRect(334 + i * 30, 870, 16, 24); g.restore(); }
  g.fillStyle = ink; g.fillRect(-40, HZ_B - 20, 1180, H);
  // Ferriss: the facades lit from below by the bay, upward falloff
  const F = g.createRadialGradient(BAY.vx, BAY.base, 0, BAY.vx, BAY.base, 620);
  F.addColorStop(0, 'rgba(255,150,60,0.30)'); F.addColorStop(0.5, 'rgba(230,100,40,0.10)'); F.addColorStop(1, 'rgba(200,70,30,0)');
  g.globalCompositeOperation = 'lighter'; g.fillStyle = F; g.fillRect(0, 800, W, 900); g.globalCompositeOperation = 'source-over';
  // the bay (the light source): sodium inside, hottest at the floor
  g.fillStyle = grad(g, BAY.top, BAY.base, [[0, '#8a3a10'], [0.45, '#e08a30'], [0.8, '#ffc670'], [1, '#fff0c0']]);
  g.fillRect(BAY.x0, BAY.top, BAY.x1 - BAY.x0, BAY.base - BAY.top);
  // the roller door's lip and the lintel
  g.fillStyle = ink; g.fillRect(BAY.x0 - 20, BAY.top - 26, BAY.x1 - BAY.x0 + 40, 30);
  g.globalAlpha = 0.6; g.fillRect(BAY.x0, BAY.top + 6, BAY.x1 - BAY.x0, 3); g.globalAlpha = 1;
  // the lot: dark, with the bay's light thrown across it
  g.fillStyle = grad(g, BAY.base, H, [[0, '#1a0b06'], [0.3, '#0f0706'], [1, '#070404']]); g.fillRect(0, BAY.base, W, H - BAY.base);
  const P = g.createRadialGradient(BAY.vx, BAY.base, 10, BAY.vx, BAY.base + 80, 520);
  P.addColorStop(0, 'rgba(255,190,110,0.55)'); P.addColorStop(0.4, 'rgba(230,110,40,0.16)'); P.addColorStop(1, 'rgba(0,0,0,0)');
  g.save(); g.translate(BAY.vx, BAY.base); g.scale(1.3, 0.35); g.translate(-BAY.vx, -BAY.base); g.fillStyle = P; g.fillRect(-400, BAY.base - 600, 1900, 1400); g.restore();
  return c;
}

// the press line inside the bay: three presses receding to the vanishing point, robots between, the sodium haze.
// u: 0..1 the slide's phase (1 = down on the die), beat: for sparks, k: the stamp flash
export function pressLine(g, { u = 0, beat = 0, flash = 0 } = {}) {
  const B = BAY;
  g.save();
  g.beginPath(); g.rect(B.x0, B.top, B.x1 - B.x0, B.base - B.top); g.clip();
  const ink = '#120805';
  const presses = [[0.28, 0.35], [0.52, 0.62], [1.0, 1.0]];
  for (let i = 0; i < presses.length; i++) {
    const [s, dz] = presses[i];
    const cx = B.vx + (i === 2 ? -30 : -8), base = lerp(B.vy + 30, B.base + 6, dz), h = 520 * s;
    const ph = clamp(u + (i === 2 ? 0 : -0.25 * (2 - i)));
    pressSil(g, cx, base, h, { slide: i === 2 ? u : Math.abs(Math.sin(Math.PI * ph)), ink: i === 2 ? ink : `rgba(18,8,5,${0.55 + 0.2 * i})` });
  }
  // two robot arms at the near press, reaching in (6-axis, black), a weld spark at the tip
  const arms = [[B.x0 + 40, B.base, 1, 0.3], [B.x1 - 40, B.base, -1, 0.9]];
  for (const [x, y, dir, ph] of arms) {
    const a = Math.sin((beat * 0.5 + ph) * Math.PI);
    const tip = robotArm(g, x, y, 170, dir, [0.55 + 0.1 * a, -1.2 - 0.2 * a, 0.9 + 0.2 * a], ink);
    const sp = (beat * 2 + ph * 3) % 1;
    if (sp < 0.35) sparks(g, tip[0], tip[1], sp / 0.35, 7 + Math.floor(beat * 2), 1);
  }
  // haze: light scattering in the bay
  g.globalCompositeOperation = 'screen';
  g.fillStyle = grad(g, B.top, B.base, [[0, 'rgba(255,160,70,0.10)'], [0.7, 'rgba(255,190,110,0.18)'], [1, 'rgba(255,220,160,0.32)']]);
  g.fillRect(B.x0, B.top, B.x1 - B.x0, B.base - B.top);
  if (flash > 0) { g.fillStyle = `rgba(255,236,190,${0.5 * flash})`; g.fillRect(B.x0, B.top, B.x1 - B.x0, B.base - B.top); }
  g.restore();
}

// ---------------------------------------------------------------- the stamping press (Rivera's Detroit Industry, exaggerated)
// cx: centre, base: floor y, h: height; slide 0 (up) .. 1 (down on the die)
export function pressSil(g, cx, base, h, { slide = 0, ink = '#0a0605', flywheel = true, detail = null } = {}) {
  const w = 0.64 * h;
  g.fillStyle = ink; g.strokeStyle = ink;
  g.fillRect(cx - w * 0.58, base - 0.12 * h, w * 1.16, 0.12 * h);                          // bed
  g.fillRect(cx - w * 0.46, base - 0.19 * h, w * 0.92, 0.08 * h);                          // bolster
  g.fillRect(cx - w * 0.5, base - 0.84 * h, w * 0.15, 0.7 * h);                             // columns
  g.fillRect(cx + w * 0.35, base - 0.84 * h, w * 0.15, 0.7 * h);
  g.fillRect(cx - w * 0.56, base - 1.0 * h, w * 1.12, 0.2 * h);                             // crown
  g.fillRect(cx - w * 0.6, base - 1.02 * h, w * 1.2, 0.03 * h);
  g.fillRect(cx - w * 0.18, base - 1.08 * h, w * 0.36, 0.08 * h);                           // the crown's gearbox
  const sy = base - 0.8 * h + (0.06 + 0.4 * slide) * h;                                   // slide bottom
  g.fillRect(cx - w * 0.07, base - 0.8 * h, w * 0.05, sy - (base - 0.8 * h));              // pitmans
  g.fillRect(cx + w * 0.02, base - 0.8 * h, w * 0.05, sy - (base - 0.8 * h));
  g.fillRect(cx - w * 0.3, sy - 0.14 * h, w * 0.6, 0.14 * h);                              // slide
  g.beginPath(); g.moveTo(cx - w * 0.26, sy); g.lineTo(cx + w * 0.26, sy); g.lineTo(cx + w * 0.2, sy + 0.035 * h); g.lineTo(cx - w * 0.2, sy + 0.035 * h); g.fill();   // upper die
  g.beginPath(); g.moveTo(cx - w * 0.3, base - 0.19 * h); g.lineTo(cx + w * 0.3, base - 0.19 * h); g.lineTo(cx + w * 0.24, base - 0.23 * h); g.lineTo(cx - w * 0.24, base - 0.23 * h); g.fill();   // lower die
  if (flywheel) {                                                                          // the flywheel, spoked, off the crown
    const fx = cx + w * 0.62, fy = base - 0.92 * h, fr = 0.2 * h;
    g.lineWidth = 0.045 * h; g.beginPath(); g.arc(fx, fy, fr, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 0.02 * h; g.beginPath();
    for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + slide * 0.8; g.moveTo(fx, fy); g.lineTo(fx + Math.cos(a) * fr, fy + Math.sin(a) * fr); }
    g.stroke(); g.beginPath(); g.arc(fx, fy, 0.05 * h, 0, Math.PI * 2); g.fill();
    g.fillRect(cx + w * 0.5, fy - 0.03 * h, w * 0.12, 0.06 * h);
  }
  if (detail) {                                                                            // bolt heads and seams catching the light
    g.save(); g.fillStyle = detail;
    for (let k = 0; k < 7; k++) g.fillRect(cx - w * 0.5 + k * w / 6 - 2, base - 0.97 * h, 4, 4);
    for (let k = 0; k < 4; k++) { g.fillRect(cx - w * 0.5 + 3, base - 0.78 * h + k * 0.15 * h, 2, 0.1 * h); g.fillRect(cx + w * 0.35 + 3, base - 0.78 * h + k * 0.15 * h, 2, 0.1 * h); }
    g.restore();
  }
  return [cx, sy + 0.035 * h];
}

// ---------------------------------------------------------------- a 6-axis robot arm; angles [shoulder, elbow, wrist] (rad)
export function robotArm(g, x, y, s, dir, [a1, a2, a3], ink = '#0a0605') {
  g.fillStyle = ink; g.strokeStyle = ink; g.lineCap = 'round';
  g.fillRect(x - 0.28 * s, y - 0.12 * s, 0.56 * s, 0.12 * s);                               // base plate
  g.fillRect(x - 0.18 * s, y - 0.34 * s, 0.36 * s, 0.24 * s);                               // turret
  g.beginPath(); g.arc(x, y - 0.38 * s, 0.16 * s, 0, Math.PI * 2); g.fill();               // shoulder
  const L1 = 0.95 * s, L2 = 0.8 * s, L3 = 0.28 * s;
  const p1 = [x, y - 0.38 * s];
  const t1 = -Math.PI / 2 + dir * a1, p2 = [p1[0] + Math.cos(t1) * L1, p1[1] + Math.sin(t1) * L1];
  const t2 = t1 + dir * (Math.PI / 2 + a2 * -1) * 1, p3 = [p2[0] + Math.cos(t2) * L2, p2[1] + Math.sin(t2) * L2];
  const t3 = t2 + dir * a3, p4 = [p3[0] + Math.cos(t3) * L3, p3[1] + Math.sin(t3) * L3];
  g.lineWidth = 0.2 * s; g.beginPath(); g.moveTo(...p1); g.lineTo(...p2); g.stroke();
  g.beginPath(); g.arc(p2[0], p2[1], 0.13 * s, 0, Math.PI * 2); g.fill();
  g.lineWidth = 0.14 * s; g.beginPath(); g.moveTo(...p2); g.lineTo(...p3); g.stroke();
  g.fillRect(p2[0] - 0.12 * s * Math.cos(t2) - 0.06 * s, p2[1] - 0.12 * s * Math.sin(t2) - 0.06 * s, 0.18 * s, 0.12 * s);   // counterweight
  g.beginPath(); g.arc(p3[0], p3[1], 0.08 * s, 0, Math.PI * 2); g.fill();
  g.lineWidth = 0.08 * s; g.beginPath(); g.moveTo(...p3); g.lineTo(...p4); g.stroke();
  // the weld gun: a C-yoke at the wrist
  g.lineWidth = 0.05 * s; g.beginPath(); g.arc(p4[0] + Math.cos(t3) * 0.08 * s, p4[1] + Math.sin(t3) * 0.08 * s, 0.1 * s, t3 + 0.6, t3 + 0.6 + Math.PI * 1.4); g.stroke();
  // the dress pack (cable) sagging from shoulder to wrist
  g.lineWidth = 0.035 * s; g.beginPath(); g.moveTo(p1[0] - dir * 0.1 * s, p1[1]);
  g.quadraticCurveTo((p1[0] + p3[0]) / 2 - dir * 0.2 * s, Math.max(p1[1], p3[1]) + 0.25 * s, p3[0], p3[1]); g.stroke();
  g.lineCap = 'butt';
  return [p4[0] + Math.cos(t3) * 0.14 * s, p4[1] + Math.sin(t3) * 0.14 * s];
}

// weld sparks: temperature-coloured streaks falling from a point; u 0..1 age of the burst
export function sparks(g, x, y, u, seed, k = 1) {
  g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
  for (let i = 0; i < 22; i++) {
    const a = -Math.PI * (0.1 + 0.8 * hash(seed * 31 + i)), v = 120 + 260 * hash(seed * 17 + i * 3);
    const t = u * (0.5 + 0.5 * hash(i + seed));
    const px = x + Math.cos(a) * v * t, py = y + Math.sin(a) * v * t + 500 * t * t;
    const hot = 1 - u;
    g.strokeStyle = `rgba(255,${Math.round(180 + 70 * hot)},${Math.round(90 + 120 * hot * hot)},${0.9 * (1 - u) * k})`;
    g.lineWidth = 1.6; g.beginPath(); g.moveTo(px, py); g.lineTo(px - Math.cos(a) * 8, py - Math.sin(a) * 8 - 6 * t); g.stroke();
  }
  const G = g.createRadialGradient(x, y, 0, x, y, 40 * (1 - u) + 4);
  G.addColorStop(0, `rgba(255,250,230,${0.9 * (1 - u) * k})`); G.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = G; g.fillRect(x - 50, y - 50, 100, 100);
  g.restore();
}

// the gate in B, near: tall posts, the sign frame as a real truss, the zip-tie points, the leaves swung open
export function gateB(g, { k = 1 } = {}) {
  const G = GATE_B, ink = '#070404';
  g.fillStyle = ink; g.strokeStyle = ink;
  g.fillRect(G.x0 - 20, G.top - 20, 40, G.base - G.top + 20); g.fillRect(G.x1 - 20, G.top - 20, 40, G.base - G.top + 20);
  g.fillRect(G.x0 - 28, G.top - 30, 56, 14); g.fillRect(G.x1 - 28, G.top - 30, 56, 14);
  truss(g, G.x0, G.top + 6, G.x1, G.top + 6, 30, { cw: 6, ww: 3, p: 34 });
  // barbed-wire outriggers and coils
  g.lineWidth = 4; g.beginPath(); g.moveTo(G.x0, G.top - 20); g.lineTo(G.x0 - 50, G.top - 70); g.moveTo(G.x1, G.top - 20); g.lineTo(G.x1 + 50, G.top - 70); g.stroke();
  g.lineWidth = 2;
  for (const [x0, x1] of [[-40, G.x0 - 20], [G.x1 + 20, 1140]]) {
    g.beginPath(); for (let x = x0; x < x1; x += 3) { const y = G.top - 56 + Math.sin(x * 0.18) * 12; x === x0 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke();
  }
  // the leaves, swung in toward the plant (chain-link over pipe frames)
  for (const [x, d] of [[G.x0 + 20, 1], [G.x1 - 20, -1]]) {
    g.lineWidth = 6; g.beginPath(); g.moveTo(x, G.base - 520); g.lineTo(x + d * 150, G.base - 470); g.lineTo(x + d * 150, G.base - 70); g.lineTo(x, G.base - 10); g.stroke();
    g.save(); g.globalAlpha = 0.45 * k; g.lineWidth = 1.2; g.beginPath();
    for (let i = 0; i < 26; i++) { const u = i / 26, ya = lerp(G.base - 520, G.base - 470, u), yb = lerp(G.base - 10, G.base - 70, u), xx = x + d * 150 * u;
      g.moveTo(xx, ya); g.lineTo(x + d * 150 * Math.min(1, u + 0.25), lerp(ya, yb, 0.25) + 100); }
    g.stroke(); g.restore();
  }
}

// ================================================================ THE BANNERS (picture text; UNDER NEW MANAGEMENT)
// Each owner's banner is a vinyl sheet in its own house style. Layers are slapped over the old ones with the old
// edges showing (décollage: Rotella, Villeglé), zip-tied to the frame, wrinkling in the wind; b31 the wind strips all.
const BANNER_TXT = 'UNDER NEW MANAGEMENT';
const BANNER_LOW = 'under new management';
export const STYLES = [
  { bg: '#8a2a22', fg: '#efe4d6', font: '800 58px "Overpass"', text: BANNER_TXT, rule: null, age: 0.6 },           // 0: the old one, sun-faded
  { bg: '#1b4aa0', fg: '#ffffff', font: '900 60px "Overpass"', text: BANNER_TXT, rule: '#9fc0ff' },                    // 1: corporate blue sans
  { bg: '#0f6b78', fg: '#f4fbfb', font: '800 58px "Overpass"', text: BANNER_TXT, rule: '#7fd6d6' },                    // 1b: the teal re-brand (b2)
  { bg: '#0e231a', fg: '#d9b44a', font: '700 58px "Cinzel"', text: BANNER_TXT, rule: '#d9b44a', serif: true },       // 2: gold serif
  { bg: '#f1efe8', fg: '#161616', font: '600 70px "Overpass"', text: BANNER_LOW, rule: null, dot: '#b8e02a' },       // 3: lowercase grotesk
  { bg: '#f2c200', fg: '#111111', font: '900 72px "Big Shoulders Stencil Display"', text: BANNER_TXT, rule: '#111' },  // 4: stencil
];
export function makeBanner(k) {
  const S = STYLES[k], c = cnv(900, 220), g = ctx2(c);
  g.fillStyle = S.bg; g.fillRect(0, 0, 900, 220);
  if (S.rule) { g.fillStyle = S.rule; g.fillRect(28, 24, 844, 5); g.fillRect(28, 191, 844, 5); }
  g.fillStyle = S.fg; g.font = S.font; g.textAlign = 'center'; g.textBaseline = 'middle';
  let w = g.measureText(S.text).width; const sc = Math.min(1, 800 / w);
  g.save(); g.translate(450, 112); g.scale(sc, S.serif ? sc : Math.max(sc, 0.95)); g.fillText(S.text, 0, 0); g.restore();
  if (S.dot) { g.fillStyle = S.dot; g.beginPath(); g.arc(840, 52, 16, 0, Math.PI * 2); g.fill(); }
  // grommets
  g.fillStyle = 'rgba(230,230,225,0.9)'; for (const [x, y] of [[16, 16], [884, 16], [16, 204], [884, 204], [450, 16]]) { g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = 'rgba(0,0,0,0.6)'; for (const [x, y] of [[16, 16], [884, 16], [16, 204], [884, 204], [450, 16]]) { g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill(); }
  if (S.age) {                                                                          // sun, grime and a torn corner
    g.globalCompositeOperation = 'source-atop'; g.fillStyle = `rgba(210,200,180,${0.35 * S.age})`; g.fillRect(0, 0, 900, 220);
    for (let i = 0; i < 600; i++) { g.fillStyle = `rgba(40,30,20,${0.15 * hash(i)})`; g.fillRect(900 * hash(i * 3), 220 * hash(i * 7), 2 + 20 * hash(i * 11), 1 + 2 * hash(i * 5)); }
    g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.moveTo(900, 150); g.lineTo(820, 220); g.lineTo(900, 220); g.fill();
    g.globalCompositeOperation = 'source-over';
  }
  // vinyl sheen: a faint diagonal highlight
  const G = g.createLinearGradient(0, 0, 900, 220); G.addColorStop(0.3, 'rgba(255,255,255,0)'); G.addColorStop(0.45, 'rgba(255,255,255,0.10)'); G.addColorStop(0.6, 'rgba(255,255,255,0)');
  g.fillStyle = G; g.fillRect(0, 0, 900, 220);
  return c;
}

// draw one banner layer: centre (x, y), width w (height from the 900x220 sheet), wind wrinkle at time t, light: a
// multiplier colour string for the world's light, slap: 0..1 (0 = landing, scale overshoot), tear: 0..1 (flying off)
export function drawBanner(g, img, x, y, w, t, { seed = 0, light = null, slap = 1, tear = 0, dx = 0, dy = 0, rot = 0, shade = 0.3 } = {}) {
  const h = w * 220 / 900, N = 24;
  g.save();
  g.translate(x + dx + tear * (380 + 200 * hash(seed)), y + dy - tear * (420 + 160 * hash(seed + 3)) + tear * tear * 60);
  g.rotate(rot + tear * (0.9 + 0.8 * hash(seed + 5)) * (hash(seed + 9) < 0.5 ? -1 : 1));
  const sc = slap < 1 ? 1 + 0.16 * Math.pow(1 - slap, 2) : 1;
  g.scale(sc, sc * (1 - tear * 0.4 * Math.abs(Math.sin(tear * 9 + seed))));
  if (tear > 0) g.globalAlpha = clamp(1 - tear * 1.1);
  for (let i = 0; i < N; i++) {
    const u0 = i / N, x0 = -w / 2 + u0 * w, sw = w / N + 0.8;
    const wv = Math.sin(u0 * 9 + t * 5.3 + seed) * 0.6 + Math.sin(u0 * 23 - t * 7.1 + seed * 2) * 0.4;
    const oy = wv * h * 0.035 * (1 + 3 * tear), sy = 1 - Math.abs(wv) * 0.03;
    g.drawImage(img, u0 * 900, 0, 900 / N + 1, 220, x0, -h / 2 + oy, sw, h * sy);
    if (shade) { g.fillStyle = wv > 0 ? `rgba(0,0,0,${shade * wv * 0.5})` : `rgba(255,240,220,${-shade * wv * 0.25})`; g.fillRect(x0, -h / 2 + oy, sw, h * sy); }
  }
  if (light) { g.globalCompositeOperation = 'multiply'; g.fillStyle = light; g.fillRect(-w / 2 - 2, -h / 2 - 10, w + 4, h + 20); g.globalCompositeOperation = 'source-over'; }
  // zip ties to the frame
  if (tear < 0.05) { g.fillStyle = '#e8e6e0'; for (const zx of [-w / 2 + 6, 0, w / 2 - 6]) g.fillRect(zx - 1.5, -h / 2 - 10, 3, 12); }
  g.restore();
}

// ================================================================ WORLD C: the four stations as exaggerated silhouettes
// k: 0 press, 1 weld arm, 2 paint booth, 3 conveyor. (x, y): the foot on the horizon; s: scale (1 ~ 300 px tall);
// u: the working phase (0..1). Returns the working point [x, y] (die, tip, nozzle, head roller).
export function station(g, k, x, y, s, u = 0, ink = '#0a0405') {
  g.fillStyle = ink; g.strokeStyle = ink; g.lineCap = 'round';
  if (k === 0) return pressSil(g, x, y, 360 * s, { slide: u, ink, flywheel: true });
  if (k === 1) {
    g.fillRect(x - 70 * s, y - 24 * s, 140 * s, 24 * s);                                   // plinth
    return robotArm(g, x, y - 24 * s, 230 * s, 1, [0.3 + 0.2 * u, -0.25 + 0.25 * u, 0.7 - 0.3 * u], ink);
  }
  if (k === 2) {                                                                            // the paint booth: box, ducts, stack, the gun
    const bw = 190 * s, bh = 200 * s;
    g.fillRect(x - bw / 2, y - bh, bw, bh);
    g.lineWidth = 26 * s; g.beginPath(); g.moveTo(x - bw * 0.3, y - bh); g.lineTo(x - bw * 0.3, y - bh - 60 * s);
    g.quadraticCurveTo(x - bw * 0.3, y - bh - 110 * s, x + bw * 0.1, y - bh - 110 * s); g.lineTo(x + bw * 0.55, y - bh - 110 * s); g.stroke();
    g.lineWidth = 34 * s; g.beginPath(); g.moveTo(x + bw * 0.25, y - bh); g.lineTo(x + bw * 0.25, y - bh - 170 * s); g.stroke();   // exhaust stack
    g.fillRect(x + bw * 0.25 - 26 * s, y - bh - 186 * s, 52 * s, 16 * s);
    g.lineWidth = 14 * s; g.beginPath(); g.moveTo(x + bw * 0.55, y - bh - 110 * s); g.lineTo(x + bw * 0.55, y - bh * 0.4); g.stroke();
    g.fillRect(x - bw / 2 - 16 * s, y - bh - 12 * s, bw + 32 * s, 14 * s);                   // the roof lip
    // the open face and the gun arm reaching out
    g.save(); g.fillStyle = 'rgba(201,31,55,0.55)'; g.fillRect(x - bw * 0.35, y - bh * 0.72, bw * 0.5, bh * 0.5); g.restore();
    g.fillStyle = ink;
    const ax = x + bw * 0.5 + 40 * s, ay = y - bh * 0.5 - 20 * s * Math.sin(u * Math.PI);
    g.lineWidth = 16 * s; g.beginPath(); g.moveTo(x + bw * 0.4, y - bh * 0.35); g.lineTo(ax, ay); g.stroke();
    g.beginPath(); g.moveTo(ax, ay - 12 * s); g.lineTo(ax + 44 * s, ay - 6 * s); g.lineTo(ax + 44 * s, ay + 6 * s); g.lineTo(ax, ay + 12 * s); g.fill();
    g.lineCap = 'butt';
    return [ax + 50 * s, ay];
  }
  // conveyor: an inclined belt on A-frame legs, rollers, a crate riding it
  const L = 300 * s, a = -0.42, x0 = x - 120 * s, y0 = y - 70 * s;
  const x1 = x0 + Math.cos(a) * L, y1 = y0 + Math.sin(a) * L;
  g.lineWidth = 30 * s; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  g.lineWidth = 12 * s; g.beginPath();
  for (const f of [0.1, 0.55, 0.92]) { const px = lerp(x0, x1, f), py = lerp(y0, y1, f); g.moveTo(px - 30 * s, y); g.lineTo(px, py); g.lineTo(px + 30 * s, y); }
  g.stroke();
  g.fillStyle = '#C91F37';
  for (let i = 0; i < 9; i++) { const f = (i + 0.5) / 9, px = lerp(x0, x1, f), py = lerp(y0, y1, f); g.beginPath(); g.arc(px, py, 6 * s, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = ink;
  g.beginPath(); g.arc(x1, y1, 26 * s, 0, Math.PI * 2); g.fill(); g.beginPath(); g.arc(x0, y0, 22 * s, 0, Math.PI * 2); g.fill();
  const cf = (0.15 + 0.6 * u) % 1, cx = lerp(x0, x1, cf), cy = lerp(y0, y1, cf);           // the crate
  g.save(); g.translate(cx, cy); g.rotate(a); g.fillRect(-34 * s, -78 * s, 68 * s, 62 * s); g.restore();
  g.lineCap = 'butt';
  return [x1 + 10 * s, y1 - 10 * s];
}

// ================================================================ STIPPLE RINGS (cream dots on poster red)
// one ring: dots every `step` px along the circle, radius dr, alpha a; dropout for the stipple grain; clipped to the
// frame (no dots are placed off screen)
export function stipple(g, cx, cy, R, { a = 1, step = 7, dr = 2.3, seed = 0, color = '#F4E6D0', lock = 0, lockY = 0, drop = 0.18 } = {}) {
  if (R < 2 || a <= 0.01) return;
  const n = Math.max(12, Math.floor(2 * Math.PI * R / step));
  g.fillStyle = color; g.globalAlpha = clamp(a);
  for (let i = 0; i < n; i++) {
    if (hash(seed * 7919 + i) < drop) continue;
    const th = (i / n) * Math.PI * 2;
    let x = cx + Math.cos(th) * R, y = cy + Math.sin(th) * R;
    if (lock > 0) { const lx = (i / n) * (W + 80) - 40; x = lerp(x, lx, lock); y = lerp(y, lockY, lock); }
    if (x < -4 || x > W + 4 || y < -4 || y > H + 4) continue;
    const r = dr * (0.75 + 0.5 * hash(seed * 31 + i * 3));
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  g.globalAlpha = 1;
}

// ================================================================ PRINT: a Klutsis halftone of a tone canvas
// src: a canvas whose luminance is the tone (0 ink .. 1 paper); dots of `ink` on whatever g already holds.
const _ht = { c: null };
export function halftone(g, src, { cell = 13, angle = 0.26, ink = '#0c0406', gain = 1.0, min = 0.04 } = {}) {
  const sw = Math.ceil(W / 4), sh = Math.ceil(H / 4);
  if (!_ht.c) { _ht.c = cnv(sw, sh); _ht.g = ctx2(_ht.c); }
  _ht.g.clearRect(0, 0, sw, sh); _ht.g.drawImage(src, 0, 0, sw, sh);
  const d = _ht.g.getImageData(0, 0, sw, sh).data;
  const ca = Math.cos(angle), sa = Math.sin(angle), R = Math.hypot(W, H) / 2 + cell;
  g.fillStyle = ink; g.beginPath();
  for (let v = -R; v < R; v += cell) for (let u = -R; u < R; u += cell) {
    const x = W / 2 + u * ca - v * sa, y = H / 2 + u * sa + v * ca;
    if (x < -cell || y < -cell || x > W + cell || y > H + cell) continue;
    const ix = clamp(Math.floor(x / 4), 0, sw - 1), iy = clamp(Math.floor(y / 4), 0, sh - 1), k = (iy * sw + ix) * 4;
    const lum = (d[k] * 0.3 + d[k + 1] * 0.59 + d[k + 2] * 0.11) / 255, al = d[k + 3] / 255;
    const dark = clamp((1 - lum) * al * gain);
    if (dark < min) continue;
    const r = cell * 0.71 * Math.sqrt(dark);
    g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2);
  }
  g.fill();
}

// ================================================================ THE LINE WORKER'S KIT, in trucker head units
// The trucker's local frame (machines.figures.js): head height 1, face toward +x, the neck pivot PIV; the caller has set
// the transform (T.x, T.y, T.s). u: 0 the defenders round his neck, 1 over his ears (the b4 act). tilt: the head's tilt.
const PIV = TRUCKER.PIV;
function rotP(p, tilt) { const c = Math.cos(tilt), s = Math.sin(tilt), x = p[0] - PIV[0], y = p[1] - PIV[1]; return [x * c - y * s + PIV[0], x * s + y * c + PIV[1]]; }
export function defendersGeom(u, tilt) {
  // the cup's centre moves from the throat (not rotated with the head) to the ear (rotated with the head)
  const neck = [0.14, 1.03], ear = rotP([-0.07, 0.6], tilt);
  const e = u * u * (3 - 2 * u), arc = Math.sin(Math.PI * e) * 0.18;
  const c = [lerp(neck[0], ear[0], e) - arc, lerp(neck[1], ear[1], e)];
  const ang = lerp(0.9, tilt + 0.1, e);
  return { c, ang, rx: lerp(0.16, 0.135, e), ry: lerp(0.12, 0.175, e), e };
}
export function defenders(g, u, { tilt = -0.56, ink = '#100E10', rim = 'rgba(160,172,168,0.9)', lens = '#E53239', unit = 500, glint = 1, onTop = true } = {}) {
  const D = defendersGeom(u, tilt), lw = 1 / unit;
  g.save();
  // the headband: over the cap crown when on (its top stands off the cap's outline), behind the neck when down
  g.lineCap = 'round';
  if (D.e > 0.5) {
    const k = (D.e - 0.5) * 2;
    const band = [rotP([-0.07, 0.44], tilt), rotP([-0.14, 0.16], tilt), rotP([-0.1, -0.1], tilt), rotP([-0.02, -0.215], tilt), rotP([0.06, -0.2], tilt)];
    const b = band.map(p => [lerp(D.c[0], p[0], k * (p === band[0] ? 1 : 1)), lerp(D.c[1] - 0.1, p[1], k)]);
    g.strokeStyle = ink; g.lineWidth = 0.05; g.beginPath(); tracePath(g, spline(b, false, 8), false); g.stroke();
    g.strokeStyle = rim; g.lineWidth = 3 * lw; g.globalAlpha = 0.7 * k; g.beginPath();
    tracePath(g, spline(b.map(p => [p[0] + 0.012, p[1] - 0.012]), false, 8).slice(4), false); g.stroke(); g.globalAlpha = 1;
  } else {
    g.strokeStyle = ink; g.lineWidth = 0.05; g.beginPath(); g.moveTo(D.c[0], D.c[1] - 0.05); g.quadraticCurveTo(-0.1, 1.08, -0.3, 1.16); g.stroke();
  }
  // the cup: a shell with a cushion ring, its rim catching the light (up-right), a highlight on the shell
  g.translate(D.c[0], D.c[1]); g.rotate(D.ang);
  g.fillStyle = ink; g.beginPath(); g.ellipse(0, 0, D.rx, D.ry, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#2a2a30'; g.lineWidth = 0.022; g.beginPath(); g.ellipse(0, 0, D.rx * 0.82, D.ry * 0.82, 0, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = rim; g.globalAlpha = lerp(0.35, 1, D.e); g.lineWidth = 3.2 * lw; g.beginPath(); g.ellipse(0, 0, D.rx, D.ry, 0, -Math.PI * 0.95, -Math.PI * 0.15); g.stroke(); g.globalAlpha = 1;
  g.fillStyle = rim; g.globalAlpha = 0.35; g.beginPath(); g.ellipse(D.rx * 0.25, -D.ry * 0.45, D.rx * 0.28, D.ry * 0.12, -0.5, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 1;
  g.restore();
}
// the safety glasses pushed up on the cap's bill, a glint of the dot in the lens
export function glasses(g, { tilt = -0.56, ink = '#100E10', rim = 'rgba(170,180,176,0.9)', dot = '#E53239', unit = 500, glint = 1 } = {}) {
  const lw = 1 / unit;
  const lens = [[0.36, 0.035], [0.44, 0.052], [0.535, 0.083], [0.55, 0.055], [0.47, 0.018], [0.38, -0.004]].map(p => rotP(p, tilt));
  g.save();
  g.fillStyle = '#1c1d22'; g.beginPath(); tracePath(g, spline(lens, true, 6)); g.fill();
  g.strokeStyle = rim; g.lineWidth = 2.4 * lw; g.beginPath(); tracePath(g, spline(lens.slice(3), false, 6), false); g.stroke();
  // the temple arm back along the cap
  const arm = [rotP([0.37, 0.01], tilt), rotP([0.2, -0.03], tilt), rotP([0.02, -0.02], tilt)];
  g.strokeStyle = ink; g.lineWidth = 0.014; g.beginPath(); tracePath(g, spline(arm, false, 6), false); g.stroke();
  // the glint: the dot's red, and a cream catchlight
  const gp = rotP([0.49, 0.045], tilt);
  g.fillStyle = dot; g.globalAlpha = 0.85 * glint; g.beginPath(); g.ellipse(gp[0], gp[1], 0.016, 0.008, tilt, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff3e6'; g.globalAlpha = 0.9 * glint; g.beginPath(); g.arc(gp[0] + 0.012, gp[1] - 0.004, 0.004, 0, Math.PI * 2); g.fill();
  g.restore();
}

// ================================================================ THE LINE WORKER FROM BEHIND (world B)
// o: { x, y (the top of the cap), s (px per 'head' ~ the cap's width), sway, pail: true, tile: the ACP sticker canvas }
export function backWorker(g, { x = 300, y = 1300, s = 200, sway = 0, ink = '#0a0605', pail = true, tile = null, cups = 1 } = {}) {
  g.save(); g.translate(x, y); g.scale(s, s); g.rotate(sway * 0.02);
  g.fillStyle = ink; g.strokeStyle = ink;
  // the cap from behind: a round crown, the snapback strap's gap at the back, the bill's edge peeking out left and right
  const crown = [[-0.5, 0.36, 'c'], [-0.52, 0.2], [-0.44, 0.04], [-0.26, -0.06], [0, -0.09], [0.26, -0.06], [0.44, 0.04], [0.52, 0.2], [0.5, 0.36, 'c']];
  g.beginPath(); tracePath(g, spline(crown, false, 10), false); g.lineTo(0.5, 0.36); g.lineTo(-0.5, 0.36); g.fill();
  g.beginPath(); g.ellipse(0, 0.35, 0.62, 0.05, 0, 0, Math.PI * 2); g.fill();                    // the bill's edges either side
  // the head, the neck and the ears under the cap
  const head = [[-0.46, 0.34], [-0.47, 0.55], [-0.4, 0.76], [-0.26, 0.9], [-0.22, 1.08], [0.22, 1.08], [0.26, 0.9], [0.4, 0.76], [0.47, 0.55], [0.46, 0.34]];
  g.beginPath(); tracePath(g, spline(head, false, 8), false); g.closePath(); g.fill();
  // the ear defenders from behind: the band arching over the crown, the two cups standing out either side
  if (cups > 0) {
    g.lineWidth = 0.075; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-0.6, 0.5); g.bezierCurveTo(-0.66, 0.05, -0.36, -0.2, 0, -0.2); g.bezierCurveTo(0.36, -0.2, 0.66, 0.05, 0.6, 0.5); g.stroke();
    for (const d of [-1, 1]) { g.beginPath(); g.ellipse(d * 0.58, 0.6, 0.15, 0.2, d * 0.1, 0, Math.PI * 2); g.fill(); }
  }
  // the jacket: collar, shoulders, the arms hanging, the right hand carrying the pail
  const body = [[-0.28, 1.0], [-0.55, 1.12], [-1.05, 1.26], [-1.32, 1.48], [-1.45, 1.9], [-1.5, 2.6], [-1.52, 3.4, 'c'], [1.52, 3.4, 'c'], [1.5, 2.6], [1.45, 1.9], [1.32, 1.48], [1.05, 1.26], [0.55, 1.12], [0.28, 1.0]];
  g.beginPath(); tracePath(g, rough(spline(body, false, 10), 0.006, 3, 4), false); g.closePath(); g.fill();
  g.beginPath(); tracePath(g, spline([[1.3, 1.5], [1.62, 1.9], [1.72, 2.5], [1.74, 2.95], [1.62, 3.05], [1.5, 2.6]], true, 8)); g.fill();   // right arm
  if (pail) {                                                                                  // the steel lunch pail (a domed lid)
    const px = 1.72, py = 3.02;
    g.lineWidth = 0.035; g.beginPath(); g.moveTo(px - 0.12, py + 0.1); g.quadraticCurveTo(px, py - 0.12, px + 0.12, py + 0.1); g.stroke();
    g.beginPath(); g.moveTo(px - 0.34, py + 0.22); g.quadraticCurveTo(px, py - 0.02, px + 0.34, py + 0.22); g.lineTo(px + 0.34, py + 0.7); g.lineTo(px - 0.34, py + 0.7); g.fill();
    if (tile) { g.save(); g.globalAlpha = 0.92; g.drawImage(tile, px - 0.2, py + 0.3, 0.4, 0.3); g.restore(); }
  }
  g.restore();
}

// ================================================================ SIL crowd cells as ink + rim
export class SilRim {
  constructor(sil) { this.sil = sil; this.cache = new Map(); }
  _make(c, rimCol) {
    const key = c.type + ':' + c.pose + ':' + rimCol;
    if (this.cache.has(key)) return this.cache.get(key);
    const S = this.sil, cw = S.CW, ch = S.CH;
    const a = cnv(cw, ch), ag = ctx2(a); ag.drawImage(S.bitmap, c.x, c.y, cw, ch, 0, 0, cw, ch);
    const d = ag.getImageData(0, 0, cw, ch), p = d.data;
    const ink = cnv(cw, ch), rim = cnv(cw, ch), ig = ctx2(ink), rg = ctx2(rim);
    const di = ig.createImageData(cw, ch), dr = rg.createImageData(cw, ch);
    const rc = rimCol.match(/\d+/g).map(Number);
    for (let i = 0; i < p.length; i += 4) {
      const A = p[i + 3], R = p[i] / 255, Bk = p[i + 2] / 255;
      di.data[i] = 10 + 10 * Bk; di.data[i + 1] = 6 + 6 * Bk; di.data[i + 2] = 6 + 4 * Bk; di.data[i + 3] = A;
      const yy = (i / 4 / cw) | 0, feet = clamp((c.foot[1] - 8 - yy) / (0.22 * c.foot[1]));
      dr.data[i] = rc[0]; dr.data[i + 1] = rc[1]; dr.data[i + 2] = rc[2]; dr.data[i + 3] = Math.round(A * Math.pow(R, 1.4) * feet);
    }
    ig.putImageData(di, 0, 0); rg.putImageData(dr, 0, 0);
    const r = { ink, rim }; this.cache.set(key, r); return r;
  }
  // foot (fx, fy), on-screen height hPx; rimA: rim strength; flip
  draw(g, type, pose, fx, fy, hPx, { flip = false, rimCol = 'rgb(255,150,70)', rimA = 1, alpha = 1, pail = false } = {}) {
    const S = this.sil, c = S.cell(type, pose); if (!c) return;
    const k = hPx / (S.meta.types[type].h * S.PPM), w = S.CW * k, h = S.CH * k, x = fx - c.foot[0] * k, y = fy - c.foot[1] * k;
    const r = this._make(c, rimCol);
    g.save(); g.globalAlpha = alpha;
    if (flip) { g.translate(fx * 2, 0); g.scale(-1, 1); }
    g.drawImage(r.ink, x, y, w, h);
    if (pail && c.hands) {                                                                  // a lunch pail in the lower hand
      const hd = c.hands.R[1] > c.hands.L[1] ? c.hands.R : c.hands.L;
      const hx = x + hd[0] * k, hy = y + hd[1] * k, ps = hPx * 0.075;
      g.fillStyle = '#0c0707'; g.fillRect(hx - ps * 0.6, hy + ps * 0.2, ps * 1.2, ps * 0.8);
      g.strokeStyle = '#0c0707'; g.lineWidth = Math.max(1, ps * 0.1); g.beginPath(); g.moveTo(hx - ps * 0.3, hy + ps * 0.25); g.lineTo(hx, hy - ps * 0.1); g.lineTo(hx + ps * 0.3, hy + ps * 0.25); g.stroke();
    }
    g.globalAlpha = alpha * rimA; g.drawImage(r.rim, x, y, w, h);
    g.restore();
  }
}
