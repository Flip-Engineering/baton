// ENGRAVE: banknote / intaglio line engraving as a three.js material patch, so a lit 3D figure or machine renders
// directly as an engraved plate: line families wrap the form (they are cross-sections of the object by parallel planes,
// in the object's own space, so they slide with the surface as it turns instead of swimming in screen space), swell
// with shadow, cross-hatch in the half-tones, add a third family and dot-and-lozenge stipple in the deepest darks,
// break into flicks in the lights, and fall back to flat tone where lines would alias. One accent ink keeps whatever
// was strongly red in the lit colour (a hard-hat dot, a flag), so "one red" survives the medium.
//
//   import { engraveMaterial, engravePeople, plateBackground } from '../lib/fx/engrave.js';
//   const eng = engravePeople(folk, { lpm: 380, paper: '#efe6cf', ink: '#1a1712', accent: '#b3161b' });
//   engraveMaterial(mesh.material, { lpm: 120 });                         // any lit MeshStandard/Physical material
//   plateBackground(passes, { ... })                                       // the lathe-work oval frame (glfx Passes), drawn first
//   eng.set({ exposure: 1.6 })                                             // live
//
// References: Ostromoukhov, "Digital Facial Engraving" (SIGGRAPH 1999): threshold a tone against a line "copperplate"
// whose lines follow a 3D proxy; Leister (1994) and Praun et al., "Real-time hatching" (SIGGRAPH 2001) for tone-mapped
// hatching on 3D; banknote practice (BEP) for swelling lines, cross-hatch at 30-60 degrees, dot-and-lozenge in the darks.
// The tone is taken from the material's own lighting, so the scene's lights are the engraver's light.
import * as THREE from 'three';

const DEF = { lpm: 360, paper: '#efe6cf', ink: '#1a1712', accent: null, exposure: 1.5, gamma: 0.85, outline: 0.8, wobble: 0.25, flick: 1, stipple: 1,
  dirs: [[0.12, 1, 0.1], [0.85, 0.4, 0.45], [-0.55, 0.55, 0.65]], plate: 0.05, flatten: 0.6 };
const lin = c => { const k = new THREE.Color(c); return new THREE.Vector3(k.r, k.g, k.b); };   // THREE.Color is linear already

function uniforms(o) {
  const U = { egFlat: { value: 0 }, egLpm: { value: 0 }, egPaper: { value: new THREE.Vector3() }, egInk: { value: new THREE.Vector3() }, egAcc: { value: new THREE.Vector3() }, egAccOn: { value: 0 },
    egExpo: { value: 1 }, egGamma: { value: 1 }, egOutline: { value: 1 }, egWobble: { value: 0 }, egFlick: { value: 1 }, egStipple: { value: 1 }, egPlate: { value: 0 },
    egD1: { value: new THREE.Vector3() }, egD2: { value: new THREE.Vector3() }, egD3: { value: new THREE.Vector3() } };
  const set = p => { o = { ...o, ...p };
    U.egFlat.value = o.flatten; U.egLpm.value = o.lpm; U.egPaper.value.copy(lin(o.paper)); U.egInk.value.copy(lin(o.ink)); U.egAccOn.value = o.accent ? 1 : 0; if (o.accent) U.egAcc.value.copy(lin(o.accent));
    U.egExpo.value = o.exposure; U.egGamma.value = o.gamma; U.egOutline.value = o.outline; U.egWobble.value = o.wobble; U.egFlick.value = o.flick; U.egStipple.value = o.stipple; U.egPlate.value = o.plate;
    U.egD1.value.set(...o.dirs[0]).normalize(); U.egD2.value.set(...o.dirs[1]).normalize(); U.egD3.value.set(...o.dirs[2]).normalize(); };
  set(o); return { U, set };
}

const PARS = /* glsl */`
uniform float egFlat, egLpm, egExpo, egGamma, egOutline, egWobble, egFlick, egStipple, egAccOn, egPlate; uniform vec3 egPaper, egInk, egAcc, egD1, egD2, egD3;
float egH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float egN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(egH(i), egH(i + vec2(1, 0)), f.x), mix(egH(i + vec2(0, 1)), egH(i + vec2(1, 1)), f.x), f.y); }
// one line family: s = line coordinate (lines at integers + 0.5), w = line width fraction, returns ink 0..1 and its alias level
float egLine(float s, float w, out float alias){ float aa = max(fwidth(s), 1e-4); alias = aa; float d = abs(fract(s) - 0.5);
  return smoothstep(w * 0.5 + aa * 0.75, w * 0.5 - aa * 0.75, d); }
vec3 egShade(vec3 lit, vec3 alb, vec3 P, vec3 N, vec3 V){
  float L = dot(lit, vec3(0.2126, 0.7152, 0.0722)), La = dot(alb, vec3(0.2126, 0.7152, 0.0722));
  L = mix(L, L / max(La, 0.04) * 0.5, egFlat);            // flatten: model the form by light, not by the cloth's colour
  float tone = 1.0 - exp(-L * egExpo);                       // 0 = black, 1 = paper
  float k = pow(clamp(1.0 - tone, 0.0, 1.0), egGamma);        // darkness
  float s1 = dot(P, egD1) * egLpm, s2 = dot(P, egD2) * egLpm * 0.92, s3 = dot(P, egD3) * egLpm * 1.1;
  s1 += egWobble * (egN(P.xz * 40.0 + P.y * 7.0) - 0.5);      // the burin's hand: a slow wander along the line
  float a1, a2, a3;
  // family 1: the modelling lines. They swell with darkness; in the lights they break into flicks and dashes.
  float w1 = mix(0.06, 0.9, smoothstep(0.03, 0.7, k));
  float along = dot(P, normalize(cross(egD1, N + 1e-4))) * egLpm * 0.35;
  float dash = egN(vec2(floor(s1) * 3.7, along)); w1 *= mix(1.0, smoothstep(0.55 - k * 3.0, 0.62 - k * 3.0, dash), egFlick * (1.0 - smoothstep(0.1, 0.3, k)));
  w1 *= step(0.02, k);
  float i1 = egLine(s1, w1, a1);
  // family 2: the cross-hatch in the half-tones; family 3 in the darks
  float i2 = egLine(s2, mix(0.0, 0.7, smoothstep(0.5, 0.9, k)), a2);
  float i3 = egLine(s3, mix(0.0, 0.55, smoothstep(0.8, 1.0, k)), a3);
  // dot-and-lozenge: a dot at the centre of each diamond between families 1 and 2, in the deepest darks
  vec2 cell = fract(vec2(s1, s2)) - 0.5; float dr = length(cell) * 2.0, aa = max(fwidth(s1), 1e-4);
  float dots = smoothstep(0.42 + aa, 0.42 - aa, dr) * smoothstep(0.8, 0.97, k) * egStipple;
  float ink = 1.0 - (1.0 - i1) * (1.0 - i2) * (1.0 - i3) * (1.0 - dots);
  // where lines would alias (grazing angles, distance) the engraving becomes flat plate tone of the same value
  float alias = max(a1, max(a2, a3)); ink = mix(ink, clamp(k * 1.05, 0.0, 1.0), smoothstep(0.45, 0.95, alias));
  // contour line
  float nv = abs(dot(N, V)); ink = max(ink, egOutline * smoothstep(0.26, 0.08, nv));
  // plate tone: the wiped plate leaves a faint film of ink everywhere, a touch heavier in the darks
  ink = max(ink, egPlate * (0.5 + k));
  vec3 inkC = egInk;
  if (egAccOn > 0.5) { float red = smoothstep(0.78, 0.9, (lit.r - max(lit.g, lit.b)) / max(lit.r, 1e-3)) * smoothstep(0.01, 0.05, lit.r); inkC = mix(egInk, egAcc, red); ink = max(ink, red * 0.35 + red * i1); }
  return mix(egPaper, inkC, clamp(ink, 0.0, 1.0));
}
`;
function inject(sh, U, P, pars = '') {
  Object.assign(sh.uniforms, U);
  sh.fragmentShader = pars + sh.fragmentShader
    .replace('#include <common>', '#include <common>\n' + PARS)
    .replace('#include <tonemapping_fragment>', `gl_FragColor.rgb = egShade(gl_FragColor.rgb, diffuseColor.rgb, ${P}, normalize(normal), normalize(vViewPosition));\n#include <tonemapping_fragment>`);
}
export function engraveMaterial(mat, opts = {}) {
  const H = uniforms({ ...DEF, ...opts }), prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.vertexShader = 'varying vec3 egP;\n' + sh.vertexShader.replace('#include <project_vertex>', 'egP = transformed;\n#include <project_vertex>');
    inject(sh, H.U, 'egP', 'varying vec3 egP;\n');
  };
  mat.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|engrave';
  mat.toneMapped = false; mat.needsUpdate = true;
  return H;
}
// people.js: engraving space = bind space (pBind), so lines are attached to the body and follow its motion
export function engravePeople(folk, opts = {}) {
  const H = uniforms({ ...DEF, ...opts }), seen = new Set();
  for (const m of folk.meshes) {
    const mat = m.material; if (seen.has(mat)) continue; seen.add(mat);
    const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey.bind(mat);
    mat.onBeforeCompile = (sh, r) => { prev(sh, r); inject(sh, H.U, 'pBind'); };
    mat.customProgramCacheKey = () => prevKey() + '|engrave';
    mat.toneMapped = false; mat.needsUpdate = true;
  }
  return H;
}

// the banknote plate around a portrait: paper, a lathe-work field of fine waved lines outside an oval, a double rule,
// and a rosette band (guilloche) on the oval. Draw it with a glfx Passes before rendering the scene with autoClear off.
export const PLATE_FRAG = /* glsl */`
uniform vec3 uPaper, uInk, uAcc; uniform vec2 uRes, uC, uR; uniform float uLines, uAccOn, uT;
float line(float s, float w){ float aa = fwidth(s); return smoothstep(w * 0.5 + aa, w * 0.5 - aa, abs(fract(s) - 0.5)); }
vec3 lin(vec3 c){ return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 srgb(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main(){
  vec2 p = vUv * uRes; vec2 q = (p - uC) / uR; float r = length(q), a = atan(q.y, q.x);
  float ink = 0.0;
  // lathe field outside the oval: horizontal lines waved by two sines (a straight-line engine with a cam)
  float wave = sin(p.x * 0.021 + sin(p.y * 0.013) * 2.0) * 6.0 + sin(p.x * 0.057) * 1.5;
  float field = line((p.y + wave) / uLines, 0.34) * smoothstep(1.02, 1.1, r);
  // rosette band on the oval: two families of epitrochoid-like curves crossing
  float band = smoothstep(1.0, 1.01, r) * smoothstep(1.13, 1.12, r);
  float ro = (r - 1.0) * 180.0; float g1 = line(ro + sin(a * 48.0) * 2.2, 0.28), g2 = line(ro - sin(a * 48.0 + 1.57) * 2.2, 0.28);
  ink = max(field * 0.9, band * max(g1, g2));
  // double rules
  ink = max(ink, smoothstep(0.004, 0.0, abs(r - 0.995)) + smoothstep(0.003, 0.0, abs(r - 1.14)));
  // inside the oval: a whisper of horizontal plate tone behind the head (very sparse lines)
  ink = max(ink, line(p.y / (uLines * 1.9), 0.12) * 0.55 * smoothstep(1.0, 0.7, r) * smoothstep(0.2, 0.9, r));
  vec3 c = mix(uPaper, uInk, clamp(ink, 0.0, 1.0));
  o = vec4(srgb(c), 1.0);
}`;
export function plateBackground(fx, { paper = '#efe6cf', ink = '#1a1712', w = 1080, h = 1920, center = [540, 1060], radius = [470, 640], lines = 7 } = {}) {
  fx.run('eng_plate', PLATE_FRAG, { uPaper: lin(paper), uInk: lin(ink), uAcc: lin(ink), uRes: [w, h], uC: center, uR: radius, uLines: lines, uAccOn: 0, uT: 0 }, null);
}
