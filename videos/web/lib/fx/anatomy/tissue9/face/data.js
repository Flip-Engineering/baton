// TISSUE9-FACE / DATA: what the face's tissues ARE, as numbers: each body's VOLUME (mL, one side, at 30 years, BMI 24, fitness 0.5) with its
// sex, age and BMI terms, its fibre slack (a muscle's fibres may bow by that fraction of their chord), the interface tensions, the dermis by
// site. Volumes are INPUTS (how much tissue there is: the literature's volumetry where it exists, FACE6's / ANAT8-HEAD's recalled thicknesses
// times the compartment's anatomical footprint where it does not, each marked); the SHAPE of every body is the packing's (grow.js). Nothing
// here is tuned to a render, a photograph, a scan or a depth table: when the face misses, a number here is wrong against its source, or a
// structure is missing (DESIGN.md).
export const DATA_VERSION = 1;
// [f, m] mL one side; age: fraction a decade from 30 (negative: atrophy); bmi: fraction a BMI unit from 24; fit: +- fraction at fitness 0 / 1
export const VOL = {
  // ---- muscles of mastication (MRI / CT volumetry, as recalled: masseter ~20 / 28 mL women / men, temporalis ~18 / 25: e.g. van Spronsen
  // et al. 1989 Arch Oral Biol 34:997; Weijs and Hillen 1984; the sex ratio ~1.4; they hypertrophy with use, atrophy with age)
  masseter: { v: [19, 27], age: -0.04, fit: 0.15, slack: 0.12, src: 'MRI volumetry, as recalled (van Spronsen 1989; Weijs and Hillen 1984)' },
  temporalis: { v: [17, 24], age: -0.05, fit: 0.15, slack: 0.06, src: 'MRI volumetry, as recalled' },
  // ---- muscles of expression (thickness x width x length from FACE6's / ANAT8-HEAD's thicknesses (Raadsheer; anatomy texts), as recalled)
  buccinator: { v: [3.2, 3.8], age: -0.03, slack: 0.08, src: '~3 mm x 35 x 32 mm (FACE6 thickness)' },
  zygMajor: { v: [1.3, 1.6], age: -0.03, slack: 0.06, src: '2.2 / 2.6 mm x 10 x 60 mm' },
  zygMinor: { v: [0.45, 0.55], age: -0.03, slack: 0.06, src: '1.5 mm x 7 x 40 mm' },
  lls: { v: [0.8, 0.95], age: -0.03, slack: 0.06, src: '1.8 mm x 15 x 32 mm' },
  llsan: { v: [0.4, 0.5], age: -0.03, slack: 0.06, src: '1.5 mm x 8 x 35 mm' },
  lao: { v: [0.6, 0.7], age: -0.03, slack: 0.06, src: '2 mm x 10 x 28 mm' },
  dao: { v: [1.0, 1.2], age: -0.03, slack: 0.06, src: '1.8 mm x 18 x 30 mm' },
  dli: { v: [0.6, 0.7], age: -0.03, slack: 0.06, src: '1.6 mm x 15 x 22 mm' },
  mentalis: { v: [1.6, 2.0], age: -0.04, slack: 0.15, src: '4 / 5 mm cone, ~1.6 / 2.0 mL a side (FACE6)' },
  frontalis: { v: [3.0, 3.6], age: -0.03, slack: 0.04, src: '1.2 / 1.4 mm x 50 x 55 mm' },
  corrugator: { v: [0.35, 0.45], age: -0.02, slack: 0.06, src: '2 mm x 8 x 25 mm' },
  procerus: { v: [0.2, 0.25], age: -0.02, slack: 0.08, src: '1.6 mm x 8 x 18 mm' },
  orbOculi: { v: [2.4, 2.9], age: -0.03, slack: 0.05, src: 'orbital part 1.0 / 1.2 mm over a ring ~1900 mm2 + the palpebral part 0.45 mm' },
  digastricAnt: { v: [1.6, 2.0], age: -0.03, slack: 0.06, src: '8 x 5 x 40 mm (anatomy texts, as recalled)' },
  mylohyoid: { v: [3.5, 4.5], age: -0.03, slack: 0.05, src: '3 mm x 35 x 35 mm (anatomy texts, as recalled)' },
  // ---- the neck (the domain's cut at the larynx: the volume above it)
  scm: { v: [14, 20], age: -0.03, fit: 0.1, slack: 0.04, src: 'SCM ~ 30 / 40 mL whole (MRI, as recalled); about half above the cut' },
  neckLateral: { v: [80, 110], age: -0.02, bmi: 0.03, slack: 0.1, src: 'scalenes, levator scapulae, the carotid sheath, the strap muscles and the posterior triangle\'s fat above the cut: ~ 12-15 cm2 a side (MRI neck anatomy, as recalled) over ~ 80 mm' },
  neckBack: { v: [95, 130], age: -0.03, fit: 0.1, slack: 0.08, src: 'splenius, semispinalis, trapezius (upper), levator scapulae above the cut: cervical extensor CSA ~ 1000-1500 mm2 a side (MRI, as recalled) over ~ 90 mm' },
  // ---- glands (MRI / CT volumetry)
  parotid: { v: [17.3, 22.2], age: 0.03, bmi: 0.02, slack: 0, src: 'SHIP MRI (Healthcare 2022): 21.6 / 27.8 mL a gland; x 4/5 the superficial lobe' },
  submandibular: { v: [7.0, 8.5], age: 0, bmi: 0.01, src: 'CT volumetry ~ 7-10 mL (as recalled)' },
  // ---- deep fat
  buccalPad: { v: [9.6, 9.6], age: -0.03, bmi: 0.07, src: 'Stuzin et al. 1990 (7.8-11.2 mL a pad)' },
  dmcf: { v: [2.3, 2.0], age: -0.15, bmi: 0.035, src: 'deep medial cheek fat (Rohrich, Pessa and Ristow 2008; Gierloff 2012): ~ 5 / 4.2 mm over ~ 450 mm2' },
  soof: { v: [1.3, 1.1], age: -0.15, bmi: 0.03, src: 'SOOF ~ 2.6 / 2.2 mm over ~ 500 mm2' },
  roof: { v: [1.0, 1.1], age: -0.08, bmi: 0.03, src: 'ROOF ~ 2.0 / 2.2 mm over ~ 500 mm2' },
  temporalPad: { v: [6.0, 5.2], age: -0.06, bmi: 0.03, src: 'superficial (interfascial) + deep temporal fat pads, as recalled (no volumetry transcribed)' },
  // ---- superficial fat compartments (Rohrich and Pessa 2007): FACE6's mean thickness x the compartment's footprint (as recalled)
  forehead: { v: [3.6, 3.2], age: -0.05, bmi: 0.02, src: '1.6 / 1.4 mm x ~ 2250 mm2 (central + middle, one side)' },
  temporal: { v: [3.6, 3.2], age: -0.06, bmi: 0.03, src: '2.0 / 1.8 mm x ~ 1800 mm2' },
  infraorbital: { v: [0.35, 0.3], age: -0.06, bmi: 0.02, src: '0.9 / 0.8 mm x ~ 380 mm2' },
  medialCheek: { v: [2.4, 2.1], age: 0, bmi: 0.04, src: '3.2 / 2.8 mm x ~ 750 mm2' },
  middleCheek: { v: [3.6, 3.2], age: -0.03, bmi: 0.045, src: '3.4 / 3.0 mm x ~ 1050 mm2' },
  lateralCheek: { v: [3.6, 3.3], age: 0, bmi: 0.04, src: '2.4 / 2.2 mm x ~ 1500 mm2' },
  nasolabial: { v: [2.2, 2.1], age: 0.15, bmi: 0.04, src: '3.2 / 3.0 mm x ~ 700 mm2' },
  jowl: { v: [1.0, 1.0], age: 0.22, bmi: 0.07, src: '1.6 mm x ~ 650 mm2' },
  mental: { v: [1.0, 1.1], age: 0.02, bmi: 0.04, src: '2.0 / 2.2 mm x ~ 500 mm2 (one side of the chin)' },
  submental: { v: [3.4, 2.9], age: 0.08, bmi: 0.1, src: '2.6 / 2.2 mm x ~ 1300 mm2 (one side)' },
  neckSub: { v: [9, 8], age: 0.05, bmi: 0.08, src: 'the neck\'s subcutaneous layer ~ 3 mm x ~ 3000 mm2 a side above the cut, as recalled' },
};
export const volOf = (key, st) => { const D = VOL[key], s = st.sex === 'm' ? 1 : 0, dec = ((st.age ?? 35) - 30) / 10, young = Math.min(0, dec);
  const ageK = 1 + (D.age || 0) * Math.max(0, dec) - 0.5 * (D.age || 0) * young, bmiK = 1 + (D.bmi || 0) * ((st.bmi ?? 24) - 24), fitK = 1 + (D.fit || 0) * (2 * ((st.fitness ?? 0.5) - 0.5));
  return D.v[s] * Math.max(0.3, ageK) * Math.max(0.3, bmiK) * fitK; };
// the scalp and the nasal envelope are LAMINATES: dense vertical septa (the zones of adherence) hold the dermis at their length over the bone or
// the cartilage; the subcutaneous + galea + loose areolar + pericranium of the scalp (anatomy texts, as recalled), the nose's envelope less
// its dermis (NOSEMOUTH's envT: Lessard and Daniel 1985)
export const SCALP_SUB = { f: 3.6, m: 3.8, src: 'scalp below the dermis: subcutaneous 2-3 + galea 0.5 + loose areolar 0.5-1 + pericranium 0.3 mm (as recalled)' };
// interface tensions (the skin's to air = 1): bone and cartilage are wetted (tissue adheres to the periosteum and perichondrium); muscle to
// fat a fascia; fat to fat a septum; the lips' mucosa wets the orbicularis (it everts over the marginal part: the vermilion)
export const CLS = { AIR: 0, SOLID: 1, MUSCLE: 2, FAT: 3, GLAND: 4, MUCOSA: 5, LAMINATE: 6, CUT: 7, HOLE: 8, AREOLAR: 9 };
export function tensions() {
  const n = 10, m = new Float32Array(n * n), set = (a, b, v) => { m[a * n + b] = v; m[b * n + a] = v; }, C = CLS;
  const T = [[C.AIR, C.SOLID, 1.5], [C.AIR, C.MUSCLE, 1.0], [C.AIR, C.FAT, 1.0], [C.AIR, C.GLAND, 1.0], [C.AIR, C.MUCOSA, 0.85], [C.AIR, C.LAMINATE, 1.0], [C.AIR, C.CUT, 0.5], [C.AIR, C.HOLE, 0],
    [C.SOLID, C.MUSCLE, 0.1], [C.SOLID, C.FAT, 0.15], [C.SOLID, C.GLAND, 0.2], [C.SOLID, C.MUCOSA, 0.1], [C.SOLID, C.LAMINATE, 0.05], [C.SOLID, C.CUT, 0.5], [C.SOLID, C.HOLE, 1.5],
    [C.MUSCLE, C.FAT, 0.3], [C.MUSCLE, C.GLAND, 0.3], [C.MUSCLE, C.MUCOSA, 0.1], [C.MUSCLE, C.LAMINATE, 0.3], [C.MUSCLE, C.CUT, 0.5], [C.MUSCLE, C.HOLE, 1.0],
    [C.FAT, C.GLAND, 0.3], [C.FAT, C.MUCOSA, 0.3], [C.FAT, C.LAMINATE, 0.15], [C.FAT, C.CUT, 0.5], [C.FAT, C.HOLE, 1.0],
    [C.GLAND, C.MUCOSA, 0.3], [C.GLAND, C.LAMINATE, 0.3], [C.GLAND, C.CUT, 0.5], [C.GLAND, C.HOLE, 1.0],
    [C.MUCOSA, C.LAMINATE, 0.3], [C.MUCOSA, C.CUT, 0.5], [C.MUCOSA, C.HOLE, 0.85], [C.LAMINATE, C.CUT, 0.5], [C.LAMINATE, C.HOLE, 1.0], [C.CUT, C.HOLE, 0.5],
    // the LOOSE AREOLAR tissue: no tension against any tissue (it is the space between them), the skin's against air
    [C.AREOLAR, C.AIR, 1.0], [C.AREOLAR, C.SOLID, 0.15], [C.AREOLAR, C.MUSCLE, 0.05], [C.AREOLAR, C.FAT, 0.05], [C.AREOLAR, C.GLAND, 0.05], [C.AREOLAR, C.MUCOSA, 0.3], [C.AREOLAR, C.LAMINATE, 0.05], [C.AREOLAR, C.CUT, 0.5], [C.AREOLAR, C.HOLE, 1.0]];
  for (const [a, b, v] of T) set(a, b, v);
  const same = new Float32Array(n); same[C.MUSCLE] = 0.3; same[C.FAT] = 0.15; same[C.GLAND] = 0.3; same[C.MUCOSA] = 0.1; same[C.LAMINATE] = 0.1; same[C.SOLID] = 0; same[C.HOLE] = 0;
  return { n, m, same };
}
// the dermis (epidermis + dermis, mm) by site (FACE6's: Ha et al. 2005, Chopra et al. 2015, as recalled): the skin's outer surface lies this
// far outside the solved subcutaneous surface; the vermilion's epithelium and lamina propria ~ 0.5 mm; the lids' 0.75
export const DERMIS = { base: 1.6, forehead: 1.9, noseTip: 2.1, chin: 2.1, lipSkin: 1.3, vermilion: 0.5, lid: 0.75, scalp: 1.8, neck: 1.4, src: 'FACE6 (Ha et al. 2005; Chopra et al. 2015), as recalled' };
