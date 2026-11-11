// PEOPLE'S NATIONAL BANK v8: real people and real work, cut as line engraving.
// Public-domain photographs (Library of Congress FSA/OWI, 1941-43: Palmer, Delano, Jacobs; all "No known restrictions")
// go through lib/fx/figure_ref.js engrave() (Lynd Ward's planes: k-means on the tone, each plane ruled along its own
// form, cut by art/burin2d.js). Faces are matted (BiRefNet, scripts/roto.py's functions) and cut as busts on the
// oval's ruled field; vignettes are whole photographs cropped to the panel and feathered to the paper.
import { loadRef, engrave } from '../lib/fx/figure_ref.js';
const BASE = new URL('../assets/bank/', import.meta.url).href;
const mk = (w, h) => Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) });
export const FACE_NAMES = ['woman', 'old', 'young', 'mech'];
const imgCache = new Map();
async function loadImg(url) {
  if (!imgCache.has(url)) imgCache.set(url, new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }));
  return imgCache.get(url);
}
// a whole photograph cropped to a box (fractions of the image), scaled to w x h, with its edge feathered to nothing
export async function photoF(name, crop, w, h, { fade = 0.14, mode = 'rect' } = {}) {
  const img = await loadImg(BASE + 'ph_' + name + '.jpg');
  // crop: [x0, y0, x1, y1] as fractions of the image, or [cx, cy, hf] (centre and height fraction; the width follows w:h)
  let sx, sy, sw, sh;
  if (crop.length === 3) { sh = crop[2] * img.height; sw = sh * w / h; sx = Math.min(img.width - sw, Math.max(0, crop[0] * img.width - sw / 2)); sy = Math.min(img.height - sh, Math.max(0, crop[1] * img.height - sh / 2)); }
  else { sx = crop[0] * img.width; sy = crop[1] * img.height; sw = (crop[2] - crop[0]) * img.width; sh = (crop[3] - crop[1]) * img.height; }
  const c = mk(w, h), x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
  x.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  const I = x.getImageData(0, 0, w, h), D = I.data;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const u = i / w, v = j / h; let d;
    if (mode === 'ellipse') d = 1 - Math.hypot((u - 0.5) * 2, (v - 0.5) * 2); else d = Math.min(u, 1 - u, v, 1 - v) * 2;
    const a = Math.min(1, Math.max(0, d / fade)); D[(j * w + i) * 4 + 3] = a * a * (3 - 2 * a) * 255;
  }
  x.putImageData(I, 0, 0);
  return { img: c, meta: { foot: [w / 2, h] }, w, h, name };
}
// one vignette: the panel's own canvas, white ground, ink lines (the photograph engraved to fill it)
export async function vignette(name, crop, w, h, o = {}) {
  const F = await photoF(name, crop, w, h, { fade: o.fade ?? 0.1 }), c = mk(w, h), g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  engrave(g, F, { box: [0, 0, w, h], pitch: o.pitch ?? 4.6, planes: o.planes ?? 6, gamma: o.gamma ?? 0.8, clarity: o.clarity ?? 0.9, gain: o.gain ?? 1.08, lift: o.lift ?? 0.02, ink: o.ink ?? '#000000', paper: '#ffffff' });
  return c;
}
// a face as a bust: matted film/photo person cut on a transparent ground, fitted to box in the (w x h) canvas
export async function face(name, w, h, box, o = {}) {
  const F = await loadRef(name, BASE), c = mk(w, h), g = c.getContext('2d');
  engrave(g, F, { box, pitch: o.pitch ?? 4.6, planes: o.planes ?? 6, gamma: o.gamma ?? 0.75, clarity: o.clarity ?? 1.0, gain: o.gain ?? 1.08, lift: o.lift ?? 0.02, ink: '#000000', paper: '#ffffff', flip: !!o.flip });
  return c;
}
