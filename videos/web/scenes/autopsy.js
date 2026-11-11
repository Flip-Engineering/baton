// AUTOPSY v2 (8 Oct 2026; v1 4 Oct, concepts_20261004 #5). Haz Al-Din's reply to a critic's "autopsy" of the Party (Communism in the
// post-MAGA Age, 2026; research/sources/texts/haz-postmaga-00.txt and -05.txt), verbatim. A morgue table under a sheet; the deadpan
// ("even I was completely unaware of any crisis facing the Party"); the map lighting a chapter in almost every state (the record the
// critic skipped); back to the table: "in the middle of your 'autopsy,' the 'corpse' began moving a little bit": the hand hanging from
// under the sheet twitches, closes, and the arm comes up out of the sheet as a fist; LIVING, ACTIVE, AND GROWING. over the country.
// Label caution (concepts #5): the critic is not named and the critic's label stays off the screen. Credit in the client's approved form.
// v2 (client, 8 Oct: v1's sheet read as a lumpy blob, its fist as a grey growth, its night map as specks): the body is the HUMAN studio's
// hero.js (MakeHuman hm08, a worker in his work clothes) laid on the steel; the sheet is a cloth (lib/fx/cloth.js) dropped over him and
// settled, which stirs when he breathes and is lifted off the arm as it comes up; the map is the engraved relief on cream (as ORE TO ORBIT)
// with every chapter an ink stamp; the type is the shared bands.js. 60 BPM: beats = seconds.
// v2 hold (farm 1008-084654): the trousers' thighs stood through the sheet as two round patches and the sheet sagged into a trough between
// the boots (with the patches, the face of a ghost); the sheet now rests on the clothed body's own height field, tents across the toes and
// falls over the foot of the steel; the fist is shut before the raise (to Bridgman, thumb across); the land of the map is the plain engraving;
// the dashed L on the hanging sleeve (the shirt bump's hard elbow gate) is gone; the drawn sheet's folded-back shards by his left shin are relaxed.
import * as THREE from 'three';
import { W, H, loadFonts, outCanvas, Finish, closer, clamp, lerp, ease } from '../lib/kit.js';
import { loadGeo, USMap } from '../lib/fx/maps.js';
import { Print } from '../lib/fx/print.js';
import { loadHeroData, Hero } from '../lib/fx/hero.js';
import { Cloth, heightField } from '../lib/fx/cloth.js';
import { loadBands, cueType, FONT, STOCK, INK, HRED } from '../lib/fx/bands.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const ctx = outCanvas();
await loadFonts(); await loadBands();
const finish = new Finish(2026);
const H01 = x => { const s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const E = ease.inOutCubic;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export const TL = { title: 0, autopsy: 2.4, unaware: 4.6, crisis: 7.0, map: 9.4, booming: 9.4, activity: 11.6, states: 13.8, organizing: 18.0, table: 21.6, corpse: 24.6, moving: 26.4, fist: 28.4, living: 30.6, mark: 38, end: 42 };

// ------------------------------------------------------------------ the morgue (three.js)
const glc = document.createElement('canvas'); glc.width = W; glc.height = H;
const renderer = new THREE.WebGLRenderer({ canvas: glc, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H, false); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0; renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#0b0e0e'); scene.fog = new THREE.Fog('#0b0e0e', 8, 22);
const camera = new THREE.PerspectiveCamera(40, W / H, 0.05, 100);
scene.add(new THREE.HemisphereLight('#bfe3dc', '#1a1c1a', 0.42));
const tube = new THREE.SpotLight('#e4fff6', 26, 12, 0.8, 0.6, 1.4); tube.position.set(0.1, 3.2, -0.1); tube.target.position.set(0.1, 0.9, -0.1); tube.castShadow = true;
tube.shadow.mapSize.set(2048, 2048); tube.shadow.radius = 4; tube.shadow.bias = -0.0004; tube.shadow.normalBias = 0.02; scene.add(tube, tube.target);   // normalBias: the sheet's own
// shadow stepped in contour bands over its folds in the close-ups (acne); 2 cm along the normal, about nine texels of the 2048 map at the table
const fill = new THREE.DirectionalLight('#9fc8c0', 0.35); fill.position.set(3, 1.6, 2.5); scene.add(fill);      // a cold bounce from the camera side, so the hanging hand reads
const tex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const T = new THREE.CanvasTexture(c); T.colorSpace = THREE.SRGBColorSpace; T.anisotropy = 8; return T; };
const tiles = tex(512, 512, (g, w, h) => { g.fillStyle = '#9fb2ac'; g.fillRect(0, 0, w, h); g.strokeStyle = '#6f7f7a'; g.lineWidth = 4; for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, h); g.stroke(); g.beginPath(); g.moveTo(0, i * 64); g.lineTo(w, i * 64); g.stroke(); } });
tiles.wrapS = tiles.wrapT = THREE.RepeatWrapping; tiles.repeat.set(4, 2);
{ const wall = new THREE.Mesh(new THREE.PlaneGeometry(12, 4), new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.4 })); wall.position.set(0, 2, -3.5); wall.receiveShadow = true; scene.add(wall);
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(12, 12).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#4a524f', roughness: 0.35, metalness: 0.1 })); fl.receiveShadow = true; scene.add(fl);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.06, 1.6), new THREE.MeshBasicMaterial({ color: '#f0fff8' })); lamp.position.set(0.1, 3.25, -0.1); scene.add(lamp);
  const dm = new THREE.MeshStandardMaterial({ color: '#b8bec0', roughness: 0.3, metalness: 0.8 });
  for (let r = 0; r < 3; r++) for (let c = -2; c <= 2; c++) { const d = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.06), dm); d.position.set(c * 1.0, 0.6 + r * 0.85, -3.46); scene.add(d); } }
// the table: a steel slab on a pedestal, a drain lip
const TOP = 0.91;
const steel = new THREE.MeshStandardMaterial({ color: '#c4cacd', roughness: 0.25, metalness: 0.9 });
{ const top = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.06, 2.2), steel); top.position.y = TOP - 0.03; top.castShadow = top.receiveShadow = true; scene.add(top);
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, TOP - 0.06, 16).translate(0, (TOP - 0.06) / 2, 0), steel); ped.castShadow = true; scene.add(ped); }

// ------------------------------------------------------------------ the body: hero.js on his back, a worker in his work clothes
const heroData = await loadHeroData();
const body = new Hero(heroData, { variant: 'walt', height: 1.78, kind: 'work', shirt: '#41505e', shirt2: '#2a333c', trousers: '#2b2f36', boots: '#2a1d14', hat: 'none',
  beard: 0.25, stubble: 0.8, skin: '#ad8c7a', dirt: 0.2, seed: 11 });
scene.add(body.group);
body._coverSkin();        // the HUMAN c6 rule, opted into: skin under the clothes is not drawn (it still casts); the upper arm's skin crossed the
                          // sleeve's shell in 166 places, though none of it drew in front of the sleeve (it was not the dashed outline, below)
body.cloth.top.material.uniforms_c6.cFoldK.value = 0.002;   // the shirt's c6 bump: smooth region gates and the slope cap; the fold terms are x cFlex = 0
// (he has no folds). Without it the hard gate (farmK) cut the elbow's fold band off mid-triangle at the upper arm / forearm seam, and the bump's
// slope spiked along it in a 1 px line: the dashed L-shaped outline on the hanging sleeve (v2, 26.4-30.6 s). The trousers are left as they were.
const BX = 0.13;                                                              // toward the camera's edge of the table, so his left arm can hang over it
body.group.rotation.x = -Math.PI / 2; body.group.position.set(BX, TOP + 0.125, 0.93);   // feet at +z, head at -z, face up
body.update();
for (const m of body.meshes || []) m.receiveShadow = true;                 // hero.js sets castShadow per part (its garment supersets must not cast)
// arms: the right lies along his side under the sheet; the left hangs off the table's edge, out from under the sheet, until it comes up
const dirN = (x, y, z) => V3(x, y, z).normalize();
function aimArm(side, up, fore) {
  const UA = `upperarm01.${side}`, LA = `lowerarm01.${side}`, WR = `wrist.${side}`;
  body._aimWorld(UA, body.joint(LA).sub(body.joint(UA)), up);
  { const u = up.clone().normalize(), fc = body.joint(WR).sub(body.joint(LA)); fc.addScaledVector(u, -fc.dot(u)); const fd = fore.clone().addScaledVector(u, -fore.dot(u));
    if (fc.lengthSq() > 1e-6 && fd.lengthSq() > 1e-6) { fc.normalize(); fd.normalize(); body.rotateWorld(UA, u, Math.atan2(new THREE.Vector3().crossVectors(fc, fd).dot(u), fc.dot(fd))); } }
  body._aimWorld(LA, body.joint(WR).sub(body.joint(LA)), fore);
}
const RAISE = { close: [TL.fist - 0.15, TL.fist + 0.05], up: [TL.fist + 0.12, TL.fist + 1.05] };   // the fist is shut before the arm leaves the hang (closing
                                                                                                    // on the way up, it read for a frame as a thumbs-up)
function raiseAt(t) { return ease.outBack(clamp((t - RAISE.up[0]) / (RAISE.up[1] - RAISE.up[0]))); }
const upL = k => { const th = lerp(-0.80, Math.PI / 2, k); return dirN(Math.cos(th), Math.sin(th), 0.08 * (1 - k)); };
const foreL0 = k => { const th = lerp(-0.80, Math.PI / 2, k), a = th + 0.25 * k + (1 - k) * -0.62; return dirN(Math.cos(a), Math.sin(a), 0.12 * (1 - k) - 0.06 * k); };
const armFrame = k => { const th = lerp(-0.80, Math.PI / 2, k), u = upL(k), e1 = V3(Math.sin(th), -Math.cos(th), 0); e1.addScaledVector(u, -e1.dot(u)).normalize(); return { u, e1, e2: new THREE.Vector3().crossVectors(u, e1) }; };
const BEND = [0, 1].map(k => { const { u, e1, e2 } = armFrame(k), f = foreL0(k), n = f.clone().addScaledVector(u, -f.dot(u)).normalize(); return { b: Math.acos(clamp(u.dot(f), -1, 1)), psi: Math.atan2(n.dot(e2), n.dot(e1)) }; });
if (BEND[1].psi - BEND[0].psi > Math.PI) BEND[1].psi -= 2 * Math.PI; else if (BEND[1].psi - BEND[0].psi < -Math.PI) BEND[1].psi += 2 * Math.PI;
function foreL(k) {             // the forearm from the bend angle and the bend plane, each eased between the hanging and the raised pose
  const m = clamp(k), { u, e1, e2 } = armFrame(k), psi = lerp(BEND[0].psi, BEND[1].psi, m), b = lerp(BEND[0].b, BEND[1].b, m);
  return u.clone().multiplyScalar(Math.cos(b)).addScaledVector(e1.clone().multiplyScalar(Math.cos(psi)).addScaledVector(e2, Math.sin(psi)), Math.sin(b)); }
function poseArms(t) {
  body.resetPose();
  aimArm('R', dirN(-0.12, -0.22, 1), dirN(-0.08, -0.25, 1));
  const k = raiseAt(t); aimArm('L', upL(k), foreL(k));                        // the left arm: from hanging out and down (-46 deg) to straight up
  body.update();
}
// the clenched hand, solved once (the fist is the hand's own shape, so its finger rotations hold whatever the arm does): the fist of Bridgman,
// the fingers folded into the palm and the thumb clamped across their middle segments, the wrist straight (the bar grip left the
// fingertips showing and the thumb hidden: at full size the raised hand read as a limp, curled one)
const HAND = []; body.bone('wrist.L').traverse(B => { if (B !== body.bone('wrist.L')) HAND.push(B); });
const FIST = (() => { body.resetPose(); body.update(); body.fistBridgman('L', { cock: 0 }); const Q = HAND.map(B => B.quaternion.clone()); body.resetPose(); body.update(); return Q; })();
const THUMB = new Set(['finger1-1.L', 'finger1-2.L', 'finger1-3.L'].map(n => body.bone(n)));
function poseHands(t) {
  body.relaxHand('R', 1, { cascade: true });
  const close = clamp((t - RAISE.close[0]) / (RAISE.close[1] - RAISE.close[0]));
  const tw = t > TL.moving ? Math.max(0, Math.sin((t - TL.moving) * 5.2)) ** 3 * (H01(Math.floor((t - TL.moving) * 1.65)) > 0.35 ? 1 : 0.3) : 0;   // the fingers twitch
  body.relaxHand('L', 1 + 0.9 * tw * (1 - close), { cascade: true });
  if (close <= 0) return;
  // the fingers curl in first, the thumb folds over them last (never out on its own)
  const kf = E(clamp(close / 0.75)), kt = E(clamp((close - 0.3) / 0.7));
  HAND.forEach((B, i) => B.quaternion.slerp(FIST[i], THUMB.has(B) ? kt : kf));
  body.update();
}
// the body as the cloth feels it: capsules on the posed skeleton (a little proud of the skin, so no skin pokes through the sheet), and
// under them FIELD, the clothed body's own top surface
function colliders(t) {
  poseArms(t);
  const J = n => body.joint(n), Tp = n => body.tip(n), up = V3(0, 1, 0);
  const breath = t > TL.moving ? 0.016 * Math.max(0, Math.sin((t - TL.moving) * 2.6)) : 0;
  const cap = (a, b, r, lift = 0, dx = 0) => ({ s: 'capsule', a: a.clone().addScaledVector(up, lift).add(V3(dx)).toArray(), b: b.clone().addScaledVector(up, lift).add(V3(dx)).toArray(), r });
  const hc = J('head').lerp(Tp('head'), 0.5);
  const RT = 0.025, C = [{ s: 'box', min: [-0.425, 0.4, -1.1], max: [0.425, TOP - RT, 1.1] }, { s: 'box', min: [-0.425 + RT, 0.4, -1.1 + RT], max: [0.425 - RT, TOP, 1.1 - RT] }, { s: 'floor', y: 0.0 },
    // the slab's top edges rounded (a sharp box edge held the hanging cloth on two faces at once: stretched, loose triangles at the corners)
    ...[[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]].map(([[x0, z0], [x1, z1]]) => ({ s: 'capsule', a: [x0 * (0.425 - RT), TOP - RT, z0 * (1.1 - RT)], b: [x1 * (0.425 - RT), TOP - RT, z1 * (1.1 - RT)], r: RT })),
    { s: 'sphere', c: hc.toArray(), r: 0.112 }, { s: 'sphere', c: hc.clone().add(V3(0, 0.105, 0.035)).toArray(), r: 0.03 },
    cap(J('neck01'), J('head'), 0.07), cap(J('jaw'), Tp('jaw'), 0.055, 0.02),
    cap(J('spine03'), J('spine01'), 0.14 + breath, 0.06 + breath, 0.07), cap(J('spine03'), J('spine01'), 0.14 + breath, 0.06 + breath, -0.07),
    cap(J('spine05'), J('spine03'), 0.13 + breath * 0.6, 0.05), cap(J('pelvis.L'), J('pelvis.R'), 0.12, 0.04)];
  for (const s of ['L', 'R']) {
    C.push(cap(J(`upperleg01.${s}`), J(`lowerleg01.${s}`), 0.095, 0.01), cap(J(`lowerleg01.${s}`), J(`foot.${s}`), 0.085), cap(J(`foot.${s}`), Tp(`toe3-1.${s}`), 0.07));
    if (s === 'R') C.push(cap(J('upperarm01.R'), J('lowerarm01.R'), 0.058), cap(J('lowerarm01.R'), J('wrist.R'), 0.048), cap(J('wrist.R'), Tp('wrist.R'), 0.05));
  }
  // the left arm moves, so it is all capsules, sized to the sleeve (p95 7 cm about the upper arm, 6 cm at the elbow) and the whole hand;
  // the shoulder ball close, so the sheet falls back round the arm where it comes up (a bigger one held a gap open onto the shirt)
  C.push({ s: 'sphere', c: J('upperarm01.L').toArray(), r: 0.085 }, cap(J('upperarm01.L'), J('lowerarm01.L'), 0.07), cap(J('lowerarm01.L'), J('wrist.L'), 0.064),
    cap(J('wrist.L'), J('finger3-1.L'), 0.05));
  // the feet bridged at the toes, a finger's sag between them: the sheet tents across from boot to boot (it sagged into a trough)
  { const a = Tp('toe3-1.L'), b = Tp('toe3-1.R'), m = a.clone().lerp(b, 0.5).addScaledVector(up, -0.015); C.push(cap(a, m, 0.07), cap(m, b, 0.07)); }
  if (FIELD) C.push(FIELD);
  return C;
}
// the clothed body's top surface seen from above (cloth.js heightField): every fold of the shirt and trousers, the boots, the face and
// the beard as he lies, so nothing of him stands through the sheet (the capsules missed the trousers' thighs by 1 cm: two dark patches
// through the sheet). The left arm (anything a third weighted to it) is left to its capsules, since it comes up.
const FIELD = (() => {
  poseArms(TL.table); poseHands(TL.table);
  const arm = new Set(); body.bone('upperarm01.L').traverse(B => arm.add(B));
  const armIdx = new Set(); body.skeleton.bones.forEach((B, i) => { if (arm.has(B)) armIdx.add(i); });
  const v = new THREE.Vector3(), parts = [];
  for (const m of body.meshes) {
    if (!m.visible || !m.isSkinnedMesh) continue;
    const g = m.geometry, n = g.attributes.position.count, pos = new Float32Array(n * 3), si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    m.updateMatrixWorld(true);
    for (let i = 0; i < n; i++) { m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld); pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z; }
    const keep = i => { let w = 0; for (let c = 0; c < 4; c++) if (armIdx.has(si.getComponent(i, c))) w += sw.getComponent(i, c); return w < 0.3; };
    parts.push({ pos, index: g.index ? g.index.array : null, keep });
  }
  return { s: 'height', ...heightField(parts, { x0: -0.4, z0: -1.0, x1: 0.7, z1: 1.05, g: 0.01 }), depth: 0.04 };
})();
// the sheet: dropped over him once, settled; from the stir on it is stepped forward with him (and re-run when a render starts mid-shot)
const SETTLE = [1.0, 2.0];
const cloth = new Cloth({ w: 1.32, l: 2.8, nx: 60, nz: 126, at: [0.0, 1.5, 0.05], friction: 0.4 });  // long enough to fall over the foot of the steel (v2's ended in the air past his toes)
const pinSteel = () => { for (let k = 0; k < cloth.N; k++) { const x = cloth.p[k * 3], y = cloth.p[k * 3 + 1], z = cloth.p[k * 3 + 2]; if (y < TOP + 0.03 && Math.abs(x) <= 0.43 && Math.abs(z) <= 1.11) cloth.pin(k); } };
cloth.settle(SETTLE[0], colliders(TL.table)); pinSteel();                    // where it has landed on the steel it stays (the steel's grip), so the
cloth.settle(SETTLE[1], colliders(TL.table)); pinSteel();                    // sheet does not creep off him while the falls come to rest
cloth.q.set(cloth.p);                                                         // at rest
const SETTLED = cloth.snapshot();
const sheetMat = new THREE.MeshPhysicalMaterial({ color: '#d6dbd3', roughness: 0.92, sheen: 0.5, sheenRoughness: 0.6, sheenColor: new THREE.Color('#eef4ee'), side: THREE.DoubleSide });
const sheet = new THREE.Mesh(cloth.geometry, sheetMat); sheet.castShadow = sheet.receiveShadow = true; scene.add(sheet);
// drawn sheet only (the simulation is untouched): where the cloth has folded back on itself (two triangles whose normals are more than 80 deg
// apart: the light/dark shards along the +x hem by his left shin, where the first pin catches the falling sheet), the fold's vertices and two
// rings round them are relaxed toward their neighbours, in the legs' half of the sheet only
const NBR = (() => { const nx = cloth.nx, nz = cloth.nz, L = []; for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const r = []; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a <= nx && b <= nz) r.push(b * (nx + 1) + a); } L.push(r); } return L; })();
function unfold() { const g = cloth.geometry, P = g.attributes.position.array, I = g.index.array, nT = I.length / 3, Nf = new Float32Array(nT * 3), E = new Map(), hot = new Uint8Array(cloth.N);
  for (let q = 0; q < nT; q++) { const a = I[q * 3] * 3, b = I[q * 3 + 1] * 3, c = I[q * 3 + 2] * 3, ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; Nf[q * 3] = nx / l; Nf[q * 3 + 1] = ny / l; Nf[q * 3 + 2] = nz / l;
    for (const [u, v] of [[I[q * 3], I[q * 3 + 1]], [I[q * 3 + 1], I[q * 3 + 2]], [I[q * 3 + 2], I[q * 3]]]) { const k = u < v ? u * 1e5 + v : v * 1e5 + u, o = E.get(k); if (o === undefined) E.set(k, q); else if (Nf[o * 3] * Nf[q * 3] + Nf[o * 3 + 1] * Nf[q * 3 + 1] + Nf[o * 3 + 2] * Nf[q * 3 + 2] < 0.17) { hot[u] = hot[v] = 1; } } }
  let ring = hot.slice(); for (let r = 0; r < 2; r++) { const R2 = ring.slice(); for (let k = 0; k < cloth.N; k++) if (ring[k]) for (const n of NBR[k]) R2[n] = 1; ring = R2; }
  const K0 = (cloth.nz >> 1) * (cloth.nx + 1);   // the legs' half only: up by the shoulder the sheet is where his arm comes out
  for (let it = 0; it < 6; it++) { const Q = P.slice(); for (let k = K0; k < cloth.N; k++) { if (!ring[k] || !cloth.inv[k]) continue; const R = NBR[k]; for (let a = 0; a < 3; a++) { let m = 0; for (const n of R) m += Q[n * 3 + a]; P[k * 3 + a] = 0.5 * Q[k * 3 + a] + 0.5 * m / R.length; } } }
  g.computeVertexNormals(); }
let simAt = -1;
function placeSheet(t) {
  const t0 = TL.moving, tc = Math.max(0, Math.min(t, TL.living) - t0);       // the sheet stops at the cut to the map
  if (tc <= 0) { if (simAt !== 0) { cloth.restore(SETTLED); cloth.t = 0; simAt = 0; cloth.sync(); unfold(); } return; }
  if (simAt < 0 || tc < simAt - 1e-6) { cloth.restore(SETTLED); cloth.t = 0; }
  cloth.run(tc, s => colliders(t0 + s)); simAt = cloth.t; cloth.sync(); unfold();
}
// shots (solved by projecting the body's points, scratch frame_check): the whole draped body up the frame from the foot end; the push onto
// the hand hanging over the edge; the pull back as the arm comes up, the fist under the type and the body under it
const SHOT = { open0: { p: [0.55, 2.45, 2.35], l: [0.1, 0.95, -0.25], fov: 40 }, open1: { p: [0.45, 2.2, 1.85], l: [0.1, 0.95, -0.25], fov: 40 },
  tableA: { p: [0.75, 2.3, 2.1], l: [0.2, 0.9, -0.3], fov: 40 }, tableC: { p: [1.3, 1.5, 0.55], l: [0.5, 0.75, -0.45], fov: 40 }, fistB: { p: [1.9, 1.75, 1.2], l: [0.28, 1.45, -0.45], fov: 44 } };
const mixShot = (A, B, u) => ({ p: A.p.map((v, i) => lerp(v, B.p[i], u)), l: A.l.map((v, i) => lerp(v, B.l[i], u)), fov: lerp(A.fov, B.fov, u) });
function camAt(t) {
  if (t < TL.map) return mixShot(SHOT.open0, SHOT.open1, E(clamp(t / TL.map)));
  if (t < TL.fist) return mixShot(SHOT.tableA, SHOT.tableC, E(clamp((t - TL.corpse) / (TL.fist - TL.corpse))));
  const S = mixShot(SHOT.tableC, SHOT.fistB, ease.outCubic(clamp((t - TL.fist - 0.05) / 0.5))), h = Math.sin(Math.PI * clamp((t - TL.fist - 0.07) / 0.3));
  S.l = [S.l[0] + 0.15 * h, S.l[1], S.l[2] - 0.09 * h]; return S;      // leads the outBack raise and follows the arm out, so the fist never leaves the frame
}
function renderMorgue(t) {
  placeSheet(t); poseArms(t); poseHands(t);
  const C = camAt(t);
  const flick = t > TL.moving && t < TL.fist + 0.3 && H01(Math.floor(t * 24)) < 0.12 ? 0.55 : 1;                 // the tube stutters when the corpse moves
  tube.intensity = 26 * flick;
  camera.position.set(...C.p); camera.fov = C.fov; camera.updateProjectionMatrix(); camera.lookAt(V3(...C.l));
  renderer.render(scene, camera); { const gl = renderer.getContext(), px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }   // sync before the copy
  ctx.drawImage(glc, 0, 0, W, H);
}

// ------------------------------------------------------------------ the map (2D): the engraved relief on cream; a chapter stamped in almost every state
const geo = await loadGeo({ world: false, rivers: false });
const us = new USMap(geo); us._bake(); us.plate({ Print, paper: 'cream', light: [-0.7, -0.55, 1.0] });   // a higher sun: the town mounds' shadow sides
// engraved mid-grey, not black (under the red ink they read as pocks over the plains)
const UNLIT = { origin: [-98.5, 39.5], r: -1e4 };                             // no county inked: the land stays the engraving on cream (without an
                                                                              // ignite every county is lit, and the whole country went crimson), so the stamps carry the red
const CHAP = (() => { const by = new Map(); for (const c of us.cities) if (c.st && !by.has(c.st)) by.set(c.st, c);   // the largest city per state
  const L = [...by.values()].filter(c => c.st !== 'AK' && c.st !== 'HI' && c.st !== 'DC'); L.sort((a, b) => H01(a.x * 0.31 + a.y) - H01(b.x * 0.31 + b.y)); return L; })();
const CAM = { x: 540, y: 390, zoom: 1.1, sy: 1000 };
const LIVE = [TL.living, 32.2, 33.8];
const CAML = { ...CAM, sy: 1195 };                                            // the final hold: the country under the three red bands
function renderMap(t, { all = false } = {}) {
  ctx.fillStyle = '#F4E6D0'; ctx.fillRect(0, 0, W, H);
  const cam = all ? CAML : CAM;
  us.draw(ctx, { cam, t, style: 'engraving', ignite: UNLIT, grid: 0.2, borders: 0.7, embers: false, res: 0.8 });
  const span = TL.organizing + 2 - TL.booming, n = all ? CHAP.length : Math.floor(CHAP.length * clamp((t - TL.booming) / span));
  CHAP.forEach((c, i) => {
    if (i >= n) return; const [x, y] = us.toScreen([c.x, c.y], cam), age = all ? 9 : t - (TL.booming + i / CHAP.length * span);
    const sc = age < 0.1 ? lerp(1.7, 1, ease.outCubic(age / 0.1)) : 1;                                                   // each chapter stamped in
    ctx.save(); ctx.translate(x, y); ctx.scale(sc, sc);
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = HRED; ctx.beginPath(); ctx.arc(0, 0, 10.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (all) for (const L0 of LIVE) { const a = t - L0 - (i % 7) * 0.012; if (a < 0 || a > 0.9) continue;                // LIVING, ACTIVE, GROWING: a ring out of every chapter on each word
      ctx.strokeStyle = `rgba(200,20,30,${(1 - a / 0.9) * 0.8})`; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, y, 15 + a * 70, 0, Math.PI * 2); ctx.stroke(); }
  });
  if (!all && t >= TL.states) { ctx.save(); ctx.font = `900 96px ${FONT}`; ctx.textAlign = 'center'; const s = `${n}`, w = ctx.measureText(s).width;
    ctx.fillStyle = INK; ctx.fillRect(540 - w / 2 - 26, 1560 - 88, w + 52, 112); ctx.fillStyle = STOCK; ctx.fillText(s, 540, 1560); ctx.restore(); }   // the count
}

// ------------------------------------------------------------------ the words (house: solid type on a solid band, bands.js)
const CUES = [
  [0.3, TL.autopsy, ['THEY TITLED', 'THE ARTICLE:'], 330, 150, 'main'],
  [TL.autopsy, TL.unaware, ['“AN AUTOPSY…”'], 380, 190, 'red'],                 // the source title runs on past AUTOPSY: the cut is marked
  [TL.unaware, TL.crisis, ['EVEN I WAS', 'COMPLETELY UNAWARE'], 330, 124, 'main'],
  [TL.crisis, TL.map, ['OF ANY CRISIS', 'FACING THE PARTY.'], 330, 132, 'main'],
  [7.6, TL.map, ['HAZ AL-DIN · EXECUTIVE CHAIRMAN, AMERICAN COMMUNIST PARTY'], 1250, 34, 'sub'],
  [TL.booming, TL.activity, ['RECRUITMENT', 'IS BOOMING,'], 330, 150, 'main'],
  [TL.activity, TL.states, ['ACTIVITY IS AT', 'AN ALL-TIME HIGH,'], 330, 136, 'main'],
  [TL.states, TL.organizing, ['CADRE HAVE BEEN', 'STEADILY BUT SURELY', 'BUILDING A PRESENCE', 'IN ALMOST EVERY STATE'], 330, 100, 'main'],
  [TL.organizing, TL.table, ['LABOR, TENANT,', 'AND COMMUNITY', 'ORGANIZING'], 330, 136, 'hot'],
  [TL.table, TL.corpse, ['IN THE MIDDLE', 'OF YOUR ‘AUTOPSY,’'], 330, 136, 'main'],
  [TL.corpse, TL.living, ['THE ‘CORPSE’', 'BEGAN MOVING', 'A LITTLE BIT'], 300, 120, 'main'],
  [TL.living, TL.mark - 0.1, ['LIVING,'], 340, 200, 'red'], [32.2, TL.mark - 0.1, ['ACTIVE,'], 340 + 244, 200, 'red'], [33.8, TL.mark - 0.1, ['AND GROWING.'], 340 + 488, 200, 'red'],
  [34.6, TL.mark - 0.1, ['HAZ AL-DIN · COMMUNISM IN THE POST-MAGA AGE · 2026'], 1700, 34, 'sub'],
];

// ------------------------------------------------------------------ the frame
const closerCv = document.createElement('canvas'); closerCv.width = W; closerCv.height = H; const closerG = closerCv.getContext('2d');
window.renderFrame = async (t) => {
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  const ts = Math.min(t, TL.mark - 1e-3);
  if (ts >= TL.map && ts < TL.table) renderMap(ts);
  else if (ts >= TL.living) renderMap(ts, { all: true });
  else renderMorgue(ts);
  if (t >= TL.mark) {
    const age = t - TL.mark; ctx.fillStyle = `rgba(4,3,6,${clamp(0.9 + age * 3, 0, 0.97)})`; ctx.fillRect(0, 0, W, H);
    closerG.clearRect(0, 0, W, H); closer(closerG, age); ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.drawImage(closerCv, 0, 0); ctx.restore();
    return {};
  }
  cueType(ctx, t, CUES);
  finish.apply(ctx, Math.round(t * 30), { grain: 0.05, vignette: 0.32 });
  return {};
};
ready = true;
