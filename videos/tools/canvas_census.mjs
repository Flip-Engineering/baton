// canvas_census.mjs (TOOLING c4, 2026-09-28): count the canvases and GL contexts a scene makes, at load and per
// rendered frame, BEFORE a full render finds out the hard way. Stills never show it: a scene that makes a canvas
// per glyph / sprite / tile renders fine for 10 stills and then, 1000 frames into a full render, Chromium drops
// backing stores and tiles come out black (MELTDOWN v11: a black frame 0, "THANK YO" missing).
//
//   node tools/canvas_census.mjs <scene> [--at 0,12,30] [--frames 20] [--query '?x=1'] [--json] [--max-live 1500]
//   node tools/canvas_census.mjs meltdown8 --at 0,20,40
//   node tools/canvas_census.mjs lab_glyphs --query '?mode=naive'      # the anti-pattern, for comparison
//
// It hooks document.createElement('canvas'), new OffscreenCanvas and getContext before any scene code runs, loads the
// scene, then renders --frames consecutive frames (30 fps) from each --at time (default: 4 windows spread over the
// song), as render.mjs would. Per window it reports canvases and GL contexts made, and megapixels allocated; at
// the end the canvases still alive after a forced GC, their megapixels, 2D contexts lost, and the projection over
// the whole piece (render-time creation rate x frames).
//
// Verdict (exit 1 on FAIL):
//   FAIL  a 2D or GL context was lost; more than 12 WebGL contexts (Chromium's cap is 16: the oldest is killed);
//         live canvases over --max-live (1500) or projected canvases over the full render over 3 x --max-live
//   WARN  more than 8 WebGL contexts; the scene keeps making canvases while it renders (> 0.5 per frame on average: a per-frame cache that never
//         stops growing), live megapixels over 1500 (6 GB of RGBA), projected over --max-live
//   PASS  otherwise
// Fix: draw glyphs / sprites / cells from lib/fx/glyph_atlas.js sheets; reuse scratch canvases; one WebGLRenderer.
import fs from 'node:fs'; import path from 'node:path';
import { openScene, ROOT } from './_page.mjs';

const A = process.argv.slice(2), scene = A[0];
const opt = (k, d) => { const i = A.indexOf('--' + k); return i >= 0 ? A[i + 1] : d; };
if (!scene || scene.startsWith('--')) { console.error('usage: node tools/canvas_census.mjs <scene> [--at 0,12,30] [--frames 20] [--query ?q] [--json]'); process.exit(2); }
const FRAMES = Number(opt('frames', 20)), MAXLIVE = Number(opt('max-live', 1500)), FPS = 30;

// ---------------------------------------------------------------- page hooks (run before the scene's modules)
const INIT = () => {
  const S = window.__census = { made: 0, off: 0, gl: 0, ctx2d: 0, lost: 0, glLost: 0, refs: [], big: [] };
  const track = (c, kind) => {
    S.made++; if (kind === 'off') S.off++;
    S.refs.push(new WeakRef(c));
    try { c.addEventListener('contextlost', () => S.lost++); c.addEventListener('webglcontextlost', () => S.glLost++); } catch (e) { /* offscreen */ }
    return c;
  };
  const ce = Document.prototype.createElement;
  Document.prototype.createElement = function (tag, o) { const el = ce.call(this, tag, o); if (String(tag).toLowerCase() === 'canvas') track(el, 'dom'); return el; };
  if (window.OffscreenCanvas) {
    const OC = window.OffscreenCanvas;
    window.OffscreenCanvas = class extends OC { constructor(w, h) { super(w, h); track(this, 'off'); } };
  }
  for (const P of [HTMLCanvasElement.prototype, window.OffscreenCanvas && Object.getPrototypeOf(window.OffscreenCanvas.prototype)].filter(Boolean)) {
    const gc = P.getContext;
    P.getContext = function (type, o) {
      const had = this.__censusCtx; const r = gc.call(this, type, o);
      if (r && !had) { this.__censusCtx = type; if (/webgl/.test(type)) S.gl++; else if (type === '2d') S.ctx2d++; }
      return r;
    };
  }
  S.snap = () => {
    let live = 0, px = 0, lost2d = 0; const sizes = new Map();
    for (const r of S.refs) { const c = r.deref(); if (!c) continue; live++; const a = c.width * c.height; px += a;
      const k = c.width + 'x' + c.height; sizes.set(k, (sizes.get(k) || 0) + 1);
      try { if (c.__censusCtx === '2d' && c.getContext('2d').isContextLost && c.getContext('2d').isContextLost()) lost2d++; } catch (e) { /* ignore */ } }
    const top = [...sizes].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => `${k} x${n}`);
    return { made: S.made, offscreen: S.off, gl: S.gl, ctx2d: S.ctx2d, lostEvents: S.lost + S.glLost, lost2d, live, mpx: +(px / 1e6).toFixed(1), top };
  };
};

const { page, hits, loadMs, close } = await openScene(scene, opt('query', ''), { init: INIT, args: ['--js-flags=--expose-gc'], noHits: true });
const dur = (hits && hits.duration) || Number(opt('dur', 30));
const at = opt('at') ? opt('at').split(',').map(Number) : [0, 0.3, 0.6, 0.85].map(u => +(u * dur).toFixed(2));
const snap = async (gc = false) => page.evaluate(g => { if (g && window.gc) { window.gc(); window.gc(); } return window.__census.snap(); }, gc);

const load = await snap(true);
const wins = [];
let prev = load; const t0 = Date.now();
for (const a of at) {
  for (let i = 0; i < FRAMES; i++) await page.evaluate(t => window.renderFrame(t), a + i / FPS);
  const s = await snap(false);
  wins.push({ at: a, frames: FRAMES, made: s.made - prev.made, gl: s.gl - prev.gl, perFrame: +((s.made - prev.made) / FRAMES).toFixed(2) });
  prev = s;
}
const end = await snap(true);
const extra = await page.evaluate(() => ({ atlas: window.__glyphAtlas ? window.__glyphAtlas() : null, lab: window.glyphLab ? window.glyphLab() : null }));
await close();

// steady rate: skip the first window's first-use warm-up when there are several
const steady = wins.length > 1 ? wins.slice(1) : wins;
const rate = steady.reduce((s, w) => s + w.made, 0) / Math.max(1, steady.reduce((s, w) => s + w.frames, 0));
const totalFrames = Math.round(dur * FPS), projected = Math.round(load.made + rate * totalFrames);
const items = [];
const add = (st, msg) => items.push({ status: st, msg });
if (end.lostEvents || end.lost2d) add('FAIL', `${end.lostEvents + end.lost2d} canvas context(s) LOST during the census: their pixels are gone (black tiles)`);
if (end.gl > 12) add('FAIL', `${end.gl} WebGL contexts made (Chromium keeps 16 and kills the oldest): share one renderer`);
else if (end.gl > 8) add('WARN', `${end.gl} WebGL contexts (Chromium keeps 16): near the cap once a lib adds its own; share renderers`);
if (end.live > MAXLIVE) add('FAIL', `${end.live} canvases alive after GC (${end.mpx} MP): over ${MAXLIVE}; draw from lib/fx/glyph_atlas.js sheets`);
if (projected > 3 * MAXLIVE) add('FAIL', `projected ${projected} canvases over a full ${totalFrames}-frame render (${rate.toFixed(2)} per frame after warm-up)`);
else if (projected > MAXLIVE) add('WARN', `projected ${projected} canvases over a full ${totalFrames}-frame render (${rate.toFixed(2)} per frame after warm-up)`);
if (rate > 0.5 && !items.some(i => i.msg.startsWith('projected'))) add('WARN', `the scene keeps making canvases while it renders: ${rate.toFixed(2)} per frame after warm-up`);
if (end.mpx > 1500) add('WARN', `${end.mpx} MP of canvas alive (${(end.mpx * 4 / 1000).toFixed(1)} GB RGBA)`);
if (!items.length) add('PASS', `${end.live} canvases alive (${end.mpx} MP), ${end.gl} GL contexts, ${rate.toFixed(2)} new per frame after warm-up; projected ${projected} over the full render`);
const verdict = items.some(i => i.status === 'FAIL') ? 'FAIL' : items.some(i => i.status === 'WARN') ? 'WARN' : 'PASS';
const rep = { scene, query: opt('query', ''), when: new Date().toISOString(), duration: dur, loadMs, load, windows: wins, end, rate: +rate.toFixed(3), projected, verdict, items, ...extra, censusMs: Date.now() - t0 };
fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'out', `.${scene}.canvas_census.json`), JSON.stringify(rep, null, 1));
if (A.includes('--json')) console.log(JSON.stringify(rep, null, 1));
else {
  console.log(`== CANVAS CENSUS ${scene}${rep.query} (${dur.toFixed(1)} s, loaded in ${(loadMs / 1000).toFixed(1)} s)`);
  console.log(`   at load: ${load.made} canvases (${load.offscreen} offscreen), ${load.gl} GL, ${load.live} alive after GC, ${load.mpx} MP`);
  for (const w of wins) console.log(`   ${w.frames} frames from ${w.at}s: +${w.made} canvases (${w.perFrame}/frame), +${w.gl} GL`);
  console.log(`   end: ${end.made} made, ${end.live} alive after GC, ${end.mpx} MP; most common sizes ${end.top.join(', ') || '-'}`);
  if (extra.atlas) console.log(`   glyph_atlas: ${JSON.stringify(extra.atlas)}`);
  if (extra.lab) console.log(`   lab: ${JSON.stringify(extra.lab)}`);
  for (const i of items) console.log(`  [${i.status}] ${i.msg}`);
  console.log(`  => ${verdict}  (out/.${scene}.canvas_census.json)`);
}
process.exitCode = verdict === 'FAIL' ? 1 : (process.exitCode || 0);
