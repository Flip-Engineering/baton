// RIG c1 / HAND: hands that hold things. A data-defined hand solver on hero.js's 163-bone body (three joints per finger, a
// mobile thumb, metacarpals), measured on the SKIN (the skinned vertices), not on capsules.
//
//   const hand = new HandRig(hero, 'R');
//   const G = hand.plan({ grip: 'power', obj: cylinder(a, b, 0.02), at: centrePoint, approach: dirFromObjectToPalm, wrap: +1 });
//   hand.pose(G, 1);                 // u: 0 = open preshape ... 1 = closed on the object, wrist placed by arm IK
//   const rep = hand.measure(G.obj); // the solver's own readout per finger { gapMm, penMm, contact }, for debugging a solve
//
// What is here that people.js / hero.js did not have:
//   * grips are DATA (GRIPS below: Feix taxonomy families with a preshape, a wrap sign, a thumb strategy, a stagger) and objects
//     are SDFs (sdf.js: cylinder, torus, box, sphere): fingers close on the shape, they are not aimed at a point;
//   * coupled curl (DIP follows PIP while both are free; the tip keeps curling once PIP is blocked), closing until the skin
//     touches, never through it, thumb chosen by a search over its four DOF against the object AND the fingers;
//   * the wrist is placed from the grip (palm skin on the surface, palm normal against the surface normal), the arm follows by
//     two-bone IK and the forearm takes the pronation, so the object leads and the hand meets it;
//   * a closure timeline (fingers close in a stagger, the thumb last) with events: palm contact, each finger's touch;
//   * the solver's readout per finger in mm: gap (skin to surface), penetration (deepest vertex: skin through the object is a
//     bug), contact yes/no, and the wrist load. These steer and debug the solve; whether a grip looks right is judged by watching
//     the clip at feed size.
import * as THREE from 'three';
import { twoBone } from './ik.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), Qt = () => new THREE.Quaternion();
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
export const FINGERS = ['index', 'middle', 'ring', 'pinky'];
const FN = { thumb: 1, index: 2, middle: 3, ring: 4, pinky: 5 };
const LIM = { mcp: 1.62, pip: 1.85, dip: 1.25 };     // rad, from the AAOS ranges hero.js already uses
const RATE = [1, 1.15, 0.85];                        // MCP, PIP, DIP close in proportion until one is blocked

// ---------------------------------------------------------------- grips as data (Feix et al. 2016 families)
//   pre: the open preshape [mcp, pip, dip] per finger, spread (rad, abduction about the palm normal), thumb: [al, be, c2, c3]
//   stagger: the delay of each finger's close (0..1 of the closure time); thumb: how it is found ('oppose' | 'over' | 'along' | 'none')
//   tilt: the angle between the knuckle line and the object's axis (a power grip lies diagonally across the palm)
export const GRIPS = {
  power:   { taxonomy: 'Feix 1, large diameter (power, cylinder)', tilt: 0.42, press: 0.003, thumb: 'oppose',
    pre: { index: [0.22, 0.3, 0.12], middle: [0.2, 0.3, 0.12], ring: [0.2, 0.3, 0.12], pinky: [0.2, 0.28, 0.1] }, spread: { index: -0.06, ring: 0.04, pinky: 0.1 }, thumbPre: [-0.5, -0.4, 0.05, 0.05],
    stagger: { middle: 0, ring: 0.08, index: 0.14, pinky: 0.18, thumb: 0.3 } },
  wheel:   { taxonomy: 'Feix 1 on a torus (power, ring rim); thumb wraps the inner face', tilt: 0.3, press: 0.002, thumb: 'oppose',
    pre: { index: [0.25, 0.35, 0.15], middle: [0.22, 0.32, 0.15], ring: [0.22, 0.32, 0.15], pinky: [0.22, 0.3, 0.12] }, spread: { index: -0.04, ring: 0.03, pinky: 0.08 }, thumbPre: [-0.5, -0.4, 0.05, 0.05],
    stagger: { index: 0, middle: 0.06, ring: 0.12, pinky: 0.18, thumb: 0.24 } },
  hammer:  { taxonomy: 'Feix 1/2 (power with the thumb along the shaft)', tilt: 0.5, press: 0.003, thumb: 'along',
    pre: { index: [0.2, 0.3, 0.1], middle: [0.2, 0.3, 0.1], ring: [0.2, 0.3, 0.1], pinky: [0.2, 0.28, 0.1] }, spread: { pinky: 0.08 }, thumbPre: [-0.5, -0.4, 0.05, 0.05],
    stagger: { middle: 0, ring: 0.06, index: 0.12, pinky: 0.16, thumb: 0.26 } },
  pinch:   { taxonomy: 'Feix 16 tip / 18 lateral pinch (precision)', tilt: 0.1, press: 0.0, thumb: 'oppose', only: ['index', 'thumb'], relax: 0.9,
    pre: { index: [0.2, 0.3, 0.15], middle: [0.3, 0.5, 0.3], ring: [0.4, 0.6, 0.4], pinky: [0.5, 0.7, 0.5] }, spread: {}, thumbPre: [-0.4, -0.3, 0.05, 0.05], stagger: { index: 0, thumb: 0.05 } },
  fist:    { taxonomy: 'Bridgman fist (thumb clamped over the middle phalanges)', thumb: 'over', fist: true },
  point:   { taxonomy: 'index extension', thumb: 'over', point: true, fist: true },
};

// ---------------------------------------------------------------- the hand
export class HandRig {
  constructor(hero, side, { skin = 0 } = {}) {
    this.h = hero; this.side = side; this.sg = side === 'L' ? 1 : -1; this.skinT = skin;   // skin: glove thickness added to the SDF
    const I = hero.idx, REG = hero.aHero, pos = hero.body.geometry.attributes.position.array, SI = hero.body.geometry.attributes.skinIndex.array, SW = hero.body.geometry.attributes.skinWeight.array;
    this.set = { palm: [] }; for (const f of Object.keys(FN)) this.set[f] = [[], [], []];
    const owner = {}; for (const [f, n] of Object.entries(FN)) for (let k = 1; k <= 3; k++) owner[I[`finger${n}-${k}.${side}`]] = [f, k - 1];
    const n = hero.meta.n;
    for (let v = 0; v < n; v++) {
      const r = REG[v * 4]; if ((r !== 5 && r !== 6) || Math.sign(pos[v * 3]) !== this.sg) continue;
      let bi = SI[v * 4], bw = SW[v * 4]; for (let q = 1; q < 4; q++) if (SW[v * 4 + q] > bw) { bw = SW[v * 4 + q]; bi = SI[v * 4 + q]; }
      const o = owner[bi]; if (o) this.set[o[0]][o[1]].push(v); else this.set.palm.push(v);
    }
    this.names = f => [1, 2, 3].map(k => `finger${FN[f]}-${k}.${side}`);
    this.bones = {}; for (const f of Object.keys(FN)) this.bones[f] = this.names(f).map(nm => hero.bone(nm));
    this.meta = { ring: hero.bone(`metacarpal3.${side}`), pinky: hero.bone(`metacarpal4.${side}`), middle: hero.bone(`metacarpal2.${side}`), index: hero.bone(`metacarpal1.${side}`) };
    this.H0 = hero._hand0(side);
    this.axes = {}; for (const f of Object.keys(FN)) this.axes[f] = [1, 2, 3].map(k => hero._flexAxis(side, `finger${FN[f]}-${k}`));
    this.rest = {}; for (const f of Object.keys(FN)) this.rest[f] = this.bones[f].map(b => b.quaternion.clone());
    this.ang = {}; this._tmp = V();
    // the palm's skin patch (where a handle bears): the vertices hero._hand0 averages, kept so the palm point can be read from the SKIN (bone scale changes the hand)
    { const H0 = this.H0, N = hero.nrm, w = H0.w, L = hero.head0[I[`finger3-1.${side}`]].distanceTo(w); this.palmV = [];
      for (const v of this.set.palm.concat(...this.set.index.slice(0, 0))) { const px = pos[v * 3], py = pos[v * 3 + 1], pz = pos[v * 3 + 2], t = ((px - w.x) * H0.f.x + (py - w.y) * H0.f.y + (pz - w.z) * H0.f.z) / L;
        if (t < 0.7 || t > 0.95) continue; if (N[v * 3] * H0.n.x + N[v * 3 + 1] * H0.n.y + N[v * 3 + 2] * H0.n.z < 0.6) continue; this.palmV.push(v); } }
    this.wristLimit = { flex: 1.4, ext: 1.2, dev: 0.5 };   // AAOS 80 / 70 / 30 deg, a little generous (rad)
  }
  // ------------------------------------------------ skin
  refresh() { this.h.group.updateMatrixWorld(true); this.h.skeleton.update(); }
  skinPt(v, out = this._tmp) { this.h.body.getVertexPosition(v, out); return out.applyMatrix4(this.h.body.matrixWorld); }
  minD(ids, sdf, p = V()) { let m = Infinity, arg = -1; const t = this.skinT; for (const v of ids) { this.skinPt(v, p); const d = sdf.d(p) - t; if (d < m) { m = d; arg = v; } } return { d: m, v: arg }; }
  palmWorld(out = V()) { out.set(0, 0, 0); const p = V(); for (const v of this.palmV) out.add(this.skinPt(v, p)); return this.palmV.length ? out.multiplyScalar(1 / this.palmV.length) : out; }
  // ------------------------------------------------ angles -> bones
  // angles: { index: [mcp, pip, dip], ..., spread: {index: rad, ...}, thumb: [al, be, c2, c3], meta: { ring, pinky } }
  apply(A) {
    const h = this.h, Hn = this.H0;
    for (const f of FINGERS) {
      const th = A[f] || [0, 0, 0], sp = A.spread?.[f] || 0, B = this.bones[f];
      B.forEach((b, k) => { b.quaternion.copy(this.rest[f][k]); if (k === 0 && sp) b.quaternion.multiply(Qt().setFromAxisAngle(Hn.n, sp * this.sg)); b.quaternion.multiply(Qt().setFromAxisAngle(this.axes[f][k], th[k])); });
    }
    for (const m of ['index', 'middle', 'ring', 'pinky']) { const b = this.meta[m]; if (!b) continue; b.quaternion.identity(); const a = A.meta?.[m] || 0; if (a) b.quaternion.setFromAxisAngle(this.axes[m][0], a); }
    { const T = A.thumb || [0, 0, 0, 0], B = this.bones.thumb;
      B[0].quaternion.copy(this.rest.thumb[0]).premultiply(Qt().setFromAxisAngle(Hn.f, T[0])).premultiply(Qt().setFromAxisAngle(Hn.a, T[1]));
      B[1].quaternion.copy(this.rest.thumb[1]).multiply(Qt().setFromAxisAngle(this.axes.thumb[1], T[2])); B[2].quaternion.copy(this.rest.thumb[2]).multiply(Qt().setFromAxisAngle(this.axes.thumb[2], T[3])); }
    this.ang = A; this.refresh();
  }
  // ------------------------------------------------ closing one finger on an SDF (coupled curl, blocked joints stop, distal ones continue)
  closeFinger(f, sdf, { pre = [0.2, 0.3, 0.1], spread = 0, meta = 0, step = 0.02, tol = 0.0004, kDip = 0.66 } = {}) {
    const S = this.set[f], A = { spread: { [f]: spread }, meta: { [f]: meta }, [f]: pre.slice() }, th = A[f], blocked = [false, false, false], lim = [LIM.mcp, LIM.pip, LIM.dip];
    const P = (k) => this.minD(S[k], sdf).d;
    const put = () => this.apply({ ...this.ang, ...A });
    put();
    // a preshape that already touches: open it until clear
    for (let i = 0; i < 40 && Math.min(P(0), P(1), P(2)) < -tol; i++) { for (let k = 0; k < 3; k++) th[k] = Math.max(0, th[k] - 0.05); put(); }
    for (let it = 0; it < 160; it++) {
      let moved = false; const old = th.slice();
      for (let k = 0; k < 3; k++) if (!blocked[k] && th[k] < lim[k]) { th[k] = Math.min(lim[k], th[k] + step * RATE[k]); moved = true; }
      if (!blocked[1] && !blocked[2]) th[2] = Math.min(lim[2], Math.max(th[2], kDip * th[1] * 1.0));   // coupled curl
      put();
      for (let k = 0; k < 3; k++) if (P(k) < -tol) { for (let q = k; q >= 0; q--) if (!blocked[q]) { th[q] = old[q]; blocked[q] = true; break; } put(); }
      if (!moved) break; if (blocked.every(Boolean)) break;
    }
    // resolve: whatever still penetrates (a coupled joint moved after its parent was blocked) is opened, distal joint first, then the whole finger
    for (let i = 0; i < 80 && Math.min(P(0), P(1), P(2)) < -tol; i++) { const k = P(2) < -tol ? 2 : P(1) < -tol ? 1 : 0; if (th[k] > 0.003) th[k] -= 0.006; else for (let q = 0; q < 3; q++) th[q] = Math.max(0, th[q] - 0.01); put(); }
    // refine: creep each joint (distal first) until the skin just touches
    for (const k of [2, 1, 0]) for (let it = 0; it < 30; it++) { if (th[k] >= lim[k]) break; th[k] += 0.004; put(); if (Math.min(P(0), P(1), P(2)) < -tol) { th[k] -= 0.004; put(); break; } }
    return th.slice();
  }
  // ------------------------------------------------ the thumb: a search over the four DOF
  //   'oppose': the pad meets the surface on the side opposite the fingers, near the index;  'along': the pad lies on the surface along the shaft
  //   cost = pad-to-surface + penetration (object, fingers) + a preference for where the pad should be
  fitThumb(sdf, strategy = 'oppose', fingersDone = FINGERS) {
    const S = this.set.thumb, pad = [...S[1], ...S[2]], tip = S[2], B = this.bones.thumb;
    const others = []; for (const f of fingersDone) for (const k of [0, 1, 2]) others.push(...this.set[f][k].filter((_, i) => i % 6 === 0));
    // sub-sampled skin: keeps the search fast
    const sub = a => a.filter((_, i) => i % 3 === 0), padS = sub(pad), tipS = sub(tip), allT = sub([...S[0], ...S[1], ...S[2]]);
    const p = V(), q = V();
    const centre = sdf.centre, index2 = this.h.joint(`finger2-2.${this.side}`);
    const cost = (T) => {
      this.apply({ ...this.ang, thumb: T });
      let pen = 0, gap = Infinity, penF = 0;
      for (const v of allT) { this.skinPt(v, p); pen = Math.max(pen, -(sdf.d(p) - this.skinT)); }
      // finger penetration: thumb skin against the nearest finger skin sample
      const fp = others.map(v => this.skinPt(v, V()));
      for (const v of allT) { this.skinPt(v, p); for (const o of fp) { const d = p.distanceTo(o); if (d < 0.009 * this.h.scale) penF = Math.max(penF, 0.009 * this.h.scale - d); } }
      let padPt = V(); for (const v of padS) { this.skinPt(v, p); padPt.add(p); } padPt.multiplyScalar(1 / padS.length);
      let dmin = Infinity; for (const v of padS) { this.skinPt(v, p); dmin = Math.min(dmin, sdf.d(p) - this.skinT); } gap = dmin;
      let c = Math.abs(gap) * 14 + pen * 90 + penF * 60;
      if (strategy === 'oppose') c += padPt.distanceTo(index2) * 1.2;                  // pad near the index's middle joint
      if (strategy === 'along') c += Math.max(0, 0.02 - Math.abs(gap)) * 0;
      return c;
    };
    let best = { c: Infinity, T: [0, 0, 0, 0] };
    for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) for (const c2 of [0.1, 0.4, 0.8]) { const T = [i * 0.13, j * 0.13, c2, c2 * 0.9]; const c = cost(T); if (c < best.c) best = { c, T }; }
    for (let it = 0; it < 5; it++) { const st = 0.07 / (it + 1); const b0 = best.T.slice();
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) for (let l = -1; l <= 1; l++) { const T = [b0[0] + i * st, b0[1] + j * st, Math.max(0, b0[2] + k * st), Math.max(0, b0[3] + l * st)]; const c = cost(T); if (c < best.c) best = { c, T }; } }
    this.apply({ ...this.ang, thumb: best.T });
    return best.T;
  }

  // ------------------------------------------------ the plan: where the wrist goes, what the fingers do
  // spec: { grip, obj (SDF), at (a point on the object's axis / tube centre, world), approach (unit, from the object toward the palm), wrap: +1 | -1, axis? (object axis at `at`),
  //         tilt?, press?, slide? (m along the axis), r? (the tube radius at `at`), fingers? (which close) }
  plan(spec) {
    const G = { ...GRIPS[spec.grip || 'power'], ...spec }; G.name = spec.grip || 'power'; G.side = this.side;
    const obj = G.obj, r = G.r ?? obj.r ?? 0.02, n = G.approach.clone().normalize().negate();   // n: out of the palm, i.e. toward the object
    const axis = (G.axis || obj.axis || V(0, 1, 0)).clone().normalize();
    // palm skin lands on the surface point under it, pressed by `press`
    G.palmPt = G.at.clone().addScaledVector(G.approach.clone().normalize(), r - (G.press ?? 0.003) + this.skinT).addScaledVector(axis, G.slide || 0);
    G.n = n; G.wrapSign = G.wrap ?? 1;
    // fingers point around the object: f = wrap * (axis x n), then the knuckle line a = f x n; the grip lies diagonally: rotate both about n by the tilt
    const H = this.H0, hand = Math.sign(V().crossVectors(H.a, H.f).dot(H.n)) || 1;
    let f = V().crossVectors(axis, n).multiplyScalar(G.wrapSign).normalize();
    if (G.fingerHint) { f.copy(G.fingerHint).addScaledVector(n, -G.fingerHint.dot(n)).normalize(); }
    let a = V().crossVectors(f, n).normalize(); if (hand < 0) a.negate();
    const tilt = (G.tilt ?? 0.4) * this.sg * G.wrapSign; a.applyAxisAngle(n, tilt); f.applyAxisAngle(n, tilt);
    G.a = a; G.f = f;
    G.R = this._frame(a, f, n);
    G.wristPt = G.palmPt.clone().sub(V().copy(H.palm).sub(H.w).multiplyScalar(this.h.scale).applyQuaternion(G.R)); G.approachU = G.approach.clone().normalize();
    G.pole = G.pole || V(0, -1, 0).addScaledVector(V(this.sg, 0, 0), 0.0);
    G.fit = null; G.state = null;
    return G;
  }
  // the rotation taking the bind palm frame to the wanted one; it uses the knuckle line a and the palm normal n only (the bind fingers fan out, a and f are not orthogonal)
  _frame(a, f, n) {
    const H = this.H0, orth = (a, n) => { const A = a.clone().addScaledVector(n, -a.dot(n)).normalize(); return [A, V().crossVectors(n, A)]; };
    const [a0, b0] = orth(H.a, H.n), [a1, b1] = orth(a, n);
    const M0 = new THREE.Matrix4().makeBasis(a0, b0, H.n), M1 = new THREE.Matrix4().makeBasis(a1, b1, n);
    return new THREE.Quaternion().setFromRotationMatrix(M1.multiply(M0.transpose()));
  }
  // ------------------------------------------------ the arm: the wrist to its place, the forearm takes the pronation
  place(G, wristPt = G.wristPt, R = G.R, { pole = G.pole, twist = 0.7, lean = true, palmTarget = null } = {}) {
    palmTarget = palmTarget || G.palmPt.clone().add(wristPt.clone().sub(G.wristPt));
    const h = this.h, s = this.side, UA = `upperarm01.${s}`, LA = `lowerarm01.${s}`, WR = `wrist.${s}`, L2 = `lowerarm02.${s}`;
    h.update();
    let S = h.joint(UA), E0 = h.joint(LA), W0 = h.joint(WR);
    const l1 = S.distanceTo(E0), l2 = E0.distanceTo(W0);
    // reach: if the wrist target is beyond the arm, lean the chest toward it (a body leans into a reach)
    if (lean) for (let it = 0; it < 6; it++) { const d = wristPt.distanceTo(S), maxR = (l1 + l2) * 0.985; if (d <= maxR) break;
      const F = h._body(), toT = wristPt.clone().sub(S), fw = F.fwd.clone(); const axL = F.xL.clone(); const ang = Math.min(0.06, (d - maxR) / 0.6);
      h.rotateWorld('spine04', axL, -ang * Math.sign(toT.dot(fw) || 1) * (Math.abs(toT.dot(fw)) > Math.abs(toT.y) ? 1 : 0)); h.rotateWorld('spine02', axL, -ang * 0.5 * Math.sign(toT.dot(fw) || 1) * (Math.abs(toT.dot(fw)) > Math.abs(toT.y) ? 1 : 0)); h.update(); S = h.joint(UA); }
    const sol = twoBone(S, l1, l2, wristPt, pole, { soft: 0.995 });
    h._aimWorld(UA, E0.clone().sub(S), sol.E.clone().sub(S)); h.update();
    { const E1 = h.joint(LA), W1 = h.joint(WR); h._aimWorld(LA, W1.clone().sub(E1), sol.W.clone().sub(E1)); h.update(); }
    // pronation: the twist of (forearm -> desired hand) about the forearm axis is shared by the forearm bones
    const Bl = h.bone(LA), pq = Qt(); Bl.getWorldQuaternion(pq);
    const rel = pq.clone().invert().multiply(R), ax = h.rig.dir[h.idx[LA]].clone();
    const dotv = rel.x * ax.x + rel.y * ax.y + rel.z * ax.z, th = 2 * Math.atan2(dotv, rel.w), thw = Math.atan2(Math.sin(th), Math.cos(th));
    for (const nm of [LA, L2]) { const b = h.bone(nm); if (b) b.quaternion.multiply(Qt().setFromAxisAngle(ax, thw * twist * 0.5)); }
    h.update();
    // the wrist bone takes the rest of the orientation
    const W = h.bone(WR), wp = Qt(); W.parent.getWorldQuaternion(wp); W.quaternion.copy(wp.invert().multiply(R)); h.update();
    // wrist load: local rotation of the hand against the forearm (twist removed): flexion about the palm's a axis, deviation about f
    // swing of the wrist against the forearm with the twist about the forearm axis taken out: what the joint really bends
    const wl = W.quaternion, twq = (() => { const d = wl.x * ax.x + wl.y * ax.y + wl.z * ax.z, t = new THREE.Quaternion(ax.x * d, ax.y * d, ax.z * d, wl.w); return t.lengthSq() > 1e-12 ? t.normalize() : new THREE.Quaternion(); })(),
      swq = wl.clone().multiply(twq.clone().invert()), sw = 2 * Math.acos(clamp(Math.abs(swq.w), 0, 1));
    const e = new THREE.Euler().setFromQuaternion(W.quaternion, 'XYZ');
    // read the palm point off the skin (hand scale, glove and pose all count) and nudge the wrist until it is where the plan says
    if (this.palmV.length && !G._noRefine) { this.refresh(); const pw = this.palmWorld(), e = palmTarget.clone().sub(pw);
      if (e.length() > 0.0004 && e.length() < 0.05 && (G._refine || 0) < 3) { G._refine = (G._refine || 0) + 1; const wp2 = wristPt.clone().add(e); const r = this.place(G, wp2, R, { pole, twist, lean, palmTarget }); G._refine = 0; r.refined = true; return r; } }
    G.state = { reachMiss: sol.miss, wristAngle: sw, forearmTwist: thw, wristEuler: [e.x, e.y, e.z], elbowFlex: sol.flex, S: S.clone(), E: sol.E.clone(), W: sol.W.clone() };
    return G.state;
  }
  // ------------------------------------------------ the arm chain as state (to try both wraps and keep the easier wrist)
  armBones() { const s = this.side; return ['spine05', 'spine04', 'spine03', 'spine02', `clavicle.${s}`, `shoulder01.${s}`, `upperarm01.${s}`, `upperarm02.${s}`, `lowerarm01.${s}`, `lowerarm02.${s}`, `wrist.${s}`].map(n => this.h.bone(n)).filter(Boolean); }
  snap() { return this.armBones().map(b => b.quaternion.clone()); }
  restore(S) { this.armBones().forEach((b, i) => b.quaternion.copy(S[i])); this.h.update(); }
  // both wrap signs and, optionally, a few approach roll angles; keep the plan whose wrist bends least (a wrist at 100 degrees is an alien hand)
  planBest(spec, { wraps = [1, -1], place = true, poseOpts = {} } = {}) {
    const s0 = this.snap(); let best = null;
    for (const w of wraps) { this.restore(s0); const G = this.plan({ ...spec, wrap: w }); const st = this.place(G, undefined, undefined, poseOpts); const cost = st.wristAngle + 20 * st.reachMiss; if (!best || cost < best.cost) best = { G, cost, st }; }
    this.restore(s0); this.place(best.G, undefined, undefined, poseOpts); return best.G;
  }
  // HUMAN c6: the approach is CHOSEN, not given. A handle can be held from any side; a person takes it the way that keeps the wrist
  // near neutral and the forearm inside its twist range. Sample the approach all round the object's axis (and both wraps and a few
  // tilts), place the arm for each, cost = wrist swing + a steep penalty past a comfortable bend (`comfort`, rad) and past the hard
  // limit (`limit`), forearm twist past +-75 degrees, reach miss, and a mild preference for the palm on the side facing the shoulder.
  // The winner is placed; G.choice reports { wristDeg, twistDeg, approach, overLimit, tried }. overLimit = true means no way of taking
  // this handle from where the body stands keeps the wrist in range: move the body (the caller's job), do not accept the hand.
  planNatural(spec, { n = 16, wraps = [1, -1], tilts = null, comfort = 0.6, limit = 1.25, poseOpts = {}, prefer = null, preferW = 0.25 } = {}) {   // preferW: how much the task's direction (prefer) counts against wrist comfort (bearing down on a handle: ~1.5)
    const s0 = this.snap(), obj = spec.obj, axis = (spec.axis || obj.axis || V(0, 1, 0)).clone().normalize();
    const e1 = Math.abs(axis.y) < 0.9 ? V(0, 1, 0).cross(axis).normalize() : V(1, 0, 0).cross(axis).normalize(), e2 = V().crossVectors(axis, e1);
    const S = this.h.joint(`upperarm01.${this.side}`), toS = S.clone().sub(spec.at); toS.addScaledVector(axis, -toS.dot(axis)).normalize();
    const T = tilts || [spec.tilt ?? (GRIPS[spec.grip || 'power'] || {}).tilt ?? 0.4]; let best = null, tried = 0;
    for (let k = 0; k < n; k++) { const th = k / n * Math.PI * 2, ap = e1.clone().multiplyScalar(Math.cos(th)).addScaledVector(e2, Math.sin(th));
      for (const w of wraps) for (const tl of T) { this.restore(s0); const G = this.plan({ ...spec, approach: ap, wrap: w, tilt: tl }); const st = this.place(G, undefined, undefined, poseOpts); tried++;
        const sw = st.wristAngle, rot = this.pronation();
        const cost = sw + 4 * Math.max(0, sw - comfort) + 30 * Math.max(0, sw - limit) + 0.35 * Math.abs(rot) + 2.5 * Math.max(0, Math.abs(rot) - 1.0) + 25 * st.reachMiss - preferW * ap.dot(prefer || toS);
        if (!best || cost < best.cost) best = { G, cost, st, ap, w, tl }; } }
    this.restore(s0); const st = this.place(best.G, undefined, undefined, poseOpts);
    best.G.choice = { wristDeg: +(st.wristAngle * 180 / Math.PI).toFixed(1), twistDeg: +(st.forearmTwist * 180 / Math.PI).toFixed(1), pronationDeg: +(this.pronation() * 180 / Math.PI).toFixed(1), approach: best.ap.toArray().map(x => +x.toFixed(3)), wrap: best.w, tilt: best.tl, overLimit: st.wristAngle > limit, tried };
    return best.G;
  }
  // forearm rotation away from NEUTRAL (rad, + pronation): neutral is the palm facing the body's midline, thumb up, the way a hand
  // hangs; the anatomical range is about 80 degrees each way, comfortable within about 50
  pronation() {
    const h = this.h, F = h._body(), E = h.joint(`lowerarm01.${this.side}`), Wj = h.joint(`wrist.${this.side}`), fa = Wj.clone().sub(E).normalize();
    const med = F.xL.clone().multiplyScalar(-this.sg), n0 = med.addScaledVector(fa, -med.dot(fa)); if (n0.lengthSq() < 1e-6) return 0; n0.normalize();
    const n = h.palm(this.side).n, n1 = n.clone().addScaledVector(fa, -n.dot(fa)); if (n1.lengthSq() < 1e-6) return 0; n1.normalize();
    return Math.atan2(V().crossVectors(n0, n1).dot(fa), n0.dot(n1)) * this.sg;
  }
  // put the palm ON the surface: the palm patch and the heel of the hand touch and do not sink (skin and glove are soft, but a measure of 5 mm sunk is not contact)
  settle(G, wantMm = 0.5) {
    for (let it = 0; it < 6; it++) {
      this.refresh(); const m = Math.min(this.minD(this.palmV, G.obj).d, this.minD(this.set.palm, G.obj).d + 0.0015);   // the heel may sink 1.5 mm, the patch none
      if (Math.abs(m) * 1000 < wantMm) break;
      G.palmPt.addScaledVector(G.approachU, -m); const H = this.H0; G.wristPt = G.palmPt.clone().sub(V().copy(H.palm).sub(H.w).multiplyScalar(this.h.scale).applyQuaternion(G.R));
      this.place(G, G.wristPt, G.R, { pole: G.pole });
    }
    return G;
  }
  // ------------------------------------------------ fit: find the closed pose once the wrist is at its place
  fit(G) {
    const obj = inflateIfNeeded(G.obj), A = { spread: { ...(G.spread || {}) }, meta: {} }, res = {};
    if (G.fist) return this._fitFist(G);
    this.apply({ index: [0, 0, 0], middle: [0, 0, 0], ring: [0, 0, 0], pinky: [0, 0, 0], spread: {}, thumb: G.thumbPre || [0, 0, 0, 0] });
    const only = G.only || FINGERS;
    for (const f of FINGERS) {
      if (!only.includes(f)) { A[f] = (G.pre[f] || [0.4, 0.6, 0.4]).map(x => x * (G.relax ?? 1) * 1.3); this.apply({ ...this.ang, ...A, spread: A.spread, meta: A.meta }); continue; }
      const th = this.closeFinger(f, obj, { pre: (G.pre[f] || [0.2, 0.3, 0.1]).slice(), spread: G.spread?.[f] || 0 }); A[f] = th; this.apply({ ...this.ang, ...A, spread: A.spread, meta: A.meta });
    }
    const T = G.thumb === 'none' ? [0, 0, 0, 0] : this.fitThumb(obj, G.thumb, only.filter(f => f !== 'thumb')); A.thumb = T;
    this.apply({ ...this.ang, ...A, spread: A.spread, meta: A.meta });
    G.fit = A; G.open = this.openPose(G); return A;
  }
  handBoneList() { const out = [], h = this.h, s = this.side; for (let n = 1; n <= 5; n++) { for (let k = 1; k <= 3; k++) out.push([h.bone(`finger${n}-${k}.${s}`), n === 1 ? 'thumb' : FINGERS[n - 2], k - 1]); if (n > 1) out.push([h.bone(`metacarpal${n - 1}.${s}`), FINGERS[n - 2], -1]); } return out; }
  _fitFist(G) {
    const h = this.h, s = this.side; h.fistBridgman(s, { tight: 1, cock: G.cock ?? 0.12 });
    if (G.point) { // the index finger extends: open it again and keep the rest
      const B = this.bones.index; B.forEach((b, k) => b.quaternion.copy(this.rest.index[k])); const Hn = this.H0; B[0].quaternion.multiply(Qt().setFromAxisAngle(this.axes.index[0], -0.12)); h.update(); }
    const snap = new Map(); for (const [b] of this.handBoneList()) snap.set(b, b.quaternion.clone());
    G.fit = { snapshot: snap, spread: {}, meta: {} }; G.open = null; this.refresh(); return G.fit;
  }
  openPose(G) { const A = { spread: {}, meta: {} }; for (const f of FINGERS) { A[f] = (G.pre[f] || [0.2, 0.3, 0.1]).slice(); A.spread[f] = (G.spread?.[f] || 0) - (f === 'index' ? 0.05 : 0) - (f === 'pinky' ? 0.12 : 0); } A.thumb = (G.thumbPre || [-0.5, -0.4, 0.05, 0.05]).slice(); return A; }
  // ------------------------------------------------ the fist, placed by its own frame (a: the knuckle line index -> pinky, n: out of the palm), built to Bridgman
  planFist(spec) {
    const G = { ...GRIPS[spec.grip || 'fist'], ...spec }; G.name = spec.grip || 'fist'; G.side = this.side; G.fist = true;
    const hand = Math.sign(V().crossVectors(this.H0.a, this.H0.f).dot(this.H0.n)) || 1;
    let n = spec.n.clone().normalize(), a;
    if (spec.f) { const f = spec.f.clone().normalize(); n.addScaledVector(f, -n.dot(f)).normalize(); a = V().crossVectors(f, n).multiplyScalar(hand); }   // fingers along the forearm: the wrist swings least
    else a = spec.a.clone().addScaledVector(n, -spec.a.dot(n)).normalize();
    G.n = n; G.a = a; G.f = V().crossVectors(n, a);
    G.R = this._frame(a, G.f, n); const H = this.H0; G.palmPt = spec.at ? spec.at.clone() : null;
    G.wristPt = spec.wrist ? spec.wrist.clone() : G.palmPt.clone().sub(V().copy(H.palm).sub(H.w).multiplyScalar(this.h.scale).applyQuaternion(G.R));
    if (!G.palmPt) G.palmPt = G.wristPt.clone().add(V().copy(H.palm).sub(H.w).multiplyScalar(this.h.scale).applyQuaternion(G.R));
    G.approachU = V(0, 0, 1); G.obj = null; G.pole = spec.pole || V(0, -1, 0); return G;
  }
  // what a fist has to be, measured on the skin and the bones: the thumb over the middle phalanges, no finger inside its neighbour, the fingertips in the palm, the knuckle arch
  measureFist() {
    const h = this.h, s = this.side, sc = h.scale, mm = 1000, out = { thumbOver: {}, tipToPalmMm: {}, pairs: {}, arch: {} };
    const link = (n, k) => { const B = h.bone(`finger${n}-${k}.${s}`), i = h.idx[`finger${n}-${k}.${s}`]; const a = V().setFromMatrixPosition(B.matrixWorld), b = h.tail0[i].clone().sub(h.head0[i]).applyMatrix4(B.matrixWorld); return [a, b]; };
    const rad = { 1: 0.0105, 2: 0.0085, 3: 0.009, 4: 0.0085, 5: 0.0075 };
    const segD = ([a, b], [c, d]) => { let m = Infinity; for (let i = 0; i <= 8; i++) { const p = a.clone().lerp(b, i / 8); for (let j = 0; j <= 8; j++) m = Math.min(m, p.distanceTo(c.clone().lerp(d, j / 8))); } return m; };
    const t3 = link(1, 3), t2 = link(1, 2);
    for (const [f, n] of [['index', 2], ['middle', 3]]) { const d = Math.min(segD(t3, link(n, 2)), segD(t2, link(n, 2))) - (rad[1] + rad[n]) * sc; out.thumbOver[f] = { gapMm: d * mm }; }
    for (const [f, n] of [['index', 2], ['middle', 3], ['ring', 4], ['pinky', 5]]) { const tip = this.set[f][2], pv = this.set.palm; let m = Infinity; const p = V(), q = V(); const sub = pv.filter((_, i) => i % 3 === 0);
      for (const v of tip.filter((_, i) => i % 3 === 0)) { this.skinPt(v, p); for (const w of sub) { this.skinPt(w, q); m = Math.min(m, p.distanceTo(q)); } } out.tipToPalmMm[f] = m * mm; }
    for (const [a, b] of [[2, 3], [3, 4], [4, 5]]) { let m = Infinity; for (const k of [1, 2, 3]) m = Math.min(m, segD(link(a, k), link(b, k)) - (rad[a] + rad[b]) * sc); out.pairs[`${a - 1}-${b - 1}`] = { gapMm: m * mm }; }
    const P = h.palm(s), knuckle = n => V().setFromMatrixPosition(h.bone(`finger${n}-1.${s}`).matrixWorld), hts = [2, 3, 4, 5].map(n => knuckle(n).dot(P.f));
    out.arch = { indexToPinkyMm: (hts[0] - hts[3]) * mm, middleToRingMm: (hts[1] - hts[2]) * mm };
    out.maxPenMm = Math.max(0, ...Object.values(out.pairs).map(p => -p.gapMm), ...Object.values(out.thumbOver).map(p => -p.gapMm));
    out.thumbContact = Math.min(...Object.values(out.thumbOver).map(p => p.gapMm)) < 3;
    return out;
  }
  // ------------------------------------------------ closure u in 0..1: staggered, thumb last; angles between the open preshape and the fitted pose
  angles(G, u) {
    if (G.fit.snapshot) return null;
    const F = G.fit, O = G.open, out = { spread: {}, meta: {} }, st = G.stagger || {};
    for (const f of FINGERS) { const d = st[f] ?? 0, s = sstep(d, d + 0.62, u); out[f] = F[f].map((x, k) => O[f][k] + (x - O[f][k]) * (k === 2 ? sstep(0, 1, s) : s)); out.spread[f] = (O.spread?.[f] || 0) + ((F.spread?.[f] || 0) - (O.spread?.[f] || 0)) * s; }
    const dt = st.thumb ?? 0.3, s = sstep(dt, dt + 0.62, u); out.thumb = F.thumb.map((x, k) => O.thumb[k] + (x - O.thumb[k]) * s);
    return out;
  }
  // the whole hand at closure u, wrist as planned (the caller moves the wrist first, if it wants an approach)
  pose(G, u) {
    if (G.fit?.snapshot) { const st = G.stagger || { thumb: 0.32, index: 0.06, middle: 0, ring: 0.05, pinky: 0.1 };
      for (const [b, f] of this.handBoneList()) { const d = st[f] ?? 0, s = sstep(d, d + 0.62, u), q = G.fit.snapshot.get(b), kk = this.restOf(b); b.quaternion.copy(kk).slerp(q, s); }
      this.refresh(); return; }
    this.apply(this.angles(G, u));
  }
  restOf(b) { if (!this._restMap) { this._restMap = new Map(); for (const [bb] of this.handBoneList()) this._restMap.set(bb, bb.quaternion.clone().identity()); for (const f of Object.keys(this.rest)) this.bones[f].forEach((bb, k) => this._restMap.set(bb, this.rest[f][k])); } return this._restMap.get(b) || b.quaternion; }
  // contacts as events for the music studio: the palm lands at tApproach, then each finger's pad arrives as its closure completes (u = stagger + 0.62)
  // -> [{ t, kind: 'grip', where: 'index' | ..., strength }]  (closure runs from tClose over `dur` seconds)
  events(G, tApproach, tClose, dur) {
    const st = G.stagger || { thumb: 0.32, index: 0.06, middle: 0, ring: 0.05, pinky: 0.1 }, out = [{ t: tApproach, kind: 'palm', where: 'palm', strength: 0.6 }];
    for (const f of [...FINGERS, 'thumb']) if (!G.only || G.only.includes(f)) out.push({ t: tClose + dur * clamp((st[f] ?? 0) + 0.5), kind: 'grip', where: f, strength: f === 'thumb' ? 0.7 : 0.45 });
    return out.sort((a, b) => a.t - b.t);
  }
  // ------------------------------------------------ measures (mm), per finger, on the skin
  measure(sdf, G = null) {
    const obj = inflateIfNeeded(sdf), out = { fingers: {}, palm: null, worst: null }, mm = 1000;
    let worstGap = -Infinity, worstPen = 0, wf = null;
    for (const f of Object.keys(FN)) {
      const ids = [...this.set[f][0], ...this.set[f][1], ...this.set[f][2]], m = this.minD(ids, obj), padM = this.minD([...this.set[f][1], ...this.set[f][2]], obj);
      const rec = { gapMm: padM.d * mm, penMm: Math.max(0, -m.d) * mm, contact: padM.d < 0.0015 };
      out.fingers[f] = rec; if (rec.penMm > worstPen) { worstPen = rec.penMm; wf = f + ' penetrates'; }
      if ((!G?.only || G.only.includes(f)) && rec.gapMm > worstGap) worstGap = rec.gapMm;
    }
    const pm = this.minD(this.palmV, obj), hb = this.minD(this.set.palm, obj); out.palm = { gapMm: pm.d * mm, penMm: Math.max(0, -pm.d) * mm }; out.heel = { gapMm: hb.d * mm, penMm: Math.max(0, -hb.d) * mm };
    out.maxGapMm = worstGap; out.maxPenMm = Math.max(worstPen, out.palm.penMm, out.heel.penMm); out.contacts = Object.values(out.fingers).filter(r => r.contact).length;
    out.worst = wf; return out;
  }
  // contact points on the surface, for the overlay: [{ finger, p (world), gapMm, kind }]
  contacts(sdf) {
    const obj = inflateIfNeeded(sdf), pts = []; const p = V();
    for (const f of Object.keys(FN)) { const m = this.minD([...this.set[f][1], ...this.set[f][2]], obj); if (m.v < 0) continue; this.skinPt(m.v, p); pts.push({ finger: f, p: p.clone(), gapMm: m.d * 1000 }); }
    const m = this.minD(this.set.palm, obj); if (m.v >= 0) { this.skinPt(m.v, p); pts.push({ finger: 'palm', p: p.clone(), gapMm: m.d * 1000 }); }
    return pts;
  }
}
const inflateIfNeeded = o => o;
