// AT REST: the bench (8 Oct 2026; ep1_brief.md "Visual language", "The ONE new asset" section 4). The window polariscope's
// solid things, in the drop's own frame in METRES (x right, y up, z toward the lens; the window and the world at -z), lit by the sodium
// practical behind and to the right, rendered through light/'s LitRenderer with the bench's thin lens (bench.js): the soft rubber-tipped
// jaws that hold the head at its lower edge, the pendulum impact tester's polished steel striker on its arm, the stainless mesh in the
// quench tank, and the worker's hand (atrest.cast.js) when he reaches in. Their light reaches the lens through the analyser: it is
// unpolarised, so it passes a crossed analyser at half (the composite applies it). Their coverage is accumulated with the SAME lens and
// shutter samples LitRenderer used, so the drop behind them is covered exactly as they are blurred.
// The powder spray after the burst is a points layer drawn into the instrument's own image (depolarised glints at half), in millimetres.
import * as THREE from 'three';
import { LightRig } from '../lib/fx/light/rig.js';
import { PRESETS } from '../lib/fx/light/presets.js';
import { litPatchAll } from '../lib/fx/light/patch.js';
import { mat, fin, G } from '../lib/fx/objects/kit.js';
import { bandColour } from '../lib/fx/objective/spectral.js';
import { strikerAt, TL, CONTACT_N } from './atrest.plan.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const MM = 1e-3;
const CN = V(...CONTACT_N);
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

export function buildBench(lr, { head = 6.0, Rig = LightRig } = {}) {
  const scene = new THREE.Scene(); scene.name = 'bench';
  const M = { rubber: fin('rubber'), steel: fin('steel', { color: 0x3a3c3e }), polished: mat('polished', { color: 0xd8dade, rough: 0.07, metal: 1.0, env: 1.0 }),
    stainless: mat('stainless', { color: 0xa4a8ab, rough: 0.28, metal: 1.0 }), black: fin('black') };
  // ---------------------------------------------------------------- the jaws: two arms from below, rubber tips on the head's lower edge,
  // a little behind the focal plane so they fall soft
  const jaws = new THREE.Group(); jaws.name = 'jaws';
  for (const sg of [-1, 1]) {
    const a = 33 * Math.PI / 180, tip = V(sg * head * Math.sin(a), -head * Math.cos(a), -1.2).multiplyScalar(MM), out = V(sg * 0.55, -0.83, -0.08).normalize();
    const pad = new THREE.Mesh(new THREE.SphereGeometry(1.8 * MM, 24, 16), M.rubber); pad.position.copy(tip).addScaledVector(out, 1.6 * MM); jaws.add(pad);
    const arm = new THREE.Mesh(G.rod(tip.clone().addScaledVector(out, 2.5 * MM), tip.clone().addScaledVector(out, 60 * MM), 1.3 * MM, 16), M.steel); jaws.add(arm);
    const sleeve = new THREE.Mesh(G.rod(tip.clone().addScaledVector(out, 1.5 * MM), tip.clone().addScaledVector(out, 9 * MM), 2.1 * MM, 16), M.rubber); jaws.add(sleeve);
  }
  scene.add(jaws);
  // ---------------------------------------------------------------- the striker: a polished steel cylinder (face 20 or 25 mm) on its arm; the
  // arm rises to a pivot out of frame top right. Placed per frame along the contact normal (its swing near the contact is a straight line).
  const striker = new THREE.Group(); striker.name = 'striker';
  const head20 = new THREE.Group(), head25 = new THREE.Group();
  for (const [g, D, L] of [[head20, 20, 30], [head25, 25, 38]]) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(D / 2 * MM, D / 2 * MM, L * MM, 64, 1), M.polished); body.rotation.z = Math.PI / 2; body.position.x = L / 2 * MM; g.add(body);
    const face = new THREE.Mesh(new THREE.CylinderGeometry(D / 2 * MM * 0.97, D / 2 * MM, 0.8 * MM, 64, 1), M.polished); face.rotation.z = Math.PI / 2; face.position.x = 0.4 * MM; g.add(face);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(D / 2 * MM * 1.06, D / 2 * MM * 1.06, 4 * MM, 64, 1), M.steel); collar.rotation.z = Math.PI / 2; collar.position.x = (L - 3) * MM; g.add(collar);
    const arm = new THREE.Mesh(G.rod(V((L - 3) * MM, 0, 0), V((L + 120) * MM, 320 * MM, -40 * MM), 3 * MM, 16), M.steel); g.add(arm);
    striker.add(g);
  }
  scene.add(striker);
  // ---------------------------------------------------------------- the mesh in the quench tank (stainless wire, 3 mm pitch), under the settled blob
  const mesh = new THREE.Group(); mesh.name = 'mesh';
  { const y = -(head + 0.45) * MM, wr = 0.22 * MM, ext = 40 * MM, parts = [];
    for (let k = -13; k <= 13; k++) { parts.push(G.rod(V(-ext, y, k * 3 * MM), V(ext, y, k * 3 * MM), wr, 6)); parts.push(G.rod(V(k * 3 * MM, y - wr * 1.6, -ext), V(k * 3 * MM, y - wr * 1.6, ext), wr, 6)); }
    const m = new THREE.Mesh(G.merge(parts), M.stainless); mesh.add(m); }
  mesh.visible = false; scene.add(mesh);
  litPatchAll(scene);
  // ---------------------------------------------------------------- the light: the sodium practical (an 18 W low-pressure lamp's light, 589 nm), behind
  // and to the right; the room otherwise dark. The camera's exposure is set for its low key.
  const band = bandColour();
  const rig = new Rig(lr.renderer, scene, PRESETS.sodiumNight({ sky: { kind: 'night', skyglow: 0, zenith: 0, groundAlbedo: 0, disc: false }, camera: { ev100: 11.5 },
    atmosphere: { density: 0, ambient: 0 }, bounce: false,
    practicals: [{ kind: 'lps', name: 'sodium', pos: [0.09, 0.04, -0.07], aim: [0, 0, 0], lumens: 1800, half: Math.PI, size: 0.025, shadow: false, volume: false, bounce: false, head: 'none', flicker: 'none' }] }));
  for (const P of rig.practicals) { const mx = Math.max(...band); P.rgb = band; P.peak = mx; P.col.setRGB(band[0] / mx, band[1] / mx, band[2] / mx); P.light.color.copy(P.col); P.faceMat?.emissive.copy(P.col); }
  // the bench camera (metres), set per frame from the plan and bench.js
  const camera = new THREE.PerspectiveCamera(12, 1080 / 1920, 0.002, 20);
  // the striker per (sub-)frame time; returns whether it is in the shot
  function setStriker(tk, shotId) {
    const S = strikerAt(tk), on = !!S && ['A', 'B', 'C', 'D', 'E'].includes(shotId);
    striker.visible = on; if (!on) return false;
    const big = S.blow.face >= 25; head20.visible = !big; head25.visible = big;
    const face = CN.clone().multiplyScalar((head + S.s) * MM);
    striker.position.copy(face); striker.quaternion.setFromUnitVectors(V(1, 0, 0), CN); striker.updateMatrixWorld(true);
    return true;
  }
  return { scene, rig, camera, jaws, striker, mesh, setStriker, M };
}

// the bench camera from the plan's pose: target (mm), dir (unit, toward the lens), the bench's focus distance (m) and vertical field of view
export function poseCamera(camera, B, bench) {
  const u = bench.u, t = V(...B.target).multiplyScalar(MM), d = V(...B.dir);
  camera.position.copy(t).addScaledVector(d, u); camera.up.set(0, 1, 0); camera.lookAt(t);
  camera.fov = bench.fovY(); camera.near = Math.max(0.002, u * 0.1); camera.far = 20; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  return { pos: camera.position.clone().multiplyScalar(1 / MM).toArray(), target: B.target, u };
}

// coverage: the props drawn white, unlit, with LitRenderer's own pixel and lens jitter and shutter times, accumulated (0..1)
export class Coverage {
  constructor(renderer, w, h) {
    this.r = renderer; this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: true });
    this.white = new THREE.MeshBasicMaterial({ color: 0xffffff }); this.white.blending = THREE.NoBlending;
    this.acc = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: { t: { value: null }, k: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D t; uniform float k; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(t, vUv).rgb * k, 1.0); }',
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true }));
    this.qs = new THREE.Scene(); this.qs.add(this.quad); this.qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  render(scene, camera, { K = 8, lens = null, shutter = 1 / 60, t = 0, update = null } = {}) {
    const r = this.r, W = this.rt.width, H = this.rt.height, prev = r.getRenderTarget(), ac = r.autoClear, bg = scene.background, ov = scene.overrideMaterial;
    r.autoClear = false; r.setRenderTarget(this.acc); r.setClearColor(0x000000, 1); r.clear(true, true, true);
    scene.background = null; scene.overrideMaterial = this.white;
    const save = camera.position.clone();
    for (let kk = 0; kk < K; kk++) {
      const tk = K > 1 ? t - shutter * (1 - (kk + 0.5) / K) : t; update?.(tk, kk);
      camera.updateMatrixWorld(); camera.updateProjectionMatrix(); const P = camera.projectionMatrix.elements;
      if (K > 1) { P[8] += 2 * (halton(kk + 1, 2) - 0.5) / W; P[9] += 2 * (halton(kk + 1, 3) - 0.5) / H;
        if (lens?.fstop && lens?.focus) { const f = (lens.focal ?? 35) / 1000, ap = f / (2 * lens.fstop), a = 2 * Math.PI * halton(kk + 1, 5), rr = Math.sqrt(halton(kk + 1, 7)) * ap, ax = Math.cos(a) * rr, ay = Math.sin(a) * rr;
          const right = V().setFromMatrixColumn(camera.matrixWorld, 0), up = V().setFromMatrixColumn(camera.matrixWorld, 1);
          camera.position.addScaledVector(right, ax).addScaledVector(up, ay); camera.updateMatrixWorld(); P[8] -= P[0] * ax / lens.focus; P[9] -= P[5] * ay / lens.focus; } }
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      r.setRenderTarget(this.rt); r.setClearColor(0x000000, 1); r.clear(true, true, true); r.render(scene, camera);
      this.quad.material.uniforms.t.value = this.rt.texture; this.quad.material.uniforms.k.value = 1 / K; r.setRenderTarget(this.acc); r.render(this.qs, this.qc);
      camera.position.copy(save); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
    }
    scene.background = bg; scene.overrideMaterial = ov; r.setRenderTarget(prev); r.autoClear = ac;
    return this.acc.texture;
  }
}

// ---------------------------------------------------------------- the powder spray after the burst (real time from TL.real): fast fragments leave
// the frame within a few frames; the fine powder, slowed by the air, drifts down and out over about a second. Points in the drop's millimetres,
// drawn additively into the instrument's image as depolarised glints (half through the analyser) in the band's colour.
export class Spray {
  constructor(renderer, { n = 5200, seed = 7 } = {}) {
    this.r = renderer; const R = (() => { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
    const p0 = new Float32Array(n * 3), v0 = new Float32Array(n * 3), k = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      // born where the glass was: the head (most) and the neck
      let p; if (R() < 0.8) { const u = R() * 2 - 1, a = R() * Math.PI * 2, rr = 6 * Math.cbrt(R()), s = Math.sqrt(1 - u * u); p = [rr * s * Math.cos(a), rr * s * Math.sin(a), rr * u]; }
      else { const s = 6 + R() * 12; p = [-2.2 - 1.2 * (s - 6) / 12 + (R() - 0.5) * 2, 4 + (s - 6) * 0.75 + (R() - 0.5) * 2, (R() - 0.5) * 2]; }
      const kind = R(), fast = kind < 0.32, fine = kind > 0.72, dir = (() => { const q = [p[0] + (R() - 0.5) * 2, p[1] + (R() - 0.5) * 2, p[2] + (R() - 0.5) * 2], l = Math.hypot(...q) || 1; return q.map(x => x / l); })();
      const sp = fast ? 300 + R() * 2200 : fine ? 3 + R() * 14 : 6 + R() * 48;   // mm/s
      p0.set(p, i * 3); v0.set(dir.map(x => x * sp), i * 3);
      // kind (1 fast, 0 powder, 2 the finest dust, which settles slowly and lasts), size (mm), glint phase, glint rate
      k.set([fast ? 1 : fine ? 2 : 0, fine ? 0.02 + 0.05 * R() ** 2 : 0.05 + 0.5 * R() ** 2, R() * 6.283, 8 + R() * 30], i * 4);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p0, 3)); g.setAttribute('aV', new THREE.BufferAttribute(v0, 3)); g.setAttribute('aK', new THREE.BufferAttribute(k, 4));
    this.mat = new THREE.ShaderMaterial({ uniforms: { uT: { value: 0 }, uPxMm: { value: 41.5 }, uGain: { value: 1 }, uCol: { value: new THREE.Vector3(...bandColour()) }, uFocusZ: { value: 0 }, uBlurK: { value: 0 } },
      vertexShader: /* glsl */`
        attribute vec3 aV; attribute vec4 aK; uniform float uT, uPxMm, uFocusZ, uBlurK; varying float vA; varying float vS;
        void main(){
          float t = uT, tau = 0.08;                                              // the air takes the fine powder's speed in ~80 ms
          vec3 p = position;
          if (aK.x > 1.5) { float e = 1.0 - exp(-t / 0.15); p += aV * 0.15 * e; p.y -= (2.0 + 60.0 * aK.y) * (t - 0.15 * e); }   // the finest: settling a few mm/s
          else if (aK.x > 0.5) p += aV * t + vec3(0.0, -4905.0, 0.0) * t * t;   // fast: ballistic (mm, mm/s, g = 9810 mm/s^2)
          else { float e = 1.0 - exp(-t / tau); p += aV * tau * e; p.y -= (8.0 + 30.0 * aK.y) * (t - tau * e); }   // powder: drag, then settling
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
          float blur = uBlurK * abs(p.z - uFocusZ);
          float size = max(1.5, aK.y * uPxMm + blur);
          gl_PointSize = size;
          float tw = pow(0.5 + 0.5 * sin(aK.z + aK.w * t), 6.0);
          vA = (0.25 + 1.6 * tw) * exp(-t / (aK.x > 1.5 ? 6.0 : aK.x > 0.5 ? 0.12 : 0.9)) * min(1.0, 4.0 / (size * size) * 4.0) * (aK.x > 1.5 ? 0.8 : 1.0);
          vS = size;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uCol; uniform float uGain; varying float vA; varying float vS;
        void main(){ vec2 q = gl_PointCoord * 2.0 - 1.0; float d = dot(q, q); if (d > 1.0) discard; gl_FragColor = vec4(uCol * vA * uGain * (1.0 - d * 0.6), 1.0); }`,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.scene = new THREE.Scene(); this.scene.add(this.points);
    this.camera = new THREE.PerspectiveCamera(12, 1080 / 1920, 1, 5000);
  }
  // camera in mm (the polariscope's pose), the bench (for the blur and px/mm), real seconds since the burst; draws into rt (additively)
  render(rt, pose, bench, tReal, { gain = 1, analyser = 1 } = {}) {
    if (tReal < 0 || tReal > 6) return;
    const c = this.camera; c.position.set(...pose.pos); c.up.set(0, 1, 0); c.lookAt(...pose.target); c.fov = bench.fovY(); c.near = 1; c.far = 5000; c.updateProjectionMatrix(); c.updateMatrixWorld(true);
    const U = this.mat.uniforms; U.uT.value = tReal; U.uPxMm.value = bench.pxPerMm(); U.uFocusZ.value = pose.target[2]; U.uBlurK.value = bench.cocPx(bench.u - 0.001) ; U.uGain.value = gain * (0.5 * analyser + (1 - analyser));
    const r = this.r, prev = r.getRenderTarget(), ac = r.autoClear; r.autoClear = false; r.setRenderTarget(rt); r.render(this.scene, c); r.setRenderTarget(prev); r.autoClear = ac;
  }
}
export { TL };
