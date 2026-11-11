// GARY 2036 c2 / type: the words, set as print in the safe band (y 270-1250), Big Shoulders Display, cream with a dark edge so they read on
// sky, sand and street alike. The Program's sentence is stacked line by line and held whole; the year clock is one big number.
import { END_T, yOldAt, yNewAt, yearDeclineAt } from './gary2036.shots.js';
const FONT = '"Big Shoulders Display", "Anton", sans-serif';
const cl = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const outE = x => 1 - Math.pow(1 - cl(x), 3);
const CREAM = '#EFE6CF', GOLD = '#EFE6CF', RED = '#D71920';

// every word on screen: [t0, t1, text lines, y of the first line, size, style]
export const CUES = [
  // v6 (3 Oct, the client: "a more coherent throughline"): one question carried through: who a city is for.
  [0.0, 2.9, ['GARY, INDIANA.', '1906.'], 330, 150, 'main'],
  [3.1, 6.0, ['A CITY FOR', 'ONE COMPANY.'], 330, 150, 'red'],
  [9.0, 10.9, ['FIRST IRON', 'IN TWO YEARS.'], 760, 130, 'main'],
  [11.0, 12.6, ['100,000 PEOPLE', 'BY 1930.'], 760, 130, 'main'],
  [12.6, 14.4, ['THEY CALLED IT', 'THE CITY OF THE CENTURY.'], 760, 112, 'main'],
  [15.4, 16.4, ['178,320 PEOPLE', 'BY 1960.'], 760, 130, 'main'],
  [16.4, 18.6, ['THEN THE COMPANY', 'CUT THE JOBS.'], 760, 124, 'red'],
  // 8 Oct (archive audit item 14): the number under it, Gary Works employment. 1970: gary_history.md l.73 [V-m]. Now: "Some 4,000 workers are
  // employed there, according to figures provided by the city of Gary" (WBEZ, 29 May 2025); 2,256 (2023) has no source (research/scripts_final/gary2036.json)
  [16.7, 18.6, ['OVER 30,000 JOBS IN 1970.', 'ABOUT 4,000 IN 2025.'], 1040, 64, 'main'],
  [18.6, 20.2, ['AND THE PEOPLE', 'LEFT.'], 760, 130, 'main'],
  [20.2, 21.6, ['69,093', 'IN 2020.'], 760, 150, 'red'],
  [21.8, 27.6, ['THE CONSTRUCTION'], 760, 112, 'prog'], [22.7, 27.6, ['OF NEW CITIES'], 900, 112, 'prog'], [23.6, 27.6, ['ACROSS AMERICA'], 1040, 112, 'progHot'],
  [24.4, 27.6, ['THE PROGRAM \u00b7 AMERICAN COMMUNIST PARTY'], 1160, 48, 'sub'],
  [28.6, 31.2, ['THIS TIME, A CITY', 'FOR THE PEOPLE', 'WHO BUILD IT.'], 700, 112, 'main'],
  [36.2, 40.2, ['CONSTRUCT', 'LARGE-SCALE', 'PUBLIC WORKS.'], 880, 110, 'prog'], [36.5, 40.2, ['THE PROGRAM \u00b7 PUBLIC WORKS AND SERVICE ARMY'], 1240, 44, 'sub'],
  [56.2, 58.8, ['CONNECTED BY', 'HIGH-SPEED RAIL.'], 330, 116, 'progHot'],
  [59.1, 61.8, ['THE NEXT ONE', 'IS DOWN THE LINE.'], 330, 116, 'main'],
  [63.4, 67.2, ['A CITY OF THE CENTURY.', 'FOR EVERYONE IN IT.'], 330, 110, 'title'],
];
function fit(g, text, size, maxW) { g.font = `900 ${size}px ${FONT}`; const w = g.measureText(text).width; return w > maxW ? size * maxW / w : size; }
const STOCK = '#EFE6CF', INK = '#15110F', HRED = '#D71920';
// v6: the house (HANDBOOK, "the word is a printed object ... no shadow, no glow, no keyline, no bevel"): solid type on a solid band
function line(g, text, x, y, size, { fill = STOCK, band = INK, a = 1, wipe = 1, rise = 0, align = 'center', maxW = 960, strike = 1 } = {}) {
  const s = fit(g, text, size, maxW * 0.94); g.save(); g.globalAlpha = a; g.font = `900 ${s}px ${FONT}`; g.textAlign = align; g.textBaseline = 'alphabetic'; g.letterSpacing = `${Math.round(s * 0.012)}px`;
  const w = g.measureText(text).width, x0 = align === 'center' ? x - w / 2 : x, padX = s * 0.22, padY = s * 0.16;
  g.translate(x, y - s * 0.36); g.scale(strike, strike * (strike > 1 ? 1 : 1)); g.translate(-x, -(y - s * 0.36)); g.translate(0, rise);
  g.beginPath(); g.rect(x0 - padX - 4, y - s * 1.05, (w + 2 * padX + 8) * wipe, s * 1.5); g.clip();
  if (band) { g.fillStyle = band; g.fillRect(x0 - padX, y - s * 0.92 - padY * 0.4, w + 2 * padX, s * 0.92 + padY * 1.4); }
  g.fillStyle = fill; g.fillText(text, x, y); g.restore();
}
function yearNum(g, txt, a = 1, y = 420, size = 330, fill = STOCK) {
  g.save(); g.globalAlpha = a; g.font = `900 ${size}px ${FONT}`; g.textAlign = 'center'; g.letterSpacing = '6px';
  const w = g.measureText(txt).width; g.fillStyle = fill === STOCK ? HRED : INK; g.fillRect(540 - w / 2 - 40, y - size * 0.86, w + 80, size * 0.98);
  g.fillStyle = STOCK; g.fillText(txt, 540, y); g.restore();
}
export function drawType(g, t, { W, H }) {
  // the year clocks
  if (t >= END_T.stake && t < END_T.gary) { const T = t - END_T.stake, y = Math.floor(1906 + yOldAt(T) + 1e-6); yearNum(g, String(y), clWipe(T, 0.2), 400, 300); }
  if (t >= END_T.gary && t < END_T.decline) { const T = t - END_T.gary, y = Math.floor(yearDeclineAt(T) + 1e-6); yearNum(g, String(y), 1, 400, 300, T > 3.6 ? RED : GOLD); }
  if (t >= END_T.plan + 0.15 && t < END_T.stake2) yearNum(g, '2027', 1, 400, 330);
  if (t >= END_T.stake2 && t < END_T.build) { const T = t - END_T.stake2, y = 2027 + Math.min(9, Math.floor(yNewAt(T) + 1e-6)); yearNum(g, String(y), 1, 400, 330); }
  for (const [a, b, lines, y, size, style] of CUES) {
    if (t < a || t >= b) continue;
    const age = t - a, inA = outE(age / 0.28), outA = cl((b - t) / 0.22), al = Math.min(1, outA) * (a === 0 ? 1 : 1);
    const first = a === 0 ? 1 : inA;
    lines.forEach((tx, i) => {
      const fr = age * 30, strike = fr < 3 ? 1.16 - 0.16 * fr / 3 : fr < 5 ? 1 - 0.03 * Math.sin((fr - 3) / 2 * Math.PI) : 1;   // in from 116%, a 2-frame squash, settled
      const o = { a: al, wipe: 1, rise: 0, maxW: 960, strike: a === 0 ? 1 : strike }, yy = y + i * size * 1.22;
      if (style === 'sub') line(g, tx, 540, y + i * size * 1.2, size, { ...o, fill: INK, band: STOCK });
      else if (style === 'red') line(g, tx, 540, yy, size, { ...o, fill: STOCK, band: HRED });
      else if (style === 'progHot') line(g, tx, 540, yy, size, { ...o, fill: HRED, band: STOCK });
      else if (style === 'prog') line(g, tx, 540, yy, size, { ...o, fill: INK, band: STOCK });
      else if (style === 'title') line(g, tx, 540, yy, size, { ...o, fill: i === 0 ? STOCK : HRED, band: i === 0 ? HRED : STOCK });
      else line(g, tx, 540, yy, size, o);
    });
  }
}
const clWipe = (T, d) => cl(T / d);
