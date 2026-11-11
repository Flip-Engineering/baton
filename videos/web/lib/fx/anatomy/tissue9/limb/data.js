// ANATOMY / TISSUE9 / LIMB / DATA (TISSUE9-LIMB, round 8, 16 Oct 2026): the lower limb's tissue INPUTS (volumes and architecture), never a shape. Carried
// over from the paused lanes as data (ANAT8-PELVIS: pelvis/muscles.js PELVIS_MUSCLE_REF, KNEE_FAT_REF, LEAN, legLean; pelvis/thigh.js THIGH_MUSCLES /
// CRUS_MUSCLES belly extents; pelvis/fat.js DEPOTS, LEG_PROFILE, ADIPOSE_PER_LIPID; pelvis/data.js NHANES 2017-18 regional DXA fat, public domain),
// each marked as its source marked it (RECALLED = typed from memory, to verify against the table). Nothing here is fitted to a render or a photograph.
export { regionalFat, NHANES_SOURCE } from '../../pelvis/data.js';
import { muscleScale } from '../../muscle/index.js';

// one side, cm3, the cohort's means: Handsfield et al 2014 (J Biomech 47:631; MRI of 35 lower-limb muscles, 24 young adults; RECALLED, to verify), and the
// musclePattern key (ANAT8-BODY's muscleScale) that redistributes volume between groups. rotators: piriformis, the obturators, the gemelli and quadratus
// femoris together (RECALLED from MRI volumetry ~120 cm3, to verify)
export const MUSCLE_REF = {
  gluteusMaximus: [847, 'gluteMax'], gluteusMedius: [323, 'gluteMed'], gluteusMinimus: [104, 'gluteMed'], tensorFasciaeLatae: [66, 'gluteMed'], rotators: [120, 'gluteMed'],
  psoas: [274, 'rectusFem'], iliacus: [214, 'rectusFem'], pectineus: [54, 'adductors'],
  adductorLongus: [175, 'adductors'], adductorBrevis: [119, 'adductors'], adductorMagnus: [559, 'adductors'], gracilis: [109, 'adductors'], sartorius: [154, 'rectusFem'],
  rectusFemoris: [269, 'rectusFem'], vastusLateralis: [581, 'vastusLat'], vastusIntermedius: [374, 'vastusLat'], vastusMedialis: [377, 'vastusMed'],
  semitendinosus: [213, 'hamstrings'], semimembranosus: [249, 'hamstrings'], bicepsFemorisLong: [227, 'hamstrings'], bicepsFemorisShort: [113, 'hamstrings'],
  gastrocnemiusMedialis: [257, 'gastroc'], gastrocnemiusLateralis: [150, 'gastroc'], soleus: [438, 'soleus'], popliteus: [20, 'soleus'], tibialisPosterior: [104, 'soleus'],
  flexorDigitorumLongus: [29, 'soleus'], flexorHallucisLongus: [89, 'soleus'], tibialisAnterior: [136, 'tibialisAnt'], extensorDigitorumLongus: [103, 'tibialisAnt'],
  extensorHallucisLongus: [39, 'tibialisAnt'], fibularisLongus: [130, 'tibialisAnt'], fibularisBrevis: [66, 'tibialisAnt'] };
// adductor magnus' two parts share its volume (~55 / 45, an assumption: the ischiocondylar part is the posteromedial mass of the atlas section)
export const SPLIT = { adductorMagnus: ['adductorMagnus', 0.55], adductorMagnusIschial: ['adductorMagnus', 0.45] };
// the knee's fat bodies, one side, cm3 at a reference stature (f 1.63, m 1.77 m; x stature cubed): infrapatellar (Hoffa's) pad MRI volumetry ~20-25 cm3
// in women, ~28-33 in men (OAI cohorts; RECALLED); the suprapatellar + prefemoral pads and the popliteal fossa's fat ESTIMATED from their extents
export const KNEE_FAT_REF = { infrapatellarFat: { f: 22, m: 30 }, suprapatellarFat: { f: 11, m: 14 }, poplitealFat: { f: 24, m: 28 } };
const KNEE_FAT_STATURE = { f: 1.63, m: 1.77 };
// the patellar ligament's cross-section (cm2; adult MRI ~0.8-1.2 in women, ~1.0-1.4 in men; RECALLED, to verify); other tendons are their seeds' size
export const TENDON_CSA = { patellarLigament: { f: 0.9, m: 1.2 } };
// NHANES 2017-18 DXX_J (computed on this box by ANAT8-PELVIS, lane iteration 14), adults 18-35, medians: appendicular lean / fat-free mass, the legs'
// share of the appendicular lean
export const LEAN = { almPerFfm: { m: 0.438, f: 0.408 }, legPerAlm: { m: 0.715, f: 0.757 } };
const COHORT_LEG_LEAN = 57 * 0.425 * 0.73;   // Handsfield's cohort: fat-free mass ~57 kg (RECALLED), its leg lean by the pooled ratios
export function legLean(B, rec = {}) {
  const sx = B.sex === 'f' ? 'f' : 'm', t = rec.targets || rec.prior?.targets || {}, H = B.stature;
  if (Number.isFinite(t.almi) && t.almi > 0) return { kg: t.almi * H * H * LEAN.legPerAlm[sx], source: 'almi' };
  const mass = (B.bmi ?? 22) * H * H, ffm = mass * (1 - (B.pf ?? (sx === 'f' ? 0.28 : 0.18)));
  return { kg: ffm * LEAN.almPerFfm[sx] * LEAN.legPerAlm[sx], source: 'ffm' };
}
// THE MUSCLES' VOLUMES for a person (cm3, one side): the reference x the person's leg lean mass over the cohort's x the muscle pattern as a REDISTRIBUTION
// only (ANAT8-BODY's muscleScale squared over its volume-weighted mean: the occupation moves volume between groups, it adds none)
export function muscleVolumes(B, rec = {}, pattern = null) {
  const LL = legLean(B, rec), hf = LL.kg / COHORT_LEG_LEAN, ms = muscleScale(B, rec, pattern), sx = B.sex === 'f' ? 'f' : 'm';
  let a = 0, w = 0; for (const [v, k] of Object.values(MUSCLE_REF)) { a += v * ms(k) * ms(k); w += v; } const pw = a / w;
  const kneeK = Math.pow((B.stature || KNEE_FAT_STATURE[sx]) / KNEE_FAT_STATURE[sx], 3);
  const V = n => { if (KNEE_FAT_REF[n]) return KNEE_FAT_REF[n][sx] * kneeK; const [key, f0] = SPLIT[n] || [n, 1], r = MUSCLE_REF[key]; if (!r) return 0; const [v, k] = r; return v * hf * ms(k) * ms(k) / pw * f0; };
  return { V, hf, legLeanKg: LL.kg, legLeanSource: LL.source };
}
// THE BELLY ALONG ITS LINE (the muscle's architecture: where the fleshy belly lies between its tendons and where it is fullest): [fleshy from, fullest
// at, fleshy to, exponent] as fractions of the line (pelvis/thigh.js THIGH_MUSCLES / CRUS_MUSCLES; standard anatomy, RECALLED, to verify against Ward et
// al 2009 Clin Orthop 467:1074); the hip's own: the gluteals and rotators fleshy to near their insertions; iliopsoas fleshy to the lesser trochanter's
// tendon. The belly's ACSA along the line follows this; its SECTION's shape is the packing's.
export const BELLY = {
  gluteusMaximus: [0.0, 0.45, 0.92, 1.0], gluteusMedius: [0.0, 0.4, 0.9, 1.0], gluteusMinimus: [0.0, 0.4, 0.88, 1.0], rotators: [0.0, 0.45, 0.85, 1.0], tensorFasciaeLatae: [0.0, 0.45, 0.9, 1.0],
  psoas: [0.0, 0.45, 0.9, 1.0], iliacus: [0.0, 0.4, 0.92, 1.0],
  vastusIntermedius: [0.04, 0.42, 0.86, 1.0], vastusLateralis: [0.0, 0.42, 0.88, 1.0], vastusMedialis: [0.12, 0.74, 0.97, 1.0], bicepsFemorisShort: [0.0, 0.45, 0.88, 1.0],
  adductorBrevis: [0.1, 0.55, 1.0, 1.0], adductorMagnus: [0.06, 0.55, 1.0, 1.0], adductorMagnusIschial: [0.06, 0.42, 0.8, 1.0], pectineus: [0.05, 0.5, 1.0, 1.0],
  adductorLongus: [0.12, 0.6, 1.0, 1.0], semimembranosus: [0.34, 0.66, 0.92, 1.0], bicepsFemorisLong: [0.12, 0.5, 0.86, 1.0], semitendinosus: [0.12, 0.36, 0.64, 1.0],
  rectusFemoris: [0.14, 0.45, 0.88, 1.0], sartorius: [0.03, 0.45, 0.92, 0.45], gracilis: [0.04, 0.3, 0.68, 0.6],
  suprapatellarFat: [0.0, 0.62, 1.0, 1.0], poplitealFat: [0.0, 0.72, 1.0, 1.0], infrapatellarFat: [0.0, 0.4, 1.0, 1.0], patellarLigament: [0.0, 0.5, 1.0, 0.0],
  tibialisPosterior: [0.04, 0.28, 0.52, 1.0], flexorDigitorumLongus: [0.05, 0.3, 0.55, 1.0], flexorHallucisLongus: [0.05, 0.38, 0.62, 1.0], popliteus: [0.15, 0.6, 1.0, 1.0],
  extensorHallucisLongus: [0.04, 0.33, 0.58, 1.0], soleus: [0.0, 0.35, 0.76, 1.0], tibialisAnterior: [0.03, 0.28, 0.53, 1.0], extensorDigitorumLongus: [0.03, 0.3, 0.58, 1.0],
  fibularisLongus: [0.02, 0.25, 0.52, 1.0], fibularisBrevis: [0.05, 0.4, 0.66, 1.0], gastrocnemiusMedialis: [0.05, 0.25, 0.5, 1.0], gastrocnemiusLateralis: [0.05, 0.22, 0.44, 1.0] };
export const bellyF = (b, x) => { const [a, p, c, e] = b; if (e === 0) return x >= a && x <= c ? 1 : 0; if (x <= a || x >= c) return 0; const w = x < p ? 0.5 * (x - a) / (p - a) : 0.5 + 0.5 * (x - p) / (c - p); return Math.pow(Math.sin(Math.PI * w), e); };
// the deep fat bodies (inside the deep fascia, packed with the muscles): not muscle, their own group
export const DEEP_FAT = new Set(['suprapatellarFat', 'poplitealFat', 'infrapatellarFat']);
export const TENDONS = new Set(['patellarLigament']);

// THE SUBCUTANEOUS FAT. Adipose tissue per g of DXA fat (lipid): ~80 % lipid (Snyder et al 1975, ICRP 23), density 0.928 g/cm3
export const ADIPOSE_PER_LIPID = 1 / 0.80 / 0.928;
// the share of a region's DXA fat that is not subcutaneous (intermuscular, marrow; RECALLED, to verify): the gynoid band, the legs
export const IMAT = { G: 0.10, L: 0.15 };
// the hip's budget (the region's fat ABOVE the DXA leg lines, below the crest: the buttocks' upper part, the hips, the mons) as a share of the gynoid
// band's DXA fat: an ASSUMPTION (the gynoid band straddles the leg lines; the hips above it carry about as much again), to verify against DXA ROI geometry
export const HIP_PER_GYNOID = 0.65;
// the FAT DEMAND's propensity by site and sex (pelvis/fat.js DEPOTS, ANAT8-PELVIS's parameters; the pattern from Karastergiou et al 2012, Manolopoulos et al
// 2010, Kelley et al 2000; the numbers that lane's, to verify) and the demand's profile down the limb (pelvis/fat.js LEG_PROFILE: ISAK skinfold norms;
// Hoffmann et al 2022 Sci Rep 12:15916 ultrasound body mapping; RECALLED). A compartment's VOLUME is its share of its DXA budget by demand x patch area;
// where the fat goes inside its compartment, and the skin over it, is the growth's
export const DEPOTS = {
  gluteal: { f: 1.0, m: 0.55 }, trochanteric: { f: 1.1, m: 0.25 }, lateralThigh: { f: 0.6, m: 0.35 }, medialThigh: { f: 0.8, m: 0.4 }, posteriorThigh: { f: 0.65, m: 0.4 },
  anteriorThigh: { f: 0.6, m: 0.35 }, sacral: { f: 0.6, m: 0.2 }, mons: { f: 0.9, m: 0.6 },
  kneeFront: { f: 0.3, m: 0.3 }, kneeMedial: { f: 0.95, m: 0.45 }, kneeLateral: { f: 0.35, m: 0.35 }, popliteal: { f: 0.55, m: 0.5 },
  calf: { f: 0.7, m: 0.65 }, medialCalf: { f: 0.8, m: 0.6 }, shin: { f: 0.4, m: 0.4 }, ankle: { f: 0.3, m: 0.3 } };
export const LEG_PROFILE = { f: { knee: 0.55, calf: 0.62, ankle: 0.22 }, m: { knee: 0.6, calf: 0.7, ankle: 0.25 } };
