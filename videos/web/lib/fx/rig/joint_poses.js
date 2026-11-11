// CORRECT5 (HUMAN c8 round 5b, 4 Oct): the poses that exercise each joint, on a built person (makePerson v4 / buildPerson), for the
// corrective checks (labs/human8/lab_correct5, correct5_test.mjs). NEW FILE, opt-in: nothing else imports it.
// Each pose starts from the person's own stance (POSE's standPerson record, re-stood so a pose never inherits the previous one) and
// either runs MOTION's acts at a fixed time (wave, squat = the lift's grasp, stride = the walk) or sets the joint in the person's
// parent frame (raise, across, fold, twist, kneel). Pure bone rotations: no solve beyond the acts' own.
//   import { poseJoint, JOINT_POSES } from '/web/lib/fx/rig/joint_poses.js';
//   const rep = await poseJoint(P, 'raise', { side: 'R' });   // { name, joints: { bone: world position }, focus: bone name }
import * as THREE from 'three';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), deg = Math.PI / 180;
// name: [what it shows, the joint to frame (side-relative), how it is made]
export const JOINT_POSES = {
  stand: ['the stance as built', 'upperarm01', 'stance'],
  clasp: ['hands clasped in front (POSE clasp): the pectoral and the armpit', 'upperarm01', 'stance'],
  raise: ['arm raised overhead 150 deg: the deltoid, the armpit', 'upperarm01', 'set'],
  wave: ['MOTION c1 wave, mid-wave: shoulder and elbow', 'upperarm01', 'act'],
  across: ['arm across the chest, hand toward the other shoulder: pectoral, armpit, elbow', 'upperarm01', 'set'],
  fold: ['elbow at full flexion, upper arm hanging: the elbow crease', 'lowerarm01', 'set'],
  twist: ['forearm pronated 85 deg, arm hanging: the wrist (candy-wrapper)', 'wrist', 'set'],
  squat: ['MOTION c1 lift at the grasp: hip, glute, knee', 'upperleg01', 'act'],
  stride: ['MOTION c1 walk, long stride: hip and glute', 'upperleg01', 'act'],
  kneel: ['deep squat on the toes: knee 130, hip 115', 'lowerleg01', 'set'],
};

let _SM = null, _ACT = null;
async function mods() { if (!_SM) { _SM = await import('../motion/stance.js'); _ACT = await import('../motion/act4.js'); } return { SM: _SM, ACT: _ACT }; }

// re-stand the person in her own record (optionally with other arms)
export async function restand(P, over = {}) {
  const { SM } = await mods(), h = P.h; h.resetPose(); h.bones.forEach(B => B.scale.set(1, 1, 1));
  h.group.position.set(0, 0, 0); h.group.rotation.set(0, 0, 0);
  const rec = { ...(P.pose || {}), ...over };
  if (rec && rec.legs) SM.standPerson(h, rec, { person: P.p }); h.update();
  return rec;
}
// a limb direction set in the parent's frame (the bind frame for shoulder01 / pelvis, which the stance never rotates)
function aim(h, bone, child, dir) { const B = h.bone(bone), d0 = h.head0[h.idx[child]].clone().sub(h.head0[h.idx[bone]]).normalize(); B.quaternion.setFromUnitVectors(d0, dir.clone().normalize()); }
// a hinge flexed to f degrees (angle between the segments), the hinge axis taken from the bind
function flexTo(h, a, b, c, f, knee = false) {
  const A = h.head0[h.idx[a]], Bp = h.head0[h.idx[b]], C = h.head0[h.idx[c]], u = Bp.clone().sub(A).normalize(), v = C.clone().sub(Bp).normalize();
  const f0 = Math.acos(Math.max(-1, Math.min(1, u.dot(v)))) / deg; let ax = u.clone().cross(v); if (ax.length() < 1e-3) ax = V3(1, 0, 0); ax.normalize();
  if (Math.acos(Math.max(-1, Math.min(1, u.dot(v.clone().applyAxisAngle(ax, 0.3))))) / deg < f0) ax.negate();
  // the upper segment's current local rotation is applied to u by the parent chain; the hinge sits in the child's local frame = bind frame
  h.bone(b).quaternion.setFromAxisAngle(ax, (f - f0) * deg); void knee;
}
const twistAbout = (h, bone, axis, ang) => { const q = new THREE.Quaternion().setFromAxisAngle(axis, ang); h.bone(bone).quaternion.multiply(q); };
function floorFeet(h) { h.update(); const y = Math.min(h.joint('foot.L').y, h.joint('foot.R').y, h.joint('toe1-1.L')?.y ?? 9, h.joint('toe1-1.R')?.y ?? 9); h.bone('root').position.y -= (y - 0.075 * h.o.height / 1.75); h.update(); }

export async function poseJoint(P, name, { side = 'R' } = {}) {
  const h = P.h, X = side, sg = X === 'L' ? 1 : -1, spec = JOINT_POSES[name]; if (!spec) throw new Error('pose? ' + Object.keys(JOINT_POSES).join(' '));
  const { ACT } = await mods();
  if (name === 'clasp') await restand(P, { arms: 'clasp', armSide: X });
  else if (spec[2] === 'act') {
    await restand(P);
    const nm = P.info?.name || 'x';
    const act = name === 'wave' ? new ACT.Wave(P, { side: X }) : name === 'squat' ? new ACT.LiftCarry(P, { at: [0, 0], yaw: 0 }) : new ACT.WalkTurn(P, { from: [-1.2, 0], dist: 3, startPhase: 0.0 });
    const t = name === 'wave' ? 1.72 : name === 'squat' ? 1.6 : 0.62; act.frame(t); h.update(); void nm;
  } else await restand(P);
  if (spec[2] === 'set') {
    const lat = sg;   // +x is the person's left
    if (name === 'raise') { aim(h, 'upperarm01.' + X, 'lowerarm01.' + X, V3(lat * 0.45, 0.88, 0.12)); flexTo(h, 'upperarm01.' + X, 'lowerarm01.' + X, 'wrist.' + X, 25); }
    if (name === 'across') { aim(h, 'upperarm01.' + X, 'lowerarm01.' + X, V3(-lat * 0.42, -0.05, 0.9)); flexTo(h, 'upperarm01.' + X, 'lowerarm01.' + X, 'wrist.' + X, 115); }
    if (name === 'fold') { aim(h, 'upperarm01.' + X, 'lowerarm01.' + X, V3(lat * 0.1, -0.97, 0.2)); const mx = h.meta?.kin?.rom?.elbowFlex?.deg || 145; flexTo(h, 'upperarm01.' + X, 'lowerarm01.' + X, 'wrist.' + X, Math.min(140, mx - 5)); }
    if (name === 'twist') { aim(h, 'upperarm01.' + X, 'lowerarm01.' + X, V3(lat * 0.12, -0.99, 0.05)); flexTo(h, 'upperarm01.' + X, 'lowerarm01.' + X, 'wrist.' + X, 15);
      const ax = h.head0[h.idx['wrist.' + X]].clone().sub(h.head0[h.idx['lowerarm01.' + X]]).normalize(); h.bone('lowerarm02.' + X).quaternion.identity(); h.bone('wrist.' + X).quaternion.identity();
      twistAbout(h, 'lowerarm02.' + X, ax, -sg * 45 * deg); twistAbout(h, 'wrist.' + X, ax, -sg * 40 * deg); }
    if (name === 'kneel') { for (const S of ['L', 'R']) { const s2 = S === 'L' ? 1 : -1; aim(h, 'upperleg01.' + S, 'lowerleg01.' + S, V3(s2 * 0.25, 0.42, 0.87)); flexTo(h, 'upperleg01.' + S, 'lowerleg01.' + S, 'foot.' + S, 130); }
      h.bone('spine04').quaternion.setFromAxisAngle(V3(1, 0, 0), 18 * deg); floorFeet(h); }
    h.update();
  }
  const focus = spec[1] + '.' + X; return { name, side: X, focus, what: spec[0] };
}
