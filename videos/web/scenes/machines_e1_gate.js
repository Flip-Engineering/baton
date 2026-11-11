// THE FACTORY c20 (machines_e1_a / _b): the gate world in 2D. The cold gate at 5:40 a.m. (A), the plant behind the gate
// at sodium dawn (B), the gate posts and sign frame, and the UNDER NEW MANAGEMENT banners (picture text), carried over
// from machines_e1.world.js (v1-v3) WITHOUT its figure kit: that file imported the hero piece's trucker silhouette
// (machines.figures.js) for the worker; c20's people are the person pipeline's (machines_e1_c20.js), so nothing here
// draws a person. New in c20: the scissor lift the crew hang the owners' banners from (take a) and the owners' cars that
// pass the gate and never stop (take b). No rings, no stipple fields, no stamp.
export const W = 1080, H = 1920;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, x) => a + (b - a) * x;
export function hash(i) { let x = Math.imul((i | 0) ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; }
const cnv = (w = W, h = H) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const ctx2 = c => c.getContext('2d', { willReadFrequently: true });
function grad(g, y0, y1, stops) { const G = g.createLinearGradient(0, y0, 0, y1); for (const [o, c] of stops) G.addColorStop(o, c); return G; }

// ---------------------------------------------------------------- a steel truss (the conveyor bridges, the sign frame)
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


// ================================================================ c20, take a: THE LIFT the crew hang the owners' banners from
// A scissor lift under the left half of the sign frame in B (the gate line is the ground at GATE_B.base). Silhouette
// against the bay with the bay's rim on its upper edges, like everything in the gate world. part 'back' draws the chassis,
// the scissor stack and the deck; part 'front' the guard rail that stands in front of the people on it.
export const LIFT = { cx: 330, base: GATE_B.base, deck: 1120, w: 400, rail: 210 };
export function drawLift(g, part = 'back', { rim = 'rgba(255,150,70,0.7)', ink = '#0b0706' } = {}) {
  const L = LIFT, x0 = L.cx - L.w / 2, x1 = L.cx + L.w / 2;
  g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
  if (part === 'back') {
    // chassis and wheels
    g.fillStyle = ink; g.fillRect(x0 + 20, L.base - 78, L.w - 40, 52);
    for (const wx of [x0 + 60, x1 - 60]) { g.beginPath(); g.arc(wx, L.base - 22, 22, 0, Math.PI * 2); g.fill(); }
    // the hazard edge on the chassis (yellow and black, dimmed by the dark)
    g.save(); g.beginPath(); g.rect(x0 + 20, L.base - 78, L.w - 40, 10); g.clip();
    for (let x = x0; x < x1 + 20; x += 22) { g.fillStyle = 'rgba(190,150,30,0.55)'; g.beginPath(); g.moveTo(x, L.base - 78); g.lineTo(x + 11, L.base - 78); g.lineTo(x + 1, L.base - 68); g.lineTo(x - 10, L.base - 68); g.fill(); }
    g.restore();
    // the scissor stack: three stages of crossed arms, pinned at the ends
    const y0 = L.base - 78, y1 = L.deck + 18, n = 3, sh = (y0 - y1) / n, ax0 = x0 + 50, ax1 = x1 - 50;
    g.strokeStyle = ink; g.lineWidth = 13;
    for (let k = 0; k < n; k++) { const ya = y0 - k * sh, yb = ya - sh; g.beginPath(); g.moveTo(ax0, ya); g.lineTo(ax1, yb); g.moveTo(ax1, ya); g.lineTo(ax0, yb); g.stroke(); }
    g.strokeStyle = rim; g.lineWidth = 2;
    for (let k = 0; k < n; k++) { const ya = y0 - k * sh, yb = ya - sh; g.beginPath(); g.moveTo(ax0, ya - 6); g.lineTo(ax1, yb - 6); g.moveTo(ax1, ya - 6); g.lineTo(ax0, yb - 6); g.stroke(); }
    g.fillStyle = '#2a2420'; for (let k = 0; k <= n; k++) for (const ax of [ax0, ax1]) { g.beginPath(); g.arc(ax, y0 - k * sh, 6, 0, Math.PI * 2); g.fill(); }
    // the deck
    g.fillStyle = ink; g.fillRect(x0, L.deck, L.w, 20); g.fillStyle = rim; g.fillRect(x0, L.deck, L.w, 2);
    // the back rail (behind the people)
    g.strokeStyle = ink; g.lineWidth = 5; g.beginPath(); g.moveTo(x0 + 8, L.deck - L.rail + 10); g.lineTo(x1 - 8, L.deck - L.rail + 10); g.stroke();
  } else {
    g.strokeStyle = ink; g.lineWidth = 7;
    g.beginPath(); g.moveTo(x0 + 4, L.deck); g.lineTo(x0 + 4, L.deck - L.rail); g.lineTo(x1 - 4, L.deck - L.rail); g.lineTo(x1 - 4, L.deck);
    g.moveTo(x0 + 4, L.deck - L.rail / 2); g.lineTo(x1 - 4, L.deck - L.rail / 2); g.moveTo(L.cx, L.deck); g.lineTo(L.cx, L.deck - L.rail); g.stroke();
    g.strokeStyle = rim; g.lineWidth = 2; g.beginPath(); g.moveTo(x0 + 4, L.deck - L.rail - 3); g.lineTo(x1 - 4, L.deck - L.rail - 3); g.stroke();
    // the toe board, and the rental plate (picture text, too small to read as words)
    g.fillStyle = ink; g.fillRect(x0, L.deck - 26, L.w, 26);
    g.fillStyle = 'rgba(190,150,30,0.35)'; g.fillRect(x0 + 24, L.deck - 20, 58, 12);
  }
  g.restore();
}

// ================================================================ c20, take b: THE OWNERS' CARS, which pass the gate and never stop
// Three cars, each a different owner's: a black sedan, a black SUV, a long grey sedan. Silhouettes on the lot in front of
// the gate, against the bay's light: dark paint, the sky's line along the shoulder, black glass with the bay in it, the
// bay's rim on the roof; head and tail lamps on at dawn. Drawn once per style at a 1000 px length, then laid down per
// frame with a horizontal motion smear (copies along the travel).
const CAR_SHAPES = {
  sedan: { body: [[20, 250], [6, 200], [14, 152], [230, 132], [338, 62], [600, 50], [726, 126], [962, 146], [996, 186], [990, 250]],
    glass: [[354, 72], [592, 62], [694, 126], [348, 130]], post: 470, arches: [215, 805], wr: 66, lamp: 'sedan' },
  suv: { body: [[24, 252], [8, 196], [12, 60], [40, 22], [690, 18], [820, 112], [968, 132], [996, 178], [990, 252]],
    glass: [[52, 40], [676, 36], [790, 116], [52, 118]], post: 360, arches: [205, 800], wr: 76, lamp: 'suv' },
  long: { body: [[20, 250], [6, 204], [14, 158], [200, 140], [300, 80], [640, 70], [760, 132], [966, 150], [996, 190], [990, 250]],
    glass: [[318, 88], [632, 80], [728, 132], [312, 136]], post: 470, arches: [190, 830], wr: 62, lamp: 'sedan' },
};
const _cars = {};
function carSprite(style) {
  if (_cars[style]) return _cars[style];
  const S = CAR_SHAPES[style], c = cnv(1000, 300), g = ctx2(c);
  const path = pts => { g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); };
  // the body: near-black paint, a little lighter along the top (the sky), darkest at the sills
  path(S.body);
  const pg = g.createLinearGradient(0, 0, 0, 260); pg.addColorStop(0, style === 'long' ? '#2a2c31' : '#191b20'); pg.addColorStop(0.5, style === 'long' ? '#16171b' : '#0d0e11'); pg.addColorStop(1, '#050506');
  g.fillStyle = pg; g.fill();
  // the wheel arches cut and the tyres
  g.save(); g.globalCompositeOperation = 'destination-out'; for (const ax of S.arches) { g.beginPath(); g.arc(ax, 252, S.wr + 8, Math.PI, 0); g.fill(); } g.restore();
  for (const ax of S.arches) {
    g.fillStyle = '#040404'; g.beginPath(); g.arc(ax, 250, S.wr, 0, Math.PI * 2); g.fill();
    const rg = g.createRadialGradient(ax, 250, 4, ax, 250, S.wr * 0.62); rg.addColorStop(0, '#5a5a5c'); rg.addColorStop(0.7, '#2a2a2c'); rg.addColorStop(1, '#141414');
    g.fillStyle = rg; g.beginPath(); g.arc(ax, 250, S.wr * 0.6, 0, Math.PI * 2); g.fill();
  }
  // the glass: black, the bay's light lying across it in two soft streaks
  path(S.glass); g.fillStyle = '#030305'; g.fill();
  g.save(); path(S.glass); g.clip();
  for (const [a, w, al] of [[0.3, 60, 0.32], [0.62, 26, 0.22]]) { const x = lerp(S.glass[0][0], S.glass[1][0], a); const sg = g.createLinearGradient(x - w, 0, x + w, 0);
    sg.addColorStop(0, 'rgba(255,170,90,0)'); sg.addColorStop(0.5, `rgba(255,170,90,${al})`); sg.addColorStop(1, 'rgba(255,170,90,0)'); g.fillStyle = sg;
    g.beginPath(); g.moveTo(x - w + 40, 0); g.lineTo(x + w + 40, 0); g.lineTo(x + w - 40, 300); g.lineTo(x - w - 40, 300); g.fill(); }
  g.restore();
  g.fillStyle = '#060607'; g.fillRect(S.post - 7, Math.min(S.glass[0][1], S.glass[1][1]), 14, 70);
  // the shoulder line: the sky in the paint
  g.save(); path(S.body); g.clip();
  const sl = g.createLinearGradient(0, 0, 1000, 0); sl.addColorStop(0, 'rgba(210,150,110,0.05)'); sl.addColorStop(0.45, 'rgba(240,170,120,0.42)'); sl.addColorStop(1, 'rgba(210,150,110,0.1)');
  g.fillStyle = sl; g.fillRect(0, S.lamp === 'suv' ? 138 : 150, 1000, 3);
  g.fillStyle = 'rgba(200,200,205,0.25)'; g.fillRect(40, 214, 920, 2);                                 // the chrome strip
  g.restore();
  // the bay's rim along the roof
  g.save(); g.strokeStyle = 'rgba(255,160,80,0.55)'; g.lineWidth = 2.5; g.beginPath();
  const top = S.body.slice(3, 7); top.forEach(([x, y], i) => i ? g.lineTo(x, y + 1) : g.moveTo(x, y + 1)); g.stroke(); g.restore();
  // lamps: head (front, right) warm white, tail (rear) red
  const lamp = (x, y, w, h, col, glow) => { const G = g.createRadialGradient(x, y, 0, x, y, glow); G.addColorStop(0, col); G.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = G; g.fillRect(x - glow, y - glow, glow * 2, glow * 2);
    g.fillStyle = col; g.fillRect(x - w / 2, y - h / 2, w, h); };
  lamp(985, 168, 14, 10, 'rgba(255,240,215,0.95)', 40);
  lamp(12, 172, 10, 14, 'rgba(230,30,30,0.9)', 30);
  return (_cars[style] = c);
}
// x: the car's centre (frame px), ground: the y its tyres stand on, len: its length in px, dir: +1 travelling right, -1 left,
// smear: the motion smear length in px (the distance it covers in a frame and a half)
export function drawCar(g, style, x, ground, len, dir = 1, smear = 0) {
  const c = carSprite(style), k = len / 1000, h = 300 * k;
  g.save(); g.translate(x, ground - 316 * k + h); if (dir < 0) g.scale(-1, 1);
  const n = smear > 4 ? 9 : 1;
  for (let i = 0; i < n; i++) { const o = n === 1 ? 0 : (i / (n - 1) - 0.5) * smear; g.globalAlpha = n === 1 ? 1 : Math.min(1, 2.2 / n); g.drawImage(c, -len / 2 + o, -h, len, h); }
  g.globalAlpha = 1;
  g.restore();
}
