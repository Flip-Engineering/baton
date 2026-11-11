// THE FACTORY (machines_e1): episode 1 of WHO OWNS THE MACHINES (research/scripts_final/machines_e1.json v2, cycle WM1;
// research/TRAJECTORY_MACHINES.md §4.1). The gag: the owners keep changing (the UNDER NEW MANAGEMENT banner slapped
// over and over on the gate) and the crew stays. 116 BPM, Dayton talk-box funk (songs2/machines_e1.py v3, voices off).
//
// WORLDS (by beat)
//   A     b0-8     the cold gate at 5:40 a.m.: the line worker in profile (near-black, rim-lit; the glasses on his
//                  brim, the ear defenders round his neck, up over his ears on CLOCK IN.), the flat red dot over the
//                  water tower, the plant on the horizon; the banner slapped over an older one on frame 0 and b2
//   B     b8-12    the plant behind the gate at sodium dawn (Sheeler's conveyor bridges, Ferriss's light from below,
//                  the open bay with the press line and the robots in black); the man from behind with his pail;
//                  NEXT. NEXT.: new owners' banners slapped over the old, he never moves
//   A'    b12-16   print: the close-up as a Klutsis halftone on poster red, brim / cup / jaw in cream line work
//   C     b16-20   the four stations (press, weld arm, paint booth, conveyor) as exaggerated silhouettes on poster
//                  red, each sending cream stipple rings from its working point, in turn on the 16ths, together b18
//   B2    b20-24   pulled back: about 20 backs filing through the gate under the fourth banner, pails in hand
//   A     b24-28   the break (darker; the dot closer); b27.5 the one silence, the picture frozen, no type
//   B3    b28-32   drop II: the wall of backs grows 6 -> 20 -> 60 on the three CREW!; b31 the wind strips the stack
//   C2    b32-36   LET 'ER ROLL.: the stations fire; b35 the four ring fronts lock into the four stripes
//   AR    b36-40   the payoff WE RUN IT.: frame 0's composition, the sky turned red, the empty sign frame, rings
//   LOCK  b40-     the dot docks as the gear's hub, ≡/acc, ACP.US; dissolves to frame 0, where the next banner lands
// Impact frames (1-2 frames, inverted, anime style) on b8 and b28 instead of a white flash.
// DELIBERATE BREAK from the family's one-figure rule (flag to the client): the crew is shown at b20 and b28-31.
import { W, H, loadFonts, loadBeats, Beats, loadImage, clamp, lerp, ease, smooth, acpEmblem } from '../lib/kit.js';
import { Post } from '../lib/fx/post.js';
import { loadSil } from '../lib/fx/sil.js';
import * as F from './machines.figures.js';
import * as X from './machines_e1.world.js';

// ================================================================ the words (scripts_final/machines_e1.json v2)
const CUES = [[0, 'SAME CREW.', 1], [3.5, null], [4, 'CLOCK IN.', 0], [6, null], [8, 'THE FACTORY.', 1], [9.5, null],
  [10, 'NEXT.', 0], [10.75, null], [11, 'NEXT.', 0], [11.75, null], [12, 'CREW!', 1], [12.75, null], [13, 'CREW!', 0], [13.75, null],
  [14, 'OUR LINE.', 1], [15.5, null], [16, 'OUR PACE.', 0], [17.5, null], [20, 'SAME CREW.', 1], [22, null],
  [24, 'WHO OWNS', 1], [25, 'THE MACHINES?', 0], [27.5, null], [28, 'CREW!', 1], [28.75, null], [29, 'CREW!', 0], [29.75, null],
  [30, 'CREW!', 0], [31, null], [32, "LET 'ER ROLL.", 0], [33.75, null], [34, 'CREW!', 0], [34.75, null], [35, 'CREW!', 0], [35.75, null],
  [36, 'WE RUN IT.', 1], [40, null]];
const CLOSE = 40, LOCK_FRAMES = 42;
const WORLDS = [[0, 'A'], [8, 'B'], [12, 'Ap'], [16, 'C'], [20, 'B2'], [24, 'A2'], [28, 'B3'], [32, 'C2'], [36, 'AR'], [CLOSE, 'LOCK']];
const IMPACT_FRAMES = [8, 28];
// the banner layers: [style, beat slapped, dx, dy, rot, width k, seed]
const LAYERS = [[0, -99, -16, 7, -0.022, 1.05, 1], [1, 0, 0, 0, 0.01, 1.0, 2], [2, 2, 9, -5, -0.016, 0.97, 3], [3, 10, -7, 4, 0.013, 1.02, 4],
  [4, 11, 11, 2, -0.02, 0.95, 5], [5, 20, -4, -3, 0.008, 1.0, 6]];
const TEAR = 31;

// ================================================================ boot
const Q = new URLSearchParams(location.search);
await loadFonts();
await Promise.all([['Overpass', 'overpass/files/overpass-latin-900-normal.woff2', '900'], ['Overpass', 'overpass/files/overpass-latin-800-normal.woff2', '800'],
  ['Overpass', 'overpass/files/overpass-latin-600-normal.woff2', '600'], ['Cinzel', 'cinzel/files/cinzel-latin-700-normal.woff2', '700'],
  ['Big Shoulders Stencil Display', 'big-shoulders-stencil-display/files/big-shoulders-stencil-display-latin-900-normal.woff2', '900'],
  ['Big Shoulders Stencil Display', 'big-shoulders-stencil-display/files/big-shoulders-stencil-display-latin-700-normal.woff2', '700']]
  .map(async ([fam, file, w]) => { try { const f = new FontFace(fam, `url(../node_modules/@fontsource/${file})`, { weight: w }); document.fonts.add(await f.load()); } catch (e) { console.log('font', fam, e.message); } }));
let B, STAND_IN = false;
try { B = await loadBeats('machines_e1'); } catch (e) {
  STAND_IN = true; const spb = 60 / 116, hits = { kick: [], snare: [], clap: [] };
  for (let b = 8; b < 36; b++) if (b < 24 || b >= 28) hits.kick.push(b * spb);
  B = new Beats({ bpm: 116, duration: CLOSE * spb + LOCK_FRAMES / 30, loop: true, hits, text: [] });
}
const SPB = B.spb, bt = b => b * SPB;
const DUR = B.loop && B.duration > CLOSE * SPB ? Math.min(B.duration, CLOSE * SPB + LOCK_FRAMES / 30) : CLOSE * SPB + LOCK_FRAMES / 30;
const LOCK_HOLD = Math.min(LOCK_FRAMES / 30, DUR - CLOSE * SPB - 10 / 30);
window.DURATION = DUR;
const [logo, markImg, eqImg, slashImg, accImg] = await Promise.all(['acp_logo', 'part_mark', 'part_eq', 'part_slash', 'part_acc'].map(k => loadImage(`../assets/${k}.png`)));
const sil = await loadSil();
const SR = new X.SilRim(sil);

const mk = (w = W, h = H) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const g2 = c => c.getContext('2d', { willReadFrequently: true });
const worldCv = mk(), WG = g2(worldCv), figC = mk(), FG = g2(figC), typeC = mk(), TY = g2(typeC), tmpC = mk(), TG = g2(tmpC), toneC = mk(), TN = g2(toneC);
const post = new Post(W, H, { direct: true });
const tint = (img, col) => { const c = mk(img.width, img.height), g = g2(c); g.drawImage(img, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = col; g.fillRect(0, 0, c.width, c.height); return c; };
const CREAM = '#F4E6D0';
const LOCK = { mark: tint(markImg, CREAM), eq: tint(eqImg, CREAM), slash: tint(slashImg, CREAM), acc: tint(accImg, CREAM) };
// the ACP sticker on the lunch pail: a cream tile with the four-stripe emblem in the logo's red
const TILE = (() => { const c = mk(200, 150), g = g2(c); g.fillStyle = '#f3efe6'; g.fillRect(0, 0, 200, 150); acpEmblem(g, 100, 75, 118, { color: null }); return c; })();
const BG_A = X.bgA(), BG_AR = X.bgA({ red: true }), BG_B = X.bgB();
const BAN = X.STYLES.map((_, k) => X.makeBanner(k));
// paper for the print worlds (poster red, fibre and mottling)
const PAPER = (() => { const c = mk(), g = g2(c); g.fillStyle = '#C91F37'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 9000; i++) { const h = X.hash(i * 13), v = X.hash(i * 7); g.fillStyle = h < 0.5 ? `rgba(90,0,10,${0.05 * v})` : `rgba(255,220,200,${0.04 * v})`;
    g.fillRect(W * X.hash(i * 3), H * X.hash(i * 5), 1 + 30 * X.hash(i * 11), 1 + 2 * X.hash(i * 17)); }
  return c; })();

TY.font = '100px "Anton"'; const CAPR = TY.measureText('H').actualBoundingBoxAscent / 100;

// ================================================================ helpers
const at = (list, b) => { let r = list[0]; for (const x of list) if (b >= x[0]) r = x; return r; };
const eio = ease.inOutCubic, eo = ease.outCubic;
const hitsIn = (name, t0, t1) => (B.hits[name] || []).filter(x => x >= t0 - 1e-4 && x < t1 - 1e-4);
function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

// ---- the type rail (the family's: white heavy condensed caps, keyline, the slam with red / cyan ghosts)
const CAP = 172, MAXW = W * 0.9;
function slam(ctx, text, age, { emph = 0, frame = 0, splitPx = 12, alpha = 1 } = {}) {
  let size = CAP / CAPR; ctx.font = `${size}px "Anton"`; let w = ctx.measureText(text).width;
  if (w > MAXW) { size *= MAXW / w; } size = Math.max(size, 100 / CAPR);
  ctx.font = `${size}px "Anton"`; w = ctx.measureText(text).width;
  const cap = size * CAPR, x = W / 2 - w / 2, y = 960 + cap / 2;
  const amt = ((emph ? splitPx : 8) - 2) * Math.exp(-age * 10) + 2;
  const pop = 1 + (emph ? 0.10 : 0.06) * Math.max(0, 1 - age / 0.1);
  const a = (frame === 0 ? 1 : clamp(0.55 + age / 0.033)) * alpha;
  ctx.save(); ctx.translate(W / 2, 960); ctx.scale(pop, pop); ctx.translate(-W / 2, -960);
  const r1 = hash(frame * 3.1), r2 = hash(frame * 7.7 + 1), r3 = hash(frame * 5.3 + 2), sgn = r1 < 0.5 ? -1 : 1;
  ctx.globalAlpha = 0.8 * a; ctx.fillStyle = '#FF0026'; ctx.fillText(text, x + sgn * amt * (0.6 + 0.4 * r2), y + (r3 - 0.5) * 4);
  ctx.globalAlpha = 0.6 * a; ctx.fillStyle = '#00E6FF'; ctx.fillText(text, x - sgn * amt * (0.6 + 0.4 * r3), y);
  ctx.globalAlpha = a; ctx.lineJoin = 'round'; ctx.lineWidth = 5; ctx.strokeStyle = '#0B0808'; ctx.strokeText(text, x, y);
  ctx.fillStyle = '#FFFFFF'; ctx.fillText(text, x, y); ctx.restore();
}

// ---- the banner stack at a beat, drawn at a gate's frame
function banners(g, G, beat, t, frame, { scale = 1, light = null, shade = 0.3 } = {}) {
  const tear = beat >= TEAR ? clamp((beat - TEAR) / 1.3) : 0;
  if (tear >= 1) return;
  for (const [st, b0, dx, dy, rot, wk, seed] of LAYERS) {
    if (beat < b0) continue;
    let slap = clamp((beat - b0) * SPB / 0.13);
    if (frame === 0 && b0 === 0) slap = 1;                             // the thumbnail: the banner already set
    const tr = tear > 0 ? clamp(tear * 1.25 - 0.06 * seed * 0.3) : 0;
    X.drawBanner(g, BAN[st], G.bx, G.by + G.bh / 2, G.bw * wk * scale, t, { seed, dx: dx * scale, dy: dy * scale, rot, slap, tear: tr, light, shade });
    if (slap < 1 && slap > 0) {                                        // the smack: a dust puff off the vinyl
      g.save(); g.globalAlpha = 0.35 * (1 - slap); g.fillStyle = light ? 'rgba(255,200,160,1)' : 'rgba(200,205,210,1)';
      for (let i = 0; i < 16; i++) { const a = X.hash(seed * 50 + i) * Math.PI * 2, r = G.bw * 0.55 * (0.8 + 0.6 * slap) * (0.7 + 0.3 * X.hash(i));
        g.beginPath(); g.arc(G.bx + Math.cos(a) * r, G.by + G.bh / 2 + Math.sin(a) * r * 0.3, 3 + 6 * X.hash(i + 9), 0, Math.PI * 2); g.fill(); }
      g.restore();
    }
  }
}

// ---- the line worker in profile (the hero's trucker silhouette, his cap and stubble), dressed for the line
const RIM_A = [{ dx: 0.45, dy: -0.9, w: 4, color: [140, 156, 160], a: 0.5 }, { dx: 1, dy: -0.2, w: 2, color: [220, 90, 80], a: 0.2 }];
const RIM_AR = [{ dx: 0.45, dy: -0.9, w: 5, color: [255, 130, 118], a: 0.55 }, { dx: 1, dy: -0.2, w: 3, color: [246, 200, 180], a: 0.3 }];
function pose(beat) {
  const tilt = -0.56 - 0.035 * eo(clamp((beat - 1) / 0.8)) - 0.05 * eo(clamp((beat - 5) / 0.9));
  return { tilt, breath: Math.sin(Math.PI * clamp((beat - 2) / 2.4)) };
}
const T0 = { x: 330, y: 1150, s: 560 };
const zoomT = (T, z, px, py) => ({ x: px + (T.x - px) * z, y: py + (T.y - py) * z, s: T.s * z });
function worker(g, T, p, { cups = 0, rim = RIM_A, warm = 0.4, light = 'rgba(150,165,160,1)', fogAge = -1, rimBox = null, glint = 1, rimCol = 'rgba(160,172,168,0.9)', hands = 0 } = {}) {
  g.save(); g.setTransform(T.s, 0, 0, T.s, T.x, T.y);
  const S = F.fillTrucker(g, { tilt: p.tilt, breath: p.breath });
  F.truckerDetail(g, S, { u: T.s, warm, light, tilt: p.tilt });
  X.defenders(g, cups, { tilt: p.tilt, unit: T.s, rim: rimCol });
  X.glasses(g, { tilt: p.tilt, unit: T.s, glint, rim: rimCol });
  if (fogAge >= 0) F.breathFog(g, S, fogAge, { k: 1 });
  const D = X.defendersGeom(cups, p.tilt);
  g.restore(); g.setTransform(1, 0, 0, 1, 0, 0);
  if (hands > 0) {                                                     // the gloved hand bringing the cup up (a silhouette)
    const cx = T.x + D.c[0] * T.s, cy = T.y + D.c[1] * T.s;
    g.fillStyle = '#100E10';
    F.glovePath(g, { x: cx - 0.02 * T.s, y: cy + 0.36 * T.s + (1 - hands) * 0.5 * T.s, s: 0.00085 * T.s, curl: 0.55, rot: -0.35 });
  }
  F.rimLight(g, rim, rimBox);
}

// ---- stipple ring fields
function ringSet(g, x, y, age, { v = 950, n = 7, gap = 26, decay = 1.0, a0 = 1, seed = 0, lock = 0, lockY = 0 } = {}) {
  if (age < 0 || age > 2.4) return;
  for (let j = 0; j < n; j++) {
    const R = v * age * (1 - 0.35 * Math.min(1, age / 2)) - j * gap;
    if (R <= 2) continue;
    const a = a0 * Math.exp(-decay * age) * (1 - j / (n + 1));
    X.stipple(g, x, y, R, { a, seed: seed * 13 + j, dr: 3.0 - j * 0.2, drop: 0.1, lock, lockY: lockY + j * 9 });
  }
}

// ---- the lockup (the hero's family grammar): the dot docks as the gear's hub, ≡ / acc slide in, ACP.US
function drawLockup(ctx, a, from) {
  const d = eio(clamp((a - LOCK_HOLD) / (DUR - bt(CLOSE) - LOCK_HOLD - 1 / 30))), fade = 1 - d;
  const hL = 230, sc = hL / 291, wM = 300 * sc, wE = 220 * sc, wS = 119 * sc, wA = 517 * sc, total = wM + wE + wS + wA;
  const x0 = W / 2 - total / 2, cy = 880, hub = [x0 + 150 * sc, cy - hL / 2 + 148 * sc, 62 * sc];
  const u = eio(clamp(a / 0.3));
  const dx = lerp(from[0], hub[0], u), dy = lerp(from[1], hub[1], u), dr = lerp(from[2], hub[2], u);
  ctx.save(); ctx.globalAlpha = fade;
  const hg = ctx.createRadialGradient(dx, dy, dr, dx, dy, dr * 2.6); hg.addColorStop(0, 'rgba(70,6,10,0.85)'); hg.addColorStop(1, 'rgba(70,6,10,0)');
  ctx.fillStyle = hg; ctx.fillRect(dx - dr * 3, dy - dr * 3, dr * 6, dr * 6);
  ctx.fillStyle = '#E53239'; ctx.beginPath(); ctx.arc(dx, dy, dr, 0, Math.PI * 2); ctx.fill();
  const mu = eo(clamp((a - 0.16) / 0.22));
  if (mu > 0) { ctx.save(); ctx.globalAlpha = fade * clamp(mu * 1.5); ctx.translate(hub[0], hub[1]); ctx.rotate((1 - mu) * -0.5); const ms = lerp(1.25, 1, mu); ctx.scale(ms, ms);
    ctx.drawImage(LOCK.mark, -150 * sc, -148 * sc, wM, hL); ctx.restore(); }
  for (const [img, x, w, s0] of [[LOCK.eq, x0 + wM, wE, 0.3], [LOCK.slash, x0 + wM + wE, wS, 0.36], [LOCK.acc, x0 + wM + wE + wS, wA, 0.42]]) {
    const p = eo(clamp((a - s0) / 0.22)); if (p <= 0) continue; ctx.globalAlpha = fade * p; ctx.drawImage(img, x + (1 - p) * 160, cy - hL / 2, w, hL); }
  const pu = eo(clamp((a - 0.5) / 0.2));
  if (pu > 0) { ctx.globalAlpha = fade * pu; ctx.fillStyle = CREAM; ctx.font = '76px "Archivo Black"'; ctx.textAlign = 'center'; ctx.fillText('ACP.US', W / 2, 1190 + (1 - pu) * 20); }
  ctx.restore();
  return d;
}

// ================================================================ the worlds
const STATIONS = [[185, 0], [420, 1], [650, 2], [885, 3]];
const HORIZON_C = 1560;
function worldA(t, beat, frame, { brk = false, red = false, empty = false, zOverride = null } = {}) {
  const u = brk || red ? 0 : eio(clamp(beat / 8));
  // b4-6 CLOCK IN.: a cut in to the head as the cups go on (the one act of the intro), then back out for the riser
  const tight = !brk && !red && zOverride == null && beat >= 4 && beat < 6;
  const z = zOverride ?? (brk ? 1.06 : red ? 1.0 : tight ? lerp(1.5, 1.58, (beat - 4) / 2) : lerp(1, 1.15, u));
  const P = tight ? [150, H * 0.72] : [W * 0.42, H * 0.64];
  WG.save(); WG.translate(P[0], P[1]); WG.scale(z, z); WG.translate(-P[0], -P[1]);
  WG.drawImage(red ? BG_AR : BG_A, 0, 0);
  X.gateA(WG, { red });
  if (!empty) banners(WG, X.GATE_A, beat, t, frame, { light: red ? null : 'rgb(150,160,176)', shade: 0.25 });
  WG.restore();
  // the dot (screen space): over the water tower, drifting down and growing; closer in the break
  const dot = brk ? [W * 0.80, H * 0.17, W * 0.05] : red ? [W * 0.76, H * 0.14, W * 0.035] : [lerp(W * 0.76, W * 0.80, u), lerp(H * 0.14, H * 0.2, u), lerp(W * 0.035, W * 0.045, u)];
  if (brk && beat >= 25) dot[2] += B.env('snare', t, 18) * 1.2;
  const hr = dot[2] * (red ? 3.2 : 2.4), hg = WG.createRadialGradient(dot[0], dot[1], dot[2], dot[0], dot[1], hr);
  hg.addColorStop(0, red ? 'rgba(70,6,10,0.95)' : 'rgba(10,10,14,0.55)'); hg.addColorStop(1, red ? 'rgba(70,6,10,0)' : 'rgba(10,10,14,0)');
  WG.fillStyle = hg; WG.fillRect(dot[0] - hr, dot[1] - hr, 2 * hr, 2 * hr);
  WG.fillStyle = '#E53239'; WG.beginPath(); WG.arc(dot[0], dot[1], dot[2], 0, Math.PI * 2); WG.fill();
  if (red) {                                                          // the payoff: cream rings leave the dot on each kick
    for (const k of hitsIn('kick', bt(36), t + 1e-3).concat([bt(36)])) ringSet(WG, dot[0], dot[1], t - k, { v: 700, n: 5, gap: 22, decay: 0.9, a0: 0.9, seed: Math.round(k * 10) });
  }
  // the man
  FG.setTransform(1, 0, 0, 1, 0, 0); FG.clearRect(0, 0, W, H);
  const p = brk || red ? pose(8) : pose(beat);
  const T = zoomT(T0, z, P[0], P[1]);
  const cupU = red || brk ? 1 : eio(clamp((beat - 4) / 0.8));
  const hands = red || brk ? 0 : beat >= 3.7 && beat < 5.4 ? clamp((beat - 3.7) / 0.5) * clamp((5.4 - beat) / 0.4) : 0;
  worker(FG, T, p, { cups: cupU, hands, rim: red ? RIM_AR : RIM_A, warm: red ? 0.6 : lerp(0.4, 0.95, smooth(4, 5, beat)) * (brk ? 0.8 : 1),
    light: red ? 'rgba(255,170,160,1)' : 'rgba(150,165,160,1)', fogAge: !brk && !red && beat >= 2 ? (beat - 2) * SPB : -1, rimBox: [0, 900, W, H - 900],
    rimCol: red ? 'rgba(255,190,170,0.9)' : 'rgba(170,182,186,0.9)' });
  WG.drawImage(figC, 0, 0);
  if (brk) { WG.fillStyle = 'rgba(0,0,6,0.28)'; WG.fillRect(0, 0, W, H); }
  return dot;
}

function worldB(t, beat, frame, mode) {
  const w0 = mode === 'B' ? 8 : mode === 'B2' ? 20 : 28;
  const barU = clamp((beat - w0) / 4);
  const kick = B.env('kick', t, 9);
  const z = (mode === 'B2' ? lerp(1.0, 1.04, barU) : lerp(1, 1.08, barU)) * (1 + 0.035 * kick);
  const P = [W * 0.5, H * 0.6];
  WG.save(); WG.translate(P[0], P[1]); WG.scale(z, z); WG.translate(-P[0], -P[1]);
  WG.drawImage(BG_B, 0, 0);
  // the press line: the near slide comes down on each kick (b8: the match cut from his hands)
  const lk = B.last('kick', t), ku = t - lk < 0.3 ? 1 - (t - lk) / 0.3 : 0;
  const lead = B.last('kick', t + 0.08) > lk ? clamp(1 - (B.last('kick', t + 0.08) - t) / 0.08) : 0;
  X.pressLine(WG, { u: Math.max(ku * ku, lead), beat, flash: beat >= 8 && beat < 8.4 ? 1 - (beat - 8) / 0.4 : 0 });
  X.gateB(WG);
  banners(WG, X.GATE_B, beat, t, frame, { light: 'rgb(205,150,128)', shade: 0.35 });
  WG.restore();
  // people (figure layer, rim-lit by the bay)
  FG.setTransform(1, 0, 0, 1, 0, 0); FG.clearRect(0, 0, W, H);
  if (mode === 'B') {
    X.backWorker(FG, { x: 280 * z + P[0] * (1 - z), y: 1225 * z + P[1] * (1 - z) + 6 * Math.sin(t * 2), s: 178 * z, tile: TILE, sway: Math.sin(t * 1.6) });
    F.rimLight(FG, [{ dx: 0.25, dy: -1, w: 6, color: [255, 160, 80], a: 0.85 }, { dx: 1, dy: -0.3, w: 4, color: [255, 120, 50], a: 0.6 }, { dx: -1, dy: -0.4, w: 3, color: [255, 120, 60], a: 0.35 }]);
    // the pail's sticker stays readable: re-lay it lit over the rim pass
    WG.drawImage(figC, 0, 0);
  } else if (mode === 'B2') {
    // about 20 backs filing through the gate toward the bay, pails in hand; foot y -> height (a ground plane)
    const fig = [];
    for (let i = 0; i < 20; i++) {
      const lane = (i % 5) / 4, row = Math.floor(i / 5), sp = 0.9 + 0.25 * X.hash(i * 7);
      let d = (row * 0.27 + X.hash(i * 3) * 0.2 + (t - bt(20)) * 0.12 * sp) % 1.1;         // 0 at the near edge, 1 at the gate
      const fy = lerp(2150, 1560, d), h = lerp(760, 150, Math.pow(d, 0.7));
      const fx = lerp(lerp(90, 990, lane) + (X.hash(i) - 0.5) * 80, X.BAY.vx + (lane - 0.5) * 300, d);
      fig.push({ fx: fx * z + P[0] * (1 - z), fy: fy * z + P[1] * (1 - z), h: h * z, i, ph: ((t * 1.9 * sp + X.hash(i * 5) * 8) | 0) % 8 });
    }
    fig.sort((a, b) => a.fy - b.fy);
    const types = [0, 1, 2, 4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 18, 19, 3, 13, 29, 31];
    for (const f of fig) SR.draw(FG, types[f.i % types.length], 'walk' + f.ph, f.fx, f.fy, f.h, { rimCol: 'rgb(255,170,90)', rimA: 1, pail: true, flip: f.i % 3 === 0 });
    WG.drawImage(figC, 0, 0);
  } else {
    // the wall: 6 near backs (b28), 20 (b29), 60 (b30); fists up on each CREW!
    const n = beat < 29 ? 6 : beat < 30 ? 20 : 60;
    const lastHit = [28, 29, 30].filter(b => beat >= b).pop() ?? 28;
    const up = clamp(1 - (beat - lastHit) / 0.6);
    const ranks = [];
    for (let i = 0; i < 60; i++) {
      const r = i < 6 ? 0 : i < 20 ? 1 : 2, k = r === 0 ? i : r === 1 ? i - 6 : i - 20, m = [6, 14, 40][r];
      const fy = [2060, 1800, 1650][r] + (X.hash(i * 3) - 0.5) * [30, 24, 18][r], h = [760, 390, 220][r] * (0.92 + 0.12 * X.hash(i * 5));
      const fx = (k + 0.5 + (X.hash(i * 11) - 0.5) * 0.6) / m * (W + 120) - 60;
      ranks.push({ i, r, fx, fy, h, on: i < n, born: r === 0 ? 28 : r === 1 ? 29 : 30 });
    }
    ranks.sort((a, b) => a.fy - b.fy);
    const types = [0, 1, 2, 4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 18, 19, 3, 13, 29, 31, 20, 23, 26, 8];
    for (const f of ranks) {
      if (!f.on) continue;
      const age = beat - f.born, rise = eo(clamp(age / 0.25));
      const fist = up > 0.25 && X.hash(f.i * 17) < 0.8 ? (X.hash(f.i * 13) < 0.5 ? 'pumpHi' : 'overhead') : (X.hash(f.i * 19) < 0.5 ? 'standA' : 'standB');
      SR.draw(FG, types[f.i % types.length], fist, f.fx * z + P[0] * (1 - z), (f.fy + (1 - rise) * 60) * z + P[1] * (1 - z), f.h * z,
        { rimCol: 'rgb(255,165,85)', rimA: 1, alpha: rise, flip: f.i % 2 === 0 });
    }
    WG.drawImage(figC, 0, 0);
  }
}

// A': the print close-up. The tone canvas holds the man (black) with a wide cream rim toward the light; halftoned
// onto poster red; the brim, the cup and the jaw re-drawn in cream line work.
function worldAp(t, beat, frame) {
  const barU = clamp((beat - 12) / 4), kick = B.env('kick', t, 10);
  const z = lerp(1, 1.14, barU) * (1 + 0.03 * kick);
  const T = zoomT({ x: 420, y: 470, s: 1150 }, z, W * 0.55, H * 0.55), p = { tilt: -0.5 + 0.02 * eo(clamp((beat - 14) / 0.5)), breath: 0 };
  TN.setTransform(1, 0, 0, 1, 0, 0); TN.fillStyle = '#ffffff'; TN.fillRect(0, 0, W, H);
  FG.setTransform(1, 0, 0, 1, 0, 0); FG.clearRect(0, 0, W, H);
  FG.save(); FG.setTransform(T.s, 0, 0, T.s, T.x, T.y);
  const S = F.fillTrucker(FG, { tilt: p.tilt, breath: 0, jaw: eo(clamp((beat - 14) / 0.5)) });
  X.defenders(FG, 1, { tilt: p.tilt, unit: T.s, ink: '#100E10', rim: 'rgba(255,255,255,1)' });
  FG.restore(); FG.setTransform(1, 0, 0, 1, 0, 0);
  FG.globalCompositeOperation = 'source-atop';
  { const Gd = FG.createLinearGradient(80, 1500, 900, 500); Gd.addColorStop(0, '#0a0a0a'); Gd.addColorStop(0.45, '#303030'); Gd.addColorStop(0.8, '#6e6e6e'); Gd.addColorStop(1, '#9a9a9a');
    FG.fillStyle = Gd; FG.fillRect(0, 0, W, H); }
  FG.save(); FG.setTransform(T.s, 0, 0, T.s, T.x, T.y); X.defenders(FG, 1, { tilt: p.tilt, unit: T.s, ink: '#141414', rim: 'rgba(255,255,255,1)' }); FG.restore();
  FG.globalCompositeOperation = 'source-over';
  F.rimLight(FG, [{ dx: 0.6, dy: -0.8, w: 70, color: [255, 255, 255], a: 0.75, steps: 4 }, { dx: 1, dy: 0.1, w: 34, color: [255, 255, 255], a: 0.9, steps: 3 }]);
  TN.drawImage(figC, 0, 0);
  WG.drawImage(PAPER, 0, 0);
  // the Klutsis band: a darker red diagonal behind the head
  WG.save(); WG.translate(W * 0.5, H * 0.35); WG.rotate(-0.56); WG.fillStyle = 'rgba(110,4,18,0.55)'; WG.fillRect(-1400, -150, 2800, 300); WG.restore();
  X.halftone(WG, toneC, { cell: 12, angle: 0.26, gain: 1.05 });
  // cream line work: the bill, the cup, the jaw and chin, the stitching
  WG.save(); WG.setTransform(T.s, 0, 0, T.s, T.x, T.y);
  WG.strokeStyle = CREAM; WG.lineCap = 'round'; WG.lineJoin = 'round';
  WG.lineWidth = 4.5 / T.s; WG.beginPath(); F.tracePath(WG, S.bill, false); WG.stroke();
  WG.lineWidth = 3.5 / T.s; WG.beginPath(); F.tracePath(WG, S.face.slice(Math.floor(S.face.length * 0.12), Math.floor(S.face.length * 0.7)), false); WG.stroke();
  const D = X.defendersGeom(1, p.tilt);
  WG.save(); WG.translate(D.c[0], D.c[1]); WG.rotate(D.ang);
  WG.lineWidth = 5 / T.s; WG.beginPath(); WG.ellipse(0, 0, D.rx, D.ry, 0, 0, Math.PI * 2); WG.stroke();
  WG.lineWidth = 2.5 / T.s; WG.beginPath(); WG.ellipse(0, 0, D.rx * 0.78, D.ry * 0.78, 0, 0, Math.PI * 2); WG.stroke();
  for (let k = 0; k < 5; k++) { WG.beginPath(); WG.moveTo(-D.rx * 0.5, -D.ry * 0.5 + k * D.ry * 0.25); WG.lineTo(D.rx * 0.5, -D.ry * 0.5 + k * D.ry * 0.25 - 0.02); WG.stroke(); }
  WG.restore();
  WG.setLineDash([6 / T.s, 7 / T.s]); WG.lineWidth = 2.2 / T.s; WG.beginPath();
  F.tracePath(WG, S.bill.slice(Math.floor(S.bill.length * 0.5)).map(q => [q[0] - 0.015, q[1] + 0.015]), false); WG.stroke(); WG.setLineDash([]);
  WG.restore();
}

function worldStations(t, beat, frame, mode) {
  WG.drawImage(PAPER, 0, 0);
  const kick = B.env('kick', t, 10), z = 1 + 0.02 * kick;
  // emissions: [beat, station]
  const E = [];
  if (mode === 'C') { for (const b of [16, 17]) for (let k = 0; k < 4; k++) E.push([b + k / 4, k]); for (let k = 0; k < 4; k++) E.push([18, k]); }
  else { E.push([32, 0], [33, 1], [33.5, 2], [33.75, 3]); for (let k = 0; k < 4; k++) E.push([34, k], [35, k]); }
  // the stations' phases (the press slide, the arm, the gun, the crate) follow their last firing
  const phase = k => { const l = E.filter(e => e[1] === k && e[0] <= beat).map(e => e[0]).pop(); return l === undefined ? 0 : Math.exp(-(beat - l) * 3); };
  const WP = [];
  WG.save(); WG.translate(W / 2, HORIZON_C); WG.scale(z, z); WG.translate(-W / 2, -HORIZON_C);
  const tmpWP = STATIONS.map(([x, k]) => { TG.setTransform(1, 0, 0, 1, 0, 0); return X.station(TG, k, x, HORIZON_C, 1.1, phase(k)); });
  TG.clearRect(0, 0, W, H);
  WG.restore();
  // rings first (behind the machines), then the machines in black, then the ground
  const lock = mode === 'C2' ? eo(clamp((beat - 35) / 0.55)) : 0;
  const Y = [430, 530, 630, 730];
  for (const [b0, k] of E) {
    const age = t - bt(b0); if (age < 0) continue;
    const [px, py] = tmpWP[k];
    const isLast = mode === 'C2' && b0 === 35;
    ringSet(WG, px, py, age, { v: 980, n: 6, gap: 24, decay: isLast ? 0.2 : 0.75, a0: 1.0, seed: Math.round(b0 * 40 + k), lock: isLast ? lock : 0, lockY: Y[k] });
  }
  WG.save(); WG.translate(W / 2, HORIZON_C); WG.scale(z, z); WG.translate(-W / 2, -HORIZON_C);
  for (const [x, k] of STATIONS) X.station(WG, k, x, HORIZON_C, 1.1, phase(k));
  WG.fillStyle = '#0a0405'; WG.fillRect(-100, HORIZON_C - 2, W + 200, H);
  WG.fillStyle = CREAM; WG.globalAlpha = 0.6; WG.fillRect(-100, HORIZON_C + 10, W + 200, 3); WG.globalAlpha = 1;
  // weld sparks at the arm's tip on its firings
  const lw = E.filter(e => e[1] === 1 && e[0] <= beat).map(e => e[0]).pop();
  if (lw !== undefined && beat - lw < 0.6) X.sparks(WG, tmpWP[1][0], tmpWP[1][1], (beat - lw) / 0.6, Math.round(lw * 4), 1);
  WG.restore();
  if (lock > 0) {                                                       // the stripes hold: solid bands under the stipple
    WG.save(); WG.globalAlpha = 0.18 * lock; WG.fillStyle = CREAM; for (const y of Y) WG.fillRect(0, y - 4, W, 44); WG.restore();
  }
}

// ================================================================ render
window.renderFrame = async (tIn) => {
  const frame = Math.round(tIn * 30);
  let t = tIn % DUR, beat = t / SPB + 1e-6;
  const frozen = beat >= 27.5 && beat < 28;
  if (frozen) { t = bt(27.5) - 1 / 60; beat = t / SPB + 1e-6; }
  const [w0, world] = at(WORLDS, beat);
  WG.setTransform(1, 0, 0, 1, 0, 0); WG.globalAlpha = 1; WG.clearRect(0, 0, W, H);
  TY.setTransform(1, 0, 0, 1, 0, 0); TY.clearRect(0, 0, W, H);
  let dot = [W * 0.76, H * 0.14, W * 0.035];
  if (world === 'A') dot = worldA(t, beat, frame);
  else if (world === 'A2') dot = worldA(t, beat, frame, { brk: true });
  else if (world === 'B' || world === 'B2' || world === 'B3') worldB(t, beat, frame, world);
  else if (world === 'Ap') worldAp(t, beat, frame);
  else if (world === "C" || world === "C2") worldStations(t, beat, frame, world);
  else if (world === 'AR') dot = worldA(t, beat, frame, { red: true, empty: true });
  else {                                                              // LOCK: red, then the dissolve to frame 0
    const a = t - bt(CLOSE), d = eio(clamp((a - LOCK_HOLD) / (DUR - bt(CLOSE) - LOCK_HOLD - 1 / 30)));
    if (d > 0) { worldA(0, 0, 1, { empty: true }); WG.globalAlpha = 1 - d; WG.fillStyle = '#C91F37'; WG.fillRect(0, 0, W, H); WG.globalAlpha = 1; }
    else { WG.fillStyle = '#C91F37'; WG.fillRect(0, 0, W, H); }
    drawLockup(TY, a, [W * 0.76, H * 0.14, W * 0.035]);
  }
  // impact frames (anime): the first two frames of a drop are the world inverted, then red-black
  for (const b of IMPACT_FRAMES) {
    const k = Math.floor((t - bt(b)) * 30 + 1e-3);
    if (k >= 0 && k < 2) {
      TG.setTransform(1, 0, 0, 1, 0, 0); TG.clearRect(0, 0, W, H); TG.filter = k === 0 ? 'invert(1) grayscale(1) contrast(3.2)' : 'grayscale(1) contrast(4) brightness(1.2)';
      TG.drawImage(worldCv, 0, 0); TG.filter = 'none';
      if (k === 1) { TG.globalCompositeOperation = 'multiply'; TG.fillStyle = '#E53239'; TG.fillRect(0, 0, W, H); TG.globalCompositeOperation = 'source-over'; }
      WG.drawImage(tmpC, 0, 0);
    }
  }
  // the type rail
  let lift = 0;
  if (!frozen && world !== 'LOCK') {
    const c = at(CUES, beat);
    if (c[1]) { const age = t - bt(c[0]); slam(TY, c[1], age, { emph: c[2], frame }); if (c[2] && age < 2 / 30) lift = 1 - age * 15; }
  }
  const drop = (beat >= 8 && beat < 24) || (beat >= 28 && beat < CLOSE);
  const kick = drop && !frozen ? Math.exp(-9 * (t - B.last('kick', t))) : 0;
  post.apply({ world: worldCv, type: typeC }, t, { ...SKIN, lens: { ca: 0.007 * kick }, film: { exposure: 0.08 * lift } });
  post.gl.finish();
};
const SKIN = { crt: { amount: 1, curve: 0, scan: 0.2, mask: 0, roll: 0, tracking: 0 }, grain: { amount: 0.5, size: 4, chroma: 0 },
  vignette: { amount: 0.45, inner: 0.35, outer: 1.05 }, type: { glow: 0, shadow: 0.32, grain: 0.3, ca: 0, medium: true } };
window.sceneInfo = { STAND_IN, DUR, SPB, CLOSE };
window.sceneReady = true;
