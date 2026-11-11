// REGISTERS (MODELING c3): one lit maquette, printed three ways from the same G-buffer (colour, depth, normal).
//   R0  the lit maquette as rendered (PBR steel, overcast sky, haze)
//   R1  painted realist: a Kuwahara paint filter that turns the plate texture into brushwork, wet-edge darkening where the colour
//       changes, a line that is not an outline but the painter's darker accent (its weight falls with depth and it wobbles, redrawn
//       on twos when animated, after the Iron Giant's 'Gartoons': varying, textured line so a CG body sits with a drawn world),
//       warm paper-and-canvas ground, grime pooled in cavities (from the normal and depth Laplacian)
//   R2  the party's poster register (the REBUILD THE COUNTRY / RED AMERICA family): the lit image as a 45-degree halftone in black
//       ink on warm paper, ink line, the one red kept as flat ACP red, the sky as paper or as a red field
// Options: render(scene, cam, { register, t, boil, field: 'paper'|'red', dot, paint }).
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
THREE.ColorManagement.enabled = false;

const VS = `out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;
const COMMON = `
precision highp float; in vec2 vUv; out vec4 fragColor;
uniform sampler2D BEAU, DEPTH, NORM; uniform vec2 PX; uniform float NEAR, FAR, T, S, BOIL;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = .5, s = 0.; for(int i=0;i<4;i++){ s += a*vn(p); p = p*2.03 + 7.1; a *= .5; } return s; }
float luma(vec3 c){ return dot(c, vec3(.299,.587,.114)); }
float lin(float d){ return NEAR * FAR / (FAR - d * (FAR - NEAR)); }
float zAt(vec2 uv){ return lin(texture(DEPTH, uv).r); }
// line strength at uv: x silhouette (depth break, relative), y crease (normal change)
vec2 lines(vec2 uv, float r){
  float z0 = zAt(uv); vec3 n0 = texture(NORM, uv).xyz * 2. - 1.; float sil = 0., cr = 0.;
  for (int k = 0; k < 8; k++) { float a = float(k) * .785398; vec2 d = vec2(cos(a), sin(a)) * r * PX; float z1 = zAt(uv + d); vec3 n1 = texture(NORM, uv + d).xyz * 2. - 1.;
    float rel = abs(z1 - z0) / max(.5, min(z0, z1)); sil = max(sil, smoothstep(.012, .05, rel)); cr = max(cr, smoothstep(.25, .7, 1. - dot(n0, n1)) * step(z0, 700.)); }
  return vec2(sil, cr);
}`;
const FS_R1 = `${COMMON}
uniform float RAD, WOB, PAPERK;
void main(){
  vec2 uv = vUv; float z = zAt(uv);
  // brush wobble: the picture is sampled through a slow noise field (quantised in time: twos)
  float tt = floor(T * 12. * BOIL) / 12.;
  vec2 w = (vec2(fbm(uv * 90. + tt), fbm(uv * 90. + 17. - tt)) - .5) * PX * WOB * 4.;
  // generalised Kuwahara: four quadrants, take the mean of the calmest
  vec3 m0 = vec3(0), m1 = vec3(0), m2 = vec3(0), m3 = vec3(0), s0 = vec3(0), s1 = vec3(0), s2 = vec3(0), s3 = vec3(0); float n = 0.;
  int R = int(RAD);
  for (int j = -R; j <= 0; j++) for (int i = -R; i <= 0; i++) { vec3 c = texture(BEAU, uv + w + vec2(i, j) * PX).rgb; m0 += c; s0 += c * c; n += 1.; }
  for (int j = -R; j <= 0; j++) for (int i = 0; i <= R; i++) { vec3 c = texture(BEAU, uv + w + vec2(i, j) * PX).rgb; m1 += c; s1 += c * c; }
  for (int j = 0; j <= R; j++) for (int i = -R; i <= 0; i++) { vec3 c = texture(BEAU, uv + w + vec2(i, j) * PX).rgb; m2 += c; s2 += c * c; }
  for (int j = 0; j <= R; j++) for (int i = 0; i <= R; i++) { vec3 c = texture(BEAU, uv + w + vec2(i, j) * PX).rgb; m3 += c; s3 += c * c; }
  m0 /= n; m1 /= n; m2 /= n; m3 /= n; s0 = abs(s0 / n - m0 * m0); s1 = abs(s1 / n - m1 * m1); s2 = abs(s2 / n - m2 * m2); s3 = abs(s3 / n - m3 * m3);
  float v0 = s0.r + s0.g + s0.b, v1 = s1.r + s1.g + s1.b, v2 = s2.r + s2.g + s2.b, v3 = s3.r + s3.g + s3.b;
  vec3 c = m0; float mv = v0; if (v1 < mv) { mv = v1; c = m1; } if (v2 < mv) { mv = v2; c = m2; } if (v3 < mv) { mv = v3; c = m3; }
  // paint: slight saturation pull, warm lights and cool shadows (a painter's key), contrast
  float L = luma(c); c = mix(vec3(L), c, .82); c = mix(c * vec3(.9, .95, 1.06), c * vec3(1.06, 1.02, .94), smoothstep(.25, .75, L));
  c = (c - .5) * 1.1 + .5;
  // line: weight falls with distance (a 2.4 px line at the giant's feet, under 1 px at the horizon), wobbles; it darkens the paint, it does not outline
  float lw = mix(2.6, .8, smoothstep(30., 420., z)) * S;
  vec2 ln = lines(uv + w * .6, lw);
  float lm = .55 + .45 * fbm(uv * 60. + tt);
  c *= 1. - (ln.x * .62 + ln.y * .3) * lm;
  // wet edge: pigment pools where the paint colour changes
  float e = clamp(abs(L - luma(texture(BEAU, uv + vec2(3., 0.) * PX * S).rgb)) * 3., 0., 1.); c *= 1. - e * .12;
  // grime in cavities: the crease term at a wider radius darkens the paint
  c *= 1. - lines(uv, lw * 3.).y * .12;
  // canvas weave and pigment grain; the paper shows slightly in the lights
  float weave = (fbm(uv * vec2(420., 380.)) - .5) * .06 + (vn(uv * 900.) - .5) * .03;
  c += weave * PAPERK; c = mix(c, c * vec3(1.03, 1., .93), .5);
  fragColor = vec4(clamp(c, 0., 1.), 1.);
}`;
const FS_R2 = `${COMMON}
uniform float DOT, FIELD, ANG;
uniform vec3 PAPER, INK, RED;
void main(){
  vec2 uv = vUv; vec3 col = texture(BEAU, uv).rgb; float z = zAt(uv); float L = luma(col);
  bool sky = z > 700.;
  float isRed = step(.42, col.r) * step(col.g * 1.9, col.r) * step(col.b * 1.9, col.r);
  // tone: lift and crush so the halftone has a shape (posters are high contrast)
  float tone = clamp((L - .1) * 1.35, 0., 1.); tone = pow(tone, .85);
  vec2 px = uv / PX; float a = ANG; mat2 Rm = mat2(cos(a), -sin(a), sin(a), cos(a)); vec2 g = Rm * px / DOT; vec2 f = fract(g) - .5; float d = length(f);
  float rad = sqrt(1. - tone) * .62; float inkDot = 1. - smoothstep(rad - .06, rad + .06, d);
  // line: heavier than R1, from the same G-buffer
  float lw = mix(2.4, 1.2, smoothstep(30., 420., z)) * S; vec2 ln = lines(uv, lw); float line = max(ln.x, ln.y * .8);
  vec3 o = mix(PAPER, INK, inkDot);
  if (sky) {
    if (FIELD > .5) { // a red field with a halftone fall-off to black at the top (RED AMERICA / REBUILD): dots grow with height
      float up = smoothstep(.55, 1., 1. - uv.y); float r2 = up * .45; float dd = 1. - smoothstep(r2 - .05, r2 + .05, d); o = mix(RED, INK, dd * step(.02, up)); }
    else { float sk = .94 - .25 * (1. - uv.y); float rd = sqrt(max(0., 1. - sk)) * .5; o = mix(PAPER, INK, (1. - smoothstep(rd - .06, rd + .06, d)) * .75); }
  }
  // the one red: the mark is kept flat ACP red (cream where the field is red, so it still reads)
  if (isRed > .5 && !sky) o = FIELD > .5 ? vec3(.96, .91, .82) : RED;
  o = mix(o, INK, line * (isRed > .5 ? .0 : .95));
  // paper tooth and a slight misregistration of the ink (a press)
  o *= .96 + .04 * vn(uv * 800.); fragColor = vec4(o, 1.);
}`;

export class Registers {
  constructor(renderer, W, H) {
    this.r = renderer; this.W = W; this.H = H;
    this.mk(); this.q1 = new FullScreenQuad(null); this.q2 = new FullScreenQuad(null);
    const base = { vertexShader: VS, glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false };
    this.m1 = new THREE.ShaderMaterial({ ...base, fragmentShader: FS_R1, uniforms: { ...this.U(), RAD: { value: 3 }, WOB: { value: 1 }, PAPERK: { value: 1 } } });
    this.m2 = new THREE.ShaderMaterial({ ...base, fragmentShader: FS_R2, uniforms: { ...this.U(), DOT: { value: 6 }, FIELD: { value: 0 }, ANG: { value: .785 }, PAPER: { value: new THREE.Color('#e9e0cc') }, INK: { value: new THREE.Color('#15120f') }, RED: { value: new THREE.Color('#bf1f1f') } } });
    this.nrmMat = new THREE.MeshNormalMaterial({ flatShading: false });
  }
  U() { return { BEAU: { value: null }, DEPTH: { value: null }, NORM: { value: null }, PX: { value: new THREE.Vector2() }, NEAR: { value: .5 }, FAR: { value: 3000 }, T: { value: 0 }, S: { value: 1 }, BOIL: { value: 1 } }; }
  mk() {
    const { W, H } = this; for (const k of ['rt', 'nt']) this[k]?.dispose();
    this.rt = new THREE.WebGLRenderTarget(W, H, { depthTexture: new THREE.DepthTexture(W, H), samples: 4, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.nt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  }
  resize(W, H) { if (W === this.W && H === this.H) return; this.W = W; this.H = H; this.mk(); }
  render(scene, cam, { register = 'R0', t = 0, boil = 1, field = 'paper', dot = null, rad = null } = {}) {
    const r = this.r; if (register === 'R0') { r.setRenderTarget(null); r.render(scene, cam); return; }
    r.setRenderTarget(this.rt); r.render(scene, cam);
    // normals: everything but sprites and the sky dome, with the same camera
    const hid = []; scene.traverse(o => { if ((o.isSprite || o.name === 'sky') && o.visible) { o.visible = false; hid.push(o); } });
    const bg = scene.background, fog = scene.fog, env = scene.environment; scene.overrideMaterial = this.nrmMat; scene.fog = null; scene.environment = null;
    r.setRenderTarget(this.nt); const cc = new THREE.Color(); r.getClearColor(cc); const ca = r.getClearAlpha(); r.setClearColor(0x8080ff, 1); r.render(scene, cam); r.setClearColor(cc, ca);
    scene.overrideMaterial = null; scene.fog = fog; scene.environment = env; scene.background = bg; for (const o of hid) o.visible = true;
    const S = this.H / 960, m = register === 'R1' ? this.m1 : this.m2, q = register === 'R1' ? this.q1 : this.q2;
    for (const mm of [m]) { const u = mm.uniforms; u.BEAU.value = this.rt.texture; u.DEPTH.value = this.rt.depthTexture; u.NORM.value = this.nt.texture; u.PX.value.set(1 / this.W, 1 / this.H); u.NEAR.value = cam.near; u.FAR.value = cam.far; u.T.value = t; u.S.value = S; u.BOIL.value = boil; }
    if (register === 'R1') m.uniforms.RAD.value = rad ?? Math.max(2, Math.round(3 * S));
    else { m.uniforms.DOT.value = dot ?? 6.5 * S; m.uniforms.FIELD.value = field === 'red' ? 1 : 0; }
    q.material = m; r.setRenderTarget(null); q.render(r);
  }
}
