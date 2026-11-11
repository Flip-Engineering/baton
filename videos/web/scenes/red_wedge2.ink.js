// RED WEDGE v8: print and material helpers (paper, rough ink, words stamped/branded/carved/stencilled into a
// material, silhouette crowds at crowd scale, halftone and silkscreen plates). Canvas 2D only; everything heavy is
// baked once at load. Used by red_wedge2.js only.
import { W, H, clamp, lerp, rng, setFont } from '../lib/kit.js';
import { noise3 } from '../lib/fx/physics.js';

export const TAU = Math.PI * 2;
export function mk(w, h, fn) { const c = document.createElement('canvas'); c.width = Math.ceil(w); c.height = Math.ceil(h); if (fn) fn(c.getContext('2d'), c); return c; }
export const fbm = (x, y, z, o = 3) => { let s = 0, a = 0.5; for (let i = 0; i < o; i++) { s += a * noise3(x, y, z); x *= 2.03; y *= 2.03; z *= 2.03; a *= 0.5; } return s; };
export function pixels(w, h, fn) {
  return mk(w, h, g => {
    const id = g.createImageData(w, h), d = id.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = fn(x, y), i = (y * w + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3] ?? 255; }
    g.putImageData(id, 0, 0);
  });
}
export const mix3 = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

// ---------------------------------------------------------------- paper and ink
// a cream poster stock: fibre, mottle and tooth (baked once)
export const PAPER = (() => {
  const r = rng(71);
  const c = pixels(540, 960, (x, y) => {
    const m = fbm(x * 0.012, y * 0.012, 2, 3) * 0.5 + noise3(x * 0.3, y * 0.05, 4) * 0.12, f = r() * 0.1;
    const v = 1 + m * 0.18 - f;
    return [236 * v, 224 * v, 202 * v];
  });
  return mk(W, H, g => { g.imageSmoothingEnabled = true; g.drawImage(c, 0, 0, W, H); });
})();
// a speckle tile for ink voids (where the ink failed to take)
export const SPECK = (() => {
  const r = rng(9);
  return pixels(256, 256, (x, y) => { const n = noise3(x * 0.21, y * 0.21, 3) + 0.5 * noise3(x * 0.6, y * 0.6, 8); const v = r(); return [0, 0, 0, n > 0.42 || v < 0.03 ? 255 : 0]; });
})();

// rough the edge of whatever is drawn in c: blur, add noise, re-threshold the alpha
export function roughen(c, { blur = 2, amt = 0.35, scale = 0.08, seed = 1, speck = 0 } = {}) {
  const g = c.getContext('2d');
  const tmp = mk(c.width, c.height, t => { t.filter = `blur(${blur}px)`; t.drawImage(c, 0, 0); });
  const id = tmp.getContext('2d').getImageData(0, 0, c.width, c.height), src = g.getImageData(0, 0, c.width, c.height), d = id.data, s = src.data;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const i = (y * c.width + x) * 4, a = d[i + 3] / 255;
    const n = noise3(x * scale, y * scale, seed) * 0.7 + noise3(x * scale * 3.1, y * scale * 3.1, seed + 3) * 0.3;
    let v = clamp((a - 0.5 + n * amt) * 6 + 0.5);
    if (speck && noise3(x * 0.35, y * 0.35, seed + 9) > 1 - speck) v *= 0.15;
    if (s[i + 3] === 0 && v > 0) { s[i] = d[i]; s[i + 1] = d[i + 1]; s[i + 2] = d[i + 2]; }
    s[i + 3] = v * 255;
  }
  g.putImageData(src, 0, 0);
  return c;
}

// ---------------------------------------------------------------- words in the material
// Each returns a canvas holding the word centred, with `pad` px round it. Cached by key.
const WORDS = new Map();
function measure(text, family, size, track) {
  const g = mk(4, 4).getContext('2d'); setFont(g, family, size);
  let w = 0; const adv = [];
  for (const ch of text) { const a = g.measureText(ch).width; adv.push(a); w += a + track * size; }
  return { w: w - track * size, adv };
}
let LASTW = 0;
function textMask(text, { family = 'Anton', size = 200, track = 0.02, pad = 60, color = '#000', stencil = false } = {}) {
  const m = measure(text, family, size, track); LASTW = m.w; const cw = m.w + pad * 2, ch = size * 1.25 + pad * 2;
  return mk(cw, ch, g => {
    setFont(g, family, size); g.textBaseline = 'middle'; g.fillStyle = color;
    let x = pad; const y = ch / 2 + size * 0.04;
    [...text].forEach((c, i) => {
      g.fillText(c, x, y);
      if (stencil && 'OADRPBQ04689'.includes(c)) {            // stencil bridges through the counters
        g.save(); g.globalCompositeOperation = 'destination-out'; g.fillRect(x + m.adv[i] * 0.5 - size * 0.035, y - size * 0.6, size * 0.07, size * 1.2); g.restore();
      }
      x += m.adv[i] + track * size;
    });
  });
}
export function word(text, style, size, o = {}) {
  const key = [text, style, size, JSON.stringify(o)].join('|');
  if (WORDS.has(key)) return WORDS.get(key);
  let out;
  const seed = (text.length * 31 + size) % 97;
  if (style === 'brand') {                                   // burnt into wood: scorch halo, charred core, cracked char
    const core = roughen(textMask(text, { size, track: 0.04, color: '#170803' }), { blur: 3, amt: 0.5, scale: 0.06, seed, speck: 0.06 });
    out = mk(core.width, core.height, g => {
      g.filter = 'blur(14px)'; g.globalAlpha = 0.75; g.drawImage(tintC(core, '#5a2408'), 0, 0);
      g.filter = 'blur(4px)'; g.globalAlpha = 0.9; g.drawImage(tintC(core, '#2a0e04'), 0, 0);
      g.filter = 'none'; g.globalAlpha = 1; g.drawImage(core, 0, 0);
      g.globalCompositeOperation = 'source-atop'; g.globalAlpha = 0.25; g.fillStyle = g.createPattern(SPECK, 'repeat'); g.fillRect(0, 0, core.width, core.height);
    });
  } else if (style === 'stencil') {                          // spray paint through a stencil: overspray, bridges, drips
    const col = o.color || '#d4101c';
    const core = roughen(textMask(text, { family: 'Archivo Black', size, track: 0.06, color: col, stencil: true, pad: 90 }), { blur: 1.5, amt: 0.25, scale: 0.2, seed });
    out = mk(core.width, core.height + size * 0.5, g => {
      g.filter = 'blur(9px)'; g.globalAlpha = 0.35; g.drawImage(core, 0, 0);
      g.filter = 'none'; g.globalAlpha = 1; g.drawImage(core, 0, 0);
      const r = rng(seed + 4); g.fillStyle = col;                               // drips run from the letter bottoms
      for (let i = 0; i < 9; i++) {
        const x = 90 + r() * (core.width - 180), y0 = core.height / 2 + size * 0.36, L = 20 + r() * size * 0.5, w = 3 + r() * 5;
        const d = g.getImageData(x | 0, (y0 - 6) | 0, 1, 1).data; if (d[3] < 128) continue;
        g.fillRect(x - w / 2, y0 - 6, w, L); g.beginPath(); g.arc(x, y0 - 6 + L, w * 0.8, 0, TAU); g.fill();
      }
      g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 0.5; g.fillStyle = g.createPattern(SPECK, 'repeat'); g.fillRect(0, 0, core.width, core.height + size);
    });
  } else if (style === 'carve') {                            // V-cut in stone: dark floor, lit lower lip, shadowed top
    const m = roughen(textMask(text, { family: o.family || 'Anton', size, track: o.track ?? 0.08, color: '#000' }), { blur: 1, amt: 0.15, scale: 0.15, seed });
    out = mk(m.width, m.height, g => {
      g.globalAlpha = 0.65; g.drawImage(tintC(m, o.lip || '#fff6ea'), 3, 4);
      g.globalAlpha = 1; g.drawImage(tintC(m, o.floor || '#1c1618'), 0, 0);
      g.globalCompositeOperation = 'source-atop'; const gr = g.createLinearGradient(0, m.height * 0.3, 0, m.height * 0.7);
      gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0.08)'); g.fillStyle = gr; g.fillRect(0, 0, m.width, m.height);
    });
  } else if (style === 'chalk') {                            // soapstone on granite
    const m = roughen(textMask(text, { family: 'Anton', size, track: 0.05, color: o.color || '#f2ece2' }), { blur: 2, amt: 0.4, scale: 0.09, seed, speck: 0.05 });
    out = mk(m.width, m.height, g => { g.drawImage(m, 0, 0); g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 0.35; g.fillStyle = g.createPattern(SPECK, 'repeat'); g.fillRect(0, 0, m.width, m.height); });
  } else if (style === 'paint') {                            // white paint stencil on steel
    const m = roughen(textMask(text, { family: 'Archivo Black', size, track: 0.08, color: o.color || '#eeeae2', stencil: true }), { blur: 1.2, amt: 0.3, scale: 0.18, seed });
    out = mk(m.width, m.height, g => { g.drawImage(m, 0, 0); g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 0.3; g.fillStyle = g.createPattern(SPECK, 'repeat'); g.fillRect(0, 0, m.width, m.height); });
  } else if (style === 'cast') {                             // molten steel run into letter channels in a sand mould
    const m = roughen(textMask(text, { family: 'Anton', size, track: 0.06, color: '#fff' }), { blur: 2, amt: 0.2, scale: 0.1, seed });
    out = mk(m.width, m.height, g => {
      g.filter = 'blur(22px)'; g.drawImage(tintC(m, '#ff4a0a'), 0, 0); g.filter = 'blur(6px)'; g.drawImage(tintC(m, '#ff9a2a'), 0, 0);
      g.filter = 'none'; g.drawImage(tintC(m, '#ffe7a8'), 0, 0);
      g.globalCompositeOperation = 'source-atop'; g.globalAlpha = 0.35; g.drawImage(tintC(SPECKBIG(), '#ff7a18'), 0, 0);
    });
  } else if (style === 'poster') {                           // flat poster ink, a clean print edge
    out = roughen(textMask(text, { family: o.family || 'Anton', size, track: o.track ?? 0.02, color: o.color || '#140606', pad: 40 }), { blur: 1, amt: 0.12, scale: 0.3, seed });
  }
  out.inkW = LASTW;
  WORDS.set(key, out);
  return out;
}
const tintCache = new Map();
export function tintC(c, col) {
  const k = c; if (!tintCache.has(k)) tintCache.set(k, new Map());
  const m = tintCache.get(k); if (m.has(col)) return m.get(col);
  const o = mk(c.width, c.height, g => { g.drawImage(c, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = col; g.fillRect(0, 0, c.width, c.height); });
  m.set(col, o); return o;
}
let _sb = null;
function SPECKBIG() { return _sb || (_sb = mk(1600, 600, g => { g.fillStyle = g.createPattern(SPECK, 'repeat'); g.fillRect(0, 0, 1600, 600); })); }

// draw a word canvas centred at (x, y), rotated, scaled to height h of the cap (size units)
export function put(ctx, c, x, y, { rot = 0, scale = 1, alpha = 1, op = 'source-over', maxW = 0 } = {}) {
  if (maxW && c.inkW) scale *= Math.min(1, maxW / (c.inkW * scale));
  ctx.save(); ctx.globalAlpha *= alpha; ctx.globalCompositeOperation = op;
  ctx.translate(x, y); ctx.rotate(rot); ctx.scale(scale, scale); ctx.drawImage(c, -c.width / 2, -c.height / 2); ctx.restore();
}

// ---------------------------------------------------------------- silhouette people at crowd scale (from behind)
// One worker from behind: shoulders, neck, head, a hat, and maybe a raised fist or a tool on the shoulder. s = shoulder
// width in px, (x, y) = the shoulder line's centre. pump 0..1 raises the arm. All params come from rng; no two alike.
export function person(g, x, y, s, P, pump = 0) {
  const hw = s / 2, hr = s * P.head, ny = y - s * 0.12;
  g.beginPath();                                              // torso: shoulders to below the frame
  g.moveTo(x - hw * 1.05, y + s * 3);
  g.lineTo(x - hw * P.taper, y + s * 0.35);
  g.quadraticCurveTo(x - hw, y - s * 0.02, x - hw * 0.55, y - s * 0.08);
  g.lineTo(x - s * 0.12, ny); g.lineTo(x + s * 0.12, ny);
  g.lineTo(x + hw * 0.55, y - s * 0.08);
  g.quadraticCurveTo(x + hw, y - s * 0.02, x + hw * P.taper, y + s * 0.35);
  g.lineTo(x + hw * 1.05, y + s * 3); g.closePath(); g.fill();
  const hx = x + P.lean * s, hy = ny - hr * 0.95;
  g.beginPath(); g.ellipse(hx, hy, hr * 0.92, hr, P.tilt, 0, TAU); g.fill();                 // head
  if (P.hat === 'hard') {
    g.beginPath(); g.ellipse(hx, hy - hr * 0.25, hr * 1.12, hr * 0.95, P.tilt, Math.PI, TAU); g.fill();
    g.beginPath(); g.ellipse(hx, hy - hr * 0.2, hr * 1.42, hr * 0.2, P.tilt, 0, TAU); g.fill();  // the brim
    g.fillRect(hx - hr * 0.08, hy - hr * 1.28, hr * 0.16, hr * 0.5);                            // the ridge
  } else if (P.hat === 'cap') {
    g.beginPath(); g.ellipse(hx, hy - hr * 0.2, hr * 1.02, hr * 0.9, P.tilt, Math.PI, TAU); g.fill();
    g.beginPath(); g.ellipse(hx + hr * 0.9 * P.bill, hy - hr * 0.12, hr * 0.7, hr * 0.14, P.tilt + 0.1 * P.bill, 0, TAU); g.fill();
  } else if (P.hat === 'beanie') {
    g.beginPath(); g.ellipse(hx, hy - hr * 0.35, hr * 0.98, hr * 1.05, P.tilt, Math.PI, TAU); g.fill();
  }
  if (P.arm) {                                               // a raised fist (upper arm, forearm, fist), or a tool
    const side = P.arm, sx = x + side * hw * 0.78, sy = y + s * 0.05;
    const a0 = -Math.PI / 2 + side * lerp(0.75, 0.2, pump) * P.spread, L1 = s * 0.62, L2 = s * 0.58, aw = s * 0.2;
    const ex = sx + Math.cos(a0) * L1, ey = sy + Math.sin(a0) * L1;
    const a1 = a0 - side * lerp(0.9, 0.12, pump) * P.bend, fx = ex + Math.cos(a1) * L2, fy = ey + Math.sin(a1) * L2;
    g.lineCap = 'round'; g.lineWidth = aw; g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey); g.lineTo(fx, fy); g.stroke();
    g.lineWidth = aw * 0.9;
    if (P.tool === 'sledge') {                               // a sledge held high: handle through the fist, head at the top
      const ta = a1 - side * 0.5, tx = fx + Math.cos(ta) * s * 0.9, ty = fy + Math.sin(ta) * s * 0.9;
      g.lineWidth = s * 0.07; g.beginPath(); g.moveTo(fx - Math.cos(ta) * s * 0.2, fy - Math.sin(ta) * s * 0.2); g.lineTo(tx, ty); g.stroke();
      g.save(); g.translate(tx, ty); g.rotate(ta + Math.PI / 2); g.fillRect(-s * 0.2, -s * 0.09, s * 0.4, s * 0.18); g.restore();
    } else if (P.tool === 'shovel') {
      const ta = a1 - side * 0.3, tx = fx + Math.cos(ta) * s * 1.1, ty = fy + Math.sin(ta) * s * 1.1;
      g.lineWidth = s * 0.06; g.beginPath(); g.moveTo(fx, fy); g.lineTo(tx, ty); g.stroke();
      g.save(); g.translate(tx, ty); g.rotate(ta - Math.PI / 2); g.beginPath(); g.moveTo(-s * 0.13, 0); g.lineTo(s * 0.13, 0); g.lineTo(s * 0.11, s * 0.3); g.lineTo(0, s * 0.38); g.lineTo(-s * 0.11, s * 0.3); g.closePath(); g.fill(); g.restore();
    }
    g.save(); g.translate(fx, fy); g.rotate(a1 + Math.PI / 2);   // the fist: knuckles, thumb across
    g.beginPath(); g.roundRect(-aw * 0.72, -aw * 0.95, aw * 1.44, aw * 1.5, aw * 0.4); g.fill(); g.restore();
  }
}
export function personParams(r) {
  const h = r();
  return {
    hat: h < 0.45 ? 'hard' : h < 0.72 ? 'cap' : h < 0.86 ? 'beanie' : 'none', head: 0.19 + r() * 0.05, taper: 0.9 + r() * 0.25,
    lean: (r() - 0.5) * 0.12, tilt: (r() - 0.5) * 0.25, bill: r() < 0.5 ? -1 : 1,
    arm: r() < 0.42 ? (r() < 0.5 ? -1 : 1) : 0, spread: 0.6 + r() * 0.8, bend: 0.5 + r() * 0.8, ph: r(),
    tool: r() < 0.1 ? 'sledge' : r() < 0.06 ? 'shovel' : null, sz: 0.85 + r() * 0.3, dx: r() - 0.5,
  };
}
// a crowd from behind: ranks from the horizon (far, small, tinted to the ground) to the lens (near, big, black)
// rows: [{ y, s, n, ink }] ; pump(P) -> 0..1 per person
export function crowd(g, rows, seed, pump, { flags = [] } = {}) {
  const r = rng(seed);
  for (const row of rows) {
    const n = row.n, span = W * (row.span || 1.3), x0 = W / 2 - span / 2;
    const cast = Array.from({ length: n }, (_, i) => { const P = personParams(r); return { P, x: x0 + (i + 0.5 + P.dx * 0.8) * span / n, y: row.y + (r() - 0.5) * row.s * 0.25, s: row.s * P.sz }; });
    g.fillStyle = row.ink; g.strokeStyle = row.ink;
    for (const f of flags) if (f.row === row) flag(g, f, row);
    for (const c of cast) person(g, c.x, c.y, c.s, c.P, pump(c.P));
  }
}
function flag(g, f, row) {
  const s = row.s, px = f.x, py = row.y - s * 0.2, top = py - s * f.h;
  g.lineWidth = s * 0.07; g.beginPath(); g.moveTo(px, py); g.lineTo(px, top); g.stroke();
  const fw = s * f.w, fh = s * f.w * 0.6, wv = f.wave || 0;
  g.save(); g.fillStyle = f.color || row.ink; g.beginPath(); g.moveTo(px, top);
  for (let k = 0; k <= 10; k++) g.lineTo(px + fw * k / 10, top + Math.sin(k * 0.7 + wv) * fh * 0.08 * k / 10);
  for (let k = 10; k >= 0; k--) g.lineTo(px + fw * k / 10, top + fh + Math.sin(k * 0.7 + wv + 0.5) * fh * 0.08 * k / 10);
  g.closePath(); g.fill(); g.restore();
}

// ---------------------------------------------------------------- halftone and silkscreen (baked, per plate)
// AM halftone of a luminance function onto paper: returns a canvas. lum(x, y) -> 0 (ink) .. 1 (paper)
export function halftone(w, h, lum, { cell = 9, angle = 0.26, ink = '#140606', paper = null } = {}) {
  return mk(w, h, g => {
    if (paper) { g.fillStyle = paper; g.fillRect(0, 0, w, h); }
    g.fillStyle = ink;
    const ca = Math.cos(angle), sa = Math.sin(angle), R = Math.hypot(w, h);
    for (let v = -R; v < R; v += cell) for (let u = -R; u < R; u += cell) {
      const x = w / 2 + u * ca - v * sa, y = h / 2 + u * sa + v * ca;
      if (x < -cell || y < -cell || x > w + cell || y > h + cell) continue;
      const L = lum(x, y); if (L >= 0.98) continue;
      const rr = cell * 0.72 * Math.sqrt(1 - clamp(L)); if (rr < 0.4) continue;
      g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
    }
  });
}
// silkscreen: posterise an image's luma into flat inks (lightest first), each plate misregistered and mesh-stepped
export function silkscreen(img, w, h, inks, cuts, { misreg = 4, seed = 3, fit = 'cover', fx = 0.5, fy = 0.5, zoom = 1 } = {}) {
  const src = mk(w, h, g => {
    const s = Math.max(w / img.width, h / img.height) * zoom;
    g.filter = 'blur(2.5px)'; g.drawImage(img, w * fx - img.width * s * fx, h * fy - img.height * s * fy, img.width * s, img.height * s);
  });
  const d = src.getContext('2d').getImageData(0, 0, w, h).data, r = rng(seed);
  return mk(w, h, g => {
    g.fillStyle = inks[0]; g.fillRect(0, 0, w, h);
    cuts.forEach((cut, k) => {
      const ox = Math.round((r() - 0.5) * misreg * 2), oy = Math.round((r() - 0.5) * misreg * 2);
      const col = hex(inks[k + 1]), plate = g.createImageData(w, h), p = plate.data;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const sx = clamp(x - ox, 0, w - 1), sy = clamp(y - oy, 0, h - 1), i = (sy * w + sx) * 4;
        const L = (d[i] * 0.3 + d[i + 1] * 0.55 + d[i + 2] * 0.15) / 255 + noise3(x * 0.9, y * 0.05, k) * 0.012;
        if (L < cut) { const j = (y * w + x) * 4; p[j] = col[0]; p[j + 1] = col[1]; p[j + 2] = col[2]; p[j + 3] = 255; }
      }
      g.drawImage(mk(w, h, t => t.putImageData(plate, 0, 0)), 0, 0);
    });
  });
}
// the print finish over a whole frame: paper tooth multiplied in (so every frame sits on stock)
export function paperOver(ctx, amount = 0.35) {
  ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = amount; ctx.drawImage(PAPER, 0, 0); ctx.restore();
}
