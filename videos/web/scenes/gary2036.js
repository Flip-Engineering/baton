// GARY 2036 c2: CITY OF THE CENTURY. Gary was a city built from dunes in a few years, for one company. The Program says to
// build new cities across America, for everyone, joined by high-speed rail. One stake, one sledge, then the plan, then ten
// years of building, then the lights.
//
// One 3D world through light/ (LitRenderer + LightRig: one display transform for dawn, noon, dusk and night), the ERECT kit's
// tower cranes, HUMAN c6's workers moved by MOTION c1's labour acts. Everything it reads is in the repo (no out/ caches).
// The picture is time-lapse: each shot renders its 3D at its own rate and holds the frame in between; type and finish run on every frame.
import * as THREE from 'three';
import { W, H, loadFonts, outCanvas, Finish, closer, clamp, lerp, ease, sigil } from '../lib/kit.js';
import { LitRenderer } from '../lib/fx/light/pipeline.js';
import { LightRig } from '../lib/fx/light/rig.js';
import { PRESETS } from '../lib/fx/light/presets.js';
import { litPatchAll, litPatch } from '../lib/fx/light/patch.js';
import { People } from '../lib/fx/people.js';
import { loadAnsur, mulberry32 } from '../lib/fx/rig/body.js';
import { workerDesc } from '../lib/fx/workforce.js';
import { Cast } from '../lib/fx/motion/cast.js';
import { Hammer } from '../lib/fx/motion/labour.js';
import { Poser } from '../lib/fx/motion/poser.js';
import { Plume } from '../lib/fx/modeling/erect/yard.js';
import { Plant } from '../lib/fx/americana_city.js';
import { buildLand, buildScrub, SITE, sstep, rng as srng } from './gary2036.land.js';
import { City, planCity, cityTexture, buildLine, buildTrain, makeCrane, makeSite } from './gary2036.city.js';
import { shotAt, SHOTS } from './gary2036.shots.js';
import { drawType } from './gary2036.type.js';
THREE.ColorManagement.enabled = true;

const Q = new URLSearchParams(location.search);
// software GL (SwiftShader, llvmpipe) renders at 720x1280; a real GPU renders at 1080x1920. Both K=1 (the time-lapse needs no motion blur).
const SOFT = (() => { try { const g = document.createElement('canvas').getContext('webgl2'), e = g.getExtension('WEBGL_debug_renderer_info'); return !e || /swiftshader|llvmpipe|software/i.test(g.getParameter(e.UNMASKED_RENDERER_WEBGL)); } catch (_) { return true; } })();
const QUAL = Q.get('q') || (SOFT ? 'draft' : 'clip'), SCALE = +(Q.get('scale') || (SOFT ? 0.667 : 1));
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const ctx = outCanvas();
await loadFonts();
await (async () => { const f = new FontFace('Big Shoulders Display', 'url(../node_modules/@fontsource/big-shoulders-display/files/big-shoulders-display-latin-900-normal.woff2)', { weight: '900' }); document.fonts.add(await f.load()); })();
const finish = new Finish(1036);
const [CX, CZ] = SITE.newCity;
const T0 = performance.now(); const lap = n => console.log('[boot]', n, Math.round(performance.now() - T0), 'ms');

const glc = document.createElement('canvas'); glc.width = Math.round(W * SCALE); glc.height = Math.round(H * SCALE);
const lr = new LitRenderer({ canvas: glc, width: W, height: H, quality: QUAL, scale: SCALE });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, W / H, 0.2, 40000);
const mirrorOn = { v: false };

// ------------------------------------------------------------------ light rigs: one per time of day, swapped per shot
const RIGS = {};
const sunBox = (c, ext, size = 4096) => ({ center: c, extent: ext, shadowSize: size, softness: 3 });
const RECS = {
  dawn: () => PRESETS.dawnContre({ sky: { elevation: 4.5, azimuth: 38, turbidity: 5 }, sun: sunBox([0, 1, 0], 22, 2048), camera: { ev100: 10.9 }, atmosphere: { density: 0.00028, height: 60, maxDist: 5200, steps: 34 } }),
  smoke: () => PRESETS.noonClear({ sky: { elevation: 44, azimuth: 140, turbidity: 7 }, sun: sunBox([0, 0, -650], 1350), camera: { ev100: 13.4 }, atmosphere: { density: 0.0007, height: 160, maxDist: 6500, steps: 34 }, lens: { bloom: 0.03, halation: 0.12, vignette: 0.28, grain: 0.02 } }),
  gold: () => PRESETS.goldenHour({ sky: { elevation: 11, azimuth: 262, turbidity: 3.2 }, sun: sunBox([CX, 0, CZ], 1100), camera: { ev100: 11.9 }, atmosphere: { density: 0.00028, height: 300, maxDist: 12000, steps: 36, g: 0.72 } }),
  day: () => PRESETS.noonClear({ sky: { elevation: 38, azimuth: 205, turbidity: 3 }, sun: sunBox([CX, 0, CZ], 1100), camera: { ev100: 14.3 }, atmosphere: { density: 0.00027, height: 320, maxDist: 12000, steps: 36 } }),
  blue: () => PRESETS.blueHour({ sky: { elevation: -5.5, azimuth: 262, turbidity: 3 }, sun: sunBox([CX, 0, CZ], 900), camera: { ev100: 6.6, wb: 3900 }, atmosphere: { density: 0.00034, height: 220, maxDist: 12000, steps: 36 }, lens: { bloom: 0.07, halation: 0.35, vignette: 0.32, grain: 0.03 } }),
};
RECS.dawn2 = () => PRESETS.dawnContre({ sky: { elevation: 4.5, azimuth: 38, turbidity: 5 }, sun: sunBox([CX, 1, CZ], 22, 2048), camera: { ev100: 10.9 }, atmosphere: { density: 0.00028, height: 60, maxDist: 5200, steps: 34 } });
RECS.plaza = () => PRESETS.blueHour({ sky: { elevation: -5.5, azimuth: 262, turbidity: 3 }, sun: sunBox([CX, 0, CZ], 120, 2048), camera: { ev100: 6.4, wb: 3900 }, atmosphere: { density: 0.00036, height: 220, maxDist: 12000, steps: 36 }, lens: { bloom: 0.07, halation: 0.35, vignette: 0.32, grain: 0.03 },
  practicals: [[-11, 8, -9], [12, 8, -8], [-10, 8, 11], [11, 8, 12]].map(([x, y, z], i) => ({ kind: 'hpsCutoff', name: 'pl' + i, pos: [CX + x, y + 0.5, CZ + z], aim: [CX + x * 0.25, 0, CZ + z * 0.25], shadowSize: 1024, near: 0.3, far: 60, volGain: 0.7, contact: i === 0 })) });
let activeRig = null;
const rigObjs = r => [r.sun, r.sun.target, r.disc, ...r.practicals.map(p => p.group)].filter(Boolean);
function useRig(name) {
  if (activeRig && activeRig.name === name) return activeRig.rig;
  if (activeRig) for (const o of rigObjs(activeRig.rig)) scene.remove(o);
  if (!RIGS[name]) { const tmp = new THREE.Scene(); RIGS[name] = new LightRig(lr.renderer, tmp, RECS[name]()); }
  const r = RIGS[name]; for (const o of rigObjs(r)) scene.add(o);
  scene.background = r.skyTex; scene.environment = r.env; scene.backgroundIntensity = 1; scene.environmentIntensity = 1; activeRig = { name, rig: r }; return r;
}

// ------------------------------------------------------------------ the world
const cTex = cityTexture({ span: 2800, nB: 8, pitch: 150, plaza: [0, 0, 78], rail: 100 });
lap('land');
const land = buildLand(scene, { cityTex: cTex });
const scrub = buildScrub(scene);
lap('scrub');
const ANSUR = await loadAnsur();
const folk = new People(scene, { max: 160, viewH: Math.round(H * SCALE), budget: [40, 90] });
const C = new Cast(folk);
const mat = (c, r = 0.85, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });

// ---- Gary 1906-1930: brick town on a grid with Broadway running north to the mill gate
lap('people');
const oldPlan = planCity({ seed: 19, pitch: 100, nB: 9, style: 'old' });
const mill = [];
{ const R = srng(77);                                                          // the works: sheds along the lake side, then furnaces and stacks
  for (let k = 0; k < 46; k++) { const x = -640 + k * 28 + (R() - 0.5) * 6, z = -1060 - R() * 360; mill.push({ x, z, w: 24 + R() * 20, d: 40 + R() * 70, h: 12 + R() * 22, ts: 0.6 + R() * 2.1, dur: 0.5 + R(), type: 2, tint: [0.16, 0.15, 0.15] }); } }
const oldAll = oldPlan;   // v5: the works are americana_city's Plant (below), not shed boxes
const gary = new City(scene, oldAll, { cx: 0, cz: 0, roofs: true });
const stackM = mat('#2a2826', 0.7, 0.2), furnM = mat('#4a3c34', 0.8, 0.3);
const stacks = new THREE.InstancedMesh(new THREE.CylinderGeometry(3.2, 4.6, 1, 14).translate(0, 0.5, 0), stackM, 4), furn = new THREE.InstancedMesh(new THREE.CylinderGeometry(7, 8.2, 1, 16).translate(0, 0.5, 0), furnM, 12);
stacks.castShadow = furn.castShadow = true; stacks.frustumCulled = furn.frustumCulled = false; scene.add(stacks, furn);
const stackPos = [[-170, -1130], [-60, -1130], [60, -1130], [170, -1130]], furnPos = []; for (let i = 0; i < 12; i++) furnPos.push([-300 + i * 55, -1190]);
// v5: Gary Works as an integrated plant at real heights (WORLDS studio's americana_city Plant: blast furnaces and stoves, coke
// battery, ore bridges on the lake, stacks 110-150 m), rising with the clock 1906-1910. Its point lights go to a stub light field
// (the shots that show it are daylight); the light/ pipeline patches its materials with everything else.
const lfStub = { add: L => L, U: { tLight: { value: (() => { const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); t.needsUpdate = true; return t; })() }, uLightBox: { value: new THREE.Vector4(-1, -1, 1, 1) }, uLightGain: { value: 0 } } };
const plantG = new THREE.Group(); scene.add(plantG);
const plant = new Plant({ scene: plantG }, lfStub, { origin: [-100, 0, -1380], seed: 1906 });
plantG.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
function millUpdate(yOld) {
  plantG.scale.set(1, Math.max(0.001, ease.outCubic(clamp((yOld - 0.6) / 2.6))), 1);
  const M = new THREE.Matrix4();
  stackPos.forEach(([x, z], i) => { const p = clamp((yOld - 1.2 - i * 0.2) / 1.4); M.compose(V3(x, 0, z), new THREE.Quaternion(), V3(1, Math.max(0.01, 74 * p), 1)); stacks.setMatrixAt(i, M); });
  furnPos.forEach(([x, z], i) => { const p = clamp((yOld - 1.6 - i * 0.08) / 1.1); M.compose(V3(x, 0, z), new THREE.Quaternion(), V3(1, Math.max(0.01, 38 * p), 1)); furn.setMatrixAt(i, M); });
  stacks.instanceMatrix.needsUpdate = furn.instanceMatrix.needsUpdate = true;
}
lap('gary');
const smokeP = plant.stacks.map(({ x, z, h }, i) => new Plume(scene, V3(x, h, z), { n: 34, h: 300, w: 46, wind: [6, 0, 1.6], rate: 1.0, col: '#55504c', shade: '#26221f', op: 0.7, seed: 5 + i }));

// ---- the new city: 2027..2036 from a stake at the middle of the benchmark plaza
lap('yard+smoke');
const newPlan = planCity({ seed: 36, pitch: 150, nB: 8, style: 'new', plaza: [0, 0, 78], rail: 100, fusion: [980, -420] });
const city = new City(scene, newPlan, { cx: CX, cz: CZ });
const line = buildLine(scene, { cx: CX, cz: CZ, rail: 100, half: 6800 });
const train = buildTrain(scene, {});

lap('city+line+train');
// fusion works: a hall, a glowing torus ring, three cooling towers with steam
const fusion = new THREE.Group(); fusion.position.set(CX + 980, 0, CZ - 420); scene.add(fusion);
const fusionRing = (() => { const ringM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.9, 3.0), toneMapped: false });
  const hall = new THREE.Mesh(new THREE.CylinderGeometry(78, 84, 46, 40), mat('#9a9c9e', 0.65, 0.2)); hall.position.y = 23; hall.castShadow = hall.receiveShadow = true; fusion.add(hall);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(78, 40, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.42, 1), mat('#b9bbbd', 0.5, 0.3)); dome.position.y = 46; dome.castShadow = true; fusion.add(dome);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(70, 1.4, 8, 96).rotateX(Math.PI / 2), ringM); ring.position.y = 30; fusion.add(ring);
  const prof = []; for (let i = 0; i <= 24; i++) { const u = i / 24; prof.push(new THREE.Vector2(26 + 14 * Math.pow(1 - u, 1.7) + 9 * Math.pow(Math.abs(u - 0.55), 2.2) * 3, u * 120)); }
  for (const [x, z] of [[-190, -40], [-190, 60], [-250, 10]]) { const tw = new THREE.Mesh(new THREE.LatheGeometry(prof, 36), mat('#b7b3ac', 0.9)); tw.position.set(x, 0, z); tw.castShadow = tw.receiveShadow = true; fusion.add(tw); }
  return ring; })();
const steamF = [[-190, -40], [-190, 60], [-250, 10]].map(([x, z], i) => new Plume(scene, V3(CX + 980 + x, 121, CZ - 420 + z), { n: 28, h: 200, w: 40, wind: [3, 0, 0.8], rate: 0.7, col: '#f2f1ee', shade: '#a4a8ad', op: 0.5, seed: 40 + i }));

lap('fusion');
// street lamps along the avenue and the streets of the middle of the city
const lampG = new THREE.Group(); scene.add(lampG);
const lampHeadM = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.8, 0.5), toneMapped: false });
{ const P = []; const line1 = (ax, az, bx, bz, step) => { const L = Math.hypot(bx - ax, bz - az), n = Math.floor(L / step); for (let i = 0; i <= n; i++) { const u = i / n; P.push([lerp(ax, bx, u), lerp(az, bz, u)]); } };
  for (let k = -5; k <= 5; k++) { for (const o of [-13, 13]) { line1(k * 150 + o, -760, k * 150 + o, 760, 38); line1(-760, k * 150 + o, 760, k * 150 + o, 38); } }
  const pm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 8, 0.22).translate(0, 4, 0), mat('#2b2d30', 0.6, 0.5), P.length), hm2 = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.3, 0.7).translate(0, 8.1, 0), lampHeadM, P.length), M = new THREE.Matrix4();
  P.forEach(([x, z], i) => { if (Math.abs(z - 100) < 62 || Math.hypot(x, z) < 70) { M.makeScale(0, 0, 0); } else M.makeTranslation(CX + x, 0, CZ + z); pm.setMatrixAt(i, M); hm2.setMatrixAt(i, M); });
  pm.frustumCulled = hm2.frustumCulled = false; lampG.add(pm, hm2); }
lampG.visible = false;
// the alignment for the plan, with a beacon at each city site along it
const planG = new THREE.Group(); scene.add(planG);
const beamM = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 2.4, 1.1), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
const lineGlowM = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 3.2, 1.4), toneMapped: false });
const beacons = [], PITCH_C = 3000;
for (let k = 0; k < 6; k++) { const bg = new THREE.Group(), x = CX + k * PITCH_C;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(14, 30, 1200, 20, 1, true).translate(0, 450, 0), beamM); bg.add(beam);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(120, 3.2, 6, 96).rotateX(Math.PI / 2).translate(0, 0.6, 0), lineGlowM); bg.add(ring);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(60, 2.4, 6, 64).rotateX(Math.PI / 2).translate(0, 0.6, 0), lineGlowM); bg.add(ring2);
  const stk = new THREE.Mesh(new THREE.BoxGeometry(0.4, 12, 0.4).translate(0, 6, 0), mat('#d8321e', 0.8)); bg.add(stk);
  bg.position.set(x, 0, CZ + 100); bg.userData = { beam, ring, ring2 }; planG.add(bg); beacons.push(bg); }
const lineGlow = new THREE.Mesh(new THREE.BoxGeometry(1, 1.2, 16).translate(0.5, 1.0, 0), lineGlowM); lineGlow.position.set(CX, 0, CZ + 100); planG.add(lineGlow);
const streak = new THREE.Mesh(new THREE.BoxGeometry(700, 4, 9).translate(-350, 4, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 12, 9), toneMapped: false })); streak.position.set(CX, 0, CZ + 100); planG.add(streak);
planG.visible = false;
// the next city's lights, far down the line
const nextG = new THREE.Group(); scene.add(nextG);
{ const R = srng(8), n = 1400, geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), m = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), mesh = new THREE.InstancedMesh(geo, m, n), Mx = new THREE.Matrix4(), c = new THREE.Color();
  for (let i = 0; i < n; i++) { const a = R() * 6.28, r = Math.sqrt(R()) * 900, h = 10 + R() * R() * 320, w = 14 + R() * 30; Mx.compose(V3(CX + 5400 + Math.cos(a) * r, 0, CZ + 100 + Math.sin(a) * r * 0.7), new THREE.Quaternion(), V3(w, h, w)); mesh.setMatrixAt(i, Mx);
    c.setRGB(6 + R() * 4, 4 + R() * 3, 2 + R() * 2); mesh.setColorAt(i, c); }
  mesh.frustumCulled = false; nextG.add(mesh); }
nextG.visible = false;

lap('lamps+plan+next');
// ---- a stake and the one who drives it (the 1906 worker at the origin; the 2027 crew's driver at the new city's benchmark)
function makeDriver(desc, [px, pz], { seed = 51, heading = Math.PI / 2 } = {}) {
  const id = folk.add(desc), mk = (base) => new Hammer({ seed, dims: C.dims(id), sc: C.sc(id), bodyKg: C.bodyKg(id), base, heading, period: 1.8 });
  const probe = mk(V3(0, 0, 0)), sw = Poser.l2w(probe.frame, probe.stake), base = V3(px - sw.x, 0, pz - sw.z);
  const D = { id, hammer: mk(base), t: null, group: new THREE.Group(), stake: new THREE.Group() };
  const sk = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.62, 0.05).translate(0, 0.31, 0), mat('#8a6a44', 0.9)); sk.castShadow = true; D.stake.add(sk);
  const rag = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.09).translate(0.1, -0.03, 0), new THREE.MeshStandardMaterial({ color: 0xd8321e, roughness: 0.9, side: THREE.DoubleSide })); rag.position.set(0.025, 0.58, 0); D.stake.add(rag);
  const stakeW = Poser.l2w(D.hammer.frame, D.hammer.stake); D.stake.position.set(stakeW.x, 0, stakeW.z); scene.add(D.stake);
  const hmG = new THREE.Group(); scene.add(hmG); D.group = hmG;
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.02, 1, 8).translate(0, 0.5, 0), mat('#b08a58', 0.7)); handle.castShadow = true; hmG.add(handle);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.24), mat('#3a3c40', 0.5, 0.7)); head.castShadow = true; hmG.add(head);
  D.step = (t) => {
    if (D.t == null || t < D.t - 1e-6) { D.t = -1 / 30; D.hammer = mk(base); }
    let o; while (D.t + 1 / 30 <= t + 1e-6) { D.t += 1 / 30; o = D.hammer.sample(D.t, 1 / 30); C.apply(id, o.frame, o.spec, D.t); }
    if (o) { const { E, H: Hd } = o.props.hammer, dir = Hd.clone().sub(E), L = dir.length(); dir.normalize(); hmG.position.copy(E); { const lat = V3(Math.cos(heading), 0, -Math.sin(heading)), xA = lat.clone().addScaledVector(dir, -lat.dot(dir)).normalize(), zA = V3().crossVectors(xA, dir).normalize();   // 3 Oct: a full basis, so the head's long axis lies in the swing plane and a face, not a cheek, meets the stake
      hmG.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xA, dir, zA)); } hmG.scale.set(1, L, 1); head.scale.set(1, 1 / L, 1); head.position.set(0, 1, 0); }
  };
  D.show = (v) => { D.stake.visible = D.group.visible = v; if (!v) folk.set(id, { y: -500 }); };
  return D;
}
const rngW = mulberry32(1906);
const dW = workerDesc(ANSUR, rngW, { trade: 'overalls', sex: 'm', age: [28, 40], wear: 0.7 }); dW.hat = 'cap'; dW.gloves = true;
const driver1 = makeDriver(dW, [0, 0]);
const rngN = mulberry32(2027);
const dN = workerDesc(ANSUR, rngN, { trade: 'steel', sex: 'f', age: [26, 38], wear: 0.35 });
const driver2 = makeDriver(dN, [CX + 0.0, CZ + 0.0], { seed: 52 });
const crew = [];                                                                           // the rest of the 2027 crew: working, walking, talking
{ const R = mulberry32(88);
  for (let i = 0; i < 26; i++) { const d = workerDesc(ANSUR, R, { trade: i % 5 === 0 ? 'weld' : 'steel', wear: 0.2 + 0.5 * R() }); const id = folk.add(d), a = R() * 6.28, r = 3 + R() * 22;
    const kind = i < 7 ? 'work' : i < 16 ? 'walk' : 'stand';
    crew.push({ id, kind, x: CX + Math.cos(a) * r, z: CZ + Math.sin(a) * r * 0.8 + 4, h0: R() * 6.28, ph0: R() * 6, sp: 1.1 + 0.5 * R(), ax: Math.cos(R() * 6.28), az: Math.sin(R() * 6.28), L: 8 + R() * 14 }); } }
function crewUpdate(T, on) {
  for (const c of crew) { if (!on || (ST.crewClear && c.z > CZ - 4 && Math.abs(c.x - CX) < 16)) { folk.set(c.id, { y: -500 }); continue; }
    if (c.kind === 'walk') { const u = ((T * c.sp / c.L + c.ph0) % 2), f = u < 1 ? u : 2 - u, dir = u < 1 ? 1 : -1; folk.set(c.id, { x: c.x + c.ax * c.L * (f - 0.5), y: 0, z: c.z + c.az * c.L * (f - 0.5), heading: Math.atan2(c.ax * dir, c.az * dir), act: 'walk', ph: T * 5.4 * c.sp / 1.35 + c.ph0, t: T }); }
    else if (c.kind === 'work') folk.set(c.id, { x: c.x, y: 0, z: c.z, heading: c.h0, act: 'work', ph: (T * 0.6 + c.ph0) % 1, t: T });
    else folk.set(c.id, { x: c.x, y: 0, z: c.z, heading: c.h0, act: 'stand', t: T + c.ph0 }); }
}

// ---- cranes for the buildings going up (the ERECT kit's tower crane), assigned to the tallest as they rise
const craneSizes = [200, 190, 170, 150, 150, 130, 130, 110, 110, 90, 90, 70];
const cranes = craneSizes.map((h, i) => { const c = makeCrane({ h, jib: Math.min(80, 40 + h * 0.25), back: 22, paint: i % 3 ? 0xd9a21b : 0xe8e4da }); c.g.visible = false; c.hh = h; scene.add(c.g); return c; });
// survey stakes with red flags: the plaza's ring, the avenue's edges, the streets laid out on the prairie before anything is built
const survey = new THREE.Group(); scene.add(survey); survey.visible = false;
{ const P = []; for (let i = 0; i < 90; i++) { const a = i / 90 * Math.PI * 2; P.push([Math.cos(a) * 78, Math.sin(a) * 78]); }
  for (let k = -20; k <= 20; k++) { if (Math.abs(k * 9) > 80) { P.push([26, k * 9], [-26, k * 9]); } }
  for (let k = -12; k <= 12; k++) { if (Math.abs(k * 12) > 90) { P.push([k * 12, 100 - 16], [k * 12, 100 + 16], [k * 12, -15], [k * 12, 15]); } }
  const n = P.length, sg = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 1.1, 0.06).translate(0, 0.55, 0), mat('#cdbb8f', 0.9), n), fg = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.42, 0.24).translate(0.21, 0.92, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.18, 0.08), side: THREE.DoubleSide, toneMapped: false }), n), M = new THREE.Matrix4();
  P.forEach(([x, z], i) => { M.makeTranslation(CX + x, 0, CZ + z); sg.setMatrixAt(i, M); const q = new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), (i * 2.3) % 6.28); M.compose(V3(CX + x, 0, CZ + z), q, V3(1, 1, 1)); fg.setMatrixAt(i, M); });
  sg.castShadow = true; sg.frustumCulled = fg.frustumCulled = false; survey.add(sg, fg); }
const site = makeSite(); site.position.set(CX, 0, CZ); scene.add(site);
function cranesUpdate(yNew, t) {
  const act = city.active(yNew, 14), used = new Set(); cranes.forEach(c => c.g.visible = false);
  for (const a of act) { const c = cranes.find((cc, i) => !used.has(i) && cc.hh >= a.h + 24 && cc.hh <= a.H + 60) || cranes.find((cc, i) => !used.has(i) && cc.hh >= a.h + 24); if (!c) continue; used.add(cranes.indexOf(c));
    const side = (a.i % 2 ? 1 : -1); c.g.position.set(a.x + side * (a.w / 2 + 7), 0, a.z + (a.i % 3 - 1) * 10); c.g.visible = true;
    const sw = t * 0.9 + a.i; c.setHook(V3(a.x + Math.cos(sw) * 14, Math.max(8, a.h - 4), a.z + Math.sin(sw) * 12), 1.2 + 0.7 * Math.sin(sw * 0.7 + a.i) + (side > 0 ? 0 : Math.PI)); }
}

lap('cranes');
// ---- the station on the viaduct: platforms, a glazed barrel vault on arched ribs, strip lights
const stationG = new THREE.Group(); stationG.position.set(CX, 9.5, CZ + 100); scene.add(stationG);
{ const platM = mat('#a9a69e', 0.85, 0.05), ribM = mat('#cfd2d4', 0.5, 0.5), glassM = new THREE.MeshStandardMaterial({ color: 0x9fb8c8, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.32, side: THREE.DoubleSide, emissive: new THREE.Color(0.9, 0.85, 0.7), emissiveIntensity: 0 });
  for (const sz of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(260, 0.9, 3.4).translate(0, 0.45, sz * 5.1), platM); p.receiveShadow = true; stationG.add(p); }
  const arch = (r) => { const pts = []; for (let i = 0; i <= 24; i++) { const a = Math.PI * i / 24; pts.push(new THREE.Vector3(0, Math.sin(a) * r * 0.78 + 0.4, -Math.cos(a) * r)); } return new THREE.CatmullRomCurve3(pts); };
  const curve = arch(8.6); const ribGeo = new THREE.TubeGeometry(curve, 24, 0.22, 6);
  const nR = 22, ribs = new THREE.InstancedMesh(ribGeo, ribM, nR), M4 = new THREE.Matrix4();
  for (let i = 0; i < nR; i++) { M4.makeTranslation(-126 + i * 12, 0, 0); ribs.setMatrixAt(i, M4); } ribs.castShadow = true; ribs.frustumCulled = false; stationG.add(ribs);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(8.6, 8.6, 264, 28, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 0.78, 1).translate(0, 0.4, 0), glassM); stationG.add(roof);
  const strip = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.4, 4.2), toneMapped: false });
  for (const sz of [-1, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(250, 0.18, 0.3).translate(0, 6.4, sz * 4.2), strip); stationG.add(st); }
  stationG.userData.glass = glassM; }
stationG.visible = false;
// ---- the plaza: the bronze benchmark, the mark that rises from it, a column of light
const plazaG = new THREE.Group(); plazaG.position.set(CX, 0, CZ); scene.add(plazaG);
const markTex = (() => { const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 512; const g2 = cv.getContext('2d'); sigil(g2, 512, 256, 190, { color: '#fff3d8', accent: '#ff4a2e', alpha: 1 }); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; })();
const markM = new THREE.MeshBasicMaterial({ map: markTex, transparent: true, toneMapped: false, color: new THREE.Color(5, 5, 5), side: THREE.DoubleSide, depthWrite: false });
const markMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), markM); markMesh.visible = false; plazaG.add(markMesh);
const discM = new THREE.MeshStandardMaterial({ color: 0xb0813a, roughness: 0.32, metalness: 0.95 });
const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.06, 40).translate(0, 0.03, 0), discM); disc.receiveShadow = true; disc.castShadow = true; plazaG.add(disc);
for (const r of [0.34, 0.22]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.35, 0.01, 6, 48).rotateX(Math.PI / 2).translate(0, 0.062, 0), mat('#3a2a14', 0.5, 0.8)); plazaG.add(ring); }
const pillarM = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.25, 0.8), transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.4, 40, 20, 1, true).translate(0, 20, 0), pillarM); plazaG.add(pillar);
plazaG.visible = false;
// poles for the plaza's lamps (the practicals themselves are in the 'plaza' rig)
{ const pm = mat('#26282b', 0.6, 0.5); for (const [x, z] of [[-11, -9], [12, -8], [-10, 11], [11, 12]]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 8.2, 8).translate(x, 4.1, z), pm); p.castShadow = true; plazaG.add(p); const hd = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.25, 0.6).translate(x, 8.3, z), lampHeadM); plazaG.add(hd); } }
// the people who live there: a plaza of strollers, talkers and two at the disc
const citizens = [];
{ const R = mulberry32(2036);
  for (let i = 0; i < 34; i++) { const d = workerDesc(ANSUR, R, { trade: ['shirt', 'coverall', 'farm', 'overalls', 'rail', 'shirt'][i % 6], women: 0.45, wear: 0.15 + 0.3 * R() }); d.hat = false; d.gloves = false; const id = folk.add(d);
    const a = R() * 6.28, r = i < 10 ? 3.2 + R() * 6 : 4 + R() * 34, kind = i < 20 ? 'walk' : 'stand';
    citizens.push({ id, kind, x: CX + Math.cos(a) * r, z: CZ + Math.sin(a) * r, h0: R() * 6.28, ph0: R() * 6, sp: 0.9 + 0.5 * R(), ax: Math.cos(R() * 6.28), az: Math.sin(R() * 6.28), L: i < 10 ? 8 + R() * 8 : 14 + R() * 26, look: i % 5 === 0 }); } }
function citizensUpdate(T, on) {
  for (const c of citizens) { if (!on) { folk.set(c.id, { y: -500 }); continue; }
    if (c.kind === 'walk') { const u = ((T * c.sp / c.L + c.ph0) % 2), f = u < 1 ? u : 2 - u, dir = u < 1 ? 1 : -1; folk.set(c.id, { x: c.x + c.ax * c.L * (f - 0.5), y: 0, z: c.z + c.az * c.L * (f - 0.5), heading: Math.atan2(c.ax * dir, c.az * dir), act: 'walk', ph: T * 5.4 * c.sp / 1.35 + c.ph0, t: T }); }
    else folk.set(c.id, { x: c.x, y: 0, z: c.z, heading: c.look ? Math.atan2(CX - c.x, CZ - c.z) : c.h0, act: 'stand', t: T + c.ph0 }); }
}
// platform people (on the viaduct deck)
const platformFolk = [];
{ const R = mulberry32(77); for (let i = 0; i < 10; i++) { const d = workerDesc(ANSUR, R, { trade: ['shirt', 'coverall', 'shirt'][i % 3], women: 0.45 }); d.hat = false; const id = folk.add(d); platformFolk.push({ id, x: CX - 100 + R() * 70 + i * 3, z: CZ + 100 + (i % 2 ? 5.2 : -5.2) + (R() - 0.5), h0: R() * 6.28, ph0: R() * 5 }); } }
function platformUpdate(T, on) { for (const c of platformFolk) folk.set(c.id, on ? { x: c.x, y: 10.4, z: c.z, heading: c.h0, act: 'stand', t: T + c.ph0 } : { y: -500 }); }
const train2 = (xTip) => { train.position.set(CX + xTip + 22.7, 10.0, CZ + 100 + 2.6); train.rotation.y = -Math.PI / 2; };

litPatchAll(scene);
litPatch(land.mat, { planar: true }); lap('patched');
const CITY_U = city.mat.userData.U, GROUND_U = land.mat.userData.U;

// ------------------------------------------------------------------ the per-frame state set by a shot
const ST = { yOld: 0, yNew: 0, wet: 0, night: 0, lit: 0.4, glow: 1, show: {} };
function applyState() {
  gary.set(ST.yOld); millUpdate(ST.yOld);
  city.set(ST.yNew); GROUND_U.uYear.value = clamp(ST.yNew / 10); GROUND_U.uWet.value = ST.wet; GROUND_U.uLamp.value = ST.night;
  for (const U of [CITY_U, gary.mat.userData.U]) { U.uNight.value = ST.night; U.uLit.value = ST.lit; U.uGlow.value = ST.glow; }
  gary.group.visible = !!ST.show.gary; city.group.visible = !!ST.show.city; scrub.visible = !!ST.show.scrub; stacks.visible = furn.visible = false; plantG.visible = !!ST.show.gary;
  smokeP.forEach(p => p.P.g.visible = !!ST.show.gary && ST.yOld > 2.5);
  line.group.visible = !!ST.show.line; train.visible = !!ST.show.train; fusion.visible = !!ST.show.city; steamF.forEach(p => p.P.g.visible = !!ST.show.city && ST.yNew > 7);
  lampG.visible = !!ST.show.lamps; planG.visible = !!ST.show.plan; nextG.visible = !!ST.show.next; stationG.visible = !!ST.show.station; plazaG.visible = !!ST.show.plaza; if (!ST.show.plaza) citizensUpdate(0, false); if (!ST.show.station) platformUpdate(0, false); driver1.show(!!ST.show.stake); if (ST.show.stakeOnly) driver1.stake.visible = true; driver2.show(!!ST.show.site); site.visible = !!ST.show.site; survey.visible = !!ST.show.survey;
}

// ------------------------------------------------------------------ frame: the shot decides, the 3D renders at its rate (blended between renders for time-lapse), type runs every frame
const SC = { markMesh, pillarM, markM, disc, citizensUpdate, platformUpdate, train2, stationG, plazaG, markTex, driver1, driver2, crewUpdate, THREE, V3, scene, camera, ST, useRig, beacons, line, train, planG, lineGlow, streak, cranes, city, gary, fusionRing, CX, CZ, folk, C, land, mirrorOn, lampHeadM, GROUND_U, CITY_U, ANSUR, clamp, lerp, sstep, ease };
const frames = new Map();                                          // 'shot:k' -> canvas (the last few renders are kept; a sequential render needs one new render a step)
const CLOSE_T = 67.2;                                              // END_T.plaza (v4)
function render3D(S, k) {
  const key = S.id + ':' + k;
  if (frames.has(key)) return frames.get(key);
  const T = Q.get('fixed') ? +Q.get('fixed') - S.t0 : k / S.fps;
  for (const kk of Object.keys(ST.show)) ST.show[kk] = false; ST.crewClear = false;
  const rig = S.setup(SC, T, S); applyState();
  if (S.id === 'stake') driver1.step(T);
  if (ST.show.site) driver2.step(T);
  crewUpdate(T, !!ST.show.site);
  if (ST.show.cranes) cranesUpdate(ST.yNew, T); else cranes.forEach(c => c.g.visible = false);
  for (const p of [...smokeP, ...steamF]) if (p.P.g.visible) p.update(T, camera, rig.sunDir);
  folk.update(camera);
  lr.render({ scene, camera, rig, t: T, K: Q.get('K') ? +Q.get('K') : undefined, lens: { focal: 28 }, ao: { radius: 2.0, intensity: 1.4 }, contactLen: 0.05,
    mirror: mirrorOn.v ? { y: 0.02, res: 0.5, tolerance: 0.2, streak: 1.4 } : undefined, update: () => { folk.update(camera); }, debug: Q.get('debug'), debugGain: +(Q.get('gain') || 1) });
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; cv.getContext('2d').drawImage(glc, 0, 0, W, H);
  frames.set(key, cv); while (frames.size > 5) frames.delete(frames.keys().next().value);
  mirrorOn.v = false; return cv;
}
// the people audit without drawing: set up the shot at t, pose everyone, ask people.js for the crotch-hand hazards and the raised-arm gestures
window.auditAt = (t) => {
  const S = shotAt(Math.min(t, CLOSE_T - 1e-3)), T = (Math.floor((t - S.t0) * S.fps + 1e-6)) / S.fps;
  for (const kk of Object.keys(ST.show)) ST.show[kk] = false; ST.crewClear = false;
  S.setup(SC, T, S); applyState();
  if (S.id === 'stake') driver1.step(T);
  if (ST.show.site) driver2.step(T);
  crewUpdate(T, !!ST.show.site);
  folk.update(camera);
  return { hz: folk.hazards(camera, W, H), g: folk.gestures(camera, W, H).filter(m => m.flags && m.flags.length).map(m => ({ id: m.id, name: m.name, flags: m.flags, px: m.px })) };
};
const closerCv = document.createElement('canvas'); closerCv.width = W; closerCv.height = H; const closerG = closerCv.getContext('2d');
const XF = 0.35;                                                   // cross-dissolve at a cut: the last frame of the shot before fades into the first of this one
function draw3D(S, ts) {
  const x = (ts - S.t0) * S.fps + 1e-6, k = Math.floor(x), f = x - k;
  if (S.blend && f > 0.02 && ts + 1 / S.fps < S.t1 + 1e-6) { ctx.drawImage(render3D(S, k), 0, 0); ctx.globalAlpha = f; ctx.drawImage(render3D(S, k + 1), 0, 0); ctx.globalAlpha = 1; }
  else ctx.drawImage(render3D(S, k), 0, 0);
}
window.renderFrame = async (t) => {
  const ts = Math.min(t, CLOSE_T - 1e-3), S = shotAt(ts), i = SHOTS.indexOf(S);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  if (i > 0 && ts - S.t0 < XF && !Q.get('nofade')) {
    const P = SHOTS[i - 1], kP = Math.floor((P.t1 - P.t0) * P.fps - 1e-6), a = (ts - S.t0) / XF;
    ctx.drawImage(render3D(P, kP), 0, 0); ctx.globalAlpha = a * a * (3 - 2 * a); draw3D(S, ts); ctx.globalAlpha = 1;
  } else draw3D(S, ts);
  if (t >= CLOSE_T) {                                              // the lockup over the last frame, darkened
    const age = t - CLOSE_T; ctx.fillStyle = `rgba(4,3,6,${clamp(0.9 + age * 3, 0, 0.97)})`; ctx.fillRect(0, 0, W, H);
    closerG.globalCompositeOperation = 'source-over'; closer(closerG, age); ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.drawImage(closerCv, 0, 0); ctx.restore();
    return {};
  }
  // v6: the house grade (ink tokens): a quarter desaturated toward the print, the paper stock in the lights, the house grain
  ctx.save(); ctx.globalCompositeOperation = 'saturation'; ctx.globalAlpha = 0.25; ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = 0.22; ctx.fillStyle = '#EFE6CF'; ctx.fillRect(0, 0, W, H); ctx.restore();
  drawType(ctx, t, { W, H });
  finish.apply(ctx, Math.round(t * 30), { grain: 0.045, vignette: 0.3 });
  return {};
};
lap('ready');
window.sceneReady = true;
