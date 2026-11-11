// CIVILIZATION c13: the working hand, drawn as a hand. v10's and v12's came from a point cloud and read as a rubber glove (no knuckles, no tendons, a
// pillow for a palm). This one is cut as line work on the piece's own plates, the way a poster artist would: the back of the hand, four fingers cut as
// capsules with nails, joint creases, knuckle arcs, tendons running to the wrist, a thumb that works; the sleeve in black with the cuff in bare stock.
// open -> curl (the fingers foreshorten, knuckles rise, the thumb crosses) is one parameter; the closed fist is its own front-view drawing (the held shot).
import { P, g, W, H, TAU, RED, BLK, GOLD, PAPER, k, r, d, clamp, lerp, ease, rng, fillP, strokeP, rect, circle, poly, lineP } from './empire5.kit.js';

const KEY = 6;                                           // the keyline, px
function capsule(x0, y0, x1, y1, w) {                   // a rounded bar from (x0,y0) to (x1,y1), width w
  const p = new Path2D(), a = Math.atan2(y1 - y0, x1 - x0), nx = -Math.sin(a), ny = Math.cos(a), h = w / 2;
  p.moveTo(x0 + nx * h, y0 + ny * h); p.lineTo(x1 + nx * h, y1 + ny * h); p.arc(x1, y1, h, a + Math.PI / 2, a - Math.PI / 2, true); p.lineTo(x0 - nx * h, y0 - ny * h); p.arc(x0, y0, h, a - Math.PI / 2, a + Math.PI / 2, true); p.closePath(); return p;
}
// body in red, keyline in black, a stone-tint shade on the lower-right, clipped to the form
function form(path, { shade = null } = {}) {
  fillP(path, r(1));
  if (shade) { g.save(); g.clip(path); g.fillStyle = k(0.3); g.fill(shade); g.restore(); }
  strokeP(path, k(1), KEY);
}
function sleeve(cx, y0, w0, w1, y1) {                    // the sleeve: black, with the cuff in two bands of bare stock
  const p = new Path2D(); p.moveTo(cx - w0 / 2, y0); p.lineTo(cx + w0 / 2, y0); p.lineTo(cx + w1 / 2, y1); p.lineTo(cx - w1 / 2, y1); p.closePath();
  fillP(p, k(1));
  g.strokeStyle = PAPER; g.lineWidth = 9; g.beginPath(); g.moveTo(cx - w0 / 2 + 4, y0 + 30); g.lineTo(cx + w0 / 2 - 4, y0 + 30); g.stroke();
  g.lineWidth = 4; g.beginPath(); g.moveTo(cx - w0 / 2 + 6, y0 + 50); g.lineTo(cx + w0 / 2 - 6, y0 + 50); g.stroke();
}

const FX = [-0.375, -0.125, 0.125, 0.375], FL = [0.86, 0.98, 0.9, 0.7], FW = 0.232;
// the open hand, the back of it, fingers up; (cx, ky) = the centre of the knuckle line; S = the palm's width in px; curl 0..1
export function openHand(cx, ky, S, curl = 0, { t = 0 } = {}) {
  const c = ease.inOutCubic(clamp(curl));
  const X = x => cx + x * S, Y = y => ky + y * S;
  // the sleeve and the wrist first, so the hand is over them
  sleeve(cx, Y(0.74), S * 0.8, S * 0.98, Y(0.74) + 1200);
  // thumb: out and up from the base of the palm; with the curl it crosses in
  const tb = [X(-0.43), Y(0.5)], tt = [lerp(X(-0.84), X(-0.3), c), lerp(Y(0.12), Y(0.3), c)];
  const thumb = capsule(tb[0], tb[1], tt[0], tt[1], S * 0.2);
  form(thumb);
  // fingers, little first so the middle two sit over their neighbours
  const order = [3, 0, 2, 1];
  for (const i of order) {
    const L = FL[i] * (1 - 0.66 * c), x = FX[i] * (1 - 0.05 * c), w = FW * (1 + 0.1 * c);
    const p = capsule(X(x), Y(0.06), X(x), Y(-L), S * w);
    const sh = new Path2D(); sh.rect(X(x) + S * w * 0.18, Y(-L) - 20, S * w, (L + 0.2) * S + 40);
    form(p, { shade: sh });
    // nail (bare stock) and the joint creases (cut through the red)
    if (c < 0.7) { const nw = S * w * 0.62, nh = S * 0.15 * (1 - 0.6 * c), nx = X(x) - nw / 2, ny = Y(-L) - S * w / 2 + 6; const np = new Path2D(); np.roundRect(nx, ny, nw, nh, nw * 0.4); g.save(); g.fillStyle = PAPER; g.fill(np); g.strokeStyle = k(1); g.lineWidth = 3.5; g.stroke(np); g.restore(); }
    g.strokeStyle = k(1); g.lineWidth = 4;
    for (const f of [0.34, 0.66]) { const yy = Y(-L * f * 0.9 + 0.02); g.beginPath(); g.moveTo(X(x) - S * w * 0.26, yy); g.quadraticCurveTo(X(x), yy + S * 0.018, X(x) + S * w * 0.26, yy); g.stroke(); }
  }
  // the palm and the back of the hand: one outline, open at the top where the fingers come out
  const pm = new Path2D();
  pm.moveTo(X(-0.5), Y(0.02)); pm.bezierCurveTo(X(-0.52), Y(0.3), X(-0.46), Y(0.55), X(-0.4), Y(0.74)); pm.lineTo(X(0.4), Y(0.74)); pm.bezierCurveTo(X(0.46), Y(0.55), X(0.52), Y(0.3), X(0.5), Y(0.02)); pm.closePath();
  const body = new Path2D(); body.addPath(pm); body.moveTo(X(-0.5), Y(0.02)); body.lineTo(X(0.5), Y(0.02)); body.lineTo(X(0.5), Y(0.2)); body.lineTo(X(-0.5), Y(0.2)); body.closePath();
  fillP(pm, r(1));
  { g.save(); g.clip(pm); const sh = new Path2D(); sh.moveTo(X(0.5), Y(0)); sh.lineTo(X(0.5), Y(0.8)); sh.lineTo(X(0.12), Y(0.8)); sh.bezierCurveTo(X(0.3), Y(0.5), X(0.34), Y(0.25), X(0.3), Y(0)); sh.closePath(); g.fillStyle = k(0.3); g.fill(sh); g.restore(); }
  const edge = new Path2D(); edge.moveTo(X(-0.5), Y(0.02)); edge.bezierCurveTo(X(-0.52), Y(0.3), X(-0.46), Y(0.55), X(-0.4), Y(0.74)); edge.moveTo(X(0.5), Y(0.02)); edge.bezierCurveTo(X(0.52), Y(0.3), X(0.46), Y(0.55), X(0.4), Y(0.74));
  strokeP(edge, k(1), KEY);
  // knuckles: an arc at the root of each finger; tendons running to the wrist
  g.strokeStyle = k(1); g.lineWidth = 4.5;
  for (let i = 0; i < 4; i++) { const x = FX[i]; g.beginPath(); g.ellipse(X(x), Y(0.045), S * 0.1, S * 0.05, 0, Math.PI * 1.08, Math.PI * 1.92); g.stroke(); }
  g.lineWidth = 3.5;
  for (let i = 0; i < 4; i++) { const x = FX[i], xe = x * 0.6; g.beginPath(); g.moveTo(X(x), Y(0.14)); g.quadraticCurveTo(X(lerp(x, xe, 0.4) + 0.012), Y(0.4), X(xe), Y(0.7)); g.stroke(); }
  // the wrist crease where the sleeve starts
  g.lineWidth = 5; g.beginPath(); g.moveTo(X(-0.4), Y(0.72)); g.lineTo(X(0.4), Y(0.72)); g.stroke();
  return { grip: [cx, Y(-0.5 * (1 - 0.5 * c))] };
}

// the closed fist, front view: four knuckles over four curled fingers, the thumb across them, the wrist and the cuff. cx, cy = centre of the fist; S = its width.
export function fist(cx, cy, S, { rays = 0, t = 0 } = {}) {
  const X = x => cx + x * S, Y = y => cy + y * S;
  // light between the knuckles (drawn first: it comes out from behind the fist)
  if (rays > 0) {
    const R = rng(7);
    const gaps = [-0.25, 0, 0.25], ang = [-0.24, 0, 0.24];
    for (let n = 0; n < 7; n++) {
      const gx = X((n - 3) * 0.17), a = -Math.PI / 2 + (n - 3) * 0.2, L = S * (0.3 + 0.2 * ((n * 37) % 5) / 4) * rays, w0 = S * 0.07;
      const ca = Math.cos(a), sa = Math.sin(a), px = -sa, py = ca, p0 = [gx, Y(-0.5)], p1 = [p0[0] + ca * L, p0[1] + sa * L];
      const tri = (grow, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(p0[0] + px * (w0 + grow), p0[1] + py * (w0 + grow)); g.lineTo(p0[0] - px * (w0 + grow), p0[1] - py * (w0 + grow)); g.lineTo(p1[0] + ca * grow, p1[1] + sa * grow); g.closePath(); g.fill(); };
      tri(7, PAPER); tri(0, d(1));
    }
  }
  sleeve(cx, Y(0.46), S * 0.84, S * 1.0, Y(0.46) + 1200);
  // the wrist and the forearm's end, under the fist
  const wr = new Path2D(); wr.rect(X(-0.36), Y(0.2), S * 0.72, S * 0.3); form(wr);
  // the mass of the fist: a rounded block
  const body = new Path2D(); body.roundRect(X(-0.5), Y(-0.52), S, S * 0.84, S * 0.17);
  const sh = new Path2D(); sh.rect(X(0.3), Y(-0.6), S, S * 1.2);
  form(body, { shade: sh });
  // four fingers, curled: each a block with a round tip, separated by black
  for (let i = 0; i < 4; i++) {
    const x = FX[i], p = new Path2D(); p.roundRect(X(x - 0.108), Y(-0.34), S * 0.216, S * 0.5, [S * 0.05, S * 0.05, S * 0.09, S * 0.09]);
    form(p);
    g.strokeStyle = k(1); g.lineWidth = 4; g.beginPath(); g.moveTo(X(x - 0.07), Y(0.0)); g.quadraticCurveTo(X(x), Y(0.02), X(x + 0.07), Y(0.0)); g.stroke();
  }
  // four knuckles on top: round, with a crease
  for (let i = 0; i < 4; i++) { const x = FX[i]; const kk = new Path2D(); kk.arc(X(x), Y(-0.44), S * 0.12, 0, TAU); form(kk);
    g.strokeStyle = k(1); g.lineWidth = 4; g.beginPath(); g.arc(X(x), Y(-0.44), S * 0.065, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
  // the thumb, folded across the fingers' ends, nail on top
  const th = capsule(X(-0.46), Y(0.14), X(0.3), Y(0.07), S * 0.24); form(th);
  const nl = new Path2D(); nl.roundRect(X(0.12), Y(0.0), S * 0.2, S * 0.14, S * 0.05); g.save(); g.fillStyle = PAPER; g.fill(nl); g.strokeStyle = k(1); g.lineWidth = 3.5; g.stroke(nl); g.restore();
  g.strokeStyle = k(1); g.lineWidth = 4; g.beginPath(); g.moveTo(X(-0.1), Y(0.04)); g.quadraticCurveTo(X(-0.05), Y(0.1), X(0.0), Y(0.17)); g.stroke();
  g.lineWidth = 5; g.beginPath(); g.moveTo(X(-0.36), Y(0.46)); g.lineTo(X(0.36), Y(0.46)); g.stroke();
  return { top: [cx, Y(-0.55)] };
}
