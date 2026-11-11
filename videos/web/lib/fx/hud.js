// HUD / interface motion design for the ACP shorts: counters, split-flap boards, terminals, reticles, callouts,
// readouts, tickers, tapes, a thermal viewfinder. Canvas 2D; sizes come from ctx.canvas (never from globals).
//
// Phone legibility: every text size is clamped to HUD.min (34 px on a 1080-wide frame). One hero number and at
// most one secondary line per shot usually reads best on a phone; widgets register themselves with a role.
// Landing on the hit: odometer / splitflap / terminal take a settle-by time and land exactly on it.
// Lint: hudBegin() at the start of a frame, hudState() at the end -> [{ kind, label, role, moving, text }].
// tools/hudlint.mjs renders the impact beats and lists any counter / flap / terminal still moving there, to look at.
// Data honesty: callout() and readout() take { src } (a Network, USMap, globe.bases, or a flag string) and print
// its provenance flag (SAMPLE / APPROX. / PROCEDURAL) automatically.
import { C, clamp, lerp, ease, rng } from '../kit.js';
import { FLAG_LABEL, flagOf, rampCSS } from './geo/data.js';

export const MONO = 'Plex Mono';
export const HUD = { min: 34, frame: [] };
const TAU = Math.PI * 2;
const reg = (kind, o) => { HUD.frame.push({ kind, ...o }); };
export function hudBegin() { HUD.frame = []; }
export function hudState() { return HUD.frame.map(o => ({ ...o })); }
const sz = s => Math.max(HUD.min, s);

// number formatting: fmt(1234567) -> '1,234,567'; fmt(3.14159, 2) -> '3.14'
export function fmt(n, dec = 0) { const s = Math.abs(n).toFixed(dec), [i, f] = s.split('.'); return (n < 0 ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? '.' + f : ''); }
export const countUp = (a, b, u, e = ease.outExpo) => lerp(a, b, e(clamp(u)));
export function txt(ctx, s, x, y, size, color, align = 'left', family = MONO, alpha = 1, maxW = undefined) {
  ctx.save(); ctx.globalAlpha *= alpha; ctx.font = `${sz(size)}px "${family}"`; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = color;
  ctx.fillText(s, x, y, maxW); ctx.restore();
}
// a caption line (the label over a hero number)
export function caption(ctx, s, x, y, { size = 34, color = C.red2, align = 'left', alpha = 1, src = null } = {}) {
  const fl = FLAG_LABEL[flagOf(src)] || null; if (fl) s = `${s} · ${fl}`;
  txt(ctx, s, x, y, size, color, align, MONO, alpha); reg('caption', { role: 'caption', label: s, moving: false, text: s });
}

// Odometer / slot counter. Returns drawn width.
//   mode 'odo': mechanical carry; `snap` (0..1) is the part of each step the wheel spends moving, so most frames
//     read clean digits (1 = continuous roll).  mode 'slot': every wheel spins down onto its digit, left to right.
//   Settle-by: pass { from, to, start, settle, now } (seconds) instead of a value: the counter runs from `from` at
//   `start` and lands exactly on `to` at `settle` (every wheel still, no half digit), and stays there.
export function odometer(ctx, value, x, y, { size = 120, family = 'Anton', color = C.cream, bg = null, digits = 0, commas = true,
  mode = 'odo', u = 1, align = 'left', blur = 1, dim = 'rgba(244,230,208,0.28)', gap = 0.02, snap = 0.35,
  from = 0, to = null, start = 0, settle = null, now = null, curve = ease.inOutCubic, label = 'odometer', role = 'hero', shade = true } = {}) {
  let settled = false;
  if (to != null && settle != null && now != null) {
    const k = clamp((now - start) / Math.max(1e-6, settle - start));
    settled = now >= settle;
    if (mode === 'slot') { value = to; u = k; } else value = settled ? to : lerp(from, to, curve(k));
  }
  let v = Math.max(0, value);
  if (mode === 'odo' && !settled) { const f = v % 1; v = Math.floor(v) + (snap >= 1 ? f : ease.inOutCubic(clamp((f - (1 - snap)) / snap))); }
  if (settled) v = Math.round(v);
  const int = Math.floor(v);
  let s = String(int); if (digits) s = s.padStart(digits, '0');
  const nD = s.length;
  ctx.save(); ctx.font = `${size}px "${family}"`; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center';
  const cw = ctx.measureText('0').width * (1 + gap), comW = ctx.measureText(',').width * 1.1;
  const nCom = commas ? Math.floor((nD - 1) / 3) : 0, total = nD * cw + nCom * comW;
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const top = y - size * 0.9, hgt = size * 1.04, pitch = size * 1.45;
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(cx - size * 0.08, top - size * 0.08, total + size * 0.16, hgt + size * 0.16); }
  let moving = false;
  for (let i = 0; i < nD; i++) {
    const k = nD - 1 - i;
    let pos;
    if (mode === 'slot') {                               // the last wheel lands exactly at u = 1
      const span = 0.55, st = nD > 1 ? i / (nD - 1) * (1 - span) : 1 - span;
      const d = +s[i], spin = (1 - ease.outCubic(clamp((u - st) / span))) * (12 + i * 3);
      pos = d + spin;
    } else {
      const p = Math.pow(10, k), d = Math.floor(v / p) % 10, lower = v % p;
      pos = d + (k === 0 ? v % 1 : Math.max(0, lower - (p - 1)));
    }
    const d0 = Math.floor(pos) % 10, fr = pos - Math.floor(pos);
    if (fr > 0.001 && fr < 0.999) moving = true;
    const colX = cx + cw / 2;
    ctx.save(); ctx.beginPath(); ctx.rect(cx, top, cw, hgt); ctx.clip();
    const lead = !digits && k >= String(int).length;
    for (const [dd, off] of [[d0, -fr], [(d0 + 1) % 10, 1 - fr]]) {
      const yy = y + off * pitch;
      if (blur && fr > 0.02 && fr < 0.98) { ctx.globalAlpha = 0.25; ctx.fillStyle = color; ctx.fillText(String(dd), colX, yy - size * 0.1); ctx.fillText(String(dd), colX, yy + size * 0.1); }
      ctx.globalAlpha = 1; ctx.fillStyle = lead ? dim : color; ctx.fillText(String(dd), colX, yy);
    }
    if (shade) { const g = ctx.createLinearGradient(0, top, 0, top + hgt);
    g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.2, 'rgba(0,0,0,0)'); g.addColorStop(0.8, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g; ctx.fillRect(cx, top, cw, hgt); }
    ctx.restore();
    cx += cw;
    if (commas && k > 0 && k % 3 === 0) { ctx.fillStyle = color; ctx.fillText(',', cx + comW / 2, y); cx += comW; }
  }
  ctx.restore();
  if (settle != null && now != null && now > start && now < settle) moving = true;
  reg('odometer', { role, label, moving, text: commas ? fmt(int) : s, settle });
  return total;
}

// Split-flap board: each cell flips through glyphs until its settle time. Before age 0 the board shows `from`
// (blank by default), never random glyphs. settle: age by which the LAST cell has landed (spin/stagger rescaled).
const FLAP = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-/:';
export function splitflap(ctx, text, age, x, y, { size = 90, color = C.cream, cell = '#141010', hinge = '#000', stagger = 0.045, spin = 0.5,
  rate = 22, align = 'center', gap = 0.1, family = 'Anton', seed = 1, accent = null, settle = null, from = null, label = null, role = 'hero' } = {}) {
  size = sz(size);
  const n = text.length, cw = size * 0.72, ch = size * 1.2, pitch = cw * (1 + gap);
  if (settle != null) { spin = Math.min(spin, settle * 0.6); stagger = n > 1 ? (settle - spin) / (n - 1) : 0; if (n === 1) spin = settle; }
  const x0 = align === 'center' ? x - (n * pitch - cw * gap) / 2 : x;
  ctx.save(); ctx.font = `${size}px "${family}"`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let moving = false;
  for (let i = 0; i < n; i++) {
    const cx = x0 + i * pitch, a = age - (spin + i * stagger);
    const done = a >= 0, before = age <= 0;
    const flips = Math.floor(Math.max(0, age) * rate);
    const cur = done ? text[i] : before ? (from ? from[i] || ' ' : ' ') : FLAP[Math.floor(hash2(i + seed * 97, flips) * FLAP.length)];
    if (!done && !before) moving = true;
    const prog = done || before ? 1 : (age * rate) % 1;
    ctx.fillStyle = cell; ctx.fillRect(cx, y - ch / 2, cw, ch);
    if (cur !== ' ') { ctx.fillStyle = accent && done && accent.includes(i) ? C.red2 : color; ctx.fillText(cur, cx + cw / 2, y + size * 0.04); }
    if (!done && !before) {
      const s = Math.cos(prog * Math.PI);
      ctx.save(); ctx.beginPath(); ctx.rect(cx, y - ch / 2, cw, ch / 2); ctx.clip();
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(cx, y - ch / 2, cw, ch / 2);
      ctx.translate(0, y); ctx.scale(1, Math.max(0.02, Math.abs(s))); ctx.fillStyle = '#231a1a'; ctx.fillRect(cx, -ch / 2, cw, ch / 2);
      ctx.restore();
    }
    ctx.fillStyle = hinge; ctx.fillRect(cx, y - 1.5, cw, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(cx, y - ch / 2, cw, 3);
  }
  ctx.restore();
  reg('splitflap', { role, label: label || text.trim(), moving, text, settle });
}
const hash2 = (a, b) => { let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1); h = Math.imul(h ^ h >>> 15, 0x85ebca6b); h ^= h >>> 13; return ((h >>> 0) % 100000) / 100000; };

// Terminal: typed lines with a block cursor; keeps the last `rows` lines; lines: string | {s, c}
// settle: age (s) by which every line is fully typed (overrides cps).
export function terminal(ctx, lines, age, { x = 60, y = 200, size = 34, lh = 1.3, cps = 60, rows = 6, color = C.cream, dim = 'rgba(244,230,208,0.55)',
  hot = C.red2, prompt = '', cursor = true, maxW = null, pause = 0.12, settle = null, label = 'terminal', role = 'secondary', lint = true } = {}) {
  size = sz(size); maxW = maxW ?? ctx.canvas.width - x - 60;
  const strs = lines.map(L => typeof L === 'string' ? L : L.s);
  if (settle != null) { const tot = strs.reduce((a, s) => a + s.length, 0); cps = tot / Math.max(0.05, settle - pause * lines.length); }
  ctx.save(); ctx.font = `${size}px "${MONO}"`; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  let budget = age * cps; const shown = []; let typing = false;
  for (const [i, L] of lines.entries()) {
    const s = strs[i]; if (budget <= 0) break;
    const k = Math.min(s.length, Math.floor(budget)); shown.push([L, s.slice(0, k), k < s.length]); if (k < s.length) typing = true;
    budget -= s.length + pause * cps;
  }
  if (shown.length < lines.length && age > 0) typing = true;
  const vis = shown.slice(-rows);
  vis.forEach(([L, s, ty], i) => {
    const c = typeof L === 'string' ? (i === vis.length - 1 ? color : dim) : (L.c === 'hot' ? hot : L.c === 'dim' ? dim : L.c || color);
    const yy = y + i * size * lh;
    ctx.fillStyle = c; ctx.fillText(prompt + s, x, yy, maxW);
    if (cursor && i === vis.length - 1 && (ty || Math.floor(age * 2.4) % 2 === 0)) {
      const w = Math.min(maxW, ctx.measureText(prompt + s).width); ctx.fillStyle = hot; ctx.fillRect(x + w + 4, yy - size * 0.8, size * 0.55, size * 0.95);
    }
  });
  ctx.restore();
  if (lint) reg('terminal', { role, label, moving: typing, text: vis.map(v => v[1]).join(' / '), settle });
  return shown.length;
}
// deterministic hex-dump / telemetry lines for texture (draw them big and dim: texture, not reading)
export function hexLines(seed, n, width = 8) {
  const R = rng(seed), out = [];
  for (let i = 0; i < n; i++) {
    const a = (0x4000 + i * 16).toString(16).toUpperCase().padStart(6, '0');
    const b = Array.from({ length: width }, () => Math.floor(R() * 256).toString(16).toUpperCase().padStart(2, '0')).join(' ');
    out.push(`${a}  ${b}`);
  }
  return out;
}

// Targeting reticle: brackets converge from `from`x radius onto r as lock goes 0->1; outer ring spins; LOCK tag
export function reticle(ctx, x, y, { r = 60, lock = 1, age = 0, color = C.cream, hot = C.red2, label = null, from = 2.6, sub = null, alpha = 1, size = 34 } = {}) {
  const k = ease.outExpo(clamp(lock)), R = lerp(r * from, r, k), spin = age * 1.6 + (1 - k) * 3;
  size = sz(size);
  ctx.save(); ctx.globalAlpha *= alpha; ctx.lineCap = 'butt';
  const col = k >= 0.999 ? hot : color;
  ctx.strokeStyle = col; ctx.lineWidth = 4;
  const b = R * 0.42;
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    ctx.beginPath(); ctx.moveTo(x + sx * R, y + sy * (R - b)); ctx.lineTo(x + sx * R, y + sy * R); ctx.lineTo(x + sx * (R - b), y + sy * R); ctx.stroke();
  }
  ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.globalAlpha *= 0.85;
  for (let i = 0; i < 3; i++) { const a0 = spin + i * TAU / 3; ctx.beginPath(); ctx.arc(x, y, R * 0.72, a0, a0 + TAU / 3 - 0.5); ctx.stroke(); }
  for (let i = 0; i < 24; i++) {
    const a = i * TAU / 24 - spin * 0.4, l = i % 6 === 0 ? 10 : 4;
    ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * R * 0.86, y + Math.sin(a) * R * 0.86); ctx.lineTo(x + Math.cos(a) * (R * 0.86 + l), y + Math.sin(a) * (R * 0.86 + l)); ctx.stroke();
  }
  ctx.globalAlpha = alpha; ctx.strokeStyle = col; ctx.lineWidth = 2.5;
  const g = r * 0.18;
  ctx.beginPath(); ctx.moveTo(x - R * 1.25, y); ctx.lineTo(x - g, y); ctx.moveTo(x + g, y); ctx.lineTo(x + R * 1.25, y);
  ctx.moveTo(x, y - R * 1.25); ctx.lineTo(x, y - g); ctx.moveTo(x, y + g); ctx.lineTo(x, y + R * 1.25); ctx.stroke();
  ctx.fillStyle = col; ctx.fillRect(x - 3, y - 3, 6, 6);
  if (label) {
    const locked = k >= 0.999, blink = !locked || Math.floor(age * 6) % 2 === 0 || age > 0.6;
    ctx.font = `${size}px "${MONO}"`; const tw = ctx.measureText(label).width + 28;
    const flip = x + R + 8 + tw > ctx.canvas.width - 20, bx = flip ? x - R - 8 - tw : x + R + 8;
    ctx.fillStyle = locked ? hot : 'rgba(10,2,3,0.85)'; ctx.fillRect(bx, y - R - size * 0.2, tw, size * 1.25);
    if (blink) txt(ctx, label, bx + 14, y - R + size * 0.78, size, locked ? '#fff' : color);
    if (sub) txt(ctx, sub, bx + 4, y - R + size * 2.1, size, color, 'left', MONO, 0.85);
    reg('reticle', { role: 'secondary', label, moving: false, text: label + (sub ? ' ' + sub : '') });
  }
  ctx.restore();
}

// Leader-line callout: point -> elbow -> label, drawn on over age; label types in. src: data provenance
export function callout(ctx, px, py, lx, ly, text, age, { color = C.cream, hot = C.red2, size = 40, sub = null, dur = 0.3, cps = 70, src = null } = {}) {
  const u = ease.outCubic(clamp(age / dur));
  if (u <= 0) return;
  size = sz(size);
  const fl = FLAG_LABEL[flagOf(src)] || null;
  if (fl) sub = sub ? `${sub} · ${fl}` : fl;
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 2.5;
  const ex = lx, ey = py;
  const L1 = Math.hypot(ex - px, ey - py) || 1, L2 = Math.abs(ly - ey) + 1, tot = L1 + L2, d = u * tot;
  ctx.beginPath(); ctx.moveTo(px, py);
  if (d < L1) ctx.lineTo(lerp(px, ex, d / L1), lerp(py, ey, d / L1)); else { ctx.lineTo(ex, ey); ctx.lineTo(ex, lerp(ey, ly, (d - L1) / L2)); }
  ctx.stroke();
  ctx.fillStyle = hot; ctx.beginPath(); ctx.arc(px, py, 7, 0, TAU); ctx.fill();
  ctx.strokeStyle = hot; ctx.beginPath(); ctx.arc(px, py, 7 + 16 * ((age * 1.5) % 1), 0, TAU); ctx.globalAlpha = 1 - (age * 1.5) % 1; ctx.stroke(); ctx.globalAlpha = 1;
  if (u >= 1) {
    const n = Math.floor((age - dur) * cps), s = text.slice(0, n);
    ctx.font = `${size}px "${MONO}"`; const w = Math.max(ctx.measureText(text).width, sub ? ctx.measureText(sub).width * 0.85 : 0);
    let bx = lx > px ? lx : lx - w - 20; bx = clamp(bx, 16, ctx.canvas.width - w - 44);
    const bh = size * 1.45 + (sub ? size * 1.1 : 0);
    ctx.fillStyle = 'rgba(10,2,3,0.85)'; ctx.fillRect(bx - 4, ly - size - 6, w + 32, bh);
    ctx.fillStyle = hot; ctx.fillRect(bx - 4, ly - size - 6, 6, bh);
    txt(ctx, s, bx + 14, ly + 2, size, color);
    if (sub && n >= text.length) txt(ctx, sub, bx + 14, ly + size * 1.1, size * 0.85, color, 'left', MONO, 0.8);
  }
  ctx.restore();
  reg('callout', { role: 'secondary', label: text, moving: false, text: text + (sub ? ' / ' + sub : '') });
}

// Readout block: title + key/value rows with animated bars. rows: [[key, value(0..1), text]]. src: provenance flag in the title
export function readout(ctx, x, y, title, rows, age, { w = 460, size = 34, color = C.cream, hot = C.red2, stagger = 0.08, src = null } = {}) {
  size = sz(size);
  const fl = FLAG_LABEL[flagOf(src)] || null; if (fl) title = `${title} · ${fl}`;
  const rh = size * 1.7;
  ctx.save();
  ctx.fillStyle = 'rgba(8,2,3,0.78)'; ctx.fillRect(x, y, w, size * 1.5 + rows.length * rh + 12);
  ctx.fillStyle = hot; ctx.fillRect(x, y, w, size * 1.35);
  txt(ctx, title, x + 12, y + size * 1.02, size, '#fff', 'left', MONO, 1, w - 24);
  rows.forEach(([k, v, s], i) => {
    const a = clamp((age - i * stagger) / 0.4), yy = y + size * 1.5 + i * rh + size;
    txt(ctx, k, x + 12, yy, size, color, 'left', MONO, 0.8 * a);
    txt(ctx, s, x + w - 12, yy, size, color, 'right', MONO, a);
    ctx.fillStyle = 'rgba(244,230,208,0.14)'; ctx.fillRect(x + 12, yy + 8, w - 24, 6);
    ctx.fillStyle = i % 2 ? color : hot; ctx.fillRect(x + 12, yy + 8, (w - 24) * clamp(v) * ease.outExpo(a), 6);
  });
  ctx.restore();
  reg('readout', { role: 'secondary', label: title, moving: false, text: title });
}

// Scrolling ticker band. items: [[label, value, delta]]; speed px/s; y defaults to the bottom of the canvas
export function ticker(ctx, items, t, { y = null, h = 76, speed = 160, bg = C.red, color = '#fff', size = 38, up = '#F4E6D0', down = '#1a0203', sep = '  ///  ' } = {}) {
  const Wc = ctx.canvas.width; y = y ?? ctx.canvas.height - h - 30; size = sz(size);
  ctx.save(); ctx.fillStyle = bg; ctx.fillRect(0, y, Wc, h);
  ctx.font = `${size}px "${MONO}"`; ctx.textBaseline = 'middle';
  const parts = items.map(([l, v, d]) => [l + ' ', v + ' ', d == null ? '' : (d >= 0 ? '▲' : '▼') + Math.abs(d).toFixed(1) + '%', d]);
  const widths = parts.map(p => ctx.measureText(p[0] + p[1] + p[2] + sep).width), total = widths.reduce((a, b) => a + b, 0);
  let x = -((t * speed) % total);
  while (x < Wc) {
    parts.forEach((p, i) => {
      if (x > Wc || x + widths[i] < 0) { x += widths[i]; return; }
      let xx = x;
      ctx.fillStyle = color; ctx.globalAlpha = 0.8; ctx.fillText(p[0], xx, y + h / 2); xx += ctx.measureText(p[0]).width;
      ctx.globalAlpha = 1; ctx.fillText(p[1], xx, y + h / 2); xx += ctx.measureText(p[1]).width;
      ctx.fillStyle = p[3] >= 0 ? up : down; ctx.fillText(p[2], xx, y + h / 2); xx += ctx.measureText(p[2]).width;
      ctx.fillStyle = color; ctx.globalAlpha = 0.5; ctx.fillText(sep, xx, y + h / 2); ctx.globalAlpha = 1;
      x += widths[i];
    });
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, y, Wc, 3); ctx.fillRect(0, y + h - 3, Wc, 3);
  ctx.restore();
  reg('ticker', { role: 'secondary', label: 'ticker', moving: false, text: '' });
}

// Heading / range tape: a scrolling scale with a fixed centre marker. value in units, span = units across w
export function tape(ctx, value, x, y, w, { span = 90, step = 5, major = 15, color = C.cream, hot = C.red2, vertical = false, labels = v => String(((v % 360) + 360) % 360).padStart(3, '0'), size = 34 } = {}) {
  size = sz(size);
  ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2.5;
  ctx.font = `${size}px "${MONO}"`; ctx.textAlign = 'center';
  const v0 = Math.ceil((value - span / 2) / step) * step;
  for (let v = v0; v <= value + span / 2; v += step) {
    const o = (v - value) / span * w, a = 1 - Math.abs(o) / (w / 2) * 0.8, maj = Math.round(v) % major === 0;
    ctx.globalAlpha = a;
    if (!vertical) { ctx.beginPath(); ctx.moveTo(x + o, y); ctx.lineTo(x + o, y + (maj ? 24 : 12)); ctx.stroke(); if (maj) ctx.fillText(labels(v), x + o, y + 24 + size + 4); }
    else { ctx.beginPath(); ctx.moveTo(x, y - o); ctx.lineTo(x + (maj ? 24 : 12), y - o); ctx.stroke(); if (maj) { ctx.textAlign = 'left'; ctx.fillText(labels(v), x + 32, y - o + size * 0.35); } }
  }
  ctx.globalAlpha = 1; ctx.fillStyle = hot;
  ctx.beginPath();
  if (!vertical) { ctx.moveTo(x, y - 4); ctx.lineTo(x - 12, y - 20); ctx.lineTo(x + 12, y - 20); }
  else { ctx.moveTo(x - 4, y); ctx.lineTo(x - 20, y - 12); ctx.lineTo(x - 20, y + 12); }
  ctx.fill();
  ctx.restore();
  reg('tape', { role: 'secondary', label: 'tape', moving: false, text: '' });
}

// Thermal-camera viewfinder frame: corner brackets, REC + timecode (one line), the scale bar (no numbers),
// a centre spot. The spot temperature is the hero: draw it with odometer() where the shot wants it.
export function viewfinder(ctx, t, { rect = null, palette = 'ironbow', color = C.cream, hot = C.red2, rec = true, spot = null, label = null, size = 34, scale = true, text = true } = {}) {
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  const [x, y, w, h] = rect || [40, 150, cw - 80, ch - 330];
  size = sz(size);
  ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 5;
  const L = 80;
  for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
    ctx.beginPath(); ctx.moveTo(cx, cy + sy * L); ctx.lineTo(cx, cy); ctx.lineTo(cx + sx * L, cy); ctx.stroke();
  }
  ctx.lineWidth = 1.5; ctx.globalAlpha = 0.35; ctx.strokeRect(x + 16, y + 16, w - 32, h - 32); ctx.globalAlpha = 1;
  const tc = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}:${String(Math.floor((t % 1) * 30)).padStart(2, '0')}`;
  if (rec && Math.floor(t * 2) % 2 === 0) { ctx.fillStyle = hot; ctx.beginPath(); ctx.arc(x + 44, y - size * 0.9 - 14, 13, 0, TAU); ctx.fill(); }
  if (text) txt(ctx, (label ? label + '  ' : 'REC  ') + tc, x + 70, y - 22, size, color);
  if (scale) {
    const bx = x + w - 60, by = y + 140, bh = h * 0.42, pal = rampCSS(palette);
    for (let i = 0; i < 64; i++) { ctx.fillStyle = pal[Math.round((1 - i / 63) * 255)]; ctx.fillRect(bx, by + i * bh / 64, 26, bh / 64 + 1); }
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.strokeRect(bx, by, 26, bh);
  }
  const sx = spot ? spot[0] : x + w / 2, sy = spot ? spot[1] : y + h / 2;
  ctx.strokeStyle = color; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(sx - 50, sy); ctx.lineTo(sx - 16, sy); ctx.moveTo(sx + 16, sy); ctx.lineTo(sx + 50, sy);
  ctx.moveTo(sx, sy - 50); ctx.lineTo(sx, sy - 16); ctx.moveTo(sx, sy + 16); ctx.lineTo(sx, sy + 50); ctx.stroke();
  ctx.strokeRect(sx - 24, sy - 24, 48, 48);
  ctx.restore();
  if (text) reg('viewfinder', { role: 'secondary', label: 'viewfinder', moving: false, text: 'REC ' + tc });
}

// Scanline overlay + rolling sensor bar (cheap interface texture)
export function scanlines(ctx, t, { alpha = 0.12, gap = 4, roll = 1, rect = null } = {}) {
  const [x, y, w, h] = rect || [0, 0, ctx.canvas.width, ctx.canvas.height];
  ctx.save(); ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  for (let yy = y; yy < y + h; yy += gap) ctx.fillRect(x, yy, w, gap / 2);
  if (roll) { const ry = y + ((t * 220) % (h + 200)) - 100; const g = ctx.createLinearGradient(0, ry - 80, 0, ry + 80);
    g.addColorStop(0, 'rgba(255,240,220,0)'); g.addColorStop(0.5, `rgba(255,240,220,${0.06 * roll})`); g.addColorStop(1, 'rgba(255,240,220,0)'); ctx.fillStyle = g; ctx.fillRect(x, ry - 80, w, 160); }
  ctx.restore();
}
