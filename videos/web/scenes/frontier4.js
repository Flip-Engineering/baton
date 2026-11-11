// THE IRON IS HOT (v12, cycle 14; v11 header follows): scripts_final/frontier.json, song audio/songs2/frontier_c13.py (96 BPM, standalone score).
// The argument is the Chairman's (POSTMAGA ch. 1, 2, 9) at its own length; the picture is real people and real ground:
// Alfred T. Palmer's steelworkers (OWI, 1940-41, LoC masters, cut and lit as living photographs), the Indiana Steel Co.
// panoramas of Gary Works (LoC, 1908-10), Steel: A Symphony of Industry (Audio Productions, 1936, Prelinger PD).
// Everything that moves in a photograph moves by its own depth; the heat is light on those faces, never a caption.
// c16: one world from frame 0 to the end: the second half is the fire the opening never showed, and the men come back lit by it (temper plates, no poster).
import { W, H, C, loadFonts, loadBeats, loadImage, clamp, lerp, ease, rng, Finish, sigil, acpEmblem } from '../lib/kit.js';
import { drawMark, drawLockup, paperCanvas, inkStamp } from '../lib/closer.js';
import { LivingPhoto, path } from '../lib/fx/living_photo.js';

const out = document.getElementById('out'); out.width = W; out.height = H;
const ctx = out.getContext('2d');
await loadFonts();
// a sober face for the Chairman's sentences (no glow): Playfair Display Black
{ const f = new FontFace('Playfair', 'url(../node_modules/@fontsource/playfair-display/files/playfair-display-latin-900-normal.woff)'); document.fonts.add(await f.load()); }
const B = await loadBeats('frontier4');
const SPB = B.spb;
const finish = new Finish(1906);
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
function setLines(g, lines, { x = W / 2, y = 1500, size = 118, lh = 1.08, align = 'center', color = '#f4e6d0', shadow = 0, alpha = 1, red = null, track = 0 } = {}) {
  g.save(); g.font = `900 ${size}px Playfair`; g.textAlign = align; g.textBaseline = 'alphabetic'; g.globalAlpha = alpha;
  if ('letterSpacing' in g) g.letterSpacing = `${track}px`;
  const n = lines.length, y0 = y - (n - 1) * size * lh;
  lines.forEach((s, i) => {
    const yy = y0 + i * size * lh;
    if (shadow > 0) throw new Error('frontier4: type is printed, no shadow (house style)');
    g.fillStyle = red && red.includes(i) ? '#e8352d' : color; g.fillText(s, x, yy);
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
  g.strokeStyle = 'rgba(38,22,12,0.92)'; g.lineCap = 'round'; g.lineJoin = 'round';
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
  g.fillStyle = 'rgba(38,22,12,0.88)'; g.font = '30px "Plex Mono"'; g.textAlign = 'center';
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
const place = (g, text, a) => { if (a <= 0.01) return; g.save(); g.globalAlpha = a * 0.8; g.fillStyle = '#e9d9bd'; g.font = '26px "Plex Mono"'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; if ('letterSpacing' in g) g.letterSpacing = '5px'; g.fillText(text, 64, 1846); g.restore(); };
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

// ---------------------------------------------------------------- b16-19.5: the survey sheet (the same sepia the photographs are printed in)
// c16: the plat, its card and the plates are ONE material (sepia: paper, ink, albumen print), so the drawing can become the photograph.
let paperCv = null;
function sheet(g, a = 1) {
  if (!paperCv) {
    paperCv = cv(W, H); const p = paperCv.getContext('2d');
    const gr = p.createRadialGradient(W * 0.45, H * 0.42, 100, W * 0.5, H * 0.5, 1250); gr.addColorStop(0, 'rgb(184,158,118)'); gr.addColorStop(0.6, 'rgb(150,123,88)'); gr.addColorStop(1, 'rgb(84,64,44)');
    p.fillStyle = gr; p.fillRect(0, 0, W, H);
    const id = p.getImageData(0, 0, W, H), d = id.data;                      // linen: a fine weave and slow stains
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, wv = (Math.sin(x * 1.9) * Math.sin(y * 1.7)) * 5 + (hsh(x, y) - 0.5) * 9 + (vn1(x * 0.004 + y * 0.002) - 0.5) * 22; d[i] += wv; d[i + 1] += wv; d[i + 2] += wv * 0.8; }
    p.putImageData(id, 0, 0);
    const fl = p.createLinearGradient(0, H * 0.55, 0, H); fl.addColorStop(0, 'rgba(24,14,8,0)'); fl.addColorStop(1, 'rgba(24,14,8,0.82)'); p.fillStyle = fl; p.fillRect(0, H * 0.55, W, H * 0.45);
    p.strokeStyle = 'rgba(36,22,12,0.75)'; p.lineWidth = 3; p.strokeRect(34, 34, W - 68, H - 68); p.lineWidth = 1.2; p.strokeRect(46, 46, W - 92, H - 92);
  }
  g.save(); g.globalAlpha = a; g.drawImage(paperCv, 0, 0); g.restore();
}
shot(16, 'title', (s) => { sheet(ctx, clamp(s.lt / 0.2)); });                 // GARY, 1906. is set as a card, where THE IRON IS HOT. was set

// ---------------------------------------------------------------- b19.5-32: sand to iron (the plates fill the frame and pan across their full height)
const DATES = [[19.5, '1906'], [24.4, '1908'], [28, '1910']];                              // the plates' own years (April 1908; the plant in 1910)
function dateTab(g, x, y, cw, ch, b, fixed = null) {                        // a year on flaps that turns over at its beat
  let prev = DATES[0][1], cur = DATES[0][1], u = 1;
  if (fixed) { prev = cur = fixed; }
  else for (let i = 0; i < DATES.length; i++) if (b >= DATES[i][0]) { cur = DATES[i][1]; prev = i ? DATES[i - 1][1] : ' '.repeat(4); u = clamp((b - DATES[i][0]) / 0.9); }
  for (let k = 0; k < 4; k++) flapCell(g, x + k * (cw + 6), y, cw, ch, prev[k], cur[k], clamp(u * 1.8 - k * 0.12));
}
// a plate at one scale across the whole frame: its full height fills the 1920 (ph = H), u = the left edge (0..1 of its width) over the shot
function drawPano(g, name, s, { yc = 960, ph = 1920, u0 = 0, u1 = 0.5, ua = 0, ub = 1, lutName = 'sepia', gain = 1.0, gamma = 1.0, warm = 0 }) {
  const im = img[name]; if (!im) return; const c = tonedOnce(name, lutName, { gain, gamma });
  const k = ph / im.height, vw = W / k, u = lerp(u0, u1, smooth(ua, ub, s.b)), sx = clamp(u * im.width, 0, im.width - vw), y = yc - ph / 2;
  g.drawImage(c, sx, 0, vw, im.height, 0, y, W, ph);
  if (warm > 0) { g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = `rgba(255,${230 - 40 * warm | 0},${200 - 90 * warm | 0},1)`; g.fillRect(0, y, W, ph); g.restore(); }
}
// c16 (client: two related segments; the drawing becomes the photograph IN THE SAME MATERIAL): the plat in ink on the sepia sheet, full frame, drawing the works as designed;
// the albumen print then comes up under the ink registered to it (the drawn mill block is the real mills), the paper and then the lines let go, and the camera rises into the plate.
const platC = cv(W, H), platG = platC.getContext('2d'), phC = cv(W, H), phG = phC.getContext('2d');
const PLAT = { x: 40, y: 330, w: 1000, h: 1280 };
const PH0 = { k: 0.94, ox: -529, oy: 454 };                                  // the plate at the scale where its works block sits under the drawn mill block
function platShot(s) {
  const g = ctx, b = s.b, e = smooth(23.2, 25.4, b), sec = s.lt * 1.45;
  sheet(g, 1 - smooth(24.8, 25.4, b));
  const im = img.apr1908;
  if (e > 0 && im) {
    const k1 = H / im.height, u = lerp(0, 0.5, smooth(19.5, 28, b)), x1 = -clamp(u * im.width, 0, im.width - W / k1) * k1, y1 = 0;
    const z = ease.inOutCubic(clamp((b - 23.6) / 1.8)), k = Math.exp(lerp(Math.log(PH0.k), Math.log(k1), z));
    const ox = lerp(PH0.ox, x1, z), oy = lerp(PH0.oy, y1, z);
    const c = tonedOnce('apr1908', 'sepia', { gain: 1, gamma: 1 });
    phG.clearRect(0, 0, W, H); phG.globalCompositeOperation = 'source-over'; phG.drawImage(c, ox, oy, im.width * k, im.height * k);
    const fy = oy, fh = im.height * k, fe = 120;                              // the print's own soft edge dissolves into the paper, above and below
    phG.globalCompositeOperation = 'destination-out';
    for (const [y0, y1_, a0, a1] of [[fy - 10, fy + fe, 1, 0], [fy + fh - fe, fy + fh + 10, 0, 1]]) { const gr = phG.createLinearGradient(0, y0, 0, y1_); gr.addColorStop(0, `rgba(0,0,0,${a0})`); gr.addColorStop(1, `rgba(0,0,0,${a1})`); phG.fillStyle = gr; phG.fillRect(0, Math.min(y0, y1_), W, Math.abs(y1_ - y0)); }
    g.save(); g.globalAlpha = smooth(23.2, 24.4, b); g.drawImage(phC, 0, 0); g.restore();
  }
  const lineA = 1 - smooth(24.0, 25.4, b);
  if (lineA > 0.01) { platG.clearRect(0, 0, W, H); plat(platG, PLAT.x, PLAT.y, PLAT.w, PLAT.h, sec); g.save(); g.globalAlpha = lineA; g.drawImage(platC, 0, 0); g.restore(); }
  dateTab(g, 74, 190, 62, 92, b);
}
shot(19.5, 'plat', platShot);
shot(25.4, 'ironA', (s) => {
  const g = ctx; drawPano(g, 'apr1908', s, { ua: 19.5, ub: 28, u0: 0.0, u1: 0.5, warm: 0.25 * smooth(25.4, 27, s.b) }); dateTab(g, 74, 210, 62, 92, s.b);
});
shot(28, 'ironB', (s) => {
  const g = ctx, k = smooth(28, 28.8, s.b);
  g.save(); g.globalAlpha = 1 - k; drawPano(g, 'apr1908', s, { ua: 19.5, ub: 28, u0: 0.0, u1: 0.5, warm: 0.25 + 0.15 * smooth(25.4, 28, s.b) }); g.restore();
  g.save(); g.globalAlpha = k; drawPano(g, 'plant1910', s, { yc: 690, ph: 2500, u0: 0.03, u1: 0.13, ua: 28, ub: 32, gain: 0.95, gamma: 1.2, warm: 0.5 }); g.restore();
  dateTab(g, 74, 210, 62, 92, s.b);
});

// ---------------------------------------------------------------- b32-44: the roll at the gate
const BOARD = { y0: 32 };
function boardShot(s) {
  const g = ctx, b = s.b, t = s.t;
  // the gate office: a cold painted wall (the same hour the photographs were made), and on it a board of vitreous enamel in a brass frame
  const wall = g.createLinearGradient(0, 0, 0, H); wall.addColorStop(0, '#1c2530'); wall.addColorStop(1, '#0c1118'); g.fillStyle = wall; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 3; for (let y = 120; y < H; y += 150) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }   // wainscot boards
  const bx = 40, by = 440, bw = 1000, bh = 1010;
  const brass = g.createLinearGradient(bx, by, bx + bw, by + bh); brass.addColorStop(0, '#d8b868'); brass.addColorStop(0.35, '#8a6c32'); brass.addColorStop(0.6, '#e6cb82'); brass.addColorStop(1, '#6f5426');
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(bx - 4, by + 6, bw + 28, bh + 36);                    // cast shadow on the wall
  g.fillStyle = brass; g.fillRect(bx - 22, by - 22, bw + 44, bh + 44);                                 // the brass frame
  g.fillStyle = '#0d141b'; g.fillRect(bx - 4, by - 4, bw + 8, bh + 8);
  const en = g.createLinearGradient(bx, by, bx + bw * 0.3, by + bh); en.addColorStop(0, '#2a3b4b'); en.addColorStop(0.5, '#1b2937'); en.addColorStop(1, '#141f2a'); g.fillStyle = en; g.fillRect(bx, by, bw, bh);   // slate-blue enamel
  const sh = g.createLinearGradient(bx, by, bx + bw, by); sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(0.18, 'rgba(190,215,240,0.11)'); sh.addColorStop(0.3, 'rgba(255,255,255,0)'); g.fillStyle = sh; g.fillRect(bx, by, bw, bh);   // a streak of window light on the glaze
  for (let i = 0; i < 26; i++) { const cx = bx + 30 + hsh(i, 1) * (bw - 60), cy = by + 30 + hsh(i, 2) * (bh - 60); g.fillStyle = 'rgba(8,10,14,0.55)'; g.beginPath(); g.arc(cx, cy, 1.5 + hsh(i, 3) * 3, 0, 7); g.fill(); }   // chips in the glaze
  g.strokeStyle = '#b8964f'; g.lineWidth = 3; g.strokeRect(bx + 14, by + 14, bw - 28, bh - 28);
  for (const [x, y] of [[bx + 34, by + 34], [bx + bw - 34, by + 34], [bx + 34, by + bh - 34], [bx + bw - 34, by + bh - 34]]) { const rg = g.createRadialGradient(x - 3, y - 3, 1, x, y, 11); rg.addColorStop(0, '#f0dc9c'); rg.addColorStop(1, '#6a5024'); g.fillStyle = rg; g.beginPath(); g.arc(x, y, 10, 0, 7); g.fill(); }   // brass rivets
  g.fillStyle = '#d2b373'; g.font = '34px "Plex Mono"'; g.textAlign = 'center'; if ('letterSpacing' in g) g.letterSpacing = '8px';
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
  const hb = HEART(b), tight = held ? 4.05 + 0.9 * ease.inCubic(clamp((b - 46.2) / (rel - 46.2))) : 4.4;
  const pan = run ? 140 + 190 * smooth(0, 2.2, s.t - rel * SPB) : 140;
  const wx = held ? (hsh(s.t * 24) - 0.5) * 6 * (1 + push) : 0, wy = held ? (hsh(s.t * 24, 3) - 0.5) * 6 * (1 + push) + hb * 8 : 0;
  if (im) filmCrop(g, im, { fx: pan, fy: 240, sc: tight + hb * 0.04, lutName: 'iron', key: 'bar', dx: wx, dy: wy, glowK: held ? 0.2 + 0.2 * push : 0.35, gain: Math.min(1, light), gamma: 1.0 });
  const kick = run ? Math.exp(-(s.t - rel * SPB) * 7) : 0;                                                          // the blow lands: the frame is struck
  if (kick > 0.02) { g.fillStyle = `rgba(255,236,200,${0.28 * kick})`; g.fillRect(0, 0, W, H); }
  glow(g, W * 0.6, H * 0.55, 800, '255,120,36', 0.08 + 0.22 * (held ? push : 0) + 0.15 * kick);
  darken(g, W * 0.5, H * 0.5, 380, 1300, held ? 0.42 + 0.3 * (1 - push) : 0.3);
});

// ---------------------------------------------------------------- film fill: a 4:3 frame that must show its whole width (the country) is set sharp over a blurred, dimmed copy of itself that fills the 1920
const fillC = cv(W, H), fillG = fillC.getContext('2d');
function filmFill(g, im, { fx = 320, fy = 240, sc = 2.5, lutName = 'iron', key = 'ff', dx = 0, dy = 0, gain = 1, gamma = 1, glowK = 0.2, dim = 0.5, tone = null } = {}) {
  const c = tone ? tone(im) : toned(im, lutName, key, { gain, gamma });
  g.save(); g.filter = 'blur(34px) brightness(' + dim + ')'; const bs = 4.4; g.drawImage(c, W / 2 - fx * bs + dx, H / 2 - fy * bs, c.width * bs, c.height * bs); g.restore();
  const x0 = W / 2 - fx * sc + dx, y0 = H / 2 - fy * sc + dy, w = c.width * sc, h = c.height * sc;
  fillG.globalCompositeOperation = 'source-over'; fillG.clearRect(0, 0, W, H); fillG.drawImage(c, x0, y0, w, h);
  fillG.globalCompositeOperation = 'destination-out';
  for (const [a, b2, p, q] of [[y0 - 4, y0 + 200, 1, 0], [y0 + h - 200, y0 + h + 4, 0, 1]]) { const gr = fillG.createLinearGradient(0, a, 0, b2); gr.addColorStop(0, `rgba(0,0,0,${p})`); gr.addColorStop(1, `rgba(0,0,0,${q})`); fillG.fillStyle = gr; fillG.fillRect(0, Math.min(a, b2), W, Math.abs(b2 - a)); }
  g.drawImage(fillC, 0, 0);
  if (glowK) { g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = glowK; g.filter = 'blur(30px)'; g.drawImage(fillC, 0, 0); g.filter = 'none'; g.restore(); }
}

// ---------------------------------------------------------------- b56-72: the dam gives (the iron runs, then pours over the men, then takes the shape of the country)
// c16: every shot fills the 1920 like the photographs do; the type sits where it has sat since b0 (lower third, on the picture)
const CLIPS = { a: { n: 82, f0: 5, b0: 56 }, e: { n: 105, f0: 1, b0: 60.6 }, f: { n: 120, f0: 1, b0: 66 } };
function floodShot(k) {
  return async (s) => {
    const C0 = CLIPS[k], i = Math.floor(s.lt * 30) + C0.f0, im = await clipFrame(k, i, C0.n);
    const jolt = Math.exp(-s.lt * 9) * (hsh(s.t * 31) - 0.5) * 38, fl = flick(s.t, 3);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (im) filmCrop(ctx, im, { fx: 320, fy: 250, sc: 4.0 + 0.25 * clamp(s.lt / 2), lutName: 'iron', key: 'fl' + k, dx: jolt, gain: 1.0 * fl, gamma: 0.95, glowK: 0.3 });
    glow(ctx, W / 2, 800, 900, '255,90,20', 0.10);
  };
}
// the pour and the map: Steel's last shot (the iron poured into the outline of the country, the men walking toward us beneath it). Toned so that ONLY the metal is white.
const MAPN = 306;
const mapCool = { c: 0 };                                                   // how far the metal has cooled through the temper colours (0 hot white .. 1 blue)
async function mapShot(s, mi, { sc = 1.72, fy = 250, fx = 320, gain = 1, glowK = 0.18, shake = 0, cool = 0 } = {}) {
  const im = await seqFrame('map', 'm', mi, MAPN); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  if (im) filmFill(ctx, im, { sc, fx, fy, dx: shake, dy: -10, glowK, dim: 0.32, gain, gamma: 1.05, key: 'map' + gain, tone: cool > 0 ? (m) => temperFilm(m, 'tm', cool, { gain, gamma: 1.05 }) : null });
}
shot(60, 'pour', async (s) => {                                            // b60-66.6: the pot tips over the men walking at us
  const mi = 22 + (s.t - 60 * SPB) * 30 * 0.92, jolt = Math.exp(-s.lt * 8) * (hsh(s.t * 31) - 0.5) * 30;
  await mapShot(s, mi, { sc: 3.0, fy: 222, shake: jolt, glowK: 0.22 });
});
shot(66.6, 'spill', floodShot('f')); shot(68.2, 'run', floodShot('a'));
shot(69.8, 'form', async (s) => {                                          // b69.8-72: the iron takes the shape of the country (the film runs fast: the dam gives)
  const u = clamp((s.t - 69.8 * SPB) / (2.2 * SPB)), mi = 135 + (230 - 135) * ease.inOutCubic(u);
  await mapShot(s, mi, { sc: lerp(3.0, 1.72, ease.inOutCubic(u)), fy: 250, gain: 1 + 0.15 * u, shake: Math.exp(-s.lt * 6) * (hsh(s.t * 31) - 0.5) * 30 });
});

// ---------------------------------------------------------------- the temper colours: steel cooling, straw, bronze, purple, blue (oxide films on the metal's own surface; never a flat fill)
const TEMPER = [[255, 248, 232], [236, 204, 118], [196, 126, 52], [124, 70, 148], [58, 104, 196]];
const lerpC = (a, c, u) => a.map((v, i) => v + (c[i] - v) * u);
function temper(x) { const k = clamp(x) * (TEMPER.length - 1), i = Math.min(TEMPER.length - 2, Math.floor(k)); return lerpC(TEMPER[i], TEMPER[i + 1], k - i); }
// the heat of the whole last section as one number: b72 white heat, b76 straw/bronze, the faces through bronze and purple, blue by the works
// v13: tempering stops at straw/bronze (what a tool is drawn to); purple and blue only pass through the highlights mid-section, the end is lit warm
const COOLK = [[72, 0], [75.5, 0.2], [79, 0.36], [83, 0.5], [86, 0.42], [90.8, 0.3], [93.5, 0.22]];
function coolAt(b) { for (let i = 1; i < COOLK.length; i++) if (b <= COOLK[i][0]) { const [b0, c0] = COOLK[i - 1], [b1, c1] = COOLK[i]; return lerp(c0, c1, smooth(b0, b1, b)); } return 1; }
// the film frame with its METAL (the white of the pour) tempered: an oxide sheen that bands across the surface; the men and the dark stay as they were
function temperFilm(im, key, c, { gain = 1, gamma = 1 } = {}) {
  const w = im.width, h = im.height, k = 'tf' + key + w; let cs = scratch[k]; if (!cs) cs = scratch[k] = cv(w, h);
  const g = cs.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
  const id = g.getImageData(0, 0, w, h), d = id.data, L = LUTS.iron;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, v = Math.pow(clamp(d[i] / 255 * gain), gamma), vi = (v * 255) | 0;
    let r = L[vi * 3], gg = L[vi * 3 + 1], bb = L[vi * 3 + 2];
    const m = smooth(0.6, 0.84, v);
    if (m > 0) {
      const cl = clamp(c * 1.25 + 0.07 * Math.sin((x * 0.5 + y * 0.9) / 60 - c * 5) + 0.12 * (x / w - 0.5) - 0.05), tc = temper(cl), f = 0.5 + 0.62 * v;
      r += (tc[0] * f - r) * m; gg += (tc[1] * f - gg) * m; bb += (tc[2] * f - bb) * m;
    }
    d[i] = r; d[i + 1] = gg; d[i + 2] = bb;
  }
  g.putImageData(id, 0, 0); return cs;
}
// b72-76: OUR STEEL. on the iron itself, struck once. The word is a card like every other; the metal around it starts to cool.
shot(72, 'steel', async (s) => {
  const lt = s.lt, mi = 230 + Math.min(55, lt * 30 * 0.7), cool = coolAt(s.b);
  await mapShot(s, mi, { sc: 1.72, fy: 250, gain: 1.15 - 0.1 * smooth(0, 2, lt), glowK: 0.12 * (1 - cool), cool: Math.max(cool, 0.001) });
  const g = ctx, ring = Math.exp(-lt * 5);                                  // the strike: a flash on the metal (v13: no ring, it read as a badge's ghost)
  if (ring > 0.02) { g.save(); g.fillStyle = `rgba(255,236,200,${0.22 * ring})`; g.fillRect(0, 0, W, H); g.restore(); }
  const sp = Math.exp(-lt * 3.2); for (let i = 0; i < 40; i++) { const a = hsh(i, 1) * 6.28, v = 300 + 800 * hsh(i, 2), x = W / 2 + Math.cos(a) * v * lt * 0.8, y = 800 + Math.sin(a) * v * lt * 0.8 + 900 * lt * lt * 0.5; g.fillStyle = `rgba(255,${200 + 40 * hsh(i, 3) | 0},120,${sp})`; g.fillRect(x, y, 4, 4 + 8 * hsh(i, 4)); }
});

// ---------------------------------------------------------------- b76-86: the men come back through the tempering (the same photographs, lit by the metal)
const plSrc = cv(W, H), plSg = plSrc.getContext('2d', { willReadFrequently: true });
// v13: the four plates printed the WHOLE grey through the temper colours (a gradient map: flat faces, blue shadows, a cold end).
// Now the photograph is printed warm (the opening's iron stock, its midtones intact: furnace-brown shadows, skin as skin) and the
// temper colour lives only in the highlights, a sheen of oxide on whatever the light from the metal strikes; it bands slowly across.
function platesOf(src, c, reg, lt) {                                        // src: a canvas holding the photograph (grey is enough); draws onto ctx
  plSg.clearRect(0, 0, W, H); plSg.drawImage(src, 0, 0);
  const id = plSg.getImageData(0, 0, W, H), d = id.data, Li = LUTS.iron;
  const T = [0, 1, 2, 3, 4, 5, 6, 7].map(k => temper(clamp(c + 0.16 * (k / 7 - 0.5))));
  for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i += 4) {
    const L = Math.pow((d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255, 1.45), vi = (L * 255) | 0;   // a stop of contrast back: the shadows furnace-brown, the midtones kept
    let r = Li[vi * 3], g = Li[vi * 3 + 1], b = Li[vi * 3 + 2];
    const m = 0.8 * smooth(0.55, 0.9, L);
    if (m > 0) {
      const band = 0.5 + 0.5 * Math.sin((x * 0.6 + y * 0.8) / 170 + lt * 0.9), tc = T[(band * 7.99) | 0], f = 0.62 + 0.4 * L;
      r += (tc[0] * f - r) * m; g += (tc[1] * f - g) * m; b += (tc[2] * f - b) * m;
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  plSg.putImageData(id, 0, 0);
  ctx.drawImage(plSrc, 0, 0);
}
const NEUTRAL = { ramp: [[0, 0, 0], [0.5, 0.5, 0.5], [1, 1, 1]], keep: 0, contrast: 1.45, pivot: 0.5, sat: 1, warmth: 0, halation: 0.12, vignette: 0.1, grain: 0.04, lift: 0 };
// the face as the opening had it (the same photograph, the same crop), now lit from the FRONT: the light that was off the left edge is in front of him
function faceFront(P, t, lt, o) {
  const u = clamp(lt / o.len);
  const cam = path([{ t: 0, cx: o.c0[0], cy: o.c0[1], zoom: o.z0, push: 0.03, px: 0 }, { t: 1, cx: o.c1[0], cy: o.c1[1], zoom: o.z1, push: 0.06, px: 0 }], { reason: 'the same crop the viewer remembers, pushed in as the light arrives' })(u);
  const fire = o.fire(t, lt);
  P.draw(sg, t, { cam, look: NEUTRAL, lights: [{ x: 0.5, y: 0.3, z: 0.7, radius: 1.0, color: [1, 1, 1], w: 0.35 * fire }, { x: 0.5, y: 0.5, z: 0.4, radius: 1.2, color: [1, 1, 1], w: 0.12 * fire }], seed: Math.floor(t * 24) });
  return cam;
}
// P.draw draws into the 2d context it is given: render into a scratch canvas, then print the plates from it
const sgC = cv(W, H), sg = sgC.getContext('2d');
const RET = [
  { b: 76, pack: 'pal_man_l', len: 3.6 * SPB, c0: [0.5, 0.52], c1: [0.5, 0.47], z0: 1.04, z1: 1.26, c: 0, note: 'BRACKENRIDGE, PA. 1941.' },
  { b: 79.4, pack: 'pal_man_r', len: 3.4 * SPB, c0: [0.58, 0.5], c1: [0.58, 0.46], z0: 1.12, z1: 1.3, c: 0.4 },
  { b: 82.6, bar: true, len: 3.4 * SPB, c: 0.6 },
];
shot(76, 'return', async (s) => {
  let r = RET[0]; for (const q of RET) if (s.b >= q.b) r = q;
  const lt = (s.b - r.b) * SPB, c = coolAt(s.b), fire = (t) => (1.0 + 0.25 * Math.sin(t * 3)) * flick(t, 7);
  if (r.bar) {
    const im = await seqFrame('bar', 'b', BAR.top, BAR.n); sg.fillStyle = '#000'; sg.fillRect(0, 0, W, H);
    if (im) filmCrop(sg, im, { fx: 140, fy: 240, sc: 3.9 + 0.5 * clamp(lt / r.len), lutName: 'silver', key: 'barret', glowK: 0.1, gamma: 0.75, gain: 1.7 });
  } else { sg.fillStyle = '#000'; sg.fillRect(0, 0, W, H); faceFront(packs[r.pack], s.t, lt, { ...r, fire }); }
  platesOf(sgC, c, Math.exp(-lt * 3), lt);
  if (r.note) place(ctx, r.note, smooth(0.5, 1.0, lt) * (1 - smooth(2.2, 2.7, lt)));
});

// ---------------------------------------------------------------- b86-93.5: GARY, 2036. (the plate, and the men in front of it, in the same tempered metal)
const figs = {};
async function figure(name) { return figs[name] ??= await loadImage(`${BASE}cut/${name}.png`).catch(() => null); }
const CUTS = { l: { name: 'pal_man_l', x: 290, h: 1260 }, r: { name: 'pal_man_r', x: 800, h: 1290 } };
const GCUTS = { l: { name: 'pal_man_l', x: 70, h: 1420 }, r: { name: 'pal_man_r', x: 1020, h: 1450 } };   // v13: at the frame's edges, so the card and the plate's works sit between them
shot(86, 'gary', (s) => {                                                  // v13: the 1910 plate at its b28 framing (the works), the men low before it
  const lt = s.lt, c = coolAt(s.b), b = s.b;
  sg.fillStyle = '#000'; sg.fillRect(0, 0, W, H);
  drawPano(sg, 'plant1910', { b }, { yc: 690, ph: 2500, u0: 0.13, u1: 0.17, ua: 86, ub: 91, gain: 0.95, gamma: 1.2, lutName: 'silver' });
  const rise = ease.outCubic(clamp(lt / 1.6));
  for (const k of ['l', 'r']) { const f = GCUTS[k], im = figs[f.name]; if (!im) throw new Error('frontier4: cut figure missing ' + f.name); const kk = f.h / im.height, w = im.width * kk, sway = Math.sin(lt * 0.8 + (k === 'l' ? 0 : 2)) * 5, fo = (1 - rise) * 160;
    sg.save(); sg.filter = 'brightness(1.32) contrast(1.2)'; sg.drawImage(im, f.x - w / 2 + sway, H - f.h + 180 + fo, w, f.h); sg.restore(); }
  platesOf(sgC, c, 0.0, lt);
});
// b90.8-93.5 (56.75-58.4 s; was a dead hold after GARY, 2036. faded): the pipe man again, close, lit from the FRONT by the metal,
// the light rising to the strike: the brightest, warmest face in the piece is the last picture before the emblem. Same beats, same score.
shot(90.8, 'lit', (s) => {
  const lt = s.lt, c = coolAt(s.b), up = smooth(90.8, 93.4, s.b);
  sg.fillStyle = '#000'; sg.fillRect(0, 0, W, H);
  faceFront(packs.pal_man_r, s.t, lt, { len: 2.7 * SPB, c0: [0.58, 0.47], c1: [0.58, 0.45], z0: 1.3, z1: 1.42, fire: (t) => (0.75 + 1.1 * up) * flick(t, 9) });
  platesOf(sgC, c, 0.0, lt);
});

// ---------------------------------------------------------------- b93.5-98.6: the emblem is struck from the tempered metal
const steelC = cv(W, H), maskC = cv(W, H), rimC = cv(W, H);
function steelPlate() {                                                    // v13: forged iron, warm and dark, an even hammered grain (the brushed streaks read as scan lines)
  if (steelC.done) return steelC; const g = steelC.getContext('2d');
  const gr = g.createRadialGradient(W * 0.5, H * 0.4, 80, W * 0.5, H * 0.5, 1300); gr.addColorStop(0, 'rgb(92,52,30)'); gr.addColorStop(0.55, 'rgb(52,28,17)'); gr.addColorStop(1, 'rgb(14,8,5)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const id = g.getImageData(0, 0, W, H), d = id.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, n = (hsh(x, y, 7) - 0.5) * 10 + (vn1(x * 0.013 + y * 0.0071) - 0.5) * 8 + (hsh(x >> 2, y >> 2, 3) - 0.5) * 8; d[i] += n; d[i + 1] += n * 0.8; d[i + 2] += n * 0.6; }
  g.putImageData(id, 0, 0); steelC.done = true; return steelC;
}
shot(93.5, 'lock', (s) => {
  const b = s.b, g = ctx, pl = steelPlate();
  g.drawImage(pl, 0, 0);
  const cool = smooth(93.5, 97.2, b), strike = b >= 93.5 ? ease.outCubic((b - 93.5) * SPB / 0.18) : 0, st = [94, 94.5, 95, 95.5].map(x => clamp((b - x) * SPB / 0.16));
  const parts = { mark: 1, eq: b >= 96 ? 1 : 0, slash: b >= 96.1 ? 1 : 0, acc: b >= 96.2 ? 1 : 0 };
  const mg = maskC.getContext('2d'); mg.clearRect(0, 0, W, H); mg.fillStyle = '#fff';
  if (strike > 0) { const sq = lerp(1.1, 1, strike); mg.save(); mg.translate(W / 2 - 4, 800); mg.scale(sq, sq); mg.translate(-W / 2 + 4, -800); drawMark(mg, W / 2 - 4, 800, 560, { color: '#fff', badge: strike, stripes: st }); mg.restore(); }
  if (b >= 96) drawLockup(mg, W / 2, 1180, 210, { color: '#fff', alpha: clamp((b - 96) * SPB / 0.18), parts });
  // v13: the emblem is the metal itself, printed flat (no shadow, no lit rim): white heat on the strike, settling to straw and bronze, never blue
  const heat = Math.exp(-(b - 93.5) * SPB * 1.2) * (b >= 93.5 ? 1 : 0), hotc = temper(0.06 + 0.26 * cool);
  const face = hotc.map((v, k) => v + ([255, 246, 228][k] - v) * heat);
  const fc = rimC.getContext('2d'); fc.clearRect(0, 0, W, H); fc.drawImage(maskC, 0, 0); fc.globalCompositeOperation = 'source-in';
  fc.fillStyle = `rgb(${face.map(v => Math.round(Math.min(255, v))).join(',')})`; fc.fillRect(0, 0, W, H);
  fc.globalCompositeOperation = 'overlay'; fc.globalAlpha = 0.35; fc.drawImage(pl, 0, 0); fc.globalAlpha = 1; fc.globalCompositeOperation = 'source-over';
  g.drawImage(rimC, 0, 0);
  const fl = Math.exp(-(b - 93.5) * SPB * 9) * (b >= 93.5 ? 1 : 0); if (fl > 0.02) { g.fillStyle = `rgba(255,236,206,${0.35 * fl})`; g.fillRect(0, 0, W, H); }
  // the one credit: the Chairman's chapter
  const ca = smooth(96.4, 97.4, b); if (ca > 0) { g.save(); g.globalAlpha = ca * 0.85; g.fillStyle = '#e9d9bd'; g.font = '28px "Plex Mono"'; g.textAlign = 'center'; if ('letterSpacing' in g) g.letterSpacing = '5px';
    g.fillText('THE IRON BECAME HOT.', W / 2, 1560); g.fillText('COMMUNISM IN THE POST-MAGA AGE', W / 2, 1606);
    g.font = '19px "Plex Mono"'; if ('letterSpacing' in g) g.letterSpacing = '2px'; g.globalAlpha = ca * 0.6;
    g.fillText('A. T. PALMER, OWI, 1940-41; INDIANA STEEL CO., 1908-10: LIBRARY OF CONGRESS', W / 2, 1790); g.fillText('FILM: STEEL, A SYMPHONY OF INDUSTRY, 1936', W / 2, 1822); g.restore(); }
});

// ================================================================ the cards (the Chairman's own sentences, at their own length)
// ONE placement from the first card to the last: the cream serif, centred, its last line on the baseline of the lower third, on the picture.
const LAST = 1700, BIG = 1580;                                              // BIG: the two-line cards that open and close the piece (THE IRON IS HOT. / GARY, 2036.) sit on the same line
const CARDS = [
  [0.3, 7.6, ['WITHIN OUR', 'CONSCIOUSNESS,'], { y: BIG, size: 128 }],
  [8.2, 15.6, ['THE IRON', 'IS HOT.'], { y: BIG, size: 160 }],
  [16.3, 19.4, ['GARY,', '1906.'], { y: BIG, size: 160 }],
  [20.2, 23.8, ['SAND.'], { y: LAST, size: 170 }],
  [25.4, 28.2, ['IRON, 1908.'], { y: LAST, size: 150 }],
  [44.4, 49.8, ['THE DECISIVE THING', 'IS NOT WHEN', 'THE BOWSTRING', 'IS DRAWN BACK.'], { y: LAST, size: 108 }],
  [50.4, 55.7, ['IT ACQUIRES', 'COMPLETION ONLY', 'UPON RELEASE.'], { y: LAST, size: 104 }],
  [56.8, 61.8, ['WHEN THE NOW', 'ROTTING DAM', 'FINALLY BREAKS,'], { y: LAST, size: 104 }],
  [62.2, 66.2, ['A NEW WORLD', 'WILL FLOOD', 'THE OLD'], { y: LAST, size: 112 }],
  [66.6, 72, ['ABRUPTLY.', 'SUDDENLY.', 'CATASTROPHICALLY.'], { y: LAST, size: 104, stack: [66.6, 68.2, 69.8] }],
  [72.1, 76.0, ['OUR STEEL.'], { y: LAST, size: 210 }],
  [76.4, 85.8, ['TO DISCOVER', 'HOW THE STEEL', 'IS TEMPERED.'], { y: LAST, size: 118 }],
  [86.2, 90.8, ['GARY,', '2036.'], { y: BIG, size: 160 }],
];
function cards(b) {
  for (const [b0, b1, lines, o] of CARDS) {
    if (b < b0 || b >= b1) continue;
    const age = (b - b0) * SPB, a = ease.outCubic(age / 0.3) * (1 - smooth(b1 - 0.5, b1, b)), size = o.size || 120;
    const sz = fitSize(ctx, lines, size);
    let ls = lines;
    if (o.stack) ls = lines.filter((_, i) => b >= o.stack[i]);
    if (!ls.length) continue;
    // a low scrim, so the cream always reads (the photographs' own lower third, darkened)
    const sc = ctx.createLinearGradient(0, 1050, 0, H); sc.addColorStop(0, 'rgba(6,3,2,0)'); sc.addColorStop(1, `rgba(6,3,2,${0.62 * a})`); ctx.fillStyle = sc; ctx.fillRect(0, 1050, W, H - 1050);
    setLines(ctx, ls, { ...o, size: sz, y: o.y + (1 - ease.outCubic(age / 0.3)) * 16, alpha: a });
  }
}

// ================================================================ render
window.renderFrame = async (t) => {
  const b = B.beat(t) + 1e-4, frame = Math.round(t * 30), s = shotAt(b);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  await s.fn({ t, b, lt: (b - s.b0) * SPB, lb: b - s.b0 });
  if (b < 91 && !(b >= 93.5)) cards(b);
  finish.apply(ctx, frame, { grain: 0.055, vignette: 0.3 });
};

for (const n of ['pal_man_l', 'pal_man_r']) await pack(n);

for (const [n, f] of [['apr1908', 'apr1908'], ['late1908', 'late1908'], ['plant1910', 'plant1910']]) await image(n, `${BASE}pan/${f}.jpg`);
for (const n of ['pal_man_l', 'pal_man_r']) await figure(n);
window.sceneReady = true;
