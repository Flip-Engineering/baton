// MOTION / STANCE (round 3 POSE, judge c8 step 5): how people actually stand, per person, seeded.
// The v2 people all stood in one symmetric pose with claw-open fingers. Real people (the modern typical references) stand with the
// weight on one leg, the pelvis tilted (the free side down), the shoulder line counter-tilted, the head turned or tilted, and relaxed,
// curled hands (fingers flexed 20-40 deg increasing toward the little finger, the thumb resting by the index).
//
//   import { stanceOf, standPerson, readStance, relaxedHand } from '../lib/fx/motion/stance.js';
//   const S = stanceOf('L08_f24_hispanic', { sex: 'f', age: 24, dressed: false, seed: 1 });  // a seeded record (plain JSON)
//   const rep = standPerson(h, S, { person: p });     // poses the hero from her own kin (rig/person_kin.js); returns readStance(h)
//   readStance(h)                                     // balance (COM over support), pelvis / shoulder tilt, head, knees, fingers
//
// Everything is opt-in. Nothing here is called by idleStance, standV2 or any existing scene: a caller asks for it by name.
// The legs reuse lane F's machinery (kinOf, twoBoneKin with the person's own knee range and hyperextension, carrying, heroCom); the
// difference from idleStanceKin is the parameters (a real contrapposto: the STANDING hip up, the free side dropped, the shoulders
// counter-tilted) and the arms and hands.
import * as THREE from 'three';
import { kinOf, twoBoneKin, hingeOf, carrying, heroCom, heroPoints } from '../rig/person_kin.js';
import { twoBoneHero } from '../workforce.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const D = Math.PI / 180;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const mulberry = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const hashStr = str => { let x = 2166136261; for (const c of String(str)) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; };
function frame(h) { h.update(); const q = new THREE.Quaternion(); h.group.getWorldQuaternion(q); return { fwd: V3(0, 0, 1).applyQuaternion(q), lat: V3(1, 0, 0).applyQuaternion(q), up: V3(0, 1, 0) }; }
function worldQ(h, n) { h.update(); const q = new THREE.Quaternion(); h.bone(n).getWorldQuaternion(q); return q; }
function setWorldQ(h, n, qw) { const B = h.bone(n), pq = new THREE.Quaternion(); B.parent.getWorldQuaternion(pq); B.quaternion.copy(pq.invert().multiply(qw)); h.update(); }
const deg = (a, b) => Math.acos(clamp(a.clone().normalize().dot(b.clone().normalize()), -1, 1)) / D;

// ---------------------------------------------------------------- the relaxed hand
// MakeHuman's bind hand is flat with the fingers fanned and the thumb out at ~45 deg; hero.js relaxHand (cascade) curls the PIP joints
// over an MCP that stays nearly straight and a fan that stays open: at the side of a hanging arm that reads as a claw. The resting
// hand (the surgeons' "cascade"; Kapandji): the fingers close together (a slight fan), the MCP joints flex with the PIP (so the finger
// arcs instead of hooking), the flexion grows from the index to the little finger, the ring and little metacarpals cup the palm, and the
// thumb comes in to lie by the index, its pad near the side of the index's middle phalanx.
// Angles (deg), index..little: MCP, PIP, DIP; x curl (0.85-1.15 seeded). Fan: each proximal phalanx turned in the palm plane toward a
// relaxed spread (index -4, middle 0, ring +5, little +10 deg from the hand's long axis) by `close` (1 = all the way).
export const HAND_RELAXED = { mcp: [16, 20, 25, 30], pip: [20, 26, 31, 36], dip: [6, 8, 10, 12], fan: [-4, 0, 5, 10], cup: [0, 0, 3, 7],
  thumb: { reach: 0.55, mcp: 14, ip: 16 } };
const FING = [[2, 'metacarpal1'], [3, 'metacarpal2'], [4, 'metacarpal3'], [5, 'metacarpal4']];
// the bind hand frame (hero.js _hand0: a index->little across the knuckles, f along the fingers, n out of the palm)
function bindDir(h, n, side) { const i = h.idx[`${n}.${side}`]; return h.tail0[i].clone().sub(h.head0[i]).normalize(); }
export function openHand2(h, side) {
  for (let n = 1; n <= 5; n++) for (let k = 1; k <= 3; k++) h.bone(`finger${n}-${k}.${side}`)?.quaternion.identity();
  for (let n = 1; n <= 4; n++) h.bone(`metacarpal${n}.${side}`)?.quaternion.identity();
  h.update();
}
export function relaxedHand(h, side, { curl = 1, close = 1, thumb = 1, spec = HAND_RELAXED } = {}) {
  openHand2(h, side);
  const H = h._hand0(side), q = new THREE.Quaternion();
  const loc = (bone, axis, ang) => { const B = h.bone(`${bone}.${side}`); if (B && Math.abs(ang) > 1e-6) B.quaternion.multiply(q.setFromAxisAngle(axis, ang)); };
  // the palm normal n and the bind finger directions are in the bind (world-aligned) frame every hero bone's local frame starts in
  FING.forEach(([fn, mc], k) => {
    // the cup: the ring and little metacarpals flex a little toward the palm
    const dm = bindDir(h, mc, side), axM = V3().crossVectors(dm, H.n).normalize();
    loc(mc, axM, spec.cup[k] * D * curl);
    // the fan: the proximal phalanx turned about n toward its relaxed spread
    const d1 = bindDir(h, `finger${fn}-1`, side), now = Math.atan2(d1.dot(H.a), d1.dot(H.f)) / D, want = spec.fan[k];
    const turn = (want - now) * close;
    // rotation about n: + turns f toward a for one sign; test it on the bind direction
    const qa = new THREE.Quaternion().setFromAxisAngle(H.n, turn * D), d1t = d1.clone().applyQuaternion(qa), after = Math.atan2(d1t.dot(H.a), d1t.dot(H.f)) / D;
    const sgn = Math.abs(after - want) <= Math.abs(now - want) ? 1 : -1;
    loc(`finger${fn}-1`, H.n, sgn * turn * D);
    // flexion: hero.js's own flexion axes (+ curls to the palm)
    loc(`finger${fn}-1`, h._flexAxis(side, `finger${fn}-1`), spec.mcp[k] * D * curl);
    loc(`finger${fn}-2`, h._flexAxis(side, `finger${fn}-2`), spec.pip[k] * D * curl);
    loc(`finger${fn}-3`, h._flexAxis(side, `finger${fn}-3`), spec.dip[k] * D * curl);
  });
  h.update();
  if (thumb > 0) thumbRest(h, side, { k: thumb, spec: spec.thumb, curl });
  return h;
}
// the thumb: the metacarpal (finger1-1) swung in toward the index (a small search over two angles about the bind palm frame) until the
// tip lies by the radial side of the index's middle phalanx, a little palmar, not inside it; then the MCP and IP flex a little
function thumbRest(h, side, { k = 1, spec = HAND_RELAXED.thumb, curl = 1 } = {}) {
  const H = h._hand0(side), B = h.bone(`finger1-1.${side}`), base = B.quaternion.clone(), q = new THREE.Quaternion();
  const tip = () => { h.update(); const i = h.idx[`finger1-3.${side}`], b = h.bone(`finger1-3.${side}`); const t = h.tail0[i].clone().sub(h.head0[i]); const wq = new THREE.Quaternion(); b.getWorldQuaternion(wq); return h.joint(`finger1-3.${side}`).add(t.applyQuaternion(wq).multiplyScalar(h.scale)); };
  // flex the thumb's MCP and IP first (the search then places a bent thumb)
  const loc = (bone, ang) => { const Bn = h.bone(`${bone}.${side}`); Bn.quaternion.multiply(q.setFromAxisAngle(h._flexAxis(side, bone), ang)); };
  loc('finger1-2', spec.mcp * D * curl * k); loc('finger1-3', spec.ip * D * curl * k); h.update();
  const P = h.palm(side), r = (h.o?.height || 1.7) / 1.8;
  // the target: beside the index's middle phalanx (finger2-2), toward the thumb side (-a) and a little palmar (+n)
  const mid = h.joint(`finger2-2.${side}`).lerp(h.joint(`finger2-3.${side}`), 0.35);
  const target = mid.clone().addScaledVector(P.a, -0.012 * r).addScaledVector(P.n, 0.009 * r);
  const tip0 = tip(), wq = new THREE.Quaternion(); B.parent.getWorldQuaternion(wq); const toLoc = v => v.clone().applyQuaternion(wq.clone().invert()).normalize();
  // three axes (the palm normal, the hand's long axis, across the knuckles): coordinate descent from the bind, coarse to fine
  const axs = [toLoc(P.n), toLoc(P.f), toLoc(P.a)];
  const set = x => { B.quaternion.copy(base); for (let j = 0; j < 3; j++) B.quaternion.premultiply(q.setFromAxisAngle(axs[j], x[j])); };
  // not into the index: the thumb's tip and IP joint stay a finger's breadth (thumb + index radii, ~1.75 cm at 1.8 m) off the index's bones
  const idx = ['finger2-1', 'finger2-2', 'finger2-3'].map(n => h.joint(`${n}.${side}`)), i3 = h.idx[`finger2-3.${side}`], q3w = new THREE.Quaternion(); h.bone(`finger2-3.${side}`).getWorldQuaternion(q3w);
  idx.push(idx[2].clone().add(h.tail0[i3].clone().sub(h.head0[i3]).applyQuaternion(q3w).multiplyScalar(h.scale)));
  const segD = p => { let d = Infinity; for (let j = 0; j < 3; j++) { const a0 = idx[j], ab = idx[j + 1].clone().sub(a0), t = clamp(p.clone().sub(a0).dot(ab) / ab.lengthSq()); d = Math.min(d, p.distanceTo(a0.clone().addScaledVector(ab, t))); } return d; };
  const clear = 0.0175 * r, cost = () => { const t = tip(); return t.distanceTo(target) + 3 * Math.max(0, clear - segD(t)) + 3 * Math.max(0, clear - segD(h.joint(`finger1-3.${side}`))); };
  let x = [0, 0, 0], e0 = cost(), best = e0;
  for (let st = 0.32; st > 0.004; st /= 2) { let moved = true; for (let pass = 0; pass < 6 && moved; pass++) { moved = false;
    for (let j = 0; j < 3; j++) for (const d of [st, -st]) { const y = x.slice(); y[j] = clamp(y[j] + d, -1.3, 1.3); set(y); const e = cost(); if (e < best - 1e-5) { best = e; x = y; moved = true; } } } }
  set(x); const gap = segD(tip()) / r; set(x.map(v => v * k));   // k scales the swing (1 = all the way to the rest)
  if (globalThis.__poseDbg) console.log('thumbRest', side, 'e0', e0.toFixed(4), 'best', best.toFixed(4), 'gap', gap.toFixed(4), x.map(v => (v / D).toFixed(0)));
  h.update();
  return { miss: best, gapToIndex: gap, swing: x.map(v => +(v / D).toFixed(1)) };
}

// ---------------------------------------------------------------- measures
// the 2-D convex hull (x, z) and a point's signed distance inside it (+ inside)
function hull2(pts) { const P = pts.map(p => [p.x, p.z]).sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (P.length < 3) return P;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of P.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1)); }
function insideDist(H, x, z) { let d = Infinity, inside = true;
  for (let i = 0; i < H.length; i++) { const a = H[i], b = H[(i + 1) % H.length], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez) || 1;
    const c = (ex * (z - a[1]) - ez * (x - a[0])) / L; if (c < 0) inside = false;
    const t = clamp(((x - a[0]) * ex + (z - a[1]) * ez) / (L * L)), px = a[0] + t * ex, pz = a[1] + t * ez; d = Math.min(d, Math.hypot(x - px, z - pz)); }
  return inside ? d : -d; }
// a foot's own support: heel and toe points widened sideways by half a foot breadth (0.055 H x 0.5 ~ 4.7 cm at 1.7 m)
function footPoly(P, s, F, w) { const he = P['heel' + s], to = P['to' + s], out = []; for (const p of [he, to]) for (const k of [-1, 1]) out.push(p.clone().addScaledVector(F.lat, k * w)); return out; }
export function readStance(h, K = null) {
  K = K || kinOf(h); const F = frame(h), P = heroPoints(h, K), C = heroCom(h, K), Hh = h.o?.height || 1.7, w = 0.028 * Hh;
  const aL = h.joint('foot.L'), aR = h.joint('foot.R'), hl = h.joint('upperleg01.L'), hr = h.joint('upperleg01.R'), sl = h.joint('upperarm01.L'), sr = h.joint('upperarm01.R');
  const both = hull2([...footPoly(P, 'L', F, w), ...footPoly(P, 'R', F, w)]), onL = hull2(footPoly(P, 'L', F, w)), onR = hull2(footPoly(P, 'R', F, w));
  const ab = aR.clone().sub(aL); ab.y = 0; const c = C.clone().sub(aL); c.y = 0; const tL = clamp(c.dot(ab) / ab.lengthSq(), -0.5, 1.5);   // 0 = over the left ankle
  const shareL = clamp(1 - tL);   // static two-support lever: the share of weight on the left foot
  const tilt = (a, b) => Math.atan2(a.y - b.y, Math.abs(a.clone().sub(b).dot(F.lat))) / D;   // + = the LEFT side higher
  // head: forward and up of the head bone against the body frame
  const hq = worldQ(h, 'head'), hf = V3(0, 0, 1).applyQuaternion(hq), hu = V3(0, 1, 0).applyQuaternion(hq), q0 = new THREE.Quaternion();
  const knee = s => 180 - deg(h.joint(`upperleg01.${s}`).sub(h.joint(`lowerleg01.${s}`)), h.joint(`foot.${s}`).sub(h.joint(`lowerleg01.${s}`)));
  const elbow = s => 180 - deg(h.joint(`upperarm01.${s}`).sub(h.joint(`lowerarm01.${s}`)), h.joint(`wrist.${s}`).sub(h.joint(`lowerarm01.${s}`)));
  // finger flexion: the angle between consecutive phalanges (and the metacarpal) per finger; the fan: proximal phalanges' spread in the palm plane
  const fingers = {}, fan = {};
  for (const s of ['L', 'R']) { const Pm = h.palm(s); fingers[s] = []; fan[s] = [];
    for (const [fn, mc] of FING) { const j = [h.joint(`${mc}.${s}`), h.joint(`finger${fn}-1.${s}`), h.joint(`finger${fn}-2.${s}`), h.joint(`finger${fn}-3.${s}`)];
      const i3 = h.idx[`finger${fn}-3.${s}`], b3 = h.bone(`finger${fn}-3.${s}`); b3.getWorldQuaternion(q0); const tipP = j[3].clone().add(h.tail0[i3].clone().sub(h.head0[i3]).applyQuaternion(q0).multiplyScalar(h.scale));
      const seg = [j[1].clone().sub(j[0]), j[2].clone().sub(j[1]), j[3].clone().sub(j[2]), tipP.clone().sub(j[3])];
      fingers[s].push([deg(seg[0], seg[1]), deg(seg[1], seg[2]), deg(seg[2], seg[3])].map(x => +x.toFixed(0)));
      const d = seg[1].clone().addScaledVector(Pm.n, -seg[1].dot(Pm.n)); fan[s].push(+(Math.atan2(d.dot(Pm.a), d.dot(Pm.f)) / D).toFixed(0)); } }
  const r = x => +x.toFixed(1);
  return { comMm: [r(C.x * 1000), r(C.y * 1000), r(C.z * 1000)], comInSupportMm: r(insideDist(both, C.x, C.z) * 1000),
    comOverL_Mm: r(insideDist(onL, C.x, C.z) * 1000), comOverR_Mm: r(insideDist(onR, C.x, C.z) * 1000), shareL: r(shareL * 100) / 100,
    ankleSepH: +(Math.abs(aL.clone().sub(aR).dot(F.lat)) / Hh).toFixed(3), comFwdOfAnklesMm: r(C.clone().sub(aL.clone().add(aR).multiplyScalar(0.5)).dot(F.fwd) * 1000),
    pelvisTiltL: r(tilt(hl, hr)), shoulderTiltL: r(tilt(sl, sr)), pelvisYaw: r(Math.atan2(hl.clone().sub(hr).dot(F.fwd), hl.clone().sub(hr).dot(F.lat)) / D),
    shoulderYaw: r(Math.atan2(sl.clone().sub(sr).dot(F.fwd), sl.clone().sub(sr).dot(F.lat)) / D),
    head: { turn: r(Math.atan2(hf.dot(F.lat), hf.dot(F.fwd)) / D), nod: r(-Math.asin(clamp(hf.dot(F.up), -1, 1)) / D), tilt: r(Math.atan2(hu.dot(F.lat), hu.dot(F.up)) / D) },
    kneeL: r(knee('L')), kneeR: r(knee('R')), elbowL: r(elbow('L')), elbowR: r(elbow('R')), fingers, fan };
}

// ---------------------------------------------------------------- the posed body's surface (CPU skinning of the regions asked for)
// hero.js regions (aHero.x): torso 2, upper arm 3, forearm 4, hand 5, finger 6, pelvis 7, thigh 8
const REG = { torso: 2, uarm: 3, farm: 4, hand: 5, finger: 6, pelvis: 7, thigh: 8 };
export function posedRegion(h, regs, { step = 1 } = {}) {
  h.update(); const g = h.body.geometry, A = g.attributes.aHero?.array, n = g.attributes.position.count, want = new Set(regs.map(r => REG[r] ?? r)), out = [], v = V3();
  if (!A) return out; h.body.updateMatrixWorld(true);
  for (let i = 0; i < n; i += step) { if (!want.has(Math.round(A[i * 4]))) continue; v.fromBufferAttribute(g.attributes.position, i); h.body.applyBoneTransform(i, v); out.push(v.clone().applyMatrix4(h.body.matrixWorld)); }
  return out;
}
// the body's extent along a direction in a height band (the farthest skin point): { d (m along dir from o), p (the point) }
function extent(pts, o, dir, y0, y1, filt = null) { let best = -Infinity, bp = null;
  for (const p of pts) { if (p.y < y0 || p.y > y1) continue; if (filt && !filt(p)) continue; const d = p.clone().sub(o).dot(dir); if (d > best) { best = d; bp = p; } }
  return { d: best, p: bp }; }

// ---------------------------------------------------------------- orient a hand: the forearm rolls (pronation / supination: the twist
// about its own axis, split between lowerarm01 and its twist bone lowerarm02), the wrist takes the rest (the swing), capped
export function orientHand(h, side, fWant, nWant, { maxWrist = 75, it = 2 } = {}) {
  const fw = fWant.clone().normalize(), nw = nWant.clone().addScaledVector(fw, -nWant.dot(fw)).normalize(), aw = V3().crossVectors(fw, nw);
  let wristDeg = 0;
  for (let k = 0; k < it; k++) {
    const P = h.palm(side), f = P.f.clone().normalize(), n = P.n.clone().addScaledVector(f, -P.n.dot(f)).normalize(), a = V3().crossVectors(f, n);
    const Mc = new THREE.Matrix4().makeBasis(a, f, n), Mw = new THREE.Matrix4().makeBasis(aw, fw, nw), R = Mw.multiply(Mc.transpose()), q = new THREE.Quaternion().setFromRotationMatrix(R);
    const E = h.joint(`lowerarm01.${side}`), u = h.joint(`wrist.${side}`).sub(E).normalize();
    const pj = q.x * u.x + q.y * u.y + q.z * u.z, tw = new THREE.Quaternion(u.x * pj, u.y * pj, u.z * pj, q.w); if (tw.lengthSq() < 1e-12) tw.set(0, 0, 0, 1); tw.normalize();
    let twa = 2 * Math.atan2(u.x * tw.x + u.y * tw.y + u.z * tw.z, tw.w); if (twa > Math.PI) twa -= 2 * Math.PI; if (twa < -Math.PI) twa += 2 * Math.PI;
    twa = clamp(twa, -110 * D, 110 * D);
    h.rotateWorld(`lowerarm01.${side}`, u, twa * 0.5); h.update(); if (h.bone(`lowerarm02.${side}`)) { h.rotateWorld(`lowerarm02.${side}`, u, twa * 0.5); h.update(); } else { h.rotateWorld(`lowerarm01.${side}`, u, twa * 0.5); h.update(); }
    // the swing at the wrist
    const P2 = h.palm(side), f2 = P2.f.clone().normalize(), n2 = P2.n.clone().addScaledVector(f2, -P2.n.dot(f2)).normalize(), a2 = V3().crossVectors(f2, n2);
    const R2 = new THREE.Matrix4().makeBasis(aw, fw, nw).multiply(new THREE.Matrix4().makeBasis(a2, f2, n2).transpose()), q2 = new THREE.Quaternion().setFromRotationMatrix(R2);
    let ang = 2 * Math.acos(clamp(q2.w, -1, 1)); const ax = V3(q2.x, q2.y, q2.z); if (ax.lengthSq() < 1e-12) break; ax.normalize(); if (ang > Math.PI) { ang = 2 * Math.PI - ang; ax.negate(); }
    wristDeg = ang / D; h.rotateWorld(`wrist.${side}`, ax, Math.min(ang, maxWrist * D)); h.update();
  }
  return wristDeg;
}
// put the palm's skin point (hero.js palm().palm) at P with the hand in (fWant, nWant): the wrist target follows from the hand's own offset
function handAt(h, side, Pc, fWant, nWant, pole, { maxWrist = 75 } = {}) {
  const fw = fWant.clone().normalize(), nw = nWant.clone().addScaledVector(fw, -nWant.dot(fw)).normalize(), aw = V3().crossVectors(fw, nw);
  let miss = 0, wd = 0;
  for (let k = 0; k < 3; k++) {
    const P = h.palm(side), f = P.f.clone().normalize(), n = P.n.clone().addScaledVector(f, -P.n.dot(f)).normalize(), a = V3().crossVectors(f, n);
    const o = P.palm.clone().sub(h.joint(`wrist.${side}`)), oc = [o.dot(a), o.dot(f), o.dot(n)];
    const Wt = Pc.clone().sub(aw.clone().multiplyScalar(oc[0])).addScaledVector(fw, -oc[1]).addScaledVector(nw, -oc[2]);
    twoBoneHero(h, `upperarm01.${side}`, `lowerarm01.${side}`, `wrist.${side}`, Wt, pole);
    wd = orientHand(h, side, fw, nw, { maxWrist });
    miss = h.palm(side).palm.distanceTo(Pc);
  }
  return { miss, wristDeg: wd };
}

// ---------------------------------------------------------------- the stance record (seeded per person)
// legs:  relaxed (weight nearly even, both knees straight, a small hip drop) | contra (contrapposto: the weight on one leg, the standing
//        hip up and out, the free side dropped, the free knee bent and its foot forward and turned out, the shoulders counter-tilted)
//        | hipDrop (all the weight on one leg, the hip pushed out over it, a bigger drop, the free foot out to the side)
// arms:  hang | pocket (one hand in a front trouser pocket: dressed people only) | hip (one hand on the hip) | folded | clasp (hands loosely
//        clasped in front) | claspBack (behind)
// side:  the STANDING leg ('L' | 'R'); armSide: the hand that goes to the pocket or the hip
// Numbers are ours, read off the typical references by eye (no table): drop 4-7 deg in a contrapposto, the shoulders counter-tilted by
// 0.35-0.65 of it, weight 80-92 % on the standing foot, head turns within +/-18 deg and tilts within +/-7.
export const LEGS = ['relaxed', 'contra', 'hipDrop'];
export const ARMS = ['hang', 'pocket', 'hip', 'folded', 'clasp', 'claspBack'];
const pickW = (r, W) => { const t = r() * Object.values(W).reduce((a, b) => a + b, 0); let acc = 0; for (const [k, w] of Object.entries(W)) { acc += w; if (t <= acc) return k; } return Object.keys(W)[0]; };
export function stanceOf(name, { sex = null, age = 35, dressed = false, seed = 1, legs = null, arms = null, side = null, armSide = null, head = null } = {}) {
  const r = mulberry(hashStr(name) ^ Math.imul(seed | 0, 0x9E3779B1)), U = (a, b) => a + (b - a) * r(), f = sex ? sex === 'f' : /_f\d/.test(name);
  const L = legs || pickW(r, f ? { relaxed: 0.25, contra: 0.45, hipDrop: 0.3 } : { relaxed: 0.3, contra: 0.55, hipDrop: 0.15 });
  const sd = side || (r() < 0.5 ? 'L' : 'R');
  const A = arms || pickW(r, { hang: 0.4, pocket: dressed ? 0.16 : 0, hip: 0.13, folded: 0.14, clasp: 0.1, claspBack: f ? 0.03 : 0.08 });
  const aS = armSide || (A === 'hip' ? (r() < 0.6 ? sd : sd === 'L' ? 'R' : 'L') : r() < 0.5 ? 'L' : 'R');
  const P = { relaxed: { w: [0.55, 0.65], drop: [1, 2.5], fwd: [0.0, 0.035], out: [0, 0.01], turn: [0, 6], twist: [0, 3] },
    contra: { w: [0.8, 0.9], drop: [4, 6.5], fwd: [0.05, 0.11], out: [0.0, 0.03], turn: [8, 16], twist: [3, 7] },
    hipDrop: { w: [0.9, 0.96], drop: [6.5, 9], fwd: [0.01, 0.06], out: [0.04, 0.08], turn: [10, 20], twist: [4, 8] } }[L];
  const old = clamp((age - 40) / 30);
  const hs = r() < 0.5 ? -1 : 1, rec = { v: 1, name, seed, legs: L, side: sd, arms: A, armSide: aS,
    w: +U(...P.w).toFixed(3), drop: +U(...P.drop).toFixed(2), counter: +U(0.35, 0.65).toFixed(2), fwd: +U(...P.fwd).toFixed(3), out: +U(...P.out).toFixed(3), turn: +U(...P.turn).toFixed(1),
    twist: +U(...P.twist).toFixed(1), stanceW: +U(0.92, 1.15).toFixed(2), lean: +U(0.5, 1.8).toFixed(2),
    head: head || { turn: +(hs * U(3, 18)).toFixed(1), tilt: +((r() < 0.5 ? -1 : 1) * U(1.5, 7) * (1 - 0.4 * old)).toFixed(1), nod: +U(-2, 5).toFixed(1) },
    curl: +U(0.9, 1.1).toFixed(2), elbow: +U(8, 20).toFixed(1), out0: +U(0.0, 0.06).toFixed(3) };
  return rec;
}

// ---------------------------------------------------------------- standPerson: the hero stood by a stance record from its own kin
export function standPerson(h, S, { person = null, K = null } = {}) {
  K = K || kinOf(h, { person });
  h.resetPose(); h.update();
  const F = frame(h), Hh = h.o?.height || 1.7, s = Hh / 1.7, W = S.side === 'R' ? 'R' : 'L', Fr = W === 'L' ? 'R' : 'L', sgW = W === 'L' ? 1 : -1;
  const ST = K?.F?.stance || { ankleSep: 0.114 * Hh, footAngle: 12 }, half = ST.ankleSep / 2 * (S.stanceW ?? 1), toe = (ST.footAngle ?? 12) / 2 * D, PO = K?.gait?.posture || {}, kn = hingeOf(K, 'knee');
  const ank = { L: h.joint('foot.L'), R: h.joint('foot.R') }, fq = { L: worldQ(h, 'foot.L'), R: worldQ(h, 'foot.R') }, mid = ank.L.clone().add(ank.R).multiplyScalar(0.5);
  const tgt = { [W]: mid.clone().addScaledVector(F.lat, sgW * half), [Fr]: mid.clone().addScaledVector(F.lat, -sgW * (half + (S.out || 0) * s)).addScaledVector(F.fwd, (S.fwd || 0) * s) };
  const root = h.bone('root'), rep = { record: S };
  // the pelvis: the STANDING side up (the free side dropped), the free hip a little forward
  root.position.y -= 0.012 / h.scale; h.update();
  h.rotateWorld('root', F.fwd, sgW * (S.drop || 0) * D); h.rotateWorld('root', F.up, sgW * (S.twist || 0) * D); h.update();
  // the trunk: lateral flexion back over the standing side, so the shoulder line tilts against the pelvis by counter x drop; the
  // thorax turns back against the pelvis' twist (shoulders about square, a little the other way)
  const lat = (S.drop || 0) * (1 + (S.counter ?? 0.5)), sh = [['spine05', 0.3], ['spine04', 0.25], ['spine03', 0.2], ['spine02', 0.15], ['spine01', 0.1]];
  for (const [b, k] of sh) h.rotateWorld(b, F.fwd, -sgW * lat * k * D);
  for (const [b, k] of [['spine03', 0.35], ['spine02', 0.35], ['spine01', 0.3]]) h.rotateWorld(b, F.up, -sgW * (S.twist || 0) * 1.2 * k * D);
  h.rotateWorld('spine03', F.lat, 0.75 * (PO.kyphosis ?? 0.05)); h.rotateWorld('neck01', F.lat, -0.5 * (PO.headFwd ?? 0.04));
  if (PO.lumbarExtension) { h.rotateWorld('spine05', F.lat, -PO.lumbarExtension * 0.5); h.rotateWorld('spine04', F.lat, -PO.lumbarExtension * 0.5); }
  h.update();
  // the head: the neck takes back most of the shoulder tilt (the eyes stay near level), then the record's turn, tilt and nod
  const shoulderTilt = () => { const a = h.joint('upperarm01.L'), b = h.joint('upperarm01.R'); return Math.atan2(a.y - b.y, Math.abs(a.clone().sub(b).dot(F.lat))) / D; };
  const headPose = () => { const hq = worldQ(h, 'head'), hu = V3(0, 1, 0).applyQuaternion(hq), roll = Math.atan2(hu.dot(F.lat), hu.dot(F.up)) / D; // + = the top toward the LEFT
    const fix = -roll * 0.85; h.rotateWorld('neck01', F.fwd, -fix * 0.5 * D); h.rotateWorld('neck02', F.fwd, -fix * 0.5 * D); h.update();
    const T = S.head || {}; h.rotateWorld('neck01', F.up, (T.turn || 0) * 0.45 * D); h.rotateWorld('head', F.up, (T.turn || 0) * 0.55 * D); h.update();
    const q1 = worldQ(h, 'head'), hf = V3(0, 0, 1).applyQuaternion(q1); h.rotateWorld('head', hf, -(T.tilt || 0) * D); h.update();
    const q2 = worldQ(h, 'head'), hl = V3(1, 0, 0).applyQuaternion(q2); h.rotateWorld('head', hl, (T.nod || 0) * D); h.rotateWorld('neck02', hl, (T.nod || 0) * 0.3 * D); h.update(); };
  headPose();
  // the legs: lane F's solve with the record's targets: the standing leg straight (locked into the person's own hyperextension in
  // proportion to the weight), the free leg reaching its foot (its knee bends by the slack the dropped hip gives it)
  const lock = clamp(((S.w ?? 0.85) - 0.5) * 2.2);
  const L1 = h.joint(`upperleg01.${W}`).distanceTo(h.joint(`lowerleg01.${W}`)), L2 = h.joint(`lowerleg01.${W}`).distanceTo(h.joint(`foot.${W}`)), lockDeg = kn.ext * lock;
  const dLock = Math.min(Math.sqrt(L1 * L1 + L2 * L2 + 2 * L1 * L2 * Math.cos(lockDeg * D)), (L1 + L2) * 0.99995);
  const lift = () => { const Hp = h.joint(`upperleg01.${W}`), T = tgt[W], dx = Hp.clone().sub(T).dot(F.lat), dz = Hp.clone().sub(T).dot(F.fwd), y = T.y + Math.sqrt(Math.max(1e-6, dLock * dLock - dx * dx - dz * dz));
    root.position.y += (y - Hp.y) / h.scale; h.update(); };
  const legs = () => { const r = {};
    for (const sd of [W, Fr]) r[sd] = twoBoneKin(h, `upperleg01.${sd}`, `lowerleg01.${sd}`, `foot.${sd}`, tgt[sd], F.fwd.clone().addScaledVector(F.lat, (sd === 'L' ? 1 : -1) * 0.2), { ...kn, lock: sd === W ? lock : 0 });
    setWorldQ(h, `foot.${W}`, new THREE.Quaternion().setFromAxisAngle(F.up, sgW * toe).multiply(fq[W]));
    setWorldQ(h, `foot.${Fr}`, new THREE.Quaternion().setFromAxisAngle(F.up, -sgW * (toe + (S.turn || 0) * D)).multiply(fq[Fr])); return r; };
  // the balance: the COM (the person's own segments) over the weighted support: laterally (1 - w) of the way from the standing ankle to
  // the free one; forward of the ankles by ~3 cm + the record's lean (quiet stance sways about a point a few cm ahead of the ankle)
  const wantCom = () => { const w = S.w ?? 0.85, A = tgt[W].clone().multiplyScalar(w).add(tgt[Fr].clone().multiplyScalar(1 - w)); return A.addScaledVector(F.fwd, (0.025 + 0.012 * (S.lean ?? 1)) * s); };
  let lr = null; const balance = (n = 6) => { let e = V3();
    for (let it = 0; it < n; it++) { lift(); lr = legs(); const C = heroCom(h, K), want = wantCom(); e = C.clone().sub(want); e.y = 0;
      if (e.length() < 0.0015 && it) break; root.position.x -= e.dot(F.lat) * F.lat.x / h.scale + e.dot(F.fwd) * F.fwd.x / h.scale; root.position.z -= e.dot(F.lat) * F.lat.z / h.scale + e.dot(F.fwd) * F.fwd.z / h.scale; h.update(); }
    lift(); lr = legs();
    // a free foot out of reach (the dropped hip too high for it): bring it in toward the standing foot and solve again
    for (let k = 0; k < 6 && lr[Fr].miss > 0.003; k++) { tgt[Fr].lerp(tgt[W].clone().addScaledVector(F.lat, -sgW * 0.6 * half * 2), 0.25); lift(); lr = legs(); }
    return e.length() * 1000; };
  balance();
  // the arms
  rep.arms = armsFor(h, S, K, F);
  rep.comErrMm = +balance(8).toFixed(1);
  rep.knee = { [W]: +lr[W].flex.toFixed(1), [Fr]: +lr[Fr].flex.toFixed(1) }; rep.footMissMm = { [W]: +(lr[W].miss * 1000).toFixed(1), [Fr]: +(lr[Fr].miss * 1000).toFixed(1) };
  h.update(); rep.read = readStance(h, K); h._stance = rep; return rep;
}

// ---------------------------------------------------------------- the arms (and hands) of each variant
function armsFor(h, S, K, F) {
  const s = (h.o?.height || 1.7) / 1.7, A = S.arms || 'hang', out = {}, curl = S.curl ?? 1;
  const hip = { L: h.joint('upperleg01.L'), R: h.joint('upperleg01.R') }, sho = { L: h.joint('upperarm01.L'), R: h.joint('upperarm01.R') };
  const trunk = posedRegion(h, ['torso', 'pelvis', 'thigh'], { step: 1 });
  const other = sd => sd === 'L' ? 'R' : 'L';
  const hangSides = A === 'hang' ? ['L', 'R'] : A === 'pocket' || A === 'hip' ? [other(S.armSide)] : [];
  for (const sd of hangSides) out[sd] = hangArm(h, sd, S, K, F, trunk);
  if (A === 'hip') out[S.armSide] = hipHand(h, S.armSide, S, F, trunk, hip);
  if (A === 'pocket') out[S.armSide] = pocketHand(h, S.armSide, S, F, trunk, hip);
  if (A === 'folded') Object.assign(out, foldArms(h, S, F, trunk, sho));
  if (A === 'clasp' || A === 'claspBack') Object.assign(out, claspHands(h, S, F, trunk, hip, A === 'claspBack'));
  return out;
}
// a hanging arm: down, out just enough to clear the posed hip and thigh (the mesh, not a table), a little back, the elbow soft, the
// palm turned to the thigh, the carrying angle at the elbow (lane F), the relaxed hand
function hangArm(h, sd, S, K, F, trunk) {
  const sg = sd === 'L' ? 1 : -1, Sj = h.joint(`upperarm01.${sd}`), back = 0.03 + (sd !== S.side ? 0.03 : 0), elbow = (S.elbow ?? 12) * D * (sd === S.side ? 0.8 : 1.15);
  let o = 0.08 + (S.out0 ?? 0.03), rep = null;
  const dir = F.lat.clone().multiplyScalar(sg);
  for (let it = 0; it < 8; it++) {
    restArmQ(h, sd, { out: o, back, elbow });
    // clearance: the forearm and the hand (radius ~3.2 cm at 1.7 m, the hand's half thickness ~2 cm) against the trunk's extent at their height
    const E = h.joint(`lowerarm01.${sd}`), Wr = h.joint(`wrist.${sd}`), Pm = h.palm(sd).palm; let need = 0;
    for (const [p, rad] of [[E.clone().lerp(Wr, 0.5), 0.03], [Wr, 0.026], [Pm, 0.018]]) { const ex = extent(trunk, p, dir, p.y - 0.035 * (h.o.height / 1.7), p.y + 0.035 * (h.o.height / 1.7), q => q.clone().sub(p).dot(F.fwd) > -0.07 && q.clone().sub(p).dot(F.fwd) < 0.07);
      if (ex.p) need = Math.max(need, ex.d + rad * (h.o.height / 1.7)); }
    rep = { out: +o.toFixed(3), clearMm: +(-need * 1000).toFixed(1) };
    if (need <= 0.002) break; o += Math.min(0.12, need / (Sj.distanceTo(Pm) || 0.6) * 1.1);
  }
  rep.carry = carrying(h, sd, K, { pole: F.fwd.clone().negate(), keep: 'upper' });
  relaxedHand(h, sd, { curl: S.curl ?? 1 });
  return rep;
}
// restArm (workforce.js) without its hand: the arm down, out and back, the elbow soft, the palm to the thigh
function restArmQ(h, side, { out = 0.12, back = 0.04, elbow = 0.22 } = {}) {
  const F = frame(h), sg = side === 'L' ? 1 : -1;
  for (const b of [`upperarm01.${side}`, `upperarm02.${side}`, `lowerarm01.${side}`, `lowerarm02.${side}`, `wrist.${side}`]) h.bone(b)?.quaternion.identity(); h.update();
  const S = h.joint(`upperarm01.${side}`), E = h.joint(`lowerarm01.${side}`), Wr = h.joint(`wrist.${side}`), L1 = S.distanceTo(E), L2 = E.distanceTo(Wr);
  const dU = V3(0, -1, 0).addScaledVector(F.lat, sg * out).addScaledVector(F.fwd, -back).normalize(), Et = S.clone().addScaledVector(dU, L1), dF = dU.clone().applyAxisAngle(F.lat, -elbow).normalize();
  twoBoneHero(h, `upperarm01.${side}`, `lowerarm01.${side}`, `wrist.${side}`, Et.clone().addScaledVector(dF, L2), F.fwd.clone().negate());
  // the palm to the thigh, turned a little back (the thumb forward); a touch of ulnar deviation
  const f0 = h.joint(`wrist.${side}`).sub(h.joint(`lowerarm01.${side}`)).normalize(), n = F.lat.clone().multiplyScalar(-sg).addScaledVector(F.fwd, -0.3).normalize();
  const fw = f0.clone().addScaledVector(F.lat, -sg * 0.06).addScaledVector(F.fwd, 0.04).normalize();
  orientHand(h, side, fw, n, { maxWrist: 30 });
}
// a hand on the hip: the palm on the side of the waist just above the iliac crest, the fingers forward and down, the thumb back, the
// elbow out to the side and a little back
function hipHand(h, sd, S, F, trunk, hip) {
  const sg = sd === 'L' ? 1 : -1, s = (h.o?.height || 1.7) / 1.7, y = hip[sd].y + 0.085 * s, dir = F.lat.clone().multiplyScalar(sg), mid = h.joint('root');
  const ex = extent(trunk, mid, dir, y - 0.02 * s, y + 0.02 * s);
  const zs = trunk.filter(p => Math.abs(p.y - y) < 0.02 * s && p.clone().sub(mid).dot(dir) > ex.d - 0.04 * s).map(p => p.clone().sub(mid).dot(F.fwd));
  const zMid = zs.length ? zs.reduce((a, b) => a + b, 0) / zs.length : 0;
  const Pc = mid.clone().addScaledVector(dir, ex.d + 0.012 * s).addScaledVector(F.fwd, zMid + 0.01 * s); Pc.y = y;
  const fW = F.fwd.clone().multiplyScalar(0.7).addScaledVector(F.up, -0.6).addScaledVector(dir, -0.15), nW = dir.clone().negate();
  for (const b of [`upperarm01.${sd}`, `upperarm02.${sd}`, `lowerarm01.${sd}`, `lowerarm02.${sd}`, `wrist.${sd}`]) h.bone(b)?.quaternion.identity();
  relaxedHand(h, sd, { curl: 0.45 * (S.curl ?? 1), thumb: 0.3 });
  const r = handAt(h, sd, Pc, fW, nW, dir.clone().addScaledVector(F.fwd, -0.7).addScaledVector(F.up, -0.2), { maxWrist: 70 });
  return { kind: 'hip', missMm: +(r.miss * 1000).toFixed(1), wristDeg: +wristAngle(h, sd).toFixed(0) };
}
// a hand in the front trouser pocket: the palm against the front of the hip, the fingers down into the pocket (sunk 1.5 cm under the
// skin's surface: the cloth over it hides them), the thumb left out over the pocket's edge
function pocketHand(h, sd, S, F, trunk, hip) {
  const sg = sd === 'L' ? 1 : -1, s = (h.o?.height || 1.7) / 1.7, y = hip[sd].y - 0.02 * s, dir = F.lat.clone().multiplyScalar(sg * 0.55).addScaledVector(F.fwd, 0.85).normalize();
  const mid = hip[sd].clone(), ex = extent(trunk, mid, dir, y - 0.015 * s, y + 0.015 * s, p => p.clone().sub(h.joint('root')).dot(F.lat) * sg > 0.02);
  const Pc = (ex.p ? ex.p.clone() : mid.clone().addScaledVector(dir, 0.08)).addScaledVector(dir, -0.012 * s); Pc.y = y;
  const fW = F.up.clone().multiplyScalar(-0.85).addScaledVector(F.fwd, 0.15).addScaledVector(F.lat, -sg * 0.25), nW = dir.clone().negate();
  for (const b of [`upperarm01.${sd}`, `upperarm02.${sd}`, `lowerarm01.${sd}`, `lowerarm02.${sd}`, `wrist.${sd}`]) h.bone(b)?.quaternion.identity();
  relaxedHand(h, sd, { curl: 0.55 * (S.curl ?? 1), thumb: 0 });
  const r = handAt(h, sd, Pc, fW, nW, F.lat.clone().multiplyScalar(sg).addScaledVector(F.fwd, -1), { maxWrist: 55 });
  return { kind: 'pocket', missMm: +(r.miss * 1000).toFixed(1), wristDeg: +wristAngle(h, sd).toFixed(0) };
}
// arms folded: the forearms crossed in front of the lower chest (under the bust), the lower one (B) against the body with its hand
// round the far side of the ribs under the other arm, the upper one (T) in front of it with its hand on B's upper arm above the elbow;
// the shoulders come a little forward. Built from the posed trunk's own surface: each elbow beside the trunk at the fold height, each
// forearm turned from straight ahead toward the other side until the next step would bring it within its radius of the skin (B) or
// of B's forearm (T).
function segDist(p, a, b) { const ab = b.clone().sub(a), t = clamp(p.clone().sub(a).dot(ab) / ab.lengthSq()); return p.distanceTo(a.clone().addScaledVector(ab, t)); }
function foldArms(h, S, F, trunk, sho) {
  const s = (h.o?.height || 1.7) / 1.7, T = S.armSide || 'L', B = T === 'L' ? 'R' : 'L', sgT = T === 'L' ? 1 : -1, sgB = -sgT, mid = h.joint('spine03');
  const f = /_f\d/.test(S.name || '') || h.meta?.kin?.sex === 'f';
  const shY = (sho.L.y + sho.R.y) / 2, front = (y, x0 = 0.11) => extent(trunk, mid, F.fwd, y - 0.015 * s, y + 0.015 * s, p => Math.abs(p.clone().sub(mid).dot(F.lat)) < x0 * s).d;
  let yF = shY - 0.25 * s;
  if (f) { let best = -1e9, yb = null; for (let y = shY - 0.1 * s; y > shY - 0.32 * s; y -= 0.01) { const d = front(y); if (d > best) { best = d; yb = y; } } if (yb != null) yF = Math.min(yF, yb - 0.07 * s); }
  for (const sd of [T, B]) { for (const b of [`upperarm01.${sd}`, `upperarm02.${sd}`, `lowerarm01.${sd}`, `lowerarm02.${sd}`, `wrist.${sd}`]) h.bone(b)?.quaternion.identity(); h.rotateWorld(`shoulder01.${sd}`, F.up, -(sd === 'L' ? 1 : -1) * 7 * D); }
  h.update();
  const near = trunk.filter(p => Math.abs(p.y - yF) < 0.16 * s);
  const clearSeg = (a, b, rad) => { let d = Infinity; for (const p of near) d = Math.min(d, segDist(p, a, b)); return d - rad * s; };
  const rep = {};
  // one arm: the elbow at height yE beside the trunk (forward of the shoulder by what the upper arm's length leaves), the forearm from
  // straight ahead (+fwd) turned toward the other side (-sg lat) and tilted up by `rise` until it would touch `avoid`
  const arm = (sd, yE0, rise, avoid, rad) => {
    const sg = sd === 'L' ? 1 : -1, Sj = h.joint(`upperarm01.${sd}`), Ej = h.joint(`lowerarm01.${sd}`), Wj = h.joint(`wrist.${sd}`), L1 = Sj.distanceTo(Ej), L2 = Ej.distanceTo(Wj);
    // candidates: the elbow's height (the fold height and up to 8 cm over it) and its direction from the shoulder (in front of it, from a
    // little inward to out); each keeps 4 cm off the trunk; the forearm swept from straight ahead toward the other side. The candidate
    // whose forearm gets farthest across wins (the lowest elbow on a tie): a forearm crossing the body, not held out in front of it
    let win = null;
    for (const dyE of [0, 0.03, 0.06, 0.09]) for (let beta = -15; beta <= 45; beta += 7.5) {
      const yE = yE0 + dyE * s, dy = Math.min(Sj.y - yE, L1 * 0.97), hz = Math.sqrt(L1 * L1 - dy * dy);
      const dir = F.fwd.clone().multiplyScalar(Math.cos(beta * D)).addScaledVector(F.lat, sg * Math.sin(beta * D)), E = Sj.clone().addScaledVector(dir, hz); E.y = Sj.y - dy;
      let dE = Infinity; for (const p of near) dE = Math.min(dE, p.distanceTo(E)); if (dE < 0.04 * s) continue;
      let best = null, bestA = -1;
      for (let a = 0; a <= 110; a += 5) { const fd = F.fwd.clone().multiplyScalar(Math.cos(a * D)).addScaledVector(F.lat, -sg * Math.sin(a * D)); fd.y = Math.tan(rise * D); fd.normalize();
        const W = E.clone().addScaledVector(fd, L2); if (clearSeg(E.clone().addScaledVector(fd, 0.04 * s), W, rad) < 0 || (avoid && avoid(E, W) < 0)) break; best = W; bestA = a; }
      if (best && (!win || bestA > win.a + 2)) win = { a: bestA, E, W: best, dyE };
    }
    if (!win) { const E = Sj.clone().addScaledVector(F.fwd, L1 * 0.5); E.y = Sj.y - L1 * 0.85; win = { a: 0, E, W: E.clone().addScaledVector(F.fwd, L2), dyE: 0 }; }
    // two-bone IK to the wrist with the pole at the elbow: the elbow lands where it was put
    const pole = win.E.clone().sub(Sj.clone().lerp(win.W, L1 / (L1 + L2)));
    twoBoneHero(h, `upperarm01.${sd}`, `lowerarm01.${sd}`, `wrist.${sd}`, win.W, pole);
    return { elbow: win.E, wrist: win.W, across: win.a };
  };
  const b = arm(B, yF - 0.015 * s, 6, null, 0.036);
  relaxedHand(h, B, { curl: 0.55 * (S.curl ?? 1), thumb: 0.5 });
  const dB = b.wrist.clone().sub(b.elbow).normalize();
  orientHand(h, B, dB.clone().multiplyScalar(0.45).addScaledVector(F.fwd, -0.8).addScaledVector(F.up, 0.1), F.fwd.clone().multiplyScalar(-0.5).addScaledVector(F.lat, -sgT * 0.85), { maxWrist: 50 });
  rep[B] = { kind: 'folded-under', across: b.across, elbow: +(180 - deg(h.joint(`upperarm01.${B}`).sub(h.joint(`lowerarm01.${B}`)), h.joint(`wrist.${B}`).sub(h.joint(`lowerarm01.${B}`)))).toFixed(0), clearMm: +(clearSeg(h.joint(`lowerarm01.${B}`), h.joint(`wrist.${B}`), 0.036) * 1000).toFixed(1) };
  // T: over B's forearm, its forearm kept a forearm's breadth (2 x 3.3 cm) off B's
  const b0 = h.joint(`lowerarm01.${B}`), b1 = h.joint(`wrist.${B}`), avoidB = (E, W) => { let d = Infinity; for (let i = 0; i <= 12; i++) d = Math.min(d, segDist(E.clone().lerp(W, i / 12), b0, b1)); return d - 0.066 * s; };
  const t = arm(T, yF + 0.02 * s, 10, avoidB, 0.036);
  relaxedHand(h, T, { curl: 0.7 * (S.curl ?? 1), thumb: 0.45 });
  const dT = t.wrist.clone().sub(t.elbow).normalize();
  orientHand(h, T, dT.clone().multiplyScalar(0.5).addScaledVector(F.fwd, -0.6).addScaledVector(F.up, -0.3), F.fwd.clone().multiplyScalar(-0.8).addScaledVector(F.lat, sgT * 0.4), { maxWrist: 50 });
  rep[T] = { kind: 'folded-over', across: t.across, elbow: +(180 - deg(h.joint(`upperarm01.${T}`).sub(h.joint(`lowerarm01.${T}`)), h.joint(`wrist.${T}`).sub(h.joint(`lowerarm01.${T}`)))).toFixed(0),
    clearMm: +(clearSeg(h.joint(`lowerarm01.${T}`), h.joint(`wrist.${T}`), 0.036) * 1000).toFixed(1), offBmm: +(avoidB(h.joint(`lowerarm01.${T}`), h.joint(`wrist.${T}`)) * 1000).toFixed(1), foldY: +(yF / (h.o?.height || 1.7)).toFixed(3) };
  return rep;
}
// hands loosely clasped: in front (the lower hand's palm toward the body, the other hand over its back holding it) or behind (at the
// sacrum: the lower hand's palm out, the other round its wrist). In front the hands' height is searched so the elbows bend ~38 deg
// (a long-armed person clasps lower than a short-armed one); behind they sit 7 cm over the hip joints.
const wristAngle = (h, sd) => 2 * Math.acos(Math.min(1, Math.abs(h.bone(`wrist.${sd}`).quaternion.w))) / D;
const elbowOf = (h, sd) => 180 - deg(h.joint(`upperarm01.${sd}`).sub(h.joint(`lowerarm01.${sd}`)), h.joint(`wrist.${sd}`).sub(h.joint(`lowerarm01.${sd}`)));
function claspHands(h, S, F, trunk, hip, back) {
  const s = (h.o?.height || 1.7) / 1.7, T = S.armSide || 'R', B = T === 'L' ? 'R' : 'L', sgT = T === 'L' ? 1 : -1, sgB = -sgT, mid = hip.L.clone().add(hip.R).multiplyScalar(0.5);
  const dir = back ? F.fwd.clone().negate() : F.fwd.clone();
  for (const sd of [T, B]) for (const b of [`upperarm01.${sd}`, `upperarm02.${sd}`, `lowerarm01.${sd}`, `lowerarm02.${sd}`, `wrist.${sd}`]) h.bone(b)?.quaternion.identity();
  if (back) for (const sd of [T, B]) h.rotateWorld(`shoulder01.${sd}`, F.up, (sd === 'L' ? 1 : -1) * 6 * D);
  h.update();
  relaxedHand(h, B, { curl: 0.7 * (S.curl ?? 1), thumb: 0.6 }); relaxedHand(h, T, { curl: 0.85 * (S.curl ?? 1), thumb: 0.6 });
  const fB = F.lat.clone().multiplyScalar(sgT * 0.7).addScaledVector(F.up, -0.7), nB = F.fwd.clone().negate();   // in front: the palm to the body; behind: the palm out (both -fwd)
  const poleB = F.lat.clone().multiplyScalar(sgB * (back ? 0.45 : 1)).addScaledVector(F.fwd, back ? -1 : -0.6).addScaledVector(F.up, back ? 0 : -0.3);
  const poleT = F.lat.clone().multiplyScalar(sgT * (back ? 0.45 : 1)).addScaledVector(F.fwd, back ? -1 : -0.6).addScaledVector(F.up, back ? 0 : -0.3);
  const fT = F.lat.clone().multiplyScalar(sgB * 0.75).addScaledVector(F.up, back ? -0.2 : -0.65), nT = dir.clone().negate();
  const solve = dy => {
    const y = mid.y + dy * s, ex = extent(trunk, mid, dir, y - 0.04 * s, y + 0.04 * s, p => Math.abs(p.clone().sub(mid).dot(F.lat)) < 0.09 * s);
    const PcB = mid.clone().addScaledVector(dir, ex.d + (back ? 0.02 : 0.03) * s).addScaledVector(F.lat, sgB * 0.015 * s); PcB.y = y;
    const rB = handAt(h, B, PcB, fB, nB, poleB, { maxWrist: 55 });
    // the other hand over it: the palm on the back of B's hand (in front) or round B's wrist (behind)
    const PB = h.palm(B), anchor = back ? h.joint(`wrist.${B}`).lerp(PB.palm, 0.35) : PB.palm.clone();
    const rT = handAt(h, T, anchor.clone().addScaledVector(dir, 0.026 * s).addScaledVector(F.lat, sgB * 0.004 * s), fT, nT, poleT, { maxWrist: 55 });
    return { rB, rT, dy }; };
  let r = null;
  if (back) r = solve(0.07);
  else { let best = null; for (let dy = -0.03; dy <= 0.1001; dy += 0.02) { const q = solve(dy), e = (elbowOf(h, B) + elbowOf(h, T)) / 2; if (!best || Math.abs(e - 38) < Math.abs(best.e - 38)) best = { dy, e }; } r = solve(best.dy); }
  const one = (sd, rr, k) => ({ kind: (back ? 'claspBack-' : 'clasp-') + k, missMm: +(rr.miss * 1000).toFixed(1), wristDeg: +wristAngle(h, sd).toFixed(0), elbow: +elbowOf(h, sd).toFixed(0), handsOverHipMm: +(r.dy * s * 1000).toFixed(0) });
  return { [B]: one(B, r.rB, 'under'), [T]: one(T, r.rT, 'over') };
}

// a pose as data (local quaternions and the root's position): for the cloth carry (CLOTH3: bind -> stance in steps) and for the bake
export function poseSnapshot(h) { return { q: h.bones.map(B => B.quaternion.toArray()), root: h.bone('root').position.toArray() }; }
// blend from pose A (null = the bind) to pose B by t (slerp per bone, the root's position lerped); A, B from poseSnapshot
export function blendPose(h, A, B, t) {
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), r0 = A ? V3(...A.root) : h.bindPos[h.bones.indexOf(h.bone('root'))].clone();
  h.bones.forEach((Bn, i) => { if (A) qa.fromArray(A.q[i]); else qa.identity(); qb.fromArray(B.q[i]); Bn.quaternion.copy(qa).slerp(qb, t); });
  h.bone('root').position.copy(r0.lerp(V3(...B.root), t)); h.update(); return h;
}
export { frame as stanceFrame, worldQ, setWorldQ, mulberry, hashStr, twoBoneKin, hingeOf, carrying, twoBoneHero };
