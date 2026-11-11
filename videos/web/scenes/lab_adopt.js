// LAB / ADOPT (LOOKS c2, change C): a published piece finished in its chosen looks on its own moving camera.
//   lab_adopt.html?piece=giant|ownfuture2 [&look=AUTO|RAW|SODIUM|KLUTSIS...] [&list=1]
// The piece module runs untouched (its own renderFrame); this page reads its read-only window.__lab handle after each
// frame and builds the look's inputs from the LIVE scene:
//   colour  the piece's 3D render before its own post (no mythic bloom, no finish flash, no emissive type glow)
//   aux     an ID pass: every mesh keeps its own material (skinned people, instancing and custom shaders all work)
//           but writes colour only for one class at a time, everything else still occluding through depth; depth from
//           a depth texture of the same render, packed as the looks' 16-bit log depth
//   type    the piece's own words (its cue table), set black on clear, printed in the look's own ink
//   screen  the frame the screens are pinned to: a projected world anchor (the titan, the truck) gives origin and
//           scale, so a camera move carries the dots with the thing instead of swimming them over it (Obra Dinn)
// then prints the per-beat recipe (research/capabilities/looks.md, adoption tables) into #out.
import * as THREE from 'three';
import { Looks } from '../lib/fx/looks.js';

window.__adopt = true;
const Q = new URLSearchParams(location.search);
const PIECE = Q.get('piece') || 'giant', LOOKQ = Q.get('look') || 'AUTO';
const W = 1080, H = 1920, AW = 540, AH = 960;
const mk = (w = W, h = H) => Object.assign(document.createElement('canvas'), { width: w, height: h });
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const colC = mk(), colG = colC.getContext('2d'), typeC = mk(), typeG = typeC.getContext('2d'), shapeC = mk(), shapeG = shapeC.getContext('2d');
const auxC = mk(AW, AH), auxG = auxC.getContext('2d', { willReadFrequently: true });

await import(`./${PIECE}.js`);
const pieceRender = window.renderFrame, L = window.__lab;
if (!L) throw new Error('piece has no window.__lab handle');
const out = document.getElementById('out'), ctx = out.getContext('2d');

// ---------------------------------------------------------------- ID pass (class coverage + depth, live scene)
const idRT = new THREE.WebGLRenderTarget(AW, AH, { depthBuffer: true });
idRT.depthTexture = new THREE.DepthTexture(AW, AH); idRT.depthTexture.type = THREE.FloatType;
const linRT = new THREE.WebGLRenderTarget(AW, AH, { type: THREE.FloatType });
const linMat = new THREE.ShaderMaterial({ uniforms: { tD: { value: idRT.depthTexture }, near: { value: 0.5 }, far: { value: 30000 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
  fragmentShader: `uniform sampler2D tD; uniform float near, far; varying vec2 vUv;
    void main(){ float z = texture2D(tD, vUv).r; float ndc = z * 2. - 1.; float lin = 2. * near * far / (far + near - ndc * (far - near));
      gl_FragColor = vec4(z < .99999 ? lin : 0., 0., 0., 1.); }` });
const linScene = new THREE.Scene(), linCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
{ const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), linMat); q.frustumCulled = false; linScene.add(q); }
const px8 = new Uint8Array(AW * AH * 4), pxF = new Float32Array(AW * AH * 4);
// classes: codes as the looks read them (0 ground, 64 far, 128 mid, 180 spot, 255 subject); null = do not draw (sky)
function idPass(renderer, scene, camera, classify, depthRange) {
  const t0 = performance.now();
  const meshes = []; scene.traverse(o => { if ((o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) && o.visible) meshes.push(o); });
  const hid = []; scene.traverse(o => { if ((o.isPoints || o.isLine || o.isSprite) && o.visible) { o.visible = false; hid.push(o); } });
  const cls = new Map(); for (const m of meshes) { const c = classify(m); cls.set(m, c); if (c === null) { m.visible = false; hid.push(m); } }
  const mats = new Map(); for (const m of meshes) for (const mt of [].concat(m.material)) if (mt && !mats.has(mt)) mats.set(mt, { cw: mt.colorWrite, tr: mt.transparent });
  const prev = { rt: renderer.getRenderTarget(), ac: renderer.autoClear, cc: renderer.getClearColor(new THREE.Color()), ca: renderer.getClearAlpha(), bg: scene.background, fog: scene.fog, tm: renderer.toneMapping, ov: scene.overrideMaterial };
  scene.background = null; scene.fog = null; renderer.autoClear = true; renderer.setClearColor(0x000000, 0);
  // depth: one render of everything
  renderer.setRenderTarget(idRT); renderer.clear(); renderer.render(scene, camera);
  linMat.uniforms.near.value = camera.near; linMat.uniforms.far.value = camera.far;
  renderer.setRenderTarget(linRT); renderer.render(linScene, linCam); renderer.readRenderTargetPixels(linRT, 0, 0, AW, AH, pxF);
  const Z = new Float32Array(AW * AH); for (let y = 0; y < AH; y++) for (let x = 0; x < AW; x++) Z[y * AW + x] = pxF[((AH - 1 - y) * AW + x) * 4];
  // classes: colour written for one class at a time; the rest still writes depth (occludes)
  const CAT = new Uint8Array(AW * AH), codes = [...new Set([...cls.values()].filter(c => c !== null && c !== 0))];
  for (const code of codes) {
    for (const [mt] of mats) mt.colorWrite = false;
    for (const m of meshes) if (cls.get(m) === code) for (const mt of [].concat(m.material)) if (mt) mt.colorWrite = true;
    renderer.setRenderTarget(idRT); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, camera);
    renderer.readRenderTargetPixels(idRT, 0, 0, AW, AH, px8);
    for (let y = 0; y < AH; y++) for (let x = 0; x < AW; x++) { const i = ((AH - 1 - y) * AW + x) * 4; if (px8[i + 3] > 0 || px8[i] + px8[i + 1] + px8[i + 2] > 0) CAT[y * AW + x] = code; }
  }
  for (const [mt, s] of mats) { mt.colorWrite = s.cw; }
  for (const o of hid) o.visible = true;
  renderer.setRenderTarget(prev.rt); renderer.autoClear = prev.ac; renderer.setClearColor(prev.cc, prev.ca); scene.background = prev.bg; scene.fog = prev.fog;
  const [zn, zf] = depthRange, D = auxG.createImageData(AW, AH);
  for (let j = 0; j < AW * AH; j++) { const z = Z[j], l = z <= 0 ? 65535 : Math.round(65534 * clamp(Math.log(Math.max(z, zn) / zn) / Math.log(zf / zn)));
    D.data[j * 4] = l >> 8; D.data[j * 4 + 1] = l & 255; D.data[j * 4 + 2] = z <= 0 ? 0 : CAT[j]; D.data[j * 4 + 3] = 255; }
  auxG.putImageData(D, 0, 0);
  return performance.now() - t0;
}
const project = (v, cam) => { const p = v.clone().project(cam); return [(p.x * 0.5 + 0.5) * W, (-p.y * 0.5 + 0.5) * H, p.z]; };

// ---------------------------------------------------------------- list mode: what is in the scene (to write classify)
if (Q.get('list')) {
  await pieceRender(+(Q.get('t') || 10));
  const rows = []; const scenes = L.scene ? { main: L.scene } : L.scenes;
  for (const [k, sc] of Object.entries(scenes)) sc.traverse(o => { if (!(o.isMesh || o.isInstancedMesh || o.isPoints)) return;
    const pth = []; let p = o; while (p && p !== sc) { pth.push(p.name || p.type); p = p.parent; }
    rows.push([k, pth.reverse().join('/'), o.type, [].concat(o.material).map(m => m && (m.name || m.type)).join(','), o.count ?? '', o.geometry && o.geometry.type, Object.keys(o.userData).join(',')].join(' | ')); });
  for (const r of rows) console.log('L ' + r);
  window.sceneReady = true;
}


// ---------------------------------------------------------------- the pieces' recipes
const lk = new Looks();
const hits = JSON.parse(Q.get('hits') || 'null');
const PIECES = {};

// THE GIANT: SODIUM for the night climb, KLUTSIS from the topping out (b44) to the payoff. The city prints as one
// density mass (no window grid), the lattice as ink line (no bulb string), the type in the look's own ink.
PIECES.giant = () => {
  const { renderer, scene, camera, atm, folk, sky, ground, cityGroup, U, B } = L;
  const city = new Set(); cityGroup.traverse(o => city.add(o));
  const people = new Set(folk.meshes || []);
  const mask = 1 << (atm.maskLayer || 7);
  const classify = o => o === sky ? null : o === ground ? 0 : city.has(o) ? 64 : (people.has(o) || (o.layers.mask & mask)) ? 255 : 128;
  // the words: giant.js cue table (research/scripts_final/giant.json), set black for the look to print
  const HEAVES = [2, 4, 7, 12, 13, 17, 18, 19, 22, 26, 27, 31, 33, 34, 35, 36, 39, 40, 41, 46, 56, 58];
  const CALLS = [[0, 'HUMAN POWER.', 14], [1, 'ALL TOGETHER!', 14], [6, 'ALL TOGETHER!', 15], [10, 'LOCK IN!', 15], [16, 'GRAB A LINE!', 15],
    [24, 'UP SHE GOES!', 15], [30, 'ALL TOGETHER!', 15], [32, 'EVERYBODY!', 15], [38, 'TOP IT OUT!', 15], [44, 'ONE MORE!', 15],
    [47, 'ON YOUR FEET!', 14], [48, 'A NEW SUN.', 24], [50, 'A RED SUN.', 24], [52, 'ALL TOGETHER!', 15]];
  const CUES = [...CALLS.map(([b, text, f]) => ({ b, text, f })), ...HEAVES.map((b, i) => ({ b, text: 'HEAVE!', f: b >= 56 ? 16 : 6, heave: i }))];
  const HPOS = [[0, 1560, 250], [-60, 1450, 230], [50, 1600, 270], [0, 380, 240], [-40, 1500, 290], [40, 330, 250]];
  function words(t) {
    typeG.clearRect(0, 0, W, H); const f = Math.round(t * 30); let any = false;
    for (const c of CUES) { const f0 = Math.round(c.b * B.spb * 30); if (f < f0 || f >= f0 + c.f) continue; any = true;
      let x = W / 2, y = 1500, size = c.text.length > 11 ? 132 : 158;
      if (c.heave != null) { const [dx, yy, s0] = HPOS[c.heave % HPOS.length]; x += dx; y = yy; size = c.b >= 56 ? 330 : c.b === 46 ? 300 : s0 + 8 * (c.heave % 3); }
      if (c.b === 48 || c.b === 50) { y = 1560; size = 190; } if (c.b === 0) { y = 1520; size = 170; }
      typeG.save(); typeG.font = `${size}px Anton`; typeG.textAlign = 'center'; typeG.textBaseline = 'middle'; let sz = size;
      while (typeG.measureText(c.text).width > W - 120 && sz > 40) { sz -= 6; typeG.font = `${sz}px Anton`; }
      typeG.fillStyle = '#000'; typeG.fillText(c.text, x, y); typeG.restore(); }
    return any;
  }
  // the sun disc (the sky shader's), as the look's spot shape and anchor
  function sun() { const d = U.uSunDir.value, p = camera.position.clone().addScaledVector(d, 1000), [x, y, z] = project(p, camera);
    const r = Math.tan(U.uSunR.value) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * H / 2;
    shapeG.clearRect(0, 0, W, H); if (z < 1 && U.uSunI.value > 0.05) { shapeG.fillStyle = '#fff'; shapeG.beginPath(); shapeG.arc(x, y, r, 0, Math.PI * 2); shapeG.fill(); }
    return [x, y, Math.min(Math.max(r, 60), 240)]; }   // c2b: capped - the KLUTSIS band is sized from it
  // the screen frame: pinned to the titan (hip) so the gravure rides with him under the camera move
  const hip = () => { const g = folk.get(0); return g && g.visible ? new THREE.Vector3(g.x, g.y + 40, g.z) : new THREE.Vector3(0, 300, 0); };
  let ref = null;
  function screen() { const a = hip(), [x, y] = project(a, camera), d = camera.position.distanceTo(a), f = H / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), s = f / d;
    ref ||= s; return [x, y, clamp(s / ref, 0.6, 1.7)]; }
  const hit = hits?.pay ?? 26.238, slideT = hits?.slide ?? 25.072;   // c2b: 25.072 s is the last measured onset before the silence (flux 0.41, +0.9 dB); 25.538 s is not one
  const lookAt = t => { const b = B.beat(t); return b < 44 ? 'SODIUM' : 'KLUTSIS'; };
  return { classify, depth: [0.5, 30000], words, sun, screen, hit, slideT, lookAt,
    color: () => colG.drawImage(renderer.domElement, 0, 0, W, H), renderer, scene: () => scene, camera: () => camera };
};

// OWN THE FUTURE (c2b): SODIUM throughout. The green interstate signs stay SIGNS (spot class: umber panels under the
// lamps, their letters the lightest value), and the colour event lands on the measured onsets (7.047 s, the sign; 24.69 s,
// the payoff): the truck's full-spectrum beam reaches the panel and its real green comes back. The 2D layers OTF paints
// over its render (the trucker's profile, the pillars, the hood) are found as the difference between the composite and
// the 3D render and printed as the subject (the hero tone), nearest.
PIECES.ownfuture2 = () => {
  const { renderer, camera, scenes, comp } = L;
  const classify = o => {
    const m = [].concat(o.material)[0] || {}; const u = m.uniforms || {};
    if (m.side === THREE.BackSide && m.depthTest === false) return null;          // the sky dome
    if (u.lgOn) return 0;                                                          // the road / the yard
    if (u.sweep && u.map) return 180;                                              // a sign panel
    if (o.isInstancedMesh || o.isSkinnedMesh) return 255;                          // rigs, containers, people
    return 128; };
  const sceneOf = () => { let best = null, n = -1; for (const sc of Object.values(scenes)) { let v = 0; sc.traverse(o => { if (o.isMesh && o.visible) v++; }); if (v > n) { n = v; best = sc; } } return best; };
  let curScene = null;
  const d3 = mk(AW, AH), d3g = d3.getContext('2d', { willReadFrequently: true }), dc = mk(AW, AH), dcg = dc.getContext('2d', { willReadFrequently: true });
  // the 2D overlays: where the composite departs from the 3D render, the subject class, nearest depth
  function overlays() { d3g.drawImage(renderer.domElement, 0, 0, AW, AH); dcg.drawImage(comp.canvas || comp, 0, 0, AW, AH);
    const A = d3g.getImageData(0, 0, AW, AH).data, C = dcg.getImageData(0, 0, AW, AH).data, D = auxG.getImageData(0, 0, AW, AH); let n = 0;
    for (let j = 0; j < AW * AH; j++) { const i = j * 4, da = Math.abs(A[i] - C[i]) + Math.abs(A[i + 1] - C[i + 1]) + Math.abs(A[i + 2] - C[i + 2]);
      if (da > 70) { D.data[i] = 0; D.data[i + 1] = 40; D.data[i + 2] = 255; n++; } }
    auxG.putImageData(D, 0, 0); return n / (AW * AH); }
  // the beam target: the nearest visible sign panel, projected
  function beamAt() { let best = null; const sc = curScene; if (!sc) return null;
    sc.traverse(o => { const u = ([].concat(o.material)[0] || {}).uniforms; if (!o.isMesh || !o.visible || !u || !u.sweep) return;
      let vis = true; for (let p = o.parent; p; p = p.parent) if (!p.visible) vis = false; if (!vis) return;
      o.geometry.computeBoundingSphere(); const c = o.localToWorld(o.geometry.boundingSphere.center.clone()); const [x, y, z] = project(c, camera);
      if (z > 1 || x < -200 || x > W + 200 || y < -200 || y > H + 200) return; const d = camera.position.distanceTo(c);
      if (!best || d < best.d) best = { x, y, d, r: o.geometry.boundingSphere.radius * o.getWorldScale(new THREE.Vector3()).x }; });
    if (!best) return null; const f = H / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2); return [best.x, best.y, Math.max(260, 1.25 * best.r * f / best.d)]; }
  const HITS = hits?.list || [7.047, 24.69];
  return { classify, depth: [0.3, 9000], hero: { rank: -1, light: [-0.5, 0.6], rim: 1 }, overlays,
    color: () => colG.drawImage(comp.canvas || comp, 0, 0, W, H), renderer, scene: t => { try { const F = L.frame(t); curScene = F && F.S && scenes[F.S.world] ? scenes[F.S.world] : sceneOf(); } catch (e) { curScene = sceneOf(); } return curScene; }, /* the shot own world: frame(t) is pure in t */ camera: () => camera,
    lookAt: () => 'SODIUM', hits: HITS, beamAt };
};

// ---------------------------------------------------------------- frame
// ---------------------------------------------------------------- frame
if (!Q.get('list')) {
  const P = PIECES[PIECE]();
  window.renderFrame = async t => {
    const t0 = performance.now();
    await pieceRender(t);
    const info = { piece: PIECE, t, look: LOOKQ, piece_ms: Math.round(performance.now() - t0) };
    if (LOOKQ === 'RAW') { window.labInfo = info; return info; }          // the published render, untouched
    P.color();
    const t1 = performance.now();
    // c2b: &auxTwos=1 bakes the ID pass on twos (the print looks move on twos; the pass is the frame's main cost)
    const f2 = Math.floor(Math.round(t * 30) / 2);
    if (!(Q.get('auxTwos') === '1' && window.__auxF === f2)) { info.aux_ms = Math.round(idPass(P.renderer, P.scene(t), P.camera(), P.classify, P.depth)); window.__auxF = f2; }
    else { info.aux_ms = 0; P.scene(t); }
    if (P.overlays) info.overlay = +P.overlays().toFixed(3);
    const typed = P.words ? P.words(t) : false, an = P.sun ? P.sun() : [540, 700, 200], sc = P.screen && Q.get('pin') !== '0' ? P.screen() : [0, 0, 1];   // &pin=0: screen-space dots (the swim comparison)
    lk.source({ color: colC, aux: auxC, shape: shapeC, type: typeC, depth: P.depth, tonal: P.tonal || [], sky: 'designed', anchor: an, rankCut: false, ranks: null, hero: Q.get('hero') === '0' ? false : (P.hero || { rank: -1 }), tone: P.tone === false ? null : colC }, {});   // c2b: the live render IS the lit form: its tone, auto-levelled inside the subject
    const t2 = performance.now(), o = { screen: sc, fps: 30 };
    let look = LOOKQ === 'AUTO' ? P.lookAt(t) : LOOKQ;
    if (LOOKQ === 'AUTO' && P.event) { const r = P.event(t, o); info.phase = r.phase; info.k = r.k; look = r.look || look; }
    else lk.apply(ctx, look, t, o);
    info.look = look; info.look_ms = Math.round(performance.now() - t2); info.frame_ms = Math.round(performance.now() - t0); info.typed = typed;
    if (Q.get('marker') && P.hit && Math.round(t * 30) === Math.round(P.hit * 30)) { ctx.fillStyle = '#ff00ff'; ctx.fillRect(W - 64, 24, 40, 40); }
    window.labInfo = info; return info;
  };
  // GIANT's acts: the plate slide lands on the topping-out onset, the board lifts through the stop-time silence, the
  // composed red plate lands ON the re-entry (HEAVE!), the black plate walks back into register, the sheet settles
  if (PIECE === 'ownfuture2') P.event = (t, o) => { const h = P.hits.reduce((a, x) => Math.abs(x - t) < Math.abs(a - t) ? x : a, P.hits[0]);
    if (t < h - 0.4 || t > h + 1.2) { lk.apply(ctx, 'SODIUM', t, o); return { phase: 'hold', k: Math.round((t - h) * 30), look: 'SODIUM' }; }
    P._beam ||= {}; const bm = (P._beam[h] = P.beamAt() || P._beam[h] || [540, 700, 520]);
    // c2b: OTF cuts to TWELVE YEARS EARLY. one frame after the 7.047 onset. Keyed to the onset the colour lit HANG ON.
    // for one frame (a blink) and the cut carried the change; keyed to the cut (within the +-1 frame tolerance) the new
    // shot opens with its sign green and the cut and the colour are one hit. &lag=7.047:1,24.69:0 (frames)
    const LAG = Object.fromEntries((Q.get('lag') || '7.047:1').split(',').map(x => x.split(':').map(Number))), hk = h + (LAG[h] || 0) / 30;
    return { ...lk.event(ctx, 'SODIUM', t, { ...o, hitT: hk, beam: bm, beamFrom: [bm[0] + 320, bm[1] + 700] }), look: 'SODIUM' }; };
  // c2b: A RED SUN. (b50, the measured onset 23.433 s) is SODIUM's colour event: under the one-wavelength night the sun
  // disc has no colour until the hit, when full-spectrum light returns inside it (and on the titan in it); then the plate
  // slide at 25.072 s hands the piece to KLUTSIS for the silence and HEAVE!
  const RS = hits?.sun ?? 23.433;
  if (PIECE === 'giant') P.event = (t, o) => { if (t >= RS - 0.4 && t < P.slideT - 10 / 30) { const an = P.sun();
      return { ...lk.event(ctx, 'SODIUM', t, { ...o, hitT: RS, beam: [an[0], an[1], Math.max(an[2] * 2.4, 320), 0], beamFrom: [an[0] - 200, an[1] + 500] }), look: 'SODIUM' }; }
    return P.event2(t, o); };
  // c2b: the anticipation IS the stop-time silence (25.805-26.221 s, 13 frames)
  if (PIECE === 'giant') P.event2 = (t, o) => { const an = P.sun(), fo = t > RS ? { ...o, colev: 0.35, beam: [an[0], an[1], Math.max(an[2] * 2.4, 320) * 0.55, 0] } : o;
    const r = lk.event(ctx, 'KLUTSIS', t, { ...o, hitT: P.hit, from: 'SODIUM', fromOpts: fo, slideAt: P.slideT, antic: +(Q.get('antic') || 13) }); return { ...r, look: r.phase === 'before' ? 'SODIUM' : 'KLUTSIS' }; };
}
window.sceneReady = true;
window.adoptReady = true;
