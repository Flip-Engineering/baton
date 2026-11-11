// AT REST: the plan (no DOM, no GL: web/labs/objective/atrest_dry.mjs runs it and the frame logic in node). research/series/instrument/
// ep1_brief.md, with this build's departures (scenes/atrest.js header). Everything here is a pure function of t (seconds). 70 BPM, 4/4
// (12/8 in the second state on the same beat): a beat is 6/7 s, a bar 24/7 s. The drop's millimetres: the head's centre is the origin,
// x right, y up, z toward the camera (the window, and the world beyond it, are at -z).
import { Slide } from '../lib/fx/objective/switch.js';
import { DROP } from '../lib/fx/objective/polariscope_ref.js';

export const W = 1080, H = 1920, BPM = 70, SPB = 60 / BPM, BAR = 4 * SPB;
export const b = beat => beat * SPB;                                  // beat -> seconds
export const bar = n => (n - 1) * BAR;                                // bar n (1-based) -> its downbeat
export const END = b(78);                                             // 66.857 s: everything cuts dry on the open fifths
const clamp = (x, a = 0, b_ = 1) => Math.min(b_, Math.max(a, x));
const lerp = (a, c, u) => a + (c - a) * u;
export const sstep = (a, c, x) => { const u = clamp((x - a) / (c - a)); return u * u * (3 - 2 * u); };
const easeIO = u => (u = clamp(u), u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const cosIO = u => 0.5 - 0.5 * Math.cos(Math.PI * clamp(u));

// ------------------------------------------------------------------ the take (c20): where the ball touches the tail. A (default): it falls under
// "and this consciousness intervenes in reality only at the site of the latter's objective contradictions." and the tail fails on b56, the bar
// after the line lands. B: the fall stretched across chair3 and mao4, the tail failing on "a culminating point" (b59.5). A scene file sets
// globalThis.ATREST_TAKE before it imports the core (scenes/atrest_b.js).
export const TAKES = { a: { geoB: 51, closeB: 53, snapB: 56, hsB: 58 }, b: { geoB: 53, closeB: 56, snapB: 59.5, hsB: 61 } };
export const TAKE = (globalThis.ATREST_TAKE && TAKES[globalThis.ATREST_TAKE]) ? globalThis.ATREST_TAKE : 'a';
const TK = TAKES[TAKE];
// ------------------------------------------------------------------ the break (c22, 16 Oct; the client on v2: "time the break of the drop at the
// beatdrop and make it more bombastic? It looks as if it just dissolves into air"). The failure stays on b56 (48.00 s: on v2 the picture's
// break and the score's hit already shared that frame); what changes is the break itself. A scene file sets globalThis.ATREST_BREAK:
//   'c'  the close shot stays: on the instant a flash off the fresh faces, the frame punched in and shaken, the pieces thrown out at speed
//        for a few frames and then hanging in slow motion, the frame easing back out so their flight is seen
//   'd'  the same instant, then one frame later a hard cut to a low angle across the break, wider, the pieces flying across it
// Unset (atrest_a, v2): the c21 break as published.
export const BRK = (globalThis.ATREST_BREAK === 'c' || globalThis.ATREST_BREAK === 'd') ? globalThis.ATREST_BREAK : null;
// the pieces' clock (film s since the break -> the s their velocities are integrated over): the instant of the hit near real time (they
// cover KF seconds' worth of their drift in the first ~0.15 s), then slow motion at SLOWK of it
export const BREAK = { tf: 0.055, KF: 1.25, SLOWK: 0.3 };
export function breakClock(u) { if (u <= 0) return 0; if (!BRK) return u; return BREAK.KF * (1 - Math.exp(-u / BREAK.tf)) + BREAK.SLOWK * u; }
// the flash off the fresh fracture faces (scene-linear multiplier of the band's colour at the contact; 0 before the break)
export function flashAt(t) { if (!BRK || t < b(TK.snapB)) return 0; const u = t - b(TK.snapB); return 9.0 * Math.exp(-u / 0.045) + 1.2 * Math.exp(-u / 0.35); }
// ------------------------------------------------------------------ the timeline (seconds; the brief's)
export const TL = {
  blowA: 0.40, cutB: 1.95, blowB: 2.70, cutC: 3.60, blowC: 4.20, push: 5.14, pushEnd: 17.14, switchOut: 17.14, rest: 18.00, making: b(32),
  fall: b(32), settle: 28.60, slideIn: 28.50, slideInEnd: 29.70, bloom: 28.40, bloomEnd: 32.80, blows2: b(40), blowD: 35.00, cutE: 35.80, blowE: 36.40,
  site: 38.14, trackEnd: b(TK.geoB), geo: b(TK.geoB), close: b(TK.closeB), touch: b(TK.snapB) - 0.57, stop: b(TK.snapB - 1), snap: b(TK.snapB), hs: b(TK.hsB),
  ramp: 54.60, real: 55.00, burstEnd: 56.40,
  empty: 56.40, panel: 57.20, panelEnd: 58.20, rack: 57.80, rackEnd: 58.60, wide: 58.90, mark: b(74.5), end: END,
};

// ------------------------------------------------------------------ the words (verbatim; research/scripts_final/atrest.json holds the sources)
// A card: lines, each arriving on its beat (a line may hold two stress groups set on two rows: [beat, [row, row]]), cleared whole at `clear`.
// kind: 'hook' (72 px cap height), 'q' (56 px); credit: Plex Mono caps, with the last line. Readings are separate (READINGS).
// (issue 95: the old explanatory hook — "Snap its tail / and the whole thing / bursts to powder." — is removed; the picture carries it.)
export const CUES = [
  { id: 'decl1', lines: [[6.5, '…the development'], [7.5, 'of the American nation'], [8.5, 'has objectively entered'], [9.5, 'into contradiction']], clearB: 11 },
  { id: 'decl2', lines: [[11.5, 'with the form'], [12.5, 'of the United States'], [13.5, 'of America itself,']], clearB: 15 },
  { id: 'decl3', lines: [[15.5, 'which has failed'], [15.5, 'to contain'], [16.5, 'the heightened political'], [17.5, 'polarizations'], [18, 'ravaging it from within.']], clearB: 20,
    credit: 'AMERICAN COMMUNIST PARTY · DECLARATION · 21 JULY 2024' },
  { id: 'mao1', lines: [[21, 'When the thing'], [22, 'is in the first state'], [23, 'of motion,']], clearB: 24.5 },
  { id: 'mao2', lines: [[25, 'it is undergoing only'], [26, 'quantitative and not'], [27, 'qualitative change']], clearB: 28 },
  { id: 'mao3', lines: [[28.5, 'and consequently presents'], [29.5, 'the outward appearance'], [30.5, 'of being at rest.']], clearB: 32, credit: 'MAO ZEDONG · ON CONTRADICTION · 1937' },
  { id: 'skin', lines: [[34.5, 'The skin sets first.'], [35.5, 'The core keeps cooling'], [36.5, 'and pulls against it.']], clearB: 40 },
  { id: 'chair1', lines: [[40.5, 'Communist consciousness'], [41.5, 'does NOT entail'], [42.5, 'the voluntary'], [43, 'transformation of society.']], clearB: 44.5 },
  { id: 'chair2', lines: [[45, 'It entails knowledge'], [46, 'in the form of wisdom,'], [47, 'of the laws guiding'], [48, 'the development of society,']], clearB: 50.5 },
  { id: 'chair3', lines: [[51, 'and this consciousness'], [52, 'intervenes in reality'], [53, 'only at the site'], [54, 'of the latter’s'], [55, 'objective contradictions.']], clear: 48.40,
    credit: 'EXECUTIVE CHAIRMAN, AMERICAN COMMUNIST PARTY' },
  { id: 'mao4', lines: [[56.5, '…the quantitative change'], [57.5, 'of the first state'], [58.5, 'has already reached'], [59.5, 'a culminating point']], clearB: 61 },
  { id: 'mao5', lines: [[61.5, 'and gives rise'], [62.5, 'to the dissolution'], [63.5, 'of the thing'], [64.5, 'as an entity…']], clearB: 66, credit: 'MAO ZEDONG · ON CONTRADICTION' },
  { id: 'marx', lines: [[69.5, 'Then begins an era'], [70.5, 'of social revolution.']], clearB: 74, credit: 'KARL MARX · 1859' },
];
CUES.forEach(c => { c.t0 = b(c.lines[0][0]); c.t1 = c.clear ?? b(c.clearB); c.lines = c.lines.map(([bt, text]) => ({ t: b(bt), beat: bt, text })); });
export const READINGS = [
  { text: 'SKIN · ≈ 50 TONS PER SQ IN', t0: b(37), t1: b(40) },
  { text: 'CRACK FRONT · MORE THAN 4,000 MPH', t0: b(TK.hsB) + 0.3, t1: Math.max(53.60, b(TK.hsB) + 2.6) },
];
export const MARK = { t0: TL.mark, size: 220, y: 560 };
// the type's place (the series' type, BIBLE section 6): flush left at x 72, words between y 300 and 760; the hook at 72 px cap height,
// quotations at 56 px; credits and readings in Plex Mono caps, 26-30 px; readings at x 60, y 1236
export const TYPE = { x: 72, y0: 300, y1: 760, capHook: 72, capQ: 56, leadHook: 1.32, leadQ: 1.30, credit: 27, reading: 28, rx: 60, ry: 1236, maxW: 960 - 72 };
export function wordsAt(t) {
  const out = [];
  for (const c of CUES) { if (t < c.t0 || t >= c.t1) continue;
    const lines = c.lines.filter(l => t >= l.t); out.push({ id: c.id, kind: c.kind || 'q', lines, credit: c.credit && lines.length === c.lines.length ? c.credit : null, age: t - lines[lines.length - 1].t, t0: c.t0 }); }
  return out;
}
export const readingAt = t => READINGS.find(r => t >= r.t0 && t < r.t1) || null;
export function wordCount() { return CUES.reduce((n, c) => n + c.lines.reduce((m, l) => m + l.text.split(/\s+/).filter(Boolean).length, 0), 0); }

// ------------------------------------------------------------------ the one strike: a pendulum's swing as quarter-sines between its peak and the contact, then the long rebound.
// Issue 95: one dynamic, impactful blow on the head at 0.40 s; the body stays intact. Angles A, B, C show the contact and its rebound
// (cuts on the rebound), not further contacts. The later site break is the only rupture.
export const CONTACT_N = (() => { const v = [0.95, -0.06, 0.3], l = Math.hypot(...v); return v.map(x => x / l); })();
export const BLOWS = [
  { tc: TL.blowA, from: -0.45, Ain: 15.0, to: 3.60, Aout: 18.0, face: 20, shot: 'A' },
];
export const STRIKE = BLOWS[0];
// the striker's distance (mm) from contact along its path, and its speed (mm/s, + toward the drop), at t; null when it is not in the shot
export function strikerAt(t) {
  for (const B of BLOWS) {
    if (t < B.from || t > B.to + 1.2) continue;
    if (t <= B.tc) { const T = B.tc - B.from, u = (t - B.from) / T; return { blow: B, s: B.Ain * Math.cos(Math.PI / 2 * u), v: B.Ain * Math.PI / (2 * T) * Math.sin(Math.PI / 2 * u) }; }
    if (t <= B.to) { const T = B.to - B.tc, u = (t - B.tc) / T; return { blow: B, s: B.Aout * Math.sin(Math.PI / 2 * u), v: -B.Aout * Math.PI / (2 * T) * Math.cos(Math.PI / 2 * u) }; }
    // after the rebound peak it swings back out of the shot, away (there is no next striker: one strike only)
    const T = B.to - B.tc, u = (t - B.to) / T; return { blow: B, s: B.Aout + 3 * B.Aout * u * u, v: -6 * B.Aout * u / T };
  }
  return null;
}
// the strike's transient force at the contact: a damped ringing compression (MPa) that the fringes show and the body survives
export function strikeAt(t) {
  if (t < STRIKE.tc) return null;
  const u = t - STRIKE.tc, env = Math.exp(-u / 0.12), ring = Math.cos(2 * Math.PI * 6.0 * u);
  const amp = 420 * env * (0.55 + 0.45 * ring);
  if (amp < 1.5) return null;
  return { at: CONTACT_N.map(x => x * DROP.head), amp, radius: 1.9, age: u };
}
// the contact flash on the strike (scene-linear multiplier; 0 before it)
export function impactFlashAt(t) {
  if (t < STRIKE.tc) return 0;
  const u = t - STRIKE.tc;
  return 2.4 * Math.exp(-u / 0.028) + 0.28 * Math.exp(-u / 0.18);
}
// ------------------------------------------------------------------ the shots: the bench (field mm), the camera pose (drop mm), what is in path
// pos is the lens's position; target the point on the focal plane at the frame's centre; the focus distance is the bench's own.
const U = 6.0206;                                                     // frame 0: the head's centre at y 1210 px (6.02 mm under the frame's centre at 41.5 px/mm)
const SHOTS = [
  { id: 'A', t0: 0, t1: TL.cutB, mode: 'drop', field: 26, yaw: 0, pitch: 0, target: [0, U, 0] },
  { id: 'B', t0: TL.cutB, t1: TL.cutC, mode: 'drop', field: 21, yaw: -24, pitch: 9, target: [1.5, 2.0, 0] },
  { id: 'C', t0: TL.cutC, t1: TL.push, mode: 'drop', field: 23, yaw: 8, pitch: -24, target: [1.0, 3.0, 0] },
  { id: 'push', t0: TL.push, t1: TL.rest, mode: 'drop', field: [26, 15], yaw: 0, pitch: 0, target: [[0, U, 0], [0, 2.6, 0]], move: [TL.push, TL.pushEnd] },
  { id: 'rest', t0: TL.rest, t1: TL.making, mode: 'drop', field: 15, yaw: 0, pitch: 0, target: [0, 2.6, 0] },
  { id: 'making', t0: TL.making, t1: TL.blows2, mode: 'tank', field: 40, yaw: 0, pitch: 0, target: [-6, 9.0, 0] },
  { id: 'D', t0: TL.blows2, t1: TL.cutE, mode: 'drop', field: 22, yaw: 0, pitch: 0, target: [0.5, 4.5, 0] },
  { id: 'E', t0: TL.cutE, t1: TL.site, mode: 'drop', field: 17, yaw: -10, pitch: 13, target: [2.0, 3.5, 0] },
  { id: 'site', t0: TL.site, t1: TL.geo, mode: 'drop', field: [22, 15], yaw: 0, pitch: 0, track: [TL.site, TL.trackEnd] },
  // the geography: the head low left, the tail's arc, the ball above the site on the right; a slow push in
  { id: 'geo', t0: TL.geo, t1: TL.close, mode: 'drop', field: [42, 38], yaw: 0, pitch: 0, target: [[10, 24, 0], [12, 24.5, 0]], move: [TL.geo, TL.close] },
  // close on the site: the ball comes in from the top right, the tail fills the frame's width; it fails; the front leaves toward the head
  // c21: big (the client, 15 Oct: "a more visually impactful scene"): a 10.5 mm field pushing in to 8 mm by the failure, the contact
  // nearer the middle so the ball (3.5 mm: about 470 px) and the pieces thrown from the break fill the frame; held after the failure
  ...(BRK === 'd' ? [
  { id: 'close', t0: TL.close, t1: TL.snap + 0.02, mode: 'drop', field: [10.5, 8.0], yaw: 0, pitch: 0, frameAt: [0.60, 0.64], move: [TL.close, TL.snap] },
  // c22 d: the cut on the frame after the hit: low and to the side of the break, wider, the pieces flying across the frame
  { id: 'closeD', t0: TL.snap + 0.02, t1: TL.hs, mode: 'drop', field: [15.0, 12.5], yaw: -28, pitch: -10, frameAt: [0.52, 0.50], move: [TL.snap + 0.02, TL.hs] },
  ] : [
  { id: 'close', t0: TL.close, t1: TL.hs, mode: 'drop', field: [10.5, 8.0], yaw: 0, pitch: 0, frameAt: BRK ? [0.60, 0.64] : [0.60, 0.58], move: [TL.close, TL.snap] },
  ]),
  { id: 'hs', t0: TL.hs, t1: TL.empty, mode: 'drop', field: 23, yaw: 0, pitch: 0, target: [-3.0, -2.0, 0] },
  { id: 'empty', t0: TL.empty, t1: TL.wide, mode: 'empty', field: 26, yaw: 0, pitch: 0, target: [0, U, 0] },
  { id: 'wide', t0: TL.wide, t1: Infinity, mode: 'wide' },
];
export const shotAt = t => SHOTS.find(s => t >= s.t0 && t < s.t1) || SHOTS[SHOTS.length - 1];
export const CUTS = SHOTS.slice(1).map(s => s.t0);
// the drop's centreline (polariscope_ref.js) is passed in by the scene for the track; this is its arc-length lookup
let CL = null; export function setCentreline(c) { CL = c; S_ENTER = sEnterFor(); BALL.setup(); }
// where the tail crosses the high-speed shot's top edge (the front enters the frame there): arc s (mm)
export function sEnterFor() {
  const S = SHOTS.find(x => x.id === 'hs'), top = S.target[1] + S.field * H / W / 2;
  if (!CL) return 19.6; const P = CL.pts;
  for (let i = 1; i < P.length; i++) if (P[i].p[1] >= top && P[i - 1].p[1] < top) { const u = (top - P[i - 1].p[1]) / (P[i].p[1] - P[i - 1].p[1]); return P[i - 1].s + u * (P[i].s - P[i - 1].s); }
  return 19.6;
}
export function lineAt(s) {
  if (!CL) return { p: [0, s, 0], t: [0, 1, 0] };
  const P = CL.pts; let i = 0; while (i < P.length - 2 && P[i + 1].s < s) i++;
  const a = P[i], c = P[i + 1], u = clamp((s - a.s) / Math.max(1e-9, c.s - a.s));
  const p = [0, 1, 2].map(k => lerp(a.p[k], c.p[k], u)), d = [0, 1, 2].map(k => c.p[k] - a.p[k]), l = Math.hypot(...d) || 1;
  return { p, t: d.map(x => x / l) };
}
// the track up the neck and out along the tail: arc s from 0 (the head) to the site (30 mm), eased; the framing leads the specimen a little
export const SITE_S = 30;
export function trackS(t) { return lerp(0, SITE_S, easeIO((t - TL.site) / (TL.trackEnd - TL.site))); }
// the bench at t: { shot, field (mm), pos, target, up (drop mm), yaw, pitch }
export function benchAt(t) {
  const S = shotAt(t); if (S.mode === 'wide') return { shot: S };
  let field = Array.isArray(S.field) ? S.field[0] : S.field, target = S.target && !Array.isArray(S.target[0]) ? S.target : S.target ? S.target[0] : [0, 0, 0];
  if (S.move) { const u = easeIO((t - S.move[0]) / (S.move[1] - S.move[0])); field = lerp(S.field[0], S.field[1], u); if (S.target) target = [0, 1, 2].map(k => lerp(S.target[0][k], S.target[1][k], u)); }
  // a shot framed on the ball's contact: the contact at the frame fraction frameAt (x from the left, y from the top)
  if (S.frameAt) {
    // c22: the camera takes the hit: a punch in on the instant, then (c) easing back out so the pieces' flight is seen; a shake that dies
    // in a third of a second, first thrown down with the blow
    let kick = [0, 0];
    if (BRK && t >= TL.snap) { const u = t - TL.snap;
      field *= (1 - 0.10 * Math.exp(-u / 0.09)) * (S.id === 'close' ? 1 + 0.32 * sstep(0.05, 1.5, u) : 1);
      const a = field * 0.03 * Math.exp(-u / 0.2);
      kick = [a * Math.sin(2 * Math.PI * 9.0 * u + 0.6), a * Math.cos(2 * Math.PI * 7.0 * u) - field * 0.05 * Math.exp(-u / 0.07)]; }
    const C = BALL.contact, hw = field / 2, hh = field * H / W / 2;
    target = [C[0] - (S.frameAt[0] - 0.5) * 2 * hw + kick[0], C[1] + (S.frameAt[1] - 0.5) * 2 * hh + kick[1], C[2]]; }
  if (S.track) { const s = S.track === 'end' ? SITE_S : trackS(t), L = lineAt(s), u = S.track === 'end' ? 1 : easeIO((t - S.track[0]) / (S.track[1] - S.track[0]));
    field = Array.isArray(S.field) ? lerp(S.field[0], S.field[1], u) : S.field;
    // the specimen a little below and left of centre so the hand has the lower right to come in from
    target = [L.p[0] + 1.6 * u, L.p[1] + 1.4 * u, L.p[2]]; }
  // the lens sits at the bench's focus distance from the target (the scene sets it: bench.js) along dir
  const yaw = (S.yaw || 0) * Math.PI / 180, pitch = (S.pitch || 0) * Math.PI / 180;
  const dir = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];   // from the target toward the lens
  // the one strike: the bench takes it — a small punch in on the contact and a shake that dies in a fifth of a second. The drop is held.
  if (S.id === 'A' && t >= STRIKE.tc) { const u = t - STRIKE.tc, e = Math.exp(-u / 0.11);
    if (e > 0.002) { field *= 1 - 0.06 * Math.exp(-u / 0.05); const a = field * 0.018 * e;
      target = [target[0] + a * Math.sin(2 * Math.PI * 11.0 * u + 0.4), target[1] + a * Math.cos(2 * Math.PI * 9.0 * u), target[2]]; } }
  return { shot: S, field, target, dir, yaw, pitch, up: [0, 1, 0] };
}

// ------------------------------------------------------------------ the instrument's state at t
// the analyser: in the path (1) except while out (the slide 17.14-18.00, out to 28.60, back in 28.60-29.40); the window panel 57.20-58.20
// c20: the analyser sits a few mm in front of the lens, so its edge is far out of focus: a wide soft edge, not a line (v1 read as a wipe)
export const SLIDE_OUT = new Slide({ t0: TL.switchOut, t1: TL.rest, from: W + 340, to: -340, axis: [1, 0], blurPx: 300, element: 'below' });
export const SLIDE_IN = new Slide({ t0: TL.slideIn, t1: TL.slideInEnd, from: -340, to: W + 340, axis: [1, 0], blurPx: 300, element: 'below' });
export function analyserAt(t) {
  if (t < TL.switchOut) return 1;
  if (t < TL.rest) return SLIDE_OUT;
  if (t < TL.slideIn) return 0;
  if (t < TL.slideInEnd) return SLIDE_IN;
  return 1;
}
// the window panel (source-side polariser + filter): its soft horizontal edge sweeps UP the frame; the panel above its edge (y px down)
export function panelSlide(blurPx) { return new Slide({ t0: TL.panel, t1: TL.panelEnd, from: H + blurPx, to: -blurPx, axis: [0, 1], blurPx, element: 'below' }); }
// the rack of focus to the works: 0 (on the jaws, the world at its full blur) .. 1 (on the works)
export const rackAt = t => cosIO((t - TL.rack) / (TL.rackEnd - TL.rack));

// the making (the tank, 27.43-34.29): the blob falls into the water and settles on the mesh by 28.60; the analyser slides back in; the
// glow fades below incandescence while the fringes bloom from the skin inward (the quench played about twenty times fast: a 6 mm head's
// thermal time a^2/kappa is about 70 s; 80 s of cooling in 4 s)
export const FALL = { y0: 46, y1: 0 };                                 // mm above its resting place where it enters the frame
export function makingAt(t) {
  const tau = t - TL.fall, uf = clamp(tau / (TL.settle - TL.fall));
  // falling through water: fast at entry, the Leidenfrost film and the drag slow it, a small settle on the mesh
  const y = FALL.y0 * (1 - (1 - Math.pow(1 - uf, 2.2))) + (uf >= 1 ? 0.25 * Math.exp(-(tau - (TL.settle - TL.fall)) * 9) * Math.sin((tau - 1.17) * 30) : 0);
  const tailMax = lerp(9, 100, sstep(0, 1, uf));                      // the tail draws out above it as it falls
  const freeze = sstep(TL.bloom, TL.bloomEnd, t);
  // the glass's temperature (C): 1050 entering, the surface first; incandescence (above ~550 C) gone by about 30.4 s
  const Tc = 1050 * Math.exp(-Math.max(0, t - TL.fall) / 1.9) + 20;
  return { offset: [0, Math.max(0, y), 0], tailMax, freeze, Tc, boiling: clamp(1 - (t - TL.settle) / 1.4) };
}
// steam bubbles: rising from the blob while it boils (seeded, rising at about 25 mm/s with a wobble), mm in the drop frame
export function bubblesAt(t, n = 10) {
  const out = [], M = makingAt(t); if (M.boiling <= 0) return out;
  for (let i = 0; i < n; i++) { const born = TL.fall + 0.12 * i + 0.05 * Math.sin(i * 7.1), age = t - born; if (age < 0) continue;
    const cyc = age % 0.9, r = 0.35 + 0.45 * ((i * 0.618) % 1), ang = i * 2.4;
    out.push([Math.cos(ang) * (4 + 2.5 * ((i * 0.37) % 1)) + 0.6 * Math.sin(cyc * 9 + i), M.offset[1] + 3 + cyc * 25, Math.sin(ang) * 3, r * M.boiling]); }
  return out;
}
// the crack front: instrument time (us) since the front entered the frame. 48.15-54.60 about 410,000 times slower than real time; the
// clock ramps to real time on a log curve inside the shot (54.60-55.00); the ghost bursts at real time
// the instrument's rate: the front crosses the high-speed frame's tail (S_ENTER to the head) and the head by the ramp (take A: 350,000x)
export let SLOW = TAKE === 'b' ? 230000 : 350000; export let S_ENTER = 19.6;
// c20: one clock from the break. In the close shot the front leaves the break (arc BALL.sA) toward the head at the instrument's rate; the cut
// to the high-speed shot elides the stretch of tail between the two frames (the front arrives at the high-speed frame's top edge at the cut).
export const FRONT_V = 1.8;                                           // mm/us
export function instrumentAt(t) {
  if (t < TL.snap) return null;
  const sEnter = BALL.sA;
  if (t < TL.hs) return { tI: (t - TL.snap) * 1e6 / SLOW, sEnter, ghost: 1, close: true };
  const t0 = Math.max(0, (sEnter - S_ENTER) / FRONT_V - 0.15);          // us: the front just above the frame's top at the cut
  const r0 = 1 / SLOW, k = Math.log(SLOW) / (TL.real - TL.ramp);
  let tI;
  if (t <= TL.ramp) tI = (t - TL.hs) * r0 * 1e6;
  else if (t <= TL.real) tI = ((TL.ramp - TL.hs) * r0 + r0 * (Math.exp(k * (t - TL.ramp)) - 1) / k) * 1e6;
  else tI = ((TL.ramp - TL.hs) * r0 + r0 * (Math.exp(k * (TL.real - TL.ramp)) - 1) / k + (t - TL.real)) * 1e6;
  return { tI: tI + t0, sEnter, ghost: 1 - sstep(TL.real, TL.real + 0.22, t), real: Math.max(0, t - TL.real) };
}
// the film time at which the instrument clock reads tI: the inverse of instrumentAt (the fragments release on the front's arrival)
export function filmAtInstrument(tI) {
  if (!(tI > 0)) return TL.snap;
  if (tI <= instrumentAt(TL.hs).tI) return TL.snap + tI * SLOW / 1e6;
  let lo = TL.hs, hi = END;
  for (let i = 0; i < 52; i++) { const m = 0.5 * (lo + hi); if (instrumentAt(m).tI < tI) lo = m; else hi = m; }
  return 0.5 * (lo + hi);
}

// ------------------------------------------------------------------ light over the piece: the sky brightens between shots (sun -6 -> 0 degrees)
export function sunElevation(t) { return t < TL.wide ? lerp(-6, -1.2, sstep(0, TL.wide, t)) : lerp(0.2, 0.9, clamp((t - TL.wide) / (END - TL.wide))); }
export const skyGain = t => Math.pow(2, lerp(0, 2.2, sstep(0, TL.empty, t)));   // the band's sky radiance relative to frame 0 (+2.2 stops by the end)

// ------------------------------------------------------------------ the hand is gone (c20): the site is found by a weight, not a grip
export function handAt() { return null; }

// ------------------------------------------------------------------ THE BALL (c20). A polished steel ball, 3.5 mm, cut from the striker's own steel,
// dropped from 30 cm onto the tail at arc 44 mm (where the tail has thinned to 1.15 mm and runs nearly level), filmed at 600x: at 2.4 m/s it
// crosses the frame at 4 mm/s and gravity adds 3 % over the fall, so it drifts, near-constant, no blur. It touches; the clock slows into the
// instrument's while the tail takes the load (it bends 0.2 mm, the fringes crowd under the contact); on the beat it fails. Mm, drop frame.
const G_MM = 9810;
export const BALL = {
  R: 1.75, s: 44, F: 600, v: 2400, dmax: 0.2, vPost: 2.4, sA: 0, sB: 0, contact: [0, 0, 0], centre0: [0, 0, 0], nUp: [0, 1, 0], tan: [1, 0, 0], r: 0.57,
  setup() {
    const L = lineAt(this.s), T = L.t, n = [-T[1], T[0], 0], k = Math.hypot(n[0], n[1]) || 1; let nu = n.map(x => x / k); if (nu[1] < 0) nu = nu.map(x => -x);
    this.r = DROP.rTail(this.s); this.tan = T; this.nUp = nu;
    this.contact = L.p.map((x, i) => x + nu[i] * this.r);
    this.centre0 = L.p.map((x, i) => x + nu[i] * (this.r + this.R));
    this.sA = this.s - 1.5; this.sB = this.s + 1.1;
  },
};
BALL.setup();
// the ball at t: centre (mm), its spin (rad about a tilted axis), visible; and the load on the tail
export function ballAt(t) {
  if (t < TL.geo || t >= TL.hs) return null;
  const B = BALL; let dy;
  if (t < TL.touch) { const tau = (t - TL.touch) / B.F; dy = -B.v * tau - 0.5 * G_MM * tau * tau; }
  else if (t < TL.snap) dy = -B.dmax * Math.pow(sstep(TL.touch, TL.snap, t), 1.5);
  else { const u = t - TL.snap; dy = -B.dmax - B.vPost * (u - 0.25 * (1 - Math.exp(-u / 0.25))) - (BRK ? 0.9 * (1 - Math.exp(-u / 0.06)) : 0); }
  const c = [B.centre0[0], B.centre0[1] + dy, B.centre0[2]];
  return { centre: c, spin: 0.22 * (t - TL.geo), R: B.R };
}
// the load (0..1) the tail carries: from the touch to the failure; nothing after
export const loadAt = t => (t < TL.touch || t >= TL.snap ? 0 : Math.pow(sstep(TL.touch, TL.snap, t), 1.5));
// the tail's deflection (mm, downward) at arc s for a load point deflection d: a cantilever from the head (s 6 mm) with the point load at
// BALL.s (w = d x^2 (3 - x) / 2, x = s'/L'), the tail beyond it carried on rigidly at the load point's slope
export function bendW(s, d) {
  const L = BALL.s - 6, x = Math.max(0, s - 6) / L;
  return s <= BALL.s ? d * x * x * (3 - x) / 2 : d + 1.5 * d / L * (s - BALL.s);
}
// the falling piece (the tail past the break) after the failure: it tips about the break's far end and drops (film seconds since the break)
export function tipMotion(t) {
  if (t < TL.snap) return null;
  const u = t - TL.snap, e = u - 0.3 * (1 - Math.exp(-u / 0.3));
  if (BRK) { const c = breakClock(u); return { pivot: lineAt(BALL.sB).p, angle: -0.45 * c, drop: 3.6 * c, drift: 1.0 * c }; }   // c22: whipped away
  return { pivot: lineAt(BALL.sB).p, angle: -0.22 * e, drop: 2.6 * e, drift: 0.6 * e };
}

// ------------------------------------------------------------------ the wide (UPRIGHT): the camera at eye level, a 3 % push
export const WIDE = { pos: [-40, 1.6, 6.5], look: [60, 6.5, 4.0], fovY: 54.43, push: 0.03 };   // 35 mm equivalent on a vertical frame: 54.4 deg high
export function wideAt(t) { const u = clamp((t - TL.wide) / (END - TL.wide)); return { zoom: 1 + WIDE.push * easeIO(u), u }; }
// nine walkers (names from the twelve of main's person pipeline: lib/fx/person/core.js V2_PLAN): start positions (x, z) metres ahead of the camera, walking east to the gate at x 0
export const WALKERS = [
  { name: 'L05_m59_black', from: [-35.6, 7.0], speedK: 0.92, start: 0.0 },     // the hand's owner, nearest, his back to us
  { name: 'L08_f24_hispanic', from: [-31.5, 4.1], speedK: 1.02, start: 0.25 },
  { name: 'L17_m28_hispanic', from: [-29.0, 8.6], speedK: 1.0, start: 0.1 },
  { name: 'L12_f39_white', from: [-27.4, 6.2], speedK: 0.96, start: 0.45 },
  { name: 'L21_m32_black', from: [-25.2, 3.0], speedK: 1.04, start: 0.05 },
  { name: 'L06_f53_white', from: [-23.6, 8.4], speedK: 0.9, start: 0.3 },
  { name: 'L03_m38_asian', from: [-18.6, 5.3], speedK: 0.98, start: 0.15 },
  { name: 'L22_f27_black', from: [-17.0, 7.2], speedK: 1.0, start: 0.55 },
  { name: 'L23_m45_white', from: [-15.4, 4.4], speedK: 0.95, start: 0.2 },
];
