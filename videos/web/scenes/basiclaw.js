// THE BASIC LAW v2 (7 Oct 2026). The client on v1: "needs asset refinement, deeply in all aspects - throw that music away". v1 was a bead strip of
// lamps on a plank in a void (archive/basiclaw_v1_scene.js). v2 makes the argument with the record itself: an industrial strip-chart recorder.
// Its pen draws the real century of US industrial production (Federal Reserve INDPRO, monthly, 1919-2026, log scale; assets/basiclaw/indpro.json)
// on ruled chart paper. Under "the maximum capitalist profit" every crash is a hit and a stamp with its year and its fall (1944-46, the war's end,
// is drawn but not stamped: demobilization, not a crisis). Then the facts of the last fifty years (factory jobs 19.5 million in June 1979, 12.7
// million now; factory output still below its December 2007 peak: FRED MANEMP, IPMAN). Then the basic economic law of socialism: the pen takes red
// ink and the line climbs unbroken; each INSTEAD OF whips back to a stamped crash. UNBROKEN.: the whole sheet, black century and red line.
// Words verbatim (Stalin, Economic Problems of Socialism in the U.S.S.R., 1952, §7; THEORY_CORPUS S1, S3, S4). Score: songs2/basiclaw_e.py, 120 BPM.
import { W, H, loadFonts, outCanvas, Finish, closer, clamp, lerp, ease } from '../lib/kit.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const ctx = outCanvas();
await loadFonts();
await (async () => { const f = new FontFace('Big Shoulders Display', 'url(../node_modules/@fontsource/big-shoulders-display/files/big-shoulders-display-latin-900-normal.woff2)', { weight: '900' }); document.fonts.add(await f.load()); })();
const finish = new Finish(1952);
const H01 = x => { const s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const BT = b => b * 0.5;
const inOutSine = u => 0.5 - 0.5 * Math.cos(Math.PI * u);

// beats (120 BPM)
export const TL = { purpose: 0, cap: 11, run: 19, facts: 46, soc: 52, p1: 62, a1: 66, p2: 70, a2: 74, p3: 78, a3: 82, unbroken: 86, mark: 92, end: 100 };
const DATA = await (await fetch('../assets/basiclaw/indpro.json')).json();
const PTS = DATA.points;                                   // [year, index]
const vAt = y => { if (y <= PTS[0][0]) return PTS[0][1]; let i = Math.min(PTS.length - 2, Math.max(0, Math.floor((y - PTS[0][0]) * 12)));
  while (i < PTS.length - 2 && PTS[i + 1][0] < y) i++; while (i > 0 && PTS[i][0] > y) i--; const a = PTS[i], c = PTS[i + 1]; return lerp(a[1], c[1], clamp((y - a[0]) / (c[0] - a[0]))); };
const Y_END = PTS[PTS.length - 1][0], V_END = PTS[PTS.length - 1][1];
// the plan: from the last reading the red line climbs unbroken (5 % a year, steady, no breaks)
const redV = y => V_END * Math.pow(1.05, y - Y_END);
// the crises (trough year, span, fall), from the series itself
export const CRISES = [[1921.17, '1920–21', '−33%'], [1932.5, '1929–32', '−54%'], [1938.33, '1937–38', '−32%'], [1958.25, '1957–58', '−14%'],
  [1975.33, '1973–75', '−13%'], [1982.92, '1980–82', '−10%'], [2009.42, '2007–09', '−17%'], [2020.25, '2018–20', '−19%']];
// the pen's year at beat b: the century in 27 beats, each crash drawn over a beat or two
const KEYS = [[19, 1919.0], [20.3, 1920.0], [21.5, 1921.2], [23, 1929.5], [25, 1932.5], [26.6, 1937.4], [28.4, 1938.4], [30.6, 1957.1], [32.2, 1958.3],
  [34.2, 1973.9], [35.6, 1975.4], [36.6, 1980.1], [37.8, 1982.9], [40.4, 2007.9], [41.8, 2009.5], [43, 2018.7], [44.2, 2020.3], [46, Y_END]];
export const CRASH_BEATS = [21.5, 25, 28.4, 32.2, 35.6, 37.8, 41.8, 44.2];
function penYear(b) {
  if (b <= KEYS[0][0]) return KEYS[0][1];
  for (let i = 0; i < KEYS.length - 1; i++) { const [b0, y0] = KEYS[i], [b1, y1] = KEYS[i + 1];
    if (b < b1) { const u = (b - b0) / (b1 - b0); return lerp(y0, y1, CRASH_BEATS.includes(b1) ? inOutSine(u) : u); } }
  if (b < TL.soc) return Y_END;
  return Y_END + (b - TL.soc) * 0.55;                                             // the red line: ~0.55 years a beat
}

// ------------------------------------------------------------------ the sheet's geometry
const PX = 60;                        // px per year (at zoom 1)
const K = 1050;                       // px per decade of the index (log scale)
const Y0 = 1690;                      // y of index 4 at zoom 1
const yOf = v => Y0 - (Math.log10(v) - Math.log10(4)) * K;
const PEN_X = 760;
const FONT = '"Big Shoulders Display", "Anton", sans-serif';
const STOCK = '#EFE6CF', INK = '#15110F', HRED = '#C8141E', PAPER = '#ece4cf', RULE = 'rgba(46,110,92,', BLACK = '#1b1714';

// the paper's tooth (one tile, reused)
const TOOTH = (() => { const c = document.createElement('canvas'); c.width = 512; c.height = 512; const g = c.getContext('2d'); const id = g.createImageData(512, 512), a = id.data;
  for (let i = 0; i < a.length; i += 4) { const n = (H01(i * 0.13) - 0.5) * 22 + (H01(Math.floor(i / 4 / 512 / 3) * 7.7) - 0.5) * 8; a[i] = 128 + n; a[i + 1] = 128 + n; a[i + 2] = 128 + n; a[i + 3] = 26; }
  g.putImageData(id, 0, 0); return c; })();

// the camera: x = the year under the pen, a vertical offset (the red line climbs off the sheet), a zoom
// the camera follows the pen up and down, on the line's average over a few years (so a crash is seen falling, not chased)
const smoothV = (yy, f = vAt) => { let s = 0; for (let k = -6; k <= 2; k++) s += Math.log10(f(yy + k * 0.6)); return Math.pow(10, s / 9); };
const PEN_Y = 1080;
const blackDy = yy => PEN_Y - yOf(smoothV(Math.max(1921, yy)));
const homeDy = yy => PEN_Y - 120 - yOf(redV(yy));
function cam(b) {
  const yr = penYear(Math.min(b, TL.soc - 0.01));
  let cx = Math.max(yr, 1919 + (PEN_X - 140) / PX), dy = blackDy(yr), z = 1, zy = 1;
  if (b >= TL.soc) { const yy = penYear(b), u = ease.inOutCubic(clamp((b - TL.soc) / 3)); cx = yy; dy = lerp(blackDy(Y_END), homeDy(yy), u); }
  // the INSTEAD OFs: whip back to a stamped crash, hold, then whip home to the red pen
  for (const [p0, yb] of [[TL.p1, 1932.5], [TL.p2, 1982.9], [TL.p3, 2009.42]]) {
    if (b >= p0 && b < p0 + 4) {
      const out = ease.inOutCubic(clamp((b - p0) / 0.5)), back = ease.inOutCubic(clamp((b - (p0 + 3.5)) / 0.5));
      const home = penYear(b), u = out * (1 - back);
      cx = lerp(home, yb + 3, u); dy = lerp(homeDy(home), blackDy(yb), u);
    }
  }
  if (b >= TL.unbroken) {                                                         // the whole sheet
    const u = ease.inOutCubic(clamp((b - TL.unbroken) / 4)), yy = penYear(b), zx = 0.115;
    z = lerp(1, zx, u); zy = lerp(1, 0.42, u); cx = lerp(yy, 1919 + (PEN_X - 70) / (PX * zx), u);
    const mid = (yOf(4.8) + yOf(redV(yy))) / 2; dy = lerp(homeDy(yy), 1000 - mid, u);
  }
  return { cx, dy, z, zy };
}
const sx = (C, year) => PEN_X + (year - C.cx) * PX * C.z;
const sy = (C, y) => 1000 + (y + C.dy - 1000) * C.zy;

// ------------------------------------------------------------------ drawing the recorder
function drawPaper(g, C) {
  g.fillStyle = PAPER; g.fillRect(0, 0, W, H);
  g.save(); g.globalCompositeOperation = 'multiply'; for (let x = 0; x < W; x += 512) for (let y = 0; y < H; y += 512) g.drawImage(TOOTH, x, y); g.restore();
  // horizontal ruling (value): fine every 30 px, bold every 150 px
  if (30 * C.zy > 3) for (let k = -200; k < 200; k++) { const y = sy(C, Y0 - k * 30); if (y < 140 || y > 1790) continue;
    g.fillStyle = RULE + (k % 5 === 0 ? 0.55 : 0.2) + ')'; g.fillRect(0, y, W, k % 5 === 0 ? 2 : 1); }
  // vertical ruling (time): a line a year, bold every ten, the decade printed at the foot
  const y0 = Math.floor(C.cx - (PEN_X + 40) / (PX * C.z)), y1 = Math.ceil(C.cx + (W - PEN_X + 40) / (PX * C.z));
  for (let yr = y0; yr <= y1; yr++) {
    const x = sx(C, yr), dec = yr % 10 === 0; if (!dec && C.z < 0.5) continue;
    g.fillStyle = RULE + (dec ? 0.6 : 0.22) + ')'; g.fillRect(x, 140, dec ? 2 : 1, 1650);
    if (dec && (C.z > 0.3 || yr % 20 === 0)) { g.fillStyle = 'rgba(46,110,92,0.85)'; g.font = `900 ${Math.round(34 * Math.max(0.8, C.z))}px ${FONT}`; g.textAlign = 'center'; g.fillText(String(yr), x, 1772); }
  }
  // the sprocket margins
  for (const [ya, yb2] of [[96, 140], [1790, 1834]]) { g.fillStyle = '#ddd2b6'; g.fillRect(0, ya, W, yb2 - ya); g.fillStyle = '#b9ad90';
    const off = ((C.cx * PX * C.z) % 46 + 46) % 46; for (let x = -off; x < W; x += 46) { g.beginPath(); g.ellipse(x, (ya + yb2) / 2, 8, 6, 0, 0, Math.PI * 2); g.fill(); } }
}
function tracePath(C, a, c, f) {                         // the index from year a to year c through value function f
  const p = new Path2D(); let first = true; const stepY = Math.max(1 / 12, 0.6 / (PX * C.z));
  for (let y = a; y <= c + 1e-6; y += stepY) { const X = sx(C, y), Y = sy(C, yOf(f(y))); if (X < -40 || X > W + 40) { first = true; continue; } first ? p.moveTo(X, Y) : p.lineTo(X, Y); first = false; }
  p.lineTo(sx(C, c), sy(C, yOf(f(c)))); return p;
}
function drawTrace(g, C, b) {
  const yr = penYear(Math.min(b, TL.soc - 0.01));
  if (b >= TL.run) {
    const p = tracePath(C, 1919, yr, vAt);
    g.save(); g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = 'rgba(27,23,20,0.22)'; g.lineWidth = 10 * Math.max(0.5, C.z); g.stroke(p);   // the ink's bleed
    g.strokeStyle = BLACK; g.lineWidth = 4.5 * Math.max(0.6, C.z); g.stroke(p); g.restore();
  }
  if (b >= TL.soc) {
    const p = tracePath(C, Y_END, penYear(b), redV);
    g.save(); g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = 'rgba(200,20,30,0.25)'; g.lineWidth = 13 * Math.max(0.5, C.z); g.stroke(p);
    g.strokeStyle = HRED; g.lineWidth = 6.5 * Math.max(0.6, C.z); g.stroke(p); g.restore();
  }
}
function stamp(g, x, y, top, bot, age, z = 1) {             // a rubber stamp: red ink, a box, struck in
  if (age < 0) return; const s = (age < 0.08 ? lerp(1.5, 1, ease.outCubic(age / 0.08)) : 1) * Math.max(0.34, z), rot = -0.08 + H01(Math.round(x)) * 0.06;
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(s, s); g.globalAlpha = 0.88; g.globalCompositeOperation = 'multiply';
  g.strokeStyle = HRED; g.lineWidth = 6; g.strokeRect(-120, -72, 240, 144);
  g.fillStyle = HRED; g.textAlign = 'center'; g.font = `900 46px ${FONT}`; g.fillText(top, 0, -16); g.font = `900 70px ${FONT}`; g.fillText(bot, 0, 52);
  g.restore();
}
function drawStamps(g, C, b) {
  CRISES.forEach(([yt, lab, pct], i) => {
    const bb = CRASH_BEATS[i]; if (b < bb) return;
    const x = sx(C, yt), y = sy(C, yOf(vAt(yt))) + 160 * Math.max(0.5, C.zy);
    if (x < -200 || x > W + 200) return;
    stamp(g, x, y, lab, pct, BT(b - bb), C.z);
  });
}
function drawPen(g, C, b) {
  if (b >= TL.unbroken + 1) return;
  const red = b >= TL.soc;
  let x, y;
  if (red) { const yy = penYear(b); x = sx(C, yy); y = sy(C, yOf(redV(yy))); }
  else if (b >= TL.run) { const yy = penYear(b); x = sx(C, yy); y = sy(C, yOf(vAt(yy))); }
  else { x = sx(C, 1919); y = sy(C, yOf(vAt(1919))) - 30 * (1 - ease.inCubic(clamp(b - (TL.run - 1)))); }   // lifted, then down onto the paper
  // the pen carriage: a steel rail across the sheet at the pen's x, a carriage block riding it, the stylus at its foot
  g.save();
  g.fillStyle = '#3a3d42'; g.fillRect(x + 22, 140, 12, 1650); g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x + 24, 140, 3, 1650);
  g.fillStyle = '#26282c'; g.fillRect(x + 4, y - 58, 52, 70); g.fillStyle = '#4b4f55'; g.fillRect(x + 8, y - 54, 44, 8);
  g.fillStyle = red ? HRED : '#1b1714'; g.beginPath(); g.ellipse(x + 30, y - 28, 13, 10, 0, 0, Math.PI * 2); g.fill();            // the ink well
  g.fillStyle = 'rgba(230,232,236,0.85)'; g.beginPath(); g.arc(x + 26, y - 31, 3.5, 0, Math.PI * 2); g.fill();
  g.strokeStyle = red ? HRED : '#1b1714'; g.lineWidth = 4; g.beginPath(); g.moveTo(x + 10, y + 6); g.lineTo(x, y); g.stroke(); g.restore();
}
function drawHousing(g) {                                 // the recorder's enamel case and its plate; the glass over the sheet
  g.fillStyle = '#1d2124'; g.fillRect(0, 1834, W, H - 1834); g.fillStyle = '#2b3034'; g.fillRect(0, 1834, W, 6);
  g.fillStyle = '#c9b98f'; g.fillRect(250, 1856, 580, 44); g.fillStyle = '#2a241c'; g.font = `900 26px ${FONT}`; g.textAlign = 'center';
  g.fillText('INDUSTRIAL PRODUCTION · U.S. · 1919–2026', 540, 1887);
  g.fillStyle = '#1d2124'; g.fillRect(0, 0, W, 96); g.fillStyle = '#2b3034'; g.fillRect(0, 90, W, 6);
  const gr = g.createLinearGradient(0, 96, W, 1834); gr.addColorStop(0, 'rgba(255,255,255,0.05)'); gr.addColorStop(0.45, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.04)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 96, W, 1738);
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
const CUES = [
  [0.6, 10.8, ['PLANNING'], 260, 150, 'main'], [3, 10.8, ['CAN YIELD NOTHING'], 260 + 183, 124, 'main'],
  [6, 10.8, ['IF IT IS NOT KNOWN'], 260 + 183 + 151, 118, 'main'], [8.6, 10.8, ['FOR WHAT PURPOSE.'], 260 + 183 + 151 + 144, 132, 'hot'],
  [9.2, 10.8, ['STALIN · ECONOMIC PROBLEMS OF SOCIALISM IN THE U.S.S.R. · 1952'], 1000, 34, 'sub'],
  [11, 14.5, ['THE BASIC ECONOMIC LAW', 'OF MODERN CAPITALISM:'], 230, 100, 'main'],
  [14.5, 21, ['THE SECURING OF', 'THE MAXIMUM', 'CAPITALIST PROFIT'], 230, 120, 'main'],
  [19.4, 21, ['U.S. INDUSTRIAL PRODUCTION · FEDERAL RESERVE · 1919–2026'], 230 + 120 * 1.22 * 3, 30, 'sub'],
  [29, 35, ['FROM BOOM TO CRISIS', 'AND FROM CRISIS', 'TO BOOM'], 230, 110, 'main'],
  [TL.facts, 49, ['FACTORY JOBS:', '19.5 MILLION IN 1979.', '12.7 MILLION NOW.'], 230, 108, 'main'],
  [49, TL.soc, ['FACTORY OUTPUT:', 'STILL BELOW 2007.'], 230, 120, 'main'],
  [TL.soc, 55, ['THE BASIC ECONOMIC LAW', 'OF SOCIALISM:'], 230, 104, 'hot'],
  [55, TL.p1, ['THE MAXIMUM SATISFACTION', 'OF THE CONSTANTLY RISING', 'MATERIAL AND CULTURAL', 'REQUIREMENTS OF', 'THE WHOLE OF SOCIETY'], 230, 88, 'hot'],
  [TL.p1, TL.a1, ['INSTEAD OF', 'MAXIMUM PROFITS'], 230, 132, 'main'],
  [TL.a1, TL.p2, ['MAXIMUM SATISFACTION', 'OF THE MATERIAL AND', 'CULTURAL REQUIREMENTS', 'OF SOCIETY;'], 230, 96, 'hot'],
  [TL.p2, TL.a2, ['INSTEAD OF', 'FROM BOOM TO CRISIS', 'AND FROM CRISIS', 'TO BOOM'], 230, 108, 'main'],
  [TL.a2, TL.p3, ['UNBROKEN EXPANSION', 'OF PRODUCTION;'], 230, 118, 'hot'],
  [TL.p3, TL.a3, ['INSTEAD OF', 'PERIODIC BREAKS', 'IN TECHNICAL', 'DEVELOPMENT,'], 230, 112, 'main'],
  [TL.a3, TL.unbroken - 0.1, ['AN UNBROKEN PROCESS', 'OF PERFECTING', 'PRODUCTION ON THE BASIS', 'OF HIGHER TECHNIQUES.'], 230, 96, 'hot'],
  [TL.unbroken + 0.6, TL.mark - 0.1, ['UNBROKEN.'], 260, 210, 'red'],
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
  if (b >= TL.mark) { closer(ctx, t - BT(TL.mark)); return {}; }
  const C = cam(b);
  let jx = 0, jy = 0;                                                            // a jolt on each crash: the recorder takes the hit
  for (const cb of CRASH_BEATS) { const a = BT(b - cb); if (a >= 0 && a < 0.25) { const k = Math.exp(-a * 18) * 9; jx += Math.sin(a * 140) * k; jy += Math.cos(a * 110) * k; } }
  ctx.save(); ctx.translate(jx, jy);
  drawPaper(ctx, C); drawTrace(ctx, C, b); drawStamps(ctx, C, b); drawPen(ctx, C, b);
  ctx.restore();
  drawHousing(ctx);
  for (const cb of CRASH_BEATS) { const a = BT(b - cb); if (a >= 0 && a < 0.3) { ctx.fillStyle = `rgba(200,20,30,${0.2 * (1 - a / 0.3)})`; ctx.fillRect(0, 0, W, H); } }
  drawType(ctx, b);
  finish.apply(ctx, Math.round(t * 30), { grain: 0.035, vignette: 0.28 });
  return {};
};
ready = true;
