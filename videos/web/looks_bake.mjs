// LOOKS studio c1: bake the looks-reel sources (colour + designed-separation inputs) from the existing labs.
// Each source frame writes, under web/assets/looks_src/<name>/:
//   <k>_color.jpg  1080x1920, the lab's own render (what the published pieces would have shown)
//   <k>_aux.png    540x960 RGB: R,G = 16-bit log view depth (65535 = sky / no geometry), B = category
//                  (0 ground, 64 far rows / background mass, 128 mid structure, 180 spot cloth, 255 subject)
//   <k>_glow.png   540x960 grey: plume / steam coverage (plant only; lights come from the colour)
//   meta.json      { frames: [{k, t}], depth: [near, far] }
// Sources read the labs through their read-only window.__lab handles; no lab code is copied.
//   node web/looks_bake.mjs plant | crowd | hand   [--frames 0,0.0667,...]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleCache } from './cache_server.mjs';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..');
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const which = args[0];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.bin': 'application/octet-stream', '.bvh': 'text/plain', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  if (handleCache(req, res, ROOT)) return;
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const JOBS = {
  plant: { url: 'lab_americana2.html?shot=4', frames: [0], depth: [20, 12000], kind: 'world' },
  crowd: { url: 'lab_human.html?subject=crowd&mode=rim&layout=wall', frames: Array.from({ length: 31 }, (_, i) => +(i / 15).toFixed(4)), depth: [2, 160], kind: 'gb' },
  hand: { url: 'lab_human.html?subject=hand&mode=rim', frames: [1], depth: [0.1, 40], kind: 'gb' },
};
const J = JOBS[which]; if (!J) throw new Error('job: ' + Object.keys(JOBS).join('|'));
if (opt('frames')) J.frames = opt('frames').split(',').map(Number);
const OUT = path.join(HERE, 'assets', 'looks_src', which); fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on('console', m => { const s = m.text(); if (!/GPU stall|WebGL/.test(s)) console.log('[page]', s.slice(0, 300)); });
page.on('pageerror', e => console.error('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/web/scenes/${J.url}`);
await page.waitForFunction(() => window.sceneReady === true || window.sceneError, null, { timeout: 600000 });

// in-page: the separation inputs for the frame just rendered
const MASKS = async ({ kind, depth }) => {
  const THREE = await import('three');
  const w = 540, h = 960, L = window.__lab;
  let Z = new Float32Array(w * h), CAT = new Uint8Array(w * h), GL = new Uint8Array(w * h);
  if (kind === 'gb') {
    const { GBuffer } = await import('../lib/fx/gbuffer.js');
    const { scene, camera, renderer } = L;
    scene.traverse(o => { if (!o.isMesh) return; const d = o.userData;
      if (d.gbuffer === false) return;
      d._lk = d.subject; d.subject = d.rimSelf ? 0.7 : (d.rim === false ? 0 : 1);
      const U = o.material && o.material.userData && o.material.userData.fp;       // figure_pass bakes subject per material
      if (U) { d._lkU = U.fpSubj.value; U.fpSubj.value = d.subject; } });
    const a = L.fp ? L.fp.read(scene, camera) : new GBuffer(renderer, w, h).read(scene, camera);   // people.js figures only render through their FigurePass
    scene.traverse(o => { if (o.isMesh && '_lk' in o.userData) { o.userData.subject = o.userData._lk; delete o.userData._lk; if ('_lkU' in o.userData) { o.material.userData.fp.fpSubj.value = o.userData._lkU; delete o.userData._lkU; } } });
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {     // GL rows are bottom-up
      const i = (h - 1 - y) * w + x, j = y * w + x, z = a.nd[i * 4 + 3], s = a.uvm[i * 4 + 2];
      Z[j] = z; CAT[j] = z <= 0 ? 0 : s > 0.85 ? 255 : s > 0.5 ? 180 : 0;
    }
  } else {
    const { W, S } = L, A = W.atmos, r = W.renderer, sc = W.scene, cam = W.camera;
    const plant = new Set(); for (const m of S.plant.parts) m.traverse(o => plant.add(o));
    const V = `varying float vZ; varying vec2 vUv; void main(){ vUv = uv; vec4 lp = vec4(position, 1.);
      #ifdef USE_INSTANCING
      lp = instanceMatrix * lp;
      #endif
      vec4 mv = viewMatrix * modelMatrix * lp; vZ = -mv.z; gl_Position = projectionMatrix * mv; }`;
    const F = card => `uniform float uCat; uniform sampler2D tC; varying float vZ; varying vec2 vUv;
      void main(){ ${card ? 'vec4 c = texture2D(tC, vUv); if (c.r < .45) discard;' : ''} gl_FragColor = vec4(vZ, uCat, 0., 1.); }`;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType });
    const swaps = [], hid = [];
    sc.traverse(o => {
      if (o.isPoints || o.isLine || o.isSprite) { if (o.visible) { o.visible = false; hid.push(o); } return; }
      if (!(o.isMesh || o.isInstancedMesh)) return;
      const card = !!o.userData.card, name = (o.name || '').toLowerCase();
      const cat = plant.has(o) ? 1 : card ? 0.25 : /water|ground/.test(name) || o.userData.noReflect ? 0 : 0.5;
      const m = new THREE.ShaderMaterial({ uniforms: { uCat: { value: cat }, tC: { value: o.userData.cardTex || null } }, vertexShader: V, fragmentShader: F(card), side: THREE.DoubleSide });
      swaps.push([o, o.material]); o.material = m;
    });
    const tm = r.toneMapping, bg = sc.background, fog = sc.fog; r.toneMapping = THREE.NoToneMapping; sc.background = null; sc.fog = null;
    r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear(); r.render(sc, cam);
    const buf = new Float32Array(w * h * 4); r.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    // plumes: their card alpha, depth-tested against the structure just drawn
    const pl = []; A.overlay.traverse(o => { if (o.userData.plume) pl.push(o); });
    const ps = new THREE.Scene();
    const pm = new THREE.ShaderMaterial({ uniforms: { tP: { value: null } }, transparent: true, depthTest: true, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, side: THREE.DoubleSide,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; vec3 c = modelMatrix[3].xyz; vec3 right = normalize(vec3(viewMatrix[0][0], 0., viewMatrix[2][0]));
        vec3 w = c + right * position.x * length(modelMatrix[0].xyz) + vec3(0., position.y * length(modelMatrix[1].xyz), 0.); gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.); }`,
      fragmentShader: `uniform sampler2D tP; varying vec2 vUv; void main(){ float a = texture2D(tP, vUv).r; gl_FragColor = vec4(0., 0., smoothstep(.03, .75, a), 1.); }` });
    for (const o of pl) { const m = pm.clone(); m.uniforms.tP.value = o.userData.plumeTex; const q = new THREE.Mesh(o.geometry, m); q.position.copy(o.position); q.scale.copy(o.scale); q.frustumCulled = false; ps.add(q); }
    const rt2 = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, depthBuffer: true });
    // same depth: redraw the structure into rt2 as the occluder (colour masked by clearing afterwards)
    r.setRenderTarget(rt2); r.setClearColor(0x000000, 0); r.clear(); r.render(sc, cam);
    r.getContext().clearColor(0, 0, 0, 0); r.getContext().clear(r.getContext().COLOR_BUFFER_BIT);
    r.autoClear = false; r.render(ps, cam); r.autoClear = true;
    const pb = new Float32Array(w * h * 4); r.readRenderTargetPixels(rt2, 0, 0, w, h, pb);
    r.setRenderTarget(null); r.toneMapping = tm; sc.background = bg; sc.fog = fog;
    for (const [o, m] of swaps) { o.material.dispose(); o.material = m; } for (const o of hid) o.visible = true;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (h - 1 - y) * w + x, j = y * w + x, z = buf[i * 4], c = buf[i * 4 + 1];
      Z[j] = buf[i * 4 + 3] > 0 ? z : 0; CAT[j] = Z[j] <= 0 ? 0 : c > 0.9 ? 255 : c > 0.4 ? 128 : c > 0.1 ? 64 : 0;
      GL[j] = Math.round(255 * Math.min(1, pb[i * 4 + 2]));
    }
  }
  const [zn, zf] = depth, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d'), im = g.createImageData(w, h);
  for (let j = 0; j < w * h; j++) {
    const z = Z[j], l = z <= 0 ? 65535 : Math.round(65534 * Math.min(1, Math.max(0, Math.log(Math.max(z, zn) / zn) / Math.log(zf / zn))));
    im.data[j * 4] = l >> 8; im.data[j * 4 + 1] = l & 255; im.data[j * 4 + 2] = CAT[j]; im.data[j * 4 + 3] = 255;
  }
  g.putImageData(im, 0, 0); const aux = cv.toDataURL('image/png');
  for (let j = 0; j < w * h; j++) { im.data[j * 4] = im.data[j * 4 + 1] = im.data[j * 4 + 2] = GL[j]; im.data[j * 4 + 3] = 255; }
  g.putImageData(im, 0, 0); const glow = cv.toDataURL('image/png');
  return { aux, glow };
};

const meta = { frames: [], depth: J.depth, url: J.url, when: new Date().toISOString() };
for (const [k, t] of J.frames.entries()) {
  const t0 = Date.now();
  await page.evaluate(tt => window.renderFrame(tt), t);
  const shot = await (await page.$('#out') || await page.$('canvas')).screenshot({ type: 'jpeg', quality: 94, timeout: 600000 });
  fs.writeFileSync(path.join(OUT, `${k}_color.jpg`), shot);
  const m = await page.evaluate(MASKS, { kind: J.kind, depth: J.depth });
  fs.writeFileSync(path.join(OUT, `${k}_aux.png`), Buffer.from(m.aux.split(',')[1], 'base64'));
  if (J.kind === 'world') fs.writeFileSync(path.join(OUT, `${k}_glow.png`), Buffer.from(m.glow.split(',')[1], 'base64'));
  meta.frames.push({ k, t });
  console.log(`${which} ${k} t=${t} ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));
await browser.close(); server.close();
