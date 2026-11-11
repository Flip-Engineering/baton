// WORKFORCE (HUMAN c6): people as a population, not a default man. One place that turns "who is this worker" into
// figures for every distance the slate uses, and poses them standing the way people stand.
//
//   import { castHero, idleStance, CREW8 } from '../lib/fx/workforce.js';
//   const A = await loadAnsur();                                      // rig/body.js: real ANSUR II subjects
//   const { opts, body, apply } = castHero(CREW8[2], A);             // a hero.js mesh of the right sex and age, dressed, with an ANSUR body
//   const h = new Hero(data, opts); apply(h); idleStance(h, CREW8[2]); // weight on one leg, arms hanging and relaxed, the head turned
//
// The hero meshes are the c6 population bake (scripts/bake_hero.py: ada, june, mei, rosa, walt, otis, kai, ray beside the three
// cycle-1 men). Clothing options are hero.js's c6 options (vest, coverall, wear, sweat, folds, hairStyle, hatWear, ease).
// { old: true } gives the c5 pipeline for before/after: one of the three male meshes chosen by build, no wear, no vest, the
// symmetric upright stand.
import * as THREE from 'three';
import { sampleBody, heroOptions, applyBody, mulberry32 } from './rig/body.js';
import { People } from './people.js';
import { dress, dyes, crowdCloth } from './cloth/wardrobe.js';
import { kinOf, twoBoneKin, hingeOf, carrying, heroCom } from './rig/person_kin.js';
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

// the line-up cast: eight people a plant would actually employ, dressed for the job (neutral: no piece's world)
export const CREW8 = [
  { name: 'Ada', variant: 'ada', sex: 'f', age: [30, 38], build: 'average', kind: 'coverall', shirt: '#2c3a52', hat: 'hard', hatColor: '#e8e6de', hairStyle: 'bun', hair: '#141010', skin: '#6e4430',
    wear: 0.55, sweat: 0.45, gloves: false, stance: 'rest', weight: 0.85, look: -0.25, seed: 41, sticker: '#c83a20' },
  { name: 'Walt', variant: 'walt', sex: 'm', age: [58, 68], build: 'lean', kind: 'coat', shirt: '#6e5a3a', shirt2: '#3a2c1c', trousers: '#3a3a36', trouserKind: 3, hat: 'cap', hatColor: '#3a3428', hair: '#9a948c',
    skin: '#c89a7a', beard: 0.55, stubble: 0.8, wear: 0.75, sweat: 0.1, stance: 'hip', weight: -0.6, look: 0.2, seed: 42 },
  { name: 'Rosa', variant: 'rosa', sex: 'f', age: [40, 48], build: 'stocky', kind: 'flannel', shirt: '#6a1c1c', shirt2: '#1a1414', trousers: '#2c3e5e', vest: 'orange', hat: 'hard', hatColor: '#e8c020', hairStyle: 'tail',
    hair: '#2a1a12', skin: '#b07a58', wear: 0.45, sweat: 0.3, gloves: true, gloveColor: '#8a6a3a', stance: 'hip', weight: 0.6, look: 0.35, seed: 43, sticker: '#2a5ab0' },
  { name: 'Otis', variant: 'otis', sex: 'm', age: [52, 60], build: 'heavy', kind: 'work', shirt: '#4a5058', trousers: '#5a4630', trouserKind: 3, vest: 'hivis', hat: 'hard', hatColor: '#f0eee6', hair: '#1a1410',
    skin: '#4e3020', beard: 0.25, stubble: 0.7, wear: 0.5, sweat: 0.65, stance: 'rest', weight: -0.75, look: -0.1, seed: 44 },
  { name: 'Kai', variant: 'kai', sex: 'm', age: [19, 24], build: 'lean', kind: 'tee', shirt: '#2a2c30', trousers: '#34486a', hat: 'knit', hatColor: '#6a2a1c', hair: '#0e0a08', skin: '#c8956e',
    beard: 0, stubble: 0.2, wear: 0.35, sweat: 0.25, gloves: true, gloveColor: '#c8b070', stance: 'rest', weight: 0.9, look: -0.45, seed: 45 },
  { name: 'June', variant: 'june', sex: 'f', age: [48, 56], build: 'heavy', kind: 'leather', shirt: '#5a3a24', shirt2: '#2a1a10', trousers: '#2a2a2c', hat: 'knit', hatColor: '#2a3a4a', hairStyle: 'short', hair: '#6a5a4a',
    skin: '#d8a888', wear: 0.7, sweat: 0.35, stance: 'rest', weight: -0.8, look: 0.15, seed: 46 },
  { name: 'Ray', variant: 'ray', sex: 'm', age: [35, 42], build: 'average', kind: 'coverall', shirt: '#d8641c', hat: 'hard', hatColor: '#2a5ab0', hair: '#1a1410', skin: '#8a5a3c',
    beard: 0.1, stubble: 0.9, wear: 0.6, sweat: 0.55, gloves: true, gloveColor: '#3a3a3a', stance: 'rest', weight: 0.7, look: 0.3, seed: 47, sticker: '#e8c020' },
  { name: 'Mei', variant: 'mei', sex: 'f', age: [23, 29], build: 'lean', kind: 'work', shirt: '#7a8a9a', trousers: '#2e3440', vest: 'hivis', hat: 'hard', hatColor: '#f0eee6', hairStyle: 'tail', hair: '#0a0808',
    skin: '#d0a07a', wear: 0.3, sweat: 0.4, stance: 'rest', weight: -0.7, look: -0.3, seed: 48, sticker: '#2a8a3a' },
];

// hero options + an ANSUR body for a spec. { old } = the c5 pipeline (male meshes by build, no c6 options)
export function castHero(spec, A, { old = false, rng = null, c7 = false, cloth = false } = {}) {
  const r = rng || mulberry32(spec.seed * 101 + 7);
  const b = A ? sampleBody(A, r, { sex: spec.sex, age: spec.age, build: spec.build }) : null;
  const height = spec.height || (b ? b.statureM : spec.sex === 'f' ? 1.63 : 1.76);
  const ageK = b ? clamp((b.ageY - 20) / 50) : 0.3;
  const base = { height, kind: spec.kind, shirt: spec.shirt, shirt2: spec.shirt2 || '#1a1a1a', trousers: spec.trousers || '#2c3e5e', trouserKind: spec.trouserKind ?? 2, hat: spec.hat || 'none', hatColor: spec.hatColor || '#e8c020',
    hair: spec.hair, skin: spec.skin, beard: spec.beard ?? 0, stubble: spec.stubble ?? (spec.sex === 'f' ? 0 : 0.5), age: 0.1 + 0.85 * ageK, seed: spec.seed, gloves: !!spec.gloves, gloveColor: spec.gloveColor, boots: spec.boots || '#2a1c12', dirt: 0.15 + 0.35 * (spec.wear || 0) };
  if (old) {
    const ho = b ? heroOptions(b, { outfit: spec.kind === 'coverall' ? 'work' : spec.kind }) : { variant: 'forge' };
    return { body: b, opts: { ...base, variant: ho.variant, kind: spec.kind === 'coverall' ? 'work' : spec.kind, dirt: 0.25 }, apply: h => { if (b) applyBody(h, b); } };
  }
  const opts = { ...base, variant: spec.variant, vest: spec.vest || null, wear: spec.wear || 0, sweat: spec.sweat || 0, folds: 1, hairStyle: spec.hairStyle || 'short', hairLen: spec.sex === 'f' ? 1.6 : 1, ease: 1.6, sticker: spec.sticker, ...(c7 ? { c7: true } : {}) };   // HUMAN c7: the c7 garment, skin and drape options (hero.js o.c7)
  if (cloth) Object.assign(opts, dyes(spec), { cloth: dress(spec) });   // CLOTHING c1: garments in named fabrics (cloth/wardrobe.js), the dyes those fabrics take
  return { body: b, opts, apply: h => { if (b) applyBody(h, b, { lengths: true }); } };
}
// a hand opened to the bind (for HandRig: it closes from its own rest, not from a relaxed curl on top)
export function openHand(h, side) { for (let n = 1; n <= 5; n++) for (let k = 1; k <= 3; k++) { const B = h.bone(`finger${n}-${k}.${side}`); if (B) B.quaternion.identity(); } for (let n = 1; n <= 4; n++) { const B = h.bone(`metacarpal${n}.${side}`); if (B) B.quaternion.identity(); } h.update(); }

// ---------------------------------------------------------------- posing a hero standing the way people stand
// two-bone IK on hero bones (a: root joint, b: middle, c: end): put c's joint at `target`, bending toward `pole`
export function twoBoneHero(h, a, b, c, target, pole) {
  h.update();
  const A = h.joint(a), B = h.joint(b), C = h.joint(c), L1 = A.distanceTo(B), L2 = B.distanceTo(C);
  const d = clamp(A.distanceTo(target), Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4);
  const ax = target.clone().sub(A).normalize(), pl = pole.clone().addScaledVector(ax, -pole.dot(ax)).normalize();
  const cosA = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  const Bt = A.clone().addScaledVector(ax, L1 * cosA).addScaledVector(pl, L1 * sinA);
  const aim = (bone, from, cur, to) => { const u = cur.clone().sub(from).normalize(), v = to.clone().sub(from).normalize(), axis = new THREE.Vector3().crossVectors(u, v); const s = axis.length(); if (s < 1e-6) return; h.rotateWorld(bone, axis.normalize(), Math.atan2(s, u.dot(v))); h.update(); };
  aim(a, A, B, Bt); const B2 = h.joint(b), C2 = h.joint(c); aim(b, B2, C2, target);
  return h.joint(c).distanceTo(target);
}
function worldQ(h, n) { h.update(); const q = new THREE.Quaternion(); h.bone(n).getWorldQuaternion(q); return q; }
function setWorldQ(h, n, qw) { const B = h.bone(n), pq = new THREE.Quaternion(); B.parent.getWorldQuaternion(pq); B.quaternion.copy(pq.invert().multiply(qw)); h.update(); }
function frame(h) { h.update(); const q = new THREE.Quaternion(); h.group.getWorldQuaternion(q); return { fwd: V3(0, 0, 1).applyQuaternion(q), lat: V3(1, 0, 0).applyQuaternion(q), up: V3(0, 1, 0) }; }
// roll a forearm (and the wrist after it) about the forearm axis so the palm normal turns toward `want`
function palmToward(h, side, want, k = 0.75) {
  for (let it = 0; it < 2; it++) { const E = h.joint(`lowerarm01.${side}`), axis = h.joint(`wrist.${side}`).sub(E).normalize();
    const ww = want.clone().addScaledVector(axis, -want.dot(axis)).normalize(), sa = n => { const nn = n.clone().addScaledVector(axis, -n.dot(axis)).normalize(); return Math.atan2(new THREE.Vector3().crossVectors(nn, ww).dot(axis), nn.dot(ww)); };
    h.rotateWorld(`lowerarm01.${side}`, axis, sa(h.palm(side).n) * k); h.update(); h.rotateWorld(`wrist.${side}`, axis, sa(h.palm(side).n)); h.update(); }
}
// an arm hanging: upper arm down and a little out and back, elbow soft, palm turned to the thigh, fingers relaxed
export function restArm(h, side, { out = 0.12, back = 0.04, elbow = 0.22, relax = 1, cascade = true } = {}) {
  const F = frame(h), sg = side === 'L' ? 1 : -1, S = h.joint(`upperarm01.${side}`), E = h.joint(`lowerarm01.${side}`), Wr = h.joint(`wrist.${side}`);
  const L1 = S.distanceTo(E), L2 = E.distanceTo(Wr);
  const dU = V3(0, -1, 0).addScaledVector(F.lat, sg * out).addScaledVector(F.fwd, -back).normalize();
  const Et = S.clone().addScaledVector(dU, L1), dF = dU.clone().applyAxisAngle(F.lat, -elbow).normalize();
  twoBoneHero(h, `upperarm01.${side}`, `lowerarm01.${side}`, `wrist.${side}`, Et.clone().addScaledVector(dF, L2), F.fwd.clone().negate());
  palmToward(h, side, F.lat.clone().multiplyScalar(-sg).addScaledVector(F.fwd, -0.25).normalize());
  if (relax) h.relaxHand(side, relax, { cascade });
}
// a hand on the hip (the back of the hand on the iliac crest, elbow out) or thumbs hooked at the belt front
function handTo(h, side, kind) {
  const F = frame(h), sg = side === 'L' ? 1 : -1, hip = h.joint(`upperleg01.${side}`), pel = h.joint('root');
  let Wt, pole;
  if (kind === 'hip') { Wt = hip.clone().add(V3(0, 0.12, 0)).addScaledVector(F.lat, sg * 0.11).addScaledVector(F.fwd, -0.01); pole = F.lat.clone().multiplyScalar(sg).addScaledVector(F.fwd, -0.6); }
  else { Wt = pel.clone().add(V3(0, 0.02, 0)).addScaledVector(F.lat, sg * 0.11).addScaledVector(F.fwd, 0.16); pole = F.lat.clone().multiplyScalar(sg * 0.6).addScaledVector(F.fwd, -1); }
  twoBoneHero(h, `upperarm01.${side}`, `lowerarm01.${side}`, `wrist.${side}`, Wt, pole);
  palmToward(h, side, kind === 'hip' ? F.lat.clone().multiplyScalar(-sg).addScaledVector(F.up, -0.3).normalize() : F.fwd.clone().negate(), 0.8);
  h.relaxHand(side, kind === 'hip' ? 1.25 : 0.7, { cascade: kind !== 'hip' });
}
// the standing pose: weight on one leg (w: +1 left, -1 right). The pelvis shifts over the standing foot and drops on the free
// side; the free knee bends and the free foot sits a little forward and turned out; the spine and shoulders counter-tilt; the
// head turns. old: the c5 stand (symmetric, upright, arms straight down).
// HUMAN c8 lane F: { kin: true } on a hero built from a person (lane A's castBody: h.meta.kin) stands that person by her own kinematic model
// (idleStanceKin below); without it, or for a hero with no kin, nothing here changes.
export function idleStance(h, spec = {}, { old = false, kin = false, person = null } = {}) {
  const K = !old && kin ? kinOf(h, { kin: kin === true ? null : kin, person }) : null;
  if (K) return idleStanceKin(h, spec, K);
  h.resetPose(); h.update();
  const F = frame(h), w = old ? 0 : (spec.weight ?? 0.6), sideW = w >= 0 ? 'L' : 'R', sideF = w >= 0 ? 'R' : 'L', a = Math.abs(w), sgW = w >= 0 ? 1 : -1;
  if (!old) {
    const ank = { L: h.joint('foot.L'), R: h.joint('foot.R') }, fq = { L: worldQ(h, 'foot.L'), R: worldQ(h, 'foot.R') };
    const tW = ank[sideW].clone().addScaledVector(F.lat, -sgW * 0.025 * a), tF = ank[sideF].clone().addScaledVector(F.fwd, 0.09 * a).addScaledVector(F.lat, -sgW * 0.035 * a);
    const root = h.bone('root'); root.position.x += sgW * 0.045 * a / h.scale; root.position.y -= 0.012 * a / h.scale; h.update();
    h.rotateWorld('root', F.fwd, -sgW * 0.07 * a); h.rotateWorld('root', F.up, -sgW * 0.05 * a); h.update();
    h.rotateWorld('spine05', F.fwd, sgW * 0.04 * a); h.rotateWorld('spine03', F.fwd, sgW * 0.05 * a); h.rotateWorld('spine01', F.fwd, sgW * 0.02 * a);
    const age = clamp(((spec.age ? spec.age[0] : 30) - 35) / 35); h.rotateWorld('spine03', F.lat, 0.04 + 0.12 * age); h.rotateWorld('neck01', F.lat, -0.02 - 0.06 * age); h.update();
    for (const [s, t] of [[sideW, tW], [sideF, tF]]) twoBoneHero(h, `upperleg01.${s}`, `lowerleg01.${s}`, `foot.${s}`, t, F.fwd.clone().addScaledVector(F.lat, (s === 'L' ? 1 : -1) * 0.25));
    setWorldQ(h, `foot.${sideW}`, fq[sideW]); setWorldQ(h, `foot.${sideF}`, new THREE.Quaternion().setFromAxisAngle(F.up, -sgW * 0.22 * a).multiply(fq[sideF]));
    h.rotateWorld('neck01', F.up, (spec.look || 0) * 0.5); h.rotateWorld('head', F.up, (spec.look || 0) * 0.5); h.rotateWorld('head', F.fwd, -sgW * 0.04 * a); h.rotateWorld('head', F.lat, 0.03); h.update();
  }
  const st = old ? 'rest' : (spec.stance || 'rest');
  for (const s of ['L', 'R']) {
    if (st === 'hip' && s === sideF) handTo(h, s, 'hip');
    else if (st === 'thumbs') handTo(h, s, 'thumbs');
    else restArm(h, s, old ? { out: 0.08, back: 0, elbow: 0.05, relax: 0.7, cascade: false } : { out: 0.1 + (s === sideW ? 0.05 : 0), back: 0.03 + (s === sideF ? 0.04 : 0), elbow: s === sideW ? 0.18 : 0.3, relax: s === sideW ? 1.0 : 0.85 });
  }
  h.update(); return h;
}

// HUMAN c8 lane F: the same standing pose from the person's kinematic model (rig/person_kin.js; lane A's p.kin):
//   feet    the ankles stand K.F.stance.ankleSep apart (0.114 H scaled by the corrected hip breadth: the photo library's quiet stance, about
//           half the bind spacing idleStance uses), each turned out by half the person's foot angle; the free foot a little forward
//   weight  the pelvis shifts until the COM of the person's own segments sits (0.5 + 0.4 w) of the way to the standing foot; that knee
//           locks into the person's own hyperextension in proportion to the weight (a woman's 2 deg, most men's ~0)
//   age     kyphosis and head-forward from kin.gait.posture (age and bulk) in place of spec.age; pregnancy's lumbar extension
//   arms    hanging clear of the person's own hips; the carrying angle set at the elbow (palms in: it hardly shows, as in photographs)
export function idleStanceKin(h, spec, K) {
  h.resetPose(); h.update();
  const F = frame(h), w = spec.weight ?? 0.6, sideW = w >= 0 ? 'L' : 'R', sideF = w >= 0 ? 'R' : 'L', a = Math.abs(w), sgW = w >= 0 ? 1 : -1, s = h.o.height / 1.7;
  const ST = K.F.stance, half = ST.ankleSep / 2, toe = ST.footAngle / 2 * Math.PI / 180, P = K.gait.posture || {}, kn = hingeOf(K, 'knee');
  const ank = { L: h.joint('foot.L'), R: h.joint('foot.R') }, fq = { L: worldQ(h, 'foot.L'), R: worldQ(h, 'foot.R') }, mid = ank.L.clone().add(ank.R).multiplyScalar(0.5);
  const tgt = { [sideW]: mid.clone().addScaledVector(F.lat, sgW * half), [sideF]: mid.clone().addScaledVector(F.lat, -sgW * half).addScaledVector(F.fwd, 0.07 * s * a) };
  const root = h.bone('root'); root.position.y -= 0.012 * a / h.scale; h.update();
  h.rotateWorld('root', F.fwd, -sgW * 0.07 * a); h.rotateWorld('root', F.up, -sgW * 0.05 * a); h.update();
  h.rotateWorld('spine05', F.fwd, sgW * 0.04 * a); h.rotateWorld('spine03', F.fwd, sgW * 0.05 * a); h.rotateWorld('spine01', F.fwd, sgW * 0.02 * a);
  h.rotateWorld('spine03', F.lat, 0.75 * (P.kyphosis ?? 0.05)); h.rotateWorld('neck01', F.lat, -0.5 * (P.headFwd ?? 0.04));
  if (P.lumbarExtension) { h.rotateWorld('spine05', F.lat, -P.lumbarExtension * 0.5); h.rotateWorld('spine04', F.lat, -P.lumbarExtension * 0.5); }
  h.update();
  const legs = () => { const r = {};
    for (const sd of [sideW, sideF]) r[sd] = twoBoneKin(h, `upperleg01.${sd}`, `lowerleg01.${sd}`, `foot.${sd}`, tgt[sd], F.fwd.clone().addScaledVector(F.lat, (sd === 'L' ? 1 : -1) * 0.25), { ...kn, lock: sd === sideW ? a : 0 });
    setWorldQ(h, `foot.${sideW}`, new THREE.Quaternion().setFromAxisAngle(F.up, sgW * toe).multiply(fq[sideW]));
    setWorldQ(h, `foot.${sideF}`, new THREE.Quaternion().setFromAxisAngle(F.up, -sgW * (toe + 0.22 * a)).multiply(fq[sideF])); return r; };
  // the weight: shift the pelvis until the person's COM is over the standing side by (0.5 + 0.4 a) of the half stance
  // the standing leg straight (locked to the person's own hyperextension x the weight): with the feet under the hips the A-pose bind's
  // hip height would bend both knees, so the pelvis rises until that leg reaches; the free knee bends
  const L1 = h.joint(`upperleg01.${sideW}`).distanceTo(h.joint(`lowerleg01.${sideW}`)), L2 = h.joint(`lowerleg01.${sideW}`).distanceTo(h.joint(`foot.${sideW}`)), lockDeg = kn.ext * a;
  const dLock = Math.min(Math.sqrt(L1 * L1 + L2 * L2 + 2 * L1 * L2 * Math.cos(lockDeg * Math.PI / 180)), (L1 + L2) * 0.99995);
  const lift = () => { const Hp = h.joint(`upperleg01.${sideW}`), T = tgt[sideW], dx = Hp.clone().sub(T).dot(F.lat), dz = Hp.clone().sub(T).dot(F.fwd), y = T.y + Math.sqrt(Math.max(1e-6, dLock * dLock - dx * dx - dz * dz));
    root.position.y += (y - Hp.y) / h.scale; h.update(); };
  let rep = null, errMm = 0;
  for (let it = 0; it < 5; it++) { lift(); rep = legs(); const C = heroCom(h, K), want = mid.clone().addScaledVector(F.lat, sgW * half * (0.5 + 0.4 * a)), e = C.clone().sub(want).dot(F.lat); errMm = e * 1000;
    if (Math.abs(e) < 0.002 && it) break; root.position.x -= e / h.scale; h.update(); }
  lift(); rep = legs();
  h.rotateWorld('neck01', F.up, (spec.look || 0) * 0.5); h.rotateWorld('head', F.up, (spec.look || 0) * 0.5); h.rotateWorld('head', F.fwd, -sgW * 0.04 * a); h.rotateWorld('head', F.lat, 0.03); h.update();
  // arms: clear of the hips (the mesh's own hip breadth: the forearm is ~3 cm thick), carrying angle at the elbow
  const st = spec.stance || 'rest', carry = {};
  for (const sd of ['L', 'R']) {
    if (st === 'hip' && sd === sideF) { handTo(h, sd, 'hip'); continue; } if (st === 'thumbs') { handTo(h, sd, 'thumbs'); continue; }
    const S = h.joint(`upperarm01.${sd}`), arm = S.distanceTo(h.joint(`lowerarm01.${sd}`)) + h.joint(`lowerarm01.${sd}`).distanceTo(h.joint(`wrist.${sd}`)), sx = Math.abs(S.clone().sub(h.joint('root')).dot(F.lat));
    const clear = Math.asin(clamp((K.stance.hipBreadth / 2 + 0.03 - sx) / (0.85 * arm), 0, 0.5));
    restArm(h, sd, { out: Math.max(0.1 + (sd === sideW ? 0.05 : 0), clear), back: 0.03 + (sd === sideF ? 0.04 : 0), elbow: sd === sideW ? 0.18 : 0.3, relax: 0 });
    carry[sd] = carrying(h, sd, K, { pole: F.fwd.clone().negate(), keep: 'upper' });
    h.relaxHand(sd, sd === sideW ? 1.0 : 0.85, { cascade: true });
  }
  h.update(); h._stanceKin = { ankleSep: ST.ankleSep, toeOutDeg: ST.footAngle, comErrMm: errMm, kneeLockDeg: rep[sideW].flex, carry }; return h;
}

// ---------------------------------------------------------------- people.js workers (mid distance and crowds)
// A People.add() descriptor for one worker of a real workforce: sex by share (default 27 % women), stature and proportions from one
// ANSUR II subject (people.js d.body: legs, torso, arms, shoulders, hips, girth), age, build, the trade's clothes plus the c6 kinds
// ('coverall': one garment, optional reflective bands; 'shirt': no vest), c6 surface (wear, folds, darker retro tape) and a gait
// of its own (speed from the Froude number on the subject's leg, stride, arm swing, phase). Height spread is the survey's own: about
// 7 cm SD within a sex and 13 cm between the sexes, so a crowd's heads make a ragged line.
const COVER = ['#2c3a52', '#d8641c', '#4a5a3e', '#3a3a40', '#6a2a1c', '#b8a888', '#1e2a3a'];
const pickR = (r, a) => a[Math.floor(r() * a.length) % a.length];
export function workerDesc(A, rng, { trade = null, sex = null, women = 0.27, age = null, c6 = true, seed = null, wear = null, c7 = false, cloth = false } = {}) {
  const sd = seed ?? Math.floor(rng() * 1e6), f = sex ? sex === 'f' : rng() < women;
  const kind = trade || pickR(rng, ['steel', 'steel', 'farm', 'rail', 'overalls', 'weld', 'coverall', 'coverall', 'shirt', 'shirt']);
  const tr = kind === 'coverall' || kind === 'shirt' ? 'steel' : kind;
  const d = People.varied(tr, sd);
  d.fem = f ? 1 : 0;
  if (f) { d.beard = false; d.stubble = false; if (!d.hat || rng() < 0.6) d.hairStyle = rng() < 0.55 ? 3 : 2; }
  else if (d.hairStyle >= 2) d.hairStyle = 1;
  const b = A ? sampleBody(A, rng, { sex: f ? 'f' : 'm', age }) : null;
  if (b) { const k = b.k;
    d.h = b.statureM;
    d.body = { leg: (k.thigh + k.shin) / 2, torso: k.torso, arm: (k.upperArm + k.foreArm) / 2, sh: k.shoulders * (f ? 0.95 : 1), hip: k.hips * (f ? 1.06 : 1), girth: 1 + 0.42 * b.fat, neck: f ? 0.9 : k.neck };
    d.heavy = clamp((b.bmi - 21) / 11); d.age = clamp((b.ageY - 18) / 45 + 0.3 * rng() * rng()); d._ansur = b.summary; }
  else d.h = (f ? 1.63 : 1.76) + 0.07 * (rng() + rng() + rng() - 1.5);
  if (kind === 'coverall') { const c = pickR(rng, COVER); d.top = d.bottom = c; d.coverall = true; d.bands = rng() < 0.55; d.accent = c; }
  if (kind === 'shirt') d.noVest = true;
  if (c6) { d.c6 = true; d.wear = wear ?? 0.2 + 0.6 * rng(); }
  if (c7) d.backs = true;                                          // HUMAN c7: the garment's back construction (people.js d.backs)
  // gait: Froude-scaled speed on the leg (a stroll 0.2, brisk 0.33), stride and swing from age and build, a phase of its own
  const leg = 0.53 * d.h, fr = 0.2 + 0.13 * rng() - 0.05 * d.age;
  d.gait = { speed: Math.sqrt(Math.max(0.08, fr) * 9.81 * leg), amt: 0.82 + 0.25 * rng() - 0.12 * d.age, swing: 1 - 0.3 * d.age - 0.15 * d.heavy, ph0: rng() * 6.283, lean: 0.03 + 0.08 * d.age };
  d.kind = kind; d.seed = sd;
  if (cloth) crowdCloth(d, mulberry32(sd ^ 0x5eed));               // CLOTHING c1: dressed from the same fabric families as the heroes (d.fabric);
                                                                   // its own rng from the worker's seed, so cloth on keeps the same crowd
  return d;
}
