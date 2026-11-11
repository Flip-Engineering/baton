// THE SECOND PASS (concept packet 20261018-the-second-pass-v1, v1.0.0).
//
// One argument in four movements, 1080x1920 / 30 fps / 60.0 s / 120 BPM. Every composition exists
// twice: Strip A is a public-domain 1919 steel plate in ACP red, Strip B is procedural cleanroom,
// wafer and grid linework in steel blue and cream. The registration error is 12 px at the hook,
// 8 px through the relay, 3 px in the argument and 0 px at the mark. The strips share one camera
// and one cut; only the register changes.
//
// Source pins: the packet's ASSETS.md lists the plates, the kit, closer and fx blobs. This scene adds
// only second_pass.{html,js,plates.js,fab.js}; no existing scene, script or library is edited.
// Text: 3 words maximum, one line, no stacked cards. The hook is on frame 0; the closer is 1.4 s.
import {
  W, H, C, loadFonts, loadBeats, Finish, outCanvas, cue, clamp, lerp, ease, smooth, closer,
} from '../lib/kit.js';
import { drawLockup } from '../lib/closer.js';
import { loadPlates, drawPlate, weave, registrationMarks, glow, embers } from './second_pass.plates.js';
import * as FAB from './second_pass.fab.js';

const BPM = 120, SPB = 0.5, END = 60.0, CLOSER_B = 117.2;
const ctx = outCanvas();
window.DURATION = END;

window.__boot = 'start';
await loadFonts();
window.__boot = 'fonts';
const PL = await loadPlates();
window.__boot = 'plates';
let B = null;
try { B = await loadBeats('second_pass'); } catch (e) { console.log('second_pass: no hits.json; nominal 120 BPM grid'); }
window.__boot = 'beats';
const beatOf = t => (B ? B.beat(t) : t / SPB);
const spb = B ? B.spb : SPB;
const finish = new Finish(2036);

const CUES = [
  { s: 0, e: 2, text: 'SAME HANDS.', red: false },
  { s: 2, e: 6, text: 'FIRST PASS.', red: false },
  { s: 6, e: 10, text: '1908.', red: false },
  { s: 10, e: 16, text: 'POUR. RAIL. WORKS.', red: true },
  { s: 16, e: 20, text: 'COIL.', red: false },
  { s: 20, e: 24, text: 'HAUL.', red: false },
  { s: 24, e: 28, text: 'SECOND PASS.', red: false },
  { s: 28, e: 34, text: '2036.', red: false },
  { s: 34, e: 40, text: 'SAME HANDS.', red: false },
  { s: 40, e: 48, text: 'THE MACHINE', red: false },
  { s: 48, e: 54, text: 'IS OURS.', red: true },
  { s: 54, e: 60, text: 'THE PASS', red: false },
  { s: 60, e: 68, text: 'IS OURS.', red: true },
  { s: 68, e: 76, text: 'PRODUCTION', red: false },
  { s: 76, e: 84, text: 'AFTER PROFIT.', red: false },
  { s: 88, e: 96, text: 'COMMON WEALTH.', red: false },
  { s: 96, e: 104, text: 'NO BRAKES.', red: false },
  { s: 104, e: 112, text: 'A DRIVER.', red: false },
];

// 12 -> 8 through the relay, 8 -> 3 in the argument, 3 -> 0 at the register.
function offsetAt(b) {
  if (b < 16) return 12;
  if (b < 40) return lerp(12, 8, smooth(16, 40, b));
  if (b < 84) return lerp(8, 3, smooth(40, 84, b));
  if (b < 88) return lerp(3, 0, smooth(84, 88, b));
  return 0;
}
// Crosshairs only while the register changes.
function crossAt(b) {
  let a = 0;
  for (const d of [16, 40, 84]) {
    const x = Math.abs(b - d);
    if (x < 2.5) a = Math.max(a, (1 - x / 2.5) * 0.9);
  }
  return a;
}

function clipHalf(side, fn) {
  ctx.save();
  ctx.beginPath();
  if (side === 'left') ctx.rect(0, 0, W / 2, H); else ctx.rect(W / 2, 0, W / 2, H);
  ctx.clip(); fn(); ctx.restore();
}
function aPlate(name, o = {}) { drawPlate(ctx, PL[name], { variant: 'red', ...o }); }
function bAt(off, fn) { ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.translate(-off, off * 0.35); fn(); ctx.restore(); }
function strokeLine(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }

function pourStream(x, alpha) {
  if (alpha <= 0) return;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(244,230,208,0)');
  g.addColorStop(0.18, `rgba(245,160,120,${0.55 * alpha})`);
  g.addColorStop(0.45, `rgba(201,31,55,${0.95 * alpha})`);
  g.addColorStop(1, `rgba(120,8,14,${0.6 * alpha})`);
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(x - 23, 0, 46, H);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#F4E6D0';
  ctx.fillRect(x - 4, H * 0.18, 8, H * 0.34);
  glow(ctx, x, H * 0.38, 230, 'rgba(201,31,55,0.7)', alpha);
  ctx.restore();
}

function coil(ctx, u, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = FAB.STEEL; ctx.lineWidth = 3;
  const cx = W * 0.54, cy = H * 0.48;
  for (let i = 0; i < 11; i++) {
    const r = 42 + i * 24, a0 = i * 0.42 + u * 4.2;
    ctx.beginPath(); ctx.ellipse(cx, cy, r * 1.06, r * 0.52, -0.28, a0, a0 + 4.6); ctx.stroke();
  }
  ctx.globalAlpha = alpha * 0.8;
  ctx.strokeStyle = FAB.CREAM; ctx.lineWidth = 5;
  strokeLine(cx - 250, cy + 210, cx + 260, cy - 210);
  ctx.restore();
}

// The mark forming out of the registered strips.
function formingMark(ctx, u) {
  const e = ease.inOutCubic(clamp(u));
  ctx.save();
  ctx.globalAlpha = 0.4 + 0.6 * e;
  const gap = lerp(W * 0.24, 0, e);
  ctx.fillStyle = FAB.RED; ctx.fillRect(gap - 9, 0, 18, H);
  ctx.fillStyle = FAB.BLUE; ctx.fillRect(W - gap - 9, 0, 18, H);
  ctx.restore();
  const s = lerp(150, 224, e);
  drawLockup(ctx, W / 2, H * 0.46, s, { color: C.cream, accent: C.red2, alpha: clamp((e - 0.32) * 2.4) });
}

function frame(t) {
  const b = beatOf(t);
  const frozen = b >= 48 && b < 54;
  const tb = frozen ? 48 * spb : t;
  const bb = frozen ? 48 : b;
  const sep = offsetAt(bb), off = sep / 2;
  const frameNo = Math.round(t * 30);
  const wv = weave(tb, 11);

  ctx.fillStyle = C.black;
  ctx.fillRect(0, 0, W, H);

  if (b >= CLOSER_B) {
    closer(ctx, (b - CLOSER_B) * spb);
    finish.apply(ctx, frameNo, { grain: 0.055, vignette: 0.75, flash: 0 });
    return;
  }

  // ---------------------------------------------------------------- I. First pass (b0-b16)
  if (bb < 2) {
    const u = clamp(bb / 2);
    ctx.fillStyle = '#070607'; ctx.fillRect(0, 0, W, H);
    // Reveal the red plate from black while the pour edge enters.
    const reveal = ease.inOutCubic(u);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W * reveal, H); ctx.clip();
    ctx.globalAlpha = 0.35 + 0.65 * u;
    aPlate('pour', { u, zoom: 1.35, zoom1: 1.45, fx: 0.5, fy: 0.5, dx: off, dy: wv.y, alpha: 0.55 });
    ctx.restore();
    pourStream(W * 0.66 + off + (1 - u) * W * 0.16, u);
    bAt(off, () => {
      ctx.globalAlpha = 0.55 * u; ctx.strokeStyle = FAB.BLUE; ctx.lineWidth = 3;
      strokeLine(W * 0.66 + W * 0.16, 0, W * 0.66 + W * 0.16, H);
      FAB.wafer(ctx, { u: 0, cx: W * 0.52, cy: H * 0.46, r: 120, alpha: 0.28 * u, ignite: 0 });
    });
  } else if (bb < 6) {
    const u = (bb - 2) / 4;
    aPlate('puddler', { u, zoom: 1.26, zoom1: 1.42, fx: 0.55, fy: 0.44, dx: off + wv.x, dy: wv.y, rot: wv.rot });
    bAt(off, () => {
      FAB.wafer(ctx, { u, cx: W * 0.52, cy: H * 0.48, r: 250, alpha: 0.42, ignite: 0, rot: u * 0.25 });
      FAB.robotArm(ctx, { u: 0.2 + 0.2 * u, cx: W * 0.5, cy: H * 0.48, scale: 0.8, alpha: 0.34 });
    });
    glow(ctx, W * 0.5, H * 0.38, 420, 'rgba(201,31,55,0.28)', 0.6);
  } else if (bb < 10) {
    const u = (bb - 6) / 4;
    aPlate('puddler', { u, zoom: 1.45, zoom1: 1.6, fx: 0.58, fy: 0.5, dx: off + wv.x, dy: wv.y, rot: wv.rot });
    bAt(off, () => {
      FAB.wafer(ctx, { u, cx: W * 0.58, cy: H * 0.5, r: 190, alpha: 0.25, ignite: 0, rot: -0.2 });
    });
  } else if (bb < 16) {
    const u = (bb - 10) / 6;
    const n = bb < 12 ? 'bar' : bb < 14 ? 'dock' : 'gary_crowd';
    aPlate(n, { u: (bb % 2) / 2, zoom: 1.2, zoom1: 1.32, fx: 0.5, fy: 0.5, dx: off + wv.x, dy: wv.y, rot: wv.rot });
    bAt(off, () => {
      if (bb < 12) FAB.powerGrid(ctx, { u: 0.3 + u * 0.7, alpha: 0.28 });
      else if (bb < 14) FAB.fabCorridor(ctx, { u, alpha: 0.24 });
      else FAB.town(ctx, { u: 0.4 + u * 0.6, alpha: 0.32 });
    });
    embers(ctx, tb, 34, { alpha: 0.28, color: '#F4E6D0' });
  }

  // ---------------------------------------------------------------- II. Relay (b16-b40)
  else if (bb < 20) {
    const u = (bb - 16) / 4;
    aPlate('bar', { u, zoom: 1.2, zoom1: 1.38, fx: 0.42, fy: 0.55, dx: off + wv.x, dy: wv.y, rot: wv.rot });
    bAt(off, () => coil(ctx, u, 0.78));
  } else if (bb < 24) {
    const u = (bb - 20) / 4;
    aPlate('pickets', { u, zoom: 1.1, zoom1: 1.22, fx: 0.46, fy: 0.5, dx: off + wv.x, dy: wv.y, rot: wv.rot });
    bAt(off, () => FAB.fabCorridor(ctx, { u, alpha: 0.55 }));
    embers(ctx, tb, 24, { alpha: 0.2 });
  } else if (bb < 28) {
    const u = (bb - 24) / 4;
    aPlate('dock', { u, zoom: 1.12, zoom1: 1.24, fx: 0.5, fy: 0.46, dx: off + wv.x, dy: wv.y, alpha: 0.38, rot: wv.rot });
    bAt(off, () => FAB.fabCorridor(ctx, { u, alpha: 0.9 }));
    glow(ctx, W * 0.5, H * 0.42, 520, 'rgba(60,130,180,0.32)', 0.8);
  } else if (bb < 34) {
    const u = (bb - 28) / 6;
    aPlate('puddler', { u, zoom: 1.3, zoom1: 1.5, fx: 0.6, fy: 0.55, dx: off + wv.x, dy: wv.y, alpha: 0.45, rot: wv.rot });
    bAt(off, () => {
      FAB.robotArm(ctx, { u: 0.1 + 0.85 * u, cx: W * 0.5, cy: H * 0.48, scale: 1.05, alpha: 0.95 });
      FAB.wafer(ctx, { u, cx: W * 0.54, cy: H * 0.66, r: 235, alpha: 0.85, ignite: 0.18 * u, rot: 0.1 });
    });
  } else if (bb < 40) {
    const u = (bb - 34) / 6;
    aPlate('dock', { u, zoom: 1.3, zoom1: 1.5, fx: 0.5, fy: 0.4, dx: off + wv.x, dy: wv.y, alpha: 0.22, rot: wv.rot });
    bAt(off, () => FAB.wafer(ctx, { u, cx: W * 0.5, cy: H * 0.5, r: 330, alpha: 1, ignite: smooth(0.1, 1, u), rot: 0.16 * u }));
    embers(ctx, tb, 40, { alpha: 0.3, color: '#F4E6D0' });
  }

  // ---------------------------------------------------------------- III. The machine is ours (b40-b88)
  else if (bb < 48) {
    const u = (bb - 40) / 8;
    const swap = Math.floor((bb - 40) / 4) % 2;
    clipHalf(swap ? 'right' : 'left', () => aPlate('puddler', { u, zoom: 1.28, zoom1: 1.42, fx: 0.58, fy: 0.52, dx: off + wv.x, dy: wv.y, rot: wv.rot }));
    clipHalf(swap ? 'left' : 'right', () => bAt(off, () => {
      FAB.wafer(ctx, { u, cx: swap ? W * 0.28 : W * 0.72, cy: H * 0.52, r: 260, alpha: 0.95, ignite: 0.35 + 0.4 * u, rot: u * 0.4 });
      FAB.fabCorridor(ctx, { u, alpha: 0.35 });
    }));
    ctx.fillStyle = C.cream; ctx.fillRect(W / 2 - 2, 0, 4, H);
    embers(ctx, tb, 54, { alpha: 0.3 });
  } else if (bb < 54) {
    // the parasite's freeze: the frame holds, the meter flatlines, the line stops
    aPlate('bar', { u: 0.35, zoom: 1.45, zoom1: 1.45, fx: 0.28, fy: 0.52, dx: off + wv.x, dy: wv.y, alpha: 0.5, rot: wv.rot });
    clipHalf('right', () => bAt(off, () => FAB.wafer(ctx, { u: 0.35, cx: W * 0.72, cy: H * 0.52, r: 300, alpha: 1, ignite: 0.55 })));
    ctx.fillStyle = 'rgba(5,8,10,0.42)'; ctx.fillRect(0, 0, W, H);
    FAB.rentMeter(ctx, { u: 0.25, flat: 1, x: W * 0.78, y: H * 0.16, w: 180, h: 560, alpha: 1 });
    ctx.globalAlpha = 0.9; ctx.strokeStyle = FAB.RED; ctx.lineWidth = 5;
    strokeLine(0, H * 0.5, W, H * 0.5);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(201,31,55,0.55)'; ctx.lineWidth = 2;
    for (let y = 0; y < H; y += 9) strokeLine(0, y, W, y);
  } else if (bb < 60) {
    const u = (bb - 54) / 6;
    aPlate('puddler', { u, zoom: 1.3, zoom1: 1.5, fx: 0.55, fy: 0.55, dx: off + wv.x, dy: wv.y, rot: wv.rot });
    bAt(off, () => {
      FAB.robotArm(ctx, { u: 0.15 + 0.85 * u, cx: W * 0.52, cy: H * 0.5, scale: 1.0, alpha: 0.9 });
      FAB.wafer(ctx, { u, cx: W * 0.56, cy: H * 0.7, r: 210, alpha: 0.8, ignite: 0.55 + 0.3 * u });
    });
  } else if (bb < 68) {
    const u = (bb - 60) / 8;
    clipHalf('left', () => aPlate('puddler', { u, zoom: 1.32, zoom1: 1.46, fx: 0.58, fy: 0.55, dx: off + wv.x, dy: wv.y, rot: wv.rot }));
    clipHalf('right', () => bAt(off, () => FAB.wafer(ctx, { u, cx: W * 0.74, cy: H * 0.52, r: 280, alpha: 1, ignite: 0.7 + 0.3 * u, rot: 0.1 })));
    ctx.fillStyle = C.cream; ctx.fillRect(W / 2 - 2, 0, 4, H);
  } else if (bb < 76) {
    const u = (bb - 68) / 8;
    ctx.save(); ctx.beginPath(); ctx.rect(0, H * 0.46, W, H * 0.54); ctx.clip();
    aPlate('dock', { u, zoom: 1.1, zoom1: 1.2, fx: 0.5, fy: 0.55, dx: off + wv.x, dy: wv.y, alpha: 0.52, rot: wv.rot });
    ctx.restore();
    bAt(off, () => {
      FAB.town(ctx, { u: 0.5 + 0.5 * u, y: H * 0.55, alpha: 0.9 });
      FAB.powerGrid(ctx, { u: 0.4 + 0.6 * u, x: W * 0.06, y: H * 0.24, w: W * 0.88, h: H * 0.3, alpha: 0.42 });
    });
    embers(ctx, tb, 44, { alpha: 0.25, color: '#F4E6D0' });
  } else if (bb < 84) {
    const u = (bb - 76) / 8;
    aPlate('pickets', { u, zoom: 1.18, zoom1: 1.3, fx: 0.5, fy: 0.45, dx: off + wv.x, dy: wv.y, alpha: 0.8, rot: wv.rot });
    bAt(off, () => {
      FAB.town(ctx, { u: 0.8, y: H * 0.62, alpha: 0.45 });
      FAB.powerGrid(ctx, { u: 0.7, x: W * 0.04, y: H * 0.18, w: W * 0.92, h: H * 0.34, alpha: 0.4 });
    });
    ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.25 * u;
    ctx.fillStyle = FAB.RED; ctx.fillRect(0, 0, W, H); ctx.restore();
  } else if (bb < 88) {
    // register begins: the same faces, one red one blue, snap together
    const u = (bb - 84) / 4;
    const o = offsetAt(bb) / 2;
    aPlate('gary_crowd', { u, zoom: 1.22, zoom1: 1.3, fx: 0.5, fy: 0.45, dx: o + wv.x, dy: wv.y, alpha: 0.9, rot: wv.rot });
    bAt(o, () => {
      FAB.powerGrid(ctx, { u: 0.9, x: W * 0.04, y: H * 0.2, w: W * 0.92, h: H * 0.42, alpha: 0.5 });
      FAB.town(ctx, { u: 1, y: H * 0.52, alpha: 0.4 });
    });
  }

  // ---------------------------------------------------------------- IV. Register (b88-b120)
  else if (bb < 96) {
    const u = (bb - 88) / 8;
    ctx.save(); ctx.beginPath(); ctx.rect(0, H * 0.52, W, H * 0.48); ctx.clip();
    aPlate('dock', { u, zoom: 1.1, zoom1: 1.2, fx: 0.5, fy: 0.55, dx: off + wv.x, dy: wv.y, alpha: 0.38, rot: wv.rot });
    ctx.restore();
    bAt(off, () => {
      FAB.town(ctx, { u: 0.7 + 0.3 * u, y: H * 0.5, alpha: 1 });
      FAB.powerGrid(ctx, { u: 0.6 + 0.4 * u, x: W * 0.05, y: H * 0.18, w: W * 0.9, h: H * 0.34, alpha: 0.55 });
    });
    embers(ctx, tb, 58, { alpha: 0.28 });
  } else if (bb < 104) {
    const u = (bb - 96) / 8;
    aPlate('puddler', { u, zoom: 1.7, zoom1: 1.9, fx: 0.62, fy: 0.62, dx: off + wv.x, dy: wv.y, alpha: 0.48, rot: wv.rot });
    bAt(off, () => FAB.controlWheel(ctx, { u, cx: W * 0.5, cy: H * 0.55, r: 290, alpha: 0.95 }));
    glow(ctx, W * 0.5, H * 0.45, 420, 'rgba(201,31,55,0.20)', 0.7);
  } else if (bb < 112) {
    const u = (bb - 104) / 8;
    ctx.save(); ctx.beginPath(); ctx.rect(0, H * 0.56, W, H * 0.44); ctx.clip();
    aPlate('dock', { u, zoom: 1.05, zoom1: 1.12, fx: 0.5, fy: 0.6, dx: off + wv.x, dy: wv.y, alpha: 0.25, rot: wv.rot });
    ctx.restore();
    bAt(off, () => {
      FAB.town(ctx, { u: 0.95, y: H * 0.46, alpha: 1 });
      FAB.powerGrid(ctx, { u: 1, x: W * 0.04, y: H * 0.2, w: W * 0.92, h: H * 0.28, alpha: 0.5 });
    });
    embers(ctx, tb, 70, { alpha: 0.25, color: '#F4E6D0' });
  } else {
    const u = clamp((bb - 112) / (CLOSER_B - 112));
    aPlate('gary_crowd', { u, zoom: 1.2, zoom1: 1.3, fx: 0.5, fy: 0.4, dx: off + wv.x, dy: wv.y, alpha: 0.22, rot: wv.rot });
    bAt(off, () => formingMark(ctx, u));
    glow(ctx, W / 2, H * 0.46, 430, 'rgba(201,31,55,0.25)', 0.7);
  }

  // ---------------------------------------------------------------- the words
  cue(ctx, CUES, b, spb, { y: 1460, size: 218, color: C.cream, red: C.red2, shadow: 34, family: 'Anton', stroke: 0 });
  registrationMarks(ctx, crossAt(bb), { color: C.cream });
  embers(ctx, tb, 16, { alpha: 0.16, color: '#F4E6D0', seed: 19 });

  // a flash on the score's impacts, never on the type alone
  const fl = B ? Math.max(B.env('impact', t, 5) * 0.06, B.env('sting', t, 4) * 0.08) : 0;
  finish.apply(ctx, frameNo, { grain: 0.07, vignette: 0.95, flash: fl });
}

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
window.renderFrame = t => frame(Math.max(0, Math.min(END - 1 / 30, t)));
ready = true;
