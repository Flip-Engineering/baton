// RIG c1 / HORSE: a quadruped on the same solve-and-measure footing as the people. Skeleton proportions after Stubbs (The Anatomy of the
// Horse, 1766: the scapula slanted back from the withers, the short humerus to the elbow at the girth, the long forearm, the cannon, the
// pastern; in the hind, femur, tibia, the hock and its long metatarsal); gaits as FOOTFALL TABLES (Hildebrand; Robilliard, Pfau and Wilson
// 2007): a phase for each foot, a duty factor, a stride length, the suspension. The feet are pinned to the ground in stance and IK does
// the legs; the body heave and pitch come from the table. Contacts come out as events (hoof strikes) for the sound.
//
//   const horse = new Horse({ coat: '#5a3a26', size: 1.0 });           // metres; withers 1.6 m at size 1
//   horse.setGait('gallop');  horse.update(t);                          // t in seconds (the horse stands still: the ground moves at horse.speed)
//   horse.group   (THREE.Group)   horse.rep  { feet[] { name, contact, world (Vector3), missMm }, events[], heave, pitch }
//   horse.events(t0, t1) -> [{ t, kind: 'hoof', where: 'LF', strength }]   the strike times for the music studio
//   horse.saddle (Object3D at the seat), horse.stirrup.L/.R (Object3D), horse.bit (Object3D at the mouth): where a rider is tied
import * as THREE from 'three';
import { twoBone } from './ik.js';
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x)), TAU = Math.PI * 2;
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };

// ---------------------------------------------------------------- gaits: footfall tables (phase of touchdown, per foot, as a fraction of the stride)
//  duty: the fraction of the stride a foot is on the ground; stride: metres per stride; freq: strides per second; lift: peak hoof lift (m) fore/hind;
//  flex: the peak carpus / hock flexion (rad) in swing; heave/pitch: the body's motion (m, rad) and the phase (of the stride) where the body is highest
export const GAITS = {
  walk:   { name: 'walk (lateral 4-beat, no suspension)', phase: { LH: 0.00, LF: 0.25, RH: 0.50, RF: 0.75 }, duty: 0.66, stride: 1.55, freq: 0.85, lift: [0.07, 0.07], flex: [0.9, 0.5], heave: 0.012, pitch: 0.012, beats: 2, hPhase: 0.12, bob: 0.03 },
  trot:   { name: 'trot (diagonal 2-beat, suspension)', phase: { LF: 0.00, RH: 0.00, RF: 0.50, LH: 0.50 }, duty: 0.44, stride: 2.4, freq: 1.35, lift: [0.24, 0.22], flex: [1.35, 0.8], heave: 0.035, pitch: 0.012, beats: 2, hPhase: 0.22, bob: 0.02 },
  canter: { name: 'canter (3-beat, right lead, suspension)', phase: { LH: 0.00, RH: 0.28, LF: 0.28, RF: 0.56 }, duty: 0.30, stride: 2.6, freq: 1.7, lift: [0.32, 0.28], flex: [1.5, 0.95], heave: 0.05, pitch: 0.07, beats: 1, hPhase: 0.94, bob: 0.02 },
  gallop: { name: 'gallop (transverse 4-beat, suspension) fitted to Muybridge plate 626', phase: { LH: -0.006, RH: 0.155, LF: 0.512, RF: 0.536 }, duty: 0.188, stride: 6.3, freq: 2.1, lift: [0.335, 0.275], flex: [1.95, 0.95], heave: 0.033, pitch: 0.048, yShift: -0.081, beats: 1, hPhase: 0.514, bob: 0.0, plate0: 0.84 },
};
// bones (m, at withers height 1.6 m): [upper, lower, cannon, pastern, hoof]
const FORE = { root: V(0.17, 1.10, 0.50), L: [0.36, 0.42, 0.29, 0.17, 0.09], rest: 0.44, pole: V(0, 0, -1), sgn: 1 };
const HIND = { root: V(0.16, 1.16, -0.52), L: [0.40, 0.52, 0.34, 0.17, 0.09], rest: -0.62, pole: V(0, 0, 1), sgn: -1 };
const FETLOCK_H = 0.135;
export const FEET = ['LF', 'RF', 'LH', 'RH'];

// ---------------------------------------------------------------- lofted tubes: a smooth body from stations along a curve
class Loft {
  constructor(n, seg = 14, mat, { cap0 = true, cap1 = true } = {}) {
    this.n = n; this.seg = seg; const vc = n * seg, geo = new THREE.BufferGeometry(); this.pos = new Float32Array((vc + 2) * 3); geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const idx = []; for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) { const a = i * seg + j, b = i * seg + (j + 1) % seg, c = (i + 1) * seg + j, d = (i + 1) * seg + (j + 1) % seg; idx.push(a, c, b, b, c, d); }
    for (let j = 0; j < seg; j++) { idx.push(vc, j, (j + 1) % seg); idx.push(vc + 1, (n - 1) * seg + (j + 1) % seg, (n - 1) * seg + j); }
    geo.setIndex(idx); this.geo = geo; this.mesh = new THREE.Mesh(geo, mat); this.mesh.frustumCulled = false; this.mesh.castShadow = this.mesh.receiveShadow = true; this._u = V(0, 1, 0);
  }
  // pts: n Vector3, rx / ry: half-width and half-height per station (in the ring's own frame), up: a hint for the ring's vertical
  set(pts, rx, ry, up = V(0, 1, 0)) {
    const n = this.n, seg = this.seg, P = this.pos; let prevN = null, prevU = up.clone(); const t = V(), u = V(), s = V();
    for (let i = 0; i < n; i++) {
      t.copy(pts[Math.min(n - 1, i + 1)]).sub(pts[Math.max(0, i - 1)]).normalize();
      u.copy(prevU).addScaledVector(t, -prevU.dot(t)); if (u.lengthSq() < 1e-8) u.copy(up).addScaledVector(t, -up.dot(t)); u.normalize(); s.crossVectors(u, t).normalize(); prevU.copy(u);
      for (let j = 0; j < seg; j++) { const a = j / seg * TAU, ca = Math.cos(a), sa = Math.sin(a), k = (i * seg + j) * 3;
        P[k] = pts[i].x + s.x * ca * rx[i] + u.x * sa * ry[i]; P[k + 1] = pts[i].y + s.y * ca * rx[i] + u.y * sa * ry[i]; P[k + 2] = pts[i].z + s.z * ca * rx[i] + u.z * sa * ry[i]; }
    }
    const vc = n * seg; P[vc * 3] = pts[0].x; P[vc * 3 + 1] = pts[0].y; P[vc * 3 + 2] = pts[0].z; P[(vc + 1) * 3] = pts[n - 1].x; P[(vc + 1) * 3 + 1] = pts[n - 1].y; P[(vc + 1) * 3 + 2] = pts[n - 1].z;
    this.geo.attributes.position.needsUpdate = true; this.geo.computeVertexNormals(); this.geo.computeBoundingSphere();
  }
}
const lerpV = (a, b, t) => a.clone().lerp(b, t);
function curve(keys, m) { // Catmull-Rom through key points -> m points
  const out = [], n = keys.length; for (let i = 0; i < m; i++) { const f = i / (m - 1) * (n - 1), k = Math.min(n - 2, Math.floor(f)), u = f - k;
    const p0 = keys[Math.max(0, k - 1)], p1 = keys[k], p2 = keys[k + 1], p3 = keys[Math.min(n - 1, k + 2)];
    out.push(V(0.5 * ((2 * p1.x) + (-p0.x + p2.x) * u + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * u * u + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * u * u * u),
      0.5 * ((2 * p1.y) + (-p0.y + p2.y) * u + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u * u + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u * u * u),
      0.5 * ((2 * p1.z) + (-p0.z + p2.z) * u + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * u * u + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * u * u * u))); } return out;
}
const interp = (arr, m) => Array.from({ length: m }, (_, i) => { const f = i / (m - 1) * (arr.length - 1), k = Math.min(arr.length - 2, Math.floor(f)); return arr[k] + (arr[k + 1] - arr[k]) * (f - k); });

export class Horse {
  constructor({ coat = '#5a3a26', mane = '#1a120c', size = 1.0, seed = 3 } = {}) {
    this.size = size; this.group = new THREE.Group(); this.body = new THREE.Group(); this.group.add(this.body); this.group.scale.setScalar(size);
    this.gait = GAITS.walk; this.gaitName = 'walk'; this.phase = 0; this.t = 0;
    const mat = new THREE.MeshStandardMaterial({ color: coat, roughness: 0.62, metalness: 0.0 }), matD = new THREE.MeshStandardMaterial({ color: mane, roughness: 0.75 }), hoofM = new THREE.MeshStandardMaterial({ color: '#1c1512', roughness: 0.4 });
    this.mats = { coat: mat, dark: matD };
    this.torso = new Loft(9, 18, mat); this.neck = new Loft(7, 14, mat); this.head = new Loft(8, 14, mat); this.tail = new Loft(7, 8, matD); this.maneM = new Loft(7, 6, matD);
    this.legs = {}; for (const f of FEET) this.legs[f] = { upper: new Loft(6, 12, mat), lower: new Loft(6, 12, mat), can: new Loft(4, 10, mat), past: new Loft(3, 8, mat), hoof: new Loft(3, 10, hoofM), muscle: new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), mat) };
    for (const m of [this.torso, this.neck, this.head, this.tail, this.maneM]) this.body.add(m.mesh);
    for (const f of FEET) { const l = this.legs[f]; for (const k of ['upper', 'lower', 'can', 'past', 'hoof']) this.body.add(l[k].mesh); l.muscle.castShadow = true; this.body.add(l.muscle); }
    this.ears = [1, -1].map(s => { const e = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.13, 8), mat); e.castShadow = true; this.body.add(e); return e; });
    this.eyes = [1, -1].map(s => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), new THREE.MeshStandardMaterial({ color: '#0a0806', roughness: 0.1 })); this.body.add(e); return e; });
    this.saddle = new THREE.Object3D(); this.bit = new THREE.Object3D(); this.stirrup = { L: new THREE.Object3D(), R: new THREE.Object3D() }; this.withers = new THREE.Object3D();
    this.body.add(this.saddle, this.bit, this.stirrup.L, this.stirrup.R, this.withers);
    this.rep = { feet: [], events: [] }; this.stats = { reachMiss: 0, slip: 0 };
    this._pin = {}; this.setGait('walk'); this.update(0);
  }
  setGait(name) { this.gaitName = name; this.gait = GAITS[name]; this.speed = this.gait.stride * this.gait.freq * this.size; return this; }
  // where a foot is in the body frame at stride phase s: { z (m, forward), y (fetlock height), theta (cannon angle), contact, u }
  footAt(f, s) {
    const G = this.gait, fore = f[1] === 'F', B = fore ? FORE : HIND, p = ((s - G.phase[f]) % 1 + 1) % 1, stanceLen = G.stride * G.duty, ex = stanceLen / 2, lift = G.lift[fore ? 0 : 1], fl = G.flex[fore ? 0 : 1];
    let z, y, th, contact = p < G.duty, u;
    if (contact) { u = p / G.duty; z = B.rest + ex * (1 - 2 * u); y = FETLOCK_H - (fore ? 0.035 : 0.025) * Math.sin(Math.PI * u); th = B.sgn * (0.02 + 0.10 * (1 - Math.abs(2 * u - 1)) * 0); }
    else { u = (p - G.duty) / (1 - G.duty); const e = u * u * (3 - 2 * u); z = B.rest - ex + 2 * ex * e; y = FETLOCK_H + lift * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.08)), 0.8); th = B.sgn * (fl * Math.pow(Math.sin(Math.PI * clamp(u * 1.1)), 0.9) * (fore ? 1 : 0.85)); }
    return { z, y, th, contact, u, p };
  }
  // ---------------------------------------------------------------- the frame
  update(t) {
    const G = this.gait, s = t * G.freq, B = this.body; this.t = t; const rep = { feet: [], events: [] }, S = this.size;
    // body motion from the table: heave twice a stride for the 2-beat gaits (once for canter and gallop), pitch about the lateral axis
    const hp = TAU * (G.beats * (s - G.hPhase)), heave = G.heave * Math.cos(hp), pitch = G.pitch * Math.cos(TAU * (s - (G.hPhase + (G.beats === 1 ? 0.25 : 0))) * G.beats);
    B.position.set(0, heave + (G.yShift || 0), 0); B.rotation.set(-pitch, 0, 0); B.updateMatrixWorld(true);
    const roots = {}; const toB = (p) => p.clone(); // work in body-local space, then the body group transforms
    // the pelvis and shoulder move with the pitch; the feet are placed in the horse's ground frame (undo the body transform)
    const inv = new THREE.Matrix4().copy(B.matrixWorld).invert(), invGroup = new THREE.Matrix4();
    let worst = 0;
    for (const f of FEET) {
      const fore = f[1] === 'F', Bn = fore ? FORE : HIND, sx = f[0] === 'L' ? 1 : -1, ft = this.footAt(f, s), L = Bn.L;
      // the scapula / pelvis slides with the leg's reach (the shoulder joint moves ~0.1 m along the trunk)
      const reach = (ft.z - Bn.rest) / (G.stride * G.duty / 2 + 1e-6);
      const root = V(sx * Bn.root.x, Bn.root.y + (fore ? -0.02 * Math.abs(reach) : 0), Bn.root.z + 0.09 * clamp(reach, -1.3, 1.3));
      // the fetlock target in the GROUND frame -> body-local
      const foot = V(sx * (Bn.root.x + 0.005), ft.y, ft.z), footB = foot.clone().applyMatrix4(inv);
      // the cannon: from the fetlock up to the carpus / hock; theta tilts it (fore: the carpus goes forward of the fetlock in swing)
      const can = V(0, Math.cos(ft.th), Math.sin(ft.th) * (fore ? -1 : -1) * (fore ? -1 : 1) * (fore ? 1 : 1)).normalize();
      can.set(0, Math.cos(Math.abs(ft.th)), Math.sign(ft.th) * Math.sin(Math.abs(ft.th)) * (fore ? 1 : 1));
      const cannonDirG = V(0, can.y, fore ? can.z : can.z);     // in the ground frame; body pitch is small, applied through inv below
      const P = foot.clone().addScaledVector(cannonDirG, L[2]), PB = P.clone().applyMatrix4(inv);
      const sol = twoBone(root, L[0], L[1], PB, Bn.pole, { soft: 0.985 });
      // world positions of the joints in the body frame
      const E = sol.E, W = sol.W;
      // the reached carpus differs from PB when out of reach: the fetlock follows the carpus (the cannon keeps its angle)
      const fetB = W.clone().addScaledVector(cannonDirG.clone().transformDirection(inv).multiplyScalar(-1), L[2]);
      const miss = fetB.distanceTo(footB); worst = Math.max(worst, miss);
      // pastern and hoof: the pastern slopes forward-down; more toe-down in swing
      const pa = (0.95 + (ft.contact ? 0 : 0.55 * Math.min(1, Math.abs(ft.th) / 1.2))), pastDir = V(0, -Math.sin(pa), Math.cos(pa)).transformDirection(inv), coronet = fetB.clone().addScaledVector(pastDir, L[3]);
      const hoofTip = coronet.clone().addScaledVector(V(0, -1, 0.35).normalize().transformDirection(inv), L[4]);
      roots[f] = { root, E, W, fet: fetB, coronet, hoofTip, sx, fore };
      const worldFoot = fetB.clone().applyMatrix4(B.matrixWorld);
      rep.feet.push({ name: f, contact: ft.contact, world: worldFoot, missMm: miss * 1000 * S, u: ft.u, phase: ft.p });
    }
    this.stats.reachMiss = worst * 1000 * S;
    this._shape(roots, s);
    // events: strikes inside this frame (the caller passes the time step through events())
    this.rep = rep; return rep;
  }
  // hoof strike times in [t0, t1): touchdown when the stride phase passes the foot's phase
  events(t0, t1) {
    const G = this.gait, out = [], s0 = t0 * G.freq, s1 = t1 * G.freq;
    for (const f of FEET) for (let k = Math.floor(s0 - G.phase[f]) - 1; k <= Math.ceil(s1 - G.phase[f]) + 1; k++) { const s = k + G.phase[f]; if (s >= s0 && s < s1) out.push({ t: s / G.freq, kind: 'hoof', where: f, strength: (f[1] === 'F' ? 0.8 : 1.0) * (0.6 + 0.4 * (G.stride / 5.8)), gait: this.gaitName }); }
    return out.sort((a, b) => a.t - b.t);
  }
  // ---------------------------------------------------------------- the picture
  _shape(R, s) {
    const G = this.gait;
    // trunk: stations from the hindquarter to the breast; the spine bows a little with the gait (the back rounds in the gallop's gather)
    const bow = 0.02 * Math.sin(TAU * s * G.beats + 1.0) * (this.gaitName === 'gallop' || this.gaitName === 'canter' ? 1 : 0.3);
    const st = [[-0.76, 1.32, 0.10, 0.17], [-0.60, 1.34, 0.23, 0.29], [-0.36, 1.30, 0.26, 0.31], [-0.10, 1.24 + bow, 0.24, 0.31], [0.14, 1.20 + bow, 0.245, 0.34], [0.38, 1.18, 0.23, 0.37], [0.58, 1.16, 0.19, 0.33], [0.70, 1.11, 0.14, 0.26], [0.76, 1.06, 0.07, 0.15]];
    this.torso.set(st.map(a => V(0, a[1] - 0.02, a[0])), st.map(a => a[2] * 1.12), st.map(a => a[3] * 1.1));
    // neck and head: the head carriage follows the gait (higher in the walk, lower and forward in the gallop); a nod in the walk
    const carry = { walk: 0.0, trot: 0.02, canter: -0.05, gallop: -0.14 }[this.gaitName], nod = this.gaitName === 'walk' ? 0.05 * Math.sin(TAU * s * 2) : 0.03 * Math.sin(TAU * s * G.beats + 0.5);
    const base = V(0, 1.46, 0.52), mid = V(0, 1.62 + carry * 0.8, 0.78 + (-carry) * 0.5), poll = V(0, 1.72 + carry + nod * 0.5, 1.0 + (-carry) * 1.0);
    const nk = curve([V(0, 1.30, 0.42), base, mid, poll], 7); this.neck.set(nk, [0.19, 0.175, 0.15, 0.13, 0.115, 0.105, 0.1], [0.23, 0.2, 0.17, 0.145, 0.125, 0.115, 0.11], V(0, 1, 0));
    const nose = poll.clone().add(V(0, -0.36 - carry * 0.3 + nod * 0.4, 0.26 - carry * 0.3)), hp = curve([poll.clone().add(V(0, 0.02, -0.03)), poll.clone().lerp(nose, 0.35), poll.clone().lerp(nose, 0.7), nose], 8);
    this.head.set(hp, [0.075, 0.095, 0.095, 0.085, 0.07, 0.055, 0.05, 0.042], [0.11, 0.12, 0.1, 0.075, 0.06, 0.05, 0.045, 0.04], V(0, 0, 1));
    const hd = nose.clone().sub(poll).normalize();
    this.ears.forEach((e, i) => { const sx = i ? -1 : 1; e.position.copy(poll).add(V(sx * 0.055, 0.1, -0.02)); e.rotation.set(0.15 + 0.1 * (this.gaitName === 'gallop' ? 1 : 0), 0, -sx * 0.18); e.position.y -= 0; });
    this.eyes.forEach((e, i) => { const sx = i ? -1 : 1; e.position.copy(poll.clone().lerp(nose, 0.27)).add(V(sx * 0.098, 0.005, 0)); });
    this.bit.position.copy(nose.clone().add(V(0, 0.02, -0.05)));
    // mane: a strip along the crest; tail: a chain from the dock that streams with the speed
    const crest = nk.map((p, i) => p.clone().add(V(0, 0.16 - 0.05 * i / 6, -0.02))); this.maneM.set(crest, [0.012, 0.016, 0.02, 0.02, 0.018, 0.014, 0.01], [0.05, 0.06, 0.06, 0.055, 0.05, 0.045, 0.03], V(0, 0, 1));
    const stream = { walk: 0.06, trot: 0.25, canter: 0.5, gallop: 0.85 }[this.gaitName], wave = Math.sin(TAU * s * 2);
    const tk = curve([V(0, 1.44, -0.72), V(0, 1.42, -0.86), V(0, 1.34 + 0.12 * stream, -1.0 - 0.2 * stream), V(0, 1.15 + 0.32 * stream, -1.12 - 0.5 * stream), V(0, 0.9 + 0.5 * stream, -1.15 - 0.85 * stream)], 7);
    tk.forEach((p, i) => { p.x += 0.04 * wave * (i / 6); }); this.tail.set(tk, [0.045, 0.06, 0.07, 0.07, 0.06, 0.04, 0.015], [0.045, 0.06, 0.07, 0.07, 0.06, 0.04, 0.015], V(0, 0, 1));
    // legs
    for (const f of FEET) {
      const r = R[f], L = this.legs[f], fore = r.fore, Bn = fore ? FORE : HIND, len = Bn.L, sx = r.sx;
      const up = V(0, 1, 0), pts = (a, b, n) => Array.from({ length: n }, (_, i) => lerpV(a, b, i / (n - 1))), k1 = a => a.map(x => x * 1.3);
      if (fore) { L.upper.set(pts(r.root, r.E, 6), k1([0.10, 0.098, 0.088, 0.075, 0.07, 0.068]), k1([0.10, 0.098, 0.088, 0.075, 0.07, 0.068]), V(1, 0, 0)); L.lower.set(pts(r.E, r.W, 6), k1([0.066, 0.075, 0.068, 0.055, 0.042, 0.04]), k1([0.066, 0.075, 0.068, 0.055, 0.042, 0.04]), V(1, 0, 0)); }
      else { L.upper.set(pts(r.root, r.E, 6), k1([0.15, 0.135, 0.105, 0.085, 0.07, 0.06]), k1([0.15, 0.135, 0.105, 0.085, 0.07, 0.06]), V(1, 0, 0)); L.lower.set(pts(r.E, r.W, 6), k1([0.06, 0.075, 0.07, 0.055, 0.04, 0.036]), k1([0.06, 0.075, 0.07, 0.055, 0.04, 0.036]), V(1, 0, 0)); }
      L.can.set(pts(r.W, r.fet, 4), k1([0.037, 0.03, 0.028, 0.033]), k1([0.04, 0.029, 0.026, 0.033]), V(1, 0, 0));
      L.past.set(pts(r.fet, r.coronet, 3), k1([0.036, 0.03, 0.036]), k1([0.036, 0.03, 0.036]), V(1, 0, 0));
      L.hoof.set(pts(r.coronet, r.hoofTip, 3), k1([0.04, 0.05, 0.055]), k1([0.04, 0.048, 0.05]), V(1, 0, 0));
      // the big muscle masses that Stubbs draws: the shoulder / the haunch
      const m = L.muscle; if (fore) { m.position.copy(r.root).add(V(-sx * 0.07, 0.02, -0.02)); m.scale.set(0.07, 0.17, 0.13); m.rotation.set(-0.35, 0, 0); }
      else { m.position.copy(r.root).add(V(-sx * 0.09, -0.03, -0.07)); m.scale.set(0.09, 0.21, 0.19); m.rotation.set(0.5, 0, 0); }
    }
    // where a rider is tied
    this.saddle.position.set(0, 1.52, 0.10); this.withers.position.set(0, 1.58, 0.36);
    this.stirrup.L.position.set(0.30, 0.86, 0.14); this.stirrup.R.position.set(-0.30, 0.86, 0.14);
  }
}
