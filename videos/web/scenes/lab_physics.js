// LAB: PHYSICS. Deterministic simulations from lib/fx/physics.js, cut to the productive() track (beats from its hits.json; 130 BPM as of v2).
//   b0-8    FLUID      red + cream smoke (MacCormack + multigrid, curl-noise detail) wraps an obsidian ACP mark with a hot rim
//   b8-16   CLOTH      a giant banner in a storm; lightning on the impact; slashed on b14.5, the lower half drops
//   b16-24  RIGID      OWN THE FUTURE as cast enamel letters (2.5D: walls, bevels, specular) piling on a lit floor; rubber seal on b20
//   b24-36  SHATTER    CAPITAL, a stone obelisk with depth: fracture lines glow in (b24-28), blast + collapse on b28, dust + sparks
//   b36-44  FIRE       the rubble burns (flames from the rubble's own silhouette, fluid fire plume); strikes on the break
//   b44-60  CROWD      torch-bearers on a plain under a craning camera: the mark forms by b47 and holds, then THE WHOLE / PEOPLE
//   b60-70  BANNER     the banner again with embers; the ☭≡/acc closer on b64
// Every section runs on a Timeline (lib/fx/physics_timeline.js): its own sim clock + pre-roll, events scheduled
// by beat, sims freed once past, a 1.5 s/frame budget check, and window.SIM for web/simtest.mjs.
// ?hud=1 (or window.LAB_HUD = true before load) burns the debug labels in; they are off by default.
import { W, H, C, loadFonts, loadBeats, clamp, lerp, ease, line, rng, closer, Finish, BRAND, tinted } from '../lib/kit.js';
import { initPhysics, RigidWorld, Cloth, ClothView, Fluid, Flames, Crowd, bolt, drawBolt, drawBolts, crack, drawCrack, strike, maskPoints, rimFuel,
  drawSparks, drawPuffs, noise3, fbm3, sdfOf } from '../lib/fx/physics.js';
import { RigidView, CrowdView } from '../lib/fx/physics_view.js';
import { Timeline, sourceKey } from '../lib/fx/physics_timeline.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const HUD = new URLSearchParams(location.search).has('hud') || window.LAB_HUD === true;

const ctx = outCanvas2();
function outCanvas2() { const c = document.getElementById('out'); c.width = W; c.height = H; return c.getContext('2d'); }
await loadFonts();
await initPhysics();
const B = await loadBeats('lab_physics');
const SPB = B.spb, FPS = 30;
const bt = b => b * SPB;
const fin = new Finish(9);
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const TIMES = {};
// window.PROF = true -> every timed stage is flushed (1-px readback) so its GPU cost lands in its own bucket
const flush = k => { if (window.PROF || (window.FLUSH && window.FLUSH.includes(k))) ctx.getImageData(0, 0, 1, 1); };
const time = (k, fn) => { flush(k); const t0 = performance.now(); const r = fn(); if ((window.PROF || (window.FLUSH && window.FLUSH.includes(k))) && r && r.getContext) { ctx.drawImage(r, 0, 0, 1, 1, 0, 0, 1, 1); } flush(k); TIMES[k] = (TIMES[k] || 0) + performance.now() - t0; return r; };
const tl = new Timeline({ spb: SPB, fps: FPS, budget: 1500, name: 'lab_physics',
  key: await sourceKey([new URL(import.meta.url).pathname, '../lib/fx/physics.js', '../lib/fx/physics_timeline.js']) });

// ---------------------------------------------------------------- shared art
const MARK = BRAND.acp_mark;
function markCanvas(w, h, size, cy = h / 2, color = '#fff') {
  const c = mk(w, h), g = c.getContext('2d'), s = size / MARK.height;
  g.drawImage(tinted(MARK, color), w / 2 - MARK.width * s / 2, cy - size / 2, MARK.width * s, size);
  return c;
}
function noiseCanvas(w, h, seed, scale = 1) {
  const c = mk(w, h), g = c.getContext('2d'), id = g.createImageData(w, h), r = rng(seed);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = 0.5 + 0.5 * fbm3(x * 0.02 * scale, y * 0.02 * scale, seed, 4), k = (y * w + x) * 4;
    id.data[k] = id.data[k + 1] = id.data[k + 2] = v * 255 * (0.9 + 0.1 * r()); id.data[k + 3] = 255;
  }
  g.putImageData(id, 0, 0); return c;
}
function tag(name, desc, age) {
  if (!HUD) return;
  const a = clamp(age * 5) * clamp((1.6 - age) * 2 + 0.55);
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(7,2,3,0.8)'; ctx.fillRect(40, 70, 470, 82);
  ctx.fillStyle = C.red2; ctx.fillRect(40, 70, 9, 82);
  line(ctx, name, 66, 112, { family: 'Michroma', size: 30, align: 'left', color: C.cream, maxW: 430 });
  line(ctx, desc, 66, 139, { family: 'Plex Mono', size: 17, align: 'left', color: 'rgba(244,230,208,0.72)', maxW: 430 });
  ctx.restore();
}
const setCam = (g, c) => g.setTransform(c[0], c[1], c[2], c[3], c[4], c[5]);
// canvas-style affine: zoom z and roll r about pivot (px, py), then a shake offset
function camAffine(z, r, px, py, sx = 0, sy = 0) {
  const c = Math.cos(r) * z, s = Math.sin(r) * z;
  return [c, s, -s, c, px - c * px + s * py + sx, py - s * px - c * py + sy];
}
const mulAff = (A, Bm) => [A[0] * Bm[0] + A[2] * Bm[1], A[1] * Bm[0] + A[3] * Bm[1], A[0] * Bm[2] + A[2] * Bm[3], A[1] * Bm[2] + A[3] * Bm[3], A[0] * Bm[4] + A[2] * Bm[5] + A[4], A[1] * Bm[4] + A[3] * Bm[5] + A[5]];
// soft contact shadows: an ellipse under every body near the floor (fades with height), plus one AO pool under the pile
function contactShadows(g, world, u, floorY, { maxH = 220, k = 0.6, ao = 0.5, ids = null } = {}) {
  const st = world.at(u), n = world.defs.length; let x0 = Infinity, x1 = -Infinity, cnt = 0;
  g.save();
  for (const i of ids || world.defs.map((_, j) => j)) {
    if (!st[n * 3 + i]) continue;
    const d = world.defs[i]; if (!d.sprite) continue;
    const x = st[i * 3], y = st[i * 3 + 1], a = st[i * 3 + 2], ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a));
    const hw = (d.sprite.width * ca + d.sprite.height * sa) / 2, hh = (d.sprite.width * sa + d.sprite.height * ca) / 2;
    const lift = floorY - (y + hh * 0.92); if (lift > maxH) continue;
    const f = 1 - clamp(lift / maxH);
    g.save(); g.translate(x, floorY - 6); g.scale(1, 0.16);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, hw * (0.9 + 0.5 * (1 - f)));
    gr.addColorStop(0, `rgba(0,0,0,${k * f})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(-hw * 1.5, -hw * 1.5, hw * 3, hw * 3); g.restore();
    if (f > 0.5) { x0 = Math.min(x0, x - hw); x1 = Math.max(x1, x + hw); cnt++; }
  }
  if (cnt > 2 && ao > 0) {         // ambient occlusion under the whole pile
    const cx = (x0 + x1) / 2, rw = (x1 - x0) / 2 + 60;
    g.translate(cx, floorY - 20); g.scale(1, 0.22);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, rw); gr.addColorStop(0, `rgba(0,0,0,${ao})`); gr.addColorStop(0.7, `rgba(0,0,0,${ao * 0.4})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(-rw, -rw, rw * 2, rw * 2);
  }
  g.restore();
}

// ================================================================ A. FLUID (b0-8)
const markOb = markCanvas(540, 960, 520, 440);
// the obstacle as an object: an obsidian emblem, bevel-lit from its own SDF, with a molten inner rim and an outer glow
const EMB = (() => {
  const size = 1040, mw = Math.round(MARK.width * size / MARK.height), pad = 48, w = mw + pad * 2, h = size + pad * 2;
  const c = mk(w, h), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(tinted(MARK, '#fff'), pad, pad, mw, size);
  const id = g.getImageData(0, 0, w, h), d = id.data, sd = sdfOf(d, w, h, 127);
  const glow = mk(w, h), gg = glow.getContext('2d'), gid = gg.createImageData(w, h), q = gid.data;
  const L = [-0.5, -0.66, 0.56], Hv = [L[0], L[1], L[2] + 1], hl = Math.hypot(...Hv); Hv.forEach((v, i) => Hv[i] = v / hl);
  const S = (x, y) => sd[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, s = sd[i], k = i * 4;
    if (s < 0.8) {
      const hgt = v => clamp(-v / 18), gx = (hgt(S(x + 1, y)) - hgt(S(x - 1, y))) * 9, gy = (hgt(S(x, y + 1)) - hgt(S(x, y - 1))) * 9;
      let nx = -gx, ny = -gy, nz = 1; const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
      const diff = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]), spec = Math.pow(Math.max(0, nx * Hv[0] + ny * Hv[1] + nz * Hv[2]), 36);
      const rimIn = Math.exp(-((s + 3.5) ** 2) / 5);
      const cov = clamp(0.5 - s);
      const r = 0.05 + 0.1 * diff + 1.3 * spec * 0.95 + 0.95 * rimIn, gcol = 0.025 + 0.05 * diff + 1.2 * spec * 0.85 + 0.12 * rimIn, b = 0.03 + 0.05 * diff + 1.1 * spec * 0.75 + 0.18 * rimIn;
      d[k] = clamp(r) * 255; d[k + 1] = clamp(gcol) * 255; d[k + 2] = clamp(b) * 255; d[k + 3] = cov * 255;
    } else d[k + 3] = 0;
    const ga = s > 0 ? Math.exp(-s / 14) * 0.9 : 0.9;
    q[k] = 255; q[k + 1] = 40; q[k + 2] = 45; q[k + 3] = ga * 255;
  }
  g.putImageData(id, 0, 0); gg.putImageData(gid, 0, 0);
  return { c, glow, x: W / 2 - mw / 2 - pad, y: 880 - size / 2 - pad };
})();
const secA = tl.section('fluid', { from: 0, to: 8, preroll: 1.2, draw: sceneA });
const fluidA = secA.own('fluidA', Fluid.preset('smoke', {
  sim: [144, 256], dye: [360, 640], sub: 1, out: [540, 960],
  obstacle: () => markOb,
  emit: (f, t) => {
    const g = t - secA.preroll, e = [];
    const red = [0.86, 0.09, 0.15], cream = [0.96, 0.86, 0.7], deep = [0.5, 0.04, 0.08];
    e.push({ x: W / 2 + Math.sin(t * 1.7) * 170, y: H - 190, r: 115, color: red.map(v => v * 4.2), temp: 2.2, vy: -1250, vx: Math.sin(t * 2.3) * 300 });
    e.push({ x: 120, y: H * 0.8 + Math.sin(t * 2.1) * 110, r: 70, color: cream.map(v => v * 3.2), temp: 1.0, vx: 1150, vy: -560 });
    e.push({ x: W - 120, y: H * 0.66 + Math.sin(t * 1.3) * 110, r: 70, color: red.map(v => v * 3.4), temp: 1.0, vx: -1150, vy: -460 });
    // a low smoke bank across the floor keeps the frame full-bleed
    for (let k = 0; k < 3; k++) e.push({ x: 180 + k * 360 + Math.sin(t * 0.9 + k) * 80, y: H - 70, r: 170, color: deep.map(v => v * 2.2), temp: 1.1, vy: -380, jet: 0.25 });
    // cowbell pulses (global beat clock) punch in from alternating sides
    const tg = g + secA.start, b = Math.round(tg / SPB * 2) / 2;
    if (g > 0 && tg - B.last('cowm', tg) < 0.07) {
      const s = Math.round(b * 2) % 2 ? 1 : -1;
      e.push({ x: W / 2 + s * 400, y: H * 0.93, r: 80, color: (s > 0 ? red : cream).map(v => v * 14), temp: 5, vx: -s * 1100, vy: -1800 });
    }
    return e;
  },
}));
function sceneA(t, u) {
  const kick = B.env('cowm', t, 10), kk = B.env('kick', t, 6);
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#020102'); g.addColorStop(0.6, '#0d0204'); g.addColorStop(1, '#1c0406');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // backlight behind the mark: the smoke's thin edges catch it (rim term in the fluid look)
  const bl = ctx.createRadialGradient(W / 2, 860, 60, W / 2, 860, 900); bl.addColorStop(0, `rgba(160,20,30,${0.35 + 0.25 * kick})`); bl.addColorStop(1, 'rgba(60,5,10,0)');
  ctx.fillStyle = bl; ctx.fillRect(0, 0, W, H);
  const fcv = time('fluid', () => fluidA.render(u, { rim: 1.0 + 0.8 * kick }));
  ctx.drawImage(fcv, 0, 0, W, H);
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.28 + 0.4 * kick + 0.2 * kk; ctx.drawImage(EMB.glow, EMB.x, EMB.y); ctx.restore();
  ctx.drawImage(EMB.c, EMB.x, EMB.y);
  tag('FLUID · MACCORMACK + MG', '144×256 vel · 360×640 dye · curl-noise detail', t - 0.2);
}

// ================================================================ B. CLOTH (b8-16), G. finale banner
function bannerTexture() {
  const w = 1024, h = 1400, c = mk(w, h), g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#c41a1e'); gr.addColorStop(1, '#a0121a');
  g.fillStyle = gr; g.fillRect(0, 0, w, h - 90);
  g.strokeStyle = C.cream; g.lineWidth = 16; g.strokeRect(46, 46, w - 92, h - 90 - 92);
  g.lineWidth = 4; g.strokeRect(72, 72, w - 144, h - 90 - 144);
  const s = 520 / MARK.height;
  g.drawImage(tinted(MARK, C.cream), w / 2 - MARK.width * s / 2, 150, MARK.width * s, 520);
  line(g, 'OWN THE', w / 2, 860, { size: 190, color: C.cream, maxW: w - 200 });
  line(g, 'FUTURE', w / 2, 1060, { size: 230, color: C.cream, maxW: w - 200 });
  const L = BRAND.acc_lockup, lw = 460, lh = L.height * lw / L.width;
  g.drawImage(tinted(L, '#1a0306'), w / 2 - lw / 2, 1130, lw, lh);
  for (let x = 0; x < w; x += 12) {
    const fg = g.createLinearGradient(0, h - 90, 0, h); fg.addColorStop(0, '#e2b458'); fg.addColorStop(1, '#8a5a1c');
    g.fillStyle = fg; g.fillRect(x + 2, h - 90, 7, 70 + (x * 37 % 20));
  }
  g.fillStyle = '#d6a64a'; g.fillRect(0, h - 96, w, 12);
  return c;
}
const BANNER = bannerTexture();
const secB = tl.section('cloth', { from: 8, to: 16, preroll: 1.5, draw: sceneB });
const windB = gl => (x, y, z, t) => {
  const tg = t - secB.preroll + secB.start, k = B.env('kick', tg, 3) + 1.4 * B.env('impact', tg, 1.5);
  const n = noise3(x * 0.004 - t * 1.4, y * 0.0035 - t * 0.5, t * 0.8) + 0.5 * noise3(x * 0.009 + 3, y * 0.008 - t * 2, t * 1.3), n2 = noise3(x * 0.004 + 9, y * 0.003, t * 1.1);
  return [260 * n2 + 140 * gl, 80 * n, -(700 * (n + 0.15) + 700 * k) * gl];
};
const clothB = secB.own('clothB', new Cloth({ cols: 40, rows: 56, x: 80, y: 190, w: 920, h: 1258, sub: 3, iters: 6, gravity: 1100, damping: 0.02, drag: 1.9, lift: 0.1, bend: 0.05,
  pins: (i, j) => j === 0, wind: windB(1) }).cut(secB.ev(14.5), [[-0.05, 0.62], [0.3, 0.52], [0.62, 0.6], [1.05, 0.44]], 0.18));
const viewB = new ClothView(clothB, BANNER, { focal: 1900, light: [-0.5, -0.65, -0.6], ambient: 0.34, sheen: 0.4, weave: 0.14, threads: 180, grime: 0.18 });
const boltsB = [bolt(760, -40, 560, 1500, { seed: 4, detail: 8, rough: 0.34, depth: 3 }), bolt(220, -40, 420, 1100, { seed: 9, detail: 7, rough: 0.4, depth: 2 })];
const cloudTex = noiseCanvas(270, 480, 3, 1.2);
function storm(t, flash, tint = '#2a070a') {
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#07090d'); g.addColorStop(0.55, tint); g.addColorStop(1, '#0a0203');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.22 + 0.6 * flash;
  const cw = W + 400, cx = -((t * 30) % (2 * cw));
  for (let k = 0; k < 3; k++) { const x = cx + k * cw; if (x > W || x + cw < 0) continue;       // mirrored tiles: seamless
    ctx.save(); if (k % 2) { ctx.translate(x + cw, 0); ctx.scale(-1, 1); ctx.drawImage(cloudTex, 0, -40, cw, H + 80); } else ctx.drawImage(cloudTex, x, -40, cw, H + 80); ctx.restore(); }
  ctx.restore();
  settle();
}
// settle the backdrop before GL layers and strokes pile onto it. Measured: pending backdrop draws + the later
// layers stalled SwiftShader at 13-20 s/frame in the fire section (1.4-1.6 s with this 1-px readback), and the
// cloth section went from 3-4 s to 0.85-1.0 s.
function settle() { ctx.getImageData(0, 0, 1, 1); }
function drawPole(y, x0, x1) {
  const g = ctx.createLinearGradient(0, y - 16, 0, y + 16); g.addColorStop(0, '#6b4a2a'); g.addColorStop(0.45, '#d9b26a'); g.addColorStop(1, '#3a2412');
  ctx.fillStyle = g; ctx.fillRect(x0, y - 14, x1 - x0, 28);
  for (const x of [x0, x1]) { ctx.fillStyle = '#e8c479'; ctx.beginPath(); ctx.arc(x, y, 26, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#6b4a2a'; ctx.beginPath(); ctx.arc(x + 4, y + 4, 14, 0, Math.PI * 2); ctx.fill(); }
}
function sceneB(t, u) {
  const s1 = strike(t, bt(8) - 0.09, { seed: 2 }), s2 = strike(t, bt(11.5) - 0.09, { seed: 5 });
  const flash = Math.max(s1.flash, s2.flash * 0.7);
  storm(t, flash);
  time('bolt', () => drawBolts(ctx, [{ segs: boltsB[0], grow: s1.grow, heat: s1.heat, width: 5 }, { segs: boltsB[1], grow: s2.grow, heat: s2.heat * 0.8, width: 4 }]));
  viewB.ambient = 0.34 + flash * 0.9;
  const cv = time('cloth', () => viewB.render(u));
  ctx.drawImage(cv, 0, 0);
  drawPole(190, 50, W - 50);
  if (flash > 0) { ctx.fillStyle = `rgba(255,235,235,${0.35 * flash})`; ctx.fillRect(0, 0, W, H); }
  tag('CLOTH · VERLET 3D', '40×56 nodes · aero wind · timed tear · lit weave', t - secB.start - 0.1);
}

// ================================================================ C. RIGID: cast letters + seal on a lit floor (b16-24)
const secC = tl.section('rigid', { from: 16, to: 24, preroll: 0, draw: sceneC });
const FLOOR_C = 1720;
const worldC = secC.own('worldC', new RigidWorld({ gravity: 3600, sub: 4, iters: 6 }));
worldC.ground(FLOOR_C).walls({ left: 10, right: W - 10 });
// cast letters: enamel face over iron; the wear knock-outs let the substrate show through in the shader
const paintGlyph = (fill, seed) => (g, ch, cw, chh, pad, size) => {
  g.font = `${size}px "Anton"`; g.fillStyle = fill; g.fillText(ch, pad, pad + size * 1.02);
  g.globalCompositeOperation = 'destination-out'; const r = rng(ch.charCodeAt(0) * 7 + seed);
  for (let i = 0; i < 70; i++) { g.globalAlpha = 0.32 * r(); g.beginPath(); g.arc(r() * cw, r() * chh, 1 + r() * 4, 0, 6.3); g.fill(); }
  g.lineWidth = 1.2; for (let i = 0; i < 14; i++) { g.globalAlpha = 0.25 * r(); g.beginPath(); const x = r() * cw, y = r() * chh; g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 60, y + (r() - 0.5) * 20); g.stroke(); }
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
};
const idsOWN = worldC.text('OWN', { size: 420, y: -520, spawn: 0.0, stagger: 0.07, spin: 3, jitter: 90, seed: 2, paint: paintGlyph('#efe1c6', 1), vy: 900, density: 1.2, bounce: 0.15, mat: 'enamel', shadow: false });
const idsTHE = worldC.text('THE', { size: 420, y: -520, spawn: 0.34, stagger: 0.07, spin: 3, jitter: 90, seed: 3, paint: paintGlyph('#efe1c6', 2), vy: 900, density: 1.2, bounce: 0.15, mat: 'enamel', shadow: false });
const idsFUT = worldC.text('FUTURE', { size: 350, y: -520, spawn: 0.7, stagger: 0.06, spin: 3, jitter: 120, seed: 4, paint: paintGlyph('#c91f37', 3), vy: 1100, density: 1.2, bounce: 0.15, tracking: 0.03, mat: 'enamel', shadow: false, z: 1 });
function sealSprite() {
  const w = 760, h = 330, c = mk(w, h), g = c.getContext('2d');
  g.fillStyle = '#b3141f'; g.beginPath(); g.roundRect(0, 0, w, h, 26); g.fill();
  g.strokeStyle = '#f0dcc0'; g.lineWidth = 12; g.beginPath(); g.roundRect(22, 22, w - 44, h - 44, 16); g.stroke();
  g.lineWidth = 4; g.beginPath(); g.roundRect(42, 42, w - 84, h - 84, 10); g.stroke();
  const L = BRAND.acc_lockup, lh = 150, lw = L.width * lh / L.height;
  g.drawImage(tinted(L, '#f0dcc0'), w / 2 - lw / 2, h / 2 - lh / 2 - 10, lw, lh);
  line(g, 'ACP.US · WORKERS STAMP · 2026', w / 2, h - 58, { family: 'Plex Mono', size: 22, color: '#f0dcc0', tracking: 0.12 });
  g.globalCompositeOperation = 'destination-out'; const r = rng(99);
  for (let i = 0; i < 400; i++) { g.globalAlpha = 0.3 * r(); g.beginPath(); g.arc(r() * w, r() * h, 0.5 + r() * 2.5, 0, 6.3); g.fill(); }
  return c;
}
const idSeal = worldC.body({ sprite: sealSprite(), x: W / 2 + 30, y: -420, angle: -0.08, spin: 0.25, vy: 3600, density: 7, bounce: 0.05, friction: 0.9, spawn: secC.ev(20) - 0.34, ccd: true, z: 5, mat: 'rubber', shadow: false });
worldC.blast(secC.ev(20) + 0.02, { x: W / 2, y: 1500, radius: 900, force: 2200, up: 0.8, spin: 5, ids: [...idsOWN, ...idsTHE, ...idsFUT] });
// background layer: a second, smaller rain of type far behind (drawn at 0.52 scale with depth of field)
const bgC = secC.own('bgC', new RigidWorld({ gravity: 3000, sub: 2, iters: 4 }));
bgC.ground(FLOOR_C).walls({ left: -120, right: W + 120 });
for (const [k, wd] of ['WORKERS', 'OF THE', 'WORLD', 'UNITE'].entries())
  bgC.text(wd, { size: 260, x: W / 2 + (k % 2 ? 160 : -160), y: -400, spawn: 0.15 + k * 0.4, stagger: 0.05, spin: 2, jitter: 140, seed: 20 + k, paint: paintGlyph(k % 2 ? '#c91f37' : '#e6d6b8', 9 + k), vy: 800, mat: 'enamel', shadow: false, decomp: false });
const viewC = new RigidView(worldC, { materials: ['enamel', 'rubber'], light: [-0.52, -0.62, 0.58], extrude: [10, -26] });
const viewBg = new RigidView(bgC, { res: 0.5, materials: ['enamel'], light: [-0.52, -0.62, 0.58], extrude: [10, -26] });
const paper = (() => { const c = mk(540, 960), g = c.getContext('2d'), r = rng(11);
  g.fillStyle = '#fff'; g.fillRect(0, 0, 540, 960); g.globalAlpha = 0.5; g.drawImage(noiseCanvas(135, 240, 11, 4), 0, 0, 540, 960); g.globalAlpha = 1;
  for (let i = 0; i < 2600; i++) { g.strokeStyle = `rgba(${r() < 0.5 ? '120,95,70' : '255,250,240'},${0.25 * r()})`; g.lineWidth = 0.6; const x = r() * 540, y = r() * 960, a = r() * 6.3, l = 3 + r() * 12;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
  return c; })();
// the print-shop: a pasted-up wall (faded posters of the same words) and a concrete floor, lit by one warm key
const WALL_C = (() => {
  const c = mk(W + 240, H + 240), g = c.getContext('2d');
  g.fillStyle = '#2a1f1b'; g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'multiply'; g.globalAlpha = 0.9; g.drawImage(paper, 0, 0, c.width, c.height); g.globalCompositeOperation = 'source-over';
  const r = rng(5);
  for (let i = 0; i < 9; i++) {           // weathered poster sheets
    const x = r() * c.width - 150, y = r() * 1300 - 100, w = 380 + r() * 260, h = w * 1.35;
    g.save(); g.translate(x + w / 2, y + h / 2); g.rotate((r() - 0.5) * 0.08); g.globalAlpha = 0.12 + 0.12 * r();
    g.fillStyle = r() < 0.5 ? '#6e1620' : '#8f7f68'; g.fillRect(-w / 2, -h / 2, w, h);
    g.globalAlpha *= 1.4; line(g, ['OWN', 'THE', 'FUTURE', 'STRIKE', 'UNION'][i % 5], 0, 0, { size: w * 0.34, color: '#120a08' });
    g.restore();
  }
  g.globalAlpha = 1;
  const fl = g.createLinearGradient(0, FLOOR_C - 100 + 120, 0, c.height);      // floor: concrete, darker toward the camera
  fl.addColorStop(0, '#3a302a'); fl.addColorStop(0.12, '#2b231f'); fl.addColorStop(1, '#140f0d');
  g.fillStyle = fl; g.fillRect(0, FLOOR_C - 90 + 120, c.width, c.height);
  g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.5; g.drawImage(noiseCanvas(270, 60, 17, 3), 0, FLOOR_C - 90 + 120, c.width, 330); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, FLOOR_C - 92 + 120, c.width, 5);                  // skirting shadow
  // warm key light pool from the upper left, baked in (a per-frame full-frame gradient costs as much as a layer)
  g.globalCompositeOperation = 'lighter';
  const kl = g.createRadialGradient(450, 1170, 60, 450, 1170, 1250); kl.addColorStop(0, 'rgba(255,170,110,0.34)'); kl.addColorStop(0.5, 'rgba(200,90,60,0.12)'); kl.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = kl; g.fillRect(0, 0, c.width, c.height); g.globalCompositeOperation = 'source-over';
  return c;
})();
function shakeFrom(hits, t, k = 1) {
  let s = 0; for (const h of hits) { const a = t - h.t; if (a >= 0 && a < 0.5) s += Math.min(1.5, h.e / 3000) * Math.exp(-a * 10); }
  s = Math.min(1.6, s) * k; return [noise3(t * 40, 1, 2) * 30 * s, noise3(t * 40, 5, 7) * 30 * s];
}
function sceneC(t, u) {
  const hits = worldC.hits(u - 1.3, u);
  const [sx, sy] = shakeFrom(hits, u);
  const p = ease.inOutCubic(clamp(u / (secC.end - secC.start)));
  const cam = camAffine(1 + 0.075 * p, -0.009 * p, W / 2, 1300, sx, sy);
  time('wall', () => { ctx.save(); setCam(ctx, cam); ctx.drawImage(WALL_C, -120, -120); ctx.restore(); });
  // background type (depth of field + haze), then contact shadows, then the hero bodies
  ctx.drawImage(time('rigidBg', () => viewBg.render(u, { cam: mulAff(cam, [0.52, 0, 0, 0.52, W * 0.24, 1652 - FLOOR_C * 0.52]), blur: 3.5, haze: [0.16, 0.11, 0.1, 0.5], shadow: { off: [10, 8], soft: 10, alpha: 0.3 } })), 0, 0, W, H);
  // contact shadows + AO live in world space (same camera)
  time('contact', () => { ctx.save(); setCam(ctx, cam); ctx.globalCompositeOperation = 'multiply';
  contactShadows(ctx, worldC, u, FLOOR_C, { k: 0.85, ao: 0.65 });
  ctx.restore(); settle(); });
  ctx.drawImage(time('rigid', () => viewC.render(u, { cam, shadow: { off: [20, 15], soft: 13, alpha: 0.5 } })), 0, 0);
  ctx.save(); setCam(ctx, cam); drawPuffs(ctx, hits, u, { color: [120, 95, 80], alpha: 0.3, size: 80 }); ctx.restore();
  const land = hits.find(h => h.i === idSeal);
  if (land) { const a = u - land.t; if (a >= 0 && a < 0.3) { ctx.fillStyle = `rgba(201,31,55,${0.3 * Math.exp(-a * 12)})`; ctx.fillRect(0, 0, W, H); } }
  tag('RIGID · 2.5D BODIES', 'convex decomposition · SDF bevel · walls · DOF', u - 0.1);
}

// ================================================================ D. SHATTER: monument collapse (b24-36)
const secD = tl.section('shatter', { from: 24, to: 36, preroll: 0, draw: sceneD });
function monument() {
  const w = 860, h = 1560, c = mk(w, h), g = c.getContext('2d');
  const shaftX = 150, shaftW = 560, top = 250, plinthY = h - 210;
  const path = () => { g.beginPath(); g.moveTo(w / 2, 20); g.lineTo(shaftX + shaftW, top); g.lineTo(shaftX + shaftW, plinthY); g.lineTo(w - 20, plinthY); g.lineTo(w - 20, h); g.lineTo(20, h); g.lineTo(20, plinthY); g.lineTo(shaftX, plinthY); g.lineTo(shaftX, top); g.closePath(); };
  path(); g.save(); g.clip();
  const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#6a625b'); gr.addColorStop(0.35, '#9a9084'); gr.addColorStop(0.6, '#857b70'); gr.addColorStop(1, '#5a524c');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.8; g.drawImage(noiseCanvas(215, 390, 21, 2.5), 0, 0, w, h);
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  const r = rng(5);
  for (let i = 0; i < 9000; i++) { g.fillStyle = r() < 0.5 ? 'rgba(20,16,14,0.35)' : 'rgba(230,220,205,0.22)'; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
  for (let y = top + 170; y < h; y += 170) { g.fillStyle = 'rgba(10,8,8,0.55)'; g.fillRect(0, y, w, 4); g.fillStyle = 'rgba(240,230,215,0.18)'; g.fillRect(0, y + 4, w, 2);
    const off = ((y / 170) % 2) * 140; for (let x = shaftX + 140 + off; x < shaftX + shaftW; x += 280) { g.fillStyle = 'rgba(10,8,8,0.5)'; g.fillRect(x, y - 166, 3, 166); } }
  g.beginPath(); g.moveTo(w / 2, 20); g.lineTo(shaftX + shaftW, top); g.lineTo(shaftX, top); g.closePath();
  const pg = g.createLinearGradient(shaftX, 0, shaftX + shaftW, 0); pg.addColorStop(0, '#8a6a2c'); pg.addColorStop(0.45, '#f0cf7c'); pg.addColorStop(1, '#6a4a1a');
  g.fillStyle = pg; g.fill();
  const L = 'CAPITAL'; g.font = '150px "Anton"'; g.textAlign = 'center';
  for (let i = 0; i < L.length; i++) { const y = top + 190 + i * 158; g.fillStyle = '#1a1411'; g.fillText(L[i], w / 2, y); }
  g.font = '34px "Michroma"'; g.fillStyle = '#1a1412'; g.fillText('MDCCCLXVII', w / 2, plinthY + 110);
  g.restore();
  return c;
}
const MON = monument();
const FLOOR_D = 1860;
const worldD = secD.own('worldD', new RigidWorld({ gravity: 3000, sub: 4, iters: 5, impactThreshold: 700 }));
worldD.ground(FLOOR_D).walls({ left: -200, right: W + 200 });
const MON_X = (W - MON.width) / 2, MON_Y = FLOOR_D - MON.height;
const idsMon = worldD.shatter(MON, { x: MON_X, y: MON_Y, sites: 120, focus: [MON.width / 2, MON.height - 330], bias: 0.5, spread: 0.3, seed: 12, density: 2.5, friction: 0.8, bounce: 0.05,
  edge: 'rgba(255,236,214,0)', edgeDark: 'rgba(0,0,0,0)', mat: 'stone' });
for (const i of idsMon) if (worldD.defs[i].y < MON_Y + 250) worldD.defs[i].mat = 'gilt';
const REL = secD.ev(28);
worldD.release(REL, idsMon);
worldD.blast(REL, { x: W / 2 + 60, y: MON_Y + MON.height - 300, radius: 900, force: 1900, up: 0.5, spin: 2.5 });
const viewD = new RigidView(worldD, { materials: ['stone', 'gilt'], light: [-0.35, 0.45, 0.8], extrude: [9, -24] });
const fracture = idsMon.map(i => worldD.defs[i].hullWorld);
const MONA = MON.getContext('2d').getImageData(0, 0, MON.width, MON.height).data;
const onStone = (x, y) => { const ix = Math.round(x - MON_X), iy = Math.round(y - MON_Y); return ix >= 0 && iy >= 0 && ix < MON.width && iy < MON.height && MONA[(iy * MON.width + ix) * 4 + 3] > 128; };
const FOCUS = [MON_X + MON.width / 2, MON_Y + MON.height - 330];
const hair = [crack(FOCUS[0], FOCUS[1], { seed: 3, angle: -1.9, len: 700, gens: 4 }), crack(FOCUS[0], FOCUS[1], { seed: 8, angle: -1.2, len: 800, gens: 4 }), crack(FOCUS[0], FOCUS[1], { seed: 13, angle: 0.3, len: 350, gens: 3 })].map(c => c.filter(sg => onStone(sg.x0, sg.y0) && onStone(sg.x1, sg.y1)));
const fluidD = secD.own('fluidD', Fluid.preset('dust', {
  sim: [120, 216], dye: [270, 480],
  emit: (f, t) => {
    const e = [];
    for (const h of worldD.hits(t - 1 / 30, t)) {
      const k = Math.min(2.5, h.e / 2500), r = rng(h.i * 31 + f);
      e.push({ x: h.x, y: Math.min(h.y + 30, 1850), r: 60 + 70 * k, color: [0.5, 0.45, 0.4].map(v => v * 10 * k), temp: 2 * k, vx: (r() - 0.5) * 900 * k, vy: -500 * k, jet: 0.4 });
    }
    if (t > REL) { const s = Math.exp(-(t - REL) * 1.2); e.push({ x: W / 2 + Math.sin(t * 3) * 300, y: 1860, r: 220, color: [0.4, 0.36, 0.33].map(v => v * 6 * s), temp: 1.2 * s, vx: Math.sin(t * 5) * 800 * s, vy: -300 * s, jet: 0.3 }); }
    return e;
  },
}));
const GROUND_D = (() => {           // scorched plaza: stone flags receding, lit from the red uplight in the scene
  const c = mk(W + 240, 420), g = c.getContext('2d');
  g.fillStyle = '#1a1011'; g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.7; g.drawImage(noiseCanvas(270, 105, 29, 3), 0, 0, c.width, c.height); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 2;
  for (let k = 0; k < 7; k++) { const y = 20 + (k * k) * 9; g.beginPath(); g.moveTo(0, y); g.lineTo(c.width, y); g.stroke(); }
  for (let k = -12; k <= 12; k++) { g.beginPath(); g.moveTo(c.width / 2 + k * 70, 0); g.lineTo(c.width / 2 + k * 180, c.height); g.stroke(); }
  const fade = g.createLinearGradient(0, 0, 0, 60); fade.addColorStop(0, 'rgba(10,4,6,1)'); fade.addColorStop(1, 'rgba(10,4,6,0)'); g.fillStyle = fade; g.fillRect(0, 0, c.width, 60);
  return c;
})();
function sceneD(t, u) {
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#050608'); g.addColorStop(0.7, '#1c0507'); g.addColorStop(1, '#3a080b');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const hits = worldD.hits(u - 1.2, u);
  const [sx, sy] = shakeFrom(hits, u, 0.7);
  const push = ease.inOutCubic(clamp(u / (REL + 0.4))), after = clamp((u - REL) / 3);
  const cam = camAffine(1 + 0.1 * push - 0.06 * ease.outCubic(after), 0.006 * push, W / 2, 1500, sx, sy);
  ctx.save(); setCam(ctx, cam);
  storm(t, 0);
  ctx.drawImage(GROUND_D, -120, FLOOR_D - 150);
  const rg = ctx.createRadialGradient(W / 2, 1900, 50, W / 2, 1900, 1000); rg.addColorStop(0, 'rgba(255,40,50,0.5)'); rg.addColorStop(1, 'rgba(255,40,50,0)');
  ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = rg; ctx.fillRect(-200, 700, W + 400, 1400); ctx.globalCompositeOperation = 'multiply';
  contactShadows(ctx, worldD, u, FLOOR_D, { k: 0.8, ao: 0.7, maxH: 160 });
  ctx.restore(); settle();
  viewD.open = u >= REL ? 1 : 0;
  ctx.drawImage(time('rigid', () => viewD.render(u, { cam, shadow: { off: [-14, -10], soft: 16, alpha: 0.45 } })), 0, 0);
  ctx.save(); setCam(ctx, cam);
  if (u < REL + 0.1) {
    const grow = ease.inOutCubic(clamp(u / (REL - 0.05)));
    const segs = [];
    for (const P of fracture) for (let k = 0; k < P.length; k++) {
      const a = P[k], b = P[(k + 1) % P.length], d = Math.hypot((a[0] + b[0]) / 2 - FOCUS[0], (a[1] + b[1]) / 2 - FOCUS[1]);
      segs.push({ x0: a[0], y0: a[1], x1: b[0], y1: b[1], o: d / 1100, w: clamp(1.1 - d / 1400, 0.25, 1) });
    }
    time('cracks', () => {
      for (const hc of hair) drawCrack(ctx, hc, { grow: grow * 1.3, width: 5 });
      drawBolt(ctx, segs, { grow, heat: 0.5 + 0.8 * grow + B.env('kick', t, 6) * 0.6, width: 2.2, color: 'rgba(255,60,40,1)', core: '#ffd9a0', blur: 5, glow: 0.9 });
    });
  }
  const fc = time('fluid', () => fluidD.render(u));
  ctx.drawImage(fc, 0, 0, W, H);
  drawSparks(ctx, hits, u, { n: 10, speed: 1000, minE: 1500 });
  ctx.restore();
  if (u >= REL && u < REL + 0.25) { ctx.fillStyle = `rgba(255,220,200,${0.7 * Math.exp(-(u - REL) * 14)})`; ctx.fillRect(0, 0, W, H); }
  tag('SHATTER · VORONOI 2.5D', `${idsMon.length} shards · SDF bevel · walls · dust fluid`, u - 0.1);
}

// ================================================================ E. FIRE + LIGHTNING (b36-44)
const secE = tl.section('fire', { from: 36, to: 44, preroll: 1.0, draw: sceneE, setup: () => buildFuel() }).use(worldD);
const flames = new Flames({ res: [360, 640] });
const fuel = mk(540, 960);
const fuelSmall = mk(270, 480), rubble = mk(W, H);
const fluidE = secE.own('fluidE', Fluid.preset('fire', {
  sim: [120, 216], dye: [270, 480],
  emit: (f, t) => [{ mask: fuelSmall, color: [1.0, 0.75, 0.7], temp: 1.6 }, { x: W / 2 + Math.sin(t * 2) * 250, y: 1700, r: 150, color: [0.45, 0.36, 0.36], temp: 2, vy: -260, jet: 0.2 }],
}));
const D_END = secD.ev(36) - 1e-3;
let fuelBuilt = false;
function buildFuel() {
  // rubble silhouette from worldD at its end state, lifted into a fuel mask (the 2D draw path gives exact silhouettes)
  const g = fuelSmall.getContext('2d'); g.clearRect(0, 0, 270, 480);
  g.save(); g.scale(0.25, 0.25); worldD.draw(g, D_END, { shadow: 0 }); g.restore();
  g.globalCompositeOperation = 'source-in'; g.fillStyle = '#fff'; g.fillRect(0, 0, 270, 480); g.globalCompositeOperation = 'source-over';
  const sil = mk(540, 960), sg = sil.getContext('2d'); sg.scale(0.5, 0.5); worldD.draw(sg, D_END, { shadow: 0 });
  rimFuel(sil, fuel, 14);
  // the rubble itself through the 2.5D view (baked once), charred toward the fire
  const rg = rubble.getContext('2d'); rg.clearRect(0, 0, W, H);
  viewD.open = 1; rg.drawImage(viewD.render(D_END, { shadow: { off: [0, -10], soft: 18, alpha: 0.55 }, light: [0, 0.35, 0.9] }), 0, 0);
  rg.globalCompositeOperation = 'source-atop'; const cg = rg.createLinearGradient(0, 1000, 0, 1900); cg.addColorStop(0, 'rgba(16,5,4,0.78)'); cg.addColorStop(1, 'rgba(40,9,6,0.6)');
  rg.fillStyle = cg; rg.fillRect(0, 0, W, H); rg.globalCompositeOperation = 'source-over';
  fuelBuilt = true;
}
const boltsE = [bolt(540, -40, 520, 1560, { seed: 21, detail: 8, rough: 0.33, depth: 3 }), bolt(150, -40, 60, 900, { seed: 22, detail: 7, depth: 2 }),
  bolt(960, -40, 1000, 1000, { seed: 23, detail: 7, depth: 2 }), bolt(780, -40, 640, 1500, { seed: 24, detail: 8, depth: 3 })];
const strikesE = [[bt(40), 0], [bt(42), 1], [bt(43), 2], [bt(43.5), 3], [bt(44) - 0.02, 0]];
function sceneE(t, u) {
  let flash = 0; const S = strikesE.map(([t0, k]) => { const s = strike(t, t0 - 0.09, { seed: k + 3 }); flash = Math.max(flash, s.flash * (k ? 0.6 : 1)); return [s, k]; });
  time('storm', () => { storm(t, flash, '#300709'); ctx.drawImage(GROUND_D, -120, FLOOR_D - 150); settle(); });
  time('bolt', () => drawBolts(ctx, S.map(([s, k]) => ({ segs: boltsE[k], grow: s.grow, heat: s.heat, width: k ? 4 : 6 }))));
  const fe = time('fluid', () => fluidE.render(u));
  ctx.drawImage(fe, 0, 0, W, H);
  time('rubble', () => ctx.drawImage(rubble, 0, 0));
  const fl = time('flames', () => flames.render(fuel, secE.age(t), { height: 0.22, turb: 0.1, speed: 1.4, intensity: 0.75 + 0.4 * B.env('taiko', t, 6) }));
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(fl, 0, 0, W, H); ctx.restore();
  if (flash > 0) { ctx.fillStyle = `rgba(255,240,240,${0.4 * flash})`; ctx.fillRect(0, 0, W, H); }
  tag('FIRE · FLAMES + FLUID', 'mask-fed flames · buoyant fire plume · strikes', secE.age(t) - 0.1);
}

// ================================================================ F. CROWD (b44-60): torch-bearers on a plain
const secF = tl.section('crowd', { from: 44, to: 60, preroll: 0.8, draw: sceneF });
const N = 3200, CX = 540, CY = 900;
const markF = markCanvas(460, 470, 450, 235);
const formMark = maskPoints(markF, N, { rect: [CX - 520, CY - 530, 1040, 1060], seed: 3, edge: 0.4, inset: 3 });
const wordCv = (() => { const c = mk(900, 800), g = c.getContext('2d');
  line(g, 'THE WHOLE', 450, 330, { size: 300, color: '#fff', maxW: 880 }); line(g, 'PEOPLE', 450, 700, { size: 330, color: '#fff', maxW: 880 }); return c; })();
const formWord = maskPoints(wordCv, N, { rect: [CX - 520, CY - 470, 1040, 925], seed: 4, edge: 0.5, inset: 2 });
const MARK_IN = secF.ev(44) - 0.5, MARK_ON = secF.ev(46.8), WORD_IN = secF.ev(51.5), WORD_ON = secF.ev(53.5);
const crowd = secF.own('crowd', new Crowd({
  n: N, seed: 7, speed: 210, radius: 20, sep: 1.5, ali: 0.9, coh: 0.3, wander: 0.5, bounds: [-3200, -4200, 4300, 3600],
  spawn: (i, r) => { const a = r() * Math.PI * 2, d = 560 + Math.pow(r(), 0.9) * 1500; const x = CX + Math.cos(a) * d * 0.9, y = CY + Math.sin(a) * d * 1.1;
    return [x, y, -Math.cos(a) * 160, -Math.sin(a) * 160]; },
  goal: (f, t) => {
    if (t >= WORD_IN) return { pts: formWord, w: ease.inOutCubic(clamp((t - WORD_IN) / (WORD_ON - WORD_IN) * 1.4)), speed: 1000, slow: 150 };
    const w = ease.inOutCubic(clamp((t - MARK_IN) / (MARK_ON - MARK_IN) * 1.2));
    return w > 0 ? { pts: formMark, w, speed: 1250, slow: 150 } : null;
  },
  flow: (x, y, t) => [(CX - x) * 0.12, (CY - y) * 0.1],
}));
const viewF = CrowdView.preset('torch', crowd, { heroes: 340, figH: 120, torchH: 118, poolR: 120, dustSize: 18, lightRect: [-1600, -2200, 4300, 5000], ground: [0.3, 0.22, 0.18], poolK: 0.9, dustK: 0.7, fig: [0.02, 0.016, 0.018] });
const boltF = bolt(560, -40, 540, 900, { seed: 41, detail: 8, depth: 3 });
function crowdCam(u) {
  // the crane: from a low, wide plain (horizon in frame) up over the formation, a little higher for the words
  const up = ease.inOutCubic(clamp((u - secF.ev(44.2)) / (MARK_ON + 0.3 - secF.ev(44.2)))), up2 = ease.inOutCubic(clamp((u - WORD_IN) / (WORD_ON - WORD_IN)));
  const pitch = lerp(0.36, 1.0, up) + 0.1 * up2, dist = lerp(1500, 1750, up) + 520 * up2, drift = 0.06 * Math.sin(u * 0.4);
  return { pitch, dist, focal: 1650, look: [CX + 40 * drift * 10, CY + lerp(-250, 0, up)], screen: [W / 2, lerp(1250, 980, up)] };
}
function sceneF(t, u) {
  const sk = strike(t, bt(56) - 0.09, { seed: 9 });
  const heat = 0.9 + 0.3 * B.env('kick', t, 7) + sk.flash * 0.5;
  const cam = crowdCam(u);
  ctx.drawImage(time('crowd', () => viewF.render(u, cam, { heat, strike: sk.flash })), 0, 0);
  if (sk.heat > 0) drawBolt(ctx, boltF, { grow: sk.grow, heat: sk.heat, width: 5 });
  if (sk.flash > 0) { ctx.fillStyle = `rgba(255,240,235,${0.3 * sk.flash})`; ctx.fillRect(0, 0, W, H); }
  tag('CROWD · BOIDS ON A PLANE', `${N} agents · 340 heroes · edge-weighted formations`, t - secF.start - 0.1);
}

// ================================================================ G. finale banner + embers (b60-70)
const secG = tl.section('finale', { from: 60, to: 64, preroll: 1.2, draw: sceneG });
const clothG = secG.own('clothG', new Cloth({ cols: 40, rows: 56, x: 80, y: 190, w: 920, h: 1258, sub: 3, iters: 6, gravity: 1100, damping: 0.02, drag: 1.9, lift: 0.1, bend: 0.05,
  pins: (i, j) => j === 0, wind: (x, y, z, t) => windB(1.2)(x, y, z, t - secG.start + secB.start) }));
const viewG = new ClothView(clothG, BANNER, { focal: 1900, light: [0.4, -0.7, -0.6], ambient: 0.4, sheen: 0.45, weave: 0.14, threads: 180, grime: 0.1 });
const embers = secG.own('embers', new Crowd({ n: 500, seed: 3, speed: 260, radius: 20, sep: 0.8, ali: 0.2, coh: 0.05, wander: 1.4,
  spawn: (i, r) => [r() * W, H * 0.4 + r() * H * 0.8, (r() - 0.5) * 60, -100 - r() * 200], flow: (x, y, t) => [60, -260] }));
function sceneG(t, u) {
  storm(t, B.env('impact', t, 3) * 0.6, '#3a0a0c');
  ctx.drawImage(time('cloth', () => viewG.render(u)), 0, 0);
  drawPole(190, 50, W - 50);
  embers.draw(ctx, u, { style: 'torch', trail: 4, size: 0.55, color: 'rgba(255,120,40,1)', heat: 0.9 });
}
tl.section('closer', { from: 64, to: 70, draw: t => closer(ctx, t - bt(64)) });

// ================================================================ frame
tl.after = (t, f) => { time('finish', () => fin.apply(ctx, f, { grain: 0.06, vignette: 0.8 })); ctx.getImageData(0, 0, 1, 1); };   // readback: the budget sees the GPU work
window.renderFrame = async (t) => {
  for (const k in TIMES) delete TIMES[k];
  const ms = await tl.render(t);
  TIMES.total = ms;
  window.TIMES = { ...TIMES };
  console.log(`ms t=${t.toFixed(2)} b=${(t / SPB).toFixed(1)} ` + Object.entries(TIMES).map(([k, v]) => `${k}=${v.toFixed(0)}`).join(' '));
};
window.SIM = tl.api();
window.__views = { viewC, viewBg, viewD, viewF };
window.LAB = { worldC, bgC, worldD, clothB, clothG, crowd, embers, fluidA, fluidD, fluidE };   // introspection (step costs: .stepMs)
if (!window.__noSimBin) await tl.load();          // resume from out/.lab_physics.sim.bin when its key matches
ready = true;
