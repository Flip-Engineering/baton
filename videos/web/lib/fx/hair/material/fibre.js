// HAIRMAT (round 7, 8 Oct): the HAIR FIBRE MODEL. What one hair fibre is, per person, from the cast and the literature; the one source both
// renderers read (Cycles through videos/blender/hairmat7.py, which applies these parameters to every render fibre; the engine's strand
// shader from iteration 2). Pure math: no three.js, no DOM (node and the browser alike).
//
//   import { fibreModel } from '../lib/fx/hair/material/fibre.js';
//   const F = fibreModel({ sex: 'f', age: 24, group: 'hispanic', melanin: { eu: 1.8, ph: 0.04 }, grey: 0, form: 'curly' });
//   F.cycles  -> the Principled Hair BSDF (Chiang) settings and the per-fibre / along-the-length laws hairmat7.py applies
//   F.engine  -> Marschner's lobes as two shifted specular lobes + TT (Scheuermann 2004's practical form), for the real-time shader
//
// THE MODEL. A fibre is a dielectric cylinder (keratin, eta 1.55) whose cuticle scales tilt ~3 deg toward the tip, absorbing by its
// melanins. Light leaves it as R (surface reflection: white, shifted toward the root by 2 alpha), TT (two refractions: coloured by the
// absorption along the chord, forward: the backlit glow) and TRT (one internal reflection: coloured, shifted toward the tip by ~3-4 alpha:
// the secondary highlight) (Marschner, Jensen, Cammarano, Worley, Hanrahan 2003). Energy-conserving form: d'Eon, Francois, Hill, Letteri,
// Aubry 2011. Practical parametrisation (melanin concentrations, longitudinal roughness beta_m, azimuthal roughness beta_n, the colour of a
// dense volume): Chiang, Bitterli, Tappan, Burley 2016 = Blender's Principled Hair BSDF (Chiang). A MASS of fibres scatters light among them
// (Zinke, Yuksel, Weber, Keyser 2008): in Cycles that is path tracing through real fibres, so the fibre DIAMETER and the fibre COUNT (the
// scalp density) are part of the material: a dense dark mass is black in its cores only if it is dense.
// The photographs check the result; they never set these numbers.

const DEG = Math.PI / 180;

// ---- optics of keratin and the cuticle (Marschner et al. 2003; Robbins, Chemical and Physical Behavior of Human Hair, 5th ed. 2012)
export const ETA = 1.55;                 // keratin's refractive index (Marschner 2003)
export const ALPHA_DEG = 3;              // cuticle scale tilt: Marschner's alpha_R of -5..-10 deg = -2 alpha; Robbins: ~3 deg
export const BETA_R_ROOT_DEG = 6;        // longitudinal width of R on an intact cuticle (Marschner 2003 Table 1: 5-10 deg)
export const BETA_R_TIP_DEG = 9;         // ... at weathered lengths (the cuticle lifts and erodes toward the ends: Robbins 2012)
export const BETA_N = 0.30;              // azimuthal roughness (Chiang 2016; pbrt-v3's default)
// Cycles' (Chiang's) melanin absorption per unit fibre radius: sigma_a = eu * EU + ph * PH (the Cycles kernel's coefficients; HAIR5 found
// them: shade.js EU5 / PH5). The cast's { eu, ph } (person/v2.js V2_HAIR) are in these units.
export const EU = [0.506, 0.841, 1.653], PH = [0.343, 0.733, 1.924];
// an unpigmented (grey / white) fibre: almost no melanin; keratin itself absorbs faintly in the blue (the yellowish white of white hair)
export const WHITE_FIBRE = { eu: 0.010, ph: 0.020 };   // Tobin & Paus 2001 (greying = fibres without pigment, not paler fibres)

// ---- the fibre by ancestry (equal-area diameter um, cross-section ellipticity major/minor, terminal density per cm2, growth cm/month)
// Diameters: Caucasian scalp 69.6 um (J Soc Cosmet Chem cross-sections; Franbourg et al. 2003, JAAD 48:S115: Asian largest and roundest,
// African most elliptical); Mexican women 77.5-81.5 um; Japanese ~20 um larger than Caucasian on both axes. Ellipticity: Asian 1.16-1.3,
// European 1.35-1.5, African 1.6-1.9. Density: Asian 175, African 161, Caucasian 226 / cm2 (Sperling 1999 / Loussouarn 2001 as tabulated);
// Hispanic 169-178 (a 2017 New York trichoscopy study). Growth: African 256 um/day, Caucasian 396 (Loussouarn 2001, Br J Dermatol 145:294),
// Asian ~411 (Loussouarn et al. 2016, Eur J Dermatol 26:144). Rows marked * have no direct measurement in these sources: interpolated.
export const ANCESTRY = {
  african:     { d: 75, ell: 1.75, dens: 161, growth: 0.78 },
  east_asian:  { d: 88, ell: 1.20, dens: 175, growth: 1.25 },
  european:    { d: 70, ell: 1.40, dens: 226, growth: 1.20 },
  hispanic:    { d: 80, ell: 1.40, dens: 174, growth: 1.22 },
  south_asian: { d: 78, ell: 1.44, dens: 200, growth: 1.20 },   // * diameter / ellipticity of Indian hair 1.44; density interpolated
  mena:        { d: 75, ell: 1.40, dens: 210, growth: 1.20 },   // *
  indigenous:  { d: 85, ell: 1.20, dens: 175, growth: 1.25 },   // * as East Asian
};
const GROUP = { black: 'african', african: 'african', asian: 'east_asian', east_asian: 'east_asian', white: 'european', european: 'european',
  hispanic: 'hispanic', latino: 'hispanic', south_asian: 'south_asian', indian: 'south_asian', mena: 'mena', indigenous: 'indigenous' };
const RACES = { african: 'african', asian: 'east_asian', caucasian: 'european' };   // the cast's params.races fractions (makehuman's three)

// ---- along the length: the fibre's age (s / growth) weathers it: photo-oxidation of melanin lightens the lengths (Nogueira & Joekes 2004,
// J Photochem Photobiol B 74:109; Hoting, Zimmermann, Hilterhaus-Bong 1995, J Soc Cosmet Chem 46:181), and the cuticle roughens. One law:
// w(t) = 1 - exp(-t / TAU); eu(s) = eu_root (1 - B w), beta(s) = beta_root + (beta_tip - beta_root) w. B is a PARAMETER (the magnitude of
// sun lightening is not measured here: 0.25 for most of the cast, 0.40 outdoors); the evidence on which melanin bleaches faster is mixed, so
// both scale together (the redness ratio is kept).
export const TAU_MONTHS = 24, BLEACH = { indoor: 0.25, outdoor: 0.40 };
// ---- the shaft: constant diameter (+-10 % fibre to fibre); a CUT end tapers over its last ~4 mm to ~0.6 (most adults' hair is cut); a
// share of fibres that are new growth since the last cut (a PARAMETER, ~0.15) keeps its natural point: ~10 mm to ~0.25 (Robbins 2012)
export const SHAFT = { sd: 0.10, cut: { mm: 4, k: 0.6 }, natural: { mm: 10, k: 0.25, share: 0.15 } };
// strand to strand: pigment lognormal sd (a parameter: real heads are visibly multi-tonal), roughness sd
export const SPREAD = { mel: 0.15, rough: 0.08 };
// a beard fibre is thicker than a scalp fibre (125.6 vs 69.6 um in the same Caucasian subjects: J Soc Cosmet Chem)
export const BEARD_D = 1.8;

// ---- conversions (Chiang 2016 / pbrt-v3 / the Cycles kernel)
// Cycles' Roughness r -> the longitudinal standard deviation (rad): sqrt(v) = 0.726 r + 0.812 r^2 + 3.7 r^20
export const betaOfRough = r => 0.726 * r + 0.812 * r * r + 3.7 * Math.pow(r, 20);
export function roughOfBeta(beta) {   // the inverse, by bisection (monotone on [0, 1])
  let lo = 0, hi = 1; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (betaOfRough(m) < beta) lo = m; else hi = m; } return (lo + hi) / 2;
}
// Cycles' Melanin input m (0..1) <-> the concentration q = eu + ph (Cycles: q = -log(1 - m), eu = q (1 - redness), ph = q redness)
export const melOfQ = q => 1 - Math.exp(-q), qOfMel = m => -Math.log(Math.max(1 - m, 1e-4));
export const sigmaA = (eu, ph = 0) => EU.map((e, i) => eu * e + ph * PH[i]);
// the colour of a dense, multiply scattering volume of these fibres (Chiang 2016 sec. 4.4: c = exp(-sqrt(sigma_a) K(beta_n)), the inverse of
// Cycles' 'Direct coloring'); linear RGB
export const chiangK = (b = BETA_N) => (((((0.245 * b) + 5.574) * b - 10.73) * b + 2.532) * b - 0.215) * b + 5.969;
export const massAlbedo = (eu, ph = 0, b = BETA_N) => sigmaA(eu, ph).map(s => Math.exp(-Math.sqrt(Math.max(0, s)) * chiangK(b)));
// one fibre's transmittance, TT's colour: the refracted chord 2 cos(gamma_t) (radii; gamma_t = asin(h / eta)) averaged over the offset h
// at normal incidence (Chiang 2016's path length at theta = 0): ~1.86 radii for eta 1.55
export const CHORD = (() => { let s = 0; const n = 400; for (let i = 0; i < n; i++) { const h = (i + 0.5) / n; s += 2 * Math.cos(Math.asin(h / ETA)); } return s / n; })();
export const fibreT = (eu, ph = 0, l = CHORD) => sigmaA(eu, ph).map(s => Math.exp(-s * l));
// the bleach and weathering laws (s in metres from the root)
export const weatherAt = (s, growthCmPerMonth, tau = TAU_MONTHS) => 1 - Math.exp(-(s * 100 / growthCmPerMonth) / tau);

function ancestryOf(cast) {
  const races = cast.races || cast.params?.races;
  if (races && Object.keys(races).some(k => RACES[k])) {
    const w = Object.entries(races).filter(([k]) => RACES[k]), t = w.reduce((a, [, v]) => a + v, 0) || 1, out = { d: 0, ell: 0, dens: 0, growth: 0 };
    for (const [k, v] of w) for (const q of Object.keys(out)) out[q] += ANCESTRY[RACES[k]][q] * v / t;
    // a 'hispanic' cast with makehuman's three fractions: the measured Hispanic row is the better prior for the fibre (diameter, density)
    const g = GROUP[String(cast.group || '').toLowerCase()];
    if (g && g !== 'european' && g !== 'african' && g !== 'east_asian') { const G = ANCESTRY[g]; for (const q of Object.keys(out)) out[q] = 0.5 * out[q] + 0.5 * G[q]; }
    return { key: 'races', ...out };
  }
  const g = GROUP[String(cast.group || '').toLowerCase()] || 'european';
  return { key: g, ...ANCESTRY[g] };
}

// the person's fibre. cast: { sex, age, group, races?, melanin: { eu, ph }, grey, form, occupation?, outdoor? }
export function fibreModel(cast = {}) {
  const A = ancestryOf(cast), age = cast.age ?? 30, mel = cast.melanin || { eu: 1.0, ph: 0.04 }, grey = Math.max(0, Math.min(1, cast.grey ?? 0));
  // density falls with age (Birch, Messenger, Messenger 2001, Br J Dermatol 144:297): ~0.6 % a year past 35 (a modest slope)
  const dens = A.dens * (1 - 0.006 * Math.max(0, age - 35));
  const outdoor = cast.outdoor ?? /outdoor|farm|field|construct|yard/i.test(cast.occupation || '');
  const B = outdoor ? BLEACH.outdoor : BLEACH.indoor;
  const rRoot = roughOfBeta(BETA_R_ROOT_DEG * DEG), rTip = roughOfBeta(BETA_R_TIP_DEG * DEG);
  const q = mel.eu + mel.ph, F = {
    rev: 1, cast: { group: cast.group || null, ancestry: A.key, age, sex: cast.sex || null, form: cast.form || null, melanin: mel, grey },
    pigment: { eu: mel.eu, ph: mel.ph, q, redness: q > 0 ? mel.ph / q : 0, cyclesMelanin: melOfQ(q), grey, white: WHITE_FIBRE, spread: SPREAD.mel,
      massAlbedo: massAlbedo(mel.eu, mel.ph), fibreT: fibreT(mel.eu, mel.ph) },
    optics: { eta: ETA, alphaDeg: ALPHA_DEG, betaRootDeg: BETA_R_ROOT_DEG, betaTipDeg: BETA_R_TIP_DEG, betaN: BETA_N, roughRoot: rRoot, roughTip: rTip, spread: SPREAD.rough },
    shaft: { dUm: A.d, ell: A.ell, sd: SHAFT.sd, cut: SHAFT.cut, natural: SHAFT.natural, beardK: BEARD_D },
    density: { perCm2: dens, growthCmPerMonth: A.growth },
    weather: { tauMonths: TAU_MONTHS, bleach: B, outdoor: !!outdoor },
  };
  // the engine's lobes (lib/fx/hair/material/engine.js): Marschner 2003's longitudinal shifts and widths, Chiang 2016's azimuthal
  // distributions integrated over the fibre's offset h (a pixel sees many fibres: the far field), the attenuations A_p of this pigment
  F.engine = engineLobes(F);
  F.cycles = { model: 'CHIANG', parametrization: 'MELANIN', ior: ETA, offsetRad: ALPHA_DEG * DEG, radialRoughness: BETA_N, coat: 0,
    roughRoot: rRoot, roughTip: rTip, randomColor: 0, randomRoughness: 0,   // the variation is per fibre in the attributes, not Cycles' random
    attrs: { melanin: 'hm_mel', redness: 'hm_red', roughness: 'hm_rough' } };
  return F;
}
const fresnel0 = eta => ((eta - 1) / (eta + 1)) ** 2;

// ---- the ENGINE's form of the same fibre (no tuned numbers: every quantity below follows from the fibre model above)
// Longitudinal (Marschner et al. 2003): Gaussians in theta_h = (theta_i + theta_o) / 2, centred on the cuticle shifts alpha_R = -2 alpha
// (toward the root), alpha_TT = alpha, alpha_TRT = 3 alpha; widths beta_R, beta_R / 2, 2 beta_R (Chiang et al. 2016: v_TT = v / 4,
// v_TRT = 4 v); beta along the length from the weathering law (6 deg at the root to 9 deg at weathered ends).
// Azimuthal (Chiang et al. 2016 sec. 4.2 / pbrt-v3 HairBSDF): each lobe p leaves the fibre at Phi(p, h) = 2 p gamma_t - 2 gamma_o + p pi,
// spread by a trimmed logistic of scale s(beta_n); attenuated by A_0 = f, A_1 = (1 - f)^2 T, A_2 = (1 - f)^2 f T^2 (f the dielectric
// Fresnel term at cos(gamma_o), T = exp(-sigma_a 2 cos(gamma_t)), sigma_a per unit radius in Cycles' melanin units). A pixel of hair holds
// many fibres at every offset, so the engine needs the FAR FIELD Psi_p(phi) = 1/2 int A_p(h) D_p(phi - Phi(p, h)) dh, tabulated here on
// [0, pi] (symmetric) at theta = 0 for TT and TRT; R has Marschner's closed form 1/4 cos(phi / 2) f(cos(phi / 2)) (smooth fibre).
// rho_p = int Psi_p dphi = 1/2 int A_p dh: the share of light each lobe carries, for the environment (an isotropic room lights all phi).
export const fresnelD = (ci, eta = ETA) => { ci = Math.min(1, Math.max(0, ci)); const s2 = (1 - ci * ci) / (eta * eta); if (s2 >= 1) return 1; const ct = Math.sqrt(1 - s2), rs = (ci - eta * ct) / (ci + eta * ct), rp = (eta * ci - ct) / (eta * ci + ct); return 0.5 * (rs * rs + rp * rp); };
export const logisticS = bn => Math.sqrt(Math.PI / 8) * (0.265 * bn + 1.194 * bn * bn + 5.372 * Math.pow(bn, 22));   // Chiang 2016 eq. (pbrt-v3)
const logistic = (x, s) => { x = Math.abs(x); const e = Math.exp(-x / s); return e / (s * (1 + e) * (1 + e)); };
const logisticCDF = (x, s) => 1 / (1 + Math.exp(-x / s));
const trimmedLogistic = (x, s) => logistic(x, s) / (logisticCDF(Math.PI, s) - logisticCDF(-Math.PI, s));
const wrapPi = x => { while (x > Math.PI) x -= 2 * Math.PI; while (x < -Math.PI) x += 2 * Math.PI; return x; };
export const ENGINE_TAB = 32;   // phi samples on [0, pi]
export function farField(sig, { eta = ETA, bn = BETA_N, n = ENGINE_TAB, nh = 400 } = {}) {
  const s = logisticS(bn), tab = { TT: Array.from({ length: n }, () => [0, 0, 0]), TRT: Array.from({ length: n }, () => [0, 0, 0]) }, rho = { R: 0, TT: [0, 0, 0], TRT: [0, 0, 0] };
  for (let j = 0; j < nh; j++) {
    const h = -1 + (j + 0.5) * 2 / nh, dh = 2 / nh, go = Math.asin(h), gt = Math.asin(h / eta), f = fresnelD(Math.cos(go), eta);
    const T = sig.map(x => Math.exp(-x * 2 * Math.cos(gt))), A1 = T.map(t => (1 - f) * (1 - f) * t), A2 = T.map(t => (1 - f) * (1 - f) * f * t * t);
    rho.R += 0.5 * f * dh; for (let c = 0; c < 3; c++) { rho.TT[c] += 0.5 * A1[c] * dh; rho.TRT[c] += 0.5 * A2[c] * dh; }
    const P1 = 2 * gt - 2 * go + Math.PI, P2 = 4 * gt - 2 * go + 2 * Math.PI;
    for (let k = 0; k < n; k++) { const phi = Math.PI * k / (n - 1), d1 = trimmedLogistic(wrapPi(phi - P1), s), d2 = trimmedLogistic(wrapPi(phi - P2), s);
      for (let c = 0; c < 3; c++) { tab.TT[k][c] += 0.5 * A1[c] * d1 * dh; tab.TRT[k][c] += 0.5 * A2[c] * d2 * dh; } }
  }
  return { tab, rho, s };
}
export function engineLobes(F) {
  const a = F.optics.alphaDeg * DEG, pg = F.pigment, sig = sigmaA(pg.eu, pg.ph), sigW = sigmaA(pg.white.eu, pg.white.ph);
  const P = farField(sig), W = farField(sigW);
  return { rev: 1, shiftRad: { R: -2 * a, TT: a, TRT: 3 * a }, betaRad: { root: F.optics.betaRootDeg * DEG, tip: F.optics.betaTipDeg * DEG, TT: 0.5, TRT: 2 },
    eta: ETA, betaN: F.optics.betaN, logisticS: P.s, K: chiangK(F.optics.betaN), chord: CHORD,
    sigma: sig, sigmaWhite: sigW, grey: pg.grey, spread: { mel: pg.spread, rough: F.optics.spread },
    weather: { bleach: F.weather.bleach, tauMonths: F.weather.tauMonths, growthCmPerMonth: F.density.growthCmPerMonth },
    rho: { R: P.rho.R, TT: P.rho.TT, TRT: P.rho.TRT, TTw: W.rho.TT, TRTw: W.rho.TRT },
    tab: { n: ENGINE_TAB, TT: P.tab.TT, TRT: P.tab.TRT, TTw: W.tab.TT, TRTw: W.tab.TRT },
    mass: massAlbedo(pg.eu, pg.ph, F.optics.betaN), massWhite: massAlbedo(pg.white.eu, pg.white.ph, F.optics.betaN) };
}

// the per-part fibre (scalp, beard): the beard's thicker shaft, its own pigment (export.js's beard melanin) and grey
export function partFibre(F, part, mel = null, grey = null) {
  const out = JSON.parse(JSON.stringify(F)); out.part = part;
  if (mel) { const q = mel.eu + mel.ph; Object.assign(out.pigment, { eu: mel.eu, ph: mel.ph, q, redness: q > 0 ? mel.ph / q : 0, cyclesMelanin: melOfQ(q), massAlbedo: massAlbedo(mel.eu, mel.ph), fibreT: fibreT(mel.eu, mel.ph) }); }
  if (grey != null) out.pigment.grey = grey;
  if (part === 'beard') out.shaft.dUm = F.shaft.dUm * BEARD_D;
  return out;
}
