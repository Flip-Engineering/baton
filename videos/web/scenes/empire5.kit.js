// CIVILIZATION v12 (1 Oct): the kit under the rebuilt picture. One three-ink press (lib/fx/plates.js: red, press black, gold,
// each a full-resolution plate, flats printed flat), the Isotype sign family (lib/fx/signs.js), printkit's hard-edged depth,
// and a few drawing helpers over the plates' 2D router. Nothing here is a gradient, a glow or a blur.
import { W, H, loadFonts, clamp, lerp, ease, rng, BRAND } from '../lib/kit.js';
import { Print } from '../lib/fx/print.js';
import { Plates } from '../lib/fx/plates.js';
import { loadFace, cpuOut } from '../lib/fx/type.js';
import { loadSil } from '../lib/fx/sil.js';
export { W, H, clamp, lerp, ease, rng, BRAND };

export const RED = '#D11F24', BLK = '#111111', GOLD = '#C9A04A', PAPER = '#EFE2C4';
export const TAU = Math.PI * 2;
// ink colours for the router: an ink's own rgb at alpha a is that ink at coverage a; PAPER knocks every ink out
export const k = (a = 1) => `rgba(17,17,17,${a})`;
export const r = (a = 1) => `rgba(209,31,36,${a})`;
export const d = (a = 1) => `rgba(201,160,74,${a})`;      // gold

export const ctx = cpuOut();
await loadFonts();
for (const [fam, file] of [['Oswald', 'oswald/files/oswald-latin-700-normal.woff2'], ['Plex Bold', 'ibm-plex-mono/files/ibm-plex-mono-latin-700-normal.woff2']]) {
  try { const f = new FontFace(fam, `url(../node_modules/@fontsource/${file})`); document.fonts.add(await f.load()); } catch (e) { console.log('font', fam, e.message); }
}
export const stencilF = await loadFace('anton');
export const SIL = await loadSil();
export const SIL_SIDE = await loadSil(undefined, 'sil_side_atlas');      // c20: people in profile (the person pipeline's SIL atlas)
export const STOCK = { base: PAPER, fib: 1.1, laid: 0, fleck: 0.6, mottle: 0.7, tooth: 0.5 };
export const pr = new Print();
// red: a flat coral level for the odd tint; black: a light stone, a ruled shade, solid; gold: a pale wash, solid
export const P = new Plates(pr, { paper: STOCK, inks: [
  { name: 'red', hex: RED, levels: [0.45, 1], tint: 'flat' },
  { name: 'black', hex: BLK, levels: [0.3, 0.62, 1], tint: ['flat', 'line', 'flat'], pitch: 9, angle: 45 },
  { name: 'gold', hex: GOLD, levels: [0.5, 1], tint: 'flat' }] });
export const g = P.tone;

// ---------------------------------------------------------------- drawing helpers (1080 x 1920 units)
export const fillP = (path, col, rule) => { g.fillStyle = col; g.fill(path, rule); };
export const rect = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
export const circle = (x, y, rad, col) => { g.fillStyle = col; g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill(); };
export const ring = (x, y, rad, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.arc(x, y, rad, 0, TAU); g.stroke(); };
export const lineP = (pts, col, w = 3, close = false) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); if (close) g.closePath(); g.stroke(); };
export const strokeP = (path, col, w = 3) => { g.strokeStyle = col; g.lineWidth = w; g.stroke(path); };
export const poly = (pts, col) => { g.fillStyle = col; g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fill(); };
export const text = (s, x, y, size, col, { font = 'Anton', align = 'center', base = 'alphabetic', track = 0 } = {}) => {
  g.font = `${size}px "${font}"`; g.textAlign = align; g.textBaseline = base; g.fillStyle = col; g.fillText(s, x, y); };
// bare paper under a path on every plate (a knock-out), optionally grown by `grow` px
export const knock = (path, grow = 0) => {
  P.knock(path);
  if (grow > 0) P.each(c => { c.save(); c.globalCompositeOperation = 'destination-out'; c.strokeStyle = '#000'; c.lineWidth = grow * 2; c.stroke(path); c.restore(); });
};
// a Path2D from drawing commands
export const mkPath = f => { const p = new Path2D(); f(p); return p; };
export const rectPath = (x, y, w, h) => { const p = new Path2D(); p.rect(x, y, w, h); return p; };
export const circPath = (x, y, rad) => { const p = new Path2D(); p.moveTo(x + rad, y); p.arc(x, y, rad, 0, TAU); return p; };
export const xf = (path, x, y, sx = 1, sy = sx, rot = 0) => { const p = new Path2D(); p.addPath(path, new DOMMatrix().translateSelf(x, y).rotateSelf(rot * 180 / Math.PI).scaleSelf(sx, sy)); return p; };
export const frame = (b, a, bb) => clamp((b - a) / (bb - a));

// the fill a sign is drawn in, its keyline, and the knock-out around it: signs are one Path2D each (lib/fx/signs.js)
import { sign, signPath, signOut } from '../lib/fx/signs.js';
export { sign, signPath, signOut };
// a sign as a path (its x centre, y baseline, height h in px) so many can be filled once
export function signAt(name, x, y, h, lod = 'auto', flip = false) {
  const l = lod === 'auto' ? (h < 48 ? 0 : h < 180 ? 1 : 2) : lod, { path, w } = signPath(name, l), s = h / 100;
  return xf(path, x - (flip ? -1 : 1) * w * s / 2, y, flip ? -s : s, s);
}
export const sg = (name, x, y, h, col, o = {}) => { g.fillStyle = col; return sign(g, name, x, y, h, o); };
