// LIKENESS / skin_lut: our biophysical skin albedo, evaluated at load from the calibrated model (HUMAN c8, lane B).
//
//   import { loadSkinModel, skinSpectrum, skinRGB, personLUT, SKIN_PRESETS } from './skin_lut.js';
//   const M = await loadSkinModel();                          // assets/likeness/skin_model.json (22 kB), once
//   skinRGB(M, { Cm: 0.03, beta: 0.47, Ch: 0.02, gamma: 0.63, Cc: 0.2 })   // linear Rec.709 BODY albedo (no surface reflection)
//   const L = personLUT(M, params)                            // { data, w, h, axes, base }: the 2D (melanin x blood) x 2 (oxygenation) table
//
// The model (videos/scripts/skin_calib.py has the derivation and the fit): a thin absorbing epidermis (melanin volume fraction Cm,
// a blend of eumelanin and pheomelanin with eumelanin fraction beta, carotene Cc, the bloodless baseline) over a semi-infinite
// diffusing dermis (blood fraction Ch at oxygen saturation gamma), joined through the skin-air boundary's internal reflection,
// plus the light the stratum corneum returns before the basal melanin (part of the melanin sits above it). Two-layer in the
// spirit of Donner and Jensen 2006 and Jimenez et al. 2010; Aliaga et al. 2023 as a reference for the parameter space.
// Calibrated so it fits all 100 NIST skin spectra (Cooksey et al. 2017: dE76 p50 0.5, p90 1.0) and passes the deep-skin
// anchors NIST does not reach (adult ITA down to -67, Leeb et al. 2024). The colour weights (spectrum -> white-balanced linear
// Rec.709) ship in the JSON, so the page and node evaluate the same numbers the calibration did.
//
// Per-person LUT (Jimenez et al. 2010 keep melanin and hemoglobin as two maps that index a precomputed colour table; here the axes are
// MULTIPLIERS of the person's own Cm and Ch, so regional maps (palms x0.2 melanin, lips x3 blood, a tanned forearm x1.6) index
// one table built for that person): u = log melanin multiplier 0.1..3, v = log blood multiplier 0.2..6. Skin rev 7 (SKIN OPTICS iteration 7): the table is
// a grid of TISSUE TILES, one per skin column (tissue.js: the dermis's thickness x what it lies on, as a ratio to the arm's column NIST measured), so a
// vertex's own column (from the person's head anatomy) indexes it, in SETS by the epidermis's corneum (iteration 10: tissue.js CORNEUM, the cell layers by site; the VERMILION's epithelium, iteration 9, is the set at its own corneum); rev < 7
// keeps two slices (the skin as calibrated; its oxygenation dropped by 0.35).

import { columnRatio, tileColumns, refCoords, THIN_COORDS, TISSUE_TILES, VERMILION, CORNEUM, cornK, cornCoord } from './tissue.js';
export const LUT_AXES = { m: [0.1, 3.0], h: [0.2, 6.0], n: 32 };   // rev 7: TISSUE_TILES.nt x TISSUE_TILES.ns tiles of n x n (tissue.js); rev < 7: two slices (the 0.35 oxygenation drop)

let _M = null;
export async function loadSkinModel(url = new URL('../../../assets/likeness/skin_model.json', import.meta.url).href) {
  if (_M) return _M;
  const j = await fetch(url).then(r => r.json());
  _M = j; return j;
}

// the corneum's backscatter at k x the calibrated thickness (iteration 10; tissue.js CORNEUM): a thin non-absorbing Kubelka-Munk slab, R = S t / (1 + S t), so with the
// calibrated r1 at k = 1, R(k) = k r1 / (1 - r1 + k r1): linear while thin (the face, the vermilion), saturating where thick (the palms and soles); exactly r1 at k = 1
export const cornR = (r1, k) => k === 1 ? r1 : k * r1 / Math.max(1e-9, 1 - r1 + k * r1);
// body reflectance spectrum (31 samples, 400..700 nm) for p = { Cm, beta, Ch, gamma, Cc, corn? (the site's corneum, x the calibrated), col? (the tissue column) }; surface = add the measured surface term
export function skinSpectrum(M, p, surface = false) {
  const { mu, global: g, Fdr } = M, n = M.wl.length, out = new Float64Array(n);
  const { Cm, beta, Ch, gamma, Cc = 0 } = p;
  for (let i = 0; i < n; i++) {
    const wl = M.wl[i];
    const muM = Cm * (beta * mu.eu[i] + (1 - beta) * mu.pheo[i]);
    const muE = muM + (1 - Cm) * mu.base[i] + Cc * mu.car[i];
    const t2 = Math.exp(-4 * muE * g.d_mm * 0.1);
    const muD = Ch * (gamma * mu.oxy[i] + (1 - gamma) * mu.deoxy[i]) + (1 - Ch) * mu.base[i] + g.carDermis * Cc * mu.car[i];
    const x = wl / 500, mus = g.mus_a * (g.mus_fRay * x ** -4 + (1 - g.mus_fRay) * x ** -g.mus_bMie);
    const al = mus / (mus + muD), s = Math.sqrt(3 * (1 - al));
    let Rd = al / 2 * (1 + Math.exp(-4 / 3 * s)) * Math.exp(-s);
    if (p.col) Rd *= columnRatio(M, p, i, p.col.td, p.col.Rg);   // the skin's column at this vertex (tissue.js): its ratio to the arm's column
    const rsc = cornR(Math.min(0.3, Math.max(0, g.ksc * x ** -g.psc)), p.corn ?? 1) * Math.exp(-4 * g.phi * muM * g.d_mm * 0.1);   // corn: the site's stratum corneum as a multiple of the calibrated (the volar forearm's): tissue.js CORNEUM, VERMILION
    out[i] = rsc + (1 - rsc) ** 2 * t2 * Rd * (1 - Fdr) / (1 - Fdr * t2 * Rd) + (surface ? g.Rs : 0);
  }
  return out;
}
// THE THIN PLACES: iteration 5's THIN_PERIORBITAL (one 0.4 mm dermis over muscle and venous plexus, indexed by the zones' 'oxy' share) is superseded by
// iteration 7's tissue columns (tissue.js: every vertex's own dermis and what lies under it, read from the person's head anatomy); git history keeps it.

export function spectrumRGB(M, R) {
  const S = M.spec2rgb, c = [0, 0, 0];
  for (let k = 0; k < 3; k++) for (let i = 0; i < R.length; i++) c[k] += S[k][i] * R[i];
  return c;
}
export const skinRGB = (M, p, surface = false) => spectrumRGB(M, skinSpectrum(M, p, surface));

// SKIN OPTICS iteration 13 (16 Oct): THE TRANSPORT FROM THE COLUMN. The albedo of a vertex is its own column's (the calibrated dermis x the column's ratio to the
// arm's, tissue.js); its subsurface RADIUS was one number per person (optics.js skinOptics: the semi-infinite dermis at the face's blood), the face's and the
// covered body's, the ear's plate and the lid's 0.35 mm dermis on its muscle alike. Cycles (person_scene.py) builds, from the albedo and the radius it is given,
// ONE homogeneous medium per shading point (bssrdf_setup_radius: the albedo inverted through the dipole for alpha', the radius read as the diffuse mean free
// path l_d). So the radius that belongs with the column's albedo is the l_d of the homogeneous medium that reflects what the column reflects: per band, the
// column's dermal reflectance Rd_col = Rd_cal x columnRatio is inverted through the calibration's own dipole for the effective mu_a / mu_s' (a brighter column,
// e.g. a dermis over a fat pad or over bone, reads as a less absorbing medium: its light comes back from further; a darker one, a thin dermis over muscle's
// myoglobin and blood, or a plate with air behind it (the auricle), as a more absorbing one: its light comes back from nearer), at the dermis's absolute
// scattering (Jacques 2013, mu_s'(500) 43.6 cm^-1: the scale optics.js puts on the calibration's ratio), l_d = 1 / sqrt(3 mu_a (mu_a + mu_s')) (the dipole's
// sigma_tr; Jensen et al. 2001), and per channel the energy-weighted mean over the bands (the channel's weight x the reflectance: optics.js's rule).
// At the reference column (the volar forearm NIST measured) the ratio is 1 and this returns optics.js's l_d exactly. Melanin sits above the dermis: it only
// re-weights the bands within a channel. The effective medium is a first-order description of a layered column (a layered profile is not a homogeneous one:
// a dermis over fat spreads its red further than the effective medium says, Donner and Jensen 2005's multipole); said, not corrected.
let _dipInv = null;
function dipInv() { if (_dipInv) return _dipInv; const n = 720, l0 = Math.log(1e-6), l1 = Math.log(60), X = new Float64Array(n), R = new Float64Array(n);
  for (let k = 0; k < n; k++) { const x = Math.exp(l0 + (l1 - l0) * k / (n - 1)), al = 1 / (1 + x), s = Math.sqrt(3 * (1 - al)); X[k] = x; R[k] = al / 2 * (1 + Math.exp(-4 / 3 * s)) * Math.exp(-s); }
  return (_dipInv = { X, R, n }); }
// the mu_a / mu_s' of the semi-infinite dermis whose dipole reflects Rd (the calibration's own dipole; log-interpolated, monotonic)
export function dermisRatioOf(Rd) { const { X, R, n } = dipInv(); if (!(Rd < R[0])) return X[0]; if (Rd <= R[n - 1]) return X[n - 1];
  let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (R[m] > Rd) lo = m; else hi = m; }
  const f = (Rd - R[lo]) / (R[hi] - R[lo]); return Math.exp(Math.log(X[lo]) + f * (Math.log(X[hi]) - Math.log(X[lo]))); }
// per band (mm): the diffuse mean free path of the column at p = { Ch, gamma, Cc, col? } (melanin and the corneum do not enter: they lie above the dermis)
export function columnLdBands(M, p) {
  const { mu, global: g } = M, n = M.wl.length, out = new Float64Array(n), { Ch, gamma, Cc = 0 } = p;
  for (let i = 0; i < n; i++) {
    const x = M.wl[i] / 500, muD = Ch * (gamma * mu.oxy[i] + (1 - gamma) * mu.deoxy[i]) + (1 - Ch) * mu.base[i] + g.carDermis * Cc * mu.car[i];
    const mus = g.mus_a * (g.mus_fRay * x ** -4 + (1 - g.mus_fRay) * x ** -g.mus_bMie);
    let r = muD / mus;
    if (p.col) { const al = 1 / (1 + r), s = Math.sqrt(3 * (1 - al)), Rd = al / 2 * (1 + Math.exp(-4 / 3 * s)) * Math.exp(-s); r = dermisRatioOf(Rd * columnRatio(M, p, i, p.col.td, p.col.Rg)); }
    const ms = 43.6 * (0.41 * x ** -4 + 0.59 * x ** -0.562), ma = r * ms;   // Jacques 2013 dermis (tissue.js dermisMu, optics.js JACQUES13.dermis)
    out[i] = 10 / Math.sqrt(3 * ma * (ma + ms));
  }
  return out;
}
// per channel (mm): the bands' l_d weighted by what the channel sees of them (its colour weight x the vertex's reflectance R, the full spectrum)
export function channelLd(M, R, ldB) { const W = M.spec2rgb, out = [0, 0, 0];
  for (let k = 0; k < 3; k++) { let e = 0, el = 0; for (let i = 0; i < R.length; i++) { const w = Math.max(0, W[k][i]) * R[i]; e += w; el += w * ldB[i]; } out[k] = el / Math.max(e, 1e-12); }
  return out; }
// the column's transport for a person p (with p.col, p.corn as skinSpectrum takes them): { ld: [r, g, b] mm, albedo }
export function skinTransport(M, p) { const R = skinSpectrum(M, p); return { ld: channelLd(M, R, columnLdBands(M, p)), albedo: spectrumRGB(M, R) }; }
// the LUT's second plane (rev 7): the radius is stored per channel as l_d in mm (half float); the Cycles bake writes sqrt(l_d / LD_MAX_MM) (lab_bake.js pass 4)
export const LD_MAX_MM = 4.0;
export const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// CIELAB of a linear Rec.709 colour under the model's white (D65-like, white-balanced: a flat reflector is neutral)
export function rgbToLab(c) {
  const X = 0.4124 * c[0] + 0.3576 * c[1] + 0.1805 * c[2], Y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], Z = 0.0193 * c[0] + 0.1192 * c[1] + 0.9505 * c[2];
  const f = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  const fx = f(X / 0.9505), fy = f(Y), fz = f(Z / 1.089);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
export const ita = L => Math.atan2(L[0] - 50, L[2]) * 180 / Math.PI;

// the person's table: Float32 RGBA. Rev 7 (tiles: true): TISSUE_TILES.nt x .ns tiles side by side (column k = the dermis's thickness index, row j = the
// backing), each n x n (melanin x blood multipliers); rev < 7: width 2n (two oxygenation slices), height n
export function personLUT(M, p, { n = LUT_AXES.n, tiles = false } = {}) {
  const [m0, m1] = LUT_AXES.m, [h0, h1] = LUT_AXES.h;
  // rev 7: the tiles come in SETS by the epidermis's corneum (iteration 10, tissue.js CORNEUM.levels: the vermilion's 3 layers, the face's 9, the volar forearm's 15 = the
  // calibration, the palms' and soles' 47), the same (melanin x blood) axes and tissue columns in each: set c holds rows c ns .. (c + 1) ns - 1. (Iteration 9's two sets, the
  // skin at the forearm's corneum and the vermilion's, are the first and third of these: the vermilion is the set at its own corneum.)
  // iteration 13: a SECOND PLANE below the albedo's (rows hh .. 2 hh - 1, the same tiles and axes): the column's transport, l_d per channel in mm (columnLdBands,
  // channelLd), so the shader reads a texel's radius with the same lookup as its colour (lab_bake.js pass 4 -> the Cycles radius map). The albedo plane is unchanged.
  if (tiles) { const T = TISSUE_TILES, sk = tileColumns(M), NC = CORNEUM.levels.length, cols = CORNEUM.levels.flatMap((ly, c) => sk.map(q => ({ ...q, j: q.j + c * T.ns, corn: cornK(ly) }))), w = T.nt * n, hh = NC * T.ns * n, data = new Float32Array(w * hh * 2 * 4), ldMemo = new Map();
    for (const c of cols) for (let j = 0; j < n; j++) { const hm = h0 * (h1 / h0) ** (j / (n - 1)), lk = c.k + '|' + (c.j % T.ns) + '|' + j;
      let ldB = ldMemo.get(lk); if (!ldB) { ldB = columnLdBands(M, { ...p, Ch: Math.min(0.25, p.Ch * hm), col: { td: c.td, Rg: c.Rg } }); ldMemo.set(lk, ldB); }
      for (let i = 0; i < n; i++) {
        const mm = m0 * (m1 / m0) ** (i / (n - 1));
        const q = { ...p, Cm: Math.min(0.75, p.Cm * mm), Ch: Math.min(0.25, p.Ch * hm), col: { td: c.td, Rg: c.Rg }, ...(c.corn != null ? { corn: c.corn } : {}) }, S = skinSpectrum(M, q), rgb = spectrumRGB(M, S), o = (((c.j * n + j) * w) + c.k * n + i) * 4;
        data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; data[o + 3] = 1;
        const ld = channelLd(M, S, ldB), o2 = o + hh * w * 4; data[o2] = ld[0]; data[o2 + 1] = ld[1]; data[o2 + 2] = ld[2]; data[o2 + 3] = 1; } }
    return { data, w, h: 2 * hh, n, planes: 2, tiles: { nt: T.nt, ns: T.ns, nc: NC }, ref: refCoords(M), thin: THIN_COORDS, corn: { levels: CORNEUM.levels, ref: cornCoord(CORNEUM.ref), verm: cornCoord(VERMILION.layers) }, base: skinRGB(M, p) }; }
  const w = 2 * n, data = new Float32Array(w * n * 4);
  for (let s = 0; s < 2; s++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const mm = m0 * (m1 / m0) ** (i / (n - 1)), hm = h0 * (h1 / h0) ** (j / (n - 1));
    const q = { ...p, Cm: Math.min(0.75, p.Cm * mm), Ch: Math.min(0.25, p.Ch * hm), ...(s ? { gamma: Math.max(0.05, p.gamma - 0.35) } : {}) };
    const c = skinRGB(M, q), o = ((j * w) + s * n + i) * 4;
    data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 1;
  }
  return { data, w, h: n, n, base: skinRGB(M, p) };
}
// the same lookup in JS (for the node check and for picking nail and lip colours): bilinear, as the GPU does. Rev 7's tiles: tc = the vertex's tissue
// coordinates (tdI, s) (default: the reference column), oxy mixes them toward the thin column (veins, nails), as the shader does; cc = the vertex's corneum
// coordinate (tissue.js cornCoord; default: the calibration's, the volar forearm), verm mixes it toward the vermilion's
export function lutAt(L, mMul, hMul, oxy = 0, tc = null, verm = 0, cc = null, plane = 0) {   // plane 1 (rev 7, iteration 13): the transport, l_d per channel (mm)
  const [m0, m1] = LUT_AXES.m, [h0, h1] = LUT_AXES.h, n = L.n;
  const u = Math.min(n - 1, Math.max(0, Math.log(mMul / m0) / Math.log(m1 / m0) * (n - 1))), v = Math.min(n - 1, Math.max(0, Math.log(hMul / h0) / Math.log(h1 / h0) * (n - 1)));
  const at = (ox, oy, i, j) => { const o = (((oy + j) * L.w) + ox + i) * 4; return [L.data[o], L.data[o + 1], L.data[o + 2]]; };
  const bl = (ox, oy) => { const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, i1 = Math.min(n - 1, i + 1), j1 = Math.min(n - 1, j + 1);
    const a = at(ox, oy, i, j), b = at(ox, oy, i1, j), c = at(ox, oy, i, j1), d = at(ox, oy, i1, j1);
    return [0, 1, 2].map(k => (a[k] * (1 - fu) + b[k] * fu) * (1 - fv) + (c[k] * (1 - fu) + d[k] * fu) * fv); };
  if (L.tiles) { const t0 = tc || L.ref, t = [0, 1].map(k => Math.min(1, Math.max(0, t0[k] + (L.thin[k] - t0[k]) * Math.min(1, Math.max(0, oxy)))));
    const x = t[0] * (L.tiles.nt - 1), y = t[1] * (L.tiles.ns - 1), k0 = Math.floor(x), j0 = Math.floor(y), fx = x - k0, fy = y - j0, k1 = Math.min(L.tiles.nt - 1, k0 + 1), j1 = Math.min(L.tiles.ns - 1, j0 + 1);
    const set = c => { const o = c * L.tiles.ns * n + (plane ? L.tiles.nc * L.tiles.ns * n : 0), A = bl(k0 * n, j0 * n + o), B = bl(k1 * n, j0 * n + o), C = bl(k0 * n, j1 * n + o), D = bl(k1 * n, j1 * n + o);
      return [0, 1, 2].map(k => (A[k] * (1 - fx) + B[k] * fx) * (1 - fy) + (C[k] * (1 - fx) + D[k] * fx) * fy); };
    const NC = L.tiles.nc || 1, c0 = cc == null ? (L.corn ? L.corn.ref : 0) : cc, c = Math.min(1, Math.max(0, c0 + ((L.corn ? L.corn.verm : 0) - c0) * Math.min(1, Math.max(0, verm)))) * (NC - 1);
    if (NC < 2) return set(0); const i0 = Math.min(NC - 2, Math.floor(c)), fc = c - i0, S0 = set(i0), S1 = set(i0 + 1);
    return S0.map((x, k) => x + (S1[k] - x) * fc); }
  const A = bl(0, 0); if (!oxy) return A; const B = bl(n, 0); return A.map((x, k) => x + (B[k] - x) * oxy);
}

// a person's skin from a c7-style hex: the nearest model colour at measured chroma (lightness kept, clamped to the measured adult
// range L* 28..75; hue pulled into skin's band), blood and melanin type at the NIST medians. For people with no preset.
export function skinFromHex(M, hex, { sex = 'f' } = {}) {
  const v = parseInt(hex.replace('#', ''), 16), s = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map(x => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  const Lt = Math.min(74, Math.max(28.5, rgbToLab(s)[0])), med = M.nist_fit.median;
  const p = { Cm: 0.05, beta: med.beta, Ch: med.Ch * (sex === 'm' ? 1.12 : 0.95), gamma: med.gamma, Cc: Math.max(0.2, med.Cc) };
  let lo = Math.log(0.002), hi = Math.log(0.6);
  for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; p.Cm = Math.exp(mid); const L = rgbToLab(skinRGB(M, p, true))[0]; if (L > Lt) lo = mid; else hi = mid; }
  return p;
}

// SKIN6 (rev 6, opt-in; skinFromHex above is unchanged): the person's skin from the cast's hex, fitted in ALL THREE CIELAB axes, not
// lightness alone. skinFromHex keeps the hex's L* and takes chroma and hue from the NIST medians, which on the light end gives
// a* 7.6 / b* 11 at L* 74 (C 13.5, h 56): pinker and greyer than every NIST subject that light (Cooksey et al. 2017: at L* 69-74
// b* 12.5-18.5, median 15; h 58-72) -- the "light skins pink-grey" of judge c10, measured. Here the hex's a* and b* are the target,
// held inside the envelope of the NIST subjects of similar lightness (their 10th-90th percentiles of a* and b* among the k nearest
// in L*), and the fit starts from those subjects' own fitted parameters and stays inside NIST's parameter range (melanin type
// 0.3-1, blood x0.6-1.8 of the median, carotene 0-1.6) with weak priors toward the median. Deep skins: the same rule (the hex's
// L* clamped to the calibrated adult range as before). Returns { ...p, fit: { target, lab, dE, envelope } }.
const _fit6 = new Map();
export function skinFromHex6(M, hex, { sex = 'f', k = 15, aWeight = 2, L: Lover = null } = {}) {   // aWeight: a* against b* in the fit (6: hue ~63 at the light end, C -0.7); L: SKIN7's lightness target (default: the hex's)
  const key = hex + '|' + sex + '|' + k + '|' + aWeight + (Lover == null ? '' : '|L' + Lover); if (_fit6.has(key)) { const c = _fit6.get(key); return { ...c, fit: { ...c.fit } }; }
  const v = parseInt(hex.replace('#', ''), 16), s = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map(x => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  const h = rgbToLab(s), Lt = Lover == null ? Math.min(74, Math.max(28.5, h[0])) : Lover, med = M.nist_fit.median, S = M.nist_fit.subjects || [];
  const near = S.map(q => ({ q, d: Math.abs(q.lab_meas[0] - Lt) })).sort((a, b) => a.d - b.d).slice(0, k).map(o => o.q);
  const pct = (a, f) => { const t = a.slice().sort((x, y) => x - y); return t[Math.min(t.length - 1, Math.max(0, Math.round(f * (t.length - 1))))]; };
  const env = near.length >= 5 ? { a: [pct(near.map(q => q.lab_meas[1]), 0.1), pct(near.map(q => q.lab_meas[1]), 0.9)], b: [pct(near.map(q => q.lab_meas[2]), 0.1), pct(near.map(q => q.lab_meas[2]), 0.9)] } : null;
  const T = [Lt, env ? Math.min(env.a[1], Math.max(env.a[0], h[1])) : h[1], env ? Math.min(env.b[1], Math.max(env.b[0], h[2])) : h[2]];
  const ChM = med.Ch * (sex === 'm' ? 1.12 : 0.95), lim = q => ({ ...q, beta: Math.min(1, Math.max(0.3, q.beta)), Ch: Math.min(ChM * 1.8, Math.max(ChM * 0.6, q.Ch)), Cc: Math.min(1.6, Math.max(0, q.Cc)), Cm: Math.min(0.6, Math.max(0.002, q.Cm)) });
  const lab = q => rgbToLab(skinRGB(M, q, true));
  // lightness is held exactly (a bisection on melanin inside every evaluation), so the search moves type, blood and carotene only
  const atL = q => { let lo = Math.log(0.002), hi = Math.log(0.6); const r = { ...q }; for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; r.Cm = Math.exp(mid); if (lab(r)[0] > T[0]) lo = mid; else hi = mid; } return r; };
  const AW = aWeight; const cost = q => { const c = lab(q); return AW * (c[1] - T[1]) ** 2 + (c[2] - T[2]) ** 2 + 0.6 * Math.log(q.Ch / ChM) ** 2 * 20 + 2 * (q.beta - med.beta) ** 2 + 0.3 * Math.log((q.Cc + 0.05) / (med.Cc + 0.05)) ** 2; };
  const starts = [{ Cm: 0.05, beta: med.beta, Ch: ChM, gamma: med.gamma, Cc: Math.max(0.2, med.Cc) }, ...near.slice(0, 3).map(q => ({ Cm: q.p[0], beta: q.p[1], Ch: q.p[2], gamma: med.gamma, Cc: q.p[4] }))];
  let best = null, bc = Infinity;
  for (const s0 of starts) { let p = atL(lim(s0)), c = cost(p);
    for (let it = 0; it < 40; it++) { const st = 0.25 * (1 - it / 40) + 0.02; let moved = false;
      for (const key of ['beta', 'Ch', 'Cc']) for (const d of [-1, 1]) { const q = { ...p }; if (key === 'beta') q.beta += d * st * 0.4; else if (key === 'Cc') q.Cc = Math.max(0, (q.Cc + 0.05) * Math.exp(d * st * 2) - 0.05); else q.Ch *= Math.exp(d * st);
        const r = atL(lim(q)), e = cost(r); if (e < c) { c = e; p = r; moved = true; } }
      if (!moved && st < 0.05) break; }
    if (c < bc) { bc = c; best = p; } }
  const L = lab(best), dE = Math.hypot(L[0] - T[0], L[1] - T[1], L[2] - T[2]);
  const r = { Cm: best.Cm, beta: best.beta, Ch: best.Ch, gamma: med.gamma, Cc: best.Cc, fit: { hex: h.map(x => +x.toFixed(1)), target: T.map(x => +x.toFixed(1)), lab: L.map(x => +x.toFixed(1)), dE: +dE.toFixed(2), envelope: env } };
  _fit6.set(key, r); return { ...r, fit: { ...r.fit } };
}

// SKIN7's photographic grade (skinFromHex7, gradeFor7, personLUT7 with lockBlood7, lipTint7, liftL, PHOTO_CHEEK; 8 Oct, rev 7 iterations 1-6) was superseded by
// SKIN OPTICS (optics.js: the colour from the layered model, no grade) and deleted when that landed (8 Oct ~21:00); git history keeps it.
