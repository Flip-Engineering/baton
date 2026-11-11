// RIG / LIMITS (HUMAN studio, cycle 5): anatomical joint ranges and quaternion-safe blending.
// Ranges from the AAOS norms (Greene and Heckman, The Clinical Measurement of Joint Motion, 1994), in degrees. A limit is a
// swing box about the bone's bind axis (flexion / abduction, in the bone's bind frame: x = the person's left, z = forward)
// plus a twist range about the bone. `flex` is positive when the distal segment moves FORWARD (+z) of its bind hang, `abd`
// positive when it moves OUT to the person's own side.
//   LIMITS[boneName] = { flex: [min, max], abd: [min, max], twist: [min, max] }   (degrees)
//   clampLocal(q, name, side, out)   project a local rotation (bind frame identity, bone axis -y) into its limits
//   measureLocal(q, name, side)      -> { flex, abd, twist } in degrees (for the diagnostic)
//   slerpPose(a, b, w, out)          blend two arrays of quaternions by slerp (replaces linear Euler averaging)
// HUMAN c8 lane F (opt-in): both take a limits table as their last argument (default LIMITS; a name missing from it falls back to
// LIMITS). limitsFor(kin) is the person's own: lane A's p.kin.limits (CDC ranges by sex and age, one draw per person, elbow and knee
// HYPEREXTENSION, the soft-tissue flexion limits of the person's own mesh) over the AAOS table for the spine, neck, head and hand.
// Bone axes: every limb bone of people.js hangs along -y in bind; the spine and neck point +y.
import * as THREE from 'three';

const D = Math.PI / 180;
export const LIMITS = {
  spine:    { axis: 1, flex: [-25, 30], abd: [-20, 20], twist: [-25, 25] },
  chest:    { axis: 1, flex: [-20, 25], abd: [-20, 20], twist: [-30, 30] },
  neck:     { axis: 1, flex: [-40, 45], abd: [-35, 35], twist: [-50, 50] },
  head:     { axis: 1, flex: [-25, 30], abd: [-25, 25], twist: [-40, 40] },
  upperarm: { axis: -1, flex: [-60, 180], abd: [-30, 180], twist: [-90, 90] },      // extension 60, flexion 180, abduction 180
  forearm:  { axis: -1, flex: [0, 150], abd: [-10, 10], twist: [-90, 90] },           // elbow flexion 0..150 (forearm twist is pronation)
  hand:     { axis: -1, flex: [-70, 80], abd: [-25, 30], twist: [-15, 15] },        // wrist flexion 80, extension 70, radial 20, ulnar 30
  thigh:    { axis: -1, flex: [-20, 120], abd: [-25, 40], twist: [-40, 45] },       // hip flexion 120, extension 20, abduction 40
  shin:     { axis: -1, flex: [-135, 5], abd: [-10, 10], twist: [-10, 10] },          // knee flexion 135 (the shin swings BACK, so negative here), 5 hyperextension
  foot:     { axis: -1, flex: [-60, 60], abd: [-25, 25], twist: [-30, 30] },        // plantarflexion 50, dorsiflexion 20-30
};
export const PEOPLE_LIMIT_NAMES = { 1: 'spine', 2: 'chest', 3: 'neck', 4: 'head', 5: 'upperarm', 9: 'upperarm', 6: 'forearm', 10: 'forearm', 7: 'hand', 11: 'hand', 13: 'thigh', 16: 'thigh', 14: 'shin', 17: 'shin', 15: 'foot', 18: 'foot' };

const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _u = new THREE.Vector3(), _t = new THREE.Quaternion(), _s = new THREE.Quaternion();
// swing/twist about bind axis a (unit, +/-y): q = swing * twist. swing rotation vector r is perpendicular to a.
function decompose(q, a, swing, twist) {
  const d = q.x * a.x + q.y * a.y + q.z * a.z;
  twist.set(a.x * d, a.y * d, a.z * d, q.w); const l = Math.hypot(twist.x, twist.y, twist.z, twist.w);
  if (l < 1e-9) twist.identity(); else twist.set(twist.x / l, twist.y / l, twist.z / l, twist.w / l);
  swing.copy(q).multiply(_t.copy(twist).invert());
}
const rotVec = (q, out) => { let w = q.w, s = 1; if (w < 0) { s = -1; w = -w; } const sn = Math.hypot(q.x, q.y, q.z), ang = 2 * Math.atan2(sn, w); return sn < 1e-9 ? out.set(0, 0, 0) : out.set(q.x, q.y, q.z).multiplyScalar(s * ang / sn); };
// measure: flex = motion of the distal end toward +z. For a bone along -y, a rotation of +theta about x sends -y to (0, -cos, -sin): backward. So flex = -rx for axis -1.
export function measureLocal(q, name, side = 1, limits = LIMITS) {
  const L = limits[name] || LIMITS[name]; const a = _u.set(0, L.axis, 0), sw = _s, tw = new THREE.Quaternion(); decompose(q, a, sw, tw);
  const r = rotVec(sw, _v), twv = rotVec(tw, new THREE.Vector3());
  const sgn = L.axis < 0 ? -1 : 1;                  // bone along +y flexes forward with +rx, bone along -y with -rx
  return { flex: r.x * sgn / D, abd: r.z * -sgn * side / D, twist: twv.y / D };
}
export function clampLocal(q, name, side = 1, out = new THREE.Quaternion(), limits = LIMITS) {
  const L = limits[name] || LIMITS[name], a = new THREE.Vector3(0, L.axis, 0), sw = new THREE.Quaternion(), tw = new THREE.Quaternion(); decompose(q, a, sw, tw);
  const r = rotVec(sw, new THREE.Vector3()), tv = rotVec(tw, new THREE.Vector3()), sgn = L.axis < 0 ? -1 : 1;
  let flex = r.x * sgn / D, abd = r.z * -sgn * side / D, twist = tv.y / D, hit = false;
  const c = (v, [lo, hi]) => { const w = Math.min(hi, Math.max(lo, v)); if (w !== v) hit = true; return w; };
  flex = c(flex, L.flex); abd = c(abd, L.abd); twist = c(twist, L.twist);
  if (!hit) return out.copy(q);
  const rr = new THREE.Vector3(flex * D * sgn, 0, abd * D * -sgn * side), ang = rr.length();
  const s2 = ang < 1e-9 ? new THREE.Quaternion() : new THREE.Quaternion().setFromAxisAngle(rr.normalize(), ang);
  return out.copy(s2).multiply(new THREE.Quaternion().setFromAxisAngle(a, twist * D));
}
export function slerpPose(a, b, w, out) { for (let i = 0; i < a.length; i++) (out[i] ||= new THREE.Quaternion()).copy(a[i]).slerp(b[i], w); return out; }
// a person's table (lane A's kin.limits over AAOS); null kin -> LIMITS itself
export function limitsFor(kin) { if (!kin || !kin.limits) return LIMITS; return { ...LIMITS, ...kin.limits }; }
