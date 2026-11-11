// ANAT8-HEAD skull DATA (8 Oct): craniometric means and SDs by sex and population, the mandible's, the teeth's, age remodelling.
// EVERY NUMBER HERE IS OUR READING OF THE LITERATURE, 'AS RECALLED', PROVISIONAL (no table was fetched; no geometry from any atlas):
//  - cranium: Howells, W. W. (1973) Cranial Variation in Man; (1989) Skull Shapes and the Map; (1995) Who's Who in Skulls: the
//    measurement definitions (GOL, XCB, BBH, XFB, WFB, ZYB, AUB, NPH, NLH, NLB, OBH, OBB, DKB, MAB, GLS, BNL, BPL, MDH) and population
//    means pooled by us: 'white' (Norse, Zalavar, Berg), 'black' (Zulu, Teita, Dogon), 'asian' (N and S Japan, Hainan, Anyang),
//    'amerind' (Peru, Arikara, Santa Cruz). Values rounded; SDs pooled within sex.
//  - mandible: Humphrey, Dean and Smith 1999; Franklin et al. 2008 (bigonial, bicondylar, ramus height and breadth, gonial angle);
//    Kharoshah et al. 2010; Vinay et al. 2013 (symphysis and body heights). Chin breadth: our estimate from the mental tubercles.
//  - rev 2 (it2): the mandibular body length Go-Me (Jarabak's ~71-76 mm radiographic, at real size ~67 women / ~72 men, Black faces a few
//    mm longer) and the condylion's place re the porion (the condyle in its fossa ~11-13 mm ahead of the porion, 2-3 mm under the FH),
//    as recalled; the mandible is then SOLVED between the condyle and the living menton (skull.js).
//  - the face's vertical chain: cephalometric norms (Bjork; Downs FMA 25 +- 5 deg; Tweed FMIA 65, IMPA 90-95; overjet and overbite
//    2-3 mm; upper incisor to FH ~ 110-115 deg) and the resting incisor display (Vig and Brundo 1978: ~3.4 mm young women, ~1.9 mm young
//    men, falling to ~0 by the 60s), at real (not radiographic, ~8 % magnified) size.
//  - globe: Hertel exophthalmometry (the corneal apex ahead of the lateral orbital rim) by group, as recalled: East Asian ~14, white ~16,
//    Black ~18 mm (women ~0.5 less); the globe's centre ~12.5 mm behind the corneal apex, ~1.5 mm above and ~0.5 mm lateral to the
//    aperture's centre.
//  - nasal bone angles and the nasion subtense CHECKED against the ten HSRD-100 heads' midline profiles (anat8_scans.mjs: the bridge
//    ~19-24 mm and the radix ~13-17 mm ahead of the corneal apex), +4 deg on the recalled angles, +2-3 mm NAS for the Black means.
//  - age remodelling (from 30, per decade, as recalled from the direction and rough size of): Shaw and Kahn 2007 (glabellar and pyriform
//    angles), Kahn and Shaw 2008 (orbital aperture enlarges supero-medially and infero-laterally), Shaw et al. 2010 (maxillary angle
//    falls ~10 deg young -> old; the pyriform aperture widens and recedes), Shaw et al. 2011 (mandible: gonial angle opens, ramus and body
//    height fall, the chin recedes a little), Mendelson and Wong 2012 (review).
// The HSRD-100 heads (CC BY 4.0) and published CT studies are for MEASURING the built skull and the skin over it (validation), never a
// source of shape.
export const SKULL_KEYS = ['GOL', 'XCB', 'BBH', 'XFB', 'WFB', 'ZYB', 'AUB', 'NPH', 'NLH', 'NLB', 'OBH', 'OBB', 'DKB', 'MAB', 'GLS', 'BNL', 'BPL', 'MDH',
  'goGo', 'coCo', 'RH', 'RB', 'gonial', 'symph', 'bodyH', 'chinB', 'chinProj', 'malarProj', 'nasalLen', 'nasalAng', 'browRidge', 'frontalSlope', 'hertel', 'progn', 'nasDepth',
  'GoMe', 'CoY', 'CoZ'];
export const DEF = {
  GOL: 'glabello-occipital length', XCB: 'maximum cranial breadth (euryon)', BBH: 'basion-bregma height', XFB: 'maximum frontal breadth', WFB: 'minimum frontal breadth (behind the orbits)',
  ZYB: 'bizygomatic breadth', AUB: 'biauricular breadth (zygomatic process roots, ~ biporion + 4)', NPH: 'nasion-prosthion (upper facial) height', NLH: 'nasal height (nasion-nasospinale)',
  NLB: 'nasal (piriform) breadth', OBH: 'orbit height', OBB: 'orbit breadth (from dacryon)', DKB: 'interorbital breadth (dacryon-dacryon)', MAB: 'external palate breadth (maxillo-alveolar)',
  GLS: 'glabella projection (ahead of the nasion-bregma line)', BNL: 'basion-nasion length', BPL: 'basion-prosthion length', MDH: 'mastoid height (below FH)',
  goGo: 'bigonial breadth', coCo: 'bicondylar breadth', RH: 'ramus height (condylion-gonion)', RB: 'minimum ramus breadth', gonial: 'gonial angle (deg)', symph: 'symphysis height (infradentale-menton)',
  bodyH: 'mandibular body height at M1', chinB: 'chin breadth (between the mental tubercles)', chinProj: 'pogonion ahead of infradentale (mm)', malarProj: 'malar body ahead of orbitale (mm, negative = behind)',
  nasalLen: 'nasal bone length (nasion-rhinion)', nasalAng: 'nasal bone angle from the FH normal (deg, forward)', browRidge: 'supraorbital torus radius (mm)', frontalSlope: 'frontal inclination from the FH normal (deg)',
  hertel: 'corneal apex ahead of the lateral orbital rim (mm)', progn: 'alveolar prognathism: prosthion ahead of nasion (mm)',
  nasDepth: 'nasion subtense: nasion ahead of the frontomalare (lateral orbital rim) chord (Howells NAS; the transverse flatness of the upper face)',
  GoMe: 'mandibular body length gonion-menton, projected on the midsagittal plane (cephalometric, at real size)', CoY: 'condylion height re the FH (mm, - = below)',
  CoZ: 'condylion ahead of the porion (mm)',
};
// means by population and sex (mm, deg)
const W_M = { GOL: 189, XCB: 140, BBH: 133, XFB: 121, WFB: 97, ZYB: 131, AUB: 122, NPH: 71, NLH: 52, NLB: 24.5, OBH: 33.5, OBB: 40, DKB: 22, MAB: 63, GLS: 4.5, BNL: 102, BPL: 96, MDH: 29,
  goGo: 99, coCo: 121, RH: 61, RB: 32, gonial: 121, symph: 32, bodyH: 29, chinB: 26, chinProj: 1.5, malarProj: -4, nasalLen: 24, nasalAng: 36, browRidge: 5.5, frontalSlope: 18, hertel: 16, progn: 1, nasDepth: 19 , GoMe: 72, CoY: -2.5, CoZ: 12.5 };
const W_F = { GOL: 179, XCB: 135, BBH: 126, XFB: 116, WFB: 93, ZYB: 123, AUB: 114, NPH: 66, NLH: 48.5, NLB: 23.5, OBH: 33, OBB: 38.5, DKB: 21, MAB: 59, GLS: 2, BNL: 96, BPL: 91, MDH: 24,
  goGo: 91, coCo: 113, RH: 54, RB: 30, gonial: 125, symph: 29, bodyH: 26, chinB: 21, chinProj: 0.8, malarProj: -3, nasalLen: 22, nasalAng: 34, browRidge: 3.6, frontalSlope: 10, hertel: 15.5, progn: 1.5, nasDepth: 17 , GoMe: 67, CoY: -2, CoZ: 11.5 };
const B_M = { ...W_M, GOL: 186, XCB: 133, BBH: 130, XFB: 113, WFB: 94, ZYB: 130, AUB: 118, NPH: 67, NLH: 49, NLB: 27.5, OBH: 33, OBB: 39.5, DKB: 25, MAB: 66, GLS: 2.5, BNL: 100, BPL: 102, MDH: 27,
  goGo: 99, coCo: 119, RH: 60, RB: 33, gonial: 120, symph: 33, bodyH: 30, chinB: 25, chinProj: 0.5, malarProj: -3, nasalLen: 20, nasalAng: 30, browRidge: 4.8, frontalSlope: 12, hertel: 18, progn: 6, nasDepth: 19 , GoMe: 75, CoY: -2.5, CoZ: 13 };
const B_F = { ...W_F, GOL: 178, XCB: 128, BBH: 124, XFB: 109, WFB: 91, ZYB: 122, AUB: 111, NPH: 63, NLH: 46, NLB: 26.5, OBH: 32.5, OBB: 38, DKB: 24, MAB: 62, GLS: 1, BNL: 95, BPL: 97, MDH: 23,
  goGo: 92, coCo: 112, RH: 53, RB: 31, gonial: 124, symph: 30, bodyH: 27, chinB: 21, chinProj: 0, malarProj: -2.5, nasalLen: 18.5, nasalAng: 28, browRidge: 3.2, frontalSlope: 8, hertel: 17.5, progn: 6.5, nasDepth: 18.5 , GoMe: 70, CoY: -2, CoZ: 12 };
const A_M = { ...W_M, GOL: 181, XCB: 141, BBH: 137, XFB: 117, WFB: 94, ZYB: 135, AUB: 125, NPH: 72, NLH: 53, NLB: 26, OBH: 35, OBB: 40, DKB: 21, MAB: 64, GLS: 2.5, BNL: 100, BPL: 97, MDH: 28,
  goGo: 104, coCo: 124, RH: 62, RB: 32, gonial: 121, symph: 33, bodyH: 29, chinB: 25, chinProj: 0.5, malarProj: -1, nasalLen: 19, nasalAng: 26, browRidge: 4.3, frontalSlope: 15, hertel: 14, progn: 2.5, nasDepth: 14 , GoMe: 73, CoY: -2.5, CoZ: 12.5 };
const A_F = { ...W_F, GOL: 173, XCB: 135, BBH: 130, XFB: 112, WFB: 90, ZYB: 127, AUB: 118, NPH: 68, NLH: 50, NLB: 25, OBH: 34.5, OBB: 38.5, DKB: 20.5, MAB: 60, GLS: 1, BNL: 95, BPL: 93, MDH: 24,
  goGo: 96, coCo: 116, RH: 55, RB: 30, gonial: 124, symph: 30, bodyH: 26, chinB: 21, chinProj: 0, malarProj: -0.5, nasalLen: 17.5, nasalAng: 24, browRidge: 3.0, frontalSlope: 8, hertel: 13.5, progn: 3, nasDepth: 13 , GoMe: 68, CoY: -2, CoZ: 11.5 };
const I_M = { ...W_M, GOL: 178, XCB: 140, BBH: 134, XFB: 115, WFB: 93, ZYB: 137, AUB: 124, NPH: 71, NLH: 52, NLB: 25.5, OBH: 35, OBB: 40, DKB: 22, MAB: 64, GLS: 3.5, BNL: 100, BPL: 97, MDH: 28,
  goGo: 103, coCo: 123, RH: 62, RB: 33, gonial: 120, symph: 33, bodyH: 30, chinB: 26, chinProj: 1, malarProj: -1.5, nasalLen: 22, nasalAng: 32, browRidge: 5, frontalSlope: 17, hertel: 15, progn: 2.5, nasDepth: 15.5 , GoMe: 73, CoY: -2.5, CoZ: 12.5 };
const I_F = { ...W_F, GOL: 170, XCB: 135, BBH: 128, XFB: 111, WFB: 90, ZYB: 129, AUB: 117, NPH: 66, NLH: 49, NLB: 24.5, OBH: 34, OBB: 38.5, DKB: 21, MAB: 60, GLS: 1.5, BNL: 94, BPL: 92, MDH: 24,
  goGo: 95, coCo: 115, RH: 55, RB: 30, gonial: 123, symph: 30, bodyH: 26.5, chinB: 22, chinProj: 0.5, malarProj: -1, nasalLen: 20, nasalAng: 29, browRidge: 3.3, frontalSlope: 9, hertel: 14.5, progn: 3, nasDepth: 14.5 , GoMe: 68, CoY: -2, CoZ: 11.5 };
export const SKULL_POP = { white: { m: W_M, f: W_F }, black: { m: B_M, f: B_F }, asian: { m: A_M, f: A_F }, amerind: { m: I_M, f: I_F } };
// within-sex SDs (men; women x 0.95 except the angles)
export const SKULL_SD = { GOL: 6.0, XCB: 5.0, BBH: 4.8, XFB: 4.5, WFB: 4.2, ZYB: 4.6, AUB: 4.5, NPH: 3.8, NLH: 2.8, NLB: 1.8, OBH: 1.8, OBB: 1.6, DKB: 2.2, MAB: 3.0, GLS: 1.5, BNL: 4.0, BPL: 4.5, MDH: 2.8,
  goGo: 6, coCo: 5.5, RH: 4.5, RB: 3, gonial: 6, symph: 3, bodyH: 2.5, chinB: 3, chinProj: 2.5, malarProj: 2.5, nasalLen: 3, nasalAng: 5, browRidge: 1.0, frontalSlope: 5, hertel: 2, progn: 2.5, nasDepth: 2.5,
  GoMe: 4.5, CoY: 1.3, CoZ: 1.8 };
const ANGLES = new Set(['gonial', 'nasalAng', 'frontalSlope']);
export const sdOf = (k, sex) => SKULL_SD[k] * (sex === 'f' && !ANGLES.has(k) ? 0.95 : 1);
// the studio's groups -> the skull tables' populations (OUR assumption: Hispanic = European + Amerindian + some African ancestry,
// unlike the face tables' white / black / asian split of lane A, because the craniometry of Amerindian groups is not East Asian)
export const SKULL_MIX = { white: { white: 1 }, black: { black: 1 }, asian: { asian: 1 }, hispanic: { white: 0.5, amerind: 0.35, black: 0.15 } };
export function popMeans(sex, mix) { const s = sex === 'm' ? 'm' : 'f', out = {}; let tot = 0;
  for (const [g, w] of Object.entries(mix)) { if (!w || !SKULL_POP[g]) continue; tot += w; for (const k of SKULL_KEYS) out[k] = (out[k] || 0) + w * SKULL_POP[g][s][k]; }
  for (const k of SKULL_KEYS) out[k] /= tot || 1; return out; }
// correlations with the living-head anchors (a factor model, OUR approximation of the craniometric covariance): each unanchored key's
// z leans on the anchors' z (size: the vault; height: n-me; width: zy-zy) by these loadings
export const LOADINGS = { GoMe: { size: 0.3, height: 0.3 }, CoZ: { size: 0.4 }, NPH: { height: 0.7 }, NLH: { height: 0.55 }, OBH: { height: 0.3 }, RH: { height: 0.45 }, symph: { height: 0.5 }, bodyH: { height: 0.35 }, BNL: { size: 0.5 }, BPL: { size: 0.4 },
  goGo: { width: 0.6 }, coCo: { width: 0.7 }, MAB: { width: 0.45 }, NLB: { width: 0.3 }, OBB: { width: 0.45 }, DKB: { width: 0.25 }, AUB: { width: 0.75 }, XFB: { size: 0.6 }, WFB: { size: 0.5 }, BBH: { size: 0.45 }, MDH: { size: 0.3 } };
// age remodelling: change per decade after 30 (mm or deg); the eye's support (orbit, maxilla, pyriform) and the jaw
export const AGE_PER_DECADE = { OBH: 0.3, OBB: 0.15, NLB: 0.3, progn: -0.45, malarProj: -0.35, gonial: 0.8, RH: -0.4, bodyH: -0.2, chinProj: -0.15, orbitRim: -0.4, display: -0.75 };
// teeth (crown heights, mm) and the incisor relation
export const TEETH = { crown: { m: [10.5, 9.0, 10.0, 8.2, 7.6, 7.0, 6.8, 6.5], f: [10.0, 8.6, 9.5, 7.9, 7.3, 6.8, 6.5, 6.2] }, lowCrown: { m: [9.2, 9.4, 11, 8.2, 7.8, 7.5, 7.0, 6.8], f: [8.8, 9.0, 10.5, 7.9, 7.5, 7.2, 6.8, 6.5] },
  width: [8.6, 6.6, 7.6, 7.0, 6.6, 10.3, 9.2, 8.6], lowWidth: [5.4, 5.9, 6.9, 7.0, 7.2, 11.2, 10.5, 10.0], thick: [7.0, 6.2, 8.0, 9.3, 9.1, 11.2, 11.0, 10.6],
  upperInc: { white: 22, black: 28, asian: 25, amerind: 24 }, lowerInc: { white: 25, black: 32, asian: 28, amerind: 27 }, overjet: 2.5, overbite: 2.3,
  display: { f: 3.4, m: 1.9 } };
