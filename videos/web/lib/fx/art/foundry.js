// ART kit / FOUNDRY: the teeming shot, assembled from the kit (ladle.js + molten.js + sim2 sparks + a HUMAN hero).
// A piece gets the whole shot in three lines:
//
//   import { Stage } from '../lib/fx/folk_worlds.js';  import { foundryShot } from '../lib/fx/art/foundry.js';
//   const st = new Stage(); await st.init();
//   const shot = await foundryShot(st, { cam: 'hook', tilt: 0.62, tapper: true, mono: 0 });
//   const canvas = shot.frame(t);          // 1080x1920 colour; shot.info has the light and camera
//
// The light is the metal: the only strong key is heatLight() on the stream and the splash; the building gets a weak
// cold skylight through the clerestory (the value plan: hot core > lit smoke and the tapper's face > the ladle's lit
// flank > the cold roof > the black floor). mono: 0 colour (FURNACE dialect), 1 the 1906 orthochromatic newsreel
// (heat ramp mapped to the sepia tone, no colour anywhere).
import * as THREE from 'three';
import { buildLadle, buildBail, buildHook, buildMoulds, buildTruss } from './ladle.js';
import { PourStream, MoltenPool, Fume, heatLight } from './molten.js';
import { Sparks } from '../sim2/sparks.js';
import { engraveScene } from './intaglio3d.js';
import { INK } from './tokens.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const CAMS = {
  // the IRON hook: low, three-quarter, the stream the brightest vertical in the frame, the ladle cut by the top edge
  // (offsets from the stream's landing point)
  hook: { pos: [-0.6, 0.4, 13.5], look: [-0.7, 3.5, 0], fov: 40 },
  // a wide establishing view for the turntable sheet
  wide: { pos: [-4, 2.5, 19], look: [-1.2, 4.0, 0], fov: 44 },
  // the tapper close: over his shoulder into the stream
  close: { pos: [3.4, 1.4, 5.0], look: [-0.2, 1.8, 0], fov: 38 },
  // the banknote vignette: square crop around ladle, stream, mould and tapper
  bank: { pos: [-0.9, 2.6, 15.0], look: [-1.3, 4.5, 0], fov: 40 },
};

export async function foundryShot(st, o = {}) {
  const { cam = 'hook', tilt = 0.62, tapper = true, mono = 0, sparks = true, t0 = -10, seed = 3, camOverride = null, engraved = null } = o;
  const S = st.scene, R = st.r;
  S.background = new THREE.Color(mono ? '#0b0907' : '#070506');
  S.fog = new THREE.FogExp2(mono ? '#4a4034' : '#1e1510', 0.03);
  // the building
  const truss = buildTruss({ span: 24, bays: 10, bay: 5, height: 15 }); truss.position.set(0, 0, 8); S.add(truss);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: '#1c1714', roughness: 0.92, metalness: 0.1 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; S.add(floor);
  // the ladle on the hook: holder turns the spout to +x; tilt about the trunnions pours
  const holder = new THREE.Group(); holder.position.set(-1.6, 8.6, 0); holder.rotation.y = Math.PI / 2; S.add(holder);
  const L = buildLadle({ seed }); holder.add(L.group); L.tilt(tilt);
  const bail = buildBail(L); holder.add(bail); const hook = buildHook(); hook.position.set(0, 2.6 + 0.35, 0); holder.add(hook);
  holder.updateMatrixWorld(true); L.group.updateMatrixWorld(true);
  // the open metal in the ladle: crust plates on a crack network
  const pool = new MoltenPool(S, { geometry: L.surf.geometry, cool: 0.55, scale: 4.2, speed: 0.08 });
  L.body.remove(L.surf); pool.mesh.position.copy(L.surf.position); pool.mesh.rotation.copy(L.surf.rotation); S.remove(pool.mesh); L.body.add(pool.mesh);
  // the spout trough runs with metal (the stream starts inside it, not at a pipe end)
  const trough = new MoltenPool(S, { geometry: L.trough.geometry, cool: 0.08, T0: 1780, scale: 3, speed: 0.9, flowDir: [0, 1] });
  L.body.remove(L.trough); S.remove(trough.mesh); trough.mesh.position.copy(L.trough.position); trough.mesh.rotation.copy(L.trough.rotation); trough.mesh.material.side = THREE.DoubleSide; L.body.add(trough.mesh);
  // the far wall: clerestory glazing, the only cold light in the shop (muted by the smoke; large panes, never a bulb grid)
  const glaze = new THREE.MeshBasicMaterial({ color: mono ? '#5a574f' : '#4a5462', fog: true });
  for (let i = -3; i <= 3; i++) { const pane = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 5.5), glaze); pane.position.set(i * 5.2 + 2, 16, -38); S.add(pane);
    const mull = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 5.5), new THREE.MeshBasicMaterial({ color: '#0c0a09' })); mull.position.set(i * 5.2 + 2, 16, -37.9); S.add(mull);
    const tr = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.15), mull.material); tr.position.set(i * 5.2 + 2, 16.7, -37.9); S.add(tr); }
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), new THREE.MeshStandardMaterial({ color: '#1a1614', roughness: 1 })); wall.position.set(0, 12, -38.2); S.add(wall);
  // the stream
  holder.updateMatrixWorld(true);
  const lip = L.lipWorld(), dir = L.lipDir();
  const v0 = dir.clone().multiplyScalar(1.25); v0.y = Math.min(v0.y, 0.1);
  const pour = new PourStream(S, { lip: lip.toArray(), v0: v0.toArray(), r0: 0.1, lipW: 0.34, floorY: 2.05, t0, seed, breakAt: 0.7 });
  const bottom = pour.bottom();
  const moulds = buildMoulds({ n: 5, spacing: 1.55 }); moulds.group.position.set(bottom.x - 2 * 1.55, 0.1, bottom.z); S.add(moulds.group);
  // the splash in the mould mouth: a small hot pool, crust-free
  const splash = new MoltenPool(S, { center: [bottom.x, 2.12, bottom.z], radius: 0.24, cool: 0.05, T0: 1800, scale: 9, speed: 0.6 });
  // a tapper's platform along the moulds
  const plat = new THREE.Mesh(new THREE.BoxGeometry(16, 0.25, 9), new THREE.MeshStandardMaterial({ color: '#1a1512', roughness: 0.88, metalness: 0.2 }));
  plat.position.set(bottom.x, 1.5, bottom.z + 5.1); plat.receiveShadow = plat.castShadow = true; S.add(plat);
  const fume = new Fume(S, { base: [bottom.x + 0.3, 2.1, bottom.z - 1.2], height: 8, width: 2.4, n: 6, alpha: 0.4, color: mono ? '#2e2a24' : '#3a2a22' });
  const fume2 = new Fume(S, { base: [lip.x, lip.y - 0.3, lip.z - 0.8], height: 5, width: 1.8, n: 3, alpha: 0.3, seed: 9, color: mono ? '#2a2620' : '#35251e', rise: 0.3 });
  // sparks from the splash crown, and a few from the lip
  let sp = null;
  if (sparks) {
    sp = new Sparks(S, { max: 7000, ground: 0.1, viewH: st.H, widthPx: 2.4, gain: 0.9 });
    const P = bottom.toArray(); P[1] = 2.12;
    sp.stream({ t0: t0 + 0.4, t1: t0 + 60, rate: 380, pos: P, dir: [0.15, 1, 0.1], spread: 0.95, kind: 'pour', seed: seed + 1, speedK: 0.8 });
    sp.stream({ t0: t0 + 0.4, t1: t0 + 60, rate: 520, pos: P, dir: [0, 1, 0], spread: 1.25, kind: 'grind', seed: seed + 2, speedK: 0.28, lifeK: 0.8 });
    sp.stream({ t0: t0 + 0.2, t1: t0 + 60, rate: 50, pos: lip.toArray(), dir: [1, 0.4, 0], spread: 0.8, kind: 'pour', seed: seed + 3, speedK: 0.5 });
    sp.embers({ t0: t0, t1: t0 + 60, rate: 22, box: [[bottom.x - 2, 2.5, bottom.z - 1.5], [bottom.x + 2, 9, bottom.z + 1.5]], seed: seed + 4, rise: 0.8 });
  }
  // light: the metal is the key (three drives: stream, splash, the open ladle)
  const kS = heatLight(S, { intensity: 55, distance: 18, decay: 1.4, offset: [0.25, 0, 0.6] });
  const kB = heatLight(S, { intensity: 34, distance: 12, decay: 1.6, offset: [0.1, 0.25, 0.2] });
  const kL = new THREE.PointLight('#ff9a3a', 25, 8, 1.5); kL.position.set(-1.6, 11.3, 0); S.add(kL);
  const sky = new THREE.DirectionalLight(mono ? '#c8c0b0' : '#8aa0c0', 0.35); sky.position.set(-6, 20, -10); S.add(sky);
  S.add(new THREE.HemisphereLight(mono ? '#3a3630' : '#27303e', '#0a0605', 0.12));
  const shadowKey = new THREE.SpotLight('#ffa050', 0, 26, 0.9, 0.8, 1.2); shadowKey.castShadow = true; shadowKey.shadow.mapSize.set(1024, 1024);
  shadowKey.position.copy(bottom).add(V3(0.3, 1.2, 0.9)); shadowKey.target.position.set(bottom.x + 2, 0, 4); S.add(shadowKey, shadowKey.target);
  // the tapper: on the platform, three-quarter to camera, a long bar toward the mould mouth, faced by the metal
  let hero = null;
  if (tapper) {
    hero = st.hero({ variant: 'forge', height: 1.82, kind: 'coat', shirt: '#2c2622', trousers: '#241f1c', hat: 'none', beard: 0.5, stubble: 0.8, skin: '#a8704e', hair: '#1c140e', seed: 17, dirt: 0.55, gloves: 'gauntlet', gloveColor: '#1a1512' });
    const hx = bottom.x + 1.25, hz = bottom.z + 2.4;
    st.stand(hero, { x: hx, y: 1.63, z: hz, turn: -Math.PI / 2 - 0.35, t: 'bind', nod: 0.12, chest: 0.12 });
    hero.gesture('R', 'LINE_LO', { fist: false }); hero.gesture('L', 'RAIL', { fist: false }); hero.update();
    const barD = V3(-0.62, -0.3, -1).normalize();
    const gR = st.gripAt(hero, 'R', barD, 0.016), gL = st.gripAt(hero, 'L', barD, 0.016);
    const a = gR.p.clone().addScaledVector(barD, -0.7), b = gR.p.clone().addScaledVector(barD, 2.1);
    const d = b.clone().sub(a), bar = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, d.length(), 8), new THREE.MeshStandardMaterial({ color: '#2a2320', roughness: 0.5, metalness: 0.8 }));
    bar.position.copy(a).add(b).multiplyScalar(0.5); bar.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize()); bar.castShadow = true; S.add(bar);
  }
  const C = camOverride || CAMS[cam];
  st.lookAt(bottom.clone().add(V3(...C.pos)), bottom.clone().add(V3(...C.look)), C.fov);
  R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = mono ? 1.45 : 1.05;
  if (mono) { const tone = new THREE.Vector3(1.0, 0.86, 0.66); for (const m of [pour.uni, pool.uni, splash.uni]) { m.uMono.value = 1; m.uTone.value.copy(tone); } }
  // ENGRAVING dialect: the same set, lit by a raking studio key for the engraver, every surface a line plate
  let eng = null;
  if (engraved) {
    S.background = new THREE.Color(INK.stock); S.fog = null; wall.visible = false; truss.visible = false; floor.visible = false; plat.material.color.set('#b0a698');
    const key = new THREE.DirectionalLight('#ffffff', engraved.key ?? 2.6); key.position.set(-9, 14, 12); S.add(key);
    S.add(new THREE.HemisphereLight('#ffffff', '#806050', engraved.fill ?? 0.5));
    eng = engraveScene(S, engraved);
    R.toneMapping = THREE.NoToneMapping;
  }
  const out = document.createElement('canvas'); out.width = st.W; out.height = st.H; const g = out.getContext('2d');
  return { st, eng, pour, pool, fume, sparks: sp, L, holder, bottom, hero,
    frame(t) {
      pour.update(t); pool.update(t); splash.update(t); trough.update(t);
      const Ls = pour.light(t); kS.drive(Ls);
      const Lb = { pos: bottom, color: Ls.color, power: Ls.power * (0.85 + 0.25 * Math.sin(t * 23) * Math.sin(t * 7.7)) }; kB.drive(Lb);
      shadowKey.intensity = 40 * Lb.power; shadowKey.color.copy(Ls.color);
      fume.update(t, st.camera, { color: Ls.color, power: 1.1 * Ls.power }); fume2.update(t, st.camera, { color: Ls.color, power: 0.8 });
      if (sp) sp.update(t, st.camera, R);
      g.fillStyle = '#000'; g.fillRect(0, 0, out.width, out.height); g.drawImage(st.renderLit(), 0, 0);
      return out;
    } };
}
