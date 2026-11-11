// LAB / HUMAN retarget check: three hero variants driven by one BVH take, the source skeleton (red) beside them.
//   ?take=62_07 &side=1 &pose=bind &grip=1 &view=axis|palm|back &headcam=1
import * as THREE from 'three';
import { loadHeroData, Hero } from '../lib/fx/hero.js';
import { loadTake, heroMap } from '../lib/fx/bvh.js';

const Q = new URLSearchParams(location.search);
const SUBJ = Q.get('subject') || 'test', MODE = Q.get('mode') || 'lit';
const RW = 1080, RH = 1920;
const canvas = document.getElementById('out');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(RW, RH, false);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0; renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#6a6a70');
const camera = new THREE.PerspectiveCamera(30, RW / RH, 0.02, 500);
window.labInfo = {};

async function setup() {
  const data = await loadHeroData();
  if (SUBJ === 'test') {
    const hemi = new THREE.HemisphereLight('#c0c8d8', '#403028', 1.2); scene.add(hemi);
    const key = new THREE.DirectionalLight('#fff0e0', 2.5); key.position.set(3, 4, 5); scene.add(key);
    const variants = ['forge', 'plains', 'heavy'];
    const heroes = variants.map((v, i) => { const h = new Hero(data, { variant: v, seed: i + 3, hat: ['hard', 'cap', 'none'][i], kind: ['work', 'flannel', 'tee'][i], beard: [0.3, 0, 0.9][i] }); h.group.position.x = (i - 1) * 0.75; scene.add(h.group); return h; });
    const take = await loadTake('../../sources/mocap/cmu/' + (Q.get('take') || '62_07') + '.bvh');
    const clip = take.retarget(heroMap(heroes[0].names), heroes[0].rig);
    const skel = new THREE.Group(); scene.add(skel); skel.position.x = 1.6;
    const drawSrc = t => { skel.clear(); const B = take.b, mat = new THREE.LineBasicMaterial({ color: '#ff2020' });
      for (const j of B.joints) if (j.parent >= 0) { const a = take.jointAt(B.joints[j.parent].name, t), b = take.jointAt(j.name, t);
        skel.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), mat)); } };
    window.renderFrame = t => { drawSrc(t);
      for (const h of heroes) { if (Q.get('pose') !== 'bind') { const c = take.retarget(heroMap(h.names), h.rig); h.applyClip(c.sample(t)); h.root.position.x = 0; h.root.position.z = 0; } h.update(); }
      let gripInfo = null;
      if (Q.get('grip')) { const h = heroes[0]; const H = h.handle('R'); gripInfo = h.grip('R', H);
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(H.r, H.r, Q.get('view') === 'axis' ? 0.06 : 0.3, 24), new THREE.MeshStandardMaterial({ color: '#8a5a30', roughness: 0.6 }));
        cyl.position.copy(H.p); cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), H.d); scene.add(cyl); h.update();
        const hp = H.p.clone(), vd = Q.get('view') === 'axis' ? H.d.clone() : (Q.get('view') === 'back' ? h.palm('R').n.clone().negate() : h.palm('R').n.clone()); camera.position.copy(hp).addScaledVector(vd, 0.42); camera.up.set(0, 1, 0); camera.lookAt(hp); camera.fov = 30; camera.updateProjectionMatrix(); renderer.render(scene, camera); window.labInfo = { grip: gripInfo }; return {}; }
      const side = Q.get('side'); camera.position.set(side ? 6 : 0.4, 1.1, side ? 0.2 : 6.2); camera.lookAt(0.4, 0.95, 0);
      if (Q.get('headcam')) { const hp = heroes[2].joint('head'); camera.position.set(hp.x + 0.25, hp.y + 0.25, hp.z + 0.6); camera.lookAt(hp.x, hp.y + 0.08, hp.z); }
      if (Q.get('redhair')) for (const h of heroes) if (h.hairMesh) { h.hairMesh.material = new THREE.MeshBasicMaterial({ color: 'red' }); } camera.fov = 30; camera.updateProjectionMatrix();
      renderer.render(scene, camera); const h = heroes[0]; h.update(); const hb = new THREE.Vector3().setFromMatrixPosition(h.bone('head').matrixWorld); const bb = new THREE.Box3().setFromObject(h.hatGroup || h.group); window.labInfo = { head: hb.toArray().map(x=>+x.toFixed(3)), hat: [bb.min.toArray().map(x=>+x.toFixed(3)), bb.max.toArray().map(x=>+x.toFixed(3))], eyeY: h.eyeL.y, top: h.skullTop, scale: h.scale }; return {};
    };
  }
  window.sceneReady = true;
}
setup().catch(e => { console.error(e.stack || e.message); window.sceneError = String(e.message); });
