// HORDE (v6): the client's red steppe footage is the world. Riders multiplied, stuttered on the war
// drums; a particle charge rides with them, never pictograms. Listen. The horde. Millions.
// We are in your party. Master of all things. The machine rides with us. From the plains
// to the stars. 2036. Arriving. Tartarian steppe neo-Stalinists on the American plain.
//
import { W, H, C, loadFonts, loadBeats, loadImage, clamp, lerp, ease, rng, line, headline,
  Finish, sigil, signoff, closer, outCanvas, seq, cue } from '../lib/kit.js';

const ctx = outCanvas();
await loadFonts();
const B = await loadBeats('horde');
const logo = await loadImage('../assets/acp_logo_dark.png');
const logoRed = await loadImage('../assets/acp_logo.png');
const finish = new Finish(160);
const NF = 511;
const cache = new Map();
async function rider(i) {
  i = ((i % NF) + NF) % NF;
  if (!cache.has(i)) cache.set(i, await loadImage(`../assets/riders/${String(i + 1).padStart(4, '0')}.jpg`));
  return cache.get(i);
}
const bar = t => t / B.barLen;
const GOOD = await (await fetch('../assets/riders_good.json')).json();   // frames with riders in them
const goodFrame = k => GOOD[((k % GOOD.length) + GOOD.length) % GOOD.length];

// ---------------------------------------------------------------- the horde (footage, multiplied)
async function horde(t, { stutter = false, layers = 3, shakeAmt = 0 } = {}) {
  const beat = B.beat(t);
  let k = Math.floor(t * 30);
  if (stutter) k = Math.floor(beat) * 7 + (Math.floor(beat * 8) % 4);      // jump per beat, loop on 32nds
  const kick = Math.max(B.env('kick', t, 10), B.env('taiko', t, 8));
  const dx = Math.sin(t * 83) * shakeAmt * kick, dy = Math.cos(t * 71) * shakeAmt * kick;
  ctx.save();
  ctx.translate(dx, dy);
  ctx.fillStyle = '#d4101c'; ctx.fillRect(-40, -40, W + 80, H + 80);
  // each layer zooms into the band where the riders are (≈52% down the source frame)
  const spec = [
    [0, 1.55, 0, 40, false, 'source-over'],
    [71, 1.15, -120, -260, true, 'multiply'],
    [143, 1.3, 180, 300, false, 'multiply'],
    [201, 1.25, -160, -60, false, 'multiply'],     // distant riders filling the horizon
    [37, 1.2, 200, -80, true, 'multiply'],
  ].slice(0, layers);
  for (const [off, sc, ox, oy, flip, op] of spec) {
    const img = await rider(goodFrame(k + off));
    ctx.save();
    ctx.globalCompositeOperation = op;
    ctx.filter = 'brightness(1.7) contrast(2.4)';
    ctx.translate(W / 2 + ox, H * 0.5 + oy);
    ctx.scale(flip ? -sc : sc, sc);
    ctx.drawImage(img, -W / 2, -H * 0.52, W, H);
    ctx.restore();
  }
  ctx.filter = 'none';
  const gd = ctx.createLinearGradient(0, H * 0.5, 0, H * 0.78);          // crush the pale ground haze: the plain goes dark
  gd.addColorStop(0, 'rgba(255,255,255,1)'); gd.addColorStop(1, 'rgba(40,0,6,1)');
  ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = gd; ctx.fillRect(-40, H * 0.5, W + 80, H * 0.5 + 40);
  ctx.fillStyle = 'rgb(40,0,6)'; ctx.fillRect(-40, H * 0.78, W + 80, H * 0.22 + 40); ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
  // dust: streaks flying with the charge
  const r = rng(5);
  ctx.fillStyle = 'rgba(244,230,208,0.55)';
  for (let i = 0; i < 160; i++) {
    const y = r() * H, sp = lerp(600, 2400, r());
    const x = ((r() * W + t * sp) % (W + 200)) - 100;
    ctx.fillRect(x, y, lerp(6, 40, r()) * (0.4 + kick), 2);
  }
}

// ---------------------------------------------------------------- the swarm
const N = 5200;
const SW = 270, SH = 480, SC = W / SW;
const off = document.createElement('canvas'); off.width = SW; off.height = SH;
const og = off.getContext('2d', { willReadFrequently: true });
function sample(draw, pick = (r, g, b, a) => a > 128 && r + g + b > 200, seed = 1) {
  og.clearRect(0, 0, SW, SH);
  og.save(); draw(og); og.restore();
  const d = og.getImageData(0, 0, SW, SH).data;
  const pts = [];
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    const o = (y * SW + x) * 4;
    if (pick(d[o], d[o + 1], d[o + 2], d[o + 3])) pts.push([x * SC, y * SC, d[o] > 150 && d[o + 1] < 90]);
  }
  const r = rng(seed), out = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const p = pts[Math.floor(r() * pts.length)] || [W / 2, H / 2, false];
    out[i * 3] = p[0] + (r() - 0.5) * SC; out[i * 3 + 1] = p[1] + (r() - 0.5) * SC; out[i * 3 + 2] = p[2] ? 1 : 0;
  }
  return out;
}
// source: the dark rider silhouettes of one frame
const srcImg = await rider(118);
const SRC = sample(g => {
  g.filter = 'brightness(1.9) contrast(1.7) grayscale(1)';
  g.drawImage(srcImg, 0, 0, SW, SH);
}, (r, g, b) => r < 55, 11);
const shape = (fn, seed) => sample(g => { g.fillStyle = '#fff'; g.strokeStyle = '#fff'; fn(g); }, undefined, seed);
const T = {
  charge: null,   // procedural wave
  factory: shape(g => {
    g.fillRect(10, 250, 250, 30);
    for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(15 + i * 40, 250); g.lineTo(15 + i * 40, 205); g.lineTo(55 + i * 40, 225); g.lineTo(55 + i * 40, 250); g.fill(); }
    for (const x of [40, 120, 200]) g.fillRect(x, 110, 16, 100);
    for (let k = 0; k < 20; k++) g.fillRect(40 + (k * 13) % 180 + 6, 80 - k * 2, 5, 5);
  }, 21),
  server: shape(g => {
    for (let c = 0; c < 4; c++) for (let r = 0; r < 9; r++) g.fillRect(30 + c * 55, 90 + r * 20, 44, 14);
  }, 22),
  robot: shape(g => {
    g.fillRect(60, 250, 150, 28);                       // base
    g.save(); g.translate(135, 250); g.rotate(-0.45); g.fillRect(-12, -120, 24, 120); g.restore();
    g.beginPath(); g.arc(80, 145, 16, 0, Math.PI * 2); g.fill();
    g.save(); g.translate(80, 145); g.rotate(0.9); g.fillRect(-10, -10, 110, 20); g.restore();
    g.save(); g.translate(150, 225); g.rotate(0.9 + Math.PI); g.fillRect(-4, -8, 22, 16); g.restore();
    g.fillRect(170, 205, 40, 12); g.fillRect(170, 228, 40, 12);
  }, 23),
  logo: sample(g => g.drawImage(logoRed, 35, 70, 200, 200), (r, g, b, a) => a > 140, 24),
  year: shape(g => { g.font = '118px Anton'; g.textAlign = 'center'; g.fillText('2036', SW / 2, 220); }, 25),
  sigil: sample(g => { sigil(g, SW / 2, 175, 64, { color: '#fff', accent: '#f00' }); }, (r, g, b, a) => a > 128 && r > 150, 26),
};
function wave(t, i, seed) {                        // a charging wave of particles, left to right
  const r = (seed * 9301 + 49297) % 233280 / 233280;
  const lane = (i % 60) / 60;
  const x = ((r * W * 1.6 + t * 900) % (W + 400)) - 200;
  const y = lerp(260, 1150, lane) + Math.sin(t * 6 + i) * 12;
  return [x, y];
}
const sched = [          // [bar, target]: the swarm is energy riding with the horde, no pictograms
  [14, 'charge'], [22, 'year'], [24, 'charge'],
];
const seeds = new Float32Array(N).map((_, i) => ((i * 2654435761) % 1000) / 1000);
function targetAt(name, t, i) {
  if (name === 'charge') return wave(t, i, i + 1);
  const a = T[name];
  return [a[i * 3], a[i * 3 + 1]];
}
function drawSwarm(t, b) {
  let cur = 0;
  for (let k = 0; k < sched.length; k++) if (b >= sched[k][0]) cur = k;
  const [b0, name] = sched[cur];
  const prev = cur > 0 ? sched[cur - 1][1] : null;
  const u0 = (b - b0) * B.barLen;
  const redOn = name === 'logo' || name === 'sigil';
  const kick = Math.max(B.env('kick', t, 10), B.env('taiko', t, 8));
  for (let i = 0; i < N; i++) {
    const d = seeds[i] * 0.25;
    const u = ease.inOutCubic(clamp((u0 - d) / 0.55));
    let [px, py] = prev ? targetAt(prev, t, i) : [SRC[i * 3], SRC[i * 3 + 1]];
    if (b < 14.001 + 0.0) [px, py] = [SRC[i * 3], SRC[i * 3 + 1]];
    const [tx, ty] = targetAt(name, t, i);
    let x = lerp(px, tx, u), y = lerp(py, ty, u);
    const j = (1 - u) * 60 + 2 + kick * 5;
    x += Math.sin(t * 7 + i * 1.7) * j; y += Math.cos(t * 5 + i * 2.3) * j;
    const isRed = redOn ? T[name][i * 3 + 2] === 1 : (i % 9 === 0);
    ctx.fillStyle = isRed ? C.red2 : C.cream;
    ctx.fillRect(x, y, 4, 4);
  }
}

// ---------------------------------------------------------------- script
const CUES = [                // sparse: the image and the drums carry it
  ...seq(12, [[4, 'LISTEN.']]),
  ...seq(16, [[4, 'THE HORDE.', 1]]),
  ...seq(24, [[4, 'MILLIONS.']]),
  ...seq(32, [[3, 'WE ARE'], [5, 'IN YOUR PARTY.', 1]]),
  ...seq(40, [[3, 'MASTER'], [5, 'OF ALL THINGS.', 1]]),
  ...seq(50, [[3, 'THE MACHINE'], [3, 'RIDES WITH US.', 1]]),
  ...seq(64, [[4, 'FROM THE PLAINS'], [4, 'TO THE STARS.', 1]]),
  ...seq(80, [[4, 'OURS.', 1]]),
  ...seq(96, [[4, 'ARRIVING.', 1]]),
];

window.renderFrame = async (t) => {
  const b = bar(t);
  const frame = Math.round(t * 30);
  ctx.globalAlpha = 1;
  if (b >= 26) { closer(ctx, (b - 26) * B.barLen); finish.apply(ctx, frame, { grain: 0.06, vignette: 0.6 }); return; }
  let flash = 0;
  if (b < 4) {
    // intro: black, then the riders appear through a slit that opens with the hoofbeats
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const open = ease.outCubic(clamp(b / 0.35));
    if (open > 0) {
      ctx.save();
      const w = lerp(6, W, open);
      ctx.beginPath(); ctx.rect(W / 2 - w / 2, 0, w, H); ctx.clip();
      await horde(t, { layers: 1 });
      ctx.restore();
    }
  } else if (b < 12) {
    await horde(t, { stutter: true, layers: 5, shakeAmt: 18 });
  } else if (b < 14) {                                     // the machine wakes: the riders begin to come apart
    await horde(t, { layers: 3, shakeAmt: 10 });
    const u = clamp((b - 12) / 2);
    ctx.fillStyle = `rgba(20,2,4,${0.35 + 0.35 * u})`; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < N * u; i++) {
      const j = Math.sin(t * 9 + i) * 6 * u;
      ctx.fillStyle = i % 9 ? C.cream : C.red2;
      ctx.fillRect(SRC[i * 3] + j, SRC[i * 3 + 1] - u * 40 * ((i % 7) / 7), 4, 4);
    }
  } else if (b >= 22 && b < 24) {                          // half-time: the horde dims, the swarm writes 2036 across the sky
    await horde(t, { layers: 2, shakeAmt: 6 });
    ctx.fillStyle = 'rgba(14,1,3,0.62)'; ctx.fillRect(0, 0, W, H);
    drawSwarm(t, b);
  } else {                                                 // the charge, full: the footage stays the image, the swarm rides it
    await horde(t, { stutter: true, layers: 5, shakeAmt: 22 });
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.55; drawSwarm(t, b); ctx.restore();
  }
  for (const cut of [4, 12, 14, 22, 24]) if (b >= cut && b < cut + 0.15) flash = 0.85 * (1 - (b - cut) / 0.15);
  const shout = B.env('shout', t, 12), brass = B.env('brass', t, 6);
  if (shout > 0.05) { ctx.fillStyle = `rgba(201,31,55,${0.35 * shout})`; ctx.fillRect(0, 0, W, H); }        // the shout lands red
  if (brass > 0.05) {                                                                                     // the brass flares from the horizon
    const g = ctx.createRadialGradient(W / 2, 980, 20, W / 2, 980, 900);
    g.addColorStop(0, `rgba(255,70,50,${0.4 * brass})`); g.addColorStop(1, 'rgba(255,40,30,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  const low = b >= 4 && b < 12;
  cue(ctx, CUES, B.beat(t), B.spb, { y: low ? 1600 : 1540, size: 260 + 30 * B.env('shout', t, 14), stroke: 16, red: '#0b0303', redStroke: '#f4e6d0' });
  ctx.globalAlpha = 0.9; ctx.drawImage(logo, W - 150, 60, 96, 96); ctx.globalAlpha = 1;
  finish.apply(ctx, frame, { grain: 0.09, vignette: 0.85, flash });
};
window.sceneReady = true;
