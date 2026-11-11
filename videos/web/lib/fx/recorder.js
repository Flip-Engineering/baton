// RECORDER (8 Oct 2026): the studio's strip-chart recorder, for data pieces. Lifted from THE BASIC LAW v2 (scenes/basiclaw.js keeps its own
// copy until it is next touched): a real series on ruled chart paper, drawn by a pen on a steel carriage while the paper scrolls under it,
// red rubber stamps struck on the beat, the enamel housing with its plate and the glass over the sheet. All of it is a pure function of t and
// a camera, so it renders frame by frame; the maths (scales, keys, camera, paths, stamp anchors and boxes) needs no canvas and is checked in
// node (research/capabilities/recorder.md). Demo: scenes/recorder_demo.js (FRED MANEMP and PRS85006173).
//
//   import { Recorder, falls, extreme, last, pct, pace, projection } from '../lib/fx/recorder.js';
//   const rec = new Recorder({
//     series: [{ points: [[x, v], ...], ink, width, bleed, bleedWidth, follow, label }, { ...projection(last(P), 0.05), ink: '#C8141E', width: 6.5 }],
//     x: { from, to, pxPerUnit, fine: 1, bold: 10, minPx: 14, labelPx: 110, label },           // x is any unit (decimal years in practice)
//     y: { scale: 'log' | 'linear', from, to, pxPerUnit, band: [top, bottom], base, follow, followFrom, fine, bold, rule: { px, bold, minPx }, label },
//     paper: { stock, rule, top, bottom, tooth }, penX: 760, penY: 1080, lead: 140, mid, housing: { plate: 'TEXT' } | true | false,
//     stampFit: { scale: C => s, offset: (C, s) => k },
//     keys: pace({ t0, t1, x0, x1, falls: falls(P, { min: 0.1, maxSpan: 4 }), fallBeats: 2, beat: 0.5 }) });   // or by hand: [[t, x], [t, x, 'sine'], ...]
//   Every series with readings sets the defaults: x.from..x.to spans them all (a function series adds its from), y.from..y.to holds every
//   reading. The constructor throws, naming the fault, on what would draw nothing: a series with no readings, a reading that is not a number
//   (FRED's '.'), x not ascending, a reading <= 0 on a log sheet, y.from >= y.to, keys that run backwards.
//   rec.penAt(t) -> x   (rec.timeAt(x) inverts it: when the pen reaches x, e.g. a stamp's `at`)
//   rec.cam(t, { si, at, offset }) -> { cx, dy, z, zy } follows the pen; rec.frame(x0, x1, v0, v1, { into }) frames a box; rec.mix(A, B, u) whips
//   rec.draw(ctx, t, { cam, stamps: [{ x, top, bottom, at, dx, dy, si }], hits: [t, ...], extra(g, C, rec), upTo, pen, pens }) -> the camera used
//   rec.clearDy(ctx, C, stamp, { k }) -> the stamp's dy pushed just far enough that its box clears the line on camera C (struck size k)
// Fonts and the house type stay outside: the piece loads the face (bands.js loadBands) and sets its words with cueType over this.

const FONT = '"Big Shoulders Display", "Anton", sans-serif';             // the house face (bands.js FONT); loaded by the piece, not here
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, x) => a + (b - a) * x;
const H01 = x => { const s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const outCubic = u => 1 - Math.pow(1 - clamp(u), 3), inCubic = u => Math.pow(clamp(u), 3);
export const EASE = { lin: u => u, sine: u => 0.5 - 0.5 * Math.cos(Math.PI * u), inOutCubic: u => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2), outCubic, inCubic };
const rgba = (hex, a) => { const n = parseInt(hex.slice(1, 7), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
const niceStep = r => { const p = 10 ** Math.floor(Math.log10(r)), m = r / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; };
const isMult = (v, s) => Math.abs(v / s - Math.round(v / s)) < 1e-6;
const M = 24;                                                         // px the paper is drawn past the frame's edges: a jolt never bares them

// ------------------------------------------------------------------ reading a series (P = [[x, v], ...], x ascending)
export const last = P => ({ x: P[P.length - 1][0], v: P[P.length - 1][1], i: P.length - 1 });
export function extreme(P, kind = 'max', x0 = -Infinity, x1 = Infinity) {            // the first reading at the series' max (or min) in [x0, x1]
  let b = -1; for (let i = 0; i < P.length; i++) { const [x, v] = P[i]; if (x < x0 || x > x1) continue; if (b < 0 || (kind === 'max' ? v > P[b][1] : v < P[b][1])) b = i; }
  return b < 0 ? null : { x: P[b][0], v: P[b][1], i: b };
}
export const pct = (f, d = 0) => `${f < 0 ? '−' : '+'}${Math.abs(f * 100).toFixed(d)}%`;               // a true minus, as the stamps print it
// the falls, from the series itself. First a zigzag: a peak is confirmed when the series falls `min` below it, its trough when the series
// climbs `min` back above that; each confirmed peak-to-trough is a fall (relative, or absolute with abs: true for series that cross zero).
// The fall still under way at the last reading is reported `open` (its trough is the low so far). With maxSpan, a leg longer than that is a
// slide, and the zigzag cannot see the crashes inside it: on MANEMP 1979-2010 is one leg, since the 1982, 2004 and 2010 lows never rebound
// by `min`. So a slide is searched again: its deepest drop within maxSpan, if it is at least `min`, is a fall, and the stretches either side
// of it are searched the same way. Such a fall's peak is the high and its trough the low of its own span, but no rebound is asked of it.
// No fall longer than maxSpan is returned. exclude: [[xa, xb], ...] drops falls whose trough lies in a span (BASIC LAW's 1944-46).
export function falls(P, { min = 0.1, abs = false, maxSpan = Infinity, exclude = [], open = true } = {}) {
  const below = (v, ref) => abs ? v <= ref - min : v <= ref * (1 - min), above = (v, ref) => abs ? v >= ref + min : v >= ref * (1 + min);
  const out = [], pt = i => ({ x: P[i][0], v: P[i][1], i }), drop = (h, l) => abs ? P[l][1] - P[h][1] : P[l][1] / P[h][1] - 1;
  const push = (h, l, o) => out.push({ peak: pt(h), trough: pt(l), fall: drop(h, l), span: P[l][0] - P[h][0], open: o });
  const within = (a, b, o) => {                                       // readings a..b of a slide: the deepest drop within maxSpan, then each side
    let h = -1, l = -1; for (let i = a; i < b; i++) for (let j = i + 1; j <= b && P[j][0] - P[i][0] <= maxSpan; j++) if (h < 0 || drop(i, j) < drop(h, l)) { h = i; l = j; }
    if (h < 0 || !below(P[l][1], P[h][1])) return; within(a, h, false); push(h, l, o && l === b); within(l, b, o);
  };
  const leg = (h, l, o) => (P[l][0] - P[h][0] <= maxSpan ? push(h, l, o) : within(h, l, o));
  let mode = 0, hi = 0, lo = 0;                                       // mode 0 undecided, -1 falling (tracking the low), +1 rising (tracking the high)
  for (let i = 1; i < P.length; i++) { const v = P[i][1];
    if (mode === 0) { if (v > P[hi][1]) hi = i; if (v < P[lo][1]) lo = i; if (below(v, P[hi][1])) { mode = -1; lo = i; } else if (above(v, P[lo][1])) { mode = 1; hi = i; } }
    else if (mode < 0) { if (v < P[lo][1]) lo = i; if (above(v, P[lo][1])) { leg(hi, lo, false); mode = 1; hi = i; } }
    else { if (v > P[hi][1]) hi = i; if (below(v, P[hi][1])) { mode = -1; lo = i; } }
  }
  if (mode < 0 && open) leg(hi, lo, true);
  return out.filter(f => !exclude.some(([a, b]) => f.trough.x >= a && f.trough.x <= b));
}
// a projection: a line from a reading that climbs at a fixed rate per x unit (compound: v·(1+rate)^dx, as BASIC LAW's red plan line; or
// linear: v + rate·dx). Spread it into a series: { ...projection(last(P), 0.05), ink: HRED }. It is not data: label it as what it is.
export function projection(from, rate, { mode = 'compound' } = {}) {
  return { f: mode === 'compound' ? x => from.v * Math.pow(1 + rate, x - from.x) : x => from.v + rate * (x - from.x), from: from.x, to: Infinity, projection: true };
}
// keys that draw x0..x1 over t0..t1 and land on the beat: each fall's peak-to-trough takes fallBeats and eases into its trough (the crash is
// seen falling, not chased); the rest is shared by distance, so the pen keeps one speed between events. Each trough (and each pin, an x to
// strike on, e.g. the record peak) is snapped to the beat grid from t0, its fall's peak moving with it, so a whole number of fallBeats puts
// the peak on the beat too; a snap that would cross a neighbour is dropped. A fall that starts on the last one's trough shares its key, and
// the two move as one.
export function pace({ t0, t1, x0, x1, falls: F = [], fallBeats = 2, beat = 0.5, pins = [], snap = true }) {
  const fd = fallBeats * beat, ev = [];
  for (const f of [...F].sort((a, b) => a.peak.x - b.peak.x)) if (f.peak.x > x0 && f.trough.x <= x1) {
    const chained = ev.length > 0 && ev[ev.length - 1].x === f.peak.x; if (!chained) ev.push({ x: f.peak.x, peak: true }); ev.push({ x: f.trough.x, fall: true, chained }); }
  for (const x of pins) if (x > x0 && x < x1 && !F.some(f => x >= f.peak.x && x <= f.trough.x)) ev.push({ x, pin: true });
  ev.sort((a, b) => a.x - b.x);
  const nF = ev.filter(e => e.fall).length, free = t1 - t0 - nF * fd;
  if (free <= 0) throw new Error(`recorder pace: ${nF} falls x ${fallBeats} beats do not fit in ${t1 - t0} s`);
  let freeX = 0, px = x0; for (const e of ev) { if (!e.fall) freeX += e.x - px; px = e.x; } freeX += x1 - px;
  let t = t0; px = x0; for (const e of ev) { t += e.fall ? fd : free * (e.x - px) / freeX; e.t = t; px = e.x; }
  if (snap) for (let i = 0; i < ev.length; i++) { const e = ev[i]; if (!e.fall && !e.pin) continue;
    let m = i; if (e.fall) while (ev[m + 1]?.chained) m++;          // a chain of falls moves as one block, from its first peak to its last trough
    const j = e.fall ? i - 1 : i, lo = j > 0 ? ev[j - 1].t : t0, hi = m + 1 < ev.length ? ev[m + 1].t - 0.05 : ev[m].x === x1 ? t1 : t1 - 0.05;
    const g = (e.t - t0) / beat, ds = [Math.round(g), Math.round(g) === Math.floor(g) ? Math.ceil(g) : Math.floor(g)].map(k => t0 + k * beat - e.t);   // nearest beat, else the other
    for (const d of ds) if (ev[j].t + d > lo + 0.05 && ev[m].t + d <= hi) { for (let k = j; k <= m; k++) ev[k].t += d; break; }
    i = m; }
  const keys = [[t0, x0]]; for (const e of ev) keys.push(e.fall ? [e.t, e.x, 'sine'] : [e.t, e.x]);
  if (keys[keys.length - 1][1] === x1) keys[keys.length - 1][0] = t1; else keys.push([t1, x1]);
  return keys;
}

// ------------------------------------------------------------------ the recorder
let TOOTH = null;                                                     // the paper's tooth: one 512 px tile, made on first draw, shared
function tooth() {
  if (TOOTH) return TOOTH; const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(512, 512) : Object.assign(document.createElement('canvas'), { width: 512, height: 512 });
  const g = c.getContext('2d'), id = g.createImageData(512, 512), a = id.data;
  for (let i = 0; i < a.length; i += 4) { const n = (H01(i * 0.13) - 0.5) * 22 + (H01(Math.floor(i / 4 / 512 / 3) * 7.7) - 0.5) * 8; a[i] = a[i + 1] = a[i + 2] = 128 + n; a[i + 3] = 26; }
  g.putImageData(id, 0, 0); return (TOOTH = c);
}

export class Recorder {
  constructor({ series = [], x = {}, y = {}, paper = {}, penX = 760, penY = 1080, lead = 140, housing = true, keys = null, lift = 0.5, font = FONT, size = [1080, 1920], stampFit = {}, mid = null } = {}) {
    const bad = m => { throw new Error(`recorder: ${m}`); }, log = y.scale === 'log';
    [this.W, this.H] = size; this.penX = penX; this.penY = penY; this.lead = lead; this.lift = lift; this.font = font;
    this.housing = housing === true ? {} : housing || null;
    this.paper = { stock: '#ece4cf', rule: '#2e6e5c', top: 140, bottom: 1790, ...paper };            // the sheet between the sprocket margins
    // stamps shrink with the sheet on a pullback (scale) and sit off their reading by dx/dy times `offset` (BASIC LAW: max(0.34, z), max(0.5, zy))
    this.stampFit = { scale: C => clamp(Math.sqrt(C.z), 0.55, 1), offset: (C, sc) => sc, ...stampFit };
    this.series = series.map((s, i) => {
      if (s.f) { if (typeof s.f !== 'function' || !Number.isFinite(s.from)) bad(`series ${i}: a function series needs f(x) and a finite from`); }
      else { const P = s.points; if (!Array.isArray(P) || !P.length) bad(`series ${i} has no readings`);
        for (let k = 0; k < P.length; k++) { const [px, v] = P[k] || [];
          if (!Number.isFinite(px) || !Number.isFinite(v)) bad(`series ${i} reading ${k} is [${px}, ${v}], not two numbers (drop FRED's '.' missing values first)`);
          if (k && !(px > P[k - 1][0])) bad(`series ${i}: x must ascend (reading ${k} at ${px} follows ${P[k - 1][0]})`);
          if (log && !(v > 0)) bad(`series ${i} reading ${k} is ${v}: a log sheet needs every reading above 0`); } }
      return { ink: '#1b1714', width: 4.5, bleed: 0.22, ...s, from: s.from ?? s.points[0][0], to: s.to ?? (s.points ? s.points[s.points.length - 1][0] : Infinity) };
    });
    let x0 = Infinity, x1 = -Infinity, v0 = Infinity, v1 = -Infinity;                    // the defaults read every series, not just the first
    for (const s of this.series) { x0 = Math.min(x0, s.from); if (s.points) { x1 = Math.max(x1, s.to); for (const p of s.points) { if (p[1] < v0) v0 = p[1]; if (p[1] > v1) v1 = p[1]; } } }
    this.x = { from: x0, to: x1, pxPerUnit: 60, fine: 1, bold: 10, minPx: 14, labelPx: 110, label: v => String(Math.round(v)), ...x };
    if (!Number.isFinite(this.x.from)) bad(`x.from is ${this.x.from}: give x.from, or a series`);
    if (!(this.x.pxPerUnit > 0) || !(this.x.fine > 0) || !(this.x.bold >= this.x.fine)) bad(`x needs pxPerUnit > 0 and 0 < fine <= bold`);
    // y: f is the scale (log10, or none); pxPerUnit is px per unit of f (per decade on a log sheet). With no pxPerUnit, from..to fills the band
    // (screen px at zoom 1, camera at rest): the sheet is fit and the camera need not follow it up and down. follow: a window in x units over
    // which the camera averages the line and keeps it at penY (a long log sheet; BASIC LAW's 4.8 years), so a crash is seen falling, not chased.
    const f = log ? Math.log10 : v => v, Y = { scale: 'linear', from: v0, to: v1, follow: 0, ...y, log, f, inv: log ? u => 10 ** u : u => u };
    Y.band = y.band || [this.paper.top + 110, this.paper.bottom - 110];
    if (!Number.isFinite(Y.from) || (log && !(Y.from > 0))) bad(`y.from is ${Y.from}: give y.from${log ? ' above 0 (a log sheet)' : ''}, or a series with readings`);
    if (y.pxPerUnit == null && !(Y.to > Y.from)) bad(Y.to === Y.from ? `y.from = y.to = ${Y.to} (a flat series): give y.from and y.to` : `y.to (${Y.to}) must be above y.from (${Y.from})`);
    Y.pxPerUnit = y.pxPerUnit ?? (Y.band[1] - Y.band[0]) / (f(Y.to) - f(Y.from)); Y.base = y.base ?? Y.band[1];
    if (!(Y.pxPerUnit > 0 && Number.isFinite(Y.pxPerUnit))) bad(`y.pxPerUnit is ${Y.pxPerUnit}: it must be a number above 0`);
    if (!log) { Y.fine = y.fine ?? niceStep((Y.to > Y.from ? Y.to - Y.from : (Y.band[1] - Y.band[0]) / Y.pxPerUnit) / 15); Y.bold = y.bold ?? Y.fine * 5; if (!(Y.fine > 0)) bad(`y.fine must be above 0`); }
    if (Y.rule && !(Y.rule.px > 0)) bad(`y.rule.px must be above 0`);
    this.y = Y; this.mid = mid ?? (this.paper.top + this.paper.bottom) / 2;          // the screen y a vertical zoom holds still (BASIC LAW: 1000)
    if (!keys && !Number.isFinite(this.x.to)) bad(`no keys and no x.to to draw to (no series has readings): give keys or x.to`);
    this.keys = keys || [[0, this.x.from], [10, this.x.to]];
    if (!this.keys.length || this.keys.some((k, i) => !Number.isFinite(k[0]) || !Number.isFinite(k[1]) || (i > 0 && (k[0] < this.keys[i - 1][0] || k[1] < this.keys[i - 1][1]))))
      bad(`keys must be [[t, x], ...] with finite t and x, neither running backwards`);
  }
  // ---- the scales: world px (zoom 1, camera at rest) and screen px through a camera C = { cx: x under the pen, dy, z (x zoom), zy }
  yOf(v) { return this.y.base - (this.y.f(v) - this.y.f(this.y.from)) * this.y.pxPerUnit; }
  valOf(Y) { return this.y.inv(this.y.f(this.y.from) + (this.y.base - Y) / this.y.pxPerUnit); }
  sx(C, x) { return this.penX + (x - C.cx) * this.x.pxPerUnit * C.z; }
  sy(C, Y) { return this.mid + (Y + C.dy - this.mid) * C.zy; }
  xAt(C, X) { return C.cx + (X - this.penX) / (this.x.pxPerUnit * C.z); }
  yAt(C, S) { return (S - this.mid) / C.zy + this.mid - C.dy; }
  at(si, x) {                                                         // series si at x: the readings joined by straight lines (or its function)
    const s = this.series[si]; if (s.f) return s.f(x); const P = s.points;
    if (x <= P[0][0]) return P[0][1]; if (x >= P[P.length - 1][0]) return P[P.length - 1][1];
    let lo = 0, hi = P.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m][0] <= x) lo = m; else hi = m; }
    return lerp(P[lo][1], P[hi][1], (x - P[lo][0]) / (P[hi][0] - P[lo][0]));
  }
  // ---- the pen: keys [[t, x, ease?], ...], the ease shaping the segment that arrives at that key; held before the first key and after the last
  penAt(t) {
    const K = this.keys; if (t <= K[0][0]) return K[0][1];
    for (let i = 1; i < K.length; i++) { const [t1, x1, e] = K[i]; if (t < t1) { const [t0, x0] = K[i - 1], ez = typeof e === 'function' ? e : EASE[e || 'lin'];
      return lerp(x0, x1, ez((t - t0) / (t1 - t0))); } }
    return K[K.length - 1][1];
  }
  timeAt(x) {                                                         // the first t at which the pen reaches x (keys never run backwards)
    const K = this.keys; let a = K[0][0], b = K[K.length - 1][0]; if (x <= this.penAt(a)) return a; if (x > this.penAt(b)) return Infinity;
    for (let k = 0; k < 48; k++) { const m = (a + b) / 2; if (this.penAt(m) < x) a = m; else b = m; } return b;
  }
  // the series the pen is on at x: those whose span holds x, one stylus each. Where one ends and the next begins (a projection from the last
  // reading) the earlier keeps the junction and the later takes over past it; off every span (a gap) the nearest. A piece that changes pens
  // by time (BASIC LAW takes red ink at a beat, not an x) passes draw's `pens`.
  live(x) {
    const S = this.series, e = 1e-9, L = []; S.forEach((s, i) => { if (x >= s.from - e && x <= s.to + e) L.push(i); });
    if (L.length) return L.filter(i => !(Math.abs(x - S[i].from) <= e && L.some(j => S[j].from < x - e)));
    let b = -1, bd = Infinity; S.forEach((s, i) => { const d = x < s.from ? s.from - x : x - s.to; if (d < bd) { bd = d; b = i; } }); return b < 0 ? [] : [b];
  }
  pen(C, t, x = this.penAt(t), pens = this.live(x)) {                // where each stylus touches, lifted before the first key
    const t0 = this.keys[0][0], up = t < t0 ? 30 * (1 - inCubic((t - (t0 - this.lift)) / this.lift)) : 0;
    return pens.map(si => { const s = this.series[si], xx = clamp(x, s.from, s.to); return { si, x: xx, X: this.sx(C, xx), Y: this.sy(C, this.yOf(this.at(si, xx))) - up, ink: s.ink }; });
  }
  // ---- the camera: the pen's column holds the x under the pen (the paper scrolls); at the start it holds still so the first reading sits at
  // `lead` and the pen walks out to penX. Vertically at rest (y.follow 0: the sheet is fit), or held on the line's average over y.follow x
  // units, 6 of its 9 samples behind the pen. The line is the ink under the pen: each sample reads the series that owns its x, so a projection
  // carries the camera on from the data's last reading. Or cam(t, { si }) follows series si alone, over its own `follow` window if it has one
  // (0: the line itself, no average). `at` reads the follow at another x, `offset` holds the line that many px off penY (BASIC LAW's red pen
  // rides 120 px above it), and y.followFrom floors the x it is read at (BASIC LAW: 1921, the sheet still while the pen walks out of 1919).
  smoothF(x, si) {
    const own = si == null, w = own ? this.y.follow : this.series[si].follow ?? this.y.follow; let a = 0;
    for (let k = -6; k <= 2; k++) { const xx = x + k * w / 8, i = own ? this.live(xx).at(-1) : si, s = this.series[i]; a += this.y.f(this.at(i, clamp(xx, s.from, Math.min(s.to, 1e9)))); }
    return a / 9;
  }
  cam(t, { si, at, offset = 0 } = {}) {
    const x = this.penAt(t), cx = Math.max(x, this.x.from + (this.penX - this.lead) / this.x.pxPerUnit);
    const fx = Math.max(at ?? x, this.y.followFrom ?? -Infinity);
    const dy = this.y.follow && this.series.length ? this.penY + offset - (this.y.base - (this.smoothF(fx, si) - this.y.f(this.y.from)) * this.y.pxPerUnit) : 0;
    return { cx, dy, z: 1, zy: 1 };
  }
  frame(x0, x1, v0, v1, { into = this.y.band, padX = 60 } = {}) {    // the camera that shows x0..x1 across the frame and v0..v1 in `into`
    const z = (this.W - 2 * padX) / ((x1 - x0) * this.x.pxPerUnit), cx = x0 - (padX - this.penX) / (this.x.pxPerUnit * z);
    const Yt = this.yOf(Math.max(v0, v1)), Yb = this.yOf(Math.min(v0, v1)), zy = (into[1] - into[0]) / (Yb - Yt);
    return { cx, z, zy, dy: (into[0] - this.mid) / zy + this.mid - Yt };
  }
  // a whip between two cameras: the frame's edges (in sheet units) move in straight lines, so every point on the sheet slides monotonically
  // from where A shows it to where B does (lerping cx and z directly overshoots: the pen ran off the right edge in a pullback)
  mix(A, B, u) {
    const p = this.paper, P = this.x.pxPerUnit, e = C => [this.xAt(C, 0), this.xAt(C, this.W), this.yAt(C, p.top), this.yAt(C, p.bottom)];
    const [l, r, t, b] = e(A).map((v, i) => lerp(v, e(B)[i], u)), z = this.W / ((r - l) * P), zy = (p.bottom - p.top) / (b - t);
    return { cx: l + this.penX / (P * z), z, zy, dy: (p.top - this.mid) / zy + this.mid - t };
  }
  // ---- the jolt and the flash of a hit (BASIC LAW's crash): the recorder takes the hit for 0.25 s, a red flash fades over 0.3 s
  static jolt(t, hits) { let jx = 0, jy = 0; for (const h of hits) { const a = t - h; if (a >= 0 && a < 0.25) { const k = Math.exp(-a * 18) * 9; jx += Math.sin(a * 140) * k; jy += Math.cos(a * 110) * k; } } return [jx, jy]; }
  static flash(t, hits) { let f = 0; for (const h of hits) { const a = t - h; if (a >= 0 && a < 0.3) f += 0.2 * (1 - a / 0.3); } return f; }

  // ---- the trace: series si from x=a to x=c as screen points [X, Y, ...]: every reading kept (a peak is never thinned away), clipped 40 px
  // beyond the frame with an interpolated point at each edge; a function series is sampled a px apart. It ends exactly at c (the pen).
  trace(C, si, a, c) {
    const s = this.series[si], out = []; a = Math.max(a, s.from); c = Math.min(c, s.to);
    const lo = Math.max(a, this.xAt(C, -40)), hi = Math.min(c, this.xAt(C, this.W + 40)); if (!(hi > lo)) return out;
    const pt = x => out.push(this.sx(C, x), this.sy(C, this.yOf(this.at(si, x))));
    pt(lo);
    if (s.f) { const st = Math.max(1e-4, 1 / (this.x.pxPerUnit * C.z)); for (let x = lo + st; x < hi; x += st) pt(x); }
    else { const P = s.points; let l = 0, h = P.length - 1; while (h - l > 1) { const m = (l + h) >> 1; if (P[m][0] <= lo) l = m; else h = m; }
      for (let i = l; i < P.length && P[i][0] < hi; i++) if (P[i][0] > lo) out.push(this.sx(C, P[i][0]), this.sy(C, this.yOf(P[i][1]))); }
    pt(hi); return out;
  }
  // ---- stamps. The anchor: series si's reading at x (or v), offset by dx/dy (px at full size, scaled by stampFit.offset on a pullback)
  stampAt(C, s, sc = this.stampScale(C)) {
    const v = s.v ?? this.at(s.si || 0, s.x), ax = this.sx(C, s.x), ay = this.sy(C, this.yOf(v)), o = this.stampFit.offset(C, sc);
    return { ax, ay, X: ax + (s.dx || 0) * o, Y: ay + (s.dy ?? 160) * o, sc, o, v };
  }
  stampScale(C) { return this.stampFit.scale(C); }
  stampRot(s) { return s.rot ?? -0.08 + H01(Math.round(s.x * 97)) * 0.06; }            // seeded by the sheet x: a stamp rides still
  stampW(g, s) { g.font = `900 46px ${this.font}`; const w1 = g.measureText(s.top || '').width; g.font = `900 70px ${this.font}`; return Math.max(240, Math.max(w1, g.measureText(s.bottom || '').width) + 52); }
  // its box on screen at struck size k (1.5 as it lands, 1 at rest): the upright bound of the tilted box, its 6 px rule included
  stampBox(g, C, s, k = 1) {
    const a = this.stampAt(C, s), bw = this.stampW(g, s), r = this.stampRot(s), c = Math.cos(r), n = Math.abs(Math.sin(r)), m = a.sc * k;
    const hx = ((bw / 2 + 3) * c + 75 * n) * m, hy = (75 * c + (bw / 2 + 3) * n) * m;
    return { ...a, bw, rot: r, x0: a.X - hx, x1: a.X + hx, y0: a.Y - hy, y1: a.Y + hy };
  }
  // the stamp's dy pushed just far enough that its box, at struck size k on camera C, sits `gap` px clear of series si's ink (its bleed's half
  // width) under the box's span: below the line for a stamp hung below it (dy >= 0), above it otherwise. Run it over every camera the stamp is
  // seen through, feeding the result back in; a dy that already clears comes back unchanged.
  clearDy(g, C, s, { si = s.si || 0, gap = 14, k = 1 } = {}) {
    const S = this.series[si], b = this.stampBox(g, C, s, k), dy = s.dy ?? 160, ink = (S.bleedWidth ?? S.width * 2.2) * Math.max(0.5, C.z) / 2;
    const pts = this.trace(C, si, this.xAt(C, b.x0 - ink), this.xAt(C, b.x1 + ink)); if (!pts.length) return dy;
    let top = Infinity, bot = -Infinity; for (let i = 1; i < pts.length; i += 2) { top = Math.min(top, pts[i]); bot = Math.max(bot, pts[i]); }
    const h = (b.y1 - b.y0) / 2;
    return dy >= 0 ? Math.max(dy, (bot + ink + gap + h - b.ay) / b.o) : Math.min(dy, (top - ink - gap - h - b.ay) / b.o);
  }

  // ------------------------------------------------------------------ drawing
  drawPaper(g, C) {
    const p = this.paper, W = this.W, R = a => rgba(p.rule, a), P = this.x.pxPerUnit * C.z, Y = this.y;
    g.fillStyle = p.stock; g.fillRect(-M, -M, W + 2 * M, this.H + 2 * M);
    if (p.tooth !== false) { g.save(); g.globalCompositeOperation = 'multiply'; const T = tooth(); for (let x = -512; x < W + M; x += 512) for (let y = -512; y < this.H + M; y += 512) g.drawImage(T, x, y); g.restore(); }
    // horizontal ruling. By value: linear every `fine` (bold every `bold`), log 1..9 per decade (bold at the decade). Or at a fixed pitch,
    // y.rule { px, bold, minPx }: a line every px world px up from base, bold every `bold`, none at all once px on screen is minPx or less
    // (BASIC LAW's 30 px grid, bold at 150). A bold line carries label(value) at the left edge.
    const rows = [], top = this.yAt(C, p.top), bot = this.yAt(C, p.bottom);              // [screen y, bold, value]
    if (Y.rule) { const { px, bold = 5, minPx = 3 } = Y.rule;
      if (px * C.zy > minPx) for (let k = Math.ceil((Y.base - bot) / px), k1 = Math.floor((Y.base - top) / px); k <= k1 && rows.length < 600; k++) rows.push([this.sy(C, Y.base - k * px), k % bold === 0, this.valOf(Y.base - k * px)]); }
    else { const vT = this.valOf(top), vB = this.valOf(bot), gap = (Y.log ? Math.log10(10 / 9) : Y.fine) * Y.pxPerUnit * C.zy, add = (v, b) => { if (b || gap >= 4) rows.push([this.sy(C, this.yOf(v)), b, v]); };
      if (Y.log) { for (let d = Math.floor(Math.log10(vB)); d <= Math.ceil(Math.log10(vT)) && rows.length < 600; d++) for (let m = 1; m < 10; m++) add(m * 10 ** d, m === 1); }
      else { const f = Y.fine; for (let k = Math.ceil(vB / f); k <= Math.floor(vT / f) && rows.length < 600; k++) add(k * f, isMult(k * f, Y.bold)); } }
    for (const [y, bold, v] of rows) { if (y < p.top || y > p.bottom) continue;
      g.fillStyle = R(bold ? 0.55 : 0.2); g.fillRect(-M, y, W + 2 * M, bold ? 2 : 1);
      if (bold && Y.label && y > p.top + 40 && y < p.bottom - 50) { g.fillStyle = R(0.85); g.font = `900 30px ${this.font}`; g.textAlign = 'left'; g.fillText(Y.label(v), 16, y - 8); } }
    // vertical ruling (x): a line every `fine` (hidden when fine is under minPx on screen), bold every `bold`, the bold value printed at the
    // foot (every other one once bold is labelPx or less on screen). BASIC LAW: minPx 30, labelPx 180.
    const { fine, bold, minPx, labelPx } = this.x, nb = Math.round(bold / fine), xa = this.xAt(C, -40), xb = this.xAt(C, W + 40), every = bold * P <= labelPx ? 2 : 1;
    for (let k = Math.ceil(xa / fine); k <= Math.floor(xb / fine); k++) {
      const v = k * fine, x = this.sx(C, v), isB = k % nb === 0; if (!isB && fine * P < minPx) continue;
      g.fillStyle = R(isB ? 0.6 : 0.22); g.fillRect(x, p.top, isB ? 2 : 1, p.bottom - p.top);
      if (isB && (k / nb) % every === 0) { g.fillStyle = R(0.85); g.font = `900 ${Math.round(34 * Math.max(0.8, Math.min(1, C.z)))}px ${this.font}`; g.textAlign = 'center'; g.fillText(this.x.label(v), x, p.bottom - 18); }
    }
    // the sprocket margins, their holes riding with the paper
    for (const [ya, yb] of [[p.top - 44, p.top], [p.bottom, p.bottom + 44]]) { g.fillStyle = '#ddd2b6'; g.fillRect(-M, ya, W + 2 * M, yb - ya); g.fillStyle = '#b9ad90';
      const off = ((C.cx * P) % 46 + 46) % 46; for (let x = -off; x < W + M; x += 46) { g.beginPath(); g.ellipse(x, (ya + yb) / 2, 8, 6, 0, 0, Math.PI * 2); g.fill(); } }
  }
  drawTrace(g, C, si, a, c) {                                        // the ink: a translucent bleed under the line, then the line
    const s = this.series[si], pts = this.trace(C, si, a, c); if (pts.length < 4) return;
    const p = new Path2D(); p.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1]);
    g.save(); g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = s.ink;
    if (s.bleed) { g.globalAlpha = s.bleed; g.lineWidth = (s.bleedWidth ?? s.width * 2.2) * Math.max(0.5, C.z); g.stroke(p); g.globalAlpha = 1; }
    g.lineWidth = s.width * Math.max(0.6, C.z); g.stroke(p);
    if (s.label) { const x0 = this.sx(C, s.from), y0 = this.sy(C, this.yOf(this.at(si, s.from))); g.fillStyle = s.ink; g.font = `900 30px ${this.font}`; g.textAlign = 'left'; g.fillText(s.label, x0 + 6, y0 - 22); }
    g.restore();
  }
  stamp(g, C, s, t, sc = this.stampScale(C)) {                       // a rubber stamp: red ink, a box sized to its words, struck in from 150 %
    const age = t - s.at; if (!(age >= 0)) return; const { X, Y } = this.stampAt(C, s, sc); if (X < -300 || X > this.W + 300) return;
    const k = (age < 0.08 ? lerp(1.5, 1, outCubic(age / 0.08)) : 1) * sc, bw = this.stampW(g, s);
    g.save(); g.translate(X, Y); g.rotate(this.stampRot(s)); g.scale(k, k); g.globalAlpha = 0.88; g.globalCompositeOperation = 'multiply';
    g.strokeStyle = g.fillStyle = s.ink || '#C8141E'; g.lineWidth = 6; g.strokeRect(-bw / 2, -72, bw, 144); g.textAlign = 'center';
    g.font = `900 46px ${this.font}`; g.fillText(s.top || '', 0, -16); g.font = `900 70px ${this.font}`; g.fillText(s.bottom || '', 0, 52); g.restore();
  }
  drawPen(g, C, t, x, pens = this.live(x)) {                         // a steel rail across the sheet at the pen's x; a carriage and stylus per pen
    const P = this.pen(C, t, x, pens), p = this.paper; if (!P.length) return; const rx = P[0].X;
    g.save(); g.fillStyle = '#3a3d42'; g.fillRect(rx + 22, p.top, 12, p.bottom - p.top); g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(rx + 24, p.top, 3, p.bottom - p.top);
    for (const { X, Y, ink } of P) {
      g.fillStyle = '#26282c'; g.fillRect(X + 4, Y - 58, 52, 70); g.fillStyle = '#4b4f55'; g.fillRect(X + 8, Y - 54, 44, 8);
      g.fillStyle = ink; g.beginPath(); g.ellipse(X + 30, Y - 28, 13, 10, 0, 0, Math.PI * 2); g.fill();                              // the ink well
      g.fillStyle = 'rgba(230,232,236,0.85)'; g.beginPath(); g.arc(X + 26, Y - 31, 3.5, 0, Math.PI * 2); g.fill();
      g.strokeStyle = ink; g.lineWidth = 4; g.beginPath(); g.moveTo(X + 10, Y + 6); g.lineTo(X, Y); g.stroke(); }
    g.restore();
  }
  drawHousing(g) {                                                    // the enamel case above and below the sprockets, its plate; the glass over the sheet
    const W = this.W, H = this.H, top = this.paper.top - 44, bot = this.paper.bottom + 44, plate = this.housing.plate;
    g.fillStyle = '#1d2124'; g.fillRect(0, bot, W, H - bot); g.fillStyle = '#2b3034'; g.fillRect(0, bot, W, 6);
    if (plate) { g.font = `900 26px ${this.font}`; const pw = Math.min(W - 80, Math.max(580, g.measureText(plate).width + 70));
      g.fillStyle = '#c9b98f'; g.fillRect(W / 2 - pw / 2, bot + 22, pw, 44); g.fillStyle = '#2a241c'; g.textAlign = 'center'; g.fillText(plate, W / 2, bot + 53); }
    g.fillStyle = '#1d2124'; g.fillRect(0, 0, W, top); g.fillStyle = '#2b3034'; g.fillRect(0, top - 6, W, 6);
    const gr = g.createLinearGradient(0, top, W, bot); gr.addColorStop(0, 'rgba(255,255,255,0.05)'); gr.addColorStop(0.45, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.04)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, top, W, bot - top);
  }
  // the frame: paper, ink up to the pen (or upTo), the piece's extra marks, the stamps, the pens (all shaken by the hits), housing, flash.
  // The stock goes down unshaken first, so a jolt never leaves a sliver of the last frame at an edge. pens: the styluses to show, [si, ...] or
  // (x, t) => [si, ...] (default: the series the pen is on). The piece's type goes on after, then its finish.
  draw(g, t, { cam, stamps = [], hits = [], extra = null, upTo = null, pen = true, pens = null } = {}) {
    const C = cam || this.cam(t), x = this.penAt(t), [jx, jy] = Recorder.jolt(t, hits);
    g.fillStyle = this.paper.stock; g.fillRect(0, 0, this.W, this.H);
    g.save(); g.translate(jx, jy); this.drawPaper(g, C);
    if (t >= this.keys[0][0]) this.series.forEach((s, si) => this.drawTrace(g, C, si, s.from, upTo ?? x));
    if (extra) { g.save(); extra(g, C, this); g.restore(); }
    for (const s of stamps) this.stamp(g, C, s, t);
    if (pen) this.drawPen(g, C, t, x, typeof pens === 'function' ? pens(x, t) : pens || this.live(x));
    g.restore();
    if (this.housing) this.drawHousing(g);
    const f = Recorder.flash(t, hits); if (f > 0) { g.fillStyle = `rgba(200,20,30,${f})`; g.fillRect(0, 0, this.W, this.H); }
    return C;
  }
}
