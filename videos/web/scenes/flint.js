// TODAY. #1 FLINT (7 Oct 2026, new piece; the calendar series from IDEAS_BANK §2 #4, in SCAFFOLDING's slot: the client retired the newspaper).
// A tear-off calendar, a page a day. 30 DECEMBER 1936, a Wednesday; 30 December 2026 is a Wednesday too, the 90th anniversary.
// The film is Master Hands (1936), shot in Chevrolet's Flint plants the year of the sit-down (Prelinger, public domain; flint.bake.py), printed
// through a rotogravure screen (repro.js: the 1930s photo-magazine). Never labelled.
// v3 (7 Oct): the client: 'harmed by brevity, needs more expository lead-up'; 'the machines are bigger now' connected to nothing. The lead-up
// (b4-41) says who they were and what they lacked (no union, the yearly layoffs, the foreman's say, GM's spies), that they organized in secret, and
// what started it (GM shipping the body dies out of Flint, 30 Dec 1936). After the win: the UAW from 30,000 to 500,000 in a year; IT runs because we run it.
// v2 (7 Oct): the client: reducing management to 'speeding up the line' makes the workers look anti-progress; they fought for their rights: no union,
// no voice, GM's spies (the La Follette Civil Liberties Committee, 1937). The line restarts WITH A UNION. The cuts still quicken into the stop.
//   the page tears to DEC 30 -> the line runs and the cuts quicken (no union, no voice, GM's spies) -> the fist on the lever: everything stops,
//   the frame prints in red -> they sat down and held the plant (Fisher Body No. 1 and No. 2): the faces -> 44 days: the pages tear, faster and
//   faster, two holds (JAN 11 the police and their tear gas, held; FEB 1 Chevrolet No. 4 taken) -> FEB 11 1937: GM recognized the union ->
//   the lever thrown the other way, the line runs again -> the page tears to 30 DECEMBER 2026: TODAY. -> the mark.
// Facts: the Flint sit-down strike, 30 Dec 1936 - 11 Feb 1937 (44 days); Fisher Body No. 1 and No. 2 occupied 30 Dec; the police attack on Fisher
// No. 2, 11 Jan 1937 (tear gas; the strikers held: "the Battle of the Running Bulls"); Chevrolet No. 4 taken 1 Feb 1937; GM recognized the UAW 11 Feb.
// Score: songs2/flint_e.py (Detroit techno, 120 BPM: a beat is 0.5 s).
import { W, H, loadFonts, outCanvas, Finish, closer, clamp, lerp, ease } from '../lib/kit.js';
import { Repro } from '../lib/fx/repro.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const ctx = outCanvas();
await loadFonts();
await (async () => { const f = new FontFace('Big Shoulders Display', 'url(../node_modules/@fontsource/big-shoulders-display/files/big-shoulders-display-latin-900-normal.woff2)', { weight: '900' }); document.fonts.add(await f.load()); })();
const finish = new Finish(1936);
const BT = b => b * 0.5;
const H01 = x => { const s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

// beats (120 BPM)
export const TL = { pad: 0, tear0: 1, line: 4, stop: 41, sat: 41, days: 51, jan11: 57, feb1: 63, feb11: 68, restart: 74, today: 92, mark: 101, end: 109 };   // v3: the lead-up (b4-41)

// ------------------------------------------------------------------ the calendar
const MON = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const DAY = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const dateOf = (y, m, d) => { const D = new Date(Date.UTC(y, m, d)); return { y: D.getUTCFullYear(), m: D.getUTCMonth(), d: D.getUTCDate(), wd: D.getUTCDay() }; };
const PAGES = [dateOf(1936, 11, 29)];                          // the page on the pad at the open: 29 December
for (let k = 0; k < 44; k++) PAGES.push(dateOf(1936, 11, 30 + k));   // 30 Dec 1936 (day 1) .. 11 Feb 1937 (day 44)
PAGES.push(dateOf(2026, 11, 30));                               // ... and today
// when each page is torn away (beats): page i is on top from TEAR[i-1] to TEAR[i]
const TEAR = [TL.tear0];                                        // 29 Dec off -> 30 Dec
{ const days = [51, 52, 53, 54, 54.5, 55, 55.5, 56, 56.25, 56.5, 56.75];      // -> 31 Dec .. 10 Jan; 11 Jan lands at 57 (below)
  for (const b of days) TEAR.push(b);
  TEAR.push(TL.jan11);                                          // the tear that lands JAN 11 (35); then hold
  for (let k = 0; k < 21; k++) TEAR.push(60.5 + k * 0.125);    // 12 Jan .. 1 Feb (lands at 63.0); hold
  for (let k = 0; k < 9; k++) TEAR.push(TL.feb1 + 2 + k * 0.125);              // 2 Feb .. 10 Feb (65 .. 66.0); a breath
  TEAR.push(TL.feb11);                                          // -> 11 Feb at 46
  TEAR.push(TL.today); }                                        // 11 Feb 1937 off -> 30 Dec 2026
// TEAR[i] is the beat page i comes off. Check: TEAR has PAGES.length - 1 entries.
if (TEAR.length !== PAGES.length - 1) console.warn('flint: tear schedule', TEAR.length, PAGES.length);
export const TEARS = TEAR.slice();
const pageAt = b => { let i = 0; while (i < TEAR.length && b >= TEAR[i]) i++; return i; };

const PAPER = (() => { const c = document.createElement('canvas'); c.width = 600; c.height = 760; const g = c.getContext('2d');
  g.fillStyle = '#efe6cf'; g.fillRect(0, 0, 600, 760);
  const id = g.getImageData(0, 0, 600, 760), a = id.data;
  for (let i = 0; i < a.length; i += 4) { const n = (H01(i * 0.37) - 0.5) * 14 + (H01(Math.floor(i / 2400) * 3.1) - 0.5) * 6; a[i] += n; a[i + 1] += n; a[i + 2] += n * 0.8; }
  g.putImageData(id, 0, 0); return c; })();
const FONT = '"Big Shoulders Display", "Anton", sans-serif';
const STOCK = '#EFE6CF', INK = '#15110F', HRED = '#C8141E';
const PW = 560, PH = 700;          // a page at scale 1 (the pad's header sits above it)
function pageFace(g, P, { stub = false } = {}) {     // one page, its top-left at 0,0
  g.drawImage(PAPER, 0, 0, PW, PH);
  g.strokeStyle = 'rgba(40,30,20,0.25)'; g.lineWidth = 2; g.strokeRect(1, 1, PW - 2, PH - 2);
  const red = P.wd === 0;
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillStyle = INK; g.font = `900 70px ${FONT}`; g.letterSpacing = '10px'; g.fillText(MON[P.m], PW / 2 + 5, 104); g.letterSpacing = '0px';
  g.fillStyle = HRED; g.fillRect(48, 128, PW - 96, 6);
  g.fillStyle = red ? HRED : INK; g.font = `900 400px ${FONT}`; g.fillText(String(P.d), PW / 2, 520);
  g.fillStyle = HRED; g.fillRect(48, 560, PW - 96, 6);
  g.fillStyle = INK; g.font = `900 60px ${FONT}`; g.letterSpacing = '8px'; g.fillText(DAY[P.wd], PW / 2 + 4, 630); g.letterSpacing = '0px';
  g.fillStyle = '#5b5248'; g.font = `900 40px ${FONT}`; g.letterSpacing = '6px'; g.fillText(String(P.y), PW / 2 + 3, 680); g.letterSpacing = '0px';
}
// the pad: header (TODAY.), the stack under the top page, the page; a torn page in flight. (cx, cy) is the pad's centre, s its scale
function drawPad(g, b, cx, cy, s, { alpha = 1 } = {}) {
  const i = pageAt(b), P = PAGES[Math.min(i, PAGES.length - 1)];
  g.save(); g.globalAlpha = alpha; g.translate(cx, cy); g.scale(s, s); g.translate(-PW / 2, -(PH + 130) / 2);
  g.save(); g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = 40; g.shadowOffsetY = 18; g.fillStyle = '#d9cfb8'; g.fillRect(-6, 130, PW + 12, PH + 22); g.restore();
  for (let k = 5; k >= 1; k--) { g.fillStyle = k % 2 ? '#e2d8c0' : '#cfc4aa'; g.fillRect(-2, 130 + k * 3.5, PW + 4, PH); }   // the pages under it
  g.fillStyle = HRED; g.fillRect(-10, 0, PW + 20, 130);                                                            // the header
  g.fillStyle = STOCK; g.font = `900 96px ${FONT}`; g.textAlign = 'center'; g.letterSpacing = '6px'; g.fillText('TODAY.', PW / 2, 100); g.letterSpacing = '0px';
  g.fillStyle = '#2a2420'; for (const x of [70, PW - 70]) g.fillRect(x - 14, 118, 28, 22);                         // the staples
  g.save(); g.translate(0, 130); pageFace(g, P);
  // the ragged stubs of the pages already torn, under the binding
  if (i > 0) { g.fillStyle = '#e8dfc6'; g.beginPath(); g.moveTo(0, 0); for (let x = 0; x <= PW; x += 14) g.lineTo(x, 6 + H01(x + i * 7) * 12); g.lineTo(PW, 0); g.closePath(); g.fill(); }
  // the page just torn: rips from the binding, swings and falls away
  const prev = i - 1;
  if (prev >= 0) {
    const age = b - TEAR[prev], gap = Math.max(0.12, Math.min(1.2, (TEAR[prev + 1] ?? TEAR[prev] + 1) - TEAR[prev]));
    const dur = Math.min(0.9, Math.max(0.35, gap * 1.6)), u = clamp(age / dur);
    if (u < 1) {
      const side = H01(prev * 3.3) < 0.5 ? -1 : 1, e = ease.inCubic(u);
      g.save(); g.translate(side < 0 ? 0 : PW, 0);
      g.rotate(side * (0.15 * ease.outCubic(clamp(u * 3)) + 0.9 * e)); g.translate(side * 140 * e, 900 * e);
      g.translate(side < 0 ? 0 : -PW, 0);
      g.save(); g.shadowColor = 'rgba(0,0,0,0.4)'; g.shadowBlur = 30; g.shadowOffsetY = 14; pageFace(g, PAGES[prev]); g.restore();
      g.restore();
    }
  }
  g.restore(); g.restore();
}

// ------------------------------------------------------------------ the film
const IDX = await (await fetch('../assets/flint/plates/index.json')).json();
const BMP = new Map();
async function frameBmp(shot, i) {
  const k = shot + '/' + i; if (BMP.has(k)) { const v = BMP.get(k); BMP.delete(k); BMP.set(k, v); return v; }
  const bm = await createImageBitmap(await (await fetch(`../assets/flint/plates/${shot}/${String(i + 1).padStart(4, '0')}.jpg`)).blob());
  BMP.set(k, bm); if (BMP.size > 48) { const o = BMP.keys().next().value; BMP.get(o).close(); BMP.delete(o); }
  return bm;
}
// [beat, shot, offset s, zoom from, zoom to, rate (playback), hold (a frame index to freeze on, or -1)]
const CUTS = [
  // v3: the lead-up. Slow at first (who they were, what they lacked), quickening into the dies and the stop
  [TL.line, 'vast', 0.0, 1.04, 1.14, 0.8, -1], [8, 'floor', 0.0, 1.03, 1.1, 0.9, -1], [10, 'frames', 0.0, 1.03, 1.1, 1, -1],
  [13, 'hands', 0.2, 1.03, 1.1, 0.9, -1], [15, 'lathe', 0.0, 1.03, 1.1, 0.9, -1], [17, 'face6', 0.0, 1.04, 1.12, 0.7, -1], [19, 'panels', 0.0, 1.03, 1.1, 1, -1],
  [21, 'chassis', 0.0, 1.03, 1.1, 1, -1], [23, 'face2', 1.2, 1.04, 1.1, 0.7, -1], [25, 'overhead', 0.2, 1.03, 1.08, 1, -1], [27, 'face5', 0.8, 1.04, 1.1, 0.7, -1],
  [29, 'press5', 0.2, 1.04, 1.1, 1, -1], [31, 'face3', 1.4, 1.04, 1.1, 0.7, -1], [33, 'glove', 0.0, 1.03, 1.1, 0.8, -1], [34.5, 'frames', 1.0, 1.03, 1.08, 1.1, -1],
  [35.5, 'former', 0.0, 1.03, 1.08, 1.2, -1], [36.5, 'hoist', 0.0, 1.03, 1.1, 1, -1], [37.5, 'presses', 0.3, 1.03, 1.08, 1.3, -1], [38, 'drop', 1.0, 1.04, 1.08, 1.4, -1],
  [38.5, 'floor', 1.2, 1.05, 1.1, 1.5, -1], [39, 'chassis', 1.0, 1.06, 1.1, 1.6, -1], [39.5, 'panels', 1.0, 1.06, 1.1, 1.7, -1], [39.75, 'overhead', 1.0, 1.06, 1.1, 1.8, -1],
  [40, 'press5', 1.0, 1.06, 1.1, 1.9, -1], [40.25, 'wheel', 0.2, 1.06, 1.1, 2.0, -1], [40.5, 'drop', 1.5, 1.06, 1.1, 2.0, -1], [40.75, 'frames', 1.8, 1.07, 1.1, 2.0, -1],
  [TL.stop, 'lever', 0.0, 1.0, 1.06, 1, 30],                                                          // the fist on the lever: held
  [43, 'face7', 0.0, 1.03, 1.12, 0.6, -1], [45, 'face1', 0.2, 1.04, 1.12, 0.6, -1], [47, 'face3', 0.2, 1.04, 1.12, 0.6, -1], [49, 'face4', 0.0, 1.04, 1.12, 0.6, -1],
  [TL.days, 'face2', 0.0, 1.05, 1.15, 0.5, -1], [55, 'face5', 0.0, 1.05, 1.12, 0.5, -1], [59, 'face6', 0.0, 1.05, 1.12, 0.5, -1], [63, 'face3', 1.2, 1.05, 1.12, 0.5, -1],
  [TL.feb11, 'face1', 1.4, 1.06, 1.14, 0.5, -1],
  [TL.restart, 'lever', 0.6, 1.0, 1.06, 1, -1], [75.5, 'flywheel', 0.0, 1.03, 1.1, 1, -1], [77, 'drop', 0.0, 1.03, 1.08, 1, -1], [79, 'floor', 0.0, 1.03, 1.1, 1, -1],
  [80.5, 'frames', 0.0, 1.03, 1.1, 1, -1], [82, 'overhead', 0.0, 1.03, 1.08, 1, -1], [83.5, 'wheel', 0.0, 1.03, 1.08, 1, -1], [84.5, 'rolloff', 0.0, 1.03, 1.1, 1, -1],
  [86.5, 'hands', 0.8, 1.04, 1.1, 1, -1], [88.5, 'vast', 0.6, 1.08, 1.14, 1, -1],
].map(c => [BT(c[0]), ...c.slice(1)]);
const cutAt = t => { let c = null; for (const x of CUTS) if (t >= x[0]) c = x; return c; };
const SRC = Object.assign(document.createElement('canvas'), { width: W, height: H }), SG = SRC.getContext('2d');
const RP = new Repro(W, H);
async function film(g, t, { ink = 'sepia', dark = 0, cell = 7 } = {}) {
  const c = cutAt(t); if (!c) return;
  const i = CUTS.indexOf(c), nxt = CUTS[i + 1], len = (nxt ? nxt[0] : BT(TL.today)) - c[0], age = t - c[0], u = clamp(age / len);
  const n = IDX[c[1]].n, f = c[6] >= 0 ? Math.min(n - 1, c[6]) : Math.min(n - 1, Math.floor((c[2] + age * c[5]) * 24));
  const bm = await frameBmp(c[1], f), z = lerp(c[3], c[4], ease.inOutSine ? ease.inOutSine(u) : u), dw = W * z, dh = H * z;
  SG.drawImage(bm, (W - dw) / 2, (H - dh) / 2, dw, dh);
  RP.gravure(SRC, t, { ink, cell, levels: [0.03, 0.97, 1.05] }); RP.draw(g);
  if (dark > 0) { g.fillStyle = `rgba(14,10,8,${dark})`; g.fillRect(0, 0, W, H); }
}

// ------------------------------------------------------------------ the words (house: solid type on a solid band, struck on the hit)
function fit(g, text, size, maxW) { g.font = `900 ${size}px ${FONT}`; const w = g.measureText(text).width; return w > maxW ? size * maxW / w : size; }
function line(g, text, x, y, size, { fill = STOCK, band = INK, a = 1, strike = 1 } = {}) {
  const s = fit(g, text, size, 960 * 0.94); g.save(); g.globalAlpha = a; g.font = `900 ${s}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.letterSpacing = `${Math.round(s * 0.012)}px`;
  const w = g.measureText(text).width, padX = s * 0.22, padY = s * 0.16;
  g.translate(x, y - s * 0.36); g.scale(strike, strike); g.translate(-x, -(y - s * 0.36));
  g.fillStyle = band; g.fillRect(x - w / 2 - padX, y - s * 0.92 - padY * 0.4, w + 2 * padX, s * 0.92 + padY * 1.4);
  g.fillStyle = fill; g.fillText(text, x, y); g.restore();
}
// [from beat, to beat, lines, y, size, style]
const CUES = [
  [4, 8, ['FLINT, MICHIGAN. 1936.'], 300, 124, 'main'],
  [8, 13, ['GENERAL MOTORS:', 'THE BIGGEST CORPORATION', 'IN THE WORLD.'], 300, 104, 'main'],
  [13, 17, ['ITS WORKERS', 'BUILT THE CARS.'], 300, 132, 'main'],
  [17, 21, ['THEY HAD NO UNION.', 'NO VOICE.'], 300, 128, 'main'],
  [21, 25, ['EVERY YEAR, AT THE', 'MODEL CHANGE, THEY WERE', 'LAID OFF FOR MONTHS.'], 300, 100, 'main'],
  [25, 29, ['AND THE FOREMAN', 'DECIDED WHO', 'CAME BACK.'], 300, 120, 'main'],
  [29, 33, ['GM PAID SPIES', 'TO WATCH THEM.'], 300, 132, 'main'],
  [33, 37, ['THEY ORGANIZED', 'ANYWAY, IN SECRET.'], 300, 124, 'hot'],
  [37, 41, ['ON DECEMBER 30,', 'GM STARTED SHIPPING', 'THE BODY DIES', 'OUT OF FLINT.'], 300, 104, 'main'],
  [41.2, 45, ['THEN THE WORKERS', 'STOPPED THE LINE.'], 300, 132, 'hot'],
  [45, 47.5, ['THEY DIDN’T', 'WALK OUT.'], 300, 140, 'main'],
  [47.5, 51, ['THEY SAT DOWN', 'AND HELD THE PLANT.'], 300, 120, 'main'],
  [48, 51, ['FISHER BODY NO. 1 AND NO. 2 · FLINT'], 600, 44, 'sub'],
  [TL.jan11, 60.5, ['THE POLICE CAME', 'WITH TEAR GAS.', 'THEY HELD.'], 230, 96, 'main'],
  [TL.feb1, 65, ['THEY TOOK', 'CHEVROLET NO. 4.'], 230, 104, 'main'],
  [TL.feb11 + 0.2, 71, ['44 DAYS.'], 230, 170, 'red'],
  [71, 74, ['GENERAL MOTORS', 'RECOGNIZED THE UNION.'], 230, 110, 'main'],
  [74.3, 78, ['THE LINE RAN AGAIN,', 'WITH A UNION.'], 300, 124, 'main'],
  [78, 82.5, ['IN A YEAR, THE UAW GREW', 'FROM 30,000 MEMBERS', 'TO 500,000.'], 300, 104, 'main'],
  [82.5, 86.5, ['IT ONLY EVER RUNS', 'BECAUSE WE RUN IT.'], 300, 116, 'hot'],
  [86.5, 91, ['WHOEVER RUNS IT', 'SHOULD OWN IT.'], 300, 124, 'hot'],
  [94, TL.mark - 0.1, ['90 YEARS ON.'], 230, 120, 'main'],
];
function drawType(g, b) {
  for (const [a, e, lines, y, size, style] of CUES) {
    if (b < a || b >= e) continue;
    const age = BT(b - a), al = clamp(BT(e - b) / 0.08), fr = age * 30;
    const strike = fr < 3 ? 1.16 - 0.16 * fr / 3 : fr < 5 ? 1 - 0.03 * Math.sin((fr - 3) / 2 * Math.PI) : 1;
    lines.forEach((tx, i) => {
      const yy = y + i * size * 1.22, o = { a: al, strike: style === 'sub' ? 1 : strike };
      if (style === 'sub') line(g, tx, 540, yy, size, { ...o, fill: INK, band: STOCK });
      else if (style === 'red') line(g, tx, 540, yy, size, { ...o, fill: STOCK, band: HRED });
      else if (style === 'hot') line(g, tx, 540, yy, size, { ...o, fill: HRED, band: STOCK });
      else line(g, tx, 540, yy, size, o);
    });
  }
}

// ------------------------------------------------------------------ the frame
window.renderFrame = async (t) => {
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.setTransform(1, 0, 0, 1, 0, 0);
  const b = t / 0.5;
  if (b >= TL.mark) {
    const age = t - BT(TL.mark);
    ctx.fillStyle = '#0c0a09'; ctx.fillRect(0, 0, W, H); drawPad(ctx, TL.mark, 540, 980, 1.25, { alpha: clamp(1 - age * 3) }); closer(ctx, age);
    return {};
  }
  ctx.fillStyle = '#0c0a09'; ctx.fillRect(0, 0, W, H);
  if (b < TL.line) {                                   // the pad, close: 29 DECEMBER tears to 30
    const z = lerp(1.55, 1.42, ease.outCubic(clamp(b / TL.line)));
    if (b > 2.8) await film(ctx, BT(TL.line), { dark: lerp(1, 0.35, clamp((b - 2.8) / 1.2)) });
    const out = clamp((b - 3.2) / 0.8), e = ease.inOutCubic(out);
    drawPad(ctx, b, lerp(540, 205, e), lerp(1000, 1610, e), lerp(z, 0.42, e));
  } else if (b < TL.days) {                            // the line; the stop; the sit-down
    const stopped = b >= TL.stop && b < TL.stop + 2;
    await film(ctx, t, { ink: stopped ? 'red' : 'sepia', dark: b >= TL.sat + 2 ? 0.12 : 0 });
    if (b >= TL.stop && b < TL.stop + 0.5) { ctx.fillStyle = `rgba(239,230,207,${0.5 * (1 - (b - TL.stop) / 0.5)})`; ctx.fillRect(0, 0, W, H); }
    drawPad(ctx, b, 205, 1610, 0.42);
  } else if (b < TL.restart) {                         // the 44 days: the pad comes forward over the faces
    const inn = ease.inOutCubic(clamp((b - TL.days) / 1.0));
    await film(ctx, t, { dark: lerp(0.12, 0.5, inn) });
    const hold = b >= TL.feb11 ? 1.36 : 1.18;
    drawPad(ctx, b, lerp(205, 540, inn), lerp(1610, 1080, inn), lerp(0.42, hold, inn));
    if (b >= TL.feb11 && b < TL.feb11 + 0.5) { ctx.fillStyle = `rgba(200,20,30,${0.35 * (1 - (b - TL.feb11) / 0.5)})`; ctx.fillRect(0, 0, W, H); }
  } else if (b < TL.today - 1) {                       // the line runs again
    const away = ease.inCubic(clamp((b - TL.restart) / 0.6));
    await film(ctx, t, {});
    if (away < 1) drawPad(ctx, b, 540, lerp(1080, 2600, away), 1.36);
  } else {                                             // 90 years: the last 1937 page comes off. TODAY.
    const inn = ease.outCubic(clamp((b - (TL.today - 1)) / 1.0));
    await film(ctx, BT(TL.today - 1.01), { dark: lerp(0, 0.72, inn) });
    drawPad(ctx, b, 540, lerp(2600, 1060, inn), 1.36);
    if (b >= TL.today && b < TL.today + 0.5) { ctx.fillStyle = `rgba(239,230,207,${0.3 * (1 - (b - TL.today) / 0.5)})`; ctx.fillRect(0, 0, W, H); }
  }
  drawType(ctx, b);
  finish.apply(ctx, Math.round(t * 30), { grain: 0.04, vignette: 0.32 });
  return {};
};
ready = true;
