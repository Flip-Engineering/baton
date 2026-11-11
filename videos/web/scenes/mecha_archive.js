// MECHA PROLETARIAT: ARCHIVE (mecha_archive). The class's own instruments on public-domain film, in cool silver, one thing per shot
// in red-lead primer (the tool in the worker's hand); then the same lattice stands up as the walker, shot on the same stock.
// Words (research/scripts_final/mecha_archive.json): RISE's definition, Marx ch. 15 s4 whole, Haz's alignment sentence, Marx ch. 15 s1.
// Everything is keyed in SECONDS to the score (songs2/mecha_archive.py): the film's own cadence is 15 frames a second, held on twos.
import * as THREE from 'three';
import { W, H, C, loadFonts, loadBeats, loadImage, clamp, lerp, ease, smooth, rng, line, headline, Finish, closer, outCanvas } from '../lib/kit.js';
import { RQ } from '../lib/rq.js';
import { Site, V3, STAND } from './mecha_archive.world.js';
THREE.ColorManagement.enabled = true;

const Q = new URLSearchParams(location.search);
const CLOSE = 48.0, LOCK_FRAMES = 42;           // closer lockup at 48.0 s (beat 64 at 80 bpm), then 1.4 s
const T_STALL1 = 32.7, T_NAME = 33.4, T_STALL2 = 44.55, T_IMP = 45.17;      // T_IMP: where the sledge lands on the picture; the score's blow starts at 45.15-45.2

// ================================================================ the words: [t, lines, hold-to, emphasis]
const CUES = [
  // RISE (Infrared, 18 Sep 2022): THE AMERICAN WORKING CLASS (THE 'MECHA PROLETARIAT,' DEFINED BY ITS OWNERSHIP OF THE MEANS OF AUGMENTING ITS LABOR POWER - TRUCKS, TOOLS, ETC.)
  [1.75, ['THE AMERICAN', 'WORKING CLASS,'], 3.8], [3.9, ["THE 'MECHA", "PROLETARIAT,'"], 5.8, 1],
  [5.9, ['DEFINED BY', 'ITS OWNERSHIP'], 7.1], [7.1, ['OF THE MEANS', 'OF AUGMENTING'], 8.5, 1], [8.5, ['ITS LABOR', 'POWER:'], 11.7],
  [11.8, ['TRUCKS,'], 13.0, 1], [13.1, ['TOOLS,'], 15.0, 1],
  // Marx, Capital I ch. 15 s4 (Moore/Aveling), whole: "In handicrafts and manufacture, the workman makes use of a tool, in the factory, the machine makes use of him.
  // There the movements of the instrument of labour proceed from him, here it is the movements of the machine that he must follow." (8 Oct: v2 set
  // "...PROCEED FROM HIM." without THERE, the reverse of the source; archive_audit_20261008 s4.) Text only, inside v2's times: the pictures under THERE
  // (W1) and HERE (pole / W2 / pole) wait for the re-cut around There and Here (audit item 17), and songs2/mecha_archive.py CARDS still hold the old words.
  [15.2, ['IN HANDICRAFTS', 'AND MANUFACTURE,'], 16.9], [16.9, ['THE WORKMAN', 'MAKES USE OF A TOOL,'], 19.2],
  [19.3, ['IN THE FACTORY,'], 20.8], [20.8, ['THE MACHINE', 'MAKES USE OF HIM.'], 23.6, 1],
  [23.7, ['THERE THE MOVEMENTS OF', 'THE INSTRUMENT OF LABOUR', 'PROCEED FROM HIM,'], 26.0], [26.1, ['HERE IT IS THE MOVEMENTS', 'OF THE MACHINE', 'THAT HE MUST FOLLOW.'], 29.1, 1],
  // Haz, 8 Sep 2026
  [29.3, ['AI CANNOT', 'ALIGN ITSELF'], 31.1, 1], [31.1, ['AUTONOMOUSLY'], 33.3, 1], [33.5, ['OR GIVE', 'ITSELF PURPOSE'], 35.3], [35.4, ['OUTSIDE OF', 'HUMAN INFLUENCE.'], 38.5],
  // Marx, Capital I ch. 15 s1
  [38.6, ['AN ORDINARY', 'HAMMER HEAD,'], 40.7], [40.8, ['BUT OF SUCH', 'A WEIGHT'], 42.6], [42.7, ['THAT NOT THOR', 'HIMSELF'], 44.3], [44.3, ['COULD', 'WIELD IT.'], 47.0, 1],
];

// ================================================================ the shots
// clip shots: t0 t1 clip, f0 first frame, speed (1 = 15 fps), s zoom (x the fit height), fx fy (focus, source 0..1), pan (focus drift over the shot), push (zoom end/start)
const S = (t0, t1, clip, o = {}) => ({ t0, t1, clip, f0: 0, speed: 1, s: 1, fx: .5, fy: .5, pan: [0, 0], push: 1, ...o });
const WK = (t0, t1, walker, o = {}) => ({ t0, t1, walker, ...o });
const SHOTS = [
  S(0, 1.65, 'chisel', { s: 1.1, fx: .55, fy: .55, push: 1.06, f0: 6, speed: .72 }),
  S(1.65, 3.8, 'face', { s: .8, fx: .5, fy: .5, push: 1.05, f0: 0 }),
  S(3.8, 5.8, 'jack', { s: 1.05, fx: .52, fy: .5, push: 1.05 }),
  S(5.8, 8.2, 'lever', { s: 1.1, fx: .55, fy: .5, pan: [-.02, 0], push: 1.04 }),
  S(8.2, 11.7, 'tractor', { wide: 1, s: .72, fx: .45, fy: .56, push: 1.1 }),
  S(11.7, 13.0, 'wheel', { s: 1.1, fx: .6, fy: .6, speed: .78 }),
  S(13.0, 15.1, 'lineman', { s: 1.25, fx: .56, fy: .6, speed: .83, push: 1.12 }),
  S(15.1, 19.2, 'girder', { wide: 1, s: .74, fx: .5, fy: .45, pan: [.05, .04], push: 1.08 }),
  S(19.2, 23.65, 'lattice', { wide: 1, s: .8, fx: .5, fy: .5, f0: 4, push: 1.12 }),
  WK(23.65, 26.05, 'W1'),
  S(26.05, 27.2, 'pole', { wide: 1, s: .72, fx: .45, fy: .5, f0: 8, push: 1.03 }),
  WK(27.2, 28.3, 'W2'),
  S(28.3, 29.2, 'pole', { wide: 1, s: .72, fx: .45, fy: .5, f0: 30, push: 1.03 }),
  S(29.2, 33.3, 'diagram', { wide: 1, s: .78, fx: .5, fy: .5, speed: 0.55, push: 1.12 }),
  S(33.3, 35.0, 'lever', { s: 1.1, fx: .55, fy: .5, f0: 17, speed: .8 }),
  WK(35.0, 38.55, 'W3'),
  S(38.55, 40.75, 'lineman', { s: 1.9, fx: .58, fy: .62, speed: .8, push: 1.1 }),
  WK(40.75, T_IMP, 'W4'),
  WK(T_IMP, CLOSE - 0.0, 'W5'),
];

// ================================================================ boot
await loadFonts();
let B; try { B = await loadBeats('mecha_archive'); } catch (e) { console.log('mecha_archive: no beat map'); throw e; }
const DUR = CLOSE + LOCK_FRAMES / 30;
window.DURATION = DUR;
const out = document.getElementById('out'); out.width = W; out.height = H;
const ctx = out.getContext('2d');
const finish = new Finish(11);
const META = await (await fetch('../assets/mecha_archive/clips.json')).json();

// ---- film frames
const IMG = new Map();
function frame(clip, i) {
  const k = clip + '/' + i;
  if (!IMG.has(k)) IMG.set(k, loadImage(`../assets/mecha_archive/${clip}/${String(i).padStart(3, '0')}.jpg`));
  return IMG.get(k);
}
const PRE = new Set();
async function filmImg(sh, t) {
  const m = META[sh.clip], n = m.n;
  let i = Math.floor((t - sh.t0) * 15 * sh.speed) + sh.f0;
  i = Math.max(0, Math.min(n - 1, i));
  const img = await frame(sh.clip, i);
  for (let j = 1; j <= 3; j++) if (i + j < n) frame(sh.clip, i + j);                     // read ahead
  return { img, m, i };
}
const fcv = document.createElement('canvas'); fcv.width = W; fcv.height = H; const fx = fcv.getContext('2d');
function drawFilm(g, img, m, sh, t, alpha = 1) {
  const u = clamp((t - sh.t0) / (sh.t1 - sh.t0));
  let sc = H / m.h * sh.s * lerp(1, sh.push, u) * 0.86;
  if (sh.wide) sc = W / m.w * 1.05 * lerp(1, sh.push, u);                    // 0.86: the film sits in its gate with a little black round it
  const cx = (sh.fx + sh.pan[0] * u) * m.w, cy = (sh.fy + sh.pan[1] * u) * m.h;
  let ox = W / 2 - cx * sc, oy = H * 0.46 - cy * sc;
  ox = clamp(ox, W - m.w * sc, 0); if (m.w * sc <= W) ox = (W - m.w * sc) / 2;
  if (m.h * sc >= H) oy = clamp(oy, H - m.h * sc, 0); else oy = H * (sh.wide ? 0.375 : 0.43) - m.h * sc / 2;
  g.save(); g.globalAlpha = alpha; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(img, ox, oy, m.w * sc, m.h * sc); g.restore();
}

// ================================================================ the walker, on the same stock
const ADOPT = false;   // GRAPHICS 4.A (lib/rq.js): true = native resolution on the GPU and a fenced copy, once this piece's farm A/B says so
const SC = RQ.scale(0.5, ADOPT), RW = Math.round(W * SC), RH = Math.round(H * SC);
const glc = document.createElement('canvas');
const renderer = new THREE.WebGLRenderer({ canvas: glc, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); renderer.setSize(RW, RH, false);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 6000);
const site = new Site(scene, renderer);
const G = site.G;
const mid = document.createElement('canvas'); mid.width = RW; mid.height = RH; const mg = mid.getContext('2d', { willReadFrequently: true });
const cgc = document.createElement('canvas'); cgc.width = RW; cgc.height = RH; const cg = cgc.getContext('2d');

const lerpArr = (a, b, u) => a.map((v, i) => lerp(v, b[i] ?? 0, u));
function poseOf(over = {}, base = STAND) { const P = JSON.parse(JSON.stringify(base)); for (const k in over) P[k] = over[k]; return P; }
const eio = ease.inOutCubic;
function setCam(pos, target, fov = 40, roll = 0) { camera.position.copy(pos); camera.up.set(Math.sin(roll), Math.cos(roll), 0); camera.lookAt(target); camera.fov = fov; camera.updateProjectionMatrix(); }
function shake(t, amp, seed = 1) { return V3(Math.sin(t * 31 + seed) * amp + Math.sin(t * 57 + seed * 2) * amp * 0.5, Math.sin(t * 37 + seed * 3) * amp + Math.sin(t * 61) * amp * 0.4, 0); }

// the shots. t = seconds into the piece; every one is a function of t alone (deterministic)
function setWalker(id, t) {
  site.sledge.visible = false; site.plate.visible = false; site.dust.bursts = []; G.setBuild(1); G.pose(STAND); G.g.position.set(0, site.restY, 0); site.scaf.g.visible = false;
  const sh = SHOTS.find(s => s.walker === id); const u = clamp((t - sh.t0) / (sh.t1 - sh.t0));
  site.shadowBox(V3(0, 22, 0), 90);
  if (id === 'W1') {
    // the reel's lattice from below, matched: a leg of the frame half built, red-lead on the newest members; the camera climbs it
    G.setBuild(0.5 + 0.1 * u, { primerBand: .3 });
    G.pose(poseOf({ hpL: [-6, 0, 3], knL: [8, 0, 0] })); G.g.position.set(0, site.restY, 0);
    const y = lerp(2.0, 17, eio(u));
    setCam(V3(-9, y, 26), V3(1, lerp(8, 30, eio(u)), 0), 52, 0);
  } else if (id === 'W2') {
    // a primer plate rises on the crane's hook beside the leg: the next member of the line, hung by the crew
    G.setBuild(0.82, { primerBand: .25 });
    G.pose(poseOf({ hpL: [-6, 0, 3], knL: [8, 0, 0] })); G.g.position.set(0, site.restY, 0);
    const hp = site.crane.setHook(23, lerp(52, 22, eio(u)), 0.0);
    site.plate.visible = true; site.plate.position.set(hp.x, hp.y - 3.4, hp.z);
    setCam(V3(-30, 4 + 6 * u, 40), V3(-8, lerp(12, 24, u), 0), 46, 0);
  } else if (id === 'W3') {
    // the knee ram takes the stroke only after the hand: stand to a half-crouch, the planted foot stays planted
    const k = eio(clamp((u - .18) / .7));
    G.setBuild(1);
    G.pose(poseOf({ root: { p: [0, -.6 - 3.2 * k, 0], r: [2 + 4 * k, -4, 0] }, hpL: [2 + 24 * k, 0, 3], knL: [5 + 38 * k, 0, 0], anL: [-7 - 14 * k, 0, -3], hpR: [-10 + 18 * k, 8, -6], knR: [10 + 22 * k, 0, 0], waist: [2 + 3 * k, 4, 0] }));
    G.ground();
    G.g.updateMatrixWorld(true);
    const kn = G.J.knL.getWorldPosition(new THREE.Vector3());
    setCam(V3(-26 + 4 * u, kn.y - 6, 30), V3(kn.x, kn.y + 1, kn.z), 44, 0);
  } else if (id === 'W4' || id === 'W5') {
    // the sledge: up slowly (arm raised in front), held at the top, down in a heartbeat to the ground; then it rests
    const rise = eio(clamp((t - 40.75) / (44.4 - 40.75))), fall = clamp((t - 44.85) / (T_IMP - 44.85)), fl = fall * fall * fall;
    const apex = -176, pc = CONTACT.pit;
    const pit = t >= T_IMP ? pc : lerp(lerp(-86, apex, rise), pc, fl);
    const lean = t >= T_IMP ? 1 : fl;
    G.pose(armPose(pit, rise * (1 - lean), lean));
    G.ground();
    G.g.updateMatrixWorld(true);
    site.sledge.visible = true;
    site.sledge.removeFromParent(); G.J.wrR.add(site.sledge); site.sledge.position.set(0, -1.5, 0); site.sledge.rotation.set(Math.PI, 0, 0);
    site.sledge.scale.setScalar(.8);
    G.g.updateMatrixWorld(true);
    const head = site.sledge.userData.head.getWorldPosition(new THREE.Vector3());
    if (id === 'W4') {
      const ty = lerp(14, 50, rise);
      setCam(V3(34, 3.0, 78).add(shake(t, .06 * (1 - rise))), V3(0, ty, 0), 50, 0);
    } else {
      const age = t - T_IMP;
      site.dust.bursts = [{ t0: T_IMP, x: head.x, z: head.z, size: 46, n: 150, tint: '#e2ded6', seed: 5 }];
      site.dust.update(t);
      setCam(V3(head.x + 46 - 6 * u, 2.2 + 1.0 * u, head.z + 72 - 8 * u).add(shake(t, .6 * Math.exp(-age * 5))), V3(head.x - 6, 9 + 4 * u, head.z - 6), 46, 0);
    }
  }
  site.dust.update(t);
  site.crowd.commit(t);
}

function armPose(pit, rise, lean) {
  return poseOf({ shR: [pit, 0, -8], elR: [-6, 0, 0], shL: [pit * .8, 0, 14], elL: [-20, 0, 0], chest: [3 - 9 * rise + 14 * lean, 0, 0], waist: [2 - 4 * rise + 6 * lean, 4, 0],
    root: { p: [0, -.6 - 2 * lean, 0], r: [2, -4, 0] }, curl: { L: .7, R: .9 } });
}
// where the head meets the ground: the shoulder pitch at which the sledge head's lowest point is on y = 0 (found once)
const CONTACT = { pit: -60 };
{
  site.sledge.visible = true; site.sledge.removeFromParent(); G.J.wrR.add(site.sledge); site.sledge.position.set(0, -1.5, 0); site.sledge.rotation.set(Math.PI, 0, 0); site.sledge.scale.setScalar(.8);
  let best = 1e9;
  for (let p = -150; p <= -20; p += 2) {
    G.setBuild(1); G.pose(armPose(p, 0, 1)); G.ground(); G.g.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(site.sledge.userData.head), d = Math.abs(bb.min.y - 0.2);
    if (d < best) { best = d; CONTACT.pit = p; }
  }
  site.sledge.visible = false;
}
let CGKEY = '', cgReady = false;
// render the walker for second t into cgc (15 fps cadence), graded to silver with the primer kept as red lead
function renderWalker(id, t) {
  const key = id + ':' + Math.floor(t * 15);
  if (key === CGKEY) return;
  CGKEY = key; const tq = Math.floor(t * 15) / 15;
  setWalker(id, tq);
  renderer.render(scene, camera);
  RQ.present(mg, glc, renderer.getContext(), { w: RW, h: RH });
  const im = mg.getImageData(0, 0, RW, RH), d = im.data;
  const gain = 1.0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    let y = .30 * r + .55 * g + .15 * b;                                              // orthochromatic-ish: green carries, red darker
    const red = clamp((r - Math.max(g, b) * 1.55) * 5.6);                         // how much this pixel is red-lead primer
    y = Math.pow(clamp(y * gain), 1.12); y = y * y * (3 - 2 * y) * .4 + y * .6;
    const sr = y * .92 + .004, sg = y * .965 + .006, sb = y + .012 * (1 - y);
    const ry = clamp(y * 1.5 + .05);
    const rr = lerp(.04, .87, ry), rg = lerp(.012, .35, ry * ry), rb = lerp(.012, .23, ry * ry);
    d[i] = 255 * lerp(sr, rr, red); d[i + 1] = 255 * lerp(sg, rg, red); d[i + 2] = 255 * lerp(sb, rb, red);
  }
  cg.putImageData(im, 0, 0);
}

// ================================================================ the film's own finish: gate weave, flicker, dust, scratches, halation, grain
const halo = document.createElement('canvas'); halo.width = 270; halo.height = 480; const hg = halo.getContext('2d');
function filmFinish(t, f) {
  const f15 = Math.floor(t * 15), R = rng(f15 * 7 + 3);
  // halation: bright areas bloom a little (blurred small copy, screen)
  hg.filter = 'blur(7px)'; hg.drawImage(out, 0, 0, 270, 480); hg.filter = 'none';
  ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = .16; ctx.drawImage(halo, 0, 0, W, H); ctx.restore();
  // flicker (exposure) and dust/hairs/scratches, on the film's own 15 frames a second
  const fl = (R() - .5) * .09 + .035 * Math.sin(f15 * .7);
  ctx.save(); ctx.globalCompositeOperation = fl > 0 ? 'screen' : 'multiply'; ctx.fillStyle = fl > 0 ? `rgba(255,255,255,${fl * .9})` : `rgba(0,0,0,${-fl * 1.1})`;
  if (fl < 0) ctx.fillStyle = `rgb(${255 + fl * 700},${255 + fl * 700},${255 + fl * 700})`; ctx.fillRect(0, 0, W, H); ctx.restore();
  ctx.save();
  const nd = 3 + Math.floor(R() * 5);
  for (let i = 0; i < nd; i++) { const x = R() * W, y = R() * H, r = 1 + R() * 3.2; ctx.fillStyle = R() < .6 ? 'rgba(235,235,230,.55)' : 'rgba(10,10,10,.5)'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
  const sc = Math.floor(f15 / 5), RS = rng(sc * 13 + 1);                              // a scratch lives about a third of a second
  if (RS() < .55) { const x = RS() * W; ctx.strokeStyle = `rgba(240,240,235,${.15 + RS() * .25})`; ctx.lineWidth = 1 + RS() * 1.5; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (RS() - .5) * 30, H); ctx.stroke(); }
  if (R() < .06) { const x = R() * W, y = R() * H; ctx.strokeStyle = 'rgba(20,20,20,.5)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x, y); ctx.bezierCurveTo(x + 30, y + 10, x + 10, y + 40, x + 50, y + 55); ctx.stroke(); }
  ctx.restore();
  finish.apply(ctx, f, { grain: .14, vignette: .7 });
}

// ================================================================ type
let cur = null;
function typeAt(t) {
  for (const [t0, lines, hold, em] of CUES) {
    if (t < t0 || t >= hold) continue;
    const age = t - t0, n = lines.length;
    const size = lines.some(l => l.length > 15) ? 118 : lines.length === 1 ? (lines[0].length < 9 ? 190 : 150) : 142;
    const outA = clamp((hold - t) / .12);
    ctx.save(); ctx.globalAlpha = outA;
    headline(ctx, lines, age, { y: (cur && cur.wide ? 1380 : 1196) - (n - 1) * 70, size, gap: .95, dur: .2, stagger: .08, color: em ? '#F4E6D0' : '#E9DFCB',
      lineOpts: { shadow: 34, maxW: W - 120, stroke: 0 } });
    ctx.restore();
  }
}

// ================================================================ the frame
let lastBeats = B;
window.renderFrame = async (t) => {
  const f = Math.round(t * 30);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.shadowBlur = 0; ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, W, H);
  if (t >= CLOSE) { closer(ctx, t - CLOSE); finish.apply(ctx, f, { grain: .07, vignette: .6 }); return; }
  const sh = SHOTS.find(s => t >= s.t0 && t < s.t1) || SHOTS[SHOTS.length - 1]; cur = sh;
  // weave: the whole picture rides a hair off its place, on the film's own frames
  const f15 = Math.floor(t * 15), RW_ = rng(f15 * 17 + 5);
  const wx = (RW_() - .5) * 3.2, wy = (RW_() - .5) * 3.6, wr = (RW_() - .5) * .0016;
  ctx.save(); ctx.translate(W / 2 + wx, H / 2 + wy); ctx.rotate(wr); ctx.translate(-W / 2, -H / 2);
  const drawShot = async (s, alpha = 1) => {
    if (s.clip) { const { img, m } = await filmImg(s, t); drawFilm(ctx, img, m, s, t, alpha); }
    else { renderWalker(s.walker, t); ctx.save(); ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(cgc, -6, -6, W + 12, H + 12); ctx.restore(); }
  };
  // the match cut: the real lattice dissolves into the walker's, 0.45 s
  const iL = SHOTS.findIndex(s => s.clip === 'lattice');
  if (sh.walker === 'W1' && t - sh.t0 < 0.45) { await drawShot(SHOTS[iL], 1 - clamp((t - sh.t0) / .45)); await drawShot(sh, clamp((t - sh.t0) / .45) ); }
  else await drawShot(sh);
  ctx.restore();
  // the argument stalls: the picture goes dark under AI CANNOT ALIGN ITSELF AUTONOMOUSLY, and comes back on the hand
  const dark = t >= T_STALL1 - .15 && t < T_NAME ? clamp((t - (T_STALL1 - .15)) / .15) : 0;
  if (dark) { ctx.fillStyle = `rgba(4,4,4,${dark * .96})`; ctx.fillRect(0, 0, W, H); }
  // the opening fades up from black
  if (t < .3) { ctx.fillStyle = `rgba(5,5,5,${(1 - t / .3) * .5})`; ctx.fillRect(0, 0, W, H); }
  filmFinish(t, f);
  typeAt(t);
};
window.sceneReady = true;
