// THE HEAD'S SHARE OF THE GAZE (MOTION c3, round 7, c5 iteration 1; NEW FILE: the posing side of EYES' rule).
//
// WHY. A fixation is shared between the eye and the head: the eye holds a target up to ~17.5 deg off the head's forward axis (face/eye/model.js GAZE.eyeOnlyDeg: the middle of the cited 15-20 deg range,
// Bahill, Adler and Stark 1975; Stahl 1999; Freedman 2008) and the HEAD takes the rest. EYES' renderers (engine listingRotation, eye7_cycles aim_gaze) turn the eye by its share and REPORT the head's
// (head_deg); nothing turned the head, so a sitter whose stance had the head 25-37 deg off the lens looked "near the lens rather than at it". This is the poser: it turns the head (the neck and the head
// bones, POSE's 45 / 55 split, yaw about the vertical and pitch about the lateral axis: no roll) by the head's share, so the eye then meets the target inside its own range.
//
//   import { headToward7 } from './gaze7.js';
//   headToward7(h, camera.position)             // after the stance / the act's pose, before the render: h = the hero, a world point (THREE.Vector3 or [x, y, z])
//   -> { alphaDeg (the angle the gaze had to cover), eyeDeg, headDeg (the split), yaw, pitch (rad, applied to the neck / head), leftDeg (what the eyes still turn, <= eyeOnlyDeg unless the neck range stopped the head) }
// The neck's range limits the head (yaw 70 deg, up 40, down 45: the clinical cervical range of motion halved by the trunk-free sitter's comfortable use is not modelled here: the full range is the limit).
import * as THREE from 'three';
import { eyeHeadSplit } from '../face/eye/model.js';
import { lookHead } from './life.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const D = 180 / Math.PI;
export const NECK7 = { yaw: 70 / D, up: 40 / D, down: 45 / D };

// the head's forward axis and the midpoint of the eyes (world), the group's frame (right-handed, +y up; lookHead's: + yaw turns the face toward the figure's +x, + pitch tips it down)
function headFrame(h) {
  h.update(); const q = new THREE.Quaternion(); h.bone('head').getWorldQuaternion(q);
  const eyeL = h.joint('eye.L'), eyeR = h.joint('eye.R'), E = eyeL.clone().add(eyeR).multiplyScalar(0.5);
  const gq = new THREE.Quaternion(); h.group.getWorldQuaternion(gq);
  return { E, fwd: V3(0, 0, 1).applyQuaternion(q).normalize(), gq };
}
// yaw (about the vertical) and pitch (about the group's lateral axis) of a world direction d against the head's forward axis f, in the group's frame
function yawPitch(f, d, gq) {
  const gi = gq.clone().invert(), a = f.clone().applyQuaternion(gi), b = d.clone().applyQuaternion(gi);
  const ya = Math.atan2(a.x, a.z), yb = Math.atan2(b.x, b.z), pa = Math.asin(Math.max(-1, Math.min(1, -a.y))), pb = Math.asin(Math.max(-1, Math.min(1, -b.y)));
  let yaw = yb - ya; if (yaw > Math.PI) yaw -= 2 * Math.PI; if (yaw < -Math.PI) yaw += 2 * Math.PI;
  return { yaw, pitch: pb - pa };
}
// the angle (deg) between the head's forward axis and the line from the eyes to the target, and the share the head must take
export function gazeSplit7(h, target) {
  const T = Array.isArray(target) ? V3(...target) : target.clone(), F = headFrame(h), d = T.sub(F.E).normalize();
  const alpha = Math.acos(Math.max(-1, Math.min(1, F.fwd.dot(d)))) * D, split = eyeHeadSplit(alpha);
  return { alphaDeg: alpha, ...split, F, d };
}
// turn the head by its share (once, then a second closed-loop pass for the small error the neck's two bones leave); returns the report
export function headToward7(h, target, { limit = NECK7 } = {}) {
  let rep = null;
  for (let pass = 0; pass < 2; pass++) {
    const g = gazeSplit7(h, target); if (pass === 0) rep = { alphaDeg: +g.alphaDeg.toFixed(2), eyeDeg: +g.eyeDeg.toFixed(2), headDeg: +g.headDeg.toFixed(2) };
    if (g.headDeg < 0.05) break;
    const yp = yawPitch(g.F.fwd, g.d, g.F.gq), tot = Math.hypot(yp.yaw, yp.pitch) || 1, k = (g.headDeg / D) / tot;   // (the head's share of the way, along the same line)
    let yaw = yp.yaw * k, pitch = yp.pitch * k;
    yaw = Math.max(-limit.yaw, Math.min(limit.yaw, yaw)); pitch = Math.max(-limit.up, Math.min(limit.down, pitch));
    lookHead(h, yaw, pitch); if (pass === 0) { rep.yaw = +yaw.toFixed(4); rep.pitch = +pitch.toFixed(4); }
  }
  const g2 = gazeSplit7(h, target); rep.leftDeg = +g2.alphaDeg.toFixed(2); rep.eyeDegAfter = +g2.eyeDeg.toFixed(2); rep.headDegAfter = +g2.headDeg.toFixed(2);
  return rep;
}
