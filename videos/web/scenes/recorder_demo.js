// RECORDER DEMO (8 Oct 2026): lib/fx/recorder.js on two real series, 30 s. Not a piece: the studio's proof that any data piece can put a
// series on ruled chart paper with a pen that draws it on the beat (120 BPM grid; no score yet). Two sheets of 15 s: the pen is drawing on the
// sheet's first frame and draws the whole series in 11.5 s, the last stamp strikes, a beat later the sheet pulls back (1 s) and the whole
// sheet holds 2 s under its numbers. Frame 0 carries the claim, read from the series.
//   1. FACTORY JOBS: All Employees, Manufacturing, thousands of persons, seasonally adjusted, monthly, Jan 1939 - Sep 2026. U.S. Bureau of
//      Labor Statistics, Current Employment Statistics (CES3000000001), via FRED (MANEMP), https://fred.stlouisfed.org/series/MANEMP
//      (FRED updated 2 Oct 2026; fetched 8 Oct 2026). Stamped: the record, 19,553 in June 1979; the last reading, 12,652 in Sep 2026: -35 %.
//   2. LABOR'S SHARE: Nonfarm Business Sector: Labor Share for All Workers, index 2017=100, seasonally adjusted, quarterly, Q1 1947 - Q2 2026.
//      U.S. Bureau of Labor Statistics, Productivity and Costs, via FRED (PRS85006173), https://fred.stlouisfed.org/series/PRS85006173 (FRED
//      updated 3 Sep 2026; fetched 8 Oct 2026). Stamped: the record high, 117.123 in Q4 1960; the record low, 93.446 in Q2 2026 (the latest).
// The values are exactly as fetched (assets/recorder_demo/*.csv, the FRED download; *.json carries each value as a number and as its CSV
// text). Every number and date printed is read from the series at run time, not typed in. The pen slows into each fall the series shows
// (falls(): the zigzag's falls, and inside a long slide its deepest drops within maxSpan; MANEMP's 1944-46 is demobilization, not a crash,
// and is left out as BASIC LAW left it out) and lands each fall's peak and trough on a beat; the stamps sit on the series' own extreme
// readings (extreme()), each pushed clear of the line on every camera it is seen through (rec.clearDy).
import { outCanvas, Finish, clamp } from '../lib/kit.js';
import { loadBands, cueType } from '../lib/fx/bands.js';
import { Recorder, EASE, falls, extreme, last, pct, pace } from '../lib/fx/recorder.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const ctx = outCanvas();
await loadBands();
const finish = new Finish(1939);
const load = async n => (await (await fetch(`../assets/recorder_demo/${n}.json`)).json());
const MAN_D = await load('manemp'), LAB_D = await load('labor_share');
const MP = MAN_D.points, LP = LAB_D.points;

// seconds (120 BPM: a beat is 0.5 s). Each sheet draws from its first frame to its end; the pullback starts a beat after the last strike
export const T = { man: 0, manEnd: 11.5, lab: 15, labEnd: 26.5, end: 30 };
const BEAT = 0.5, PULL = 1.0, HRED = '#C8141E';
const MONTHS = ['JAN', 'FEB', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUG', 'SEPT', 'OCT', 'NOV', 'DEC'];
const month = x => `${MONTHS[Math.round((x - Math.floor(x)) * 12)]} ${Math.floor(x)}`;          // 1979.4167 -> JUNE 1979
const quarter = x => `Q${Math.round((x - Math.floor(x)) * 4) + 1} ${Math.floor(x)}`;            // 2026.25 -> Q2 2026
const persons = v => (v * 1000).toLocaleString('en-US');                                         // thousands -> 19,553,000
const asFetched = (D, r) => D.text[r.i];                                     // a reading as FRED printed it (the CSV text: 114.620 keeps its 0)

// ------------------------------------------------------------------ sheet 1: factory jobs (linear, fit to the band, the camera at rest vertically)
const M_TOP = extreme(MP, 'max'), M_NOW = last(MP), M_FALLS = falls(MP, { min: 0.1, maxSpan: 4, exclude: [[1944, 1947]] });   // the crashes the pen slows into
const MAN = new Recorder({
  series: [{ points: MP, ink: '#1b1714', width: 4.5 }],
  x: { from: MP[0][0], to: M_NOW.x, pxPerUnit: 40, fine: 1, bold: 10 },
  y: { scale: 'linear', from: 8000, to: 21000, band: [700, 1630], fine: 1000, bold: 5000, label: v => `${v / 1000} M` },
  housing: { plate: 'ALL EMPLOYEES, MANUFACTURING · U.S. · 1939–2026 · BLS / FRED MANEMP' },
  keys: pace({ t0: T.man, t1: T.manEnd, x0: MP[0][0], x1: M_NOW.x, falls: M_FALLS, fallBeats: 2, beat: BEAT, pins: [M_TOP.x] }),
});
const MAN_STAMPS = [
  { x: M_TOP.x, top: month(M_TOP.x), bottom: persons(M_TOP.v), at: MAN.timeAt(M_TOP.x), dy: -170 },
  { x: M_NOW.x, top: `${month(M_NOW.x)} · ${persons(M_NOW.v)}`, bottom: pct(M_NOW.v / M_TOP.v - 1), at: T.manEnd, dx: -150, dy: 170 },
];
function manExtra(g, C, rec, t) {                    // the 1979 level ruled on in red behind the pen; at the end, the drop from it to now
  if (t < MAN_STAMPS[0].at) return;
  const yT = rec.sy(C, rec.yOf(M_TOP.v)), x0 = rec.sx(C, M_TOP.x), x1 = rec.sx(C, Math.min(rec.penAt(t), M_NOW.x));
  g.strokeStyle = HRED; g.globalAlpha = 0.8; g.lineWidth = 3; g.setLineDash([14, 10]); g.beginPath(); g.moveTo(x0, yT); g.lineTo(x1, yT); g.stroke();
  const u = EASE.outCubic(clamp((t - T.manEnd) / 0.3)); if (u <= 0) return;
  const xn = rec.sx(C, M_NOW.x), yN = rec.sy(C, rec.yOf(M_NOW.v));
  g.setLineDash([]); g.lineWidth = 5; g.beginPath(); g.moveTo(xn, yT); g.lineTo(xn, yT + (yN - yT) * u); g.moveTo(xn - 14, yT); g.lineTo(xn + 14, yT); g.stroke();
}

// ------------------------------------------------------------------ sheet 2: labor's share (linear; the record low is the latest reading)
const L_HI = extreme(LP, 'max'), L_LO = extreme(LP, 'min'), L_NOW = last(LP), L_FALLS = falls(LP, { min: 0.05, maxSpan: 6 });
const LAB = new Recorder({
  series: [{ points: LP, ink: '#1b1714', width: 4.5 }],
  x: { from: LP[0][0], to: L_NOW.x, pxPerUnit: 40, fine: 1, bold: 10 },
  y: { scale: 'linear', from: 85, to: 120, band: [700, 1630], fine: 1, bold: 5, label: v => String(v) },
  housing: { plate: 'LABOR SHARE · NONFARM BUSINESS · INDEX 2017=100 · BLS / FRED PRS85006173' },
  keys: pace({ t0: T.lab, t1: T.labEnd, x0: LP[0][0], x1: L_NOW.x, falls: L_FALLS, fallBeats: 2, beat: BEAT, pins: [L_HI.x] }),
});
const LAB_STAMPS = [
  { x: L_HI.x, top: `RECORD HIGH · ${quarter(L_HI.x)}`, bottom: asFetched(LAB_D, L_HI), at: LAB.timeAt(L_HI.x), dy: -170 },
  { x: L_LO.x, top: `RECORD LOW · ${quarter(L_LO.x)}`, bottom: asFetched(LAB_D, L_LO), at: LAB.timeAt(L_LO.x), dx: -150, dy: 170 },
];
function labExtra(g, C, rec, t) {                    // once the low is struck: its level ruled back across the whole sheet; nothing ever sat under it
  const u = EASE.inOutCubic(clamp((t - LAB_STAMPS[1].at - 0.25) / 1.0)); if (u <= 0) return;
  const y = rec.sy(C, rec.yOf(L_LO.v)), x1 = rec.sx(C, L_LO.x), x0 = rec.sx(C, LP[0][0]);
  g.strokeStyle = HRED; g.globalAlpha = 0.8; g.lineWidth = 3; g.setLineDash([14, 10]); g.beginPath(); g.moveTo(x1, y); g.lineTo(x1 + (x0 - x1) * u, y); g.stroke();
}

// ------------------------------------------------------------------ the two sheets, their cameras (follow the pen, then pull back to the whole sheet)
export const SHEETS = [
  { rec: MAN, from: T.man, end: T.manEnd, stamps: MAN_STAMPS, extra: manExtra, whole: MAN.frame(MP[0][0], M_NOW.x, 8000, 21000, { padX: 70 }) },
  { rec: LAB, from: T.lab, end: T.labEnd, stamps: LAB_STAMPS, extra: labExtra, whole: LAB.frame(LP[0][0], L_NOW.x, 85, 120, { padX: 70 }) },
];
export const sheetAt = t => (t < T.lab ? SHEETS[0] : SHEETS[1]);
export const settled = S => S.end + BEAT + PULL;     // the whole sheet at rest: its numbers come in here
export function camAt(S, t) {                        // the pullback starts a beat after the last strike, so the stamp reads full size first
  const u = EASE.inOutCubic(clamp((t - S.end - BEAT) / PULL));
  return u > 0 ? S.rec.mix(S.rec.cam(t), S.whole, u) : S.rec.cam(t);
}
// each stamp is pushed off the line on every camera it is seen through: at rest as it lands (150 %), each frame of the pullback, the whole sheet
SHEETS.forEach(S => { S.hits = S.stamps.map(s => s.at);
  for (const s of S.stamps) { s.dy = S.rec.clearDy(ctx, S.rec.cam(s.at), s, { k: 1.5 });
    for (let f = 0; f <= 30 * PULL; f++) s.dy = S.rec.clearDy(ctx, camAt(S, S.end + BEAT + f / 30), s); } });

// ------------------------------------------------------------------ the words (house bands; every figure read from the series)
export const CUES = [
  [T.man, T.man + 3, ['FACTORY JOBS'], 330, 150, 'main'],                                          // frame 0: the topic and the claim
  [T.man, T.man + 3, [`${pct(M_NOW.v / M_TOP.v - 1)} SINCE ${month(M_TOP.x)}`], 461, 92, 'red'],
  [T.man + 0.25, T.man + 3, [`ALL EMPLOYEES, MANUFACTURING · U.S. · ${Math.floor(MP[0][0])}–${Math.floor(M_NOW.x)}`], 525, 34, 'sub'],
  [settled(SHEETS[0]), T.lab, [`${month(M_TOP.x)}: ${persons(M_TOP.v)}`, `${month(M_NOW.x)}: ${persons(M_NOW.v)}`], 330, 84, 'main'],
  [settled(SHEETS[0]) + BEAT, T.lab, ['BLS VIA FRED (MANEMP) · SEASONALLY ADJUSTED'], 540, 30, 'sub'],
  [T.lab, T.lab + 3, ["LABOR'S SHARE"], 330, 150, 'main'],
  [T.lab + 0.25, T.lab + 3, [`NONFARM BUSINESS · INDEX 2017=100 · ${Math.floor(LP[0][0])}–${Math.floor(L_NOW.x)}`], 440, 34, 'sub'],
  [settled(SHEETS[1]), T.end, ['RECORD LOW:', quarter(L_LO.x)], 330, 120, 'hot'],
  [settled(SHEETS[1]) + BEAT, T.end, ['BLS VIA FRED (PRS85006173) · SEASONALLY ADJUSTED'], 540, 30, 'sub'],
];

// ------------------------------------------------------------------ the frame
window.renderFrame = async (t) => {
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.setTransform(1, 0, 0, 1, 0, 0);
  const S = sheetAt(t);
  S.rec.draw(ctx, t, { cam: camAt(S, t), stamps: S.stamps, hits: S.hits, extra: (g, C, rec) => S.extra(g, C, rec, t) });
  cueType(ctx, t, CUES);
  finish.apply(ctx, Math.round(t * 30), { grain: 0.035, vignette: 0.28 });
  return {};
};
ready = true;
