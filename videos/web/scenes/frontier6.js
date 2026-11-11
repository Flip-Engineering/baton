// THE IRON IS HOT, cycle 20 (the full rework): scripts_final/frontier.json, score audio/songs2/frontier_c20.py (96 BPM).
// One photographic world from the first frame to the last: Palmer's faces lit by a furnace we do not see (OWI, 1940-41), the Gary
// plat drawn in ink on the plate's sepia and becoming the April 1908 plate, the 1910 works letting their light go, Gary's own fight
// (the 1919 steel strike: National Photo Co. negatives, LoC), the bar man drawn back and released (Steel: A Symphony of Industry, 1936),
// the pour into the country, and the poured metal TEMPERED on screen (straw, bronze, purple, blue) until it is dark steel with the
// emblem in it. No captions, no board, no print, no stamp, no ring.
// Takes (frontier6_a.html / frontier6_b.html, chosen by the page name):
//   a: the Chairman's ch. 2 sentences over the works let go
//   b: the works let go under no words (the music alone)
// Both end on TO DISCOVER HOW THE STEEL IS TEMPERED. and the tempered emblem; GARY, 2036. was tried in r1's take a and dropped
// (on the darkening steel it read as a dateline pointing at another series).
import { W, H, loadFonts, loadBeats, loadImage, clamp, lerp, ease, Finish, acpEmblem } from '../lib/kit.js';
import { drawLockup } from '../lib/closer.js';
import { LivingPhoto, path } from '../lib/fx/living_photo.js';

const SCENE = (location.pathname.split('/').pop() || 'frontier6_a.html').replace(/\.html$/, '');
const TAKE = SCENE.endsWith('_b') ? 'b' : 'a';
const out = document.getElementById('out'); out.width = W; out.height = H;
const ctx = out.getContext('2d');
await loadFonts();
{ const f = new FontFace('Playfair', 'url(../node_modules/@fontsource/playfair-display/files/playfair-display-latin-900-normal.woff)'); document.fonts.add(await f.load()); }
const B = await loadBeats(SCENE);
const SPB = B.spb;
const finish = new Finish(1906);
const BASE = '/web/assets/iron13/', BASE20 = '/web/assets/iron20/';

// ================================================================ pictures
const packs = {};
async function pack(name) { try { packs[name] ??= await LivingPhoto.load(name, { base: BASE }); } catch (e) { console.warn('f6 pack missing', name); packs[name] = null; } return packs[name]; }
const img = {};
async function image(name, src) { try { img[name] = await loadImage(src); } catch (e) { console.warn('f6 missing', src); img[name] = null; } return img[name]; }
const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const hsh = (x, y = 0, s = 0) => { const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };
const vn1 = (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hsh(i, 0, 5) * (1 - u) + hsh(i + 1, 0, 5) * u; };
const furn = (t, s = 0) => 0.58 + 0.46 * vn1(t * 4.7 + s * 9) + 0.22 * vn1(t * 19 + s * 3) + 1.1 * Math.pow(vn1(t * 1.15 + s * 5), 7);
const flick = (t, s = 0) => 0.86 + 0.14 * (0.5 * Math.sin(t * 13.1 + s) + 0.3 * Math.sin(t * 29.7 + s * 2.1) + 0.2 * Math.sin(t * 47.3 + s * 3.7));

// ================================================================ type: the Chairman's sentences, Playfair Black in cream, no glow
function setLines(g, lines, { x = W / 2, y = 1500, size = 118, lh = 1.08, align = 'center', color = '#f4e6d0', shadow = 0.6, alpha = 1 } = {}) {
  g.save(); g.font = `900 ${size}px Playfair`; g.textAlign = align; g.textBaseline = 'alphabetic'; g.globalAlpha = alpha;
  const n = lines.length, y0 = y - (n - 1) * size * lh;
  lines.forEach((s, i) => {
    const yy = y0 + i * size * lh;
    g.shadowColor = `rgba(8,4,2,${shadow})`; g.shadowBlur = size * 0.4; g.shadowOffsetY = size * 0.05;
    g.fillStyle = color; g.fillText(s, x, yy);
    g.shadowBlur = 0; g.shadowOffsetY = 0;
  });
  g.restore();
}
const fitSize = (g, lines, size, maxW = 960) => { g.save(); g.font = `900 ${size}px Playfair`; const w = Math.max(...lines.map(s => g.measureText(s).width)); g.restore(); return w > maxW ? size * maxW / w : size; };

// ================================================================ light
const AMBER = [[0.012, 0.003, 0.002], [0.52, 0.12, 0.02], [1.0, 0.47, 0.19]];
function darken(g, x, y, r0, r1, a = 1) {
  const gr = g.createRadialGradient(x, y, r0, x, y, r1); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${a})`);
  g.save(); g.fillStyle = gr; g.fillRect(0, 0, W, H); g.restore();
}
function glow(g, x, y, r, rgb, a) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(1, `rgba(${rgb},0)`);
  g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = gr; g.fillRect(0, 0, W, H); g.restore();
}
function feather(g, y0, y1, a0 = 1, a1 = 1) {
  const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, `rgba(0,0,0,${a0})`); gr.addColorStop(1, `rgba(0,0,0,${a1})`);
  g.fillStyle = gr; g.fillRect(0, Math.min(y0, y1), W, Math.abs(y1 - y0));
}

// ---------------------------------------------------------------- the faces: lit by a furnace we do not see
function faceShot(P, t, lt, o) {
  if (!P) return;
  const u = clamp(lt / o.len);
  const cam = path([{ t: 0, cx: o.c0[0], cy: o.c0[1], zoom: o.z0, push: 0.02, px: -0.004 }, { t: 1, cx: o.c1[0], cy: o.c1[1], zoom: o.z1, push: 0.05, px: 0.004 }], { reason: o.reason })(u);
  const fire = o.fire(t, lt);
  P.draw(ctx, t, { cam, look: { ramp: AMBER, keep: 0, contrast: 1.7, pivot: 0.52, sat: 1, warmth: 0, halation: 0.3, vignette: 0.15, grain: 0.05, lift: 0 },
    lights: [{ x: o.light[0], y: o.light[1], z: 0.35, radius: 0.5, color: [1, 0.34, 0.08], w: 1.5 * fire }, { x: o.light[0], y: o.light[1] + 0.2, z: 0.2, radius: 0.9, color: [1, 0.22, 0.04], w: 0.6 * fire }], seed: Math.floor(t * 24) });
  const sx = o.scr[0] * W, sy = o.scr[1] * H;
  darken(ctx, sx, sy, 160, 1150, 0.82 - 0.2 * Math.min(1, fire));
  glow(ctx, sx, sy, 900, '255,110,30', 0.10 * fire);
  ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = 'rgb(255,208,176)'; ctx.fillRect(0, 0, W, H); ctx.restore();
}

// ================================================================ toned pictures (a LUT turns a grey picture into a stock)
function lut(stops) {
  const L = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) { const x = i / 255; let k = 0; while (k < stops.length - 2 && x > stops[k + 1][0]) k++;
    const [p0, c0] = stops[k], [p1, c1] = stops[k + 1], u = clamp((x - p0) / (p1 - p0)); for (let j = 0; j < 3; j++) L[i * 3 + j] = c0[j] + (c1[j] - c0[j]) * u; }
  return L;
}
const LUTS = {
  sepia: lut([[0, [10, 8, 6]], [0.45, [118, 96, 70]], [0.8, [214, 192, 156]], [1, [250, 242, 224]]]),
  silver: lut([[0, [0, 0, 0]], [1, [255, 255, 255]]]),
  iron: lut([[0, [5, 3, 3]], [0.28, [58, 28, 18]], [0.55, [168, 98, 60]], [0.78, [236, 176, 120]], [0.92, [255, 232, 196]], [1, [255, 252, 244]]]),
  // the strike plates: the faces' own stock (deep brown blacks, ember mids, a warm cream top), so 1919 sits in the opening's light
  ember: lut([[0, [6, 3, 2]], [0.3, [62, 26, 12]], [0.58, [168, 92, 48]], [0.82, [234, 182, 128]], [1, [252, 236, 208]]]),
};
const scratch = {};
function toned(src, name, key, { gain = 1, gamma = 1 } = {}) {
  const sw = src.width, sh = src.height, k = key + sw + 'x' + sh; let c = scratch[k];
  if (!c) c = scratch[k] = cv(sw, sh);
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(src, 0, 0);
  const id = g.getImageData(0, 0, sw, sh), d = id.data, L = LUTS[name];
  for (let i = 0; i < d.length; i += 4) { const v = Math.pow(clamp(d[i] / 255 * gain), gamma) * 255 | 0; d[i] = L[v * 3]; d[i + 1] = L[v * 3 + 1]; d[i + 2] = L[v * 3 + 2]; }
  g.putImageData(id, 0, 0); return c;
}
const tonedCache = {};
function tonedOnce(name, lutName, opts) { return tonedCache[name + lutName] ??= toned(img[name], lutName, name + lutName, opts); }

// ================================================================ the film (Steel: A Symphony of Industry, 1936)
const frames = {}, seqs = {};
async function seqFrame(dir, p, i, n) { i = Math.max(1, Math.min(n, Math.round(i))); const key = dir + i; if (!(key in seqs)) seqs[key] = await loadImage(`${BASE}${dir}/${p}_${String(i).padStart(3, '0')}.jpg`).catch(() => null); return seqs[key]; }
function filmCrop(g, im, { fx = 320, fy = 240, sc = 4, lutName = 'iron', key = 'fc', dx = 0, dy = 0, gain = 1, gamma = 1, glowK = 0 } = {}) {
  const c = toned(im, lutName, key, { gain, gamma }), x0 = W / 2 - fx * sc + dx, y0 = H / 2 - fy * sc + dy;
  g.drawImage(c, x0, y0, c.width * sc, c.height * sc);
  if (glowK) { g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = glowK; g.filter = 'blur(30px)'; g.drawImage(c, x0, y0, c.width * sc, c.height * sc); g.filter = 'none'; g.restore(); }
}
async function clipFrame(k, i, n) { i = Math.max(1, Math.min(n, i)); const key = k + i; if (!(key in frames)) frames[key] = await loadImage(`${BASE}sym/${k}_${String(i).padStart(3, '0')}.jpg`).catch(() => null); return frames[key]; }
function band(g, im, { cx = 0.5, cy = 0.5, scale = 2.4, y = 860, lutName = 'iron', gain = 1, gamma = 1, glowK = 0.35, shake = 0, key = 'f' } = {}) {
  const c = toned(im, lutName, key, { gain, gamma });
  const bw = c.width * scale, bh = c.height * scale, x0 = W / 2 - cx * bw + shake, y0 = y - cy * bh;
  g.save(); g.drawImage(c, x0, y0, bw, bh);
  if (glowK) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = glowK; g.filter = 'blur(26px)'; g.drawImage(c, x0, y0, bw, bh); g.filter = 'none'; }
  g.restore();
}

// ================================================================ the plat: drawn in ink, line by line, on the plate's own sepia
const paper = (() => {                                                     // a sheet of the plate's paper: sepia cream with fibre and a soft edge
  const c = cv(W, H), g = c.getContext('2d'), id = g.createImageData(W, H), d = id.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, n = (hsh(x, y, 1) - 0.5) * 10 + (vn1(x * 0.02 + y * 0.003) - 0.5) * 14 + (vn1(y * 0.6 + x * 0.001) - 0.5) * 5;
    const e = Math.min(x, W - x, y, H - y) / 260, v = clamp(e) * 0.12 + 0.88;
    d[i] = (204 + n) * v; d[i + 1] = (180 + n) * v; d[i + 2] = (140 + n * 0.8) * v; d[i + 3] = 255;
  }
  g.putImageData(id, 0, 0); return c;
})();
const INK = 'rgba(42,26,14,0.92)';
function plat(g, x0, y0, w, h, sec) {
  g.save(); g.beginPath(); g.rect(x0, y0, w, h); g.clip();
  const P = (u, v) => [x0 + u * w, y0 + v * h];
  g.strokeStyle = INK; g.lineCap = 'round'; g.lineJoin = 'round';
  const stroke = (pts, t0, dur, lw = 2.2, alpha = 1) => {                  // a pen line that draws itself between t0 and t0 + dur (a little wobble: a hand, not a plotter)
    const p = clamp((sec - t0) / dur); if (p <= 0) return;
    let L = 0; const segs = []; for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(d); L += d; }
    let rem = ease.outCubic(p) * L; g.lineWidth = lw * 2.0; g.globalAlpha = alpha; g.beginPath(); g.moveTo(...pts[0]);
    for (let i = 1; i < pts.length && rem > 0; i++) { const d = segs[i - 1], k = Math.min(1, rem / d); g.lineTo(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k + (hsh(i, t0) - 0.5) * 1.5, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k + (hsh(i, t0, 2) - 0.5) * 1.5); rem -= d; }
    g.stroke(); g.globalAlpha = 1;
  };
  stroke([P(0, 0.1), P(0.15, 0.08), P(0.3, 0.115), P(0.5, 0.09), P(0.7, 0.12), P(0.85, 0.085), P(1, 0.1)], 0.0, 1.0, 2.6);
  stroke([P(0.27, 0.1), P(0.27, 0.34), P(0.34, 0.34), P(0.34, 0.1)], 0.3, 0.8);
  stroke([P(0.1, 0.17), P(0.9, 0.17), P(0.9, 0.38), P(0.1, 0.38), P(0.1, 0.17)], 0.5, 1.1, 2.6);
  stroke([P(0, 0.47), P(0.2, 0.44), P(0.45, 0.48), P(0.7, 0.45), P(1, 0.49)], 0.9, 0.9, 2.6, 0.9);
  stroke([P(0.5, 0.38), P(0.5, 1)], 1.1, 0.8, 3.4); stroke([P(0.535, 0.38), P(0.535, 1)], 1.15, 0.8, 1.4);
  for (let i = 0; i < 6; i++) { const v = 0.56 + i * 0.085; stroke([P(0.08, v), P(0.92, v)], 1.3 + i * 0.12, 0.7, i === 1 ? 3 : 1.6, 0.9); }
  for (let j = 0; j < 14; j++) { const u = 0.08 + j * 0.06; if (Math.abs(u - 0.5) < 0.02 || Math.abs(u - 0.535) < 0.02) continue; stroke([P(u, 0.56), P(u, 0.99)], 1.9 + (j % 5) * 0.08, 0.6, 1.1, 0.7); }
  const hp = clamp((sec - 1.5) / 1.2); if (hp > 0) { g.globalAlpha = 0.45; g.lineWidth = 1.3; g.beginPath(); for (let i = 0; i < 40 * hp; i++) { const u = 0.1 + i * 0.02; g.moveTo(...P(u, 0.38)); g.lineTo(...P(Math.min(0.9, u + 0.06), 0.17)); } g.stroke(); g.globalAlpha = 1; }
  g.fillStyle = INK; g.font = 'italic 900 34px Playfair'; g.textAlign = 'center';
  const tx = (s, u, v, a) => { g.globalAlpha = clamp(a); g.fillText(s, ...P(u, v)); g.globalAlpha = 1; };
  tx('Lake Michigan', 0.5, 0.045, (sec - 0.6) / 0.4); tx('Gary Works', 0.5, 0.285, (sec - 1.7) / 0.4); tx('Broadway', 0.5, 0.53, (sec - 2.1) / 0.4);
  g.restore();
}

// ================================================================ the shot list
const SHOTS = [];
const shotAt = (beat) => { let r = SHOTS[0]; for (const s of SHOTS) if (beat >= s.b0) r = s; return r; };
const shot = (b0, name, fn) => SHOTS.push({ b0, name, fn });

// ---------------------------------------------------------------- b0-16: faces lit by a furnace we are not shown (kept from v11-v16)
shot(0, 'manL', (s) => {
  faceShot(packs.pal_man_l, s.t, s.lt, { len: 4 * SPB, c0: [0.5, 0.52], c1: [0.5, 0.47], z0: 1.04, z1: 1.26, reason: 'a push the eye cannot help following',
    light: [-0.3, 0.3], scr: [-0.15, 0.3], fire: (t, lt) => (0.8 + 0.5 * smooth(0, 4, lt / SPB)) * furn(t, 1) });
});
shot(4, 'peep', async (s) => {
  const i = 1 + Math.floor(s.lt * 24), im = await seqFrame('shov', 's', i, 60), u = clamp(s.lt / (4 * SPB));
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  if (im) filmCrop(ctx, im, { fx: 300 + 25 * u, fy: 215, sc: 4.0 + 0.5 * u, lutName: 'iron', key: 'peep', dx: (hsh(s.t * 30) - 0.5) * 5, dy: (hsh(s.t * 30, 1) - 0.5) * 5, glowK: 0.12, gamma: 1.5, gain: 0.95 });
  glow(ctx, W * 0.82, H * 0.38, 800, '255,110,30', 0.22 * Math.min(1.6, furn(s.t, 2)));
  darken(ctx, W * 0.45, H * 0.4, 300, 1250, 0.55);
});
shot(8, 'manR', (s) => {
  faceShot(packs.pal_man_r, s.t, s.lt, { len: 8 * SPB, c0: [0.58, 0.5], c1: [0.58, 0.46], z0: 1.12, z1: 1.3, reason: 'a slow settle into the lit face',
    light: [-0.3, 0.28], scr: [-0.15, 0.28], fire: (t, lt) => { const b = 8 + lt / SPB; return (0.6 + 1.0 * smooth(8, 8.4, b) - 0.35 * smooth(10, 16, b)) * furn(t, 4); } });
});

// ---------------------------------------------------------------- b16: the intertitle (the one place card)
shot(16, 'title', (s) => {
  const g = ctx, a = clamp(s.lt / 0.25), o = (Math.sin(s.t * 31) * 0.5 + 0.5) * 0.03;
  g.fillStyle = '#0d0a08'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#e8dcc0'; g.lineWidth = 6; g.globalAlpha = a; g.strokeRect(70, 590, W - 140, 740); g.lineWidth = 2; g.strokeRect(92, 612, W - 184, 696); g.globalAlpha = 1;
  g.fillStyle = '#e8dcc0'; g.globalAlpha = a * (0.97 - o); g.font = '900 190px Playfair'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillText('GARY,', W / 2, 920); g.fillText('1906.', W / 2, 1130); g.globalAlpha = 1;
});

// ---------------------------------------------------------------- b19.5-32: the plan drawn in ink becomes the built works (two segments joined by the turn)
function drawPano(g, name, s, { yc = 900, ph = 1500, u0 = 0, u1 = 0.5, ua = 0, ub = 1, lutName = 'sepia', gain = 1.0, gamma = 1.0, warm = 0 }) {
  const im = img[name]; if (!im) return; const c = tonedOnce(name, lutName, { gain, gamma });
  const k = ph / im.height, vw = W / k, u = lerp(u0, u1, smooth(ua, ub, s.b)), sx = clamp(u * im.width, 0, im.width - vw), y = yc - ph / 2;
  g.drawImage(c, sx, 0, vw, im.height, 0, y, W, ph);
  feather(g, y - 20, y + 110, 1, 0); feather(g, y + ph - 110, y + ph + 20, 0, 1);
  if (warm > 0) { g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = `rgba(255,${230 - 40 * warm | 0},${200 - 90 * warm | 0},1)`; g.fillRect(0, y, W, ph); g.restore(); }
}
const platC = cv(W, H), platG = platC.getContext('2d');
const PLAT = { x: 40, y: 330, w: 1000, h: 1280 };
const PH0 = { k: 0.94, ox: -529, oy: 454 };                                  // the plate at the scale where its works sit under the drawn mill block
shot(19.5, 'plat', (s) => {
  const g = ctx, b = s.b, e = smooth(23.2, 25.4, b), sec = s.lt * 1.45;
  const sheetA = 1 - smooth(23.3, 24.8, b);
  g.fillStyle = '#0d0a08'; g.fillRect(0, 0, W, H);
  if (sheetA > 0.01) { g.save(); g.globalAlpha = sheetA * smooth(19.5, 19.9, b); g.drawImage(paper, 0, 0); g.restore(); }
  const im = img.apr1908;
  if (e > 0 && im) {
    const k1 = 1640 / im.height, u = lerp(0, 0.5, smooth(19.5, 28, b)), x1 = -clamp(u * im.width, 0, im.width - W / k1) * k1, y1 = 900 - 820;
    const z = ease.inOutCubic(clamp((b - 23.6) / 1.8)), k = Math.exp(lerp(Math.log(PH0.k), Math.log(k1), z));
    const ox = lerp(PH0.ox, x1, z), oy = lerp(PH0.oy, y1, z);
    const c = tonedOnce('apr1908', 'sepia', { gain: 1, gamma: 1 });
    // the photograph comes up THROUGH the paper (multiplied into it first, so the drawn mill sits on the real mills), then takes the frame
    g.save(); g.globalAlpha = smooth(23.2, 24.4, b); g.globalCompositeOperation = sheetA > 0.5 ? 'multiply' : 'source-over'; g.drawImage(c, ox, oy, im.width * k, im.height * k); g.restore();
    const fa = 1 - sheetA, fy = oy, fh = im.height * k;                    // as the paper goes, the dark closes round the plate's own edges
    if (fa > 0.01) { g.fillStyle = `rgba(13,10,8,${fa})`; g.fillRect(0, 0, W, Math.max(0, fy)); g.fillRect(0, fy + fh, W, H); feather(g, fy, fy + 110, fa, 0); feather(g, fy + fh - 110, fy + fh, 0, fa); }
  }
  const lineA = 1 - smooth(24.0, 25.4, b);
  if (lineA > 0.01) { platG.clearRect(0, 0, W, H); plat(platG, PLAT.x, PLAT.y, PLAT.w, PLAT.h, sec); g.save(); g.globalAlpha = lineA; g.drawImage(platC, 0, 0); g.restore(); }
  // a lamp over the drawing table, the same warm light as the faces
  glow(g, W * 0.3, H * 0.25, 1100, '255,150,70', 0.10 * sheetA);
  darken(g, W * 0.45, H * 0.45, 500, 1400, 0.45 * sheetA);
});
shot(25.4, 'ironA', (s) => drawPano(ctx, 'apr1908', s, { yc: 900, ph: 1640, ua: 19.5, ub: 28, u0: 0.0, u1: 0.5, warm: 0.25 }));
shot(28, 'ironB', (s) => {
  const g = ctx, k = smooth(28, 28.8, s.b);
  g.save(); g.globalAlpha = 1 - k; drawPano(g, 'apr1908', s, { yc: 900, ph: 1640, ua: 19.5, ub: 28, u0: 0.0, u1: 0.5, warm: 0.4 }); g.restore();
  g.save(); g.globalAlpha = k; drawPano(g, 'plant1910', s, { yc: 960, ph: 1640, u0: 0.55, u1: 0.83, ua: 28, ub: 32, gain: 0.95, gamma: 1.1, warm: 0.5 }); g.restore();
  glow(g, W * 0.5, 900, 900, '255,120,40', 0.08 * k);
});

// ---------------------------------------------------------------- b32-42: the works let go (the same plate keeps panning while its light goes cold and out)
shot(32, 'letgo', (s) => {
  const g = ctx, b = s.b, cold = smooth(32, 41.5, b);
  drawPano(g, 'plant1910', s, { yc: 960, ph: lerp(1640, 1760, smooth(32, 42, b)), u0: 0.83, u1: 0.865, ua: 32, ub: 42, gain: 0.95, gamma: 1.1, warm: 0.5 * (1 - cold) });
  // the heat leaves: the plate desaturates to a cold grey and sinks toward black from its edges
  g.save(); g.globalCompositeOperation = 'saturation'; g.globalAlpha = 0.85 * cold; g.fillStyle = '#808080'; g.fillRect(0, 0, W, H); g.restore();
  g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = `rgba(${lerp(255, 150, cold) | 0},${lerp(255, 160, cold) | 0},${lerp(255, 178, cold) | 0},1)`; g.fillRect(0, 0, W, H); g.restore();
  darken(g, W / 2, 900, lerp(900, 260, cold), lerp(1600, 980, cold), 0.4 + 0.5 * cold);
  if (b > 40.8) { g.fillStyle = `rgba(0,0,0,${0.75 * smooth(40.8, 42, b)})`; g.fillRect(0, 0, W, H); }
});

// ---------------------------------------------------------------- b42-54: the class drawn back (Gary, 1919: the strike, in its own photographs)
// A photograph with depth by rows: the camera dollies in, the near rows (the bottom of the frame) grow faster than the far ones,
// so a crowd opens up around the lens. Toned to the faces' ember stock and lit by the same furnace, getting hotter as it goes.
function photo(g, name, s, { c0, c1, z0, z1, depth = 0.12, heat = 1, light = [0.3, 0.9], u = null }) {
  const im = img[name]; if (!im) return;
  const src = tonedOnce(name, 'ember', { gain: 1.0, gamma: 1.05 }), q = u ?? 0;
  const e = ease.inOutCubic(q), z = Math.exp(lerp(Math.log(z0), Math.log(z1), e)), k = (H / im.height) * z, ROW = 4;
  const cx = lerp(c0[0], c1[0], e) * im.width, cy = clamp(lerp(c0[1], c1[1], e) * im.height, H / 2 / k, im.height - H / 2 / k);
  g.fillStyle = '#060302'; g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += ROW) {
    const near = (y / H) ** 1.6, kk = k * (1 + depth * near * e);           // nearer rows magnify more as the camera comes in
    const sy = cy + (y + ROW / 2 - H / 2) / k, sw = W / kk, sx = clamp(cx - sw / 2, 0, im.width - sw);
    if (sy < 0 || sy > im.height) continue;
    g.drawImage(src, sx, clamp(sy, 0, im.height - ROW / k), sw, ROW / k, 0, y, W, ROW);
  }
  const fire = heat * furn(s.t, 7);
  const lx = light[0] * W, ly = light[1] * H;
  darken(g, lx, ly, 260, 1500, 0.72 - 0.25 * Math.min(1, fire));
  glow(g, lx, ly + 300, 1000, '255,110,30', 0.12 * fire);
}
const STRIKE = [
  // the dock: men in work clothes shoulder to shoulder, listening; the camera walks in among them
  { b: 42, name: 'dock', c0: [0.47, 0.6], c1: [0.53, 0.5], z0: 1.06, z1: 1.32, depth: 0.16, light: [0.25, 0.95] },
  // Gary: the faces turned up to the speaker; the camera starts among the faces and rises to his raised hand and the whole crowd
  { b: 45.5, name: 'gary_crowd', c0: [0.8, 0.84], c1: [0.47, 0.55], z0: 2.3, z1: 1.04, depth: -0.1, light: [0.7, 0.85] },
  // the pickets: a hat thrown up
  { b: 49.5, name: 'pickets', c0: [0.6, 0.46], c1: [0.62, 0.4], z0: 1.25, z1: 1.45, depth: 0.08, light: [0.6, 0.6] },
  // a striker at his work: the long bar into the puddling furnace (the bar the bow is drawn with)
  { b: 51.5, name: 'puddler', c0: [0.6, 0.5], c1: [0.4, 0.74], z0: 1.3, z1: 1.55, depth: 0.1, light: [0.08, 0.8] },
];
STRIKE.forEach((p, i) => {
  const end = (STRIKE[i + 1] || { b: 54 }).b;
  shot(p.b, 'strike_' + p.name, (s) => {
    const heat = 0.55 + 0.85 * smooth(42, 54, s.b) + 0.5 * smooth(52.5, 54, s.b) * (p.name === 'puddler' ? 1 : 0);
    photo(ctx, p.name, s, { ...p, heat, u: clamp((s.b - p.b) / (end - p.b)) });
    const jolt = Math.exp(-s.lt * 10);                                       // each cut lands with the film's own small kick of light
    if (jolt > 0.02) { ctx.fillStyle = `rgba(255,214,170,${0.08 * jolt})`; ctx.fillRect(0, 0, W, H); }
  });
});

// ---------------------------------------------------------------- b54-68: the bowstring is a body drawn back (the bar man at the furnace door)
const BAR = { n: 126, top: 26, from: 3 }, REL = 64.0;
shot(54, 'held', async (s) => {
  const b = s.b, g = ctx;
  let fi, push = 0, light = 1;
  if (b < 56.2) fi = BAR.from + (BAR.top - BAR.from) * ease.outCubic((b - 54) / 2.2);
  else if (b < REL) { const hb = (b - 56.2) / (REL - 56.2); fi = BAR.top + (hsh(Math.floor(s.t * 7)) < 0.35 * (1 - hb) ? 1 : 0); push = hb; light = 0.82 + 0.5 * hb; }
  else fi = BAR.top + (s.t - B.time(REL)) * 30;
  const im = await seqFrame('bar', 'b', fi, BAR.n); g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const held = b >= 56.2 && b < REL, run = b >= REL;
  const tight = held ? 3.6 + 1.0 * ease.inCubic(clamp((b - 56.2) / (REL - 56.2))) : (run ? 4.4 : 3.6);
  const pan = run ? 140 + 190 * smooth(0, 2.2, s.t - B.time(REL)) : 140;
  const wx = held ? (hsh(s.t * 24) - 0.5) * 6 * (1 + push) : 0, wy = held ? (hsh(s.t * 24, 3) - 0.5) * 6 * (1 + push) : 0;
  if (im) filmCrop(g, im, { fx: pan, fy: 240, sc: tight, lutName: 'iron', key: 'bar', dx: wx, dy: wy, glowK: held ? 0.2 + 0.2 * push : 0.35, gain: Math.min(1, light), gamma: 1.0 });
  const kick = run ? Math.exp(-(s.t - B.time(REL)) * 7) : 0;
  if (kick > 0.02) { g.fillStyle = `rgba(255,236,200,${0.28 * kick})`; g.fillRect(0, 0, W, H); }
  glow(g, W * 0.6, H * 0.55, 800, '255,120,36', 0.08 + 0.22 * (held ? push : 0) + 0.15 * kick);
  darken(g, W * 0.5, H * 0.5, 380, 1300, held ? 0.42 + 0.3 * (1 - push) : 0.3);
});

// ---------------------------------------------------------------- b68-80: the dam gives (the pour over the men, the spill, the run, the country)
const CLIPS = { a: { n: 82, f0: 5 }, f: { n: 120, f0: 1 } };
function floodShot(k) {
  return async (s) => {
    const C0 = CLIPS[k], i = Math.floor(s.lt * 30) + C0.f0, im = await clipFrame(k, i, C0.n);
    const jolt = Math.exp(-s.lt * 9) * (hsh(s.t * 31) - 0.5) * 38, fl = flick(s.t, 3);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (im) band(ctx, im, { cx: 0.5, cy: 0.5, scale: 2.5, y: 800, lutName: 'iron', gain: 1.0 * fl, gamma: 0.95, glowK: 0.35, shake: jolt, key: 'fl' + k });
    feather(ctx, 150, 330, 1, 0); feather(ctx, 1300, 1480, 0, 1);
    glow(ctx, W / 2, 800, 900, '255,90,20', 0.10);
  };
}
const MAPN = 306;
async function mapShot(s, mi, { sc = 1.72, fy = 250, fx = 320, gain = 1, glowK = 0.18, shake = 0 } = {}) {
  const im = await seqFrame('map', 'm', mi, MAPN); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  if (im) filmCrop(ctx, im, { fx, fy, sc, lutName: 'iron', key: 'map' + gain, dx: shake, dy: -40, glowK, gain, gamma: 1.05 });
}
shot(68, 'pour', async (s) => {
  const mi = 22 + s.lt * 30 * 0.92, jolt = Math.exp(-s.lt * 8) * (hsh(s.t * 31) - 0.5) * 30;
  await mapShot(s, mi, { sc: 2.5, fy: 222, shake: jolt, glowK: 0.22 });
  feather(ctx, 120, 420, 1, 0);
});
shot(74.6, 'spill', floodShot('f')); shot(76.2, 'run', floodShot('a'));
shot(77.8, 'form', async (s) => {
  const u = clamp(s.lt / (2.2 * SPB)), mi = 135 + (230 - 135) * ease.inOutCubic(u);
  await mapShot(s, mi, { sc: lerp(2.5, 1.72, ease.inOutCubic(u)), fy: 250, gain: 1 + 0.15 * u, shake: Math.exp(-s.lt * 6) * (hsh(s.t * 31) - 0.5) * 30 });
});

// ---------------------------------------------------------------- b80-end: OUR STEEL., then the steel is TEMPERED on screen
// The white metal of the country cools through steel's own temper colours as a front: the thin edges first (the coasts, the Gulf),
// the heart last. The emblem rises out of the metal (no press, no ring), cools a step behind the field, and ends as blue steel on dark
// steel. The film's men keep walking at the lens under the pour and pass out of the frame into the dark. Last frame: the dark tempered
// country with the emblem in it and a small lockup; it holds.
const TEMPER = [[255, 249, 236], [250, 226, 150], [222, 160, 74], [170, 92, 52], [122, 64, 128], [70, 96, 190], [40, 62, 120], [22, 28, 40]];
const tAt = [0, 0.14, 0.3, 0.44, 0.58, 0.72, 0.86, 1];
function temper(x) {
  x = clamp(x); let i = 0; while (i < tAt.length - 2 && x > tAt[i + 1]) i++;
  const u = clamp((x - tAt[i]) / (tAt[i + 1] - tAt[i])); return TEMPER[i].map((v, j) => v + (TEMPER[i + 1][j] - v) * u);
}
const TLUT = new Uint8ClampedArray(256 * 3); for (let i = 0; i < 256; i++) { const c = temper(i / 255); TLUT[i * 3] = c[0]; TLUT[i * 3 + 1] = c[1]; TLUT[i * 3 + 2] = c[2]; }
const WK = { w: W / 2, h: H / 2 }, wk = cv(WK.w, WK.h), wg = wk.getContext('2d', { willReadFrequently: true });
// a smooth field over the steel (the temper runs unevenly, in soft tongues, never in blocks)
const NZW = WK.w >> 2, NZH = WK.h >> 2, nz = new Float32Array(NZW * NZH);
for (let y = 0; y < NZH; y++) for (let x = 0; x < NZW; x++) nz[y * NZW + x] = 0.55 * vn1(x * 0.07 + y * 0.031 + 3.1) + 0.45 * vn1(y * 0.09 - x * 0.023 + 17.3);
const emC = cv(W, H), emG = emC.getContext('2d');
const EM = { x: W / 2, y: 600, r: 300 };
const coolAt = (b) => smooth(80.8, 99.5, b);                              // the field's temper clock
function tempered(im, s, { sc, fy, T }) {
  // the film drawn grey at half size, then every pixel recoloured: the metal by its local temper, the rest by the cooling room
  wg.setTransform(0.5, 0, 0, 0.5, 0, 0); wg.fillStyle = '#000'; wg.fillRect(0, 0, W, H);
  if (im) filmCrop(wg, im, { fx: 320, fy, sc, lutName: 'silver', key: 'tmp', dy: -40, gain: 1.12, gamma: 1.05 });
  wg.setTransform(1, 0, 0, 1, 0, 0);
  const id = wg.getImageData(0, 0, WK.w, WK.h), d = id.data;
  const cx = WK.w * 0.5, cy = WK.h * 0.4, rn = 1 / (WK.w * 0.62);
  const room = [lerp(120, 26, T), lerp(70, 30, T), lerp(48, 40, T)];          // what is not metal: the hall, warm while the pour is hot, cold after
  for (let y = 0, i = 0; y < WK.h; y++) for (let x = 0; x < WK.w; x++, i += 4) {
    const L = d[i] / 255, m = clamp((L - 0.6) / 0.28), mm = m * m * (3 - 2 * m);
    const dd = Math.hypot(x - cx, (y - cy) * 1.4) * rn;
    const loc = clamp(T * 1.08 - 0.16 + 0.32 * (dd - 0.55) + (nz[(y >> 2) * NZW + (x >> 2)] - 0.5) * 0.08, 0, 0.9);
    const ti = (loc * 255) | 0, sh = 0.72 + 0.28 * L;
    const r = TLUT[ti * 3] * sh, gg = TLUT[ti * 3 + 1] * sh, bb = TLUT[ti * 3 + 2] * sh;
    const rl = L * room[0] * 1.6, gl = L * room[1] * 1.6, bl = L * room[2] * 1.6;
    d[i] = rl + (r - rl) * mm; d[i + 1] = gl + (gg - gl) * mm; d[i + 2] = bl + (bb - bl) * mm;
  }
  wg.putImageData(id, 0, 0);
  ctx.save(); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(wk, 0, 0, W, H); ctx.restore();
  // heat still in the metal: a bloom that dies with the straw
  if (T < 0.45) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35 * (1 - T / 0.45); ctx.filter = 'blur(28px)'; ctx.drawImage(wk, 0, 0, W, H); ctx.filter = 'none'; ctx.restore(); }
}
function emblem(b, t, T) {
  const e = smooth(80.4, 82.6, b); if (e <= 0) return;
  const Ec = clamp(0.1 + T * 0.62), c = temper(Ec).map(Math.round);
  const set = ease.inOutCubic(smooth(95.5, 100.5, b));
  emG.clearRect(0, 0, W, H); acpEmblem(emG, EM.x, lerp(EM.y, 840, set) + 26 * (1 - e), lerp(EM.r, 330, set), { color: `rgb(${c})` });
  // a glancing light moves across the steel (slowly; once in the end's hold)
  const sw = lerp(-500, W + 500, smooth(92, 106, b));
  emG.save(); emG.globalCompositeOperation = 'source-atop';
  const gr = emG.createLinearGradient(sw - 260, 0, sw + 260, 200); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(235,240,255,${0.32 * smooth(88, 96, b)})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
  emG.fillStyle = gr; emG.fillRect(0, 0, W, H);
  emG.fillStyle = `rgba(0,0,0,${0.2 * (1 - e)})`; emG.fillRect(0, 0, W, H); emG.restore();
  ctx.save(); ctx.globalAlpha = e;
  ctx.filter = e < 1 ? `blur(${(10 * (1 - e)).toFixed(1)}px)` : 'none'; ctx.drawImage(emC, 0, 0); ctx.filter = 'none';
  if (T < 0.5) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.45 * e * (1 - T / 0.5); ctx.filter = 'blur(24px)'; ctx.drawImage(emC, 0, 0); ctx.filter = 'none'; }
  ctx.restore();
}
shot(80, 'temper', async (s) => {
  const b = s.b, T = coolAt(b);
  const run = clamp((s.t - B.time(80)) * 30 * 0.55), mi = Math.min(MAPN, 230 + (s.t - B.time(80)) * 30 * 0.55);
  const im = await seqFrame('map', 'm', mi, MAPN);
  const push = ease.inOutCubic(smooth(84, 100, b));
  tempered(im, s, { sc: lerp(1.72, 1.95, push), fy: lerp(250, 232, push), T });
  // the men walk on toward us and out of the frame into the dark below the steel
  const gone = smooth(85, 92, b);
  if (gone > 0) { feather(ctx, 1080, 1420, 0, gone); ctx.fillStyle = `rgba(0,0,0,${gone})`; ctx.fillRect(0, 1420, W, H - 1420); }
  feather(ctx, 0, 380, 0.9, 0);
  emblem(b, s.t, T);
  // OUR STEEL. sits on the white metal, cut dark into it
  const oa = ease.outCubic(clamp((b - 80.6) / 0.6)) * (1 - smooth(86.0, 86.8, b));
  if (oa > 0) { const g = ctx; g.save(); g.globalAlpha = oa; g.font = `900 ${fitSize(g, ['OUR STEEL.'], 210, 900)}px Playfair`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillStyle = 'rgba(255,240,214,0.5)'; g.fillText('OUR STEEL.', W / 2 + 3, 1065); g.fillStyle = '#17100c'; g.fillText('OUR STEEL.', W / 2, 1060); g.restore(); }
  // the lockup, small, once the steel is dark
  const la = smooth(101, 102.2, b);
  if (la > 0) drawLockup(ctx, W / 2, 1540, 96, { color: '#e6dccb', alpha: la * 0.92 });
});

// ================================================================ the words (the Chairman's own sentences, at their own length)
const CARDS = [
  [0.3, 7.6, ['WITHIN OUR', 'CONSCIOUSNESS,'], { y: 1580, size: 128 }],
  [8.2, 15.6, ['THE IRON', 'IS HOT.'], { y: 1580, size: 160 }],
  ...(TAKE === 'a' ? [
    [32.6, 37.0, ['THE MUNDANE,', 'EVERYDAY, HABITUAL', 'REALITY ... HAS BECOME', 'UNAVOIDABLY DECREPIT', 'AND ROTTEN.'], { y: 1700, size: 92 }],
    [37.4, 41.6, ['IT CAN NO LONGER', 'SURVIVE THROUGH', 'INERTIA ALONE.'], { y: 1700, size: 108 }],
  ] : []),
  [42.4, 47.6, ['THE DECISIVE THING', 'IS NOT WHEN', 'THE BOWSTRING', 'IS DRAWN BACK.'], { y: 1720, size: 108 }],
  [48.0, 53.7, ['THAT IS WHERE', 'THE TENSION', 'MATURATES;'], { y: 1720, size: 124 }],
  [56.6, 62.4, ['IT ACQUIRES', 'COMPLETION ONLY', 'UPON RELEASE.'], { y: 330, size: 98 }],
  [64.8, 69.8, ['WHEN THE NOW', 'ROTTING DAM', 'FINALLY BREAKS,'], { y: 1790, size: 104 }],
  [70.2, 74.2, ['A NEW WORLD', 'WILL FLOOD', 'THE OLD'], { y: 1790, size: 112 }],
  [74.6, 80, ['ABRUPTLY.', 'SUDDENLY.', 'CATASTROPHICALLY.'], { y: 1790, size: 104, stack: [74.6, 76.2, 77.8] }],
  [87.2, 95.2, ['TO DISCOVER', 'HOW THE STEEL', 'IS TEMPERED.'], { y: 1600, size: 118, slow: true }],
];
function cards(b) {
  for (const [b0, b1, lines, o] of CARDS) {
    if (b < b0 || b >= b1) continue;
    const age = (b - b0) * SPB, inT = o.slow ? 0.9 : 0.3, a = ease.outCubic(age / inT) * (1 - smooth(b1 - (o.slow ? 1.2 : 0.5), b1, b)), size = o.size || 120;
    const sz = fitSize(ctx, lines, size);
    const ls = o.stack ? lines.filter((_, i) => b >= o.stack[i]) : lines;
    if (!ls.length) continue;
    setLines(ctx, ls, { ...o, size: sz, y: (o.y || 1500) + (1 - ease.outCubic(age / inT)) * 16, alpha: a });
  }
}

// ================================================================ render
window.renderFrame = async (t) => {
  const b = B.beat(t) + 1e-4, frame = Math.round(t * 30);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const s = shotAt(b);
  await s.fn({ t, b, lt: t - B.time(s.b0), lb: b - s.b0 });
  cards(b);
  finish.apply(ctx, frame, { grain: 0.06, vignette: 0.35 });
};

for (const n of ['pal_man_l', 'pal_man_r']) await pack(n);
for (const n of ['apr1908', 'plant1910']) await image(n, `${BASE}pan/${n}.jpg`);
for (const n of ['dock', 'gary_crowd', 'pickets', 'puddler']) await image(n, `${BASE20}${n}.jpg`);
window.sceneReady = true;
