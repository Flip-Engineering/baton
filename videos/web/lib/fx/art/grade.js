import { INK_RGB } from './tokens.js';
// ART kit / GRADE: the finishing passes a dialect allows, 2D canvas, cheap (<= 60 ms a frame).
//
//   import { grade } from '../lib/fx/art/grade.js';
//   grade(dst, src, t, { dialect: 'furnace' })     // halation from the heat only, fine grain, no vignette glow
//   grade(dst, src, t, { dialect: 'newsreel' })    // 1906: orthochromatic mono toned to sepia, gate weave, flicker, grain, dust
//
// Rules (STYLE_BIBLE §material & light): halation is film physics (light scattering back through the emulsion from the
// brightest source) and appears only around emissive matter; it is never a glow put on type. Grain is fixed to the
// frame at a size that survives x264 (2 px clumps), and changes on twos with the figures.
const mk = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
let GR = null;
function grainTiles(n = 4, s = 256) {
  if (GR) return GR; GR = [];
  for (let k = 0; k < n; k++) { const c = mk(s, s), g = c.getContext('2d'), im = g.createImageData(s, s); let x = 1234567 + k * 7919;
    for (let i = 0; i < s * s; i += 1) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; const v = 128 + (((x >>> 0) % 1000) / 1000 - 0.5) * 120; const o = i * 4; im.data[o] = im.data[o + 1] = im.data[o + 2] = v; im.data[o + 3] = 255; }
    g.putImageData(im, 0, 0); const c2 = mk(s * 2, s * 2), g2 = c2.getContext('2d'); g2.imageSmoothingEnabled = true; g2.drawImage(c, 0, 0, s * 2, s * 2); GR.push(c2); }
  return GR;
}
const scratch = {};
const buf = (k, w, h) => { const c = scratch[k]; if (c && c.width === w && c.height === h) return c; return (scratch[k] = mk(w, h)); };

export function grade(dst, src, t, o = {}) {
  const { dialect = 'furnace', halo = 1, grain = 1, weave = 1, fps = 30 } = o;
  const W = dst.width, H = dst.height, g = dst.getContext('2d'), f = Math.floor(t * fps / 2);      // on twos
  const hash = k => { const s = Math.sin(f * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };
  g.save();
  if (dialect === 'newsreel') {
    const dx = weave * (hash(1) - 0.5) * 5, dy = weave * (hash(2) - 0.5) * 7, fl = 1 + (hash(3) - 0.5) * 0.08;
    g.fillStyle = '#0e0b08'; g.fillRect(0, 0, W, H);
    // orthochromatic: blue-green sensitive, red reads dark -> weight the channels before the mono (heat still reads white)
    g.filter = `grayscale(1) sepia(0.55) contrast(1.18) brightness(${fl.toFixed(3)})`;
    g.drawImage(src, dx, dy);
    g.filter = 'none';
  } else { g.drawImage(src, 0, 0); }
  // halation: the brightest source only (threshold via contrast/brightness on an 1/8 copy), warm, additive
  if (halo > 0) {
    const w8 = Math.round(W / 8), h8 = Math.round(H / 8), b = buf('h', w8, h8), bg = b.getContext('2d');
    bg.filter = 'brightness(0.55) contrast(6)'; bg.clearRect(0, 0, w8, h8); bg.drawImage(src, 0, 0, w8, h8); bg.filter = 'none';
    const b2 = buf('h2', w8, h8), b2g = b2.getContext('2d'); b2g.clearRect(0, 0, w8, h8); b2g.filter = 'blur(6px)'; b2g.drawImage(b, 0, 0); b2g.filter = 'none';
    g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.55 * halo;
    if (dialect === 'newsreel') g.filter = 'grayscale(1) sepia(0.6)';
    g.drawImage(b2, 0, 0, W, H); g.filter = 'none';
    g.globalAlpha = 0.35 * halo; const b3 = buf('h3', w8, h8), b3g = b3.getContext('2d'); b3g.clearRect(0, 0, w8, h8); b3g.filter = 'blur(2px)'; b3g.drawImage(b, 0, 0); b3g.filter = 'none';
    g.drawImage(b3, 0, 0, W, H);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  if (dialect === 'newsreel') {
    const v = g.createRadialGradient(W / 2, H * 0.45, H * 0.25, W / 2, H * 0.5, H * 0.75); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(10,6,2,0.65)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
    // dust and a scratch, per two frames
    g.fillStyle = 'rgba(245,235,215,0.8)';
    for (let i = 0; i < 5; i++) if (hash(10 + i) < 0.5) { g.beginPath(); g.ellipse(hash(20 + i) * W, hash(30 + i) * H, 1 + hash(40 + i) * 3, 1 + hash(50 + i) * 2, hash(60 + i) * 3, 0, 7); g.fill(); }
    if (hash(70) < 0.35) { g.fillStyle = 'rgba(240,230,210,0.25)'; g.fillRect(hash(71) * W, 0, 1.5, H); }
  }
  if (grain > 0) {
    const tiles = grainTiles(), tile = tiles[f % tiles.length], ox = Math.floor(hash(5) * 256), oy = Math.floor(hash(6) * 256);
    g.globalCompositeOperation = 'overlay'; g.globalAlpha = (dialect === 'newsreel' ? 0.5 : 0.22) * grain;
    for (let y = -oy; y < H; y += tile.height) for (let x = -ox; x < W; x += tile.width) g.drawImage(tile, x, y);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  g.restore();
  return dst;
}

// SILKSCREEN (IRON post-STRIKE dialect): a frame separated into flat plates on stock: cyan for the dark ground, ink for
// the shadowed forms, red for the lit forms, bare stock for the hot light. Each plate has its own misregistration
// (reg: px, settling toward the trap after a hit) and the screen mesh shows faintly in the flats.
//   silkscreen(dst, src, t, { reg: [[dx,dy] per plate], cuts: [0.06, 0.2, 0.5] })
export function silkscreen(dst, src, t, { reg = [[0, 0], [0, 0], [0, 0]], cuts = [0.07, 0.2, 0.46], inks = ['cyan', 'ink', 'red'], mesh = 0.06 } = {}) {
  const W = dst.width, H = dst.height, s = buf('ss', W, H), sg = s.getContext('2d', { willReadFrequently: true }); sg.drawImage(src, 0, 0, W, H);
  const D = sg.getImageData(0, 0, W, H).data, g = dst.getContext('2d'), im = g.createImageData(W, H), O = im.data;
  const P = inks.map(k => INK_RGB[k]), st = INK_RGB.stock;
  const L = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) L[i] = (D[i * 4] * 0.2126 + D[i * 4 + 1] * 0.7152 + D[i * 4 + 2] * 0.0722);
  const c0 = cuts[0] * 255, c1 = cuts[1] * 255, c2 = cuts[2] * 255;
  const at = (x, y) => { x = x < 0 ? 0 : x >= W ? W - 1 : x; y = y < 0 ? 0 : y >= H ? H - 1 : y; return L[y * W + x]; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = st[0], gg = st[1], b = st[2];
    const mk = mesh * (((x >> 1) + (y >> 1)) & 1);
    // plates print in order: cyan ground, red, then ink on top (multiply-like overprint for cyan x red -> dark)
    const lc = at(x - reg[0][0] | 0, y - reg[0][1] | 0), lr = at(x - reg[2][0] | 0, y - reg[2][1] | 0), lk = at(x - reg[1][0] | 0, y - reg[1][1] | 0);
    if (lc < c0) { r = P[0][0]; gg = P[0][1]; b = P[0][2]; }
    if (lr >= c1 && lr < c2) { if (lc < c0) { r = P[2][0] * P[0][0] / 255; gg = P[2][1] * P[0][1] / 255; b = P[2][2] * P[0][2] / 255; } else { r = P[2][0]; gg = P[2][1]; b = P[2][2]; } }
    if (lk >= c0 && lk < c1) { r = P[1][0]; gg = P[1][1]; b = P[1][2]; }
    const o = (y * W + x) * 4; O[o] = r * (1 - mk); O[o + 1] = gg * (1 - mk); O[o + 2] = b * (1 - mk); O[o + 3] = 255;
  }
  g.putImageData(im, 0, 0); return dst;
}
