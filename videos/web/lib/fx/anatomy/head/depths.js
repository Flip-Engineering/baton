// ANAT8-HEAD (lane it23, 16 Oct): THE FACE'S SOFT-TISSUE DEPTHS AT THE CRANIOMETRIC LANDMARKS, SOURCED. Pure data + one function.
// THE SOURCE (the means): the adult 2023 T-Table, Hona TWPT and Stephan CN, 'Global facial soft tissue thicknesses for craniofacial
// identification (2023): a review of 140 years of data since Welcker's first study', Int J Legal Med 138(2):519-535 (2024), doi
// 10.1007/s00414-023-03087-x, CC BY 4.0 (open access; the numbers below are its Table 3, 'Total weighted mean' and the weighted s, mm,
// rounded by the authors to 0.5 mm; n = the pooled sample). The T-Table pools the sexes and every ancestry: Stephan and Simpson's analyses
// (2008, 2013) found the sex and ancestry differences small beside the spread (s 1-7 mm), and the 2023 review keeps one pooled table.
// WHAT IS OURS (not the paper's; as recalled, carried from FACE P2's earlier table, face_pop.json tissue, which cited Stephan and Simpson
// 2008, De Greef et al. 2006 and Manhein et al. 2000 from memory): the SEX split (half the recalled male-female difference either side of the
// pooled mean), the AGE term (mm a decade from 35) and the BMI term (mm a BMI unit from 24; De Greef et al. 2006 report depth rising with
// BMI at nearly every landmark, most at the cheek and the jaw). A landmark the recalled table did not have borrows the terms of its nearest
// recalled one (named in `terms`). The pooled sample's mean age and BMI are taken as 35 / 24 (an assumption: the paper pools adults).
// Sites the T-Table does not carry (sg, mal) keep the recalled values and say so (src 'recalled').
// USE: the PARAMETERS of the face's fat compartments (head/index.js: each superficial compartment's amount solved so the layers supply the
// table's depth over the sites in it), and the description of the result (labs/human8/anat8/anat8_f9.mjs (M5)). Never a shape target.
export const DEPTHS_VERSION = 1;
export const DEPTH_SRC = 'Hona & Stephan 2023 adult T-Table (Int J Legal Med 138:519, doi 10.1007/s00414-023-03087-x, CC BY 4.0): pooled means; sex / age / BMI terms ours, as recalled';
// key: { T (pooled mean, mm), s, n, landmark (the T-Table's), sexHalf (+ for men, - for women), perDecade, perBMI, src, terms? }
export const DEPTHS = {
  // median
  sg:  { T: 4.45, s: null, n: null, landmark: 'supraglabella (not in the T-Table)', sexHalf: 0.15, perDecade: 0.05, perBMI: 0.1, src: 'recalled' },
  g:   { T: 5.5, s: 1.0, n: 15937, landmark: 'g-g\'', sexHalf: 0.15, perDecade: 0.05, perBMI: 0.1 },
  n:   { T: 6.0, s: 1.5, n: 16300, landmark: 'n-se\'', sexHalf: 0.25, perDecade: 0.05, perBMI: 0.08 },
  mn:  { T: 4.5, s: 1.5, n: 3065, landmark: 'mn-mn\' (mid-nasal)', sexHalf: 0.1, perDecade: 0.02, perBMI: 0.05, terms: 'between n and rhi' },
  rhi: { T: 3.0, s: 1.0, n: 15401, landmark: 'rhi-rhi\'', sexHalf: 0.1, perDecade: 0.0, perBMI: 0.03 },
  mph: { T: 11.5, s: 2.5, n: 10717, landmark: 'mp-mp\' (mid-philtrum)', sexHalf: 0.85, perDecade: -0.2, perBMI: 0.12 },
  ls:  { T: 12.0, s: 3.0, n: 14894, landmark: 'pr-ls\' (ours: from the upper incisor crown 4.5 mm above its edge, forward)', sexHalf: 0.9, perDecade: -0.6, perBMI: 0.12 },
  li:  { T: 13.5, s: 3.0, n: 14425, landmark: 'id-li\' (ours: from the lower incisor crown 4 mm below its edge, forward)', sexHalf: 0.75, perDecade: -0.4, perBMI: 0.15 },
  sl:  { T: 11.0, s: 2.0, n: 15238, landmark: 'sm-sm\' (supramentale)', sexHalf: 0.3, perDecade: 0.0, perBMI: 0.18 },
  pg:  { T: 11.0, s: 2.5, n: 17075, landmark: 'pg-pg\'', sexHalf: 0.2, perDecade: 0.1, perBMI: 0.25 },
  gn:  { T: 7.5, s: 2.5, n: 3259, landmark: 'gn-gn\'', sexHalf: 0.2, perDecade: 0.1, perBMI: 0.3 },
  me:  { T: 7.0, s: 2.5, n: 13583, landmark: 'me-me\'', sexHalf: 0.2, perDecade: 0.1, perBMI: 0.35 },
  // bilateral
  so:  { T: 7.0, s: 2.0, n: 8966, landmark: 'mso-mso\' (mid-supraorbital)', sexHalf: 0.2, perDecade: 0.05, perBMI: 0.08 },
  or:  { T: 6.5, s: 3.0, n: 8966, landmark: 'mio-mio\' (mid-infraorbital)', sexHalf: -0.3, perDecade: 0.15, perBMI: 0.2 },
  mal: { T: 7.4, s: null, n: null, landmark: 'mid-malar on the zygoma\'s body (not in the T-Table)', sexHalf: -0.4, perDecade: 0.2, perBMI: 0.35, src: 'recalled' },
  zy:  { T: 7.5, s: 3.0, n: 10399, landmark: 'zy-zy\' (zygion)', sexHalf: 0, perDecade: 0.2, perBMI: 0.35, terms: 'mal' },
  sC:  { T: 10.5, s: 2.5, n: 6439, landmark: 'sC-sC\' (supra-canine)', sexHalf: 0, perDecade: -0.2, perBMI: 0.12, terms: 'mph' },
  iC:  { T: 11.0, s: 2.5, n: 3904, landmark: 'iC-iC\' (infra-canine)', sexHalf: 0, perDecade: 0.0, perBMI: 0.18, terms: 'sl' },
  buc: { T: 26.0, s: 7.0, n: 6203, landmark: 'ecm2-sM2\' (supra-M2)', sexHalf: 0.5, perDecade: 0.4, perBMI: 0.9 },
  mm:  { T: 22.0, s: 6.5, n: 4756, landmark: 'ecm2-iM2\' (infra-M2; ours: the mandible\'s alveolus 9 mm below the M2\'s occlusal point)', sexHalf: 0.25, perDecade: 0.2, perBMI: 0.45 },
  mas: { T: 19.5, s: 5.0, n: 6344, landmark: 'mr-mr\' (mid-ramus)', sexHalf: 0.5, perDecade: 0.3, perBMI: 0.6 },
  mmb: { T: 11.0, s: 4.0, n: 4573, landmark: 'mmb-mmb\' (mid-mandibular border)', sexHalf: 0.2, perDecade: 0.1, perBMI: 0.35, terms: 'me' },
  go:  { T: 12.5, s: 6.0, n: 9827, landmark: 'go-go\'', sexHalf: 0.5, perDecade: 0.4, perBMI: 0.7 },
};
export const REF = { age: 35, bmi: 24 };
// the depth at a site for this person (mm); null for an unknown key
export function depthAt(key, st = {}) { const d = DEPTHS[key]; if (!d) return null; const sx = st.sex === 'm' ? 1 : -1;
  return Math.max(0.8, d.T + sx * d.sexHalf + d.perDecade * ((st.age ?? REF.age) - REF.age) / 10 + d.perBMI * ((st.bmi ?? REF.bmi) - REF.bmi)); }
