// PEOPLE'S NATIONAL BANK v5: the burin inside the renderer. Every three.js surface is drawn directly as banknote
// line engraving, not as a grey render dithered afterwards:
//  - line families are sections of the surface by parallel planes anchored in the world, so the cuts wrap round a
//    silo, bend over a nose and converge down a rail bed exactly as an engraver lays them;
//  - the screen pitch stays constant (about 7 px on the vignettes, 4 px on the portrait) by blending two octaves of
//    world spacing, so lines hold still while the camera dollies;
//  - tone (Lambert + shadows + aerial fog) sets the line width; shadows add a second and third crossing family;
//  - skin highlights go to stipple; hot things (the pour, lamps, the lit door) are cut in red ink;
//  - figures get a dark contour and a light rim so the silhouette separates from the ground.
// The output is an ink layer (white stock, black key, #f00 red) that lib/fx/intaglio.js relights as printed relief.
import * as THREE from 'three';
import { W, H } from '../lib/kit.js';

export const U = { uPitch: { value: 7 }, uExpo: { value: 1 }, uGamma: { value: 1 }, uT: { value: 0 }, uDark: { value: 0 } };

const VERT_PARS = `varying vec3 vWP; varying vec3 vOP;\n`;
const VERT_MAIN = `{ vec4 wp_ = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  wp_ = instanceMatrix * wp_;
  #endif
  vWP = (modelMatrix * wp_).xyz; vOP = transformed; }\n`;
const FRAG_PARS = `varying vec3 vWP; varying vec3 vOP;
uniform float uPitch, uExpo, uGamma, uT, uDark, uPm, uSkin, uHot, uRim, uW, uK, uAuto, uObj;
uniform vec3 uA1, uA2, uA3;
float lineC(float u, float w, float aa){ float dd = abs(fract(u + .5) - .5); return 1. - smoothstep(w * .5 - aa, w * .5 + aa, dd); }
float hatchF(float d, float w, float pitch){
  if (w <= 0.001) return 0.;
  float fw = max(fwidth(d), 1e-7), L = log2(fw * pitch), o = floor(L), f = fract(L);
  float s0 = exp2(o), s1 = s0 * 2.;
  float aa0 = max(fw / s0, .02) * .75, aa1 = max(fw / s1, .02) * .75;
  float c0 = lineC(d / s0, w, aa0), c1 = lineC(d / s1, w, aa1);
  return mix(c0, c1, smoothstep(.15, .85, f));
}
float h21(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float stip(vec2 p, float tone, float pitch){
  vec2 g = p / pitch; g.x += .5 * mod(floor(g.y), 2.); vec2 c = floor(g) + .5; vec2 j = (vec2(h21(c), h21(c + 7.1)) - .5) * .5;
  float r = sqrt(clamp(tone, 0., 1.)) * .56; float d = length(g - c - j);
  return 1. - smoothstep(r - .08, r + .08, d);
}
`;
const FRAG_MAIN = `
  float lum = dot(gl_FragColor.rgb, vec3(.299, .587, .114));
  float tone = clamp(1. - lum * uExpo, 0., 1.);
  tone = clamp(pow(tone, uGamma) * uK + uDark, 0., 1.);
  vec3 nW = normalize(inverseTransformDirection(normal, viewMatrix));
  vec3 P = uObj > .5 ? vOP : vWP, P1 = P, a1 = uA1;
  if (uAuto > .5 && abs(nW.y) > .72) { P1 = vWP; a1 = vec3(0., 0., 1.); }
  float pitch = uPitch * uPm;
  float w1 = clamp(tone * 1.05, 0., .78) * uW;
  float c = hatchF(dot(P1, a1), w1, pitch);
  float w2 = smoothstep(.42, 1., tone) * .6 * uW;
  c = max(c, hatchF(dot(P, uA2), w2, pitch * 1.08));
  float w3 = smoothstep(.72, 1., tone) * .55 * uW;
  c = max(c, hatchF(dot(P, uA3), w3, pitch * 1.15));
  if (uSkin > .5) { float s = stip(gl_FragCoord.xy, tone * 1.1, pitch * .9); c = mix(s, c, smoothstep(.2, .42, tone)); }
  if (uRim > .5) {
    float fac = abs(dot(normal, normalize(vViewPosition)));
    c *= smoothstep(.16, .34, fac);
    c = max(c, 1. - smoothstep(.05, .13, fac));
  }
  if (uHot > .5) {                     // white-hot core, red lines thickening toward the edges, a red keyline at the rim
    float fac = abs(dot(normal, normalize(vViewPosition)));
    float ed = 1. - smoothstep(.25, .9, fac);
    float hc = max(hatchF(dot(vWP, a1), .15 + .55 * ed, pitch * .7), hatchF(dot(vWP, uA2), .5 * ed, pitch * .7));
    hc = max(hc, 1. - smoothstep(.08, .2, fac));
    gl_FragColor = vec4(1., 1. - hc, 1. - hc, 1.); }
  else gl_FragColor = vec4(vec3(1. - c), 1.);
`;

const nz = v => new THREE.Vector3(...v).normalize();
// o: { a1:[x,y,z] first family (default up: horizontal sections); auto (default true): faces that look up or down
//      switch to depth sections in world space; obj: sections in the mesh's own frame (rings round a limb, a boiler),
//      a2, a3, pm: pitch multiplier, skin, hot, rim, w: width gain, k: tone gain, vcol, side }
export function mat(color, o = {}) {
  const m = new THREE.MeshLambertMaterial({ color, vertexColors: !!o.vcol, side: o.side ?? THREE.FrontSide });
  if (o.emissive) m.emissive = new THREE.Color(o.emissive);
  return patch(m, o);
}
// cut any lit three.js material (Lambert, Standard, or one another module already patched, such as lib/fx/people.js)
// with the burin: its own onBeforeCompile runs first, then the engraving takes its final colour
export function patch(m, o = {}) {
  if (m.userData.eng) return m;
  const u = { uPm: { value: o.pm ?? 1 }, uSkin: { value: o.skin ? 1 : 0 }, uHot: { value: o.hot ? 1 : 0 }, uRim: { value: o.rim ? 1 : 0 }, uObj: { value: o.obj ? 1 : 0 }, uW: { value: o.w ?? 1 },
    uK: { value: o.k ?? 1 }, uAuto: { value: o.auto === false ? 0 : 1 }, uA1: { value: nz(o.a1 || [0, 1, 0]) }, uA2: { value: nz(o.a2 || [0.62, 0.55, 0.56]) }, uA3: { value: nz(o.a3 || [-0.7, 0.45, 0.55]) } };
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev.call(m, sh, r);
    Object.assign(sh.uniforms, U, u);
    sh.vertexShader = VERT_PARS + sh.vertexShader.replace('#include <fog_vertex>', '#include <fog_vertex>\n' + VERT_MAIN);
    sh.fragmentShader = FRAG_PARS + sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n' + FRAG_MAIN);
  };
  const base = prevKey && prevKey !== THREE.Material.prototype.customProgramCacheKey ? prevKey.call(m) : m.type;
  m.customProgramCacheKey = () => 'eng-' + base + (o.vcol ? 'v' : '');
  m.userData.eng = u; m.needsUpdate = true;
  return m;
}

// the engraver's sky: ruled horizontal lines, closer and heavier toward the zenith, torn cloud banks where the ruling
// breaks and bends; drawn in screen space so the rule stays level while the camera moves
export function skyMat({ top = 0.62, horizon = 0.08, clouds = 1 } = {}) {
  return new THREE.ShaderMaterial({ side: THREE.BackSide, fog: false, depthWrite: false, uniforms: { ...U, uTop: { value: top }, uHor: { value: horizon }, uCl: { value: clouds } },
    vertexShader: `varying vec3 vd; void main(){ vd = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `varying vec3 vd; uniform float uPitch, uTop, uHor, uCl, uT;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 5; i++){ v += a * n(p); p *= 2.03; a *= .5; } return v; }
      float lineC(float u, float w, float aa){ float dd = abs(fract(u + .5) - .5); return 1. - smoothstep(w * .5 - aa, w * .5 + aa, dd); }
      void main(){ float y = max(vd.y, 0.);
        float tone = mix(uHor, uTop, smoothstep(0., .75, y));
        vec2 cp = vd.xz / (vd.y + .15) * 1.4; float cl = fbm(cp * vec2(1., 2.4) + 3.1);
        float bank = smoothstep(.5, .7, cl) * smoothstep(.02, .14, y) * uCl;
        tone = mix(tone, .02, bank * .9);
        float rim = smoothstep(.62, .7, cl) * (1. - smoothstep(.7, .8, cl)) * smoothstep(.04, .2, y) * uCl;
        vec2 p = gl_FragCoord.xy; float wave = 2.2 * sin(p.x * .006 + cl * 6.);
        float c = lineC((p.y + wave) / (uPitch * 1.05), tone * .9, .12);
        c = max(c, rim * .85 * lineC((p.y + p.x * .35) / (uPitch * .9), .35, .12));
        gl_FragColor = vec4(vec3(1. - c), 1.); }` });
}

// a black inverted hull: the contour line an engraver cuts round a figure (scale in metres of offset)
export function outline(mesh, px = 0.012) {
  const m = new THREE.Mesh(mesh.geometry, new THREE.ShaderMaterial({ side: THREE.BackSide, uniforms: { e: { value: px } },
    vertexShader: `uniform float e; void main(){ vec3 p = position + normal * e; vec4 mv = modelViewMatrix * vec4(p, 1.);
      #ifdef USE_INSTANCING
      mv = modelViewMatrix * instanceMatrix * vec4(p, 1.);
      #endif
      gl_Position = projectionMatrix * mv; }`, fragmentShader: `void main(){ gl_FragColor = vec4(0., 0., 0., 1.); }` }));
  m.castShadow = false; m.receiveShadow = false; m.userData.outline = 1;
  return m;
}

// the shared full-resolution renderer the scenes draw into
export const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
export function draw(g, scene, cam, { pitch = 7, expo = 1, gamma = 1, dark = 0, x = 0, y = 0, w = W, h = H } = {}) {
  U.uPitch.value = pitch; U.uExpo.value = expo; U.uGamma.value = gamma; U.uDark.value = dark;
  renderer.setClearColor(0xffffff, 1); renderer.render(scene, cam);
  g.drawImage(renderer.domElement, x, y, w, h);
}
export { THREE };
