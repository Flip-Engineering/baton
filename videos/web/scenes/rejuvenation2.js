// REJUVENATION v2: the city runs young, at noon (VISUAL_BIBLE §2.12).
// All things have a master: the working class. The human race grows young by owning and expanding production.
// The fountain of youth: a steel mill. Master of all things.
// A reversed time-lapse of monumental architecture in three.js: one `age` per surface runs backward through baked
// masks (rust, cracks, grime), pre-fractured buildings fly back up into their facades, glass re-forms pane by pane,
// and the white fortress rises under hard noon against cobalt. Words: research/scripts_final/rejuvenation.json, exact.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { W, H, loadFonts, loadBeats, loadImage, clamp, lerp, ease, rng, smooth, Finish, closer, outCanvas, tinted } from '../lib/kit.js';
import { loadFace, shape, innerShadow } from '../lib/fx/type.js';
import { voronoi, crack, fbm3 } from '../lib/fx/physics.js';
import { People } from '../lib/fx/people.js';

const ctx = outCanvas();
await loadFonts();
const B = await loadBeats('rejuvenation2');
const logoImg = await loadImage('../assets/acp_logo.png');
const cinzel = await loadFace('cinzel');
const finish = new Finish(1212);

// ---------------------------------------------------------------- the script (final, verbatim)
const WORDS = [[0, 'ALL THINGS'], [2, 'HAVE A MASTER.'], [4, 'THE MASTER'], [6, 'WORKS.'], [7, null], [8, 'THE WORKING'], [9, 'CLASS.'],
  [10, 'MASTER'], [12, 'OF STEEL.'], [13, 'OF AI.'], [14, 'OF TIME.'], [16, 'THE HUMAN RACE'], [18, 'GROWS YOUNG.'],
  [20, 'BY OWNING'], [22, 'AND EXPANDING'], [24, 'PRODUCTION.'], [26, 'THE MILLS.'], [27, 'THE TOWNS.'], [28, 'THE CITIES.'], [29, 'GROW YOUNG.'],
  [32, 'RISE.'], [33, 'RISE.'], [34, 'RISE.'], [35, 'RISE.'], [36, 'A HARD'], [37, "DAY'S WORK."], [38, 'CURE'], [39, 'DISEASES.'],
  [40, 'REJUVENATION'], [42, 'OF THE'], [43, 'HUMAN RACE'], [44, 'THROUGH'], [46, 'AMERICA.'],
  [48, 'THE FOUNTAIN'], [49, 'OF YOUTH:'], [50, 'A STEEL MILL.'], [52, 'UNRELENTING'], [54, 'HUMAN'], [55, 'FLOURISHING.'],
  [56, 'MASTER'], [58, 'OF ALL THINGS.'], [63, null]];
const HOT = new Set(['ALL THINGS', 'HAVE A MASTER.', 'WORKS.', 'CLASS.', 'MASTER', 'OF TIME.', 'GROWS YOUNG.', 'PRODUCTION.', 'GROW YOUNG.', 'RISE.',
  "DAY'S WORK.", 'DISEASES.', 'AMERICA.', 'A STEEL MILL.', 'FLOURISHING.']);
const BIG = new Set(['OF ALL THINGS.']);
const CLOSER = 64, FLASHES = [8, 16, 52];

// ---------------------------------------------------------------- palette (§2.12)
const PAL = { concrete: '#F1EEE6', cobalt: '#1F3E9A', cobalt2: '#5E86D6', yellow: '#FFD21F', red: '#D11F24', turrell: '#FF1A1A' };

// ---------------------------------------------------------------- renderer (0.75, upscaled; hero type is 2D at 1:1)
const RS = 0.75, RW = Math.round(W * RS), RH = Math.round(H * RS);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance', logarithmicDepthBuffer: false });
renderer.setPixelRatio(1); renderer.setSize(RW, RH, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = true;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, W / H, 0.25, 32000);
scene.fog = new THREE.Fog('#9DB6E4', 1800, 16000);

// ---------------------------------------------------------------- baked textures (once; per frame only thresholds move)
const R0 = rng(150);
function cv(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d', { willReadFrequently: true })]; }
function tex(c, { rep = true, srgb = true, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c); if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = aniso; t.generateMipmaps = true; return t;
}
// board-formed concrete: 12 m tile; 0.3 m boards, 2.4 m panels with tie holes, speckle, streaks. Albedo + bump.
function concreteTex(seed, base = [241, 238, 230], board = 26) {
  const r = rng(seed), N = 1024;
  const [c, g] = cv(N), [cb, gb] = cv(N);
  g.fillStyle = `rgb(${base})`; g.fillRect(0, 0, N, N); gb.fillStyle = '#808080'; gb.fillRect(0, 0, N, N);
  for (let y = 0; y < N; y += board) {
    for (let x = 0; x < N; x += 205) {
      const k = (r() - 0.5) * 10; g.fillStyle = `rgba(${k > 0 ? '255,255,255' : '90,95,110'},${Math.abs(k) / 60})`; g.fillRect(x, y, 205, board);
      const kb = 128 + (r() - 0.5) * 18; gb.fillStyle = `rgb(${kb},${kb},${kb})`; gb.fillRect(x, y, 205, board);
    }
    g.fillStyle = 'rgba(70,74,90,0.16)'; g.fillRect(0, y, N, 1.2); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, y + 1.5, N, 1);
    gb.fillStyle = '#5a5a5a'; gb.fillRect(0, y, N, 1.6);
  }
  for (let p = 0; p < N; p += 205) { g.fillStyle = 'rgba(60,64,80,0.33)'; g.fillRect(p, 0, 2.2, N); gb.fillStyle = '#404040'; gb.fillRect(p, 0, 2.5, N); }
  for (let y = 13 + board * 2; y < N; y += board * 4) for (let x = 51; x < N; x += 102) {
    g.fillStyle = 'rgba(40,44,60,0.55)'; g.beginPath(); g.arc(x, y, 3.2, 0, 7); g.fill();
    gb.fillStyle = '#303030'; gb.beginPath(); gb.arc(x, y, 3.5, 0, 7); gb.fill();
    if (r() < 0.5) { const L = 30 + r() * 120, gr = g.createLinearGradient(0, y, 0, y + L); gr.addColorStop(0, 'rgba(80,86,100,0.12)'); gr.addColorStop(1, 'rgba(80,86,100,0)'); g.fillStyle = gr; g.fillRect(x - 2, y, 4 + r() * 3, L); }
  }
  for (let i = 0; i < 14000; i++) { const d = r() < 0.5; g.fillStyle = d ? 'rgba(60,60,70,0.12)' : 'rgba(255,255,255,0.25)'; g.fillRect(r() * N, r() * N, 1 + r() * 1.5, 1 + r() * 1.5); }
  for (let i = 0; i < 90; i++) { const x = r() * N, y = r() * N, rr = 4 + r() * 18; const gr = g.createRadialGradient(x, y, 0, x, y, rr); gr.addColorStop(0, 'rgba(120,120,130,0.08)'); gr.addColorStop(1, 'rgba(120,120,130,0)'); g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
  // chips on panel edges
  for (let i = 0; i < 70; i++) { const x = Math.round(r() * 5) * 205 + (r() - 0.5) * 6, y = r() * N, s = 2 + r() * 6; g.fillStyle = 'rgba(150,150,158,0.5)'; g.fillRect(x - s / 2, y, s, s * 0.7); gb.fillStyle = '#505050'; gb.fillRect(x - s / 2, y, s, s * 0.7); }
  return { map: tex(c), bump: tex(cb, { srgb: false }) };
}
// age mask: R rust blotches + drips, G crack systems (value = closing order), B grime. 1024 tile, non-colour.
function ageMaskTex(seed) {
  const r = rng(seed), N = 1024;
  const [cr, gr] = cv(N), [cc, gc] = cv(N), [cg, gg] = cv(N);
  for (const g of [gr, gc, gg]) { g.fillStyle = '#000'; g.fillRect(0, 0, N, N); }
  gr.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 160; i++) {
    const x = r() * N, y = r() * N, rad = 6 + r() * r() * 60, v = 0.06 + r() * 0.12;
    for (const [ox, oy] of [[0, 0], [N, 0], [-N, 0], [0, N], [0, -N]]) {
      const G = gr.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad); G.addColorStop(0, `rgba(255,255,255,${v})`); G.addColorStop(0.7, `rgba(255,255,255,${v * 0.5})`); G.addColorStop(1, 'rgba(255,255,255,0)');
      gr.fillStyle = G; gr.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    }
    if (r() < 0.35) { const L = 40 + r() * 220, G = gr.createLinearGradient(0, y, 0, y + L); G.addColorStop(0, `rgba(255,255,255,${v * 0.8})`); G.addColorStop(1, 'rgba(255,255,255,0)'); gr.fillStyle = G; gr.fillRect(x - 2, y, 3 + r() * 5, L); }
  }
  // fine speckle so the peel front is ragged, not a blob outline
  for (let i = 0; i < 9000; i++) { gr.fillStyle = `rgba(255,255,255,${r() * 0.12})`; gr.fillRect(r() * N, r() * N, 2 + r() * 4, 2 + r() * 3); }
  gc.lineCap = 'round'; gc.globalCompositeOperation = 'lighten';
  for (let k = 0; k < 22; k++) {
    const segs = crack(r() * N, r() * N, { seed: 1000 + k, angle: r() * 6.28, len: 180 + r() * 420, gens: 3, spread: 0.35 + r() * 0.3, jitter: 0.5 });
    for (const s of segs) { const v = Math.round(255 * (1 - s.o * 0.9)); gc.strokeStyle = `rgb(${v},${v},${v})`; gc.lineWidth = Math.max(1.3, 4.2 * s.w); gc.beginPath(); gc.moveTo(s.x0, s.y0); gc.lineTo(s.x1, s.y1); gc.stroke(); }
  }
  gg.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 160; i++) { const x = r() * N, y = r() * N, rad = 20 + r() * 160; const G = gg.createRadialGradient(x, y, 0, x, y, rad); G.addColorStop(0, `rgba(255,255,255,${0.1 + r() * 0.2})`); G.addColorStop(1, 'rgba(255,255,255,0)'); gg.fillStyle = G; gg.fillRect(x - rad, y - rad, rad * 2, rad * 2); }
  for (let i = 0; i < 140; i++) { const x = r() * N, y = r() * N, L = 60 + r() * 300, G = gg.createLinearGradient(0, y, 0, y + L); G.addColorStop(0, 'rgba(255,255,255,0.5)'); G.addColorStop(1, 'rgba(255,255,255,0)'); gg.fillStyle = G; gg.fillRect(x, y, 2 + r() * 8, L); }
  const [c, g] = cv(N), out = g.createImageData(N, N);
  const a = gr.getImageData(0, 0, N, N).data, b = gc.getImageData(0, 0, N, N).data, d = gg.getImageData(0, 0, N, N).data;
  // continuous rust field: warped fbm (seam cross-faded), so the peel front is a ragged coastline, not dots
  const L = 256, F = new Float32Array(L * L);
  const fb = (x, y) => { const wx = fbm3(x * 0.012 + 3.1, y * 0.012, 1.7, 2) * 40, wy = fbm3(x * 0.012, y * 0.012 + 7.3, 4.2, 2) * 40; return fbm3((x + wx) * 0.018, (y + wy) * 0.018, 0.5, 5); };
  for (let y = 0; y < L; y++) for (let x = 0; x < L; x++) {
    const u = x / L, v = y / L, X = x * 4, Y = y * 4, P = N;
    const f00 = fb(X, Y), f10 = fb(X - P, Y), f01 = fb(X, Y - P), f11 = fb(X - P, Y - P);
    F[y * L + x] = lerp(lerp(f00, f10, u), lerp(f01, f11, u), v);
  }
  for (let i = 0; i < a.length; i += 4) {
    const px = (i >> 2) % N, py = (i >> 2) / N | 0, f = F[(py >> 2) * L + (px >> 2)];
    const rv = clamp(0.5 + f * 1.25 + a[i] / 255 * 0.35 - 0.12, 0, 1) * 255;
    out.data[i] = rv; out.data[i + 1] = b[i]; out.data[i + 2] = d[i]; out.data[i + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  const t = tex(c, { srgb: false }); t.minFilter = THREE.LinearMipmapLinearFilter; return t;
}
function brushedTex(seed, base = [196, 202, 208]) {
  const r = rng(seed), [c, g] = cv(512); g.fillStyle = `rgb(${base})`; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2200; i++) { const y = r() * 512, v = r() < 0.5 ? '255,255,255' : '60,66,76'; g.fillStyle = `rgba(${v},${0.04 + r() * 0.07})`; g.fillRect(0, y, 512, 0.6 + r()); }
  return tex(c);
}
function corrugatedTex(base = [214, 219, 224]) {
  const [c, g] = cv(512), [cb, gb] = cv(512);
  for (let x = 0; x < 512; x++) { const s = Math.sin(x / 512 * Math.PI * 2 * 48); const v = s * 22; g.fillStyle = `rgb(${base.map(q => clamp(q + v, 0, 255) | 0)})`; g.fillRect(x, 0, 1, 512); const bv = 128 + s * 110; gb.fillStyle = `rgb(${bv},${bv},${bv})`; gb.fillRect(x, 0, 1, 512); }
  g.fillStyle = 'rgba(40,46,60,0.25)'; for (let y = 0; y < 512; y += 128) g.fillRect(0, y, 512, 2);
  return { map: tex(c), bump: tex(cb, { srgb: false }) };
}
// facade: concrete with a punched window grid (3 m bays, 4 m floors), 12 m tile
function facadeTex(seed) {
  const r = rng(seed), N = 1024, base = concreteTex(seed + 1).map.image;
  const [c, g] = cv(N); g.drawImage(base, 0, 0);
  const px = N / 12;
  for (let fy = 0; fy < 3; fy++) for (let bx = 0; bx < 4; bx++) {
    const x = (bx * 3 + 0.55) * px, y = (fy * 4 + 1.1) * px, w = 1.9 * px, h = 2.2 * px;
    const G = g.createLinearGradient(0, y, 0, y + h); G.addColorStop(0, '#6d88b8'); G.addColorStop(0.45, '#2c3b58'); G.addColorStop(1, '#1b2436');
    g.fillStyle = 'rgba(60,64,78,0.55)'; g.fillRect(x - 5, y - 5, w + 10, h + 10);
    g.fillStyle = G; g.fillRect(x, y, w, h);
    g.fillStyle = '#e9e6de'; g.fillRect(x + w / 2 - 2, y, 4, h); g.fillRect(x, y + h * 0.38, w, 3);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + w * 0.45, y); g.lineTo(x, y + h * 0.6); g.fill();
    g.fillStyle = 'rgba(70,74,90,0.3)'; g.fillRect(x - 6, y + h + 5, w + 12, 4);
  }
  return tex(c);
}
function sidingTex(seed, col) {
  const r = rng(seed), [c, g] = cv(512); g.fillStyle = col; g.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 512; y += 16) { g.fillStyle = 'rgba(40,44,60,0.28)'; g.fillRect(0, y, 512, 2); g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(0, y + 2, 512, 1); }
  for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(80,80,90,${r() * 0.06})`; g.fillRect(r() * 512, r() * 512, 2, 1); }
  return tex(c);
}
function seamTex() {
  const [c, g] = cv(512), [cb, gb] = cv(512); g.fillStyle = '#c9d0d6'; g.fillRect(0, 0, 512, 512); gb.fillStyle = '#808080'; gb.fillRect(0, 0, 512, 512);
  for (let x = 0; x < 512; x += 32) { g.fillStyle = '#eef2f5'; g.fillRect(x, 0, 3, 512); g.fillStyle = 'rgba(40,50,64,0.35)'; g.fillRect(x + 3, 0, 2, 512); gb.fillStyle = '#ffffff'; gb.fillRect(x, 0, 4, 512); }
  return { map: tex(c), bump: tex(cb, { srgb: false }) };
}
function cloudTex() {
  const r = rng(9), N = 1024, [c, g] = cv(N);
  g.clearRect(0, 0, N, N);
  for (let k = 0; k < 12; k++) {
    const cx = r() * N, cy = r() * N, sx = 30 + r() * 90, sy = sx * (0.35 + r() * 0.3);
    for (let i = 0; i < 40; i++) {
      const x = cx + (r() - 0.5) * sx * 2, y = cy + (r() - 0.5) * sy, rad = sy * (0.3 + r() * 0.7);
      for (const [ox, oy] of [[0, 0], [N, 0], [-N, 0], [0, N], [0, -N]]) {
        const G = g.createRadialGradient(x + ox, y + oy - rad * 0.2, 0, x + ox, y + oy, rad); G.addColorStop(0, 'rgba(255,255,255,0.5)'); G.addColorStop(0.6, 'rgba(236,240,248,0.25)'); G.addColorStop(1, 'rgba(220,228,244,0)');
        g.fillStyle = G; g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
      }
    }
  }
  const t = tex(c); return t;
}
// plains: quarter-section fields (corn, soy, wheat, pasture, fresh-cut hay) with crop rows, center pivots, farmsteads
// under their shelter belts, section roads, a river with its tree line. 8 km tile; the 3D plains dressing sits on top.
function plainsTex() {
  const r = rng(1776), N = 2048, [c, g] = cv(N);
  const crops = [['#5f8a34', 1], ['#6f9a3c', 1], ['#7fa447', 0], ['#c9ae5a', 0], ['#d8bf6a', 0], ['#a7b25a', 1], ['#4f7a30', 1], ['#b99b52', 0], ['#8aa04c', 1], ['#e0cc86', 0]];
  const cell = N / 32;
  g.fillStyle = '#7a9444'; g.fillRect(0, 0, N, N);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    // each section splits into halves or quarters of different crops
    const split = r() < 0.5 ? 2 : r() < 0.7 ? 1 : 4;
    for (let k = 0; k < split; k++) {
      const vert = r() < 0.5, cw = split === 4 ? cell / 2 : split === 2 && vert ? cell / 2 : cell, ch = split === 4 ? cell / 2 : split === 2 && !vert ? cell / 2 : cell;
      const ox = x * cell + (split === 4 ? (k % 2) * cell / 2 : split === 2 && vert ? k * cell / 2 : 0), oy = y * cell + (split === 4 ? (k >> 1) * cell / 2 : split === 2 && !vert ? k * cell / 2 : 0);
      const [col, rows] = crops[(r() * crops.length) | 0];
      g.fillStyle = col; g.fillRect(ox, oy, cw, ch);
      g.strokeStyle = rows ? 'rgba(40,60,20,0.28)' : 'rgba(120,90,40,0.22)'; g.lineWidth = 1; const rv = r() < 0.5;
      for (let q = 1.5; q < (rv ? cw : ch); q += 2.2) { g.beginPath(); if (rv) { g.moveTo(ox + q, oy); g.lineTo(ox + q, oy + ch); } else { g.moveTo(ox, oy + q); g.lineTo(ox + cw, oy + q); } g.stroke(); }
      const G = g.createLinearGradient(ox, oy, ox + cw, oy + ch); G.addColorStop(0, 'rgba(255,255,220,0.06)'); G.addColorStop(1, 'rgba(0,20,0,0.07)'); g.fillStyle = G; g.fillRect(ox, oy, cw, ch);
    }
    if (r() < 0.16) {                      // center pivot
      const cx = x * cell + cell / 2, cy = y * cell + cell / 2, R = cell * 0.47;
      g.fillStyle = r() < 0.5 ? '#4f8430' : '#6c9a3a'; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill();
      g.strokeStyle = 'rgba(30,50,20,0.25)'; for (let k = 6; k < R; k += 5) { g.beginPath(); g.arc(cx, cy, k, 0, 7); g.stroke(); }
      g.strokeStyle = 'rgba(210,210,200,0.6)'; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + R * Math.cos(r() * 7), cy + R * Math.sin(r() * 7)); g.stroke();
    }
    if (r() < 0.3) {                       // farmstead: shelter belt, yard, house, red barn, silos
      const fx = x * cell + (r() < 0.5 ? 6 : cell - 16), fy = y * cell + (r() < 0.5 ? 6 : cell - 16);
      g.fillStyle = '#2f4a22'; g.fillRect(fx - 3, fy - 3, 16, 4); g.fillRect(fx - 3, fy - 3, 4, 16);
      g.fillStyle = '#9a9a82'; g.fillRect(fx + 2, fy + 2, 9, 9);
      g.fillStyle = '#b3261e'; g.fillRect(fx + 3, fy + 3, 4, 3); g.fillStyle = '#f2efe6'; g.fillRect(fx + 8, fy + 6, 3, 3);
      g.fillStyle = '#d8dde2'; g.beginPath(); g.arc(fx + 5, fy + 9, 1.4, 0, 7); g.fill();
    }
  }
  g.fillStyle = '#cfc7b0'; for (let k = 0; k <= 32; k++) { g.fillRect(k * cell - 1, 0, 2, N); g.fillRect(0, k * cell - 1, N, 2); }
  g.fillStyle = '#6d6a64'; for (let k = 0; k <= 32; k += 8) { g.fillRect(k * cell - 2, 0, 4, N); g.fillRect(0, k * cell - 2, N, 4); }
  // the river and its cottonwoods
  const riv = []; for (let x = -40; x <= N + 40; x += 32) riv.push([x, N * 0.62 + Math.sin(x * 0.006) * 140 + Math.sin(x * 0.019) * 40]);
  const path = () => { g.beginPath(); g.moveTo(riv[0][0], riv[0][1]); for (const p of riv) g.lineTo(p[0], p[1]); };
  g.lineCap = 'round'; g.lineJoin = 'round';
  path(); g.strokeStyle = '#2e4d24'; g.lineWidth = 40; g.stroke();
  for (let i = 0; i < 900; i++) { const p = riv[(r() * riv.length) | 0]; g.fillStyle = r() < 0.5 ? '#35562a' : '#284420'; g.beginPath(); g.arc(p[0] + (r() - 0.5) * 60, p[1] + (r() - 0.5) * 50, 2 + r() * 4, 0, 7); g.fill(); }
  path(); g.strokeStyle = '#3d6c9e'; g.lineWidth = 13; g.stroke(); path(); g.strokeStyle = 'rgba(200,225,245,0.35)'; g.lineWidth = 4; g.stroke();
  // speckle: single trees, ponds, field entrances
  for (let i = 0; i < 2500; i++) { g.fillStyle = r() < 0.8 ? 'rgba(40,64,28,0.8)' : 'rgba(60,100,150,0.7)'; g.fillRect(r() * N, r() * N, 1.5 + r() * 2, 1.5 + r() * 2); }
  return tex(c, { aniso: 8 });
}
const AGE = ageMaskTex(1234);
const CON = concreteTex(11), CON2 = concreteTex(12, [236, 233, 226]), FAC = facadeTex(21), STEELMAP = brushedTex(31), CORR = corrugatedTex(), SEAM = seamTex();
const CLOUD = cloudTex(), PLAINS = plainsTex();

// ---------------------------------------------------------------- environment (reflections for glass, steel, visors, enamel)
function buildEnv() {
  // a noon sky dome (cobalt zenith, pale hazy horizon, the sun), warm paving below, and a ring of pale towers and
  // green tree lines on the horizon, so glass and steel reflect a city rather than a gradient
  const es = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 d; void main(){ d = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `varying vec3 d; void main(){ float y = d.y; vec3 top = vec3(0.07,0.16,0.52), hor = vec3(0.72,0.8,0.92), gnd = vec3(0.46,0.44,0.4);
      vec3 c = y > 0. ? mix(hor, top, pow(clamp(y,0.,1.), 0.5)) : mix(hor * 0.8, gnd, clamp(-y*5.,0.,1.));
      c += vec3(6.0) * pow(max(dot(d, normalize(vec3(0.55,0.75,0.4))),0.), 600.);
      gl_FragColor = vec4(c,1.); }` }));
  es.add(sky);
  const r = rng(404), bm = [new THREE.MeshBasicMaterial({ color: '#c9ccd2' }), new THREE.MeshBasicMaterial({ color: '#9aa6b8' }), new THREE.MeshBasicMaterial({ color: '#b58a70' }), new THREE.MeshBasicMaterial({ color: '#3f5a3a' })];
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2, d = 55 + r() * 25, h = i % 4 === 3 ? 2 + r() * 3 : 4 + r() * r() * 26, w = 3 + r() * 6;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), bm[i % 4]); b.position.set(Math.cos(a) * d, h / 2 - 1, Math.sin(a) * d); b.lookAt(0, h / 2 - 1, 0); es.add(b);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(es, 0.02); pm.dispose(); return rt.texture;
}
scene.environment = buildEnv();

// ---------------------------------------------------------------- materials with an `age` that runs backward
// v3: every surface also carries a world-space procedural finish (SURF), computed from the REST position so a fractured
// chunk keeps its bricks and windows while it flies home, box-filtered by fwidth and faded to its average far away:
//   1 board-formed concrete panels (the fortress), 2 brick with punched windows, stone sills and shopfronts,
//   3 limestone ashlar with art-deco window strips, 4 glass curtain wall, 5 lap siding, 6 granite pavers,
//   7 white precast with punched windows, 8 lawn, 9 asphalt. Windows are real reflectors (metal, low roughness).
const SURF_GLSL = `
float hh12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(hh12(i), hh12(i+vec2(1,0)), f.x), mix(hh12(i+vec2(0,1)), hh12(i+vec2(1,1)), f.x), f.y); }
float fst(float e, float x, float w){ return clamp((x - e) / max(w, 1e-4) + 0.5, 0.0, 1.0); }
float bnd(float x, float a, float b, float w){ return fst(a, x, w) - fst(b, x, w); }
// a line of width lw (cell units) at every integer of x, filtered
float gridl(float x, float lw, float w){ float f = abs(fract(x + 0.5) - 0.5); return 1.0 - clamp((f - lw * 0.5) / max(w, 1e-4) + 0.5, 0.0, 1.0); }
uniform vec3 uWall, uWall2, uTrim, uGlass; uniform vec4 uGrid, uWin;
float sGlass = 0.0;
void surf(vec3 P, vec3 N, inout vec3 col, inout float rough, inout float metal){
  bool top = N.y > 0.6;
  vec2 t = normalize(vec2(-N.z, N.x) + 1e-5);
  vec2 q = top ? P.xz : vec2(dot(P.xz, t), P.y);
#if SURF == 1
  vec2 c = q / vec2(3.0, 1.5); if (top) c = q / 3.0;
  vec2 w = fwidth(c); float far = smoothstep(0.3, 0.8, max(w.x, w.y));
  float tone = mix(0.9 + 0.15 * hh12(floor(c) + 7.0), 0.98, far);
  float j = max(gridl(c.x, 0.012, w.x), gridl(c.y, 0.02, w.y)) * (1.0 - far);
  col *= tone * (1.0 - 0.45 * j);
  col *= mix(vec3(1.0), vec3(0.97, 0.985, 1.02), smoothstep(0.4, 0.6, vn2(P.xy * 0.02 + P.z * 0.013)));
#elif SURF == 2 || SURF == 3 || SURF == 7
  if (top) { vec2 c = q / 2.0, w = fwidth(c); col = uWall2 * (0.85 + 0.2 * vn2(q * 0.7)) * (1.0 - 0.25 * max(gridl(c.x, 0.03, w.x), gridl(c.y, 0.03, w.y))); rough = 0.95; return; }
  vec2 g = vec2(q.x / uGrid.x, (q.y - uGrid.w) / uGrid.y), id = floor(g), f = fract(g), w = fwidth(g);
  float far = smoothstep(0.25, 0.7, max(w.x, w.y));
  float ground = step(g.y, 0.0);
  // wall
  vec3 wall = uWall;
#if SURF == 2
  vec2 bc = vec2(q.x / 0.225, q.y / 0.077); bc.x += 0.5 * step(0.5, fract(bc.y * 0.5)); vec2 bw = fwidth(bc);
  float bfar = smoothstep(0.2, 0.5, max(bw.x, bw.y));
  vec3 brick = uWall * (0.82 + 0.3 * hh12(floor(bc) + 3.0)) * (0.92 + 0.12 * vn2(q * 0.6));
  float mortar = max(gridl(bc.x, 0.06, bw.x), gridl(bc.y, 0.14, bw.y));
  wall = mix(mix(brick, vec3(0.74, 0.71, 0.66), mortar), uWall * 0.97, bfar);
#elif SURF == 3
  vec2 ac = vec2(q.x / 1.6, q.y / 0.62); ac.x += 0.5 * step(0.5, fract(ac.y * 0.5)); vec2 aw = fwidth(ac);
  wall = uWall * (0.94 + 0.08 * hh12(floor(ac) + 5.0)) * (1.0 - 0.18 * max(gridl(ac.x, 0.012, aw.x), gridl(ac.y, 0.03, aw.y)) * (1.0 - smoothstep(0.2, 0.5, max(aw.x, aw.y))));
#else
  wall = uWall * (0.95 + 0.06 * hh12(floor(g) + 11.0));
#endif
  // window
  float wx = bnd(f.x, uWin.x, uWin.y, w.x), wy = bnd(f.y, uWin.z, uWin.w, w.y);
  float win = wx * wy * (1.0 - ground);
#if SURF == 3
  float pier = bnd(fract(g.x * 2.0), 0.18, 0.82, w.x * 2.0); win = pier * bnd(f.y, 0.08, 0.92, w.y) * (1.0 - ground);
  float spand = pier * (1.0 - bnd(f.y, 0.08, 0.92, w.y)) * (1.0 - ground); wall = mix(wall, uTrim, spand);
#endif
  float sill = bnd(f.x, uWin.x - 0.04, uWin.y + 0.04, w.x) * (bnd(f.y, uWin.z - 0.06, uWin.z, w.y) + bnd(f.y, uWin.w, uWin.w + 0.07, w.y)) * (1.0 - ground);
  float reveal = wx * bnd(f.y, uWin.w - 0.07, uWin.w, w.y) + bnd(f.x, uWin.x, uWin.x + 0.05, w.x) * wy;   // the recess's own shadow
  // shopfronts on the ground floor: tall glass, a dark bulkhead, a sign band
  float gy = (q.y - 0.0) / max(uGrid.w, 0.1);
  float shop = ground * bnd(f.x, 0.08, 0.92, w.x) * bnd(gy, 0.12, 0.8, w.y);
  float band = ground * bnd(gy, 0.82, 0.95, w.y);
  float hw = hh12(id + 1.3);
  vec3 glass = uGlass * (0.55 + 0.6 * hw);
  float blind = step(0.72, hw) * step(0.0, g.y) * step(f.y, mix(uWin.z, uWin.w, 0.35 + 0.5 * hh12(id + 9.1)) + 1.0) * step(mix(uWin.z, uWin.w, 0.35 + 0.5 * hh12(id + 9.1)), f.y);
  float G = max(win, shop);
  vec3 c0 = wall;
  c0 = mix(c0, uTrim, sill);
  c0 = mix(c0, glass, G);
  c0 = mix(c0, vec3(0.86, 0.8, 0.66), blind * win);
  c0 = mix(c0, uWall2, band);
  c0 *= 1.0 - 0.45 * reveal * (1.0 - G);
  vec3 avg = mix(wall, uGlass * 0.8, (uWin.y - uWin.x) * (uWin.w - uWin.z) * 0.9);
  col = mix(c0, avg, far);
  sGlass = G * (1.0 - blind * win) * (1.0 - far * 0.5);
  rough = mix(rough, 0.06 + 0.12 * hw, sGlass); metal = mix(metal, 0.9, sGlass);
#elif SURF == 4
  if (top) { col = uWall2 * (0.8 + 0.3 * vn2(q * 0.5)); rough = 0.9; return; }
  vec2 g = vec2(q.x / uGrid.x, (q.y - uGrid.w) / uGrid.y), id = floor(g), f = fract(g), w = fwidth(g);
  float far = smoothstep(0.3, 0.8, max(w.x, w.y));
  float mull = max(gridl(g.x, 0.035, w.x), gridl(g.y, 0.03, w.y)) * (1.0 - far);
  float spand = bnd(f.y, 0.0, 0.26, w.y);
  float hw = hh12(id + 2.7), hf = hh12(vec2(id.y, 3.0));
  vec3 glass = uGlass * (0.8 + 0.35 * hw + 0.15 * hf);
  col = mix(glass, uGlass * 0.55, spand * 0.8);
  col = mix(col, uTrim, mull);
  sGlass = (1.0 - mull) * (1.0 - spand * 0.4);
  rough = mix(0.4, 0.035 + 0.06 * hw, sGlass); metal = mix(0.6, 0.95, sGlass);
#elif SURF == 5
  vec2 c = vec2(q.x, q.y / 0.19); vec2 w = fwidth(c);
  float lap = 1.0 - smoothstep(0.0, 0.18 + w.y, fract(c.y)); lap *= 1.0 - smoothstep(0.3, 0.8, w.y);
  col = uWall * (0.97 + 0.05 * vn2(q * 3.0)) * (1.0 - 0.28 * lap);
  col = mix(col, uTrim, top ? 0.0 : 0.0);
#elif SURF == 6
  // granite pavers 1.2 x 0.6 (running bond), a red granite band every 24 m, weathered joints
  vec2 c = vec2(P.x / 1.2, P.z / 0.6); c.x += 0.5 * step(0.5, fract(c.y * 0.5)); vec2 w = fwidth(c);
  float far = smoothstep(0.25, 0.7, max(w.x, w.y));
  float h = hh12(floor(c) + 17.0);
  vec3 gran = uWall * (0.9 + 0.14 * h) * (0.95 + 0.1 * vn2(P.xz * 6.0));
  float redb = (bnd(fract((P.z + 6.0) / 48.0), 0.0, 0.025, fwidth(P.z / 48.0)) + bnd(fract((P.x + 24.6) / 49.2), 0.0, 0.024, fwidth(P.x / 49.2))) * (1.0 - smoothstep(0.02, 0.08, fwidth(P.z / 48.0)));
  gran = mix(gran, uWall2 * (0.9 + 0.15 * h), clamp(redb, 0.0, 1.0));
  float j = max(gridl(c.x, 0.03, w.x), gridl(c.y, 0.05, w.y)) * (1.0 - far);
  col = gran * (1.0 - 0.35 * j);
  rough = 0.7 + 0.2 * h;
#elif SURF == 8
  float n = vn2(P.xz * 0.35) * 0.6 + vn2(P.xz * 2.2) * 0.4;
  float stripe = 0.5 + 0.5 * sin(P.x * 0.9);
  col = uWall * (0.8 + 0.35 * n) * (0.95 + 0.08 * stripe);
  rough = 0.95;
#elif SURF == 9
  float n = vn2(P.xz * 1.7) * 0.5 + vn2(P.xz * 9.0) * 0.5;
  col = uWall * (0.85 + 0.3 * n);
  rough = 0.9;
#endif
}`;
const MATS = [];
function ageMat(o = {}) {
  const S = o.surf || 0;
  const m = new THREE.MeshStandardMaterial({ map: o.map === undefined ? CON.map : o.map, color: o.color || '#ffffff', roughness: o.rough ?? 0.86, metalness: o.metal ?? 0,
    bumpMap: o.bump === undefined ? CON.bump : o.bump, bumpScale: o.bumpScale ?? 1.2, envMapIntensity: o.env ?? 0.6, side: o.side || THREE.FrontSide });
  const col3 = (c, d) => ({ value: new THREE.Color(c || d) });
  const U = { uAge: { value: o.age ?? 0 }, tAge: { value: AGE }, uRep: { value: o.rep ?? 1 }, uRustOn: { value: o.rust ? 1 : 0 },
    uRustCol: { value: new THREE.Color(o.rustCol || '#7c3a17') }, uWave: { value: new THREE.Vector4(0, 0, 0, -1) }, uC: { value: 0 }, uK: { value: 1.6 },
    uCrackOn: { value: o.cracks === false ? 0 : 1 }, uBuild: { value: 1e4 }, uFresh: { value: 0 }, uAO: { value: o.ao ?? 1 },
    uWall: col3(o.wall, '#f1eee6'), uWall2: col3(o.wall2, '#8a8a88'), uTrim: col3(o.trim, '#efe9dc'), uGlass: col3(o.glass, '#2c4a78'),
    uGrid: { value: new THREE.Vector4(...(o.grid || [3.2, 3.8, 0, 4.4])) }, uWin: { value: new THREE.Vector4(...(o.win || [0.28, 0.72, 0.22, 0.8])) } };
  m.userData.U = U; m.defines = { SURF: S };
  const chunk = !!o.chunk;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWP; varying vec3 vRP; varying vec3 vRN; uniform float uC, uK;
        ${chunk ? 'attribute vec3 aCenter; attribute vec3 aLand; attribute vec4 aAxis; attribute float aDelay;' : ''}
        vec3 rotA(vec3 v, vec3 k, float a){ return v*cos(a) + cross(k,v)*sin(a) + k*dot(k,v)*(1.0-cos(a)); }`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        vRN = normalize(mat3(modelMatrix) * objectNormal);
        ${chunk ? 'float cs = clamp(uC*(1.0+uK) - uK*aDelay, 0.0, 1.0); float cs2 = cs*cs; objectNormal = rotA(objectNormal, aAxis.xyz, aAxis.w*cs2);' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vRP = (modelMatrix * vec4(position, 1.0)).xyz;
        ${chunk ? 'transformed = aCenter + (aLand - aCenter)*vec3(cs, cs2, cs) + rotA(position - aCenter, aAxis.xyz, aAxis.w*cs2);' : ''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWP; varying vec3 vRP; varying vec3 vRN; uniform float uAge, uRep, uRustOn, uCrackOn, uBuild, uFresh, uAO; uniform vec3 uRustCol; uniform vec4 uWave; uniform sampler2D tAge;
        float gRust = 0.0; float sRough = -1.0, sMetal = -1.0;
        ${S ? SURF_GLSL : ''}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        if (vWP.y > uBuild) discard;
        ${S ? 'float r0 = 0.86, m0 = 0.0; surf(vRP, normalize(vRN), diffuseColor.rgb, r0, m0); sRough = r0; sMetal = m0;' : ''}
        // contact darkening at the foot of every wall (the plaza bounces less light into the corner)
        diffuseColor.rgb *= mix(1.0, mix(0.7, 1.0, smoothstep(0.0, 2.6, vWP.y)), uAO * (1.0 - step(0.7, abs(vRN.y))));
        float lage = uAge;
        if (uWave.w > 0.0) lage *= smoothstep(uWave.w - 14.0, uWave.w + 14.0, distance(vWP.xz, uWave.xz));
        vec3 am = texture2D(tAge, ${S && S !== 1 ? '(abs(vRN.y) > 0.6 ? vRP.xz : vec2(dot(vRP.xz, normalize(vec2(-vRN.z, vRN.x) + 1e-5)), vRP.y)) / 12.0' : 'vMapUv'} * uRep).rgb;
        float th = 1.0 - lage * 1.06;
        gRust = smoothstep(th, th + 0.035, am.r) * uRustOn;
        float rim = (smoothstep(th - 0.05, th, am.r) - gRust) * uRustOn;
        diffuseColor.rgb = mix(diffuseColor.rgb, uRustCol * (0.55 + 0.9 * am.b), gRust);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.62, 0.38), clamp(rim, 0.0, 1.0) * 0.75);
        float crk = step(1.0 - lage * 0.98, am.g) * step(0.04, am.g) * uCrackOn;
        diffuseColor.rgb *= 1.0 - 0.62 * crk;
        diffuseColor.rgb *= 1.0 - lage * am.b * 0.5;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.62, 0.64, 0.7), uFresh * smoothstep(uBuild - 2.2, uBuild, vWP.y));`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        if (sRough >= 0.0) roughnessFactor = sRough;
        roughnessFactor = mix(roughnessFactor, 0.97, max(gRust, lage * (1.0 - step(0.5, roughnessFactor)) * 0.8));`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        if (sMetal >= 0.0) metalnessFactor = sMetal;
        metalnessFactor = mix(metalnessFactor, 0.0, gRust);`);
  };
  m.customProgramCacheKey = () => (chunk ? 'agechunk' : 'age') + S;
  MATS.push(m); return m;
}
const std = (color, rough = 0.6, metal = 0, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...o });

// ---------------------------------------------------------------- geometry helpers
const M = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));
// box with world-scaled UVs (tile metres per texture repeat) and a random texture offset
function boxG(w, h, d, tile = 12, r = R0) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, ou = r(), ov = r();
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let i = 0; i < uv.count; i++) { const f = Math.floor(i / 4); uv.setXY(i, uv.getX(i) * dims[f][0] / tile + ou, uv.getY(i) * dims[f][1] / tile + ov); }
  return g;
}
class Kit {
  constructor() { this.m = new Map(); }
  add(mat, geo, m4) { const g = (geo.index ? geo.toNonIndexed() : geo.clone()); if (m4) g.applyMatrix4(m4); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); if (!this.m.has(mat)) this.m.set(mat, []); this.m.get(mat).push(g); return this; }
  build({ cast = true, receive = true } = {}) {
    const grp = new THREE.Group();
    for (const [mat, list] of this.m) { const mesh = new THREE.Mesh(mergeGeometries(list), mat); mesh.castShadow = cast; mesh.receiveShadow = receive; grp.add(mesh); }
    return grp;
  }
}
// pre-fractured volume: every face voronoi-cut into chunks with reversed ballistic trajectories (see ageMat chunk)
function fractured(w, h, d, { seed = 1, cell = 6.5, thick = 0.55, tile = 12, floors = 4.0, spread = 1 } = {}) {
  const r = rng(seed), parts = [];
  const faces = [
    { U: w, V: h, m: (u, v, z) => [u, v, d / 2 - z], out: [0, 0, 1] },
    { U: w, V: h, m: (u, v, z) => [-u, v, -d / 2 + z], out: [0, 0, -1] },
    { U: d, V: h, m: (u, v, z) => [w / 2 - z, v, -u], out: [1, 0, 0] },
    { U: d, V: h, m: (u, v, z) => [-w / 2 + z, v, u], out: [-1, 0, 0] },
    { U: w, V: d, m: (u, v, z) => [u, h - z, -(v - d / 2)], out: [0, 1, 0], roof: true },
  ];
  for (const f of faces) {
    const n = Math.max(6, Math.round(f.U * f.V / (cell * cell))), sites = [];
    for (let i = 0; i < n; i++) sites.push([(r() - 0.5) * f.U, r() * f.V]);
    const cells = voronoi([[-f.U / 2, 0], [f.U / 2, 0], [f.U / 2, f.V], [-f.U / 2, f.V]], sites);
    for (const P of cells) {
      if (P.length < 3) continue;
      const sh = new THREE.Shape(P.map(p => new THREE.Vector2(p[0], p[1])));
      const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false, curveSegments: 1 });
      const pos = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const [x, y, z] = f.m(pos.getX(i), pos.getY(i), pos.getZ(i)); pos.setXYZ(i, x, y, z);
        uv.setXY(i, uv.getX(i) / tile + 0.37 * (f.U), uv.getY(i) / tile);
      }
      g.computeVertexNormals();
      let cx = 0, cy = 0; for (const p of P) { cx += p[0]; cy += p[1]; } cx /= P.length; cy /= P.length;
      const C0 = f.m(cx, cy, thick / 2), hgt = f.roof ? h : C0[1];
      const fall = 4 + r() * 10 * spread, ang = r() * 6.283;
      const land = [C0[0] + f.out[0] * fall * 0.8 + Math.cos(ang) * fall * 0.6, 0.4 + r() * r() * Math.min(9, h * 0.25), C0[2] + f.out[2] * fall * 0.8 + Math.sin(ang) * fall * 0.6];
      const ax = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), spin = (r() - 0.5) * 7;
      const delay = clamp(1 - hgt / h * 0.92 - r() * 0.08);
      parts.push({ g, C0, land, ax, spin, delay });
    }
  }
  for (let fy = floors; fy < h - 0.5; fy += floors) {       // floor slabs, split in four
    for (let q = 0; q < 4; q++) {
      const g = boxG(w / 2 - 0.4, 0.35, d / 2 - 0.4, tile, r).toNonIndexed(), qx = (q % 2 - 0.5) * w / 2, qz = ((q >> 1) - 0.5) * d / 2;
      g.applyMatrix4(M(qx, fy, qz));
      const ang = r() * 6.28;
      parts.push({ g, C0: [qx, fy, qz], land: [qx + Math.cos(ang) * 3, 0.5 + r() * 3, qz + Math.sin(ang) * 3], ax: new THREE.Vector3(r() - 0.5, 0.2, r() - 0.5).normalize(), spin: (r() - 0.5) * 1.4, delay: clamp(1 - fy / h * 0.92) });
    }
  }
  const geos = parts.map(p => {
    const g = p.g.index ? p.g.toNonIndexed() : p.g, n = g.attributes.position.count;
    const C = new Float32Array(n * 3), L = new Float32Array(n * 3), A = new Float32Array(n * 4), D = new Float32Array(n);
    for (let i = 0; i < n; i++) { C.set(p.C0, i * 3); L.set(p.land, i * 3); A.set([p.ax.x, p.ax.y, p.ax.z, p.spin], i * 4); D[i] = p.delay; }
    g.setAttribute('aCenter', new THREE.BufferAttribute(C, 3)); g.setAttribute('aLand', new THREE.BufferAttribute(L, 3));
    g.setAttribute('aAxis', new THREE.BufferAttribute(A, 4)); g.setAttribute('aDelay', new THREE.BufferAttribute(D, 1));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'aCenter', 'aLand', 'aAxis', 'aDelay'].includes(k)) g.deleteAttribute(k);
    return g;
  });
  return { geo: mergeGeometries(geos), parts };
}

// ---------------------------------------------------------------- sky, clouds, ground
const sky = new THREE.Mesh(new THREE.SphereGeometry(30000, 48, 24), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { uTop: { value: new THREE.Color(PAL.cobalt) }, uHor: { value: new THREE.Color(PAL.cobalt2) } },
  vertexShader: 'varying vec3 d; void main(){ d = normalize(position); vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position = p.xyww; }',
  fragmentShader: `uniform vec3 uTop, uHor; varying vec3 d; void main(){ float y = max(d.y, 0.0);
    vec3 c = mix(uHor*1.08, uTop*0.82, pow(y, 0.42)); c = mix(c, vec3(0.78,0.84,0.93), exp(-y*22.0)*0.55);
    gl_FragColor = vec4(c, 1.0); }` }));
sky.renderOrder = -10; scene.add(sky);
const cloudMat = new THREE.MeshBasicMaterial({ map: CLOUD, transparent: true, depthWrite: false, fog: false, opacity: 0.55 });
CLOUD.repeat.set(12, 12);
const clouds = new THREE.Mesh(new THREE.PlaneGeometry(36000, 36000), cloudMat); clouds.rotation.x = Math.PI / 2; clouds.position.y = 1400; clouds.renderOrder = -9; scene.add(clouds);
const cloudMat2 = cloudMat.clone(); cloudMat2.map = CLOUD.clone(); cloudMat2.map.repeat.set(4, 4); cloudMat2.opacity = 0.0;
const clouds2 = new THREE.Mesh(new THREE.PlaneGeometry(36000, 36000), cloudMat2); clouds2.rotation.x = Math.PI / 2; clouds2.position.y = 2300; clouds2.renderOrder = -9; scene.add(clouds2);

const plains = new THREE.Mesh(new THREE.PlaneGeometry(24000, 24000), new THREE.MeshStandardMaterial({ map: PLAINS, roughness: 1, envMapIntensity: 0.5 }));
PLAINS.repeat.set(3, 3); plains.rotation.x = -Math.PI / 2; plains.position.y = -0.8; plains.receiveShadow = false; scene.add(plains);
// the green belt around the district: mown lawn (the plains start at its edge, under the shelter belts)
const lawnMat = ageMat({ surf: 8, map: null, bump: null, wall: '#5a7a3a', cracks: false, ao: 0, env: 0.45, rough: 0.95 });
{ const g = new THREE.CircleGeometry(1500, 64); const m = new THREE.Mesh(g, lawnMat); m.rotation.x = -Math.PI / 2; m.position.set(40, -0.3, -80); m.receiveShadow = true; scene.add(m); }
const plazaMat = ageMat({ surf: 6, map: null, bump: null, wall: '#dcd6cb', wall2: '#a4402e', rough: 0.8, env: 0.55, ao: 0 });
const asphaltMat = ageMat({ surf: 9, map: null, bump: null, wall: '#55585e', cracks: true, ao: 0, env: 0.35, rough: 0.9 });
const yardMat = ageMat({ surf: 9, map: null, bump: null, wall: '#8e8a80', cracks: true, ao: 0, env: 0.4, rough: 0.9 });
// paved pads: the fortress apron (granite), the city blocks (asphalt), the mill yard; the town sits on the lawn
for (const [cx, cz, w, d, mat] of [[0, 20, 260, 260, plazaMat], [350, -40, 240, 300, asphaltMat], [-150, -300, 260, 180, yardMat]]) {
  const g = new THREE.PlaneGeometry(w, d); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 24 + cx / 24, uv.getY(i) * d / 24 + cz / 24);
  const m = new THREE.Mesh(g, mat); m.rotation.x = -Math.PI / 2; m.position.set(cx, 0, cz); m.receiveShadow = true; scene.add(m);
}

// plaza markings: yellow walk lanes to the portal and hatched no-stand zones, as painted on the reference apron
{
  const [c, g] = cv(256, 256); g.fillStyle = PAL.yellow; g.fillRect(0, 0, 256, 256); g.fillStyle = '#e9e5dc';
  for (let k = -256; k < 512; k += 48) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 24, 0); g.lineTo(k + 24 - 256, 256); g.lineTo(k - 256, 256); g.fill(); }
  const hatch = new THREE.MeshStandardMaterial({ map: tex(c), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 });
  hatch.map.repeat.set(3, 1);
  const lineM = new THREE.MeshStandardMaterial({ color: PAL.yellow, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2 });
  const K = new Kit();
  for (const x of [-14, 14]) K.add(lineM, new THREE.PlaneGeometry(0.35, 60).rotateX(-Math.PI / 2), M(x, 0.02, 22));
  for (const z of [-4, 20, 44]) K.add(lineM, new THREE.PlaneGeometry(28, 0.35).rotateX(-Math.PI / 2), M(0, 0.02, z));
  K.add(hatch, new THREE.PlaneGeometry(12, 4).rotateX(-Math.PI / 2), M(-30, 0.02, -15)); K.add(hatch, new THREE.PlaneGeometry(12, 4).rotateX(-Math.PI / 2), M(30, 0.02, -15));
  K.add(lineM, new THREE.PlaneGeometry(0.3, 160).rotateX(-Math.PI / 2), M(-40, 0.02, 60)); K.add(lineM, new THREE.PlaneGeometry(0.3, 160).rotateX(-Math.PI / 2), M(40, 0.02, 60));
  const mk = K.build({ cast: false }); scene.add(mk);
}
// ---------------------------------------------------------------- sun: hard white noon, only a few volumes cast
const sun = new THREE.DirectionalLight('#fff3e0', 3.3);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight('#6f94e8', '#cfc4b0', 0.35); scene.add(hemi);
function setSun(az, el, target, span) {
  const d = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  sun.position.copy(target).addScaledVector(d, 900); sun.target.position.copy(target);
  const c = sun.shadow.camera; c.left = -span; c.right = span; c.top = span; c.bottom = -span; c.near = 100; c.far = 2000; c.updateProjectionMatrix();
}

// ---------------------------------------------------------------- THE FORTRESS (white brutalist megastructure, [CREF])
const F = new THREE.Group(); scene.add(F);
const fMat = ageMat({ map: CON.map, bump: CON.bump, rep: 1.0, surf: 1, color: '#e2ddd2' });
const fMat2 = ageMat({ map: CON2.map, bump: CON2.bump, rep: 1.3, surf: 1, color: '#e8e3d9' });
const podMat = ageMat({ map: CON2.map, bump: CON2.bump, rep: 2.2, surf: 1, color: '#dcd6ca' });
const darkMat = std('#1b2230', 0.7, 0.2);
const slitMat = std('#5b7394', 0.07, 0.9, { envMapIntensity: 1.3 });
const steelMat = ageMat({ map: STEELMAP, bump: null, color: '#dfe5ea', rough: 0.34, metal: 0.85, rust: true, env: 1.0, rep: 2, cracks: false });
const railMat = ageMat({ map: STEELMAP, bump: null, color: '#d8dce0', rough: 0.4, metal: 0.8, rust: true, env: 0.9, rep: 3, cracks: false });
const yellowMat = std(PAL.yellow, 0.55, 0.05);
const lampMat = new THREE.MeshBasicMaterial({ color: '#fff6e0' });
{
  const K = new Kit(), r = rng(5);
  K.add(podMat, boxG(128, 6, 76), M(0, 3, -58));                                   // podium
  K.add(fMat, boxG(30, 58, 46), M(-27, 35, -58)); K.add(fMat, boxG(30, 58, 46), M(27, 35, -58));   // main block, split for the portal
  K.add(fMat, boxG(24, 38, 46), M(0, 45, -58));                                    // lintel block over the portal
  K.add(fMat, boxG(24, 20, 30), M(0, 16, -66));                                    // portal back
  // sloped buttresses (the reference's leaning pilasters)
  for (const x of [-40, -13.5, 13.5, 40]) {
    const s = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(9, 0), new THREE.Vector2(2.2, 46), new THREE.Vector2(0, 50)]);
    const g = new THREE.ExtrudeGeometry(s, { depth: 3.4, bevelEnabled: false }); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 12, uv.getY(i) / 12);
    K.add(fMat2, g, M(x - 1.7, 6, -35, 0, Math.PI / 2, 0));
  }
  K.add(fMat2, boxG(4, 26, 2.4), M(-13.8, 19, -33.8)); K.add(fMat2, boxG(4, 26, 2.4), M(13.8, 19, -33.8)); K.add(fMat2, boxG(31.6, 4.5, 2.6), M(0, 28.2, -33.7));  // portal frame
  // chamfer strips and panel joints proud of the face
  for (const x of [-34, -20, 20, 34]) K.add(fMat2, boxG(0.8, 58, 0.6), M(x, 35, -34.8));
  for (const y of [20, 36, 52]) { K.add(fMat2, boxG(26, 0.6, 0.5), M(-27, y, -34.8)); K.add(fMat2, boxG(26, 0.6, 0.5), M(27, y, -34.8)); }
  // upper tiers, roof clutter, tower, mast
  K.add(fMat, boxG(70, 12, 36), M(0, 70, -62)); K.add(fMat2, boxG(72, 1.2, 38), M(0, 64.6, -62));
  K.add(fMat, boxG(40, 10, 24), M(0, 81, -64)); K.add(fMat2, boxG(12, 30, 12), M(0, 101, -64)); K.add(fMat2, boxG(15, 4, 15), M(0, 88, -64));
  K.add(fMat2, boxG(6, 8, 6), M(0, 120, -64));
  for (let i = 0; i < 70; i++) {       // parapet clutter: plant rooms, vents, tanks
    const tier = r() < 0.5 ? [70, 36, 76] : [40, 24, 86], x = (r() - 0.5) * (tier[0] - 6), z = -62 + (r() - 0.5) * (tier[1] - 6), s = 1 + r() * 4;
    K.add(r() < 0.7 ? fMat2 : fMat, boxG(s, s * (0.5 + r()), s * (0.6 + r())), M(x, tier[2] + s * 0.4, z));
  }
  for (const [x, y, z] of [[-30, 66, -38], [-18, 66, -38], [18, 66, -38], [30, 66, -38]]) K.add(fMat2, boxG(6, 5, 5), M(x, y + 2.5, z));
  // window slits and bays on the flanks (dark glass, deep reveals)
  for (let y = 12; y < 60; y += 7) for (const x of [-46, -44, 44, 46]) if (r() < 0.8) K.add(slitMat, boxG(1.0, 3.2, 0.3), M(x + (x > 0 ? -0.2 : 0.2), y, -34.9));
  for (const [x, y] of [[-27, 15], [27, 15], [-27, 59], [27, 59], [-8, 60], [8, 60]]) { K.add(slitMat, boxG(7, 2.6, 0.3), M(x, y, -34.85)); K.add(fMat2, boxG(7.8, 0.5, 1.2), M(x, y - 1.6, -34.4)); }
  for (let i = 0; i < 16; i++) K.add(slitMat, boxG(1.2, 2.4, 0.3), M(-42 + i * 5.6, 72, -43.9));
  // stairs and side ramps down from the portal
  for (let s = 0; s < 20; s++) K.add(podMat, boxG(26, 0.3, 0.62), M(0, 6 - (s + 1) * 0.3 + 0.15, -20 + s * 0.6 + 0.31));
  for (const x of [-15.5, 15.5]) { const rp = boxG(4, 0.6, 13.6); K.add(podMat, rp, M(x, 3, -13.3, Math.atan2(6, 12), 0, 0)); }
  K.add(podMat, boxG(3, 6.4, 14), M(-19, 3.2, -13.3)); K.add(podMat, boxG(3, 6.4, 14), M(19, 3.2, -13.3));
  // side tanks and pipework (steel, rusts)
  for (const x of [-56, -49, 49, 56]) { K.add(steelMat, new THREE.CylinderGeometry(3, 3, 12, 28), M(x, 12, -26)); K.add(steelMat, new THREE.SphereGeometry(3, 28, 10, 0, 6.3, 0, 1.57), M(x, 18, -26)); }
  for (const y of [8, 9.2]) K.add(steelMat, new THREE.CylinderGeometry(0.35, 0.35, 30, 12), M(-52, y, -34, 0, 0, Math.PI / 2));
  for (const y of [8, 9.2]) K.add(steelMat, new THREE.CylinderGeometry(0.35, 0.35, 30, 12), M(52, y, -34, 0, 0, Math.PI / 2));
  // railings along the podium edge and the mast
  for (let x = -63; x <= 63; x += 2.2) if (Math.abs(x) > 14) K.add(railMat, boxG(0.08, 1.1, 0.08), M(x, 6.55, -20.3));
  K.add(railMat, boxG(100, 0.08, 0.08), M(0, 7.1, -20.3));
  // face greebles: conduits, hatches, ladders, ledges, vents (the reference's dense panel furniture)
  for (const x of [-37.5, -31, 31, 37.5]) { K.add(railMat, new THREE.CylinderGeometry(0.22, 0.22, 52, 10), M(x, 34, -34.6)); for (let y = 10; y < 60; y += 4) K.add(railMat, boxG(0.7, 0.14, 0.5), M(x, y, -34.7)); }
  for (const [x, y] of [[-24, 8.5], [-33, 8.5], [24, 8.5], [33, 8.5], [-22, 40], [22, 40], [-36, 44], [36, 44]]) { K.add(slitMat, boxG(2.2, 2.8, 0.2), M(x, y, -34.9)); K.add(fMat2, boxG(2.8, 0.35, 0.8), M(x, y + 1.6, -34.6)); K.add(railMat, boxG(0.12, 0.8, 0.12), M(x + 0.8, y - 0.2, -34.7)); }
  for (let y = 7; y < 62; y += 0.45) K.add(railMat, boxG(0.9, 0.06, 0.06), M(44.2, y, -34.6));
  for (const x of [43.75, 44.65]) K.add(railMat, boxG(0.08, 55, 0.08), M(x, 34.5, -34.6));
  for (const x of [-27, 27]) { K.add(fMat2, boxG(24, 0.5, 2.4), M(x, 30, -33.8)); for (let k = -11; k <= 11; k += 1.5) K.add(railMat, boxG(0.06, 1.1, 0.06), M(x + k, 30.8, -32.7)); K.add(railMat, boxG(24, 0.07, 0.07), M(x, 31.35, -32.7)); }
  for (let i = 0; i < 26; i++) K.add(slitMat, boxG(1.3, 1.6, 0.25), M(-43 + i * 3.44, 62, -34.9));
  for (let i = 0; i < 40; i++) { const x = -44 + (i % 10) * 1.2 + (i >= 20 ? 76.8 : 0) - (i >= 20 ? 0 : 0), y = 50 + Math.floor((i % 20) / 10) * 1.2; K.add(railMat, boxG(0.9, 0.9, 0.3), M(x + (i >= 20 ? -12 : 0), y, -34.8)); }
  K.add(slitMat, boxG(3.2, 4.6, 0.3), M(-44, 8.3, -20.1)); K.add(fMat2, boxG(4.2, 0.5, 1.0), M(-44, 10.9, -19.7));
  for (let x = -60; x <= 60; x += 6) if (Math.abs(x) > 20) K.add(slitMat, boxG(1.6, 0.5, 0.15), M(x, 0.6, -19.95));
  const mast = new Kit();
  mast.add(steelMat, new THREE.CylinderGeometry(0.5, 0.7, 16, 16), M(0, 132, -64)); mast.add(steelMat, new THREE.CylinderGeometry(0.32, 0.45, 14, 12), M(0, 146, -64));
  mast.add(steelMat, new THREE.CylinderGeometry(0.12, 0.22, 12, 8), M(0, 158, -64));
  for (const y of [128, 138, 148]) mast.add(steelMat, boxG(7, 0.25, 0.25), M(0, y, -64));
  for (const [x, z] of [[-1.5, 0], [1.5, 0]]) mast.add(steelMat, new THREE.CylinderGeometry(0.06, 0.06, 20, 5), M(18 + x, 90, -52 + z));
  F.add(K.build());
  F.userData.mast = mast.build(); F.add(F.userData.mast);
  // portal interior (the only place inside the fortress the noon does not reach) and its lamps
  const inner = new THREE.Mesh(new THREE.BoxGeometry(24, 20, 30), new THREE.MeshStandardMaterial({ color: '#2b3444', roughness: 0.9, side: THREE.BackSide }));
  inner.position.set(0, 16, -50); F.add(inner);
  const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 0.2, 0.6), lampMat, 24);
  for (let i = 0; i < 24; i++) lamps.setMatrixAt(i, M(-8 + (i % 4) * 5.3, 25.8, -38 - Math.floor(i / 4) * 4.6)); F.add(lamps);
  for (const x of [-9, -3, 3, 9]) { const l = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 0.8), lampMat); l.position.set(x, 27, -33.2); F.add(l); }
  // stencils: B1 / 27 by the portal, as on the reference
  const [sc, sg] = cv(256, 256); sg.fillStyle = 'rgba(0,0,0,0)'; sg.clearRect(0, 0, 256, 256); sg.fillStyle = 'rgba(40,40,46,0.85)'; sg.font = '900 92px "Plex Mono"'; sg.textAlign = 'center'; sg.fillText('B1', 128, 104); sg.fillText('27', 128, 208);
  const sten = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), new THREE.MeshStandardMaterial({ map: tex(sc, { rep: false }), transparent: true, roughness: 0.9 }));
  sten.position.set(-19.5, 11, -33.9); F.add(sten);
  const sten2 = sten.clone(); sten2.position.set(-47, 11, -34.8); F.add(sten2);
}
// the ACP mark: red enamel on the face, pre-shattered; in reverse time it flies up off the paving and re-forms (§1.5, b52-56)
const MARK = { cx: 0, cy: 47, z: -34.55, size: 27 };
const markMat = ageMat({ map: null, bump: null, chunk: true, rough: 0.22, env: 0.8, cracks: false });
{
  const N = 1024, [c, g] = cv(N);
  g.clearRect(0, 0, N, N); g.drawImage(logoImg, 0, 0, N, N);
  const r = rng(52); g.globalCompositeOperation = 'destination-out';     // chipped enamel edges
  const id = g.getImageData(0, 0, N, N).data;
  for (let i = 0; i < 900; i++) { const x = (r() * N) | 0, y = (r() * N) | 0, a = id[(y * N + x) * 4 + 3]; if (a > 100) { const nx = x + 3, ny = y + 3; const edge = id[((ny % N) * N + (nx % N)) * 4 + 3] < 100 || id[(((y - 4 + N) % N) * N + x) * 4 + 3] < 100; if (edge || r() < 0.06) { g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 5; k++) g.lineTo(x + (r() - 0.5) * 12, y + (r() - 0.5) * 12); g.fill(); } } }
  g.globalCompositeOperation = 'source-over';
  const T = tex(c, { rep: false }); T.anisotropy = 8;
  markMat.map = T; markMat.emissiveMap = T; markMat.alphaTest = 0.5; markMat.transparent = false; markMat.side = THREE.DoubleSide;
  const sites = []; for (let i = 0; i < 90; i++) sites.push([(r() - 0.5) * MARK.size, (r() - 0.5) * MARK.size]);
  const hs = MARK.size / 2, cells = voronoi([[-hs, -hs], [hs, -hs], [hs, hs], [-hs, hs]], sites), geos = [];
  for (const P of cells) {
    if (P.length < 3) continue;
    const gg = new THREE.ExtrudeGeometry(new THREE.Shape(P.map(p => new THREE.Vector2(p[0], p[1]))), { depth: 0.12, bevelEnabled: false, curveSegments: 1 });
    const pos = gg.attributes.position, uv = gg.attributes.uv;
    let cx = 0, cy = 0; for (const p of P) { cx += p[0]; cy += p[1]; } cx /= P.length; cy /= P.length;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / MARK.size + 0.5, pos.getY(i) / MARK.size + 0.5);
    const n = pos.count, C = [MARK.cx + cx, MARK.cy + cy, MARK.z], ang = r() * 6.28, dist = 12 + r() * 38;
    for (let i = 0; i < n; i++) pos.setXYZ(i, pos.getX(i) + MARK.cx, pos.getY(i) + MARK.cy, pos.getZ(i) + MARK.z);
    const L = [MARK.cx + cx * 1.8 + Math.cos(ang) * dist * 0.5, 0.08 + r() * 0.1, -16 + dist * (0.4 + 0.6 * Math.abs(Math.sin(ang)))];
    const Ca = new Float32Array(n * 3), La = new Float32Array(n * 3), Aa = new Float32Array(n * 4), Da = new Float32Array(n);
    const ax = new THREE.Vector3(1, (r() - 0.5) * 0.3, (r() - 0.5) * 0.3).normalize(), spin = -Math.PI / 2 - (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.3;
    for (let i = 0; i < n; i++) { Ca.set(C, i * 3); La.set(L, i * 3); Aa.set([ax.x, ax.y, ax.z, spin], i * 4); Da[i] = clamp(0.5 + cy / MARK.size - r() * 0.3); }
    gg.setAttribute('aCenter', new THREE.BufferAttribute(Ca, 3)); gg.setAttribute('aLand', new THREE.BufferAttribute(La, 3));
    gg.setAttribute('aAxis', new THREE.BufferAttribute(Aa, 4)); gg.setAttribute('aDelay', new THREE.BufferAttribute(Da, 1));
    gg.computeVertexNormals(); geos.push(gg);
  }
  const mark = new THREE.Mesh(mergeGeometries(geos), markMat); mark.castShadow = false; mark.receiveShadow = true;
  mark.customDepthMaterial = undefined; F.add(mark); MARK.mesh = mark;
}

// ---------------------------------------------------------------- people: lib/fx/people.js (detailed, skinned, instanced)
// v3: every figure is a person from the shared module (faces, hands, cloth, hi-vis, hard hats, gait). The crew keeps
// the piece's yellow: the steel crews wear yellow hi-vis and white or yellow hard hats; the chief wears the red hat.
// What the module lacks is built here, locally: a framing hammer on the work grip, soft contact shadows for the far
// crowd, and the scene's own poses (thumbs in the belt, looking up) on top of the module's acts.
const folk = new People(scene, { max: 420, viewH: RH, lodPx: [240, 80], budget: [14, 150], shadows: 'proxy', receiveShadow: true });
const PA = People.API, NB3 = PA.NB * 3, PB = PA.B;
const HIVIS = ['#f2d21a', '#ffd21f', '#f7c80c', '#e8e21c', '#ff8a1a'];
function hire(i, o = {}) {
  const trades = ['steel', 'steel', 'steel', 'weld', 'rail', 'overalls', 'farm', 'steel'];
  const trade = o.trade || trades[i % trades.length];
  const d = People.random(trade, 700 + i * 13, o);
  if (trade === 'steel' && !o.accent) d.accent = HIVIS[i % HIVIS.length];
  if (trade === 'steel' && !o.hatColor) d.hatColor = ['#f4f2ec', '#f4f2ec', '#ffd21f', '#f4f2ec', '#e06a14'][i % 5];
  return folk.add(d);
}
const CHIEF = hire(0, { trade: 'steel', fem: 0, h: 1.86, heavy: 0.4, age: 0.3, skin: '#b98160', hair: '#2a1c12', hairStyle: 1, beard: false, stubble: true,
  top: '#2e3844', bottom: '#5a4630', hatColor: '#c8201c', accent: '#ffd21f', hat: true, gloves: true, dirt: 0.25 });
const POOL = []; for (let i = 1; i < 400; i++) POOL.push(hire(i));
const SPARE = POOL.slice();
// scene poses on top of the acts
const armSet = (Pz, s, ux, uy, uz, fx, curl, hand = 0) => { const [ua, fa, hn, fg] = PA.ARM(s); Pz[ua * 3] = ux; Pz[ua * 3 + 1] = uy; Pz[ua * 3 + 2] = uz; Pz[fa * 3] = fx; Pz[fa * 3 + 1] = 0; Pz[fa * 3 + 2] = 0; Pz[hn * 3] = hand; Pz[fg * 3 + 2] = -s * curl; };
const POSE = {
  belt: (Pz) => { for (const s of [1, -1]) armSet(Pz, s, 0.28, -s * 0.38, s * 0.16, -1.08, 0.9, 0.1); Pz[PB.chest * 3] -= 0.04; Pz[PB.head * 3] -= 0.05; },
  lookUp: (Pz) => { Pz[PB.head * 3] -= 0.45; Pz[PB.chest * 3] -= 0.1; },
  beltUp: (Pz) => { POSE.belt(Pz); Pz[PB.head * 3] -= 0.32; Pz[PB.chest * 3] -= 0.06; },
  shade: (Pz) => { armSet(Pz, -1, -2.3, 0.35, 0.5, -1.9, 0.4, 0.3); Pz[PB.head * 3] -= 0.35; },
};
// the framing hammer (hickory handle, forged head) on the right grip; contact shadows under the far crowd
const hamG = mergeGeometries([vcolorH(new THREE.CylinderGeometry(0.016, 0.019, 0.4, 8).rotateZ(Math.PI / 2).translate(0.1, 0, 0), [0.62, 0.45, 0.28]),
  vcolorH(new THREE.BoxGeometry(0.04, 0.035, 0.15).translate(0.29, 0, 0.02), [0.2, 0.2, 0.22])]);
function vcolorH(g, c) { g = g.toNonIndexed(); g.deleteAttribute('uv'); const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(c, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }
const HAMMERS = new THREE.InstancedMesh(hamG, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.4 }), 120);
HAMMERS.count = 0; HAMMERS.frustumCulled = false; HAMMERS.castShadow = true; scene.add(HAMMERS);
const shadowTex = (() => { const [c, g] = cv(64, 64); const G = g.createRadialGradient(32, 32, 0, 32, 32, 32); G.addColorStop(0, 'rgba(0,0,0,0.9)'); G.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = G; g.fillRect(0, 0, 64, 64); return tex(c, { rep: false }); })();
const CSHADOW = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: shadowTex, color: '#0a1024', transparent: true, opacity: 0.45, depthWrite: false }), 420);
CSHADOW.count = 0; CSHADOW.frustumCulled = false; CSHADOW.renderOrder = 1; scene.add(CSHADOW);
// placement: every frame everyone starts hidden; shots place who they need
let TOOLS = [];
function put(id, x, y, z, s = {}) { folk.set(id, { x, y, z, heading: 0, act: 'stand', t: 0, ph: 0, amt: 1, pump: null, both: false, look: 0, lift: 0, mix: null, speed: 1, pose: null, visible: true, ...s }); return id; }
const face = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);
// the stairs and podium in front of the portal: ground height under (x, z)
function groundY(x, z) { if (Math.abs(x) < 13 && z < -8 && z > -20.5) return clamp((-8 - z) * 0.5, 0, 6); if (z <= -20 && Math.abs(x) < 64 && z > -96) return 6; return 0; }
function walker(id, x0, z0, dir, t, speed, span, o = {}) {           // walks along dir from (x0, z0), wrapping over span metres
  const r = ((id * 0.6180339) % 1), s = ((t * speed + r * span) % span), x = x0 + Math.sin(dir) * s, z = z0 + Math.cos(dir) * s;
  return put(id, x, groundY(x, z), z, { heading: dir, act: 'walk', ph: (t * speed + r * span) * 4.15 + r * 6.28, speed: speed / 1.35, t, ...o });
}
const _fr = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sp = new THREE.Sphere(), _hm = new THREE.Matrix4(), _hq = new THREE.Quaternion(), _hv = new THREE.Vector3(), _hs = new THREE.Vector3(1, 1, 1);
function peopleFrame() {
  camera.updateMatrixWorld(); _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _fr.setFromProjectionMatrix(_pm);
  const cp = camera.position;
  for (let id = 0; id < folk.n; id++) { const st = folk.get(id); if (!st.visible) continue; _sp.center.set(st.x, st.y + 0.95, st.z); _sp.radius = 1.3;
    if (!_fr.intersectsSphere(_sp) || Math.hypot(st.x - cp.x, st.y + 1 - cp.y, st.z - cp.z) < 0.9) st.visible = false; }
  folk.update(camera);
  let nh = 0, ns = 0;
  for (let id = 0; id < folk.n; id++) {
    const st = folk.get(id); if (!st.visible) continue;
    const sc = st.d.h / 1.78 * (1 + (st.d.heavy || 0) * 0.15);
    if (folk.att[id] && folk.att[id].lod > 0) CSHADOW.setMatrixAt(ns++, _hm.compose(_hv.set(st.x, st.y + 0.02, st.z), _hq.setFromAxisAngle(V(0, 1, 0), st.heading), _hs.set(0.9 * sc, 1, 1.0 * sc)));
    _hs.set(1, 1, 1);
    if (st.hammer && folk.grip(id, -1)) { HAMMERS.setMatrixAt(nh++, folk.grip(id, -1)); }
  }
  HAMMERS.count = nh; HAMMERS.instanceMatrix.needsUpdate = true; CSHADOW.count = ns; CSHADOW.instanceMatrix.needsUpdate = true;
}
function hideAll() { for (let id = 0; id < folk.n; id++) folk.get(id).visible = false; }
function forklift(seed = 1) {
  const r = rng(seed), K = new Kit(), dark = std('#26282c', 0.7);
  K.add(yellowMat, new RoundedBoxGeometry(1.25, 0.9, 2.1, 2, 0.08), M(0, 0.75, 0));
  K.add(dark, new RoundedBoxGeometry(1.2, 0.7, 0.55, 2, 0.1), M(0, 0.9, -1.0));
  for (const [x, z] of [[-0.55, 0.55], [0.55, 0.55], [-0.55, -0.85], [0.55, -0.85]]) K.add(dark, new THREE.CylinderGeometry(0.32, 0.32, 0.25, 18), M(x, 0.32, z, 0, 0, Math.PI / 2));
  for (const [x, z] of [[-0.55, 0.45], [0.55, 0.45], [-0.55, -0.65], [0.55, -0.65]]) K.add(dark, boxG(0.06, 1.3, 0.06), M(x, 1.85, z));
  for (let k = 0; k < 5; k++) K.add(dark, boxG(1.16, 0.05, 0.08), M(0, 2.5, -0.6 + k * 0.26));
  K.add(dark, new RoundedBoxGeometry(0.5, 0.5, 0.4, 2, 0.08), M(0, 1.4, -0.2));
  for (const x of [-0.42, 0.42]) K.add(railMat, boxG(0.1, 2.6, 0.12), M(x, 1.35, 1.12));
  K.add(railMat, boxG(0.9, 0.08, 0.1), M(0, 2.55, 1.12)); K.add(railMat, boxG(0.95, 0.5, 0.06), M(0, 0.5, 1.2));
  for (const x of [-0.28, 0.28]) K.add(railMat, boxG(0.1, 0.05, 1.1), M(x, 0.12, 1.75));
  if (r() < 0.6) K.add(std('#b88a52', 0.8), boxG(1.1, 0.5, 1.0), M(0, 0.42, 1.75));
  return K.build();
}
const LIFTS = [forklift(1), forklift(2), forklift(3)];
LIFTS.forEach((l, i) => { l.position.set([-20, 11, 27][i], 0, [8, 12, 3][i]); l.rotation.y = [0.6, -2.4, 1.9][i]; scene.add(l); });
// a steel frame the crew is raising on the plaza (A HARD DAY'S WORK): columns, beams, a stack of plate
const FRAME = new THREE.Group(); scene.add(FRAME);
{ const K = new Kit(), beam = std('#b8392c', 0.5, 0.5);
  for (const x of [-9, 0, 9]) for (const z of [0, 8]) K.add(beam, boxG(0.35, 7, 0.35), M(38 + x, 3.5, 40 + z));
  for (const z of [0, 8]) K.add(beam, boxG(18.6, 0.45, 0.3), M(38, 7, 40 + z)); for (const x of [-9, 0, 9]) K.add(beam, boxG(0.3, 0.45, 8.4), M(38 + x, 7, 44));
  for (let k = 0; k < 6; k++) K.add(steelMat, boxG(2.4, 0.08, 6), M(52, 0.1 + k * 0.09, 44));
  K.add(std('#8a6a44', 0.9), boxG(3, 0.3, 1.2), M(28, 0.15, 36));
  FRAME.add(K.build()); }

// ---------------------------------------------------------------- the city district (x 240..460): fractured blocks and glass towers
// v3: a young American downtown at noon. Red and buff brick lofts with stone sills and shopfronts, limestone deco
// blocks, white precast, blue-green curtain glass; wooden water tanks on the roofs; streets, sidewalks, trees, traffic.
const CITY = new THREE.Group(); scene.add(CITY);
const FACADE = {
  brick: ageMat({ surf: 2, map: null, bump: null, wall: '#9b4a35', wall2: '#6e6a64', trim: '#ece2cc', glass: '#2b4a70', grid: [3.0, 3.7, 0, 4.8], win: [0.26, 0.74, 0.2, 0.8], rough: 0.9 }),
  buff: ageMat({ surf: 2, map: null, bump: null, wall: '#caa47a', wall2: '#77736c', trim: '#f2ead8', glass: '#2d4c74', grid: [2.8, 3.6, 0, 4.6], win: [0.24, 0.76, 0.18, 0.82], rough: 0.9 }),
  lime: ageMat({ surf: 3, map: null, bump: null, wall: '#e2d6bf', wall2: '#7a766e', trim: '#5f6770', glass: '#34577e', grid: [3.2, 3.8, 0, 5.2], win: [0.2, 0.8, 0.1, 0.9], rough: 0.85 }),
  pre: ageMat({ surf: 7, map: null, bump: null, wall: '#ece8df', wall2: '#85817a', trim: '#f6f3ec', glass: '#2c4d7c', grid: [3.0, 3.6, 0, 4.4], win: [0.1, 0.9, 0.24, 0.84], rough: 0.8 }),
  glass: ageMat({ surf: 4, map: null, bump: null, wall: '#b8bec6', wall2: '#6f7278', trim: '#c9ced4', glass: '#3f7090', grid: [1.6, 3.8, 0, 0], rough: 0.2, env: 1.0, cracks: false }),
  glass2: ageMat({ surf: 4, map: null, bump: null, wall: '#b8bec6', wall2: '#6f7278', trim: '#d8dce0', glass: '#4a6a9c', grid: [1.5, 3.6, 0, 0], rough: 0.2, env: 1.0, cracks: false }),
};
const ruinStyle = ['brick', 'lime', 'buff', 'pre', 'brick'];
const RUINS = [];
[[300, 0, 30, 46, 24, 101], [346, -12, 26, 34, 22, 102], [262, -34, 22, 28, 20, 103], [322, -64, 34, 54, 26, 104], [392, 18, 24, 30, 22, 105]].forEach(([x, z, w, h, d, sd], i) => {
  const { geo } = fractured(w, h, d, { seed: sd, cell: i === 0 ? 5.2 : 6.5 });
  const f = FACADE[ruinStyle[i]].userData.U;
  const m = ageMat({ surf: ruinStyle[i] === 'lime' ? 3 : ruinStyle[i] === 'pre' ? 7 : 2, map: null, bump: null, chunk: true,
    wall: '#' + f.uWall.value.getHexString(), wall2: '#' + f.uWall2.value.getHexString(), trim: '#' + f.uTrim.value.getHexString(), glass: '#' + f.uGlass.value.getHexString(),
    grid: f.uGrid.value.toArray(), win: f.uWin.value.toArray(), rough: 0.9 });
  const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, 0, z); mesh.receiveShadow = true; CITY.add(mesh);
  RUINS.push({ mesh, m, x, z, w, h, d });
});
const glassMat = new THREE.MeshStandardMaterial({ color: '#7f9fbf', metalness: 0.95, roughness: 0.035, envMapIntensity: 1.35 });
const coreMat = std('#27303d', 0.8, 0.1);
const mullMat = std('#c3c9d0', 0.35, 0.8, { envMapIntensity: 1.0 });
const TOWERS = [];
const PANES = [];   // {tower, pos, normal, w, h, f(order)}
[[410, -40, 26, 118, 26], [268, -100, 22, 92, 22], [372, -128, 30, 146, 30], [452, 30, 20, 84, 20], [0, 0, 0, 0, 0]].forEach(([x, z, w, h, d], ti) => {
  if (!w) return;
  const K = new Kit(), r = rng(300 + ti);
  K.add(coreMat, boxG(w - 0.6, h, d - 0.6), M(0, h / 2, 0));
  for (let y = 3.6; y < h; y += 3.6) K.add(mullMat, boxG(w + 0.5, 0.42, d + 0.5), M(0, y, 0));       // aluminium spandrel bands
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) K.add(mullMat, boxG(0.7, h, 0.7), M(sx * (w / 2 + 0.05), h / 2, sz * (d / 2 + 0.05)));   // corner mullions
  // the crown: a setback in limestone, a lantern, and (on the tallest) a spire
  K.add(FACADE.lime, boxG(w + 1, 3, d + 1), M(0, h + 1.5, 0)); K.add(FACADE.lime, boxG(w * 0.66, 7, d * 0.66), M(0, h + 6.5, 0));
  K.add(FACADE.glass2, boxG(w * 0.4, 6, d * 0.4), M(0, h + 13, 0));
  if (ti === 2) K.add(mullMat, new THREE.CylinderGeometry(0.2, 0.9, 30, 10), M(0, h + 31, 0));
  const g = K.build({ cast: true }); g.position.set(x, 0, z); CITY.add(g);
  TOWERS.push({ g, x, z, w, h, d });
  for (const [nx, nz] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
    const span = nx ? d : w, cols = Math.floor(span / 1.5);
    for (let fy = 0; fy < Math.floor(h / 3.6) - 0; fy++) for (let cI = 0; cI < cols; cI++) {
      const u = (cI + 0.5) * 1.5 - cols * 0.75, yy = fy * 3.6 + 1.8 + 0.22;
      const px = x + (nx ? nx * w / 2 : u), pz = z + (nz ? nz * d / 2 : -nx * u);
      PANES.push({ ti, p: [px, yy, pz], n: [nx, nz], f: clamp(fy / (h / 3.6) * 0.75 + (cI / cols) * 0.18 + r() * 0.07), r: r() });
    }
  }
});
const paneMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.42, 3.1), glassMat, PANES.length);
paneMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); paneMesh.frustumCulled = false; paneMesh.receiveShadow = false; CITY.add(paneMesh);
paneMesh.setColorAt(0, new THREE.Color(1, 1, 1));

// ---------------------------------------------------------------- the towns (x -330..-250): clapboard houses, metal roofs
const TOWN = new THREE.Group(); scene.add(TOWN);
const ROOFS = [['#e6ebef', 0.8], ['#b8352a', 0.55], ['#3f6a52', 0.55], ['#5a5f68', 0.6]].map(([c, mt]) => ageMat({ map: SEAM.map, bump: SEAM.bump, bumpScale: 2, color: c, rough: 0.38, metal: mt, rust: true, env: 0.9, rep: 1.2, cracks: false, rustCol: '#8a3f16' }));
const roofMat = ROOFS[0];
const sidings = ['#f4f1ea', '#efe0a8', '#b9cfe0', '#c3cfae', '#f2f0ea', '#e8c9b0'].map((c, i) => ageMat({ surf: 5, map: null, bump: null, wall: c, trim: '#fbfaf6', rough: 0.8 }));
const HOUSEWIN = [];
const TRIM = std('#fbfaf6', 0.6), CHIM = ageMat({ surf: 2, map: null, bump: null, wall: '#8e4030', grid: [100, 100, 0, -1], win: [0, 0, 0, 0], rough: 0.9 });
const DOORS = ['#8a1c1c', '#1c3a6a', '#2a4a34', '#f4f1ea'].map(c => std(c, 0.5)), SHUT = ['#1f3a2c', '#1c2230', '#6a1c1c'].map(c => std(c, 0.6));
{
  const r = rng(61);
  for (let i = 0; i < 18; i++) {
    const side = i % 2 ? 1 : -1, z = -96 + Math.floor(i / 2) * 22, x = -290 + side * 16, K = new Kit();
    const w = 9 + r() * 3, h = 6 + (r() < 0.4 ? 3 : 0), d = 11 + r() * 3;
    const sm = sidings[(i * 5 + 1) % sidings.length], rm = ROOFS[(i * 3 + (i >> 2)) % ROOFS.length];
    K.add(sm, boxG(w, h, d, 4), M(0, h / 2, 0));
    const tri = new THREE.Shape([new THREE.Vector2(-w / 2 - 0.5, 0), new THREE.Vector2(w / 2 + 0.5, 0), new THREE.Vector2(0, w * 0.42)]);
    const rg = new THREE.ExtrudeGeometry(tri, { depth: d + 1.2, bevelEnabled: false }); { const uv = rg.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) / 6, uv.getY(k) / 6); }
    K.add(rm, rg, M(0, h, -(d + 1.2) / 2));
    for (const cx of [-w / 2 - 0.08, w / 2 + 0.08]) for (const cz of [-d / 2 - 0.08, d / 2 + 0.08]) K.add(TRIM, boxG(0.22, h, 0.22), M(cx, h / 2, cz));   // corner boards
    K.add(TRIM, boxG(w + 0.3, 0.3, 0.3), M(0, h - 0.15, d / 2 + 0.1));
    K.add(DOORS[i % DOORS.length], boxG(1.1, 2.2, 0.12), M(w * 0.05, 1.1, d / 2 + 0.06)); K.add(TRIM, boxG(1.5, 0.2, 0.2), M(w * 0.05, 2.3, d / 2 + 0.08));
    K.add(CHIM, boxG(1.0, 2.6, 1.0), M(-w * 0.3, h + w * 0.25, -d * 0.2));

    K.add(sm, boxG(w * 0.9, 0.3, 2.5), M(0, 3, (d / 2 + 1.25) * 1));
    for (const px of [-w * 0.4, w * 0.4]) K.add(fMat2, boxG(0.25, 3, 0.25), M(px, 1.5, d / 2 + 2.3));
    for (let fl = 0; fl < (h > 7 ? 2 : 1); fl++) for (const u of [-w * 0.28, w * 0.28]) {      // window casings and shutters
      const ly = 1.9 + fl * 3.2; K.add(TRIM, boxG(1.75, 2.3, 0.08), M(u, ly, d / 2 - 0.03));
      if (i % 3) for (const sx of [-1, 1]) K.add(SHUT[i % SHUT.length], boxG(0.55, 1.95, 0.06), M(u + sx * 1.2, ly, d / 2 + 0.02));
    }
    const g = K.build(); g.position.set(x, 0, z); g.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2; TOWN.add(g);
    for (let fl = 0; fl < (h > 7 ? 2 : 1); fl++) for (const u of [-w * 0.28, w * 0.28]) {
      const lx = u, ly = 1.9 + fl * 3.2, lz = d / 2 + 0.03;
      const v = new THREE.Vector3(lx, ly, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), g.rotation.y).add(g.position);
      const n = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), g.rotation.y);
      HOUSEWIN.push({ p: [v.x, v.y, v.z], n: [n.x, n.z], f: r() * 0.9, r: r() });
    }
  }
  const street = new THREE.Mesh(new THREE.PlaneGeometry(18, 260), std('#4a4c52', 0.95)); street.rotation.x = -Math.PI / 2; street.position.set(-290, 0.03, 0); TOWN.add(street);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 260), std(PAL.yellow, 0.7)); line.rotation.x = -Math.PI / 2; line.position.set(-290, 0.05, 0); TOWN.add(line);
}
const hwMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.4, 1.9), glassMat, HOUSEWIN.length); hwMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); hwMesh.frustumCulled = false; TOWN.add(hwMesh);

// ---------------------------------------------------------------- the mill (z -300): furnace, stoves, ducts, clad shed. The fountain.
const MILL = new THREE.Group(); scene.add(MILL);
const millSteel = ageMat({ map: STEELMAP, bump: null, color: '#e2e7ec', rough: 0.3, metal: 0.9, rust: true, env: 1.1, rep: 3, cracks: false, rustCol: '#86391a' });
const cladMat = ageMat({ map: CORR.map, bump: CORR.bump, bumpScale: 1.5, color: '#a9bccd', rough: 0.45, metal: 0.5, rust: true, env: 0.8, rep: 0.9, cracks: false, rustCol: '#8c4218' });
const cladRed = ageMat({ map: CORR.map, bump: CORR.bump, bumpScale: 1.5, color: '#b8392c', rough: 0.5, metal: 0.4, rust: true, env: 0.7, rep: 0.9, cracks: false, rustCol: '#6c2c12' });
const MILLC = new THREE.Vector3(-150, 0, -300);
{
  const K = new Kit(), r = rng(71), c = MILLC;
  const clad = (w, h, d, x, y, z) => { const g = boxG(w, h, d, 16); K.add(cladMat, g, M(c.x + x, y, c.z + z)); };
  clad(150, 30, 46, 40, 15, 20); K.add(cladRed, boxG(150, 8, 20, 16), M(c.x + 40, 34, c.z + 20));        // casthouse shed + monitor roof
  const gable = new THREE.Shape([new THREE.Vector2(-24, 0), new THREE.Vector2(24, 0), new THREE.Vector2(0, 7)]);
  const gg = new THREE.ExtrudeGeometry(gable, { depth: 150, bevelEnabled: false }); { const uv = gg.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) / 16, uv.getY(k) / 16); }
  K.add(cladRed, gg, M(c.x - 35, 30, c.z + 20, 0, Math.PI / 2, 0));
  // blast furnace: tapered shell, bands, platforms, bustle pipe
  K.add(millSteel, new THREE.CylinderGeometry(6, 8, 34, 40), M(c.x - 50, 17, c.z - 12));
  K.add(millSteel, new THREE.CylinderGeometry(4, 6, 12, 40), M(c.x - 50, 40, c.z - 12));
  K.add(millSteel, new THREE.CylinderGeometry(2.2, 4, 10, 32), M(c.x - 50, 51, c.z - 12));
  for (const y of [6, 12, 18, 24, 30]) K.add(millSteel, new THREE.CylinderGeometry(7.9 - y * 0.06, 7.9 - y * 0.06, 0.7, 40), M(c.x - 50, y, c.z - 12));
  K.add(millSteel, new THREE.TorusGeometry(10, 0.9, 12, 48), M(c.x - 50, 26, c.z - 12, Math.PI / 2, 0, 0));
  for (const y of [34, 46]) K.add(railMat, new THREE.CylinderGeometry(9, 9, 0.4, 40), M(c.x - 50, y, c.z - 12));
  for (let k = 0; k < 4; k++) K.add(millSteel, new THREE.CylinderGeometry(1.1, 1.1, 18, 14), M(c.x - 50 + (k - 1.5) * 1.5, 62, c.z - 12));   // uptakes
  K.add(millSteel, new THREE.CylinderGeometry(1.6, 1.6, 40, 16), M(c.x - 70, 52, c.z - 12, 0, 0, 1.0));   // downcomer
  // hot-blast stoves in a row
  for (let k = 0; k < 4; k++) { const x = c.x - 100 + k * 13; K.add(millSteel, new THREE.CylinderGeometry(5, 5, 42, 36), M(x, 21, c.z - 28)); K.add(millSteel, new THREE.SphereGeometry(5, 36, 12, 0, 6.3, 0, 1.57), M(x, 42, c.z - 28)); for (const y of [8, 18, 28, 38]) K.add(millSteel, new THREE.CylinderGeometry(5.12, 5.12, 0.5, 36), M(x, y, c.z - 28)); }
  K.add(millSteel, new THREE.CylinderGeometry(1.8, 1.8, 56, 16), M(c.x - 80, 34, c.z - 20, 0, 0, Math.PI / 2));   // hot-blast main
  // skip incline and ducts
  K.add(millSteel, boxG(5, 3, 70, 8), M(c.x - 50, 24, c.z + 30, -0.62, 0, 0));
  for (let k = 0; k < 6; k++) K.add(railMat, boxG(0.5, 26 - k * 3.2, 0.5), M(c.x - 52.5, (26 - k * 3.2) / 2, c.z + 56 - k * 9));
  K.add(millSteel, new THREE.CylinderGeometry(2.4, 2.4, 60, 20), M(c.x + 20, 38, c.z - 6, 0, 0, Math.PI / 2));
  for (let k = 0; k < 5; k++) K.add(railMat, boxG(0.6, 36, 0.6), M(c.x - 5 + k * 12, 18, c.z - 6));
  MILL.add(K.build());
}

// ---------------------------------------------------------------- the clock tower: AMERICAN TIME, running young
const CLOCK = new THREE.Group(); scene.add(CLOCK);
const CLK = { x: -84, z: -6, y: 50, r: 7.5 };
{
  const K = new Kit();
  K.add(fMat, boxG(19, 70, 16), M(CLK.x, 35, CLK.z - 8)); K.add(fMat2, boxG(21, 3, 18), M(CLK.x, 71.5, CLK.z - 8));
  K.add(fMat2, boxG(20, 1, 17), M(CLK.x, 40, CLK.z - 8));
  CLOCK.add(K.build());
  const [c, g] = cv(1024); g.fillStyle = '#f6f4ef'; g.beginPath(); g.arc(512, 512, 510, 0, 7); g.fill();
  g.strokeStyle = '#1c2230'; g.lineWidth = 14; g.beginPath(); g.arc(512, 512, 488, 0, 7); g.stroke(); g.lineWidth = 4; g.beginPath(); g.arc(512, 512, 462, 0, 7); g.stroke();
  const RN = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  g.fillStyle = '#1c2230'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < 60; i++) { const a = i / 60 * Math.PI * 2; g.save(); g.translate(512, 512); g.rotate(a); g.fillRect(-(i % 5 ? 3 : 8), -455, i % 5 ? 6 : 16, i % 5 ? 22 : 44); g.restore(); }
  g.font = '900 78px Cinzel, serif';
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.save(); g.translate(512 + Math.sin(a) * 350, 512 - Math.cos(a) * 350); g.rotate(a); g.fillText(RN[i], 0, 0); g.restore(); }
  g.font = '900 44px Cinzel, serif'; g.fillStyle = '#b3161b'; g.fillText('AMERICAN', 512, 330); g.fillText('TIME', 512, 692);
  const dial = new THREE.Mesh(new THREE.CircleGeometry(CLK.r, 96), new THREE.MeshStandardMaterial({ map: tex(c, { rep: false }), roughness: 0.5 }));
  dial.position.set(CLK.x, CLK.y, CLK.z + 0.05); dial.receiveShadow = true; CLOCK.add(dial);
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(CLK.r + 0.2, 0.35, 12, 96), steelMat); bezel.position.set(CLK.x, CLK.y, CLK.z + 0.1); CLOCK.add(bezel);
  const handMat = std('#161a22', 0.4, 0.5);
  const mk = (len, w) => { const gH = new THREE.Group(); const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, 0.2), handMat); m.position.y = len / 2 - len * 0.15; m.castShadow = true; gH.add(m); gH.position.set(CLK.x, CLK.y, CLK.z + 0.9); CLOCK.add(gH); return gH; };
  CLK.hour = mk(4.4, 0.55); CLK.min = mk(6.4, 0.32); CLK.sec = mk(6.8, 0.1);
}

// ---------------------------------------------------------------- macro rigs: a steel column (OF STEEL), the podium joint (CURE)
const MACRO = new THREE.Group(); scene.add(MACRO);
const colMat = ageMat({ map: STEELMAP, bump: null, color: '#dbe2e8', rough: 0.28, metal: 0.92, rust: true, env: 1.2, rep: 1.6, cracks: false, rustCol: '#7d3413' });
const COL = { x: 64, z: 34 };
{
  const K = new Kit();
  K.add(colMat, boxG(0.9, 12, 0.05, 2), M(COL.x, 6, COL.z + 0.45)); K.add(colMat, boxG(0.9, 12, 0.05, 2), M(COL.x, 6, COL.z - 0.45));   // flanges
  K.add(colMat, boxG(0.04, 12, 0.9, 2), M(COL.x, 6, COL.z));                                                                            // web
  K.add(colMat, boxG(1.0, 0.9, 0.04, 2), M(COL.x, 3.2, COL.z + 0.5)); K.add(colMat, boxG(0.5, 1.4, 0.04, 2), M(COL.x + 0.24, 3.2, COL.z + 0.49));
  for (let i = 0; i < 12; i++) { const bx = COL.x + ((i % 3) - 1) * 0.28, by = 2.9 + Math.floor(i / 3) * 0.2; K.add(colMat, new THREE.CylinderGeometry(0.035, 0.035, 0.05, 6), M(bx, by, COL.z + 0.54, Math.PI / 2, 0, 0)); }
  K.add(podMat, boxG(1.8, 0.6, 1.8), M(COL.x, 0.3, COL.z)); K.add(colMat, boxG(1.3, 0.06, 1.3), M(COL.x, 0.63, COL.z));
  K.add(colMat, boxG(8, 0.9, 0.9, 2), M(COL.x - 3.6, 11.4, COL.z));
  MACRO.add(K.build());
}
// weeds in the podium joint; they retract as the age runs back
const WEEDS = []; const weedMat = std('#4f7a26', 0.75);
const weedMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(0.018, 1, 3).translate(0, 0.5, 0), weedMat, 420); weedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); weedMesh.frustumCulled = false; MACRO.add(weedMesh);
{ const r = rng(81); for (let i = 0; i < 420; i++) { const cl = Math.floor(r() * 9); WEEDS.push({ x: 26.5 + cl + (r() - 0.5) * 0.5, z: -19.9 + r() * 0.3, h: 0.25 + r() * r() * 1.1, a: (r() - 0.5) * 0.9, b: (r() - 0.5) * 0.9, f: r() }); } }

// ---------------------------------------------------------------- the Turrell room (inside the fortress; the red rest before the drop)
const ROOM = new THREE.Group(); ROOM.position.set(-6000, 0, 0); scene.add(ROOM);
const roomMat = new THREE.ShaderMaterial({ side: THREE.BackSide, fog: false, uniforms: { uLum: { value: 1 }, uHaze: { value: 0.5 } },
  vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `uniform float uLum, uHaze; varying vec3 vP;
    void main(){ vec2 ap = vec2(vP.x, vP.y - 6.5); float far = smoothstep(-14.0, -15.0, vP.z);
      float inA = far * smoothstep(0.35, -0.35, max(abs(ap.x) - 5.5, abs(ap.y) - 3.4));
      float d = length(vec3(ap.x * 0.8, ap.y, (vP.z + 15.0) * 0.55));
      vec3 wall = vec3(0.16, 0.0, 0.015) + vec3(1.0, 0.07, 0.06) * exp(-d * 0.16) * uLum * 0.95;
      vec3 apc = mix(vec3(1.0, 0.13, 0.12), vec3(1.0, 0.42, 0.55), exp(-length(ap) * 0.35)) * (0.85 + 0.35 * uLum);
      vec3 c = mix(wall, apc, inA);
      c = mix(c, vec3(0.9, 0.05, 0.05) * uLum, uHaze * 0.25 * smoothstep(8.0, 30.0, length(vP.xz - vec2(0.0, 12.0))));
      gl_FragColor = vec4(c, 1.0); }` });
const room = new THREE.Mesh(new THREE.BoxGeometry(24, 14, 30, 1, 1, 1), roomMat); room.position.set(0, 7, 0); ROOM.add(room);
const hazeMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, uniforms: { uA: { value: 0.3 } },
  vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: 'uniform float uA; varying vec2 vU; void main(){ vec2 q = vU - 0.5; float a = exp(-dot(q*vec2(2.2,3.0), q*vec2(2.2,3.0))*3.0); gl_FragColor = vec4(vec3(1.0,0.12,0.1)*a*uA, 1.0); }' });
for (let k = 0; k < 4; k++) { const hp = new THREE.Mesh(new THREE.PlaneGeometry(26, 16), hazeMat); hp.position.set(0, 6.5, -12 + k * 5); ROOM.add(hp); }
const SIL = worker({ seed: 9, suit: 0, helm: 'W', pack: true, pose: { look: 0.2, armL: 0.1, armR: -0.05 } });
SIL.traverse(o => { if (o.isMesh) o.material = new THREE.MeshBasicMaterial({ color: '#070002' }); });
SIL.position.set(0.8, 0, -4); SIL.rotation.y = Math.PI; SIL.scale.setScalar(1.05); ROOM.add(SIL);

// ---------------------------------------------------------------- rail and river beside the fortress (THROUGH AMERICA)
{
  const K = new Kit();
  const bed = std('#8d8779', 1); const tie = std('#5a4a3c', 0.9);
  K.add(bed, boxG(5, 0.4, 3400), M(150, 0.2, -1300)); for (const x of [149.2, 150.8]) K.add(railMat, boxG(0.12, 0.2, 3400), M(x, 0.5, -1300));
  const tieM = new THREE.InstancedMesh(new THREE.BoxGeometry(2.8, 0.15, 0.25), tie, 1600); for (let i = 0; i < 1600; i++) tieM.setMatrixAt(i, M(150, 0.42, 400 - i * 2.1)); scene.add(tieM);
  scene.add(K.build({ cast: false }));
  const river = new THREE.Mesh(new THREE.PlaneGeometry(90, 9000), new THREE.MeshStandardMaterial({ color: '#2d5a9a', roughness: 0.08, metalness: 0.4, envMapIntensity: 1.3 }));
  river.rotation.x = -Math.PI / 2; river.rotation.z = 0.12; river.position.set(-1500, -2.3, -1500); scene.add(river);
}

// ---------------------------------------------------------------- v3 dressing: the young American city and plain at noon
// Trees, traffic, streets and sidewalks, a skyline of brick, limestone and glass with wooden water tanks, the interstate
// with its rigs, farmsteads with red barns and silos under shelter belts, grain elevators on the rail, and the colours on
// the fortress: US flags and red banners on the approach, two red banners on the face. All instanced or merged.
const DRESS = new THREE.Group(); scene.add(DRESS);
function vcolor(g, rgb) { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
  const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(typeof rgb === 'function' ? rgb(g.attributes.position, i) : rgb, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }
// ---- trees: round street trees (oak/maple), columnar poplars and spruce for the shelter belts. Vertex-coloured, lumpy.
const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, envMapIntensity: 0.55 });
treeMat.onBeforeCompile = sh => {       // leaf clumps: a world-space value noise darkens the gaps between clusters
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 tW;').replace('#include <project_vertex>', '#include <project_vertex>\n tW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
    varying vec3 tW; float th3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float tn3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
      return mix(mix(mix(th3(i), th3(i+vec3(1,0,0)), f.x), mix(th3(i+vec3(0,1,0)), th3(i+vec3(1,1,0)), f.x), f.y),
                 mix(mix(th3(i+vec3(0,0,1)), th3(i+vec3(1,0,1)), f.x), mix(th3(i+vec3(0,1,1)), th3(i+vec3(1,1,1)), f.x), f.y), f.z); }`)
    .replace('#include <color_fragment>', `#include <color_fragment>
    float leaf = step(0.25, vColor.g - vColor.r);
    float cl = tn3(tW * 1.6) * 0.65 + tn3(tW * 4.5) * 0.35;
    diffuseColor.rgb *= mix(1.0, 0.55 + 0.75 * cl, leaf);`);
};
treeMat.customProgramCacheKey = () => 'tree3';
function treeGeo(kind, seed, lod = 1) {
  const r = rng(seed), P = [], bark = [0.26, 0.19, 0.13];
  const blob = (x, y, z, rad, c) => { const g = new THREE.IcosahedronGeometry(rad, lod); const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const k = 1 + (Math.sin(p.getX(i) * 5.1 + seed) * Math.sin(p.getY(i) * 4.3) * Math.sin(p.getZ(i) * 4.7 + x)) * 0.16; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.9, p.getZ(i) * k); }
    g.computeVertexNormals(); g.translate(x, y, z);
    P.push(vcolor(g, (pp, i) => { const t = clamp((pp.getY(i) - (y - rad)) / (2 * rad)); return c.map((v, j) => v * (0.62 + 0.55 * t) * (j === 1 ? 1 : 0.96)); })); };
  if (kind === 'oak') {
    P.push(vcolor(new THREE.CylinderGeometry(0.14, 0.24, 3.6, 7).translate(0, 1.8, 0), bark));
    for (const [a, l] of [[0.4, 1.2], [2.5, 1.1], [4.4, 1.3]]) P.push(vcolor(new THREE.CylinderGeometry(0.06, 0.1, l * 1.6, 5).rotateZ(0.7).rotateY(a).translate(Math.cos(a) * 0.5, 3.5, -Math.sin(a) * 0.5), bark));
    const c = [[0.22, 0.4, 0.13], [0.27, 0.45, 0.15], [0.3, 0.44, 0.12]][seed % 3];
    blob(0, 5.0, 0, 2.3, c);
    for (let k = 0; k < 5; k++) { const a = k * 1.26 + r(), d = 1.3 + r() * 0.5; blob(Math.cos(a) * d, 4.3 + r() * 1.6, Math.sin(a) * d, 1.35 + r() * 0.5, c); }
    blob(0, 6.6, 0, 1.4, c);
  } else if (kind === 'poplar') {
    P.push(vcolor(new THREE.CylinderGeometry(0.1, 0.2, 2.5, 6).translate(0, 1.25, 0), bark));
    const c = [0.23, 0.38, 0.14];
    for (let k = 0; k < 4; k++) blob((r() - 0.5) * 0.4, 3.2 + k * 2.1, (r() - 0.5) * 0.4, 1.5 - k * 0.2, c);
  } else {  // spruce
    P.push(vcolor(new THREE.CylinderGeometry(0.1, 0.2, 2, 6).translate(0, 1, 0), bark));
    for (let k = 0; k < 4; k++) { const g = new THREE.ConeGeometry(2.2 - k * 0.45, 3.2, 9, 1, true).translate(0, 2.6 + k * 1.75, 0); g.computeVertexNormals();
      P.push(vcolor(g, (pp, i) => { const t = clamp((pp.getY(i) - 1) / 9); return [0.12 + 0.05 * t, 0.26 + 0.1 * t, 0.12 + 0.03 * t]; })); }
  }
  return mergeGeometries(P);
}
const TREEG = { oak: [treeGeo('oak', 1), treeGeo('oak', 2)], poplar: [treeGeo('poplar', 3)], spruce: [treeGeo('spruce', 4)], oakLo: [treeGeo('oak', 5, 0)], poplarLo: [treeGeo('poplar', 6, 0)] };
const TREES = [];
function grove(kind, pts, { cast = true, v = 0 } = {}) {
  if (!pts.length) return null;
  const geo = TREEG[kind][v % TREEG[kind].length], m = new THREE.InstancedMesh(geo, treeMat, pts.length), c = new THREE.Color();
  pts.forEach(([x, z, s = 1, ry = 0, tint = 0], i) => { m.setMatrixAt(i, M(x, 0, z, 0, ry, 0, s, s * (0.9 + 0.2 * ((i * 0.618) % 1)), s)); c.setRGB(0.85 + 0.3 * tint, 0.9 + 0.2 * ((i * 0.37) % 1), 0.85 + 0.2 * (1 - tint)); m.setColorAt(i, c); });
  m.castShadow = cast; m.receiveShadow = true; m.computeBoundingSphere(); DRESS.add(m); TREES.push(m); return m;
}
// footprints to keep clear (buildings, the fortress, the rail, the mill): [x0, z0, x1, z1]
const CLEAR = [[-70, -120, 70, -18], [-96, -24, -72, -4], [140, -3200, 160, 420], [-270, -360, -30, -250]];
RUINS.forEach(R => CLEAR.push([R.x - R.w / 2 - 3, R.z - R.d / 2 - 3, R.x + R.w / 2 + 3, R.z + R.d / 2 + 3]));
TOWERS.forEach(T => CLEAR.push([T.x - T.w / 2 - 3, T.z - T.d / 2 - 3, T.x + T.w / 2 + 3, T.z + T.d / 2 + 3]));
const clear = (x, z, pad = 0) => !CLEAR.some(([a, b, c, d]) => x > a - pad && x < c + pad && z > b - pad && z < d + pad);

// ---- city streets: asphalt lanes with markings over a jointed-concrete sidewalk pad; street trees; lamp posts
const walkMat = ageMat({ surf: 6, map: null, bump: null, wall: '#aaa59b', wall2: '#aaa59b', rough: 0.85, env: 0.5, ao: 0 });
const STREETS = [   // [x0, z0, x1, z1] rectangles (asphalt), with the lane axis along the long side
  [230, 40, 470, 52], [230, -89, 470, -78], [230, -168, 470, -156], [234, -190, 246, 110], [364, -78, 376, 110], [424, -190, 436, 110]];
{
  const g = new THREE.PlaneGeometry(240, 300); const m = new THREE.Mesh(g, walkMat); m.rotation.x = -Math.PI / 2; m.position.set(350, 0.01, -40); m.receiveShadow = true; CITY.add(m);
  const K = new Kit(), lineY = std(PAL.yellow, 0.7, 0, { polygonOffset: true, polygonOffsetFactor: -3 }), lineW = std('#f2f0ea', 0.7, 0, { polygonOffset: true, polygonOffsetFactor: -3 });
  for (const [x0, z0, x1, z1] of STREETS) {
    const w = x1 - x0, d = z1 - z0, along = w > d;
    K.add(asphaltMat, new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), M((x0 + x1) / 2, 0.03, (z0 + z1) / 2));
    const L = along ? w : d;
    for (let s = 2; s < L - 2; s += 6) {       // the dashed centre line and the curbs
      const u = (along ? x0 : z0) + s + 1.5;
      K.add(lineY, new THREE.PlaneGeometry(along ? 3 : 0.18, along ? 0.18 : 3).rotateX(-Math.PI / 2), M(along ? u : (x0 + x1) / 2, 0.045, along ? (z0 + z1) / 2 : u));
    }
    for (const e of [0, 1]) K.add(yardMat, boxG(along ? w : 0.3, 0.16, along ? 0.3 : d), M(along ? (x0 + x1) / 2 : (e ? x1 : x0), 0.08, along ? (e ? z1 : z0) : (z0 + z1) / 2));
  }
  for (const [x, z] of [[240, 46], [370, 46], [430, 46], [240, -83.5], [370, -83.5], [430, -83.5], [240, -162], [430, -162]]) for (let k = -2; k <= 2; k++) {   // crosswalks
    K.add(lineW, new THREE.PlaneGeometry(0.6, 4).rotateX(-Math.PI / 2), M(x + 8.5, 0.045, z + k * 1.2 - 0)); K.add(lineW, new THREE.PlaneGeometry(4, 0.6).rotateX(-Math.PI / 2), M(x + k * 1.2, 0.045, z + 9));
  }
  CITY.add(K.build({ cast: false }));
  // street trees on both sidewalks, lamp posts between
  const st = [], lamps = [];
  for (const [x0, z0, x1, z1] of STREETS) {
    const along = x1 - x0 > z1 - z0;
    for (let s = 8; s < (along ? x1 - x0 : z1 - z0) - 4; s += 11) for (const e of [-3.2, 3.2]) {
      const x = along ? x0 + s : (e < 0 ? x0 + e : x1 + e), z = along ? (e < 0 ? z0 + e : z1 + e) : z0 + s;
      if (!clear(x, z, 1.5) || STREETS.some(([a, b, c, d]) => x > a - 1 && x < c + 1 && z > b - 1 && z < d + 1)) continue;
      ((s / 11) | 0) % 3 === 1 ? lamps.push([x, z, along ? (e < 0 ? 0 : Math.PI) : (e < 0 ? Math.PI / 2 : -Math.PI / 2)]) : st.push([x, z, 0.8 + 0.25 * ((s * 7) % 5) / 5, s, (s % 4) / 4]);
    }
  }
  grove('oak', st.filter((p, i) => i % 2 === 0), { v: 0 }); grove('oak', st.filter((p, i) => i % 2 === 1), { v: 1 });
  const LK = new Kit(), pole = std('#2d3a33', 0.45, 0.6), glow = new THREE.MeshBasicMaterial({ color: '#fffbee' });
  for (const [x, z, ry] of lamps) { LK.add(pole, new THREE.CylinderGeometry(0.09, 0.14, 7.5, 8), M(x, 3.75, z)); LK.add(pole, boxG(0.12, 0.12, 2.2), M(x, 7.4, z, 0, ry, 0).multiply(M(0, 0, 1.0))); LK.add(glow, boxG(0.5, 0.12, 0.3), M(x, 7.3, z, 0, ry, 0).multiply(M(0, 0, 2.0))); }
  CITY.add(LK.build());
}
// ---- traffic: sedans, pickups, a yellow school bus, and rigs on the interstate. Vertex colour 1 takes the paint.
const carMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.45, envMapIntensity: 1.2 });
function carGeo(kind) {
  const P = [], glass = [0.05, 0.06, 0.08], tyre = [0.06, 0.06, 0.07], chrome = [0.75, 0.75, 0.75], paint = [1, 1, 1];
  const wheel = (x, z, r0 = 0.34) => P.push(vcolor(new THREE.CylinderGeometry(r0, r0, 0.26, 12).rotateZ(Math.PI / 2).translate(x, r0, z), tyre));
  if (kind === 'sedan') {
    P.push(vcolor(new RoundedBoxGeometry(1.82, 0.7, 4.7, 2, 0.16).translate(0, 0.7, 0), paint));
    const cab = new RoundedBoxGeometry(1.6, 0.62, 2.5, 2, 0.14).translate(0, 1.3, -0.2); P.push(vcolor(cab, (p, i) => p.getY(i) > 1.08 && p.getY(i) < 1.55 ? glass : paint));
    for (const [x, z] of [[-0.82, 1.45], [0.82, 1.45], [-0.82, -1.45], [0.82, -1.45]]) wheel(x, z);
    P.push(vcolor(boxG(1.5, 0.12, 0.05).translate(0, 0.62, 2.36), chrome));
  } else if (kind === 'pickup') {
    P.push(vcolor(new RoundedBoxGeometry(2.0, 0.85, 5.6, 2, 0.14).translate(0, 0.85, 0), paint));
    P.push(vcolor(new RoundedBoxGeometry(1.9, 0.75, 1.9, 2, 0.12).translate(0, 1.6, 0.55), (p, i) => p.getY(i) > 1.35 && p.getY(i) < 1.9 ? glass : paint));
    P.push(vcolor(boxG(1.8, 0.3, 2.2).translate(0, 1.18, -1.55), tyre));
    for (const [x, z] of [[-0.9, 1.75], [0.9, 1.75], [-0.9, -1.75], [0.9, -1.75]]) wheel(x, z, 0.42);
    P.push(vcolor(boxG(1.9, 0.3, 0.1).translate(0, 0.72, 2.8), chrome));
  } else if (kind === 'bus') {
    P.push(vcolor(new RoundedBoxGeometry(2.5, 2.4, 11, 2, 0.2).translate(0, 1.7, 0), (p, i) => p.getY(i) > 1.85 && p.getY(i) < 2.55 && Math.abs(p.getX(i)) > 1.1 ? glass : Math.abs(p.getY(i) - 1.5) < 0.05 ? tyre : paint));
    P.push(vcolor(new RoundedBoxGeometry(2.4, 1.2, 1.8, 2, 0.15).translate(0, 1.1, 6.2), paint));
    for (const [x, z] of [[-1.1, 5.4], [1.1, 5.4], [-1.1, -3.5], [1.1, -3.5]]) wheel(x, z, 0.5);
  } else {     // rig: a cab-over-nose tractor and a 53 ft white trailer
    P.push(vcolor(boxG(2.5, 3.0, 2.4).translate(0, 2.0, 7.4), paint)); P.push(vcolor(boxG(2.5, 1.4, 1.8).translate(0, 1.2, 9.4), paint));
    P.push(vcolor(boxG(2.3, 0.8, 0.1).translate(0, 2.9, 8.62), glass));
    P.push(vcolor(boxG(2.6, 3.9, 16.1).translate(0, 2.55, -2.2), [0.93, 0.93, 0.92]));
    for (const z of [9.2, 6.8, 6.0, -8.0, -9.2]) for (const x of [-1.05, 1.05]) wheel(x, z, 0.5);
  }
  return mergeGeometries(P);
}
const CARG = { sedan: carGeo('sedan'), pickup: carGeo('pickup'), bus: carGeo('bus'), rig: carGeo('rig') };
const PAINT = ['#b3161b', '#f4f4f2', '#1b1d22', '#9aa3ad', '#1c3f8a', '#2f5a3a', '#d8d2c4', '#6a1a1a', '#c9c9c7', '#e0a21a'];
const TRAFFIC = [];     // { mesh, lanes: [{ a:[x,z], b:[x,z], n, speed, off }] }
function traffic(kind, lanes, seed = 1) {
  const n = lanes.reduce((s, l) => s + l.n, 0), m = new THREE.InstancedMesh(CARG[kind], carMat, n), r = rng(seed), c = new THREE.Color();
  for (let i = 0; i < n; i++) { c.set(kind === 'bus' ? '#f2b705' : kind === 'rig' ? PAINT[(i * 3) % 6] : PAINT[(r() * PAINT.length) | 0]); m.setColorAt(i, c); }
  m.castShadow = true; m.receiveShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; DRESS.add(m);
  const T = { m, lanes: lanes.map(l => ({ ...l, off: l.off ?? r() })) }; TRAFFIC.push(T); return T;
}
function setTraffic(t) {
  for (const T of TRAFFIC) { let k = 0;
    for (const L of T.lanes) { const dx = L.b[0] - L.a[0], dz = L.b[1] - L.a[1], len = Math.hypot(dx, dz), ry = Math.atan2(dx, dz);
      for (let j = 0; j < L.n; j++) { const u = ((j + L.off) / L.n + t * L.speed / len) % 1; T.m.setMatrixAt(k++, M(L.a[0] + dx * u, 0, L.a[1] + dz * u, 0, ry, 0)); } }
    T.m.instanceMatrix.needsUpdate = true; }
}
// city lanes (right-hand traffic: +x-bound on the near side of each x street)
const cityLanes = [];
for (const [x0, z0, x1, z1] of STREETS) {
  const along = x1 - x0 > z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  if (along) { cityLanes.push({ a: [x0, cz + 2.6], b: [x1, cz + 2.6], n: 5, speed: 9 }, { a: [x1, cz - 2.6], b: [x0, cz - 2.6], n: 5, speed: 9 }); }
  else { cityLanes.push({ a: [cx - 2.6, z1], b: [cx - 2.6, z0], n: 6, speed: 9 }, { a: [cx + 2.6, z0], b: [cx + 2.6, z1], n: 6, speed: 9 }); }
}
traffic('sedan', cityLanes, 7);
traffic('pickup', cityLanes.map(l => ({ ...l, n: 2, off: 0.37 })), 8);
traffic('bus', [{ a: [240, 110], b: [240, -190], n: 1, speed: 7, off: 0.6 }, { a: [-294, 130], b: [-294, -130], n: 1, speed: 6, off: 0.3 }], 9);
// the interstate (z 320, four lanes) and the town's main street
const HWZ = 320;
{
  const K = new Kit(), lineW = std('#f2f0ea', 0.7, 0, { polygonOffset: true, polygonOffsetFactor: -3 });
  K.add(asphaltMat, new THREE.PlaneGeometry(9000, 26).rotateX(-Math.PI / 2), M(0, 0.02, HWZ));
  K.add(lawnMat, new THREE.PlaneGeometry(9000, 6).rotateX(-Math.PI / 2), M(0, 0.04, HWZ));
  for (let x = -4500; x < 4500; x += 12) for (const z of [-7.8, 7.8]) K.add(lineW, new THREE.PlaneGeometry(3, 0.15).rotateX(-Math.PI / 2), M(x, 0.05, HWZ + z));
  for (const z of [-12.6, 12.6, -3.2, 3.2]) K.add(railMat, boxG(9000, 0.35, 0.12), M(0, 0.6, HWZ + z));   // guard rails
  DRESS.add(K.build({ cast: false }));
}
traffic('rig', [{ a: [-3000, HWZ + 5.6], b: [3000, HWZ + 5.6], n: 16, speed: 26 }, { a: [3000, HWZ - 5.6], b: [-3000, HWZ - 5.6], n: 16, speed: 26 }], 11);
traffic('sedan', [{ a: [-3000, HWZ + 10], b: [3000, HWZ + 10], n: 30, speed: 31 }, { a: [3000, HWZ - 10], b: [-3000, HWZ - 10], n: 30, speed: 31 },
  { a: [-294, 130], b: [-294, -130], n: 4, speed: 8 }, { a: [-286, -130], b: [-286, 130], n: 4, speed: 8 }], 12);
traffic('pickup', [{ a: [-3000, HWZ + 10], b: [3000, HWZ + 10], n: 12, speed: 29, off: 0.5 }, { a: [3000, HWZ - 10], b: [-3000, HWZ - 10], n: 12, speed: 29, off: 0.5 },
  { a: [-294, 130], b: [-294, -130], n: 2, speed: 7, off: 0.4 }], 13);
// parked in the town driveways
{ const m = new THREE.InstancedMesh(CARG.pickup, carMat, 9), c = new THREE.Color();
  for (let i = 0; i < 9; i++) { const side = i % 2 ? 1 : -1, z = -96 + i * 12 + 8; m.setMatrixAt(i, M(-290 + side * 11.5, 0, z, 0, i % 3 ? 0 : Math.PI, 0)); m.setColorAt(i, c.set(PAINT[(i * 7) % PAINT.length])); }
  m.castShadow = true; DRESS.add(m); }

// ---- the skyline: blocks east and north of the district. Brick lofts, limestone deco setbacks, glass towers, tanks.
const tankMat = std('#7a5a3c', 0.85), tankRoof = std('#3c3a38', 0.7, 0.3), hvacMat = std('#c9ccd0', 0.5, 0.5);
function building(K, x, z, w, d, h, style, r) {
  const F = FACADE[style];
  K.add(F, boxG(w, h, d), M(x, h / 2, z));
  if (style === 'lime' && h > 40) {       // setbacks and a crown
    K.add(F, boxG(w * 0.75, h * 0.22, d * 0.75), M(x, h + h * 0.11, z)); K.add(F, boxG(w * 0.45, h * 0.14, d * 0.45), M(x, h * 1.22 + h * 0.07, z));
    K.add(mullMat, new THREE.CylinderGeometry(0.15, 0.6, h * 0.2, 8), M(x, h * 1.36 + h * 0.1, z));
  } else if (style === 'glass' || style === 'glass2') {
    K.add(mullMat, boxG(w + 0.4, 1.2, d + 0.4), M(x, h + 0.6, z)); K.add(hvacMat, boxG(w * 0.5, 3, d * 0.4), M(x, h + 2.7, z));
  } else {
    K.add(FACADE.pre, boxG(w + 0.5, 0.9, d + 0.5), M(x, h + 0.45, z));          // parapet cap / cornice
    if (r() < 0.55) {                                                            // a wooden water tank on steel legs
      const tx = x + (r() - 0.5) * w * 0.5, tz = z + (r() - 0.5) * d * 0.5, tr = 2.2 + r();
      for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) K.add(railMat, boxG(0.18, 3.2, 0.18), M(tx + lx * tr * 0.6, h + 1.6, tz + lz * tr * 0.6));
      K.add(tankMat, new THREE.CylinderGeometry(tr, tr * 1.04, 4.2, 16), M(tx, h + 5.3, tz)); K.add(tankRoof, new THREE.ConeGeometry(tr * 1.08, 1.8, 16), M(tx, h + 8.3, tz));
    }
    for (let k = 0; k < 3; k++) K.add(hvacMat, boxG(1.5 + r() * 2, 1.2, 1.5 + r() * 2), M(x + (r() - 0.5) * w * 0.6, h + 0.6, z + (r() - 0.5) * d * 0.6));
  }
}
{
  const K = new Kit(), r = rng(2024), styles = ['brick', 'buff', 'lime', 'pre', 'glass', 'glass2', 'brick', 'lime'];
  // east of the district (x 490..900) and north of it (z -200..-650), a grid of 70 m blocks with 16 m streets
  for (let bx = 490; bx < 1000; bx += 72) for (let bz = -640; bz < 180; bz += 72) {
    const east = bx > 480;
    if (!east) continue;
    for (const [ox, oz] of [[-16, -16], [16, -16], [-16, 16], [16, 16]]) {
      if (r() < 0.12) continue;
      const st = styles[(r() * styles.length) | 0], far = Math.hypot(bx - 350, bz + 40);
      const h = st.startsWith('glass') ? 60 + r() * 110 : st === 'lime' ? 30 + r() * 90 : 14 + r() * 36;
      building(K, bx + ox, bz + oz, 24 + r() * 6, 24 + r() * 6, h * (far < 300 ? 0.8 : 1), st, r);
    }
  }
  for (let bx = 200; bx < 490; bx += 72) for (let bz = -640; bz < -210; bz += 72) for (const [ox, oz] of [[-16, -16], [16, -16], [-16, 16], [16, 16]]) {
    if (r() < 0.15) continue; const st = styles[(r() * styles.length) | 0];
    building(K, bx + ox, bz + oz, 24 + r() * 6, 24 + r() * 6, st.startsWith('glass') ? 70 + r() * 120 : st === 'lime' ? 40 + r() * 80 : 16 + r() * 40, st, r);
  }
  const g = K.build({ cast: false }); DRESS.add(g);
  // the grid's street trees
  const t = []; for (let bx = 490; bx < 1000; bx += 72) for (let bz = -640; bz < 180; bz += 72) for (let k = 0; k < 6; k++) t.push([bx - 34 + k * 12, bz + 34, 0.9, k, 0.3]);
  grove('oakLo', t, { cast: false });
}
// ---- the plaza: square planters with oaks, lamp standards, and the approach lined with US flags and red banners
const FLAGS = [];
const flagMat = (img) => { const m = new THREE.MeshStandardMaterial({ map: img, side: THREE.DoubleSide, roughness: 0.8, envMapIntensity: 0.4 });
  m.userData.T = { value: 0 };
  m.onBeforeCompile = sh => { sh.uniforms.uT = m.userData.T;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uT;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float fx = uv.x; float ph = fx * 7.0 - uT * 6.5 + position.y * 0.6;
        transformed.z += sin(ph) * 0.22 * fx + sin(ph * 2.3 + 1.0) * 0.06 * fx; transformed.y -= fx * fx * 0.12;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        { float ph = uv.x * 7.0 - uT * 6.5 + position.y * 0.6; objectNormal = normalize(vec3(-cos(ph) * 0.22 * 7.0 / 3.6 * uv.x, 0.0, 1.0)); }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= 0.86 + 0.14 * sin(vMapUv.x * 7.0 * 3.0 + 1.0);'); };
  m.customProgramCacheKey = () => 'flag'; FLAGS.push(m); return m; };
const usFlagTex = (() => { const [c, g] = cv(760, 400); for (let k = 0; k < 13; k++) { g.fillStyle = k % 2 ? '#f5f3ee' : '#b22234'; g.fillRect(0, k * 400 / 13, 760, 400 / 13 + 1); }
  g.fillStyle = '#233a6e'; g.fillRect(0, 0, 304, 400 * 7 / 13); g.fillStyle = '#f5f3ee';
  for (let row = 0; row < 9; row++) for (let col = 0; col < (row % 2 ? 5 : 6); col++) { const x = 25 + col * 50 + (row % 2 ? 25 : 0), y = 20 + row * 21.5; g.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? 3.6 : 9; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.fill(); }
  return tex(c, { rep: false }); })();
const redFlagTex = (() => { const [c, g] = cv(760, 400); g.fillStyle = '#c3161c'; g.fillRect(0, 0, 760, 400); g.drawImage(logoImg, 70, 60, 280, 280); return tex(c, { rep: false }); })();
const US = flagMat(usFlagTex), REDF = flagMat(redFlagTex);
{
  const K = new Kit(), pole = std('#dfe3e6', 0.25, 0.9, { envMapIntensity: 1.2 }), gold = std('#d9b24a', 0.3, 0.9), planter = ageMat({ surf: 1, map: CON.map, bump: CON.bump, rep: 2 });
  const fg = new THREE.PlaneGeometry(3.6, 1.9, 14, 4).translate(1.8, 0, 0);
  const pts = [];
  for (let z = 20; z <= 140; z += 20) for (const x of [-48, 48]) {
    K.add(pole, new THREE.CylinderGeometry(0.07, 0.12, 12, 10), M(x, 6, z)); K.add(gold, new THREE.SphereGeometry(0.18, 10, 8), M(x, 12.1, z));
    const f = new THREE.Mesh(fg, ((z / 20) + (x > 0 ? 1 : 0)) % 2 ? US : REDF); f.position.set(x + 0.08, 10.9, z); f.rotation.y = x > 0 ? Math.PI * 0.95 : 0.05; f.castShadow = true; DRESS.add(f);
  }
  for (const x of [-100, -80, 80, 100]) for (let z = -10; z <= 140; z += 16) { K.add(planter, boxG(5, 0.8, 5), M(x, 0.4, z)); pts.push([x, z, 1.05, z, 0.5]); }
  for (const x of [-90, 90]) { K.add(lawnMat, new THREE.PlaneGeometry(52, 150).rotateX(-Math.PI / 2), M(x, 0.03, 66)); K.add(planter, boxG(53, 0.35, 0.5), M(x, 0.17, -9.2)); K.add(planter, boxG(53, 0.35, 0.5), M(x, 0.17, 141.2)); K.add(planter, boxG(0.5, 0.35, 150), M(x - 26.2, 0.17, 66)); K.add(planter, boxG(0.5, 0.35, 150), M(x + 26.2, 0.17, 66)); }
  for (const x of [-22, 22]) for (let z = 16; z <= 136; z += 24) { K.add(pole, new THREE.CylinderGeometry(0.1, 0.16, 9, 10), M(x, 4.5, z)); K.add(new THREE.MeshBasicMaterial({ color: '#fffaf0' }), new THREE.SphereGeometry(0.45, 12, 10), M(x, 9.2, z)); }
  DRESS.add(K.build());
  grove('oak', pts, { v: 1 });
}
// the two red banners on the fortress face, either side of the mark, hanging from the top parapet
const bannerMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.85, envMapIntensity: 0.4 });
{
  const [c, g] = cv(256, 1024); g.fillStyle = '#c8141b'; g.fillRect(0, 0, 256, 1024);
  g.fillStyle = PAL.yellow; g.fillRect(14, 0, 10, 1024); g.fillRect(232, 0, 10, 1024);
  for (let k = 0; k < 4; k++) { g.fillStyle = '#f4efe4'; g.fillRect(56, 640 + k * 70, 144, 30); }
  g.drawImage(tinted(logoImg, '#f4efe4'), 18, 200, 220, 220);
  for (let x = 0; x < 256; x++) { const v = Math.sin(x / 256 * Math.PI * 6) * 0.1; g.fillStyle = v > 0 ? `rgba(255,255,255,${v * 0.6})` : `rgba(0,0,0,${-v})`; g.fillRect(x, 0, 1, 1024); }
  bannerMat.map = tex(c, { rep: false });
  const bg = new THREE.PlaneGeometry(9, 32, 12, 1); const p = bg.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) / 9 * Math.PI * 6) * 0.18);
  bg.computeVertexNormals();
  for (const x of [-27, 27]) { const b = new THREE.Mesh(bg, bannerMat); b.position.set(x, 47.5, -34.0); b.castShadow = true; b.receiveShadow = true; F.add(b);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 10.4, 8).rotateZ(Math.PI / 2), steelMat); rod.position.set(x, 63.7, -33.9); F.add(rod); }
}
// ---- the town: sidewalks, picket fences, shade trees, a white church, the water tower with the town's name
{
  const K = new Kit(), fence = std('#f7f5ef', 0.6), r = rng(333), t = [];
  for (const x of [-279.5, -300.5]) K.add(walkMat, boxG(3, 0.14, 260), M(x, 0.07, 0));
  for (let i = 0; i < 18; i++) {
    const side = i % 2 ? 1 : -1, z = -96 + Math.floor(i / 2) * 22, xf = -290 + side * 9.2;
    for (let k = -10; k <= 10; k += 0.5) if (Math.abs(k) > 1.3) K.add(fence, boxG(0.08, 0.9, 0.09), M(xf, 0.45, z + k));
    K.add(fence, boxG(0.05, 0.08, 20), M(xf, 0.75, z)); K.add(fence, boxG(0.05, 0.08, 20), M(xf, 0.35, z));
    t.push([-290 + side * (26 + r() * 6), z + 9 + r() * 4, 1.1 + r() * 0.4, r() * 6, r()]); if (r() < 0.6) t.push([-290 + side * 12, z - 9, 0.8 + r() * 0.3, r() * 6, r()]);
  }
  // church at the head of the street; water tower behind
  const white = ageMat({ surf: 5, map: null, bump: null, wall: '#f6f4ee', rough: 0.8 });
  K.add(white, boxG(12, 9, 20), M(-290, 4.5, -130)); K.add(white, boxG(4.4, 16, 4.4), M(-290, 8, -119));
  const spire = new THREE.ConeGeometry(3.2, 11, 4).rotateY(Math.PI / 4); K.add(ROOFS[3], spire, M(-290, 21.5, -119));
  const gab = new THREE.Shape([new THREE.Vector2(-6.6, 0), new THREE.Vector2(6.6, 0), new THREE.Vector2(0, 5)]);
  K.add(ROOFS[3], new THREE.ExtrudeGeometry(gab, { depth: 21, bevelEnabled: false }), M(-290, 9, -140.5));
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) K.add(railMat, boxG(0.35, 26, 0.35), M(-330 + lx * 3, 13, -60 + lz * 3));
  K.add(ageMat({ map: STEELMAP, bump: null, color: '#dfe6ec', rough: 0.4, metal: 0.7, rust: true, env: 0.9, cracks: false }), new THREE.SphereGeometry(6, 24, 16), M(-330, 30, -60, 0, 0, 0, 1, 0.8, 1));
  TOWN.add(K.build());
  grove('oak', t.filter((p, i) => i % 2), { v: 0 }); grove('oak', t.filter((p, i) => !(i % 2)), { v: 1 });
}
// ---- the plains: farmsteads (red barn with a gambrel roof, white house, silos, a spruce shelter belt), poplar
// windbreaks on the section lines, cottonwoods in the district's green belt, grain elevators on the rail
{
  const K = new Kit(), r = rng(1900), barn = ageMat({ surf: 5, map: null, bump: null, wall: '#a8281e', rough: 0.85 }), whiteS = ageMat({ surf: 5, map: null, bump: null, wall: '#f4f1ea', rough: 0.8 });
  const silo = std('#c9ccd0', 0.35, 0.7, { envMapIntensity: 1.0 }), siloBlue = std('#2c4f86', 0.35, 0.5), dome = std('#dfe3e6', 0.3, 0.8), belt = [], wind = [], grove2 = [];
  const elev = ageMat({ surf: 1, map: CON2.map, bump: CON2.bump, rep: 2 });
  for (let i = 0; i < 90; i++) {
    const a = r() * Math.PI * 2, d = 1150 + r() * r() * 5200, x = Math.cos(a) * d + 40, z = Math.sin(a) * d - 80;
    if (Math.abs(x - 150) < 60 || Math.abs(z - HWZ) < 40) continue;
    const ry = ((r() * 4) | 0) * Math.PI / 2, rot = (px, pz) => [x + px * Math.cos(ry) + pz * Math.sin(ry), z - px * Math.sin(ry) + pz * Math.cos(ry)];
    const gam = new THREE.Shape([[-7, 0], [7, 0], [7, 4], [4.5, 8], [0, 9.8], [-4.5, 8], [-7, 4]].map(p => new THREE.Vector2(...p)));
    let [bx, bz] = rot(0, 0); K.add(barn, boxG(14, 5, 22), M(bx, 2.5, bz, 0, ry, 0)); K.add(ROOFS[3], new THREE.ExtrudeGeometry(gam, { depth: 23, bevelEnabled: false }).translate(0, 0, -11.5), M(bx, 1.6, bz, 0, ry, 0));
    [bx, bz] = rot(22, 6); K.add(whiteS, boxG(9, 6, 11), M(bx, 3, bz, 0, ry, 0)); K.add(ROOFS[(i % 3) + 1], new THREE.CylinderGeometry(0.1, 7.6, 3.4, 4).rotateY(Math.PI / 4).scale(1, 1, 1.25), M(bx, 7.7, bz, 0, ry, 0));
    for (let k = 0; k < 1 + (i % 3); k++) { [bx, bz] = rot(-12 - k * 7.5, -8); const hs = 16 + r() * 10, blue = r() < 0.4;
      K.add(blue ? siloBlue : silo, new THREE.CylinderGeometry(3.2, 3.2, hs, 16), M(bx, hs / 2, bz)); K.add(dome, new THREE.SphereGeometry(3.25, 16, 8, 0, 6.3, 0, 1.4), M(bx, hs, bz)); }
    for (let k = 0; k < 9; k++) { [bx, bz] = rot(-24 + k * 6, -24); belt.push([bx, bz, 1 + r() * 0.3, r() * 6, r()]); [bx, bz] = rot(-30, -24 + k * 6); belt.push([bx, bz, 1 + r() * 0.3, r() * 6, r()]); }
  }
  // poplar windbreaks along section lines within 3 km (every 800 m, broken)
  for (let L = -3200; L <= 3200; L += 800) for (let s = -3200; s < 3200; s += 9) {
    const x1 = L + 40, z1 = s - 80; if (Math.hypot(x1 - 40, z1 + 80) > 1100 && ((s / 400) | 0) % 3 !== 1 && Math.abs(z1 - HWZ) > 30) wind.push([x1 + 14, z1, 1.1 + r() * 0.4, r() * 6, r()]);
    const x2 = s + 40, z2 = L - 80; if (Math.hypot(x2 - 40, z2 + 80) > 1100 && ((s / 400) | 0) % 3 !== 0 && Math.abs(x2 - 150) > 30) wind.push([x2, z2 + 14, 1.1 + r() * 0.4, r() * 6, r()]);
  }
  // cottonwood clumps in the green belt, clear of the district
  for (let i = 0; i < 260; i++) { const a = r() * Math.PI * 2, d = 520 + r() * 560, x = Math.cos(a) * d + 40, z = Math.sin(a) * d - 80;
    if (!clear(x, z, 30) || Math.abs(z - HWZ) < 30 || (x > 480 && x < 1000 && z > -680 && z < 200)) continue; for (let k = 0; k < 4; k++) grove2.push([x + (r() - 0.5) * 30, z + (r() - 0.5) * 30, 1.3 + r() * 0.6, r() * 6, r()]); }
  // grain elevators by the rail, north of the district
  for (let k = 0; k < 8; k++) K.add(elev, new THREE.CylinderGeometry(5, 5, 42, 20), M(170 + (k % 4) * 10.2, 21, -760 - Math.floor(k / 4) * 10.2));
  K.add(elev, boxG(10, 60, 14), M(212, 30, -765)); K.add(elev, boxG(6, 8, 6), M(212, 64, -765));
  DRESS.add(K.build({ cast: false }));
  grove('spruce', belt, { cast: false }); grove('poplarLo', wind, { cast: false }); grove('oakLo', grove2, { cast: false });
}
// ---- the mill yard: stacks with bands, and steam off the furnace and the stoves (billboards, drifting)
const STEAM = [];
{
  const [c, g] = cv(128, 128); const r = rng(55);
  for (let i = 0; i < 40; i++) { const x = 64 + (r() - 0.5) * 60, y = 64 + (r() - 0.5) * 60, rr = 14 + r() * 26, G = g.createRadialGradient(x, y, 0, x, y, rr); G.addColorStop(0, 'rgba(255,255,255,0.35)'); G.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = G; g.fillRect(0, 0, 128, 128); }
  const sm = new THREE.SpriteMaterial({ map: tex(c, { rep: false }), color: '#f6f7f8', transparent: true, depthWrite: false, fog: true });
  for (const [x, y, z, n] of [[-200, 66, -312, 9], [-180, 64, -306, 7], [-60, 48, -262, 6]]) for (let k = 0; k < n; k++) { const s = new THREE.Sprite(sm); s.userData = { x, y, z, k, n }; DRESS.add(s); STEAM.push(s); }
  const K = new Kit(), band = std('#b83a2c', 0.6), stackW = std('#eef0f0', 0.6);
  for (const [x, z, h] of [[-180, -306, 64], [-60, -262, 48]]) { K.add(stackW, new THREE.CylinderGeometry(2.1, 2.6, h, 18), M(x, h / 2, z)); for (let y = h - 10; y < h; y += 5) K.add(band, new THREE.CylinderGeometry(2.2, 2.2, 2.4, 18), M(x, y, z)); }
  MILL.add(K.build());
}
function setSteam(t) { for (const s of STEAM) { const { x, y, z, k, n } = s.userData, u = ((k / n) + t * 0.12) % 1; s.position.set(x + u * 26, y + u * 30, z + u * 8); s.scale.setScalar(8 + u * 34); s.material.opacity = 0.9; } }
function setDress(t) { setTraffic(t); setSteam(t); for (const m of FLAGS) m.userData.T.value = t; }

// ---------------------------------------------------------------- the type: Cinzel 900, V-cut into white concrete, lit at noon
const WORDCACHE = new Map();
function bakeWord(text) {
  if (WORDCACHE.has(text)) return WORDCACHE.get(text);
  const big = BIG.has(text), hot = HOT.has(text);
  const capH = big ? 205 : hot ? 188 : 168;
  const w = shape(cinzel, text, { capH, x: 0, y: 0, align: 'left', valign: 'baseline', tracking: 0.035, maxW: 990 });
  const cap = capH * (w.size / (capH * cinzel.unitsPerEm / ((cinzel.tables.os2 && cinzel.tables.os2.sCapHeight) || cinzel.unitsPerEm * 0.7)));
  const pad = 40, sx = 10, sy = 14;
  const bx1 = w.bbox.x1 - pad, by1 = w.bbox.y1 - pad, cw = Math.ceil(w.bbox.x2 - w.bbox.x1 + 2 * pad + sx), ch = Math.ceil(w.bbox.y2 - w.bbox.y1 + 2 * pad + sy);
  const [c, g] = cv(cw, ch);
  const [cs, gs] = cv(cw, ch);
  g.translate(-bx1, -by1); gs.translate(-bx1, -by1);
  const cut = Math.max(5, cap * 0.075);
  for (const G of w.glyphs) {       // cast shadow (hard noon)
    gs.save(); gs.translate(G.ox + sx, G.oy + sy); gs.fillStyle = 'rgba(9,18,52,0.6)'; gs.fill(G.path); gs.restore();
  }
  for (const G of w.glyphs) {
    g.save(); g.translate(G.ox, G.oy);
    const gr = g.createLinearGradient(0, G.bb.y1, 0, G.bb.y2); gr.addColorStop(0, '#fbfaf6'); gr.addColorStop(1, '#ebe7de');
    g.fillStyle = gr; g.fill(G.path);
    innerShadow(g, G, 'rgba(58,66,96,0.95)', cut, cut * 1.1, 1.2);       // the shadowed facet of the V
    innerShadow(g, G, 'rgba(255,255,255,0.9)', -cut * 0.35, -cut * 0.35, 1.0);
    g.lineWidth = 1.6; g.strokeStyle = 'rgba(40,48,78,0.55)'; g.stroke(G.path);
    g.restore();
  }
  const o = { c, s: cs, x: bx1, y: by1, w: w.bbox.x2 - w.bbox.x1, x1: w.bbox.x1, y1: w.bbox.y1, y2: w.bbox.y2, cap, hot, big, word: w };
  WORDCACHE.set(text, o); return o;
}
const TEXT_Y = 520;
function drawWord(text, age, beat, yc = TEXT_Y, kick = 0) {
  const b = bakeWord(text);
  const fr = age * 30;                                  // frames since the hit
  const u = clamp((fr + 1) / 3);                              // the chisel runs along the line in 3 frames
  const ox = W / 2 - b.w / 2 - b.x1, oy = yc + b.cap / 2;
  const sc = (b.hot || b.big ? 1 + 0.06 * Math.exp(-fr * 0.6) : 1) * (1 + 0.012 * kick);
  ctx.save(); ctx.translate(W / 2, yc); ctx.scale(sc, sc); ctx.translate(-W / 2, -yc);
  const x0 = ox + b.x, clipW = b.c.width * ease.outCubic(u);
  ctx.beginPath(); ctx.rect(x0, oy + b.y - 10, clipW, b.c.height + 20); ctx.clip();
  ctx.drawImage(b.s, x0, oy + b.y); ctx.drawImage(b.c, x0, oy + b.y);
  ctx.restore();
  // chips off the chisel: stateless ballistic flakes, 12 frames of follow-through
  if (fr < 14) {
    const r = rng((text.length * 131 + Math.round(beat * 4)) | 0);
    for (let i = 0; i < 26; i++) {
      const t0 = r() * 3, a = (fr - t0) / 30; if (a < 0) { r(); r(); r(); continue; }
      const px = x0 + b.c.width * (t0 / 3), py = oy + b.y1 + r() * (b.y2 - b.y1);
      const vx = (r() - 0.3) * 520, vy = -200 - r() * 520, s = 2 + r() * 5;
      const x = px + vx * a, y = py + vy * a + 0.5 * 2600 * a * a;
      ctx.globalAlpha = clamp(1 - a * 2.2); ctx.fillStyle = i % 3 ? '#f1eee6' : '#6a7390'; ctx.fillRect(x, y, s, s * 0.7); ctx.globalAlpha = 1;
    }
  }
}

// ---------------------------------------------------------------- shot helpers
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const lerpV = (a, b, u) => a.clone().lerp(b, u);
// hyperlapse: the camera moves in steps, one per beat, each step eased over 3 frames
const hyper = (a, n = 1) => { const k = Math.floor(a * n); const f = (a * n - k) / n * B.spb * 30 * n; return (k + ease.outCubic(clamp(f / 3))) / n; };
const at = (list, b) => { let r = list[0]; for (const x of list) if (b >= x[0]) r = x; return r; };
function resetWorld() {
  for (const m of MATS) { const U = m.userData.U; U.uAge.value = 0; U.uWave.value.w = -1; U.uC.value = 0; U.uBuild.value = 1e4; U.uFresh.value = 0; }
  F.userData.mast.position.y = 0; F.userData.mast.scale.y = 1;
  streakMat.uniforms.uN.value = 0; setPanes(1, PANES, paneMesh); setPanes(1, HOUSEWIN, hwMesh, 1.4, 1.9);
  weedMesh.count = 0; MARK.mesh.visible = true; markMat.userData.U.uC.value = 0;
  CHIEF.visible = false; CREW.visible = true; ROOM.visible = false; LIFTS.forEach(l => { l.visible = true; });
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
function setPanes(g, list, mesh, pw = 1.42, ph = 3.1, win = 0.09) {
  for (let i = 0; i < list.length; i++) {
    const P = list[i], u = clamp((g - P.f) / win);
    if (u <= 0) { _m.makeScale(0, 0, 0); mesh.setMatrixAt(i, _m); continue; }
    const q = 1 - u, ry = Math.atan2(P.n[0], P.n[1]);
    _p.set(P.p[0] + P.n[0] * (0.05 + q * q * 5), P.p[1] - q * q * 7 * (0.5 + P.r), P.p[2] + P.n[1] * (0.05 + q * q * 5));
    _e.set(q * q * (P.r - 0.5) * 3, ry + q * q * 1.2 * (P.r - 0.5), q * q * 2 * (P.r - 0.5), 'YXZ'); _q.setFromEuler(_e);
    _s.set(1, 1, 1); _m.compose(_p, _q, _s); mesh.setMatrixAt(i, _m);
    if (mesh.instanceColor) { const k = (u > 0.8 && u < 1 ? 1.8 : 1) * (0.8 + 0.35 * P.r); mesh.instanceColor.setXYZ(i, k * (0.92 + 0.1 * P.r), k, k * (1.04 - 0.08 * P.r)); }
  }
  mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}
function setWeeds(g) {
  let n = 0;
  for (const w of WEEDS) { const h = w.h * clamp((g - w.f * 0.5) * 2); if (h <= 0.005) continue; _e.set(w.a, w.b * 3, w.a * 0.5); _q.setFromEuler(_e); _p.set(w.x, 0, w.z); _s.set(1, h, 1); _m.compose(_p, _q, _s); weedMesh.setMatrixAt(n++, _m); }
  weedMesh.count = n; weedMesh.instanceMatrix.needsUpdate = true;
}
function place(obj, x, y, z, ry = 0) { obj.position.set(x, y, z); obj.rotation.y = ry; obj.visible = true; }

// ---------------------------------------------------------------- the shot list (beats; §2.12 re-keyed to the final script)
// each: [beat, fn(a = beats into shot, beat)] -> { p, l, fov, sun: [az, el], span, tgt }
const SUN0 = [1.12, 0.8];
const SIG = (a, beat) => {       // the signature: fortress at noon, mark whole, crew at the foot, chief at the left third
  place(CHIEF, -4.9, 0, 50.2, 0.55);
  const push = a * 0.55;
  return { p: V(-3.4, 1.55, 64 - push), l: V(1.5, 50, -35), fov: 72, sun: [SUN0[0] + beat * 0.004, SUN0[1]], span: 130, tgt: V(0, 20, -30) };
};
const SHOTS = [
  [0, (a, beat) => { const r = SIG(a + 10, beat); return r; }],                                // frame-0 flash of the signature (9 frames)
  [0.75, (a) => {                                                                              // a collapsed block flies back up into its facade
    const R = RUINS[0]; R.m.userData.U.uC.value = clamp(1 - ease.inOutCubic(a / 3.4)); R.m.userData.U.uAge.value = clamp(1 - a / 3.3);
    plazaMat.userData.U.uAge.value = 0.8 - a * 0.2;
    return { p: V(300 - 10 + a * 1.5, 2.2, 62 - a * 2.2), l: V(300, 19, 0), fov: 66, sun: SUN0, span: 70, tgt: V(300, 10, 0) };
  }],
  [2, (a) => {                                                                                 // low, close: chunks slot home, cracks close
    const R = RUINS[0]; R.m.userData.U.uC.value = clamp(1 - ease.inOutCubic((a + 1.25) / 3.4)); R.m.userData.U.uAge.value = clamp(0.62 - a * 0.31);
    return { p: V(312 + a * 1.2, 1.2, 24), l: V(300 + a * 0.8, 26, 10), fov: 70, sun: SUN0, span: 60, tgt: V(300, 10, 0) };
  }],
  [4, (a) => {                                                                                 // glass re-forms pane by pane (slide)
    setPanes(clamp(a / 1.9) * 1.1, PANES, paneMesh); const T = TOWERS[0];
    return { p: V(T.x - 34 + a * 6, 14 + a * 3, T.z + 40), l: V(T.x - 4 + a * 3, 52 + a * 6, T.z), fov: 62, sun: SUN0, span: 110, tgt: V(T.x, 50, T.z) };
  }],
  [6, (a) => {                                                                                 // WORKS.: the crew chief, low, at hero scale
    place(CHIEF, 30, 0, 44, Math.PI + 0.9); const s = a;
    return { p: V(31.6 - s * 0.2, 0.45, 45.4), l: V(29.4, 2.3, 42.6), fov: 62, sun: [SUN0[0] + 0.3, SUN0[1]], span: 20, tgt: V(30, 1, 44) };
  }],
  [7, () => ({ black: true })],                                                                // one beat of black (§4.3: silence used once)
  [8, (a) => {                                                                                 // the flash to noon: the working class streams in
    streakMat.uniforms.uN.value = 0.55;
    return { p: V(34 - a * 2, 3.2, 90), l: V(0, 24, -30), fov: 70, sun: SUN0, span: 130, tgt: V(0, 20, -20) };
  }],
  [10, (a) => {                                                                                // MASTER: the chief at hero scale, fortress behind
    place(CHIEF, 4, 0, 20, Math.PI - 0.55); streakMat.uniforms.uN.value = 0.35;
    return { p: V(5.0 + a * 0.12, 0.42, 23.8), l: V(3.2, 2.7, 17.6), fov: 58, sun: SUN0, span: 60, tgt: V(0, 10, 0) };
  }],
  [12, (a) => {                                                                                // OF STEEL.: rust peels back to bright steel (macro slide)
    colMat.userData.U.uAge.value = clamp(1 - ease.inOutCubic(a / 0.95));
    return { p: V(COL.x + 1.1 - a * 0.25, 3.3, COL.z + 1.7), l: V(COL.x - 0.05, 3.3, COL.z + 0.3), fov: 54, sun: SUN0, span: 12, tgt: V(COL.x, 3, COL.z) };
  }],
  [13, (a) => {                                                                                // OF AI.: light racing up re-formed glass
    setPanes(1, PANES, paneMesh); const T = TOWERS[2];
    return { p: V(T.x - 20, 6, T.z + 34), l: V(T.x - 6, 70 + a * 60, T.z + 6), fov: 70, sun: [SUN0[0] + a * 0.6, SUN0[1]], span: 150, tgt: V(T.x, 70, T.z) };
  }],
  [14, (a) => {                                                                                // OF TIME.: AMERICAN TIME runs backward
    return { p: V(CLK.x + 5 - a * 0.8, CLK.y - 8 + a * 1.2, CLK.z + 24 - a * 3), l: V(CLK.x, CLK.y, CLK.z), fov: 56, sun: SUN0, span: 30, tgt: V(CLK.x, CLK.y, CLK.z), clock: a };
  }],
  [16, (a) => {                                                                                // THE HUMAN RACE: a city block running young (drop 1)
    RUINS.forEach((R, i) => { R.m.userData.U.uC.value = clamp(1 - hyper(a, 1) / 3.6 - (i === 0 ? 0 : 0) + i * 0.06); R.m.userData.U.uAge.value = clamp(1 - a / 3.6); });
    setPanes(hyper(a, 1) / 3.8, PANES, paneMesh);
    streakMat.uniforms.uN.value = 0.3;
    return { p: V(250 + hyper(a) * 8, 70 - hyper(a) * 6, 150 - hyper(a) * 10), l: V(335, 18, -30), fov: 66, sun: SUN0, span: 170, tgt: V(330, 20, -30) };
  }],
  [18, (a) => {                                                                                // GROWS YOUNG.: the block completes, gleaming
    RUINS.forEach((R, i) => { R.m.userData.U.uC.value = clamp(0.44 - hyper(a, 1) / 3.2 + i * 0.06); R.m.userData.U.uAge.value = clamp(0.45 - a / 3.4); });
    setPanes(0.55 + a / 3.6, PANES, paneMesh);
    return { p: V(318 - hyper(a) * 6, 1.6, 64), l: V(318, 34 + hyper(a) * 6, -10), fov: 74, sun: SUN0, span: 140, tgt: V(320, 20, -20) };
  }],
  [20, (a) => {                                                                                // BY OWNING: the fortress pours, level by level
    const hgt = 6 + hyper(a, 1) * 14; for (const m of [fMat, fMat2]) { m.userData.U.uBuild.value = hgt; m.userData.U.uFresh.value = 1; }
    MARK.mesh.visible = false; F.userData.mast.visible = false; streakMat.uniforms.uN.value = 0.8; CREW.visible = false;
    return { p: V(60 - hyper(a) * 4, 4, 70), l: V(0, 16, -40), fov: 70, sun: SUN0, span: 140, tgt: V(0, 20, -40), mastHide: true };
  }],
  [22, (a) => {                                                                                // AND EXPANDING: the tiers climb and spread
    const hgt = 34 + hyper(a, 1) * 28; for (const m of [fMat, fMat2]) { m.userData.U.uBuild.value = hgt; m.userData.U.uFresh.value = 1; }
    MARK.mesh.visible = false; streakMat.uniforms.uN.value = 0.8; CREW.visible = false;
    return { p: V(-70 + hyper(a) * 8, 6, 60), l: V(0, 30, -50), fov: 72, sun: SUN0, span: 150, tgt: V(0, 30, -50), mastHide: true };
  }],
  [24, (a) => {                                                                                // PRODUCTION.: tops out; the mast telescopes (no crane)
    const e = ease.outCubic(clamp(a / 1.5)); MARK.mesh.visible = false;
    const hgt = 90 + e * 80; for (const m of [fMat, fMat2]) { m.userData.U.uBuild.value = hgt; m.userData.U.uFresh.value = 1 - e; }
    F.userData.mast.scale.y = 0.2 + 0.8 * e; F.userData.mast.position.y = 120 * (1 - (0.2 + 0.8 * e));
    return { p: V(14, 3, 78), l: V(0, 60 + e * 40, -50), fov: 74, sun: SUN0, span: 160, tgt: V(0, 70, -50) };
  }],
  [26, (a) => {                                                                                // THE MILLS.
    for (const m of [millSteel, cladMat, cladRed]) m.userData.U.uAge.value = clamp(1 - ease.inOutCubic(a / 0.95));
    const c = MILLC; return { p: V(c.x - 150 + a * 6, 4, c.z + 60), l: V(c.x - 60, 30, c.z - 10), fov: 70, sun: SUN0, span: 170, tgt: V(c.x - 20, 20, c.z) };
  }],
  [27, (a) => {                                                                                // THE TOWNS.
    for (const m of ROOFS) m.userData.U.uAge.value = clamp(1 - ease.inOutCubic(a / 0.95)); for (const s of sidings) s.userData.U.uAge.value = clamp(1 - a);
    setPanes(clamp(a / 0.9) + 0.05, HOUSEWIN, hwMesh, 1.4, 1.9, 0.15);
    return { p: V(-290 + 2, 2.4, 110), l: V(-290, 5, 0), fov: 64, sun: SUN0, span: 140, tgt: V(-290, 5, 0) };
  }],
  [28, (a) => {                                                                                // THE CITIES.
    setPanes(clamp(a / 0.9) * 1.1, PANES, paneMesh);
    return { p: V(330, 2, 90), l: V(380, 70, -60), fov: 74, sun: SUN0, span: 190, tgt: V(360, 50, -60) };
  }],
  [29, (a) => {                                                                                // GROW YOUNG.: the youth wave spreads from the mill across all three
    const R = 60 + hyper(a) * 230;
    for (const m of MATS) { const U = m.userData.U; if (m === markMat) continue; U.uAge.value = 1; U.uWave.value.set(MILLC.x, 0, MILLC.z, R); }
    setPanes(clamp(a / 3), PANES, paneMesh); setPanes(clamp(a / 3), HOUSEWIN, hwMesh, 1.4, 1.9, 0.15);
    return { p: V(40 + hyper(a) * 20, 260, 420), l: V(40, 10, -120), fov: 64, sun: SUN0, span: 520, tgt: V(40, 0, -120) };
  }],
  [32, (a) => {                                                                                // RISE. x4: hyperlapse steps up the face
    const k = Math.floor(a), f = hyper(a);
    streakMat.uniforms.uN.value = 0.9;
    const Y = [1.2, 22, 58, 104, 140];
    return { p: V(-18 + f * 3, lerp(Y[k], Y[k + 1], clamp(f - k)), 62 - f * 6), l: V(0, lerp(Y[k], Y[k + 1], clamp(f - k)) + 14, -40), fov: 70, sun: SUN0, span: 150, tgt: V(0, 60, -40) };
  }],
  [36, (a) => {                                                                                // A HARD DAY'S WORK: a day of shadows in two beats
    streakMat.uniforms.uN.value = 0.9; streakMat.uniforms.uLen.value = 8;
    LIFTS.forEach((l, i) => { const k = Math.floor(a * 4); l.position.set([-20, 11, 27][i] + Math.sin(k * 1.7 + i) * 8, 0, [8, 12, 3][i] + Math.cos(k * 1.3 + i) * 6); l.rotation.y = k * 0.9 + i; });
    return { p: V(46, 26, 96), l: V(-4, 2, -8), fov: 62, sun: [-1.9 + a * 1.9, 0.72 + Math.sin(a / 2 * Math.PI) * 0.35], span: 150, tgt: V(0, 10, -10) };
  }],
  [38, (a) => {                                                                                // CURE / DISEASES.: cracks close, weeds retract (macro)
    podMat.userData.U.uAge.value = clamp(1 - ease.inOutCubic(a / 1.9)); plazaMat.userData.U.uAge.value = clamp(1 - a / 1.9);
    setWeeds(1 - a / 1.7);
    return { p: V(31 - a * 0.6, 0.55, -15.6), l: V(30 - a * 0.6, 1.3, -20), fov: 60, sun: SUN0, span: 20, tgt: V(30, 2, -20) };
  }],
  [40, (a) => {                                                                                // REJUVENATION: the whole city runs young at noon
    const R = hyper(a) * 260;
    for (const m of MATS) { const U = m.userData.U; if (m === markMat) continue; U.uAge.value = 0.9; U.uWave.value.set(0, 0, -40, R); }
    RUINS.forEach((Rn, i) => { Rn.m.userData.U.uC.value = clamp(0.8 - hyper(a) / 2.4 - i * 0.05); });
    setPanes(clamp(a / 3.4), PANES, paneMesh);
    streakMat.uniforms.uN.value = 1;
    return { p: V(-160 + a * 22, 90, 260), l: V(90, 20, -60), fov: 66, sun: SUN0, span: 420, tgt: V(80, 0, -60) };
  }],
  [43, (a) => {
    for (const m of MATS) { const U = m.userData.U; if (m === markMat) continue; U.uAge.value = 0.9; U.uWave.value.set(0, 0, -40, 180 + a * 200); }
    streakMat.uniforms.uN.value = 1;
    return { p: V(120 - a * 20, 3, 130), l: V(20, 40, -40), fov: 74, sun: SUN0, span: 300, tgt: V(40, 20, -40) };
  }],
  [44, (a) => {                                                                                // THROUGH AMERICA.: the fortress on the plains, a river, rail
    return { p: V(430 - a * 20, 70 - a * 4, 600 - a * 30), l: V(-10, 50, -60), fov: 50, sun: SUN0, span: 700, tgt: V(0, 0, -200) };
  }],
  [46, (a) => {                                                                                // AMERICA.: low on the rail line, the fortress on the horizon of fields
    return { p: V(162, 2.4 + a * 0.3, 190 - a * 10), l: V(58, 26, -80), fov: 60, sun: SUN0, span: 400, tgt: V(80, 0, 60) };
  }],
  [48, (a) => {                                                                                // THE FOUNTAIN OF YOUTH: the red room inside the mill
    ROOM.visible = true;
    const e = B.env('snare', B.spb * (48 + a), 7), push = 2.6 * a + 1.6 * a * a;
    roomMat.uniforms.uLum.value = 0.75 + 0.5 * e; roomMat.uniforms.uHaze.value = 0.4 + 0.6 * e; hazeMat.uniforms.uA.value = 0.1 + 0.18 * e;
    return { p: V(-6000 + 2.2 - a * 0.4, 1.7, 13 - push), l: V(-6000, 5.8, -15), fov: 68, sun: SUN0, span: 30, tgt: V(-6000, 0, 0), room: true };
  }],
  [50, (a) => {                                                                                // A STEEL MILL.: the youth wave rings out of the furnace
    const R = 8 + ease.outCubic(clamp(a / 2)) * 180;
    for (const m of MATS) { const U = m.userData.U; if (m === markMat) continue; U.uAge.value = 1; U.uWave.value.set(MILLC.x - 50, 0, MILLC.z - 12, R); }
    const c = MILLC; return { p: V(c.x - 140 + a * 4, 3, c.z + 48 - a * 3), l: V(c.x - 58, 30, c.z - 14), fov: 72, sun: SUN0, span: 170, tgt: V(c.x - 40, 20, c.z) };
  }],
  [52, (a) => {                                                                                // UNRELENTING: the shattered mark flies up off the plaza (drop 2)
    markMat.userData.U.uC.value = clamp(1 - ease.inOutCubic(a / 3.9)); streakMat.uniforms.uN.value = 1; streakMat.uniforms.uLen.value = 6;
    return { p: V(9 - a * 2, 7 + a * 2.2, 50 - a * 3), l: V(0, 1 + a * 11, -6 - a * 7), fov: 72, sun: SUN0, span: 140, tgt: V(0, 20, -20) };
  }],
  [54, (a) => {
    markMat.userData.U.uC.value = clamp(1 - ease.inOutCubic((a + 2) / 3.9)); streakMat.uniforms.uN.value = 1;
    return { p: V(-8 + a, 18 + a * 4, 12), l: V(0, 44, -35), fov: 62, sun: SUN0, span: 90, tgt: V(0, 40, -35) };
  }],
  [56, (a, beat) => { streakMat.uniforms.uN.value = 0.4; return SIG(a, beat); }],               // MASTER / OF ALL THINGS.: the signature, held
];

// ---------------------------------------------------------------- render
const flashAt = (beat) => FLASHES.reduce((f, b) => f + (beat >= b && beat < b + 0.2 ? 1 - (beat - b) / 0.2 : 0), 0);
window.renderFrame = async (t) => {
  const beat = B.beat(t) + 1e-6, frame = Math.round(t * 30);   // epsilon: a hit at exactly t lands on its own frame
  if (beat >= CLOSER) { closer(ctx, (beat - CLOSER) * B.spb); finish.apply(ctx, frame, { grain: 0.05, vignette: 0.38 }); return; }
  const kick = B.env('kick', t, 12), imp = B.env('impact', t, 6);
  resetWorld();
  streakMat.uniforms.uT.value = t; streakMat.uniforms.uLen.value = 4.5;
  const [s0, fn] = at(SHOTS, beat);
  const S = fn(beat - s0, beat) || {};
  const gl = beat >= 52 ? B.env('shout', t, 9) : 0; markMat.emissive.setRGB(0.9 * gl, 0.9 * gl, 0.9 * gl);
  if (S.black) {
    ctx.fillStyle = '#020306'; ctx.fillRect(0, 0, W, H);
  } else {
    if (S.mastHide) F.userData.mast.visible = false; else F.userData.mast.visible = true;
    if (S.clock !== undefined) {           // backward, accelerating with the snare roll
      const back = S.clock * S.clock * 9 + S.clock * 3;
      CLK.sec.rotation.z = back * Math.PI * 2 * 3; CLK.min.rotation.z = back * Math.PI * 2 * 0.6 + 1.1; CLK.hour.rotation.z = back * Math.PI * 2 * 0.05 + 2.4;
    }
    // time-lapse sky: clouds race, shadows tick
    CLOUD.offset.set(t * 0.21, t * 0.05); cloudMat2.map.offset.set(t * 0.12, -t * 0.03); setDress(t);
    const [az, el] = S.sun || SUN0; setSun(az + t * 0.01, el, S.tgt || V(0, 0, 0), S.span || 150);
    const shake = 0.004 * kick + 0.012 * imp;
    camera.position.copy(S.p); camera.fov = (S.fov || 60) * (1 - 0.02 * imp); camera.updateProjectionMatrix();
    camera.lookAt(S.l); camera.rotateZ(Math.sin(t * 47) * shake); camera.rotateX(Math.cos(t * 39) * shake * 0.6);
    sky.position.copy(camera.position); streakMat.uniforms.uCam.value.copy(camera.position);
    renderer.render(scene, camera);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(renderer.domElement, 0, 0, W, H);
  }
  const w = at(WORDS, beat);
  if (w[1] && beat >= w[0]) drawWord(w[1], (beat - w[0]) * B.spb, beat, TEXT_Y, kick);
  const fl = flashAt(beat);
  if (fl > 0) { ctx.fillStyle = `rgba(255,255,255,${clamp(fl)})`; ctx.fillRect(0, 0, W, H); }
  finish.apply(ctx, frame, { grain: 0.045, vignette: 0.3 });
};
window.sceneReady = true;
