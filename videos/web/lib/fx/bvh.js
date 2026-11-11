// BVH: real human motion for people.js crowds and hero.js bodies (HUMAN studio, cycle 1).
// Parses BVH (the CMU takes vendored in videos/sources/mocap/cmu, 30 fps, frame 0 = the cgspeed T-pose), runs the FK,
// and retargets onto any skeleton whose bind pose has identity rotations (people.js and hero.js both do): for every
// target bone mapped to a source joint, the world rotation it gets is the source joint's world rotation *relative to
// the T-pose* times a fixed correction that turns the target's bind bone direction onto the source's T-pose bone
// direction. Unmapped target bones follow their parent. Root motion is scaled by leg length.
//
//   import { loadTake, PEOPLE_MAP, heroMap } from '../lib/fx/bvh.js';
//   const walk = await loadTake('../../sources/mocap/cmu/07_01.bvh', { travel: true });       // walk: rotated to travel +Z
//   const cyc = walk.cycle();                                                               // { t0, t1, disp } a loopable stride
//   const drive = walk.retarget(PEOPLE_MAP, People.RIG);                                     // -> a people.js clip
//   folk.set(id, { act: 'clip', clip: drive, ct: t, loop: true, twos: true });
//
// Clip sampling: clip.sample(t, { loop, twos, cycle }) -> { q: [Quaternion per target bone, local], root: Vector3 (m),
// yaw }. `twos` holds each pose for two frames at 30 fps (15 poses a second): the Guilty Gear / Spider-Verse rule that
// stepped timing reads as authored while smooth interpolation reads as a rig. `loop` plays the best stride found by
// cycle() forever, accumulating root displacement so the feet never slide.
import * as THREE from 'three';

const DEG = Math.PI / 180;
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _e = new THREE.Euler();

export function parseBVH(text) {
  const tok = text.split(/\s+/).filter(Boolean); let i = 0;
  const joints = []; let nch = 0;
  const stack = [];
  const readJoint = (name, parent, end = false) => {
    const j = { name, parent, offset: [0, 0, 0], channels: [], ch0: nch, end, children: [] };
    const id = joints.length; joints.push(j); if (parent >= 0) joints[parent].children.push(id);
    if (tok[i++] !== '{') throw new Error('bvh: expected {');
    while (tok[i] !== '}') {
      const t = tok[i++];
      if (t === 'OFFSET') { j.offset = [+tok[i++], +tok[i++], +tok[i++]]; }
      else if (t === 'CHANNELS') { const n = +tok[i++]; for (let k = 0; k < n; k++) j.channels.push(tok[i++]); nch += n; }
      else if (t === 'JOINT') { readJoint(tok[i++], id); }
      else if (t === 'End') { i++; readJoint(name + '_end', id, true); }
      else throw new Error('bvh: unexpected ' + t);
    }
    i++;
  };
  if (tok[i++] !== 'HIERARCHY') throw new Error('bvh: no HIERARCHY');
  if (tok[i++] !== 'ROOT') throw new Error('bvh: no ROOT');
  readJoint(tok[i++], -1);
  if (tok[i++] !== 'MOTION') throw new Error('bvh: no MOTION');
  i++; const nf = +tok[i++]; i += 2; const dt = +tok[i++];
  const frames = new Float32Array(nf * nch);
  for (let k = 0; k < nf * nch; k++) frames[k] = +tok[i++];
  return { joints, nch, nf, dt, frames, byName: Object.fromEntries(joints.map((j, k) => [j.name, k])) };
}

// FK for every frame: world quaternions + positions per joint (source units)
function fk(b) {
  const J = b.joints.length, nf = b.nf, Q = new Float32Array(nf * J * 4), P = new Float32Array(nf * J * 3);
  const e = new THREE.Euler(), q = new THREE.Quaternion(), qa = new THREE.Quaternion(), wq = Array.from({ length: J }, () => new THREE.Quaternion()), wp = Array.from({ length: J }, () => new THREE.Vector3());
  const ax = { Xrotation: new THREE.Vector3(1, 0, 0), Yrotation: new THREE.Vector3(0, 1, 0), Zrotation: new THREE.Vector3(0, 0, 1) };
  for (let f = 0; f < nf; f++) {
    const row = b.frames.subarray(f * b.nch, (f + 1) * b.nch);
    for (let j = 0; j < J; j++) {
      const jt = b.joints[j]; q.identity(); const off = _v.set(...jt.offset);
      jt.channels.forEach((c, k) => {
        const val = row[jt.ch0 + k];
        if (c === 'Xposition') off.x += val; else if (c === 'Yposition') off.y += val; else if (c === 'Zposition') off.z += val;
        else { qa.setFromAxisAngle(ax[c], val * DEG); q.multiply(qa); }
      });
      if (jt.parent < 0) { wq[j].copy(q); wp[j].copy(off); }
      else { wq[j].copy(wq[jt.parent]).multiply(q); wp[j].copy(off).applyQuaternion(wq[jt.parent]).add(wp[jt.parent]); }
      wq[j].toArray(Q, (f * J + j) * 4); wp[j].toArray(P, (f * J + j) * 3);
    }
  }
  return { Q, P };
}

export class Take {
  // opts.travel: rotate the take so its overall travel is along +Z (walks); otherwise the hips face +Z at frame 1.
  constructor(bvh, { travel = false, name = '' } = {}) {
    this.b = bvh; this.name = name; this.J = bvh.joints.length; this.nf = bvh.nf; this.dt = bvh.dt;
    const { Q, P } = fk(bvh); this.Q = Q; this.P = P;
    const j = n => bvh.byName[n];
    // units -> metres: CMU legs (hip->ankle) are ~0.84 m for an average adult
    const L = (a, b) => { const A = this._pos(0, j(a)), B = this._pos(0, j(b)); return A.distanceTo(B); };
    this.legLen = L('LeftUpLeg', 'LeftLeg') + L('LeftLeg', 'LeftFoot');
    this.unit = 0.84 / this.legLen;
    // floor: the lowest toe/foot over the take
    let lo = Infinity; for (let f = 1; f < this.nf; f++) for (const n of ['LeftToeBase', 'RightToeBase', 'LeftFoot', 'RightFoot']) lo = Math.min(lo, this.P[(f * this.J + j(n)) * 3 + 1]);
    this.floor = lo;
    // yaw alignment
    const h0 = this._pos(1, 0), h1 = this._pos(this.nf - 1, 0);
    let yaw;
    if (travel && Math.hypot(h1.x - h0.x, h1.z - h0.z) > 0.2 / this.unit) yaw = Math.atan2(h1.x - h0.x, h1.z - h0.z);
    else { const f = this._facing(1); yaw = Math.atan2(f.x, f.z); }
    this.yaw = yaw; this.align = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
    this.origin = new THREE.Vector3(h0.x, 0, h0.z);
    this.duration = (this.nf - 2) * this.dt;
  }
  _pos(f, j) { return new THREE.Vector3().fromArray(this.P, (f * this.J + j) * 3); }
  _quat(f, j, out = new THREE.Quaternion()) { return out.fromArray(this.Q, (f * this.J + j) * 4); }
  _facing(f) { // hips forward = cross(up, left->right hip) in the take's space
    const j = n => this.b.byName[n]; const l = this._pos(f, j('LeftUpLeg')), r = this._pos(f, j('RightUpLeg'));
    const side = l.sub(r); return new THREE.Vector3(side.z, 0, -side.x).normalize().multiplyScalar(-1);
  }
  // world (aligned, metres) position of joint `name` at time t (seconds of motion, frame 1 = t 0)
  jointAt(name, t, out = new THREE.Vector3()) { const f = this._f(t), j = this.b.byName[name]; const a = this._pos(f.i, j), b = this._pos(f.i2, j); return out.copy(a.lerp(b, f.w)).sub(this.origin).applyQuaternion(this.align).multiplyScalar(this.unit).setY((a.y - this.floor) * this.unit); }
  _f(t) { const x = 1 + Math.max(0, t) / this.dt, i = Math.min(this.nf - 1, Math.floor(x)), i2 = Math.min(this.nf - 1, i + 1); return { i, i2, w: Math.min(1, x - i) }; }
  // the most loopable stretch of 0.8-1.6 s (a stride pair): minimal pose + velocity mismatch between its ends
  cycle({ min = 0.8, max = 1.6 } = {}) {
    if (this._cyc) return this._cyc;
    const legs = ['LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'RightLeg', 'LeftArm', 'RightArm', 'LeftFoot', 'RightFoot'].map(n => this.b.byName[n]).filter(x => x != null);
    const rel = (f, j) => { const p = this._pos(f, j), h = this._pos(f, 0); return p.sub(h); };
    let best = { cost: Infinity };
    const n0 = 2, n1 = this.nf - 2, lo = Math.round(min / this.dt), hi = Math.round(max / this.dt);
    for (let a = n0; a < n1 - lo; a++) for (let b = a + lo; b <= Math.min(n1, a + hi); b++) {
      let c = 0;
      for (const j of legs) { c += rel(a, j).distanceToSquared(rel(b, j)); const va = rel(a + 1, j).sub(rel(a - 1, j)), vb = rel(b + 1, j).sub(rel(b - 1, j)); c += 0.5 * va.distanceToSquared(vb); }
      if (c < best.cost) best = { cost: c, a, b };
    }
    const ha = this._pos(best.a, 0), hb = this._pos(best.b, 0);
    const disp = hb.sub(ha).applyQuaternion(this.align).multiplyScalar(this.unit).setY(0);
    return (this._cyc = { t0: (best.a - 1) * this.dt, t1: (best.b - 1) * this.dt, disp, cost: best.cost });
  }
  // map: [{ bone: target index, src: joint name, tip: joint name (source bone direction), twist?: 0..1 }]
  // rig: { n, parent[], dir[] (bind bone directions, unit Vector3 per target bone), hipsHeight }
  retarget(map, rig) { return new Clip(this, map, rig); }
}

export class Clip {
  constructor(take, map, rig) {
    this.take = take; this.map = map; this.rig = rig; this.n = rig.parent.length;
    const B = take.b.byName;
    this.m = map.map(m => {
      const j = B[m.src], tip = B[m.tip];
      if (j == null) throw new Error('bvh: no joint ' + m.src);
      let tp = tip, d0 = take._pos(0, tp).sub(take._pos(0, j));
      while (d0.length() < 1e-4 && take.b.joints[tp].children.length) { tp = take.b.joints[tp].children[0]; d0 = take._pos(0, tp).sub(take._pos(0, j)); }
      d0.normalize();                                                           // raw T-pose: faces +Z like every bind pose
      const td = rig.dir[m.bone].clone().normalize();
      const C = new THREE.Quaternion().setFromUnitVectors(td, d0);            // bind dir -> T-pose dir (world)
      const q0inv = take._quat(0, j).invert();
      return { ...m, j, C, q0inv };
    });
    this.scale = (rig.legLen || 0.84) / 0.84;
    this._W = Array.from({ length: this.n }, () => new THREE.Quaternion());
    this._set = new Uint8Array(this.n);
    this.duration = take.duration;
  }
  // t: seconds. opts: { loop, twos, offset (s) }. out: { q: Quaternion[n] (local), root: Vector3 (m, rig scale), yaw }
  sample(t, { loop = false, twos = false, fps = 30 } = {}, out = null) {
    const take = this.take;
    out = out || { q: Array.from({ length: this.n }, () => new THREE.Quaternion()), root: new THREE.Vector3() };
    if (twos) t = Math.floor(t * fps / 2) * 2 / fps;
    let tt = t, cycles = 0, cyc = null;
    if (loop) { cyc = take.cycle(); const L = cyc.t1 - cyc.t0; cycles = Math.floor(t / L); tt = cyc.t0 + (t - cycles * L); }
    else tt = Math.min(t, take.duration);
    const f = take._f(tt), W = this._W, set = this._set; set.fill(0);
    for (const m of this.m) {
      take._quat(f.i, m.j, _q); take._quat(f.i2, m.j, _q2); _q.slerp(_q2, f.w).premultiply(take.align);
      W[m.bone].copy(_q).multiply(m.q0inv).multiply(m.C); set[m.bone] = 1;          // world rot of the target bone
    }
    // world -> local (unmapped bones inherit their parent's world rotation)
    const P = this.rig.parent;
    for (let b = 0; b < this.n; b++) { const p = P[b]; if (!set[b]) W[b].copy(p >= 0 ? W[p] : _q.identity()); }
    for (let b = 0; b < this.n; b++) { const p = P[b]; if (p >= 0) out.q[b].copy(W[p]).invert().multiply(W[b]); else out.q[b].copy(W[b]); }
    // twist split: a bone flagged { twistOf: child } takes a share of the child's twist about its own axis
    if (this.rig.twist) for (const [tb, cb, share] of this.rig.twist) {
      const ax = this.rig.dir[cb], qc = out.q[cb];
      const tw = swingTwist(qc, ax, _q2); // twist component
      const part = new THREE.Quaternion().slerp(tw, share);
      out.q[tb].multiply(part); out.q[cb].premultiply(part.clone().invert());
    }
    // root (hips) position, aligned and scaled, relative to the take origin; plus loop displacement
    const hj = take.b.byName.Hips ?? 0; const a = take._pos(f.i, hj), b2 = take._pos(f.i2, hj); a.lerp(b2, f.w);
    out.root.copy(a).sub(take.origin).applyQuaternion(take.align).multiplyScalar(take.unit * this.scale);
    out.root.y = (a.y - take.floor) * take.unit * this.scale;
    if (loop) { const c0 = take._pos(take._f(cyc.t0).i, hj).sub(take.origin).applyQuaternion(take.align).multiplyScalar(take.unit * this.scale); out.root.x += cycles * cyc.disp.x * this.scale; out.root.z += cycles * cyc.disp.z * this.scale; out.root.x -= c0.x; out.root.z -= c0.z; }
    return out;
  }
}

// twist of q about unit axis a (swing-twist decomposition)
export function swingTwist(q, a, out = new THREE.Quaternion()) {
  const d = q.x * a.x + q.y * a.y + q.z * a.z;
  out.set(a.x * d, a.y * d, a.z * d, q.w); const l = Math.hypot(out.x, out.y, out.z, out.w);
  if (l < 1e-9) return out.identity(); out.x /= l; out.y /= l; out.z /= l; out.w /= l; return out;
}

const cache = new Map();
export async function loadTake(url, opts = {}) {
  const key = url + JSON.stringify(opts);
  if (!cache.has(key)) cache.set(key, fetch(url).then(r => { if (!r.ok) throw new Error('bvh: ' + url + ' ' + r.status); return r.text(); }).then(t => new Take(parseBVH(t), { ...opts, name: url.split('/').pop().replace('.bvh', '') })));
  return cache.get(key);
}

// ---------------------------------------------------------------- maps
// people.js (21 bones): hips, spine, chest, neck, head, L arm (ua, fa, hand, fing, fing2), R arm, L leg, R leg
export const PEOPLE_MAP = [
  { bone: 0, src: 'Hips', tip: 'LowerBack' }, { bone: 1, src: 'Spine', tip: 'Spine1' }, { bone: 2, src: 'Spine1', tip: 'Neck' },
  { bone: 3, src: 'Neck', tip: 'Neck1' }, { bone: 4, src: 'Head', tip: 'Head_end' },
  { bone: 5, src: 'LeftArm', tip: 'LeftForeArm' }, { bone: 6, src: 'LeftForeArm', tip: 'LeftHand' }, { bone: 7, src: 'LeftHand', tip: 'LeftFingerBase' },
  { bone: 9, src: 'RightArm', tip: 'RightForeArm' }, { bone: 10, src: 'RightForeArm', tip: 'RightHand' }, { bone: 11, src: 'RightHand', tip: 'RightFingerBase' },
  { bone: 13, src: 'LeftUpLeg', tip: 'LeftLeg' }, { bone: 14, src: 'LeftLeg', tip: 'LeftFoot' }, { bone: 15, src: 'LeftFoot', tip: 'LeftToeBase' },
  { bone: 16, src: 'RightUpLeg', tip: 'RightLeg' }, { bone: 17, src: 'RightLeg', tip: 'RightFoot' }, { bone: 18, src: 'RightFoot', tip: 'RightToeBase' },
];
// hero.js (MakeHuman default rig): built from the rig's bone names
export function heroMap(names) {
  const i = n => names.indexOf(n), M = [];
  const add = (bone, src, tip) => { if (i(bone) >= 0) M.push({ bone: i(bone), src, tip }); };
  add('root', 'Hips', 'LowerBack'); add('spine04', 'Spine', 'Spine1'); add('spine02', 'Spine1', 'Neck');
  add('neck01', 'Neck', 'Neck1'); add('neck03', 'Neck1', 'Head'); add('head', 'Head', 'Head_end');
  for (const [s, S] of [['L', 'Left'], ['R', 'Right']]) {
    add(`clavicle.${s}`, `${S}Shoulder`, `${S}Arm`); add(`upperarm01.${s}`, `${S}Arm`, `${S}ForeArm`); add(`lowerarm01.${s}`, `${S}ForeArm`, `${S}Hand`);
    add(`wrist.${s}`, `${S}Hand`, `${S}FingerBase`);
    add(`upperleg01.${s}`, `${S}UpLeg`, `${S}Leg`); add(`lowerleg01.${s}`, `${S}Leg`, `${S}Foot`); add(`foot.${s}`, `${S}Foot`, `${S}ToeBase`);
  }
  return M;
}
