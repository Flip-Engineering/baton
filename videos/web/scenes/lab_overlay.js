// Test page for lib/fx/overlay.js (run by videos/tools/overlay_test.mjs). window.overlayTest = { pass, lines }.
import * as THREE from 'three';
import { createOverlay, createThreeOverlay } from '../lib/fx/overlay.js';
const cv = document.getElementById('out'), g = cv.getContext('2d'), W = 360, H = 640;
const lines = []; let pass = true;
const check = (name, ok, extra = '') => { lines.push(`${ok ? 'ok  ' : 'FAIL'} ${name} ${extra}`); if (!ok) pass = false; };
const px = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data);
const bg = () => { g.fillStyle = '#20a0ff'; g.fillRect(0, 0, W, H); };

// 1. raw GL: a half-transparent red square (scissor clear) over a cyan-ish ground
{
  const ov = createOverlay(W, H, { scale: 0.5 });
  bg(); ov.begin(); const gl = ov.gl;
  gl.enable(gl.SCISSOR_TEST); gl.scissor(20, 20, 40, 40); gl.clearColor(0.5, 0, 0, 0.5); gl.clear(gl.COLOR_BUFFER_BIT); gl.disable(gl.SCISSOR_TEST);
  check('composite returns true', ov.composite(g));
  const inside = px(80, H - 80), outside = px(300, 300);   // scissor origin is bottom-left, at half scale: square = x40..120, y (H-120)..(H-40)
  check('untouched ground outside the layer', outside[0] === 0x20 && outside[2] === 0xff, JSON.stringify(outside));
  check('premultiplied red over ground', inside[0] > 0x80 && inside[0] < 0xd0 && inside[2] < 0xd0 && inside[2] > 0x40, JSON.stringify(inside));
  // clear each frame: begin() again then composite leaves the ground clean
  bg(); ov.begin(); ov.composite(g);
  check('begin() clears to transparent', px(80, H - 80)[0] === 0x20, JSON.stringify(px(80, H - 80)));

  // 2. context loss: composite is skipped and counted, restore calls back, drawing works again
  const ext = ov.gl.getExtension('WEBGL_lose_context');
  let restored = 0; ov.onRestore(() => restored++);
  ext.loseContext(); await new Promise(r => setTimeout(r, 60));
  bg(); check('lost: alive() false', !ov.alive());
  check('lost: composite skipped', ov.composite(g) === false && px(80, H - 80)[0] === 0x20 && ov.stats.lostFrames === 1);
  check('lost: begin() refuses', ov.begin() === false);
  ext.restoreContext(); await new Promise(r => setTimeout(r, 120));
  check('restored: alive and callback ran', ov.alive() && restored === 1, `restored=${restored}`);
  check('restored: begin() works', ov.begin() === true);
  ov.dispose();
}
// 3. three.js: a solid green plane fills the middle, corners stay transparent
{
  const t = createThreeOverlay(THREE, W, H, { scale: 0.5 });
  t.camera.position.set(0, 0, 5);
  t.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ color: 0x00ff00 })));
  bg(); check('three render true', t.render(g, { alpha: 1 }));
  const mid = px(W / 2, H / 2), corner = px(5, 5);
  check('three plane opaque at centre', mid[1] > 200 && mid[0] < 40, JSON.stringify(mid));
  check('three corner keeps the ground', corner[0] === 0x20 && corner[2] === 0xff, JSON.stringify(corner));
  t.dispose();
}
window.overlayTest = { pass, lines };
window.sceneReady = true;
