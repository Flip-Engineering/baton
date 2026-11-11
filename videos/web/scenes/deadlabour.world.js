// DEAD LABOUR v3: the world. A night downtown (World at scale 2, Atmos, LightField, americana_city Skyline) with its avenue and a cross
// street open; THE DEPOSIT at the avenue's head (research/october/DEADLABOUR_capital_designs.json, design 1 with both judges' grafts, no
// hours); the siphon (lib/fx/siphon.js) drawing the night shift's window light into the deposit's crown and giving it back.
//
// THE DEPOSIT is capital as dead labour: bone-pale flowstone, matte, made of nothing but the city's congealed light. It has no light of its
// own. What lights it: the city from below, the night sky, and the light it holds (a cold glow in the crown, exactly held('body') of the
// ledger). Inside its skin, at every depth, the windows it was made of, dead and tumbled, squashed flatter the older (lower) they are. While
// it drinks, its crown swells glossy (up to 10 m) and beads run down its runnels and set pale on the siphon's own packets. When the class
// takes the light back the swell drains away; the strata stand; and the city's returned light shines through the skin and lights the dead
// windows inside it warm. Nothing in it computes, hums or blinks: no grid, no edges, no seams, no hours.
import * as THREE from 'three';
import { World } from '../lib/fx/world3d.js';
import { LOOKS3, LightField, patchMaterial } from '../lib/fx/atmos3d.js';
import * as AM from '../lib/fx/americana.js';
import * as CT from '../lib/fx/americana_city.js';
import { Siphon } from '../lib/fx/siphon.js';
import { DEP, SKY_ROWS, SKY_SEED, RINGS, RANK_H, sampleSources, flowsFor, train, surface, normalAt, halfW, drips, buildingTops } from './deadlabour.plan.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };

// ------------------------------------------------------------------ the look (v3): v1's burning sky, darker and redder. A night overcast
// lit from below by the whole city (the towns' sodium on the cloud deck, ember at the horizon, near-black overhead), so the pale deposit
// stands against fire and the threads read white against it (v1's frame 0, the client's "more interesting" variant)
export const LOOK = { ...LOOKS3.CITY_NIGHT,
  sky: { zen: ['#140a08', 0.06], horSun: ['#6a2a14', 0.24], horAnti: ['#4e2212', 0.2], belt: ['#000000', 0], horExp: 0.45 },
  moon: { dir: [0.4, 0.3, -0.7], color: ['#8ea2d0', 0.0], light: 0.0 },
  fog: { d: 0.00028, h: 380, gain: 1, sun: 0, amb: ['#46302a', 0.05], far: 9000 },
  clouds: { on: 1, h: 880, scale: 1 / 2400, cover: 0.26, soft: 0.42, amb: ['#2a1812', 0.05], sun: 0, fade: 1 / 26000 },
  towns: { color: ['#ff6a34', 0.9] },
  exposure: 2.1, bloom: 0.14, floor: 0.035, white: 0.88, sat: 1.06, contrast: 1.1, shadowTint: [0.0, 0.004, 0.02], grain: 0.02 };

export const COLD = '#d6dad0', WARM = '#ffc27a', DRAIN_COLD = '#3a4650';
export const STONE = '#3a3835';                              // bone-grey with the cold green cast of the dead (graded below white)

// ------------------------------------------------------------------ the deposit's shader (chained before atmos3d patchMaterial)
const DEP_VS_HEAD = `
attribute float aFresh; attribute float aCrown;
uniform float uFresh;
varying vec3 vDP; varying vec3 vDN; varying float vCrown;`;
const DEP_VS_BEGIN = `#include <begin_vertex>
transformed += objectNormal * uFresh * aFresh;`;
const DEP_VS_PROJ = `#include <project_vertex>
vDP = (modelMatrix * vec4(transformed, 1.)).xyz; vDN = normalize(mat3(modelMatrix) * objectNormal); vCrown = aCrown;`;
const DEP_FS_HEAD = `
varying vec3 vDP; varying vec3 vDN; varying float vCrown;
uniform float uHeld, uWarm, uTime, uCityUp, uZC, uFreshK; uniform float uPk[8]; uniform vec3 uColdC, uWarmC, uDeadC, uSkyC, uUpC;
float dl_h1(vec3 p){ p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float dl_n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(dl_h1(i), dl_h1(i + vec3(1,0,0)), f.x), mix(dl_h1(i + vec3(0,1,0)), dl_h1(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(dl_h1(i + vec3(0,0,1)), dl_h1(i + vec3(1,0,1)), f.x), mix(dl_h1(i + vec3(0,1,1)), dl_h1(i + vec3(1,1,1)), f.x), f.y), f.z); }
// the dead windows inside the skin: a short march into the body; in each cell a hashed window (55 %), tumbled +-30 deg about the outward
// direction, squashed flatter with age (the lower, the older), seen through the stone with Beer-Lambert falloff. x: how much of the view
// is window (dark), y: the same weighted by each window's own warmth hash (for the end, when the city's light lights them)
vec2 dl_windows(vec3 P, vec3 V, vec3 N){
  vec3 rd = normalize(V * .55 - N * .85);
  float cov = 0., wrm = 0., T = 1.;
  for (int k = 0; k < 5; k++) {
    vec3 q = P + rd * (.4 + 1.7 * float(k));
    vec3 cs = vec3(3.4, 4.3, 3.4);
    vec2 col = floor(q.xz / cs.xz); float yo = dl_h1(vec3(col, 3.7)) * cs.y;              // each column's layers start at their own height: no rows
    vec3 c = vec3(col.x, floor((q.y + yo) / cs.y), col.y);
    if (dl_h1(c + 11.) > .34) continue;
    vec3 cc = vec3((c.x + .5) * cs.x, (c.y + .5) * cs.y - yo, (c.z + .5) * cs.z) + (vec3(dl_h1(c + 7.), dl_h1(c + 8.), dl_h1(c + 9.)) - .5) * vec3(1.6, 1.8, 1.6);
    vec3 rad = normalize(vec3(cc.x, 0., cc.z - uZC) + 1e-4);
    float a1 = (dl_h1(c + 3.) - .5) * 1.9, a2 = (dl_h1(c + 5.) - .5) * 1.5, rz = (dl_h1(c + 13.) - .5) * 1.4, ws = .55 + .6 * dl_h1(c + 17.);
    vec3 tg = normalize(cross(vec3(0., 1., 0.), rad));
    vec3 nw = normalize(rad + tg * sin(a1) + vec3(0., sin(a2), 0.));
    float dn = dot(rd, nw); if (abs(dn) < .05) continue;
    float t = dot(cc - P, nw) / dn; if (t < 0. || t > 9.) continue;
    vec3 hp = P + rd * t - cc;
    vec3 ax0 = normalize(cross(vec3(sin(a2) * .4, 1., 0.), nw)), ay0 = cross(nw, ax0);
    vec3 ax = ax0 * cos(rz) + ay0 * sin(rz), ay = ay0 * cos(rz) - ax0 * sin(rz);             // tumbled in its own plane too
    float sq = mix(.5, 1., clamp(cc.y / 300., 0., 1.));
    vec2 w = vec2(dot(hp, ax), dot(hp, ay) / sq) / ws, hs = vec2(.95, 1.25);
    if (abs(w.x) > hs.x || abs(w.y) > hs.y) continue;
    float frame = step(hs.x - .14, abs(w.x)) + step(hs.y - .16, abs(w.y)), mull = step(abs(w.x), .05) + step(abs(w.y - .25), .045);
    float glass = (1. - clamp(frame, 0., 1.)) * (1. - clamp(mull, 0., 1.) * .8);
    float att = exp(-t / 3.) * (1. - .45 * float(k) / 4.) * (.55 + .45 * dl_h1(c + 19.));
    float g = (.35 + .65 * glass) * att * T;
    cov += g; wrm += g * (.45 + .55 * dl_h1(c + 21.)) * step(.18, dl_h1(c + 23.));
    T *= 1. - .55 * (.35 + .65 * glass);
  }
  return vec2(clamp(cov, 0., 1.), clamp(wrm, 0., 1.));
}`;
const DEP_FS_COLOR = `#include <color_fragment>
  vec3 dlV = normalize(vDP - cameraPosition), dlN = normalize(vDN);
  float dlFw = length(fwidth(vDP));                                         // metres per pixel
  // the strata: a band every year (4 quarters, 3.77 m), each its own pallor; a darker seam where a year ends; world-space veining
  float dlYr = vDP.y / ${DEP.BAND.toFixed(2)}, dlB = floor(dlYr), dlF = fract(dlYr);
  float dlBand = .9 + .16 * dl_h1(vec3(dlB, 3., 1.)) - .1 * smoothstep(.86, .97, dlF) * (1. - smoothstep(.97, 1., dlF)) * (1. - smoothstep(.4, 1.2, dlFw));
  float dlVein = .94 + .1 * dl_n3(vDP * vec3(.08, .5, .08)) - .06 * dl_n3(vDP * .7);
  vec2 dlWin = dl_windows(vDP, dlV, dlN);
  // seen from far a window is a few pixels: fade the march to its mean mottle by footprint (they mottle through at frame-0 size)
  float dlFar = smoothstep(.1, .55, dlFw), dlMott = .16 * smoothstep(.35, .75, dl_n3(vDP * vec3(.3, .23, .3)));
  float dlCov = mix(dlWin.x, dlMott, dlFar), dlWrm = mix(dlWin.y, dlMott * .6, dlFar);
  diffuseColor.rgb *= dlBand * dlVein;
  diffuseColor.rgb = mix(diffuseColor.rgb, uDeadC, dlCov * .62);
  // the crown's fresh skin (held light): glossier and a little colder; runnels down it
  float dlCr = vCrown * clamp(uFreshK, 0., 1.);`;
const DEP_FS_ROUGH = `#include <roughnessmap_fragment>
  roughnessFactor = mix(roughnessFactor, .32, dlCr * .85);`;
const DEP_FS_EMIT = `#include <emissivemap_fragment>
  { // the held light: a cold glow from inside the crown, its newest windows a faint sheen; none of it its own (exactly held / cap)
    float yc = smoothstep(${(DEP.CROWN[0] - 20).toFixed(1)}, ${(DEP.CROWN[1] - 6).toFixed(1)}, vDP.y);
    float sss = .55 + .45 * dl_n3(vDP * .12 + vec3(0., uTime * .05, 0.));
    vec3 em = uColdC * uHeld * yc * (.05 + .10 * sss + .22 * dlWin.x * (1. - dlFar));
    // the beads: on each of the siphon's packets, a bead of the landed light runs down a runnel from the lip and sets pale (warm at its
    // head, cold behind: the living light turning into stone)
    float th = atan(vDP.z - uZC, vDP.x), fl = th * ${(26 / Math.PI).toFixed(5)}, id = floor(fl + .5), dx = (fl - id) * 6.3;
    float runnel = exp(-dx * dx / .35);
    for (int j = 0; j < 8; j++) { float age = uPk[j]; if (age < 0. || age > 2.6) continue;
      float hb = dl_h1(vec3(id, float(j), floor((uTime - age) * 2. + .5)));
      if (hb > .42) continue;
      float y0 = ${(DEP.CROWN[1] - 2).toFixed(1)} - 6. * hb, yb = y0 - 15. * pow(age / 2.6, .7);
      float dy = vDP.y - yb, head = exp(-dy * dy / 1.1) * runnel, trail = runnel * step(yb, vDP.y) * step(vDP.y, y0) * exp(-(vDP.y - yb) * .25);
      float life = exp(-age * 1.4) * uHeld;
      em += (mix(uColdC, uWarmC, .55 * exp(-age * 3.)) * head * 1.2 + uColdC * trail * .18) * life * (1. - dlFar * .7);
    }
    // the end: the city's returned light passes through the skin and lights the dead windows warm (transmission, not held light)
    em += uWarmC * uWarm * (dlWrm * .95 + .006 * (1. - dlFar));     // the windows warm; the stone itself stays dull (it must not read as capital surviving, golden)
    totalEmissiveRadiance += em; }`;
const DEP_FS_LIGHT = `#include <aomap_fragment>
  { // lit by what is round it: the night sky from above, the city's light from below (and through the crowd's streets), never its own
    float up = clamp(dlN.y * .5 + .5, 0., 1.), lo = exp(-max(vDP.y, 0.) / 110.);
    reflectedLight.indirectDiffuse += diffuseColor.rgb * (uSkyC * (.55 + .45 * up) + uUpC * uCityUp * (.35 + .65 * lo) * (1. - .5 * up)) / 3.14159; }`;

export function depositMaterial(U) {
  const m = new THREE.MeshStandardMaterial({ color: STONE, roughness: 0.9, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    for (const a of ['#include <common>', '#include <begin_vertex>', '#include <project_vertex>']) if (!sh.vertexShader.includes(a)) throw new Error('deadlabour: no ' + a + ' in the vertex shader');
    for (const a of ['#include <common>', '#include <color_fragment>', '#include <roughnessmap_fragment>', '#include <emissivemap_fragment>', '#include <aomap_fragment>']) if (!sh.fragmentShader.includes(a)) throw new Error('deadlabour: no ' + a + ' in the fragment shader');
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + DEP_VS_HEAD).replace('#include <begin_vertex>', DEP_VS_BEGIN).replace('#include <project_vertex>', DEP_VS_PROJ);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + DEP_FS_HEAD).replace('#include <color_fragment>', DEP_FS_COLOR)
      .replace('#include <roughnessmap_fragment>', DEP_FS_ROUGH).replace('#include <emissivemap_fragment>', DEP_FS_EMIT).replace('#include <aomap_fragment>', DEP_FS_LIGHT);
  };
  m.customProgramCacheKey = () => 'deadlabour_deposit2';
  return m;
}
// the drips' stone: the deposit's own lighting terms, no runnels (instanced lathe cones)
export function dripMaterial(U) {
  const dripMat = new THREE.MeshStandardMaterial({ color: STONE, roughness: 0.8, metalness: 0 });
  dripMat.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vDP2;').replace('#include <project_vertex>', `#include <project_vertex>
      { vec4 lp = vec4(transformed, 1.);
        #ifdef USE_INSTANCING
        lp = instanceMatrix * lp;
        #endif
        vDP2 = (modelMatrix * lp).xyz; }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vDP2; uniform float uHeld, uWarm, uCityUp; uniform vec3 uColdC, uWarmC, uSkyC, uUpC;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uWarmC * uWarm * .03 + uColdC * uHeld * .06 * smoothstep(${DEP.CROWN[0] - 30}., ${DEP.CROWN[1]}., vDP2.y);`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse += diffuseColor.rgb * (uSkyC * .7 + uUpC * uCityUp * (.35 + .65 * exp(-max(vDP2.y, 0.) / 110.))) / 3.14159;`); };
  dripMat.customProgramCacheKey = () => 'deadlabour_drip2';
  return dripMat;
}
export const DEPOSIT_GLSL = { DEP_VS_HEAD, DEP_VS_BEGIN, DEP_VS_PROJ, DEP_FS_HEAD, DEP_FS_COLOR, DEP_FS_ROUGH, DEP_FS_EMIT, DEP_FS_LIGHT };

// the body: 640 rings (two a quarter) x 192 segments, and a domed banded cap; aFresh: how far the held light swells it (the crown band),
// aCrown: the crown's fresh skin (gloss, runnels)
function depositGeometry() {
  const NR = 640, NS = 192, pos = [], fresh = [], crown = [], idx = [];
  const fr = (th, y) => sstep(DEP.CROWN[0], DEP.CROWN[0] + 22, y) * (0.75 + 0.5 * (0.5 + 0.5 * Math.sin(th * 7 + y * 0.05)));
  for (let i = 0; i <= NR; i++) { const y = DEP.H * i / NR;
    for (let j = 0; j < NS; j++) { const th = Math.PI * 2 * j / NS, p = surface(th, y); pos.push(...p); fresh.push(fr(th, y)); crown.push(sstep(DEP.CROWN[0] - 4, DEP.CROWN[0] + 14, y)); } }
  // the cap: rings shrinking to the axis, a low banded dome (3 m)
  const NC = 14, base = (NR + 1) * NS;
  for (let k = 1; k <= NC; k++) { const s = 1 - k / NC, y = DEP.H + 3.2 * (1 - s * s);
    for (let j = 0; j < NS; j++) { const th = Math.PI * 2 * j / NS, p = surface(th, DEP.H); pos.push(p[0] * s, y, DEP.ZC + (p[2] - DEP.ZC) * s); fresh.push(0.9); crown.push(1); } }
  const cen = pos.length / 3; pos.push(0, DEP.H + 3.4, DEP.ZC); fresh.push(1); crown.push(1);
  for (let i = 0; i < NR + NC; i++) for (let j = 0; j < NS; j++) {
    const a = i * NS + j, b = i * NS + (j + 1) % NS, c = (i + 1) * NS + j, d = (i + 1) * NS + (j + 1) % NS;
    idx.push(a, c, b, b, c, d);
  }
  const last = (NR + NC) * NS; for (let j = 0; j < NS; j++) idx.push(last + j, cen, last + (j + 1) % NS);
  void base;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFresh', new THREE.Float32BufferAttribute(fresh, 1));
  g.setAttribute('aCrown', new THREE.Float32BufferAttribute(crown, 1));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// the threads land on the deposit's surface, on the side facing their source, high in the crown, and come in along its normal
class DepositSiphon extends Siphon {
  _threads(R) {
    super._threads(R);
    let s = 1871; const r = () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    this.src.forEach((src, i) => { const T = this.th[i]; if (!T || this.sinkOf[i] !== 'body') return;
      const th = Math.atan2(src.p[2] - DEP.ZC, src.p[0]) + (r() - 0.5) * 0.7, y = DEP.CROWN[0] + 6 + r() * (DEP.CROWN[1] - DEP.CROWN[0] - 8);
      const n = normalAt(th, y), p = surface(th, y), n1 = [n[0], Math.max(0.1, n[1] * 0.3 + 0.12), n[2]], l = Math.hypot(...n1);
      for (let k = 0; k < 3; k++) n1[k] /= l;
      const p1 = [p[0] + n[0] * 0.5, p[1], p[2] + n[2] * 0.5], Lr = Math.min(Math.hypot(p1[0] - T.p0[0], p1[1] - T.p0[1], p1[2] - T.p0[2]), this.opt.reach);
      const c1 = [p1[0] + n1[0] * 0.3 * Lr, Math.max(4, p1[1] + n1[1] * 0.3 * Lr - Math.min(0.1 * Lr, 0.25 * p1[1])), p1[2] + n1[2] * 0.3 * Lr];
      Object.assign(T, { p1, n1, c1 });
    });
  }
}

export function buildWorld({ take = 'a' } = {}) {
  const Wd = new World({ scale: 2, shadows: 0, atmos: LOOK, far: 40000, near: 0.2 });
  const A = Wd.atmos, scene = Wd.scene;
  const lf = new LightField(A, { box: [-4600, -4600, 4600, 4600], res: 2048, haloPx: 24 });
  { const g = new THREE.PlaneGeometry(14000, 14000, 8, 8); g.rotateX(-Math.PI / 2); const m = new THREE.MeshStandardMaterial({ color: '#232427', roughness: 0.92 }); patchMaterial(m, lf, { gain: 0.5 });   // the paving: the sodium pools, not an orange floor
    const gr = new THREE.Mesh(g, m); gr.userData.noReflect = true; scene.add(gr); }
  // the city
  const sky = new CT.Skyline(Wd, lf, SKY_ROWS, { seed: SKY_SEED });
  const tiers = sky.rows.flatMap(r => r.tiers), tops = buildingTops(tiers);
  // each tier's building top into iseed.w (the facade's height-first order inside a building)
  sky.rows.forEach(r => { const m = r.meshes[0]; if (!m) return; const at = m.geometry.getAttribute('iseed'); r.tiers.forEach((t, i) => { at.array[i * 4 + 3] = tops.get(t.seed[0]) || 8; }); at.needsUpdate = true; });
  // the avenue's lamps (sodium, both kerbs, every 36 m) and the cross street's; the city's grid of streetlights
  for (let z = 60; z < 3600; z += 36) for (const s of [-1, 1]) lf.add({ pos: [s * 30, 9, z], color: AM.SODIUM, i: 1.8, core: 0.3, halo: 0.45, minPx: 1.2, pool: { r: 9, i: 12 } });
  for (let x = -420; x < 420; x += 34) { if (Math.abs(x) < 40) continue; for (const z of [201, 239]) lf.add({ pos: [x, 8, z], color: AM.SODIUM, i: 1.7, core: 0.3, halo: 0.45, minPx: 1.2, pool: { r: 9, i: 12 } }); }
  { const r = AM.rng(31);
    for (let i = 0; i < 1500; i++) { const ang = r() * Math.PI * 2, d = 160 + Math.pow(r(), 0.8) * 4300; if (r() < 0.3) continue;
      const x = Math.round(Math.cos(ang) * d / 90) * 90 + (r() - 0.5) * 8, z = Math.round(Math.sin(ang) * d / 90) * 90;
      if (Math.abs(x) < 60 && z > -40) continue;
      lf.add({ pos: [x, 8, z], color: r() < 0.7 ? AM.SODIUM : AM.LED, i: 1.8, core: 0.3, halo: 0.4, minPx: 1.1, pool: { r: 8, i: 12 } }); } }
  // the plaza's lamps: a ring of them round the deposit's foot, so the class is lit by the city, not by it
  for (let k = 0; k < 14; k++) { const a = Math.PI * (0.08 + 0.84 * k / 13); lf.add({ pos: [Math.cos(a) * 112, 8.5, DEP.ZC + Math.sin(a) * 140], color: AM.SODIUM, i: 1.6, core: 0.3, halo: 0.5, minPx: 1.3, pool: { r: 12, i: 9 } }); }
  A.setTowns([{ x: 0, z: 0, r: 3600, i: 0.5 }, { x: 0, z: 2600, r: 2600, i: 0.35 }, { x: -2400, z: -1200, r: 2400, i: 0.3 }, { x: 2400, z: -1200, r: 2400, i: 0.3 }]);
  lf.build(); lf.animated = false;

  // ---------------------------------------------------------------- THE DEPOSIT
  const U = { uFresh: { value: 0 }, uFreshK: { value: 0 }, uHeld: { value: 0 }, uWarm: { value: 0 }, uTime: { value: 0 }, uCityUp: { value: 1 }, uZC: { value: DEP.ZC },
    uPk: { value: new Array(8).fill(-1) }, uColdC: { value: new THREE.Color(COLD) }, uWarmC: { value: new THREE.Color('#ffb066') }, uDeadC: { value: new THREE.Color('#3e4640') },
    // the light round it: the night's skyglow (cool, from everywhere above) and the city's own light from below (sodium, softened by the
    // haze); together they leave the stone a pale cold grey at frame-0 size, under the eyes' white
    uSkyC: { value: new THREE.Color('#b08a7a').multiplyScalar(0.5) }, uUpC: { value: new THREE.Color('#f2b080').multiplyScalar(0.5) } };
  const depMat = depositMaterial(U); patchMaterial(depMat, lf, { wallFall: 22, gain: 0.7 });
  const deposit = new THREE.Mesh(depositGeometry(), depMat); deposit.frustumCulled = false; scene.add(deposit);
  // the drips: stone fringes, lathe cones, the deposit's own stone (the same lighting terms, no runnels)
  const DR = drips();
  const dripGeo = new THREE.LatheGeometry([[0.0, -1.0], [0.12, -0.96], [0.3, -0.8], [0.42, -0.55], [0.62, -0.25], [1.0, 0.0]].map(([r, y]) => new THREE.Vector2(r, y)), 8);
  const dripMat = dripMaterial(U);
  patchMaterial(dripMat, lf, { wallFall: 22, gain: 0.7 });
  const dripMesh = new THREE.InstancedMesh(dripGeo, dripMat, DR.length);
  { const o = new THREE.Object3D(); DR.forEach((d, i) => { o.position.set(...d.p); o.rotation.set(0, d.th, 0); o.scale.set(d.r, d.L, d.r); o.updateMatrix(); dripMesh.setMatrixAt(i, o.matrix); }); }
  dripMesh.instanceMatrix.needsUpdate = true; dripMesh.frustumCulled = false; scene.add(dripMesh);

  // ---------------------------------------------------------------- the siphon: the night shift's floors on the city's own towers
  const SRC = sampleSources(tiers, RINGS);
  const sy = new DepositSiphon(A.overlay, { max: 2400, seg: 24, width: 0.7, minPx: 1.6, maxPx: 9, warm: WARM, cold: COLD, lift: 0.3, sag: 0.1, curl: 0.07, seed: 1867,
    gain: 0.68, pkGain: 0.5, pkSig: 0.07, atmos: A });
  sy.sink('body', { p: [0, (DEP.CROWN[0] + DEP.CROWN[1]) / 2, DEP.ZC], r: 50 });
  for (const s of SRC) sy.source(s);
  for (const f of flowsFor()) sy.flow(f);
  sy.train(train()).build();
  // the windows: every facade drained and given back building by building (the ledger's own order: bRank), top floors first in each
  const ringsF = RINGS.map((g, k) => ({ ...g, r1: k === RINGS.length - 1 ? 9000 : g.r1 }));
  const drains = sky.rows.map(r => buildingDrain(r.meshes[0].material, sy, ringsF));
  // the lit crown bands under the tall towers' tops are window light too: they cool with the near city's mean
  const crownU = { uCW: { value: 1 } }, keepC = 0.5, coldC = new THREE.Color(DRAIN_COLD);
  sky.rows.forEach((r, ri) => { for (const m of r.meshes) { const mat = m.material; if (!(mat instanceof THREE.MeshBasicMaterial)) continue;
    mat.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, crownU, { uCC: { value: coldC } });
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uCW; uniform vec3 uCC;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          { float e = dot(diffuseColor.rgb, vec3(.2126, .7152, .0722)); diffuseColor.rgb = mix(uCC * e * ${keepC.toFixed(2)} * 2.2, diffuseColor.rgb, uCW); }`); };
    mat.customProgramCacheKey = () => 'deadlabour_crown2_' + ri; mat.needsUpdate = true; } });
  const near = SRC.map((s, i) => s.group === 'r1' ? i : -1).filter(i => i >= 0), all = SRC.map((_, i) => i);
  const meanLeft = (ids, t) => ids.reduce((a, i) => a + sy.left(i, t), 0) / ids.length;

  // ---------------------------------------------------------------- per frame
  function update(t, cam, viewH) {
    for (const d of drains) d.update(t);
    const held = sy.held('body', t) / sy.cap('body');
    sy.update(t, cam, viewH);
    const hs = Math.sqrt(clamp(held));                                   // the swell and the glow read the held light on a square-root scale (monotone: more held, more swollen)
    U.uHeld.value = hs; U.uFresh.value = DEP.FRESH * hs; U.uFreshK.value = clamp(hs * 1.3); U.uTime.value = t;
    for (let j = 0; j < 8; j++) U.uPk.value[j] = sy.U.uPk.value[j];
    const back = meanLeft(all, t), nearL = meanLeft(near, t);
    // the city's light through the skin: what has come home (the end), held back until the crown has drained
    U.uWarm.value = sstep(0.25, 1, back) * sstep(27, 34, t) * (0.85 + 0.15 * sstep(34, 38, t));
    U.uCityUp.value = 0.55 + 0.45 * nearL;
    crownU.uCW.value = nearL;
    return { held, back, near: nearL };
  }
  return { Wd, A, scene, lf, sky, deposit, depMat, U, sy, SRC, drains, update, tiers };
}

// an americana_city facadeMaterial's windows, drained and given back by the siphon BUILDING BY BUILDING: per ring (distance from the deposit's
// axis), a fragment's rank is its building's (the flows' own key, plan.bRank: the building's hash, then its floors from the top), so the
// windows go cold, and come back, one building at a time, top floors first in each: never a ring front spreading outward
export function buildingDrain(mat, sy, rings) {
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  const cc = new THREE.Color(DRAIN_COLD), L = 0.2126 * cc.r + 0.7152 * cc.g + 0.0722 * cc.b;
  const U = { uBdC: { value: new THREE.Vector2(0, DEP.ZC) }, uBdN: { value: rings.length }, uBdCold: { value: new THREE.Vector3(cc.r / L, cc.g / L, cc.b / L) }, uBdKeep: { value: 0.5 },
    uBdR: { value: Array.from({ length: 8 }, () => new THREE.Vector2(0, -1)) }, uBdP: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 0.1, 0.1)) } };
  rings.forEach((g, k) => U.uBdR.value[k].set(g.r0, g.r1));
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(mat, sh, r);
    const A = 'winEm *= uWG;';
    if (!sh.fragmentShader.includes(A)) throw new Error("deadlabour: 'winEm *= uWG;' not found in the facade shader (americana_city facadeMaterial changed)");
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform vec2 uBdC; uniform int uBdN; uniform vec3 uBdCold; uniform float uBdKeep; uniform vec2 uBdR[8]; uniform vec4 uBdP[8];`)
      .replace(A, `${A}
      { float dd = distance(vWP.xz, uBdC), warm = 1.;
        float bh = fract(vSeed.x * .7548776662 + .5698402910), rk = ${(1 - RANK_H).toFixed(3)} * bh + ${RANK_H.toFixed(3)} * (1. - clamp(vWP.y / max(8., vSeed.w), 0., 1.));
        for (int k = 0; k < 8; k++) { if (k >= uBdN) break; vec2 R = uBdR[k]; vec4 P = uBdP[k];
          if (dd < R.x || dd >= R.y) continue;
          float o = smoothstep(0., 1., clamp((P.x - rk * (1. - P.z)) / P.z, 0., 1.)), b = smoothstep(0., 1., clamp((P.y - rk * (1. - P.w)) / P.w, 0., 1.));
          warm = clamp(1. - o + b, 0., 1.); }
        float e = dot(winEm, vec3(.2126, .7152, .0722));
        winEm = mix(uBdCold * e * uBdKeep, winEm, warm); }`);
  };
  mat.customProgramCacheKey = () => prevKey() + '|dlbuild' + rings.length;
  mat.needsUpdate = true;
  const update = (t) => { rings.forEach((g, k) => { const F = sy.front(g.group, t); U.uBdP.value[k].set(F.drain, F.ret, F.dSpread, F.rSpread); }); };
  return { U, update };
}
