// LAB / HUMAN (HUMAN studio, cycle 1): the people reel. Six subjects x three renderings from one pose each.
//   ?subject=profile|hand|climb|crowd|rider|face  &mode=lit|rim|print|halftone
// window.renderFrame(t) draws into #out (2D, 1080x1920) and returns the shot's pass/fail measurements (also on window.labInfo).
import * as THREE from 'three';
import { loadHeroData, Hero } from '../lib/fx/hero.js';
import { loadTake, heroMap, PEOPLE_MAP } from '../lib/fx/bvh.js';
import { People, TRADES, setFistTwist } from '../lib/fx/people.js';
if (Q0().get('twist')) setFistTwist(+Q0().get('twist'));
function Q0() { return new URLSearchParams(location.search); }
import { fpPatchScene, FigurePass, haloFrom } from '../lib/fx/figure_pass.js';
import { Print } from '../lib/fx/print.js';
import { lit, sunDisc, dust } from './horde_figures.js';
import { loadGallop, loadGallopPhoto, riderFrame, drawHorse, drawHorsePhoto, drawRider, drawFlag, hoofContacts, drawHorde } from './horde_riders.js';

const Q = new URLSearchParams(location.search);
const SUBJ = Q.get('subject') || 'profile', MODE = Q.get('mode') || 'lit';
const W = 1080, H = 1920;
const out = document.getElementById('out'), ctx = out.getContext('2d');
const glc = document.createElement('canvas'); glc.width = W; glc.height = H;
const renderer = new THREE.WebGLRenderer({ canvas: glc, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0; renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, W / H, 0.02, 3000);
window.labInfo = {};
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const rng = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const MOCAP = '../../sources/mocap/cmu/';

// ---------------------------------------------------------------- environment
function skyDome({ zenith = '#1a1020', horizon = '#c8502a', low = '#6a2414', sunDir = V3(0, 0.1, -1), sunCol = '#ffb070', disc = 0.035, discCol = '#ff5a2a' }) {
  const m = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { Z: { value: new THREE.Color(zenith) }, Hz: { value: new THREE.Color(horizon) }, L: { value: new THREE.Color(low) }, S: { value: sunDir.clone().normalize() }, SC: { value: new THREE.Color(sunCol) }, D: { value: disc }, DC: { value: new THREE.Color(discCol) } },
    vertexShader: 'varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vp; uniform vec3 Z, Hz, L, S, SC, DC; uniform float D;
      void main(){ vec3 d = normalize(vp); float h = d.y; vec3 c = mix(Hz, Z, smoothstep(0.0, 0.5, h)); c = mix(c, L, smoothstep(0.0, -0.2, h));
        float a = acos(clamp(dot(d, S), -1.0, 1.0));
        c += SC * (0.9 * exp(-a * 5.0) + 0.35 * exp(-a * 1.6)) * (0.6 + 0.4 * smoothstep(-0.1, 0.2, h));
        if (D > 0.0) c = mix(c, DC * 2.2, smoothstep(D, D * 0.92, a));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` });
  const s = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), m); s.userData.gbuffer = false; s.renderOrder = -1; scene.add(s); return s;
}
function ground({ color = '#5a3a24', size = 3000 } = {}) {
  const g = new THREE.PlaneGeometry(size, size, 1, 1); g.rotateX(-Math.PI / 2);
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
  m.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 gW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\ngW = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 gW; float gh(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }')
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= 0.75 + 0.35 * gh(floor(gW.xz * 6.0)) * (0.7 + 0.3 * gh(floor(gW.xz * 0.7)));'); };
  const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; mesh.userData.subject = 0; mesh.userData.rim = false;
  const uv = g.attributes.uv.array; for (let i = 0; i < uv.length; i++) uv[i] *= size;       // metric uvs (m)
  scene.add(mesh); return mesh;
}
function sunLight(pos, target, { color = '#ffb070', intensity = 5, size = 6, map = 2048 } = {}) {
  const L = new THREE.DirectionalLight(color, intensity); L.position.copy(pos); L.target.position.copy(target); L.castShadow = true;
  L.shadow.mapSize.set(map, map); const c = L.shadow.camera; c.left = c.bottom = -size; c.right = c.top = size; c.near = 0.5; c.far = pos.distanceTo(target) * 2; L.shadow.bias = -0.0003; L.shadow.normalBias = 0.02;
  scene.add(L, L.target); return L;
}
const project = (p) => { camera.updateMatrixWorld(); const v = p.clone().project(camera); return [(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H, v.z]; };
const pxPerM = (p) => { camera.updateMatrixWorld(); return H / (2 * -p.clone().applyMatrix4(camera.matrixWorldInverse).z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))); };
function frontLit(h, sun) {         // > 0.3: the key comes from behind the camera (the roadmap rule: faces never front-lit)
  const hp = h.joint('head'), toSun = sun.clone().sub(hp).normalize(), toCam = camera.position.clone().sub(hp).normalize();
  return +(toSun.dot(toCam)).toFixed(2);
}

// ---------------------------------------------------------------- subjects
const S = {};
let SUN = V3(0, 10, -100), RIM = { rim: '#ffc79a', rim2: '#ff3a14', body: '#0b0304' }, PRESS = ['engrave', { pitch: 7, contour: 0.9, crosshatch: 1, stipple: 1 }], PAPER = 'cream';
let BG2D = null;
const HEROES = [];        // every Hero in the shot (ink strokes in print, gesture checks)          // (g, t) background for the rim composite
let RIMSUN = null;        // the backlight for the RIM rendering (world position); defaults to SUN

S.profile = async data => {
  const h = new Hero(data, { variant: 'forge', height: 1.82, kind: 'work', shirt: '#28323e', hat: 'hard', hatColor: '#d9d4c8', beard: 0, stubble: 0.95, age: 0.4, hair: '#1e140e', skin: '#a8704c', eyes: '#3a2a1a', seed: 11, dirt: 0.35 });
  scene.add(h.group); HEROES.push(h);
  const take = await loadTake(MOCAP + '56_02.bvh'), clip = take.retarget(heroMap(h.names), h.rig);
  const SD = V3(-0.55, 0.2, 0.82).normalize();       // the sun ahead of him and behind the camera plane's far side: the rim takes the whole profile
  skyDome({ zenith: '#140a14', horizon: '#b8401e', low: '#401008', sunDir: SD, sunCol: '#ff9a50', disc: 0.07, discCol: '#ff4a20' });
  scene.add(new THREE.HemisphereLight('#3a2a40', '#2a1208', 0.35));
  const fill = new THREE.DirectionalLight('#5a6a90', 0.18); scene.add(fill);
  let sunL = null;
  return t => {
    h.applyClip(clip.sample(0.4 + t * 0.2)); h.root.position.x = 0; h.root.position.z = 0; h.update();
    h.rotateWorld('neck02', V3(1, 0, 0), -0.1); h.rotateWorld('head', V3(1, 0, 0), -0.1); h.expr({ brow: 0.45, grit: 0.25 }); h.update();
    const hp = h.joint('head'), c = V3(hp.x, hp.y + 0.1, hp.z + 0.02);
    camera.fov = 22; camera.position.set(c.x + 1.75, c.y - 0.12, c.z + 0.1); camera.up.set(0, 1, 0); camera.lookAt(c.x, c.y - 0.16, c.z + 0.1); camera.updateProjectionMatrix();
    SUN = c.clone().add(SD.clone().multiplyScalar(80));
    if (!sunL) sunL = sunLight(c.clone().add(SD.clone().multiplyScalar(10)), c, { intensity: 6, size: 1.2 });
    fill.position.copy(camera.position).add(V3(0, 0.5, 0));
    // the rim sun sits just in front of the face as seen from the camera: the profile against the disc's edge
    { const aim = c.clone().add(V3(0, 0.02, 0.2)); RIMSUN = camera.position.clone().add(aim.sub(camera.position).normalize().multiplyScalar(200)); }
    BG2D = (g) => { const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#0c0508'); gr.addColorStop(0.55, '#3a0c08'); gr.addColorStop(1, '#120404'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
      const s = project(RIMSUN); sunDisc(g, Math.max(-100, s[0]), s[1], 230, 1); };
    return { check: 'profile', front_lit: frontLit(h, SUN) };
  };
};

S.hand = async data => {
  const h = new Hero(data, { variant: 'forge', height: 1.82, kind: 'flannel', shirt: '#7a1418', shirt2: '#141010', sleeve: 0.32, beard: 0.2, stubble: 0.9, hat: 'none', skin: '#a8704c', dirt: 0.55, seed: 5, age: 0.5 });
  scene.add(h.group);
  // the hammer raised: CMU 56_02 ('fists up'), the right fist at its highest (the take's raised-arm beat at ~21 s)
  const TAKE = Q.get('take') || '56_02', take = await loadTake(MOCAP + TAKE + '.bvh'), clip = take.retarget(heroMap(h.names), h.rig);
  const win = TAKE === '56_02' ? [20.3, 22.2] : [2, 15];
  let best = { y: -1, t: 1 }; for (let t = win[0]; t < Math.min(win[1], take.duration); t += 1 / 30) { const y = take.jointAt('RightHand', t).y - take.jointAt('Hips', t).y; if (y > best.y) best = { y, t }; }
  const T0 = best.t;
  skyDome({ zenith: '#060408', horizon: '#1a0806', low: '#060303', sunDir: V3(-0.6, 0.35, -1), sunCol: '#5a2210', disc: 0.0 });
  const wood = new THREE.MeshStandardMaterial({ color: '#8a5a32', roughness: 0.55 }), steel = new THREE.MeshStandardMaterial({ color: '#4a4c50', roughness: 0.32, metalness: 0.9 });
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.12, 1, 28, 1), wood), head = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1), steel), face = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 24), steel);
  { const u = handle.geometry.attributes.position; for (let i = 0; i < u.count; i++) { const y = u.getY(i); const k = 1 - 0.18 * Math.exp(-Math.pow((y + 0.3) / 0.15, 2)); u.setX(i, u.getX(i) * k); u.setZ(i, u.getZ(i) * (k * 0.85)); } handle.geometry.computeVertexNormals(); }   // an oval, waisted ash handle
  for (const m of [handle, head, face]) { m.castShadow = m.receiveShadow = true; m.userData.subject = 1; scene.add(m); }
  scene.add(new THREE.HemisphereLight('#2a2030', '#301006', 0.25));
  const forge = new THREE.PointLight('#ff7a28', 22, 3, 1.6); forge.castShadow = true; scene.add(forge);
  let sunL = null;
  return t => {
    h.applyClip(clip.sample(T0 + t * 0.1)); h.root.position.x = 0; h.root.position.z = 0; h.update();
    const r = 0.0165, Hn = h.handle('R', r, { tilt: 0.32 }); const g = h.grip('R', Hn); h.update();
    const P = h.palm('R'), d = Hn.d.clone(), n = P.n.clone(), swing = new THREE.Vector3().crossVectors(d, n).normalize();
    // the handle: butt 3 cm past the little finger, head 27 cm out past the thumb; the head's long axis in the swing
    const butt = Hn.p.clone().addScaledVector(d, 0.065), tip = Hn.p.clone().addScaledVector(d, -0.27), mid = butt.clone().add(tip).multiplyScalar(0.5);
    handle.position.copy(mid); handle.scale.set(r, butt.distanceTo(tip), r); handle.quaternion.setFromUnitVectors(V3(0, 1, 0), d.clone().negate());
    head.position.copy(tip).addScaledVector(d, -0.02); head.scale.set(0.046, 0.15, 0.046); head.quaternion.setFromUnitVectors(V3(0, 1, 0), swing);   // an octagonal engineer's head
    face.position.copy(head.position).addScaledVector(swing, 0.076); face.scale.set(0.021, 0.006, 0.021); face.quaternion.setFromUnitVectors(V3(0, 1, 0), swing);
    const c = Hn.p.clone().addScaledVector(d, -0.1);
    const fwd = V3(0, 0, 1).applyQuaternion(h.root.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
    // from in front of the man and below the fist: the fist and the hammer against the dark, the face out of frame
    const vw = (Q.get('vw') || '-0.8,0.1,0.5').split(',').map(Number), sideW = new THREE.Vector3().crossVectors(fwd, V3(0, 1, 0)).normalize();
    const view = fwd.clone().multiplyScalar(vw[0]).add(V3(0, vw[1], 0)).addScaledVector(sideW, vw[2]).normalize();
    camera.fov = 20; camera.position.copy(c).addScaledVector(view, 1.3); camera.up.set(0, 1, 0); camera.lookAt(c); camera.updateProjectionMatrix();
    if (Q.get('dbg') === 'axis') { camera.position.copy(Hn.p).addScaledVector(d, 0.5); camera.lookAt(Hn.p); camera.updateProjectionMatrix(); }
    if (Q.get('dbg') === 'wide') { camera.fov = 40; camera.position.copy(h.joint('spine02')).add(V3(0.5, 0.3, 3)); camera.lookAt(h.joint('spine02')); camera.updateProjectionMatrix(); }
    const sideV = new THREE.Vector3().crossVectors(view, V3(0, 1, 0)).normalize();
    forge.position.copy(c).addScaledVector(sideV, 0.7).add(V3(0, -0.35, 0)).addScaledVector(view, 0.2); forge.intensity = 9;
    SUN = c.clone().add(V3(-0.6, 0.35, -1).normalize().multiplyScalar(60));
    if (!sunL) sunL = sunLight(c.clone().add(V3(-0.6, 0.35, -1).normalize().multiplyScalar(6)), c, { intensity: 5, size: 0.6, color: '#ffd0a0' });
    { const aim = Hn.p.clone().add(V3(0, 0.12, 0)); RIMSUN = camera.position.clone().add(aim.sub(camera.position).normalize().multiplyScalar(300)); }
    BG2D = (g2) => { const gr = g2.createRadialGradient(W * 0.3, H * 0.25, 50, W * 0.3, H * 0.25, H); gr.addColorStop(0, '#3a1206'); gr.addColorStop(1, '#050203'); g2.fillStyle = gr; g2.fillRect(0, 0, W, H); const s = project(RIMSUN); sunDisc(g2, s[0], s[1], 260, 1); };
    h.update(); const k = pxPerM(Hn.p), gaps = Object.fromEntries(Object.entries(g).map(([f, v]) => [f, +(v.gap * k).toFixed(1)]));
    return { check: 'hand', gap_px: gaps, max_gap_px: Math.max(...Object.values(gaps)), pass: Math.max(...Object.values(gaps)) <= 2, hand_frac: +(k * 0.19 / H).toFixed(2), take: TAKE, t: +(T0 + t * 0.1).toFixed(2) };
  };
};

// The climber (cycle 2): one figure, one ladder and two beams that read as structure; the reaching arm is the
// CLIMB_REACH glyph (straight up to the next rung), seen three-quarter from below so the profile breaks the sun
S.climb = async data => {
  const h = new Hero(data, { variant: 'plains', height: 1.84, kind: 'coat', shirt: '#6e5230', trousers: '#2c3444', trouserKind: 3, hat: 'hard', hatColor: '#c8c2b4', beard: 0.5, stubble: 0.9, skin: '#6e4a32', hair: '#0e0a08', seed: 21, dirt: 0.4 });
  scene.add(h.group); HEROES.push(h);
  const take = await loadTake(MOCAP + '13_33.bvh'), clip = take.retarget(heroMap(h.names), h.rig);
  let best = { d: 0, t: 1 }; for (let t = 0.6; t < take.duration - 0.2; t += 1 / 30) { const d = take.jointAt('RightHand', t).y - take.jointAt('LeftHand', t).y; if (Math.abs(d) > Math.abs(best.d)) best = { d, t }; }
  const T0 = best.t;
  const steel = new THREE.MeshStandardMaterial({ color: '#2a2a2e', roughness: 0.5, metalness: 0.7 }), rungM = new THREE.MeshStandardMaterial({ color: '#3a3634', roughness: 0.45, metalness: 0.8 });
  const tower = new THREE.Group(); scene.add(tower);
  const beam = (a, b, r, sub = 0.6) => { const d = b.clone().sub(a), L = d.length(); const me = new THREE.Mesh(new THREE.BoxGeometry(r, L, r * 0.6), steel); me.position.copy(a).add(b).multiplyScalar(0.5); me.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize()); me.castShadow = me.receiveShadow = true; me.userData.subject = sub; tower.add(me); return me; };
  const bar = (a, b, r) => { const d = b.clone().sub(a), L = d.length(); const me = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 20), rungM); me.position.copy(a).add(b).multiplyScalar(0.5); me.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize()); me.castShadow = me.receiveShadow = true; me.userData.subject = 0.8; tower.add(me); return me; };
  let sunL = null, built = false, info = {}, SD = null;
  const LIFT = 3.2;
  scene.add(new THREE.HemisphereLight('#40385a', '#2a1a10', 0.4));
  return t => {
    h.applyClip(clip.sample(T0 + t * 0.3)); h.root.position.y += LIFT; h.update();
    const hi = best.d > 0 ? 'R' : 'L', lo = hi === 'R' ? 'L' : 'R';
    h.gesture(hi, 'CLIMB_REACH', { fist: false });
    const Plo = h.palm(lo), r = 0.019, F = h._body(), side = F.xL.clone(), gp = Plo.palm.clone().addScaledVector(Plo.n, r);
    const gLo = h.grip(lo, { p: gp, d: side, r }); h.update();
    const Phi = h.palm(hi), reachP = Phi.palm.clone().addScaledVector(Phi.n, r);             // the next rung sits in the reaching palm
    const gHi = h.grip(hi, { p: reachP, d: side, r }); h.update();
    const feet = ['L', 'R'].map(s => h.joint(`foot.${s}`));
    if (!built) { built = true;
      // one ladder: two stiles in the plane of the grip bar, rungs every 30 cm through the grip, reach and feet; two I-beams behind
      const c0 = gp.clone(), a = c0.clone().addScaledVector(side, -0.3), b = c0.clone().addScaledVector(side, 0.3);
      for (const q of [a, b]) beam(V3(q.x, 0, q.z), V3(q.x, LIFT + 6, q.z), 0.06);
      const ys = new Set(); for (let y = gp.y % 0.3; y < LIFT + 6; y += 0.3) ys.add(+y.toFixed(3)); ys.add(reachP.y); for (const f of feet) ys.add(f.y - 0.07);
      for (const y of ys) bar(V3(a.x, y, a.z), V3(b.x, y, b.z), r);
      const back = F.fwd.clone().multiplyScalar(-1.8);           // the beams behind the climber, away from the lens
      for (const k of [-2.2, 2.0]) { const q = c0.clone().addScaledVector(side, k).add(back); beam(V3(q.x, 0, q.z), V3(q.x, LIFT + 9, q.z), 0.22, 0.4); }
      const cross = c0.clone().add(back).add(V3(0, 1.6, 0)); beam(cross.clone().addScaledVector(side, -2.4), cross.clone().addScaledVector(side, 2.6), 0.2, 0.4);
      info = { hi, lo, gripGap: gLo, reachGap: gHi };
      SD = F.up.clone().multiplyScalar(0.8).addScaledVector(F.fwd, 0.35).addScaledVector(side, 0.25).normalize();
      skyDome({ zenith: '#0e0a18', horizon: '#d05a28', low: '#401208', sunDir: SD, sunCol: '#ff9040', disc: 0.06, discCol: '#ff3a1a' });
    }
    const c = h.joint('spine02');
    // three-quarter from below, on the climber's open side: the face in profile, the reaching arm against the sun
    const cp = c.clone().addScaledVector(side, hi === 'R' ? -1.9 : 1.9).addScaledVector(F.fwd, 1.9); cp.y = 0.5;   // three-quarter front, through the rungs
    camera.fov = 36; camera.position.copy(cp); camera.up.set(0, 1, 0); camera.lookAt(c.x, c.y + 0.55, c.z); camera.updateProjectionMatrix();
    SUN = c.clone().add(SD.clone().multiplyScalar(80));
    if (!sunL) sunL = sunLight(c.clone().add(SD.clone().multiplyScalar(12)), c, { intensity: 6, size: 5 });
    { const aim = reachP.clone().add(V3(0, 0.25, 0)); RIMSUN = camera.position.clone().add(aim.sub(camera.position).normalize().multiplyScalar(300)); }
    BG2D = (g2) => { const gr = g2.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#0a0610'); gr.addColorStop(0.6, '#3a1008'); gr.addColorStop(1, '#6a1a08'); g2.fillStyle = gr; g2.fillRect(0, 0, W, H); const s = project(RIMSUN); sunDisc(g2, s[0], s[1], 300, 1); };
    const k = pxPerM(gp), gaps = Object.fromEntries(Object.entries(info.gripGap).map(([f, v]) => [f, +(Math.max(0, v.gap) * k).toFixed(1)]));
    return { check: 'climb', take: '13_33', t: +(T0 + t * 0.3).toFixed(2), grip_hand: info.lo, reach_hand: info.hi, gap_px: gaps, gestures: h.gestures(camera, W, H), face: h.faceTier(camera, H) };
  };
};

// The face row (cycle 2): four men with DIRECTED gestures (Deineka: weight planted, chest open, head up, one long line
// from heel to raised fist), not borrowed mocap mid-stride; framed so faces are 200-600 px (the 'planes' tier)
S.face = async data => {
  const cast = [
    { variant: 'forge', kind: 'work', shirt: '#28323e', hat: 'none', beard: 0.6, hair: '#1a120c', skin: '#b07a58', seed: 31, shout: 0.85, turn: 0.75, x: -0.62, z: 0.35, arm: ['R', 'ROTFRONT'] },
    { variant: 'plains', kind: 'coat', shirt: '#6e5230', hat: 'cap', hatColor: '#2a2a2a', beard: 0.0, stubble: 0.9, hair: '#0e0a08', skin: '#5e3a26', seed: 32, shout: 0.5, turn: 1.0, x: 0.35, z: 0.0, arm: ['L', 'OVERHEAD'] },
    { variant: 'heavy', kind: 'flannel', shirt: '#2a4a2a', shirt2: '#101010', hat: 'knit', hatColor: '#6a1414', beard: 0.3, hair: '#6a4a2a', skin: '#c8906a', seed: 33, shout: 0.2, turn: 0.55, x: 1.15, z: -0.7, arm: null },
    { variant: 'forge', kind: 'leather', shirt: '#4a3020', hat: 'hard', hatColor: '#e8c020', beard: 0.0, stubble: 0.6, hair: '#2a1c12', skin: '#8a5a3c', seed: 34, shout: 0.7, turn: 1.2, x: -0.05, z: -1.3, arm: ['R', 'PUMP'] },
  ];
  const heroes = cast.map(o => { const h = new Hero(data, { height: 1.74 + (o.seed % 3) * 0.05, age: 0.3, dirt: 0.3, ...o }); scene.add(h.group); h.o2 = o; HEROES.push(h); return h; });
  const take = await loadTake(MOCAP + '56_02.bvh');
  const clips = heroes.map(h => take.retarget(heroMap(h.names), h.rig));
  const FSD = V3(1, 0.22, -0.55).normalize();
  skyDome({ zenith: '#16101c', horizon: '#c04a22', low: '#3a1006', sunDir: FSD, sunCol: '#ffa050', disc: 0.05, discCol: '#ff5020' });
  scene.add(new THREE.HemisphereLight('#6a5a78', '#3a1a0c', 0.7));
  ground({ color: '#4a2e1c' });
  if (MODE === 'lit') { const key = new THREE.DirectionalLight('#ffd2a0', 3.2); key.position.set(6, 2.6, 1.2); key.target.position.set(0.2, 1.5, -0.3); scene.add(key, key.target); }   // lit: a raking key from the side (Rembrandt), the sun stays behind
  let sunL = null;
  return t => {
    heroes.forEach((h, i) => { const o = h.o2; h.applyClip(clips[i].sample(0.35 + i * 0.05)); h.root.position.x = 0; h.root.position.z = 0;
      h.cancelYaw(); h.group.position.set(o.x, 0, o.z); h.group.rotation.y = o.turn; h.update();
      const lat = V3(1, 0, 0).applyAxisAngle(V3(0, 1, 0), h.group.rotation.y);
      h.rotateWorld('spine02', lat, -0.06); h.rotateWorld('neck01', lat, -0.1); h.rotateWorld('head', lat, -0.12 - 0.08 * o.shout); h.update();   // chest open, head up
      if (o.arm) h.gesture(o.arm[0], o.arm[1], { p: 0.4 + 0.5 * Math.sin(t * 3 + i), fistScale: 1.12 });
      for (const sd of ['L', 'R']) if (!o.arm || o.arm[0] !== sd) h.relaxHand(sd, 1.1);
      h.expr({ shout: o.shout * (0.85 + 0.15 * Math.sin(t * 4 + i)), brow: 0.5 + 0.4 * o.shout, squint: 0.3 }); h.update(); });
    const c = V3(0.2, 1.5, -0.3);
    camera.fov = 24; camera.position.set(-1.6, 1.25, 4.9); camera.up.set(0, 1, 0); camera.lookAt(c.x + 0.1, c.y - 0.05, c.z); camera.updateProjectionMatrix();
    SUN = c.clone().add(FSD.clone().multiplyScalar(90));
    if (!sunL) sunL = sunLight(c.clone().add(FSD.clone().multiplyScalar(12)), c, { intensity: 7, size: 3 });
    { const aim = V3(1.2, 2.0, -1.2); RIMSUN = camera.position.clone().add(aim.sub(camera.position).normalize().multiplyScalar(300)); }
    BG2D = (g2) => { const gr = g2.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#0c0608'); gr.addColorStop(0.62, '#4a1208'); gr.addColorStop(1, '#140604'); g2.fillStyle = gr; g2.fillRect(0, 0, W, H); const s = project(RIMSUN); sunDisc(g2, s[0], s[1], 190, 1); };
    const fl = heroes.map(h => frontLit(h, SUN));
    return { check: 'face', front_lit: fl, any_front_lit: fl.some(v => v > 0.3), faces: heroes.map(h => h.faceTier(camera, H)), shouts: cast.map(o => o.shout), gestures: heroes.flatMap(h => h.gestures(camera, W, H)), salute_flags: heroes.flatMap(h => h.gestures(camera, W, H)).filter(g => g.flags.length).length };
  };
};

// The garment test (cycle 2): two men side-on and one front-on, drawn as masks: the body alone vs clothed, the gap
// between the two outlines coloured by its size (red under 1 cm, yellow 1-2 cm, green over 2 cm) below the chest.
// The hang rule should leave no pectoral, navel or buttock contour in the clothed silhouette.
S.garment = async data => {
  const cast = [{ variant: 'heavy', kind: 'flannel', shirt: '#2a4a2a', hat: 'none', x: -0.55, turn: Math.PI / 2 }, { variant: 'forge', kind: 'work', shirt: '#28323e', hat: 'none', x: 0.1, turn: -Math.PI / 2 }, { variant: 'plains', kind: 'coat', shirt: '#6e5230', hat: 'none', x: 0.75, turn: 0 }];
  const heroes = cast.map((o, i) => { const h = new Hero(data, { height: 1.8, seed: 40 + i, ...o }); scene.add(h.group); h.o2 = o; HEROES.push(h); return h; });
  const take = await loadTake(MOCAP + '56_02.bvh'), clips = heroes.map(h => take.retarget(heroMap(h.names), h.rig));
  scene.add(new THREE.HemisphereLight('#ffffff', '#444444', 1));
  return t => {
    heroes.forEach((h, i) => { h.applyClip(clips[i].sample(0.35)); h.root.position.x = 0; h.root.position.z = 0; h.cancelYaw(); h.group.position.set(h.o2.x, 0, 0); h.group.rotation.y = h.o2.turn; h.update(); for (const sd of ['L', 'R']) h.relaxHand(sd); });
    camera.fov = 26; camera.position.set(0.1, 1.0, 7.6); camera.up.set(0, 1, 0); camera.lookAt(0.1, 1.0, 0); camera.updateProjectionMatrix();
    return { check: 'garment' };
  };
};
function renderGarment(t) {
  const info = sub(t) || {};
  fpPatchScene(scene);
  const clothed = (fp.read(scene, camera), fp.mask(true));
  const cloth = []; for (const h of HEROES) for (const k of ['top', 'bottom']) if (h.cloth[k]) { h.cloth[k].visible = false; cloth.push(h.cloth[k]); }
  const body = (fp.read(scene, camera), fp.mask(true)); for (const m of cloth) m.visible = true;
  const w = fp.w, hh = fp.h, A = clothed.getContext('2d').getImageData(0, 0, w, hh).data, Bm = body.getContext('2d').getImageData(0, 0, w, hh).data;
  const c = document.createElement('canvas'); c.width = w; c.height = hh; const g = c.getContext('2d'), im = g.createImageData(w, hh), D = im.data;
  const ppm = pxPerM(V3(0.1, 1.0, 0)) * w / W;          // mask px per metre at the figures
  const chestY = project(V3(0, 1.3, 0))[1] * hh / H, stats = [];
  for (let y = 0; y < hh; y++) {
    // per row: every clothed run and the body run inside it; the gap at each end, in cm
    let x = 0;
    while (x < w) { while (x < w && !A[(y * w + x) * 4 + 3]) x++; const x0 = x; while (x < w && A[(y * w + x) * 4 + 3]) x++; const x1 = x - 1; if (x0 >= w) break;
      let b0 = -1, b1 = -1; for (let k = x0; k <= x1; k++) if (Bm[(y * w + k) * 4 + 3]) { if (b0 < 0) b0 = k; b1 = k; }
      for (let k = x0; k <= x1; k++) { const i = (y * w + k) * 4, inB = Bm[i + 3] > 0; if (inB) { D[i] = 70; D[i + 1] = 70; D[i + 2] = 80; D[i + 3] = 255; continue; }
        const gap = b0 < 0 ? 99 : (k < b0 ? b0 - x0 : x1 - b1) / ppm * 100, below = y > chestY;
        const col = !below ? [200, 200, 200] : gap < 1 ? [230, 40, 30] : gap < 2 ? [240, 200, 40] : [60, 220, 90]; D[i] = col[0]; D[i + 1] = col[1]; D[i + 2] = col[2]; D[i + 3] = 255;
        if (below && b0 >= 0) stats.push(gap); }
    }
  }
  g.putImageData(im, 0, 0);
  ctx.fillStyle = '#101014'; ctx.fillRect(0, 0, W, H); ctx.imageSmoothingEnabled = false; ctx.drawImage(c, 0, 0, W, H);
  stats.sort((a, b) => a - b);
  const q = p => stats.length ? +stats[Math.floor(p * (stats.length - 1))].toFixed(2) : null;
  const sh = f => +(stats.filter(f).length / Math.max(1, stats.length)).toFixed(2);
  return { ...info, standoff_cloth_px_below_chest: { under_1cm: sh(g => g < 1), cm_1_2: sh(g => g >= 1 && g < 2), over_2cm: sh(g => g >= 2), px: stats.length } };
}

S.crowd = async () => {
  const N = +(Q.get('n') || 200), r = rng(77), LAY = Q.get('layout') || 'wall';
  const walkers = ['02_01', '05_01', '06_01', '07_01', '08_01', '12_01', '16_15', '26_01', '35_01', '38_01', '45_01', '46_01', '49_01', '17_08', '17_01', '20_06'];
  const takes = LAY === 'column' ? await Promise.all(walkers.map(k => loadTake(MOCAP + k + '.bvh', { travel: true }))) : [];
  const clips = takes.map(tk => tk.retarget(PEOPLE_MAP, People.RIG));
  const folk = new People(scene, { max: N + 8, viewH: H, lodPx: [240, 70], budget: [40, 220], shadows: 'proxy' });
  // camera and sun per layout
  const CAM = { wall: { fov: 32, pos: V3(0.3, 1.62, 14), look: V3(0, 1.05, -12) }, sea: { fov: 46, pos: V3(0, 1.45, 4.6), look: V3(0, 1.95, -6) }, column: { fov: 18, pos: V3(0.4, 1.9, 16), look: V3(0, 1.6, -30) } }[LAY];
  const SUND = { wall: V3(0.05, 0.07, -1), sea: V3(0.06, 0.1, -1), column: V3(0.02, 0.035, -1) }[LAY].normalize();
  camera.fov = CAM.fov; camera.position.copy(CAM.pos); camera.up.set(0, 1, 0); camera.lookAt(CAM.look); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  const fpx = H / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  const pxAt = (x, z) => 1.75 * fpx / Math.hypot(x - CAM.pos.x, 1 - CAM.pos.y, z - CAM.pos.z);
  // positions
  let lay;
  if (LAY === 'wall') {       // two blocks either side of an aisle, a dense front rank 6-9 m out, looser to 45 m
    // fill the lens's frustum from 3 m to 30 m, no aisle: one mass whose top edge is heads, fists, poles and tools
    const rr = rng(9); lay = [];
    for (let tries = 0; lay.length < N && tries < 40000; tries++) {
      const d = 4.6 + 26 * Math.pow(rr(), 1.25), half = 0.34 * d * 0.5 + 0.4, x = CAM.pos.x + (rr() * 2 - 1) * half, z = CAM.pos.z - d;
      if (lay.every(p => (p.x - x) ** 2 + (p.z - z) ** 2 > 0.5 * 0.5)) lay.push({ x, z });
    }
  } else if (LAY === 'sea') { // the mass from 5 m to the horizon, very dense; the heroes placed separately
    lay = People.crowdLayout(N - 5, { width: 5, depth: 24, z0: 0.2, seed: 12, clump: 0.95, minGap: 0.42 }).map(p => ({ ...p, x: p.x * (0.7 + 0.08 * (0.2 - p.z)) }));
    lay.push({ x: -0.5, z: 2.7, hero: 'OVERHEAD' }, { x: 0.45, z: 2.5, hero: 'ROTFRONT' }, { x: -0.02, z: 2.0, hero: 'OVERHEAD' }, { x: -0.9, z: 1.7, hero: 'ROTFRONT' }, { x: 0.85, z: 1.5, hero: 'OVERHEAD' });
  } else {                    // a column 7 m wide walking away down a road toward the sun
    lay = People.crowdLayout(N, { width: 7, depth: 60, z0: 2, seed: 5, clump: 0.8, minGap: 0.55 });
  }
  const ids = [], raiseMax = Math.floor(N * 0.3); let raised = 0;
  const props = [];            // { id, kind: 'pole'|'tool', mesh... }
  const poleMat = new THREE.MeshStandardMaterial({ color: '#3a2a1a', roughness: 0.8 }), steel = new THREE.MeshStandardMaterial({ color: '#3a3c40', roughness: 0.4, metalness: 0.8 });
  const bannerAt = LAY === 'wall' ? [[-1.6, 1.5], [2.0, -2.5], [-2.8, -9]] : LAY === 'column' ? [[-1.2, -6], [1.8, -14], [-0.4, -26]] : [[-2.5, -6], [3.2, -10]];
  const bannerIds = new Set();
  for (const [bx, bz] of bannerAt) { let best = -1, bd = 1e9; lay.forEach((p, i) => { if (p.hero) return; const d = (p.x - bx) ** 2 + (p.z - bz) ** 2; if (d < bd && !bannerIds.has(i)) { bd = d; best = i; } }); bannerIds.add(best); }
  lay.forEach((p, i) => {
    const trade = TRADES[Math.floor(r() * 5)], d = People.varied(trade, 500 + i);
    const id = folk.add(d), roll = r(), face = Math.PI + (r() - 0.5) * (LAY === 'wall' ? 0.9 : 0.35);        // faces and fists toward the light, backs and three-quarters to the lens
    const st = { x: p.x, z: p.z, heading: face, act: 'stand', t: r() * 20, off: r() * 20 };
    if (LAY === 'column') { const k = Math.floor(r() * clips.length); Object.assign(st, { act: 'clip', clip: clips[k], loop: true, twos: true, rootMotion: true, heading: Math.PI + (r() - 0.5) * 0.12, ct: r() * 20 }); }
    const px = pxAt(p.x, p.z), side = r() < 0.7 ? -1 : 1;
    if (p.hero) { st.gesture = { name: p.hero, side: p.hero === 'PUMP' ? -1 : (p.x < 0 ? 1 : -1), p: 0.9 }; st.act = 'stand'; st.heading = Math.PI + (p.x < 0 ? -0.25 : 0.25); raised++; }
    else if (bannerIds.has(i)) { st.gesture = [{ name: 'BANNER_TOP', side: -1 }, { name: 'BANNER_LOW', side: 1 }]; st.banner = true; }
    else if (roll < 0.34 && raised < raiseMax && (LAY !== 'column' || roll < 0.12)) {
      // the glyph by size on screen: far ranks raise vertical arms only (a bent forearm is unreadable there)
      const name = px < 60 ? 'OVERHEAD' : px < 140 ? (r() < 0.5 ? 'OVERHEAD' : 'ROTFRONT') : ['ROTFRONT', 'OVERHEAD', 'PUMP'][Math.floor(r() * 3)];
      st.gesture = { name, side, p: r() }; raised++;
    } else if (roll < 0.46) { st.gesture = { name: 'SHOULDER_TOOL', side }; st.tool = r() < 0.5 ? 'sledge' : 'shovel'; }
    if (st.act === 'stand' && r() < 0.15) st.look = (r() - 0.5) * 0.8;
    folk.set(id, st); ids.push(id);
  });
  // props: banner poles and cloth, tools on the shoulder
  for (const id of ids) { const st = folk.get(id);
    if (st.banner) { const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 1, 8), poleMat), cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9, 20, 10), new THREE.MeshStandardMaterial({ color: '#b01010', roughness: 0.7, side: THREE.DoubleSide }));
      for (const m of [pole, cloth]) { m.castShadow = true; m.userData.subject = 1; scene.add(m); } cloth.userData.rimSelf = '#c01008'; cloth.userData.base = cloth.geometry.attributes.position.array.slice();
      props.push({ id, kind: 'banner', pole, cloth }); }
    else if (st.tool) { const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 1, 8), poleMat), head = new THREE.Mesh(st.tool === 'sledge' ? new THREE.BoxGeometry(0.07, 0.07, 0.2) : new THREE.BoxGeometry(0.24, 0.3, 0.02), steel);
      for (const m of [handle, head]) { m.castShadow = true; m.userData.subject = 1; scene.add(m); } props.push({ id, kind: 'tool', handle, head, tool: st.tool }); }
  }
  const sky = { wall: { zenith: '#1a0c10', horizon: '#e0602a', low: '#5a2010' }, sea: { zenith: '#241018', horizon: '#e87a3a', low: '#5a2412' }, column: { zenith: '#1a1020', horizon: '#f08040', low: '#5a2010' } }[LAY];
  skyDome({ ...sky, sunDir: SUND, sunCol: '#ffb060', disc: LAY === 'column' ? 0.05 : 0.03, discCol: '#ff6a30' });
  scene.fog = new THREE.Fog('#b8603a', LAY === 'column' ? 40 : 30, LAY === 'column' ? 160 : 120);
  scene.add(new THREE.HemisphereLight('#6a5a78', '#3a2012', 0.55));
  ground({ color: '#6a4428' });
  for (const m of folk.meshes) m.userData.subject = 1;
  let sunL = null, fixed = null;
  const place = t => {
    for (const P of props) { const st = folk.get(P.id);
      if (P.kind === 'banner') { const lo = folk.gripPos(P.id, 1), hi = folk.gripPos(P.id, -1), d = hi.clone().sub(lo).normalize(); if (d.y < 0.5) d.set(0, 1, 0);
        const b0 = lo.clone().addScaledVector(d, -0.9), top = hi.clone().addScaledVector(d, 2.3), L = b0.distanceTo(top);
        P.pole.position.copy(b0).add(top).multiplyScalar(0.5); P.pole.scale.set(1, L, 1); P.pole.quaternion.setFromUnitVectors(V3(0, 1, 0), top.clone().sub(b0).normalize());
        const a = P.cloth.geometry.attributes.position, b = P.cloth.userData.base;
        for (let i = 0; i < a.count; i++) { const u = (b[i * 3] + 0.7) / 1.4, vv = b[i * 3 + 1]; a.array[i * 3] = b[i * 3] * (1 - 0.12 * u * Math.sin(u * 3 - t * 4) ** 2); a.array[i * 3 + 1] = vv - u * u * 0.14; a.array[i * 3 + 2] = b[i * 3 + 2] + Math.sin(u * 6.5 - t * 6 + P.id + vv * 1.5) * 0.3 * u + Math.sin(u * 13 - t * 10) * 0.06 * u; }
        a.needsUpdate = true; P.cloth.geometry.computeVertexNormals(); P.cloth.position.copy(top).add(V3(0.72, -0.46, 0)); P.cloth.rotation.y = 0.5 * Math.sin(P.id); }
      else { const s = st.gesture.side, g = folk.gripPos(P.id, s), at = folk.att[P.id], sh = at.arm[s > 0 ? 0 : 1].S.clone().add(V3(0, 0.06, 0));
        const d = sh.clone().sub(g).normalize(), back = g.clone().addScaledVector(d, 0.95), front = g.clone().addScaledVector(d, -0.12), L = back.distanceTo(front);
        P.handle.position.copy(back).add(front).multiplyScalar(0.5); P.handle.scale.set(1, L, 1); P.handle.quaternion.setFromUnitVectors(V3(0, 1, 0), d);
        P.head.position.copy(back); P.head.quaternion.setFromUnitVectors(V3(0, 0, 1), d); if (P.tool === 'shovel') P.head.position.addScaledVector(d, 0.12); }
    }
  };
  return t => {
    for (const id of ids) { const st = folk.get(id); if (st.act === 'clip') folk.set(id, { ct: t + st.off, t }); else folk.set(id, { t: t + st.off }); }
    camera.fov = CAM.fov; camera.position.copy(CAM.pos); camera.up.set(0, 1, 0); camera.lookAt(CAM.look); camera.updateProjectionMatrix();
    if (!fixed) fixed = folk.fixHazards(camera, W, H, { tries: 24, seed: 5 });
    folk.update(camera); place(t);
    SUN = CAM.pos.clone().add(SUND.clone().multiplyScalar(900));
    if (!sunL) sunL = sunLight(V3(0, 0, -20).add(SUND.clone().multiplyScalar(60)), V3(0, 0, -15), { intensity: 5, size: 40, map: 4096 });
    RIMSUN = SUN;
    BG2D = (g2) => { const gr = g2.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#0e0810'); gr.addColorStop(0.5, '#5a1a0a'); gr.addColorStop(0.64, '#8a3010'); gr.addColorStop(1, '#1a0806'); g2.fillStyle = gr; g2.fillRect(0, 0, W, H); const s = project(SUN); sunDisc(g2, s[0], s[1], LAY === 'column' ? 210 : 150, 1); };
    const haz = folk.hazards(camera, W, H), gs = folk.gestures(camera, W, H);
    const flagged = gs.filter(g => g.flags.length);
    const sig = new Map(); let readable = 0;
    for (const id of ids) { const st = folk.get(id), d = st.d, px = folk._px[id]; if (px < 90) continue; readable++;
      const key = [d.trade, d.hat ? 'hat' : 'bare' + d.hairStyle, d.beard ? 'b' : '', Math.round(d.h * 20), Math.round(d.heavy * 3), st.act, JSON.stringify(st.gesture || '')].join('|');
      sig.set(key, (sig.get(key) || 0) + 1); }
    window.gestureList = gs;
    return { check: 'crowd', layout: LAY, n: N, raised_arms: gs.length, raised_people: raised, salute_flags: flagged.length, flag_kinds: [...new Set(flagged.flatMap(g => g.flags))], min_fist_px: gs.length ? Math.min(...gs.map(g => g.fistPx)) : null,
      max_interior_in_band: Math.max(0, ...gs.filter(g => g.elev >= 10 && g.elev <= 75).map(g => g.interior)), hazards: haz.length, hazard_rounds: fixed.rounds, readable, max_identical_readable: Math.max(0, ...sig.values()), lod: folk.stats.drawn,
      pass: flagged.length === 0 && haz.length === 0, gestures: gs.map(g => ({ id: g.id, name: g.name, hand: g.hand, elbow: g.elbow, interior: g.interior, elev: g.elev, faDev: g.faDev, fistPx: g.fistPx, px: g.px, flags: g.flags })) };
  };
};

// ---------------------------------------------------------------- the rider (2D: Muybridge rotoscope + Reiniger cut-out)
S.rider = async () => {
  const G = await loadGallop(); await loadGallopPhoto();
  const rank = [{ x: 250, y: 1230, s: 0.42, face: 1, kind: 'fist', off: 0.37, seed: 2 }, { x: 640, y: 1205, s: 0.37, face: 1, kind: 'reins', off: 0.71, seed: 3 }, { x: 930, y: 1190, s: 0.33, face: 1, kind: 'flag', off: 0.18, seed: 4 }];
  const hero = { x: 560, y: 1500, s: 0.8, face: 1, kind: 'flag', seed: 1 };
  const STRIDE = 0.5;          // s per stride: 15 Muybridge frames on ones at 30 fps (a race gallop is ~0.43 s)
  return { twoD: true, G, frame: t => { const ph = t / STRIDE; return { R: riderFrame(G, ph, hero), back: rank.map(P => riderFrame(G, ph + P.off, P)) }; } };
};

// ---------------------------------------------------------------- run
let pr = null, fp = null, sub = null, twoD = false;
async function setup() {
  const data = (SUBJ === 'crowd' || SUBJ === 'rider') ? null : await loadHeroData();
  sub = await S[SUBJ](data);
  if (sub && sub.twoD) twoD = true;
  else { fpPatchScene(scene); fp = new FigurePass(renderer, W / 2, H / 2); }
  if (MODE === 'print' || MODE === 'halftone') { pr = new Print(); pr.preload(['cream', 'newsprint']); }
  window.__lab = { scene, camera, renderer, subject: SUBJ, get fp() { return fp; } };     // LOOKS c1: read-only handle for the looks source bake (videos/scripts/looks_bake.mjs)
  window.sceneReady = true;
}
const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H; const tg = tmp.getContext('2d');

function render3D(t) {
  const info = sub(t) || {};
  fpPatchScene(scene);            // meshes built lazily on the first frame get the patch too (idempotent)
  ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none'; ctx.globalAlpha = 1;
  if (MODE === 'lit') { renderer.render(scene, camera); ctx.drawImage(glc, 0, 0); }
  else if (MODE === 'rim') {
    BG2D(ctx, t);
    fp.read(scene, camera); const mask = fp.mask(true);
    haloFrom(ctx, mask, { blur: 36, alpha: 0.75 });
    const hidden = []; scene.traverse(o => { if (o.isMesh && o.userData.rim === false && o.visible) { o.visible = false; hidden.push(o); } });
    fp.rim(scene, camera, { light: RIMSUN || SUN, ...RIM, ...(SUBJ === 'crowd' ? { bump: 0.25, wrapK: 0.05, bounce: 0.012 } : {}) }); for (const o of hidden) o.visible = true;
    ctx.drawImage(glc, 0, 0);
    dust(ctx, t, 90, 7, 0.55, -1, H * 0.45, H);
  } else {
    // PRINT: an engraver works from a modelled light, not a silhouette: a soft key from the front-left above,
    // the sun kept as the rim
    const key = new THREE.DirectionalLight('#fff4e8', 2.6), fw = new THREE.Vector3(); camera.getWorldDirection(fw);
    const tgt = camera.position.clone().addScaledVector(fw, 3), left = new THREE.Vector3().crossVectors(camera.up, fw).normalize();
    key.position.copy(camera.position).addScaledVector(left, 2.5).add(V3(0, 2.5, 0)); key.target.position.copy(tgt); scene.add(key, key.target);
    const hemi = new THREE.HemisphereLight('#e8e0d8', '#3a3028', 0.6); scene.add(hemi);
    renderer.render(scene, camera); scene.remove(key, key.target, hemi);
    const aux = fp.read(scene, camera);
    const steps = MODE === 'halftone' ? [['halftone', { cell: 9, kOnly: 1, space: 'uv', misreg: 0 }]] : [PRESS];
    pr.render(ctx, glc, steps, { t, paper: MODE === 'halftone' ? 'newsprint' : PAPER, aux, prep: { subject: 'aux', clear: 0.55, contrast: 0.7, subjMax: SUBJ === 'crowd' ? 0.55 : 1 }, out: null });
    if (MODE === 'print' && Q.get('ink') !== '0') for (const h of HEROES) { const ft = h.faceTier(camera, H); if (ft.px < 160) continue; inkFace(ctx, h.inkStrokes(camera, W, H, { shout: h.o2?.shout || 0 }), ft.px); }
  }
  return info;
}
// the face's ink strokes over the print: a swelling, tapering brush line per stroke (ink), paper-white catchlights
function inkFace(g, strokes, facePx) {
  g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
  for (const S0 of strokes) { const P = S0.pts; if (P.length < 2) continue;
    if (S0.ink === 'paper') { g.fillStyle = '#f4ecd8'; const r = Math.max(1.2, S0.w * 0.9); g.beginPath(); g.arc(P[0][0], P[0][1], r, 0, Math.PI * 2); g.fill(); continue; }
    g.fillStyle = S0.kind === 'socket' ? 'rgba(26,20,16,0.35)' : '#1a1410';
    const L = [], R2 = [];          // a filled ribbon: the width swells to the middle and tapers to both ends
    for (let i = 0; i < P.length; i++) { const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      const u = i / (P.length - 1), w = S0.w * (0.25 + 0.75 * Math.sin(Math.PI * u)) * 0.5; L.push([P[i][0] - dy / l * w, P[i][1] + dx / l * w]); R2.push([P[i][0] + dy / l * w, P[i][1] - dx / l * w]); }
    g.beginPath(); g.moveTo(...L[0]); for (const q of L.slice(1)) g.lineTo(...q); for (const q of R2.reverse()) g.lineTo(...q); g.closePath(); g.fill(); }
  g.restore();
}
function render2D(t) {
  // cycle 2: the horde, not three riders. RIM = the HORDE grammar; PRINT = key + red block with white keylines through
  // print.js's woodcut; LIT is retired (egg-headed dolls on a camouflage horse) and replaced by DAY, flat cut-outs in
  // a dusty daylight with a controlled rim. ?n= riders (default 44), ?travel= m/s of the camera move.
  const n = +(Q.get('n') || 44), travel = +(Q.get('travel') || 9), H0 = { lit, sunDisc, dust };
  let info;
  if (MODE === 'print' || MODE === 'halftone') {
    info = drawHorde(tg, sub.G, t, { mode: 'print', n, travel, ...H0 });
    pr.render(ctx, tmp, MODE === 'halftone' ? [['halftone', { cell: 10, kOnly: 1, misreg: 0 }]] : [['woodcut', { pitch: 9, contour: 1, two: 1, ink2: 'acp', t1: 0.3, t2: 0.72, grain: 0.15, lino: 1, jag: 0.6 }]], { t, paper: MODE === 'halftone' ? 'newsprint' : 'cream', prep: { simplify: 6, levels: 'auto' }, out: null });
  } else info = drawHorde(ctx, sub.G, t, { mode: MODE === 'lit' ? 'day' : 'rim', n, travel, ...H0 });
  return { check: 'rider', ...info, travel_mps: travel, source: 'Muybridge race horse, 15 frames; 4 cut-out rider designs' };
}
// 2.5D relief lighting of an albedo canvas (alpha = coverage)
function relief(g, src, t, sun) {
  const w = W / 2, h = H / 2, c = document.createElement('canvas'); c.width = w; c.height = h; const cg = c.getContext('2d');
  cg.drawImage(src, 0, 0, w, h); const A = cg.getImageData(0, 0, w, h).data;
  const hc = document.createElement('canvas'); hc.width = w; hc.height = h; const hg = hc.getContext('2d');
  const Hh = new Float32Array(w * h);
  for (const [b, k] of [[3, 0.35], [8, 0.35], [18, 0.3]]) { hg.clearRect(0, 0, w, h); hg.filter = `blur(${b}px)`; hg.drawImage(c, 0, 0); const d = hg.getImageData(0, 0, w, h).data; for (let i = 0; i < w * h; i++) Hh[i] += k * d[i * 4 + 3] / 255; }
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#1a1018'); gr.addColorStop(0.5, '#8a3a1a'); gr.addColorStop(0.72, '#c86a30'); gr.addColorStop(1, '#3a1a10'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  sunDisc(g, sun[0], sun[1], 260, 0.8);
  const o = cg.createImageData(w, h), D = o.data, nl = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
  const K = nl([-0.55, -0.35, 0.76]), Sd = nl([(sun[0] / 2 - w / 2) / w, (sun[1] / 2 - h / 2) / h, -0.55]);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x; if (A[i * 4 + 3] < 5) continue;
    const dx = (Hh[i + 1] - Hh[i - 1]) * 9, dy = (Hh[i + w] - Hh[i - w]) * 9, n = nl([-dx, -dy, 1]);
    const key = Math.max(0, n[0] * K[0] + n[1] * K[1] + n[2] * K[2]), rimv = Math.pow(Math.max(0, n[0] * Sd[0] + n[1] * Sd[1] + n[2] * Sd[2]), 2) * (1 - n[2]) * 2.2;
    const amb = 0.18 + 0.12 * (1 - y / h);
    for (let c2 = 0; c2 < 3; c2++) { const al = A[i * 4 + c2] / 255, kc = [1.0, 0.62, 0.36][c2], rc = [1.0, 0.55, 0.3][c2]; D[i * 4 + c2] = Math.min(255, 255 * (al * (amb + key * 1.25 * kc) + rimv * rc * 0.8)); }
    D[i * 4 + 3] = A[i * 4 + 3];
  }
  cg.putImageData(o, 0, 0); g.drawImage(c, 0, 0, W, H);
  dust(g, t, 80, 5, 0.5, -1, H * 0.6, H);
}

window.renderFrame = t => { const info = twoD ? render2D(t) : SUBJ === 'garment' ? renderGarment(t) : render3D(t); window.labInfo = info; return info; };
setup().catch(e => { console.error(e.stack || e.message); window.sceneError = String(e.message); });
