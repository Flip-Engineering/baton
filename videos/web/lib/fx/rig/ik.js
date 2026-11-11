// RIG / IK (HUMAN studio, cycle 5): reaching a world target with a measured miss.
//   twoBone(S, L1, L2, T, pole, { soft })  analytic two-bone IK with a pole vector and a soft reach: the last few percent of
//       reach ease in, so a knee or an elbow never snaps straight. Returns { E, W, miss, missV, D, flex } (joint positions,
//       what was actually reached, the miss in the same units as the inputs, elbow/knee flexion in radians).
//   fabrik(P, target, { lens, iters, cone })  FABRIK (Aristidou and Lasenby 2011) on a chain of joint positions with an
//       optional per-bone cone limit (radians, about the direction the parent bone points), the anatomical extension of 2016.
//   softReach(D, Lmax, start)   the easing itself.
// Every solve reports what it missed by. A caller that cannot reach moves the body (spine lean, a step), it never moves
// the world object to the hand.
import * as THREE from 'three';

export function softReach(D, Lmax, start = 0.96) {
  const s = Lmax * start; if (D <= s) return D;
  const k = Lmax - s; return s + k * (1 - Math.exp(-(D - s) / k));
}
const _a = new THREE.Vector3(), _p = new THREE.Vector3();
export function twoBone(S, L1, L2, T, pole, { soft = 0.97 } = {}) {
  const d = _a.copy(T).sub(S), D0 = d.length() || 1e-9, a = d.clone().multiplyScalar(1 / D0);
  const Lmax = L1 + L2, Lmin = Math.abs(L1 - L2) + 1e-3;
  const D = Math.min(Math.max(softReach(D0, Lmax, soft), Lmin), Lmax - 1e-5);
  const cosA = (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const pp = _p.copy(pole).addScaledVector(a, -pole.dot(a));
  if (pp.lengthSq() < 1e-8) pp.set(Math.abs(a.y) < 0.9 ? 0 : 1, Math.abs(a.y) < 0.9 ? 1 : 0, 0).addScaledVector(a, 0);
  pp.normalize();
  const E = S.clone().addScaledVector(a, L1 * cosA).addScaledVector(pp, L1 * sinA);
  const W = S.clone().addScaledVector(a, D);
  const missV = T.clone().sub(W), u = E.clone().sub(S).normalize(), f = W.clone().sub(E).normalize();
  return { E, W, D, miss: missV.length(), missV, u, f, flex: Math.acos(Math.max(-1, Math.min(1, u.dot(f)))), a, pole: pp.clone() };
}

// P: array of Vector3 joint positions from the fixed root P[0] to the end effector. Returns { P, miss, iters }
export function fabrik(P0, target, { lens = null, iters = 12, tol = 1e-4, cone = null } = {}) {
  const n = P0.length, P = P0.map(p => p.clone()), L = lens || P.slice(1).map((p, i) => p.distanceTo(P[i]));
  const root = P[0].clone(); let it = 0;
  const total = L.reduce((a, b) => a + b, 0);
  if (root.distanceTo(target) > total) {                       // out of reach: stretch straight at it
    const d = target.clone().sub(root).normalize(); for (let i = 1; i < n; i++) P[i].copy(P[i - 1]).addScaledVector(d, L[i - 1]);
    return { P, miss: P[n - 1].distanceTo(target), iters: 0 };
  }
  const dir0 = P0.slice(1).map((p, i) => p.clone().sub(P0[i]).normalize());
  for (; it < iters; it++) {
    if (P[n - 1].distanceTo(target) < tol) break;
    P[n - 1].copy(target);
    for (let i = n - 2; i >= 0; i--) { const d = P[i].clone().sub(P[i + 1]).normalize(); P[i].copy(P[i + 1]).addScaledVector(d, L[i]); }
    P[0].copy(root);
    for (let i = 1; i < n; i++) {
      let d = P[i].clone().sub(P[i - 1]).normalize();
      if (cone && cone[i - 1] != null) {                       // keep the bone within cone[i-1] of its rest direction
        const ref = i > 1 ? P[i - 1].clone().sub(P[i - 2]).normalize() : dir0[0], ang = Math.acos(Math.max(-1, Math.min(1, ref.dot(d))));
        if (ang > cone[i - 1]) { const ax = new THREE.Vector3().crossVectors(ref, d); if (ax.lengthSq() > 1e-12) d.copy(ref).applyAxisAngle(ax.normalize(), cone[i - 1]); }
      }
      P[i].copy(P[i - 1]).addScaledVector(d, L[i - 1]);
    }
  }
  return { P, miss: P[n - 1].distanceTo(target), iters: it };
}
