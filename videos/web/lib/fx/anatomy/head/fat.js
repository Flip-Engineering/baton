// ANAT8-HEAD (it3, 8 Oct): the FAT of the face as layers on our anatomy. FACE6's literature as data (body/face_tissue.js LAYERS: Rohrich
// and Pessa 2007 superficial compartments; Rohrich, Pessa and Ristow 2008 the deep medial cheek; Gierloff et al. 2012 the deep pads
// deflate with age; Wan et al. 2013/2014, Gosain et al. 2005 the nasolabial and superficial midface fat thicken and descend; Darcy et al.
// 2008 the lower orbital fat protrudes; Reece et al. 2008 the jowl): thickness at 30 years and BMI 24 by sex, a fraction a decade (gain or
// deflation), DESCENT (mm a decade from 30), a fraction a BMI unit. What changed from FACE6: each compartment now sits on OUR anatomy.
//  - DEEP FAT as VOLUMES on the bone, under the muscles: ROOF (under the orbicularis over the upper lateral rim), SOOF (under it over the
//    lower rim and the zygoma), the deep medial cheek fat (on the maxilla, under the levators), the BUCCAL FAT PAD (between the buccinator
//    and the masseter's anterior border), the ORBITAL FAT (in the orbit round the globe, behind the septum; it bulges past the lower
//    septum with age).
//  - SUPERFICIAL FAT as a THICKNESS FIELD over the muscles and deep fat (the subcutaneous layer: the skin's underside is the inner layers
//    offset by it): forehead, temporal, infraorbital, medial / middle / lateral cheek, nasolabial, jowl, mental, submental, lips, nose,
//    each a smooth bump on our landmarks, zero at its RETAINING LIGAMENTS (tear trough and palpebromalar (the orbicularis retaining
//    ligament), the nasolabial line, the mandibular ligament): the grooves come out of the anatomy, deepening as the fat descends and the
//    skin slackens (FACE6's tether and roll). The table's depth at the forensic sites is then held BY CONSTRUCTION (head/index.js: a
//    residual field over the sites, reported as what the compartments alone miss).
import * as D from '../layer/sdf.js';
import { sampleField, redistance, mapField } from '../layer/grid.js';
import { v3, clamp, lerp, sstep, LBL, onBone, hitBone, shell, blob, capw, polyClosest, f1, f2, r1 } from './common.js';
export const FAT_VERSION = 5;   // (lane it24) THE MIDDLE CHEEK REACHES BACK over the masseter's anterior part to the parotid's anterior border (Rohrich and Pessa's compartments adjoin: no gap between the middle and the lateral cheek at the mouth's height). (4, orchestrator 16 Oct) the JOWL on the mandible's body from the pre-jowl to the masseter's anterior border, above the border, and the MIDDLE CHEEK down to it (the lower face's T-Table sites had no compartment over them). (was 3: (it12) the temporal fat pads under the deep temporal fascia (a closing of the bone and the temporalis). (was 2: (it6) the buccal fat pad's buccal extension by its literature volume
// { T: { f, m } mm at 30 y / BMI 24, age (fraction a decade from 30), descent (mm a decade), bmi (fraction a BMI unit), tether, src }
export const FAT = {
  // deep (volumes)
  roof: { deep: 1, T: { f: 2.0, m: 2.2 }, age: -0.08, descent: 0.6, bmi: 0.03, src: 'retro-orbicularis oculi fat: deflates and descends (FACE6)' },
  soof: { deep: 1, T: { f: 2.6, m: 2.2 }, age: -0.15, descent: 0.4, bmi: 0.03, src: 'sub-orbicularis oculi fat: deflates (Gierloff 2012)' },
  dmcf: { deep: 1, T: { f: 5.0, m: 4.2 }, age: -0.15, descent: 0.6, bmi: 0.035, src: 'deep medial cheek fat (Rohrich, Pessa and Ristow 2008; Gierloff 2012)' },
  buccalPad: { deep: 1, T: { f: 5.5, m: 5.0 }, age: -0.05, descent: 1.2, bmi: 0.07, src: 'buccal fat pad, buccal extension: descends; the most BMI-sensitive' },
  temporalPad: { deep: 1, T: { f: 1, m: 1 }, age: -0.06, descent: 0, bmi: 0.03, src: 'superficial (interfascial) and deep temporal fat pads under the taut deep temporal fascia: their FILL of the space between the temporalis and the fascia (1 at 30 / BMI 24); the age and BMI terms are the superficial temporal fat\'s (as recalled)' },
  orbital: { deep: 1, T: { f: 0, m: 0 }, bulge: 0.45, age: 0, descent: 0, bmi: 0, src: 'orbital fat behind the septum; the lower fat protrudes with age (Darcy 2008)' },
  // superficial (thickness fields)
  forehead: { T: { f: 1.6, m: 1.4 }, age: -0.05, descent: 0.4, bmi: 0.02, src: 'forehead central and middle fat (FACE6)' },
  temporal: { T: { f: 2.0, m: 1.8 }, age: -0.06, descent: 0.3, bmi: 0.03, src: 'superficial temporal fat, as recalled' },
  infraorbital: { T: { f: 0.9, m: 0.8 }, age: -0.06, descent: 0.4, bmi: 0.02, tether: ['orl'], src: 'infraorbital superficial fat (thin)' },
  medialCheek: { T: { f: 3.2, m: 2.8 }, age: 0, descent: 1.4, bmi: 0.04, tether: ['tear'], src: 'superficial medial cheek (Rohrich and Pessa 2007)' },
  middleCheek: { T: { f: 3.4, m: 3.0 }, age: -0.03, descent: 1.0, bmi: 0.045, tether: ['pmal'], src: 'middle cheek fat' },
  lateralCheek: { T: { f: 2.4, m: 2.2 }, age: 0, descent: 0.6, bmi: 0.04, src: 'lateral temporal-cheek fat (FACE6)' },
  nasolabial: { T: { f: 3.2, m: 3.0 }, age: 0.15, descent: 1.2, bmi: 0.04, tether: ['nl'], src: 'nasolabial compartment: thickens and descends (Gosain 2005; Wan 2014)' },
  jowl: { T: { f: 1.6, m: 1.6 }, age: 0.22, descent: 1.6, bmi: 0.07, tether: ['mar'], src: 'jowl fat: grows and falls to the mandibular ligament (Reece 2008; Wan 2014)' },
  mental: { T: { f: 2.0, m: 2.2 }, age: 0.02, descent: 0.3, bmi: 0.04, src: 'mental fat (FACE6)' },
  submental: { T: { f: 2.6, m: 2.2 }, age: 0.08, descent: 0.8, bmi: 0.1, src: 'submental fat, as recalled (the double chin with BMI)' },
  lips: { T: { f: 1.0, m: 1.0 }, age: -0.04, descent: 0.2, bmi: 0.01, src: 'the lips\' subcutaneous layer, as recalled' },
  nose: { T: { f: 0.6, m: 0.7 }, age: 0, descent: 0, bmi: 0.01, src: 'nasal dorsum fibrofatty layer, as recalled' },
};
export const BASE_SUP = 2.0;     // the subcutaneous layer elsewhere (scalp under the hair, the neck's sides): mm
export function fatT(key, st) { const L = FAT[key], sex = st.sex === 'm' ? 'm' : 'f', dec = Math.max(0, (st.age ?? 35) - 30) / 10, young = Math.max(0, 30 - (st.age ?? 35)) / 10;
  const ageK = 1 + (L.age || 0) * dec - (L.age < 0 ? 0.5 * L.age * young : 0), bmiK = 1 + (L.bmi || 0) * ((st.bmi ?? 24) - 24);
  return Math.max(0, L.T[sex] * Math.max(0.2, ageK) * Math.max(0.3, bmiK) + (L.bulge || 0) * dec); }
export const descentOf = (key, st) => (FAT[key].descent || 0) * Math.max(0, (st.age ?? 35) - 30) / 10;
export const laxity = age => clamp(((age ?? 35) - 18) / 42, 0.12, 1);     // FACE6's: how much of a tether shows through the skin

// THE RETAINING LIGAMENTS on our anatomy (polylines lifted ~4.5 mm off the bone: in the fat they hold): { key: { pts, w } }
export function ligaments(B, G, soft) {
  const g = B.geo, sto = soft.sto, lf = (p, lift = 4.5) => onBone(G, p, lift), surf = (x, y) => { const h = hitBone(G, [x, y, g.zN + 60], [0, 0, -1], 200); return h ? h : [x, y, g.zN - 20]; };
  const al = soft.al, ch = soft.ch;
  const L = {
    tear: { pts: [lf(surf(g.xD + 2, g.yIn + 2)), lf(surf(g.xOc - 4, g.yIn - 3)), lf(surf(g.xOc + 3, g.yIn - 4.5))], w: 2.8 },
    pmal: { pts: [lf(surf(g.xOc + 3, g.yIn - 4.5)), lf(surf(g.xEc - 3, g.yIn - 3)), lf(surf(g.xEc + 3, g.yIn + 3))], w: 3.0 },
    orl: { pts: [lf(surf(g.xD + 4, g.yIn + 1)), lf(surf(g.xOc, g.yIn - 3)), lf(surf(g.xEc - 2, g.yIn - 1))], w: 2.6 },
    nl: { pts: [[al[0] + 2.5, al[1] - 1, al[2] - 7], [ch[0] + 4.5, sto[1] + 4, ch[2] - 4], [ch[0] + 6, sto[1] - 9, ch[2] - 6]], w: 3.2 },
    mar: { pts: [[ch[0] + 1.5, sto[1] - 4, ch[2] - 4.5], [ch[0] + 3, sto[1] - 15, ch[2] - 6], lf(surf(ch[0] + 4, g.yMe + 9), 3.5)], w: 3.0 },
    zyg: { pts: [lf(surf(g.Mal[0] + 3, g.Mal[1] - 11)), lf(surf(g.Mal[0] + 6, g.Mal[1] - 9))], w: 2.6, tetherOnly: true },
  };
  return L;
}

// buildFat(B, G, soft, st, muscles) -> { deep: [prims], sup: { fields: [{ key, t(p) }], total(p) }, lig, report }
export function buildFat(B, G, soft, st, muscles, opts = {}) {
  const g = B.geo, lm = B.lm, K = B.K, deep = [], fields = [], rep = {}, sexM = st.sex === 'm';
  const T = k => fatT(k, st), dsc = k => descentOf(k, st);
  const addDeep = (key, prim) => { deep.push({ ...prim, label: LBL.deepFat, name: key }); deep.push(D.mirrorX(prim, { label: LBL.deepFat, name: key + '_R' })); rep[key] = { T: f2(T(key)), descent: f1(dsc(key)) }; };
  const e = (x, y) => Math.hypot((x - g.xOc) / (g.hw + 1.5), (y - g.yOc) / (g.hh + 1.5));
  // ROOF: on the bone over the upper lateral two-thirds of the supraorbital margin, under the orbicularis' orbital part
  { const t = T('roof'), d = dsc('roof'), mask = p => Math.max((e(p[0], p[1] + d) - 1.5) * g.hw, (0.98 - e(p[0], p[1] + d)) * g.hw, (g.yOc + 0.35 * g.hh) - (p[1] + d), (g.xOc - 7) - p[0], (g.zLatH - 10) - p[2]);
    addDeep('roof', shell(G, p => t * sstep(1.5, 1.25, e(p[0], p[1] + d)), 0.2, mask, [g.xOc - 10, g.yOc, g.zLatH - 14, g.xEc + 12, g.ySupM + 12, g.zSup + 8], { name: 'roof' })); }
  // SOOF: on the bone over the lower rim and the zygoma's upper body, under the orbicularis (medial and lateral parts as one)
  { const t = T('soof'), d = dsc('soof'), mask = p => Math.max((e(p[0], p[1] + d) - 1.55) * g.hw, (0.98 - e(p[0], p[1] + d)) * g.hw, (p[1] + d) - (g.yOc - 0.3 * g.hh), (g.xOc - 9) - p[0], (g.zLatH - 12) - p[2]);
    addDeep('soof', shell(G, p => t * sstep(1.55, 1.3, e(p[0], p[1] + d)), 0.2, mask, [g.xOc - 12, g.yIn - 20, g.zLatH - 16, g.xEc + 12, g.yOc, g.zInf + 10], { name: 'soof' })); }
  // DEEP MEDIAL CHEEK FAT: on the maxilla beside the nose, under the levators (its deflation makes the midface V with age)
  { const t = T('dmcf'), d = dsc('dmcf'), c = [(g.xD + g.xOc) / 2 + 3, (g.yANS + g.yIn) / 2 - 1 - d, 0], R = D.regionPoly([[g.xD + 5, g.yIn - 4 - d], [g.xOc + 5, g.yIn - 5 - d], [g.xOc + 8, g.yANS + 2 - d], [g.xD + 7, g.yANS + 1 - d]]);
    const mask = p => Math.max(R(p[0], p[1]), g.zANS - 30 - p[2]);
    addDeep('dmcf', shell(G, p => t * sstep(0, 6, -R(p[0], p[1])), 0.3, mask, [g.xD + 2, g.yANS - 6, g.zANS - 34, g.xOc + 12, g.yIn, g.zANS + 10], { name: 'dmcf' })); rep.dmcf.c = r1(c); }
  // BUCCAL FAT PAD (buccal extension): an ellipsoid between the buccinator and the masseter's anterior border, below the zygoma
  { const s = T('buccalPad') / FAT.buccalPad.T[sexM ? 'm' : 'f'], d = dsc('buccalPad'), up6 = B.arch.upT[5], c0 = v3.add(up6.p, v3.mul(up6.n, 1.6 + 3.5 + 6.5)), c = [c0[0] + 2, soft.sto[1] + 6 - d, c0[2] - 3];
    const nB = v3.norm([up6.n[0], 0.15, up6.n[2]]), Bas = D.basis(nB, [0, 1, 0]);
    // basis: U ~ up, V along the arch (AP), W outward. (it6) Its VOLUME from the anatomy literature, not from a depth: the whole pad ~9.6 mL
    // (Stuzin et al. 1990: 7.8-11.2 mL), the buccal extension (the cheek's part, between the buccinator and the masseter) taken as ~a third
    // of it (Zhang et al. 2002's lobes; as recalled): ~3.0 mL at 30 / BMI 24 (it3-it5 had 1.7 mL: radii 7 / 9 / 6.5). Radii 8.4 / 10.8 / 7.8
    addDeep('buccalPad', D.ellipsoid(c, [8.4 * Math.cbrt(s), 10.8 * Math.cbrt(s), 7.8 * s].map(f2), { basis: Bas, name: 'buccalPad' })); rep.buccalPad.c = r1(c); rep.buccalPad.mL = f2(4 / 3 * Math.PI * 8.4 * 10.8 * 7.8 * Math.cbrt(s) ** 2 * s / 1000); }
  // ORBITAL FAT: the orbit's cavity round the globe, behind the septum (the plane of the margins, 2 mm behind it), bulging past the lower
  // septum with age (Darcy 2008)
  { const cav = B.orbit.cavity, gl = B.globe.L, bul = T('orbital');
    const pl = (() => { const P1 = [g.xOc, g.yOc + g.hh, g.zSup], P2 = [g.xOc, g.yOc - g.hh, g.zInf], P3 = [g.xEc, g.yOc, g.zLatH], n = v3.norm(v3.cross(v3.sub(P2, P1), v3.sub(P3, P1))), N = n[2] < 0 ? v3.mul(n, -1) : n; return { P1, N }; })();
    const septum = p => v3.dot(v3.sub(p, pl.P1), pl.N) + 2 - bul * sstep(g.yOc - 0.1 * g.hh, g.yOc - 0.6 * g.hh, p[1]) * sstep(1.05, 0.6, e(p[0], p[1]));
    const of = D.custom((x, y, z) => D.smax(D.smax(cav.d(x, y, z), -(Math.hypot(x - gl.c[0], y - gl.c[1], z - gl.c[2]) - gl.r - 0.4), 0.6), septum([x, y, z]), 1), cav.aabb, { name: 'orbital fat' });
    addDeep('orbital', of); }
  // (it12, FAT_VERSION 3) THE TEMPORAL FAT PADS UNDER THE DEEP TEMPORAL FASCIA. Until it11 the temple was the temporalis' shell (5-6 mm
  // on the bone, following the fossa's concavity) under 2 mm of subcutaneous fat: the skin dipped into the fossa behind the lateral orbital
  // rim in an S (the it12 axial sections at FH + 10 / 25 / 40 mm: the cast's skin 10-15 mm outside it) and the bands saw the temple's
  // mid relief at 0.75-1.0 mm against the scans' 0.57-0.60. In the anatomy the fossa is NOT lined but FILLED: the deep temporal fascia
  // runs from the superior temporal line (and the lateral orbital rim's posterior border) to the zygomatic arch, taut (it braces the arch
  // against the masseter's pull), and the space between it and the temporalis holds the SUPERFICIAL (interfascial) temporal fat pad,
  // between its two layers above the arch, and the DEEP temporal fat pad (the buccal pad's temporal extension) under them in front of the
  // muscle (anatomy texts and the temporal-hollowing literature, as recalled: no volumetry transcribed). The young temple is flat to
  // slightly convex; it hollows with age as these pads (and the muscle) deflate.
  // Construction: the TAUT SHEET is the morphological closing of the bone and the temporalis by a ball of radius R (a sheet under tension
  // spanning the fossa cannot follow a concavity narrower than its own radius of curvature); R is the fossa's own height (the superior
  // temporal line to the arch's top: the sheet's span), so the sheet lies nearly flat across the span and still wraps the cranium's
  // convexity. The pad is what the closing adds inside the fossa (the fossa's outline + 4 mm, above the arch); its FILL (the pad's outer
  // surface between the muscle (0) and the sheet (1)) by age and BMI with the temporal fat's terms (FAT.temporalPad). (c6 it16: the
  // o.temporalPad false A/B DELETED.)
  { const tm = muscles?.list?.find(r => r.key === 'temporalis')?.prim, fill = clamp(T('temporalPad'), 0, 1.15), yTop = g.yN + 46, yArch = -6.8 + g.aH + 1, R = Math.max(25, yTop - yArch), h = 1.5;
    const box = [K.WFB / 2 - 20, yArch - 10, -48, K.ZYB / 2 + R + 10, yTop + 14, g.zFMA + 14];
    const content = { d: (x, y, z) => { const b = G.value(x, y, z); return tm ? Math.min(b, tm.d(x, y, z)) : b; } };
    const A = redistance(sampleField(content, box, h, { band: 3 }), { passes: 2 }), Dl = redistance(mapField(A, null, a => a - R), { passes: 2 }), Cl = mapField(Dl, null, a => a + R);
    const mask = (x, y, z) => Math.max(g.fossaRegion(y, z) - 4, yArch - y, (K.WFB / 2 - 16) - x);
    const pad = D.custom((x, y, z) => { if (x < box[0] || x > box[3] || y < box[1] || y > box[4] || z < box[2] || z > box[5]) return 30; const a = A.value(x, y, z), c = Cl.value(x, y, z); return D.smax(lerp(a, c, fill), mask(x, y, z), 2); }, box, { name: 'temporalPad' });
    let n = 0; for (let z = box[2]; z <= box[5]; z += 1.5) for (let y = box[1]; y <= box[4]; y += 1.5) for (let x = box[0]; x <= box[3]; x += 1.5) if (pad.d(x, y, z) < 0 && content.d(x, y, z) >= 0) n++;
    addDeep('temporalPad', pad); rep.temporalPad = { fill: f2(fill), R: f1(R), mL: f1(n * 1.5 ** 3 / 1000), src: FAT.temporalPad.src }; }
  // ---- the SUPERFICIAL compartments: bumps on our landmarks, descended by age, thinned at their ligaments
  const lig0 = ligaments(B, G, soft), lax = laxity(st.age), sto = soft.sto, Mod = soft.mod, ch = soft.ch, al = soft.al;
  // (the superficial layer is read at the bone's foot points: head/index.js) the ligaments' lines and the compartments' centres on the bone
  const ob = p => onBone(G, p, 0), lig = Object.fromEntries(Object.entries(lig0).map(([k, v]) => [k, { ...v, pts: v.pts.map(ob) }]));
  // (it7) each shape also carries its NORMALISED DISTANCE e(p) (1 at its radii; the fill's partition of the face into compartments: every
  // point of the face belongs to the compartment it lies deepest in, as in Rohrich and Pessa's map, with no gaps between the blobs)
  const blobB = (c, r) => { const C = ob(c), w = blob(C, r); w.desc = { kind: 'blob', c, r }; w.e = p => Math.hypot((p[0] - C[0]) / r[0], (p[1] - C[1]) / r[1], (p[2] - C[2]) / r[2]); return w; };
  const capB = (a, b, r) => { const A = ob(a), Bq = ob(b), w = capw(A, Bq, r); w.desc = { kind: 'cap', a, b, r }; const ab = v3.sub(Bq, A), l2 = v3.dot(ab, ab) || 1; w.e = p => { const t = clamp(v3.dot(v3.sub(p, A), ab) / l2, 0, 1); return v3.dist(p, v3.add(A, v3.mul(ab, t))) / r; }; return w; };
  const zAt = (x, y) => { const h = hitBone(G, [x, y, g.zN + 60], [0, 0, -1], 200); return h ? h[2] : g.zN - 20; };
  // (FAT_VERSION 4, orchestrator 16 Oct) THE LOWER FACE'S SUPERFICIAL FAT BY ITS ANATOMY. FACE6's jowl was
  // a 13 mm capsule hanging under the modiolus and the middle cheek stopped ~19 mm under the malar point, so no superficial compartment
  // lay over the mandible's body, its border, or the lateral face between the occlusal plane and the jaw: the T-Table sites there (mmb,
  // mm, buc, iC) had no compartment under them (solveAmounts skipped them: sm < 0.2), the jaw line carried the 1.2 mm base layer (mmb 2.3
  // mm against the table's 10, mm 11 against 21 on L08) and the lower face came out 10-17 mm a side narrower than the HSRD-100 heads at
  // the lower lip and the jaw. The anatomy: the JOWL compartment lies on the mandible's body from below the commissure (the pre-jowl, behind
  // the depressor anguli oris) back to the masseter's anterior border, held above the border by the mandibular septum (Reece, Pessa and
  // Rohrich 2008, Plast Reconstr Surg 121:1414); the MIDDLE CHEEK compartment lies between the medial cheek and the lateral temporal-cheek
  // fat and reaches down to the jowl, the compartments meeting with no gap (Rohrich and Pessa 2007, Plast Reconstr Surg 119:2219). Built on
  // our mandible: its lower border sampled from B.parts.mandible (as the masseter's insertion is, head/muscles.js), the masseter's anterior
  // border at the antegonial notch (Go + 30 mm forward, muscles.js). Their AMOUNTS stay the T-Table's (head/index.js solveAmounts).
  // Probed in node on L08 L12 L21 (labs/human8/anat8_scratch/it23/probe23.mjs, tags orchB / orchC; the final skin against the HSRD-100
  // heads on the same hm08 vertices): mm 11.4 -> 21.9 mm (table 20.7) on L08, the jaw's half-width at 95 mm under the eye line 25 -> 37
  // (scans 41), sites within 2 mm of the table L12 25 -> 28, L21 18 -> 21. FACE6's two shapes: git history only.
  const mand = B.parts?.mandible, Go = lm.Go_L;
  const borderY = z => { if (!mand) return null; for (let y = Go[1] - 45; y <= Go[1] + 15; y += 0.5) for (let x = 4; x <= K.ZYB / 2 + 6; x += 0.75) if (mand.d(x, y, z) < 0) return y; return null; };
  let jowlLF = null, midLF = null;
  { const zFront = ch[2] - 8, zBack = Go[2] + 32, bF = borderY(zFront) ?? (g.yMe + 6), bB = borderY(zBack) ?? (Go[1] + 4);
    const yF = bF + 0.42 * (ch[1] - bF), yB = bB + 0.38 * (sto[1] - bB), xF = ch[0] + 2, xB = Math.max(ch[0] + 14, K.goGo / 2 - 4);
    jowlLF = capB([xF, yF, zFront], [xB, yB, zBack], 10.5);
    const midA = blobB([g.Mal[0] - 6, 0.5 * (g.Mal[1] - 8) + 0.5 * (sto[1] + 6), g.Mal[2]], [14, Math.max(11, 0.5 * ((g.Mal[1] - 8) - (sto[1] + 6)) + 9), 15]);
    // (lane it24, FAT_VERSION 5) THE MIDDLE CHEEK REACHES BACK TO THE LATERAL CHEEK: Rohrich and Pessa's compartments adjoin with no gap;
    // the middle cheek lies anterior and superficial to the parotid, over the masseter's anterior part, the lateral temporal-cheek fat over
    // the gland (Rohrich and Pessa 2007, Plast Reconstr Surg 119:2219). The blob round the malar bone's front (z radius 15) stopped ~17 mm
    // behind the cornea, the lateral cheek's began ~32 mm behind it: over the masseter's anterior part at the mouth's height (|x| 46-54)
    // no superficial compartment lay at all (probe24 on L12, the cheek sections at dy -52 / -60 / -68). So: the blob united with a capsule
    // from its centre back to the parotid's anterior border at the mouth's height (head/index.js's superficial lobe: AP radius 16 about the
    // ramus' middle), radius the blob's 14. Its AMOUNT stays the T-Table's (solveAmounts). Probed on L12 (probe24, the masseter sheet on,
    // the full chain): the half-width at 60 mm under the eye line 46.6 -> 47.1 (z > -20) and 50.9 -> 51.9 (z > -35) against the HSRD-100
    // women's 53.7 / 58.9, at 80 mm 45.8 -> 46.5 (52.6); the supra-M2 site 21.7 -> 23.3 mm (the T-Table 23.2); the middle cheek's amount
    // k 1.28 -> 1.19. Still short there: the masseter's own lateral extent at the occlusal level (its surface at |x| 50-54 lies 34-55 mm
    // behind the cornea; NEXT).
    { const zPar = 0.5 * (lm.Co_L[2] + Go[2]) + 16, midB = capB(midA.desc.c, [K.goGo / 2, sto[1] + 4, zPar + 4], 14);
      midLF = p => Math.max(midA(p), midB(p)); midLF.e = p => Math.min(midA.e(p), midB.e(p)); midLF.desc = { kind: 'blob+cap', blob: midA.desc, cap: midB.desc }; }
    rep.lowerFace = { jowl: { front: [f1(xF), f1(yF), f1(zFront)], back: [f1(xB), f1(yB), f1(zBack)], borderF: f1(bF), borderB: f1(bB), r: 10.5 }, middleCheek: midLF.desc }; }
  const shapes = {
    forehead: blobB([0, g.yN + 36, zAt(0, g.yN + 36)], [44, 30, 30]),
    temporal: blobB([K.WFB / 2 + 8, g.yN + 14, g.zFMA - 32], [16, 30, 28]),
    infraorbital: blobB([g.xOc + 1, g.yIn - 3, zAt(g.xOc, g.yIn - 3)], [14, 6.5, 10]),
    medialCheek: blobB([g.xOc - 4, g.yIn - 15, zAt(g.xOc - 4, g.yIn - 15)], [12, 10, 14]),
    middleCheek: midLF,
    lateralCheek: blobB([K.goGo / 2 + 12, sto[1] + 6, lm.Go_L[2] + 20], [12, 22, 18]),
    nasolabial: capB([al[0] + 6, al[1] - 2, al[2] - 4], [ch[0] + 8, sto[1] - 2, ch[2] - 4], 6.5),
    jowl: jowlLF,
    mental: blobB([0, lm.Pog[1] - 2, lm.Pog[2] + 9], [13, 10, 10]),
    submental: blobB([0, g.yMe - 12, lm.Me[2] - 18], [24, 13, 24]),
    lips: blobB([0, sto[1], soft.lipFront(0, sto[1]) - 5], [Mod[0] + 4, 14, 12]),
    nose: blobB([0, g.yN - 18, g.zN + 10], [12, 28, 16]),
  };
  for (const [key, sh] of Object.entries(shapes)) { const t0 = T(key), d = dsc(key), L = FAT[key], cc = [0, 0, 0];
    // (it7) raw(p): the compartment's thickness without its ligaments' hold (the FAT's amount: the fill's volume and the ligament's rest
    // length); e(p): its normalised distance, descended with the fat
    const raw = p => { const q = d ? [p[0], p[1] + d, p[2]] : p; return t0 * sh(q); }, e = p => sh.e(d ? [p[0], p[1] + d, p[2]] : p);
    const t = p => { const q = d ? [p[0], p[1] + d, p[2]] : p; let w = sh(q); if (w < 1e-4) return 0; let v = t0 * w;
      if (L.tether) for (const k of L.tether) { const lg = lig[k]; if (!lg) continue; const { d: dl } = polyClosest(p, lg.pts); v *= 1 - (0.35 + 0.65 * lax) * Math.exp(-0.5 * (dl / lg.w) ** 2); }
      return v; };
    const mir = p => (p[0] >= 0 ? p : [-p[0], p[1], p[2]]);
    fields.push({ key, t, tBoth: p => t(mir(p)), raw, rawBoth: p => raw(mir(p)), e, eBoth: p => e(mir(p)), t0, descent: d, desc: sh.desc }); rep[key] = { T: f2(t0), descent: f1(d) }; }
  const symmetric = new Set(['forehead', 'mental', 'submental', 'lips', 'nose']);
  const total = p => { let s = 0; for (const f of fields) s += symmetric.has(f.key) ? f.t(p) : f.tBoth(p); return s; };
  const totalRaw = p => { let s = 0; for (const f of fields) s += symmetric.has(f.key) ? f.raw(p) : f.rawBoth(p); return s; };
  // the compartment a point (on the bone) belongs to: the one whose (descended) shape it lies deepest in; null beyond 2 radii of all
  const owner = p => { let best = null, be = 2; for (const f of fields) { const e = symmetric.has(f.key) ? f.e(p) : f.eBoth(p); if (e < be) { be = e; best = f.key; } } return best; };
  return { deep, fields, total, totalRaw, owner, symmetric, lig, lig0, report: rep, version: FAT_VERSION };
}
