// FACE TISSUE (HUMAN c8 round 6, FACE6, 4 Oct): the face built the way lane A builds the body: a FACIAL SKELETON as parameters, the
// MUSCLES and FAT COMPARTMENTS over it, the SKIN over them, with the creases where the retaining ligaments tether the skin. Opt-in: only
// face/face6.js imports this file (face rev 7); lane A's defaults, every bake and every other person are untouched.
//
// What it is (all positions in the person's bind space; the anatomy's own numbers in millimetres, scaled by the head's size):
//  - ANCHORS from the person's own landmarks (FACE P2's Farkas set) plus a geometric gonion (the jaw's angle found on the mesh: P2's
//    'go' vertex sits on the back of the neck on several people).
//  - SKELETON: 15 parameters (brow ridge, frontal bossing, forehead slope, nasion, nasal bones, infraorbital rim, malar body projection
//    and height, maxilla, paranasal (pyriform) region, alveolar process, chin projection and width, width at the angle, gonial angle,
//    ramus), each a smooth displacement of the BONE surface (mm per SD at its centre), drawn per person (sex, age, group, the
//    person's femininity draw; within-sex z ~ N(0, 1) by the seed). Age remodelling of the bone (Shaw et al. 2010, 2011; Mendelson
//    and Wong 2012; Kahn and Shaw 2008, as recalled: the orbit enlarges inferolaterally and superomedially, the pyriform aperture and
//    the maxilla recede, the gonial angle opens, the chin recedes a little) as per-decade terms from 30.
//    The soft tissue follows the bone by a TRANSMISSION (orthognathic soft-to-hard ratios, as recalled: chin ~0.9, lower lip ~0.7,
//    upper lip ~0.5, nasal tip ~0.3, cheeks ~0.85); the teeth and the eyes ride the bone whole.
//  - SOFT TISSUE DEPTH: FACE P2's cited site table (Stephan and Simpson 2008; Stephan 2017 T-Table; De Greef et al. 2006; Manhein et
//    al. 2000: by sex, per decade, per BMI unit) interpolated over the face: bone = skin - depth x normal. The layers below share it.
//  - MUSCLES (thickness, mm): masseter (Raadsheer et al. 1996, ultrasound at rest, as recalled: men ~11-13, women ~9-11), temporalis,
//    orbicularis oculi and oris, zygomaticus major, levator labii, buccinator, mentalis, frontalis.
//  - FAT COMPARTMENTS (Rohrich and Pessa 2007, superficial; Rohrich, Pessa and Ristow 2008, deep medial cheek; Gierloff et al. 2012,
//    deep compartments deflate with age; Wan et al. 2013/2014 and Gosain et al. 2005, MRI: the superficial midface fat and the
//    nasolabial fat thicken and descend with age; Darcy et al. 2008, the lower orbital fat protrudes): superficial nasolabial, medial,
//    middle and lateral cheek, jowl, infraorbital, forehead; deep SOOF, deep medial cheek (DMCF), the buccal fat pad, ROOF, the lower
//    orbital fat, the mental fat. Each: a shape over its anchors, a thickness at 30 years and BMI 24 by sex, a per-decade change (gain or
//    deflation) and DESCENT (mm per decade from 30), a per-BMI-unit change, an identity SD. Their sum at each forensic site is held
//    to the table (the layers distribute the table's depth; they do not invent a second one).
//  - LIGAMENTS (the lines where the skin is tethered: orbicularis retaining ligament (the tear trough and the palpebromalar groove), the
//    nasolabial line, the mandibular ligament (the marionette line)); a superficial compartment thins to nothing at its tether, so as
//    it thickens and descends with age the fold appears on the free side: the creases come from the layers.
//  - SKIN thickness by region (Ha et al. 2005; Chopra et al. 2015, ultrasound, as recalled: lids ~0.6-0.8, forehead ~1.8-2, cheek ~1.5-1.7,
//    nose ~2, chin ~2, vermilion ~1), thinning ~5 % a decade from 40; the skin is a sheet: a fold's sharpness is its thickness.
// Every number marked 'as recalled' is OUR reading of the literature, provisional; the ten HSRD-100 heads (CC BY 4.0) are used only to
// MEASURE (face6.js scanFit: how much of each head's deviation these parameters explain, and the SDs they need).
export const FT_VERSION = 1;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sst = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export function segDist(p, a, b) { const e = sub(b, a), w = sub(p, a), t = clamp(dot(w, e) / Math.max(dot(e, e), 1e-12)); return Math.hypot(w[0] - t * e[0], w[1] - t * e[1], w[2] - t * e[2]); }
export function polyDist(p, pts) { let d = Infinity; for (let i = 0; i + 1 < pts.length; i++) d = Math.min(d, segDist(p, pts[i], pts[i + 1])); return d; }
// the closest point of a polyline (and the distance)
export function polyClosest(p, pts) { let best = { d: Infinity, c: pts[0] };
  for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i], e = sub(pts[i + 1], a), t = clamp(dot(sub(p, a), e) / Math.max(dot(e, e), 1e-12)), c = add(a, mul(e, t)), d = Math.hypot(...sub(p, c)); if (d < best.d) best = { d, c }; }
  return best; }
const shapeCentre = S => S.k === 'blob' ? S.c : lerp(S.a, S.b, 0.5);

// ---------------------------------------------------------------- anchors
// faceAnchors(P, ids, nb) -> A: A.o (bind metres: between the inner canthi), A.s (size: this head / the reference head), A.lm(name) and
// A.side(name, sg) (mm, bind axes, origin A.o; sg +1 the person's left, -1 right), A.go(sg) (the geometric gonion), A.toMm(p), A.H (n-me mm)
export const REF_SIZE = 128;   // sqrt(t-t x n-me), mm, of the reference head (the v5 cast's women ~124, men ~133)
export function faceAnchors(P, ids, nb) {
  const o = [0, 1, 2].map(a => 0.5 * (P[ids.en_L * 3 + a] + P[ids.en_R * 3 + a]));
  const toMm = p => [(p[0] - o[0]) * 1000, (p[1] - o[1]) * 1000, (p[2] - o[2]) * 1000], at = g => toMm([P[g * 3], P[g * 3 + 1], P[g * 3 + 2]]);
  const lm = k => at(ids[k]), side = (k, sg) => at(ids[`${k}_${sg > 0 ? 'L' : 'R'}`]);
  const tt = Math.hypot(...sub(side('t', 1), side('t', -1))), H = Math.hypot(...sub(lm('n'), lm('me'))), s = Math.sqrt(tt * H) / REF_SIZE;
  // the gonion: the jaw's angle on the mesh: the most lateral skin point in a window below and in front of the tragion (P2's 'go'
  // vertex sits on the back of the neck on several of the cast); the window scales with n-me
  const goC = {};
  for (const sg of [1, -1]) { const t = side('t', sg), sba = side('sba', sg); let best = null;
    for (let v = 0; v < nb; v++) { const q = at(v); if (Math.sign(q[0]) !== sg) continue; if (q[1] > sba[1] - 0.12 * H || q[1] < t[1] - 0.62 * H || q[2] < t[2] - 12 || q[2] > t[2] + 22) continue;
      if (!best || Math.abs(q[0]) > Math.abs(best[0])) best = q; }
    goC[sg] = best ? [best[0] - sg * 1.5 * s, best[1] + 4 * s, best[2]] : [sg * 0.72 * Math.abs(side('zy', sg)[0]), t[1] - 0.48 * H, t[2] + 8 * s]; }
  return { o, s, H, tt, toMm, lm, side, go: sg => goC[sg], P };
}

// ---------------------------------------------------------------- primitive shapes (mm)
// blob: an ellipsoidal Gaussian; cap: a capsule along a segment; both return 0..1. o: offsets in mm x s.
const blob = (c, r) => ({ k: 'blob', c, r });
const cap = (a, b, r) => ({ k: 'cap', a, b, r });
export function shapeAt(S, p) {
  if (S.k === 'blob') { const dx = (p[0] - S.c[0]) / S.r[0], dy = (p[1] - S.c[1]) / S.r[1], dz = (p[2] - S.c[2]) / S.r[2]; const e = dx * dx + dy * dy + dz * dz; return e > 25 ? 0 : Math.exp(-0.5 * e); }
  const d = segDist(p, S.a, S.b) / S.r; return d > 5 ? 0 : Math.exp(-0.5 * d * d);
}
const off = (A, p, sg, dx, dy, dz = 0) => [p[0] + sg * dx * A.s, p[1] + dy * A.s, p[2] + dz * A.s];
const R = (A, r) => r.map(x => x * A.s);

// ---------------------------------------------------------------- 1. the skeleton
// SK: { key, sd (mm at the centre a unit moves; the drawn z is in these units), parts(A) -> [{ shape, d: [dx,dy,dz] at 1 SD (unit-free
// directions x sd), side }], sex: { f, m } mean offsets in SD (relative to OUR base head, which already carries MakeHuman's sex frame),
// fem: SD per unit of FACE3's femininity draw about 0.65 (women), group: { asian, black, ... } SD, age: SD per decade from 30, src }
const both = (A, fn) => [1, -1].flatMap(sg => fn(sg));
export const SKELETON = [
  { key: 'brow', sd: 1.4, fem: -1.4, group: { asian: -0.5 }, age: 0, src: 'supraorbital / glabellar projection: Enlow and Hans 1996 (the brow ridge, the most dimorphic forehead form); East Asian lower (FACE3)',
    parts: A => [{ s: blob(off(A, A.lm('g'), 1, 0, -2, -3), R(A, [13, 9, 9])), d: [0, 0, 1] }, ...both(A, sg => [{ s: blob(off(A, A.side('so', sg), sg, 2, -4, -2), R(A, [12, 7, 9])), d: [0, 0.2, 1] }])] },
  { key: 'bossing', sd: 1.3, fem: 0.8, age: 0, src: 'frontal eminences (women rounder foreheads: Enlow and Hans 1996)',
    parts: A => both(A, sg => [{ s: blob(off(A, A.lm('g'), sg, 22, 34, -10), R(A, [16, 16, 14])), d: [0.15 * sg, 0, 1] }]) },
  { key: 'slope', sd: 1.6, fem: 0.5, age: 0, src: 'frontal inclination (forehead slope), as recalled ~5 deg SD',
    parts: A => [{ s: blob(off(A, A.lm('g'), 1, 0, 48, -20), R(A, [34, 18, 16])), d: [0, 0, 1] }] },
  { key: 'nasion', sd: 1.3, group: { asian: -0.8, black: -0.4 }, age: 0, src: 'radix depth (soft nasion ahead of the canthi), as recalled; East Asian and Black radices lower (Farkas 1994, 2005)',
    parts: A => [{ s: blob(off(A, A.lm('n'), 1, 0, 1, -4), R(A, [9, 8, 8])), d: [0, 0, 1] }] },
  { key: 'nasal', sd: 1.4, fem: -0.5, group: { asian: -0.7, black: -0.6 }, age: 0, src: 'nasal bone projection at rhinion, as recalled',
    parts: A => [{ s: blob(off(A, A.lm('rhi'), 1, 0, 3, -4), R(A, [8, 11, 8])), d: [0, 0.15, 1] }] },
  { key: 'orbitRim', sd: 1.2, age: -0.22, src: 'infraorbital rim projection (negative vector); orbital aperture widens inferolaterally with age (Kahn and Shaw 2008)',
    parts: A => both(A, sg => [{ s: blob(off(A, A.side('or', sg), sg, 4, -3, -3), R(A, [13, 6, 8])), d: [0.2 * sg, 0, 1] }]) },
  { key: 'malarProj', sd: 1.8, fem: 0.5, age: -0.1, src: 'zygomatic body projection, as recalled; the malar body recedes a little with age (Shaw 2011)',
    parts: A => both(A, sg => [{ s: blob(off(A, A.side('mal', sg), sg, -3, 5, -2), R(A, [12, 11, 11])), d: [0.45 * sg, 0, 1] }]) },
  { key: 'malarHeight', sd: 1.5, fem: 0.7, age: 0, src: 'malar height (high cheekbones), as recalled',
    parts: A => both(A, sg => [{ s: blob(off(A, A.side('mal', sg), sg, -2, 4, -3), R(A, [13, 11, 11])), d: [0, 1, 0.3] }]) },
  { key: 'maxilla', sd: 1.6, age: -0.12, src: 'maxillary (A-point) projection, SNA SD ~3.5 deg as recalled; the maxilla recedes with age (Shaw 2010)',
    parts: A => [{ s: blob(off(A, A.lm('mph'), 1, 0, 2, -6), R(A, [18, 11, 10])), d: [0, 0, 1] }] },
  { key: 'paranasal', sd: 1.2, age: -0.3, src: 'paranasal (pyriform rim) projection; the pyriform aperture recedes and widens with age (Mendelson and Wong 2012)',
    parts: A => both(A, sg => [{ s: blob(off(A, A.side('al', sg), sg, 7, 2, -5), R(A, [8, 10, 8])), d: [0.25 * sg, 0, 1] }]) },
  { key: 'alveolar', sd: 1.3, age: 0, src: 'alveolar prognathism (incisor support of the lips), as recalled; the group means stay with FACE4\'s E-line tables',
    parts: A => [{ s: blob(off(A, A.lm('sto'), 1, 0, 1, -8), R(A, [16, 12, 9])), d: [0, 0, 1] }] },
  { key: 'chinProj', sd: 2.2, fem: -0.6, age: -0.08, src: 'soft pogonion projection, as recalled ~3 mm SD (Holdaway 1983 norms)',
    parts: A => [{ s: blob(off(A, A.lm('pg'), 1, 0, 0, -4), R(A, [13, 11, 10])), d: [0, 0, 1] }] },
  { key: 'chinWidth', sd: 1.3, fem: -1.2, age: 0, src: 'chin breadth, as recalled; women narrower (Enlow and Hans 1996)',
    parts: A => both(A, sg => [{ s: blob(off(A, A.lm('pg'), sg, 13, -3, -6), R(A, [8, 11, 10])), d: [sg, 0, 0] }]) },
  { key: 'gonialWidth', sd: 2.8, fem: -1.1, age: 0, src: 'bigonial breadth go-go: Farkas 1994 women 91.1 +- 5.9 mm (2.9 a side)',
    parts: A => both(A, sg => [{ s: blob(A.go(sg), R(A, [12, 16, 16])), d: [sg, 0, 0] }]) },
  { key: 'gonialAngle', sd: 1.4, fem: 0.8, age: 0.12, src: 'gonial angle (obtuse = the angle cut up and forward), ~5-6 deg SD; opens with age and tooth loss (Shaw 2010)',
    parts: A => both(A, sg => [{ s: blob(off(A, A.go(sg), sg, 0, -2, -2), R(A, [11, 11, 12])), d: [-0.3 * sg, 0.7, 0.65] }]) },
  { key: 'ramus', sd: 1.6, fem: -0.4, age: -0.06, src: 'ramus height (posterior face height), as recalled',
    parts: A => both(A, sg => [{ s: blob(off(A, A.go(sg), sg, 0, -3, -4), R(A, [12, 12, 13])), d: [0, -1, 0] }]) },
  // the LARGE-SCALE skeleton (the proportions the real heads differ by most: SCAN c1's spread is mostly the face's overall convexity,
  // depth, taper and heights, not its local forms; FACE P2's drawn measures carry the distances, these the shape between them)
  { key: 'convexity', sd: 2.2, age: -0.1, src: 'facial convexity (the midface ahead of the forehead and chin: SNA / ANB, as recalled 3-4 deg SD); the midface recedes with age',
    parts: A => [{ s: blob(off(A, A.lm('sn'), 1, 0, -2, -10), R(A, [30, 24, 26])), d: [0, 0, 1] }] },
  { key: 'mandible', sd: 2.2, age: -0.05, src: 'mandibular prognathism (SNB), the whole lower jaw forward or back, as recalled',
    parts: A => [{ s: blob(off(A, A.lm('pg'), 1, 0, 4, -12), R(A, [36, 18, 26])), d: [0, 0, 1] }] },
  { key: 'flatness', sd: 1.8, group: { asian: 0.6 }, src: 'midface flatness: the cheekbones forward against the nose (the transverse facial profile; East Asian faces flatter, as recalled)',
    parts: A => both(A, sg => [{ s: blob(off(A, A.side('mal', sg), sg, -6, 4, 4), R(A, [18, 22, 18])), d: [0.25 * sg, 0, 1] }]) },
  { key: 'lowerHeight', sd: 2.0, age: 0, src: 'lower face height (the mandibular plane: long vs short faces), as recalled; FACE P2 draws sn-me, this the jaw line\'s slope',
    parts: A => [{ s: blob(off(A, A.lm('me'), 1, 0, 6, 4), R(A, [40, 20, 36])), d: [0, -1, 0.15] }] },
  { key: 'taper', sd: 2.0, fem: -0.5, src: 'the lower face\'s width against the cheeks (a tapered vs a square face), as recalled',
    parts: A => both(A, sg => [{ s: blob(lerp(A.go(sg), A.side('ch', sg), 0.35), R(A, [18, 26, 26])), d: [sg, 0, 0] }]) },
  { key: 'foreheadH', sd: 1.8, src: 'forehead height and fullness, as recalled',
    parts: A => [{ s: blob(off(A, A.lm('g'), 1, 0, 40, -16), R(A, [40, 22, 26])), d: [0, 0.6, 0.8] }] },
  // two soft-tissue positions drawn with the skeleton: the brow's height (frontalis tone and the brow's fat pad; women's brows sit higher
  // and arch more: Farkas 1994; the brow descends with age, as recalled ~1 mm a decade from 40) and the alar base's width (al-al itself is
  // FACE P2's drawn measure; this is the base's flare)
  { key: 'browLift', sd: 1.2, fem: 1.0, age: -0.2, src: 'brow height (soft tissue), women higher; brow ptosis with age',
    parts: A => both(A, sg => [{ s: blob(off(A, A.side('so', sg), sg, 2, -2, -2), R(A, [13, 6, 9])), d: [0, 1, 0.1] }]) },
  { key: 'alarFlare', sd: 1.0, fem: -0.5, age: 0.05, src: 'alar base flare, as recalled; the nose widens a little with age',
    parts: A => both(A, sg => [{ s: blob(off(A, A.side('al', sg), sg, 1, 0, -2), R(A, [6, 7, 7])), d: [sg, 0, 0] }]) },
];
// the person's skeleton draw: z per key (SD units) from the seed, the sex and group means, the femininity draw, and age (bone remodelling)
export function skeletonZ(info, r, o = {}) {
  const f = info.sex === 'f', fem = f ? (info.fem ?? 0.65) : null, gm = o.groupMix || { [info.group || 'white']: 1 }, age = info.age ?? 35, amp = o.amp ?? 1, out = {};
  for (const K of SKELETON) { const g = gaussR(r);
    let z = amp * clamp(g, -1.5, 1.5);
    // (FACE3's femininity d ~ 0.65 +- 0.18: the within-range feminisation its targets drew on top of MakeHuman's female head, now the
    // skeleton's, at 0.6 of the SD a unit; the person's total held inside +-2 SD: within range, never a caricature)
    if (fem != null && K.fem) z += 0.6 * K.fem * fem;
    if (K.group) for (const [k, v] of Object.entries(K.group)) z += v * (gm[k] || 0);
    if (K.age && (o.age ?? true)) z += K.age * Math.max(0, age - 30) / 10;
    out[K.key] = +clamp(z, -2.0, 2.0).toFixed(3); }
  return out;
}
function gaussR(r) { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }
// the unit fields of the skeleton (per key, evaluated at a point in mm): built once per person (parts depend on the anchors)
export function skeletonParts(A) { return SKELETON.map(K => ({ key: K.key, sd: K.sd, parts: K.parts(A) })); }
export function boneAt(SP, z, p, out = [0, 0, 0]) { out[0] = out[1] = out[2] = 0;
  for (const K of SP) { const zz = z[K.key]; if (!zz) continue; for (const q of K.parts) { const w = shapeAt(q.s, p); if (w < 1e-4) continue; const k = zz * K.sd * w; out[0] += k * q.d[0]; out[1] += k * q.d[1]; out[2] += k * q.d[2]; } }
  return out; }
// soft-to-hard transmission (how much of the bone's displacement the skin surface takes), by region
export function transmissionAt(A, p) {
  let t = 0.88;
  const lip = shapeAt(blob(off(A, A.lm('sto'), 1, 0, 0, 0), R(A, [26, 12, 10])), p), tip = shapeAt(blob(off(A, A.lm('prn'), 1, 0, -4, 0), R(A, [13, 12, 10])), p);
  const chin = shapeAt(blob(A.lm('pg'), R(A, [16, 12, 12])), p), lids = Math.max(...[1, -1].map(sg => shapeAt(blob(off(A, A.side('pi', sg), sg, -3, 3, 0), R(A, [12, 7, 6])), p)));
  t = t * (1 - lip) + 0.55 * lip; t = t * (1 - tip) + 0.3 * tip; t = t * (1 - chin) + 0.92 * chin; t = t * (1 - lids) + 0.45 * lids;
  return t;
}

// ---------------------------------------------------------------- 2. soft-tissue depth (P2's site table) and the layers
// the sites (P2's landmark names; bilateral ones per side); the depth at a site for this person (mm)
const SITES = ['sg', 'g', 'n', 'rhi', 'mph', 'ls', 'li', 'sl', 'pg', 'gn', 'me', 'so', 'or', 'mal', 'buc', 'mas', 'go'];
export function siteDepth(T, key, sex, age, bmi) { const s = T.sites[key]; if (!s) return null; const ref = T.ref || { age: 35, bmi: 24 };
  return Math.max(0.8, (sex === 'm' ? s.m : s.f) + s.perDecade * ((age ?? 35) - ref.age) / 10 + s.perBMI * ((bmi ?? 24) - ref.bmi)); }
// the site points (mm): P2's landmarks, except the masseter and gonion sites (geometric, see faceAnchors)
export function sitePoints(A) { const out = [];
  for (const k of SITES) { if (['so', 'or', 'mal', 'buc'].includes(k)) { for (const sg of [1, -1]) out.push([k, A.side(k, sg)]); continue; }
    if (k === 'go') { for (const sg of [1, -1]) out.push([k, A.go(sg)]); continue; }
    if (k === 'mas') { for (const sg of [1, -1]) out.push([k, lerp(A.side('zy', sg), A.go(sg), 0.55)]); continue; }
    out.push([k, A.lm(k)]); }
  return out; }
// the smooth depth field (mm) at p: normalised Gaussian weights over the sites (sigma 14 mm x s), the scalp's 5.5 mm far away
export function depthAt(A, sites, p, far = 5.5) { let s = 0, w = 0.02;
  for (const [, q, d] of sites) { const e = ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2) / (14 * A.s) ** 2; if (e > 30) continue; const g = Math.exp(-0.5 * e); s += g * d; w += g; }
  return (s + 0.02 * far) / w; }

// MUSCLES and FAT: { key, layer: 'muscle' | 'superficial' | 'deep', shape(A, sg) (mm), T: { f, m } mm at 30 y, BMI 24, age (fraction a decade
// from 30: + gain, - deflation / atrophy), descent (mm a decade from 30), bmi (fraction a BMI unit from 24), z (identity SD, fraction),
// tether (ligament keys: the compartment thins to 0 at that line), bulge (a fixed mm a decade from 30, for the lower orbital fat), src }
export const LAYERS = [
  // muscles (on the bone, under the fat)
  { key: 'masseter', layer: 'muscle', T: { f: 10, m: 12 }, age: -0.04, bmi: 0, z: 0.12, shape: (A, sg) => cap(lerp(off(A, A.side('zy', sg), sg, -4, -6, 4), A.go(sg), 0.1), lerp(off(A, A.side('zy', sg), sg, -4, -6, 4), A.go(sg), 0.88), 9 * A.s),
    src: 'Raadsheer et al. 1996 (ultrasound, rest), as recalled' },
  { key: 'temporalis', layer: 'muscle', T: { f: 5, m: 6 }, age: -0.08, bmi: 0, z: 0.1, shape: (A, sg) => blob(off(A, A.side('zy', sg), sg, -3, 30, 10), R(A, [9, 18, 18])), src: 'temporal hollowing with age (atrophy and fat loss), as recalled' },
  { key: 'orbOculi', layer: 'muscle', T: { f: 1.0, m: 1.2 }, age: -0.03, bmi: 0, z: 0.1, shape: (A, sg) => blob(off(A, A.side('pi', sg), sg, 2, -6, -2), R(A, [16, 8, 8])), src: 'orbicularis oculi (pars orbitalis over the rim)' },
  { key: 'orbOris', layer: 'muscle', T: { f: 5, m: 6 }, age: -0.08, bmi: 0, z: 0.1, shape: A => blob(off(A, A.lm('sto'), 1, 0, 1, -3), R(A, [22, 10, 7])), src: 'orbicularis oris: the lips thin with age (Iblher et al. 2008; Penna et al. 2009: direction; the site table: ls -0.6 mm a decade)' },
  { key: 'zygomaticus', layer: 'muscle', T: { f: 2.2, m: 2.6 }, age: -0.03, bmi: 0, z: 0.1, shape: (A, sg) => cap(off(A, A.side('ch', sg), sg, 9, 2, -3), off(A, A.side('mal', sg), sg, 4, 8, -6), 3 * A.s), src: 'zygomaticus major (2-3 mm), as recalled' },
  { key: 'levator', layer: 'muscle', T: { f: 1.8, m: 2.0 }, age: -0.03, bmi: 0, z: 0.1, shape: (A, sg) => cap(off(A, A.side('or', sg), sg, -3, -6, -3), off(A, A.side('ch', sg), sg, -9, 9, -2), 3.5 * A.s), src: 'levator labii superioris' },
  { key: 'buccinator', layer: 'muscle', T: { f: 3, m: 3.5 }, age: -0.03, bmi: 0, z: 0.1, shape: (A, sg) => blob(off(A, A.side('ch', sg), sg, 15, 1, -12), R(A, [9, 9, 9])), src: 'buccinator' },
  { key: 'mentalis', layer: 'muscle', T: { f: 4, m: 5 }, age: -0.04, bmi: 0, z: 0.12, shape: A => blob(off(A, A.lm('pg'), 1, 0, 3, -3), R(A, [11, 10, 8])), src: 'mentalis (the chin pad), as recalled' },
  { key: 'frontalis', layer: 'muscle', T: { f: 1.2, m: 1.4 }, age: -0.03, bmi: 0, z: 0.1, shape: A => blob(off(A, A.lm('g'), 1, 0, 30, -8), R(A, [34, 22, 16])), src: 'frontalis' },
  // deep fat (on the bone or the periosteum, under the SMAS)
  { key: 'soof', layer: 'deep', T: { f: 2.6, m: 2.2 }, age: -0.15, descent: 0.4, bmi: 0.03, z: 0.2, shape: (A, sg) => cap(off(A, A.side('or', sg), sg, -5, -5, -1), off(A, A.side('or', sg), sg, 16, -3, -6), 4.5 * A.s),
    src: 'sub-orbicularis oculi fat: deflates with age (Gierloff et al. 2012)' },
  { key: 'dmcf', layer: 'deep', T: { f: 5.0, m: 4.2 }, age: -0.15, descent: 0.6, bmi: 0.035, z: 0.2, shape: (A, sg) => blob(off(A, lerp(A.side('al', sg), A.side('mal', sg), 0.42), sg, 0, 3, 2), R(A, [10, 11, 9])),
    src: 'deep medial cheek fat: its deflation makes the midface V and the nasolabial fold (Rohrich, Pessa and Ristow 2008; Gierloff 2012)' },
  { key: 'buccalPad', layer: 'deep', T: { f: 5.5, m: 5.0 }, age: -0.05, descent: 1.2, bmi: 0.07, z: 0.22, shape: (A, sg) => blob(off(A, A.side('buc', sg), sg, 3, 7, -6), R(A, [9, 10, 9])),
    src: 'buccal fat pad, buccal extension: descends with age; the most BMI-sensitive (the site table: buc +0.9 mm a BMI unit)' },
  { key: 'roof', layer: 'deep', T: { f: 2.0, m: 2.2 }, age: -0.08, descent: 0.6, bmi: 0.03, z: 0.2, shape: (A, sg) => blob(off(A, A.side('so', sg), sg, 3, -5, -2), R(A, [12, 4.5, 6])), src: 'retro-orbicularis oculi fat (the brow\'s fat pad): deflates and descends' },
  { key: 'orbitalLow', layer: 'deep', T: { f: 0, m: 0 }, bulge: 0.45, age: 0, descent: 0, bmi: 0, z: 0.25, tether: ['tear'], shape: (A, sg) => blob(off(A, A.side('pi', sg), sg, -1, -5.5, 1), R(A, [9, 3.6, 4])),
    src: 'the lower orbital fat protrudes past a weakening septum with age (Darcy et al. 2008): the lid bag over the tear trough' },
  // superficial fat (over the SMAS, under the skin)
  { key: 'nasolabial', layer: 'superficial', T: { f: 3.2, m: 3.0 }, age: 0.15, descent: 1.2, bmi: 0.04, z: 0.2, tether: ['nl'], shape: (A, sg) => cap(off(A, A.side('al', sg), sg, 8, -3, -3), off(A, A.side('ch', sg), sg, 9, -2, -4), 5.5 * A.s),
    src: 'nasolabial compartment: thickens and descends with age (Gosain et al. 2005; Wan et al. 2014)' },
  { key: 'medialCheek', layer: 'superficial', T: { f: 3.2, m: 2.8 }, age: 0, descent: 1.4, bmi: 0.04, z: 0.2, tether: ['tear'], shape: (A, sg) => blob(off(A, A.side('or', sg), sg, 3, -15, -2), R(A, [11, 9, 9])),
    src: 'superficial medial cheek fat (Rohrich and Pessa 2007): descends' },
  { key: 'middleCheek', layer: 'superficial', T: { f: 3.4, m: 3.0 }, age: -0.03, descent: 1.0, bmi: 0.045, z: 0.2, tether: ['pmal'], shape: (A, sg) => blob(off(A, A.side('mal', sg), sg, -3, -9, 0), R(A, [12, 10, 10])), src: 'middle cheek fat' },
  { key: 'lateralCheek', layer: 'superficial', T: { f: 2.4, m: 2.2 }, age: 0, descent: 0.6, bmi: 0.04, z: 0.15, shape: (A, sg) => blob(off(A, A.side('zy', sg), sg, -5, -16, 8), R(A, [9, 18, 13])), src: 'lateral temporal-cheek fat' },
  { key: 'jowl', layer: 'superficial', T: { f: 1.6, m: 1.6 }, age: 0.22, descent: 1.6, bmi: 0.07, z: 0.22, tether: ['mar'], shape: (A, sg) => cap(off(A, A.side('ch', sg), sg, 11, -9, -6), off(A, A.side('ch', sg), sg, 14, -24, -10), 6 * A.s),
    src: 'jowl fat: grows and falls with age to the mandibular ligament (Reece et al. 2008; Wan 2014)' },
  { key: 'infraorbital', layer: 'superficial', T: { f: 0.9, m: 0.8 }, age: -0.06, descent: 0.4, bmi: 0.02, z: 0.15, tether: ['lid'], shape: (A, sg) => blob(off(A, A.side('pi', sg), sg, 2, -8, -1), R(A, [10, 5, 6])), src: 'infraorbital superficial fat (thin)' },
  { key: 'forehead', layer: 'superficial', T: { f: 1.6, m: 1.4 }, age: -0.05, descent: 0.4, bmi: 0.02, z: 0.15, shape: A => blob(off(A, A.lm('g'), 1, 0, 30, -8), R(A, [32, 20, 16])), src: 'forehead central and middle fat' },
  { key: 'mental', layer: 'superficial', T: { f: 2.0, m: 2.2 }, age: 0.02, descent: 0.3, bmi: 0.04, z: 0.15, shape: A => blob(off(A, A.lm('pg'), 1, 0, -3, -2), R(A, [12, 9, 8])), src: 'mental fat' },
];
// the retaining ligaments: the skin's tethers (mm polylines per side); FACE5's crease lines placed anatomically
export function ligaments(A, sg) {
  const al = A.side('al', sg), ch = A.side('ch', sg), pi = A.side('pi', sg), en = A.side('en', sg), ex = A.side('ex', sg), o = (p, dx, dy, dz = 0) => off(A, p, sg, dx, dy, dz);
  return {
    nl: { pts: [o(al, 3, 1), o(ch, 6, -2), o(ch, 8.5, -14)], w: 3.2 * A.s },                       // the nasolabial line (the fold's medial edge)
    tear: { pts: [o(en, 1, -4), o(en, 6, -12), o(pi, 9, -9)], w: 2.8 * A.s },                      // the orbicularis retaining ligament, medial: the tear trough
    pmal: { pts: [o(pi, 9, -9), o(ex, 6, -11), o(ex, 14, -6)], w: 3.0 * A.s },                     // ... lateral: the palpebromalar groove
    lid: { pts: [o(pi, -7, -6.5), o(pi, 0, -7.5), o(pi, 9, -6)], w: 2.4 * A.s },                   // the lid-cheek junction
    mar: { pts: [o(ch, 1.5, -4), o(ch, 3.5, -16), o(ch, 5, -24)], w: 3.0 * A.s },                  // the mandibular ligament: the marionette line
  };
}
// skin thickness (mm) by region (as recalled; see the header)
export function skinAt(A, p, age) {
  let t = 1.6; const reg = [[blob(off(A, A.lm('g'), 1, 0, 26, -6), R(A, [34, 24, 16])), 1.9], [blob(off(A, A.lm('prn'), 1, 0, 0, -3), R(A, [10, 14, 8])), 2.0],
    [blob(A.lm('pg'), R(A, [14, 10, 10])), 2.1], [blob(off(A, A.lm('sto'), 1, 0, 0, 0), R(A, [20, 7, 6])), 1.1],
    ...[1, -1].map(sg => [blob(off(A, A.side('pi', sg), sg, -4, 2, 0), R(A, [12, 7, 6])), 0.7])];
  for (const [S, v] of reg) { const w = shapeAt(S, p); t = t * (1 - w) + v * w; }
  return t * (1 - 0.05 * Math.max(0, (age ?? 35) - 40) / 10);
}
// the skin's LAXITY by age: how much of the ligaments' tether shows through it (a young skin's tension bridges the septa; the fold
// appears as the skin slackens and the fat above the ligament thickens and falls: Gosain 2005, Wan 2014). OUR curve, provisional
export const laxity = age => clamp(((age ?? 35) - 18) / 42, 0.12, 1);
// a compartment's thickness (mm) at p for (sex, age, bmi, z): the shape descended by age, the amount by age / BMI / identity, the tethers
export function layerThickness(L, A, p, sg, st, LIG, teth = true) {
  const sex = st.sex === 'm' ? 'm' : 'f', dec = Math.max(0, (st.age ?? 35) - 30) / 10, young = Math.max(0, 30 - (st.age ?? 35)) / 10;
  const desc = (L.descent || 0) * dec * A.s, q = desc ? [p[0], p[1] + desc, p[2]] : p;   // sampled higher = the shape moved down
  const sh = L.shape(A, sg), w = shapeAt(sh, q); if (w < 1e-4) return 0;
  // the young keep the deep fat they lose later (the age slope mirrored below 30, at half)
  const ageK = 1 + (L.age || 0) * dec - (L.age < 0 ? 0.5 * L.age * young : 0), bmiK = 1 + (L.bmi || 0) * ((st.bmi ?? 24) - 24), zK = 1 + (L.z || 0) * (st.z?.[L.key] ?? 0);
  let t = (L.T[sex] * Math.max(0.2, ageK) * Math.max(0.3, bmiK) + (L.bulge || 0) * dec) * Math.max(0.2, zK) * w;
  // the tether: the compartment thins to nothing at the ligament and the tissue it holds back piles beside it, on the compartment's side
  // (the skin draped over the compartment's edge: a groove at the line, a roll beyond it)
  if (teth && L.tether && LIG) for (const k of L.tether) { const lg = LIG[k]; if (!lg) continue; const { d, c } = polyClosest(p, lg.pts), cc = shapeCentre(sh), own = dot(sub(p, c), sub(cc, c)) > 0;
    t *= 1 - Math.exp(-0.5 * (d / lg.w) ** 2) + (own ? (L.roll ?? 0.7) * Math.exp(-0.5 * ((d - 1.7 * lg.w) / lg.w) ** 2) : 0); }
  return t;
}
