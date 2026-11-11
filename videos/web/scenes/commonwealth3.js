// COMMON WEALTH v8 — storm over the plain. The heartland goes red, town by town, hall by hall, until the whole
// plain is lit as one. Communism means common wealth. See you at the hall.
// A lit three.js landscape: a raymarched supercell over instanced wheat, real towns with grange and union halls
// that light and call the next town, the night network drawing the ACP mark, a god's-eye ascent, a red dawn.
import * as THREE from 'three';
import { W, H, C, loadFonts, loadBeats, loadImage, loadBrand, BRAND, clamp, lerp, ease, rng, smooth, Finish, sigil, seq, acpEmblem, tinted } from '../lib/kit.js';
import { RQ } from '../lib/rq.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { People } from '../lib/fx/people.js';
import { loadFace, shape, glyphs, look, cpuOut, canvas2d } from '../lib/fx/type.js';
import { Post } from '../lib/fx/post.js';
import { NOISE, HEIGHT, FSQ_VS, VOL_FS, COMP_FS } from './commonwealth3.gl.js';
import * as WD from './commonwealth3.world.js';
import { makeStorm } from './commonwealth3.storm.js';
import { Ranks } from '../lib/fx/ranks.js';
import { Stage, KITS } from '../lib/fx/folk_worlds.js';
import { castPeople, headingTo, lerpHeading, makeLantern } from './commonwealth3.persons.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ctx = cpuOut();
await loadFonts(); await loadBrand();
const B = await loadBeats('commonwealth3');
const logoImg = await loadImage('../assets/acp_logo.png');
const bebas = await loadFace('bebas'), shoulders = await loadFace('shoulders');
const anton = await loadFace('anton'), stencilF = await loadFace('stencil');
const finish = new Finish(1862);
const post = new Post(W, H);

// ---------------------------------------------------------------- words (scripts_final/commonwealth.json, exactly)
// v12 (cycle 4): 17 frames. ROBOTICS. / SOFTWARE. (lone label nouns, the 'learn to code' read) become SAME HANDS.:
// the picture carries the claim (Dot's glove on the cobot, Marcus's bare hand on the terminal). Place names live in
// the world (IOWA across the co-op's silos, OMAHA on the yard's water tower, OHIO on the cast house).
const cu = (s, e, text, red = 0, sec = 'storm') => ({ s, e, text, red: !!red, sec });
const CUES = [
  cu(0, 3.6, 'OHIO GOES RED.', 1), cu(4, 5.8, 'TOWN BY TOWN.'), cu(6, 7.8, 'HALL BY HALL.', 1),
  cu(8, 10, 'SMALL FARMERS.'), cu(12, 14, 'RAIL STRIKERS.'), cu(16, 18, 'STEELWORKERS.'), cu(20, 22, 'WE ALL UNITE.', 1, 'march'),
  cu(24, 26.5, 'OUR PARTY.', 1, 'banner'), cu(28, 30, 'UP SHE GOES.', 1, 'march'),
  cu(32, 33.8, 'THE NEXT TOWN.', 1, 'drop'), cu(34, 35.8, 'THE NEXT.', 0, 'drop'), cu(36, 38, 'SAME HANDS.', 1, 'drop'),
  cu(40, 41.8, 'LIT AS ONE.', 1, 'drop'), cu(42, 43.8, 'COMMON WEALTH!', 1, 'chant'), cu(44, 45.8, 'COMMON WEALTH!', 1, 'chant'),
  cu(48, 49.8, 'COMMUNISM.', 1, 'dawn'), cu(50, 57.5, 'COMMON WEALTH.', 1, 'pay'),
];
const CLOSE = 57.5;                     // the 1.4 s lockup over the last dawn frame (frame-0 camera), then the loop seam

// ---------------------------------------------------------------- renderer + passes
const ADOPT = false;   // GRAPHICS 4.A (lib/rq.js): true = native resolution on the GPU and a fenced copy, once this piece's farm A/B says so
const SC = RQ.scale(0.75, ADOPT), RW = Math.round(W * SC), RH = Math.round(H * SC);
// fixed-pixel sizes (gl_PointSize, the rain's width, the 1-px wires and rope) keep their displayed size at another scale: PK = SC / 0.75; at 0.75 nothing changes ('' in the shaders)
const PK = RQ.k(), PXM = RQ.glslMul(PK);
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); renderer.setSize(RW, RH, false);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
const rtScene = new THREE.WebGLRenderTarget(RW, RH, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(RW, RH, THREE.UnsignedIntType), samples: 0 });
rtScene.depthTexture.minFilter = rtScene.depthTexture.magFilter = THREE.NearestFilter;
const VW = Math.round(RW / 3), VH = Math.round(RH / 3);
const rtVol = new THREE.WebGLRenderTarget(VW, VH, { type: THREE.HalfFloatType, depthBuffer: false });
const fsq = new THREE.PlaneGeometry(2, 2);
const volMat = new THREE.ShaderMaterial({ vertexShader: FSQ_VS, fragmentShader: VOL_FS, depthTest: false, depthWrite: false, uniforms: {
  tDepth: { value: rtScene.depthTexture }, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCam: { value: new THREE.Vector3() },
  uTime: { value: 0 }, uFrame: { value: 0 }, uBase: { value: 1400 }, uTop: { value: 5200 }, uCover: { value: 0.6 }, uDens: { value: 0.012 }, uRain: { value: 1 },
  uHoleR: { value: 0 }, uEdge: { value: 0 }, uHoleC: { value: new THREE.Vector2() }, uWind: { value: new THREE.Vector2() },
  uCloudLo: { value: new THREE.Color() }, uCloudHi: { value: new THREE.Color() }, uRainCol: { value: new THREE.Color() }, uHorCol: { value: new THREE.Color() },
  uBoltPos: { value: new THREE.Vector3() }, uBoltCol: { value: new THREE.Color() }, uBoltI: { value: 0 },
  uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() }, uUnder: { value: 0 }, uNightGlow: { value: 0 }, uShelf: { value: new THREE.Vector4(0, -800, Math.PI / 2, 1) },
} });
const compMat = new THREE.ShaderMaterial({ vertexShader: FSQ_VS, fragmentShader: COMP_FS, depthTest: false, depthWrite: false, uniforms: {
  tColor: { value: rtScene.texture }, tDepth: { value: rtScene.depthTexture }, tVol: { value: rtVol.texture }, uVolRes: { value: new THREE.Vector2(VW, VH) },
  uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uViewProj: { value: new THREE.Matrix4() }, uCam: { value: new THREE.Vector3() },
  uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGnd: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() },
  uFogCol: { value: new THREE.Color() }, uSunDisc: { value: 0 }, uFogD: { value: 0 }, uFogH: { value: 300 }, uExpo: { value: 1 }, uRays: { value: 0 }, uFlash: { value: 0 },
  uTime: { value: 0 }, uStars: { value: 0 }, uGlowHor: { value: 0 }, uFlashCol: { value: new THREE.Color() }, uGlowCol: { value: new THREE.Color('#ff9a40') }, uSunUV: { value: new THREE.Vector2() },
} });
const volScene = new THREE.Scene(); volScene.add(new THREE.Mesh(fsq, volMat));
const compScene = new THREE.Scene(); compScene.add(new THREE.Mesh(fsq, compMat));
const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, RW / RH, 0.2, 60000);

// ---------------------------------------------------------------- lights
const hemi = new THREE.HemisphereLight(0x8080a0, 0x302418, 1); scene.add(hemi);
const key = new THREE.DirectionalLight(0xffffff, 1); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0006; key.shadow.normalBias = 0.05;
scene.add(key); scene.add(key.target);
const doorLight = new THREE.PointLight(0xffb25c, 0, 60, 1.6); scene.add(doorLight);
const fireLight = new THREE.PointLight(0xff6a1a, 0, 220, 1.4); scene.add(fireLight);

// ---------------------------------------------------------------- the world
const TX = WD.makeTextures();
const SIGN = WD.makeSignAtlas();
const mk = (map, nmap, o = {}) => new THREE.MeshStandardMaterial({ map, normalMap: nmap, vertexColors: true, roughness: 0.85, metalness: 0, ...o });
const MATS = {
  wood: mk(TX.wood, TX.woodN), clap: mk(TX.clap, TX.clapN), brick: mk(TX.brick, TX.brickN, { roughness: 0.9 }), corr: mk(TX.corr, TX.corrN, { metalness: 0.35, roughness: 0.55 }),
  conc: mk(TX.conc, TX.concN, { roughness: 0.92 }), roof: mk(TX.roof, TX.roofN, { roughness: 0.8 }), rust: mk(TX.corr, TX.corrN, { metalness: 0.2, roughness: 0.75 }),
  trim: mk(null, null, { roughness: 0.7 }), wood2: mk(TX.conc, null, { roughness: 0.9 }), door: mk(null, null, { roughness: 0.55 }),
  dark: mk(null, null, { metalness: 0.5, roughness: 0.5 }), steel: mk(TX.corr, null, { metalness: 0.45, roughness: 0.5 }), tank: mk(TX.conc, null, { metalness: 0.3, roughness: 0.5 }),
  glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.3, 0.04).multiplyScalar(1.9) }),
  lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.75, 0.4).multiplyScalar(6) }),
};
MATS.default = MATS.trim;
// the mill's openings: molten light with depth (hot core low, slag-dark bands, a slow churn), dimmed when shot close
const glowU = { uGT: { value: 0 }, uGK: { value: 1 } };
MATS.glow.onBeforeCompile = sh => { Object.assign(sh.uniforms, glowU);
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGP = position;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vGP; uniform float uGT, uGK;')
    .replace('#include <color_fragment>', `#include <color_fragment>
      float ch = sin(vGP.x * 1.7 + uGT * 1.3) * sin(vGP.y * 2.3 - uGT * 2.1 + vGP.z * 1.1) * 0.5 + 0.5;
      float band = smoothstep(0.35, 0.65, fract(vGP.y * 0.9 + 0.3 * sin(vGP.x * 0.8 + uGT)));
      diffuseColor.rgb *= uGK * mix(0.25, 1.15, ch * 0.6 + 0.4 * band) * mix(vec3(1.0), vec3(1.0, 0.55, 0.3), band * 0.6);`); };
for (const k of ['wood', 'clap', 'brick', 'corr', 'conc', 'roof', 'rust', 'steel', 'tank', 'wood2']) MATS[k].normalScale = new THREE.Vector2(0.8, 0.8);
// v12 (P1 b6): weathered clapboard: grime rising from the foundation (rain splash), streaks run down from every sill
// and eave, soot-dark under the eaves (ambient occlusion baked by height and a vertical streak field)
MATS.clap.onBeforeCompile = sh => {
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvCW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vCW;\nfloat h1c(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat n1c(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(h1c(i), h1c(i+vec2(1,0)), f.x), mix(h1c(i+vec2(0,1)), h1c(i+vec2(1,1)), f.x), f.y); }')
    .replace('#include <color_fragment>', `#include <color_fragment>
      float yl = fract((vCW.y + 60.0) / 400.0) * 400.0;                  // (towns sit near y 0..60: height above the local ground is approximated by the board's own world y)
      float streak = n1c(vec2((vCW.x + vCW.z) * 2.3, vCW.y * 0.12)) * n1c(vec2((vCW.x - vCW.z) * 0.7, vCW.y * 0.5));
      float splash = 1.0 - smoothstep(0.0, 1.4, vCW.y - floor(vCW.y / 1000.0) * 1000.0 - 0.0);
      diffuseColor.rgb *= mix(0.62, 1.0, smoothstep(0.08, 0.45, streak)) * (0.86 + 0.14 * n1c(vCW.xz * 0.9 + vCW.y * 0.3));`);
};
MATS.clap.customProgramCacheKey = () => 'cw-clap-v12';
const kit = new WD.Kit();
const R = rng(1862);

// towns: 0 = the first town (A), 1 = its grange hall, then B (the next town), the rail towns, the mill, the hamlets
const towns = [];
const addTown = (x, z, kind, opt) => { const t = WD.town(kit, towns.length + (kind === 'hero' ? 0 : 0), x, z, kind, 100 + towns.length * 7, opt); towns.push(t); return t; };
const A = addTown(0, 0, 'hero'); towns.push({ idx: 1, x: A.hall.door.x, z: A.hall.door.z, kind: 'hall', bright: 1.6 });
const Bt = addTown(-620, 905, 'hamlet');
for (const x of [-2560, -1280, 1280, 2560]) addTown(x, 0, 'rail', { grid: { w: 4, e: 4, n: 2, s: 5 } });   // v15: each at its real size
const Y = addTown(3840, 0, 'yard', { grid: { w: 3, e: 4, n: 2, s: 5 } });
const RT = towns.find(t => t.kind === 'rail' && t.x === 1280), SHOP = (RT.stores.find(q => q.sign === 13) || RT.stores[3]);
const Mt = addTown(-3840, 0, 'rail', { grid: { w: 1, e: 4, n: 2, s: 5 } });   // no blocks west: the mill
const MILL = { idx: towns.length, x: -4350, z: -330, kind: 'mill', bright: 1.8 };
towns.push(MILL);
MILL.parts = WD.mill(kit, WD.T(MILL.x, WD.hgt(MILL.x, MILL.z), MILL.z, 0.1), MILL.idx);
{ // hamlets on the grid, Poisson-spaced, clear of the mark
  const pts = towns.map(t => [t.x, t.z]);
  let tries = 0;
  while (towns.length < 58 && tries++ < 6000) {
    const gx = Math.round((R() - 0.5) * 30) * WD.G + 22, gz = WD.GZ0 + Math.round((R() - 0.65) * 26) * WD.G + 24;
    if (Math.abs(gx) > 5200 || gz > 3400 || gz < -6200) continue;
    if (Math.abs(gx - WD.MARK.x) < 900 && Math.abs(gz - WD.MARK.z) < 620) continue;
    if (Math.abs(gz - WD.RAILZ) < 260) continue;
    if (pts.some(p => Math.hypot(p[0] - gx, p[1] - gz) < 720)) continue;
    pts.push([gx, gz]); addTown(gx, gz, 'hamlet');
  }
}
const NT = towns.length;
// hero hall doors, the lit interior behind them, the flag
const hallM = WD.T(A.x + 45, A.y, A.z + 200);
const doorMat = new THREE.MeshStandardMaterial({ color: 0x5a2a1a, roughness: 0.55 });
const doors = [-1, 1].map(s => { const piv = new THREE.Object3D(); piv.position.set(45 + s * 1.2, A.y + 0.8, 200 + 11.06); const d = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.7, 0.1).translate(-s * 0.6, 1.35, 0), doorMat); d.castShadow = true; piv.add(d); scene.add(piv); return piv; });
// inside the first hall: a long table and benches, a charter and the banner on the back wall, bulbs, a warm light
const interior = new THREE.Group(); scene.add(interior);
{ const wood = new THREE.MeshStandardMaterial({ color: 0x7a5234, roughness: 0.7 }), fy = A.y + 0.83;
  const add = (g, m, x, y, z) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; interior.add(o); return o; };
  add(new THREE.BoxGeometry(1.1, 0.06, 7.5), wood, 45, fy + 0.76, 201.5);
  for (const dx of [-0.45, 0.45]) for (const dz of [-3.5, 3.5]) add(new THREE.BoxGeometry(0.07, 0.76, 0.07), wood, 45 + dx, fy + 0.38, 201.5 + dz);
  for (const s of [-1, 1]) { add(new THREE.BoxGeometry(0.34, 0.05, 7.2), wood, 45 + s * 0.95, fy + 0.45, 201.5); for (const dz of [-3.2, 0, 3.2]) add(new THREE.BoxGeometry(0.06, 0.45, 0.3), wood, 45 + s * 0.95, fy + 0.22, 201.5 + dz); }
  for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(0.28, 0.02, 0.36), new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.9 }), 45 + (i % 2 ? 0.25 : -0.25), fy + 0.8, 199 + i * 1.1);   // papers
  for (const z of [197, 201.5, 206]) { add(new THREE.CylinderGeometry(0.006, 0.006, 1.2, 4), new THREE.MeshBasicMaterial({ color: 0x141010 }), 45, fy + 4.35, z);
    add(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.75, 0.42).multiplyScalar(8) }), 45, fy + 3.7, z); }
  const bw = add(new THREE.PlaneGeometry(3.6, 1.8), new THREE.MeshStandardMaterial({ map: WD.bannerTexture(BRAND.acp_mark), roughness: 0.85 }), 45, fy + 2.6, 189.2);
  bw.castShadow = false; }
const hallLight = new THREE.PointLight(0xffb468, 0, 20, 1.3); hallLight.position.set(45, A.y + 3.9, 203); scene.add(hallLight);
const flagGeo = new THREE.PlaneGeometry(2.6, 1.6, 14, 6), flagBase = flagGeo.attributes.position.array.slice();
const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color: 0xb8141c, roughness: 0.8, side: THREE.DoubleSide }));
flag.position.copy(A.hall.flagTop).add(new THREE.Vector3(1.3, -0.9, 0)); flag.castShadow = true; scene.add(flag);
const charter = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.73), new THREE.MeshBasicMaterial({ map: WD.makeCharter(), color: new THREE.Color(1, 0.85, 0.6).multiplyScalar(1.4) }));
charter.position.set(45 - 3.9, A.y + 2.95, 200 + 11.12); scene.add(charter);

// rail: tracks laid on the land in 40 m pieces, instanced ties, a stopped grain train on the siding
for (const [z, x0, x1] of [[WD.RAILZ, -6000, 6000], [WD.RAILZ + 5, -700, 900]]) for (let x = x0; x < x1; x += 40) {
  const y = WD.hgt(x + 20, z);
  for (const s of [-0.72, 0.72]) { const M = WD.T(x + 20, y, z);
    kit.box('dark', M, 0, 0.28, s, 40.05, 0.014, 0.14, 0x3a302a); kit.box('dark', M, 0, 0.294, s, 40.05, 0.1, 0.018, 0x4a3e36); kit.box('steel', M, 0, 0.39, s, 40.05, 0.042, 0.068, 0x9a948c); }
}
const tieList = [];
for (const [z, x0, x1] of [[WD.RAILZ, -6000, 6000], [WD.RAILZ + 5, -700, 900]]) for (let x = x0; x < x1; x += 0.62) if (Math.abs(x) < 2000 || x % 1.24 < 0.62) tieList.push([x, z]);
const ties = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.16, 2.6), new THREE.MeshStandardMaterial({ color: 0x4a3a2e, roughness: 0.95 }), tieList.length);
tieList.forEach(([x, z], i) => { const m = new THREE.Matrix4().makeTranslation(x, WD.hgt(x, z) + 0.2, z); ties.setMatrixAt(i, m); });
ties.receiveShadow = true; scene.add(ties);
{ const r = rng(33); for (let i = 0; i < 26; i++) { const x = -520 + i * 18.4; WD.hopper(kit, WD.T(x, WD.hgt(x, WD.RAILZ + 5) + 0.35, WD.RAILZ + 5, Math.PI / 2), r); } }
// power line along the county road south of town: poles, crossarms, three sagging wires
const wirePts = [];
{ const z0 = WD.GZ0 + 9; for (let x = -1400; x <= 1400; x += 45) {
  const y = WD.hgt(x, z0), M = WD.T(x, y, z0, 0, 0, (Math.sin(x) * 0.03));
  kit.cyl('wood2', M, 0, 0, 0, 0.13, 0.17, 10.5, 0x5a4a3c, 8);
  kit.box('wood2', M, 0, 9.4, 0, 0.14, 0.14, 2.6, 0x5a4a3c, Math.PI / 2 * 0);
  kit.cyl('dark', M, 0, 9.55, 1.1, 0.06, 0.06, 0.25, 0x6a7a80, 6); kit.cyl('dark', M, 0, 9.55, -1.1, 0.06, 0.06, 0.25, 0x6a7a80, 6); kit.cyl('dark', M, 0, 10.5, 0, 0.06, 0.06, 0.2, 0x6a7a80, 6);
  if (x < 1400) for (const [dz, dy] of [[1.1, 9.8], [-1.1, 9.8], [0, 10.7]]) {
    const y1 = WD.hgt(x + 45, z0);
    for (let k = 0; k < 12; k++) { const u0 = k / 12, u1 = (k + 1) / 12, sag = u => -1.1 * 4 * u * (1 - u);
      wirePts.push(x + 45 * u0, lerp(y, y1, u0) + dy + sag(u0), z0 + dz, x + 45 * u1, lerp(y, y1, u1) + dy + sag(u1), z0 + dz); }
  }
} }
// the 1-px GL lines (wires, rope) at another scale: screen-space lines PK px wide (three/addons/lines, loaded only then)
const FAT = PK === 1 ? null : Object.assign({}, ...await Promise.all(['LineSegments2', 'LineSegmentsGeometry', 'Line2', 'LineGeometry', 'LineMaterial'].map(n => import(`three/addons/lines/${n}.js`))));
const fatMat = color => new FAT.LineMaterial({ color, linewidth: PK, fog: true, resolution: new THREE.Vector2(RW, RH) });
const wires = !FAT ? new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3)), new THREE.LineBasicMaterial({ color: 0x1a1618 }))
  : new FAT.LineSegments2(new FAT.LineSegmentsGeometry().setPositions(wirePts), fatMat(0x1a1618));
scene.add(wires);

// signs: one quad per sign, uv into the atlas
{ const pos = [], uv = [];
  for (const s of kit.signs) { const v0 = 1 - (s.idx + 1) / SIGN.n, v1 = 1 - s.idx / SIGN.n;
    const P = [[-s.w / 2, 0, v0, 0], [s.w / 2, 0, v0, 1], [s.w / 2, s.h, v1, 1], [-s.w / 2, s.h, v1, 0]];
    for (const i of [0, 1, 2, 0, 2, 3]) { const v = new THREE.Vector3(P[i][0], P[i][1] - s.h / 2, 0.08).applyMatrix4(s.M); pos.push(v.x, v.y, v.z); uv.push(P[i][3], P[i][2]); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: SIGN.tex, roughness: 0.75 })); m.receiveShadow = true; scene.add(m); }

// the crossroads south of town where the three roads meet (WE ALL UNITE.): one lamp on a pole
WD.streetlight(kit, WD.T(0, WD.hgt(7.5, 512), 0), 7.5, 512, -Math.PI / 2, 0);

// buildings: merged per material
for (const m of WD.meshes(kit, MATS)) scene.add(m);
// v12: the place names painted at bin height (P5): IOWA across the co-op's silos, OMAHA round the yard's water tower
{ const io = towns.find(t => t.kind === 'rail' && t.x === -1280); scene.add(WD.siloLetters(io.elev, 'IOWA'));
  const tw = new THREE.Vector3(0, 0, 0).applyMatrix4(Y.towerM); scene.add(WD.bowlLetters(Y.towerM, Y.towerH, 'OMAHA', Math.atan2(-44, 96))); }

// windows: one mesh, lit per town through uLit[]
const uLit = { value: new Float32Array(96) };
const winMat = new THREE.MeshStandardMaterial({ map: TX.win, emissiveMap: TX.winE, emissive: new THREE.Color(1, 0.72, 0.4), emissiveIntensity: 5.5, roughness: 0.18, metalness: 0.1 });
const hallU = { uHallT: { value: 0 }, uHallK: { value: 0 }, uHallY: { value: 0 } };
winMat.onBeforeCompile = sh => {
  sh.uniforms.uLit = uLit; Object.assign(sh.uniforms, hallU);
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aTown; attribute float aBright; varying float vEm; varying float vTw; varying vec3 vWP; uniform float uLit[96];')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTw = aTown; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vEm = aBright * uLit[int(aTown)] * (1.0 - smoothstep(260.0, 700.0, distance(cameraPosition, vWP)));');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vEm; varying float vTw; varying vec3 vWP; uniform float uHallT, uHallK, uHallY;')
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance *= vEm;
      if (vTw > 0.5 && vTw < 1.5 && uHallK > 0.0) {          // the first hall is full: people crossing behind the blinds
        float a = vWP.x + vWP.z, y = vWP.y - uHallY, sh = 0.0;
        for (int k = 0; k < 6; k++) { float fk = float(k);
          float c = mod(uHallT * (0.55 + 0.23 * fk) * (mod(fk, 2.0) < 1.0 ? 1.0 : -1.0) + fk * 5.3, 26.0) + 250.0 - 13.0 + fk * 0.7;
          float body = smoothstep(0.34, 0.2, abs(a - c)) * step(y, 3.55 + 0.1 * fk);
          float head = smoothstep(0.17, 0.11, length(vec2(a - c, (y - 3.85 - 0.1 * fk) * 0.9)));
          sh = max(sh, max(body, head)); }
        float slat = 0.82 + 0.18 * step(0.28, fract(y * 8.0));
        totalEmissiveRadiance *= mix(1.0, 0.18, sh * uHallK) * mix(1.0, slat, uHallK);
      }`);
};
{ const w = kit.win, g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(w.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(w.nrm, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(w.uv, 2));
  g.setAttribute('aTown', new THREE.Float32BufferAttribute(w.town, 1)); g.setAttribute('aBright', new THREE.Float32BufferAttribute(w.bright, 1));
  const m = new THREE.Mesh(g, winMat); m.receiveShadow = true; scene.add(m); }

// ---------------------------------------------------------------- land: town/built masks for the field shader and the wheat
const LAND = { x0: -10000, z0: -10000, size: 20000, n: 512 };
const landTex = (() => {
  const n = LAND.n, d = new Uint8Array(n * n * 4), cell = LAND.size / n;
  const paint = (x, z, rad, ch, v) => {        // a soft disc brush on the land mask (built ground / the mill's yard), not a graphic
    const i0 = Math.floor((x - rad - LAND.x0) / cell), i1 = Math.ceil((x + rad - LAND.x0) / cell), j0 = Math.floor((z - rad - LAND.z0) / cell), j1 = Math.ceil((z + rad - LAND.z0) / cell);
    for (let j = Math.max(0, j0); j <= Math.min(n - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(n - 1, i1); i++) {
      const px = LAND.x0 + (i + 0.5) * cell, pz = LAND.z0 + (j + 0.5) * cell, q = 1 - clamp((Math.hypot(px - x, pz - z) - rad * 0.75) / (rad * 0.25));
      d[(j * n + i) * 4 + ch] = Math.max(d[(j * n + i) * 4 + ch], q * v);
    } };
  for (const t of towns) {
    if (t.kind === 'hall') continue;
    if (t.kind === 'hero') { paint(t.x, t.z - 10, 150, 0, 255); paint(t.x + 45, t.z + 205, 34, 0, 255); }
    else if (t.kind === 'rail' || t.kind === 'yard') paint(t.x, t.z - 10, t.kind === 'yard' ? 200 : 150, 0, 255);
    else if (t.kind === 'mill') paint(t.x + 20, t.z - 20, 190, 1, 255);
    else paint(t.x, t.z - 10, 85, 0, 255);
    if (t.gridRect) { const [x0, z0, x1, z1] = t.gridRect;                 // v15: the town's blocks are built ground (lawns and lots), not wheat
      for (let x = x0 + 30; x < x1; x += 60) for (let z = z0 + 30; z < z1; z += 60) paint(x, z, 52, 0, 255); }
  }
  const tx = new THREE.DataTexture(d, n, n, THREE.RGBAFormat); tx.magFilter = tx.minFilter = THREE.LinearFilter; tx.needsUpdate = true; return tx;
})();
const FIELD = /* glsl */`
uniform sampler2D tLand;
uniform vec3 uLandTf;
uniform float uT, uGust; uniform vec2 uWindDir;
vec4 land(vec2 p){ return texture2D(tLand, (p - uLandTf.xy) / uLandTf.z); }
float roadD(vec2 p){ float dx = abs(mod(p.x + 160.0, 320.0) - 160.0); float dz = abs(mod(p.y - 185.0 + 160.0, 320.0) - 160.0); return min(dx, dz); }
float crop(vec2 p){
  if (p.x > -900.0 && p.x < 900.0 && p.y > 150.0 && p.y < 2400.0) return 0.0;
  vec2 q = vec2(p.x, p.y - 185.0);
  vec2 sec = floor(q / 320.0); float hs = hash12(sec + 1.7);
  if (hs < 0.42) {                                   // a centre pivot: a circle of one crop, the corners another
    float r = length(q - (sec + 0.5) * 320.0);
    float inner = hash12(sec + 9.1);
    if (r < 152.0) return inner < 0.55 ? 0.0 : inner < 0.8 ? 2.0 : 1.0;
    return hash12(sec + 4.4) < 0.5 ? 1.0 : 3.0;
  }
  if (hs < 0.55) { float band = floor((hash12(sec) < 0.5 ? q.x : q.y) / 40.0); return mod(band, 2.0) < 1.0 ? 0.0 : 1.0; }   // strip cropping
  vec2 c = floor(q / 160.0); float h = hash12(c + 7.3);
  return h < 0.55 ? 0.0 : h < 0.7 ? 1.0 : h < 0.85 ? 2.0 : 3.0;
}
float railD(vec2 p){ return min(abs(p.y + 60.0), (p.x > -700.0 && p.x < 900.0) ? abs(p.y + 55.0) : 1e4); }
float wheatHere(vec2 p){
  vec4 L = land(p);
  return step(crop(p), 0.5) * (1.0 - smoothstep(0.02, 0.2, L.r + L.g)) * smoothstep(5.5, 7.5, roadD(p)) * smoothstep(7.0, 10.0, railD(p));
}
float windAmp(vec2 p){
  float ph = dot(p, uWindDir) * 0.05 - uT * 2.4;
  float w = 0.5 + 0.5 * sin(ph); w *= w;
  float g = vnoise2(p * 0.011 - uWindDir * uT * 0.7);
  return uGust * (0.2 + 0.8 * w * (0.35 + 0.9 * g));
}
`;
const landU = { tLand: { value: landTex }, uLandTf: { value: new THREE.Vector3(LAND.x0, LAND.z0, LAND.size) }, uT: { value: 0 }, uGust: { value: 1 }, uWindDir: { value: new THREE.Vector2(0.8, -0.6) } };

// terrain: one lit plane, fields / roads / towns / ballast painted by the shader
const terrGeo = new THREE.PlaneGeometry(24000, 24000, 480, 480); terrGeo.rotateX(-Math.PI / 2);
{ const p = terrGeo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, WD.hgt(p.getX(i), p.getZ(i))); terrGeo.computeVertexNormals(); }
const terrMat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
terrMat.onBeforeCompile = sh => {
  Object.assign(sh.uniforms, landU, { uWet: wetU, uNightDk: nightDkU });
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vW; uniform float uWet, uNightDk;\n' + NOISE + FIELD)
    .replace('#include <color_fragment>', /* glsl */`
      vec2 p = vW.xz; vec4 L = land(p); float c = crop(p); float rd = roadD(p);
      float n1 = fbm2(p * 0.02), n2 = vnoise2(p * 0.35);
      float fw = fwidth(p.x) + fwidth(p.y);
      vec2 cell = floor(vec2(p.x, p.y - 185.0) / 160.0); float along = hash12(cell + 3.1) < 0.5 ? p.x : p.y;
      float rows = mix(0.5 + 0.5 * sin(along * 8.2), 0.5, smoothstep(0.08, 0.5, fw));
      vec3 wheat = mix(vec3(0.36, 0.22, 0.045), vec3(0.55, 0.36, 0.08), n1) * (0.9 + 0.2 * n2);
      wheat *= 0.86 + 0.28 * windAmp(p);
      vec3 stub = mix(vec3(0.42, 0.33, 0.17), vec3(0.5, 0.4, 0.22), n1) * (0.85 + 0.2 * rows);
      vec3 green = mix(vec3(0.07, 0.12, 0.025), vec3(0.12, 0.18, 0.04), n1) * (0.75 + 0.35 * rows);
      vec3 soil = mix(vec3(0.06, 0.035, 0.018), vec3(0.1, 0.06, 0.03), n1) * (0.8 + 0.3 * rows);
      vec3 col = c < 0.5 ? wheat : c < 1.5 ? stub : c < 2.5 ? green : soil;
      vec3 lawn = mix(vec3(0.09, 0.13, 0.035), vec3(0.2, 0.19, 0.08), n1);
      vec3 lot = mix(vec3(0.13, 0.115, 0.09), vec3(0.07, 0.065, 0.06), n2);
      col = mix(col, mix(lawn, lot, smoothstep(0.55, 0.75, vnoise2(p * 0.06))), L.r);
      col = mix(col, vec3(0.1, 0.085, 0.075) * (0.8 + 0.4 * n2), L.g);
      float road = 1.0 - smoothstep(3.5, 5.0, rd);
      vec3 grav = mix(vec3(0.17, 0.15, 0.12), vec3(0.24, 0.21, 0.17), n2) * (0.85 + 0.3 * hash12(floor(p * 6.0)));
      col = mix(col, vec3(0.06, 0.05, 0.035), (1.0 - smoothstep(5.0, 6.5, rd)) * (1.0 - road) * 0.7);   // ditches
      col = mix(col, grav, road);
      float ms = (abs(p.y - 30.0) < 85.0 && abs(p.x) < 4500.0) ? 1.0 - smoothstep(8.0, 9.5, abs(mod(p.x + 640.0, 1280.0) - 640.0)) : 0.0;
      col = mix(col, vec3(0.045, 0.042, 0.04) * (0.8 + 0.4 * n2), ms);
      float pud = L.r * smoothstep(0.62, 0.7, fbm2(p * 0.09)) ;
      col *= 1.0 - 0.55 * pud;
      float bal = 1.0 - smoothstep(2.4, 3.8, railD(p));
      vec2 st = p * 26.0 + vec2(vnoise2(p * 9.0), vnoise2(p * 9.0 + 9.0)) * 0.7; vec2 sc0 = floor(st); float stone = 0.45 + 0.55 * hash12(sc0) * smoothstep(0.75, 0.3, length(fract(st) - 0.5 - (vec2(hash12(sc0 + 3.0), hash12(sc0 + 5.0)) - 0.5) * 0.3));
      col = mix(col, mix(vec3(0.07, 0.065, 0.06), vec3(0.2, 0.19, 0.17), stone) * (0.85 + 0.3 * vnoise2(p * 2.0)), bal);
      diffuseColor.rgb = mix(col, vec3(dot(col, vec3(.3, .55, .15))) * vec3(.34, .3, .3), uNightDk);   // v12: the night plain near black, no field quilt, no white road grid
      float wetK = uWet * (road * 0.8 + bal * 0.5 + L.r * 0.3 + ms + pud);
    `)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.62, clamp(wetK, 0.0, 1.0));');
};
const wetU = { value: 1 }, nightDkU = { value: 0 };
const terrain = new THREE.Mesh(terrGeo, terrMat); terrain.receiveShadow = true; scene.add(terrain);

// ---------------------------------------------------------------- wheat: four instanced LOD rings that wrap with the camera
function ribbon(pos, nrm, part, pts, w, pid, plane) {       // a strip along pts in `plane` (unit vec perpendicular to the strip)
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], wa = w(i / (pts.length - 1)), wb = w((i + 1) / (pts.length - 1));
    const q = [[a[0] - plane[0] * wa, a[1], a[2] - plane[2] * wa], [a[0] + plane[0] * wa, a[1], a[2] + plane[2] * wa], [b[0] + plane[0] * wb, b[1], b[2] + plane[2] * wb], [b[0] - plane[0] * wb, b[1], b[2] - plane[2] * wb]];
    for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(...q[k]); nrm.push(plane[2] * 0.4, 0.9, -plane[0] * 0.4); part.push(pid + (k === 2 || k === 3 ? (i + 1) : i) / (pts.length - 1) * 0.5); }
  }
}
function stemGeo(lod) {
  const pos = [], nrm = [], part = [];
  const segs = lod === 0 ? 5 : lod === 1 ? 3 : 1, lean = 0.03;
  const stalk = Array.from({ length: segs + 1 }, (_, i) => { const u = i / segs; return [lean * u * u, 0.9 * u, 0]; });
  const sw = lod === 0 ? 0.004 : lod === 1 ? 0.006 : 0.012;
  ribbon(pos, nrm, part, stalk, () => sw, 0, [1, 0, 0]);
  if (lod === 0) ribbon(pos, nrm, part, stalk, () => sw, 0, [0, 0, 1]);
  if (lod <= 1) { const lf = Array.from({ length: 5 }, (_, i) => { const u = i / 4; return [0.02 + u * 0.2, 0.28 + u * 0.22 - u * u * 0.18, u * 0.04]; }); ribbon(pos, nrm, part, lf, u => 0.012 * (1 - u) + 0.002, 1, [0.2, 0, 0.98]); }
  // head: spikelets alternating up the rachis, awns streaming up
  const hx = lean, hy = 0.9, HL = 0.095;
  if (lod === 0) {
    for (let i = 0; i < 8; i++) for (const s of [-1, 1]) for (const pl of [[1, 0, 0], [0, 0, 1]]) {
      const y = hy + (i + (s > 0 ? 0.5 : 0)) / 8 * HL, r = 0.009 * (1 - i / 11);
      const bx = hx + pl[0] * s * r, bz = pl[2] * s * r;
      const quad = [[hx, y, 0], [bx + pl[0] * s * 0.002, y + 0.007, bz + pl[2] * s * 0.002], [hx + pl[0] * s * r * 0.4, y + 0.019, pl[2] * s * r * 0.4], [hx, y + 0.012, 0]];
      for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(...quad[k]); nrm.push(pl[0] * s * 0.5, 0.8, pl[2] * s * 0.5); part.push(2.5); }
      const ax = hx + pl[0] * s * r * 0.4, az = pl[2] * s * r * 0.4, ay = y + 0.019, L = 0.055 + 0.02 * (i % 3) / 2;
      const tip = [ax + pl[0] * s * L * 0.28, ay + L, az + pl[2] * s * L * 0.28];
      const aw = [[ax - 0.0012, ay, az - 0.0012 * pl[0]], [ax + 0.0012, ay, az + 0.0012 * pl[0]], tip];
      for (const v of aw) { pos.push(...v); nrm.push(pl[0] * s * 0.3, 0.9, pl[2] * s * 0.3); part.push(3.5); }
    }
  } else {
    const hw = lod === 1 ? 0.012 : 0.022, hl = lod === 1 ? HL : HL * 1.3;
    for (const pl of [[1, 0, 0], [0, 0, 1]]) {
      const P = [[hx, hy, 0], [hx + pl[0] * hw, hy + hl * 0.3, pl[2] * hw], [hx, hy + hl, 0], [hx - pl[0] * hw, hy + hl * 0.3, -pl[2] * hw]];
      for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(...P[k]); nrm.push(0, 1, 0); part.push(2.5); }
      if (lod === 1) for (const s of [-1, 1]) { const b = [hx + pl[0] * s * hw * 0.5, hy + hl * 0.6, pl[2] * s * hw * 0.5];
        for (const v of [[b[0] - 0.0015, b[1], b[2]], [b[0] + 0.0015, b[1], b[2]], [b[0] + pl[0] * s * 0.02, b[1] + 0.06, b[2] + pl[2] * s * 0.02]]) { pos.push(...v); nrm.push(0, 1, 0); part.push(3.5); } }
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  return g;
}
const wheatU = { uCamP: { value: new THREE.Vector3() }, uKeyDir: { value: new THREE.Vector3() }, uKeyCol: { value: new THREE.Color() }, uRed: { value: 0 } };
function wheatLayer(lod, tile, count, scale, seed) {
  const g = stemGeo(lod), r = rng(seed), a = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) { a[i * 4] = r() * tile; a[i * 4 + 1] = r() * tile; a[i * 4 + 2] = (0.82 + r() * 0.3) * scale; a[i * 4 + 3] = r() * 6.283; }
  g.setAttribute('aInst', new THREE.InstancedBufferAttribute(a, 4)); g.instanceCount = count;
  const m = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, landU, wheatU, { uTile: { value: tile }, uLod: { value: lod } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aInst; attribute float aPart; uniform vec3 uCamP; uniform float uTile, uLod; varying float vPart; varying float vHue; varying float vY;\n' + NOISE + HEIGHT + FIELD)
      .replace('#include <beginnormal_vertex>', /* glsl */`
        vec2 org = uCamP.xz - uTile * 0.5;
        vec2 base = org + mod(aInst.xy - org, uTile);
        float dcam = length(base - uCamP.xz);
        float keep = wheatHere(base) * (1.0 - smoothstep(uTile * 0.36, uTile * 0.5, dcam));
        float sc = aInst.z * keep;
        float ca = cos(aInst.w), sa = sin(aInst.w);
        vec3 objectNormal = vec3(ca * normal.x + sa * normal.z, normal.y, -sa * normal.x + ca * normal.z);
        vPart = aPart; vHue = fract(aInst.x * 7.13 + aInst.y * 3.7); vY = position.y;
      `)
      .replace('#include <begin_vertex>', /* glsl */`
        vec3 lp = position * sc;
        lp = vec3(ca * lp.x + sa * lp.z, lp.y, -sa * lp.x + ca * lp.z);
        float amp = windAmp(base) * (0.8 + 0.4 * vHue);
        float hh = lp.y / max(sc, 0.01);
        vec2 wd = normalize(uWindDir + vec2(0.3 * sin(uT * 1.7 + vHue * 6.0), 0.2 * cos(uT * 1.3 + vHue * 5.0)) * 0.4);
        float bend = amp * 0.55 * hh * hh + 0.03 * sin(uT * 3.1 + vHue * 20.0) * hh * hh;
        lp.xz += wd * bend * sc;
        lp.y -= 0.5 * bend * bend * sc;
        vec3 transformed = lp + vec3(base.x, hgt(base), base.y);
      `);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vPart; varying float vHue; varying float vY; uniform vec3 uKeyDir, uKeyCol; uniform float uRed;')
      .replace('#include <color_fragment>', /* glsl */`
        vec3 ripe = mix(vec3(0.62, 0.40, 0.085), vec3(0.52, 0.42, 0.12), vHue);
        vec3 stalkC = mix(vec3(0.42, 0.3, 0.07), vec3(0.3, 0.3, 0.07), vHue) * (0.3 + 0.7 * smoothstep(0.0, 0.8, vY));
        vec3 leafC = vec3(0.3, 0.26, 0.07);
        vec3 awnC = vec3(0.8, 0.62, 0.3);
        diffuseColor.rgb = vPart < 1.0 ? stalkC : vPart < 2.0 ? leafC : vPart < 3.0 ? ripe : awnC;
      `)
      .replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0; vec3 normal = normalize(vNormal); vec3 nonPerturbedNormal = normal;')
      .replace('#include <emissivemap_fragment>', /* glsl */`
        vec3 vdir = normalize(vViewPosition);
        float back = pow(max(dot(-vdir, normalize((viewMatrix * vec4(uKeyDir, 0.0)).xyz)), 0.0), 3.0);
        totalEmissiveRadiance += diffuseColor.rgb * uKeyCol * back * (vPart > 2.0 ? 0.9 : 0.35);
      `);
  };
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.receiveShadow = true; scene.add(mesh);
  return mesh;
}
const wheat = [wheatLayer(0, 7, 4200, 1, 11), wheatLayer(1, 26, 14000, 1, 12), wheatLayer(2, 90, 16000, 1.05, 13), wheatLayer(2, 300, 18000, 1.25, 14)];

// ---------------------------------------------------------------- rain: streaks wrapped around the camera
const rainGeo = new THREE.InstancedBufferGeometry();
rainGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
{ const r = rng(4), n = 7000, a = new Float32Array(n * 4); for (let i = 0; i < n * 4; i++) a[i] = r(); rainGeo.setAttribute('aR', new THREE.InstancedBufferAttribute(a, 4)); rainGeo.instanceCount = n; }
const rainMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uCamP: { value: new THREE.Vector3() }, uT: { value: 0 }, uI: { value: 0 }, uFlash: { value: 0 }, uCol: { value: new THREE.Color() }, uPx: { value: 0.001 } },
  vertexShader: /* glsl */`attribute vec4 aR; uniform vec3 uCamP; uniform float uT, uPx; varying float vA; varying float vX;
    void main(){ float S = 36.0; vec3 org = uCamP - S * 0.5;
      vec3 p = vec3(aR.x, 0.0, aR.y) * S; float fall = 11.0 + aR.w * 4.0; p.y = mod(aR.z * S - uT * fall, S);
      p = org + mod(p - org, S) ;
      vec3 vel = normalize(vec3(2.2, -fall, -1.6));
      vec3 wp = p + vel * position.y * 0.9;
      vec4 mv = viewMatrix * vec4(wp, 1.0);
      vec3 side = normalize(cross((viewMatrix * vec4(vel, 0.0)).xyz, vec3(0.0, 0.0, 1.0)));
      mv.xyz += side * position.x * 1.3 * uPx * -mv.z;
      vA = smoothstep(0.8, 3.0, -mv.z) * (1.0 - smoothstep(10.0, 18.0, -mv.z)); vX = position.x;
      gl_Position = projectionMatrix * mv; }`,
  fragmentShader: /* glsl */`uniform float uI, uFlash; uniform vec3 uCol; varying float vA; varying float vX; void main(){ gl_FragColor = vec4(uCol * (0.22 + uFlash * 1.2) * uI * vA, 1.0); }` });
const rain = new THREE.Mesh(rainGeo, rainMat); rain.frustumCulled = false; scene.add(rain);

// ---------------------------------------------------------------- the network of light: roads between towns, town lights, the mark
const lightTowns = towns.filter(t => t.kind !== 'hall');
const tIndex = new Map(lightTowns.map((t, i) => [t, i]));
const edges = WD.network(lightTowns, R);
if (!edges.some(([a, b]) => (lightTowns[a] === A && lightTowns[b] === Bt) || (lightTowns[b] === A && lightTowns[a] === Bt))) edges.push([tIndex.get(A), tIndex.get(Bt)]);
// ignition: A's hall on LIGHTS UP (28), it calls B (30 -> 32), then outward along the graph to the last town on 40
const adj = lightTowns.map(() => []);
edges.forEach(([a, b]) => { const d = Math.abs(lightTowns[a].x - lightTowns[b].x) + Math.abs(lightTowns[a].z - lightTowns[b].z); adj[a].push([b, d]); adj[b].push([a, d]); });
const dist = lightTowns.map(() => Infinity), iB = tIndex.get(Bt), iA = tIndex.get(A);
dist[iB] = 0; { const Q = [iB]; while (Q.length) { Q.sort((a, b) => dist[a] - dist[b]); const u = Q.shift(); for (const [v, d] of adj[u]) if (dist[u] + d < dist[v]) { dist[v] = dist[u] + d; Q.push(v); } } }
const maxD = Math.max(...dist.filter(Number.isFinite));
lightTowns.forEach((t, i) => { t.ign = i === iA ? 32.2 : i === iB ? 32 : 32.6 + 7.2 * Math.pow(dist[i] / maxD, 0.8); });
towns[1].ign = 28;
function roadRibbon(paths, wmul = 1) {        // paths: [{pts:[[x,z]...], t0, t1, bright}]
  const P = [], side = [], perp = [], S = [], LEN = [], T0 = [], T1 = [], BR = [];
  for (const p of paths) {
    let s = 0; const segs = [];
    for (let i = 0; i < p.pts.length - 1; i++) { const a = p.pts[i], b = p.pts[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 0.01) continue; segs.push([a, b, s, l]); s += l; }
    for (const [a, b, s0, l] of segs) {
      const n = Math.max(1, Math.ceil(l / 60)), dx = (b[0] - a[0]) / l, dz = (b[1] - a[1]) / l;
      for (let k = 0; k < n; k++) {
        const u0 = k / n, u1 = (k + 1) / n, pa = [a[0] + (b[0] - a[0]) * u0, a[1] + (b[1] - a[1]) * u0], pb = [a[0] + (b[0] - a[0]) * u1, a[1] + (b[1] - a[1]) * u1];
        const q = [[pa, -1, s0 + l * u0], [pa, 1, s0 + l * u0], [pb, 1, s0 + l * u1], [pb, -1, s0 + l * u1]];
        for (const i of [0, 1, 2, 0, 2, 3]) { const [pp, sd, ss] = q[i]; P.push(pp[0], WD.hgt(pp[0], pp[1]) + 1.2, pp[1]); side.push(sd); perp.push(-dz, dx); S.push(ss); LEN.push(s); T0.push(p.t0); T1.push(p.t1); BR.push(p.bright); }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1)); g.setAttribute('aPerp', new THREE.Float32BufferAttribute(perp, 2));
  g.setAttribute('aS', new THREE.Float32BufferAttribute(S, 1)); g.setAttribute('aLen', new THREE.Float32BufferAttribute(LEN, 1)); g.setAttribute('aT0', new THREE.Float32BufferAttribute(T0, 1)); g.setAttribute('aT1', new THREE.Float32BufferAttribute(T1, 1)); g.setAttribute('aBr', new THREE.Float32BufferAttribute(BR, 1));
  const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uBeat: { value: 0 }, uW: { value: 4 }, uI: { value: 1 }, uT: { value: 0 } },
    vertexShader: /* glsl */`attribute float aSide, aS, aLen, aT0, aT1, aBr; attribute vec2 aPerp; uniform float uW; varying float vSide, vS, vLen, vT0, vT1, vBr;
      void main(){ vec3 p = position; p.xz += aPerp * aSide * uW * ${wmul.toFixed(2)}; vSide = aSide; vS = aS; vLen = aLen; vT0 = aT0; vT1 = aT1; vBr = aBr; gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
    fragmentShader: /* glsl */`uniform float uBeat, uI, uT; varying float vSide, vS, vLen, vT0, vT1, vBr;
      void main(){ float u = clamp((uBeat - vT0) / max(vT1 - vT0, 0.01), 0.0, 1.0); float head = u * vLen;
        if (vS > head) discard;
        float g = exp(-vSide * vSide * 40.0) + 0.22 * exp(-vSide * vSide * 3.0);
        float hot = exp(-(head - vS) / 35.0) * (u < 1.0 ? 1.0 : 0.0);
        float flow = smoothstep(0.82, 1.0, sin(vS * 0.022 - uT * 7.0 + vBr * 5.0));
        vec3 c = vec3(1.0, 0.62, 0.3) * (0.28 + 1.3 * flow) * vBr + vec3(1.0, 0.85, 0.6) * hot * 6.0;
        gl_FragColor = vec4(c * g * uI, 1.0); }` });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; scene.add(mesh); return mesh;
}
const roadPaths = edges.map(([a, b]) => {
  let u = lightTowns[a], v = lightTowns[b]; if (u.ign > v.ign) [u, v] = [v, u];
  if (v === A) [u, v] = [v, u];
  const ab = u === A && v === Bt, t0 = ab ? 30 : u === A ? 32.2 : u.ign, t1 = ab ? 32 : Math.max(v.ign, t0 + 0.6);
  // along the section roads: out along z to v's latitude, then along x
  const zc = Math.round((v.z - WD.GZ0) / WD.G) * WD.G + WD.GZ0, xc = Math.round(u.x / WD.G) * WD.G;
  return { pts: [[u.x, u.z], [xc, u.z], [xc, zc], [v.x, zc], [v.x, v.z]], t0, t1, bright: ab ? 2.6 + 0 * R() : 0.6 + 0.8 * R() };
});
const roads = roadRibbon(roadPaths);
// town lights: every window, porch lamp and streetlight as a point (the plain from the air)
const pxU = { value: 1000 };                 // pixels per radian-ish: RH / (2 tan(fov/2))
const ptsMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uLit, uPxR: pxU, uFade: { value: 1 } },
  vertexShader: /* glsl */`attribute float aTown, aBright; uniform float uLit[96]; uniform float uPxR, uFade; varying float vB;
    void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); float d = -mv.z; vB = aBright * uLit[int(aTown)] * uFade * smoothstep(120.0, 400.0, d);
      float sz = 4.0 * uPxR / d; vB *= min(1.0, sz / 1.6) * 1.8; gl_PointSize = clamp(sz, 1.3, 3.2)${PXM}; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: /* glsl */`varying float vB; void main(){ vec2 q = gl_PointCoord - 0.5; float f = exp(-dot(q, q) * 10.0); gl_FragColor = vec4(vec3(1.0, 0.7, 0.36) * vB * f * 3.0, 1.0); }` });
{ const g = new THREE.BufferGeometry(), p = [], tw = [], br = [];
  for (const q of kit.pts) { p.push(q[0], q[1], q[2]); tw.push(q[3]); br.push(q[4]); }
  // farmsteads between the towns: a yard light each, lit with the nearest town
  const r = rng(91);
  for (let i = 0; i < 3200; i++) { const x = (r() - 0.5) * 11000, z = -6400 + r() * 9600;
    if (Math.abs(x - WD.MARK.x) < 800 && Math.abs(z - WD.MARK.z) < 520) continue;
    let bi = 0, bd = 1e9; lightTowns.forEach((t, k) => { const d = Math.hypot(t.x - x, t.z - z); if (d < bd) { bd = d; bi = t.idx; } });
    p.push(x, WD.hgt(x, z) + 5, z); tw.push(bi); br.push(0.25 + r() * r() * 1.4); }
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('aTown', new THREE.Float32BufferAttribute(tw, 1)); g.setAttribute('aBright', new THREE.Float32BufferAttribute(br, 1));
  const m = new THREE.Points(g, ptsMat); m.frustumCulled = false; scene.add(m); }
const PSITES = WD.plantSites(lightTowns, [A], rng(2718));      // the plants the network raises (drawn further down)
// town glow: the light a lit town throws up into the rain and down onto its fields
const glowMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, uniforms: { uLit, uPxR: pxU, uFade: { value: 1 } },
  vertexShader: /* glsl */`attribute float aTown, aR; uniform float uLit[96]; uniform float uPxR, uFade; varying float vB;
    void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); float d = -mv.z; vB = uLit[int(aTown)] * uFade * smoothstep(500.0, 1400.0, cameraPosition.y);
      gl_PointSize = clamp(aR * uPxR / d, 2.0, 256.0)${PXM}; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: /* glsl */`varying float vB; void main(){ vec2 q = gl_PointCoord - 0.5; float r2 = dot(q, q) * 4.0; if (r2 > 1.0) discard; float f = exp(-r2 * 4.0) * (1.0 - r2);
    gl_FragColor = vec4(vec3(1.0, 0.5, 0.18) * vB * f * 0.75, 1.0); }` });
{ const p = [], tw = [], rr = [];
  for (const t of lightTowns) { p.push(t.x, WD.hgt(t.x, t.z) + 20, t.z - 10); tw.push(t.idx); rr.push(t.kind === 'hamlet' ? 150 : t.kind === 'mill' ? 320 : 260); }   // a furnace-glow at each town's own size, not a node
  for (const s of PSITES) { p.push(s.x, s.y + 25, s.z); tw.push(s.town.idx); rr.push(s.L * 1.1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('aTown', new THREE.Float32BufferAttribute(tw, 1)); g.setAttribute('aR', new THREE.Float32BufferAttribute(rr, 1));
  const m = new THREE.Points(g, glowMat); m.frustumCulled = false; scene.add(m); }
// the mark: its outline as roads of light, its body as halls and farmsteads, lit last (42-46)
const MS = WD.markShape(logoImg);
const markPaths = MS.polys.map((poly, i) => ({ pts: [...poly, poly[0]].map(([u, v]) => [WD.MARK.x + u * WD.MARK.w, WD.MARK.z + v * WD.MARK.w]), t0: 42 + (i % 5) * 0.25, t1: 45.2 + (i % 3) * 0.2, bright: 1.6 }));
const markRoads = roadRibbon(markPaths, 1.0);
const markMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uBeat: { value: 0 }, uPxR: pxU },
  vertexShader: /* glsl */`attribute float aT0, aBright; uniform float uBeat, uPxR; varying float vB;
    void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); float u = clamp((uBeat - aT0) / 0.35, 0.0, 1.0); vB = aBright * u * (1.0 + 1.5 * exp(-(uBeat - aT0) * 3.0) * step(aT0, uBeat));
      gl_PointSize = clamp(22.0 * uPxR / -mv.z, 3.0, 14.0)${PXM}; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: /* glsl */`varying float vB; void main(){ vec2 q = gl_PointCoord - 0.5; float f = exp(-dot(q, q) * 5.0); gl_FragColor = vec4(vec3(1.0, 0.2, 0.07) * min(vB, 1.2) * f * 2.4, 1.0); }` });
{ const p = [], t0 = [], br = [], r = rng(17), step = 17;
  for (let v = -0.5; v <= 0.5; v += step / WD.MARK.w) for (let u = -0.5; u <= 0.5; u += step / WD.MARK.w) {
    const uu = u + (r() - 0.5) * 0.35 * step / WD.MARK.w, vv = v + (r() - 0.5) * 0.35 * step / WD.MARK.w;
    if (!MS.inside(uu, vv)) continue;
    const x = WD.MARK.x + uu * WD.MARK.w, z = WD.MARK.z + vv * WD.MARK.w;
    p.push(x, WD.hgt(x, z) + 4, z); t0.push(42 + 3.2 * clamp(Math.hypot(uu + 0.3, vv) / 0.85) + r() * 0.3); br.push(0.35 + r() * r() * 1.5);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('aT0', new THREE.Float32BufferAttribute(t0, 1)); g.setAttribute('aBright', new THREE.Float32BufferAttribute(br, 1));
  const m = new THREE.Points(g, markMat); m.frustumCulled = false; scene.add(m); }

// ---------------------------------------------------------------- the people (lib/fx/people.js): real bodies in real work clothes
// Three named workers carry the piece: DOT (Iowa farmer, red seed cap), MARCUS (Omaha rail striker, rail cap, lantern)
// and RAY (Ohio melter, aluminized coat, visor). The roll call streams become one column behind the Party's banner,
// fill the hall, and raise the first steel. Framing rule: people are shot at 1-6 m, cropped and in mass; beyond
// ~45 m they are shown only as lantern light, never as tiny full-body figures.
const folk = new People(scene, { max: 240, viewH: RH, lodPx: [230, 80], budget: [18, 120], shadows: 'proxy' });
const PA = People.API;
// v11 people rule (GRAPHICS_ROADMAP: no front-lit faces at mid distance or closer): a scene-local silhouette pass on the
// shared people materials. uSil 1 = a flat Malevich colour plate (albedo x uFlat, no shading, no features) with a rim
// of the scene's backlight (lightning, lantern, furnace, lamp) along the edge that faces it.
const SIL = { uSil: { value: 0 }, uFlat: { value: 0.035 }, uRimK: { value: 0.9 }, uRimCol: { value: new THREE.Color(1, 0.7, 0.4) }, uRimDir: { value: new THREE.Vector3(0, 0, -1) } };
function silPatch() { for (const m of folk.meshes) { const mat = m.material; if (!mat || mat.userData.cwSil) continue; mat.userData.cwSil = true;
  const ob0 = mat.onBeforeCompile, ck = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (sh, r) => { ob0.call(mat, sh, r); Object.assign(sh.uniforms, SIL);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uSil, uFlat, uRimK; uniform vec3 uRimCol, uRimDir;')
      .replace('#include <opaque_fragment>', `{ vec3 vd = normalize(vViewPosition); float fr = pow(1.0 - clamp(dot(normal, vd), 0.0, 1.0), 2.4);
          float side = smoothstep(-0.2, 0.8, dot(normal, uRimDir));
          vec3 sil = diffuseColor.rgb * uFlat + uRimCol * fr * side * uRimK;
          outgoingLight = mix(outgoingLight, sil, uSil); }
        #include <opaque_fragment>`); };
  mat.customProgramCacheKey = () => ck() + '-cwsil'; mat.needsUpdate = true; } }
silPatch();
const DOT = folk.add(People.random('farm', 3, { fem: 1, age: 0.72, h: 1.66, heavy: 0.45, skin: '#e3b08c', hair: '#b8b2aa', hairStyle: 3, top: '#8a6232', bottom: '#2c3e5e', hat: true, hatColor: '#a0141a', accent: '#e8e0c8', gloves: true, dirt: 0.35, beard: false, stubble: false }));
const MARCUS = folk.add(People.random('rail', 11, { fem: 0, age: 0.42, h: 1.85, heavy: 0.55, skin: '#5e3a26', hair: '#1a120c', hairStyle: 1, top: '#7a5430', bottom: '#26344e', hat: true, hatColor: '#2a3a6a', accent: '#3a2618', beard: true, stubble: true, gloves: false, dirt: 0.3 }));
const RAY = folk.add(People.random('weld', 21, { fem: 0, age: 0.5, h: 1.82, heavy: 0.62, skin: '#d09a74', hair: '#3e2a1a', hairStyle: 1, top: '#b4b8bc', bottom: '#3a3226', hat: false, accent: '#3a2618', gloves: true, beard: false, stubble: true, dirt: 0.55 }));
const ROBO = folk.add(People.random('steel', 31, { fem: 1, age: 0.18, h: 1.7, heavy: 0.3, skin: '#9a6446', hair: '#1a120c', hairStyle: 3, top: '#3a4452', bottom: '#3a3a3c', hat: true, hatColor: '#e8e4dc', accent: '#c8f020', gloves: true, dirt: 0.15 }));
const HEROES = [DOT, MARCUS, RAY, ROBO];
// v15 (16 Oct): the three named workers as real people from the person pipeline (commonwealth3.persons.js) wherever a face
// or a hand is the point; the folk figures above stay as the fallback (a role that fails to build keeps its old figure)
const PP = await castPeople(scene, { dot: 'L06_f53_white', marcus: 'L21_m32_black', ray: 'L23_m45_white' });
const CROWD = [];
{ const r = rng(404), tr = ['farm', 'farm', 'farm', 'rail', 'rail', 'steel', 'steel', 'overalls', 'overalls', 'weld'];
  for (let i = 0; i < 200; i++) {                  // every build and age: heavy and slight, young and old, short and tall
    const o = People.random(tr[Math.floor(r() * tr.length)], 500 + i, { dirt: 0.2 + r() * 0.5 });
    o.heavy = clamp(r() * 1.05); o.age = clamp(r() * 0.9); o.h *= 0.95 + r() * 0.1;
    if (o.trade === 'farm' || o.trade === 'rail') o.hat = r() < 0.9;               // seed caps and striped rail caps stay on
    CROWD.push(folk.add(o)); } }
// the crowd by trade: the roll call casts each region in its own clothes, and the column keeps them mixed
const TRADE = t => CROWD.filter(id => t.includes(folk.get(id).d.trade));
const FARM = TRADE(['farm', 'overalls']), RAILW = TRADE(['rail']), STEELW = TRADE(['steel', 'weld']);
// who carries a lantern (Marcus always; a share of the crowd, weighted to the rail strikers)
const LANTERN = new Set([MARCUS]);
CROWD.forEach((id, i) => { const tr = folk.get(id).d.trade; if ((tr === 'rail' && i % 2 === 0) || i % 5 === 1) LANTERN.add(id); });

// ground under a person (the hall's porch floor and steps are built above the land)
function gy(x, z) {
  const lx = x - (A.x + 45), lz = z - (A.z + 200);
  if (Math.abs(lx) < 3.2 && lz > 11 && lz < 14.2) return A.y + 0.8;
  if (Math.abs(lx) < 1.6 && lz >= 14.2 && lz < 15.3) return A.y + (lz < 14.6 ? 0.5 : lz < 14.95 ? 0.35 : 0.2);
  if (Math.abs(lx) < 6.9 && lz > -11.3 && lz < 11.3) return A.y + 0.8;
  if (Math.abs(x - 66) < 7.5 && z > 190 && z < 217.5) return PLANT.root.position.y + 0.14;
  return WD.hgt(x, z);
}
const heading = (dx, dz) => Math.atan2(dx, dz);
// place one person this frame
function put(id, x, z, s = {}) { folk.set(id, { x, y: gy(x, z), z, heading: 0, act: 'stand', t: T_NOW, ph: 0, amt: 1, pump: null, both: false, look: 0, lift: 0, mix: null, speed: 1, pose: null, propArm: null, visible: true, ...s }); }
let T_NOW = 0;
// a walking stride phase for a distance walked (1.35 m/s ~ 5.6 rad/s)
const stride = (d, ph0 = 0) => ph0 + d * 4.15;

// ---- scene poses (added on top of the act through st.pose)
const armSet = (Pz, s, ux, uy, uz, fx, curl, hand = 0) => { const [ua, fa, hn, fg] = PA.ARM(s); Pz[ua * 3] = ux; Pz[ua * 3 + 1] = uy; Pz[ua * 3 + 2] = uz; Pz[fa * 3] = fx; Pz[fa * 3 + 1] = 0; Pz[fa * 3 + 2] = 0; Pz[hn * 3] = hand; Pz[fg * 3 + 2] = -s * curl; };
const POSE = {
  clasp: (Pz, st) => { armSet(Pz, -1, -1.05 - (st.lift2 ?? 0), 0.3, 0.05, -0.55, 1.5, -0.15); Pz[PA.B.chest * 3] += 0.06; Pz[PA.B.head * 3] -= 0.05; },
  pole: (Pz) => { armSet(Pz, -1, -1.55, 0.3, -0.15, -1.25, 1.65, 0.2); armSet(Pz, 1, -0.55, -0.35, 0.15, -1.3, 1.6, 0.1); },
  poleUp: (Pz, st) => { const k = st.lift2 ?? 1; armSet(Pz, -1, lerp(-0.6, -1.55, k), 0.3, -0.15, lerp(-1.4, -1.25, k), 1.65, 0.2); armSet(Pz, 1, -0.55, -0.35, 0.15, -1.3, 1.6, 0.1); },
  pike: (Pz) => { armSet(Pz, -1, -2.25, 0.2, -0.1, -0.35, 1.6, 0.1); armSet(Pz, 1, -2.05, -0.2, 0.1, -0.45, 1.6, 0.1); Pz[PA.B.chest * 3] += 0.18; Pz[PA.B.spine * 3] += 0.12; Pz[PA.B.head * 3] -= 0.35; },
  rope: (Pz) => { armSet(Pz, -1, -1.25, 0.1, -0.05, -0.25, 1.7, 0); armSet(Pz, 1, -1.1, -0.1, 0.05, -0.35, 1.7, 0); Pz[PA.B.chest * 3] -= 0.12; Pz[PA.B.spine * 3] -= 0.16; Pz[PA.NB * 3 + 2] = -0.1;
    for (const s of [1, -1]) { const [th, sh, ft] = PA.LEG(s); Pz[th * 3] = s > 0 ? -0.55 : 0.25; Pz[sh * 3] = s > 0 ? 0.35 : 0.1; Pz[ft * 3] = -Pz[th * 3] - Pz[sh * 3]; } },
  lanternUp: (Pz) => { armSet(Pz, -1, -2.55, 0.05, -0.18, -0.2, 1.6, 0.0); Pz[PA.B.head * 3] -= 0.15; },
  lookUp: (Pz) => { Pz[PA.B.head * 3] -= 0.32; Pz[PA.B.chest * 3] -= 0.06; },
  guide: (Pz, st) => { armSet(Pz, -1, lerp(-0.8, -2.0, st.lift2 ?? 0.5), 0.25, 0.1, -0.35, 1.3, 0.15); armSet(Pz, 1, -0.5, -0.25, 0.1, -0.9, 0.9, 0); Pz[PA.B.head * 3] += 0.18; Pz[PA.B.chest * 3] += 0.08; },
  touch: (Pz, st) => { armSet(Pz, -1, lerp(-0.6, -1.6, st.lift2 ?? 0.5), 0.35, 0.05, -0.8, 0.25, -0.1); Pz[PA.B.head * 3] += 0.12; Pz[PA.B.head * 3 + 1] += 0.15; },
  visor: (Pz, st) => { const k = st.lift2 ?? 0; armSet(Pz, 1, lerp(-0.1, -2.7, k), -0.2, lerp(0.07, -0.4, k), lerp(-0.2, -1.9, k), 1.2, 0.2); },
};
const withPose = (...fs) => (Pz, st) => { for (const f of fs) f(Pz, st); };

// ---- lanterns: near ones are meshes hung from a grip (and the three nearest light the scene); far ones are points
const LN = 28;
const lanternDark = new THREE.InstancedMesh(mergeGeometries([
  new THREE.CylinderGeometry(0.085, 0.095, 0.03, 12).translate(0, 0.0, 0),            // base
  new THREE.CylinderGeometry(0.05, 0.085, 0.05, 12).translate(0, 0.27, 0),             // cap
  ...[0, 1, 2, 3].map(k => new THREE.BoxGeometry(0.008, 0.25, 0.008).translate(Math.cos(k * 1.57 + 0.78) * 0.07, 0.14, Math.sin(k * 1.57 + 0.78) * 0.07)),
  new THREE.TorusGeometry(0.07, 0.006, 5, 14, Math.PI).translate(0, 0.3, 0),           // bail
].map(g => g.toNonIndexed())), new THREE.MeshStandardMaterial({ color: 0x3a1c14, roughness: 0.5, metalness: 0.6 }), LN);
const lanternGlass = new THREE.InstancedMesh(new THREE.SphereGeometry(0.062, 14, 10).scale(1, 1.45, 1).translate(0, 0.14, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.66, 0.3).multiplyScalar(7) }), LN);
for (const m of [lanternDark, lanternGlass]) { m.frustumCulled = false; m.count = 0; scene.add(m); }
lanternDark.castShadow = true;
const lanternLights = [0, 1, 2].map(() => { const l = new THREE.PointLight(0xffa050, 0, 14, 1.7); scene.add(l); return l; });
const heroFill = new THREE.PointLight(0xff8a3a, 0, 12, 1.6); scene.add(heroFill);          // a motivated fill: furnace spill, lamp, screen
const crossLight = new THREE.PointLight(0xffb870, 0, 30, 1.5); scene.add(crossLight);
const arcLight = new THREE.PointLight(0xc8d8ff, 0, 60, 1.4); scene.add(arcLight);
const FARN = 4000, farPos = new Float32Array(FARN * 3), farB = new Float32Array(FARN);
const farGeo = new THREE.BufferGeometry(); farGeo.setAttribute('position', new THREE.BufferAttribute(farPos, 3)); farGeo.setAttribute('aB', new THREE.BufferAttribute(farB, 1));
const farMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uPxR: pxU },
  vertexShader: /* glsl */`attribute float aB; uniform float uPxR; varying float vB; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); float d = -mv.z;
    float sz = 0.9 * uPxR / d; vB = aB * min(1.0, sz / 1.5); gl_PointSize = clamp(sz, 1.5, 14.0)${PXM}; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: /* glsl */`varying float vB; void main(){ vec2 q = gl_PointCoord - 0.5; float r2 = dot(q, q); float f = exp(-r2 * 30.0) + 0.25 * exp(-r2 * 6.0); gl_FragColor = vec4(vec3(1.0, 0.72, 0.38) * vB * f * 3.2, 1.0); }` });
const farPts = new THREE.Points(farGeo, farMat); farPts.frustumCulled = false; scene.add(farPts);
let farN = 0;
const farAdd = (x, y, z, b = 1) => { if (farN >= FARN) return; farPos[farN * 3] = x; farPos[farN * 3 + 1] = y; farPos[farN * 3 + 2] = z; farB[farN] = b; farN++; };

// ---- Ray's hard hat with the aluminized face shield on a hinge (flipped up, lowered on 17)
const rayHat = new THREE.Group(); scene.add(rayHat);
{ const shell = new THREE.MeshStandardMaterial({ color: 0xd8d6d0, roughness: 0.35, metalness: 0.1 });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.148, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.82, 1.12), shell); dome.position.set(0, 0.105, 0.012); dome.castShadow = true;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.175, 0.012, 22).scale(1, 1, 1.18), shell); brim.position.set(0, 0.105, 0.02);
  rayHat.add(dome, brim);
  const hinge = new THREE.Group(); hinge.position.set(0, 0.105, 0.012); rayHat.add(hinge); rayHat.userData.hinge = hinge;
  const vis = new THREE.Mesh(new THREE.CylinderGeometry(0.162, 0.15, 0.17, 20, 1, true, -1.15, 2.3).translate(0, -0.085, 0), new THREE.MeshStandardMaterial({ color: 0xb8904a, roughness: 0.2, metalness: 1, side: THREE.DoubleSide }));
  vis.scale.set(1, 1, 1.12); hinge.add(vis);
  for (const s of [-1, 1]) { const k = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 10).rotateZ(Math.PI / 2), shell); k.position.set(s * 0.152, 0, 0); hinge.add(k); } }

// ---- the banner: two poles, a crossbar and the red cloth with the ACP hammer and sickle
const banner = new THREE.Group(); scene.add(banner);
const poleMat = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.7 });
const poles = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 3.7, 8).translate(0, 1.85, 0), poleMat); m.castShadow = true; banner.add(m); return m; });
const finials = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.14, 8), new THREE.MeshStandardMaterial({ color: 0xc8a040, roughness: 0.3, metalness: 0.9 })); banner.add(m); return m; });
const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 6), poleMat); banner.add(bar);
const clothGeo = new THREE.PlaneGeometry(1, 1, 24, 10), clothBase = clothGeo.attributes.position.array.slice();
const bannerTex = WD.bannerTexture(BRAND.acp_mark);
const cloth = new THREE.Mesh(clothGeo, new THREE.MeshStandardMaterial({ map: bannerTex, emissiveMap: bannerTex, emissive: new THREE.Color(0.22, 0.2, 0.18), roughness: 0.85, side: THREE.DoubleSide })); cloth.castShadow = true; banner.add(cloth);
const furl = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 1.35, 12), new THREE.MeshStandardMaterial({ color: 0x9a1016, roughness: 0.85 })); banner.add(furl);
// place the banner between two pole bases; open 0..1 (furled at pole A), wave amplitude; A/B are world Vector3 (pole foot)
function setBanner(A0, B0, { open = 1, wave = 1, t = 0, tilt = 0 } = {}) {
  banner.visible = true;
  const up = V(0, 1, 0), dir = B0.clone().sub(A0); const span = Math.max(0.3, dir.length()); dir.normalize();
  const tops = [A0, B0].map((p, i) => { const ax = V(Math.sin(tilt) * (i ? -1 : 1) * 0, Math.cos(tilt), 0); const top = p.clone().add(up.clone().multiplyScalar(3.62)); return top; });
  [A0, B0].forEach((p, i) => { poles[i].position.copy(p); poles[i].rotation.set(0, 0, 0); finials[i].position.copy(tops[i]).add(V(0, 0.08, 0)); });
  const mid = tops[0].clone().lerp(tops[1], 0.5).add(V(0, -0.12, 0));
  bar.position.copy(mid); bar.scale.set(1, span, 1); bar.quaternion.setFromUnitVectors(up, dir);
  const w = span, h = 1.55 * clamp(open, 0.001, 1.2);
  const p = clothGeo.attributes.position, n = V(dir.z, 0, -dir.x);
  for (let i = 0; i < p.count; i++) {
    const u = clothBase[i * 3] + 0.5, v = 0.5 - clothBase[i * 3 + 1];                          // u along the bar, v down
    const flap = (Math.sin(u * 7 - t * 9) * 0.1 + Math.sin(u * 13 - t * 15 + v * 3) * 0.035) * wave * (0.4 + v) + Math.sin(u * 3.14) * 0.05 * wave;
    const q = tops[0].clone().addScaledVector(dir, 0.04 + u * (w - 0.08)).add(V(0, -0.14 - v * h + Math.sin(u * 3.14) * 0.03 * v, 0)).addScaledVector(n, flap * clamp(open));
    p.setXYZ(i, q.x, q.y, q.z);
  }
  p.needsUpdate = true; clothGeo.computeVertexNormals(); clothGeo.computeBoundingSphere();
  cloth.visible = open > 0.03; furl.visible = open < 0.97;
  const fr = 0.075 * (1 - clamp(open)) + 0.02;
  furl.position.copy(tops[0]).lerp(tops[1], 0.5).add(V(0, -0.14 - h - fr * 0.6, 0)); furl.scale.set(fr / 0.075, span * 0.94 / 1.35, fr / 0.075); furl.quaternion.setFromUnitVectors(up, dir);
}

// ---- Plant No. 1 beside the first hall: the bent the column raises on IT CALLS, then the bay it becomes
const PLANT = WD.plantNo1(MATS, V(66, WD.hgt(66, 208), 216.2)); scene.add(PLANT.root);
// the Party's banner hung on the second bent of the new plant (seen from the aerials on in, and behind the cobot)
const hungBanner = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.8), new THREE.MeshStandardMaterial({ map: bannerTex, emissiveMap: bannerTex, emissive: new THREE.Color(0.25, 0.22, 0.2), roughness: 0.85, side: THREE.DoubleSide }));
hungBanner.position.set(66, PLANT.root.position.y + 5.7, 216.2 - 6 + 0.3); scene.add(hungBanner);
const COBOT = WD.cobot(); COBOT.root.position.set(67.3, PLANT.root.position.y + 0.14, 210.9); scene.add(COBOT.root);
const workBeam = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.34, 0.22).translate(0, 0.17, 0), PLANT.steel); workBeam.position.set(69.2, PLANT.root.position.y + 0.95, 209.9); workBeam.castShadow = true; scene.add(workBeam);
const RIG = [COBOT.root, workBeam];
for (const dx of [-1.5, 1.5]) { const sh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 0.7).translate(0, 0.4, 0), new THREE.MeshStandardMaterial({ color: 0x3a3a3e, roughness: 0.5, metalness: 0.5 })); sh.position.set(69.2 + dx, PLANT.root.position.y + 0.14, 209.9); sh.castShadow = true; scene.add(sh); RIG.push(sh); }
const TERM = WD.terminal(); TERM.root.position.set(63.2, PLANT.root.position.y + 0.14, 213.2); TERM.root.rotation.y = -Math.PI / 2 - 0.9; scene.add(TERM.root); RIG.push(TERM.root);
const rope = !FAT ? new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6 * 3), 3)), new THREE.LineBasicMaterial({ color: 0xe8d8b0 }))
  : new FAT.Line2(new FAT.LineGeometry().setPositions(new Float32Array(6 * 3)), fatMat(0xe8d8b0)); rope.frustumCulled = false; scene.add(rope);
const pikes = Array.from({ length: 8 }, () => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 1, 6).translate(0, 0.5, 0), poleMat); m.castShadow = true; scene.add(m); return m; });
const ginPole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 11.4, 10).translate(0, 5.7, 0), new THREE.MeshStandardMaterial({ color: 0x5a4430, roughness: 0.85 })); ginPole.castShadow = true; scene.add(ginPole);
const arcGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(200,215,255,0.8)'); gr.addColorStop(1, 'rgba(120,140,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); return t; })(), color: new THREE.Color(1, 1, 1).multiplyScalar(6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
arcGlow.scale.set(0.9, 0.9, 1); scene.add(arcGlow);
const lampGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: arcGlow.material.map, color: new THREE.Color(1, 0.62, 0.3).multiplyScalar(3.2), blending: THREE.AdditiveBlending, depthWrite: true, transparent: true }));
lampGlow.visible = false; scene.add(lampGlow);
// v12: the red lamp over the first hall's door (HALL BY HALL.): the same red as the elevator beacons
const doorRed = new THREE.Sprite(new THREE.SpriteMaterial({ map: arcGlow.material.map, color: new THREE.Color(1, 0.12, 0.05).multiplyScalar(6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
doorRed.position.copy(A.hall.door).add(V(0, 3.25, 0.45)); doorRed.scale.setScalar(1.4); scene.add(doorRed);
const doorRedCore = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.1, 0.04).multiplyScalar(9) })); doorRedCore.position.copy(doorRed.position); scene.add(doorRedCore);
const doorRedL = new THREE.PointLight(0xff2010, 0, 16, 1.5); doorRedL.position.copy(doorRed.position).add(V(0, -0.2, 0.7)); scene.add(doorRedL);             // WE ALL UNITE.: the crossroads lamp as a halo behind the clasp (the forearms in silhouette)
// v11 retimes 20-32 onto the v10 action: OB(new beat) -> the beat the cast, doors, plant and hall logic were written for
function OB(b) {
  if (b >= 20 && b < 22) return 20 + (b - 20) * 0.5;       // the clasp, held two beats
  if (b >= 22 && b < 24) return 21 + (b - 22) * 0.5;       // the crane (no text)
  if (b >= 26 && b < 28) return b + 2;                     // the doors open, the column files in (old 28-30)
  if (b >= 28 && b < 30) return 30 + (b - 28) * 0.5;       // UP SHE GOES.: the raise (old 30-31)
  if (b >= 30 && b < 32) return 31 + (b - 30) * 0.5;       // seated on 30, the arc, the pull-out
  return b;
}
const basePlate = new THREE.Group(); PLANT.root.add(basePlate);
{ const st = new THREE.MeshStandardMaterial({ color: 0x5a5250, roughness: 0.45, metalness: 0.7 });
  const pl = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.035, 0.62), st); pl.position.set(-5.9, 0.16, 0.0); pl.castShadow = pl.receiveShadow = true; basePlate.add(pl);
  for (const dx of [-0.22, 0.22]) for (const dz of [-0.22, 0.22]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.14, 8), st); b.position.set(-5.9 + dx, 0.23, dz); basePlate.add(b);
    const n = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.03, 6), st); n.position.set(-5.9 + dx, 0.19, dz); n.castShadow = true; basePlate.add(n); } }
const raiseAt = beat => beat < 30 ? 1 : beat < 31 ? 1 - ease.inOutCubic(clamp((beat - 30) / 1.0)) : 0;     // 1 = lying, 0 = upright

// ---- the plants the network raises, one beside every town it reaches, each its own size
const plantU = { uBeat: { value: 0 }, uT: { value: 0 }, uLitK: { value: 1 } };
const SITES = PSITES;
const plants = WD.plantMesh(SITES, plantU); scene.add(plants);
// the spur from each town to its plant, drawn on the town's call (the network reaching the plant)
const spurs = roadRibbon(SITES.map(s => ({ pts: [[s.town.x, s.town.z], [s.x, s.town.z], [s.x, s.z]], t0: s.ign - 0.5, t1: s.ign, bright: 1.1 })), 0.8);
// the column's trail: lantern light flowing along every road the network has reached (the people on the move)
const flowMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uBeat: { value: 0 }, uT: { value: 0 }, uPxR: pxU, uI: { value: 1 } },
  vertexShader: /* glsl */`attribute float aS, aLen, aT0, aT1, aR; uniform float uBeat, uT, uPxR, uI; varying float vB;
    void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); float d = -mv.z;
      float head = clamp((uBeat - aT0) / max(aT1 - aT0, 0.01), 0.0, 1.0) * aLen;
      float on = step(aS, head);
      float grp = 0.5 + 0.5 * sin(aS * 0.018 - uT * 1.6 + aR * 0.6); grp = smoothstep(0.35, 0.8, grp);
      vB = on * uI * (0.25 + 0.9 * grp) * (0.6 + 0.4 * aR) * (1.0 + 2.5 * exp(-(head - aS) / 60.0));
      gl_PointSize = clamp(2.6 * uPxR / d, 1.8, 5.0)${PXM}; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: /* glsl */`varying float vB; void main(){ vec2 q = gl_PointCoord - 0.5; float f = exp(-dot(q, q) * 12.0); gl_FragColor = vec4(vec3(1.0, 0.78, 0.45) * vB * f * 2.2, 1.0); }` });
{ const P = [], S = [], LEN = [], T0 = [], T1 = [], RR = [], r = rng(606);
  for (const p of roadPaths) {
    let s = 0; const segs = [];
    for (let i = 0; i < p.pts.length - 1; i++) { const a = p.pts[i], b = p.pts[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > 0.01) { segs.push([a, b, s, l]); s += l; } }
    const hero = p.t0 === 30;
    for (const [a, b, s0, l] of segs) for (let d = 0; d < l; d += hero ? 1.6 : 5.5) {
      const u = d / l, x = a[0] + (b[0] - a[0]) * u, z = a[1] + (b[1] - a[1]) * u, dx = (b[0] - a[0]) / l, dz = (b[1] - a[1]) / l, off = (r() - 0.5) * 3.2;
      P.push(x - dz * off, WD.hgt(x, z) + 1.3, z + dx * off); S.push(s0 + d); LEN.push(s); T0.push(p.t0); T1.push(p.t1); RR.push(r());
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  for (const [k, a] of [['aS', S], ['aLen', LEN], ['aT0', T0], ['aT1', T1], ['aR', RR]]) g.setAttribute(k, new THREE.Float32BufferAttribute(a, 1));
  const m = new THREE.Points(g, flowMat); m.frustumCulled = false; scene.add(m); }

// ---- the column: ranks x files behind a head point, walking along a direction
const COL = [];                          // farm, rail, steel interleaved so every rank shows the three regions walking together
for (let i = 0; COL.length < 150 && i < 200; i++) for (const id of [FARM[(2 * i) % FARM.length], RAILW[i % RAILW.length], STEELW[i % STEELW.length], FARM[(2 * i + 1) % FARM.length]]) if (!COL.includes(id) && COL.length < 150) COL.push(id);
const LUP = new Set();                   // lanterns raised this frame
function column(head, dir, { files = 4, gap = 1.2, spread = 0.95, walked = 0, walking = true, from = 0, n = COL.length, lead = [], lanterns = true, fists = 0.1, raise = 0.12, ids = COL } = {}) {
  const d = dir.clone().setY(0).normalize(), side = V(-d.z, 0, d.x), r = rng(77), hd = heading(d.x, d.z);
  const out = [];
  lead.forEach(([id, file, rank, extra], i) => { const p = head.clone().addScaledVector(d, -rank * gap + walked).addScaledVector(side, (file - (files - 1) / 2) * spread);
    put(id, p.x, p.z, { heading: hd, act: walking ? 'walk' : 'stand', ph: stride(walked, i * 1.3), amt: walking ? 1 : 0, ...extra }); out.push(id); });
  for (let k = 0; k < n; k++) {
    const id = ids[(k + from) % ids.length], rank = Math.floor(k / files) + (lead.length ? 1 : 0), file = k % files;
    const jx = (r() - 0.5) * 0.35, jz = (r() - 0.5) * 0.45, sp = 0.85 + r() * 0.3, kk = r(), ph0 = r() * 6.28, hj = (r() - 0.5) * 0.12, lk = (r() - 0.5) * 0.4;
    const wk = walked * (1 + (sp - 1) * 0.15), p = head.clone().addScaledVector(d, -rank * gap + jz + wk).addScaledVector(side, (file - (files - 1) / 2) * spread + jx);
    const fist = kk < fists, up = !fist && kk < fists + raise && LANTERN.has(id);
    put(id, p.x, p.z, { heading: hd + hj, act: walking ? (fist ? 'march' : 'walk') : fist ? 'fist' : 'stand', ph: stride(wk / sp, ph0), amt: walking ? 0.85 + 0.3 * (sp - 0.85) : 0, speed: sp, look: lk,
      pump: Math.pow(Math.max(0, Math.sin(T_NOW * 5.2 + kk * 40)), 2), pose: up ? POSE.lanternUp : null });
    if (up) LUP.add(id);
    out.push(id);
  }
  return out;
}
// a lantern stream (points only): along a polyline, flowing at v m/s, `files` wide
function stream(pts, { n = 300, gap = 1.4, files = 2, v = 1.4, t = 0, h = 1.05, b = 1, seed = 1 } = {}) {
  const r = rng(seed); let L = 0; const seg = [];
  for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], c = pts[i + 1], l = Math.hypot(c[0] - a[0], c[1] - a[1]); seg.push([a, c, L, l]); L += l; }
  for (let k = 0; k < n; k++) {
    const clump = Math.sin(k * 0.21 / files) * gap * 1.4;             // people walk in knots, not at even spacing
    let s = L - (Math.floor(k / files) * gap + (r() - 0.5) * gap * 1.2 + clump) + ((v * t) % gap); if (s < 0) break; s = Math.min(s, L - 0.01);
    const [a, c, s0, l] = seg.find(q => s >= q[2] && s < q[2] + q[3]) || seg[seg.length - 1], u = (s - s0) / l, x = a[0] + (c[0] - a[0]) * u, z = a[1] + (c[1] - a[1]) * u;
    const dx = (c[0] - a[0]) / l, dz = (c[1] - a[1]) / l, off = ((k % files) - (files - 1) / 2) * 0.9 + (r() - 0.5) * 1.1;
    if (r() < 0.55) farAdd(x - dz * off, WD.hgt(x, z) + h + Math.sin(t * 5.6 + k) * 0.04, z + dx * off, b * (0.6 + 0.6 * r()));
  }
}

// ---- the cast, beat by beat (people and props follow the SHOTS below)
const CROSS = V(0, 0, 505);
// the people inside the first hall (around the table), and the crew of Plant No. 1
const SPARE = CROWD.filter(id => !COL.includes(id));
const INSIDE = SPARE.slice(0, 10), PLANTW = SPARE.slice(10, 20);
function hallInside(beat) {           // at the table, turned to the door: some sitting forward, some up, fists on LIGHTS UP
  const spots = [[-1.35, 198.2, 0.5], [1.35, 198.9, -0.5], [-1.4, 200.6, 0.4], [1.4, 201.4, -0.4], [-1.3, 203.2, 0.3], [1.35, 203.9, -0.35], [-0.4, 206.6, 0.05], [0.6, 207.3, -0.1], [-2.6, 205.4, 0.3], [2.7, 206.1, -0.3]];
  INSIDE.forEach((id, i) => { const [dx, z, h] = spots[i], f = beat >= 28.3 && beat < 30 && i % 3 === 0;
    put(id, 45 + dx, z, { heading: h, act: f ? 'fist' : 'stand', pump: f ? Math.pow(Math.max(0, Math.sin(T_NOW * 5.3 + i)), 2) : null, t: T_NOW + i * 1.7, look: -h * 0.5 }); });
}
// Plant No. 1's contact points for the pike poles: along the rafter's front flange (local x in m, bent frame)
const PIKE_X = [-5.4, -3.9, -2.3, -0.8, 0.8, 2.3, 3.9, 5.4];
const rafterY = x => 7.6 + 1.3 * (1 - Math.abs(x) / 6.25);
function cast(beat, t, cam) {
  T_NOW = t; farN = 0; LUP.clear();
  for (let i = 0; i < folk.n; i++) folk.get(i).visible = false;
  banner.visible = false; rayHat.visible = false; rope.visible = false; for (const p of pikes) p.visible = false; arcGlow.visible = false; ginPole.visible = false; hungBanner.visible = beat >= 34 && beat < 40;
  heroFill.intensity = 0; crossLight.intensity = 0; arcLight.intensity = 0;
  const fr = V(0, 0, 0); camera.getWorldDirection(fr); fr.y = 0; fr.normalize(); const rt = V(-fr.z, 0, fr.x);
  const cp = camera.position, rel = (f, r) => cp.clone().addScaledVector(fr, f).addScaledVector(rt, r);
  const el = s0 => (beat - s0) * B.spb;
  const out = { lanternUp: LUP };
  if (beat >= 8 && beat < 10 && PP.dot) {     // v15 SMALL FARMERS.: Dot close in the wheat (personShots); the farmers stand behind her in the field
    const C0 = camera.position, f = V(-1480, 0, -630).normalize(), r = V(-f.z, 0, f.x);
    FARM.slice(0, 14).forEach((id, i) => { const d = 5 + i * 1.3 + (i % 3) * 0.8, s = ((i * 7) % 11 - 5) * 0.9;
      const q = C0.clone().addScaledVector(f, d).addScaledVector(r, s); put(id, q.x, q.z, { heading: heading(-f.x, -f.z) + ((i % 5) - 2) * 0.12, act: 'stand', t: T_NOW + i }); });
  } else if (beat >= 8 && beat < 12) {          // SMALL FARMERS. / IOWA: the farmers are a SIL rank (drawn in 2D over the frame)
  } else if (beat >= 12 && beat < 14) {         // RAIL STRIKERS.: Marcus on the main line, lantern up on the hit; strikers down the train
    const up = clamp((beat - 12.35) / 0.4);
    if (!PP.marcus) { put(MARCUS, 33.3, WD.RAILZ + 1.55, { heading: -Math.PI / 2 + 0.12, act: 'stand', pose: up > 0 ? POSE.lanternUp : null });   // from behind
      if (up > 0) LUP.add(MARCUS); }                // v15: the real Marcus faces us with his own lantern (personShots)
    [[RAILW[0], 27.2, -59.9], [RAILW[1], 22.4, -55.8], [RAILW[2], 17.1, -60.1], [RAILW[3], 11.3, -55.6], [RAILW[4], 5.2, -59.7], [RAILW[5], -1.5, -55.9]].forEach(([id, x, z], i) =>
      put(id, x, z, { heading: -Math.PI / 2 + (i % 2 ? 0.3 : -0.25), act: 'stand' }));
    for (let x = -8; x > -520; x -= 7.5) { farAdd(x, WD.hgt(x, -58) + 1.1, -58.4 - (x % 2 ? 0 : 2.6), 0.9); if (x % 3 === 0) farAdd(x - 3, WD.hgt(x, -52) + 1.1, -51.5, 0.6); }
  } else if (beat >= 14 && beat < 16) {         // OMAHA.: the strikers walk out of the yard at us, lanterns lit; the line runs back to the elevators
    const e = el(14);
    const dT = TOWER.clone().sub(TCAM).setY(0).normalize();
    column(TCAM.clone().addScaledVector(dT, 13), dT, { ids: RAILW, walked: e * 1.35, files: 3, gap: 1.35, spread: 1.05, n: 21, raise: 0.3, fists: 0 });
    stream([[TCAM.x + dT.x * 40, TCAM.z + dT.z * 40], [TOWER.x - 6, TOWER.z + 4]], { n: 300, gap: 1.2, files: 3, v: 1.35, t: e, b: 1.25, seed: 14 });
  } else if (beat >= 16 && beat < 18) {         // STEELWORKERS.: Ray, backlit by the furnace, drops his shield on 17
    const p = rel(3.0, -0.3); const k = beat < 16.7 ? 0 : beat < 17.15 ? Math.sin((beat - 16.7) / 0.45 * Math.PI) : 0;
    if (!PP.ray) put(RAY, p.x, p.z, { heading: heading(fr.x, fr.z) + 0.35, act: 'stand', pose: POSE.visor, lift2: k, propArm: [true, true] });   // his back to us, against the pour (v15: the real Ray, personShots)
    [[STEELW[0], 7.5, 2.6], [STEELW[1], 9.8, -2.2], [STEELW[2], 12.5, 0.9], [STEELW[3], 15.5, -3.4]].forEach(([id, f2, r2], i) => { const q = rel(f2, r2); put(id, q.x, q.z, { heading: heading(fr.x, fr.z) + 0.2 * (i % 2 ? 1 : -1), act: 'stand', t: T_NOW + i }); });
    out.visor = beat < 16.95 ? 1 : 1 - ease.outCubic(clamp((beat - 16.95) / 0.2));
    heroFill.position.copy(p).add(fr.clone().multiplyScalar(1.4)).add(V(0, 2.2, 0)).addScaledVector(rt, 1.2); heroFill.color.set(0xff7a2a); heroFill.intensity = 30;
    crossLight.position.copy(rel(1.2, -0.6)).add(V(0, 1.2, 0)); crossLight.color.set(0xc0c8ff); crossLight.intensity = 4; crossLight.distance = 6;
  } else if (beat >= 18 && beat < 20) {         // OHIO.: shift change, hard hats filing out past the cast house mouths
    const e = el(18), L = rt.clone().negate(), hd = heading(L.x, L.z);
    [[RAY, 2.9, -0.4], [STEELW[0], 3.6, 1.6], [STEELW[1], 4.6, -1.9], [STEELW[2], 5.4, 0.5], [STEELW[3], 6.4, 2.6], [STEELW[4], 7.5, -0.9]].forEach(([id, f, r], i) => {
      const p = rel(f, r).addScaledVector(L, e * 1.45); put(id, p.x, p.z, { heading: hd + 0.1 * (i % 3 - 1), act: 'walk', ph: stride(e * 1.45, i * 2.1), speed: 0.9 + 0.06 * i }); });
    out.visor = 0;
    crossLight.position.copy(rel(1.0, 0.3)).add(V(0, 1.4, 0)); crossLight.color.set(0x8090c0); crossLight.intensity = 5; crossLight.distance = 9;
  } else if (beat >= 20 && beat < 21) {         // WE ALL UNITE.: Dot and Marcus clasp hands under the crossroads lamp; Ray and the rest come in
    const c = V(2.6, 0, 508.2);
    if (!(PP.dot && PP.marcus)) {                // v15: the real Dot and Marcus clasp (personShots)
      put(DOT, c.x - 0.43, c.z, { heading: Math.PI / 2, act: 'stand', pose: POSE.clasp, lift2: 0, propArm: [true, true] });
      put(MARCUS, c.x + 0.43, c.z + 0.05, { heading: -Math.PI / 2, act: 'stand', pose: POSE.clasp, lift2: 0, propArm: [true, true] });
      out.clasp = true; }
    LUP.clear();
    const e = el(20);
    [[RAY, 4.6, 510.6, -2.3], [STEELW[5], 0.2, 511.4, 2.8], [FARM[5], 5.8, 512.4, -2.6], [RAILW[6], -1.6, 513.6, 2.2], [FARM[6], 3.3, 514.2, 3.0], [RAILW[7], 7.2, 514.8, -2.8], [STEELW[6], -0.3, 516.5, 2.9]].forEach(([id, x, z, h], i) =>
      put(id, x + Math.sin(h) * e * 1.3, z + Math.cos(h) * e * 1.3, { heading: h, act: 'walk', ph: stride(e * 1.3, i * 1.9), speed: 0.9 + 0.05 * i }));
    out.visor = 0;
    crossLight.position.set(5.4, WD.hgt(5, 512) + 6.8, 512); crossLight.color.set(0xffb870); crossLight.intensity = 70; crossLight.distance = 30;
  } else if (beat >= 21 && beat < 22) {         // the crane: three roads of lanterns feed one column at the crossroads, heading for the hall
    const tt = el(21) * 9 + 20;
    stream([[-420, 505], [0, 505], [0, 300]], { n: 700, gap: 1.3, files: 2, v: 11, t: tt, b: 1.1, seed: 21 });
    stream([[420, 505], [0, 505], [0, 300]], { n: 700, gap: 1.3, files: 2, v: 13, t: tt, b: 1.1, seed: 22 });
    stream([[0, 900], [0, 505], [0, 300]], { n: 700, gap: 1.3, files: 2, v: 15, t: tt, b: 1.1, seed: 23 });
    stream([[0, 505], [0, 262]], { n: 500, gap: 0.8, files: 4, v: 13, t: tt, b: 1.3, seed: 24 });
    crossLight.position.set(5.4, WD.hgt(5, 512) + 6.8, 512); crossLight.color.set(0xffb870); crossLight.intensity = 70; crossLight.distance = 30;
  } else if (beat >= 22 && beat < 24) {         // the crane: the column on the road north to the hall: the column on the road north to the hall; the poles go up, the banner unrolls on 24
    const e = el(22), head = V(0.2, 0, 462), dir = V(0, 0, -1), walked = e * 1.35;
    const lift = clamp((beat - 22.6) / 1.2), k = ease.outCubic(lift);
    column(head, dir, { walked, files: 4, n: 110, from: 20, raise: 0.2, fists: beat < 24 ? 0.06 : 0.16, lead: [[DOT, 0.1, 0, { pose: POSE.poleUp, lift2: k }], [RAY, 2.9, 0, { pose: POSE.poleUp, lift2: k }], [MARCUS, 1.5, 1.2, {}]] });
    out.banner = { open: beat < 24 ? 0.03 : ease.outBack(clamp((beat - 24) / 0.28)), wave: beat < 24 ? 0.2 : 1 + 2.5 * Math.exp(-(beat - 24) * 3), poleUp: k };
    heroFill.position.set(0.3, WD.hgt(0, 458) + 2.0, head.z - walked - 3.2); heroFill.color.set(0xffa860); heroFill.intensity = beat < 24 ? 8 : 16; heroFill.distance = 11;
    for (let s = 60; s < 360; s += 1.5) farAdd((Math.floor(s) % 3 - 1) * 0.9 + 0.2, WD.hgt(0, 462 + s) + 1.05, 462 + s - walked, 0.9);
  } else if (beat >= 28 && beat < 30) {         // LIGHTS UP.: the doors open on the full hall; the banner planted beside the porch; the column files in
    const e = el(28), dir = V(45 - 50, 0, 216 - 246).normalize(), inward = beat >= 29;
    put(DOT, 40.9, 216.9, { heading: Math.PI + 0.25, act: 'stand', pose: POSE.pole }); put(RAY, 37.8, 217.5, { heading: Math.PI + 0.35, act: 'stand', pose: POSE.pole });
    put(MARCUS, 45.9, 215.9 - (inward ? e * 0.5 - 0.35 : 0), { heading: Math.PI, act: inward ? 'walk' : 'stand', ph: stride(e * 1.2), amt: inward ? 0.8 : 0 });
    column(V(45.2, 0, 215.1 - (inward ? (e - 0.375) * 1.3 : 0)), dir, { walked: 0, files: 3, gap: 1.05, spread: 0.85, n: 60, from: 30, walking: inward, raise: 0.15 });
    out.banner = { open: 1, wave: 0.5, planted: true };
    stream([[60, 300], [50, 246]], { n: 200, gap: 1.2, files: 3, v: 1.35, t: e, b: 1, seed: 28 });
    hallInside(beat);
  } else if (beat >= 30 && beat < 32) {         // IT CALLS: the town raises the first steel frame beside the hall, a barn raising: pikes, ropes, a gin pole
    const bent = PLANT.bents[0], base = PLANT.root.position; bent.updateMatrixWorld(true);
    const crewIds = [DOT, FARM[7], RAILW[8], STEELW[7], FARM[8], STEELW[8], RAILW[9], FARM[9]];
    const crew = [];
    PIKE_X.forEach((x, i) => {
      const C = bent.localToWorld(V(x, rafterY(x) - 0.12, 0.24));
      const hz = Math.max(1.3, (C.y - base.y - 1.9) / Math.tan(1.0));
      const pz = C.z + hz + (i % 2 ? 0.35 : 0), px = C.x + (i % 2 ? 0.25 : -0.25);
      put(crewIds[i], px, pz, { heading: Math.PI + (i - 3.5) * 0.03, act: 'stand', pose: POSE.pike, t: T_NOW + i });
      crew.push([crewIds[i], C]);
    });
    out.crew = crew; out.noLantern = new Set([MARCUS, ...crewIds]);
    const gin = V(base.x - 0.5, base.y, base.z - 9.2);
    [[MARCUS, 64.6, gin.z - 6.2], [RAILW[10], 65.9, gin.z - 7.3], [FARM[10], 67.1, gin.z - 8.4]].forEach(([id, x, z], i) => put(id, x, z, { heading: Math.PI + 0.05, act: 'stand', pose: POSE.rope }));
    out.rope = { gin, crew: [MARCUS, RAILW[10], FARM[10]], apex: bent.localToWorld(V(0, rafterY(0) + 0.1, 0)) };
    put(RAY, 59.2, base.z + 1.0, { heading: Math.PI * 0.62, act: 'work', ph: (beat - 30) * 0.9 }); out.visor = beat >= 31 ? 0 : 1;
    heroFill.position.set(62, base.y + 5.5, base.z + 12); heroFill.color.set(0xffb070); heroFill.intensity = 50; heroFill.distance = 28;
    const arc = beat >= 31 ? Math.exp(-(beat - 31) * 2.2) * (0.6 + 0.4 * Math.sin(t * 60) * Math.sin(t * 23)) : 0;
    out.arc = arc;
    // the rest of the column in the lot with their lanterns, and the banner planted beside the rising steel
    column(V(55.5, 0, 227.5), V(1, 0, -0.35), { walked: 0, files: 4, n: 40, from: 60, walking: false, gap: 1.1, raise: 0.3, fists: 0.2 });
    out.banner = { open: 1, wave: 0.7, feet: [V(58.3, 0, 222.2), V(60.0, 0, 222.7)] };
  } else if (beat >= 36 && beat < 38) {         // ROBOTICS. / SOFTWARE.: inside Plant No. 1: the crew at work, the same hand on the cobot, then at the terminal
    const robo = beat < 37;                  // the claim: the same farmer and the same striker run the machines
    if (robo && !PP.dot) put(DOT, 68.62, 209.12, { heading: -0.46, act: 'stand', pose: POSE.guide, propArm: [true, true] });
    else if (!robo && !PP.marcus) put(MARCUS, 62.55, 212.95, { heading: 1.2, act: 'stand', pose: POSE.touch, propArm: [true, true] });
    out.banner = { open: 1, wave: 0.8 }; return out;                   // v12: hand crops only (no crew behind them)
    const y0 = PLANT.root.position.y;
    [[64.2, 204.4, 1.2, 'work'], [70.8, 203.2, -2.2, 'work'], [61.8, 199.6, 0.6, 'walk'], [67.6, 197.9, 3.0, 'stand'], [71.3, 199.1, -1.4, 'work'], [63.4, 195.2, 2.4, 'stand'], [69.2, 194.3, 0.2, 'work'], [60.7, 206.2, 1.8, 'stand']].forEach(([x, z, h, a], i) => {
      const id = PLANTW[i], wz = a === 'walk' ? z + ((T_NOW * 1.3) % 6) : z;
      put(id, x, wz, { heading: h, act: a, ph: a === 'work' ? T_NOW * 0.9 + i * 0.37 : stride(T_NOW * 1.3, i), t: T_NOW + i, speed: 1 }); });
    const e = el(36);
    column(V(47.5, 0, 221), V(-0.2, 0, -1), { walked: e * 1.3, files: 3, n: 30, from: 0 });
    out.banner = { open: 1, wave: 0.8 };
    stream([[70, 330], [50, 240], [46, 224]], { n: 300, gap: 1.2, files: 3, v: 1.35, t: e, b: 1.1, seed: 36 });
  } else if (false) {                       // v11: no porch scene (the invitation is cut)         // SEE YOU / AT THE HALL.: the four come up the porch steps with the furled banner, the hall full ahead of them
    const e = el(60), s = Math.min(e * 1.25, 7.2), zA = 222.6 - s;
    [[DOT, 44.3, 0], [MARCUS, 45.35, 0.35], [RAY, 46.35, 0.1], [ROBO, 43.25, 0.55]].forEach(([id, x, lag], i) => { const z = zA + lag + (i === 0 ? 0 : 0.2);
      put(id, x + (z < 215.5 ? (45 - x) * clamp((215.5 - z) / 2.5) * 0.45 : 0), z, { heading: Math.PI + (i - 1.5) * 0.04, act: 'walk', ph: stride(s, i * 1.6), speed: 0.92 + 0.05 * i, pose: i === 0 ? POSE.pole : null, visible: z > 211.4 }); });
    column(V(45, 0, 214.4 - e * 1.3), V(0, 0, -1), { walked: 0, files: 3, gap: 1.0, spread: 0.8, n: 18, from: 90, lanterns: false });
    for (const id of COL.slice(90, 108)) if (folk.get(id).z < 211.3) folk.get(id).visible = false;
    hallInside(beat);
    out.banner = { furled: true };
  }
  // the framing rule: past ~45 m a person is only their lantern (if any)
  for (const id of [...HEROES, ...CROWD]) { const st = folk.get(id); if (!st.visible) continue;
    const d = Math.hypot(st.x - cp.x, st.z - cp.z);
    if (d > 45) { st.visible = false; if (LANTERN.has(id)) farAdd(st.x, st.y + 1.05, st.z, 1); } }
  return out;
}
// props that hang off hands and heads (after folk.update)
const _m4 = new THREE.Matrix4(), _p = V(0, 0, 0), _q4 = new THREE.Quaternion(), _s1 = V(1, 1, 1);
function props(beat, t, C) {
  const cp = camera.position;
  // near lanterns
  let n = 0; const cand = [];
  for (const id of LANTERN) { const st = folk.get(id); if (!st.visible || !folk.grip(id, 1) || (C.noLantern && C.noLantern.has(id))) continue;
    const d = Math.hypot(st.x - cp.x, st.z - cp.z); if (d > 40) { farAdd(st.x, st.y + 1.0, st.z, 1); continue; }
    const up = C.lanternUp.has(id), g = folk.gripPos(id, up ? -1 : 1, V(0, 0, 0));
    const pos = g.clone().add(V(0, up ? -0.3 : -0.33, 0));
    cand.push([d, pos, id]); }
  cand.sort((a, b) => a[0] - b[0]);
  for (const [d, pos] of cand) { if (n >= LN) { farAdd(pos.x, pos.y + 0.14, pos.z, 1); continue; }
    _m4.compose(pos, _q4.setFromAxisAngle(V(0, 0, 1), Math.sin(t * 5.6 + n) * 0.12), _s1); lanternDark.setMatrixAt(n, _m4); lanternGlass.setMatrixAt(n, _m4); n++; }
  lanternDark.count = lanternGlass.count = n; lanternDark.instanceMatrix.needsUpdate = lanternGlass.instanceMatrix.needsUpdate = true;
  lanternLights.forEach((l, i) => { const c = cand[i]; if (c && c[0] < 25) { l.position.copy(c[1]).add(V(0, 0.15, 0)); l.intensity = 5.5 * (0.9 + 0.1 * Math.sin(t * 17 + i * 3)); } else l.intensity = 0; });
  // Ray's hat and visor
  const hm = folk.head(RAY);
  if (folk.get(RAY).visible && hm) { rayHat.visible = true; rayHat.matrixAutoUpdate = false; rayHat.matrix.copy(hm); rayHat.matrixWorldNeedsUpdate = true;
    rayHat.userData.hinge.visible = C.visor != null; rayHat.userData.hinge.rotation.x = -lerp(0, 1.38, C.visor ?? 1); }   // the shield only where it is used
  // the banner
  if (C.banner) {
    if (C.banner.furled) {
      const g = folk.gripPos(DOT, -1, V(0, 0, 0)); banner.visible = true;
      poles[0].position.copy(g).add(V(0, -1.1, 0)); poles[0].rotation.set(0.35, 0, 0); poles[1].visible = false; bar.visible = false; cloth.visible = false; finials[1].visible = false;
      finials[0].position.copy(g).add(V(0, 2.55, 0.9)); furl.visible = true; furl.scale.set(1, 1, 1); furl.position.copy(g).add(V(0, 1.75, 0.63)); furl.rotation.set(0.35, 0, 0);
    } else {
      poles[1].visible = true; bar.visible = true; finials[1].visible = true;
      let A0, B0;
      if (C.banner.feet) [A0, B0] = C.banner.feet.map(f => V(f.x, gy(f.x, f.z) - 0.1, f.z));          // planted in the ground
      else { const ga = folk.gripPos(DOT, -1, V(0, 0, 0)), gb = folk.gripPos(RAY, -1, V(0, 0, 0)), up = C.banner.poleUp ?? 1;
        A0 = ga.clone().add(V(0, -1.25 - (1 - up) * 1.2, 0)); B0 = gb.clone().add(V(0, -1.25 - (1 - up) * 1.2, 0)); }
      setBanner(A0, B0, { open: C.banner.open, wave: C.banner.wave, t });
    }
  }
  // the bent raising: pike poles from the crew's hands to the rafter, the rope from the apex to Marcus
  if (C.crew) {                  // each pike runs through both hands of its man and bears on the rafter's flange
    C.crew.forEach(([id, Cp], i) => { const g = folk.gripPos(id, -1, V(0, 0, 0)).lerp(folk.gripPos(id, 1, V(0, 0, 0)), 0.5), d = Cp.clone().sub(g), L = d.length(); d.normalize();
      const m = pikes[i]; m.visible = true; m.position.copy(g).addScaledVector(d, -1.1); m.scale.set(1, L + 1.1, 1); m.quaternion.setFromUnitVectors(V(0, 1, 0), d); });
  }
  if (C.rope) {                  // the gin pole: a rope from the apex over its head block, down to the three hauling on it
    const { gin, crew, apex } = C.rope, top = gin.clone().add(V(0, 11.2, 1.2));
    ginPole.visible = true; ginPole.position.copy(gin); ginPole.quaternion.setFromUnitVectors(V(0, 1, 0), top.clone().sub(gin).normalize());
    const gs = crew.map(id => folk.gripPos(id, -1, V(0, 0, 0)));
    const pts = [apex, top, gs[0], gs[1], gs[2], gs[2].clone().add(V(0.3, -1.2, -0.9))];
    if (FAT) rope.geometry.setPositions(pts.flatMap(q => [q.x, q.y, q.z]));
    else { const P = rope.geometry.attributes.position; pts.forEach((q, i) => P.setXYZ(i, q.x, q.y, q.z)); P.needsUpdate = true; }
    rope.visible = true;
  }
}

// ---------------------------------------------------------------- the mill's sparks: stateless ballistic points (L5)
const sparkMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uT: { value: 0 }, uO: { value: new THREE.Vector3() }, uPxR: null, uI: { value: 0 }, uSpread: { value: 18 }, uV: { value: 1 } },
  vertexShader: /* glsl */`attribute vec4 aR; uniform float uT, uI, uSpread, uV; uniform vec3 uO; varying float vB;
    void main(){ float life = 0.5 + aR.w * 0.9; float age = mod(uT + aR.x * 7.0, life);
      vec3 v = vec3((aR.y - 0.5) * 9.0, 3.0 + aR.z * 7.0, (4.0 + aR.w * 9.0) * (uSpread > 1.0 ? 1.0 : (aR.x - 0.5) * 2.0)) * uV;
      vec3 p = uO + vec3((aR.x - 0.5) * uSpread, 0.0, 0.0) + v * age + vec3(0.0, -4.9, 0.0) * age * age;
      vec4 mv = modelViewMatrix * vec4(p, 1.0); vB = uI * (1.0 - age / life);
      gl_PointSize = clamp(40.0 / -mv.z, 1.2, 4.0)${PXM}; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: /* glsl */`varying float vB; void main(){ gl_FragColor = vec4(vec3(1.0, 0.55, 0.15) * vB * 6.0, 1.0); }` });
{ const g = new THREE.BufferGeometry(), r = rng(8), n = 1500, a = new Float32Array(n * 4), pp = new Float32Array(n * 3); for (let i = 0; i < n * 4; i++) a[i] = r();
  g.setAttribute('position', new THREE.BufferAttribute(pp, 3)); g.setAttribute('aR', new THREE.BufferAttribute(a, 4)); const m = new THREE.Points(g, sparkMat); m.frustumCulled = false; scene.add(m); }

// ---------------------------------------------------------------- lightning: branching emissive ribbons
const boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1), side: THREE.DoubleSide });   // opaque + depth: the volume stops at the bolt
const bolt = new THREE.Mesh(new THREE.BufferGeometry(), boltMat); bolt.frustumCulled = false; scene.add(bolt);
function boltSegs(seed, top, bottom) {
  const r = rng(seed), segs = [];
  function branch(a, b, w, depth) {
    const pts = [a, b];
    for (let it = 0; it < 6; it++) { const np = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) { const p = pts[i], q = pts[i + 1], L = p.distanceTo(q);
        const m = p.clone().lerp(q, 0.5).add(new THREE.Vector3((r() - 0.5) * L * 0.45, (r() - 0.5) * L * 0.2, (r() - 0.5) * L * 0.45)); np.push(m, q); }
      pts.splice(0, pts.length, ...np); }
    for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1], w * (1 - 0.5 * i / pts.length)]);
    if (depth < 2) for (let k = 0; k < 4 - depth; k++) { const i = Math.floor(r() * pts.length * 0.8); const s = pts[i], L = (bottom.y - top.y) * -0.3 * (0.4 + r());
      branch(s, s.clone().add(new THREE.Vector3((r() - 0.5) * L, -L * (0.5 + r() * 0.5), (r() - 0.5) * L)), w * 0.45, depth + 1); }
  }
  branch(top, bottom, 1, 0);
  return segs;
}
function buildBolt(segs, width) {
  const pos = [], camP = camera.position;
  for (const [a, b, w] of segs) {
    const d = b.clone().sub(a), mid = a.clone().add(b).multiplyScalar(0.5), view = mid.clone().sub(camP).normalize();
    const side = d.clone().cross(view).normalize().multiplyScalar(width * w * Math.max(1, mid.distanceTo(camP) / 900));
    const q = [a.clone().sub(side), a.clone().add(side), b.clone().add(side), b.clone().sub(side)];
    for (const i of [0, 1, 2, 0, 2, 3]) pos.push(q[i].x, q[i].y, q[i].z);
  }
  bolt.geometry.dispose(); bolt.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
}
// strikes: frame 0 is mid-strike; the red one on GOES RED.; the war drums from 20
const STRIKES = [-0.12, 2.5, 4, 6, 8, 10, 12, 14, 16, 20.5, 22, 23, 26, 28, 29];   // frame 0 = the red strike (OHIO GOES RED.)
function strikeAt(beat) {
  let s = null;
  for (const b of STRIKES) if (beat >= b && beat - b < 1.2) s = b;
  if (s == null) return null;
  const age = (beat - s) * B.spb;
  const env = Math.exp(-age * 9) + 0.8 * Math.exp(-Math.abs(age - 0.11) * 40) + 0.55 * Math.exp(-Math.abs(age - 0.2) * 45);
  return { b: s, age, env: s < 0 ? Math.max(env, 0.85) : env, red: s < 0 };
}

// ---------------------------------------------------------------- acts: storm -> night -> dawn -> storm (the loop)
const col = h => new THREE.Color(h);
const ACT = {
  storm: { zen: col('#241c2e'), hor: col('#6c6a5e'), gnd: col('#2a2418'), sunDir: new THREE.Vector3(0.25, 0.35, -0.9).normalize(), sunCol: col('#30303a'), sunDisc: 0,
    fog: col('#3a3246'), fogD: 0.0003, fogH: 350, cover: 0.66, dens: 0.016, lo: col('#1e1628'), hi: col('#5e4c74'), horC: col('#4e4658'), rain: 1, under: 0, rainC: col('#5a5a6a'),
    hsky: col('#6a6690'), hgnd: col('#2a2014'), hI: 1.0, keyC: col('#a8b0cc'), keyI: 0.45, keyDir: new THREE.Vector3(0.3, 0.8, 0.45).normalize(), expo: 1.45, rays: 0, stars: 0, glowHor: 0, gust: 1.1, wet: 1 },
  night: { zen: col('#070b22'), hor: col('#202a58'), gnd: col('#0a0a12'), sunDir: new THREE.Vector3(-0.3, 0.5, 0.4).normalize(), sunCol: col('#101830'), sunDisc: 0,
    fog: col('#161c3a'), fogD: 0.00012, fogH: 500, cover: 0.55, dens: 0.012, lo: col('#161c34'), hi: col('#303a66'), horC: col('#1c2240'), rain: 0, under: 0, rainC: col('#101018'),
    hsky: col('#2a3470'), hgnd: col('#100c10'), hI: 0.8, keyC: col('#7080c0'), keyI: 0.35, keyDir: new THREE.Vector3(-0.4, 0.6, 0.3).normalize(), expo: 1.8, rays: 0, stars: 0.7, glowHor: 0.35, gust: 0.5, wet: 0.6 },
  dawn: { zen: col('#2e2a50'), hor: col('#ff5a2c'), gnd: col('#3a2018'), sunDir: new THREE.Vector3(0.995, 0.03, -0.06).normalize(), sunCol: col('#ff8a40'), sunDisc: 1,
    fog: col('#c46848'), fogD: 0.00016, fogH: 400, cover: 0.42, dens: 0.01, lo: col('#6a3040'), hi: col('#d08070'), horC: col('#e07a50'), rain: 0, under: 1, rainC: col('#502020'),
    hsky: col('#7a6090'), hgnd: col('#4a2418'), hI: 0.9, keyC: col('#ff8a48'), keyI: 3.0, keyDir: new THREE.Vector3(0.99, 0.1, -0.05).normalize(), expo: 0.95, rays: 0.9, stars: 0, glowHor: 0, gust: 0.45, wet: 0 },
};
const KF = [[0, 'storm'], [29.5, 'storm'], [31.6, 'night'], [47.4, 'night'], [48.4, 'dawn'], [64, 'dawn']];   // dawn to the end: the red dawn seams onto the red strike
function actAt(beat) {
  let i = 0; while (i < KF.length - 2 && beat > KF[i + 1][0]) i++;
  const [b0, n0] = KF[i], [b1, n1] = KF[i + 1], u = smooth(0, 1, (beat - b0) / (b1 - b0)), a = ACT[n0], b = ACT[n1], o = {};
  for (const k in a) { const x = a[k], y = b[k]; o[k] = typeof x === 'number' ? lerp(x, y, u) : x.clone().lerp(y, u); }
  if (o.sunDir.isVector3) o.sunDir.normalize(); o.keyDir.normalize();
  o.stormK = n0 === 'storm' && n1 === 'storm' ? 1 : n0 === 'storm' ? 1 - u : n1 === 'storm' ? u : 0;
  return o;
}

// ---------------------------------------------------------------- v12: the red lamp relay (brief c4 P1/P4)
// Every co-op elevator carries a lamp on its headhouse; every hamlet one over its bins. The first goes red on frame 1
// (the storm plate), the rail towns west into the storm one per kick on TOWN BY TOWN. (b4-5.5), then the rest town to
// town on the kicks of the drop (b32-40, the network's own order). From the air each is a red point with a pool of red
// light in the rain air round it and on the ground under it (the fog deck lit from below).
const BEACONS = [];
{ const rail = [[0, 4], [-1280, 4.5], [-2560, 5], [-3840, 5.5]];
  for (const tw of towns) { if (tw.kind === 'hall' || tw.kind === 'mill') continue;
    const p = tw.elev ? tw.elev.top.clone().add(V(0, 3, 0)) : V(tw.x + 35, WD.hgt(tw.x + 35, tw.z - 30) + 15, tw.z - 30);
    const rr = rail.find(q => tw.elev && q[0] === tw.x && tw.kind !== 'yard');
    const ig = rr ? rr[1] : Math.min(40, Math.max(32, Math.ceil(((tw.ign ?? 36) - 0.2) * 2) / 2));
    BEACONS.push({ p, g: V(p.x, WD.hgt(p.x, p.z) + 1, p.z), ig, big: !!tw.elev }); } }
const _bv = new THREE.Vector3();
function drawBeacons(beat, t, { k = 1, pools = 1 } = {}) {
  const alt = camera.position.y; if (alt < 150) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const b of BEACONS) {
    if (beat < b.ig) continue;
    const age = (beat - b.ig) * B.spb, flash = Math.exp(-age * 9);
    _bv.copy(b.p).project(camera); if (_bv.z > 1 || Math.abs(_bv.x) > 1.3 || Math.abs(_bv.y) > 1.3) continue;
    const x = (_bv.x * 0.5 + 0.5) * W, y = (0.5 - _bv.y * 0.5) * H, d = camera.position.distanceTo(b.p);
    const ppm = H / (2 * d * Math.tan(camera.fov * Math.PI / 360));
    // the pool on the ground and in the rain air: 90-160 m of red light round the town
    if (pools) { _bv.copy(b.g).project(camera); const gx = (_bv.x * 0.5 + 0.5) * W, gy2 = (0.5 - _bv.y * 0.5) * H, R0 = Math.max(60, (b.big ? 470 : 320) * ppm);   // v12b: pools 1.8x (they read as dots on a phone)
      const gr = ctx.createRadialGradient(gx, gy2, 0, gx, gy2, R0); gr.addColorStop(0, `rgba(255,44,14,${0.5 * k})`); gr.addColorStop(0.4, `rgba(210,24,8,${0.2 * k})`); gr.addColorStop(1, 'rgba(120,10,4,0)');
      ctx.fillStyle = gr; ctx.save(); ctx.translate(gx, gy2); ctx.scale(1, 0.55); ctx.translate(-gx, -gy2); ctx.fillRect(gx - R0, gy2 - R0, 2 * R0, 2 * R0); ctx.restore();
      const R1 = Math.max(30, (b.big ? 190 : 130) * ppm), ha = ctx.createRadialGradient(x, y, 0, x, y, R1); ha.addColorStop(0, `rgba(255,60,24,${0.4 * k})`); ha.addColorStop(1, 'rgba(255,30,10,0)');
      ctx.fillStyle = ha; ctx.fillRect(x - R1, y - R1, 2 * R1, 2 * R1); }
    // the lamp: a hot core, white on its ignition frame, then red
    const r = clamp((b.big ? 9 : 6) * ppm, 3.2, 18) * (1 + 1.5 * flash);
    const c = ctx.createRadialGradient(x, y, 0, x, y, r * 3); c.addColorStop(0, flash > 0.4 ? 'rgba(255,240,220,1)' : 'rgba(255,120,80,1)'); c.addColorStop(0.3, `rgba(255,30,12,${0.9 * k})`); c.addColorStop(1, 'rgba(255,20,8,0)');
    ctx.fillStyle = c; ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
  }
  // v12b: the fog deck lit from below: the more towns are lit, the redder the underside of the deck along the horizon
  if (pools) { const lit = BEACONS.filter(b => beat >= b.ig).length / BEACONS.length;
    const dir = camera.getWorldDirection(_bv.set(0, 0, 0)); dir.y = 0; dir.normalize();
    _bv.copy(camera.position).addScaledVector(dir, 9000).setY(0).project(camera); const hy = clamp((0.5 - _bv.y * 0.5) * H, 200, 1500);
    const hg = ctx.createLinearGradient(0, hy - 420, 0, hy + 260); hg.addColorStop(0, 'rgba(200,30,10,0)'); hg.addColorStop(0.62, `rgba(220,40,14,${0.32 * lit * k})`); hg.addColorStop(1, 'rgba(160,20,8,0)');
    ctx.fillStyle = hg; ctx.fillRect(0, hy - 420, W, 680); }
  ctx.restore();
}

// ---------------------------------------------------------------- the shots
const hallF = V(A.x + 45, A.y, A.z + 213);             // in front of the hero hall's porch
const HD = A.hall.door;
const pAt = (x, z, dy) => V(x, WD.hgt(x, z) + dy, z);
const millM = WD.T(MILL.x, WD.hgt(MILL.x, MILL.z), MILL.z, 0.1), millP = (x, y, z) => V(x, y, z).applyMatrix4(millM);
const Y0 = () => PLANT.root.position.y;
const IOWA_T = towns.find(t => t.kind === 'rail' && t.x === -1280), IOWA_E = IOWA_T.elev;
const iowaC = new THREE.Vector3(0, IOWA_E.H * 0.5, IOWA_E.R).applyMatrix4(IOWA_E.M);          // the middle of the lettered bins
const TOWER = new THREE.Vector3(0, Y.towerH + 3.1, 0).applyMatrix4(Y.towerM);
const TCAM = V(TOWER.x - 44, 0, TOWER.z + 96); TCAM.y = WD.hgt(TCAM.x, TCAM.z) + 1.7;
const SHOTS = [
  // 0-4 OHIO GOES RED.: the storm plate (commonwealth3.storm.js); this entry only keeps the world's clock for the tables
  { b: [0, 4], f: u => ({ pos: pAt(58 - u * 6, 330 - u * 55, 2.1), look: V(45, 9, 150), fov: 50, roll: 0 }) },
  // 4-6 TOWN BY TOWN.: hard cut to the air over the rail line: the elevators' lamps go red one per kick, west into the storm
  { b: [4, 6], f: u => ({ pos: V(2350 - u * 260, 430 + u * 30, 560), look: V(-2900, 0, -170), fov: 46, roll: -0.04 }) },
  // 6-8 HALL BY HALL.: push to the hall's gable, the red lamp over its door
  { b: [6, 8], f: u => ({ pos: V(52 - u * 5, A.y + 1.6 + u * 0.8, 256 - u * 18), look: V(45, 6.5, 211), fov: 52, roll: 0 }) },
  // 8-10 SMALL FARMERS.: low in the wheat under the lightning-lit shelf (the farmers are a SIL rank drawn over it)
  { b: [8, 10], f: u => ({ pos: pAt(210 + u * 1.2, 560 - u * 2.5, 1.9), look: pAt(-1280 + 10, -70, 120), fov: 50, roll: 0.02 }) },
  // 10-12: the co-op, IOWA painted across its bins, keyed by the strike on b10
  { b: [10, 12], f: u => ({ pos: V(iowaC.x + 12 - u * 3, WD.hgt(iowaC.x, iowaC.z + 96) + 15 + u * 1.5, iowaC.z + 92 - u * 5), look: V(iowaC.x + 5, iowaC.y + 1, iowaC.z), fov: 46, roll: 0 }) },
  // 12-14 RAIL STRIKERS.: behind Marcus down the rails, the grain train standing on the siding
  { b: [12, 14], f: u => ({ pos: V(38.6 - u * 2.2, WD.hgt(40, WD.RAILZ) + 1.75, WD.RAILZ + 2.4), look: V(-700, 2.5, WD.RAILZ + 1), fov: 48, roll: 0.02 }) },
  // 14-16: behind the strikers walking to the yard's water tower, OMAHA round its bowl, lightning-lit
  { b: [14, 16], f: u => ({ pos: TCAM.clone().add(V(u * 1.2, 0, -u * 2.6)), look: TOWER.clone().add(V(0, -15, 0)), fov: 36, roll: 0.01 }) },
  // 16-18 STEELWORKERS.: up at the furnace and stacks, Ray's back against the pour
  { b: [16, 18], f: u => ({ pos: pAt(MILL.x + 30 + u * 2.5, MILL.z + 150, 1.5), look: V(MILL.x + 15, 30, MILL.z - 20), fov: 58, roll: -0.03 }) },
  // 18-20: shift change past the cast house mouths, OHIO painted above them
  { b: [18, 20], f: u => ({ pos: millP(-12 + u * 1, 1.5, -2 - u * 1.5), look: millP(-8.5, 6.5, -25), fov: 56, roll: 0.02 }) },
  // 20-22 WE ALL UNITE.: the clasp from the side at hand height (camera placed on the hands after the cast; see world())
  { b: [20, 22], near: 0.05, f: u => ({ pos: V(2.6, WD.hgt(2.6, 507.2) + 1.1, 507.3), look: V(2.6, WD.hgt(2.6, 508.2) + 1.2, 508.2), fov: 46, roll: 0 }) },
  // 22-24 (no text), v12b: the ranks in echelon under the shelf cloud (Lorentz, the Plow's tractors): low on the plain,
  // looking off the road's axis so the ranks step back on a diagonal; they are drawn over it (echelon(), ranks.js)
  { b: [22, 24], f: u => ({ pos: pAt(-6, 488 - u * 5, 1.2), look: V(-420, 60, 0), fov: 54, roll: 0.02 }) },
  // 24-28 OUR PARTY.: low on the road behind the procession, under the shelf (the ranks and the banner are drawn over it)
  { b: [24, 28], f: u => ({ pos: pAt(1.5, 470 - u * 6, 1.7), look: V(-40, 70, 0), fov: 58, roll: -0.015 }) },
  // 28-30 UP SHE GOES.: worm's eye from 0.3 m, the bent swings up against the lightning, the rope crew in front
  { b: [28, 30], near: 0.05, f: u => { const k = 1 - raiseAt(OB(28 + u * 2)); return { pos: V(67.2, Y0() + 0.3, 230.5 - u * 0.8), look: V(65.2, Y0() + lerp(4.5, 7.2, k), 216.2 + lerp(3, 0, k)), fov: 64, roll: 0.06 }; } },
  // 30-31: it seats; the arc flash at the base plate, a Sheeler crop of the anchor bolts
  { b: [30, 31], near: 0.02, f: u => ({ pos: V(60.95 - u * 0.05, Y0() + 0.62, 217.35 - u * 0.05), look: V(60.05, Y0() + 0.32, 216.25), fov: 40, roll: -0.08 }) },
  // 31-32: pull out as the light runs down the road to the next town
  { b: [31, 32], f: u => { const a = ease.inOutCubic(u); return { pos: V(62, Y0() + 3, 238).lerp(V(50, Y0() + 60, 290), a), look: V(64, Y0() + 5, 214).lerp(V(-260, 0, 760), a), fov: 60, roll: 0 }; } },
  // 32-36 THE NEXT TOWN. / THE NEXT.: the relay: the elevator lamps turn red town to town on every kick, 400-900 m up
  { b: [32, 34], f: u => ({ pos: V(1500 - u * 500, 380 + ease.outCubic(u) * 220, 900 + u * 150), look: V(-1600, 0, -260), fov: 52, roll: 0.04 }) },
  { b: [34, 36], f: u => ({ pos: V(-150 - u * 300, 620 + u * 160, 1300 + u * 100), look: V(-2600, 0, -900), fov: 54, roll: -0.03 }) },
  // 36 SAME HANDS.: Dot's gloved hand on the cobot's guide handle (a hand crop from behind her shoulder)
  { b: [36, 37], f: u => ({ pos: V(69.9 - u * 0.08, Y0() + 1.72, 207.5 + u * 0.06), look: V(68.2, Y0() + 1.25, 209.9), fov: 30, roll: 0.02 }) },
  // 37 SAME HANDS.: Marcus's bare hand on the terminal
  { b: [37, 38], f: u => ({ pos: V(63.05 + u * 0.03, Y0() + 1.72, 212.2 - u * 0.05), look: V(62.95, Y0() + 1.45, 213.05), fov: 34, roll: -0.02 }) },
  // 38-42 LIT AS ONE.: the plain from 900 m, red pools to the horizon, then higher through the storm hole
  { b: [38, 40], f: u => ({ pos: V(900 - u * 300, 820 + u * 260, 2400 - u * 200), look: V(-1400, 0, -600), fov: 56, roll: -0.04 }) },
  { b: [40, 42], f: u => ({ pos: V(-1900 + u * 200, 1250 + u * 300, 2300), look: V(-800, 0, -1500), fov: 58, roll: 0.03 }) },
  // 42-46 COMMON WEALTH! x2: the crowd (ranks, 2D); 46-48: the mark as red town lights through the storm hole
  { b: [42, 48], f: u => ({ pos: V(WD.MARK.x, 2700 - u * 120, WD.MARK.z + 60), look: V(WD.MARK.x, 0, WD.MARK.z - 5), fov: 56, roll: u * 0.08, up: V(0, 0, -1) }) },
  // 48-50 COMMUNISM.: low over the wheat, the red sun disc breaking the horizon behind the far ranks
  { b: [48, 50], f: u => ({ pos: pAt(-420 + u * 60, 120, 1.7), look: V(9000, 150, -700), fov: 44, roll: 0 }) },
  // 50-57.5 COMMON WEALTH.: the payoff is 2D (the sky ladder, the far ranks, the hero's fist); the world keeps its clock
  { b: [50, 57.5], f: u => ({ pos: pAt(-360 + u * 240, 120 - u * 15, 1.9), look: V(9000, 150, -700), fov: 50, roll: 0 }) },
  // 57.5-64: the lockup over the last dawn frame from the frame-0 camera; the storm slides back in over it (loop seam)
  { b: [57.5, 64], f: u => ({ pos: pAt(58 + 6 - u * 6, 330 + 55 - u * 55, 2.1), look: V(45, 9, 150), fov: 50, roll: 0.05 }) },
];
function shotAt(beat) { for (const s of SHOTS) if (beat >= s.b[0] && beat < s.b[1]) return s; return SHOTS[SHOTS.length - 1]; }

// ---------------------------------------------------------------- type: Bebas Neue as window light
const WORDS = new Map();
function wordFor(text, y, face = bebas, size = 330, maxW = 960) { const k = text + '|' + y + '|' + size + '|' + (face === bebas ? 'b' : 's'); if (!WORDS.has(k)) WORDS.set(k, shape(face, text, { size, maxW, x: W / 2, y, valign: 'center' })); return WORDS.get(k); }
// v12 type system (brief c4 P8): no neon glow caps anywhere. One heavy condensed face (Anton) stretched vertically
// (the Soviet poster's condensed slab), 60 px side margins, a 190 px cap floor on every frame, the payoff the largest.
//   storm (0-20):  cream cut-out letters with a hard dark drop (paper cut and pasted on the sky), RED. struck hot red
//   march (20-30): stencil letters painted on the Party's red cloth (OUR PARTY. on the banner itself, in the world)
//   drop / chant:  cream on a dark scrim band
//   dawn / pay:    cream cut-outs in front of the red sun, the payoff two lines at 380+ px cap
const CREAM = '#f3e8d0', HOTRED = '#e0221a', INK = '#120808';
const SLABS = new Map();
function slab(text, y, { face = anton, cap = 200, maxW = 960, kMax = 2.2 } = {}) {
  const key = text + '|' + y + '|' + cap + '|' + maxW + '|' + (face === anton ? 'a' : 's');
  if (!SLABS.has(key)) { const w = shape(face, text, { size: 900, maxW, x: W / 2, y, valign: 'center' });
    const nat = w.bbox.y2 - w.bbox.y1 - (text.endsWith('!') ? 0 : 0);
    const capNat = w.glyphs.filter(g => /[A-Z]/.test(g.ch)).reduce((m, g) => Math.max(m, g.bb.h), 1);
    SLABS.set(key, { w, y, k: clamp(cap / capNat, 1, kMax), cap: capNat, nat }); }
  return SLABS.get(key);
}
function drawSlab(S, tf, paint, { dy = 0, k = 1, g = ctx } = {}) {
  g.save(); g.translate(0, S.y + dy); g.scale(1, S.k * k); g.translate(0, -S.y); glyphs(g, S.w, tf, paint); g.restore();
}
const paintCut = (fill, drop = 9) => (g2, g) => {                  // a paper cut-out: a hard offset shadow, then the letter
  g2.save(); g2.translate(drop * 0.55, drop); g2.fillStyle = 'rgba(12,6,6,0.82)'; g2.fill(g.path); g2.restore();
  g2.fillStyle = fill; g2.fill(g.path); };
const paintStencil = (fill = CREAM) => (g2, g) => {
  g2.fillStyle = fill; g2.fill(g.path);
  g2.save(); g2.clip(g.path); g2.globalAlpha = 0.18; g2.fillStyle = '#6a1010';
  for (let i = 0; i < 7; i++) { const x = g.bb.x1 + (i * 37 % g.bb.w), y = g.bb.y1 + ((i * 53) % g.bb.h); g2.fillRect(x, y, 6 + (i % 3) * 5, 3 + (i % 2) * 4); }
  g2.restore(); };
function scrim(y, h, a = 0.62) {                                    // a dark band behind drop type (not a box: feathered)
  const g = ctx.createLinearGradient(0, y - h, 0, y + h); g.addColorStop(0, 'rgba(10,6,8,0)'); g.addColorStop(0.28, `rgba(10,6,8,${a})`);
  g.addColorStop(0.72, `rgba(10,6,8,${a})`); g.addColorStop(1, 'rgba(10,6,8,0)'); ctx.fillStyle = g; ctx.fillRect(0, y - h, W, 2 * h);
}
let SUN = { x: W / 2, y: 900, hor: 980, vis: false };
function bannerCloth(x1, y1, x2, y2, t, col = '#a3111a') {          // a strip of red cloth the march letters are painted on
  const n = 24;
  ctx.save(); ctx.beginPath();
  for (let i = 0; i <= n; i++) { const x = lerp(x1, x2, i / n); ctx.lineTo(x, y1 + 6 * Math.sin(i * 0.9 + t * 7)); }
  for (let i = n; i >= 0; i--) { const x = lerp(x1, x2, i / n); ctx.lineTo(x, y2 + 8 * Math.sin(i * 0.8 + t * 7 + 1)); }
  ctx.closePath(); ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 30; ctx.fillStyle = col; ctx.fill(); ctx.shadowBlur = 0;
  ctx.clip(); for (let i = 0; i < 9; i++) { const x = lerp(x1, x2, (i + 0.5) / 9) + 20 * Math.sin(t * 5 + i);
    const g = ctx.createLinearGradient(x - 60, 0, x + 60, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, i % 2 ? 'rgba(0,0,0,0.24)' : 'rgba(255,120,110,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x - 60, y1 - 20, 120, y2 - y1 + 40); }
  ctx.restore();
}
function cueAt(beat) { for (const c of CUES) if (beat >= c.s && beat < c.e) return c; return null; }
const TYPE_Y = { storm: 380, march: 420, drop: 400, chant: 330, dawn: 330, pay: 0 };
function drawType(beat, t) {
  const c = cueAt(beat); if (!c || c.sec === 'banner') return;           // OUR PARTY. is painted on the banner (procession)
  const age = (beat - c.s) * B.spb, sec = c.sec;
  const pop = s0 => 1 + s0 * Math.exp(-age * 16);
  if (sec === 'storm') {
    const S = slab(c.text, TYPE_Y.storm + (beat < 4 ? -30 : 0), { cap: 210 });
    const red = c.text.endsWith('RED.') ? S.w.n - 4 : 99;
    drawSlab(S, (g, i) => ({ s: pop(0.06) }), (g2, g) => paintCut(g.i >= red ? HOTRED : CREAM, 11)(g2, g));
  } else if (sec === 'march') {
    const S = slab(c.text, TYPE_Y.march, { face: stencilF, cap: 196, maxW: 900 });
    const hh = S.cap * S.k;
    bannerCloth(40, TYPE_Y.march - hh / 2 - 44, W - 40, TYPE_Y.march + hh / 2 + 44, t);
    drawSlab(S, (g, i) => ({ s: pop(0.05), dy: 2 * Math.sin(t * 7 + i * 0.8) / S.k }), paintStencil());
  } else if (sec === 'drop') {
    const S = slab(c.text, TYPE_Y.drop, { cap: 200 });
    scrim(TYPE_Y.drop, S.cap * S.k * 0.95 + 70, 0.66);
    drawSlab(S, () => ({ s: pop(0.05) }), paintCut(CREAM, 8));
  } else if (sec === 'chant') {
    const hits = [c.s, c.s + 0.5, c.s + 1].filter(h => beat >= h), ha = (beat - hits[hits.length - 1]) * B.spb;
    const S = slab(c.text, TYPE_Y.chant, { cap: 215 });
    scrim(TYPE_Y.chant, S.cap * S.k * 0.9 + 60, 0.55);
    // v12b: the chant type pushes in across its two beats (it sat still between hits and the gate read it as a corner bug)
    const cp = 1 + 0.07 * clamp(age / 0.75);
    drawSlab(S, () => ({ s: (1 + 0.12 * Math.exp(-ha * 18)) * cp }), paintCut(CREAM, 10), { k: 1 + 0.08 * Math.exp(-ha * 18), dy: 26 * clamp(age / 0.75) });
  } else if (sec === 'dawn') {
    const S = slab(c.text, TYPE_Y.dawn, { cap: 240 });
    drawSlab(S, () => ({ s: 1.12 - 0.12 * ease.outExpo(clamp(age / 0.22)) }), paintCut(CREAM, 12));
  } else {                                                             // pay: two lines, the largest element on screen
    const k0 = 1.1 - 0.1 * ease.outExpo(clamp(age / 0.22)), push = 1 + 0.035 * clamp(age / 2.8);
    const A1 = slab('COMMON', 420, { cap: 420, maxW: 960, kMax: 2.2 }), A2 = slab('WEALTH.', 420 + 470, { cap: 420, maxW: 960, kMax: 2.2 });
    for (const S of [A1, A2]) drawSlab(S, () => ({ s: k0 * push }), paintCut(CREAM, 16));
  }
}
function sunDisc(t, k, { r = 300, x = SUN.x, cy = null, hor = SUN.hor } = {}) {    // the red sun breaking the horizon
  if (k <= 0) return;
  cy = cy ?? Math.max(SUN.y, hor - r * 0.55);
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, hor); ctx.clip();
  const h = ctx.createRadialGradient(x, cy, r * 0.9, x, cy, r * 2.8); h.addColorStop(0, `rgba(255,50,16,${0.6 * k})`); h.addColorStop(1, 'rgba(255,50,16,0)');
  ctx.fillStyle = h; ctx.fillRect(0, cy - r * 2.9, W, r * 5.8);
  const g = ctx.createRadialGradient(x, cy - r * 0.2, r * 0.1, x, cy, r); g.addColorStop(0, `rgba(255,110,50,${k})`); g.addColorStop(0.85, `rgba(226,30,16,${k})`); g.addColorStop(1, `rgba(196,16,10,${k})`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, cy, r, 0, 7); ctx.fill(); ctx.restore();
}

// ---------------------------------------------------------------- the lockup: 1.4 s over the last dawn frame (frame-0 camera), no card
const LOCK = 1.4;
function lockup(age) {
  if (age > LOCK) return;
  const a = ease.outExpo(clamp(age / 0.18)), out = 1 - ease.inCubic(clamp((age - LOCK + 0.2) / 0.2)), s = lerp(1.1, 1, a);
  const g = ctx.createLinearGradient(0, 560, 0, 1400);                 // a soft dusk scrim so the mark reads on the wheat
  g.addColorStop(0, 'rgba(26,8,10,0)'); g.addColorStop(0.3, `rgba(26,8,10,${0.55 * a * out})`); g.addColorStop(0.7, `rgba(26,8,10,${0.55 * a * out})`); g.addColorStop(1, 'rgba(26,8,10,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 560, W, 840);
  ctx.save(); ctx.globalAlpha = a * out;
  sigil(ctx, W / 2, 860, 220 * s, { color: C.cream, alpha: a * out });
  const fw = wordFor('ACP.US', 1180, bebas, 200, 900); glyphs(ctx, fw, () => ({ s, alpha: a * out }), look.fill(C.cream));
  ctx.restore();
}
// the phonk impact frame (art_research move #6): two frames of two-tone inversion on the three drops only
const IMPACTS = [30, 48, 50];
const tone = canvas2d(W, H).cv;
function impactFrame(beat) {
  const hit = IMPACTS.find(b => beat >= b && (beat - b) * B.spb < 2 / 30 - 1e-4); if (hit == null) return;
  const g = tone.getContext('2d'); g.save(); g.filter = 'grayscale(1) brightness(1.2) contrast(40)'; g.drawImage(ctx.canvas, 0, 0); g.restore();
  ctx.save(); ctx.drawImage(tone, 0, 0); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = hit === 30 ? '#e8341c' : '#ff5a1f'; ctx.fillRect(0, 0, W, H); ctx.restore();
}

// ---------------------------------------------------------------- per frame
const tmpM = new THREE.Matrix4();
// ---------------------------------------------------------------- v15: the real people's shots (Dot, Marcus, Ray; commonwealth3.persons.js)
// Faces at phone size where the words name them, lit by what is there: the lightning (Dot), his own lantern (Marcus), the
// pour (Ray), the crossroads lamp (the clasp), the plant's bulbs (SAME HANDS.). SAME HANDS. is a match cut on action: one
// reach for a handle, in one framing built from the handle, begun by Dot's hand on the cobot and finished by Marcus's on
// the terminal, cut mid-reach on b37.
const UPV = V(0, 1, 0);
const pKey = new THREE.PointLight(0xffffff, 0, 10, 2); scene.add(pKey);
const pFill = new THREE.PointLight(0xffffff, 0, 10, 2); scene.add(pFill);
const pLan = new THREE.PointLight(0xffa050, 0, 10, 2); scene.add(pLan);
const LAN = makeLantern(); LAN.root.visible = false; scene.add(LAN.root);
const pj = (R, n) => R.h.joint(n).clone();
function pPlace(R, p, hd) { const g = R.h.group; g.visible = true; g.position.set(p.x, gy(p.x, p.z), p.z); g.rotation.set(0, hd, 0); g.updateMatrixWorld(true); R.hp.stand(); R.h.update(); }
function pHead(R, yaw = 0, pitch = 0) {            // turn the head on the neck (yaw + = toward the figure's left)
  const h = R.h, lat = R.hp.dirW(V(1, 0, 0));
  if (yaw) { h.rotateWorld('neck01', UPV, yaw * 0.4); h.update(); h.rotateWorld('head', UPV, yaw * 0.6); h.update(); }
  if (pitch) { h.rotateWorld('neck01', lat, pitch * 0.4); h.update(); h.rotateWorld('head', lat, pitch * 0.6); h.update(); } }
function pLight(L, pos, at, col, illum) {          // a light whose irradiance at `at` is `illum` (the scene's units), inverse square
  L.position.copy(pos); const d = Math.max(0.25, pos.distanceTo(at)); L.color.set(col); L.intensity = illum * d * d; L.distance = 0; }
function pCam(pos, look, fov, roll = 0) { camera.position.copy(pos); camera.up.set(0, 1, 0); camera.lookAt(look); if (roll) camera.rotateZ(roll); camera.fov = fov; camera.near = 0.03; camera.updateProjectionMatrix(); camera.updateMatrixWorld(); }
function pHand(R, side, target, pole, grip = null, relax = 0.35) {
  R.hp.arm(side, target, null, pole); R.h.update();
  if (grip) { try { R.h.grip(side, grip); } catch (e) { R.h.relaxHand(side, relax); } } else R.h.relaxHand(side, relax);
  R.h.update(); }
function personShots(beat, t, st, C) {
  for (const R of Object.values(PP)) R.h.group.visible = false;
  LAN.root.visible = false; pKey.intensity = pFill.intensity = pLan.intensity = 0;
  const flash = st ? st.env : 0;
  if (beat >= 8 && beat < 10 && PP.dot) {
    // SMALL FARMERS.: Dot in the wheat under the shelf cloud, three-quarter to us, the storm behind her lighting her edge
    const R = PP.dot, u = (beat - 8) / 2, f = V(-1480, 0, -630).normalize(), r = V(-f.z, 0, f.x);
    const C0 = V(210 + 0.3 * u, 0, 560 - 0.6 * u), D = C0.clone().addScaledVector(f, 1.95 - 0.25 * ease.inOutCubic(u)).addScaledVector(r, 0.14);
    pPlace(R, D, headingTo(D, C0) + 0.42); pHead(R, -0.3, 0); R.after();
    const hd = pj(R, 'head'), eye = V(C0.x, gy(C0.x, C0.z) + 1.48, C0.z);
    pCam(eye, hd.clone().add(V(0, -0.14, 0)).addScaledVector(r, -0.04), 34, 0.015);
    pLight(pKey, hd.clone().addScaledVector(f, -1.1).addScaledVector(r, -0.9).add(V(0, 1.1, 0)), hd, '#c9d0ff', 1.3 + 7 * flash);   // the flash on her face
    pLight(pFill, hd.clone().addScaledVector(f, 1.3).addScaledVector(r, 0.8).add(V(0, 0.7, 0)), hd, '#e4e8ff', 2.2 + 12 * flash); // her edge from the storm
  } else if (beat >= 12 && beat < 14 && PP.marcus) {
    // RAIL STRIKERS.: Marcus on the main line facing us, the strikers down the train behind him; he lifts his lantern on
    // the hit and it lights his face
    const R = PP.marcus, u = (beat - 12) / 2, M = V(33.3, 0, WD.RAILZ + 1.55), C0 = M.clone().add(V(1.85 - 0.25 * ease.inOutCubic(u), 0, -0.32));
    pPlace(R, M, headingTo(M, C0) - 0.38); const fw = R.hp.dirW(V(0, 0, 1)), rt = fw.clone().cross(UPV).normalize();
    const up = ease.outCubic(clamp((beat - 12.3) / 0.45));
    const sh = pj(R, 'upperarm01.R'), w0 = pj(R, 'wrist.R'), w1 = sh.clone().add(V(0, 0.36, 0)).addScaledVector(rt, 0.3).addScaledVector(fw, 0.2);
    pHand(R, 'R', w0.clone().lerp(w1, up).addScaledVector(fw, 0.08 * (1 - up)), rt.clone().multiplyScalar(0.7).add(V(0, -0.5, 0)).addScaledVector(fw, -0.3));
    try { R.h.fist('R'); R.h.update(); } catch (e) { /* the hand stays relaxed */ }
    pHead(R, 0.12 * up, 0); R.after();
    const wr = pj(R, 'wrist.R'); LAN.root.visible = true; LAN.root.position.copy(wr).add(V(0, -0.03, 0)); LAN.root.rotation.set(0, R.h.group.rotation.y, 0);
    const fl = LAN.root.localToWorld(LAN.flame.clone()), hd = pj(R, 'head'), k = 0.88 + 0.12 * Math.sin(t * 17) * Math.sin(t * 5.3);
    pLight(pLan, fl, hd, '#ffa052', (0.9 + 5.5 * up) * k);                                   // the lantern: low, then at his face
    pLight(pFill, hd.clone().addScaledVector(fw, -1.6).addScaledVector(rt, 1.0).add(V(0, 1.2, 0)), hd, '#8a96c8', 1.1 + 3 * flash);   // the yard's cold light behind
    pCam(V(C0.x, gy(C0.x, C0.z) + 1.56, C0.z), hd.clone().add(V(0, -0.16, 0)), 36, -0.01);
  } else if (beat >= 16 && beat < 18 && PP.ray) {
    // STEELWORKERS.: Ray turned toward the pour, the furnace and stacks over his shoulder, his face lit by the iron
    const R = PP.ray, u = (beat - 16) / 2;
    const C0 = V(MILL.x + 30 + 2.5 * u, 0, MILL.z + 150), fur = V(MILL.x + 15, 30, MILL.z - 20), f = fur.clone().sub(C0).setY(0).normalize(), r = V(-f.z, 0, f.x);
    const Rp = C0.clone().addScaledVector(f, 2.15).addScaledVector(r, 0.5), cast = MILL.parts.cast.clone();
    const hC = headingTo(Rp, C0), hF = headingTo(Rp, cast), dH = lerpHeading(hC, hF, 1) - hC;
    pPlace(R, Rp, hC + 0.6 * dH); pHead(R, -0.22 * Math.sign(dH), 0); R.after();   // body 60% to the pour, the face turned back to us
    const hd = pj(R, 'head'), toF = cast.clone().sub(hd).normalize(), k = 0.85 + 0.15 * Math.sin(t * 23) * Math.sin(t * 7);
    pLight(pKey, hd.clone().addScaledVector(toF, 1.3).add(V(0, -0.15, 0)), hd, '#ff7a2c', 5.2 * k);   // the pour on his face
    pLight(pFill, hd.clone().addScaledVector(f, -1.5).addScaledVector(r, -1.0).add(V(0, 0.6, 0)), hd, '#6c78a8', 0.55);
    pCam(V(C0.x, gy(C0.x, C0.z) + 1.5, C0.z), hd.clone().add(V(0, -0.02, 0)).addScaledVector(r, -0.25).add(V(0, 0.35, 0)), 40, -0.02);
    heroFill.intensity = 0;
  } else if (beat >= 20 && beat < 22 && PP.dot && PP.marcus) {
    // WE ALL UNITE.: Dot and Marcus clasp right hands under the crossroads lamp, both faces in profile, from low beside them
    const D = PP.dot, M = PP.marcus, c = V(2.6, 0, 508.2), u = (beat - 20) / 2;
    pPlace(D, V(c.x - 0.39, 0, c.z), Math.PI / 2); pPlace(M, V(c.x + 0.39, 0, c.z + 0.04), -Math.PI / 2);
    const g0 = gy(c.x, c.z), G = V(c.x, g0 + 1.3, c.z + 0.02), cyl = { p: G.clone(), d: V(0.25, 1, 0).normalize(), r: 0.034 };
    pHand(D, 'R', G.clone().add(V(-0.05, -0.03, 0)), V(-0.3, -0.6, 1).normalize(), cyl);
    pHand(M, 'R', G.clone().add(V(0.05, 0.03, 0)), V(0.3, -0.6, -1).normalize(), { ...cyl, d: V(-0.25, 1, 0).normalize() });
    pHead(D, 0, 0); pHead(M, 0, 0); D.after(); M.after();
    pCam(V(c.x + 0.04 - 0.05 * u, g0 + 1.02, c.z - 2.55 + 0.15 * u), V(c.x, g0 + 1.44, c.z), 38, -0.03);
    lampGlow.visible = true; lampGlow.position.copy(G).add(V(0.2, 0.6, 5)); lampGlow.scale.setScalar(4.6); lampGlow.material.color.set(1, 0.12, 0.04).multiplyScalar(2.1);
    crossLight.position.copy(G).add(V(1.4, 0.6, 1.2)); crossLight.color.set(0xff3a1a); crossLight.intensity = 30; crossLight.distance = 8;
    pLight(pKey, G.clone().add(V(-0.7, 1.5, -1.4)), G.clone().add(V(0, 0.3, 0)), '#ffbe7a', 2.4);       // the crossroads lamp on their faces
    pLight(pFill, G.clone().add(V(0.1, 0.7, 1.6)), G.clone().add(V(0, 0.3, 0)), '#ff4a26', 4.5);        // the red behind them
  } else if (beat >= 36 && beat < 38 && (beat < 37 ? PP.dot : PP.marcus)) {
    // SAME HANDS.: the match cut. One reach for a handle, framed from the handle the same way on both sides of the cut.
    const dot = beat < 37, R = dot ? PP.dot : PP.marcus;
    let G, axis, f;
    if (dot) { G = COBOT.grip.getWorldPosition(V(0, 0, 0)); const S0 = V(68.62, 0, 209.12); f = G.clone().sub(S0).setY(0).normalize(); axis = V(-f.z, 0, f.x); }
    else { TERM.head.updateMatrixWorld(true); G = TERM.head.localToWorld(V(0.33, 0.02, 0.0)); const n = V(0, 0, 1).transformDirection(TERM.head.matrixWorld).setY(0).normalize();
      f = n.clone().negate(); axis = V(0, 1, 0).transformDirection(TERM.head.matrixWorld).normalize(); }
    const r = f.clone().cross(UPV).normalize();
    const P0 = G.clone().addScaledVector(f, -0.5).addScaledVector(r, -0.2);                 // she / he stands an arm's length off the handle
    pPlace(R, V(P0.x, 0, P0.z), Math.atan2(f.x, f.z));
    // the reach: s 0 -> 1 across the cut (Dot 0 -> 0.72 by b37; Marcus picks it up at 0.72 and closes on the handle)
    const s = dot ? 0.72 * ease.inOutSine(clamp((beat - 36.15) / 0.85)) : 0.72 + 0.28 * ease.outCubic(clamp((beat - 37) / 0.32));
    const W = G.clone().addScaledVector(f, -0.3 * (1 - s)).add(V(0, -0.26 * (1 - s), 0)).addScaledVector(r, 0.05 * (1 - s)).addScaledVector(r, -0.012);
    const closing = clamp((s - 0.93) / 0.07);
    pHand(R, 'R', W, r.clone().multiplyScalar(0.8).add(V(0, -0.6, 0)), closing > 0 ? { p: G.clone(), d: axis.clone(), r: 0.02 } : null, 0.25 + 0.2 * (1 - s));
    pHead(R, 0, 0); R.after();
    // one framing, built from the handle: beside and a little behind the hand, at the hand's height
    pCam(G.clone().addScaledVector(f, -0.42).addScaledVector(r, 0.42).add(V(0, 0.16, 0)), G.clone().addScaledVector(f, -0.1).add(V(0, -0.06, 0)), 40, 0.02);
    const hand = pj(R, 'wrist.R');
    pLight(pKey, G.clone().add(V(0, 1.1, 0)).addScaledVector(f, 0.3).addScaledVector(r, 0.4), hand, '#ffc68a', 3.0);   // the bay's bulbs
    pLight(pFill, G.clone().addScaledVector(f, 0.6).addScaledVector(r, -0.5), hand, dot ? '#ff9a50' : '#ffb070', 0.9);  // the weld / the screen
  }
}
function world(t, beat) {
  const S = actAt(beat), shot = shotAt(beat), u = (beat - shot.b[0]) / (shot.b[1] - shot.b[0]), ob = OB(beat);
  const cam = shot.f(u);
  camera.position.copy(cam.pos); camera.up.copy(cam.up || V(0, 1, 0)); camera.lookAt(cam.look);
  if (cam.roll) camera.rotateZ(cam.roll);
  camera.fov = cam.fov * (1 + 0.03 * B.env('kick', t, 10) + 0.05 * B.env('impact', t, 5)); camera.near = shot.near || clamp(camera.position.y * 0.05, 0.08, 40); camera.far = 60000;
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  const alt = camera.position.y;
  // wind, wet
  landU.uT.value = t; landU.uGust.value = S.gust * (1 + 0.6 * B.env('taiko', t, 3)); wetU.value = S.wet;
  wheatU.uCamP.value.copy(camera.position);
  for (const w of wheat) w.visible = alt < 400;
  wheat[0].visible = wheat[1].visible = alt < 60;
  // lights
  const st = beat < 32.5 ? strikeAt(beat) : null;
  hemi.color.copy(S.hsky); hemi.groundColor.copy(S.hgnd); hemi.intensity = S.hI;
  let kd = S.keyDir.clone(), kc = S.keyC.clone(), ki = S.keyI;
  let boltP = null;
  if (st) {
    const r = rng(Math.round(st.b * 8) + 3), fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    const rt = V(-fwd.z, 0, fwd.x), D = 700 + r() * 1400;
    boltP = camera.position.clone().add(fwd.multiplyScalar(D)).add(rt.multiplyScalar((r() - 0.5) * D * 0.7)); boltP.y = 0;
    const top = boltP.clone().add(V((r() - 0.5) * 400, 1500, (r() - 0.5) * 400));
    buildBolt(boltSegs(Math.round(st.b * 8) + 1, top, V(boltP.x, WD.hgt(boltP.x, boltP.z), boltP.z)), 2.2);
    bolt.visible = st.age < 0.3;
    boltMat.color.set(st.red ? 0xffc0b0 : 0xf2f4ff).multiplyScalar(4.5 * Math.min(1.3, st.env));
    const fl = st.env;
    kd = top.clone().sub(camera.position).setY(0).normalize().setY(1.1).normalize();
    kc.lerp(st.red ? col('#ff2a1a') : col('#e6e4ff'), clamp(fl)); ki += 1.1 * fl;
  } else bolt.visible = false;
  // the key: shadows cast around what the camera looks at
  const focus = cam.look.clone(); if (alt > 200) focus.set(camera.position.x, 0, camera.position.z);
  const fd = Math.min(camera.position.distanceTo(focus), 400);
  const tgt = camera.position.clone().lerp(focus, 0.5); tgt.y = 0;
  key.target.position.copy(tgt); key.position.copy(tgt).add(kd.clone().multiplyScalar(800));
  key.color.copy(kc); key.intensity = ki;
  const sc = clamp(fd * 0.7 + 60, 60, 420);
  Object.assign(key.shadow.camera, { left: -sc, right: sc, top: sc, bottom: -sc, near: 10, far: 2000 }); key.shadow.camera.updateProjectionMatrix();
  key.castShadow = alt < 300;
  wheatU.uKeyDir.value.copy(kd); wheatU.uKeyCol.value.copy(S.keyC).multiplyScalar(S.keyI * 0.25);
  // town lights: embers in the storm; the first hall on HAPPENS / LIGHTS UP; the network from 30
  const lit = uLit.value;
  for (const tw of towns) {
    const ig = tw.ign ?? 99, base = beat < 30 ? 0.12 : beat < 48 ? 0.12 : 0.35;
    let v = beat >= ig ? 1 : base;
    if (beat >= ig && beat - ig < 0.25) v = (Math.sin((beat - ig) * 120) > 0 ? 1 : 0.35);
    if (beat >= 48) v = lerp(v, 0.55, smooth(48, 56, beat));
    lit[tw.idx] = v * (tw.bright || 1);
  }
  // the first hall: dark, a flicker on HAPPENS (24), full on LIGHTS UP (28)
  lit[1] = ob < 24 ? 0.06 : ob < 26 ? (0.25 + 0.35 * (Math.sin(t * 37) > 0.2 ? 1 : 0.2)) : ob < 28 ? 1.0 : 1.8;
  lit[0] = Math.max(lit[0], beat < 24 ? 0.15 : lit[0]);
  hallU.uHallT.value = t; hallU.uHallK.value = ob >= 24 && ob < 30 ? 1 : beat >= 36 && beat < 38 ? 1 : 0; hallU.uHallY.value = A.y;
  const open = ob >= 28 && ob < 30 ? ease.outCubic((ob - 28) / 1.2) : beat >= 48 ? 1 : 0;
  doors[0].rotation.y = -open * 1.7; doors[1].rotation.y = open * 1.7;
  interior.visible = (ob >= 26 && ob < 30) || beat >= 48;
  hallLight.intensity = interior.visible && alt < 80 ? (ob < 28 ? 18 : 30) : 0;
  doorLight.position.copy(HD).add(V(0, 0.8, 3)); doorLight.intensity = open * (ob >= 29 && ob < 30 ? 35 : 60) + (lit[1] > 0.5 ? 20 : 0) * (alt < 80 ? 1 : 0);
  // the mill's fire
  const nearMill = Math.hypot(camera.position.x - MILL.x, camera.position.z - MILL.z) < 700;
  fireLight.position.copy(MILL.parts.cast).add(V(0, 3, 14)); fireLight.intensity = nearMill ? (beat >= 18 && beat < 20 ? 70 : 900) * (0.85 + 0.15 * Math.sin(t * 23) * Math.sin(t * 7)) : 0;
  MATS.lamp.color.setRGB(1, 0.75, 0.4).multiplyScalar(beat < 48 ? 6 : 2);
  glowU.uGT.value = t; glowU.uGK.value = beat >= 18 && beat < 20 ? 0.42 : 1;
  // flag
  { const p = flagGeo.attributes.position; for (let i = 0; i < p.count; i++) { const x0 = flagBase[i * 3], y0 = flagBase[i * 3 + 1], k = (x0 + 1.3) / 2.6;
      p.setZ(i, Math.sin(x0 * 3 - t * 9) * 0.22 * k + Math.sin(x0 * 5.3 - t * 14 + y0 * 2) * 0.06 * k); } p.needsUpdate = true; flagGeo.computeVertexNormals(); }
  // ---- Plant No. 1: the bent lies in the lot until IT CALLS, swings up on 30-31, the bay fills in behind it on the drop
  PLANT.root.visible = ob >= 29.9;
  PLANT.bents[0].rotation.x = raiseAt(ob) * Math.PI / 2;
  PLANT.bents.forEach((b, i) => { if (i) { const k = ease.outCubic(clamp((beat - 32 - 0.5 * i) / 0.5)); b.visible = k > 0.01; b.scale.set(1, Math.max(k, 0.01), 1); } });
  for (const m of PLANT.purlins) m.visible = beat >= 34.2; for (const m of PLANT.clad) m.visible = beat >= 35;
  for (const b of PLANT.bulbs) b.visible = beat >= 34;
  for (const m of RIG) m.visible = beat >= 35.5;
  const weld36 = beat >= 36 && beat < 37;
  if (beat >= 35.5 && beat < 38) { const u = clamp((beat - 36) / 1.8); COBOT.reach(V(67.85 + 0.8 * u, PLANT.root.position.y + 1.3, 209.9)); if (beat >= 37) TERM.draw(clamp((beat - 37) / 0.9)); }
  // ---- the people: cast this beat, pose, hang the props
  const C = cast(ob, t);
  People.wet.value = S.wet * (beat >= 36 && beat < 38 ? 0.3 : 1);
  folk.update(camera); silPatch();
  if (beat >= 36 && beat < 38 && !(beat < 37 ? PP.dot : PP.marcus)) {   // (fallback) put the folk hand on the cobot's guide handle / on the screen
    const tgt = beat < 37 ? COBOT.grip.getWorldPosition(V(0, 0, 0)) : TERM.screen.getWorldPosition(V(0, 0, 0)).add(V(-0.07, 0.03, -0.03));
    const HAND = beat < 37 ? DOT : MARCUS, st = folk.get(HAND); st.lift2 = 0.5;
    for (let it = 0; it < 3; it++) { const g = folk.gripPos(HAND, -1, V(0, 0, 0)); st.x += (tgt.x - g.x) * 0.9; st.z += (tgt.z - g.z) * 0.9; st.y = gy(st.x, st.z); st.lift2 = clamp(st.lift2 + (tgt.y - g.y) / 0.85); folk.update(camera); }
    // v12: a hand crop from behind the shoulder (SAME HANDS.): the glove on the handle / the bare hand on the screen
    const g = folk.gripPos(HAND, -1, V(0, 0, 0)), bk = V(Math.sin(st.heading), 0, Math.cos(st.heading)).multiplyScalar(-1), sd = V(bk.z, 0, -bk.x), uu = beat % 1;
    camera.position.copy(g).addScaledVector(bk, 0.62 - 0.05 * uu).addScaledVector(sd, beat < 37 ? 0.32 : -0.3).add(V(0, 0.34, 0));
    camera.up.set(0, 1, 0); camera.lookAt(g.clone().add(V(0, -0.04, 0))); camera.fov = 40; camera.near = 0.03; camera.updateProjectionMatrix(); camera.updateMatrixWorld(); folk.update(camera);
  }
  lampGlow.visible = !!C.clasp;
  if (C.clasp) { const P = folk.gripPos(DOT, -1, V(0, 0, 0)), d = P.clone().sub(camera.position).normalize(); lampGlow.position.copy(P).addScaledVector(d, 6); lampGlow.scale.setScalar(7); }
  if (C.clasp) {                                   // lock the clasp: Marcus steps to Dot's hand, both hands at one height
    const sd = folk.get(DOT), sm = folk.get(MARCUS);
    for (let it = 0; it < 4; it++) { const gd = folk.gripPos(DOT, -1, V(0, 0, 0)), gm = folk.gripPos(MARCUS, -1, V(0, 0, 0));
      const tgt = gd.clone().add(V(-0.22, 0.0, -0.04)); sm.x += (tgt.x - gm.x) * 0.9; sm.z += (tgt.z - gm.z) * 0.9; sm.y = gy(sm.x, sm.z);
      const dy = gd.y - gm.y; sm.lift2 = clamp((sm.lift2 || 0) + dy * 1.6, -0.6, 0.8); folk.update(camera); }
    // v12: the camera on the hands from the side, at hand height: the two forearms fill the frame (Klutsis scale),
    // the red crossroads lamp behind them, no face in frame
    const gp = folk.gripPos(DOT, -1, V(0, 0, 0)).lerp(folk.gripPos(MARCUS, -1, V(0, 0, 0)), 0.5), uu = (beat - 20) / 2;
    camera.position.copy(gp).add(V(0.05 - 0.04 * uu, -0.12, -1.12 + 0.06 * uu)); camera.up.set(0, 1, 0); camera.lookAt(gp.clone().add(V(0, 0.07, 0)));
    camera.rotateZ(-0.05); camera.fov = 44; camera.near = 0.05; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    lampGlow.position.copy(gp).add(V(0.25, 0.35, 5)); lampGlow.scale.setScalar(4.2); lampGlow.material.color.set(1, 0.12, 0.04).multiplyScalar(2.1);
    crossLight.position.copy(gp).add(V(1.4, 0.5, 1.2)); crossLight.color.set(0xff3a1a); crossLight.intensity = 30; crossLight.distance = 8;
    folk.update(camera);
  } else lampGlow.material.color.set(1, 0.62, 0.3).multiplyScalar(3.2);
  personShots(beat, t, st, C);                   // v15: the real people (after the cast, before the props)
  props(beat, t, C);
  doorRed.visible = doorRedCore.visible = beat >= 4; doorRedL.intensity = beat >= 6 && camera.position.y < 80 ? 26 : 0;
  // the arc flash at the column foot on 31, pulsing with the hall window: this is what calls the next town
  if (C.arc) { const ap = V(60.1, PLANT.root.position.y + 0.35, PLANT.root.position.z + 0.1); arcLight.position.copy(ap).add(V(0, 0.6, 0.6)); arcLight.intensity = 7 * C.arc; arcGlow.visible = true; arcGlow.position.copy(ap); arcGlow.scale.setScalar(0.08 + 0.1 * C.arc); lit[1] *= 1 + 0.8 * C.arc; }
  if (weld36) { fireLight.position.copy(COBOT.tip.getWorldPosition(V(0, 0, 0))).add(V(0, 0.15, 0)); fireLight.intensity = 14 * (0.55 + 0.45 * Math.sin(t * 90) * Math.sin(t * 31)); fireLight.distance = 18; } else fireLight.distance = 220;
  if (beat >= 36 && beat < 38) { const bulbs = 1; PLANT.bulbMat.color.setRGB(1, 0.72, 0.38).multiplyScalar(9 * bulbs); }
  if (beat >= 37 && beat < 38) { heroFill.position.copy(TERM.screen.getWorldPosition(V(0, 0, 0))).add(V(-0.35, 0.05, -0.15)); heroFill.color.set(0xffb070); heroFill.intensity = 5.5; heroFill.distance = 3; }
  else if (beat >= 36 && beat < 37) { heroFill.position.set(68.9, PLANT.root.position.y + 3.2, 211.2); heroFill.color.set(0xffc080); heroFill.intensity = 10; heroFill.distance = 9; }
  else if (!(beat >= 30 && beat < 32)) heroFill.distance = 12;
  // sparks: the mill's tap, the arc at the bent's foot, the cobot's weld
  sparkMat.uniforms.uT.value = t;
  const arcOn = ob >= 31 && ob < 32;
  if (weld36) { sparkMat.uniforms.uO.value.copy(COBOT.tip.getWorldPosition(V(0, 0, 0))); sparkMat.uniforms.uSpread.value = 0.05; sparkMat.uniforms.uV.value = 0.18; }
  else if (arcOn) { sparkMat.uniforms.uO.value.set(60.1, PLANT.root.position.y + 0.4, PLANT.root.position.z + 0.2); sparkMat.uniforms.uSpread.value = 0.1; sparkMat.uniforms.uV.value = 0.45; }
  else { sparkMat.uniforms.uO.value.copy(MILL.parts.cast).add(V(0, 1, 4)); sparkMat.uniforms.uSpread.value = 18; sparkMat.uniforms.uV.value = 1; }
  sparkMat.uniforms.uI.value = nearMill ? 1 : weld36 ? 1 : arcOn ? (C.arc || 0) * 1.5 + 0.2 : 0;
  // the lantern points, the plants, the spurs, the lantern flow on the network
  farGeo.attributes.position.needsUpdate = farGeo.attributes.aB.needsUpdate = true; farGeo.setDrawRange(0, farN);
  plantU.uBeat.value = beat; plantU.uT.value = t; plantU.uLitK.value = (beat < 48 ? 1 : 1 - 0.5 * smooth(48, 56, beat)) * (alt > 150 ? 0 : 1);
  flowMat.uniforms.uBeat.value = beat; flowMat.uniforms.uT.value = t; flowMat.uniforms.uI.value = 2.6 * (beat < 48 ? 1 : 1 - smooth(48, 51, beat)) * smooth(40, 120, alt) * (alt > 150 ? 0 : 1);   // v12: no lantern-line network from the air
  // network
  roads.material.uniforms.uBeat.value = beat; roads.material.uniforms.uT.value = t;
  spurs.material.uniforms.uBeat.value = beat; spurs.material.uniforms.uT.value = t; spurs.material.uniforms.uW.value = clamp(alt * 0.006, 1, 18); spurs.material.uniforms.uI.value = beat < 48 ? 1 : 1 - smooth(48, 54, beat) * 0.85;
  markRoads.material.uniforms.uBeat.value = beat; markRoads.material.uniforms.uT.value = t;
  const rw = clamp(alt * 0.008, 2.0, 24);
  roads.material.uniforms.uW.value = rw; markRoads.material.uniforms.uW.value = rw * 1.25;
  roads.material.uniforms.uI.value = markRoads.material.uniforms.uI.value = beat < 48 ? 1 : 1 - smooth(48, 54, beat) * 0.85;
  roads.visible = spurs.visible = false; markRoads.visible = false;   // v12: no outline lines either: the mark is pools of red light             // v11: no node-and-link lines; the light travels as lantern streams on the real roads
  markMat.uniforms.uBeat.value = beat; pxU.value = RH / PK / (2 * Math.tan(camera.fov * Math.PI / 360));
  ptsMat.uniforms.uFade.value = beat < 48 ? 1 : 1 - smooth(48, 54, beat) * 0.7; glowMat.uniforms.uFade.value = beat < 30 ? 0.3 : beat < 48 ? 0.4 : 0.4 * (1 - smooth(48, 50, beat));
  // rain
  rainMat.uniforms.uCamP.value.copy(camera.position); rainMat.uniforms.uT.value = t; rainMat.uniforms.uPx.value = 2 * Math.tan(camera.fov * Math.PI / 360) / (RH / PK); rainMat.uniforms.uI.value = S.rain * (alt < 200 ? 1 : 0);
  rainMat.uniforms.uFlash.value = st ? st.env : 0; rainMat.uniforms.uCol.value.copy(S.rainC).multiplyScalar(0.9);
  // the people rule per shot: silhouettes with a rim from the backlight, everywhere people are near the camera
  SIL.uSil.value = beat >= 8 && beat < 32 ? 1 : beat >= 36 && beat < 38 ? 1 : 0;
  nightDkU.value = beat >= 4 && beat < 6 ? 0.55 : beat >= 31.5 && beat < 42 ? 0.88 : beat >= 42 && beat < 48 ? 1 : 0;
  { const rd = kd.clone();
    if (beat >= 12 && beat < 16) rd.set(0.2, 0.3, -1);
    if (beat >= 16 && beat < 20) rd.copy(MILL.parts.cast).sub(camera.position).normalize();
    if (beat >= 20 && beat < 22) rd.copy(lampGlow.position).sub(camera.position).normalize();
    if (beat >= 24 && beat < 28) rd.set(0, 0.4, beat < 26 ? 1 : 1).normalize();
    SIL.uRimDir.value.copy(rd).transformDirection(camera.matrixWorldInverse);
    SIL.uRimCol.value.set(beat < 12 ? '#c4ccff' : beat < 16 ? '#ffb060' : beat < 20 ? '#ff8a3a' : beat < 22 ? '#ff4a26' : beat >= 28 && beat < 32 ? '#dfe4ff' : '#ffc07a'); }
  // ---- passes
  renderer.setRenderTarget(rtScene); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(scene, camera);
  const vu = volMat.uniforms;
  vu.uInvProj.value.copy(camera.projectionMatrixInverse); vu.uCamWorld.value.copy(camera.matrixWorld); vu.uCam.value.copy(camera.position);
  vu.uTime.value = t; vu.uFrame.value = Math.round(t * 30);
  vu.uCover.value = S.cover; vu.uDens.value = S.dens; vu.uRain.value = S.rain;
  vu.uHoleC.value.set(beat < 38 ? 0 : WD.MARK.x, beat < 38 ? 300 : WD.MARK.z);
  if (beat >= 35 && beat < 38) vu.uHoleR.value = 9000; vu.uHoleR.value = beat < 30 ? 1 : beat < 38 ? lerp(1, 5200, smooth(30, 35, beat)) : beat < 47 ? lerp(9000, 1350, smooth(41.5, 43.5, beat)) : lerp(1350, 7000, smooth(47, 48.6, beat));
  vu.uEdge.value = beat < 47 ? 0 : smooth(47, 50, beat) * 0.9;
  
  vu.uWind.value.set(t * 0.08, t * 0.03);
  vu.uCloudLo.value.copy(S.lo); vu.uCloudHi.value.copy(S.hi); vu.uRainCol.value.copy(S.rainC); vu.uHorCol.value.copy(S.horC);
  vu.uSunDir.value.copy(S.sunDir); vu.uSunCol.value.copy(S.sunCol).multiplyScalar(2.2); vu.uUnder.value = S.under;
  vu.uShelf.value.w = S.stormK; vu.uNightGlow.value = beat >= 31 && beat < 50 ? (beat < 48 ? 1 : 1 - smooth(48, 50, beat)) : 0;
  if (boltP) { vu.uBoltPos.value.set(boltP.x, 1300, boltP.z); vu.uBoltI.value = st.env; vu.uBoltCol.value.set(st.red ? '#ff5040' : '#dfe4ff'); } else vu.uBoltI.value = 0;
  renderer.setRenderTarget(rtVol); renderer.render(volScene, orthoCam);
  const cu = compMat.uniforms;
  cu.uInvProj.value.copy(camera.projectionMatrixInverse); cu.uCamWorld.value.copy(camera.matrixWorld); cu.uCam.value.copy(camera.position);
  cu.uZen.value.copy(S.zen); cu.uHor.value.copy(S.hor); cu.uGnd.value.copy(S.gnd); cu.uSunDir.value.copy(S.sunDir); cu.uSunCol.value.copy(S.sunCol).multiplyScalar(1.6);
  cu.uFogCol.value.copy(S.fog); cu.uSunDisc.value = S.sunDisc; cu.uFogD.value = S.fogD; cu.uFogH.value = S.fogH;
  cu.uExpo.value = S.expo * (1 + 0.25 * B.env('impact', t, 4)); cu.uRays.value = S.rays; cu.uStars.value = S.stars; cu.uGlowHor.value = S.glowHor; cu.uTime.value = t;
  cu.uFlash.value = st ? 0.05 * st.env : 0; cu.uFlashCol.value.set(st && st.red ? '#ff3020' : '#c8ccff');
  { const sp = camera.position.clone().add(S.sunDir.clone().multiplyScalar(10000)).project(camera); cu.uSunUV.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5); if (sp.z > 1) cu.uRays.value = 0;
    const fw = V(0, 0, 0); camera.getWorldDirection(fw); fw.y = 0; fw.normalize();
    const hp = camera.position.clone().addScaledVector(fw, 40000).setY(0).project(camera);
    SUN = { x: (sp.x * 0.5 + 0.5) * W, y: (0.5 - sp.y * 0.5) * H, hor: (0.5 - hp.y * 0.5) * H, vis: sp.z < 1 }; }
  renderer.setRenderTarget(null); renderer.render(compScene, orthoCam);
  return { S, st };
}

// ---------------------------------------------------------------- v12: the mark as red town lights under the storm hole (b46-48)
// Seen straight down through the hole in the deck: the fields near black, the four-stripe mark made of the towns'
// red lamps (steady pools, no sparkle), a red haze where the lamps light the rain air, the cloud walls round the hole.
const markPts = (() => { const E = BRAND.acp_emblem, cw = 120, ch = Math.round(cw * E.height / E.width), c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const g = c.getContext('2d'); g.drawImage(E, 0, 0, cw, ch); const d = g.getImageData(0, 0, cw, ch).data, pts = [], r = rng(46);
  // v12b: sparse towns, not a glitter grid: one pool per 4 px cell of a 120 px mark, jittered, each with its own size
  for (let y = 1; y < ch; y += 4) for (let x = 1; x < cw; x += 4) if (d[(y * cw + x) * 4 + 3] > 150) pts.push([x / cw - 0.5 + (r() - 0.5) * 0.012, (y - ch / 2) / cw + (r() - 0.5) * 0.012, 0.65 + 0.35 * r()]);
  // the rest of the plain: a few dim sodium towns scattered outside the mark (the mark is a region lit red, on a real map)
  for (let i = 0; i < 70; i++) { const x = (r() - 0.5) * 1.3, y = (r() - 0.5) * 1.9; pts.push([x, y, -(0.25 + 0.35 * r())]); }
  return pts; })();
const markHaze = (() => { const E = BRAND.acp_emblem, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const w = 960, h = w * E.height / E.width; g.filter = 'blur(28px)'; g.drawImage(tinted(E, '#ff2a10'), W / 2 - w / 2, H * 0.47 - h / 2, w, h); return c; })();
function markLights(t, beat) {
  const u = (beat - 46) / 2, z = 1 + 0.05 * u, rot = 0.05 * u;
  ctx.fillStyle = '#07060a'; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.translate(W / 2, H * 0.47); ctx.rotate(rot); ctx.scale(z, z); ctx.translate(-W / 2, -H * 0.47);
  ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.75 * (0.25 + 0.75 * smooth(46, 47.2, beat)); ctx.drawImage(markHaze, 0, 0); ctx.globalAlpha = 1;
  const w = 960;
  for (const [x, y, b0] of markPts) { const px = W / 2 + x * w, py = H * 0.47 + y * w;
    if (b0 < 0) { const b = -b0, R0 = 16 * b; const gr = ctx.createRadialGradient(px, py, 0, px, py, R0);      // dim sodium towns
      gr.addColorStop(0, `rgba(255,170,80,${0.5 * b})`); gr.addColorStop(1, 'rgba(255,120,40,0)'); ctx.fillStyle = gr; ctx.fillRect(px - R0, py - R0, 2 * R0, 2 * R0); continue; }
    // the relay completes the mark: each town's lamp goes red on its own step, left to right, 46.0 -> 47.0 (a flare, then steady)
    const on = 45.95 + 0.9 * clamp(x + 0.5), a = beat - on; if (a < 0) continue;
    // each town is a pool of red light in the fog (wide, soft, overlapping its neighbours into one lit region); only
    // one town in four shows a hot lamp core, and it does not twinkle
    const fl = 1 + 0.8 * Math.exp(-a * 5), b = b0 * Math.min(1, a / 0.12 + 0.3), R0 = 46 * fl, hot = ((px * 7 + py * 13) | 0) % 4 === 0;
    const gr = ctx.createRadialGradient(px, py, 0, px, py, R0);
    gr.addColorStop(0, `rgba(255,${hot ? 150 : 70},${hot ? 90 : 30},${(hot ? 0.8 : 0.34) * b})`); gr.addColorStop(hot ? 0.12 : 0.3, `rgba(235,40,14,${0.3 * b})`); gr.addColorStop(1, 'rgba(160,16,8,0)');
    ctx.fillStyle = gr; ctx.fillRect(px - R0, py - R0, 2 * R0, 2 * R0); }
  ctx.restore();
  const v = ctx.createRadialGradient(W / 2, H * 0.47, 420, W / 2, H * 0.47, 1100);   // the cloud walls of the hole
  v.addColorStop(0, 'rgba(20,14,20,0)'); v.addColorStop(0.55, 'rgba(40,26,34,0.55)'); v.addColorStop(1, 'rgba(70,40,48,0.95)'); ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
}

// ---------------------------------------------------------------- v12: the people as designed ranks (HUMAN c3, ranks.js + SIL)
// No front-lit faces at mid distance or closer: the farmers, the procession, the rope crew, the chant and the payoff
// crowd are SIL ranks from behind, lit only by the scene's backlight; the payoff hero is a 3D back (KITS.backs) with
// one fist at monument scale.
const STY = {
  storm: { ink: ['#07060a', '#141219', '#25222c', '#39343f', '#514a55'], rim: '#dfe6ff', rimAmt: [1.0, 0.85, 0.6, 0.4, 0.25], key: '#8a90b0', keyAmt: [0.04, 0.03, 0.02, 0, 0],
    acc: '#020203', accAmt: [0.6, 0.5, 0.3, 0.1, 0], shadow: '#050408', shadowA: 0.55, ground: ['#2a2418', '#0a0806'], dust: '#8088a8', flag: '#b8141a', flagDark: '#62080a', emblem: '#f2d27a' },
  red: { ink: ['#070304', '#120506', '#240808', '#3c0c0a', '#5a140c'], rim: '#ff5a2a', rimAmt: [1.0, 0.85, 0.65, 0.45, 0.3], key: '#ff3a1a', keyAmt: [0.08, 0.06, 0.04, 0.02, 0],
    acc: '#020101', accAmt: [0.6, 0.5, 0.3, 0.1, 0], shadow: '#030101', shadowA: 0.7, ground: ['#4a0c08', '#0a0303'], dust: '#ff4a1c', flag: '#c8180e', flagDark: '#6a0806', emblem: '#ffd070' },
};
let RK = null, STORM = null, FIST = null; const CROWDS = {};
async function ranks() { if (!RK) { RK = await Ranks.create({ W, H }); RK.emblem = await loadImage('../assets/acp_mark.png'); } return RK; }
async function storm() { if (!STORM) { const t0 = performance.now(); STORM = await makeStorm({ W, H, n: 6, nLayer: 3 }); console.log('storm plate built', Math.round(performance.now() - t0), 'ms'); } return STORM; }
async function crowd(name, make) { if (!CROWDS[name]) CROWDS[name] = make(await ranks()); return CROWDS[name]; }
const tB = b => b * B.spb;
// 2D rain over the storm plate: slanted streaks, brighter on a flash
function rain2d(t, k = 1, flash = 0) {
  if (k <= 0) return; const r = rng(Math.floor(t * 30) * 7 + 3);
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `rgba(190,196,214,${(0.1 + 0.25 * flash) * k})`; ctx.lineWidth = 1.6;
  ctx.beginPath(); for (let i = 0; i < 420 * k; i++) { const x = r() * (W + 300) - 150, y = r() * H, L = 40 + r() * 70; ctx.moveTo(x, y); ctx.lineTo(x - L * 0.22, y + L); } ctx.stroke(); ctx.restore();
}
// the banner: face-on to the lens, 60% of the frame wide, OUR PARTY. stencilled on the cloth with the ACP emblem
const banCv = document.createElement('canvas'); banCv.width = W; banCv.height = H; const bg2 = banCv.getContext('2d');
function drawBanner(t, beat, push = 1) {
  const g = bg2; g.clearRect(0, 0, W, H);
  const open = beat < 24 ? 0.04 : ease.outBack(clamp((beat - 24) / 0.4)), wave = 1 + 2.5 * Math.exp(-Math.max(0, beat - 24) * 2.5);
  const cx = W / 2, hw = 330 * push, top = 700 - 40 * (push - 1) * 4, foot = 1760, hh = 500 * push * clamp(open, 0.02, 1.15);
  g.save(); g.strokeStyle = '#140b07'; g.lineCap = 'round';
  for (const s0 of [-1, 1]) { g.lineWidth = 16 * push; g.beginPath(); g.moveTo(cx + s0 * (hw + 10), foot); g.lineTo(cx + s0 * (hw + 6), top - 30); g.stroke();
    g.fillStyle = '#c8a040'; g.beginPath(); g.moveTo(cx + s0 * (hw + 6) - 12, top - 30); g.lineTo(cx + s0 * (hw + 6) + 12, top - 30); g.lineTo(cx + s0 * (hw + 6), top - 70); g.fill(); }
  g.lineWidth = 9 * push; g.beginPath(); g.moveTo(cx - hw - 6, top); g.lineTo(cx + hw + 6, top); g.stroke(); g.restore();
  // cloth: vertical fold strips, each hanging from the bar, the hem waving
  const n = 36, pts = [];
  for (let i = 0; i <= n; i++) { const u = i / n, x = cx - hw + 2 * hw * u, ph = u * 9 - t * 7;
    pts.push([x + Math.sin(ph) * 6 * wave, top + 6, top + hh + Math.sin(ph + 0.8) * 10 * wave + Math.sin(u * Math.PI) * 14, Math.cos(ph)]); }
  g.save(); g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const q of pts) g.lineTo(q[0], q[1]); for (let i = n; i >= 0; i--) g.lineTo(pts[i][0], pts[i][2]); g.closePath();
  g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 30; g.fillStyle = '#a8121a'; g.fill(); g.shadowBlur = 0; g.clip();
  if (open > 0.5) {
    acpEmblem(g, cx, top + hh * 0.2, hh * 0.22, { color: CREAM, alpha: clamp((open - 0.5) * 3) });
    const S = slab('OUR PARTY.', top + hh * 0.64, { face: stencilF, cap: 200 * push, maxW: 2 * hw * 0.9, kMax: 2.4 });
    drawSlab(S, () => ({ s: 1 }), paintStencil(), { g, k: clamp(open, 0, 1.1) });
  }
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[i + 1], sh = a[3];
    g.fillStyle = sh > 0 ? `rgba(255,140,120,${0.1 * sh})` : `rgba(0,0,0,${-0.3 * sh})`; g.fillRect(a[0], top, b[0] - a[0] + 1, hh + 30); }
  g.restore();
  return banCv;
}
// the chant's sky: night, lit red from below by the town beacons along the horizon
function chantSky(g, t) {
  const hor = 1180, gr = g.createLinearGradient(0, 0, 0, hor); gr.addColorStop(0, '#07040a'); gr.addColorStop(0.5, '#2a0708'); gr.addColorStop(0.85, '#8a1a0c'); gr.addColorStop(1, '#e8481c');
  g.fillStyle = gr; g.fillRect(0, 0, W, hor);
  g.save(); g.globalCompositeOperation = 'lighter'; const r = rng(77);
  for (let i = 0; i < 26; i++) { const x = r() * W, y = hor - 4 - r() * 14, R0 = 30 + r() * 120, fl = 0.8 + 0.2 * Math.sin(t * 7 + i);
    const c = g.createRadialGradient(x, y, 0, x, y, R0); c.addColorStop(0, `rgba(255,80,30,${0.5 * fl})`); c.addColorStop(1, 'rgba(255,30,10,0)'); g.fillStyle = c; g.fillRect(x - R0, y - R0, 2 * R0, 2 * R0);
    g.fillStyle = 'rgba(255,200,160,0.9)'; g.fillRect(x - 1.5, y - 1.5, 3, 3); }
  // the cloud deck's underside catching the red, in bands
  for (let k = 0; k < 6; k++) { const y = 260 + k * 120 + 20 * Math.sin(t * 0.7 + k), gg = g.createLinearGradient(0, y - 50, 0, y + 50);
    gg.addColorStop(0, 'rgba(0,0,0,0)'); gg.addColorStop(0.7, `rgba(180,30,12,${0.06 + 0.04 * k})`); gg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gg; g.fillRect(0, y - 50, W, 100); }
  g.restore();
}
// the payoff's sky: the red / orange ladder in flat bands (poster, not a pale wash), the sun disc on the horizon
const PAY = { hor: 1330, sun: [540, 1170], r: 330 };
function paySky(g, t) {
  const hor = PAY.hor, bands = ['#2a0508', '#4a0a0a', '#74120c', '#a41e10', '#cc3414', '#e85418', '#f7782a'];
  for (let i = 0; i < bands.length; i++) { const y0 = hor * (i / bands.length) ** 0.8, y1 = hor * ((i + 1) / bands.length) ** 0.8; g.fillStyle = bands[i]; g.fillRect(0, y0, W, y1 - y0 + 1); }
  const [sx, sy] = PAY.sun, R0 = PAY.r;
  g.save(); g.beginPath(); g.rect(0, 0, W, hor); g.clip();
  const h = g.createRadialGradient(sx, sy, R0 * 0.9, sx, sy, R0 * 2.4); h.addColorStop(0, 'rgba(255,120,40,0.55)'); h.addColorStop(1, 'rgba(255,80,20,0)'); g.fillStyle = h; g.fillRect(0, 0, W, hor);
  const sd = g.createRadialGradient(sx, sy - R0 * 0.25, R0 * 0.1, sx, sy, R0); sd.addColorStop(0, '#ff7a3a'); sd.addColorStop(0.8, '#e2261a'); sd.addColorStop(1, '#c41810');
  g.fillStyle = sd; g.beginPath(); g.arc(sx, sy, R0, 0, 7); g.fill(); g.restore();                   // the red sun (cream type must read over it)
  const gr = g.createLinearGradient(0, hor, 0, H); gr.addColorStop(0, '#5a1408'); gr.addColorStop(0.15, '#2a0806'); gr.addColorStop(1, '#0a0303'); g.fillStyle = gr; g.fillRect(0, hor, W, H - hor);
}
// v12b: the hero fist printed as a silhouette against the sun (the 3D render read as a tan clay arm, lit from the
// front): ink body, a hot rim only on the edges that face the disc, a second cooler rim a step further in
const fsA = document.createElement('canvas'), fsB = document.createElement('canvas');
function fistSil(src) {
  for (const c of [fsA, fsB]) { c.width = src.width; c.height = src.height; }
  const a = fsA.getContext('2d'), b = fsB.getContext('2d');
  a.drawImage(src, 0, 0); a.globalCompositeOperation = 'source-in'; a.fillStyle = '#140806'; a.fillRect(0, 0, W, H);
  a.globalCompositeOperation = 'source-atop'; a.globalAlpha = 0.3; a.filter = 'brightness(0.5) sepia(0.6)'; a.drawImage(src, 0, 0);   // a trace of the knuckles' form
  a.filter = 'none'; a.globalAlpha = 1; a.globalCompositeOperation = 'source-over';
  const [sx, sy] = PAY.sun, dx = sx - 860, dy = sy - 760, dl = Math.hypot(dx, dy), ux = dx / dl, uy = dy / dl;
  for (const [w, col, al] of [[14, '#ff9a4a', 0.55], [5, '#ffd9a0', 1]]) {
    b.clearRect(0, 0, W, H); b.globalCompositeOperation = 'source-over'; b.drawImage(src, 0, 0);
    b.globalCompositeOperation = 'source-in'; b.fillStyle = col; b.fillRect(0, 0, W, H);
    b.globalCompositeOperation = 'destination-out'; b.drawImage(src, -ux * w, -uy * w);
    a.save(); a.globalAlpha = al; a.globalCompositeOperation = 'source-atop'; a.filter = w > 6 ? 'blur(4px)' : 'blur(0.6px)'; a.drawImage(fsB, 0, 0); a.restore(); }
  return fsA;
}
const payCv = document.createElement('canvas'); payCv.width = W; payCv.height = H; const pg = payCv.getContext('2d');
async function payoff(t, beat) {
  const R = await ranks();
  if (!FIST) { const st = new Stage({ W, H }); await st.init();
    const cast = [{ variant: 'forge', height: 1.84, kind: 'work', shirt: '#28323e', trousers: '#2c3e5e', hat: 'none', beard: 0, stubble: 0.7, seed: 95, x: 0, z: 0, turn: Math.PI - 0.25, arm: 'R' }];
    const F0 = await KITS.backs(st, { sun2d: PAY.sun, cam: 'fist', cast });            // frames the raised fist (the kit aims at the hand as posed)
    const c = st.camera, tg = c.position.clone().add(c.getWorldDirection(V(0, 0, 0)));
    for (const h of F0.heroes) st.scene.remove(h.group);
    FIST = await KITS.backs(st, { sun2d: PAY.sun, cam: [c.position.x, c.position.y, c.position.z, tg.x, tg.y, tg.z, c.fov], strike: { onset: tB(50) }, cast }); }
  const cr = await crowd('pay', R => R.design({ seed: 7, ranks: [
    { foot: 2400, h: 1500, draw: tt => fistSil(FIST.draw(tt)) },
    { foot: 1560, h: 70, raise: 0.4, flags: 3, pack: 1.3 },
    { foot: 1440, h: 44, raise: 0.35, flags: 3, pack: 1.5 },
    { foot: 1370, h: 28, raise: 0.25, flags: 2, pack: 1.7 },
    { foot: 1340, h: 18, raise: 0.15, pack: 1.9 } ] }));
  const hit = beat >= 54 ? tB(54) : tB(50);                               // the fist wave on the payoff, again on b54
  R.hit(cr, hit, { from: [760, 1500], speed: 160, jitter: 4, lead: -2 });
  pg.clearRect(0, 0, W, H);
  R.compose(pg, cr, t, { back: g => paySky(g, t), sun: PAY.sun, style: 'dusk', ground: { y0: PAY.hor } });
  const u = clamp((beat - 50) / 7.5), z = 1 + 0.06 * ease.inOutCubic(u);           // the slow push over the hold
  ctx.save(); ctx.translate(W / 2, H * 0.55); ctx.scale(z, z); ctx.translate(-W / 2, -H * 0.55); ctx.drawImage(payCv, 0, 0); ctx.restore();
}
async function chant(t, beat) {
  const R = await ranks();
  const cr = await crowd('chant', R => R.design({ seed: 4, ranks: [
    { foot: 1920, h: 330, raise: 0.5, tools: 0.1, pack: 1.6, flags: 1, gaps: 0.04 },
    { foot: 1480, h: 150, raise: 0.5, flags: 2, pack: 1.5 },
    { foot: 1290, h: 74, raise: 0.4, flags: 2, pack: 1.4 },
    { foot: 1205, h: 34, raise: 0.3, flags: 3, pack: 1.6 } ] }));
  const hits = [42, 42.5, 43, 44, 44.5, 45].filter(h => beat >= h - 0.02);          // COM-MON-WEALTH, twice
  const h = hits.length ? hits[hits.length - 1] : 42;
  R.hit(cr, tB(h), { from: [540, 1920], speed: 320, jitter: 3, lead: -1 });
  R.compose(ctx, cr, t, { back: g => chantSky(g, t), sun: [540, 1150], style: STY.red, ground: { y0: 1180 } });
}
async function farmers(t, beat) {
  const R = await ranks(), first = beat < 10;
  const cr = first ? await crowd('farm1', R => R.design({ seed: 12, ranks: [
      { foot: 1990, h: 700, pack: 1.1, x0: 560, x1: 1180, kinds: ['cap', 'flatcap', 'fedora'], gaps: 0 },
      { foot: 1600, h: 250, pack: 1.2, x0: -80, x1: 620, kinds: ['cap', 'flatcap', 'fedora', 'hood', 'scarf'], tools: 0.2 } ] }))
    : await crowd('farm2', R => R.design({ seed: 13, ranks: [
      { foot: 1990, h: 420, pack: 1.25, walk: true, kinds: ['cap', 'flatcap', 'fedora', 'hood', 'scarf'], tools: 0.15, gaps: 0.08 } ] }));
  for (const Rk of cr.ranks) for (const f of Rk.figs) f.stride = 1.1;
  R.compose(ctx, cr, t, { sun: [520, 760], style: STY.storm, ground: false, shadowAmt: 0, gap: false });
}
async function procession(t, beat) {
  const R = await ranks();
  const cr = await crowd('proc', R => { const c = R.design({ seed: 5, ranks: [
      { foot: 1990, h: 560, raise: 0.25, pack: 1.5, walk: true, x0: -120, x1: 760, gaps: 0.03, kinds: ['cap', 'hard', 'flatcap', 'knit', 'bare'] },
      { foot: 1760, h: 400, draw: tt => drawBanner(tt, B.beat(tt), 1) },
      { foot: 1500, h: 250, raise: 0.3, flags: 2, pack: 1.5, walk: true, x0: 120, x1: 1200 },
      { foot: 1340, h: 130, raise: 0.3, flags: 2, pack: 1.5, walk: true, x0: -80, x1: 900 },
      { foot: 1250, h: 62, raise: 0.2, flags: 3, pack: 1.7, walk: true } ] });
    for (const Rk of c.ranks) for (const f of Rk.figs) f.stride = 1.1;
    c.surge = (f, tt) => { const e = Math.max(0, tt - tB(24)), k = 1 + 0.05 * Math.min(1, e / 1.5); return { k, dx: (f.x - 540) * (k - 1), dy: (f.y - 1200) * (k - 1) - f.h * 0.06 * e }; };
    return c; });
  R.compose(ctx, cr, t, { sun: [560, 1080], style: STY.storm, ground: false, shadowAmt: 0.6, gap: false, flagWind: 1.3 });
}
// v12b b22-24: four ranks advancing in echelon, each stepped right and back of the one in front, lantern gaps between
// the files, backlit by the lightning in the shelf; the banner still furled on its poles in the second rank
async function echelon(t, beat) {
  const R = await ranks();
  const cr = await crowd('echelon', R => { const c = R.design({ seed: 12, ranks: [
      { foot: 1960, h: 470, raise: 0.12, pack: 1.45, walk: true, x0: -220, x1: 560, gaps: 0.05, kinds: ['cap', 'hard', 'flatcap', 'knit', 'bare'] },
      { foot: 1640, h: 300, raise: 0.2, flags: 2, pack: 1.5, walk: true, x0: 60, x1: 860, gaps: 0.04 },
      { foot: 1430, h: 180, raise: 0.2, flags: 2, pack: 1.55, walk: true, x0: 330, x1: 1160 },
      { foot: 1300, h: 100, raise: 0.15, flags: 3, pack: 1.6, walk: true, x0: 560, x1: 1320 },
      { foot: 1235, h: 52, raise: 0.1, flags: 3, pack: 1.8, walk: true, x0: 700, x1: 1400 } ] });
    for (const Rk of c.ranks) for (const f of Rk.figs) f.stride = 1.1;
    // the advance: every rank walks toward the lens on its diagonal, the near rank fastest (parallax)
    c.surge = (f, tt) => { const e = Math.max(0, tt - tB(22)), k = 1 + 0.07 * Math.min(1, e / 0.75) * (f.h / 470); return { k, dx: -(f.h / 470) * 26 * e, dy: (f.y - 1150) * (k - 1) }; };
    return c; });
  ctx.save(); ctx.globalCompositeOperation = 'multiply'; const sk = ctx.createLinearGradient(0, 0, 0, 1100);   // the shelf's dark roof (not a pale sky)
  sk.addColorStop(0, '#3a3444'); sk.addColorStop(0.55, '#8a8494'); sk.addColorStop(1, '#ffffff'); ctx.fillStyle = sk; ctx.fillRect(0, 0, W, 1100); ctx.restore();
  const fl = Math.max(0, Math.exp(-((beat - 22) % 2) * 6) * (beat < 23.9 ? 1 : 0));        // the kick's lightning in the shelf
  R.compose(ctx, cr, t, { sun: [880, 820], style: STY.storm, ground: false, shadowAmt: 0.5, gap: false, flagWind: 1.2 });
  if (fl > 0.02) { ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = `rgba(200,210,255,${0.12 * fl})`; ctx.fillRect(0, 0, W, 1250); ctx.restore(); }
}
async function heave(t, beat) {
  const R = await ranks();
  const cr = await crowd('heave', R => { const c = R.design({ seed: 9, ranks: [
      { foot: 2010, h: 820, pack: 1.35, x0: -160, x1: 1180, gaps: 0, kinds: ['hard', 'cap', 'flatcap', 'knit'] } ] });
    for (const f of c.ranks[0].figs) { f.seed = 0.05; f.act = 'stand'; f.flip = false; } return c; });
  // the rope: from the crew's hands up to the bent's apex, taut on the heave
  const ap = PLANT.bents[0].localToWorld(V(0, rafterY(0) + 0.1, 0)).project(camera), ax = (ap.x * 0.5 + 0.5) * W, ay = (0.5 - ap.y * 0.5) * H;
  const tx = ap.z < 1 ? clamp(ax, 200, 1300) : 1000, ty = ap.z < 1 ? clamp(ay, -200, 900) : 300, pull = Math.sin(clamp((beat - 28) / 2) * Math.PI * 2) * 12;
  ctx.save(); ctx.strokeStyle = '#1a120c'; ctx.lineCap = 'round'; ctx.lineWidth = 14; ctx.beginPath(); ctx.moveTo(-60, 1500 + pull); ctx.quadraticCurveTo(560, 1330, tx, ty); ctx.stroke();
  ctx.strokeStyle = 'rgba(230,236,255,0.35)'; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
  R.compose(ctx, cr, t, { sun: [tx, ty], style: STY.storm, ground: false, shadowAmt: 0, gap: false });
}
async function farRanks(t, beat) {
  const R = await ranks(), hor = clamp(SUN.hor, 900, 1500);
  const cr = await crowd('far', R => R.design({ seed: 21, ranks: [
    { foot: 1000, h: 60, raise: 0.25, flags: 4, pack: 1.3 }, { foot: 990, h: 38, raise: 0.2, flags: 3, pack: 1.5 }, { foot: 982, h: 24, raise: 0.12, flags: 2, pack: 1.8 } ] }));
  const dy = hor - 980;
  ctx.save(); ctx.translate(0, dy); R.compose(ctx, cr, t, { sun: [SUN.x, SUN.y - dy], style: 'dusk', ground: false, shadowAmt: 0, gap: false }); ctx.restore();
}

window.renderFrame = async (t) => {
  const beat = B.beat(t), frame = Math.round(t * 30);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  let st = null, flashK = 0;
  if (beat < 4) {                                                        // the storm open: the relit plate
    const Sm = await storm(); ctx.drawImage(Sm.render(t), 0, 0, W, H);
    flashK = frame < 8 ? [1, 0.42, 0.62, 0.8, 0.3, 0.36, 0.12, 0.05][frame] : 0;
    rain2d(t, 1, flashK);
  } else if (beat >= 42 && beat < 46) await chant(t, beat);
  else if (beat >= 46 && beat < 48) markLights(t, beat);
  else if (beat >= 50 && beat < CLOSE) await payoff(t, beat);
  else {
    const r = world(t, beat); st = r.st;
    RQ.present(ctx, renderer.domElement, renderer.getContext(), { w: W, h: H });
    if ((beat >= 4 && beat < 6) || (beat >= 32 && beat < 36) || (beat >= 38 && beat < 42)) {
      // the night plain held down to near black and cooled (the killed purple haze), then the red lamps on it
      ctx.save(); ctx.globalCompositeOperation = 'multiply'; const gg = ctx.createLinearGradient(0, 0, 0, H);
      gg.addColorStop(0, beat < 6 ? '#5a5a6a' : '#4a4252'); gg.addColorStop(0.35, beat < 6 ? '#6a6674' : '#5a4852'); gg.addColorStop(1, beat < 6 ? '#646070' : '#6a5a5e');   // v12b: near fields lifted
      ctx.fillStyle = gg; ctx.fillRect(0, 0, W, H); ctx.restore();
      drawBeacons(beat, t);
    }
    if (beat >= (PP.dot ? 10 : 8) && beat < 12) await farmers(t, beat);      // v15: b8-10 is Dot in the wheat, the farmers in 3D behind her
    else if (beat >= 22 && beat < 24) await echelon(t, beat);
    else if (beat >= 24 && beat < 28) await procession(t, beat);
    else if (beat >= 28 && beat < 30) await heave(t, beat);
    else if (beat >= 48 && beat < 50) {
      // the sky pushed onto the red / orange ladder (the pale peach dawn was the lingering the client hates)
      ctx.save(); ctx.globalCompositeOperation = 'multiply'; const hz = clamp(SUN.hor, 600, 1500), gg = ctx.createLinearGradient(0, 0, 0, hz);
      gg.addColorStop(0, '#6a1410'); gg.addColorStop(0.6, '#c4401c'); gg.addColorStop(1, '#ff8a4a'); ctx.fillStyle = gg; ctx.fillRect(0, 0, W, hz); ctx.restore();
      sunDisc(t, clamp((beat - 48) / 0.35), { r: 260 }); await farRanks(t, beat); }

    if (beat >= 60) {                                                    // the loop's return: the storm slides back in over the dawn
      const Sm = await storm(), ts = t - 64 * B.spb, u = smooth(60, 62.6, beat);
      const sc = Sm.render(ts, { build: smooth(60, 64, beat) });
      const y0 = -H * (1 - u);
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, Math.max(0, y0 + H)); ctx.clip(); ctx.drawImage(sc, 0, y0, W, H); ctx.restore();
      const eg = ctx.createLinearGradient(0, y0 + H - 120, 0, y0 + H + 40); eg.addColorStop(0, 'rgba(8,6,10,0)'); eg.addColorStop(0.75, 'rgba(8,6,10,0.85)'); eg.addColorStop(1, 'rgba(8,6,10,0)');
      if (u < 1) { ctx.fillStyle = eg; ctx.fillRect(0, y0 + H - 120, W, 160); }
      rain2d(t, smooth(60, 63, beat));
    }
  }
  const imp = B.env('impact', t, 5);
  // v12b: over the red sun (b48-57.5) the bloom and halation stay low: at 0.7 they blew the red disc out to pale peach
  // (cream WEALTH. on a cream disc: OCR read 'Wasi') and lifted the backlit fist to tan clay
  const sunK = beat >= 48 && beat < CLOSE ? 1 : 0;
  post.apply(ctx.canvas, t, { bloom: { amount: (0.7 + 0.6 * imp) * (1 - 0.75 * sunK), threshold: sunK ? 0.92 : 0.7, radius: 1.1 }, halation: { amount: 0.25 * (1 - 0.8 * sunK), tint: [1, 0.45, 0.15] },
    lens: { ca: 0.004 * imp + (st ? 0.004 * st.env : 0) + 0.004 * flashK } }, { ctx });
  impactFrame(beat);                                                     // before the type: the impact frame never cuts the letters
  if (beat < CLOSE) drawType(beat, t);
  if (beat >= CLOSE) lockup(t - CLOSE * B.spb);
  finish.apply(ctx, frame, { grain: 0.05, vignette: 0.45, flash: imp * 0.2 + (frame === 0 ? 0.1 : 0) });
};
window.sceneReady = true;
