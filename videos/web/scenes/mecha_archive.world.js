// MECHA PROLETARIAT: ARCHIVE. The walker as the next reel: MODELING's FRAME giant (lattice limbs, red-lead primer on what is newest),
// a yard in hard noon sun, shot on a 1930s lens. Everything here is lit for a black-and-white stock: a bright sky, one hard sun with
// real shadows, haze, no coloured light. The scene grades the frame to silver and keeps the primer as red lead.
import * as THREE from 'three';
import { rng } from '../lib/kit.js';
import { Heavy, makeMats } from '../lib/fx/modeling/mecha/heavy.js';
import { makeGround, Scaffold, TowerCrane, Dust, Crowd } from '../lib/fx/modeling/mecha/site.js';

export const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// a sky: a soft gradient with a few high clouds, as an inside-out sphere (bright, as orthochromatic stock sees it)
function makeSky(scene) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512; const g = c.getContext('2d'), R = rng(5);
  const gr = g.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, '#5f7fa8'); gr.addColorStop(.45, '#a9bdd2'); gr.addColorStop(.5, '#e8e6e0'); gr.addColorStop(1, '#e8e6e0');
  g.fillStyle = gr; g.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 160; i++) { const x = R() * 1024, y = 110 + R() * 140, r = 18 + R() * 60; const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, `rgba(255,255,255,${.1 + R() * .12})`); rg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = t; scene.environment = t; scene.environmentIntensity = .55;
  return t;
}

export class Site {
  constructor(scene, renderer) {
    this.scene = scene; this.renderer = renderer;
    makeSky(scene);
    scene.fog = new THREE.FogExp2('#cdd0d2', .0016);
    this.ground = makeGround(scene, { size: 1600, seed: 5 }); this.ground.material.color.set('#b0aca4'); this.ground.material.roughness = .85;
    this.mats = makeMats('FRAME');
    this.G = new Heavy(scene, { design: 'FRAME', mats: this.mats, crew: true });
    this.G.pose(STAND); this.G.ground(); this.G.setBuild(1); this.restY = this.G.g.position.y;
    this.scaf = new Scaffold(scene, { halfW: 17, halfD: 12, height: 44, bay: 3.6, lift: 4.5, seed: 4, gal: '#b4b2ab' });
    this.crane = new TowerCrane(scene, { h: 76, jib: 66, back: 24, seed: 2, col: '#9a978f' }); this.crane.g.position.set(-38, 0, -16);
    this.crane2 = new TowerCrane(scene, { h: 66, jib: 58, back: 20, seed: 3, col: '#8d8a82' }); this.crane2.g.position.set(40, 0, -26);
    this.dust = new Dust(scene, { n: 320, seed: 6 }); this.dust.bursts = [];
    this.sun = new THREE.DirectionalLight('#fff4e0', 3.4); this.sun.castShadow = true; this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.bias = -.0003; this.sun.shadow.normalBias = .06;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight('#b8c8dc', '#6a6258', .8); scene.add(this.hemi);
    // the crew: small, many, on the ground and on the decks
    this.crowd = new Crowd(scene, 220, { seed: 41, caps: .5 }); this.layoutCrowd();
    this.plate = new THREE.Mesh(new THREE.BoxGeometry(7, .5, 4), this.mats.primer); this.plate.castShadow = true; this.plate.visible = false; scene.add(this.plate);
    this.sledge = makeSledge(34); this.sledge.visible = false; scene.add(this.sledge);
  }
  layoutCrowd() {
    const R = rng(77), P = this.crowd.P;
    P.forEach((p, i) => {
      if (false) { const s = this.scaf.deckSpots(R, 1)[0]; s.face.loc.updateMatrixWorld(true); this.scaf.g.updateMatrixWorld(true); const w = s.local.clone().applyMatrix4(s.face.loc.matrixWorld); p.x = w.x; p.y = w.y; p.z = w.z; p.yaw = R() * 6.28; p.arm = R() < .15 ? .4 : 0; }
      else { const a = R() * Math.PI * 2, d = 16 + Math.sqrt(R()) * 40; p.x = Math.sin(a) * d * 1.3; p.z = Math.min(34, Math.cos(a) * d * .8 + 6); p.y = 0; p.yaw = Math.atan2(-p.x, -p.z + 14) + (R() - .5) * .5; p.arm = 0; }
      p.s = .93 + R() * .14; p.w = .9 + R() * .2;
    });
    this.crowd.commit(0);
  }
  shadowBox(c, r) { const k = this.sun.shadow.camera; k.left = -r; k.right = r; k.top = r; k.bottom = -r; k.near = 1; k.far = r * 6; k.updateProjectionMatrix(); this.sun.target.position.copy(c); this.sun.position.copy(c).add(V3(.55, .62, .56).normalize().multiplyScalar(r * 3)); }
}

// the sledge: a steam-hammer-sized hammer head on an ash haft; origin at the grip, +y up the haft
function makeSledge(L = 34) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: '#8a6a40', roughness: .85, metalness: 0 }), steel = new THREE.MeshStandardMaterial({ color: '#4a4d52', roughness: .45, metalness: .8, envMapIntensity: 1.1 });
  const haft = new THREE.Mesh(new THREE.CylinderGeometry(.55, .75, L, 10), wood); haft.position.y = L / 2 - 4; haft.castShadow = true; g.add(haft);
  const head = new THREE.Mesh(new THREE.BoxGeometry(8.6, 7.0, 15), steel); head.position.y = L - 4.6; head.castShadow = head.receiveShadow = true; g.add(head);
  for (const s of [-1, 1]) { const face = new THREE.Mesh(new THREE.BoxGeometry(7.8, 6.2, .7), new THREE.MeshStandardMaterial({ color: '#6a6e72', roughness: .35, metalness: .9 })); face.position.set(0, L - 4.6, s * 7.7); g.add(face); }
  const eye = new THREE.Mesh(new THREE.BoxGeometry(2.6, 7.4, 4.4), new THREE.MeshStandardMaterial({ color: '#2e3033', roughness: .6, metalness: .6 })); eye.position.y = L - 4.6; g.add(eye);
  g.userData.head = head; return g;
}

export const STAND = { root: { p: [0, -.6, 0], r: [2, -4, 0] }, waist: [2, 4, 0], chest: [3, 0, 0], hpL: [2, 0, 3], knL: [5, 0, 0], anL: [-7, 0, -3], hpR: [-10, 8, -6], knR: [10, 0, 0], anR: [0, 0, 6], shL: [-6, 0, 10], elL: [-18, 0, 0], shR: [6, 0, -12], elR: [-12, 0, 0], curl: { L: .45, R: .3 } };
