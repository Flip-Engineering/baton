// AT REST: the whole drop's fragments (issue 95, c23). The rupture front is not only a bright line: the glass behind it comes apart.
// Each shard is seeded in the head or along the visible tail, waits for the crack front's arrival (the same front time as the
// polariscope shader), then is thrown outward with the residual stress, tumbles, and falls. Big chunks carry more mass and move
// slower; the fine chips go first and fastest. The clock is the film's: the high-speed shot shows the slow drift, and at real time
// (TL.real) the remaining glass bursts and clears the jaws. Drawn additively into the instrument's own image, in the band's colour,
// with the window and the sodium practical reflected off each fresh face.
import * as THREE from 'three';
import { DROP } from '../lib/fx/objective/polariscope_ref.js';
import { bandColour } from '../lib/fx/objective/spectral.js';
import { TL } from './atrest.plan.js';

const MM = 1e-3;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const rnd = seed => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const G = 300;                                                         // mm/s^2: the pieces arc and fall, but stay in the shot for the burst
const Y = V(0, 1, 0);

// a few irregular, flat-faceted shard bodies (unit size): the same geometry is scaled and turned for every piece
function shardGeometries(R, n = 12) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const g = new THREE.IcosahedronGeometry(1, 0), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const j = 0.72 + 0.5 * R(), f = 0.55 + 0.55 * R();
      p.setXYZ(i, x * j, y * (0.45 + 0.45 * f), z * (0.40 + 0.55 * R()));
    }
    g.computeVertexNormals(); out.push(g);
  }
  return out;
}

export class Shards {
  // lineAt(s) -> { p, t }; entry = { p, s } where the centreline meets the head; sEnter = the front's arc at the frame's top edge
  constructor(renderer, { lineAt, entry, head = DROP.head, sEnter = 19.6, frontV = 1.8, filmAtTI = x => x,
    headCount = 64, tailCount = 34, seed = 41 } = {}) {
    this.r = renderer; this.scene = new THREE.Scene(); this.group = new THREE.Group(); this.group.name = 'shards';
    this.scene.add(this.group); this.list = []; this.entry = entry; this.sEnter = sEnter; this.frontV = frontV;
    this.camera = new THREE.PerspectiveCamera(12, 1080 / 1920, 1, 5000);
    this._p = V(); this._q = new THREE.Quaternion(); this._dir = V();
    const R = rnd(seed), band = bandColour(), mx = Math.max(...band); this.band = new THREE.Vector3(band[0] / mx, band[1] / mx, band[2] / mx);
    const geoms = shardGeometries(R);
    const frontTI = (p, s, inTail) => {
      if (inTail && s > entry.s) return (sEnter - s) / frontV;
      const dx = p[0] - entry.p[0], dy = p[1] - entry.p[1], dz = p[2] - entry.p[2], d = Math.max(1e-4, Math.hypot(dx, dy, dz));
      const x = dx / d, y = dy / d, z = dz / d;
      const wob = 0.35 * Math.sin(7.3 * x + 3.1 * y + 5.7 * z + 1.0) + 0.12 * Math.sin(13.1 * x - 7.7 * z);
      return (sEnter - entry.s) / frontV + d / frontV * (1.0 + 0.18 * wob);
    };
    const add = (p, s, inTail, size, stretch, q0) => {
      const geom = geoms[(R() * geoms.length) | 0];
      const mat = this.material();
      const mesh = new THREE.Mesh(geom, mat); mesh.frustumCulled = false; mesh.visible = false; this.group.add(mesh);
      const L = inTail ? lineAt(s).p : null;
      const d = inTail ? [p[0] - L[0], p[1] - L[1], p[2] - L[2]] : [p[0], p[1], p[2]];
      const dl = Math.hypot(...d) || 1;
      const dir = d.map(x => x / dl);
      const spinAxis = V(R() - 0.5, R() - 0.5, R() - 0.5).normalize();
      const massK = clamp(size / (head * 0.15), 0.35, 2.6);
      const vSlow = (0.25 + 0.55 * R()) / Math.pow(massK, 0.75);      // mm per film second in the high-speed shot
      const vFast = (10 + 42 * R()) / Math.pow(massK, 0.60);          // mm/s once the clock is real
      const slowSpin = (0.55 + 1.15 * R()) / Math.pow(massK, 0.55);
      const fastSpin = (16 + 46 * R()) / Math.pow(massK, 0.45);
      const relTI = frontTI(p, s, inTail) + 0.8 + 2.2 * R();
      this.list.push({ mesh, mat, home: p, dir, q0, spinAxis, vSlow, vFast, slowSpin, fastSpin,
        release: filmAtTI(relTI), size, stretch, phase: R() * 6.283, bright: 0.72 + 0.55 * R() });
    };
    // head: a dozen large wedges spread over the sphere (the mass), then smaller chips through the volume (the spray)
    const BIG = 12, GA = 2.39996323;
    for (let i = 0; i < headCount; i++) {
      const big = i < BIG;
      const u = big ? 1 - 2 * (i + 0.5) / BIG : 2 * R() - 1;
      const a = big ? i * GA : 2 * Math.PI * R(), s = Math.sqrt(1 - u * u);
      const r = head * (big ? 0.62 + 0.25 * R() : 0.35 + 0.58 * Math.cbrt(R()));
      const p = [r * s * Math.cos(a), r * s * Math.sin(a), r * u];
      const size = head * (big ? 0.24 + 0.11 * R() : 0.050 + 0.085 * Math.pow(R(), 1.4));
      add(p, 0, false, size, [0.75 + 0.5 * R(), 0.55 + 0.8 * R(), 0.40 + 0.5 * R()], new THREE.Quaternion().setFromEuler(new THREE.Euler(R() * 6.283, R() * 6.283, R() * 6.283)));
    }
    // the visible tail: s from the head's shoulder to the high-speed frame's top edge; thin, long pieces along the tangent
    for (let i = 0; i < tailCount; i++) {
      const u = (i + 0.5) / tailCount, s = 6.2 + (sEnter - 6.2) * u + (R() - 0.5) * 0.5;
      const L = lineAt(s), T = V(...L.t), n1 = V(-T.y, T.x, 0).normalize(), n2 = V().crossVectors(T, n1);
      const rr = DROP.rTail(s) * 0.7, a = R() * 6.283;
      const p = [L.p[0] + Math.cos(a) * n1.x * rr + Math.sin(a) * n2.x * rr,
        L.p[1] + Math.cos(a) * n1.y * rr + Math.sin(a) * n2.y * rr,
        L.p[2] + Math.cos(a) * n1.z * rr + Math.sin(a) * n2.z * rr];
      const size = Math.min(0.75, DROP.rTail(s) * (0.65 + 0.7 * R()));
      const q0 = new THREE.Quaternion().setFromUnitVectors(Y, T).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(R() * 6.283, R() * 6.283, R() * 6.283)));
      add(p, s, true, size, [0.45 + 0.35 * R(), 1.2 + 0.8 * R(), 0.35 + 0.3 * R()], q0);
    }
  }
  material() {
    return new THREE.ShaderMaterial({
      uniforms: { uEnv: { value: null }, uToWorld: { value: new THREE.Matrix3() }, uBand: { value: this.band.clone() }, uLamp: { value: V(0.62, 0.28, -0.73).normalize() }, uGain: { value: 0 } },
      vertexShader: /* glsl */`
        precision highp float;
        varying vec3 vN; varying vec3 vV;
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform samplerCube uEnv; uniform mat3 uToWorld; uniform vec3 uBand; uniform vec3 uLamp; uniform float uGain;
        varying vec3 vN; varying vec3 vV;
        void main(){
          vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
          vec3 d = normalize(vV), r = reflect(-d, n);
          float ct = clamp(dot(n, d), 0.0, 1.0), rim = pow(1.0 - ct, 3.2);
          vec3 env = textureCube(uEnv, uToWorld * r).rgb;
          float glint = pow(max(dot(reflect(-d, n), uLamp), 0.0), 90.0);
          // A shard is thin glass, not a mirror: the world behind it crosses the front facet and is read in the band.
          // Kept below the reflection so the dark, faceted read of the break survives.
          vec3 rd = refract(-d, n, 1.0 / 1.52);
          if (dot(rd, rd) < 1e-4) rd = r;
          vec3 td = refract(rd, -n, 1.52);
          if (dot(td, td) < 1e-4) td = rd;
          vec3 tr = textureCube(uEnv, uToWorld * td).rgb;
          vec3 gh = textureCube(uEnv, uToWorld * reflect(rd, -n)).rgb;
          vec3 c = uBand * (0.020 + 0.34 * rim + 0.05 * ct) + env * uBand * (0.07 + 1.05 * rim) + uBand * glint * 1.15
                 + uBand * dot(tr, vec3(0.68, 0.32, 0.0)) * (0.10 + 0.18 * (1.0 - rim))
                 + uBand * dot(gh, vec3(0.68, 0.32, 0.0)) * (0.10 * rim * rim);
          gl_FragColor = vec4(c * uGain, 1.0);
        }`,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true, side: THREE.DoubleSide });
  }
  // pose/camera are in the drop's millimetres, as the polariscope's; t is film seconds; env is the room cube, toWorld maps drop -> world
  render(rt, pose, bench, t, { gain = 1, analyser = 1, env = null, toWorld = null } = {}) {
    if (!env) return;
    const c = this.camera; c.position.set(...pose.pos); c.up.set(0, 1, 0); c.lookAt(...pose.target);
    c.fov = bench.fovY(); c.near = 1; c.far = 5000; c.updateProjectionMatrix(); c.updateMatrixWorld(true);
    const anK = 0.5 * analyser + (1 - analyser), q = this._q, p = this._p;
    for (const S of this.list) {
      if (t < S.release || t > TL.empty + 1.2) { S.mesh.visible = false; continue; }
      const slowAge = Math.max(0, Math.min(t, TL.real) - S.release);
      const fastAge = Math.max(0, t - Math.max(S.release, TL.real));
      p.set(...S.home).addScaledVector(this._dir.set(...S.dir), S.vSlow * slowAge + S.vFast * fastAge);
      p.y -= 0.5 * G * fastAge * fastAge;
      const wig = 0.10 * Math.sin(S.phase + 2.7 * slowAge);
      p.x += wig; p.z += 0.6 * wig;
      q.setFromAxisAngle(S.spinAxis, S.slowSpin * slowAge + S.fastSpin * fastAge).multiply(S.q0);
      S.mesh.position.copy(p); S.mesh.quaternion.copy(q);
      S.mesh.scale.set(S.size * S.stretch[0], S.size * S.stretch[1], S.size * S.stretch[2]);
      const fadeIn = clamp((t - S.release) / 0.06), fadeOut = t <= TL.real ? 1 : Math.exp(-fastAge / 1.2);
      S.mat.uniforms.uEnv.value = env; S.mat.uniforms.uToWorld.value.copy(toWorld);
      S.mat.uniforms.uGain.value = gain * anK * S.bright * fadeIn * fadeOut;
      S.mesh.visible = true;
    }
    const r = this.r, prev = r.getRenderTarget(), ac = r.autoClear;
    r.autoClear = false; r.setRenderTarget(rt); r.render(this.scene, c); r.setRenderTarget(prev); r.autoClear = ac;
  }
}
