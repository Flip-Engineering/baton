// WHO OWNS THE MACHINES? (machines): the figures. Generated 2D vector silhouettes drawn to the Party's own poster poses
// (the OWN THE FUTURE trucker in profile looking up; the JOIN ACP hard-hat worker from behind), plus the rig's mirror
// arm and cab door, the gloved hand and the ridge crowd. Every figure is near-black; all detail lives in the rim light,
// a few low interior seams and the sky (TRAJECTORY_MACHINES §2.1.3, §2.3).
//
// Everything is authored as point lists in a local unit space and smoothed with centripetal Catmull-Rom (points
// tagged 'c' are corners). Outlines carry a small, material-dependent irregularity (cloth wobble, stubble fuzz) so
// the silhouettes read as photographs of real men, not as clip art. A figure is drawn into a 2D context whose
// transform the caller sets (the camera), so it is crisp at any zoom (A' is the same man at 3-4x).
//
//   drawTrucker(ctx, o)   o = { tilt, breath, jaw, lips, stubble, cheek, rimA, rimB, ... }   (local: head height 1)
//   drawHardHat(ctx, o)   o = { turn, breath, sticker, rim, ... }                             (local: frame px at zoom 1)
//   drawGlove(ctx, o)     o = { curl, rise }
//   drawRig(ctx, o)       the mirror arm, the cab edge and the door tile (frame px at zoom 1)
//   drawRidge(ctx, o)     the crowd frame: caps and hard hats on one horizon, every head tipped up to the dot
//   rimLight(layer, ...)  the rim pass: the silhouette's own alpha, differenced against itself shifted from the light

// ------------------------------------------------------------------ small math
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, x) => a + (b - a) * x;
function hash(i) { let x = Math.imul((i | 0) ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; }
function vn1(x, s = 0) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash(i * 7 + s * 131), hash((i + 1) * 7 + s * 131), u) * 2 - 1; }

// ------------------------------------------------------------------ curves
// pts: [[x, y, tag?], ...]; tag 'c' = corner (the curve stops there). Returns a dense polyline [[x, y], ...].
export function spline(pts, closed = false, per = 10) {
  const n = pts.length, out = [];
  const P = i => closed ? pts[(i + n) % n] : pts[clamp(i, 0, n - 1)];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p1 = P(i), p2 = P(i + 1);
    const p0 = p1[2] === 'c' ? p1 : P(i - 1), p3 = p2[2] === 'c' ? p2 : P(i + 2);
    // centripetal Catmull-Rom (alpha 0.5)
    const d = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]) + 1e-9, 0.5);
    const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const m = Math.max(2, Math.ceil(per * Math.min(4, 1 + len * 3)));
    for (let k = 0; k < m; k++) {
      const t = lerp(t1, t2, k / m);
      const A1 = [0, 1].map(j => (t1 - t) / (t1 - t0) * p0[j] + (t - t0) / (t1 - t0) * p1[j]);
      const A2 = [0, 1].map(j => (t2 - t) / (t2 - t1) * p1[j] + (t - t1) / (t2 - t1) * p2[j]);
      const A3 = [0, 1].map(j => (t3 - t) / (t3 - t2) * p2[j] + (t - t2) / (t3 - t2) * p3[j]);
      const B1 = [0, 1].map(j => (t2 - t) / (t2 - t0) * A1[j] + (t - t0) / (t2 - t0) * A2[j]);
      const B2 = [0, 1].map(j => (t3 - t) / (t3 - t1) * A2[j] + (t - t1) / (t3 - t1) * A3[j]);
      out.push([0, 1].map(j => (t2 - t) / (t2 - t1) * B1[j] + (t - t1) / (t2 - t1) * B2[j]));
    }
  }
  if (!closed) out.push([pts[n - 1][0], pts[n - 1][1]]);
  return out;
}
// displace a polyline along its normals by amp(i, u) * noise; freq in cycles per unit length
export function rough(poly, amp, freq, seed = 1) {
  let s = 0; const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[Math.max(0, i - 1)], b = poly[Math.min(poly.length - 1, i + 1)];
    if (i) s += Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]);
    let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    const A = typeof amp === 'function' ? amp(i / (poly.length - 1), poly[i]) : amp;
    const d = A * (vn1(s * freq, seed) * 0.7 + vn1(s * freq * 3.1, seed + 9) * 0.3);
    out.push([poly[i][0] + nx * d, poly[i][1] + ny * d]);
  }
  return out;
}
export function tracePath(ctx, poly, closed = true) {
  ctx.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
  if (closed) ctx.closePath();
}
const xf = (pts, { x = 0, y = 0, s = 1, sx = s, sy = s, rot = 0, px = 0, py = 0 }) => {        // rotate about (px, py), scale, move
  const c = Math.cos(rot), n = Math.sin(rot);
  return pts.map(p => { const u = p[0] - px, v = p[1] - py; return [(u * c - v * n + px) * sx + x, (u * n + v * c + py) * sy + y, p[2]]; });
};
// points along a polyline at arc fractions, with the outward normal (for stubble, stitching, fog)
function along(poly, u0, u1, step) {
  const L = [0]; for (let i = 1; i < poly.length; i++) L.push(L[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]));
  const T = L[L.length - 1], out = [];
  for (let s = u0 * T; s <= u1 * T; s += step) {
    let i = 1; while (i < L.length - 1 && L[i] < s) i++;
    const f = (s - L[i - 1]) / (L[i] - L[i - 1] || 1), a = poly[i - 1], b = poly[i];
    const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
    out.push({ x: lerp(a[0], b[0], f), y: lerp(a[1], b[1], f), tx: tx / l, ty: ty / l, nx: ty / l, ny: -tx / l, s });
  }
  return out;
}

// ================================================================== THE TRUCKER (profile, facing right, head tipped back)
// Local units: head height 1 (cap crown ~ -0.06, chin 1.0), face toward +x, y down, upright. The head group rotates
// about the neck pivot; the collar and shoulders stay put. Proportions follow the OWN THE FUTURE poster: a heavy-set
// man, full beard stubble on a strong chin, a structured six-panel cap with a long, slightly curved bill.
const PIV = [0.02, 0.97];
function truckerHead({ jaw = 0, lips = 0 } = {}) {
  const J = jaw * 0.012, Lp = lips * 0.018;                    // the jaw sets (forward, squarer); the lips part
  const face = [                                               // from the throat up the front to under the bill
    [0.13, 1.34], [0.135, 1.22], [0.155, 1.15], [0.14, 1.10], [0.18, 1.065],           // Adam's apple, throat
    [0.28, 1.035 + J * 0.5], [0.365, 0.995 + J], [0.425 + J, 0.935],                     // beard under the jaw, chin
    [0.445 + J, 0.865], [0.43, 0.815], [0.418, 0.795 + Lp * 0.3],                       // chin point, sulcus
    [0.445, 0.765 + Lp], [0.44, 0.742 + Lp * 0.5], [0.425, 0.728], [0.438, 0.712],        // lower lip, mouth
    [0.447, 0.69], [0.438, 0.668], [0.425, 0.652, 'c'],                                   // upper lip, subnasale
    [0.46, 0.638], [0.482, 0.615], [0.48, 0.592],                                         // nose tip
    [0.455, 0.55], [0.422, 0.502], [0.392, 0.468], [0.385, 0.452, 'c'],                   // dorsum, nasion
    [0.402, 0.425], [0.398, 0.395], [0.39, 0.36], [0.392, 0.338, 'c'],                   // brow under the bill
  ];
  // bill and crown in the head's own (upright) frame, set to the poster's pose: the cap pushed back, the bill's
  // underside showing (we look up at it), so it reads as a thick wedge from the brow to its rounded tip
  const bill = [
    [0.395, 0.33], [0.445, 0.292], [0.51, 0.258], [0.56, 0.232], [0.585, 0.212, 'c'],
    [0.60, 0.18], [0.598, 0.132], [0.583, 0.10, 'c'], [0.53, 0.082], [0.44, 0.058], [0.35, 0.036], [0.315, 0.026, 'c'],
  ];
  const cap = [                                                // a structured cap: tall front panel, flat crown, full back
    [0.27, -0.03], [0.21, -0.09], [0.14, -0.14],
    [0.105, -0.152], [0.08, -0.156], [0.055, -0.152],          // the button
    [-0.08, -0.16], [-0.24, -0.12], [-0.38, -0.04], [-0.49, 0.09], [-0.55, 0.26], [-0.555, 0.42], [-0.52, 0.54],
  ];
  const back = [                                               // below the cap band: hair, the back of the skull, the nape
    [-0.47, 0.62], [-0.42, 0.72], [-0.36, 0.83], [-0.30, 0.93], [-0.26, 1.02], [-0.25, 1.10], [-0.26, 1.34],
  ];
  return { face, bill, cap, back };
}
// collar and shoulders (not rotated): a work jacket with a stand-up collar, the back shoulder falling away left
function truckerBody(breath = 0) {
  const b = breath * 0.035;
  return [
    [0.36, 1.10], [0.40, 1.24 - b], [0.46, 1.36 - b], [0.56, 1.50 - b], [0.66, 1.72 - b], [0.72, 2.0], [0.74, 2.6, 'c'],
    [-1.6, 2.6, 'c'], [-1.45, 2.05 - b * 0.5], [-1.20, 1.78 - b], [-0.92, 1.58 - b], [-0.66, 1.44 - b],
    [-0.52, 1.30 - b], [-0.47, 1.16 - b], [-0.40, 1.08], [-0.20, 1.02], [0.10, 1.02],
  ];
}
export const TRUCKER = { PIV };

// Build every outline of the trucker in local units (rotated head + body). Returned polylines are dense.
export const CAPPIV = [0.39, 0.33];
export function truckerShape({ tilt = -0.56, breath = 0, jaw = 0, lips = 0, seed = 3, capTilt = 0, billTilt = 0 } = {}) {
  const H = truckerHead({ jaw, lips });
  // the cap sits pushed back on the head (the poster's bill points well above the face's normal)
  H.cap = xf(H.cap, { rot: capTilt, px: CAPPIV[0], py: CAPPIV[1] });
  H.bill = xf(xf(H.bill, { rot: billTilt, px: 0.395, py: 0.34 }), { rot: capTilt, px: CAPPIV[0], py: CAPPIV[1] });
  const rot = p => xf(p, { rot: tilt, px: PIV[0], py: PIV[1] });
  const head = rot([...H.face, ...H.bill, ...H.cap, ...H.back]);
  const bodyPts = truckerBody(breath);
  let face = spline(rot(H.face), false, 14), bill = spline(rot(H.bill), false, 12), cap = spline(rot(H.cap), false, 12), back = spline(rot(H.back), false, 10);
  // materials: stubble fuzz on the jaw and chin (face fraction 0.15-0.62 is throat-to-lips), cloth wobble on the cap
  face = rough(face, u => u < 0.12 ? 0.002 : u < 0.62 ? 0.0065 * Math.sin(Math.PI * clamp((u - 0.1) / 0.55)) + 0.001 : 0.0012, 140, seed);
  cap = rough(cap, 0.003, 9, seed + 1);
  back = rough(back, u => 0.006 * clamp(u * 3) * clamp((0.75 - u) * 4), 60, seed + 2);         // hair at the nape
  const body = rough(spline(bodyPts, true, 10), 0.006, 5, seed + 3);
  const outline = [...face, ...bill.slice(1), ...cap.slice(1), ...back.slice(1)];
  return { outline, face, bill, cap, back, body, head };
}

// Draw the trucker silhouette (fill only) in local units; the caller sets the transform. Returns the shape.
export function fillTrucker(ctx, o = {}, color = '#100E10') {
  const S = truckerShape(o);
  ctx.fillStyle = color;
  ctx.beginPath(); tracePath(ctx, S.body); ctx.fill();
  ctx.beginPath(); tracePath(ctx, S.outline); ctx.fill();
  return S;
}

// Interior detail and the edge hairs the rim catches: cap seams and bill stitching, stubble, the cap button, collar seam.
// light: a CSS colour for the lit threads; k: 0..1 how much of it shows; u = px per local unit (line widths).
export function truckerDetail(ctx, S, { light = 'rgba(160,170,160,1)', k = 1, u = 500, tilt = -0.56, seed = 5, warm = 0, warmCol = 'rgba(229,50,57,1)' } = {}) {
  const lw = 1 / u;
  ctx.save();
  ctx.lineCap = 'round';
  // bill stitching: rows of dashes following the bill's top edge, just inside it
  ctx.strokeStyle = light; ctx.globalAlpha = 0.34 * k; ctx.lineWidth = 1.3 * lw;
  for (const inset of [0.010, 0.019, 0.028]) {
    const pts = along(S.bill, 0.55, 0.98, 0.0105);
    ctx.beginPath();
    for (const p of pts) { const x = p.x + p.nx * inset, y = p.y + p.ny * inset; ctx.moveTo(x - p.tx * 0.0035, y - p.ty * 0.0035); ctx.lineTo(x + p.tx * 0.0035, y + p.ty * 0.0035); }
    ctx.stroke();
  }
  // cap panel seams (two arcs from the button down the crown) and the front-panel seam
  const rot = p => xf(p, { rot: tilt, px: PIV[0], py: PIV[1] });
  ctx.globalAlpha = 0.07 * k; ctx.lineWidth = 1.4 * lw;
  const crot = rot;
  for (const seam of [[[0.08, -0.15], [0.17, -0.09], [0.26, 0.0], [0.33, 0.1]], [[0.07, -0.15], [-0.12, -0.11], [-0.30, -0.01], [-0.44, 0.16]]]) {
    ctx.beginPath(); tracePath(ctx, spline(crot(seam), false, 8), false); ctx.stroke();
  }
  // stubble: short hairs standing off the jaw, chin and upper lip, silhouetted, a few catching the rim
  const hairs = along(S.face, 0.1, 0.66, 0.0026);
  ctx.globalAlpha = 1; ctx.lineWidth = 1.15 * lw; ctx.strokeStyle = '#0c0a0b';
  ctx.beginPath();
  hairs.forEach((p, i) => { const h = hash(i * 13 + seed), L = 0.003 + 0.006 * h;
    const a = (hash(i * 7 + seed) - 0.5) * 0.9; const nx = -(p.nx * Math.cos(a) - p.ny * Math.sin(a)), ny = -(p.nx * Math.sin(a) + p.ny * Math.cos(a));
    ctx.moveTo(p.x - nx * 0.002, p.y - ny * 0.002); ctx.lineTo(p.x + nx * L, p.y + ny * L); });
  ctx.stroke();
  ctx.strokeStyle = light; ctx.globalAlpha = 0.5 * k;
  ctx.beginPath();
  hairs.forEach((p, i) => { if (hash(i * 3 + seed + 1) > 0.55) return; const L = 0.004 + 0.007 * hash(i * 5 + seed);
    ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.nx * L, p.y - p.ny * L); });
  ctx.stroke();
  // the dot's colour on the cheek: a red rim on the lit front of the face (nose, lips, chin), strongest at the cheek
  if (warm > 0) {
    ctx.globalAlpha = 1;
    const pts = along(S.face, 0.28, 0.9, 0.004);
    ctx.globalCompositeOperation = 'source-atop';
    for (const p of pts) {
      const w = Math.sin(Math.PI * clamp((p.s - pts[0].s) / (pts[pts.length - 1].s - pts[0].s)));
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 0.05);
      g.addColorStop(0, warmCol.replace(/[\d.]+\)$/, `${0.05 * warm * w})`)); g.addColorStop(1, warmCol.replace(/[\d.]+\)$/, '0)'));
      ctx.fillStyle = g; ctx.fillRect(p.x - 0.05, p.y - 0.05, 0.1, 0.1);
    }
    // the cheek glow of the poster: a soft red bloom on the cheekbone, inside the silhouette
    const c = xf([[0.37, 0.60]], { rot: tilt, px: PIV[0], py: PIV[1] })[0];
    ctx.save(); ctx.translate(c[0], c[1]); ctx.rotate(tilt + 0.3); ctx.scale(0.55, 1);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.1);
    g.addColorStop(0, warmCol.replace(/[\d.]+\)$/, `${0.34 * warm})`)); g.addColorStop(0.6, warmCol.replace(/[\d.]+\)$/, `${0.1 * warm})`)); g.addColorStop(1, warmCol.replace(/[\d.]+\)$/, '0)'));
    ctx.fillStyle = g; ctx.fillRect(-0.12, -0.12, 0.24, 0.24); ctx.restore();
  }
  ctx.restore();
}

// Breath fog: a few soft wisps leaving the mouth, lit from behind. age in seconds since the exhale.
export function breathFog(ctx, S, age, { col = [200, 210, 204], k = 1, seed = 2 } = {}) {
  if (age < 0 || age > 2.2) return;
  const m = along(S.face, 0.47, 0.47, 1)[0]; if (!m) return;
  ctx.save(); ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 16; i++) {
    const r = hash(i * 11 + seed), a = age - r * 0.35; if (a < 0) continue;
    const d = 0.03 + a * (0.12 + 0.12 * r), up = a * (0.10 + 0.12 * hash(i + 3));
    const x = m.x - m.nx * d + (r - 0.5) * 0.08, y = m.y - m.ny * d - up;
    const R = 0.05 + a * (0.10 + 0.06 * hash(i + 7)), al = 0.045 * k * Math.exp(-a * 1.3) * clamp(a * 5);
    ctx.save(); ctx.translate(x, y); ctx.rotate(hash(i + 9) * 3); ctx.scale(1, 0.55);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
    g.addColorStop(0, `rgba(${col},${al})`); g.addColorStop(0.6, `rgba(${col},${al * 0.4})`); g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g; ctx.fillRect(-R, -R, 2 * R, 2 * R); ctx.restore();
  }
  ctx.restore();
}

// ================================================================== THE HARD-HAT WORKER (from behind, facing the sunset)
// Local units: frame px at world B's zoom 1 (1080 x 1920). He faces right-away into the sun; the camera stands behind
// his left shoulder. turn (radians, small) turns the head into the light; breath lifts the shoulders.
export function hardHatShape({ turn = 0, breath = 0, seed = 7 } = {}) {
  const b = breath * 14, T = turn * 260;                      // turn: the hat and head slide right a little, the peak shows more
  const hat = [                                               // dome, left to right over the top
    [21, 700], [18, 600], [40, 480], [95, 350], [180, 245], [280, 182], [400, 153], [470, 150], [540, 160], [620, 196],
    [690, 262], [730, 340], [748, 420], [752, 500], [745, 556, 'c'],
  ].map(([x, y, c]) => [x + T * (0.4 + 0.6 * (x / 750)), y, c]);
  const brim = [                                              // the brim: the front peak (into the light) round the back
    [745 + T, 556, 'c'], [792 + T * 1.3, 546], [820 + T * 1.4, 556], [828 + T * 1.4, 578], [812 + T * 1.3, 598], [770 + T, 614], [690 + T, 634], [580 + T, 658],
    [450 + T * 0.8, 682], [320 + T * 0.7, 702], [200 + T * 0.6, 716], [100 + T * 0.5, 725], [40 + T * 0.4, 727], [14 + T * 0.4, 719], [12 + T * 0.4, 704], [21 + T * 0.4, 700, 'c'],
  ];
  const head = [                                              // under the brim: the back of the skull, the nape, the ear, the beard edge
    [210 + T * 0.5, 600], [196 + T * 0.5, 700], [202 + T * 0.5, 780], [222 + T * 0.5, 840], [256 + T * 0.55, 890], [400 + T * 0.8, 912], [590 + T, 950], [630 + T, 984],
    [656 + T, 978], [680 + T, 950], [688 + T, 912], [684 + T, 872], [676 + T, 846], [684 + T, 818], [680 + T, 786], [668 + T, 762], [654 + T, 740], [640 + T, 660], [600 + T, 590],
  ];
  const body = [                                              // collar, shoulders to the frame edges and past them
    [200, 884 - b], [300, 866 - b], [430, 862 - b], [560, 878 - b], [630, 926 - b], [680, 996 - b], [770, 1032 - b], [870, 1074 - b], [960, 1126 - b],
    [1050, 1200 - b], [1150, 1320], [1160, 2100, 'c'],
    [-90, 2100, 'c'], [-90, 1010], [-10, 968 - b], [70, 930 - b], [140, 902 - b],
  ];
  const H = rough(spline(hat, false, 12), 0.6, 0.02, seed);
  const R = spline(brim, false, 10);
  const hd = rough(spline(head, false, 14), u => u < 0.4 ? 1.0 : 1.8, 0.7, seed + 1);            // hair at the nape, beard at the edge
  const bd = rough(spline(body, true, 10), 2.2, 0.012, seed + 2);
  return { hat: H, brim: R, head: hd, body: bd, T, b };
}
export function fillHardHat(ctx, S, color = '#110B0A') {
  ctx.fillStyle = color;
  ctx.beginPath(); tracePath(ctx, S.body); ctx.fill();
  ctx.beginPath(); tracePath(ctx, S.head); ctx.fill();
  ctx.beginPath(); tracePath(ctx, [...S.hat, ...S.brim.slice(1)]); ctx.fill();
}
// Interior: the hat's gloss and rib, the headband ratchet, the ear's red backlight, sweat on the neck, the collar,
// the strap and its stitching, jacket folds. sun: the hot rim colour [r,g,b]; k: exposure of the interior light.
export function hardHatDetail(ctx, S, { sun = [255, 110, 40], k = 1, sticker = null, stickerK = 1, seed = 9 } = {}) {
  const T = S.T, b = S.b;
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  // the hat's body colour: dark oxblood plastic, the sky's gloss on the right shoulder of the dome, a cool sheen on top
  let g = ctx.createLinearGradient(40 + T, 0, 760 + T, 0);
  g.addColorStop(0, 'rgba(40,12,10,0.0)'); g.addColorStop(1, 'rgba(70,18,12,0.5)');
  ctx.fillStyle = g; ctx.fillRect(0, 140, 900, 600);
  g = ctx.createRadialGradient(700 + T, 330, 20, 640 + T, 380, 380);
  g.addColorStop(0, rgba(sun, 0.26 * k)); g.addColorStop(0.45, rgba(sun, 0.08 * k)); g.addColorStop(1, rgba(sun, 0));
  ctx.fillStyle = g; ctx.fillRect(200, 100, 800, 640);
  g = ctx.createRadialGradient(430 + T, 170, 10, 430 + T, 240, 300);
  g.addColorStop(0, `rgba(170,80,60,${0.15 * k})`); g.addColorStop(1, 'rgba(170,80,60,0)');
  ctx.fillStyle = g; ctx.fillRect(100, 120, 800, 400);
  // ribs: a raised centre rib from the brow over the top and down the back, two side ribs; each has a lit edge
  ctx.lineCap = 'round';
  // cWM1: one low centre ridge (the V-Gard crown, headwear.js 'hard'), no side ribs: the pith-helmet read is gone.
  // The ridge is a soft shadow with a hairline of sun on its lit side, fading out toward the brim.
  {
    const pts = [[470, 152], [484, 250], [492, 360], [496, 470], [498, 560]].map(([x, y]) => [x + T * (0.4 + 0.6 * x / 750), y]);
    const sp = spline(pts, false, 8);
    ctx.strokeStyle = 'rgba(6,2,2,0.28)'; ctx.lineWidth = 22; ctx.beginPath(); tracePath(ctx, sp.map(p => [p[0] - 9, p[1]]), false); ctx.stroke();
    ctx.strokeStyle = rgba(sun, 0.11 * k); ctx.lineWidth = 3; ctx.beginPath(); tracePath(ctx, sp.map(p => [p[0] + 6, p[1]]), false); ctx.stroke();
  }
  // the brim band: its upper edge (where the brim turns out from the dome) lit, strongest at the peak facing the sun
  const edge = spline([[20 + T * 0.4, 690], [120 + T * 0.5, 690], [300 + T * 0.7, 672], [470 + T * 0.8, 648], [620 + T, 614], [744 + T, 568], [800 + T * 1.3, 552]], false, 10);
  for (let i = 0; i < edge.length; i++) { const p = edge[i], w = clamp((p[0] - 150) / 650);
    ctx.fillStyle = rgba(sun, (0.05 + 0.5 * w * w) * k); ctx.fillRect(p[0] - 2, p[1] - 3, 5, 3); }
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 3; ctx.beginPath(); tracePath(ctx, edge.map(p => [p[0], p[1] + 5]), false); ctx.stroke();
  // the sticker: the ACP tile on the back of the dome, wrapped a little on the curve, lit by the open sky behind the camera
  if (sticker) {
    ctx.save();
    const cx = 380 + T * 0.8, cy = 450, w = 150 * stickerK;
    ctx.translate(cx, cy); ctx.transform(0.88, -0.06, 0.03, 0.97, 0, 0);
    ctx.globalAlpha = 0.86; ctx.drawImage(sticker, -w / 2, -w / 2, w, w); ctx.globalAlpha = 1;
    g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);                   // curvature: darker at its left edge, a sheen on the right
    g.addColorStop(0, 'rgba(30,6,4,0.5)'); g.addColorStop(0.5, 'rgba(60,14,8,0.12)'); g.addColorStop(1, rgba(sun, 0.16 * k));
    ctx.fillStyle = g; ctx.fillRect(-w / 2, -w / 2, w, w);
    ctx.restore();
  }
  // the headband's ratchet knob at the nape, under the brim
  ctx.fillStyle = '#1a0c0a'; ctx.beginPath(); ctx.ellipse(400 + T * 0.8, 752, 36, 20, -0.04, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = rgba(sun, 0.12 * k); ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(400 + T * 0.8, 750, 34, 18, -0.04, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
  // the ear, backlit: translucent red at the helix
  const ex = 640 + T, ey = 800;
  g = ctx.createRadialGradient(ex + 20, ey - 10, 2, ex + 10, ey, 50);
  g.addColorStop(0, `rgba(215,45,22,${0.6 * k})`); g.addColorStop(0.5, `rgba(120,16,10,${0.35 * k})`); g.addColorStop(1, 'rgba(60,8,6,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(ex + 22, ey + 4, 20, 36, -0.12, 0, Math.PI * 2); ctx.fill();
  // sweat on the neck: specular glints in the rim
  g = ctx.createRadialGradient(690 + T, 900, 10, 660 + T, 900, 130);        // the nape and neck: skin catching the sun's edge
  g.addColorStop(0, rgba(sun, 0.18 * k)); g.addColorStop(1, rgba(sun, 0));
  ctx.fillStyle = g; ctx.fillRect(520 + T, 770, 280, 260);
  for (let i = 0; i < 11; i++) {
    const x = 610 + T + hash(i + seed) * 48, y = 880 + hash(i * 3 + seed) * 70, r = 0.9 + hash(i * 5 + seed) * 1.6;
    ctx.fillStyle = rgba([255, 200, 150], (0.18 + 0.3 * hash(i * 7)) * k); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // jacket: dark red-brown canvas; light from the sun on the right shoulder; the collar's lit top edge; folds
  g = ctx.createLinearGradient(0, 900, 1080, 1300);
  g.addColorStop(0, 'rgba(30,8,6,0.10)'); g.addColorStop(1, 'rgba(70,18,10,0.22)');
  ctx.fillStyle = g; ctx.fillRect(-100, 700, 1300, 1300);
  g = ctx.createRadialGradient(1060, 1180 - b, 30, 980, 1300, 520);
  g.addColorStop(0, rgba(sun, 0.22 * k)); g.addColorStop(1, rgba(sun, 0));
  ctx.fillStyle = g; ctx.fillRect(400, 900, 800, 900);
  ctx.strokeStyle = rgba(sun, 0.26 * k); ctx.lineWidth = 3;
  ctx.beginPath(); tracePath(ctx, spline([[200, 888 - b], [300, 870 - b], [430, 866 - b], [560, 882 - b], [630, 930 - b], [678, 998 - b]], false, 8), false); ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 5;
  ctx.beginPath(); tracePath(ctx, spline([[120, 950 - b], [300, 930 - b], [520, 950 - b], [700, 1040 - b]], false, 8), false); ctx.stroke();
  for (const f of [[[930, 1250], [985, 1400], [1000, 1560]], [[300, 1080], [262, 1230], [240, 1400]]]) {
    const sp = spline(f, false, 8);
    for (const [wd, al] of [[26, 0.12], [14, 0.2], [6, 0.25]]) { ctx.strokeStyle = `rgba(0,0,0,${al})`; ctx.lineWidth = wd; ctx.beginPath(); tracePath(ctx, sp, false); ctx.stroke(); }
    const sl = sp.map(p => [p[0] + 12, p[1] - 4]);
    for (const [wd, al] of [[14, 0.03], [6, 0.05]]) { ctx.strokeStyle = rgba(sun, al * k); ctx.lineWidth = wd; ctx.beginPath(); tracePath(ctx, sl, false); ctx.stroke(); }
  }
  // canvas duck: a fine twill weave over the jacket, catching the light only where the light is
  if (!_twill) { _twill = document.createElement('canvas'); _twill.width = _twill.height = 96; const tg = _twill.getContext('2d', { willReadFrequently: true });
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) { const v = ((x + y * 2) % 6 < 3 ? 1 : 0) * 0.5 + hash(x * 131 + y * 7) * 0.5;
      tg.fillStyle = `rgba(255,${120 + v * 60},${70 + v * 40},${0.02 + 0.10 * v})`; tg.fillRect(x, y, 1, 1); } }
  ctx.save(); ctx.fillStyle = ctx.createPattern(_twill, 'repeat'); ctx.globalAlpha = 0.3 * k;
  ctx.beginPath(); tracePath(ctx, S.body); ctx.fill(); ctx.restore();
  // the suspender strap: over the right shoulder, diagonally down the back; twin stitch lines catch the light
  const sp = spline([[930, 990 - b], [830, 1100 - b], [740, 1270], [640, 1480], [540, 1700], [450, 1940]], false, 12);
  ctx.strokeStyle = '#0c0504'; ctx.lineWidth = 150; ctx.lineCap = 'butt';
  ctx.beginPath(); tracePath(ctx, sp, false); ctx.stroke();
  const pts = along(sp, 0, 1, 4);
  ctx.lineCap = 'round';
  for (const [off, a] of [[66, 0.36], [-66, 0.10], [54, 0.22], [-54, 0.06]]) {
    ctx.strokeStyle = rgba(sun, a * k); ctx.lineWidth = 2.2; ctx.setLineDash([9, 6]);
    ctx.beginPath(); pts.forEach((p, i) => { const X = p.x + p.nx * off, Y = p.y + p.ny * off; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = rgba(sun, 0.12 * k); ctx.lineWidth = 3;                   // the strap's lit edge
  ctx.beginPath(); pts.forEach((p, i) => { const X = p.x + p.nx * 75, Y = p.y + p.ny * 75; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); ctx.stroke();
  ctx.restore();
}

let _twill = null;
// ================================================================== THE GLOVED HAND (seen from behind, closing into a fist)
// Local: frame px. x, y = the wrist cuff centre at the bottom edge; curl 0 (open, fingers up) .. 1 (a fist).
export function glovePath(ctx, { x = 760, y = 1900, s = 1, curl = 0, rot = 0.12, seed = 4 } = {}) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  const fillPoly = (pts, closed = true, amp = 1.6) => { ctx.beginPath(); tracePath(ctx, rough(spline(pts, closed, 8), amp, 0.05, seed++)); ctx.fill(); };
  // the gauntlet cuff and the back of the hand (a work glove is bulky: the palm pad shows at the sides)
  fillPoly([[-162, 260], [-150, 60], [-136, -90], [-126, -200], [-130, -290], [-116, -350], [-60, -372], [20, -378], [96, -364], [128, -320], [132, -220],
    [140, -90], [152, 60], [166, 260]]);
  // the knuckle line: four MCP heads, the index side higher; fingers fold away from camera as the hand closes
  const mcp = [[-82, -372, 50], [-27, -386, 52], [30, -380, 50], [84, -356, 44]];
  const lens = [[96, 62, 44], [106, 68, 48], [100, 64, 46], [80, 50, 38]], spread = [-0.13, -0.04, 0.05, 0.14];
  mcp.forEach(([mx, my, wd], i) => {
    ctx.beginPath(); ctx.ellipse(mx, my + 8, wd * 0.52, 16 + 6 * (1 - curl), 0, 0, Math.PI * 2); ctx.fill();         // the knuckle
    let px = mx, py = my, ang = -Math.PI / 2 + spread[i] * (1 - curl), w = wd;
    for (let k = 0; k < 3; k++) {
      const fold = clamp(curl * 1.3 - k * 0.12) * Math.PI / 2;
      const L = lens[i][k] * Math.cos(fold), w2 = w * 0.93;
      if (L < 3) break;
      const nx = px + Math.cos(ang) * L, ny = py + Math.sin(ang) * L, ox = -Math.sin(ang), oy = Math.cos(ang);
      const tip = k === 2 || clamp(curl * 1.3 - (k + 1) * 0.12) * Math.PI / 2 > 1.4;
      const pts = [[px + ox * w / 2, py + oy * w / 2], [nx + ox * w2 / 2, ny + oy * w2 / 2]];
      if (tip) pts.push([nx + Math.cos(ang) * w2 * 0.42 + ox * w2 * 0.2, ny + Math.sin(ang) * w2 * 0.42 + oy * w2 * 0.2], [nx + Math.cos(ang) * w2 * 0.42 - ox * w2 * 0.2, ny + Math.sin(ang) * w2 * 0.42 - oy * w2 * 0.2]);
      pts.push([nx - ox * w2 / 2, ny - oy * w2 / 2], [px - ox * w / 2, py - oy * w / 2]);
      fillPoly(pts, true, 1.2);
      px = nx; py = ny; w = w2; ang += fold * 0.25;
      if (tip) break;
    }
  });
  // the thumb: out to the side and up when open; folded across the front when closed (a bump on the left edge)
  const ta = lerp(-2.25, -1.25, curl), tl = lerp(150, 70, curl);
  const tb = [-118, -250], te = [tb[0] + Math.cos(ta) * tl, tb[1] + Math.sin(ta) * tl], on = [-Math.sin(ta), Math.cos(ta)];
  fillPoly([[tb[0] + on[0] * 34, tb[1] + on[1] * 34], [te[0] + on[0] * 28, te[1] + on[1] * 28], [te[0] + Math.cos(ta) * 22, te[1] + Math.sin(ta) * 22],
    [te[0] - on[0] * 28, te[1] - on[1] * 28], [tb[0] - on[0] * 30, tb[1] - on[1] * 30]], true, 1.2);
  ctx.restore();
}

// ================================================================== THE RIG (mirror arm, cab door, door tile) for world A
// Local: frame px at world A's zoom 1. The cab stands at the right edge; the west-coast mirror on its two-arm bracket.
export function drawRig(ctx, { tile = null, tileK = 0.5, sky = [98, 108, 101], k = 1 } = {}) {
  ctx.save();
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
  // the cab: a narrow strip of the door at the right edge, painted, holding the last of the sky (the rest of the rig is
  // out of frame, as on the poster)
  let g = ctx.createLinearGradient(0, 520, 0, 1960);
  g.addColorStop(0, rgba(sky.map(v => v * 0.62), 1)); g.addColorStop(0.55, rgba(sky.map(v => v * 0.55), 1)); g.addColorStop(1, 'rgba(22,24,23,1)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(1008, 560); ctx.quadraticCurveTo(1018, 546, 1100, 544); ctx.lineTo(1100, 1960); ctx.lineTo(994, 1960); ctx.lineTo(996, 700); ctx.closePath(); ctx.fill();
  g = ctx.createLinearGradient(994, 0, 1026, 0);                          // the rolled front edge: a hard sky highlight, then shadow
  g.addColorStop(0, 'rgba(12,13,13,1)'); g.addColorStop(0.2, rgba(sky.map(v => Math.min(255, v * 1.25)), 0.9 * k)); g.addColorStop(0.55, rgba(sky, 0.2)); g.addColorStop(1, rgba(sky, 0));
  ctx.fillStyle = g; ctx.fillRect(994, 566, 32, 1394);
  ctx.fillStyle = '#0d0e0e'; ctx.fillRect(1034, 548, 70, 330);            // the door window: dark glass
  ctx.fillStyle = rgba(sky, 0.16 * k); ctx.fillRect(1040, 560, 60, 120);
  ctx.strokeStyle = 'rgba(8,9,9,0.9)'; ctx.lineWidth = 3;                  // door seam and sill
  ctx.beginPath(); ctx.moveTo(1030, 880); ctx.lineTo(1030, 1060); ctx.moveTo(1030, 1160); ctx.lineTo(1030, 1900); ctx.moveTo(1030, 880); ctx.lineTo(1100, 876); ctx.stroke();
  // the door tile: the ACP mark on its white tile, unlit (no lamp on it: the last of the sky only)
  if (tile) {
    const tw = 68, tx = 1004, ty = 1080;
    ctx.save(); ctx.translate(tx, ty); ctx.transform(1, 0.02, 0, 1, 0, 0);
    ctx.globalAlpha = 0.72 * tileK + 0.18; ctx.drawImage(tile, 0, 0, tw, tw);
    ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(14,20,18,0.42)'; ctx.fillRect(0, 0, tw, tw);
    g = ctx.createLinearGradient(0, 0, tw, tw); g.addColorStop(0, rgba(sky, 0.18 * k)); g.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, tw, tw);
    ctx.restore();
  }
  // the west-coast mirror on its bracket, at the poster's scale: a tall rounded head, the arms into the door
  ctx.strokeStyle = '#0b0c0c'; ctx.lineCap = 'round';
  ctx.lineWidth = 13; ctx.beginPath(); ctx.moveTo(1040, 1178); ctx.lineTo(1002, 1178); ctx.quadraticCurveTo(958, 1176, 934, 1192); ctx.stroke();
  ctx.lineWidth = 13; ctx.beginPath(); ctx.moveTo(1040, 1532); ctx.lineTo(1000, 1534); ctx.quadraticCurveTo(958, 1532, 936, 1512); ctx.stroke();
  ctx.lineWidth = 2.5; ctx.strokeStyle = rgba(sky, 0.35 * k);
  ctx.beginPath(); ctx.moveTo(1036, 1172); ctx.lineTo(1002, 1172); ctx.quadraticCurveTo(958, 1170, 936, 1186); ctx.stroke();
  const mx = 900, my = 1168, mw = 132, mh = 372, r = 34;
  ctx.fillStyle = '#0a0b0b'; rr(mx, my, mw, mh, r); ctx.fill();
  // glass: a darker, reversed sky, with a sliver of the warm horizon low in it
  g = ctx.createLinearGradient(0, my, 0, my + mh);
  g.addColorStop(0, rgba(sky.map(v => v * 0.42), 1)); g.addColorStop(0.62, rgba(sky.map(v => v * 0.7), 1)); g.addColorStop(0.74, 'rgba(112,82,62,1)');
  g.addColorStop(0.78, rgba(sky.map(v => v * 0.28), 1)); g.addColorStop(1, 'rgba(10,10,10,1)');
  ctx.fillStyle = g; rr(mx + 14, my + 14, mw - 26, mh - 28, r - 10); ctx.fill();
  // the chrome frame: a hard specular line down its sky-facing left edge, soft elsewhere
  ctx.strokeStyle = rgba([210, 222, 214], 0.75 * k); ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.moveTo(mx + 4, my + r + 20); ctx.lineTo(mx + 4, my + mh * 0.46); ctx.stroke();
  ctx.strokeStyle = rgba(sky, 0.3 * k); ctx.lineWidth = 2; rr(mx + 1.5, my + 1.5, mw - 3, mh - 3, r); ctx.stroke();
  ctx.restore();
}

// ================================================================== the rim pass
// Given a layer whose alpha is the silhouette (anything already drawn on it), add rim light on the edges facing each
// light: rim = alpha(p) * (1 - alpha(p + L * w)), accumulated over a few widths for a soft falloff, tinted, drawn
// source-atop. lights: [{ dx, dy, w, color: [r,g,b], a }]. box: [x, y, w, h] limits the work to the figure's bounds.
const _rim = { c: null, g: null, m: null, mg: null };
export function rimLight(layer, lights, box = null) {
  const W = layer.canvas.width, H = layer.canvas.height;
  if (!_rim.c || _rim.c.width !== W || _rim.c.height !== H) {
    _rim.c = document.createElement('canvas'); _rim.c.width = W; _rim.c.height = H; _rim.g = _rim.c.getContext('2d', { willReadFrequently: true });
    _rim.m = document.createElement('canvas'); _rim.m.width = W; _rim.m.height = H; _rim.mg = _rim.m.getContext('2d', { willReadFrequently: true });
  }
  const [bx, by, bw, bh] = box || [0, 0, W, H];
  const g = _rim.g, mg = _rim.mg;
  // freeze the silhouette alpha before any rim is added (so lights don't feed each other)
  mg.setTransform(1, 0, 0, 1, 0, 0); mg.clearRect(bx, by, bw, bh);
  mg.drawImage(layer.canvas, bx, by, bw, bh, bx, by, bw, bh);
  for (const L of lights) {
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(bx, by, bw, bh);
    const steps = L.steps || 3;
    for (let s = 1; s <= steps; s++) {
      const w = L.w * s / steps;
      // band(w) = alpha(p) - alpha(p) * alpha(p + L*w)
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1 / steps;
      const tmp = _rimTmp(W, H); const tg = tmp.getContext('2d', { willReadFrequently: true });
      tg.setTransform(1, 0, 0, 1, 0, 0); tg.globalCompositeOperation = 'copy'; tg.drawImage(_rim.m, bx, by, bw, bh, bx, by, bw, bh);
      tg.globalCompositeOperation = 'destination-out'; tg.drawImage(_rim.m, bx, by, bw, bh, bx - L.dx * w, by - L.dy * w, bw, bh);
      g.drawImage(tmp, bx, by, bw, bh, bx, by, bw, bh);
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-in';
    g.fillStyle = `rgba(${L.color[0]},${L.color[1]},${L.color[2]},${L.a})`; g.fillRect(bx, by, bw, bh);
    layer.save(); layer.setTransform(1, 0, 0, 1, 0, 0); layer.globalCompositeOperation = L.op || 'source-atop';
    if (L.blur) layer.filter = `blur(${L.blur}px)`;
    layer.drawImage(_rim.c, bx, by, bw, bh, bx, by, bw, bh);
    layer.restore();
  }
}
let _tmp = null;
function _rimTmp(W, H) { if (!_tmp || _tmp.width !== W || _tmp.height !== H) { _tmp = document.createElement('canvas'); _tmp.width = W; _tmp.height = H; } return _tmp; }

// ================================================================== THE RIDGE (the hero's one crowd frame)
// Caps and hard hats on one horizon, every head tipped up to the dot. Small flat near-black shapes; a thin rim.
// o: { y (horizon of the shoulders, px), dot: [x, y], n, seed, s (head px), trucker: {x, s} the hero kept in the line }
export function hardHatProfile() {                            // a hard hat seen from the side, in trucker-head units
  return [[0.47, 0.34, 'c'], [0.56, 0.35], [0.60, 0.33, 'c'], [0.44, 0.30], [0.40, 0.16], [0.30, 0.03], [0.12, -0.07], [-0.08, -0.08],
    [-0.28, -0.02], [-0.42, 0.12], [-0.48, 0.30], [-0.50, 0.38, 'c'], [-0.56, 0.42], [-0.54, 0.45, 'c'], [-0.40, 0.44], [-0.20, 0.40], [0.10, 0.37], [0.40, 0.36]];
}
export function ridgeFigure(ctx, { x, y, s, facing = 1, tilt = -0.6, hat = 'cap', seed = 1, breath = 0 }) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s * facing, s);
  const S = truckerShape({ tilt, breath, seed });
  ctx.beginPath(); tracePath(ctx, S.body); ctx.fill();
  if (hat === 'cap') { ctx.beginPath(); tracePath(ctx, S.outline); ctx.fill(); }
  else {
    ctx.beginPath(); tracePath(ctx, [...S.face, ...S.back.slice().reverse()]); ctx.fill();
    const hp = xf(hardHatProfile(), { rot: tilt, px: PIV[0], py: PIV[1] });
    ctx.beginPath(); tracePath(ctx, spline(hp, true, 8)); ctx.fill();
    // fill the skull under the hat
    const sk = xf([[-0.40, 0.45], [-0.30, 0.10], [0.10, 0.0], [0.38, 0.30], [0.39, 0.42], [0.0, 0.6], [-0.35, 0.8]], { rot: tilt, px: PIV[0], py: PIV[1] });
    ctx.beginPath(); tracePath(ctx, spline(sk, true, 6)); ctx.fill();
  }
  ctx.restore();
}

// ================================================================== THE THROTTLE (WE RUN IT., cycle WM1)
// Hine's Power House Mechanic, not a fist: a gloved hand shoves a big throttle lever forward into the frame edge.
// Local: frame px. (px, py) the lever's pivot (below frame), L its length, push 0 (pulled back) .. 1 (shoved home).
// Near-black; the caller rims it. The glove is a work glove closed round a ball knob, the cuff and forearm running
// out of the bottom-left corner, so no fingers splay and nothing reads as a gauntlet or a robot hand.
export function leverHand(ctx, { px = 760, py = 2250, L = 900, push = 0, seed = 11 } = {}) {
  const a = lerp(-0.62, 0.3, push);                          // lever angle from vertical (+ = forward, away, right)
  const kx = px + Math.sin(a) * L, ky = py - Math.cos(a) * L; // the knob
  ctx.save();
  // the quadrant: a notched steel arc the lever rides in, at the bottom edge
  ctx.lineWidth = 34; ctx.strokeStyle = ctx.fillStyle; ctx.beginPath(); ctx.arc(px, py, L * 0.42, -Math.PI / 2 - 0.8, -Math.PI / 2 + 0.5); ctx.stroke();
  // the shaft: tapered
  const nx = Math.cos(a), ny = Math.sin(a);
  ctx.beginPath(); ctx.moveTo(px - nx * 38, py - ny * 38); ctx.lineTo(kx - nx * 17, ky - ny * 17); ctx.lineTo(kx + nx * 17, ky + ny * 17); ctx.lineTo(px + nx * 38, py + ny * 38); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.ellipse(kx, ky, 58, 52, a, 0, Math.PI * 2); ctx.fill();          // the ball knob
  // the glove, in the grip's frame: a crossbar grip perpendicular to the shaft, the fist closed round its middle so
  // the bar shows either side of it (the read of a hand holding a control), the knuckle ridge on top, the thumb
  // hooked over, a gauntlet cuff flaring at the wrist, the forearm out of the bottom-left corner
  ctx.translate(kx, ky); ctx.rotate(a);
  const P = (pts, amp = 1.8) => rough(spline(pts, true, 8), amp, 0.04, seed++);
  ctx.beginPath(); ctx.moveTo(-210, -22); ctx.lineTo(210, -22); ctx.arc(210, 0, 22, -Math.PI / 2, Math.PI / 2); ctx.lineTo(-210, 22); ctx.arc(-210, 0, 22, Math.PI / 2, Math.PI * 1.5); ctx.fill();
  for (const ex of [-236, 236]) { ctx.beginPath(); ctx.ellipse(ex, 0, 16, 30, 0, 0, Math.PI * 2); ctx.fill(); }   // the grip's end caps
  // forearm and cuff
  ctx.beginPath(); tracePath(ctx, P([[-70, 70], [60, 80], [40, 170], [95, 250], [-20, 330], [-230, 620], [-520, 900], [-800, 1000], [-800, 560], [-430, 380], [-200, 280], [-150, 200], [-110, 150]], 2.5)); ctx.fill();
  // the fist: a closed work glove, four knuckle bumps along the top, the curled fingers wrapping under the bar
  ctx.beginPath(); tracePath(ctx, P([[-96, -40], [-92, -86], [-50, -106], [10, -110], [62, -100], [98, -70], [106, -20], [100, 44], [70, 86], [0, 96], [-70, 90], [-104, 50]])); ctx.fill();
  for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.ellipse(-62 + k * 42, -104 + Math.abs(k - 1.5) * 4, 23, 15, 0, 0, Math.PI * 2); ctx.fill(); }
  for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.ellipse(-62 + k * 42, 88, 21, 16, 0, 0, Math.PI * 2); ctx.fill(); }      // finger tips under the bar
  ctx.beginPath(); tracePath(ctx, P([[-100, -30], [-138, -56], [-150, -20], [-130, 22], [-92, 34]])); ctx.fill();                // the thumb over
  ctx.restore();
  return { knob: [kx, ky] };
}
