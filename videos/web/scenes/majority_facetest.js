// THE MAJORITY c2 face test (r7 critic's first step): a computer-made c7 face beside a filmed face (the foundry_face matte,
// Master Hands 1936) at the sizes a phone shows: head height 1/3 of the frame (top row) and 1/6 (bottom row), each panel a
// 540x960 frame. Left: hero.js c7 people (Mei, Otis, Rosa in turn) under stadium flood; right: the matte.
import * as THREE from 'three';
import { W, H } from '../lib/kit.js';
import { Stage } from '../lib/fx/folk_worlds.js';
import { castHero, CREW8 } from '../lib/fx/workforce.js';
import { loadAnsur } from '../lib/fx/rig/body.js';
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const DUR = 3.2; window.DURATION = DUR;
const c = document.getElementById('out'), g = c.getContext('2d');
const st = new Stage({ W, H }); await st.init();
const A = await loadAnsur();
const WHO = [7, 3, 2, 0];
const hs = WHO.map(i => { const { opts, apply } = castHero(CREW8[i], A, { c7: true }); const h = st.hero(opts); apply(h); h.watch(st.camera); return h; });
st.scene.add(new THREE.HemisphereLight('#4a5470', '#1a1008', 0.55));
const key = new THREE.DirectionalLight('#fff0d8', 2.6), rim = new THREE.DirectionalLight('#a8c0ff', 2.2), low = new THREE.DirectionalLight('#ffb878', 0.7);
for (const l of [key, rim, low]) { st.scene.add(l); st.scene.add(l.target); }
const img = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = '../assets/roto/foundry_face.png'; });
function cgPanel(k, v, t) {
  hs.forEach((h, i) => { h.group.visible = i === k; });
  const h = hs[k];
  st.stand(h, { x: 0, z: 0, turn: -0.55, t: 'bind', head: 0.1 });
  const hd = h.joint('head'), tgt = hd.clone().add(V3(0, 0.03, 0)), d = v / 0.425;
  key.position.set(hd.x - 2.5, hd.y + 3.5, hd.z + 4); key.target.position.copy(hd);
  rim.position.set(hd.x + 3, hd.y + 2, hd.z - 4); rim.target.position.copy(hd);
  low.position.set(hd.x, hd.y - 2, hd.z + 3); low.target.position.copy(hd);
  st.lookAt(V3(tgt.x + 0.1, tgt.y + 0.02, tgt.z + d), tgt, 24);
  st.renderLit();
}
window.renderFrame = async (t) => {
  g.fillStyle = '#0b0d14'; g.fillRect(0, 0, W, H);
  const k = Math.min(3, Math.floor(t / 0.8)), sw = Math.sin(t * 2) * 0.01;
  for (const [row, v] of [[0, 0.8], [1, 1.6]]) {
    const y0 = row * 960;
    const gr = g.createRadialGradient(270, y0 + 300, 20, 270, y0 + 300, 700); gr.addColorStop(0, '#3a3a40'); gr.addColorStop(1, '#0b0d14');
    g.fillStyle = gr; g.fillRect(0, y0, 1080, 960);
    cgPanel(k, v, t); g.drawImage(st.canvas, 0, y0, 540, 960);
    // the matte: scaled so the head (hat top to chin, about 520 px of 863) is as tall as the CG head in this row
    const sc = (row ? 0.31 : 0.62) * (1 + sw);
    g.save(); g.beginPath(); g.rect(540, y0, 540, 960); g.clip();
    g.filter = 'brightness(1.15) contrast(1.1)'; g.drawImage(img, 540 + 270 - 300 * sc, y0 + 330 - 330 * sc, img.width * sc, img.height * sc); g.restore();
  }
  g.fillStyle = '#fff'; g.font = '28px monospace'; g.fillText('CG c7 | filmed 1936   head 1/3 (top) 1/6 (bottom)', 20, 40);
};
window.sceneInfo = { DUR }; window.sceneReady = true;
