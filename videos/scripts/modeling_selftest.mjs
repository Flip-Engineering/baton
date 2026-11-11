// MODELING c1 self-test for lib/fx/modeling/camera.js (no GPU): a synthetic camera with a known focal length and rotation, the
// vanishing points of its X and Z axes projected by hand, and the solver asked to give the camera back.
//   node videos/scripts/modeling_selftest.mjs
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { solveFromVPs, solveLevel } from '../web/lib/fx/modeling/camera.js';
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const W = 1350, H = 2400;
for (const [f, yaw, pitch, roll] of [[3300, 32, 13, 0], [1800, -20, 8, 2], [2600, 55, -5, 0], [1200, 15, 20, -3]]) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * Math.PI / 180, yaw * Math.PI / 180, roll * Math.PI / 180, 'YXZ'));
  // the world X and Z axes as seen by this camera (camera looks down -Z, world -> camera by q^-1)
  const qi = q.clone().invert(), vp = ax => { const d = ax.clone().applyQuaternion(qi); return [W / 2 + f * d.x / -d.z, H / 2 - f * d.y / -d.z]; };
  const v1 = vp(new THREE.Vector3(1, 0, 0)), v2 = vp(new THREE.Vector3(0, 0, -1));
  const sol = solveFromVPs({ w: W, h: H, vp1: v1, vp2: v2, axes: ['x', 'z'] });
  ok(Math.abs(sol.f - f) / f < 0.01, `focal length ${f} -> ${sol.f.toFixed(1)}`);
  // the world Y axis must map to the same camera-space direction as the truth (up to sign)
  const yTrue = new THREE.Vector3(0, 1, 0).applyQuaternion(qi), yGot = new THREE.Vector3(0, 1, 0).applyQuaternion(sol.quaternion.clone().invert());
  ok(yTrue.dot(yGot) > 0.999, `up axis agrees (dot ${yTrue.dot(yGot).toFixed(4)})`);
}
const lv = solveLevel({ w: W, h: H, horizonY: 1992, fovY: 0.7 }); const look = new THREE.Vector3(0, 0, -1).applyQuaternion(lv.quaternion);
ok(look.y > 0.15 && look.y < 0.3, `level camera with the horizon below centre looks up (y ${look.y.toFixed(3)})`);
console.log(fail ? `${fail} FAILED` : 'all passed'); process.exit(fail ? 1 : 0);
