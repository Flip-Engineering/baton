// SKIN OPTICS (studio, 8 Oct 2026; SKIN7's lane rebuilt): the skin's light transport from ONE layered model, read by the engine and by Cycles.
//
//   import { loadSkinModel } from './skin_lut.js'; import { skinOptics, cyclesSkinRadius, FACE_OPTICS } from './optics.js';
//   const M = await loadSkinModel();
//   skinOptics(M, p)            // { albedo: [r,g,b] (linear, body reflectance), ld: [r,g,b] mm (diffuse mean free path per channel), spec: per-wavelength }
//   cyclesSkinRadius(M, p)      // [r,g,b] metres: what Cycles' 'Random Walk (Skin)' takes as Subsurface Radius x Scale (it reads the radius as 1 / sigma_tr)
//   fitFace(M, p, kFace)        // the person's melanin re-solved so the face (blood x kFace) keeps the cast hex's lightness
// Used by skin.js applySkin on skin rev 7 (SKIN OPTICS iterations 1 and 2, landed): see review/studio_human_c8/after/skin7/NOTES.md.
//
// THE MODEL. Skin is two layers (Donner and Jensen 2006, 'A spectral BSSRDF for shading human skin'; Jimenez et al. 2010, 'A practical appearance
// model for dynamic facial color'): a thin EPIDERMIS that only absorbs (melanin: volume fraction Cm, eumelanin share beta, the rest pheomelanin;
// carotene Cc; the bloodless baseline) over a DERMIS that scatters (reduced scattering mu_s'(lambda)) and absorbs by its blood (volume fraction Ch,
// oxygen saturation gamma: oxy- and deoxyhaemoglobin) and its baseline. Per wavelength (31 bands, 400-700 nm):
//   - the body reflectance R(lambda): skin_lut.js skinSpectrum (our calibrated two-layer model: fits all 100 NIST skin spectra, Cooksey et al.
//     2017, dE76 p50 0.5; deep-skin anchors to ITA -67): THE ALBEDO. Unchanged here; the photographic grade of SKIN7 rev 7 is NOT applied on this path.
//   - the dermis's transport: the calibration fixed the RATIO of absorption to scattering (that is all a reflectance spectrum can say), with mu_s'
//     at its upper bound; the ABSOLUTE scale comes from the measured scattering of skin, Jacques 2013 ('Optical properties of biological tissues:
//     a review', Phys Med Biol 58 R37, Table 2: dermis mu_s'(500 nm) = 43.6 cm^-1, f_Ray 0.41, b_Mie 0.562). So
//       mu_s'(l) = 43.6 [0.41 (l/500)^-4 + 0.59 (l/500)^-0.562] cm^-1,   mu_a(l) = mu_a,cal(l) * mu_s'(l) / mu_s',cal(l)
//     and the diffuse mean free path l_d(l) = 1 / sqrt(3 mu_a (mu_a + mu_s')) (the dipole's sigma_tr; Jensen et al. 2001).
//   - per RGB channel: the profile a camera channel sees is the mixture of the wavelengths' profiles weighted by what each returns (the channel's
//     colour weight x R(lambda)); its mean radius scales with l_d, so the channel's l_d is that weighted mean (Donner and Jensen 2006: per-wavelength
//     profiles, then to RGB). Melanin sits above the dermis: it darkens what returns, it does not shorten how far the light spreads; so the radius
//     depends on the blood (and the baseline), the albedo on everything.
// CHECK (literature, not a construction): Weyrich et al. 2006 ('Analysis of human faces using a measurement-based skin reflectance model', Table 1)
// measured sigma_tr in vivo on 149 faces with a fibre probe: cheek 0.557 / 0.975 / 1.549 mm^-1 (R / G / B), i.e. l_d 1.79 / 1.03 / 0.65 mm;
// forehead 1.84 / 1.02 / 0.65; neck 1.45 / 0.80 / 0.52; the extreme subjects l_d [1.09, 0.64, 0.60] and [2.81, 1.26, 0.66] mm.
//
// CYCLES. person_scene.py builds the skin as Principled 'Random Walk (Skin)'. Cycles (intern/cycles/kernel/closure/bssrdf.h, bssrdf_setup_radius)
// reads that method's radius as the DIFFUSE mean free path: it multiplies it by sqrt(3 (1 - alpha')) (alpha' from the albedo through Jensen's
// dipole inversion) to get 1 / sigma_t', and the random walk then uses sigma_t' = 1 / that (subsurface_random_walk.h). So the radius we pass IS l_d.
// Until now it was a hand number: (2.0, 0.85, 0.45) mm x sss 0.6 (skin rev >= 4) = (1.2, 0.51, 0.27) mm: red 0.67 of the measured faces', green
// 0.50, blue 0.42: the red light spread twice as far, relative to green and blue, as it does in a face (the orange in every shadow edge).
//
// FACE_OPTICS: the specular per face region, MEASURED (Weyrich et al. 2006 Figure 15, Torrance-Sparrow fitted per region and averaged over the 149
// subjects; read off the figure's ellipse centres): m = Beckmann roughness (rms slope), rho_s = the lobe's scale. Not used by iteration 1's render:
// the next change (the specular by region) reads it.

export const JACQUES13 = { dermis: { a: 43.6, fRay: 0.41, bMie: 0.562 }, epidermis: { a: 66.7, fRay: 0.29, bMie: 0.689 }, g: 0.9 };
export const WEYRICH06 = {
  ld: { cheek: [1 / 0.5572, 1 / 0.9751, 1 / 1.5494], forehead: [1 / 0.5443, 1 / 0.9831, 1 / 1.5499], neck: [1 / 0.6911, 1 / 1.2488, 1 / 1.9159], min: [1.0904, 0.6376, 0.6035], max: [2.8106, 1.2607, 0.6590] },
  // Figure 15: region -> [m, rho_s] (the face-region numbering of the figure in brackets)
  ts: { upperLip: [0.305, 0.248] /* (1) moustache */, forehead: [0.270, 0.275] /* (2) */, brows: [0.280, 0.295] /* (3) */, lids: [0.262, 0.290] /* (4) */,
    nose: [0.235, 0.305] /* (6): the smallest m (no fine wrinkles) and the highest rho_s (sebum) */, cheek: [0.272, 0.235] /* (7) */, lips: [0.290, 0.290] /* (8): the widest spread */,
    chin: [0.290, 0.225] /* (9) */, jaw: [0.285, 0.205] /* (10) beard area */ },
};
export const FACE_OPTICS = WEYRICH06.ts;

import { skinRGB, rgbToLab } from './skin_lut.js';
const musp = (q, l) => q.a * (q.fRay * (l / 500) ** -4 + (1 - q.fRay) * (l / 500) ** -q.bMie);

// the dermis's per-wavelength absorption and scattering (cm^-1) and the body reflectance, for the person p = { Cm, beta, Ch, gamma, Cc }
export function layerSpectra(M, p) {
  const { mu, global: g, Fdr, wl } = M, n = wl.length, { Cm, beta, Ch, gamma, Cc = 0 } = p;
  const R = new Float64Array(n), muaD = new Float64Array(n), muspD = new Float64Array(n), ld = new Float64Array(n), muaE = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const l = wl[i], x = l / 500;
    const muM = Cm * (beta * mu.eu[i] + (1 - beta) * mu.pheo[i]), mE = muM + (1 - Cm) * mu.base[i] + Cc * mu.car[i];
    const t2 = Math.exp(-4 * mE * g.d_mm * 0.1);
    const mD = Ch * (gamma * mu.oxy[i] + (1 - gamma) * mu.deoxy[i]) + (1 - Ch) * mu.base[i] + g.carDermis * Cc * mu.car[i];
    const msCal = g.mus_a * (g.mus_fRay * x ** -4 + (1 - g.mus_fRay) * x ** -g.mus_bMie);
    const al = msCal / (msCal + mD), s = Math.sqrt(3 * (1 - al)), Rd = al / 2 * (1 + Math.exp(-4 / 3 * s)) * Math.exp(-s);
    const rsc = Math.min(0.3, Math.max(0, g.ksc * x ** -g.psc)) * Math.exp(-4 * g.phi * muM * g.d_mm * 0.1);
    R[i] = rsc + (1 - rsc) ** 2 * t2 * Rd * (1 - Fdr) / (1 - Fdr * t2 * Rd);   // = skinSpectrum(M, p) (no surface term)
    const ms = musp(JACQUES13.dermis, l), ma = mD * ms / msCal;                    // the calibrated ratio at Jacques's absolute scale
    muaD[i] = ma; muspD[i] = ms; muaE[i] = mE; ld[i] = 10 / Math.sqrt(3 * ma * (ma + ms));   // mm
  }
  return { wl, R, muaD, muspD, muaE, ld };
}

// per channel: the albedo (linear Rec.709, the model's white) and the diffuse mean free path (mm), the energy-weighted mean of the wavelengths'
export function skinOptics(M, p) {
  const S = layerSpectra(M, p), W = M.spec2rgb, albedo = [0, 0, 0], ld = [0, 0, 0];
  for (let k = 0; k < 3; k++) { let e = 0, el = 0; for (let i = 0; i < S.R.length; i++) { albedo[k] += W[k][i] * S.R[i]; const w = Math.max(0, W[k][i]) * S.R[i]; e += w; el += w * S.ld[i]; } ld[k] = el / Math.max(e, 1e-12); }
  return { albedo, ld, spec: S };
}

// Cycles 'Random Walk (Skin)': Subsurface Radius (x Scale) = l_d per channel, metres
export function cyclesSkinRadius(M, p) { return skinOptics(M, p).ld.map(x => x / 1000); }

// THE ANATOMY OF THE BLOOD (the layer parameters by region; iteration 1 carries the face's perfusion and the covered body's):
// the person's own parameters are fitted to the cast colour inside NIST's envelope, and NIST's spectra are of the ARM (covered skin). The face's
// dermis holds more blood than the arm's (the denser superficial plexus of the face: its erythema and its warmth; Jimenez et al. 2010 map the
// haemoglobin of faces highest on the cheeks, nose, lips and ears). How much: the model's own transport says it. Weyrich's measured faces have a red
// l_d of 1.79-1.84 mm; the arm's parameters give 2.16 mm and the same person at x2 blood 1.77 mm (blood is what shortens it): FACE_BLOOD 2. The same
// x2 turns the arm's hue 62 deg to 52 (a* 8.9 -> 11.7): the colour a face has before a camera. The covered body stays at the arm's (x1 = 1 / FACE_BLOOD
// of the face's table); the hands, fingers and feet run warmer (the hands' arteriovenous anastomoses and the fingertips' dense capillaries; the
// feet's venous pooling when standing): x1.3 / x1.4 / x1.2 of the arm. The face's own map on top is SKIN4's, measured on ten HSRD-100 scans in
// pigment space (zones4.js: nose tip x1.45-1.6, alae, ears x1.3-1.5, the under-eye x1.5-1.8 with a deoxygenated share, the lids, the vermilion x3.8).
export const FACE_BLOOD = 2.0;
export const BODY_BLOOD = { torso: 1, pelvis: 1, uarm: 1, farm: 1, thigh: 1, shin: 1, hand: 1.3, finger: 1.4, foot: 1.2 };

// THE PERSON'S PIGMENTS FROM PHYSIOLOGY (SKIN OPTICS iteration 2 `chem`, landed 8 Oct ~22:05: skin rev 7's only inversion of the cast hex). A reflectance cannot tell the melanin's TYPE from
// its amount, its blood or its carotene (the inverse is degenerate: the calibration's own fits of NIST's 100 spectra spread the eumelanin share over
// 0.30-0.92 and the carotene over 0-6). skinFromHex6 resolves that degeneracy with the cast hex's hue, so a paint-chip hue was carried by the
// melanin's chemistry: every cast person sat on the fit's corners (L22, L05, L08, L21: eumelanin share 0.30, its lower bound, i.e. 70 % pheomelanin;
// L08, L03, L12: carotene 1.6-1.8, twelve times the population's; L03: melanin 0.0015, the floor). Consequences on the render: every per-texel melanin
// field (the zones, the 4-10 mm mottle, the grain) swung the HUE of a deep skin (pheomelanin's steep lambda^-4.75 absorption: less of it is orange,
// more of it brown-red): the orange-rust patchwork on L22 and L05; and the light skins' colour was carotene's (a sallow grey-yellow, L03 hue 52-58)
// with no melanin to give it warmth or structure.
// Chemistry fixes the type: Del Bino et al. 2015 ('Chemical analysis of constitutive pigmentation of human epidermis reveals constant eumelanin to
// pheomelanin ratio', Pigment Cell Melanoma Res 28:707) measured the epidermis of every constitutive colour, very light to dark, by HPLC: ~74 %
// eumelanin and ~26 % pheomelanin whatever the skin; what differs between people is the AMOUNT. Carotene is diet's, a small term in every skin
// (Stephen et al. 2009 raise it by a perceptible step only with large dietary changes): the calibration's median (M.nist_fit.median.Cc). So the
// person is inverted for what does differ: the melanin amount (the cast's lightness), the blood and its oxygenation (the cast's undertone, held
// inside NIST's envelope at that lightness as skinFromHex6 holds it). CHECK, not construction: with the type at 0.74 and the carotene at the median
// the model still reaches NIST's 100 MEASURED skin colours (free: Cm, Ch, gamma): dE76 p50 0.12, p90 1.4 (labs/human8/_skinopt_scratch/beta_nist.mjs);
// the measured colours never needed the corners, the cast hexes did.
export const EU_SHARE = 0.74;
export function pigmentsFromHex(M, hex, { sex = 'f', k = 15, aWeight = 2 } = {}) {
  const v = parseInt(hex.replace('#', ''), 16), s = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map(x => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  const h = rgbToLab(s), Lt = Math.min(74, Math.max(28.5, h[0])), med = M.nist_fit.median, S = M.nist_fit.subjects || [];
  // the target as skinFromHex6 takes it: the hex's lightness (the calibrated adult range), its a* and b* held inside the NIST subjects' 10th-90th percentiles at that lightness
  const near = S.map(q => ({ q, d: Math.abs(q.lab_meas[0] - Lt) })).sort((a, b) => a.d - b.d).slice(0, k).map(o => o.q);
  const pct = (a, f) => { const t = a.slice().sort((x, y) => x - y); return t[Math.min(t.length - 1, Math.max(0, Math.round(f * (t.length - 1))))]; };
  const env = near.length >= 5 ? { a: [pct(near.map(q => q.lab_meas[1]), 0.1), pct(near.map(q => q.lab_meas[1]), 0.9)], b: [pct(near.map(q => q.lab_meas[2]), 0.1), pct(near.map(q => q.lab_meas[2]), 0.9)] } : null;
  const T = [Lt, env ? Math.min(env.a[1], Math.max(env.a[0], h[1])) : h[1], env ? Math.min(env.b[1], Math.max(env.b[0], h[2])) : h[2]];
  const ChM = med.Ch * (sex === 'm' ? 1.12 : 0.95), lab = q => rgbToLab(skinRGB(M, q, true));
  // bounds: the blood inside NIST's fitted range (x0.6-1.8 of the median, as skinFromHex6); the dermis's oxygen saturation inside the MEASURED population's: the
  // 10th-90th percentiles of the calibration's own fits of NIST's 100 subjects (0.46-0.76, median 0.63; it2 c2: the 0.45-0.85 band let every cast hex run to 0.85,
  // a corner beyond NIST's 90th percentile, the paint chip's red carried by oxygenation)
  const gs = S.map(q => q.p[3]).filter(Number.isFinite), gLo = gs.length >= 10 ? pct(gs, 0.1) : 0.46, gHi = gs.length >= 10 ? pct(gs, 0.9) : 0.76;
  const lim = q => ({ ...q, Ch: Math.min(ChM * 1.8, Math.max(ChM * 0.6, q.Ch)), gamma: Math.min(gHi, Math.max(gLo, q.gamma)) });
  const atL = q => { let lo = Math.log(0.001), hi = Math.log(0.75); const r = { ...q }; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; r.Cm = Math.exp(m); if (lab(r)[0] > T[0]) lo = m; else hi = m; } return r; };
  const cost = q => { const c = lab(q); return aWeight * (c[1] - T[1]) ** 2 + (c[2] - T[2]) ** 2 + 12 * Math.log(q.Ch / ChM) ** 2 + 20 * (q.gamma - med.gamma) ** 2; };
  let p = atL({ Cm: 0.05, beta: EU_SHARE, Ch: ChM, gamma: med.gamma, Cc: med.Cc }), c = cost(p);
  for (let it = 0; it < 40; it++) { const st = 0.25 * (1 - it / 40) + 0.02; let moved = false;
    for (const key of ['Ch', 'gamma']) for (const d of [-1, 1]) { const q = { ...p }; if (key === 'Ch') q.Ch *= Math.exp(d * st); else q.gamma += d * st * 0.3;
      const r = atL(lim(q)), e = cost(r); if (e < c) { c = e; p = r; moved = true; } }
    if (!moved && st < 0.05) break; }
  const L = lab(p);
  return { Cm: p.Cm, beta: EU_SHARE, Ch: p.Ch, gamma: p.gamma, Cc: med.Cc, fit: { hex: h.map(x => +x.toFixed(1)), target: T.map(x => +x.toFixed(1)), lab: L.map(x => +x.toFixed(1)), dE: +Math.hypot(L[0] - T[0], L[1] - T[1], L[2] - T[2]).toFixed(2), envelope: env, chem: 'Del Bino 2015 eumelanin share; carotene at the median' } };
}

// the cast colour is the FACE's: the person's melanin re-solved so the face (its blood x kFace, its own corneum: corn, iteration 10, tissue.js CORNEUM) keeps the
// lightness the fit gave the cast hex (the surface term included, as the fit's); the arm and the covered body (blood x1, the forearm's corneum, and the sun term's
// lower melanin) come out lighter and yellower than the face
export function fitFace(M, p, kFace, corn = 1) {
  if (kFace === 1 && corn === 1) return { ...p };
  const Lt = rgbToLab(skinRGB(M, p, true))[0], q = { ...p, Ch: p.Ch * kFace, ...(corn !== 1 ? { corn } : {}) };
  let lo = Math.log(0.0015), hi = Math.log(0.75);
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; q.Cm = Math.exp(m); if (rgbToLab(skinRGB(M, q, true))[0] > Lt) lo = m; else hi = m; }
  return { ...p, Cm: Math.exp((lo + hi) / 2) };
}
