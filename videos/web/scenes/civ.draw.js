// CIVILIZATION v15: what is drawn on the one globe. Ink logic (v14's, kept): black = the world and what is gone, red = America (v18: the US and Canada, one red; was the United States only),
// gold = money only (Wall Street and its orders), paper = sea and knock-out. Every mark is flat ink on the plates, hard-edged.
import * as K from './empire5.kit.js';
const { g, P, RED, BLK, GOLD, PAPER, TAU, k, r, d, clamp, lerp, ease, rect, circle, ring, W, H } = K;

const mctx = document.createElement('canvas').getContext('2d');
export function textW(s, size, font = 'Anton') { mctx.font = `${size}px "${font}"`; return mctx.measureText(s).width; }
export const star = (cx, cy, R0, rot = -Math.PI / 2) => { const p = new Path2D(); for (let i = 0; i < 10; i++) { const a = rot + i * Math.PI / 5, rr = i % 2 ? R0 * 0.4 : R0; i ? p.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : p.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } p.closePath(); return p; };

// ---------------------------------------------------------------- the ground
export function drawGround(V, Wd, o = {}) {
  const R = V.cam.R, { ax, ay } = V.cam;
  // graticule: a light stone ruled on the sea, so a moving camera has something to move against
  if (o.grat !== 0 && R < 6000) { g.strokeStyle = k(0.3); g.lineWidth = 2; g.stroke(V.path(Wd.grat)); }
  // the land: 50 m to R 7000, 10 m to R 50000, then the five boroughs' real shoreline (nothing west of the Hudson is drawn: sea)
  const ny = R > 5e4;
  if (!ny) {
    g.fillStyle = k(1); g.fill(V.path(R < 7000 ? Wd.land50 : Wd.land10));
    if (R > 1150 && R < 40000 && o.borders !== 0) { g.strokeStyle = PAPER; g.lineWidth = R > 2500 ? 3 : 2; g.stroke(V.path(Wd.borders)); }
  } else { g.fillStyle = k(1); g.fill(V.path(Wd.nyLand)); }
  // the globe's edge, when it is in the frame
  if (R < 1500 && o.rim !== 0) { g.strokeStyle = k(1); g.lineWidth = 5; g.beginPath(); g.arc(ax, ay, R, 0, TAU); g.stroke(); }
}
export function drawUS(V, Wd, o = {}) {
  const R = V.cam.R; if (R > 5e4) return;          // c20 finish: up to the street switch (was 4e4: R 4e4-5e4 drew America black, a one-frame black flash in each pull-out)
  g.fillStyle = r(o.a ?? 1); g.fill(V.path(Wd.us)); if (Wd.can) g.fill(V.path(Wd.can));     // v18: one red over the US and Canada, no line between them
  if (R > 700 && o.states !== 0) { g.strokeStyle = PAPER; g.lineWidth = R > 2500 ? 3 : 2; g.stroke(V.path(Wd.usStates)); }
}
export function drawLakes(V, Wd) {
  const R = V.cam.R; if (R > 5e4 || R < 1100) return;
  g.fillStyle = PAPER; g.fill(V.path(Wd.lakes));
  g.strokeStyle = k(1); g.lineWidth = 2; g.stroke(V.path(Wd.lakes));
}
export function drawManhattan(V, Wd, o = {}) {
  const mpp = V.mpp;
  const lw = m => Math.max(1.6, m / mpp);
  g.lineCap = 'butt'; g.lineJoin = 'round';
  g.strokeStyle = PAPER;
  g.lineWidth = lw(7); g.stroke(V.path(Wd.streets.minor));
  g.lineWidth = lw(13); g.stroke(V.path(Wd.streets.major));
  g.lineWidth = lw(18); g.stroke(V.path(Wd.streets.hw));
}

// ---------------------------------------------------------------- marks
// a base: a red disc in a paper ring, a paper star when it is big enough to hold one
export function roundel(x, y, s, a = 1) {
  if (a <= 0) return;
  const rr = s * a;
  g.fillStyle = PAPER; g.beginPath(); g.arc(x, y, rr + Math.max(1.6, s * 0.2), 0, TAU); g.fill();
  g.fillStyle = r(1); g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
  if (rr >= 8.5) { g.fillStyle = PAPER; g.fill(star(x, y, rr * 0.62)); }
}
export function dotMark(x, y, s, col = r(1), keyline = true) {
  if (keyline) { g.fillStyle = PAPER; g.beginPath(); g.arc(x, y, s + 3, 0, TAU); g.fill(); }
  g.fillStyle = col; g.beginPath(); g.arc(x, y, s, 0, TAU); g.fill();
}
// a name tag pinned to a point: paper plate, ink border, a leader to the point. side: 'r' | 'l' | 'u' | 'd'
export function tag(text, px, py, { side = 'r', size = 56, ink = 'k', gap = 18, dx = 0, dy = 0, sub = null, subSize = 36, alpha = 1, rot = 0, lead = true, fill = true } = {}) {
  if (alpha <= 0) return null;
  const subs = sub ? (Array.isArray(sub) ? sub : [sub]) : [];
  const col = ink === 'r' ? r(1) : k(1), w1 = textW(text, size), w2 = Math.max(0, ...subs.map(x => textW(x, subSize))), tw = Math.max(w1, w2), pad = 14;
  const bw = tw + pad * 2, bh = size * 0.92 + pad * 2 + subs.length * subSize * 0.95;
  let bx, by;
  if (side === 'r') { bx = px + gap; by = py - bh / 2; } else if (side === 'l') { bx = px - gap - bw; by = py - bh / 2; }
  else if (side === 'u') { bx = px - bw / 2; by = py - gap - bh; } else { bx = px - bw / 2; by = py + gap; }
  bx += dx; by += dy;
  g.save();
  if (rot) { g.translate(px, py); g.rotate(rot); g.translate(-px, -py); }
  if (lead) { g.strokeStyle = col; g.lineWidth = 4; g.beginPath(); g.moveTo(px, py); g.lineTo(clamp(px, bx, bx + bw), clamp(py, by, by + bh)); g.stroke(); }
  g.fillStyle = PAPER; g.fillRect(bx, by, bw, bh);
  g.strokeStyle = col; g.lineWidth = 4; g.strokeRect(bx, by, bw, bh);
  g.fillStyle = col; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.font = `${size}px "Anton"`;
  g.fillText(text, bx + pad, by + pad + size * 0.84);
  subs.forEach((x, i) => { g.font = `${subSize}px "Anton"`; g.fillText(x, bx + pad, by + pad + size * 0.92 + subSize * (0.86 + 0.95 * i)); });
  g.restore();
  return { x: bx, y: by, w: bw, h: bh };
}

// ---------------------------------------------------------------- arcs: a paper casing, an ink core, directional
export function strokeArc(pts, { w = 6, col = k(1), casing = true, dash = null } = {}) {
  const segs = []; let cur = [];
  for (const p of pts) { if (p[2]) cur.push(p); else { if (cur.length > 1) segs.push(cur); cur = []; } }
  if (cur.length > 1) segs.push(cur);
  g.lineCap = 'round'; g.lineJoin = 'round';
  if (dash) g.setLineDash(dash);
  for (const pass of casing ? [0, 1] : [1]) {
    g.strokeStyle = pass === 0 ? PAPER : col; g.lineWidth = pass === 0 ? w + 9 : w;
    for (const s of segs) { g.beginPath(); s.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); }
  }
  if (dash) g.setLineDash([]);
}
// the direction of an arc at index i, in screen radians
export const dirAt = (pts, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };

// ---------------------------------------------------------------- icons (unit-scaled paths; x centre, y base)
const mk = f => { const p = new Path2D(); f(p); return p; };
export const PLANT = mk(p => {
  p.rect(-1, -0.55, 2, 0.55);
  for (let i = 0; i < 3; i++) { const x = -1 + i * 0.6; p.moveTo(x, -0.55); p.lineTo(x, -0.98); p.lineTo(x + 0.6, -0.55); p.closePath(); }
  p.rect(0.62, -1.5, 0.22, 0.98);
});
export const PLANT_WIN = mk(p => { for (let i = 0; i < 4; i++) p.rect(-0.82 + i * 0.46, -0.4, 0.26, 0.22); });
export const SMOKE = mk(p => { p.arc(0.78, -1.72, 0.12, 0, TAU); p.moveTo(0.98, -1.98); p.arc(0.98, -1.98, 0.17, 0, TAU); p.moveTo(1.22, -2.3); p.arc(1.22, -2.3, 0.22, 0, TAU); });
export const HELMET = mk(p => {
  p.moveTo(-1, 0.02); p.bezierCurveTo(-1.02, -0.62, -0.58, -0.96, 0, -0.96); p.bezierCurveTo(0.58, -0.96, 1.02, -0.62, 1, 0.02); p.closePath();
  p.moveTo(-1.3, 0.2); p.bezierCurveTo(-1.28, 0.02, -1.1, -0.02, -0.98, -0.02); p.lineTo(0.98, -0.02); p.bezierCurveTo(1.1, -0.02, 1.28, 0.02, 1.3, 0.2); p.closePath();
});
export const HARDHAT = mk(p => {
  p.moveTo(-0.95, 0); p.bezierCurveTo(-0.95, -0.74, -0.52, -1.02, 0, -1.02); p.bezierCurveTo(0.52, -1.02, 0.95, -0.74, 0.95, 0); p.closePath();
  p.moveTo(-1.08, 0.0); p.lineTo(1.25, 0.0); p.bezierCurveTo(1.5, 0.0, 1.7, 0.08, 1.74, 0.2); p.lineTo(1.6, 0.27); p.bezierCurveTo(1.35, 0.2, 1.2, 0.2, 1.1, 0.2); p.lineTo(-1.0, 0.2); p.bezierCurveTo(-1.12, 0.2, -1.14, 0.0, -1.08, 0.0); p.closePath();
});
export function icon(path, x, y, s, col, { casing = true, flip = 1, rot = 0 } = {}) {
  g.save(); g.translate(x, y); if (rot) g.rotate(rot); g.scale(s * flip, s);
  if (casing) { g.strokeStyle = PAPER; g.lineWidth = 7 / s; g.lineJoin = 'round'; g.stroke(path); g.fillStyle = PAPER; g.fill(path); }
  g.fillStyle = col; g.fill(path);
  g.restore();
}
export function plantIcon(x, y, s, { lit = false, casing = true, smoke = false } = {}) {
  g.save(); g.translate(x, y); g.scale(s, s);
  if (casing) { g.strokeStyle = PAPER; g.lineWidth = 7 / s; g.lineJoin = 'round'; g.stroke(PLANT); g.fillStyle = PAPER; g.fill(PLANT); }
  g.fillStyle = lit ? r(1) : k(1); g.fill(PLANT);
  if (lit) { g.fillStyle = PAPER; g.fill(PLANT_WIN); }
  if (smoke) { g.fillStyle = k(0.3); g.fill(SMOKE); }
  g.restore();
}

// ---------------------------------------------------------------- c20: the M1, the one object of the piece
// The base mark is the GI's M1 steel helmet, not a disc or a stamp. It is modelled, not drawn: a steel shell (a dome a little longer
// front to back than side to side, its skirt flaring and dropping at the back) and its rim, sampled in 3D, turned and tilted, and
// projected; the outline is the projected points' convex hull and the visible front of the rim is the paper line across it.
// (lib/fx/headwear.js has the person pipeline's hard hat but no M1, and it builds THREE meshes for people.js heads; this is the
// same idea in the piece's flat inks, kept in the piece's own file.)
function hull(pts) {
  const P0 = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of P0) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = P0.length - 1; i >= 0; i--) { const p = P0[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function m1Model(pitch, yaw) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
  const pr = ([x, y, z]) => { const x1 = x * cy - z * sy, z1 = x * sy + z * cy; return [x1, -(y * cp - z1 * sp), z1 * cp + y * sp]; };
  const shell = [], rim = [];
  for (let i = 0; i < 48; i++) {
    const th = i / 48 * TAU, cz = Math.sin(th), cx = Math.cos(th), back = Math.max(0, -cz);
    for (let j = 0; j <= 10; j++) { const ph = j / 10 * Math.PI / 2; shell.push(pr([Math.cos(ph) * cx * 0.96, 0.08 + Math.sin(ph) * 0.8, Math.cos(ph) * cz * 1.08])); }
    rim.push(pr([cx * (1.06 + 0.06 * back), -0.02 - 0.12 * back * back, cz * (1.16 + 0.04 * back)]));   // the skirt: wider and lower at the back
  }
  const out = hull(shell.concat(rim)), path = new Path2D();
  out.forEach((p, i) => i ? path.lineTo(p[0], p[1]) : path.moveTo(p[0], p[1])); path.closePath();
  const front = new Path2D(); let on = false;                       // the visible front of the rim, as one stroke
  const rs = rim.concat([rim[0]]);
  rs.forEach(p => { if (p[2] > 0.02) { on ? front.lineTo(p[0], p[1]) : front.moveTo(p[0], p[1]); on = true; } else on = false; });
  const ys = out.map(p => p[1]), xs = out.map(p => p[0]);
  return { path, front, w: Math.max(...xs) - Math.min(...xs), top: Math.min(...ys), bot: Math.max(...ys) };
}
export const M1 = m1Model(0.62, -0.5);          // three-quarter from above: the base mark
export const M1_SIDE = m1Model(0.1, -Math.PI / 2);   // in profile, front to +x: on a returning soldier's head
// a helmet: s = its half-width in px; col its ink; o.rim draws the paper line along the visible rim
export function m1(x, y, s, col = r(1), { rim = true, casing = true, rot = 0, model = M1, flip = 1 } = {}) {
  if (s <= 0.3) return;
  g.save(); g.translate(x, y); if (rot) g.rotate(rot); g.scale(s * flip, s);
  if (casing) { g.strokeStyle = PAPER; g.lineWidth = Math.min(0.6, 5 / s); g.lineJoin = 'round'; g.stroke(model.path); }
  g.fillStyle = col; g.fill(model.path);
  if (rim && s >= 7) { g.strokeStyle = PAPER; g.lineWidth = Math.min(0.16, 2.4 / s); g.lineCap = 'round'; g.stroke(model.front); }
  g.restore();
}

// ---------------------------------------------------------------- c20: Akron at street scale (the second dive), TIGER/Line streets
export function drawAkron(V, AK, o = {}) {
  const mpp = V.mpp, lw = m => Math.max(1.6, m / mpp);
  g.fillStyle = r(1); g.fillRect(-20, -20, W + 40, H + 40);          // c20 finish: Ohio's own red, so the pull-out has no jump
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = PAPER;
  g.lineWidth = lw(16); g.stroke(V.path(AK.water));                 // the Little Cuyahoga and the canal
  g.fillStyle = PAPER; g.fill(V.path(AK.lakes));
  g.lineWidth = lw(9); g.stroke(V.path(AK.streets.minor));
  g.lineWidth = lw(16); g.stroke(V.path(AK.streets.major));
  g.setLineDash([lw(6), lw(5)]); g.lineWidth = lw(5); g.stroke(V.path(AK.rails)); g.setLineDash([]);
}
