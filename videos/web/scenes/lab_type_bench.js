// micro-benchmarks for lib/fx/type.js (not a video scene; run with scratchpad/micro.mjs)
import { W, H, C, loadFonts, Finish } from '../lib/kit.js';
import { Heat, FIELD, PAL } from '../lib/heat.js';
import { TYPE_OPTS, cpuOut, loadFace, shape, glyphs, look, springs, slam, drawOn, mask, rings, Shatter, Type3D, layer } from '../lib/fx/type.js';
const CPU = !location.search.includes('cpu=0'); TYPE_OPTS.cpuCanvas = CPU; if (CPU) cpuOut();
const out = document.getElementById('out'); const ctx = out.getContext('2d');
await loadFonts();
const [anton, cinzel, playfair, bebas] = await Promise.all(['anton', 'cinzel', 'playfair', 'bebas'].map(loadFace));
const heat = new Heat(0.5), heat35 = new Heat(0.35), heat25 = new Heat(0.25), fin = new Finish(3);
const w5 = shape(anton, 'STEEL', { size: 900, maxW: 960, y: 960, valign: 'center' });
const wc = shape(cinzel, 'FUTURE', { size: 300, maxW: 960, y: 1200, valign: 'center' });
const wb = shape(bebas, 'HOT', { size: 760, maxW: 1000, y: 1430, valign: 'center' });
const wp = shape(playfair, 'BANKS', { size: 330, maxW: 980, y: 1300, valign: 'center' });
const sh = new Shatter(wp, look.hatch(C.cream, '#2a0a0c', { edge: '#000' }), { n: 22 });
const T3 = await Type3D.create({ scale: 0.75 }); T3.word(w5, { depth: 180, bevel: 12 });
const T3b = await Type3D.create({ scale: 0.5 }); T3b.word(w5, { depth: 180, bevel: 12 });
const ext = look.extrude(look.inline(C.cream, '#000', 7, 3), '#9a1020', '#1a0204', 56, 1, 2);
const lpC = look.cache(look.letterpress(C.red2, { depth: 6 }), { pad: 30 });
const extC = look.cache(ext, { pad: 80 });
const tests = {
  clear: () => { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); },
  heat_draw: () => heat.draw(ctx, 1.3, { field: FIELD.pour }),
  heat_035: () => heat35.draw(ctx, 1.3, { field: FIELD.pour }),
  heat_025: () => heat25.draw(ctx, 1.3, { field: FIELD.pour }),
  heat_tunnel_025: () => heat25.draw(ctx, 1.3, { field: FIELD.tunnel }),
  letterpress_cached: () => glyphs(ctx, wc, null, lpC),
  fill_word: () => glyphs(ctx, w5, null, look.fill(C.cream)),
  inline_word: () => glyphs(ctx, w5, null, look.inline(C.cream, C.red2, 9, 5)),
  extrude_56px: () => glyphs(ctx, w5, null, ext),
  extrude_cached: () => glyphs(ctx, w5, (g) => ({ sy: 0.9, s: 1.1 }), extC),
  hatch_word: () => glyphs(ctx, wp, null, look.hatch(C.cream, '#2a0a0c', { edge: '#000' })),
  letterpress_word: () => glyphs(ctx, wc, null, look.letterpress(C.red2, { depth: 6 })),
  emboss_word: () => glyphs(ctx, wc, null, look.emboss(C.cream, { height: 8 })),
  springs_word: () => glyphs(ctx, w5, springs(0.2, { from: { dy: 300, rot: 0.4 } }), look.fill(C.cream)),
  drawOn_half: () => drawOn(ctx, w5, 0.5, { fill: look.fill(C.red2), fillFrom: 0.7 }),
  rings_4: () => rings(ctx, wb, null, { n: 4, gap: 16, th: 3 }),
  mask_heat: () => mask(ctx, wb, null, L => heat.draw(L, 1.3, { field: FIELD.pour })),
  mask_gradient: () => mask(ctx, wb, null, L => { const g = L.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#fff'); g.addColorStop(1, C.red2); L.fillStyle = g; L.fillRect(0, 0, W, H); }),
  shatter_intact: () => sh.draw(ctx, 0, { edge: '#f60', crack: 0.5 }),
  shatter_flying: () => sh.draw(ctx, 0.4, { edge: '#f60' }),
  three_075: () => T3.draw(ctx),
  three_050: () => T3b.draw(ctx),
  finish: () => fin.apply(ctx, 3, { grain: 0.09, vignette: 0.7 }),
};
window.bench = async (name, n = 5) => {
  const f = tests[name]; f(); ctx.getImageData(0, 0, 1, 1);
  const ms = [];
  for (let i = 0; i < n; i++) { const t0 = performance.now(); f(); ctx.getImageData(0, 0, 1, 1); ms.push(performance.now() - t0); }
  ms.sort((a, b) => a - b); return ms[n >> 1];
};
window.tests = Object.keys(tests);
window.sceneReady = true;
