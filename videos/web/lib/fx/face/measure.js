// FACE / MEASURE (HUMAN c8 P2): craniofacial anthropometry on a person's mesh, the way the tables measure a living face.
// Landmarks are hm08 vertex ids (assets/face/landmarks.json, sources/face/bake_face.py: how each was picked). Distances are straight
// (caliper) distances in mm, as Farkas (1994) and ANSUR II (2012) take them; 't-v' is ANSUR's vertical tragion-to-top-of-head;
// 'ipd' is the distance between the pupils, taken as the centroids of the eye proxies' front caps (the eyes look straight ahead in bind).
//   faceMeasures(P, E, side, ids)  P: positions (m, n*3), E: eye proxy (m, ne*3), side: Uint8Array ne (1 = the person's left, +x)
// Which measures are fitted and which are only reported is decided in fit.js (a landmark definition that differs from the table's, like
// the eye fissure's here, is reported, not forced).
export const MEASURES = {
  'zy-zy': ['zy_L', 'zy_R', 'face width (bizygomatic)'], 'eu-eu': ['eu_L', 'eu_R', 'head breadth'], 'g-op': ['g', 'op', 'head length'],
  'go-go': ['go_L', 'go_R', 'mandible width (bigonial)'], 'n-me': ['n', 'me', 'face length (menton-sellion)'], 'n-gn': ['n', 'gn', 'morphological face height'],
  'n-sto': ['n', 'sto', 'upper face height'], 'n-sn': ['n', 'sn', 'nose height'], 'sn-me': ['sn', 'me', 'lower face height'], 'n-prn': ['n', 'prn', 'nasal bridge length'],
  'al-al': ['al_L', 'al_R', 'nose width'], 'ch-ch': ['ch_L', 'ch_R', 'mouth width'], 'en-en': ['en_L', 'en_R', 'intercanthal width'], 'ex-ex': ['ex_L', 'ex_R', 'biocular width'],
  'en-ex': ['en_L', 'ex_L', 'eye fissure length (left)'], 'ps-pi': ['ps_L', 'pi_L', 'eye fissure height (left)'], 'sn-sto': ['sn', 'sto', 'upper lip height'],
  'sto-sl': ['sto', 'sl', 'lower lip height'], 'ls-sto': ['ls', 'sto', 'upper vermilion height'], 'sto-li': ['sto', 'li', 'lower vermilion height'],
  'sa-sba': ['sa_L', 'sba_L', 'ear length (left)'], 'pra-pa': ['pra_L', 'pa_L', 'ear breadth (left, front-back extent)'],
};
const d3 = (P, a, b) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
// the pupils: the centroid of each eye's front cap (the proxy vertices within 6 mm of its most forward point)
export function pupils(E, side) {
  const out = [];
  for (const s of [1, 0]) { let zmax = -Infinity; for (let i = 0; i < side.length; i++) if (side[i] === s) zmax = Math.max(zmax, E[i * 3 + 2]);
    let x = 0, y = 0, z = 0, k = 0; for (let i = 0; i < side.length; i++) if (side[i] === s && E[i * 3 + 2] > zmax - 0.006) { x += E[i * 3]; y += E[i * 3 + 1]; z += E[i * 3 + 2]; k++; }
    out.push([x / k, y / k, z / k]); }
  return out;                                         // [left, right]
}
export function faceMeasures(P, E, side, ids) {
  const m = {};
  for (const [k, [a, b]] of Object.entries(MEASURES)) m[k] = d3(P, ids[a], ids[b]) * 1000;
  m['t-v'] = (P[ids.v * 3 + 1] - 0.5 * (P[ids.t_L * 3 + 1] + P[ids.t_R * 3 + 1])) * 1000;
  m['sn-prn'] = (P[ids.prn * 3 + 2] - P[ids.sn * 3 + 2]) * 1000;                    // nasal tip protrusion (forward of subnasale)
  if (E && side) { const [l, r] = pupils(E, side); m.ipd = Math.hypot(l[0] - r[0], l[1] - r[1], l[2] - r[2]) * 1000; }
  // profile angles (degrees, in the sagittal plane): nasofrontal at n (g-n-prn), nasolabial at sn (prn... columella - sn - ls), facial convexity at sn (g-sn-pg)
  const ang = (a, o, b) => { const ax = P[ids[a] * 3 + 1] - P[ids[o] * 3 + 1], az = P[ids[a] * 3 + 2] - P[ids[o] * 3 + 2], bx = P[ids[b] * 3 + 1] - P[ids[o] * 3 + 1], bz = P[ids[b] * 3 + 2] - P[ids[o] * 3 + 2];
    return Math.acos(Math.max(-1, Math.min(1, (ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz))))) * 180 / Math.PI; };
  m.nasofrontal = ang('g', 'n', 'prn'); m.nasolabial = ang('prn', 'sn', 'ls'); m.convexity = ang('g', 'sn', 'pg');
  // bilateral differences (asymmetry, mm): eye height, mouth corner height, alar, the nose tip's lateral offset from the eyes' midline
  const yd = (a, b) => (P[ids[a] * 3 + 1] - P[ids[b] * 3 + 1]) * 1000;
  m.asym = { eyeY: yd('ex_L', 'ex_R'), chY: yd('ch_L', 'ch_R'), alY: yd('al_L', 'al_R'),
    noseX: (P[ids.prn * 3] - 0.5 * (P[ids.en_L * 3] + P[ids.en_R * 3])) * 1000, chinX: (P[ids.pg * 3] - 0.5 * (P[ids.en_L * 3] + P[ids.en_R * 3])) * 1000 };
  return m;
}
