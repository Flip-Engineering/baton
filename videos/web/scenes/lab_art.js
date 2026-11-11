// LAB / ART (studio cycle 1): the PRESS & FURNACE kit (lib/fx/art/*) shown as shots, sheets and a reel.
//   ?shot=pour|pour_mono|...   window.renderFrame(t) -> { ms, info }
// See research/capabilities/art.md and research/STYLE_BIBLE.md.
import { loadFonts } from '../lib/kit.js';
import { Stage } from '../lib/fx/folk_worlds.js';
import { foundryShot } from '../lib/fx/art/foundry.js';
import * as THREE from 'three';
import { buildLadle, buildBail, buildHook } from '../lib/fx/art/ladle.js';
import { MoltenPool } from '../lib/fx/art/molten.js';
import { buildTruck } from '../lib/fx/art/bucket.js';
import { bannerShot } from '../lib/fx/art/banner.js';
import { bucketShot } from '../lib/fx/art/bucket.js';
import { valueStats } from '../lib/fx/art/tokens.js';
import { grade, silkscreen } from '../lib/fx/art/grade.js';
import { loadArtFonts, FACES, slam, stripeRule, closerFromRule } from '../lib/fx/art/slam.js';
import { impactFrame, debris } from '../lib/fx/art/impact.js';
import { ladleWipe, platePull, platen, shimmer } from '../lib/fx/art/transitions.js';
import { M } from '../lib/fx/art/motion.js';
import { INK, HEAT, DIALECTS, VALUE } from '../lib/fx/art/tokens.js';
import { paperFinish } from '../lib/fx/art/intaglio3d.js';

const Q = new URLSearchParams(location.search);
const SHOT = Q.get('shot') || 'pour';
const W = 1080, H = 1920;
const out = document.getElementById('out'), ctx = out.getContext('2d');
const num = (k, d) => (Q.has(k) ? +Q.get(k) : d);

const SHOTS = {};
SHOTS.engraved = async () => { const st = new Stage({ W, H }); await st.init();
  const s = await foundryShot(st, { cam: Q.get('cam') || 'bank', tilt: num('tilt', 0.5), engraved: { lpm: num('lpm', 30), exposure: num('expo', 1.6), gamma: num('gamma', 1.0) } });
  return t => { const c = s.frame(t); ctx.drawImage(c, 0, 0); paperFinish(ctx, {}); return {}; }; };
SHOTS.banner = async () => { const st = new Stage({ W, H }); await st.init();
  const s = await bannerShot(st, { cam: Q.get('cam') || 'low', t0: num('t0', 0), t1: num('t1', 6) });
  return t => { grade(out, s.frame(t), t, { dialect: 'furnace', halo: 0.4 }); return {}; }; };
SHOTS.bucket = async () => { const st = new Stage({ W, H }); await st.init();
  const s = await bucketShot(st, { cam: Q.get('cam') || 'storm' });
  return t => { grade(out, s.frame(t), t, { dialect: 'furnace', halo: 0.5 }); return {}; }; };
// ---------------------------------------------------------------- THE REEL: 6.0-19.6 s of IRON's frontier3 song
// Plates (3D, on twos) come from out/.pcache/art/{pour,eng,ban}/ (lab_art ?shot=pour|engraved|banner); everything else
// is the kit's 2D grammar on top. Words are IRON's own script lines at their own hits (hits.json 'text').
const mkc = () => Object.assign(document.createElement('canvas'), { width: W, height: H });
const imgCache = new Map();
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('missing plate ' + src)); i.src = src; });
async function plate(dir, tag, start, t) {
  const i = Math.max(0, Math.floor((t - start) * 15 + 1e-6)), tp = Math.round((start + i / 15) * 1e4) / 1e4, src = `../../out/.pcache/art/${dir}/${tag}_${tp.toFixed(2)}.jpg`;
  if (!imgCache.has(src)) { if (imgCache.size > 12) imgCache.delete(imgCache.keys().next().value); imgCache.set(src, await loadImg(src)); }
  const c = mkc(); c.getContext('2d').drawImage(imgCache.get(src), 0, 0); return c;
}
SHOTS.reel = async () => {
  await loadArtFonts();
  const tmp = mkc();
  const SPLASH = [690, 1640];
  const seg = async t => {                               // the underlying picture at t (before type)
    if (t < 7.5) return plate('pour', 'p', 6.0, t);
    if (t < 10.5) { const c = mkc(); grade(c, await plate('pour', 'p', 6.0, t), t, { dialect: 'newsreel', halo: 0.6, grain: 0.8 }); return c; }
    if (t < 12.0) return plate('eng', 'e', 10.0, t);
    if (t < 15.0) return plate('ban', 'b', 11.4, t);
    const c = mkc(); const f = M.rel(t, 15.0), k = Math.max(0.25, 1 - f / 6);
    silkscreen(c, await plate('pour', 'p', 15.0, Math.min(t, 18.53)), t, { reg: [[-10 * k, 6 * k], [3 * k, -2 * k], [12 * k, 8 * k]] }); return c;
  };
  return async t => {
    const info = {};
    // transitions own the frame around their hits
    if (t >= 7.2 && t < 7.5 + 11 / 30) { shimmer(ctx, t < 7.5 ? await seg(7.2 + (t - 7.2)) : await seg(t), await seg(Math.max(7.5, t)), t, { t0: 7.2, hit: 7.5, amp: 30 }); info.tr = 'shimmer'; }
    else if (t >= 10.1 && t < 10.5 + 7 / 30) { platePull(ctx, await plate('pour', 'p', 6.0, Math.min(t, 10.45)) , await seg(Math.max(10.5, t)), t, { t0: 10.1, hit: 10.5, ink: 'red' }); info.tr = 'platePull'; }
    else if (t >= 11.55 && t < 12.0 + 9 / 30) { ladleWipe(ctx, await plate('eng', 'e', 10.0, Math.min(t, 11.99)), await plate('ban', 'b', 11.4, t), t, { t0: 11.55, hit: 12.0 }); info.tr = 'ladleWipe'; }
    else if (t >= 14.75 && t < 15.0 + 9 / 30) { const s2 = await seg(Math.max(15.0, t)); platen(ctx, await plate('ban', 'b', 11.4, Math.min(t, 14.99)), s2, t, { t0: 14.75, hit: 15.0 }); info.tr = 'platen'; }
    else ctx.drawImage(await seg(t), 0, 0);
    // the struck plate kicks the frame on each word hit (M.shake: one hard frame, decaying on twos)
    { let kx = 0, ky = 0; for (const h of [7.5, 10.5, 15.0, 17.25, 18.0, 18.5]) { const [a, b] = M.shake(t, h, 22, h * 7); kx += a; ky += b; }
      if (kx || ky) { const c = mkc(); c.getContext('2d').drawImage(out, 0, 0); ctx.fillStyle = INK.ink; ctx.fillRect(0, 0, W, H); ctx.drawImage(c, kx, ky); } }
    // impacts on the song's own hits
    if (impactFrame(ctx, t, { hit: 6.0, inks: ['oxide', 'stock'], thr: 0.3 })) info.impact = 6.0;
    debris(ctx, t, { hit: 6.0, origin: SPLASH, kind: 'sparks', n: 90, speed: 1900 });
    if (impactFrame(ctx, t, { hit: 12.75, inks: ['ink', 'red'], thr: 0.16 })) info.impact = 12.75;
    debris(ctx, t, { hit: 12.75, origin: [560, 1500], kind: 'chips', n: 50, speed: 1500, inkC: 'ink' });
    if (impactFrame(ctx, t, { hit: 16.5, inks: ['ink', 'cyan'], thr: 0.3 })) info.impact = 16.5;
    debris(ctx, t, { hit: 16.5, origin: [540, 700], kind: 'toner', n: 70, speed: 1300, spread: Math.PI * 1.6, inkC: 'red' });
    // words: IRON's script at its own hits
    slam(ctx, t, { lines: ['HOTTER.'], hit: 6.0, out: 7.4, x: 60, y: 900, size: 330, face: FACES.furnace, plate: 'stock', red: [0], seed: 1 });
    slam(ctx, t, { lines: ['30,000', 'STRONG.'], hit: 7.5, out: 10.0, x: 80, y: 1150, size: 250, face: FACES.furnace, plate: 'stock', seed: 2 });
    slam(ctx, t, { lines: ['MORE', 'IRON.'], hit: 10.5, out: 11.5, x: 70, y: 930, size: 250, face: FACES.bank, plate: 'ink', red: [1], redPlate: 'red', seed: 3 });
    slam(ctx, t, { lines: ['RED', 'HOT.'], hit: 12.0, out: 14.7, x: 90, y: 1100, size: 360, face: FACES.stencil, plate: 'stock', seed: 4 });
    slam(ctx, t, { lines: ['ALL', 'HANDS.'], hit: 16.5, out: 17.15, x: 70, y: 260, size: 300, face: FACES.press, plate: 'stock', seed: 5 });
    slam(ctx, t, { lines: ['ALL', 'HANDS.'], hit: 17.25, out: 17.95, x: 60, y: 240, size: 340, face: FACES.press, plate: 'stock', red: [1], redPlate: 'red', seed: 6 });
    const wh = slam(ctx, t, { lines: ['WHITE', 'HOT.'], hit: 18.0, out: 99, x: 70, y: 260, size: 330, face: FACES.press, plate: 'stock', seed: 7 });
    const rule = { x: 76, y: 880, w: 900, h: 70 };
    if (t >= 18.0) stripeRule(ctx, t, { hit: 18.0 + 3 / 30, ...rule, ink: 'red' });
    closerFromRule(ctx, t, { hit: 18.5, from: rule, band: 'red', ink: 'stock' });
    return info;
  };
};
// ---------------------------------------------------------------- THE STYLE BIBLE SHEET (two 1080x1920 pages)
SHOTS.bible = async () => {
  await loadArtFonts();
  const I = INK;
  const page = +(Q.get('page') || 1), g = ctx;
  const txt = (s, x, y, { f = 'Plex Mono', size = 22, c = I.ink, w = 400, align = 'left' } = {}) => { g.font = `${w} ${size}px "${f}"`; g.fillStyle = c; g.textAlign = align; g.fillText(s, x, y); g.textAlign = 'left'; };
  const head = (s, y) => { g.fillStyle = I.ink; g.fillRect(60, y - 44, 960, 3); txt(s, 60, y, { f: 'Archivo Black', size: 34 }); };
  const key = async n => loadImg(`../../review/studio_art_c1/before/key/${n}.jpg`);
  const aft = async n => loadImg(`../../review/studio_art_c1/after/raw/${n}.jpg`).catch(() => null);
  const cell = (im, x, y, w, h) => { if (!im) { g.fillStyle = '#ccc'; g.fillRect(x, y, w, h); return; } const s2 = Math.max(w / im.width, h / im.height), sw = w / s2, sh = h / s2; g.drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, x, y, w, h); };
  return async t => {
    g.fillStyle = I.stock; g.fillRect(0, 0, W, H);
    if (page === 1) {
      txt('PRESS & FURNACE', 60, 120, { f: 'Archivo Black', size: 76 });
      txt('a way of making, not a look: every frame printed, engraved, cast, struck or poured', 60, 165, { size: 19 });
      head('1  INKS  (a piece uses <= 4, always stock or ink)', 250);
      Object.entries(I).forEach(([k, v], i) => { const x = 60 + i * 162; g.fillStyle = v; g.fillRect(x, 275, 150, 150); g.strokeStyle = I.ink; g.lineWidth = 1; g.strokeRect(x + 0.5, 275.5, 149, 149); txt(k, x, 455, { size: 20, w: 700 }); txt(v, x, 480, { size: 18 }); });
      // heat ramp: the only unscreened gradient, emissive matter only
      const gr = g.createLinearGradient(60, 0, 1020, 0); HEAT.forEach(([k, c]) => gr.addColorStop((k - 700) / 1300, c)); g.fillStyle = gr; g.fillRect(60, 510, 960, 60);
      HEAT.forEach(([k]) => txt(k + ' K', 60 + (k - 700) / 1300 * 900, 598, { size: 17 }));
      txt('heat ramp: blackbody, emissive matter only (pour, sparks, arc, sun limb) - the one gradient allowed', 60, 628, { size: 17 });
      head('2  VALUE', 710);
      [[0.12, 'ink / shadow group'], [0.5, 'mid group'], [0.9, 'light group']].forEach(([v, n], i) => { const c = Math.round(v * 255); g.fillStyle = `rgb(${c},${c * 0.96 | 0},${c * 0.88 | 0})`; g.fillRect(60 + i * 320, 735, 300, 90); txt(n + '  >= 15%', 60 + i * 320, 850, { size: 18 }); });
      txt(`per frame: <= ${VALUE.maxDark * 100}% below luma ${VALUE.darkLuma}   per slate of 8 signature frames: >= ${VALUE.slateHighKeyMin} high key (mean >= ${VALUE.highKey})`, 60, 885, { size: 17 });
      txt('the hero is the brightest, highest-contrast value; light comes from a source in frame', 60, 910, { size: 17 });
      head('3  DIALECTS  (one medium and one light per piece)', 990);
      Object.entries(DIALECTS).forEach(([k, d], i) => { const y = 1030 + i * 58; txt(k.toUpperCase(), 60, y + 22, { f: 'Archivo Black', size: 22 });
        d.inks.forEach((ik, j) => { g.fillStyle = I[ik]; g.fillRect(230 + j * 30, y, 26, 26); g.strokeStyle = I.ink; g.lineWidth = 1; g.strokeRect(230.5 + j * 30, y + 0.5, 25, 25); });
        txt(d.mark, 390, y + 12, { size: 15 }); txt(d.pieces.join(', '), 390, y + 32, { size: 15, c: I.oxide }); });
      head('4  TYPE  (the word is a printed object)', 1470);
      const F = FACES; const rows = [['furnace', "IRON'S HOT.", 'Big Shoulders 900: IRON, MECHA'], ['press', 'EVERY SOLDIER BUILDS.', 'Archivo Black: CIVILIZATION, ALL POWER'], ['bank', 'BACKED BY STEEL.', 'Playfair 900: BANK, 1776'], ['stencil', 'OURS.', 'Big Shoulders Stencil: RED WEDGE'], ['poster', 'THE GIANT.', 'Anton: THE GIANT only']];
      rows.forEach(([k, s2, n], i) => { const y = 1545 + i * 62; g.font = `${F[k].weight} ${k === 'press' ? 44 : 56}px "${F[k].family}"`; g.fillStyle = k === 'bank' ? I.ink : i % 2 ? I.red : I.ink; g.fillText(s2, 60, y); txt(n, 700, y - 10, { size: 15 }); });
      txt('NO shadow  NO glow  NO keyline  NO bevel  (gate fail on the published slate)', 60, 1880, { size: 20, w: 700, c: I.red });
    } else {
      txt('PRESS & FURNACE / motion and references', 60, 90, { f: 'Archivo Black', size: 40 });
      head('5  MOTION: things strike, land and settle', 170);
      // curve graphs
      const graph = (x, y, w, h, fn, name, n = 20) => { g.strokeStyle = I.steel; g.lineWidth = 1; g.strokeRect(x, y, w, h); g.strokeStyle = I.red; g.lineWidth = 3; g.beginPath();
        for (let i = 0; i <= n; i++) { const u = i / n, v = fn(u); const px = x + u * w, py = y + h - v * h * 0.8 - h * 0.1; i ? g.lineTo(px, py) : g.moveTo(px, py); } g.stroke(); txt(name, x, y + h + 24, { size: 17, w: 700 }); };
      const C2 = M.curve;
      graph(60, 195, 220, 130, u => C2.press(u), 'press (slow-fast-stop)', 60);
      graph(310, 195, 220, 130, u => C2.lift(u), 'lift (off the paper)', 60);
      graph(560, 195, 220, 130, u => C2.pour(u), 'pour (g)', 60);
      graph(810, 195, 210, 130, u => C2.whip(u) / 1.3, 'whip (cloth)', 60);
      // strike + land as frame bars (on twos, frames -4..+10)
      txt('strike -> contact -> land -> settle, per frame (hit = frame 0)', 60, 400, { size: 17 });
      for (let f = -4; f <= 10; f++) { const tt = (f + 30) / 30, st2 = M.strike(tt, 1), en = M.enter(tt, 1), ld = M.land(tt, 1); const x = 60 + (f + 4) * 64;
        const sc = en.s * (1 + ld.overshoot) , sq = ld.squash; g.fillStyle = f === 0 ? I.red : I.ink; const bw = 44 * sc * (1 + sq), bh = 60 * sc * (1 - sq); g.fillRect(x + 22 - bw / 2, 470 - bh / 2, bw, bh); txt(String(f), x + 14, 530, { size: 15 }); }
      // slam strip: frames -3..+8 of a real slam (the kit's own slam(), scaled into cells)
      head('6  THE CHANT SLAM (TYPE x PRINT)', 610);
      const cellC = Object.assign(document.createElement('canvas'), { width: W, height: 760 }), cg = cellC.getContext('2d');
      [-3, -1, 0, 1, 2, 4, 9, 40].forEach((f, i) => { cg.fillStyle = I.stock; cg.fillRect(0, 0, W, 760); const tt = 1 + f / 30;
        slam(cg, tt, { lines: ['OUR', 'STEEL.'], hit: 1, out: 2.3, x: 60, y: 120, size: 300, face: FACES.press, plate: 'ink', red: [1], seed: 3 });
        g.drawImage(cellC, 60 + (i % 8) * 120, 640, 116, 82); txt(f === 40 ? 'lift' : 'f' + f, 60 + (i % 8) * 120, 745, { size: 14 }); });
      // transition strips
      head('7  TRANSITIONS ARE PHYSICAL ACTS', 830);
      const A = await key('IRON_IS_HOT_v9_26.5'), B = await key('CIVILIZATION_v7_29.0');
      const cA = mkc(), cB = mkc(); cA.getContext('2d').drawImage(A, 0, 0, W, H); cB.getContext('2d').drawImage(B, 0, 0, W, H);
      const tr = [['ladle wipe (house signature)', (c, tt) => ladleWipe(c, cA, cB, tt, { t0: 0, hit: 1 })], ['plate pull', (c, tt) => platePull(c, cA, cB, tt, { t0: 0, hit: 1 })], ['platen', (c, tt) => platen(c, cA, cB, tt, { t0: 0, hit: 1 })]];
      const big = mkc(), bg = big.getContext('2d');
      tr.forEach(([n, fn], r) => { txt(n, 60, 870 + r * 250, { size: 17, w: 700 }); [0.3, 0.5, 0.7, 0.85, 1.0, 1.15].forEach((u, i) => { bg.clearRect(0, 0, W, H); fn(bg, Math.round(u * 30) / 30); g.drawImage(big, 60 + i * 162, 880 + r * 250, 120, 213); }); });
      head('8  DO / DON\'T (our own frames)', 1650);
      const dos = [['CIVILIZATION_v7_29.0', 'DO newsprint'], ['PEOPLES_BANK_v7_1.0', 'DO engraving'], ['IRON_IS_HOT_v9_26.5', 'DO silkscreen'], ['HORDE_v12_22.5', 'DO crowd close']];
      const donts = [['HORDE_v12_8.0', "DON'T disc+sil."], ['IRON_IS_HOT_v9_0.5', "DON'T tube pour"], ['IRON_IS_HOT_v9_21.5', "DON'T cotton blast"], ['PEOPLES_BANK_v7_21.0', "DON'T stick men"]];
      for (let i = 0; i < 4; i++) { cell(await key(dos[i][0]), 60 + i * 240, 1670, 110, 170); txt(dos[i][1], 60 + i * 240, 1862, { size: 13, w: 700 }); cell(await key(donts[i][0]), 180 + i * 240, 1670, 110, 170); txt(donts[i][1], 180 + i * 240, 1880, { size: 13, w: 700, c: I.red }); }
    }
    return {};
  };
};
// ---------------------------------------------------------------- BEFORE/AFTER key shots (after = the kit's render)
SHOTS.key = async () => {
  await loadArtFonts();
  const which = Q.get('which') || 'iron', st = new Stage(which === 'bank' ? { W: 1080, H: 1080 } : { W, H }); await st.init();
  const hitAt = t => t - 0.6;          // the word has landed and settled
  if (which === 'iron') {
    const s = await foundryShot(st, { cam: 'hook', tilt: 0.5, mono: 1 });
    return t => { grade(out, s.frame(t), t, { dialect: 'newsreel', halo: 0.8 });
      slam(ctx, t, { lines: ["IRON'S", 'HOT.'], hit: hitAt(t), x: 64, y: 980, size: 290, face: FACES.furnace, plate: 'stock', seed: 2 }); return {}; };
  }
  if (which === 'bank') {
    const base = await loadImg('../../review/studio_art_c1/before/key/PEOPLES_BANK_v7_21.0.jpg');
    const s = await foundryShot(st, { cam: 'bank', tilt: 0.5, engraved: { lpm: 34, exposure: 1.6, gamma: 1.0 } });
    const bx = [98, 698, 870, 880];         // the note's vignette window (x, y, w, h) in the published frame
    return t => { const c = s.frame(t); ctx.drawImage(base, 0, 0, W, H);
      ctx.save(); ctx.beginPath(); ctx.roundRect(bx[0], bx[1], bx[2], bx[3], 38); ctx.clip();
      ctx.drawImage(c, 0, 0, 1080, 1080 * bx[3] / bx[2], bx[0], bx[1], bx[2], bx[3]); ctx.restore();
      // engraved sky: ruled lines on the bare paper only, closer and heavier toward the top (the plate's sky tone)
      const im = ctx.getImageData(bx[0], bx[1], bx[2], bx[3]), D = im.data;
      for (let y = 0; y < bx[3]; y++) { const k = 1 - y / bx[3], pitch = 6, onLine = (y % pitch) < (0.6 + 1.6 * k * k) ; if (!onLine) continue;
        for (let x = 0; x < bx[2]; x++) { const o = (y * bx[2] + x) * 4; if (D[o] > 225 && D[o + 1] > 215 && D[o + 2] > 190 && Math.abs(D[o] - 239) < 16) { const a = 0.55 + 0.3 * k; D[o] = D[o] * (1 - a) + 21 * a; D[o + 1] = D[o + 1] * (1 - a) + 17 * a; D[o + 2] = D[o + 2] * (1 - a) + 15 * a; } } }
      ctx.putImageData(im, bx[0], bx[1]);
      paperFinish(ctx, { region: bx }); return {}; };
  }
  if (which === 'cw') {
    const s = await bucketShot(st, { cam: 'close', lightning: [5] });
    return t => { grade(out, s.frame(t), t, { dialect: 'furnace', halo: 0.5 });
      slam(ctx, t, { lines: ['UP SHE', 'GOES.'], hit: hitAt(t), x: 64, y: 230, size: 250, face: FACES.press, plate: 'stock', seed: 4 }); return {}; };
  }
  if (which === 'horde') {
    const s = await bannerShot(st, { cam: 'low', t0: 0, t1: 4 });
    return t => { grade(out, s.frame(t), t, { dialect: 'furnace', halo: 0.3 });
      slam(ctx, t, { lines: ['ALREADY', 'HERE.'], hit: hitAt(t), x: 64, y: 820, size: 270, face: FACES.stencil, plate: 'stock', seed: 5 }); return {}; };
  }
};
// ---------------------------------------------------------------- TURNTABLE: one model, studio light, ?model=ladle|truck&ang=deg
SHOTS.turn = async () => {
  const st = new Stage({ W, H }); await st.init(); const S = st.scene, ang = num('ang', 30) * Math.PI / 180, model = Q.get('model') || 'ladle';
  S.background = new THREE.Color('#2a2420');
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#3a322c', roughness: 0.9 })); floor.receiveShadow = true; S.add(floor);
  const key = new THREE.DirectionalLight('#fff4e8', 2.4); key.position.set(-6, 10, 8); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10 }); S.add(key);
  const rim = new THREE.DirectionalLight('#ffb070', 1.6); rim.position.set(6, 5, -8); S.add(rim); S.add(new THREE.HemisphereLight('#8a8a90', '#2a2018', 0.6));
  const grp = new THREE.Group(); S.add(grp); let pool = null;
  if (model === 'ladle') { const L = buildLadle({ seed: 3 }); L.group.position.y = L.yT + 0.05; grp.add(L.group); const bail = buildBail(L); bail.position.y = L.yT + 0.05; grp.add(bail);
    pool = new MoltenPool(S, { geometry: L.surf.geometry, cool: 0.55, scale: 4.2, speed: 0.08 }); L.body.remove(L.surf); S.remove(pool.mesh); pool.mesh.position.copy(L.surf.position); pool.mesh.rotation.copy(L.surf.rotation); L.body.add(pool.mesh);
    const pl = new THREE.PointLight('#ff8a30', 20, 5, 1.5); pl.position.set(0, L.yT + 3.4, 0); grp.add(pl);
    st.lookAt(new THREE.Vector3(0, 6.3, 12.5), new THREE.Vector3(0, 2.6, 0), 36); }
  else { const T = buildTruck({ seed: 5 }); grp.add(T.group); T.amber.emissiveIntensity = 2; st.lookAt(new THREE.Vector3(0, 7, 22), new THREE.Vector3(0, 4.6, 0), 42); }
  grp.rotation.y = ang;
  st.r.toneMapping = THREE.ACESFilmicToneMapping;
  return t => { if (pool) pool.update(t); ctx.drawImage(st.renderLit(), 0, 0); return {}; };
};
// ---------------------------------------------------------------- MONUMENT FIST: HUMAN's hand (hero.js ROTFRONT) cast in bronze, or engraved
SHOTS.fist = async () => {
  const { engraveScene } = await import('../lib/fx/art/intaglio3d.js');
  const st = new Stage({ W, H }); await st.init(); const S = st.scene, eng = Q.get('eng') === '1';
  const h = st.hero({ variant: 'forge', height: 1.85, kind: 'work', shirt: '#3a3a3a', trousers: '#2a2a2a', hat: 'none', beard: 0.3, seed: 41, dirt: 0 });
  st.stand(h, { x: 0, y: 0, z: 0, turn: 0.35, t: 'bind' }); h.gesture('R', 'ROTFRONT', { fist: true, fistScale: num('fs', 1.35) }); h.update();
  // bronze: patinated in the recesses (a canvas map: green-brown mottle), polished where hands touch
  const c = Object.assign(document.createElement('canvas'), { width: 512, height: 512 }), g = c.getContext('2d'); g.fillStyle = '#7a4e26'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 900; i++) { g.fillStyle = Math.random() < 0.6 ? `rgba(40,70,52,${0.1 + 0.2 * Math.random()})` : `rgba(150,100,50,${0.1 + 0.2 * Math.random()})`; g.beginPath(); g.arc(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 14, 0, 7); g.fill(); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const bronze = new THREE.MeshStandardMaterial({ color: '#ffffff', map: tex, metalness: 0.9, roughness: 0.38 });
  h.group.traverse(o => { if (o.isMesh && o.visible) o.material = bronze; });
  S.background = new THREE.Color(eng ? INK.stock : INK.red);
  const key = new THREE.DirectionalLight('#ffe6c8', 3.2); key.position.set(-4, 6, 5); S.add(key);
  const rim = new THREE.DirectionalLight(eng ? '#ffffff' : '#ff9a60', eng ? 1.2 : 2.4); rim.position.set(5, 3, -4); S.add(rim); S.add(new THREE.HemisphereLight('#c8a080', '#301008', 0.5));
  const P = h.palm('R').palm; st.lookAt(P.clone().add(new THREE.Vector3(0.3, -0.35, 1.0)), P.clone().add(new THREE.Vector3(0.0, -0.18, 0)), 34);
  st.r.toneMapping = THREE.ACESFilmicToneMapping;
  if (eng) { bronze.color.set('#e8d8c0'); bronze.metalness = 0.2; engraveScene(S, { lpm: 300, exposure: 2.4, accent: null }); st.r.toneMapping = THREE.NoToneMapping; }
  return t => { ctx.drawImage(st.renderLit(), 0, 0); if (eng) paperFinish(ctx, {}); return {}; };
};
SHOTS.pour = async () => { const st = new Stage({ W, H }); await st.init();
  const s = await foundryShot(st, { cam: Q.get('cam') || 'hook', tilt: num('tilt', 0.5), mono: num('mono', 0), tapper: Q.get('tapper') !== '0' });
  const mono = num('mono', 0);
  return t => { grade(out, s.frame(t), t, { dialect: mono ? 'newsreel' : 'furnace' }); return { light: +s.pour.light(t).power.toFixed(2) }; }; };

// ---------------------------------------------------------------- CYCLE 2: the work is the light (furnace.js + exposure.js)
//   ?shot=furnace&cam=lip|hook|tapper|row&mono=0|1&flow=1   ?shot=crowd
SHOTS.furnace = async () => { const { furnaceShot } = await import('../lib/fx/art/furnace.js'); const st = new Stage({ W, H }); await st.init();
  const fl = num('flow', 1), cam = Q.get('cam') || 'lip', reel = Q.get('reel') === '1';
  // the reel's plates (song time): lip = the pour breaking over the lip on 6.00; tapper = the eruption on 10.50;
  // row = the surge on 14.25. flowAt / exposureAt are pure functions of song time.
  const ramp = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));
  const R = !reel ? {} : cam === 'lip' ? { flowAt: t => t < 5.86 ? 0.004 : t < 5.967 ? 0.02 + 0.1 * ramp(t, 5.86, 5.967) : 0.3 + 0.7 * ramp(t, 5.967, 6.033), exposureAt: t => t < 5.967 ? 0.62 : 1.0 + 0.35 * Math.exp(-(t - 5.967) * 5), gasAt: t => ramp(t, 6.3, 6.9), bursts: [5.967] }
    : cam === 'tapper' ? { exposureAt: t => t < 10.467 ? 0.85 : 1.0 + 0.5 * Math.exp(-(t - 10.467) * 4), bursts: [10.467] }
    : cam === 'row' ? { flowAt: t => 1 + 0.6 * (t >= 14.217 && t < 14.35 ? 1 : 0), exposureAt: t => 1.0 + 0.3 * Math.exp(-Math.max(0, t - 14.217) * 6) * (t >= 14.217 ? 1 : 0), bursts: [14.217] } : {};
  // (plates are on twos: an event is scheduled one frame early so the plate that holds the accent frame already shows it)
  const s = await furnaceShot(st, { cam, mono: num('mono', 0), tilt: num('tilt', 0.55), tapper: Q.get('tapper') !== '0', crew: num('crew', 1), exposure: num('expo', 1), flowAt: Q.has('flow') ? (() => fl) : R.flowAt || null, gasAt: R.gasAt || null, bursts: R.bursts || [] });
  if (R.exposureAt) s.exposureAt = R.exposureAt;
  return t => { ctx.drawImage(s.frame(t), 0, 0); return { fx_ms: Math.round(s.fx.stats.ms), flow: s.pour.fl }; }; };
SHOTS.crowd = async () => { const { furnaceCrowd } = await import('../lib/fx/art/furnace.js'); const st = new Stage({ W, H }); await st.init();
  const s = await furnaceCrowd(st, { exposure: num('expo', 1) });
  if (Q.get('reel') === '1') { s.keyAt = t => (t >= 15.0 ? 1.6 + 0.8 * Math.exp(-(t - 15.6) * 2) : 1) * (t >= 16.467 ? 1 + 0.8 * Math.exp(-(t - 16.467) * 7) : 1); s.exposureAt = t => t >= 16.467 ? 1 + 0.3 * Math.exp(-(t - 16.467) * 7) : 1; }
  return t => { ctx.drawImage(s.frame(t), 0, 0); return {}; }; };

// ---------------------------------------------------------------- CYCLE 2: BANK engraved from real workers (burin2d.js)
//   ?shot=bank2 (the BACKED BY STEEL. vignette as a frieze)  ?shot=bank2&which=portrait (WE BUILD IT.)  &pitch=6
const REF = '../../review/studio_art_c2/before/ref/';
SHOTS.bank2 = async () => {
  const B = await import('../lib/fx/art/burin2d.js'); const { paperFinish } = await import('../lib/fx/art/intaglio3d.js');
  const which = Q.get('which') || 'frieze', pitch = num('pitch', 6);
  const hot = (r, g, b, L) => clamp01((L - 0.4) * 4) * clamp01((r - b) * 2.5 - 0.3);     // the pour: bright, warm, not white
  if (which === 'frieze') {
    // c2b: three real workers CUT OUT of their frames (mattes_c2.py: GrabCut), in a pyramid, each ruled at its own angle
    // (the engraver's choice), against the ruled plate sky; the pour is the one red plate, falling behind them to a mould
    // at the tapper's bar. Sources: Steel: Man's Servant 1938 13:01 (tapper); Master Hands 1936 III 00:48 (glasses) and
    // II 03:59 (smile). All PD.
    const base = await loadImg('../../review/studio_art_c1/before/key/PEOPLES_BANK_v7_21.0.jpg'), MT = '../../review/studio_art_c2/after/mattes/';
    const [tap, gl, sm] = await Promise.all(['tapper_steel1938', 'glasses_mh1936', 'smile_mh1936'].map(n => loadImg(MT + n + '.png')));
    const bx = [98, 698, 870, 880], S = 1080;
    const sky = (x, y) => (y < 430 ? 0.34 * Math.pow(1 - y / 430, 1.3) : 0);   // the ruled plate sky: horizontal rules, heavier to the top
    const T = B.vignetteFrieze([
      { img: gl, crop: [40, 0, 580, 480], at: [300, 0, 620, 551], alpha: true, angle: 0.62, tone: { gamma: 0.5, gain: 1.0, lift: -0.06 } },
      { img: tap, crop: [40, 10, 540, 710], at: [-70, 320, 600, 852], alpha: true, angle: -0.42, tone: { gamma: 0.75, gain: 1.1, lift: 0.0 } },
      { img: sm, crop: [220, 105, 420, 375], at: [470, 520, 650, 581], alpha: true, angle: -1.0, tone: { gamma: 0.7, gain: 1.25, lift: -0.12 } },
    ], { w: S, h: S, sky, clarity: 0.8, clarityR: 18, floor: 0.78 });
    // the red plate: the runner the tapper works (steel_1250_09-21), running in from the right along the foot of the
    // vignette and pooling at his bar, a few beads thrown up; the one colour on the note
    const Rn = (k => () => (k = (k * 16807) % 2147483647) / 2147483647)(7);
    for (let y = 900; y < S; y++) for (let x = 300; x < S; x++) { const i = y * S + x;
      const cy = 992 + 10 * Math.sin(x * 0.011 + 0.6) + 5 * Math.sin(x * 0.037), wR = 12 + 10 * Math.min(1, (S - x) / 500), pool = Math.hypot((x - 420) / 95, (y - 990) / 30) < 1;
      if ((Math.abs(y - cy) < wR * Math.min(1, (x - 330) / 40)) || pool) { T.red[i] = 1; T.D[i] = Math.max(T.D[i] * 0.3, 0.5 + 0.25 * (Math.abs(y - cy) / wR)); } }
    const T2 = B.resampleTone(T, bx[2], bx[3]);
    const plate = mkc(); plate.width = bx[2]; plate.height = bx[3]; const pg = plate.getContext('2d');
    const st = B.burin(pg, T2, { pitch: num('pitch', 4.5), base: Math.PI / 2, warp: 1.6 });
    return t => { ctx.drawImage(base, 0, 0, W, H);
      ctx.save(); ctx.beginPath(); ctx.roundRect(bx[0], bx[1], bx[2], bx[3], 38); ctx.clip(); ctx.drawImage(plate, bx[0], bx[1]); ctx.restore();
      paperFinish(ctx, { region: bx }); return { burin: st }; };
  }
  if (which === 'frieze0') {   // the c2 first pass (soft ovals), kept for comparison
    const base = await loadImg('../../review/studio_art_c1/before/key/PEOPLES_BANK_v7_21.0.jpg');
    const [tap, crew, prof, ham] = await Promise.all(['steel_1250_12', 'steel_1250_28', 'mh3_forge_12', 'mh3_forge_21'].map(n => loadImg(REF + n + '.jpg')));
    const bx = [98, 698, 870, 880], S = 1080;
    const sky = (x, y) => (y % 7 < 1.6 ? 0.55 * (1 - y / S) * (1 - y / S) : 0) * (y < 520 ? 1 : 0);   // the ruled plate sky, heavier to the top
    const T = B.vignetteFrieze([
      { img: ham, crop: [170, 0, 470, 470], at: [300, 10, 500, 500], feather: 0.35, oval: 0.95, tone: { gamma: 0.7, gain: 1.0, lift: -0.04 } },
      { img: prof, crop: [210, 0, 400, 450], at: [640, 250, 440, 495], feather: 0.3, tone: { gamma: 0.7, gain: 1.0, lift: -0.06 } },
      { img: crew, crop: [90, 60, 380, 600], at: [-10, 330, 360, 570], feather: 0.28, tone: { gamma: 0.8, gain: 1.0, lift: -0.06 } },
      { img: tap, crop: [0, 45, 960, 675], at: [110, 400, 1000, 703], feather: 0.3, oval: 1.0, tone: { gamma: 0.85, gain: 1.0, lift: -0.04 }, red: hot, weight: 1 },
    ], { w: S, h: S, sky, clarity: 0.6 });
    const T0 = T; const T2 = B.resampleTone(T0, bx[2], bx[3]);
    const plate = mkc(); plate.width = bx[2]; plate.height = bx[3]; const pg = plate.getContext('2d');
    let st = {};
    if (Q.get('debug') === 'tone') { const im = pg.createImageData(S, S); for (let i = 0; i < S * S; i++) { const v = 255 * (1 - T.D[i]); im.data[i * 4] = v + 200 * T.red[i]; im.data[i * 4 + 1] = v; im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; } pg.putImageData(im, 0, 0); }
    else st = B.burin(pg, T2, { pitch, base: -0.35 });
    return t => { ctx.drawImage(base, 0, 0, W, H);
      ctx.save(); ctx.beginPath(); ctx.roundRect(bx[0], bx[1], bx[2], bx[3], 38); ctx.clip(); ctx.drawImage(plate, bx[0], bx[1]); ctx.restore();
      paperFinish(ctx, { region: bx }); return { burin: st }; };
  }
  // WE BUILD IT.: one engraved hammerman (Master Hands III 00:20 / 00:48), 60 % of the frame height, under the head
  const base = await loadImg('../../review/studio_art_c2/before/key/PEOPLES_BANK_v7_24.5.jpg'), ham = await loadImg(REF + (Q.get('src') || 'mh3_forge_07') + '.jpg');
  const top = num('top', 700), S2 = [1080, H - top];
  const T = B.vignetteFrieze([{ img: ham, crop: [130, 0, 470, 480], at: [-60, 0, 1200, S2[1] * 1.02], shape: 'rect', feather: 0.08, tone: { gain: 1.0, lift: -0.04, gamma: 0.9 } }], { w: S2[0], h: S2[1] });
  const plate = mkc(); plate.width = S2[0]; plate.height = S2[1]; const st = B.burin(plate.getContext('2d'), T, { pitch: pitch + 1, base: -0.2 });
  return t => { ctx.drawImage(base, 0, 0, W, H); ctx.drawImage(plate, 0, top); paperFinish(ctx, { region: [0, top, W, H - top] }); return { burin: st }; };
};
const clamp01 = x => Math.min(1, Math.max(0, x));

// ---------------------------------------------------------------- CYCLE 2: the lineman at night (storm.js: HUMAN's lineman, ART's bucket and lights)
//   ?shot=storm&arc=1.0&bolt=2.0&cam=dx,dy,dz,lx,ly,fov
SHOTS.storm = async () => { const { stormLineman } = await import('../lib/fx/art/storm.js'); const st = new Stage({ W, H }); await st.init();
  const s = await stormLineman(st, { arcs: Q.has('arc') ? Q.get('arc').split(',').map(Number) : [], lightning: Q.has('bolt') ? Q.get('bolt').split(',').map(Number) : [], exposure: num('expo', 2.2) });   // c2b: 2.2 lands the night frame near the STORM value target
  return t => { ctx.drawImage(s.frame(t), 0, 0); return { arc: s.arcAt(t) }; }; };

// ---------------------------------------------------------------- CYCLE 2: the monument fist (fist_sdf.js), turntable / engraved on stock
//   ?shot=fist2&yaw=0.5&pitch=0.05&eng=0|1
SHOTS.fist2 = async () => { const { fistShot } = await import('../lib/fx/art/fist_sdf.js'); const st = new Stage({ W, H });
  const eng = Q.get('eng') === '1';
  const s = fistShot(st.r, { W, H, yaw: num('yaw', 0.5), pitch: num('pitch', 0.05), bg: eng ? '#EFE6CF' : '#15110F', bgK: eng ? 3.0 : 1, key: num('key', 7), dist: num('dist', 66) });
  if (!eng) return t => { ctx.drawImage(s.frame(t), 0, 0); return { pose: s.pose.flags }; };
  const B = await import('../lib/fx/art/burin2d.js'); const { paperFinish } = await import('../lib/fx/art/intaglio3d.js');
  return t => { const c = s.frame(t); const T = B.toneField(c, { gamma: 0.6, gain: 1.0, lift: -0.06 }); B.burin(ctx, T, { pitch: 7, base: -0.6, warp: 2.0 }); paperFinish(ctx, {}); return { pose: s.pose.flags }; }; };

// ---------------------------------------------------------------- CYCLE 2: the molten-sheet ladle wipe (sheet.js)  ?shot=wipe2&a=..&b=.. (jpgs in after/raw)
SHOTS.wipe2 = async () => { const { moltenWipe } = await import('../lib/fx/art/sheet.js');
  const RAW = '../../review/studio_art_c2/after/raw/', A = await loadImg(RAW + (Q.get('a') || 'it_tap_1.50') + '.jpg'), Bi = await loadImg(RAW + (Q.get('b') || 'it_lip_1.50') + '.jpg');
  return t => moltenWipe(ctx, A, Bi, t, { t0: num('t0', 0.55), hit: num('hit', 1.0), seed: 3 }); };

// ---------------------------------------------------------------- CYCLE 2: THE IRON REEL (song 5.50-17.50, FURNACE only)
// Plates: out/.pcache/art2/{lip,tap,row,crowd}/p_<t>.jpg (3D on twos, song time) + ins_{tap,erupt,crew}/fNNN.jpg (Steel:
// Man's Servant 1938, PD Mark 1.0, graded through exposure.js technicolor38). The camera moves on ones in 2D over the
// plates. Every event sits on the measured score (after/audio/score_frontier3.json, framecheck.py on the muxed wav).
SHOTS.reel2 = async () => {
  await loadArtFonts();
  const { gradePlate } = await import('../lib/fx/art/exposure.js'); const { moltenWipe } = await import('../lib/fx/art/sheet.js');
  const PC = '../../out/.pcache/art2/';
  const cacheI = new Map(); const img = async src => { if (!cacheI.has(src)) { if (cacheI.size > 24) cacheI.delete(cacheI.keys().next().value); cacheI.set(src, await loadImg(src)); } return cacheI.get(src); };
  // measured onsets that fall between two frames (9.75, 14.25, 17.25 -> reel frame n.5) sit on the frame framecheck
  // measures them at (floor): c2 struck 17.25 on frame 353 while the score measured 352 and the beat failed its ratio
  const Q = t => 5.5 + Math.floor((t - 5.5) * 30 + 1e-6) / 30, B975 = Q(9.75), B1425 = Q(14.25), B1725 = Q(17.25);
  const ORG = { tap: 10.5 };   // plate grid origin (tap plates start on the 10.50 accent; the rest sit on k/15)
  const pl = async (dir, t) => { const o = ORG[dir] || 0, i = Math.floor((t - o) * 15 + 1e-6), tp = o + i / 15; return img(`${PC}${dir}/p_${tp.toFixed(2)}.jpg`); };
  const gradeC = new Map();
  const ins = async (name, t, t0, { hold = null } = {}) => { let f = Math.round((t - t0) * 30); if (hold && t >= hold[0] && t < hold[1]) f = Math.round((hold[0] - t0) * 30);
    const key = name + f; if (gradeC.has(key)) return gradeC.get(key); const im = await img(`${PC}ins_${name}/f${String(Math.max(1, f + 1)).padStart(3, '0')}.jpg`);
    const c = mkc(); gradePlate(c, im, { curve: 'technicolor38', t, gain: 0.15, grain: 0.3 }); if (gradeC.size > 6) gradeC.delete(gradeC.keys().next().value); gradeC.set(key, c); return c; };
  // 2D camera over a plate: push (scale grows on ones), a kick at beats (one hard frame decaying on twos)
  const put = (g, im, { s = 1, cx = 540, cy = 960, dx = 0, dy = 0 } = {}) => { const w = W * s, h = H * s; g.drawImage(im, cx - w * (cx / W) + dx, cy - h * (cy / H) + dy, w, h); };
  const A = mkc(), Bc = mkc(), ga = A.getContext('2d'), gb = Bc.getContext('2d');
  // camera punch-in on a beat (on ones: +14 % on the beat frame, easing back over 6 frames); wind-up before a pickup
  const punch = (t, hit) => { const f = Math.round((t - hit) * 30); return f < 0 || f > 6 ? 0 : 0.14 * (1 - f / 7); };
  const wind = (t, a, b) => t < a || t >= b ? 0 : -(t - a) / (b - a);
  // exposure kick: the source over-exposes the film on an accent (one hard frame, then decaying on twos)
  const EXPO = [[6.0, 1.9], [7.5, 2.2], [9.0, 2.1], [10.5, 2.2], [B1425, 2.0], [15.0, 1.9], [16.5, 2.0], [B1725, 1.9]], kickAt = t => { for (const [h, K] of EXPO) { const f = Math.round((t - h) * 30); if (f === 0) return K; if (f > 0 && f < 6) return 1 + (K - 1) * 0.3 * (1 - Math.floor(f / 2) * 2 / 6); } return 1; };
  const seg = async (g, t) => {
    if (t < 7.5) { put(g, await pl('lip', t), { s: 1.0 + 0.03 * (t - 5.5), cy: 1100 }); return 'lip'; }
    if (t < B975) { const [kx, ky] = M.shake(t, 9.0, 26, 9); put(g, await pl('crowd', t), { s: 1.02 + 0.025 * (t - 7.5) + punch(t, 9.0) + 0.05 * wind(t, 9.62, 9.75), cy: 800, dx: kx, dy: ky }); return 'crowd'; }
    if (t < 10.5) { put(g, await ins('tap', t, B975, { hold: [10.3, 10.3667] }), { s: 1.1 + 0.03 * (t - B975), cx: 470, cy: 700 }); return 'ins_tap'; }
    if (t < 12.0) { put(g, await pl('tap', t), { s: 1.0 + 0.03 * (t - 10.5), cy: 900 }); return 'tap'; }
    if (t < 15.0) { const [kx, ky] = M.shake(t, B1425, 30, 14); put(g, await pl('row', t), { s: 1.0 + 0.02 * (t - 12.0) + punch(t, B1425), cx: 380, cy: 900, dx: kx, dy: ky }); return 'row'; }
    if (t < 15.6) { put(g, await ins('erupt', t, 15.0), { s: 1.05 + 0.06 * (t - 15.0), cy: 700 }); return 'ins_erupt'; }
    if (t < 16.5) { put(g, await pl('crowd', t), { s: 1.08 + 0.03 * (t - 15.6), cy: 820 }); return 'crowd'; }
    // ALL HANDS.: the Steel 13:17 crew against the eruption, then the same action from a second angle on the repeat
    if (t < B1725) { put(g, await ins('crew', t, 16.5), { s: 1.06 + 0.04 * (t - 16.5), cx: 540, cy: 900 }); return 'ins_crew'; }
    put(g, await ins('crew', t, 16.5), { s: 1.7 + 0.08 * (t - B1725), cx: 330, cy: 520 }); return 'ins_crew_2nd';
  };
  return async t => {
    const info = {};
    if (t >= 11.55 && t < 12.0 + 22 / 30) { await seg(ga, Math.min(t, 11.9667)); await seg(gb, Math.max(t, 12.0)); info.wipe = moltenWipe(ctx, A, Bc, t, { t0: 11.55, hit: 12.0, seed: 5 }); info.seg = 'wipe'; }
    else info.seg = await seg(ctx, t);
    { const k = kickAt(t); if (k > 1) { const c = mkc(); c.getContext('2d').drawImage(out, 0, 0); ctx.filter = `brightness(${k}) contrast(${1 + (k - 1) * 0.3})`; ctx.drawImage(c, 0, 0); ctx.filter = 'none'; info.kick = k;
      if (k >= 1.8) { ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(255,120,30,${(k - 1) * 0.28})`; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over'; } } }   // the flare washes the frame in the source's colour
    // sparks across the lens on the beats and accents that carry an eruption
    debris(ctx, t, { hit: 9.0, origin: [-40, 1500], kind: 'sparks', n: 220, speed: 2600, dir: -0.35, spread: 0.6, seed: 11 });
    debris(ctx, t, { hit: 10.5, origin: [540, 1900], kind: 'sparks', n: 120, speed: 2600, dir: -Math.PI / 2, spread: 1.4, seed: 12 });
    if (Math.round((t - 16.5) * 30) === 0 && impactFrame(ctx, t, { hit: 16.5, inks: ['oxide', 'stock'], thr: 0.3, frames: 1, invert: false })) info.impact = 16.5;   // one hard frame
    debris(ctx, t, { hit: 16.5, origin: [540, 1300], kind: 'sparks', n: 110, speed: 2400, spread: Math.PI * 1.4, seed: 13 });
    // the words: IRON's lines, struck on the picture act's frame (Big Shoulders, no shadow, no glow)
    slam(ctx, t, { lines: ['HOTTER.'], hit: 6.0, out: 7.3, x: 60, y: 180, size: 300, face: FACES.furnace, plate: 'stock', seed: 1 });
    slam(ctx, t, { lines: ['30,000', 'STRONG.'], hit: 7.5, out: 9.55, x: 60, y: 120, size: 250, face: FACES.furnace, plate: 'stock', seed: 2 });
    slam(ctx, t, { lines: ['MORE', 'IRON.'], hit: 10.5, out: 11.5, x: 60, y: 140, size: 280, face: FACES.furnace, plate: 'stock', seed: 3 });
    slam(ctx, t, { lines: ['RED', 'HOT.'], hit: 12.0, out: 14.2, x: 60, y: 140, size: 330, face: FACES.furnace, plate: 'stock', seed: 4 });
    slam(ctx, t, { lines: ['ALL', 'HANDS.'], hit: 16.5, out: 17.15, x: 60, y: 120, size: 300, face: FACES.furnace, plate: 'stock', seed: 5 });
    slam(ctx, t, { lines: ['ALL', 'HANDS.'], hit: B1725, out: 99, x: 60, y: 1380, size: 320, face: FACES.furnace, plate: 'stock', red: [1], redPlate: 'red', seed: 6 });
    return info;
  };
};

try {
  await loadFonts();
  const draw = await SHOTS[SHOT]();
  window.renderFrame = async t => { const t0 = performance.now(); const info = (await draw(t)) || {};
    if (Q.get('stats') !== '0') info.values = valueStats(out); return { ms: Math.round(performance.now() - t0), info }; };
  window.sceneReady = true;
} catch (e) { console.error(e.stack || e); window.sceneError = String(e.stack || e); }
