// READY. (ready) v1.1, cycle 4 (c4b figures + light). A tokusatsu henshin for the 5 a.m. shift that turns out to be everyone's, at once.
//   A (b0-8)   the henshin on a black void: the steel-toe STOMP on bar grating with sparks (5 A.M.), the lace yanked,
//              the glove's strap snapped, the vest zipped, its retroreflective tape locking with a light seam, the
//              hard hat slapped on (TOK) with the ACP sticker, the inhale (the one silence), the glasses flipped down
//              with a single 2-frame lens wipe: READY.
//   B (b8-20)  the roster: a welder's hood nodded down, a lineman under the strobe with his hot stick carried upright, a miner's cap lamp clicked on,
//              an ironworker cinching her harness, a road crew in orange: READY. READY. Each trade in its own hat colour.
//   TURN (b20) the pull-back out of the hero into the plant gate at 5 a.m.: the crowd faces OUT of the gate toward the
//              lens and the town, backlit by the plant floods; one camera-axis strobe lights every vest band in the
//              whole crowd in one frame while the bodies stay black: ALL AT ONCE.
//   DROP 2     the pose (bent-elbow pumps rippling out from the hero, the smoke burst behind ~3 frames later, red over
//              the hat colours); the grid of gates (mill, port, fab, rail yard) all hitting the pose on the beat.
//   PAYOFF     b40 the poster: the hard hat and its sticker over the crowd, AMERICA'S READY.; b44 the lockup over the
//              3,000 boots stomping, the same stomp as frame 0 (the loop).
// Rules held: no front key on any figure (rim from real lights only; faces are black); gear is trade PPE only (no
// alarm, coffee, gym, mirror, phone or sunrise); hi-vis lime/orange with silver tape (never a black vest); no long
// object held diagonally; no straight-arm glyphs (ranks.js uses the bent-elbow pumpHi / pumpLo only); at most ~35 %
// raise an arm; type is lettered as retroreflective tape on hi-vis cloth, never the slate's centred slam.
// Words: research/scripts_final/ready.json. Song: web/audio/songs2/ready.py (100 BPM, logo at b44).
import { W, H, C, loadFonts, loadBeats, clamp, lerp, ease, smooth, rng, sigil, line, acpEmblem, BRAND } from '../lib/kit.js';
import { Post } from '../lib/fx/post.js';
import { Ranks } from '../lib/fx/ranks.js';

const QS = new URLSearchParams(location.search);
await loadFonts();
{ const f = new FontFace('Shoulders', 'url(../node_modules/@fontsource/big-shoulders-display/files/big-shoulders-display-latin-900-normal.woff2)', { weight: '900' });
  document.fonts.add(await f.load()); }
const SONG = window.__SONG || 'ready';                    // 'ready_c9': songs2/ready_c9.py (lockup b56); 'ready': the published song (lockup b44)
const C9 = SONG === 'ready_c9';
const B = await loadBeats(SONG);
const SPB = B.spb, CLOSE = C9 ? 56 : 44, FPSB = 30 * SPB;  // frames per beat = 18
// logical beats: the picture is cut on the c9 layout. On the published song the inserted bars (PEOPLE CAN'T AFFORD TO LIVE,
// the dysfunction run) are left out, and its payoff (b40) stands for the c9 arrival (b50).
const LB = C9 ? (b => b) : (b => b < 20 ? b : b < 40 ? b + 8 : 50 + (b - 40) * 1.375);
const TAU = Math.PI * 2;
const R = await Ranks.create({ W, H });

// ================================================================ words (scripts_final/ready.json, exactly)
// tape: 'o' = silver retroreflective letters on ANSI orange; 'l' = black print on ANSI lime between two tape stripes
const CUES = [
  { b: 0, text: '5 A.M.', hold: 1.7, x: 520, y: 520, size: 190, tape: 'o', rot: -0.035, ws: -0.13 },
  { b: 2, lines: ['THINGS', 'CANNOT GO ON'], hold: 1.5, x: 540, y: 330, size: 120, tape: 'o', rot: -0.03, c9: 1 },
  { b: 3.5, lines: ['ANY', 'LONGER'], hold: 1.25, x: 540, y: 330, size: 150, tape: 'l', rot: 0.03, c9: 1 },
  { b: 4.75, lines: ['IN THE', 'OLD WAY.'], hold: 2.0, x: 540, y: 300, size: 150, tape: 'o', rot: -0.025, c9: 1 },
  { b: 8, text: 'READY.', hold: 1.9, x: 540, y: 470, size: 250, tape: 'o', rot: 0.03 },
  { b: 10.5, lines: ['NO ONE', 'TRUSTS'], hold: 1.25, x: 540, y: 330, size: 130, tape: 'l', rot: -0.03, c9: 1 },
  { b: 11.75, lines: ['THE', 'INSTITUTIONS.'], hold: 2.25, x: 540, y: 330, size: 120, tape: 'o', rot: 0.025, c9: 1 },
  { b: 14, lines: ['NO ONE', 'BELIEVES'], hold: 1.75, x: 540, y: 330, size: 130, tape: 'l', rot: 0.03, c9: 1 },
  { b: 15.75, lines: ['IN', 'ANY'], hold: 1.25, x: 540, y: 330, size: 150, tape: 'o', rot: -0.03, c9: 1 },
  { b: 17, lines: ['RULING', 'IDEAS.'], hold: 2.9, x: 540, y: 330, size: 150, tape: 'o', rot: 0.03, c9: 1 },
  { b: 20, lines: ["PEOPLE CAN'T", 'AFFORD TO LIVE.'], rev: [20, 22], hold: 3.95, x: 540, y: 400, size: 128, tape: 'o', rot: -0.02, c9: 1, only: 'c9' },
  { b: 24, lines: ['SYSTEMIC,', 'OPERATIONAL,', 'LOGISTICAL', 'DYSFUNCTION.'], rev: [24, 24.75, 26, 27], hold: 3.95, x: 540, y: 470, size: 120, tape: 'l', rot: 0.015, c9: 1, only: 'c9' },
  { b: 28, text: 'ALL AT ONCE.', hold: 2.0, x: 540, y: 420, size: 150, tape: 'o', rot: -0.02 },
  { b: 30, lines: ['WHEN IT', 'DOES,'], hold: 1.95, x: 540, y: 420, size: 170, tape: 'o', rot: 0.02, c9: 1 },
  { b: 32, text: 'READY.', hold: 1.9, x: 540, y: 380, size: 260, tape: 'l', rot: 0.025 },
  { b: 34, lines: ['ONLY', 'THOSE'], hold: 1.5, x: 540, y: 330, size: 170, tape: 'o', rot: -0.03, c9: 1 },
  { b: 35.5, lines: ['ALREADY', 'ORGANIZED'], hold: 4.0, x: 540, y: 330, size: 150, tape: 'l', rot: 0.02, c9: 1 },
  { b: 39.5, lines: ['WILL', 'SHAPE'], hold: 2.0, x: 540, y: 430, size: 170, tape: 'o', rot: -0.03, c9: 1 },
  { b: 41.5, lines: ['THE', 'FUTURE'], hold: 1.5, x: 540, y: 330, size: 170, tape: 'l', rot: 0.03, c9: 1 },
  { b: 43, lines: ['OF THE', 'NATION.'], hold: 2.75, x: 540, y: 330, size: 170, tape: 'o', rot: -0.02, c9: 1 },
  { b: 45.75, lines: ['AMERICANS', 'ARE'], hold: 2.25, x: 540, y: 330, size: 150, tape: 'l', rot: 0.02, c9: 1 },
  { b: 48, lines: ['AMERICANS ARE', 'ABSOLUTELY', 'READY.'], rev: [48, 48, 50], hold: 7.6, x: 540, y: 520, size: 300, tape: 'o', rot: -0.025, pay: true, c9: 1 },
];

// ================================================================ canvases, post
const post = new Post(W, H, { direct: true, glowScale: 0.25 });
const mk = (w = W, h = H) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };
const [comp, cg] = mk(), [typeC, tg] = mk(), [scr, sg] = mk(), [scr2, sg2] = mk(), [ov, og] = mk();

// ================================================================ small utils
function hash(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
const beatT = b => b * SPB;
const P2 = (d) => new Path2D(d);
function xf(path, x, y, s, rot = 0, sx = 1) { const P = new Path2D(); P.addPath(path, new DOMMatrix().translate(x, y).rotate(rot * 180 / Math.PI).scale(s * sx, s)); return P; }
function rgba(c, a = 1) { return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`; }
function glowDot(g, x, y, r, col, a = 1) { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, rgba(col, a)); gr.addColorStop(0.25, rgba(col, a * 0.35)); gr.addColorStop(1, rgba(col, 0)); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
// a silhouette with a rim crescent on the side facing the light (dir = unit vector toward the light, px width w)
function rimFill(g, path, { fill = '#050505', rim = null, dir = [1, -0.3], w = 8, alpha = 1, glow = 0, rim2 = null, dir2 = null, w2 = 5, alpha2 = 0.25 } = {}) {
  g.save(); g.fillStyle = fill; g.fill(path); g.restore();
  for (const [col, d, ww, aa] of [[rim, dir, w, 1], [rim2, dir2, w2, alpha2]]) {
    if (!col || !d) continue;
    sg.setTransform(1, 0, 0, 1, 0, 0); sg.globalCompositeOperation = 'source-over'; sg.clearRect(0, 0, W, H);
    sg.fillStyle = col; sg.fill(path);
    sg.globalCompositeOperation = 'destination-out'; sg.fillStyle = '#000'; sg.setTransform(1, 0, 0, 1, -d[0] * ww, -d[1] * ww); sg.fill(path);
    sg.setTransform(1, 0, 0, 1, 0, 0); sg.globalCompositeOperation = 'source-over';
    g.save(); g.globalAlpha = alpha * aa; g.globalCompositeOperation = 'lighter'; g.drawImage(scr, 0, 0);
    if (glow) { g.filter = `blur(${glow}px)`; g.globalAlpha = alpha * aa * 0.8; g.drawImage(scr, 0, 0); }
    g.restore();
  }
}
// light seam: a bright head racing along a polyline (screen px), leaving the path lit behind it
function seam(g, pts, u, { col = [255, 235, 200], w = 5, lit = 0.35, head = 1 } = {}) {
  if (u <= 0) return;
  const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const tot = L[L.length - 1], s = clamp(u) * tot;
  g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = rgba(col, lit); g.lineWidth = w; g.beginPath(); g.moveTo(...pts[0]);
  let hp = pts[0];
  for (let i = 1; i < pts.length; i++) { if (L[i] <= s) { g.lineTo(...pts[i]); hp = pts[i]; } else { const k = (s - L[i - 1]) / (L[i] - L[i - 1]); hp = [lerp(pts[i - 1][0], pts[i][0], k), lerp(pts[i - 1][1], pts[i][1], k)]; g.lineTo(...hp); break; } }
  g.stroke();
  if (head && u < 1) glowDot(g, hp[0], hp[1], w * 9, col, head);
  g.restore();
}
// deterministic spark burst: n streaks from (x, y), spray angle a0 +- spread, speed v px/s, gravity px/s^2
function sparks(g, x, y, age, { n = 60, a0 = -Math.PI / 2, spread = 1.2, v = 1400, grav = 2600, life = 0.55, seed = 1, w = 2.4 } = {}) {
  if (age < 0 || age > life * 1.6) return;
  const r = rng(seed);
  g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const a = a0 + (r() - 0.5) * 2 * spread, sp = v * (0.3 + 0.9 * r()), L = life * (0.4 + 0.8 * r());
    if (age > L) continue;
    const vx = Math.cos(a) * sp, vy = Math.sin(a) * sp, P = tt => [x + vx * tt, y + vy * tt + 0.5 * grav * tt * tt];
    const p1 = P(age), p0 = P(Math.max(0, age - 0.035)), k = 1 - age / L;
    g.strokeStyle = `rgba(255,${Math.round(170 + 80 * k)},${Math.round(80 + 150 * k * k)},${0.9 * k})`; g.lineWidth = w * (0.6 + r());
    g.beginPath(); g.moveTo(...p0); g.lineTo(...p1); g.stroke();
  }
  g.restore();
}
// backlight haze: the light source behind the figure blooming through the dawn air, so a body is a cut-out against light
function haze(g, x, y, r, col, a = 1, sq = 1) { g.save(); g.globalCompositeOperation = 'lighter'; g.translate(x, y); g.scale(1, sq);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, r); gr.addColorStop(0, rgba(col, 0.55 * a)); gr.addColorStop(0.35, rgba(col, 0.22 * a)); gr.addColorStop(0.7, rgba(col, 0.06 * a)); gr.addColorStop(1, rgba(col, 0));
  g.fillStyle = gr; g.fillRect(-r, -r, 2 * r, 2 * r); g.restore(); }
function shakeXY(beat, hitB, amp) { const a = (beat - hitB) * SPB; if (a < 0 || a > 0.3) return [0, 0]; const k = amp * Math.exp(-a * 14); return [Math.sin(a * 91) * k, Math.cos(a * 77) * k]; }
const since = (beat, b) => (beat - b) * SPB;             // seconds since beat b

// ================================================================ textures
const [plaidC, plg] = mk(64, 64);
{ plg.fillStyle = '#5a0e0c'; plg.fillRect(0, 0, 64, 64); plg.fillStyle = 'rgba(0,0,0,0.55)'; plg.fillRect(0, 0, 64, 22); plg.fillRect(0, 0, 22, 64);
  plg.fillStyle = 'rgba(0,0,0,0.35)'; plg.fillRect(40, 0, 6, 64); plg.fillRect(0, 40, 64, 6); plg.fillStyle = 'rgba(255,220,180,0.08)'; plg.fillRect(30, 0, 2, 64); plg.fillRect(0, 30, 64, 2); }
const plaid = cg.createPattern(plaidC, 'repeat');
const [knitC, kng] = mk(8, 8);
{ kng.fillStyle = 'rgba(0,0,0,0)'; kng.clearRect(0, 0, 8, 8); kng.fillStyle = 'rgba(0,0,0,0.22)'; for (const [x, y] of [[1, 1], [5, 1], [3, 5], [7, 5]]) { kng.beginPath(); kng.arc(x, y, 1.1, 0, TAU); kng.fill(); } }
const knit = cg.createPattern(knitC, 'repeat');
const [prismC, prg] = mk(6, 6);
{ prg.fillStyle = 'rgba(0,0,0,0.18)'; for (const [x, y] of [[1, 1], [4, 1], [2.5, 4]]) { prg.beginPath(); prg.arc(x, y, 0.9, 0, TAU); prg.fill(); } }
const prism = cg.createPattern(prismC, 'repeat');

const HIVIS = { lime: [196, 245, 34], orange: [255, 98, 14] };
const HAT = { white: [236, 234, 226], yellow: [250, 196, 20], blue: [30, 90, 200], orange: [255, 110, 20], brown: [120, 72, 40], green: [40, 150, 70] };

// ================================================================ the figure: a bust in lost profile / back / front
// local units: origin at the base of the neck, +v down; shoulders ~1.1 wide. f = facing (+1 right, -1 left).
function bustPaths(f, o) {
  // v2 (c4b): a working body, not a mannequin. 3/4 back: the shoulder toward f recedes (narrower); trapezius slope,
  // deltoid, sleeves hanging with the elbow break, the armpit gap, a hoodie hood bunched on the back.
  const kN = f > 0 ? [1.0, 0.9] : [0.9, 1.0];            // [left side x scale, right side x scale]
  const side = (sx) => { const k = sx < 0 ? kN[0] : kN[1]; return (x) => x * k; };
  const torso = new Path2D(), L = side(-1), R = side(1);
  torso.moveTo(L(-0.12), -0.06);
  torso.bezierCurveTo(L(-0.24), 0.0, L(-0.44), 0.04, L(-0.6), 0.13);            // trapezius to the shoulder point
  torso.bezierCurveTo(L(-0.74), 0.2, L(-0.78), 0.42, L(-0.76), 0.66);          // deltoid
  torso.bezierCurveTo(L(-0.76), 0.95, L(-0.8), 1.2, L(-0.78), 1.4);            // upper arm, sleeve fold at the elbow
  torso.bezierCurveTo(L(-0.77), 1.7, L(-0.74), 2.0, L(-0.73), 2.3);            // forearm down out of frame
  torso.lineTo(R(0.73), 2.3);
  torso.bezierCurveTo(R(0.74), 2.0, R(0.77), 1.7, R(0.78), 1.4);
  torso.bezierCurveTo(R(0.8), 1.2, R(0.76), 0.95, R(0.76), 0.66);
  torso.bezierCurveTo(R(0.78), 0.42, R(0.74), 0.2, R(0.6), 0.13);
  torso.bezierCurveTo(R(0.44), 0.04, R(0.24), 0.0, R(0.12), -0.06); torso.closePath();
  // the sleeves (for plaid and the armpit crease): outer arm edge to the inner seam
  const arms = new Path2D();
  for (const [sx, S] of [[-1, L], [1, R]]) {
    arms.moveTo(S(sx * 0.6), 0.13); arms.bezierCurveTo(S(sx * 0.74), 0.2, S(sx * 0.78), 0.42, S(sx * 0.76), 0.66);
    arms.bezierCurveTo(S(sx * 0.76), 0.95, S(sx * 0.8), 1.2, S(sx * 0.78), 1.4); arms.bezierCurveTo(S(sx * 0.77), 1.7, S(sx * 0.74), 2.0, S(sx * 0.73), 2.3);
    arms.lineTo(S(sx * 0.53), 2.3); arms.bezierCurveTo(S(sx * 0.54), 1.8, S(sx * 0.55), 1.2, S(sx * 0.52), 0.78);
    arms.bezierCurveTo(S(sx * 0.5), 0.5, S(sx * 0.56), 0.3, S(sx * 0.6), 0.13); arms.closePath();
  }
  const crease = [[L(-0.52), 0.78, L(-0.55), 1.2, L(-0.54), 1.8, L(-0.53), 2.3], [R(0.52), 0.78, R(0.55), 1.2, R(0.54), 1.8, R(0.53), 2.3]];
  const neck = new Path2D(); neck.moveTo(-0.11, -0.02); neck.bezierCurveTo(-0.1, -0.1, -0.09, -0.16, -0.085, -0.22); neck.lineTo(0.09, -0.22);
  neck.bezierCurveTo(0.1, -0.14, 0.11, -0.08, 0.13, -0.02); neck.closePath();
  const head = new Path2D();
  // lost profile: the back of the skull, the jaw turning toward f, the ear, the cheek edge just catching
  head.moveTo(-f * 0.08, -0.13); head.bezierCurveTo(-f * 0.17, -0.15, -f * 0.21, -0.3, -f * 0.19, -0.42);
  head.bezierCurveTo(-f * 0.17, -0.56, f * 0.02, -0.62, f * 0.13, -0.55);
  head.bezierCurveTo(f * 0.2, -0.5, f * 0.215, -0.4, f * 0.205, -0.33);       // brow to cheekbone, turned away
  head.bezierCurveTo(f * 0.21, -0.25, f * 0.19, -0.17, f * 0.13, -0.12);       // cheek to jaw corner
  head.bezierCurveTo(f * 0.1, -0.1, f * 0.06, -0.1, f * 0.03, -0.12); head.closePath();
  const ear = new Path2D(); ear.ellipse(f * 0.07, -0.3, 0.035, 0.06, f * 0.2, 0, TAU);
  const nape = new Path2D();                                                    // hair at the nape under the hat: a ragged edge
  nape.moveTo(-f * 0.19, -0.4); for (let i = 0; i <= 8; i++) { const u = i / 8; nape.lineTo(-f * lerp(0.2, 0.02, u) + (i % 2 ? 0.012 : -0.01), lerp(-0.26, -0.19, u) + (i % 2 ? 0.025 : 0)); }
  nape.lineTo(f * 0.02, -0.42); nape.closePath();
  const hat = new Path2D();
  // V-Gard cap: egg crown, ridge, drip rim, the peak angled down toward f
  hat.moveTo(-f * 0.25, -0.4); hat.bezierCurveTo(-f * 0.27, -0.62, -f * 0.06, -0.7, f * 0.06, -0.68); hat.bezierCurveTo(f * 0.2, -0.66, f * 0.26, -0.56, f * 0.25, -0.45);
  hat.lineTo(f * 0.36, -0.4); hat.lineTo(f * 0.35, -0.375); hat.lineTo(f * 0.2, -0.385); hat.lineTo(-f * 0.24, -0.375); hat.lineTo(-f * 0.27, -0.39); hat.closePath();
  // the hoodie's hood bunched on the upper back: a lumpy roll with two folds
  const hood = new Path2D(); hood.moveTo(-0.3, 0.02); hood.bezierCurveTo(-0.34, -0.1, -0.16, -0.12, -0.04, -0.06); hood.bezierCurveTo(0.08, -0.13, 0.3, -0.1, 0.31, 0.02);
  hood.bezierCurveTo(0.33, 0.14, 0.2, 0.26, 0.0, 0.25); hood.bezierCurveTo(-0.2, 0.26, -0.33, 0.15, -0.3, 0.02); hood.closePath();
  return { torso, arms, crease, neck, head, ear, nape, hat, hood };
}
// the vest (panel inside the torso) and its tape: two horizontal bands + two over the shoulders
function vestGeom(view) {
  const panel = new Path2D();
  if (view === 'front') { panel.moveTo(-0.5, 0.2); panel.lineTo(-0.16, 0.08); panel.lineTo(-0.03, 0.55); panel.lineTo(0.03, 0.55); panel.lineTo(0.16, 0.08); panel.lineTo(0.5, 0.2); panel.lineTo(0.52, 2.2); panel.lineTo(-0.52, 2.2); panel.closePath(); }
  else { panel.moveTo(-0.5, 0.2); panel.bezierCurveTo(-0.3, 0.08, -0.16, 0.05, 0, 0.05); panel.bezierCurveTo(0.16, 0.05, 0.3, 0.08, 0.5, 0.2); panel.lineTo(0.52, 2.2); panel.lineTo(-0.52, 2.2); panel.closePath(); }
  const bands = [[[-0.52, 0.95], [0.52, 0.95]], [[-0.52, 1.28], [0.52, 1.28]], [[-0.3, 0.12], [-0.3, 0.95]], [[0.3, 0.12], [0.3, 0.95]]];
  return { panel, bands };
}
// draw a bust at (x, y) = neck base in px, s = px per unit. o: { f, view, hat, sticker, vest, garment, hood, glasses (0 up .. 1 down),
//   light: { dir, col, w }, light2, bandK (tape brightness 0..1), seamU (0..1 light seam along the tape), ponytail, harness, weld (0 up..1 down), bunny }
function bust(g, x, y, s, o = {}) {
  const f = o.f ?? 1, P = bustPaths(f, o), T = p => xf(p, x, y, s);
  const L1 = o.light || { dir: [0.9, -0.4], col: 'rgb(255,170,80)', w: 10 };
  const rimO = { rim: L1.col, dir: L1.dir, w: L1.w * s / 600, glow: 6, rim2: o.light2?.col, dir2: o.light2?.dir, w2: (o.light2?.w || 6) * s / 600 };
  // body
  const body = new Path2D(); body.addPath(T(P.torso));
  rimFill(g, body, { fill: '#060607', ...rimO });
  // the back of the garment: the plaid faint, soft folds across the shoulder blades catching the rim side
  if (o.vest || o.garment === 'flannel') {
    g.save(); g.clip(T(P.torso)); g.globalAlpha = 0.14; g.fillStyle = plaid; g.setTransform(s / 300, 0, 0, s / 300, x, y); g.fillRect(-3000, -3000, 6000, 6000); g.restore();
  }
  { g.save(); g.clip(T(P.torso)); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
    const d = L1.dir[0] >= 0 ? 1 : -1, rc = L1.col;
    for (const [x0, y0, x1, y1, cx, cy, a] of [[0.1, 0.3, 0.62, 0.22, 0.4, 0.34, 0.1], [0.05, 0.62, 0.58, 0.5, 0.36, 0.66, 0.08], [0.2, 1.5, 0.6, 1.3, 0.45, 1.5, 0.07], [0.3, 0.9, 0.66, 0.84, 0.5, 0.96, 0.06]]) {
      g.globalAlpha = a; g.strokeStyle = rc; g.lineWidth = 0.02 * s; g.filter = `blur(${0.012 * s}px)`;
      g.beginPath(); g.moveTo(x + d * x0 * s, y + y0 * s); g.quadraticCurveTo(x + d * cx * s, y + cy * s, x + d * x1 * s, y + y1 * s); g.stroke(); }
    g.restore(); }
  if (o.garment === 'leather') { g.save(); g.clip(T(P.torso)); g.fillStyle = 'rgba(70,40,22,0.35)'; g.fillRect(0, 0, W, H); g.restore(); }
  if (o.bunny) { g.save(); g.clip(T(P.torso)); const bg2 = g.createLinearGradient(x, y, x, y + 1.6 * s); bg2.addColorStop(0, 'rgba(190,180,140,0.95)'); bg2.addColorStop(1, 'rgba(60,55,40,0.9)'); g.fillStyle = bg2; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(70,60,35,0.45)'; g.lineWidth = 0.01 * s; for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(x + (i - 2.5) * 0.18 * s, y + 0.2 * s); g.quadraticCurveTo(x + (i - 2.5) * 0.2 * s, y + 0.8 * s, x + (i - 2.5) * 0.16 * s, y + 1.6 * s); g.stroke(); } g.restore(); }
  // vest + tape
  if (o.vest) {
    const V = vestGeom(o.view), vc = HIVIS[o.vest];
    const pan = T(V.panel); g.save(); g.clip(T(P.torso)); g.clip(pan);
    g.fillStyle = rgba(vc.map(v => v * (0.13 + 0.25 * (o.vestLit || 0))), 1); g.fill(pan);
    g.fillStyle = knit; g.setTransform(s / 700, 0, 0, s / 700, x, y); g.fillRect(-4000, -4000, 8000, 8000); g.setTransform(1, 0, 0, 1, 0, 0);
    // the rim on the fluorescent cloth (the backlight turns the fabric edge)
    g.restore();
    rimFill(g, pan, { fill: 'rgba(0,0,0,0)', rim: rgba(vc, 0.9), dir: L1.dir, w: L1.w * s / 600 * 0.9, glow: 4, alpha: 0.8 });
    const k = o.bandK ?? 0.12, bw = 0.055 * s;
    g.save(); g.clip(T(P.torso)); g.lineCap = 'butt';
    V.bands.forEach((bd, i) => {
      const a = [x + bd[0][0] * s, y + bd[0][1] * s], b = [x + bd[1][0] * s, y + bd[1][1] * s];
      g.strokeStyle = `rgb(${60 + 195 * k},${62 + 193 * k},${66 + 180 * k})`; g.lineWidth = bw; g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke();
      if (k > 0.3) { g.save(); g.globalCompositeOperation = 'lighter'; g.filter = `blur(${bw * 0.6}px)`; g.strokeStyle = `rgba(255,250,235,${(k - 0.3) * 0.8})`; g.lineWidth = bw * 1.6; g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke(); g.restore(); }
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(a[0], a[1] - bw / 2); g.lineTo(b[0], b[1] - bw / 2); g.stroke(); g.setLineDash([]);
      if (o.seamU > 0) seam(g, i < 2 ? (i % 2 ? [b, a] : [a, b]) : [a, b], clamp(o.seamU * 1.6 - i * 0.2), { w: bw * 0.8, lit: 0.9, col: [255, 250, 235] });
    });
    g.restore();
    if (o.view === 'front' && o.zipU != null) { // the zip: teeth up the centre, the pull rising
      const zy0 = y + 2.2 * s, zy1 = y + lerp(2.2, 0.56, o.zipU) * s;
      g.save(); g.strokeStyle = 'rgba(40,40,44,1)'; g.lineWidth = 0.03 * s; g.beginPath(); g.moveTo(x, zy0); g.lineTo(x, zy1); g.stroke();
      g.globalCompositeOperation = 'lighter'; g.fillStyle = 'rgba(255,220,170,0.9)'; g.fillRect(x - 0.02 * s, zy1 - 0.02 * s, 0.04 * s, 0.07 * s); glowDot(g, x, zy1, 0.12 * s, [255, 200, 140], 0.6); g.restore(); }
  }
  if (o.harness) { // ironworker's full-body harness from behind: shoulder straps to the dorsal D-ring
    const cin = o.harness; g.save(); g.clip(T(P.torso)); g.strokeStyle = '#0c0c0e'; g.lineWidth = 0.08 * s;
    const dr = [x, y + (0.62 - 0.05 * cin) * s];
    for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(x + sx * 0.28 * s, y + 0.08 * s); g.lineTo(dr[0] + sx * 0.03 * s, dr[1]); g.lineTo(x + sx * (0.36 - 0.04 * cin) * s, y + 1.6 * s); g.stroke(); }
    g.restore();
    rimFill(g, (() => { const p = new Path2D(); for (const sx of [-1, 1]) { p.moveTo(x + sx * 0.28 * s, y + 0.08 * s); p.lineTo(dr[0] + sx * 0.03 * s, dr[1]); p.lineTo(x + sx * 0.36 * s, y + 1.6 * s); p.lineTo(x + sx * 0.3 * s, y + 1.6 * s); p.lineTo(dr[0] - sx * 0.01 * s, dr[1] + 0.06 * s); p.lineTo(x + sx * 0.22 * s, y + 0.08 * s); p.closePath(); } return p; })(),
      { fill: 'rgba(8,8,10,1)', rim: 'rgba(255,200,130,0.8)', dir: L1.dir, w: 3 });
    g.save(); g.lineWidth = 0.025 * s; g.strokeStyle = `rgba(210,210,220,${0.5 + 0.5 * (o.dringK || 0)})`; g.beginPath(); g.ellipse(dr[0], dr[1] - 0.04 * s, 0.07 * s, 0.05 * s, 0, Math.PI, TAU); g.stroke();
    if (o.dringK) glowDot(g, dr[0] + 0.05 * s, dr[1] - 0.07 * s, 0.25 * s, [255, 240, 220], o.dringK); g.restore();
  }
  if (o.hood) { const hp = T(P.hood); rimFill(g, hp, { fill: '#0d0d10', ...rimO, w: rimO.w * 0.7 });
    g.save(); g.clip(hp); g.fillStyle = knit; g.setTransform(s / 500, 0, 0, s / 500, x, y); g.fillRect(-4000, -4000, 8000, 8000); g.setTransform(1, 0, 0, 1, 0, 0);
    g.strokeStyle = 'rgba(0,0,0,0.9)'; g.lineWidth = 0.014 * s; g.lineCap = 'round';
    for (const [a0, b0, a1, b1] of [[-0.2, 0.04, -0.05, 0.18], [0.22, 0.02, 0.06, 0.2], [-0.04, -0.04, 0.02, 0.12]]) { g.beginPath(); g.moveTo(x + a0 * s, y + b0 * s); g.quadraticCurveTo(x + (a0 + a1) * 0.5 * s, y + (b1 + 0.02) * s, x + a1 * s, y + b1 * s); g.stroke(); }
    g.restore(); }
  // the sleeves over the vest's side edges: flannel (or leather / hoodie knit), the armpit crease, the rim on the outer arm
  { const ap = T(P.arms);
    g.save(); g.fillStyle = o.garment === 'leather' ? '#1a110b' : '#08070a'; g.fill(ap); g.clip(ap);
    if (o.garment !== 'leather') { g.globalAlpha = o.vest || o.garment === 'flannel' ? 0.3 : 0.12; g.fillStyle = plaid; g.setTransform(s / 300, 0, 0, s / 300, x, y); g.fillRect(-3000, -3000, 6000, 6000); }
    g.restore();
    rimFill(g, ap, { fill: 'rgba(0,0,0,0)', ...rimO, w: rimO.w * 0.9 });
    g.save(); g.strokeStyle = 'rgba(0,0,0,0.85)'; g.lineWidth = 0.022 * s; g.lineCap = 'round';
    for (const c of P.crease) { g.beginPath(); g.moveTo(x + c[0] * s, y + c[1] * s); g.bezierCurveTo(x + c[2] * s, y + c[3] * s, x + c[4] * s, y + c[5] * s, x + c[6] * s, y + c[7] * s); g.stroke(); }
    g.restore(); }
  // head
  const hn = new Path2D(); hn.addPath(T(P.neck)); hn.addPath(T(P.head));
  rimFill(g, hn, { fill: '#050506', ...rimO });
  // inner detail without rims (a rim inside the silhouette draws a face on the back of the head): the ear a shade
  // lighter where the backlight comes through it, the nape hair a shade darker
  g.save(); g.fillStyle = 'rgba(22,14,12,0.6)'; g.fill(T(P.ear)); if (!o.bunny && o.weld == null) { g.fillStyle = '#020202'; g.fill(T(P.nape)); } g.restore();
  if (o.ponytail) { const pt = new Path2D(); pt.moveTo(-f * 0.07, -0.36); pt.bezierCurveTo(-f * 0.13, -0.3, -f * 0.12, -0.14, -f * 0.09, 0.02); pt.bezierCurveTo(-f * 0.07, 0.12, -f * 0.02, 0.14, -f * 0.0, 0.08);
      pt.bezierCurveTo(f * 0.01, -0.06, f * 0.0, -0.24, f * 0.02, -0.36); pt.closePath(); g.save(); g.fillStyle = '#171310'; g.fill(T(pt)); g.restore(); }
  if (o.bunny) { // fab hood: a white hood over the head lit soft by the yellow room; the face opening dark (never lit)
    const hd = new Path2D(); hd.moveTo(-0.28, 0.05); hd.bezierCurveTo(-0.34, -0.3, -0.26, -0.66, 0, -0.68); hd.bezierCurveTo(0.26, -0.66, 0.34, -0.3, 0.28, 0.05); hd.closePath();
    rimFill(g, T(hd), { fill: 'rgb(150,142,112)', ...rimO, w: rimO.w * 1.2 });
    g.save(); g.clip(T(hd)); const hg = g.createLinearGradient(x, y - 0.7 * s, x, y); hg.addColorStop(0, 'rgba(255,240,190,0.35)'); hg.addColorStop(1, 'rgba(0,0,0,0.25)'); g.fillStyle = hg; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(80,70,40,0.5)'; g.lineWidth = 0.012 * s; for (const k of [-1, 1]) { g.beginPath(); g.moveTo(x + k * 0.22 * s, y - 0.5 * s); g.quadraticCurveTo(x + k * 0.3 * s, y - 0.2 * s, x + k * 0.2 * s, y + 0.02 * s); g.stroke(); } g.restore();
    const fo = new Path2D(); fo.ellipse(0, -0.33, 0.14, 0.18, 0, 0, TAU); g.save(); g.fillStyle = '#060504'; g.fill(T(fo)); g.restore(); }
  if (o.weld != null) { // welding hood: a shell over the head that pivots at the ear; 0 up (on the crown), 1 down (over the face)
    const a = lerp(-1.25, 0, o.weld);
    const wh = new Path2D(); wh.moveTo(-f * 0.22, -0.2); wh.bezierCurveTo(-f * 0.26, -0.5, f * 0.0, -0.66, f * 0.2, -0.58); wh.lineTo(f * 0.3, -0.2); wh.bezierCurveTo(f * 0.3, -0.02, f * 0.18, 0.06, f * 0.02, 0.05); wh.lineTo(-f * 0.2, -0.06); wh.closePath();
    const M = new Path2D(); M.addPath(wh, new DOMMatrix().translate(x, y + -0.3 * s).rotate(f * a * 57.3).translate(0, 0.3 * s).scale(s));
    rimFill(g, M, { fill: 'rgb(38,26,18)', ...rimO, w: rimO.w * 1.1 });
    const lens = new Path2D(); lens.rect(f > 0 ? 0.2 : -0.3, -0.36, 0.1, 0.1);
    const LM = new Path2D(); LM.addPath(lens, new DOMMatrix().translate(x, y + -0.3 * s).rotate(f * a * 57.3).translate(0, 0.3 * s).scale(s));
    g.save(); g.fillStyle = `rgba(60,255,120,${0.35 + 0.6 * (o.arcK || 0)})`; g.shadowColor = 'rgba(80,255,140,0.9)'; g.shadowBlur = 30 * (o.arcK || 0); g.fill(LM); g.restore();
    g.save(); g.clip(M); g.globalCompositeOperation = 'lighter'; const hl = g.createLinearGradient(x, y - 0.6 * s, x + f * 0.3 * s, y); hl.addColorStop(0, 'rgba(0,0,0,0)'); hl.addColorStop(1, `rgba(120,160,255,${0.25 * (o.arcK || 0)})`); g.fillStyle = hl; g.fillRect(0, 0, W, H); g.restore();
  }
  if (o.hat) {
    const hc = HAT[o.hat], hp = T(P.hat);
    g.save(); const gr = g.createLinearGradient(x - f * 0.3 * s, y - 0.7 * s, x + f * 0.3 * s, y - 0.38 * s);
    gr.addColorStop(0, rgba(hc.map(v => v * 0.05))); gr.addColorStop(1, rgba(hc.map(v => v * 0.2))); g.fillStyle = gr; g.fill(hp); g.restore();
    rimFill(g, hp, { fill: 'rgba(0,0,0,0)', rim: rgba(hc.map(v => Math.min(255, v * 1.1 + 40))), dir: L1.dir, w: L1.w * s / 600 * 1.2, glow: 6, rim2: o.light2?.col, dir2: o.light2?.dir, w2: 5 * s / 600 });
    if (o.sticker) { const sx = x - f * 0.06 * s, sy = y - 0.53 * s, ss = 0.14 * s; g.save(); g.translate(sx, sy); g.transform(1, 0, -f * 0.12, 1, 0, 0);
      g.fillStyle = `rgba(230,228,220,${0.18 + 0.6 * (o.stickerLit || 0)})`; g.beginPath(); g.roundRect(-ss * 0.62, -ss * 0.5, ss * 1.24, ss, ss * 0.12); g.fill();
      acpEmblem(g, 0, 0, ss * 0.78, { color: null, alpha: 0.35 + 0.65 * (o.stickerLit || 0) }); g.restore(); }
  }
  if (o.glasses != null) { // safety glasses: on the brim (0) or down over the eyes (1), wrapping toward f
    const gy = lerp(-0.47, -0.33, o.glasses), gx = lerp(0.14, 0.17, o.glasses) * f;
    const gp = new Path2D(); gp.moveTo(x + (gx - f * 0.04) * s, y + gy * s); gp.lineTo(x + (gx + f * 0.07) * s, y + (gy - 0.01) * s); gp.lineTo(x + (gx + f * 0.075) * s, y + (gy + 0.035) * s); gp.lineTo(x + (gx - f * 0.035) * s, y + (gy + 0.04) * s); gp.closePath();
    g.save(); g.fillStyle = 'rgba(40,60,80,0.9)'; g.fill(gp); g.strokeStyle = 'rgba(255,200,140,0.5)'; g.lineWidth = 1.2; g.stroke(gp); g.restore();
    o._lens = [x + (gx + f * 0.02) * s, y + (gy + 0.015) * s, 0.06 * s];
  }
  return o;
}

// ================================================================ the henshin inserts (black void)
// the boot, side view facing left, local units: sole bottom at y=0, toe at x=-1, heel at x=+0.62
const BOOT = (() => {
  const upper = new Path2D();
  upper.moveTo(-1.0, -0.1); upper.bezierCurveTo(-1.02, -0.28, -0.9, -0.36, -0.7, -0.38); upper.bezierCurveTo(-0.5, -0.42, -0.34, -0.5, -0.24, -0.62);
  upper.lineTo(-0.1, -1.18); upper.bezierCurveTo(0.02, -1.22, 0.3, -1.24, 0.46, -1.2); upper.lineTo(0.52, -0.62); upper.bezierCurveTo(0.6, -0.4, 0.64, -0.24, 0.62, -0.1); upper.closePath();
  const sole = new Path2D();
  sole.moveTo(-1.04, -0.12); sole.bezierCurveTo(-1.08, -0.04, -1.02, 0, -0.9, 0); sole.lineTo(0.62, 0); sole.lineTo(0.66, -0.14); sole.lineTo(-1.0, -0.16); sole.closePath();
  const toe = new Path2D(); toe.moveTo(-1.02, -0.13); toe.bezierCurveTo(-1.02, -0.32, -0.86, -0.37, -0.66, -0.38); toe.lineTo(-0.62, -0.14); toe.closePath();
  const hooks = []; for (let i = 0; i < 6; i++) { const u = i / 5; hooks.push([lerp(-0.32, -0.1, u) + 0.04, lerp(-0.56, -1.12, u)]); }
  const hooksB = hooks.map(([hx, hy]) => [hx + 0.24, hy + 0.02]);
  return { upper, sole, toe, hooks, hooksB };
})();
function drawGrating(g, vx, vy, y0, k = 1, light = [900, 1500]) {
  // bar grating receding to (vx, vy): bearing bars toward the vanishing point + cross rods, lit from the right
  g.save();
  const floor = g.createLinearGradient(0, y0, 0, H); floor.addColorStop(0, '#060505'); floor.addColorStop(1, '#0d0b09'); g.fillStyle = floor; g.fillRect(0, y0, W, H - y0);
  for (let i = -40; i <= 40; i++) {
    const xb = vx + i * 70; const a = [vx + (xb - vx) * 0.02, y0], b = [xb, H + 200];
    const d = Math.hypot(b[0] - light[0], H - light[1]); const lit = Math.max(0, 1 - d / 1300) * k;
    g.strokeStyle = `rgba(${Math.round(40 + 200 * lit)},${Math.round(30 + 120 * lit)},${Math.round(20 + 50 * lit)},${0.55 + 0.4 * lit})`; g.lineWidth = 3 + 5 * lit;
    g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke();
  }
  for (let j = 0; j < 22; j++) { const u = Math.pow(j / 22, 2.2), y = lerp(y0 + 2, H + 50, u); g.strokeStyle = `rgba(90,60,35,${0.25 + 0.4 * u})`; g.lineWidth = 1 + 3 * u; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  const pool = g.createRadialGradient(light[0], light[1], 10, light[0], light[1], 700); pool.addColorStop(0, 'rgba(255,150,60,0.28)'); pool.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalCompositeOperation = 'lighter'; g.fillStyle = pool; g.fillRect(0, y0, W, H - y0);
  g.restore();
}
function drawBoot(g, x, y, s, beat, { laceU = 1, seamU = 0, lit = 1 } = {}) {
  const T = p => xf(p, x, y, s);
  // leather upper: dark brown with the sodium rim from behind-right and a cold edge from the left
  rimFill(g, T(BOOT.upper), { fill: '#1b120b', rim: 'rgba(255,160,70,0.95)', dir: [0.85, -0.5], w: 9, glow: 8, rim2: 'rgba(110,140,200,0.55)', dir2: [-0.9, -0.3], w2: 5, alpha: lit });
  g.save(); g.clip(T(BOOT.upper));
  const lg = g.createRadialGradient(x + 0.5 * s, y - 0.9 * s, 0.05 * s, x + 0.2 * s, y - 0.5 * s, 1.3 * s); lg.addColorStop(0, 'rgba(150,92,46,0.55)'); lg.addColorStop(0.5, 'rgba(70,42,22,0.35)'); lg.addColorStop(1, 'rgba(0,0,0,0.5)'); g.fillStyle = lg; g.fillRect(x - 1.2 * s, y - 1.3 * s, 2 * s, 1.4 * s);
  const r = rng(11); g.globalCompositeOperation = 'lighter'; for (let i = 0; i < 90; i++) { const px = x + lerp(-0.9, 0.55, r()) * s, py = y - lerp(0.15, 1.15, r()) * s; g.fillStyle = `rgba(255,180,110,${0.03 + 0.05 * r()})`; g.beginPath(); g.ellipse(px, py, 0.05 * s * r() + 2, 0.012 * s + 1, r() * 3, 0, TAU); g.fill(); } g.globalCompositeOperation = 'source-over';
  // stitch lines + creases
  g.strokeStyle = 'rgba(255,190,120,0.18)'; g.lineWidth = 1.5; g.setLineDash([5, 5]);
  g.beginPath(); g.moveTo(x - 0.95 * s, y - 0.2 * s); g.bezierCurveTo(x - 0.7 * s, y - 0.28 * s, x - 0.4 * s, y - 0.36 * s, x - 0.2 * s, y - 0.5 * s); g.stroke();
  g.beginPath(); g.moveTo(x + 0.55 * s, y - 0.2 * s); g.bezierCurveTo(x + 0.3 * s, y - 0.25 * s, x, y - 0.3 * s, x - 0.3 * s, y - 0.32 * s); g.stroke(); g.setLineDash([]);
  g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 3; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(x - (0.58 - i * 0.05) * s, y - (0.3 + i * 0.02) * s); g.quadraticCurveTo(x - (0.5 - i * 0.05) * s, y - (0.42 + i * 0.03) * s, x - (0.36 - i * 0.04) * s, y - (0.44 + i * 0.05) * s); g.stroke(); }
  g.restore();
  // the work trouser (duck canvas) stacked over the boot's collar: the boot is on a leg, the man is out of frame
  { const pl = new Path2D(); pl.moveTo(-0.16, -1.17); pl.bezierCurveTo(-0.08, -1.13, 0.02, -1.2, 0.14, -1.15); pl.bezierCurveTo(0.28, -1.1, 0.42, -1.18, 0.6, -1.12);
    pl.lineTo(0.66, -3.2); pl.lineTo(-0.1, -3.2); pl.closePath();
    const P2d = T(pl); rimFill(g, P2d, { fill: '#17140f', rim: 'rgba(255,160,70,0.9)', dir: [0.85, -0.5], w: 8, glow: 6, rim2: 'rgba(110,140,200,0.5)', dir2: [-0.9, -0.3], w2: 4, alpha: lit });
    g.save(); g.clip(P2d); g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 0.02 * s; g.lineCap = 'round';
    for (const [a, b, c2, d] of [[-0.08, -1.3, 0.3, -1.46], [0.05, -1.6, 0.55, -1.4], [-0.05, -1.9, 0.4, -1.75]]) { g.beginPath(); g.moveTo(x + a * s, y + b * s); g.quadraticCurveTo(x + (a + c2) / 2 * s, y + (b + d) / 2 * s - 0.08 * s, x + c2 * s, y + d * s); g.stroke(); }
    g.globalCompositeOperation = 'lighter'; g.strokeStyle = 'rgba(255,170,90,0.14)'; g.lineWidth = 0.012 * s;
    for (const [a, b, c2, d] of [[-0.06, -1.33, 0.28, -1.49], [0.07, -1.63, 0.53, -1.43]]) { g.beginPath(); g.moveTo(x + a * s, y + b * s); g.quadraticCurveTo(x + (a + c2) / 2 * s, y + (b + d) / 2 * s - 0.08 * s, x + c2 * s, y + d * s); g.stroke(); }
    g.restore(); }
  rimFill(g, T(BOOT.toe), { fill: '#120c08', rim: 'rgba(255,180,90,0.7)', dir: [0.2, -1], w: 5, alpha: lit });
  rimFill(g, T(BOOT.sole), { fill: '#070707', rim: 'rgba(255,140,60,0.8)', dir: [0.9, -0.3], w: 4, alpha: lit });
  g.save(); g.fillStyle = 'rgba(0,0,0,0.9)'; for (let i = 0; i < 14; i++) { const lx = x + lerp(-0.95, 0.6, i / 13) * s; g.fillRect(lx, y - 0.05 * s, 0.05 * s, 0.05 * s); } g.restore();
  // laces: criss-cross between the hook rows; slack -> taut with laceU
  const hk = BOOT.hooks.map(([a, b]) => [x + a * s, y + b * s]), hb = BOOT.hooksB.map(([a, b]) => [x + a * s, y + b * s]);
  const pts = [];
  g.save(); g.lineWidth = 0.028 * s; g.lineCap = 'round';
  for (let i = 0; i < hk.length - 1; i++) {
    for (const [a, b] of [[hk[i], hb[i + 1]], [hb[i], hk[i + 1]]]) {
      const sag = (1 - laceU) * 0.08 * s; const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 + sag;
      g.strokeStyle = '#2a1c10'; g.beginPath(); g.moveTo(...a); g.quadraticCurveTo(mx, my, ...b); g.stroke();
      g.strokeStyle = 'rgba(255,180,100,0.35)'; g.lineWidth = 0.01 * s; g.beginPath(); g.moveTo(a[0], a[1] - 2); g.quadraticCurveTo(mx, my - 2, b[0], b[1] - 2); g.stroke(); g.lineWidth = 0.028 * s;
      pts.push(a, b);
    }
  }
  // the loose ends yanked up out of frame
  const top = hk[hk.length - 1]; g.strokeStyle = '#2a1c10'; g.beginPath(); g.moveTo(...top); g.lineTo(top[0] + 0.05 * s, top[1] - lerp(0.25, 1.2, laceU) * s); g.stroke();
  g.restore();
  for (const p of [...hk, ...hb]) { g.save(); g.fillStyle = '#6a6a70'; g.beginPath(); g.arc(p[0], p[1], 0.022 * s, 0, TAU); g.fill(); g.globalCompositeOperation = 'lighter'; glowDot(g, p[0] + 2, p[1] - 2, 0.03 * s, [255, 190, 120], 0.6 * lit); g.restore(); }
  if (seamU > 0) seam(g, pts, seamU, { w: 0.02 * s, lit: 0.85, col: [255, 230, 190] });
}
function drawGlove(g, x, y, s, { snap = 0, seamU = 0, clench = 1 } = {}) {
  // a clenched fist in a leather work glove, knuckles up-left, the cuff and its wrist strap
  const fist = new Path2D();
  // the knuckle ridge on top, then the four curled fingers stacked down the front (each its own bump), the heel of the palm
  fist.moveTo(0.36, -0.52); fist.bezierCurveTo(0.2, -0.64, 0.06, -0.62, -0.04, -0.66); fist.bezierCurveTo(-0.14, -0.7, -0.24, -0.64, -0.34, -0.66);
  fist.bezierCurveTo(-0.5, -0.68, -0.62, -0.6, -0.6, -0.5);
  for (let i = 0; i < 4; i++) { const y0 = -0.5 + i * 0.19, y1 = y0 + 0.19, bx = -0.68 + i * 0.015; fist.bezierCurveTo(bx, y0 + 0.01, bx - 0.01, y1 - 0.02, -0.6 + i * 0.02, y1); }
  fist.bezierCurveTo(-0.56, 0.3, -0.44, 0.34, -0.3, 0.34); fist.lineTo(0.48, 0.3); fist.lineTo(0.46, -0.1); fist.bezierCurveTo(0.5, -0.3, 0.46, -0.44, 0.36, -0.52); fist.closePath();
  const thumb = new Path2D(); thumb.moveTo(0.3, 0.3); thumb.bezierCurveTo(0.1, 0.1, -0.2, -0.06, -0.42, -0.1); thumb.bezierCurveTo(-0.52, -0.1, -0.54, 0.04, -0.44, 0.08); thumb.bezierCurveTo(-0.2, 0.16, 0.0, 0.32, 0.1, 0.36); thumb.closePath();
  const cuff = new Path2D(); cuff.moveTo(0.4, -0.38); cuff.lineTo(1.2, -0.46); cuff.lineTo(1.25, 0.46); cuff.lineTo(0.44, 0.36); cuff.closePath();
  const strap = new Path2D(); strap.moveTo(0.46, -0.4); strap.lineTo(0.62, -0.42); strap.lineTo(0.66, 0.38); strap.lineTo(0.5, 0.37); strap.closePath();
  const T = p => xf(p, x, y, s);
  rimFill(g, T(cuff), { fill: '#3a2614', rim: 'rgba(255,170,80,0.8)', dir: [0.2, -1], w: 7, glow: 6 });
  rimFill(g, T(fist), { fill: '#4a3018', rim: 'rgba(255,175,85,0.95)', dir: [-0.5, -0.9], w: 10, glow: 8, rim2: 'rgba(120,150,210,0.5)', dir2: [0.9, 0.3], w2: 5 });
  { const hg = g.createRadialGradient(x - 0.3 * s, y - 0.5 * s, 0.02 * s, x - 0.1 * s, y - 0.2 * s, 0.8 * s); hg.addColorStop(0, 'rgba(230,170,100,0.55)'); hg.addColorStop(1, 'rgba(0,0,0,0.4)'); g.save(); g.clip(T(fist)); g.fillStyle = hg; g.fillRect(0, 0, W, H); g.restore(); }
  g.save(); g.clip(T(fist)); g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 0.02 * s;
  for (let i = 1; i < 4; i++) { const yy = y + (-0.5 + i * 0.19) * s; g.beginPath(); g.moveTo(x - 0.7 * s, yy); g.bezierCurveTo(x - 0.5 * s, yy - 0.03 * s, x - 0.3 * s, yy - 0.05 * s, x - 0.1 * s, yy - 0.02 * s); g.stroke(); }
  // knuckle creases on the ridge and the seam of the leather palm patch
  for (let i = 0; i < 4; i++) { const kx = x + (-0.46 + i * 0.2) * s, ky = y + (-0.64 + i * 0.02) * s; g.beginPath(); g.moveTo(kx - 0.05 * s, ky + 0.06 * s); g.quadraticCurveTo(kx, ky + 0.02 * s, kx + 0.05 * s, ky + 0.06 * s); g.stroke(); }
  g.strokeStyle = 'rgba(255,200,130,0.28)'; g.setLineDash([4, 5]); g.lineWidth = 1.4; g.beginPath(); g.moveTo(x - 0.5 * s, y - 0.62 * s); g.bezierCurveTo(x - 0.1 * s, y - 0.66 * s, x + 0.3 * s, y - 0.55 * s, x + 0.42 * s, y - 0.3 * s); g.stroke(); g.setLineDash([]);
  g.restore();
  rimFill(g, T(thumb), { fill: '#5a3a1e', rim: 'rgba(255,175,85,0.8)', dir: [-0.5, -0.9], w: 6 });
  g.save(); g.globalCompositeOperation = 'lighter'; for (let i = 0; i < 4; i++) glowDot(g, x + (-0.5 + i * 0.07) * s, y + (-0.56 + i * 0.03) * s, 0.06 * s, [255, 170, 90], 0.25); g.restore();
  // the strap: flips shut on the snap
  const so = (1 - snap) * 0.35 * s; g.save(); g.translate(so * 0.5, -so); rimFill(g, T(strap), { fill: '#0f0b08', rim: 'rgba(255,190,110,0.9)', dir: [0.3, -1], w: 5 }); g.restore();
  if (seamU > 0) seam(g, [[x + 0.44 * s, y - 0.38 * s], [x + 0.62 * s, y - 0.42 * s], [x + 1.2 * s, y - 0.46 * s]], seamU, { w: 0.03 * s, lit: 0.9 });
}
// the hard hat macro: 3/4 side, facing left. local: brim line at y=0, width ~2 units
function drawHatMacro(g, x, y, s, { col = HAT.white, lit = 1, glint = -1, stickerK = 1, slam = 0 } = {}) {
  const dome = new Path2D();
  dome.moveTo(-1.02, 0.02); dome.bezierCurveTo(-1.1, -0.7, -0.5, -1.18, 0.12, -1.12); dome.bezierCurveTo(0.72, -1.06, 1.04, -0.6, 0.98, 0.02); dome.closePath();
  const peak = new Path2D(); peak.moveTo(-0.96, -0.06); peak.bezierCurveTo(-1.2, -0.02, -1.42, 0.08, -1.5, 0.16); peak.lineTo(-1.46, 0.2); peak.bezierCurveTo(-1.3, 0.14, -1.1, 0.12, -0.9, 0.1); peak.closePath();
  const rim = new Path2D(); rim.moveTo(-1.02, 0.0); rim.lineTo(1.0, 0.0); rim.bezierCurveTo(1.06, 0.03, 1.08, 0.08, 1.06, 0.12); rim.lineTo(-0.96, 0.12); rim.closePath();
  const ridge = new Path2D(); ridge.moveTo(-0.8, -0.72); ridge.bezierCurveTo(-0.5, -1.14, 0.3, -1.22, 0.7, -0.86); ridge.lineTo(0.66, -0.8); ridge.bezierCurveTo(0.3, -1.12, -0.46, -1.06, -0.74, -0.68); ridge.closePath();
  const T = p => xf(p, x, y, s / 1);
  // the head under it (black), the suspension band dark in the rim's shadow
  const head = new Path2D(); head.ellipse(0, 0.35, 0.78, 0.5, 0, Math.PI, TAU); rimFill(g, T(head), { fill: '#030303' });
  g.save(); const gr = g.createRadialGradient(x - 0.4 * s, y - 0.9 * s, 0.05 * s, x, y - 0.4 * s, 1.3 * s);
  gr.addColorStop(0, rgba(col.map(v => v * 0.95 * lit))); gr.addColorStop(0.45, rgba(col.map(v => v * 0.55 * lit))); gr.addColorStop(1, rgba(col.map(v => v * 0.1 * lit)));
  for (const p of [dome, peak]) { g.fillStyle = gr; g.fill(T(p)); }
  g.fillStyle = rgba(col.map(v => v * 0.22 * lit)); g.fill(T(rim));
  g.fillStyle = rgba(col.map(v => v * 0.35 * lit)); g.fill(T(ridge));
  g.strokeStyle = rgba(col.map(v => Math.min(255, v * 1.05 * lit)), 0.7); g.lineWidth = 2; g.stroke(T(ridge));
  g.restore();
  rimFill(g, T(dome), { fill: 'rgba(0,0,0,0)', rim: 'rgba(255,190,110,0.9)', dir: [0.8, -0.3], w: 0.03 * s, glow: 8, alpha: lit });
  rimFill(g, T(peak), { fill: 'rgba(0,0,0,0)', rim: 'rgba(255,220,170,0.9)', dir: [0, -1], w: 0.02 * s, alpha: lit });
  // the sticker on the side: a die-cut white vinyl decal, the four-stripe ACP mark in its own red
  if (stickerK > 0) {
    g.save(); g.clip(T(dome)); g.translate(x + 0.2 * s, y - 0.5 * s); g.transform(0.92, -0.08, 0.1, 1, 0, 0);
    const ss = 0.72 * s; g.globalAlpha = stickerK;
    g.fillStyle = `rgba(245,242,236,${lit})`; g.beginPath(); g.roundRect(-ss * 0.62, -ss * 0.42, ss * 1.24, ss * 0.84, ss * 0.1); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2; g.stroke();
    acpEmblem(g, 0, 0, ss * 0.66, { color: null, alpha: lit });
    g.restore();
  }
  // the glint: a specular band wiping across the shell (glint = 0..1 progress)
  if (glint >= 0 && glint <= 1) { g.save(); g.clip(T(dome)); g.globalCompositeOperation = 'lighter'; const gx = x + lerp(-1.3, 1.3, glint) * s;
    const lg = g.createLinearGradient(gx - 0.2 * s, 0, gx + 0.2 * s, 0); lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,250,235,0.85)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg; g.fillRect(gx - 0.3 * s, y - 1.3 * s, 0.6 * s, 1.5 * s); g.restore(); }
  return { dome: T(dome) };
}

// ================================================================ the plant gate at 5 a.m. (the crowd's back(): sky, works, floods, gate)
const PLANT = {
  mill: { stacks: [[150, 60, 520], [260, 44, 460], [820, 70, 560], [930, 40, 480]], tanks: [[360, 150, 200], [640, 190, 240]], sky: ['#03050b', '#101a33', '#39406a'], sodium: [255, 160, 70] },
  port: { cranes: true, stacks: [[980, 30, 380]], tanks: [[120, 200, 150]], sky: ['#02040a', '#0d1a30', '#2c4a70'], sodium: [255, 170, 80] },
  fab: { fab: true, stacks: [[180, 30, 300], [900, 30, 300]], tanks: [], sky: ['#02030a', '#121430', '#3a3060'], sodium: [255, 214, 120] },
  rail: { rail: true, stacks: [[700, 50, 420]], tanks: [[240, 260, 180]], sky: ['#03040a', '#141a2c', '#46405a'], sodium: [255, 150, 60] },
  grain: { grain: true, stacks: [], tanks: [], sky: ['#03050b', '#131c34', '#4a4a6a'], sodium: [255, 170, 80] },
};
// the gate's LED board: amber dot-matrix type on black. board = { small, big, on 0..1, glitch 0..1 }; glitch drops characters, on=0 is dark
function ledBoard(g, cx, cy, w, h, bd, t) {
  const on = bd.on ?? 1; g.save(); g.translate(cx, cy);
  g.fillStyle = '#050506'; g.fillRect(-w / 2, -h / 2, w, h); g.strokeStyle = 'rgba(70,60,50,0.9)'; g.lineWidth = Math.max(2, w / 150); g.strokeRect(-w / 2, -h / 2, w, h);
  g.textBaseline = 'middle';
  const drawLine = (str, y, size, k) => { g.font = `900 ${size}px Shoulders`; const cw = []; let tw = 0; for (const ch of str) { const m = g.measureText(ch).width + size * 0.05; cw.push(m); tw += m; }
    let x = -tw / 2; let i = 0; const fr = Math.floor(t * 18);
    for (const ch of str) { const alive = hash(i * 7.3 + fr * 1.7 + (bd.seed || 0)) >= (bd.glitch || 0) ? 1 : 0; g.fillStyle = `rgba(255,${Math.round(150 + 30 * hash(i))},40,${on * alive * k})`;
      g.textAlign = 'left'; g.shadowColor = `rgba(255,140,30,${0.9 * on * alive})`; g.shadowBlur = size * 0.35; g.fillText(ch, x, y); x += cw[i]; i++; } g.shadowBlur = 0; };
  if (bd.small) drawLine(bd.small, -h * 0.28, h * 0.22, 0.75);
  drawLine(bd.big, bd.small ? h * 0.12 : 0, h * (bd.small ? 0.46 : 0.6), 1);
  g.restore();
}
function drawWorks(g, Wd, Hd, kind, horizonY, t, { flood = 1, strobe = 0, beams = 1, dawn = 0, board = null } = {}) {
  const K = PLANT[kind], sc = Wd / W;
  const sky = g.createLinearGradient(0, 0, 0, horizonY); sky.addColorStop(0, K.sky[0]); sky.addColorStop(0.7, K.sky[1]); sky.addColorStop(1, K.sky[2]);
  g.fillStyle = sky; g.fillRect(0, 0, Wd, horizonY + 2);
  if (dawn > 0) {          // the light that moves: the navy lifts to a cold grey and a low pale gold band, never a sun disc
    const dg = g.createLinearGradient(0, horizonY - 900 * (Wd / W), 0, horizonY); dg.addColorStop(0, rgba([110, 140, 190], 0.0)); dg.addColorStop(0.55, rgba([120, 150, 190], 0.32 * dawn)); dg.addColorStop(1, rgba([236, 200, 150], 0.62 * dawn));
    g.fillStyle = dg; g.fillRect(0, horizonY - 900 * (Wd / W), Wd, 900 * (Wd / W) + 2);
  }
  // the first blue edge at the horizon + sodium haze from the works
  const hz = g.createLinearGradient(0, horizonY - 420 * sc, 0, horizonY); hz.addColorStop(0, 'rgba(0,0,0,0)'); hz.addColorStop(1, rgba(K.sodium, 0.35 * flood)); g.fillStyle = hz; g.fillRect(0, horizonY - 420 * sc, Wd, 420 * sc);
  g.fillStyle = '#05060a';
  const base = horizonY;
  for (const [sx, sw, sh] of K.stacks) { g.fillRect(sx * sc, base - sh * sc, sw * sc, sh * sc); g.fillRect((sx - 6) * sc, base - sh * sc, (sw + 12) * sc, 12 * sc); }
  for (const [tx, tw, th] of K.tanks) { g.beginPath(); g.roundRect(tx * sc, base - th * sc, tw * sc, th * sc, [tw * 0.3 * sc, tw * 0.3 * sc, 0, 0]); g.fill(); }
  // pipe racks and the long shed
  g.fillRect(0, base - 150 * sc, Wd, 150 * sc);
  for (let i = 0; i < 18; i++) g.fillRect((i * 64 + 10) * sc, base - 200 * sc, 6 * sc, 60 * sc);
  g.fillRect(0, base - 205 * sc, Wd, 8 * sc);
  if (K.cranes) for (const cx of [180, 560, 900]) { g.fillRect(cx * sc, base - 520 * sc, 14 * sc, 520 * sc); g.fillRect((cx + 90) * sc, base - 520 * sc, 14 * sc, 520 * sc); g.fillRect((cx - 120) * sc, base - 540 * sc, 360 * sc, 22 * sc); g.fillRect((cx + 30) * sc, base - 640 * sc, 12 * sc, 110 * sc); }
  if (K.fab) { g.fillRect(60 * sc, base - 330 * sc, 960 * sc, 330 * sc); for (let i = 0; i < 12; i++) { g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = 'rgba(255,214,120,0.18)'; g.fillRect((100 + i * 76) * sc, base - 280 * sc, 40 * sc, 18 * sc); g.restore(); } }
  if (K.rail) { for (let i = 0; i < 9; i++) { g.fillRect((i * 128) * sc, base - 90 * sc, 118 * sc, 60 * sc); } g.fillRect(0, base - 260 * sc, Wd, 10 * sc); }
  if (K.grain) { for (let i = 0; i < 7; i++) { g.fillRect((200 + i * 96) * sc, base - 460 * sc, 86 * sc, 460 * sc); } g.fillRect(170 * sc, base - 560 * sc, 720 * sc, 110 * sc); g.fillRect(830 * sc, base - 700 * sc, 90 * sc, 700 * sc); }
  // each works' own signature light, so four gates read as four places at grid size (port, fab, rail, mill, grain)
  g.save(); g.globalCompositeOperation = 'lighter';
  const blink = (0.5 + 0.5 * Math.sin(t * 5.2)) > 0.35 ? 1 : 0.25;
  if (K.cranes) {                                     // ship-to-shore cranes: red beacons on the booms, stacked boxes lit by the apron
    for (const cx of [180, 560, 900]) { glowDot(g, (cx - 120) * sc, base - 540 * sc, 60 * sc, [255, 40, 30], 0.9 * blink); glowDot(g, (cx + 240) * sc, base - 540 * sc, 60 * sc, [255, 40, 30], 0.9 * blink); glowDot(g, (cx + 36) * sc, base - 640 * sc, 50 * sc, [255, 40, 30], blink); }
    const box = [[180, 60, 40], [40, 90, 170], [200, 120, 30], [30, 110, 80], [150, 40, 40]];
    g.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 16; i++) for (let j = 0; j < 3; j++) { const c = box[(i * 3 + j * 7) % 5]; g.fillStyle = rgba(c.map(v => v * 0.55)); g.fillRect((i * 68 + 4) * sc, base - (150 + (j + 1) * 36) * sc, 64 * sc, 33 * sc); }
    g.globalCompositeOperation = 'lighter';
  }
  if (K.fab) {                                        // the fab: a long cool-white window band, the clean room lit all night
    const wb = g.createLinearGradient(0, base - 300 * sc, 0, base - 250 * sc); wb.addColorStop(0, 'rgba(200,230,255,0)'); wb.addColorStop(0.5, 'rgba(210,235,255,0.95)'); wb.addColorStop(1, 'rgba(200,230,255,0)');
    g.fillStyle = wb; g.fillRect(60 * sc, base - 300 * sc, 960 * sc, 50 * sc); g.fillRect(60 * sc, base - 220 * sc, 960 * sc, 34 * sc);
    for (let i = 0; i < 3; i++) glowDot(g, (240 + i * 300) * sc, base - 275 * sc, 220 * sc, [170, 210, 255], 0.35);
  }
  if (K.rail) {                                       // a road switcher's headlight and ditch lights, the signal mast green
    glowDot(g, 520 * sc, base - 150 * sc, 380 * sc, [255, 244, 210], 1); glowDot(g, 470 * sc, base - 70 * sc, 90 * sc, [255, 236, 190], 0.8); glowDot(g, 570 * sc, base - 70 * sc, 90 * sc, [255, 236, 190], 0.8);
    glowDot(g, 900 * sc, base - 300 * sc, 110 * sc, [40, 255, 120], 1); glowDot(g, 150 * sc, base - 300 * sc, 110 * sc, [40, 255, 120], 1); glowDot(g, 900 * sc, base - 270 * sc, 40 * sc, [255, 40, 30], 0.35);
  }
  if (K.stacks.length >= 4) {                         // the mill: the furnace flare off the tallest stack
    const [sx, sw, sh] = K.stacks[2], fx = (sx + sw / 2) * sc, fy = base - sh * sc;
    glowDot(g, fx, fy - 30 * sc, 260 * sc, [255, 120, 30], 0.75 + 0.2 * Math.sin(t * 13)); glowDot(g, fx, fy - 10 * sc, 90 * sc, [255, 210, 120], 0.9);
  }
  if (K.grain) { const gw = g.createLinearGradient(0, base - 700 * sc, 0, base); gw.addColorStop(0, 'rgba(255,170,80,0)'); gw.addColorStop(1, 'rgba(255,170,80,0.3)'); g.fillStyle = gw; g.fillRect(170 * sc, base - 700 * sc, 750 * sc, 700 * sc); }
  g.restore();
  // steam from the stacks lit from below
  g.save(); g.globalCompositeOperation = 'lighter';
  for (const [sx, sw, sh] of K.stacks) for (let k = 0; k < 5; k++) { const yy = base - sh * sc - (k * 60 + ((t * 30) % 60)) * sc, xx = (sx + sw / 2 + Math.sin(k + t * 0.5) * 20 + k * 14) * sc;
    const pr = g.createRadialGradient(xx, yy, 0, xx, yy, (60 + k * 30) * sc); pr.addColorStop(0, rgba(K.sodium, 0.08 * flood)); pr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = pr; g.fillRect(xx - 200 * sc, yy - 200 * sc, 400 * sc, 400 * sc); }
  g.restore();
  // the flood towers: light heads glaring at the lens, beams down onto the yard through the haze
  const towers = [[110, base - 430 * sc], [970, base - 470 * sc], [540, base - 560 * sc]];
  g.save(); g.fillStyle = '#040406'; for (const [tx, ty] of towers) g.fillRect(tx * sc - 3 * sc, ty, 7 * sc, base - ty); g.restore();
  g.save(); g.globalCompositeOperation = 'lighter';
  for (const [tx, ty] of towers) {
    const X = tx * sc;
    if (beams) { const bg = g.createLinearGradient(X, ty, X, Hd); bg.addColorStop(0, rgba(K.sodium, 0.22 * flood)); bg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = bg;
      g.beginPath(); g.moveTo(X - 30 * sc, ty); g.lineTo(X + 30 * sc, ty); g.lineTo(X + 520 * sc, Hd); g.lineTo(X - 520 * sc, Hd); g.closePath(); g.fill(); }
    for (let i = 0; i < 6; i++) { const lx = X + (i % 3 - 1) * 26 * sc, ly = ty + Math.floor(i / 3) * 22 * sc; glowDot(g, lx, ly, 70 * sc * (1 + strobe), [255, 236, 200], 0.9 * flood); glowDot(g, lx, ly, 260 * sc, K.sodium, 0.25 * flood); }
  }
  g.restore();
  // the gate: two posts and the overhead beam, open; the crowd comes out through it
  g.save(); g.fillStyle = '#030304';
  const gx0 = 330 * sc, gx1 = 750 * sc, gy = base - 360 * sc;
  g.fillRect(gx0 - 26 * sc, gy, 30 * sc, base - gy + 4); g.fillRect(gx1 - 4 * sc, gy, 30 * sc, base - gy + 4); g.fillRect(gx0 - 40 * sc, gy - 30 * sc, gx1 - gx0 + 80 * sc, 34 * sc);
  // the chain-link leaves swung open, lit through
  g.strokeStyle = rgba(K.sodium, 0.18); g.lineWidth = 1;
  for (const [x0, x1] of [[gx0 - 250 * sc, gx0 - 26 * sc], [gx1 + 26 * sc, gx1 + 250 * sc]]) { g.strokeRect(x0, gy + 40 * sc, x1 - x0, base - gy - 40 * sc); for (let x = x0; x < x1; x += 10 * sc) { g.beginPath(); g.moveTo(x, gy + 40 * sc); g.lineTo(x + 30 * sc, base); g.stroke(); } }
  if (board) ledBoard(g, (gx0 + gx1) / 2, gy - 64 * sc, 470 * sc, 112 * sc, board, t);
  // lamps on the beam
  g.globalCompositeOperation = 'lighter'; for (let i = 0; i < 4; i++) glowDot(g, gx0 + (i + 0.5) * (gx1 - gx0) / 4, gy + 8 * sc, 90 * sc, [255, 190, 110], 0.8 * flood);
  g.restore();
}

// ================================================================ the crowd: ranks + hi-vis overlay (vest tape, hat colour)
const NIGHT = { ink: ['#040406', '#0a0b10', '#16161c', '#262326', '#3a3230'], rim: '#ffb056', rimAmt: [1.0, 0.9, 0.7, 0.45, 0.3], key: '#ffb056', keyAmt: [0.05, 0.05, 0.04, 0.02, 0],
  acc: '#020203', accAmt: [0.5, 0.45, 0.3, 0.1, 0], shadow: '#020203', shadowA: 0.8, ground: ['#2a1c12', '#050507'], dust: '#ff9a40', flag: '#b0140e', flagDark: '#5a0806', emblem: '#ffcf70' };
const HATCYCLE = ['white', 'yellow', 'orange', 'blue', 'yellow', 'white', 'green', 'brown', 'orange', 'white'];
function designCrowd(Rk, seed, ranks) {
  const crowd = Rk.design({ seed, ranks });
  for (const Rr of crowd.ranks) for (const fg of Rr.figs) { fg.vest = hash(fg.seed * 997) < 0.55 ? 'lime' : 'orange'; fg.hat = HATCYCLE[Math.floor(hash(fg.seed * 131) * HATCYCLE.length)]; fg.noVest = hash(fg.seed * 71) < 0.12; }
  return crowd;
}
// figure -> screen (the same transform ranks.js uses for a cell)
function figBox(Rk, fg, c) { const S = Rk.sil, k = fg.h / (S.types[c.type].h * S.PPM); const fu = c.foot[0], fv = c.foot[1];
  const X = u => fg.flip ? fg.x - (u - fu) * k : fg.x + (u - fu) * k, Y = v => fg.y + (v - fv) * k; return { X, Y, k }; }
const [figT, ftg] = mk(760, 1600);
function hivis(g, Rk, crowd, out, t, { bandK = 0.15, vestK = 0.2, hatK = 0.6, scale = 1 } = {}) {
  // per figure, back to front: its vest, tape and hat colour masked by its own silhouette (atlas coverage), and every
  // nearer figure's silhouette erasing what it hides; nearer ranks erase the whole rank's overlay
  const Wd = Rk.W, Hd = Rk.H, nR = crowd.ranks.length, S = Rk.sil;
  if (!hivis._c || hivis._c.width !== Wd) { hivis._c = document.createElement('canvas'); hivis._c.width = Wd; hivis._c.height = Hd; hivis._g = hivis._c.getContext('2d'); }
  const oc = hivis._c, ogg = hivis._g;
  for (let ri = nR - 1; ri >= 0; ri--) {
    const Rr = crowd.ranks[ri], L = out.layers[ri]; if (!L || !L.figs) continue;
    ogg.globalCompositeOperation = 'source-over'; ogg.clearRect(0, 0, Wd, Hd);
    for (const fg of Rr.figs) {
      const pose = Rk._pose(fg, t); const c = pose.c; if (!c) continue;
      const h = fg.h, x = fg.x, y = fg.y + (pose.dy || 0) * h, sy = pose.sy || 1;
      const k = h / (S.types[c.type].h * S.PPM), w = S.CW * k, hh = S.CH * k * sy, fu = c.foot[0] / S.CW, fv = c.foot[1] / S.CH;
      const dx = fg.flip ? x - (1 - fu) * w : x - fu * w, dy = y - fv * hh;
      if (dx > Wd || dx + w < 0 || dy > Hd || dy + hh < 0 || w > 760 || hh > 1600) continue;
      const cell = gg => { gg.save(); if (fg.flip) { gg.translate(2 * dx + w, 0); gg.scale(-1, 1); } gg.drawImage(S.bitmap, c.x, c.y, S.CW, S.CH, dx, dy, w, hh); gg.restore(); };
      // the silhouette hides what is behind it
      ogg.globalCompositeOperation = 'destination-out'; cell(ogg); ogg.globalCompositeOperation = 'source-over';
      ftg.setTransform(1, 0, 0, 1, 0, 0); ftg.globalCompositeOperation = 'source-over'; ftg.clearRect(0, 0, Math.ceil(w) + 2, Math.ceil(hh) + 2);
      ftg.setTransform(1, 0, 0, 1, -dx, -dy);
      if (!fg.noVest) {
        const vc = HIVIS[fg.vest], tw = 0.14 * h, top = y - 0.8 * h, bot = y - 0.47 * h;
        ftg.fillStyle = rgba(vc, vestK); ftg.fillRect(x - tw, top, 2 * tw, bot - top);
        const bw = Math.max(1, 0.024 * h), kk = Math.min(1, bandK * (0.85 + 0.3 * hash(fg.seed * 53)));
        ftg.fillStyle = `rgba(${Math.round(110 + 145 * kk)},${Math.round(112 + 143 * kk)},${Math.round(118 + 132 * kk)},${0.45 + 0.55 * kk})`;
        ftg.fillRect(x - tw, y - 0.66 * h, 2 * tw, bw); ftg.fillRect(x - tw, y - 0.555 * h, 2 * tw, bw);
        ftg.fillRect(x - tw * 0.55, top, bw * 0.8, 0.14 * h); ftg.fillRect(x + tw * 0.55 - bw * 0.8, top, bw * 0.8, 0.14 * h);
      }
      if (c.head && hatK > 0) { const { X, Y } = figBox(Rk, fg, c); const hx = X(c.head[0]), hy = Y(c.head[1]) - c.head[2] * k * 0.5, hr = c.head[2] * k * 1.15;
        const hc = HAT[fg.hat]; ftg.fillStyle = rgba(hc, hatK); ftg.beginPath(); ftg.ellipse(hx, hy, hr, hr * 0.62, 0, Math.PI, TAU); ftg.fill(); }
      ftg.globalCompositeOperation = 'destination-in'; ftg.setTransform(1, 0, 0, 1, -dx, -dy); cell(ftg);
      ftg.setTransform(1, 0, 0, 1, 0, 0); ftg.globalCompositeOperation = 'source-over';
      ogg.drawImage(figT, 0, 0, Math.ceil(w) + 1, Math.ceil(hh) + 1, dx, dy, Math.ceil(w) + 1, Math.ceil(hh) + 1);
    }
    ogg.globalCompositeOperation = 'destination-out'; for (let j = 0; j < ri; j++) if (out.layers[j]?.figs) ogg.drawImage(out.layers[j].figs, 0, 0);
    ogg.globalCompositeOperation = 'source-over';
    g.save(); g.globalCompositeOperation = 'lighter'; g.drawImage(oc, 0, 0); if (bandK > 0.5) { g.filter = `blur(${3 * scale}px)`; g.globalAlpha = 0.7; g.drawImage(oc, 0, 0); } g.restore();
  }
}

// ---- the crowd designs (px on the 1080 x 1920 frame; far ranks narrow toward the gate mouth)
const HOR = 1160;
const GATE_RANKS = [
  { foot: 1930, h: 640, rows: 1, pack: 0.9, raise: 0, x0: -120, x1: 1200, gaps: 0.2 },
  { foot: 1520, h: 300, rows: 2, pack: 1.0, raise: 0, x0: -60, x1: 1140 },
  { foot: 1330, h: 150, rows: 2, raise: 0, x0: 60, x1: 1020 },
  { foot: 1230, h: 72, rows: 3, raise: 0, x0: 220, x1: 860 },
  { foot: 1178, h: 34, rows: 3, raise: 0, x0: 330, x1: 750, gaps: 0.02 },
];
const POSE_RANKS = [
  { foot: 2040, h: 900, rows: 1, pack: 0.95, raise: 0.7, x0: -180, x1: 1260, gaps: 0.12 },
  { foot: 1660, h: 460, rows: 2, raise: 0.4, x0: -100, x1: 1180 },
  { foot: 1360, h: 180, rows: 2, raise: 0.3, x0: 20, x1: 1060 },
  { foot: 1245, h: 84, rows: 3, raise: 0.25, x0: 180, x1: 900 },
  { foot: 1185, h: 38, rows: 3, raise: 0.15, x0: 320, x1: 760 },
];
const crowdGate = designCrowd(R, 20, GATE_RANKS);
const crowdPose = designCrowd(R, 24, POSE_RANKS);
const crowdStand = designCrowd(R, 31, POSE_RANKS.map(r => ({ ...r, raise: 0 })));      // the same ranks, standing: no pumping wave
const BOARD_SHIFT = () => ({ big: 'SHIFT 05:00' });

// smoke burst behind the pose: soft puffs thrown up from fusees along the gate line, red with the hat colours
function smoke(g, age, Wd = W, Hd = H, sc = 1, base = HOR) {
  if (age < 0) return;
  const r = rng(77), cols = [[190, 14, 12], [170, 10, 10], [210, 24, 18], [230, 90, 20], [120, 180, 30], [190, 14, 12], [40, 80, 190], [180, 12, 12]];
  g.save(); g.globalCompositeOperation = 'screen';
  for (let i = 0; i < 70; i++) {
    const x0 = (120 + r() * 840) * sc, vx = (r() - 0.5) * 220 * sc, vy = -(260 + r() * 520) * sc, col = cols[Math.floor(r() * cols.length)];
    const a = Math.max(0, age - r() * 0.12), k = 1 - Math.exp(-a * 2.2);
    const x = x0 + vx * k, y = base - 40 * sc + vy * k * 0.9, rad = (60 + 260 * k + r() * 80) * sc;
    const al = Math.min(1, a * 8) * (0.3 - 0.18 * k) * (col[0] > 220 || col[1] > 150 ? 0.6 : 1) * (0.45 + 0.55 * Math.exp(-a * 0.5));
    const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, rgba(col, al)); gr.addColorStop(0.6, rgba(col.map(v => v * 0.6), al * 0.5)); gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, 2 * rad, 2 * rad);
  }
  // the fusee heads: hot magenta-red points at the base
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) { const x = (150 + i * 130 + r() * 40) * sc; glowDot(g, x, base - 30 * sc, 60 * sc, [255, 60, 50], Math.min(1, age * 10) * (0.8 + 0.2 * Math.sin(age * 40 + i))); }
  g.restore();
}

// ================================================================ type: retroreflective tape lettering on hi-vis cloth
function tapeWord(g, c, age, left, beat = 0) {
  // rev: the beat each line is lettered onto the cloth (the panel is cut whole; a line not yet lettered is bare cloth)
  const LNs = c.lines || [c.text], vis = LNs.map((_, i) => !c.rev || beat >= c.rev[i]);
  if (c.rev) { const lastB = Math.max(...c.rev.filter(rb => beat >= rb)); age = Math.max(0, (beat - lastB) * SPB); }
  const flare = Math.exp(-age * 9), inA = 1, outA = clamp(left / 0.08);
  let size = c.size; g.font = `900 ${size}px Shoulders`; g.wordSpacing = c.ws ? `${Math.round(c.ws * size)}px` : '0px';
  // lines: a poster stack, each line set to the same measure (the short last line comes out largest)
  const LN = c.lines || [c.text];
  const mw = () => Math.max(...LN.map(l => g.measureText(l).width));
  let tw = mw(); while (tw > (c.pay ? 880 : 820) && size > 80) { size -= 4; g.font = `900 ${size}px Shoulders`; tw = mw(); }
  const LK = LN.map(l => Math.min(1.75, tw / g.measureText(l).width));       // per-line scale to the full measure
  const LH = LK.map(k => size * k * 0.86), padX = size * 0.28;
  const ph = LN.length > 1 ? LH.reduce((a, b) => a + b, 0) + size * 0.34 : size * 1.12, pw = tw + padX * 2;
  const LY = []; { let y = -ph / 2 + size * 0.17; for (const h of LH) { LY.push(LN.length > 1 ? y + h / 2 - size * 0.04 : 0); y += h; } }
  const fillT = (fn) => LN.forEach((l, i) => { if (!vis[i]) return; g.save(); g.translate(0, LY[i]); g.scale(LK.length > 1 ? LK[i] : 1, LK.length > 1 ? LK[i] : 1); fn(l, 0); g.restore(); });
  const pop = 1 + 0.12 * Math.exp(-age * 20);
  g.save(); g.globalAlpha = Math.min(inA, outA);
  g.translate(c.x, c.y); g.rotate(c.rot || 0); g.scale(pop, pop);
  const ground = c.tape === 'l' ? HIVIS.lime : HIVIS.orange;
  // the cloth: fluorescent ground, knit, the bound hem with its stitch lines
  g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 30; g.shadowOffsetY = 10;
  g.fillStyle = rgba(ground); g.beginPath(); g.moveTo(-pw / 2, -ph / 2); g.lineTo(pw / 2, -ph / 2 + 3); g.lineTo(pw / 2 - 2, ph / 2); g.lineTo(-pw / 2 + 3, ph / 2 - 2); g.closePath(); g.fill();
  g.shadowColor = 'transparent';
  g.save(); g.clip(); g.fillStyle = knit; g.fillRect(-pw / 2, -ph / 2, pw, ph);
  const sh = g.createLinearGradient(0, -ph / 2, 0, ph / 2); sh.addColorStop(0, 'rgba(255,255,255,0.12)'); sh.addColorStop(1, 'rgba(0,0,0,0.18)'); g.fillStyle = sh; g.fillRect(-pw / 2, -ph / 2, pw, ph);
  g.restore();
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2; g.setLineDash([7, 6]); g.strokeRect(-pw / 2 + 9, -ph / 2 + 9, pw - 18, ph - 18); g.setLineDash([]);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const ty = size * 0.04;
  const silver = k => { const gr = g.createLinearGradient(0, -size / 2, 0, size / 2); gr.addColorStop(0, `rgb(${236 + 19 * k},${238 + 17 * k},${240 + 15 * k})`); gr.addColorStop(0.5, `rgb(${196 + 59 * k},${200 + 55 * k},${206 + 49 * k})`); gr.addColorStop(1, `rgb(${226 + 29 * k},${228 + 27 * k},${232 + 23 * k})`); return gr; };
  if (c.tape === 'l') {
    // black print on lime between two silver tape stripes
    const st = size * 0.1;
    for (const yy of [-ph / 2 + st * 0.9, ph / 2 - st * 1.9]) { g.fillStyle = silver(flare); g.fillRect(-pw / 2, yy, pw, st); g.fillStyle = prism; g.fillRect(-pw / 2, yy, pw, st);
      if (flare > 0.05) { g.save(); g.globalCompositeOperation = 'lighter'; g.shadowColor = 'rgba(255,255,240,1)'; g.shadowBlur = 40 * flare; g.fillStyle = `rgba(255,255,240,${flare})`; g.fillRect(-pw / 2, yy, pw, st); g.restore(); } }
    g.fillStyle = '#0d0e0a'; fillT((l, dy) => g.fillText(l, 0, ty + dy));
  } else {
    // silver retroreflective letters (the prism pattern, a dark cut edge) flaring on the hit
    g.lineJoin = 'round'; g.strokeStyle = 'rgba(34,10,0,0.92)'; g.lineWidth = size * 0.08; fillT((l, dy) => g.strokeText(l, 0, ty + dy + size * 0.015));
    fillT((l, dy) => { g.fillStyle = silver(flare); g.fillText(l, 0, ty); });
    g.save(); g.globalCompositeOperation = 'source-atop'; g.fillStyle = prism; g.fillRect(-pw / 2, -ph / 2, pw, ph); g.restore();
    if (flare > 0.05) { g.save(); g.globalCompositeOperation = 'lighter'; g.shadowColor = 'rgba(255,255,235,1)'; g.shadowBlur = 50 * flare; g.fillStyle = `rgba(255,255,240,${0.9 * flare})`; fillT((l, dy) => g.fillText(l, 0, ty + dy)); g.restore(); }
  }
  // the lens-wide sweep over the tape on the hit (6 frames)
  const sw = age / 0.2; if (sw >= 0 && sw <= 1) { g.save(); g.beginPath(); g.rect(-pw / 2, -ph / 2, pw, ph); g.clip(); g.globalCompositeOperation = 'lighter';
    const sx = lerp(-pw / 2 - 100, pw / 2 + 100, sw), lg = g.createLinearGradient(sx - 60, 0, sx + 60, 0); lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,245,0.55)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg; g.transform(1, 0, -0.4, 1, 0, 0); g.fillRect(sx - 80, -ph, 160, ph * 2); g.restore(); }
  g.restore();
}
function drawType(beat) {
  tg.clearRect(0, 0, W, H);
  for (const c of CUES) { if ((c.only === 'c9' && !C9) || beat < c.b || beat >= c.b + c.hold) continue; tapeWord(tg, c, (beat - c.b) * SPB, (c.b + c.hold - beat) * SPB, beat); }
}


// ================================================================ found film: frame sequences pulled by ffmpeg into assets/ready/
// relief = Master Hands (Jam Handy for Chevrolet, 1936; Prelinger MasterHa1936, PD) I 01:10, the workers file in as if cast in metal;
// face = Master Hands I 01:29, a toolmaker's face in one hard light; btn = Master Hands I 04:13, a finger on START/STOP;
// steel = Steel: Man's Servant (US Steel, 1938; NFPF, PD Mark 1.0) at 12:58, a steelworker at night in Technicolor;
// rail = A Great Railroad at Work, Part II (New Haven Railroad, 1942; Prelinger, PD), a brakeman in the night yard.
const FILM = { relief: 144, face: 108, btn: 29, steel: 78, rail: 96 };
const FR = {};
await Promise.all(Object.entries(FILM).flatMap(([k, n]) => { FR[k] = []; return Array.from({ length: n }, (_, i) => new Promise((res, rej) => {
  const im = new Image(); im.onload = () => res(); im.onerror = rej; FR[k][i] = im; im.src = new URL(`../assets/ready/${k}_${String(i + 1).padStart(3, '0')}.jpg`, import.meta.url).href; })); }));
// the film as a window across the frame (4:3 kept whole, so the faces are not stretched), lit as a press flash: hard, contrasty,
// a flash pop on every cut. o: f (first frame), fps, zoom, cx, cy (focus 0..1 in the image), y (window centre), flash (0..1), tone
function filmWin(g, k, tt, { f = 0, fps = 12, zoom = 1, cx = 0.5, cy = 0.5, y = 960, flash = 0, tone = 'bw', contrast = 1.35, bright = 1.0, hold = false } = {}) {
  const n = FILM[k], i = clamp(Math.floor(f + (hold ? 0 : tt * fps)), 0, n - 1), im = FR[k][i];
  const ww = W, hh = W * im.naturalHeight / im.naturalWidth;
  g.save(); g.beginPath(); g.rect(0, y - hh / 2, ww, hh); g.clip();
  g.fillStyle = '#050405'; g.fillRect(0, y - hh / 2, ww, hh);
  g.filter = `${tone === 'bw' ? 'grayscale(1) ' : ''}contrast(${contrast}) brightness(${bright})`;
  const sw = im.naturalWidth / zoom, sh = im.naturalHeight / zoom, sx = clamp(cx * im.naturalWidth - sw / 2, 0, im.naturalWidth - sw), sy = clamp(cy * im.naturalHeight - sh / 2, 0, im.naturalHeight - sh);
  g.drawImage(im, sx, sy, sw, sh, 0, y - hh / 2, ww, hh); g.filter = 'none';
  if (tone === 'bw') { g.globalCompositeOperation = 'multiply'; g.fillStyle = 'rgb(255,214,170)'; g.fillRect(0, y - hh / 2, ww, hh); }      // sodium on the silver
  g.globalCompositeOperation = 'source-over';
  const vg = g.createRadialGradient(ww / 2, y, hh * 0.3, ww / 2, y, ww * 0.85); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.7)'); g.fillStyle = vg; g.fillRect(0, y - hh / 2, ww, hh);
  if (flash > 0.01) { g.globalCompositeOperation = 'lighter'; g.fillStyle = `rgba(255,246,228,${0.85 * flash})`; g.fillRect(0, y - hh / 2, ww, hh); }
  g.restore();
  return { top: y - hh / 2, bot: y + hh / 2 };
}
function caption(g, str, x, y, a = 1, align = 'left') {
  g.save(); g.font = '900 46px Shoulders'; g.textAlign = align; g.textBaseline = 'alphabetic'; g.letterSpacing = '3px'; g.globalAlpha = a;
  g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 8; g.fillStyle = 'rgb(244,230,208)'; g.fillText(str, x, y); g.restore();
}
const pressFlash = (beat, b0, k = 1) => { const a = (beat - b0) * SPB; return a < 0 ? 0 : k * Math.exp(-a * 16); };

// ================================================================ shots
const SHOTS = [
  { name: 'boot', b0: 0, b1: 1 }, { name: 'lace', b0: 1, b1: 2 }, { name: 'glove', b0: 2, b1: 3 }, { name: 'vestF', b0: 3, b1: 4 },
  { name: 'tape', b0: 4, b1: 6 }, { name: 'hat', b0: 6, b1: 7 }, { name: 'breath', b0: 7, b1: 8 }, { name: 'glasses', b0: 8, b1: 10 },
  { name: 'welder', b0: 10, b1: 12 }, { name: 'lineman', b0: 12, b1: 14 }, { name: 'miner', b0: 14, b1: 16 }, { name: 'iron', b0: 16, b1: 17 },
  { name: 'road', b0: 17, b1: 18 }, { name: 'pull', b0: 18, b1: 20 }, { name: 'afford', b0: 20, b1: 24 }, { name: 'fail', b0: 24, b1: 28 }, { name: 'strobe', b0: 28, b1: 30.5 },
  { name: 'btn', b0: 30.5, b1: 32 }, { name: 'relight', b0: 32, b1: 34 }, { name: 'relief', b0: 34, b1: 36 }, { name: 'steel', b0: 36, b1: 37.5 },
  { name: 'rail', b0: 37.5, b1: 39.5 }, { name: 'dawn1', b0: 39.5, b1: 41.5 }, { name: 'face1', b0: 41.5, b1: 43 }, { name: 'dawn2', b0: 43, b1: 45.75 },
  { name: 'face2', b0: 45.75, b1: 48 }, { name: 'still1', b0: 48, b1: 49 }, { name: 'still2', b0: 49, b1: 50 }, { name: 'arrive', b0: 50, b1: 99 },
  { name: 'stomp', b0: 999, b1: 1000 },   // from the closer on (see shotAt): frame 0's 3,000-boot stomp on the grating under the lockup: the loop
];
const shotAt = beat => SHOTS.find(s => beat >= s.b0 && beat < s.b1) || SHOTS[SHOTS.length - 1];

function voidBG(g, col = [10, 8, 12], glow = null) {
  g.fillStyle = rgba(col); g.fillRect(0, 0, W, H);
  if (glow) { g.save(); g.globalCompositeOperation = 'lighter'; glowDot(g, glow[0], glow[1], glow[2], glow[3], glow[4] ?? 0.5); g.restore(); }
}
// a henshin 'lock': a white frame-edge flash + streak lines radiating (2-4 frames) on a gear hit
function lockFlash(g, age, x, y, k = 1) {
  if (age < 0 || age > 0.15) return;
  const a = 1 - age / 0.15; g.save(); g.globalCompositeOperation = 'lighter';
  glowDot(g, x, y, 420, [255, 240, 210], 0.55 * a * k);
  g.strokeStyle = `rgba(255,245,225,${0.35 * a * k})`; g.lineWidth = 3;
  for (let i = 0; i < 18; i++) { const an = i / 18 * TAU + 0.3, r0 = 180 + 400 * (1 - a), r1 = r0 + 260; g.beginPath(); g.moveTo(x + Math.cos(an) * r0, y + Math.sin(an) * r0); g.lineTo(x + Math.cos(an) * r1, y + Math.sin(an) * r1); g.stroke(); }
  g.restore();
}

function renderCrowd(Rk, g, crowd, t, kind, hitB, o = {}) {
  const Wd = Rk.W, Hd = Rk.H, sc = Wd / W, hor = (o.hor ?? HOR) * sc;
  if (hitB != null) Rk.hit(crowd, beatT(hitB), { from: [Wd / 2, Hd], speed: 110 * sc, jitter: 3 });
  const out = Rk.compose(g, crowd, t, { back: gg => { drawWorks(gg, Wd, Hd, kind, hor, t, o.works || {}); if (o.smokeAge != null) smoke(gg, o.smokeAge, Wd, Hd, sc, hor); },
    sun: [Wd / 2, hor - 300 * sc], style: NIGHT, ground: { y0: hor }, shadow: [0, 0.25], gapAmt: 0.35 });
  hivis(g, Rk, crowd, out, t, { bandK: o.bandK ?? 0.15, vestK: o.vestK ?? 0.22, hatK: o.hatK ?? 0.55, scale: sc });
  return out;
}

// ================================================================ the frame
window.renderFrame = async (t) => {
  const late = t >= CLOSE * SPB, beat = late ? CLOSE + (t / SPB - CLOSE) : LB(t / SPB), S = late ? SHOTS[SHOTS.length - 1] : shotAt(beat), u = clamp((beat - S.b0) / (S.b1 - S.b0));
  const kick = B.env('kick', t, 10), fol = B.env('foley', t, 14);
  cg.setTransform(1, 0, 0, 1, 0, 0); cg.globalCompositeOperation = 'source-over'; cg.globalAlpha = 1; cg.filter = 'none';
  let bloom = 0.7, streak = 0.4, exposure = 0, shake = [0, 0], wo = 0;
  switch (S.name) {
    case 'boot': case 'stomp': {
      const bb = S.name === 'stomp' ? t / SPB - CLOSE : beat;        // HOOK: the steel toe slams the grating at 0 ms; sparks; the lace yanked tight into b1
      voidBG(cg, [6, 5, 7]);
      shake = shakeXY(bb, 0, 26);
      drawGrating(cg, 470, 1180, 1180, 1, [760, 1500]);
      const land = since(bb, 0), bounce = Math.max(0, Math.sin(land * 18) * Math.exp(-land * 12)) * 26;
      const bx = 680, by = 1440 - bounce, s = 540;
      // contact shadow + the impact ring of dust on the grating
      cg.save(); cg.fillStyle = 'rgba(0,0,0,0.8)'; cg.beginPath(); cg.ellipse(bx - 110, 1445, 540, 38, 0, 0, TAU); cg.fill(); cg.restore();
      drawBoot(cg, bx, by, s, bb, { laceU: smooth(0.55, 0.98, bb), seamU: 0 });
      sparks(cg, bx - 0.95 * s, 1440, land + 0.07, { n: 180, a0: -2.55, spread: 0.85, v: 1900, grav: 2200, seed: 3, w: 3.4, life: 0.7 });
      sparks(cg, bx - 0.6 * s, 1442, land + 0.05, { n: 90, a0: -0.5 - Math.PI / 2, spread: 0.8, v: 1300, seed: 4, w: 3, life: 0.6 });
      cg.save(); cg.globalCompositeOperation = 'lighter'; glowDot(cg, bx - 0.95 * s, 1440, 300, [255, 150, 60], 0.9 * Math.exp(-land * 5)); cg.restore();
      bloom = 0.9 + 0.8 * Math.exp(-land * 6); streak = 0.9 * Math.exp(-land * 4);
      break;
    }
    case 'lace': {        // the lace macro: the hooks, the seam racing up the lacing (the gear locks)
      voidBG(cg, [5, 4, 6]);
      const s = 1500; drawBoot(cg, 820 + 60 * u, 2350, s, beat, { laceU: 1, seamU: ease.outCubic(clamp(since(beat, 1) / 0.45)) });
      lockFlash(cg, since(beat, 1), 600, 700, 0.7);
      break;
    }
    case 'glove': {       // the leather creaks, the wrist strap SNAPs shut at b2.2 (on its transient)
      voidBG(cg, [6, 5, 7]);
      const snapB = B.last('snap', t) / SPB + 0.45, sn = beat >= snapB ? 1 : smooth(snapB - 0.35, snapB, beat) * 0.3;
      const s = 520; shake = shakeXY(beat, snapB, 14);
      drawGlove(cg, 470 + 20 * u, 980 - 10 * u, s, { snap: sn, seamU: beat >= snapB ? ease.outCubic(clamp(since(beat, snapB) / 0.3)) : 0 });
      lockFlash(cg, since(beat, snapB), 800, 900, 0.8);
      break;
    }
    case 'vestF': {       // the vest front: the velcro tab slapped (b3), the zip pull rising to the collar (ends on b4)
      voidBG(cg, [7, 6, 8], [880, 300, 900, [255, 150, 70], 0.28]);
      haze(cg, 760, 380, 1100, [255, 150, 70], 0.75, 0.8); haze(cg, 160, 900, 700, [110, 140, 220], 0.35, 1.2);
      const s = 900, zu = smooth(3.3, 3.98, beat);
      bust(cg, 540, 560 - 40 * u, s, { f: 1, view: 'front', vest: 'lime', vestLit: 0.6, bandK: 0.25 + 0.2 * fol, zipU: zu, hood: false,
        light: { dir: [0.9, -0.3], col: 'rgba(255,170,80,0.95)', w: 16 }, light2: { dir: [-0.9, -0.2], col: 'rgba(120,150,220,0.5)', w: 8 } });
      // crop: this is the torso only (the head is out of frame above)
      cg.fillStyle = '#070608'; cg.fillRect(0, 0, W, 470 - 40 * u);
      lockFlash(cg, since(beat, 3), 540, 1300, 0.5);
      break;
    }
    case 'tape': {        // over the shoulder: the vest back; on b5 the light seam runs round every band and it locks
      voidBG(cg, [6, 6, 9], [540, 700, 900, [255, 160, 80], 0.2]);
      haze(cg, 700, 420, 1000, [255, 150, 70], 0.7, 0.8);
      const s = 900; const seamU = beat >= 5 ? ease.outCubic(clamp(since(beat, 5) / 0.4)) : 0;
      bust(cg, 540, 70 + 30 * u, s, { f: 1, view: 'back', vest: 'lime', vestLit: 0.3, hood: true, bandK: beat >= 5 ? 0.35 + 0.65 * Math.exp(-since(beat, 5) * 3) : 0.1, seamU,
        light: { dir: [0.8, -0.5], col: 'rgba(255,170,80,0.95)', w: 14 }, light2: { dir: [-0.9, -0.3], col: 'rgba(120,150,220,0.45)', w: 7 } });
      lockFlash(cg, since(beat, 5), 540, 1150, 0.6);
      bloom = 0.9;
      break;
    }
    case 'hat': {         // the hard hat slapped on: TOK; the sticker (the ACP's four stripes) is the motif moment
      voidBG(cg, [7, 6, 9], [300, 500, 800, [255, 150, 60], 0.35]);
      const a = since(beat, 6), drop = a < 0 ? 1 : 0;
      shake = shakeXY(beat, 6, 22);
      const y = 1080 + drop * -300 + Math.max(0, Math.sin(a * 22) * Math.exp(-a * 14)) * 18;
      drawHatMacro(cg, 560, y, 360, { col: HAT.white, lit: 1, glint: a / 0.35, stickerK: 1 });
      lockFlash(cg, a, 560, 900, 0.9);
      bloom = 0.8;
      break;
    }
    case 'breath': {      // the inhale: the hero in lost profile, the works far behind, everything held (the one silence)
      voidBG(cg, [4, 5, 9]);
      cg.save(); drawWorks(cg, W, H, 'mill', 1500, t, { flood: 0.55, beams: 0 }); cg.restore();
      cg.fillStyle = 'rgba(0,0,0,0.45)'; cg.fillRect(0, 0, W, H);
      const s = 620 + 40 * u;
      bust(cg, 470, 1180, s, { f: 1, view: 'back', vest: 'lime', vestLit: 0.2, hood: true, hat: 'white', sticker: true, stickerLit: 0.3, glasses: 0, bandK: 0.1,
        light: { dir: [0.95, -0.3], col: 'rgba(255,170,80,0.9)', w: 12 }, light2: { dir: [-0.8, -0.5], col: 'rgba(110,140,210,0.4)', w: 6 } });
      bloom = 0.5;
      break;
    }
    case 'glasses': {     // b8: the glasses flip down, a single 2-frame lens-wide wipe; READY.
      voidBG(cg, [4, 5, 9]);
      drawWorks(cg, W, H, 'mill', 1450, t, { flood: 0.8 + 0.4 * kick, beams: 1 });
      cg.fillStyle = 'rgba(0,0,0,0.35)'; cg.fillRect(0, 0, W, H);
      const gl = beat < 8 ? 0 : clamp(since(beat, 8) / 0.07); const s = 820 + 60 * u; shake = shakeXY(beat, 8, 18);
      const o = bust(cg, 430, 1260, s, { f: 1, view: 'back', vest: 'lime', vestLit: 0.3, hood: true, hat: 'white', sticker: true, stickerLit: 0.4, glasses: gl, bandK: 0.2 + 0.5 * kick,
        light: { dir: [0.95, -0.3], col: 'rgba(255,175,90,0.95)', w: 14 }, light2: { dir: [-0.8, -0.5], col: 'rgba(120,150,220,0.45)', w: 7 } });
      const fr = Math.round(since(beat, 8) * 30);
      if (fr >= 1 && fr <= 2 && o._lens) { const [lx, ly, lr] = o._lens; cg.save(); cg.globalCompositeOperation = 'lighter';
        const k = fr === 1 ? 0 : 1, gx = lx + lerp(-lr * 1.5, lr * 1.5, k); glowDot(cg, gx, ly, lr * 3.5, [255, 250, 235], 1);
        cg.fillStyle = 'rgba(255,255,245,0.9)'; cg.beginPath(); cg.ellipse(gx, ly, lr * 2.8, lr * 0.18, -0.05, 0, TAU); cg.fill(); cg.restore(); }
      bloom = 0.9;
      break;
    }
    case 'welder': {      // a welder nods the hood down; the arc strikes blue-white beyond him
      voidBG(cg, [3, 4, 8]);
      const wd = smooth(10.0, 10.25, beat), arcOn = beat >= 10.3 ? 1 : 0, fl = arcOn * (0.75 + 0.25 * hash(Math.floor(t * 30)));
      cg.save(); cg.globalCompositeOperation = 'lighter'; glowDot(cg, 900, 1250, 900, [150, 190, 255], 0.55 * fl); haze(cg, 820, 900, 1100, [140, 180, 255], 0.9 * fl + 0.1); glowDot(cg, 900, 1250, 160, [230, 240, 255], 0.9 * fl); cg.restore();
      for (const ph of [0, 0.2]) sparks(cg, 900, 1260, ((t + ph) % 0.4), { n: 70 * arcOn, a0: -2.0, spread: 1.5, v: 1100, grav: 1800, life: 0.45, seed: Math.floor((t + ph) / 0.4) + ph * 10, w: 3 });
      bust(cg, 470, 1150, 700, { f: 1, view: 'back', garment: 'leather', weld: wd, arcK: fl, hood: false,
        light: { dir: [0.95, 0.05], col: `rgba(170,205,255,${0.3 + 0.7 * fl})`, w: 16 }, light2: { dir: [-0.6, -0.8], col: 'rgba(255,150,70,0.4)', w: 6 } });
      bloom = 1.0; streak = 0.8 * fl;
      break;
    }
    case 'lineman': {     // a lineman cuffs his red rubber gauntlet; blue hat; the amber strobe on the truck
      voidBG(cg, [4, 5, 9]);
      const sk = (beat % 1) < 0.08 || ((beat % 1) > 0.14 && (beat % 1) < 0.22) ? 1 : 0;
      cg.save(); cg.globalCompositeOperation = 'lighter'; glowDot(cg, 880, 700, 700, [255, 150, 30], 0.3 + 0.5 * sk); cg.restore();
      haze(cg, 640, 560, 1000, [255, 140, 40], 0.45 + 0.55 * sk, 0.9);
      bust(cg, 560, 900, 520, { f: -1, view: 'back', vest: 'orange', vestLit: 0.2, hat: 'blue', hood: true, bandK: 0.2 + 0.7 * sk,
        light: { dir: [0.9, -0.4], col: `rgba(255,170,60,${0.5 + 0.5 * sk})`, w: 12 }, light2: { dir: [-0.7, -0.7], col: 'rgba(140,170,230,0.4)', w: 6 } });
      // the energized line across the top of the frame: three conductors on their insulators, lit by the strobe
      cg.save(); for (let i = 0; i < 3; i++) { const yy = 180 + i * 70; cg.strokeStyle = `rgba(${150 + 100 * sk},${110 + 60 * sk},${60},0.7)`; cg.lineWidth = 5; cg.beginPath(); cg.moveTo(-20, yy + 30); cg.quadraticCurveTo(540, yy + 70, 1100, yy + 10); cg.stroke(); }
      cg.restore();
      // the hot stick, carried straight up on his shoulder side (vertical, never a diagonal)
      cg.save(); cg.strokeStyle = '#d8c060'; cg.lineWidth = 16; cg.beginPath(); cg.moveTo(820, 1920); cg.lineTo(800, 380); cg.stroke(); cg.strokeStyle = `rgba(255,220,120,${0.4 + 0.5 * sk})`; cg.lineWidth = 4; cg.beginPath(); cg.moveTo(826, 1920); cg.lineTo(806, 380); cg.stroke(); cg.restore();
      lockFlash(cg, since(beat, 12), 560, 700, 0.6);
      break;
    }
    case 'miner': {       // a miner: the cap lamp clicked on (b14), its beam cutting the dust of the drift ahead of him
      voidBG(cg, [3, 3, 4]);
      const on = beat >= 14.05 ? 1 : 0, fl = on * (0.92 + 0.08 * hash(Math.floor(t * 30)));
      const lx = 540 - 0.3 * 700, ly = 1060 - 0.47 * 700;
      // the beam: a cone forward-left into the drift, dust motes lit inside it
      cg.save(); cg.globalCompositeOperation = 'lighter';
      const bm = cg.createLinearGradient(lx, ly, 0, 700); bm.addColorStop(0, `rgba(255,246,220,${0.55 * fl})`); bm.addColorStop(1, 'rgba(255,240,210,0)');
      cg.fillStyle = bm; cg.beginPath(); cg.moveTo(lx, ly - 8); cg.lineTo(-200, 200); cg.lineTo(-200, 1100); cg.lineTo(lx, ly + 8); cg.closePath(); cg.fill();
      const r = rng(5); for (let i = 0; i < 160; i++) { const u = r(), px = lerp(lx, -200, u), py = lerp(ly, lerp(200, 1100, r()), u) + Math.sin(t * 2 + i) * 6; cg.fillStyle = `rgba(255,240,210,${0.5 * fl * (1 - u) * r()})`; cg.fillRect(px, py, 2.5, 2.5); }
      glowDot(cg, lx, ly, 120, [255, 250, 235], fl); cg.restore();
      haze(cg, 260, 640, 1000, [255, 236, 200], 0.55 * fl + 0.05, 0.8);
      // the drift: timber sets receding (post, cap, post), lit only where the beam touches
      cg.save(); for (let k = 0; k < 5; k++) { const z = 1 / (1 + k * 0.6), cx = 300 - 180 * (1 - z), wv = 900 * z, hv = 1300 * z, y0 = 760 + 300 * (1 - z);
        cg.strokeStyle = `rgba(120,80,40,${0.5 * z * (0.3 + 0.7 * fl)})`; cg.lineWidth = 26 * z; cg.strokeRect(cx - wv / 2, y0 - hv / 2, wv, hv); } cg.restore();
      bust(cg, 540, 1060, 700, { f: -1, view: 'back', hat: 'white', hood: true, garment: 'flannel',
        light: { dir: [-0.95, -0.2], col: `rgba(255,236,200,${0.3 + 0.6 * fl})`, w: 12 }, light2: { dir: [0.8, -0.5], col: 'rgba(120,140,200,0.35)', w: 6 } });
      cg.save(); cg.fillStyle = '#111'; cg.beginPath(); cg.roundRect(lx - 16, ly - 20, 44, 40, 8); cg.fill(); cg.restore();
      lockFlash(cg, since(beat, 14.05), lx, ly, 0.6);
      bloom = 0.9; streak = 0.6 * fl;
      break;
    }
    case 'iron': {        // an ironworker cinches her harness; yellow hat, ponytail, the dorsal D-ring catches the light
      voidBG(cg, [8, 12, 26]);
      cg.save(); const sky = cg.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#060a18'); sky.addColorStop(1, '#2a3558'); cg.fillStyle = sky; cg.fillRect(0, 0, W, H);
      cg.fillStyle = '#04050a'; cg.fillRect(0, 1380, W, 40); cg.fillRect(120, 300, 30, 1600); cg.fillRect(930, 200, 30, 1700); cg.fillRect(0, 520, W, 26); cg.restore();
      haze(cg, 560, 700, 1100, [120, 160, 255], 0.8, 0.7);
      const cin = smooth(16.0, 16.15, beat);
      bust(cg, 560, 980, 640, { f: 1, view: 'back', hat: 'yellow', ponytail: true, hood: true, harness: 1 + cin, dringK: Math.exp(-since(beat, 16) * 6),
        light: { dir: [0.8, -0.6], col: 'rgba(160,190,255,0.7)', w: 12 }, light2: { dir: [-0.9, 0.1], col: 'rgba(255,160,70,0.8)', w: 8 } });
      break;
    }
    case 'road': {        // a road crew: orange hat, orange vest, the arrow board flashing behind
      voidBG(cg, [5, 4, 6]);
      const on = (beat % 0.5) < 0.25 ? 1 : 0.15;
      cg.save(); cg.globalCompositeOperation = 'lighter';
      const ax = 540, ay = 560; for (let i = 0; i < 7; i++) for (let j = 0; j < 3; j++) { const px = ax - 300 + i * 100, py = ay + (j - 1) * 90; const onA = (j === 1 || (i >= 4 && Math.abs(j - 1) <= (6 - i))) ? on : 0.05; glowDot(cg, px, py, 60, [255, 170, 40], 0.9 * onA); }
      cg.restore();
      haze(cg, 540, 560, 1000, [255, 150, 40], 0.35 + 0.5 * on, 0.8);
      bust(cg, 540, 1130, 700, { f: -1, view: 'back', hat: 'orange', vest: 'orange', vestLit: 0.3, hood: true, bandK: 0.2 + 0.7 * on,
        light: { dir: [0, -1], col: `rgba(255,170,50,${0.5 + 0.5 * on})`, w: 14 }, light2: { dir: [0.9, 0.2], col: 'rgba(130,160,230,0.4)', w: 6 } });
      break;
    }
    case 'pull': {        // out of the hero into the gate crowd, in the cold before the works are lit: the hero is rank 0
      const z = lerp(2.6, 1.0, smooth(0, 1, u));
      renderCrowd(R, sg2, crowdGate, t, 'mill', null, { bandK: 0.15, works: { flood: 0.5, board: BOARD_SHIFT() } });
      cg.fillStyle = '#000'; cg.fillRect(0, 0, W, H);
      cg.save(); cg.translate(540, 1500); cg.scale(z, z); cg.translate(-540, -1500); cg.drawImage(scr2, 0, 0); cg.restore();
      bloom = 0.8;
      break;
    }
    case 'afford': {      // PEOPLE CAN'T AFFORD TO LIVE.: the shift at the gate before the works are lit; cold navy, sodium only at the horizon. b20-22 wide, b22-24 a step in.
      renderCrowd(R, sg2, crowdGate, t, 'mill', null, { bandK: 0.15, works: { flood: 0.5, board: BOARD_SHIFT() } });
      const near = beat >= 22, z = near ? 1.55 + 0.06 * smooth(22, 24, beat) : 1.0 + 0.05 * smooth(20, 22, beat);
      cg.fillStyle = '#000'; cg.fillRect(0, 0, W, H);
      cg.save(); cg.translate(near ? 330 : 540, near ? 1650 : 1500); cg.scale(z, z); cg.translate(near ? -330 : -540, near ? -1650 : -1500); cg.drawImage(scr2, 0, 0); cg.restore();
      cg.fillStyle = 'rgba(6,10,30,0.22)'; cg.fillRect(0, 0, W, H);
      if (near) { const fl = pressFlash(beat, 22, 0.5); if (fl > 0.01) { cg.save(); cg.globalCompositeOperation = 'lighter'; cg.fillStyle = `rgba(255,240,215,${fl})`; cg.fillRect(0, 0, W, H); cg.restore(); } }
      break;
    }
    case 'fail': {        // SYSTEMIC, OPERATIONAL, LOGISTICAL DYSFUNCTION.: the works go dark stage by stage; the board drops characters and dies
      const stage = beat < 24.75 ? 0 : beat < 26 ? 1 : beat < 27 ? 2 : 3;
      const fl = [0.42, 0.28, 0.14, 0.04][stage] * (0.8 + 0.2 * hash(Math.floor(t * 24) + stage * 9)) * (beat > 27.6 ? 0 : 1);
      const glitch = [0.15, 0.4, 0.7, 0.92][stage];
      renderCrowd(R, sg2, crowdGate, t, 'mill', null, { bandK: 0.1, vestK: 0.16, works: { flood: fl, board: { small: null, big: 'SHIFT 05:00', on: beat > 27.7 ? 0 : 1, glitch, seed: stage } } });
      const z = 1.0 + 0.08 * smooth(24, 28, beat);
      cg.fillStyle = '#000'; cg.fillRect(0, 0, W, H);
      cg.save(); cg.translate(540, 1500); cg.scale(z, z); cg.translate(-540, -1500); cg.drawImage(scr2, 0, 0); cg.restore();
      cg.fillStyle = 'rgba(4,6,18,0.3)'; cg.fillRect(0, 0, W, H);
      bloom = 0.6;
      break;
    }
    case 'strobe': {      // ALL AT ONCE.: in the dark, one camera-axis flash lights every band of tape in the shift in the same frame (3 frames)
      const a = since(beat, 28), st = a >= 0 && a < 3 / 30 ? 1 : 0;
      const scr_ = B.env('troupe', t, 12);
      const bandK = st ? 1 : 0.06 + 0.8 * Math.exp(-a * 5) * 0.5 + 0.4 * scr_;
      renderCrowd(R, sg2, crowdGate, t, 'mill', null, { bandK: Math.min(1, bandK), vestK: st ? 0.55 : 0.08 + 0.1 * scr_, hatK: st ? 0.8 : 0.25, works: { flood: st ? 0.16 : 0, strobe: st, board: { big: 'SHIFT 05:00', on: 0, glitch: 1 } } });
      const z = 1.08 + 0.06 * ease.outCubic(clamp(a / (2.5 * SPB)));
      cg.fillStyle = '#000'; cg.fillRect(0, 0, W, H);
      cg.save(); cg.translate(540, 1500); cg.scale(z, z); cg.translate(-540, -1500); cg.drawImage(scr2, 0, 0); cg.restore();
      if (st) { cg.save(); cg.globalCompositeOperation = 'lighter'; cg.fillStyle = 'rgba(200,210,235,0.14)'; cg.fillRect(0, 0, W, H); cg.restore(); }
      bloom = 0.9 + 1.4 * st; streak = 0.4 + 1.6 * st;
      break;
    }
    case 'btn': {         // WHEN IT DOES,: in the dark, a hand (Master Hands, 1936) reaches the START/STOP station and presses. The plant is not lit by itself.
      voidBG(cg, [4, 3, 5]);
      const ff = pressFlash(beat, 30.5, 0.6);
      filmWin(cg, 'btn', since(beat, 30.5), { f: 4, fps: 10, zoom: 1.0, cx: 0.5, cy: 0.5, y: 1000, flash: ff, contrast: 1.5 });
      caption(cg, 'MASTER HANDS, 1936', 60, 1440, 0.9);
      bloom = 0.8;
      break;
    }
    case 'relight': {     // READY.: the works come on, all the floods in one frame, and the shift is already standing in it
      const a = since(beat, 32), fl = 0.25 + 0.75 * ease.outCubic(clamp(a / 0.12)), pop = Math.max(0, 1 - a / 0.2);
      renderCrowd(R, cg, crowdGate, t, 'mill', 32, { bandK: 0.2 + 0.7 * pop + 0.4 * kick, works: { flood: fl * (0.95 + 0.05 * hash(Math.floor(t * 30))), strobe: pop, dawn: 0.05, board: BOARD_SHIFT() } });
      shake = shakeXY(beat, 32, 18);
      bloom = 0.9 + 0.8 * pop;
      break;
    }
    case 'relief': {      // ONLY THOSE, ALREADY: the same gate, 1936: the men file in (Master Hands, Chevrolet, Flint), cast as relief
      voidBG(cg, [5, 4, 6]);
      const w = filmWin(cg, 'relief', since(beat, 34), { f: 24, fps: 9, zoom: 1.0, cx: 0.5, cy: 0.5, y: 1040, flash: pressFlash(beat, 34, 0.8), contrast: 1.6, bright: 1.35 });
      caption(cg, 'MASTER HANDS, 1936', 60, w.bot + 64, 0.9);
      break;
    }
    case 'steel': {       // 1938: a steelworker at night, in Technicolor (Steel: Man's Servant)
      voidBG(cg, [5, 4, 6]);
      const w = filmWin(cg, 'steel', since(beat, 36), { f: 6, fps: 12, zoom: 1.0, cx: 0.4, cy: 0.5, y: 1040, flash: pressFlash(beat, 36, 0.8), tone: 'color', contrast: 1.15, bright: 1.05 });
      caption(cg, "STEEL: MAN'S SERVANT, 1938", 60, w.bot + 64, 0.9);
      break;
    }
    case 'rail': {        // 1942: the night yard, a brakeman at a boxcar with his lamp (A Great Railroad at Work)
      voidBG(cg, [5, 4, 6]);
      const w = filmWin(cg, 'rail', since(beat, 37.5), { f: 10, fps: 12, zoom: 1.0, y: 1040, flash: pressFlash(beat, 37.5, 0.8), contrast: 1.3, bright: 4.2 });
      caption(cg, 'A GREAT RAILROAD AT WORK, 1942', 60, w.bot + 64, 0.9);
      break;
    }
    case 'dawn1': case 'dawn2': {   // WILL SHAPE / OF THE NATION.: our gate, 2026, the light lifting from navy to a cold grey; the board carries the Party's own count
      const d = smooth(32, 50, beat), first = S.name === 'dawn1';
      renderCrowd(R, sg2, first ? crowdGate : crowdStand, t, first ? 'mill' : 'rail', null, { bandK: 0.2 + 0.3 * kick, works: { flood: 1, dawn: d, board: first ? { small: 'ACP', big: '27 NEW CHAPTERS' } : { small: 'ACP', big: '1,000+ EVENTS ORGANIZED' } } });
      const z = first ? 1.0 + 0.1 * u : 1.12 - 0.08 * u;
      cg.fillStyle = '#000'; cg.fillRect(0, 0, W, H);
      cg.save(); cg.translate(540, 1500); cg.scale(z, z); cg.translate(-540, -1500); cg.drawImage(scr2, 0, 0); cg.restore();
      const fl = pressFlash(beat, S.b0, 0.5); if (fl > 0.01) { cg.save(); cg.globalCompositeOperation = 'lighter'; cg.fillStyle = `rgba(255,240,215,${fl})`; cg.fillRect(0, 0, W, H); cg.restore(); }
      caption(cg, '2026', 60, 1830, 0.9);
      break;
    }
    case 'face1': {       // THE FUTURE: a face in one hard light (Master Hands), eyes down on the work
      voidBG(cg, [5, 4, 6]);
      const w = filmWin(cg, 'face', since(beat, 41.5), { f: 26, fps: 8, zoom: 1.2, cx: 0.42, cy: 0.4, y: 1040, flash: pressFlash(beat, 41.5, 0.9), contrast: 1.45, bright: 1.15 });
      caption(cg, 'MASTER HANDS, 1936', 60, w.bot + 64, 0.9);
      break;
    }
    case 'face2': {       // AMERICANS ARE: the shift filing in, faces (Master Hands, relief)
      voidBG(cg, [5, 4, 6]);
      const w = filmWin(cg, 'relief', since(beat, 45.75), { f: 62, fps: 8, zoom: 1.6, cx: 0.45, cy: 0.42, y: 1040, flash: pressFlash(beat, 45.75, 0.9), contrast: 1.6, bright: 1.4 });
      caption(cg, 'MASTER HANDS, 1936', 60, w.bot + 64, 0.9);
      break;
    }
    case 'still1': {      // AB-: the band stops. Frozen: nothing moves between the two stills (a hard flash on the man's face)
      voidBG(cg, [5, 4, 6]);
      const w = filmWin(cg, 'face', 0, { f: 34, zoom: 1.5, cx: 0.42, cy: 0.36, y: 1040, hold: true, flash: pressFlash(beat, 48, 0.9), contrast: 1.5, bright: 1.15 });
      caption(cg, 'MASTER HANDS, 1936', 60, w.bot + 64, 0.9);
      bloom = 0.9;
      break;
    }
    case 'still2': {      // -LUTE: frozen again: the white hard hat and its sticker, flat in the flash
      voidBG(cg, [7, 6, 9], [540, 900, 1000, [255, 150, 60], 0.3]);
      drawHatMacro(cg, 560, 1000, 420, { col: HAT.white, lit: 1, glint: -1, stickerK: 1 });
      const fl = pressFlash(beat, 49, 0.9); if (fl > 0.01) { cg.save(); cg.globalCompositeOperation = 'lighter'; cg.fillStyle = `rgba(255,240,215,${fl * 0.7})`; cg.fillRect(0, 0, W, H); cg.restore(); }
      caption(cg, '2026', 60, 1830, 0.9);
      bloom = 0.9;
      break;
    }
    case 'arrive': default: {   // REA-DY: everything arrives on the beat. The works at full light, first grey behind, the shift in front; then it holds, breathing (2.7 s)
      const a = since(beat, 50), pop = Math.max(0, 1 - a / 0.2);
      renderCrowd(R, cg, crowdStand, t, 'mill', 50, { bandK: 0.35 + 0.65 * pop + 0.2 * kick, works: { flood: 1, dawn: 0.8 + 0.2 * Math.sin(a * 0.9) , strobe: pop, board: { small: 'ACP', big: 'SHIFT 05:00' } } });
      cg.save(); cg.fillStyle = 'rgba(0,0,0,0.3)'; cg.fillRect(0, 1180, W, 740); cg.restore();
      drawHatMacro(cg, 560, 1500 + 10 * Math.sin(a * 1.1) + 24 * Math.exp(-a * 8), 420, { col: HAT.white, lit: 1, glint: a / 0.4, stickerK: 1 });
      shake = shakeXY(beat, 50, 22);
      bloom = 1.0 + 0.6 * pop;
      break;
    }
  }
  // shake the world (not the type)
  if (shake[0] || shake[1]) { sg.setTransform(1, 0, 0, 1, 0, 0); sg.globalCompositeOperation = 'copy'; sg.drawImage(comp, 0, 0); sg.globalCompositeOperation = 'source-over'; cg.fillStyle = '#000'; cg.fillRect(0, 0, W, H); cg.drawImage(scr, shake[0], shake[1]); }

  drawType(beat);
  if (late) lockup(tg, t - CLOSE * SPB, cg);
  post.apply({ world: comp, type: typeC }, t, {
    bloom: { amount: bloom + 0.3 * kick, threshold: 0.62, radius: 1.0 }, halation: { amount: 0.4, tint: [1, 0.35, 0.12] },
    streaks: { amount: streak, threshold: 0.75, tint: [1.0, 0.85, 0.7], stretch: 0.93 },
    lens: { distort: 0.02, ca: 0.002 + 0.006 * kick },
    film: { exposure, contrast: 0.32, sat: 1.08, shoulder: 0.35, split: { shadows: [0.2, 0.28, 0.45], highlights: [0.8, 0.55, 0.3], amount: 0.3 }, fade: 0.01 },
    vignette: { amount: 0.5 }, grain: { amount: 0.55, size: 1.3 },
    type: { glow: 0, shadow: 0.2, grain: 0.25 },
  });
};

// the 1.4 s lockup, alpha over the last world frame (the frame darkened under it so the mark reads clean)
function lockup(g, age, world) {
  const a = ease.outExpo(clamp(age / 0.25)), k = Math.exp(-age * 10), s = 230 * (1 + 0.5 * k);
  // the piece's own ground: the 5 a.m. sky, navy going to sodium at the horizon (never a black card)
  { const gg = world.createLinearGradient(0, 0, 0, H); gg.addColorStop(0, `rgba(18,28,60,${0.9 * a})`); gg.addColorStop(0.5, `rgba(22,32,66,${0.82 * a})`); gg.addColorStop(0.62, `rgba(40,30,40,${0.3 * a})`); gg.addColorStop(1, `rgba(0,0,0,0)`);
    world.fillStyle = gg; world.fillRect(0, 0, W, H); }
  g.save(); g.globalCompositeOperation = 'lighter';
  sigil(g, W / 2 - 12 * k, 860, s, { color: '#6ab0ff', alpha: 0.3 * a * k }); sigil(g, W / 2 + 12 * k, 860, s, { color: '#ff1030', alpha: 0.25 * a * k });
  g.restore();
  sigil(g, W / 2, 860, s, { color: C.cream, accent: C.red2, alpha: a });
  line(g, 'ACP.US', W / 2, 1190, { family: 'Archivo Black', size: 76, color: C.cream, alpha: clamp((age - 0.3) * 5) });
}

window._dbg = { comp, cg, scr, sg, rimFill, xf, bust, bustPaths };
window.sceneReady = true;
