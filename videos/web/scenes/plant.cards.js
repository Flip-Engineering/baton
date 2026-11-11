// THE PLANT THAT WOULD NOT DIE: the cards. Each revealed picture is a Master Hands plate in this piece's own print, the NIGHT PRINT: the
// film's own continuous tone through a hard black-and-white curve (black point, white point, gamma per card: the line pushed dark, the
// machines kept to their highlights), lit only by the matte (no halftone, no copy generations, no other series' medium), on a card
// standing at its station's depth (matte.js practice), drawn in the matte's OVER scene. LightMatte.reveal shows a card only where the light (or its own highlights, or its persist) reveals it and where nothing of the
// set stands in front of it, so the camera's drift parallaxes with the set.
//   the persist is world-space: each card carries an accumulator in its own uv (how much of it the torch has found: torch.illum at each
//   texel's world position, max over time), written into the card's alpha as 0.5 + 0.5 p (LightMatte.reveal persistA). It is filled at
//   the frame times k / 30 from a shot's start, so a render begun anywhere replays it exactly.
import * as THREE from 'three';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const CARD_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const CARD_FS = `uniform sampler2D tPlate, tAcc; uniform float uLit, uAccOn, uAspect; uniform vec4 uCoin; uniform vec3 uCurve; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tPlate, vUv).rgb;                                   // linear (the plate is sRGB)
  float l = pow(max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0), 1.0 / 2.2);
  l = pow(clamp((l - uCurve.x) / max(uCurve.y - uCurve.x, 1e-3), 0.0, 1.0), uCurve.z);    // the night print
  c = vec3(pow(l, 2.2)); vec2 d = (vUv - uCoin.xy) * vec2(uAspect, 1.0);
  float coin = uCoin.w * exp(-dot(d, d) / max(uCoin.z * uCoin.z, 1e-6));
  float acc = uAccOn > 0.5 ? texture2D(tAcc, vUv).r : 1.0;
  gl_FragColor = vec4(c * max(uLit, coin) + vec3(0.92, 0.94, 1.0) * coin * 0.3, 0.5 + 0.5 * acc);
}`;
export const CARD_GLSL = { vertex: { CARD_VS }, fragment: { CARD_FS } };
// the night print: [black point, white point, gamma] on the film's luma (display), per card
export const NIGHT = { line: [0.1, 0.84, 1.18], machine: [0.3, 0.9, 1.7], window: [0.06, 0.88, 1.05] };

export class Card {
  // o: { plate, w, pos: [x, y, z], face: 'z' | [x, y, z] (a point it turns to), off (s into the plate), rate, acc: [rx, ry] | null, px: canvas width, curve }
  constructor(scene, o) {
    Object.assign(this, { plate: o.plate, off: o.off || 0, rate: o.rate ?? 1, name: o.name || o.plate });
    const cw = o.px || 540, ch = Math.round(cw * 16 / 9);
    this.cv = document.createElement('canvas'); this.cv.width = cw; this.cv.height = ch; this.ctx = this.cv.getContext('2d');
    this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, cw, ch);
    this.tex = new THREE.CanvasTexture(this.cv); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.generateMipmaps = false; this.tex.minFilter = THREE.LinearFilter;
    this.w = o.w; this.h = o.w * 16 / 9;
    const [rx, ry] = o.acc || [1, 1]; this.rx = rx; this.ry = ry; this.acc = new Float32Array(rx * ry); this.accData = new Uint8Array(rx * ry * 4).fill(255);
    for (let i = 0; i < rx * ry; i++) this.accData[i * 4] = 0;
    this.accTex = new THREE.DataTexture(this.accData, rx, ry, THREE.RGBAFormat, THREE.UnsignedByteType); this.accTex.magFilter = this.accTex.minFilter = THREE.LinearFilter; this.accTex.needsUpdate = true;
    this.U = { tPlate: { value: this.tex }, tAcc: { value: this.accTex }, uLit: { value: 1 }, uAccOn: { value: o.acc ? 1 : 0 }, uAspect: { value: this.w / this.h }, uCoin: { value: new THREE.Vector4(0, 0, 0.1, 0) }, uCurve: { value: new THREE.Vector3(...(o.curve || NIGHT.line)) } };
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(this.w, this.h), new THREE.ShaderMaterial({ vertexShader: CARD_VS, fragmentShader: CARD_FS, uniforms: this.U }));
    this.mesh.position.set(...o.pos); if (Array.isArray(o.face)) this.mesh.lookAt(...o.face); this.mesh.frustumCulled = true; this.mesh.visible = false;
    scene.add(this.mesh); this.mesh.updateMatrixWorld(true);
    this._P = null; this._key = null; this.accT = -1; this.accMax = 0;
  }
  // texel centres in world space (after the card is placed)
  texels() {
    if (this._P) return this._P; const out = [], M = this.mesh.matrixWorld;
    for (let j = 0; j < this.ry; j++) for (let i = 0; i < this.rx; i++) out.push(new THREE.Vector3(((i + 0.5) / this.rx - 0.5) * this.w, ((j + 0.5) / this.ry - 0.5) * this.h, 0).applyMatrix4(M));
    return (this._P = out);
  }
  resetAcc() { this.accMax = 0; this.acc.fill(0); for (let i = 0; i < this.acc.length; i++) this.accData[i * 4] = 0; this.accTex.needsUpdate = true; this.accT = -1; }
  // fold one moment of light in: reveal(p) -> 0..1 at a world point
  accumulate(reveal) {
    const P = this.texels(); let ch = false;
    for (let i = 0; i < P.length; i++) { if (this.acc[i] >= 1) continue; const v = reveal(P[i]); if (v > this.acc[i]) { this.acc[i] = v; this.accData[i * 4] = Math.round(255 * clamp(v)); ch = true; if (v > this.accMax) this.accMax = v; } }
    if (ch) this.accTex.needsUpdate = true;
  }
  // can this light reach the card now (a coarse grid of its texels against the profile and the distance, no ray test)
  litBy(torch, floor = 0.12) { if (!(torch.k > 0)) return false; const P = this.texels(); for (let i = 0; i < P.length; i += 5) if (torch.illum(P[i], { test: false }) >= floor) return true; return false; }
  inView(frustum) { this.mesh.updateMatrixWorld(); if (!this.mesh.geometry.boundingSphere) this.mesh.geometry.computeBoundingSphere(); return frustum.intersectsObject(this.mesh); }
  frameAt(reel, t) { const n = reel.n(this.plate), fps = reel.idx[this.plate]?.fps || 24; const i = Math.floor((this.off + t * this.rate) * fps + 1e-6); return ((i % n) + n) % n; }
  // draw this frame of the plate onto the card (once per plate frame)
  async print(reel, t) {
    const i = this.frameAt(reel, t), key = String(i);
    if (key === this._key) return false; this._key = key;
    const bm = await reel.frame(this.plate, i);
    this.ctx.drawImage(bm, 0, 0, this.cv.width, this.cv.height); this.tex.needsUpdate = true; return true;
  }
}
// the reveal a torch gives one texel (the matte's knee and edge; no ray test: the persist is what the light has found)
export const revealBy = (torch, knee = 0.15, edge = 0.04) => p => { const l = torch.illum(p, { test: false }); return l <= 0 ? 0 : sstep(knee - edge, knee + edge, l); };
