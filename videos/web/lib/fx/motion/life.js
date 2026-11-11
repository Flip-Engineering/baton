// MOTION c1 / LIFE (HUMAN c8 round 5, 3 Oct): a standing person who is alive. NEW FILE, opt-in (only the MOTION labs and bake tools
// import it). Works on any hero posed by POSE's stance (motion/stance.js standPerson; the v3 / v4 person's stance from its bake header).
//
// What a still person does (and what this layer draws, each seeded per person so a row never moves in unison):
//   BREATH   12-18 a minute at rest (an older or heavier body a little faster: lane F's Idle rule), irregular (rate and depth drift); the
//            belly and the lower chest swell (bone scale about the spine, ~2-3 % forward), the chest lifts, the shoulders rise ~0.5 deg
//   WEIGHT   every 6-20 s the weight moves between the feet over 1-2 s (Duarte and Zatsiorsky's SHIFT events, as lane F's Idle): the pelvis
//            travels toward the other foot and its roll reverses (POSE's contrapposto turned over: the stance and its counterpart over the
//            SAME planted feet), the knee of the unloaded leg softens; the feet never move (each leg re-solved by IK onto its planted ankle
//            and foot orientation, the person's own knee range); plus the ~0.2 Hz sway of a few mm and slow drift
//   LOOK     glances every 2-12 s: the eyes go first (~60 ms), the head follows (neck 45 % / head 55 %, POSE's split), a hold, return
//   BLINK    15-20 a minute (mean interval ~3.5 s, log-normal-ish, the odd double blink), 100 ms down, 150-200 ms up: the upper lid bone
//            (orbicularis03) turned down over the globe, the lower lid (orbicularis04) up a little; calibrated per person (lidRig) so the
//            margins meet
//   HANDS    a hanging hand settles every 8-25 s (the fingers curl or open a few degrees over ~0.8 s); a pocket / folded / clasped hand stays
//   FACE     the resting expression drifts within neutral-to-pleasant only (the corner puller 0-0.12: a hint of a smile coming and going);
//            nothing that pulls the corners down or the brows together is ever used
// Pure functions of (t, seed): seekable, no state, so a clip can be baked or played from any frame.
//
//   const L = new Life(h, { seed, kin, rec (the stance record), person });   L.capture();   // the posed stance is the base
//   per frame: L.apply(t) -> channels { eyeYaw, eyePitch, smile, blink, breath, weight }  (the hero posed for t; eyes and morphs are channels)
//   helpers for acts: breathe(h, b, o), blinkLids(h, rig, a), lookHead(h, yaw, pitch), lidRig(h)
import * as THREE from 'three';
import { kinOf, twoBoneKin, hingeOf } from '../rig/person_kin.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smoother = x => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };
const lerp = (a, b, t) => a + (b - a) * t;
// hashing and noise (self-contained; the same family as poser.js)
export function hash(a, b = 0) { let h = Math.imul(a | 0, 0x9E3779B1) ^ Math.imul(b | 0, 0x85EBCA77); h = Math.imul(h ^ h >>> 15, 0x2C1B3C6D); h = Math.imul(h ^ h >>> 12, 0x297A2D39); return ((h ^ h >>> 15) >>> 0) / 4294967296; }
export function noise1(x, s = 0) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f), g = k => hash(i + k, s * 7919 + 13) * 2 - 1; return lerp(g(0) * f, g(1) * (f - 1), u) * 2; }
export function fbm(x, s = 0) { return 0.6 * noise1(x, s) + 0.3 * noise1(x * 2.1, s + 1) + 0.1 * noise1(x * 4.3, s + 2); }
export function seedOf(name) { let h = 2166136261; for (const c of String(name)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

// events of one kind: [{ t, i, ...}] with intervals drawn log-uniform in [lo, hi] (a pure function of the seed: extended lazily)
class Events {
  constructor(seed, salt, lo, hi, mk, t0 = null) { this.s = seed; this.salt = salt; this.lo = lo; this.hi = hi; this.mk = mk; this.L = []; this.t0 = t0 ?? -hash(seed, salt) * hi; }
  upTo(t) { const L = this.L; let last = L.length ? L[L.length - 1].t : this.t0;
    while (last <= t + this.hi) { const i = L.length, u = hash(this.s * 131 + i, this.salt); last += this.lo * Math.pow(this.hi / this.lo, u); L.push({ t: last, i, ...this.mk(i, k => hash(this.s * 977 + i * 13 + k, this.salt)) }); }
    return L; }
  at(t) { let a = null; for (const e of this.upTo(t)) { if (e.t > t) break; a = e; } return a; }
}

// ---------------------------------------------------------------- the lids (calibrated per person on the posed head)
// the axis: the head's lateral axis in the lid bone's parent frame; the sign and the closing angle: searched so the upper lid's lowest
// margin point (body vertices weighted > 0.5 to orbicularis03, in front of the globe) comes down to the lower lid's highest one
export function lidRig(h, { skin = null } = {}) {
  const r = { L: null, R: null };
  for (const s of ['L', 'R']) { const up = h.bone(`orbicularis03.${s}`), lo = h.bone(`orbicularis04.${s}`); if (!up || !lo) continue; r[s] = { up, lo, close: 0.3, sign: 1, lower: 0.1 }; }
  if (skin) calibrateLids(h, r, skin);
  return r;
}
// skin(mesh) -> posed world positions of the body (cloth_motion.js skinMesh); the search is on the current pose
export function calibrateLids(h, r, skin) {
  // in the BIND pose (the lid bones live under the head: what is found holds for every pose), then the pose is put back
  const snap = { q: h.bones.map(B => B.quaternion.clone()), p: h.bones.map(B => B.position.clone()), s: h.bones.map(B => B.scale.clone()) };
  h.resetPose(); for (const B of h.bones) B.scale.set(1, 1, 1); h.update();
  const g = h.body.geometry, SI = g.attributes.skinIndex.array, SW = g.attributes.skinWeight.array, n = SI.length / 4, X0 = g.attributes.position.array;
  for (const s of ['L', 'R']) { const R = r[s]; if (!R) continue; const iu = h.idx[`orbicularis03.${s}`], il = h.idx[`orbicularis04.${s}`], e = s === 'L' ? h.eyeL : h.eyeR, U = [], Lw = [];
    // the lid surfaces over the globe: weighted to the lid bone, within 5 mm of the eye's vertical plane, 2-15 mm in front of its centre
    const inPlane = v => Math.abs(X0[v * 3] - e.x) < 0.005 && X0[v * 3 + 2] - e.z > 0.002 && X0[v * 3 + 2] - e.z < 0.015;
    for (let v = 0; v < n; v++) for (let k = 0; k < 4; k++) { if (SW[v * 4 + k] < 0.45 || !inPlane(v)) continue; if (SI[v * 4 + k] === iu) U.push(v); else if (SI[v * 4 + k] === il) Lw.push(v); }
    if (!U.length || !Lw.length) continue;
    const test = (ang, low = 0) => { R.up.quaternion.identity(); R.lo.quaternion.identity(); setLid(h, R, 1, low, ang); const X = skin(h.body);
      let uy = Infinity, ly = -Infinity; for (const v of U) uy = Math.min(uy, X[v * 3 + 1]); for (const v of Lw) ly = Math.max(ly, X[v * 3 + 1]);
      R.up.quaternion.identity(); R.lo.quaternion.identity(); h.update(); return { uy, ly }; };
    R.sign = 1; R.lsign = 1; const ap = test(0.15), an = test(-0.15); R.sign = ap.uy < an.uy ? 1 : -1;
    const lp = test(0, 0.12), ln = test(0, -0.12); R.lsign = lp.ly > ln.ly ? 1 : -1;
    const a0 = test(0); R.open0Mm = (a0.uy - a0.ly) * 1000;
    let best = 0.3, bd = Infinity; for (let a = 0.08; a <= 0.9; a += 0.02) { const m = test(a, R.lower); const d = Math.abs(m.uy - m.ly + 0.0004); if (d < bd) { bd = d; best = a; } }
    R.close = +best.toFixed(3); R.closeMissMm = +(bd * 1000).toFixed(2); R.n = [U.length, Lw.length]; }
  h.bones.forEach((B, i) => { B.quaternion.copy(snap.q[i]); B.position.copy(snap.p[i]); B.scale.copy(snap.s[i]); }); h.update();
  return r;
}
// a: 0 open .. 1 closed (the upper lid by a x close, the lower lid by a x lower)
export function setLid(h, R, a, low = null, close = null) { if (!R) return; const ax = V3(1, 0, 0);
  R.up.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(ax, (R.sign ?? 1) * a * (close ?? R.close ?? 0.3)));
  const l = low != null ? low : a * (R.lower ?? 0.12); if (l) R.lo.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(ax, (R.lsign ?? 1) * l)); h.update(); }
export function blinkLids(h, rig, a) { if (a <= 0) return; setLid(h, rig.L, a); setLid(h, rig.R, a); }

// ---------------------------------------------------------------- breath (bone scale about the spine; children counter-scaled)
// b in -1..1 (exhale .. inhale); o: { belly (fraction), chest, lift (rad) }
export function breathe(h, b, { belly = 0.026, chest = 0.013, lift = 0.008 } = {}) {
  const s3 = 1 + belly * 0.5 * (b + 1), s2 = 1 + chest * 0.5 * (b + 1), S3 = h.bone('spine03'), S2 = h.bone('spine02'), S1 = h.bone('spine01');
  S3.scale.set(1 + (s3 - 1) * 0.5, 1, s3); S2.scale.set((1 + (s2 - 1) * 0.6) / S3.scale.x, 1, s2 / S3.scale.z);
  const k2x = S3.scale.x * S2.scale.x, k2z = S3.scale.z * S2.scale.z; S1.scale.set(1 / k2x, 1, 1 / k2z);
  for (const n of ['breast.L', 'breast.R']) { const B = h.bone(n); if (B) B.scale.set(1 / k2x, 1, 1 / k2z); }
  // the chest lifts (spine extension) and the shoulders rise a little on the inhale
  const lat = V3(1, 0, 0); S2.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(lat, -0.006 * b));
  for (const s of ['L', 'R']) { const C = h.bone(`clavicle.${s}`); if (C) C.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(V3(0, 0, 1), (s === 'L' ? 1 : -1) * lift * 0.5 * (b + 1))); }
  h.update();
}
export function resetScales(h) { for (const B of h.bones) if (B.scale.x !== 1 || B.scale.y !== 1 || B.scale.z !== 1) B.scale.set(1, 1, 1); }

// ---------------------------------------------------------------- the head turns (world axes, POSE's split), the eyes are channels
function rotW(h, name, axis, ang) { if (!ang) return; h.rotateWorld(name, axis, ang); }
export function lookHead(h, yaw, pitch) { h.update(); const q = new THREE.Quaternion(); h.group.getWorldQuaternion(q); const up = V3(0, 1, 0), lat = V3(1, 0, 0).applyQuaternion(q);
  for (const [n, k] of [['neck01', 0.45], ['head', 0.55]]) { rotW(h, n, up, yaw * k); rotW(h, n, lat, pitch * k); } h.update(); }

// ---------------------------------------------------------------- the hand settle (finger flex about each joint's own axis)
const FING = ['finger2', 'finger3', 'finger4', 'finger5'];
export function settleHand(h, side, amt) { if (!amt || !h._flexAxis) return;
  for (const f of FING) for (const [j, k] of [[1, 0.6], [2, 1], [3, 0.5]]) { const n = `${f}-${j}`, B = h.bone(`${n}.${side}`); if (!B) continue; B.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(h._flexAxis(side, n), amt * k)); }
  const T = h.bone(`finger1-2.${side}`); if (T) T.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(h._flexAxis(side, 'finger1-2'), amt * 0.4)); }

// ---------------------------------------------------------------- one glance (the eyes jump ahead in 0.1 s and lead; the head follows 60 ms behind, 0.28 s in, holds `d`, 0.45 s out; as the head arrives the eyes come back toward centre)
const GLANCE = { eyeIn: 0.1, eyeOut: 0.25, lag: 0.06, tin: 0.28, tout: 0.45 };
const glanceSpan = e => GLANCE.lag + GLANCE.tin + e.d + GLANCE.tout;
function glanceAt(g, t) { const a = t - g.t, G = GLANCE, tin = G.tin, tout = G.tout;
  const wE = a < G.eyeIn ? smoother(a / G.eyeIn) : a < G.eyeIn + tin + g.d ? 1 : 1 - smoother((a - G.eyeIn - tin - g.d) / G.eyeOut), aH = a - G.lag, wH = aH < 0 ? 0 : aH < tin ? smoother(aH / tin) : aH < tin + g.d ? 1 : 1 - smoother((aH - tin - g.d) / tout);
  const e = Math.max(0, wE), hd = Math.max(0, wH);
  return { eyeYaw: g.yaw * (e - 0.7 * hd), eyePitch: g.pitch * (e - 0.6 * hd), yaw: g.yaw * 0.85 * hd, pitch: g.pitch * 0.6 * hd }; }

// ---------------------------------------------------------------- the seeded life of one person
export class Life {
  // h: the hero posed in its stance; rec: the stance record (POSE: { legs, side, arms, ... }); kin: true (the hero's meta.kin) or a kin
  constructor(h, { seed = 1, rec = null, person = null, kin = true, age = null, restless = 0.5, look = 1, smile0 = null, skin = null } = {}) {
    this.h = h; this.rec = rec || {}; this.seed = seed >>> 0 || 1; this.K = kin ? kinOf(h, { kin: kin === true ? null : kin, person }) : null;
    const r = k => hash(this.seed, 300 + k), age0 = age ?? this.K?.age ?? 35, bmi = this.K ? this.K.mass / (this.K.stature * this.K.stature) : 24;
    const old = clamp((age0 - 30) / 50), heavy = clamp((bmi - 25) / 15);
    this.breathF = (12 + 6 * r(1)) / 60 * (1 + 0.1 * old + 0.1 * heavy); this.breathA = 0.8 + 0.4 * r(2);
    this.swayF = 0.14 + 0.14 * r(3); this.swayA = (0.003 + 0.003 * r(4)) * (1 + 0.8 * old) * (1 + 0.4 * heavy);
    this.blinkMean = 2.8 + 1.4 * r(5); this.lookBias = (r(6) - 0.5) * 0.12; this.look = look; this.restless = restless;   // blinks: 15-20 a minute at rest (a 6 s clip shows one to three)
    this.smile0 = smile0 ?? 0.02 + 0.05 * r(7);
    // arms that rest on the body (pocket, hip, folded, clasp) take smaller pelvis moves (the hands are placed on the posed body)
    this.shiftK = ['pocket', 'hip', 'clasp', 'claspBack'].includes(this.rec.arms) ? 0.45 : this.rec.arms === 'folded' ? 0.7 : 1;
    const R = this.restless;
    // (the first event is a shift onto the other foot, the next one back, ...; the first lands 0-12 s in, so in a 6 s clip about half a row moves its weight)
    this.ev = { shift: new Events(this.seed, 11, 6 / (0.5 + R), 20 / (0.5 + R), (i, q) => ({ w: i % 2 ? 0.05 * q(2) : 0.55 + 0.4 * q(1), d: 1.0 + 1.0 * q(3) }), -6 - 6 * r(8)),
      glance: new Events(this.seed, 37, 2, 12, (i, q) => ({ yaw: (q(1) - 0.5) * 2 * (0.12 + 0.3 * q(2)) * this.look, pitch: (q(3) - 0.55) * 0.18, d: 0.6 + 2.2 * q(4) })),
      blink: new Events(this.seed, 53, this.blinkMean * 0.45, this.blinkMean * 1.7, (i, q) => ({ dbl: q(1) < 0.08, d: 0.24 + 0.08 * q(2) }), -this.blinkMean * (0.2 + 0.6 * r(9))),
      hand: new Events(this.seed, 71, 8, 25, (i, q) => ({ L: (q(1) - 0.5) * 0.16, R: (q(2) - 0.5) * 0.16, d: 0.6 + 0.5 * q(3) })),
      smile: new Events(this.seed, 89, 5, 18, (i, q) => ({ s: q(1) < 0.35 ? 0.04 + 0.08 * q(2) : 0, d: 1.2 + 1.5 * q(3) })) };
    this.forced = [];
    this.rig = lidRig(h, { skin });
  }
  // an act CALLS a glance at time t (a person who has finished greeting looks away from the viewer): the same event as the drawn ones (the eyes jump first, the head follows 60 ms behind, a hold, the
  // return), its direction, size and length drawn from THIS person's own seed with the glance statistics (`look` scales the size as it does for the drawn ones; `salt` tells two calls apart). The act
  // chooses WHEN, the person chooses where and how far. Pure in (t, seed): the same call gives the same glance
  force(t, { look = 1, salt = 0 } = {}) { const q = k => hash(this.seed * 977 + 31337 + salt * 13 + k, 53), e = { t, forced: true, yaw: (q(1) - 0.5) * 2 * (0.12 + 0.3 * q(2)) * look, pitch: (q(3) - 0.55) * 0.18, d: 0.6 + 2.2 * q(4) };
    this.forced.push(e); this.forced.sort((a, b) => a.t - b.t); return e; }
  // the stance as the base: bone rotations, root, the planted feet (world) and the knee poles; call once, the hero posed in its stance
  capture() { const h = this.h; h.update();
    this.base = { q: h.bones.map(B => B.quaternion.clone()), root: h.bone('root').position.clone() };
    this.feet = {}; for (const s of ['L', 'R']) { const A = h.joint(`upperleg01.${s}`), K = h.joint(`lowerleg01.${s}`), F = h.joint(`foot.${s}`), q = new THREE.Quaternion(); h.bone(`foot.${s}`).getWorldQuaternion(q);
      const mid = A.clone().add(F).multiplyScalar(0.5); this.feet[s] = { p: F, q, pole: K.clone().sub(mid).normalize(), hip: A }; }
    const st = this.rec.side === 'R' ? 'R' : 'L', fr = st === 'L' ? 'R' : 'L'; this.stand = st; this.free = fr;
    // the travel of a full shift: from over the standing ankle toward the free one (horizontal), as a world vector
    this.travel = this.feet[fr].p.clone().sub(this.feet[st].p); this.travel.y = 0;
    this.drop0 = (this.rec.drop ?? 3) * Math.PI / 180; this.hinge = hingeOf(this.K, 'knee');
    return this; }
  // the channels at t (no posing)
  sample(t) {
    const E = this.ev;
    let weight = 0; { const S = E.shift, e = S.at(t); if (e) { const prev = e.i > 0 ? S.L[e.i - 1].w : 0; weight = lerp(prev, e.w, smoother((t - e.t) / e.d)); } }
    const sx = this.swayA * noise1(t * this.swayF * 2, this.seed + 1) + 0.004 * fbm(t * 0.05, this.seed + 2), sz = this.swayA * 1.3 * noise1(t * this.swayF * 2.3, this.seed + 3) + 0.005 * fbm(t * 0.04, this.seed + 4);
    const ph = 2 * Math.PI * (t * this.breathF + 0.5 * fbm(t * 0.07, this.seed + 5)), breath = Math.sin(ph) * this.breathA * (0.85 + 0.15 * noise1(t * 0.1, this.seed + 6));
    let yaw = this.lookBias, pitch = 0, eyeYaw = 0, eyePitch = 0;
    // GLANCES: the drawn events and the ones an act called (force). A called glance holds for its whole extent: a drawn glance that would START inside it is not made (the person is busy looking), and a glance that a
    // later one interrupts is not cut but let go (its share falls over 0.35 s while the new one rises), so the head never jumps between two glances (c5 it3: the latest event used to win outright, a drawn glance
    // cut a called one short and the head jumped from one hold to the next)
    const ev = []; for (const e of E.glance.upTo(t)) { if (e.t > t) break; if (!this.forced.some(f => e.t >= f.t && e.t < f.t + glanceSpan(f))) ev.push(e); }
    for (const f of this.forced) if (f.t <= t) ev.push(f);
    ev.sort((a, b) => a.t - b.t); const g = ev.length ? ev[ev.length - 1] : null, gp = ev.length > 1 ? ev[ev.length - 2] : null;
    if (g) { const A = glanceAt(g, t), B = gp ? glanceAt(gp, t) : null, r = gp ? 1 - smoother((t - g.t) / 0.35) : 0;
      eyeYaw = A.eyeYaw + (B ? r * B.eyeYaw : 0); eyePitch = A.eyePitch + (B ? r * B.eyePitch : 0); yaw += A.yaw + (B ? r * B.yaw : 0); pitch += A.pitch + (B ? r * B.pitch : 0); }
    eyeYaw += 0.02 * noise1(t * 0.9, this.seed + 8); eyePitch += 0.015 * noise1(t * 0.8, this.seed + 9);   // fixational drift (small)
    let blink = 0; const b = E.blink.at(t);
    if (b) { const blinkAt = a => a < 0 ? 0 : a < 0.09 ? smoother(a / 0.09) : a < 0.11 ? 1 : a < b.d ? 1 - smoother((a - 0.11) / (b.d - 0.11)) : 0; blink = Math.max(blinkAt(t - b.t), b.dbl ? blinkAt(t - b.t - b.d - 0.05) : 0); }
    let hL = 0, hR = 0; const hd = E.hand.at(t); if (hd) { const prev = hd.i > 0 ? E.hand.L[hd.i - 1] : { L: 0, R: 0 }, u = smoother((t - hd.t) / hd.d); hL = lerp(prev.L, hd.L, u); hR = lerp(prev.R, hd.R, u); }
    let smile = this.smile0; const sm = E.smile.at(t); if (sm) { const prev = sm.i > 0 ? E.smile.L[sm.i - 1].s : 0; smile += lerp(prev, sm.s, smoother((t - sm.t) / sm.d)); }
    return { weight, sway: [sx, sz], breath, yaw, pitch, eyeYaw, eyePitch, blink, hands: [hL, hR], smile: clamp(smile, 0, 0.14) };
  }
  // pose the hero at t: the stance, the weight shift and sway over the planted feet, breath, the head, the lids, the hands
  apply(t, { channels = null } = {}) {
    const h = this.h, c = channels || this.sample(t), B = this.base; resetScales(h);
    h.bones.forEach((Bn, i) => Bn.quaternion.copy(B.q[i])); const R = h.bone('root'); R.position.copy(B.root); h.update();
    // the pelvis: toward the free foot by weight x shiftK of the travel, the roll turned over (standing side up -> the other side up), a dip
    const w = c.weight * this.shiftK, sgn = this.stand === 'L' ? 1 : -1, q = new THREE.Quaternion(); h.group.getWorldQuaternion(q);
    const fwd = V3(0, 0, 1).applyQuaternion(q), up = V3(0, 1, 0);
    const hipC = () => h.joint('upperleg01.L').add(h.joint('upperleg01.R')).multiplyScalar(0.5);
    const moveRoot = dW => { const P = R.parent, a = P.worldToLocal(R.getWorldPosition(V3()).add(dW)); R.position.copy(a); h.update(); };
    const roll = -sgn * this.drop0 * 1.6 * w;   // + about fwd raises the left hip
    if (roll) { const c0 = hipC(); h.rotateWorld('root', fwd, roll); h.update(); moveRoot(c0.sub(hipC())); }
    // the trunk counter-tilts over the pelvis (the shoulders follow POSE's counter-tilt the other way), the neck takes most of it back
    if (roll) { h.rotateWorld('spine04', fwd, -roll * 1.35); h.rotateWorld('neck01', fwd, roll * 0.3); h.update(); }
    const shift = this.travel.clone().multiplyScalar(0.62 * w).add(V3(c.sway[0], 0, c.sway[1]).applyQuaternion(q));
    moveRoot(shift);
    // the legs: each ankle back on its planted point and the foot on its planted orientation; the pelvis comes down if a leg cannot reach
    for (let it = 0; it < 2; it++) { let dy = 0; for (const s of ['L', 'R']) { const A = h.joint(`upperleg01.${s}`), F = this.feet[s].p, L1 = A.distanceTo(h.joint(`lowerleg01.${s}`)), L2 = h.joint(`lowerleg01.${s}`).distanceTo(h.joint(`foot.${s}`));
        const ext = this.hinge.ext || 0, Lmax = Math.sqrt(L1 * L1 + L2 * L2 + 2 * L1 * L2 * Math.cos(-ext * Math.PI / 180)) * 0.9995, dh = Math.hypot(A.x - F.x, A.z - F.z), vmax = Math.sqrt(Math.max(0, Lmax * Lmax - dh * dh));
        dy = Math.min(dy, F.y + vmax - A.y); }
      if (dy < -1e-5) moveRoot(V3(0, dy, 0)); else break; }
    for (const s of ['L', 'R']) { const f = this.feet[s]; twoBoneKin(h, `upperleg01.${s}`, `lowerleg01.${s}`, `foot.${s}`, f.p, f.pole, { ...this.hinge, lock: s === (w > 0.5 ? this.free : this.stand) ? 0.6 : 0 });
      const Fb = h.bone(`foot.${s}`), pq = new THREE.Quaternion(); Fb.parent.getWorldQuaternion(pq); Fb.quaternion.copy(pq.invert().multiply(f.q)); h.update(); }
    breathe(h, c.breath);
    lookHead(h, c.yaw, c.pitch);
    if (this.rec.arms === 'hang' || !this.rec.arms) { settleHand(h, 'L', c.hands[0]); settleHand(h, 'R', c.hands[1]); }
    blinkLids(h, this.rig, c.blink);
    h.update(); return c;
  }
}
