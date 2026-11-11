// THE FACTORY c20 (scenes machines_e1_a.html, machines_e1_b.html; the take is window.FACTORY_TAKE): the rebuild.
// research/scripts_final/machines_e1.json (c20 words), brief videos/review/WHO_OWNS_THE_MACHINES_FACTORY_c20/NOTES.md.
// The gag stays: the owners keep changing (the UNDER NEW MANAGEMENT banner over the gate) and the crew stays.
// What changed from v3 (machines_e1.js, kept for the published versions):
//   - the people are the person pipeline's (lib/fx/people.js, the current person system), not the hero piece's trucker
//     silhouette re-dressed; the plant is the objects kit's (pressLine, cobotArm) lit under sodium, not pictograms on red
//   - no rings anywhere (the dot is a plain sun); no red-field profile frames (those beats are inside the plant)
//   - CREW! once, at b28, on the crew's arms going up before the lit press; no freeze, no hole at b27.5
//   - the owners, in the picture: take a, the crew themselves hang each new owner's banner from a lift and go back in;
//     take b, the owners only ever pass the gate in a dark car that never stops, a different one each time
// WORLDS (beats, 116 BPM)
//   A      b0-8     the cold gate at 5:40 a.m.: the worker in profile, the dot over the water tower, the banner; b4 he
//                   turns and walks in (CLOCK IN.)
//   B      b8-12    the plant behind the gate: the press line through the bay (P-11 and its operator, who never moves);
//                   NEXT. NEXT.: the banner changes (a: the two on the lift; b: a car passes each time)
//   LINE   b12-16   inside: the line, OUR LINE.     CELL b16-18 the weld arm, OUR PACE.     SLAM b18-20 the die
//   B2     b20-24   the crew filing through the gate under the latest banner, SAME CREW.
//   A2     b24-28   the break: frame 0 again, darker, the dot closer; WHO OWNS / THE MACHINES?, a played hush
//   CROWD  b28-30.5 CREW!: the crew in hard hats before the lit press, arms going up
//   TEAR   b30.5-32 the gate: the wind strips the banners off the frame
//   ROLL   b32-34   LET 'ER ROLL.: the line running     CELL2 b34-35     SLAM2 b35-36
//   AR     b36-40   WE RUN IT.: frame 0's composition, the sky turned red, the sign frame empty
//   LOCK   b40-     the dot docks as the gear's hub; dissolve to frame 0 (the loop)
import { W, H, loadFonts, loadBeats, Beats, loadImage, clamp, lerp, ease } from '../lib/kit.js';
import { Post } from '../lib/fx/post.js';
import * as X from './machines_e1_gate.js';
import { Plant, Figures } from './machines_e1_plant.js';

const TAKE = (window.FACTORY_TAKE || 'a').toLowerCase();
const SCENE = location.pathname.split('/').pop().replace(/\.html$/, '');

// ================================================================ the words (scripts_final/machines_e1.json, c20)
const CUES = [[0, 'SAME CREW.', 1], [3.5, null], [4, 'CLOCK IN.', 0], [6, null], [8, 'THE FACTORY.', 1], [9.5, null],
  [10, 'NEXT.', 0], [10.75, null], [11, 'NEXT.', 0], [11.75, null], [14, 'OUR LINE.', 1], [15.5, null], [16, 'OUR PACE.', 0], [17.5, null],
  [20, 'SAME CREW.', 1], [22, null], [24, 'WHO OWNS', 1], [25, 'THE MACHINES?', 0], [27.5, null], [28, 'CREW!', 1], [29.5, null],
  [32, "LET 'ER ROLL.", 0], [33.75, null], [36, 'WE RUN IT.', 1], [40, null]];
const CLOSE = 40, LOCK_FRAMES = 42;
const WORLDS = [[0, 'A'], [8, 'B'], [12, 'LINE'], [16, 'CELL'], [18, 'SLAM'], [20, 'B2'], [24, 'A2'], [28, 'CROWD'], [30.5, 'TEAR'],
  [32, 'ROLL'], [34, 'CELL2'], [35, 'SLAM2'], [36, 'AR'], [CLOSE, 'LOCK']];
const IMPACT_FRAMES = [8, 28];
// the banner layers: [style, beat put up, dx, dy, rot, width k, seed]
const LAYERS = [[0, -99, -16, 7, -0.022, 1.05, 1], [1, 0, 0, 0, 0.01, 1.0, 2], [2, 2, 9, -5, -0.016, 0.97, 3], [3, 10, -7, 4, 0.013, 1.02, 4],
  [4, 11, 11, 2, -0.02, 0.95, 5], [5, 20, -4, -3, 0.008, 1.0, 6]];
const TEAR = 30.6;
// take b: the owners' cars, [beat the car is level with the gate, style, direction]
const CARS = [[10, 'sedan', 1], [11, 'suv', -1], [20, 'long', 1]];

// ================================================================ boot
await loadFonts();
await Promise.all([['Overpass', 'overpass/files/overpass-latin-900-normal.woff2', '900'], ['Overpass', 'overpass/files/overpass-latin-800-normal.woff2', '800'],
  ['Overpass', 'overpass/files/overpass-latin-600-normal.woff2', '600'], ['Cinzel', 'cinzel/files/cinzel-latin-700-normal.woff2', '700'],
  ['Big Shoulders Stencil Display', 'big-shoulders-stencil-display/files/big-shoulders-stencil-display-latin-900-normal.woff2', '900'],
  ['Big Shoulders Stencil Display', 'big-shoulders-stencil-display/files/big-shoulders-stencil-display-latin-700-normal.woff2', '700']]
  .map(async ([fam, file, w]) => { try { const f = new FontFace(fam, `url(../node_modules/@fontsource/${file})`, { weight: w }); document.fonts.add(await f.load()); } catch (e) { console.log('font', fam, e.message); } }));
let B, STAND_IN = false;
try { B = await loadBeats(SCENE); } catch (e) {
  STAND_IN = true; const spb = 60 / 116, hits = { kick: [], snare: [], clap: [] };
  for (let b = 8; b < 36; b++) if (b < 24 || b >= 28) hits.kick.push(b * spb);
  B = new Beats({ bpm: 116, duration: CLOSE * spb + LOCK_FRAMES / 30, loop: true, hits, text: [] });
}
const SPB = B.spb, bt = b => b * SPB;
const DUR = B.loop && B.duration > CLOSE * SPB ? Math.min(B.duration, CLOSE * SPB + LOCK_FRAMES / 30) : CLOSE * SPB + LOCK_FRAMES / 30;
const LOCK_HOLD = Math.min(LOCK_FRAMES / 30, DUR - CLOSE * SPB - 10 / 30);
window.DURATION = DUR;
const [markImg, eqImg, slashImg, accImg] = await Promise.all(['part_mark', 'part_eq', 'part_slash', 'part_acc'].map(k => loadImage(`../assets/${k}.png`)));

const mk = (w = W, h = H) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const g2 = c => c.getContext('2d', { willReadFrequently: true });
const worldCv = mk(), WG = g2(worldCv), typeC = mk(), TY = g2(typeC), tmpC = mk(), TG = g2(tmpC), nearC = mk(), NG = g2(nearC);
const post = new Post(W, H, { direct: true });
const tint = (img, col) => { const c = mk(img.width, img.height), g = g2(c); g.drawImage(img, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = col; g.fillRect(0, 0, c.width, c.height); return c; };
const CREAM = '#F4E6D0';
const LOCK = { mark: tint(markImg, CREAM), eq: tint(eqImg, CREAM), slash: tint(slashImg, CREAM), acc: tint(accImg, CREAM) };
const BG_A = X.bgA(), BG_AR = X.bgA({ red: true }), BG_B = X.bgB();
const BAN = X.STYLES.map((_, k) => X.makeBanner(k));
const plant = new Plant(W, H), figs = new Figures(W, H);
TY.font = '100px "Anton"'; const CAPR = TY.measureText('H').actualBoundingBoxAscent / 100;

// ================================================================ helpers
const at = (list, b) => { let r = list[0]; for (const x of list) if (b >= x[0]) r = x; return r; };
const eio = ease.inOutCubic, eo = ease.outCubic;
function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
const kicksT = () => B.hits.kick || [];
function kickClock(t) {                    // seconds since the last kick and until the next
  let since = 9, until = 9; for (const k of kicksT()) { if (k <= t + 1e-4) since = t - k; else { until = k - t; break; } } return { since, until };
}

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

// ---- the banner stack at a beat, drawn at a gate's frame. Take a: a banner goes up without the slap's dust (the crew tie
// it on); take b: it is simply there after the car has passed
function banners(g, G, beat, t, frame, { scale = 1, light = null, shade = 0.3 } = {}) {
  const tear = beat >= TEAR ? clamp((beat - TEAR) / 1.3) : 0;
  if (tear >= 1) return;
  for (const [st, b0, dx, dy, rot, wk, seed] of LAYERS) {
    if (beat < b0) continue;
    let slap = clamp((beat - b0) * SPB / 0.13);
    if (frame === 0 && b0 === 0) slap = 1;
    const tr = tear > 0 ? clamp(tear * 1.25 - 0.06 * seed * 0.3) : 0;
    X.drawBanner(g, BAN[st], G.bx, G.by + G.bh / 2, G.bw * wk * scale, t, { seed, dx: dx * scale, dy: dy * scale, rot, slap, tear: tr, light, shade });
  }
}

// ---- the lockup (the family grammar): the dot docks as the gear's hub, ≡ / acc slide in, ACP.US
function drawLockup(ctx, a, from) {
  const d = eio(clamp((a - LOCK_HOLD) / (DUR - bt(CLOSE) - LOCK_HOLD - 1 / 30))), fade = 1 - d;
  const hL = 230, sc = hL / 291, wM = 300 * sc, wE = 220 * sc, wS = 119 * sc, wA = 517 * sc, total = wM + wE + wS + wA;
  const x0 = W / 2 - total / 2, cy = 880, hub = [x0 + 150 * sc, cy - hL / 2 + 148 * sc, 62 * sc];
  const u = eio(clamp(a / 0.3));
  const dx = lerp(from[0], hub[0], u), dy = lerp(from[1], hub[1], u), dr = lerp(from[2], hub[2], u);
  ctx.save(); ctx.globalAlpha = fade;
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
// A: the cold gate. The figure layer rides the world's zoom so he stands on its ground.
function worldA(t, beat, frame, { brk = false, red = false, empty = false } = {}) {
  const u = brk || red ? 0 : eio(clamp(beat / 8));
  const z = brk ? lerp(1.04, 1.1, eio(clamp((beat - 24) / 4))) : red ? lerp(1.0, 1.03, clamp((beat - 36) / 4)) : lerp(1, 1.12, u);
  const P = [W * 0.42, H * 0.64];
  WG.save(); WG.translate(P[0], P[1]); WG.scale(z, z); WG.translate(-P[0], -P[1]);
  WG.drawImage(red ? BG_AR : BG_A, 0, 0);
  X.gateA(WG, { red });
  if (!empty) banners(WG, X.GATE_A, beat, t, frame, { light: red ? null : 'rgb(150,160,176)', shade: 0.25 });
  // the man: the person pipeline's worker at 5:40 a.m., near-silhouette, the sodium lamps and the dot behind him
  figs.horizonCam(X.HZ_A);
  if (red) figs.light({ rim: 0xff6a58, rimI: 4.2, rimAz: 2.3, key: 0x6a2020, keyI: 0.5, sky: 0x6a1a1a, gnd: 0x200606, hemi: 0.45, exp: 1.0 });
  else figs.light({ rim: 0xffa060, rimI: brk ? 2.4 : 3.2, rimAz: 2.4, key: 0x8a98a8, keyI: brk ? 0.45 : 0.75, sky: 0x4a5664, gnd: 0x1a1e22, hemi: brk ? 0.35 : 0.5, exp: 1.0 });
  const walk = !brk && !red && beat >= 4.1 ? (beat - 4.1) * SPB : -1;
  WG.drawImage(figs.gateWorker(t, { walk, look: brk ? 0.18 : 0.1 }), 0, 0);
  WG.restore();
  // the dot: a plain sun over the water tower, drifting down and growing; closer in the break. No rings.
  const dot = brk ? [W * 0.80, H * 0.17, W * 0.05] : red ? [W * 0.76, H * 0.14, W * 0.035] : [lerp(W * 0.76, W * 0.80, u), lerp(H * 0.14, H * 0.2, u), lerp(W * 0.035, W * 0.045, u)];
  const hr = dot[2] * (red ? 3.0 : 2.4), hg = WG.createRadialGradient(dot[0], dot[1], dot[2], dot[0], dot[1], hr);
  hg.addColorStop(0, red ? 'rgba(70,6,10,0.85)' : 'rgba(10,10,14,0.55)'); hg.addColorStop(1, red ? 'rgba(70,6,10,0)' : 'rgba(10,10,14,0)');
  WG.fillStyle = hg; WG.fillRect(dot[0] - hr, dot[1] - hr, 2 * hr, 2 * hr);
  WG.fillStyle = '#E53239'; WG.beginPath(); WG.arc(dot[0], dot[1], dot[2], 0, Math.PI * 2); WG.fill();
  if (brk) { WG.fillStyle = `rgba(0,0,6,${0.22 + 0.08 * clamp((beat - 24) / 3)})`; WG.fillRect(0, 0, W, H); }
  return dot;
}

// B / B2 / TEAR: the plant behind the gate. The bay is a window onto the 3D plant (P-11 and its operator)
const DGATE = 18.5;
function worldB(t, beat, frame, mode) {
  const w0 = mode === 'B' ? 8 : mode === 'B2' ? 20 : 30.5, dur = mode === 'TEAR' ? 1.5 : 4;
  const barU = clamp((beat - w0) / dur), kick = B.env('kick', t, 9);
  const z = (mode === 'B2' ? lerp(1.0, 1.04, barU) : lerp(1, 1.06, barU)) * (1 + 0.025 * kick);
  const P = [W * 0.5, H * 0.6];
  const kc = kickClock(t);
  WG.save(); WG.translate(P[0], P[1]); WG.scale(z, z); WG.translate(-P[0], -P[1]);
  WG.drawImage(BG_B, 0, 0);
  // the bay: the plant through the door (the press comes down on the kick), with the sodium haze over it
  const pc = plant.render('bay', t, barU, { since: kc.since, until: kc.until, phase: t * 0.45 });
  const Bx = X.BAY, bw = Bx.x1 - Bx.x0, bh = Bx.base - Bx.top, sh = W * bh / bw;
  WG.drawImage(pc, 0, (H - sh) / 2 - 120, W, sh, Bx.x0, Bx.top + 4, bw, bh - 4);
  { const hz = WG.createLinearGradient(0, Bx.top, 0, Bx.base); hz.addColorStop(0, 'rgba(255,150,70,0.10)'); hz.addColorStop(0.7, 'rgba(255,170,90,0.16)'); hz.addColorStop(1, 'rgba(255,210,150,0.32)');
    WG.globalCompositeOperation = 'screen'; WG.fillStyle = hz; WG.fillRect(Bx.x0, Bx.top, bw, bh); WG.globalCompositeOperation = 'source-over'; }
  figs.horizonCam(X.HZ_B);
  figs.light({ rim: 0xffa050, rimI: 4.2, rimAz: Math.PI, key: 0x5a4a44, keyI: 0.35, keyAz: -0.4, sky: 0x3a2018, gnd: 0x120806, hemi: 0.4, exp: 1.0 });
  // the crew filing in (B2): those past the gate line first, behind the frame
  const tt = t - bt(20);
  if (mode === 'B2') WG.drawImage(figs.walkers(t, 'far', DGATE, tt), 0, 0);
  if (TAKE === 'a') X.drawLift(WG, 'back');
  X.gateB(WG);
  banners(WG, X.GATE_B, beat, t, frame, { light: 'rgb(205,150,128)', shade: 0.35 });
  if (TAKE === 'a') {
    // the two on the lift (b8-12 at the frame, a new owner's banner going up at each NEXT.; after that the lift stands empty)
    if (mode === 'B') WG.drawImage(figs.lifters(t, X.LIFT.deck, X.LIFT.base, [X.LIFT.cx - 75, X.LIFT.cx + 70]), 0, 0);
    X.drawLift(WG, 'front');
  }
  if (mode === 'B2') { NG.setTransform(1, 0, 0, 1, 0, 0); NG.clearRect(0, 0, W, H); NG.drawImage(figs.walkers(t, 'near', DGATE, tt), 0, 0); WG.drawImage(nearC, 0, 0); }
  if (TAKE === 'b') {
    // the owners pass the gate and never stop: each car is level with the gate on its beat; the banner is new after it
    const groundY = 1739, len = 1250, v = 2900;
    for (const [cb, style, dir] of CARS) {
      const dt = t - bt(cb); if (Math.abs(dt) > 0.6) continue;
      X.drawCar(WG, style, W / 2 + dir * dt * v, groundY, style === 'long' ? len * 1.12 : len, dir, v / 30 * 1.4);
    }
  }
  WG.restore();
}

// the plant shots (3D, full frame), with the kick clock driving the press and the crowd's arms on CREW!
function worldPlant(t, beat, world) {
  const kc = kickClock(t), [w0] = at(WORLDS, beat), nx = WORLDS[WORLDS.findIndex(w => w[0] === w0) + 1][0], u = clamp((beat - w0) / (nx - w0));
  let shot = { LINE: 'line', CELL: 'cell', CELL2: 'cell', SLAM: 'slam', SLAM2: 'slam', CROWD: 'crowd', ROLL: 'roll' }[world];
  let since = kc.since, until = kc.until;
  if (world === 'SLAM' || world === 'SLAM2') { since = t - bt(w0); until = 9; }        // the cut lands on the slide hitting the die
  const up = world === 'CROWD' ? (beat - 28) * SPB / 0.35 : 0;
  const phase = world === 'ROLL' ? (t - bt(32)) * 0.9 : t * 0.45;
  WG.drawImage(plant.render(shot, t, u, { since, until, up, phase }), 0, 0);
}

// ================================================================ render
window.renderFrame = async (tIn) => {
  const frame = Math.round(tIn * 30);
  const t = tIn % DUR, beat = t / SPB + 1e-6;
  const [, world] = at(WORLDS, beat);
  WG.setTransform(1, 0, 0, 1, 0, 0); WG.globalAlpha = 1; WG.clearRect(0, 0, W, H);
  TY.setTransform(1, 0, 0, 1, 0, 0); TY.clearRect(0, 0, W, H);
  if (world === 'A') worldA(t, beat, frame);
  else if (world === 'A2') worldA(t, beat, frame, { brk: true });
  else if (world === 'B' || world === 'B2' || world === 'TEAR') worldB(t, beat, frame, world);
  else if (world === 'AR') worldA(t, beat, frame, { red: true, empty: true });
  else if (world === 'LOCK') {
    const a = t - bt(CLOSE), d = eio(clamp((a - LOCK_HOLD) / (DUR - bt(CLOSE) - LOCK_HOLD - 1 / 30)));
    if (d > 0) { worldA(0, 0, 1, { empty: true }); WG.globalAlpha = 1 - d; WG.fillStyle = '#C91F37'; WG.fillRect(0, 0, W, H); WG.globalAlpha = 1; }
    else { WG.fillStyle = '#C91F37'; WG.fillRect(0, 0, W, H); }
    drawLockup(TY, a, [W * 0.76, H * 0.14, W * 0.035]);
  } else worldPlant(t, beat, world);
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
  if (world !== 'LOCK') {
    const c = at(CUES, beat);
    if (c[1]) { const age = t - bt(c[0]); slam(TY, c[1], age, { emph: c[2], frame }); if (c[2] && age < 2 / 30) lift = 1 - age * 15; }
  }
  const drop = (beat >= 8 && beat < 24) || (beat >= 28 && beat < CLOSE);
  const kick = drop ? Math.exp(-9 * (t - B.last('kick', t))) : 0;
  post.apply({ world: worldCv, type: typeC }, t, { ...SKIN, lens: { ca: 0.006 * kick }, film: { exposure: 0.08 * lift } });
  post.gl.finish();
};
const SKIN = { crt: { amount: 1, curve: 0, scan: 0.12, mask: 0, roll: 0, tracking: 0 }, grain: { amount: 0.45, size: 3, chroma: 0 },
  vignette: { amount: 0.4, inner: 0.35, outer: 1.05 }, type: { glow: 0, shadow: 0.32, grain: 0.3, ca: 0, medium: true } };
window.sceneInfo = { STAND_IN, DUR, SPB, CLOSE, TAKE, SCENE };
window.sceneReady = true;
