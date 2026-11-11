// NOSE AND MOUTH (round 7 studio, 8 Oct): THE MOUTH BUILT AS ANATOMY: the lips as TISSUE layered on the teeth, never a lip-shaped sculpt.
// Pure JS (node or browser), no three.js; millimetres in the craniometric frame (skull/frame.js), on ANAT8-HEAD's skull (the teeth, the
// alveolar bone and the incisor display are ITS: skull.js; the lips rest on them). The mentalis and the chin's fat stay ANAT8-HEAD's until
// the seam moves them (NOTES).
//   const M = buildMouth(B, G, st, { params, sn, snSkin, alarBaseY, face })
//     B, G: the skull and its sampled bone field; st { name, sex, age, group }; o.params: mouth/params.js mouthParams(..); o.sn: the
//     columella's base on the lip (nose/index.js N.lm.sn0: the upper lip's tissue runs up to it); o.snSkin: the SKIN's subnasale (N.lm.sn:
//     where the columella's underside meets the lip's skin; the lip's rest length is counted from it, as Farkas measures it); o.alarBaseY:
//     the alar base's height
//   lipHull(B, G) -> the upper lip's sheet over the premaxilla in the midline profile (MOUTH 3): { bone(y), hull(y), fill(y) } (the nose
//     seats the columella's base on it)
//   M.parts      the SOLIDS (layer/sdf.js primitives, labelled head/common.js LBL: muscle 6, gland 12) by name: 'labial glands and mucosa
//                (upper|lower)', 'orbicularis oris, pars peripheralis (upper|lower)', 'orbicularis oris, pars marginalis (upper|lower)',
//                'philtral column'(_R), 'modiolus'(_R): ANAT8-HEAD's solve takes them with M.mats (they replace its orbicularis oris ring)
//   M.upper / M.lower   each lip's solid (a scene); M.envT(p) the envelope (subcutaneous + dermis over the cutaneous lip; the vermilion's
//                lamina propria + epithelium over the red lip: the mucocutaneous junction is a line, the VERMILION BORDER)
//   M.skin(x, y, z) the lips' outer surface (negative inside): the two lips' skins met by a hard min (the oral fissure's crease)
//   M.join(face) -> the face's field with the lips joined (wide blends into the cheeks and the chin; tight at the commissure, where the
//                corner tucks in at the modiolus)
//   M.curves     the vermilion borders (upper with the cupid's bow, lower), the stomion line, the philtral columns' crests, the commissures
//   M.lm         ls, sto, li, ch_L / ch_R, the modiolus' centre, sn (the lip's top); M.regions(p) -> { vermilion: 0..1, cutaneous, columns }
//                (SKIN OPTICS' and DETAIL7's inputs: where the red lip is, where the border runs)
// HOW IT IS BUILT, from the teeth out (sources in mouth/params.js):
//  1. THE BED: the teeth's and the alveolar bone's labial surface (the skull's), blurred over ~1.2 mm (the lips do not follow the
//     interdental gaps; the lower lip's on its own jaw). THE UPPER LIP IS A SHEET OVER THE PREMAXILLA'S HOLLOW (MOUTH 3, 16 Oct): the
//     cutaneous upper lip (the orbicularis' peripheral part in tone, the fat, the dermis) hangs from the nasal base (the columella's base
//     and the sills over the anterior nasal spine) and rests on the incisors' crowns; between those two supports it is a membrane in
//     tension and does not dip into the subspinale (A point) hollow of the premaxilla: the space under it is the lip's deep tissue (the
//     incisivus labii superioris and the depressor septi nasi at their origins in the incisive fossa, the deep fat, the vestibule's
//     fornix and the frenum). The bed under the upper lip is therefore the bone's profile with that hollow BRIDGED: in the midline the
//     upper hull of the bone from the spine's tip to the crowns (a tensioned membrane with no load behind it is straight between its
//     supports), carried across the arch by the arch's own recession, over the nasal base's width (the piriform breadth) only; where the
//     bone stands in front of it (the canine eminences) the bone is the bed. Until MOUTH 2 the lip's layers followed the blurred bone into
//     the hollow, so the skin at the lip's root stood only the lip's layers (8-10 mm) ahead of the deepest premaxilla and the subnasale
//     5-10 mm inside the face (ANAT8-HEAD's S10: the living soft tissue from the A point to the lip's drape is ~ 14-17 mm on the
//     radiograph, Holdaway 1983, AJO 84:1, the 'upper lip thickness near its base' ~ 15 mm, as recalled). The forensic mid-philtrum depth
//     (the 2023 T-Table, head/depths.js mph) is the CHECK (rep.built.mph), never the construction.
//     THE STOMION at the upper lip's end: its rest length from the SKIN's subnasale (Farkas' sn-sto is a surface distance; MOUTH 2 counted
//     it from the columella's base, which the skin's subnasale lies 2-5 mm under: the skin's lip came out that much short); the incisor
//     display at rest is the outcome, reported; the COMMISSURES on the
//     arch's outward normal at the canine-first premolar contact, cornerT out: the mouth's width and the corners' depth (their 'tuck') are
//     the dental arch's, not a width or a curve drawn for the mouth.
//  2. THE MUCOSA AND THE LABIAL GLANDS: a layer on the bed from the vestibule's depth to the lips' free margins.
//  3. THE ORBICULARIS ORIS, PERIPHERAL PART: a sheet on that layer, up to the nose's base (upper lip) and down to the mentolabial sulcus
//     (lower lip), thinning toward the modiolus.
//  4. THE ORBICULARIS ORIS, MARGINAL PART: a thick bundle along each lip's free margin, from modiolus to modiolus through the stomion line,
//     its section's top (upper lip) / bottom (lower lip) EVERTED forward (Latham and Deaton's curl): the vermilion's bulk and the border's
//     roll; its bulk largest at the midline (the tubercle), tapering to the corners where it enters the modiolus.
//  5. THE PHILTRAL COLUMNS: the peripheral fibres' decussating insertions into the dermis, two ridges from the columella's base (colW0
//     apart) to the bow's peaks (philW apart); the dimple between them has none: the philtrum is a groove because there is no muscle there.
//  6. THE MODIOLUS: a dense node on the buccinator lateral to each commissure, where every bundle ends.
//  7. THE ENVELOPE: subcutaneous fat + dermis over the cutaneous lips; the thin vermilion over the marginal part; the border where they
//     meet. The cupid's bow is the border's line at the columns' feet (bowH), the vermilion's height verU / verL the marginal part's.
import * as D from '../../layer/sdf.js';
import { mouthParams, MOUTH_TISSUE, MOUTH_PARAMS_VERSION } from './params.js';
export { mouthParams, MOUTH_TISSUE };
export const MOUTH_VERSION = 3;   // 3 (16 Oct, c4 it2): the upper lip a sheet over the premaxilla's hollow (lipHull); the stomion from the SKIN's subnasale. 2 (8 Oct): the stomion from the upper lip's rest length, the lower lip on its own jaw
const { v3 } = D, clamp = (x, a, b) => Math.min(b, Math.max(a, x)), lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const LBL_MUSCLE = 6, LBL_GLAND = 12, f1 = x => +(+x).toFixed(1), r1 = p => p.map(f1);
// the upper lip's outer tangent in profile (it lies on the premaxilla and the upper incisor): the nose's columella turns from it
export function lipTangent(B) { const lm = B.lm; return v3.norm(v3.sub(lm.UIE, [0, lm.A[1], lm.A[2] + 1.5])); }
// THE UPPER LIP'S SHEET OVER THE PREMAXILLA (MOUTH 3): the midline profile of the bone (marched from in front, 0.25 mm) from just above
// the anterior nasal spine down to the upper incisal edge, and its UPPER HULL (the straight line a tensioned membrane takes between the
// supports it rests on: the spine's tip above, the incisors' crowns below; a concave stretch of bone between them, the subspinale hollow,
// lies under the hull and is filled by the lip's deep tissue). bone(y), hull(y) (>= bone), fill(y) = hull - bone; crownY: the crowns'
// most forward height (where the arch's recession is read)
export function lipHull(B, G) {
  const lm = B.lm, y0 = lm.ANS[1] + 1.5, y1 = lm.UIE[1] - 0.5, pts = [];
  for (let y = y0; y >= y1 - 1e-9; y -= 0.25) { let t = 0; for (let k = 0; k < 700 && t < 220; k++) { const d = G.value(0, y, 160 - t); if (d < 0.03) { pts.push([y, 160 - t]); break; } t += Math.max(d * 0.85, 0.05); } }
  pts.sort((a, b) => a[0] - b[0]);   // by height, ascending
  const H = []; for (const p of pts) { while (H.length >= 2) { const o = H[H.length - 2], a = H[H.length - 1]; if ((a[0] - o[0]) * (p[1] - o[1]) - (a[1] - o[1]) * (p[0] - o[0]) >= 0) H.pop(); else break; } H.push(p); }
  const interp = (P, y) => { if (!P.length) return null; if (y <= P[0][0]) return P[0][1]; for (let i = 1; i < P.length; i++) if (y <= P[i][0]) { const a = P[i - 1], b = P[i], t = (y - a[0]) / ((b[0] - a[0]) || 1); return a[1] + (b[1] - a[1]) * t; } return P[P.length - 1][1]; };
  let crownY = lm.UIE[1] + 2, cz = -1e9; for (const p of pts) if (p[0] <= lm.UIE[1] + 9 && p[1] > cz) { cz = p[1]; crownY = p[0]; }
  const bone = y => interp(pts, y), hull = y => Math.max(interp(H, y), interp(pts, y));
  return { bone, hull, fill: y => (y > y0 || y < y1 ? 0 : hull(y) - bone(y)), y0, y1, crownY, support: H.map(p => [+p[0].toFixed(1), +p[1].toFixed(1)]) };
}
// the lips' BED: the first bone (tooth or alveolar bone) along -z, on a 2-D grid, blurred
// skip(x, y, z): a hard surface to pass through (the lower lip's bed: the upper incisors' crowns are not it)
function bedGrid(G, x0, x1, y0, y1, h = 0.5, sigma = 1.2, skip = null) {
  const nx = Math.round((x1 - x0) / h) + 1, ny = Math.round((y1 - y0) / h) + 1, Z = new Float32Array(nx * ny).fill(NaN);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const x = x0 + i * h, y = y0 + j * h; let t = 0;
    for (let k = 0; k < 700 && t < 220; k++) { const d = G.value(x, y, 160 - t); if (d < 0.03) { if (skip && skip(x, y, 160 - t)) { t += 0.4; continue; } Z[j * nx + i] = 160 - t; break; } t += Math.max(d * 0.85, 0.05); } }
  // fill holes from the nearest row value, then blur (separable Gaussian)
  for (let j = 0; j < ny; j++) { let last = NaN; for (let i = 0; i < nx; i++) { const v = Z[j * nx + i]; if (Number.isFinite(v)) last = v; else if (Number.isFinite(last)) Z[j * nx + i] = last; } for (let i = nx - 1; i >= 0; i--) { const v = Z[j * nx + i]; if (Number.isFinite(v)) last = v; else Z[j * nx + i] = last; } }
  const r = Math.ceil(2.5 * sigma / h), w = []; for (let k = -r; k <= r; k++) w.push(Math.exp(-0.5 * (k * h / sigma) ** 2)); const T = new Float32Array(Z.length);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { let s = 0, sw = 0; for (let k = -r; k <= r; k++) { const ii = i + k; if (ii < 0 || ii >= nx) continue; const v = Z[j * nx + ii]; if (!Number.isFinite(v)) continue; s += w[k + r] * v; sw += w[k + r]; } T[j * nx + i] = sw ? s / sw : NaN; }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { let s = 0, sw = 0; for (let k = -r; k <= r; k++) { const jj = j + k; if (jj < 0 || jj >= ny) continue; const v = T[jj * nx + i]; if (!Number.isFinite(v)) continue; s += w[k + r] * v; sw += w[k + r]; } Z[j * nx + i] = sw ? s / sw : NaN; }
  const at = (x, y) => { const fx = clamp((x - x0) / h, 0, nx - 1.001), fy = clamp((y - y0) / h, 0, ny - 1.001), i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, b = j * nx + i;
    return (1 - v) * ((1 - u) * Z[b] + u * Z[b + 1]) + v * ((1 - u) * Z[b + nx] + u * Z[b + nx + 1]); };
  return { at, nx, ny, h };
}

export function buildMouth(B, G, st, o = {}) {
  const t0 = Date.now(), lm = B.lm, K = B.K, P = o.params || mouthParams(st, o.paramOpts || {}), rep = { params: {} };
  for (const k of ['verU', 'verL', 'bowH', 'philW', 'colW0', 'colH', 'mgU', 'mgL', 'margB', 'margBL', 'periT', 'cornerT', 'modL', 'cornerLift', 'lipLen']) rep.params[k] = +(+P[k]).toFixed(2);
  const yANS = lm.ANS[1], sn = o.sn || [0, yANS - 1, lm.ANS[2] + 14], ySn = sn[1], yB = lm.B[1], snS = o.snSkin || sn;
  const bedU0 = bedGrid(G, -46, 46, yB - 8, yANS + 10).at;
  // THE SHEET OVER THE HOLLOW (MOUTH 3): the midline hull carried across the arch by the arch's recession at the crowns' height, over the
  // nasal base's width (the piriform breadth, tapering out to the alar bases); the bone where it stands in front (the canine eminences)
  const LH = lipHull(B, G), arch = x => bedU0(0, LH.crownY) - bedU0(x, LH.crownY), wBr = x => 1 - sstep(K.NLB / 2 + 1, K.NLB / 2 + 8, Math.abs(x));
  const bedU = (x, y) => { const b = bedU0(x, y); if (y > LH.y0 || y < LH.y1) return b; const w = wBr(x); return w > 0 ? b + w * Math.max(0, LH.hull(y) - arch(x) - b) : b; };
  let bz = bedU;
  // THE STOMION is the upper lip's end: lipLen (its rest length, sn-sto direct) from the SKIN's subnasale down the lip, whose front at the
  // stomion stands on the incisor by the glands, the marginal bundle and the vermilion (two passes: the lip's slope from the bed). Iteration 1
  // put it at the incisal edge + the display, so a long maxilla (ANAT8-HEAD's L08: ANS-UIE 32.7 mm) made a 25 mm lip; the lip's length is the
  // tissue's, and the bone's height shows as the incisor DISPLAY instead (reported: rep.built.display; vertical maxillary excess, Arnett and Bergman)
  let ySto = snS[1] - P.lipLen;
  for (let it = 0; it < 2; it++) { const zSto = bz(0, ySto) + P.mgU + 2 * P.margB - 0.25 + P.vermEnv, dz = snS[2] - zSto; ySto = snS[1] - Math.sqrt(Math.max(P.lipLen ** 2 - dz * dz, (0.8 * P.lipLen) ** 2)); }
  // THE LOWER LIP lies on its OWN jaw: the lower incisors' labial faces and their alveolus (the forensic li site's bone), and above the lower
  // incisal edge on the plane that face continues (it is not carried by the upper incisors' crowns: with a long maxilla they hang far
  // below the stomion, and a lower lip laid on them stood 3 mm AHEAD of the upper, the pout: L08 21:40; resting behind and under the upper
  // edges is the lip-trap posture of a long maxilla, the display reported for ANAT8-HEAD's skull, S5)
  const tU = B.parts?.teethU, yLIE = (lm.LIE?.[1] ?? lm.UIE[1] + 2.3) - 0.3;
  if (tU) { const bedL0 = bedGrid(G, -46, 46, yB - 8, ySto + 3, 0.5, 1.2, (x, y, z) => tU.d(x, y, z) < 0.45).at, bedL = (x, y) => bedL0(x, Math.min(y, yLIE));
    bz = (x, y) => lerp(bedL(x, y), bedU(x, y), sstep(ySto - 1.0, ySto + 1.0, y)); }
  const bed = { at: bz };
  // ---- 1. the commissure on the arch's outward normal at the canine-first premolar contact
  const uT = B.arch.upT, cpt = v3.lerp(uT[2].p, uT[3].p, 0.5), cn = v3.norm(v3.add(v3.norm([uT[2].n[0] + uT[3].n[0], 0, uT[2].n[2] + uT[3].n[2]]), [0.2, 0, 0]));   // the corner lies out and forward of the contact along the arch's normal (a little more lateral: the cheek's tissue)
  const chB = v3.add([cpt[0], ySto + P.cornerLift, bz(cpt[0], ySto)], v3.mul(cn, P.cornerT)), xCh = chB[0];
  // the modiolus: ~ modL lateral to the commissure along the cheek, a few mm deep to the skin (on the buccinator)
  const modC = v3.add(chB, [P.modL * 0.8, 0.8 + 0.5 * P.cornerLift, -P.modL * 0.42 - 5.5]);   // deep: on the buccinator under the cheek's fat
  // seated under the face's skin when the face is given (o.face: the node's front ~ 5 mm under the skin there; it raised a knob at the
  // corners where the cheek's skin stood less than its radius in front of it: L22 it1's stomion section)
  if (o.face) { let prev = o.face(modC[0], modC[1], 170), zs = null; for (let z = 169.5; z >= modC[2] - 30; z -= 0.5) { const f = o.face(modC[0], modC[1], z); if (f < 0 && prev >= 0) { zs = z; break; } prev = f; } if (zs != null) modC[2] = Math.min(modC[2], zs - 5.0 - 2.6); }
  // the bed's outward horizontal normal at (x, y) (the arch's plan curvature)
  const bn = (x, y) => { const dzdx = (bz(x + 0.5, y) - bz(x - 0.5, y)) / 1.0; return v3.norm([-dzdx, 0, 1]); };
  // ---- the vermilion borders' heights (upper: the cupid's bow, peaks at the columns' feet; lower: a smooth arc), tapering to the corner
  const fall = x => 1 - 0.78 * sstep(P.philW / 2 + 1.5, xCh, Math.abs(x));
  const hU = x => { const ax = Math.abs(x); return (P.verU + P.bowH * Math.exp(-(((ax - P.philW / 2) / 1.8) ** 2)) * (ax < P.philW / 2 ? 1 : 1) - 0.25 * P.bowH * Math.exp(-((ax / 1.4) ** 2))) * fall(x); };
  const hL = x => P.verL * (1 - 0.8 * sstep(3, xCh, Math.abs(x)));
  const yStoAt = x => ySto + P.cornerLift * sstep(0.3 * xCh, xCh, Math.abs(x)), yVBU = x => yStoAt(x) + hU(x), yVBL = x => yStoAt(x) - hL(x);
  // ---- 2. the mucosa and the glands (a height slab on the bed from the vestibule to the free margin)
  const mgT = (x, y) => (y >= ySto ? P.mgU : P.mgL) * lerp(1, 0.55, sstep(0.4 * xCh, xCh + 4, Math.abs(x)));
  const regMG = (lo, hi) => (x, y) => Math.max(Math.abs(x) - (xCh + 5), lo - y, y - hi);
  const mgUpper = D.heightSlab((x, y) => bz(x, y) + mgT(x, y), (x, y) => mgT(x, y), regMG(ySto - 0.4, ySn - 2), { k: 1.2, label: LBL_GLAND, name: 'labial glands and mucosa (upper)', aabb: [-(xCh + 7), ySto - 2, -40, xCh + 7, ySn, 160] });
  const mgLower = D.heightSlab((x, y) => bz(x, y) + mgT(x, y), (x, y) => mgT(x, y), regMG(yB - 1, ySto + 0.4), { k: 1.2, label: LBL_GLAND, name: 'labial glands and mucosa (lower)', aabb: [-(xCh + 7), yB - 3, -40, xCh + 7, ySto + 2, 160] });
  // ---- 3. the peripheral part (upper to the nose's base, lower to the mentolabial sulcus), thinning toward the modiolus
  const pT = x => P.periT * lerp(1, 0.6, sstep(0.5 * xCh, xCh + 6, Math.abs(x)));
  const topU = x => lerp(ySn - 0.8, (o.alarBaseY ?? ySn + 2) - 1.0, sstep(3, 14, Math.abs(x)));
  const periU = D.heightSlab((x, y) => bz(x, y) + mgT(x, y) + pT(x), x => pT(x), (x, y) => Math.max(Math.abs(x) - (xCh + 7), yVBU(x) - 1.8 - y, y - topU(x)), { k: 1.5, label: LBL_MUSCLE, name: 'orbicularis oris, pars peripheralis (upper)', aabb: [-(xCh + 9), ySto - 1, -40, xCh + 9, ySn + 6, 160] });
  const periL = D.heightSlab((x, y) => bz(x, y) + mgT(x, y) + pT(x), x => pT(x), (x, y) => Math.max(Math.abs(x) - (xCh + 7), y - (yVBL(x) + 1.8), yB + 1.5 - y), { k: 1.5, label: LBL_MUSCLE, name: 'orbicularis oris, pars peripheralis (lower)', aabb: [-(xCh + 9), yB - 2, -40, xCh + 9, ySto + 1, 160] });
  // ---- 4. the marginal part: a bundle along each free margin, modiolus to modiolus, its section everted (upper: top forward; lower:
  // bottom forward), bulkiest at the midline (the tubercle), entering the modiolus at the corners
  const xs = [0, 0.18, 0.36, 0.54, 0.7, 0.84, 0.95].map(t => t * xCh);
  const marg = (upper) => { const pts = [], secs = [], ups = [], B0 = upper ? P.margB : P.margBL;
    for (const x of xs) { const ax = Math.abs(x), b = B0 * lerp(1, P.margTaper, Math.pow(sstep(0, xCh, ax), 1.2)) * (1 + (upper ? 0.12 : 0.06) * Math.exp(-((ax / 4) ** 2)));
      const yTop = upper ? yVBU(x) + 0.35 : yStoAt(x), yBot = upper ? yStoAt(x) : yVBL(x) - 0.35, hh = Math.max(1.2, yTop - yBot), yc = upper ? yBot + 0.6 * hh : yBot + 0.5 * hh, a = upper ? [0.4 * hh, 0.6 * hh] : [0.5 * hh, 0.5 * hh];   // the upper marginal part's bulk high, under the border's roll; tapering to the free margin
      const n = bn(x, yc), c = v3.add([x, yc, bz(x, yc)], v3.mul(n, mgT(x, yc) + b - 0.25)); pts.push(c); secs.push({ a, b, n: 2.2 }); ups.push(v3.norm([0, 1, upper ? 0.32 : -0.3])); }
    const last = pts[pts.length - 1], into = v3.lerp(last, modC, 0.55); pts.push(into, modC); secs.push({ a: 1.8, b: 1.6, n: 2 }, { a: 2.2, b: 2.0, n: 2 }); ups.push([0, 1, 0], [0, 1, 0]);
    const L = pts.slice(1).reverse().map(p => [-p[0], p[1], p[2]]), Ls = secs.slice(1).reverse(), Lu = ups.slice(1).reverse();
    return D.sweep([...L, ...pts], [...Ls, ...secs], { up: [...Lu, ...ups], sub: 4, label: LBL_MUSCLE, name: `orbicularis oris, pars marginalis (${upper ? 'upper' : 'lower'})` }); };
  const margU = marg(true), margL = marg(false);
  // ---- 5. the philtral columns (left; mirrored): the decussating insertions from the columella's base to the bow's peaks
  const colAt = (x, y) => { const n = bn(x, y); return v3.add([x, y, bz(x, y)], v3.mul(n, mgT(x, y) + pT(x) + 0.5 * P.colH - 0.15)); };
  const cTop = colAt(P.colW0 / 2, ySn - 1.2), cMid = colAt(0.5 * (P.colW0 + P.philW) / 2, 0.5 * (ySn - 1.2 + yVBU(P.philW / 2))), cBot = colAt(P.philW / 2, yVBU(P.philW / 2) + 0.4);
  const colL = D.sweep([cTop, cMid, cBot], [{ a: 1.1, b: 0.5 * P.colH + 0.15 }, { a: 1.35, b: 0.5 * P.colH + 0.2 }, { a: 1.5, b: 0.5 * P.colH + 0.25 }].map(s => ({ ...s, n: 2 })), { up: [0, 0, 1], sub: 4, label: LBL_MUSCLE, name: 'philtral column' });
  const colR = D.mirrorX(colL, { label: LBL_MUSCLE, name: 'philtral column_R' });
  // ---- 6. the modiolus (left; mirrored)
  const modL = D.ellipsoid(modC, [3.6, 4.2, 2.6], { label: LBL_MUSCLE, name: 'modiolus' }), modR = D.mirrorX(modL, { label: LBL_MUSCLE, name: 'modiolus_R' });
  // ---- the lips' solids and their envelope (the modiolus is a deep node: the marginal bundles end in it, so the corners follow it in, but
  // it is not under the lips' own skin: the cheek's skin covers it; as a lip solid it raised a knob at the corners, L03 / L08 it1 sections)
  const upper = D.scene([], 'upper lip', { label: LBL_MUSCLE }); upper.add(mgUpper); upper.add(periU, 0.8); upper.add(margU, 0.7); upper.add(colL, 0.5); upper.add(colR, 0.5);
  const lower = D.scene([], 'lower lip', { label: LBL_MUSCLE }); lower.add(mgLower); lower.add(periL, 0.8); lower.add(margL, 0.7);
  const cutU = P.fatLip + P.dermU, cutL = P.fatLip + P.dermL;
  // the vermilion's weight: 1 on the red lip, 0 on the skin; the border ~0.5 mm wide (the mucocutaneous junction is a line)
  const verm = (x, y) => { const ax = Math.abs(x); if (ax > xCh + 1) return 0; const wU = sstep(0.25, -0.25, y - yVBU(x)), wL = sstep(-0.25, 0.25, y - yVBL(x)); return Math.min(wU, wL) * (1 - sstep(xCh - 1, xCh + 1, ax)); };
  const envT = (x, y, z) => { const w = verm(x, y); return lerp(y >= ySto ? cutU : cutL, P.vermEnv, w); };
  const skinU = (x, y, z) => upper.d(x, y, z) - envT(x, y, z), skinL = (x, y, z) => lower.d(x, y, z) - envT(x, y, z);
  const skin = (x, y, z) => Math.min(skinU(x, y, z), skinL(x, y, z));
  const box = [-(modC[0] + 8), yB - 6, Math.min(chB[2], modC[2]) - 14, modC[0] + 8, ySn + 6, Math.max(...xs.map(x => bz(x, ySto))) + 20];
  // joined to a face: wide blends (2.5 mm) into the cheeks and the chin; tight (0.9 mm) at the commissures (the corner tucks in medial to
  // the modiolus)
  const cornerD = (x, y, z) => Math.hypot(Math.abs(x) - chB[0], y - chB[1], z - chB[2]);
  const join = (face) => (x, y, z) => { const a = face(x, y, z); if (x < box[0] - 6 || x > box[3] + 6 || y < box[1] - 6 || y > box[4] + 6 || z < box[2] - 8) return a; const k = lerp(0.9, 2.5, sstep(2.5, 8, cornerD(x, y, z))); return D.smin(a, skin(x, y, z), k); };
  // ---- landmarks and curves (read off the lips' own skin)
  const zOn = (x, y, F = skin) => { let prev = F(x, y, box[5] + 5); for (let z = box[5] + 4.75; z >= box[2]; z -= 0.25) { const f = F(x, y, z); if (f < 0 && prev >= 0) return z + 0.25 * (-f) / (prev - f); prev = f; } return null; };
  let ls = null; for (let y = ySto + 1; y <= yVBU(0) + 4; y += 0.25) { const z = zOn(0, y); if (z != null && (!ls || z > ls[2])) ls = [0, y, z]; }
  let li = null; for (let y = yVBL(0) - 4; y <= ySto - 1; y += 0.25) { const z = zOn(0, y); if (z != null && (!li || z > li[2])) li = [0, y, z]; }
  const sto = [0, ySto, zOn(0, ySto) ?? null], vbU = [], vbL = [], stoLine = [];
  for (let x = 0; x <= xCh; x += 1) { const yu = yVBU(x), yl = yVBL(x), ys = yStoAt(x); vbU.push([x, yu, zOn(x, yu)]); vbL.push([x, yl, zOn(x, yl)]); stoLine.push([x, ys, zOn(x, ys)]); }
  const chS = [xCh, yStoAt(xCh), zOn(xCh, yStoAt(xCh))];
  const lmk = { ls: ls && r1(ls), li: li && r1(li), sto: sto[2] != null ? r1(sto) : null, ch_L: chS[2] != null ? r1(chS) : r1(chB), ch_R: chS[2] != null ? r1([-chS[0], chS[1], chS[2]]) : r1([-chB[0], chB[1], chB[2]]), mod_L: r1(modC), sn: r1(snS), sn0: r1(sn) };
  const curves = { vbUpper_L: vbU.filter(p => p[2] != null).map(r1), vbLower_L: vbL.filter(p => p[2] != null).map(r1), stomion_L: stoLine.filter(p => p[2] != null).map(r1), philtralColumn_L: [cTop, cMid, cBot].map(r1) };
  rep.built = { mouthW: f1(2 * xCh), chBack: ls && chS[2] != null ? f1(ls[2] - chS[2]) : null, chBackSto: sto[2] != null && chS[2] != null ? f1(sto[2] - chS[2]) : null, verU: ls ? f1(yVBU(0) - ySto) : null, verL: f1(ySto - yVBL(0)),
    upLip: f1(snS[1] - ySto), upLipFromBase: f1(ySn - ySto), lipLen: f1(P.lipLen), display: f1(ySto - lm.UIE[1]), lsAheadLi: ls && li ? f1(ls[2] - li[2]) : null, lsOverIncisor: ls ? f1(ls[2] - bz(0, ls[1])) : null, liOverIncisor: li ? f1(li[2] - bz(0, li[1])) : null,
    // (MOUTH 3) the sheet over the hollow: its fill at the columella's base and at the mid-philtrum; the mid-philtrum's soft tissue over
    // the BONE (horizontal, half-way between the skin's subnasale and ls): a description beside the 2023 T-Table's mph (head/depths.js)
    fillAtSn: f1(LH.fill(ySn)), fillAtLs: ls ? f1(LH.fill(ls[1])) : null, mph: (() => { if (!ls) return null; const yM = 0.5 * (snS[1] + ls[1]), z = zOn(0, yM), b = LH.bone(yM); return z != null && b != null ? f1(z - b) : null; })(), hullSupport: LH.support.length };
  rep.ms = Date.now() - t0;
  const parts = [mgUpper, mgLower, periU, periL, margU, margL, colL, colR, modL, modR];
  const mats = { 'labial glands and mucosa (upper)': MOUTH_TISSUE.glands, 'labial glands and mucosa (lower)': MOUTH_TISSUE.glands, 'orbicularis oris, pars peripheralis (upper)': MOUTH_TISSUE.peripheralis,
    'orbicularis oris, pars peripheralis (lower)': MOUTH_TISSUE.peripheralis, 'orbicularis oris, pars marginalis (upper)': MOUTH_TISSUE.marginalis, 'orbicularis oris, pars marginalis (lower)': MOUTH_TISSUE.marginalis,
    'philtral column': MOUTH_TISSUE.columns, 'philtral column_R': MOUTH_TISSUE.columns, modiolus: MOUTH_TISSUE.modiolus, modiolus_R: MOUTH_TISSUE.modiolus };
  const regions = (x, y, z) => ({ vermilion: verm(x, y), cutaneous: 1 - verm(x, y) });
  return { parts, upper, lower, envT, skin, skinU, skinL, join, box, lm: lmk, curves, regions, params: P, mats, bed: bz, report: rep, version: MOUTH_VERSION, paramsVersion: MOUTH_PARAMS_VERSION };
}
