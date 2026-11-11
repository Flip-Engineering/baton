// ANATOMY / PELVIS / FAT (ANAT8-PELVIS, round 7, 8 Oct 2026; NOTES D3): the SUBCUTANEOUS FAT of the pelvic region as compartments of volume,
// built from the person's tissue inputs on the person's own deep layer (bone + muscles), UNLOADED (gravity-free): the solver's input.
//
// THE ANATOMY (Markman and Barton 1987; Lockwood 1991): the superficial fascial system (SFS: Scarpa's fascia on the abdomen) divides the
// subcutaneous fat into a SUPERFICIAL layer (small lobules in vertical septa, roughly even in thickness) and a DEEP layer (larger, looser lobules) in
// which the sex- and site-specific DEPOTS lie; at the ZONES OF ADHERENCE (tethers.js) the SFS is bound to the deep fascia and the deep layer is absent.
// THE MODEL (no shape target anywhere):
//  (1) the region's skin parameterises the surface (hm08's triangles between the costal margin and mid-thigh, once subdivided); each vertex is cast
//      onto the DEEP FASCIA (the outer surface of bone + muscle: ANAT8-BODY's muscles + pelvis/muscles.js) along the inward normal;
//  (2) VOLUMES (the inputs): the person's DXA fat in the android and gynoid bands from NHANES 2017-18 (data.js: regional fat mass ~ the person's own
//      fat mass, age, stature, by sex), less the visceral (android) and an intermuscular share, as adipose tissue (lipid / 0.80 / 0.928 g/cm3); the
//      bands placed on the person's skeleton as the DXA software places them (GE Lunar / Hologic APEX: the pelvis cut at the iliac crests; android up
//      20 % of the distance to the neck cut; gynoid from 1.5 to 3.5 android heights below the pelvis cut; recalled, to verify);
//  (3) the SUPERFICIAL layer takes a share of each band (SIGMA, by sex), thinner at the zones of adherence;
//  (4) the DEEP layer is a MEMBRANE problem: the SFS under tension, pinned along the zones of adherence, lifted by each depot's fat (a screened
//      Poisson equation on the surface: (L + 1/l^2) phi = rho_c w_c, phi = 0 on the adherence lines), one field for the android-group depots and one
//      for the gynoid-group, their amplitudes fitted to the two bands' volumes; RHO is the sex-specific propensity of each depot (gynoid vs android
//      distribution; Karastergiou et al 2012, Manolopoulos et al 2010, Kelley et al 2000: the PATTERN, the numbers are this model's parameters, to be
//      checked by the gates, never tuned to them);
//  (5) the UNLOADED envelope = deep point + its normal x (superficial + deep + skin): what the solver loads with gravity and the tethers.
//   buildPelvisFat(B, K, deepParts, lines, { rec, subdiv }) -> { mesh, s, t, label, pinned, held, envelope, bands, volumes, info }
import { sdParts } from '../skeleton/sdf.js';
import { skinNormals } from '../skeleton/body.js';
import { dropOn, mad, sub, add, mul, nrm, dot, len, lerp, clamp, ss } from '../muscle/core.js';
import { regionalFat } from './data.js';
import { genitocruralCrease, perinealSide } from './tethers.js';
const CM = 0.01;
export const PELVIS_FAT_VERSION = 10;   // (lane iteration 21) THE DEEP FASCIA A TENSION MEMBRANE over the packed muscles (1): v2's rolling ball and v4's sleeve (a convex hull per 1 cm section, capped at the body before's skin) are gone; earlier versions: git history
export const ADIPOSE_PER_LIPID = 1 / 0.80 / 0.928;   // cm3 of adipose tissue per g of DXA fat: ~80 % lipid (Snyder et al 1975, ICRP 23), density 0.928 g/cm3 (computed from lipid 0.90 + water / protein 1.06)
// the depots (deep layer), their group (which DXA band's budget they share) and their propensity by sex (relative; the model's parameters)
export const DEPOTS = {
  // (v4) the thigh's layer below the hip is a RING (mid-thigh MRI and ultrasound sections of healthy-weight women: the subcutaneous layer runs round the
  // thigh at roughly even thickness, the medial and posterior a little thicker; recalled, to verify): the anterior, lateral and posterior thigh near
  // one another; the gynoid hip (trochanteric, gluteal) is where the sex difference concentrates (Karastergiou 2012). v3's anterior 0.3 against the
  // trochanteric 1.1 carried down to mid-thigh made the saddlebag the merged render showed (15 Oct).
  gluteal: { g: 'G', f: 1.0, m: 0.55 }, trochanteric: { g: 'G', f: 1.1, m: 0.25 }, lateralThigh: { g: 'G', f: 0.6, m: 0.35 }, medialThigh: { g: 'G', f: 0.8, m: 0.4 },
  posteriorThigh: { g: 'G', f: 0.65, m: 0.4 }, anteriorThigh: { g: 'G', f: 0.6, m: 0.35 }, sacral: { g: 'G', f: 0.6, m: 0.2 }, mons: { g: 'G', f: 0.9, m: 0.6 },
  // (v9, lane iteration 18) THE KNEE AND THE LEG (relative propensities round the ring at a height; the budget at each height is the legs' DXA fat laid by
  // LEG_PROFILE): over the patella and the patellar ligament the subcutis is thin (the prepatellar bursa lies in it; standard anatomy); the women's
  // medial knee carries a fat pad above and medial of the joint line (a classic female deposit in the body-contouring literature, recalled), the
  // popliteal fossa a moderate layer; below the knee the medial calf is the thick site (the standard skinfold site: ISAK), the back of the calf
  // moderate, the anterior and lateral leg thin, and the tibia's subcutaneous face bound (tethers.js tibialFace). The numbers are this model's parameters.
  kneeFront: { g: 'G', f: 0.3, m: 0.3 }, kneeMedial: { g: 'G', f: 0.95, m: 0.45 }, kneeLateral: { g: 'G', f: 0.35, m: 0.35 }, popliteal: { g: 'G', f: 0.55, m: 0.5 },
  calf: { g: 'G', f: 0.7, m: 0.65 }, medialCalf: { g: 'G', f: 0.8, m: 0.6 }, shin: { g: 'G', f: 0.4, m: 0.4 },
  flank: { g: 'A', f: 0.55, m: 1.0 }, lumbar: { g: 'A', f: 0.4, m: 0.6 }, lowerAbdomen: { g: 'A', f: 0.7, m: 1.0 }, upperAbdomen: { g: 'A', f: 0.35, m: 0.6 } };
// the superficial layer's share of a band's subcutaneous volume (Kelley 2000: deep SAT the larger share of the abdomen's in men; the gluteofemoral
// deep layer large in women; recalled, to verify)
export const SIGMA = { f: { A: 0.5, G: 0.42 }, m: { A: 0.45, G: 0.55 } };
// (v9, lane iteration 18) LEG_PROFILE: the subcutaneous layer's mean round the limb at its levels, relative to the front-thigh site at mid-thigh, by sex:
// the knee's joint line, the calf's widest (0.3 of the leg down), the ankle. Sources (RECALLED, to verify): ISAK skinfold norms (the medial calf ~0.6 of
// the front thigh in women, ~0.7 in men); ultrasound body mapping (Hoffmann et al 2022, Sci Rep 12:15916: MRI mid front thigh 1.15 cm, mid lateral
// thigh 1.03 cm at BMI 24.8, both sexes; the lower leg among the thinnest fields); the knee and the ankle thin (bone and tendon under the skin: over the tendo calcaneus and the malleoli ~3-4 mm, recalled). The
// legs' DXA fat (NHANES) is the budget: the profile only says HOW it is laid down the limb (its area-weighted mean over the legs' skin is the legs' mean).
export const LEG_PROFILE = { f: { knee: 0.55, calf: 0.62, ankle: 0.22 }, m: { knee: 0.6, calf: 0.7, ankle: 0.25 } };
const IMAT = { A: 0.05, G: 0.10, L: 0.15 };   // L: the legs' segment (intermuscular + marrow larger in the limb; recalled, to verify)          // the share of a band's DXA fat that is not subcutaneous (intermuscular, marrow; recalled, to verify), besides the VAT
const SKIN = { f: 0.0018, m: 0.0021 };      // the dermis over the buttock and the trunk (Agache et al 1980 range; recalled)
const FASCIA_R = 0.03;                      // (v10) the deep fascia's bridging length T / p (m) where it has its ordinary thickness (~1 mm): its free spans sag with curvature p / T, so it spans grooves narrower than ~3 cm (v2's ball's assumption, kept as the reference)
// (v10, lane iteration 21) the membrane's tension by zone, relative to FASCIA_R (T = a common resting stress x the fascia's thickness; the thicknesses
// recalled from dissection and MRI, to verify: the fascia lata ~1 mm, the iliotibial tract 2-3 times that under the pull of TFL and gluteus maximus
// (Fairclough et al 2006 J Anat 208:309; Stecco et al 2013 J Bodyw Mov Ther 17:512); gluteus maximus' own fascia an epimysial sheet bound to its
// fasciculi by septa (Stecco 2013); the fascia lata thinning over the knee's front and sides to the prepatellar fascia, the retinacula deeper; the
// crural fascia thickest in front where the extensors arise from it and thin over gastrocnemius (Stecco C, Fascial Manipulation atlas 2015; recalled))
export const FASCIA_T = { tract: 2.5, perineum: 2.5, gluteusMaximus: 0.5, knee: 0.4, calf: 0.5 };   // perineum: the perineal membrane (Standring 2016), as taut as the tract (an assumption)

// THE PERINEUM (v7, lane iteration 15): the strip between the thighs' roots the region does not model (the external genitalia and the perineal body),
// from 2.6 cm below the pubic tubercles down to 1 cm below the CROTCH, within the tubercles' x + 1.2 cm of the midline. The crotch is the lowest skin
// on the midline FACING DOWN (the perineum faces the floor; below it the midline skin is the two thighs' medial faces, facing each other: L08's ny
// -0.8..-1.0 down to 74 cm, |nx| 0.9-1.0 from 73 to 58 cm). One definition for the fat (fat.js `held`) and the thigh's packing (thigh.js: its medial bound).
// (v8, lane iteration 17) the perineum is bounded laterally by its ANATOMY, not by the box: the genitocrural crease, where Colles' fascia binds the skin
// to the ischiopubic ramus (tethers.js genitocruralCrease: the septum from the ramus's margin to the skin). Within the box, a point is the perineum's
// when it lies on the perineal side of that septum; past the crease's two ends (in front of the pubic tubercle, behind the ischial tuberosity) the box
// rule stands. v7's box (|x| < the tubercles' x + 1.2 cm, down to 1 cm below the crotch) held the thighs' medial faces above its horizontal lower
// edge as the body before's surface and freed them below it: the step under the crotch (the medial thigh receding 3-5 cm of circumference in 3 cm)
// and, in the men, the free skin hanging from that edge (the 'needle', 11-17 mm). Now the hand-over is the crease, bound by its own tether.
// (v9, lane iteration 18) THE LEGS' FAT DOWN THE LIMB, one definition for the fat's budget (buildPelvisFat (6b)) and the crural muscles' size parameter
// (muscles.js: the calf's corrected girth): the legs' DXA fat (NHANES, the person's fat mass, age, stature) over the legs' skin (hm08's triangles below the
// perineum's top, arms out) is the legs' mean layer tLeg; LEG_PROFILE lays it down the limb (rel(y): 1 at mid-thigh, the knee's joint line, the calf's
// widest, the ankle; linear between) and mL, the front thigh's level, is tLeg over the profile's own area-weighted mean on that skin
export function legFatProfile(B, K) {
  const sx = B.sex === 'f' ? 'f' : 'm', G = K.geo, FL = G.femL, FR = G.femR, mass = (B.bmi ?? 22) * B.stature * B.stature, FMt = (B.pf ?? (sx === 'f' ? 0.28 : 0.18)) * mass, RF = regionalFat(sx, FMt, B.age, B.stature);
  const yPubLow = perineumOf(B, K).yPubLow, kneeJ = [FL, FR].map(F => mad(F.K, nrm(sub(F.K, F.H)), 1.7 * CM * F.kfm));
  const ankle = ['L', 'R'].map((S_, k) => B.J?.['foot.' + S_]?.h || mad(kneeJ[k], [0, -1, 0], 0.4));
  const LP = LEG_PROFILE[sx], yMidT = ((FL.H[1] + FL.K[1]) / 2 + (FR.H[1] + FR.K[1]) / 2) / 2, yJn = (kneeJ[0][1] + kneeJ[1][1]) / 2, yAn = (ankle[0][1] + ankle[1][1]) / 2, yCf = yJn - 0.3 * (yJn - yAn);
  const rel = y => y >= yMidT ? 1 : y >= yJn ? 1 + (LP.knee - 1) * (yMidT - y) / (yMidT - yJn) : y >= yCf ? LP.knee + (LP.calf - LP.knee) * (yJn - y) / (yJn - yCf) : y >= yAn ? LP.calf + (LP.ankle - LP.calf) * (yCf - y) / (yCf - yAn) : LP.ankle;
  let Aleg = 0, relA = 0; { const P0 = B.pos, T0 = B.tri, nb = B.nb, RG = B.region, ARMS = new Set([3, 4, 5, 6]);
    for (let k = 0; k < T0.length; k += 3) { const a = T0[k], b = T0[k + 1], c = T0[k + 2]; if (a >= nb || b >= nb || c >= nb) continue; if (RG && (ARMS.has(RG[a]) || ARMS.has(RG[b]) || ARMS.has(RG[c]))) continue;
      const yc = (P0[a * 3 + 1] + P0[b * 3 + 1] + P0[c * 3 + 1]) / 3; if (yc >= yPubLow) continue;
      const ux = P0[b * 3] - P0[a * 3], uy = P0[b * 3 + 1] - P0[a * 3 + 1], uz = P0[b * 3 + 2] - P0[a * 3 + 2], vx = P0[c * 3] - P0[a * 3], vy = P0[c * 3 + 1] - P0[a * 3 + 1], vz = P0[c * 3 + 2] - P0[a * 3 + 2];
      const ar = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx); Aleg += ar; relA += rel(yc) * ar; } }
  const Vleg = RF.legs * (1 - IMAT.L) * 1000 * ADIPOSE_PER_LIPID * 1e-6, tLeg = Vleg / Math.max(1e-6, Aleg), meanRel = relA / Math.max(1e-6, Aleg), mL = tLeg / Math.max(0.2, meanRel);
  return { RF, Vleg, Aleg, tLeg, mL, meanRel, rel, LP, kneeJ, ankle, yMidT, yJn, yCf, yAn, skin: SKIN[sx] };
}
export function perineumOf(B, K) {
  const P = K.pts, yPubLow = (P.pubTubL[1] + P.pubTubR[1]) / 2 - 2.6 * CM, xIn = Math.abs(P.pubTubL[0]) + 1.2 * CM, N = skinNormals(B), X = B.pos;
  let yCr = Infinity; for (let v = 0; v < B.nb; v++) if (Math.abs(X[v * 3]) < 0.012 && X[v * 3 + 1] < yPubLow && N[v * 3 + 1] < -0.5) yCr = Math.min(yCr, X[v * 3 + 1]);
  const yHeldLo = Number.isFinite(yCr) ? yCr - 1 * CM : -Infinity, crease = { 1: genitocruralCrease(B, K, 1), [-1]: genitocruralCrease(B, K, -1) };
  const inBox = p => p[1] < yPubLow && p[1] > yHeldLo && Math.abs(p[0]) < xIn;
  // a skin point (nr: its outward normal) facing the other thigh (the thighs' medial faces, which in the bind pose curl under the crease toward the
  // midplane below the crotch) is the thigh's, whichever side of the septum's plane it lies; the perineum faces the floor
  const inPerineum = (p, nr) => { if (!inBox(p)) return false; const sd0 = p[0] >= 0 ? 1 : -1, sd = perinealSide(crease[sd0], p); if (sd === null) return true; if (nr && sd0 * nr[0] < -0.7) return false; return sd; };
  return { yPubLow, xIn, yCrotch: yCr, yHeldLo, crease, inBox, inPerineum };
}
// the region's surface: hm08's triangles whose centroid lies between yLo and yHi, arms excluded, subdivided (midpoint) `subdiv` times
export function regionMesh(B, yLo, yHi, subdiv = 1) {
  const P = B.pos, T = B.tri, nb = B.nb, R = B.region, ARM = new Set([3, 4, 5, 6]), N = skinNormals(B), map = new Map(), pos = [], nrmA = [], src = [], tri = [];
  const vid = v => { if (!map.has(v)) { map.set(v, pos.length / 3); pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); nrmA.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]); src.push(v); } return map.get(v); };
  for (let i = 0; i < T.length; i += 3) { const a = T[i], b = T[i + 1], c = T[i + 2]; if (a >= nb || b >= nb || c >= nb) continue; if (R && (ARM.has(R[a]) || ARM.has(R[b]) || ARM.has(R[c]))) continue;
    const yc = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3; if (yc < yLo || yc > yHi) continue; tri.push(vid(a), vid(b), vid(c)); }
  let M = { pos, nrm: nrmA, tri, src, par: src.map(() => null) };
  for (let k = 0; k < subdiv; k++) M = subdivide(M);
  // par[i] (iteration 3): a once-subdivided midpoint's hm08 edge [a, b] (its parents' hm08 ids): the vertex the person's own Loop level 1 puts on that edge
  // (lib/fx/body/subdiv.js), so the solve's skin can be written onto the subdivided body the render draws, not only onto hm08's 2-5 cm control mesh
  const par = M.par.map(q => q && M.src[q[0]] >= 0 && M.src[q[1]] >= 0 ? [M.src[q[0]], M.src[q[1]]] : null);
  return { pos: Float64Array.from(M.pos), nrm: Float64Array.from(M.nrm), tri: Uint32Array.from(M.tri), src: M.src, par, n: M.pos.length / 3 };
}
function subdivide(M) {
  const pos = M.pos.slice(), nr = M.nrm.slice(), src = M.src.slice(), par = (M.par || M.src.map(() => null)).slice(), mid = new Map(), tri = [];
  const m = (a, b) => { const k = a < b ? a * 1e7 + b : b * 1e7 + a; if (mid.has(k)) return mid.get(k); const i = pos.length / 3;
    for (let c = 0; c < 3; c++) pos.push((pos[a * 3 + c] + pos[b * 3 + c]) / 2); const n = [0, 1, 2].map(c => nr[a * 3 + c] + nr[b * 3 + c]), l = Math.hypot(...n) || 1; nr.push(n[0] / l, n[1] / l, n[2] / l); src.push(-1); par.push([a, b]); mid.set(k, i); return i; };
  for (let i = 0; i < M.tri.length; i += 3) { const a = M.tri[i], b = M.tri[i + 1], c = M.tri[i + 2], ab = m(a, b), bc = m(b, c), ca = m(c, a); tri.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca); }
  return { pos, nrm: nr, tri, src, par };
}
export function vertexAreas(pos, tri, n) { const A = new Float64Array(n); for (let i = 0; i < tri.length; i += 3) { const a = tri[i], b = tri[i + 1], c = tri[i + 2];
  const u = [pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]], v = [pos[c * 3] - pos[a * 3], pos[c * 3 + 1] - pos[a * 3 + 1], pos[c * 3 + 2] - pos[a * 3 + 2]];
  const ar = 0.5 * Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 3; A[a] += ar; A[b] += ar; A[c] += ar; } return A; }
export function adjacency(tri, n) { const S = Array.from({ length: n }, () => new Set()); for (let i = 0; i < tri.length; i += 3) { const a = tri[i], b = tri[i + 1], c = tri[i + 2]; S[a].add(b).add(c); S[b].add(a).add(c); S[c].add(a).add(b); } return S.map(s => [...s]); }
// the screened Poisson problem on the surface graph: (sum_j w_ij (phi_i - phi_j) + A_i / l^2 phi_i) = A_i f_i, phi = 0 where pinned; w_ij = 1 / |e|^2
// x the mean area (a graph Laplacian for a near-even mesh); conjugate gradients
function screenedPoisson(pos, adj, A, f, pinned, l, iters = 600, tol = 1e-7) {
  const n = A.length, W = adj.map((nb, i) => nb.map(j => { const d2 = (pos[i * 3] - pos[j * 3]) ** 2 + (pos[i * 3 + 1] - pos[j * 3 + 1]) ** 2 + (pos[i * 3 + 2] - pos[j * 3 + 2]) ** 2; return (A[i] + A[j]) / 2 / Math.max(1e-8, d2); }));
  const free = i => !pinned[i], mv = (x, y) => { for (let i = 0; i < n; i++) { if (!free(i)) { y[i] = x[i]; continue; } let s = A[i] / (l * l) * x[i]; const nb = adj[i], w = W[i]; for (let k = 0; k < nb.length; k++) { const j = nb[k]; s += w[k] * (x[i] - (free(j) ? x[j] : 0)); } y[i] = s; } };
  const x = new Float64Array(n), b = new Float64Array(n); for (let i = 0; i < n; i++) b[i] = free(i) ? A[i] * f[i] : 0;
  const r = Float64Array.from(b), p = Float64Array.from(r), Ap = new Float64Array(n); let rr = 0; for (let i = 0; i < n; i++) rr += r[i] * r[i]; const r0 = Math.sqrt(rr) || 1;
  let it = 0; for (; it < iters && Math.sqrt(rr) / r0 > tol; it++) { mv(p, Ap); let pAp = 0; for (let i = 0; i < n; i++) pAp += p[i] * Ap[i]; const a = rr / pAp; let rr1 = 0;
    for (let i = 0; i < n; i++) { x[i] += a * p[i]; r[i] -= a * Ap[i]; rr1 += r[i] * r[i]; } const bta = rr1 / rr; rr = rr1; for (let i = 0; i < n; i++) p[i] = r[i] + bta * p[i]; }
  for (let i = 0; i < n; i++) if (!free(i)) x[i] = 0; return { x, it, res: Math.sqrt(rr) / r0 };
}
const sstep = (e0, e1, x) => ss((x - e0) / (e1 - e0));
// distance from a point to a polyline
function distPoly(p, L) { let best = Infinity; for (let i = 0; i + 1 < L.length; i++) { const a = L[i], b = L[i + 1], ab = sub(b, a), t = clamp(dot(sub(p, a), ab) / Math.max(1e-12, dot(ab, ab)), 0, 1); best = Math.min(best, len(sub(p, mad(a, ab, t)))); } if (L.length === 1) best = len(sub(p, L[0])); return best; }

export function buildPelvisFat(B, K, deepParts, lines, opts = {}) {
  const t0 = Date.now(), sx = B.sex === 'f' ? 'f' : 'm', P = K.pts, G = K.geo, info = {};
  // ---- the region: from the costal margin (the 10th rib's lowest point) to above the KNEE (v4; v3 cut at mid-thigh). At a mid-thigh cut the region's
  //      thigh (muscles + the layer) met the body's thigh skin 1-2 cm apart and the 3 cm seam blend made a step there: the merged render's 'saddlebag'
  //      ends exactly at mid-thigh (15 Oct). Above the knee the femur's condyles, the quadriceps tendon and the vasti's lower bellies lie close under a
  //      thin layer (the legs' mean): there the anatomy and the body agree, so that is where the region joins the body. opts.cutT: the cut as a
  //      fraction of the femur from the neck's base to the knee's centre.
  const FL = G.femL, FR = G.femR, dn = F => mul(F.sdir, -1), Lsh = F => dot(sub(F.K, F.Pn), dn(F)), midT = F => mad(F.Pn, dn(F), (opts.cutT ?? 0.88) * Lsh(F));
  // (v9, lane iteration 18) THE REGION RUNS TO THE ANKLE: v4-v8 cut it above the knee (cutT 0.88 of the femur) and handed the leg back to the body before
  // there: the solved thigh met the old shank in a step above the knee (the orchestrator's 05:45 board: 'tree trunks on sticks'). The lower cut is now
  // 2.5 cm above the ankle joint, where the leg is bone, tendon and a thin layer in the anatomy and in the body before alike (opts.yLo overrides);
  // midT (cutT) remains the iliotibial tract's lower reference only.
  const AJy = ['L', 'R'].map(S_ => B.J?.['foot.' + S_]?.h?.[1]).filter(Number.isFinite);
  const yHi = Math.min(P.rib10L[1], P.rib10R[1]) + 0.01, yLo = opts.yLo ?? (AJy.length ? Math.max(...AJy) + 2.5 * CM : (midT(FL)[1] + midT(FR)[1]) / 2);
  const M = regionMesh(B, yLo, yHi, opts.subdiv ?? 1), n = M.n, X = M.pos, Nn = M.nrm;
  // the deep layer restricted to the parts near the region (sdParts over the whole body is ~0.3 ms a point)
  const box = [Infinity, yLo - 0.05, Infinity, -Infinity, yHi + 0.05, -Infinity]; for (let i = 0; i < n; i++) { box[0] = Math.min(box[0], X[i * 3] - 0.05); box[3] = Math.max(box[3], X[i * 3] + 0.05); box[2] = Math.min(box[2], X[i * 3 + 2] - 0.05); box[5] = Math.max(box[5], X[i * 3 + 2] + 0.05); }
  const parts = deepParts.filter(p => p.bb[0] < box[3] && p.bb[3] > box[0] && p.bb[1] < box[4] && p.bb[4] > box[1] && p.bb[2] < box[5] && p.bb[5] > box[2]);
  const D = { d: (x, y, z) => sdParts(parts, x, y, z, 0.12).d };
  info.parts = parts.length;
  // ---- held: the perineum and the external genitalia (not modelled here: the body before's surface kept), between the thighs' roots below the pubic
  //      body. (v7, lane iteration 15) ONLY the perineum: from the pubic tubercles down to 1 cm below the crotch (the lowest region vertex ON the
  //      midline FACING DOWN: the perineum's skin faces the floor; below it the skin at the midline is the two thighs' medial faces, facing each
  //      other: L08 ny -0.8..-1.0 down to 74 cm, |nx| 0.9-1.0 from 73 cm to 58 cm). v6 held every vertex within ~4.4 cm of the midline below the
  //      tubercles, and in the bind pose the inner thigh lies inside that band from the crotch to above the knee: the whole medial thigh was the body
  //      before's surface (the critic's 'plain convex wall', 15 Oct). Below the perineum the medial thigh is the region's own tissue (the adductors and
  //      gracilis its deep layer, the medialThigh depot its fat), and where the two thighs meet it is held apart by their CONTACT (7b below; the
  //      solve's colliders, index.js), not by a frozen surface.
  //      (v8, lane iteration 17) the perineum's lateral bound is the genitocrural crease (perineumOf above): the thighs' medial faces lateral of it
  //      are the region's own tissue up to the crease, where the genitocrural zone binds the skin (the hand-over a crease, not v7's horizontal seam)
  const PN = perineumOf(B, K), { yPubLow, xIn, yCrotch: yCr, yHeldLo } = PN, held = new Uint8Array(n), freed = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const p = [X[i * 3], X[i * 3 + 1], X[i * 3 + 2]]; if (PN.inPerineum(p, [Nn[i * 3], Nn[i * 3 + 1], Nn[i * 3 + 2]])) held[i] = 1; else if (PN.inBox(p)) freed[i] = 1; }
  info.perineum = { yCrotchCm: +(yCr * 100).toFixed(1), yHeldLoCm: +(yHeldLo * 100).toFixed(1), yPubLowCm: +(yPubLow * 100).toFixed(1), xInCm: +(xIn * 100).toFixed(1), held: held.reduce((a, b) => a + b, 0), freed: freed.reduce((a, b) => a + b, 0),
    crease: [1, -1].map(sd => ({ side: sd, skin: PN.crease[sd].skin.map(q => q.map(v => +(v * 100).toFixed(1))), depthCm: PN.crease[sd].depth.map(v => +(v * 100).toFixed(1)) })) };
  // ---- (1) the deep fascia under each vertex: inward along the skin normal (v6's tissue over the deep layer = h6, signed: < 0 a muscle through v6)
  const Q = new Float64Array(n * 3), Md = new Float64Array(n * 3), miss = []; let h6 = new Float64Array(n), through = 0;
  for (let i = 0; i < n; i++) {
    const x = [X[i * 3], X[i * 3 + 1], X[i * 3 + 2]], nn = [Nn[i * 3], Nn[i * 3 + 1], Nn[i * 3 + 2]]; let d0 = D.d(...x), t = 0, q = null;
    if (d0 <= 0) { for (let k = 0; k < 60 && D.d(...mad(x, nn, -t)) <= 0; k++) t -= 0.001; q = mad(x, nn, -t); through++; }
    else { for (let k = 0; k < 80 && t < 0.16; k++) { const d = D.d(...mad(x, nn, -t)); if (d < 0.0006) break; t += Math.max(0.0006, 0.9 * d); } q = t < 0.16 ? mad(x, nn, -t) : null; }
    if (!q) { // fallback: the nearest point (gradient steps from the skin)
      q = x.slice(); for (let k = 0; k < 6; k++) { const d = D.d(...q), e = 6e-4, g = nrm([D.d(q[0] + e, q[1], q[2]) - D.d(q[0] - e, q[1], q[2]), D.d(q[0], q[1] + e, q[2]) - D.d(q[0], q[1] - e, q[2]), D.d(q[0], q[1], q[2] + e) - D.d(q[0], q[1], q[2] - e)]); q = mad(q, g, -d); } miss.push(i); t = len(sub(x, q)); }
    Q[i * 3] = q[0]; Q[i * 3 + 1] = q[1]; Q[i * 3 + 2] = q[2]; h6[i] = t;
    const e = 6e-4, g = nrm([D.d(q[0] + e, q[1], q[2]) - D.d(q[0] - e, q[1], q[2]), D.d(q[0], q[1] + e, q[2]) - D.d(q[0], q[1] - e, q[2]), D.d(q[0], q[1], q[2] + e) - D.d(q[0], q[1], q[2] - e)]);
    const m = nrm(add(g, nn)); Md[i * 3] = m[0]; Md[i * 3 + 1] = m[1]; Md[i * 3 + 2] = m[2];
  }
  // ---- (1) THE DEEP FASCIA IS A TENSION MEMBRANE over the packed muscles (fat v10, lane iteration 21). It replaces two geometric stand-ins: v2's
  //      rolling ball (an erosion of the depth map by a 3 cm ball, the same everywhere) and v4's SLEEVE (1b: in each 1 cm horizontal section and on
  //      each side the convex hull of the deep points, the lift capped at the body before's skin less 3 mm). A convex hull per section cannot make a
  //      concavity (the popliteal fossa, the calf's cleft, the grooves beside the Achilles tendon) and a cap at the old skin has the body before in it
  //      (the critic's it3 (5); the orchestrator, 16 Oct ~16:00). THE MODEL: the fascia lata, the crural fascia and the trunk's investing fasciae
  //      are one membrane under a tension T per unit length, pressed onto the muscles by the pressure p of the layers over it (the subcutaneous fat
  //      and the skin's own tension over the limb); it may not enter bone or muscle (contact, unilateral) and where it lies on BONE it is fused to the
  //      periosteum (the tibia's medial face and anterior border, the patella, the condyles' epicondyles, the malleoli, the iliac crest, the sacrum
  //      and the pubis: standard anatomy, Standring 2016), except over the GREATER TROCHANTER, where the trochanteric bursa lets the iliotibial
  //      tract slide. At equilibrium (Laplace) a free span has curvature p / T, so over a groove of width w it sags w^2 p / 8 T: the membrane spans
  //      grooves narrower than ~T / p and follows wider ones. T = sigma x t (a common resting stress, so T / p scales with the fascia's
  //      THICKNESS t): the reference R0 = FASCIA_R (3 cm, the v2 ball's assumption) for the fascia lata and the crural fascia of ordinary
  //      thickness (~1 mm), and by zone (FASCIA_T): the iliotibial tract thick and taut, the fascia over the knee's front and sides thin
  //      and slack, the crural fascia over gastrocnemius thin, gluteus maximus' own (epimysial) fascia thin and bound to its fasciculi.
  //      Solved on the region's own mesh: each vertex moves only along the ray it was cast on (the parameterisation; the body before sets no
  //      depth: no cap), the tension from the membrane's own 3-D shape (the cotangent Laplacian of the fascia's surface), Gauss-Seidel to rest.
  //      What lies between the muscles and a spanning membrane is deep, non-subcutaneous tissue (septa, the femoral triangle's and the adductor
  //      canal's contents, intermuscular fat: the band's IMAT share), as before; the subcutaneous layers are built on the membrane.
  const h6raw = Float64Array.from(h6), bondT = new Uint8Array(n), Rb = new Float64Array(n).fill(FASCIA_R), zoneK = new Float64Array(n).fill(1);
  {
    const boneD = (x, y, z) => sdParts(K.parts, x, y, z, 0.06).d, yHJ0 = (FL.H[1] + FR.H[1]) / 2;
    const kJ = [FL, FR].map(F => mad(F.K, nrm(sub(F.K, F.H)), 1.7 * CM * F.kfm));
    const cA = ['L', 'R'].map((S_, k) => { const o = kJ[k], F = k ? FR : FL, Aj = B.J?.['foot.' + S_]?.h || mad(o, [0, -1, 0], 0.4), u = nrm(sub(Aj, o));
      return { o, u, a: nrm(sub(F.F.a, mul(u, dot(F.F.a, u)))), l: nrm(sub(F.F.l, mul(u, dot(F.F.l, u)))) }; });
    const zb = new Map(); for (let i = 0; i < n; i++) { const k = Math.round(X[i * 3 + 1] * 100), e = zb.get(k) || [0, 0]; e[0] += X[i * 3 + 2]; e[1]++; zb.set(k, e); }
    const zc0 = y => { const e = zb.get(Math.round(y * 100)); return e ? e[0] / e[1] : 0; }, crestY0 = s => Math.max(...G['pelvis' + (s > 0 ? 'L' : 'R')].crest.map(p => p[1]));
    const igf = lines.filter(l => /^infragluteal\./.test(l.name)).map(l => l.pts.reduce((m, p) => Math.min(m, p[1]), Infinity)), yIgf0 = igf.length ? Math.min(...igf) : yHJ0 - 0.08;
    for (let i = 0; i < n; i++) {
      const x = X[i * 3], y = X[i * 3 + 1], z = X[i * 3 + 2], s = x >= 0 ? 1 : -1, F = s > 0 ? FL : FR, kj = kJ[s > 0 ? 0 : 1], cx = cA[s > 0 ? 0 : 1], ax = Math.abs(x), p3 = [x, y, z];
      const thT = Math.atan2(ax, z - zc0(y)) * 180 / Math.PI, d = dn(F), c = mad(F.Pn, d, dot(sub(p3, F.Pn), d)), r = sub(p3, c);
      const l_ = nrm(sub(F.F.l, mul(d, dot(F.F.l, d)))), a_ = nrm(sub(F.F.a, mul(d, dot(F.F.a, d)))), thF = Math.atan2(dot(r, l_), dot(r, a_)) * 180 / Math.PI;
      const cc = mad(cx.o, cx.u, dot(sub(p3, cx.o), cx.u)), rc = sub(p3, cc), thC = Math.atan2(dot(rc, cx.l), dot(rc, cx.a)) * 180 / Math.PI, aC = Math.abs(thC);
      const hip = sstep(yHJ0, yHJ0 - 0.06, y), kneeZ = sstep(kj[1] - 0.08, kj[1] - 0.05, y) * (1 - sstep(kj[1] + 0.05, kj[1] + 0.08, y)), crusZ = 1 - sstep(kj[1] - 0.08, kj[1] - 0.05, y);
      const tract = hip * (1 - sstep(35, 55, Math.abs(thF - 90))) * (1 - sstep(F.gt[1] - 0.02, F.gt[1] + 0.02, y)) * sstep(kj[1] + 0.02, kj[1] + 0.06, y);
      const glut = ((1 - hip) * sstep(105, 125, thT) + hip * sstep(115, 135, Math.abs(thF))) * sstep(yIgf0 - 0.02, yIgf0, y) * (1 - sstep(crestY0(s) - 0.05, crestY0(s) - 0.02, y)) * sstep(0.008, 0.02, ax);
      const kneeFS = kneeZ * (1 - sstep(115, 135, aC)), calfB = crusZ * sstep(110, 130, aC) * sstep(kj[1] - 0.30, kj[1] - 0.22, y);
      let k = 1; k += (FASCIA_T.tract - k) * tract; k += (FASCIA_T.gluteusMaximus - k) * glut * (1 - tract); k += (FASCIA_T.knee - k) * kneeFS; k += (FASCIA_T.calf - k) * calfB;
      zoneK[i] = k; Rb[i] = FASCIA_R * k;
      // fused to the periosteum where the deep point is on bone (within 3 mm), not over the greater trochanter (the bursa)
      // the perineum: the PERINEAL MEMBRANE, a strong fibrous sheet stretched across the pubic arch between the ischiopubic rami (Standring 2016), taut
      if (held[i]) { zoneK[i] = FASCIA_T.perineum; Rb[i] = FASCIA_R * FASCIA_T.perineum; }
      // fused to the periosteum where the deep point is ON bone (within 3 mm) and the bone faces the skin there (a ray grazing a bone's edge is not a
      // subcutaneous bony surface); not over the greater trochanter (the bursa)
      const qx = Q[i * 3], qy = Q[i * 3 + 1], qz = Q[i * 3 + 2];
      if (!held[i] && boneD(qx, qy, qz) < 0.003 && len(sub([qx, qy, qz], F.gt)) > 0.05) { const e = 1e-3, gb = nrm([boneD(qx + e, qy, qz) - boneD(qx - e, qy, qz), boneD(qx, qy + e, qz) - boneD(qx, qy - e, qz), boneD(qx, qy, qz + e) - boneD(qx, qy, qz - e)]);
        if (dot(gb, [Nn[i * 3], Nn[i * 3 + 1], Nn[i * 3 + 2]]) > 0.8) bondT[i] = 2; }   // a candidate: bonded where the free membrane rests on that bone (below)
    }
  }
  const missS = new Set(miss);
  const fascia = (() => {
    // the region's top and bottom edges are cuts through a membrane that continues beyond them (a free edge: no vertex is fixed but the bonds)
    const T3 = M.tri, nT = T3.length / 3, fixedV = new Uint8Array(n);
    // the held perineum's skin is the body before's, but the fascia under it is the membrane's too (the perineal membrane spans the pubic arch
    // between the ischiopubic rami): it is solved with the rest, not fixed at the ray's depth (which runs into the pelvis there). A vertex whose ray
    // missed the deep layer (its depth the nearest deep point's distance) is solved along its ray like any other.
    const h = Float64Array.from(h6raw), P = new Float64Array(n * 3), setP = i => { P[i * 3] = X[i * 3] - Nn[i * 3] * h[i]; P[i * 3 + 1] = X[i * 3 + 1] - Nn[i * 3 + 1] * h[i]; P[i * 3 + 2] = X[i * 3 + 2] - Nn[i * 3 + 2] * h[i]; };
    for (let i = 0; i < n; i++) setP(i);
    let nbs = null, wts = null, Av = null;
    const weights = () => { const Wm = Array.from({ length: n }, () => new Map());
      for (let t = 0; t < nT; t++) { const v = [T3[t * 3], T3[t * 3 + 1], T3[t * 3 + 2]];
        for (let c = 0; c < 3; c++) { const o = v[c], a = v[(c + 1) % 3], b = v[(c + 2) % 3], ea = [P[a * 3] - P[o * 3], P[a * 3 + 1] - P[o * 3 + 1], P[a * 3 + 2] - P[o * 3 + 2]], eb = [P[b * 3] - P[o * 3], P[b * 3 + 1] - P[o * 3 + 1], P[b * 3 + 2] - P[o * 3 + 2]];
          const cr = len([ea[1] * eb[2] - ea[2] * eb[1], ea[2] * eb[0] - ea[0] * eb[2], ea[0] * eb[1] - ea[1] * eb[0]]), ct = Math.min(5, Math.max(0.02, dot(ea, eb) / Math.max(1e-12, cr)));
          Wm[a].set(b, (Wm[a].get(b) || 0) + ct); Wm[b].set(a, (Wm[b].get(a) || 0) + ct); } }
      nbs = Wm.map(m => Int32Array.from(m.keys())); wts = Wm.map(m => Float64Array.from(m.values())); Av = vertexAreas(P, T3, n); };
    let it = 0, dmax = 0, its = 0; const OMEGA = 1.5, ITERS = opts.fasciaIters ?? 1500;
    // two passes: the free membrane (contact only), then the periosteal bonds where it rests on bone (a candidate's free membrane within 1 cm of its
    // bone: a ray that slips past a bone's edge into the pelvis is no subcutaneous bony surface) and the membrane solved again from there
    for (let pass = 0; pass < 2; pass++) {
    if (pass === 1) for (let i = 0; i < n; i++) { if (bondT[i] === 2 && h6raw[i] - h[i] < 0.01) { bondT[i] = 1; fixedV[i] = 1; h[i] = h6raw[i]; setP(i); } else if (bondT[i] === 2) bondT[i] = 0; }
    for (it = 0; it < ITERS; it++) {
      if (it % 50 === 0) weights(); dmax = 0; its++;
      for (let i = 0; i < n; i++) { if (fixedV[i]) continue; const nb = nbs[i], w = wts[i]; let C = 0, S = 0; const xi = i * 3, dx = -Nn[xi], dy = -Nn[xi + 1], dz = -Nn[xi + 2];
        for (let k = 0; k < nb.length; k++) { const j = nb[k] * 3; S += w[k] * ((P[j] - X[xi]) * dx + (P[j + 1] - X[xi + 1]) * dy + (P[j + 2] - X[xi + 2]) * dz); C += w[k]; }
        if (!(C > 0)) continue; const hEq = (S + 2 * Av[i] / Rb[i]) / C, hn = Math.min(h6raw[i], h[i] + OMEGA * (hEq - h[i])), dh = Math.abs(hn - h[i]); if (dh > dmax) dmax = dh; h[i] = hn; setP(i); }
      if (it > 100 && dmax < 2e-6) break;
    }
    }
    return { h, it: its, dmaxMm: dmax * 1000, fixedV };
  })();
  let lifted = 0, liftMax = 0, fillV = 0; const Ah = vertexAreas(Q, M.tri, n), byZ = {};
  for (let i = 0; i < n; i++) { const lift = h6raw[i] - fascia.h[i]; if (lift > 0.002 || missS.has(i)) { lifted++; liftMax = Math.max(liftMax, lift); for (let c = 0; c < 3; c++) Q[i * 3 + c] = X[i * 3 + c] - Nn[i * 3 + c] * fascia.h[i]; Md[i * 3] = Nn[i * 3]; Md[i * 3 + 1] = Nn[i * 3 + 1]; Md[i * 3 + 2] = Nn[i * 3 + 2]; }
    if (lift > 0) fillV += Ah[i] * lift; h6[i] = fascia.h[i]; }
  info.fascia = { model: 'tension membrane (Laplace: curvature p / T), contact with bone and muscle, fused to the periosteum', R0cm: FASCIA_R * 100, zoneT: FASCIA_T, iters: fascia.it, restMm: +fascia.dmaxMm.toFixed(4),
    bonded: bondT.reduce((a, b) => a + b, 0), lifted, maxLiftMm: +(liftMax * 1000).toFixed(1), deepFillCm3: Math.round(fillV * 1e6) };
  if (opts.diag) { info.fasciaLift = Float64Array.from(h6raw, (v, i) => v - fascia.h[i]); info.fasciaK = zoneK; info.fasciaBond = bondT; info.h6raw = h6raw; }
  // ---- (1c) THE ILIOTIBIAL TRACT IS A TAUT LONGITUDINAL BAND (v5, lane iteration 10). The fascia lata's lateral thickening runs from the iliac
  //      tubercle over the greater trochanter (its fulcrum: the trochanteric bursa between) to the lateral tibial condyle (Gerdy's tubercle), under
  //      the tension of gluteus maximus and TFL (Standring 2016; Fairclough et al 2006, J Anat 208:309: the tract is anchored to the linea aspera by
  //      the lateral intermuscular septum and compresses vastus lateralis). A taut band between two bony anchors cannot bow outward between them: in
  //      the leg's frontal plane the deep layer under it lies on or inside the straight line from where it leaves the trochanter to where it reaches
  //      the knee; vastus lateralis bulges anterior and posterior of the band, never through it. v4 had no such member, so the bellies' lateral reach
  //      ran flat from the trochanter to two thirds of the thigh (L08: 6.7 cm off the hip-knee axis at t 26 cm against 6.8 at the trochanter) and the
  //      layer over it made the lobe below the trochanter the critic saw (15 Oct, job G). The line's two ends are the person's own deep layer at the
  //      trochanter and above the knee; nothing is sized to a number. The tract's width: the sector within ~35 deg of lateral about the hip-knee axis.
  const tract = { pushed: 0, maxMm: 0 };
  if (opts.tract !== false) {
    for (const [sd, Fm] of [[1, FL], [-1, FR]]) {
      const H = Fm.H, ax = sub(Fm.K, H), Lk = len(ax), u = mul(ax, 1 / Lk), la = nrm([-u[1] * sd, u[0] * sd, 0]), an = nrm(sub([0, 0, 1], mul(u, u[2])));
      const tOf = p => dot(sub(p, H), u), tG = tOf(Fm.gt), tCut = tOf(midT(Fm)), frame = i => { const r = [Q[i * 3] - H[0], Q[i * 3 + 1] - H[1], Q[i * 3 + 2] - H[2]], t = dot(r, u), o = dot(r, la), a = dot(r, an); return { t, o, ang: Math.atan2(o, a) * 180 / Math.PI }; };
      let oTop = -1, oBot = -1; for (let i = 0; i < n; i++) { if (held[i] || Math.sign(X[i * 3] || 1) !== sd) continue; const f = frame(i); if (Math.abs(f.ang - 90) > 35) continue;
        if (Math.abs(f.t - tG) < 0.01) oTop = Math.max(oTop, f.o); if (f.t > tCut - 0.04 && f.t < tCut - 0.01) oBot = Math.max(oBot, f.o); }
      if (!(oTop > 0 && oBot > 0)) continue; tract['line' + (sd > 0 ? 'L' : 'R')] = { topCm: +(oTop * 100).toFixed(1), botCm: +(oBot * 100).toFixed(1), tGcm: +(tG * 100).toFixed(1), tCutCm: +(tCut * 100).toFixed(1) };
      for (let i = 0; i < n; i++) { if (held[i] || Math.sign(X[i * 3] || 1) !== sd) continue; const f = frame(i); if (f.t <= tG || f.t >= tCut) continue;
        const w = 1 - sstep(35, 55, Math.abs(f.ang - 90)); if (w <= 0) continue; const oL = oTop + (oBot - oTop) * (f.t - tG) / (tCut - tG), ex = (f.o - oL) * w; if (ex <= 0) continue;
        for (let c = 0; c < 3; c++) Q[i * 3 + c] -= la[c] * ex; h6[i] += ex; tract.pushed++; tract.maxMm = Math.max(tract.maxMm, ex * 1000); } }
  }
  info.tract = { ...tract, maxMm: +tract.maxMm.toFixed(1) };
  const adj = adjacency(M.tri, n);
  for (let it = 0; it < 4; it++) { const C = Float64Array.from(Md); for (let i = 0; i < n; i++) { const a = [0, 0, 0]; for (const j of adj[i]) for (let c = 0; c < 3; c++) a[c] += Md[j * 3 + c]; const m = nrm(add(mul([Md[i * 3], Md[i * 3 + 1], Md[i * 3 + 2]], 2), a)); C[i * 3] = m[0]; C[i * 3 + 1] = m[1]; C[i * 3 + 2] = m[2]; } Md.set(C); }
  const A = vertexAreas(Q, M.tri, n);
  info.through = through; info.miss = miss.length;
  // ---- (2) the zones of adherence projected onto the deep fascia (from outside inward along each line's direction)
  const Dl = { d: (x, y, z) => D.d(x, y, z) };
  //      (lane iteration 17) a zone may carry its own ray per anchor (dirs, from: the genitocrural septum, from the ramus to its skin crease)
  const proj = lines.map(L => ({ ...L, deep: L.pts.map((p, j) => { const nn = L.dirs ? L.dirs[j] : L.dir(p), tt = dropOn(Dl, p, nn, 0.0005, { from: L.from ? L.from[j] : 0.25 }); return tt == null ? p.slice() : mad(p, nn, tt); }) }));
  const pinned = new Uint8Array(n), pinBy = new Int16Array(n).fill(-1), dAdh = new Float64Array(n).fill(Infinity), dAdhD = new Float64Array(n).fill(Infinity);
  const elen = new Float64Array(n); for (let i = 0; i < n; i++) { let s = 0; for (const j of adj[i]) s += Math.hypot(Q[i * 3] - Q[j * 3], Q[i * 3 + 1] - Q[j * 3 + 1], Q[i * 3 + 2] - Q[j * 3 + 2]); elen[i] = s / Math.max(1, adj[i].length); }
  for (let i = 0; i < n; i++) { const q = [Q[i * 3], Q[i * 3 + 1], Q[i * 3 + 2]];
    for (let k = 0; k < proj.length; k++) { const L = proj[k]; if (L.side && Math.sign(q[0] || 1) !== L.side && Math.abs(q[0]) > 0.01) continue; const d = Math.min(distPoly(q, L.deep), L.crease ? distPoly([X[i * 3], X[i * 3 + 1], X[i * 3 + 2]], L.crease.skin) : Infinity); if (d < dAdh[i]) dAdh[i] = d; if (L.binds !== 'sfs' && d < dAdhD[i]) dAdhD[i] = d; if (d < Math.max(L.width, 0.55 * elen[i]) && pinBy[i] < 0) { pinned[i] = 1; pinBy[i] = k; } } }
  for (let i = 0; i < n; i++) if (held[i]) pinned[i] = 1;
  // ---- (3) the anatomical coordinates: the trunk's angle (0 front, 90 lateral, 180 back), the thigh's angle about the femur (0 front, +90 lateral,
  //      +-180 back, -90 medial), the hip blend (0 above the hip joints, 1 six cm below)
  const yHJ = (FL.H[1] + FR.H[1]) / 2, zcBin = new Map(); for (let i = 0; i < n; i++) { const k = Math.round(X[i * 3 + 1] * 100); const e = zcBin.get(k) || [0, 0]; e[0] += X[i * 3 + 2]; e[1]++; zcBin.set(k, e); }
  const zc = y => { const e = zcBin.get(Math.round(y * 100)); return e ? e[0] / e[1] : 0; };
  const umbY = B.lm.omphalion[1], supY = lines.find(L => L.name === 'suprapubic').pts[0][1], crestY = s => { const c = G['pelvis' + (s > 0 ? 'L' : 'R')].crest; return Math.max(...c.map(p => p[1])); };
  const igfAt = (x, s) => { const L = lines.find(l => l.name === 'infragluteal.' + (s > 0 ? 'L' : 'R')).pts; const ax = Math.abs(x); if (ax <= Math.abs(L[0][0])) return L[0][1]; if (ax >= Math.abs(L[L.length - 1][0])) return L[L.length - 1][1]; for (let k = 1; k < L.length; k++) if (Math.abs(L[k][0]) >= ax) { const t = (ax - Math.abs(L[k - 1][0])) / (Math.abs(L[k][0]) - Math.abs(L[k - 1][0])); return L[k - 1][1] + t * (L[k][1] - L[k - 1][1]); } return L[0][1]; };
  const W = Object.fromEntries(Object.keys(DEPOTS).map(k => [k, new Float64Array(n)])), label = new Array(n).fill('');
  // (v9) the knee's joint line (1.7 cm below the rig's knee on the femur's axis: skeleton/build.js KJ) and the leg's axis (the joint line -> the ankle joint)
  const kneeJ = [FL, FR].map(F => mad(F.K, nrm(sub(F.K, F.H)), 1.7 * CM * F.kfm));
  const crusAx = ['L', 'R'].map((S_, k) => { const o = kneeJ[k], F = k ? FR : FL, A = B.J?.['foot.' + S_]?.h || mad(o, [0, -1, 0], 0.4), u = nrm(sub(A, o));
    return { o, u, a: nrm(sub(F.F.a, mul(u, dot(F.F.a, u)))), l: nrm(sub(F.F.l, mul(u, dot(F.F.l, u)))), A }; });
  for (let i = 0; i < n; i++) {
    const x = X[i * 3], y = X[i * 3 + 1], z = X[i * 3 + 2], s = x >= 0 ? 1 : -1, F = s > 0 ? FL : FR, ax = Math.abs(x);
    const thT = Math.atan2(ax, z - zc(y)) * 180 / Math.PI;
    const d = dn(F), tt = dot(sub([x, y, z], F.Pn), d), c = mad(F.Pn, d, tt), r = sub([x, y, z], c), l_ = nrm(sub(F.F.l, mul(d, dot(F.F.l, d)))), a_ = nrm(sub(F.F.a, mul(d, dot(F.F.a, d))));
    const thF = Math.atan2(dot(r, l_), dot(r, a_)) * 180 / Math.PI;   // + lateral, - medial
    const hip = sstep(yHJ, yHJ - 0.06, y), latT = sstep(45, 65, thT) * (1 - sstep(125, 145, thT)), latF = sstep(40, 60, thF) * (1 - sstep(125, 145, thF));
    const backT = sstep(105, 125, thT), backF = sstep(115, 135, Math.abs(thF)), medF = sstep(-35, -55, thF) * (1 - sstep(-140, -160, thF)), frontT = 1 - sstep(45, 65, thT), frontF = sstep(-50, -35, thF) * (1 - sstep(40, 60, thF));
    const cY = crestY(s), yIgf = igfAt(x, s);
    W.gluteal[i] = ((1 - hip) * backT + hip * backF) * sstep(yIgf - 0.005, yIgf + 0.01, y) * (1 - sstep(cY - 0.025, cY - 0.005, y)) * sstep(0.008, 0.02, ax);
    // (v4) the trochanteric depot lies OVER the trochanter and the hip (from the crest's flank down to a hand's width below the trochanter's top);
    // below it the lateral thigh is the thigh's ring (lateralThigh). v3 carried it to the region's cut at mid-thigh.
    const below = sstep(F.gt[1] - 0.10, F.gt[1] - 0.05, y);
    W.trochanteric[i] = ((1 - hip) * latT + hip * latF) * (1 - sstep(F.gt[1] + 0.03, F.gt[1] + 0.07, y)) * below;
    W.lateralThigh[i] = hip * latF * (1 - below);
    W.flank[i] = latT * sstep(cY - 0.01, cY + 0.02, y);
    W.lumbar[i] = sstep(145, 160, thT) * sstep(P['psis' + (s > 0 ? 'L' : 'R')][1], P['psis' + (s > 0 ? 'L' : 'R')][1] + 0.03, y);
    W.sacral[i] = sstep(150, 165, thT) * (1 - sstep(0.035, 0.05, ax)) * sstep(P.coccyxTip[1], P.coccyxTip[1] + 0.03, y) * (1 - sstep(P.psisL[1] + 0.01, P.psisL[1] + 0.03, y));
    W.lowerAbdomen[i] = frontT * (1 - hip) * sstep(supY, supY + 0.015, y) * (1 - sstep(umbY + 0.01, umbY + 0.03, y));
    W.upperAbdomen[i] = frontT * sstep(umbY + 0.01, umbY + 0.03, y);
    W.mons[i] = frontT * sstep(yPubLow - 0.005, yPubLow + 0.01, y) * (1 - sstep(supY - 0.005, supY + 0.01, y)) * (1 - sstep(xIn + 0.005, xIn + 0.02, ax));
    W.medialThigh[i] = hip * medF * (1 - sstep(yPubLow, yPubLow + 0.03, y));
    W.anteriorThigh[i] = hip * frontF * (1 - sstep(yPubLow + 0.02, yPubLow + 0.06, y));
    W.posteriorThigh[i] = hip * backF * (1 - sstep(yIgf - 0.01, yIgf + 0.005, y));
    // (v9) THE KNEE AND THE LEG: the thigh's ring fades out over the knee (from 10 to 5 cm above the joint line), the knee's zones from there to 5-9 cm
    // below it, the leg's below; round each, the angle about the leg's own axis (0 front, + lateral, - medial, +-180 back)
    const kj = kneeJ[s > 0 ? 0 : 1], cx = crusAx[s > 0 ? 0 : 1], thighZ = sstep(kj[1] + 0.05, kj[1] + 0.10, y), crusZ = 1 - sstep(kj[1] - 0.09, kj[1] - 0.05, y), kneeZ = (1 - thighZ) * (1 - crusZ);
    if (thighZ < 1) { for (const k of ['lateralThigh', 'medialThigh', 'anteriorThigh', 'posteriorThigh']) W[k][i] *= thighZ;
      const p3 = [x, y, z], cc = mad(cx.o, cx.u, dot(sub(p3, cx.o), cx.u)), rc = sub(p3, cc), thC = Math.atan2(dot(rc, cx.l), dot(rc, cx.a)) * 180 / Math.PI, aC = Math.abs(thC);
      W.kneeFront[i] = kneeZ * (1 - sstep(40, 60, aC));
      W.kneeLateral[i] = kneeZ * sstep(40, 60, thC) * (1 - sstep(120, 140, thC));
      W.kneeMedial[i] = kneeZ * sstep(-40, -60, thC) * (1 - sstep(-140, -160, thC)) * sstep(kj[1] - 0.03, kj[1] + 0.01, y);
      W.popliteal[i] = kneeZ * sstep(120, 140, aC);
      W.shin[i] = crusZ * sstep(-70, -50, thC) * (1 - sstep(110, 130, thC));
      W.medialCalf[i] = crusZ * sstep(-50, -70, thC) * (1 - sstep(-140, -160, thC));
      W.calf[i] = crusZ * sstep(115, 135, aC); }
    let best = 0; for (const k in W) if (W[k][i] > best) { best = W[k][i]; label[i] = k; }
  }
  // ---- (4) the volumes: the person's DXA band fat (NHANES), the bands on the person's skeleton
  const mass = (B.bmi ?? 22) * B.stature * B.stature, FMt = (B.pf ?? (sx === 'f' ? 0.28 : 0.18)) * mass, RF = regionalFat(sx, FMt, B.age, B.stature);
  const yP = Math.max(P.crestTopL[1], P.crestTopR[1]), yNeck = (B.lm.menton[1] + B.lm.suprasternale[1]) / 2, Ha = 0.2 * (yNeck - yP);
  const band = { A: [yP, yP + Ha], G: [yP - 3.5 * Ha, yP - 1.5 * Ha] };
  const Vb = { A: Math.max(0.05, RF.android - RF.abdVAT) * (1 - IMAT.A) * 1000 * ADIPOSE_PER_LIPID * 1e-6, G: RF.gynoid * (1 - IMAT.G) * 1000 * ADIPOSE_PER_LIPID * 1e-6 };   // m3
  const inB = (b, y) => y >= band[b][0] && y < band[b][1];
  // ---- (5) the superficial layer: SIGMA x the band's mean thickness, thinned to half at the zones of adherence; between and outside the bands the
  //      thickness is carried by height (linear between the bands' values, constant beyond)
  const adh = new Float64Array(n); for (let i = 0; i < n; i++) adh[i] = 0.5 + 0.5 * sstep(0.004, 0.03, dAdhD[i]);
  const area = b => { let a = 0, w = 0; for (let i = 0; i < n; i++) if (inB(b, X[i * 3 + 1]) && !held[i]) { a += A[i]; w += A[i] * adh[i]; } return { a, w }; };
  const aA = area('A'), aG = area('G'), sMean = { A: SIGMA[sx].A * Vb.A / Math.max(1e-6, aA.w), G: SIGMA[sx].G * Vb.G / Math.max(1e-6, aG.w) };
  const sAt = y => { const yA = (band.A[0] + band.A[1]) / 2, yG = (band.G[0] + band.G[1]) / 2; return y >= yA ? sMean.A : y <= yG ? sMean.G : sMean.G + (sMean.A - sMean.G) * (y - yG) / (yA - yG); };
  const sL = new Float64Array(n); for (let i = 0; i < n; i++) sL[i] = held[i] ? 0 : sAt(X[i * 3 + 1]) * adh[i];
  // ---- (6) the deep layer: one screened Poisson field per group, the amplitudes fitted to the bands' remaining volume (a 2 x 2 solve)
  const fG = new Float64Array(n), fA = new Float64Array(n); for (let i = 0; i < n; i++) for (const k in DEPOTS) { const w = W[k][i] * DEPOTS[k][sx]; if (DEPOTS[k].g === 'G') fG[i] += w; else fA[i] += w; }
  // (v6, lane iteration 11) the screening length is the band's OWN mean layer thickness, not 6 cm: a zone of adherence binds the skin along a band
  // ~1-2 cm wide and the fat beside it rises to its compartment's depth over about the layer's own thickness (the same membrane length as (6c)); at
  // 6 cm every line drained the deep layer a hand's breadth round it (the lateral gluteal zone emptied the trochanteric depot, iteration 11)
  const lenG = Math.max(0.01, Vb.G / Math.max(1e-6, aG.a)), lenA = Math.max(0.01, Vb.A / Math.max(1e-6, aA.a));
  const solG = screenedPoisson(Q, adj, A, fG, pinned, lenG), solA = screenedPoisson(Q, adj, A, fA, pinned, lenA); info.screenMm = { G: +(lenG * 1000).toFixed(1), A: +(lenA * 1000).toFixed(1) };
  const integ = (phi, b) => { let s = 0; for (let i = 0; i < n; i++) if (inB(b, X[i * 3 + 1])) s += phi[i] * A[i]; return s; };
  const restA = (1 - SIGMA[sx].A) * Vb.A, restG = (1 - SIGMA[sx].G) * Vb.G;
  const m11 = integ(solA.x, 'A'), m12 = integ(solG.x, 'A'), m21 = integ(solA.x, 'G'), m22 = integ(solG.x, 'G'), det = m11 * m22 - m12 * m21;
  let aAmp = (restA * m22 - m12 * restG) / det, gAmp = (m11 * restG - m21 * restA) / det;
  if (!(aAmp > 0)) { aAmp = 0; gAmp = restG / Math.max(1e-12, m22); } if (!(gAmp > 0)) { gAmp = 0; aAmp = restA / Math.max(1e-12, m11); }
  const tD = new Float64Array(n), tG = new Float64Array(n), tA = new Float64Array(n); for (let i = 0; i < n; i++) { tA[i] = aAmp * solA.x[i]; tG[i] = gAmp * solG.x[i]; tD[i] = tA[i] + tG[i]; }
  // ---- (6b) THE VOLUME CHAIN (iteration 2): three accounting errors of the first build corrected
  //      (no shape target: each is how the input volume is laid on the person's own deep layer):
  //   (i) the HELD strip (the perineum and the inner thigh's root, v6 kept) is part of the DXA band: v1 spread the band's whole fat over the rest of the band
  //       (27 % of the gynoid band's deep area is held in L08). v2: the strip keeps v6's own tissue (h6 - dermis over our deep layer), and only the
  //       REMAINDER of the band's fat is built on the free region;
  //  (ii) the SHELL's volume: a layer of thickness T over a convex deep surface holds more than A x T (a cylinder of radius r: A T (1 + T / 2 r): +25 % at
  //       the thigh for 3 cm over 6 cm); v1 counted prisms, so it laid 15-25 % too much on the thigh, the hip and the buttock. v2 counts each vertex's
  //       FRUSTUM (deep area A, outer area A' at the envelope: T (A + A' + sqrt(A A')) / 3) and refits the amplitudes to it (fixed point, 4 passes);
  //  (iii) the SEAM: the region joins v6's body at its cuts (the costal margin, mid-thigh) and at the held strip; v1 jumped there by the model's whole
  //       thickness. v2 blends the layer to v6's own tissue over BLEND (3 cm) from the cuts and the strip (the boundary condition of a region within a body),
  //       the blend's tissue counted in the band's budget.
  let v2 = null;
  {
    const BLEND = opts.blend ?? 0.03, h6t = new Float64Array(n), bl = new Float64Array(n), edgeV = new Uint8Array(n), ecnt = new Map();
    for (let i = 0; i < n; i++) h6t[i] = Math.max(0, h6[i] - SKIN[sx]);   // v6's tissue over OUR deep fascia (the bridged one the layer is built on)
    for (let k = 0; k < M.tri.length; k += 3) for (const [a, b] of [[M.tri[k], M.tri[k + 1]], [M.tri[k + 1], M.tri[k + 2]], [M.tri[k + 2], M.tri[k]]]) { const key = a < b ? a * 1e7 + b : b * 1e7 + a; ecnt.set(key, (ecnt.get(key) || 0) + 1); }
    for (const [key, c] of ecnt) if (c === 1) { edgeV[Math.floor(key / 1e7)] = 1; edgeV[key % 1e7] = 1; }
    // the blend: distance (through the surface graph, Dijkstra on edge lengths of v6's skin) from the cuts' edges and the held strip
    const dist = new Float64Array(n).fill(Infinity), heap = []; const push = (d, i) => { heap.push([d, i]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
    for (let i = 0; i < n; i++) if (held[i] || (edgeV[i] && !held[i])) { dist[i] = 0; push(0, i); }
    while (heap.length) { const [d, i] = pop(); if (d > dist[i]) continue; for (const j of adj[i]) { const e = Math.hypot(X[i * 3] - X[j * 3], X[i * 3 + 1] - X[j * 3 + 1], X[i * 3 + 2] - X[j * 3 + 2]), nd = d + e; if (nd < dist[j]) { dist[j] = nd; push(nd, j); } } }
    for (let i = 0; i < n; i++) bl[i] = held[i] ? 1 : 1 - sstep(0, BLEND, dist[i]);
    // (i) the held strip's own tissue in each band; the free budget
    const heldV = { A: 0, G: 0 }; for (let i = 0; i < n; i++) if (held[i]) for (const b of ['A', 'G']) if (inB(b, X[i * 3 + 1])) heldV[b] += A[i] * h6t[i];
    const Vfree = { A: Math.max(0.1 * Vb.A, Vb.A - heldV.A), G: Math.max(0.1 * Vb.G, Vb.G - heldV.G) };
    // (v4) THE WHOLE REGION, BUDGETED AT EVERY HEIGHT. v3 fitted two amplitudes to the android and gynoid WINDOWS only, and the depots' fields carried
    //      those amplitudes on, unbudgeted, to the region's cuts: about half the region's fat lay outside both windows (L08: 8172 cm3 built, 4026 budgeted),
    //      most of it the trochanteric field running down the lateral thigh to mid-thigh (the merged render's saddlebags, 15 Oct). Now every height
    //      of the region has a budget: the windows' own (NHANES android / gynoid, as before) and, below the gynoid window, the LEGS' DXA segment (NHANES
    //      legs fat; its subcutaneous adipose over the legs' skin area is the legs' mean layer, reached at the knee). The mean thickness at a height,
    //      tbar(y), runs linearly between the windows' centres and the knee; ROUND each height, the depots only MODULATE the layer: the one screened
    //      Poisson field (all depots, pinned at the zones of adherence) divided by its own mean round that height and side. So the depots decide
    //      WHERE round the body the fat lies (the gynoid hip, the buttock, the thin lines of adherence), the budget decides HOW MUCH at each height;
    //      no depot can pile up outside a budget. No shape and no width is fitted anywhere: the inputs are NHANES' regional fat masses.
    const LFP = legFatProfile(B, K), Aleg = LFP.Aleg, Vleg = LFP.Vleg, tLeg = LFP.tLeg;
    const yAc = (band.A[0] + band.A[1]) / 2, yGc = (band.G[0] + band.G[1]) / 2, yK = (FL.K[1] + FR.K[1]) / 2;
    // (v6, lane iteration 11) THE WINDOWS' BUDGETS ARE TOTALS, NOT PROFILES. v4-v5 ran the mean layer as a TENT between the windows' CENTRES, so the
    //      thickest ring of the whole region sat at the gynoid window's centre, 6-8 cm below the trochanter, whatever the depots said: the lobe below
    //      the trochanter the critic saw in G and the step at t 8-12 cm (iteration 10's node outline). A DXA window measures how much fat lies within
    //      it, not where within it; so the window's budget is now level across the window (and between the windows, and down to the knee, carried
    //      linearly between the windows' EDGES), and the depots decide where the fat lies in height too: see `mod` below.
    // (v9, lane iteration 18) DOWN THE LIMB: v6-v8 ran the layer from the gynoid window's level to the legs' mean at the knee and held it there (the
    //      region ended above the knee). The legs' DXA fat is now laid down the WHOLE limb by the sites' relative thickness (LEG_PROFILE: mid-thigh 1,
    //      the knee's joint line, the calf's widest, the ankle; linear between): mL, the front-thigh level, is the legs' mean over the profile's own
    //      area-weighted mean on the legs' skin (so the legs' total is NHANES' as before); from the gynoid window's lower edge the layer runs to mL at
    //      mid-thigh. Nothing is sized to a girth: the inputs are the person's DXA legs fat and the sites' ratios.
    const LP = LFP.LP, yMidT = LFP.yMidT, yJn = LFP.yJn, yCf = LFP.yCf, yAn = LFP.yAn, rel = LFP.rel, mL = LFP.mL, relA = LFP.meanRel * Aleg;
    info.legProfile = { mLmm: +(mL * 1000).toFixed(1), tLegMm: +(tLeg * 1000).toFixed(1), meanRel: +(relA / Math.max(1e-6, Aleg)).toFixed(3), yMidCm: +(yMidT * 100).toFixed(1), yKneeCm: +(yJn * 100).toFixed(1), yCalfCm: +(yCf * 100).toFixed(1), yAnkleCm: +(yAn * 100).toFixed(1), ...LP };
    const tbar = (y, mA, mG) => y >= band.A[0] ? mA : y >= band.G[1] ? mG + (mA - mG) * (y - band.G[1]) / (band.A[0] - band.G[1]) : y >= band.G[0] ? mG
      : y >= yMidT && band.G[0] > yMidT ? mL + (mG - mL) * (y - yMidT) / (band.G[0] - yMidT) : mL * rel(y);
    const sig = y => y >= yAc ? SIGMA[sx].A : y <= yGc ? SIGMA[sx].G : SIGMA[sx].G + (SIGMA[sx].A - SIGMA[sx].G) * (y - yGc) / (yAc - yGc);
    // the modulation: phi round each height and side, normalised by its area-weighted mean there (5 mm bins, smoothed over 1.5 cm)
    const phi = new Float64Array(n); for (let i = 0; i < n; i++) phi[i] = solA.x[i] + solG.x[i];
    const BIN = 0.005, y0b = yLo - 0.05, nB = Math.ceil((yHi - yLo + 0.1) / BIN) + 1, acc = { 1: [new Float64Array(nB), new Float64Array(nB), new Float64Array(nB)], [-1]: [new Float64Array(nB), new Float64Array(nB), new Float64Array(nB)] };
    const binOf = y => Math.max(0, Math.min(nB - 1, Math.round((y - y0b) / BIN)));
    for (let i = 0; i < n; i++) { if (held[i]) continue; const sd = X[i * 3] >= 0 ? 1 : -1, k = binOf(X[i * 3 + 1]), r = acc[sd]; r[0][k] += A[i]; r[1][k] += A[i] * phi[i]; r[2][k] += A[i] * adh[i]; }
    const smooth = (num, den) => { const out = new Float64Array(nB), SG = 0.015 / BIN, R = Math.ceil(3 * SG); for (let k = 0; k < nB; k++) { let u = 0, w = 0; for (let j = Math.max(0, k - R); j <= Math.min(nB - 1, k + R); j++) { const g = Math.exp(-0.5 * ((j - k) / SG) ** 2); u += g * num[j]; w += g * den[j]; } out[k] = w > 0 ? u / w : 0; } return out; };
    // (v6) the depots' field is normalised by its ring mean smoothed at the WINDOW's scale (Ha, the DXA windows' own unit), not at 1.5 cm: the
    //      budget holds the fat's total at the scale the measurement resolves; below that scale the depots' propensities (the gynoid hip and buttock
    //      over the thigh's ring, the thin lines of adherence) set how the layer varies in height as well as round the body. Nothing is fitted.
    const smoothL = (num, den, sgM) => { const out = new Float64Array(nB), SG = sgM / BIN, R = Math.ceil(3 * SG); for (let k = 0; k < nB; k++) { let u = 0, w = 0; for (let j = Math.max(0, k - R); j <= Math.min(nB - 1, k + R); j++) { const g = Math.exp(-0.5 * ((j - k) / SG) ** 2); u += g * num[j]; w += g * den[j]; } out[k] = w > 0 ? u / w : 0; } return out; };
    const mPhi = { 1: smoothL(acc[1][1], acc[1][0], Ha), [-1]: smoothL(acc[-1][1], acc[-1][0], Ha) }, mAdh = { 1: smooth(acc[1][2], acc[1][0]), [-1]: smooth(acc[-1][2], acc[-1][0]) };
    const mod = new Float64Array(n), supN = new Float64Array(n);
    for (let i = 0; i < n; i++) { if (held[i]) continue; const sd = X[i * 3] >= 0 ? 1 : -1, k = binOf(X[i * 3 + 1]), mp = mPhi[sd][k], ma = mAdh[sd][k]; mod[i] = mp > 1e-12 ? phi[i] / mp : 1; supN[i] = ma > 1e-9 ? adh[i] / ma : 1; }
    const s2 = new Float64Array(n), T2 = new Float64Array(n), E2 = new Float64Array(n * 3);
    const lay = (mA, mG) => { for (let i = 0; i < n; i++) { if (held[i]) { s2[i] = 0; T2[i] = 0; continue; } const y = X[i * 3 + 1], tb = tbar(y, mA, mG), sg = sig(y), sup = tb * sg * supN[i], tot = sup + tb * (1 - sg) * mod[i];
        T2[i] = (1 - bl[i]) * tot + bl[i] * h6t[i]; s2[i] = Math.min(T2[i], sup); } };
    // the windows' means fitted to their budgets (frustum volumes, fixed point); the legs' mean is the segment's own
    const aF = b => { let a = 0; for (let i = 0; i < n; i++) if (!held[i] && inB(b, X[i * 3 + 1])) a += A[i]; return a; };
    let mA = Vfree.A / Math.max(1e-6, aF('A')), mG = Vfree.G / Math.max(1e-6, aF('G')), fit = null;
    for (let pass = 0; pass < 6; pass++) {
      lay(mA, mG); for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) E2[i * 3 + c] = Q[i * 3 + c] + Md[i * 3 + c] * T2[i];
      const Ao = vertexAreas(E2, M.tri, n), fv = { A: 0, G: 0 }, all = { v: 0 };
      for (let i = 0; i < n; i++) { if (held[i]) continue; const f = T2[i] * (A[i] + Ao[i] + Math.sqrt(A[i] * Ao[i])) / 3; all.v += f; for (const b of ['A', 'G']) if (inB(b, X[i * 3 + 1])) fv[b] += f; }
      fit = { pass, meanMm: { A: +(mA * 1000).toFixed(1), G: +(mG * 1000).toFixed(1), leg: +(tLeg * 1000).toFixed(1) }, frustumCm3: { A: Math.round(fv.A * 1e6), G: Math.round(fv.G * 1e6), region: Math.round(all.v * 1e6) }, legs: { adiposeCm3: Math.round(Vleg * 1e6), skinCm2: Math.round(Aleg * 1e4) } };
      if (pass < 5) { mA *= Vfree.A / Math.max(1e-9, fv.A); mG *= Vfree.G / Math.max(1e-9, fv.G); }
    }
    const a2 = [mA, mG], sM2 = { A: SIGMA[sx].A * mA, G: SIGMA[sx].G * mG };
    v2 = { BLEND, bl, h6t, s2, T2, amp: a2, heldV, Vfree, sM2, fit, dist };
  }
  // ---- (6c) THE SKIN IS THE FAT'S OUTER SURFACE (v5, lane iteration 10). v4 laid the layer at a thickness along each deep point's normal, so the
  //      outer surface carried every groove and ridge of the muscles beneath at full depth (job G: a bodybuilder's quadriceps on a woman's thigh,
  //      the adductor gully, a polygonal section). In the body the DEEP layer's large, loose lobules (Markman and Barton 1987) are a near-incompressible,
  //      shear-soft fill under the superficial fascia and the skin, both in tension: the fill flows from over the ridges into the grooves until the
  //      tensioned membrane is smooth, and an elastic layer transmits the relief of its base only at wavelengths long against its own thickness. So the
  //      outer surface is relaxed as a membrane over the layer: a diffusion of the outer surface along each vertex's fat direction whose length is the
  //      local layer's own thickness (relief narrower than ~2 T is bridged, broader relief stays), only the DEEP layer moving (the superficial layer's
  //      vertical septa keep it even: T never below s), the zones of adherence and the held strip fixed (their tethers make the folds), and the
  //      volume kept in every 1 cm ring a side (the fat moves round the ring; the budget at each height is NHANES' as before). Nothing is fitted.
  if (opts.drape !== false) {
    const T = v2.T2, S2 = v2.s2, T0 = Float64Array.from(T), fix = new Uint8Array(n); for (let i = 0; i < n; i++) fix[i] = held[i] || (pinned[i] && proj[pinBy[i]]?.binds !== 'sfs') || v2.bl[i] > 0.5 ? 1 : 0;
    const h2 = new Float64Array(n); for (let i = 0; i < n; i++) { let s = 0; for (const j of adj[i]) s += (X[i * 3] - X[j * 3]) ** 2 + (X[i * 3 + 1] - X[j * 3 + 1]) ** 2 + (X[i * 3 + 2] - X[j * 3 + 2]) ** 2; h2[i] = s / Math.max(1, adj[i].length); }
    const ell = i => opts.drapeK ?? 1.0;   // the length in units of the local thickness (the model's assumption, stated: ~1)
    let N = 1; for (let i = 0; i < n; i++) if (!fix[i]) N = Math.max(N, Math.ceil(2 * (ell(i) * T0[i]) ** 2 / (0.5 * h2[i])));
    N = Math.min(N, 400); const al = new Float64Array(n); for (let i = 0; i < n; i++) al[i] = fix[i] ? 0 : Math.min(0.5, 2 * (ell(i) * T0[i]) ** 2 / (N * h2[i])) * (1 - v2.bl[i]);
    // the relief: the deep surface against itself smoothed at the same length (rho > 0 a ridge, < 0 a groove); the outer height g = rho + T relaxed
    // at that length (a scalar diffusion: no shrinkage of the limb's own form, which rho's smooth part carries through unchanged); T' = g' - rho
    const Qs = Float64Array.from(Q), Cq = new Float64Array(n * 3);
    for (let it = 0; it < N; it++) { Cq.set(Qs); for (let i = 0; i < n; i++) { if (!al[i]) continue; const k = adj[i].length; for (let c = 0; c < 3; c++) { let m = 0; for (const j of adj[i]) m += Cq[j * 3 + c]; Qs[i * 3 + c] = Cq[i * 3 + c] + al[i] * (m / k - Cq[i * 3 + c]); } } }
    const rho = new Float64Array(n); for (let i = 0; i < n; i++) rho[i] = (Q[i * 3] - Qs[i * 3]) * Md[i * 3] + (Q[i * 3 + 1] - Qs[i * 3 + 1]) * Md[i * 3 + 1] + (Q[i * 3 + 2] - Qs[i * 3 + 2]) * Md[i * 3 + 2];
    const g = new Float64Array(n), Cg = new Float64Array(n); for (let i = 0; i < n; i++) g[i] = rho[i] + T[i];
    for (let it = 0; it < N; it++) { Cg.set(g); for (let i = 0; i < n; i++) { if (!al[i]) continue; let m = 0; for (const j of adj[i]) m += Cg[j]; g[i] = Cg[i] + al[i] * (m / adj[i].length - Cg[i]); } }
    for (let i = 0; i < n; i++) if (al[i]) T[i] = Math.max(S2[i], g[i] - rho[i]);
    // the volume kept in each 1 cm ring a side: the deep layer (T - s) rescaled where it moved
    const ring = new Map(), rk = i => (X[i * 3] >= 0 ? 1 : -1) * 100000 + Math.floor(X[i * 3 + 1] / 0.01);
    for (let i = 0; i < n; i++) { if (!al[i]) continue; const k = rk(i), e = ring.get(k) || [0, 0]; e[0] += A[i] * (T0[i] - S2[i]); e[1] += A[i] * (T[i] - S2[i]); ring.set(k, e); }
    let dmax = 0, dsum = 0, cnt = 0; for (let i = 0; i < n; i++) { if (!al[i]) continue; const e = ring.get(rk(i)), f = e[1] > 1e-9 ? e[0] / e[1] : 1; T[i] = S2[i] + (T[i] - S2[i]) * f; const d = Math.abs(T[i] - T0[i]); dmax = Math.max(dmax, d); dsum += d; cnt++; }
    info.drape = { iters: N, k: opts.drapeK ?? 1.0, moved: cnt, meanMm: +(1000 * dsum / Math.max(1, cnt)).toFixed(1), maxMm: +(1000 * dmax).toFixed(1) };
  }
  // ---- (7) the unloaded envelope (skin outer surface): deep point + normal x (superficial + deep + dermis); held vertices stay where v6 has them
  const skin = SKIN[sx], E = new Float64Array(n * 3);
  { for (let i = 0; i < n; i++) { const b = v2.bl[i]; for (let c = 0; c < 3; c++) E[i * 3 + c] = held[i] ? X[i * 3 + c] : (1 - b) * (Q[i * 3 + c] + Md[i * 3 + c] * (v2.T2[i] + skin)) + b * X[i * 3 + c]; }
    for (let i = 0; i < n; i++) { sL[i] = v2.s2[i]; const r = held[i] ? 0 : Math.max(0, v2.T2[i] - v2.s2[i]); const tot = tA[i] + tG[i]; tA[i] = tot > 0 ? r * tA[i] / tot : 0; tG[i] = r - tA[i]; tD[i] = r; } }
  // ---- (7b) THE THIGHS' CONTACT (v7, lane iteration 15). Below the perineum the two thighs are two bodies: each thigh's layer is built from its own
  //      deep layer outward, and where the thighs meet (in the bind pose of most women and some men, from the crotch to about mid-thigh: L08 within 6 mm
  //      of the midplane down to f ~0.45) each one's unloaded layer reaches the midplane or past it. Two soft bodies pressed together share a contact
  //      face; for a person symmetric about the midplane that face is the midplane itself (each thigh against the other is each thigh against a rigid
  //      wall there). The deep layer's fill is near-incompressible and shear-soft (6c): the fat a thigh would lay past the contact face is displaced
  //      round its own ring (the same 1 cm ring a side, the same rule as the drape), so the reference the solver loads starts on its own side, and the
  //      solve keeps it there under gravity (index.js: the other thigh as each skin's collider). `gap`: the contact face is resolved to the solver's
  //      grid (its cells may not span both thighs, so the face sits half a cell off the midplane each side: h / 2 + 0.5 mm, 3.5 mm at h 6 mm). Nothing
  //      here is a width or a shape: the contact's extent and the fat's displacement follow from the person's own pose and tissue.
  const gap = opts.contactGap ?? ((opts.h ?? 0.006) / 2 + 0.0005), contact = { gap, yTop: yHeldLo, clipped: 0, shifted: 0, movedCm3: 0, lostCm3: 0, maxClipMm: 0, rings: 0, bottomCm: null };
  if (Number.isFinite(yHeldLo)) {
    const inZone = i => !held[i] && (X[i * 3 + 1] < yHeldLo || freed[i]), sideOf = i => (X[i * 3] >= 0 ? 1 : -1), rk = i => sideOf(i) * 100000 + Math.floor(X[i * 3 + 1] / 0.01);
    const clipped = new Uint8Array(n);
    for (let pass = 0; pass < 3; pass++) {
      const rem = new Map(); let any = 0;
      for (let i = 0; i < n; i++) { if (!inZone(i)) continue; const s = sideOf(i), e = s * E[i * 3]; if (e >= gap - 1e-5) continue;
        const mdx = s * Md[i * 3], Tc = (E[i * 3] - Q[i * 3]) * Md[i * 3] + (E[i * 3 + 1] - Q[i * 3 + 1]) * Md[i * 3 + 1] + (E[i * 3 + 2] - Q[i * 3 + 2]) * Md[i * 3 + 2];
        let dT = 0;
        if (mdx < -0.2) { dT = Math.min(Math.max(0, Tc - skin), (gap - e) / -mdx); for (let c = 0; c < 3; c++) E[i * 3 + c] -= Md[i * 3 + c] * dT; }
        if (s * E[i * 3] < gap - 1e-5) { E[i * 3] = s * gap; contact.shifted++; }   // a normal along the face, or the deep layer itself at the face: the point slides onto it
        if (dT > 0) { const r = Math.min(dT, tD[i]); tD[i] -= r; sL[i] = Math.max(0, sL[i] - (dT - r)); const tot = tA[i] + tG[i]; if (tot > 0) { tA[i] = tD[i] * tA[i] / tot; tG[i] = tD[i] - tA[i]; }
          const k = rk(i); rem.set(k, (rem.get(k) || 0) + A[i] * dT); contact.maxClipMm = Math.max(contact.maxClipMm, dT * 1000); }
        if (!clipped[i]) { clipped[i] = 1; contact.clipped++; } any++; }
      if (!any) break;
      // the displaced fill round the ring: the ring's free deep layer thickens in proportion to its own depth (no vertex near the face receives)
      const cap = new Map(); for (let i = 0; i < n; i++) { if (!inZone(i) || clipped[i] || pinned[i] || v2.bl[i] > 0.5) continue; const k = rk(i); if (!rem.has(k)) continue; cap.set(k, (cap.get(k) || 0) + A[i] * Math.max(1e-4, tD[i])); }
      for (let i = 0; i < n; i++) { if (!inZone(i) || clipped[i] || pinned[i] || v2.bl[i] > 0.5) continue; const k = rk(i), V = rem.get(k), C = cap.get(k); if (!V || !C) continue;
        const dl = V * Math.max(1e-4, tD[i]) / C; for (let c = 0; c < 3; c++) E[i * 3 + c] += Md[i * 3 + c] * dl; tD[i] += dl; const tot = tA[i] + tG[i]; if (tot > 0) { tA[i] += dl * tA[i] / tot; tG[i] = tD[i] - tA[i]; } else tG[i] += dl; }
      for (const [k, V] of rem) { if (cap.get(k)) contact.movedCm3 += V * 1e6; else contact.lostCm3 += V * 1e6; } contact.rings = Math.max(contact.rings, rem.size);
    }
    let yb = Infinity; for (let i = 0; i < n; i++) if (clipped[i]) yb = Math.min(yb, X[i * 3 + 1]); contact.bottomCm = Number.isFinite(yb) ? +(yb * 100).toFixed(1) : null;
    contact.movedCm3 = +contact.movedCm3.toFixed(1); contact.lostCm3 = +contact.lostCm3.toFixed(1); contact.maxClipMm = +contact.maxClipMm.toFixed(1); contact.mask = clipped;
  }
  info.contact = { ...contact, mask: undefined, gapMm: +(gap * 1000).toFixed(1), yTopCm: Number.isFinite(yHeldLo) ? +(yHeldLo * 100).toFixed(1) : null };
  // ---- the volumes as built (prisms between the deep surface and the fat's outer face; v2: frustums), by band and by depot label
  const vol = { A: 0, G: 0, all: 0, byDepot: {} }, Aout = vertexAreas((() => { const P = new Float64Array(n * 3); for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) P[i * 3 + c] = Q[i * 3 + c] + Md[i * 3 + c] * (sL[i] + tD[i]); return P; })(), M.tri, n);
  for (let i = 0; i < n; i++) { if (held[i]) continue; const T = sL[i] + tD[i], v = T * (A[i] + Aout[i] + Math.sqrt(A[i] * Aout[i])) / 3; vol.all += v; if (inB('A', X[i * 3 + 1])) vol.A += v; if (inB('G', X[i * 3 + 1])) vol.G += v; const k = label[i] || 'none'; vol.byDepot[k] = (vol.byDepot[k] || 0) + v; }
  const v6b = { A: 0, G: 0 }; for (let i = 0; i < n; i++) { if (held[i]) continue; const v = A[i] * Math.max(0, h6[i] - skin); if (inB('A', X[i * 3 + 1])) v6b.A += v; if (inB('G', X[i * 3 + 1])) v6b.G += v; }
  const cm3 = v => +(v * 1e6).toFixed(0);
  info.ms = Date.now() - t0;
  return { version: PELVIS_FAT_VERSION, mesh: { pos: X, nrm: Nn, tri: M.tri, src: M.src, par: M.par, n, deep: Q, deepN: Md, area: A }, h6, s: sL, t: tD, tA, tG, label, W, pinned, pinBy, held, dAdh, dAdhD,
    lines: proj, envelope: E, region: { yLo, yHi }, bands: { ...band, Ha, yP, yNeck }, contact,
    input: { fatMassKg: +FMt.toFixed(2), nhanes: Object.fromEntries(Object.entries(RF).map(([k, v]) => [k, +v.toFixed(3)])), bandAdiposeCm3: { A: cm3(Vb.A), G: cm3(Vb.G) }, sigma: SIGMA[sx], rho: Object.fromEntries(Object.entries(DEPOTS).map(([k, d]) => [k, d[sx]])) },
    volumes: { A: cm3(vol.A), G: cm3(vol.G), all: cm3(vol.all), v6A: cm3(v6b.A), v6G: cm3(v6b.G), byDepot: Object.fromEntries(Object.entries(vol.byDepot).map(([k, v]) => [k, cm3(v)])) },
    info: { ...info, n, pinned: pinned.reduce((a, b) => a + b, 0), held: held.reduce((a, b) => a + b, 0), sMeanMm: { A: +(sMean.A * 1000).toFixed(1), G: +(sMean.G * 1000).toFixed(1) }, amp: { A: aAmp, G: gAmp }, cg: { A: [solA.it, solA.res], G: [solG.it, solG.res] },
      ...({ v2: { blendM: v2.BLEND, heldTissueCm3: { A: cm3(v2.heldV.A), G: cm3(v2.heldV.G) }, freeBudgetCm3: { A: cm3(v2.Vfree.A), G: cm3(v2.Vfree.G) }, sMeanMm: { A: +(v2.sM2.A * 1000).toFixed(1), G: +(v2.sM2.G * 1000).toFixed(1) }, amp: v2.amp, fit: v2.fit } }) },
    blend: v2.bl };
}
