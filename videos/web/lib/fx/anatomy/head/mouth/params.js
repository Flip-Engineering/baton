// NOSE AND MOUTH (round 7 studio, 8 Oct): THE MOUTH'S ANATOMY AS DATA (the lips' layers on the teeth, the orbicularis oris' two parts,
// the philtrum, the modiolus). As nose/params.js: every number is OUR reading of the literature, 'AS RECALLED' (nothing fetched on this
// box), provisional, rounded; the photographs and the HSRD-100 scans CHECK the built lips, they never set them. Sources, by what they give:
//  - THE ORBICULARIS ORIS' TWO PARTS and THE PHILTRUM: Lightoller 1925 (J Anat 60:1, the pars marginalis and pars peripheralis);
//    Latham and Deaton 1976 (J Anat 121:151, 'The structural basis of the philtrum and the contour of the vermilion border': the peripheral
//    fibres DECUSSATE at the midline and insert into the dermis of the opposite side, raising the PHILTRAL COLUMNS; the dimple between them
//    has no insertion; the marginal part's outward curl (eversion) under the vermilion makes the border's ROLL and the cupid's bow's peaks
//    stand at the columns' feet); Briedis and Jackson 1981 (Br J Plast Surg 34:128: the columns ~ 6 mm apart at the columella's base,
//    diverging to ~ 10-12 mm at the vermilion); Rogers et al. 2009 (J Anat 214:36, the orbicularis oris' fibre layers).
//  - THE MODIOLUS: Al-Hoqail and Abdel Meguid 2009 (Aesthetic Plast Surg 33:147: the modiolus ~ 11-12 mm lateral to the commissure, a
//    fibromuscular node where the zygomaticus major, levator anguli oris, risorius, depressor anguli oris, buccinator and orbicularis oris
//    meet; the commissure tucks in medial to it); Yu et al. 2013 (the modiolus' types, as recalled).
//  - THE LIPS' LAYERS AND THE TEETH: the incisor display at rest (Vig and Brundo 1978, J Prosthet Dent 39:502: ~ 3.4 mm young women,
//    ~ 1.9 young men, falling ~ 0.7 mm a decade: skull/tables.js TEETH.display, ANAT8-HEAD's); the lips' soft-tissue depth over the incisors
//    (the forensic tables via FACE P2: ls ~ 11-13, li ~ 12-14 mm; Stephan and Simpson 2008); the minor (labial) salivary glands in the
//    submucosa (a layer ~ 1-3 mm, as recalled from histology texts); the vermilion's epithelium thin, keratinised, without hair follicles,
//    its dermal papillae tall with capillary loops near the surface (the red: SKIN OPTICS' input, here only the region).
//  - THE LIPS' MEASURES BY POPULATION (to set the parts' sizes by group; the scans and photographs check): Farkas 1994 (white young adults:
//    ch-ch m ~ 53 / f ~ 50; upper vermilion ls-sto ~ 8 / 7.5; lower sto-li ~ 9.5 / 9; sn-sto m ~ 22 / f ~ 20); Farkas et al. 2005 (the
//    international study: fuller vermilion in African groups); Porter and Olson 2001 (African-American women: the vermilion heights ~ 1.4x
//    the white norm, ch-ch ~ 53); AUDIT7 (our photographs, 8 Oct): DO NOT ENLARGE THE LIPS (our lower vermilion already p48-p96 of the
//    rest-face photos); the lips' colour, surface and the pout are the gap.
//  - THE UPPER LIP'S LENGTH IS THE TISSUE'S, NOT THE BONE'S (iteration 2, 8 Oct): the upper lip's rest length sn-sto (lipLen) is a
//    soft-tissue dimension that does NOT scale with the maxilla's height: a long maxilla shows as MORE INCISOR at rest (vertical maxillary
//    excess: the display is the outcome), not as a longer lip (Burstone 1967, Am J Orthod 53:262; Arnett and Bergman 1993, Am J Orthod
//    Dentofac Orthop 103:299 and 395: upper lip 19-22 mm, incisor exposure 1-5 mm at rest; Vig and Brundo 1978: the display falls with age
//    as the lip lengthens). Values: Farkas 1994 (North American white, 19-25 y, sn-sto direct: m ~ 22.1, f ~ 19.9); Farkas et al. 2005 and
//    Porter and Olson 2001 (African-American: ~ 1.2-1.5 mm longer); Farkas et al. 2005 (Han Chinese: ~ 0.5-0.8 mm shorter); the Amerind row
//    has no direct source here (between the white and the East Asian rows: said so); age + 0.6 mm a decade from 30 (Iblher et al. 2008, MRI:
//    the upper lip lengthens), all AS RECALLED. The STOMION is the lip's end (mouth/index.js), the incisor display is REPORTED (ANAT8-HEAD's skull).
//  - AGE: Iblher et al. 2008 (J Plast Reconstr Aesthet Surg 61:1170: the upper lip lengthens and the vermilion thins with age, MRI);
//    Penna et al. 2009 (Plast Reconstr Surg 124:624: the orbicularis oris thins, its fibres fragment, with age); the philtral columns
//    flatten and the corners drop (the modiolus descends with the face's ligaments: ANAT8-HEAD's laxity).
import { SKULL_MIX } from '../../skull/tables.js';
export const MOUTH_PARAMS_VERSION = 2;   // 2 (8 Oct, iteration 2): lipLen (the upper lip's rest length: the stomion is the tissue's); margB / margBL scatter positive (was -0.1 / -0.4: a sign flip that read as a nudge)
//  verU / verL   the upper / lower vermilion height at the midline (mm): the marginal part's height under the red lip
//  bowH          the cupid's bow: the peaks' rise above the midline's border; philW the bow's peaks apart (the columns' feet)
//  colW0         the philtral columns apart at the columella's base; colH their relief (the decussating insertions' bulk under the dermis)
//  tMG           the mucosa + labial glands over the teeth; mgU / mgL its upper / lower lip value
//  margB         the marginal part's half-depth at the midline (its bulk: the tubercle); margTaper its fraction left at the commissure;
//                with the glands and the vermilion it makes the lip's depth over the incisor (the forensic ls ~ 11-12.5 women, ~ 12.5-13.5 men)
//  periT         the peripheral part's thickness (the cutaneous lip's muscle)
//  cornerT       the commissure out from the canine-first premolar contact's labial surface (the cheek's and the lips' tissue at the
//                corner, ~ 9-12 mm: the mouth's width and the corners' depth follow the dental arch)
//  modL          the modiolus lateral to the commissure; cornerLift the commissure above the stomion's midline (young + / old -)
//  fatLip        the cutaneous lip's subcutaneous layer; dermU / dermL its dermis (+ epidermis), thicker in men (the beard's follicles);
//  vermEnv       the vermilion's lamina propria + epithelium over the marginal part
//  lipLen        the upper lip's rest length sn-sto (direct, mm): the stomion lies lipLen from the subnasale along the lip
const WF = { verU: 7.4, verL: 8.8, bowH: 1.9, philW: 10.6, colW0: 6.0, colH: 0.9, mgU: 3.0, mgL: 3.2, margB: 2.6, margBL: 2.6, margTaper: 0.35, periT: 3.0, cornerT: 9.5, modL: 11, cornerLift: 0.4,
  fatLip: 1.0, dermU: 1.3, dermL: 1.3, vermEnv: 0.75, lipLen: 19.9 };
const WM = { ...WF, verU: 7.9, verL: 9.4, bowH: 1.6, philW: 11.4, colW0: 6.6, colH: 0.8, mgU: 3.3, mgL: 3.4, margB: 2.9, margBL: 2.9, periT: 3.5, cornerT: 10.5, modL: 12, cornerLift: 0.1, dermU: 1.7, dermL: 1.6, lipLen: 22.1 };
const BF = { ...WF, verU: 10.0, verL: 11.6, bowH: 1.4, philW: 11.6, colW0: 6.6, colH: 0.7, mgU: 3.6, mgL: 3.8, margB: 3.3, margBL: 3.4, periT: 3.2, cornerT: 10.5, cornerLift: 0.3, lipLen: 21.2 };
const BM = { ...WM, verU: 10.6, verL: 12.2, bowH: 1.2, philW: 12.2, colW0: 7.0, colH: 0.6, mgU: 3.8, mgL: 4.0, margB: 3.6, margBL: 3.7, periT: 3.7, cornerT: 11.5, cornerLift: 0.0, lipLen: 23.5 };
const AF = { ...WF, verU: 7.8, verL: 9.4, bowH: 1.5, philW: 10.8, colW0: 6.2, colH: 0.7, mgU: 3.2, mgL: 3.4, margB: 2.8, margBL: 2.8, cornerT: 9.8, cornerLift: 0.2, lipLen: 19.3 };
const AM = { ...WM, verU: 8.4, verL: 10.0, bowH: 1.3, philW: 11.6, colW0: 6.8, colH: 0.6, mgU: 3.4, mgL: 3.6, margB: 3.0, margBL: 3.1, cornerT: 10.6, cornerLift: 0.0, lipLen: 21.4 };
const IF = { ...WF, verU: 7.8, verL: 9.2, bowH: 1.6, philW: 10.8, mgU: 3.2, mgL: 3.4, margB: 2.8, margBL: 2.8, cornerT: 9.8, lipLen: 19.6 };
const IM = { ...WM, verU: 8.3, verL: 9.8, bowH: 1.4, philW: 11.6, mgU: 3.4, mgL: 3.6, margB: 3.1, margBL: 3.1, cornerT: 10.8, lipLen: 21.7 };
export const MOUTH_POP = { white: { f: WF, m: WM }, black: { f: BF, m: BM }, asian: { f: AF, m: AM }, amerind: { f: IF, m: IM } };
export const MOUTH_SD = { verU: 1.3, verL: 1.4, bowH: 0.5, philW: 1.0, colW0: 0.6, colH: 0.2, mgU: 0.3, mgL: 0.3, margB: 0.3, margBL: 0.3, periT: 0.35, cornerT: 0.6, modL: 1.2, cornerLift: 0.4, lipLen: 1.9 };
export const MOUTH_TISSUE = {
  marginalis: { E: 12000, nu: 0.49, rho: 1060, src: 'orbicularis oris, pars marginalis: relaxed muscle (FACE_TISSUE.muscle), as recalled' },
  peripheralis: { E: 12000, nu: 0.49, rho: 1060, src: 'orbicularis oris, pars peripheralis, as recalled' },
  glands: { E: 3000, nu: 0.49, rho: 1040, src: 'the labial minor salivary glands and submucosa, as recalled' },
  modiolus: { E: 40000, nu: 0.47, rho: 1080, src: 'the modiolus: a dense fibromuscular node (stiffer than relaxed muscle), as recalled' },
  columns: { E: 20000, nu: 0.48, rho: 1060, src: 'the philtral columns: decussating fibres inserting into the dermis, as recalled' },
};
function rng(seed) { let s = 2166136261 >>> 0; for (const c of String(seed)) { s ^= c.charCodeAt(0); s = Math.imul(s, 16777619) >>> 0; } return () => { s = (Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0; s ^= s >>> 16; return s / 4294967296; }; }
const gauss = r => { let u = 0; while (u <= 1e-9) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
export function mouthParams(info, o = {}) {
  const sex = info.sex === 'm' ? 'm' : 'f', age = info.age ?? 35, mix = o.mix || SKULL_MIX[info.group] || SKULL_MIX.white, r = rng('mouth:' + (info.name || '') + ':' + (o.seed ?? 1)), sc = o.scatter ?? 0.6;
  let tot = 0; const P = {};
  for (const [g, w] of Object.entries(mix)) { const T = MOUTH_POP[g]?.[sex]; if (!T || !w) continue; tot += w; for (const [k, v] of Object.entries(T)) P[k] = (P[k] || 0) + w * v; }
  for (const k of Object.keys(P)) P[k] /= tot;
  P.z = {}; for (const [k, sd] of Object.entries(MOUTH_SD)) { const z = Math.max(-2.2, Math.min(2.2, gauss(r))); P.z[k] = +z.toFixed(2); P[k] += sc * sd * z; }
  // AGE (per decade from 30; Iblher 2008, Penna 2009, as recalled): the vermilion thins (the marginal part and the glands shrink), the
  // columns and the bow flatten, the corners drop; the cutaneous lip's dermis thins a little
  const dec = Math.max(0, age - 30) / 10;
  P.verU *= 1 - 0.06 * dec; P.verL *= 1 - 0.05 * dec; P.margB *= 1 - 0.06 * dec; P.margBL *= 1 - 0.05 * dec; P.bowH *= 1 - 0.12 * dec; P.colH *= 1 - 0.15 * dec; P.cornerLift -= 0.35 * dec; P.mgU *= 1 - 0.03 * dec; P.dermU *= 1 - 0.03 * dec; P.lipLen += 0.6 * dec;
  for (const k of ['verU', 'verL', 'margB', 'margBL', 'periT', 'mgU', 'mgL', 'colH', 'bowH']) P[k] = Math.max(0.2, P[k]);
  if (o.over) Object.assign(P, o.over);
  P.sex = sex; P.age = age; P.mix = mix; P.version = MOUTH_PARAMS_VERSION;
  return P;
}
