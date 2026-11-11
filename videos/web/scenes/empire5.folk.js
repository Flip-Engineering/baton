// CIVILIZATION c15: the guard is a person. One man, drawn once, in every appearance of the piece: from behind in the gallery (v12's figure, kept), turned
// about (front, with a face), under the hard hat, and walking out. Flat inks only: paper is his skin (a knock-out), a light stone and a ruled hatch carry
// his shade, black is the jacket and the helmet, gold the rim the picture lights throw. Everything is in units of H (feet to crown = 1) or of S
// (face width = 0.11 H) so the face holds at any push-in. He is from Akron: the sleeve flash says OHIO, and the board later says where he lands.
import * as K from './empire5.kit.js';
import { guardBack } from './empire5.shots1.js';
const { P, g, RED, BLK, GOLD, PAPER, TAU, k, r, d, W, H, clamp, lerp, ease, fillP, rect, circle, ring, lineP, strokeP, poly, text, knock, mkPath, xf } = K;

const P2 = f => { const q = new Path2D(); f(q); return q; };
const star = (q, x, y, rad) => { for (let j = 0; j < 10; j++) { const rr = j % 2 ? rad * 0.4 : rad, a = -Math.PI / 2 + j * Math.PI / 5; j ? q.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)) : q.moveTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); } q.closePath(); };

// ---------------------------------------------------------------- the head, in face units (origin: the eye line, on the centre; face width = 1)
const FACE = P2(q => { q.moveTo(-0.47, -0.42); q.bezierCurveTo(-0.52, -0.1, -0.5, 0.2, -0.42, 0.42); q.bezierCurveTo(-0.34, 0.66, -0.2, 0.78, 0, 0.8);
  q.bezierCurveTo(0.2, 0.78, 0.34, 0.66, 0.42, 0.42); q.bezierCurveTo(0.5, 0.2, 0.52, -0.1, 0.47, -0.42); q.bezierCurveTo(0.3, -0.62, -0.3, -0.62, -0.47, -0.42); q.closePath(); });
const SHADE_L = P2(q => { q.moveTo(-0.6, -0.7); q.lineTo(-0.1, -0.5); q.lineTo(-0.15, 0.0); q.lineTo(-0.06, 0.3); q.lineTo(-0.2, 0.42); q.lineTo(-0.16, 0.7); q.lineTo(-0.1, 0.9); q.lineTo(-0.7, 0.9); q.closePath(); });
const NECK = P2(q => { q.moveTo(-0.34, 0.5); q.lineTo(-0.36, 1.2); q.lineTo(0.36, 1.2); q.lineTo(0.34, 0.5); q.closePath(); });

function hatchLines(cx, cy, w, h, pitch, ang, col, lw) {
  g.save(); g.strokeStyle = col; g.lineWidth = lw; g.beginPath();
  const n = Math.ceil((w + h) / pitch);
  for (let i = -n; i <= n; i++) { const o = i * pitch; g.moveTo(cx - w + o, cy + h); g.lineTo(cx - w + o + h * 2 * Math.tan(ang), cy - h); }
  g.stroke(); g.restore();
}

// the head with a hat. `hat`: 'helmet' | 'hard' | 'none'; `lookX` shifts the pupils; `lift` raises the hat off the head (the swap)
export function head(cx, cy, S, { hat = 'helmet', lookX = 0, hatLift = 0, hatRot = 0, hatShow = 1, mouth = 0 } = {}) {
  g.save(); g.translate(cx, cy); g.scale(S, S); g.lineJoin = 'round'; g.lineCap = 'round';
  // neck and collar
  knock(NECK, 0); g.fillStyle = PAPER; g.fill(NECK); g.strokeStyle = k(1); g.lineWidth = 0.04; g.stroke(NECK);
  g.save(); g.clip(NECK); g.fillStyle = k(0.3); g.fillRect(-0.5, 0.5, 1, 0.7); g.fillStyle = k(0.3); g.fillRect(-0.5, 0.5, 1.0, 0.1); hatchLines(0, 0.78, 0.5, 0.3, 0.05, 0.7, k(0.62), 0.016); g.restore();
  // ears
  for (const sx of [-1, 1]) { const e = P2(q => q.ellipse(sx * 0.52, 0.08, 0.08, 0.17, sx * 0.12, 0, TAU)); knock(e, 0); g.fillStyle = PAPER; g.fill(e); g.strokeStyle = k(1); g.lineWidth = 0.04; g.stroke(e);
    g.beginPath(); g.arc(sx * 0.53, 0.09, 0.03, 0, TAU); g.strokeStyle = k(1); g.lineWidth = 0.025; g.stroke(); }
  // the face: paper, a keyline, the light stone on the shadow side, a ruled hatch on the jaw
  knock(FACE, 0); g.fillStyle = PAPER; g.fill(FACE);
  g.save(); g.clip(FACE); g.fillStyle = k(0.3); g.fill(SHADE_L); hatchLines(-0.33, 0.62, 0.2, 0.25, 0.06, 0.6, k(0.62), 0.012);
  // the cheek-bone plane and the shade under the lower lip
  g.fillStyle = k(0.3); g.beginPath(); g.moveTo(0.44, 0.25); g.quadraticCurveTo(0.3, 0.36, 0.22, 0.62); g.lineTo(0.5, 0.7); g.closePath(); g.fill();
  g.restore();
  g.strokeStyle = k(1); g.lineWidth = 0.05; g.stroke(FACE);
  // eyes: the socket shade, the lid, the white, the iris, the catch-light
  for (const sx of [-1, 1]) {
    const ex = sx * 0.235, ey = 0.0;
    g.fillStyle = k(0.3); g.beginPath(); g.ellipse(ex, ey - 0.03, 0.15, 0.07, 0, 0, TAU); g.fill();
    const eye = P2(q => { q.moveTo(ex - 0.115, ey + 0.012); q.quadraticCurveTo(ex, ey - 0.098, ex + 0.115, ey + 0.012); q.quadraticCurveTo(ex, ey + 0.07, ex - 0.115, ey + 0.012); q.closePath(); });
    g.fillStyle = PAPER; g.fill(eye);
    g.save(); g.clip(eye); g.fillStyle = k(1); g.beginPath(); g.arc(ex + lookX * 0.03, ey + 0.005, 0.052, 0, TAU); g.fill();
    g.fillStyle = PAPER; g.beginPath(); g.arc(ex + lookX * 0.03 + 0.018, ey - 0.012, 0.014, 0, TAU); g.fill(); g.restore();
    g.strokeStyle = k(1); g.lineWidth = 0.032; g.stroke(eye);
    g.lineWidth = 0.05; g.beginPath(); g.moveTo(ex - 0.125, ey + 0.012); g.quadraticCurveTo(ex, ey - 0.108, ex + 0.125, ey + 0.012); g.stroke();   // the upper lid, heavy
    // the brow: a black wedge, lower at the nose
    g.fillStyle = k(1); g.beginPath(); g.moveTo(sx * 0.07, -0.135); g.quadraticCurveTo(sx * 0.25, -0.215, sx * 0.43, -0.2); g.lineTo(sx * 0.43, -0.16); g.quadraticCurveTo(sx * 0.25, -0.15, sx * 0.07, -0.085); g.closePath(); g.fill();
  }
  // nose: the bridge on the shadow side, the wing, the nostrils, the shade under it
  g.strokeStyle = k(1); g.lineWidth = 0.036; g.beginPath(); g.moveTo(-0.07, -0.06); g.quadraticCurveTo(-0.1, 0.12, -0.13, 0.24); g.stroke();
  g.lineWidth = 0.03; g.beginPath(); g.moveTo(0.06, 0.12); g.quadraticCurveTo(0.1, 0.2, 0.12, 0.25); g.stroke();
  g.beginPath(); g.moveTo(-0.14, 0.26); g.quadraticCurveTo(-0.07, 0.33, 0, 0.3); g.quadraticCurveTo(0.07, 0.33, 0.14, 0.26); g.stroke();
  g.fillStyle = k(1); for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(sx * 0.052, 0.285, 0.03, 0.017, sx * 0.3, 0, TAU); g.fill(); }
  g.fillStyle = k(0.3); g.beginPath(); g.moveTo(-0.15, 0.3); g.quadraticCurveTo(0, 0.4, 0.15, 0.3); g.lineTo(0.1, 0.4); g.quadraticCurveTo(0, 0.43, -0.1, 0.4); g.closePath(); g.fill();
  // the mouth: a set line, the corners down a hair, the lower lip in stone
  const mo = mouth * 0.04;
  g.strokeStyle = k(1); g.lineWidth = 0.05; g.beginPath(); g.moveTo(-0.16, 0.5 - mo); g.quadraticCurveTo(-0.07, 0.47, 0, 0.48); g.quadraticCurveTo(0.07, 0.47, 0.16, 0.5 - mo); g.stroke();
  g.lineWidth = 0.034; g.beginPath(); g.moveTo(-0.1, 0.55); g.quadraticCurveTo(0, 0.6 + mo, 0.1, 0.55); g.stroke();
  // the jaw line and a cleft
  g.lineWidth = 0.03; g.beginPath(); g.moveTo(-0.02, 0.66); g.lineTo(0.02, 0.66); g.stroke();
  g.restore();
  if (hat !== 'none' && hatShow > 0) hatOn(cx, cy, S, hat, hatLift, hatRot);
}

// ---------------------------------------------------------------- the hats
const HELMET = P2(q => { q.moveTo(-0.7, -0.2); q.bezierCurveTo(-0.72, -0.85, -0.4, -1.22, 0, -1.22); q.bezierCurveTo(0.4, -1.22, 0.72, -0.85, 0.7, -0.2);
  q.quadraticCurveTo(0.86, -0.14, 0.88, -0.06); q.quadraticCurveTo(0.4, -0.2, 0, -0.17); q.quadraticCurveTo(-0.4, -0.2, -0.88, -0.06); q.quadraticCurveTo(-0.86, -0.14, -0.7, -0.2); q.closePath(); });
const HARD = P2(q => { q.moveTo(-0.66, -0.2); q.bezierCurveTo(-0.7, -0.78, -0.4, -1.14, 0, -1.14); q.bezierCurveTo(0.4, -1.14, 0.7, -0.78, 0.66, -0.2);
  q.quadraticCurveTo(0.9, -0.16, 0.92, -0.04); q.quadraticCurveTo(0.45, -0.2, 0, -0.17); q.quadraticCurveTo(-0.45, -0.2, -0.92, -0.04); q.quadraticCurveTo(-0.9, -0.16, -0.66, -0.2); q.closePath(); });
function hatOn(cx, cy, S, hat, lift, rot) {
  g.save(); g.translate(cx, cy + lift * S); g.rotate(rot); g.scale(S, S); g.lineJoin = 'round'; g.lineCap = 'round';
  if (hat === 'helmet') {
    // the rim light first (up and right), then the knock-out, then the pot, black, with a gold lip on its edge and the strap
    knock(HELMET, 0); g.save(); g.translate(0.03, -0.03); g.fillStyle = d(1); g.fill(HELMET); g.restore();
    g.fillStyle = k(1); g.fill(HELMET);
    g.save(); g.clip(HELMET); g.strokeStyle = d(1); g.lineWidth = 0.05; g.beginPath(); g.moveTo(0.1, -1.19); g.bezierCurveTo(0.45, -1.16, 0.69, -0.9, 0.69, -0.4); g.stroke();
    g.strokeStyle = PAPER; g.lineWidth = 0.02; g.beginPath(); g.moveTo(-0.72, -0.27); g.quadraticCurveTo(0, -0.3, 0.72, -0.27); g.stroke(); g.restore();
    // the chin strap down both cheeks, a brass buckle at the viewer's left
    g.strokeStyle = k(1); g.lineWidth = 0.075; g.beginPath(); g.moveTo(-0.66, -0.12); g.quadraticCurveTo(-0.6, 0.3, -0.22, 0.78); g.quadraticCurveTo(0, 0.88, 0.22, 0.78); g.quadraticCurveTo(0.6, 0.3, 0.66, -0.12); g.stroke();
  } else {
    knock(HARD, 0); g.fillStyle = d(1); g.fill(HARD);
    g.save(); g.clip(HARD); g.fillStyle = k(0.3); g.beginPath(); g.moveTo(0.05, -1.2); g.lineTo(0.9, -1.2); g.lineTo(0.9, 0); g.lineTo(0.5, 0); g.quadraticCurveTo(0.6, -0.7, 0.3, -1.1); g.closePath(); g.fill();
    // the ridges down the crown
    g.strokeStyle = k(1); g.lineWidth = 0.03; for (const x of [-0.13, 0.13]) { g.beginPath(); g.moveTo(x * 0.9, -1.13); g.quadraticCurveTo(x * 1.1, -0.6, x * 1.25, -0.2); g.stroke(); }
    g.restore();
    g.strokeStyle = k(1); g.lineWidth = 0.05; g.stroke(HARD);
    g.lineWidth = 0.025; g.beginPath(); g.moveTo(-0.7, -0.23); g.quadraticCurveTo(0, -0.27, 0.7, -0.23); g.stroke();
    // the decal: the garrison's roundel, a red disc and a paper star, now on the work hat
    g.fillStyle = PAPER; g.beginPath(); g.arc(0, -0.58, 0.27, 0, TAU); g.fill(); g.fillStyle = r(1); g.beginPath(); g.arc(0, -0.58, 0.23, 0, TAU); g.fill();
    g.fillStyle = PAPER; g.beginPath(); star(g, 0, -0.575, 0.18); g.fill();
  }
  g.restore();
}

// ---------------------------------------------------------------- the body from the front: the back figure's jacket and legs, with the front's details
// parts (H units, origin at the feet): jacket, rifle, details. `cx, fy` = feet centre; the head sits at (cx, fy - 0.848 H) with S = 0.11 H.
export function figureFront(cx, fy, Hh, { hat = 'helmet', hatLift = 0, hatRot = 0, hatShow = 1, lookX = 0, arms = 'rest', rifle = true, rim = true } = {}) {
  const pcs = guardBack(cx, fy, Hh, 0), jacket = pcs[2];
  // the rifle's sling shows on the viewer's left from the front: mirror the rifle
  const rif = rifle ? xf(pcs[3], 0, 0, -1, 1) : null;
  const mir = new Path2D(); mir.addPath(pcs[3], new DOMMatrix().translateSelf(2 * cx, 0).scaleSelf(-1, 1));
  const body = [jacket];
  if (rifle) body.push(mir);
  if (rim) for (const p of body) { g.save(); g.translate(Hh * 0.007, -Hh * 0.006); g.fillStyle = d(1); g.fill(p); g.restore(); }
  for (const p of body) knock(p, 0);
  if (rim) for (const p of body) { g.save(); g.translate(Hh * 0.007, -Hh * 0.006); g.fillStyle = d(1); g.fill(p); g.restore(); }
  for (const p of body) fillP(p, k(1));
  // front details, cut in bare stock and gold: the collar, the placket, the pockets, the belt, the flash
  g.save(); g.translate(cx, fy); g.scale(Hh, Hh); g.lineJoin = 'round';
  g.fillStyle = PAPER; g.beginPath(); g.moveTo(-0.052, -0.866); g.lineTo(0, -0.79); g.lineTo(0.052, -0.866); g.closePath(); g.fill();       // the shirt at the throat
  g.strokeStyle = PAPER; g.lineWidth = 0.004; g.beginPath(); g.moveTo(-0.052, -0.866); g.lineTo(-0.1, -0.8); g.lineTo(-0.02, -0.762); g.moveTo(0.052, -0.866); g.lineTo(0.1, -0.8); g.lineTo(0.02, -0.762); g.stroke();  // lapel
  g.beginPath(); g.moveTo(0, -0.79); g.lineTo(0, -0.46); g.stroke();                                                                          // the placket
  g.fillStyle = PAPER; for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(0.016, -0.74 + i * 0.062, 0.0075, 0, TAU); g.fill(); }
  g.lineWidth = 0.004; for (const sx of [-1, 1]) { g.strokeRect(sx > 0 ? 0.045 : -0.115, -0.7, 0.07, 0.07); g.beginPath(); g.moveTo(sx * 0.045, -0.7); g.lineTo(sx * 0.11, -0.7); g.stroke(); }
  g.fillStyle = k(1); g.fillRect(-0.12, -0.476, 0.24, 0.022); g.fillStyle = d(1); g.fillRect(-0.017, -0.481, 0.034, 0.032);                   // belt, brass buckle
  // the sleeve flash on his left shoulder (the viewer's right): a gold-edged tab, OHIO
  g.fillStyle = PAPER; g.fillRect(0.04, -0.752, 0.085, 0.032); g.fillStyle = k(1); g.fillRect(0.043, -0.749, 0.079, 0.026);
  g.restore();
  text('AKRON', cx + 0.0825 * Hh, fy - 0.7285 * Hh, 0.0215 * Hh, PAPER, { font: 'Oswald' });
  head(cx, fy - 0.848 * Hh, 0.11 * Hh, { hat, lookX, hatLift, hatRot, hatShow });
}

// ---------------------------------------------------------------- the work hat on the same man from behind (b62-): no rifle, a lunch pail in his hand
export function workerBack(cx, fy, Hh, { stride = 0 } = {}) {
  const pcs = guardBack(cx, fy, Hh, 0), body = [pcs[1], pcs[2]];
  for (const p of body) { g.save(); g.translate(Hh * 0.007, -Hh * 0.006); g.fillStyle = d(1); g.fill(p); g.restore(); }
  for (const p of body) knock(p, 0);
  for (const p of body) { g.save(); g.translate(Hh * 0.007, -Hh * 0.006); g.fillStyle = d(1); g.fill(p); g.restore(); }
  for (const p of body) fillP(p, k(1));
  // the hard hat, from behind: a dome, the ridge, the drip rim
  g.save(); g.translate(cx, fy - 0.898 * Hh); g.scale(0.11 * Hh, 0.11 * Hh);
  const dome = P2(q => { q.moveTo(-0.7, 0.0); q.bezierCurveTo(-0.74, -0.7, -0.4, -1.08, 0, -1.08); q.bezierCurveTo(0.4, -1.08, 0.74, -0.7, 0.7, 0.0); q.quadraticCurveTo(0.9, 0.04, 0.92, 0.16); q.quadraticCurveTo(0, 0.12, -0.92, 0.16); q.quadraticCurveTo(-0.9, 0.04, -0.7, 0.0); q.closePath(); });
  g.save(); g.translate(0.03, -0.03); g.fillStyle = d(0.5); g.fill(dome); g.restore();
  g.fillStyle = d(1); g.fill(dome); g.strokeStyle = k(1); g.lineWidth = 0.05; g.lineJoin = 'round'; g.stroke(dome);
  g.lineWidth = 0.03; g.beginPath(); g.moveTo(0, -1.06); g.lineTo(0, -0.08); g.stroke();
  g.restore();
  // the lunch pail, in the right hand, at the thigh
  const px = cx + 0.17 * Hh, py = fy - 0.43 * Hh + stride * Hh * 0.01;
  g.save(); g.translate(px, py); g.scale(Hh, Hh); g.fillStyle = k(1); g.fillRect(-0.034, 0, 0.068, 0.05); g.strokeStyle = k(1); g.lineWidth = 0.008; g.beginPath(); g.moveTo(-0.03, 0); g.quadraticCurveTo(0, -0.05, 0.03, 0); g.stroke(); g.restore();
}

// ---------------------------------------------------------------- the gallery's red wall with its paintings, one camera (zoom z about fx0, fy0): for the guard's shots
export { };
