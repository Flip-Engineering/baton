// ACCELERATE v10 (3 Oct 2026): the world after the chips.
// The client (3 Oct, on v9): the piece builds toward breaking free of the regulator wheel; after Lange's computer (the market put on chips, ~16 s) the
// governor metaphor is literally declared outmoded, so the picture leaves it; the pace accelerates from there; the CCRU section and THEY WERE WRONG TO
// IDENTIFY THIS PRINCIPLE WITH CAPITAL get entirely new visual concepts.
//   the flood     the chips fill in under a second and the black runs on past them over the whole page: the paper world of brass and iron is gone
//   the relic     THE MARKET PROCESS… APPEARS OLD-FASHIONED: the governor, small, in ink on one paper chip; the camera pulls back until it is one cell in a
//                 field of thousands of chips, all computing (A COMPUTING DEVICE OF THE PREELECTRONIC AGE)
//   the circuit   Marx's automatic system: traces that route themselves across the black, faster and faster (A MOVING POWER THAT MOVES ITSELF)
//   the loop      the CCRU's runaway cybernetic principle: a feedback-loop diagram that contains itself, zooming in without end and accelerating; society
//                 (the film) is flashed in the innermost box, faster each turn
//   the Droste    (c20, the client: "do not break the recursion") the same loop runs on unbroken from THE CCRU IDENTIFIED to AND NOT 'CAPITAL.':
//                 THEY WERE WRONG empties its frames (the bare form the CCRU named); the chairman's sentence fills them with people at research
//                 (take a: the camera travels in through them; take b: it pulls out and the return wire runs through the operators' hands);
//                 AND NOT 'CAPITAL.' rushes the loop open into the circuit. The c10-c14 lid and its CAPITAL placard are gone.
// White on black; red only at the banner (unchanged).
import { W, H, clamp, lerp, smooth, ease, rng } from '../lib/kit.js';

export const INK = '#0b0b0b', PAPER = '#f7f7f2';
const TAU = Math.PI * 2;

// ------------------------------------------------------------------ the flood (end of the chips card): black spreads from the chip field over the page
export function flood(c, u) {
  if (u <= 0) return;
  const e = ease.inOutCubic(clamp(u)), top = lerp(870, 0, e), bot = lerp(1780, H, e), l = lerp(60, 0, e), r = lerp(1020, W, e);
  c.fillStyle = INK; c.fillRect(l, top, r - l, bot - top);
}

// ------------------------------------------------------------------ a field of chips seen from above (QFP-ish squares with pins), paper line on black
const CP = [150, 170], CB = [104, 124];
function chipCell(c, x, y, z, lit, filled) {
  const w = CB[0] * z, h = CB[1] * z;
  if (w < 2.5) { c.fillStyle = lit > 0.5 ? PAPER : 'rgba(247,247,242,0.35)'; c.fillRect(x - w / 2, y - h / 2, Math.max(1, w), Math.max(1, h)); return; }
  c.strokeStyle = PAPER; c.lineWidth = Math.max(1, 3 * z);
  if (filled) { c.fillStyle = PAPER; c.fillRect(x - w / 2, y - h / 2, w, h); }
  else { c.strokeRect(x - w / 2, y - h / 2, w, h); if (lit > 0) { c.globalAlpha = lit; c.fillStyle = PAPER; c.fillRect(x - w / 2 + 6 * z, y - h / 2 + 6 * z, w - 12 * z, h - 12 * z); c.globalAlpha = 1; } }
  if (w > 18) {                                                          // the pins
    c.fillStyle = PAPER; const pw = Math.max(1, 5 * z), pl = 12 * z;
    for (let k = 0; k < 6; k++) { const px = x - w / 2 + (k + 0.5) * w / 6 - pw / 2, py = y - h / 2 + (k + 0.5) * h / 6 - pw / 2;
      c.fillRect(px, y - h / 2 - pl, pw, pl); c.fillRect(px, y + h / 2, pw, pl); c.fillRect(x - w / 2 - pl, py, pl, pw); c.fillRect(x + w / 2, py, pl, pw); }
  }
}
const hash = (i, j, s = 0) => { const v = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };
// u: 0..1 over the shot; t seconds; drawGov(ctx, x, y, s) draws the governor in ink at scale s with its centre at (x, y)
export function relic(c, u, t, drawGov) {
  c.fillStyle = INK; c.fillRect(0, 0, W, H);
  const e = ease.inOutCubic(clamp(u)), z = Math.exp(lerp(Math.log(4.6), Math.log(0.2), Math.pow(e, 0.85))), cx = 540, cy = 1240;
  const nx = Math.ceil(W / (CP[0] * z) / 2) + 1, ny = Math.ceil(H / (CP[1] * z) / 2) + 2;
  const tick = Math.floor(t * 14);
  c.save();
  for (let j = -ny; j <= ny; j++) for (let i = -nx; i <= nx; i++) {
    if (i === 0 && j === 0) continue;
    const x = cx + i * CP[0] * z, y = cy + j * CP[1] * z;
    if (x < -CP[0] * z || x > W + CP[0] * z || y < -CP[1] * z || y > H + CP[1] * z) continue;
    const lit = hash(i, j, tick) < 0.18 + 0.4 * e ? 1 : 0;                // every other chip is computing, the field brightening as it widens
    chipCell(c, x, y, z, lit, false);
  }
  // the relic: one paper chip with the old machine inside it, running
  const w = CB[0] * z, h = CB[1] * z;
  chipCell(c, cx, cy, z, 0, true);
  if (w > 6) { c.save(); c.beginPath(); c.rect(cx - w / 2, cy - h / 2, w, h); c.clip(); drawGov(c, cx, cy + h * 0.06, z * 0.95); c.restore(); }
  c.restore();
}

// ------------------------------------------------------------------ the circuit: traces that route themselves (45° bends, vias, pads), with signal running
function makeRoutes(seed, n) {
  const r = rng(seed), out = [], G = 36, dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  for (let k = 0; k < n; k++) {
    let x = Math.round(r() * W / G) * G, y = Math.round((560 + r() * (H - 520)) / G) * G, d = Math.floor(r() * 8);
    const pts = [[x, y]], segs = 3 + Math.floor(r() * 6);
    for (let s = 0; s < segs; s++) {
      const len = (2 + Math.floor(r() * 9)) * G; x += dirs[d][0] * len; y += dirs[d][1] * len; pts.push([x, y]);
      d = (d + (r() < 0.5 ? 1 : 7) + (r() < 0.3 ? (r() < 0.5 ? 1 : 7) : 0)) % 8; if (d % 2 && r() < 0.5) d = (d + 1) % 8;
    }
    let L = 0; const cum = [0]; for (let i = 1; i < pts.length; i++) { L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); cum.push(L); }
    out.push({ pts, cum, L, w: [4, 6, 6, 9, 12][Math.floor(r() * 5)], t0: r(), sp: 0.6 + r() * 0.8, ph: r(), pad: r() < 0.5 });
  }
  return out;
}
const ROUTES = makeRoutes(31, 150);
function along(R, s) {
  s = clamp(s, 0, R.L); let i = 1; while (i < R.cum.length - 1 && R.cum[i] < s) i++;
  const a = R.pts[i - 1], b = R.pts[i], f = (s - R.cum[i - 1]) / Math.max(1e-6, R.cum[i] - R.cum[i - 1]);
  return [lerp(a[0], b[0], f), lerp(a[1], b[1], f)];
}
function partial(c, R, s) {
  c.beginPath(); c.moveTo(...R.pts[0]);
  for (let i = 1; i < R.pts.length; i++) { if (R.cum[i] <= s) c.lineTo(...R.pts[i]); else { c.lineTo(...along(R, s)); break; } }
  c.stroke();
}
// o: grow (0..1+, how far the network has routed itself), flow (signal speed), t (s), frames: [[x,y,w,h], ...] (node frames: empty boxes), bright (0..1), zoom, cy
export function circuit(c, o) {
  const { grow = 1, flow = 1, t = 0, bright = 1, zoom = 1, ox = 0, oy = 0 } = o;
  c.fillStyle = INK; c.fillRect(0, 0, W, H);
  c.save(); c.translate(540 + ox, 1240 + oy); c.scale(zoom, zoom); c.translate(-540, -1240);
  c.lineCap = 'round'; c.lineJoin = 'round';
  for (const R of ROUTES) {
    const g = clamp((grow * 1.6 - R.t0 * 1.0) / 0.6); if (g <= 0) continue;
    const s = R.L * g;
    c.strokeStyle = `rgba(247,247,242,${0.55 + 0.45 * bright})`; c.lineWidth = R.w; partial(c, R, s);
    c.fillStyle = PAPER;                                                   // the via at the start, the pad when it lands
    c.beginPath(); c.arc(R.pts[0][0], R.pts[0][1], R.w * 1.1 + 3, 0, TAU); c.fill();
    if (g >= 1) { const e = R.pts[R.pts.length - 1]; if (R.pad) c.fillRect(e[0] - R.w * 1.6, e[1] - R.w * 1.6, R.w * 3.2, R.w * 3.2); else { c.beginPath(); c.arc(e[0], e[1], R.w * 1.3 + 3, 0, TAU); c.fill(); c.fillStyle = INK; c.beginPath(); c.arc(e[0], e[1], R.w * 0.5, 0, TAU); c.fill(); } }
    else { const h = along(R, s); c.beginPath(); c.arc(h[0], h[1], R.w * 1.2 + 4, 0, TAU); c.fill(); }   // the routing head
    // signal: dashes running along what is routed
    if (flow > 0 && s > 40) {
      c.save(); c.strokeStyle = INK; c.lineWidth = Math.max(1.5, R.w * 0.45); c.setLineDash([18, 54]);
      c.lineDashOffset = -((t * flow * 420 * R.sp + R.ph * 72) % 72); partial(c, R, s); c.restore();
    }
  }
  if (o.frames) for (const [x, y, w, h] of o.frames) {                  // node frames with nobody in them
    c.fillStyle = INK; c.fillRect(x, y, w, h); c.strokeStyle = PAPER; c.lineWidth = 6; c.strokeRect(x, y, w, h);
    c.lineWidth = 2; c.strokeRect(x + 12, y + 12, w - 24, h - 24);
  }
  c.restore();
}

// ------------------------------------------------------------------ the loop: a feedback diagram that contains itself, zoomed without end
const K = 0.4;                         // each loop's inner copy is K times its size
const BOX = [520, 340];               // the box at depth 0, scale 1
function loopUnit(c, x, y, s, lw, t, flow, onFilm = false) {
  const w = BOX[0] * s, h = BOX[1] * s;
  // the feedback path: out of the right side, down, back under the box, up into the left side
  const m = 0.32 * w, yb = y + h / 2 + 0.38 * h, p = [[x + w / 2, y], [x + w / 2 + m, y], [x + w / 2 + m, yb], [x - w / 2 - m, yb], [x - w / 2 - m, y], [x - w / 2, y]];
  if (onFilm) {                                                          // c20: drawn over a film, the diagram gets an ink keyline so the picture stays seen round it
    c.save(); c.strokeStyle = INK; c.lineWidth = Math.max(3, lw * s * 2.6);
    c.strokeRect(x - w / 2, y - h / 2, w, h); c.beginPath(); c.moveTo(...p[0]); for (const q of p.slice(1)) c.lineTo(...q); c.stroke(); c.restore();
  }
  c.strokeStyle = PAPER; c.lineWidth = Math.max(1, lw * s);
  c.strokeRect(x - w / 2, y - h / 2, w, h);
  c.beginPath(); c.moveTo(...p[0]); for (const q of p.slice(1)) c.lineTo(...q); c.stroke();
  const ah = Math.max(3, 0.06 * h); c.fillStyle = PAPER;               // the arrowhead into the box, and one on the way out
  c.beginPath(); c.moveTo(x - w / 2, y); c.lineTo(x - w / 2 - ah * 1.6, y - ah); c.lineTo(x - w / 2 - ah * 1.6, y + ah); c.fill();
  c.beginPath(); c.moveTo(x + w / 2 + m * 0.7, y); c.lineTo(x + w / 2 + m * 0.7 - ah * 1.6, y - ah); c.lineTo(x + w / 2 + m * 0.7 - ah * 1.6, y + ah); c.fill();
  // the input and output stubs: the loop is fed and feeds on
  if (w > 40 && flow > 0) {                                             // a pulse running round the loop
    c.save(); c.lineWidth = Math.max(1.5, lw * s * 2.2); c.setLineDash([0.06 * w, 0.5 * w]); c.lineDashOffset = -((t * flow * 1.6 * w) % (0.56 * w));
    c.beginPath(); c.moveTo(...p[0]); for (const q of p.slice(1)) c.lineTo(...q); c.stroke(); c.restore();
  }
}
// ph: the zoom phase (each +1 is one level deeper); film(c, rect, level) prints society into the box at that level, or null
export function loop(c, ph, t, flow, film, o = {}) {
  c.fillStyle = INK; c.fillRect(0, 0, W, H);
  const cx = 540, cy = o.cy ?? 1230, f = ph - Math.floor(ph), lv0 = Math.floor(ph);
  const s0 = 4.4 * Math.pow(1 / K, f);                                  // the outermost unit's scale (v10b: doubled, so the nested boxes fill the frame at phone size)
  c.save(); c.lineCap = 'square';
  let s = s0, lv = lv0;
  for (let d = 0; d < 9 && s * BOX[0] > 3; d++, s *= K, lv++) {
    if (s * BOX[0] > 2.6 * W) continue;
    loopUnit(c, cx, cy, s, 7, t, flow);
    if (film && s * BOX[0] > 420 && s * BOX[0] < 1050) {
      const w = BOX[0] * s - 16, h = BOX[1] * s - 16, inner = BOX[0] * s * K * 1.5;
      film(c, [cx - w / 2, cy - h / 2, w, h], lv, inner);
      break;                                                            // society fills the box; the loop goes on inside it
    }
  }
  c.restore();
}

// ------------------------------------------------------------------ c20: the Droste. ONE recursion from THE CCRU IDENTIFIED to AND NOT 'CAPITAL.' (no lid, no label).
// ph: the zoom phase (+1 = one level deeper). Every unit is drawn whole; a unit whose level has film prints it inside its box, and the next unit sits inside
// that film on its own ink panel, so the camera can travel through film into the next loop without a cut.
//   o.film(lv) -> null | (c, rect, lv) prints into the box;  o.wire(c, lv, g) draws on the unit's return wire (g: geometry);  o.bg: false = no ink ground
//   o.alpha: the whole recursion's opacity (the hand-off into the circuit)
export function droste(c, ph, t, flow, o = {}) {
  if (o.bg !== false) { c.fillStyle = INK; c.fillRect(0, 0, W, H); }
  const cx = 540, cy = o.cy ?? 1230, lv0 = Math.floor(ph) - 1, f = ph - Math.floor(ph);
  let s = 4.4 * Math.pow(1 / K, f + 1), lv = lv0, parentFilm = false;
  c.save(); c.lineCap = 'square'; if (o.alpha != null) c.globalAlpha = o.alpha;
  for (let d = 0; d < 11; d++, s *= K, lv++) {
    const w = BOX[0] * s, h = BOX[1] * s;
    if (w < 4) break;
    const m = 0.32 * w, yb = cy + h / 2 + 0.38 * h, lw = Math.max(1, 7 * s);
    if (parentFilm) { c.fillStyle = INK; c.fillRect(cx - w / 2, cy - h / 2, w, h); }   // inside the parent's film only its own box is ink (the film stays seen round it)
    if (w < 4 * W) loopUnit(c, cx, cy, s, 7, t, flow, parentFilm);
    const g = { cx, cy, w, h, m, yb, s, lw, d };
    if (o.wire) o.wire(c, lv, g);
    const fm = o.film ? o.film(lv) : null;
    if (fm && w > 24) { const ins = lw * 0.9; fm(c, [cx - w / 2 + ins, cy - h / 2 + ins, w - 2 * ins, h - 2 * ins], lv); }
    parentFilm = !!fm;
  }
  c.restore();
}
