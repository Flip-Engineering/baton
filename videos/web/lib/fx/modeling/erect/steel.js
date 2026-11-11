// ERECT steel (MODELING c4): a material stack for painted structural steel, readable at feed size and at 1:1.
//
// Why: c3's giant was one chamfered grey at one value: the joints no darker than the shells, wear not placed by use, nothing
// telling primer from paint. Real heavy plant is read in layers, each with its own value and its own cause:
//   red-lead primer      the colour of steel not yet painted: the construction front (and plates left in it on purpose)
//   top coat             over the primer; chips at the flame-cut edges (aEdge x use) show the red lead, heavy wear the steel
//   rivet rows           domes inset from every plate edge (procedural bump, fades out before it aliases)
//   rust runs            streaks that start at rivet rows and plate laps and run DOWN the plate
//   cavity grime         where the designed occlusion (aAO) is low: inside columns, under ledges, round the joints
//   ground mud           thrown up the feet and shins (rest-pose height), patchy
//   oil                  weeping round the bearings (world-space joint list updated per frame), darker and glossier
//   snow                 lying on up-facing surfaces (object-space normal), the painting's light ground carried up the giant
// and the BUILD runs in the vertex shader (uBuild): a piece appears at its threshold, drops the last metres in from the hook,
// stays red lead until its paint threshold. Every material of one giant shares the uniforms in `U`, so one write moves them all.
//
//   const U = sharedUniforms();  const M = steelMats(U, { coat: '#3b3c3a' });   U.uBuild.value = .4;   setOil(U, [[x,y,z,r], ...]);
import * as THREE from 'three';
import { rng } from './members.js';
import { erectSteel } from '../../light/surface.js';
import { litPatch } from '../../light/patch.js';
// LIGHTING c2: opt in to the ONE steel (light/surface.js, which now carries this file's causes) and the light/ pipeline.
// Set ERECT_PIPE.light = true BEFORE building an Erector or a Yard; existing renders (light false) are unchanged.
export const ERECT_PIPE = { light: false };

const C = (hex) => new THREE.Color(hex);   // ColorManagement on: hex is sRGB, converted to linear
export function sharedUniforms() {
  const oil = []; for (let i = 0; i < 16; i++) oil.push(new THREE.Vector4(0, -1e4, 0, .01));
  return { uBuild: { value: 1 }, uDropW: { value: .0095 }, uDropH: { value: 9 }, uOil: { value: oil }, uSnow: { value: .7 }, uMudH: { value: 7 }, uRain: { value: 0 } };
}
export function setOil(U, list) { const a = U.uOil.value; for (let i = 0; i < 16; i++) { const j = list[i]; if (j) a[i].set(j[0], j[1], j[2], j[3]); else a[i].set(0, -1e4, 0, .01); } }

// mottle: three channels of value noise at different scales (paint variation, chip pattern, patch noise), tiles
let _mottle = null;
export function mottleTexture(seed = 7) {
  if (_mottle) return _mottle; const S = 512, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'), R = rng(seed);
  const img = g.createImageData(S, S), d = img.data;
  const grid = (n) => { const a = new Float32Array((n + 1) * (n + 1)); for (let i = 0; i < a.length; i++) a[i] = R(); for (let i = 0; i <= n; i++) { a[i * (n + 1) + n] = a[i * (n + 1)]; a[n * (n + 1) + i] = a[i]; } return { a, n }; };
  const sample = (G, x, y) => { const n = G.n, fx = x * n, fy = y * n, ix = Math.floor(fx) % n, iy = Math.floor(fy) % n, tx = fx - Math.floor(fx), ty = fy - Math.floor(fy), sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), A = G.a, w = n + 1;
    return (A[iy * w + ix] * (1 - sx) + A[iy * w + ix + 1] * sx) * (1 - sy) + (A[(iy + 1) * w + ix] * (1 - sx) + A[(iy + 1) * w + ix + 1] * sx) * sy; };
  const oct = (Gs, x, y) => { let v = 0, w = 0, a = 1; for (const G of Gs) { v += sample(G, x, y) * a; w += a; a *= .55; } return v / w; };
  const A = [grid(4), grid(8), grid(16), grid(32)], B = [grid(16), grid(32), grid(64), grid(128)], Cc = [grid(6), grid(12), grid(24)];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const u = x / S, v = y / S, i = (y * S + x) * 4;
    d[i] = Math.round(oct(A, u, v) * 255); d[i + 1] = Math.round(oct(Cc, u, v) * 255); d[i + 2] = Math.round(oct(B, u, v) * 255); d[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4; t.generateMipmaps = true;
  return (_mottle = t);
}

const VERT_PARS = `
attribute vec4 aStage; attribute vec4 aPlate; attribute float aEdge; attribute float aAO; attribute float aRand; attribute float aRest;
varying vec4 vStage; varying vec4 vPlate; varying float vEdge; varying float vAOx; varying float vRand; varying float vRestY; varying vec3 vNrmO; varying vec3 vWP; varying vec2 vUvE;
uniform float uBuild; uniform float uDropW; uniform float uDropH;
`;
const VERT_BUILD = `
  vStage = aStage; vPlate = aPlate; vEdge = aEdge; vAOx = aAO; vRand = aRand; vRestY = aRest; vNrmO = normal; vUvE = uv;
  float bAge_ = uBuild - aStage.x;
  if (bAge_ < 0.0) transformed = vec3(0.0, -1.0e4, 0.0);
  else { float k_ = clamp(bAge_ / uDropW, 0.0, 1.0); transformed.y += (1.0 - k_ * k_ * (3.0 - 2.0 * k_)) * uDropH * aStage.w; }
  vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;
// the same build for the shadow (depth) pass
function depthTwin(U) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = sh => { Object.assign(sh.uniforms, { uBuild: U.uBuild, uDropW: U.uDropW, uDropH: U.uDropH });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aStage; uniform float uBuild; uniform float uDropW; uniform float uDropH;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { float bAge_ = uBuild - aStage.x; if (bAge_ < 0.0) transformed = vec3(0.0, -1.0e4, 0.0); else { float k_ = clamp(bAge_ / uDropW, 0.0, 1.0); transformed.y += (1.0 - k_ * k_ * (3.0 - 2.0 * k_)) * uDropH * aStage.w; } }`); };
  m.customProgramCacheKey = () => 'erect-depth'; return m;
}

const FRAG_PARS = `
varying vec4 vStage; varying vec4 vPlate; varying float vEdge; varying float vAOx; varying float vRand; varying float vRestY; varying vec3 vNrmO; varying vec3 vWP; varying vec2 vUvE;
uniform float uBuild; uniform vec3 uCoat; uniform vec3 uPrimer; uniform vec3 uBare; uniform vec3 uMud; uniform vec3 uRust; uniform vec3 uSnowCol;
uniform float uWear; uniform float uGrime; uniform float uRustAmt; uniform float uSnow; uniform float uMudH; uniform float uRivets; uniform float uRivR; uniform float uRivP; uniform float uAOStr;
uniform float uRoughPaint; uniform float uRoughPrimer; uniform float uSpec; uniform float uMetalBare; uniform float uOilAmt; uniform float uTone;
uniform vec4 uOil[16]; uniform sampler2D uMottle;
float eDome_(vec2 q, float r) { return sqrt(max(0.0, r * r - dot(q, q))) / r; }
float eRivets_(vec4 P, float r, float p) {
  if (P.z <= 0.0) return 0.0;
  float ins = max(r * 2.2, min(.14, P.z * .3)), h = 0.0;
  float a = P.x, cx = (floor(a / p) + .5) * p;
  if (P.w > .5 || P.z < .7) { h = max(h, eDome_(vec2(a - cx, P.y - ins), r)); h = max(h, eDome_(vec2(a - cx, P.y - (P.w - ins)), r)); }
  if (P.z >= .7) { float b = P.y, cy = (floor(b / p) + .5) * p; h = max(h, eDome_(vec2(P.x - ins, b - cy), r)); h = max(h, eDome_(vec2(P.x - (P.z - ins), b - cy), r)); }
  return h;
}
vec3 ePerturb_(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
  vec3 vSigmaX = normalize(dFdx(surf_pos.xyz)), vSigmaY = normalize(dFdy(surf_pos.xyz)), vN = surf_norm;
  vec3 R1 = cross(vSigmaY, vN), R2 = cross(vN, vSigmaX); float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2); return normalize(abs(fDet) * surf_norm - vGrad);
}
`;
const FRAG_COLOR = `
  float eH = 0.0, eR = uRoughPaint, eM = metalness, eBare = 0.0;
  {
    float painted = vStage.y < 0.0 ? 1.0 : step(vStage.y, uBuild);
    vec4 mo = texture2D(uMottle, vUvE), mo2 = texture2D(uMottle, vUvE * 3.1 + vec2(.31, .77));
    vec3 base = mix(uPrimer, uCoat, painted);
    base *= (1.0 - uTone * .5) + uTone * (mo.r * .6 + mo2.b * .4) + uTone * .3 * (vRand - .5);
    // chips: flame-cut edges get the use; patches break the edge so it is not a clean line
    float wearK = vStage.z * uWear;
    float chipN = mo2.b * .35 + texture2D(uMottle, vUvE * 23.0).b * .65;
    float chip = smoothstep(.56, .62, vEdge * wearK * 1.5 + chipN * .5 + wearK * .18);
    float bare = smoothstep(.74, .8, vEdge * wearK * 1.7 + chipN * .45 + wearK * .1);
    vec3 col = base;
    col = mix(col, uPrimer * .95, chip * painted);
    col = mix(col, uBare * (.8 + .4 * mo.g), bare);
    eR = mix(mix(uRoughPrimer, uRoughPaint, painted), .36, bare); eM = mix(eM, uMetalBare, bare); eBare = bare;
    eH += (chip - bare) * .015 * painted + bare * -.01;
    // rivets (bump + a dark ring), faded before they alias
    float fw = max(fwidth(vPlate.x), fwidth(vPlate.y));
    float rv = uRivets * eRivets_(vPlate, uRivR, uRivP) * (1.0 - smoothstep(uRivR * .45, uRivR * 1.3, fw));
    eH += rv * .05; col *= 1.0 - .18 * smoothstep(.0, .35, rv) * (1.0 - smoothstep(.35, .8, rv)); col *= 1.0 + .18 * smoothstep(.75, 1.0, rv);
    // rust runs: from the top rivet row / the lap above, running down the plate
    if (vPlate.z > 0.0) {
      float top = vPlate.w - .12, dn = top - vPlate.y;
      float sc = texture2D(uMottle, vec2(vPlate.x * .37 + vRand * 3.1, .13)).b, sc2 = texture2D(uMottle, vec2(vPlate.x * 1.9 + vRand, .61)).r;
      float len = .4 + 2.6 * sc2;
      float run = smoothstep(.55, .75, sc) * step(0.0, dn) * exp(-dn / len) * (.4 + 1.2 * vRand) * uRustAmt;
      float rivRun = 0.0; { float cx = (floor(vPlate.x / uRivP) + .5) * uRivP, dx = abs(vPlate.x - cx); rivRun = step(0.0, dn) * (1.0 - smoothstep(.015, .05, dx)) * exp(-dn / (.3 + 1.4 * sc2)) * step(.5, fract(cx * 7.13 + vRand * 3.7)) * uRustAmt * .8; }
      float r = clamp(run + rivRun, 0.0, 1.0);
      col = mix(col, uRust * (.75 + .5 * sc2), r * .75); eR = mix(eR, .9, r);
    }
    // cavity grime (designed occlusion), ground mud on feet and shins
    float cav = 1.0 - vAOx;
    col *= mix(1.0, .5, clamp(cav * 1.2, 0.0, 1.0) * uGrime);
    float mud = (1.0 - smoothstep(.0, uMudH, vRestY + (mo.g - .5) * 3.0)) * smoothstep(.35, .55, mo2.r + .25);
    col = mix(col, uMud * (.8 + .4 * mo.b), clamp(mud, 0.0, 1.0) * uGrime * .9); eR = mix(eR, .95, mud * uGrime);
    // oil weeping round the bearings: longer below the pin than above
    float oil = 0.0;
    for (int i = 0; i < 16; i++) { vec3 d = vWP - uOil[i].xyz; d.y *= d.y > 0.0 ? 2.2 : .42; float q = length(d) / uOil[i].w; oil = max(oil, 1.0 - smoothstep(.45, 1.0, q + (mo2.g - .5) * .5)); }
    oil *= uOilAmt;
    col *= mix(1.0, .42, oil); eR = mix(eR, .22, oil);
    // snow on what faces up (object space: the rest pose), not on the undersides; thin on steep faces
    float up = smoothstep(.55, .9, vNrmO.y);
    float snow = up * smoothstep(.42, .62, mo.g * .7 + mo2.r * .3 + uSnow * .45 - .05) * uSnow;
    col = mix(col, uSnowCol * (.92 + .1 * mo.r), snow); eR = mix(eR, .92, snow); eM = mix(eM, 0.0, snow); eH += snow * .02;
    diffuseColor.rgb = col;
  }
`;
export function stackMaterial(U, { coat = '#3b3c3a', primer = '#a8442a', bare = '#6b6a66', mud = '#4a4036', rust = '#6a3519', snow = '#e9ecee',
  wear = 1, grime = 1, rustAmt = .6, rivets = 1, rivR = .07, rivP = .42, rough = .58, spec = .4, roughPrimer = .82, metal = .18, metalBare = .65, oil = 1, tone = .35, aoStr = .9, env = .9, name = 'steel', light = null } = {}) {
  if (ERECT_PIPE.light) return erectSteel(U, { coat, primer, bare, mud, rust, snow, wear, grime, rustAmt, rivets, rivR, rivP, rough, roughPrimer, metal, metalBare, oil, tone, aoStr, env, name, light });
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: rough, metalness: metal, envMapIntensity: env });
  const u = { uCoat: { value: C(coat) }, uPrimer: { value: C(primer) }, uBare: { value: C(bare) }, uMud: { value: C(mud) }, uRust: { value: C(rust) }, uSnowCol: { value: C(snow) },
    uWear: { value: wear }, uGrime: { value: grime }, uRustAmt: { value: rustAmt }, uRivets: { value: rivets }, uRivR: { value: rivR }, uRivP: { value: rivP }, uAOStr: { value: aoStr },
    uRoughPaint: { value: rough }, uSpec: { value: spec }, uRoughPrimer: { value: roughPrimer }, uMetalBare: { value: metalBare }, uOilAmt: { value: oil }, uTone: { value: tone }, uMottle: { value: mottleTexture() } };
  m.userData.u = u; m.name = name;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u, { uBuild: U.uBuild, uDropW: U.uDropW, uDropH: U.uDropH, uOil: U.uOil, uSnow: U.uSnow, uMudH: U.uMudH });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_PARS).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_BUILD);
    if (!sh.vertexShader.includes('vUvE = uv') ) {}
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = eR;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = eM;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n normal = ePerturb_(-vViewPosition, normal, vec2(dFdx(eH), dFdy(eH)), faceDirection);')
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        { float ao_ = mix(1.0, vAOx, uAOStr); reflectedLight.indirectDiffuse *= ao_; reflectedLight.indirectSpecular *= ao_ * mix(uSpec, 1.0, eBare); reflectedLight.directDiffuse *= mix(1.0, ao_, .35); reflectedLight.directSpecular *= mix(uSpec, 1.0, eBare); }`);
  };
  m.customProgramCacheKey = () => 'erect-stack';
  m.userData.depth = depthTwin(U);
  return m;
}
// a plain build-aware material (glass, lamps, rubber, chrome): same visibility rules, no stack
export function plainBuild(U, params, { emissive = null, ei = 1, basic = false } = {}) {
  const m = basic ? new THREE.MeshBasicMaterial(params) : new THREE.MeshStandardMaterial(params);
  if (emissive && !basic) { m.emissive = C(emissive); m.emissiveIntensity = ei; }
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { uBuild: U.uBuild, uDropW: U.uDropW, uDropH: U.uDropH });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aStage; uniform float uBuild; uniform float uDropW; uniform float uDropH; varying float vPaintOk;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { float bAge_ = uBuild - aStage.x; if (bAge_ < 0.0) transformed = vec3(0.0, -1.0e4, 0.0); else { float k_ = clamp(bAge_ / uDropW, 0.0, 1.0); transformed.y += (1.0 - k_ * k_ * (3.0 - 2.0 * k_)) * uDropH * aStage.w; }
          vPaintOk = aStage.y < 0.0 ? 1.0 : step(aStage.y, uBuild); if (aStage.z < 0.0 && uBuild > -aStage.z) transformed = vec3(0.0, -1.0e4, 0.0); }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vPaintOk;').replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n if (vPaintOk < .5) discard;');
  };
  m.customProgramCacheKey = () => 'erect-plain' + (basic ? 'b' : 's');
  m.userData.depth = depthTwin(U);
  if (ERECT_PIPE.light && !basic) litPatch(m, { ssr: params.metalness > 0.5 || params.roughness < 0.15 });
  return m;
}
// a flat silhouette material that keeps the BUILD (MODELING c5): a piece is hidden until it is hung and drops in from the hook, as
// in the stack; c4's lab silhouettes swapped in a plain MeshBasicMaterial and so showed the finished giant at every build state
export function silMaterial(U, color = 0x141416) {
  const m = new THREE.MeshBasicMaterial({ color });
  m.onBeforeCompile = sh => { Object.assign(sh.uniforms, { uBuild: U.uBuild, uDropW: U.uDropW, uDropH: U.uDropH });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aStage; uniform float uBuild; uniform float uDropW; uniform float uDropH;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { float bAge_ = uBuild - aStage.x; if (bAge_ < 0.0) transformed = vec3(0.0, -1.0e4, 0.0); else { float k_ = clamp(bAge_ / uDropW, 0.0, 1.0); transformed.y += (1.0 - k_ * k_ * (3.0 - 2.0 * k_)) * uDropH * aStage.w; } }`); };
  m.customProgramCacheKey = () => 'erect-sil'; return m;
}
// the giant's paint systems. Value plan (light sky, light snow ground, dark masses, warm low sun):
//   frame  near-black iron paint (the lattice reads as drawing against the sky)
//   plate  dark warm grey over red lead; some plates stay in red lead
//   mill   bare dark steel at the bearings; chrome rods and pins carry the highlights; yellow only on rails and ladders
export function steelMats(U, o = {}) {
  const M = {
    frame: stackMaterial(U, { coat: o.frame || '#25272a', wear: 1, rustAmt: .7, rivR: .07, name: 'frame', tone: .4, rough: .8, env: .7 }),
    plate: stackMaterial(U, { coat: o.plate || '#46484a', wear: .9, rustAmt: .55, rivR: .075, name: 'plate', tone: .32, rough: .74, env: .75 }),
    primer: stackMaterial(U, { coat: o.primer || '#a8442a', wear: .5, rustAmt: .3, rough: .82, name: 'primer' }),
    mill: stackMaterial(U, { coat: '#3a3936', bare: '#7c7a74', wear: 1.3, rustAmt: .3, rivets: 0, rough: .55, metal: .45, name: 'mill' }),
    rail: stackMaterial(U, { coat: '#b8952c', primer: '#b8952c', wear: 1.6, rustAmt: .2, rivets: 0, rough: .6, name: 'rail', tone: .2 }),
    grating: stackMaterial(U, { coat: '#8c8d89', wear: .5, rivets: 0, rough: .7, metal: .4, name: 'grating' }),
    hazard: stackMaterial(U, { coat: '#c9a12e', wear: 1.4, rivets: 0, name: 'hazard' }),
    chrome: plainBuild(U, { color: C('#c9ccce'), metalness: 1, roughness: .2, envMapIntensity: 1.2 }),
    rubber: plainBuild(U, { color: C('#161617'), roughness: .75, metalness: 0 }),
    glass: plainBuild(U, { color: C('#1b2128'), metalness: .2, roughness: .05, envMapIntensity: 1.5, transparent: true, opacity: .55 }),
    cab: plainBuild(U, { color: C('#2a241c'), roughness: .9 }, { emissive: '#ffb066', ei: .7 }),
    lamp: plainBuild(U, { color: C('#fff1d6') }, { basic: true }),
    red: plainBuild(U, { color: C('#b3261e'), roughness: .7 }),
  };
  M.lamp.toneMapped = false;
  return M;
}
