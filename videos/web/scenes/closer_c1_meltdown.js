// CLOSER c1 demo: meltdown8.js with its closer card replaced by CLOSERS.flaps (web/lib/closer.js). Everything else is the published scene.
// MELTDOWN v13 (cycle 10): the split-flap price board carries the argument, and every sentence is set on the board's big rows.
// (the beats below are v13 beats: 15 bars were inserted where the reading was; SEG maps them to the v12 beats the kept worlds think in)
//   HOOK (b0-8)       THANK YOU, / MONOPOLY. in the board's own big cream flaps on frame 0; EVERY PRICE. (the search beam);
//                     EVERY MACHINE. (the cells flip to halftone machine plates).
//   STORY (b8-12)     THE STORY / GOES LIKE / THIS: (Land's first words, over the machine plates). RESTORED from v1.
//   WHY (b12-28)      Vertov's ledger: WORKERS / MACHINES / PROFIT on big flaps over the market, a wax-pencil curve of the
//                     profit rate redrawn lower on each kick, the ghosts kept; THE RATE OF PROFIT TENDS TO FALL. PROFIT never rises.
//                     b24-28 MERGE (Saul Bass): the rows slam together, 37 -> 4 -> 1 on three falling subs.
//   LENIN (b28-36)    the one row as a red slab: COMPETITION BECOMES TRANSFORMED / INTO MONOPOLY., two follow-on frames.
//   SEARCH (b36-44)   the beam runs down the one row (a brass ALADDIN nameplate; its row scrolls real goods) over the market.
//   FINANCE (b44-68)  THAT BIRTHS AI THROUGH FINANCIALIZATION OF TECHNOLOGY over the columned exchange ($690,000,000,000 ticker);
//                     ALL IN.; AI. (the pour becomes the lattice); MOST OF THE SILICON VALLEY STARTUPS RAN AT A LOSS, (the loss row
//                     chars); HOW IS PROFIT ACTUALLY MADE ANYMORE?  (Haz, credited as a transcript)
//   ZERO (b68-92)     the ledger at half rate: REPLACING ALL LABOR WITH AI / WILL REQUIRE COMMUNISM, (Haz) while WORKERS 400 -> 0 and
//                     PROFIT falls to 0.0%; b76 the clatter stops dead (the song's one silence); Marx (M15): A FEW ESTABLISHED BIG
//                     CAPITALS, THE VITAL FLAME OF PRODUCTION WOULD BE ALTOGETHER EXTINGUISHED. with a pilot flame on the dead board
//                     that goes out on the hit; b88 POST-ECONOMICS.: the flaps fall off and leave empty sockets.
//   FREEZE (b92-139)  on the board: a wall of Hollerith file cards (Master Hands faces, Flint 1936) under growing frost, the beam a
//                     scanner (Farocki); Land's whole sentence; the dictatorship of finance takes up AI: a surveillance state, every
//                     citizen on file, to freeze the laws and the ruling ideas and hold its seat above the crisis; four ink stamps
//                     (SEALED, SO ORDERED, LICENSED, LOCKED) on the cards; Haz's reversal. No white sans, no clip-art objects.
//   TURN (b139-148)   THEY ARE THE LEAST POWERFUL. on the thunder; the lattice races under the ice; three cracks carry the
//                     three forces (post-economics runs away / into a race with China / and the crisis comes home).
//   MELT (b148-154)   MELTDOWN.: the frozen wall and the exchange come apart in chunks (October); MELT. / DOWN. (the one departure
//                     from the flaps: the metal running).
//   SEIZE (b154-184)  the machines lit and running at $0.00 under Land's line (the last dreams of top-down prediction and control,
//                     11.5 beats); the board re-forms as a planning room (Cybersyn's Opsroom): THE OPENING IS OURS, AS A CLASS.;
//                     THE AI THAT WATCHED PEOPLE / NOW PLANS PRODUCTION.; NOT A PREDICTION. A PLAN.; the Program, on the board.
//   NATIONALIZED.     (b184-187.5) the press stamp on the private nameplate; a crowd of the file wall's own faces rises (Klutsis).
//   PAYOFF (b187.5-202) the worker's hand (anatomical, built for v9) is rebuilt from the file wall's faces (Klutsis, 1930: the hand made
//                     of many hands) in ember light; it closes with a spray of light between the fingers (the v8 fist); the fist turns
//                     to its knuckles on b193 (THANK YOU, MONOPOLY.), four bars on the knuckles; SINCERELY, THE WORKING CLASS.; the bars
//                     go to light and burst into the ACP gear; b202 the lockup (1.4 s), dissolving back onto the hook board (loop).
import { W, H, C, loadFonts, loadBeats, BRAND, clamp, lerp, smooth, ease, rng, Finish, closer, outCanvas, acpEmblem, loadImage } from '../lib/kit.js';
import { CLOSERS } from '../lib/closer.js';
import * as PR from './meltdown8_print.js';
import { TILE, tile, flapRow, flapText, splitRows, Board, goodsRow, priceStr, machinePlates, warmPlate, Lattice, meter, charcoal, hsh, sm, mk, FLAPCH } from './meltdown8_flaps.js';
import * as TH from './meltdown8_things.js';
import { createHero } from './meltdown8_hero.js';
import { WORDS, CLOSE_B } from './meltdown8_words.js';
import { PICKUP, NOPICK, cardBoard, frameNow } from './meltdown8_cards.js';

const DEV = location.search.includes('dev');
const ctx = outCanvas();
await loadFonts();
const B = await loadBeats('meltdown8');
const SPB = B.spb, FPS = 30, TAU = Math.PI * 2;
const bt = b => b * SPB;
// v13: the scene is written in two spaces. Script, cards, the freeze, the new worlds and the payoff run in v13 beats (b);
// the worlds kept from v12 (the ledger, the merge, the search, the exchange, the lattice, the melt, the plan room) still
// think in v12 beats, and SEG maps a v13 beat to the v12 beat and time they were written for. TSHIFT is v13 time minus
// v12 time, so a v12 world's env() still reads the v13 song's hits.
let TSHIFT = 0;
const env = (n, t, r) => B.env(n, t + TSHIFT, r);
const SEG = [   // [v13 from, v13 to, kind, v12 from, v12 beats per v13 beat, hold b at v12 `holdTo`]
  [0, 8, 'old', 0, 1], [8, 12, 'story'], [12, 28, 'old', 8, 1], [28, 36, 'lenin'], [36, 44, 'old', 28, 1], [44, 52, 'old', 36, 0.5],
  [52, 56, 'old', 40, 1], [56, 60, 'old', 42, 0.5], [60, 66, 'old', 44, 1], [66, 68, 'old', 50, 1], [68, 76, 'old', 52, 0.5],
  [76, 88, 'old', 56, 8 / 12], [88, 92, 'old', 64, 1], [92, 139, 'freeze'], [139, 148, 'old', 91, 1], [148, 154, 'old', 100, 1],
  [154, 165.5, 'old', 106, 1, 109.49], [165.5, 180.5, 'old', 109.5, 11 / 15], [180.5, 184, 'old', 120.5, 1], [184, 187.5, 'old', 124, 1],
  [187.5, 202, 'old', 127.5, 1],
];
const SHOTS = [[0], [4], [6], [8], [12], [16], [20], [28], [32], [36], [44], [48], [52], [54], [56], [60], [62.5], [66], [68], [72], [76], [77], [80.5], [84], [88], [92], [98], [103], [106], [112], [115], [118], [123], [130], [139], [142], [144], [146], [148], [150], [151], [154], [159], [165.5], [170.5], [173.5], [176.5], [179.5], [180.5], [184], [187.5], [193], [196], [202]];   // the scene's shot table (v13 beats): every frame and every world change; scripts/shot_table.py reads it
const segAt = b => { for (const s of SEG) if (b >= s[0] - 1e-9 && b < s[1] - 1e-9) return s; return SEG[SEG.length - 1]; };
const cardNow = b => frameNow(WORDS, b, SPB);

function validate() {                                                   // advisory: frames whose beat has no song hit
  const hits = Object.values(B.hits).flat();
  const near = b => hits.some(h => Math.abs(h - bt(b)) <= 2 / FPS + 1e-4);
  const bad = [];
  for (const w of WORDS) if (!near(w[0])) bad.push(`frame @${w[0]} '${w[1].join(' ')}' has no song hit`);
  console.log(bad.length ? '[validator] ' + bad.join('; ') : '[validator] every frame lands on a hit');
}
validate();

// ================================================================ assets
const PLATE_W = 330, PLATE_H = 372;
const PLATES = await machinePlates(PLATE_W, PLATE_H, loadImage);
const LAT = new Lattice(7);
const FAC_GOLD = PR.facadeCanvas('gold', 1), FAC_ICE = PR.facadeCanvas('ice', 1);
const FACES = await Promise.all(['f_a160', 'mh_04', 'f_b240', 'mh_17', 'f_c220', 'mh_06', 'f_b254', 'mh_19', 'f_d330'].map(n => loadImage(`../assets/meltdown_faces/${n}.jpg`)));
// face crops: the head's centre and size in each source frame (fractions of the 640 x 480 frame), in the load order below
const FOCUS = [[0.42, 0.42, 0.62], [0.5, 0.42, 0.62], [0.66, 0.36, 0.5], [0.42, 0.4, 0.6], [0.4, 0.42, 0.62], [0.5, 0.5, 0.75], [0.3, 0.32, 0.55], [0.5, 0.4, 0.68], [0.36, 0.5, 0.7]];
// FACES order: f_a160 mh_04 f_b240 mh_17 f_c220 mh_06 f_b254 mh_19 f_d330 (mh_04 is the tall serious face, mh_17/19 the pair at the bench)
const faceCrop = (i, aspect, zoom = 1, jx = 0, jy = 0) => { const img = FACES[i], [fx, fy, fs] = FOCUS[i];
  const sh = Math.min(img.height, img.height * fs * zoom * 1.5), sw = Math.min(img.width, sh * aspect);
  return [clamp(fx * img.width - sw / 2 + jx * sw, 0, img.width - sw), clamp(fy * img.height - sh / 2 + jy * sh, 0, img.height - sh), sw, sh]; };
// the faces as a red duotone (the Klutsis crowd and the ember hand are made of them): grey, lifted, then the furnace tint
const FACE_T = FACES.map((img, i) => { const c = mk(120, 150), g = c.getContext('2d'), [sx, sy, sw, sh] = faceCrop(i, 120 / 150);
  g.filter = 'grayscale(1) contrast(1.15) brightness(1.45)'; g.drawImage(img, sx, sy, sw, sh, 0, 0, 120, 150); g.filter = 'none';
  g.globalCompositeOperation = 'multiply'; g.fillStyle = '#ff8a4a'; g.fillRect(0, 0, 120, 150); g.globalCompositeOperation = 'source-over'; return c; });
const HERO = location.search.includes('nohero') ? null : createHero(W, H, { scale: 1 });
const finish = new Finish(1917);

// scratch canvases
const L1 = mk(W, H), l1 = L1.getContext('2d');
const L2 = mk(W, H), l2 = L2.getContext('2d');
const clear = g => { g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none'; g.clearRect(0, 0, W, H); };
const fill = (g, c) => { g.fillStyle = c; g.fillRect(0, 0, W, H); };
function camera(g, s, cx = W / 2, cy = H / 2, rot = 0, dx = 0, dy = 0) { g.translate(cx + dx, cy + dy); g.rotate(rot); g.scale(s, s); g.translate(-cx, -cy); }
function shake(t, k = 1) { const e = env('kick', t, 12) * 0.6 + env('impact', t, 8) + env('slam', t, 10) * 1.4; return [Math.sin(t * 91) * 14 * e * k, Math.cos(t * 77) * 14 * e * k]; }

// ================================================================ small type helpers
// a source credit under a line: a small mono caption on a plate, so the quote carries its author
function cite(g, text, y, o = {}) {
  if (!text) return;
  g.save(); g.font = '30px "Michroma"'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = Math.min(W - 60, g.measureText(text).width + 54);
  g.fillStyle = o.plate || 'rgba(6,4,4,0.82)'; g.fillRect(W / 2 - w / 2, y - 27, w, 54);
  g.fillStyle = o.col || '#efe2c8'; g.globalAlpha = 0.92; g.fillText(text, W / 2, y + 2);
  g.restore();
}
// the frozen face: Anton in frosted white, the stencil's bridges cut, sprayed edge; rows share one size
function iceType(g, rows, cy, age, o = {}) {
  const maxW = W - 120; let em = o.size || 190;
  g.save(); g.font = `${em}px "Anton"`;
  const widest = () => Math.max(...rows.map(r => g.measureText(r).width));
  while (widest() > maxW && em > 60) { em -= 4; g.font = `${em}px "Anton"`; }
  g.restore();
  const lh = em * 1.02, hh = rows.length * lh;
  const c = mk(W, hh + 80), cg = c.getContext('2d'); cg.font = `${em}px "Anton"`; cg.textAlign = 'center'; cg.textBaseline = 'middle';
  cg.fillStyle = '#eef8ff'; rows.forEach((r, i) => cg.fillText(r, W / 2, 40 + lh * (i + 0.5) + em * 0.04));
  cg.globalCompositeOperation = 'destination-out';
  rows.forEach((r, i) => { const y = 40 + lh * (i + 0.5), w = cg.measureText(r).width; cg.fillRect(W / 2 - w / 2 - 6, y - em * 0.02, w + 12, em * 0.035);   // the horizontal cut
    let x = W / 2 - w / 2; for (const ch of r) { const cw = cg.measureText(ch).width; if (/[OQDBPRA0689]/.test(ch)) cg.fillRect(x + cw * 0.47, y - em * 0.5, cw * 0.07, em); x += cw; } });
  const R = rng(3); for (let i = 0; i < 1800; i++) { cg.globalAlpha = R() * 0.8; cg.fillRect(60 + R() * (W - 120), 30 + R() * (hh + 20), 1 + R() * 3, 1 + R() * 3); }
  const k = 1 + 0.07 * Math.exp(-age * 16);
  g.save(); g.translate(W / 2, cy); g.scale(k, k);
  g.fillStyle = 'rgba(2,14,28,0.74)'; g.fillRect(-W / 2 + 26, -hh / 2 - 20, W - 52, hh + 40);
  g.shadowColor = 'rgba(160,220,255,0.9)'; g.shadowBlur = 22; g.drawImage(c, -W / 2, -hh / 2 - 40); g.restore();
  return hh;
}
// ================================================================ the HOOK board (and the seam)
const MKT = Board.fit({ rows: 9, cols: 22, top: 1034, width: 1010, aspect: 1.55, gx: 2, gy: 8 });   // the market rows under the hook
const TOPB = Board.fit({ rows: 3, cols: 22, top: 122, width: 1010, aspect: 1.55, gx: 2, gy: 8 });   // above it
const HOOK = { tw: 96, th: 290, gap: 6, y1: 380 + 145, y2: 690 + 145 };
const MKT_ROW = (off) => (r, t) => goodsRow(r + off, Math.floor(t / 1.7 + hsh(r + off, 3) * 3));
function beamX(t, t0, dur) { return lerp(-80, W + 80, ((t - t0) / dur) % 1); }
function hookBoard(g, t, b, o = {}) {
  fill(g, '#060404');
  // the board's housing (one steel frame round everything): the columns are never cut off
  g.fillStyle = '#0d0a09'; g.fillRect(24, 96, W - 48, H - 170);
  g.strokeStyle = 'rgba(255,235,210,0.1)'; g.lineWidth = 4; g.strokeRect(30, 102, W - 60, H - 182);
  const mode = o.story ? 'machine' : b < 4 ? 'hook' : b < 6 ? 'price' : 'machine';
  const pinged = (r, c, bd) => { if (mode !== 'price') return 0; const bx = beamX(t, bt(4), bt(2) * 0.9), x = bd.cx(c) + bd.tw / 2; const d = bx - x; return d > 0 ? Math.exp(-d / 180) : 0; };
  const cellFn = (bd, off) => (r, c, tt, ch) => {
    if (mode === 'machine') return null;
    const p = pinged(r, c, bd), hit = hsh(r * 31 + c + off, 9) < 0.55;
    if (p > 0.02 && hit && c >= 8) return { pal: TILE.hot, lit: p };
    return c < 7 ? { pal: TILE.dim } : undefined;
  };
  TOPB.draw(g, t, MKT_ROW(40), { clatter: t > 0.07, cell: cellFn(TOPB, 1) });
  MKT.draw(g, t, MKT_ROW(0), { clatter: t > 0.07, cell: cellFn(MKT, 2) });
  if (mode === 'machine') machineGrid(g, t, bt(6));
  // the big flaps: THANK YOU, / MONOPOLY. -> EVERY / PRICE. -> EVERY / MACHINE.
  if (!o.story) {
  const [r1, r2] = mode === 'hook' ? ['THANK YOU,', 'MONOPOLY.'] : mode === 'price' ? ['EVERY', 'PRICE.'] : ['EVERY', 'MACHINE.'];
  const t0 = mode === 'hook' ? -1 : (mode === 'price' ? bt(4) : bt(6)) - 0.12;   // pre-rolled: the word is readable on the hit frame
  const k = mode === 'hook' ? 1 : 1 + 0.05 * Math.exp(-(t - t0) * 14);
  g.save(); camera(g, k, W / 2, 680);
  g.fillStyle = '#050303'; g.fillRect(28, 356, W - 56, 648);
  flapRow(g, r1.padEnd(10).slice(0, 10), W / 2, HOOK.y1, HOOK.tw, HOOK.th, { gap: HOOK.gap, pal: TILE.cream, t, t0, stagger: 0.007, dur: 0.06 });
  const w2 = r2.length > 9 ? r2 : r2.padEnd(9);
  flapRow(g, w2, W / 2, HOOK.y2, HOOK.tw, HOOK.th, { gap: HOOK.gap, pal: mode === 'price' ? TILE.cream : TILE.creamRed, t, t0: t0 + 0.01, stagger: 0.007, dur: 0.06 });
  g.restore();
  }
  if (mode === 'price') {                                            // the search beam
    const bx = beamX(t, bt(4), bt(2) * 0.9);
    g.save(); g.globalCompositeOperation = 'lighter';
    const gr = g.createLinearGradient(bx - 300, 0, bx + 20, 0); gr.addColorStop(0, 'rgba(60,110,255,0)'); gr.addColorStop(0.85, 'rgba(90,150,255,0.25)'); gr.addColorStop(1, 'rgba(210,230,255,0.9)');
    g.fillStyle = gr; g.fillRect(bx - 300, 96, 320, H - 170); g.fillStyle = 'rgba(240,248,255,0.95)'; g.fillRect(bx - 3, 96, 5, H - 170);
    for (let k2 = 0; k2 < 5; k2++) { const te = bt(4) + k2 * bt(0.4), a = t - te; if (a < 0 || a > 0.8) continue; const x = beamX(te, bt(4), bt(2) * 0.9), y = 1100 + hsh(k2, 4) * 650;
      g.strokeStyle = `rgba(255,50,60,${0.9 * (1 - a / 0.8)})`; g.lineWidth = 6 * (1 - a); g.beginPath(); g.arc(x, y, 20 + a * 480, 0, TAU); g.stroke(); }
    g.restore();
  }
}
// b6: the cells flip to machine plates (a 3 x 2 grid under the big flaps and a strip above), each one a big flap
function machineGrid(g, t, t0, o = {}) {
  const warm = o.warm, rows = o.rows || [[1034, 3, 372], [1422, 3, 372]], top = o.top ?? [122, 4, 226];
  const all = [top, ...rows];
  let i = 0;
  for (const [y, n, h] of all) {
    const gw = 1010, w = Math.floor((gw - (n - 1) * 8) / n), x0 = W / 2 - gw / 2;
    for (let c = 0; c < n; c++, i++) {
      const p = PLATES[(i * 5 + (o.shift || 0)) % PLATES.length], img = warm ? warmPlate(p) : p.plate;
      const x = x0 + c * (w + 8), a = t - t0 - i * 0.008;
      g.fillStyle = '#0b0808'; g.fillRect(x, y, w, h);
      if (a < 0) continue;
      const sw = Math.min(img.width, img.height * w / h), sh = sw * h / w, sx = (img.width - sw) / 2, sy = (img.height - sh) / 2 + (o.pan ? Math.sin(t * 0.8 + i) * 10 : 0);
      g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
      if (a < 0.1) { const u = a / 0.1, s = Math.abs(Math.cos(u * Math.PI)); g.drawImage(img, sx, sy, sw, sh / 2, x, y, w, h / 2);
        g.fillStyle = '#1b1616'; g.fillRect(x, y + h / 2, w, h / 2); g.translate(0, y + h / 2); g.scale(1, u < 0.5 ? -s : s); g.fillStyle = '#2a2020'; g.fillRect(x, u < 0.5 ? 0 : 0, w, h / 2); }
      else g.drawImage(img, sx, sy, sw, sh, x, y, w, h);
      g.restore();
      if (warm && o.running) running(g, x, y, w, h, t, i);
      g.fillStyle = 'rgba(0,0,0,0.85)'; g.fillRect(x, y + h / 2 - 1.5, w, 3);
      if (o.zeroTag) { const tw = 30, th = 48; flapRow(g, '$0.00', x + w - 5 * (tw + 3) / 2 - 10, y + h - th / 2 - 10, tw, th, { gap: 3, pal: TILE.red }); }
    }
  }
}
function running(g, x, y, w, h, t, i) {                               // the machines lit and running: sparks, glow, motion
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.globalCompositeOperation = 'lighter';
  const R = rng(i * 17 + 3);
  for (let k = 0; k < 26; k++) { const ph = (R() + t * (0.5 + R())) % 1, sx = x + w * (0.3 + R() * 0.4), sy = y + h * (0.3 + R() * 0.3);
    g.fillStyle = `rgba(255,${200 + R() * 55 | 0},120,${1 - ph})`; g.fillRect(sx + (R() - 0.5) * 160 * ph, sy + ph * ph * 200 - 40 * ph, 3, 3); }
  const pulse = 0.5 + 0.5 * Math.sin(t * 6 + i);
  const gr = g.createRadialGradient(x + w / 2, y + h * 0.55, 5, x + w / 2, y + h * 0.55, w * 0.7); gr.addColorStop(0, `rgba(255,150,60,${0.35 * pulse})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(x, y, w, h); g.restore();
}

// ================================================================ WHY / ZERO: the ledger (Vertov): WORKERS / MACHINES / PROFIT
// Profit comes from workers. The rows that move are the workers (falling) and the machines (climbing); PROFIT falls with the
// workers and never rises. b8-20 the rate falls (so the big capitals merge); b52-56 AI takes the rest: WORKERS 0, PROFIT 0.0%.
// Numbers are texture (illustrative). Flaps flip only between real values (the old glyph shows on the flip, never noise).
const LED = { tw: 62, th: 126, gap: 5, y0: 730, pitch: 158 };
const SCHED = [
  ['WORKERS', [[8, '1,000'], [12, '700'], [16, '400'], [53, '220'], [54, '90'], [55, '20'], [56, '0']]],
  ['MACHINES', [[8, '10'], [12, '40'], [16, '90'], [53, '200'], [54, '420'], [55, '760'], [56, '990']]],
  ['PROFIT', [[8, '16.7%'], [12, '12.1%'], [16, '7.9%'], [53, '5.6%'], [54, '3.1%'], [55, '0.9%'], [56, '0.0%']]],
];
function ledgerAt(row, b) {
  const s = SCHED[row][1]; let k = -1; for (let i = 0; i < s.length; i++) if (b >= s[i][0] - 1e-6) k = i;
  if (k < 0) return [s[0][1], ' ', -9]; const prev = k > 0 ? s[k - 1][1] : ' ';
  return [s[k][1], prev, bt(s[k][0])];
}
function ledger(g, t, b) {
  g.fillStyle = '#0b0808'; g.fillRect(28, LED.y0 - 96, W - 56, LED.pitch * 3 + 40);
  const dead = b >= 56;
  for (let r = 0; r < 3; r++) {
    const [val, prev, t0] = ledgerAt(r, b);
    const y = LED.y0 + r * LED.pitch, active = t - t0 >= 0 && t - t0 < bt(0.9) && val !== prev;
    const zero = dead && (r === 0 || r === 2);
    const lab = SCHED[r][0].padEnd(9), v = val.padStart(6), s = lab + v, n = s.length, wAll = n * LED.tw + (n - 1) * LED.gap, x0 = W / 2 - wAll / 2;
    const pv = prev.padStart(6);
    if (active) { g.fillStyle = 'rgba(200,20,30,0.30)'; g.fillRect(x0 - 12, y - LED.th / 2 - 10, wAll + 24, LED.th + 20); }
    for (let i = 0; i < n; i++) {
      const isVal = i >= 9, x = x0 + i * (LED.tw + LED.gap);
      let flip = -1, pch = ' ';
      if (isVal) { const a = t - t0 - (i - 9) * 0.012; if (a >= 0 && a < 0.07 && s[i] !== pv[i - 9]) { flip = a / 0.07; pch = pv[i - 9]; } }
      tile(g, x, y - LED.th / 2, LED.tw, LED.th, s[i], isVal ? (zero ? TILE.hot : TILE.dark) : TILE.dim, { flip, prev: pch });
    }
  }
}
const MFIELD = Board.fit({ rows: 7, cols: 22, top: 1270, width: 1010, aspect: 1.5, gx: 2, gy: 8 });
const CURVE = [[bt(8) - 0.05, 0.14], [bt(12) - 0.05, 0.38], [bt(16) - 0.05, 0.6], [bt(52) - 0.05, 0.62], [bt(53) - 0.05, 0.76], [bt(54) - 0.05, 0.88], [bt(55) - 0.05, 0.96], [bt(56) - 0.05, 1.0]];
function ledgerWorld(g, t, b) {
  fill(g, '#060404');
  const [sx, sy] = shake(t, 0.5);
  g.save(); g.translate(sx, sy);
  const dead = b >= 56, u = clamp((b - 57) / 5);                         // b56: WORKERS 0, the clatter stops dead; the market then goes blank cell by cell
  MFIELD.draw(g, t, (r, tt) => goodsRow(r + 3, Math.floor(tt / 1.4)), { clatter: !dead, pal: TILE.dark, cell: (r, c) => {
    if (dead && hsh(r * 22 + c, 4) < u) return { ch: ' ' };
    return c < 7 ? { pal: TILE.dim } : undefined; } });
  // the profit-rate curve, wax pencil on the board's top glass: redrawn lower on each kick, the ghosts kept (Kentridge)
  g.fillStyle = '#0d0a09'; g.fillRect(28, 96, W - 56, 470); g.strokeStyle = 'rgba(255,235,210,0.12)'; g.lineWidth = 3; g.strokeRect(36, 104, W - 72, 454);
  g.strokeStyle = 'rgba(255,235,210,0.05)'; g.lineWidth = 1; for (let k = 1; k < 6; k++) { g.beginPath(); g.moveTo(40, 104 + k * 75); g.lineTo(W - 40, 104 + k * 75); g.stroke(); }
  charcoal(g, t, CURVE, [70, 140, 1010, 540]);
  g.save(); g.font = '30px "Michroma"'; g.fillStyle = 'rgba(239,226,200,0.55)'; g.textAlign = 'left'; g.fillText('RATE OF PROFIT', 66, 134); g.restore();
  g.save(); g.globalCompositeOperation = 'lighter'; const gl = g.createLinearGradient(0, 300, W, 1500); gl.addColorStop(0.35, 'rgba(255,255,255,0)'); gl.addColorStop(0.45, 'rgba(255,255,255,0.05)'); gl.addColorStop(0.5, 'rgba(255,255,255,0)'); g.fillStyle = gl; g.fillRect(0, 0, W, H); g.restore();
  ledger(g, t, b);
  g.restore();
}
// b64 POST-ECONOMICS.: the flaps fall off the board and leave empty sockets
function socketsWorld(g, t, b) {
  fill(g, '#0c0908');
  const a = t - bt(64);
  g.fillStyle = '#3a3230'; g.fillRect(28, 520, W - 56, 1350);
  { const rk = g.createLinearGradient(0, 400, 0, H); rk.addColorStop(0, 'rgba(255,225,190,0.22)'); rk.addColorStop(1, 'rgba(0,0,0,0.3)'); g.fillStyle = rk; g.fillRect(28, 520, W - 56, 1350); }
  const bd = MFIELD;
  for (let r = 0; r < bd.rows; r++) for (let c = 0; c < bd.cols; c++) {
    const x = bd.cx(c), y = bd.cy(r);
    g.fillStyle = '#020101'; g.fillRect(x + 2, y + 2, bd.tw - 4, bd.th - 4); g.fillStyle = '#3a3230'; g.fillRect(x + bd.tw / 2 - 2, y + 4, 4, 4); g.fillRect(x + bd.tw / 2 - 2, y + bd.th - 8, 4, 4);
  }
  for (let r = 0; r < 3; r++) for (let i = 0; i < 15; i++) { const n = 15, x = W / 2 - (n * LED.tw + (n - 1) * LED.gap) / 2 + i * (LED.tw + LED.gap), y = LED.y0 + r * LED.pitch - LED.th / 2; g.fillStyle = '#020101'; g.fillRect(x + 3, y + 3, LED.tw - 6, LED.th - 6); }
  { const gl = g.createRadialGradient(W / 2, 200, 20, W / 2, 700, 1500); gl.addColorStop(0, 'rgba(255,230,190,0.28)'); gl.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gl; g.fillRect(0, 0, W, H); }
  const R = rng(48);
  for (let k = 0; k < 160; k++) {                                        // the flaps falling, tumbling
    const r = Math.floor(R() * bd.rows), c = Math.floor(R() * bd.cols), d = R() * 0.5, aa = a - d; if (aa < 0) { tile(g, bd.cx(c), bd.cy(r), bd.tw, bd.th, ' ', TILE.dark); continue; }
    const y = bd.cy(r) + 0.5 * 2600 * aa * aa, x = bd.cx(c) + (R() - 0.5) * 200 * aa; if (y > H + 100) continue;
    g.save(); g.translate(x + bd.tw / 2, y + bd.th / 2); g.rotate((R() - 0.5) * 8 * aa); tile(g, -bd.tw / 2, -bd.th / 2, bd.tw, bd.th, ' ', TILE.dark); g.restore();
  }
}

// ================================================================ MERGE: the Bass bars (b20-24)
// 37 rows; groups of the 4 survivors and the 1; each slam lands ON its hit (b20 / b21 / b22)
const NROW = 37, G4 = [9, 10, 9, 9], M0 = 20;
function mergeLayout(b) {                                             // b relative to the merge start -> [{y, h, col}] bars on screen
  const top = 520, bot = 1820, span = bot - top;
  const thin = i => { const p = span / NROW; return [top + i * p + 3, p - 6]; };
  const four = k => { const p = span / 4; return [top + k * p + 10, p - 20]; };
  const one = () => [top + span * 0.38, span * 0.24];
  const slam = (b0, b1) => ease.inExpo(clamp((b - b0) / (b1 - b0)));     // accelerate into the hit, stop dead on it
  const out = [];
  let gi = 0, gk = 0;
  for (let i = 0; i < NROW; i++) {
    if (gi >= G4[gk]) { gk++; gi = 0; }
    const A = thin(i), Bq = four(gk), Cq = one();
    let y, h;
    if (b < 0.5) [y, h] = A;
    else if (b < 1) { const u = slam(0.5, 1); y = lerp(A[0], Bq[0] + (gi / G4[gk]) * Bq[1], u); h = lerp(A[1], Bq[1] / G4[gk], u); }
    else if (b < 1.5) { y = Bq[0] + (gi / G4[gk]) * Bq[1]; h = Bq[1] / G4[gk] + 1; }
    else if (b < 2) { const u = slam(1.5, 2), yb = Bq[0] + (gi / G4[gk]) * Bq[1], hb = Bq[1] / G4[gk] + 1; y = lerp(yb, Cq[0] + (i / NROW) * Cq[1], u); h = lerp(hb, Cq[1] / NROW + 1, u); }
    else { y = Cq[0] + (i / NROW) * Cq[1]; h = Cq[1] / NROW + 1; }
    out.push({ y, h, i, g: gk, dead: false, first: gi === 0 });
    gi++;
  }
  return out;
}
function mergeWorld(g, t, b) {
  const m = b - M0;
  fill(g, '#efe3cc');                                                 // Bass: paper, black, one red
  const [sx, sy] = shake(t, 1.2);
  g.save(); g.translate(sx, sy);
  const bars = mergeLayout(m);
  const tone = (bar) => m >= 2 ? '#c4101f' : m >= 1 ? (bar.g % 2 ? '#141010' : '#c4101f') : (bar.i % 3 === 0 ? '#c4101f' : '#141010');
  for (const bar of bars) {
    g.fillStyle = tone(bar); g.fillRect(60, bar.y, W - 120, bar.h);
    if (bar.h > 14) { g.fillStyle = 'rgba(255,255,255,0.08)'; for (let c = 0; c < 22; c++) g.fillRect(70 + c * 44, bar.y + 4, 38, bar.h - 8); }
  }
  for (const hb of [1, 2]) { const a = t - bt(M0 + hb); if (a >= 0 && a < 0.25) { g.globalCompositeOperation = 'lighter'; g.fillStyle = `rgba(255,255,255,${0.8 * (1 - a / 0.25)})`;
    for (const bar of bars) if (bar.first) g.fillRect(40, bar.y - 6, W - 80, 10); g.globalCompositeOperation = 'source-over'; } }
  g.restore();
  // the counter: two big flaps, 37 -> 4 -> 1, slammed on each sub
  const n = m < 1 ? '37' : m < 2 ? ' 4' : ' 1', t0 = m < 1 ? bt(M0) : m < 2 ? bt(M0 + 1) : bt(M0 + 2);
  const k = 1 + 0.1 * Math.exp(-(t - t0) * 14);
  g.save(); camera(g, k, W / 2, 290);
  g.fillStyle = '#141010'; g.fillRect(W / 2 - 250, 110, 500, 360);
  flapRow(g, n, W / 2, 290, 190, 300, { gap: 14, pal: TILE.red, t, t0, stagger: 0.02, dur: 0.08 });
  g.restore();
}

// ================================================================ INDEX / SEARCH: the one row spells Lenin (b24), then the beam runs (b28-36)
const FIELD = Board.fit({ rows: 26, cols: 30, top: 1000, width: 1060, aspect: 1.5, gx: 2, gy: 5 });
// the index row scrolls real goods and tickers, letter by letter: a flap only ever flips between real letters (no noise strings)
const IDX_TEXT = 'STEEL   WHEAT   CHIPS   POWER   RENT   OIL   CORN   COPPER   FREIGHT   INSULIN   LUMBER   CEMENT   COTTON   NICKEL   SUGAR   COAL   ';
function indexRow(g, t) {
  const n = 16, tw = 44, th = 118, x0 = 300, y0 = 836, pos = (t - bt(28)) * 7, base = Math.floor(pos), fr = pos - base;
  for (let i = 0; i < n; i++) {
    const ch = IDX_TEXT[(base + i) % IDX_TEXT.length], pv = IDX_TEXT[(base + i - 1 + IDX_TEXT.length) % IDX_TEXT.length];
    tile(g, x0 + i * (tw + 2), y0, tw, th, ch, TILE.red, { flip: fr < 0.5 && ch !== pv ? fr / 0.5 : -1, prev: pv });
  }
}
function indexWorld(g, t, b) {
  fill(g, '#060404');
  const scroll = (t - bt(28)) * 90, zoom = b < 32 ? 1 : 1 - 0.18 * ease.inOutCubic(clamp((b - 32) / 4));
  g.save(); camera(g, zoom, W / 2, 900);
  g.save(); g.beginPath(); g.rect(0, 1000, W, H); g.clip(); g.translate(0, -(scroll % (FIELD.th + FIELD.gy)));
  FIELD.draw(g, t, (r, tt) => goodsRow(r + Math.floor(scroll / (FIELD.th + FIELD.gy)), Math.floor(tt / 1.2 + r)).padEnd(30), { clatter: true, cell: (r, c) => c < 7 ? { pal: TILE.dim } : undefined });
  g.restore();
  g.save(); g.beginPath(); g.rect(0, 96, W, 704); g.clip(); g.translate(0, -904 + (scroll % (FIELD.th + FIELD.gy)));
  FIELD.draw(g, t, (r, tt) => goodsRow(r + 40 - Math.floor(scroll / (FIELD.th + FIELD.gy)), Math.floor(tt / 1.2 + r)).padEnd(30), { clatter: true, cell: (r, c) => c < 7 ? { pal: TILE.dim } : undefined });
  g.restore();
  const by = 100 + ((t - bt(28)) / bt(2) % 1) * 1800;                   // the beam, a horizontal sheet running down the whole board
  g.save(); g.globalCompositeOperation = 'lighter'; const gr = g.createLinearGradient(0, by - 260, 0, by + 10);
  gr.addColorStop(0, 'rgba(60,110,255,0)'); gr.addColorStop(0.9, 'rgba(90,150,255,0.3)'); gr.addColorStop(1, 'rgba(230,240,255,0.95)'); g.fillStyle = gr; g.fillRect(0, by - 260, W, 270); g.restore();
  g.fillStyle = '#0a0606'; g.fillRect(0, 800, W, 190);
  g.fillStyle = '#c4101f'; g.fillRect(20, 820, W - 40, 150);
  indexRow(g, t);
  TH.nameplate(g, 30, 850, 262, 90);
  for (let k = 0; k < 14; k++) {                                       // cells flying up from the beam into the row (real glyphs)
    const ph = (t * 1.3 + k / 14) % 1, x0 = 60 + hsh(k, 3) * 960, y = lerp(by, 900, ease.inCubic(ph)), x = lerp(x0, 320 + hsh(k, 4) * 700, ph);
    tile(g, x, y, 34 * (1 - ph * 0.5), 52 * (1 - ph * 0.5), FLAPCH[(k * 5 + Math.floor(t * 3)) % 26], TILE.hot, { lit: 1 - ph });
  }
  g.restore();
}

// ================================================================ FINANCE: the exchange, the pour, the lattice, the loss (b36-52)
function financeWorld(g, t, b) {
  const [sx, sy] = shake(t, 0.6);
  fill(g, '#070402');
  g.save(); g.translate(sx, sy);
  if (b < 42) {
    const u = b - 36, push = 1 + u * 0.02;
    g.save(); camera(g, push, W / 2, 1100);
    const gl = g.createRadialGradient(W / 2, 1500, 20, W / 2, 1300, 900); gl.addColorStop(0, 'rgba(255,150,40,0.35)'); gl.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gl; g.fillRect(0, 0, W, H);
    PR.placeFacade(g, FAC_GOLD, W / 2, 1300, 1000);
    const tick = '$690,000,000,000';
    g.fillStyle = '#0a0602'; g.fillRect(W / 2 - 505, 880, 1010, 104);
    flapRow(g, tick, W / 2, 932, 56, 86, { gap: 4, pal: TILE.gold, t, t0: bt(36), stagger: 0.015, dur: 0.1 });
    if (b >= 39.5) PR.pour(g, t, 1400, clamp((b - 39.5) * 3));
    g.restore();
  } else if (b < 44) {                                                  // AI.: the pour becomes the lattice
    const u = b - 42; PR.pour(g, t, -100, clamp(1 - u * 1.5));
    LAT.draw(g, t, { yaw: t * 0.5, pitch: 0.3, dist: 34 - u * 4, cx: W / 2, cy: 1180, think: 1.5, alpha: clamp(u * 3 + 0.3) });
  } else {                                                              // RAN AT A LOSS.: the loss row chars
    LAT.draw(g, t, { yaw: t * 0.5, pitch: 0.3, dist: 30, cx: W / 2, cy: 1200, think: 2, alpha: 0.5 });
    burnRow(g, t, b);
  }
  g.restore();
}
function burnRow(g, t, b) {
  const s = '-14,000,000,000', a = t - bt(44), y = 1250;
  g.fillStyle = '#0a0202'; g.fillRect(20, y - 110, W - 40, 220);
  flapRow(g, s, W / 2, y, 62, 170, { gap: 4, pal: TILE.loss, t, t0: bt(44), stagger: 0.02, dur: 0.08 });
  const heat = clamp(a / 0.6);
  g.save(); g.globalCompositeOperation = 'lighter'; const R = rng(26);
  for (let i = 0; i < 90; i++) { const x = 40 + R() * (W - 80), ph = (R() + t * (0.4 + R() * 0.6)) % 1, yy = y - 90 - ph * 420 * R();
    g.fillStyle = `rgba(255,${120 + R() * 100 | 0},40,${heat * (1 - ph)})`; g.fillRect(x + Math.sin(t * 3 + i) * 20 * ph, yy, 3 + R() * 3, 3 + R() * 3); }
  const eg = g.createLinearGradient(0, y - 110, 0, y + 110); eg.addColorStop(0, `rgba(255,120,20,${0.5 * heat})`); eg.addColorStop(0.2, 'rgba(0,0,0,0)'); eg.addColorStop(0.8, 'rgba(0,0,0,0)'); eg.addColorStop(1, `rgba(255,120,20,${0.5 * heat})`);
  g.fillStyle = eg; g.fillRect(20, y - 110, W - 40, 220); g.restore();
  g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = `rgba(40,10,5,${0.5 * heat})`;
  for (let c = 0; c < 15; c++) { const x = W / 2 - 15 * 33 + c * 66; g.fillRect(x, y - 85, 62, 10 + 18 * hsh(c, 2) * heat); g.fillRect(x, y + 75 - 18 * hsh(c, 3) * heat, 62, 12 + 18 * hsh(c, 3) * heat); }
  g.restore();
}
const LAT_CUTS = [[50, 0.6, 0.1, 22], [50.5, 2.2, 0.9, 34], [51, -1.0, -0.4, 16], [51.5, 3.5, 0.3, 40]];
function latticeWorld(g, t, b) {
  fill(g, '#050201');
  let k = LAT_CUTS[0]; for (const c of LAT_CUTS) if (b >= c[0]) k = c;
  const u = b - k[0];
  LAT.draw(g, t, { yaw: k[1] + u * 0.6, pitch: k[2], dist: k[3] - u * 3, cx: W / 2, cy: 960, think: 2 + (b - 50) * 0.8, focal: 1200 });
}

// ================================================================ FREEZE: the wall of files (Farocki, Eye/Machine), under growing ice
// The board's search beam, which indexed every price, is now a scanner over the citizen file: rows of cards, each a face (the
// public-domain Master Hands toolmakers, Flint 1936), redacted lines and a barcode; reticles lock onto faces.
const FW = { cols: 4, rows: 5, cw: 250, ch: 330, gx: 12, gy: 16, x0: 22, y0: 128 };
const FCARDS = (() => {                                                // Hollerith cards: a cream card, clipped corner, the face, printed numbers, punched holes (Census tabulating rooms, 1890-1940)
  const out = [];
  for (let i = 0; i < FW.cols * FW.rows; i++) {
    const c = mk(FW.cw, FW.ch), g = c.getContext('2d'), R = rng(500 + i);
    g.fillStyle = '#e4d7ba'; g.beginPath(); g.moveTo(34, 0); g.lineTo(FW.cw, 0); g.lineTo(FW.cw, FW.ch); g.lineTo(0, FW.ch); g.lineTo(0, 34); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(120,20,20,0.55)'; g.lineWidth = 2; g.beginPath(); g.moveTo(8, 240); g.lineTo(FW.cw - 8, 240); g.stroke();
    const fi = (i * 7 + Math.floor(i / 4)) % FACES.length, img = FACES[fi], pw = FW.cw - 24, ph = 206;
    const [sx, sy, sw, sh] = faceCrop(fi, pw / ph, 1.05 + R() * 0.3, (R() - 0.5) * 0.2, (R() - 0.5) * 0.1);
    g.save(); g.beginPath(); g.rect(12, 34, pw, ph); g.clip(); g.filter = 'grayscale(1) contrast(1.2)'; g.drawImage(img, sx, sy, sw, sh, 12, 34, pw, ph); g.filter = 'none';
    g.globalCompositeOperation = 'multiply'; g.fillStyle = '#d9c9a4'; g.fillRect(12, 34, pw, ph); g.restore();
    g.strokeStyle = 'rgba(40,30,20,0.5)'; g.lineWidth = 2; g.strokeRect(12, 34, pw, ph);
    g.fillStyle = 'rgba(40,20,16,0.85)'; g.font = '15px "Michroma"'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(String(1000 + Math.floor(R() * 8999)) + ' ' + String(10 + Math.floor(R() * 89)) + ' ' + String(100 + Math.floor(R() * 899)), 44, 16);
    g.fillStyle = '#0a0807'; for (let r = 0; r < 5; r++) for (let k = 0; k < 40; k++) if (R() < 0.3) g.fillRect(12 + k * 5.6, 250 + r * 14, 3.6, 8);   // the punched holes
    g.fillStyle = 'rgba(40,20,16,0.6)'; for (let k = 0; k < 40; k++) g.fillRect(12 + k * 5.6, 322, 3.6, 2);
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(34, 1); g.lineTo(1, 34); g.stroke();
    out.push(c);
  }
  return out;
})();
function fileWall(g, t, b, o = {}) {
  fill(g, '#070505');
  g.fillStyle = '#100c0a'; g.fillRect(12, 96, W - 24, H - 150);
  const t0 = o.t0 ?? bt(92), rowsY = [];
  for (let r = 0; r < FW.rows; r++) for (let c = 0; c < FW.cols; c++) {
    const a = clamp((t - t0 - r * 0.09) / 0.14); if (a <= 0) continue;
    const x = FW.x0 + c * (FW.cw + FW.gx), y = FW.y0 + r * (FW.ch + FW.gy), k = 1 + (1 - a) * 0.25;
    g.save(); g.globalAlpha = a; g.translate(x + FW.cw / 2, y + FW.ch / 2); g.scale(k, k); g.drawImage(FCARDS[r * FW.cols + c], -FW.cw / 2, -FW.ch / 2); g.restore();
    if (c === 0) rowsY.push(y + FW.ch);
  }
  if (o.scan !== false) {                                              // the scanner: a sweep and reticles that lock onto faces
    const by = FW.y0 + ((t - t0) / bt(2) % 1) * (FW.rows * (FW.ch + FW.gy));
    g.save(); g.globalCompositeOperation = 'lighter'; const gr = g.createLinearGradient(0, by - 240, 0, by + 6);
    gr.addColorStop(0, 'rgba(60,110,255,0)'); gr.addColorStop(0.9, 'rgba(90,150,255,0.22)'); gr.addColorStop(1, 'rgba(230,240,255,0.95)'); g.fillStyle = gr; g.fillRect(12, by - 240, W - 24, 246); g.restore();
    const step = Math.floor((t - t0) / bt(0.5));
    for (let k = 0; k < 3; k++) {
      const idx = Math.floor(hsh(step + k * 17, 5) * FW.cols * FW.rows), r = Math.floor(idx / FW.cols), c = idx % FW.cols;
      const x = FW.x0 + c * (FW.cw + FW.gx) + 12, y = FW.y0 + r * (FW.ch + FW.gy) + 34, w = FW.cw - 24, h = 206, L = 40, age = ((t - t0) / bt(0.5)) % 1;
      const s = 1 + 0.12 * (1 - Math.min(1, age * 3));
      g.save(); g.translate(x + w / 2, y + h / 2); g.scale(s, s); g.strokeStyle = '#ff2a3a'; g.lineWidth = 6;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const px = sx * w / 2, py = sy * h / 2; g.beginPath(); g.moveTo(px, py - sy * L); g.lineTo(px, py); g.lineTo(px - sx * L, py); g.stroke(); }
      g.restore();
    }
  }
  TH.frost(g, 12, 96, W - 24, H - 150, o.frost ?? 0.3, rowsY, 5);
}
// v13 FREEZE (b92-139), on the board: the wall of Hollerith file cards under growing frost. The four stamps are ink on the cards.
const STAMPS = [[119, 'SEALED', 300, 250, -0.12, 140], [121.5, 'SO ORDERED', 720, 420, 0.06, 108], [124, 'LICENSED', 600, 660, 0.09, 122], [126.5, 'LOCKED', 300, 860, -0.05, 150]];
function inkStamp(g, text, cx, cy, rot, age, size) {                    // a red rubber-stamp impression on a card: slammed, double rule, ink breaking at the edges
  if (age < 0) return;
  const k = age < 0.07 ? lerp(1.9, 1, ease.inCubic(age / 0.07)) : 1 + 0.02 * Math.exp(-(age - 0.07) * 9);
  g.save(); g.translate(cx, cy); g.rotate(rot); g.scale(k, k);
  g.font = `${size}px "Anton"`; const w = g.measureText(text).width + 60, h = size * 1.18;
  const c = mk(w + 30, h + 30), cg = c.getContext('2d'); cg.font = `${size}px "Anton"`; cg.textAlign = 'center'; cg.textBaseline = 'middle';
  cg.strokeStyle = '#c4101f'; cg.lineWidth = 9; cg.strokeRect(15, 15, w, h); cg.lineWidth = 3; cg.strokeRect(27, 27, w - 24, h - 24);
  cg.fillStyle = '#c4101f'; cg.fillText(text, 15 + w / 2, 15 + h / 2 + size * 0.04);
  cg.globalCompositeOperation = 'destination-out'; const R = rng(text.length * 7 + 1);
  for (let i = 0; i < 900; i++) { cg.globalAlpha = 0.25 + R() * 0.7; cg.fillRect(R() * (w + 30), R() * (h + 30), 1 + R() * 4, 1 + R() * 3); }
  g.globalAlpha = age < 0.03 ? 0.55 : 0.93; g.drawImage(c, -(w + 30) / 2, -(h + 30) / 2); g.restore();
}
function freezeBoard(g, t, b) {
  const f = b - 92, [sx, sy] = shake(t, 0.5);
  g.save(); camera(g, 1 + 0.035 * clamp(f / 47), W / 2, 700, 0, sx * 0.4, sy * 0.4);
  fileWall(g, t, b, { t0: bt(92), frost: lerp(0.08, 0.95, smooth(2, 40, f)) });
  for (const [sb, txt, x, y, rot, size] of STAMPS) inkStamp(g, txt, x, y, rot, t - bt(sb), size);
  g.restore();
  const gr = g.createLinearGradient(0, 900, 0, 1000); gr.addColorStop(0, 'rgba(6,4,4,0)'); gr.addColorStop(1, 'rgba(6,4,4,0.9)'); g.fillStyle = gr; g.fillRect(0, 900, W, H - 900);   // the wall darkens where the type sits
}
function freezeWorld(g, t, b) {
  // b91-100 TURN: the lattice races under the ice; the light breaks out; three cracks (the three bars of the equals sign)
  fileWall(g, t, b, { frost: 1, scan: false, t0: -10 });
  clear(l2); LAT.draw(l2, t, { yaw: t * (b < 94 ? 1.2 : 2), pitch: 0.2, dist: 26, cx: W / 2, cy: 960, col: b < 94 ? 'ice' : 'gold', think: 3 + (b - 91) * 1.2, alpha: b < 94 ? 0.8 : 1 });
  g.save(); g.globalCompositeOperation = 'lighter'; g.filter = b < 94 ? 'blur(8px)' : 'blur(2px)'; g.drawImage(L2, 0, 0); g.filter = 'none'; g.drawImage(L2, 0, 0); g.restore();
  const open = [94, 96, 98].map(x => clamp((t - bt(x)) / 0.25));
  const dark = b >= 99 && b < 100;
  if (dark) { g.fillStyle = 'rgba(0,0,0,0.88)'; g.fillRect(0, 0, W, H); }
  TH.cracks(g, [760, 960, 1160], open, b >= 94 ? 0.6 + (b >= 98 ? 0.5 : 0) + env('crack', t, 8) : 0, t, 40, W - 40);
  if (b >= 94 && b < 96) { const u = clamp((t - bt(94)) / 0.4); g.save(); g.globalCompositeOperation = 'lighter';
    const gr = g.createRadialGradient(W / 2, 960, 10, W / 2, 960, 900 * u + 50); gr.addColorStop(0, `rgba(255,220,150,${0.7 * (1 - u * 0.6)})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); g.restore(); }
}

// ================================================================ MELT (b100-106)
const FROZEN = mk(W, H);
let frozenReady = false;
function meltWorld(g, t, b) {
  if (!frozenReady) { const f = FROZEN.getContext('2d'); fileWall(f, bt(99), 99, { frost: 1, scan: false, t0: -10 }); PR.placeFacade(f, FAC_ICE, W / 2, 1000, 900, 0.55); TH.cracks(f, [760, 960, 1160], [1, 1, 1], 1, 0, 40, W - 40); frozenReady = true; }
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#2a0402'); gr.addColorStop(1, '#0a0100'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  if (b < 102) {                                                         // the wall and the exchange come apart in chunks
    const a = t - bt(100);
    g.save(); g.globalCompositeOperation = 'lighter'; const fl = g.createRadialGradient(W / 2, 960, 10, W / 2, 960, 1100); fl.addColorStop(0, `rgba(255,200,110,${0.9 * Math.exp(-a * 1.2)})`); fl.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = fl; g.fillRect(0, 0, W, H); g.restore();
    PR.toppling(g, FROZEN, [0, 0, W, H], a * 0.8, [760, 960, 1160]);
    moltenRain(g, t, clamp(a * 1.5));
    return;
  }
  moltenRain(g, t, 1);
  meltingFlaps(g, t, b);
}
function moltenRain(g, t, amt) {
  g.save(); g.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 16; k++) { const x = 40 + k * 66 + Math.sin(t * 1.3 + k) * 20, w = 10 + 30 * hsh(k, 2);
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(255,120,20,0)'); gr.addColorStop(0.5, `rgba(255,${150 + 60 * hsh(k, 3) | 0},60,${0.35 * amt})`); gr.addColorStop(1, `rgba(255,230,160,${0.6 * amt})`);
    g.fillStyle = gr; g.fillRect(x - w / 2, 0, w, H); }
  const R = rng(3);
  for (let i = 0; i < 260; i++) { const ph = (R() + t * (0.6 + R())) % 1, x = R() * W, y = ph * (H + 200) - 100; g.fillStyle = `rgba(255,${190 + R() * 60 | 0},100,${amt * (1 - ph * 0.5)})`; g.fillRect(x, y, 3, 8 + R() * 18); }
  g.restore();
}
function meltingFlaps(g, t, b) {
  const u = clamp((b - 102) / 4);
  for (let r = 0; r < 9; r++) for (let c = 0; c < 10; c++) {
    const x = 60 + c * 98, y0 = 300 + r * 170, sag = u * (40 + 260 * hsh(r * 10 + c, 7)) * (0.3 + r / 9);
    g.save(); g.translate(x + 44, y0 + sag); g.scale(1 - u * 0.3 * hsh(c, r), 1 + u * 0.8 * hsh(r, c));
    tile(g, -44, -60, 88, 120, '0', TILE.gold); g.restore();
    const gr = g.createLinearGradient(0, y0 + sag + 60, 0, y0 + sag + 60 + sag * 0.8); gr.addColorStop(0, 'rgba(255,160,40,0.9)'); gr.addColorStop(1, 'rgba(255,160,40,0)');
    g.fillStyle = gr; g.fillRect(x + 30, y0 + sag + 60, 28, sag * 0.8);
  }
}
function machinesLit(g, t, b) {
  fill(g, '#1a0402');
  const push = 1 + (b - 106) * 0.012;
  g.save(); camera(g, push, W / 2, 1000);
  machineGrid(g, t, bt(106), { warm: true, running: true, zeroTag: true, rows: [[560, 3, 372], [944, 3, 372], [1328, 3, 372]], top: [180, 3, 372], shift: 1 });
  g.restore();
  if (b < 107) { const a = t - bt(106); moltenRain(g, t, clamp(1 - a * 1.2)); }
}

// ================================================================ PLAN: the board re-forms as a planning room (Beer's Opsroom, as comparison)
// The same flaps now read OUTPUT, NEED and the work week, not prices. Output meets need: the plan is balanced. (Numbers are texture.)
const PLAN_ROWS = [['STEEL', 4120], ['WHEAT', 9850], ['CHIPS', 2210], ['POWER', 7300], ['HOUSING', 1640], ['MEDICINE', 3080], ['FREIGHT', 5570], ['LUMBER', 2960]];
const PLANB = Board.fit({ rows: 9, cols: 21, top: 200, width: 900, aspect: 1.55, gx: 2, gy: 8 });
function planText(r) { if (r === 0) return ('GOOD'.padEnd(8) + '   OUT' + ' ' + '  NEED'); const [n, v] = PLAN_ROWS[r - 1], s = String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ','); return (n.padEnd(8) + s.padStart(6) + ' ' + s.padStart(6)).slice(0, 21); }   // 21 cols: OUT and NEED both whole
function chair(g, x, y, s, t, i) {
  g.save(); g.translate(x, y); g.scale(s, s);
  g.fillStyle = '#0a0605'; g.beginPath(); g.ellipse(0, 40, 62, 16, 0, 0, TAU); g.fill();                       // the star base
  g.fillRect(-6, -30, 12, 70);                                                                              // the stem
  g.beginPath(); g.ellipse(0, -30, 58, 20, 0, 0, TAU); g.fill();                                            // the seat
  g.beginPath(); g.roundRect(-52, -140, 104, 112, 34); g.fill();                                            // the back
  g.strokeStyle = 'rgba(255,150,70,0.55)'; g.lineWidth = 4; g.beginPath(); g.roundRect(-52, -140, 104, 112, 34); g.stroke();
  g.beginPath(); g.ellipse(0, -30, 58, 20, 0, Math.PI, TAU); g.stroke();
  g.restore();
}
function screenFrame(g, x, y, w, h) { g.fillStyle = '#050807'; g.fillRect(x - 18, y - 18, w + 36, h + 36); g.strokeStyle = 'rgba(190,220,200,0.25)'; g.lineWidth = 3; g.strokeRect(x - 18, y - 18, w + 36, h + 36); }
function planRoom(g, t, b) {
  const wall = g.createLinearGradient(0, 0, 0, H); wall.addColorStop(0, '#132019'); wall.addColorStop(0.7, '#08100c'); wall.addColorStop(1, '#030504'); g.fillStyle = wall; g.fillRect(0, 0, W, H);
  const a = clamp((b - 109.5) / 0.6);                                     // the board re-forms: the screens light row by row
  screenFrame(g, 90, 182, 900, 720);
  PLANB.draw(g, t, (r) => planText(r), { pal: TILE.gold, cell: (r, c) => { if (hsh(r * 21 + c, 6) > a * 1.3 - r * 0.05) return { ch: ' ' }; return c < 9 || r === 0 ? { pal: TILE.dim } : undefined; } });
  // the work week: 40 -> 36 (b113) -> 32 (b117): the Program's aim, "reducing the work week and laboring years"
  screenFrame(g, 90, 990, 430, 300);
  const wk = b < 113 ? '40' : b < 117 ? '36' : '32', t0 = b < 113 ? bt(109.5) : b < 117 ? bt(113) : bt(117), pk = b < 113 ? ' ' : b < 117 ? '40' : '36';
  g.font = '26px "Michroma"'; g.fillStyle = 'rgba(255,198,90,0.75)'; g.textAlign = 'left'; g.fillText('WORK WEEK, HOURS', 110, 1030);
  for (let i = 0; i < 2; i++) { const a2 = t - t0 - i * 0.02; tile(g, 150 + i * 118, 1070, 104, 186, wk[i], TILE.gold, { flip: a2 >= 0 && a2 < 0.08 && wk[i] !== pk[i] ? a2 / 0.08 : -1, prev: pk[i] }); }
  screenFrame(g, 560, 990, 430, 300);                                      // status lamps: every good's output meets its need
  for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) { const on = hsh(r * 6 + c, 8) < a; g.fillStyle = on ? '#ffc65a' : '#1a1206'; g.fillRect(590 + c * 62, 1030 + r * 58, 44, 36); if (on) { g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = 'rgba(255,170,60,0.25)'; g.fillRect(586 + c * 62, 1026 + r * 58, 52, 44); g.restore(); } }
  const fl = g.createLinearGradient(0, 1400, 0, H); fl.addColorStop(0, 'rgba(255,170,80,0.08)'); fl.addColorStop(1, 'rgba(0,0,0,0.5)'); g.fillStyle = fl; g.fillRect(0, 1400, W, H - 1400);
  for (let i = 0; i < 7; i++) { const u = (i - 3) / 3; chair(g, W / 2 + u * 400, 1660 + (1 - u * u) * -80 + 40, 1.0 + (1 - Math.abs(u)) * 0.35, t, i); }
  g.save(); g.globalCompositeOperation = 'lighter'; const gl = g.createRadialGradient(W / 2, 560, 60, W / 2, 560, 900); gl.addColorStop(0, 'rgba(255,190,90,0.14)'); gl.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gl; g.fillRect(0, 0, W, H); g.restore();
}
function plannedWorld(g, t, b) {                                          // the one row as one continuous plan of all production, receding
  fill(g, '#efe3cc');
  const vx = 960, vy = 660, n = 30, X0 = -700, T0 = 620, B0 = 2400;
  for (let i = n - 1; i >= 0; i--) {
    const z0 = 1 + i * 0.42, z1 = z0 + 0.38, P = z => [lerp(vx, X0, 1 / z), lerp(vy, T0, 1 / z), lerp(vy, B0, 1 / z)];
    const [x0, yT0, yB0] = P(z0), [x1, yT1, yB1] = P(z1);
    const lit = ((t - bt(120.5)) * 10 - i + n) % n, on = lit < 2.5;
    const p = PLATES[i % PLATES.length];
    g.save(); g.beginPath(); g.moveTo(x0, yT0); g.lineTo(x1, yT1); g.lineTo(x1, yB1); g.lineTo(x0, yB0); g.closePath(); g.clip();
    g.drawImage(on ? warmPlate(p) : p.plate, x0, yT0, Math.max(2, x1 - x0), yB0 - yT0); g.restore();
    g.strokeStyle = '#141010'; g.lineWidth = Math.max(1, 8 / z0); g.beginPath(); g.moveTo(x0, yT0); g.lineTo(x0, yB0); g.stroke();
  }
  g.fillStyle = '#c4101f'; g.beginPath(); g.moveTo(X0, T0 - 40); g.lineTo(vx, vy - 4); g.lineTo(vx, vy); g.lineTo(X0, T0); g.fill();
  g.fillStyle = '#141010'; g.beginPath(); g.moveTo(X0, B0); g.lineTo(vx, vy); g.lineTo(vx, vy + 4); g.lineTo(X0, B0 + 40); g.fill();
}

// ================================================================ NATIONALIZED. (b124-127.5): the stamp on the private nameplate, the crowd and the gear in the same shot
function cog(g, cx, cy, R, teeth, rot, fillC, rimC) {
  g.save(); g.translate(cx, cy); g.rotate(rot);
  g.beginPath();
  for (let i = 0; i < teeth; i++) { const a0 = i / teeth * TAU, w = TAU / teeth;
    for (const [da, r] of [[0.0, R * 0.86], [0.12, R * 0.86], [0.2, R], [0.42, R], [0.5, R * 0.86]]) { const a = a0 + da * w * 2; const px = Math.cos(a) * r, py = Math.sin(a) * r; if (i === 0 && da === 0) g.moveTo(px, py); else g.lineTo(px, py); } }
  g.closePath(); g.fillStyle = fillC; g.fill(); g.lineWidth = 8; g.strokeStyle = rimC; g.stroke();
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.arc(0, 0, R * 0.68, 0, TAU); g.fill();
  g.strokeStyle = rimC; g.lineWidth = 5; g.beginPath(); g.arc(0, 0, R * 0.68, 0, TAU); g.stroke();
  for (let k = 0; k < 6; k++) { g.save(); g.rotate(k / 6 * TAU); g.fillStyle = fillC; g.fillRect(-R * 0.045, 0, R * 0.09, R * 0.68); g.restore(); }
  g.fillStyle = fillC; g.beginPath(); g.arc(0, 0, R * 0.2, 0, TAU); g.fill(); g.stroke();
  g.restore();
}
// the crowd, from this piece's own faces (Klutsis's photomontage crowd): the people the file wall held, freed from their cards, in tiers that rise
const CROWD_T = 184;
function faceCrowd(g, t, rise) {
  const tiers = [[1330, 96, 0.9, 41], [1440, 128, 0.75, 43], [1560, 170, 0.6, 47], [1700, 230, 0.45, 53], [1880, 320, 0.3, 59]];
  g.save(); g.translate(0, (1 - rise) * 700);
  tiers.forEach(([y, sz, dark, seed], ti) => {
    const R = rng(seed), n = Math.ceil(W / (sz * 0.86)) + 2;
    for (let i = -1; i < n; i++) {
      const x = i * sz * 0.86 + (ti % 2) * sz * 0.43 + (R() - 0.5) * 10, yy = y + (R() - 0.5) * 14 + Math.sin(t * 2 + i + ti) * 3;
      const fi = Math.floor(R() * FACE_T.length), w = sz, h = sz * 1.25;
      g.save(); g.beginPath(); g.ellipse(x + w / 2, yy - h * 0.1, w * 0.44, h * 0.5, 0, 0, TAU); g.clip();
      g.drawImage(FACE_T[fi], x, yy - h * 0.6, w, h);
      g.fillStyle = `rgba(10,2,3,${dark * 0.55})`; g.fillRect(x, yy - h * 0.7, w, h * 1.1);
      g.restore();
      g.strokeStyle = `rgba(255,140,80,${0.5 * (1 - dark * 0.6)})`; g.lineWidth = 3; g.beginPath(); g.ellipse(x + w / 2, yy - h * 0.1, w * 0.44, h * 0.5, 0, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
    }
    g.fillStyle = `rgba(14,2,4,${0.5 + dark * 0.4})`; g.fillRect(0, y + sz * 0.42, W, H);
  });
  g.restore();
}
function natWorld(g, t, b) {
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#12030a'); gr.addColorStop(0.5, '#4a080e'); gr.addColorStop(1, '#0d0204'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const push = 1 + (b - 124) * 0.02;
  g.save(); camera(g, push, W / 2, 960);
  cog(g, W / 2, 900, 640, 24, (t - bt(124)) * 0.12, '#2a060a', 'rgba(255,110,60,0.55)');            // the gear behind the plate
  g.save(); g.globalCompositeOperation = 'lighter'; const sg = g.createRadialGradient(W / 2, 900, 20, W / 2, 900, 800); sg.addColorStop(0, 'rgba(255,120,50,0.28)'); sg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = sg; g.fillRect(0, 0, W, H); g.restore();
  g.fillStyle = '#1a0a0a'; g.fillRect(90, 780, W - 180, 340); TH.nameplate(g, 150, 820, 780, 280);
  g.restore();
  TH.stampText(g, 'NATIONALIZED.', W / 2, 960, t - bt(124) + 0.06, { size: 190, rot: -0.1 });
  faceCrowd(g, t, ease.outCubic(clamp((b - 124) / 2)));                                          // the people it watched rise under it
}

// ================================================================ PAYOFF (b127.5-142): the worker's hand
function heroPose(b) {
  const rise = ease.outCubic(clamp((b - 127.5) / 3.6)), closeQ = ease.inOutCubic(clamp((b - 131.25) / 1.35));
  const knuck = b >= 133;
  const punch = knuck ? 70 * Math.exp(-(b - 133) * 3.5) : 0, sway = Math.sin((b - 133) * 0.9) * 10;
  return {
    q: knuck ? 2 : 2 * closeQ, wrist: knuck ? 0.45 : 0.5, yaw: knuck ? 3.0 : -0.15, tilt: knuck ? 0.2 : 0.3,
    eye: [0, 2, knuck ? lerp(25, 21, clamp((b - 133) / 8)) : 32], tg: [0, knuck ? 0.55 : 0.4, 0.15], fov: 50,
    pool: 1.4 + 2.2 * sm(128, 131, b), key: 2.4, rim: 2.1, dy: knuck ? 70 - punch * 0.4 + sway * 0.2 : (1 - rise) * 1100 - 40 * rise,
  };
}
function payoffBackdrop(g, t, b) {
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#14020a'); gr.addColorStop(0.55, '#5a0a10'); gr.addColorStop(0.78, '#a3240f'); gr.addColorStop(1, '#1a0203'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.save(); g.globalCompositeOperation = 'lighter';
  const hz = g.createRadialGradient(W / 2, 1300, 20, W / 2, 1300, 1000); hz.addColorStop(0, 'rgba(255,190,110,0.5)'); hz.addColorStop(0.4, 'rgba(255,90,40,0.2)'); hz.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = hz; g.fillRect(0, 0, W, H);
  const R = rng(17);                                                     // ember dust rising through the frame
  for (let i = 0; i < 160; i++) { const ph = (R() + t * (0.05 + R() * 0.12)) % 1, x = R() * W + Math.sin(t * 0.7 + i) * 18, y = H - ph * (H + 100);
    g.fillStyle = `rgba(255,${140 + R() * 90 | 0},70,${0.5 * (1 - ph) * R()})`; g.fillRect(x, y, 2 + R() * 3, 2 + R() * 3); }
  g.restore();
}
// the ember hand: the anatomical hand is rendered to a scratch layer, then rebuilt from the file wall's faces (Klutsis, "Let us
// fulfil the plan of great works", 1930: the hand made of many hands). A brick of face portraits is laid over the frame and cut
// to the hand's own silhouette (so the fingers stay whole), multiplied by the render's shading (so it has a form), lit with ember
// light on its edges, and sparks rise off it; as the fist closes, light sprays out between the fingers (the v8 fist).
const HG = mk(72, 128), hg = HG.getContext('2d', { willReadFrequently: true });
const MZ = mk(W, H), mz = MZ.getContext('2d'), SHD = mk(W, H), shd = SHD.getContext('2d');
function emberHand(g, t, b, p) {
  clear(l1);
  const kn = HERO.draw(l1, p);
  hg.clearRect(0, 0, 72, 128); hg.drawImage(L1, 0, 0, W, H, 0, 0, 72, 128);
  const d = hg.getImageData(0, 0, 72, 128).data, cw = W / 72, ch = H / 128;
  // where the hand is (rows and columns with any coverage) -> the tiles we need
  let y0 = 128, y1 = 0; for (let y = 0; y < 128; y++) for (let x = 0; x < 72; x++) if (d[(y * 72 + x) * 4 + 3] > 20) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (y1 > y0) {
    clear(mz);
    const TW = 44, TH = 56, r0 = Math.floor(y0 * ch / TH) - 1, r1 = Math.ceil((y1 + 1) * ch / TH) + 1;
    for (let r = r0; r <= r1; r++) for (let c = -1; c < W / TW + 1; c++) {
      const fi = Math.floor(hsh(c * 3 + 1, r * 7 + 2) * FACE_T.length), x = c * TW + (r & 1) * TW / 2, y = r * TH;
      const flick = 0.85 + 0.15 * Math.sin(t * 2.2 + c * 1.7 + r);                 // the faces breathe: each tile's light drifts
      mz.globalAlpha = flick; mz.drawImage(FACE_T[fi], x, y, TW - 2, TH - 2);
    }
    mz.globalAlpha = 1; mz.globalCompositeOperation = 'destination-in'; mz.drawImage(L1, 0, 0);           // cut to the hand
    clear(shd); shd.filter = 'grayscale(1) brightness(3.6) contrast(0.62)'; shd.drawImage(L1, 0, 0); shd.filter = 'none';   // its own shading
    mz.globalCompositeOperation = 'multiply'; mz.drawImage(SHD, 0, 0);
    mz.globalCompositeOperation = 'lighter'; mz.globalAlpha = 0.3; mz.drawImage(L1, 0, 0); mz.globalAlpha = 1; mz.globalCompositeOperation = 'source-over';
    g.save(); g.globalCompositeOperation = 'lighter'; g.filter = 'blur(30px)'; g.globalAlpha = 0.6; g.drawImage(L1, 0, 0); g.filter = 'none'; g.restore();   // the light gathering
    g.save(); g.shadowColor = 'rgba(255,110,40,0.95)'; g.shadowBlur = 42; g.drawImage(MZ, 0, 0); g.shadowBlur = 0; g.drawImage(MZ, 0, 0); g.restore();
    g.save(); g.globalCompositeOperation = 'lighter'; g.filter = 'blur(5px)'; g.globalAlpha = 0.35; g.drawImage(L1, 0, 0); g.restore();
  }
  if (kn.length) {                                                       // the hot core: the light gathers in the knuckles and the palm
    const kx = kn.reduce((a, k) => a + k.x, 0) / kn.length, ky = kn.reduce((a, k) => a + k.y, 0) / kn.length, fist = smooth(131, 133.5, b), pulse = 1 + 0.08 * Math.sin(t * 9);
    g.save(); g.globalCompositeOperation = 'lighter'; const rg = g.createRadialGradient(kx, ky + 120, 20, kx, ky + 120, 520 * pulse);
    rg.addColorStop(0, `rgba(255,170,80,${0.34 + 0.3 * fist})`); rg.addColorStop(0.5, `rgba(255,90,40,${0.14 + 0.14 * fist})`); rg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = rg; g.fillRect(0, 0, W, H); g.restore();
  }
  // sparks off the hand: from the edge cells, rising, deterministic in t
  g.save(); g.globalCompositeOperation = 'lighter';
  const sp = clamp((b - 128) / 2);
  for (let y = 2; y < 126; y += 1) for (let x = 1; x < 71; x += 1) {
    const o = (y * 72 + x) * 4, a = d[o + 3] / 255; if (a < 0.25 || a > 0.8 || hsh(x * 3, y * 5) > 0.5) continue;
    for (let k = 0; k < 2; k++) { const ph = (hsh(x, y + k * 91) + t * (0.35 + 0.5 * hsh(y, x + k))) % 1, sx = x * cw + Math.sin(t * 3 + x + y) * 16 * ph, sy = y * ch - ph * ph * 420 * (0.4 + hsh(x + k, y));
      g.fillStyle = `rgba(255,${170 + 70 * (1 - ph) | 0},${90 + 60 * (1 - ph) | 0},${0.9 * (1 - ph) * sp})`; g.fillRect(sx, sy, 3 + 3 * (1 - ph), 3 + 3 * (1 - ph)); }
  }
  // the fist closing (v8): light sprays out between the fingers, in three bands
  if (b >= 131.25 && b < 134) { const u = clamp((b - 131.25) / 1.4), fade = 1 - clamp((b - 132.6) / 1.4);
    kn.forEach((k, i) => { for (let s2 = 0; s2 < 26; s2++) { const ph = (hsh(i, s2) + (b - 131.25) * 0.9) % 1, ang = k.ang - Math.PI / 2 + (hsh(s2, i) - 0.5) * 0.9, r = ph * (260 + 260 * hsh(i + 3, s2)) * u;
      g.fillStyle = `rgba(255,${200 - 80 * ph | 0},${120 - 60 * ph | 0},${(1 - ph) * fade})`; g.fillRect(k.x + Math.cos(ang) * r, k.y + Math.sin(ang) * r - ph * 60, 4, 4 + 8 * (1 - ph)); } }); }
  g.restore();
  return kn;
}
let heroKB = null;
function payoffWorld(g, t, b) {
  payoffBackdrop(g, t, b);
  if (!HERO) return [];
  const p = heroPose(b);
  const kn = emberHand(g, t, b, p);
  heroKB = kn;
  const lit = b >= 133 ? clamp((t - bt(133)) / 0.12) : 0, bars = [];
  kn.forEach((k, i) => {
    const len = Math.max(70, k.len * 1.5), th = 30, cx = k.x + Math.cos(k.ang) * len * 0.25, cy = k.y + Math.sin(k.ang) * len * 0.25;
    bars.push({ x: cx, y: cy, w: th, h: len, rot: k.ang });
    if (lit > 0 && b < 140.5) {
      g.save(); g.translate(cx, cy); g.rotate(k.ang);
      g.globalCompositeOperation = 'lighter'; g.shadowColor = '#ff5a30'; g.shadowBlur = 40 * lit; g.fillStyle = `rgba(255,90,50,${0.55 * lit})`; g.fillRect(-len / 2 - 8, -th / 2 - 8, len + 16, th + 16);
      g.globalCompositeOperation = 'source-over'; g.shadowBlur = 0; g.fillStyle = `rgba(255,243,220,${lit})`; g.fillRect(-len / 2, -th / 2, len, th); g.restore();
    }
  });
  return bars;
}
// b140-142: the four bars go to light and burst into the ACP gear; b142 the lockup
function gearWorld(g, t, b, kb) {
  const E = BRAND.acp_emblem, size = 520, sc = size / E.height, ex = W / 2 - E.width * sc / 2, ey = 960 - size / 2;
  const rows = PR.stripeRows(E);
  const m = ease.inOutCubic(clamp((b - 140.2) / 1.2));
  g.fillStyle = `rgba(10,1,2,${0.85 * smooth(140, 140.6, b)})`; g.fillRect(0, 0, W, H);
  const burst = clamp((b - 140) / 0.5);
  if (burst > 0 && burst < 1) { g.save(); g.globalCompositeOperation = 'lighter'; const gr = g.createRadialGradient(W / 2, 900, 10, W / 2, 900, 900 * burst); gr.addColorStop(0, `rgba(255,230,190,${1 - burst})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); g.restore(); }
  if (m > 0.05) acpEmblem(g, W / 2, 960, size, { color: C.red2, alpha: m });
  for (let i = 0; i < 4; i++) {
    const st = rows[i] || rows[rows.length - 1], k = kb[i] || kb[kb.length - 1] || { x: 540, y: 700 + i * 60, w: 60, h: 120, rot: 0 };
    const tx = ex + (st.x0 + st.x1) / 2 * sc, ty = ey + (st.y0 + st.y1) / 2 * sc, tw = (st.x1 - st.x0) * sc, th = (st.y1 - st.y0) * sc;
    const x = lerp(k.x, tx, m), yy = lerp(k.y, ty, m), rot = lerp(k.rot, 0, m);
    g.save(); g.translate(x, yy); g.rotate(rot);
    const bw = lerp(k.h, tw, m), bh = lerp(k.w, th, m);
    g.globalCompositeOperation = 'lighter'; g.shadowColor = '#ff5a30'; g.shadowBlur = 50 * (1 - m);
    g.fillStyle = `rgba(255,90,50,${0.7 * (1 - m)})`; g.fillRect(-bw / 2 - 12, -bh / 2 - 10, bw + 24, bh + 20);
    g.globalCompositeOperation = 'source-over'; g.shadowBlur = 0; g.fillStyle = m > 0.85 ? C.red2 : '#fff3dc'; g.globalAlpha = m > 0.97 ? 0 : 1;
    g.fillRect(-bw / 2, -bh / 2, bw, bh); g.restore();
  }
}
let lastBars = [];

// ================================================================ v13 worlds
// STORY (b8-12): the hook board's machine plates stay; THE STORY / GOES LIKE / THIS: is set on its big flaps (Land's first words)
function storyWorld(g, t, b) { hookBoard(g, t, 7.99, { story: true }); }
// LENIN (b28-36): the merge's one row, grown into a red slab on the board; the sentence is set across two follow-on frames
function leninWorld(g, t, b) {
  fill(g, '#060404');
  const [sx, sy] = shake(t, 0.5); g.save(); g.translate(sx, sy);
  const u = ease.outCubic(clamp((b - 28) / 0.3)), hh = lerp(312, 1240, u);
  g.fillStyle = '#c4101f'; g.fillRect(40, 900 - hh / 2, W - 80, hh);
  g.fillStyle = 'rgba(0,0,0,0.16)'; for (let i = 1; i < 37; i++) g.fillRect(40, 900 - hh / 2 + i * hh / 37, W - 80, 2);            // the merged rows' seams
  g.fillStyle = 'rgba(255,255,255,0.05)'; for (let c = 0; c < 22; c++) g.fillRect(52 + c * 44, 900 - hh / 2 + 8, 38, hh - 16);
  const a = t - bt(32); if (a >= 0 && a < 0.25) { g.globalCompositeOperation = 'lighter'; g.fillStyle = `rgba(255,255,255,${0.35 * (1 - a / 0.25)})`; g.fillRect(40, 900 - hh / 2, W - 80, hh); g.globalCompositeOperation = 'source-over'; }
  g.restore();
}
// the pilot flame (Marx, "the vital flame of production", b77-88): a gas pilot burning on the dead board's glass; it gutters on
// EXTINGUISHED. (b84) and goes out, leaving the brass nozzle and a thread of smoke
function pilotFlame(g, t, b) {
  const X0 = 28, Y0 = 96, WW = W - 56, HH = 470, cx = W / 2, base = Y0 + HH - 92;
  g.save(); g.fillStyle = '#0a0807'; g.fillRect(X0, Y0, WW, HH); g.strokeStyle = 'rgba(255,235,210,0.12)'; g.lineWidth = 3; g.strokeRect(X0 + 8, Y0 + 8, WW - 16, HH - 16);
  const lit = smooth(77, 79.5, b), out = smooth(84, 85.2, b), life = lit * (1 - out);
  const flick = 0.9 + 0.1 * Math.sin(t * 23) + 0.06 * Math.sin(t * 37 + 1), gutter = b > 83.8 && b < 85.2 ? 0.55 + 0.45 * Math.sin(t * 61) : 1;
  const h = 230 * life * flick * gutter;
  if (h > 4) {
    g.globalCompositeOperation = 'lighter';
    const gl = g.createRadialGradient(cx, base - h * 0.4, 10, cx, base - h * 0.4, 380); gl.addColorStop(0, `rgba(255,170,70,${0.42 * life})`); gl.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gl; g.fillRect(X0, Y0, WW, HH);
    for (const [wd, col, hh2] of [[62, 'rgba(255,120,30,0.85)', 1], [40, 'rgba(255,205,110,0.95)', 0.78], [22, 'rgba(255,250,225,1)', 0.5], [30, 'rgba(90,150,255,0.85)', 0.28]]) {
      const hgt = h * hh2, sway = Math.sin(t * 9 + wd) * 5 * life;
      g.fillStyle = col; g.beginPath(); g.moveTo(cx - wd / 2, base); g.bezierCurveTo(cx - wd * 0.62, base - hgt * 0.45, cx - wd * 0.2 + sway, base - hgt * 0.8, cx + sway, base - hgt);
      g.bezierCurveTo(cx + wd * 0.2 + sway, base - hgt * 0.8, cx + wd * 0.62, base - hgt * 0.45, cx + wd / 2, base); g.closePath(); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  }
  g.fillStyle = '#8a6a2a'; g.fillRect(cx - 34, base, 68, 26); g.fillStyle = '#b98a2e'; g.fillRect(cx - 22, base + 26, 44, 60); g.fillStyle = '#3a2606'; g.fillRect(cx - 4, base + 26, 8, 60);
  if (out > 0.02) {                                                      // the smoke thread, and the nozzle's afterglow
    g.strokeStyle = `rgba(200,190,180,${0.5 * Math.min(1, out * 3) * (1 - smooth(86, 88, b))})`; g.lineWidth = 5; g.beginPath();
    for (let i = 0; i <= 30; i++) { const u = i / 30, x = cx + Math.sin(u * 9 + t * 2) * 12 * u, y = base - u * 250 * (0.4 + 0.6 * out); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    g.globalCompositeOperation = 'lighter'; g.fillStyle = `rgba(255,120,40,${0.6 * (1 - smooth(85.2, 87.5, b))})`; g.fillRect(cx - 12, base - 3, 24, 5);
  }
  g.font = '26px "Michroma"'; g.fillStyle = 'rgba(239,226,200,0.5)'; g.textAlign = 'left'; g.globalCompositeOperation = 'source-over'; g.fillText('RATE OF PROFIT', 66, Y0 + 40);
  g.restore();
}

// ================================================================ the card layer: every sentence on the board's big flaps
const REGION = {
  story: [330, 1330], ledger: [1170, 1880], lenin: [310, 1490], search: [96, 800], fin: [96, 800], loss: [96, 800], zero: [1170, 1880], marx: [1170, 1880],
  post: [1170, 1880], freeze: [980, 1870], turn: [96, 660], machines: [1230, 1880], plan: [1300, 1880], program: [96, 920], poster: [96, 720],
};
function cardLayer(g, t, b) {
  const f = cardNow(b); if (!f) return;
  const face = f.face;
  if (face === 'hook' || face === 'stamp') return;                      // spelled in the hook board / stamped by the world
  if (face === 'molten') {                                               // MELTDOWN. / MELT. / DOWN.: the one earned departure from the board (the metal running)
    const age = f.age;
    if (f.text === 'MELT.' || f.text === 'DOWN.') return TH.molten(g, f.text, f.text === 'MELT.' ? 560 : 1420, age, t, { size: f.text === 'MELT.' ? 330 : 300 });
    return f.rows.forEach((r, i) => TH.molten(g, r.replace(/\*/g, ''), 960 + i * 250, age, t, { size: 300 }));
  }
  const o = { spb: SPB, nopick: NOPICK.has(f.b0) };
  if (face === 'freeze' || face === 'turn') Object.assign(o, { housing: '#0c1620', housing2: '#050a10', edge: 'rgba(180,225,255,0.3)', citeCol: '#dcefff' });
  if (face === 'story') Object.assign(o, { tw: 110 });
  if (face === 'lenin') Object.assign(o, { housing: '#1a0406', housing2: '#0d0203', tw: 130 });
  if (face === 'poster') Object.assign(o, { housing: 'rgba(14,2,4,0.86)', housing2: 'rgba(8,1,2,0.9)' });
  cardBoard(g, t, f, REGION[face] || [1170, 1880], o);
}

// ================================================================ frame
const IMPACTS = [[76, 540, 900], [148, 540, 960]];
// the v12 chain, unchanged: it draws the world for a v12 beat (b) at v12 time (t)
function oldWorld(g, t, b) {
  if (b < 8) hookBoard(g, t, b);
  else if (b < 20) ledgerWorld(g, t, b);
  else if (b < 24) mergeWorld(g, t, b);
  else if (b < 36) indexWorld(g, t, b);
  else if (b < 50) financeWorld(g, t, b);
  else if (b < 52) latticeWorld(g, t, b);
  else if (b < 64) ledgerWorld(g, t, b);
  else if (b < 68) socketsWorld(g, t, b);
  else if (b < 100) freezeWorld(g, t, b);
  else if (b < 106) meltWorld(g, t, b);
  else if (b < 109.5) machinesLit(g, t, b);
  else if (b < 120.5) planRoom(g, t, b);
  else if (b < 124) plannedWorld(g, t, b);
  else if (b < 127.5) natWorld(g, t, b);
  else { lastBars = payoffWorld(g, t, b); if (b >= 140) gearWorld(g, t, b, lastBars); }
}
window.renderFrame = async (t) => {
  const b = t / SPB, frame = Math.round(t * FPS);
  clear(ctx);
  if (b >= CLOSE_B) {                                                     // the lockup (1.4 s), dissolving back onto the hook board (the loop)
    const age = (b - CLOSE_B) * SPB, seam = smooth(0.95, 1.4, age);
    CLOSERS.flaps(ctx, age);
    if (seam > 0) { TSHIFT = 0; ctx.save(); ctx.globalAlpha = seam; hookBoard(ctx, 0.0, 0); ctx.restore(); }
    finish.apply(ctx, frame, { grain: 0.05, vignette: 0.35 }); return;
  }
  const sg = segAt(b), kind = sg[2];
  if (kind === 'old') {
    const [n0, , , o0, rate, holdTo] = sg; let ob = o0 + (b - n0) * rate; const ot = ob * SPB; if (holdTo) ob = Math.min(ob, holdTo);
    TSHIFT = t - ot; oldWorld(ctx, ot, ob);
  } else {
    TSHIFT = 0;
    if (kind === 'story') storyWorld(ctx, t, b); else if (kind === 'lenin') leninWorld(ctx, t, b); else freezeBoard(ctx, t, b);
  }
  TSHIFT = 0;
  if (b >= 76 && b < 88) pilotFlame(ctx, t, b);
  for (const [hb, x, y] of IMPACTS) { const k = frame - Math.round(bt(hb) * FPS); if (k >= 0 && k < 2) PR.impact(ctx, k + 1, x, y); }
  if (b < 200) cardLayer(ctx, t, b);
  finish.apply(ctx, frame, { grain: 0.06, vignette: 0.3 });
};
for (const w of [0.2, bt(10), bt(30), bt(46), bt(60), bt(72), bt(96), bt(130), bt(150), bt(158), bt(168), bt(186), bt(190), bt(195)]) await window.renderFrame(w);   // warm-up
window.sceneReady = true;
