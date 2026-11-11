// STAGE / contact: where a figure meets the ground. A ground-occlusion map made from the people's own DRAWN geometry (whatever their
// shaders do: skinning, the stance, cloth), cheap enough to remake every frame:
//   1. two orthographic renders of the people only, through the LIGHT pipeline's own prepass (light/patch.js: each patched material
//      writes 1/view-depth), one from under the floor looking up (the LOWEST surface over each ground point: soles, hems, hands)
//      and one from above looking down (the HIGHEST: the top of each column)
//   2. one full-screen pass over the footprint: each ground point looks out along 12 azimuths to R (0.45 m) and takes, per azimuth,
//      the cosine-weighted share of the sky hidden by the columns it meets (a column from height a to b at distance r hides
//      sin^2(atan(b/r)) - sin^2(atan(a/r)) of that azimuth), i.e. horizon-based AO on a height-field pair; then a small blur.
// The ground material multiplies its INDIRECT light (sky, environment) by it (grounds.js). Lamps and the sun are shadowed by their
// shadow maps and the pipeline's screen-space contact shadows; this is the soft dark ring a foot sits in under any light,
// overcast included, and it does not depend on the camera or the screen resolution.
//   const C = new ContactMap(renderer); C.update(scene, [P.h.group, ...]);   // C.texture, C.box (x0, z1, width, depth)
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { LIT, prepassHide } from '../light/patch.js';

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const AO = /* glsl */`
varying vec2 vUv; uniform sampler2D tLow, tHigh; uniform mat4 uLowPV, uHighPV; uniform vec4 uBox; uniform float uR, uLowY, uHighY, uK;
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec2 uvOf(mat4 M, vec2 xz){ vec4 c = M * vec4(xz.x, 0.0, xz.y, 1.0); return c.xy / c.w * 0.5 + 0.5; }
void main(){
  vec2 p = vec2(uBox.x + vUv.x * uBox.z, uBox.y - vUv.y * uBox.w);
  float j = ign(gl_FragCoord.xy), occ = 0.0; const int NA = 12, NS = 14;
  for (int a = 0; a < NA; a++) {
    float ang = (float(a) + j) / float(NA) * 6.2831853; vec2 d = vec2(cos(ang), sin(ang)); float best = 0.0;
    for (int s = 0; s < NS; s++) {
      float t = (float(s) + 0.5 + 0.45 * fract(j * 7.31 + float(s) * 0.618)) / float(NS), r = uR * t * t + 0.004;
      vec2 q = p + d * r;
      float al = texture2D(tLow, uvOf(uLowPV, q)).a; if (al <= 0.0) continue;
      float ah = texture2D(tHigh, uvOf(uHighPV, q)).a;
      float lo = max(0.0, 1.0 / al + uLowY), hi = ah > 0.0 ? max(lo + 0.01, uHighY - 1.0 / ah) : lo + 0.05;
      float sl = lo * lo / (lo * lo + r * r), sh = hi * hi / (hi * hi + r * r);
      best = max(best, (sh - sl) * (1.0 - smoothstep(0.55, 1.0, r / uR)));
    }
    occ += best;
  }
  gl_FragColor = vec4(clamp(1.0 - uK * occ / float(NA), 0.0, 1.0), 0.0, 0.0, 1.0);
}`;
const BLUR = /* glsl */`
varying vec2 vUv; uniform sampler2D tIn; uniform vec2 uTexel;
void main(){ float s = 0.0, w = 0.0; for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) { float k = exp(-float(x * x + y * y) / 4.5); s += texture2D(tIn, vUv + vec2(x, y) * uTexel).r * k; w += k; }
  gl_FragColor = vec4(s / w, 0.0, 0.0, 1.0); }`;

export class ContactMap {
  // texel: metres per texel (the map is capped at maxRes on its long side); radius: how far a foot darkens the floor (m)
  constructor(renderer, { texel = 0.004, maxRes = 2048, radius = 0.45, strength = 1, margin = 0.15, low = 1.0, high = 3.0 } = {}) {
    this.r = renderer; Object.assign(this, { texel, maxRes, radius, strength, margin, lowY: low, highY: high });
    this.box = new THREE.Vector4(0, 0, 1, 1);
    const one = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); one.needsUpdate = true; this.blank = one;
    this.texture = one; this.ms = 0; this.n = 0;
    this.aoQ = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: AO, uniforms: { tLow: { value: null }, tHigh: { value: null }, uLowPV: { value: new THREE.Matrix4() }, uHighPV: { value: new THREE.Matrix4() }, uBox: { value: this.box }, uR: { value: radius }, uLowY: { value: -low }, uHighY: { value: high }, uK: { value: strength } } }));
    this.blurQ = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: BLUR, uniforms: { tIn: { value: null }, uTexel: { value: new THREE.Vector2() } } }));
  }
  _rt(name, w, h, o = {}) { const r = this[name]; if (r && r.width === w && r.height === h) return r; r?.dispose();
    return (this[name] = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, format: THREE.RGBAFormat, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, depthBuffer: true, ...o })); }
  // roots: the people (Object3Ds). bounds: optional THREE.Box3 of the footprint (default: the roots' boxes below 0.6 m, + radius)
  update(scene, roots, { bounds = null } = {}) {
    const t0 = performance.now(), r = this.r;
    roots = roots.filter(o => o && o.visible !== false); if (!roots.length) { this.texture = this.blank; return this; }
    let B = bounds;
    if (!B) { B = new THREE.Box3(); for (const o of roots) { o.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(o); b.max.y = Math.min(b.max.y, 0.6); B.union(b); } }
    const pad = this.radius + this.margin, x0 = B.min.x - pad, x1 = B.max.x + pad, z0 = B.min.z - pad, z1 = B.max.z + pad;
    const tx = Math.max(this.texel, Math.max(x1 - x0, z1 - z0) / this.maxRes), nx = Math.max(8, Math.ceil((x1 - x0) / tx)), nz = Math.max(8, Math.ceil((z1 - z0) / tx));
    this.box.set(x0, z1, nx * tx, nz * tx);
    const cx = x0 + nx * tx / 2, cz = z1 - nz * tx / 2, hw = nx * tx / 2, hd = nz * tx / 2;
    const camLow = new THREE.OrthographicCamera(-hw, hw, hd, -hd, 0.01, this.lowY + 3.5), camHigh = new THREE.OrthographicCamera(-hw, hw, hd, -hd, 0.01, this.highY + 0.5);
    camLow.up.set(0, 0, -1); camLow.position.set(cx, -this.lowY, cz); camLow.lookAt(cx, 1, cz); camLow.updateMatrixWorld(true);
    camHigh.up.set(0, 0, -1); camHigh.position.set(cx, this.highY, cz); camHigh.lookAt(cx, -1, cz); camHigh.updateMatrixWorld(true);
    const low = this._rt('rtLow', nx, nz), high = this._rt('rtHigh', nx, nz), ao = this._rt('rtAO', nx, nz, { type: THREE.HalfFloatType, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, depthBuffer: false }),
      ao2 = this._rt('rtAO2', nx, nz, { type: THREE.HalfFloatType, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, depthBuffer: false });
    // only the people, through the prepass
    const keep = new Set(), hidden = []; for (const o of roots) { let p = o; while (p) { keep.add(p); p = p.parent; } }
    const isUnder = o => { let p = o; while (p) { if (roots.includes(p)) return true; p = p.parent; } return false; };
    scene.traverse(o => { if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && o.visible && !isUnder(o)) { hidden.push(o); o.visible = false; } });
    const restore = prepassHide(scene), bg = scene.background, sh = r.shadowMap.autoUpdate, savedRT = r.getRenderTarget(), cc = new THREE.Color(), ca = r.getClearAlpha(); r.getClearColor(cc);
    const pre = LIT.uLitPre.value, on = LIT.uLitOn.value, pt = LIT.uLitPreT.value;
    try {
      scene.background = null; r.shadowMap.autoUpdate = false; LIT.uLitPre.value = 1; LIT.uLitOn.value = 0; LIT.uLitPreT.value = null;
      r.setClearColor(0x000000, 0);
      r.setRenderTarget(low); r.clear(); r.render(scene, camLow);
      r.setRenderTarget(high); r.clear(); r.render(scene, camHigh);
    } finally {
      LIT.uLitPre.value = pre; LIT.uLitOn.value = on; LIT.uLitPreT.value = pt; restore(); scene.background = bg; r.shadowMap.autoUpdate = sh;
      for (const o of hidden) o.visible = true;
    }
    const U = this.aoQ.material.uniforms;
    U.tLow.value = low.texture; U.tHigh.value = high.texture; U.uLowPV.value.multiplyMatrices(camLow.projectionMatrix, camLow.matrixWorldInverse); U.uHighPV.value.multiplyMatrices(camHigh.projectionMatrix, camHigh.matrixWorldInverse);
    U.uR.value = this.radius; U.uK.value = this.strength;
    r.setRenderTarget(ao); this.aoQ.render(r);
    this.blurQ.material.uniforms.tIn.value = ao.texture; this.blurQ.material.uniforms.uTexel.value.set(1 / nx, 1 / nz);
    r.setRenderTarget(ao2); this.blurQ.render(r);
    r.setRenderTarget(savedRT); r.setClearColor(cc, ca);
    this.texture = ao2.texture; this.size = [nx, nz]; this.ms = Math.round(performance.now() - t0); this.n++;
    return this;
  }
  // read the map back (node tests, the notes): Float32 of nx * nz, row 0 = the near edge (+z, the camera side), x left to right
  read() { const [nx, nz] = this.size || [0, 0]; if (!nx) return null; const b = new Uint16Array(nx * nz * 4); this.r.readRenderTargetPixels(this.rtAO2, 0, 0, nx, nz, b);
    const f = new Float32Array(nx * nz); for (let i = 0; i < nx * nz; i++) f[i] = THREE.DataUtils.fromHalfFloat(b[i * 4]); return { nx, nz, data: f }; }
  dispose() { for (const k of ['rtLow', 'rtHigh', 'rtAO', 'rtAO2']) this[k]?.dispose(); this.aoQ.material.dispose(); this.blurQ.material.dispose(); }
}
