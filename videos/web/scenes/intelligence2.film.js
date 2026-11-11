// ACCELERATE c11: real film in the white ink world, printed. Sources (all public domain, cut by _c11/accelerate_film.py into grey
// sprite atlases, 15 fps, 400x300 cells): "Machine: Master or Slave?" (1941: the lay-off, the gear wheel, the men at the machine),
// "On Guard! The Story of SAGE" (1956: operators, scopes, the drafting room, the memory racks), an Otto engine's governor and cam.
//
// The film reaches the page as PRINT: a small luminance canvas (the frame cropped to a portrait window, or the whole 4:3 frame as a
// band) printed as a 45-degree halftone in black ink on the paper, over a soft second ink, with a little gate weave and scratches.
import { W, H, clamp, lerp } from '../lib/kit.js';

const INK = '#0b0b0b', PAPER = '#f7f7f2';
// two atlas folders: c11 (the 1941 plant and SAGE, 400x300 cells) and c12 (Master Hands 1936 and more of the 1941 film, 480x360 cells; _c12/accelerate_film.py)
const BASES = [new URL('../assets/intelligence/c12/', import.meta.url), new URL('../assets/intelligence/c11/', import.meta.url)];
let META = null;
const ATLAS = {}, WHERE = {};
export async function loadClips(names) {
  if (!META) { META = {}; for (const b of BASES) { const m = await (await fetch(new URL('clips.json', b))).json(); for (const k in m) if (!META[k]) { META[k] = m[k]; WHERE[k] = b; } } }
  await Promise.all(names.map((k) => new Promise((res, rej) => { const im = new Image(); im.onload = () => { ATLAS[k] = im; res(); }; im.onerror = rej; im.src = new URL(k + '.jpg', WHERE[k]).href; })));
}
export const clipLen = (k) => META[k].n / META[k].fps;          // seconds

const FULL = { w: 270, h: 480 }, BAND = { w: 400, h: 300 };
const mk = (d) => { const c = document.createElement('canvas'); c.width = d.w; c.height = d.h; return c; };
const lumF = mk(FULL), lumB = mk(BAND), SOFT = {};
const gF = lumF.getContext('2d', { willReadFrequently: true }), gB = lumB.getContext('2d', { willReadFrequently: true });

// the frame index at s seconds into clip k: 'hold' stops on the last frame, 'loop' wraps, 'pp' ping-pongs
export function frameAt(k, s, mode = 'hold') {
  const n = META[k].n; let i = Math.floor(s * META[k].fps);
  if (mode === 'loop') i = ((i % n) + n) % n;
  else if (mode === 'pp') { const p = 2 * (n - 1); i = ((i % p) + p) % p; if (i >= n) i = p - i; }
  return clamp(i, 0, n - 1);
}
function toLum(k, i, o) {
  const m = META[k], col = i % m.cols, row = Math.floor(i / m.cols), sx = col * m.cw, sy = row * m.ch, im = ATLAS[k];
  if (o.band) {                                     // the whole 4:3 frame, or a window of it (bz zoom, cx/cy centre) for a push-in
    const z = o.bz ?? 1, ar = o.ar ?? m.cw / m.ch, ww = Math.min(m.cw, m.ch * ar) / z, hh = ww / ar, cx = clamp((o.cx ?? 0.5) * m.cw, ww / 2, m.cw - ww / 2), cy = clamp((o.cy ?? 0.5) * m.ch, hh / 2, m.ch - hh / 2);
    gB.drawImage(im, sx + cx - ww / 2, sy + cy - hh / 2, ww, hh, 0, 0, BAND.w, BAND.h); return [lumB, gB]; }
  const z = o.zoom ?? 1, hh = m.ch / z, ww = hh * FULL.w / FULL.h;
  const cx = clamp((o.cx ?? 0.5) * m.cw, ww / 2, m.cw - ww / 2), cy = clamp((o.cy ?? 0.5) * m.ch, hh / 2, m.ch - hh / 2);
  gF.drawImage(im, sx + cx - ww / 2, sy + cy - hh / 2, ww, hh, 0, 0, FULL.w, FULL.h);
  return [lumF, gF];
}
// print clip k, frame i, as a halftone in rect [x, y, w, h]. o: band (the whole 4:3 frame) | cx, cy, zoom (portrait window); pitch, ang,
// lo/hi/gamma (tone window), gain, ink, soft (second ink), flip, weave (px), seed
export function print(c, k, i, rect, o = {}) {
  const [lum, g] = toLum(k, i, o), LW = lum.width, LH = lum.height;
  const d = g.getImageData(0, 0, LW, LH).data;
  const [rx, ry, rw, rh] = rect, sx = rw / LW, sy = rh / LH;
  const pitch = o.pitch ?? (o.band ? 7 : 9), ang = o.ang ?? Math.PI / 4, lo = o.lo ?? 0.08, hi = o.hi ?? 0.84, gm = o.gamma ?? 0.9, ca = Math.cos(ang), sa = Math.sin(ang);
  const seed = o.seed ?? i, wx = Math.sin(seed * 12.9898) * (o.weave ?? 2.5), wy = Math.sin(seed * 78.233) * (o.weave ?? 2.5);
  const tone = (x, y) => {
    let px = Math.floor((x - rx) / sx), py = Math.floor((y - ry) / sy);
    if (o.flip) px = LW - 1 - px;
    if (px < 0 || py < 0 || px >= LW || py >= LH) return -1;
    return clamp((d[(py * LW + px) * 4] / 255 - lo) / (hi - lo));
  };
  c.save(); c.beginPath(); c.rect(rx, ry, rw, rh); c.clip(); c.translate(wx, wy);
  if (o.soft) {                                     // the soft second ink: contrast on the small canvas (cheap), then scaled up multiplied
    const tm = (SOFT[LW] ??= (() => { const t = document.createElement('canvas'); t.width = LW; t.height = LH; return t; })()), tg = tm.getContext('2d');
    tg.clearRect(0, 0, LW, LH); tg.filter = 'contrast(1.3) brightness(1.12)'; tg.drawImage(lum, 0, 0); tg.filter = 'none';
    c.save(); c.globalAlpha = o.soft; c.globalCompositeOperation = 'multiply'; c.imageSmoothingQuality = 'high';
    if (o.flip) { c.translate(rx + rw, ry); c.scale(-1, 1); c.drawImage(tm, 0, 0, rw, rh); } else c.drawImage(tm, rx, ry, rw, rh); c.restore(); }
  const dots = new Path2D(), cx0 = rx + rw / 2, cy0 = ry + rh / 2;
  // c20: only the lattice over the visible part of the rect (a Droste frame can be many screens wide)
  const vx0 = Math.max(rx, 0) - pitch, vy0 = Math.max(ry, 0) - pitch, vx1 = Math.min(rx + rw, W) + pitch, vy1 = Math.min(ry + rh, H) + pitch;
  let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
  for (const [qx, qy] of [[vx0, vy0], [vx1, vy0], [vx0, vy1], [vx1, vy1]]) { const dx = qx - cx0, dy = qy - cy0, la = (dx * ca + dy * sa) / pitch, lb = (-dx * sa + dy * ca) / pitch;
    a0 = Math.min(a0, la); a1 = Math.max(a1, la); b0 = Math.min(b0, lb); b1 = Math.max(b1, lb); }
  if (vx1 <= vx0 || vy1 <= vy0) { c.restore(); return; }
  for (let a = Math.floor(a0); a <= Math.ceil(a1); a++) for (let b = Math.floor(b0); b <= Math.ceil(b1); b++) {
    const lx = a * pitch, ly = b * pitch, x = cx0 + lx * ca - ly * sa, y = cy0 + lx * sa + ly * ca;
    if (x < vx0 || y < vy0 || x > vx1 || y > vy1) continue;
    const t = tone(x, y); if (t < 0) continue;
    const cov = Math.pow(1 - t, gm) * (o.gain ?? 1);
    if (cov < 0.04) continue;
    const r = pitch * 0.5 * Math.sqrt(clamp(cov)) * 1.32;
    dots.moveTo(x + r, y); dots.arc(x, y, r, 0, Math.PI * 2);
  }
  c.fillStyle = o.ink ?? INK; c.fill(dots);
  // scratches and dust (a few per frame, from the frame's seed)
  const r = (n2) => { const v = Math.sin((seed + 1) * 91.7 + n2 * 37.3) * 43758.5453; return v - Math.floor(v); };
  c.globalAlpha = 0.5; c.lineWidth = 1.4; c.strokeStyle = r(1) < 0.5 ? PAPER : INK;
  for (let q = 0; q < 2; q++) { const x = rx + r(2 + q) * rw; c.beginPath(); c.moveTo(x, ry + r(5 + q) * rh * 0.3); c.lineTo(x + (r(8 + q) - 0.5) * 6, ry + rh * (0.5 + r(11 + q) * 0.5)); c.stroke(); }
  c.restore();
}
