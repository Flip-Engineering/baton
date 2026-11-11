// MOUTH (HUMAN c8 round 4b, 3 Oct): the lips from the face surface, their colour from the same geometry, a pleasant resting mouth.
// Opt-in: face3: { rev: 5 } (= FACE4's rev 4 + this) through face3Data / face3Skin; nothing else imports this file, so v3 and rev 4
// render exactly as before. Page-time: it moves the bind positions of the lips only (no re-bake; under the jaw nothing moves).
//
// Why (FACE4's boards at 1:1, judge c9, the orchestrator's steer): the lips read as a pale, puffed LENS laid on the face. Two causes,
// both measured here against the ten registered HSRD-100 heads (SCAN c1's library, our own topology, CC BY 4.0):
//  (a) SHAPE. Slices through our mouths show the two lips meeting in a forward BEAK: the stomion is the most forward point of the
//      mouth, the upper vermilion a wedge sloping down to it, the lower lip a short wedge sloping back to the sulcus (no roll). On the
//      scans the meeting line sits in a groove 1-3 mm behind two rolls, the upper roll's crest under its border, the lower lip a
//      rounded roll whose crest stands 3-6 mm under the stomion, with the sulcus under it. A beak with a lens of paint round it is
//      exactly the 'pout' and the 'bulb'.
//  (b) PAINT. Lane B paints the vermilion as an analytic lens (FACE c2 fitted its numbers, FACE4 bent it) with one colour and a hard
//      rim; its lower half reaches past the lower lip's own roll onto the skin above the sulcus, the 'downward-bowed lower edge'.
// What this does:
//  1. SHAPE: the lips' RELIEF (each column's profile against the straight line from the philtrum's foot to the sulcus) is set to the
//     ten scans' mean relief (closed mouths, per sex), scaled by the person's own vermilion heights (sex, age, group: c2's tables,
//     a seeded draw within -1..+0.6 SD, never past). The meeting line, the corners, the mouth's width and arc and the lips' overall
//     protrusion stay the person's (FACE4's); only the relief inside the window is replaced, so the stomion recesses into its groove,
//     the upper lip gets its roll under the border and the lower lip its roll and the shadowed sulcus under it. The Cupid's bow and the
//     philtrum columns come with the scans' relief (the bow's shape: Winiarska 2025's peaks at 1.29 x the midline height).
//  2. COLOUR from the same model: the vermilion's borders ARE the relief's borders (upper border y_m + Hu(x), lower y_m - Hl(x), the
//     meeting line y_m fitted on the final geometry), handed to lane B's skin as uniforms (skin.js useLipLine: a clean switch in place
//     of FACE4's text patch): colour only inside them, a fine edge (a lighter roll on lighter skins, a defined, darker border on darker
//     skins), darker, redder and wetter toward the meeting line, matte toward the border; the commissures a little shadowed; the
//     lower lip's soft shadow into the sulcus (an occlusion term, not paint down the chin).
//  3. THE RESTING MOUTH is FACE4's (corners level or lifted, the arc set back); this file measures it again on the final shape.
import { clamp, rng, gauss, hashStr, groupMix } from './sample.js';
import { LIPS, BOW_RATIO, frameOf, mixGroups } from './c2.js';
import { tps, warpAt } from './warp.js';
import { useLipLine } from '../likeness/skin.js';

export const MOUTH_VERSION = 1;
const sst = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const MOUTH_SRC = 'lip relief: the mean of the closed-mouth HSRD-100 heads (Digital Reality Lab, CC BY 4.0) registered on hm08 by SCAN c1; vermilion heights: FACE c2 LIPS (Dolci 2021, Chong 2021); bow: Winiarska 2025';

// ---------------------------------------------------------------- the vermilion's outline (relative to the meeting line, mm)
// u = |x| / half-width. Upper: the Cupid's bow (the midline 1, the peaks ~1.29 at u ~0.2, Winiarska 2025), tapering to the corner;
// lower: a flatter arc. Both vanish at the commissure (u = 1); floor() keeps the relief's window finite at the corners.
export function vermShape(u, bow = BOW_RATIO) {
  const a = Math.min(1, Math.abs(u)), taper = Math.pow(Math.max(0, 1 - Math.pow(a, 2.2)), 0.7), b = 1 + (bow - 1) * 1.1 * (1 - Math.exp(-((a / 0.13) ** 2)));
  return { up: b * taper, lo: Math.pow(Math.max(0, 1 - a * a), 0.55) };
}
export const MOUTH_DEFAULTS = {
  shape: true, relief: 1,                       // the relief transplant and its strength (0 off, 1 the scans' mean)
  heights: { lo: -1, hi: 0.6 },                 // the person's vermilion draw, in SDs of c2's tables (never past +0.6 SD)
  sexRelief: 0.5,                               // the other sex's scans' weight in the mean form (own sex 1)
  // paint: blood (x lane B's lip blood), roll (the lighter roll outside the border on lighter skin; the rev-7 skin passes none), wet
  // (roughness off at the meeting line), edge (the border's painted melanin on deeper skin: 0).
  // (DETAIL7 c7 iteration 22, 16 Oct) THE MOUTH'S PAINT RETIRED FROM THE ALBEDO: the contact line (line 0.25), the vermilion's painted vertical
  // lines (lines 0.16), the geometric occlusion baked per vertex (ao 0.55: mouthAO, written on the control vertices only, so on the subdivided
  // body a star of dark texels round each one at the stomion, and computed on the face BEFORE face9 and NOSEMOUTH moved the lips), the
  // corner / sulcus / under shadows (already 0) and the border's painted melanin on deeper skin (edge 0.25: on L14 x1.47 melanin at the
  // border, the 'drawn contour'). What they stood for now comes from the anatomy: the lip's colour is the vermilion's own tissue column
  // (SKIN7, likeness/tissue.js VERMILION), its furrows and their occlusion the fine tier's lip print and cavity (DETAIL7, anatomy/fine/
  // lips.js), the stomion's and the commissures' darkness the geometry, shaded (Cycles traces it; the engine's fine tier carries its horizon
  // occlusion). Git history has the paint.
  paint: { blood: 1.0, edge: 0, roll: 0.5, wet: 0.04 },
};
export function mouthSpec(info, o = {}) {
  const m = typeof o.mouth === 'object' ? o.mouth : {}, sex = info.sex === 'm' ? 'm' : 'f', gm = groupMix(info.group || 'white');
  const r = rng((hashStr('mouth:' + (info.name || '')) ^ Math.imul((m.seed ?? 0) + 3, 2654435761)) >>> 0);
  const H = { ...MOUTH_DEFAULTS.heights, ...(m.heights || {}) }, z = clamp(gauss(r), H.lo, H.hi), ageV = Math.max(0, (info.age ?? 35) - 25) / 10;
  const vm = mixGroups(LIPS.verm[sex], gm), sd = LIPS.vermSd[sex];
  // the vermilion heights at the midline (mm): the table's mean for the person's sex, group and age, + z SD (the lower lip 0.6 z)
  const uv = m.uv ?? +(vm[0] - 0.5 * ageV + z * sd[0]).toFixed(2), lv = m.lv ?? +(vm[1] - 0.35 * ageV + 0.6 * z * sd[1]).toFixed(2);
  // lowerBack: the lower lip's crest this far behind where the person's was (mm; a pout is the lower lip everted past the upper; 0 for
  // Black people, whose lower lips stand further forward by the tables: Wilson 2023, the E-line +5.2 mm);
  // minTilt: the resting corners at least this far over the stomion (bind mm, the frontal view of the upright head; the steer: 0.5-1.5)
  return { v: MOUTH_VERSION, sex, uv: Math.max(3, uv), lv: Math.max(4, lv), z: +z.toFixed(3), shape: m.shape ?? MOUTH_DEFAULTS.shape, relief: m.relief ?? MOUTH_DEFAULTS.relief,
    lowerBack: m.lowerBack ?? +(0.6 * (1 - (gm.black || 0))).toFixed(2), minTilt: m.minTilt ?? (sex === 'f' ? 1.0 : 0.6), rest: m.rest,
    ...Object.fromEntries(['smooth', 'keepSeal', 'sealBand', 'keepLine', 'keepDepth'].filter(k => m[k] !== undefined).map(k => [k, m[k]])),
    sexRelief: m.sexRelief ?? MOUTH_DEFAULTS.sexRelief, paint: { ...MOUTH_DEFAULTS.paint, ...(m.paint || {}) } };
}

// ---------------------------------------------------------------- the mouth frame and the meeting line
// frame mm (c2's face frame), origin moved to the stomion; the meeting line y_m(x) = a u^2 + b u^4 (u = |x| / half) fitted to the
// upper lip's lowest FRONT point and the lower lip's highest per column (the classes from hero.js's mouth-open unit), through the corners
export function mouthFrame(F, P, nb, ao, tri = null) {
  const fr = frameOf(F, P), I = F.ids, sto = fr.loc(I.sto), cL = fr.loc(I.ch_L), cR = fr.loc(I.ch_R), half = Math.abs(cL[0] - cR[0]) / 2, xc = 0.5 * (cL[0] + cR[0]);
  const loc = v => { const q = fr.loc(v); return [q[0] - xc, q[1] - sto[1], q[2] - sto[2]]; };
  const yc = 0.5 * (cL[1] + cR[1]) - sto[1];
  const M = { fr, sto, xc, half, yc, loc,
    toBind: q => [0, 1, 2].map(i => fr.o[i] + ((q[0] + xc) * fr.x[i] + (q[1] + sto[1]) * fr.y[i] + (q[2] + sto[2]) * fr.z[i]) * 0.001),
    dirBind: d => [0, 1, 2].map(i => (d[0] * fr.x[i] + d[1] * fr.y[i] + d[2] * fr.z[i]) * 0.001),
    locB: p => { const d = [0, 1, 2].map(i => (p[i] - fr.o[i]) * 1000); return [d[0] * fr.x[0] + d[1] * fr.x[1] + d[2] * fr.x[2] - xc, d[0] * fr.y[0] + d[1] * fr.y[1] + d[2] * fr.y[2] - sto[1], d[0] * fr.z[0] + d[1] * fr.z[1] + d[2] * fr.z[2] - sto[2]]; } };
  // per column: the upper lip's lowest and the lower lip's highest vertex ON THE FRONT SURFACE (the height map's, within 1 mm)
  const hm = tri ? heightMap(M, P, tri, nb, { x0: -half * 1.1, x1: half * 1.1, y0: -10, y1: 10 }) : null;
  const cols = []; if (ao) { const Q = []; for (let v = 0; v < nb; v++) { const q = loc(v); if (Math.abs(q[0]) > half * 1.05 || Math.abs(q[1]) > 7 || q[2] < -12) continue;
      if (hm) { const zf = hm.at(q[0], q[1]); if (!isFinite(zf) || zf - q[2] > 1.0) continue; } Q.push([q, ao[v * 3 + 1]]); }
    for (let k = 0; k < 11; k++) { const f = 0.15 + 0.075 * k, xb = f * half; let yU = Infinity, yL = -Infinity;
      for (const [q, d] of Q) { if (Math.abs(Math.abs(q[0]) - xb) > 1.3) continue; if (d > -0.004) yU = Math.min(yU, q[1]); else if (d < -0.008) yL = Math.max(yL, q[1]); }
      if (isFinite(yU) && isFinite(yL) && yU - yL < 4 && yU - yL > -3) cols.push([f, 0.5 * (yU + yL), yU - yL]); } }
  // least squares for y = a f^2 + b f^4 with the corners (f = 1, y = yc) weighted in
  let s22 = 4, s24 = 4, s44 = 4, s2y = 4 * yc, s4y = 4 * yc;
  for (const [f, y] of cols) { const f2 = f * f, f4 = f2 * f2; s22 += f2 * f2; s24 += f2 * f4; s44 += f4 * f4; s2y += f2 * y; s4y += f4 * y; }
  const det = s22 * s44 - s24 * s24, a = (s2y * s44 - s4y * s24) / det, b = (s22 * s4y - s24 * s2y) / det;
  M.a = a; M.b = b; M.cols = cols; M.gap = cols.length ? Math.max(...cols.map(c => c[2])) : null;
  M.ym = x => { const f = Math.min(1.3, Math.abs(x) / half), f2 = f * f; return a * f2 + b * f2 * f2; };
  return M;
}

// ---------------------------------------------------------------- the front surface as a height map (frame mm)
export function heightMap(M, P, tri, nb, { x0 = -36, x1 = 36, y0 = -30, y1 = 24, res = 0.25, zMin = -30 } = {}) {
  const nx = Math.round((x1 - x0) / res) + 1, ny = Math.round((y1 - y0) / res) + 1, Z = new Float32Array(nx * ny).fill(-1e9), L = new Map();
  const loc = v => { let q = L.get(v); if (!q) { q = M.loc(v); L.set(v, q); } return q; };
  for (let i = 0; i < tri.length; i += 3) { const a = tri[i], b = tri[i + 1], c = tri[i + 2]; if (a >= nb || b >= nb || c >= nb) continue;
    const A = loc(a), B = loc(b), C = loc(c);
    if (A[2] < zMin && B[2] < zMin && C[2] < zMin) continue;
    const mnx = Math.min(A[0], B[0], C[0]), mxx = Math.max(A[0], B[0], C[0]), mny = Math.min(A[1], B[1], C[1]), mxy = Math.max(A[1], B[1], C[1]);
    if (mxx < x0 || mnx > x1 || mxy < y0 || mny > y1 || mxx - mnx > 20 || mxy - mny > 20) continue;
    const den = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]); if (Math.abs(den) < 1e-9) continue;
    for (let j = Math.max(0, Math.ceil((mny - y0) / res)); j <= Math.min(ny - 1, Math.floor((mxy - y0) / res)); j++) { const y = y0 + j * res;
      for (let i2 = Math.max(0, Math.ceil((mnx - x0) / res)); i2 <= Math.min(nx - 1, Math.floor((mxx - x0) / res)); i2++) { const x = x0 + i2 * res;
        const w1 = ((B[1] - C[1]) * (x - C[0]) + (C[0] - B[0]) * (y - C[1])) / den, w2 = ((C[1] - A[1]) * (x - C[0]) + (A[0] - C[0]) * (y - C[1])) / den, w3 = 1 - w1 - w2;
        if (w1 < -1e-6 || w2 < -1e-6 || w3 < -1e-6) continue; const z = w1 * A[2] + w2 * B[2] + w3 * C[2], k = j * nx + i2; if (z > Z[k]) Z[k] = z; } } }
  const at = (x, y) => { const fx = (x - x0) / res, fy = (y - y0) / res, i = Math.max(0, Math.min(nx - 2, Math.floor(fx))), j = Math.max(0, Math.min(ny - 2, Math.floor(fy))), tx = clamp(fx - i), ty = clamp(fy - j);
    const z00 = Z[j * nx + i], z10 = Z[j * nx + i + 1], z01 = Z[(j + 1) * nx + i], z11 = Z[(j + 1) * nx + i + 1];
    if (z00 < -1e8 || z10 < -1e8 || z01 < -1e8 || z11 < -1e8) return Math.max(z00, z10, z01, z11) > -1e8 ? Math.max(z00, z10, z01, z11) : NaN;
    return (z00 * (1 - tx) + z10 * tx) * (1 - ty) + (z01 * (1 - tx) + z11 * tx) * ty; };
  return { Z, nx, ny, x0, y0, res, at };
}

// ---------------------------------------------------------------- the lips' form from the scans (a residual transfer on our topology)
// The ten scans are registered on OUR mesh (SCAN c1), so every lip vertex has its place on ten real mouths. Per scan: a thin-plate
// spline through an ANCHOR set (a ring round the mouth at the window's edge: the philtrum's middle, the cheeks past the corners, the
// sulcus; and the two corners) maps the scan onto this person; the scan's lip vertices so mapped, minus ours, are the lips' FORM the
// person lacks (the person's own size, width, arc, corners and protrusion are held by the ring and the corners). The mean over the
// closed-mouth scans (own sex x1, the other x sexW) is applied on the outer lip surface and carried smoothly into the lips' inside.
// A scan counts as closed when its upper lip's lowest midline vertex sits under 2.5 mm over the stomion and MediaPipe's vermilion
// heights are sane (uv <= 15, lv <= 18 mm): 7 of 10 (HSR0042, HSR0081, HSR0102 are open or parted).
export const MID = { sto: 493, upLow: 474 };
export function windowOf(M, q) { const u = q[0] / (1.45 * M.half), h = q[1] - M.ym(q[0]), b = h >= 0 ? 13 : 15; return Math.hypot(u, h / b); }   // 1 at the ring
export function lipSets(F, P, nb, tri, ao, M, hm) {
  const outer = [], ring = [], ringBins = new Map(), I = F.ids;
  for (let v = 0; v < nb; v++) { const q = M.loc(v); if (Math.abs(q[0]) > 1.9 * M.half || Math.abs(q[1]) > 24 || q[2] < -25) continue; const e = windowOf(M, q);
    const zf = hm.at(q[0], q[1]); if (!isFinite(zf) || zf - q[2] > 1.2) continue;   // on the front surface
    const d = ao[v * 3 + 1];
    if (e < 0.92 && (d > -0.004 || d < -0.008)) outer.push(v);
    else if (e > 1.0 && e < 1.22) { const key = Math.round(Math.atan2(q[1] / (q[1] >= 0 ? 13 : 15), q[0] / (1.45 * M.half)) / (Math.PI / 18)); if (!ringBins.has(key)) ringBins.set(key, v); } }
  for (const v of ringBins.values()) ring.push(v);
  return { outer, ring: [...ring, I.ch_L, I.ch_R] };
}
const _scan = new Map();
export function closedScans(L, F) {
  if (_scan.has(L)) return _scan.get(L); const out = [];
  for (const h of L.heads) { const P = new Float32Array(L.meta.n * 3); for (let v = 0; v < L.k; v++) for (let a = 0; a < 3; a++) P[L.hv[v] * 3 + a] = h.X[v * 3 + a];
    const fr = frameOf(F, P), gap = fr.loc(MID.upLow)[1] - fr.loc(MID.sto)[1], uv = h.lips?.uv, lv = h.lips?.lv;
    out.push({ id: h.id, sex: h.sex, age: h.age, group: h.group, uv, lv, gap: +gap.toFixed(2), closed: gap < 2.5 && uv > 0 && uv <= 15 && lv > 0 && lv <= 18, P }); }
  _scan.set(L, out); return out;
}
// the mean residual on the outer lip vertices (frame mm, this person's frame): { r: Map v -> [dx, dy, dz], w, used }
export function scanResidual(F, P, sets, scans, M, { sex = 'f', sexW = 0.5 } = {}) {
  const idx = sets.ring, used = [], acc = new Map(); let W = 0, kH = 0;
  const ours = v => M.loc(v);
  for (const s of scans) { if (!s.closed) continue; const w = s.sex === sex ? 1 : sexW; if (w <= 0) continue;
    const Ms = { fr: frameOf(F, s.P) }, cS = idx.map(v => [s.P[v * 3], s.P[v * 3 + 1], s.P[v * 3 + 2]]), cO = idx.map(v => M.toBind(ours(v)));
    const Wt = tps(cS, cO.map((c, i) => c.map((x, a) => x - cS[i][a])), 1e-6);
    // the scan's vertical scale in this person's frame (its ring's height over ours): its MediaPipe heights expressed here
    const yS = idx.map(v => Ms.fr.loc(v)[1]), yO = idx.map(v => ours(v)[1]), spanS = Math.max(...yS) - Math.min(...yS), spanO = Math.max(...yO) - Math.min(...yO);
    kH += w * 0.5 * (s.uv + s.lv) * spanO / spanS;
    for (const v of sets.outer) { const p = [s.P[v * 3], s.P[v * 3 + 1], s.P[v * 3 + 2]], d = warpAt(Wt, p), pb = [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
      const q = M.locB(pb), o = ours(v), r = [q[0] - o[0], q[1] - o[1], q[2] - o[2]], a = acc.get(v) || [0, 0, 0]; for (let j = 0; j < 3; j++) a[j] += w * r[j]; acc.set(v, a); }
    W += w; used.push(s.id); }
  for (const a of acc.values()) for (let j = 0; j < 3; j++) a[j] /= W;
  return { r: acc, used, lipScale: kH / W };
}

// ---------------------------------------------------------------- 1. the shape
// mouthShape(F, P, src, spec, scans) -> { P, report }: src = { nb, n, tri, ao }; P: bind positions (metres; a copy is returned)
export function mouthShape(F, P0, src, spec, scans, resid = null) {   // resid (FACE6, opt-in): (P, sets, M) -> the residual from another form than the scans'
  const { nb, n, tri, ao } = src, P = new Float32Array(P0), M = mouthFrame(F, P, nb, ao, tri), hm = heightMap(M, P, tri, nb);
  const sets = lipSets(F, P, nb, tri, ao, M, hm), res = resid ? resid(P, sets, M) : scanResidual(F, P, sets, scans, M, { sex: spec.sex, sexW: spec.sexRelief });
  // the person's lip heights against the scans' (mean, in this frame): the lips' vertical extent scaled about the meeting line
  // the mean residual smoothed over the lip surface (3 passes, each lip on its own: the seven scans' rows do not land on exactly
  // the same lines, and their mean left a groove across L11's lower lip)
  { const isUp = v => ao[v * 3 + 1] > -0.004, on = new Set(sets.outer), nbr = new Map();
    for (let i = 0; i < tri.length; i += 3) for (const [a, b] of [[tri[i], tri[i + 1]], [tri[i + 1], tri[i + 2]], [tri[i + 2], tri[i]]]) { if (!on.has(a) || !on.has(b) || isUp(a) !== isUp(b)) continue;
      (nbr.get(a) || nbr.set(a, new Set()).get(a)).add(b); (nbr.get(b) || nbr.set(b, new Set()).get(b)).add(a); }
    for (let it = 0; it < (spec.smooth ?? 3); it++) { const R2 = new Map();
      for (const [v, r] of res.r) { const N = nbr.get(v); if (!N || !N.size) { R2.set(v, r); continue; } const m = [0, 0, 0]; let c = 0; for (const u of N) { const q = res.r.get(u); if (!q) continue; for (let j = 0; j < 3; j++) m[j] += q[j]; c++; }
        R2.set(v, c ? r.map((x, j) => 0.5 * x + 0.5 * m[j] / c) : r); }
      res.r = R2; } }
  const kV = clamp(0.5 * (spec.uv + spec.lv) / res.lipScale, 0.7, 1.5), k = spec.relief;
  const rep = { uv: spec.uv, lv: spec.lv, half: +M.half.toFixed(2), scans: res.used, kV: +kV.toFixed(3), outer: sets.outer.length, ring: sets.ring.length };
  if (!spec.shape || k <= 0 || !res.used.length) return { P, M, report: rep };
  // the meeting line keeps its height (the person's resting corners, FACE4's): the scans' mean lifts our stomion 1-2.5 mm against the
  // corners (their corners sit lower over their stomion than FACE4's pleasant rest), which read as a frown; the residual's vertical
  // part ON the line (by u, smoothed) is taken out of the whole lip, fading to the ring
  // per lip (the upper lip's lowest rows and the lower lip's top rows each hold their own height, so the seal FACE3 made stays shut)
  const lineOf = up => { const bins = Array.from({ length: 9 }, () => [0, 0]);
    for (const v of sets.outer) { const r = res.r.get(v); if (!r || (ao[v * 3 + 1] > -0.004) !== up) continue; const o = M.loc(v), h = o[1] - M.ym(o[0]); if (Math.abs(h) > 1.5) continue;
      const u = Math.min(1, Math.abs(o[0]) / M.half), i = Math.min(8, Math.round(u * 8)); bins[i][0] += r[1]; bins[i][1]++; }
    let L = bins.map(([s, c]) => c ? s / c : null); L[8] = 0; for (let i = 7; i >= 0; i--) if (L[i] == null) L[i] = L[i + 1];
    L = L.map((x, i) => (x + (L[Math.max(0, i - 1)] + L[Math.min(8, i + 1)]) * 0.5) / 2); L[8] = 0; return L; };
  const lineU = lineOf(true), lineL = lineOf(false);
  const dyAt = (u, up) => { const L = up ? lineU : lineL, f = Math.min(1, u) * 8, i = Math.min(7, Math.floor(f)), t = f - i; return L[i] * (1 - t) + L[i + 1] * t; };
  rep.lineDy = { U: lineU.map(x => +x.toFixed(2)), L: lineL.map(x => +x.toFixed(2)) };
  // each lip keeps its own protrusion (FACE4's E-line caps: a Black woman's lips stand further forward than the scans' mean, which is
  // mostly white, Hispanic and Asian): after the form is laid on, each lip's crest near the midline is moved back (or forward) to where
  // the person's crest was, by a smooth bump over that lip, so the scans give the FORM (the groove, the rolls, the sulcus), not the depth
  const bump = (o, up) => { const u = Math.abs(o[0]) / M.half, h = o[1] - M.ym(o[0]), H = up ? spec.uv : spec.lv; if (up ? h < -0.3 : h > 0.3) return 0;
    return Math.exp(-((u / 0.7) ** 2)) * Math.exp(-(((Math.abs(h) - 0.5 * H) / (0.75 * H)) ** 2)); };
  const C = [];
  for (const v of sets.outer) { const o = M.loc(v), r0 = res.r.get(v); if (!r0) continue; const e0 = windowOf(M, o), r = [r0[0], r0[1] - (spec.keepLine === false ? 0 : dyAt(Math.abs(o[0]) / M.half, ao[v * 3 + 1] > -0.004) * (1 - sst(0.5, 0.95, e0))), r0[2]];
    const t = [o[0] + k * r[0], o[1] + k * r[1], o[2] + k * r[2]];
    const h = t[1] - M.ym(t[0]), e = windowOf(M, o), wl = 1 - sst(0.45, 0.9, e); t[1] = M.ym(t[0]) + h * (1 + (kV - 1) * wl);
    C.push([v, o, t]); }
  const crest = (up, pick) => { let z = -1e9; for (const [v, o, t] of C) { const q = pick(o, t), h = q[1] - M.ym(q[0]), H = up ? spec.uv : spec.lv;
    if (Math.abs(q[0]) > 0.25 * M.half || (up ? (h < 0 || h > 1.15 * H) : (h > 0 || h < -1.15 * H))) continue; z = Math.max(z, q[2]); } return z; };
  const hold = {}; for (const up of [true, false]) { const zo = crest(up, o => o), zn = crest(up, (o, t) => t); hold[up ? 'U' : 'L'] = spec.keepDepth === false || zo < -1e8 || zn < -1e8 ? 0 : clamp(zn - zo, -4, 6) + (up ? 0 : spec.lowerBack ?? 0); }
  rep.depthHold = { U: +hold.U.toFixed(2), L: +hold.L.toFixed(2) };
  for (const [v, o, t] of C) t[2] -= hold.U * bump(o, true) + hold.L * bump(o, false);
  // the lips stay closed as FACE3 sealed them: near the meeting line (|h| < 2.5 mm) both lips take one common displacement per 2 mm
  // column (the mean of the two lips' there), so the groove can recess and the crests come forward without the lips parting in depth
  // (a lip held further forward than the other showed the lower lip's lit top as a pale seam behind the upper lip's edge)
  const colKey = x => Math.round(x / 2), acc = new Map();
  for (const [v, o, t] of C) { const h = o[1] - M.ym(o[0]); if (Math.abs(h) > 2.5) continue; const k = colKey(o[0]), up = ao[v * 3 + 1] > -0.004; let a = acc.get(k); if (!a) acc.set(k, a = { U: [0, 0, 0, 0], L: [0, 0, 0, 0] });
    const s = up ? a.U : a.L; for (let j = 0; j < 3; j++) s[j] += t[j] - o[j]; s[3]++; }
  const common = k => { const a = acc.get(k); if (!a || !a.U[3] || !a.L[3]) return null; return [0, 1, 2].map(j => 0.5 * (a.U[j] / a.U[3] + a.L[j] / a.L[3])); };
  let nc = 0; if (spec.keepSeal !== false) for (const [v, o, t] of C) { const h = o[1] - M.ym(o[0]), w = 1 - sst(0.5, spec.sealBand ?? 2.5, Math.abs(h)); if (w <= 0) continue; const c = common(colKey(o[0])); if (!c) continue;
    for (let j = 0; j < 3; j++) t[j] = (1 - w) * t[j] + w * (o[j] + c[j]); nc++; }
  rep.sealHeld = nc;
  const Cb = [], D = [];
  for (const [v, o, t] of C) { Cb.push(M.toBind(o)); D.push(M.dirBind([t[0] - o[0], t[1] - o[1], t[2] - o[2]])); }
  for (const v of sets.ring) { Cb.push(M.toBind(M.loc(v))); D.push([0, 0, 0]); }
  const Wt = tps(Cb, D, 1e-7);
  let moved = 0, mx = 0;
  for (let v = 0; v < nb; v++) { const q = M.loc(v), e = windowOf(M, q); if (e > 1.3 || q[2] < -22) continue; const zf = hm.at(q[0], q[1]);
    const wd = isFinite(zf) ? 1 - sst(6, 14, zf - q[2]) : 0, w = wd * (1 - sst(1.0, 1.3, e)); if (w <= 0) continue;
    const d = warpAt(Wt, [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]); for (let a = 0; a < 3; a++) P[v * 3 + a] += w * d[a]; moved++; mx = Math.max(mx, w * Math.hypot(...d)); }
  rep.moved = moved; rep.maxMm = +(mx * 1000).toFixed(2);
  return { P, M, report: rep, res };
}

// ---------------------------------------------------------------- 2. the lines for the paint (bind space)
// mouthLines(F, P, src, spec) -> { N, rows: [[|x|, yMeet, yTop, yBot] x N] (bind metres, mirrored mean), half, z (the mouth's front, bind) }
export function mouthLines(F, P, src, spec, N = 12) {
  const M = mouthFrame(F, P, src.nb, src.ao, src.tri), rows = [];
  for (let i = 0; i < N; i++) { const u = i / (N - 1), acc = [0, 0, 0, 0];
    for (const sg of [1, -1]) { const x = sg * u * M.half, sh = vermShape(u), y = M.ym(x);
      const pM = M.toBind([x, y, 0]), pT = M.toBind([x, y + spec.uv * sh.up, 0]), pB = M.toBind([x, y - spec.lv * sh.lo, 0]);
      acc[0] += Math.abs(pM[0]) / 2; acc[1] += pM[1] / 2; acc[2] += pT[1] / 2; acc[3] += pB[1] / 2; }
    rows.push(acc.map(x => +x.toFixed(6))); }
  const front = M.toBind([0, 0, 0]);
  return { N, rows, half: +rows[N - 1][0].toFixed(6), z: +front[2].toFixed(6), center: +M.toBind([0, 0, 0])[0].toFixed(6) };
}

// (2a, mouthAO: the mouth's occlusion baked per vertex into the albedo: RETIRED, DETAIL7 c7 iteration 22; see MOUTH_DEFAULTS.paint)

// ---------------------------------------------------------------- 2b. the mouth's own hook (an H1 skin hook after lane B's)
// hero.js's painted 3 mm parting band out (as FACE3's seal did; hero.js paints it, this divides it out), the fissure's roughness (no sharp
// highlight in it), and FACE3's opt-in make-up lip colour inside the vermilion only. (DETAIL7 c7 iteration 22: the contact line, the corner,
// sulcus and under shadows, the painted vertical lines and the per-vertex occlusion are gone: the anatomy makes them, MOUTH_DEFAULTS.paint
// says where.) The outline is the skin's own (likeness/skin.js useLipLine's uniforms, shared: NOSEMOUTH's wrap re-points them in place),
// so the fissure and the make-up sit on the lips the geometry has; MOUTH's own rows only where the skin has no lip line.
const MO_N = 12;
const MO_PARS = `uniform vec4 moLipG[${MO_N}]; uniform vec4 moLipK; uniform vec4 moMk; uniform vec3 moTint;
vec3 moLine(vec3 b, out float u) { float ax = abs(b.x - moLipK.w), f = clamp(ax / moLipK.x, 0.0, 1.0) * ${MO_N - 1}.0, t = fract(f); vec4 A = moLipG[0], B = moLipG[1];
  for (int k = 0; k < ${MO_N - 1}; k++) if (float(k) == min(floor(f), ${MO_N - 2}.0)) { A = moLipG[k]; B = moLipG[k + 1]; }
  if (f >= ${MO_N - 1}.0) t = 1.0; u = ax / moLipK.x; return mix(A.yzw, B.yzw, t); }
`;
const MO_FRAG = `
{ vec3 b = vBind; float reg = vHero.x; if (b.y > hEyeL.y - 0.15 && reg > 1.5 && reg < 10.5) reg = 11.;
  if ((reg < 1.5 || reg > 10.5) && b.z > moLipK.y - 0.03 && abs(b.y - hMouth.y) < 0.03) {
    float hb = 1.0 - 0.5 * exp(-(pow(b.x / 0.024, 2.0) + pow((b.y - hMouth.y) / 0.0016, 2.0))) * step(hMouth.z - 0.02, b.z);
    diffuseColor.rgb /= max(hb, 0.25);
    float u; vec3 L = moLine(b, u); float up = step(L.x, b.y), dE = mix(b.y - L.z, L.y - b.y, up), ew = max(moLipK.z, 0.7 * fwidth(b.y));
    roughnessFactor = mix(roughnessFactor, max(roughnessFactor, 0.72), exp(-pow((b.y - L.x) / 0.0013, 2.0)) * step(u, 1.05));   // no sharp highlight in the fissure (it read as a pale seam)
    if (moMk.x > 0.0) { float inL = smoothstep(-ew, ew, dE) * step(u, 1.08) * step(moLipK.y - 0.02, b.z);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * moTint, moMk.x * inL); roughnessFactor = mix(roughnessFactor, roughnessFactor - moMk.y, inL); } } }
`;
// mouthSkin(h, m, { makeup }): m = f3.mouth ({ spec, lines }); after applySkin (lane B) and face3Skin's own hook
export function mouthSkin(h, m, { makeup = null } = {}) {
  const p = m.spec.paint, L = m.lines, V = a => ({ value: new Float32Array(a) }), rep = { lipLine: null, hook: false };
  rep.lipLine = useLipLine(h, L, { blood: p.blood, edge: p.edge, roll: p.roll, wet: p.wet })?.key || null;
  const rows = L.rows.slice(0, MO_N); while (rows.length < MO_N) rows.push(rows[rows.length - 1]);
  const LU = rep.lipLine ? h.likeness?.skin?.lipLine?.U : null;   // the skin's outline uniforms, shared (one outline for every layer)
  const U = { moLipG: LU?.likeLipG || V(rows.flat()), moLipK: LU?.likeLipK || V([L.half, L.z, 0.0003, L.center ?? 0]),
    moMk: V([makeup ? makeup.lip : 0, makeup ? makeup.lipGloss : 0, 0, 0]), moTint: V(makeup ? makeup.lipTint : [1, 1, 1]) };
  rep.outline = LU ? 'skin' : 'mouth';
  if (typeof h.useSkinHook === 'function') { h.useSkinHook({ key: 'mouth2', uniforms: U, fragPars: MO_PARS, frag: MO_FRAG }); rep.hook = true; }
  h.mouth5 = { m, U, report: rep };
  return rep;
}
