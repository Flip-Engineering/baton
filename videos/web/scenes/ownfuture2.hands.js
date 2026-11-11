// OWN THE FUTURE (cycle 6): the driver's hands on the wheel, traced from film.
// Ported from the HUMAN c4 driver cell (scenes/lab_people4.js S.driver) into this piece so the scene owns it:
// the grip is REAL (Master Hands IV, 1936, NFPF 31:07-31:09, Public Domain Mark 1.0; web/assets/roto/wheel_*),
// both hands taking the wheel at the film's own speed and closing ON the hit. Only the grip and the anatomy come
// from the film. The wheel is redrawn at Class 8 truck scale: a thick leather-wrapped rim (about twice the film
// wheel's section), four flat spokes, a big hub pad with the horn plate, and a column shroud, all in the film
// wheel's own ellipse so the fingers stay on the rim. The left hand is a leather work glove, the right is bare and
// two-valued (sun-dark skin, lit planes). No world is drawn here: the scene's own render is behind it.
import { loadRefSeq } from '../lib/fx/figure_ref.js';

const clamp01 = x => Math.min(1, Math.max(0, x));

export async function makeDriver({ k = 1.5, hubX = 560, hubY = 1330 } = {}) {
  const seq = await loadRefSeq('wheel'), m = seq.meta, fr = seq.frames, n = fr.length, E = m.ellipse;
  const P = { k, x0: hubX - E.cx * k, y0: hubY - E.cy * k };
  const X = x => P.x0 + x * P.k, Y = y => P.y0 + y * P.k;
  const raster = F => { const c = document.createElement('canvas'); c.width = Math.ceil(F.w * P.k); c.height = Math.ceil(F.h * P.k); const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(F.img, 0, 0, c.width, c.height); return { w: c.width, h: c.height, D: g.getImageData(0, 0, c.width, c.height).data }; };
  const R0 = raster(fr[0]), w = R0.w, h = R0.h, W0 = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) W0[i] = R0.D[i * 4 + 3] / 255;
  { // dilate the empty wheel (frame 0, before the hands arrive) so its rim and spokes are subtracted from the hands
    const r = Math.round(6 * P.k), tmp = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let mx = 0; for (let d = -r; d <= r; d += 2) { const xx = x + d; if (xx >= 0 && xx < w) mx = Math.max(mx, W0[y * w + xx]); } tmp[y * w + x] = mx; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let mx = 0; for (let d = -r; d <= r; d += 2) { const yy = y + d; if (yy >= 0 && yy < h) mx = Math.max(mx, tmp[yy * w + x]); } W0[y * w + x] = mx; }
  }
  const hubPx = X(E.cx) - P.x0, cache = new Map();
  const filt = (a, r, op) => { const t = new Float32Array(w * h), o = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = op === 'min' ? 1 : 0; for (let d = -r; d <= r; d++) { const q = a[y * w + Math.min(w - 1, Math.max(0, x + d))]; v = op === 'min' ? Math.min(v, q) : Math.max(v, q); } t[y * w + x] = v; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = op === 'min' ? 1 : 0; for (let d = -r; d <= r; d++) { const q = t[Math.min(h - 1, Math.max(0, y + d)) * w + x]; v = op === 'min' ? Math.min(v, q) : Math.max(v, q); } o[y * w + x] = v; }
    return o; };
  let norm = null;
  const hands = kk => { if (cache.has(kk)) return cache.get(kk); const R = raster(fr[kk]), A = new Float32Array(w * h), L = new Float32Array(w * h), G = new Uint8Array(w * h), S = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) { const a = R.D[i * 4 + 3] / 255; if (a < 0.02) continue; L[i] = (0.2126 * R.D[i * 4] + 0.7152 * R.D[i * 4 + 1] + 0.0722 * R.D[i * 4 + 2]) / 255 / Math.max(a, 0.05); }
    if (!norm) { const Rl = raster(fr[n - 1]), v = []; for (let i = 0; i < w * h; i += 3) { const a = Rl.D[i * 4 + 3] / 255; if (a > 0.6 && W0[i] < 0.5) v.push((0.2126 * Rl.D[i * 4] + 0.7152 * Rl.D[i * 4 + 1] + 0.0722 * Rl.D[i * 4 + 2]) / 255 / a); } v.sort((a, b) => a - b); norm = [v[Math.floor(v.length * 0.05)], v[Math.floor(v.length * 0.97)]]; }
    for (let i = 0; i < w * h; i++) { L[i] = clamp01((L[i] - norm[0]) / Math.max(0.05, norm[1] - norm[0])); S[i] = R.D[i * 4 + 3] > 5 ? clamp01((L[i] - 0.38) / 0.12) : 0; }
    const r = Math.max(2, Math.round(5 * P.k)), So = filt(filt(S, r, 'min'), r, 'max');
    const ca = Math.cos(-E.deg * Math.PI / 180), sa = Math.sin(-E.deg * Math.PI / 180), hx = E.cx * P.k, hy = E.cy * P.k;
    for (let i = 0; i < w * h; i++) { const a = R.D[i * 4 + 3] / 255; if (a < 0.02) continue; const x = i % w - hx, y = ((i / w) | 0) - hy, u = (x * ca - y * sa) / (E.a * P.k), v = (x * sa + y * ca) / (E.b * P.k);
      const hub = Math.hypot(u, v) < 0.8 ? 1 : 0;
      A[i] = a * Math.max(1 - W0[i], So[i] * (1 - hub)); G[i] = (i % w) < hubPx - 30 * P.k ? 1 : 0; }
    const o = { A, L, G }; cache.set(kk, o); return o; };
  const layer = document.createElement('canvas'); layer.width = w; layer.height = h; const lg = layer.getContext('2d');

  function wheel(g, rimC) {        // the Class 8 wheel in the film wheel's ellipse
    g.save(); g.translate(X(E.cx), Y(E.cy)); g.rotate(E.deg * Math.PI / 180); g.scale(E.a * P.k, E.b * P.k);
    g.fillStyle = '#0d0e10'; g.beginPath(); g.ellipse(0, 0, 0.44, 0.44, 0, 0, Math.PI * 2); g.fill();                       // hub pad
    g.strokeStyle = '#26282c'; g.lineWidth = 0.02; g.beginPath(); g.ellipse(0, 0, 0.33, 0.33, 0, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#1c1e22'; g.beginPath(); g.ellipse(0, 0, 0.16, 0.16, 0, 0, Math.PI * 2); g.fill();                        // horn plate
    g.fillStyle = '#23262a'; for (const a of [Math.PI * 0.92, Math.PI * 0.08, Math.PI * 0.62, Math.PI * 0.38]) { g.save(); g.rotate(a); g.fillRect(0.36, -0.07, 0.56, 0.14); g.restore(); }   // four flat spokes
    g.strokeStyle = '#070708'; g.lineWidth = 0.24; g.beginPath(); g.ellipse(0, 0, 0.95, 0.95, 0, 0, Math.PI * 2); g.stroke();   // the thick wrapped rim
    g.strokeStyle = 'rgba(58,60,64,0.55)'; g.lineWidth = 0.008; for (let q = 0; q < 110; q++) { const a = q / 110 * Math.PI * 2; g.beginPath(); g.moveTo(Math.cos(a) * 0.85, Math.sin(a) * 0.85); g.lineTo(Math.cos(a + 0.035) * 1.06, Math.sin(a + 0.035) * 1.06); g.stroke(); }   // stitched wrap
    { const th = Math.atan2(-1 / E.b, 0) - E.deg * Math.PI / 180, up = Math.atan2(Math.sin(th) * E.a, Math.cos(th) * E.b); g.strokeStyle = rimC; g.lineWidth = 0.028; g.beginPath(); g.ellipse(0, 0, 1.075, 1.075, 0, up - 1.0, up + 1.0); g.stroke(); }   // the port's sodium on the edge facing up
    g.restore();
  }
  // draw(g, t, hit): the hands close on `hit` (s); sweep = the gantry/port light crossing the knuckles into the hit
  return function draw(g, t, hit, { rimC = 'rgba(255,150,60,0.85)', lightC = [255, 150, 60] } = {}) {
    const kf = Math.max(0, Math.min(n - 1, Math.floor((t - (hit - (n - 1) / m.fps)) * m.fps))), kh = Math.round((t - hit) * 30);
    const sweepX = 1080 * (-0.2 + 1.1 * clamp01((t - (hit - 0.75)) / 0.75));
    const squeeze = kh >= 0 && kh < 4 ? [1, 0.8, 0.5, 0.2][kh] : 0;
    wheel(g, rimC);
    const Hn = hands(kf), im = lg.createImageData(w, h), D = im.data;
    for (let i = 0; i < w * h; i++) { const a = Hn.A[i]; if (a < 0.02) continue; const x = (i % w) + P.x0, y = ((i / w) | 0) + P.y0;
      const band = Math.exp(-Math.pow((x - sweepX + (y - 1300) * 0.35) / 150, 2)), l = Hn.L[i];
      let col;
      if (Hn.G[i]) { const sheen = clamp01((l - 0.5 + band * 0.4) / 0.1); col = [14 + 60 * sheen, 11 + 40 * sheen, 10 + 24 * sheen]; }
      else { const th = Math.max(0.4, 0.6 - 0.32 * band) + 0.08 * squeeze, lit = clamp01((l - th) / 0.06); col = [12 + (196 + 30 * band) * lit, 8 + (130 + 60 * band) * lit, 6 + (88 + 50 * band) * lit];
        col = col.map(v => v * (1 - 0.25 * squeeze)); }
      { const o = Math.round(3 * P.k), j = i - o * w + o, up = (i % w) + o < w && j >= 0 ? Hn.A[j] : 0, rim = clamp01((a - up) * 1.6) * 0.8;
        col = col.map((v, c) => v + (lightC[c] - v) * rim); }
      D[i * 4] = col[0]; D[i * 4 + 1] = col[1]; D[i * 4 + 2] = col[2]; D[i * 4 + 3] = Math.round(Math.min(1, a * 1.2) * 255); }
    lg.putImageData(im, 0, 0);
    const sq = 1 - 0.012 * squeeze; g.save(); g.translate(X(E.cx), Y(E.cy)); g.scale(sq, sq); g.translate(-X(E.cx), -Y(E.cy)); g.drawImage(layer, P.x0, P.y0); g.restore();
    return { frame: kf, licence: m.licence, tc: m.tc };
  };
}
