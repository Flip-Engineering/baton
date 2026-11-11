// MECHA PROLETARIAT (8 Oct, the asset remake): the giant's choreography on ERECTOR's own rig (lib/fx/modeling/erect/rigkit.js:
// feet placed as toe pads, legs solved to them, the centre of mass kept over what holds it up) and MODELING's acts.
//   kneel        KneelStand at rest (the right knee down, the left foot forward, the left forearm on the knee)
//   stand-up     KneelStand retimed onto the four UP!s (key beats 40-44): the hip swings over the front foot (UP! 1), she rises on
//                the front leg (UP! 2), the trailing leg steps through (UP! 3) and plants (UP! 4), then the settle (44-46)
//   step         one more step (46-48): the right foot lifts out, travels, hangs flat over its patch and DROPS onto it (the stomp)
//   sledge       (50-66) she bends and takes the haft lying on its cribs, lifts it to port across her body, carries it on her right
//                shoulder with one hand on the haft and the other arm free, and at THAT NOT THOR HIMSELF swings it over and down:
//                the head lands in front of her and her hands stack on the haft's end. The hammer follows her hands (never the
//                other way round), and her fingers close on the haft (ERECTOR's gripOn).
// Every function is a pure function of the key beat, so any frame can be rendered alone.
import * as THREE from 'three';
import { KneelStand, handQ } from '../lib/fx/modeling/erect/acts.js';
import { applyPose, balance } from '../lib/fx/modeling/erect/rigkit.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x)), lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, t) => { const u = clamp((t - a) / (b - a)); return u * u * (3 - 2 * u); };
const smoother = (a, b, t) => { const u = clamp((t - a) / (b - a)); return u * u * u * (u * (6 * u - 15) + 10); };
const lerpA = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));

// KneelStand's own clock (s) against MECHA's key beats: the act's phases land on the UP!s
const KS_MAP = [[39, 1.2], [40, 1.2], [41, 2.9], [42, 4.3], [43, 5.7], [44, 7.5], [46, 9.8]];
export function ksTime(beat) {
  if (beat <= KS_MAP[0][0]) return KS_MAP[0][1];
  for (let i = 0; i < KS_MAP.length - 1; i++) { const [b0, t0] = KS_MAP[i], [b1, t1] = KS_MAP[i + 1]; if (beat <= b1) return lerp(t0, t1, (beat - b0) / (b1 - b0)); }
  return KS_MAP[KS_MAP.length - 1][1];
}
export const PLANT_BEAT = 43;            // the stand-up's step plants on UP! 4 (KneelStand tStep[1] = 5.7 s)
export const STEP = { lift: 46.05, plant: 47.18, from: [-5.8, 12.8], to: [-6.4, 18.6] };
export const SLEDGE = { reach: 50.0, grip: 50.9, port: 52.0, shoulder: 54.4, swing0: 62.6, over: 63.25, land: 64.62 };

// a hammer orientation from the haft's direction d (butt -> head) and the head's long axis h (made perpendicular to d)
function hamQ(d, h) { const y = d.clone().normalize(), x = h.clone().addScaledVector(y, -h.dot(y)).normalize(), z = new THREE.Vector3().crossVectors(x, y); return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)); }

export class GiantActs {
  // E: the Erector (design c5); ham: the giant sledge group (origin at the butt, +y to the head); lie: { butt: [x, y, z] } on its cribs
  constructor(E, ham, { lie = [-15.5, 15.2, 13.0] } = {}) {
    this.E = E; this.ham = ham; this.KS = new KneelStand(E);
    this.L = ham.userData.L; this.R = 0.8;
    // the stand's end state (KneelStand at its last key): where the step starts
    this.KS.pose(9.8); const P = this.KS.P;
    this.stand0 = { root: { p: P.root.p.slice(), r: P.root.r.slice() }, waist: P.waist.slice(), chest: P.chest.slice(), L: { ...P.legs.L, p: P.legs.L.p.slice() }, R: { ...P.legs.R, p: P.legs.R.p.slice() } };
    // hammer keys: butt position (world = the giant's base frame: it stands at the origin) and orientation
    const X = V3(1, 0, 0), Z = V3(0, 0, 1), Y = V3(0, 1, 0);
    const dPort = V3(0.78, 0.5, 0.36).normalize(), dSh = V3(0.12, 0.58, -1).normalize(), dOver = V3(0.06, 1, 0.42).normalize(), dRest = V3(0, -Math.sin(0.61), Math.cos(0.61));   // the strike: the haft 35 degrees under the horizontal, the head on the ground ahead
    this.K = {
      lie: { b: V3(...lie), q: hamQ(Z, X) },
      port: { q: hamQ(dPort, Z), anchor: [6.5, V3(-5.5, 30.0, 15.5)] },                 // the right hand's grip (s = 6.5) low at the right hip
      shoulder: { q: hamQ(dSh, X), anchor: [17, V3(-14.6, 55.2, 13.6)] },             // the haft lies on the shoulder beam's end (s = 17)
      over: { q: hamQ(dOver, X), anchor: [4, V3(-5.0, 55.0, 13.5)] },
      rest: { q: hamQ(dRest, X), b: V3(-0.8, ham.userData.hw / 2, 44).addScaledVector(dRest, -ham.userData.headC.y) },   // the blow landed: the head on the ground ahead, both hands on the haft's end
    };
    // butts for the anchored keys
    for (const k of ['port', 'shoulder', 'over']) { const K = this.K[k], d = V3(0, 1, 0).applyQuaternion(K.q); K.b = K.anchor[1].clone().addScaledVector(d, -K.anchor[0]); }
    this.events = [];   // filled by the scene (dust, shake, crowd)
    this.restHeadY = ham.userData.hw / 2;
    this.restPose();
  }
  restPose() { this.KS.pose(1.2); }
  // ---------------------------------------------------------------- the whole performance as a function of the key beat
  pose(beat, { sled = true } = {}) {
    const E = this.E; let info = { phase: 'kneel' };
    if (beat < 46) { this.KS.pose(ksTime(beat)); info = { phase: beat < 39.9 ? 'kneel' : 'standup', ks: this.KS.state }; this.placeHamLie(); this._lastP = this.KS.P; }
    else if (beat < SLEDGE.reach || !sled) { this.stepPose(Math.min(beat, 49.99)); info.phase = 'step'; this.placeHamLie(); }
    else info = this.sledgePose(beat);
    E.g.updateMatrixWorld(true);
    return info;
  }
  placeHamLie() { const H = this.ham; H.position.copy(this.K.lie.b); H.quaternion.copy(this.K.lie.q); H.updateMatrixWorld(true); }
  // the step: the left foot planted; the right lifts (toe-off), travels, hangs flat over its new patch and drops (arrives with speed)
  stepPose(beat) {
    const E = this.E, s0 = this.stand0, u = clamp((beat - STEP.lift) / (STEP.plant - STEP.lift)), s = smoother(0, .8, u);
    const Hh = 4.2, lift = u <= 0 || u >= 1 ? 0 : (u < .45 ? Hh * Math.sin(Math.PI / 2 * u / .45) : Hh * (1 - Math.pow((u - .45) / .55, 2.2)));
    const after = beat - STEP.plant, dip = after > 0 ? -1.1 * Math.sin(Math.PI * clamp(after / 0.9)) + .25 * Math.sin(Math.PI * clamp((after - .9) / 1.2)) : 0;
    const breathe = .12 * Math.sin(beat * 1.3);
    const legR = u <= 0 ? { ...s0.R } : u >= 1 ? { p: STEP.to.slice(), yaw: 4 } : { p: lerpA(STEP.from, STEP.to, s), lift: Math.max(0, lift) + .02, yaw: lerp(8, 4, s), phi: lerp(0, 22, sstep(0, .2, u)) * (1 - sstep(.2, .7, u)), toe: -lerp(0, 22, sstep(0, .2, u)) * (1 - sstep(.2, .6, u)) };
    const z0 = s0.root.p[2], zAfter = z0 + (STEP.to[1] - STEP.from[1]) * .5;
    const P = { root: { p: [s0.root.p[0], s0.root.p[1] + dip + breathe - .55 * Math.sin(Math.PI * u), lerp(z0, zAfter, smoother(0, 1.4, (beat - STEP.lift) / (STEP.plant - STEP.lift)))], r: [lerp(2, 5, Math.sin(Math.PI * u)), 0, lerp(1.5, -1.5, Math.sin(Math.PI * u))] },
      waist: [0, lerp(3, -4, Math.sin(Math.PI * u)), 0], chest: [2 + 2 * Math.sin(Math.PI * u), 0, -1],
      legs: { L: { ...s0.L }, R: legR },
      arms: { L: { fk: { sh: [-6 + 10 * Math.sin(Math.PI * u), 0, 9], el: [-16 - 8 * Math.sin(Math.PI * u), 0, 0] } }, R: { fk: { sh: [4 - 9 * Math.sin(Math.PI * u), 0, -11], el: [-12, 0, 0] } } }, curl: { L: .45, R: .32 } };
    // the weight: over the left sole while the right foot is up, between the feet once it has landed
    const over = [2.6, 9.6], both = [(s0.L.p[0] + STEP.to[0]) / 2, (s0.L.p[1] + STEP.to[1]) / 2 - 5.5];
    const w = sstep(STEP.lift - .25, STEP.lift + .1, beat), w2 = sstep(STEP.plant, STEP.plant + 1.2, beat), tgt = [lerp(lerp(both[0] - .5, over[0], w), both[0], w2), lerp(lerp(s0.root.p[2] - 1, over[1], w), both[1], w2)];
    applyPose(E, P);
    const inv = E.g.matrixWorld.clone().invert();
    for (let k = 0; k < 5; k++) { const c = E.com().applyMatrix4(inv), ex = tgt[0] - c.x, ez = tgt[1] - c.z; if (Math.hypot(ex, ez) < .03) break; P.root.p[0] += ex * 1.1; P.root.p[2] += ez * 1.1; applyPose(E, P); }
    this.P = P; this.footLift = lift; return P;
  }
  // the end of the step: the stance the sledge act stands in (feet fixed: left at its patch, right forward)
  stanceAfter() { this.stepPose(49.9); return this.P; }
  // ---------------------------------------------------------------- the hammer at key beat b (before the hands correct it)
  hamAt(b) {
    const K = this.K, S = SLEDGE, out = { b: V3(), q: new THREE.Quaternion() };
    const seg = (A, B, u, arc = null) => { out.b.copy(A.b).lerp(B.b, u); if (arc) out.b.addScaledVector(arc, Math.sin(Math.PI * u)); out.q.copy(A.q).slerp(B.q, u); };
    if (b < S.grip) { out.b.copy(K.lie.b); out.q.copy(K.lie.q); }
    else if (b < S.port) seg(K.lie, K.port, smoother(S.grip + .05, S.port, b), V3(0, 3, 0));
    else if (b < S.shoulder) seg(K.port, K.shoulder, smoother(S.port, S.shoulder - .1, b), V3(-1.5, 4, 2));
    else if (b < S.swing0) { seg(K.shoulder, K.shoulder, 0); out.b.y += .18 * Math.sin((b - S.shoulder) * 1.6) - .5 * Math.exp(-(b - S.shoulder) * 4) * Math.sin(Math.PI * clamp((b - S.shoulder) / .5)); }
    else if (b < S.over) seg(K.shoulder, K.over, smoother(S.swing0, S.over, b), V3(0, 3, 4));
    else if (b < S.land) seg(K.over, K.rest, Math.pow(clamp((b - S.over) / (S.land - S.over)), 1.6), V3(0, 0, 6));
    else { out.b.copy(K.rest.b); out.q.copy(K.rest.q); }
    return out;
  }
  // a hand's grip on the haft: wrist target and hand orientation for the haft point at s (haft-local), palm toward the haft
  gripFor(side, s, ham, sh, mode = 'wrap') {
    const sg = side === 'L' ? 1 : -1, q = ham.q, d = V3(0, 1, 0).applyQuaternion(q), c = V3(0, s, 0).applyQuaternion(q).add(ham.b);
    if (mode === 'cap') {   // the palm pressing down on the haft's end, the fingers over it toward the far side
      const p = d.clone(), f0 = V3(0, 0, 1).addScaledVector(d, -d.z).normalize(), Q = handQ(sg, p, f0), off = V3(-sg * 1.3, -3.1, 0).applyQuaternion(Q);
      return { wrist: c.clone().sub(off), Q, c, d, p, off: V3(-sg * 1.3, -3.1, 0) };
    }
    let p = c.clone().sub(sh); p.addScaledVector(d, -p.dot(d)); if (p.lengthSq() < 1e-6) p = V3(0, -1, 0); p.normalize();
    const f = new THREE.Vector3().crossVectors(d, p).multiplyScalar(sg);   // fingers wrap round the haft; the thumb points to the head
    const Q = handQ(sg, p, f), offL = V3(-sg * (1.3 + this.R * .95), -4.9, 0), off = offL.clone().applyQuaternion(Q);
    return { wrist: c.clone().sub(off), Q, c, d, p, off: offL };
  }
  // ---------------------------------------------------------------- the sledge act
  sledgePose(b) {
    const E = this.E, S = SLEDGE, base = this.stanceAfter(), ham = this.hamAt(b);
    const crouch = sstep(S.reach, S.grip - .15, b) * (1 - smoother(S.grip + .1, S.port + .2, b)), swingLean = Math.sin(Math.PI * clamp((Math.min(b, S.land) - S.swing0) / (S.land - S.swing0 + .6)));
    const restK = sstep(S.over + .2, S.land, b) + .06 * Math.sin(Math.PI * clamp((b - S.land) / .7));
    const P = { root: { p: base.root.p.slice(), r: [2 + 26 * crouch + 9 * swingLean + 16 * restK, -12 * crouch - 4 * restK, -3 * crouch] }, waist: [6 * crouch + 3 * swingLean, -8 * crouch + 4 * sstep(S.port, S.shoulder, b) * (1 - restK), 0],
      chest: [10 * crouch + 6 * swingLean + 9 * restK, -6 * crouch, -1], legs: { L: { ...base.legs.L, kneeOut: .3 * crouch }, R: { ...base.legs.R, kneeOut: .3 * crouch } }, arms: {}, curl: {} };
    P.root.p[1] -= 10.5 * crouch + 1.2 * swingLean + 9.5 * restK; P.root.p[2] += 2.5 * restK; P.root.p[2] += 1.2 * crouch + 1.0 * swingLean;
    // which hands hold, and where along the haft (s from the butt)
    const holdR = b >= S.grip - .25, sR = b < S.port ? 6.5 : b < S.shoulder ? lerp(6.5, 9, smoother(S.port, S.shoulder, b)) : b < S.swing0 ? 9 : b < S.over ? lerp(9, 3.4, smoother(S.swing0, S.over, b)) : lerp(3.4, 1.0, smoother(S.over, S.land - .1, b));
    const holdL = (b >= S.grip + .3 && b < S.port + 1.0) || b >= S.over - .3, sL = b < S.port + 1.2 ? 15.5 : lerp(1.6, 2.9, smoother(S.over, S.land - .1, b));
    const appR = clamp((b - (S.reach + .15)) / (S.grip - S.reach - .15)), appL = b < S.over - .3 ? clamp((b - (S.grip + .3)) / .35) : clamp((b - (S.over - .3)) / .4);
    const relL = b < S.over - .3 ? sstep(S.port + .6, S.port + 1.0, b) : 0;
    // balance first (the hammer's weight on the hands counts), then the arms to the haft, then the hammer onto the hands
    const load = holdR ? { p: () => V3(0, this.L * .85, 0).applyQuaternion(ham.q).add(ham.b), t: 520 * (b < S.grip + .2 ? .3 : 1) } : null;
    // free arms: hanging (the left on the knee in the crouch)
    const kn = () => { E.g.updateMatrixWorld(true); return E.J.knL.getWorldPosition(V3()); };
    P.arms.L = { fk: { sh: [-6, 0, 9], el: [-16, 0, 0] } }; P.arms.R = { fk: { sh: [4, 0, -11], el: [-14, 0, 0] } }; P.curl = { L: { c: .42 }, R: { c: .32 } };
    { const r0 = P.root.p.slice(); balance(E, P, { target: 'feet', load, iters: 3 }); const dx = P.root.p[0] - r0[0], dz = P.root.p[2] - r0[2], m = Math.hypot(dx, dz), lim = 2.2; if (m > lim) { P.root.p[0] = r0[0] + dx * lim / m; P.root.p[2] = r0[2] + dz * lim / m; applyPose(E, P); } }
    E.g.updateMatrixWorld(true);
    const shW = side => E.J['sh' + side].getWorldPosition(V3());
    const capR = false, gR = this.gripFor('R', capR ? -0.55 : sR, ham, shW('R'), capR ? 'cap' : 'wrap'), gL = this.gripFor('L', sL, ham, shW('L'));
    // the right hand: from hanging to the haft (approach), then on it
    { const hang = shW('R').add(V3(-1.5, -19.6, 3)), w = holdR ? 1 : appR, tgt = hang.clone().lerp(gR.wrist, smoother(0, 1, w));
      P.arms.R = { ik: tgt.toArray(), pole: [-.6, -.25, -1], handQ: w > .6 ? gR.Q : handQ(-1, V3(1, -.3, 0).normalize(), V3(0, -1, .1).normalize()).slerp(gR.Q, smoother(0, .6, w)), hand: 1 }; }
    if (holdL || appL > 0) { const k = kn(), rest = crouch > .2 ? k.clone().add(V3(.8, 6.0, 2.4)) : shW('L').add(V3(1.6, -19.6, 2.5)), w = holdL ? smoother(0, 1, appL) * (1 - relL) : 0, tgt = rest.lerp(gL.wrist, w);
      P.arms.L = { ik: tgt.toArray(), pole: [.6, -.25, -1], handQ: w > .5 ? gL.Q : handQ(1, V3(-1, -.3, 0).normalize(), V3(0, -1, .1).normalize()), hand: 1 }; }
    else if (crouch > .05) { const k = kn(), tgt = shW('L').add(V3(1.6, -21, 2.5)).lerp(k.clone().add(V3(.8, 6.0, 2.4)), crouch); P.arms.L = { ik: tgt.toArray(), pole: [.7, -.1, -1], handQ: handQ(1, V3(0, -1, 0).lerp(V3(-1, 0, 0), .3).normalize(), V3(0, -.4, 1).normalize()), hand: 1 }; }
    applyPose(E, P); E.g.updateMatrixWorld(true);
    // the hammer follows the right hand once it holds: its grip point is where the hand actually is
    if (holdR && b >= S.grip && b < S.land - .05) { const wr = E.J.wrR.getWorldPosition(V3()), off = gR.off.clone().applyQuaternion(gR.Q), c = wr.add(off); ham.b.add(c.sub(gR.c)); }
    const H = this.ham; H.position.copy(ham.b); H.quaternion.copy(ham.q); H.updateMatrixWorld(true);
    // fingers close on the haft (a box along it round each grip)
    const box = c => ({ c, q: ham.q, h: V3(this.R, 2.6, this.R) });
    if ((holdR || appR > .7) && !capR) { const amt = holdR ? smoother(S.grip - .25, S.grip, b) : 0; if (amt > 0) E.gripOn('R', [box(V3(0, sR, 0).applyQuaternion(ham.q).add(ham.b))], { amount: amt, c0: .32 }); }
    if (capR) E.curl('R', .45, { thumb: .3 });
    if (holdL && appL > .6) E.gripOn('L', [box(V3(0, sL, 0).applyQuaternion(ham.q).add(ham.b))], { amount: smoother(.6, 1, appL) * (1 - relL), c0: .42 });
    this.P = P;
    const miss = { ...E.rep.miss };
    return { phase: 'sledge', miss, ham: { b: ham.b.toArray().map(v => +v.toFixed(2)), head: this.headWorld().toArray().map(v => +v.toFixed(2)) } };
  }
  headWorld() { this.ham.updateMatrixWorld(true); return this.ham.userData.headC.clone().applyMatrix4(this.ham.matrixWorld); }
  // the cab's front (the glass) and the mark plate, in the world
  cabWorld(off = [0, 0, 0]) { this.E.g.updateMatrixWorld(true); return this.E.cabFront.clone().add(V3(...off)).applyMatrix4(this.E.J.chest.matrixWorld); }
}
