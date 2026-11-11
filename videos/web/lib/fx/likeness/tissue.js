// SKIN OPTICS iteration 7 (15 Oct 2026): THE SKIN AS A COLUMN OF ITS OWN TISSUE, read from the person's head anatomy.
//
//   import { headTissue, tissueCoords, columnRatio, TISSUE_TILES } from './tissue.js';
//   const T = await headTissue(h, { M, info })      // per level-0 vertex: dermis thickness td (mm), subcutis tf (mm), substrate (LBL code), auricle flag;
//                                                   // node builds it from the anatomy (and caches it), the page reads the cache
//   const C = tissueCoords(M, T)                     // per level-0 vertex: the LUT's tissue coordinates (tdI, s) and the cartilage share
//   const W = siteWeights(T, n0, idx0)              // per level-0 vertex: the cutaneous SITE's one-hot weights (SITES), blended over the plexus's reach
//
// WHY A COLUMN. Skin is not a semi-infinite dermis: an epidermis (the melanin) over a dermis of thickness t_d over the subcutis (fat, t_f) over
// whatever the anatomy puts there (muscle, bone, cartilage). The calibrated two-layer model (skin_lut.js; NIST's 100 spectra, which are of the volar
// forearm) folded the arm's own column into its dermis; so the column at a vertex is applied as its RATIO to the arm's column (REF_COLUMN), per
// wavelength, multiplying the calibrated dermal reflectance Rd (the arm stays the calibration; a thick dermis anywhere is the calibration's).
// THE PHYSICS. Each layer a Kubelka-Munk slab (K = 2 mu_a, S = 3/4 mu_s': the diffusion-consistent pair, Star et al. 1988, van Gemert et al. 1989) over
// the diffuse reflectance of what lies under it; the deepest a semi-infinite diffuser (the dipole's Rd, as skin_lut.js). The dermis at Jacques 2013's
// absolute scattering with the calibration's ratio of absorption to scattering (optics.js); the other tissues from Jacques 2013 ('Optical properties of
// biological tissues: a review', Phys Med Biol 58 R37; omlc.org table2_JacquesPMB2013.csv; the paper's Tables 1 and 3):
//   fatty tissue mu_s'(500) 18.4 cm^-1, b 0.672 (Table 2 mean); blood 0.76 % (Table 3: Weaver et al 1989, subcutaneous fat)
//   skeletal muscle 13.0, b 0.926 (Table 1: Tromberg 1996); blood 1.16 % (Weaver) and myoglobin (~0.25 mM haem in skeletal muscle, as recalled;
//     its visible spectrum is close to haemoglobin's per haem): together ~3.5 % blood-equivalent, at an oxygen saturation 0.7 (approximate)
//   bone (the skull) 20.9, b 0.537 (Table 1: Firbank et al 1993); blood 1.36 % (Weaver, cortical bone)
//   cartilage: 'other fibrous tissues' 27.1, b 1.627 (Table 2 mean); avascular, the perichondrium's blood ~0.2 % (approximate)
//   glands (the parotid) and other soft tissue: 18.9, b 1.286 (Table 2 'other soft tissues'); blood ~2 % (approximate)
// WHAT IT DOES (labs/human8/_skinopt_scratch/column_proto.mjs, described in skin7/NOTES.md iteration 7): a dermis >= 1.5 mm is optically semi-infinite
// in the visible, so the fat pad under a normal dermis moves the albedo < 1 dE (the cheek, the forehead, the nose tip); where the dermis is thin (the
// lids on the orbicularis, the under-eye, the lips' skin) the column is darker and cooler (L08's lid dL -1.8 da -3.9 db -2.6), a third of that on a deep
// skin (the epidermis filters it). The warm cheek and the forehead's colour are the dermis's blood and the epidermis's melanin, not the subcutis's.
// THE DERMAL BLOOD BY SITE (iteration 8, version 4): the skin's blood volume is a property of its cutaneous SITE (the density of the papillary loops and
// of the subpapillary plexus differ by region). The site of every head vertex is READ FROM THE ANATOMY it lies on (the part the read meets: frontalis /
// procerus / corrugator / the ROOF -> forehead; the temporal pads and temporalis -> temple; the lid skin -> eyelid; the nasal bones, the upper lateral and
// septal cartilages -> nose; the lower lateral cartilages and the alar lobule -> the nasal lobule; zygomaticus, the levators, the SOOF, the deep medial cheek
// fat, the zygoma and maxilla -> cheek; the orbicularis oris, the philtral columns, the modioli -> the perioral skin; mentalis, the depressors, the
// symphysis -> chin; masseter, the parotid, buccinator, risorius, the buccal pad, the ramus -> jaw; the submandibular glands, digastric, platysma, the
// hyoid -> neck; the auricle), stored with the column (byte 3: auricle bit + site << 1). zones4.js gives each site its blood (the scans' measured
// medians: SITE_ZONES), blended across sites over the plexus's reach. The lips' vermilion is its own column (VERMILION, iteration 9: a thin corneum over the
// papillary capillary bed; the table's second set of tiles), its blood the lip's x3.8.
// Version 3's APICAL_AVA (the fingers' factor over cartilage) is gone: the nose's measured perfusion carries its anastomoses' basal flow.
// WHERE THE NUMBERS COME FROM, PER PERSON. The person's own head anatomy (lib/fx/anatomy/head, ANAT8-HEAD: the skull drawn from the face's living
// anchors, the bone, cartilage, deep fat, the muscles as shells and straps, the superficial fat, the skin's thickness by region (FACE6's numbers,
// Ha et al. 2005, thinning with age)) built on the person's FINAL face in node (~45 s), and sampled at every level-0 vertex of the head: td = the
// anatomy's skin thickness there less the calibrated epidermis, tf = the distance from the skin's underside to the nearest solid layer (bone,
// muscle shell or strap, cartilage, deep fat, gland, globe), the substrate = that layer's label. The auricle (not in the head anatomy) is skin on
// elastic cartilage: found as the vertices that stand off the skull's tissue inside the ear's landmarks. Cached as a small keyed asset
// (assets/person/skin7/tissue/<key>.bin: Uint8 td (0.02 mm), tf (0.1 mm), substrate, auricle per level-0 vertex) under the key of the face itself
// (its digest, sex, age and the code): any person the system builds gets its own in node; the page reads the cache (a page with no cache reports
// 'missing' and keeps the zones' thin slice). NOT face9's anatomy bit for bit: face9's skull is seeded by the face at its hook, before the later
// face stages; this one by the final face. The column depends on the anatomy's thickness of skin and what lies under the thin places, which both
// skulls share; said so, not hidden. Asked of ANAT8-HEAD (skin7/NOTES.md): the tissue written with face9's bake, from its own anatomy.
import { LBL } from '../anatomy/head/common.js';

export const TISSUE_VERSION = 10;   // 10 (16 Oct 04:10): the skull's random residual seeded by the PERSON (tissueSeed: sex, age, group, BMI, the cast's skin and variant), not by the head's digest: v9 re-drew the skull whenever any lane moved the face, and 16% of L08's head vertices changed site between two current caches (SKIN7 critic c4_it2);   // 9 (16 Oct 01:08): the skin over the masseter's origin, the parotid's upper pole and the temporal pad below the eye is the cheek's (v8 put the malar point on 'jaw');   // 8 (16 Oct 01:05): the bone-backed skin's site by where it lies (the drawn skull's labels do not part the regions and vary with its draw);   // 7 (16 Oct 01:00): the ear's search at the auricle's own size (half-length 32, half-width 20, protrusion 18 mm: an adult ear ~60-65 x 30-35 mm standing ~15-20 mm off the head) and 2 mm outside the anatomy's skin; the platysma and digastric above the mandible's lowest point are the chin's or the jaw's skin, not the neck's;   // 6 (16 Oct 00:57): the neck site below the chin's lowest point whatever bone is nearest;   // 5 (16 Oct 00:55): the auricle also where the face stands > 3 mm outside the anatomy's own skin surface inside the ear's landmarks (the concha, the tragus, the helix's root: v4 read only what stood > 6 mm off the solid layers, half the ear on L08);   // 4 (16 Oct 00:50): the cutaneous SITE per vertex (byte 3 = auricle | site << 1);   // 3 (15 Oct 23:58): the eyelid skin (on the palpebral orbicularis) at the anatomy's lid thickness, no subcutis;   // 2 (15 Oct 23:45): the key digests the head alone (1: the whole level-0 body, which a page's unsolved body stage could change)
// THE SITES (the cutaneous regions whose dermal blood differs; their blood is zones4.js's SITE_ZONES: the scans' measured medians):
export const SITES = ['none', 'forehead', 'temple', 'eyelid', 'nose', 'lobule', 'cheek', 'perioral', 'chin', 'jaw', 'neck', 'auricle', 'scalp'];
export const SITE = Object.fromEntries(SITES.map((k, i) => [k, i]));
// Jacques 2013 (see the header): mu_s'(lambda) = a (lambda / 500)^-b cm^-1; B = blood volume fraction at saturation S
export const TISSUE_OPTICS = {
  fat: { a: 18.4, b: 0.672, B: 0.0076, S: 0.7 }, muscle: { a: 13.0, b: 0.926, B: 0.035, S: 0.7 }, bone: { a: 20.9, b: 0.537, B: 0.0136, S: 0.7 },
  cartilage: { a: 27.1, b: 1.627, B: 0.002, S: 0.7 }, soft: { a: 18.9, b: 1.286, B: 0.02, S: 0.7 },
  // the posterior skin of the auricle: a dermis (Jacques 2013 Table 2 dermis 43.6, b ~1 over the visible) with the face's dermal blood at Jacques's absolute
  // scale (the calibration's median x FACE_BLOOD x its scattering ratio: ~1.2 %; approximate)
  dermis: { a: 43.6, b: 1.0, B: 0.012, S: 0.7 } };
// THE AURICLE is a thin plate, not a block: skin | elastic cartilage (~1-1.5 mm) | skin (~0.8-1 mm), then air (anatomy texts; approximate): light that crosses
// the cartilage reaches the far side's dermis and its blood or leaves into the air, so the plate is darker and redder in reflection than cartilage as deep as
// the light goes (the semi-infinite backing of version 3, which made the ear paler than the zones' and than the photographs')
export const AURICLE = { cart_mm: 1.2, back_mm: 0.9 };
const SUB_OF = { [LBL.cranium]: 'bone', [LBL.face]: 'bone', [LBL.mandible]: 'bone', [LBL.teeth]: 'bone', [LBL.hyoid]: 'bone', [LBL.muscle]: 'muscle', [LBL.deepFat]: 'fat',
  [LBL.supFat]: 'fat', [LBL.globe]: 'soft', [LBL.cartilage]: 'cartilage', [LBL.gland]: 'soft' };
// the reference column: NIST's site, the volar forearm (dermis ~1.1 mm by ultrasound over ~4 mm of subcutis over muscle; approximate, as recalled)
export const REF_COLUMN = { td: 1.1, tf: 4, sub: 'muscle' };
// the LUT's tissue tiles: the dermis's thickness on a log axis x the backing (what the dermis lies on) from muscle (s 0) to a bright, weakly absorbing
// backing (s 1: fat 12 mm deep, ~ bone and cartilage); the per-vertex backing is projected onto that line (its spectrum, least squares)
export const TISSUE_TILES = { td: [0.35, 2.4], nt: 6, ns: 3 };
// THE VERMILION (iteration 9): the lip's red zone is not skin with more blood in it. Its epithelium is a transition between the face's keratinised epidermis and the
// mouth's mucosa: a thin stratum corneum of a few cell layers with small, immature corneocytes (Kobayashi and Tagami 2004, 'Functional properties of the surface of
// the vermilion border of the lips are distinct from those of the facial skin', Br J Dermatol 150:563), translucent, over tall dermal papillae whose capillary loops
// come close to the surface (histology texts), with no subcutaneous fat: the lamina propria lies on the orbicularis oris (the anatomy's read gives the vertex's own
// column there, as everywhere). So the vermilion's tiles are the skin's columns with the vermilion's epithelium: the corneum's own backscatter (skin_lut.js
// skinSpectrum rsc, the calibration's blue-white veil returned before the melanin) at corn = the vermilion's share of the face's corneum (~3 cell layers of ~9:
// Ya-Xian, Suetake and Tagami 1999, Arch Dermatol Res 291:555 count about nine on the face; the vermilion's few as recalled from Kobayashi and Tagami: approximate).
// Its capillary bed's blood is the lip's measured x3.8 of the face's (the shader's likeR4.x, unchanged); its melanin the person's own (the epidermal zones are the
// facial skin's, not this epithelium's). The border is the mask's gradient between the two sets of tiles (the keratinised skin and the vermilion), not a drawn line.
// (iteration 10) its corneum is now counted against the calibration's site like every other site's (CORNEUM below): ~3 cell layers of the volar forearm's 15 (k 0.2; it was
// 0.33 against a face whose own corneum was then the forearm's: the same ratio to the face's 9 layers)
export const VERMILION = { corn: 0.2, layers: 3 };
// THE EPIDERMIS BY SITE (iteration 10). The calibration (skin_lut.js) is NIST's 100 spectra of the VOLAR FOREARM, so its superficial backscatter (skinSpectrum's rsc: the
// blue-white light the stratum corneum returns before the melanin) is the forearm's corneum. The corneum's thickness is a property of the cutaneous site: Ya-Xian,
// Suetake and Tagami 1999 ('Number of cell layers of the stratum corneum in normal skin: relationship to the anatomical location on the body, age, sex and physical
// parameters', Arch Dermatol Res 291:555; 301 people) count, as means: genital 6, FACE 9, NECK 10, scalp 12, TRUNK 13, EXTREMITIES 15, PALMS AND SOLES 47, the heel 86
// (no clear difference by sex; slightly more with age on the cheek and back). So a site's corneum is k = layers / 15 of the calibration's: the face's backscatter is
// ~0.6 of the forearm's (the face's colour is redder and more saturated than the arm's at the same melanin: the grey-pink veil on our faces was the forearm's corneum),
// the palms' and soles' ~3x (a thick, white-yellow horn layer). The corneum as a thin non-absorbing scattering slab (Kubelka-Munk, R = S t / (1 + S t)): its
// reflectance at k x the calibrated thickness is k r1 / (1 - r1 + k r1) (skin_lut.js cornR), exactly the calibration's at k = 1. The table carries LEVELS of it
// (the vermilion, the face, the forearm, the palms and soles); a vertex's corneum is its site's, interpolated between levels in log k (skin.js skinFields, rev 7).
// (iteration 11) THE LEVELS STOP AT THE CALIBRATION'S OWN SITE: the slab's backscatter linear in layer count (cornR at k = layers / 15) is a model of the
// basket-weave corneum of the face, trunk and limbs, valid near the calibration; the palms' and soles' horn (47-86 layers) is compact, translucent and holds
// carotene (carotenoderma shows there first), which a 3x non-absorbing slab is not: at k 3.1 it laid a near-neutral white veil on the palms (43 % at 400 nm;
// the c5 it1 critic's palm probe: L06 palm C 13.9 -> 7.2). Until the horn has its own model, the volar sites take the forearm's corneum (cornCoord clamps
// to the last level); the cell counts above stay the literature's.
export const CORNEUM = { ref: 15, layers: { vermilion: 3, genital: 6, face: 9, neck: 10, scalp: 12, trunk: 13, limb: 15, volar: 47, heel: 86 }, levels: [3, 9, 15] };
export const cornK = layers => layers / CORNEUM.ref;
// a corneum (in layers) -> its coordinate on the table's levels (0 = the first level, 1 = the last), linear in log between levels (clamped: the heel sits at the palms' level)
export function cornCoord(layers) { const Lv = CORNEUM.levels, n = Lv.length, x = Math.log(Math.min(Lv[n - 1], Math.max(Lv[0], layers)));
  for (let i = 0; i < n - 1; i++) { const a = Math.log(Lv[i]), b = Math.log(Lv[i + 1]); if (x <= b + 1e-9) return (i + (x - a) / (b - a)) / (n - 1); } return 1; }
const EPI_MM = 0.05;   // the calibrated epidermis (skin_model.json global.d_mm)

const dip = (ma, ms) => { const a = ms / (ms + ma), s = Math.sqrt(3 * (1 - a)); return a / 2 * (1 + Math.exp(-4 / 3 * s)) * Math.exp(-s); };
const kmSlab = (ma, ms, t_mm, Rg) => { const K = 2 * ma, S = 0.75 * ms, a = 1 + K / S, b = Math.sqrt(a * a - 1), cth = 1 / Math.tanh(Math.max(1e-6, b * S * t_mm * 0.1)); return (1 - Rg * (a - b * cth)) / (a - Rg + b * cth); };
function tissueMu(M, q, i) { const x = M.wl[i] / 500, ms = q.a * x ** -q.b, ma = q.B * (q.S * M.mu.oxy[i] + (1 - q.S) * M.mu.deoxy[i]) + (1 - q.B) * M.mu.base[i] * 0.3; return [ma, ms]; }   // (the bloodless baseline at 0.3 of the dermis's: fat and muscle are wetter-clearer than the dermis's collagen; approximate)
// the diffuse reflectance (per band) of what lies under the dermis: the fat slab tf over the substrate
export function backingSpectrum(M, tf, sub) {
  const n = M.wl.length, R = new Float64Array(n), q = TISSUE_OPTICS[sub] || TISSUE_OPTICS.muscle;
  if (sub === 'auricle') { for (let i = 0; i < n; i++) { const [mD, sD] = tissueMu(M, TISSUE_OPTICS.dermis, i), [mC, sC] = tissueMu(M, TISSUE_OPTICS.cartilage, i); R[i] = kmSlab(mC, sC, AURICLE.cart_mm, kmSlab(mD, sD, AURICLE.back_mm, 0)); } return R; }
  for (let i = 0; i < n; i++) { const [mS, sS] = tissueMu(M, q, i), Rs = dip(mS, sS); if (tf > 0.01) { const [mF, sF] = tissueMu(M, TISSUE_OPTICS.fat, i); R[i] = kmSlab(mF, sF, tf, Rs); } else R[i] = Rs; }
  return R;
}
let _ends = null;
function ends(M) { return (_ends ||= { m: backingSpectrum(M, 0, 'muscle'), f: backingSpectrum(M, 12, 'fat') }); }
export const backingAt = (M, s) => { const E = ends(M); return E.m.map((x, i) => x + (E.f[i] - x) * s); };
// the backing's position on the muscle -> bright line (weighted to 450-700 nm, where the dermis passes light down)
export function backingS(M, R) { const E = ends(M); let nu = 0, de = 0; for (let i = 0; i < R.length; i++) { if (M.wl[i] < 450) continue; const d = E.f[i] - E.m[i]; nu += (R[i] - E.m[i]) * d; de += d * d; } return Math.min(1, Math.max(0, nu / Math.max(de, 1e-12))); }
// the dermis's absolute optics at band i for the person p (as optics.js: the calibration's ratio at Jacques's scattering)
function dermisMu(M, p, i) { const g = M.global, mu = M.mu, x = M.wl[i] / 500;
  const mD = p.Ch * (p.gamma * mu.oxy[i] + (1 - p.gamma) * mu.deoxy[i]) + (1 - p.Ch) * mu.base[i] + g.carDermis * (p.Cc || 0) * mu.car[i];
  const msCal = g.mus_a * (g.mus_fRay * x ** -4 + (1 - g.mus_fRay) * x ** -g.mus_bMie), ms = 43.6 * (0.41 * x ** -4 + 0.59 * x ** -0.562); return [mD * ms / msCal, ms]; }
// the column's ratio to the reference column at band i: (td, Rg) at the vertex over (REF td, REF backing)
let _refRg = null;
export function columnRatio(M, p, i, td, Rg) { _refRg ||= backingSpectrum(M, REF_COLUMN.tf, REF_COLUMN.sub); const [ma, ms] = dermisMu(M, p, i);
  return kmSlab(ma, ms, td, Rg[i]) / kmSlab(ma, ms, REF_COLUMN.td, _refRg[i]); }
// the tiles' columns: tdI = log position on TISSUE_TILES.td, s = backing; the tile (k, j) holds the column (td_k, backingAt(s_j))
export const tdOf = tdI => TISSUE_TILES.td[0] * (TISSUE_TILES.td[1] / TISSUE_TILES.td[0]) ** tdI;
export const tdIOf = td => Math.min(1, Math.max(0, Math.log(td / TISSUE_TILES.td[0]) / Math.log(TISSUE_TILES.td[1] / TISSUE_TILES.td[0])));
export function tileColumns(M) { const T = TISSUE_TILES, out = []; for (let j = 0; j < T.ns; j++) for (let k = 0; k < T.nt; k++) { const tdI = k / (T.nt - 1), s = j / (T.ns - 1); out.push({ k, j, tdI, s, td: tdOf(tdI), Rg: backingAt(M, s) }); } return out; }
// the reference column's own coordinates (the body and any vertex without tissue sit here: identity) and the old thin slice's (0.4 mm on muscle)
export function refCoords(M) { _refRg ||= backingSpectrum(M, REF_COLUMN.tf, REF_COLUMN.sub); return [tdIOf(REF_COLUMN.td), backingS(M, _refRg)]; }
export const THIN_COORDS = [tdIOf(0.4), 0];

// ---------------------------------------------------------------- the person's tissue (level-0 vertices)
function fnv(s) { let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b ^ c, 0x01000193 + 2 * 0x100) >>> 0; b = (b ^ (b >>> 13)) >>> 0; }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0'); }
const NB = 13380;   // hm08's body vertices (the face's indices live below it)
// the HEAD's digest (64 block centroids of the level-0 head, jaw and neck vertices at 0.2 mm, as face9.js faceDigest does for its hook face; the body
// below the neck is left out, so a body stage the page cannot solve (the soft tissue, the pelvis) never changes the key) + the person's record + the code
const HEAD_REG = new Set([0, 1, 11]);   // hero.js HERO_REGIONS head, neck, jaw
export function tissueKey(P0, info, code, AH0 = null) { const ids = []; for (let v = 0; v < NB; v++) if (!AH0 || HEAD_REG.has(AH0[v * 4])) ids.push(v);
  const out = [], k = 64, step = Math.ceil(ids.length / k);
  for (let b = 0; b < k; b++) { const i0 = b * step, i1 = Math.min(ids.length, i0 + step); let x = 0, y = 0, z = 0, n = 0; for (let i = i0; i < i1; i++) { const v = ids[i]; x += P0[v * 3]; y += P0[v * 3 + 1]; z += P0[v * 3 + 2]; n++; } if (n) out.push(Math.round(x / n * 5000), Math.round(y / n * 5000), Math.round(z / n * 5000)); }
  return fnv([info.sex, Math.round(info.years ?? 0), (+(info.bmi ?? 0)).toFixed(1), code, ids.length, tissueSeed(info)].join('|') + '#' + out.join(',')); }
// the skull's random residual is the PERSON's (version 10): drawSkull seeds it by name, and v4-v9 named it by the tissue key (the head's digest), so any lane's
// change to the face re-drew the skull and moved the sites at their edges (16% of L08's head vertices between two current caches). The anchors (the vault) still
// come from the face as it is; only the draw's residual is held. (face9's own seed, the face at its hook, is not on the hero at the skin stage; asked of the integrator.)
export const tissueSeed = info => 'skin7:' + [info.sex, Math.round(info.years ?? 0), info.group || '', info.bmi == null ? '' : (+info.bmi).toFixed(1), info.hex || '', info.who || ''].join('|');
const BASE = () => new URL('../../../assets/person/skin7/tissue/', import.meta.url).href;
const isNode = () => typeof process !== 'undefined' && !!process.versions?.node && typeof window === 'undefined';
const _cache = new Map();
function decode(buf, n) { const u = new Uint8Array(buf); if (u.length < n * 4) return null; const td = new Float32Array(n), tf = new Float32Array(n), sub = new Uint8Array(n), aur = new Uint8Array(n), site = new Uint8Array(n), has = new Uint8Array(n);
  for (let v = 0; v < n; v++) { const a = u[v * 4], b = u[v * 4 + 1], c = u[v * 4 + 2], d = u[v * 4 + 3]; if (c === 0) continue; has[v] = 1; td[v] = a * 0.02; tf[v] = b * 0.1; sub[v] = c; aur[v] = d & 1; site[v] = d >> 1; } return { td, tf, sub, aur, site, has }; }
function encode(T, n) { const u = new Uint8Array(n * 4); for (let v = 0; v < n; v++) { if (!T.has[v]) continue; u[v * 4] = Math.min(255, Math.round(T.td[v] / 0.02)); u[v * 4 + 1] = Math.min(255, Math.round(T.tf[v] / 0.1)); u[v * 4 + 2] = T.sub[v]; u[v * 4 + 3] = (T.aur[v] & 1) | ((T.site[v] & 127) << 1); } return u; }
export async function loadTissue(key, n, url = null) { const k = (url || BASE()) + key; if (_cache.has(k)) return _cache.get(k);
  const p = (async () => { try { const r = await fetch(new URL(key + '.bin', url || BASE())); if (!r || r.ok === false) return null; return decode(await r.arrayBuffer(), n); } catch { return null; } })(); _cache.set(k, p); return p; }

// the anatomy's code (the head modules' versions): part of the key, so a change of the anatomy re-reads the tissue
async function anatCode() { const [SK, HD, FT, MU] = await Promise.all([import('../anatomy/skull/skull.js'), import('../anatomy/head/index.js'), import('../anatomy/head/fat.js'), import('../anatomy/head/muscles.js')]);
  return `t${TISSUE_VERSION}.sk${SK.SKULL_VERSION}.hd${HD.HEAD_VERSION}.ft${FT.FAT_VERSION}.mu${MUSCLES_V(MU)}`; }
const MUSCLES_V = MU => MU.MUSCLES_VERSION;

// the cutaneous SITE of a head vertex from what the anatomy puts under its skin (the part's name, its label) and, for one bone's several sites or a vertex
// with nothing named under it, where it lies against the face's landmarks (K, mm in the anatomy's frame)
export function siteOf(part, lab, q, K, lid = 0, aur = 0) {
  if (aur) return SITE.auricle; if (lid) return SITE.eyelid;
  const ax = Math.abs(q[0]), y = q[1], z = q[2], P = String(part || '').toLowerCase();
  if (/alar lobule|lateral crus|medial crus|^dome|lower lateral|interdomal|vestibule/.test(P)) return SITE.lobule;
  if (/upper lateral|septal/.test(P)) return SITE.nose;
  if (/orbicularis oris|philtral|labial glands|modiolus/.test(P)) return SITE.perioral;
  if (/mentalis|depressor/.test(P)) return SITE.chin;
  if (/masseter|parotid|buccinator|risorius|buccal/.test(P)) return y >= K.alY ? SITE.cheek : SITE.jaw;   // the malar skin over the masseter's origin and the parotid's upper pole is the cheek's; below the nose's base, the jaw's
  if (/temporal/.test(P)) return y < K.eyeY - 12 ? SITE.cheek : SITE.temple;
  if (/frontalis|procerus|corrugator|^roof/.test(P)) return SITE.forehead;
  if (/zygomaticus|levator|^soof|^dmcf|malar|nasolabial/.test(P)) return SITE.cheek;
  if (/submandibular|digastric|platysma|hyoid/.test(P)) return y > K.meY + 3 && !/submandibular|hyoid/.test(P) ? (ax < K.chX + 3 ? SITE.chin : SITE.jaw) : SITE.neck;   // the platysma's and digastric's skin above the chin's lowest point is the lower face's
  if (/orbicularis oculi/.test(P)) return y > K.eyeY ? SITE.forehead : SITE.cheek;   // its orbital part on the rim: the brow above the eye, the lid-cheek junction below
  if (lab === LBL.hyoid || lab === LBL.gland) return y > K.meY + 3 ? (ax < K.chX + 3 ? SITE.chin : SITE.jaw) : SITE.neck;
  if (lab === LBL.teeth) return SITE.perioral;
  // BONE (and a vertex with nothing named under it): the skin over the skull is the forehead's, the temple's, the nose's dorsum, the cheek's, the chin's or
  // the jaw's by where it lies on the face (the skull's own labels do not part the frontal bone from the temporal fossa or the maxilla from the zygoma, and
  // the drawn skull's labels vary with its draw: v7's read put the philtrum on 'cranium' -> temple on one draw of L08's)
  const back = z < K.earZ - 8;
  if (y < K.meY + 2 && (z < K.pgZ - 12 || y < K.meY - 4)) return SITE.neck;            // under the chin and below it
  if (back) return y > K.eyeY ? SITE.scalp : y < K.meY + 10 ? SITE.neck : SITE.jaw;   // behind the ear's front: the scalp above, the jaw's angle, the neck
  if (y > K.eyeY + 8) return ax > K.exX + 4 ? SITE.temple : SITE.forehead;            // the frontal bone's front | the temporal fossa
  if (y >= K.alY) return ax < K.enX + 2 ? SITE.nose : ax > K.exX + 8 ? (y > K.eyeY - 12 ? SITE.temple : SITE.jaw) : SITE.cheek;   // the nasal bones | the zygomatic arch | the zygoma, maxilla
  if (y >= K.stoY) return ax < K.chX + 3 ? SITE.perioral : ax > K.exX + 6 ? SITE.jaw : SITE.cheek;
  return ax < K.chX + 3 ? (y > K.stoY - 12 ? SITE.perioral : SITE.chin) : SITE.jaw;
}
// per level-0 vertex: the one-hot weights of its SITE (n0 x SITES.length), blended across sites over the plexus's reach (iters rounds of a 1-ring mean on
// the level-0 head: ~4-6 mm a round on hm08's face; the subpapillary plexus and the light's own spread make a site's edge soft over millimetres, not a step);
// idx = the level-0 triangle index; a vertex the anatomy did not read has no weight (zones4.js keeps the zones' blood there)
export function siteWeights(T, n0, idx, iters = 2) {
  const ns = SITES.length, W = new Float32Array(n0 * ns);
  for (let v = 0; v < n0; v++) if (T?.has[v]) W[v * ns + T.site[v]] = 1;
  if (iters > 0 && idx) { const nb = Array.from({ length: n0 }, () => []);
    for (let t = 0; t < idx.length; t += 3) { const a = idx[t], b = idx[t + 1], c = idx[t + 2]; if (!T.has[a] || !T.has[b] || !T.has[c]) continue; nb[a].push(b, c); nb[b].push(a, c); nb[c].push(a, b); }
    let A = W, B = new Float32Array(W.length);
    for (let it = 0; it < iters; it++) { for (let v = 0; v < n0; v++) { const l = nb[v]; if (!l.length) { for (let k = 0; k < ns; k++) B[v * ns + k] = A[v * ns + k]; continue; }
      for (let k = 0; k < ns; k++) { let m = 0; for (const u of l) m += A[u * ns + k]; B[v * ns + k] = 0.5 * A[v * ns + k] + 0.5 * m / l.length; } } [A, B] = [B, A]; }
    return A; }
  return W;
}

// NODE: the head anatomy on this face and the tissue at every level-0 head vertex
async function buildTissue(h, P0, AH0, info, key, log = console.log) {
  const t0 = Date.now(), [FR, SK, HD, D, FC, PI, F6, Z4] = await Promise.all([import('../anatomy/skull/frame.js'), import('../anatomy/skull/skull.js'), import('../anatomy/head/index.js'),
    import('../anatomy/layer/sdf.js'), import('../face/index.js'), import('../person/index.js'), import('../face/face6.js'), import('./zones4.js')]);
  const F = await FC.loadFaceStudio(), st = await PI.loadPersonStudio(), hero = st.S.hero, side = hero.arr('eye_side'), tri = hero.arr('idx_body');
  const E = h.eyes?.geometry?.attributes?.position?.array; if (!E) throw new Error('tissue: the hero has no eye mesh');
  const Pf = new Float32Array(P0.subarray(0, NB * 3)), G6 = F6.globes(E, side), fr = FR.headFrameFH(Pf, F.ids, { sex: info.sex, globes: G6 }), A = FR.livingAnchors(Pf, F.ids, fr, G6, { tri, E });
  const K = SK.drawSkull({ sex: info.sex, age: info.years, group: info.group || null, bmi: info.bmi ?? null, name: tissueSeed(info) }, A, { T: F.pop.tissue }), B = SK.buildSkull(K);
  const cast = Object.fromEntries(['ch_L', 'al_L', 'prn', 'sn', 'sto'].map(k => [k, fr.lm(k)]));
  const H = HD.buildHead(B, { sex: info.sex, age: info.years, bmi: info.bmi ?? 24, fitness: 0.5 }, { T: F.pop.tissue, cast }), t1 = Date.now();
  const R = { head: 0, neck: 1, jaw: 11 }, n = P0.length / 3, T = { td: new Float32Array(n), tf: new Float32Array(n), sub: new Uint8Array(n), aur: new Uint8Array(n), site: new Uint8Array(n), has: new Uint8Array(n) };
  // the face's landmarks in the anatomy's frame (mm; x lateral from the midline, y up, z forward): only to tell apart the sites of one bone (the frontal bone's
  // forehead from the temporal fossa, the nasal bones from the maxilla, the symphysis from the ramus) and of a vertex with nothing named under it
  const LM = k => { const id = Z4.FACE_IDS[k]; return fr.toMm([P0[id * 3], P0[id * 3 + 1], P0[id * 3 + 2]]); }, LR = (k, a) => (Math.abs(LM(k + '_L')[a]) + Math.abs(LM(k + '_R')[a])) / 2, LY = (k, a) => (LM(k + '_L')[a] + LM(k + '_R')[a]) / 2;
  const LK = { exX: LR('ex', 0), enX: LR('en', 0), chX: LR('ch', 0), alY: LY('al', 1), eyeY: LY('ex', 1), malZ: LY('mal', 2), earZ: LY('pra', 2), meY: LM('me')[1], pgZ: LM('pg')[2], stoY: LM('sto')[1] };
  const box = H.box, inBox = q => q[0] >= box[0] && q[0] <= box[3] && q[1] >= box[1] && q[1] <= box[4] && q[2] >= box[2] && q[2] <= box[5];
  // the auricle: within the ear's landmarks (zones4 FACE_IDS: superaurale, subaurale, preaurale, postaurale), standing off the skull's tissue
  const ear = ['L', 'R'].map(s => { const ids = ['sa_', 'sba_', 'pra_', 'pa_'].map(k => Z4.FACE_IDS[k + s]); const c = [0, 1, 2].map(a => ids.reduce((t, id) => t + P0[id * 3 + a], 0) / 4); return { c: fr.toMm(c), r: [18, 32, 20] }; });
  const inEar = q => ear.some(e => ((q[0] - e.c[0]) / e.r[0]) ** 2 + ((q[1] - e.c[1]) / e.r[1]) ** 2 + ((q[2] - e.c[2]) / e.r[2]) ** 2 < 1);
  let cnt = 0, nAur = 0, nLid = 0; const hist = {}, parts = {}, sites = {}, lidT = Math.min(H.skin([B.globe.L.c[0], B.globe.L.c[1], B.globe.L.c[2] + 8]), H.skin([B.globe.R.c[0], B.globe.R.c[1], B.globe.R.c[2] + 8]));
  for (let v = 0; v < Math.min(n, NB); v++) { const reg = AH0[v * 4]; if (reg !== R.head && reg !== R.jaw && reg !== R.neck) continue;
    const q = fr.toMm([P0[v * 3], P0[v * 3 + 1], P0[v * 3 + 2]]); if (!inBox(q)) continue;
    const tS = H.skin(q), aI = D.labelAt(H.inner, q[0], q[1], q[2]), aM = D.labelAt(H.innerM, q[0], q[1], q[2]), dI = aI.d, dM = aM.d;
    const useM = dM < dI && aM.label === LBL.muscle, dd = useM ? dM : dI, lab = useM ? aM.label : aI.label, part = String((useM ? aM.part : aI.part) || '');
    let td = Math.max(0.2, tS - EPI_MM), tf = Math.max(0, dd - tS), sub = lab || LBL.supFat, aur = 0;
    // EYELID SKIN: the skin over the orbital aperture (on the palpebral orbicularis, in front of the septum, the orbital fat and the globe; from the lid
    // margin to the orbital rim, where the lid-cheek junction begins the cheek's thicker skin) is one tissue, the thinnest of the face, with no subcutaneous
    // fat between it and the muscle (oculoplastic anatomy). Found from the anatomy: the nearest solid is the globe, the orbital fat or the palpebral
    // orbicularis, or the orbicularis oculi where no bone lies within 6 mm (not on the rim). Its thickness is the anatomy's own lid value (skinThickness
    // at the lids' centre: FACE6's 0.75 mm, Ha et al. 2005, thinning with age); under it the orbicularis' palpebral part (muscle).
    const boneD = H.G ? H.G.value(q[0], q[1], q[2]) : 99;
    let lid = 0; if (/^(orbital|globe)|palpebral/i.test(part) || (/orbicularis oculi/i.test(part) && boneD > 6)) { td = Math.max(0.2, Math.min(td, lidT - EPI_MM)); tf = 0; sub = LBL.muscle; nLid++; lid = 1; }
    if (inEar(q) && (dd - tS > 6 || H.phiSub(q[0], q[1], q[2]) - tS > 2)) { aur = 1; sub = LBL.cartilage; tf = 0; td = Math.max(0.2, Math.min(td, 0.95) - EPI_MM); nAur++; }   // the auricle's skin on its cartilage (~0.8-1 mm; approximate)
    const site = siteOf(part, lab, q, LK, lid, aur); sites[SITES[site]] = (sites[SITES[site]] || 0) + 1;
    T.td[v] = td; T.tf[v] = Math.min(25, tf); T.sub[v] = sub; T.aur[v] = aur; T.site[v] = site; T.has[v] = 1; cnt++; hist[SUB_OF[sub] || sub] = (hist[SUB_OF[sub] || sub] || 0) + 1; parts[part || '-'] = (parts[part || '-'] || 0) + 1; }
  const info2 = { key, n: cnt, auricle: nAur, eyelid: nLid, lidSkinMm: +lidT.toFixed(2), substrate: hist, sites, parts: Object.fromEntries(Object.entries(parts).sort((a, b) => b[1] - a[1]).slice(0, 24)), ms: { head: t1 - t0, sample: Date.now() - t1 }, skull: 'drawn on the final face, its residual seeded by the person (' + tissueSeed(info) + ')' };
  log(`skin7 tissue: built ${key} (${cnt} head vertices, auricle ${nAur}, eyelid ${nLid} at ${lidT.toFixed(2)} mm, ${JSON.stringify(hist)}, sites ${JSON.stringify(sites)}; head ${((t1 - t0) / 1000).toFixed(0)} s, sample ${((Date.now() - t1) / 1000).toFixed(1)} s)`);
  return { T, info: info2 };
}
// the person's tissue: { T (level-0 arrays) | null, key, source: 'cache' | 'built' | 'missing', report }
export async function headTissue(h, { info, build = true, url = null, log = console.log } = {}) {
  const ud = h.body.userData || {}, g0 = ud.geomL0 || h.body.geometry, P0 = g0.attributes.position.array, AH0 = ud.aHeroL0 || h.aHero, n0 = P0.length / 3;
  const code = await anatCode(), key = tissueKey(P0, info, code, AH0);
  let T = await loadTissue(key, n0, url), source = 'cache', rep = null;
  if (!T && build && isNode() && (typeof process === 'undefined' || process.env.SKIN7_TISSUE_BUILD !== '0')) {
    try { const r = await buildTissue(h, P0, AH0, info, key, log); T = r.T; rep = r.info; source = 'built';
      const fsM = 'node:fs', fs = await import(fsM), dir = new URL(url || BASE()); if (dir.protocol === 'file:') { fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(new URL(key + '.bin', dir), encode(T, n0)); fs.writeFileSync(new URL(key + '.json', dir), JSON.stringify({ kind: 'skin7 tissue (Uint8 x4 per level-0 vertex: td 0.02 mm, tf 0.1 mm, LBL substrate (0 = none), auricle)', version: TISSUE_VERSION, code, info: { ...info }, made: new Date().toISOString(), by: 'lib/fx/likeness/tissue.js headTissue (node)', ...rep }, null, 1)); }
      _cache.set((url || BASE()) + key, Promise.resolve(T)); }
    catch (e) { log('skin7 tissue: the build failed: ' + (e?.stack || e)); source = 'missing'; rep = { error: String(e?.message || e) }; } }
  if (!T) source = 'missing';
  return { T, key, code, source, n0, report: rep };
}
// per level-0 vertex: the LUT's tissue coordinates (tdI, s) and the share of cartilage-backed skin (the nasal lobule, the auricle); vertices without tissue sit at the reference
export function tissueCoords(M, T, n0) {
  const ref = refCoords(M), tdI = new Float32Array(n0).fill(ref[0]), s = new Float32Array(n0).fill(ref[1]), cart = new Float32Array(n0), memo = new Map();
  for (let v = 0; v < n0; v++) { if (!T?.has[v]) continue; const sub = T.aur[v] ? 'auricle' : SUB_OF[T.sub[v]] || 'fat', tf = T.aur[v] ? 0 : Math.round(T.tf[v] * 4) / 4, k = sub + '|' + tf;
    let sv = memo.get(k); if (sv == null) { sv = backingS(M, backingSpectrum(M, tf, sub)); memo.set(k, sv); }
    tdI[v] = tdIOf(T.td[v]); s[v] = sv; cart[v] = sub === 'cartilage' || sub === 'auricle' ? 1 : 0; }
  return { tdI, s, cart, ref };
}
