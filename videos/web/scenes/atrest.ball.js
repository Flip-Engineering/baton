// AT REST c20: the weight that finds the site. The bench's new solid things and their light, in the drop's frame (props in METRES like
// atrest.drop.js; the points layers in millimetres, drawn into the instrument's own image like the burst's spray):
//   roomEnv     what a mirror on the bench sees: the dark room, the window behind the drop (the source side, a dim amber disc filling the
//               view behind), the sodium practical (a small hot disc behind and to the right) and the glowing, fringed head of the drop
//               itself, seen from the site (a small amber disc ringed with black). On a polished ball the window gives the rim, the lamp
//               the hard highlight, and the head its tiny reflection, the way the head carries the works.
//   Ball        a polished 3.5 mm steel ball from the striker's own steel, with a fine lap line and a pit, turning slowly
//   Slivers     the tail where it fails: a few slivers of glass that separate and tumble, catching the lamp as they turn
//   Dust        points (motes before, grit at the break): slow, glinting, in mm, drawn additively into the instrument's image
import * as THREE from 'three';
import { bandColour } from '../lib/fx/objective/spectral.js';

const MM = 1e-3;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const rnd = seed => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };

// ---------------------------------------------------------------- the room as a mirror sees it (equirect, pre-exposed linear, PMREM'd)
// head: { dir: unit vector from the site to the head's centre, ang: its angular radius }. Values are display-referred like the rig's own env.
// tail: { tan: unit tangent of the tail under the ball, ang: its half-width (rad) } — the glowing thread right under the ball, which a mirror
// ball shows as a bright band across its lower half (c20 v-a: without it the ball read as a hollow ring)
export function roomEnv(renderer, { head = null, tail = null, window = 1.1, lamp = 160, lampDir = [0.62, 0.28, -0.73], lampAng = 0.07, headL = 1.2, tailL = 0.9, W = 1024, H = 512 } = {}) {
  const band = bandColour(), mx = Math.max(...band), bc = band.map(c => c / mx);
  const data = new Float32Array(W * H * 4), ld = V(...lampDir).normalize(), hd = head ? V(...head.dir).normalize() : null, d = V();
  const tN = tail ? V().crossVectors(V(...tail.tan), V(0, -1, 0)).normalize() : null;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const phi = ((i + 0.5) / W - 0.5) * 2 * Math.PI, lat = ((j + 0.5) / H - 0.5) * Math.PI;
    d.set(Math.cos(phi) * Math.cos(lat), Math.sin(lat), Math.sin(phi) * Math.cos(lat));
    // the dark room: the bench top below catches the lamp (a warm low glow), the wall behind the camera a little; the lamp-lit back wall
    let L = 0.004 + 0.05 * Math.pow(Math.max(0, -d.y), 1.5) + 0.03 * Math.max(0, d.z) + 0.12 * Math.pow(Math.max(0, d.dot(ld)), 3);
    // a soft glow overhead and toward the lens (the lamp's light off the ceiling over the bench): what lets a polished body read as round
    L += 0.22 * smooth(0.25, 0.75, d.y) * (0.4 + 0.6 * smooth(-0.2, 0.6, d.z));
    // the window behind the drop: the aperture (r 150 mm at 150 mm) is a cone of half-angle 45 degrees about -z; its edge soft
    const cw = -d.z; if (cw > 0) { const a = Math.acos(Math.min(1, cw)); L += window * (1 - smooth(0.70, 0.80, a)) * (0.75 + 0.25 * cw); }
    // the sodium practical: a small hot disc, a soft halo round it
    const al = Math.acos(Math.min(1, Math.max(-1, d.dot(ld)))); L += lamp * (1 - smooth(lampAng * 0.6, lampAng, al)) + 0.25 * Math.exp(-al / 0.12);
    // the tail: a bright thread passing right under the ball (a band across the lower hemisphere), with a few dark fringes along it
    if (tN && d.y < -0.15) { const off = Math.abs(d.dot(tN)); if (off < tail.ang) { const along = d.dot(V(...tail.tan));
      L += tailL * (1 - smooth(tail.ang * 0.6, tail.ang, off)) * (0.55 + 0.45 * Math.cos(along * 9.0)) * smooth(0.15, 0.45, -d.y); } }
    // the head: an amber disc with its black isochromatic rings
    if (hd) { const ah = Math.acos(Math.min(1, Math.max(-1, d.dot(hd)))); if (ah < head.ang) { const q = ah / head.ang;
      L += headL * (1 - smooth(0.85, 1.0, q)) * (0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.cos(q * q * 22.0), 2)); } }
    const k = (j * W + i) * 4; data[k] = L * bc[0]; data[k + 1] = L * bc[1]; data[k + 2] = L * bc[2]; data[k + 3] = 1;
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping; tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.colorSpace = THREE.LinearSRGBColorSpace; tex.needsUpdate = true;
  const pm = new THREE.PMREMGenerator(renderer); const env = pm.fromEquirectangular(tex).texture; pm.dispose(); tex.dispose();
  return env;
}
function smooth(a, b, x) { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); }

// ---------------------------------------------------------------- the ball
export class Ball {
  constructor({ R = 1.75 } = {}) {
    this.R = R; const g = this.group = new THREE.Group(); g.name = 'ball'; g.visible = false;
    const steel = this.mat = new THREE.MeshStandardMaterial({ color: 0xdadcdf, roughness: 0.045, metalness: 1.0, envMapIntensity: 1.0 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(R * MM, 96, 64), steel); g.add(body);
    // the lap line (a ground band a few hundredths wide round a great circle) and a pit: what lets the eye see it turn
    const lap = new THREE.MeshStandardMaterial({ color: 0x5a5c60, roughness: 0.42, metalness: 1.0 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R * MM * 1.0005, 0.035 * MM, 8, 160), lap); ring.rotation.x = 0.55; ring.rotation.y = 0.3; g.add(ring);
    const pit = new THREE.Mesh(new THREE.SphereGeometry(0.12 * MM, 16, 12), new THREE.MeshStandardMaterial({ color: 0x1a1a1b, roughness: 0.6, metalness: 0.6 }));
    pit.position.set(0.55, 0.45, 0.70).normalize().multiplyScalar(R * MM * 0.985); g.add(pit);
    this.axis = V(0.35, 0.25, 1).normalize();
  }
  // state: { centre: [mm], spin: rad } or null
  set(state) {
    const g = this.group; g.visible = !!state; if (!state) return;
    g.position.set(...state.centre).multiplyScalar(MM); g.quaternion.setFromAxisAngle(this.axis, state.spin); g.updateMatrixWorld(true);
  }
}

// ---------------------------------------------------------------- the slivers: the stretch of tail between the break's two faces (arc sA..sB)
// splits into splinters along its length; each separates from the axis, drops with the ball's push, and tumbles. Film seconds since the break.
export class Slivers {
  // c22: brk (the break's clock, plan.breakClock): the pieces thrown out from the contact at speed, then hanging in slow motion; glass lit
  // by the instrument's own light (amber, the fringes sweeping over each as it turns), not dark shards
  constructor({ n = 26, chunks = 4, seed = 31, brk = null } = {}) {
    this.n = n; this.brk = brk; this.group = new THREE.Group(); this.group.name = 'slivers'; this.group.visible = false; this.list = [];
    const R = rnd(seed), band = bandColour(), mx = Math.max(...band);
    for (let i = 0; i < n; i++) {
      // c21: the break comes apart in pieces, not a sprinkle: a few chunks of the tail's whole thickness (the first `chunks`), then splinters
      const big = i < chunks, len = big ? 0.65 + 0.45 * R() : 0.5 + 1.2 * R(), w = big ? 0.55 + 0.45 * R() : 0.16 + 0.34 * R(), th = big ? 0.4 + 0.35 * R() : 0.08 + 0.18 * R();
      const geo = new THREE.CylinderGeometry(w * 0.5 * MM, w * 0.5 * MM, len * MM, 5, 2); const pa = geo.attributes.position;
      for (let k = 0; k < pa.count; k++) { const y = pa.getY(k) / (len * MM * 0.5); const taper = 1 - 0.75 * Math.pow(Math.abs(y), 1.5) * (R() * 0.5 + 0.5);
        pa.setX(k, pa.getX(k) * taper * (0.7 + 0.6 * R())); pa.setZ(k, pa.getZ(k) * taper * (th / w) * (0.7 + 0.6 * R())); }
      geo.computeVertexNormals();
      const m = new THREE.MeshStandardMaterial({ color: brk ? 0x3a2c18 : 0x0d0d0d, roughness: 0.035, metalness: 0.0, envMapIntensity: 3.0, emissive: new THREE.Color(band[0] / mx, band[1] / mx, band[2] / mx), emissiveIntensity: 0 });
      m.flatShading = true;
      const mesh = new THREE.Mesh(geo, m); this.group.add(mesh);
      const ang = R() * Math.PI * 2;
      const kv = big ? 0.8 : 1.7;                                        // c21: thrown harder (the chunks heavier, slower)
      // c22: out from the contact in every direction, most downward with the blow and along the tail both ways; some toward the lens
      let vb = null;
      if (brk) { const a = R() * Math.PI * 2, el = big ? -0.3 - 0.7 * R() : 0.55 - 1.55 * R() ** 0.8, cz = Math.sqrt(Math.max(0, 1 - el * el)), sp = big ? 1.4 + 1.6 * R() : 2.4 + 4.6 * R() ** 1.5;
        vb = [cz * Math.cos(a) * 1.6 * sp, el * sp, cz * Math.sin(a) * sp * (R() < 0.25 ? 1.8 : 1.0)]; }
      this.list.push({ vb, mesh, m, u: big ? (i + 0.5) / chunks : R(), ang, rad: big ? 0.1 + 0.15 * R() : 0.25 + 0.2 * R(),
        v: [(R() - 0.5) * 2.2 * kv, (-0.6 - 2.2 * R()) * kv, (R() - 0.5) * 1.6 * kv], w: V(R() - 0.5, R() - 0.5, R() - 0.5).normalize(), om: (0.6 + 1.8 * R()) * (big ? 0.7 : 1.3),
        gl: [R() * 6.28, 3 + 6 * R()] });
    }
  }
  // lineAt(s) -> { p, t } (mm); sA, sB the break's faces; tau film s since the break (null: hidden)
  set(tau, lineAt, sA, sB) {
    const g = this.group; g.visible = tau != null && tau >= 0; if (!g.visible) return;
    for (const S of this.list) {
      const s = sA + (sB - sA) * S.u, L = lineAt(s), T = V(...L.t), n1 = V(-T.y, T.x, 0).normalize(), n2 = V().crossVectors(T, n1);
      const off = n1.clone().multiplyScalar(Math.cos(S.ang) * S.rad).addScaledVector(n2, Math.sin(S.ang) * S.rad);
      const e = this.brk ? this.brk(tau) : tau - 0.12 * (1 - Math.exp(-tau / 0.12));   // they start from rest and come to their drift in about a tenth of a second (c22: the break's clock)
      const vv = S.vb || [S.v[0] + off.x * 2.5, S.v[1] + off.y * 2.5, S.v[2] + off.z * 2.5];
      const p = V(...L.p).add(off).add(V(...vv).multiplyScalar(e));
      S.mesh.position.copy(p).multiplyScalar(MM);
      const q0 = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), T), q1 = new THREE.Quaternion().setFromAxisAngle(S.w, S.om * e);
      S.mesh.quaternion.copy(q1.multiply(q0));
      // each catches the lamp as it turns: a glint for the facets that pass the mirror angle
      if (this.brk) { const fr = 0.5 + 0.5 * Math.cos(S.gl[0] * 2.3 + 1.7 * S.om * e);
        S.m.emissiveIntensity = (0.28 + 0.55 * fr * fr) + 7.0 * Math.pow(Math.max(0, Math.cos(S.gl[0] + S.gl[1] * e)), 20) + 2.5 * Math.exp(-tau / 0.06); continue; }
      S.m.emissiveIntensity = 0.06 + 0.10 * Math.pow(Math.max(0, Math.cos(S.gl[0] * 1.7 + 0.5 * S.gl[1] * e)), 2) + 3.0 * Math.pow(Math.max(0, Math.cos(S.gl[0] + S.gl[1] * e)), 24);
    }
    g.updateMatrixWorld(true);
  }
}

// ---------------------------------------------------------------- dust: points in mm, linear drift (+ a slow fall), glinting, additive in the band's colour
// born(R) -> { p: [mm], v: [mm/s], size: mm, gain }; render(rt, pose, bench, tau)
export class Dust {
  constructor(renderer, { n = 200, seed = 5, born, fall = 0, life = 1e9, twinkle = 6 } = {}) {
    this.r = renderer; const R = rnd(seed), p0 = new Float32Array(n * 3), v0 = new Float32Array(n * 3), k = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { const b = born(R, i); p0.set(b.p, i * 3); v0.set(b.v, i * 3); k.set([b.size, b.gain ?? 1, R() * 6.283, 2 + R() * twinkle], i * 4); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p0, 3)); g.setAttribute('aV', new THREE.BufferAttribute(v0, 3)); g.setAttribute('aK', new THREE.BufferAttribute(k, 4));
    this.mat = new THREE.ShaderMaterial({ uniforms: { uT: { value: 0 }, uPxMm: { value: 41.5 }, uGain: { value: 1 }, uCol: { value: new THREE.Vector3(...bandColour()) }, uFocusZ: { value: 0 }, uBlurK: { value: 0 }, uFall: { value: fall }, uLife: { value: life } },
      vertexShader: /* glsl */`
        attribute vec3 aV; attribute vec4 aK; uniform float uT, uPxMm, uFocusZ, uBlurK, uFall, uLife; varying float vA;
        void main(){
          vec3 p = position + aV * uT; p.y -= 0.5 * uFall * uT * uT;
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
          float blur = uBlurK * abs(p.z - uFocusZ), size = max(1.4, aK.x * uPxMm + blur);
          gl_PointSize = size;
          float tw = pow(0.5 + 0.5 * sin(aK.z + aK.w * uT), 8.0);
          vA = aK.y * (0.2 + 1.8 * tw) * exp(-uT / uLife) * min(1.0, 9.0 / (size * size));
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uCol; uniform float uGain; varying float vA;
        void main(){ vec2 q = gl_PointCoord * 2.0 - 1.0; float d = dot(q, q); if (d > 1.0) discard; gl_FragColor = vec4(uCol * vA * uGain * (1.0 - d * 0.7), 1.0); }`,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.scene = new THREE.Scene(); this.scene.add(this.points);
    this.camera = new THREE.PerspectiveCamera(12, 1080 / 1920, 1, 5000);
  }
  render(rt, pose, bench, tau, { gain = 1, analyser = 1 } = {}) {
    if (tau == null || tau < 0) return;
    const c = this.camera; c.position.set(...pose.pos); c.up.set(0, 1, 0); c.lookAt(...pose.target); c.fov = bench.fovY(); c.near = 1; c.far = 5000; c.updateProjectionMatrix(); c.updateMatrixWorld(true);
    const U = this.mat.uniforms; U.uT.value = tau; U.uPxMm.value = bench.pxPerMm(); U.uFocusZ.value = pose.target[2]; U.uBlurK.value = bench.cocPx(bench.u - 0.001); U.uGain.value = gain * (0.5 * analyser + (1 - analyser));
    const r = this.r, prev = r.getRenderTarget(), ac = r.autoClear; r.autoClear = false; r.setRenderTarget(rt); r.render(this.scene, c); r.setRenderTarget(prev); r.autoClear = ac;
  }
}
