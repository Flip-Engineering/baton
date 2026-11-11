// ACCELERATE v3 (cycle R1): this piece's own 2D world pieces, ink and print on #F7F7F2 with the prism fringe.
//   tunnel()    the halftone slit-scan corridor (Trumbull's Stargate as print): dot cells stretched along z into streaks
//   throttle()  the notch quadrant and lever, gripped by the gloved fist (the hook; RUN 8 at the payoff)
//   glove()     the gloved fist on a bar (shared by the throttle and the rock drill: the match cut)
//   governor()  the flyball governor spinning down and clamping shut (the stall)
//   drill()     the rock drill's controls and the rock face it punches through (FLOOR IT.)
//   colossus()  the AI ally as a rebar colossus: ribbed bars, tie-wire twists, scaffold couplers, a coupler-cluster head
//   ignition()  the Saturn V's engines in slow motion: ice sheeting off in ink, the flame column
//   horizon()   a low hazed horizon with refinery and grid towers at shin height (the 1 km scale)
//   emblem()    the ACP mark (gear, hammer and sickle, FOUR stripes) drawn as the lanes' lock, in red
import { W, H, clamp, lerp, smooth, ease, rng } from '../lib/kit.js';

export const INK = '#0b0b0b', PAPER = '#f7f7f2', RED = '#d5121e';
// c7: the rainbow prism fringe is gone. The second ink is one warm grey, misregistered off the black (a two-plate print)
export const BANDS = [['#a5a39a', 1]];
const TAU = Math.PI * 2, D2R = Math.PI / 180;
const rot = (p, a) => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)];

export function poly(pts, p = new Path2D()) { p.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]); p.closePath(); return p; }
export function smoothClosed(pts, p = new Path2D()) {
  const n = pts.length; p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    p.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
  }
  p.closePath(); return p;
}
export function fringe(c, paths, fr, off = [0, 0]) {
  c.save(); c.lineJoin = 'round'; c.lineCap = 'round';
  for (const [col, k] of BANDS) { c.save(); c.translate(off[0] * k, off[1] * k); c.strokeStyle = col; c.lineWidth = 2 * fr * k; for (const p of paths) c.stroke(p); c.restore(); }
  c.restore();
}
// parallel hatching inside a path: angle a, gap px, width px
export function hatch(c, path, a, gap, w, col = INK, box = [0, 0, W, H]) {
  c.save(); c.clip(path); c.strokeStyle = col; c.lineWidth = w; c.beginPath();
  const [x0, y0, x1, y1] = box, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, R = Math.hypot(x1 - x0, y1 - y0) / 2 + 4;
  const d = [Math.cos(a), Math.sin(a)], n = [-d[1], d[0]];
  for (let k = -R; k <= R; k += gap) { c.moveTo(cx + n[0] * k - d[0] * R, cy + n[1] * k - d[1] * R); c.lineTo(cx + n[0] * k + d[0] * R, cy + n[1] * k + d[1] * R); }
  c.stroke(); c.restore();
}

// ================================================================ the halftone slit-scan tunnel
// A rectangular corridor whose four walls are printed plates: a grid of dot cells (gravure-like, the dot size from a
// moving pattern) streaked along z by the shutter. o: vp [x,y], S (travel, world units), shut (streak length, world),
// A/B (half width/height of the corridor), f (focal px), roll, gain (ink 0..1), fr (fringe px), flood (0..1 white-out
// from the far end), seed. Ink cores are batched per width bucket: ~4k marks, one stroke per bucket and band.
export function tunnel(c, o = {}) {
  const vp = o.vp ?? [W / 2, H * 0.47], S = o.S ?? 0, shut = Math.max(0.02, o.shut ?? 1), A = o.A ?? 5.4, Bh = o.B ?? 9.6;
  const f = o.f ?? 620, roll = o.roll ?? 0, gain = o.gain ?? 1, fr = o.fr ?? 2.4, flood = o.flood ?? 0;
  const cols = o.cols ?? 22, zN = 0.9, zF = 60, rows = o.rows ?? 46, cellZ = (zF - zN) / rows;
  c.save();
  c.fillStyle = PAPER; c.fillRect(0, 0, W, H);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const P = (x, y, z) => { const X = cr * x - sr * y, Y = sr * x + cr * y; return [vp[0] + X * f / z, vp[1] - Y * f / z]; };
  const NB = 7, buckets = Array.from({ length: NB }, () => new Path2D()), widths = [];
  for (let i = 0; i < NB; i++) widths.push(1.2 * Math.pow(1.72, i));
  const walls = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const seed = o.seed ?? 3;
  for (let wi = 0; wi < 4; wi++) {
    const [wx, wy] = walls[wi], side = wx !== 0, span = side ? Bh : A;
    for (let i = 0; i < cols; i++) {
      const u = -1 + (i + 0.5) * 2 / cols;
      for (let j = 0; j < rows; j++) {
        // world depth of this cell: rows scroll toward the lens with S
        const zw = j * cellZ + S, zc = zN + ((j * cellZ - S) % (zF - zN) + (zF - zN)) % (zF - zN);
        const cell = Math.floor((j * cellZ + (S - ((S % cellZ) + cellZ) % cellZ)) / cellZ);   // stable cell id along z
        const kz = cell + j * 0;
        // the printed plate: bands, blocks and a gravure ramp, per wall
        const w0 = Math.sin(u * 2.3 + kz * 0.21 + wi * 1.7) * 0.5 + 0.5;
        const blk = ((Math.floor(kz / 5) + i + wi) % 4 === 0) ? 1 : 0;
        const lane = side ? 0 : (Math.abs(Math.abs(u) - 0.45) < 0.12 ? 0.8 : 0);
        let v = clamp(0.18 + 0.5 * w0 * w0 + 0.45 * blk + lane - 0.25 * (hash(i * 131 + kz * 7 + wi * 977 + seed) > 0.8 ? 1 : 0));
        v *= gain * (1 - smooth(0.55, 1, zc / zF)) * (1 - flood * smooth(0, 1, (zF - zc) / zF * 1.6 - 0.2));
        if (v < 0.06) continue;
        const x = side ? wx * A : u * A, y = side ? u * Bh : wy * Bh;
        const z0 = zc, z1 = zc + shut * (0.6 + 0.8 * v);
        const a = P(x, y, z0), b = P(x, y, z1);
        const wpx = v * (span * 2 / cols) * f / z0 * 0.8;
        if (wpx < 0.7) continue;
        let k = 0; while (k < NB - 1 && widths[k + 1] <= wpx) k++;
        buckets[k].moveTo(a[0], a[1]); buckets[k].lineTo(b[0], b[1]);
      }
    }
  }
  c.lineCap = 'round';
  for (const [col, kk] of [[BANDS[0][0], 1]]) {       // the second ink, misregistered
    c.save(); c.globalAlpha = 0.55; c.strokeStyle = col;
    for (let k = 3; k < NB; k++) { c.lineWidth = widths[k] + fr * 2; c.save(); c.translate(fr * kk * 0.6, 0); c.stroke(buckets[k]); c.restore(); }   // fine far marks stay pure ink (no purple mouth)
    c.restore();
  }
  c.strokeStyle = INK;
  for (let k = 0; k < NB; k++) { c.lineWidth = widths[k]; c.stroke(buckets[k]); }
  // the corridor's four edges, ruled in ink, and the far mouth
  const edges = new Path2D();
  for (const [x, y] of [[A, Bh], [-A, Bh], [A, -Bh], [-A, -Bh]]) { const a = P(x, y, zN), b = P(x, y, zF); edges.moveTo(...a); edges.lineTo(...b); }
  c.strokeStyle = 'rgba(11,11,11,0.55)'; c.lineWidth = 3; c.stroke(edges);
  if (flood > 0) {                                                     // the far end floods white (FLOOR IT., the break)
    const g = c.createRadialGradient(vp[0], vp[1], 0, vp[0], vp[1], 1500 * flood + 60);
    g.addColorStop(0, 'rgba(255,255,252,1)'); g.addColorStop(0.6, `rgba(255,255,252,${0.9 * flood})`); g.addColorStop(1, 'rgba(255,255,252,0)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
  }
  c.restore();
}
function hash(i) { let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; }

// ================================================================ the gloved fist on a bar
// Seen from the thumb side, the hand coming in from the lower left, gripping a vertical bar at the local origin.
// Local units (1 = s px), y up. o: s (px/unit), x, y (screen of the bar centre), a (rotation, rad), squeeze (0..1),
// fr (fringe px), off (fringe push). Returns { paths } for masks.
const GLOVE = {
  back: [[-19, -11], [-18.5, 3.6], [-12, 5.2], [-6, 6.1], [-1.5, 6.7], [2.4, 6.0], [4.6, 4.2], [5.2, 1.2], [5.0, -2.6], [4.2, -5.4],
    [2.2, -6.9], [-2.4, -7.1], [-6.4, -6.6], [-9.8, -7.6], [-13.5, -10.2], [-15, -12]],
  thumb: [[-10.5, 2.6], [-6.5, 4.0], [-2.2, 4.1], [1.6, 3.1], [2.9, 1.9], [2.4, 0.6], [0.4, 0.4], [-3.5, 0.9], [-7.5, 0.6], [-10.2, 0.2]],
  cuff: [[-26, -16], [-24.5, 4.8], [-18.2, 5.2], [-19.3, -12.6]],
};
export function glove(c, o) {
  const s = o.s, a = o.a ?? 0, sq = o.squeeze ?? 0.5;
  const X = (p) => { const q = rot([p[0] * (1 - 0.03 * sq), p[1] * (1 + 0.02 * sq)], a); return [o.x + q[0] * s, o.y - q[1] * s]; };
  const back = smoothClosed(GLOVE.back.map(X)), thumb = smoothClosed(GLOVE.thumb.map(X)), cuff = poly(GLOVE.cuff.map(X));
  c.save();
  fringe(c, [back, cuff], o.fr ?? 6, o.off ?? [-6, 0]);
  c.fillStyle = INK; c.fill(cuff); c.fill(back);
  // leather: hatching on the underside, a lit ridge on the knuckles, stitched seams, finger splits, the thumb cut out
  const lw = Math.max(1.2, 0.16 * s);
  c.save(); c.clip(back);
  c.strokeStyle = PAPER; c.lineWidth = lw * 1.1;
  const L = (pts) => { c.beginPath(); c.moveTo(...X(pts[0])); for (let i = 1; i < pts.length; i++) c.lineTo(...X(pts[i])); c.stroke(); };
  const Q = (a0, m, b0) => { c.beginPath(); c.moveTo(...X(a0)); c.quadraticCurveTo(...X(m), ...X(b0)); c.stroke(); };
  for (const y of [-1.3, -3.6, -5.8]) Q([1.2, y + 0.4], [4.4, y + 0.9], [5.2, y - 0.2]);          // the curled fingers' splits
  Q([-2.5, 5.9], [0.8, 6.9], [3.7, 4.9]);                                                       // knuckle ridge (lit)
  c.setLineDash([0.55 * s, 0.45 * s]); c.lineWidth = lw * 0.8;
  Q([-17.5, 2.8], [-9, 4.6], [-2.6, 5.2]);                                                      // back seam
  Q([-15, -9.2], [-8, -5.8], [-2, -6.0]);                                                       // palm seam
  c.setLineDash([]);
  c.restore();
  hatch(c, back, -0.5 + a, Math.max(4, 0.7 * s), Math.max(1.2, 0.13 * s), 'rgba(247,247,242,0.55)', [o.x - 20 * s, o.y - 2 * s, o.x + 6 * s, o.y + 9 * s]);
  // the thumb: a paper keyline, then ink, with its nail seam
  c.strokeStyle = PAPER; c.lineWidth = Math.max(2.5, 0.42 * s); c.stroke(thumb);
  c.fillStyle = INK; c.fill(thumb);
  c.save(); c.clip(thumb); c.strokeStyle = PAPER; c.lineWidth = lw; Q([-6, 3.4], [-1, 3.6], [2.1, 2.2]); c.restore();
  // the cuff: a turned band and the gauntlet's rivet
  c.save(); c.clip(cuff); c.strokeStyle = PAPER; c.lineWidth = Math.max(2, 0.5 * s); L([[-22.2, -15], [-21, 5]]); c.lineWidth = lw; L([[-24, -15.5], [-22.6, 5]]); c.restore();
  const rv = X([-20.2, -2]); c.fillStyle = PAPER; c.beginPath(); c.arc(rv[0], rv[1], Math.max(2, 0.45 * s), 0, TAU); c.fill();
  c.restore();
  return { back, thumb, cuff, X };
}

// ================================================================ the throttle: notch quadrant, lever, the fist on its handle
export const NOTCHES = ['IDLE', '1', '2', '3', '4', '5', '6', '7', '8'];
// notch: float (0 = IDLE .. 8 = RUN 8). o: px (pivot), s (scale px/unit of the plate), slam (0..1 impact), zoom
export function throttle(c, notch, o = {}) {
  const s = o.s ?? 14, pv = o.pv ?? [300, 2350], R = 118, A0 = -44 * D2R, A1 = 28 * D2R;
  const ang = (n) => lerp(A0, A1, n / 8);
  const Pp = (r, a) => [pv[0] + Math.sin(a) * r * s, pv[1] - Math.cos(a) * r * s];
  c.save();
  if (o.follow) {                                       // the camera rides the fist: the plate slides under it
    const la0 = ang(o.followNotch ?? notch), tp = Pp(R + 38, la0);
    c.translate(o.follow[0] - tp[0], o.follow[1] - tp[1]);
  }
  // the quadrant plate: a thick steel arc, the notch teeth cut in its top edge, engraved labels
  const plate = new Path2D();
  const arcPts = (r, a0, a1, n = 40) => Array.from({ length: n + 1 }, (_, i) => Pp(r, lerp(a0, a1, i / n)));
  const outer = [], teeth = [];
  for (let i = 0; i <= 8; i++) {
    const a = ang(i), w = 1.3 * D2R;
    teeth.push([a - w, a + w]);
  }
  const aa0 = A0 - 6 * D2R, aa1 = A1 + 6 * D2R;
  let prev = aa0;
  for (const [t0, t1] of teeth) { outer.push(...arcPts(R + 6, prev, t0, 6)); outer.push(Pp(R + 1.6, t0), Pp(R + 1.6, t1)); prev = t1; }
  outer.push(...arcPts(R + 6, prev, aa1, 6));
  const inner = arcPts(R - 12, aa1, aa0, 40);
  poly([...outer, ...inner], plate);
  fringe(c, [plate], o.fr ?? 5, [-4, 0]);
  c.fillStyle = '#2a2a28'; c.fill(plate);
  hatch(c, plate, 0.9, 7, 1.6, 'rgba(247,247,242,0.22)');
  c.save(); c.clip(plate);
  c.strokeStyle = 'rgba(247,247,242,0.9)'; c.lineWidth = 2.5; c.beginPath();
  for (const p of arcPts(R + 3.5, aa0, aa1, 60)) c.lineTo(...p); c.stroke();
  c.restore();
  // labels: engraved in the plate face (IDLE, 1..8); the live notch reads in paper, the rest in grey
  const cur = Math.round(notch);
  c.textAlign = 'center'; c.textBaseline = 'middle';
  for (let i = 0; i <= 8; i++) {
    const p = Pp(R - 4.5, ang(i)), on = i === cur;
    c.save(); c.translate(...p); c.rotate(ang(i));
    c.font = `700 ${Math.round((i === 0 ? 2.6 : 4.2) * s)}px "Plex Mono"`;
    c.fillStyle = on ? PAPER : 'rgba(247,247,242,0.38)';
    c.fillText(i === 0 ? 'IDLE' : (i === 8 && on ? 'RUN 8' : NOTCHES[i]), 0, 0);
    c.restore();
  }
  // the lever: a tapered steel bar from the pivot to the handle, the detent latch at the plate
  const la = ang(notch) + (o.shake ?? 0), top = Pp(R + 38, la), bot = Pp(-10, la), latch = Pp(R + 2, la);
  const nrm = [Math.cos(la), Math.sin(la)];
  const lever = poly([[bot[0] - nrm[0] * 4.5 * s, bot[1] - nrm[1] * 4.5 * s], [top[0] - nrm[0] * 2.4 * s, top[1] - nrm[1] * 2.4 * s],
    [top[0] + nrm[0] * 2.4 * s, top[1] + nrm[1] * 2.4 * s], [bot[0] + nrm[0] * 4.5 * s, bot[1] + nrm[1] * 4.5 * s]]);
  fringe(c, [lever], o.fr ?? 5, [-5, 0]);
  c.fillStyle = INK; c.fill(lever);
  c.save(); c.clip(lever); c.strokeStyle = 'rgba(247,247,242,0.85)'; c.lineWidth = 3;
  c.beginPath(); c.moveTo(bot[0] + nrm[0] * 2.6 * s, bot[1] + nrm[1] * 2.6 * s); c.lineTo(top[0] + nrm[0] * 1.3 * s, top[1] + nrm[1] * 1.3 * s); c.stroke(); c.restore();
  const lb = poly([[-4, -2.2], [4, -2.2], [4, 2.2], [-4, 2.2]].map(q => { const r_ = rot(q, -la); return [latch[0] + r_[0] * s, latch[1] + r_[1] * s]; }));
  c.fillStyle = INK; c.fill(lb); c.strokeStyle = PAPER; c.lineWidth = 2; c.stroke(lb);
  // the fist on the handle: the bar runs along the lever, so the glove turns with it
  const g = glove(c, { s: s * (o.gs ?? 1.9), x: top[0] - Math.sin(la) * 9 * s, y: top[1] + Math.cos(la) * 9 * s, a: -la, squeeze: o.squeeze ?? 0.8, fr: 7, off: [-8, 0] });
  // the slam: the latch sparks (ink chips thrown from the detent)
  if (o.slam) {
    const r = rng(17);
    for (let i = 0; i < 18; i++) {
      const aa = -Math.PI / 2 + (r() - 0.5) * 2.6, sp = (60 + r() * 260) * o.slam, sz = 4 + r() * 12;
      const q = [latch[0] + Math.cos(aa) * sp, latch[1] + Math.sin(aa) * sp];
      const pth = poly([[q[0], q[1] - sz], [q[0] + sz * 0.6, q[1] + sz * 0.3], [q[0] - sz * 0.5, q[1] + sz * 0.5]]);
      c.globalAlpha = o.slam; fringe(c, [pth], 2.5); c.fillStyle = INK; c.fill(pth); c.globalAlpha = 1;
    }
  }
  c.restore();
  return { top, latch, glove: g };
}

// ================================================================ the flyball governor (the stall)
// An engraved Watt governor standing on the engine bed, the flywheel turning behind it on a belt. spin: 0..1 (the balls
// thrown out .. collapsed), clamp: 0..1 (a heavy C-clamp screwing shut on the spindle: profit's brake), t: seconds
export function governor(c, o) {
  const K = o.ink ?? INK, K2 = o.ink ?? '#1a1a19', cx = o.x ?? 540, cy = o.y ?? 980, s = o.s ?? 9, spin = o.spin ?? 1, t = o.t ?? 0, clampU = o.clamp ?? 0;
  const X = (x, y) => [cx + x * s, cy - y * s];
  const ph = o.ph ?? (t * TAU * 1.6 * spin + t * 0.4);
  c.save();
  // ---- the flywheel behind, low right: rim, six curved spokes, the hub; turning with the engine
  const fw = X(20, -62), FR = 44 * s, wa = o.wa ?? (t * TAU * 0.5 * (0.15 + spin));
  c.save(); c.globalAlpha = o.noWheel ? 0 : 0.92;
  const rimO = new Path2D(); rimO.arc(fw[0], fw[1], FR, 0, TAU); rimO.arc(fw[0], fw[1], FR * 0.86, 0, TAU, true);
  fringe(c, [rimO], 4, [-4, 0]); c.fillStyle = K2; c.fill(rimO, 'evenodd');
  hatch(c, rimO, 0.3, 7, 1.6, 'rgba(247,247,242,0.35)', [fw[0] - FR, fw[1] - FR, fw[0] + FR, fw[1] + FR]);
  c.strokeStyle = PAPER; c.lineWidth = 2; c.beginPath(); c.arc(fw[0], fw[1], FR * 0.93, Math.PI * 1.05, Math.PI * 1.7); c.stroke();
  for (let i = 0; i < 6; i++) {
    const a0 = wa + i * TAU / 6, sp = new Path2D();
    const p0 = [fw[0] + Math.cos(a0) * FR * 0.12, fw[1] + Math.sin(a0) * FR * 0.12], p1 = [fw[0] + Math.cos(a0 + 0.12) * FR * 0.87, fw[1] + Math.sin(a0 + 0.12) * FR * 0.87];
    const m = [fw[0] + Math.cos(a0 + 0.14) * FR * 0.5, fw[1] + Math.sin(a0 + 0.14) * FR * 0.5];
    sp.moveTo(...p0); sp.quadraticCurveTo(...m, ...p1);
    c.strokeStyle = K2; c.lineWidth = 2.6 * s; c.lineCap = 'round'; c.stroke(sp);
  }
  const hub = new Path2D(); hub.arc(fw[0], fw[1], FR * 0.16, 0, TAU); c.fillStyle = K; c.fill(hub);
  c.strokeStyle = PAPER; c.lineWidth = 2.5; c.beginPath(); c.arc(fw[0], fw[1], FR * 0.07, 0, TAU); c.stroke();
  if (spin > 0.2) { c.strokeStyle = `rgba(11,11,11,${0.25 * spin})`; c.lineWidth = 3;           // motion arcs on the rim
    for (let k = 0; k < 3; k++) { c.beginPath(); c.arc(fw[0], fw[1], FR * (1.04 + k * 0.03), wa + k, wa + k + 0.9 * spin); c.stroke(); } }
  c.restore();
  // ---- the drive belt from the flywheel up to the governor's bevel pulley
  const pul = X(0, -40), belt = new Path2D();
  c.save(); c.globalAlpha = o.noWheel ? 0 : 1;
  belt.moveTo(pul[0] + 5 * s, pul[1] - 2 * s); belt.lineTo(fw[0] + FR * 0.5, fw[1] - FR * 0.87);
  belt.moveTo(pul[0] - 5 * s, pul[1] + 2 * s); belt.lineTo(fw[0] - FR * 0.2, fw[1] + FR * 0.98);
  c.strokeStyle = K; c.lineWidth = 1.8 * s; c.stroke(belt);
  c.strokeStyle = PAPER; c.setLineDash([2.2 * s, 2.6 * s]); c.lineDashOffset = -t * 90 * spin; c.lineWidth = 0.35 * s; c.stroke(belt); c.setLineDash([]); c.restore();
  // ---- the cast column (entasis, fluted), its bed plate with bolts, the top bearing and finial
  const col = smoothClosed([X(-9, -52), X(-6, -44), X(-4.2, -20), X(-3.6, 20), X(-5, 30), X(5, 30), X(3.6, 20), X(4.2, -20), X(6, -44), X(9, -52)]);
  const bed = poly([X(-40, -58), X(40, -58), X(40, -52), X(-40, -52)]);
  const plinth = poly([X(-16, -52), X(16, -52), X(12, -46), X(-12, -46)]);
  const spindle = poly([X(-1.3, 30), X(1.3, 30), X(1.3, 48), X(-1.3, 48)]);
  const cap = smoothClosed([X(-4.5, 46), X(-3, 50), X(0, 52.5), X(3, 50), X(4.5, 46)]);
  const pulley = new Path2D(); pulley.ellipse(pul[0], pul[1], 6.5 * s, 2.2 * s, 0, 0, TAU);
  const solid = [bed, plinth, col, spindle, cap, pulley];
  fringe(c, solid, 4, [-4, 0]);
  c.fillStyle = K; for (const p of solid) c.fill(p);
  hatch(c, col, Math.PI / 2, Math.max(4, 0.55 * s), Math.max(1.2, 0.14 * s), 'rgba(247,247,242,0.5)', [cx - 10 * s, cy - 52 * s, cx + 10 * s, cy + 30 * s]);   // flutes
  c.save(); c.clip(col); c.strokeStyle = 'rgba(247,247,242,0.9)'; c.lineWidth = Math.max(1.6, 0.3 * s);     // lit edge
  c.beginPath(); c.moveTo(...X(-5.6, -44)); c.lineTo(...X(-3.8, -20)); c.lineTo(...X(-3.3, 20)); c.stroke(); c.restore();
  c.fillStyle = PAPER; for (const bx of [-34, -24, 24, 34]) { const q = X(bx, -55); c.beginPath(); c.arc(q[0], q[1], 1.1 * s, 0, TAU); c.fill(); }
  c.strokeStyle = PAPER; c.lineWidth = 2; c.beginPath(); c.moveTo(...X(-39, -53.5)); c.lineTo(...X(39, -53.5)); c.stroke();
  // ---- arms and links: double rods with pins; the sleeve rides up the spindle as the balls fly out
  const opening = lerp(9, 52, spin) * D2R, top = [0, 48], armL = 36;
  const sleeveY = lerp(28, 38, spin);
  const balls = [], rods = new Path2D(), pins = [];
  for (const k of [0, 1]) {
    const face = Math.cos(ph + k * Math.PI), depth = Math.sin(ph + k * Math.PI);
    const bx = Math.sin(opening) * armL * face, by = top[1] - Math.cos(opening) * armL;
    balls.push({ x: bx, y: by, r: 7 * (1 + 0.1 * depth), depth });
    rods.moveTo(...X(top[0], top[1])); rods.lineTo(...X(bx, by));
    const lx = bx * 0.5, ly = top[1] - Math.cos(opening) * armL * 0.5;
    rods.moveTo(...X(lx, ly)); rods.lineTo(...X(0, sleeveY + 3));
    pins.push(X(lx, ly));
  }
  pins.push(X(0, top[1]));
  const sleeve = poly([X(-3.4, sleeveY - 2), X(3.4, sleeveY - 2), X(3.4, sleeveY + 5), X(-3.4, sleeveY + 5)]);
  // the lever from the sleeve to the steam valve at the left (the engine's throttle)
  const lev = new Path2D(); lev.moveTo(...X(3.4, sleeveY + 1)); lev.lineTo(...X(-28, sleeveY - 10)); lev.lineTo(...X(-30, -30));
  const valve = poly([X(-36, -30), X(-24, -30), X(-24, -40), X(-36, -40)]);
  const pipe = poly([X(-60, -36), X(-36, -36), X(-36, -34), X(-60, -34)]);
  fringe(c, [sleeve, valve, pipe], 3.5, [-3, 0]); c.fillStyle = K; c.fill(sleeve); c.fill(valve); c.fill(pipe);
  hatch(c, valve, 0.8, 5, 1.2, 'rgba(247,247,242,0.5)', [cx - 40 * s, cy + 28 * s, cx - 20 * s, cy + 42 * s]);
  c.lineCap = 'round';
  c.strokeStyle = K; c.lineWidth = 1.3 * s; c.stroke(lev);
  c.lineWidth = 1.9 * s; c.stroke(rods);
  c.strokeStyle = PAPER; c.lineWidth = Math.max(1.2, 0.3 * s); c.stroke(rods);                  // the rods are paired bars
  for (const q of pins) { c.fillStyle = K; c.beginPath(); c.arc(q[0], q[1], 1.3 * s, 0, TAU); c.fill(); c.fillStyle = PAPER; c.beginPath(); c.arc(q[0], q[1], 0.45 * s, 0, TAU); c.fill(); }
  // the balls: engraved spheres (contour arcs round the lit pole, cross-hatched shadow side)
  for (const b of balls.slice().sort((a, b2) => a.depth - b2.depth)) {
    const p = X(b.x, b.y), R = b.r * s, ball = new Path2D(); ball.arc(p[0], p[1], R, 0, TAU);
    fringe(c, [ball], 4, [-3, 0]); c.fillStyle = K; c.fill(ball);
    c.save(); c.clip(ball);
    c.strokeStyle = 'rgba(247,247,242,0.85)';
    for (let k = 1; k < 9; k++) { c.lineWidth = Math.max(1, (0.22 - k * 0.02) * s); c.beginPath(); c.arc(p[0] - R * 0.38, p[1] - R * 0.38, R * 0.13 * k, Math.PI * 0.9, Math.PI * 1.75); c.stroke(); }
    c.beginPath(); c.fillStyle = PAPER; c.ellipse(p[0] - R * 0.42, p[1] - R * 0.42, R * 0.14, R * 0.09, -0.7, 0, TAU); c.fill();
    c.restore();
  }
  if (spin > 0.2) { c.strokeStyle = `rgba(11,11,11,${0.4 * spin})`; c.lineWidth = 2.5; c.beginPath();
    const r = Math.sin(opening) * armL * s, y = cy - (top[1] - Math.cos(opening) * armL) * s; c.ellipse(cx, y, r, r * 0.18, 0, 0, TAU); c.stroke(); }
  // ---- the clamp: a forged C-clamp swinging in from the right and screwing shut on the spindle
  const cu = ease.inOutCubic(clamp(clampU)), jx = lerp(60, 1.4, cu);
  if (cu > 0.002) {
  const cc = [cx + (jx + 14) * s, cy - 44 * s];
  const cframe = poly([[cc[0] - 14 * s, cc[1] - 8 * s], [cc[0] + 10 * s, cc[1] - 8 * s], [cc[0] + 10 * s, cc[1] + 16 * s], [cc[0] - 14 * s, cc[1] + 16 * s],
    [cc[0] - 14 * s, cc[1] + 11 * s], [cc[0] + 5 * s, cc[1] + 11 * s], [cc[0] + 5 * s, cc[1] - 3 * s], [cc[0] - 14 * s, cc[1] - 3 * s]]);
  const pad = poly([[cc[0] - 14 * s, cc[1] - 3 * s], [cc[0] - 12.6 * s, cc[1] - 3 * s], [cc[0] - 12.6 * s, cc[1] + 11 * s], [cc[0] - 14 * s, cc[1] + 11 * s]]);
  const screw = new Path2D(); screw.moveTo(cc[0] + 10 * s, cc[1] + 4 * s); screw.lineTo(cc[0] + 22 * s, cc[1] + 4 * s);
  const tb = new Path2D(), ta = t * 8 * cu; tb.moveTo(cc[0] + 22 * s, cc[1] + 4 * s - Math.cos(ta) * 8 * s); tb.lineTo(cc[0] + 22 * s, cc[1] + 4 * s + Math.cos(ta) * 8 * s);
  fringe(c, [cframe, pad], 4, [-4, 0]); c.fillStyle = K; c.fill(cframe); c.fill(pad);
  hatch(c, cframe, -0.6, 6, 1.4, 'rgba(247,247,242,0.4)', [cc[0] - 16 * s, cc[1] - 10 * s, cc[0] + 12 * s, cc[1] + 18 * s]);
  c.strokeStyle = K; c.lineWidth = 2.4 * s; c.stroke(screw); c.lineWidth = 1.4 * s; c.stroke(tb);
  c.strokeStyle = PAPER; c.lineWidth = 2; c.setLineDash([0.5 * s, 0.6 * s]); c.stroke(screw); c.setLineDash([]);
  if (cu > 0.95) { const r = rng(3); c.strokeStyle = K; c.lineWidth = 3;                   // the bite: stress lines where it closes
    for (let i = 0; i < 8; i++) { const a = (r() - 0.5) * 1.6 + Math.PI, q = [cx, cy - 40 * s]; c.beginPath(); c.moveTo(q[0] + Math.cos(a) * 3 * s, q[1] + Math.sin(a) * 3 * s); c.lineTo(q[0] + Math.cos(a) * (6 + r() * 7) * s, q[1] + Math.sin(a) * (6 + r() * 7) * s); c.stroke(); } }
  }
  if (o.plate) {                                  // c14: the name-plate is a real placard on the column, large enough to read at phone size (CAPITAL > THE MARKET > COMPUTER)
    const pu = o.plateU ?? 1, flash = pu < 0.3, kk = 1 + 0.16 * (1 - pu) * (1 - pu);
    c.save(); const pc = X(0, -9), pw = 60 * s * kk, ph2 = 12.5 * s * kk;
    c.translate(pc[0], pc[1]);
    c.fillStyle = "rgba(11,11,11,0.28)"; c.fillRect(-pw / 2 + 0.9 * s, -ph2 / 2 + 0.9 * s, pw, ph2);
    c.fillStyle = flash ? PAPER : '#0b0b0b'; c.fillRect(-pw / 2, -ph2 / 2, pw, ph2);
    c.strokeStyle = flash ? '#0b0b0b' : PAPER; c.lineWidth = Math.max(2, 0.3 * s); c.strokeRect(-pw / 2 + 0.9 * s, -ph2 / 2 + 0.9 * s, pw - 1.8 * s, ph2 - 1.8 * s);
    c.fillStyle = flash ? '#0b0b0b' : PAPER; for (const bx of [-1, 1]) for (const by of [-1, 1]) { c.beginPath(); c.arc(bx * (pw / 2 - 2.2 * s), by * (ph2 / 2 - 2.2 * s), 0.55 * s, 0, TAU); c.fill(); }
    let fs = 8.2 * s * kk; c.font = `900 ${fs}px "PlayfairX"`; c.textAlign = 'center'; c.textBaseline = 'middle';
    const tx = o.plate, tw = c.measureText(tx).width + tx.length * 0.06 * fs, maxw = pw - 9 * s; if (tw > maxw) { fs *= maxw / tw; c.font = `900 ${fs}px "PlayfairX"`; }
    if ('letterSpacing' in c) c.letterSpacing = `${(0.06 * fs).toFixed(1)}px`;
    c.fillText(tx, 0, 0.4 * s); if ('letterSpacing' in c) c.letterSpacing = '0px';
    if (o.struck > 0) { c.strokeStyle = '#f7f7f2'; c.lineWidth = Math.max(5, 0.9 * s); c.beginPath(); c.moveTo(-pw / 2 + 3 * s, 0.4 * s); c.lineTo(-pw / 2 + 3 * s + (pw - 6 * s) * o.struck, 0.4 * s); c.stroke(); }
    c.restore();
  }
  c.restore();
}

// ================================================================ the rock drill (FLOOR IT.): the steel driver from behind at the face
// A stratified rock face engraved in hatching; a jackleg drill on its pusher leg, the steel running into the bore; the
// driver seen from behind (hard hat, shoulders, both fists on the drill), never a face. The right fist sits where the
// throttle fist sat (the match cut). u: 0..1 through the shot; punch: 0..1 the bit breaking through; shake [px, px]
export function drill(c, o) {
  const u = o.u ?? 0, punch = o.punch ?? 0, sh = o.shake ?? [0, 0];
  const hole = [720 + sh[0] * 0.4, 500 + sh[1] * 0.4], grip = o.grip ?? [620, 980];
  c.save();
  c.fillStyle = PAPER; c.fillRect(0, 0, W, H);
  // ---- the face: strata bands with their own hatch angle and weight, dipping gently; joints between blocks
  const r = rng(71), bounds = [];
  for (let i = 0; i <= 11; i++) { const base = -120 + i * 150, ph = r() * 9, amp = 14 + r() * 26, dip = -0.12 + r() * 0.05;
    bounds.push((x) => base + dip * x + Math.sin(x * 0.006 + ph) * amp + Math.sin(x * 0.021 + ph * 2) * amp * 0.3); }
  for (let i = 0; i < bounds.length - 1; i++) {
    const band = new Path2D(), top = bounds[i], bot = bounds[i + 1];
    band.moveTo(-20, top(-20)); for (let x = 0; x <= W + 20; x += 20) band.lineTo(x, top(x));
    for (let x = W + 20; x >= -20; x -= 20) band.lineTo(x, bot(x)); band.closePath();
    const ang = [0.15, -0.5, 0.9, 0.05, -1.1, 0.4][i % 6], gap = 6 + (i * 5 % 7), wd = 1.2 + (i % 3) * 0.7;
    hatch(c, band, ang, gap, wd, `rgba(11,11,11,${0.42 + 0.1 * (i % 3)})`);
    if (i % 3 === 1) hatch(c, band, ang + 1.3, gap * 1.6, 1.1, 'rgba(11,11,11,0.3)');
    c.strokeStyle = INK; c.lineWidth = 4 + (i % 2) * 2; c.beginPath(); c.moveTo(-20, bot(-20)); for (let x = 0; x <= W + 20; x += 20) c.lineTo(x, bot(x)); c.stroke();
    // joints: short near-vertical cracks splitting the band into blocks, a paper lip on the lit side
    let x = r() * 180;
    while (x < W) { const y0 = top(x), y1 = bot(x + 8); c.strokeStyle = INK; c.lineWidth = 4; c.beginPath(); c.moveTo(x, y0); c.lineTo(x + 6, (y0 + y1) / 2); c.lineTo(x + 2, y1); c.stroke();
      c.strokeStyle = PAPER; c.lineWidth = 2.5; c.beginPath(); c.moveTo(x + 5, y0 + 4); c.lineTo(x + 10, (y0 + y1) / 2); c.stroke(); x += 140 + r() * 220; }
  }
  // ---- the bore: a dark socket with rings, and the cracks spreading from it
  const cracks = new Path2D(), rc = rng(26), grow = clamp(u * 0.7 + punch * 1.6);
  for (let i = 0; i < 16; i++) { let x = hole[0], y = hole[1]; cracks.moveTo(x, y); const dir = rc() * TAU, L = (140 + rc() * 820) * grow;
    for (let k = 0; k < 9; k++) { const a = dir + (rc() - 0.5) * 0.9; x += Math.cos(a) * L / 9; y += Math.sin(a) * L / 9; cracks.lineTo(x, y); } }
  fringe(c, [cracks], 3); c.strokeStyle = INK; c.lineWidth = 6; c.stroke(cracks); c.strokeStyle = PAPER; c.lineWidth = 1.6; c.stroke(cracks);
  const bore = new Path2D(); bore.ellipse(hole[0], hole[1], 46, 40, 0.3, 0, TAU);
  c.fillStyle = INK; c.fill(bore); c.strokeStyle = PAPER; c.lineWidth = 3;
  for (const k of [1.4, 1.8]) { c.beginPath(); c.ellipse(hole[0], hole[1], 46 * k, 40 * k, 0.3, 3.6, 5.6); c.stroke(); }
  // ---- rock dust and chips blowing out of the bore (stateless: seeded, advected by u)
  const rd = rng(9);
  for (let i = 0; i < 70; i++) { const a = -Math.PI * 0.2 + (rd() - 0.5) * 2.2, k = (rd() + u * 3.3) % 1, d = 40 + k * 520, sz = 2 + rd() * 9 * (1 - k * 0.6);
    const q = [hole[0] + Math.cos(a) * d, hole[1] + Math.sin(a) * d + k * k * 160];
    c.fillStyle = `rgba(11,11,11,${0.85 * (1 - k)})`; c.beginPath(); c.arc(q[0], q[1], sz, 0, TAU); c.fill(); }
  // ---- the light: when the bit punches through, white floods from the bore
  if (punch > 0) {
    const g = c.createRadialGradient(hole[0], hole[1], 0, hole[0], hole[1], 160 + 1900 * ease.outCubic(punch));
    g.addColorStop(0, 'rgba(255,255,252,1)'); g.addColorStop(0.55, `rgba(255,255,252,${0.96 * punch})`); g.addColorStop(1, 'rgba(255,255,252,0)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
  }
  // ---- the jackleg drill: steel, chuck, body with fins, the pusher leg, the air hose
  const S = (x, y) => [x + sh[0], y + sh[1]];
  const chuck = S(640, 780), tail = S(470, 1150);
  const dir = [chuck[0] - tail[0], chuck[1] - tail[1]], dl = Math.hypot(...dir), du = [dir[0] / dl, dir[1] / dl], dn = [du[1], -du[0]];
  const Q = (t, n) => [tail[0] + du[0] * t + dn[0] * n, tail[1] + du[1] * t + dn[1] * n];
  const steel = poly([[hole[0] - 9, hole[1] + 4], [hole[0] + 9, hole[1] - 4], Q(dl + 20, -12), Q(dl + 20, 12)]);
  const body = smoothClosed([Q(-20, 70), Q(dl * 0.55, 88), Q(dl - 10, 62), Q(dl + 30, 30), Q(dl + 30, -30), Q(dl - 10, -62), Q(dl * 0.55, -86), Q(-20, -66), Q(-44, 0)]);
  const leg = poly([Q(dl * 0.35, 60), Q(dl * 0.35 + 30, 70), S(1010, 1960), S(950, 1960)]);
  const hose = new Path2D(); hose.moveTo(...Q(-40, 0)); hose.bezierCurveTo(...S(200, 1260), ...S(260, 1700), ...S(-40, 1780));
  c.lineCap = 'round';
  fringe(c, [steel, body, leg], 6, [-6, 0]);
  c.fillStyle = INK; c.fill(steel); c.fill(leg); c.fill(body);
  c.strokeStyle = INK; c.lineWidth = 34; c.stroke(hose); c.strokeStyle = PAPER; c.lineWidth = 3; c.setLineDash([10, 16]); c.stroke(hose); c.setLineDash([]);
  c.save(); c.clip(body); c.strokeStyle = PAPER; c.lineWidth = 5;
  for (let t = 20; t < dl * 0.8; t += 26) { const a = Q(t, -95), b = Q(t, 95); c.beginPath(); c.moveTo(...a); c.lineTo(...b); c.stroke(); }   // cooling fins
  c.lineWidth = 3; c.beginPath(); c.moveTo(...Q(-10, 40)); c.lineTo(...Q(dl, 40)); c.stroke();                                               // lit edge
  c.restore();
  c.save(); c.clip(steel); c.strokeStyle = PAPER; c.lineWidth = 2.5; c.beginPath(); c.moveTo(hole[0] + 2, hole[1] - 2); c.lineTo(...Q(dl + 20, 4)); c.stroke(); c.restore();
  // the handle bar across the body's back end, where the fists hold
  const hb = poly([Q(dl * 0.3, -180), Q(dl * 0.3 + 30, -180), Q(dl * 0.3 + 30, 150), Q(dl * 0.3, 150)]);
  c.fillStyle = INK; c.fill(hb);
  // ---- the driver, from behind: hard hat, shoulders, the jacket's reflective band; arms out to the drill
  const hx = 250 + sh[0] * 0.6, hy = 1310 + sh[1] * 0.6;
  const back = smoothClosed([[hx - 250, 1960], [hx - 280, 1620], [hx - 230, hy + 170], [hx - 110, hy + 110], [hx - 40, hy + 80], [hx + 60, hy + 80], [hx + 150, hy + 100], [hx + 300, hy + 150], [hx + 360, hy + 330], [hx + 330, 1960]]);
  const armR = poly([[hx + 250, hy + 130], [hx + 330, hy + 230], ...[Q(dl * 0.3 + 10, -150), Q(dl * 0.3 + 20, -90)].reverse()]);
  const armL = poly([[hx - 180, hy + 150], [hx - 90, hy + 120], Q(dl * 0.3, 110), Q(dl * 0.3 - 20, 160)]);
  const head = new Path2D(); head.ellipse(hx + 10, hy + 20, 88, 100, 0, 0, TAU);
  const dome = new Path2D(); dome.ellipse(hx + 10, hy - 20, 118, 108, 0, Math.PI, 0); dome.closePath();
  const brim = new Path2D(); brim.ellipse(hx + 10, hy - 18, 170, 34, 0, 0, TAU);
  fringe(c, [back, armR, armL, dome, brim], 7, [-7, 0]);
  c.fillStyle = INK; for (const p of [armL, armR, back, head]) c.fill(p);
  c.strokeStyle = PAPER; c.lineWidth = 8; c.stroke(brim); c.fillStyle = INK; c.fill(brim); c.fill(dome);
  c.save(); c.clip(dome); c.strokeStyle = PAPER; c.lineWidth = 5; c.beginPath(); c.ellipse(hx + 10, hy - 20, 30, 108, 0, Math.PI, 0); c.stroke(); c.restore();   // the ridge
  c.save(); c.clip(back);
  c.fillStyle = PAPER; c.fillRect(hx - 300, hy + 330, 700, 22); c.fillRect(hx - 300, hy + 370, 700, 7);                 // reflective band
  c.strokeStyle = 'rgba(247,247,242,0.55)';
  for (let x = hx - 260; x < hx + 360; x += 16) { c.lineWidth = 1.2 + 1.6 * Math.max(0, Math.sin((x - hx) / 180)); c.beginPath(); c.moveTo(x, hy + 150); c.quadraticCurveTo(x + 10, hy + 500, x - 6, 1960); c.stroke(); }   // burin modelling
  c.strokeStyle = PAPER; c.lineWidth = 4; c.beginPath(); c.moveTo(hx + 10, hy + 120); c.lineTo(hx + 20, 1960); c.stroke();                                  // centre seam
  c.restore();
  c.save(); c.clip(armR); c.strokeStyle = 'rgba(247,247,242,0.6)'; c.lineWidth = 3; c.beginPath(); c.moveTo(hx + 300, hy + 170); c.lineTo(...Q(dl * 0.3 + 20, -120)); c.stroke(); c.restore();
  // the fists on the handle bar (the right one where the throttle fist was: the match cut)
  const gr = Q(dl * 0.3 + 15, -120); glove(c, { s: o.gs ?? 14, x: gr[0], y: gr[1], a: Math.atan2(-du[1], du[0]) - Math.PI / 2 + 0.2, squeeze: 0.95, fr: 6, off: [-6, 0] });
  const gl = Q(dl * 0.3 + 12, 120);
  glove(c, { s: (o.gs ?? 14) * 0.85, x: gl[0], y: gl[1], a: Math.atan2(-du[1], du[0]) - Math.PI / 2 - 0.1, squeeze: 0.95, fr: 5, off: [-6, 0] });
  c.restore();
}

// ================================================================ the AI ally: a rebar colossus
// J: a pose (the hero's joint set in figure units), X: figure->screen. Ribbed bars, tie-wire twists at the crossings,
// scaffold couplers at the joints, and a head made of a coupler cluster (never a globe). o: s (px/unit), grow 0..1
export function colossus(c, J, X, o = {}) {
  const s = o.s, grow = o.grow ?? 1, fr = o.fr ?? 4;
  const bones = [];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const bone = (a, b, w, n) => bones.push([a, b, w, n]);
  for (const l of [J.legs[1], J.legs[0]]) { bone(add(J.P, [0.6, 0.8]), l.K, 10, 3); bone(l.K, l.A, 7.6, 3); bone(l.A, add(l.A, rot([10, -3.8], l.fp)), 5, 2); }
  for (const a of [J.arms[1], J.arms[0]]) { bone(J.Sj, a.E, 6.4, 2); bone(a.E, a.Wr, 5.4, 2); }
  bone(J.P, J.S, 16, 4); bone(add(J.S, [-7, -1]), add(J.S, [7, -1]), 5, 2);
  const bars = new Path2D(), ribs = new Path2D(), ties = new Path2D(), couplers = [];
  let n = 0; const total = bones.length;
  for (const [a, b, w, nb] of bones) {
    const k = clamp(grow * total - n); n++; if (k <= 0) continue;
    const A = X(a), B = X(b), d = [B[0] - A[0], B[1] - A[1]], L = Math.hypot(...d) || 1, u = [d[0] / L, d[1] / L], nv = [u[1], -u[0]];
    const E = [A[0] + d[0] * k, A[1] + d[1] * k];
    for (let i = 0; i < nb; i++) {                                   // the longitudinal bars, with ribs (deformed bar)
      const f = nb === 1 ? 0 : -0.5 + i / (nb - 1), q = [nv[0] * f * w * s, nv[1] * f * w * s];
      bars.moveTo(A[0] + q[0] - u[0] * 1.5 * s, A[1] + q[1] - u[1] * 1.5 * s); bars.lineTo(E[0] + q[0] + u[0] * 1.5 * s * k, E[1] + q[1] + u[1] * 1.5 * s * k);
      for (let t = 0; t < L * k; t += 0.9 * s) {
        const m = [A[0] + u[0] * t + q[0], A[1] + u[1] * t + q[1]], h = 0.45 * s;
        ribs.moveTo(m[0] - nv[0] * h + u[0] * h * 0.5, m[1] - nv[1] * h + u[1] * h * 0.5); ribs.lineTo(m[0] + nv[0] * h - u[0] * h * 0.5, m[1] + nv[1] * h - u[1] * h * 0.5);
      }
    }
    for (let t = 1.8 * s; t < L * k - s; t += 3.2 * s) {             // stirrups tied at every crossing with a twist
      const m = [A[0] + u[0] * t, A[1] + u[1] * t], h = 0.5 * w * s;
      ties.moveTo(m[0] - nv[0] * h, m[1] - nv[1] * h); ties.lineTo(m[0] + nv[0] * h, m[1] + nv[1] * h);
      for (let i = 0; i < nb; i++) {
        const f = nb === 1 ? 0 : -0.5 + i / (nb - 1), x = m[0] + nv[0] * f * w * s, y = m[1] + nv[1] * f * w * s, r = 0.55 * s;
        ties.moveTo(x - r, y - r); ties.lineTo(x + r, y + r); ties.moveTo(x - r, y + r); ties.lineTo(x + r, y - r);
      }
    }
    if (k >= 1) couplers.push([B, Math.atan2(u[1], u[0])]);
  }
  // the head: a cluster of scaffold couplers and short bar stubs around the neck top
  const hc = X(J.Hc), head = [];
  if (grow > 0.9) {
    const r = rng(5);
    for (let i = 0; i < 7; i++) { const a = i / 7 * TAU + 0.3, d = (i === 0 ? 0 : 3.4) * s; head.push([[hc[0] + Math.cos(a) * d, hc[1] + Math.sin(a) * d * 1.15], a + r() * 0.8]); }
    for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i - 2) * 0.45; bars.moveTo(hc[0], hc[1]); bars.lineTo(hc[0] + Math.cos(a) * 7.5 * s, hc[1] + Math.sin(a) * 7.5 * s); }
    bars.moveTo(...X(J.N)); bars.lineTo(hc[0], hc[1]);
  }
  c.save(); if (o.alpha != null) c.globalAlpha = o.alpha;
  c.lineCap = 'round'; c.lineJoin = 'round';
  const bw = Math.max(2.4, 0.62 * s);
  for (const [col, kk] of BANDS) { c.strokeStyle = col; c.lineWidth = bw + 2 * fr * kk; c.stroke(bars); }
  c.strokeStyle = INK; c.lineWidth = bw; c.stroke(bars);
  c.strokeStyle = PAPER; c.lineWidth = Math.max(1, 0.16 * s); c.stroke(ribs);
  c.strokeStyle = INK; c.lineWidth = Math.max(1.4, 0.24 * s); c.stroke(ties);
  const cp = (p, a, k = 1) => { const w = 2.4 * s * k, h = 1.5 * s * k; const q = [[-w, -h], [w, -h], [w, h], [-w, h]].map(v => { const r_ = rot(v, a); return [p[0] + r_[0], p[1] + r_[1]]; }); return poly(q); };
  for (const [p, a] of [...couplers, ...head]) { const P_ = cp(p, a, head.includes(p) ? 1.25 : 1); fringe(c, [P_], 2.4); c.fillStyle = INK; c.fill(P_);
    c.strokeStyle = PAPER; c.lineWidth = Math.max(1, 0.2 * s); c.beginPath(); c.arc(p[0], p[1], 0.55 * s, 0, TAU); c.stroke(); }
  c.restore();
}

// ================================================================ the horizon (the 1 km scale): refinery and grid towers at shin height
export function horizon(c, gy, o = {}) {
  const haze = o.haze ?? 0.5, scroll = o.scroll ?? 0, r = rng(o.seed ?? 44);
  c.save();
  c.fillStyle = 'rgba(11,11,11,0.07)'; c.fillRect(0, gy, W, H - gy);
  // ground hatching: ruled furrows converging to a far point, scrolling
  c.strokeStyle = 'rgba(11,11,11,0.28)'; c.lineWidth = 2; c.beginPath();
  for (let k = -14; k <= 14; k++) { c.moveTo(W / 2 + k * 12, gy); c.lineTo(W / 2 + k * 300 - scroll * 0.2 % 300, H); }
  for (let z = 1; z < 9; z++) { const y = gy + Math.pow(z / 9, 2.2) * (H - gy); c.moveTo(0, y); c.lineTo(W, y); }
  c.stroke();
  // the skyline: refinery columns, flare stacks, lattice pylons with catenaries, tanks; hazed toward paper
  const sky = new Path2D(), wires = new Path2D();
  let x = -((scroll * 0.35) % 1400) - 40;
  while (x < W + 60) {
    const kind = Math.floor(r() * 4), h = 30 + r() * 90, w = 10 + r() * 26;
    if (kind === 0) { sky.rect(x, gy - h, w, h); sky.rect(x + w * 0.3, gy - h - 26, w * 0.35, 26); }             // column + stack
    else if (kind === 1) { sky.moveTo(x, gy); sky.lineTo(x + w * 0.5, gy - h * 1.3); sky.lineTo(x + w, gy); sky.closePath();   // pylon
      wires.moveTo(x + w * 0.5, gy - h * 1.2); wires.quadraticCurveTo(x + w * 0.5 + 90, gy - h * 0.9, x + w * 0.5 + 180, gy - h * 1.15); }
    else if (kind === 2) { sky.ellipse(x + w, gy - h * 0.25, w * 1.3, h * 0.25, 0, Math.PI, 0); sky.rect(x - w * 0.3, gy - h * 0.25, w * 2.6, h * 0.25); }  // tank
    else { sky.rect(x, gy - h * 0.6, w * 2.4, h * 0.6); for (let k = 0; k < 3; k++) sky.rect(x + k * w * 0.8, gy - h * 0.6 - 18, 5, 18); }        // plant
    x += w * 2 + 20 + r() * 90;
  }
  c.fillStyle = `rgba(11,11,11,${0.62 - 0.4 * haze})`; c.fill(sky);
  c.strokeStyle = `rgba(11,11,11,${0.5 - 0.3 * haze})`; c.lineWidth = 1.5; c.stroke(wires);
  const g = c.createLinearGradient(0, gy - 160, 0, gy + 10); g.addColorStop(0, 'rgba(247,247,242,0)'); g.addColorStop(1, `rgba(247,247,242,${0.5 * haze})`);
  c.fillStyle = g; c.fillRect(0, gy - 160, W, 170);
  c.strokeStyle = 'rgba(11,11,11,0.75)'; c.lineWidth = 3; c.beginPath(); c.moveTo(0, gy); c.lineTo(W, gy); c.stroke();
  c.restore();
}

// ================================================================ the ignition (slow motion): engines, flame column, ice sheets
// u: 0..1 through the slow-mo window (b32-34); s px/m; the rocket's S-IC base at (cx, by)
export function ignition(c, u, o = {}) {
  const cx = o.x ?? 560, by = o.y ?? 760, s = o.s ?? 70;
  const X = (x) => cx + x * s, Y = (y) => by - y * s;
  c.save();
  // the lower stage: skin with the black roll pattern, fins, five bells
  const R1 = 5.05;
  const body = poly([[X(-R1), Y(0)], [X(-R1), Y(40)], [X(R1), Y(40)], [X(R1), Y(0)]]);
  fringe(c, [body], 6, [0, -4]);
  c.fillStyle = '#fdfdfb'; c.fill(body);
  c.save(); c.clip(body);
  c.fillStyle = INK; c.fillRect(X(-R1), Y(12.5), (R1 - 1.7) * s, 11 * s); c.fillRect(X(1.7), Y(12.5), (R1 - 1.7) * s, 11 * s);
  const gr = c.createLinearGradient(X(-R1), 0, X(R1), 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.25)'); c.fillStyle = gr; c.fillRect(X(-R1), Y(40), 2 * R1 * s, 40 * s);
  c.font = `700 ${Math.round(1.05 * s)}px "Plex Mono"`; c.fillStyle = 'rgba(11,11,11,0.86)'; c.textAlign = 'center'; c.fillText('1963', X(0), Y(6.5));
  c.restore();
  c.strokeStyle = INK; c.lineWidth = 4; c.stroke(body);
  const bells = [];
  for (const bx of [-3.1, 0, 3.1]) bells.push(poly([[X(bx - 1.0), Y(0)], [X(bx + 1.0), Y(0)], [X(bx + 1.85), Y(-5.8)], [X(bx - 1.85), Y(-5.8)]]));
  for (const sg of [-1, 1]) bells.push(poly([[X(sg * R1), Y(10)], [X(sg * (R1 + 2.6)), Y(2)], [X(sg * (R1 + 2.6)), Y(-1.8)], [X(sg * R1), Y(-0.5)]]));
  fringe(c, bells, 5); c.fillStyle = INK; for (const b of bells) c.fill(b);
  // the flame column: ink billows growing slowly from the bells, rimmed by the fringe
  const r = rng(33), puffs = [];
  const grow = ease.inCubic(clamp(u * 1.15));
  for (let i = 0; i < 38; i++) { const k = r(), dir = r() - 0.5;
    const y = Y(-5.8) + k * 1600 * grow, rad = (30 + k * 220) * (0.4 + grow) * (0.6 + r() * 0.6);
    if (k * 1600 * grow < 5) continue; puffs.push([X(dir * 7 * (0.3 + k)), y, rad]); }
  const pp = puffs.map(([x, y, rr]) => { const p = new Path2D(); p.arc(x, y, rr, 0, TAU); return p; });
  fringe(c, pp, 6); c.strokeStyle = INK; c.lineWidth = 5; for (const p of pp) c.stroke(p); c.fillStyle = PAPER; for (const p of pp) c.fill(p);
  c.strokeStyle = 'rgba(11,11,11,0.5)'; c.lineWidth = 3; for (const [x, y, rr] of puffs) { c.beginPath(); c.arc(x - rr * 0.1, y - rr * 0.1, rr * 0.75, 1.9, 3.4); c.stroke(); }
  // the flame cores: vertical ink tongues under each bell
  for (const bx of [-3.1, 0, 3.1]) { const fl = poly([[X(bx - 1.5), Y(-5.8)], [X(bx + 1.5), Y(-5.8)], [X(bx + 0.4), Y(-5.8) + 900 * grow], [X(bx - 0.4), Y(-5.8) + 900 * grow]]);
    c.save(); c.globalAlpha = 0.9; c.fillStyle = INK; c.fill(fl); c.restore(); hatch(c, fl, Math.PI / 2, 9, 3, PAPER); }
  // ice sheets: white plates cracking off the skin and falling slowly, turning (the 500 fps look)
  const ri = rng(91);
  for (let i = 0; i < 26; i++) {
    const x0 = X((ri() - 0.5) * 2 * R1), y0 = Y(4 + ri() * 34), t0 = ri() * 0.6, age = Math.max(0, u - t0);
    if (age <= 0) continue;
    const fall = 900 * age * age + 60 * age, drift = (ri() - 0.5) * 300 * age, sp = (ri() - 0.5) * 3 * age, sz = 20 + ri() * 70;
    const p = [x0 + drift, y0 + fall];
    const shard = poly([[0, -sz], [sz * 0.7, -sz * 0.1], [sz * 0.2, sz * 0.8], [-sz * 0.8, sz * 0.2]].map(q => { const r_ = rot(q, sp + ri() * 3); return [p[0] + r_[0], p[1] + r_[1] * 0.5]; }));
    fringe(c, [shard], 3); c.fillStyle = PAPER; c.fill(shard); c.strokeStyle = INK; c.lineWidth = 3; c.stroke(shard);
    c.strokeStyle = 'rgba(11,11,11,0.5)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(p[0] - sz * 0.4, p[1]); c.lineTo(p[0] + sz * 0.3, p[1] - sz * 0.1); c.stroke();
  }
  c.restore();
}

// ================================================================ the ACP mark: gear, hammer and sickle, FOUR stripes (kit acpEmblem is the
// asset). The four lanes fan in from a perspective rush and lock onto the asset's own stripe rects (measured from
// acp_logo.png: rows at y 76 / 122.5 / 169 / 216 of the 236 px emblem, right edge x 340), then the emblem itself lands.
// lock: 0..1 (lanes -> stripes); reveal: 0..1 (the gear, hammer and sickle, and the red); a: rotation (rad, negative = CCW)
const STRIPES = [[180, 76], [208, 122.5], [203, 169], [198, 216]];
export function emblemLock(c, lock, o, acpEmblem) {
  const cx = o.x ?? 540, cy = o.y ?? 960, size = o.size ?? 700, a = o.a ?? 0, col = o.color ?? RED;
  const k = size / 236, ew = 380 * k, u = ease.inOutCubic(clamp(lock)), rv = clamp(o.reveal ?? 0);
  const E = (x, y) => [-ew / 2 + x * k, -size / 2 + y * k];
  c.save(); c.translate(cx, cy); c.rotate(a);
  for (let i = 0; i < 4; i++) {
    const [x0, yc] = STRIPES[i], h = 11 * k;
    const L = E(x0, yc), R = E(340, yc);
    const fanY = (i - 1.5) * size * 1.1, far = [R[0] + size * 2.2, R[1] * 0.1];
    const q = [[lerp(-size * 2.4, L[0], u), lerp(fanY - h * 5, L[1] - h, u)], [lerp(far[0], R[0], u), lerp(far[1] - 3, R[1] - h, u)],
      [lerp(far[0], R[0], u), lerp(far[1] + 3, R[1] + h, u)], [lerp(-size * 2.4, L[0], u), lerp(fanY + h * 5, L[1] + h, u)]];
    const p = poly(q);
    fringe(c, [p], 6 * (1 - rv) + 1.5, [-8 * (1 - u), 0]);
    c.fillStyle = INK; c.fill(p);
    if (rv > 0) { c.save(); c.globalAlpha = rv; c.fillStyle = col; c.fill(p); c.restore(); }
  }
  if (rv > 0 && acpEmblem) { c.save(); c.globalAlpha = rv; acpEmblem(c, 0, 0, size, { color: col }); c.restore(); }
  c.restore();
}
