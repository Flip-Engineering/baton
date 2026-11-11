// LIGHT / effects: things an impact or a process throws into the light (LIGHTING c1, critique L6 / L7).
//   Debris      chunks and grit on closed-form ballistic paths with ground bounces (the sparks.js approach, for solids):
//               instanced, lit and shadowed like everything else, so they catch the sun and cast contact shadows
//   shake()     camera motion shaped like recorded handheld / vehicle data (band-limited noise, not a sine wobble):
//               a slow operator drift always, plus impact energy that kicks, rings at 6-14 Hz and decays
//   dropTrack() a falling load: free fall from a release, a small bounce and settle (for the impact demo)
// The dust an impact raises is a Medium source (light/medium.js dustBurst), so the sun and the lamps light it and its
// shadow darkens the ground; sparks stay in sim2/sparks.js and lend their light through a 'sparks' practical.
import * as THREE from 'three';
import { litPatch } from './patch.js';

const G = 9.81;
const rnd = s => { let a = s | 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const vnoise = x => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return (hash(i) * (1 - u) + hash(i + 1) * u) * 2 - 1; };

export class Debris {
  constructor(scene, { max = 600, material = null, ground = 0 } = {}) {
    const geo = new THREE.IcosahedronGeometry(1, 0); geo.scale(1, 0.62, 0.85);
    this.mat = litPatch(material || new THREE.MeshStandardMaterial({ color: 0x6b6255, roughness: 0.9 }));
    const m = this.mesh = new THREE.InstancedMesh(geo, this.mat, max); m.castShadow = true; m.receiveShadow = true; m.count = 0; m.frustumCulled = false;
    scene.add(m); this.parts = []; this.max = max; this.ground = ground; this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler();
  }
  // n chunks from pos at t0, thrown outward and up; size in metres
  burst({ t0 = 0, pos = [0, 0, 0], n = 120, speed = [2, 7], up = [0.3, 1.0], size = [0.015, 0.08], seed = 1, rest = 0.28, color = null } = {}) {
    const R = rnd(seed);
    for (let i = 0; i < n && this.parts.length < this.max; i++) {
      const a = R() * Math.PI * 2, sp = speed[0] + (speed[1] - speed[0]) * R() ** 1.5, u = up[0] + (up[1] - up[0]) * R();
      const s = size[0] * (size[1] / size[0]) ** (R() ** 2);   // log-distributed: many grains, few lumps
      const v = [Math.cos(a) * sp * Math.sqrt(1 - u * u), sp * u, Math.sin(a) * sp * Math.sqrt(1 - u * u)];
      this.parts.push({ t0, p: [pos[0] + (R() - 0.5) * 0.4, pos[1] + 0.05, pos[2] + (R() - 0.5) * 0.4], v, s, rest, spin: [R() * 20 - 10, R() * 20 - 10, R() * 20 - 10], r0: [R() * 6, R() * 6, R() * 6] });
    }
  }
  // closed form: flight to the ground, up to two bounces (restitution, friction), then rest
  _at(P, a) {
    let p = P.p.slice(), v = P.v.slice(), t = a, rot = 1;
    for (let b = 0; b < 3; b++) {
      const y0 = p[1] - this.ground - P.s * 0.5, disc = v[1] * v[1] + 2 * G * y0, tg = (v[1] + Math.sqrt(Math.max(0, disc))) / G;
      if (t < tg) return { x: p[0] + v[0] * t, y: p[1] + v[1] * t - 0.5 * G * t * t, z: p[2] + v[2] * t, spin: rot * (a) };
      p = [p[0] + v[0] * tg, this.ground + P.s * 0.5, p[2] + v[2] * tg]; const vy = -(v[1] - G * tg) * P.rest;
      v = [v[0] * 0.45, vy, v[2] * 0.45]; t -= tg; rot *= 0.4;
      if (vy < 0.25) return { x: p[0] + v[0] * Math.min(t, 0.15), y: p[1], z: p[2] + v[2] * Math.min(t, 0.15), spin: rot * (a - t) };
    }
    return { x: p[0], y: p[1], z: p[2], spin: 0 };
  }
  update(t) {
    let n = 0; const m = this._m, q = this._q, e = this._e, s3 = new THREE.Vector3(), p3 = new THREE.Vector3();
    for (const P of this.parts) {
      const a = t - P.t0; if (a < 0) continue;
      const s = this._at(P, a); e.set(P.r0[0] + P.spin[0] * s.spin, P.r0[1] + P.spin[1] * s.spin, P.r0[2] + P.spin[2] * s.spin); q.setFromEuler(e);
      m.compose(p3.set(s.x, s.y, s.z), q, s3.set(P.s, P.s, P.s)); this.mesh.setMatrixAt(n++, m);
    }
    this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// camera shake. events: [{ t0, energy (0..1+), dir: [x,y,z] (optional bias) }]. Returns translation (m) and rotation (rad).
export function shake(t, events = [], { handheld = 1, seed = 3 } = {}) {
  const pos = [0, 0, 0], rot = [0, 0, 0];
  // operator drift: 0.15-1.2 Hz, a few mm and a fraction of a degree, three uncorrelated channels
  for (let c = 0; c < 3; c++) {
    rot[c] += handheld * 0.0016 * (vnoise(t * 0.45 + seed * 11 + c * 31) + 0.5 * vnoise(t * 1.3 + c * 7 + seed));
    pos[c] += handheld * 0.003 * vnoise(t * 0.35 + c * 17 + seed * 3);
  }
  for (const ev of events) {
    const a = t - ev.t0; if (a < 0) continue;
    const E = ev.energy ?? 1, env = E * (1 - Math.exp(-a / 0.012)) * Math.exp(-a / (ev.decay ?? 0.4));
    // the ground wave reaches the tripod / the operator: a vertical kick first, then rings (6-14 Hz), then sway
    pos[1] += -0.035 * E * Math.exp(-a / 0.06) * Math.sin(Math.min(a / 0.06, Math.PI));
    for (let c = 0; c < 3; c++) {
      const ring = vnoise(a * 11 + c * 13 + seed) * 0.7 + vnoise(a * 23 + c * 5) * 0.3;
      rot[c] += env * (c === 2 ? 0.006 : 0.012) * ring;
      pos[c] += env * 0.012 * vnoise(a * 7 + c * 29 + seed);
    }
  }
  return { pos, rot };
}
export function applyShake(camera, base, s) {
  camera.position.set(base.pos[0] + s.pos[0], base.pos[1] + s.pos[1], base.pos[2] + s.pos[2]);
  camera.lookAt(...base.look); camera.rotateX(s.rot[0]); camera.rotateY(s.rot[1]); camera.rotateZ(s.rot[2]);
}

// a load released at tr from height h0 (its bottom), landing on y = 0: returns the bottom's height, velocity and the impact time
export function dropTrack(t, { tr = 1, h0 = 6, bounce = 0.08, hold = null } = {}) {
  const tf = Math.sqrt(2 * h0 / G), ti = tr + tf;
  if (t < tr) return { y: h0 + (hold ? hold(t) : 0), v: 0, ti };
  if (t < ti) { const a = t - tr; return { y: h0 - 0.5 * G * a * a, v: -G * a, ti }; }
  const vb = G * tf * bounce, tb = 2 * vb / G, a = t - ti;
  if (a < tb) return { y: vb * a - 0.5 * G * a * a, v: vb - G * a, ti };
  return { y: 0, v: 0, ti };
}
