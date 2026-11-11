// NOSE AND MOUTH (round 7 studio, 8 Oct): THE NOSE'S ANATOMY AS DATA. Each person's nose is built from these parameters of its PARTS
// (the cartilages' sizes, shapes, stiffness and placement on the bone; the alar lobule's thickness; the soft-tissue envelope by region),
// drawn by sex, age and ancestry from the anatomical and anthropometric literature, with the person's own scatter. Nothing here is a target
// for the skin: the skin is where the parts and their envelope put it (nose/index.js), and the photographs and the HSRD-100 scans only
// CHECK the result (labs/nosemouth/nm_measure.mjs).
// EVERY NUMBER IS OUR READING OF THE LITERATURE, 'AS RECALLED' (no paper was fetched on this box; arxiv is blocked): rounded, provisional,
// to be re-checked against the papers when a reader can fetch them. Sources, by what they give:
//  - the LOWER LATERAL CARTILAGES' size: Zelnik and Gingrass 1979 (Plast Reconstr Surg 64:650: lateral crus ~22 mm long, ~11 mm wide in
//    adult cadavers; medial crus with its footplate ~ 15-18 mm); Daniel 1992 (PRS 89:216, 'The nasal tip: anatomy and aesthetics': the
//    medial crus = footplate + columellar segment, the intermediate crus = lobular + domal segments, the domes as the tip-defining points,
//    the columella : lobule ratio ~ 2 : 1 from the base); Oneal and Beil 2010 (Clin Plast Surg 37:191, 'Surgical anatomy of the nose': the
//    keystone (the upper laterals under the nasal bones' caudal edge, ~ 4-8 mm), the scroll (the lower lateral's cephalic edge over the
//    upper lateral's caudal edge), the alar lobule of fibrofatty tissue WITHOUT cartilage at its rim, the lateral crus diverging from the
//    alar rim toward the aperture); Sheen and Sheen 1987 (Aesthetic Rhinoplasty: the lateral crus' axis ~ 45 deg off the midline, 'cephalic
//    malposition' when it runs nearer the dorsum); Anderson 1969 (the tripod: two lateral crura and the conjoined medial crura carry the tip).
//  - the SEPTUM and the UPPER LATERALS: Oneal and Beil 2010; Lessard and Daniel 1985 (Arch Otolaryngol 111:25, 'Surgical anatomy of
//    septorhinoplasty': the soft-tissue envelope thickest at the nasion ~ 6 mm, thinnest at the rhinion ~ 2 mm, ~ 3 mm over the supratip and
//    the tip); the quadrangular cartilage ~ 1.5-3 mm thick at its base, ~ 1 mm mid-plate (as recalled).
//  - CARTILAGE MECHANICS (for ANAT8-HEAD's solve and for tip support): Richmon et al. 2005 (Am J Rhinol 19:617: septal cartilage tensile
//    modulus of a few MPa); Grellmann et al. 2006 (J Biomed Mater Res A 78:168: septal vs alar cartilage, alar the more compliant);
//    Westreich et al. 2007 (Arch Facial Plast Surg 9:264: the tip's support by the lateral crura as cantilevers): septal ~ 3-6 MPa, alar
//    ~ 1-3 MPa (order of magnitude, as recalled).
//  - the NOSE'S MEASURES BY POPULATION (used ONLY to set the parts' sizes by group; the scans and photographs check the result): Farkas 1994
//    (Anthropometry of the Head and Face, 2nd ed.: North American white young adults al-al m 34.9 +- 2.1 / f 31.4 +- 2.0, n-sn m 54.8 / f
//    50.6, sn-prn m ~ 20 / f ~ 19); Farkas et al. 2005 (J Craniofac Surg 16:615, the international study: African-American, Chinese, Japanese,
//    Indian and other groups: the nose wider and the tip less projected than the white norm in African and East Asian groups);
//    Porter and Olson 2001 (Arch Facial Plast Surg 3:191, African-American women: al-al ~ 39-40, nasolabial angle ~ 85-90 deg, tip
//    protrusion short, columella short); Ofodile, Bokhari and Ellis 1993 (Ann Plast Surg 31:209, the Black American nose: three types,
//    the base wide, the alae thick and flared, the skin thick); Rohrich and Muzaffar 2003 (Plast Reconstr Surg 111:1322: in the
//    African-American nose a short columella, weak medial crura, a wide base and thick fibrofatty alae and tip skin); Choe et al. 2004
//    (Arch Facial Plast Surg 6:244, Korean-American women: al-al ~ 37) and Le, Farkas et al. 2002 (Aesthetic Plast Surg 26:64: in Chinese
//    adults the nose wider than the intercanthal width in most); Milgrim, Lawson and Cohen 1996 (Arch Otolaryngol Head Neck Surg 122:1079,
//    the Latina nose) and Daniel 2003 (PRS 112:244, the Mexican-American nose: thicker skin, weaker tip support, wider base than the white
//    norm); the nasolabial angle norms (white women ~ 100-110, men ~ 90-100 deg; Legan and Burstone 1980 J Oral Surg 38:744).
//  - AGE: Sforza et al. 2011 (Forensic Sci Int 204:205: the external nose keeps growing in adults, its length and width ~ +1 mm a decade
//    from the 30s, the tip dropping); Rohrich and Hollier 1996 (Clin Plast Surg 23:255, the ageing nose: the tip's support weakens (the
//    medial crura's footplates and the scroll's attachments loosen), the tip droops and lengthens, the skin of the lower third thickens
//    (sebaceous) in men).
// Population GROUPS are the studio's (white, black, asian, hispanic); 'amerind' and the hispanic mix as skull/tables.js SKULL_MIX (the
// Mexican-American / mestizo nose of Daniel 2003 sits between the white and the Amerind values).
import { SKULL_MIX } from '../../skull/tables.js';
export const NOSE_PARAMS_VERSION = 1;

// per population and sex. Lengths mm, angles deg, moduli Pa. sd: the person's own scatter (a fraction of the between-person SD).
//  mcLen     medial crus incl. its footplate (the columella's cartilage), from the footplate's foot to the dome's medial genu
//  domeW     half the interdomal distance (each dome's centre off the midline) at the cartilage
//  domeR     the dome's arc radius (the intermediate crus' bend: small = a sharp, defined dome; large = a round 'bulbous' one)
//  lcLen     lateral crus length (the dome to its lateral end near the aperture); lcW its width (cephalocaudal); lcT its thickness
//  lcAx      the lateral crus' axis off the dorsum's axis on the sidewall (deg; ~45 normal, lower = 'cephalically malpositioned': Sheen)
//  cla       the columella's inclination against the upper lip's (the columella-labial angle, i.e. the nasolabial angle the medial crura make
//            on the lip the teeth hold)
//  septT     septal cartilage thickness at the dorsum; ulcT upper lateral thickness; keystone: the upper laterals' overlap under the nasal bones
//  supraBreak the dorsum at the anterior septal angle below the domes' tops (the supratip break: the cartilage, not the skin)
//  alT       the alar lobule's fibrofatty thickness at its middle (mm); alFlare its bow beyond the alar base's line (mm)
//  alBase    the alar crease's skin point (ac) lateral to the piriform aperture's widest half-breadth (mm): ac-ac = NLB + 2 alBase, al-al
//            ~ ac-ac + the flare (white women 23.5 + 7 + 1.8 ~ 32: Farkas' 31.4; Black women 26.5 + 8.8 + 3.4 ~ 39: Porter's ~ 39-40)
//  env       the soft-tissue envelope (subcutaneous + nasal SMAS + dermis + epidermis) over the cartilage, by region (Lessard and Daniel 1985)
//  thickSkin a multiplier of the envelope's tip and alar values (the sebaceous, fibrofatty thick skin of the African, East Asian and
//            mestizo noses: Rohrich 2003, Daniel 2003)
const WF = { mcLen: 15.5, domeW: 2.9, domeR: 2.3, lcLen: 21, lcW: 10.5, lcT: 0.75, lcAx: 44, cla: 104, septT: 1.6, ulcT: 0.9, keystone: 6, supraBreak: 2.0,
  alT: 3.1, alFlare: 1.8, alBase: 3.5, env: { nasion: 6.0, rhinion: 2.2, supratip: 3.0, tip: 2.9, infratip: 2.6, columella: 1.9, sidewall: 2.3, ala: 1.6 }, thickSkin: 1.0 };
const WM = { ...WF, mcLen: 16.5, domeW: 3.1, domeR: 2.6, lcLen: 22.5, lcW: 11.2, lcT: 0.85, cla: 96, septT: 1.9, ulcT: 1.0, supraBreak: 1.0, alT: 3.6, alFlare: 2.0, alBase: 3.9,
  env: { nasion: 6.6, rhinion: 2.5, supratip: 3.6, tip: 3.3, infratip: 2.9, columella: 2.1, sidewall: 2.6, ala: 1.8 } };
const BF = { ...WF, mcLen: 12.5, domeW: 3.4, domeR: 3.2, lcLen: 19, lcW: 9.5, lcT: 0.6, lcAx: 50, cla: 90, supraBreak: 0.6, alT: 4.4, alFlare: 3.4, alBase: 4.4, keystone: 5, thickSkin: 1.35 };
const BM = { ...WM, mcLen: 13.5, domeW: 3.7, domeR: 3.5, lcLen: 20.5, lcW: 10.2, lcT: 0.7, lcAx: 52, cla: 84, supraBreak: 0.3, alT: 5.0, alFlare: 3.8, alBase: 4.8, keystone: 5, thickSkin: 1.4 };
const AF = { ...WF, mcLen: 13.5, domeW: 3.2, domeR: 2.9, lcLen: 19.5, lcW: 9.8, lcT: 0.6, lcAx: 48, cla: 96, supraBreak: 0.8, alT: 3.8, alFlare: 2.6, alBase: 4.0, keystone: 4.5, thickSkin: 1.25 };
const AM = { ...WM, mcLen: 14.5, domeW: 3.4, domeR: 3.1, lcLen: 21, lcW: 10.5, lcT: 0.7, lcAx: 50, cla: 90, supraBreak: 0.5, alT: 4.3, alFlare: 2.9, alBase: 4.4, keystone: 4.5, thickSkin: 1.3 };
const IF = { ...WF, mcLen: 14.0, domeW: 3.1, domeR: 2.8, lcLen: 20, lcW: 10, lcT: 0.65, lcAx: 47, cla: 98, supraBreak: 1.0, alT: 3.8, alFlare: 2.4, alBase: 4.0, keystone: 5.5, thickSkin: 1.25 };
const IM = { ...WM, mcLen: 15.0, domeW: 3.3, domeR: 3.0, lcLen: 21.5, lcW: 10.8, lcT: 0.75, lcAx: 48, cla: 92, supraBreak: 0.6, alT: 4.2, alFlare: 2.6, alBase: 4.3, keystone: 5.5, thickSkin: 1.3 };
export const NOSE_POP = { white: { f: WF, m: WM }, black: { f: BF, m: BM }, asian: { f: AF, m: AM }, amerind: { f: IF, m: IM } };
// the between-person SDs (as recalled from the ranges the papers give: crus lengths +- 2 mm, angles +- 6-8 deg, thicknesses +- 20 %)
export const NOSE_SD = { mcLen: 1.6, domeW: 0.4, domeR: 0.5, lcLen: 1.8, lcW: 1.0, lcT: 0.12, lcAx: 6, cla: 7, septT: 0.25, ulcT: 0.12, keystone: 1.2, supraBreak: 0.6, alT: 0.5, alFlare: 0.7, alBase: 0.8, thickSkin: 0.1 };
// the cartilages' and the lobule's materials (ANAT8-HEAD's solve: bonded; the lobule is soft tissue in the solve)
export const NOSE_TISSUE = {
  septal: { E: 4.5e6, nu: 0.45, rho: 1100, src: 'septal hyaline cartilage, tensile modulus a few MPa (Richmon et al. 2005; Grellmann et al. 2006), as recalled' },
  ulc: { E: 3.0e6, nu: 0.45, rho: 1100, src: 'upper lateral cartilage (continuous with the septum), as recalled' },
  llc: { E: 2.0e6, nu: 0.45, rho: 1100, src: 'lower lateral (alar) cartilage, the more compliant (Grellmann et al. 2006; Westreich et al. 2007), as recalled' },
  alar: { E: 8000, nu: 0.48, rho: 1000, src: 'alar lobule: fibrofatty tissue, dense collagen in fat (stiffer than facial fat), as recalled' },
  envelope: { E: 6000, nu: 0.48, rho: 1000, src: 'the nasal soft-tissue envelope (fat, nasal SMAS, nasalis), as recalled' },
};
// a small seeded random (the person's own scatter, stable by name)
function rng(seed) { let s = 2166136261 >>> 0; for (const c of String(seed)) { s ^= c.charCodeAt(0); s = Math.imul(s, 16777619) >>> 0; } return () => { s = (Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0; s ^= s >>> 16; return s / 4294967296; }; }
const gauss = r => { let u = 0; while (u <= 1e-9) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
// noseParams(info, o) -> the person's parameters: info { name, sex, age, group }; o.mix (a population mix), o.scatter (0..1, default 0.6:
// the cast is 'common to attractive': averageness shrinks the scatter, as skull/skull.js's drawSkull), o.over (explicit values, for A/Bs)
export function noseParams(info, o = {}) {
  const sex = info.sex === 'm' ? 'm' : 'f', age = info.age ?? 35, mix = o.mix || SKULL_MIX[info.group] || SKULL_MIX.white, r = rng('nose:' + (info.name || '') + ':' + (o.seed ?? 1)), sc = o.scatter ?? 0.6;
  let tot = 0; const P = { env: {} };
  for (const [g, w] of Object.entries(mix)) { const T = NOSE_POP[g]?.[sex]; if (!T || !w) continue; tot += w;
    for (const [k, v] of Object.entries(T)) { if (k === 'env') { for (const [e, ev] of Object.entries(v)) P.env[e] = (P.env[e] || 0) + w * ev; } else P[k] = (P[k] || 0) + w * v; } }
  for (const k of Object.keys(P)) if (k !== 'env') P[k] /= tot; for (const e of Object.keys(P.env)) P.env[e] /= tot;
  // the person's scatter (z ~ N(0, 1) per key, scaled)
  P.z = {}; for (const [k, sd] of Object.entries(NOSE_SD)) { const z = Math.max(-2.2, Math.min(2.2, gauss(r))); P.z[k] = +z.toFixed(2); P[k] += sc * sd * z; }
  // AGE (from 30, per decade): the tip's support weakens (the medial crura's footplates and the scroll loosen): the columella-labial angle
  // closes (the tip droops), the domes lose definition (a rounder arc), the lobule and the envelope's lower third thicken a little, the
  // nose lengthens and widens ~ 1 mm a decade (Sforza 2011; Rohrich and Hollier 1996), as recalled
  const dec = Math.max(0, age - 30) / 10;
  P.cla -= 1.6 * dec; P.domeR += 0.12 * dec; P.alT += 0.12 * dec; P.alFlare += 0.15 * dec; P.lcLen += 0.35 * dec; P.mcLen -= 0.35 * dec; P.supraBreak -= 0.15 * dec;   // the medial crura's effective height falls (the footplates loosen, the crura buckle): the tip rotates down AND loses projection
  for (const e of ['tip', 'infratip', 'supratip', 'ala']) P.env[e] *= 1 + (sex === 'm' ? 0.04 : 0.025) * dec;
  for (const e of ['tip', 'infratip', 'supratip', 'ala', 'columella']) P.env[e] *= P.thickSkin;
  P.lcT = Math.max(0.4, P.lcT); P.domeR = Math.max(1.6, P.domeR); P.supraBreak = Math.max(0, P.supraBreak);
  if (o.over) Object.assign(P, o.over);
  P.sex = sex; P.age = age; P.mix = mix; P.version = NOSE_PARAMS_VERSION;
  return P;
}
