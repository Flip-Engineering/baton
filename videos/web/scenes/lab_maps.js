// LAB / MAPS v4: lib/fx/geo + lib/fx/hud cut to the productive() track (140 BPM). Impacts: 8 24 40 44 60 64.
// Every segment is a different look (the 'NOT one uniform style' note), each through the same modules:
//   BOOT    night-lights shader globe (terminator, atmosphere, clouds), typed log, TOWNS slot counter settles on beat 5
//   IGNITE  ember relief map (GPU heightfield, raking light) igniting outward from Detroit; COUNTIES LIT lands at 17
//   RAIL    night-lights map, Class I lines lighting from Chicago; TRACK LIT lands on the impact at 24
//   GRID    engraved plate (print.js) with the procedural grid in red ink -> the LWIR thermal pass (GL, no readback)
//   SPIKES  population skyline at dusk: hero New York, fog into the sky, tilt-shift DOF; ripple lands at impact 40
//   GLOBE   photographic ACP globe: bases ping (sample), a reticle per beat, arcs home
//   BOARD   poster globe behind a split-flap board that settles on the gong (60); OWN THE FUTURE settles by 61.25
// HUD rules: type >= 34 px, one hero number + at most one secondary line per shot, counters settle on the hit.
import * as THREE from 'three';
import { W, H, C, loadFonts, loadBeats, clamp, lerp, ease, closer, outCanvas } from '../lib/kit.js';
import { Post } from '../lib/fx/post.js';
import { Print } from '../lib/fx/print.js';
import { MapKit, SpikeMap, Thermal, odometer, caption, splitflap, terminal, reticle, callout, viewfinder, scanlines, fmt, hash,
  hudBegin, hudState } from '../lib/fx/maps.js';

const ctx = outCanvas();
await loadFonts();
const B = await loadBeats('lab_maps'), spb = B.spb;
const T0 = performance.now();
const M = await MapKit.load(B, { THREE, globe: { cx: W / 2, cy: 1000, r: 470 } });
const { us, rail, grid, globe } = M;
us._bake(); us.plate({ Print }); globe._bake();
const spikes = new SpikeMap(M.geo, THREE, { lod: 'lo', fog: '#8a1a1c' });
const thermal = new Thermal(360, 640);
const post = new Post(W, H, { glowScale: 0.125 });           // eighth-res glow chain: the bloom is soft anyway
const PERF = { n: 0, ms: 0, seg: {} };
console.log(`setup ${(performance.now() - T0).toFixed(0)}ms  counties ${us.c.length}  rail ${rail.n.length}  grid ${grid.n.length}/${grid.e.length}  spikes ${spikes.n}  bake us ${us.bakeMs.toFixed(0)} globe ${globe.bakeMs.toFixed(0)}`);

const SEG = [[0, 'BOOT'], [8, 'IGNITE'], [18, 'RAIL'], [26, 'GRID'], [29, 'THERMAL'], [34, 'SPIKES'], [44, 'GLOBE'], [58, 'BOARD'], [64, 'CLOSER']];
const segAt = b => { let s = SEG[0]; for (const x of SEG) if (b >= x[0]) s = x; return s; };

// ------------------------------------------------------------------ shots (declarative: lib/fx/geo/shot.js)
const ignite = M.shot({
  layer: 'us', style: 'ember', beats: [8, 18], bg: '#070102', sy: 1000, map: { res: 0.7 },
  cam: [[8.5, { at: 'Detroit', zoom: 3.4 }], [17, { x: 560, y: 390, zoom: 1.02 }]],
  ignite: { origin: 'Detroit', beats: [8, 17], r: [0, 820], width: 46 },
  hud: [{ hero: 'lit', caption: 'COUNTIES LIT', settle: 17, suffix: `/ ${fmt(us.c.length)}`, y: 420 },
    { callout: 'Chicago', at: 10.2, until: 12.8 }, { callout: 'New York City', text: 'NEW YORK', at: 13, until: 15.6 }, { callout: 'Houston', at: 15.6 }],
});
const railShot = M.shot({
  layer: 'us', style: 'night', beats: [18, 26], bg: '#030305', sy: 1000, map: { grid: 0, res: 0.7 },
  cam: [[18, { at: 'Chicago', zoom: 2.6 }], [25, { x: 590, y: 390, zoom: 1.5 }]],
  network: { net: 'rail', beats: [18, 24], draw: { pulses: 2, pulseSpeed: 90, width: 3, glowW: 16, nodes: 3 } },
  hud: [{ hero: 'km', caption: 'TRACK LIT', settle: 24, suffix: 'KM', y: 420, src: rail }, { callout: 'Chicago', text: 'ROOT: CHICAGO', sub: null, at: 18.6, src: rail }],
});
const gridShot = M.shot({
  layer: 'us', style: 'engraving', beats: [26, 29], bg: '#efe2c6', sy: 1010, map: { grid: 0, res: 0.7 },
  cam: [[26, { x: 690, y: 300, zoom: 2.4 }], [29, { x: 670, y: 315, zoom: 2.7 }]],
  network: { net: 'grid', beats: [26, 28], draw: { width: 4, glowW: 3.5, color: '#C91F37', glow: '#16130f', heads: true, pulses: 0, blend: 'source-over' } },
  hud: [{ hero: grid.n.length, from: 0, start: 26, settle: 28, caption: 'GRID NODES', src: grid, y: 420, color: '#16130f', captionColor: '#9c1420', shade: false },
    { callout: 'Chicago', text: 'CHICAGO HUB', sub: null, at: 26.3, src: grid }],
});
const globeShot = M.shot({
  layer: 'globe', style: 'photo', beats: [44, 58], bg: '#050102', map: { res: 0.66 },
  cam: [[44, { lon: 12, lat: -30, scale: 0.92 }], [50, { lon: -8, lat: -32, scale: 1.14 }], [52, { lon: -10, lat: -34, scale: 1.16 }], [57.5, { lon: 170, lat: -50, scale: 1.16 }]],
  bases: { beats: [44], stagger: 4 * spb / 50 },
  arcs: { beats: [48, 58] },
  hud: [{ hero: globe.bases.length, from: 0, start: 44, settle: 48, caption: 'US BASES ABROAD', src: globe.bases, y: 380, digits: 2, commas: false }],
  draw: (ctx, S) => {                                               // one base locked per beat (the one secondary)
    const vis = (S.shown || []).filter(s => s.z > 0.45 && s.y > 520 && s.y < 1600); if (!vis.length || S.beat < 45) return;
    const k = Math.floor(S.beat), s = vis[(k * 7) % vis.length], la = (S.beat % 1) * spb;
    reticle(ctx, s.x, s.y, { r: 40, lock: clamp(la / 0.2), age: la, label: s.name.toUpperCase(), from: 3 });
  },
});

// ------------------------------------------------------------------ frame
const BOOT = ['ACP//MAPS  2026.09', { s: `COUNTIES  ${fmt(us.c.length)}`, c: 'dim' }, { s: `TOWNS ≥5K ${fmt(M.geo.us.cities.length)}`, c: 'dim' }, { s: `BASES     ${globe.bases.length}`, c: 'hot' }];
const THERM = ['Chicago', 'Detroit', 'Cleveland', 'Pittsburgh', 'Milwaukee'];
const NYC = [-74.0, 40.71], CHI = [-87.63, 41.88];

// per-stage profile (?prof in the URL): a GPU sync after each stage, printed on the perf line
const PROF = location.search.includes('prof'); const NOPOST = location.search.includes('nopost'), NOREAD = location.search.includes('noread'); let marks = [], tm = 0;
const mark = n => { if (!PROF) return; ctx.getImageData(0, 0, 1, 1); const now = performance.now(); marks.push(`${n}=${(now - tm).toFixed(0)}`); tm = now; };
M.mark = mark;
async function frame(t) {
  const beat = B.beat(t);
  const kick = Math.max(B.env('kick', t, 10), 0.8 * B.env('taiko', t, 9));
  const t0 = performance.now();
  hudBegin(); marks = []; tm = t0;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  const [s0, seg] = segAt(beat), age = (beat - s0) * spb;
  let postMode = 'full', bloom = 0.8;

  if (beat < 8) {                                             // ---------------- BOOT: night-lights globe
    ctx.fillStyle = '#030104'; ctx.fillRect(0, 0, W, H);
    const rot = [lerp(40, 88, beat / 8), -28, 0];
    globe.draw(ctx, { rot, t, style: 'night', scale: lerp(0.96, 1.04, ease.inOutCubic(beat / 8)), atmo: 1 + kick * 0.3 });
    terminal(ctx, BOOT, age, { x: 60, y: 1580, size: 40, rows: 4, settle: 4 * spb, cursor: true });
    caption(ctx, 'TOWNS ≥ 5K, GEONAMES', 60, 190);
    odometer(ctx, null, 60, 380, { size: 170, mode: 'slot', to: M.geo.us.cities.length, start: 1 * spb, settle: 5 * spb, now: t, label: 'TOWNS' });
    bloom = 1.0;
  } else if (beat < 18) {                                     // ---------------- IGNITE: ember relief
    ignite(ctx, t);
  } else if (beat < 26) {                                     // ---------------- RAIL: night lights
    railShot(ctx, t);
    bloom = 1.1;
  } else if (beat < 29) {                                     // ---------------- GRID: engraved plate
    gridShot(ctx, t);
    postMode = 'print';
  } else if (beat < 34) {                                     // ---------------- THERMAL (GL remap of the canvas)
    const u = clamp((beat - 29) / 5), cam = { x: lerp(680, 640, u), y: lerp(310, 330, u), zoom: lerp(2.7, 3.1, ease.inOutCubic(u)), sx: W / 2, sy: 980 };
    // the sensor sees a quarter-area render (thermal.ctx), so the GL remap uploads 540x960, not the full frame
    const tc = thermal.ctx, tcam = thermal.cam(cam);
    tc.fillStyle = '#050607'; tc.fillRect(0, 0, tc.canvas.width, tc.canvas.height);
    us.draw(tc, { cam: tcam, t, style: 'steel', grid: 0, borders: 0.6, towns: 0.8 }); tc.getImageData(0, 0, 1, 1); mark('us');
    grid.draw(tc, { cam: tcam, reveal: 1e9, t, width: 0.6, glowW: 2.4, color: '#ffe6c8', heads: false, pulses: 40, pulseSpeed: 120 }); tc.getImageData(0, 0, 1, 1); mark('grid');
    thermal.apply(ctx, { palette: 'ironbow', t, gain: 1.5 + kick * 0.5, level: 0.3, source: tc.canvas }); mark('thermal');
    const k = clamp(Math.floor(beat - 29), 0, THERM.length - 1), c = M.city(THERM[k]);
    const [sx, sy] = us.toScreen([c.x, c.y], cam), la = (beat - 29 - k) * spb;
    reticle(ctx, sx, sy, { r: 62, lock: clamp(la / 0.3), age: la, label: THERM[k].toUpperCase() });
    viewfinder(ctx, t, { rect: [40, 470, W - 80, H - 700], text: false });
    // hero: spot temperature, rolls between targets on the off-beat and lands before each beat
    const temp = i => Math.round(40 + hash(i + 11, 5) * 380);
    caption(ctx, 'SPOT °C', 60, 200, { color: C.cream });
    odometer(ctx, null, 60, 390, { size: 170, from: temp(k - 1), to: temp(k), start: (29 + k + 0.35) * spb, settle: (29 + k + 0.8) * spb, now: t, label: 'SPOT' });
    scanlines(ctx, t, { alpha: 0.1 });
  } else if (beat < 44) {                                     // ---------------- SPIKES: dusk skyline, hero New York
    const u = clamp((beat - 34) / 10), e = ease.inOutCubic(u), rip = ease.inOutCubic(clamp((beat - 34) / 6));
    const hz = 0.44;
    spikes.sky(ctx, { horizon: hz, sun: [0.28, 0.37], sunR: 80 });
    const src = spikes.render({ t, grow: 1 + kick * 0.04, ripple: { origin: CHI, r: rip * 1700 }, hero: { ll: NYC, pop: 8.1e6, radius: 12 }, fogColor: '#b8442f',
      orbit: lerp(1.1, 1.3, e), dist: lerp(1450, 1300, e), height: lerp(230, 200, e), target: [1060, 150, 330], fov: 38, fogDist: 1700, beam: clamp((beat - 36) / 2), sunScreen: [0.28, 0.37] });
    mark('render'); spikes.composite(ctx, src, { dof: 1, focus: 0.6, band: 0.14, horizon: hz }); mark('composite');
    const o = spikes.proj(CHI); let pop = 0;
    for (const c of spikes.towns) if (Math.hypot(c.p[0] - o[0], c.p[1] - o[1]) < rip * 1700) pop += c.pop;
    caption(ctx, 'PEOPLE IN TOWNS ≥ 20K', 60, 200, { color: C.cream });
    odometer(ctx, beat >= 40 ? Math.round(pop) : pop, 60, 380, { size: 150, label: 'PEOPLE' });
    const s = spikes.screen(NYC, spikes.heightOf(8.1e6), W, H);
    if (s && beat > 35.5) callout(ctx, s[0], s[1] + 60, s[0] - 140, s[1] + 180, 'NEW YORK', (beat - 35.5) * spb, { sub: 'POP 8,175,133' });
    bloom = 1.1;
  } else if (beat < 58) {                                     // ---------------- GLOBE: photographic, bases, arcs home
    globeShot(ctx, t);
    bloom = 1;
  } else if (beat < 64) {                                     // ---------------- BOARD over a poster globe
    ctx.fillStyle = '#0B0B0B'; ctx.fillRect(0, 0, W, H);
    globe.draw(ctx, { rot: [lerp(170, 140, (beat - 58) / 6), -40, 0], t, style: 'poster', scale: 1.25, grid: 0.5 });
    ctx.fillStyle = 'rgba(11,11,11,0.62)'; ctx.fillRect(0, 0, W, H);
    const rows = ['RAMSTEIN   HOME', 'KADENA     HOME', 'AL UDEID   HOME', 'DIEGO GARC HOME'];
    if (beat < 60.75) rows.forEach((r, i) => splitflap(ctx, r, (beat - 58) * spb - i * 0.05, W / 2, 470 + i * 118, { size: 72, seed: i + 3, settle: 2 * spb - i * 0.05, accent: [11, 12, 13, 14], label: 'DEPARTURES' }));
    caption(ctx, 'ABROAD', W / 2, 1560, { align: 'center' });
    odometer(ctx, null, W / 2, 1760, { size: 150, digits: 2, commas: false, align: 'center', from: 50, to: 0, start: 58 * spb, settle: 60 * spb, now: t, label: 'ABROAD' });
    if (beat >= 60.75) {                                         // the board flips over to the slogan, settled by 61.35
      splitflap(ctx, 'OWN THE', (beat - 60.75) * spb, W / 2, 560, { size: 150, seed: 11, settle: 0.6 * spb, from: 'RAMSTEI' });
      splitflap(ctx, 'FUTURE', (beat - 60.8) * spb, W / 2, 780, { size: 150, seed: 12, settle: 0.55 * spb, color: C.red2, from: 'AL UDE' });
    }
    postMode = 'lite';
  } else {
    closer(ctx, (beat - 64) * spb);
    postMode = 'off';
  }
  // honest per-stage timing: SwiftShader defers 2D + GL work until a flush, so sync before Post
  if (!NOREAD) ctx.getImageData(0, 0, 1, 1);
  const tDraw = performance.now();
  if (NOPOST) postMode = 'off';
  if (postMode === 'full') post.apply(ctx.canvas, t, { bloom: { amount: bloom + kick * 0.8, threshold: 0.62, radius: 1.1 }, 
    lens: { ca: 0.0006 + 0.002 * kick }, film: { contrast: 0.12, sat: 1.05 }, vignette: { amount: 0.4 }, grain: { amount: 0.35, size: 1.3 } }, { ctx });
  else if (postMode === 'lite' || postMode === 'print') {       // HUD / print frames: no GL post, a 2D vignette only
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${postMode === 'print' ? 0.3 : 0.55})`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  if (!NOREAD) ctx.getImageData(0, 0, 1, 1);
  const tEnd = performance.now(), ms = tEnd - t0;
  PERF.n++; PERF.ms += ms; (PERF.seg[seg] = PERF.seg[seg] || []).push(Math.round(ms));
  const hs = hudState();
  window._hud = { beat, items: hs };
  console.log(`perf t=${t.toFixed(2)} beat=${beat.toFixed(1)} seg=${seg} total=${ms.toFixed(0)}ms draw=${(tDraw - t0).toFixed(0)}ms post(${postMode})=${(tEnd - tDraw).toFixed(0)}ms${marks.length ? ' [' + marks.join(' ') + ']' : ''}`);
  console.log(`hud beat=${beat.toFixed(2)} ` + JSON.stringify(hs.filter(h => h.kind !== 'caption').map(h => [h.kind, h.role, h.moving ? 1 : 0, h.text])));
}
// warm-up: compile every shader and fill every cache once during setup (logs muted), so frame 1 is not 15 s
{ const log = console.log; console.log = () => {}; for (const b of [3, 11, 21, 27.5, 30.5, 36, 50, 62]) await frame(b * spb); console.log = log;
  PERF.n = 0; PERF.ms = 0; PERF.seg = {}; console.log(`warm-up done ${(performance.now() - T0).toFixed(0)}ms after start`); }
window.renderFrame = frame;
window.hudState = () => window._hud;
window.PERF = PERF;
window.sceneReady = true;
