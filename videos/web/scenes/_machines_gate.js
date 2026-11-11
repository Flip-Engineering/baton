// FIGURE GATE for WHO OWNS THE MACHINES (TRAJECTORY_MACHINES §2.3): the client's own poster crops against the two
// generated options, at 1080 x 1920 each, side by side: [poster crop | lib/fx/people.js | machines.figures.js].
//   ?mode=trucker  world A frame 0 (the OWN THE FUTURE crop, 06's box (120, 0, 1480, 1630) cover-fit)
//   ?mode=hardhat  world B (the JOIN ACP crop, box (0, 0, 980, 724) cover-fit)
//   ?mode=close    world A' at 1:1: the face (brim, nose, lips, chin) from each source
// Silhouettes only are judged: people.js is keyed to a flat silhouette and given the same rim pass as the vector figure.
import * as THREE from 'three';
import { People } from '../lib/fx/people.js';
import { loadImage } from '../lib/kit.js';
import * as F from './machines.figures.js';

const Q = new URLSearchParams(location.search), MODE = Q.get('mode') || 'trucker';
const W = 1080, H = 1920;
const out = document.getElementById('out'); out.width = W * 3; out.height = H;
const o = out.getContext('2d');
const otf = await loadImage('../../sources/acp_own_the_future.jpg'), join = await loadImage('../../sources/acp_join_banner.png');
const logo = await loadImage('../assets/acp_logo.png');
const tile = (() => { const c = document.createElement('canvas'); c.width = c.height = 200; const g = c.getContext('2d'); g.fillStyle = '#f2efe8'; g.fillRect(0, 0, 200, 200); g.drawImage(logo, 8, 8, 184, 184); return c; })();

// ---------------------------------------------------------------- column 1: the poster crop
function posterCrop(g, img, box, zoom = 1, fx = 0.5, fy = 0.5) {
  const [x0, y0, x1, y1] = box, bw = x1 - x0, bh = y1 - y0;
  const s = Math.max(W / bw, H / bh) * zoom, vw = W / s, vh = H / s;
  const sx = x0 + (bw - vw) * fx, sy = y0 + (bh - vh) * fy;
  g.drawImage(img, sx, sy, vw, vh, 0, 0, W, H);
}
// ---------------------------------------------------------------- column 2: people.js keyed to a silhouette
async function peopleShot(trade, view) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const r = new THREE.WebGLRenderer({ canvas: c, antialias: true, preserveDrawingBuffer: true }); r.setPixelRatio(1); r.setSize(W, H, false);
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#00ff00');
  scene.add(new THREE.HemisphereLight('#ffffff', '#444444', 1.2));
  const folk = new People(scene, { max: 4, viewH: H });
  const id = folk.add(People.random(trade, 5));
  const cam = new THREE.PerspectiveCamera(view.fov, W / H, 0.05, 100);
  folk.set(id, { x: 0, y: 0, z: 0, heading: view.heading, act: 'stand', t: 0.4 });
  cam.position.set(...view.pos); cam.lookAt(...view.look); cam.updateMatrixWorld();
  folk.update(cam); r.render(scene, cam);
  const k = document.createElement('canvas'); k.width = W; k.height = H; const kg = k.getContext('2d');
  kg.drawImage(c, 0, 0);
  const id2 = kg.getImageData(0, 0, W, H), d = id2.data;
  for (let i = 0; i < d.length; i += 4) { const key = d[i + 1] > 200 && d[i] < 80 && d[i + 2] < 80; d[i + 3] = key ? 0 : 255; d[i] = 16; d[i + 1] = 14; d[i + 2] = 16; }
  kg.putImageData(id2, 0, 0);
  r.dispose();
  return k;
}
// ---------------------------------------------------------------- the cold sky and the sunset (plain, for judging outlines)
function coldSky(g) {
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#242726'); gr.addColorStop(0.5, '#2F3832'); gr.addColorStop(0.86, '#626C65'); gr.addColorStop(0.95, '#6f6a5c'); gr.addColorStop(1, '#3a3632');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.fillStyle = '#E53239'; g.beginPath(); g.arc(W * 0.76, H * 0.14, 38, 0, Math.PI * 2); g.fill();
}
function sunSky(g) {
  const gr = g.createLinearGradient(0, 0, W * 0.4, H);
  gr.addColorStop(0, '#901B0D'); gr.addColorStop(0.5, '#CD3A0E'); gr.addColorStop(1, '#e8601a');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
}
const layer = document.createElement('canvas'); layer.width = W; layer.height = H; const L = layer.getContext('2d');

// the generated trucker at world A's frame 0: head units -> px
export const TRUCK0 = { x: 448, y: 1321, s: 620 };
function genTrucker(g, { close = false } = {}) {
  L.setTransform(1, 0, 0, 1, 0, 0); L.clearRect(0, 0, W, H);
  if (!close) F.drawRig(L, { tile, tileK: 0.62 });
  const T = close ? { x: 350, y: 800, s: 1900 } : TRUCK0;
  L.setTransform(T.s, 0, 0, T.s, T.x, T.y);
  const S = F.fillTrucker(L, { tilt: -0.56 });
  F.truckerDetail(L, S, { u: T.s, warm: 0.5, light: 'rgba(150,165,155,1)', tilt: -0.56 });
  L.setTransform(1, 0, 0, 1, 0, 0);
  F.rimLight(L, [{ dx: 0.45, dy: -0.9, w: 4, color: [120, 136, 126], a: 0.42 }, { dx: 1, dy: -0.2, w: 2, color: [200, 80, 70], a: 0.14 }]);
  g.drawImage(layer, 0, 0);
}
function genHardHat(g) {
  L.setTransform(1, 0, 0, 1, 0, 0); L.clearRect(0, 0, W, H);
  const S = F.hardHatShape({});
  F.fillHardHat(L, S);
  F.hardHatDetail(L, S, { sticker: tile });
  F.rimLight(L, [{ dx: 1, dy: -0.35, w: 7, color: [255, 128, 52], a: 0.85 }, { dx: 0.1, dy: -1, w: 3, color: [230, 90, 40], a: 0.45 }]);
  g.drawImage(layer, 0, 0);
}

window.renderFrame = async () => {
  o.clearRect(0, 0, W * 3, H);
  const col = i => { o.setTransform(1, 0, 0, 1, W * i, 0); o.save(); o.beginPath(); o.rect(0, 0, W, H); o.clip(); };
  if (MODE === 'trucker') {
    col(0); posterCrop(o, otf, [120, 0, 1480, 1630]); o.restore();
    col(1); coldSky(o); const p = await peopleShot('farm', { fov: 22, heading: Math.PI / 2, pos: [0.25, 1.55, 2.2], look: [0.3, 1.88, 0] }); o.drawImage(p, 0, 0); o.restore();
    col(2); coldSky(o); genTrucker(o); o.restore();
  } else if (MODE === 'hardhat') {
    col(0); posterCrop(o, join, [0, 0, 980, 724]); o.restore();
    col(1); sunSky(o); const p = await peopleShot('steel', { fov: 24, heading: Math.PI * 0.85, pos: [0.25, 1.75, 1.7], look: [0.0, 1.5, 0] }); o.drawImage(p, 0, 0); o.restore();
    col(2); sunSky(o); genHardHat(o); o.restore();
  } else if (MODE === 'overlay') {                                  // framing check only: the generated outline over the poster
    col(0); posterCrop(o, otf, [120, 0, 1480, 1630]); o.restore();
    col(1); posterCrop(o, otf, [120, 0, 1480, 1630]); o.globalAlpha = 0.55; genTrucker(o); o.globalAlpha = 1; o.restore();
    col(2); coldSky(o); genTrucker(o); o.restore();
  } else if (MODE === 'hhoverlay') {
    col(0); posterCrop(o, join, [0, 0, 980, 724]); o.restore();
    col(1); posterCrop(o, join, [0, 0, 980, 724]); o.globalAlpha = 0.55; genHardHat(o); o.globalAlpha = 1; o.restore();
    col(2); sunSky(o); genHardHat(o); o.restore();
  } else {
    col(0); posterCrop(o, otf, [120, 0, 1480, 1630], 3.2, 0.25, 0.9); o.restore();
    col(1); coldSky(o); const p = await peopleShot('farm', { fov: 9, heading: Math.PI / 2, pos: [0.25, 1.62, 2.0], look: [0.14, 1.72, 0] }); o.drawImage(p, 0, 0); o.restore();
    col(2); coldSky(o); genTrucker(o, { close: true }); o.restore();
  }
  o.setTransform(1, 0, 0, 1, 0, 0);
};
window.sceneReady = true;
