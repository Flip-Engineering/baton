// printlab renderer harness: window.run(job) draws one job into #out. Jobs: film:<stock>:<src>:<frame>:<json opts>,
// print:<process>:<src>, type:<pass>. Sources come from /s/ (PNG/JPEG frames written by the Python side).
import { PrintLab, setType } from '/web/lib/printlab.js';
const W = 1080, H = 1920, out = document.getElementById('out'), ctx = out.getContext('2d', { willReadFrequently: true });
const img = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
const mk = () => Object.assign(document.createElement('canvas'), { width: W, height: H });
let lab;
const srcs = {};
async function src(name) { return srcs[name] || (srcs[name] = await img('/s/' + name)); }
function greyCanvas(im, fn) {   // tone canvas from an image through fn(lum 0..1) -> 0..1
  const c = mk(), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H), a = d.data;
  for (let i = 0; i < a.length; i += 4) { const v = Math.round(255 * fn(a[i] / 255)); a[i] = a[i + 1] = a[i + 2] = v; a[i + 3] = 255; }
  g.putImageData(d, 0, 0); return c;
}
window.setup = async () => {
  for (const [n, u] of [['UltraPL', '/web/node_modules/@fontsource/ultra/files/ultra-latin-400-normal.woff'], ['FellPL', '/web/node_modules/@fontsource/im-fell-english/files/im-fell-english-latin-400-normal.woff']]) {
    const f = new FontFace(n, `url(${u})`); document.fonts.add(await f.load()); }
  lab = await PrintLab.create();
  for (const s of ['kodachrome25', 'trix7266', 'technicolor_ib', 'orwocolor', 'nitrate_bw']) await lab.stock(s);
  window.__ready = true;
};
window.run = async (job) => {
  const [kind, a, b, c, d] = job.split('|');
  const t0 = performance.now();
  if (kind === 'film') { const im = await src(b); lab.film(ctx, im, a, { frame: +c || 0, ...(d ? JSON.parse(d) : {}) }); }
  else if (kind === 'print') {
    const im = await src(b); const o = c ? JSON.parse(c) : {};
    const cam = { view_mm: o.view_mm || 180, x_mm: o.x_mm || 0, y_mm: o.y_mm || 0 };
    // tone canvases are prepared by the Python side (plate-making is a choice, not part of the press): b is that plate
    if (a === 'riso') { const s = lab.paper('riso_bond', cam, 3); lab.riso(s, im, { ink: 'riso_federal_blue' }); lab.draw(ctx, s); }
    if (a === 'gravure') { const s = lab.paper('supercal', cam, 6); lab.gravure(s, im, {}); lab.draw(ctx, s); }
    if (a === 'cyanotype') { const s = lab.paper('whatman', cam, 5); lab.cyanotype(s, im, { dose: o.dose ?? 1, wash: o.wash ?? 1, oxidise: o.oxidise ?? 1 }); lab.draw(ctx, s); }
    if (a === 'silkscreen') { const s = lab.paper('poster', cam, 4); lab.silkscreen(s, im, { ink: 'screen_red' }); lab.draw(ctx, s); }
    if (a === 'paper') { const s = lab.paper(o.paper || 'book1874', cam, 2); lab.draw(ctx, s); }
  } else if (kind === 'type') {
    const o = a ? JSON.parse(a) : {}; const cam = { view_mm: o.view_mm || 200, x_mm: o.x_mm || 0, y_mm: o.y_mm || 0 };
    const s = lab.paper('book1874', cam, 2);
    const F = setType([{ text: 'WOOD', x_mm: 14, base_mm: 70, lines: 9, face: 'UltraPL', seed: 3 }, { text: 'TYPE', x_mm: 14, base_mm: 112, lines: 9, face: 'UltraPL', seed: 4 },
      { text: 'Specimen', x_mm: 14, base_mm: 160, lines: 4, face: 'FellPL', material: 'metal', seed: 5 }, { text: 'of Printing Types, 1874', x_mm: 14, base_mm: 185, lines: 1.6, face: 'FellPL', material: 'metal', seed: 6 }], cam);
    lab.letterpress(s, F, { ink: 'black1874', pressure: 0.45 });
    const F2 = setType([{ text: 'No. 5', x_mm: 120, base_mm: 200, lines: 3, face: 'UltraPL', seed: 9 }], cam);
    lab.letterpress(s, F2, { ink: 'vermilion', misreg: [0.6, -0.3, 0.2] });
    lab.draw(ctx, s);
  }
  lab.gl.finish();
  return performance.now() - t0;
};
