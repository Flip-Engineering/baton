// LAB PARTICLES: one swarm of 262,144 points that is a galaxy, the Party's mark, a slogan and then the people.
// productive() track, 140 BPM (beats). Each section has its own render language (lib/fx/particles layers):
//  0  GENESIS   glow: GPGPU curl-flow galaxy, position-keyed colour (cream core, red arms, black gaps), trails;
//               the riser tightens the vortex, the snare roll collapses it into a hot core
//  8  MARK      glow + fill: the flow state is handed to the Swarm and bursts into the ACP logo, which settles into a
//               solid bevelled mark with a glowing edge; it smoulders, breathes on the kicks, tears apart into 24
// 24  WE ARE    ink on paper: the torn streams fall as ink onto a cream sheet and set as solid WE / ARE
// 32  MANY      poster: hard flat red points, then a flat red MANY (Constructivist print, no bloom)
// 40  PEOPLE    glow + fill: at dusk MANY pours column by column into silhouettes of the crowd, rim-lit
// 44  MARCH     drop: the crowd takes over, advancing out of a red sun; the light rises off them as embers
// 52  COLUMN    side-on: a column of walkers in profile crossing the sun, banners and fists
// 60  SIGN      glow + fill: embers leave the column and set as the solid ☭≡/acc lockup; 64 impact, ACP.US
import { W, H, C, PAL, pick, loadFonts, loadBeats, clamp, lerp, smooth, ease, line, Finish, loadImage } from '../lib/kit.js';
import { Particles, Swarm, Flow, Dust, Crowd, walkerAtlas, sampleText, sampleImage, sampleVolume, sampleCanvas, recolor, pcache } from '../lib/fx/particles.js';

const cv = document.getElementById('out'); cv.width = W; cv.height = H;
const ctx = cv.getContext('2d', { willReadFrequently: true });
await loadFonts();
const B = await loadBeats('lab_particles');
const spb = B.spb, bt = b => b * spb;
const finish = new Finish(17);
const PERF = window.PERF = { frames: 0, ms: 0, last: 0, parts: {}, load: 0 };
const tLoad = performance.now();
await pcache.load('lab_particles');                 // point sets, matchTo permutations, walker atlas (out/.pcache)

const P = new Particles();
P.profile = location.search.includes('prof=1');
const N = 1 << 18;
const [logoImg, lockImg] = await Promise.all(['acp_logo_dark', 'acc_lockup'].map(n => loadImage(`../assets/${n}.png`)));

// ================================================================ build
const LOGO_Y = H * 0.47;
const galaxy = sampleVolume('galaxy', N, { x: W / 2, y: LOGO_Y, r: 900, rz: 320, arms: 4, seed: 4 });
const collapse = sampleVolume('ball', N, { x: W / 2, y: LOGO_Y, r: 60, seed: 6 });
const flowG = new Flow(P, { side: 512, t0: 0, sub: 1, spawn: galaxy, target: collapse, trail: 0.9, seed: 3, every: 8, cache: 'lab_particles.genesis' });
const flowGAt = t => { const b = t / spb;
  return { amp: 30 + 130 * smooth(3, 8, b), freq: 0.0021, flowSpeed: 0.22, vortex: 240 + 520 * smooth(4, 7.8, b), center: [W / 2, LOGO_Y],
    attract: 3.2 * ease.inCubic(clamp((b - 5.6) / 2.4)), target: 0, life: 7, jitter: 4 }; };
const galaxyColor = { by: 'radius', center: [W / 2, LOGO_Y], r: 760, stops: [PAL.hot, PAL.ember, PAL.red, PAL.oxblood], jitter: 0.14 };
// the swarm starts exactly where the flow particles are at the drop (sim-only replay, checkpointed)
await flowG.advance(bt(8), flowGAt);
const snap = recolor(flowG.snapshot('none'), (x, y, z, i) => pick(i, 1, [[0.9, PAL.red], [0.1, PAL.ember]]));

const sw = new Swarm(P, { n: N });
const logoPts = sampleImage(logoImg, N, { w: 960, y: LOGO_Y, edge: 0.7, zJitter: 90, order: 'random', seed: 2 });
recolor(logoPts, (x, y, z, i) => logoPts.col[i * 4 + 1] > 150 ? pick(i, 2, [[1, PAL.cream]]) : pick(i, 77, [[0.93, PAL.red], [0.07, PAL.ember]]));
const edgePts = sampleImage(logoImg, 65536, { w: 960, y: LOGO_Y, edge: 4, zJitter: 20, seed: 9 });
const flowS = new Flow(P, { side: 256, t0: bt(8), spawn: edgePts, trail: 0.9, seed: 5, every: 8, cache: 'lab_particles.smoulder' });
const flowSAt = () => ({ amp: 55, freq: 0.004, flowSpeed: 0.5, wind: [8, -150], life: 1.4, jitter: 3 });
// WE in ink black, ARE in red (they set on paper)
const weAre = recolor(sampleText(['WE', 'ARE'], N, { family: 'Anton', size: [740], lineGap: 0.86, y: H * 0.5, maxW: 1030, edge: 1.2, zJitter: 50, order: 'y', seed: 11 }),
  (x, y, z, i) => y < H * 0.5 ? pick(i, 1, [[0.97, PAL.ink], [0.03, PAL.red]]) : pick(i, 2, [[0.95, PAL.red], [0.05, PAL.ink]]));
// MANY: fitted to the width, then stretched 2.3x tall (poster condensed)
const many = recolor(sampleCanvas(g => {
  let s = 400; g.font = `${s}px "Anton"`; s *= 1030 / g.measureText('MANY').width; g.font = `${s}px "Anton"`;
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.translate(W / 2, H * 0.5); g.scale(1, 2.3); g.fillText('MANY', 0, 0);
}, N, { edge: 0.6, zJitter: 70, order: 'x', seed: 12, color: [255, 255, 255] }), (x, y, z, i) => pick(i, 5, [[0.9, PAL.red], [0.1, PAL.black]]));

const atlas = walkerAtlas();
const HZF = H * 0.47, HZS = H * 0.63;
const crowdF = new Crowd(P, { n: 7000, atlas, view: 'front', vel: [0, -95], velVar: 0.12, zRange: [380, 9000], xRange: [-2400, 2400], seed: 21, variants: [0.6, 0.2, 0.12, 0.08] });
const crowdFOpts = { horizon: HZF, camH: 230, f: 1300, figH: 175, fog: [0.5, 0.07, 0.05], fogDist: 5200, body: [0.014, 0.004, 0.004], rim: [1.6, 0.6, 0.32], red: [0.7, 0.03, 0.06], lightDir: [0, -6] };
const crowdS = new Crowd(P, { n: 8000, atlas, view: 'side', vel: [120, 0], velVar: 0.15, zRange: [280, 4200], xRange: [-3000, 3000], seed: 22, variants: [0.55, 0.2, 0.17, 0.08] });
const crowdSOpts = { horizon: HZS, camH: 70, f: 1300, figH: 175, fog: [0.62, 0.1, 0.06], fogDist: 4200, body: [0.012, 0.003, 0.003], rim: [1.8, 0.75, 0.4], red: [0.75, 0.04, 0.06], lightDir: [-4, -5] };
const creamRed = (redShare, seed) => (x, y, z, i) => pick(i, seed, [[redShare, PAL.red], [0.03, PAL.ember], [1 - redShare - 0.03, PAL.cream]]);
const crowdSnapF = recolor(crowdF.sample(bt(44), N, crowdFOpts, { edge: 1.5, order: 'x', seed: 31 }), creamRed(0.7, 2));
const crowdSnapS = recolor(crowdS.sample(bt(60), N, { ...crowdSOpts, camX: 8 * spb * 60 }, { edge: 1.5, order: 'random', seed: 32 }), creamRed(0.3, 3));
const LOCK_Y = H * 0.25, LOCK_W = 980, markEdge = W / 2 - LOCK_W / 2 + LOCK_W * 290 / 1156;
const lock = recolor(sampleImage(lockImg, N, { w: LOCK_W, y: LOCK_Y, edge: 0.8, zJitter: 30, order: 'random', seed: 13 }),
  (x, y, z, i) => x < markEdge ? pick(i, 4, [[0.9, PAL.red], [0.1, PAL.ember]]) : pick(i, 6, [[1, PAL.cream]]));

// the morph chains: matchTo, stagger, flight styles and auto density are derived from these steps
const story = sw.chain([
  { ps: snap, beat: 0 },
  { ps: logoPts, beat: 8, dur: 3, order: 'radial', flight: 'burst', match: false, ribbon: 0.85, ribbonFreq: 0.0016, stagger: 0.6, staggerPoint: [W / 2, LOGO_Y], scatter: 420, swirl: 0.35, radial: 0.85, hot: 0.3, flightDim: 4 },
  { ps: weAre, beat: 24, dur: 3.2, order: 'y', flight: 'ribbon', preset: 'ink', scatter: 420, swirl: -0.6 },
  { ps: many, beat: 32, dur: 3, order: 'x', flight: 'ribbon', preset: 'poster-flat', scatter: 520, swirl: 0.3, ribbonFreq: 0.003 },
  { ps: crowdSnapF, beat: 40, dur: 3.4, order: 'x', flight: 'pour', stagger: 0.4, scatter: 200, ribbonFreq: 0.003, swirl: 0.15, hot: 0.3, colorLead: 0.3 },
], { beats: B, preset: 'silk' });
const sign = sw.chain([
  { ps: crowdSnapS, beat: 0 },
  { ps: lock, beat: 60, dur: 3.8, order: 'random', match: false, flight: 'swirl', stagger: 0.7, scatter: 380, ribbon: 0.6, swirl: 0.5, hot: 1.1, lift: 500 },
], { beats: B, preset: 'silk' });
pcache.save();                                      // new build entries go to disk in the background

const dust = new Dust(P, { n: 2600, seed: 8, zNear: -700, zFar: 2600, dark: 0.35 });
const stars = new Dust(P, { n: 2500, seed: 12, zNear: 1500, zFar: 4000 });
const starOpts = { size: 2.2, alpha: 0.8, glow: 1.4, vel: [0, -4], wobble: 0, dof: 0, color: [1, 0.75, 0.6] };
P.setCamera();
PERF.load = performance.now() - tLoad;

// ================================================================ per-section modulation on top of the chains
const kickPulse = (t, x, y, amp) => { const l = B.last('kick', t); return l < -1e8 ? null : { x, y, age: t - l, amp }; };
function storyExtra(t) {
  const b = t / spb, kick = B.env('kick', t, 9), clap = B.env('clap', t, 10);
  if (b < 24) {             // MARK: burst, settle, smoulder, tear
    const brk = ease.inCubic(clamp((b - 21.5) / 2.5));
    return { turb: 5 + 16 * kick + 60 * brk, explode: 520 * brk, ribbon: b >= 11.4 ? 1 : 0, alpha: 0.26 * (1 + 0.5 * clap) * (1 + 0.6 * brk),
      sweep: { angle: 0.5, pos: lerp(-300, 2200, ((b - 11) / 5) % 1), width: 110, gain: b > 11 ? 1.6 : 0 },
      dof: lerp(0.8, 0.2, brk), size: 2.1 - 0.5 * brk, pulse: kickPulse(t, W / 2, LOGO_Y, 55), seed: 1,
      pulse2: b < 10.5 ? { x: W / 2, y: LOGO_Y, age: Math.max(0, t - bt(8)) * 0.55, amp: 320 } : null };   // the impact's shock ring
  }
  if (b < 32) {             // WE ARE (ink): the torn logo's explode and turbulence carry across the cut
    const carry = 1 - smooth(24, 25.6, b);
    return { explode: 380, explodeOut: true, turb: 3 + 10 * kick + 50 * carry, pulse: kickPulse(t, W / 2, H * 0.44, 30), seed: 2 };
  }
  if (b < 40) {             // MANY (poster)
    const brk = ease.inCubic(clamp((b - 38.5) / 1.5));
    return { explode: 60 * brk, turb: 1 + 8 * kick + 40 * brk, steps: 1, pulse: kickPulse(t, W / 2, H * 0.5, 25), seed: 2 };
  }
  const rise = Math.max(0, b - 44) * spb;    // PEOPLE -> MARCH: MANY pours into the crowd, then rises off it as embers
  return { explode: 60, explodeOut: true, turb: 3 + 5 * B.env('taiko', t, 10) + 40 * (1 - smooth(40, 41, b)), freq: 0.005, steps: 1,
    size: 1.8, sizeVar: 0.5, alpha: 0.32 * (b < 44 ? 1 : Math.exp(-rise * 1.3)), rise: rise * 260, dof: b < 44 ? 0 : 0.3, seed: 3, count: b < 44 ? N : (N * 0.4) | 0 };
}
function signExtra(t) {
  const kick = B.env('kick', t, 9), b = t / spb;
  return { turb: 3 + 10 * kick, freq: 0.004, steps: 2, size: 2.1, sizeVar: 0.6, alpha: 0.3 * (1 + 0.8 * B.env('impact', t, 5)), dof: 0.5,
    sweep: { angle: 0, pos: lerp(-200, 1400, clamp((b - 64) / 3)), width: 100, gain: 2 }, pulse: b > 63.9 ? kickPulse(t, W / 2, LOCK_Y, 70) : null, seed: 4 };
}

// ================================================================ frame
const genesisCam = t => { const b = t / spb;
  return { f: 1600, rotX: lerp(0.9, 0, ease.inOutCubic(clamp((b - 1) / 7))), rotY: 0.12 * Math.sin(b * 0.3), zoom: lerp(0.92, 1.12, ease.inCubic(b / 8)), cy: LOGO_Y }; };
const markCam = t => { const b = t / spb, hold = clamp((b - 11) / 11), kick = B.env('kick', t, 9);
  return { f: 1600, rotY: 0.2 * Math.sin((b - 8) * 0.22) * smooth(9, 13, b), rotX: 0.06 * Math.sin((b - 8) * 0.17), zoom: 1 + 0.06 * hold + 0.015 * kick, cy: LOGO_Y }; };
const genesisDraw = tt => ({ size: 1.5, alpha: 0.11 * (0.8 + 0.6 * tt / spb / 8), color: galaxyColor, trail: 0.9, trailGain: 0.55, heads: 2.4, headCount: 1 << 17, dof: 0.5, cam: genesisCam(tt) });
const smoulderDraw = tt => { const b = tt / spb;
  return { size: 1.8, alpha: 0.2, c0: [1, 0.16, 0.07], c1: [1, 0.55, 0.25], trail: 0.9, trailGain: 1.1 * smooth(10.5, 13, b) * (1 - smooth(21.5, 23.5, b)), heads: 0, cam: markCam(tt) }; };
window.renderFrame = async (t) => {
  const t0 = performance.now(), b = t / spb, frame = Math.round(t * 30);
  const kick = B.env('kick', t, 9), impact = B.env('impact', t, 6), taiko = B.env('taiko', t, 10), brass = B.env('brass', t, 5);
  P.profStart();
  P.begin([0, 0, 0]);
  const pres = { exposure: 1.2, bloom: 0.7, bloomThresh: 0.35, contrast: 1.08, sat: 1, ramp: 0.6 };
  let flash = 0.18 * impact * (b > 7.9 ? 1 : 0), grain = 0.07, vignette = 0.75;
  const cam = { f: 1600 };

  if (b < 8) {
    // ---------------- GENESIS (glow)
    const u = b / 8;
    P.setCamera(genesisCam(t));
    P.sky(t, { top: [0, 0, 0], mid: [0.015, 0.001, 0.003], bottom: [0, 0, 0], glow: [0, 0, 0], halo: { x: 0.5, y: LOGO_Y / H, r: 0.3, color: [0.06 + 0.12 * u, 0.005, 0.01] } });
    P.mark('sky');
    stars.draw(t, starOpts);
    P.mark('stars');
    P.layer('gal', { mode: 'glow', ref: 0.05, exposure: 1, hot: [1.3, 3.2], bloom: 0.55 });
    await flowG.render(t, flowGAt, genesisDraw);
    P.layer();
    P.mark('flowG');
    dust.draw(t, { size: 5, alpha: 0.4, glow: 1.2, vel: [6, -30], dof: 1.3 });
    P.mark('dust');
    Object.assign(pres, { exposure: 1.2, contrast: 1.12, ramp: 0, bloom: 0.5 });
  } else if (b < 24) {
    // ---------------- MARK (glow + fill)
    P.setCamera(markCam(t));
    P.sky(t, { top: [0, 0, 0], mid: [0.03, 0.003, 0.005], bottom: [0, 0, 0], glow: [0, 0, 0],
      halo: { x: 0.5, y: LOGO_Y / H, r: 0.42, color: [0.22 + 0.2 * kick, 0.02, 0.025] } });
    if (b > 10.5) await flowS.render(t, flowSAt, smoulderDraw);
    P.mark('flowS');
    const brk = ease.inCubic(clamp((b - 21.5) / 2.5)), fill = smooth(11.2, 12.6, b) * (1 - smooth(22.8, 24, b));   // the tear erodes the solid mark
    P.layer('mark', { mode: 'glow', hot: [1.8, 4.2], bloom: 0.45, fill, th: 0.22 + 1.2 * brk, soft: 0.08, bevel: 6, edge: 1, spark: 0.15, blur: 10, snap: true });
    story.draw(t, storyExtra);
    if (b < 12.5) story.draw(t, storyExtra, { streak: 0.045, count: 30000, alpha: 0.26 * 1.6 * (1 - smooth(10.5, 12.5, b)) });   // short needles: a dense burst stays open   // speed lines on the fly-in
    P.layer();
    P.mark('swarm');
    dust.draw(t, { size: 5, alpha: 0.4, glow: 1.3, vel: [10, -45], dof: 1.3 });
    P.mark('dust');
    Object.assign(pres, { ramp: 0.3, bloom: 0.55 });
  } else if (b < 40) {
    // ---------------- WE ARE (ink on paper) / MANY (poster)
    const second = b >= 32, hold = second ? clamp((b - 34) / 6) : clamp((b - 26) / 6);
    cam.zoom = 1 + 0.05 * ease.outCubic(hold) + 0.008 * kick; cam.rotY = 0.06 * Math.sin(b * 0.25); cam.cy = H * 0.5;
    P.setCamera(cam);
    const set = second ? smooth(34.4, 35.4, b) * (1 - smooth(38.6, 39.4, b)) : smooth(25.4, 26.4, b);   // the fill only takes settled (dense) letters
    if (!second) P.layer('ink', { mode: 'ink', ground: PAL.paper, fill: set, th: 0.25, soft: 0.06, inkK: 1.5, blur: 7, snap: true });
    else P.layer('poster', { mode: 'poster', ground: PAL.paper, fill: set, th: 0.3, soft: 0.03, fillColor: PAL.red, blur: 4 });
    story.draw(t, storyExtra);
    P.layer();
    P.mark('swarm');
    Object.assign(pres, { bloom: 0, ramp: 0 });
    grain = 0.1; vignette = 0.35; flash = 0;
  } else if (b < 52) {
    // ---------------- PEOPLE -> MARCH (front)
    const on = smooth(43.5, 44.1, b), sunUp = smooth(40, 44, b);
    P.setCamera({ f: 1600 });
    const calm = 1 - on;                               // the break (40-44): a clean dusk under the pour; the drop brings the full sky
    P.sky(t, { top: [0.0, 0, 0.002], mid: [0.09, 0.008, 0.01], bottom: [0.03, 0.004, 0.004], horizon: HZF / H, glow: [(0.7 + 0.5 * taiko) * (1 - 0.6 * calm), 0.1, 0.05], glowW: 0.07, clouds: 1 - 0.4 * calm,
      sun: { x: 0.5, y: HZF / H + 0.02 - 0.05 * sunUp, r: 0.2 * (0.6 + 0.4 * sunUp), color: [1.25 * (0.3 + 0.7 * sunUp), 0.22 * sunUp, 0.1 * sunUp], clip: calm, bands: 0.7 * calm } });   // dawn: half-sunk, streaked by strata
    stars.draw(t, { ...starOpts, alpha: 0.5 });
    P.mark('stars');
    const camZ = Math.max(0, b - 44) * spb * 40;
    if (on > 0) crowdF.draw(t, { ...crowdFOpts, camZ, alpha: on, rimK: 1 + 0.8 * brass });
    P.mark('crowd');
    // the pour sets as dark rim-lit silhouettes that match the crowd frame at 44, then the real crowd takes over
    const fill = smooth(42.6, 43.2, b) * (1 - on);   // only once the columns have landed (the fill would catch a sheet in flight)
    P.layer('people', { mode: 'glow', hot: [1.6, 3.6], bloom: 0.5, fill, th: 0.12, soft: 0.05, fillColor: [0.03, 0.006, 0.006], edge: 1.6, spark: 0.1, blur: 7 });
    story.draw(t, storyExtra);
    if (b < 43.6) story.draw(t, storyExtra, { streak: 0.06, count: 20000, alpha: 0.8 * smooth(40, 40.6, b) * (1 - smooth(42.8, 43.6, b)) });   // the pour as falling rain of light
    P.layer();
    P.mark('swarm');
    dust.draw(t, { size: 6, alpha: 0.5, glow: 1.6, vel: [12, -70], dof: 1.5, focus: 1300 });
    P.mark('dust');
    Object.assign(pres, { bloom: 0.85 - 0.4 * calm, exposure: 1.6 - 0.2 * calm });
  } else if (b < 70) {
    // ---------------- COLUMN (side) + SIGN (glow + fill)
    const sink = 0.12 * ease.inOutCubic(clamp((b - 60) / 7));
    P.setCamera({ f: 1600 });
    const sg = B.env('gong', t, 1.2);
    P.sky(t, { top: [0.0, 0, 0.002], mid: [0.12, 0.01, 0.012], bottom: [0.02, 0.003, 0.003], horizon: HZS / H, glow: [0.8 + 0.4 * sg, 0.12, 0.06], glowW: 0.09, clouds: 1.4,
      sun: { x: 0.5, y: HZS / H - 0.04 + sink, r: 0.2, color: [1.05, 0.2, 0.08] } });
    stars.draw(t, { ...starOpts, alpha: 0.5 });
    P.mark('stars');
    crowdS.draw(t, { ...crowdSOpts, camX: (b - 52) * spb * 60, rimK: 1 + 0.8 * brass });
    P.mark('crowd');
    if (b >= 59.5) {
      P.layer('sign', { mode: 'glow', hot: [1.5, 3.6], bloom: 0.4, fill: smooth(63.2, 64.2, b), th: 0.18, soft: 0.06, bevel: 5, edge: 1.1, spark: 0.15, blur: 8, snap: true });
      sign.draw(t, signExtra);
      P.layer();
    }
    P.mark('swarm');
    dust.draw(t, { size: 6, alpha: 0.5, glow: 1.6, vel: [-20, -60], dof: 1.5, focus: 1300 });
    P.mark('dust');
    Object.assign(pres, { bloom: 0.85, exposure: 1.6 });
  }
  P.present(ctx, pres);
  P.mark('present');
  // ---------------- 2D overlay: the sign-off line, film finish
  if (b >= 64) {
    const a = ease.outCubic(clamp((b - 64.2) * 2.5)), y = LOCK_Y + 300;
    ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = C.red2; ctx.fillRect(W / 2 - 330 * a, y - 118, 660 * a, 150); ctx.restore();
    line(ctx, 'ACP.US', W / 2, y, { family: 'Archivo Black', size: 132, color: C.cream, alpha: a, tracking: 0.06, maxW: 620 });
    line(ctx, 'OWN THE FUTURE', W / 2, y + 120, { family: 'Anton', size: 84, color: C.cream, alpha: clamp((b - 65) * 2.5), tracking: 0.16, shadow: 24 });
  }
  finish.apply(ctx, frame, { grain, vignette, flash });
  P.mark('finish2d');
  PERF.parts = P.prof;
  const ms = performance.now() - t0; PERF.frames++; PERF.ms += ms; PERF.last = ms;
};
window.sceneReady = true;
