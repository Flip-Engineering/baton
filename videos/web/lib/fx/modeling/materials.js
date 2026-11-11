// MODELING materials (MODELING studio, cycle 1): house materials whose WEAR is driven by the baked vertex data
// (COLOR_0 = ambient occlusion, convex edge, part id) plus a few wear channels that read at feed size:
//   edge     bare metal / chalked paint on convex edges (where hands and chains hit), from the bake, not from noise
//   grime    dirt in the cavities (low AO) and rising from the ground, streaked down the panel
//   rust     rust that RUNS DOWN from seams and lips: streaks in world x/z, long in y, strongest where AO is closed
//   ao       the baked AO on ambient light only (not on the key), so a crevice goes dark without the sun going dark
//   decal    an optional map (owner codes, stencils, plates) in the asset's own UVs, multiplied into the paint
// Every value is a pure function of position and the bake: identical in a still and in the movie. Materials are keyed by
// the name a catalogued part carries (`mat` in the glb extras), so every asset shares one palette and each piece can
// override it (`paints`) to print the model in its own colours.
import * as THREE from 'three';

const GL = `
varying vec3 vWPos; varying vec3 vWN;
uniform vec4 uA;      // edge, grime, rust, ao
uniform vec4 uB;      // grimeH, rustLen, streak scale, ground y
uniform vec2 uC;      // bump strength (a cast / rolled surface catches a raking light), bump scale (1/m)
uniform vec3 uEdgeC; uniform vec3 uGrimeC; uniform vec3 uRustC;
float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ float a = .5, s = 0.; for (int i = 0; i < 4; i++){ s += a * vn(p); p *= 2.03; a *= .5; } return s; }
`;

export function wearMaterial(o = {}) {
  const m = new THREE.MeshStandardMaterial({
    color: o.color ?? 0x888888, roughness: o.rough ?? 0.55, metalness: o.metal ?? 0, envMapIntensity: o.env ?? 1,
    emissive: o.emissive ?? 0x000000, emissiveIntensity: o.emissiveIntensity ?? 1, map: o.map || null,
    transparent: !!o.transparent, opacity: o.opacity ?? 1, side: o.side ?? THREE.FrontSide,
  });
  m.vertexColors = true;
  const w = { edge: 0.4, grime: 0.3, rust: 0, ao: 1, grimeH: 1.2, rustLen: 3, streak: 7, ground: 0, bump: 0, bumpScale: 12, edgeC: 0xbfb9a8, grimeC: 0x15120f, rustC: 0x5a2a12, ...(o.wear || {}) };
  const col = h => new THREE.Color(h);
  m.userData.uniforms = {};
  m.onBeforeCompile = sh => {
    sh.uniforms.uA = { value: new THREE.Vector4(w.edge, w.grime, w.rust, w.ao) };
    sh.uniforms.uB = { value: new THREE.Vector4(w.grimeH, w.rustLen, w.streak, w.ground) };
    sh.uniforms.uC = { value: new THREE.Vector2(w.bump, w.bumpScale) };
    sh.uniforms.uEdgeC = { value: col(w.edgeC) }; sh.uniforms.uGrimeC = { value: col(w.grimeC) }; sh.uniforms.uRustC = { value: col(w.rustC) };
    m.userData.uniforms = sh.uniforms;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      { vec4 wp = vec4(transformed, 1.0); vec3 wn = objectNormal;
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp; wn = mat3(instanceMatrix) * wn;
        #endif
        vWPos = (modelMatrix * wp).xyz; vWN = normalize(mat3(modelMatrix) * wn); }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + GL)
      .replace('#include <color_fragment>', `
      #ifdef USE_COLOR
        float bAO = vColor.r, bCv = vColor.g;
      #else
        float bAO = 1.0, bCv = 0.0;
      #endif
      {
        vec3 P = vWPos;
        // large-scale value wobble: a panel is never one flat colour
        diffuseColor.rgb *= 0.92 + 0.16 * fbm(P * 0.9);
        // rust: streaks run DOWN. Noise stretched in y; strongest under convex edges / in closed cavities (baked), fades with height above the seam
        float streak = fbm(vec3(P.x * uB.z, P.y * uB.z / max(uB.y, 0.5), P.z * uB.z));
        float rust = uA.z * smoothstep(0.52, 0.78, streak) * clamp(0.35 + (1.0 - bAO) * 1.6 + bCv * 0.6, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, uRustC * (0.7 + 0.6 * vn(P * 40.0)), clamp(rust, 0.0, 0.92));
        // grime: in the cavities and rising from the ground, streaked
        float gh = clamp(1.0 - (P.y - uB.w) / max(uB.x, 1e-3), 0.0, 1.0);
        float gr = uA.y * clamp((1.0 - bAO) * 1.4 + gh * gh * (0.6 + 0.4 * fbm(vec3(P.x * 3.0, P.y * 0.4, P.z * 3.0))), 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, uGrimeC, clamp(gr, 0.0, 0.9));
        // worn convex edges from the bake (chalked paint / bare metal), broken up so it is not a uniform outline
        float ed = uA.x * smoothstep(0.1, 0.8, bCv) * smoothstep(0.25, 0.65, vn(P * 60.0) + 0.25 * bCv);
        diffuseColor.rgb = mix(diffuseColor.rgb, uEdgeC, clamp(ed, 0.0, 0.85));
      }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      if (uC.x > 0.0) { vec3 bp = vWPos * uC.y; float e = 0.06;
        vec3 gr = vec3(fbm(bp + vec3(e,0,0)) - fbm(bp - vec3(e,0,0)), fbm(bp + vec3(0,e,0)) - fbm(bp - vec3(0,e,0)), fbm(bp + vec3(0,0,e)) - fbm(bp - vec3(0,0,e))) / (2.0 * e);
        vec3 gv = (viewMatrix * vec4(gr, 0.0)).xyz; gv -= dot(gv, normal) * normal; normal = normalize(normal - uC.x * 0.12 * gv); }`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
      { float ao = mix(1.0, bAO, uA.w); reflectedLight.indirectDiffuse *= ao; reflectedLight.indirectSpecular *= ao; }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = clamp(roughnessFactor + uA.y * 0.25 * (1.0 - bAO) + uA.z * 0.3 * smoothstep(0.52, 0.78, fbm(vec3(vWPos.x * uB.z, vWPos.y * uB.z / max(uB.y, 0.5), vWPos.z * uB.z))), 0.03, 1.0);`);
  };
  m.customProgramCacheKey = () => 'wm' + JSON.stringify(w);
  return m;
}

// the palette, by the name parts carry (`paint.cobot`, `steel.flange`, ...). A piece can override any entry.
export const PALETTE = {
  'paint.cobot':   { color: 0xb9bbb7, rough: 0.42, metal: 0.05, wear: { edge: 0.35, grime: 0.28, edgeC: 0x8a8d8a } },
  'alu.black':     { color: 0x1a1b1d, rough: 0.5, metal: 0.55, wear: { edge: 0.5, grime: 0.2, edgeC: 0x9a9da0 } },
  'steel.flange':  { color: 0xa8acb0, rough: 0.28, metal: 1.0, env: 1.3, wear: { edge: 0.25, grime: 0.15 } },
  'rubber.btn':    { color: 0x2a2b2c, rough: 0.8, metal: 0, wear: { edge: 0.1, grime: 0.25 } },
  'rubber.btn_green': { color: 0x2c7a52, rough: 0.7, metal: 0, emissive: 0x0c3a22, emissiveIntensity: 1.2, wear: { edge: 0.05, grime: 0.15 } },
  'emit.ring':     { color: 0x101412, rough: 0.3, metal: 0, emissive: 0x9fffe0, emissiveIntensity: 1.0, wear: { edge: 0, grime: 0 } },
  'cable':         { color: 0x141414, rough: 0.55, metal: 0, wear: { edge: 0.1, grime: 0.2 } },
  // STS crane (Port Newark class): red steel with white bands
  'crane.red':     { color: 0xc23a24, rough: 0.5, metal: 0.25, wear: { bump: 0.4, bumpScale: 4, edge: 0.3, grime: 0.28, rust: 0.4, rustC: 0x6a2a12, edgeC: 0xd0b9a0, grimeH: 24 } },
  'crane.white':   { color: 0xd6d3c8, rough: 0.5, metal: 0.15, wear: { edge: 0.25, grime: 0.5, rust: 0.4, rustC: 0x6a3a1c, grimeH: 30 } },
  'crane.steel':   { color: 0x767a7c, rough: 0.55, metal: 0.8, wear: { edge: 0.2, grime: 0.4, rust: 0.5 } },
  'crane.black':   { color: 0x1a1a1b, rough: 0.6, metal: 0.4, wear: { edge: 0.3, grime: 0.5, rust: 0.4 } },
  'crane.house':   { color: 0xb9b6ab, rough: 0.55, metal: 0.2, wear: { edge: 0.2, grime: 0.55, rust: 0.4 } },
  'crane.glass':   { color: 0x101a22, rough: 0.05, metal: 0.8, env: 2.0, wear: { edge: 0, grime: 0.1 } },
  'crane.number':  { color: 0xffffff, rough: 0.6, metal: 0.1, wear: { edge: 0, grime: 0.2 } },
  'crane.cabglass':{ color: 0x1a1408, rough: 0.05, metal: 0.4, env: 1.5, emissive: 0xffb050, emissiveIntensity: 0.9, wear: { edge: 0, grime: 0 } },
  // trucks
  'cab.paint':     { color: 0xcfc6b0, rough: 0.34, metal: 0.25, env: 1.0, wear: { edge: 0.2, grime: 0.32, rust: 0.05, edgeC: 0x8c8676, grimeH: 1.6 } },
  'cab.glass':     { color: 0x0e1418, rough: 0.04, metal: 0.85, env: 2.2, wear: { edge: 0, grime: 0.15 } },
  'cab.trim':      { color: 0x2b2b2c, rough: 0.55, metal: 0.3, wear: { edge: 0.3, grime: 0.4 } },
  'chrome':        { color: 0xdfe2e4, rough: 0.14, metal: 1.0, env: 1.5, wear: { edge: 0.05, grime: 0.25 } },
  'mirror':        { color: 0x0a0d10, rough: 0.03, metal: 1.0, env: 2.4, wear: { edge: 0, grime: 0.08 } },
  'chassis':       { color: 0x1d1e20, rough: 0.6, metal: 0.55, wear: { bump: 0.5, edge: 0.3, grime: 0.55, rust: 0.4, grimeH: 1.4 } },
  'rubber.tyre':   { color: 0x131314, rough: 0.9, metal: 0.0, wear: { edge: 0.1, grime: 0.6, grimeH: 0.9 } },
  'lamp.head':     { color: 0x1a1a1a, rough: 0.1, metal: 0.5, emissive: 0xfff2d8, emissiveIntensity: 0.0, wear: { edge: 0, grime: 0 } },
  'lamp.amber':    { color: 0x2a1a08, rough: 0.2, metal: 0.1, emissive: 0xffa02a, emissiveIntensity: 0.0, wear: { edge: 0, grime: 0 } },
  'van.sheet':     { color: 0x8f9396, rough: 0.42, metal: 0.55, env: 1.1, wear: { edge: 0.2, grime: 0.5, rust: 0.15, edgeC: 0xc9cdd0, grimeH: 2.2 } },
  'van.post':      { color: 0x6f7376, rough: 0.5, metal: 0.65, wear: { edge: 0.3, grime: 0.55, rust: 0.3 } },
  'van.steel':     { color: 0xb4b8bb, rough: 0.25, metal: 1.0, env: 1.3, wear: { edge: 0.15, grime: 0.35, rust: 0.2 } },
  'tape.red':      { color: 0xb02020, rough: 0.3, metal: 0.2, env: 1.5, wear: { edge: 0, grime: 0.3 } },
  'tape.white':    { color: 0xe6e6e0, rough: 0.3, metal: 0.2, env: 1.5, wear: { edge: 0, grime: 0.3 } },
  // rolling mill
  'mill.cast':     { color: 0x2c2b29, rough: 0.78, metal: 0.45, wear: { bump: 1.0, bumpScale: 9, edge: 0.45, grime: 0.75, rust: 0.6, rustC: 0x3a1c0c, edgeC: 0x8a867a, grimeH: 3 } },
  'mill.steel':    { color: 0x6c6f6e, rough: 0.4, metal: 1.0, env: 1.2, wear: { edge: 0.3, grime: 0.5, rust: 0.3 } },
  'mill.roll':     { color: 0x9a9c9a, rough: 0.22, metal: 1.0, env: 1.3, wear: { edge: 0.2, grime: 0.3, rust: 0.15 } },
  'mill.bronze':   { color: 0x8a6a3a, rough: 0.4, metal: 0.9, wear: { edge: 0.3, grime: 0.5 } },
  'mill.paint':    { color: 0x2a3e34, rough: 0.55, metal: 0.3, wear: { edge: 0.4, grime: 0.6, rust: 0.4 } },
  'lamp.flood':    { color: 0x222222, rough: 0.3, metal: 0.2, emissive: 0xffe6b8, emissiveIntensity: 3.0, wear: { edge: 0, grime: 0 } },
  'lamp.red':      { color: 0x301010, rough: 0.3, metal: 0.1, emissive: 0xff2010, emissiveIntensity: 4.0, wear: { edge: 0, grime: 0 } },
};
const cache = new Map();
export function matFor(name, paints = {}) {
  const key = name + JSON.stringify(paints[name] || {});
  if (cache.has(key)) return cache.get(key);
  const spec = { ...(PALETTE[name] || { color: 0x808080, rough: 0.6 }), ...(paints[name] || {}) };
  if (spec.wear || paints[name]?.wear) spec.wear = { ...(PALETTE[name]?.wear || {}), ...(paints[name]?.wear || {}) };
  const m = wearMaterial(spec); m.name = name; cache.set(key, m); return m;
}
export function registerPalette(extra) { Object.assign(PALETTE, extra); }
