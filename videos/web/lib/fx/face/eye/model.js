// EYES (round 7 studio, 8 Oct): the eye's anatomy and optics as numbers and functions, for the engine and for Cycles alike. No three.js,
// no drawing: pure functions of the person (age, sex, iris melanin, skin) and of the scene's light. lib/fx/face/eye/iris.js and sclera.js
// grow the maps from these; videos/blender/eye7_cycles.py builds the Cycles eye from the record index.js writes.
//
// Sources (the numbers are the literature's; where a value is a modelling choice it says so):
//   globe        axial length 23.5-24 mm (Bekerman, Gottlieb, Vaughan 2014, J Ophthalmol 2014:503645): sclera radius 12 mm
//   cornea       anterior radius 7.8 mm (Gullstrand's schematic eye); white-to-white 11.7 +- 0.5 mm (Rufer, Schroder, Erb 2005, Cornea 24:259),
//                ~0.9 mm less vertically (the sclera overlaps the cornea above and below); keratometric index 1.3375 (the single-surface
//                equivalent of the cornea's two surfaces; its Fresnel F0 2.1 % is the tear film's, n 1.336)
//   chamber      anterior chamber depth (corneal apex to lens) ~3.25 mm at 25, shallowing ~0.011 mm a year (Fontana and Brubaker 1980,
//                Arch Ophthalmol 98:1803); the iris a shallow cone from the pupil margin (on the lens) back to its root at the scleral spur
//   iris         stroma ~0.4 mm, anterior border layer ~15-20 um (Imesch, Wallow, Albert 1997, Surv Ophthalmol 41 S2:S117); the collarette at
//                about a third of the way from the pupil margin to the root; crypts, furrows, the pupillary ruff (Sturm and Larsson 2009,
//                Pigment Cell Melanoma Res 22:544; Larsson and Pedersen 2004, Mol Vis 10:821; Edwards et al. 2016, R Soc Open Sci 3:150424)
//   iris colour  (EYE7_VERSION 9) the melanin in its GRANULES: eumelanin's measured complex index (Stavenga, Leertouwer, Osorio, Wilts 2015,
//                Light Sci Appl 4:e243), Mie per granule (Bohren and Huffman 1983); melanosome number per superficial melanocyte by colour
//                (Imesch et al. 1996, Arch Ophthalmol 114:443; Wilkerson et al. 1996, 114:437), eu : pheo by colour (Peles et al. 2009, J Phys
//                Chem B 113:11346; Prota et al. 1998, Exp Eye Res 67:293); see "iris optics" below. (EYE7_VERSION 10) the melanin's MEASURED
//                amount (Prota et al. 1998 via Lam and Baranoski 2006, Comput Graph Forum 25:359), granule density (Glickman et al. 2001),
//                the stroma's blood (Lam and Baranoski 2006), the border layer's fibroblasts by Mie; the layers in Cycles as a coat over a
//                random-walk stroma (Cycles 5.x's van de Hulst relation, d'Eon's Hitchhiker's Guide eq. 53.7, inverted). (EYE7_VERSION 11) the
//                melanins' MEASURED absorption spectra (Sarna and Swartz 1988, eumelanin and pheomelanin, with ILIT's in-vivo intensification
//                2.2), and the stroma's blood in the LUMENS of the vessels iris.js grows (Freddo and Raviola 1982; the network's lumen cover
//                checked against OCT angiography of normal irides, ~8 % vessel density: Skalet et al. 2017)
//   pupil        Watson and Yellott 2012, "A unified formula for light-adapted pupil size", J Vision 12(10):12 (Stanley and Davies 1995
//                with the age term; y0 28.58)
//   sclera       Kubelka-Munk of the sclera with the conjunctiva and episclera over the pigmented choroid; scattering of the order Bashkatov
//                et al. 2010 report (Opt Spectrosc 109:197; a modelling value, see SCLERA below); the conjunctiva's blood; yellowing and
//                reddening with age (Russell, Sweda, Porcheron, Mauger 2014, Psychol Aging 29:626: the CHECK, not the construction);
//                conjunctival melanosis in deeply pigmented people (perilimbal and interpalpebral)
//   tear film    lower tear meniscus height ~0.2-0.3 mm, radius of curvature ~0.25-0.35 mm (Yokoi et al. 2004, IOVS 45:2183-; Johnson and
//                Murphy 2006, Cont Lens Anterior Eye 29:213); the conjunctival vessels and the anterior ciliary vessels at the rectus
//                insertions (the spiral of Tillaux: medial 5.5, inferior 6.5, lateral 6.9, superior 7.7 mm from the limbus)
//   adnexa       caruncle ~5 x 3 mm, plica semilunaris ~2 mm wide (standard anatomy texts: Snell and Lemp, Clinical Anatomy of the Eye);
//                lid margin ~2 mm thick, meibomian orifices ~25-30 upper and ~20 lower along ~25 mm (~1 mm apart)
//   lid margin   (EYE7_VERSION 2) the free margin as a tissue of its own thickness: the intermarginal strip ~2 mm from the posterior border
//                (square, resting on the globe in the tear film) to the anterior border (rounded, the lash rows in its anterior third); across
//                it from behind: the wet conjunctival lid wiper, the mucocutaneous junction (Marx's line), the row of meibomian orifices just in
//                front of it, the grey line (the muscle of Riolan seen through: the boundary of the posterior and anterior lamellae), the lash
//                follicles (Bron, Tripathi, Tripathi, Wolff's Anatomy of the Eye and Orbit, 8th ed. 1997, ch. 2; Knop, Knop, Millar, Obata,
//                Sullivan 2011, IOVS 52:1938, 'The International Workshop on Meibomian Gland Dysfunction: anatomy', figs. 3-6); the lower
//                lid's tarsus is ~4-5 mm tall against the upper's ~10 and its margin a little narrower (the 1.8 mm is a modelling value)
// Chromophore spectra and colour matching: the studio's skin model (assets/likeness/skin_model.json: Jacques 1998, Prahl / OMLC, Donner and
// Jensen 2006; CIE 1931 by Wyman, Sloan, Shirley 2013, a 6504 K illuminant, white-balanced linear Rec.709), so the eye, the caruncle and
// the skin share one optics.

export const EYE7_VERSION = 11;   // 2 (8 Oct, iteration 2): the lid margin as a tissue (ANAT.margin; eye7_cycles.py margin_rim); 3 (iteration 3): the engine eye (engine.js);
// 4 (iteration 4): the seam with FACE7's lid: the wet posterior margin on whatever lid is drawn (engine.js strip; eye7_cycles.py: the rim takes the lid's own margin);
// 5 (iteration 5): the light INTO the chamber refracted by the cornea (engine.js e7IrisIrr: entry point, Fresnel, the lens' concentration; Cycles: MNEE shadow caustics)
// 6 (15 Oct): the gaze (eye7_cycles.py aim_gaze, engine.js); 7 (15 Oct, c4 it 2): the conjunctiva's blood in vessels (SCLERA_OPT.vesselR, vesselPack);
// 8 (15 Oct, c4 it 3): the HEAD/EYE SPLIT of a held fixation (GAZE, eyeHeadSplit): one rule for both renderers and the posing lanes;
// 9 (15 Oct, c5 it 1): THE IRIS AS A TISSUE: the melanin in its granules (granuleOptics, irisSpectrum), the stroma grown as its vessel network
// (iris.js: radial trabeculae from the major circle, the collarette's arcades, crypts in the network's gaps); the iris relief carried by the Cycles mesh
// 10 (15 Oct, c5 it 2): THE PIGMENT IN ITS MEASURED AMOUNT, THE IRIS A LAYERED TRANSLUCENT TISSUE (irisLayers, irisCycles, irisPigDraw): the colour
// an output of the person's melanin; in Cycles a closed stromal slab with random-walk scattering under an absorbing border-layer coat
// 11 (15 Oct, c5 it 3): THE IRIS'S COLOUR ON ITS MEASURED CHROMOPHORES: the melanins' measured absorption (SS_MELANIN; Mie keeps the granules'
// scattering), the stroma's blood in the lumens of its grown vessels (iris.js blood / bloodP; the loose stroma carries none), one seed per person
// for both renderers (index.js eye7Seed)

// ---------------------------------------------------------------- the head/eye split of a held fixation (EYE7_VERSION 8)
// People hold their eyes near the middle of the orbit: naturally occurring saccades are mostly 15 deg or less (Bahill, Adler and Stark 1975,
// Invest Ophthalmol 14:468), and gaze shifts beyond the "eye-only range" (of the order of 15-20 deg, subject-dependent: Stahl 1999, Exp Brain
// Res 126:41) recruit the head, which takes the excess so the eye ends near that range (Freedman 2008, Biol Cybern 98:461; Guitton and Volle
// 1987, J Neurophysiol 58:427: the mechanical range, ~40-50 deg, is reached only transiently). So a fixation the eye would have to hold beyond
// the eye-only range is SHARED: the eye takes up to eyeOnlyDeg, the head the rest. The eye cannot turn the head; it takes its share and
// reports the head's (headDeg) for whoever poses the head (CAMERA7 / MOTION / the shot's look-at). eyeOnlyDeg is the middle of the cited
// 15-20 deg range (a choice inside the literature's range, said plainly), not fitted to a render.
export const GAZE = { eyeOnlyDeg: 17.5, mechDeg: 40 };
export function eyeHeadSplit(targetDeg, { eyeOnlyDeg = GAZE.eyeOnlyDeg } = {}) {
  const t = Math.max(0, +targetDeg || 0), eye = Math.min(t, eyeOnlyDeg);
  return { eyeDeg: eye, headDeg: t - eye, shared: t > eyeOnlyDeg };
}

// ---------------------------------------------------------------- anatomy (mm)
export const ANAT = {
  globeR: 12.0,
  cornea: { r: 7.8, n: 1.3375, nTear: 1.336, wtw: 11.7, vertLess: 0.9, edgeR: 6.0 },
  iris: { stroma: 0.38, abl: 0.025, rootDepth: 0.35, rootR: 6.05, collarette: 0.33 },
  limbus: { band: 0.8 },                                   // the corneoscleral transition (mm), the sclera's bevel over the cornea
  tear: { lowH: 0.25, lowR: 0.3, upH: 0.12 },
  // the lid's free margin and the tarsal plate behind it (mm): W the intermarginal strip's width from the posterior border (on the globe)
  // to the anterior border, along the globe's normal (the lid's full thickness at its margin: tarsus ~1 mm, orbicularis, skin); Ht the
  // tarsus' height at the centre of the lid (upper ~9-10, lower ~4-5: Wolff's ch. 2; a crescent, falling toward the canthi); over it the
  // lid keeps a thickness from W at the margin to Ttop x W at the tarsus' upper border (the plate thins to its border: a modelling share),
  // then hands over to the lid's own skin over Ld. It is a MINIMUM: where FACE7's lid skin already stands that far from the eye the
  // tissue lies inside it and only the strip shows. rA the anterior border's rounding; across the strip as fractions of W from the
  // posterior border: the mucocutaneous junction (mcj), the meibomian orifices' row (orif), the grey line (grey); orifices ~1 mm apart;
  // the lash zone is the anterior border itself (HAIR7's lashes root there). taper: the width at the canthi as a share of W
  // (EYE7_VERSION 4) own: the seam with FACE7's lid tissue: a lid whose skin stands >= own[1] x W off the eye just beyond its posterior border
  // has a margin of its own (FACE7 carries the thickness: the rim takes it and only the wet strip is EYES'); < own[0] x W is a knife edge (the
  // rim builds the margin); smooth between. A share of the anatomy's W, not a fitted number.
  margin: { up: { W: 2.0, Ht: 9.0 }, low: { W: 1.8, Ht: 4.5 }, Ttop: 0.6, Ld: 1.5, rA: 0.45, mcj: 0.2, orif: 0.3, grey: 0.45, orifices: 1.0, taper: 0.55, own: [0.4, 0.75] },
  caruncle: { w: 5.0, h: 3.0, d: 1.6 }, plica: { w: 1.8, h: 6.5, t: 0.15 },
};
export const acd = age => Math.max(2.5, Math.min(3.5, 3.25 - 0.011 * ((age ?? 30) - 25)));

// ---------------------------------------------------------------- pupil (Watson and Yellott 2012)
// L: adapting luminance (cd/m2), a: field area (deg2), age: years, eyes: 1 or 2. Returns the entrance pupil diameter (mm).
export function pupilWY({ L = 100, a = 3000, age = 30, eyes = 2 } = {}) {
  const F = L * a * (eyes === 1 ? 0.1 : 1), q = Math.pow(F / 846, 0.41);
  const Dsd = 7.75 - 5.75 * (q / (q + 2));
  return Dsd + (age - 28.58) * (0.02132 - 0.009562 * Dsd);
}
// the stages' adapting luminance: what each stage stands for photographically (a modelling statement, not a measurement of our render):
// a studio portrait under modelling light ~ 100 cd/m2 of surround, a room by a window ~ 150, open shade and overcast outdoors ~ 1500,
// sun ~ 5000. The field: most of the visual field (~3000 deg2, Watson and Yellott's large-field case).
export const STAGE_LUM = { studio: 100, window: 150, yard: 1500, over: 1500, overcast: 1500, sun: 5000, lot: 1500, shop: 200, record: 100 };
export const stageLum = stage => { const k = String(stage || 'studio').split('@')[0]; return STAGE_LUM[k] ?? 150; };

// ---------------------------------------------------------------- spectra
// Kubelka-Munk: reflectance of a layer (absorption K, scattering S, per mm; thickness d mm) over a background of reflectance Rg
export function km(K, S, d, Rg) {
  if (d < 1e-6) return Rg;
  if (S < 1e-9) return Rg * Math.exp(-2 * K * d);
  const a = 1 + K / S, b = Math.sqrt(Math.max(1e-12, a * a - 1)), x = b * S * d;
  const coth = x > 20 ? 1 : (Math.exp(2 * x) + 1) / (Math.exp(2 * x) - 1);
  return (1 - Rg * (a - b * coth)) / (a - Rg + b * coth);
}
// KM's coefficients from transport ones: K = 2 mu_a, S = 0.75 mu_s' (diffuse light; per mm from the model's per cm)
const K_ = mua_cm => 2 * mua_cm / 10, S_ = musp_cm => 0.75 * musp_cm / 10;
// a spectrum (31 samples, 400-700 nm) to linear Rec.709 (the skin model's matrix, white-balanced)
export function rgbOf(M, R) { const S = M.spec2rgb, c = [0, 0, 0]; for (let k = 0; k < 3; k++) for (let i = 0; i < R.length; i++) c[k] += S[k][i] * R[i]; return c.map(v => Math.max(0, v)); }
export function labOf(c) {   // CIELAB under the model's white (as skin_lut.js rgbToLab)
  const X = 0.4124 * c[0] + 0.3576 * c[1] + 0.1805 * c[2], Y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], Z = 0.0193 * c[0] + 0.1192 * c[1] + 0.9505 * c[2];
  const f = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116, fx = f(X / 0.95047), fy = f(Y), fz = f(Z / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// ---------------------------------------------------------------- iris optics (EYE7_VERSION 9: the pigment in its granules, the stroma as a tissue)
// MELANIN SITS IN GRANULES. The iris's melanin is packed in melanosomes (in the border layer's and the stroma's melanocytes, the stroma's clump
// cells, and the posterior pigment epithelium), and a melanosome both ABSORBS and SCATTERS: it is a ~0.6 um particle of index ~1.7 in cytoplasm
// of ~1.36. Up to EYE7_VERSION 8 the model spread the melanin through the layers as a dissolved absorber over a scattering stroma (Rayleigh
// fibrils), with a skin model's per-melanosome absorption that, put back into a granule, makes a nearly white particle: the brown classes came out
// a thin absorbing filter over a blue-scattering stroma, an olive-yellow (h ~79) that no input could warm (2j). Now:
//   - the granule's optical constants are MEASURED ones: eumelanin n(lambda) = 1.648 + 2.37e4 / lambda^2 (nm) and k(lambda) = 0.56 exp(-lambda /
//     270 nm) (Stavenga, Leertouwer, Osorio, Wilts 2015, Light Sci Appl 4:e243, interference microscopy and microspectrophotometry of melanin
//     granules); pheomelanin has no such measurement, so its k is eumelanin's scaled by the studio skin model's own pheo / eu absorption ratio at
//     each wavelength (assets/likeness/skin_model.json: Jacques' spectra, NIST-checked), its n taken equal (said plainly: a borrowed shape);
//   - each granule's absorption and reduced scattering by Mie theory (Bohren and Huffman 1983's BHMIE, below; checked on their x 5.213, m 1.55
//     case: Q_sca 3.105, g 0.633), per unit volume fraction of granules: mu = phi 3 Q / (4 r); the granule ~0.6 um across (uveal melanosomes are
//     round to ovoid, of the order of half a micron; their size does NOT differ with iris colour: Imesch et al. 1996, Arch Ophthalmol 114:443;
//     Peles et al. 2009, J Phys Chem B 113:11346), independent scattering (no packing correction: said plainly);
//   - what differs between irides is the NUMBER of melanosomes per melanocyte, chiefly in the superficial (border-layer) melanocytes (Imesch et al.
//     1996; the melanocytes' number does not differ: Wilkerson et al. 1996, Arch Ophthalmol 114:437) and the melanin TYPE (eumelanin to
//     pheomelanin ~14.8 in dark brown iridal melanosomes, ~1.3 in blue-green: Peles et al. 2009; green irides pheomelanic: Prota et al. 1998,
//     Exp Eye Res 67:293); (v10) IRIS_PIG below carries the person's melanin as its MEASURED mass (Prota et al. 1998) and the border layer's
//     share, and the granules' volume fraction follows from the mass and the granule's density;
//   - the posterior pigment epithelium is the same granules packed (an optically thick eumelanin layer), not a fixed 2 %;
//   - the stroma's other scatterers: its fine collagen fibrils (Rayleigh-like: the structural blue that shows where melanin is scarce; a
//     modelling value, as before) and, along the TRABECULAE (the radial vessels in their thick collagen sleeves: iris.js grows them), dense
//     collagen with the sclera's scattering (SCLERA_OPT: the same tissue, type I collagen bundles); (v10) the stroma's blood 4 % (Lam and Baranoski 2006).
// (v9 found packed granules a dark yellow-brown whatever their count: that was the granules' NUMBER, ~18 x the measured melanin; v10 below.)
export function bhmie(x, mr, mi) {   // Bohren and Huffman (1983) Appendix A: a homogeneous sphere, size parameter x, relative index mr + i mi
  const cadd = (a, b) => [a[0] + b[0], a[1] + b[1]], csub = (a, b) => [a[0] - b[0], a[1] - b[1]], cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
  const cdiv = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
  const m = [mr, mi], y = [x * mr, x * mi], xstop = x + 4 * Math.cbrt(x) + 2, nmx = Math.round(Math.max(xstop, Math.hypot(y[0], y[1])) + 15), nstop = Math.round(xstop);
  const D = Array.from({ length: nmx + 1 }, () => [0, 0]);
  for (let n = nmx; n >= 2; n--) { const ny = cdiv([n, 0], y); D[n - 1] = csub(ny, cdiv([1, 0], cadd(D[n], ny))); }
  let psi0 = Math.cos(x), psi1 = Math.sin(x), chi0 = -Math.sin(x), chi1 = Math.cos(x), xi1 = [psi1, -chi1], qsca = 0, qext = 0, gs = 0, an1 = null, bn1 = null;
  for (let n = 1; n <= nstop; n++) {
    const psi = (2 * n - 1) * psi1 / x - psi0, chi = (2 * n - 1) * chi1 / x - chi0, xi = [psi, -chi];
    const t1 = cadd(cdiv(D[n], m), [n / x, 0]), an = cdiv(csub(cmul(t1, [psi, 0]), [psi1, 0]), csub(cmul(t1, xi), xi1));
    const t2 = cadd(cmul(m, D[n]), [n / x, 0]), bn = cdiv(csub(cmul(t2, [psi, 0]), [psi1, 0]), csub(cmul(t2, xi), xi1));
    qsca += (2 * n + 1) * (an[0] ** 2 + an[1] ** 2 + bn[0] ** 2 + bn[1] ** 2); qext += (2 * n + 1) * (an[0] + bn[0]);
    gs += ((2 * n + 1) / (n * (n + 1))) * (an[0] * bn[0] + an[1] * bn[1]);
    if (n > 1) gs += ((n - 1) * (n + 1) / n) * (an1[0] * an[0] + an1[1] * an[1] + bn1[0] * bn[0] + bn1[1] * bn[1]);
    psi0 = psi1; psi1 = psi; chi0 = chi1; chi1 = chi; xi1 = [psi1, -chi1]; an1 = an; bn1 = bn;
  }
  const g = 2 * gs / qsca; qsca *= 2 / (x * x); qext *= 2 / (x * x);
  return { qext, qsca, qabs: qext - qsca, g };
}
export const MELANIN = { n: (wl) => 1.648 + 2.37e4 / (wl * wl), k: (wl) => 0.56 * Math.exp(-wl / 270), d: 0.6, nMed: 1.36 };   // Stavenga et al. 2015; granule um; cytoplasm
// (EYE7_VERSION 11) THE MELANINS' MEASURED ABSORPTION. Eumelanin's and pheomelanin's extinction coefficients, cm-1 per mg/ml, 400-700 nm by 10 nm
// (Sarna and Swartz 1988, "The physical properties of melanins", in The Pigmentary System, Nordlund et al. eds., Oxford UP; the tables as
// published by the Oregon Medical Laser Center and the Natural Phenomena Simulation Group, npsg.uwaterloo.ca/data/iris.php, fetched 15 Oct),
// times the factor of intensification 2.2 the in-vivo-validated iris model applies (Lam and Baranoski 2006, ILIT, section 4: the lengthening of
// the optical path by the pigments' inhomogeneous distribution in vivo, after Fukshansky 1987 and Vogel 1993). WHY NOT MIE'S ABSORPTION (v9-v10):
// Mie on Stavenga's k at the granule's 1.40 g/cm3 makes each 0.6 um granule optically thick in the blue (optical depth ~2.4 across it at 400 nm), so
// its absorption per mg/ml came out 0.6 x the measurement at 400 nm and 1.2 x at 700 (a sieve effect flattening the spectrum: less chroma). The
// bulk k is not the difference (k from these tables at 1.40 g/cm3 is Stavenga's to ~12 %); the granule's self-shielding is. In vivo the iris shows
// the opposite: Delori, Dorey, Keilhauer 1991 found iris reflectance differs between pigmentation levels most at SHORT wavelengths, and ILIT
// reproduces in-vivo iris radiance (Imai 2000, Unander 2000) with these unpackaged spectra. Uveal melanosomes' internal melanin density is not
// measured (Stavenga's k is a bird feather's melanosome), so the absorption follows the measurement validated in the iris; the granule's Mie
// stays for what it alone gives, its SCATTERING (Stavenga's n; size; g). Pheomelanin now has its own measured spectrum (it was eumelanin's k
// scaled by the skin model's ratio).
export const SS_MELANIN = { wl0: 400, dwl: 10, factor: 2.2,
  eu: [14.64, 13.65, 12.86, 12.07, 11.4, 10.74, 10.11, 9.606, 9.105, 8.618, 8.137, 7.656, 7.176, 6.708, 6.249, 5.79, 5.456, 5.132, 4.808, 4.498, 4.3, 4.103, 3.878, 3.615, 3.353, 3.179, 3.039, 2.899, 2.759, 2.593, 2.424],
  pheo: [12.11, 11.28, 10.39, 9.597, 8.677, 7.989, 7.42, 6.788, 6.156, 5.612, 5.084, 4.6, 4.124, 3.714, 3.352, 2.994, 2.658, 2.323, 1.988, 1.653, 1.738, 1.621, 1.472, 1.355, 1.282, 1.209, 1.127, 1.041, 0.9583, 0.8795, 0.8007] };
export const ssMelanin = (kind, wl) => { const T = SS_MELANIN[kind], x = Math.max(0, Math.min(T.length - 1.000001, (wl - SS_MELANIN.wl0) / SS_MELANIN.dwl)), i = Math.floor(x), f = x - i;
  return T[i] * (1 - f) + T[i + 1] * f; };
// per unit volume fraction of granules (per mm): absorption (the measured mass absorption above, at the granule's density) and reduced scattering
// (Mie), eumelanin and pheomelanin, at the skin model's wavelengths (cached per model)
const _gran = new WeakMap();
export function granuleOptics(M) {
  let G = _gran.get(M); if (G) return G;
  const r = MELANIN.d / 2, rmm = r / 1000, rho = IRIS_TISSUE.rhoGran;   // ug/mm3 = mg/ml
  const one = (wl, k, kind) => { const q = bhmie(2 * Math.PI * r * MELANIN.nMed / (wl / 1000), MELANIN.n(wl) / MELANIN.nMed, k / MELANIN.nMed);
    return { mua: ssMelanin(kind, wl) * SS_MELANIN.factor * rho / 10, muaMie: 3 * q.qabs / (4 * rmm), musp: 3 * q.qsca * (1 - q.g) / (4 * rmm), g: q.g }; };
  G = { eu: M.wl.map(wl => one(wl, MELANIN.k(wl), 'eu')), pheo: M.wl.map(wl => one(wl, MELANIN.k(wl) * ssMelanin('pheo', wl) / ssMelanin('eu', wl), 'pheo')) };
  _gran.set(M, G); return G;
}
// (EYE7_VERSION 10) THE PIGMENT IN ITS MEASURED AMOUNT; THE IRIS AS A LAYERED, TRANSLUCENT TISSUE. v9's granule optics stand (above); what
// was wrong was how MANY granules: v9 filled 16 % of the border layer with granules ("of the order the histology shows"), about 18 times the
// melanin that chemistry measures in a dark iris, so the layer was optically thick and its colour was the granule's own whatever the pigment
// (the critic's probe, measures/it12.md: phiA 0.16 -> 0.005 hardly moved it). Now every amount is a measured one:
//   - MELANIN MASS. Eumelanin and pheomelanin per ml of iris tissue by pigmentation (Prota, Hu, Vincensi, McCormick, Napolitano 1998, Exp Eye
//     Res 67:293, as compiled for a light transport model validated against in-vivo iris radiance (Imai 2000, Unander 2000) by Lam and
//     Baranoski 2006, Comput Graph Forum 25:359, Table 2: high 1.008 / 0.2674, moderate 0.8138 / 0.2054, low 0.1201 / 0.0194 mg/ml over their
//     0.342 mm of border layer + stroma, i.e. a COLUMN of mass per area, which is what the light sees); the share of it in the border layer
//     0.9 / 0.5 / 0.1 (the same group's specimens: Kravchenko and Baranoski 2016, U Waterloo thesis, Table 3.1; colour differences live
//     chiefly in the border layer's melanocytes: Imesch et al. 1996). The person's own amount spreads about the class (irisPigDraw).
//   - FROM MASS TO GRANULES: the granule's mass density 1.40 g/cm3 (melanosomes on density gradients: Glickman, Lam, Chan et al. 2001, Proc
//     SPIE 4257, ~1.38-1.41). (v10's CHECK found Mie on Stavenga's k 0.6-1.2 x the measured absorption across 400-700 nm: a flatter spectrum.
//     v11 takes the granules' absorption from the measurement itself: SS_MELANIN above says why; eye7_test.mjs prints both.)
//   - THE BORDER LAYER'S OWN SCATTERING: its fibroblasts (a third of its volume, n 1.42 in a ground substance of 1.35: Lam and Baranoski 2006
//     after Snell and Lemp 1989) by Mie (BHMIE), radius 5 um (a cell's order; 3-7.5 um gives mus' 2.4-1.2 mm-1): mus' ~1.7 mm-1, nearly flat,
//     strongly forward (g 0.98). It replaces v9's 4 mm-1 x lambda^-1 (a modelling value), which put a scattering floor over the melanin.
//   - THE STROMA'S BLOOD: (v10) 4 % of its volume everywhere (Lam and Baranoski 2006 after Jacques 1996, a dermis value). (v11) REPLACED: the
//     blood is in the vessels' lumens (IRIS_TISSUE below; iris.js lays them), so the loose stroma, where a light iris's blue is scattered,
//     has none. The uniform 4 % had carried the browns' warmth and turned every light class lilac (the it 13 critic's probe).
//   - The stroma's fibrils and the trabecular sleeves as v9 (modelling values, said so). The pigment epithelium as v9 (packed granules).
// Result (eye7_test.mjs): the colour now MOVES with the pigment: a sweep of the column carries the iris from blue-grey through hazel-beige to a
// dark brown; the brown classes no longer share one hue. In Cycles the same coefficients drive the layered transport (irisCycles): the border
// layer is an absorbing coat (its one-way transmittance), the stroma a random-walk medium whose albedo and mean free path come from its own
// mu_a and mu_s', over the epithelium (the slab's back face: light that reaches it is lost). The engine reads the Kubelka-Munk total.
// (EYE7_VERSION 11) THE STROMA'S BLOOD IS IN ITS VESSELS. v10 spread 4 % blood through every cubic micron of the stroma (ILIT's value, itself
// borrowed from the dermis: Jacques 1996). In the iris the blood runs in the vessels the stroma is built round: the radial arterioles and venules
// in their collagen sleeves (iris.js grows them: the trabeculae) and the finer vessels of the pupillary zone; the loose stroma between them, where
// a light iris's blue is scattered, carries none (Bron et al. 1997, Wolff's Anatomy, the iris; Freddo and Raviola 1982, Invest Ophthalmol Vis Sci
// 23:154: thick-walled vessels with small lumens and a collagen adventitia). So iris.js lays each grown vessel's LUMEN into the stroma (its
// cross-section pi rL^2 spread under its sleeve, depth-averaged over the stroma), and irisLayers takes that local blood with the packaging of
// whole blood in a cylinder of the lumen's radius (vesselPack, as the conjunctiva's). The lumens are of the order histology shows for the iris's
// arterioles and venules (~15-50 um across) and its capillaries (~8-12 um): lumenR 12.5 um and lumenRp 5 um are values inside those ranges, not
// fitted to a colour. The iris's mean blood is then an OUTPUT of the network (iris.js counts.blood: ~0.5-1 % of the stroma), not an input.
export const IRIS_TISSUE = { cellR: 5.0, fCell: 1 / 3, nCell: 1.42, nBase: 1.35, musFib: 1.8, fRay: 0.9, bFib: 1.0, musCord: 4.0, bCord: 1.2,
  lumenR: 0.0125, lumenRp: 0.005, oxy: 0.5, phiPE: 0.5, pe: 0.05, rhoGran: 1400, colRef: 0.405, nAq: 1.336 };   // lumens mm; rhoGran ug/mm3 (1.40 g/cm3); colRef mm: (v11) OUR border layer + stroma
// (ANAT.iris.abl + stroma: Prota's amounts are concentrations in the tissue, so the column is the concentration over this iris's own thickness;
// v10 took Lam and Baranoski's 0.342 mm, their model's geometry, not ours)
// the ABL's index by Gladstone and Dale (Lam and Baranoski 2006 eq. 8): its coat over the aqueous in Cycles
export const ablIndex = () => { const T = IRIS_TISSUE; return T.fCell * T.nCell + (1 - T.fCell) * T.nBase; };
// the person's iris pigment: eu, pheo (mg/ml over colRef: a column eu x colRef ug/mm2), abl (the border layer's share). The three measured
// anchors are darkBrown (high), brown (moderate) and blue (low); hazel, green and grey sit between them (interpolations, said plainly: no
// per-class chemistry for them here; green and hazel carry more pheomelanin, Prota et al. 1998; grey a denser, coarser stroma, v9's fRay 0.6).
export const IRIS_PIG = {
  darkBrown: { eu: 1.008, pheo: 0.2674, abl: 0.9 },
  brown: { eu: 0.8138, pheo: 0.2054, abl: 0.5 },
  hazel: { eu: 0.31, pheo: 0.13, abl: 0.35 },
  green: { eu: 0.20, pheo: 0.12, abl: 0.25 },
  grey: { eu: 0.15, pheo: 0.025, abl: 0.15, fRay: 0.6 },
  blue: { eu: 0.1201, pheo: 0.0194, abl: 0.1 },
};
export const irisPig = (cls, o = {}) => ({ ...(IRIS_PIG[cls] || IRIS_PIG.brown), ...o });
// a person's own pigment within the class (a continuum, not a category): the melanin column log-normal about the class (sd 0.3 in ln: a
// modelling spread; Prota et al. report ranges within each colour class), the border layer's share +- 0.12. Deterministic in the seed.
export function irisPigDraw(cls, seed) {
  let a = ((seed >>> 0) * 2654435761 + 977) >>> 0; const r = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const p = irisPig(cls), n = Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r()), m = Math.exp(0.3 * Math.max(-2.5, Math.min(2.5, n)));
  return { ...p, eu: +(p.eu * m).toFixed(4), pheo: +(p.pheo * m).toFixed(4), abl: +Math.max(0.05, Math.min(0.95, p.abl + 0.24 * (r() - 0.5))).toFixed(3), cls, draw: +m.toFixed(3) };
}
const _cell = new WeakMap();
function cellScatter(M) {   // the border layer's fibroblasts: mus' per mm at each wavelength (Mie, BHMIE)
  let c = _cell.get(M); if (c) return c; const T = IRIS_TISSUE, r = T.cellR / 1000;
  c = M.wl.map(wl => { const q = bhmie(2 * Math.PI * T.cellR * T.nBase / (wl / 1000), T.nCell / T.nBase, 0); return T.fCell * 3 * q.qsca * (1 - q.g) / (4 * r); });
  _cell.set(M, c); return c;
}
// the layers' coefficients (per mm) at one place: the border layer (thickness x ablK: 0 in a crypt), the stroma (melanin x melK, thickness x
// thK, the trabecular sleeve's dense collagen x cordK in its upper part, (v11) the blood of the vessels there: its depth-averaged volume fraction
// `blood` in lumens of radius `lumen` mm, from iris.js), the epithelium's reflectance behind
export function irisLayers(M, pig, { ablK = 1, melK = 1, thK = 1, cordK = 0, blood = 0, lumen = IRIS_TISSUE.lumenR } = {}) {
  const T = IRIS_TISSUE, G = granuleOptics(M), Cs = cellScatter(M), n = M.wl.length, fRay = pig.fRay ?? T.fRay;
  const dA = ANAT.iris.abl * ablK, dS = ANAT.iris.stroma * thK, dC = Math.min(dS, 0.08) * Math.min(1, cordK);
  const colE = pig.eu * T.colRef * melK, colP = pig.pheo * T.colRef * melK;                       // ug/mm2
  const cAe = pig.abl * colE / ANAT.iris.abl / T.rhoGran, cAp = pig.abl * colP / ANAT.iris.abl / T.rhoGran;   // granule volume fractions
  const cSe = (1 - pig.abl) * colE / ANAT.iris.stroma / T.rhoGran, cSp = (1 - pig.abl) * colP / ANAT.iris.stroma / T.rhoGran;
  const L = { dA, dS, dC, aA: [], sA: [], aS: [], sS: [], sC: [], pe: [] };
  for (let i = 0; i < n; i++) {
    const x = M.wl[i] / 500, base = M.mu.base[i] / 10, hbc = T.oxy * M.mu.oxy[i] + (1 - T.oxy) * M.mu.deoxy[i];
    L.aA.push(cAe * G.eu[i].mua + cAp * G.pheo[i].mua + base); L.sA.push(cAe * G.eu[i].musp + cAp * G.pheo[i].musp + Cs[i]);
    L.aS.push(cSe * G.eu[i].mua + cSp * G.pheo[i].mua + base + blood * hbc / 10 * vesselPack(hbc, lumen));
    L.sS.push(cSe * G.eu[i].musp + cSp * G.pheo[i].musp + T.musFib * (fRay * x ** -4 + (1 - fRay) * x ** -T.bFib));
    L.sC.push(T.musCord * x ** -T.bCord);
    L.pe.push(km(2 * (T.phiPE * G.eu[i].mua + base), 0.75 * T.phiPE * G.eu[i].musp, T.pe, 0));
  }
  return L;
}
// reflectance spectrum of the iris surface at one place (diffuse light; Kubelka-Munk through the layers): what the engine draws
export function irisSpectrum(M, pig, f = {}) {
  const L = irisLayers(M, pig, f), out = new Float64Array(M.wl.length);
  for (let i = 0; i < out.length; i++) {
    const Rs = km(2 * L.aS[i], 0.75 * L.sS[i], L.dS - L.dC, L.pe[i]);
    const Rc = km(2 * L.aS[i], 0.75 * (L.sS[i] + L.sC[i]), L.dC, Rs);
    out[i] = km(2 * L.aA[i], 0.75 * L.sA[i], L.dA, Rc);
  }
  return out;
}
// Cycles' random walk (Principled 'RANDOM_WALK', Blender 5.x: intern/cycles/kernel/integrator/subsurface_random_walk.h, read at v5.2.0) takes
// a (multiple-scattering) albedo A and a radius per channel and sets sigma_t = 1 / radius (the radius IS the extinction mean free path) and
// the single-scattering albedo by van de Hulst's relation as d'Eon gives it ("A Hitchhiker's Guide to Multiple Scattering" v0.3.2, eq. 53.7):
// s = 4.09712 + 4.20863 A - sqrt(9.59217 + 41.6808 A + 17.7126 A^2), alpha = (1 - s^2) / (1 - g s^2) (g 0 here). Inverted below, so the walk
// runs the stroma's own mu_a and mu_s' (isotropic, reduced coefficients).
export const vdhS = A => 4.09712 + 4.20863 * A - Math.sqrt(9.59217 + 41.6808 * A + 17.7126 * A * A), vdhAlpha = A => 1 - vdhS(A) ** 2;
export function cbInvert(alpha, sigt) {   // -> { A, d }: Cycles' albedo and radius (mm) for single-scattering albedo alpha and extinction sigt (mm-1)
  let lo = 0, hi = 1; if (alpha >= vdhAlpha(1)) lo = hi = 1; else for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (vdhAlpha(m) < alpha) lo = m; else hi = m; }
  return { A: (lo + hi) / 2, d: 1 / sigt };
}
// the Cycles iris at one place: the border layer as an absorbing coat (its one-way normal transmittance), the stroma as a random-walk medium
// (A per channel, d per channel in mm), from the same layers. Channels: the spectrum through the model's own rgb (the coat and A as filters /
// albedos; d weighted by each channel's colour-matching row)
export function irisCycles(M, pig, f = {}) {
  const L = irisLayers(M, pig, f), n = M.wl.length, tint = new Float64Array(n), A = new Float64Array(n), d = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    tint[i] = Math.exp(-L.aA[i] * L.dA);
    const sp = L.sS[i] + L.sC[i] * (L.dS > 0 ? L.dC / L.dS : 0), st = L.aS[i] + sp, w = cbInvert(sp / st, st); A[i] = w.A; d[i] = w.d;
  }
  const S = M.spec2rgb, dc = [0, 1, 2].map(c => { let a = 0, b = 0; for (let i = 0; i < n; i++) { const w = Math.max(0, S[c][i]); a += w * d[i]; b += w; } return a / b; });
  return { tint: rgbOf(M, tint).map(v => Math.min(1, v)), A: rgbOf(M, A).map(v => Math.min(1, v)), d: dc, thick: L.dA + L.dS };
}
// THE SAME TRANSPORT FOR THE ENGINE: the reflectance of that layered iris as Cycles' walk computes it (Kubelka-Munk's two-flux form, used up
// to v9, overstates the backscatter of this thin, forward-lit stroma: on the anchors it gave darkBrown L* 35 h 71 where the walk gives L* 24
// h 61). A table of the walk on a slab (Cycles' coefficients from (A, d), isotropic steps, the back face lost, 256 bounces as Cycles)
// over A and the slab's thickness in units of d, built once (deterministic), times the coat's diffuse transmittance in and out.
let _slab = null;
function slabTable() {
  if (_slab) return _slab; const NA = 21, NT = 25, N = 3000, tab = new Float32Array(NA * NT); let sd = 987654321;
  const rnd = () => { sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0; return sd / 4294967296; };
  for (let ia = 0; ia < NA; ia++) for (let it = 0; it < NT; it++) {
    const A = ia / (NA - 1), tau = 0.01 * 10 ** (4 * it / (NT - 1)), st = 1, al = vdhAlpha(A); let R = 0;   // radius 1 (sigma_t 1), t = tau
    for (let k = 0; k < N; k++) { let z = 0, mz = -Math.sqrt(rnd()), w = 1;
      for (let b = 0; b < 256; b++) { z += mz * (-Math.log(1 - rnd()) / st); if (z > 0) { R += w; break; } if (z < -tau) break; w *= al; if (w < 1e-4) break; mz = 2 * rnd() - 1; } }
    tab[ia * NT + it] = R / N; }
  return (_slab = { NA, NT, tab });
}
export function slabWalkR(A, tau) {
  const { NA, NT, tab } = slabTable(), fa = Math.max(0, Math.min(1, A)) * (NA - 1), ft = Math.max(0, Math.min(NT - 1, (Math.log10(Math.max(1e-6, tau)) + 2) / 4 * (NT - 1)));
  const a0 = Math.min(NA - 2, Math.floor(fa)), t0 = Math.min(NT - 2, Math.floor(ft)), u = fa - a0, v = ft - t0, g = (i, j) => tab[i * NT + j];
  return (g(a0, t0) * (1 - v) + g(a0, t0 + 1) * v) * (1 - u) + (g(a0 + 1, t0) * (1 - v) + g(a0 + 1, t0 + 1) * v) * u;
}
export const coatDiffuseT = tint => { let s = 0; const n = 64; for (let k = 0; k < n; k++) { const mu = (k + 0.5) / n; s += 2 * mu * tint ** (1 / mu) / n; } return s; };   // cosine-weighted mean of tint^(1/mu)
// the iris's albedo (linear Rec.709) at one place, from the Cycles layering of the same coefficients: what the engine draws
export function irisAlbedo(M, pig, f = {}) {
  const cy = irisCycles(M, pig, f), t = ANAT.iris.stroma * (f.thK ?? 1);
  return [0, 1, 2].map(c => { const T = coatDiffuseT(cy.tint[c]); return T * T * slabWalkR(cy.A[c], t / cy.d[c]); });
}
// the posterior pigment epithelium itself (the pupillary ruff): the packed eumelanin granules
export function ruffSpectrum(M) { const T = IRIS_TISSUE, G = granuleOptics(M); return Float64Array.from(M.wl, (wl, i) => km(2 * (T.phiPE * G.eu[i].mua + M.mu.base[i] / 10), 0.75 * T.phiPE * G.eu[i].musp, T.pe, 0)); }

// ---------------------------------------------------------------- sclera optics
// Sclera with episclera and conjunctiva as one scattering layer (collagen bundles: coarse, little wavelength dependence) over the choroid
// (melanin and blood: dark in the blue and green, rising in the red as the fundus does: ~2 % to ~10 % above 600 nm, Delori and Pflibsen
// 1989, Appl Opt 28:1061). The scattering is a modelling value of the order the literature gives for sclera in the visible
// (reduced scattering ~40 cm-1 at 500 nm); the layer ~0.75 mm in front of the choroid near the limbus. Blood: the conjunctiva's diffuse
// capillary bed (volume fraction ~1 %: a modelling value, borrowed from the dermis, NOT a measurement of the conjunctiva), more in the exposed
// nasal and temporal wedges and with age; vessels from the map as a thin absorbing layer of blood; a yellow chromophore with age (the skin
// model's carotene spectrum stands in for the aged sclera's yellow deposits); conjunctival melanin from the person's skin melanin.
// (EYE7_VERSION 7, c4 it 2) THE BED'S BLOOD IS IN VESSELS, NOT DISSOLVED: the conjunctiva's blood is confined to its microvessels, and a
// vessel absorbs less than the same blood spread through the layer wherever blood is opaque across the vessel (the Soret band: whole blood
// mu_a ~2500 cm-1 at 415-420 nm, i.e. a 15 um vessel is ~4 optical depths thick there and ~0.3 in the red). The pigment-packaging correction
// for blood in cylinders of radius R (Svaasand, Fiskerstrand, Kopstad, Norvang, Svaasand, Nelson, Berns 1995, Lasers Med Sci 10:55;
// Verkruysse, Lucassen, de Boer, Smithies, Nelson, van Gemert 1997, Phys Med Biol 42:51): mu_a,eff = f mu_a,blood C(lambda),
// C = (1 - exp(-2 mu_a,blood R)) / (2 mu_a,blood R). R from the anatomy: the bulbar conjunctival microvessels imaged in vivo run ~10-25 um in
// diameter (functional slit-lamp biomicroscopy: Shahidi, Wanek, Gaynes, Wu 2010, Microvasc Res 79:109; Jiang et al. 2014, Microvasc Res 92:62;
// the capillaries proper ~5-10 um): vesselR 7.5 um is the bed's typical radius, taken from that range, not chosen for a colour. Its effect
// is the Soret band's: the white no longer loses its blue to blood it could not see (b* at 24 from ~11 to ~6; 5-12.5 um gives 7.7-4.7).
export const SCLERA_OPT = { mus: 40, bMie: 1.2, d: 0.75, Rg: 0.04, blood0: 0.01, oxy: 0.8, vesselR: 0.0075 };
// the packaging factor C for whole blood of absorption mua (cm-1) in vessels of radius r (mm)
export const vesselPack = (mua, r) => { const t = 2 * mua * r / 10; return t < 1e-6 ? 1 : (1 - Math.exp(-t)) / t; };
export function scleraSpectrum(M, { age = 30, blood = 1, vessel = 0, mel = 0, yellow = null } = {}) {
  const o = SCLERA_OPT, n = M.wl.length, out = new Float64Array(n);
  const yel = yellow ?? 0.025 * Math.max(0, (age - 20) / 40);          // carotene-equivalent fraction (0 at 20, 0.025 at 60)
  const bl = o.blood0 * blood * (1 + 0.6 * Math.max(0, (age - 25) / 40));
  for (let i = 0; i < n; i++) {
    const x = M.wl[i] / 500, hb = o.oxy * M.mu.oxy[i] + (1 - o.oxy) * M.mu.deoxy[i];
    const mua = M.mu.base[i] + bl * hb * vesselPack(hb, o.vesselR) + yel * M.mu.car[i] * 40 + mel * M.mu.eu[i];
    const wl = M.wl[i], Rg = o.Rg * 0.5 + 0.08 * Math.min(1, Math.max(0, (wl - 585) / 50));
    const R = km(K_(mua), S_(o.mus * x ** -o.bMie), o.d, Rg);
    out[i] = R * Math.exp(-2 * 2 * (hb / 10) * vessel);                 // a vessel: blood of thickness `vessel` mm, passed twice
  }
  return out;
}

// ---------------------------------------------------------------- mucosa: the caruncle, the plica, the wet lid margin
// the person's own skin model (skin_lut.js skinSpectrum) with the mucosa's differences: less melanin, more blood near the surface, no
// stratum corneum (the surface term off)
export function mucosaRGB(M, skinSpectrum, person, { mel = 0.5, blood = 3, car = 0.3 } = {}) {
  const p = { ...person, Cm: (person?.Cm ?? 0.05) * mel, Ch: Math.min(0.2, (person?.Ch ?? 0.02) * blood), Cc: (person?.Cc ?? 0.1) * car };
  return rgbOf(M, skinSpectrum(M, p, false));
}

// ---------------------------------------------------------------- the per-person parameters
// info: { age, sex, group }, iris: class name; returns the anatomy the builders use (mm) and the colours (linear Rec.709)
export function eyeAnatomy({ age = 30, sex = 'f' } = {}) {
  const A = ANAT, d = acd(age);
  const rl = A.cornea.wtw / 2, rlv = (A.cornea.wtw - A.cornea.vertLess) / 2;
  return { age, sex, globeR: A.globeR, rc: A.cornea.r, nCornea: A.cornea.n, nTear: A.cornea.nTear, rl, rlv, cornEdgeR: A.cornea.edgeR,
    acd: +d.toFixed(3), irisRootR: A.iris.rootR, irisRootDepth: +(d + A.iris.rootDepth).toFixed(3), collarette: A.iris.collarette,
    tear: { ...A.tear }, margin: { ...A.margin, up: { ...A.margin.up }, low: { ...A.margin.low } }, caruncle: { ...A.caruncle }, plica: { ...A.plica } };
}
