// LAB / PRINT: one living three.js source (a procession of sculpted workers marching out of a colossal
// monument, low sun behind) pulled through every press in lib/fx/print.js at full 1080x1920, cut to the
// productive() track. Every 3D press gets the tone prep (auto levels, Kuwahara simplification at the line
// pitch, subject mask from the G-buffer) and object-anchored lines (lib/fx/gbuffer.js), so the camera can move.
// Engraving -> CMYK -> woodcut -> two-block linocut -> riso -> letterpress broadside -> ink bleed ->
// torn-paper collage (cached layer) -> one press per beat (white-line on black, UV screens, ink layer over
// live 3D, masked overprint, gold foil) -> printed closer.
//   ?profile  per-pass GPU-synced timings in the console   ?scale=0.75  cheaper preview pipeline
import * as THREE from 'three';
import { W, H, C, loadFonts, loadBeats, loadImage, clamp, lerp, ease, line, sigil, outCanvas, BRAND, tinted } from '../lib/kit.js';
import { Print } from '../lib/fx/print.js';
import { GBuffer } from '../lib/fx/gbuffer.js';
import { World } from './lab_print.world.js';

const Q = new URLSearchParams(location.search), SC = Number(Q.get('scale') || 1);
const ctx = outCanvas();
await loadFonts();
const B = await loadBeats('lab_print');
const pr = new Print({ width: Math.round(W * SC), height: Math.round(H * SC), ship: { boil: 6 } });
pr.profile = Q.has('profile'); window.pr = pr;
const hardhat = await loadImage('../assets/src/hardhat.jpg'), fortress = await loadImage('../assets/src/fortress.jpg');
const PERF = { n: 0, three: 0, print: 0, total: 0 };
const SHEETS = {};

// ================================================================ source: the procession (three.js) + its G-buffer
const SW = 540, SH = 960;
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(SW, SH, false);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.BasicShadowMap;      // hard shadows: the presses posterise them anyway
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
const bannerArt = document.createElement('canvas'); bannerArt.width = 256; bannerArt.height = 960; {     // red banner, cream ACP mark
  const g = bannerArt.getContext('2d'), M = BRAND.acp_mark, s = 200, w = M.width * s / M.height;
  g.fillStyle = '#c0141f'; g.fillRect(0, 0, 256, 960); g.fillStyle = '#f1e2c8'; g.fillRect(14, 0, 8, 960); g.fillRect(234, 0, 8, 960);
  g.drawImage(tinted(M, '#f1e2c8'), 128 - w / 2, 150, w, s);
  for (let i = 0; i < 3; i++) g.fillRect(40, 420 + i * 46, 176, 22);
}
const world = new World(renderer, { w: SW, h: SH, bannerArt });
const gb = new GBuffer(renderer, SW, SH);
window.__world = world; window.__gb = gb; window.__renderer = renderer;
const bakeMs = pr.preload(['cream', 'ivory', 'newsprint', 'rag', 'cotton', 'kraft', 'black']);
console.log(`papers baked in ${bakeMs.toFixed(0)} ms (setup, not per frame)`);

// ================================================================ secondary sources (2D)
const comp = document.createElement('canvas'); comp.width = W; comp.height = H; const cg = comp.getContext('2d');
function photo(u, img = hardhat, z0 = 1.05, z1 = 1.22, rect = null) {       // Ken Burns on a still (optionally cover-fit into a rect)
  const [rx, ry, rw, rh] = rect ? [rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]] : [0, 0, W, H];
  if (rect) { cg.fillStyle = '#fff'; cg.fillRect(0, 0, W, H); }
  const z = lerp(z0, z1, u), s = Math.max(rw / img.width, rh / img.height) * z, w = img.width * s, h = img.height * s;
  cg.drawImage(img, rx + (rw - w) / 2 - u * 40, ry + (rh - h) * 0.35, w, h); return comp;
}
// letterpress broadside as two separations (red forms, black forms), black on white. The top 200 px stay clear.
function broadside(which, src, age) {
  cg.fillStyle = '#fff'; cg.fillRect(0, 0, W, H);
  const K = '#000';
  if (which === 'red') {
    cg.fillStyle = K; cg.beginPath(); cg.arc(W / 2, 700, 330, 0, Math.PI * 2); cg.fill();           // the sun, under the cut
    cg.fillRect(90, 1168, W - 180, 14);
    line(cg, 'FUTURE', W / 2, 1712, { size: 300, color: K, maxW: W - 150 });
    const L = BRAND.acc_lockup, h = 74, w = L.width * h / L.height; cg.drawImage(tinted(L, K), W / 2 - w / 2, 1742, w, h);
  } else {
    cg.fillStyle = K; cg.fillRect(90, 214, W - 180, 8);
    line(cg, 'AMERICAN COMMUNIST PARTY', W / 2, 292, { family: 'Archivo Black', size: 50, color: K, tracking: 0.06, maxW: W - 180 });
    cg.save(); cg.beginPath(); cg.rect(90, 330, W - 180, 810); cg.clip();
    const s = (W - 180) / SW * 1.12; cg.filter = 'grayscale(1) contrast(1.9) brightness(1.25)';
    cg.drawImage(src, 0, 0, SW, SH, 90 - (SW * s - (W - 180)) / 2, 330 - SH * s * 0.28 + age * 20, SW * s, SH * s); cg.filter = 'none';
    cg.restore();
    cg.lineWidth = 8; cg.strokeStyle = K; cg.strokeRect(90, 330, W - 180, 810);
    line(cg, 'OWN THE', W / 2, 1418, { size: 230, color: K, maxW: W - 150 });
    line(cg, 'JOIN THE FIGHT AT ACP.US', W / 2, 1878, { family: 'Archivo Black', size: 40, color: K, tracking: 0.05, maxW: W - 200 });
  }
  return comp;
}
// the printed closer: a full red field, the procession as black mass along the bottom, the lockup knocked out to the stock
function closerSrc(age, mon) {
  cg.fillStyle = C.red2; cg.fillRect(0, 0, W, H);
  cg.save(); cg.globalCompositeOperation = 'multiply'; cg.filter = 'grayscale(1) contrast(2.2) brightness(0.95)';
  cg.drawImage(mon, 0, 0, W, H); cg.restore(); cg.filter = 'none';
  const gr = cg.createLinearGradient(0, 380, 0, 1300); gr.addColorStop(0, 'rgba(201,31,55,0.97)'); gr.addColorStop(0.75, 'rgba(201,31,55,0.97)'); gr.addColorStop(1, 'rgba(201,31,55,0)');
  cg.fillStyle = gr; cg.fillRect(0, 0, W, 1300);
  const a = ease.outExpo(clamp(age / 0.3)), s = 250 * (1 + 0.3 * Math.exp(-age * 8));
  sigil(cg, W / 2, 640, s, { color: '#fbf3e4', accent: '#0d0a09', alpha: a, tagline: false });
  line(cg, 'OWN THE FUTURE', W / 2, 960, { size: 150, color: '#fbf3e4', alpha: clamp((age - 0.25) * 5), maxW: W - 120 });
  line(cg, 'ACP.US', W / 2, 1110, { family: 'Archivo Black', size: 96, color: '#0d0a09', alpha: clamp((age - 0.45) * 5) });
  return comp;
}
// the ACP mark / a disc as mask shapes (white on clear)
const markMask = document.createElement('canvas'); markMask.width = 540; markMask.height = 960; {
  const g = markMask.getContext('2d'), M = BRAND.acp_mark, s = 460, w = M.width * s / M.height;
  g.drawImage(tinted(M, '#fff'), 270 - w / 2, 330 - s / 2, w, s);
}
const discMask = document.createElement('canvas'); discMask.width = 540; discMask.height = 960; {
  const g = discMask.getContext('2d'); g.fillStyle = '#fff'; g.beginPath(); g.arc(270, 760, 190, 0, Math.PI * 2); g.fill();
}

// ================================================================ the presses (one per segment)
const SEG = [
  [0, 'SOURCE', 'three.js procession, raw'], [6, 'INTAGLIO', 'burin lines on the objects · camera moves'],
  [12, 'CMYK', 'halftone · GCR, 4 screens, misregistration'], [18, 'WOODCUT', 'carved masses · gouges follow the form'],
  [24, 'LINOCUT', 'two blocks · red + black'], [30, 'RISO', 'spot separation · grain · drum drift'],
  [36, 'LETTERPRESS', 'two passes · deboss · squeeze'], [40, 'BLEED', 'ink wicking along the fibre'],
  [44, 'COLLAGE', 'torn sheets · cached layer · shaped tear'], [52, 'ONE PRESS PER BEAT', ''], [60, '', '']];
const BEAT_SUB = ['engraving · uv isolines', 'riso · red + black', 'woodcut · close', 'white line · cream on black',
  'cmyk · screens in uv space', 'lino white-line layer over live 3D', 'riso masked to the mark', 'gold foil on black'];
const segAt = b => { let s = SEG[0]; for (const x of SEG) if (b >= x[0]) s = x; return s; };

const PREP = (o = {}) => ({ subject: 'aux', simplify: 10, boost: 0.5, clear: 0.6, mid: 0.5, ...o });
const ENG = (o = {}) => ['engrave', { pitch: 8, plate: 0.25, angle: Math.PI / 2, contour: 0.9, ...o }];
const HT = (o = {}) => ['halftone', { cell: 10, misreg: 2.5, ...o }];
const WOOD = (o = {}) => ['woodcut', { t1: 0.34, t2: 0.7, pitch: 13, jag: 0.6, chisel: 0.5, angle: Math.PI / 2, ...o }];
const LINO = (o = {}) => ['woodcut', { lino: 1, two: 1, t1: 0.3, t2: 0.62, pitch: 14, jag: 0.4, angle: Math.PI / 2, ink: 'carbon', ink2: 'acp', ...o }];
const RISO = (o = {}) => ['riso', { inks: ['brightRed', 'federal'], misreg: 5, grain: 2, ...o }];

async function frame(t) {
  const beat = B.beat(t);
  const kick = Math.max(B.env('kick', t, 10), 0.8 * B.env('taiko', t, 9)), imp = B.env('impact', t, 5);
  const [s0, name, sub0] = segAt(beat), age = beat - s0;
  let sub = sub0;
  const T0 = performance.now();
  let three = 0;
  const sync = (g) => g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, new Uint8Array(4));   // GPU sync so the ms/frame log is honest
  const mon = (o) => { const a = performance.now(); const c = world.update(t, o); sync(renderer.getContext()); three += performance.now() - a; return c; };
  const aux = () => { const a = performance.now(); const x = gb.read(world.scene, world.camera); three += performance.now() - a; return x; };
  const swing = 0.22 * Math.sin(t * 0.45);

  if (beat < 6) {                                           // SOURCE, then the burin cuts the plate top-down
    const src = mon({ dist: 8, orbit: swing }), u = ease.inOutCubic(clamp((beat - 2) / 4));
    ctx.drawImage(src, 0, 0, W, H);
    if (u > 0) {
      pr.render(null, src, [ENG()], { t, aux: aux(), prep: PREP(), paper: 'cream' });
      const y = u * (H + 240) - 120;
      ctx.save(); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W, y - 120); ctx.lineTo(0, y + 120); ctx.clip();
      pr.draw(ctx); ctx.restore();
      ctx.strokeStyle = C.red2; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(0, y + 120); ctx.lineTo(W, y - 120); ctx.stroke();
    }
  } else if (beat < 12) {                                   // intaglio on a moving camera: the lines stay on the figures
    const src = mon({ dist: 6.5, orbit: swing, look: 0.3 });
    pr.render(ctx, src, [ENG({ wash: 0.3 + clamp((beat - 8.5) / 2) * 0.45, mark: beat > 9 ? 34 : 0 })], { t, aux: aux(), prep: PREP(), paper: 'cream', out: null });
  } else if (beat < 18) {
    const src = mon({ dist: 5 - 3 * kick, orbit: -0.12 + swing * 0.5, look: 0.28 });
    const big = beat >= 16 ? ease.outExpo(clamp((beat - 16) / 0.5)) : 0;
    pr.render(ctx, src, [HT({ cell: lerp(10, 24, big), misreg: 2 + 8 * kick, gain: 0.1, space: beat >= 14.5 ? 'uv' : 'screen' })],
      { t, aux: aux(), prep: PREP({ simplify: 6, clear: 0.25, mid: 0.48 }), paper: 'newsprint', out: null });
    if (beat >= 14.5) sub = 'halftone · screens printed on the objects';
  } else if (beat < 24) {                                    // woodcut: low and close in the front rank
    const src = mon({ dist: 3.2, lift: 1.25, orbit: 0.3 + swing * 0.6, fov: 44, look: 0.3 });
    pr.render(ctx, src, [WOOD()], { t, aux: aux(), prep: PREP({ simplify: 16, boost: 0.7, clear: 0.75, mid: 0.46 }), paper: 'ivory', out: null });
  } else if (beat < 30) {                                    // linocut: low and wide, the sun as the red block's hole
    const src = mon({ dist: 12, lift: 0.7, orbit: -0.25 + swing * 0.3, fov: 46, look: 0.42 });
    pr.render(ctx, src, [LINO({ off2: [4 + 10 * kick, -3] })], { t, aux: aux(), prep: PREP({ simplify: 16, boost: 0.6, clear: 0.35, mid: 0.5 }), paper: 'cream', out: null });
  } else if (beat < 36) {
    const src = mon({ dist: 5.5, side: -2, orbit: 0.15 + swing * 0.4, look: 0.33 });
    const three_ = beat >= 33;
    pr.render(ctx, src, [RISO({ inks: three_ ? ['risoYellow', 'brightRed', 'federal'] : ['brightRed', 'federal'], misreg: 4 + 14 * kick, contrast: 1.25 })],
      { t, aux: aux(), prep: PREP({ simplify: 8, clear: 0.08, mid: 0.5 }), paper: 'ivory', out: null });
  } else if (beat < 40) {                                    // two-colour letterpress broadside (type needs no prep)
    const m = mon({ dist: 9, lift: 1.1, look: 0.4 });
    pr.src(broadside('red', m, age)); pr.run([['letterpress', { ink: 'acp', thr: 0.5 }]], { t, paper: 'cotton', out: 'lpRed', aux: null });
    pr.src(broadside('black', m, age)); pr.run([['letterpress', { ink: 'black', thr: 0.5, onto: 'lpRed', screen: 9 }]], { t, paper: 'cotton' });
    pr.draw(ctx, pr.last);
  } else if (beat < 44) {                                    // the break: a red engraving drinks ink along the fibre
    const src = mon({ dist: 4, lift: 1.7, orbit: 0.25 + swing * 0.3, look: 0.5, fov: 40 });
    const g = ease.outCubic(clamp(age / 4));
    pr.render(ctx, src, [ENG({ pitch: 9, ink: 'acp', stipple: 0.5, plate: 0.15 }), ['bleed', { radius: 2 + 7 * g, amount: 0.2 + 0.3 * g, wet: 1 }]],
      { t, aux: aux(), prep: PREP({ clear: 0.8, mid: 0.55 }), paper: 'rag', boil: 0, out: null });
  } else if (beat < 52) {                                    // torn collage: sheets land on the beat; landed sheets live in one
                                                             // cached layer (a finished print is frozen paper)
    const sheets = [
      [44, tt => pr.render(null, photo(0, world.update(tt, { dist: 3, lift: 1.4, orbit: 0.3, fov: 50, look: 0.2 }), 1, 1, [30, 130, 1050, 760]), [RISO({ misreg: 6, contrast: 1.3 })], { t: tt, aux: null, prep: { simplify: 10 }, paper: 'ivory', out: 'sh0' }), { rect: [30, 130, 1050, 760], rot: -0.035 }],
      [46, tt => pr.render(null, photo(0.3, hardhat, 1.0, 1.0, [-40, 640, 640, 1420]), [RISO({ inks: ['#c91f37', 'risoBlack'], misreg: 4, contrast: 1.3 })], { t: tt, aux: null, levels: 'auto', paper: 'ivory', out: 'sh1' }), { rect: [-40, 640, 640, 1420], rot: 0.05 }],
      [48, tt => pr.render(null, photo(0, world.update(tt, { dist: 30, lift: 3, fov: 22, look: 0.66 }), 1, 1, [420, 560, 1120, 1330]), [ENG({ ink: 'sepia', wash: 0.5, angle: 0.5 })], { t: tt, aux: null, prep: { simplify: 8, levels: [0.02, 0.75, 0.8] }, paper: 'cream', out: 'sh2' }), { rect: [420, 560, 1120, 1330], rot: -0.06 }],
      [50, tt => pr.render(null, photo(0.6, fortress, 1.0, 1.0, [0, 1120, 1080, 1920]), [HT({ cell: 11, misreg: 3 })], { t: tt, aux: null, levels: 'auto', paper: 'newsprint', out: 'sh3' }), { mask: discMask, tear: 22 }],
    ];
    const landed = sheets.filter(([b]) => beat >= b + 0.35).length;
    for (const [i, [b, make]] of sheets.entries()) if (beat >= b && !SHEETS['sh' + i]) { make(b * B.spb); SHEETS['sh' + i] = 1; }
    const m = mon({ dist: 10, lift: 2.5, look: 0.45, orbit: swing * 0.4 });   // after the sheets: they re-render the shared 3D canvas
    if (SHEETS.layerN !== landed) {                           // rebuild the landed layer (only when a sheet lands, or on a cold seek)
      let under = 'clear';
      for (let i = 0; i < landed; i++) { const o = sheets[i][2], outN = i % 2 ? 'lyB' : 'lyA';
        pr.src('sh' + i); pr.run([['torn', { ...o, below: under, tear: o.tear || 16, rim: 8, shadow: 0.55 }]], { t: 0, out: outN }); under = outN; }
      SHEETS.layer = under; SHEETS.layerN = landed;
    }
    pr.render(null, m, [HT({ kOnly: 1, cell: 9 })], { t, aux: null, levels: 'auto', paper: 'kraft', out: 'bgA' });
    let top = 'bgA';
    if (landed) { pr.src(SHEETS.layer); pr.run([['over', { below: 'bgA' }]], { t, out: 'bgB' }); top = 'bgB'; }
    const k = sheets.findIndex(([b]) => beat >= b && beat < b + 0.35);
    if (k >= 0) {                                              // the sheet in the air, torn live over the rest
      const [b, , o] = sheets[k], land = ease.outBack(clamp((beat - b) / 0.35)), drop = (1 - land) * 140;
      const oo = o.rect ? { rect: [o.rect[0], o.rect[1] - drop, o.rect[2], o.rect[3] - drop], rot: o.rot * (0.6 + 0.4 * land) } : { mask: o.mask };
      pr.src('sh' + k); pr.run([['torn', { ...oo, shift: [0, -drop], below: top, tear: o.tear || 16, rim: 8, shadow: 0.55 + 0.3 * (1 - land) }]], { t, out: top === 'bgA' ? 'bgB' : 'bgA' });
    }
    pr.draw(ctx, pr.last);
  } else if (beat < 60) {                                    // one press per beat
    const k = Math.floor(beat - 52); sub = BEAT_SUB[k];
    const view = { dist: 4 + k * 0.8, orbit: (k % 2 ? -1 : 1) * 0.2 + swing * 0.5, look: 0.3 + 0.02 * k, lift: 1.3 };
    if (k === 0) pr.render(ctx, mon(view), [ENG({ wash: 0.4 })], { t, aux: aux(), prep: PREP(), paper: 'cream', out: null });
    else if (k === 1) pr.render(ctx, photo(clamp((beat - 52) / 8)), [RISO({ inks: ['#c91f37', 'risoBlack'], misreg: 6 * kick + 2, contrast: 1.3 })], { t, aux: null, levels: 'auto', paper: 'ivory', out: null });
    else if (k === 2) pr.render(ctx, mon({ ...view, dist: 3, fov: 44 }), [WOOD()], { t, aux: aux(), prep: PREP({ simplify: 16, boost: 0.7, clear: 0.75, mid: 0.46 }), paper: 'ivory', out: null });
    else if (k === 3) pr.render(ctx, mon(view), [ENG({ ink: 'cream', opaque: true, plate: 0, stipple: 0.6 })],       // white-line: the lights are cut, cream on black
      { t, aux: aux(), prep: PREP({ negative: true, clear: 0.92, mid: 0.55 }), paper: 'black', out: null });
    else if (k === 4) pr.render(ctx, mon(view), [HT({ cell: 12, misreg: 8 * kick + 2, space: 'uv' })], { t, aux: aux(), prep: PREP({ simplify: 6, clear: 0.2 }), paper: 'newsprint', out: null });
    else if (k === 5) {                                       // an ink layer over the live colour render: mixed media, not a filter
      const src = mon({ ...view, dist: 3.5 });
      ctx.drawImage(src, 0, 0, W, H);
      pr.render(ctx, src, [LINO({ alpha: 'ink', two: 0, ink: 'cream', opaque: true, t1: 0.42, t2: 0.75 })], { t, aux: aux(), prep: PREP({ simplify: 14, clear: 0.85, negative: true }), paper: 'ivory', out: null });
    } else if (k === 6) {                                     // woodcut key, then a riso overprint limited to the ACP mark
      const src = mon(view);
      pr.render(null, src, [WOOD({ t1: 0.3 })], { t, aux: aux(), prep: PREP({ simplify: 14, clear: 0.7 }), paper: 'ivory', out: 'wk' });
      pr.run([RISO({ inks: ['risoYellow', 'brightRed'], onto: 'wk', mask: { src: markMask, channel: 'a' }, misreg: 3 + 6 * kick, contrast: 1.4, amount: 1.1 })], { t, prep: PREP({ simplify: 6, clear: 0 }) });
      pr.draw(ctx, pr.last);
    } else pr.render(ctx, mon({ ...view, dist: 3.4, fov: 44 }), [WOOD({ ink: 'foil', foil: true, t1: 0.3, t2: 0.66, grain: 0.6 })],   // gold foil stamped on black stock
      { t, aux: aux(), prep: PREP({ simplify: 16, clear: 0.85, mid: 0.5 }), paper: 'black', out: null });
  } else {                                                    // printed closer: the plates register on the hit
    const age2 = (beat - 60) * B.spb;
    const r = 26 * Math.exp(-age2 * 3.2) + 1.2;
    const m = mon({ dist: 14, lift: 0.8, look: 0.4, fov: 46 });
    pr.render(ctx, closerSrc(age2, m), [RISO({ inks: ['#c91f37', 'risoBlack'], misreg: r, grain: 2, contrast: 1.35, uneven: 0.6 })], { t, aux: null, levels: [0, 1, 1], paper: 'ivory', out: null });
  }
  const T1 = performance.now();
  if (name) {
    const idx = SEG.findIndex(x => x[0] === s0);
    ctx.save(); ctx.globalAlpha = 0.92; ctx.fillStyle = '#0d0a09'; ctx.fillRect(40, 60, 640, sub ? 104 : 62); ctx.restore();
    line(ctx, `PRINT.JS  ${String(idx).padStart(2, '0')}  ${name}`, 60, 106, { family: 'Plex Mono', size: 34, color: C.cream, align: 'left', maxW: 600 });
    if (sub) line(ctx, sub, 60, 148, { family: 'Plex Mono', size: 24, color: '#e8a08c', align: 'left', maxW: 600 });
  }
  if (imp > 0.9 && beat > 43 && beat < 45) { ctx.fillStyle = 'rgba(244,230,208,0.3)'; ctx.fillRect(0, 0, W, H); }
  ctx.getImageData(0, 0, 1, 1);
  PERF.n++; PERF.three += three; PERF.print += T1 - T0 - three; PERF.total += performance.now() - T0;
  if (pr.profile) { console.log('passes', JSON.stringify(Object.fromEntries(Object.entries(pr.prof || {}).map(([k, v]) => [k, Math.round(v)]))), 'gbuf', Math.round(gb.ms), 'levels', JSON.stringify(pr.stats.levels)); pr.prof = {}; }
  console.log(`perf t=${t.toFixed(2)} beat=${beat.toFixed(1)} three+gbuf=${three.toFixed(0)}ms print+comp=${(T1 - T0 - three).toFixed(0)}ms total=${(performance.now() - T0).toFixed(0)}ms`);
}
window.renderFrame = frame;
window.PERF = PERF;
window.sceneReady = true;
