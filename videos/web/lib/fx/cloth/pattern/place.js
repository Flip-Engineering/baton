// PATTERN / PLACE (CLOTHING c2, lane K2): flat panels -> their 3D start positions round a person's body, in the hero's BIND frame
// (x the wearer's left, y up, z forward; metres at the person's stature), clear of the skin, right side out. The sewing phase (K1's
// sew.js, or K2's stand-in) closes the seams from here.
//
// The method is GarmentCodeData's "box mesh" placement made body-aware: each panel is wrapped round the body segment it belongs to
// (GarmentCode's placement by body part), keeping its flat lengths where it can:
//   torso   u (across) -> arc length round an ellipse fitted at each height to the body's own section plus clearance, scaled so the
//           panel's side seam lands on the body's side line (centre front / back at u = 0); v (down the pattern) -> height from the
//           HPS (all Brian-block panels share FreeSewing's frame: y = 0 at the HPS line). Above the armhole the panel turns smoothly
//           onto the shoulder line (HPS -> acromion, just above the skin), so a front and a yoke start with their shoulder seams
//           together over the shoulder instead of in front of and behind it.
//   arm     a cylinder round the arm's axis (shoulder joint -> wrist joint, lane A's p.kin.joints), the underarm seam underneath,
//           the front notch forward, the cap's top at the acromion.
//   neck    a ring round the neck's base (a band collar), the band's centre at the back.
//   wrist   a ring round the wrist (a cuff), the edge that joins the sleeve toward the elbow.
//   waist / leg (trousers: titan.js sewmap) are added with those designs.
//
//   const B = bodyFrame(p, { positions })          // lane A person (+ the supported bust's positions); cached slices, joints, landmarks
//   const X0 = placeGarment(g, B, { clear: 0.012 })  // Float64Array(g.n * 3)
import { triSet, slicePlane } from '../../body/measure.js';
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = a => Math.hypot(a[0], a[1], a[2]), nrm = a => scl(a, 1 / (len(a) || 1)), cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp = (a, b, t) => a + (b - a) * t, smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);

// ---------------------------------------------------------------- the body as placement needs it
export function bodyFrame(p, { positions = null, T = null } = {}) {
  const S = p._S, P = positions || p.built.pos, L = k => { const v = S.landmarks[k]; return [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]; };
  const trunk = triSet(S, [1, 2, 7]), J = p.kin?.joints || {};
  // torso sections every 1 cm: half-width, front and back z (arms are other regions and stay out)
  let y0 = Infinity, y1 = -Infinity; for (let v = 0; v < S.nb; v++) { const r = S.region[v]; if (r === 2 || r === 7 || r === 1) { y0 = Math.min(y0, P[v * 3 + 1]); y1 = Math.max(y1, P[v * 3 + 1]); } }
  // each section's convex hull in (x, z), symmetrised (the max of the two sides: a garment is cut symmetric), as the wrap curve
  const sec = []; for (let y = y0 + 0.005; y < y1; y += 0.01) { const q = slicePlane(S, P, trunk, [0, y, 0], [0, 1, 0]); if (q.length < 6) { sec.push(null); continue; }
    let xa = 0, zf = -Infinity, zb = Infinity; const pts = []; for (const s of q) { const x = s[2], z = -s[0]; xa = Math.max(xa, Math.abs(x)); zf = Math.max(zf, z); zb = Math.min(zb, z); pts.push([Math.abs(x), z], [-Math.abs(x), z]); }
    sec.push({ y, a: xa, zf, zb, hull: hull2(pts) }); }
  const at = y => { const i = Math.max(0, Math.min(sec.length - 1, Math.round((y - y0 - 0.005) / 0.01))); for (let d = 0; d < sec.length; d++) { const s = sec[i - d] || sec[i + d]; if (s) return s; } throw new Error('bodyFrame: no torso sections'); };
  // the HPS (T: tailor's result has it; else the highest torso point just outside the neck)
  const hpsL = T?.points?.hpsL || L('clavicleMidL'), hpsR = T?.points?.hpsR || L('clavicleMidR');
  const wrists = { L: J.WJC_L || L('ulnarHeadL'), R: J.WJC_R || L('ulnarHeadR') }, shoulders = { L: J.SJC_L || L('acromionL'), R: J.SJC_R || L('acromionR') }, elbows = { L: J.EJC_L || L('olecranonL'), R: J.EJC_R || L('olecranonR') };
  // the arm's radius along its axis (max distance of arm vertices from the axis, per 2 cm)
  const armR = side => { const s = shoulders[side], w = wrists[side], ax = nrm(sub(w, s)), Lw = len(sub(w, s)), R = new Float64Array(Math.ceil(Lw / 0.02) + 2), sg = side === 'L' ? 1 : -1;
    for (let v = 0; v < S.nb; v++) { const r = S.region[v]; if (r !== 3 && r !== 4) continue; if (Math.sign(P[v * 3]) !== sg) continue; const q = sub([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], s), t = q[0] * ax[0] + q[1] * ax[1] + q[2] * ax[2]; if (t < -0.05 || t > Lw + 0.02) continue;
      const d = len(sub(q, scl(ax, t))), k = Math.max(0, Math.min(R.length - 1, Math.round(t / 0.02))); R[k] = Math.max(R[k], d); }
    return { s, w, ax, L: Lw, R }; };
  // legs: the axis hip joint -> ankle joint, the leg's radius along it (thigh and shin regions, per 2 cm)
  const legR = side => { const h0 = J['HJC_' + side] || L('trochanter' + side), a0 = J['AJC_' + side] || L('latMalleolus' + side), ax = nrm(sub(a0, h0)), Lw = len(sub(a0, h0)), R = new Float64Array(Math.ceil(Lw / 0.02) + 2), sg = side === 'L' ? 1 : -1;
    for (let v = 0; v < S.nb; v++) { const r = S.region[v]; if (r !== 8 && r !== 9) continue; if (Math.sign(P[v * 3]) !== sg) continue; const q = sub([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], h0), t = q[0] * ax[0] + q[1] * ax[1] + q[2] * ax[2]; if (t < -0.02 || t > Lw + 0.02) continue;
      const d = len(sub(q, scl(ax, t))), k = Math.max(0, Math.min(R.length - 1, Math.round(t / 0.02))); R[k] = Math.max(R[k], d); }
    for (let k = 1; k < R.length; k++) if (!R[k]) R[k] = R[k - 1]; return { h: h0, a: a0, ax, L: Lw, R }; };
  const c7 = L('cervicale'), ss = L('suprasternale');
  let floor = Infinity; for (let v = 0; v < S.nb; v++) floor = Math.min(floor, P[v * 3 + 1]);
  return { S, P, at, sec, floor, levels: T?.levels || null, leg: { L: legR('L'), R: legR('R') }, hps: { L: hpsL, R: hpsR }, acr: { L: L('acromionL'), R: L('acromionR') }, arm: { L: armR('L'), R: armR('R') }, wrists, shoulders, elbows,
    neck: { c7, ss, center: scl(add(c7, ss), 0.5), r: T?.mm?.neck ? T.mm.neck / 2000 / Math.PI : 0.06 }, landmark: L };
}

// convex hull (x, z), counter-clockwise
function hull2(pts) { const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1)); }
// the hull offset by `clear` and walked from the front (or back) midline toward +x: a function arc fraction f in [0, 1] (0 = midline,
// 1 = the side, x max) -> [x, z]; the half-perimeter is returned too
function hullWalk(H, clear, front) {
  const n = H.length, O = H.map((p, i) => { const a = H[(i - 1 + n) % n], b = H[(i + 1) % n], t = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(t[0], t[1]) || 1; return [p[0] + t[1] / l * clear, p[1] - t[0] / l * clear]; });
  // where the offset hull crosses the midline x = 0: the front (max z) and back (min z) points
  let zF = -Infinity, zB = Infinity; for (let i = 0; i < n; i++) { const a = O[i], b = O[(i + 1) % n]; if ((a[0] <= 0 && b[0] >= 0) || (a[0] >= 0 && b[0] <= 0)) { const t = Math.abs(b[0] - a[0]) > 1e-9 ? -a[0] / (b[0] - a[0]) : 0, z = a[1] + (b[1] - a[1]) * t; zF = Math.max(zF, z); zB = Math.min(zB, z); } }
  if (!isFinite(zF)) { zF = Math.max(...O.map(p => p[1])); zB = Math.min(...O.map(p => p[1])); }
  const zc = (zF + zB) / 2, ang = p => Math.atan2(p[0], p[1] - zc);       // 0 at the front, pi at the back, the +x half between
  const side = O.reduce((m, p) => p[0] > m[0] ? p : m, [-Infinity, 0]), aS = ang(side);
  const half = O.filter(p => p[0] > 1e-5).map(p => [p, ang(p)]).filter(([, a]) => front ? a < aS : a > aS).sort((x, y) => front ? x[1] - y[1] : y[1] - x[1]).map(q => q[0]);
  const path = [[0, front ? zF : zB], ...half, side];
  const cum = [0]; for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const L = cum[cum.length - 1] || 1e-6;
  return { L, at: f => { const d = Math.max(0, Math.min(1, f)) * L; let i = 1; while (i < cum.length - 1 && cum[i] < d) i++; const t = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t]; } };
}
// arc length on an ellipse (semi-axes a in x, b in z): angle for a given arc length from the front (theta 0 = +z)
function ellipse(a, b, n = 96) { const s = [0]; let L = 0, px = 0, pz = b; for (let i = 1; i <= n; i++) { const t = Math.PI * i / n, x = a * Math.sin(t), z = b * Math.cos(t); L += Math.hypot(x - px, z - pz); s.push(L); px = x; pz = z; }
  return { half: L, angle: d => { d = Math.max(0, Math.min(L, d)); let i = 1; while (i < n && s[i] < d) i++; const f = (d - s[i - 1]) / ((s[i] - s[i - 1]) || 1); return Math.PI * (i - 1 + f) / n; } }; }

// ---------------------------------------------------------------- the placement
// clearLow: the clearance below the natural waist (a shirt's tail over trousers starts outside them)
// waistY (CLOTH3, opt-in): trousers placed from the WAIST down (each leg panel's outseam waist point at waistY, bind m) instead of from the
// hem up (the hem 1 cm over the floor): the hem length is then the pattern's (lengthBonus) and moving it no longer moves the waist
// bentArm (CLOTH3, opt-in): a sleeve wrapped round the arm AS IT IS (shoulder -> elbow -> wrist, the bend eased over 8 cm, the radius the
// arm's own round that line) instead of round the straight shoulder -> wrist line: in the A-pose the forearm hangs forward of that line
// by 6-8 cm at the elbow, the cylinder round it was cut wide there and the sewn sleeve closed beside the forearm (the c8 judge's sleeves
// beside the arms; the carry then left the forearm out)
export function placeGarment(g, B, { clear = 0.014, clearLow = null, waistY = null, bentArm = false } = {}) {
  const X = new Float64Array(g.n * 3);
  for (const pn of g.panels) {
    const pl = pn.spec?.place || {}, V = pn.V, n = pn.n, o = pn.base;
    if (pl.wrap === 'torso') placeTorso(pn, pl, B, X, clear, null, clearLow);
    else if (pl.wrap === 'arm') placeArm(pn, pl, B, X, clear, bentArm);
    else if (pl.wrap === 'neck') placeNeck(pn, pl, B, X, clear);
    else if (pl.wrap === 'wrist') placeWrist(pn, pl, B, X, clear, g);
    else if (pl.wrap === 'leg') placeLeg(pn, pl, B, X, clear, g, null, waistY);
    else if (pl.wrap === 'suit') placeSuit(pn, pl, B, X, clear, g);
    else for (let i = 0; i < n; i++) { X[(o + i) * 3] = V[i * 2]; X[(o + i) * 3 + 1] = V[i * 2 + 1]; X[(o + i) * 3 + 2] = 0.3; }
  }
  return X;
}
// the panel's u-extent at height v: where the line v crosses its boundary (the first nb vertices of V, in order), cached per 5 mm
function spanOf(pn, half = 0) { const V = pn.V, nb = pn.nb, cache = new Map(), ok = x => !half || x * half >= -1e-6;
  return v => { const k = Math.round(v * 200); if (cache.has(k)) return cache.get(k); const y = k / 200; let a = Infinity, b = -Infinity;
    for (let i = 0; i < nb; i++) { const j = (i + 1) % nb, y0 = V[i * 2 + 1], y1 = V[j * 2 + 1]; if ((y0 - y) * (y1 - y) > 0 || y0 === y1) { if (y0 === y && ok(V[i * 2])) { a = Math.min(a, V[i * 2]); b = Math.max(b, V[i * 2]); } continue; }
      const t = (y - y0) / (y1 - y0), x = V[i * 2] + (V[j * 2] - V[i * 2]) * t; if (!ok(x)) continue; a = Math.min(a, x); b = Math.max(b, x); }
    if (!isFinite(a)) { let best = 0, bd = Infinity; for (let i = 0; i < nb; i++) { const d = Math.abs(V[i * 2 + 1] - y); if (d < bd) { bd = d; best = i; } } a = b = V[best * 2]; }
    const r = [a, b]; cache.set(k, r); return r; }; }
function sideU(pn) { const sp = spanOf(pn); return v => { const r = sp(v); return Math.max(Math.abs(r[0]), Math.abs(r[1])); }; }
function placeTorso(pn, pl, B, X, clear0, yOf = null, clearLow = null) {
  const V = pn.V, n = pn.n, o = pn.base, front = pl.face !== 'back', side = sideU(pn), walks = new Map();
  const hpsY = (B.hps.L[1] + B.hps.R[1]) / 2, yArm = hpsY - 0.20, yHip = yOf ? -Infinity : (B.levels?.hip ?? -Infinity);
  // the shoulder line, just above the skin: HPS -> acromion, each side
  const shoulderAt = (x) => { const s = x >= 0 ? 'L' : 'R', h = B.hps[s], a = B.acr[s], t = Math.max(0, Math.min(1.15, (Math.abs(x) - Math.abs(h[0])) / ((Math.abs(a[0]) - Math.abs(h[0])) || 1)));
    return [x, lerp(h[1], a[1], t) + clear0 * 1.2, lerp(h[2], a[2], Math.min(1, t)) - 0.004]; };
  // the widest section over the panel's height (a belly, a bust): the ellipse is sized so the whole torso clears it
  for (let i = 0; i < n; i++) {
    // below the hip level the hip's section (the widest): a long shirt tail hangs past the crotch, where the trunk has no section
    const u = V[i * 2], v = V[i * 2 + 1], y = yOf ? yOf(v) : hpsY + v, s = B.at(Math.max(yHip, Math.min(y, yArm + 0.02))), us = Math.max(1e-3, side(v));
    // the section's offset hull, walked from the midline to the side; front: u > 0 is the wearer's left (+x); back (seen from
    // behind): u > 0 is the wearer's right (-x)
    const yNWl = B.levels?.naturalWaist ?? -Infinity, clear = clearLow != null && y < yNWl ? clear0 + (clearLow - clear0) * Math.min(1, (yNWl - y) / 0.08) : clear0;
    const key = (front ? 'f' : 'b') + Math.round(s.y * 100) + ':' + clear.toFixed(3); let Wk = walks.get(key); if (!Wk) walks.set(key, Wk = hullWalk(s.hull, clear, front));
    const q = Wk.at(Math.abs(u) / us), sg = (front ? 1 : -1) * Math.sign(u || 1), x = sg * q[0], z = q[1];
    let P = [x, y, z];
    // above the armhole level, turn onto the shoulder line (smoothly: the corner bulges outward, over the clavicle and the trapezius)
    if (y > yArm) { const t = smooth((y - yArm) / (hpsY - yArm)), q = shoulderAt(x), cy = Math.max(y, q[1] - (hpsY - y) * 0.5); P = [x, lerp(y, cy, t), lerp(z, q[2] + (front ? 1 : -1) * (hpsY - y) * 0.6, t)]; }
    X[(o + i) * 3] = P[0]; X[(o + i) * 3 + 1] = P[1]; X[(o + i) * 3 + 2] = P[2];
  }
}
function placeArm(pn, pl, B, X, clear, bent = false) {
  const V = pn.V, n = pn.n, o = pn.base, A = B.arm[pl.side], ac = B.acr[pl.side];
  const tags = pn.boundary?.tags || {}, top = pn.tags[pl.top], vTop = top != null ? pn.outline[top * 2 + 1] : 0.13;
  // the biceps line: v = 0 for a set-in sleeve (FreeSewing's), or a named point's v (a raglan sleeve's underarm point)
  const vB = pl.biceps && pn.tags[pl.biceps] != null ? pn.outline[pn.tags[pl.biceps] * 2 + 1] : 0;
  let uMax = 0; for (let i = 0; i < pn.nb; i++) if (Math.abs(V[i * 2 + 1] - vB) < 0.02) uMax = Math.max(uMax, Math.abs(V[i * 2]));   // half width at the biceps line
  // the frame round the arm: e1 = down the outside... the underarm seam faces the body (toward -x for the left arm) and slightly down
  const ax = A.ax, sg = pl.side === 'L' ? 1 : -1, fwd = nrm(sub([0, 0, 1], scl(ax, ax[2]))), o0 = [sg, 1, 0], out = nrm(sub(sub(o0, scl(ax, o0[0] * ax[0] + o0[1] * ax[1])), scl(fwd, 0)));   // out: up and away from the body
  // the front notch's sign of u -> forward; the underarm (u = +-uMax) -> toward the body (-out)
  const fn = pn.tags[pl.front], fSign = fn != null ? Math.sign(pn.outline[fn * 2]) : 1;
  const start = add(A.s, scl(ax, -0.02));    // a little above the shoulder joint, toward the acromion
  const rMax = Math.max(...A.R) + clear, Lcap = vTop - vB;
  const BA = bent && B.elbows?.[pl.side] ? bentAxis(B, pl.side, start) : null;
  for (let i = 0; i < n; i++) {
    if (BA) { const u = V[i * 2], v = V[i * 2 + 1], d = (vTop - v) - Lcap * 0.55, F = BA.at(Math.max(0, d)), k = Math.max(0, Math.min(BA.R.length - 1, Math.round(Math.max(0, d) / 0.02)));
      const r = Math.max(uMax / Math.PI, BA.R[k] + clear, 0.035), phi = Math.PI * (u / uMax) * fSign, a = F.dir;
      const oL = nrm(sub(out, scl(a, out[0] * a[0] + out[1] * a[1] + out[2] * a[2]))), f0 = sub(fwd, scl(a, fwd[0] * a[0] + fwd[1] * a[1] + fwd[2] * a[2])), fL = nrm(sub(f0, scl(oL, f0[0] * oL[0] + f0[1] * oL[1] + f0[2] * oL[2])));
      let P = add(d < 0 ? add(start, scl(ax, d)) : F.p, add(scl(oL, Math.cos(phi) * r), scl(fL, Math.sin(phi) * r))); if (d < 0) P = add(P, scl(out, -d * 0.4));
      X[(o + i) * 3] = P[0]; X[(o + i) * 3 + 1] = P[1]; X[(o + i) * 3 + 2] = P[2]; continue; }
    const u = V[i * 2], v = V[i * 2 + 1], d = (vTop - v) - Lcap * 0.55, k = Math.max(0, Math.min(A.R.length - 1, Math.round(Math.max(0, d) / 0.02)));
    const r = Math.max(uMax / Math.PI, A.R[k] + clear, 0.035);
    const phi = Math.PI * (u / uMax) * fSign;     // 0 = the outside of the arm, +-pi = the underarm seam
    const dir = add(scl(out, Math.cos(phi)), scl(fwd, Math.sin(phi)));
    let P = add(add(start, scl(ax, d)), scl(dir, r));
    // the cap: above the biceps line the sleeve rises toward the acromion on the outside
    if (d < 0) P = add(P, scl(out, -d * 0.4));
    X[(o + i) * 3] = P[0]; X[(o + i) * 3 + 1] = P[1]; X[(o + i) * 3 + 2] = P[2];
  }
}
function placeNeck(pn, pl, B, X, clear) {
  const V = pn.V, n = pn.n, o = pn.base, N = B.neck, a0 = pn.tags[pl.anchor], v0 = a0 != null ? pn.outline[a0 * 2 + 1] : 0;
  let u0 = Infinity, u1 = -Infinity; for (let i = 0; i < n; i++) { u0 = Math.min(u0, V[i * 2]); u1 = Math.max(u1, V[i * 2]); }
  const r = Math.max(N.r + clear, (u1 - u0) / (2 * Math.PI)), base = add(N.center, [0, 0.0, 0]);
  for (let i = 0; i < n; i++) { const u = V[i * 2], v = V[i * 2 + 1], th = Math.PI + (u / ((u1 - u0) / 2)) * Math.PI;   // u = 0 at the back; +u toward the wearer's right (x < 0)
    const tilt = 0.5 * (1 + Math.cos(th));   // the collar sits lower in front
    X[(o + i) * 3] = r * Math.sin(th); X[(o + i) * 3 + 1] = base[1] + 0.012 + (v - v0) - 0.02 * tilt; X[(o + i) * 3 + 2] = base[2] + r * Math.cos(th); }
}
function placeWrist(pn, pl, B, X, clear, g) {
  const V = pn.V, n = pn.n, o = pn.base, A = B.arm[pl.side], ax = A.ax, sg = pl.side === 'L' ? 1 : -1;
  const fwd = nrm(sub([0, 0, 1], scl(ax, ax[2]))), o0 = [sg, 1, 0], out = nrm(sub(o0, scl(ax, o0[0] * ax[0] + o0[1] * ax[1])));
  const e0 = pn.tags[pl.edge[0]], vEdge = e0 != null ? pn.outline[e0 * 2 + 1] : 0;
  let u0 = Infinity, u1 = -Infinity, v1 = -Infinity; for (let i = 0; i < n; i++) { u0 = Math.min(u0, V[i * 2]); u1 = Math.max(u1, V[i * 2]); v1 = Math.max(v1, V[i * 2 + 1]); }
  const r = Math.max((u1 - u0) / (2 * Math.PI), A.R[A.R.length - 2] + clear), w = A.w, cuffLen = Math.abs(v1 - vEdge);
  for (let i = 0; i < n; i++) { const u = V[i * 2], v = V[i * 2 + 1], th = 2 * Math.PI * (u - u0) / (u1 - u0) + Math.PI, d = Math.abs(v - vEdge);
    const P = add(add(w, scl(ax, -cuffLen - 0.01 + d)), add(scl(out, r * Math.cos(th)), scl(fwd, r * Math.sin(th) * sg)));
    X[(o + i) * 3] = P[0]; X[(o + i) * 3 + 1] = P[1]; X[(o + i) * 3 + 2] = P[2]; }
}

// CLOTH3: the arm's line through the elbow (shoulder start -> EJC -> WJC, extended past the wrist), its direction eased over 8 cm at the
// elbow, and the arm's radius round it per 2 cm (upper arm and forearm vertices of that side, nearest point on the two segments)
function bentAxis(B, side, start) {
  const e = B.elbows[side], w = B.wrists[side], u1 = nrm(sub(e, start)), L1 = len(sub(e, start)), u2 = nrm(sub(w, e)), L2 = len(sub(w, e)), sg = side === 'L' ? 1 : -1;
  const at = d => { const t = smooth((d - (L1 - 0.04)) / 0.08), dir = nrm(add(scl(u1, 1 - t), scl(u2, t))); return { p: d <= L1 ? add(start, scl(u1, d)) : add(e, scl(u2, d - L1)), dir }; };
  const R = new Float64Array(Math.ceil((L1 + L2) / 0.02) + 4), S = B.S, P = B.P;
  for (let v = 0; v < S.nb; v++) { const r = S.region[v]; if (r !== 3 && r !== 4) continue; if (Math.sign(P[v * 3]) !== sg) continue; const q = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
    const t1 = Math.max(0, Math.min(L1, (q[0] - start[0]) * u1[0] + (q[1] - start[1]) * u1[1] + (q[2] - start[2]) * u1[2])), t2 = Math.max(0, Math.min(L2 + 0.03, (q[0] - e[0]) * u2[0] + (q[1] - e[1]) * u2[1] + (q[2] - e[2]) * u2[2]));
    const d1 = len(sub(q, add(start, scl(u1, t1)))), d2 = len(sub(q, add(e, scl(u2, t2)))), arc = d1 <= d2 ? t1 : L1 + t2, dd = Math.min(d1, d2), k = Math.max(0, Math.min(R.length - 1, Math.round(arc / 0.02))); R[k] = Math.max(R[k], dd); }
  for (let k = 1; k < R.length; k++) if (!R[k]) R[k] = R[k - 1];
  return { at, R, L1, L2 };
}
// a trouser panel: above the fork it wraps the hip (the section's hull, from the outseam at the side to the centre front or back),
// below it a half cylinder round the leg (outseam at the outside of the leg, inseam inside), blended over 8 cm at the fork
function placeLeg(pn, pl, B, X, clear, g, yOverride = null, waistY = null) {
  const V = pn.V, n = pn.n, o = pn.base, front = pl.face !== 'back', sd = pl.side, sg = sd === 'L' ? 1 : -1, Lg = B.leg[sd], walks = new Map();
  const tOut = pn.tags[pl.out], tFork = pn.tags[pl.fork], uOut0 = pn.outline[tOut * 2], vFork = pn.outline[tFork * 2 + 1], vWaist = pn.outline[tOut * 2 + 1];
  // the boundary's u-range at each height; which end is the outseam
  const range = spanOf(pn, pl.half || 0);
  const cU = Array.from({ length: n }, (_, i) => V[i * 2]).reduce((a, b) => a + b, 0) / n, outMin = pl.half ? pl.half < 0 : uOut0 < cU;
  // the waist line's height: the natural waist (FreeSewing's waist) of the body = the HPS frame's waist? place.js has no tailor here:
  // the trousers' own waistToFloor puts the floor at v = vWaist - waistToFloor; we put the hem 1 cm over the floor instead
  let vMin = Infinity; for (let i = 0; i < pn.nb; i++) vMin = Math.min(vMin, V[i * 2 + 1]);
  const yOf = yOverride || (waistY != null ? (v => waistY + (v - vWaist)) : (v => B.floor + 0.01 + (v - vMin)));
  const lat = nrm(sub([sg, 0, 0], scl(Lg.ax, sg * Lg.ax[0])));
  for (let i = 0; i < n; i++) {
    const u = V[i * 2], v = V[i * 2 + 1], rg = range(v), uo = outMin ? rg[0] : rg[1], ui = outMin ? rg[1] : rg[0], f = Math.max(0, Math.min(1, Math.abs(u - uo) / (Math.abs(ui - uo) || 1e-6))), y = yOf(v);
    // the leg: the axis point at this height, the radius (the leg's own + clearance, or the panel's half girth over pi)
    const t = Math.max(0, Math.min(Lg.L, (Lg.h[1] - y) / (-Lg.ax[1] || 1))), k = Math.max(0, Math.min(Lg.R.length - 1, Math.round(t / 0.02)));
    const r = Math.max(Lg.R[k] + clear, Math.abs(ui - uo) / Math.PI), ap = add(Lg.h, scl(Lg.ax, t)), phi = f * Math.PI;
    const dir = add(scl(lat, Math.cos(phi)), scl([0, 0, front ? 1 : -1], Math.sin(phi))), PL = add([ap[0], y, ap[2]], scl([dir[0], 0, dir[2]], r));
    // the hip: the torso section's hull from the side (f = 0) to the midline (f = 1)
    let PH = PL; if (v > vFork - 0.02) { const s = B.at(y), key = (front ? 'f' : 'b') + Math.round(s.y * 100); let Wk = walks.get(key); if (!Wk) walks.set(key, Wk = hullWalk(s.hull, clear, front)); const q = Wk.at(1 - f); PH = [sg * q[0], y, q[1]]; }
    const tb = smooth((v - vFork + 0.02) / 0.1), P = [lerp(PL[0], PH[0], tb), y, lerp(PL[2], PH[2], tb)];
    X[(o + i) * 3] = P[0]; X[(o + i) * 3 + 1] = P[1]; X[(o + i) * 3 + 2] = P[2];
  }
}

// a one-piece (a coverall): the torso's wrap above the fork, the trousers' legs below, blended over 10 cm; heights from the waist
// tag at the body's natural waist (B.levels from tailor.js), the hem kept 1 cm over the floor
function placeSuit(pn, pl, B, X, clear, g) {
  const n = pn.n, o = pn.base, V = pn.V, tW = pn.tags.waist, vW = tW != null ? pn.outline[tW * 2 + 1] : -0.41, yNW = B.levels?.naturalWaist ?? (B.hps.L[1] - 0.32);
  const yOf = v => Math.max(B.floor + 0.01, yNW + (v - vW)), vF = pn.outline[pn.tags[pl.fork] * 2 + 1];
  const XT = new Float64Array(X.length), XL = new Float64Array(X.length);
  placeTorso(pn, pl, B, XT, clear, yOf); placeLeg(pn, pl.side ? pl : { ...pl, side: 'L', half: -1 }, B, XL, clear, g, yOf);
  // the back panel spans both legs: its legs are the two sides of the fold; place each half on its own leg (+u: the wearer's right)
  if (!pl.side) { const XR = new Float64Array(X.length); placeLeg(pn, { ...pl, side: 'R', half: 1 }, B, XR, clear, g, yOf);
    for (let i = 0; i < n; i++) if (V[i * 2] > 0) for (let c = 0; c < 3; c++) XL[(o + i) * 3 + c] = XR[(o + i) * 3 + c]; }
  for (let i = 0; i < n; i++) { const t = smooth((V[i * 2 + 1] - vF + 0.02) / 0.12); for (let c = 0; c < 3; c++) X[(o + i) * 3 + c] = lerp(XL[(o + i) * 3 + c], XT[(o + i) * 3 + c], t); }
}
