// PEOPLE'S NATIONAL BANK (c20, 15 Oct: the household clock, the stamps gone, the dwell, the breath at the bell; v9 = c17: the hook on the
// debt clock, the script audited). Takes: bank3 (= take a: the 1942 faces), bank3_b (present-day workers from the person pipeline in the
// oval), bank3_c (open on the bank's books; the clock first appears when HOUSEHOLDS OWE lands). bank3_b.html / bank3_c.html set
// window.BANK_TAKE before loading this file.
// (v8, intaglio): Steel-plate line engraving and its printed relief, never a flat drawing: every frame is
// an ink layer (burin line work, rose-engine guilloche, and public-domain photographs of working people and work cut straight
// into line engraving by bank3.photo.js / lib/fx/figure_ref.js) relit as a physical object by lib/fx/intaglio.js, either as
// grooves in blued steel or as raised ink on cream stock under an orbiting raking key.
// c20 picture: no rubber stamp anywhere (the client, 8 Oct): things change by the piece's own crafts. The clock's wheels seize and the
// burin cancels the old plate (FED ABOLISHED.); a ruling pen strikes the Fed note's own clause through in red, word by word (ALL DEBTS.
// PUBLIC. PRIVATE.); the rose engine cuts SOVEREIGN into the seal's ring; the typewriter's red ribbon types NEW MONEY and the IOUs; the
// clock counts what households owe and lands on $0.00 itself.
import { W, H, loadFonts, loadBeats, clamp, lerp, ease, rng, outCanvas, Finish, BRAND, tinted } from '../lib/kit.js';
import { Print } from '../lib/fx/print.js';
import { Intaglio } from '../lib/fx/intaglio.js';
import { loadFace, shape } from '../lib/fx/type.js';
import { drawMark, drawLockup } from '../lib/closer.js';
import { setBlock, typeAudit, planLoad, SAFE, measure } from '../lib/fx/type_world.js';
import * as PH from './bank3.photo.js';

const ctx = outCanvas();
await loadFonts();
const SCENE = (location.pathname.split('/').pop() || 'bank3.html').replace(/\.html$/, '');
const TAKE = window.BANK_TAKE || 'a';                  // a: 1942 faces; b: present-day workers (person pipeline); c: open on the books
// c21 (v15): the opening rebuilt (the client, 15 Oct, on v14: "an incoherent and disorienting opening rather than a hook and coherent
// entry into the video topic, seems rushed"). v14 put four ideas in its first 2.6 s (a cropped clock on a dark plate, IOU, the promise,
// the books). Now the opening is its own 14 song beats (6 s): two ideas, each held about 3 s on one whole object, then v14's piece from
// its b6 (the books), 8 beats later. Takes: x opens on the whole Federal Reserve note (EVERY DOLLAR IS AN IOU., IOU typed in red in its
// oval) then its promise (PAYABLE FOREVER.); y opens on the household clock, whole and legible (HOUSEHOLDS OWE $18.8 TRILLION.), then
// the note (EVERY DOLLAR IS AN IOU.), and PAYABLE FOREVER. moves to the corridor where the clock runs again.
const OPENT = TAKE === 'y' ? 'y' : 'x';
const B = await loadBeats(SCENE);
const pr = new Print(); const ig = new Intaglio(pr);
const finish = new Finish(1913);
const PF = await loadFace('playfair');
const PFDIR = '../node_modules/@fontsource/playfair-display/files/playfair-display-latin-';
for (const [w, st] of [['900', 'normal'], ['700', 'normal'], ['400', 'italic'], ['400', 'normal']])
  document.fonts.add(await new FontFace('Playfair Display', `url(${PFDIR}${w}-${st}.woff2)`, { weight: w, style: st }).load());
const PAPER = { base: '#EFE6CF', fib: 0.8, laid: 0, fleck: 0.2, mottle: 0.55, tooth: 0.9 };
const K = '#000', RD = '#ff0000', WH = '#ffffff';
const TAU = Math.PI * 2;
const PERF = { n: 0 };
const CLOSE = 69.5;                                   // v8: the lock (the song's final chord); the push into the medallion starts at PUSHB, the lockup holds to the end of the song
const PUSHB = 66.5;

// the ink layer everything is engraved into
const ink = document.createElement('canvas'); ink.width = W; ink.height = H;
const g = ink.getContext('2d', { willReadFrequently: false });
const mk = (w = W, h = H) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const font = (px, w = '900', st = 'normal') => `${st} ${w} ${px}px "Playfair Display"`;

// ================================================================ rose engine and lathe work
function ring(c, cx, cy, r, amp, k, n, lw, p = 1, a0 = 0) {
  c.lineWidth = lw;
  for (let i = 0; i < n; i++) {
    const S = Math.ceil(r * TAU / 1.4), ph = i / n * TAU; c.beginPath();
    for (let j = 0; j <= S * p; j++) { const th = j / S * TAU + a0, rr = r + amp * Math.sin(k * th + ph);
      j ? c.lineTo(cx + rr * Math.cos(th), cy + rr * Math.sin(th)) : c.moveTo(cx + rr * Math.cos(th), cy + rr * Math.sin(th)); }
    c.stroke();
  }
}
const ROSE = [];
for (let i = 0; i < 16; i++) ROSE.push({ f: 1 - i / 17, amp: 0.035 + 0.02 * (i % 3), k: [18, 24, 12, 30][i % 4], n: 5 + (i % 3) });
function rosette(c, cx, cy, R, lw, p = 1, a0 = 0) {
  const m = ROSE.length;
  for (let i = 0; i < m; i++) { const q = clamp(p * m - i); if (q <= 0) break; const o = ROSE[i]; ring(c, cx, cy, R * o.f, R * o.amp, o.k, o.n, lw, q, a0 + i * 0.3); }
  if (p >= 1) hypo(c, cx, cy, R * 0.1, lw);
}
function hypo(c, cx, cy, R, lw) {   // centre medallion: concentric engraved rings and a dot. No star of any kind: a star at the
  c.lineWidth = lw;                  // heart of the Fed note reads as the antisemitic "Fed" trope (audit, 27 Sep)
  for (const f of [1, 0.78, 0.56]) { c.beginPath(); c.arc(cx, cy, R * f, 0, TAU); c.stroke(); }
  ring(c, cx, cy, R * 0.9, R * 0.06, 16, 3, lw * 0.8);
  c.beginPath(); c.arc(cx, cy, R * 0.18, 0, TAU); c.fillStyle = c.strokeStyle; c.fill();
}
const SEAL = { x: 0, y: 345, R: 165 }, RI = 3;
function groovePt(u) { const o = ROSE[RI], r = SEAL.R * o.f, th = u * TAU + RI * 0.3, rr = r + SEAL.R * o.amp * Math.sin(o.k * th);
  return [SEAL.x + rr * Math.cos(th), SEAL.y + rr * Math.sin(th)]; }
function band(c, x0, y0, x1, y1, amp, lam, n, lw) {
  const L = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / L, uy = (y1 - y0) / L; c.lineWidth = lw;
  for (let i = 0; i < n; i++) { c.beginPath(); const ph = i / n * TAU;
    for (let s = 0; s <= L; s += 2) { const d = amp * Math.sin(s / lam * TAU + ph); const x = x0 + ux * s - uy * d, y = y0 + uy * s + ux * d; s ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.stroke(); }
}
// engraved lettering: solid ink with hairline white rulings that open toward the lit top, like a banknote legend
function legend(c, text, x, y, px, { w = '900', maxW = 1e9, align = 'center', rule = true, color = K, track = 0 } = {}) {
  c.font = font(px, w); c.textAlign = align; c.textBaseline = 'alphabetic';
  let s = px; while (c.measureText(text).width > maxW && s > 6) { s -= 1; c.font = font(s, w); }
  c.fillStyle = color; c.fillText(text, x, y);
  if (rule && s > 18) { const tw = c.measureText(text).width, x0 = align === 'center' ? x - tw / 2 : align === 'right' ? x - tw : x;
    c.save(); c.globalCompositeOperation = 'destination-out'; c.beginPath(); c.rect(x0, y - s, tw, s * 1.1); c.clip();
    c.strokeStyle = 'rgba(0,0,0,0.85)';
    for (let yy = y - s * 0.72, k = 0; yy < y - s * 0.28; yy += s * 0.075, k++) { c.lineWidth = s * 0.03 * (1 - k * 0.12); c.beginPath(); c.moveTo(x0, yy); c.lineTo(x0 + tw, yy); c.stroke(); }
    c.restore(); }
  return s;
}
function micro(c, text, x, y, len, px = 6, ang = 0) {
  c.save(); c.translate(x, y); c.rotate(ang); c.font = font(px, '700'); c.textAlign = 'left'; c.fillStyle = K;
  let s = ''; while (c.measureText(s).width < len) s += text + ' · '; c.beginPath(); c.rect(0, -px, len, px * 1.4); c.clip(); c.fillText(s, 0, 0); c.restore();
}
function tint(c, x0, y0, x1, y1, pitch, lw, amp = 3, lam = 60) {
  c.lineWidth = lw; c.beginPath();
  for (let y = y0; y <= y1; y += pitch) for (let x = x0; x <= x1; x += 4) { const yy = y + amp * Math.sin(x / lam * TAU + y * 0.05); x === x0 ? c.moveTo(x, yy) : c.lineTo(x, yy); }
  c.stroke();
}
function hatchRect(c, x0, y0, x1, y1, pitch, lw, ang = 0) {
  c.save(); c.beginPath(); c.rect(x0, y0, x1 - x0, y1 - y0); c.clip(); c.lineWidth = lw; c.beginPath();
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, R = Math.hypot(x1 - x0, y1 - y0) / 2, ca = Math.cos(ang), sa = Math.sin(ang);
  for (let k = -R; k <= R; k += pitch) { c.moveTo(cx - R * ca - k * sa, cy - R * sa + k * ca); c.lineTo(cx + R * ca - k * sa, cy + R * sa + k * ca); }
  c.stroke(); c.restore();
}
// acanthus scroll: a C-scroll spiral, its engraved inner line and shading, with leaves thrown off the stem
function scroll(c, x, y, s, flip = 1, seed = 1) {
  const r = rng(seed); c.save(); c.translate(x, y); c.scale(s * flip, s); c.strokeStyle = K; c.fillStyle = K;
  const sp = th => { const rr = 6 * Math.exp(0.19 * th); return [rr * Math.cos(th), -rr * Math.sin(th) * 0.8]; };
  const N = 120, T1 = 3.3 * Math.PI;
  for (const [off, lw] of [[0, 2.4], [0.13, 0.8]]) { c.lineWidth = lw; c.beginPath(); for (let i = 0; i <= N; i++) { const th = i / N * T1, [px, py] = sp(th); const f = 1 - off; i ? c.lineTo(px * f, py * f) : c.moveTo(px * f, py * f); } c.stroke(); }
  c.lineWidth = 0.7; c.beginPath(); for (let i = 20; i <= N; i += 2) { const th = i / N * T1, [px, py] = sp(th), [qx, qy] = sp(th); c.moveTo(px, py); c.lineTo(qx * 0.87, qy * 0.87); } c.stroke();
  for (let k = 0; k < 6; k++) { const th = T1 * (0.35 + k * 0.1), [px, py] = sp(th), a = -th + Math.PI / 2 + (r() - 0.5) * 0.4, L = 16 + r() * 18;
    c.save(); c.translate(px, py); c.rotate(a); c.lineWidth = 1.1; c.beginPath(); c.moveTo(0, 0); c.bezierCurveTo(L * 0.3, -L * 0.45, L * 0.8, -L * 0.3, L, 0); c.bezierCurveTo(L * 0.8, L * 0.3, L * 0.3, L * 0.45, 0, 0); c.stroke();
    c.lineWidth = 0.6; c.beginPath(); c.moveTo(0, 0); c.lineTo(L * 0.9, 0); for (let q = 0.2; q < 0.9; q += 0.12) { c.moveTo(L * q, 0); c.lineTo(L * (q + 0.08), -L * 0.28 * Math.sin(q * Math.PI)); } c.stroke(); c.restore(); }
  c.restore();
}
// a signature, pen-drawn: loops and a flourish, over an engraved title
function signature(c, x, y, w, seed, title) {
  const r = rng(seed); c.save(); c.strokeStyle = K; c.lineCap = 'round';
  let px = x - w / 2, py = y; c.beginPath(); c.moveTo(px, py);
  for (let i = 0; i < 9; i++) { const lw = w / 9, up = 14 + r() * 16, lp = r() > 0.5;
    c.bezierCurveTo(px + lw * 0.2, py - up, px + lw * (lp ? 0.9 : 0.5), py - up * 0.8, px + lw * 0.45, py + 4);
    c.bezierCurveTo(px + lw * 0.3, py + 8, px + lw * 0.8, py + 6, px + lw, py + (r() - 0.5) * 6); px += lw; py = y + (r() - 0.5) * 6; }
  c.lineWidth = 2; c.stroke();
  c.beginPath(); c.moveTo(x - w * 0.45, y + 14); c.bezierCurveTo(x - w * 0.1, y + 24, x + w * 0.2, y + 6, x + w * 0.52, y + 16); c.lineWidth = 1.4; c.stroke();
  c.lineWidth = 0.8; c.beginPath(); c.moveTo(x - w / 2, y + 30); c.lineTo(x + w / 2, y + 30); c.stroke();
  c.restore();
  legend(c, title, x, y + 46, 12, { w: '700', maxW: w + 20, rule: false });
}

// ================================================================ the notes (world units, origin at the centre)
const NW = 900, NH = 1640;
const PORTRAIT = { x: 0, y: -200, rx: 245, ry: 250 };
// the seal's mark is the ACP logo's emblem with its FOUR stripes (kit BRAND.acp_emblem), cut by the rose engine's rings
const markMask = (() => { const M = BRAND.acp_emblem, c = mk(M.width * 2, M.height * 2); c.getContext('2d').drawImage(tinted(M, '#000'), 0, 0, c.width, c.height); return c; })();
// v8: the oval holds real people (public-domain photographs cut as line engraving, bank3.photo.js), not a modelled head
const FS = 2.6, OVW = Math.round(PORTRAIT.rx * 2 * FS), OVH = Math.round(PORTRAIT.ry * 2 * FS);
const FACEBOX = { woman: [0, 150, OVW, OVH], old: [0, 110, OVW, OVH], young: [-60, 130, OVW + 40, OVH], mech: [-30, 140, OVW, OVH] };
// take b (c20): present-day workers from the person pipeline (Cycles face stills, farm job 1015-082033, keyed off the studio ground),
// cut with the same engrave as the plate; the 1942 photographs stay in take a
const FACESET = TAKE === 'b' ? ['p_l22', 'p_l05', 'p_l17', 'p_l06'] : PH.FACE_NAMES;
for (const n of FACESET) if (!FACEBOX[n]) FACEBOX[n] = [-40, 60, OVW + 80, OVH + 40];
const FACEC = {};
// v9: the fourth face's hair was a solid black mass that read as a blob while the oval swapped (v8 b29.4): a lighter curve gives it lines
for (const n of FACESET) FACEC[n] = await PH.face(n, OVW, OVH, FACEBOX[n], n === 'mech' ? { gamma: 0.5, gain: 0.82, lift: 0.0, clarity: 1.1 } : n.startsWith('p_') ? { gamma: 0.85, clarity: 1.1 } : {});
function faceInOval(c, name, a = 1) { const P = PORTRAIT, F = FACEC[name]; if (!F) return; c.save(); c.globalAlpha = a; c.drawImage(F, P.x - P.rx, P.y - P.ry, P.rx * 2, P.ry * 2); c.restore(); }
const CORN = [[-300, -430], [300, -430], [-320, 612], [320, 612]];
function frameWork(c, old, micA, micB, micS) {
  const hw = NW / 2, hh = NH / 2;
  c.fillStyle = WH; c.fillRect(-hw, -hh, NW, NH);
  c.strokeStyle = K; c.fillStyle = K;
  tint(c, -hw + 70, -hh + 70, hw - 70, hh - 70, old ? 7 : 6, 0.55, 3, old ? 90 : 55);
  c.lineWidth = 3; c.strokeRect(-hw + 4, -hh + 4, NW - 8, NH - 8); c.lineWidth = 1; c.strokeRect(-hw + 12, -hh + 12, NW - 24, NH - 24);
  const bi = 36;
  band(c, -hw + bi, -hh + bi, hw - bi, -hh + bi, 16, 34, 7, 0.9); band(c, -hw + bi, hh - bi, hw - bi, hh - bi, 16, 34, 7, 0.9);
  band(c, -hw + bi, -hh + bi, -hw + bi, hh - bi, 16, 34, 7, 0.9); band(c, hw - bi, -hh + bi, hw - bi, hh - bi, 16, 34, 7, 0.9);
  c.lineWidth = 2.2; c.strokeRect(-hw + 60, -hh + 60, NW - 120, NH - 120); c.lineWidth = 0.8; c.strokeRect(-hw + 65, -hh + 65, NW - 130, NH - 130);
  // a second, finer lathe band inside the frame, and the corner blocks
  c.save(); c.beginPath(); c.rect(-hw + 70, -hh + 70, NW - 140, NH - 140); c.rect(-hw + 92, -hh + 92, NW - 184, NH - 184); c.clip('evenodd'); c.fillStyle = WH; c.fillRect(-hw, -hh, NW, NH);
  band(c, -hw + 81, -hh + 81, hw - 81, -hh + 81, 6, 14, 5, 0.55); band(c, -hw + 81, hh - 81, hw - 81, hh - 81, 6, 14, 5, 0.55);
  band(c, -hw + 81, -hh + 81, -hw + 81, hh - 81, 6, 14, 5, 0.55); band(c, hw - 81, -hh + 81, hw - 81, hh - 81, 6, 14, 5, 0.55); c.restore();
  c.lineWidth = 0.8; c.strokeRect(-hw + 92, -hh + 92, NW - 184, NH - 184);
  micro(c, micA, -hw + 70, -hh + 76, NW - 140, 6); micro(c, micB, -hw + 70, hh - 70, NW - 140, 6);
  micro(c, micS, -hw + 76, hh - 76, NH - 152, 6, -Math.PI / 2); micro(c, micS, hw - 76, -hh + 76, NH - 152, 6, Math.PI / 2);
  micro(c, micA, -hw + 96, -hh + 100, NW - 192, 4.5); micro(c, micB, -hw + 96, hh - 96, NW - 192, 4.5);
}
function drawNote(c, kind) {
  const hw = NW / 2, hh = NH / 2, old = kind === 'old';
  frameWork(c, old, old ? 'FEDERAL RESERVE NOTE · THE UNITED STATES OF AMERICA' : "THE PEOPLE'S NATIONAL BANK OF THE UNITED STATES OF AMERICA",
    old ? 'SERIES OF 1913 · 43–25 · DEC 23, 1913' : 'DEBT JUBILEE · CREDIT FOR PRODUCTION · SOVEREIGN AGREEMENTS',
    old ? 'LEGAL TENDER FOR ALL DEBTS PUBLIC AND PRIVATE' : 'BACKED BY STEEL · RAIL · GRAIN · CHIPS · THE PRODUCTION OF THE NATION');
  // header, kept clear of the serials below it
  c.fillStyle = WH; c.fillRect(-hw + 100, -hh + 100, NW - 200, 150);
  c.fillStyle = K;
  if (old) { legend(c, 'FEDERAL RESERVE NOTE', 0, -hh + 180, 66, { maxW: NW - 230 }); legend(c, 'THE UNITED STATES OF AMERICA', 0, -hh + 222, 28, { w: '700', maxW: 540 }); }
  else { legend(c, "THE PEOPLE'S NATIONAL BANK", 0, -hh + 178, 58, { maxW: NW - 230 }); legend(c, 'OF THE UNITED STATES OF AMERICA', 0, -hh + 220, 26, { w: '700', maxW: 540 }); }
  // corner rosettes (numerals are live, they flip), each in its own lathe disc
  for (const [x, y] of CORN) { c.fillStyle = WH; c.beginPath(); c.arc(x, y, 90, 0, TAU); c.fill(); c.strokeStyle = K; rosette(c, x, y, 86, 0.7, 1, x * 0.01); c.fillStyle = WH; c.beginPath(); c.arc(x, y, 52, 0, TAU); c.fill(); ring(c, x, y, 52, 3, 20, 3, 0.9); ring(c, x, y, 44, 1.5, 36, 2, 0.5); }
  // scrollwork either side of the oval and of the seal
  for (const s of [-1, 1]) { scroll(c, s * 330, -150, 1.25, s, 3); scroll(c, s * 330, 60, 0.95, -s, 5); scroll(c, s * 300, 340, 1.1, s, 7); }
  // portrait oval: ruled dark lattice field, the head, a lattice frame
  const P = PORTRAIT;
  c.save(); c.beginPath(); c.ellipse(P.x, P.y, P.rx + 34, P.ry + 34, 0, 0, TAU); c.fillStyle = WH; c.fill(); c.restore();
  c.save(); c.beginPath(); c.ellipse(P.x, P.y, P.rx, P.ry, 0, 0, TAU); c.clip();
  if (old) { c.fillStyle = WH; c.fillRect(P.x - P.rx, P.y - P.ry, P.rx * 2, P.ry * 2); c.strokeStyle = K; for (let r = 20; r < P.ry * 1.1; r += 22) ring(c, P.x, P.y, r, 5, 16 + (r / 22 | 0) % 3 * 6, 3, 0.8); hypo(c, P.x, P.y, 60, 1); }
  else { lattice(c); if (kind === 'new') faceInOval(c, FACESET[0]); }
  c.restore();
  c.strokeStyle = K;
  for (let k = 0; k < 7; k++) { c.lineWidth = 0.8; c.beginPath(); for (let j = 0; j <= 720; j++) { const th = j / 720 * TAU, d = 12 * Math.sin(th * 48 + k / 7 * TAU); const x = P.x + (P.rx + 17 + d) * Math.cos(th), y = P.y + (P.ry + 17 + d) * Math.sin(th); j ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); }
  c.lineWidth = 2.4; c.beginPath(); c.ellipse(P.x, P.y, P.rx, P.ry, 0, 0, TAU); c.stroke(); c.lineWidth = 1.2; c.beginPath(); c.ellipse(P.x, P.y, P.rx + 34, P.ry + 34, 0, 0, TAU); c.stroke();
  // the ribbon under the oval
  c.fillStyle = WH; c.fillRect(-330, 96, 660, 52); c.lineWidth = 1.4; c.strokeRect(-330, 96, 660, 52); c.lineWidth = 0.6; c.strokeRect(-324, 101, 648, 42);
  for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * 330, 96); c.lineTo(s * 372, 110); c.lineTo(s * 352, 122); c.lineTo(s * 372, 134); c.lineTo(s * 330, 148); c.stroke(); }
  c.fillStyle = K; legend(c, old ? 'LEGAL TENDER FOR ALL DEBTS, PUBLIC AND PRIVATE' : 'BACKED BY THE PRODUCTION OF THE NATION', 0, 131, 21, { w: '700', maxW: 620, rule: false });
  // the seal rosette
  c.fillStyle = WH; c.beginPath(); c.arc(SEAL.x, SEAL.y, SEAL.R + 20, 0, TAU); c.fill(); c.strokeStyle = K;
  rosette(c, SEAL.x, SEAL.y, SEAL.R, 0.75, 1);
  ring(c, SEAL.x, SEAL.y, SEAL.R + 12, 5, 64, 4, 0.8);
  c.fillStyle = WH; c.beginPath(); c.arc(SEAL.x, SEAL.y, SEAL.R * 0.44, 0, TAU); c.fill();
  c.lineWidth = 1.4; c.beginPath(); c.arc(SEAL.x, SEAL.y, SEAL.R * 0.44, 0, TAU); c.stroke();
  if (old) { ring(c, SEAL.x, SEAL.y, SEAL.R * 0.3, 6, 12, 5, 0.8); hypo(c, SEAL.x, SEAL.y, 30, 1); }
  // date, promise, denomination, signatures
  if (old) { c.fillStyle = WH; c.fillRect(-hw + 95, SEAL.y - 36, 150, 74); c.lineWidth = 1; c.strokeRect(-hw + 99, SEAL.y - 32, 142, 66); c.fillStyle = K; legend(c, 'DEC 23, 1913', -hw + 170, SEAL.y + 6, 22, { w: '700', maxW: 130, rule: false });
    micro(c, 'SERIES OF 1913 · VOTE 43–25', -hw + 104, SEAL.y + 26, 132, 6);
    c.fillStyle = WH; c.fillRect(-235, 548, 470, 128); c.lineWidth = 1.2; c.strokeRect(-235, 548, 470, 128); c.fillStyle = K;
    legend(c, 'WILL PAY TO THE BEARER ON DEMAND', 0, 578, 20, { w: '700', maxW: 440, rule: false });
    legend(c, 'ONE HUNDRED', 0, 626, 44, { maxW: 440 }); legend(c, 'DOLLARS', 0, 666, 32, { maxW: 440 }); }
  else { c.fillStyle = WH; c.fillRect(-230, 540, 460, 140); c.lineWidth = 1.2; c.strokeRect(-230, 540, 460, 140); c.lineWidth = 0.6; c.strokeRect(-224, 546, 448, 128); c.fillStyle = K;
    legend(c, 'ONE', 0, 662, 132, { maxW: 420 }); micro(c, 'SERIES OF THE FIFTIETH YEAR', -220, 690, 440, 6); }
  signature(c, -150, 722, 210, old ? 11 : 21, old ? 'TREASURER OF THE UNITED STATES' : "CHAIR, PEOPLE'S NATIONAL BANK");
  signature(c, 150, 722, 210, old ? 12 : 22, 'SECRETARY OF THE TREASURY');
}
// the back of the new note (v8): after the 1914 Federal Reserve Note reverses, four engraved vignettes of what backs the
// money, each in its own lathe-framed panel round the Bank's seal: steel (top left), rail (top right), grain (bottom
// left), the works (bottom right). The panels are public-domain photographs cut as line engraving (bank3.photo.js).
const PW = 340, PHT = 550, VK = 3, PAN = [{ x: -358, y: -560 }, { x: 18, y: -560 }, { x: -358, y: 10 }, { x: 18, y: 10 }];
const PANC = PAN.map(p => [p.x + PW / 2, p.y + PHT / 2]);
// c20: the panels are cut bolder (wider rule, fewer planes, as the gate is), so they read as engraving and not as halftone photographs;
// the steel pour is held down (it was blown white) so the bright metal keeps its lines; the works panel is framed on the woman's face
// and hands at the machine (it was cropped to an arm)
const VG = { fade: 0.05, pitch: 7.2, planes: 5, gamma: 0.9, clarity: 1.15, gain: 1.0 };
const VIGS = [await PH.vignette('steel', [0.60, 0.50, 1.0], PW * VK, PHT * VK, { ...VG, gamma: 1.15, gain: 0.86, lift: 0.0, clarity: 1.3 }), await PH.vignette('rail', [0.45, 0.45, 0.9], PW * VK, PHT * VK, VG),
  await PH.vignette('grain', [0.50, 0.50, 1.0], PW * VK, PHT * VK, VG), await PH.vignette('works', [0.56, 0.46, 0.92], PW * VK, PHT * VK, VG)];
function panelFrame(c, P) {
  c.fillStyle = WH; c.fillRect(P.x - 16, P.y - 16, PW + 32, PHT + 32); c.strokeStyle = K;
  band(c, P.x - 8, P.y - 8, P.x + PW + 8, P.y - 8, 4, 14, 4, 0.7); band(c, P.x - 8, P.y + PHT + 8, P.x + PW + 8, P.y + PHT + 8, 4, 14, 4, 0.7);
  band(c, P.x - 8, P.y - 8, P.x - 8, P.y + PHT + 8, 4, 14, 4, 0.7); band(c, P.x + PW + 8, P.y - 8, P.x + PW + 8, P.y + PHT + 8, 4, 14, 4, 0.7);
  c.lineWidth = 1.4; c.strokeRect(P.x - 15, P.y - 15, PW + 30, PHT + 30);
}
function drawBack(c) {
  const hw = NW / 2, hh = NH / 2;
  frameWork(c, false, "THE PEOPLE'S NATIONAL BANK OF THE UNITED STATES OF AMERICA", 'STEEL · RAIL · GRAIN · THE WORKS · STEEL · RAIL · GRAIN · THE WORKS', 'BACKED BY THE PRODUCTION OF THE NATION');
  c.fillStyle = WH; c.fillRect(-hw + 100, -hh + 100, NW - 200, 130); c.fillStyle = K;
  legend(c, "THE PEOPLE'S NATIONAL BANK", 0, -hh + 175, 54, { maxW: NW - 230 });
  PAN.forEach((P, i) => { panelFrame(c, P); c.drawImage(VIGS[i], P.x, P.y, PW, PHT); c.strokeStyle = K; c.lineWidth = 2; c.strokeRect(P.x, P.y, PW, PHT); });
  // the roundel at the cross of the four panels: the place the seal is struck
  c.fillStyle = WH; c.beginPath(); c.arc(0, 0, 100, 0, TAU); c.fill(); c.strokeStyle = K; rosette(c, 0, 0, 94, 0.75, 1, 0.5); ring(c, 0, 0, 104, 3, 48, 3, 0.8);
  c.fillStyle = WH; c.beginPath(); c.arc(0, 0, 42, 0, TAU); c.fill(); c.lineWidth = 1.2; c.beginPath(); c.arc(0, 0, 42, 0, TAU); c.stroke(); hypo(c, 0, 0, 30, 1);
  // the foot: ONE between two numeral discs
  for (const [x, y] of [[-290, 652], [290, 652]]) { c.fillStyle = WH; c.beginPath(); c.arc(x, y, 62, 0, TAU); c.fill(); rosette(c, x, y, 59, 0.6, 1, x * 0.01); c.fillStyle = WH; c.beginPath(); c.arc(x, y, 34, 0, TAU); c.fill(); c.fillStyle = K; legend(c, '1', x, y + 22, 62, { maxW: 50 }); }
  c.fillStyle = WH; c.fillRect(-190, 596, 380, 110); c.strokeStyle = K; c.lineWidth = 1.2; c.strokeRect(-190, 596, 380, 110); c.fillStyle = K; legend(c, 'ONE', 0, 682, 92, { maxW: 350 });
  micro(c, 'BACKED BY THE PRODUCTION OF THE NATION', -170, 710, 340, 6);
}
function lattice(c) {
  const P = PORTRAIT;
  hatchRect(c, P.x - P.rx, P.y - P.ry, P.x + P.rx, P.y + P.ry, 3.2, 1.7, 0); hatchRect(c, P.x - P.rx, P.y - P.ry, P.x + P.rx, P.y + P.ry, 4.6, 0.9, 1.05); hatchRect(c, P.x - P.rx, P.y - P.ry, P.x + P.rx, P.y + P.ry, 5.4, 0.7, -1.05);
}
function noteBake(kind, s = 2) { const c = mk(NW * s, NH * s), x = c.getContext('2d'); x.scale(s, s); x.translate(NW / 2, NH / 2); kind === 'back' ? drawBack(x) : drawNote(x, kind === 'bare' ? 'new_bare' : kind); return c; }

// ================================================================ live note parts: numerals, serials, the seal mark
function numerals(c, v) { for (const [x, y] of CORN) { c.fillStyle = WH; c.beginPath(); c.arc(x, y, 40, 0, TAU); c.fill(); c.fillStyle = K; legend(c, v, x, y + (v === '1' ? 30 : 15), v === '1' ? 84 : 42, { maxW: 74 }); } }
function serialStr(t, roll, zero, one) {
  if (one) return 'PN 00000001 A'; if (zero) return 'PN 00000000 A';
  const r = rng(Math.floor(t * 24 * roll) + 5);
  return `${'ABCDEFGH'[Math.floor(r() * 8)]}${'KLMNP'[Math.floor(r() * 5)]} ${Math.floor(r() * 1e8).toString().padStart(8, '0')} ${'ABCDE'[Math.floor(r() * 5)]}`;
}
function serials(c, s) { c.font = font(34, '700'); c.textAlign = 'center'; c.fillStyle = RD; c.fillText(s, -200, -NH / 2 + 290); c.fillText(s, 215, 528); }
function sealMark(c, u, color = K, scale = 1) {
  if (u <= 0) return;
  const r = SEAL.R * 0.42 * scale, M = markMask, tmp = sealMark.tmp || (sealMark.tmp = mk(420, 420)), x = tmp.getContext('2d');
  x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, 420, 420); x.translate(210, 210);
  x.strokeStyle = '#000'; x.lineWidth = 2.6;
  for (let k = 3; k < 200; k += 4.2) { x.beginPath(); x.arc(0, 0, k, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(u * 1.15 - k / 900)); x.stroke(); }
  const mw = 400, mh = mw * M.height / M.width; x.globalCompositeOperation = 'destination-in'; x.drawImage(M, -mw / 2, -mh / 2, mw, mh); x.globalCompositeOperation = 'source-over';
  if (color !== K) { x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(-210, -210, 420, 420); x.globalCompositeOperation = 'source-over'; }
  c.drawImage(tmp, SEAL.x - r, SEAL.y - r, r * 2, r * 2);
}

// ================================================================ the ledger corridor (two three-storey walls in one-point perspective)
const LW = { rows: 18, rowH: 0.92, len: 70, gap: 7.2 };
const BOOKS = []; { const r = rng(1929); for (let row = 0; row < LW.rows; row++) { let x = 0; while (x < LW.len) { const w = 0.07 + r() * 0.07; BOOKS.push({ row, x, w, h: 0.62 + r() * 0.24, tone: r(), band: r(), yr: [1913, 1929, 1987, 2008, 2020, 1933][Math.floor(r() * 6)], lab: ['LOANS', 'MORTGAGE', 'NOTES', 'BONDS', 'CARD', 'LIENS'][Math.floor(r() * 6)] }); x += w + 0.004; } } }
function wallCam(o) {
  const { cx, cy, d, yaw, f } = o, ca = Math.cos(yaw), sa = Math.sin(yaw);
  return (X, Y, Z = 0) => { const dx = X - cx, dz = d + Z; const x = dx * ca - dz * sa, z = dx * sa + dz * ca; return z < 0.3 ? null : [W / 2 + f * x / z, H / 2 - f * (Y - cy) / z, z]; };
}
let _hp = null;
function hatchPat() {
  if (_hp) return _hp; const mkp = (pitch, lw, cross) => { const c = mk(24, 24), x = c.getContext('2d'); x.fillStyle = WH; x.fillRect(0, 0, 24, 24); x.strokeStyle = K; x.lineWidth = lw;
    for (let y = pitch / 2; y < 24; y += pitch) { x.beginPath(); x.moveTo(0, y); x.lineTo(24, y); x.stroke(); } if (cross) for (let k = -24; k < 48; k += cross) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k + 24, 24); x.stroke(); } return g.createPattern(c, 'repeat'); };
  return (_hp = { dark: mkp(3, 1.8, 4), mid: mkp(4, 1.2, 0) });
}
function ledgerWall(c, cam, wash, t, Z0 = 0, floor = true, far = false) {
  const P0 = wallCam(cam), P = (X, Y, Z = 0) => P0(X, Y, Z + Z0);
  const top = LW.rows * LW.rowH + 0.6;
  c.strokeStyle = K;
  const HP = hatchPat();
  const quad = (a, b, c2, d2) => { if (!a || !b || !c2 || !d2) return false; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(c2[0], c2[1]); c.lineTo(d2[0], d2[1]); c.closePath(); return true; };
  if (quad(P(-2, 0), P(LW.len + 2, 0), P(LW.len + 2, top), P(-2, top))) { c.fillStyle = HP.dark; c.fill(); }
  if (floor) {
    const zc = -cam.d + 0.6 - (Z0 ? 0 : 0);
    const F = (X, Y, Z) => P0(X, Y, Z);
    const zf = Z0 || zc;
    if (quad(F(-6, 0, zf), F(LW.len + 2, 0, zf), F(LW.len + 2, 0, 0), F(-6, 0, 0))) { c.fillStyle = HP.mid; c.fill(); }
    c.lineWidth = 1.6; c.beginPath(); for (let z = 0; z > zf; z -= 0.35) { const a = F(-6, 0, z), b = F(LW.len + 2, 0, z); if (a && b) { c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); } } c.stroke();
    c.lineWidth = 1; c.beginPath(); for (let X = -6; X < LW.len; X += 1.2) { const a = F(X, 0, zf), b = F(X, 0, 0); if (a && b) { c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); } } c.stroke();
    if (quad(F(-6, top, zf), F(LW.len + 2, top, zf), F(LW.len + 2, top, 0), F(-6, top, 0))) { c.fillStyle = HP.mid; c.fill(); }
    c.lineWidth = 2.4; c.beginPath(); for (let X = -6; X < LW.len; X += 2.4) { const a = F(X, top, zf), b = F(X, top, 0); if (a && b) { c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); } }
    for (let z = 0; z > zf; z -= 1.2) { const a = F(-6, top, z), b = F(LW.len + 2, top, z); if (a && b) { c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); } } c.stroke();
  }
  for (let row = 0; row < LW.rows; row++) {
    const y0 = row * LW.rowH;
    const a = P(-2, y0), b = P(LW.len + 2, y0), a2 = P(-2, y0 - 0.06), b2 = P(LW.len + 2, y0 - 0.06);
    if (a && b && a2 && b2) { c.fillStyle = K; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(b2[0], b2[1]); c.lineTo(a2[0], a2[1]); c.fill(); }
  }
  for (const bk of BOOKS) {
    const y0 = bk.row * LW.rowH;
    const p0 = P(bk.x, y0), p1 = P(bk.x + bk.w, y0 + bk.h);
    if (!p0 || !p1) continue;
    const x0 = Math.min(p0[0], p1[0]), x1 = Math.max(p0[0], p1[0]); if (x1 < -20 || x0 > W + 20) continue;
    const yb = p0[1], yt = p1[1], sw = x1 - x0; if (Math.abs(sw) < 0.4) continue;
    const washed = clamp((wash - (far ? 1 - bk.x / LW.len : bk.x / LW.len)) * 8 - (bk.row % 3) * 0.1);
    const dark = 0.3 + bk.tone * 0.6;
    if (washed >= 1) { c.lineWidth = Math.min(1.2, sw * 0.12); c.strokeRect(x0, yt, sw, yb - yt); if (sw > 14) { c.fillStyle = K; c.font = font(Math.min(sw * 0.5, 30), '700'); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('0', x0 + sw / 2, lerp(yt, yb, 0.45)); } continue; }
    const pitch = Math.max(2.2, Math.abs(sw) / lerp(5, 11, dark));
    c.lineWidth = Math.max(0.5, Math.min(pitch * 0.4, 3.2));
    c.fillStyle = WH; c.fillRect(x0, yt, sw, yb - yt);
    c.save(); c.beginPath(); c.rect(x0, yt + (yb - yt) * washed, sw, (yb - yt) * (1 - washed)); c.clip();
    c.beginPath(); for (let x = x0 + pitch * 0.5; x < x1; x += pitch) { c.moveTo(x, yt); c.lineTo(x, yb); } c.stroke();
    if (sw > 5) { c.fillStyle = WH; const by = [0.1, 0.16, 0.84, 0.9]; for (const f of by) c.fillRect(x0, lerp(yt, yb, f), sw, Math.max(1, (yb - yt) * 0.028));
      if (sw > 14) { const ly = lerp(yt, yb, 0.24), lh = (yb - yt) * 0.2; c.fillStyle = WH; c.fillRect(x0 + sw * 0.1, ly, sw * 0.8, lh); c.fillStyle = K; c.lineWidth = 1; c.strokeRect(x0 + sw * 0.1, ly, sw * 0.8, lh);
        c.save(); c.translate(x0 + sw / 2, ly + lh * 0.5); c.rotate(-Math.PI / 2); c.font = font(Math.min(lh * 0.62, sw * 0.5), '900'); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(bk.yr), 0, 0); c.restore();
        const ny = lerp(yt, yb, 0.5), nh = (yb - yt) * 0.28; c.fillStyle = WH; c.fillRect(x0 + sw * 0.14, ny, sw * 0.72, nh); c.fillStyle = K;
        c.save(); c.translate(x0 + sw / 2, ny + nh * 0.5); c.rotate(-Math.PI / 2); c.font = font(Math.min(nh * 0.2, sw * 0.36), '700'); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(bk.lab, 0, 0); c.restore();
        if (sw > 26) { c.fillStyle = WH; c.fillRect(x0 + sw * 0.62, yt - 2, sw * 0.26, (yb - yt) * 0.07); c.strokeRect(x0 + sw * 0.62, yt - 2, sw * 0.26, (yb - yt) * 0.07); } } }
    c.restore();
    c.lineWidth = Math.min(1.6, Math.max(0.5, sw * 0.08)); c.strokeRect(x0, yt, sw, yb - yt);
  }
  for (const sy of [6, 12]) { for (let X = -2; X < LW.len; X += 1.6) { const a = P(X, sy * LW.rowH - 0.1), b = P(X, sy * LW.rowH + 1.1); if (a && b && a[0] > -50 && a[0] < W + 50) { c.lineWidth = Math.max(0.8, 24 / a[2]); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); } }
    for (const hy of [1.1, 0.55]) { c.lineWidth = 2; c.beginPath(); let st = false; for (let X = -2; X < LW.len; X += 0.5) { const a = P(X, sy * LW.rowH + hy); if (!a) continue; st ? c.lineTo(a[0], a[1]) : (c.moveTo(a[0], a[1]), st = true); } c.stroke(); } }
  return P;
}
// engraved water: long parallel rulings with a rhythmic swell running along them, a curling crest at the front
function water(c, x0, y0, x1, y1, t, { pitch = 8, amp = 7, flow = 1, front = null } = {}) {
  c.save(); c.beginPath(); c.rect(x0, y0, x1 - x0, y1 - y0); c.clip(); c.strokeStyle = K; c.lineCap = 'round';
  for (let y = y0 - 20, k = 0; y < y1 + 20; y += pitch, k++) {
    let px = null, py = null;
    for (let x = x0 - 10; x <= x1 + 10; x += 10) {
      const ph = x * 0.009 - t * 3.2 * flow + k * 0.21, yy = y + amp * Math.sin(x * 0.0045 + k * 0.33 - t * 1.4 * flow) + amp * 0.35 * Math.sin(ph * 1.7);
      if (px !== null) { const sw = Math.pow(0.5 + 0.5 * Math.sin(ph), 3); c.lineWidth = 0.7 + 2.9 * sw; c.beginPath(); c.moveTo(px, py); c.lineTo(x, yy); c.stroke(); }
      px = x; py = yy;
    }
  }
  if (front !== null) {       // the breaking crest: a rolling curl down the front edge
    c.lineWidth = 2.2;
    for (let yb = y0; yb < y1; yb += 46) { const cx = front - 6 + 10 * Math.sin(yb * 0.03 + t * 5), cy = yb + 20;
      c.beginPath(); for (let j = 0; j < 40; j++) { const a = j * 0.26, rr = 34 * (1 - j / 46); c.lineTo(cx + Math.cos(a) * rr, cy - Math.sin(a) * rr * 0.7); } c.stroke();
      c.lineWidth = 1; c.beginPath(); for (let j = 0; j < 30; j++) { const a = j * 0.3 + 0.5, rr = 20 * (1 - j / 34); c.lineTo(cx + Math.cos(a) * rr, cy - Math.sin(a) * rr * 0.7); } c.stroke(); c.lineWidth = 2.2; }
  }
  c.restore();
}

// ================================================================ ledger pages, bond coupons
function page(c, kind, t, wash, zeroAt) {
  const r = rng(kind === 'bond' ? 36 : kind === 'deed' ? 38 : 34);
  c.fillStyle = WH; c.fillRect(-600, -1000, 1200, 2000); c.strokeStyle = K; c.fillStyle = K;
  if (kind === 'ledger' || kind === 'deed' || kind === 'balance') {
    tint(c, -560, -960, 560, 960, 5, 0.35, 1.5, 120);
    for (let y = -900; y < 960; y += 56) { c.lineWidth = 1; c.beginPath(); c.moveTo(-560, y); c.lineTo(560, y); c.stroke(); }
    c.fillStyle = RD; for (const x of [-420, -410, 150, 160, 400, 410]) c.fillRect(x, -960, 2.2, 1920);
    c.fillStyle = K;
    const names = kind === 'deed' ? ['MORTGAGE', 'LIEN', 'NOTE', 'INTEREST', 'ESCROW', 'PRINCIPAL', 'ARREARS', 'LATE FEE'] : ['MORTGAGE', 'STUDENT LOAN', 'CARD', 'AUTO LOAN', 'MEDICAL', 'BOND', 'NOTE', 'INTEREST', 'PAYDAY'];
    legend(c, kind === 'deed' ? 'DEED OF TRUST' : kind === 'balance' ? 'ACCOUNT' : 'LEDGER', 0, -930, 64, { maxW: 700 });
    for (let i = 0; i < 32; i++) { const y = -860 + i * 56;
      const zz = typeof zeroAt === 'function' ? zeroAt(i, y) : zeroAt !== undefined && (i + 1) / 33 < zeroAt ? 1 : 0, z = zz >= 0.55;
      if (zz > 0) { c.save(); c.fillStyle = RD; c.fillRect(-430, y + 22, 860 * Math.min(1, zz * 1.8), 6); c.restore(); c.fillStyle = K; }
      c.font = font(30, '400', 'italic'); c.textAlign = 'left'; c.fillStyle = K; c.fillText(names[i % names.length].toLowerCase().replace(/^./, m => m.toUpperCase()), -400, y + 40);
      c.textAlign = 'right'; c.font = font(34, '400', 'italic');
      const v = z || kind === 'balance' ? '0.00' : Math.floor(r() * 9e6 + 1e4).toLocaleString('en-US') + '.' + String(Math.floor(r() * 99)).padStart(2, '0');
      c.fillText(v, 395, y + 40); c.fillText(z || kind === 'balance' ? '—' : String(Math.floor(r() * 30 + 1)).padStart(2, '0') + '.' + (1929 + Math.floor(r() * 90)), 140, y + 40);
    }
  } else if (kind === 'bond') {
    tint(c, -560, -960, 560, 960, 4.5, 0.45, 3, 40);
    for (let j = 0; j < 7; j++) for (let i = 0; i < 3; i++) { const x = -520 + i * 350, y = -900 + j * 262;
      c.fillStyle = WH; c.fillRect(x, y, 330, 240); c.strokeStyle = K; c.lineWidth = 1.6; c.strokeRect(x + 6, y + 6, 318, 228); c.setLineDash([6, 5]); c.strokeRect(x, y, 330, 240); c.setLineDash([]);
      band(c, x + 16, y + 26, x + 314, y + 26, 6, 16, 5, 0.6); band(c, x + 16, y + 214, x + 314, y + 214, 6, 16, 5, 0.6);
      c.fillStyle = K; legend(c, 'COUPON', x + 165, y + 92, 34, { maxW: 260 }); c.font = font(26, '400', 'italic'); c.textAlign = 'center';
      c.fillText(`No. ${j * 3 + i + 11}   $${(Math.floor(r() * 90) + 10) * 125}.00`, x + 165, y + 140); c.font = font(18, '700'); c.fillText(`PAYABLE ${['MAR', 'SEP'][j % 2]} 1, ${2031 + j}`, x + 165, y + 180);
      c.save(); c.translate(x + 60, y + 170); ring(c, 0, 0, 28, 3, 14, 4, 0.6); c.restore(); }
  }
  if (wash > 0) { const xw = lerp(-700, 700, wash); c.fillStyle = WH; c.fillRect(-620, -1000, xw + 620 - 120, 2000); }
}

// ================================================================ words (c20): drawn over the relit print, full ink
// Held lines: Playfair 900 in solid black (K), the line's key word in red, no halo, no box; set in the upper band
// (y 290-560), out of the portrait oval and the note's legends, on the note's own ribbon (a cream strip with ruled edges).
// c20: no rubber stamp, and nothing stamp-like in its place (the client, 8 Oct). FED ABOLISHED. is a held line like every other
// (the clock seizes and the burin cancels the old plate under it); the Fed note's own clause is set large on its ribbon and a ruling
// pen strikes each word through in red as the chant reaches it; both JUBILEE!s are held lines; SOVEREIGN. is cut into the seal's ring
// by the rose engine; $0.00 is the clock itself. THE PEOPLE'S MONEY. is the heaviest set in the piece.
const RED = '#c8161e', CREAM = '#f4eddb', PAPERC = '#efe6cf';
// [start, end, text, kind, key word, style]
// The argument, in the order a stranger follows it: every dollar is an IOU (the clock of what households owe, the old note's promise);
// HOW: banks create money by lending, so most money started as a debt (the bank's books), and households owe $18.8 trillion (the
// corridor, the clock again); the Fed abolished (the clock seizes, the old plate cancelled); a People's National Bank, and a public bank
// is a thing working people have won (North Dakota's farmers, 1919); the faces on the money and the shift at the gate (no words); we
// print it; a Debt Jubilee: all debts, public, private; every ledger cleared; JUBILEE!; $0.00; backed by steel, not debt; SOVEREIGN.;
// we build it; JUBILEE!; the people's money.
// Grids: the cue and shot tables are written on the v9 grid to b43 (tables ...1) and on v8's grid from the jubilee (tables ...2, v8's
// b32 = v9's b43). c20 inserted beats into the bank and the payoff (WARP below): the song's beat is mapped back to the v9 grid by
// unwarp(), so every table and every animation keeps its own grid. renderFrame sets H2 and b.
const SPLIT = 43, OLD0 = 32;
const OPEN = 8, OPEN_END = 14;                                          // c21: song beats 0-14 are the opening; song b14 = v14's b6
const OPENING = OPENT === 'y'
  ? { shots: [[0, 'clockhero'], [8, 'bill']],
      cues: [[0, 8, 'HOUSEHOLDS OWE $18.8 TRILLION.', 'held', '$18.8', 'band'], [8, 14, 'EVERY DOLLAR IS AN IOU.', 'held', 'IOU', 'band']] }
  : { shots: [[0, 'bill'], [8, 'promise']],
      cues: [[0, 8, 'EVERY DOLLAR IS AN IOU.', 'held', 'IOU', 'band'], [8, 14, 'PAYABLE FOREVER.', 'held', 'FOREVER', 'band']] };
let OPN = false;
const toNew = b => b - OLD0 + SPLIT;                                    // an old-grid (v8) beat -> the v9 grid
// c20 beat map. Six beats go into the bank (the Bank's name, the faces and the gate get their dwell) and four into the payoff (THE
// PEOPLE'S MONEY. holds 2.8 s, the score's phrase bVI-bVII-i under it): [song beat, v9 beat]; between the points the map is linear.
const WARP = [[26, 26], [31, 28.3], [35.5, 35], [42.5, 38], [46, 40], [82, 76], [87.5, 77.5]];
function unwarp(s) {                                                    // song beat -> v9 beat
  if (s <= WARP[0][0]) return s;
  for (let i = 1; i < WARP.length; i++) if (s <= WARP[i][0]) { const [a0, b0] = WARP[i - 1], [a1, b1] = WARP[i]; return b0 + (s - a0) / (a1 - a0) * (b1 - b0); }
  return s - 10;
}
function toSong(v) {                                                    // v9 beat -> song beat (c21: + the opening's 8 beats)
  if (v <= WARP[0][1]) return v + OPEN;
  for (let i = 1; i < WARP.length; i++) if (v <= WARP[i][1]) { const [a0, b0] = WARP[i - 1], [a1, b1] = WARP[i]; return a0 + (v - b0) / (b1 - b0) * (a1 - a0) + OPEN; }
  return v + 10 + OPEN;
}
let H2 = false;
const CUES1 = [
  [6.2, 11, 'BANKS CREATE MONEY BY LENDING.', 'held', 'LENDING', 'band'], [11.2, 16, 'MOST MONEY STARTED AS A DEBT.', 'held', 'DEBT', 'band'],
  OPENT === 'y' ? [16.2, 21, 'PAYABLE FOREVER.', 'held', 'FOREVER', 'band'] : [16.2, 21, 'HOUSEHOLDS OWE $18.8 TRILLION.', 'held', '$18.8', 'band'],
  [21, 24, 'FED ABOLISHED.', 'held', 'ABOLISHED', 'band'],
  [26, 28.3, "PEOPLE'S NATIONAL BANK.", 'held', "PEOPLE'S", 'band'],
  [28.3, 35, "NORTH DAKOTA'S FARMERS WON A PUBLIC BANK IN 1919.", 'held', 'WON', 'band'],
  [40, 42.5, 'WE PRINT IT.', 'held', 'PRINT', 'band']];
const CUES2 = [[32, 33.5, 'DEBT JUBILEE.', 'held', 'JUBILEE', 'band'],
  [34, 36, 'ALL DEBTS.', 'clause'], [36, 38, 'PUBLIC.', 'clause'], [38, 40, 'PRIVATE.', 'clause'],
  [40, 41.5, 'EVERY LEDGER CLEARED.', 'held', 'CLEARED', 'band'], [42, 43.25, 'JUBILEE!', 'held', 'JUBILEE', 'band'],
  [44, 47.5, '$0.00', 'counter'],
  [48, 50, 'BACKED BY STEEL, NOT DEBT.', 'held', 'STEEL', 'band'], [55, 56.75, 'SOVEREIGN.', 'seal'], [57, 58.5, 'WE BUILD IT.', 'held', 'BUILD', 'band'],
  [62, 63.5, 'JUBILEE!', 'held', 'JUBILEE', 'band'], [64, 66.95, "THE PEOPLE'S MONEY.", 'payoff', 'MONEY']];
// the clause (c20): the Fed note's own promise, THIS NOTE IS LEGAL TENDER FOR ALL DEBTS, PUBLIC AND PRIVATE, set large on the note's
// ribbon over the pages; on each chant word a ruling pen draws a red rule through it, and the page below acts (rows to 0.00, coupons
// punched, the deed torn). The struck word stays struck.
const CL = { y0: 500, y1: 1150, lines: [['THIS NOTE IS LEGAL TENDER FOR', 592, 44, '700'], ['ALL DEBTS,', 742, 132, '900'], ['PUBLIC AND', 884, 132, '900'], ['PRIVATE', 1026, 132, '900']] };
const CLW = { 34: [1, 'ALL DEBTS'], 36: [2, 'PUBLIC'], 38: [3, 'PRIVATE'] };   // cue -> [line, the words the pen strikes]
let CLX = null;
function clauseLayout() {
  if (CLX) return CLX;
  const out = {}, c = ctx;
  for (const [k, [li, word]] of Object.entries(CLW)) {
    const [txt, y, px, wt] = CL.lines[li];
    let s = px; c.font = font(s, wt); while (c.measureText(txt).width > 900 && s > 6) { s -= 1; c.font = font(s, wt); }
    const tw = c.measureText(txt).width, x0 = SAFE.cx - tw / 2, pre = txt.indexOf(word);
    const wx = x0 + c.measureText(txt.slice(0, pre)).width, ww = c.measureText(word).width;
    out[k] = { x: wx, w: ww, y: y - s * 0.36, cap: s * 0.72, base: y };
  }
  return (CLX = out);
}
function nib(c, x, y, a = -0.5) {               // the ruling pen: two steel blades and the red ink between them, seen from above
  c.save(); c.translate(x, y); c.rotate(a);
  const gr = c.createLinearGradient(-14, 0, 14, 0); gr.addColorStop(0, '#2a3034'); gr.addColorStop(0.45, '#cfd6da'); gr.addColorStop(0.6, '#7d878c'); gr.addColorStop(1, '#1d2326');
  c.fillStyle = 'rgba(0,0,0,0.28)'; c.beginPath(); c.moveTo(6, 8); c.lineTo(34, -260); c.lineTo(70, -250); c.closePath(); c.fill();
  c.fillStyle = gr; c.beginPath(); c.moveTo(-3, 0); c.lineTo(3, 0); c.lineTo(16, -60); c.lineTo(14, -300); c.lineTo(-14, -300); c.lineTo(-16, -60); c.closePath(); c.fill();
  c.fillStyle = RED; c.fillRect(-1.6, -46, 3.2, 44);
  c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(4, -6); c.lineTo(9, -290); c.stroke();
  c.restore();
}
function clauseRibbon(b) {
  if (!H2 || b < 34 || b >= 40) return;
  const X = clauseLayout(), c = ctx;
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
  ribbon(c, { y1: CL.y0 + 34, y2: CL.y1 - 34 });
  c.fillStyle = CREAM; c.fillRect(0, CL.y0 + 24, W, CL.y1 - CL.y0 - 48);
  c.strokeStyle = K; band(c, 60, CL.y0 + 120, W - 60, CL.y0 + 120, 4, 12, 3, 0.6);
  for (const [txt, y, px, wt] of CL.lines) { c.fillStyle = K; legend(c, txt, SAFE.cx, y, px, { w: wt, maxW: 900, rule: false }); }
  for (const k of [34, 36, 38]) {
    if (b < k) continue;
    const o = X[k], age = (b - k) * B.spb, p = ease.outCubic(clamp((age - 0.02) / 0.24));
    if (age > 0.3) { c.fillStyle = CREAM; c.globalAlpha = 0.42; c.fillRect(o.x - 6, o.y - o.cap * 0.62, o.w + 12, o.cap * 1.24); c.globalAlpha = 1; }
    // the rule: ink laid by the pen, a little heavier where it set down and where it lifted
    const x0 = o.x - 14, x1 = o.x + o.w + 14, xe = lerp(x0, x1, p), wob = r => 1.2 * Math.sin(r * 0.07 + k);
    c.fillStyle = RED; c.beginPath(); c.moveTo(x0, o.y - 6 + wob(x0));
    for (let x = x0; x <= xe; x += 8) c.lineTo(x, o.y - 6 + wob(x)); c.lineTo(xe, o.y + 7); for (let x = xe; x >= x0; x -= 8) c.lineTo(x, o.y + 6 + wob(x) * 0.6); c.closePath(); c.fill();
    c.beginPath(); c.arc(x0 + 2, o.y, 7.5, 0, TAU); c.fill(); if (p >= 1) { c.beginPath(); c.arc(x1 - 2, o.y + 0.5, 7, 0, TAU); c.fill(); }
    if (p > 0 && p < 1) nib(c, xe, o.y, -0.42);
  }
  c.restore();
}
window.typeCues = () => [...OPENING.cues.map(c => ({ s: c[0], e: c[1], text: c[2], slam: false })), ...CUES1.map(c => ({ s: toSong(c[0]), e: toSong(c[1]), text: c[2], slam: false })),
  ...CUES2.map(c => ({ s: toSong(toNew(c[0])), e: toSong(toNew(c[1])), text: c[2], slam: false }))];
const at = (list, b) => { let q = list[0]; for (const x of list) if (b >= x[0]) q = x; return q; };
const BLK = new Map();
// the break of each held line (one shout per frame; a long one on two lines, never three)
const BREAKS = { 'BANKS CREATE MONEY BY LENDING.': ['BANKS CREATE MONEY', 'BY LENDING.'], 'MOST MONEY STARTED AS A DEBT.': ['MOST MONEY STARTED', 'AS A DEBT.'], 'HOUSEHOLDS OWE $18.8 TRILLION.': ['HOUSEHOLDS OWE', '$18.8 TRILLION.'],
  "NORTH DAKOTA'S FARMERS WON A PUBLIC BANK IN 1919.": ["NORTH DAKOTA'S FARMERS", 'WON A PUBLIC BANK IN 1919.'], 'FED ABOLISHED.': ['FED', 'ABOLISHED.'],
  "PEOPLE'S NATIONAL BANK.": ["PEOPLE'S", 'NATIONAL BANK.'], 'EVERY LEDGER CLEARED.': ['EVERY LEDGER', 'CLEARED.'], 'PAYABLE FOREVER.': ['PAYABLE', 'FOREVER.'], 'EVERY DOLLAR IS AN IOU.': ['EVERY DOLLAR', 'IS AN IOU.'], 'BACKED BY STEEL, NOT DEBT.': ['BACKED BY STEEL,', 'NOT DEBT.'] };
function heldBlock(text) {
  if (BLK.has(text)) return BLK.get(text);
  let lines = BREAKS[text] || [text];
  if (!BREAKS[text] && 880 / measure(PF, text, 1) < 112 && text.includes(' ')) { const ws = text.split(' '); let best = null;
    for (let i = 1; i < ws.length; i++) { const a = ws.slice(0, i).join(' '), b2 = ws.slice(i).join(' '), m = Math.max(measure(PF, a, 1), measure(PF, b2, 1)); if (!best || m < best[0]) best = [m, a, b2]; }
    lines = [best[1], best[2]]; }
  const cap = Math.min(lines.length > 1 ? 150 : 170, ...lines.map(l => 880 / measure(PF, l, 1)));
  const mkb = y => setBlock(PF, lines.map(l => ({ text: l, cap })), { role: 'plant', y, gap: 0.24, maxW: 900 });
  const b0 = mkb(0), blk = mkb(Math.round(300 - b0.bbox.y1));
  BLK.set(text, blk); return blk;
}
let PAYB = null;
function payoffBlock() {          // v8: MONEY. is the biggest set in the piece, the full safe width; THE PEOPLE'S is a small black line over it
  return PAYB || (PAYB = setBlock(PF, [{ text: "THE PEOPLE'S", cap: 70 }, { text: 'MONEY.', fill: true, max: 400 }], { role: 'payoff', y: 470, gap: 0.22, maxW: 930 }));
}
// glyph indices of the key word (glyphs run line by line over the non-space characters)
function keyGlyphs(blk, key) {
  const out = new Set(); if (!key) return out; let gi = 0;
  for (const ln of blk.lines) { const words = ln.text.split(' '); for (const w of words) { const n = [...w].length, bare = w.replace(/[.,!:]$/, '');
    if (bare === key || w === key) for (let k = 0; k < n; k++) { if (/[.!,:]/.test(w[k]) && k === n - 1) continue; out.add(gi + k); }
    gi += n; } }
  return out;
}
function fillGlyphs(c, blk, colorOf, dx = 0, dy = 0) {
  blk.glyphs.forEach((G, i) => { c.save(); c.translate(G.ox + dx, G.oy + dy); c.fillStyle = colorOf(i); c.fill(G.path); c.restore(); });
}
function ribbon(c, bb, a = 1) {           // the note's ribbon under a held line: cream strip, ruled edges, a lathe band
  const y0 = bb.y1 - 34, y1 = bb.y2 + 34; c.save(); c.globalAlpha = a;
  c.fillStyle = CREAM; c.fillRect(0, y0, W, y1 - y0);
  c.strokeStyle = K; c.lineWidth = 3; c.beginPath(); c.moveTo(0, y0 + 6); c.lineTo(W, y0 + 6); c.moveTo(0, y1 - 6); c.lineTo(W, y1 - 6); c.stroke();
  c.lineWidth = 1; c.beginPath(); c.moveTo(0, y0 + 12); c.lineTo(W, y0 + 12); c.moveTo(0, y1 - 12); c.lineTo(W, y1 - 12); c.stroke();
  band(c, 0, y0 + 20, W, y0 + 20, 3, 10, 3, 0.6); band(c, 0, y1 - 20, W, y1 - 20, 3, 10, 3, 0.6);
  c.restore();
}
function drawHeld(c, cue, age) {
  const [, , text, , key, style] = cue, blk = heldBlock(text), ks = keyGlyphs(blk, key);
  const k = 1 + 0.07 * Math.exp(-age * 30), cx = (blk.bbox.x1 + blk.bbox.x2) / 2, cy = (blk.bbox.y1 + blk.bbox.y2) / 2;
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
  if (style === 'band') ribbon(c, blk.bbox);
  c.translate(cx, cy); c.scale(k, k); c.translate(-cx, -cy);
  fillGlyphs(c, blk, i => ks.has(i) ? RED : K);
  c.restore();
  typeAudit.add(blk, { read: 1 });
}
function drawPayoff(c, age, b) {
  const blk = payoffBlock(), k = 1 + 0.14 * Math.exp(-age * 18);
  const ex = ease.inCubic(clamp((b - 66.5) / 0.45)), dy = -760 * ex;
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1 - ex * 0.6;
  const cx = SAFE.cx, cy = (blk.bbox.y1 + blk.bbox.y2) / 2; c.translate(0, dy); c.translate(cx, cy); c.scale(k, k); c.translate(-cx, -cy);
  ribbon(c, blk.bbox);
  const mk_ = new Set(blk.glyphs.map((G, i) => i).filter(i => i >= [...blk.lines[0].text.replace(/ /g, '')].length));
  fillGlyphs(c, blk, i => mk_.has(i) ? RED : K);
  c.restore();
  typeAudit.add(blk, { read: 1 });
}
function drawType(b) {
  typeAudit.reset(); typeAudit.plantCap = 160;
  const cue = at(OPN ? OPENING.cues : H2 ? CUES2 : CUES1, b); if (!cue || b < cue[0] || b >= cue[1]) return;
  const age = (b - cue[0]) * B.spb;
  if (cue[3] === 'held') drawHeld(ctx, cue, age);
  else if (cue[3] === 'payoff') drawPayoff(ctx, age, b);
  else if (cue[3] === 'clause') { const o = clauseLayout()[cue[0]];        // the struck word, for the type audit (clauseRibbon draws it)
    typeAudit.add({ text: cue[2], role: 'plant', caps: [o.cap / 0.72], bbox: { x1: o.x, x2: o.x + o.w, y1: o.base - o.cap, y2: o.base } }, { read: 1 }); }
}
window.typeInfo = () => ({ items: typeAudit.items });
window.typeLoad = () => planLoad(window.typeCues(), B.spb, toSong(toNew(CLOSE)) * B.spb);

// ================================================================ the Liberty Bell (engraved; the corridor ends on it)
// Leviticus 25:10 cast in its shoulder, as world text; the crack opens on the one silence (b41).
function libertyBell(c, cx, cy, s, crack = 0, swing = 0) {
  c.save(); c.translate(cx, cy); c.rotate(swing); c.scale(s, s); c.strokeStyle = K; c.fillStyle = K;
  // the yoke and its hanger
  c.fillRect(-0.62, -1.28, 1.24, 0.16); c.fillRect(-0.08, -1.14, 0.16, 0.14);
  c.save(); c.beginPath(); c.rect(-0.62, -1.28, 1.24, 0.16); c.clip(); c.strokeStyle = WH; c.lineWidth = 0.008; for (let x = -0.62; x < 0.62; x += 0.03) { c.beginPath(); c.moveTo(x, -1.28); c.lineTo(x + 0.02, -1.12); c.stroke(); } c.restore();
  const body = new Path2D();
  body.moveTo(-0.2, -1.0); body.bezierCurveTo(-0.36, -1.0, -0.36, -0.75, -0.36, -0.55); body.bezierCurveTo(-0.36, -0.28, -0.44, -0.12, -0.56, -0.02); body.lineTo(-0.56, 0.04);
  body.lineTo(0.56, 0.04); body.lineTo(0.56, -0.02); body.bezierCurveTo(0.44, -0.12, 0.36, -0.28, 0.36, -0.55); body.bezierCurveTo(0.36, -0.75, 0.36, -1.0, 0.2, -1.0); body.closePath();
  c.fillStyle = WH; c.fill(body);
  // the bronze: contour lines following the profile, heavier toward the shadowed right
  c.save(); c.clip(body);
  for (let k = -24; k <= 24; k++) { const u = k / 24; c.lineWidth = lerp(0.004, 0.02, clamp((u + 0.3) / 1.3)) * (Math.abs(u) > 0.9 ? 1.4 : 1);
    c.beginPath(); for (let j = 0; j <= 40; j++) { const v = j / 40, y = lerp(-1.0, 0.04, v), wdt = y < -0.55 ? lerp(0.2, 0.36, clamp((y + 1.0) / 0.25)) : lerp(0.36, 0.56, Math.pow(clamp((y + 0.55) / 0.55), 2)); const x = u * wdt; j ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); }
  c.restore();
  // the bands: the inscription at the shoulder, the rings at the lip
  c.lineWidth = 0.012; for (const y of [-0.9, -0.8, -0.2, -0.12, -0.05]) { const wd = y < -0.55 ? 0.36 : lerp(0.36, 0.56, Math.pow(clamp((y + 0.55) / 0.55), 2)); c.beginPath(); c.moveTo(-wd, y); c.quadraticCurveTo(0, y + 0.03, wd, y); c.stroke(); }
  c.fillStyle = WH; c.fillRect(-0.34, -0.895, 0.68, 0.09); c.fillStyle = K; c.font = '700 0.034px "Playfair Display"'; c.textAlign = 'center';
  c.fillText('PROCLAIM LIBERTY THROUGHOUT ALL THE LAND', 0, -0.855); c.fillText('UNTO ALL THE INHABITANTS THEREOF · LEV XXV X', 0, -0.815);
  // the crack, up from the lip
  if (crack > 0) { const pts = [[0.1, 0.04], [0.085, -0.08], [0.11, -0.17], [0.07, -0.28], [0.095, -0.38], [0.06, -0.5], [0.08, -0.58]], n = Math.max(2, Math.ceil(pts.length * crack));
    c.lineWidth = 0.028; c.lineJoin = 'miter'; c.beginPath(); pts.slice(0, n).forEach((q, i) => i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])); c.stroke(); }
  c.restore();
}

// ================================================================ the clock (c20): what households owe; the hook and the payoff are one object
// It counts the household figure the corridor names, $18,770,500,000,000 (New York Fed, Household Debt and Credit, 2026 Q2: $18.7705
// trillion), rising at the last year's real rate (2025 Q2 $18.388 trillion to 2026 Q2 $18.7705 trillion: $382.5 billion a year, $12,121
// a second; bank.json). So it reads like a real odometer: the trillions and billions stand still, the ten-thousands turn about once a
// second, only the low wheels race (v9's clock counted the Treasury's debt, accelerated, and every wheel blurred to shreds at phone size).
// Cream drums, black figures, a dark steel housing. FED ABOLISHED.: the racing wheels seize and the fastest drum's paper face tears.
// $0.00 (v8 b43.35-44.2): the wheels roll down to 0 right to left; then the leading zeros fall blank, the $ slides home and the board
// closes in on $0.00 in red: the share frame.
const DEBT0 = 18770500000000, RATE = 12121, NI = 14, CLOCKLAND = 44.2, LAND0 = 43.35;
const SLOTS = [{ k: '$' }]; for (let i = 0; i < NI; i++) { SLOTS.push({ k: 'd', p: NI - 1 - i }); if ([1, 4, 7, 10].includes(i)) SLOTS.push({ k: ',' }); }
SLOTS.push({ k: '.' }, { k: 'd', p: -1 }, { k: 'd', p: -2 });                 // p: the wheel's power of ten (cents are -1, -2)
const SLW = s => s.k === ',' || s.k === '.' ? 0.38 : 1, SLTOT = SLOTS.reduce((a, s) => a + SLW(s), 0);
const JAMT = (21 + OPEN) * (60 / 140);                                         // seconds: FED ABOLISHED. (b21): the wheels seize
const DRUMC = '#ece3cb', HOUS = '#121314';
function clockValue(t, jam) {                                         // dollars on the board at piece time t
  if (!jam || t <= JAMT) return DEBT0 + RATE * t;
  const k = 9, dt = t - JAMT; return DEBT0 + RATE * (JAMT + (1 - Math.exp(-k * dt)) / k);
}
function clockRate(t, jam) { return !jam || t <= JAMT ? RATE : RATE * Math.exp(-9 * (t - JAMT)); }
function wheelAt(V, p) {                                               // a wheel's position (digits, continuous): the odometer's carry
  const unit = Math.pow(10, p), q = V / unit;
  if (p <= 2) return q;                                                // the low wheels run continuously
  const below = (V % unit) / unit;                                     // the wheel below it: it turns this one only on its last tenth
  return Math.floor(q) + ease.inOutCubic(clamp((below - 0.9) / 0.1));
}
const STRIPS = new Map();
function strip(cw, cell, fs, ys, blur) {                               // the drum's paper face: 0-9 (and 0 again), and a spun copy
  const key = [cw, cell, fs, ys, blur].map(v => Math.round(v * 10)).join(','); if (STRIPS.has(key)) return STRIPS.get(key);
  const c = mk(Math.ceil(cw), Math.ceil(cell * 13)), x = c.getContext('2d');
  x.fillStyle = DRUMC; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#0d0d0d'; x.font = `400 ${fs}px Anton`; x.textAlign = 'center'; x.textBaseline = 'middle';
  for (let r = 0; r <= 12; r++) { x.save(); x.translate(cw / 2, (r + 0.5) * cell); x.scale(1, ys); x.fillText(String((r + 9) % 10), 0, fs * 0.04); x.restore(); }   // 9, 0-9, 0, 1
  let out = c;
  if (blur) { const b2 = mk(c.width, c.height), y = b2.getContext('2d'); y.fillStyle = DRUMC; y.fillRect(0, 0, b2.width, b2.height); const n = 28;
    for (let j = 0; j < n; j++) { y.globalAlpha = 1 / (j + 1); y.drawImage(c, 0, (j / (n - 1) - 0.5) * cell * 2.2); } out = b2; }
  STRIPS.set(key, out); return out;
}
function drum(c, x, y0, cw, h, pos, speed, o) {                        // one wheel in its window; speed in digits a frame
  const cell = h * 0.74, fs = o.fs, ys = o.ys, red = o.red;
  c.save(); c.beginPath(); c.rect(x + 3, y0, cw - 6, h); c.clip();
  if (o.blank >= 1) { c.fillStyle = DRUMC; c.fillRect(x, y0, cw, h); }
  else if (o.red > 0) {                                                // a landed wheel: its 0 inked from black to red
    c.fillStyle = DRUMC; c.fillRect(x, y0, cw, h); c.fillStyle = lerpRed(o.red); c.font = `400 ${fs}px Anton`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.save(); c.translate(x + cw / 2, y0 + h / 2); c.scale(1, ys); c.fillText('0', 0, fs * 0.04); c.restore();
  } else {
    const S = strip(cw - 6, cell, fs, ys, speed > 0.55), d = ((pos % 10) + 10) % 10;
    const draw = dd => c.drawImage(S, x + 3, y0 + h / 2 - (dd + 1.5) * cell);
    if (speed > 0.55 || speed < 0.06) draw(d);
    else { const n = 5; for (let j = 0; j < n; j++) { c.globalAlpha = 1 / (j + 1); draw((((d + (j / (n - 1) - 0.5) * speed) % 10) + 10) % 10); } c.globalAlpha = 1; }
    if (o.blank > 0) { c.globalAlpha = o.blank; c.fillStyle = DRUMC; c.fillRect(x, y0, cw, h); c.globalAlpha = 1; }
  }
  if (o.tear > 0) {                                                    // the seized drum's face torn across: a ragged split, the dark drum under it
    const r = rng(o.seed || 3), pts = []; for (let k = 0; k <= 8; k++) pts.push([x + 3 + (cw - 6) * k / 8, y0 + h * (0.42 + (r() - 0.5) * 0.16 * o.tear)]);
    c.fillStyle = '#1b1a18'; c.beginPath(); pts.forEach((q, i) => i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])); for (let k = 8; k >= 0; k--) c.lineTo(pts[k][0], pts[k][1] + h * 0.07 * o.tear * (0.6 + 0.4 * Math.sin(k * 1.7))); c.closePath(); c.fill();
    c.strokeStyle = '#fbf6e6'; c.lineWidth = 2; c.beginPath(); pts.forEach((q, i) => i ? c.lineTo(q[0], q[1] - 1.5) : c.moveTo(q[0], q[1] - 1.5)); c.stroke();
  }
  const gr = c.createLinearGradient(0, y0, 0, y0 + h); gr.addColorStop(0, 'rgba(0,0,0,0.78)'); gr.addColorStop(0.24, 'rgba(0,0,0,0)'); gr.addColorStop(0.76, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.78)');
  c.fillStyle = gr; c.fillRect(x, y0, cw, h);
  c.fillStyle = 'rgba(255,255,255,0.10)'; c.fillRect(x + 3, y0 + h * 0.3, cw - 6, 3);
  c.restore();
  c.strokeStyle = '#3a3c3e'; c.lineWidth = 3; c.strokeRect(x + 2, y0, cw - 4, h);
}
// t: piece time (s); mode 'race' (the hook, the corridor; jam: FED ABOLISHED.) or 'land' (b: the v8 beat)
function drawClock(c, t, { cy = 1080, h = 280, mode = 'race', jam = false, b = 0, zoom = 1, rot = 0, shake = 0, head = true } = {}) {
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
  const sr = rng(Math.round(t * 30) + 11), u = (W - 110) / SLTOT, y0 = cy - h / 2, fs = Math.min(u * 1.62, h * 0.36), ys = 1.9;
  const land = mode === 'land', q = land ? ease.inOutCubic(clamp((b - CLOCKLAND - 0.1) / 0.8)) : 0;
  // the group that stays: $ (slid home), the ones wheel, the point, the cents
  const xs = []; { let x = 55; for (const sl of SLOTS) { xs.push(x); x += SLW(sl) * u; } }
  const iOnes = SLOTS.findIndex(s => s.k === 'd' && s.p === 0), gx0 = xs[iOnes] - u, gx1 = xs[xs.length - 1] + u, gcx = (gx0 + gx1) / 2;
  const Z = zoom * lerp(1, 2.55, q), cxw = lerp(W / 2, gcx, q);
  c.translate(W / 2 + (sr() - 0.5) * shake, cy + (sr() - 0.5) * shake); c.rotate(rot); c.scale(Z, Z); c.translate(-cxw, -cy);
  // the housing: dark steel, an engraved double rule, the plate's legend
  c.fillStyle = HOUS; c.fillRect(-400, y0 - 84, W + 800, h + 168);
  c.strokeStyle = '#6d7174'; c.lineWidth = 2; c.strokeRect(-400, y0 - 70, W + 800, h + 140); c.lineWidth = 1; c.strokeRect(-400, y0 - 62, W + 800, h + 124);
  if (head) { c.globalAlpha = 1 - q; c.font = font(38, '700'); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = DRUMC; c.fillText('U.S. HOUSEHOLD DEBT', W / 2, y0 - 36); c.globalAlpha = 1; }
  const V = land ? 0 : clockValue(t, jam), vr = land ? 0 : clockRate(t, jam);
  const ranks = SLOTS.map((s, i) => i).filter(i => SLOTS[i].k === 'd').reverse();       // right to left
  const W8 = { t, b, land, q, V, vr, jam, ranks, y0, h, fs, ys, cy };
  let dollar = null;
  SLOTS.forEach((sl, i) => {
    const cw = SLW(sl) * u, x = xs[i];
    if (sl.k === ',' || sl.k === '.') { c.globalAlpha = sl.k === ',' ? 1 - q : 1; c.fillStyle = land && sl.k === '.' ? lerpRed(q) : DRUMC; c.beginPath(); c.arc(x + cw / 2, cy + h * 0.2, u * 0.09, 0, TAU); c.fill();
      if (sl.k === ',') { c.beginPath(); c.moveTo(x + cw / 2 + u * 0.08, cy + h * 0.2); c.lineTo(x + cw / 2 - u * 0.06, cy + h * 0.3); c.lineWidth = u * 0.06; c.strokeStyle = DRUMC; c.stroke(); }
      c.globalAlpha = 1; return; }
    if (sl.k === '$') { dollar = [x, cw]; return; }
    drawWheel(c, sl, i, x, cw, W8);
  });
  if (dollar) { const [x, cw] = dollar; {                              // the $ on its own fixed drum, drawn last: on the landing it slides home over the blanked wheels
      const xx = lerp(x, xs[iOnes] - u, q); c.save(); c.beginPath(); c.rect(xx + 3, y0, cw - 6, h); c.clip(); c.fillStyle = DRUMC; c.fillRect(xx, y0, cw, h);
      c.fillStyle = q > 0 ? lerpRed(q) : '#0d0d0d'; c.font = `400 ${fs}px Anton`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.save(); c.translate(xx + cw / 2, cy); c.scale(1, ys); c.fillText('$', 0, fs * 0.04); c.restore();
      const gr = c.createLinearGradient(0, y0, 0, y0 + h); gr.addColorStop(0, 'rgba(0,0,0,0.78)'); gr.addColorStop(0.24, 'rgba(0,0,0,0)'); gr.addColorStop(0.76, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.78)');
      c.fillStyle = gr; c.fillRect(xx, y0, cw, h); c.restore(); c.strokeStyle = '#3a3c3e'; c.lineWidth = 3; c.strokeRect(xx + 2, y0, cw - 4, h); } }
  c.restore();
}
function drawWheel(c, sl, i, x, cw, o) {
    const { t, b, land, q, V, vr, jam, ranks, y0, h, fs, ys, cy } = o;
    const p = sl.p;
    if (land) {
      const rank = ranks.indexOf(i), lt = LAND0 + rank / (ranks.length - 1) * (CLOCKLAND - 0.08 - LAND0);
      const keep = p >= -2 && p <= 0, blank = keep ? 0 : q;
      if (b >= lt) drum(c, x, y0, cw, h, 0, 0, { fs, ys, red: keep ? q : 0, blank: blank >= 0.999 ? 1 : blank });
      else drum(c, x, y0, cw, h, (b - lt) * 37 * (p + 3), 0.9, { fs, ys, red: 0, blank: 0 });   // rolling back, too fast to read
      return;
    }
    const pos = p >= 0 ? wheelAt(V, p) : V * Math.pow(10, -p), speed = vr / Math.pow(10, Math.max(p, -2)) / 30;
    const seized = jam && t > JAMT, tear = seized && p <= 0 ? clamp((t - JAMT - 0.05) / 0.12) : 0;
    drum(c, x, y0, cw, h, pos, speed, { fs, ys, red: 0, blank: 0, tear, seed: 7 + p });
}
function lerpRed(q) { const a = [13, 13, 13], r = [200, 22, 30]; return `rgb(${a.map((v, i) => Math.round(lerp(v, r[i], q))).join(',')})`; }

// ================================================================ the bank's books (v9): where money comes from
// A bank's ledger, two columns: when a bank lends, the loan goes in its assets and, in the same moment, the borrower's deposit goes in its
// liabilities: new money, written down as a debt. (Bank of England, Money creation in the modern economy, 2014.) Names are invented.
const LOANS = [['J. SMITH', 'HOME LOAN', '250,000.00'], ['M. LOPEZ', 'AUTO LOAN', '18,400.00'], ['A. CHEN', 'CREDIT CARD', '6,200.00'], ['R. WILLIAMS', 'STUDENT LOAN', '41,000.00'], ['T. OKAFOR', 'BUSINESS LOAN', '75,000.00']];
const ROW0 = -430, ROWH = 168;
function typedLine(c, text, x, y, px, p, { w = '700', st = 'normal', align = 'left', color = K } = {}) {      // typed: a character a stroke
  if (p <= 0) return; c.save(); c.font = font(px, w, st); c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillStyle = color;
  const tw = c.measureText(text).width, x0 = align === 'right' ? x - tw : align === 'center' ? x - tw / 2 : x;
  const n = Math.min(text.length, Math.floor(clamp(p) * text.length + 0.999));
  c.fillText(text.slice(0, n), x0, y); c.restore();
}
function loanPage(c, o) {
  c.fillStyle = WH; c.fillRect(-620, -1000, 1240, 2000); c.strokeStyle = K; c.fillStyle = K;
  tint(c, -560, -960, 560, 960, 5, 0.35, 1.5, 120);
  c.save(); c.globalAlpha = 0.3; c.strokeStyle = K; rosette(c, 0, 230, 470, 0.6, 1, 0.2); c.restore();         // a faint rosette under the rows, as on a bank's paper
  c.lineWidth = 3; c.strokeRect(-540, -940, 1080, 1880); c.lineWidth = 1; c.strokeRect(-528, -928, 1056, 1856);
  legend(c, "THE BANK'S BOOKS", 0, -690, 60, { maxW: 820 });
  c.strokeStyle = K; band(c, -500, -650, 500, -650, 4, 12, 3, 0.7);
  c.fillStyle = K; legend(c, 'ASSETS', -250, -560, 44, { maxW: 380, rule: false }); legend(c, 'LIABILITIES', 250, -560, 44, { maxW: 400, rule: false });
  c.font = font(22, '400', 'italic'); c.textAlign = 'center'; c.fillText('what the bank is owed', -250, -525); c.fillText('what the bank owes', 250, -525);
  c.lineWidth = 2; c.beginPath(); c.moveTo(0, -590); c.lineTo(0, 700); c.stroke(); c.lineWidth = 1; c.beginPath(); c.moveTo(-500, -500); c.lineTo(500, -500); c.stroke();
  for (let i = 0; i < LOANS.length; i++) {
    const y = ROW0 + i * ROWH, [nm, kind, amt] = LOANS[i];
    c.strokeStyle = K; c.lineWidth = 1; c.beginPath(); c.moveTo(-500, y + ROWH - 34); c.lineTo(500, y + ROWH - 34); c.stroke();
    typedLine(c, 'LOAN: ' + kind + ', ' + nm, -490, y + 8, 25, o.rows[i], { w: '700', st: 'italic' }); typedLine(c, '$' + amt, -30, y + 82, 62, o.rows[i], { w: '900', align: 'right' });
    typedLine(c, 'DEPOSIT: ' + nm, 20, y + 8, 25, o.dep[i], { w: '700', st: 'italic' }); typedLine(c, '$' + amt, 490, y + 82, 62, o.dep[i], { w: '900', align: 'right' });
    if (o.iou[i] > 0) typedLine(c, 'IOU', 490, y + 8, 30, o.iou[i], { w: '900', align: 'right', color: RD });     // typed off the red half of the ribbon
  }
  if (o.nm > 0) typedLine(c, 'NEW MONEY', 490, ROW0 + ROWH - 52, 42, o.nm, { w: '900', align: 'right', color: RD });   // the same typewriter, the ribbon's red half
}

// ================================================================ bakes
const T0 = performance.now();
const NOTE = { old: noteBake('old'), new: noteBake('new'), bare: noteBake('bare'), back: noteBake('back') };
console.log(`bank3: bakes ${((performance.now() - T0) / 1000).toFixed(1)}s`);
const TMP = mk(W, H), tg = TMP.getContext('2d');
const INK2 = mk(W, H), SHEET = mk(W, H);
// the roller lays a film of ink over the plate (b16 to 16.5), a pad wipes it back left to right (to 17.1): the grooves keep it
function inkWipe(c, u) {
  const rx = lerp(-320, W + 320, ease.inOutCubic(clamp(u / 0.55))), wx = lerp(-260, W + 300, ease.inOutCubic(clamp((u - 0.55) / 0.6)));
  if (u > 1.2) return;
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
  const x0 = u < 0.55 ? 0 : wx, x1 = u < 0.55 ? rx - 30 : W;      // film: from the left edge to the roller, then from the pad to the right edge
  if (x1 > x0) { c.beginPath(); c.rect(Math.max(0, x0), 0, Math.min(W, x1) - Math.max(0, x0), H); c.fillStyle = 'rgba(10,14,18,0.60)'; c.fill();
    c.save(); c.clip(); c.globalAlpha = 0.5; c.fillStyle = hatchPat().dark; c.globalCompositeOperation = 'multiply'; c.fillRect(0, 0, W, H); c.restore(); }
  if (x1 > x0 && u < 1.2) { const sx = lerp(-W, 2 * W, clamp(u / 1.2)), gs = c.createLinearGradient(sx - 260, 0, sx + 260, 0);   // a sheen that travels over the wet ink
    gs.addColorStop(0, 'rgba(190,210,225,0)'); gs.addColorStop(0.5, 'rgba(190,210,225,0.20)'); gs.addColorStop(1, 'rgba(190,210,225,0)'); c.save(); c.beginPath(); c.rect(Math.max(0, x0), 0, Math.min(W, x1) - Math.max(0, x0), H); c.clip(); c.fillStyle = gs; c.fillRect(0, 0, W, H); c.restore(); }
  if (u < 0.6) { const gr = c.createLinearGradient(rx - 300, 0, rx + 40, 0);          // the inked roller: black rubber, wet, one narrow highlight (not chrome)
    gr.addColorStop(0, '#07090a'); gr.addColorStop(0.3, '#161c20'); gr.addColorStop(0.5, '#2a343a'); gr.addColorStop(0.62, '#10161a'); gr.addColorStop(1, '#050708'); c.fillStyle = gr; c.fillRect(rx - 300, 0, 340, H);
    c.fillStyle = 'rgba(210,225,235,0.55)'; c.fillRect(rx - 150, 0, 7, H); c.fillStyle = 'rgba(210,225,235,0.18)'; c.fillRect(rx - 128, 0, 30, H);
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(rx + 40, 0, 40, H); }
  else if (u < 1.2) { c.translate(wx, 0); c.rotate(0.05);        // the pad: a bundle of cloth, ruled
    c.fillStyle = '#d9d2bd'; c.fillRect(-200, -100, 210, H + 200); c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(10, -100, 46, H + 200);
    c.strokeStyle = 'rgba(40,36,28,0.5)'; c.lineWidth = 1.2; for (let x = -190; x < 8; x += 7) { c.beginPath(); c.moveTo(x, -100); c.lineTo(x + 6 * Math.sin(x), H + 100); c.stroke(); } }
  c.restore();
}
// paper is laid on the plate and peeled away from the bottom edge upward, the printed note on it, the curl of the flap shaded
function printSheet(c, u, pull) {
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
  const lay = ease.outCubic(clamp((u - 1.15) / 0.2)), y0 = H * (1 - pull * 1.12), tilt = 120 * pull;
  c.beginPath(); c.moveTo(0, -10); c.lineTo(W, -10); c.lineTo(W, y0 - tilt * 0.5); c.lineTo(0, y0 + tilt * 0.5); c.closePath(); c.clip();
  c.globalAlpha = lay; c.drawImage(SHEET, 0, 0); c.restore();
  if (pull > 0 && pull < 1) { c.save(); const ya = y0 - tilt * 0.5, yb = y0 + tilt * 0.5, gr = c.createLinearGradient(0, Math.min(ya, yb), 0, Math.min(ya, yb) + 110);
    gr.addColorStop(0, 'rgba(244,240,226,0.97)'); gr.addColorStop(0.18, 'rgba(210,204,186,0.9)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    c.beginPath(); c.moveTo(0, yb); c.lineTo(W, ya); c.lineTo(W, ya + 110); c.lineTo(0, yb + 110); c.closePath(); c.fillStyle = gr; c.fill(); c.restore(); }
}

let CART = null;

// ================================================================ camera and helpers
function cam(cx, cy, z, rot = 0) { g.setTransform(1, 0, 0, 1, 0, 0); g.translate(W / 2, H / 2); g.rotate(rot); g.scale(z, z); g.translate(-cx, -cy); }
function note(kind, cx, cy, z, rot, { numer = null, serial = null, mark = 0, markColor = RD, rays = 0, flipX = 1 } = {}) {
  cam(cx, cy, z, rot); if (flipX !== 1) { g.translate(cx, 0); g.scale(flipX, 1); g.translate(-cx, 0); }
  if (rays > 0) { g.save(); g.strokeStyle = RD; g.lineWidth = 1.6; g.globalAlpha = rays; g.beginPath();
    for (let k = 0; k < 220; k++) { const a = k / 220 * TAU; g.moveTo(SEAL.x + Math.cos(a) * 60, SEAL.y + Math.sin(a) * 60); g.lineTo(SEAL.x + Math.cos(a) * 1600, SEAL.y + Math.sin(a) * 1600); } g.stroke(); g.restore(); }
  g.save(); if (rays > 0) g.globalCompositeOperation = 'multiply'; g.drawImage(NOTE[kind], -NW / 2, -NH / 2, NW, NH); g.restore();
  if (kind === 'back') return;
  if (numer) numerals(g, numer);
  if (serial) serials(g, serial);
  if (mark > 0) sealMark(g, mark, markColor);
}
function lathe(c, inset = 26) {         // the note's lathe border kept just inside the image in the factory world
  c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = WH;
  c.fillRect(0, 0, W, inset); c.fillRect(0, H - inset, W, inset); c.fillRect(0, 0, inset, H); c.fillRect(W - inset, 0, inset, H);
  c.strokeStyle = K; const i = inset * 0.5;
  band(c, i, i, W - i, i, 5, 14, 5, 0.8); band(c, i, H - i, W - i, H - i, 5, 14, 5, 0.8); band(c, i, i, i, H - i, 5, 14, 5, 0.8); band(c, W - i, i, W - i, H - i, 5, 14, 5, 0.8);
  c.lineWidth = 3; c.strokeRect(inset, inset, W - 2 * inset, H - 2 * inset); c.lineWidth = 1; c.strokeRect(inset + 6, inset + 6, W - 2 * inset - 12, H - 2 * inset - 12);
}
const burinState = { x: 0, y: 0, a: 0, on: false };
function smoke(x, y, t, s = 1, n = 3, dx = 1) {
  g.strokeStyle = K;
  for (let k = 0; k < n; k++) { let px = x, py = y; g.lineWidth = 1.8 * s; g.beginPath(); g.moveTo(px, py);
    for (let i = 0; i < 80; i++) { const rr = (5 + i * 1.1) * s, a = i * 0.42 + t * 2.4 + k * 2.1; px = x + (i * 4.6 * dx + Math.sin(t + k) * 8) * s + Math.cos(a) * rr; py = y - i * 5.6 * s + Math.sin(a) * rr * 0.6; g.lineTo(px, py); }
    g.stroke(); }
}
function sparks(x0, y0, t, n = 60, spread = 1) {       // engraved sparks: short red ballistic strokes off the pour
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) { const r = rng(i * 13 + 1); const ph = (t * 1.3 + r()) % 1, vx = (r() - 0.5) * 900 * spread, vy = -250 - r() * 700;
    const x = x0 + vx * ph, y = y0 + vy * ph + 1100 * ph * ph; g.strokeStyle = i % 3 ? RD : K; g.lineWidth = 2.4 - ph * 1.5; g.beginPath(); g.moveTo(x, y); g.lineTo(x - vx * 0.035, y - (vy + 2200 * ph) * 0.035); g.stroke(); }
}
function haze(x0, y0, w, h, t) {         // heat shimmer: wavering hairlines rising off the pour
  g.strokeStyle = K; g.lineWidth = 0.9;
  for (let k = 0; k < 14; k++) { const x = x0 + (k / 13 - 0.5) * w; g.beginPath(); for (let j = 0; j <= 30; j++) { const y = y0 - j / 30 * h, xx = x + 7 * Math.sin(j * 0.6 - t * 9 + k) * (j / 30); j ? g.lineTo(xx, y) : g.moveTo(xx, y); } g.stroke(); }
}
// ================================================================ the back of the note (v8)
// the camera path across the back: whole, then panel to panel, arriving on the beat (each glide is the last 0.6 beat
// before it), holding with a slow push; b55 it settles on the Bank's seal at the cross of the four panels
const BKS = [[47.5, 0, 0, 1.10, -0.035], [48, PANC[0][0], PANC[0][1], 3.0, 0], [50, PANC[1][0], PANC[1][1], 3.0, 0], [52, PANC[2][0], PANC[2][1], 3.0, 0], [54, PANC[3][0], PANC[3][1], 3.0, 0], [55, 0, -70, 2.35, 0.02]];
function backCam(b) {
  let k = 0; for (let i = 0; i < BKS.length; i++) if (b >= BKS[i][0]) k = i;
  const a = BKS[k], n = BKS[k + 1];
  let cx = a[1], cy = a[2], z = a[3], rot = a[4];
  if (n) {
    const g0 = k === 0 ? n[0] - 0.45 : n[0] - 0.6, hold = clamp((b - a[0]) / Math.max(0.1, g0 - a[0])), gl = ease.inOutCubic(clamp((b - g0) / (n[0] - g0)));
    const dz = 1 + 0.045 * hold * (k ? 1 : 0); z = a[3] * dz; cx = a[1] + (k ? 8 * hold * (k % 2 ? 1 : -1) : 0); cy = a[2] + (k ? 14 * hold : 0);
    if (gl > 0) { const lx = (u0, u1) => lerp(u0, u1, gl); cx = lx(cx, n[1]); cy = lx(cy, n[2]); z = Math.exp(lx(Math.log(z), Math.log(n[3]))); rot = lx(rot, n[4]); }
  } else { z = a[3] * (1 + 0.03 * clamp((b - a[0]) / 2)); }
  return [cx, cy, z, rot];
}
// the pour's sparks over the steel panel: short red ballistic strokes, in the note's own units
function backFx(t, b, q) {
  if (b >= 55 || Math.abs(q[0] - PANC[0][0]) > 400 || Math.abs(q[1] - PANC[0][1]) > 560) return;
  const px = -176, py = -226; g.lineCap = 'round';
  for (let i = 0; i < 46; i++) { const r = rng(i * 13 + 1), ph = (t * 1.15 + r()) % 1, vx = (r() - 0.5) * 150, vy = -50 - r() * 150;
    const x = px + vx * ph, y = py + vy * ph + 330 * ph * ph; g.strokeStyle = i % 3 ? RD : K; g.lineWidth = 0.95 - ph * 0.55; g.beginPath(); g.moveTo(x, y); g.lineTo(x - vx * 0.03, y - (vy + 660 * ph) * 0.03); g.stroke(); }
}
// the Bank's seal (SOVEREIGN.): a struck, lathe-cut seal on the back of the note, cut in the engraver's line (raised by the relief pass,
// not a printed disc): guilloche rosette, a wide lettering ring and the emblem. c20: no stamp across it; the rose engine's cutter
// cuts SOVEREIGN into the ring's upper arc, letter by letter, in the one red, large enough to read as the line; the Bank's name runs
// round the foot, already cut.
const SOV = 'SOVEREIGN', FOOT = "THE PEOPLE'S NATIONAL BANK";
const cutterState = { on: false, x: 0, y: 0 };
function sovereignSeal(c, age) {
  const R = 205, k = 1 + 0.5 * Math.exp(-age * 17), a = clamp(age / 0.06);
  c.save(); c.globalAlpha = a; c.scale(k, k);
  c.fillStyle = WH; c.beginPath(); c.arc(0, 0, R + 26, 0, TAU); c.fill(); c.strokeStyle = K;
  rosette(c, 0, 0, R, 0.85, 1, 0.9); ring(c, 0, 0, R + 12, 5, 64, 4, 0.9);
  c.lineWidth = 7; c.beginPath(); c.arc(0, 0, R + 28, 0, TAU); c.stroke(); c.lineWidth = 2; c.beginPath(); c.arc(0, 0, R + 40, 0, TAU); c.stroke();
  const r0 = R * 0.36, r1 = R * 0.86;                                   // the lettering ring, cleared to paper
  c.fillStyle = WH; c.beginPath(); c.arc(0, 0, r1, 0, TAU); c.fill(); c.lineWidth = 2.4; c.beginPath(); c.arc(0, 0, r1, 0, TAU); c.stroke(); c.lineWidth = 1; c.beginPath(); c.arc(0, 0, r1 - 6, 0, TAU); c.stroke();
  c.lineWidth = 1; c.beginPath(); c.arc(0, 0, r0 + 5, 0, TAU); c.stroke(); c.lineWidth = 2.4; c.beginPath(); c.arc(0, 0, r0, 0, TAU); c.stroke();
  c.textAlign = 'center'; c.textBaseline = 'middle';
  // the foot: the Bank's name, read left to right along the bottom
  const rr = (r0 + r1) / 2 + 2; c.fillStyle = K; c.font = font(19, '900');
  const fs = 2.1, fn = FOOT.length; for (let i = 0; i < fn; i++) { const th = Math.PI / 2 + fs / 2 - (i + 0.5) / fn * fs; c.save(); c.rotate(th - Math.PI / 2); c.translate(0, rr); c.fillText(FOOT[i], 0, 0); c.restore(); }
  for (const th of [Math.PI / 2 + fs / 2 + 0.2, Math.PI / 2 - fs / 2 - 0.2]) { c.beginPath(); c.arc(Math.cos(th) * rr, Math.sin(th) * rr, 5, 0, TAU); c.fill(); }
  // SOVEREIGN along the top, cut a letter at a time from 0.12 s after the strike
  const span = 2.5, n = SOV.length, cut = clamp((age - 0.04) / 0.42) * n; c.font = font(54, '900');
  cutterState.on = cut > 0 && cut < n;
  for (let i = 0; i < n; i++) {
    const th = -Math.PI / 2 - span / 2 + (i + 0.5) / n * span, p = clamp(cut - i);
    if (p <= 0) continue;
    c.save(); c.rotate(th + Math.PI / 2); c.translate(0, -rr); c.beginPath(); c.rect(-40, -40, 80, 80 * p); c.clip(); c.fillStyle = RD; c.fillText(SOV[i], 0, 2); c.restore();
    if (p < 1) { const m = c.getTransform(), q = m.transformPoint(new DOMPoint(Math.cos(th) * rr, Math.sin(th) * rr + (p - 0.5) * 40)); cutterState.x = q.x; cutterState.y = q.y; }
  }
  c.save(); c.translate(-SEAL.x, -SEAL.y); sealMark(c, 1, K, 0.78); c.restore();
  c.restore();
}

// ================================================================ the shot table (v7)
// v9: the debt clock opens the piece (0-6), the old note's promise (3), the stamp jams the clock (6); the vault and THAT'S US. are cut, the faces (16) carry it; WE PRINT IT. (21) comes after the faces.
// v8: the 48 counter (b30) is now the crowd through the vault from behind; the hiring file is cut (its beat goes to
// the seal's SOVEREIGN. stamp); PAID IN FULL is cut so $0.00 holds a full second; the debt clock starts rolling at b43.25
// c20: FED ABOLISHED. is the clock seizing (21) and the burin cancelling the old Fed plate (22.4), no stamp. Take c opens on the bank's books
// (the mechanism as the hook) and the clock is first seen under the corridor, when HOUSEHOLDS OWE lands.
const SHOTS1 = TAKE === 'c'
  ? [[0, 'ledgerA'], [3, 'promise'], [6, 'ledgerB'], [16, 'wall0'], [21, 'clockjam'], [22.4, 'cancel'], [24, 'seal'], [26, 'newhead'], [28, 'newmoney'], [35, 'portrait'], [38, 'vaultcrowd'], [40, 'engine']]
  : [[6, 'ledgerA'], [11, 'ledgerB'], [16, 'wall0'], [21, 'clockjam'], [22.4, 'cancel'], [24, 'seal'], [26, 'newhead'], [28, 'newmoney'], [35, 'portrait'], [38, 'vaultcrowd'], [40, 'engine']];
const SHOTS2 = [[32, 'wall'], [34, 'ledger'], [36, 'bond'], [38, 'deed'], [40, 'wallend'], [43.25, 'balance'],
  [47.5, 'back'], [57, 'build'], [60, 'press2'], [62, 'fan'], [64, 'money'], [66.5, 'push']];
const PAGEY = { 34: 1390, 36: 1400, 38: 1330 };       // where each page's own picture (strike, punch, tear) starts, below the clause
// WE BUILD IT., first half (v8): one real worker at poster scale, cut as line engraving from a 1942 photograph (Palmer, Douglas
// Aircraft; public domain): a young man riveting, in profile, looking toward the works. His lines follow the body (Ward's planes).
// Behind him the plant on the horizon and the rose engine's guilloche low in the sky, cut in curves (never rays, never a halo
// behind a head), one red horizon band, the ground ruled in perspective.
const BUILDER = await PH.face('builder', 1500, 1210, [0, 0, 1500, 1210], { pitch: 5.4, planes: 6, gamma: 0.8, clarity: 1.0 });
function buildPoster(u, t) {
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = WH; g.fillRect(0, 0, W, H);
  const hy = 1010, bx = 720, k = 1 + 0.05 * Math.exp(-u * B.spb * 9) + 0.012 * u;
  // the sky: ruled level, tighter and darker toward the top, and the guilloche low on the horizon
  g.strokeStyle = K; for (let y = 330, i = 0; y < hy; y += 5.4, i++) { g.lineWidth = lerp(1.7, 0.35, (y - 330) / (hy - 330)); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.save(); g.beginPath(); g.rect(0, 330, W, hy - 330); g.clip(); g.fillStyle = WH; g.beginPath(); g.arc(bx, hy, 470 + u * 8, 0, TAU); g.fill();
  rosette(g, bx, hy, 440 + u * 8, 1.0, 1, u * 0.25); g.fillStyle = WH; g.beginPath(); g.arc(bx, hy, 175, 0, TAU); g.fill(); ring(g, bx, hy, 175, 4, 24, 3, 1.1); ring(g, bx, hy, 160, 3, 36, 2, 0.7); g.restore();
  // the plant on the horizon: saw-tooth sheds, stacks and a gantry, in cross-hatch
  const works = new Path2D(); works.moveTo(380, hy);
  for (let i = 0; i < 9; i++) { const x0 = 380 + i * 82; works.lineTo(x0, hy - 70); works.lineTo(x0 + 56, hy - 108); works.lineTo(x0 + 56, hy - 70); }
  works.lineTo(W, hy - 70); works.lineTo(W, hy); works.closePath();
  for (const [sx, sh] of [[560, 330], [640, 390], [940, 300]]) { works.rect(sx, hy - sh, 30, sh); works.rect(sx - 6, hy - sh, 42, 14); }
  g.save(); g.fillStyle = K; g.fill(works); g.clip(works); g.strokeStyle = WH; g.lineWidth = 1.1; for (let y = hy - 400; y < hy; y += 5) { g.beginPath(); g.moveTo(300, y); g.lineTo(W, y + 30); g.stroke(); } g.restore();
  g.lineWidth = 6; g.strokeStyle = K; g.beginPath(); g.moveTo(790, hy - 70); g.lineTo(790, hy - 250); g.lineTo(920, hy - 250); g.lineTo(920, hy - 70); g.stroke();
  // the one red: the horizon band; the ground ruled in perspective
  g.fillStyle = RD; g.fillRect(0, hy - 6, W, 34);
  g.strokeStyle = K; for (let y = hy + 38, i = 0; y < H; y += 5 + i * 0.4, i++) { g.lineWidth = 0.6 + i * 0.05; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  // the worker: his own paper-white ground cut out of the rule behind him
  g.save(); g.translate(-250, H + 30); g.scale(0.9 * k, 0.9 * k); g.translate(0, -1210); g.drawImage(BUILDER, 0, 0); g.restore();
}
const CROWDS = [await PH.vignette('crowd2', [0.40, 0.16, 0.647, 0.78], 1296, 2304, { fade: 0.06, pitch: 7.4, planes: 5, gamma: 0.9, clarity: 1.15, gain: 1.0 }), await PH.vignette('crowd2', [0.10, 0.16, 0.347, 0.78], 1296, 2304, { fade: 0.06, pitch: 7.4, planes: 5, gamma: 0.9, clarity: 1.15, gain: 1.0 })];
function crowdShot(u, t) {
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = WH; g.fillRect(0, 0, W, H);
  const k = u < 1 ? 0 : 1, uu = u < 1 ? u : u - 1, C = CROWDS[k], z = lerp(1.0, 1.12, ease.outCubic(clamp(uu / 1.2))) * 0.8333;   // 1296 px of crowd across 1080 px of frame
  const w = C.width * z, h = C.height * z, dx = lerp(-30, 30, uu) * (k ? -1 : 1);
  g.drawImage(C, (W - w) / 2 + dx, (H - h) / 2 - 30 * uu, w, h);
  lathe(g, 22);
}
// ================================================================ the ending (v8, HANDBOOK: an ending is part of the piece)
// The camera pushes from the payoff into the new note's centre medallion, where the rose engine cut the emblem (b18); its four
// stripes take the red, one by one; the engraving round it fades to bare paper and the lockup comes up on the stock, raised
// by the plate: hammer and sickle in black, the stripes red, /acc, ACP.US. It holds while the organ resolves.
const ENDZ = 4.0, ENDX = 57.5, LKH = 52.5;
function endShot(b, u, t) {
  const q = ease.inOutCubic(clamp((b - PUSHB) / 2.6)), z = lerp(1.0, ENDZ, q) * (1 + 0.035 * Math.exp(-Math.max(0, b - CLOSE) * B.spb * 9) * (b >= CLOSE ? 1 : 0));
  const cx = lerp(0, ENDX, q), cy = lerp(0, SEAL.y + (960 - 900) / ENDZ, q), rot = lerp(0.0, 0, q);
  cam(cx, cy, z, rot);
  g.drawImage(NOTE.new, -NW / 2, -NH / 2, NW, NH);
  const whiteA = clamp((b - 68.5) / 1.1);                 // the note dissolves to paper round the medallion
  if (q > 0.3) {                                          // the seal live, crisp at depth: rosette, rings, the inner disc
    const R = SEAL.R, ra = 1 - whiteA;
    g.save(); g.fillStyle = WH; g.globalAlpha = 1; g.beginPath(); g.arc(SEAL.x, SEAL.y, R + 24, 0, TAU); g.fill();
    g.globalAlpha = ra; g.strokeStyle = K; rosette(g, SEAL.x, SEAL.y, R, 0.8, 1, 0.0); ring(g, SEAL.x, SEAL.y, R + 12, 5, 64, 4, 0.8);
    g.fillStyle = WH; g.globalAlpha = 1; g.beginPath(); g.arc(SEAL.x, SEAL.y, R * 0.44, 0, TAU); g.fill();
    g.globalAlpha = ra; g.lineWidth = 1.4; g.beginPath(); g.arc(SEAL.x, SEAL.y, R * 0.44, 0, TAU); g.stroke(); g.restore();
  }
  if (whiteA > 0) { g.save(); g.globalAlpha = whiteA; g.fillStyle = WH; g.fillRect(SEAL.x - 700, SEAL.y - 900, 1400, 1800); g.restore(); }
  // the emblem, then the lockup that takes its place
  const sw = [0, 1, 2, 3].map(k => clamp((b - (67.6 + k * 0.38)) / 0.3)), lk = clamp((b - (CLOSE - 0.15)) / 0.3), lkx = ENDX;
  g.save();
  if (lk < 1) { g.globalAlpha = 1 - lk; drawMark(g, SEAL.x, SEAL.y, 70, { color: K, badge: 1, stripes: [1, 1, 1, 1] }); drawMark(g, SEAL.x, SEAL.y, 70, { color: RD, badge: 0, stripes: sw }); }
  const parts = (o, col) => drawLockup(g, lkx, SEAL.y, LKH, { color: col, parts: o });
  if (lk > 0) { g.globalAlpha = lk; parts({ mark: 1, eq: 0, slash: 0, acc: 0 }, K); parts({ mark: 0, eq: 1, slash: 0, acc: 0 }, RD); }
  const ac = clamp((b - (CLOSE + 0.1)) / 0.9); if (ac > 0) { g.globalAlpha = ac; parts({ mark: 0, eq: 0, slash: 1, acc: 1 }, K); }
  const us = clamp((b - (CLOSE + 0.8)) / 0.9); if (us > 0) { g.globalAlpha = us; g.fillStyle = K; legend(g, 'ACP.US', lkx, SEAL.y + LKH / 2 + 30, 17, { maxW: 130, rule: false }); }
  g.restore();
}
window.renderFrame = async (t) => {
  const tf0 = performance.now();
  const bs = B.beat(t), fr = Math.round(t * 30); OPN = bs < OPEN_END;                                // c21: the opening runs on song beats
  const bn = OPN ? bs : unwarp(bs - OPEN); H2 = !OPN && bn >= SPLIT; const b = H2 ? bn - SPLIT + OLD0 : bn;      // bs: the song's beat; bn: the v9 grid; b: the v9 grid before the jubilee, v8's grid from it (b32)
  const kick = B.env('kick', t, 9), imp = B.env('impact', t, 5);
  const TAB = OPN ? OPENING.shots : H2 ? SHOTS2 : SHOTS1, sh = at(TAB, b), s0 = sh[0], name = sh[1], u = b - s0;
  const nextS = TAB[TAB.indexOf(sh) + 1], len = nextS ? nextS[0] - s0 : (OPN ? OPEN_END - s0 : H2 ? 8 : SPLIT - s0), v = clamp(u / len);
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.fillStyle = WH; g.fillRect(0, 0, W, H);
  g.strokeStyle = K; g.fillStyle = K;
  const L = { mode: 0, inked: 0, relief: 1.8, elev: 0.32, light: 2.3 + t * 0.35, expo: 1.02, focus: [0.5, 1, 0], sheen: [0.55, 0.12, 0], t, fall: 1, lpos: [0.1, 0.15], paper: PAPER, ca: 0 };
  burinState.on = false; cutterState.on = false; CART = null;
  const over = [], post = [];
  const punch = 1 + 0.025 * kick + 0.05 * imp;
  let shake = 0;

  if (name === 'bill') {
    // c21, the opening's object: the whole Federal Reserve note, every part of it legible as money, under the line; it comes slowly
    // toward the viewer, and once the line has landed the bank's own typewriter (the books' red half of the ribbon) types IOU across its
    // empty portrait oval, a letter a third of a beat, so the claim is made on the note itself
    const q = ease.inOutCubic(v), z = lerp(0.76, 0.9, q) * punch;
    cam(0, -190 / z, z, lerp(-0.035, 0, q));
    g.save(); g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(-NW / 2 + 16, -NH / 2 + 22, NW, NH); g.restore();     // the note lies on the stock
    g.drawImage(NOTE.old, -NW / 2, -NH / 2, NW, NH); numerals(g, '100');
    const ty = len > 7 ? 1.6 : 1.1, P = PORTRAIT;
    if (u > ty) { g.save(); g.fillStyle = WH; g.globalAlpha = 0.72 * clamp((u - ty) / 0.2); g.beginPath(); g.ellipse(P.x, P.y + 40, 230, 120, 0, 0, TAU); g.fill(); g.restore();
      typedLine(g, 'IOU', P.x, P.y + 110, 210, clamp((u - ty) / 1.0), { w: '900', align: 'center', color: RD }); }
    Object.assign(L, { light: 2.5 + u * 0.15, elev: 0.3, relief: 1.9, focus: [0.5, 0.55, 0.8] });
  } else if (name === 'clockhero') {
    // c21 take y, the opening's object: the clock of what U.S. households owe, the whole board in the frame with a margin, its high wheels
    // still and its low ones racing, on the rose engine's plate seen whole enough to read as a plate (v14: 3.2x into the seal, turning)
    cam(SEAL.x, SEAL.y, (1.7 + 0.012 * b) * punch, 0.04);
    g.strokeStyle = K;
    for (let i = 0; i < ROSE.length; i++) { const o = ROSE[i]; ring(g, SEAL.x, SEAL.y, SEAL.R * o.f, SEAL.R * o.amp, o.k, o.n, 0.6, 1, i * 0.3); }
    ring(g, SEAL.x, SEAL.y, SEAL.R + 12, 5, 64, 4, 0.6);
    Object.assign(L, { mode: 1, relief: 2.2, elev: 0.3, light: -0.8 + Math.sin(t * 0.8) * 0.3, focus: [0.5, 0.2, 1.2], sheen: [0.62, 0.13, 1.25], lpos: [0.9, 0.3] });
    post.push(() => drawClock(ctx, t, { cy: 1150, h: 300, mode: 'race', zoom: 1 + 0.004 * b }));
  } else if (name === 'clock' || name === 'clockjam') {
    // THE HOOK: the household clock already running, on the rose engine's plate (ink and steel); FED ABOLISHED. (b21): the wheels seize
    const jam = name === 'clockjam', a = jam ? Math.max(0, (b - 21) * B.spb) : 0;
    cam(SEAL.x + 40, SEAL.y - 40, 3.2 * punch + 0.02 * Math.min(b, 24), 0.3 + 0.012 * Math.min(b, 24));
    g.strokeStyle = K;
    for (let i = 0; i < ROSE.length; i++) { const o = ROSE[i]; ring(g, SEAL.x, SEAL.y, SEAL.R * o.f, SEAL.R * o.amp, o.k, o.n, 0.6, 1, i * 0.3); }
    ring(g, SEAL.x, SEAL.y, SEAL.R + 12, 5, 64, 4, 0.6);
    Object.assign(L, { mode: 1, relief: 2.2, elev: 0.3, light: -0.8 + Math.sin(t * 0.8) * 0.3, focus: [0.5, 0.2, 1.2], sheen: [0.62, 0.13, 1.25], lpos: [0.9, 0.3] });
    const sh0 = jam ? 20 * Math.exp(-a * 11) : 0, rot = jam ? -0.012 * Math.exp(-a * 8) * Math.sin(a * 40) : 0;
    post.push(() => drawClock(ctx, t, { cy: 1090, h: 320, mode: 'race', jam, zoom: 1.02 + 0.03 * Math.min(b, 24) / 24, rot: -0.02 + rot, shake: sh0 }));
  } else if (name === 'promise') {
    // the old note's own promise, in macro: WILL PAY TO THE BEARER ON DEMAND, ONE HUNDRED DOLLARS; the camera keeps moving; the clock keeps running below it
    const q = ease.inOutCubic(v);
    note('old', lerp(-30, 20, q), lerp(560, 640, q), lerp(2.0, 2.55, q) * punch, lerp(-0.06, 0.02, q), { numer: '100' });
    Object.assign(L, { focus: [0.5, 0.14, 1.6], light: 2.8 + u * 0.4 });
  } else if (name === 'ledgerA' || name === 'ledgerB') {
    // HOW (v9): a bank makes a loan: the loan and the deposit are written in the same moment (two typed entries at once), and the deposit is new
    // money (A); then the books fill, row after row, every deposit typed IOU in red: most money started as a debt (B). (c20: the small
    // clock under the books is gone: it read as a black box.) Take c opens here: the first loan is already being typed on frame 0.
    const A = name === 'ledgerA', uu = u + (TAKE === 'c' && s0 === 0 ? 0.3 : 0), o = { rows: [], dep: [], iou: [], nm: 0 }, ramp = (u0, du) => clamp((uu - u0) / du);
    for (let i = 0; i < LOANS.length; i++) {
      if (A) { o.rows[i] = i === 0 ? ramp(0.35, 1.0) : 0; o.dep[i] = i === 0 ? ramp(0.45, 1.0) : 0; o.iou[i] = 0; }
      else { const u0 = i === 0 ? -9 : 0.3 + 0.62 * (i - 1); o.rows[i] = ramp(u0, 0.4); o.dep[i] = ramp(u0 + 0.08, 0.4); o.iou[i] = ramp(u0 + (i === 0 ? 9.3 : 0.5), 0.3); }
    }
    o.nm = A ? ramp(2.1, 0.55) : 0;
    const z = A ? lerp(1.0, 1.1, v) : lerp(0.88, 0.8, v);
    cam(0, A ? -300 : -80, z * punch, A ? -0.02 : 0.012); loanPage(g, o);
    Object.assign(L, { light: 2.6 + u * 0.3, elev: 0.3, relief: 1.9, focus: [0.5, 0.4, 1.0] });
  } else if (name === 'engine') {
    // WE PRINT IT. (c20): in the cream world, the impression pulled. The press's blanket roller runs down the sheet laid on the inked
    // plate, and behind it the note comes up on the paper, the woman's face first, with its red serials and seal (v8/v9 set this on a
    // near-black chrome plate that flickered dark and light over a second)
    const zz = 1.06 * punch, cy = -6, roll = ease.inOutCubic(clamp((u - 0.1) / 1.7)), ry = lerp(-150, H + 170, roll);
    cam(0, cy, zz, 0);
    g.drawImage(NOTE.new, -NW / 2, -NH / 2, NW, NH); numerals(g, '1'); serials(g, serialStr(7, 1)); sealMark(g, 1, RD);
    g.setTransform(1, 0, 0, 1, 0, 0); if (ry < H) { g.fillStyle = WH; g.fillRect(0, Math.max(0, ry), W, H - Math.max(0, ry)); }   // ahead of the roller: blank paper
    Object.assign(L, { light: 2.0 + u * 0.45, elev: 0.3, relief: 2.0, focus: [0.5, 0.45, 0.9] });
    post.push(() => pressRoller(ctx, ry));
  } else if (name === 'cancel') {
    // FED ABOLISHED. (c20), the second half: the old Federal Reserve plate cancelled the way retired plates are, the burin cutting heavy
    // lines through the issuer's seal (an X, then a run of cross-cuts), in the hook's steel. No stamp.
    const z = lerp(2.5, 2.68, v) * punch;
    cam(SEAL.x - 20, SEAL.y - 50, z, -0.05 + 0.02 * v);
    g.drawImage(NOTE.old, -NW / 2, -NH / 2, NW, NH); numerals(g, '100');
    const cuts = [[-250, 130, 250, 560], [250, 130, -250, 560], [-300, 250, 300, 226], [-300, 300, 300, 276], [-300, 350, 300, 326], [-300, 400, 300, 376], [-300, 450, 300, 426]];
    const prog = Math.pow(clamp((u - 0.04) / 1.3), 0.8) * cuts.length;
    g.strokeStyle = K; g.lineCap = 'round';
    cuts.forEach(([x0, y0, x1, y1], i) => { const p = clamp(prog - i); if (p <= 0) return; const xe = lerp(x0, x1, p), ye = lerp(y0, y1, p);
      g.lineWidth = i < 2 ? 15 : 8; g.beginPath(); g.moveTo(x0, y0); g.lineTo(xe, ye); g.stroke();
      if (p < 1) { const q = g.getTransform().transformPoint(new DOMPoint(xe, ye)); burinState.on = true; burinState.x = q.x; burinState.y = q.y; burinState.a = Math.atan2(y1 - y0, x1 - x0); } });
    if (prog > 0 && prog < cuts.length) shake = 3;
    Object.assign(L, { mode: 1, relief: 2.3, elev: 0.3, light: -0.6 + u * 0.3, focus: [0.5, 0.55, 1.0], sheen: [0.6, 0.13, 1.2], lpos: [0.85, 0.25] });
  } else if (name === 'seal') {
    const plate = u < 1, hitA = Math.max(0, u - 1) * B.spb;
    const z = (plate ? lerp(4.6, 4.2, u) : 4.0 + 0.5 * Math.exp(-hitA * 18)) * punch;
    cam(SEAL.x, SEAL.y, z, 0.2 + u * 0.05);
    g.strokeStyle = K; rosette(g, SEAL.x, SEAL.y, SEAL.R, 0.7, 1, 0.4); ring(g, SEAL.x, SEAL.y, SEAL.R + 12, 5, 64, 4, 0.7);
    g.fillStyle = WH; g.beginPath(); g.arc(SEAL.x, SEAL.y, SEAL.R * 0.44, 0, TAU); g.fill(); g.lineWidth = 1.2; g.beginPath(); g.arc(SEAL.x, SEAL.y, SEAL.R * 0.44, 0, TAU); g.stroke();
    sealMark(g, plate ? clamp(u / 0.8) : 1, plate ? K : RD);
    // c20: the cut emblem takes the red ink and nothing strikes it (v9 hit it with a shake and a ring of red rays)
    Object.assign(L, { light: 2.0 + u * 0.8, elev: 0.28, relief: 2.1 });
  } else if (name === 'newhead') {
    note('new', lerp(-10, 10, v), lerp(-134, -140, v), lerp(2.2, 2.3, v) * punch, 0.0, { numer: '1', serial: serialStr(t, 1), mark: 1 });
    Object.assign(L, { light: 3.6, focus: [0.4, 0.3, 1.2] });
  } else if (name === 'newmoney') {
    const q = ease.inOutCubic(clamp((u - 0.7) / 1.2)), z = lerp(1.1, 0.29, q) * punch;
    cam(lerp((NW + 60) / 2, 0, q), lerp((NH + 60) / 2, 0, q), z, lerp(0.12, 0.08, q));
    for (let j = -4; j < 4; j++) for (let i = -2; i < 2; i++) { const x = (i + 0.5) * (NW + 60), y = (j + 0.5) * (NH + 60);
      if (i === 0 && j === 0 || q > 0) { g.save(); g.translate(x, y); g.drawImage(NOTE.new, -NW / 2, -NH / 2, NW, NH); numerals(g, u < 0.5 ? '100' : '1'); serials(g, serialStr(t + i * 3 + j, 1)); sealMark(g, 1, RD); g.restore(); } }
    Object.assign(L, { light: 2.9 + u * 0.3 });
  } else if (name === 'portrait') {
    // THAT'S US.: the oval turns through four working faces on the beat, each one cut in from the eyes out
    const P = PORTRAIT, CUT = [0, 0.75, 1.5, 2.25];
    let fi = 0; for (let k = 0; k < CUT.length; k++) if (u >= CUT[k]) fi = k;
    const z = lerp(2.0, 2.2, v) * punch, cyc = P.y - (1090 - H / 2) / z;
    cam(0, cyc, z, -0.015 + 0.01 * fi);
    g.drawImage(NOTE.bare, -NW / 2, -NH / 2, NW, NH);
    const since = u - CUT[fi], reveal = fi === 0 ? 1 : clamp(since / 0.34), R = lerp(10, 560, ease.outCubic(reveal)), fy = P.y + 10;
    g.save(); g.beginPath(); g.ellipse(P.x, P.y, P.rx, P.ry, 0, 0, TAU); g.clip();
    // v9: the face being replaced dissolves into the oval's ruled field while the next one is cut in from the eyes out (v8 left its dark hair stranded
    // in the corner until the new cut reached it: the black blob at the swap)
    if (reveal < 1) { lattice(g); faceInOval(g, FACESET[fi - 1], 1 - clamp(reveal / 0.5)); }
    g.save(); g.beginPath(); g.arc(P.x, fy, R, 0, TAU); g.clip(); if (reveal < 1) lattice(g); faceInOval(g, FACESET[fi]); g.restore();
    g.restore();
    if (reveal < 1) { const a = since * 9, m = g.getTransform(), sp = m.transformPoint(new DOMPoint(P.x + Math.cos(a) * R, fy + Math.sin(a) * R)); burinState.on = true; burinState.x = sp.x; burinState.y = sp.y; burinState.a = a + Math.PI / 2; }
    if (fi > 0 && since < 0.12) shake = 7 * (1 - since / 0.12);
    Object.assign(L, { light: 2.0 + u * 0.9, elev: 0.3, focus: [0.58, 0.45, 1.0] });
  } else if (name === 'vaultcrowd') {
    crowdShot(u, t);
    Object.assign(L, { light: 2.7, elev: 0.3, focus: [0.5, 0.5, 0.8] });
  } else if (name === 'wall' || name === 'wallend' || name === 'wall0') {
    const end = name === 'wallend';
    const wash = end ? clamp((b - 42) / 1.4) : 0;
    const camo = end ? { cx: -5 + ease.inCubic(clamp(u / 4)) * 5.5, cy: 7.6, d: 3.6, yaw: 1.05, f: 720 } : { cx: 0.5 + u * (name === 'wall0' ? 1.5 : 4.5), cy: 7.8 + u * 0.3, d: 4.4, yaw: 0.78, f: 820 };
    g.setTransform(1, 0, 0, 1, 0, 0);
    ledgerWall(g, camo, wash, t, 0, true, true);
    ledgerWall(g, camo, wash, t, -LW.gap, false, true);
    if (end) {
      // the corridor ends on the Liberty Bell; the one silence (b41) is the crack
      const P = wallCam(camo), top = P(30, 15.5, -LW.gap / 2), lip = P(30, 3.2, -LW.gap / 2);
      if (top && lip) { const sc = (lip[1] - top[1]) / 1.32, crack = clamp((b - 41) / 0.25), jolt = b >= 41 && b < 41.3 ? 6 * Math.sin(b * 90) : 0;
        g.save(); g.fillStyle = WH; g.globalAlpha = 0.85; g.beginPath(); g.ellipse(lip[0], lip[1] - sc * 0.55, sc * 0.95, sc * 0.9, 0, 0, TAU); g.fill(); g.restore();
        libertyBell(g, lip[0] + jolt, lip[1], sc, crack, Math.sin(t * 1.3) * 0.015); }
      if (b >= 40.3) { const ww = clamp((b - 40.3) / 1.4); water(g, 0, lerp(H, H * 0.74, ww), W, H, t, { pitch: 9, amp: 9, flow: 1.2 }); }
      if (b >= 41 && b < 41.3) shake = 9;
    }
    if (name === 'wall0') post.push(() => drawClock(ctx, t, { cy: 1655, h: 230, mode: 'race' }));   // the same clock: what households owe, still running
    Object.assign(L, { light: 2.9 - u * 0.2, elev: 0.3, focus: [0.5, 0.35, 1.2], fall: 1.1, lpos: [0.1, 0.5] });
  } else if (name === 'ledger' || name === 'bond' || name === 'deed') {
    const cx = lerp(-80, 80, v), cy = lerp(-140, 160, v), z = 1.25 * punch, rot = name === 'bond' ? 0.12 : -0.08;
    const hitA = Math.max(0, (b - s0) * B.spb);                  // seconds since this page's stamp
    const sy = PAGEY[s0] || 1390, py = cy + (sy - H / 2) / z;       // the page's own picture line, below the clause
    if (name === 'deed') {
      // PRIVATE.: the deed tears along the stamp's line and the halves pull apart
      g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = hatchPat().dark; g.fillRect(0, 0, W, H);
      const tear = ease.outCubic(clamp((hitA - 0.05) / 0.5)), jag = [];
      for (let x = -640; x <= 640; x += 28) jag.push([x, py + (rng(Math.round(x) + 900)() - 0.5) * 34 + Math.sin(x * 0.02) * 10]);
      for (const side of [-1, 1]) {
        cam(cx, cy, z, rot); g.translate(0, side * tear * 150); g.rotate(side * tear * 0.05);
        g.save(); g.beginPath(); g.moveTo(-700, side < 0 ? -1200 : 1200); for (const q of jag) g.lineTo(q[0], q[1]); g.lineTo(700, side < 0 ? -1200 : 1200); g.closePath(); g.clip();
        page(g, 'deed', t, 0); g.restore();
        g.save(); g.strokeStyle = WH; g.lineWidth = 5; g.beginPath(); jag.forEach((q, i) => i ? g.lineTo(q[0], q[1] + side * 3) : g.moveTo(q[0], q[1] + side * 3)); g.stroke(); g.restore();
      }
      shake = 8 * Math.exp(-hitA * 14);
    } else {
      cam(cx, cy, z, rot);
      if (name === 'ledger') {
        // ALL DEBTS.: the rows under the stamp strike through and roll to 0.00, then the strike spreads down the page
        const reach = 130 + hitA * 1100;
        page(g, 'ledger', t, 0, (i, y) => { const d = Math.abs(y + 28 - py); return d < reach ? clamp((reach - d) / 160 + (hitA > 0.02 ? 0.2 : 0)) : 0; });
      } else {
        // PUBLIC.: the coupon sheet cancelled with a punch, coupon by coupon out from the stamp
        page(g, 'bond', t, 0);
        const reach = 80 + hitA * 1500;
        for (let j = 0; j < 7; j++) for (let i = 0; i < 3; i++) { const x = -520 + i * 350, y = -900 + j * 262, d = Math.hypot(x + 165 - cx, y + 120 - py);
          if (d > reach) continue;
          for (let a = 0; a < 3; a++) for (let q = 0; q < 6; q++) { const hx = x + 70 + q * 38, hy = y + 60 + a * 58;
            g.fillStyle = K; g.beginPath(); g.arc(hx, hy, 11, 0, TAU); g.fill(); g.strokeStyle = WH; g.lineWidth = 2; g.beginPath(); g.arc(hx - 2, hy - 2, 10, 0.4, 2.2); g.stroke(); } }
      }
    }
    Object.assign(L, { light: 2.6 + u * 0.25, elev: 0.3, focus: [0.45, 0.4, 1] });
  } else if (name === 'balance') {
    // $0.00: the clock of what households owe rolls its wheels down to zero, right to left; the leading zeros fall blank, the $ slides
    // home and the board closes in on a red $0.00, held: the share frame (v9 cut to a type card)
    cam(-40, 200, 1.3 * punch, -0.06);
    page(g, 'balance', t, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    post.push(() => drawClock(ctx, t, { mode: 'land', b, cy: 900, h: 300 }));
    Object.assign(L, { light: 2.6 + u * 0.25, elev: 0.3, focus: [0.45, 0.5, 1] });
  } else if (name === 'back') {
    // BACKED BY STEEL.: the back of the new note, and the camera goes vignette to vignette across it; b55 the seal is struck
    const q = backCam(b), seal = b >= 55;
    cam(q[0], q[1], q[2] * punch, q[3]);
    g.drawImage(NOTE.back, -NW / 2, -NH / 2, NW, NH);
    if (q[2] > 1.7) PAN.forEach((P, i) => { if (Math.abs(q[0] - PANC[i][0]) < 420 && Math.abs(q[1] - PANC[i][1]) < 520) { g.drawImage(VIGS[i], P.x, P.y, PW, PHT); g.strokeStyle = K; g.lineWidth = 2; g.strokeRect(P.x, P.y, PW, PHT); } });
    backFx(t, b, q);
    if (seal) { const a = (b - 55) * B.spb; sovereignSeal(g, a); shake = 16 * Math.exp(-a * 13); }
    Object.assign(L, { light: 2.4 + t * 0.2, elev: 0.3, relief: seal ? 2.4 : 1.8, focus: [0.5, 0.5, 0.6] });
  } else if (name === 'build' && u < 1.9) {
    buildPoster(u, t);
    Object.assign(L, { light: 2.2 + u * 0.4, elev: 0.28, relief: 1.6 });
  } else if (name === 'build') {
    buildToNote(u, t); Object.assign(L, { light: 2.4 + u * 0.5, elev: 0.28 });
  } else if (name === 'press2') {
    // JUBILEE!: the press rolls the new note off the inked plate, the sheet lifts, the red seal strikes on the brass
    const rx = lerp(480, W + 400, ease.inOutCubic(clamp(u / 0.9))), lift = ease.outCubic(clamp((u - 0.9) / 1.1));
    note('new', 0, lerp(40, 0, lift), (1.02 + 0.12 * lift) * punch, lerp(0.0, -0.08, lift), { numer: '1', serial: serialStr(t, 2), mark: 1, markColor: RD });   // c20: printed with the note, not struck on it

    Object.assign(L, { light: 2.0 + u * 1.2, elev: lerp(0.28, 0.2, lift), relief: 2 });
  } else if (name === 'fan') {
    g.setTransform(1, 0, 0, 1, 0, 0);
    const n = 14, fanU = ease.outCubic(clamp(u / 1.2));
    for (let i = 0; i < n; i++) { const f = i / (n - 1), ang = lerp(-0.62, 0.62, f) * fanU + Math.sin(t * 7 + i) * 0.01 * (1 - fanU), riff = Math.max(0, Math.sin((u * 2.6 - f) * Math.PI)) * 0.06;
      g.setTransform(1, 0, 0, 1, 0, 0); g.translate(W / 2, H * 0.98); g.rotate(ang - riff); g.scale(0.64 * punch, 0.64 * punch); g.translate(0, -NH * 0.55);
      g.drawImage(NOTE.bare, -NW / 2, -NH / 2, NW, NH); faceInOval(g, FACESET[i % 4]); numerals(g, '1'); serials(g, serialStr(i + 3, 1)); sealMark(g, 1, RD);
      g.lineWidth = 2; g.strokeStyle = K; g.strokeRect(-NW / 2, -NH / 2, NW, NH); }
    g.setTransform(1, 0, 0, 1, 0, 0);
    Object.assign(L, { light: 1.2 + u * 2.2, elev: 0.24, relief: 2 });
  } else if (name === 'money') {
    // THE PEOPLE'S MONEY.: the finished note, face and all, slammed down under the Bank's seal; the type is set as the heaviest line
    const a = u * B.spb, slam = 1 + 0.5 * Math.exp(-a * 16);
    const serial = u < 0.7 ? `PN 0000000${Math.min(9, Math.floor(u * 14) % 10)} A` : 'PN 00000001 A';
    note('new', 0, -290 + 24 * ease.outCubic(clamp(u / 1.5)), 1.0 * slam * punch, lerp(-0.07, 0, ease.outCubic(clamp(u / 1.2))), { numer: '1', serial, mark: 1 });
    shake = 24 * Math.exp(-a * 13);
    Object.assign(L, { light: 0.6 + u * 0.5, elev: 0.22 + 0.05 * Math.sin(u), relief: 2.1 });
  } else if (name === 'push') {
    endShot(b, u, t); shake = 0;
    Object.assign(L, { light: 1.3 + (t - 28.5) * 0.28, elev: 0.27, relief: b > 68.5 ? 2.5 : 2.1, focus: [0.5, 0.6, b < 68 ? 0.9 : 0.5] });
  }

  if (shake > 0.3) { const r = rng(fr * 7 + 1); tg.setTransform(1, 0, 0, 1, 0, 0); tg.fillStyle = WH; tg.fillRect(0, 0, W, H); tg.drawImage(ink, (r() - 0.5) * shake, (r() - 0.5) * shake); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(TMP, 0, 0); }
  PERF.draw = performance.now() - tf0;
  ig.render(ctx, ink, L);
  for (const f of over) f();
  for (const f of post) f();
  if (burinState.on) burin(burinState.x, burinState.y, burinState.a, t, L.mode > 0.5);
  if (cutterState.on) stylus(cutterState.x, cutterState.y, t);
  motes(t, L.mode > 0.5);
  clauseRibbon(b);
  drawType(b);
  const fb = (1 / 30) / B.spb;
  if ((H2 ? [32, 48, 64] : [21, 40]).some(k => b >= k - fb && b < k)) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = 'rgba(14,11,8,0.62)'; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  finish.apply(ctx, fr, { grain: 0.045, vignette: 0.35, flash: 0 });
  PERF.total = performance.now() - tf0;
  if (fr % 30 === 0 || window.PROFILE) console.log(`bank3 t=${t.toFixed(2)} b=${b.toFixed(1)} ${name}: draw ${PERF.draw.toFixed(0)}ms total ${PERF.total.toFixed(0)}ms`);
};

// WE BUILD IT., second half: the back of the note (four vignettes round the seal) turns over to the face
function buildToNote(u, t) {
  const q = clamp((u - 1.9) / 1.0), sh = ease.inOutCubic(clamp(q / 0.62)), fl = clamp((q - 0.62) / 0.38), flip = Math.cos(Math.PI * fl);
  cam(0, 0, lerp(1.12, 1.04, sh), -0.04 * sh); g.scale(Math.max(0.02, Math.abs(flip)), 1);
  if (flip >= 0) g.drawImage(NOTE.back, -NW / 2, -NH / 2, NW, NH);
  else { g.drawImage(NOTE.new, -NW / 2, -NH / 2, NW, NH); numerals(g, '1'); serials(g, 'PN 00000001 A'); sealMark(g, 1, RD); }
  g.setTransform(1, 0, 0, 1, 0, 0);
}
// ================================================================ overlays (drawn over the relit plate)
function burin(x, y, a, t, plate) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a + Math.PI);
  const L = 900, w = 58;
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.moveTo(8, 18); ctx.lineTo(L, 60); ctx.lineTo(L, 160); ctx.lineTo(8, 30); ctx.fill();
  const top = ctx.createLinearGradient(0, -w, 0, 0); top.addColorStop(0, '#2b3338'); top.addColorStop(0.55, '#c9d3d8'); top.addColorStop(0.62, '#ffffff'); top.addColorStop(1, '#5b666c');
  ctx.fillStyle = top; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(70, -w * 0.5); ctx.lineTo(L, -w); ctx.lineTo(L, 0); ctx.closePath(); ctx.fill();
  const side = ctx.createLinearGradient(0, 0, 0, w); side.addColorStop(0, '#11171a'); side.addColorStop(1, '#3c464b');
  ctx.fillStyle = side; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(L, 0); ctx.lineTo(L, w * 0.8); ctx.lineTo(70, w * 0.4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#f4f1e8'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(70, -w * 0.5); ctx.lineTo(70, w * 0.4); ctx.closePath(); ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(70, 0); ctx.lineTo(L, 0); ctx.stroke();
  const n = 46;
  for (let i = n; i >= 0; i--) { const f = i / n, ph = f * 14 + t * 9, r = 10 + f * 26, px = -f * 70 - 6, py = -f * 40 + Math.sin(ph) * r * 0.5 - f * f * 30, wdt = 5 + 3 * Math.cos(ph);
    const l = 0.5 + 0.5 * Math.cos(ph + 1); ctx.fillStyle = `rgb(${120 + 135 * l},${128 + 127 * l},${132 + 120 * l})`; ctx.beginPath(); ctx.ellipse(px, py - Math.cos(ph) * r * 0.35, wdt, 3.2, ph, 0, TAU); ctx.fill(); }
  ctx.globalCompositeOperation = 'lighter'; const gl2 = ctx.createLinearGradient(0, 0, 260, 0); gl2.addColorStop(0, 'rgba(255,250,235,0.9)'); gl2.addColorStop(1, 'rgba(255,250,235,0)');
  ctx.strokeStyle = gl2; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(260, 0); ctx.stroke();
  const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 40); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = gr; ctx.fillRect(-40, -40, 80, 80);
  ctx.restore();
}
function chuck(t, u) {         // the rose engine's brass chuck: its knurled rim frames the top edge, turning, in focus
  ctx.save(); ctx.translate(W / 2, -690); ctx.rotate(u * 0.6);
  const r = 760, gr = ctx.createRadialGradient(0, 0, r - 90, 0, 0, r + 10);
  gr.addColorStop(0, 'rgba(40,28,10,0)'); gr.addColorStop(0.3, '#5a4118'); gr.addColorStop(0.62, '#e8c979'); gr.addColorStop(0.72, '#fff1c4'); gr.addColorStop(0.85, '#8a6526'); gr.addColorStop(1, '#241808');
  ctx.fillStyle = gr; ctx.beginPath(); for (let j = 0; j <= 720; j++) { const a = j / 720 * TAU, rr = r + 8 * Math.sin(a * 180); ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  for (let j = 720; j >= 0; j--) { const a = j / 720 * TAU; ctx.lineTo(Math.cos(a) * (r - 90), Math.sin(a) * (r - 90)); } ctx.fill();
  ctx.strokeStyle = 'rgba(30,20,6,0.85)'; ctx.lineWidth = 2; for (let k = 0; k < 96; k++) { const a = k / 96 * TAU; ctx.beginPath(); ctx.moveTo(Math.cos(a) * (r - 84), Math.sin(a) * (r - 84)); ctx.lineTo(Math.cos(a) * (r - 30), Math.sin(a) * (r - 30)); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(255,244,210,0.8)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, r - 58, 0, TAU); ctx.stroke();
  ctx.restore();
}
function stylus(x, y, t) {
  ctx.save(); ctx.translate(x, y);
  const gr = ctx.createLinearGradient(-20, 0, 20, 0); gr.addColorStop(0, '#20282c'); gr.addColorStop(0.5, '#dfe7ea'); gr.addColorStop(1, '#30393e');
  ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(-3, 0); ctx.lineTo(3, 0); ctx.lineTo(26, -H); ctx.lineTo(-26, -H); ctx.fill();
  ctx.globalCompositeOperation = 'lighter'; const r = ctx.createRadialGradient(0, 0, 0, 0, 0, 36); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = r; ctx.fillRect(-36, -36, 72, 72);
  ctx.restore();
}
function pressRoller(c, y) {         // WE PRINT IT.: the press's blanket roller seen from above, crossing the sheet (felt over steel, no chrome)
  if (y < -200 || y > H + 200) return;
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
  const R = 95, gr = c.createLinearGradient(0, y - R, 0, y + R);
  gr.addColorStop(0, '#4c4a44'); gr.addColorStop(0.25, '#8f8a7d'); gr.addColorStop(0.42, '#d9d2bf'); gr.addColorStop(0.5, '#e8e1cd'); gr.addColorStop(0.7, '#9a9384'); gr.addColorStop(1, '#3e3c37');
  c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(0, y + R, W, 38);
  c.fillStyle = gr; c.fillRect(0, y - R, W, 2 * R);
  c.strokeStyle = 'rgba(40,36,30,0.35)'; c.lineWidth = 1; for (let k = -R + 8; k < R; k += 7) { c.beginPath(); c.moveTo(0, y + k); c.lineTo(W, y + k); c.stroke(); }
  c.restore();
}
function roller(x, t) {
  ctx.save(); if (CART) { ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.rect(...CART); ctx.clip('evenodd'); } const w = 300; const gr = ctx.createLinearGradient(x - w, 0, x + 40, 0);
  gr.addColorStop(0, '#0c1113'); gr.addColorStop(0.35, '#58656b'); gr.addColorStop(0.55, '#e9eef0'); gr.addColorStop(0.62, '#8b989e'); gr.addColorStop(1, '#101618');
  ctx.fillStyle = gr; ctx.fillRect(x - w, 0, w + 40, H);
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x + 40, 0, 40, H);
  ctx.restore();
}
function motes(t, plate) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 70; i++) { const r = rng(i * 7 + 3); const x = (r() * W + t * (10 + r() * 30)) % W, y = (r() * H - t * (6 + r() * 12) + H) % H, s = 1 + r() * 2.6;
    ctx.fillStyle = plate ? `rgba(220,235,245,${0.1 + 0.25 * r()})` : `rgba(255,248,230,${0.08 + 0.2 * r()})`; ctx.beginPath(); ctx.arc(x, y, s, 0, TAU); ctx.fill(); }
  ctx.restore();
}
// closer: the ☭≡/acc lockup and ACP.US struck into the cream stock and embossed under the same raking light (1.4 s)
// warm the shader programs (the three worlds and the relight) so the first frames don't stall the capture
// (v9: the three.js worlds of v7/v8 (the vault) are cut; nothing here needs a WebGL warm-up any more)
ig.render(ctx, ink, { mode: 0, inked: 0, relief: 1.8, elev: 0.32, light: 2.3, expo: 1.02, focus: [0.5, 1, 0], sheen: [0.55, 0.12, 0], t: 0, fall: 1, lpos: [0.1, 0.15], paper: PAPER, ca: 0 });
window.sceneReady = true;
