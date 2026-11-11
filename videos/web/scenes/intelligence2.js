// ACCELERATE v9 (cycle 13, 1 Oct 2026): v6 without JFK and Apollo, and with the sources given their room. The argument is the chairman's
// own (Communism in the Post-MAGA Age, ch. 2) with Marx and Lange at length: the runaway machine is real (Marx, whole: the automaton
// of mechanical and intellectual organs, the workers cast as its conscious linkages); the CCRU was right about that and wrong to call it
// Capital; Capital's own governor, the market, hunts and stalls (Lange); the stall is answered by Lange's computer (the market a
// pre-electronic computing device, the equations solved in under a second, the computer the instrument of planning) and by the
// chairman's real-source sentence, whole, with no hero example; they had no theory of the political, so class struggle is about how
// AI is aligned; the Party Program; the banner.
// The piece's one drawn object is the flyball governor (Lange's "servo-mechanism" in metal): frame 0 at speed, its plate reads CAPITAL,
// then THE MARKET, it hunts, is clamped, goes silent; a finger on START (Master Hands, 1936) restarts it and it runs true (plate
// COMPUTER); it idles with nobody at it; it leaves the field for the banner. The people are real film printed as halftone on the paper
// (Master Hands 1936: the organs and linkages of the machine, the line, the floor, a gauge), the worker and the scaffold at the Program.
// White ink world; red only at the banner. Sources: research/scripts_final/intelligence.json.
import { W, H, loadFonts, loadBeats, clamp, lerp, smooth, ease, rng, Finish, outCanvas, BRAND, tinted, acpEmblem, sigil } from '../lib/kit.js';
import { loadFace } from '../lib/fx/type.js';
import { setBlock, measure } from '../lib/fx/type_world.js';
import { Streaks, camRot } from '../lib/fx/streaks.js';
import { loadTake } from '../lib/fx/bvh.js';
import * as WD from './intelligence2.world.js';
import * as FILM from './intelligence2.film.js';
import * as POST from './intelligence2.post.js';

const ctx = outCanvas();
await loadFonts();
// c20: two takes of the post-chip recursion, as their own scenes (intelligence2_a.js, intelligence2_b.js set these before importing this file)
const SCENE = window.ACC_SCENE ?? 'intelligence2', TAKE = window.ACC_TAKE ?? 'a';
const B = await loadBeats(SCENE);
const SPARTAN = await loadFace('../../assets/fonts/league-spartan-latin-900-normal.woff');
const WALK = await loadTake('../../sources/mocap/cmu/08_01.bvh', { travel: true });
const SIL = { types: [], cell: () => null, blit: () => {} };
const finish = new Finish(172);
const sk = new Streaks();

const INK = '#0b0b0b', PAPER = '#f7f7f2', RED = WD.RED;
const BANDS = WD.BANDS;
const D2R = Math.PI / 180, TAU = Math.PI * 2;
const CLOSE_AT = 128;
const PLAYFAIR = await loadFace('playfair');
const PLAYFAIRB = await loadFace('playfair-display/files/playfair-display-latin-700-normal.woff');      // the quotation face: Bold, whose counters stay open at phone size
{ const f = new FontFace('PlayfairX', 'url(../node_modules/@fontsource/playfair-display/files/playfair-display-latin-900-normal.woff2)'); document.fonts.add(await f.load()); }

// ------------------------------------------------------------------ script (research/scripts_final/intelligence.json, v6)
// b: beat; t: the lines of the frame (the joints are the sources' own); v: voice; tag: the source caption under it.
// voices: slam (the Party's slam face), serif (a source in Playfair caps set straight on the world, caption under),
// tape (a strip of black label tape with the words in paper caps, in the photograph), slip (a titled document: the Program),
// stack (the banner).
const MARX = 'MARX · GRUNDRISSE · 1858', BOOK = '"COMMUNISM IN THE POST-MAGA AGE", ACP CHAIRMAN', LANGE = 'OSKAR LANGE · THE COMPUTER AND THE MARKET · 1967';
const HAZ = 'EXECUTIVE CHAIRMAN, AMERICAN COMMUNIST PARTY', PROG = 'ACP PROGRAM';
const T_TAIL = 16;                      // v6's last third (the political turn on) sits 16 beats later than in v6: Lange's answer and the chairman's whole sentence fill what v6 gave to a different story
const WORDS = [
  // Marx, Grundrisse (M1): the automatic system, the automaton, the moving power, the organs, the workers as its conscious linkages
  { b: 0, t: ['AN AUTOMATIC', 'SYSTEM OF', 'MACHINERY,'], v: 'serif', tag: MARX, y: 420, cap: 190, maxW: 980 },
  { b: 2.5, t: ['SET IN MOTION BY', 'AN AUTOMATON,'], v: 'serif', tag: MARX, y: 440, cap: 150, maxW: 980 },
  { b: 5, t: ['A MOVING POWER', 'THAT MOVES ITSELF;'], v: 'serif', tag: MARX, y: 440, cap: 150 },
  { b: 8, t: ['THIS AUTOMATON', 'CONSISTING OF NUMEROUS', 'MECHANICAL AND', 'INTELLECTUAL ORGANS,'], v: 'serif', y: 400, cap: 112, tag: MARX, band: false },
  { b: 12, t: ['SO THAT THE WORKERS', 'THEMSELVES ARE CAST'], v: 'serif', y: 440 },
  { b: 14.5, t: ['MERELY AS ITS', 'CONSCIOUS LINKAGES.'], v: 'serif', y: 440, cap: 150, band: false },
  // the chairman on the CCRU (ch. 2), whole: the concession, then the correction
  { b: 17.5, t: ['THE CCRU', 'IDENTIFIED'], v: 'slam', y: 430, cap: 190, tag: BOOK },
  { b: 19.5, t: ['A RADICALLY', 'AUTONOMOUS,'], v: 'slam', y: 430, cap: 190 },
  { b: 21.5, t: ['IMPERSONAL,', 'AND RUNAWAY'], v: 'slam', y: 430, cap: 190 },
  { b: 23.5, t: ['CYBERNETIC', 'PRINCIPLE'], v: 'slam', y: 430, cap: 190 },
  { b: 25.5, t: ['ACCELERATING THE', 'FUNDAMENTAL'], v: 'slam', y: 430, cap: 175 },
  { b: 27.5, t: ['TRANSFORMATION', 'OF SOCIETY.'], v: 'slam', y: 430, cap: 175 },
  { b: 29.5, t: ['THIS WAS', 'NOT INCORRECT.'], v: 'slam', y: 430, cap: 190 },
  { b: 32, t: ['THEY WERE', 'WRONG'], v: 'slam', y: 430, cap: 215 },
  { b: 34.5, t: ['TO IDENTIFY', 'THIS PRINCIPLE'], v: 'slam', y: 430, cap: 190 },
  { b: 37, t: ['WITH', 'CAPITAL.'], v: 'slam', y: 470, cap: 330 },
  // Lange (LA1): the market as a servo-mechanism, hunting
  { b: 40, t: ['THE MARKET IS', 'A CUMBERSOME'], v: 'serif', tag: LANGE, y: 480 },
  { b: 43, t: ['AND SLOW-WORKING'], v: 'serif', tag: LANGE, y: 480 },
  { b: 45, t: ['SERVO-MECHANISM.'], v: 'serif', tag: LANGE, y: 480 },
  { b: 47.5, t: ['CONSIDERABLE', 'TIME-LAGS', 'AND OSCILLATIONS'], v: 'serif', tag: LANGE, y: 520 },
  { b: 51, t: ['MAY NOT BE', 'CONVERGENT', 'AT ALL.'], v: 'serif', tag: LANGE, y: 520 },
  { b: 54.5, t: null },
  // Lange's answer, out of the silence: the computer, the market as its pre-electronic ancestor, the instrument of planning
  { b: 58, t: ['LET US PUT THE', 'SIMULTANEOUS', 'EQUATIONS'], v: 'serif', tag: LANGE, y: 480 },
  { b: 61, t: ['ON AN ELECTRONIC', 'COMPUTER'], v: 'serif', tag: LANGE, y: 480 },
  { b: 63.5, t: ['AND WE SHALL OBTAIN', 'THE SOLUTION', 'IN LESS THAN A SECOND.'], v: 'serif', tag: LANGE, y: 480 },
  { b: 67, t: ['THE MARKET PROCESS…', 'APPEARS OLD-FASHIONED.'], v: 'serif', tag: LANGE, y: 480 },
  { b: 69.5, t: ['IT MAY BE CONSIDERED', 'AS A COMPUTING DEVICE', 'OF THE PREELECTRONIC AGE.'], v: 'serif', tag: LANGE, y: 480 },
  { b: 73, t: ['MATHEMATICAL PROGRAMMING', 'ASSISTED BY ELECTRONIC', 'COMPUTERS BECOMES'], v: 'serif', tag: LANGE, y: 480 },
  { b: 76, t: ['THE FUNDAMENTAL', 'INSTRUMENT OF LONG-TERM', 'ECONOMIC PLANNING.'], v: 'serif', tag: LANGE, y: 480 },
  // the chairman's real-source sentence, whole (ch. 2)
  { b: 79.5, t: ['THE DEVELOPMENT OF', 'SOPHISTICATED INFORMATION', 'AND CYBERNETIC', 'TECHNOLOGIES'], v: 'slam', y: 400, cap: 125, tag: BOOK },
  { b: 82, t: ['BY THE US', 'MILITARY-INDUSTRIAL', 'COMPLEX,'], v: 'slam', y: 410, cap: 140 },
  { b: 84.5, t: ['ARISING AS A', 'CONSEQUENCE OF COMPLEX', 'YET HIGHLY EFFECTIVE'], v: 'slam', y: 410, cap: 125 },
  { b: 87, t: ['SYSTEMS OF RESEARCH', 'AND DEVELOPMENT,'], v: 'slam', y: 430, cap: 150 },
  { b: 89.5, t: ['WAS THE REAL SOURCE', 'OF ‘ACCELERATION’', 'OF SOCIETY,'], v: 'slam', y: 410, cap: 140 },
  { b: 92.5, t: ['AND NOT', '‘CAPITAL.’'], v: 'slam', y: 470, cap: 300 },
  // v6 on, unchanged (T_TAIL later)
  // v13 (archive audit 8 Oct, item 5): re-checked against infrared.gg/thought/communism-in-the-post-maga-age/02, which reads 'Of course, they had no theory
  // or notion of the political (and that is aptly how we may simplify the inherent theoretical limitations of that peculiar school of thought).': both cuts are
  // marked, the dropped 'Of course,' and the dropped parenthetical; the CCRU and real-source sentences above are verbatim there
  { b: 79.5 + T_TAIL, t: ['…THEY HAD NO THEORY', 'OR NOTION OF', 'THE POLITICAL…'], v: 'serif', tag: BOOK, y: 470 },
  // v12 (client, 3 Oct: 'a transition / further exposition on the role of the working class in AI alignment and what AI can unlock'): Haz's own sentence on alignment
  // (x.com/InfraHaz/status/2097471041006137438, 8 Sep 2026, verbatim: 'The alignment of AI is a genuine battlefield. It cannot align itself autonomously or give itself
  // purpose outside of human influence.'), set at fractional keys between THEORY (95.5) and CLASS (100) so nothing after is renumbered
  { b: 97, t: ['THE ALIGNMENT OF AI', 'IS A GENUINE BATTLEFIELD.'], v: 'slam', y: 430, cap: 150, tag: HAZ },
  { b: 98.2, t: ['IT CANNOT ALIGN ITSELF', 'AUTONOMOUSLY'], v: 'slam', y: 430, cap: 150 },
  { b: 99.1, t: ['OR GIVE ITSELF PURPOSE', 'OUTSIDE OF HUMAN INFLUENCE.'], v: 'slam', y: 430, cap: 150 },
  { b: 84 + T_TAIL, t: ['CLASS STRUGGLE', 'IS INCREASINGLY'], v: 'slam', y: 430, cap: 165, tag: HAZ },
  { b: 87.5 + T_TAIL, t: ['GOING TO BE ABOUT', 'HOW AI IS ALIGNED.'], v: 'slam', y: 430, cap: 165 },
  // v12: who aligns it (the client's own line, LINE_SOURCES CL71: 'a working class that is the master of all things'), then what it unlocks: the Program
  // v13 (archive audit 8 Oct): the client's line is the Party's own words, not a citation: set in the Party's sans on the slip (party), no caption
  { b: 105.5, t: ['A WORKING CLASS', 'THAT IS THE MASTER', 'OF ALL THINGS:'], v: 'slam', y: 430, cap: 165, party: true },
  { b: 91.5 + T_TAIL, t: ['ACCELERATE THE', 'FOURTH INDUSTRIAL', 'REVOLUTION'], v: 'slip', tag: PROG },
  { b: 95 + T_TAIL, t: ['AI-DRIVEN NATIONAL', 'ECONOMIC PLANNING'], v: 'slip', tag: PROG },
  { b: 98 + T_TAIL, t: ['ADVANCING NATIONAL', 'DEVELOPMENT,'], v: 'slip', tag: PROG },
  { b: 100.5 + T_TAIL, t: ['REDUCING THE', 'WORK WEEK AND', 'LABORING YEARS'], v: 'slip', tag: PROG },
  { b: 102.5 + T_TAIL, t: ['INTELLIGENCE'], v: 'stack', n: 0 }, { b: 104 + T_TAIL, t: ['IN SERVICE'], v: 'stack', n: 1 }, { b: 105.5 + T_TAIL, t: ['OF HUMANITY.'], v: 'stack', n: 2 },
  { b: 109 + T_TAIL, t: ['ACCELERATE.'], v: 'big', y: 1180, cap: 330 },
  { b: CLOSE_AT, t: null }];
const BANNER = ['INTELLIGENCE', 'IN SERVICE', 'OF HUMANITY.'];
// c14 pacing: v8's cards were keyed to the song's old beats and several held far too briefly for their words (9 words in 1.25 s). MAP stretches each
// card's interval to the time its words need to be read (0.45 s + 0.24 s a word), keeping the stall, the banner and the closer as they were.
// Everything below stays keyed in OLD beats (the "keys"); `toOld(bn)` turns the playing beat into a key, `toNew(bo)` back.
const READ = (n) => 0.45 + 0.24 * n;
// c14 ORDER (client, 1 Oct: Lange's lines are good but must not be the brake in the middle; a slow measured idea goes at the FRONT, before the tension builds through
// the Grundrisse): the piece plays Lange's market and its stall, the restart, and his computer FIRST (key beats 40-79.5), then Marx and the CCRU (0-40), then the chairman's
// sentence, the political turn, the Program and the banner (79.5-128), one build with no brake.  ORDER lists the key intervals in the order they play.
const ORDER = [[40, 79.5], [0, 40], [79.5, CLOSE_AT]];
// v10 (client, 3 Oct): after Lange's computer (the chips, key 63.5) the pace ACCELERATES. Each card after it is compressed by KF (the CCRU's runaway the most,
// tightening card by card), with a faster reading floor; THEY WERE WRONG is the one card that is not (the runaway stopped dead).
const POSTK = (k) => k >= 67 || k < 40;
// v12 (client: 'slightly slower paced for readers to take in the text'): the compression eased and the reading floor raised
const KF = (k) => k >= 118.5 ? 1 : k >= 79.5 ? 0.95 : k >= 67 ? 0.9 : k < 17.5 ? 0.9 : k < 32 ? lerp(0.9, 0.7, (k - 17.5) / 12) : 1;
const READ2 = (n, k) => (k >= 17.5 && k < 32 ? 0.34 : 0.42) + 0.235 * n;
const MAP = (() => { const m = []; let nb = 0;
  for (const [k0, k1] of ORDER) for (let i = 0; i < WORDS.length - 1; i++) { const w = WORDS[i], nx = WORDS[i + 1]; if (w.b < k0 - 1e-9 || w.b >= k1 - 1e-9) continue;
    const od = (nx.b - w.b) * B.spb, nw = w.t && w.v !== 'stack' && w.v !== 'big' ? w.t.join(' ').split(/\s+/).length : 0;
    const nd = POSTK(w.b) ? Math.max(od * KF(w.b), nw ? READ2(nw, w.b) : 0) : Math.max(od, nw ? READ(nw) : 0), nbt = nd / B.spb;
    m.push([w.b, nx.b, nb, nb + nbt]); nb += nbt; }
  return m; })();
const CLOSE_NEW = MAP[MAP.length - 1][3];
const toOld = (bn) => { if (bn >= CLOSE_NEW) return CLOSE_AT + (bn - CLOSE_NEW); for (const [o0, o1, n0, n1] of MAP) if (bn < n1) return o0 + (bn - n0) / (n1 - n0) * (o1 - o0); return CLOSE_AT; };
const toNew = (bo) => { if (bo >= CLOSE_AT) return CLOSE_NEW + (bo - CLOSE_AT); for (const [o0, o1, n0, n1] of MAP) if (bo >= o0 - 1e-9 && bo < o1) return n0 + (bo - o0) / (o1 - o0) * (n1 - n0); return CLOSE_NEW; };
window.__map = { MAP, CLOSE_NEW };
const wordAt = (b) => { let r = WORDS[0]; for (const w of WORDS) if (b >= w.b) r = w; return r; };

// ------------------------------------------------------------------ speed (the streak field) as a function of beat
const SPEED = [[0, 60], [8, 110], [17.5, 150], [40, 190], [40.5, 30], [54.5, 25], [55, 2], [58, 2], [61.5, 40], [95.5, 20], [100, 70], [118.5, 40], [125, 90], [128, 90], [150, 90]];
const speedAt = (b) => { let i = 0; while (i < SPEED.length - 1 && SPEED[i + 1][0] <= b) i++;
  const [b0, v0] = SPEED[i], nx = SPEED[i + 1]; if (!nx) return v0; return lerp(v0, nx[1], ease.inOutCubic(clamp((b - b0) / 0.4))); };
const STEP = 1 / 64, TRAVEL = [0];
for (let i = 1; i <= 130 / STEP; i++) TRAVEL.push(TRAVEL[i - 1] + speedAt((i - 0.5) * STEP) * STEP * B.spb);
const travel = (b) => { const x = clamp(b, 0, 129.9) / STEP, i = Math.floor(x); return lerp(TRAVEL[i], TRAVEL[i + 1], x - i); };
const pitch = (b) => clamp(0.3);
const focal = (fovDeg) => (W / 2) / Math.tan(fovDeg * D2R / 2);
const at = (list, b) => { let r = list[0]; for (const x of list) if (b >= x[0]) r = x; return r; };

// ------------------------------------------------------------------ geometry helpers
const rot = (p, a) => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mix2 = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];
function smoothClosed(pts, p = new Path2D()) {        // Catmull-Rom through pts, closed
  const n = pts.length;
  p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    p.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
  }
  p.closePath(); return p;
}
function poly(pts, p = new Path2D()) { p.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]); p.closePath(); return p; }
// a tapered limb from a to b (screen px): widths w0, w1, front/back bulges (px). "front" = +normal of a downward limb.
function limb(a, b, w0, w1, bf = 0, bb = 0) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = uy, ny = -ux;
  const A0 = [a[0] + nx * w0 / 2, a[1] + ny * w0 / 2], A1 = [b[0] + nx * w1 / 2, b[1] + ny * w1 / 2];
  const B0 = [a[0] - nx * w0 / 2, a[1] - ny * w0 / 2], B1 = [b[0] - nx * w1 / 2, b[1] - ny * w1 / 2];
  const mF = [(A0[0] + A1[0]) / 2 + nx * bf, (A0[1] + A1[1]) / 2 + ny * bf], mB = [(B0[0] + B1[0]) / 2 - nx * bb, (B0[1] + B1[1]) / 2 - ny * bb];
  const p = new Path2D();
  p.moveTo(A0[0], A0[1]);
  p.quadraticCurveTo(2 * mF[0] - (A0[0] + A1[0]) / 2, 2 * mF[1] - (A0[1] + A1[1]) / 2, A1[0], A1[1]);
  p.bezierCurveTo(A1[0] + ux * w1 * 0.55, A1[1] + uy * w1 * 0.55, B1[0] + ux * w1 * 0.55, B1[1] + uy * w1 * 0.55, B1[0], B1[1]);
  p.quadraticCurveTo(2 * mB[0] - (B0[0] + B1[0]) / 2, 2 * mB[1] - (B0[1] + B1[1]) / 2, B0[0], B0[1]);
  p.bezierCurveTo(B0[0] - ux * w0 * 0.55, B0[1] - uy * w0 * 0.55, A0[0] - ux * w0 * 0.55, A0[1] - uy * w0 * 0.55, A0[0], A0[1]);
  p.closePath(); return p;
}
// the prism fringe: bands stroked outside every path (red widest), optionally pushed along the motion `off`
function fringe(c, paths, fr, off = [0, 0]) {
  c.save(); c.lineJoin = 'round'; c.lineCap = 'round';
  for (const [col, k] of BANDS) {
    c.save(); c.translate(off[0] * k, off[1] * k);
    c.strokeStyle = col; c.lineWidth = 2 * fr * k;
    for (const p of paths) c.stroke(p);
    c.restore();
  }
  c.restore();
}
function inkFill(c, paths, color = INK) { c.fillStyle = color; for (const p of paths) c.fill(p); }
function union(paths) { const u = new Path2D(); for (const p of paths) u.addPath(p); return u; }
function prismStroke(c, path, w, fr = 3.5, color = INK) {
  c.save(); c.lineJoin = 'round'; c.lineCap = 'round';
  for (const [col, k] of BANDS) { c.strokeStyle = col; c.lineWidth = w + 2 * fr * k; c.stroke(path); }
  c.strokeStyle = color; c.lineWidth = w; c.stroke(path); c.restore();
}

// ------------------------------------------------------------------ the worker: a closed-form stride in figure units (x forward, y up, sole at 0)
function pose(phi, o = {}) {
  const amp = o.amp ?? 1, lean = (o.lean ?? 9) * D2R;
  const TH = 25, SH = 24.5, SPN = 27, UA = 16, FA = 14;
  const g = (q, c, w) => { const d = ((q - c + 1.5) % 1) - 0.5; return Math.exp(-((d / w) ** 2)); };
  const leg = (p) => {
    const q = ((p % 1) + 1) % 1;
    const hip = amp * 31 * Math.sin(TAU * q) * D2R;
    const knee = (4 + amp * 60 * Math.max(0, Math.cos(TAU * (q + 0.1))) ** 2) * D2R;
    const fp = amp * (-34 * g(q, 0.82, 0.08) + 12 * g(q, 0.24, 0.07)) * D2R;
    const K = [TH * Math.sin(hip), -TH * Math.cos(hip)], b = hip - knee;
    const A = [K[0] + SH * Math.sin(b), K[1] - SH * Math.cos(b)];
    return { q, hip, knee, fp, shin: b, K, A };
  };
  const legs = [leg(phi), leg(phi + 0.5)];
  let low = 1e9;
  for (const l of legs) for (const p of [[-4.2, -6.4], [11.8, -6.4]]) low = Math.min(low, l.A[1] + rot(p, l.fp)[1]);
  const ph = -low;
  const arm = (p, up) => {
    const q = ((p % 1) + 1) % 1;
    const a = up != null ? up * D2R : -amp * 27 * Math.sin(TAU * q) * D2R;
    const e = up != null ? 12 * D2R : (18 + amp * 34 * Math.max(0, -Math.sin(TAU * q))) * D2R;
    return { a, e };
  };
  const P = [0, ph], S = [P[0] + SPN * Math.sin(lean), P[1] + SPN * Math.cos(lean)];
  const Sj = add(S, rot([-0.4, -2.6], -lean));
  const arms = [arm(phi, o.armUp?.[0]), arm(phi + 0.5, o.armUp?.[1])].map(({ a, e }) => {
    const E = [Sj[0] + UA * Math.sin(a), Sj[1] - UA * Math.cos(a)], f = a + e;
    const Wr = [E[0] + FA * Math.sin(f), E[1] - FA * Math.cos(f)];
    return { a, e, f, E, Wr };
  });
  const N = add(S, rot([1.0, 1.6], -lean)), Hc = add(N, rot([1.0, 6.4], -lean * 0.45));
  legs.forEach(l => { l.K = add(l.K, P); l.A = add(l.A, P); });
  return { P, S, Sj, N, Hc, lean, legs, arms, SPN, headRot: -lean * 0.45 + (o.look ?? 0) * D2R };
}

// ---- the hero's stride from motion capture (CMU 08_01 walk, HUMAN studio bvh.js), in the same joint set as pose():
// profile (x forward = the take's travel, y up), figure units (thigh = 25), one stride cycle per 2 beats, on twos
const MOC = (() => {
  const cyc = WALK.cycle(), T0 = cyc.t0, TL = cyc.t1 - cyc.t0;
  const jp = (n, t) => { const v = WALK.jointAt(n, t); return [v.z, v.y]; };
  const th = Math.hypot(...[0, 1].map(i => jp('LeftUpLeg', T0)[i] - jp('LeftLeg', T0)[i]));
  const U = 25 / th;
  // the foot's resting angle (ankle -> toe) when it is planted flat, so the boot's sole is flat on the ground
  let rest = 0, lo = 1e9;
  for (let k = 0; k < 24; k++) { const t = T0 + TL * k / 24, a = jp('LeftFoot', t), b = jp('LeftToeBase', t); if (a[1] + b[1] < lo) { lo = a[1] + b[1]; rest = Math.atan2(b[1] - a[1], b[0] - a[0]); } }
  return { T0, TL, U, rest };
})();
function mocap(phase, o = {}) {
  let ph = ((phase % 1) + 1) % 1;
  if (o.twos !== false) ph = Math.floor(ph * 22) / 22;             // ~15 fps poses at the 2-beat cycle: on twos
  const t = MOC.T0 + ph * MOC.TL, U = MOC.U;
  const hip = WALK.jointAt('Hips', t), ox = hip.z;
  const J_ = (n) => { const v = WALK.jointAt(n, t); return [(v.z - ox) * U, v.y * U]; };
  const P = J_('Hips');
  const legs = ['Left', 'Right'].map((sd, i) => { const K = J_(sd + 'Leg'), A = J_(sd + 'Foot'), T = J_(sd + 'ToeBase');
    const fp = Math.atan2(T[1] - A[1], T[0] - A[0]) - MOC.rest; return { q: (ph + i * 0.5) % 1, K, A, fp }; });
  // the sole's lowest point sits on y = 0
  let low = 1e9; for (const l of legs) for (const p of [[-4.2, -6.4], [11.8, -6.4]]) low = Math.min(low, l.A[1] + rot(p, l.fp)[1]);
  const up = (p) => [p[0], p[1] - low];
  P[1] -= low; for (const l of legs) { l.K = up(l.K); l.A = up(l.A); }
  const LS = up(J_('LeftArm')), RS = up(J_('RightArm')), S = [(LS[0] + RS[0]) / 2, (LS[1] + RS[1]) / 2 + 1.5];
  const lean = Math.atan2(S[0] - P[0], S[1] - P[1]) + (o.lean ?? 0) * D2R, SPN = Math.hypot(S[0] - P[0], S[1] - P[1]);
  const arms = ['Left', 'Right'].map(sd => { const Sj = up(J_(sd + 'Arm')), E = up(J_(sd + 'ForeArm')), Wr = up(J_(sd + 'Hand'));
    const a = Math.atan2(E[0] - Sj[0], -(E[1] - Sj[1])), f = Math.atan2(Wr[0] - E[0], -(Wr[1] - E[1])); return { a, e: f - a, f, E, Wr, Sj }; });
  const N = up(J_('Neck1')), Hd = up(J_('Head')), He = up(J_('Head_end'));
  const Hc = [(Hd[0] + He[0]) / 2 + 0.6, (Hd[1] + He[1]) / 2 - 0.4];
  // drive: the upper body pitched forward about the hips (the take is a stroll; the driver leans into it)
  const fw = (o.drive ?? 7) * D2R, R_ = (q) => add(P, rot([q[0] - P[0], q[1] - P[1]], -fw));
  for (const a of arms) { a.Sj = R_(a.Sj); a.E = R_(a.E); a.Wr = R_(a.Wr); a.a -= fw; a.f -= fw; }
  const S2 = R_(S), N2 = R_(N), Hc2 = R_(Hc), lean2 = lean + fw;
  return { P, S: S2, Sj: arms[0].Sj, N: N2, Hc: Hc2, lean: lean2, legs, arms, SPN, headRot: -lean2 * 0.45 + (o.look ?? 0) * D2R };
}

// hard hat + head + collar in profile (local units about the head centre, x forward, y up)
const HEAD = [[-5.1, 1.4], [-5.2, -0.8], [-4.7, -3.0], [-3.4, -5.2], [-3.0, -8.4], [1.9, -8.6], [1.6, -6.6], [3.2, -6.1], [4.5, -5.7],
  [4.9, -4.5], [4.6, -4.0], [5.0, -3.4], [4.7, -2.8], [5.0, -2.5], [6.3, -1.9], [5.0, 0.1], [4.6, 0.5], [4.9, 1.3], [4.4, 2.6]];
const DOME = (() => { const o = []; for (let i = 0; i <= 16; i++) { const a = Math.PI * i / 16; o.push([0.3 + 6.3 * Math.cos(a), 1.9 + 5.4 * Math.sin(a)]); } return o; })();
const BRIM = [[5.4, 2.2], [9.6, 1.25], [9.9, 0.55], [5.6, 1.05], [-6.0, 1.15], [-6.9, 1.6], [-6.5, 2.2]];

// boot in profile about the ankle (units, x forward, y up), flat
const BOOT = [[-3.4, 5.2], [3.0, 5.2], [3.6, 5.9], [4.3, 5.2], [4.4, 1.4], [7.8, -1.2], [10.4, -2.4], [11.8, -3.9], [12.0, -5.6],
  [-4.1, -5.6], [-4.4, -4.1], [-4.2, -1.0], [-3.8, 2.4]];

// Draw one worker. o: ox, oy (screen px of figure origin), s (px per unit), fr (fringe px), ghost (0..1 lighter), detail, gear, off (fringe push)
function worker(c, J, o) {
  const { ox, oy, s } = o, fr = o.fr ?? 5, det = o.detail ?? 1, wk = o.warp ?? (det > 0.3 ? 0.22 : 0);
  const X = (p) => [ox + p[0] * s * (1 + wk * (0.5 - p[1] / 100)), oy - p[1] * s];
  const back = [], body = [], front = [];
  const partsOf = (leg, arm) => {
    const K = X(leg.K), A = X(leg.A), P = X(J.P);
    const hipP = X(add(J.P, rot([0.6, 0.8], 0)));
    const thigh = limb(hipP, K, 12.6 * s, 8.6 * s, 1.1 * s, 0.5 * s);
    const shin = limb(K, A, 8.3 * s, 7.4 * s, 0.3 * s, 1.5 * s);
    const bootPts = BOOT.map(p => X(add(leg.A, rot(p, leg.fp))));
    const boot = smoothClosedSharp(bootPts);
    const E = X(arm.E), Wr = X(arm.Wr), Sj = X(J.Sj);
    const ua = limb(Sj, E, 7.4 * s, 6.1 * s, 0.6 * s, 0.9 * s);
    const fa = limb(E, Wr, 6.2 * s, 5.8 * s, 0.5 * s, 0.4 * s);
    const hd = add(arm.Wr, [Math.sin(arm.f) * 2.6, -Math.cos(arm.f) * 2.6]);
    const gd = [Math.sin(arm.f), -Math.cos(arm.f)], gn = [gd[1], -gd[0]], GL = (a, b) => X(add(arm.Wr, [gd[0] * a + gn[0] * b, gd[1] * a + gn[1] * b]));
    const glove = smoothClosed([GL(-0.6, 2.9), GL(1.2, 3.3), GL(3.4, 3.4), GL(5.4, 2.6), GL(6.2, 0.6), GL(5.8, -1.6), GL(4.6, -2.9), GL(3.0, -3.6), GL(1.6, -3.9), GL(0.4, -2.6), GL(-0.6, -2.7)]);
    return { leg: [thigh, shin, boot], arm: [ua, fa, glove], K, A, E, Wr, P, Sj, bootPts, hd: X(hd), hipP };
  };
  const near = partsOf(J.legs[0], J.arms[0]), far = partsOf(J.legs[1], J.arms[1]);
  // torso (jacket) in the spine frame
  const u = [Math.sin(J.lean), Math.cos(J.lean)], fv = [Math.cos(J.lean), -Math.sin(J.lean)];
  const SP = (t, a) => X([J.P[0] + u[0] * t * J.SPN + fv[0] * a, J.P[1] + u[1] * t * J.SPN + fv[1] * a]);
  const jacket = smoothClosed([SP(-0.18, 8.0), SP(0.1, 7.4), SP(0.45, 8.4), SP(0.76, 8.7), SP(0.96, 6.6), SP(1.07, 3.4), SP(1.09, -3.6),
    SP(0.99, -6.6), SP(0.8, -8.0), SP(0.45, -7.2), SP(0.1, -7.7), SP(-0.18, -8.4)]);
  const hc = J.Hc, hr = J.headRot, HX = (p) => X(add(hc, rot(p, hr)));
  const head = smoothClosed(HEAD.map(HX));
  const dome = poly(DOME.map(HX)), brim = smoothClosedSharp(BRIM.map(HX));
  const collar = smoothClosed([SP(0.93, 5.8), SP(1.14, 4.6), SP(1.2, -1.0), SP(1.13, -5.2), SP(0.95, -6.2)]);
  const backPaths = [...far.leg, ...far.arm], bodyPaths = [jacket, head, dome, brim, collar], frontPaths = [...near.leg, ...near.arm];
  const all = [...backPaths, ...bodyPaths, ...frontPaths];
  c.save();
  if (o.alpha != null) c.globalAlpha = o.alpha;
  const belt = det > 0.3 ? toolBelt(J, X, s) : null;
  if (belt) all.push(...belt.paths);
  fringe(c, all, fr, o.off || [0, 0]);
  const farInk = o.ghost ? `rgba(11,11,11,${1 - o.ghost})` : '#262626';
  inkFill(c, backPaths, farInk);
  if (det > 0.3) { engraveParts(c, far, s, 0.35); }
  const gap = Math.max(1.6, 0.7 * s);
  const cutOver = (paths, under) => { c.save(); c.clip(union(under)); c.strokeStyle = PAPER; c.lineWidth = gap * 2; c.lineJoin = 'round'; for (const p of paths) c.stroke(p); c.restore(); };
  cutOver([jacket, collar], backPaths);
  inkFill(c, [jacket, collar, head]);
  inkFill(c, [dome, brim]);
  if (det > 0.3) {
    // jacket: two reflective bands, zip line, chest pocket flap, rim light with rebar ribs along the back edge
    // engraved modelling across the back of the jacket (burin lines following the form, swelling toward the light)
    c.strokeStyle = 'rgba(247,247,242,0.7)';
    for (let t = 0.02; t < 0.98; t += 0.055) { c.lineWidth = Math.max(1, (0.1 + 0.16 * Math.sin(t * Math.PI)) * s);
      c.beginPath(); c.moveTo(...SP(t, -8.6)); c.quadraticCurveTo(...SP(t + 0.03, -6.2), ...SP(t + 0.01, -3.6 + 1.2 * Math.sin(t * 5))); c.stroke(); }
    c.strokeStyle = PAPER; c.lineWidth = Math.max(1.2, 0.3 * s);
    c.beginPath(); c.moveTo(...SP(1.02, 5.8)); c.bezierCurveTo(...SP(0.7, 7.9), ...SP(0.3, 7.2), ...SP(-0.18, 7.6)); c.stroke();
    c.beginPath(); c.moveTo(...SP(0.8, 1.0)); c.lineTo(...SP(0.8, 6.8)); c.lineTo(...SP(0.72, 6.9)); c.lineTo(...SP(0.72, 1.2)); c.closePath(); c.stroke();
    c.beginPath(); c.moveTo(...SP(0.93, -6.5)); c.quadraticCurveTo(...SP(0.6, -8.6), ...SP(0.2, -7.2)); c.stroke();          // back yoke seam
    c.beginPath(); c.moveTo(...SP(-0.05, -9)); c.lineTo(...SP(-0.05, 9)); c.stroke();                                                  // hem welt
    for (const t of [0.5, 0.64]) { c.beginPath(); c.moveTo(...SP(t, -2)); c.quadraticCurveTo(...SP(t + 0.03, 1.5), ...SP(t - 0.02, 4.5)); c.stroke(); }   // pull creases
    rim(c, jacket, s, [0.9 * s, 0.15 * s]);
    c.restore();
    // hard hat: ridge, brim gap, the gear badge
    c.save(); c.clip(dome);
    c.strokeStyle = PAPER; c.lineWidth = Math.max(1.4, 0.45 * s);
    c.beginPath(); const rp = DOME.slice(3, 14).map(p => HX([p[0] * 0.86 + 0.05, (p[1] - 1.9) * 0.86 + 1.9 + 0.2])); c.moveTo(...rp[0]); for (const p of rp) c.lineTo(...p); c.stroke();
    c.restore();
    c.save(); c.strokeStyle = PAPER; c.lineWidth = Math.max(1.2, 0.3 * s); c.beginPath(); c.moveTo(...HX([-6.2, 1.55])); c.lineTo(...HX([5.5, 1.55])); c.stroke(); c.restore();
    if (o.gear !== false) badge(c, HX([0.4, 4.2]), 2.5 * s, hr);
    // face: rim light along the profile
    c.save(); c.clip(head); c.strokeStyle = 'rgba(247,247,242,0.9)'; c.lineWidth = Math.max(1.2, 0.5 * s); c.translate(-0.5 * s * Math.cos(hr), 0);
    c.beginPath(); const fp = HEAD.slice(8, 19).map(HX); c.moveTo(...fp[0]); for (const p of fp) c.lineTo(...p); c.stroke(); c.restore();
  }
  if (belt) { cutOver(belt.paths, [jacket, ...backPaths]); inkFill(c, belt.paths); c.save(); c.strokeStyle = PAPER; c.lineWidth = Math.max(1, 0.25 * s); c.stroke(belt.detail); c.restore(); }
  cutOver(frontPaths, [...backPaths, jacket, collar, head, ...(belt ? belt.paths : [])]);
  inkFill(c, frontPaths);
  if (det > 0.3) creases(c, near, s);
  if (det > 0.3) { engraveParts(c, near, s, 0.7); bootDetail(c, near, J.legs[0], X, s); gloveDetail(c, near, J.arms[0], X, s);
    c.save(); c.clip(near.leg[0]); rim(c, near.leg[0], s, [0.8 * s, 0]); c.restore();
    c.save(); c.clip(near.leg[1]); rim(c, near.leg[1], s, [0.8 * s, 0]); c.restore();
    c.save(); c.clip(near.arm[0]); rim(c, near.arm[0], s, [0.7 * s, 0.3 * s]); c.restore(); }
  c.restore();
  return { near, far, X };
}
function smoothClosedSharp(pts) { return poly(pts); }
function tape(c, P, s, col) {
  const band = (path, a, b, t, w) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = uy, ny = -ux;
    const m = [a[0] + dx * t, a[1] + dy * t], h = w / 2, big = 40 * s;
    c.save(); c.clip(path); c.fillStyle = col;
    c.fill(poly([[m[0] - ux * h - nx * big, m[1] - uy * h - ny * big], [m[0] + ux * h - nx * big, m[1] + uy * h - ny * big], [m[0] + ux * h + nx * big, m[1] + uy * h + ny * big], [m[0] - ux * h + nx * big, m[1] - uy * h + ny * big]]));
    c.restore();
  };
  band(P.leg[1], P.K, P.A, 0.34, 1.7 * s);
  band(P.arm[0], P.Sj, P.E, 0.72, 1.5 * s);
  // cargo pocket on the thigh
  c.save(); c.clip(P.leg[0]); c.strokeStyle = col; c.lineWidth = Math.max(1, 0.28 * s);
  const a = mix2(P.hipP, P.K, 0.42), b = mix2(P.hipP, P.K, 0.78);
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = dy / L, ny = -dx / L;
  c.stroke(poly([[a[0] - nx * 3.2 * s, a[1] - ny * 3.2 * s], [a[0] + nx * 1.4 * s, a[1] + ny * 1.4 * s], [b[0] + nx * 1.4 * s, b[1] + ny * 1.4 * s], [b[0] - nx * 3.2 * s, b[1] - ny * 3.2 * s]]));
  c.restore();
}

// engraved modelling on the limbs: cross-contour burin lines on the lit (front) half, swelling toward the edge,
// instead of the taped bands that read as a paper doll (critic cR1)
function engraveParts(c, P, s, k) {
  if (s < 2) return;
  const lim = (path, a, b, w) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = uy, ny = -ux;
    c.save(); c.clip(path); c.strokeStyle = `rgba(247,247,242,${0.55 * k})`;
    for (let t = 0.6 * s; t < L; t += 0.85 * s) {
      const m = [a[0] + ux * t, a[1] + uy * t], sw = Math.sin(Math.PI * t / L);
      c.lineWidth = Math.max(0.9, (0.08 + 0.14 * sw) * s);
      c.beginPath(); c.moveTo(m[0] + nx * w * 0.5, m[1] + ny * w * 0.5);
      c.quadraticCurveTo(m[0] + nx * w * 0.25 + ux * 0.6 * s, m[1] + ny * w * 0.25 + uy * 0.6 * s, m[0] + nx * w * (0.05 - 0.1 * sw), m[1] + ny * w * (0.05 - 0.1 * sw)); c.stroke();
    }
    c.restore();
  };
  lim(P.leg[0], P.hipP, P.K, 12 * s); lim(P.leg[1], P.K, P.A, 8 * s); lim(P.arm[0], P.Sj, P.E, 7 * s); lim(P.arm[1], P.E, P.Wr, 6 * s);
}
// the tool belt: webbing, a framing hammer hanging head-down from its loop, a tape on the hip
function toolBelt(J, X, s) {
  const u = [Math.sin(J.lean), Math.cos(J.lean)], fv = [Math.cos(J.lean), -Math.sin(J.lean)];
  const SPt = (t, a) => [J.P[0] + u[0] * t * J.SPN + fv[0] * a, J.P[1] + u[1] * t * J.SPN + fv[1] * a];
  const beltP = poly([SPt(0.02, -8.6), SPt(0.02, 8.4), SPt(-0.07, 8.3), SPt(-0.07, -8.5)].map(X));
  const sw = Math.sin(J.legs[0].q * TAU) * 0.18;                   // the hammer swings with the stride
  const hang = SPt(-0.04, -3.4), rotH = (p) => add(hang, rot(p, sw));
  const handle = poly([[-0.45, 0], [0.45, 0], [0.6, -11], [-0.6, -11]].map(p => X(rotH(p))));
  const head = poly([[-1.4, -10.4], [3.6, -10.8], [3.8, -12.2], [-1.2, -12.4], [-3.4, -12.0], [-4.6, -10.4], [-3.0, -11.1]].map(p => X(rotH(p))));
  const tapeC = X(SPt(0.02, 5.6)), tr = 2.4 * s;
  const tapeP = new Path2D(); tapeP.roundRect(tapeC[0] - tr, tapeC[1] - tr * 0.2, tr * 2, tr * 2, tr * 0.5);
  const detail = new Path2D();
  const b1 = X(SPt(-0.025, -8.6)), b2 = X(SPt(-0.025, 8.4)); detail.moveTo(...b1); detail.lineTo(...b2);
  const bk = X(SPt(-0.025, 1.2)); detail.rect(bk[0] - 1.1 * s, bk[1] - 1.1 * s, 2.2 * s, 2.2 * s);
  for (const t of [-8, -6.5, -5]) { const g = X(rotH([0, t])); detail.moveTo(g[0] - 0.5 * s, g[1]); detail.lineTo(g[0] + 0.5 * s, g[1]); }   // handle grip
  detail.arc(tapeC[0], tapeC[1] + tr * 0.8, tr * 0.45, 0, TAU);
  return { paths: [beltP, handle, head, tapeP], detail };
}
// fabric creases at the knee, elbow and seat, cut in paper white
function creases(c, P, s) {
  if (s < 3) return;
  const cr = (path, j, a, n = 3) => { c.save(); c.clip(path); c.strokeStyle = PAPER; c.lineWidth = Math.max(1.2, 0.26 * s);
    for (let i = 0; i < n; i++) { const r = (2.2 + i * 1.3) * s; c.beginPath(); c.arc(j[0], j[1] + (i - 1) * 0.9 * s, r, a - 0.35, a + 0.35); c.stroke(); } c.restore(); };
  cr(P.leg[0], P.K, Math.atan2(P.hipP[1] - P.K[1], P.hipP[0] - P.K[0]) + Math.PI, 2);
  cr(P.leg[1], P.K, Math.atan2(P.A[1] - P.K[1], P.A[0] - P.K[0]) + Math.PI, 2);
  cr(P.arm[0], P.E, Math.atan2(P.Sj[1] - P.E[1], P.Sj[0] - P.E[0]) + Math.PI, 2);
}
// rim light on the trailing edge: the path's stroke pushed inward, with rebar ribs dashed through the highlight
function rim(c, path, s, off) {
  c.save(); c.translate(off[0], off[1]);
  c.strokeStyle = 'rgba(247,247,242,0.85)'; c.lineWidth = Math.max(1.2, 0.55 * s); c.stroke(path);
  c.restore();
}
function bootDetail(c, P, leg, X, s) {
  const L = (p) => X(add(leg.A, rot(p, leg.fp)));
  const boot = P.leg[2];
  c.save(); c.clip(boot);
  c.strokeStyle = PAPER; c.lineWidth = Math.max(1.2, 0.34 * s);
  c.beginPath(); c.moveTo(...L([-4.6, -4.0])); c.lineTo(...L([11.2, -4.0])); c.stroke();                       // midsole line
  c.beginPath(); c.moveTo(...L([8.0, -4.0])); c.quadraticCurveTo(...L([8.4, -1.4]), ...L([11.0, -2.6])); c.stroke();   // toe cap
  c.beginPath(); c.moveTo(...L([-3.3, 3.8])); c.lineTo(...L([3.5, 3.8])); c.stroke();                           // collar
  if (s > 1.6) {
    for (let i = 0; i < 5; i++) {                                                                              // laces
      const q = L([3.9 + i * 0.95, 3.2 - i * 1.05]), r = 0.75 * s;
      c.beginPath(); c.moveTo(q[0] - r, q[1] - r * 0.6); c.lineTo(q[0] + r, q[1] + r * 0.6); c.moveTo(q[0] - r, q[1] + r * 0.6); c.lineTo(q[0] + r, q[1] - r * 0.6); c.stroke();
    }
    c.setLineDash([0.4 * s, 0.4 * s]); c.lineWidth = Math.max(1, 0.2 * s);                                    // welt stitching
    c.beginPath(); c.moveTo(...L([-4.0, -3.4])); c.lineTo(...L([10.8, -3.4])); c.stroke(); c.setLineDash([]);
  }
  c.restore();
  // lugged sole: notches cut out of the bottom edge
  c.save(); c.fillStyle = PAPER;
  for (let x = -3.7; x < 11.2; x += 1.6) { c.fill(poly([L([x, -6.5]), L([x + 0.55, -6.5]), L([x + 0.55, -5.05]), L([x, -5.05])])); }
  c.restore();
  c.save(); c.fillStyle = INK;
  for (let x = -3.1; x < 11.4; x += 1.6) c.fill(poly([L([x, -5.6]), L([x + 1.05, -5.6]), L([x + 0.95, -6.45]), L([x + 0.1, -6.45])]));
  c.restore();
}
function gloveDetail(c, P, arm, X, s) {
  if (s < 1.6) return;
  const g = P.arm[2], dir = [Math.sin(arm.f), -Math.cos(arm.f)], nn = [dir[1], -dir[0]];
  const G = (a, b) => X(add(arm.Wr, [dir[0] * a + nn[0] * b, dir[1] * a + nn[1] * b]));
  c.save(); c.clip(g); c.strokeStyle = PAPER; c.lineWidth = Math.max(1.2, 0.32 * s);
  for (const f of [1.9, 3.3, 4.6]) { c.beginPath(); c.moveTo(...G(f, 3.2)); c.quadraticCurveTo(...G(f + 0.5, 0.8), ...G(f + 0.3, -1.4)); c.stroke(); }   // finger splits
  c.beginPath(); c.moveTo(...G(1.0, -2.8)); c.quadraticCurveTo(...G(3.2, -2.2), ...G(4.6, -0.6)); c.stroke();                                               // the thumb over the fist
  c.restore();
  c.save(); c.clip(g); c.strokeStyle = PAPER; c.lineWidth = Math.max(1.2, 0.3 * s);
  const cuff = X(add(arm.Wr, [dir[0] * 0.5, dir[1] * 0.5])), n = [dir[1], -dir[0]];
  c.beginPath(); c.moveTo(cuff[0] - n[0] * 4 * s, cuff[1] + n[1] * 4 * s); c.lineTo(cuff[0] + n[0] * 4 * s, cuff[1] - n[1] * 4 * s); c.stroke();
  for (let i = 0; i < 3; i++) { const k = X(add(arm.Wr, [dir[0] * (1.6 + i * 0.7), dir[1] * (1.6 + i * 0.7)]));
    c.beginPath(); c.arc(k[0], k[1], 2.2 * s, -0.3 + arm.f, 1.1 + arm.f); c.stroke(); }
  c.restore();
}
function badge(c, p, r, a) {                          // the ACP gear on the hard hat: white disc, the mark pressed in ink
  c.save(); c.translate(p[0], p[1]); c.rotate(-a);
  c.fillStyle = PAPER; c.beginPath();
  for (let i = 0; i < 24; i++) { const ang = i / 24 * TAU, rr = i % 2 ? r : r * 1.14; c.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr); }
  c.closePath(); c.fill();
  const m = tinted(BRAND.acp_mark, INK), k = r * 1.5;
  c.drawImage(m, -k / 2, -k / 2, k, k);
  c.restore();
}
// place a pose so that a named point lands at (tx, ty)
function place(J, key, s, tx, ty) {
  const p = key === 'boot' ? add(J.legs[0].A, [3, -3]) : key === 'knee' ? J.legs[0].K : key === 'hand' ? J.arms[0].Wr : key === 'head' ? J.Hc : key === 'hip' ? J.P : [0, 0];
  return { ox: tx - p[0] * s, oy: ty + p[1] * s };
}

// (the v2 ladder-limbed ally with a globe head is retired: the ally is WD.colossus, a rebar colossus)

const CAGE = (() => {
  const A = 3.2, Bh = 5.4, PER = 24, bay = 2, d = [], pd = [], r = rng(5);
  const push = (arr, x0, y0, z0, x1, y1, z1, w, kind, seed, rev, tone, grow) => arr.push(x0, y0, z0, w, x1, y1, z1, kind, seed, rev, tone, grow);
  const perim = [];
  for (let x = -A; x <= A + 1e-6; x += 1.6) { perim.push([x, -Bh]); perim.push([x, Bh]); }
  for (let y = -Bh + 1.35; y < Bh - 0.3; y += 1.35) { perim.push([-A, y]); perim.push([A, y]); }
  for (let z = 0; z < PER - 1e-6; z += bay) for (const [x, y] of perim) {
    push(d, x, y, z, x, y, z + bay, 0.085, 0, r(), -99, r() * 0.12, 1);
    if (r() < 0.35) push(pd, x, y, z, x, y, z + bay, 0.2, 2, r(), -99, 0, 0);
  }
  for (let k = 0; k < PER / 0.75; k++) {
    const z = k * 0.75, rev = k % 2 ? 10 : -99, w = 0.06, t = 0.05;
    push(d, -A, -Bh, z, A, -Bh, z, w, 0, r(), rev, t, 0); push(d, -A, Bh, z, A, Bh, z, w, 0, r(), rev, t, 0);
    push(d, -A, -Bh, z, -A, Bh, z, w, 0, r(), rev, t, 0); push(d, A, -Bh, z, A, Bh, z, w, 0, r(), rev, t, 0);
    if (k % 2 === 0) for (const [x, y] of perim) { const s = 0.1;
      push(d, x - s, y - s, z - 0.03, x + s, y + s, z + 0.03, 0.022, 1, r(), rev, 0, 0); push(d, x - s, y + s, z + 0.03, x + s, y - s, z - 0.03, 0.022, 1, r(), rev, 0, 0); }
  }
  for (let z = 0; z < PER - 1e-6; z += bay) {                     // braces and cross-ties that SMARTER adds
    push(d, -A, -Bh, z, -A, Bh, z + bay, 0.05, 0, r(), 10.5, 0.25, 1); push(d, A, Bh, z, A, -Bh, z + bay, 0.05, 0, r(), 10.5, 0.25, 1);
    push(d, -A, Bh, z + bay * 0.5, A, -Bh, z + bay * 0.5, 0.045, 0, r(), 11, 0.35, 0); push(d, -A, -Bh, z, A, -Bh, z + bay, 0.05, 3, r(), 11, 0, 1);
  }
  return { seg: sk.segments(new Float32Array(d), d.length / 12), pulse: sk.segments(new Float32Array(pd), pd.length / 12), PER };
})();
const FIELD = sk.field(6000, { seed: 11, R: 16, L: 120, w: 0.085, clear: 1.6 });
const FLOW = sk.flow(6000, { seed: 12, w: 0.32 });

// ------------------------------------------------------------------ GL passes
function forward(beat, o = {}) {
  const p = pitch(beat), S = travel(beat), v = speedAt(beat);
  const fov = o.fov ?? (50 + 60 * p), f = focal(fov);
  sk.drawField(FIELD, { uF: f, uS: S, uShut: Math.min((o.shut ?? 1) * v * 0.045 * (1 + 1.5 * p), 16), uRoll: o.roll ?? Math.sin(beat * 0.37) * 0.05,
    uVP: o.vp ?? [W / 2, H * 0.5], uGain: o.gain ?? 1, uFr: o.fr ?? 5, uFog: 0.28 }, o.count);
}
function flow(beat, o = {}) {
  const S = travel(beat) * (o.k ?? 9), v = speedAt(beat);
  sk.drawField(FLOW, { uMode: 1, uS: S, uShut: (o.shut ?? 1) * v * (o.k ?? 9) * 0.06, uAng: o.ang ?? Math.PI, uVP: o.vp ?? [W / 2, H / 2],
    uWake: o.wake ?? 0, uWakeDir: o.wakeDir ?? 0, uGain: o.gain ?? 1, uFr: o.fr ?? 4 }, o.count);
}
function cage(beat, o = {}) {
  const p = pitch(beat), f = focal(o.fov ?? (58 + 45 * p));
  sk.drawSegs(CAGE.seg, { uF: f, uS: o.S ?? travel(beat) * 0.1, uPer: CAGE.PER, uBeat: beat, uFront: o.front ?? 1e9,
    uCam: o.cam ?? [Math.sin(beat * 0.9) * 0.25, Math.cos(beat * 0.7) * 0.3, 0], uRot: camRot(o.yaw ?? 0, o.pitch ?? 0, o.roll ?? 0),
    uFogN: o.fogN ?? 5, uFogF: o.fogF ?? 15, uGain: o.gain ?? 1 });
  if (o.pulse) sk.drawSegs(CAGE.pulse, { uF: f, uS: o.S ?? travel(beat) * 0.1, uPer: CAGE.PER, uBeat: beat * 1.5, uCam: o.cam ?? [Math.sin(beat * 0.9) * 0.25, Math.cos(beat * 0.7) * 0.3, 0],
    uRot: camRot(o.yaw ?? 0, o.pitch ?? 0, o.roll ?? 0), uFogN: 5, uFogF: 15, uFr: 5, uGain: o.pulse });
}
function blitGL() { ctx.drawImage(sk.canvas, 0, 0); }

// ------------------------------------------------------------------ 2D world pieces
// the four lanes: from a perspective fan (lock 0) to the locked four stripes (lock 1) beside the gear: the ACP logo
function lanes(c, beat, lock, o = {}) {
  const cy = o.cy ?? 1250, vp = o.vp ?? [960, cy], S = travel(beat);
  for (let k = -1.5; k <= 1.5; k++) {                   // four lanes: the ACP logo's four stripes, never three
    const hh = 27, y = cy + k * 80;
    const L0 = [[560, y - hh], [1150, y - hh], [1150, y + hh], [560, y + hh]];                                   // locked bar
    const nearY = cy + k * 520, nh = 180;
    const F0 = [[-260, nearY - nh], [vp[0], vp[1] + k * 5 - 2], [vp[0], vp[1] + k * 5 + 2], [-260, nearY + nh]]; // fan lane
    const u = ease.inOutCubic(lock), q = F0.map((p, i) => mix2(p, L0[i], u));
    const path = poly(q);
    c.save(); fringe(c, [path], 6, [-8 * (1 - u) - 3, 0]); c.fillStyle = INK; c.fill(path);
    // speed dashes running at the lens along each lane
    c.clip(path); c.strokeStyle = 'rgba(247,247,242,0.9)';
    const n = 9;
    for (let i = 0; i < n; i++) {
      const ph = ((i / n + S * 0.012 * (1 + k * 0.1)) % 1), t0 = 1 - ph, t1 = clamp(t0 + 0.05 * (0.3 + t0));
      const a = mix2(mix2(q[0], q[3], 0.5), mix2(q[1], q[2], 0.5), Math.pow(t0, 1.6)), b = mix2(mix2(q[0], q[3], 0.5), mix2(q[1], q[2], 0.5), Math.pow(t1, 1.6));
      c.lineWidth = Math.max(2.5, lerp(nh * 0.12, hh * 0.24, u) * (1 - t0 * 0.8)); c.beginPath(); c.moveTo(...a); c.lineTo(...b); c.stroke();
    }
    c.restore();
  }
}
// the worker's head and shoulder from behind-left, big in the foreground: the gear badge beside the four stripes
function bust(c, x, y, s, beat) {
  const J = pose(0.3 + Math.sin(beat * 0.8) * 0.02, { amp: 0.25, lean: 6, look: -6 });
  const pl = place(J, 'head', s, x, y);
  worker(c, J, { ...pl, s, fr: 7, off: [-6, 0] });
}
function scaffold(c, x0, x1, gy, floorH, floors, o = {}) {
  const bw = o.bay ?? 150, tone = o.tone ?? INK, n = Math.ceil(floors), cols = [];
  for (let x = x0; x <= x1 + 1; x += bw) cols.push(x);
  const tubes = new Path2D(), braces = new Path2D(), planks = [], couplers = [], ladders = new Path2D();
  for (let f = 0; f < n; f++) {
    const g = clamp(floors - f), y0 = gy - f * floorH, y1 = y0 - floorH * ease.outCubic(clamp(g * 1.6));
    for (const x of cols) { tubes.moveTo(x, y0); tubes.lineTo(x, y1); }
    if (g > 0.6) {
      tubes.moveTo(x0 - 20, y0 - floorH); tubes.lineTo(lerp(x0 - 20, x1 + 20, ease.outCubic((g - 0.6) / 0.4)), y0 - floorH);
      tubes.moveTo(x0 - 20, y0 - floorH * 0.5); tubes.lineTo(lerp(x0 - 20, x1 + 20, ease.outCubic((g - 0.6) / 0.4)), y0 - floorH * 0.5);
      for (let i = 0; i < cols.length - 1; i++) {
        if ((i + f) % 2 === 0) { braces.moveTo(cols[i], y0); braces.lineTo(cols[i + 1], y0 - floorH); }
        planks.push([cols[i] + 4, y0 - floorH - 10, bw - 8, 10]);
        couplers.push([cols[i], y0 - floorH], [cols[i], y0 - floorH * 0.5]);
      }
      const lx = cols[(f % Math.max(1, cols.length - 1))] + bw * 0.35;
      ladders.moveTo(lx, y0); ladders.lineTo(lx, y0 - floorH); ladders.moveTo(lx + 26, y0); ladders.lineTo(lx + 26, y0 - floorH);
      for (let k = 12; k < floorH; k += 22) { ladders.moveTo(lx, y0 - k); ladders.lineTo(lx + 26, y0 - k); }
    }
  }
  c.save(); c.globalAlpha = o.alpha ?? 1;
  prismStroke(c, tubes, o.w ?? 7, o.fr ?? 3, tone);
  c.strokeStyle = tone; c.lineWidth = (o.w ?? 7) * 0.6; c.stroke(braces);
  c.lineWidth = 3; c.stroke(ladders);
  c.fillStyle = tone; for (const p of planks) c.fillRect(...p);
  c.fillStyle = PAPER; for (const p of planks) c.fillRect(p[0] + 6, p[1] + 4, p[2] - 12, 2);
  c.fillStyle = tone; for (const [x, y] of couplers) c.fillRect(x - 8, y - 6, 16, 12);
  c.restore();
  return { cols };
}
function stride(beat, age, o, gyIn) {
  const pause = o.pause ? 1 : 0;
  const ph = pause ? (23 * 0.5 + 0.08) : beat * 0.5;
  const J = mocap(ph, { lean: pause ? -4 : 3, drive: pause ? 0 : 7 });
  let s, pl, gy = gyIn ?? 1850;
  if (o.sig) { s = 11.2; gy = 1880; pl = place(J, 'hip', s, lerp(430, 600, age / 2), gy - J.P[1] * s); pl.oy = gy; }
  else if (o.mid) { s = 22; pl = place(J, 'knee', s, 520, 1420); gy = pl.oy; }
  else { s = 12.5; pl = place(J, 'hip', s, lerp(520, 640, age / 2), 0); pl.oy = gy; }
  sk.begin();
  flow(beat, { vp: [pl.ox, gy - 260], k: pause ? 0.2 : 8, shut: pause ? 0.05 : 1, wake: 1, wakeDir: 0, count: 2600, gain: 0.55 });
  blitGL();
  WD.horizon(ctx, gy - 17 * s, { scroll: pause ? 0 : travel(beat) * 3, haze: 0.55 });
  if (o.ally) {                                              // the ally: the same take a quarter phase behind, built of rebar
    const J2 = mocap(pause ? ph : ph - 0.25, { lean: pause ? -4 : 3, drive: pause ? 0 : 7 }), s2 = s * 0.9;
    const grow = o.ally === 1 ? ease.outCubic(clamp(age / 0.8)) : 1;
    const ox = pl.ox + 290 * (s / 12.5), oy = gy - 10;
    WD.colossus(ctx, J2, (p) => [ox + p[0] * s2, oy - p[1] * s2], { s: s2, grow, fr: 4, alpha: 0.97 });
  }
  worker(ctx, J, { ...pl, s, fr: 6, off: pause ? [0, 0] : [-10, 0] });
  return { J, s, pl, gy };
}

let lastMs = 0;

// ------------------------------------------------------------------ the governor: speed, phase, camera, plate
function spinRaw(b) {
  if (b < 40) return lerp(0.74, 1.0, smooth(0, 30, b));
  if (b < 54.5) { const u = b - 40, amp = 0.1 + 0.32 * smooth(40, 53.5, b);               // the market's governor hunts: boom and bust, wider each time
    return clamp(0.56 + amp * Math.sin(u * TAU / 4.3) + 0.06 * Math.sin(u * TAU / 1.7), 0.06, 1); }
  if (b < 58) return lerp(0.5, 0.02, smooth(54.5, 55.2, b));                              // the stall
  if (b < 95.5) return lerp(0.02, 0.78, smooth(58.2, 62.5, b));                           // a finger on START: it spins up and runs true, steady
  if (b < 100) return lerp(0.78, 0.17 + 0.03 * Math.sin(b * 0.9), smooth(95.5, 97.5, b)); // no theory of the political: idle, nobody at it
  if (b < 125) return 0.78;                                                               // under the class
  return lerp(0.78, 1.0, smooth(125, 128, b));
}
const GSTEP = 1 / 32, GPH = [0], GWA = [0];
for (let i = 1; i <= 220 / GSTEP; i++) { const bm = toOld((i - 0.5) * GSTEP), sp = spinRaw(bm);
  GPH.push(GPH[i - 1] + sp * 1.6 * TAU * B.spb * GSTEP); GWA.push(GWA[i - 1] + (0.15 + sp) * 0.5 * TAU * B.spb * GSTEP); }
const gtab = (T, b) => { const x = clamp(toNew(b), 0, 219.9) / GSTEP, i = Math.floor(x); return lerp(T[i], T[i + 1], x - i); };
// camera segments (hard cuts between them): [from beat, to beat, from {s px/unit, ay world y at the anchor, ax world x at the anchor, roll}, to]
const K = (s, ay, ax, roll) => ({ s, ay, ax, roll });
const GOVCAM = [
  [0, 4, K(15.5, 18, 0, 0), K(14.2, 16, 0, -0.02)],                 // the balls, huge: frame 0 and the loop
  [4, 8, K(8.8, -3, 0, 0.01), K(9.6, -4, 0, 0.0)],                 // pulled back: the whole machine
  [17.5, 21.5, K(12, -62, 20, 0.03), K(14, -62, 20, 0.05)],        // the flywheel, near, spinning up
  [21.5, 25.5, K(14, 15, 0, -0.02), K(15, 14, 0, 0.0)],            // the balls from beside
  [32, 37, K(14, 15, 0, -0.02), K(15, 14, 0, 0.0)],                // they were wrong: the balls again, the plate reads CAPITAL
  [37, 40, K(8.6, -4, 0, 0.0), K(8.9, -4, 0, 0.0)],                // wide: WITH CAPITAL.
  [40, 47.5, K(10.8, -3, 0, 0.0), K(11.6, -3, 0, -0.012)],         // Lange: the machine, side on, big (frame 0)
  [47.5, 54.5, K(13.5, 14, 0, -0.01), K(14.6, 13, 0, 0.0)],        // hunting: the balls surge and sag
  [54.5, 58, K(9.2, -4, 0, 0.0), K(9.3, -4, 0, 0.0)],              // the stall, wide, clamped
  [61, 67, K(9.0, -4, 0, 0.0), K(9.8, -4, 0, 0.0)],              // the restart: wide, the plate re-lettered, it runs true
  [67, 69.5, K(8.0, -6, 0, 0.0), K(8.4, -6, 0, 0.0)],            // the market process appears old-fashioned: the whole old machine
  [69.5, 73, K(15.0, 14, 0, -0.01), K(16.0, 13.5, 0, 0.0)],      // a computing device of the preelectronic age: the balls and the sleeve, close
  [89.5, 95.5, K(8.0, -5, 0, 0.0), K(8.6, -5, 0, 0.0)],            // the real source: the same machine, steady
  [95.5, 100, K(7.0, -10, 0, 0.0), K(7.5, -9, 0, 0.0)],            // idle, nobody at it
  [118.5, 131, K(6.9, -4, 0, 0.0), K(7.4, -4, 0, 0.0)]];           // under the class, stepping back
function govCam(b) {
  let seg = GOVCAM[0];
  for (const g of GOVCAM) if (b >= g[0]) seg = g;
  const u = ease.inOutCubic(clamp((b - seg[0]) / (seg[1] - seg[0]))), A = seg[2], Z = seg[3];
  return { s: lerp(A.s, Z.s, u), ay: lerp(A.ay, Z.ay, u), ax: lerp(A.ax, Z.ax, u), roll: lerp(A.roll, Z.roll, u) };
}
function govShot(b, t, o = {}) {
  const cam = govCam(b), spin = spinRaw(b), sy = o.sy ?? 1330;
  const s = cam.s, cy = sy + cam.ay * s, cx = 540 - cam.ax * s;
  const speed = speedAt(b);
  speedLines(gtab(GWA, b) * (o.k ?? 1) * 190, (o.sgain ?? 1) * (1 + 1.6 * (1 - smooth(0, 4, toNew(b)))));
  const clampU = 0;      // c14: no clamp icon; the machine itself seizes (the balls drop, the flywheel coasts down)
  const plate = b < 32 ? '' : b < 40 ? 'CAPITAL' : b < 61 ? 'THE MARKET' : b < 89.5 ? 'COMPUTER' : b < 93.2 ? 'CAPITAL' : b < 95.5 ? 'COMPUTER' : '';
  const struck = b >= 92.5 && b < 93.2 ? clamp((b - 92.5) / 0.35) : 0;       // AND NOT 'CAPITAL.': CAPITAL is struck on the plate, then COMPUTER is stamped in
  const plateU = b < 32 ? 1 : b < 40 ? clamp((b - 32) / 0.7) : b < 61 ? clamp((b - 40) / 0.7) : b < 93.2 ? clamp((b - 61) / 0.7) : clamp((b - 93.2) / 0.7);
  const over = b < 40 ? smooth(17.5, 38, b) : 0, jit = [Math.sin(t * 97) * 3 * over, Math.cos(t * 83) * 3 * over];
  ctx.save(); ctx.translate(540 + jit[0], 960 + jit[1]); ctx.rotate(cam.roll); ctx.translate(-540, -960);
  const aG = o.alphaG ?? 1;
  if (aG < 0.99) {                       // fading the governor: draw it alone, then lay it back at that alpha (it sets its own alpha inside)
    const g2 = gcv.getContext('2d'); g2.clearRect(0, 0, W, H);
    WD.governor(g2, { x: cx, y: cy, s, ph: gtab(GPH, b), wa: gtab(GWA, b), spin, t, clamp: clampU, plate, plateU, struck, noWheel: o.noWheel });
    ctx.globalAlpha = aG; ctx.drawImage(gcv, 0, 0);
  } else WD.governor(ctx, { x: cx, y: cy, s, ph: gtab(GPH, b), wa: gtab(GWA, b), spin, t, clamp: clampU, plate, plateU, struck, noWheel: o.noWheel });
  ctx.globalAlpha = 1;
  ctx.restore();
  return { cx, cy, s, spin };
}
// speed as long thin ink lines streaming left (not dust): offsets follow the flywheel's own angle, so they stop when it stops
const SL = (() => { const r = rng(77), a = []; for (let i = 0; i < 80; i++) a.push({ y: r() * H, len: 160 + r() * 760, w: 1.2 + r() * r() * 5, a: 0.07 + r() * 0.3, sp: 0.55 + r() * 0.9, x0: r() * 3000 }); return a; })();
function speedLines(off, gain) {
  if (gain <= 0.01) return;
  ctx.save(); ctx.lineCap = 'round';
  for (const l of SL) {
    const span = W + l.len + 200, x = W + 60 - ((off * l.sp + l.x0) % span);
    const g = ctx.createLinearGradient(x, 0, x + l.len, 0); g.addColorStop(0, `rgba(11,11,11,${l.a * gain})`); g.addColorStop(1, 'rgba(11,11,11,0)');
    ctx.strokeStyle = g; ctx.lineWidth = l.w; ctx.beginPath(); ctx.moveTo(x, l.y); ctx.lineTo(x + l.len, l.y); ctx.stroke();
  }
  ctx.restore();
}
const gcv = document.createElement('canvas'); gcv.width = W; gcv.height = H;

// ------------------------------------------------------------------ text
const bcache = new Map();
function blk(font, lines, o) {
  const key = JSON.stringify([font === SPARTAN ? 's' : 'p', lines, o]);
  if (!bcache.has(key)) bcache.set(key, setBlock(font, lines, o));
  return bcache.get(key);
}
function bpath(bk, sc = 1, rot0 = 0, dx = 0, dy = 0) {
  const cx = (bk.bbox.x1 + bk.bbox.x2) / 2, cy = (bk.bbox.y1 + bk.bbox.y2) / 2, p = new Path2D();
  const M = new DOMMatrix().translate(cx + dx, cy + dy).rotate(rot0 * 180 / Math.PI).scale(sc, sc).translate(-cx, -cy);
  for (const g of bk.glyphs) p.addPath(g.path, M.translate(g.ox, g.oy));
  return p;
}
function mono(c, text, x, y, o = {}) {      // a short caption in mono caps, ink on a paper keyline (or paper on ink)
  c.save(); c.font = `400 ${o.size ?? 30}px "Plex Mono"`; c.textAlign = o.align ?? 'center'; c.lineJoin = 'round';
  if (o.keyline !== false) { c.strokeStyle = o.paper ?? PAPER; c.lineWidth = 9; c.strokeText(text, x, y); }
  c.fillStyle = o.color ?? INK; c.fillText(text, x, y); c.restore();
}
// c14: ONE type voice for every quotation (Marx, the chairman, Lange, the Program): Playfair caps, dark ink, on an opaque paper slip, ONE cap height, lines broken by sense
// at that height (never scaled to the width, which put the weight on the function words).  A sentence is one slip: each card adds its lines under the last, and the
// slip clears at the sentence's end.  Over paper or over film the slip sits in the same place (the upper third).  The Party's own line (CL71, `party`) is set on its slip
// in the Party's sans at CAPP (v13: at CAPQ the wider sans split A WORKING / CLASS; at 56 it keeps the card's own lines), and the Party answers again at the banner.
const CAPQ = 62, CAPP = 56, SLIP_Y = 250, SLIP_W = 940, MAXLINES = 7;
const GROUPS = [[40, 43, 45], [47.5, 51], [58, 61, 63.5], [67], [69.5], [73, 76], [0, 2.5, 5], [8], [12, 14.5], [17.5, 19.5, 21.5, 23.5], [25.5, 27.5], [29.5], [32, 34.5, 37],
  [79.5, 82], [84.5, 87], [89.5], [92.5], [95.5], [97, 98.2, 99.1], [100, 103.5], [105.5], [107.5], [111], [114], [116.5]];
const groupOf = (w) => GROUPS.find((g) => g.includes(w.b)) ?? [w.b];
// c20 (monotony: nearly every card was the same slip in the top third): within the one voice, a few sentences are set at their own scale and place.
// THEY WERE WRONG ... and AND NOT 'CAPITAL.' take the full width; the political turn sits over the idle circuit; the Party's line is set larger.
const LAYOUT = { 32: { cap: 84, w: 1040 }, 92.5: { cap: 132, w: 1040, y: 700 }, 95.5: { cap: 70, y: 620 }, 105.5: { cap: 72, w: 1000 },
  0: { cap: 70 }, 17.5: { cap: 66 } };
const layOf = (g) => ({ cap: CAPQ, w: SLIP_W, y: SLIP_Y, ...(LAYOUT[g[0]] ?? {}) });
function breakLines(text, F = PLAYFAIRB, cap = CAPQ, sw = SLIP_W) {   // one card's words re-flowed greedily at cap within the slip; a word too wide for a line breaks at its hyphen
  const W_ = sw - 80, ws = text.join(' ').split(' ').flatMap((w) => measure(F, w, cap, 0.02) > W_ && w.includes('-') ? w.split(/(?<=-)/) : [w]), out = [];
  let cur = '';
  for (const w of ws) { const t = cur ? (cur.endsWith('-') ? cur + w : cur + ' ' + w) : w; if (cur && measure(F, t, cap, 0.02) > W_) { out.push(cur); cur = w; } else cur = t; }
  if (cur) out.push(cur);
  return out;
}
const slipCache = new Map();
function slipBlock(g, upto, tag) {
  const key = g.join(',') + '|' + upto + '|' + (tag ? 1 : 0);
  if (!slipCache.has(key)) {
    let cards = WORDS.filter((w) => g.includes(w.b) && w.b <= upto && w.t);
    // a slip holds at most MAXLINES lines: when the sentence runs on past that, a fresh slip is laid and carries the rest
    let lines = [], first = [], used = [];
    // v10: a fresh slip carries the previous card's last short line(s) (up to 3 words), so the sentence never restarts on a dangling noun (…HIGHLY EFFECTIVE / SYSTEMS OF…)
    const LY = layOf(g), party = cards.some((w) => w.party), F = party ? SPARTAN : PLAYFAIRB, CQ = party ? Math.round(LY.cap * CAPP / CAPQ) : LY.cap;   // v13: the Party's own line in its sans
    for (const w of cards) { const ls = breakLines(w.t, F, CQ, LY.w);
      if (lines.length && lines.length + ls.length > MAXLINES) { const carry = []; let nw = 0;
        for (let i = lines.length - 1; i >= 0; i--) { const k = lines[i].split(' ').length; if (nw + k > 3) break; carry.unshift(lines[i]); nw += k; }
        lines = carry; first = []; used = []; }
      first.push(lines.length); lines.push(...ls); used.push(w); }
    cards = used;
    const total = lines.length * CQ + (lines.length - 1) * 0.34 * CQ, top = LY.y + (tag ? 104 : 64);
    const bk = setBlock(F, lines.map((t) => ({ text: t, cap: CQ })), { role: 'plant', cap: CQ, x: 540, y: top + total / 2, maxW: LY.w - 40, tracking: 0.02, gap: 0.34, align: 'center' });
    slipCache.set(key, { bk, lines, first, n: cards.length });
  }
  return slipCache.get(key);
}
function drawWord(c, w, age, b) {
  if (!w.t) return;
  const u = b < 0.02 ? 1 : clamp(age / 0.1);
  if (w.v === 'stack') {
    const bk = bannerBlock();
    for (let li = 0; li <= w.n; li++) {
      const uu = li === w.n ? u : 1, sc = 1 + 0.22 * Math.pow(1 - uu, 2), path = bpath2(bk, sc, (g) => g.line === li);
      c.save(); c.lineJoin = 'round'; c.strokeStyle = PAPER; c.lineWidth = 22; c.stroke(path); fringe(c, [path], 5, [-4, 3]); c.fillStyle = INK; c.fill(path); c.restore();
    }
    return;
  }
  if (w.v === 'big') {
    const bk = blk(SPARTAN, w.t, { role: 'shout', cap: w.cap ?? 330, x: 540, y: w.y ?? 1180, maxW: 940, gap: 0.12 }), sc = Math.min(1 + 0.2 * Math.pow(1 - u, 2), 1030 / (bk.bbox.x2 - bk.bbox.x1)), path = bpath(bk, sc);
    c.save(); c.lineJoin = 'round'; c.strokeStyle = PAPER; c.lineWidth = 24; c.stroke(path); fringe(c, [path], 5 + 5 * (1 - u), [-4 - 8 * (1 - u), 3]); c.fillStyle = INK; c.fill(path); c.restore();
    return;
  }
  const g = groupOf(w), hasTag = WORDS.find((x) => x.b === g[0])?.tag, S = slipBlock(g, w.b, hasTag), bk = S.bk, ci = S.n - 1;
  const LY = layOf(g), x0 = 540 - LY.w / 2, x1 = 540 + LY.w / 2, y0 = LY.y, y1 = bk.bbox.y2 + Math.max(50, LY.cap * 0.7), dr = (1 - u) * (1 - u) * 26;
  c.save(); c.translate(0, dr * (ci === 0 ? 1 : 0)); c.globalAlpha = ci === 0 ? 0.25 + 0.75 * u : 1;
  c.fillStyle = INK; c.fillRect(x0 + 12, y0 + 12, x1 - x0, y1 - y0);
  c.fillStyle = '#f1efe6'; c.fillRect(x0, y0, x1 - x0, y1 - y0);
  c.strokeStyle = INK; c.lineWidth = 4; c.strokeRect(x0, y0, x1 - x0, y1 - y0); c.lineWidth = 1.5; c.strokeRect(x0 + 9, y0 + 9, x1 - x0 - 18, y1 - y0 - 18);
  c.restore();
  // the text: earlier cards' lines in ink, the newest card's lines set in on the beat
  const first = S.first[ci];
  const ink = new Path2D(), newer = new Path2D();
  for (const gl of bk.glyphs) (gl.line >= first ? newer : ink).addPath(gl.path, new DOMMatrix().translate(gl.ox, gl.oy));
  c.save(); c.fillStyle = INK; c.fill(ink);
  c.save(); c.globalAlpha = ci === 0 ? c.globalAlpha : 0.15 + 0.85 * u; c.translate(0, ci === 0 ? dr : (1 - u) * 14); c.fill(newer); c.restore();
  if (hasTag) mono(c, hasTag, 540, LY.y + 54, { size: hasTag.length > 38 ? 22 : 26, keyline: false });
  c.restore();
}
let bannerBk = null;
const bannerBlock = () => bannerBk ??= setBlock(SPARTAN, BANNER, { role: 'payoff', justify: true, maxW: 900, x: 540, y: 1180, gap: 0.14 });
function bpath2(bk, sc, only) {
  const cx = (bk.bbox.x1 + bk.bbox.x2) / 2, cy = (bk.bbox.y1 + bk.bbox.y2) / 2, p = new Path2D(), M = new DOMMatrix().translate(cx, cy).scale(sc, sc).translate(-cx, -cy);
  for (const g of bk.glyphs) if (only(g)) p.addPath(g.path, M.translate(g.ox, g.oy)); return p;
}

// ------------------------------------------------------------------ the film: real people at the work, printed as halftone on the paper
// Master Hands (Jam Handy for Chevrolet, 1936; Prelinger, public domain) and "Machine: Master or Slave?" (1941), cut into grey atlases at assets/intelligence/c12 and c11.
// The governor stays the one drawn object; the people in the film are the ones who act on it (a finger on START, workers as the organs of the machine).
// options: clip, t0 (seconds into the clip at the cut), rate, zoom -> z1 (portrait window on the 4:3 frame), cx/cy -> cx1/cy1 (the pan), pitch (halftone screen, px), lo/hi/gamma (tone), soft (second ink), flip
const FILM_CLIPS = ['flyhi', 'table', 'faceB', 'floor', 'bigpress', 'start', 'valve', 'engine', 'chassis', 'micro', 'frameline', 'press5', 'drill', 'leverhand', 'room', 'op', 'op2', 'scope', 'scope2', 'racks', 'draft', 'pressmen', 'fist', 'build', 'grille', 'work'];
await FILM.loadClips(FILM_CLIPS);
const FS = {
  // c14: the film prints as a full-width BAND (4:3 at 1080x810, ~2.7x from the atlas cell, not a 5x portrait crop), a coarse halftone, levels set before the screen.
  organs: { clip: 'flyhi', t0: 1.0, rate: 0.9, bz: 1.0, z1: 1.1, cx: 0.55, cx1: 0.6, pitch: 11, lo: 0.05, hi: 0.8, soft: 0.2 },
  racks: { clip: 'racks', t0: 0.6, rate: 0.7, bz: 1.0, z1: 1.1, cx: 0.5, pitch: 11, lo: 0.0, hi: 0.7, gamma: 0.9, soft: 0.2 },
  linkage: { clip: 'table', t0: 1.0, rate: 0.85, bz: 1.0, z1: 1.1, cx: 0.4, cx1: 0.5, pitch: 11, lo: 0.04, hi: 0.75, soft: 0.2 },
  face: { clip: 'faceB', t0: 0.3, rate: 0.6, bz: 1.35, z1: 1.5, cx: 0.5, cy: 0.5, pitch: 11, lo: 0.05, hi: 0.85, soft: 0.2 },
  line: { clip: 'frameline', t0: 0.3, rate: 1.0, bz: 1.0, z1: 1.12, cx: 0.5, pitch: 11, lo: 0.04, hi: 0.75, soft: 0.2, ramp: 1.7 },
  // framed on the START button alone (window ~107x190 px of the 480x360 cell: START in the lower third, STOP never enters); the press lands at key beat 58, the restart's first sound
  // c20: printed as a band (3.6x from the cell, not the 9x portrait blow-up), tight on START and the thumb, hard tone; the press lands on key 58 with the relay
  start: { clip: 'start', t0: 2.55, tmax: 112 / 30, rate: 0.75, bz: 1.9, z1: 2.25, cx: 0.52, cy: 0.42, cx1: 0.5, cy1: 0.4, pitch: 8, lo: 0.1, hi: 0.66, gamma: 1.05, soft: 0.12, kickAt: 58, black: 1 },
  // Lange's planning over people planning (SAGE's drafting room, the display with its plotted tracks)
  // c20: lifted (they printed murky): a higher white point and an open gamma; the planning floor from above in place of the scope (the scope is research, later)
  plan1: { clip: 'draft', t0: 4.0, rate: 0.7, bz: 1.15, z1: 1.3, cx: 0.55, cy: 0.55, pitch: 10, lo: 0.04, hi: 0.66, gamma: 1.25, soft: 0.1 },
  plan2: { clip: 'floor', t0: 14.0, rate: 0.8, bz: 1.0, z1: 1.15, cx: 0.5, cy: 0.5, pitch: 10, lo: 0.06, hi: 0.7, gamma: 1.2, soft: 0.1 },
  // the chairman's sentence over research (On Guard! The Story of SAGE, 1956): operators, consoles, racks, the drafting room, a hand on the switch bank
  info: { clip: 'op2', t0: 1.5, rate: 0.7, bz: 1.0, z1: 1.12, cx: 0.5, cy: 0.5, pitch: 11, lo: 0.0, hi: 0.4, gamma: 0.8, soft: 0.15 },
  mil: { clip: 'room', t0: 2.0, rate: 0.8, bz: 1.0, z1: 1.1, cx: 0.5, cy: 0.5, pitch: 11, lo: 0.0, hi: 0.4, gamma: 0.8, soft: 0.15 },
  arise: { clip: 'racks', t0: 1.5, rate: 0.7, bz: 1.0, z1: 1.1, cx: 0.5, cy: 0.5, pitch: 11, lo: 0.0, hi: 0.75, gamma: 0.9, soft: 0.2 },
  rnd: { clip: 'draft', t0: 2.0, rate: 0.8, bz: 1.0, z1: 1.12, cx: 0.5, cy: 0.5, pitch: 11, lo: 0.0, hi: 0.85, gamma: 0.85, soft: 0.2 },
  hand: { clip: 'scope', t0: 88 / 15, tmax: 7.0, rate: 0.9, bz: 1.0, z1: 1.08, cx: 0.5, cy: 0.5, pitch: 11, lo: 0.0, hi: 0.5, gamma: 0.85, soft: 0.15 },
  // the political turn is real people at the work
  struggle: { clip: 'pressmen', t0: 0.6, rate: 0.7, bz: 1.0, z1: 1.12, cx: 0.5, cy: 0.5, pitch: 10, lo: 0.05, hi: 0.72, gamma: 1.15, soft: 0.12 },
  align: { clip: 'fist', t0: 76 / 30, tmax: 104 / 30, rate: 0.8, bz: 1.0, z1: 1.15, cx: 0.45, cy: 0.5, pitch: 10, lo: 0.04, hi: 0.6, gamma: 1.1, soft: 0.12 },
  gauge: { clip: 'micro', t0: 2.6, rate: 0.7, bz: 1.15, z1: 1.3, cx: 0.55, cy: 0.5, pitch: 10, lo: 0.04, hi: 0.66, gamma: 1.15, soft: 0.12 },
  master: { clip: 'faceB', t0: 2.0, rate: 0.6, bz: 1.35, z1: 1.55, cx: 0.5, cy: 0.45, pitch: 10, lo: 0.06, hi: 0.8, gamma: 1.1, soft: 0.12 },
  build: { clip: 'build', t0: 0.5, tmax: 4.2, rate: 0.55, bz: 1.0, z1: 1.1, cx: 0.5, cy: 0.5, pitch: 11, lo: 0.0, hi: 0.8, gamma: 0.85, soft: 0.2 },
  // v12: hands on the controls under the alignment sentence (the machine has no purpose but the one a hand gives it)
  lever: { clip: 'leverhand', t0: 0.4, tmax: 2.4, rate: 0.7, bz: 1.0, z1: 1.12, cx: 0.5, cy: 0.5, pitch: 10, lo: 0.04, hi: 0.7, gamma: 1.1, soft: 0.12 },
};
const BAND_Y = 900, BAND_H = 810;
const darkK = (b) => (b >= 67 && b < 107.5) || b < 40;        // v10: after the chips the page is black; v12: the Program builds on paper again
function filmShot(b, sh, bn) {
  const o = sh.o, len = sh.end - sh.b0, u = clamp((b - sh.b0) / len), sec = (bn - toNew(sh.b0)) * B.spb, e = ease.inOutCubic(u);
  const t = o.ramp ? (o.t0 ?? 0) + sec * (o.rate ?? 1) * (1 + (o.ramp - 1) * u) : (o.t0 ?? 0) + sec * (o.rate ?? 1);
  const i = FILM.frameAt(o.clip, Math.min(t, o.tmax ?? 1e9), 'hold');
  const kick = o.kickAt != null && b >= o.kickAt ? 0.08 * Math.max(0, 1 - (b - o.kickAt) / 0.6) ** 2 : 0;
  if (o.full) {
    FILM.print(ctx, o.clip, i, [0, 0, W, H], { zoom: lerp(o.zoom ?? 1, o.z1 ?? o.zoom ?? 1, e) * (1 + kick), cx: lerp(o.cx ?? 0.5, o.cx1 ?? o.cx ?? 0.5, e), cy: lerp(o.cy ?? 0.5, o.cy1 ?? o.cy ?? 0.5, e),
      pitch: o.pitch ?? 9, gain: o.gain ?? 1, lo: o.lo, hi: o.hi, gamma: o.gamma, soft: o.soft, seed: i, flip: o.flip });
    return;
  }
  if (darkK(b) || o.black) { ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H); ctx.fillStyle = PAPER; ctx.fillRect(0, BAND_Y, W, BAND_H); }
  FILM.print(ctx, o.clip, i, [0, BAND_Y, W, BAND_H], { band: true, bz: lerp(o.bz ?? 1, o.z1 ?? o.bz ?? 1, e) * (1 + kick), cx: lerp(o.cx ?? 0.5, o.cx1 ?? o.cx ?? 0.5, e), cy: lerp(o.cy ?? 0.5, o.cy1 ?? o.cy ?? 0.5, e),
    pitch: o.pitch ?? 11, gain: o.gain ?? 1, lo: o.lo, hi: o.hi, gamma: o.gamma, soft: o.soft, seed: i, flip: o.flip });
  ctx.fillStyle = INK; ctx.fillRect(0, BAND_Y - 5, W, 5); ctx.fillRect(0, BAND_Y + BAND_H, W, 5);
}
// the chip field (v4/v6's own image, drawn as flats): a page of DIP packages in outline that fill solid black in ONE sweep in under a second (the sentence made visible)
function chipsShot(b, sh, bn) {
  const sec = (bn - toNew(sh.b0)) * B.spb, cols = 4, rows = 9, X0 = 70, Y0 = 880, CW = 220, CH = 76, GX = 40, GY = 22;
  ctx.save(); ctx.lineJoin = 'miter';
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
    const x = X0 + q * (CW + GX), y = Y0 + r * (CH + GY), delay = 0.1 + 0.8 * ((q / (cols - 1)) * 0.5 + (r / (rows - 1)) * 0.5), f = clamp((sec - delay) / 0.12);
    ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.fillStyle = INK;
    for (let k = 0; k < 7; k++) { const px = x + 18 + k * ((CW - 36) / 6) - 5; ctx.fillRect(px, y - 14, 10, 14); ctx.fillRect(px, y + CH, 10, 14); }
    ctx.strokeRect(x, y, CW, CH);
    ctx.globalAlpha = f; ctx.fillRect(x, y, CW, CH); ctx.globalAlpha = 1;
    ctx.fillStyle = f > 0.5 ? PAPER : INK; ctx.beginPath(); ctx.arc(x + 14, y + 14, 5, 0, TAU); ctx.fill();
    ctx.font = '400 20px "Plex Mono"'; ctx.textAlign = 'center'; ctx.fillText('74' + ((r * cols + q) * 4).toString().padStart(2, '0'), x + CW / 2, y + CH / 2 + 7);
  }
  ctx.restore();
  POST.flood(ctx, (sec - 1.35) / 1.0);         // v10: the black runs on past the chips over the whole page: the paper world of the governor is over
}

// ------------------------------------------------------------------ v10: the world after the chips (intelligence2.post.js)
function relicShot(b, t) {
  POST.relic(ctx, clamp((b - 67) / 6), t, (c, x, y, s) => WD.governor(c, { x, y: y + 38 * s, s, spin: 0.78, t, plate: 'THE MARKET', plateU: 1 }));
}
// c20: ONE recursion from THE CCRU IDENTIFIED (key 17.5) to AND NOT 'CAPITAL.' (key 92.5), never cut (the client, 8 Oct: "do not break the recursion").
// Its zoom phase (levels) is integrated over PLAYING seconds. The CCRU: it runs away as the cards tighten, society flashing in its frames. THEY WERE WRONG: the
// frames empty (the bare form the CCRU named Capital) and the runaway eases to a walk, still going in. Then the takes part:
//   a  the Droste in: the chairman's sentence fills every frame ahead with people at research, and the camera travels in through them, quickening to the peak;
//   b  the pull back: on WITH CAPITAL. the camera pulls out, and every loop's return wire turns out to run through people's hands at the consoles
//      (Marx's conscious linkages), the frames inside left bare.
// AND NOT 'CAPITAL.' rushes the camera in and the recursion opens into the circuit.
const LOOP_CLIPS = ['frameline', 'table', 'pressmen', 'chassis', 'flyhi', 'faceB', 'engine', 'press5'];
// c20 v2: people you can see (the scopes and the dark operator printed as black discs in the frames): the drafting room, the racks, the console, the room
// c20 v3 (finish, after farm 1015-091805): the racks (no one in them) and the dark console out; only the drafting room and the operators' room, cut where
// the people sit off the centre (the next loop's ink box covers the middle 40% of every frame)
const RES = [{ clip: 'draft', t0: 2.5, bz: 1.0, cx: 0.5 }, { clip: 'room', t0: 3.0, bz: 1.05, cy: 0.6 }, { clip: 'draft', t0: 7.0, bz: 1.05, cx: 0.45 }, { clip: 'room', t0: 5.0, bz: 1.1, cx: 0.45, cy: 0.62 }];
// c20 v3: a frame wider than the page printed its film many screens wide (400x300 source pixels blown into blotches; nobody legible). The print now stops
// growing at about the page's width and only creeps after that; the rest of the frame is ink, so the people sit in one readable window as in v14.
const PRINT_CAP = 1.2 * W;
function capRect([x, y, w, h]) {
  if (w <= PRINT_CAP) return [x, y, w, h];
  const w2 = PRINT_CAP * Math.pow(w / PRINT_CAP, 0.25), h2 = w2 * h / w;
  return [x + (w - w2) / 2, y + (h - h2) / 2, w2, h2];
}
const HANDS = [[{ clip: 'op2', t0: 2.0 }, { clip: 'scope', t0: 6.3 }, { clip: 'op', t0: 1.4 }], [{ clip: 'room', t0: 2.6 }, { clip: 'valve', t0: 0.3 }, { clip: 'drill', t0: 1.0 }],
  [{ clip: 'grille', t0: 1.0 }, { clip: 'work', t0: 2.0 }, { clip: 'press5', t0: 3.0 }]];
const SEC = (k) => toNew(k) * B.spb;
function hermite(xs, ys) {                           // monotone cubic through (xs, ys) (Fritsch-Carlson)
  const n = xs.length, d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  m[0] = d[0]; m[n - 1] = d[n - 2];
  return (x) => { let i = 0; while (i < n - 2 && x > xs[i + 1]) i++; const h = xs[i + 1] - xs[i], t = clamp((x - xs[i]) / h), t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1]; };
}
const PH = (() => {
  const n0 = toNew(17.5), n1 = toNew(95.5), st = 1 / 120, a = [0], s32 = SEC(32), s92 = SEC(92.5);
  const rate = (k, sec) => k < 32 ? 0.3 + 2.1 * Math.pow(smooth(17.5, 31, k), 1.4)
    : k < 40 ? (TAKE === 'b' ? 0.35 : 0.55) + (2.4 - (TAKE === 'b' ? 0.35 : 0.55)) * Math.exp(-(sec - s32) / 0.6)
    : k < 92.5 ? 0.5 + 0.6 * smooth(79.5, 92.5, k) : 1.1 + 7 * (sec - s92);
  for (let bn = n0; bn < n1 + st; bn += st) { const sec = bn * B.spb; a.push(a[a.length - 1] + rate(toOld(bn), sec) * st * B.spb); }
  const at = (bn) => a[clamp(Math.floor((bn - n0) / st), 0, a.length - 1)];
  const P37 = at(toNew(37)), LW = Math.floor(P37), P92 = LW - 2.2;
  const pull = hermite([SEC(37), SEC(40), SEC(84.5), SEC(92.5)], [P37, LW - 0.8, LW - 1.3, P92]);
  const P795 = at(toNew(79.5));
  return { n0, st, a, at, P37, LW, P92, pull, Lr: Math.round(P795 + 1) };
})();
function loopPh(bn) {
  const k = toOld(bn), sec = bn * B.spb;
  if (TAKE !== 'b' || k < 37) return PH.at(bn);
  if (k < 92.5) return PH.pull(sec);
  const u = sec - SEC(92.5); return PH.P92 + 1.1 * u + 3.5 * u * u;                   // b: the hand-off rushes back in
}
function filmIn(clip, t0, sec, rect, o = {}) {
  return (c) => { const [x, y, w, h] = rect, i = FILM.frameAt(clip, t0 + sec * (o.rate ?? 0.75), 'pp');
    c.fillStyle = PAPER; c.fillRect(x, y, w, h);
    FILM.print(c, clip, i, rect, { band: true, ar: w / h, bz: o.bz ?? 1.05, cx: o.cx ?? 0.5, cy: o.cy ?? 0.5, pitch: o.pitch ?? 9, lo: o.lo ?? 0.0, hi: o.hi ?? 0.62, gamma: o.gamma ?? 1.15, soft: 0.1, seed: i }); };
}
function loopShot(b, t, bn, o = {}) {
  const sec = bn * B.spb, ph = loopPh(bn);
  const flow = b < 32 ? 0.6 + 2.4 * smooth(17.5, 31, b) : b < 79.5 ? 1.2 : 1.4 + 1.8 * smooth(79.5, 92.5, b);
  const film = (lv) => {
    if (b >= 25.5 && b < 32) { const clip = LOOP_CLIPS[((lv % 8) + 8) % 8];                     // the CCRU: society flashing in the frames
      return (c, r) => filmIn(clip, 0.8, t % 3, r, { hi: 0.78, gamma: 0.95 })(c); }
    if (TAKE !== 'b' && b >= 79.5 && lv >= PH.Lr) { const R = RES[(lv - PH.Lr) % RES.length], s0 = SEC(79.5);   // a: the frames ahead hold people at research
      return (c, r) => { const r2 = capRect(r); if (r2 !== r) { c.fillStyle = INK; c.fillRect(...r); }
        filmIn(R.clip, R.t0, sec - s0, r2, { rate: 0.7, bz: R.bz, cx: R.cx, cy: R.cy, lo: -0.04, hi: 0.55, gamma: 1.3, pitch: Math.max(7, Math.min(11, r2[2] / 115)) })(c); }; }
    return null;
  };
  const wire = TAKE === 'b' && b >= 37 ? (c, lv, g) => {                                          // b: the return wire runs through people's hands
    if (lv > PH.LW || lv < PH.LW - 2) return;
    const ww = 0.36 * g.w, wh = 0.27 * g.w; if (ww < 18 || ww > 900) return;
    const set = HANDS[PH.LW - lv], s0 = SEC(37);
    for (let j = 0; j < 3; j++) { const x = g.cx + (j - 1) * 0.55 * g.w - ww / 2, y = g.yb - wh / 2, f = Math.max(2, g.lw * 0.6);
      c.fillStyle = INK; c.fillRect(x - f * 2, y - f * 2, ww + f * 4, wh + f * 4);
      filmIn(set[j].clip, set[j].t0, sec - s0, [x, y, ww, wh], { rate: 0.7, pitch: Math.max(6, Math.min(10, ww / 34)) })(c);
      c.strokeStyle = PAPER; c.lineWidth = f; c.strokeRect(x, y, ww, wh); }
  } : null;
  POST.droste(ctx, ph, t, flow, { film, wire, ...o });
}
// AND NOT 'CAPITAL.': the camera rushes in, the recursion opens into the circuit (which runs brighter than before)
function releaseShot(b, t, bn) {
  const u = clamp((b - 92.5) / 0.9);
  POST.circuit(ctx, { grow: 0.6 + 0.6 * ease.outCubic(clamp(u * 1.5)), flow: 2.6, t, bright: 1, zoom: lerp(0.55, 1.04, ease.outCubic(u)) - 0.04 * clamp((b - 93.9) / 2) });
  if (u < 1) loopShot(b, t, bn, { bg: false, alpha: Math.pow(1 - u, 2.2) });
}
const IDLE_FRAMES = [[120, 960, 400, 300], [560, 1180, 400, 300], [240, 1440, 400, 300]];
// the Program on paper: a scaffold rising floor by floor, a card a floor. c20: the crews are real people at the work, a frame of film in every bay of every deck
// (the drawn toy figures are gone: people come from film or the person pipeline, never drawn)
const PANELS = [['build', 1.5], ['grille', 4.0], ['work', 4.5], ['frameline', 3.0], ['chassis', 2.0], ['drill', 1.0], ['press5', 6.0], ['table', 6.0],
  ['engine', 3.0], ['bigpress', 5.0], ['build', 4.0], ['grille', 7.5]];
function programBuild(b, sh, bn) {
  const u = (b - sh.b0) / (sh.end - sh.b0), gy = 1840, FH = 250, bay = 510, floors = 0.5 + u * 4.9, sec = (bn - toNew(sh.b0)) * B.spb;
  scaffold(ctx, -60, 1140, gy + 30, FH * 1.25, floors * 0.8, { bay: 420, w: 6, tone: '#8a8a84', alpha: 0.6 });
  for (let f = 0; f <= Math.floor(floors); f++) {
    const g = clamp(floors - f); if (g < 0.55) continue;
    const a = ease.outCubic(clamp((g - 0.55) / 0.3)), y0 = gy - f * FH;
    for (let i = 0; i < 2; i++) {
      const [clip, t0] = PANELS[(f * 2 + i) % PANELS.length], x = 30 + i * bay + 14, w = bay - 28, h = (FH - 40) * a, y = y0 - 12 - h;
      if (h < 4) continue;
      filmIn(clip, t0, sec + f * 0.3, [x, y, w, h], { rate: 0.6, pitch: 6.5, lo: -0.15, hi: 0.78, gamma: 1.3, bz: 1.0 })(ctx);   // c20 v3: a softer, lighter print (1015-091805's crushed blacks read as grit)
    }
  }
  scaffold(ctx, 30, 1050, gy, FH, floors, { bay, w: 9, tone: INK, alpha: 0.95 });
  ctx.fillStyle = INK; ctx.fillRect(0, gy, W, H - gy);
}

// ------------------------------------------------------------------ the frame
// shots: [from beat, mode, opts]; a shot runs to the next one's beat
const L = T_TAIL;
// v10: before the chips (keys 40-63.5) unchanged. After them the governor is gone: the relic, the circuit, the films on black, the loop (CCRU) running on unbroken (c20)
const SHOTS = [[0, 'circuit'], [8, 'film', FS.organs], [10.3, 'film', FS.racks], [12, 'film', FS.linkage], [14.5, 'film', FS.face], [17.5, 'loop'],
  [40, 'gov'],
  [56.6, 'film', FS.start], [61, 'gov'], [63.5, 'chips'], [67, 'relic'], [73, 'film', FS.plan1], [76, 'film', FS.plan2],
  [79.5, 'loop'], [92.5, 'release'],
  [79.5 + L, 'idle'], [97, 'film', FS.lever], [99.1, 'film', FS.gauge], [84 + L, 'film', FS.struggle], [87.5 + L, 'film', FS.align], [105.5, 'film', FS.master],
  [91.5 + L, 'build'], [102.5 + L, 'payoff']];
const shotAt = (b) => { let r = SHOTS[0], i = 0; SHOTS.forEach((x, k) => { if (b >= x[0]) { r = x; i = k; } }); return { b0: r[0], mode: r[1], o: r[2] ?? {}, end: (SHOTS[i + 1] ?? [CLOSE_AT])[0] }; };
window.renderFrame = (t) => {
  const t0 = performance.now();
  const bn = B.beat(t), beat = toOld(bn), frame = Math.round(t * 30), closing = beat >= CLOSE_AT;
  const sh = closing ? { b0: CLOSE_AT, mode: 'close', o: {}, end: CLOSE_AT + 4 } : shotAt(beat), mode = sh.mode, age = beat - sh.b0;
  ctx.save(); ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H); ctx.restore();
  if (mode === 'gov') govShot(beat, t);
  else if (mode === 'film') filmShot(beat, sh, bn);
  else if (mode === 'chips') chipsShot(beat, sh, bn);
  else if (mode === 'gov2') govShot(beat, t, { sy: 1080, sgain: 0.5, k: 1 });
  else if (mode === 'relic') relicShot(beat, t);
  else if (mode === 'circuit') POST.circuit(ctx, { grow: 0.12 + 0.95 * Math.pow(clamp(beat / 7.5), 2), flow: 0.6 + 1.6 * clamp(beat / 8), t, zoom: 1 + 0.06 * clamp(beat / 8) });
  else if (mode === 'loop') loopShot(beat, t, bn);
  else if (mode === 'release') releaseShot(beat, t, bn);
  else if (mode === 'idle') POST.circuit(ctx, { grow: 1.2, flow: 0.22, t, bright: 0.45, frames: IDLE_FRAMES });
  else if (mode === 'build') programBuild(beat, sh, bn);
  else if (mode === 'payoff' || mode === 'close') payoff(Math.min(beat, CLOSE_AT - 0.01), t);
  // the words
  const w = wordAt(beat);
  if (!closing && w.t) drawWord(ctx, w, (bn - toNew(w.b)) * B.spb, bn);
  if (closing) lockup((bn - CLOSE_NEW) * B.spb);
  finish.apply(ctx, frame, { grain: 0.04, vignette: 0.07 });
  lastMs = performance.now() - t0;
  if (window.__bench) console.log(`b${beat.toFixed(2)} ${mode} ${lastMs.toFixed(0)}ms`);
};

// the payoff: the governor under the class, steady, steps back; the four lanes lock into the four stripes and the mark lands over it
function payoff(b, t) {
  // v10: the governor left the piece at the chips; the banner and the mark land on clean paper
  if (b >= 104.8 + T_TAIL) {
    const lock = clamp((b - 104.8 - T_TAIL) / 1.5), rv = smooth(105.8 + T_TAIL, 106.9 + T_TAIL, b);
    WD.emblemLock(ctx, lock, { x: 560, y: 640, size: 600, a: 0, reveal: rv }, acpEmblem);
  }
}
// the lockup: ☭≡/acc and ACP.US settle on the governor at speed (the loop's frame 0 is the same machine, in ink)
function lockup(age) {
  const a = ease.outExpo(clamp(age / 0.25)), k = Math.exp(-age * 10);
  const g = ctx.createLinearGradient(0, 560, 0, 1260); g.addColorStop(0, 'rgba(247,247,242,0)'); g.addColorStop(0.3, `rgba(247,247,242,${0.9 * a})`);
  g.addColorStop(0.7, `rgba(247,247,242,${0.9 * a})`); g.addColorStop(1, 'rgba(247,247,242,0)');
  ctx.save(); ctx.fillStyle = `rgba(247,247,242,${0.55 * a})`; ctx.fillRect(0, 0, W, H); ctx.fillStyle = g; ctx.fillRect(0, 560, W, 700); ctx.restore();
  sigil(ctx, W / 2, 820, 230 * (1 + 0.4 * k), { color: INK, accent: WD.RED, alpha: a });
  ctx.save(); ctx.globalAlpha = clamp((age - 0.25) * 5); ctx.font = '900 76px "Archivo Black"'; ctx.textAlign = 'center'; ctx.fillStyle = INK; ctx.fillText('ACP.US', W / 2, 1120); ctx.restore();
}
window.sceneReady = true;
