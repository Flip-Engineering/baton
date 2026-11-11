// PEOPLE'S NATIONAL BANK (v3, engraving): the whole frame is a vertical banknote being engraved.
// Who prints the money? Credit is power. The note re-engraves itself: the People's National Bank,
// re-denominated. Debt Jubilee: the river flows over the ledgers and the slate comes up clean.
// Backed by production: the engraving pours into intaglio vignettes of mill, rail, grain and a chip fab, then the mill again. The people's money.
import { W, H, C, loadFonts, loadBeats, clamp, lerp, ease, rng, line, Finish, sigil, closer, outCanvas } from '../lib/kit.js';

const ctx = outCanvas();
await loadFonts();
const B = await loadBeats('bank2');
const finish = new Finish(1913);
const PAPER = '#e7e1cb', INK = '#1c2822', RED = '#b3121f', SERIF = 'DejaVu Serif';

// paper with fibres, rendered once
const paper = document.createElement('canvas'); paper.width = W; paper.height = H;
{ const g = paper.getContext('2d'), r = rng(9);
  g.fillStyle = PAPER; g.fillRect(0, 0, W, H);
  const id = g.getImageData(0, 0, W, H);
  for (let i = 0; i < id.data.length; i += 4) { const n = (r() - 0.5) * 14; id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n * 0.8; }
  g.putImageData(id, 0, 0);
  for (let k = 0; k < 260; k++) { g.strokeStyle = r() < 0.5 ? 'rgba(180,20,30,0.45)' : 'rgba(30,60,140,0.4)'; g.lineWidth = 1.2; const x = r() * W, y = r() * H, a = r() * 6;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14, x + Math.cos(a + 1) * 26, y + Math.sin(a + 1) * 26); g.stroke(); } }

// ---------------------------------------------------------------- engraving primitives
function rosette(cx, cy, R, r, d, n, p, color, lw, rot) {       // hypotrochoid guilloche, drawn up to p
  const steps = Math.floor(900 * n * clamp(p));
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath();
  for (let i = 0; i <= steps; i++) { const t = i / 900 * Math.PI * 2;
    const x = (R - r) * Math.cos(t + rot) + d * Math.cos((R - r) / r * t - rot), y = (R - r) * Math.sin(t + rot) - d * Math.sin((R - r) / r * t - rot);
    i ? ctx.lineTo(cx + x, cy + y) : ctx.moveTo(cx + x, cy + y); }
  ctx.stroke();
}
function band(y, h, t, color, phase = 0) {                      // guilloche band: stacked sine waves
  ctx.strokeStyle = color; ctx.lineWidth = 1.1;
  for (let k = 0; k < 9; k++) { ctx.beginPath();
    for (let x = 0; x <= W; x += 6) { const yy = y + h / 2 + Math.sin(x * 0.045 + k * 0.7 + t * 1.3 + phase) * h * 0.38 * Math.cos(x * 0.011 + k * 0.3); x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); }
    ctx.stroke(); }
}
function micro(text, x, y, w, color, t) {                        // microprint line
  ctx.save(); ctx.font = `10px "${SERIF}"`; ctx.fillStyle = color; ctx.beginPath(); ctx.rect(x, y - 10, w, 14); ctx.clip();
  let s = ''; while (s.length < 400) s += text + ' · ';
  ctx.fillText(s, x - (((t * 30) % 200) + 200) % 200, y); ctx.restore();
}
function hatchShape(path, gap, color, ang = 0) {                // intaglio fill: parallel lines clipped to a shape
  ctx.save(); path(); ctx.clip(); ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.beginPath();
  const c = Math.cos(ang), s = Math.sin(ang);
  for (let k = -H; k < H; k += gap) { ctx.moveTo(-W * c - k * s + W / 2, -W * s + k * c + H / 2); ctx.lineTo(W * c - k * s + W / 2, W * s + k * c + H / 2); }
  ctx.stroke(); ctx.restore();
  ctx.strokeStyle = color; ctx.lineWidth = 2.4; path(); ctx.stroke();
}

// ---------------------------------------------------------------- the note
function frame(t, p) {
  ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.strokeRect(36, 36, W - 72, H - 72); ctx.lineWidth = 1.2; ctx.strokeRect(52, 52, W - 104, H - 104);
  band(64, 80, t, 'rgba(28,40,34,0.75)'); band(H - 144, 80, t, 'rgba(28,40,34,0.75)', 2);
  micro("THE PEOPLE'S NATIONAL BANK OF THE UNITED STATES OF AMERICA", 60, 160, W - 120, 'rgba(28,40,34,0.8)', t);
  micro('DEBT JUBILEE · CREDIT FOR PRODUCTION · FOR THE WORKING CLASS', 60, H - 158, W - 120, 'rgba(28,40,34,0.8)', t);
  for (const [x, y] of [[130, 250], [W - 130, 250], [130, H - 250], [W - 130, H - 250]]) rosette(x, y, 70, 13, 40, 13, p, 'rgba(28,40,34,0.8)', 1, t * 0.3);
}
function serial(x, y, t, roll, zero, color = RED) {
  const r = rng(Math.floor(t * 20 * roll) + 5);
  const s = zero ? 'PN 00000000 A' : `${'ABCDEFGH'[Math.floor(r() * 8)]}${Math.floor(r() * 1e8).toString().padStart(8, '0')}${'ABCDE'[Math.floor(r() * 5)]}`;
  line(ctx, s, x, y, { family: 'Plex Mono', size: 44, color, align: 'center' });
}
function medallion(t, p, mark, kick) {                          // the centre: guilloche rosette, then the ACP mark pressed in
  const cx = W / 2, cy = 820;
  rosette(cx, cy, 300, 23, 210, 23, p, 'rgba(28,40,34,0.85)', 1.1, t * 0.12);
  rosette(cx, cy, 250, 37, 120, 37, p * 1.1, 'rgba(179,18,31,0.8)', 1.1, -t * 0.2);
  rosette(cx, cy, 160, 11, 90, 11, p * 1.2, 'rgba(28,40,34,0.9)', 1, t * 0.35);
  if (mark > 0) { ctx.fillStyle = PAPER; ctx.beginPath(); ctx.arc(cx, cy, 128 * mark, 0, 7); ctx.fill();
    sigil(ctx, cx, cy, 150 * (1 + 0.04 * kick) * mark, { color: INK, accent: RED, alpha: clamp(mark) }); }
}
function ledger(t, u, wash) {                                   // the debts: engraved columns of figures, washed to zero by the river
  const r = rng(77);
  for (let i = 0; i < 16; i++) {
    const y = 330 + i * 70, zeroed = wash > (i + 1) / 17;
    const v = zeroed ? '$0.00' : '$' + Math.floor(r() * 9e9 * (1 + u)).toLocaleString('en-US') + '.' + String(Math.floor(r() * 99)).padStart(2, '0');
    line(ctx, v, W / 2, y, { family: 'Plex Mono', size: 50, color: zeroed ? INK : (i % 3 ? INK : RED), align: 'center', alpha: zeroed ? 0.9 : 0.85 });
  }
}
function river(t, wash) {                                        // andurarum: engraved water lines flowing down across the note
  if (wash <= 0) return;
  const top = -200 + wash * (H + 400);
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, top); ctx.clip();
  ctx.fillStyle = 'rgba(231,225,203,0.82)'; ctx.fillRect(0, 0, W, top);
  ctx.strokeStyle = 'rgba(28,60,90,0.8)'; ctx.lineWidth = 1.6;
  for (let k = 0; k < 90; k++) { const y0 = k * 24 - (t * 160) % 24; ctx.beginPath();
    for (let x = 0; x <= W; x += 8) { const yy = y0 + Math.sin(x * 0.02 + k * 0.5 + t * 3) * 8 + Math.sin(x * 0.007 - t) * 14; x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); } ctx.stroke(); }
  ctx.restore();
  ctx.strokeStyle = 'rgba(28,60,90,0.95)'; ctx.lineWidth = 3; ctx.beginPath();
  for (let x = 0; x <= W; x += 8) { const yy = top + Math.sin(x * 0.03 + t * 4) * 16; x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); } ctx.stroke();
}
// vignettes of production, hatched like banknote engravings
const VIG = {
  mill: () => { ctx.beginPath(); ctx.rect(170, 900, 740, 300); for (let i = 0; i < 4; i++) ctx.rect(230 + i * 170, 560 + i * 30, 60, 340 - i * 30); ctx.moveTo(170, 900); for (let i = 0; i < 5; i++) { ctx.lineTo(170 + i * 148, 830); ctx.lineTo(170 + (i + 1) * 148, 900); } },
  rail: () => { ctx.beginPath(); ctx.rect(200, 880, 560, 200); ctx.rect(760, 820, 150, 260); ctx.rect(250, 760, 80, 120); ctx.moveTo(380, 1110); ctx.arc(320, 1110, 60, 0, 7); ctx.moveTo(530, 1110); ctx.arc(470, 1110, 60, 0, 7); ctx.moveTo(680, 1110); ctx.arc(620, 1110, 60, 0, 7); ctx.moveTo(880, 1110); ctx.arc(820, 1110, 60, 0, 7); },
  grain: () => { ctx.beginPath(); for (let i = 0; i < 4; i++) { ctx.moveTo(250 + i * 110 + 100, 700); ctx.rect(250 + i * 110, 700, 100, 480); ctx.moveTo(250 + i * 110 + 100, 700); ctx.ellipse(300 + i * 110, 700, 50, 16, 0, 0, 7); } ctx.rect(690, 560, 120, 620); ctx.moveTo(690, 560); ctx.lineTo(750, 500); ctx.lineTo(810, 560); ctx.rect(810, 900, 160, 280); },
  fab: () => { ctx.beginPath(); ctx.rect(150, 860, 780, 320); for (let i = 0; i < 6; i++) ctx.rect(185 + i * 125, 800, 90, 60);   // the fab hall and its air handlers
    ctx.rect(240, 560, 56, 240); ctx.rect(784, 600, 56, 200); for (let i = 0; i < 7; i++) ctx.rect(190 + i * 105, 930, 70, 90);   // stacks, clean-room bays
    for (let k = 0; k < 6; k++) { const x = 300 + k * 96; ctx.moveTo(x + 16, 1112); ctx.arc(x, 1112, 16, 0, 7); ctx.rect(x - 20, 1130, 40, 90); } },   // the shift at the door
};
function vignette(name, u, t) {
  const a = ease.outExpo(clamp(u / 0.4));
  ctx.save(); ctx.globalAlpha = a; ctx.beginPath(); ctx.ellipse(540, 900, 430, 470, 0, 0, 7); ctx.clip();
  ctx.strokeStyle = 'rgba(179,18,31,0.55)'; ctx.lineWidth = 1.4; ctx.beginPath();          // the allegorical sunburst behind every vignette
  for (let k = 0; k < 120; k++) { const ang = k / 120 * Math.PI * 2 + t * 0.05; ctx.moveTo(540, 980); ctx.lineTo(540 + Math.cos(ang) * 700, 980 + Math.sin(ang) * 700); }
  ctx.stroke();
  const hill = () => { ctx.beginPath(); ctx.moveTo(60, 1400); for (let x = 60; x <= 1020; x += 20) ctx.lineTo(x, 1150 + Math.sin(x * 0.01) * 30 + Math.sin(x * 0.037) * 14); ctx.lineTo(1020, 1400); ctx.closePath(); };
  hatchShape(hill, 6, 'rgba(28,40,34,0.9)', 0.05);
  ctx.strokeStyle = 'rgba(28,40,34,0.85)'; ctx.lineWidth = 2;                                 // engraved smoke curls rising
  for (let k = 0; k < 5; k++) { let x = 260 + k * 150, y = 560 - k * 10; ctx.beginPath(); ctx.moveTo(x, y);
    for (let s2 = 0; s2 < 40; s2++) { const r2 = 6 + s2 * 1.4, ang = s2 * 0.55 + t * 2 + k; ctx.lineTo(x + Math.cos(ang) * r2 + s2 * 3, y - s2 * 6 + Math.sin(ang) * r2); } ctx.stroke(); }
  ctx.restore();
  ctx.save(); ctx.globalAlpha = a; ctx.translate(540, 900); ctx.scale(lerp(1.15, 1, a), lerp(1.15, 1, a)); ctx.translate(-540, -900);
  hatchShape(VIG[name], 5, INK, 0.2); hatchShape(VIG[name], 11, 'rgba(28,40,34,0.6)', -0.6); ctx.restore();
}

// ---------------------------------------------------------------- words: set in a knocked-out cartouche, engraved serif
const WORDS = [[0, 'FED ABOLISHED.'], [2, 'READ YOUR'], [3, 'DOLLAR.'], [5, 'FEDERAL'], [6, 'RESERVE NOTE.'], [8, 'DEC 23, 1913.'],
  [10, 'LEGAL TENDER'], [12, 'ALL DEBTS,'], [14, 'PUBLIC AND PRIVATE.'], [16, 'THE POWER'], [17, 'TO PRINT'], [18, "IS THE PEOPLE'S."],
  [20, "THE PEOPLE'S"], [21, 'NATIONAL BANK.'], [23, 'NOW OPEN.'], [25, 'NEW MONEY.'], [27, 'ISSUED BY'], [28, 'THE WORKING CLASS.'],
  [30, 'THE FIFTIETH'], [31, 'YEAR.'], [32, 'DEBT JUBILEE.'], [34, 'ALL DEBTS.'], [36, 'PUBLIC.'], [38, 'PRIVATE.'],
  [40, 'EVERY LEDGER'], [42, 'CLEARED.'], [44, 'BALANCE DUE: $0.00.'],
  [47, 'BACKED BY'], [48, 'STEEL.'], [49, 'BACKED BY'], [50, 'RAIL.'], [51, 'BACKED BY'], [52, 'GRAIN.'], [53, 'BACKED BY'], [54, 'CHIPS.'],
  [55, 'NATIONALIZED.'], [56, 'NOW HIRING.'], [57, 'WE BUILD IT.'], [59, "THE PEOPLE'S"], [60, 'MONEY.'], [64, null]];
const REDW = new Set(['FED ABOLISHED.', 'PUBLIC AND PRIVATE.', "IS THE PEOPLE'S.", 'NATIONAL BANK.', 'THE WORKING CLASS.', 'DEBT JUBILEE.',
  'CLEARED.', 'BALANCE DUE: $0.00.', 'STEEL.', 'NATIONALIZED.', 'WE BUILD IT.', 'MONEY.']);
const at = (list, b) => { let q = list[0]; for (const x of list) if (b >= x[0]) q = x; return q; };
function words(b) {
  const w = at(WORDS, b); if (!w[1] || b < w[0]) return;
  const age = (b - w[0]) * B.spb, a = ease.outExpo(clamp(age / 0.1)), y = 1520;
  ctx.fillStyle = PAPER; ctx.fillRect(90, y - 190, W - 180, 250); ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.strokeRect(100, y - 180, W - 200, 230); ctx.lineWidth = 1; ctx.strokeRect(112, y - 168, W - 224, 206);
  line(ctx, w[1], W / 2, y, { family: SERIF, weight: 'bold', size: 150 * (1 + 0.15 * Math.exp(-age * 14)), color: REDW.has(w[1]) ? RED : INK, alpha: a, maxW: W - 280 });
}

window.renderFrame = async (t) => {
  const b = B.beat(t), fr = Math.round(t * 30);
  if (b >= 72) { closer(ctx, (b - 72) * B.spb); finish.apply(ctx, fr, { grain: 0.06, vignette: 0.6 }); return; }
  const kick = B.env('kick', t, 9), snare = B.env('snare', t, 12), imp = B.env('impact', t, 5);
  // camera: macro on the rosette at the open, pulling back; punches on kicks
  const zoom = b < 8 ? lerp(4.2, 1.35, ease.outCubic(b / 8)) : b < 16 ? 1.25 - (b - 8) * 0.01 : b < 32 ? 1.08 + 0.02 * Math.sin(b * 0.8) : b < 48 ? 1.05 : 1.08;
  const fx = b < 8 ? 540 + Math.sin(t) * 40 : 540, fy = b < 16 ? 820 : 900;
  ctx.save();
  ctx.translate(W / 2 + Math.sin(t * 83) * 6 * kick, H / 2 + Math.cos(t * 71) * 6 * kick);
  const z = zoom * (1 + 0.03 * kick + 0.06 * imp); ctx.scale(z, z); ctx.translate(-fx, -fy);
  ctx.drawImage(paper, 0, 0);
  frame(t, clamp(b / 12));
  serial(270, 330, t, b < 32 ? 1 : 0, b >= 44, RED); serial(W - 270, H - 320, t, b < 32 ? 1 : 0, b >= 44, RED);
  const deno = b >= 25 && b < 32;
  for (const [x, y] of [[130, 272], [W - 130, 272], [130, H - 228], [W - 130, H - 228]])
    line(ctx, deno ? '1' : '100', x, y, { family: SERIF, weight: 'bold', size: deno ? 110 : 64, color: INK, align: 'center' });
  if (b < 32) medallion(t, clamp(0.1 + b / 10), b >= 18 ? ease.outBack(clamp((b - 18) / 1.2)) : 0, kick);
  else if (b < 48) { ledger(t, b - 32, b >= 40 ? clamp((b - 40) / 7) : 0); river(t, b >= 38 ? clamp((b - 38) / 9) : 0); }
  else if (b < 60) { const v = b < 50 ? 'mill' : b < 52 ? 'rail' : b < 54 ? 'grain' : b < 56 ? 'fab' : 'mill';
    vignette(v, (b - (b < 56 ? Math.floor(b / 2) * 2 : 56)) * B.spb, t); }
  else medallion(t, 1, 1, kick);
  ctx.restore();
  if (b >= 64) {                                                 // the note gives way to the banner field: ☭≡/acc on red
    const u = ease.outExpo(clamp((b - 64) / 1));
    ctx.fillStyle = `rgba(179,18,31,${u})`; ctx.fillRect(0, 0, W, H);
    sigil(ctx, W / 2, 860, 220 * lerp(1.4, 1, u), { color: PAPER, alpha: u, tagline: true });
  } else words(b);
  if (snare > 0.3 && b >= 32 && b < 48) { ctx.fillStyle = `rgba(231,225,203,${0.25 * snare})`; ctx.fillRect(0, 0, W, H); }
  finish.apply(ctx, fr, { grain: 0.05, vignette: 0.45, flash: b >= 32 && b < 32.25 ? 0.7 : 0 });
};
window.sceneReady = true;
