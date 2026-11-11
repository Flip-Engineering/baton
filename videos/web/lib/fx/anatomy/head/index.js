// ANAT8-HEAD (it3, 8 Oct): THE HEAD BUILT FROM THE SKULL OUT, the layers above the bone. Face rev 9's anatomy (the skin membrane on hm08
// and face9.js come in it4). Pure JS (node or browser), no three.js; millimetres in the craniometric frame (skull/frame.js).
//   const H = buildHead(B, st, { T, cast })     // B: skull/skull.js buildSkull(drawSkull(..)); st { sex, age, bmi, fitness };
//                                               // T: FACE P2's tissue table (face_pop.json tissue); cast: the person's soft landmarks
//                                               // in the frame (fr.lm(id) for ch_L, al_L, prn, sn, sto, ...), identity anchors
//   H.G (the bone sampled), H.inner (bone + globes + cartilage + muscles + deep fat: an sdf scene), H.tSF(p) (the superficial fat's
//   thickness), H.phiSub(x, y, z) = inner - tSF (the skin's underside is its zero level), H.skin(p) (the skin's thickness: the skin's
//   outer surface is phiSub = skin), H.sites (the forensic sites on OUR bone: the table's depth, as built), H.muscles, H.fat, H.soft
// THE LAYERS, inside out: BONE (skull rev 2.1) and the GLOBES (real size, seated by the bone) -> CARTILAGE (the nose: septal, upper and
// lower lateral, the alar lobules) -> DEEP FAT on the bone (ROOF, SOOF, deep medial cheek, the buccal pad, the orbital fat) -> MUSCLES
// (head/muscles.js: shells on the bone, straps from bone to the lips and the modiolus) -> SUPERFICIAL FAT (head/fat.js: compartments as a
// thickness field, zero at the retaining ligaments) -> SKIN (thickness by region, FACE6's: Ha et al. 2005, Chopra et al. 2015, as
// recalled). (it6: the paragraph below described it3-it5; the residual field is GONE: the table now only DESCRIBES.) At each forensic site (defined on OUR bone: the it1 finding that P2's soft site vertices
// are not at the table's places) the skin's outer surface is put at the table's depth along the site's direction: the superficial
// layer's thickness there is what the inner layers leave (need), the compartments supply most of it, and a smooth RESIDUAL field over the
// sites (Gaussian RBF, sigma 8 mm: local, so a site's correction does not spread under a neighbouring layer) the rest; the residual per site is reported (what FACE6's compartments miss on our anatomy) and a
// site where the inner layers already exceed the table is reported as OVERSHOOT (a muscle or cartilage too thick there).
import * as D from '../layer/sdf.js';
import { sampleField, redistance } from '../layer/grid.js';
import { v3, clamp, lerp, sstep, LBL, LBL_NAME, onBone, hitBone, blob, capw, f1, f2, r1 } from './common.js';
import { buildMuscles, muscleT, MUSCLES_VERSION } from './muscles.js';
import { buildFat, BASE_SUP, FAT_VERSION } from './fat.js';
import { buildNose as buildNoseFramework } from './nose/index.js';
import { depthAt, DEPTHS, DEPTH_SRC, DEPTHS_VERSION } from './depths.js';   // (lane it23) the sourced depth table (Hona & Stephan 2023 T-Table)   // NOSEMOUTH's cartilaginous framework on our bone: the tip's anatomy (read only)
export { LBL, LBL_NAME };
export const HEAD_VERSION = 8;   // (orchestrator 16 Oct) solveAmounts' upper bound 2 -> 5 (with fat.js FAT_VERSION 4's lower-face compartments). (was 7: (lane it23) THE COMPARTMENTS' AMOUNTS FROM THE PUBLISHED DEPTHS (solveAmounts: one scale a superficial compartment from the 2023 T-Table at the sites over it; the sites aligned to the T-Table's landmarks: head/depths.js). (was 6: (c5 it14) the nose's tip from NOSEMOUTH's cartilaginous framework on our bone (was pulled half-way to the scans). (was 5: (it9) the modiolus ~10 mm lateral to the commissure on the buccinator (it stood on the ramus). (was 4: (it8) the parotid by its measured volume (SHIP MRI); 3:)   // (it6) no residual field (the table describes, never constructs); the mentalis a volume. (it4) the bone field redistanced
// the depth at a site for this person (FACE P2's table: Stephan and Simpson 2008; Stephan 2017; De Greef 2006; Manhein 2000: sex, decade, BMI)
// (HEAD rev 7, lane it23) the depths from head/depths.js (the 2023 T-Table's pooled means, our sex / age / BMI terms); the T argument (FACE P2's
// recalled table, face_pop.json tissue) is no longer read for the sites (the skull still reads its glabella from it: skull.js)
export function siteDepth(T, key, sex, age, bmi) { return depthAt(key, { sex, age, bmi }); }

// ---------------------------------------------------------------- the soft anchors: where the mouth, the nose and the modiolus are
// The mouth's height from the bone (the stomion over the upper incisal edge by the incisor display at rest), its width from the cast (the
// commissure kept over the canine / first premolar), the lips' fronts from the incisors and the table (ls, li); the nose's tip from the
// nose's ANATOMY (HEAD_VERSION 6, c5 it14): the pronasale is where NOSEMOUTH's cartilaginous framework (nose/index.js: the medial crura
// on the premaxilla, the domes, the septum to the anterior septal angle, the tip's envelope; Farkas / Daniel's measures by population,
// the person's own draw) puts the tip on OUR bone (it3-it13 pulled the cast's pronasale half-way to the ten HSRD-100 heads' tip
// projection, 35.7 / 33.8 mm ahead of the cornea: a measurement constructing the form; the scans now only measure it); the subnasale
// half-way to the ANS + the philtrum's depth; the alae at the cast's width.
export function softAnchors(B, G, st, cast = {}, T = null, o = {}) {   // (c6 it16) the A/B switches o.modiolus / o.noseTip DELETED (git history only)
  const g = B.geo, lm = B.lm, K = B.K, m = st.sex === 'm', dep = (k, fb) => siteDepth(T, k, st.sex, st.age, st.bmi) ?? fb, rep = {};
  const toothFront = (x, y) => { const h = hitBone(G, [x, y, g.zPr + 60], [0, 0, -1], 140); return h ? h[2] : g.zPr - 0.15 * x * x / 6; };
  const ls = dep('ls', m ? 12.8 : 11), li = dep('li', m ? 14 : 12.5), yS = lm.UIE[1] + (K.display ?? 2.5);
  const xCan = g.xCan, chX = clamp(cast.ch_L ? cast.ch_L[0] : xCan + 9, xCan + 5, xCan + 13); rep.chX = [f1(cast.ch_L ? cast.ch_L[0] : NaN), f1(chX)];
  const lipDepth = y => { const u = (y - yS) / 7; return u >= 0 ? lerp(0.5 * (ls + li) - 0.6, ls, clamp(u, 0, 1)) * (1 - 0.25 * clamp(u - 1, 0, 1)) : lerp(0.5 * (ls + li) - 0.6, li, clamp(-u, 0, 1)) * (1 - 0.3 * clamp(-u - 1, 0, 1)); };
  const lipFront = (x, y) => toothFront(x, y) + lipDepth(y) * (1 - 0.42 * sstep(0.2 * chX, chX + 2, Math.abs(x)));
  // (it9) THE COMMISSURE'S DEPTH FROM THE ARCH: the corner of the mouth lies lateral to the first premolar (anatomy texts, as recalled), on
  // the buccal face's outward normal there, at the cast's corner width. it3-it8 took lipFront(chX): a ray straight back at x = chX,
  // which on our arches (the canine's buccal face at x 15-18, the first molar's at 25-29) grazes the arch's side and meets a molar: the
  // corner stood 6 mm (L08) to 33 mm (L21: z 67 against the cast's 100) behind where the lips put it, and with it the nasolabial
  // compartment, its ligament line and the modiolus below.
  const p4 = B.arch.upT[3], n4 = p4.n, tC = Math.max(2, (chX - p4.p[0]) / Math.max(0.3, n4[0])), chZold = lipFront(chX, yS) - 0.8;
  const sto = [0, yS, lipFront(0, yS)], ch = [chX, yS - 0.6, p4.p[2] + tC * n4[2]];
  rep.ch = { zWas: f1(chZold), z: f1(ch[2]), castZ: cast.ch_L ? f1(cast.ch_L[2]) : null };
  // (it9) THE MODIOLUS WHERE IT IS: the fibromuscular knot where the buccinator, orbicularis oris, zygomaticus major, risorius, levator
  // and depressor anguli oris meet, ~10 mm lateral to the commissure (Al-Hoqail and Abdel Meguid 2009, Aesthetic Plast Surg 33:147;
  // Yu et al. 2013: ~1 cm lateral to the angle of the mouth; as recalled), lying ON the buccinator (its fibres decussate into it), over the
  // second premolar / first molar. it3-it8 put it at toothFront(chX + 9.5) + 6: a ray straight back at x = chX + 9.5, which on our arches
  // (half-width at the molars' buccal faces 27-31 mm) passes BESIDE the dentition and meets the RAMUS: the modiolus stood ~6 mm in front of
  // the ramus, 25-32 mm behind the commissure (L08 z 47.3 against ch 79.6), and every muscle converging on it ran back across the cheek to
  // the masseter (the zygomaticus major and risorius ended on the ramus, the buccinator's front folded back, the orbicularis oris' arcs ran
  // 30 mm along the arch as a rod, the jowl's fat sat on the masseter). Now: on the buccinator's outer face plus the modiolus' own ~2 mm
  // (the arch's buccal-face curve, upT, offset along its normal by the vestibule 1.6 + the buccinator's thickness + 2), at 10 mm (in
  // the horizontal plane) from the commissure going back along that curve; its height as it3's.
  const Tb = muscleT('buccinator', st), offC = upT => upT.map(o => [o.p[0] + o.n[0] * (1.6 + Tb + 2), o.p[2] + o.n[2] * (1.6 + Tb + 2)]), curve = offC(B.arch.upT);
  const modOld = [chX + 9.5, yS - 1.2, toothFront(chX + 9.5, yS - 1.2) + 6], chZ = ch[2];
  let modXZ = curve[curve.length - 1]; { let i0 = 0, best = Infinity; for (let i = 0; i < curve.length; i++) { const d = Math.hypot(curve[i][0] - chX, curve[i][1] - chZ); if (d < best) { best = d; i0 = i; } }
    for (let i = i0; i + 1 < curve.length; i++) { const a = curve[i], b = curve[i + 1], da = Math.hypot(a[0] - chX, a[1] - chZ), db = Math.hypot(b[0] - chX, b[1] - chZ); if (db >= 10) { const t = clamp((10 - da) / Math.max(1e-6, db - da), 0, 1); modXZ = [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]; break; } } }
  const mod = [modXZ[0], yS - 1.2, modXZ[1]];
  rep.mod = { was: r1(modOld), now: r1(mod), fromCommissure: f1(Math.hypot(mod[0] - chX, mod[2] - chZ)) };
  // the nose: the tip from the framework's anatomy (NOSEMOUTH's cartilaginous framework on our bone)
  const cornea = g.cornea, prnC = cast.prn || [0, g.yANS + 10, cornea + 30];
  const nf = buildNoseFramework(B, G, { name: K.name || '', sex: st.sex, age: st.age, group: K.group }), prn = [0, nf.lm.prn[1], nf.lm.prn[2]];
  const snC = cast.sn || [0, g.yANS + 2, g.zANS + 13], sn = [0, snC[1], 0.5 * snC[2] + 0.5 * (lm.ANS[2] + (m ? 13.5 : 12.5))];
  const alC = cast.al_L || [17, g.yANS + 4, g.zANS + 2], alX = clamp(alC[0], K.NLB / 2 + 3, K.NLB / 2 + 9), al = [alX, alC[1], (hitBone(G, [alX, alC[1], g.zN + 60], [0, 0, -1], 200)?.[2] ?? g.zANS - 4) + 10];
  rep.prn = { from: 'framework', cast: r1([prnC[1], prnC[2] - cornea]), built: r1([prn[1], prn[2] - cornea]) }; rep.sn = { cast: r1(snC), built: r1(sn) }; rep.alX = [f1(alC[0]), f1(alX)];
  rep.sto = { castY: cast.sto ? f1(cast.sto[1]) : null, builtY: f1(yS), display: K.display };
  return { sto, ch, mod, al, prn, sn, lipFront, toothFront, chX, report: rep };
}

// ---------------------------------------------------------------- the nose's cartilage and the alar lobules (fibrofatty)
export function buildNose(B, G, soft, st) {
  const g = B.geo, lm = B.lm, K = B.K, R = lm.Rhi, prn = soft.prn, sn = soft.sn, al = soft.al, parts = [], m = st.sex === 'm';
  const ASA = [0, prn[1] + 6.5, prn[2] - 4.6];                      // the anterior septal angle (the supratip's cartilage)
  const dome = [3.4, prn[1] - 0.8, prn[2] - 3.2];                    // the domes: the tip-defining points (skin ~3 mm over them)
  // the cartilaginous dorsum from the rhinion (on the bone) to the anterior septal angle, 0.4 mm under the bony line's continuation
  const tanN = (lm.Rhi[2] - lm.N[2]) / Math.max(1, lm.N[1] - lm.Rhi[1]);        // the bony dorsum's slope; above the rhinion the cartilage runs on under it
  const dZ = y => { if (y >= R[1]) return R[2] - 1.0 - (y - R[1]) * tanN; const t = clamp((R[1] - y) / (R[1] - ASA[1] || 1), 0, 1); return lerp(R[2] - 0.6, ASA[2] - 0.4, t); };
  // SEPTAL CARTILAGE: a 2 mm plate in the midsagittal plane
  parts.push(D.heightSlab(() => 1.0, 2.0, D.regionPoly([[R[1] + 5, R[2] - 9], [R[1] + 0.5, R[2] - 1.4], [ASA[1], ASA[2] - 1.2], [sn[1] + 3, sn[2] - 5.5], [lm.ANS[1] + 1.5, lm.ANS[2] - 1], [lm.ANS[1] + 2, lm.ANS[2] - 18], [R[1] - 2, R[2] - 22]]),
    { axis: 'x', k: 1, label: LBL.cartilage, name: 'septal cartilage', aabb: [-1.5, lm.ANS[1] - 2, lm.ANS[2] - 22, 1.5, R[1] + 7, ASA[2] + 2] }));
  // UPPER LATERAL CARTILAGES: the tent continued from the nasal bones down to the supratip, its sides falling into the aperture's edge
  const cot0 = 1.0 + (g.cotLow ?? 1.3) * 0.3, apW = y => lerp(K.NLB / 2 - 1, 5, clamp((y - lm.ANS[1]) / (R[1] - lm.ANS[1] || 1), 0, 1));
  const ulF = (x, y) => dZ(y) - (Math.sqrt(x * x + 9) - 3) * cot0;
  parts.push(D.heightSlab(ulF, 1.4, (x, y) => Math.max(Math.abs(x) - apW(y) - 1.5, y - (R[1] + 3), (ASA[1] + 1.5) - y), { k: 1, label: LBL.cartilage, name: 'upper lateral cartilage', aabb: [-(K.NLB / 2 + 4), ASA[1] - 1, ASA[2] - 22, K.NLB / 2 + 4, R[1] + 5, R[2] + 2] }));
  // LOWER LATERAL CARTILAGES: domes, lateral crura (up, out and back along the ala's upper part), medial crura (the columella)
  const latC = D.sweep([dome, v3.add(dome, [5.5, 2.2, -5.5]), v3.add(dome, [10, 3.4, -11.5])], [{ a: 3.0, b: 1.0 }, { a: 3.6, b: 0.7 }, { a: 3.0, b: 0.6 }], { up: [0, 1, 0.3], label: LBL.cartilage, name: 'lateral crus' });
  const medC = D.sweep([dome, [1.5, (dome[1] + sn[1]) / 2, (dome[2] + sn[2]) / 2 + 0.8], [1.6, sn[1] + 1.6, sn[2] - 0.6]], [{ a: 2.6, b: 1.4 }, { a: 2.4, b: 0.9 }, { a: 2.6, b: 1.0 }], { up: [0, 0, 1], label: LBL.cartilage, name: 'medial crus' });
  const domeE = D.ellipsoid(dome, [2.8, 3.0, 2.6], { label: LBL.cartilage, name: 'dome' });
  // the ALAR LOBULE (fibrofatty, the nostril's outer wall) from the alar base round to the tip
  const ala = D.sweep([[al[0], sn[1] + 0.5, al[2] - 4], [al[0] - 0.8, sn[1] + 2.6, (al[2] + prn[2]) / 2 - 2.5], v3.add(dome, [2.6, -1.8, -2.4])], [{ a: 3.4, b: 2.6 }, { a: 3.6, b: 2.1 }, { a: 2.8, b: 1.6 }], { up: [0, 1, 0], label: LBL.cartilage, name: 'alar lobule' });
  for (const p of [latC, medC, domeE, ala]) { parts.push(p); parts.push(D.mirrorX(p, { label: LBL.cartilage, name: p.name + '_R' })); }
  return { parts, ASA, dome };
}

// ---------------------------------------------------------------- skin thickness by region (FACE6's numbers on our anatomy)
export function skinThickness(B, soft, st) {
  const g = B.geo, lm = B.lm, gl = B.globe, age = st.age ?? 35;
  const reg = [[blob([0, g.yN + 30, g.zG - 4], [48, 34, 30]), 1.9], [blob([0, soft.prn[1] + 4, soft.prn[2] - 4], [12, 18, 12]), 2.1], [blob([0, lm.Pog[1] - 2, lm.Pog[2] + 8], [16, 13, 14]), 2.1],
    [blob([0, soft.sto[1], soft.sto[2] - 3], [soft.mod[0] + 1, 9, 9]), 1.2], [blob(v3.add(gl.L.c, [0, 0, 8]), [16, 11, 10]), 0.75], [blob(v3.add(gl.R.c, [0, 0, 8]), [16, 11, 10]), 0.75]];
  const thin = 1 - 0.05 * Math.max(0, age - 40) / 10;
  return p => { let t = 1.6; for (const [S, v] of reg) { const w = S(p); if (w > 0) t = t * (1 - w) + v * w; } return t * thin; };
}

// ---------------------------------------------------------------- the forensic SITES on our bone: { key, id, b (on the bone), n (the
// direction the depth is measured along), table }
export function bonySites(B, G, soft) {
  const g = B.geo, lm = B.lm, Z = [0, 0, 1], out = [], nrm = p => v3.norm(G.grad(p[0], p[1], p[2], [0, 0, 0], 0.6));
  const surfZ = (x, y) => hitBone(G, [x, y, g.zN + 80], [0, 0, -1], 240);
  const site = (key, id, b, n) => { if (b) out.push({ key, id, b, n: v3.norm(n || nrm(b)) }); };
  // midline
  let gl = null; for (let y = g.yN + 4; y <= g.yN + 22; y += 0.5) { const h = surfZ(0, y); if (h && (!gl || h[2] > gl[2])) gl = h; }
  site('sg', 'sg', surfZ(0, (gl ? gl[1] : g.yG) + 11)); site('g', 'g', gl); site('n', 'n', onBone(G, lm.N)); const na = Math.atan2(lm.Rhi[2] - lm.N[2], lm.N[1] - lm.Rhi[1]), rb = hitBone(G, [0, lm.Rhi[1] + 1.5, lm.Rhi[2] + 30], [0, 0, -1], 60); site('rhi', 'rhi', rb, [0, Math.sin(na), Math.cos(na)]);
  site('mn', 'mn', onBone(G, v3.lerp(lm.N, lm.Rhi, 0.5)));   // (it23) the T-Table's mid-nasal: half-way along the nasal bones, along the bone's normal
  site('mph', 'mph', surfZ(0, (lm.ANS[1] + lm.Pr[1]) / 2), Z);
  const crU = lm.UIE, crL = lm.LIE; site('ls', 'ls', surfZ(0.6, crU[1] + 4.5), Z); site('li', 'li', surfZ(0.6, crL[1] - 4), Z);
  site('sl', 'sl', surfZ(0, lm.B[1]), [0, -0.15, 1]); site('pg', 'pg', surfZ(0, lm.Pog[1]), Z);
  const gn = onBone(G, lm.Gn); site('gn', 'gn', gn, v3.add(nrm(gn), [0, -0.2, 0.2]));
  const me = hitBone(G, [0, lm.Me[1] - 30, lm.Me[2]], [0, 1, 0], 40); site('me', 'me', me, [0, -1, 0.15]);
  // bilateral (left, mirrored)
  for (const sg of [1, -1]) { const S = (p) => [sg * p[0], p[1], p[2]], sfx = sg > 0 ? '_L' : '_R';
    // the supraorbital and infraorbital sites on the margins' fronts over the pupil (rays straight back, just outside the aperture: a ray
    // aimed into the aperture finds the orbit's floor or roof, 30 mm deep)
    let so = null; for (let dy = 1.5; dy <= 8 && !(so && so[2] > g.zLatH); dy += 0.5) so = hitBone(G, S([g.xOc, g.ySupM + dy, g.zN + 80]), [0, 0, -1], 200); site('so', 'so' + sfx, so, [0, 0.25, 1]);      // over the brow's front at the margin (the margin's own edge normal points into the orbit)
    let or = null; for (let dy = 1.5; dy <= 8 && !(or && or[2] > g.zLatH); dy += 0.5) or = hitBone(G, S([g.xOc, g.yIn - dy, g.zN + 80]), [0, 0, -1], 200); site('or', 'or' + sfx, or, [0, -0.1, 1]);   // (it4) forward: on the true distance field the margin's normal points up into the orbit (the ray grazed the lower lid: L21 +7.9)
    site('mal', 'mal' + sfx, onBone(G, S(g.Mal)));
    const m2 = B.arch.upT[6], bm = hitBone(G, S(v3.add([m2.p[0], m2.p[1] + 11, m2.p[2]], v3.mul(m2.n, 40))), S(v3.mul(m2.n, -1)), 60); site('buc', 'buc' + sfx, bm, S(m2.n));
    const zr = (lm.Go_L[2] + lm.Cor_L[2]) / 2 - 2, ym = (lm.UIE[1] + lm.Co_L[1]) / 2 - 8, bmas = hitBone(G, S([110, ym, zr]), [-sg, 0, 0], 120); site('mas', 'mas' + sfx, bmas, [sg, 0, 0]);
    // (it23) infra-M2 as the T-Table defines it (ecm2-iM2': from the mandible's alveolus at the second molar, ~9 mm below its occlusal
    // point; it2-it22 measured 13 mm below, on the body, where the recalled table's 10 mm belonged)
    const l2 = B.arch.lowT[6], bmm = hitBone(G, S(v3.add([l2.p[0], l2.p[1] - 9, l2.p[2]], v3.mul(l2.n, 40))), S(v3.mul(l2.n, -1)), 60); site('mm', 'mm' + sfx, bmm, S(l2.n));
    const go = onBone(G, S(lm.Go_L)); site('go', 'go' + sfx, go);
    // (it23) the T-Table's other bilateral landmarks our bone carries: zygion (the arch's most lateral point, outward), the supra- and
    // infra-canine points (the alveolus over the canine's root, ~10 mm from its cusp, along the arch's outward normal), the mid-mandibular
    // border (the body's lower border under the second premolar, along the bone's normal)
    site('zy', 'zy' + sfx, onBone(G, S(lm.Zy_L)), [sg, 0, 0]);
    const c3 = B.arch.upT[2], bsc = hitBone(G, S(v3.add([c3.p[0], c3.p[1] + 10, c3.p[2]], v3.mul(c3.n, 40))), S(v3.mul(c3.n, -1)), 60); site('sC', 'sC' + sfx, bsc, S(c3.n));
    const c3l = B.arch.lowT[2], bic = hitBone(G, S(v3.add([c3l.p[0], c3l.p[1] - 10, c3l.p[2]], v3.mul(c3l.n, 40))), S(v3.mul(c3l.n, -1)), 60); site('iC', 'iC' + sfx, bic, S(c3l.n));
    const p5 = B.arch.lowT[4], bmb = hitBone(G, S([p5.p[0], lm.Me[1] - 30, p5.p[2]]), [0, 1, 0], 60); site('mmb', 'mmb' + sfx, bmb); }
  return out;
}

// ---------------------------------------------------------------- (rev 7, lane it23) the compartments' amounts from the depth table
// sites: buildHead's (q the subcutaneous point at the table's depth, fq its foot, need the superficial thickness the inner layers leave
// there, wN the cartilage's weight); fat: head/fat.js buildFat. Scales each superficial field IN PLACE (f.t, f.tBoth, f.raw, f.rawBoth;
// fat.total reads them) and returns { k: { key: scale }, report }.
export function solveAmounts(sites, fat, o = {}) {
  // (HEAD rev 8, orchestrator 16 Oct) hi 2 -> 5: FACE6's base amounts are recalled values, and at k <= 2 the jowl (1.6 mm) could never
  // supply the T-Table's mid-mandibular and infra-M2 depths once it lay over them (fat.js FAT_VERSION 4): the published depth sets it
  const F = fat.fields, nc = F.length, sym = fat.symmetric, base = BASE_SUP * 0.6, lo = o.lo ?? 0.5, hi = o.hi ?? 5, reg = o.reg ?? 0.1;
  // only the T-Table's own landmarks set a parameter (sg, mal: recalled, described only)
  const rows = []; for (const s of sites) { if (!(s.wN < 0.5) || DEPTHS[s.key]?.s == null) continue; const m = F.map(f => sym.has(f.key) ? f.t(s.fq) : f.tBoth(s.fq)), sm = m.reduce((a, b) => a + b, 0); if (sm < 0.2) continue;
    const sd = DEPTHS[s.key]?.s ?? 4, w = 1 / (sd * sd); rows.push({ id: s.id, m, r: s.need - base, w, sm }); }
  // normal equations with the pull to k = 1 (a tenth of each compartment's own data weight, at least 1e-3)
  const dw = new Float64Array(nc); for (const R of rows) for (let c = 0; c < nc; c++) dw[c] += R.w * R.m[c] * R.m[c];
  const lam = Array.from(dw, d => Math.max(1e-3, reg * d)), fixed = new Map(), k = new Float64Array(nc).fill(1);
  for (let pass = 0; pass < 12; pass++) { const free = []; for (let c = 0; c < nc; c++) if (!fixed.has(c)) free.push(c); const n = free.length; if (!n) break;
    const A = Array.from({ length: n }, () => new Float64Array(n)), b = new Float64Array(n);
    for (const R of rows) { let rr = R.r; for (const [c, v] of fixed) rr -= R.m[c] * v; for (let i = 0; i < n; i++) { const mi = R.m[free[i]]; if (!mi) continue; b[i] += R.w * mi * rr; for (let j = 0; j < n; j++) A[i][j] += R.w * mi * R.m[free[j]]; } }
    for (let i = 0; i < n; i++) { A[i][i] += lam[free[i]]; b[i] += lam[free[i]] * 1; }
    // Gaussian elimination (n <= 12)
    for (let i = 0; i < n; i++) { let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r; [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
      for (let r = i + 1; r < n; r++) { const f = A[r][i] / A[i][i]; if (!f) continue; for (let c = i; c < n; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; } }
    const x = new Float64Array(n); for (let i = n - 1; i >= 0; i--) { let v = b[i]; for (let c = i + 1; c < n; c++) v -= A[i][c] * x[c]; x[i] = v / A[i][i]; }
    let viol = false; for (let i = 0; i < n; i++) { k[free[i]] = x[i]; if (x[i] < lo) { fixed.set(free[i], lo); viol = true; } else if (x[i] > hi) { fixed.set(free[i], hi); viol = true; } }
    for (const [c, v] of fixed) k[c] = v; if (!viol) break; }
  // apply: each field's thickness (with and without its ligaments' hold) scaled by its k
  const K = {}; F.forEach((f, c) => { const kc = k[c]; K[f.key] = f2(kc); if (Math.abs(kc - 1) < 1e-9) return; const t = f.t, tB = f.tBoth, r = f.raw, rB = f.rawBoth;
    f.t = p => kc * t(p); f.tBoth = p => kc * tB(p); f.raw = p => kc * r(p); f.rawBoth = p => kc * rB(p); f.k = kc; f.t0k = f.t0 * kc; });
  const fit = rows.map(R => { let v = 0; for (let c = 0; c < nc; c++) v += R.m[c] * k[c]; return { id: R.id, need: f2(R.r + base), was: f2(R.sm + base), now: f2(v + base) }; });
  return { k: K, report: { k: K, sites: fit, n: rows.length, src: DEPTH_SRC } };
}

// ---------------------------------------------------------------- the head
export function buildHead(B, st, o = {}) {
  const t0 = Date.now(), T = o.T || null, h = o.h ?? 2.0, a = B.S.aabb, pad = o.pad ?? 30;
  const box = [a[0] - pad, Math.max(a[1] - pad, -150), a[2] - pad, a[3] + pad, a[4] + 8, a[5] + pad].map(Math.round);
  // (it4) the sampled skull SDF under-reads away from the bone (height slabs, sweeps, smooth unions: the it3 measurer's G-D, 18.8 % of the
  // points 1-25 mm out read >= 3 mm too close on L08, ~20 mm at the lateral brow): REDISTANCED to a true Euclidean distance before any
  // layer reads it (layer/grid.js redistance)
  const G = o.G || redistance(sampleField(B.S, box, h, { band: o.band ?? 3 })), t1 = Date.now();
  const soft = softAnchors(B, G, st, o.cast || {}, T, o.soft || {});
  const nose = buildNose(B, G, soft, st), mus = buildMuscles(B, G, soft, st, o.muscles || {}), fat = buildFat(B, G, soft, st, mus, o.fat || {}), skin = skinThickness(B, soft, st);
  // the INNER layers: bone (sampled), the real globes, cartilage, muscles, deep fat
  const bone = D.custom((x, y, z) => G.value(x, y, z), box, { label: LBL.cranium, name: 'bone' });
  const globes = ['L', 'R'].map(s => D.sphere(B.globe[s].c, B.globe[s].r, { label: LBL.globe, name: 'globe_' + s }));
  // the GLANDS (not fat, but volume the depth table counts: the parotid over the ramus' posterior third and behind it, the submandibular
  // under the body's angle; as recalled from anatomy texts, sizes provisional)
  const lm = B.lm, Co = lm.Co_L, Go = lm.Go_L, Me = lm.Me, glands = [];
  // (it6) BY THEIR SIZE AND PLACE (it3-it5's were a fifth to a third of real glands, and the parotid stopped 10 mm above the angle: the
  // residual field filled the difference). PAROTID: the retromandibular part between the ramus' posterior border and the ear (it3's), and
  // the SUPERFICIAL LOBE lying on the masseter's posterior half from the zygomatic arch down to just below the angle, its long axis along the
  // ramus, over the masseter's POSTERIOR third only, ~8 mm thick (~6.7 mL; the whole gland ~20-30 mL in CT / MRI volumetry, its deep lobe
  // medial to the ramus and not under the skin: as recalled; a first build 12 mm thick and 4 mm further forward stood 3-7 mm over the
  // table at the mid-masseter site: the gland does not cover the masseter's front).
  // SUBMANDIBULAR: under the mandible's body in the submandibular triangle, ~7-8 mL (CT volumetry ~7-10 mL, as recalled), centred under the
  // body at the molars, medial to the lower border.
  const archBot = -6.8 - B.geo.aH - 0.6, rUp = v3.norm(v3.sub(Co, Go)), bodyT = 0.32, yBorder = Go[1] + (Me[1] - Go[1]) * bodyT, zBorder = Go[2] + (Me[2] - Go[2]) * bodyT;
  // (it8) THE PAROTID BY ITS MEASURED VOLUME. The it6 gland (its footprint above: the arch to below the angle, the masseter's posterior
  // third, the retromandibular fossa) held ~10-12 mL outside the bone and the masseter; population MRI measures 21.6 mL a gland in women
  // and 27.8 mL in men (95 % CI 21.2-22.1 / 27.2-28.5; 1725 adults, T1 MRI, the Study of Health in Pomerania: 'Population based average
  // parotid gland volume and prevalence of incidental tumors in T1-MRI', Healthcare 2022; larger with age, BMI and male sex: no
  // coefficients transcribed, so the sex means stand for everyone: for a lean 20-30 year old an upper estimate), of which the
  // superficial lobe, lateral to the facial nerve's plane, is ~4 / 5 (anatomy texts; the deep lobe medial to the ramus is not under the
  // skin and not built). The footprint is the anatomy's (unchanged); the measured volume sets the gland's THICKNESS (the superficial
  // lobe's outward radius and the retromandibular part's lateral one, by one factor found by bisection on the volume outside the bone
  // and the masseter, sampled at 1 mm). The 3D form against the ten HSRD-100 heads (anat8_scanmap.mjs) found the lateral cheek the
  // region furthest inside real heads (it7 face9 on: L08 -3.6 mm, L21 -5.4 mm along the normal; the heads' own spread +-3 mm) and the
  // jaw further in with face9 than without: that only DESCRIBES; the volume is the paper's.
  const parW = o.parotid === false ? null : (o.parotid?.mL ?? (st.sex === 'm' ? 27.8 : 21.6) * 0.8);
  const parotid = k => [D.ellipsoid([Go[0] + 7.5, (Co[1] + Go[1]) / 2 + 4, Co[2] - 2], [7 * k, 20, 11], { label: LBL.gland, name: 'parotid gland (retromandibular)' }),
    D.ellipsoid([Go[0] + 8, (archBot + Go[1] - 4) / 2, (Co[2] + Go[2]) / 2], [(archBot - Go[1] + 4) / 2 + 2, 16, 4 * k], { basis: D.basis([1, 0, 0], rUp), label: LBL.gland, name: 'parotid gland (superficial lobe)' })];
  const masP = mus.list.find(r => r.key === 'masseter')?.prim, parVol = k => { const [a, b] = parotid(k), bb = [0, 1, 2].map(i => Math.min(a.aabb[i], b.aabb[i])).concat([0, 1, 2].map(i => Math.max(a.aabb[i + 3], b.aabb[i + 3]))); let n = 0;
    for (let z = Math.floor(bb[2]); z <= bb[5]; z++) for (let y = Math.floor(bb[1]); y <= bb[4]; y++) for (let x = Math.floor(bb[0]); x <= bb[3]; x++) { if (Math.min(a.d(x, y, z), b.d(x, y, z)) >= 0) continue; if (G.value(x, y, z) < 0) continue; if (masP && masP.d(x, y, z) < 0) continue; n++; }
    return n / 1000; };
  let parK = 1; const parRep = { mL0: f1(parVol(1)) };
  if (parW) { let lo = 0.5, hi = 6; for (let it = 0; it < 14; it++) { const m = 0.5 * (lo + hi); if (parVol(m) < parW) lo = m; else hi = m; } parK = 0.5 * (lo + hi); }
  const [parR, parS] = parotid(parK); Object.assign(parRep, { target: parW ? f1(parW) : null, k: f2(parK), mL: f1(parVol(parK)), thickness: { superficialLobe: f1(8 * parK), retromandibularLateral: f1(7 * parK) }, src: 'SHIP MRI, Healthcare 2022 (per gland: women 21.6, men 27.8 mL) x 4/5 superficial' });
  const sm = D.ellipsoid([B.K.goGo / 2 - 12, yBorder - 7, zBorder], [10, 20, 9], { basis: D.basis([1, 0, 0], [0, 1, 0]), label: LBL.gland, name: 'submandibular gland' });
  for (const p of [parR, parS, sm]) { glands.push(p); glands.push(D.mirrorX(p, { label: LBL.gland, name: p.name + '_R' })); }
  // (it4) WHAT THE SKIN SEES: the straps (corrugator, levators, zygomatici, risorius, depressors, mentalis: 1.5-2.6 mm bands) and the
  // platysma's 1-1.4 mm sheet lie IN the superficial layer (the SMAS plane): the table's subcutaneous thickness already counts them, so
  // the skin's underside is the solid layers (bone, globes, cartilage, the shells and rings, glands, deep fat) offset by the superficial
  // layer; as solids under the skin they stood through it as rods and beads (the it3 measurer's G-S: zygomaticus minor 3-5 mm beyond
  // the skin over the malar site). They stay in H.muscles (the cutaway, FACS lines). (it6) The MENTALIS is not a strap in that sense: a
  // short, thick cone from the incisive fossa into the chin's skin (4-5 mm: FACE6), the chin pad's bulk: a solid again.
  const thin = r => (r.kind === 'strap' && r.key !== 'mentalis') || r.key === 'platysma', seen = []; for (const r of mus.list) { if (thin(r)) continue; seen.push(r.prim); if (r.side === 'L') seen.push(D.mirrorX(r.prim, { label: LBL.muscle, name: r.name + '_R' })); }
  const innerM = D.scene([], 'bone + muscles'); innerM.add(bone); for (const p of globes) innerM.add(p); for (const p of seen) innerM.add(p); for (const p of glands) innerM.add(p, 1.5);
  const tNose = 0.4 + fat.report.nose.T * 0.4;
  const cart = D.scene([], 'cartilage', { label: LBL.cartilage }); for (const p of nose.parts) cart.add(p, 0.6);
  const deepF = D.scene([], 'deep fat', { label: LBL.deepFat }); for (const p of fat.deep) deepF.add(p);
  const inner = D.scene([], 'inner layers'); inner.add(innerM); inner.add(cart, 1.0); inner.add(deepF);
  // the SITES and the residual: at each site the subcutaneous point q (the table's depth less the skin) must lie on phiSub's zero level
  // the superficial layer is read at the bone's FOOT POINT of p (p less its bone distance along the bone's normal): constant along the
  // bone's normals, so phiSub = inner - tSF crosses zero once along them (a field varying in 3-D moved the zero level: it3's first run)
  const gtmp = [0, 0, 0], foot = p => { const d = G.value(p[0], p[1], p[2]); G.grad(p[0], p[1], p[2], gtmp, 0.8); return [p[0] - d * gtmp[0], p[1] - d * gtmp[1], p[2] - d * gtmp[2]]; };
  // the superficial layer is read at the foot point on the INNER surface where the nearest inner layer stands off the bone (a lip over the
  // mentolabial sulcus, the masseter): the bone's foot alone gave the sulcus's thickness to every point under the lip's overhang (it3)
  const innerS = (x, y, z) => { const dR = Math.min(innerM.d(x, y, z), deepF.d(x, y, z)), dC = cart.d(x, y, z); return Math.min(dR, D.smin(dR, dC, 1.0)); };
  const gI = [0, 0, 0], footI = (p, dI) => { const e = 0.5; gI[0] = innerS(p[0] + e, p[1], p[2]) - innerS(p[0] - e, p[1], p[2]); gI[1] = innerS(p[0], p[1] + e, p[2]) - innerS(p[0], p[1] - e, p[2]); gI[2] = innerS(p[0], p[1], p[2] + e) - innerS(p[0], p[1], p[2] - e);
    const l = Math.hypot(gI[0], gI[1], gI[2]) || 1; return [p[0] - dI * gI[0] / l, p[1] - dI * gI[1] / l, p[2] - dI * gI[2] / l]; };
  const sites = T ? bonySites(B, G, soft).map(s => { const Dt = siteDepth(T, s.key, st.sex, st.age, st.bmi), sk0 = skin(v3.add(s.b, v3.mul(s.n, Dt))), q = v3.add(s.b, v3.mul(s.n, Dt - sk0)), need = innerS(q[0], q[1], q[2]), fq = foot(G.value(...q) - need > 2.5 && need > -1 ? footI(q, need) : q), comp = fat.total(fq) + BASE_SUP * 0.6, wN = sstep(1.5, -1.5, cart.d(...q) - Math.min(innerM.d(...q), deepF.d(...q)));
    return { ...s, table: Dt, skin: sk0, q, fq, need, comp, wN }; }) : [];
  // (HEAD rev 7, lane it23) THE COMPARTMENTS' AMOUNTS FROM THE PUBLISHED DEPTHS. Each superficial compartment (head/fat.js: forehead,
  // temporal, infraorbital, the medial / middle / lateral cheek, nasolabial, jowl, mental, submental, lips, nose) keeps FACE6's SHAPE (its
  // footprint and profile on our landmarks, its descent, its ligaments' hold) and gets its AMOUNT, one scale k a compartment for both
  // sides, from the depth table (head/depths.js: the 2023 T-Table) at the sites over it: at each site the superficial layer must supply
  // what the inner layers (bone, muscles, glands, deep fat) and the skin leave of the table's depth (s.need); the compartments' thickness
  // there is linear in k, so the k solve the sites in the least-squares sense, each site weighted by the table's own spread (1 / s^2: the
  // midline's 1-2.5 mm counts more than the cheek's 6-7), with a pull to FACE6's amount (k = 1) of a tenth of a compartment's own data
  // weight (a compartment no site lies over keeps FACE6's amount), k within [0.5, 2] (FACE6's amounts are literature values too: the table
  // moves them at most a factor two; a first trial at [0.25, 4] put L05's middle cheek at x4, a 14 mm pad under the malar, to raise ONE
  // recalled site that lies at the compartment's edge). Only the T-Table's own landmarks set a parameter (the recalled sg and mal are
  // described, not used). A PARAMETER per compartment and person (sex, age,
  // BMI through the table), never a shape: the skin over the sites is what the layers then build (the fill, the soft solve and the
  // membrane follow), and the table at the sites is reported as before (siteRep), not enforced.
  const amounts = o.amounts === false ? null : solveAmounts(sites, fat, o.amountsOpts || {});   // (orchestrator 16 Oct) amountsOpts: the solve's bounds for a probe (default unchanged)
  // (it6) NO RESIDUAL FIELD: it3-it5 added a smooth field over the sites so the table's depth held 'by construction' (+3-8 mm at the chin,
  // the buccal region, under the molars and at the angle). That was a measurement constructing the form. The skin now lies where the layers
  // put it (and the soft-tissue solve, head/soft.js, carries it under gravity); the table at the sites is a DESCRIPTION of the result
  // (siteRep: 'residual' = what the anatomy lacks against the table, for the anatomist to read, never added back).
  const resid = () => 0;
  const tSF0 = (p, dI) => { const db = G.value(p[0], p[1], p[2]), s = dI != null && dI > -1 && db - dI > 2.5 ? footI(p, dI) : p, f = foot(s); return Math.max(0.15, fat.total(f) + BASE_SUP * 0.6 + resid(f)); };
  // over the nose's cartilage (far from the bone: the bone's foot point says nothing there) the layer is the nasal dorsum's thin
  // fibrofatty layer (0.6 mm), blended over 3 mm where the cartilage stops being the nearest layer
  const tSFw = (p, dC, dR, dI) => { const w = sstep(1.5, -1.5, dC - dR); return w >= 1 ? tNose : (1 - w) * tSF0(p, dI) + w * tNose; };
  const tSF = p => { const dR = Math.min(innerM.d(p[0], p[1], p[2]), deepF.d(p[0], p[1], p[2])), dC = cart.d(p[0], p[1], p[2]); return tSFw(p, dC, dR, Math.min(dR, D.smin(dR, dC, 1.0))); };
  const phiSub = (x, y, z) => { const dR = Math.min(innerM.d(x, y, z), deepF.d(x, y, z)), dC = cart.d(x, y, z), d = Math.min(dR, D.smin(dR, dC, 1.0)); return d - tSFw([x, y, z], dC, dR, d); };
  // the depth AS BUILT along each site's direction: the skin's outer surface (phiSub = skin) found by marching
  // (marched from OUTSIDE in: the skin's outer surface is the outermost crossing; a gap behind a layer, such as the vestibule behind the
  // lip's muscle, is not skin: the membrane (it4) never enters it)
  const depthAlong = (b, n, maxT = 40) => { let prev = null; for (let t = maxT; t >= 0.2; t -= 0.1) { const p = v3.add(b, v3.mul(n, t)), f = phiSub(p[0], p[1], p[2]) - skin(p); if (f < 0) { if (prev == null) return null; return t + 0.1 * (-f) / (prev - f); } prev = f; } return null; };
  const siteRep = sites.map(s => { const d = depthAlong(s.b, s.n); return { id: s.id, key: s.key, table: f2(s.table), built: d == null ? null : f2(d), err: d == null ? null : f2(d - s.table), skin: f2(s.skin), need: f2(s.need), compartments: f2(s.comp), residual: f2(Math.max(0.15, s.need) - s.comp), overshoot: s.need < 0.15 ? f2(s.need - 0.15) : 0, b: r1(s.b), n: s.n.map(f2) }; });
  // the lids' cover over the REAL globe (the orchestrator's 07:22 requirement: >= 0.8 mm outside the palpebral aperture): the skin's
  // outer surface over the globe's front cap, measured along the globe's normals (the aperture is hm08's, kept in it4's fit)
  const cover = {}; for (const s of ['L', 'R']) { const gc = B.globe[s].c, gr = B.globe[s].r; let mn = Infinity, sum = 0, n = 0;
    for (let i = 0; i < 120; i++) { const u = Math.acos(1 - (i + 0.5) / 120 * 0.55), v = 2.39996 * i, dir = [Math.sin(u) * Math.cos(v), Math.sin(u) * Math.sin(v), Math.cos(u)], b = v3.add(gc, v3.mul(dir, gr)), d = depthAlong(b, dir, 20); if (d != null) { mn = Math.min(mn, d); sum += d; n++; } }
    cover[s] = { min: f2(mn), mean: f2(sum / Math.max(1, n)) }; }
  const report = { ms: { boneField: t1 - t0, total: Date.now() - t0 }, soft: soft.report, sites: siteRep, amounts: amounts?.report || null, depths: { src: DEPTH_SRC, version: DEPTHS_VERSION }, cover, muscles: mus.report, fat: fat.report, parotid: parRep, h };
  return { G, box, soft, nose, muscles: mus, fat, skin, inner, innerM, cart, deepF, glands, bone, globes, tSF, phiSub, resid, foot, sites: siteRep, report, version: HEAD_VERSION, versions: { muscles: MUSCLES_VERSION, fat: FAT_VERSION } };
}
// the layers as sdf scenes for the cutaway's columns (each meshed on its own): bone | + muscles (and cartilage, globes) | + fat (the skin's
// underside) | the skin's outer surface
export function cutawayFields(H) {
  return { muscles: H.innerM, fat: { d: H.phiSub, aabb: H.box }, skin: { d: (x, y, z) => H.phiSub(x, y, z) - H.skin([x, y, z]), aabb: H.box } };
}
