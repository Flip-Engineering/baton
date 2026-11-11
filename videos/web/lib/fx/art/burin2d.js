// ART kit / BURIN2D (cycle 2, change B): an image-based line engraver for stills, after the banknote engravers
// (G.F.C. Smillie and Charles Schlecht cut the 1896 Educational Series vignettes from Blashfield's paintings and from
// photographs) and Ostromoukhov, "Digital Facial Engraving" (SIGGRAPH 1999): a photograph is cut in lines whose WIDTH
// carries the tone (paper in the highlights, a swell to ~85 % of the pitch in the shade), a second family crosses at
// 55-65 degrees in the shade, dots and lozenges sit between the lines in the deepest darks, and every cut enters and
// leaves with the taper of the burin. The c1 engravers (intaglio3d/engrave.js, LOOKS INTAGLIO) laid lines that follow
// the form but do not carry tone, so figures read as grey contour maps with a white keyline: stickers. This one is
// driven by the tone of a real image: a found-footage frame of a real worker (Master Hands 1936, Steel 1938) or a
// HUMAN render.
//
//   import { toneField, burin, vignetteFrieze } from '../lib/fx/art/burin2d.js';
//   const T = toneField(canvas, { gamma: 1.0, lift: 0.0, matte: null });     // darkness 0 (paper) .. 1 (solid)
//   burin(ctx, T, { pitch: 6, ink: '#15110F', paper: '#EFE6CF', red: redMask });
//
// Lines follow the smoothed structure tensor of the image (along the isophotes: the lines run round the form, as an
// engraver's do over a cheek or a sleeve), blended toward a base angle where the image has no direction (flat areas get
// the plate's ruled angle). The streamlines are laid out evenly (Jobard and Lefer 1997, "Creating evenly-spaced
// streamlines of arbitrary density"): each line is traced along the field and stopped where it comes within dtest of
// another; new seeds are taken one pitch to either side of existing lines.
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

// darkness field from a canvas: D = 1 - curve(L). matte (Float32Array 0..1, or a function (x, y) -> 0..1) fades to paper.
export function toneField(src, { w = src.width, h = src.height, gamma = 1, lift = 0, gain = 1, matte = null, redFrom = null } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(src, 0, 0, w, h);
  const D = g.getImageData(0, 0, w, h).data, T = new Float32Array(w * h), red = redFrom ? new Float32Array(w * h) : null;
  for (let i = 0; i < w * h; i++) {
    const r = D[i * 4] / 255, gg = D[i * 4 + 1] / 255, b = D[i * 4 + 2] / 255, L = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    let d = clamp((1 - Math.pow(clamp(L), gamma)) * gain + lift);
    const m = matte ? (typeof matte === 'function' ? matte(i % w, (i / w) | 0) : matte[i]) : 1; d *= m;
    T[i] = d; if (red) red[i] = redFrom(r, gg, b, L) * m;
  }
  return { w, h, D: T, red };
}

function boxBlur(a, w, h, r) {        // separable box blur, 3 passes ~ gaussian
  const tmp = new Float32Array(w * h), out = a.slice();
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) { let s = 0; const o = y * w; for (let x = -r; x <= r; x++) s += out[o + clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) { tmp[o + x] = s / (2 * r + 1); s += out[o + Math.min(w - 1, x + r + 1)] - out[o + Math.max(0, x - r)]; } }
    for (let x = 0; x < w; x++) { let s = 0; for (let y = -r; y <= r; y++) s += tmp[clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) { out[y * w + x] = s / (2 * r + 1); s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; } }
  }
  return out;
}

// the direction field (half resolution): line direction = along the isophotes, blended to base where incoherent
export function directionField(T, { base = -0.5, sigma = 3, rho = 10, coherent = 0.35, step = 2 } = {}) {
  const { w, h, D } = T, W = Math.ceil(w / step), H = Math.ceil(h / step), d = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d[y * W + x] = D[Math.min(h - 1, y * step) * w + Math.min(w - 1, x * step)];
  const s = boxBlur(d, W, H, Math.max(1, Math.round(sigma / step)));
  const jxx = new Float32Array(W * H), jxy = new Float32Array(W * H), jyy = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x, gx = (s[i + 1] - s[i - 1]) * 0.5, gy = (s[i + W] - s[i - W]) * 0.5; jxx[i] = gx * gx; jxy[i] = gx * gy; jyy[i] = gy * gy; }
  const R = Math.max(1, Math.round(rho / step)), A = boxBlur(jxx, W, H, R), B = boxBlur(jxy, W, H, R), C = boxBlur(jyy, W, H, R);
  const cx = new Float32Array(W * H), cy = new Float32Array(W * H), b2c = Math.cos(2 * base), b2s = Math.sin(2 * base);
  let emax = 1e-9; for (let i = 0; i < W * H; i++) emax = Math.max(emax, A[i] + C[i]);
  for (let i = 0; i < W * H; i++) {
    const tr = A[i] + C[i], df = A[i] - C[i], root = Math.sqrt(df * df + 4 * B[i] * B[i]);
    const coh = tr > 1e-12 ? root / tr : 0, strength = clamp(tr / (emax * 0.08));
    const k = clamp(coh * strength / coherent);
    // gradient angle doubled: (df, 2B)/root; line direction = gradient + 90 deg -> doubled angle + 180 deg (negate)
    const gx = root > 1e-12 ? -df / root : 0, gy = root > 1e-12 ? -2 * B[i] / root : 0;
    const vx = k * gx + (1 - k) * b2c, vy = k * gy + (1 - k) * b2s, a = 0.5 * Math.atan2(vy, vx);
    cx[i] = Math.cos(a); cy[i] = Math.sin(a);
  }
  return { W, H, step, cx, cy };
}
function dirAt(F, x, y, rot, out) {
  const fx = clamp(x / F.step, 0, F.W - 1.001), fy = clamp(y / F.step, 0, F.H - 1.001), i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, k = j * F.W + i;
  // orientations are sign-free: align the four corners to the first before blending
  let ax = F.cx[k], ay = F.cy[k]; let sx = ax * (1 - u) * (1 - v), sy = ay * (1 - u) * (1 - v);
  for (const [kk, wt] of [[k + 1, u * (1 - v)], [k + F.W, (1 - u) * v], [k + F.W + 1, u * v]]) { let bx = F.cx[kk], by = F.cy[kk]; if (bx * ax + by * ay < 0) { bx = -bx; by = -by; } sx += bx * wt; sy += by * wt; }
  const l = Math.hypot(sx, sy) || 1; let dx = sx / l, dy = sy / l;
  if (rot) { const c = Math.cos(rot), s = Math.sin(rot); const t = dx * c - dy * s; dy = dx * s + dy * c; dx = t; }
  out[0] = dx; out[1] = dy; return out;
}

// evenly spaced streamlines over a w x h field
export function streamlines(F, w, h, { dsep = 6, dtest = 0.55, rot = 0, maxLen = 4000, stepLen = 1, keep = null, seed = 1 } = {}) {
  const cs = dsep, GW = Math.ceil(w / cs), GH = Math.ceil(h / cs), grid = Array.from({ length: GW * GH }, () => []);
  const lines = [], dt = dsep * dtest, dt2 = dt * dt, dir = [0, 0], d2 = [0, 0];
  const ok = (x, y, id, lastIdx) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    if (keep && !keep(x, y)) return false;
    const gx = (x / cs) | 0, gy = (y / cs) | 0;
    for (let j = Math.max(0, gy - 1); j <= Math.min(GH - 1, gy + 1); j++) for (let i = Math.max(0, gx - 1); i <= Math.min(GW - 1, gx + 1); i++)
      for (const p of grid[j * GW + i]) { if (p[2] === id && Math.abs(p[3] - lastIdx) < dsep * 3) continue; const dx = p[0] - x, dy = p[1] - y; if (dx * dx + dy * dy < dt2) return false; }
    return true;
  };
  const trace = (sx, sy, id) => {
    const half = sg => { const pts = []; let x = sx, y = sy, px = 0, py = 0, first = true;
      for (let n = 0; n < maxLen; n++) {
        dirAt(F, x, y, rot, dir); let dx = dir[0] * sg, dy = dir[1] * sg; if (!first && dx * px + dy * py < 0) { dx = -dx; dy = -dy; }
        dirAt(F, x + dx * stepLen * 0.5, y + dy * stepLen * 0.5, rot, d2); let ex = d2[0], ey = d2[1]; if (ex * dx + ey * dy < 0) { ex = -ex; ey = -ey; }
        const nx = x + ex * stepLen, ny = y + ey * stepLen; if (!ok(nx, ny, id, sg * (n + 1))) break;
        x = nx; y = ny; px = ex; py = ey; first = false; sg = sg; pts.push([x, y]);
        if (n > 8 && pts.length > 20) { const q = pts[pts.length - 20]; if (Math.hypot(q[0] - x, q[1] - y) < 2) break; }   // stuck in a sink
      } return pts; };
    const a = half(1), b = half(-1); return b.reverse().concat([[sx, sy]], a);
  };
  const add = (pts, id) => { pts.forEach((p, k) => { const gx = (p[0] / cs) | 0, gy = (p[1] / cs) | 0; if (gx >= 0 && gy >= 0 && gx < GW && gy < GH) grid[gy * GW + gx].push([p[0], p[1], id, k - pts.length / 2]); }); };
  const queue = [];
  let rs = seed * 9301 + 49297; const rnd = () => (rs = (rs * 9301 + 49297) % 233280) / 233280;
  const tryLine = (x, y) => { if (!ok(x, y, -1, 0)) return; const id = lines.length, pts = trace(x, y, id); if (pts.length < 6) return; lines.push(pts); add(pts, id); queue.push(id); };
  // seeds: a coarse lattice (so disconnected regions are reached), expanded from each line
  for (let y = dsep * 0.5; y < h; y += dsep * 9) for (let x = dsep * 0.5; x < w; x += dsep * 9) {
    tryLine(x + rnd() * dsep, y + rnd() * dsep);
    while (queue.length) { const L = lines[queue.shift()];
      for (let k = 0; k < L.length; k += Math.max(2, dsep >> 1)) { const p = L[k], q = L[Math.min(L.length - 1, k + 1)], r0 = L[Math.max(0, k - 1)];
        let tx = q[0] - r0[0], ty = q[1] - r0[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
        tryLine(p[0] - ty * dsep, p[1] + tx * dsep); tryLine(p[0] + ty * dsep, p[1] - tx * dsep); } }
  }
  return lines;
}

// cut the lines: width from tone, tapered entries and exits, runs broken in the highlights
function cutLines(g, lines, widthAt, { taper = 7, minW = 0.25, color = '#15110F' } = {}) {
  g.fillStyle = color;
  for (const L of lines) {
    const n = L.length; if (n < 3) continue;
    const W = new Float32Array(n); for (let k = 0; k < n; k++) W[k] = widthAt(L[k][0], L[k][1]);
    let k = 0;
    while (k < n) {
      while (k < n && W[k] < minW) k++; const s = k; while (k < n && W[k] >= minW) k++; const e = k;
      if (e - s < 3) continue;
      const left = [], right = [];
      for (let i = s; i < e; i++) {
        const p = L[i], q = L[Math.min(e - 1, i + 1)], r = L[Math.max(s, i - 1)]; let tx = q[0] - r[0], ty = q[1] - r[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
        const tp = Math.min(1, (i - s + 0.5) / taper, (e - 1 - i + 0.5) / taper), hw = 0.5 * W[i] * (0.25 + 0.75 * Math.sqrt(Math.max(0, tp)));
        left.push([p[0] - ty * hw, p[1] + tx * hw]); right.push([p[0] + ty * hw, p[1] - tx * hw]);
      }
      g.beginPath(); g.moveTo(left[0][0], left[0][1]); for (let i = 1; i < left.length; i++) g.lineTo(left[i][0], left[i][1]);
      for (let i = right.length - 1; i >= 0; i--) g.lineTo(right[i][0], right[i][1]); g.closePath(); g.fill();
    }
  }
}

// engrave a tone field onto ctx (at ox, oy): Ostromoukhov's "universal copperplate". Each pixel knows its distance to
// the nearest line of the plate (a line family = the level sets of a phase field) and is inked if that distance is
// under half the line's width, and the width is set by the tone. The phase is the plate's ruling angle DISPLACED by the
// low-passed tone (warp, in line periods), so the lines bend and crowd over the form as a portrait engraver's do (the
// swelling, wavering lines of a note vignette) instead of drawing contour rings. Line ends taper by themselves where the
// tone falls to paper. Family B crosses at `cross` radians in the shade; dots/lozenges sit between the lines in the
// deepest darks. `mode: 'stream'` uses the evenly spaced streamlines instead (kept for experiments; it drew contour
// rings on the c2 frieze and is not the default).
export function burin(g, T, { pitch = 6, ink = '#15110F', paper = '#EFE6CF', redInk = '#D71920', base = -0.5, cross = 1.05, dots = true, ox = 0, oy = 0, fill = true, seed = 3,
  maxA = 0.8, crossFrom = 0.55, dotFrom = 0.9, warp = 2.4, warpBlur = 6, mode = 'plate' } = {}) {
  const t0 = performance.now(), { w, h, D, red } = T;
  if (mode === 'stream') return burinStream(g, T, arguments[2]);
  const Ds = boxBlur(D, w, h, 1), Dl = boxBlur(D, w, h, warpBlur), Rm = red ? boxBlur(red, w, h, 2) : null;
  const hx = s => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)], I = hx(ink), P = hx(paper), Rd = hx(redInk);
  if (!fill) g.save();
  const im = fill ? g.createImageData(w, h) : g.getImageData(ox, oy, w, h), O = im.data;
  const ca0 = Math.cos(base), sa0 = Math.sin(base), cb0 = Math.cos(base + cross), sb0 = Math.sin(base + cross), cd0 = Math.cos(base + 0.8), sd0 = Math.sin(base + 0.8);
  const cov = (ph, hw) => { const f = ph - Math.floor(ph), dist = Math.abs(f - 0.5) * pitch; return Math.min(1, Math.max(0, hw - (pitch * 0.5 - dist) + 0.5)); };
  // note: dist from the line CENTRE is (0.5 - |f - 0.5|) * pitch; lines sit at f = 0
  const lineCov = (ph, hw) => { const f = ph - Math.floor(ph), dc = Math.min(f, 1 - f) * pitch; return Math.min(1, Math.max(0, hw - dc + 0.5)) * Math.min(1, hw * 2); };   // c2b: a hairline fades out instead of stepping to a half-covered line (the hard edge at every fade)
  const AN = T.ang || null;   // c2b: per-part ruling angle (vignetteFrieze parts with `angle`); NaN = the plate's base
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, d = Ds[i], dl = Dl[i];
    let a = 0, ca = ca0, sa = sa0, cb = cb0, sb = sb0, cd = cd0, sd = sd0;
    if (AN && AN[i] === AN[i]) { const t = AN[i]; ca = Math.cos(t); sa = Math.sin(t); cb = Math.cos(t + cross); sb = Math.sin(t + cross); cd = Math.cos(t + 0.8); sd = Math.sin(t + 0.8); }
    if (d > 0.02) {
      const u = (x * ca + y * sa) / pitch + warp * dl;
      const hwA = 0.5 * pitch * Math.min(maxA, Math.max(0, (d - 0.03) * 1.02));      // coverage ~ darkness (the plate carries the tone)
      a = lineCov(u, hwA);
      if (cross && d > crossFrom) { const v = (x * cb + y * sb) / (pitch * 1.05) + warp * 0.6 * dl, hwB = 0.5 * pitch * 0.6 * Math.pow((d - crossFrom) / (1 - crossFrom), 1.1); a = Math.max(a, lineCov(v, hwB)); }
      if (dots && d > dotFrom) { const du = (x * cd + y * sd) / pitch, dv = (-x * sd + y * cd) / pitch, fu = du - Math.floor(du) - 0.5, fv = dv - Math.floor(dv) - 0.5, r = 0.32 * Math.min(1, (d - dotFrom) / (1 - dotFrom) + 0.4);
        const e = Math.hypot(fu / 1.3, fv / 0.75); a = Math.max(a, Math.min(1, Math.max(0, (r - e) * pitch + 0.5))); }
    }
    const o = i * 4, r = Rm ? Math.min(1, Math.max(0, (Rm[i] - 0.3) * 4)) : 0;
    const bg0 = fill ? P : [O[o], O[o + 1], O[o + 2]];
    for (let c = 0; c < 3; c++) { const bgc = bg0[c] * (1 - r) + Rd[c] * r; O[o + c] = bgc * (1 - a * (r > 0.5 ? 0.35 : 1)) + I[c] * a * (r > 0.5 ? 0.35 : 1); }
    O[o + 3] = 255;
  }
  g.putImageData(im, ox, oy);
  if (!fill) g.restore();
  return { mode, ms: Math.round(performance.now() - t0) };
}
function burinStream(g, T, { pitch = 6, ink = '#15110F', paper = '#EFE6CF', base = -0.5, cross = 1.05, ox = 0, oy = 0, fill = true, seed = 3, maxA = 0.72, crossFrom = 0.52, field = null } = {}) {
  const { w, h, D } = T, at = (A, x, y) => A[clamp(Math.round(y), 0, h - 1) * w + clamp(Math.round(x), 0, w - 1)], Ds = boxBlur(D, w, h, 1);
  g.save(); g.translate(ox, oy); if (fill) { g.fillStyle = paper; g.fillRect(0, 0, w, h); }
  const F = field || directionField(T, { base });
  const A = streamlines(F, w, h, { dsep: pitch, keep: (x, y) => at(Ds, x, y) > 0.03, seed });
  cutLines(g, A, (x, y) => pitch * maxA * Math.pow(clamp((at(Ds, x, y) - 0.04) / 0.62), 0.85), { color: ink, taper: pitch * 1.3 });
  const B = cross ? streamlines(F, w, h, { dsep: pitch * 1.05, rot: cross, keep: (x, y) => at(Ds, x, y) > crossFrom, seed: seed + 7 }) : [];
  cutLines(g, B, (x, y) => pitch * 0.62 * Math.pow(clamp((at(Ds, x, y) - crossFrom) / (1 - crossFrom)), 0.8), { color: ink, taper: pitch });
  g.restore(); return { mode: 'stream', lines: A.length, cross: B.length };
}

// ---------------------------------------------------------------- the banknote vignette frieze
// Places cropped regions of real frames into one tone field, each fading to paper through a soft oval (the vignette
// edge of a BEP note), the figures overlapping in a shallow pyramid, then engraves the whole as ONE plate (one line
// system, so the figures belong to one picture). parts: [{ img, crop: [x, y, w, h], at: [x, y, w, h], feather, tone:
// { gamma, gain, lift }, red: fn(r,g,b,L) -> 0..1 }]. Returns the tone field for burin().
export function vignetteFrieze(parts, { w = 1080, h = 1080, sky = null, clarity = 0.9, clarityR = 26, floor = 0.72 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true });
  const D = new Float32Array(w * h), red = new Float32Array(w * h), wsum = new Float32Array(w * h);
  const ang = parts.some(P => P.angle != null) ? new Float32Array(w * h).fill(NaN) : null;
  for (const P of parts) {
    const [x0, y0, pw, ph] = P.at; g.clearRect(0, 0, w, h); g.drawImage(P.img, ...P.crop, x0, y0, pw, ph);
    const im = g.getImageData(0, 0, w, h).data, tn = P.tone || {}, fe = P.feather ?? 0.22, wt0 = P.weight ?? 1;
    for (let y = Math.max(0, y0 | 0); y < Math.min(h, y0 + ph); y++) for (let x = Math.max(0, x0 | 0); x < Math.min(w, x0 + pw); x++) {
      const i = y * w + x, u = (x - x0) / pw * 2 - 1, v = (y - y0) / ph * 2 - 1;
      const rr = P.shape === 'rect' ? Math.max(Math.abs(u), Math.abs(v)) : Math.hypot(u, v * (P.oval ?? 1));
      let m = P.alpha ? im[i * 4 + 3] / 255 : clamp((1 - rr) / fe);   // alpha: a cut-out figure (mattes_c2.py) keeps its own edge if (P.floor && v > 0) m = Math.max(m, clamp((1 - Math.abs(u)) / fe) * clamp((1 - v) / 0.02 + 1));   // grounded parts do not fade at their feet
      if (m <= 0) continue;
      const r = im[i * 4] / 255, gg = im[i * 4 + 1] / 255, b = im[i * 4 + 2] / 255, L = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
      const d = clamp((1 - Math.pow(L, tn.gamma ?? 1)) * (tn.gain ?? 1) + (tn.lift ?? 0));
      const wgt = m * wt0; D[i] = D[i] * (1 - wgt) + d * wgt * 1; wsum[i] = Math.max(wsum[i], m);
      if (ang && P.angle != null && m > 0.5) ang[i] = P.angle;
      if (P.red) red[i] = Math.max(red[i] * (1 - wgt), P.red(r, gg, b, L) * m);
    }
  }
  // clarity: the engraver's choice of values. Local contrast against a wide blur separates the figure from the shop dark
  // (a note vignette never has a solid black ground), and the darks are compressed under `floor` so the ground stays line.
  if (clarity) { const Bl = boxBlur(D, w, h, clarityR); for (let i = 0; i < w * h; i++) { let d = D[i] + clarity * (D[i] - Bl[i]); d = d > floor ? floor + (d - floor) * 0.45 : d; D[i] = clamp(d); } }
  if (red.some(v => v > 0)) { const Rb = boxBlur(red, w, h, 5); for (let i = 0; i < w * h; i++) red[i] = clamp(Rb[i] * 2.2); }
  for (let i = 0; i < w * h; i++) { D[i] *= clamp(wsum[i] * 1.2); if (sky) D[i] = Math.max(D[i], sky(i % w, (i / w) | 0) * (1 - wsum[i])); }
  return ang ? { w, h, D, red, ang } : { w, h, D, red };
}

// resample a tone field (bilinear) so the plate is engraved at the size it is shown: lines resampled after cutting moire
export function resampleTone(T, w2, h2) {
  const { w, h, D, red, ang } = T, D2 = new Float32Array(w2 * h2), R2 = red ? new Float32Array(w2 * h2) : null, A2 = ang ? new Float32Array(w2 * h2) : null;
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) { const fx = Math.min(w - 1.001, (x + 0.5) * w / w2 - 0.5), fy = Math.min(h - 1.001, (y + 0.5) * h / h2 - 0.5), i = Math.max(0, fx | 0), j = Math.max(0, fy | 0), u = fx - i, v = fy - j, k = j * w + i;
    const bl = A => A[k] * (1 - u) * (1 - v) + A[k + 1] * u * (1 - v) + A[k + w] * (1 - u) * v + A[k + w + 1] * u * v; D2[y * w2 + x] = bl(D); if (R2) R2[y * w2 + x] = bl(red);
    if (A2) A2[y * w2 + x] = ang[Math.round(fy) * w + Math.round(fx)]; }
  return A2 ? { w: w2, h: h2, D: D2, red: R2, ang: A2 } : { w: w2, h: h2, D: D2, red: R2 };
}
