// THE IRON IS HOT (v12, cycle 14; v11 header follows): scripts_final/frontier.json, song audio/songs2/frontier_c13.py (96 BPM, standalone score).
// The argument is the Chairman's (POSTMAGA ch. 1, 2, 9) at its own length; the picture is real people and real ground:
// Alfred T. Palmer's steelworkers (OWI, 1940-41, LoC masters, cut and lit as living photographs), the Indiana Steel Co.
// panoramas of Gary Works (LoC, 1908-10), Steel: A Symphony of Industry (Audio Productions, 1936, Prelinger PD).
// Everything that moves in a photograph moves by its own depth; the heat is light on those faces, never a caption.
// Held frame (the bowstring) and the four-plate print are this piece's own passes (frontier3.post.js: Burn, Poster).
import { W, H, C, loadFonts, loadBeats, loadImage, clamp, lerp, ease, rng, Finish, sigil, acpEmblem } from '../lib/kit.js';
import { drawMark, drawLockup, paperCanvas, inkStamp } from '../lib/closer.js';
import { LivingPhoto, path } from '../lib/fx/living_photo.js';
import { Burn, Poster } from './frontier3.post.js';

const out = document.getElementById('out'); out.width = W; out.height = H;
const ctx = out.getContext('2d');
await loadFonts();
// a sober face for the Chairman's sentences (no glow): Playfair Display Black
{ const f = new FontFace('Playfair', 'url(../node_modules/@fontsource/playfair-display/files/playfair-display-latin-900-normal.woff)'); document.fonts.add(await f.load()); }
const B = await loadBeats('frontier3');
const SPB = B.spb;
const finish = new Finish(1906);
const burn = new Burn(W, H), poster = new Poster(W, H);
const BASE = '/web/assets/iron13/';

// ================================================================ pictures
const packs = {};
async function pack(name) { try { packs[name] ??= await LivingPhoto.load(name, { base: BASE }); } catch (e) { console.warn('f3 pack missing', name); packs[name] = null; } return packs[name]; }
const img = {};
async function image(name, src) { try { img[name] = await loadImage(src); } catch (e) { console.warn('f3 missing', src); img[name] = null; } return img[name]; }
const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const hsh = (x, y = 0, s = 0) => { const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };
const vn1 = (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hsh(i, 0, 5) * (1 - u) + hsh(i + 1, 0, 5) * u; };
// a furnace mouth's light: irregular, never a ramp (slow draught, quick tremor, and now and then a flare)
const furn = (t, s = 0) => 0.58 + 0.46 * vn1(t * 4.7 + s * 9) + 0.22 * vn1(t * 19 + s * 3) + 1.1 * Math.pow(vn1(t * 1.15 + s * 5), 7);
const flick = (t, s = 0) => 0.86 + 0.14 * (0.5 * Math.sin(t * 13.1 + s) + 0.3 * Math.sin(t * 29.7 + s * 2.1) + 0.2 * Math.sin(t * 47.3 + s * 3.7));

// ================================================================ type
// The Chairman's sentences: Playfair Black in cream, short measured lines, a soft shadow that holds the letters on the picture (no glow).
// y = baseline of the LAST line.
function setLines(g, lines, { x = W / 2, y = 1500, size = 118, lh = 1.08, align = 'center', color = '#f4e6d0', shadow = 0.6, alpha = 1, red = null, track = 0 } = {}) {
  g.save(); g.font = `900 ${size}px Playfair`; g.textAlign = align; g.textBaseline = 'alphabetic'; g.globalAlpha = alpha;
  if ('letterSpacing' in g) g.letterSpacing = `${track}px`;
  const n = lines.length, y0 = y - (n - 1) * size * lh;
  lines.forEach((s, i) => {
    const yy = y0 + i * size * lh;
    g.shadowColor = `rgba(8,4,2,${shadow})`; g.shadowBlur = size * 0.4; g.shadowOffsetY = size * 0.05;
    g.fillStyle = red && red.includes(i) ? '#e8352d' : color; g.fillText(s, x, yy);
    g.shadowBlur = 0; g.shadowOffsetY = 0;
  });
  g.restore();
}
const fitSize = (g, lines, size, maxW = 960) => { g.save(); g.font = `900 ${size}px Playfair`; const w = Math.max(...lines.map(s => g.measureText(s).width)); g.restore(); return w > maxW ? size * maxW / w : size; };

// ================================================================ light helpers
const AMBER = [[0.012, 0.003, 0.002], [0.52, 0.12, 0.02], [1.0, 0.47, 0.19]];
function darken(g, x, y, r0, r1, a = 1) {                                  // a pool of light: clear inside r0, black beyond r1
  const gr = g.createRadialGradient(x, y, r0, x, y, r1); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${a})`);
  g.save(); g.fillStyle = gr; g.fillRect(0, 0, W, H); g.restore();
}
function glow(g, x, y, r, rgb, a) {                                        // additive warm light on the frame
  const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(1, `rgba(${rgb},0)`);
  g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = gr; g.fillRect(0, 0, W, H); g.restore();
}

// ---------------------------------------------------------------- the faces: lit by a furnace we do not see
function faceShot(P, t, lt, o) {
  const u = clamp(lt / o.len);
  const cam = path([{ t: 0, cx: o.c0[0], cy: o.c0[1], zoom: o.z0, push: 0.02, px: -0.004 }, { t: 1, cx: o.c1[0], cy: o.c1[1], zoom: o.z1, push: 0.05, px: 0.004 }], { reason: o.reason })(u);
  const fire = o.fire(t, lt);
  P.draw(ctx, t, { cam, look: { ramp: AMBER, keep: 0, contrast: 1.7, pivot: 0.52, sat: 1, warmth: 0, halation: 0.3, vignette: 0.15, grain: 0.05, lift: 0 },
    lights: [{ x: o.light[0], y: o.light[1], z: 0.35, radius: 0.5, color: [1, 0.34, 0.08], w: 1.5 * fire }, { x: o.light[0], y: o.light[1] + 0.2, z: 0.2, radius: 0.9, color: [1, 0.22, 0.04], w: 0.6 * fire }], seed: Math.floor(t * 24) });
  const sx = o.scr[0] * W, sy = o.scr[1] * H;
  darken(ctx, sx, sy, 160, 1150, 0.82 - 0.2 * Math.min(1, fire));
  glow(ctx, sx, sy, 900, '255,110,30', 0.10 * fire);
  ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = 'rgb(255,208,176)'; ctx.fillRect(0, 0, W, H); ctx.restore();   // keep the skin ember-red, not olive
  return cam;
}

// ================================================================ toned film: a LUT turns a grey picture into a stock
function lut(stops) {                                                      // stops: [[pos 0..1, [r,g,b]]...] -> 256x3
  const L = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) { const x = i / 255; let k = 0; while (k < stops.length - 2 && x > stops[k + 1][0]) k++;
    const [p0, c0] = stops[k], [p1, c1] = stops[k + 1], u = clamp((x - p0) / (p1 - p0)); for (let j = 0; j < 3; j++) L[i * 3 + j] = c0[j] + (c1[j] - c0[j]) * u; }
  return L;
}
const LUTS = {
  sepia: lut([[0, [10, 8, 6]], [0.45, [118, 96, 70]], [0.8, [214, 192, 156]], [1, [250, 242, 224]]]),
  silver: lut([[0, [8, 8, 9]], [0.5, [128, 126, 122]], [1, [246, 244, 238]]]),
  fire: lut([[0, [8, 2, 1]], [0.32, [96, 18, 6]], [0.62, [226, 84, 22]], [0.86, [255, 190, 110]], [1, [255, 246, 226]]]),
  iron: lut([[0, [5, 3, 3]], [0.28, [58, 28, 18]], [0.55, [168, 98, 60]], [0.78, [236, 176, 120]], [0.92, [255, 232, 196]], [1, [255, 252, 244]]]),
  ironcool: lut([[0, [4, 4, 6]], [0.3, [52, 40, 38]], [0.6, [150, 118, 96]], [0.85, [232, 210, 180]], [1, [255, 250, 240]]]),
  blue: lut([[0, [3, 6, 12]], [0.5, [60, 88, 130]], [1, [214, 228, 244]]]),
};
const scratch = {};
function toned(src, name, key, { gain = 1, gamma = 1, sx = 0, sy = 0, sw = null, sh = null } = {}) {        // draws a grey source through a LUT onto a cached scratch canvas
  sw = sw ?? src.width; sh = sh ?? src.height;
  const k = key + sw + 'x' + sh; let c = scratch[k];
  if (!c) c = scratch[k] = cv(sw, sh);
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  const id = g.getImageData(0, 0, sw, sh), d = id.data, L = LUTS[name];
  for (let i = 0; i < d.length; i += 4) { let v = Math.pow(clamp(d[i] / 255 * gain), gamma) * 255 | 0; d[i] = L[v * 3]; d[i + 1] = L[v * 3 + 1]; d[i + 2] = L[v * 3 + 2]; }
  g.putImageData(id, 0, 0); return c;
}
const tonedCache = {};
function tonedOnce(name, lutName, opts) { return tonedCache[name + lutName] ??= toned(img[name], lutName, name + lutName, opts); }

// ================================================================ the film frames (Steel: A Symphony of Industry, 1936)
const frames = {};
const seqs = {};                                                            // c14: windows cut from the original MPEG-2 (bar, map, shov): iron13/<dir>/<p>_NNN.jpg, 30 fps
async function seqFrame(dir, p, i, n) { i = Math.max(1, Math.min(n, Math.round(i))); const key = dir + i; if (!(key in seqs)) seqs[key] = await loadImage(`${BASE}${dir}/${p}_${String(i).padStart(3, '0')}.jpg`).catch(() => null); return seqs[key]; }
// a 4:3 film frame cropped tall: (fx, fy) in source px land at the screen's centre, sc = screen px per source px (4 = fills the 1920 height)
function filmCrop(g, im, { fx = 320, fy = 240, sc = 4, lutName = 'iron', key = 'fc', dx = 0, dy = 0, gain = 1, gamma = 1, glowK = 0 } = {}) {
  const c = toned(im, lutName, key, { gain, gamma }), x0 = W / 2 - fx * sc + dx, y0 = H / 2 - fy * sc + dy;
  g.drawImage(c, x0, y0, c.width * sc, c.height * sc);
  if (glowK) { g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = glowK; g.filter = 'blur(30px)'; g.drawImage(c, x0, y0, c.width * sc, c.height * sc); g.filter = 'none'; g.restore(); }
}
async function clipFrame(k, i, n) { i = Math.max(1, Math.min(n, i)); const key = k + i; if (!(key in frames)) frames[key] = await loadImage(`${BASE}sym/${k}_${String(i).padStart(3, '0')}.jpg`).catch(() => null); return frames[key]; }
function band(g, im, { cx = 0.5, cy = 0.5, scale = 2.4, y = 860, lutName = 'fire', gain = 1, gamma = 1, glowK = 0.35, shake = 0, key = 'f' } = {}) {
  const c = toned(im, lutName, key, { gain, gamma });
  const bw = c.width * scale, bh = c.height * scale, x0 = W / 2 - cx * bw + shake, y0 = y - cy * bh;
  g.save(); g.drawImage(c, x0, y0, bw, bh);
  if (glowK) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = glowK; g.filter = 'blur(26px)'; g.drawImage(c, x0, y0, bw, bh); g.filter = 'none'; }
  g.restore();
  return [x0, y0, bw, bh];
}
function feather(g, y0, y1, a0 = 1, a1 = 1) {                              // black ground fading into the picture above/below a band
  const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, `rgba(0,0,0,${a0})`); gr.addColorStop(1, `rgba(0,0,0,${a1})`);
  g.fillStyle = gr; g.fillRect(0, Math.min(y0, y1), W, Math.abs(y1 - y0));
}

// ================================================================ split flaps (a board in the gate office)
function flapCell(g, x, y, w, h, prev, ch, u, { face = '#171310', ink = '#efe3cb', fs = 0.9, font = 'Anton' } = {}) {
  const half = h / 2, m = y + half;
  const draw = (c, top, sy) => {
    g.save(); g.beginPath(); g.rect(x, top ? y : m, w, half); g.clip();
    g.translate(x + w / 2, m); g.scale(1, sy); g.translate(-(x + w / 2), -m);
    const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, '#201a15'); gr.addColorStop(0.5, '#15110e'); gr.addColorStop(1, '#1b1612');
    g.fillStyle = gr; g.fillRect(x, y, w, h);
    if (c !== ' ') { g.fillStyle = ink; g.font = `${h * fs}px ${font}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText(c, x + w / 2, y + h * 0.5 + h * fs * 0.36); }
    g.restore();
  };
  g.save(); g.beginPath(); g.roundRect(x, y, w, h, 7); g.clip();
  draw(u >= 1 ? ch : prev, false, 1); draw(u > 0 ? ch : prev, true, 1);
  if (u > 0 && u < 1) {
    if (u < 0.5) { const k = Math.cos(u * Math.PI); draw(prev, true, k); g.fillStyle = `rgba(0,0,0,${0.5 * (1 - k)})`; g.fillRect(x, m - half * k, w, half * k); }
    else { const k = -Math.cos(u * Math.PI); draw(ch, false, k); g.fillStyle = `rgba(0,0,0,${0.5 * (1 - k)})`; g.fillRect(x, m, w, half * k); }
  }
  g.fillStyle = '#000'; g.fillRect(x, m - 2, w, 4); g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(x, m + 2, w, 1);
  g.restore();
}
const CYC = '0123456789 ';
// a digit that rolls from a to b through the cycle: progress p 0..1 (staggered by the caller) -> {prev, ch, u}
function roll(a, b, p, laps = 0) {
  const ia = CYC.indexOf(a), ib = CYC.indexOf(b), n = ((ib - ia + 11) % 11) + laps * 11;
  const f = clamp(p) * n, k = Math.min(n - 1, Math.floor(f)); if (n === 0) return { prev: b, ch: b, u: 1 };
  return { prev: CYC[(ia + k) % 11], ch: CYC[(ia + k + 1) % 11], u: p >= 1 ? 1 : f - k };
}

// ================================================================ the plat (drawn, line by line, as a survey sheet)
function plat(g, x0, y0, w, h, sec) {
  g.save(); g.beginPath(); g.rect(x0, y0, w, h); g.clip();
  const P = (u, v) => [x0 + u * w, y0 + v * h];
  g.strokeStyle = 'rgba(210,228,240,0.9)'; g.lineCap = 'round'; g.lineJoin = 'round';
  const stroke = (pts, t0, dur, lw = 2.2, alpha = 1) => {                  // a polyline that draws itself between t0 and t0 + dur
    const p = clamp((sec - t0) / dur); if (p <= 0) return;
    let L = 0; const segs = []; for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(d); L += d; }
    let rem = ease.outCubic(p) * L; g.lineWidth = lw; g.globalAlpha = alpha; g.beginPath(); g.moveTo(...pts[0]);
    for (let i = 1; i < pts.length && rem > 0; i++) { const d = segs[i - 1], k = Math.min(1, rem / d); g.lineTo(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k); rem -= d; }
    g.stroke(); g.globalAlpha = 1;
  };
  // the lake shore, the harbour slip and the mill's ground, the river moved south, Broadway and the avenues, then the lots
  stroke([P(0, 0.1), P(0.15, 0.08), P(0.3, 0.115), P(0.5, 0.09), P(0.7, 0.12), P(0.85, 0.085), P(1, 0.1)], 0.0, 1.0, 2.6);
  stroke([P(0.27, 0.1), P(0.27, 0.34), P(0.34, 0.34), P(0.34, 0.1)], 0.3, 0.8);
  stroke([P(0.1, 0.17), P(0.9, 0.17), P(0.9, 0.38), P(0.1, 0.38), P(0.1, 0.17)], 0.5, 1.1, 2.6);
  stroke([P(0, 0.47), P(0.2, 0.44), P(0.45, 0.48), P(0.7, 0.45), P(1, 0.49)], 0.9, 0.9, 2.6, 0.9);
  stroke([P(0.5, 0.38), P(0.5, 1)], 1.1, 0.8, 3.4); stroke([P(0.535, 0.38), P(0.535, 1)], 1.15, 0.8, 1.4);
  for (let i = 0; i < 6; i++) { const v = 0.56 + i * 0.085; stroke([P(0.08, v), P(0.92, v)], 1.3 + i * 0.12, 0.7, i === 1 ? 3 : 1.6, 0.9); }
  for (let j = 0; j < 14; j++) { const u = 0.08 + j * 0.06; if (Math.abs(u - 0.5) < 0.02 || Math.abs(u - 0.535) < 0.02) continue; stroke([P(u, 0.56), P(u, 0.99)], 1.9 + (j % 5) * 0.08, 0.6, 1.1, 0.7); }
  // mill hatching fills in after the outline
  const hp = clamp((sec - 1.5) / 1.2); if (hp > 0) { g.globalAlpha = 0.5; g.lineWidth = 1.2; g.beginPath(); for (let i = 0; i < 40 * hp; i++) { const u = 0.1 + i * 0.02; g.moveTo(...P(u, 0.38)); g.lineTo(...P(Math.min(0.9, u + 0.06), 0.17)); } g.stroke(); g.globalAlpha = 1; }
  // lettering on the sheet: plain survey capitals
  g.fillStyle = 'rgba(210,228,240,0.85)'; g.font = '30px "Plex Mono"'; g.textAlign = 'center';
  const tx = (s, u, v, a) => { g.globalAlpha = clamp(a); g.fillText(s, ...P(u, v)); g.globalAlpha = 1; };
  tx('LAKE MICHIGAN', 0.5, 0.045, (sec - 0.6) / 0.4); tx('GARY WORKS', 0.5, 0.285, (sec - 1.7) / 0.4); tx('BROADWAY', 0.5, 0.53, (sec - 2.1) / 0.4);
  g.restore();
}

// ================================================================ the shot list
const SHOTS = [];
const shotAt = (beat) => { let r = SHOTS[0]; for (const s of SHOTS) if (beat >= s.b0) r = s; return r; };
const shot = (b0, name, fn) => SHOTS.push({ b0, name, fn });
const FIRE = (b0, b1, base, peak) => (t, lt) => { const b = b0 + lt / SPB; return (base + (peak - base) * smooth(b0, b1, b)) * flick(t, b0); };

// ---------------------------------------------------------------- b0-16: faces lit by a furnace we are not shown (three faces in ten seconds; the light is already moving at frame 0)
const place = (g, text, a) => { if (a <= 0.01) return; g.save(); g.globalAlpha = a * 0.8; g.fillStyle = '#e9d9bd'; g.font = '26px "Plex Mono"'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; if ('letterSpacing' in g) g.letterSpacing = '5px'; g.shadowColor = 'rgba(0,0,0,0.8)'; g.shadowBlur = 8; g.fillText(text, 64, 1846); g.restore(); };
shot(0, 'manL', (s) => {
  faceShot(packs.pal_man_l, s.t, s.lt, { len: 4 * SPB, c0: [0.5, 0.52], c1: [0.5, 0.47], z0: 1.04, z1: 1.26, reason: 'a push the eye cannot help following',
    light: [-0.3, 0.3], scr: [-0.15, 0.3], fire: (t, lt) => (0.8 + 0.5 * smooth(0, 4, lt / SPB)) * furn(t, 1) });
  place(ctx, 'BRACKENRIDGE, PA. 1941.', smooth(0.4, 0.9, s.lt) * (1 - smooth(2.1, 2.5, s.lt)));
});
// the film's own man, looking through a blue glass into a furnace we are not shown (Steel: A Symphony of Industry, 1936)
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
  place(ctx, 'BRACKENRIDGE, PA. 1941.', smooth(0.6, 1.1, s.lt) * (1 - smooth(3.4, 3.9, s.lt)));
});

// ---------------------------------------------------------------- b16: the intertitle
shot(16, 'title', (s) => {
  const g = ctx, a = clamp(s.lt / 0.25), o = (Math.sin(s.t * 31) * 0.5 + 0.5) * 0.03;
  g.fillStyle = '#0d0a08'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#e8dcc0'; g.lineWidth = 6; g.globalAlpha = a; g.strokeRect(70, 590, W - 140, 740); g.lineWidth = 2; g.strokeRect(92, 612, W - 184, 696); g.globalAlpha = 1;
  g.fillStyle = '#e8dcc0'; g.globalAlpha = a * (0.97 - o); g.font = '900 190px Playfair'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillText('GARY,', W / 2, 920); g.fillText('1906.', W / 2, 1130); g.globalAlpha = 1;
});

// ---------------------------------------------------------------- b19.5-32: sand to iron (the plates fill the frame and pan across their full height)
const DATES = [[19.5, '1906'], [24.4, '1908'], [28, '1910']];                              // the plates' own years (April 1908; the plant in 1910)
function dateTab(g, x, y, cw, ch, b, fixed = null) {                        // a year on flaps that turns over at its beat
  let prev = DATES[0][1], cur = DATES[0][1], u = 1;
  if (fixed) { prev = cur = fixed; }
  else for (let i = 0; i < DATES.length; i++) if (b >= DATES[i][0]) { cur = DATES[i][1]; prev = i ? DATES[i - 1][1] : ' '.repeat(4); u = clamp((b - DATES[i][0]) / 0.9); }
  for (let k = 0; k < 4; k++) flapCell(g, x + k * (cw + 6), y, cw, ch, prev[k], cur[k], clamp(u * 1.8 - k * 0.12));
}
// a plate at one scale across the whole frame: its full height is scaled to ph px (centred at yc), u = the left edge (0..1 of its width) over the shot
function drawPano(g, name, s, { yc = 900, ph = 1500, u0 = 0, u1 = 0.5, ua = 0, ub = 1, lutName = 'sepia', gain = 1.0, gamma = 1.0, warm = 0 }) {
  const im = img[name]; if (!im) return; const c = tonedOnce(name, lutName, { gain, gamma });
  const k = ph / im.height, vw = W / k, u = lerp(u0, u1, smooth(ua, ub, s.b)), sx = clamp(u * im.width, 0, im.width - vw), y = yc - ph / 2;
  g.drawImage(c, sx, 0, vw, im.height, 0, y, W, ph);
  // the plate's own edge fades into the dark, above and below
  feather(g, y - 20, y + 110, 1, 0); feather(g, y + ph - 110, y + ph + 20, 0, 1);
  if (warm > 0) { g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = `rgba(255,${230 - 40 * warm | 0},${200 - 90 * warm | 0},1)`; g.fillRect(0, y, W, ph); g.restore(); }
}
// c14 (client: two related segments, not an overlay): the plat on its own, full frame, drawing the works as DESIGNED; then the drawing TURNS INTO the photograph:
// the photograph first lies under the drawing registered to it (the drawn mill block is the real mills), the navy sheet and then the lines let go, and the camera rises into the plate.
const platC = cv(W, H), platG = platC.getContext('2d');
const PLAT = { x: 40, y: 330, w: 1000, h: 1280 };
const PH0 = { k: 0.94, ox: -529, oy: 454 };                                  // the plate at the scale where its works block sits under the drawn mill block
function platShot(s) {
  const g = ctx, b = s.b, e = smooth(23.2, 25.4, b), sec = s.lt * 1.45;
  // the plate: from the registered small state to the full-frame pan
  const im = img.apr1908;
  if (e > 0 && im) {
    const k1 = 1640 / im.height, u = lerp(0, 0.5, smooth(19.5, 28, b)), x1 = -clamp(u * im.width, 0, im.width - W / k1) * k1, y1 = 900 - 820;
    const z = ease.inOutCubic(clamp((b - 23.6) / 1.8)), k = Math.exp(lerp(Math.log(PH0.k), Math.log(k1), z));
    const ox = lerp(PH0.ox, x1, z), oy = lerp(PH0.oy, y1, z);
    const c = tonedOnce('apr1908', 'sepia', { gain: 1, gamma: 1 });
    g.save(); g.globalAlpha = smooth(23.2, 24.4, b); g.drawImage(c, ox, oy, im.width * k, im.height * k);
    g.restore();
    const fy = oy, fh = im.height * k;                                       // the plate's own edges fade into the dark
    feather(g, fy - 20, fy + 110, 1, 0); feather(g, fy + fh - 110, fy + fh + 20, 0, 1);
  }
  // the sheet (navy) lets go as the photograph arrives; the drawn lines linger over it, then go
  const sheetA = 1 - smooth(23.3, 24.6, b), lineA = 1 - smooth(24.0, 25.4, b);
  if (sheetA > 0.01) { g.fillStyle = `rgba(12,21,34,${sheetA})`; g.fillRect(PLAT.x, PLAT.y, PLAT.w, PLAT.h); }
  if (lineA > 0.01) {
    platG.clearRect(0, 0, W, H); plat(platG, PLAT.x, PLAT.y, PLAT.w, PLAT.h, sec);
    g.save(); g.globalAlpha = lineA; g.drawImage(platC, 0, 0); g.restore();
    if (e > 0.02) { g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.35 * lineA * smooth(23.2, 24.0, b); g.filter = 'blur(6px)'; g.drawImage(platC, 0, 0); g.filter = 'none'; g.restore(); }
  }
  dateTab(g, 74, 190, 62, 92, b);
}
shot(19.5, 'plat', platShot);
shot(25.4, 'ironA', (s) => {
  const g = ctx; drawPano(g, 'apr1908', s, { yc: 900, ph: 1640, ua: 19.5, ub: 28, u0: 0.0, u1: 0.5, warm: 0.25 }); dateTab(g, 74, 210, 62, 92, s.b);
});
shot(28, 'ironB', (s) => {
  const g = ctx, k = smooth(28, 28.8, s.b);
  g.save(); g.globalAlpha = 1 - k; drawPano(g, 'apr1908', s, { yc: 900, ph: 1640, ua: 19.5, ub: 28, u0: 0.0, u1: 0.5, warm: 0.4 }); g.restore();
  g.save(); g.globalAlpha = k; drawPano(g, 'plant1910', s, { yc: 900, ph: 1500, u0: 0.52, u1: 0.8, ua: 28, ub: 32, gain: 0.95, gamma: 1.1, warm: 0.5 }); g.restore();
  dateTab(g, 74, 210, 62, 92, s.b);
});

// ---------------------------------------------------------------- b32-44: the roll at the gate
const BOARD = { y0: 32 };
function boardShot(s) {
  const g = ctx, b = s.b, t = s.t;
  g.fillStyle = '#0a0b0d'; g.fillRect(0, 0, W, H);
  const wall = g.createLinearGradient(0, 0, 0, H); wall.addColorStop(0, '#16181b'); wall.addColorStop(1, '#0b0c0e'); g.fillStyle = wall; g.fillRect(0, 0, W, H);
  // plank wall
  g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 3; for (let x = 0; x < W; x += 135) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  // the enamel board with its screws
  const bx = 40, by = 440, bw = 1000, bh = 1010;
  g.fillStyle = '#050607'; g.fillRect(bx - 14, by - 14, bw + 28, bh + 28);
  g.fillStyle = '#10110f'; g.fillRect(bx, by, bw, bh);
  g.strokeStyle = '#7d6a45'; g.lineWidth = 3; g.strokeRect(bx + 14, by + 14, bw - 28, bh - 28);
  for (const [x, y] of [[bx + 34, by + 34], [bx + bw - 34, by + 34], [bx + 34, by + bh - 34], [bx + bw - 34, by + bh - 34]]) { g.fillStyle = '#4d4638'; g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill(); }
  g.fillStyle = '#b9a272'; g.font = '34px "Plex Mono"'; g.textAlign = 'center'; if ('letterSpacing' in g) g.letterSpacing = '8px';
  g.fillText('GARY WORKS', W / 2, by + 100); g.fillText('ON THE ROLL', W / 2, by + bh - 70);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  // the years (four flaps) and the count (five flaps): ONE value that only falls (30,000 in 1970; 6,000 in 1990; 5,100 in 2015: gary_history.md);
  // every flap turns only when its own digit changes, and the number is never higher than the one before
  const FL = 14, bq = Math.floor(t * FL) / FL;                              // the flaps' clock
  const countAt = (bb) => bb < 36.4 ? 30000 : bb < 38.6 ? 30000 - 24000 * ease.inOutCubic(clamp((bb - 36.4) / 2.2)) : bb < 40.0 ? 6000 : 6000 - 900 * ease.outCubic(clamp((bb - 40.0) / 1.3));
  const yearAt = (bb) => bb < 36.4 ? 1970 : bb < 40.0 ? 1990 : 2015;
  const bOf = (tt) => B.beat(tt) + 1e-4;
  const cellOf = (str, i, bb0, bb1) => { const A = str(bb0)[i], Bv = str(bb1)[i]; return { prev: A, ch: Bv }; };
  const cs = (bb) => String(Math.round(countAt(bb))).padStart(5, ' '), ys = (bb) => String(yearAt(bb));
  const frac = t * FL - Math.floor(t * FL);
  const yc = 4, cw = 128, ch = 190, gap = 10, yw = yc * cw + (yc - 1) * gap, yx = W / 2 - yw / 2, yy = by + 170;
  for (let i = 0; i < 4; i++) {
    const intro = clamp((b - 32.2 - i * 0.14) / 0.8);
    let r;
    if (b < 33.0) r = intro <= 0 ? { prev: ' ', ch: ' ', u: 1 } : { prev: ' ', ch: '1970'[i], u: intro };
    else { const c = cellOf(ys, i, bOf(bq - 1 / FL), bOf(bq)); r = { ...c, u: c.prev === c.ch ? 1 : clamp(frac * 1.4) }; }
    flapCell(g, yx + i * (cw + gap), yy, cw, ch, r.prev, r.ch, r.u, { fs: 0.88 });
  }
  const dw = 150, dh = 290, dg = 10, cmw = 56, nw = 5 * dw + 5 * dg + cmw, nx = W / 2 - nw / 2, ny = yy + ch + 80;
  const cells = [0, 1, 'c', 2, 3, 4];
  let x = nx;
  for (const c of cells) {
    if (c === 'c') { flapCell(g, x, ny, cmw, dh, ',', ',', 1, { fs: 0.7 }); x += cmw + dg; continue; }
    const i = c;
    let r;
    if (b < 34.0) { const intro = clamp((b - 32.6 - i * 0.16) / 1.0); r = intro <= 0 ? { prev: ' ', ch: ' ', u: 1 } : { prev: ' ', ch: '30000'[i], u: intro }; }
    else { const cc = cellOf(cs, i, bOf(bq - 1 / FL), bOf(bq)); r = { ...cc, u: cc.prev === cc.ch ? 1 : clamp(frac * 1.4) }; }
    flapCell(g, x, ny, dw, dh, r.prev, r.ch, r.u, { fs: 0.9 });
    x += dw + dg;
  }
  // after the last flap falls the lamp goes down
  const dim = smooth(42.0, 43.8, b); g.fillStyle = `rgba(0,0,0,${0.9 * dim})`; g.fillRect(0, 0, W, H);
  // the lamp over the board: a shade on its cord, a cone of light, a slow sway
  const sw = Math.sin(t * 0.8) * 7 + Math.sin(t * 2.3) * 2, lf = flick(t, 5) * (1 - dim);
  g.save(); g.strokeStyle = '#2a2824'; g.lineWidth = 4; g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2 + sw, 190); g.stroke();
  const cone = g.createLinearGradient(0, 220, 0, by + 260); cone.addColorStop(0, `rgba(255,214,150,${0.22 * lf})`); cone.addColorStop(1, 'rgba(255,214,150,0)');
  g.fillStyle = cone; g.beginPath(); g.moveTo(W / 2 + sw - 46, 215); g.lineTo(W / 2 + sw + 46, 215); g.lineTo(W - 20, by + 280); g.lineTo(20, by + 280); g.closePath(); g.fill();
  g.fillStyle = '#1b1a18'; g.beginPath(); g.moveTo(W / 2 + sw - 70, 215); g.lineTo(W / 2 + sw + 70, 215); g.lineTo(W / 2 + sw + 36, 160); g.lineTo(W / 2 + sw - 36, 160); g.closePath(); g.fill();
  glow(g, W / 2 + sw, 222, 260, '255,200,120', 0.55 * lf); g.restore();
  darken(g, W / 2, by + bh * 0.45, 420, 1500, 0.6);
}
shot(32, 'board', boardShot);

// ---------------------------------------------------------------- b44-56: the bowstring is a body drawn back (Steel: A Symphony of Industry, 1936: a man at the furnace door)
// the film runs up to the top of the draw (frame TOP), sticks in the gate for the sentence (the light breathes, the frame creeps, the heart beats),
// and on the release it RUNS: the bar goes in and the jet of iron crosses the floor. His act opens the flood.
const BAR = { n: 126, top: 26, from: 3 };
const HEART = (b) => { const k = (b - 48.5) % 1; return b < 48.5 ? 0 : Math.exp(-k * 9) * (0.3 + 0.25 * smooth(48.5, 55.5, b)); };   // the heart on the beat, harder as it nears
shot(44, 'held', async (s) => {
  const b = s.b, g = ctx, rel = 56.0;
  let fi, push, light = 1;
  if (b < 46.2) { fi = BAR.from + (BAR.top - BAR.from) * ease.outCubic((b - 44) / 2.2); push = 0; }                        // the draw: he leans back, slowing as he nears the top
  else if (b < rel) {                                                                                                // the held frame: only the reel's own breath
    const hb = (b - 46.2) / (rel - 46.2); fi = BAR.top + (hsh(Math.floor(s.t * 7)) < 0.35 * (1 - hb) ? 1 : 0); push = hb; light = 0.82 + 0.5 * hb;
  } else { fi = BAR.top + (s.t - rel * SPB) * 30; push = 1; }
  const im = await seqFrame('bar', 'b', fi, BAR.n); g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const held = b >= 46.2 && b < rel, run = b >= rel;
  const hb = HEART(b), tight = held ? 3.6 + 1.0 * ease.inCubic(clamp((b - 46.2) / (rel - 46.2))) : (run ? 4.4 : 3.6);
  const pan = run ? 140 + 190 * smooth(0, 2.2, s.t - rel * SPB) : 140;
  const wx = held ? (hsh(s.t * 24) - 0.5) * 6 * (1 + push) : 0, wy = held ? (hsh(s.t * 24, 3) - 0.5) * 6 * (1 + push) + hb * 8 : 0;
  if (im) filmCrop(g, im, { fx: pan, fy: 240, sc: tight + hb * 0.04, lutName: 'iron', key: 'bar', dx: wx, dy: wy, glowK: held ? 0.2 + 0.2 * push : 0.35, gain: Math.min(1, light), gamma: 1.0 });
  const kick = run ? Math.exp(-(s.t - rel * SPB) * 7) : 0;                                                          // the blow lands: the frame is struck
  if (kick > 0.02) { g.fillStyle = `rgba(255,236,200,${0.28 * kick})`; g.fillRect(0, 0, W, H); }
  glow(g, W * 0.6, H * 0.55, 800, '255,120,36', 0.08 + 0.22 * (held ? push : 0) + 0.15 * kick);
  darken(g, W * 0.5, H * 0.5, 380, 1300, held ? 0.42 + 0.3 * (1 - push) : 0.3);
});

// ---------------------------------------------------------------- b56-72: the dam gives (the iron runs, then pours over the men, then takes the shape of the country)
const CLIPS = { a: { n: 82, f0: 5, b0: 56 }, e: { n: 105, f0: 1, b0: 60.6 }, f: { n: 120, f0: 1, b0: 66 } };
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
// the pour and the map: Steel's last shot (the iron poured into the outline of the country, the men walking toward us beneath it). Toned so that ONLY the metal is white.
const MAPN = 306;
async function mapShot(s, mi, { sc = 1.72, fy = 250, fx = 320, gain = 1, glowK = 0.18, shake = 0 } = {}) {
  const im = await seqFrame('map', 'm', mi, MAPN); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  if (im) { const y0 = H / 2 - fy * sc; filmCrop(ctx, im, { fx, fy, sc, lutName: 'iron', key: 'map' + gain, dx: shake, dy: -40, glowK, gain, gamma: 1.05 }); }
}
shot(60, 'pour', async (s) => {                                            // b60-66.6: the pot tips over the men walking at us
  const mi = 22 + (s.t - 60 * SPB) * 30 * 0.92, jolt = Math.exp(-s.lt * 8) * (hsh(s.t * 31) - 0.5) * 30;
  await mapShot(s, mi, { sc: 2.5, fy: 222, shake: jolt, glowK: 0.22 });
  feather(ctx, 120, 420, 1, 0);
});
shot(66.6, 'spill', floodShot('f')); shot(68.2, 'run', floodShot('a'));
shot(69.8, 'form', async (s) => {                                          // b69.8-72: the iron takes the shape of the country (the film runs fast: the dam gives)
  const u = clamp((s.t - 69.8 * SPB) / (2.2 * SPB)), mi = 135 + (230 - 135) * ease.inOutCubic(u);
  await mapShot(s, mi, { sc: lerp(2.5, 1.72, ease.inOutCubic(u)), fy: 250, gain: 1 + 0.15 * u, shake: Math.exp(-s.lt * 6) * (hsh(s.t * 31) - 0.5) * 30 });
});
// b72-76: OUR STEEL. on the iron itself. The metal cools through steel's own temper colours (straw, bronze, purple, blue) into the print's blue.
const TEMPER = [[255, 248, 232], [246, 214, 128], [212, 136, 62], [128, 72, 150], [64, 110, 200]];
const lerpC = (a, c, u) => a.map((v, i) => v + (c[i] - v) * u);
function temper(x) { const k = clamp(x) * (TEMPER.length - 1), i = Math.min(TEMPER.length - 2, Math.floor(k)); return lerpC(TEMPER[i], TEMPER[i + 1], k - i); }
shot(72, 'steel', async (s) => {
  const lt = s.lt, mi = 230 + Math.min(55, lt * 30 * 0.7), cool = smooth(0.35, 2.4, lt);
  await mapShot(s, mi, { sc: 1.72, fy: 250, gain: 1.15, glowK: 0.1 * (1 - cool) });
  const g = ctx, c = temper(cool);
  g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = `rgb(${c.map(Math.round)})`; g.fillRect(0, 0, W, H); g.restore();
  // the die: the emblem is struck once into the metal (cut dark, a lit rim below it), then the words
  const k = ease.outCubic(clamp(lt / 0.16)), press = lerp(1.25, 1, k), ex = W / 2, ey = 560, er = 300 * press, hot = lerpC(c, [255, 250, 235], 0.55 * Math.exp(-lt * 2.2));
  g.save(); g.globalAlpha = k;                                              // the die's own piece of metal: it cools through the same temper colours as the map
  g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.5 * k * (1 - cool * 0.6); g.filter = 'blur(28px)'; acpEmblem(g, ex, ey, er, { color: `rgb(${hot.map(Math.round)})` }); g.filter = 'none'; g.restore();
  acpEmblem(g, ex, ey, er, { color: `rgb(${hot.map(Math.round)})` }); g.restore();
  { const ta = ease.outCubic(clamp((lt - 0.12) / 0.2)); g.save(); g.globalAlpha = ta; g.font = `900 ${fitSize(g, ['OUR STEEL.'], 210, 900)}px Playfair`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillStyle = 'rgba(255,240,214,0.5)'; g.fillText('OUR STEEL.', W / 2 + 3, 1060 + 5); g.fillStyle = '#17100c'; g.fillText('OUR STEEL.', W / 2, 1060); g.restore(); }
  const ring = Math.exp(-lt * 5); if (ring > 0.02) { g.save(); g.strokeStyle = `rgba(255,236,200,${0.7 * ring})`; g.lineWidth = 8; g.beginPath(); g.arc(ex, ey, 180 + lt * 1100, 0, 7); g.stroke(); g.restore(); }
  const sp = Math.exp(-lt * 3.2); for (let i = 0; i < 46; i++) { const a = hsh(i, 1) * 6.28, v = 300 + 900 * hsh(i, 2), x = ex + Math.cos(a) * v * lt * 0.8, y = ey + Math.sin(a) * v * lt * 0.8 + 900 * lt * lt * 0.5; g.fillStyle = `rgba(255,${200 + 40 * hsh(i, 3) | 0},120,${sp})`; g.fillRect(x, y, 4, 4 + 8 * hsh(i, 4)); }
});

// ---------------------------------------------------------------- b72-96: 2036, a four-plate print
const srcP = cv(W, H), sg = srcP.getContext('2d', { willReadFrequently: false });
const figs = {};
async function figure(name) { return figs[name] ??= await loadImage(`${BASE}cut/${name}.png`).catch(() => null); }
const PRINT_LUT = lut([[0, [8, 6, 6]], [0.12, [40, 12, 10]], [0.3, [170, 42, 28]], [0.55, [238, 124, 72]], [0.74, [255, 226, 190]], [1, [255, 246, 232]]]);
function figTone(im, key) {                                                // the figure through the warm print LUT: black, red, cream; levels stretched per figure (c14: the two-man cut-outs were solid red)
  if (tonedCache[key]) return tonedCache[key];
  const c = cv(im.width, im.height), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
  const id = g.getImageData(0, 0, c.width, c.height), d = id.data, hist = new Uint32Array(256); let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { hist[(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) | 0]++; n++; }
  const pct = (q) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= q * n) return v; } return 255; };
  const lo = pct(0.04), hi = pct(0.985), md = pct(0.5), span = Math.max(30, hi - lo), gam = Math.log(0.52) / Math.log(clamp((md - lo) / span, 0.05, 0.95));
  for (let i = 0; i < d.length; i += 4) { const L = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]); const v = Math.min(255, Math.pow(clamp((L - lo) / span), gam) * 250) | 0; d[i] = PRINT_LUT[v * 3]; d[i + 1] = PRINT_LUT[v * 3 + 1]; d[i + 2] = PRINT_LUT[v * 3 + 2]; }
  g.putImageData(id, 0, 0); return tonedCache[key] = c;
}
function printGround(g, { sun = [540, 800], r = 520, rays = 20, rot = 0 } = {}) {
  g.fillStyle = 'rgb(66,118,178)'; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgb(252,243,228)'; g.beginPath(); g.arc(sun[0], sun[1], r, 0, 7); g.fill();
  g.fillStyle = 'rgb(252,243,228)';
  for (let i = 0; i < rays; i++) { const a0 = rot + i * 2 * Math.PI / rays, a1 = a0 + Math.PI / rays * 0.55; g.beginPath(); g.moveTo(sun[0], sun[1]); g.arc(sun[0], sun[1], 1800, a0, a1); g.closePath(); g.fill(); }
  // the works on the horizon: the 1910 plant as a blue-black silhouette band
  if (img.plant1910) { const c = tonedOnce('plant1910', 'blue', { gain: 0.95, gamma: 1.3 }); const k = 330 / c.height; g.drawImage(c, 700, 0, c.width * 0.22, c.height, 0, 1160 - 330, W, 330); }
  g.fillStyle = 'rgb(16,12,10)'; g.fillRect(0, 1160, W, H - 1160);
}
function printFig(g, name, { x = W / 2, foot = H + 40, h = 1380, flip = false, key = name } = {}) {
  const im = figs[name]; if (!im) return; const c = figTone(im, 'ft' + name), k = h / c.height, w = c.width * k;
  g.save(); g.translate(x, 0); g.drawImage(c, -w / 2, foot - h, w, h); g.restore();
}
function inkText(g, lines, { y = 250, size = 128, lh = 1.06, fill = '#efe3c8', slab = '#15110e', x = W / 2, alpha = 1, scale = 1, rot = -0.025 } = {}) {
  g.save(); g.globalAlpha = alpha; g.font = `900 ${size}px Playfair`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  const bh = (lines.length - 1) * size * lh + size * 1.35, y0 = y - size * 0.98;
  g.translate(x, y0 + bh / 2); g.rotate(rot); g.scale(scale, scale);
  if (slab) { g.fillStyle = slab; g.fillRect(-W, -bh / 2, W * 2, bh); }                // the type rides on a black slab, as the ink does on a poster
  lines.forEach((s, i) => { const yy = -bh / 2 + size * 0.98 + i * size * lh; g.fillStyle = fill; g.fillText(s, 0, yy); });
  g.restore();
}
const PRINT_CUTS = [{ b: 76, name: 'pal_man_l', x: 560, h: 1330 }, { b: 78.6, name: 'pal_tap', x: 540, h: 1050 }, { b: 81.2, name: 'pal_shovel', x: 540, h: 1050 }, { b: 83.8, name: 'pal_man_r', x: 520, h: 1330 }];
function posterFrame(s, since, hits, body) {
  sg.clearRect(0, 0, W, H); body(sg);
  const misreg = 1.5 + 7 * (1 - Math.exp(-since * 2.2));
  ctx.drawImage(poster.apply(srcP, { t: s.t, misreg, cuts: [0.8, 0.46, 0.2], seed: 3 + Math.floor(s.b) }), 0, 0);
}
const photoC = cv(W, H);
shot(76, 'faces', (s) => {
  let cut = PRINT_CUTS[0]; for (const c of PRINT_CUTS) if (s.b >= c.b) cut = c;
  const lt = (s.b - cut.b) * SPB, sway = Math.sin(lt * 0.9) * 6;
  // the first print is the first photograph: the man of b0 is still a photograph for the first beat, and the four plates take him
  const first = cut === PRINT_CUTS[0], pu = first ? smooth(0.0, 1.35, lt) : 1;
  if (first && pu < 0.999) {
    faceShot(packs.pal_man_l, s.t, 4 * SPB + lt * 0.5, { len: 4 * SPB, c0: [0.5, 0.52], c1: [0.5, 0.47], z0: 1.04, z1: 1.26, light: [-0.3, 0.3], scr: [-0.15, 0.3], fire: (t) => 1.1 * furn(t, 1) });
    photoC.getContext('2d').clearRect(0, 0, W, H); photoC.getContext('2d').drawImage(out, 0, 0);
  }
  posterFrame(s, lt, 0, (g) => { printGround(g, { sun: [540, 760], r: 470, rot: lt * 0.05 }); printFig(g, cut.name, { x: cut.x + sway, h: cut.h * (1 + lt * 0.012) });
    if (first && pu < 0.999) { g.save(); g.globalAlpha = 1 - pu; g.filter = 'brightness(2.2) contrast(1.15)'; g.drawImage(photoC, 0, 0); g.filter = 'none'; g.restore(); } });
});
shot(86, 'works', (s) => {
  const lt = s.lt;
  posterFrame(s, lt, 0, (g) => {
    printGround(g, { sun: [540, 900], r: 560, rays: 24, rot: 0.1 });
    const row = [['pal_shovel', 300, 680], ['pal_tap', 790, 680], ['pal_man_l', 175, 900], ['pal_man_r', 880, 920], ['pal_swing', 540, 1060]];
    row.forEach(([n, x, h], i) => printFig(g, n, { x: x + Math.sin(lt * 0.7 + i) * 4, h, foot: 1920 + 30 }));
  });
});
// the stamp: the emblem is struck on paper, the stripes pulse in, the wordmark lands on the lock beat
shot(93.5, 'lock', (s) => {
  const b = s.b, g = ctx; g.fillStyle = '#e9ddc6'; g.fillRect(0, 0, W, H);
  const paper = paperCanvas(W, H, { seed: 9, crease: false }); g.drawImage(paper, 0, 0);
  // c14: the closer lands inside the print: the same men stay in the paper, ghosted, as the stamp is struck over them
  { const lt0 = (b - 86) * SPB; sg.clearRect(0, 0, W, H); printGround(sg, { sun: [540, 900], r: 560, rays: 24, rot: 0.1 });
    [['pal_shovel', 300, 680], ['pal_tap', 790, 680], ['pal_man_l', 175, 900], ['pal_man_r', 880, 920], ['pal_swing', 540, 1060]].forEach(([n, x, h], i) => printFig(sg, n, { x: x + Math.sin(lt0 * 0.7 + i) * 4, h, foot: 1950 }));
    g.save(); g.globalCompositeOperation = 'multiply'; g.globalAlpha = 0.16 * (1 - smooth(95.2, 96.2, b)) + 0.07; g.drawImage(srcP, 0, 0); g.restore(); }
  const strike = b >= 93.5 ? ease.outCubic((b - 93.5) * SPB / 0.18) : 0, st = [94, 94.5, 95, 95.5].map(x => clamp((b - x) * SPB / 0.16));
  const parts = { mark: 1, eq: b >= 96 ? 1 : 0, slash: b >= 96.1 ? 1 : 0, acc: b >= 96.2 ? 1 : 0 };
  if (strike > 0) {
    const sq = lerp(1.12, 1, strike);
    g.save(); g.globalCompositeOperation = 'multiply'; g.translate(W / 2 - 4, 800); g.scale(sq, sq); g.translate(-W / 2 + 4, -800);
    drawMark(g, W / 2 - 4, 800, 560, { color: '#a3141b', badge: strike, stripes: st }); g.restore();
  }
  if (b >= 96) { const a = clamp((b - 96) * SPB / 0.18); drawLockup(g, W / 2, 1180, 210, { color: '#17110d', accent: '#a3141b', alpha: a, parts }); }
  const fl = Math.exp(-(b - 93.5) * SPB * 9) * (b >= 93.5 ? 1 : 0); if (fl > 0.02) { g.fillStyle = `rgba(255,244,226,${0.35 * fl})`; g.fillRect(0, 0, W, H); }
  // the one credit: the Chairman's chapter
  const ca = smooth(96.4, 97.4, b); if (ca > 0) { g.save(); g.globalAlpha = ca * 0.85; g.fillStyle = '#17110d'; g.font = '28px "Plex Mono"'; g.textAlign = 'center'; if ('letterSpacing' in g) g.letterSpacing = '5px';
    g.fillText('THE IRON BECAME HOT.', W / 2, 1560); g.fillText('COMMUNISM IN THE POST-MAGA AGE', W / 2, 1606);
    g.font = '19px "Plex Mono"'; if ('letterSpacing' in g) g.letterSpacing = '2px'; g.globalAlpha = ca * 0.6;
    g.fillText('A. T. PALMER, OWI, 1940-41; INDIANA STEEL CO., 1908-10: LIBRARY OF CONGRESS', W / 2, 1790); g.fillText('FILM: STEEL, A SYMPHONY OF INDUSTRY, 1936', W / 2, 1822); g.restore(); }
});

// ================================================================ the cards (the Chairman's own sentences, at their own length)
// [b0, b1, lines, opts]; type is set sober, in Playfair, no glow
const CARDS = [
  [0.3, 7.6, ['WITHIN OUR', 'CONSCIOUSNESS,'], { y: 1580, size: 128 }],
  [8.2, 15.6, ['THE IRON', 'IS HOT.'], { y: 1580, size: 160 }],
  [20.2, 23.8, ['SAND.'], { y: 1700, size: 170 }],
  [25.4, 28.2, ['IRON, 1908.'], { y: 1700, size: 150 }],
  [44.4, 49.8, ['THE DECISIVE THING', 'IS NOT WHEN', 'THE BOWSTRING', 'IS DRAWN BACK.'], { y: 1720, size: 108 }],
  [50.4, 55.7, ['IT ACQUIRES', 'COMPLETION ONLY', 'UPON RELEASE.'], { y: 330, size: 98 }],
  [56.8, 61.8, ['WHEN THE NOW', 'ROTTING DAM', 'FINALLY BREAKS,'], { y: 1790, size: 104 }],
  [62.2, 66.2, ['A NEW WORLD', 'WILL FLOOD', 'THE OLD'], { y: 1790, size: 112 }],
  [66.6, 72, ['ABRUPTLY.', 'SUDDENLY.', 'CATASTROPHICALLY.'], { y: 1790, size: 104, stack: [66.6, 68.2, 69.8] }],
];
function cards(b) {
  for (const [b0, b1, lines, o] of CARDS) {
    if (b < b0 || b >= b1) continue;
    const age = (b - b0) * SPB, a = ease.outCubic(age / 0.3) * (1 - smooth(b1 - 0.5, b1, b)), size = o.size || 120;
    const sz = fitSize(ctx, lines, size);
    let ls = lines;
    if (o.stack) ls = lines.filter((_, i) => b >= o.stack[i]);
    if (!ls.length) continue;
    setLines(ctx, ls, { ...o, size: sz, y: (o.y || 1500) + (1 - ease.outCubic(age / 0.3)) * 16, alpha: a });
  }
}
const PRINT_CARDS = [
  [76.4, 85.8, ['TO DISCOVER', 'HOW THE STEEL', 'IS TEMPERED.'], { y: 250, size: 124 }],
  [86.2, 90.8, ['GARY, 2036.'], { y: 250, size: 170 }],
];
function printCards(b) {
  for (const [b0, b1, lines, o] of PRINT_CARDS) {
    if (b < b0 || b >= b1) continue;
    const age = (b - b0) * SPB, a = clamp(age / 0.12) * (1 - smooth(b1 - 0.3, b1, b));
    inkText(ctx, lines, { ...o, size: fitSize(ctx, lines, o.size), alpha: a, scale: 1 + 0.08 * Math.exp(-age * 18) });
  }
}

// ================================================================ render
window.renderFrame = async (t) => {
  const b = B.beat(t) + 1e-4, frame = Math.round(t * 30), s = shotAt(b);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  await s.fn({ t, b, lt: (b - s.b0) * SPB, lb: b - s.b0 });
  if (b < 72) cards(b); else if (b >= 76 && b < 91) printCards(b);
  const printed = b >= 76;
  finish.apply(ctx, frame, { grain: printed ? 0.04 : 0.06, vignette: printed ? 0.12 : 0.35 });
};

for (const n of ['pal_man_l', 'pal_man_r']) await pack(n);

for (const [n, f] of [['apr1908', 'apr1908'], ['late1908', 'late1908'], ['plant1910', 'plant1910']]) await image(n, `${BASE}pan/${f}.jpg`);
for (const n of ['pal_man_l', 'pal_man_r', 'pal_swing', 'pal_shovel', 'pal_tap']) await figure(n);
window.sceneReady = true;
