// MODELING decals (MODELING studio, cycle 1): the wear that reads at feed size. Real things are read by their MARKINGS
// (an owner name, a code, a capacity plate, a stencilled crane number, a rust run under a lip), not by fine noise, and
// noise that is fine disappears at 270 px. Each generator returns a canvas (or CanvasTexture) drawn deterministically from a
// seed, for the asset's own UVs. Owner names and codes are INVENTED: no real line's name, livery or logo is reproduced.
//
//   containerSide({ base: '#8a3a2a', owner: 'KESTRELINE', seed: 7 })   -> CanvasTexture 2048 x 512, u along the box left to right
//   iso6346('KSTU', '482913')                                          -> { code: 'KSTU 482913 5', check: 5 }
//   stencil('STS 14', { w: 512, h: 128 })                              -> a stencilled plate canvas (crane numbers, capacity plates)
//   plate(lines, opts)                                                 -> a riveted capacity / data plate canvas
import * as THREE from 'three';

export function rngOf(seed = 1) { let s = (seed * 2654435761) >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

// ISO 6346 check digit: letters map to 10..38 skipping multiples of 11, weights 2^i, sum mod 11 mod 10
export function iso6346(prefix4, serial6) {
  const vals = {}; let v = 10; for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') { if (v % 11 === 0) v++; vals[ch] = v++; }
  const s = (prefix4 + serial6).split('').map(c => (c >= '0' && c <= '9') ? +c : vals[c]); let sum = 0; s.forEach((x, i) => { sum += x * 2 ** i; });
  const check = (sum % 11) % 10; return { code: `${prefix4} ${serial6} ${check}`, check, prefix: prefix4, serial: serial6 };
}
export const OWNERS = [   // invented names and prefixes (letters chosen to be unlikely BIC codes; last letter U = freight container)
  { name: 'KESTRELINE', prefix: 'KXLU', font: 'Anton', fg: '#f2efe6', logo: 'chevrons' },
  { name: 'OXBOW', prefix: 'OXBU', font: 'Anton', fg: '#ffffff', logo: 'bend' },
  { name: 'HALYCON', prefix: 'HYCU', font: 'Big Shoulders Stencil Display', fg: '#f6f1df', logo: 'sun' },
  { name: 'NORDWELL', prefix: 'NWLU', font: 'Anton', fg: '#ffffff', logo: 'bars' },
  { name: 'TAMARACK', prefix: 'TMKU', font: 'Anton', fg: '#f4e9c8', logo: 'tri' },
  { name: 'SEACOMB', prefix: 'SCBU', font: 'Anton', fg: '#ffffff', logo: 'wave' },
  { name: 'GREYHOLLOW', prefix: 'GHWU', font: 'Anton', fg: '#eeeeea', logo: 'disc' },
  { name: 'PORTAGE', prefix: 'PRGU', font: 'Anton', fg: '#20201e', logo: 'bars' },
];
export const LIVERIES = ['#8c3524', '#2b4c7e', '#1f6b5c', '#c4621b', '#7d8285', '#b39b68', '#2e4a35', '#6f2130', '#c8a12a', '#c6cac8', '#26282b', '#4a5d75'];

function logo(g, kind, x, y, s, col) {
  g.save(); g.translate(x, y); g.fillStyle = col; g.strokeStyle = col;
  if (kind === 'chevrons') { for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(-s * .5 + i * s * .4, -s * .5); g.lineTo(-s * .1 + i * s * .4, 0); g.lineTo(-s * .5 + i * s * .4, s * .5); g.lineWidth = s * .14; g.stroke(); } }
  else if (kind === 'bend') { g.beginPath(); g.arc(0, s * .1, s * .5, Math.PI * 1.1, Math.PI * 1.9); g.lineWidth = s * .2; g.stroke(); }
  else if (kind === 'sun') { g.beginPath(); g.arc(0, 0, s * .25, 0, 7); g.fill(); for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; g.beginPath(); g.moveTo(Math.cos(a) * s * .35, Math.sin(a) * s * .35); g.lineTo(Math.cos(a) * s * .55, Math.sin(a) * s * .55); g.lineWidth = s * .07; g.stroke(); } }
  else if (kind === 'bars') { for (let i = -1; i <= 1; i++) g.fillRect(i * s * .3 - s * .09, -s * .5, s * .18, s); }
  else if (kind === 'tri') { g.beginPath(); g.moveTo(0, -s * .55); g.lineTo(s * .5, s * .45); g.lineTo(-s * .5, s * .45); g.closePath(); g.fill(); }
  else if (kind === 'wave') { g.lineWidth = s * .12; for (let k = 0; k < 3; k++) { g.beginPath(); for (let i = 0; i <= 20; i++) { const xx = -s * .55 + i * s * 1.1 / 20, yy = -s * .3 + k * s * .3 + Math.sin(i / 20 * Math.PI * 4) * s * .09; i ? g.lineTo(xx, yy) : g.moveTo(xx, yy); } g.stroke(); } }
  else { g.beginPath(); g.arc(0, 0, s * .5, 0, 7); g.fill(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(s * .12, 0, s * .32, 0, 7); g.fill(); }
  g.restore();
}

// one side of a container as seen from outside. Wear is bigger than fine noise: rust runs from the top rail and lips, touch-up
// patches in a slightly different paint, scuffs at forklift height, faded lettering, a dent shadow or two.
export function containerSideCanvas({ base = '#8c3524', owner = OWNERS[0], seed = 1, rust = 0.5, fade = 0.25, w = 2048, h = 512, number = null, kind = '45G1', tare = 3780, doorEnd = 'right' } = {}) {
  const R = rngOf(seed), c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  // paint history: broad blotches of slightly different paint (repaints), fade toward the sun side
  for (let i = 0; i < 9; i++) { const x = R() * w, y = R() * h, ww = 120 + R() * 500, hh = 60 + R() * 300; g.fillStyle = `rgba(${R() < .5 ? '255,255,255' : '0,0,0'},${0.03 + R() * 0.06})`; g.fillRect(x, y, ww, hh); }
  const grad = g.createLinearGradient(0, 0, 0, h); grad.addColorStop(0, 'rgba(255,255,255,' + 0.06 * (1 + fade) + ')'); grad.addColorStop(0.5, 'rgba(255,255,255,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.22)'); g.fillStyle = grad; g.fillRect(0, 0, w, h);
  // markings
  const own = owner, sizeName = h * 0.36, xo = w * 0.07, yo = h * 0.5;
  g.font = `${sizeName}px "${own.font}"`; g.textBaseline = 'middle'; g.fillStyle = own.fg; g.globalAlpha = 0.92 - fade * 0.3;
  if (g.letterSpacing !== undefined) g.letterSpacing = (h * 0.02) + 'px';
  g.fillText(own.name, xo + h * 0.34, yo); const tw = g.measureText(own.name).width; g.globalAlpha = 0.92 - fade * 0.3;
  logo(g, own.logo, xo + h * 0.14, yo, h * 0.3, own.fg);
  if (g.letterSpacing !== undefined) g.letterSpacing = '0px';
  // code block (right of the middle; the door end is to the right when doorEnd === 'right')
  const ser = number || String(100000 + Math.floor(R() * 899999)), iso = iso6346(own.prefix, ser);
  g.globalAlpha = 0.9; g.fillStyle = own.fg; g.font = `${h * 0.075}px "Big Shoulders Stencil Display"`; g.textAlign = 'left';
  const cx = w * 0.64, cy = h * 0.17; g.fillText(`${own.prefix} ${ser} ${iso.check}`, cx, cy); g.font = `${h * 0.062}px "Big Shoulders Stencil Display"`; g.fillText(kind, cx + h * 0.05, cy + h * 0.095);
  // weights block (small: reads only at 1:1)
  g.font = `${h * 0.028}px "IBM Plex Mono", monospace`; g.globalAlpha = 0.72; const wb = ['MAX GROSS 30480 KG  67200 LB', `TARE  ${tare} KG  ${Math.round(tare * 2.2046)} LB`, `PAYLOAD ${30480 - tare} KG`, 'CUBE 76.3 CU.M  2694 CU.FT'];
  wb.forEach((t, i) => g.fillText(t, w * 0.79, h * 0.15 + i * h * 0.04));
  // CSC plate
  g.globalAlpha = 0.85; g.fillStyle = '#c9c5b8'; g.fillRect(w * 0.9, h * 0.62, w * 0.06, h * 0.12); g.fillStyle = '#3a382f'; g.font = `${h * 0.018}px "IBM Plex Mono", monospace`; ['CSC SAFETY', 'APPROVAL', 'INVENTED'].forEach((t, i) => g.fillText(t, w * 0.9 + 4, h * 0.645 + i * h * 0.03));
  // stripe / height mark
  g.globalAlpha = 1; g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, h * 0.965, w, h * 0.035);
  // touch-up patches: rectangles of newer paint that do not match
  for (let i = 0; i < 3; i++) { g.fillStyle = `rgba(${R() < .5 ? '30,30,26' : '180,170,150'},${0.07 + R() * 0.1})`; g.fillRect(R() * w, R() * h * 0.7, 60 + R() * 260, 40 + R() * 200); }
  // scuffs at forklift and chain height
  for (let i = 0; i < 40 * (0.5 + rust); i++) { const y = h * (0.55 + R() * 0.4), x = R() * w, len = 20 + R() * 200; g.strokeStyle = `rgba(${R() < .5 ? '20,18,14' : '200,190,170'},${0.05 + R() * 0.15})`; g.lineWidth = 1 + R() * 2.5; g.beginPath(); g.moveTo(x, y); g.lineTo(x + len, y + (R() - .5) * 8); g.stroke(); }
  // rust runs: from the top rail and from the bottom lip, vertical, long, orange-brown fading
  const runs = Math.floor(30 * rust * (0.6 + R()));
  for (let i = 0; i < runs; i++) {
    const x = R() * w, y0 = R() < 0.65 ? 0 : h * 0.86, len = h * (0.1 + R() * 0.55) * (y0 === 0 ? 1 : -0.5), wd = 3 + R() * 22;
    const gr = g.createLinearGradient(0, y0, 0, y0 + len); const a = 0.12 + R() * 0.38; gr.addColorStop(0, `rgba(96,44,18,${a})`); gr.addColorStop(1, 'rgba(96,44,18,0)'); g.fillStyle = gr; g.fillRect(x, Math.min(y0, y0 + len), wd, Math.abs(len));
  }
  for (let i = 0; i < 26 * rust; i++) { const x = R() < .5 ? R() * w : (R() < .5 ? 0 : w) + (R() - .5) * 90, y = h * (R() < .6 ? 0.92 + R() * 0.08 : R()); g.fillStyle = `rgba(88,40,16,${0.15 + R() * 0.35})`; g.beginPath(); g.ellipse(x, y, 4 + R() * 26, 3 + R() * 14, R() * 3, 0, 7); g.fill(); }
  // grime band at the bottom
  const gb = g.createLinearGradient(0, h * 0.72, 0, h); gb.addColorStop(0, 'rgba(20,16,10,0)'); gb.addColorStop(1, 'rgba(20,16,10,0.42)'); g.fillStyle = gb; g.fillRect(0, h * 0.72, w, h * 0.28);
  return c;
}
export function containerSide(o) { const t = new THREE.CanvasTexture(containerSideCanvas(o)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t; }

// stencilled marking (crane number, unit number): a stencil font with bridges, chalky
export function stencil(text, { w = 512, h = 128, fg = '#f1ece0', bg = null, font = 'Big Shoulders Stencil Display', seed = 3, wear = 0.4 } = {}) {
  const R = rngOf(seed), c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  g.fillStyle = fg; g.font = `${h * 0.78}px "${font}"`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + h * 0.03);
  g.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 60 * wear; i++) { g.fillStyle = `rgba(0,0,0,${0.2 + R() * 0.6})`; g.fillRect(R() * w, R() * h, 2 + R() * 14, 1 + R() * 4); }
  return c;
}
export function plate(lines, { w = 384, h = 192, fg = '#1c1b17', bg = '#bdb8a8', rivets = true, seed = 5 } = {}) {
  const R = rngOf(seed), c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 3; g.strokeRect(3, 3, w - 6, h - 6);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; const n = lines.length; lines.forEach((t, i) => { g.font = `${h / (n + 1.6)}px "IBM Plex Mono", monospace`; g.fillText(t, w / 2, (i + 1) * h / (n + 1)); });
  if (rivets) for (const [x, y] of [[12, 12], [w - 12, 12], [12, h - 12], [w - 12, h - 12]]) { g.beginPath(); g.arc(x, y, 4, 0, 7); g.fillStyle = '#6a675a'; g.fill(); }
  for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(0,0,0,${R() * 0.08})`; g.fillRect(R() * w, R() * h, 1 + R() * 4, 1); }
  return c;
}

// ---- the cab side of tractor_aero.js (uv: front of the truck at u = 0, metres CAB = z -3.35..1.3, y 1.0..4.2). Door and its glass,
// handle, sleeper window and storage door, beltline stripe, fade, rain streaks and road dirt. `paint` is the cab colour.
export function cabSideCanvas({ paint = '#cfc6b0', seed = 4, w = 2048, h = 1024, dirt = 0.6 } = {}) {
  const R = rngOf(seed), c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  const U = z => (1.3 - z) / 4.65 * w, V = y => (1 - (y - 1.0) / 3.2) * h;   // canvas y is down
  g.fillStyle = paint; g.fillRect(0, 0, w, h);
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,0.10)'); gr.addColorStop(0.55, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.35)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  const rr = (x, y, ww, hh, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + ww, y, x + ww, y + hh, r); g.arcTo(x + ww, y + hh, x, y + hh, r); g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + ww, y, r); g.closePath(); };
  // door outline (front hinge near z = 0.9, rear edge at z = -0.75), shut lines
  g.strokeStyle = 'rgba(20,18,14,0.75)'; g.lineWidth = 3; rr(U(0.92), V(3.42), U(-0.75) - U(0.92), V(1.12) - V(3.42), 18); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 2; rr(U(0.9) + 5, V(3.4) + 4, U(-0.73) - U(0.9), V(1.14) - V(3.4), 18); g.stroke();
  // door glass: dark, with a sky reflection band
  const gx = U(0.82), gy = V(3.28), gw = U(-0.62) - U(0.82), gh = V(2.28) - V(3.28); g.save(); rr(gx, gy, gw, gh, 26); g.clip();
  const gg = g.createLinearGradient(gx, gy, gx, gy + gh); gg.addColorStop(0, '#1d2a30'); gg.addColorStop(0.5, '#0c1114'); gg.addColorStop(1, '#070a0c'); g.fillStyle = gg; g.fillRect(gx, gy, gw, gh);
  g.fillStyle = 'rgba(160,190,200,0.12)'; g.beginPath(); g.moveTo(gx + gw * 0.15, gy); g.lineTo(gx + gw * 0.42, gy); g.lineTo(gx + gw * 0.22, gy + gh); g.lineTo(gx - gw * 0.05, gy + gh); g.fill(); g.restore();
  g.strokeStyle = '#2a2a2a'; g.lineWidth = 6; rr(gx, gy, gw, gh, 26); g.stroke();
  // handle, lock, mirror mount plates, beltline stripe, lower panel
  g.fillStyle = '#c9ccce'; rr(U(-0.52), V(2.16), 90, 20, 8); g.fill(); g.fillStyle = '#2b2b2b'; g.beginPath(); g.arc(U(-0.62), V(2.12), 7, 0, 7); g.fill();
  g.fillStyle = 'rgba(70,50,30,0.5)'; g.fillRect(0, V(2.02), w, 12);
  g.strokeStyle = 'rgba(20,18,14,0.5)'; g.lineWidth = 2; rr(U(0.8), V(2.0), U(-0.6) - U(0.8), V(1.25) - V(2.0), 12); g.stroke();
  // sleeper: small window, storage door, vent slats
  const sx = U(-1.95), sy = V(3.55), sw = U(-2.6) - U(-1.95), sh = V(2.95) - V(3.55); rr(sx, sy, sw, sh, 24); g.fillStyle = '#0a0e11'; g.fill(); g.strokeStyle = '#26282a'; g.lineWidth = 6; g.stroke();
  g.strokeStyle = 'rgba(20,18,14,0.55)'; g.lineWidth = 3; rr(U(-1.5), V(2.15), U(-3.05) - U(-1.5), V(1.3) - V(2.15), 10); g.stroke();
  for (let i = 0; i < 9; i++) { g.fillStyle = 'rgba(15,15,14,0.6)'; g.fillRect(U(-2.4), V(1.62) + i * 10, U(-2.8) - U(-2.4), 4); }
  // a chrome script badge plate
  g.fillStyle = '#b8bcbe'; rr(U(-1.1), V(3.05), 130, 34, 6); g.fill(); g.fillStyle = '#3a3c3e'; g.font = `${24}px "Big Shoulders Stencil Display", sans-serif`; g.fillText('AERO 8', U(-1.1) + 16, V(3.05) + 26);
  // rain streaks from the glass and roof edge, road dirt low
  for (let i = 0; i < 60; i++) { const x = R() * w, y0 = R() < 0.5 ? 0 : gy + gh, len = 60 + R() * 380; const gs = g.createLinearGradient(0, y0, 0, y0 + len); gs.addColorStop(0, `rgba(60,48,34,${0.10 + R() * 0.25})`); gs.addColorStop(1, 'rgba(60,48,34,0)'); g.fillStyle = gs; g.fillRect(x, y0, 2 + R() * 9, len); }
  const dg = g.createLinearGradient(0, h * 0.7, 0, h); dg.addColorStop(0, 'rgba(50,40,28,0)'); dg.addColorStop(1, `rgba(50,40,28,${0.5 * dirt})`); g.fillStyle = dg; g.fillRect(0, h * 0.7, w, h * 0.3);
  for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${R() < .5 ? '0,0,0' : '255,255,240'},${R() * 0.05})`; g.fillRect(R() * w, R() * h, 1 + R() * 3, 1 + R() * 2); }
  // plain paint at the (0.015, 0.015) corner texel for non-side faces (uv fallback): a clean patch
  g.fillStyle = paint; g.fillRect(0, h - 40, 60, 40);
  return c;
}
export function cabSide(o) { const t = new THREE.CanvasTexture(cabSideCanvas(o)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
