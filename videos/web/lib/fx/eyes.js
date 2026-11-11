// EYES (8 Oct 2026): eye lights for crowds and heroes, the burning eyes of A SPECTRE IS HAUNTING (the October series). Two glowing points per
// face, a hot core and a halo, additive; depth-tested against the scene (a head in front hides the eyes behind it) but not depth-written.
// Points keep a minimum size on screen, so a crowd seen from far above is a field of stars.
//
//   import { Eyes } from '../lib/fx/eyes.js';
//   const eyes = new Eyes(scene, { max: 6000 });
//   eyes.begin();
//   for (const id of ids) { const [L, R] = Eyes.ofPeople(folk, id); eyes.pair(L, R, open(id), colour); }   // after folk.update(camera)
//   const [L, R] = Eyes.ofHero(hero); eyes.pair(L, R, 1);
//   eyes.end(camera, H);                                                                                   // before renderer.render
import * as THREE from 'three';

const VS = `
attribute float aOpen; attribute vec3 aCol;
uniform float uScale, uSize, uMinPx, uHalo;
varying float vOpen; varying vec3 vCol; varying float vPx;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float px = max(uMinPx, uSize * uScale / max(0.05, -mv.z));
  vPx = px; vOpen = aOpen; vCol = aCol;
  gl_PointSize = px * uHalo * (0.35 + 0.65 * aOpen);
  gl_Position = projectionMatrix * mv;
}`;
const FS = `
uniform float uHalo, uGain;
varying float vOpen; varying vec3 vCol; varying float vPx;
void main(){
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d = length(q), lid = smoothstep(0.0, 1.0, vOpen);
  float core = smoothstep(1.25 / uHalo, 0.35 / uHalo, d / max(0.15, lid)) ;         // the eye: an almond that opens from a slit
  core *= smoothstep(1.0 / uHalo * (0.25 + 0.75 * lid), 0.0, abs(q.y)) ;
  float halo = exp(-d * d * 7.0) * 0.32 + exp(-d * d * 30.0) * 0.5;
  vec3 c = vCol * (core * 2.4 + halo * lid) * uGain;
  if (max(c.r, max(c.g, c.b)) < 0.003) discard;
  gl_FragColor = vec4(c, 1.0);
}`;

export class Eyes {
  constructor(scene, { max = 4096, size = 0.016, minPx = 2.4, halo = 9, gain = 1 } = {}) {
    this.max = max * 2; this.n = 0;
    const g = this.geometry = new THREE.BufferGeometry();
    this.P = new Float32Array(this.max * 3); this.O = new Float32Array(this.max); this.Cc = new Float32Array(this.max * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.P, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aOpen', new THREE.BufferAttribute(this.O, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.Cc, 3).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 1000 }, uSize: { value: size }, uMinPx: { value: minPx }, uHalo: { value: halo }, uGain: { value: gain } } });
    this.points = new THREE.Points(g, this.material); this.points.frustumCulled = false; this.points.renderOrder = 10; scene.add(this.points);
    this._c = new THREE.Color();
  }
  begin() { this.n = 0; return this; }
  one(p, open = 1, col = '#ffffff') {
    if (this.n >= this.max || open <= 0.001) return this; const i = this.n++, c = typeof col === 'string' ? this._c.set(col) : col;
    this.P[i * 3] = p.x; this.P[i * 3 + 1] = p.y; this.P[i * 3 + 2] = p.z; this.O[i] = Math.min(1.5, open); this.Cc[i * 3] = c.r; this.Cc[i * 3 + 1] = c.g; this.Cc[i * 3 + 2] = c.b; return this;
  }
  pair(L, R, open = 1, col = '#ffffff') { return this.one(L, open, col).one(R, open, col); }
  end(camera, viewH = 1920) {
    const g = this.geometry; g.setDrawRange(0, this.n);
    for (const k of ['position', 'aOpen', 'aCol']) g.attributes[k].needsUpdate = true;
    this.material.uniforms.uScale.value = viewH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    return this;
  }
  set gain(v) { this.material.uniforms.uGain.value = v; }
  // a people.js person's eyes (after folk.update): the head frame is the neck top, +y up the face, +z forward
  static ofPeople(folk, id, out = [new THREE.Vector3(), new THREE.Vector3()]) {
    const m = folk.head(id); if (!m) return null;
    out[0].set(0.026, 0.077, 0.104).applyMatrix4(m); out[1].set(-0.026, 0.077, 0.104).applyMatrix4(m); return out;
  }
  // a hero.js figure's eyes (the bind eye centres carried by the head bone), a little in front of the cornea
  static ofHero(h, out = [new THREE.Vector3(), new THREE.Vector3()]) {
    h.group.updateMatrixWorld(true); const I = h.idx.head, B = h.bones[I], c = h.head0[I];
    out[0].copy(h.eyeL).sub(c).add(new THREE.Vector3(0, 0, 0.012)).applyMatrix4(B.matrixWorld);
    out[1].copy(h.eyeR).sub(c).add(new THREE.Vector3(0, 0, 0.012)).applyMatrix4(B.matrixWorld);
    return out;
  }
}
