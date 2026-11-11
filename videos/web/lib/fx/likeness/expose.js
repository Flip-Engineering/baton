// LIKENESS / expose: meter the FACE and set the camera for it (HUMAN c8, lane B). A tool for face labs and boards, not a rule.
//
//   import { faceExposure, setRigStops } from '../lib/fx/likeness/expose.js';
//   const m = faceExposure({ lr, scene, camera, rig, hero: h, skinY: 0.37 });   // renders one draft sub-frame, reads it back, applies
//   // m = { stops, meter, target, samples, ec }    then render as usual; setRigStops(rig, scene, -m.stops) undoes it
//
// Why: the c7 faces sat ~4.5 stops over the yard's mid grey (the camera was exposed for the yard, the key fell on the face), so
// half the "orange plastic" was a camera choice (critic's board_exposure / board_skin_albedo). A photographer spot-meters the
// lit side of the face and places it by what the skin IS: light skin about a stop over mid grey, deep skin about a stop under
// (Adams's zone system: Caucasian skin in zone VI, dark skin in zone IV). That is incident metering with the skin's own
// reflectance known: the lit side should read its albedo times the light a grey card there would get, so
//   target = Y_skin  (the person's measured-style reflectance, body albedo + surface, e.g. 0.37 light, 0.06 the darkest adult)
//   stops  = log2(Y_skin / 0.18)  ->  +1.0 for NIST's median skin, -1.6 at ITA -67  (the zone rule falls out of the measurement)
// light/'s display maps pre-exposed 0.18 to its mid grey (display.js: mid 0.18 -> 0.18), so the face lands where the zone says.
// The meter: face points of the bind mesh (forehead, cheeks above the beard line, nose; not eyes, brows' centre or lips), skinned
// and projected, kept where the prepass depth agrees (visible), read from the linear accumulator of one K=1 sub-frame; the
// statistic is the 75th percentile of their luminance (the key side; overcast gives the brighter cheek). bias (stops) is a
// creative offset on top (dawn contre-jour: -0.7 keeps the face low against the sky).
//
// Exposure is applied the way light/ sets it (everything pre-exposed, Frostbite): the sun, the practicals (their own
// setExposure, so flicker and drive keep working), the environment and background intensities and the sun disc all scale by
// 2^stops; nothing in light/ is edited.
import * as THREE from 'three';

export function setRigStops(rig, scene, stops) {
  const k = 2 ** stops; if (!isFinite(k) || k === 1) return rig;
  rig.exposure *= k;
  if (rig.sun) rig.sun.intensity *= k;
  if (rig.disc) rig.disc.material.color.multiplyScalar(k);
  scene.environmentIntensity = (scene.environmentIntensity ?? 1) * k; scene.backgroundIntensity = (scene.backgroundIntensity ?? 1) * k;
  for (const P of rig.practicals || []) P.setExposure(P.exposure * k);
  rig._likeStops = (rig._likeStops || 0) + stops;
  return rig;
}

// face sample vertices (bind) of a hero: forehead band, upper cheeks, nose bridge and tip
export function faceSamples(h, { max = 220 } = {}) {
  const P = h.body.geometry.attributes.position.array, AH = h.aHero, n = P.length / 3;
  const eL = h.eyeL, eR = h.eyeR, eyeY = (eL.y + eR.y) / 2, eyeZ = (eL.z + eR.z) / 2, out = [];
  for (let v = 0; v < n; v++) { const r = AH[v * 4]; if (r !== 0 && r !== 11) continue;
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2], ax = Math.abs(x), dy = y - eyeY;
    if (z < eyeZ - 0.025) continue;
    const dE = Math.min(Math.hypot(x - eL.x, dy), Math.hypot(x - eR.x, dy));
    const forehead = dy > 0.03 && dy < 0.06 && ax < 0.04, cheek = dy < -0.016 && dy > -0.042 && ax > 0.02 && ax < 0.052 && dE > 0.017, nose = ax < 0.008 && dy < 0.005 && dy > -0.035;
    if (forehead || cheek || nose) out.push(v); }
  const step = Math.max(1, Math.floor(out.length / max)); return out.filter((_, i) => i % step === 0);
}

export function meterFace({ lr, scene, camera, rig, hero, t = 0, lens = null, render = true, samples = null }) {
  const h = hero, r = lr.renderer, W = lr.W, H = lr.H;
  if (render) { const K0 = lr.q.K; lr.q.K = 1; try { lr.render({ scene, camera, rig, t, lens: lens || {}, sync: false }); } finally { lr.q.K = K0; } }
  const S = samples || faceSamples(h), v = new THREE.Vector3(), pts = [];
  h.group.updateMatrixWorld(true); h.body.skeleton.update?.();
  camera.updateMatrixWorld(); const view = camera.matrixWorldInverse;
  for (const i of S) { h.body.getVertexPosition(i, v); v.applyMatrix4(h.body.matrixWorld); const vz = -v.clone().applyMatrix4(view).z; v.project(camera);
    if (Math.abs(v.x) > 1 || Math.abs(v.y) > 1) continue; pts.push({ x: Math.floor((v.x * 0.5 + 0.5) * W), y: Math.floor((v.y * 0.5 + 0.5) * H), z: vz }); }
  if (!pts.length) return null;
  const x0 = Math.max(0, Math.min(...pts.map(p => p.x)) - 1), y0 = Math.max(0, Math.min(...pts.map(p => p.y)) - 1);
  const x1 = Math.min(W - 1, Math.max(...pts.map(p => p.x)) + 1), y1 = Math.min(H - 1, Math.max(...pts.map(p => p.y)) + 1), w = x1 - x0 + 1, hh = y1 - y0 + 1;
  const acc = new Float32Array(w * hh * 4), pre = new Float32Array(w * hh * 4);
  r.readRenderTargetPixels(lr.acc, x0, y0, w, hh, acc); r.readRenderTargetPixels(lr.pre, x0, y0, w, hh, pre);
  const Y = [];
  for (const p of pts) { const o = ((p.y - y0) * w + (p.x - x0)) * 4, iz = pre[o + 3]; if (!(iz > 0) || Math.abs(1 / iz - p.z) > 0.012 + 0.004 * p.z) continue;
    const a = acc[o + 3] || 1, y = (0.2126 * acc[o] + 0.7152 * acc[o + 1] + 0.0722 * acc[o + 2]) / a; if (isFinite(y)) Y.push(y); }
  if (Y.length < 5) return null;
  Y.sort((a, b) => a - b); const q = f => Y[Math.min(Y.length - 1, Math.floor(f * (Y.length - 1)))];
  return { p50: q(0.5), p75: q(0.75), p90: q(0.9), n: Y.length, of: S.length };
}

// meter, then set the rig so the face's lit side reads its own reflectance (see the header). skinY: the person's skin luminance
// as a reflectance (likeness skin: lum(body) + the surface term; default 0.3). Returns what it did.
export function faceExposure({ lr, scene, camera, rig, hero, skinY = 0.3, bias = 0, t = 0, lens = null, apply = true, clampStops = 6 }) {
  const m = meterFace({ lr, scene, camera, rig, hero, t, lens });
  if (!m) return { stops: 0, meter: null, target: skinY, note: 'no visible face samples' };
  const target = skinY * 2 ** bias, stops = Math.max(-clampStops, Math.min(clampStops, Math.log2(target / Math.max(m.p75, 1e-8))));
  if (apply) setRigStops(rig, scene, stops);
  return { stops, meter: m, target, zone: Math.log2(skinY / 0.18), samples: m.n };
}
