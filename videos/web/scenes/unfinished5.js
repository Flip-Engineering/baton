// SECOND INDEPENDENCE (1776 / UNFINISHED), c20: the rebuild from v1-v3 (videos/review/SECOND_INDEPENDENCE_1776_c20/BRIEF.md).
//
// Seven ideas, one object, one climb: 1776. UNFINISHED. LIFE. LIBERTY. PRODUCTION. (the people) 2036. FINISH IT.
// The object is the TYPE studio's broadside on its platen press (lib/fx/type_press.js: platenPress + the Dunlap sheet's
// materials: paperStock, salt, the squeezed rim, a red second impression). Every word is an impression the press makes, on the
// beat of the score (songs2/s1776_f.py), and the camera is the forme: the platen shuts over us and opens on the sheet.
//   1776.        the dateline, printed; the forme short, the right-hand column of body type stops half way
//   UNFINISHED.  a pull with the ink run out: the first letters in full, the rest a blind impression (the paper bitten, no ink)
//   LIFE. LIBERTY.  two black pulls on the drop
//   (the breath)  the forme with PRODUCTION. set reversed in red, the rollers, the platen shutting: the band has stopped
//   PRODUCTION.  the red second impression, the hardest downbeat
//   (the people) the sheet hung on the line at the back of the shop; working people (the person pipeline's crowd: lib/fx/people.js
//                drawing the current person's cast, bodies from workforce.workerDesc) arrive on the beat, one, then a few, then a row,
//                then a crowd, and the red rises up the wall behind the sheet until the picture is a poster: ink, red, the cream sheet
//   2036.        a fresh sheet: the dateline reset, the triad set whole, the space where UNFINISHED. was left open
//   FINISH IT.   the last red pass into that space, the largest type, the loudest bar
//   (breathe)    the people before the finished sheet, in the red; the finished sheet on the platen, the Party's mark at its foot; loop
// No stamp, no red discs, no trades, no founders, no desk, no hall, no woodcuts, no seal (the director's brief).
// Takes (one module, three pages): a = unfinished5 (the sheet is already printed with 1776. on frame 0); c = unfinished5c (frame 0 is
// the forme with 1776. set reversed, the rollers already moving: the first impression opens on b2); b = unfinished5b (a, plus
// A SECOND INDEPENDENCE. pulled on a fresh sheet at b22 before the dateline 2036.).
import * as THREE from 'three';
import { W, H, clamp, lerp, ease, rng, loadBeats } from '../lib/kit.js';
import { loadFace, canvas2d, innerShadow, cpuOut } from '../lib/fx/type.js';
import { paperStock, finishPlate } from '../lib/fx/type_sets.js';
import { setBlock, measure } from '../lib/fx/type_world.js';
import { platenPress } from '../lib/fx/type_press.js';
import { drawLockup } from '../lib/closer.js';
import { People } from '../lib/fx/people.js';
import { loadAnsur, mulberry32 } from '../lib/fx/rig/body.js';
import { workerDesc } from '../lib/fx/workforce.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const SCENE = window.SI_SCENE || 'unfinished5', TAKE = window.SI_TAKE || 'a';
const ctx = cpuOut();
const B = await loadBeats(SCENE);
const bt = x => B.time(x);
const F = { wood: await loadFace('ultra'), cond: await loadFace('anton'), body: await loadFace('fell') };
const finish = finishPlate({ seed: 1776 });
const INK = '#15110f', RED = '#b3141f', PAPER = [236, 226, 202];
const SW = 1000, SH = 1560, SX = 40, SY = 180;          // the sheet, and where it lies on the platen (frame px)

// ================================================================ the sheet: impressions as layers (the Dunlap broadside's materials)
// salt: ink voids clustered where the roller starved (as type_press.js), called inside destination-out
function salt(q, rr, x, y, w, h, n) {
  const cl = Array.from({ length: 9 }, () => [x + rr() * w, y + rr() * h, 30 + rr() * 90]);
  for (let k = 0; k < n; k++) { let px, py; if (rr() < 0.75) { const c = cl[k % cl.length], a = rr() * 7, d = c[2] * Math.sqrt(rr()); px = c[0] + Math.cos(a) * d; py = c[1] + Math.sin(a) * d * 0.6; } else { px = x + rr() * w; py = y + rr() * h; }
    q.fillStyle = `rgba(0,0,0,${0.35 + rr() * 0.65})`; q.beginPath(); q.ellipse(px, py, 0.5 + rr() * rr() * 3, 0.4 + rr() * 1.4, rr() * 3, 0, 7); q.fill(); }
}
// one impression of a block: ink, salt, wood grain in the solids, the squeezed rim and the deboss. starve: [x0, x1] in sheet px, the ink
// running out across the word (full before x0, a blind impression after x1: the paper bitten with no ink, read only by its relief)
function impression(block, color, { seed = 1, dx = 0, dy = 0, saltN = 900, starve = null, grain = true } = {}) {
  const L = canvas2d(SW, SH), q = L.g, rr = rng(seed);
  q.fillStyle = color; for (const G of block.glyphs) { q.save(); q.translate(G.ox + dx, G.oy + dy); q.fill(G.path); q.restore(); }
  const b = block.bbox;
  q.save(); q.globalCompositeOperation = 'destination-out';
  salt(q, rr, b.x1 - 20, b.y1 - 10, b.x2 - b.x1 + 40, b.y2 - b.y1 + 20, saltN);
  if (grain) for (let n = 0; n < 60; n++) { const yy = b.y1 + rr() * (b.y2 - b.y1), ph = rr() * 6, amp = 1 + rr() * 3; q.strokeStyle = `rgba(0,0,0,${0.04 + rr() * 0.1})`; q.lineWidth = 0.6 + rr() * 1.6;
    q.beginPath(); for (let x = 0; x <= SW; x += 20) { const Y = yy + Math.sin(x * 0.012 + ph) * amp; x ? q.lineTo(x, Y) : q.moveTo(x, Y); } q.stroke(); }
  if (starve) {                                            // the ink runs out: a ragged, salted fade from x0 to x1, a ghost after it
    const [x0, x1] = starve, gr = q.createLinearGradient(x0, 0, x1, 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.75)'); gr.addColorStop(1, 'rgba(0,0,0,0.96)');
    q.fillStyle = gr; q.fillRect(x0, 0, SW - x0, SH);
    salt(q, rr, x0 - 60, b.y1, x1 - x0 + 120, b.y2 - b.y1, 2600);
  }
  q.restore();
  q.save(); q.globalCompositeOperation = 'source-atop';
  for (const G of block.glyphs) { q.save(); q.translate(G.ox + dx, G.oy + dy); innerShadow(q, G, 'rgba(0,0,0,0.32)', 2, 3, 2); q.restore(); }
  q.restore();
  // the deboss: every letter bit the paper, inked or not (light on the lower-right inner edge, shade on the upper-left)
  const D = canvas2d(SW, SH), r = D.g;
  for (const G of block.glyphs) { r.save(); r.translate(G.ox + dx, G.oy + dy); innerShadow(r, G, 'rgba(60,40,20,0.30)', 3, 4, 3); innerShadow(r, G, 'rgba(255,250,235,0.55)', -2, -3, 2); r.restore(); }
  return { ink: L.cv, deboss: D.cv, block };
}
const ruleL = (q, y, w = 4, x0 = 60, x1 = SW - 60) => { q.fillStyle = INK; q.globalAlpha = 0.92; q.fillRect(x0, y, x1 - x0, w); q.globalAlpha = 1; };
function bodyColumns(q, text, y0, y1, frac = 1, seed = 7) {
  const bf = F.body, bs = 26 / 0.7, colW = (SW - 160) / 2, lines = [], words = text.split(/\s+/).filter(Boolean); let k = 0;
  while (k < words.length) { let line = ''; while (k < words.length) { const nx = (line ? line + ' ' : '') + words[k]; if (bf.getAdvanceWidth(nx, bs) > colW && line) break; line = nx; k++; } lines.push(line); }
  const per = Math.floor((y1 - y0) / 42), n = Math.min(lines.length, per * 2), stop = per + Math.round(per * frac);
  q.fillStyle = INK;
  for (let i = 0; i < Math.min(n, stop); i++) { const col = i < per ? 0 : 1; bf.getPath(lines[i], 60 + col * (colW + 40), y0 + 30 + (i % per) * 42, bs).draw(q); }
  q.fillRect(SW / 2 - 1, y0, 2, per * 42 + 6);
  const rr = rng(seed); q.save(); q.globalCompositeOperation = 'destination-out'; salt(q, rr, 40, y0, SW - 80, y1 - y0, 700); q.restore();
}
// the 1776 text (the engrossed Declaration's first sentence, sub-legible at feed size); the forme is short: the right column stops
const BODY1776 = 'When in the Course of human events, it becomes necessary for one people to dissolve the political bands which have connected them with another, and to assume among the powers of the earth, the separate and equal station to which the Laws of Nature and of Nature\'s God entitle them, a decent respect to the opinions of mankind requires that they should declare the causes which impel them to the separation. We hold these truths to be self-evident, that all men are created equal,';

// ---- the 1776 sheet's forme
const CW = SW - 120;
const capT = Math.min(132, 132 * CW / measure(F.cond, 'PRODUCTION.', 132));          // the triad at one size: what PRODUCTION. allows
const BK = {
  date: setBlock(F.wood, [{ text: '1776.', cap: 196 }], { role: 'payoff', x: SW / 2, y: 178, maxW: CW }),
  unf: setBlock(F.cond, [{ text: 'UNFINISHED.', fill: true, max: 210 }], { role: 'payoff', x: SW / 2, y: 425, maxW: CW }),
  life: setBlock(F.cond, [{ text: 'LIFE.', cap: capT }], { role: 'payoff', x: SW / 2, y: 650, maxW: CW }),
  lib: setBlock(F.cond, [{ text: 'LIBERTY.', cap: capT }], { role: 'payoff', x: SW / 2, y: 650 + capT * 1.32, maxW: CW }),
  prod: setBlock(F.cond, [{ text: 'PRODUCTION.', cap: capT }], { role: 'payoff', x: SW / 2, y: 650 + capT * 2.64, maxW: CW }),
};
const yBody = 650 + capT * 2.64 + capT * 0.5 + 40;
// ---- the 2036 sheet's forme: the dateline reset, the space for FINISH IT. (two lines, the largest type), the triad set whole and smaller
const capT2 = Math.min(84, 84 * CW / measure(F.cond, 'PRODUCTION.', 84));
const fin = (() => { const c1 = Math.min(330, 330 * (CW - 20) / measure(F.cond, 'FINISH', 330)), c2 = c1;
  return setBlock(F.cond, [{ text: 'FINISH', cap: c1 }, { text: 'IT.', cap: c2 }], { role: 'payoff', x: SW / 2, y: TAKE === 'b' ? 690 : 660, maxW: CW, gap: 0.12 }); })();
const BK2 = {
  date: setBlock(F.wood, [{ text: '2036.', cap: 196 }], { role: 'payoff', x: SW / 2, y: 178, maxW: CW }),
  sub: setBlock(F.cond, [{ text: 'A SECOND INDEPENDENCE.', fill: true, max: 80 }], { role: 'payoff', x: SW / 2, y: 345, maxW: CW }),
  fin,
  life: setBlock(F.cond, [{ text: 'LIFE.', cap: capT2 }], { role: 'payoff', x: SW / 2, y: 1075, maxW: CW }),
  lib: setBlock(F.cond, [{ text: 'LIBERTY.', cap: capT2 }], { role: 'payoff', x: SW / 2, y: 1075 + capT2 * 1.25, maxW: CW }),
  prod: setBlock(F.cond, [{ text: 'PRODUCTION.', cap: capT2 }], { role: 'payoff', x: SW / 2, y: 1075 + capT2 * 2.5, maxW: CW }),
};
const I = {                                                 // every impression, made once
  date: impression(BK.date, INK, { seed: 3, saltN: 1300 }),
  unf: impression(BK.unf, INK, { seed: 5, saltN: 1400, starve: [BK.unf.bbox.x1 + (BK.unf.bbox.x2 - BK.unf.bbox.x1) * 0.38, BK.unf.bbox.x1 + (BK.unf.bbox.x2 - BK.unf.bbox.x1) * 0.66] }),
  life: impression(BK.life, INK, { seed: 7 }), lib: impression(BK.lib, INK, { seed: 9 }),
  prod: impression(BK.prod, RED, { seed: 11, dx: 3, dy: -2, saltN: 1100 }),
  date2: impression(BK2.date, INK, { seed: 13, saltN: 1300 }), sub2: impression(BK2.sub, INK, { seed: 15, saltN: 500 }),
  fin: impression(BK2.fin, RED, { seed: 17, dx: 3, dy: -2, saltN: 2200 }),
  life2: impression(BK2.life, INK, { seed: 19, saltN: 500 }), lib2: impression(BK2.lib, INK, { seed: 21, saltN: 500 }),
  prod2: impression(BK2.prod, RED, { seed: 23, dx: 3, dy: -2, saltN: 500 }),
};
const P1 = paperStock({ w: SW, h: SH, seed: 4, base: PAPER, tooth: 12, fibres: 2200, burn: 0.16 });
const P2 = paperStock({ w: SW, h: SH, seed: 40, base: PAPER, tooth: 12, fibres: 2200, burn: 0.1 });
// the frame of each sheet that is not a display line: rules, the body, the imprint (and on the 2036 sheet the Party's mark at the foot)
const furniture1 = (() => { const L = canvas2d(SW, SH), q = L.g;
  ruleL(q, 40, 4); ruleL(q, 50, 1.5); ruleL(q, 302, 4); ruleL(q, 312, 1.5); ruleL(q, 545, 3);
  ruleL(q, yBody - 22, 3); bodyColumns(q, BODY1776, yBody, SH - 150, 0.45, 31);
  ruleL(q, SH - 120, 2); return L.cv; })();
const furniture2 = (() => { const L = canvas2d(SW, SH), q = L.g;
  ruleL(q, 40, 4); ruleL(q, 50, 1.5); ruleL(q, 302, 4); ruleL(q, 312, 1.5); ruleL(q, 1010, 3);
  ruleL(q, SH - 210, 2);
  q.save(); drawLockup(q, SW / 2, SH - 105, 118, { color: INK }); q.restore();
  const rr = rng(77); q.save(); q.globalCompositeOperation = 'destination-out'; salt(q, rr, SW / 2 - 220, SH - 190, 440, 170, 700); q.restore();
  return L.cv; })();
// compose a sheet from its paper, its furniture and the impressions on it (multiply: ink into the paper), the deboss first
function sheet(paper, furn, parts) {
  const L = canvas2d(SW, SH), g = L.g; g.drawImage(paper, 0, 0);
  g.save(); g.globalCompositeOperation = 'multiply';
  if (furn) g.drawImage(furn, 0, 0);
  for (const p of parts) g.drawImage(I[p].deboss, 0, 0);
  for (const p of parts) g.drawImage(I[p].ink, 0, 0);
  g.restore(); g.getImageData(0, 0, 1, 1); return L.cv;
}
const S = {
  s0: sheet(P1, furniture1, ['date']), s1: sheet(P1, furniture1, ['date', 'unf']), s2: sheet(P1, furniture1, ['date', 'unf', 'life']),
  s3: sheet(P1, furniture1, ['date', 'unf', 'life', 'lib']), s4: sheet(P1, furniture1, ['date', 'unf', 'life', 'lib', 'prod']),
  s5b: sheet(P2, null, ['sub2']),
  s5: sheet(P2, furniture2, [...(TAKE === 'b' ? ['sub2'] : []), 'date2', 'life2', 'lib2', 'prod2']),
  s6: sheet(P2, furniture2, [...(TAKE === 'b' ? ['sub2'] : []), 'date2', 'life2', 'lib2', 'prod2', 'fin']),
};
// a pull: the platen recipe (type_press.platenPress) with the block that is in the forme, opening on the sheet it makes
const pullOf = (hitBeat, block, ink, sheetCv, off = [0, 0]) => platenPress({ faces: { wood: F.wood, cond: F.cond }, hit: bt(hitBeat), seed: 12 + hitBeat,
  sheetOf: { blocks: { l2: block }, redOffset: off, red: ink, w: SW, sheet: sheetCv }, sx: SX, sy: SY });

// ================================================================ the timeline (beats; the score's lines are songs2/s1776_f.py CUES)
// each press shot: [from beat, to beat, the pull, the camera (zoom, focus y on the sheet in sheet px, drift per beat)]
const PULL = {
  p0: pullOf(TAKE === 'c' ? 2 : -4, BK.date, INK, S.s0), p1: pullOf(4, BK.unf, INK, S.s1), p2: pullOf(8, BK.life, INK, S.s2),
  p3: pullOf(10, BK.lib, INK, S.s3), p4: pullOf(12, BK.prod, RED, S.s4, [3, -2]),
  p5b: pullOf(22, BK2.sub, INK, S.s5b), p5: pullOf(24, BK2.date, INK, S.s5), p6: pullOf(28, BK2.fin, RED, S.s6, [3, -2]),
};
const PRESS = TAKE === 'c'
  ? [[0, 3.3, 'p0', { z: 1.0, fy: 178, z1: 1.14 }]]
  : [[0, 2.85, 'p0', { z: 1.2, fy: 230, z1: 1.12 }]];
PRESS.push([PRESS[0][1], 7.6, 'p1', { z: 1.24, fy: 340, z1: 1.16 }], [7.6, 9.6, 'p2', { z: 1.34, fy: 640, z1: 1.3 }], [9.6, 11.0, 'p3', { z: 1.3, fy: 740, z1: 1.27 }],
  [11.0, 16, 'p4', { z: 1.28, fy: 900, z1: 1.04, ease: 2.5 }]);
const PEOPLE1 = [16, TAKE === 'b' ? 21.6 : 23.6];
if (TAKE === 'b') PRESS.push([21.6, 23.6, 'p5b', { z: 1.25, fy: 345, z1: 1.2 }]);
PRESS.push([23.6, 27.6, 'p5', { z: 1.16, fy: 330, z1: 1.04 }], [27.6, 31, 'p6', { z: 1.06, fy: 640, z1: 1.12 }]);
const PEOPLE2 = [31, 35];
PRESS.push([35, 99, 'p6', { z: 1.0, fy: SH / 2 - 10, z1: 1.0 }]);
// where each pull's forme is seen: from this many seconds before its hit (the rollers' last pass, the platen shutting)
const FORME_LEAD = { p0: 99, p1: 0.62, p2: 0.32, p3: 0.32, p4: 0.7, p5b: 0.4, p5: 0.42, p6: 0.45 };

function pressShot(t, beat, [b0, b1, key, cam]) {
  const R = PULL[key], hit = R.hit, a = t - hit;
  const formeView = a < 0;
  ctx.save();
  if (!formeView) {                                           // the camera on the sheet: a push or a pull across the shot
    const u = clamp((beat - Math.max(b0, (hit / B.spb))) / Math.max(0.5, b1 - Math.max(b0, hit / B.spb)));
    const k = cam.ease ? 1 - Math.pow(1 - u, cam.ease) : ease.inOutCubic(u);
    const z = lerp(cam.z, cam.z1 ?? cam.z, k), fy = SY + cam.fy, cy = clamp(fy, H / 2 / z, H - H / 2 / z);
    ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -cy);
  }
  else {                                                      // the forme: the camera comes down close on the type in the chase (top-anchored,
    const bb = R.block.bbox, zf = clamp(Math.min(1.6, 980 / ((bb.x2 - bb.x1) * 1.14)), 1, 1.6);   // so the iron never shows an edge)
    ctx.translate(W / 2, 0); ctx.scale(zf, zf); ctx.translate(-W / 2, 0);
  }
  R.draw(ctx, t);
  ctx.restore();
}

// ================================================================ the people: the sheet hung at the back of the shop, a crowd before it
const glc = document.createElement('canvas'); glc.width = W; glc.height = H;
const renderer = new THREE.WebGLRenderer({ canvas: glc, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H, false); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, W / H, 0.05, 120);
scene.background = new THREE.Color('#0b0907');
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const canvasTex = (cv, srgb = true) => { const t = new THREE.CanvasTexture(cv); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
// the shop: a plank floor worn dark, a back wall of old brick in shadow, the drying line, the hung sheet
const floorCv = (() => { const L = canvas2d(512, 512), q = L.g, r = rng(5); q.fillStyle = '#2a221b'; q.fillRect(0, 0, 512, 512);
  for (let x = 0; x < 512; x += 32) { const v = 30 + r() * 18; q.fillStyle = `rgb(${v + 8},${v},${v - 6})`; q.fillRect(x, 0, 31, 512); q.fillStyle = 'rgba(0,0,0,0.5)'; q.fillRect(x + 31, 0, 1, 512); }
  for (let k = 0; k < 900; k++) { q.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '120,100,80'},${0.05 + r() * 0.1})`; q.fillRect(r() * 512, r() * 512, 1 + r() * 2, 4 + r() * 30); }
  return L.cv; })();
const floorT = canvasTex(floorCv); floorT.wrapS = floorT.wrapT = THREE.RepeatWrapping; floorT.repeat.set(6, 6);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ map: floorT, roughness: 0.85 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
// the wall carries the red: an emissive map whose lit part rises with the tide (hard-edged, the poster's red; no glow)
const wallCv = (() => { const L = canvas2d(512, 512), q = L.g, r = rng(9); q.fillStyle = '#3a2a22'; q.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 512; y += 22) for (let x = (y / 22) % 2 ? -22 : 0; x < 512; x += 44) { const v = 44 + r() * 22; q.fillStyle = `rgb(${v + 14},${v * 0.72 | 0},${v * 0.55 | 0})`; q.fillRect(x + 1, y + 1, 42, 20); }
  return L.cv; })();
const wallT = canvasTex(wallCv); wallT.wrapS = wallT.wrapT = THREE.RepeatWrapping; wallT.repeat.set(4, 2);
const tideCv = canvas2d(64, 256), tideT = canvasTex(tideCv.cv);
const wallM = new THREE.MeshStandardMaterial({ map: wallT, roughness: 0.95, emissive: new THREE.Color('#ff1a1a'), emissiveMap: tideT, emissiveIntensity: 0 });
const wall = new THREE.Mesh(new THREE.PlaneGeometry(26, 12), wallM); wall.position.set(0, 6, -3.6); wall.receiveShadow = true; scene.add(wall);
function setTide(u) {                                          // u 0..1: how far up the wall the red has risen (hard edge, a little ragged)
  const q = tideCv.g; q.fillStyle = '#000'; q.fillRect(0, 0, 64, 256); if (u <= 0) { tideT.needsUpdate = true; wallM.emissiveIntensity = 0; return; }
  q.fillStyle = '#fff'; q.beginPath(); q.moveTo(0, 256); for (let x = 0; x <= 64; x += 4) q.lineTo(x, 256 - u * 270 + 3 * Math.sin(x * 0.7 + u * 9)); q.lineTo(64, 256); q.closePath(); q.fill();
  tideT.needsUpdate = true; wallM.emissiveIntensity = 0.9;
}
// the hung sheet: a plane carrying the sheet's canvas, pegged at the top, the paper sagging a little between the pegs
const SHW = 1.8, SHH = SHW * SH / SW, SHY = 1.12;
// the hung sheet's texture as plain pixels (a DataTexture, rows flipped for the plane's UVs): a canvas texture of the sheet dropped out of some
// farm frames (c20 take a, 15 Oct: the sheet missing on scattered frames, the wall seen through it)
const dataTex = cv => { const id = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height), w = cv.width, h = cv.height, a = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) a.set(id.data.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  const t = new THREE.DataTexture(a, w, h, THREE.RGBAFormat); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true; return t; };
const sheetTex = { s4: dataTex(S.s4), s6: dataTex(S.s6) };
const sheetGeo = new THREE.PlaneGeometry(SHW, SHH, 24, 24);
{ const p = sheetGeo.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), u = (x / SHW + 0.5), v = 0.5 - y / SHH;
  p.setZ(i, 0.05 * Math.sin(Math.PI * u) * v + 0.02 * Math.sin(u * 9) * v); p.setY(i, y - 0.04 * Math.sin(Math.PI * u) * (0.3 + v)); } sheetGeo.computeVertexNormals(); }
const sheetM = new THREE.MeshStandardMaterial({ map: sheetTex.s4, roughness: 0.9, side: THREE.DoubleSide });
const hung = new THREE.Mesh(sheetGeo, sheetM); hung.position.set(0, SHY + SHH / 2, -3.35); hung.castShadow = false; hung.receiveShadow = true; hung.frustumCulled = false; scene.add(hung);
const lineM = new THREE.MeshStandardMaterial({ color: '#1d1712', roughness: 0.7 });
{ const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 12, 6), lineM); cord.rotation.z = Math.PI / 2; cord.position.set(0, SHY + SHH + 0.02, -3.33); scene.add(cord);
  for (const x of [-SHW / 2 + 0.12, SHW / 2 - 0.12]) { const peg = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.13, 0.03), new THREE.MeshStandardMaterial({ color: '#b89a6a', roughness: 0.6 })); peg.position.set(x, SHY + SHH - 0.02, -3.31); scene.add(peg); } }
// light: one hanging lamp over the sheet (warm, hard, the shop's only key), a low fill from the open door behind us, a dim sky
const lamp = new THREE.SpotLight('#ffd7a0', 150, 18, 0.62, 0.45, 1.5); lamp.position.set(0.3, 5.2, -0.9); lamp.target.position.set(0, 2.2, -3.3);
lamp.castShadow = true; lamp.shadow.mapSize.set(2048, 2048); lamp.shadow.bias = -0.0004; scene.add(lamp, lamp.target);
const fill = new THREE.PointLight('#c9a27a', 40, 16, 1.6); fill.position.set(-2.2, 2.6, 7.5); scene.add(fill);
const redFill = new THREE.PointLight('#ff2010', 0, 14, 1.4); redFill.position.set(0, 1.2, -2.8); scene.add(redFill);
scene.add(new THREE.HemisphereLight('#4a3a30', '#0a0806', 0.35));
// the people: the person pipeline's crowd (People draws the current person's cast; bodies, ages and builds from workforce.workerDesc)
const folk = new People(scene, { max: 64, viewH: H, lodPx: [240, 60], budget: [40, 64], shadows: 'proxy' });
const A = await loadAnsur(), rn = mulberry32(1776);
const TRADES = ['shirt', 'shirt', 'rail', 'overalls', 'farm', 'coverall', 'shirt', 'weld', 'coverall', 'rail'];
// places before the sheet, in the order they are taken: one reader, then two, a row, then the crowd filling the space toward us (the
// nearest are only shoulders and heads at the foot of the frame: we stand among them)
const PLACES = [];
{ const r = rng(36), add = (x, z) => PLACES.push({ x, z });
  add(0.12, -1.75);                                                          // 1: the first, alone, reading
  add(-0.62, -1.45); add(0.68, -1.3);                                        // 2-3
  add(-1.05, -0.95); add(-0.12, -0.9); add(0.95, -0.8);                      // 4-6: a row
  for (const [x, z] of [[-1.5, -0.4], [-0.62, -0.35], [0.3, -0.3], [1.3, -0.25], [-1.05, 0.05], [0.82, 0.1]]) add(x, z);   // 7-12
  for (let k = 0; k < 12; k++) add((r() - 0.5) * 2.8, 0.15 + r() * 0.45);   // 13-24: the crowd
  for (let k = 0; k < 8; k++) add((r() - 0.5) * 2.0, 0.6 + r() * 0.35); }   // 25-32: and at our shoulder
// arrival beats, counted up on the beat: one (b17), two (b18), a row (b19), six (b20), then the crowd (b21-23)
const ARR = [17, 18, 18, 19, 19, 19, 20, 20, 20, 20, 20, 20];
for (let i = ARR.length; i < PLACES.length; i++) ARR.push(21 + Math.floor((i - ARR.length) / 4) * 0.5);
if (TAKE === 'b') for (let i = 0; i < ARR.length; i++) ARR[i] = 16.5 + (ARR[i] - 17) * 0.75;   // take b's people end at b21.6
const P = PLACES.map((pl, i) => {
  const d = workerDesc(A, rn, { trade: TRADES[i % TRADES.length], age: [19, 64], cloth: true });
  const id = folk.add(d), side = pl.x < 0 ? -1 : 1, fromZ = pl.z + 0.3 + rn() * 0.9;
  return { id, d, ...pl, arr: ARR[i], from: { x: side * (2.6 + rn() * 1.2), z: fromZ }, head: Math.PI + (rn() - 0.5) * 0.35 + -pl.x * 0.06, look: (rn() - 0.5) * 0.5 };
});
function placePeople(t, beat, finalShot) {
  for (const p of P) {
    const g = p.d.gait, walkB = 1.7;                                          // they walk in over the last 2.2 beats before they arrive
    const u = finalShot ? 1 : clamp((beat - (p.arr - walkB)) / walkB);
    if (u <= 0) { folk.set(p.id, { x: p.from.x, z: p.from.z, heading: 0, act: 'stand', t, visible: false }); continue; }
    if (u < 1) {
      const e = ease.outCubic(u), x = lerp(p.from.x, p.x, e), z = lerp(p.from.z, p.z, e);
      const hd = Math.atan2(p.x - p.from.x, p.z - p.from.z), ph = g.ph0 + 6.283 * (u * walkB * B.spb * g.speed) / (1.45 * (p.d.h / 1.78) * g.amt);
      folk.set(p.id, { x, z, heading: hd + Math.atan2(Math.sin(p.head - hd), Math.cos(p.head - hd)) * ease.inCubic(u), act: 'walk', ph, amt: g.amt * (1 - u * 0.6), speed: g.speed / 1.35, t, visible: true });
    } else {
      const since = beat - p.arr;                                             // settled: weight shifts, a glance across, then back to the sheet
      folk.set(p.id, { x: p.x, z: p.z, heading: p.head, act: 'stand', t: t + g.ph0 * 5, look: p.look * Math.exp(-since * 0.4) + 0.12 * Math.sin(t * 0.4 + g.ph0 * 3), visible: true });
    }
  }
}
// the poster: inside the tide, the frame is three inks: the dark is ink, the middle (the red wall, the lit shoulders and heads) is
// the red, the light (the sheet) is the cream knocked out; a hard, slightly ragged edge rising up the frame
const TIDE0 = TAKE === 'b' ? 18.3 : 19.5;
const C_INK = [24, 12, 11], C_RED = [196, 22, 28], C_CREAM = [238, 228, 206];
function poster(u, seed) {
  if (u <= 0) return;
  const y0 = Math.round(H * (1 - u)), img = ctx.getImageData(0, y0 - 8 < 0 ? 0 : y0 - 8, W, H - Math.max(0, y0 - 8)), d = img.data, oy = Math.max(0, y0 - 8);
  for (let y = 0; y < img.height; y++) {
    const Y = y + oy;
    for (let x = 0; x < W; x++) {
      const edge = y0 + 6 * Math.sin(x * 0.021 + seed) + 3 * Math.sin(x * 0.11 + seed * 2.3);
      if (Y < edge) continue;
      const i = (y * W + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
      const L = 0.2126 * r + 0.7152 * g + 0.0722 * b, red = r - (g + b) / 2;
      const c = (red > 70 && r > 110) ? C_RED : L > 150 ? C_CREAM : (L > 46 || red > 40) ? C_RED : C_INK;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
    }
  }
  ctx.putImageData(img, 0, oy);
}
function peopleShot(t, beat, finalShot) {
  const [b0, b1] = finalShot ? PEOPLE2 : PEOPLE1, u = clamp((beat - b0) / (b1 - b0));
  sheetM.map = finalShot ? sheetTex.s6 : sheetTex.s4;
  // the tide: none for the first arrivals, then it rises with the crowd (b19.5 -> b23); in the last shot it is already full
  const tide = finalShot ? 1 : clamp((beat - TIDE0) / 3.2);
  setTide(tide); redFill.intensity = 40 * tide;
  placePeople(t, beat, finalShot);
  // the camera: behind the crowd at standing height, looking up at the sheet; a slow push (and the last shot a slower one)
  const z0 = finalShot ? 2.9 : 3.3, z1 = finalShot ? 2.25 : 2.5, cz = lerp(z0, z1, ease.inOutCubic(u));
  camera.position.set(0.08 - 0.12 * u, 1.58 + 0.03 * Math.sin(t * 0.7), cz); camera.lookAt(0, SHY + SHH * 0.44, -3.35);
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  folk.update(camera);
  renderer.render(scene, camera);
  ctx.drawImage(glc, 0, 0);
  // the poster's hard edge rises up the FRAME with the red on the wall
  poster(finalShot ? 1 : clamp((beat - TIDE0 - 0.5) / (TAKE === 'b' ? 2.6 : 3.0)), 3.1);
}

// ================================================================ frame
window.renderFrame = (t) => {
  const beat = B.beat(t) + 1e-6, frame = Math.round(t * 30);
  ctx.save(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  const inPeople = (beat >= PEOPLE1[0] && beat < PEOPLE1[1]) ? 1 : (beat >= PEOPLE2[0] && beat < PEOPLE2[1]) ? 2 : 0;
  if (inPeople) {
    peopleShot(t, beat, inPeople === 2);
    finish.apply(ctx, frame, { grain: 0.06, vignette: 0.45 });
  } else {
    let shot = PRESS.find(s => beat >= s[0] && beat < s[1]) || PRESS[PRESS.length - 1];
    // a shot whose pull is still ahead shows the previous sheet until its forme is due
    const R = PULL[shot[2]], lead = FORME_LEAD[shot[2]];
    if (t < R.hit - lead) { const i = PRESS.indexOf(shot); if (i > 0) shot = PRESS[i - 1]; }
    pressShot(t, beat, shot);
    finish.apply(ctx, frame, { grain: 0.05, vignette: 0.4 });
  }
  ctx.restore();
};
window.pieceInfo = () => ({ take: TAKE, capT, capT2, fin: fin.caps, words: { date: BK.date.cap, unf: BK.unf.cap } });
ready = true;
