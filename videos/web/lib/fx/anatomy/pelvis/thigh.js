// ANATOMY / PELVIS / THIGH (ANAT8-PELVIS, lane iteration 13, 15 Oct 2026; NOTES: review/studio_human_c8/after/anat8_pelvis/NOTES.md, iteration 13):
// THE THIGH'S MUSCLES FROM ORIGIN TO INSERTION, PACKED IN THEIR FASCIA. Replaces the atlas lookup (THIGH_ATLAS: one adult male's section centroids
// carried onto every person; git history only) that the checker (CHECK.md 15 Oct) and the orchestrator named as the cause of the lumpy thighs:
// round spindles placed at remembered centroids leave grooves between them and bulge where they overlap, and a fascia that follows them shows it.
//
// THE MODEL (no position table, no shape target; every input is a bony attachment of the person's own skeleton or a tissue property):
//  (1) each muscle is a LINE OF ACTION from its ORIGIN to its INSERTION on the person's own bones (buildSkeleton: the pelvis' frame q(), the ASIS,
//      AIIS, the pubic body and rami, the ischial tuberosity; the femur's shaft, its trochanters, its linea aspera (the shaft's posterior surface),
//      its condyles; the patella; the tibia's tuberosity and the pes anserinus beside it; the fibular head), routed by WRAP points that are
//      themselves bony: the vasti lie on the shaft's faces they arise from, the hamstrings pass behind the condyles, the adductors run to their
//      insertion lines on the linea aspera (standard anatomy: Gray's / Standring 2016);
//  (2) each muscle's VOLUME is the input (Handsfield et al 2014 x the person's stature x fat-free mass x muscularity: pelvis/muscles.js V()), spread
//      along its own line by its ARCHITECTURE: where the fleshy belly lies between the tendons and where it is fullest (BELLY below: the tendon
//      fractions as anatomy describes them, recalled, to verify against Ward et al 2009 Clin Orthop 467:1074); its section across the thigh is that
//      area over the cosine of the line's slope;
//  (3) at every level of the thigh (a 1 cm stack of sections across the person's mechanical axis, hip centre -> knee) the muscles are PACKED: each
//      grows from where its line crosses the section, pushed out of the bone and of the muscles deeper than it, until it holds its area (an
//      additively weighted growth whose weights are raised until every muscle has its area: incompressible bellies filling their space); the
//      superficial straps (sartorius, gracilis) are laid on the packed compartment's surface where their lines cross it;
//  (4) THE FASCIA LATA is a taut stocking: under circumferential tension it rests on the outermost tissue of each section and cannot dip between the
//      bellies (the packed cluster's convex hull), and the bellies, incompressible, fill it: it is drawn in evenly until it holds exactly the bone,
//      the bellies' areas and an INTERMUSCULAR share (septa, the femoral and adductor canals' vessels and nerves, intermuscular fat: its own label),
//      and the bellies then PARTITION it (the weighted growth again, inside the fascia: polygons pressed against one another, not discs);
//  (5) each muscle (and the intermuscular tissue) becomes a FIELD part (skeleton/sdf.js part.fn: a signed distance interpolated between its sections),
//      so the deep layer the fat is laid on (pelvis/fat.js), the solver's sliding interface and the cutaway's meshes (meshPart) all read the packed
//      thigh. Above the stack each muscle continues to its origin as a tube on its line (a tendon where its belly has not begun).
//   import { buildThigh } from '.../anatomy/pelvis/thigh.js'
//   const T = buildThigh(B, K, M, { obstacles: parts, V: name -> cm3, rec })  -> { parts, sides: { L, R: { sections, frame } }, info }
import { sdParts, sdPart, part as part0, tube } from '../skeleton/sdf.js';
import { mad, sub, add, mul, nrm, dot, len, lerp, clamp, crs } from '../muscle/core.js';
import { perineumOf } from './fat.js';
const CM = 0.01;
export const PELVIS_THIGH_VERSION = 5;   // (lane iteration 19) THE KNEE BY ITS ANATOMY: the thigh's stack packed down to the knee's joint line and the crus' from just under it (no flat end 4.7 cm above the joint line), and the knee's own fat bodies (the suprapatellar and prefemoral pads, the popliteal fossa's fat, the infrapatellar pad) packed as volumes on the bone; // (lane iteration 18) THE WHOLE LOWER LIMB: the crural muscles from origin to insertion packed in the crural fascia below the knee (crusLines, the 'crus' stack), the patellar ligament; // (lane iteration 17) the medial bound above the crotch is the perineal side of the genitocrural septum (fat.js perineumOf), not a box; (lane iteration 15) the medial bound is the perineum above the crotch and the contact face below it, not a 3.8 cm strip down the whole thigh
export const INTERMUSCULAR = 0.05;   // the intermuscular share of the fascia's content beside the bellies (septa, the femoral and adductor canals' vessels and nerves, intermuscular fat): ~5 % of the muscle area (an assumption, to verify against MRI thigh sections, e.g. Gallagher et al 2005 IMAT)
const H_PX = 0.0025, DS = 0.01, Rgrow = 8, FASCIA_ROUND = 0.008;   // FASCIA_ROUND: the hull's corners rounded over ~1 cm (the membrane's curvature under its contents' pressure; an assumption)    // the section grid (2.5 mm) and the stack's spacing (1 cm)
// BELLY: [fleshy from, fullest at, fleshy to] as fractions of the line from origin to insertion, and the profile's exponent (1 fusiform, < 1 a strap's
// even width, the fan's peak toward its insertion line); DEPTH: the packing order (0 on the bone, 1 on the deep layer, 2 the superficial straps)
// (standard anatomy, recalled, to verify): rectus femoris' proximal tendons ~1/6 of its length, the quadriceps tendon ~1/8; vastus medialis' bulk
// distal (the teardrop); semitendinosus' long distal tendon (its belly in the upper 2/3); semimembranosus' long proximal membranous tendon (its belly
// in the lower half); gracilis a strap with a long distal tendon; sartorius a strap from end to end; the adductors fleshy to their insertion lines.
export const THIGH_MUSCLES = {
  vastusIntermedius: { belly: [0.04, 0.42, 0.86, 1.0], depth: 0 }, vastusLateralis: { belly: [0.0, 0.42, 0.88, 1.0], depth: 0 },
  vastusMedialis: { belly: [0.12, 0.74, 0.97, 1.0], depth: 0 }, bicepsFemorisShort: { belly: [0.0, 0.45, 0.88, 1.0], depth: 0 },
  adductorBrevis: { belly: [0.1, 0.55, 1.0, 1.0], depth: 0 }, adductorMagnus: { belly: [0.06, 0.55, 1.0, 1.0], depth: 0 }, adductorMagnusIschial: { belly: [0.06, 0.42, 0.8, 1.0], depth: 0 },
  pectineus: { belly: [0.05, 0.5, 1.0, 1.0], depth: 0 },
  adductorLongus: { belly: [0.12, 0.6, 1.0, 1.0], depth: 1 }, semimembranosus: { belly: [0.34, 0.66, 0.92, 1.0], depth: 1 }, bicepsFemorisLong: { belly: [0.12, 0.5, 0.86, 1.0], depth: 1 },
  semitendinosus: { belly: [0.12, 0.36, 0.64, 1.0], depth: 1 }, rectusFemoris: { belly: [0.14, 0.45, 0.88, 1.0], depth: 1 },
  sartorius: { belly: [0.03, 0.45, 0.92, 0.45], depth: 2 }, gracilis: { belly: [0.04, 0.3, 0.68, 0.6], depth: 2 },
  // (v5, lane iteration 19) THE KNEE'S FAT BODIES above the joint line (standard anatomy, Standring 2016): the suprapatellar (quadriceps) and prefemoral
  // fat pads on the femur's anterior surface above the trochlea, under the quadriceps tendon, a lens fullest just above the patella's base; the fat of
  // the POPLITEAL FOSSA on the femur's popliteal surface and the joint's posterior capsule, between the hamstrings where they part, a wedge widening down
  // to the joint line (its vessels and nerves in it). They lie on the bone (depth 0): the hamstrings and the vasti are packed round them. fat: not muscle.
  suprapatellarFat: { belly: [0.0, 0.62, 1.0, 1.0], depth: 0, fat: true }, poplitealFat: { belly: [0.0, 0.72, 1.0, 1.0], depth: 0, fat: true } };
// (v4, lane iteration 18) THE LEG BELOW THE KNEE: the crural muscles from origin to insertion on the person's own tibia, fibula and foot, packed in the
// crural fascia exactly as the thigh's in the fascia lata (one tissue system from the hip to the ankle: no region hands back inside the leg). Their
// attachments and courses: standard anatomy (Standring 2016, Gray's Anatomy; recalled); the bellies' extents between their tendons (recalled, to
// verify against Ward et al 2009): gastrocnemius' heads fleshy over the upper half of the leg, the medial lower than the lateral; soleus fleshy to a hand
// above the heel; the deep flexors' bellies in the middle and lower thirds; the anterior compartment's bellies in the upper two thirds; fibularis
// brevis below longus. DEPTH (the packing order, fractional): the deep posterior and extensor hallucis on the interosseous membrane (0), soleus and
// the anterior and lateral compartments on them (0.5), gastrocnemius on soleus (1).
export const CRUS_MUSCLES = {
  // fractions of each LINE (origin -> insertion, the tendons' course into the foot included: the leg is ~0.75-0.85 of a crural line), not of the leg:
  // tibialis anterior's belly ends at the leg's lower third (its tendon the last third and the foot), the long extensors' a little lower, extensor
  // hallucis' and the fibularis brevis' lower still; tibialis posterior's and the long flexors' bellies in the middle third, flexor hallucis' the lowest
  // (fleshy nearly to the ankle); soleus fleshy to a few cm above the ankle, fullest at about the leg's middle; gastrocnemius' medial head to the leg's
  // middle, the lateral higher (standard anatomy, recalled; to verify against Ward et al 2009 and MRI CSA profiles, e.g. Fukunaga et al 1992)
  tibialisPosterior: { belly: [0.04, 0.28, 0.52, 1.0], depth: 0 }, flexorDigitorumLongus: { belly: [0.05, 0.3, 0.55, 1.0], depth: 0 },
  flexorHallucisLongus: { belly: [0.05, 0.38, 0.62, 1.0], depth: 0 }, popliteus: { belly: [0.15, 0.6, 1.0, 1.0], depth: 0 }, extensorHallucisLongus: { belly: [0.04, 0.33, 0.58, 1.0], depth: 0 },
  soleus: { belly: [0.0, 0.35, 0.76, 1.0], depth: 0.5 }, tibialisAnterior: { belly: [0.03, 0.28, 0.53, 1.0], depth: 0.5 }, extensorDigitorumLongus: { belly: [0.03, 0.3, 0.58, 1.0], depth: 0.5 },
  fibularisLongus: { belly: [0.02, 0.25, 0.52, 1.0], depth: 0.5 }, fibularisBrevis: { belly: [0.05, 0.4, 0.66, 1.0], depth: 0.5 },
  gastrocnemiusMedialis: { belly: [0.05, 0.25, 0.5, 1.0], depth: 1 }, gastrocnemiusLateralis: { belly: [0.05, 0.22, 0.44, 1.0], depth: 1 },
  // (v5, lane iteration 19) THE INFRAPATELLAR (HOFFA'S) FAT PAD: behind the patellar ligament, from the patella's apex to the tibia's anterior intercondylar
  // area and the tuberosity's top, bulging either side of the ligament in extension (standard anatomy); on the bone (depth 0). fat: not muscle.
  infrapatellarFat: { belly: [0.0, 0.4, 1.0, 1.0], depth: 0, fat: true } };
const SPEC = n => THIGH_MUSCLES[n] || CRUS_MUSCLES[n];
const TENDON_R = 0.004;   // a tendon's radius where a muscle's line has no belly (m; 3-5 mm cords)
const bellyF = (b, x) => { const [a, p, c, e] = b; if (x <= a || x >= c) return 0; const w = x < p ? 0.5 * (x - a) / (p - a) : 0.5 + 0.5 * (x - p) / (c - p); return Math.pow(Math.sin(Math.PI * w), e); };

// ---------------------------------------------------------------- 2D tools on the section grid
// squared Euclidean distance transform (Felzenszwalb and Huttenlocher 2012), of the set f == 0 (f: 0 on the set, 1e20 elsewhere)
function edt1(f, n, d, v, z) { let k = 0; v[0] = 0; z[0] = -1e20; z[1] = 1e20;
  for (let q = 1; q < n; q++) { let s; do { const r = v[k]; s = ((f[q] + q * q) - (f[r] + r * r)) / (2 * q - 2 * r); if (s <= z[k]) k--; else break; } while (k >= 0); k++; v[k] = q; z[k] = s; z[k + 1] = 1e20; }
  k = 0; for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const r = v[k]; d[q] = (q - r) * (q - r) + f[r]; } }
function edt(mask, nx, nz, inside) {   // distance (px) from each pixel to the nearest pixel with mask == inside
  const D = new Float64Array(nx * nz), n = Math.max(nx, nz), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let i = 0; i < nx * nz; i++) D[i] = (mask[i] ? 1 : 0) === (inside ? 1 : 0) ? 0 : 1e20;
  for (let x = 0; x < nx; x++) { for (let y = 0; y < nz; y++) f[y] = D[y * nx + x]; edt1(f, nz, d, v, z); for (let y = 0; y < nz; y++) D[y * nx + x] = d[y]; }
  for (let y = 0; y < nz; y++) { for (let x = 0; x < nx; x++) f[x] = D[y * nx + x]; edt1(f, nx, d, v, z); for (let x = 0; x < nx; x++) D[y * nx + x] = d[x]; }
  for (let i = 0; i < D.length; i++) D[i] = Math.sqrt(D[i]); return D;
}
// a binary pixel set's signed distance (m; < 0 inside), lightly smoothed (a 1-2-1 pass each way: the 2.5 mm staircase must not reach the skin)
function signedField(mask, nx, nz) {
  const dIn = edt(mask, nx, nz, true), dOut = edt(mask, nx, nz, false), S = new Float32Array(nx * nz);
  for (let i = 0; i < S.length; i++) S[i] = (mask[i] ? -(dOut[i] - 0.5) : dIn[i] - 0.5) * H_PX;
  const T = new Float32Array(S.length);
  for (let y = 0; y < nz; y++) for (let x = 0; x < nx; x++) { const i = y * nx + x, a = x > 0 ? S[i - 1] : S[i], b = x < nx - 1 ? S[i + 1] : S[i]; T[i] = 0.25 * a + 0.5 * S[i] + 0.25 * b; }
  for (let y = 0; y < nz; y++) for (let x = 0; x < nx; x++) { const i = y * nx + x, a = y > 0 ? T[i - nx] : T[i], b = y < nz - 1 ? T[i + nx] : T[i]; S[i] = 0.25 * a + 0.5 * T[i] + 0.25 * b; }
  return S;
}
// a binary heap of [cost, pixel, label]
class Heap { constructor() { this.c = []; this.p = []; this.l = []; }
  push(c, p, l) { const C = this.c, P = this.p, L = this.l; let i = C.length; C.push(c); P.push(p); L.push(l); while (i > 0) { const j = (i - 1) >> 1; if (C[j] <= C[i]) break; [C[i], C[j]] = [C[j], C[i]]; [P[i], P[j]] = [P[j], P[i]]; [L[i], L[j]] = [L[j], L[i]]; i = j; } }
  pop() { const C = this.c, P = this.p, L = this.l, r = [C[0], P[0], L[0]], c = C.pop(), p = P.pop(), l = L.pop(); if (C.length) { C[0] = c; P[0] = p; L[0] = l; let i = 0; for (;;) { const a = 2 * i + 1, b = a + 1; let m = i; if (a < C.length && C[a] < C[m]) m = a; if (b < C.length && C[b] < C[m]) m = b; if (m === i) break; [C[i], C[m]] = [C[m], C[i]]; [P[i], P[m]] = [P[m], P[i]]; [L[i], L[m]] = [L[m], L[i]]; i = m; } } return r; }
  get size() { return this.c.length; } }

// the muscles' lines on one side of the person's skeleton: { name: [origin, ...wrap points, insertion] } (world, m)
function lines(B, K, S_, s, fr) {
  const P = K.pts, G = K.geo, pv = G['pelvis' + S_], q = pv.q, F = G['fem' + S_], X_ = [s, 0, 0], k = F.kfm;
  const { at, surf, shaftAt } = fr;
  const Kc = F.Kc, lat = fr.l, ant = fr.a, up = mul(fr.u, -1);
  const patella = K.parts.find(p => p.name === 'patella.' + S_), pb = patella.bb, patC = [(pb[0] + pb[3]) / 2, (pb[1] + pb[4]) / 2, (pb[2] + pb[5]) / 2];
  const patTop = mad(patC, up, 1.3 * CM * k), patLat = mad(patC, lat, 1.6 * CM * k, up, 0.4 * CM * k), patMed = mad(patC, lat, -1.6 * CM * k, up, 0.4 * CM * k);
  const tib = P['tibialTub' + S_], pes = mad(tib, lat, -2.6 * CM * k, ant, -1.4 * CM * k, up, 0.6 * CM * k), fib = P['fibHead' + S_];
  const condMedPost = mad(Kc, lat, -2.6 * CM * k, ant, -3.4 * CM * k, up, 2.5 * CM * k), condLatPost = mad(Kc, lat, 2.6 * CM * k, ant, -3.4 * CM * k, up, 2.5 * CM * k);
  const medTibPost = mad(Kc, lat, -2.4 * CM * k, ant, -2.6 * CM * k, up, -2.6 * CM * k), addTub = mad(Kc, lat, -3.6 * CM * k, ant, -0.8 * CM * k, up, 4.2 * CM * k);
  const tub = P['ischTub' + S_], tubL = mad(tub, X_, 0.6 * CM), tubM = mad(tub, X_, -0.3 * CM, [0, 0, 1], -0.4 * CM);
  // the shaft's faces at a fraction r of the mechanical axis: posterior (the linea aspera), its medial and lateral lips, the lateral, medial and anterior faces
  const dirA = deg => nrm(add(mul(ant, Math.cos(deg * Math.PI / 180)), mul(lat, Math.sin(deg * Math.PI / 180))));   // 0 anterior, +90 lateral, -90 medial, 180 posterior
  const face = (r, deg) => surf(r, dirA(deg));
  const gtBase = mad(F.gt, fr.u, 2.2 * CM * k, ant, 0.4 * CM * k), asis = P['asis' + S_], aiis = q(10.6, -4.2, 0.4), lt = mad(F.Pn, F.sdir, -2.6 * CM * k, F.med, 1.2 * CM * k, F.F.a, -1.2 * CM * k);
  return {
    // the quadriceps: the vasti on the faces of the shaft they arise from, to the patella's base and borders; rectus femoris from the AIIS
    vastusIntermedius: [face(0.12, 20), face(0.4, 15), face(0.7, 10), patTop],
    vastusLateralis: [gtBase, face(0.3, 105), face(0.6, 100), patLat],
    vastusMedialis: [face(0.1, -40), face(0.4, -110), face(0.75, -95), patMed],
    rectusFemoris: [aiis, mad(at(0.08), ant, 2.6 * CM * k), patTop],
    // the hamstrings from the ischial tuberosity behind the condyles; the short head from the lateral lip of the linea aspera to the fibular head
    semimembranosus: [tubL, condMedPost, medTibPost], semitendinosus: [tubM, condMedPost, pes], bicepsFemorisLong: [mad(tubM, X_, 0.5 * CM), condLatPost, fib],
    bicepsFemorisShort: [face(0.45, 160), face(0.75, 140), fib],
    // the adductors from the pubis and the ischiopubic ramus to their lines on the linea aspera; adductor magnus' ischiocondylar part to the adductor tubercle
    pectineus: [q(3.6, -9.4, 1.4, 0.3), lt, face(0.17, -160)], adductorBrevis: [q(2.2, -13.0, 0.4, 0.7), face(0.2, -165), face(0.38, -170)],
    adductorLongus: [q(2.0, -10.6, 2.4, 0.3), face(0.35, -160), face(0.62, -165)], adductorMagnus: [q(4.8, -16.6, -3.4, 1.0), face(0.3, -170), face(0.72, -160)],
    adductorMagnusIschial: [mad(tub, X_, -0.4 * CM, [0, 0, 1], 0.6 * CM), mad(face(0.6, -140), lat, -1.0 * CM * k), addTub],
    // the superficial straps: sartorius from the ASIS, gracilis from the pubis beside the symphysis, both to the pes anserinus behind the medial condyle
    sartorius: [mad(asis, up, -0.6 * CM, [0, 0, 1], -0.4 * CM), condMedPost, pes], gracilis: [q(1.6, -12.4, 1.2, 0.3), condMedPost, pes],
    // (v5) the knee's fat bodies on the person's own femur: the anterior pads on its front from above the trochlea up the shaft's lower fifth; the
    // popliteal fat on the popliteal surface (from where the supracondylar lines part, ~0.7 of the shaft) down behind the condyles to the joint line
    suprapatellarFat: [face(0.76, 0), face(0.86, 0), face(0.95, 0)],
    poplitealFat: [face(0.7, 180), face(0.86, 180), mad(face(1.0, 180), up, -1.4 * CM * k)] };
}
// (v2, lane iteration 15) THE ADDUCTORS ARE FANS. Adductor longus, brevis and magnus arise from a short stretch of the pubis and the ischiopubic ramus and
// insert along a LINE of the femur (the pectineal line and the linea aspera: brevis its upper third, longus its middle third, magnus' adductor part from
// the gluteal tuberosity to the adductor hiatus), their fibres running from the origin to every point of that line (Standring 2016; adductor
// magnus' fibre groups: Takizawa et al 2014, Scand J Med Sci Sports 24:197, RECALLED, to verify). v1 drew each as ONE polyline origin -> the insertion line's top -> along the bone to its
// bottom, so below the line's top the whole belly lay ON the femur: the adductor mass stood 7-11 cm from the midline (L08) and the medial thigh had only
// the gracilis' strap. Here each fan is FIBRE lines from its origin (magnus: along its origin on the ramus, paired in order with the insertion) to
// points spread along its insertion line, the volume shared equally; at a section the muscle's area is its fibres' areas there and its site the
// fibres' area-weighted crossing (one muscle, one belly: the partition shapes it). Nothing is placed: the fibres run between the person's own attachments.
function fans(L, K, S_, fr) {
  const pv = K.geo['pelvis' + S_], q = pv.q, face = (r, deg) => fr.surf(r, nrm(add(mul(fr.a, Math.cos(deg * Math.PI / 180)), mul(fr.l, Math.sin(deg * Math.PI / 180)))));
  const N = 4, sp = (a, b) => Array.from({ length: N }, (_, k) => k / (N - 1)).map(t => [a + (b - a) * t]);
  return {
    adductorLongus: sp(0.35, 0.62).map(([r]) => [L.adductorLongus[0], face(r, -160 - 5 * (r - 0.35) / 0.27)]),
    adductorBrevis: sp(0.2, 0.38).map(([r]) => [L.adductorBrevis[0], face(r, -165 - 5 * (r - 0.2) / 0.18)]),
    // magnus' adductor part: its origin from the inferior pubic ramus to the ischial ramus (paired in order: the pubic fibres to the upper linea aspera,
    // nearly horizontal; the ischial ramus' to the hiatus, steep); its ischiocondylar part (adductorMagnusIschial) is its own line, as before
    adductorMagnus: sp(0, 1).map(([t]) => [q(2.4 + 3.6 * t, -13.6 - 4.0 * t, 0.2 - 3.2 * t, 1.0), face(0.12 + 0.6 * t, -170 + 10 * t)]) };
}

// (v4, lane iteration 18) THE CRURAL MUSCLES' LINES on one side, in the leg's frame (fr: u down the leg from the knee's joint line to the ankle, l lateral,
// a anterior; fr.surf(r, dir) the tibia's surface, fr.fsurf(r, dir) the fibula's, fr.T(r, X, Z) a point off the tibia's section centre, cm x k): each from
// its origin to its insertion on the person's own bones (Standring 2016; recalled), routed behind or in front of the malleoli as its tendon runs
function crusLines(B, K, S_, s, fr) {
  const P = K.pts, G = K.geo, F = G['fem' + S_], k = F.kfm, Y = [0, 1, 0];
  const uT = nrm(sub(F.K, F.H)), oT = v => nrm(sub(v, mul(uT, dot(v, uT)))), lT = oT(F.F.l), aT = oT(F.F.a), upT = mul(uT, -1), Kc = F.Kc;
  const condMed = mad(Kc, lT, -2.6 * CM * k, aT, -3.0 * CM * k, upT, 3.0 * CM * k), condLat = mad(Kc, lT, 2.4 * CM * k, aT, -3.0 * CM * k, upT, 2.6 * CM * k);
  const latEpi = mad(Kc, lT, 3.6 * CM * k, aT, -0.6 * CM * k, upT, 0.4 * CM * k);
  const mm = P['medMal' + S_], lm = P['latMal' + S_], heel = P['heel' + S_], a = fr.a, l = fr.l;
  const dirA = deg => nrm(add(mul(a, Math.cos(deg * Math.PI / 180)), mul(l, Math.sin(deg * Math.PI / 180))));   // 0 anterior, +90 lateral, -90 medial, 180 posterior
  const tib = (r, deg) => fr.surf(r, dirA(deg)), fib = (r, deg) => fr.fsurf(r, dirA(deg)), T = fr.T;
  const calc = mad(heel, a, 0.6 * CM * k, Y, 1.5 * CM * k);                                  // the calcaneal tuberosity's posterior face (the tendo calcaneus)
  const behindMM = mad(mm, a, -1.2 * CM * k, Y, 0.6 * CM * k), behindLM = mad(lm, a, -1.1 * CM * k, Y, 0.9 * CM * k);
  const frontAnk = (X, Z) => T(1.0, X * k, Z * k);
  return {
    // the superficial posterior compartment: gastrocnemius' two heads from above the femoral condyles, soleus from the fibula's head and upper shaft and
    // the tibia's soleal line, all to the calcaneal tuberosity by the tendo calcaneus
    gastrocnemiusMedialis: [condMed, T(0.05, -2.0 * k, -4.6 * k), T(0.28, -1.6 * k, -5.4 * k), T(0.72, 0.2 * k, -4.4 * k), T(0.92, 0.3 * k, -4.0 * k), calc],
    gastrocnemiusLateralis: [condLat, T(0.05, 2.0 * k, -4.4 * k), T(0.24, 1.8 * k, -5.0 * k), T(0.72, 0.6 * k, -4.4 * k), T(0.92, 0.4 * k, -4.0 * k), calc],
    soleus: [fib(0.06, 180), T(0.3, 0.8 * k, -3.4 * k), T(0.62, 0.6 * k, -3.6 * k), T(0.92, 0.35 * k, -3.6 * k), calc],
    // the deep posterior: popliteus (lateral femoral condyle -> the tibia above the soleal line), tibialis posterior (the interosseous membrane and both
    // bones' posterior surfaces -> behind the medial malleolus -> the navicular), the long flexors (the tibia's and the fibula's posterior surfaces ->
    // behind the medial malleolus -> the sole)
    popliteus: [latEpi, T(0.06, 0.2 * k, -2.6 * k), tib(0.17, -150)],
    tibialisPosterior: [T(0.1, 1.4 * k, -1.4 * k), T(0.45, 1.0 * k, -1.8 * k), T(0.82, -0.4 * k, -1.8 * k), behindMM, mad(mm, a, 2.6 * CM * k, Y, -1.8 * CM * k)],
    flexorDigitorumLongus: [tib(0.3, -150), T(0.6, -0.6 * k, -2.2 * k), T(0.88, -0.9 * k, -2.1 * k), mad(behindMM, a, -0.2 * CM * k, Y, -0.6 * CM * k), mad(mm, a, 4.0 * CM * k, Y, -3.6 * CM * k)],
    flexorHallucisLongus: [fib(0.33, 180), T(0.65, 1.4 * k, -2.6 * k), T(0.92, 0.4 * k, -2.4 * k), mad(behindMM, a, -0.6 * CM * k, l, 0.8 * CM * k, Y, -1.2 * CM * k), mad(mm, a, 8.0 * CM * k, Y, -4.6 * CM * k)],
    // the anterior compartment: tibialis anterior (the lateral condyle and the tibia's lateral surface -> under the extensor retinacula -> the medial
    // cuneiform), the long extensors (the fibula's anterior surface -> the toes)
    tibialisAnterior: [tib(0.05, 60), tib(0.35, 75), T(0.82, 0.3 * k, 2.0 * k), frontAnk(-0.6, 2.6), mad(mm, a, 3.6 * CM * k, Y, -2.4 * CM * k, l, 0.6 * CM * k)],
    extensorDigitorumLongus: [fib(0.06, 30), fib(0.4, 15), T(0.82, 1.6 * k, 1.6 * k), frontAnk(1.0, 2.6), mad(lm, a, 7.5 * CM * k, Y, -3.0 * CM * k, l, -1.0 * CM * k)],
    extensorHallucisLongus: [fib(0.36, -30), T(0.68, 1.0 * k, 1.0 * k), frontAnk(0.2, 2.8), mad(mm, a, 10 * CM * k, Y, -4.0 * CM * k, l, 1.0 * CM * k)],
    // the lateral compartment: the fibulares from the fibula's lateral surface -> behind the lateral malleolus -> the foot
    fibularisLongus: [fib(0.04, 90), fib(0.35, 100), fib(0.72, 125), behindLM, mad(lm, a, 2.0 * CM * k, Y, -3.0 * CM * k)],
    fibularisBrevis: [fib(0.36, 105), fib(0.75, 115), mad(behindLM, Y, 0.4 * CM * k), mad(lm, a, 3.5 * CM * k, Y, -2.5 * CM * k, l, 1.0 * CM * k)],
    // (v5) the infrapatellar fat pad: from behind the patella's apex down behind the patellar ligament to the front of the tibia's plateau, above the
    // tuberosity (the deep infrapatellar bursa below it): ~1 cm deeper than the ligament
    infrapatellarFat: (() => { const pat = K.parts.find(p => p.name === 'patella.' + S_), tub = P['tibialTub' + S_]; if (!pat || !tub) return [T(0.02, 0, 2.0 * k), T(0.08, 0, 2.0 * k)];
      const pb = pat.bb, pc = [(pb[0] + pb[3]) / 2, (pb[1] + pb[4]) / 2, (pb[2] + pb[5]) / 2], apex = mad(pc, fr.u, 1.9 * CM * k, a, -0.1 * CM * k);
      const front = T(0.04, 0, 2.0 * k); return [mad(apex, a, -1.0 * CM * k), lerp(mad(apex, a, -1.0 * CM * k), front, 0.5), front]; })() };
}
// soleus is a broad sheet: its fibres from the fibula's head and upper third, the tendinous arch and the tibia's soleal line converge on the tendo
// calcaneus (one muscle, its volume shared among them)
function crusFans(L, fr) {
  const a = fr.a, l = fr.l, dirA = deg => nrm(add(mul(a, Math.cos(deg * Math.PI / 180)), mul(l, Math.sin(deg * Math.PI / 180)))), so = L.soleus, tail = so.slice(1);
  return { soleus: [[fr.fsurf(0.06, dirA(180)), ...tail], [fr.fsurf(0.28, dirA(-170)), ...tail], [fr.T(0.12, 0.2, -2.0), ...tail], [fr.surf(0.3, dirA(-140)), ...tail]] };
}

// one side's stack: the frame, the lines, the per-section packing
function buildSide(B, K, S_, s, opts, seg = 'thigh') {
  // (v4) seg 'crus': the same packing below the knee, on the leg's axis from the knee's joint line to the ankle joint, the tibia the section's centre
  const G = K.geo, F = G['fem' + S_], CRUS = seg === 'crus', KJL = mad(F.K, nrm(sub(F.K, F.H)), 1.7 * CM * F.kfm), AJ = B.J?.['foot.' + S_]?.h;
  const H = CRUS ? KJL : F.H, Kj = CRUS ? AJ : F.K, Lm = len(sub(Kj, H)), u = nrm(sub(Kj, H));
  const orth = v => nrm(sub(v, mul(u, dot(v, u)))), l = orth(F.F.l), a = orth(F.F.a);
  const femur = K.parts.find(p => p.name === (CRUS ? 'tibia.' : 'femur.') + S_), fibula = K.parts.find(p => p.name === 'fibula.' + S_), bones = K.parts.filter(p => /^(femur|patella|tibia|fibula|coxa)/.test(p.name) && (p.name.endsWith(S_) || !/\.[LR]$/.test(p.name)));
  const W = (sc, X, Z) => mad(H, u, sc, l, X, a, Z);
  // the femur's section centre at sc (the centroid of the bone's section; the shaft line where the section misses the bone); the crus: the tibia's
  const boneC = (sc, bp = femur) => { let sx = 0, sz = 0, n = 0; for (let X = -0.05; X <= 0.05; X += 0.002) for (let Z = -0.05; Z <= 0.05; Z += 0.002) { const p = W(sc, X, Z); if (sdPart(bp, p[0], p[1], p[2], 0.01) < 0) { sx += X; sz += Z; n++; } } return n ? [sx / n, sz / n] : null; };
  const shaftAt = r => { const c = boneC(r * Lm); return c ? W(r * Lm, c[0], c[1]) : mad(H, u, r * Lm); };
  const surf = (r, dir) => { const c = shaftAt(r); let t = 0; while (t < 0.06 && sdPart(femur, ...mad(c, dir, t), 0.02) < 0) t += 0.0005; return mad(c, dir, t); };
  const fshaft = r => { const c = fibula ? boneC(r * Lm, fibula) : null; return c ? W(r * Lm, c[0], c[1]) : mad(shaftAt(r), l, 0.027); };
  const fsurf = (r, dir) => { const c = fshaft(r); let t = 0; while (fibula && t < 0.04 && sdPart(fibula, ...mad(c, dir, t), 0.02) < 0) t += 0.0005; return mad(c, dir, t); };
  const fr = { u, l, a, Lm, at: r => mad(H, u, r * Lm), surf, shaftAt, fsurf, T: (r, X, Z) => mad(shaftAt(r), l, X * CM, a, Z * CM) };
  const L = CRUS ? crusLines(B, K, S_, s, fr) : lines(B, K, S_, s, fr), FANS = opts.fans === false ? {} : CRUS ? crusFans(L, fr) : fans(L, K, S_, fr), V = opts.V;
  // each line's arc length, its crossing of a section and its slope there; a fan's fibres each a line of its own (the volume shared)
  const lineOf = (pts, spec, Vcm3) => { const seg = []; let tot = 0; for (let i = 0; i + 1 < pts.length; i++) { const d = len(sub(pts[i + 1], pts[i])); seg.push(d); tot += d; }
    let mean = 0; const N = 200; for (let i = 0; i < N; i++) mean += bellyF(spec.belly, (i + 0.5) / N); mean /= N; return { pts, seg, tot, mean, spec, Vcm3 }; };
  const lineInfo = {}; for (const [n, pts] of Object.entries(L)) { const spec = SPEC(n); lineInfo[n] = lineOf(pts, spec, V(n));
    if (FANS[n]) { const F = FANS[n]; lineInfo[n].fibres = F.map(fp => lineOf(fp, spec, V(n) / F.length)); const mid = lineInfo[n].fibres[Math.floor(F.length / 2)]; Object.assign(lineInfo[n], { pts: mid.pts, seg: mid.seg, tot: mid.tot, mean: mid.mean }); } }
  const crossI = (I, sc) => { const P = I.pts; let acc = 0; for (let i = 0; i + 1 < P.length; i++) { const s0 = dot(sub(P[i], H), u), s1 = dot(sub(P[i + 1], H), u);
      if ((sc - s0) * (sc - s1) <= 0 && s1 !== s0) { const f = (sc - s0) / (s1 - s0), p = lerp(P[i], P[i + 1], f), dir = nrm(sub(P[i + 1], P[i])); return { p, sig: (acc + f * I.seg[i]) / I.tot, slope: Math.abs(dot(dir, u)) }; } acc += I.seg[i]; } return null; };
  const areaI = (I, sc) => { const c = crossI(I, sc); if (!c) return { A: 0, c }; const f = bellyF(I.spec.belly, c.sig); if (f <= 0) return { A: 0, c };
    return { A: I.Vcm3 * 1e-6 * f / (I.tot * I.mean) / Math.max(0.4, c.slope), c }; };
  const cross = (n, sc) => crossI(lineInfo[n], sc);
  // the area (m2) across the thigh at sc: V f(sig) / (L mean f) over the slope's cosine; a fan: its fibres' areas, its site their area-weighted crossing
  const areaAt = (n, sc) => { const I = lineInfo[n]; if (!I.fibres) return areaI(I, sc);
    let A = 0, p = [0, 0, 0], sig = 0, any = null; for (const Fi of I.fibres) { const r = areaI(Fi, sc); if (r.c) any = r.c; if (!(r.A > 0)) continue; A += r.A; p = mad(p, r.c.p, r.A); sig += r.A * r.c.sig; }
    if (!(A > 0)) return { A: 0, c: any }; return { A, c: { p: mul(p, 1 / A), sig: sig / A, slope: 1 } }; };
  // (v4, lane iteration 18) THE CALF'S MUSCLE AREA FROM THE PERSON'S CALF GIRTH (muscles.js: the corrected girth): at the stack's level of the largest
  // muscle area (the calf's widest), the muscles' area by the reference volumes against the person's: (C - 2 pi T)^2 / 4 pi less the bones' section and
  // the intermuscular share; every crural muscle's volume is scaled by their ratio (one factor: the person's lower-leg muscularity)
  const calfInfo = {};
  if (CRUS && opts.calf) { const names0 = Object.keys(L).filter(n => !SPEC(n).fat); let best = 0, sBest = 0; for (let sc = 1.0 * CM; sc < Lm - 4 * CM; sc += 0.5 * CM) { let A = 0; for (const n of names0) A += areaAt(n, sc).A; if (A > best) { best = A; sBest = sc; } }
    let nb = 0; const hb = 0.002, c0 = boneC(sBest) || [0, 0]; for (let X = -0.06; X <= 0.08; X += hb) for (let Z = -0.06; Z <= 0.06; Z += hb) { const p = W(sBest, c0[0] + X, c0[1] + Z); if (sdPart(femur, p[0], p[1], p[2], 0.01) < 0 || (fibula && sdPart(fibula, p[0], p[1], p[2], 0.01) < 0)) nb++; }
    const Ab = nb * hb * hb, Cc = opts.calf.girth - 2 * Math.PI * opts.calf.T, Am = Math.max(0, Cc * Cc / (4 * Math.PI) - Ab) / (1 + INTERMUSCULAR), f = best > 0 ? Math.min(2, Math.max(0.4, Am / best)) : 1;
    for (const I of Object.values(lineInfo)) { if (I.spec.fat) continue; I.Vcm3 *= f; if (I.fibres) for (const Fi of I.fibres) Fi.Vcm3 *= f; }
    Object.assign(calfInfo, { factor: +f.toFixed(3), girthCm: +(opts.calf.girth * 100).toFixed(1), layerMm: +(opts.calf.T * 1000).toFixed(1), muscleCm2: +(Am * 1e4).toFixed(1), refCm2: +(best * 1e4).toFixed(1), boneCm2: +(Ab * 1e4).toFixed(1), atCm: +(sBest * 100).toFixed(1) }); }
  // the stack: from just below the hip's centre (the groin and the gluteal fold's levels are packed: no shelf where the stack begins) to the patella's top
  // (v4) the crus: from just below the knee's joint line (the plateau and the gastrocnemius' heads' bellies) to a hand above the ankle (the tendons below)
  // (v5, lane iteration 19) THE KNEE BY ITS ANATOMY: the thigh is packed down to the knee's joint line (0.5 cm above it: its sections' caps meet the
  // crus' there) and the crus from 0.5 cm under it. v4 ended the thigh 3 cm x k above the knee's centre (4.7 cm above the joint line) and began the crus
  // 1 cm under it: the vasti's and the hamstrings' last centimetres were flat caps, and between the stacks the knee was bone and 4 mm cords under the
  // sleeve's hull (the critic, 16 Oct: the stack must end where the anatomy ends);
  // and the crus from 1 cm ABOVE the joint line (the gastrocnemius' heads and popliteus arise above it, the infrapatellar pad lies at it: they are
  // packed where they are, round the thigh's own fields, which are its obstacles)
  const sTop = CRUS ? -1.0 * CM : opts.sTop ?? 1.0 * CM * F.kfm, sBot = CRUS ? Lm - 4.0 * CM * F.kfm : Lm + 1.7 * CM * F.kfm - 0.5 * CM;
  const names = Object.keys(L), nS = Math.floor((sBot - sTop) / DS) + 1;
  // the obstacles: this side's bones and the other lanes' muscles (gluteus maximus, medius, the rotators) and the hip's own (iliopsoas, minimus, TFL)
  const obst = bones.concat((opts.obstacles || []).filter(p => !/\.[LR]$/.test(p.name) || p.name.endsWith(S_)), CRUS ? (opts.thighParts || []).filter(p => p.name.endsWith('.' + S_)) : []);
  // the MEDIAL BOUND (v2, lane iteration 15): above the crotch the perineum's strip is not the thigh's (fat.js perineumOf); below it the thigh reaches to
  // its contact face with the other thigh (the midplane, half a solver cell off it: fat.js 7b). v1 blocked the strip's 3.8 cm from the midline at EVERY
  // height down to the knee, so the adductors and gracilis were packed 4.4-5.6 cm from the midline (L08) and the medial thigh had no room of its own:
  // the held strip's frozen surface stood in for it.
  // (v3, lane iteration 17) the perineum by its own bound: the perineal side of the genitocrural septum (fat.js perineumOf), not v2's box (|x| < 3.8 cm
  // above the crotch - 1 cm), which kept the adductors' and gracilis' roots out of the thigh's medial face up to the crotch: a deep-layer step there
  const PN = perineumOf(B, K), xIn = PN.xIn, yPer = PN.yHeldLo, xFace = opts.contactGap ?? 0.0035, perineal = p => s * p[0] < xIn && p[1] > yPer && (p[1] >= PN.yPubLow || PN.inPerineum(p));
  const X0 = -0.15, X1 = 0.11, Z0 = -0.13, Z1 = 0.13, nx = Math.round((X1 - X0) / H_PX), nz = Math.round((Z1 - Z0) / H_PX);
  const sections = [], info = { deficit: {}, fill: 0, packed: 0, rounds: [] };
  const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  for (let k = 0; k < nS; k++) {
    const sc = sTop + k * DS, c0 = boneC(sc) || [0, 0], cx = c0[0], cz = c0[1];
    const px = i => X0 + (i + 0.5) * H_PX + cx, pz = j => Z0 + (j + 0.5) * H_PX + cz;   // the window follows the femur's section centre
    const N = nx * nz, lab = new Int16Array(N).fill(-1), bone = new Uint8Array(N), blocked = new Uint8Array(N), softO = new Uint8Array(N);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const p = W(sc, px(i), pz(j)), id = j * nx + i;
      if (perineal(p) || s * p[0] < xFace) { blocked[id] = 1; continue; }
      const r = sdParts(obst, p[0], p[1], p[2], 0.01); if (r.d < 0) { blocked[id] = 1; const nm = obst[r.i].name; if (/^(femur|patella|tibia|fibula)/.test(nm)) bone[id] = 1; else if (obst[r.i].kind === 'muscle') softO[id] = 1; } }
    // the muscles present at this level, their areas and where their lines cross
    // a belly is continuous along its length: where it was packed in the section above, its site starts halfway between its line's crossing and
    // that cell's centre (the partition does not flicker from one section to the next), and its weight carries over
    const prev = sections.length ? sections[sections.length - 1] : null;
    const here = []; for (const n of names) { const { A, c } = areaAt(n, sc); if (A > 1e-6 && c) { let X = dot(sub(c.p, H), l) - cx, Z = dot(sub(c.p, H), a) - cz; const pf = prev?.fields[n];
      if (pf?.c) { X = 0.5 * X + 0.5 * (pf.c[0] - cx); Z = 0.5 * Z + 0.5 * (pf.c[1] - cz); } here.push({ n, A, X, Z, depth: lineInfo[n].spec.depth, w0: prev?.w?.[n] ?? 0 }); } }
    const order = here.slice().sort((p, q) => p.depth - q.depth);
    // (3) the sites: each line's crossing, pushed out of what lies deeper (the blocked pixels and the discs of the muscles placed before it) to its
    // radius; the straps (depth 2) where their lines' bearing from the bone's centre leaves the deep cluster
    const occ = Uint8Array.from(blocked), toPx = (X, Z) => [Math.round((X - X0) / H_PX - 0.5), Math.round((Z - Z0) / H_PX - 0.5)], sites = [];
    const stamp = (i, j, r) => { const rp = r / H_PX; for (let jj = Math.max(0, Math.floor(j - rp)); jj <= Math.min(nz - 1, Math.ceil(j + rp)); jj++) for (let ii = Math.max(0, Math.floor(i - rp)); ii <= Math.min(nx - 1, Math.ceil(i + rp)); ii++) if ((ii - i) ** 2 + (jj - j) ** 2 <= rp * rp) occ[jj * nx + ii] = 1; };
    for (const m of order.filter(m => m.depth < 2)) { const r = Math.sqrt(m.A / Math.PI), D = edt(occ, nx, nz, true); let [i, j] = toPx(m.X, m.Z); i = clamp(i, 1, nx - 2); j = clamp(j, 1, nz - 2);
      for (let it = 0; it < 200 && D[j * nx + i] * H_PX < 0.8 * r; it++) { let bi = i, bj = j, bd = D[j * nx + i]; for (const [di, dj] of NB) { const ii = i + di, jj = j + dj; if (ii < 1 || jj < 1 || ii >= nx - 1 || jj >= nz - 1) continue; if (D[jj * nx + ii] > bd) { bd = D[jj * nx + ii]; bi = ii; bj = jj; } } if (bi === i && bj === j) break; i = bi; j = bj; }
      sites.push({ ...m, i, j, r }); stamp(i, j, r); }
    for (const m of order.filter(m => m.depth === 2)) { const r = Math.sqrt(m.A / Math.PI), ang = Math.atan2(m.Z, m.X); let last = null;
      for (let t = 0; t < 0.14; t += H_PX * 0.5) { const [ii, jj] = toPx(Math.cos(ang) * t, Math.sin(ang) * t); if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) break; if (occ[jj * nx + ii] && !(blocked[jj * nx + ii] && !bone[jj * nx + ii] && !softO[jj * nx + ii])) last = [ii, jj]; }
      let i, j; const [li, lj] = toPx(m.X, m.Z), outside = last && Math.hypot(li - (nx * 0.5 - X0 / H_PX - nx * 0.5), lj - (nz * 0.5 - Z0 / H_PX - nz * 0.5)) > Math.hypot(last[0] - (-X0 / H_PX), last[1] - (-Z0 / H_PX)) + r / H_PX;
      // (v2) a strap whose own line runs OUTSIDE the deep cluster lies on its line (gracilis beside the pubis: the cluster comes to it, not it to the
      // cluster); otherwise on the cluster's surface where its bearing leaves it, as before
      if (last && !outside) { i = clamp(Math.round(last[0] + Math.cos(ang) * (r / H_PX + 1)), 0, nx - 1); j = clamp(Math.round(last[1] + Math.sin(ang) * (r / H_PX + 1)), 0, nz - 1); }
      else { i = clamp(li, 0, nx - 1); j = clamp(lj, 0, nz - 1); }
      sites.push({ ...m, i, j, r, onSurface: !!last }); stamp(i, j, r); }
    // (4) THE FASCIA, TAUT: the packed cluster (the discs + the femur + the other lanes' muscles at this level) is wrapped by its convex hull (a stocking
    // under circumferential tension rests on the outermost tissue: it cannot dip between the bellies), then drawn in evenly until what it holds of
    // the thigh's own space is the bone + the bellies' areas + the intermuscular share: the bellies, incompressible, fill their fascia
    const U = []; for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const id = j * nx + i; if (bone[id] || softO[id] || (occ[id] && !blocked[id])) U.push([i, j]); }
    const hull = (() => { const P2 = U.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]), cr = (o, a2, b2) => (a2[0] - o[0]) * (b2[1] - o[1]) - (a2[1] - o[1]) * (b2[0] - o[0]), lo = [], up = [];
      for (const q2 of P2) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q2) <= 0) lo.pop(); lo.push(q2); }
      for (let k2 = P2.length - 1; k2 >= 0; k2--) { const q2 = P2[k2]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q2) <= 0) up.pop(); up.push(q2); }
      return lo.slice(0, -1).concat(up.slice(0, -1)); })();
    const sdH = new Float64Array(N);   // px; < 0 inside the hull (counter-clockwise in (i, j))
    if (hull.length >= 3) { const E = hull.map((p2, k2) => { const q2 = hull[(k2 + 1) % hull.length], ex = q2[0] - p2[0], ez = q2[1] - p2[1], L2 = Math.hypot(ex, ez) || 1; return { p: p2, ex, ez, L2, nx: ez / L2, nz: -ex / L2 }; });
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { let inside = true, dmin = Infinity;
        for (const e of E) { const rx = i - e.p[0], rz = j - e.p[1]; if (rx * e.nx + rz * e.nz > 0) inside = false; const t2 = clamp((rx * e.ex + rz * e.ez) / (e.L2 * e.L2), 0, 1), dx = rx - e.ex * t2, dz = rz - e.ez * t2; dmin = Math.min(dmin, Math.hypot(dx, dz)); }
        sdH[j * nx + i] = inside ? -dmin : dmin; } } else sdH.fill(1);
    // the membrane under its contents' pressure curves between its contacts (curvature p / T) rather than running straight: the hull's field is
    // smoothed over FASCIA_ROUND before it is drawn in (its corners become arcs, its facets bow out)
    { const r = Math.max(1, Math.round(FASCIA_ROUND / H_PX)), k = [], T2 = new Float64Array(N); let ks = 0; for (let d = -2 * r; d <= 2 * r; d++) { const g = Math.exp(-0.5 * (d / r) ** 2); k.push(g); ks += g; }
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { let a2 = 0; for (let d = -2 * r; d <= 2 * r; d++) a2 += k[d + 2 * r] * sdH[j * nx + clamp(i + d, 0, nx - 1)]; T2[j * nx + i] = a2 / ks; }
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { let a2 = 0; for (let d = -2 * r; d <= 2 * r; d++) a2 += k[d + 2 * r] * T2[clamp(j + d, 0, nz - 1) * nx + i]; sdH[j * nx + i] = a2 / ks; } }
    let boneA = 0; for (let i = 0; i < N; i++) if (bone[i]) boneA++;
    const want = sites.reduce((t2, m) => t2 + m.A, 0) / (H_PX * H_PX) * (1 + INTERMUSCULAR) + boneA, held = d => { let n2 = 0; for (let i = 0; i < N; i++) if (sdH[i] < -d && (!blocked[i] || bone[i])) n2++; return n2; };
    let dLo = -Rgrow, dHi = 60; for (let it = 0; it < 24; it++) { const dm = 0.5 * (dLo + dHi); if (held(dm) > want) dLo = dm; else dHi = dm; }
    const dF = 0.5 * (dLo + dHi), region = new Uint8Array(N); for (let i = 0; i < N; i++) region[i] = sdH[i] < -dF && !blocked[i] ? 1 : 0;
    // (5) the partition: every muscle grows from its site through the fascia's free space, cost = path length - its weight, and stops at its area; the
    // weights of the muscles short of their area are raised and the growth repeated (an additively weighted, area-matched partition: polygons
    // pressed against one another, not discs). What the bellies leave inside the fascia is the intermuscular tissue.
    const blk = new Uint8Array(N); for (let i = 0; i < N; i++) blk[i] = region[i] ? 0 : 1;
    // a muscle whose site another has already taken starts again from the free pixel nearest its site (its seed entry carries label + nl)
    const grow = (S2, w) => { lab.fill(-1); const nl = S2.length, got = new Float64Array(nl), need = S2.map(m => m.A / (H_PX * H_PX)), best = new Float32Array(N * nl).fill(Infinity), hp = new Heap();
      const nearestFree = (si, sj) => { let bd = Infinity, bid = -1; for (let k2 = 0; k2 < N; k2++) if (!blk[k2] && lab[k2] < 0) { const d2 = (k2 % nx - si) ** 2 + (((k2 / nx) | 0) - sj) ** 2; if (d2 < bd) { bd = d2; bid = k2; } } return bid; };
      for (let m = 0; m < nl; m++) hp.push(-w[m], S2[m].j * nx + S2[m].i, m + nl);
      while (hp.size) { let [cst, id, m] = hp.pop();
        if (m >= nl) { m -= nl; if (blk[id] || lab[id] >= 0) { id = nearestFree(S2[m].i, S2[m].j); if (id < 0) continue; } }
        if (lab[id] >= 0 || blk[id] || got[m] >= need[m]) continue; lab[id] = m; got[m]++; const i = id % nx, j = (id / nx) | 0;
        for (const [di, dj, dl] of NB) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue; const nid = jj * nx + ii; if (lab[nid] >= 0 || blk[nid]) continue;
          const nc = cst + dl; if (nc < best[nid * nl + m]) { best[nid * nl + m] = nc; hp.push(nc, nid, m); } } }
      return Array.from(got, (g, m) => g / need[m]); };
    const w = Float64Array.from(sites, m => m.w0); let frac = sites.length ? grow(sites, w) : [], round = 0;
    for (; round < 12 && frac.some(f => f < 0.97); round++) { for (let m = 0; m < sites.length; m++) if (frac[m] < 0.97) w[m] = Math.min(w[m] + 2 * (1 - frac[m]) * Math.sqrt(sites[m].A / Math.PI) / H_PX, 4 * sites[m].r / H_PX); frac = grow(sites, w); }
    info.rounds.push(round); const all = sites, IM = all.length;
    for (let m = 0; m < all.length; m++) if (frac[m] < 0.9) info.deficit[all[m].n] = Math.min(info.deficit[all[m].n] ?? 1, +frac[m].toFixed(2));
    let fill = 0, packedPx = 0; for (let i = 0; i < N; i++) { if (region[i] && lab[i] < 0) { lab[i] = IM; fill++; } else if (lab[i] >= 0) packedPx++; }
    info.fill += fill * H_PX * H_PX * DS; info.packed += packedPx * H_PX * H_PX * DS; info.drawIn = info.drawIn || []; info.drawIn.push(+(dF * H_PX * 100).toFixed(2));
    // per label: its pixel set's signed field on a crop (+ 2 cm)
    const fields = {}; const labs = all.map(m => m.n).concat(['intermuscular']);
    for (let L2 = 0; L2 < labs.length; L2++) { let i0 = nx, i1 = -1, j0 = nz, j1 = -1; for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) if (lab[j * nx + i] === L2) { if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; }
      if (i1 < 0) continue; const pad = 8; i0 = Math.max(0, i0 - pad); j0 = Math.max(0, j0 - pad); i1 = Math.min(nx - 1, i1 + pad); j1 = Math.min(nz - 1, j1 + pad);
      const cw = i1 - i0 + 1, ch = j1 - j0 + 1, mk = new Uint8Array(cw * ch); let area = 0; for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) if (lab[(j + j0) * nx + i + i0] === L2) { mk[j * cw + i] = 1; area++; }
      fields[labs[L2]] = { x0: X0 + cx + i0 * H_PX, z0: Z0 + cz + j0 * H_PX, nx: cw, nz: ch, f: signedField(mk, cw, ch), areaCm2: +(area * H_PX * H_PX * 1e4).toFixed(2), target: L2 < all.length ? +(all[L2].A * 1e4).toFixed(2) : null,
        c: (() => { let sx = 0, sz = 0, n = 0; for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) if (mk[j * cw + i]) { sx += i; sz += j; n++; } return n ? [X0 + cx + (i0 + sx / n + 0.5) * H_PX, Z0 + cz + (j0 + sz / n + 0.5) * H_PX] : null; })() }; }
    sections.push({ s: sc, cx, cz, fields, w: Object.fromEntries(sites.map((m, k) => [m.n, w[k]])), lab: opts.keepLabels ? { lab, bone, blocked, nx, nz, X0: X0 + cx, Z0: Z0 + cz, labs } : null });
  }
  info.calf = calfInfo;
  return { S_, s, seg, frame: { H, u, l, a, Lm, sTop, sBot, ds: DS }, sections, lines: L, lineInfo, areaAt, info };
}

// a FIELD part (skeleton/sdf.js sdPart reads part.fn): the signed distance of a label's sections, linear between sections, capped at the stack's ends
function fieldPart(name, side, label, kind = 'muscle') {
  const { H, u, l, a, sTop, ds } = side.frame, S = side.sections, ks = S.map((q, k) => q.fields[label] ? k : -1).filter(k => k >= 0);
  if (!ks.length) return null; const k0 = ks[0], k1 = ks[ks.length - 1];
  const at = (k, X, Z) => { const f = S[k].fields[label]; if (!f) return 0.03; const fx = (X - f.x0) / H_PX - 0.5, fz = (Z - f.z0) / H_PX - 0.5;
    const ox = Math.max(0, -fx, fx - (f.nx - 1)) * H_PX, oz = Math.max(0, -fz, fz - (f.nz - 1)) * H_PX;
    const i = clamp(Math.floor(fx), 0, f.nx - 2), j = clamp(Math.floor(fz), 0, f.nz - 2), tx = clamp(fx - i, 0, 1), tz = clamp(fz - j, 0, 1), F = f.f, w = f.nx;
    const v = (F[j * w + i] * (1 - tx) + F[j * w + i + 1] * tx) * (1 - tz) + (F[(j + 1) * w + i] * (1 - tx) + F[(j + 1) * w + i + 1] * tx) * tz;
    return ox || oz ? Math.max(v, 0) + Math.hypot(ox, oz) : v; };
  const bb = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9]; for (let k = k0; k <= k1; k++) { const f = S[k].fields[label]; if (!f) continue;
    for (const [X, Z] of [[f.x0, f.z0], [f.x0 + f.nx * H_PX, f.z0], [f.x0, f.z0 + f.nz * H_PX], [f.x0 + f.nx * H_PX, f.z0 + f.nz * H_PX]]) for (const dsx of [-ds, ds]) { const p = mad(H, u, S[k].s + dsx, l, X, a, Z); for (let c = 0; c < 3; c++) { bb[c] = Math.min(bb[c], p[c]); bb[c + 3] = Math.max(bb[c + 3], p[c]); } } }
  const fn = (x, y, z) => { const r = [x - H[0], y - H[1], z - H[2]], sc = dot(r, u), X = dot(r, l), Z = dot(r, a), fk = (sc - sTop) / ds;
    const cap = (d, w) => Math.min(Math.max(d, w), 0) + Math.hypot(Math.max(d, 0), Math.max(w, 0));
    if (fk <= k0) return cap(at(k0, X, Z), (k0 - fk) * ds - 0.5 * ds);
    if (fk >= k1) return cap(at(k1, X, Z), (fk - k1) * ds - 0.5 * ds);
    const k = Math.floor(fk), t = fk - k; return at(k, X, Z) * (1 - t) + at(k + 1, X, Z) * t; };
  return { name: name + '.' + side.S_, group: 'pelvis', kind, prims: [], k: 0.003, bb, fn, meta: { field: 'thigh', sections: [k0, k1] } };
}

// both sides: the packed stacks, their field parts, and each muscle's continuation above the stack to its origin (and below to its insertion)
export function buildThigh(B, K, M, opts = {}) {
  const t0 = Date.now(), out = [], sides = {}, info = { version: PELVIS_THIGH_VERSION };
  // (v4) both segments of the limb a side: the thigh (hip -> above the knee), then the crus (below the knee's joint line -> above the ankle) packed
  // around the thigh's tendons where they cross the knee (its continuation parts are the crus' obstacles)
  for (const [S_, s] of [['L', 1], ['R', -1]]) for (const seg of ['thigh', 'crus']) {
    if (seg === 'crus' && !B.J?.['foot.' + S_]) continue;
    const side = buildSide(B, K, S_, s, { ...opts, thighParts: out }, seg), key = seg === 'thigh' ? S_ : 'crus' + S_; sides[key] = side;
    const imName = seg === 'thigh' ? 'intermuscular' : 'crusIntermuscular';
    for (const n of Object.keys(side.lines).concat(['intermuscular'])) { const p = fieldPart(n === 'intermuscular' ? imName : n, side, n, 'muscle'); if (p) { p.meta.tissue = n === 'intermuscular' ? 'intermuscular' : SPEC(n)?.fat ? 'fat' : 'muscle'; p.meta.field = seg; out.push(p); } }
    // the continuations: above the stack's first section where the muscle is packed, its line to the origin (radius from its belly, a tendon where none);
    // below the last, to the insertion
    const { H, u, sTop } = side.frame;
    for (const [n, I] of Object.entries(side.lineInfo)) { const ks = side.sections.map((q, k) => q.fields[n] ? k : -1).filter(k => k >= 0); if (!ks.length) continue;
      const rOf = sig => { const f = bellyF(I.spec.belly, sig); return Math.max(TENDON_R, Math.sqrt(I.Vcm3 * 1e-6 * f / (I.tot * I.mean) / Math.PI)); };
      const ptAt = sig => { let acc = 0, d = sig * I.tot; for (let i = 0; i + 1 < I.pts.length; i++) { if (acc + I.seg[i] >= d) return lerp(I.pts[i], I.pts[i + 1], (d - acc) / I.seg[i]); acc += I.seg[i]; } return I.pts[I.pts.length - 1]; };
      const end = (k) => { const q = side.sections[k], f = q.fields[n]; const p = mad(H, u, q.s, side.frame.l, f.c[0], side.frame.a, f.c[1]); return { p, r: Math.sqrt(f.areaCm2 / 1e4 / Math.PI) * 0.9 }; };
      const top = end(ks[0]), c0 = side.areaAt(n, side.sections[ks[0]].s).c, sig0 = c0 ? c0.sig : 0;
      if (sig0 > 0.01) { const sg = [0, sig0 * 0.35, sig0 * 0.7].filter(g => g < sig0), pts = sg.map(ptAt).concat([top.p]), rr = sg.map(rOf).concat([top.r]);
        out.push(Object.assign(part0(n + 'Proximal.' + S_, tube(pts, rr), { k: 0.006, group: 'pelvis', kind: 'muscle', meta: { tissue: 'muscle', continuation: 'origin' } }), {})); }
      const bot = end(ks[ks.length - 1]), c1 = side.areaAt(n, side.sections[ks[ks.length - 1]].s).c, sig1 = c1 ? c1.sig : 1;
      if (sig1 < 0.99) { const sg = [sig1 + (1 - sig1) * 0.5, 1].filter(g => g > sig1), pts = [bot.p].concat(sg.map(ptAt)), rr = [bot.r].concat(sg.map(rOf));
        out.push(part0(n + 'Distal.' + S_, tube(pts, rr), { k: 0.006, group: 'pelvis', kind: 'muscle', meta: { tissue: 'muscle', continuation: 'insertion' } })); } }
    // (v4) THE PATELLAR LIGAMENT: the quadriceps' tendon continued from the patella's apex to the tibial tuberosity, a flat band ~2.5 cm wide and ~5-7 mm
    // thick (standard anatomy; recalled): three parallel cords side by side; the knee's front is bone and tendon under a thin layer
    if (seg === 'crus') { const pat = K.parts.find(p => p.name === 'patella.' + S_), tub = K.pts['tibialTub' + S_];
      if (pat && tub) { const pb = pat.bb, pc = [(pb[0] + pb[3]) / 2, (pb[1] + pb[4]) / 2, (pb[2] + pb[5]) / 2], k = K.geo['fem' + S_].kfm, apex = mad(pc, side.frame.u, 1.9 * CM * k, side.frame.a, -0.1 * CM * k);
        for (const dx of [-0.85, 0, 0.85]) out.push(part0('patellarLigament' + (dx < 0 ? 'Med' : dx > 0 ? 'Lat' : '') + '.' + S_, tube([mad(apex, side.frame.l, dx * CM * k), mad(lerp(apex, tub, 0.5), side.frame.l, dx * 0.9 * CM * k), mad(tub, side.frame.l, dx * 0.8 * CM * k, side.frame.a, -0.2 * CM * k)], [0.32, 0.3, 0.3].map(r => r * CM * k)), { k: 0.004, group: 'pelvis', kind: 'muscle', meta: { tissue: 'tendon' } })); } }
    info[key] = { sections: side.sections.length, sTopCm: +(side.frame.sTop * 100).toFixed(1), sBotCm: +(side.frame.sBot * 100).toFixed(1), deficit: side.info.deficit,
      packedCm3: Math.round(side.info.packed * 1e6), intermuscularCm3: Math.round(side.info.fill * 1e6), weightRounds: Math.max(0, ...side.info.rounds), ...(seg === 'crus' ? { calf: side.info.calf } : {}) };
  }
  info.ms = Date.now() - t0;
  return { parts: out, sides, info };
}
