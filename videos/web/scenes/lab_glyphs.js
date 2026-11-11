// LAB / GLYPHS (TOOLING c4): the glyph-atlas demo and test. A split-flap price board (24 rows x 20 tiles, a slow zoom so
// the tile size changes, prices flipping every frame, a cream hook on top) drawn two ways:
//   ?mode=atlas  lib/fx/glyph_atlas.js: a few sheets per tile size and palette (the fix)
//   ?mode=naive  one cached canvas per glyph, size and palette (the MELTDOWN v11 draft pattern that went black)
// node tools/canvas_census.mjs lab_glyphs --query '?mode=naive'  vs  '?mode=atlas' shows the difference.
import { W, H, loadFonts } from '../lib/kit.js';
import { glyphAtlas, paintFlap, atlasStats } from '../lib/fx/glyph_atlas.js';

const Q = new URLSearchParams(location.search), MODE = Q.get('mode') || 'atlas';
const c = document.getElementById('out'); c.width = W; c.height = H; const g = c.getContext('2d');
await loadFonts();
const PAL = {
  dark: { bg0: '#1d1818', bg1: '#141011', fg: '#efe2c8' }, hot: { bg0: '#2a0d10', bg1: '#1c0709', fg: '#ff3a44' },
  cream: { bg0: '#f6ead3', bg1: '#e4d5b8', fg: '#140c0c', edge: 'rgba(255,255,255,0.6)' }, creamRed: { bg0: '#f6ead3', bg1: '#e4d5b8', fg: '#c4101f', edge: 'rgba(255,255,255,0.6)' },
};
const PAINT = Object.fromEntries(Object.entries(PAL).map(([k, p]) => [k, paintFlap(p)]));
const NAIVE = new Map(); let naiveMade = 0;
function naiveGlyph(ch, w, h, pal) {                 // the anti-pattern: a canvas per glyph x size x palette, kept forever
  const k = ch + '|' + w + '|' + h + '|' + pal;
  let cv = NAIVE.get(k);
  if (!cv) { cv = document.createElement('canvas'); cv.width = w; cv.height = h; PAINT[pal](cv.getContext('2d'), ch, w, h); NAIVE.set(k, cv); naiveMade++; }
  return cv;
}
function tile(x, y, w, h, ch, pal) {
  if (MODE === 'naive') { g.drawImage(naiveGlyph(ch, w, h, pal), x, y); return; }
  const A = glyphAtlas({ w, h, key: 'lab_glyphs:' + pal, paint: PAINT[pal], quant: 4 });
  A.draw(g, ch, x, y, w, h);                        // quant rounds the cell up to 4 px: fewer sizes, drawn to (w, h)
}
const CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$.,+-';
const hash = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
window.renderFrame = t => {
  g.fillStyle = '#0b0909'; g.fillRect(0, 0, W, H);
  const z = 1 + 0.25 * Math.sin(t * 0.4), tw = Math.round(46 * z), th = Math.round(tw * 1.9) & ~1;
  const rows = 24, cols = 20, x0 = Math.round(W / 2 - cols * (tw + 3) / 2), y0 = 520;
  for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
    const flip = Math.floor(t * 30 * (0.2 + hash(r, k) * 0.6) + hash(k, r) * 50);
    const ch = CH[Math.floor(hash(r * 31 + k, flip) * CH.length)];
    tile(x0 + k * (tw + 3), y0 + r * (th + 4), tw, th, ch, hash(r, 99) < 0.2 ? 'hot' : 'dark');
    if (y0 + r * (th + 4) > H) break;
  }
  const hw = 92, hh = 196;                           // the hook, two rows of cream flaps
  ['THANK YOU,', 'MONOPOLY.'].forEach((s, i) => [...s].forEach((ch, k) =>
    tile(Math.round(W / 2 - s.length * (hw + 8) / 2) + k * (hw + 8), 80 + i * (hh + 20), hw, hh, ch, i ? 'creamRed' : 'cream')));
};
window.glyphLab = () => MODE === 'naive' ? { mode: MODE, canvases: naiveMade } : { mode: MODE, ...atlasStats() };
window.renderFrame(0);
window.sceneReady = true;
