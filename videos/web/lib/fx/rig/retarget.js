// RIG / RETARGET (HUMAN studio, cycle 5): film motion onto the rig. MediaPipe Pose (33 landmarks, monocular) is noisy in
// exactly the ways that break a rig: the hips swap sides, a hidden limb jumps to the chest, joints jitter. So the landmarks are
// cleaned BEFORE they drive anything, then turned into joint positions in a body frame, and only the DIRECTIONS are used (the rig
// keeps its own bone lengths: bone-length normalisation is free that way).
//   cleanTrack(frames, { fps })     -> { P: [frame][33] Vector3 (metres, MP world), vis }  with L/R swap repair, confidence gating
//                                      (a joint under `minVis` is interpolated from its neighbours in time) and a One-Euro filter
//   jointsAt(track, t)              -> { name: Vector3 } in the body frame (x left, y up, z forward, hips at the origin), Catmull-Rom in time
//   OneEuro                         the filter (Casiez, Roussel and Vogel 2012): a low cutoff when still, a high one when fast
//   contacts(track...)              foot contact by height and speed lives in ground.js (FootPlant): the same detector runs on the retargeted rig
import * as THREE from 'three';
export const MP = { nose: 0, earL: 7, earR: 8, shL: 11, shR: 12, elL: 13, elR: 14, wrL: 15, wrR: 16, hipL: 23, hipR: 24, knL: 25, knR: 26, anL: 27, anR: 28, heL: 29, heR: 30, toL: 31, toR: 32 };
const PAIRS = [[7, 8], [11, 12], [13, 14], [15, 16], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];
export class OneEuro {
  constructor({ minCutoff = 1.2, beta = 0.05, dCutoff = 1.0 } = {}) { Object.assign(this, { minCutoff, beta, dCutoff }); this.x = null; this.dx = 0; }
  alpha(c, dt) { const tau = 1 / (2 * Math.PI * c); return 1 / (1 + tau / dt); }
  step(v, dt) {
    if (this.x == null) { this.x = v; return v; }
    const d = (v - this.x) / dt; this.dx += this.alpha(this.dCutoff, dt) * (d - this.dx);
    const c = this.minCutoff + this.beta * Math.abs(this.dx); this.x += this.alpha(c, dt) * (v - this.x); return this.x;
  }
}
export function cleanTrack(frames, { fps = 12, minVis = 0.35, swapFix = true } = {}) {
  const n = frames.length, P = Array.from({ length: n }, () => Array.from({ length: 33 }, () => new THREE.Vector3())), vis = Array.from({ length: n }, () => new Float32Array(33)), ok = new Uint8Array(n);
  frames.forEach((f, i) => { if (!f.world) return; ok[i] = 1; f.world.forEach((w, k) => { P[i][k].set(w[0], w[1], w[2]); vis[i][k] = f.image ? f.image[k][2] : 0; }); });
  let swaps = 0, gated = 0;
  // L/R swap repair: if exchanging the pairs makes the pose closer to the previous frame, exchange them (the frame-15 hip swap of the tooling survey)
  if (swapFix) for (let i = 1; i < n; i++) { if (!ok[i] || !ok[i - 1]) continue;
    let same = 0, swp = 0; for (const [a, b] of PAIRS) { same += P[i][a].distanceTo(P[i - 1][a]) + P[i][b].distanceTo(P[i - 1][b]); swp += P[i][a].distanceTo(P[i - 1][b]) + P[i][b].distanceTo(P[i - 1][a]); }
    if (swp < 0.7 * same) { for (const [a, b] of PAIRS) { const t = P[i][a].clone(); P[i][a].copy(P[i][b]); P[i][b].copy(t); const tv = vis[i][a]; vis[i][a] = vis[i][b]; vis[i][b] = tv; } swaps++; } }
  // gating: a joint under minVis (or a missing frame) is interpolated between its confident neighbours in time
  for (let k = 0; k < 33; k++) { const good = i => ok[i] && vis[i][k] >= minVis; for (let i = 0; i < n; i++) if (!good(i)) { let a = i - 1, b = i + 1; while (a >= 0 && !good(a)) a--; while (b < n && !good(b)) b++;
    if (a >= 0 && b < n) P[i][k].copy(P[a][k]).lerp(P[b][k], (i - a) / (b - a)); else if (a >= 0) P[i][k].copy(P[a][k]); else if (b < n) P[i][k].copy(P[b][k]); gated++; } }
  // One-Euro per coordinate
  const F = Array.from({ length: 33 }, () => [0, 1, 2].map(() => new OneEuro())), dt = 1 / fps;
  for (let i = 0; i < n; i++) for (let k = 0; k < 33; k++) { const p = P[i][k]; p.x = F[k][0].step(p.x, dt); p.y = F[k][1].step(p.y, dt); p.z = F[k][2].step(p.z, dt); }
  return { P, vis, fps, n, swaps, gated };
}
const V = () => new THREE.Vector3();
// body frame for the whole clip (one heading: the man stands and works; his turn shows as rotation of the hips and chest)
function frame(track) {
  const left = V(), c = V(); for (const p of track.P) { left.add(p[MP.shL].clone().sub(p[MP.shR])).add(p[MP.hipL].clone().sub(p[MP.hipR])); }
  left.y = 0; left.normalize(); const up = V().set(0, -1, 0), fwd = V().crossVectors(left, up).normalize();
  // MP is not guaranteed right-handed for us: the nose is in front of the shoulders
  let nz = 0; for (const p of track.P) nz += p[MP.nose].clone().sub(p[MP.shL].clone().add(p[MP.shR]).multiplyScalar(0.5)).dot(fwd); if (nz < 0) fwd.negate();
  return { left, up, fwd };
}
export function jointsAt(track, t, fr = (track._fr ||= frame(track))) {
  const x = t * track.fps, i = Math.max(0, Math.min(track.n - 2, Math.floor(x))), u = Math.max(0, Math.min(1, x - i)), out = {};
  const i0 = Math.max(0, i - 1), i3 = Math.min(track.n - 1, i + 2);
  const cat = (a, b, c, d) => { const u2 = u * u, u3 = u2 * u; return V().addScaledVector(b, 2).addScaledVector(c.clone().sub(a), u).addScaledVector(a.clone().multiplyScalar(2).addScaledVector(b, -5).addScaledVector(c, 4).sub(d), u2).addScaledVector(a.clone().negate().addScaledVector(b, 3).addScaledVector(c, -3).add(d), u3).multiplyScalar(0.5); };
  const pos = k => cat(track.P[i0][k], track.P[i][k], track.P[i + 1][k], track.P[i3][k]);
  const raw = {}; for (const [n, k] of Object.entries(MP)) raw[n] = pos(k);
  const hipMid = raw.hipL.clone().add(raw.hipR).multiplyScalar(0.5);
  for (const n in raw) { const d = raw[n].clone().sub(hipMid); out[n] = V().set(d.dot(fr.left), d.dot(fr.up), d.dot(fr.fwd)); }
  out.hipMid = V(); out.shMid = out.shL.clone().add(out.shR).multiplyScalar(0.5); out.earMid = out.earL.clone().add(out.earR).multiplyScalar(0.5);
  return out;
}
