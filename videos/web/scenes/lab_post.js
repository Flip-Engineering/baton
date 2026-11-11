// LAB: POST. The post chain (lib/fx/post.js) as a piece, not a contact sheet: two real ACP pieces play
// full-bleed and the physical medium changes on the beat, through every transition primitive.
// Real scenes are hosted off-screen: their module is imported while getElementById('out') points at a
// private canvas, so productive.js / meltdown7.js draw exactly as they do in their own renders. Their slogans
// are lifted into a type layer (kit.js typeLayer) and composited after the destructive stages, so every word
// stays crisp under mosh, CRT tear, riso and bloom. Post owns #out (direct output, no blit).
//
//   b0-8    MELTDOWN search: MYTHIC, knife wipe -> BROADCAST (red phosphor)
//   b8-16   gold field / profit ticker: GOLD, beat-bar wipe -> RISO
//   b16-24  ruling ideas / the machine: NEWSREEL, film burn -> AEROCHROME (ACP false colour)
//   b24-32  PRODUCTIVE heat: ONEBIT, preset morph (mixPresets) -> MOSH (applyStateful, per-beat I-frames)
//   b32-40  AT FULL HEAT: REDKEEP, iris -> CMYK
//   b40-48  the hand: ENGRAVING, region mask (the source's own light) -> MYTHIC burns through the print
//   b48-56  FEWER HOURS / RUN HOT: a new medium every beat, bar wipes
//   b56-64  THE WORKING CLASS: REDCREAM, knife -> MYTHIC
import { W, H, C, loadFonts, loadBeats, clamp, ease, smooth, sigil, typeLayer } from '../lib/kit.js';
import { Post, preset, mixPresets } from '../lib/fx/post.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });

await loadFonts();
const B = await loadBeats('lab_post');

async function host(name) {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const orig = document.getElementById;
  document.getElementById = function (id) { return id === 'out' ? cv : orig.call(document, id); };
  try { await import(`./${name}.js`); } finally { document.getElementById = orig; }
  const render = window.renderFrame; window.renderFrame = null;
  return { canvas: cv, render, name };
}
const SRC = { productive: await host('productive'), meltdown7: await host('meltdown7') };
window.renderFrame = null;

const post = new Post(W, H, { direct: true });                        // post.canvas is now #out
window.__post = post; window.__src = SRC;                               // test hooks (scratch determinism / micro benches)
const typeCv = document.createElement('canvas'); typeCv.width = W; typeCv.height = H;
const tg = typeCv.getContext('2d');

// ---------------------------------------------------------------- the score
const SHOTS = [                                                        // [beat, hosted piece, its time at that beat]
  [0, 'meltdown7', 1.6], [8, 'meltdown7', 5.2], [16, 'meltdown7', 11.0], [24, 'productive', 16.9],
  [32, 'productive', 20.0], [40, 'meltdown7', 22.6], [48, 'productive', 13.7], [56, 'meltdown7', 25.4]];
const LOOKS = [                                                        // [beat, look, transition, beats, wipe opts]
  [0, 'mythic'],
  [4, 'broadcast', 'knife', 0.75, { angle: 1.25 }],
  [8, 'gold'],
  [12, 'riso', 'bars', 1, { bars: 9, angle: 0 }],
  [16, 'newsreel'],
  [20, 'aerochrome', 'burn', 1.25, { seed: 4 }],
  [24, 'onebit'],
  [28, 'mosh', 'morph', 1.5],
  [32, 'redkeep'],
  [36, 'cmyk', 'iris', 1, { center: [0.5, 0.45] }],
  [40, 'engraving'],
  [44, 'mythic', 'region', 2.5],
  [48, 'cycle'],
  [56, 'redcream'],
  [60, 'mythic', 'knife', 0.75, { angle: -1.25 }],
];
// PRODUCTIVE's b48 source is its rainbow thermal palette: every look here remaps colour (no mythic, which keeps it)
const CYCLE = ['redcream', 'riso', 'newsreel', 'onebit', 'broadcast', 'gold', 'engraving', 'redkeep'];

const kickAt = t => Math.max(B.env('kick', t, 9), 0.9 * B.env('impact', t, 5), 0.7 * B.env('taiko', t, 9));
const at = (list, beat) => { let i = 0; while (i < list.length - 1 && beat >= list[i + 1][0]) i++; return i; };
function sourceAt(beat) { const [b, name, t0] = SHOTS[at(SHOTS, beat)]; return [name, t0 + (beat - b) * B.spb]; }

// the medium at a beat: { a, b, mode, u, w, stateful } (no b / mode = one look)
function planAt(beat) {
  const i = at(LOOKS, beat), [b0, look, mode, dur, w = {}] = LOOKS[i];
  if (look === 'cycle') {
    const k = Math.floor(beat - b0), u = clamp((beat - b0 - k) / 0.5);
    if (k === 0 || u >= 1) return { a: CYCLE[k % CYCLE.length] };
    return { a: CYCLE[(k - 1) % CYCLE.length], b: CYCLE[k % CYCLE.length], mode: 'bars', u: ease.inOutCubic(u),
      w: { bars: 5 + (k % 3) * 2, angle: k % 2 ? 0.35 : -0.35, seed: k } };
  }
  if (!mode || beat >= b0 + dur) return { a: look, stateful: look === 'mosh' };
  const prev = LOOKS[i - 1][1];
  const u = mode === 'region' ? 0.72 * ease.outCubic(clamp((beat - b0) / dur)) : ease.inOutCubic(clamp((beat - b0) / dur));
  return { a: prev, b: look, mode, u, w, stateful: look === 'mosh' };
}
function optsAt(beat, kick) {
  const p = planAt(beat), k = { kick };
  return p.mode === 'morph' ? mixPresets(preset(p.a, k), preset(p.b, k), p.u) : preset(p.a, k);
}

// ---------------------------------------------------------------- source + type layer
window.labStats = { source: 0, n: 0, post: 0 };
let warm = false;
async function frameAt(name, st) {
  const S = SRC[name], t0 = performance.now();
  if (!warm) {
    tg.setTransform(1, 0, 0, 1, 0, 0); tg.globalAlpha = 1; tg.globalCompositeOperation = 'source-over'; tg.clearRect(0, 0, W, H);
    typeLayer(tg, 150);
    try { await S.render(Math.max(0, st)); } finally { typeLayer(null); }
    // MELTDOWN forms the ☭≡/acc lockup out of particles from its b68 (150 bpm): the world version blooms under
    // MYTHIC, so the brand also goes in the type layer, crisp, at the same place and on the same fade
    if (name === 'meltdown7' && st / 0.4 >= 68) sigil(tg, 540, 860, 230, { color: C.cream, accent: C.red2, alpha: smooth(68.2, 68.8, st / 0.4) });
    if (window.labProfile) S.canvas.getContext('2d').getImageData(0, 0, 1, 1);
  }
  window.labStats.source += performance.now() - t0; window.labStats.n++;
  return { world: S.canvas, type: typeCv };
}

window.renderFrame = async (t) => {
  const beat = B.beat(t), kick = kickAt(t), p = planAt(beat);
  const t0 = performance.now(), s0 = window.labStats.source;
  if (p.stateful) {                          // datamosh: pure in t through per-beat I-frames + bounded pre-roll
    await post.applyStateful(tt => frameAt(...sourceAt(B.beat(tt))), t, tt => optsAt(B.beat(tt), kickAt(tt)),
      { anchor: tt => Math.floor(B.beat(tt)) * B.spb, slot: 'mosh', maxPreroll: 13 });
  } else {
    const src = await frameAt(...sourceAt(beat)), k = { kick };
    if (!p.mode) post.apply(src, t, preset(p.a, k));
    else if (p.mode === 'region')            // per-region looks: the source's own light is the mask
      post.transition(src, t, preset(p.a, k), preset(p.b, k), { mode: 'mask', mask: src.world, maskLuma: 1, u: p.u, soft: 0.06 });
    else post.transition(src, t, preset(p.a, k), preset(p.b, k), { mode: p.mode, u: p.u, ...p.w });
  }
  post.sync();                               // settle all GPU work inside renderFrame
  window.labStats.post += performance.now() - t0 - (window.labStats.source - s0);
};

// warm every program variant once (sources frozen) so timed frames do not pay for shader compiles. Only the
// benches call it: under load it takes minutes, past render.mjs's sceneReady timeout, and renders do not need it.
window.warmup = async () => {
  await frameAt('productive', 18); await frameAt('meltdown7', 23);
  warm = true;
  for (const b of [1, 4.4, 6, 9, 12.5, 14, 17, 20.6, 22, 25, 28.7, 30, 33, 36.5, 38, 41, 45.5, 49.25, 50.25, 51.25, 52.25, 53.25, 54.25, 55.25, 57, 60.4])
    await window.renderFrame(b * B.spb);
  warm = false;
  post.state.clear(); post.hist.clear(); post._warned = false;
  window.labStats = { source: 0, n: 0, post: 0 };
};

// ---------------------------------------------------------------- measurement (pbench.mjs): window.bench(n) -> ms
window.bench = async (n = 7, only = null) => {
  await window.warmup();
  const src = await frameAt('productive', 14.3); warm = true;
  const med = a => { a.sort((x, y) => x - y); return [+a[a.length >> 1].toFixed(0), +a[0].toFixed(0)]; };
  const run = fn => { fn(0); post.sync(); const ts = []; for (let i = 0; i < n; i++) { const a = performance.now(); fn(i + 1); post.sync(); ts.push(performance.now() - a); } return med(ts); };
  const want = k => !only || only.includes(k);
  const out = {};
  out.calib_copy_pass = run(() => post._run('copy', post.stageT, { S: post.src }));
  const cases = { none: {}, bloom: { bloom: { amount: 1 } }, bloom_half: { bloom: { amount: 1 }, glowScale: 0.5 }, bloom_eighth: { bloom: { amount: 1 }, glowScale: 0.125 },
    halation: { halation: { amount: 0.5 } }, streaks: { streaks: { amount: 1 } }, lens_ca: { lens: { distort: 0.05, ca: 0.01 } },
    grade: { film: { contrast: 0.3, split: { shadows: [0.3, 0.4, 0.5], highlights: [0.7, 0.5, 0.4] } }, lut: { name: 'redcream' } },
    vignette: { vignette: { amount: 0.5 } }, grain: { grain: { amount: 0.5 } }, dust: { dust: { amount: 1, scratch: 0.5 } },
    bayer: { dither: { mode: 'bayer' } }, riso: { dither: { mode: 'riso' } }, cmyk: { dither: { mode: 'cmyk' } }, lines: { dither: { mode: 'lines' } },
    crt: { crt: { amount: 1 } }, glitch: { glitch: { amount: 0.3, tear: 0.2 } }, sort20: { sort: { passes: 20 } } };
  for (const [k, o] of Object.entries(cases)) if (want(k)) out[k] = run(i => post.apply(src.world, i / 30, o));
  if (want('type')) out.type_layer = run(i => post.apply(src, i / 30, {}));
  for (const p of ['mythic', 'newsreel', 'riso', 'broadcast', 'mosh', 'onebit', 'aerochrome', 'redkeep', 'gold', 'engraving', 'cmyk', 'redcream'])
    if (want(p)) out['preset_' + p] = run(i => post.apply(src, i / 30, { ...preset(p, { kick: 0.5 }), slot: 'bench' }));
  for (const p of ['mythic', 'gold', 'broadcast', 'mosh', 'riso'])                      // compScale 0.5
    if (want(p + '_cs')) out['preset_' + p + '_cs50'] = run(i => post.apply(src, i / 30, { ...preset(p, { kick: 0.5 }), slot: 'bench', compScale: 0.5 }));
  if (want('notype')) out.preset_mythic_notype = run(i => post.apply(src.world, i / 30, preset('mythic', { kick: 0.5 })));
  if (want('transition')) {
    out.transition_knife_mythic_riso = run(i => post.transition(src, i / 30, preset('mythic'), preset('riso'), { mode: 'knife', u: 0.5 }));
    out.morph_mythic_gold_rebake = run(i => post.apply(src, i / 30, mixPresets(preset('mythic'), preset('gold'), 0.2 + i * 0.07)));
    out.blit_to_2d_avoided = run(() => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.drawImage(post.canvas, 0, 0); g.getImageData(0, 0, 1, 1); });
  }
  post.profile = true;
  for (const p of ['mythic', 'broadcast', 'mosh']) {
    if (!want(p) && !want(p + '_stages')) continue;
    post.stats = {};
    for (let i = 0; i < n; i++) { post.apply(src, i / 30, { ...preset(p, { kick: 0.5 }), slot: 'bench' }); post.sync(); }
    out[p + '_stages'] = Object.fromEntries(Object.entries(post.stats).map(([k, v]) => [k, +(v / n).toFixed(1)]));
  }
  post.profile = false; warm = false;
  post.state.clear(); post.hist.clear();
  return out;
};
window.rawSource = async (name, t) => { warm = false; const c = (await frameAt(name, t)).world; const s = document.createElement('canvas'); s.width = 270; s.height = 480; s.getContext('2d').drawImage(c, 0, 0, 270, 480); return s.toDataURL('image/jpeg', 0.85); };
ready = true;
