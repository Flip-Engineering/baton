// LAB / SIM2: simulation and procedural modelling (lib/fx/sim2/*) shown in the slate's own worlds and palettes.
//   ?shot=<name>  (see SHOTS below)   &sc=1 (render scale)   window.renderFrame(t) -> { ms, stats }
// Each shot is a composed frame, not a test pattern: the world, the light condition and the camera of the piece that
// would use it (VISUAL_BIBLE §3a), graded through lib/fx/post.js.
import * as THREE from 'three';
import { W, H, loadFonts, acpEmblem, C } from '../lib/kit.js';
import { Post } from '../lib/fx/post.js';
import { Sparks } from '../lib/fx/sim2/sparks.js';
import { Flag, printCanvas } from '../lib/fx/sim2/flag.js';
import { Head, HEADS } from '../lib/fx/sim2/sculpt.js';
import { machine, city, buildMeshes, MATS, Builder } from '../lib/fx/sim2/grammar.js';
import { CrowdFlow } from '../lib/fx/sim2/crowdflow.js';

const Q = new URLSearchParams(location.search);
const SHOT = Q.get('shot') || 'flag_storm', SC = +(Q.get('sc') || 1);
const RW = Math.round(W * SC), RH = Math.round(H * SC);
await loadFonts();
const ctx = document.getElementById('out').getContext('2d');
const post = new Post(W, H);
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(RW, RH, false);
renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1; renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const col = (h, k = 1) => new THREE.Color(h).multiplyScalar(k);

// ---------------------------------------------------------------- shared: a tileable noise texture (baked once, JS)
function noiseTex(n = 256, seed = 7) {
  const d = new Uint8Array(n * n * 4);
  const lat = (s, per) => { const g = new Float32Array(per * per); let x = seed * 2654435761 + s * 97 | 0; for (let i = 0; i < g.length; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; g[i] = ((x >>> 0) % 10000) / 10000; } return g; };
  for (let ch = 0; ch < 4; ch++) {
    const oct = [[4, 0.5], [8, 0.25], [16, 0.125], [32, 0.0625], [64, 0.04]].map(([p, a], k) => ({ p: p * (ch === 3 ? 2 : 1), a, g: lat(ch * 10 + k, p * (ch === 3 ? 2 : 1)) }));
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      let v = 0, s = 0;
      for (const o of oct) { const fx = x / n * o.p, fy = y / n * o.p, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, w = fy - j, P = o.p;
        const G = (a, b) => o.g[((b % P) + P) % P * P + ((a % P) + P) % P]; const su = u * u * (3 - 2 * u), sw = w * w * (3 - 2 * w);
        const val = (G(i, j) * (1 - su) + G(i + 1, j) * su) * (1 - sw) + (G(i, j + 1) * (1 - su) + G(i + 1, j + 1) * su) * sw;
        v += (ch === 1 ? Math.abs(val * 2 - 1) : val) * o.a; s += o.a; }
      d[(y * n + x) * 4 + ch] = Math.round(v / s * 255);
    }
  }
  const t = new THREE.DataTexture(d, n, n, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}
const NOISE = noiseTex();

// ---------------------------------------------------------------- shared: sky dome (gradient, sun, baked-noise cloud decks)
function sky(scene, o) {
  const u = { uTop: { value: col(o.top) }, uHor: { value: col(o.hor) }, uLow: { value: col(o.low || o.hor) }, uSun: { value: o.sun.clone().normalize() },
    uSunC: { value: col(o.sunC || '#ffffff', o.sunK ?? 0) }, uDisc: { value: o.disc || 0 }, uGlow: { value: col(o.glow || '#000000') },
    uCloud: { value: o.cloud || 0 }, uCloudC: { value: col(o.cloudC || '#000000') }, uCloudL: { value: col(o.cloudL || '#000000') }, uN: { value: NOISE }, uT: { value: 0 }, uWall: { value: o.wall || 0 } };
  const m = new THREE.ShaderMaterial({ uniforms: u, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vp; void main(){ vp = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
    fragmentShader: /* glsl */`uniform vec3 uTop, uHor, uLow, uSun, uSunC, uGlow, uCloudC, uCloudL; uniform float uDisc, uCloud, uT, uWall; uniform sampler2D uN; varying vec3 vp;
      void main(){ vec3 d = normalize(vp); float h = d.y;
        vec3 c = mix(uHor, uTop, smoothstep(0.0, 0.55, h)); c = mix(uLow, c, smoothstep(-0.25, 0.0, h));
        float sd = dot(d, uSun); c += uGlow * (pow(max(sd, 0.0), 8.0) * 0.6 + pow(max(sd, 0.0), 64.0));
        if (uCloud > 0.0) {
          vec2 p = d.xz / max(h + 0.08, 0.04) * 0.35 + vec2(uT * 0.004, 0.0);
          float n1 = texture2D(uN, p * 0.35).r, n2 = texture2D(uN, p * 1.3 + 0.3).g, n3 = texture2D(uN, vec2(atan(d.x, d.z) * 0.9, h * 2.5)).r;
          float cov = smoothstep(0.42, 0.72, n1 * 0.7 + n2 * 0.35) * smoothstep(-0.02, 0.12, h);
          // a storm wall: a dark mass rising from the horizon, lit on its crest
          float wall = uWall * smoothstep(0.02, -0.05, h - (0.18 + 0.22 * n3 + 0.06 * n2));
          float lit = pow(clamp(n2 * 1.4 - 0.2, 0.0, 1.0), 2.0);
          vec3 cc = mix(uCloudC, uCloudL, lit * (0.5 + 0.5 * max(sd, 0.0)));
          c = mix(c, cc, clamp(cov * uCloud + wall, 0.0, 1.0));
        }
        float disc = smoothstep(uDisc, uDisc * 0.985, acos(clamp(sd, -1.0, 1.0)));
        c = mix(c, uSunC, disc * step(0.0001, uDisc));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), m); mesh.renderOrder = -10; mesh.frustumCulled = false; mesh.userData.gbuffer = false;
  scene.add(mesh); return u;
}

function camLook(cam, pos, tgt, roll = 0) { cam.position.copy(pos); cam.up.set(0, 1, 0); cam.lookAt(tgt); if (roll) cam.rotateZ(roll); cam.updateMatrixWorld(); }
const ss = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };

// ---------------------------------------------------------------- SHOTS
const SHOTS = {};

// COMMON WEALTH: the banner on the plain under the storm wall, the low sun raking it from behind-right of camera.
// Rodchenko: lens at wheat height, wide, pitched up, rolled.
SHOTS.flag_storm = async () => {
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(62, RW / RH, 0.05, 9000);
  const sunDir = V3(0.78, 0.26, 0.57).normalize();
  sky(scene, { top: '#16111f', hor: '#4a3c52', low: '#3a2a20', sun: sunDir, glow: '#302018', cloud: 1, cloudC: '#1d1726', cloudL: '#9a8290', wall: 1 });
  const sun = new THREE.DirectionalLight(col('#ffd9a0'), 3.4); sun.position.copy(sunDir).multiplyScalar(60); scene.add(sun);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 140 }); sun.shadow.bias = -0.0005;
  scene.add(new THREE.HemisphereLight(col('#4a3c58'), col('#6a4a20'), 0.5));
  const art = printCanvas({ w: 1800, h: 1200, ground: '#c8141c', draw: (x, w, h) => { acpEmblem(x, w * 0.36, h * 0.5, h * 0.62, { color: '#f4d58a' }); } });
  const flag = new Flag(scene, { w: 4.2, h: 2.8, nx: 56, ny: 36, t0: 0, t1: 6, art, color: '#c8141c', wind: { dir: [1, 0.04, -0.45], speed: 13, gust: 0.5, turb: 0.5 },
    pole: () => ({ base: [0, 0, 0], top: [0, 9.5, 0] }), poleR: 0.045, spear: true, seed: 3, bend: 0.06 });
  flag.setLight({ sun: sunDir, sunColor: col('#ffe0b0', 2.0), sky: col('#3a2e4a', 0.45), ground: col('#7a5424', 0.3), trans: 0.5 });
  const g = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: col('#8a6428'), roughness: 1 })); g.receiveShadow = true; scene.add(g);
  wheatField(scene, { n: 5200, area: [[-3, 7], [-2, 7.3]], seed: 4, k: 0.8 });
  return { scene, cam, frame: t => {
    flag.update(t); camLook(cam, V3(2.6, 0.72, 7.6), V3(1.0, 5.6, 0), -0.19);
    return { post: { bloom: { amount: 0.35, threshold: 0.8, radius: 1 }, film: { contrast: 0.32, sat: 1.1, shoulder: 0.3, split: { shadows: [0.3, 0.26, 0.42], highlights: [1, 0.82, 0.6], amount: 0.3 } }, vignette: { amount: 0.3 }, grain: { amount: 0.4, size: 1.3 } } };
  } };
};

// THE GIANT / THE MAJORITY: the flag against the low red sun, light coming THROUGH the cloth.
SHOTS.flag_sun = async () => {
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, RW / RH, 0.1, 9000);
  const sunDir = V3(0.1, 0.07, -1).normalize();
  sky(scene, { top: '#0c0612', hor: '#8a2a18', low: '#1a0606', sun: sunDir, sunC: '#ffb070', sunK: 3.2, disc: 0.02, glow: '#c03a18', cloud: 0.55, cloudC: '#22080c', cloudL: '#c84a26' });
  scene.add(new THREE.HemisphereLight(col('#5a3048'), col('#2a0c08'), 0.2));
  const art = printCanvas({ w: 1800, h: 1200, ground: '#c8141c', draw: (x, w, h) => acpEmblem(x, w * 0.36, h * 0.5, h * 0.62, { color: '#f4d58a' }) });
  const flag = new Flag(scene, { w: 3.6, h: 2.4, nx: 56, ny: 36, t0: 0, t1: 6, art, color: '#d0141c', wind: { dir: [1, 0.08, 0.25], speed: 9, gust: 0.45, turb: 0.5 },
    pole: () => ({ base: [0, -2, 0], top: [0, 6, 0] }), poleR: 0.04, seed: 8, dirt: 0.15, bend: 0.06 });
  flag.setLight({ sun: sunDir, sunColor: col('#ff8a50', 1.6), sky: col('#40203a', 0.12), ground: col('#300a08', 0.1), trans: 1.0 });
  return { scene, cam, frame: t => {
    flag.update(t); camLook(cam, V3(-0.4, 1.2, 12.5), V3(1.6, 4.4, -0.5), 0.04);
    return { post: { bloom: { amount: 0.7, threshold: 0.7, radius: 1.3 }, halation: { amount: 0.4, tint: [1, 0.3, 0.1] }, film: { contrast: 0.32, sat: 1.05, shoulder: 0.35 }, vignette: { amount: 0.3 }, grain: { amount: 0.45 } } };
  } };
};

// THE IRON IS HOT (2036): a grinder on a beam, sparks skittering along the steel deck toward the lens; arc-blue back
// light through the haze of the bay; the worker a silhouette lit from below by his own sparks.
SHOTS.sparks_grind = async () => {
  const { People } = await import('../lib/fx/people.js');
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(44, RW / RH, 0.03, 500);
  scene.background = col('#0a1622'); scene.fog = new THREE.FogExp2(0x0e2030, 0.075);
  const key = new THREE.DirectionalLight(col('#8cc0ff'), 2.4); key.position.set(-2, 7, -9); scene.add(key);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 30 });
  scene.add(new THREE.HemisphereLight(col('#1a2a3c'), col('#040404'), 0.35));
  bayBack(scene);
  steelFloor(scene);
  const beamM = new THREE.MeshStandardMaterial({ color: col('#44464a'), metalness: 0.85, roughness: 0.38 });
  const ib = iBeam(0.36, 0.22, 6, beamM); ib.position.set(-1.6, 0.9, -3.4); ib.rotation.y = -0.95; scene.add(ib);
  for (const x of [-2.6, 2.4]) { const st = iBeam(0.72, 0.3, 0.5, beamM); st.rotation.z = Math.PI / 2; st.position.set(-1.6 + x * Math.cos(0.95), 0.36, -3.4 - x * Math.sin(0.95)); scene.add(st); }
  // the worker, bent over the beam, both hands on the grinder
  const folk = new People(scene, { max: 2, viewH: RH, shadows: 'full' });
  const id = folk.add(People.random('weld', 11, { hat: true, gloves: true }));
  folk.set(id, { x: -0.55, y: 0, z: -2.95, heading: 0.35, act: 'stand', t: 1, pose: (Pz, st, A) => {
    const { B, ARM, LEG } = A; Pz[B.spine * 3] = 0.35; Pz[B.chest * 3] = 0.3; Pz[B.head * 3] = 0.35;
    for (const s of [1, -1]) { const [ua, fa, hn, fg] = ARM(s); Pz[ua * 3] = -0.95; Pz[ua * 3 + 2] = s * 0.12; Pz[ua * 3 + 1] = -s * 0.35; Pz[fa * 3] = -0.75; Pz[fg * 3 + 2] = -s * 1.4;
      const [th, sh, ft] = LEG(s); Pz[th * 3] = -0.5 + (s > 0 ? -0.25 : 0.1); Pz[sh * 3] = 0.6; Pz[ft * 3] = -Pz[th * 3] - Pz[sh * 3]; Pz[th * 3 + 2] = s * 0.12; } } });
  const grinder = new THREE.Group(); { const m = new THREE.MeshStandardMaterial({ color: col('#20242a'), metalness: 0.4, roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.26, 16), m); body.rotation.z = Math.PI / 2; grinder.add(body);
    const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.03, 24, 1, true, 0, Math.PI), new THREE.MeshStandardMaterial({ color: col('#c89a2a'), metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide })); guard.position.set(0.14, -0.02, 0); grinder.add(guard);
    grinder.position.set(-0.32, 0.99, -2.5); grinder.rotation.set(0.3, 0.4, -0.5); grinder.traverse(o => o.castShadow = true); scene.add(grinder); }
  const sp = new Sparks(scene, { max: 14000, ground: 0, widthPx: 2.2 * SC, shutter: 1 / 45 });
  const P0 = [-0.24, 0.92, -2.4];
  sp.stream({ t0: -1.5, t1: 4, rate: 3200, pos: P0, dir: t => [0.3 + 0.08 * Math.sin(t * 2.3), -0.42, 0.86], spread: 0.2, flat: 0.8, kind: 'grind', seed: 5 });
  const pl = new THREE.PointLight(col('#ffb070'), 0, 9, 1.4); scene.add(pl);
  const hl = new THREE.PointLight(col('#fff0d0'), 1.2, 1.5, 2); hl.position.set(...P0); scene.add(hl);
  return { scene, cam, frame: t => {
    folk.update(cam);
    sp.update(t, cam, renderer); const L = sp.light(); pl.position.copy(L.pos); pl.position.y = Math.max(0.15, pl.position.y); pl.intensity = Math.min(18, L.power * 0.012); pl.color.copy(L.color);
    camLook(cam, V3(1.5, 0.3, 1.4), V3(-0.5, 0.95, -2.7), 0.05);
    return { stats: { sparks: sp.count }, post: { bloom: { amount: 0.9, threshold: 0.62, radius: 1.2 }, halation: { amount: 0.35, tint: [1, 0.35, 0.1] }, film: { contrast: 0.3, sat: 1.05, shoulder: 0.45 }, vignette: { amount: 0.3 }, grain: { amount: 0.5 } } };
  } };
};


// sculpt study: neutral light, for judging the SDF anatomy (?preset=&yaw=)
SHOTS.head_study = async () => {
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(22, RW / RH, 0.05, 100); scene.background = col('#2a2a2e');
  const name = Q.get('preset') || 'ironworker';
  const head = await Head.create(scene, { ...HEADS[name], name, look: Q.get('look') || 'skin', bin: Q.get('live') ? false : undefined, bake: { h: +(Q.get('h') || 0.0021) } });
  head.light({ key: { dir: V3(0.6, 0.5, 0.7), color: col('#fff4e8', 2.2) }, rims: [{ dir: V3(-0.7, 0.3, -0.6), color: col('#a0c0ff', 1.5) }, { dir: V3(0.8, 0.1, -0.5), color: col('#ffffff', 0.5) }], sky: col('#8090a0', 0.5), ground: col('#403830', 0.4) });
  const yaw = +(Q.get('yaw') || 0.5);
  return { scene, cam, stats: { verts: head.nv }, frame: t => { head.group.rotation.y = yaw; camLook(cam, V3(0, -0.02, 1.25), V3(0, -0.04, 0), 0); return { stats: { verts: head.nv, tris: head.ntri, bakeMs: Math.round(head.bakeMs) } }; } };
};


// THE IDENT / MECHA PROLETARIAT: a monumental press in a hall, Rodchenko low angle, top light + a red work lamp.
SHOTS.machine_press = async () => {
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(50, RW / RH, 0.1, 800);
  scene.background = col('#141a22'); scene.fog = new THREE.FogExp2(0x1c2430, 0.022);
  const m = machine({ seed: +(Q.get('seed') || 3), kind: 'press', size: [8, 12, 5], detail: 1 });
  const g = buildMeshes(m, { mats: MATS.mill({ body: '#56626e', paint2: '#a82a1c' }) }); scene.add(g);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: col('#3a3834'), roughness: 0.8, metalness: 0.1, roughnessMap: NOISE, bumpMap: NOISE, bumpScale: 0.3 }));
  floor.receiveShadow = true; scene.add(floor);
  const top = new THREE.DirectionalLight(col('#e8eeff'), 3.2); top.position.set(-14, 26, 22); top.castShadow = true; top.shadow.mapSize.set(2048, 2048);
  Object.assign(top.shadow.camera, { left: -14, right: 14, top: 18, bottom: -6, near: 1, far: 90 }); top.shadow.bias = -0.0004; scene.add(top);
  const red = new THREE.PointLight(col('#ff3a1a'), 50, 40, 1.4); red.position.set(8, 2.5, 7); scene.add(red);
  const back = new THREE.DirectionalLight(col('#9ab4ff'), 2.0); back.position.set(10, 12, -20); scene.add(back);
  // hall: far wall of windows in haze
  bayBack(scene);
  scene.add(new THREE.HemisphereLight(col('#3a4454'), col('#100c0a'), 0.5));
  return { scene, cam, frame: t => { camLook(cam, V3(-6.5, 1.1, 16.5), V3(0.4, 7.0, 0), 0.2);
    return { stats: g.userData.stats, post: { bloom: { amount: 0.5, threshold: 0.75 }, film: { contrast: 0.35, sat: 1.0, shoulder: 0.3 }, vignette: { amount: 0.3 }, grain: { amount: 0.5 } } }; } };
};
// WHO OWNS THE MACHINES restraint: the same grammar machine as a silhouette on a red field, one rim, one red dot.
SHOTS.machine_silhouette = async () => {
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(28, RW / RH, 0.1, 2000);
  const sunDir = V3(0.2, 0.25, -1).normalize();
  sky(scene, { top: '#5a0a0c', hor: '#d8321e', low: '#2a0406', sun: sunDir, glow: '#ff6a2a', sunC: '#ffd0a0', sunK: 0 });
  const m = machine({ seed: 5, kind: 'press', size: [9, 13, 5.5] });
  const blk = new THREE.MeshStandardMaterial({ color: col('#0a0506'), metalness: 0.2, roughness: 0.55 });
  const g = buildMeshes(m, { mats: new Proxy({}, { get: () => blk }), ao: false }); scene.add(g);
  const rim = new THREE.DirectionalLight(col('#ff7a40'), 6); rim.position.copy(sunDir).multiplyScalar(40); scene.add(rim);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: col('#0a0406'), roughness: 0.3, metalness: 0.5 })); scene.add(floor);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ color: col('#ffe8d0', 2.2), fog: false })); dot.position.set(9, 26, -120); scene.add(dot);
  return { scene, cam, frame: t => { camLook(cam, V3(-3, 1.0, 38), V3(0, 9.5, 0), 0); dot.lookAt(cam.position);
    return { stats: g.userData.stats, post: { bloom: { amount: 0.8, threshold: 0.7 }, film: { contrast: 0.3, shoulder: 0.3 }, vignette: { amount: 0.25 }, grain: { amount: 0.4 } } }; } };
};
// THE GIANT: the city below the tower at blue hour, windows lit, sodium streets (shape-grammar city).
SHOTS.city_blue = async () => {
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(40, RW / RH, 1, 6000);
  const sunDir = V3(0.6, -0.05, -0.8).normalize();
  sky(scene, { top: '#0c1a3c', hor: '#3a4a78', low: '#0a1020', sun: sunDir, glow: '#6a4a6a' });
  scene.fog = new THREE.FogExp2(0x2a3868, 0.0016);
  const c = city({ seed: 7, blocks: [9, 9], block: 60, street: 16, style: 'deco', hMax: 170 });
  const g = buildMeshes(c, { mats: MATS.city({ night: 1, facade: '#8a8e98', trim: '#9a9ea8', glass: '#4a5a80' }), aoRes: 220, shadows: false }); scene.add(g);
  scene.add(new THREE.HemisphereLight(col('#4a5a8a'), col('#1a1410'), 0.9));
  const moon = new THREE.DirectionalLight(col('#8aa0d0'), 0.6); moon.position.set(-100, 200, 150); scene.add(moon);
  return { scene, cam, frame: t => { camLook(cam, V3(-60, 150, 420), V3(40, 40, -200), 0.03);
    return { stats: g.userData.stats, post: { bloom: { amount: 0.9, threshold: 0.55, radius: 1.1 }, film: { contrast: 0.3, sat: 1.1, shoulder: 0.3 }, vignette: { amount: 0.3 }, grain: { amount: 0.5 } } }; } };
};


// THE MAJORITY / HORDE (Gavras): the crowd compressed into a wall by a long lens, advancing through flare smoke,
// back-lit red; one runner out in front; three banners carried in the mass (flag.js poles follow their bearers).
SHOTS.crowd_wall = async () => {
  const { People } = await import('../lib/fx/people.js');
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(11, RW / RH, 1, 3000);
  scene.background = col('#120406'); scene.fog = new THREE.FogExp2(0x2a0808, 0.009);
  const N = +(Q.get('n') || 520);
  const cf = new CrowdFlow({ n: N, bounds: [-16, -30, 16, 150], goal: Array.from({ length: 21 }, (_, k) => [-10 + k, -25]), t0: 0, t1: 6, seed: 5, speed: [1.2, 1.7],
    spawn: (r, i) => i === 0 ? [0.8, 27] : [(r() - 0.5) * 22, 34 + 60 * r() * r()],
    obstacles: [{ x0: -40, x1: -11.5, z0: -40, z1: 160 }, { x0: 11.5, x1: 40, z0: -40, z1: 160 }] });
  cf.V0[0] = 3.6;                                                      // the runner
  const folk = new People(scene, { max: N + 2, viewH: RH, budget: [40, 220], shadows: 'none' });
  cf.attach(folk, { People, acts: { fist: 0.3, march: 0.15 }, seed: 9 });
  // street walls (tenement facades from the grammar would go here; kept as dark masses so the crowd is the image)
  const wm = new THREE.MeshStandardMaterial({ color: col('#1a1012'), roughness: 0.9 });
  for (const s2 of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(2, 30, 400), wm); w.position.set(s2 * 12.5, 15, 100); scene.add(w); }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 800).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: col('#2a1a18'), roughness: 0.55, metalness: 0.2, roughnessMap: NOISE })); scene.add(ground);
  // back light: the flares behind the crowd, inside the smoke
  const back = new THREE.DirectionalLight(col('#ff3a1a'), 5.5); back.position.set(0.3, 0.45, 1).multiplyScalar(50); scene.add(back);
  const fill = new THREE.HemisphereLight(col('#5a1a1a'), col('#0a0204'), 0.35); scene.add(fill);
  const flares = [[-7, 1.8, 60], [5, 2.2, 75], [-2, 2.5, 95], [8, 1.5, 48]].map(([x, y, z]) => { const L = new THREE.PointLight(col('#ff2a10'), 900, 60, 1.8); L.position.set(x, y, z); scene.add(L); return L; });
  const smoke = smokeField(scene, { n: 40, box: [[-12, 0, 40], [12, 12, 140]], color: col('#ff5a3a', 0.35), seed: 3, size: [8, 18] });
  const flagArt = printCanvas({ w: 900, h: 600, ground: '#c8141c', draw: (x, w, h) => acpEmblem(x, w * 0.36, h * 0.5, h * 0.6, { color: '#f4d58a' }) });
  const bearers = [7, 19, 33].map((k, n2) => {
    const st = {}; return new Flag(scene, { w: 1.9, h: 1.25, nx: 28, ny: 18, t0: 0, t1: 6, art: flagArt, color: '#c8141c', seed: 20 + n2, poleR: 0.025,
      wind: { dir: [1, 0, -0.4], speed: 7, gust: 0.5, turb: 0.5 },
      pole: t => { cf.at(Math.max(0, t), k, st); return { base: [st.x + 0.25, 1.1, st.z], top: [st.x + 0.35, 4.3, st.z - 0.1] }; } })
      .setLight({ sun: V3(0.3, 0.45, 1), sunColor: col('#ff5a30', 2.2), sky: col('#401010', 0.3), ground: col('#100404', 0.2), trans: 1.4, fog: col('#3a0c0a'), fogDensity: 0.011 });
  });
  return { scene, cam, frame: t => {
    cf.drive(folk, t); folk.update(cam); for (const f of bearers) f.update(t);
    for (const [i, L] of flares.entries()) L.intensity = 900 * (0.8 + 0.2 * Math.sin(t * 13 + i * 2) * Math.sin(t * 7.3 + i));
    smoke.update(t, cam);
    const r0 = cf.at(t, 0, {}); camLook(cam, V3(0.6, 1.1, r0.z - 40), V3(0.6, 3.1, r0.z + 30), 0.0);
    return { stats: { people: N, drawn: folk.stats.drawn }, post: { bloom: { amount: 0.8, threshold: 0.6, radius: 1.3 }, halation: { amount: 0.5, tint: [1, 0.25, 0.1] }, film: { contrast: 0.35, sat: 1.05, shoulder: 0.3 }, vignette: { amount: 0.3 }, grain: { amount: 0.6, size: 1.4 } } };
  } };
};

// COMMON WEALTH's missing bridge: the people of the plain converge on the works. Roads from three directions merge at
// the gate; the flow narrows, thickens and slows through it (Weidmann), a river of workers at dawn with long shadows.
SHOTS.crowd_flow = async () => {
  const { People } = await import('../lib/fx/people.js');
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, RW / RH, 1, 4000);
  const sunDir = V3(-0.9, 0.16, -0.25).normalize();
  sky(scene, { top: '#6a86b0', hor: '#f0c090', low: '#8a6a4a', sun: sunDir, glow: '#ffb070', cloud: 0.4, cloudC: '#a08090', cloudL: '#ffd0a0' });
  scene.fog = new THREE.Fog(0xe0b490, 80, 520);
  const N = +(Q.get('n') || 700);
  const gate = [{ x0: -60, x1: -3.2, z0: -3, z1: 3 }, { x0: 3.2, x1: 60, z0: -3, z1: 3 }];
  const roads = [[-38, 90], [0, 110], [42, 95]];
  const cf = new CrowdFlow({ n: N, bounds: [-60, -60, 60, 120], goal: [[0, -50]], t0: 0, t1: 6, seed: 11, speed: [1.1, 1.5], obstacles: gate,
    spawn: (r, i) => { const rd = roads[i % 3], u = r(); const x = rd[0] * (1 - u * 0.85), z = rd[1] * (1 - u * 0.9) + 8; return [x + (r() - 0.5) * 5, z + (r() - 0.5) * 3]; } });
  const folk = new People(scene, { max: N, viewH: RH, budget: [24, 200], shadows: 'proxy' });
  cf.attach(folk, { People, acts: { fist: 0.06, march: 0.04 }, seed: 4 });
  // the works: a wall with a gate, the hall behind (grammar housing), roads
  const wall = new THREE.MeshStandardMaterial({ color: col('#a88a70'), roughness: 0.9 });
  for (const o of gate) { const w = new THREE.Mesh(new THREE.BoxGeometry(o.x1 - o.x0, 5, 6), wall); w.position.set((o.x0 + o.x1) / 2, 2.5, 0); w.castShadow = w.receiveShadow = true; scene.add(w); }
  for (const s2 of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1.6, 9, 7), wall); p.position.set(s2 * 4.2, 4.5, 0); p.castShadow = true; scene.add(p); }
  // the works, built with the grammar Builder directly: a sawtooth-roofed hall, three stacks with ladders and bands
  const Bw = new Builder(4);
  Bw.box('concrete', [0, 6, -40], [34, 6, 16], { ch: 0.2 });
  for (let i = 0; i < 12; i++) { const x = -31 + i * 5.6; Bw.box('body', [x, 13.2, -40], [2.8, 1.4, 16], { ch: 0.1, M: [[Math.cos(0.5), Math.sin(0.5), 0], [-Math.sin(0.5), Math.cos(0.5), 0], [0, 0, 1]] }); Bw.box('glass', [x + 1.4, 13.4, -40], [0.1, 1.3, 15.5], { ch: 0.02, occ: false }); }
  for (let i = 0; i < 12; i++) Bw.box('paint2', [-30 + i * 5.5, 3, -23.8], [1.6, 3, 0.15], { ch: 0.05, occ: false });
  for (const [k, x] of [[0, -18], [1, -6], [2, 6]]) { const h = 46 + k * 6; Bw.cyl('concrete', [x, h / 2, -52], 2.4, h / 2, { r2: 1.8, seg: 32 });
    for (let b = 0; b < 5; b++) Bw.cyl('paint2', [x, 12 + b * 8, -52], 2.4 - b * 0.12 + 0.1, 0.35, { seg: 32 }); Bw.cyl('dark', [x, h + 0.5, -52], 1.95, 0.6, { seg: 32 }); }
  const hall = buildMeshes(Bw, { mats: MATS.mill({ body: '#7a7a80', paint2: '#9a2a1e', grime: 0.45 }) }); scene.add(hall);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: col('#9a7a4a'), roughness: 1 })); ground.receiveShadow = true; scene.add(ground);
  const roadM = new THREE.MeshStandardMaterial({ color: col('#6a5a48'), roughness: 1 });
  for (const rd of roads) { const L = Math.hypot(rd[0], rd[1]) + 40; const g = new THREE.Mesh(new THREE.PlaneGeometry(9, L).rotateX(-Math.PI / 2), roadM); g.position.set(rd[0] / 2, 0.02, rd[1] / 2 + 10); g.rotation.y = -Math.atan2(rd[0], rd[1]); g.receiveShadow = true; scene.add(g); }
  wheatField(scene, { n: 6000, area: [[-120, 120], [10, 200]], seed: 8, k: 1 });
  const sun = new THREE.DirectionalLight(col('#ffc890'), 3.4); sun.position.copy(sunDir).multiplyScalar(150); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 130, bottom: -70, near: 10, far: 500 }); sun.shadow.bias = -0.0006; scene.add(sun); scene.add(sun.target);
  scene.add(new THREE.HemisphereLight(col('#8aa0c8'), col('#6a4a2a'), 0.7));
  return { scene, cam, frame: t => { cf.drive(folk, t); folk.update(cam);
    camLook(cam, V3(18, 26, 150), V3(-2, 8, -10), 0);
    return { stats: { people: N, drawn: folk.stats.drawn }, post: { bloom: { amount: 0.3, threshold: 0.8 }, film: { contrast: 0.28, sat: 1.05, shoulder: 0.3 }, vignette: { amount: 0.25 }, grain: { amount: 0.45 } } }; } };
};

function smokeField(scene, { n, box, color, seed, size }) {
  // camera-facing smoke cards with a baked noise texture, lit by the flares (additive over the fog)
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'); let s = seed * 99 + 7; const r = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10000) / 10000; };
  for (let i = 0; i < 90; i++) { const px = 128 + (r() - 0.5) * 120, py = 128 + (r() - 0.5) * 120, rad = 20 + r() * 50; const g = x.createRadialGradient(px, py, 0, px, py, rad); g.addColorStop(0, `rgba(255,255,255,${0.05 + r() * 0.08})`); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 256, 256); }
  const tex = new THREE.CanvasTexture(c);
  const cards = [];
  for (let i = 0; i < n; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, color: color.clone().multiplyScalar(0.25 + 0.5 * r()), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true }));
    const sc = size[0] + r() * (size[1] - size[0]); m.scale.set(sc, sc * 0.7, 1); m.position.set(box[0][0] + r() * (box[1][0] - box[0][0]), box[0][1] + r() * (box[1][1] - box[0][1]), box[0][2] + r() * (box[1][2] - box[0][2]));
    m.userData.v = [(r() - 0.5) * 0.6, 0.3 + r() * 0.5, r() * 6]; m.userData.p0 = m.position.clone(); scene.add(m); cards.push(m); }
  return { update(t, cam) { for (const m of cards) { const v = m.userData.v; m.position.set(m.userData.p0.x + v[0] * t, m.userData.p0.y + v[1] * t * 0.3, m.userData.p0.z); m.quaternion.copy(cam.quaternion); m.rotateZ(v[2] + t * 0.05); } } };
}


// ---------------------------------------------------------------- heads (sculpt.js) in the slate's worlds
function hatDecal() { const c = document.createElement('canvas'); c.width = 256; c.height = 180; const x = c.getContext('2d');
  x.fillStyle = '#f2ece0'; x.beginPath(); x.roundRect(8, 8, 240, 164, 14); x.fill(); acpEmblem(x, 128, 90, 140, { color: '#c8141c' }); return c; }
async function headIn(scene, name, o = {}) { return Head.create(scene, { ...HEADS[name], name, ...o }); }
// THE GIANT: the ironworker's profile against the low red sun; the sun rims him, blue hour fills the shadow side.
SHOTS.head_sun = async () => {
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(24, RW / RH, 0.05, 9000);
  const sunDir = V3(0.55, 0.1, -1).normalize();
  sky(scene, { top: '#101a3a', hor: '#b83a26', low: '#2a0a0a', sun: sunDir, sunC: '#ff5a2a', sunK: 2.4, disc: 0.06, glow: '#c0301a', cloud: 0.35, cloudC: '#3a1420', cloudL: '#ff6a3a' });
  const head = await headIn(scene, 'ironworker', { decal: hatDecal(), sweat: 0.9 });
  head.light({ key: { dir: V3(-0.5, 0.35, 0.8), color: col('#6a80b8', 0.22) }, rims: [{ dir: sunDir, color: col('#ff7a40', 8) }, { dir: V3(0.75, 0.55, -0.35), color: col('#ffb080', 0.9) }], sky: col('#304880', 0.1), ground: col('#401810', 0.15) });
  head.group.rotation.set(-0.28, 1.25, 0); head.group.position.set(0, 0, 0);
  return { scene, cam, frame: t => { head.update(t); camLook(cam, V3(0.14, -0.2, 1.35), V3(0.03, 0.02, 0), -0.05);
    return { stats: { verts: head.nv }, post: { bloom: { amount: 0.8, threshold: 0.62, radius: 1.3 }, halation: { amount: 0.5, tint: [1, 0.3, 0.1] }, film: { contrast: 0.3, sat: 1.05, shoulder: 0.35 }, vignette: { amount: 0.3 }, grain: { amount: 0.5 } } }; } };
};
// THE IRON IS HOT: an old tapper, full beard, lit from below by the pour; arc-blue rim from the bay; live sparks.
SHOTS.head_forge = async () => {
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, RW / RH, 0.05, 500);
  scene.background = col('#060a10'); scene.fog = new THREE.FogExp2(0x0a1622, 0.05);
  const head = await headIn(scene, 'elder', { sweat: 1, dirt: 0.6 });
  head.light({ key: { dir: V3(0.2, -0.75, 0.6), color: col('#ff8a3a', 4.2) }, rims: [{ dir: V3(-0.7, 0.35, -0.6), color: col('#8cc8ff', 3.2) }, { dir: V3(0.8, 0.1, -0.5), color: col('#ff6a2a', 1.5) }], sky: col('#1a2a3a', 0.25), ground: col('#ff6a20', 0.35) });
  head.group.rotation.set(0.05, -0.55, 0);
  const sp = new Sparks(scene, { max: 6000, ground: -1.6, widthPx: 2.2 * SC, shutter: 1 / 45 });
  sp.stream({ t0: -2, t1: 4, rate: 500, pos: [0.7, -1.2, -1.2], dir: [-0.6, 0.75, 0.3], spread: 0.45, kind: 'pour', seed: 4 });
  sp.embers({ t0: -6, t1: 4, rate: 60, box: [[-1.5, -1.4, -2.5], [1.5, 0, 0.3]], seed: 5, rise: 0.5, turb: 0.6 });
  return { scene, cam, frame: t => { head.update(t); sp.update(t, cam, renderer); camLook(cam, V3(-0.12, -0.12, 1.15), V3(0.0, -0.02, 0), 0.04);
    return { stats: { verts: head.nv, sparks: sp.count }, post: { bloom: { amount: 0.8, threshold: 0.6, radius: 1.2 }, halation: { amount: 0.45, tint: [1, 0.35, 0.1] }, film: { contrast: 0.32, sat: 1.05, shoulder: 0.4 }, vignette: { amount: 0.3 }, grain: { amount: 0.6, size: 1.4 } } }; } };
};
// REJUVENATION / RED WEDGE: the crew chief as a bronze monument at noon, cobalt sky, Rodchenko low angle.
SHOTS.head_bronze = async () => {
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, RW / RH, 0.05, 9000);
  const sunDir = V3(0.35, 0.9, 0.35).normalize();
  sky(scene, { top: '#0e2a78', hor: '#6a8ad0', low: '#8a8a90', sun: sunDir, glow: '#ffffff', cloud: 0.25, cloudC: '#ffffff', cloudL: '#ffffff' });
  const head = await headIn(scene, 'woman', { look: 'bronze', bronze: '#8a5a30' });
  head.light({ key: { dir: sunDir, color: col('#fff6e8', 5.5) }, rims: [{ dir: V3(-0.8, 0.2, -0.5), color: col('#9ab8ff', 1.4) }, { dir: V3(0, -1, 0.2), color: col('#d8d0c0', 0.6) }], sky: col('#6a8ad0', 0.9), ground: col('#a09890', 0.7) });
  head.group.rotation.set(-0.35, 0.45, 0); head.group.scale.setScalar(1);
  return { scene, cam, frame: t => { camLook(cam, V3(-0.25, -0.62, 1.2), V3(0.0, 0.0, 0), 0.12);
    return { stats: { verts: head.nv }, post: { bloom: { amount: 0.25, threshold: 0.85 }, film: { contrast: 0.35, sat: 1.05, shoulder: 0.25 }, vignette: { amount: 0.2 }, grain: { amount: 0.35 } } }; } };
};
// OWN THE FUTURE poster world: the farmer in his cap, a silhouette with one teal rim, looking up at the red dot.
SHOTS.head_shadow = async () => {
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(26, RW / RH, 0.05, 9000);
  const sunDir = V3(-0.3, 0.05, -1).normalize();
  sky(scene, { top: '#1a2a2c', hor: '#5a7a78', low: '#2a2a24', sun: sunDir, glow: '#806a50' });
  const head = await headIn(scene, 'farmer', { look: 'shadow', flat: '#0a0c0c' });
  head.light({ rims: [{ dir: V3(-0.6, 0.3, -0.8), color: col('#9ad0c8', 1.2) }, { dir: V3(0.7, 0.5, -0.6), color: col('#ffb080', 0.6) }] });
  head.group.rotation.set(-0.55, -1.35, 0);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ color: col('#e0141a', 1.0) })); dot.position.set(-9, 58, -80); scene.add(dot);
  return { scene, cam, frame: t => { dot.lookAt(V3(0, 0, 1.4)); camLook(cam, V3(0.05, -0.28, 1.4), V3(-0.02, 0.12, 0), 0);
    return { stats: { verts: head.nv }, post: { film: { contrast: 0.25, shoulder: 0.2 }, vignette: { amount: 0.2 }, grain: { amount: 0.55, size: 1.5 } } }; } };
};

// ---------------------------------------------------------------- set pieces
function wheatField(scene, { n, area, seed }) {
  // a wheat stalk: a slightly bowed stem, an ear of 18 paired spikelets (flattened, angled) and long fine awns; merged, instanced
  const parts = [], bend = y => 0.03 * y * y;
  const stem = new THREE.CylinderGeometry(0.0018, 0.0028, 0.86, 4, 6); stem.translate(0, 0.43, 0);
  { const a = stem.attributes.position; for (let i = 0; i < a.count; i++) a.setX(i, a.getX(i) + bend(a.getY(i))); } stem.computeVertexNormals(); parts.push(stem);
  for (let k = 0; k < 18; k++) { const y = 0.87 + k * 0.0062, side = k % 2 ? 1 : -1, taper = 1 - k / 26;
    const s = new THREE.SphereGeometry(0.0052 * taper, 5, 4); s.scale(0.8, 1.9, 1.25); s.rotateZ(-side * 0.35); s.translate(side * 0.0042 * taper + bend(y), y, 0); parts.push(s);
    const awn = new THREE.CylinderGeometry(0.00025, 0.0005, 0.085 * (0.6 + 0.4 * taper), 3, 1); awn.translate(0, 0.042, 0); awn.rotateZ(-side * 0.22); awn.translate(side * 0.006 + bend(y), y + 0.006, 0); parts.push(awn); }
  const geo = mergeGeoms(parts);
  const m = new THREE.MeshStandardMaterial({ color: col('#ffffff'), roughness: 0.75 });
  const im = new THREE.InstancedMesh(geo, m, n); let s = seed * 999 + 1; const r = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
  const o = new THREE.Object3D(); const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const x = area[0][0] + r() * (area[0][1] - area[0][0]), z = area[1][0] + r() * (area[1][1] - area[1][0]);
    o.position.set(x, 0, z); o.rotation.set((r() - 0.5) * 0.25, r() * 6.28, (r() - 0.5) * 0.25); const k = (0.85 + r() * 0.3) * (arguments[1].k || 1); o.scale.set(k * 0.8, k * (0.92 + r() * 0.16), k * 0.8); o.updateMatrix(); im.setMatrixAt(i, o.matrix);
    c.setHSL(0.105 + r() * 0.025, 0.55 + r() * 0.2, 0.42 + r() * 0.18); im.setColorAt(i, c);
  }
  im.castShadow = true; scene.add(im); return im;
}
function mergeGeoms(list) {
  let nv = 0, ni = 0; for (const g of list) { const gi = g.index ? g : g; nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), idx = new Uint32Array(ni); let ov = 0, oi = 0;
  for (const g of list) { pos.set(g.attributes.position.array, ov * 3); nor.set(g.attributes.normal.array, ov * 3);
    if (g.index) { for (let i = 0; i < g.index.count; i++) idx[oi + i] = g.index.array[i] + ov; oi += g.index.count; } else { for (let i = 0; i < g.attributes.position.count; i++) idx[oi + i] = ov + i; oi += g.attributes.position.count; }
    ov += g.attributes.position.count; }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setIndex(new THREE.BufferAttribute(idx, 1)); return out;
}
function steelFloor(scene) {
  const m = new THREE.MeshStandardMaterial({ color: col('#2a2c30'), metalness: 0.7, roughness: 0.5, roughnessMap: NOISE, bumpMap: NOISE, bumpScale: 0.6 });
  NOISE.repeat?.set(1, 1);
  const g = new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2); const uv = g.attributes.uv.array; for (let i = 0; i < uv.length; i++) uv[i] *= 24;
  const f = new THREE.Mesh(g, m); f.receiveShadow = true; scene.add(f);
  // plate seams and bolts: a grid of dark grooves every 1.5 m
  const sm = new THREE.MeshBasicMaterial({ color: 0x050505 });
  for (let i = -8; i <= 8; i++) { const a = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 30).rotateX(-Math.PI / 2), sm); a.position.set(i * 1.5, 0.001, 0); scene.add(a);
    const b = new THREE.Mesh(new THREE.PlaneGeometry(30, 0.012).rotateX(-Math.PI / 2), sm); b.position.set(0, 0.001, i * 1.5); scene.add(b); }
  return f;
}
function bayBack(scene) {
  const m = new THREE.MeshStandardMaterial({ color: col('#1a1e24'), metalness: 0.6, roughness: 0.6 });
  for (let i = -3; i <= 3; i++) { const c = iBeam(0.5, 0.35, 14, m); c.rotation.z = Math.PI / 2; c.position.set(i * 4.5, 7, -12 - Math.abs(i) * 0.4); scene.add(c); }
  const wm = new THREE.MeshBasicMaterial({ color: col('#9fd0ff', 0.9), fog: true });
  for (let i = -3; i < 3; i++) for (let k = 0; k < 3; k++) { const w = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), wm); w.position.set(i * 4.5 + 2.25, 4.5 + k * 2.1, -12.5); scene.add(w); }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(40, 0.5, 0.4), m); beam.position.set(0, 3.6, -11.5); scene.add(beam);
}
function iBeam(h, w, L, mat) {
  const g = new THREE.Group(), t = 0.018;
  const web = new THREE.Mesh(new THREE.BoxGeometry(L, h - 2 * t, 0.012), mat); g.add(web);
  for (const s of [-1, 1]) { const f = new THREE.Mesh(new THREE.BoxGeometry(L, t, w), mat); f.position.y = s * (h / 2 - t / 2); g.add(f); }
  g.traverse(o => { o.castShadow = o.receiveShadow = true; }); return g;
}

// ---------------------------------------------------------------- driver
const T0 = performance.now();
const S = await SHOTS[SHOT]();
window.labInfo = { shot: SHOT, setupMs: Math.round(performance.now() - T0) };
window.renderFrame = async (t) => {
  const t0 = performance.now();
  const r = S.frame(t) || {};
  renderer.render(S.scene, S.cam);
  ctx.drawImage(renderer.domElement, 0, 0, W, H);
  if (r.post) post.apply(ctx.canvas, t, r.post, { ctx });
  if (r.overlay) r.overlay(ctx, t);
  ctx.getImageData(0, 0, 1, 1);      // settle
  return { ms: Math.round(performance.now() - t0), stats: r.stats || {} };
};
window.sceneReady = true;
