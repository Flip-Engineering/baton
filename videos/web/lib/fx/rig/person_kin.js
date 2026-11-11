// RIG / PERSON KIN (HUMAN c8 lane F): the rig and motion systems adopt each person's own kinematic model.
// Lane A's castBody gives every person a p.kin (lib/fx/body/kin.js; schema in review/studio_human_c8/after/body/NOTES.md): joint centres,
// segment masses / COM / inertia from the person's own voxelised mesh, a carrying angle, CDC ranges with hyperextension and soft-tissue
// limits, stance and gait terms. This file is the glue that hands those to the EXISTING rig (balance.js, limits.js, HeroPoser, idleStance,
// Walker, Idle): nothing here is a parallel solver. Everything is opt-in: a hero without meta.kin, or a caller that does not ask, never
// reaches this file.
//
//   const K = kinOf(h)              the kin of a hero built from a person (h.meta.kin), at its rendered height (scaleKin), with lane F's
//                                   derived terms in K.F (cached on the hero); null when the hero has none
//   K.F.segments                    balance.js table: the person's masses, the trunk's and head's off-axis COM as a 6th element
//   K.F.limits                      limits.js table: the person's ranges over AAOS
//   K.F.stance                      { ankleSep, footAngle, hjc, hipBreadth, src }: the relaxed stance (below: not MakeHuman's wide hips)
//   K.F.gait                        kin.gait with the step width re-based on the Harrington hip-joint estimate, + the lateral sway
//   heroPoints(h, K)                balance.js joint names on a posed hero (headTop, fingers, toes and heels ride their bones)
//   heroCom(h, K, segs)             the hero's centre of mass with a person's (or de Leva's, or Dempster's) table
//   twoBoneKin(h, a, b, c, target, pole, hinge)   two-bone IK on hero joints with a hinge's range: max flexion (the soft tissue), and
//                                   hyperextension when `lock` (a locked knee or elbow bends BACK by the person's own extension)
//   carrying(h, side, K, o)         the elbow's carrying angle as joint geometry: the forearm leaves the flexion plane laterally by
//                                   the person's angle x (1 - flex / max) + the varus at full flexion x flex / max, scaled by how far the
//                                   forearm is supinated (palms forward shows it, palms in hides it: PHOTO_REFS finding 5)
//
// STANCE, honestly: lane A's hip joint centres sit 18.9 cm (women) and 22.2 cm (men) apart against 16.1 cm from Harrington et al. 2007 on
// the same pelvis, and its hip breadths read 11-12 % over ANSUR at a matched hip tape. Stance and step width do NOT inherit either:
// the ankles stand STANCE_H[sex] apart (women 0.0685 H, men 0.128 H: the photo library's p50 by sex, below; until 16 Oct the pooled 0.114 H), scaled by the person's hip breadth corrected for that bias and taken relative to ANSUR II's median for her
// sex (square root: our damping, not data), plus lane A's own individual draw. Step width is re-based from the joints to the Harrington
// estimate (exact from the person's pelvis landmarks when the person record is passed, else the joints held to Harrington's norm).
import * as THREE from 'three';
import { SEGMENTS, DELEVA, DELEVA_RG, com } from './balance.js';
import { limitsFor } from './limits.js';
// scaleKin, as lib/fx/body/kin.js has it (copied, not imported: workforce.js imports this file, and CREW8's scenes should not load the body
// studio's modules, which lane P1 is still editing): lengths x s, masses x s^3, inertia x s^5, speed x sqrt s
const r4 = x => Math.round(x * 1e4) / 1e4, r1 = x => Math.round(x * 10) / 10;
export function scaleKin(kin, s) {
  if (s === 1) return kin; const L = v => v.map(x => r4(x * s)), out = JSON.parse(JSON.stringify(kin));
  for (const o of [out.joints, out.landmarks, out.balanceJoints]) for (const k of Object.keys(o)) o[k] = L(o[k]);
  for (const g of Object.values(out.segments)) { g.mass = r4(g.mass * s ** 3); g.com = L(g.com); g.length = r4(g.length * s); g.inertia = g.inertia.map(r => r.map(x => +(x * s ** 5).toExponential(4))); g.deLeva.mass = r4(g.deLeva.mass * s ** 3); g.deLeva.com = L(g.deLeva.com); }
  out.com = L(out.com); out.comDeLeva = L(out.comDeLeva); out.stature = r4(out.stature * s); out.mass = r4(out.mass * s ** 3);
  for (const k of ['hipJointSpacing', 'hipBreadth', 'heelSep', 'ankleSep']) out.stance[k] = r4(out.stance[k] * s);
  for (const k of ['legLength', 'stepLength', 'stepWidth']) out.gait[k] = r4(out.gait[k] * s); out.gait.speed = r4(out.gait.speed * Math.sqrt(s)); out.gait.cadence = r1(out.gait.speed / out.gait.stepLength * 60);
  return out;
}

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), Q = () => new THREE.Quaternion();
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x)), D = Math.PI / 180;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const arr = a => V3(a[0], a[1], a[2]);

// THE QUIET STANCE BY SEX (ANAT8-PELVIS, lane iteration 20, 16 Oct: the orchestrator's 12:00 block gave that lane the women's legs' axis). The
// pooled 0.114 H (c1's 12 fronts; c4's 41 people pooled, 0.115) stood every woman with her ankles at the MEN's width, about 1.7 x the photographed
// women's. The same library read by sex, per person (assets/figure_refs/photo_derived/summary_typical.json stance_front, any_f / any_m; REFS_C4.md):
// women 0.0685 H (18 people, p10-p90 0.029-0.179), men 0.128 H (23 people, 0.102-0.159); over the hip-joint spacing women 0.63, men 1.135: the
// women's legs converge to the feet, the men's stand about plumb. The knee stays on the hip-ankle line (the straight leg's IK): the photographs'
// knee landmarks lie on it too (ANAT8-PELVIS NOTES, lane iteration 20), as the mechanical axis does in standing radiographs (the hip-knee-ankle
// angle within ~1-2 deg of neutral: Moreland JR et al 1987 J Bone Joint Surg Am 69:745; Bellemans J et al 2012 Clin Orthop Relat Res 470:45).
// The band: the library's per-person p10-p90, the women's floor the ankles' own breadths (two ankles touching, ~0.045 H).
export const STANCE_H = { f: 0.0685, m: 0.128 };     // ankle centres / stature, quiet stance, by sex (photo library p50 per person)
export const STANCE_BAND = { f: [0.045, 0.179], m: [0.102, 0.159] };
export const ANSUR_HIPB = { f: 0.2169, m: 0.1963 };  // ANSUR II hip breadth / stature, medians (assets/rig/ansur_subjects.json)
export const MESH_HIPB_BIAS = { f: 1.119, m: 1.108 };   // lane A's hip breadth over ANSUR at a matched hip tape (body_test.mjs medians)
export const HJC_NORM = { f: 0.161 / 1.64, m: 0.161 / 1.75 };   // Harrington 2007 on lane A's cast pelvises (0.161 m, both sexes; body_test.mjs) / the sexes' median statures

// ---------------------------------------------------------------- the kin a hero carries, at its rendered height, with lane F's terms
export function kinOf(h, { kin = null, person = null } = {}) {
  const K0 = kin || h?.meta?.kin; if (!K0 || !K0.joints) return null;
  const s = (h?.o?.height || K0.stature) / K0.stature;
  if (h && h._kinF && h._kinF.src === K0 && h._kinF.s === s) return h._kinF.K;
  const K = s === 1 ? { ...K0 } : scaleKin(K0, s); K.F = derive(K, person, s);   // (a shallow copy at s = 1: lane F's terms never land on p.kin itself)
  if (h) h._kinF = { src: K0, s, K };
  return K;
}
// Harrington et al. 2007 (J Biomech 40:595): hip joint centre 0.33 x inter-ASIS + 7.3 mm medial... lateral of the midline, inter-ASIS on
// the bony pelvis (the skin ASIS distance - 2 cm, lane A's body_test.mjs); from the person's own pre-soft-tissue mesh when it is at hand
export function harringtonHJC(person) {
  const S = person?._S, P = person?.built?.pre, L = S?.landmarks; if (!P || !L || L.asisL == null || L.asisR == null) return null;
  const pw = Math.abs(P[L.asisL * 3] - P[L.asisR * 3]) - 0.02; return 2 * (0.33 * pw + 0.0073);
}
function derive(K, person, s) {
  const sex = K.sex === 'm' ? 'm' : 'f', H = K.stature, st = K.stance, g = K.gait;
  // hip joint spacing, Harrington's estimate
  // without the person record: the joints' own spacing, held to at most 10 % over Harrington's norm for the stature (lane A's first cast had
  // MakeHuman's joints 18.9 / 22.2 cm apart against 16.1; the current one measures within ~2 % of Harrington, kin_test.mjs)
  const hExact = harringtonHJC(person), hjc = hExact != null ? hExact * s : Math.min(st.hipJointSpacing, 1.1 * HJC_NORM[sex] * H);
  // the relaxed stance
  const hb = st.hipBreadth / MESH_HIPB_BIAS[sex], rel = hb / (ANSUR_HIPB[sex] * H);
  const det = clamp(0.17 * s * (st.hipBreadth / s) / (sex === 'f' ? 0.37 : 0.355), 0.08 * s, 0.34 * s);   // lane A's deterministic heel separation...
  const own = clamp(st.heelSep - det, -0.05 * s, 0.05 * s);                                             // ...so this is the person's own draw (+/- 2.5 cm SD)
  const ankleSep = clamp(STANCE_H[sex] * H * Math.sqrt(rel) + 0.6 * own, STANCE_BAND[sex][0] * H, STANCE_BAND[sex][1] * H);
  const stance = { ankleSep, heelSep: ankleSep - 0.01 * s, footAngle: st.footAngle, hjc, hjcSrc: hExact != null ? 'Harrington 2007 on the person\'s pelvis' : 'the joints, at most 1.1 x Harrington\'s norm for the stature',
    hipBreadth: hb, hipBreadthRel: rel, meshJointSpacing: st.hipJointSpacing, src: (sex === 'f' ? '0.0685' : '0.128') + ' H (the photo library\'s p50 for the sex, per person) x sqrt(hip breadth / ANSUR median), hip breadth corrected for the mesh bias; + lane A\'s own draw x 0.6' };
  // gait: the step width on Harrington's spacing, not the mesh's joints; lateral sway from the step width (ours)
  const stepWidth = clamp(g.stepWidth - 0.55 * (st.hipJointSpacing - hjc), 0.03 * s, 0.2 * s);
  const gait = { ...g, stepWidthMesh: g.stepWidth, stepWidth, sway: clamp(0.012 * s + 0.25 * stepWidth, 0.012 * s, 0.05 * s) };
  return { stance, gait, segments: kinSegments(K), limits: limitsFor(K), rg: rgOf(K), sex };
}

// ---------------------------------------------------------------- balance: the person's table, with the off-axis COM of the trunk and head
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], nrm = a => { const l = Math.hypot(...a) || 1; return a.map(x => x / l); };
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export function kinSegments(K) {
  const BJ = K.balanceJoints, Sg = K.segments, out = K.balanceSegments.map(r => r.slice());
  const off = (row, c, ref) => { const A = BJ[row[1]], B = BJ[row[2]], ax = sub(B, A), L = Math.hypot(...ax), a = ax.map(x => x / L), foot = A.map((x, i) => x + ax[i] * row[4]), d = sub(c, foot);
    let l = sub(BJ[ref[1]], BJ[ref[0]]); l = nrm(sub(l, a.map(x => x * dot(l, a)))); const f = crs(l, a);
    return { lat: +(dot(d, l) / L).toFixed(4), fwd: +(dot(d, f) / L).toFixed(4), ref }; };
  const T = ['upperTrunk', 'midTrunk', 'lowerTrunk'].map(n => Sg[n]), mT = T.reduce((a, s) => a + s.mass, 0), cT = [0, 1, 2].map(i => T.reduce((a, s) => a + s.com[i] * s.mass, 0) / mT);
  const iT = out.findIndex(r => r[0] === 'trunk'), iH = out.findIndex(r => r[0] === 'head');
  if (iT >= 0) out[iT][5] = off(out[iT], cT, ['hipR', 'hipL']);
  if (iH >= 0) out[iH][5] = off(out[iH], Sg.head.com, ['shR', 'shL']);
  return out;
}
// radii of gyration by balance.js segment kind: the person's own limbs and head (lane A's voxels), de Leva's whole trunk (the person's is in thirds)
export function rgOf(K) {
  const sex = K.sex === 'm' ? 'm' : 'f', S = K.segments, av = (a, b) => a.rg.map((x, i) => (x + b.rg[i]) / 2);
  return { head: S.head.rg, trunk: DELEVA_RG[sex].trunk, uarm: av(S.upperArm_L, S.upperArm_R), farm: av(S.forearm_L, S.forearm_R), hand: av(S.hand_L, S.hand_R), thigh: av(S.thigh_L, S.thigh_R), shin: av(S.shank_L, S.shank_R), foot: av(S.foot_L, S.foot_R) };
}
// the hero's balance points: joints are bone heads; the vertex, the third knuckle, the heel and the toe tip ride their bones from the bind
const JB = { neck: 'neck01', shL: 'upperarm01.L', elL: 'lowerarm01.L', wrL: 'wrist.L', shR: 'upperarm01.R', elR: 'lowerarm01.R', wrR: 'wrist.R',
  hipL: 'upperleg01.L', knL: 'lowerleg01.L', anL: 'foot.L', hipR: 'upperleg01.R', knR: 'lowerleg01.R', anR: 'foot.R' };
const RIDE = { headTop: ['VERT', 'head', 'AO'], fiL: ['MET3_L', 'wrist.L', 'WJC_L'], fiR: ['MET3_R', 'wrist.R', 'WJC_R'], toL: ['TTIP_L', 'foot.L', 'AJC_L'], toR: ['TTIP_R', 'foot.R', 'AJC_R'],
  heelL: ['HEEL_L', 'foot.L', 'AJC_L'], heelR: ['HEEL_R', 'foot.R', 'AJC_R'] };
// generic offsets (metres at 1.70 m) for a hero with no kin: vertex over the head joint, knuckle past the wrist, toe and heel from the ankle
const RIDE0 = { headTop: [0, 0.135, 0.01], fiL: null, fiR: null, toL: [0, -0.075, 0.18], toR: [0, -0.075, 0.18], heelL: [0, -0.075, -0.05], heelR: [0, -0.075, -0.05] };
export function heroPoints(h, K = null) {
  h.update(); const P = {}, q = Q();
  for (const [k, b] of Object.entries(JB)) P[k] = h.joint(b);
  P.hips = P.hipL.clone().add(P.hipR).multiplyScalar(0.5); P.shoulderMid = P.shL.clone().add(P.shR).multiplyScalar(0.5);
  const s0 = (h.o?.height || 1.7) / 1.7;
  for (const [k, [lm, bone, j]] of Object.entries(RIDE)) {
    let off; if (K) { const L = K.landmarks[lm], J = K.joints[j]; off = V3(L[0] - J[0], L[1] - J[1], L[2] - J[2]); }
    else if (RIDE0[k]) off = arr(RIDE0[k]).multiplyScalar(s0);
    else { P[k] = h.joint(`finger3-1.${k.slice(-1)}`); continue; }   // no kin: the third knuckle's joint
    h.bone(bone).getWorldQuaternion(q); P[k] = h.joint(bone).add(off.applyQuaternion(q));
  }
  return P;
}
export function heroCom(h, K = null, segs = null, out = V3()) { return com(heroPoints(h, K), out, segs || (K ? K.F.segments : SEGMENTS)); }
// the support of the planted feet (heel and toe tip of each, xz) and the centroid
export function heroSupport(h, K = null, feet = ['L', 'R']) { const P = heroPoints(h, K), pts = []; for (const s of feet) pts.push(P['heel' + s], P['to' + s]); return pts; }

// ---------------------------------------------------------------- hinges: flexion range and hyperextension on hero joints
// hinge = { maxFlex (deg), ext (deg of hyperextension the person has), lock (0..1: how far into it a straight limb goes) }
// The bend is toward `pole` (the knee forward, the elbow back); a locked limb bends the other way by ext x lock. Returns the miss (m)
// and the flexion it set (deg, negative = hyperextended).
export function twoBoneKin(h, a, b, c, target, pole, hinge = {}) {
  h.update();
  const A = h.joint(a), B = h.joint(b), C = h.joint(c), L1 = A.distanceTo(B), L2 = B.distanceTo(C);
  const dAt = deg => Math.sqrt(L1 * L1 + L2 * L2 + 2 * L1 * L2 * Math.cos(deg * D));     // reach at a flexion (0 = straight)
  const max = hinge.maxFlex ?? 179, ext = Math.max(0, hinge.ext || 0), lock = clamp(hinge.lock || 0);
  let want = A.distanceTo(target), sgn = 1, flexOut;
  const dLock = dAt(ext * lock), dMin = dAt(Math.min(179, max));
  // (straight is (L1 + L2) x 0.99995 here, ~1 deg: HeroPoser's 0.999 leaves a 'straight' knee bent 5 deg)
  const dMax = (L1 + L2) * 0.99995; let d = clamp(want, Math.max(Math.abs(L1 - L2) + 1e-4, dMin), dMax);
  // locked: a target at or past the locked reach bends the hinge BACK (to the full lock when it is out of reach: a locked knee is a hair shorter)
  if (lock > 0 && ext > 0 && want >= dLock - 2e-4) { d = want > dMax ? dLock : Math.max(dLock, want); sgn = -1; }
  const ax = target.clone().sub(A).normalize(), pl0 = pole.clone().multiplyScalar(sgn), pl = pl0.addScaledVector(ax, -pl0.dot(ax)).normalize();
  const cosA = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  const Bt = A.clone().addScaledVector(ax, L1 * cosA).addScaledVector(pl, L1 * sinA), Ct = A.clone().addScaledVector(ax, d);
  const aim = (bone, from, cur, to) => { const u = cur.clone().sub(from).normalize(), v = to.clone().sub(from).normalize(), axis = V3().crossVectors(u, v), s = axis.length(); if (s < 1e-7) return; h.rotateWorld(bone, axis.normalize(), Math.atan2(s, u.dot(v))); h.update(); };
  aim(a, A, B, Bt); aim(b, h.joint(b), h.joint(c), Ct);
  const cosB = clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1); flexOut = sgn * (180 - Math.acos(cosB) / D);
  return { miss: h.joint(c).distanceTo(target), flex: flexOut, clamped: want < dMin - 1e-4 ? 'flex' : want > dMax ? 'reach' : null };
}
// the person's hinge for the knee and the elbow (deg); a hero without kin gets the AAOS table's
export function hingeOf(K, joint) {
  if (!K) return joint === 'knee' ? { maxFlex: 135, ext: 0 } : { maxFlex: 150, ext: 0 };
  return joint === 'knee' ? { maxFlex: K.rom.kneeFlex.deg, ext: Math.max(0, K.rom.kneeExt.deg), limitedBy: K.rom.kneeFlex.limitedBy } : { maxFlex: K.rom.elbowFlex.deg, ext: Math.max(0, K.rom.elbowExt.deg), limitedBy: K.rom.elbowFlex.limitedBy };
}

// ---------------------------------------------------------------- the elbow's carrying angle as joint geometry
// the arm's frame on a hero: u (shoulder -> elbow), f (elbow -> wrist), ant (the side the forearm flexes toward), lat (radial / lateral)
export function armFrame(h, side, pole = null) {
  h.update(); const S = h.joint(`upperarm01.${side}`), E = h.joint(`lowerarm01.${side}`), W = h.joint(`wrist.${side}`), sg = side === 'L' ? 1 : -1;
  const u = E.clone().sub(S).normalize(), f = W.clone().sub(E), L2 = f.length(); f.normalize();
  const flex = Math.acos(clamp(u.dot(f), -1, 1)) / D;
  // the side the forearm flexes toward: the forearm itself when the elbow is bent (> ~20 deg), else away from the IK's elbow pole
  let ant = f.clone().addScaledVector(u, -f.dot(u));
  if (ant.length() < 0.35 && pole && pole.lengthSq() > 0) { const p = pole.clone().negate(); p.addScaledVector(u, -p.dot(u)); if (p.lengthSq() > 1e-8) ant = p; }
  if (ant.lengthSq() < 1e-8) { const gq = Q(); h.group.getWorldQuaternion(gq); ant = V3(0, 0, 1).applyQuaternion(gq); ant.addScaledVector(u, -ant.dot(u)); }
  ant.normalize(); const lat = V3().crossVectors(ant, u).multiplyScalar(sg).normalize();
  // supination: the palm normal about the forearm, from neutral (palm medial, 0) toward forward (palm anterior, +90)
  const n = h.palm(side).n.clone(); n.addScaledVector(f, -n.dot(f)); const antF = ant.clone().addScaledVector(f, -ant.dot(f)).normalize(), latF = lat.clone().addScaledVector(f, -lat.dot(f)).normalize();
  const sup = Math.atan2(n.dot(antF), -n.dot(latF)) / D, valgus = Math.asin(clamp(f.dot(lat), -1, 1)) / D;
  return { S, E, W, u, f, L2, flex, ant, lat, sup, valgus };
}
// the carrying angle the elbow shows (deg) at a flexion and a supination
export function valgusDeg(K, flexDeg, supDeg) {
  if (!K?.carryingAngle) return 0; const ca = K.carryingAngle, u = clamp(flexDeg / Math.max(60, K.rom?.elbowFlex?.deg || 145));
  return (ca.deg * (1 - u) + (ca.atFullFlexion ?? -2) * u) * sstep(0, 90, supDeg);
}
// set it: keep 'upper' turns the forearm only (a hanging arm: the hand carries out from the hip); keep 'wrist' also turns the whole arm
// about the shoulder so the wrist stays on `target` (a hand on a handle). Returns { deg, flex, sup }.
export function carrying(h, side, K, { pole = null, keep = 'upper', target = null } = {}) {
  if (!K) return null;
  let A = armFrame(h, side, pole); const L1 = A.S.distanceTo(A.E);
  let fl = A.f.clone().addScaledVector(A.lat, -A.f.dot(A.lat)); const delta = Math.acos(clamp(A.u.dot(fl.clone().normalize()), -1, 1)); fl.normalize();
  const ant = fl.clone().addScaledVector(A.u, -fl.dot(A.u)); if (ant.lengthSq() < 1e-8) ant.copy(A.ant); ant.normalize();
  let phi = delta, v = valgusDeg(K, phi / D, A.sup) * D;
  if (keep === 'wrist') for (let i = 0; i < 3; i++) { const cd = Math.cos(Math.acos(clamp(A.u.dot(A.f), -1, 1))); phi = Math.acos(clamp(cd / Math.cos(v), -1, 1)); v = valgusDeg(K, phi / D, A.sup) * D; }
  const fNew = A.u.clone().multiplyScalar(Math.cos(phi)).addScaledVector(ant, Math.sin(phi)).multiplyScalar(Math.cos(v)).addScaledVector(A.lat, Math.sin(v)).normalize();
  const qd = Q().setFromUnitVectors(A.f, fNew), ang = 2 * Math.acos(clamp(qd.w, -1, 1));
  if (ang > 1e-6) { const axis = V3(qd.x, qd.y, qd.z).normalize(); h.rotateWorld(`lowerarm01.${side}`, axis, ang); h.update(); }
  if (keep === 'wrist') { const tgt = target || A.W, S = h.joint(`upperarm01.${side}`), W2 = h.joint(`wrist.${side}`), q2 = Q().setFromUnitVectors(W2.sub(S).normalize(), tgt.clone().sub(S).normalize()), a2 = 2 * Math.acos(clamp(q2.w, -1, 1));
    if (a2 > 1e-6) { h.rotateWorld(`upperarm01.${side}`, V3(q2.x, q2.y, q2.z).normalize(), a2); h.update(); } }
  void L1; return { deg: v / D, flex: phi / D, sup: A.sup };
}
