// PORTRAITS: close, rim-lit working people (lib/fx/people.js) rendered on their own transparent canvas, for 2D scenes
// that cut to faces (HORDE's LOUDER riders and payoff worker, RED WEDGE's crowd). One renderer, one pooled cast.
//
//   const P = makePortraits({ w: 720, h: 1280 });
//   const cv = P.render({ cast: [{ trade: 'steel', seed: 4, x: 0, z: 0, heading: 0.5, act: 'fist', pump: 1, t }],
//                         cam: [px, py, pz, lx, ly, lz, fov], shout: 1, rim: '#ff4a1e', key: '#ffb488' });
//   ctx.drawImage(cv, 0, 0, W, H);
// Pure function of the shot: every call re-assigns the pool from the cast (People.random(trade, seed) + overrides).
import * as THREE from 'three';
import { People } from '../lib/fx/people.js';

export function makePortraits({ w = 720, h = 1280, max = 48 } = {}) {
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(w, h, false); renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, w / h, 0.05, 400);
  const hemi = new THREE.HemisphereLight('#6a3030', '#1a0404', 0.35); scene.add(hemi);
  const key = new THREE.DirectionalLight('#ffb488', 1.6); scene.add(key); scene.add(key.target);
  const rimL = new THREE.DirectionalLight('#ff4a1e', 6.0); scene.add(rimL); scene.add(rimL.target);
  const rimR = new THREE.DirectionalLight('#ff7a3a', 4.0); scene.add(rimR); scene.add(rimR.target);
  const folk = new People(scene, { max, viewH: h, lodPx: [150, 60], budget: [16, 40], shadows: 'none' });
  const ids = [];
  for (let i = 0; i < max; i++) { const id = folk.add(People.random('steel', i + 1)); folk.set(id, { visible: false }); ids.push(id); }
  const col = (c, fb) => new THREE.Color(c || fb);
  function render(shot) {
    const cast = shot.cast || [];
    ids.forEach((id, i) => {
      const c = cast[i];
      if (!c) { folk.set(id, { visible: false }); return; }
      const st = folk.get(id);
      st.d = { ...People.random(c.trade || 'steel', c.seed || i + 1), ...(c.d || {}) };
      folk.palette(id);
      folk.set(id, { visible: true, x: c.x || 0, y: c.y || 0, z: c.z || 0, heading: c.heading || 0, act: c.act || 'stand',
        t: c.t || 0, ph: c.ph || 0, pump: c.pump ?? null, look: c.look || 0, both: !!c.both, mix: c.mix || null, lift: c.lift || 0 });
    });
    const [px, py, pz, lx, ly, lz, fov = 30] = shot.cam;
    camera.position.set(px, py, pz); camera.fov = fov; camera.updateProjectionMatrix(); camera.lookAt(lx, ly, lz); camera.updateMatrixWorld();
    // lights ride with the camera: key low from the front-left, two hard rims from behind
    const f = new THREE.Vector3(lx - px, 0, lz - pz).normalize(), r = new THREE.Vector3(-f.z, 0, f.x);
    const tgt = new THREE.Vector3(lx, ly, lz);
    key.target.position.copy(tgt); rimL.target.position.copy(tgt); rimR.target.position.copy(tgt);
    key.position.copy(tgt).addScaledVector(f, -2.5).addScaledVector(r, shot.keySide ?? -4).setY(ly + 0.4);   // a hard side key: one cheek lit, one in shadow
    rimL.position.copy(tgt).addScaledVector(f, 5).addScaledVector(r, -4).setY(ly + 1.5);
    rimR.position.copy(tgt).addScaledVector(f, 5).addScaledVector(r, 4).setY(ly + 0.8);
    key.color = col(shot.key, '#ffb488'); key.intensity = shot.keyI ?? 1.6;
    rimL.color = col(shot.rim, '#ff4a1e'); rimL.intensity = shot.rimI ?? 6.0;
    rimR.color = col(shot.rim2 || shot.rim, '#ff7a3a'); rimR.intensity = (shot.rimI ?? 6.0) * 0.66;
    hemi.intensity = shot.amb ?? 0.35;
    People.shout.value = shot.shout || 0;
    folk.update(camera);
    renderer.render(scene, camera);
    People.shout.value = 0;
    return canvas;
  }
  return { render, canvas, folk };
}
