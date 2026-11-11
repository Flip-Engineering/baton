// micro-benchmark for lib/fx/geo + lib/fx/hud: median ms of each effect alone at 1080x1920, GPU-synced
// (2D canvas getImageData of one pixel, after the effect). node tools/maps_bench.mjs [--view name,name] [--determinism]
import * as THREE from 'three';
import { W, H, C, loadFonts, outCanvas, Beats } from '../lib/kit.js';
import { MapKit } from '../lib/fx/geo/shot.js';
import { empire, meltdown, frontier } from '../lib/fx/geo/pieces.js';
import { Post } from '../lib/fx/post.js';
import { Print } from '../lib/fx/print.js';
import { loadGeo, USMap, Network, Globe, SpikeMap, Thermal, odometer, splitflap, terminal, reticle, ticker, viewfinder, callout, readout, hudBegin } from '../lib/fx/maps.js';
const ctx = outCanvas(); await loadFonts();
const S = performance.now(); const geo = await loadGeo(); const tLoad = performance.now() - S;
const s1 = performance.now(); const us = new USMap(geo); us._bake(); const tUS = performance.now() - s1;
const s1b = performance.now(); us.plate({ Print }); const tPlate = performance.now() - s1b;
const s2 = performance.now(); const rail = Network.rail(geo, us, { arc: 0.12 }), grid = Network.grid(geo, us); const tNet = performance.now() - s2;
const s3 = performance.now(); const globe = new Globe(geo, { cx: W / 2, cy: 1000, r: 470 }); globe._bake(); const tGlobe = performance.now() - s3;
const s4 = performance.now(); const spikes = new SpikeMap(geo, THREE, { lod: 'lo' }); const tSpk = performance.now() - s4;
const spikesHi = new SpikeMap(geo, THREE, { lod: 'hi' });
const th = new Thermal(360, 640), post = new Post(W, H);
const PB = new Beats({ bpm: 140, hits: {}, duration: 30 }), PM = await MapKit.load(PB, { THREE });
const P = { empire: empire(PM, PB), meltdown: meltdown(PM, PB), frontier: frontier(PM, PB) };
console.log(`setup: loadGeo ${tLoad.toFixed(0)} USMap+bake ${tUS.toFixed(0)} (bake ${us.bakeMs.toFixed(0)}) plate ${tPlate.toFixed(0)} networks ${tNet.toFixed(0)} Globe+bake ${tGlobe.toFixed(0)} SpikeMap(lo) ${tSpk.toFixed(0)} ms`);
const bg = (c = '#070102') => { ctx.fillStyle = c; ctx.fillRect(0, 0, W, H); };
const cam = { x: 540, y: 380, zoom: 1.02, sy: 900 }, camZ = { x: 700, y: 250, zoom: 3.6, sy: 900 }, camG = { x: 690, y: 320, zoom: 2.7, sy: 980 };
const arcs = globe.bases.map(b => ({ from: b.ll, to: globe.home.ll, u: 0.8, tail: 0.7 }));
const ig = r => ({ origin: [-83, 42.3], r, width: 46 });
const NYC = [-74.0, 40.71];
const spkc = (o) => t => { spikes.sky(ctx, { horizon: o.hz ?? 0.42 }); spikes.composite(ctx, spikes.render({ t, ripple: { origin: [-87.63, 41.88], r: 1700 }, hero: { ll: NYC, pop: 8.1e6, radius: 12 }, fogDist: 900, ...o }), { dof: 1, horizon: o.hz ?? 0.42 }); };
const spk = (sp, t) => { sp.sky(ctx, {}); sp.composite(ctx, sp.render({ t, ripple: { origin: [-87.63, 41.88], r: 1700 }, hero: { ll: NYC, pop: 8.1e6, radius: 12 }, orbit: 1.25, dist: 520, height: 150, target: [1180, 90, 330], fov: 38, fogDist: 900 }), { dof: 1 }); };
console.log('NYC', JSON.stringify(spikes.proj(NYC)), 'CHI', JSON.stringify(spikes.proj([-87.63, 41.88])));
const TESTS = {
  bg: () => bg(),
  us_ember_ignite_z1: t => us.draw(ctx, { cam, ignite: ig(500), t, style: 'ember' }),
  us_ember_ignite_z36: t => us.draw(ctx, { cam: camZ, ignite: ig(200), t, style: 'ember' }),
  us_poster: t => { bg('#F4E6D0'); us.draw(ctx, { cam, ignite: ig(600), t, style: 'poster' }); },
  us_night: t => us.draw(ctx, { cam: camG, ignite: ig(900), t, style: 'night' }),
  us_engraving: t => { bg('#efe2c6'); us.draw(ctx, { cam: camG, ignite: ig(300), t, style: 'engraving' }); },
  us_ember_noembers: t => us.draw(ctx, { cam, ignite: ig(500), t, style: 'ember', embers: false }),
  us_ember_res075: t => us.draw(ctx, { cam, ignite: ig(500), t, style: 'ember', res: 0.75 }),
  towns: t => us.towns(ctx, { cam, minPop: 25000 }),
  rail: t => rail.draw(ctx, { cam, reveal: 1e9, t, pulses: 2, nodes: 3 }),
  grid: t => grid.draw(ctx, { cam: camG, reveal: 1e9, t, pulses: 40, width: 1.2, glowW: 6 }),
  globe_photo: t => globe.draw(ctx, { rot: [10, -28, 0], t, style: 'photo', scale: 1.1 }),
  globe_night: t => globe.draw(ctx, { rot: [100, -30, 0], t, style: 'night', scale: 1.1 }),
  globe_poster: t => { bg('#F4E6D0'); globe.draw(ctx, { rot: [150, -40, 0], t, style: 'poster', scale: 1.1 }); },
  globe_solid_cached: t => globe.draw(ctx, { rot: [10, -28, 0], t, style: 'solid', texture: 0.35, rivers: 0.5 }),
  globe_solid_uncached: t => globe.draw(ctx, { rot: [10 + t * 3, -28, 0], t, style: 'solid', texture: 0.35, rivers: 0.5 }),
  globe_dots: t => globe.draw(ctx, { rot: [40, -22, 0], t, style: 'dots', lights: 0 }),
  bases_arcs50: t => { globe.drawBases(ctx, { rot: [10, -28, 0], t }); globe.drawArcs(ctx, arcs, { rot: [10, -28, 0] }); },
  spikes_lo: t => spk(spikes, t),
  spikes_hi: t => spk(spikesHi, t),
  spikes_a: spkc({ orbit: 1.3, dist: 1100, height: 200, target: [1000, 60, 330], fov: 40 }),
  spikes_b: spkc({ orbit: 1.15, dist: 1300, height: 320, target: [950, 40, 360], fov: 36, fogDist: 1100 }),
  spikes_c: spkc({ orbit: 1.45, dist: 900, height: 130, target: [1050, 110, 320], fov: 44 }),
  thermal: t => th.apply(ctx, { t }),
  thermal_us540: t => { const c = th.cam(camG); th.ctx.fillStyle = '#050607'; th.ctx.fillRect(0, 0, 540, 960); us.draw(th.ctx, { cam: c, t, style: 'steel', grid: 0 }); th.ctx.getImageData(0, 0, 1, 1); },
  thermal_grid540: t => { grid.draw(th.ctx, { cam: th.cam(camG), reveal: 1e9, t, width: 0.8, glowW: 3.5, heads: false, pulses: 40 }); th.ctx.getImageData(0, 0, 1, 1); },
  thermal_apply540: t => th.apply(ctx, { t, source: th.ctx.canvas }),
  hud_viewfinder: t => viewfinder(ctx, t, {}),
  hud_odometer: t => odometer(ctx, 1234567.4 + t * 1000, 60, 400, { size: 170 }),
  hud_splitflap6x16: t => { for (let i = 0; i < 6; i++) splitflap(ctx, 'RAMSTEIN    HOME', 0.2 + t % 1, W / 2, 440 + i * 96, { size: 58 }); },
  hud_terminal: t => terminal(ctx, Array.from({ length: 30 }, (_, i) => `> line ${i} ................ ok`), 20, { rows: 6 }),
  hud_reticle5: t => { for (let i = 0; i < 5; i++) reticle(ctx, 200 + i * 150, 900, { lock: 0.5, age: t, label: 'CHICAGO' }); },
  hud_ticker: t => ticker(ctx, [['CHICAGO', '2,720,546', 1.2], ['HOUSTON', '2,099,451', 2.1], ['DETROIT', '713,777', -0.4]], t),
  hud_callout_readout: t => { callout(ctx, 300, 900, 450, 780, 'HOUSTON', 2, { sub: 'POP 2,296,224', src: grid }); readout(ctx, 500, 1400, 'GRID', [['NODES', 0.5, '4,463'], ['EDGES', 0.3, '5,852']], 2, { src: grid }); },
  piece_empire: t => P.empire(ctx, 6 * PB.spb + t * 0.01),
  piece_meltdown: t => P.meltdown(ctx, 7 * PB.spb + t * 0.01),
  piece_frontier: t => P.frontier(ctx, 10.5 * PB.spb + t * 0.01),
  post_full: t => post.apply(ctx.canvas, t, { bloom: { amount: 1, threshold: 0.62, radius: 1.1 }, halation: { amount: 0.35 }, lens: { ca: 0.002 }, film: { contrast: 0.12 }, vignette: { amount: 0.4 }, grain: { amount: 0.35 } }, { ctx }),
  post_lite: t => post.apply(ctx.canvas, t, { film: { contrast: 0.12 }, vignette: { amount: 0.4 }, grain: { amount: 0.3 } }, { ctx }),
};
window.tests = Object.keys(TESTS);
window.bench = name => {
  const out = [];
  for (let i = 0; i < 5; i++) { bg(); ctx.getImageData(0, 0, 1, 1); hudBegin(); const a = performance.now(); TESTS[name](i * 0.37); ctx.getImageData(0, 0, 1, 1); out.push(performance.now() - a); }
  out.sort((a, b) => a - b); return out[2];
};
window.view = name => { bg(); hudBegin(); TESTS[name](1.3); ctx.getImageData(0, 0, 1, 1); return true; };
const px = () => { const d = ctx.getImageData(0, 0, W, H).data, o = new Uint8Array(d.length / 4 * 3); for (let i = 0, j = 0; i < d.length; i += 4) { o[j++] = d[i]; o[j++] = d[i + 1]; o[j++] = d[i + 2]; } return o; };
// effect-level determinism: render a, then b, then a again, and diff the two a's (full-frame readback; see maps_bench --det)
window.det = (a, b) => { bg(); TESTS[a](1.3); const A = px(); bg(); TESTS[b](1.3); bg(); TESTS[a](1.3); const X = px(); let n = 0, mx = 0;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1; const hist = {};
  for (let i = 0; i < A.length; i++) { const d = Math.abs(A[i] - X[i]); if (d) { n++; mx = Math.max(mx, d); const p = (i / 3) | 0, x = p % W, y = (p / W) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); hist[d] = (hist[d] || 0) + 1; } }
  return `${a} (after ${b}): ${n} px values differ, max ${mx} bbox ${x0},${y0}-${x1},${y1} hist ${JSON.stringify(hist)}`; };
window.sceneReady = true;
