// FABRIC7 crease7 (c5 it5, 8 Oct): creases with a CAUSE. Where fold7.js's ridges stand, how long they run, how far apart and how tall, from the garment's own strain field and the cloth's own mechanics, replacing the
// hash cells of ridge7.js (K = 3 random creases a cell, direction jitter 0.4, length 1.6, spacing 1.0: positions were noise, which is why the maps showed rings of equal height down a sleeve and a stack of ribs across a thigh).
//
// THE MODEL (tension-field wrinkling; Wong and Pellegrino 2006, Cerda and Mahadevan 2003, Rohmer et al. 2010 for the same use on garments). A solved garment is shorter than its flat pattern where the cloth is
// compressed: the raw excess e (fabric6.js strainField's uncapped vector: the shortfall of the smaller principal stretch) and the direction th it is compressed along. Cloth does not absorb that evenly: it folds along LINES
// across the compression (the crest runs along t = th + 90 deg, the direction the cloth is NOT shortened in), each fold a rounded ridge A sech^2(u / w) with flat panels between. The three questions a fold answers:
//  1. WHERE IT STARTS (nucleation). A fold starts where the cloth most needs one and something lets it: at the maximum of the REMAINING excess (the places the raw-excess map peaks: the crook of an elbow, the crotch, the
//     knee, the armscye, the hem of a sleeve pushed up), made easier by a SUPPORT (a held edge, a seam, a cuff, a waistband: the cloth is pushed against it, the compression points INTO the edge: weight exp(-d / S) cos^2(phi),
//     d the distance to the nearest held edge, phi the angle between the compression and the edge's normal), and by a MATERIAL IMPERFECTION (a smooth multiplicative noise of correlation length S: stitching, dye lot, hand: the
//     one stochastic ingredient, deterministic from the garment's name). Folds are placed one at a time in that order (random sequential adsorption): a placed fold RELIEVES the cloth round it, so no other starts within the
//     spacing S of it (S / imperfection: close folds where the material is weak). Spacings come out irregular, clustered and open, as they do in real cloth, not a lattice.
//  2. HOW FAR IT RUNS (growth). From its nucleus the crease grows both ways along the crest trajectory t(x) of the strain field (the field turns, the crease bends with it) until the excess under it is spent: where the
//     catchment's excess falls below what a visible fold (A_floor) absorbs, or it reaches a held edge. Long where the compression is long, tapering where it dies: not a fixed 1.6 wavelengths.
//  3. HOW TALL (conservation of the cloth's length). A fold absorbs the cloth of its CATCHMENT: the cloth between it and its neighbours across the compression (half the gap each side, or what the cloth supports before
//     a held edge). A ridge A sech^2(u / w) lengthens the path by (1/2) integral z'^2 du = 8 A^2 / (15 w) per unit length of crease, so dL = (8/15) A^2 / w and A = sqrt(15 dL w / 8), dL = the integral of the excess across the catchment; a rounded fold
//     lies no steeper than the slope bound (peak slope 0.7698 A / w <= `slope`): where the catchment holds more cloth than one fold at the bound can take, the rest stays unexpressed (as before: honestly smooth).
// SPACING AND WIDTH. S is the octave's wavelength, lambda_n = lambda_0 R^n: the ladder runs from the wrinkle wavelength of the sheet on its foundation, lambda_0 = 2 pi (4 B / E*)^(1/3) (fabric6.js lam0Of: B the fabric's
// bending stiffness rho g c^3, E* the plane-strain modulus of the skin it lies on, 22.7 kPa) up to the fold wavelength lambda_F = 2.8 c (the Peirce bending length: gravity's and the bending's own scale), in octaves of a ratio
// R = (lambda_F / lambda_0)^(1 / (n - 1)). A stiffer cloth (larger B) wrinkles and folds at longer wavelengths, fewer and larger creases; a limp one finer. The ridge's half-width is w = LOC x S. LOC = 0.22 is the ONE
// retained constant: the ratio of a fold's width to its spacing (the localisation of a wrinkle train into folds; it came from the c5 it2 plots, by eye: said plainly). What it replaces: spacing 1.0, length 1.6, K = 3, jitter 0.4
// (ridge7.js, the 'cells' arm) and the hand-held table of lambda_0. The one stochastic ingredient left is the imperfection field (IMPERF 0.4: the width of a log-normal; the fold's WHERE, not its size).
// Everything works in the garment's own pattern (u, v) in metres, panel by panel (panels share one (u, v) frame and overlap there), on a raster of the strain field; the mesh only samples the finished crease set.
import { hh } from './ridge7.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x)), smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const sech2 = x => { const e = Math.exp(-2 * Math.abs(x)); return 4 * e / ((1 + e) * (1 + e)); };
export const CREASE7 = { loc: 0.22, slope: 0.7, floorA: 0.00025, imperf: 0.4, cell: 0.003, maxCreases: 240, maxCatch: 1.0 };   // loc: half-width / spacing; slope: the steepest a fold may lie (peak slope); floorA (m): a fold lower than this is not built; imperf: the width of the log-normal imperfection; cell (m): the raster's finest cell; maxCatch: the catchment's reach across, in spacings
const K_ABS = 8 / 15;   // dL = K_ABS A^2 / w : the length a sech^2 ridge takes out of the path along the compression, per unit length of crease: (1/2) integral of z'^2 du = (1/2)(16 / 15) A^2 / w

// the foundation law (Allen 1969; Cerda and Mahadevan 2003): the wavelength a sheet of bending stiffness B (N m) wrinkles at on a thick elastic substrate of plane-strain modulus Es (Pa): 2 pi (4 B / Es)^(1/3)
export const foundationWavelength = (B, Es) => 2 * Math.PI * Math.cbrt(4 * B / Es);

// ---- the raster of one panel: the strain field (the doubled-angle compression vector in mm, as fabric6.js strainField leaves it), the distances to the held edges, the mask of cloth
export function rasterPanel(UV, I, Rv, E, pan, p, lam0, cell) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; const tri = [];
  for (let t = 0; t < I.length; t += 3) { const a = I[t], b = I[t + 1], c = I[t + 2]; if (pan[a] !== p || pan[b] !== p || pan[c] !== p) continue; tri.push(a, b, c);
    for (const v of [a, b, c]) { x0 = Math.min(x0, UV[v * 2]); x1 = Math.max(x1, UV[v * 2]); y0 = Math.min(y0, UV[v * 2 + 1]); y1 = Math.max(y1, UV[v * 2 + 1]); } }
  if (!tri.length) return null;
  const g = cell, pad = 3, nx = Math.ceil((x1 - x0) / g) + 2 * pad + 1, ny = Math.ceil((y1 - y0) / g) + 2 * pad + 1, N = nx * ny;
  const R = { g, x0: x0 - pad * g, y0: y0 - pad * g, nx, ny, mask: new Uint8Array(N), rx: new Float32Array(N), ry: new Float32Array(N), dS: new Float32Array(N).fill(0.05), dF: new Float32Array(N).fill(0.06), lam0, tri };
  for (let t = 0; t < tri.length; t += 3) { const a = tri[t], b = tri[t + 1], c = tri[t + 2], ax = UV[a * 2], ay = UV[a * 2 + 1], bx = UV[b * 2], by = UV[b * 2 + 1], cx = UV[c * 2], cy = UV[c * 2 + 1];
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(det) < 1e-14) continue;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - R.x0) / g) - 1), i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) - R.x0) / g) + 1), j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - R.y0) / g) - 1), j1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by, cy) - R.y0) / g) + 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const px = R.x0 + (i + 0.5) * g, py = R.y0 + (j + 0.5) * g;
      const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det, l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det, l3 = 1 - l1 - l2, e = -1e-6; if (l1 < e || l2 < e || l3 < e) continue;
      const k = j * nx + i; R.mask[k] = 1; R.rx[k] = l1 * Rv[a * 2] + l2 * Rv[b * 2] + l3 * Rv[c * 2]; R.ry[k] = l1 * Rv[a * 2 + 1] + l2 * Rv[b * 2 + 1] + l3 * Rv[c * 2 + 1];
      R.dS[k] = l1 * E[a * 4] + l2 * E[b * 4] + l3 * E[c * 4]; R.dF[k] = l1 * E[a * 4 + 2] + l2 * E[b * 4 + 2] + l3 * E[c * 4 + 2]; } }
  // fill one cell of the mask's rim so a sample at the panel's edge is not half empty (nearest filled neighbour): the edge cells keep their own values, the outside stays masked
  return R;
}
// bilinear sample of a raster layer at (x, y) (cell centres at x0 + (i + 0.5) g)
function samp(R, L, x, y) { const fx = (x - R.x0) / R.g - 0.5, fy = (y - R.y0) / R.g - 0.5, i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j; let s = 0;
  for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) { const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= R.nx || jj >= R.ny) continue; s += L[jj * R.nx + ii] * (a ? tx : 1 - tx) * (b ? ty : 1 - ty); }
  return s; }
const inMask = (R, x, y) => { const i = Math.floor((x - R.x0) / R.g), j = Math.floor((y - R.y0) / R.g); return i >= 0 && j >= 0 && i < R.nx && j < R.ny && R.mask[j * R.nx + i] === 1; };
// the strain field at a point: the excess fraction e (from the compression vector's magnitude: A = lam0 / pi sqrt(e)) and the direction of the compression th
export function field(R, x, y) { const rx = samp(R, R.rx, x, y), ry = samp(R, R.ry, x, y), A = Math.hypot(rx, ry) * 0.001, q = Math.PI * A / R.lam0; return { e: q * q, th: 0.5 * Math.atan2(ry, rx) }; }
// the distance to the nearest held edge (a stitched seam or a free hem: both hold the cloth) and its gradient (a unit vector pointing away from the edge)
const holdD = (R, x, y) => Math.min(samp(R, R.dS, x, y), samp(R, R.dF, x, y));

// value noise of correlation length S: 1 at its mean, a log-normal imperfection of width sg
function imperfection(x, y, S, seed, sg) { const fx = x / S, fy = y / S, i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const n = (a, b) => hh(a, b, seed) * 2 - 1, v = (n(i, j) * (1 - sx) + n(i + 1, j) * sx) * (1 - sy) + (n(i, j + 1) * (1 - sx) + n(i + 1, j + 1) * sx) * sy; return Math.exp(sg * v); }

// ---- one octave on one panel: the creases (polylines in the pattern's (u, v) with an amplitude along them)
// o: { S (spacing, m), w (half-width, m), share (this octave's share of the excess), seed, hold (m: the stitched allowance), slope }
export function placeCreases(R, o, O = CREASE7) {
  const g = R.g, S = o.S, w = o.w, share = o.share, hold = o.hold, Aslope = o.slope * w / 0.7698, aFloor = (O.floorA * O.floorA * 8) / (15 * w) / S;   // the excess a fold of A_floor takes out of a catchment of one spacing
  const nx = R.nx, ny = R.ny, N = nx * ny, blocked = new Uint8Array(N), ex = new Float32Array(N), th = new Float32Array(N), sup = new Float32Array(N), imp = new Float32Array(N);
  // the fields at cell centres: the octave's excess, its compression direction, the support weight, the imperfection
  const dh = new Float32Array(N);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; if (!R.mask[k]) { blocked[k] = 1; continue; } const x = R.x0 + (i + 0.5) * g, y = R.y0 + (j + 0.5) * g, f = field(R, x, y); ex[k] = f.e * share; th[k] = f.th; dh[k] = Math.min(R.dS[k], R.dF[k]); imp[k] = imperfection(x, y, S, o.seed, O.imperf);
    if (dh[k] < hold + 0.5 * w) blocked[k] = 1; }
  for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) { const k = j * nx + i; if (!R.mask[k]) continue;   // the edge's normal from the gradient of the distance field; the compression pointing into it
    const gx = (dh[k + 1] - dh[k - 1]) / (2 * g), gy = (dh[k + nx] - dh[k - nx]) / (2 * g), gl = Math.hypot(gx, gy); let c2 = 0; if (gl > 0.3) { const ct = (gx * Math.cos(th[k]) + gy * Math.sin(th[k])) / gl; c2 = ct * ct; }
    sup[k] = Math.exp(-dh[k] / S) * c2; }
  const creases = [], cid = new Int16Array(N);   // cid: which crease passes a cell (1-based), for the catchment's rays
  const step = g, maxSteps = Math.ceil(12 * S / g) + 40;
  // ---- placement: the best remaining nucleus, grown, blocked round; until nothing is left that a visible fold could take
  for (let c = 0; c < O.maxCreases; c++) {
    let best = -1, bs = 0; for (let k = 0; k < N; k++) { if (blocked[k] || ex[k] < aFloor) continue; const s = ex[k] * imp[k] * (1 + sup[k]); if (s > bs) { bs = s; best = k; } }
    if (best < 0) break;
    const x0 = R.x0 + ((best % nx) + 0.5) * g, y0 = R.y0 + (Math.floor(best / nx) + 0.5) * g;
    const half = sgn => { const pts = []; let x = x0, y = y0, px = 0, py = 0; for (let s = 0; s < maxSteps; s++) {
        const dirOf = (xx, yy) => { const t = field(R, xx, yy).th; let tx = -Math.sin(t), ty = Math.cos(t); if (s === 0 && px === 0 && py === 0) { tx *= sgn; ty *= sgn; } else if (tx * px + ty * py < 0) { tx = -tx; ty = -ty; } return [tx, ty]; };
        const d1 = dirOf(x, y), mx = x + 0.5 * step * d1[0], my = y + 0.5 * step * d1[1], d2 = dirOf(mx, my); x += step * d2[0]; y += step * d2[1]; px = d2[0]; py = d2[1];
        if (!inMask(R, x, y) || holdD(R, x, y) < hold) break; if (field(R, x, y).e * share < aFloor * 0.5) break; pts.push(x, y); } return pts; };
    const fwd = half(1), bwd = half(-1), all = []; for (let i = bwd.length - 2; i >= 0; i -= 2) all.push(bwd[i], bwd[i + 1]); all.push(x0, y0); for (let i = 0; i < fwd.length; i += 2) all.push(fwd[i], fwd[i + 1]);
    const m = all.length / 2; const cr = { pts: Float32Array.from(all), m, A: new Float32Array(m), nucleus: [x0, y0], score: bs }; creases.push(cr);
    // block the neighbourhood: nothing starts within S of a placed fold (it relieves the cloth round it); and mark the cells it passes for the catchment's rays
    const rb = Math.ceil(S / imp[best] / g);   // the relief radius shrinks where the material is more imperfect (a weak spot nucleates close folds): spacings cluster and open out instead of tiling
    for (let q = 0; q < m; q++) { const cx = Math.floor((cr.pts[q * 2] - R.x0) / g), cy = Math.floor((cr.pts[q * 2 + 1] - R.y0) / g);
      for (let jj = -rb; jj <= rb; jj++) for (let ii = -rb; ii <= rb; ii++) { if (ii * ii + jj * jj > rb * rb) continue; const a = cx + ii, b = cy + jj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue; blocked[b * nx + a] = 1; }
      for (let jj = -1; jj <= 1; jj++) for (let ii = -1; ii <= 1; ii++) { const a = cx + ii, b = cy + jj; if (a >= 0 && b >= 0 && a < nx && b < ny && !cid[b * nx + a]) cid[b * nx + a] = c + 1; } }   // a crease is three cells thick in the id raster: a ray across it cannot slip through
    if (m < 2) { blocked[best] = 1; }
  }
  // ---- the heights: each crease takes the cloth of its catchment (conservation of length), at the slope bound at most
  const rho = O.maxCatch * S, look = 2.2 * S;   // a fold takes the cloth up to half-way to its neighbour across the compression, at most one spacing; the neighbour is looked for twice as far
  for (let c = 0; c < creases.length; c++) { const cr = creases[c], m = cr.m, P = cr.pts, A = cr.A; if (m < 2) continue;
    for (let q = 0; q < m; q++) { const x = P[q * 2], y = P[q * 2 + 1], t = field(R, x, y).th, ex_ = Math.cos(t), ey_ = Math.sin(t); let dL = 0;
      for (const sg of [1, -1]) { let reach = 0;   // across the compression: until another crease (half-way), a held edge, the panel's end, or the catchment's reach
        for (let r = 0.5 * g; r <= look; r += 0.5 * g) { const xx = x + sg * r * ex_, yy = y + sg * r * ey_; if (!inMask(R, xx, yy) || holdD(R, xx, yy) < hold) { reach = Math.min(rho, r - 0.5 * g); break; }
          const ci = Math.floor((xx - R.x0) / g), cj = Math.floor((yy - R.y0) / g), id = cid[cj * nx + ci]; if (id && id !== c + 1) { reach = Math.min(rho, r * 0.5); break; } reach = Math.min(rho, r); }
        const rr = Math.max(0, reach); for (let r = 0.5 * g; r < rr; r += g) dL += field(R, x + sg * r * ex_, y + sg * r * ey_).e * share * g; }
      A[q] = Math.min(Math.sqrt(dL * w / K_ABS), Aslope); }
    // along the crease: a moving mean over a half-width, then the ends taper (a fold runs out into a flat panel)
    const k = Math.max(1, Math.round(w / g)), B = new Float32Array(m); for (let q = 0; q < m; q++) { let s = 0, n = 0; for (let d = -k; d <= k; d++) { const i = q + d; if (i < 0 || i >= m) continue; s += A[i]; n++; } B[q] = s / n; }
    const len = (m - 1) * g, tau = 2 * w; for (let q = 0; q < m; q++) { const s = q * g; A[q] = B[q] * smooth(0, tau, s) * smooth(0, tau, len - s); }
    let mx = 0; for (let q = 0; q < m; q++) mx = Math.max(mx, A[q]); cr.maxA = mx; cr.len = len; }
  return creases.filter(c => c.m >= 2 && c.maxA >= O.floorA);
}

// ---- the height of a crease set at points (u, v): the nearest point of each crease's polyline, A(s) sech^2(d / w)
export function heightsAt(creases, w, UV, verts) {
  const out = new Float32Array(verts.length), bb = creases.map(c => { let a = Infinity, b = -Infinity, d = Infinity, e = -Infinity; for (let q = 0; q < c.m; q++) { a = Math.min(a, c.pts[q * 2]); b = Math.max(b, c.pts[q * 2]); d = Math.min(d, c.pts[q * 2 + 1]); e = Math.max(e, c.pts[q * 2 + 1]); } return [a - 6 * w, b + 6 * w, d - 6 * w, e + 6 * w]; });
  const g = creases.length ? (creases[0].len / Math.max(1, creases[0].m - 1)) : 0.003;
  for (let vi = 0; vi < verts.length; vi++) { const v = verts[vi], x = UV[v * 2], y = UV[v * 2 + 1]; let h = 0;
    for (let c = 0; c < creases.length; c++) { const b = bb[c]; if (x < b[0] || x > b[1] || y < b[2] || y > b[3]) continue; const cr = creases[c], P = cr.pts; let bd = Infinity, bq = 0, bt = 0;
      for (let q = 0; q < cr.m - 1; q++) { const ax = P[q * 2], ay = P[q * 2 + 1], dx = P[q * 2 + 2] - ax, dy = P[q * 2 + 3] - ay, l2 = dx * dx + dy * dy || 1e-12, t = clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1), ex = x - ax - dx * t, ey = y - ay - dy * t, d2 = ex * ex + ey * ey; if (d2 < bd) { bd = d2; bq = q; bt = t; } }
      const d = Math.sqrt(bd); if (d > 5 * w) continue; const A = cr.A[bq] * (1 - bt) + cr.A[bq + 1] * bt; h += A * sech2(d / w); }
    out[vi] = h; }
  return out;
}
