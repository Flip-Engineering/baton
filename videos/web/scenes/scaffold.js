// SCAFFOLDING (4 Oct 2026, new piece; concepts_20261004 #8). Lenin, "Where to Begin?" (Iskra No. 4, May 1901; CW 5, pp. 13-24;
// research/sources/texts/lenin-where-to-begin-1901.txt), verbatim: the newspaper as "a collective organiser ... the scaffolding round a
// building under construction, which marks the contours of the structure and facilitates communication between the builders,
// enabling them to distribute the work and to view the common results achieved by their organised labour."
// A building going up at dusk inside a full scaffold. The scaffold's face is wrapped in one printed sheet (the article itself, set in
// columns); the wrap drops; the scaffold stands to the full height over the floors built so far (the contours); builders on every
// lift pass the work up; the crane lands a beam; at dawn they stand on the top deck and look at what they built. 60 BPM: beats = seconds.
import * as THREE from 'three';
import { W, H, loadFonts, outCanvas, Finish, closer, clamp, lerp, ease } from '../lib/kit.js';
import { People, TRADES } from '../lib/fx/people.js';
import { loadAnsur } from '../lib/fx/rig/body.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const ctx = outCanvas();
await loadFonts();
await (async () => { const f = new FontFace('Big Shoulders Display', 'url(../node_modules/@fontsource/big-shoulders-display/files/big-shoulders-display-latin-900-normal.woff2)', { weight: '900' }); document.fonts.add(await f.load()); })();
await loadAnsur();
const finish = new Finish(1901);
const H01 = x => { const s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const E = ease.inOutCubic;

export const TL = { sheet: 0, drop: 8.0, liken: 9.0, contours: 15.5, comm: 21.0, distribute: 27.0, view: 32.0, labour: 38.0, mark: 42, end: 46 };

// ------------------------------------------------------------------ renderer, sky (dusk to dawn), light
const glc = document.createElement('canvas'); glc.width = W; glc.height = H;
const renderer = new THREE.WebGLRenderer({ canvas: glc, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H, false); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0; renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 3000);
const skyTex = (() => { const c = document.createElement('canvas'); c.width = 4; c.height = 512; const T = new THREE.CanvasTexture(c); T.colorSpace = THREE.SRGBColorSpace; return { c, T }; })();
function paintSky(k) {     // k: 0 dusk .. 1 dawn
  const g = skyTex.c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 512);
  const top = new THREE.Color('#0d1430').lerp(new THREE.Color('#2a4a7a'), k), mid = new THREE.Color('#3c3050').lerp(new THREE.Color('#d88a5a'), k), low = new THREE.Color('#c0603a').lerp(new THREE.Color('#ffd4a0'), k);
  gr.addColorStop(0, '#' + top.getHexString()); gr.addColorStop(0.62, '#' + mid.getHexString()); gr.addColorStop(1, '#' + low.getHexString());
  g.fillStyle = gr; g.fillRect(0, 0, 4, 512); skyTex.T.needsUpdate = true;
}
scene.background = skyTex.T; scene.fog = new THREE.Fog('#2a2436', 150, 1400);
const hemi = new THREE.HemisphereLight('#8090c0', '#2a2018', 0.7); scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffb080', 1.2); sun.position.set(-200, 60, 160); scene.add(sun, sun.target);
const work = []; for (let i = 0; i < 6; i++) { const L = new THREE.PointLight('#ffcf8a', 30, 30, 1.6); scene.add(L); work.push(L); }

// ------------------------------------------------------------------ the ground, the site, a low city round it
const M = (c, r = 0.85, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), M('#2c2a26')));
{ const n = 220, city = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), M('#3a3a44', 0.9), n), o = new THREE.Object3D();
  for (let i = 0; i < n; i++) { const a = H01(i * 1.7) * Math.PI * 2, d = 120 + H01(i * 3.1) * 900; o.position.set(Math.cos(a) * d, 0, Math.sin(a) * d); o.scale.set(14 + 20 * H01(i * 5.3), 8 + 50 * Math.pow(H01(i * 7.7), 2), 14 + 20 * H01(i * 9.1)); o.updateMatrix(); city.setMatrixAt(i, o.matrix); }
  scene.add(city); }
// the building: 24 x 16 m, 22 floors of 3.6 m (79 m); built floors are slabs on columns, rising through the piece
const BW = 24, BD = 16, FH = 3.6, NF = 22, TOP = NF * FH;
const slabs = new THREE.InstancedMesh(new THREE.BoxGeometry(BW, 0.3, BD), M('#9a958c', 0.9), NF), cols = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, FH, 0.5), M('#8a857c', 0.9), NF * 12);
slabs.frustumCulled = cols.frustumCulled = false; scene.add(slabs, cols);
const builtAt = t => lerp(9, 16, E(clamp((t - TL.comm) / (TL.labour - TL.comm)))) + (t >= TL.labour ? 6 * E(clamp((t - TL.labour) / 3)) : 0);   // floors built
const _o = new THREE.Object3D();
function placeBuilding(t) {
  const nb = builtAt(t), nf = Math.floor(nb); let k = 0; _o.rotation.set(0, 0, 0);   // _o is shared: the braces left a 61-degree tilt on it (v1 stills: the floors sheared)
  for (let i = 0; i < NF; i++) { const on = i < nf ? 1 : i === nf ? (nb - nf) : 0;
    _o.position.set(0, (i + 1) * FH - 0.15, 0); _o.scale.set(on > 0 ? 1 : 1e-4, 1, on > 0 ? 1 : 1e-4); _o.updateMatrix(); slabs.setMatrixAt(i, _o.matrix);
    for (let cx = 0; cx < 4; cx++) for (let cz = 0; cz < 3; cz++) { _o.position.set(-BW / 2 + 1 + cx * (BW - 2) / 3, i * FH + FH / 2, -BD / 2 + 1 + cz * (BD - 2) / 2); _o.scale.set(1, on > 0 ? Math.max(0.01, on) : 1e-4, 1); _o.updateMatrix(); cols.setMatrixAt(k++, _o.matrix); } }
  slabs.instanceMatrix.needsUpdate = cols.instanceMatrix.needsUpdate = true;
}
// the scaffold: two rows of standards round the building (1.2 m out, 2.4 m bays), ledgers and boarded decks every 2 m lift, braces
const steel = M('#9aa2aa', 0.45, 0.7), board = M('#8a6a44', 0.85);
const LIFT = 2.0, NLIFT = Math.ceil((TOP + 3) / LIFT), OFF = 1.2, DECKW = 1.0;
const PER = []; { const xs = BW / 2 + OFF, zs = BD / 2 + OFF;     // perimeter points, the inner row of standards
  for (let x = -xs; x <= xs + 1e-6; x += 2.4) { PER.push([x, zs, 0, 1]); PER.push([x, -zs, 0, -1]); }
  for (let z = -zs + 2.4; z <= zs - 2.4 + 1e-6; z += 2.4) { PER.push([xs, z, 1, 0]); PER.push([-xs, z, -1, 0]); } }
{ const std = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.024, 0.024, NLIFT * LIFT, 6).translate(0, NLIFT * LIFT / 2, 0), steel, PER.length * 2);
  let k = 0; for (const [x, z, nx, nz] of PER) for (const d of [0, DECKW]) { _o.position.set(x + nx * d, 0, z + nz * d); _o.scale.set(1, 1, 1); _o.rotation.set(0, 0, 0); _o.updateMatrix(); std.setMatrixAt(k++, _o.matrix); }
  scene.add(std);
  const xs = BW / 2 + OFF, zs = BD / 2 + OFF, runs = [[-xs, zs, xs, zs], [-xs, -zs, xs, -zs], [xs, -zs, xs, zs], [-xs, -zs, -xs, zs]];
  const led = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.024, 0.024, 1, 6).rotateZ(Math.PI / 2), steel, NLIFT * runs.length * 2);
  const deck = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.05, DECKW), board, NLIFT * runs.length); let a = 0, b = 0;
  for (let l = 1; l <= NLIFT; l++) for (const [x0, z0, x1, z1] of runs) {
    const L = Math.hypot(x1 - x0, z1 - z0) + (x0 === x1 ? 0 : 0), ang = Math.atan2(-(z1 - z0), x1 - x0), nx = z0 === z1 ? 0 : Math.sign(x0), nz = z0 === z1 ? Math.sign(z0) : 0;
    for (const d of [0, DECKW]) { _o.position.set((x0 + x1) / 2 + nx * d, l * LIFT, (z0 + z1) / 2 + nz * d); _o.rotation.set(0, ang, 0); _o.scale.set(L + 2 * DECKW, 1, 1); _o.updateMatrix(); led.setMatrixAt(a++, _o.matrix); }
    _o.position.set((x0 + x1) / 2 + nx * DECKW / 2, l * LIFT + 0.03, (z0 + z1) / 2 + nz * DECKW / 2); _o.rotation.set(0, ang, 0); _o.scale.set(L + DECKW, 1, 1); _o.updateMatrix(); deck.setMatrixAt(b++, _o.matrix);
  }
  scene.add(led, deck);
  const nb = Math.floor(NLIFT / 2) * 4, br = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.02, 0.02, Math.hypot(LIFT * 2, 7.2), 5), steel, nb); let c = 0;
  for (let l = 0; l < NLIFT - 2; l += 2) for (const [x0, z0, x1, z1] of runs) { const mx = (x0 + x1) / 2 + (z0 === z1 ? 0 : Math.sign(x0) * DECKW), mz = (z0 + z1) / 2 + (z0 === z1 ? Math.sign(z0) * DECKW : 0);
    _o.position.set(mx, l * LIFT + LIFT, mz); _o.rotation.set(0, Math.atan2(-(z1 - z0), x1 - x0), Math.atan2(7.2, LIFT * 2) * ((l / 2) % 2 ? 1 : -1)); _o.scale.set(1, 1, 1); _o.updateMatrix(); if (c < nb) br.setMatrixAt(c++, _o.matrix); }
  br.count = c; scene.add(br); }
// the wrap: the article, set as a broadsheet on the scaffold's south face (+z); it drops at TL.drop
const WRAPW = BW + 2 * (OFF + DECKW) + 0.4, WRAPH = TOP + 3;
const SRC = 'A newspaper is not only a collective propagandist and a collective agitator, it is also a collective organiser. In this last respect it may be likened to the scaffolding round a building under construction, which marks the contours of the structure and facilitates communication between the builders, enabling them to distribute the work and to view the common results achieved by their organised labour. With the aid of the newspaper, and through it, a permanent organisation will naturally take shape that will engage, not only in local activities, but in regular general work, and will train its members to follow political events carefully, appraise their significance and their effect on the various strata of the population, and develop effective means for the revolutionary party to influence these events. ';
const wrapTex = (() => { const c = document.createElement('canvas'); c.width = 1024; c.height = Math.round(1024 * WRAPH / WRAPW); const g = c.getContext('2d');
  g.fillStyle = '#e6dfcc'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#1b1917';
  g.font = '900 120px "Big Shoulders Display", Anton, sans-serif'; g.textAlign = 'center'; g.fillText('WHERE TO BEGIN?', 512, 150); g.fillRect(40, 180, 944, 6); g.fillRect(40, 192, 944, 2);
  g.font = '24px serif'; g.textAlign = 'left'; const colW = 220, cx0 = 44; let col = 0, y = 240; const words = (SRC.repeat(14)).split(' '); let ln = '';
  for (const w of words) { const t = ln ? ln + ' ' + w : w; if (g.measureText(t).width > colW) { g.fillText(ln, cx0 + col * (colW + 22), y); ln = w; y += 29; if (y > c.height - 40) { y = 240; col++; if (col > 3) break; } } else ln = t; }
  for (let k = 1; k < 4; k++) g.fillRect(cx0 + k * (colW + 22) - 12, 230, 1.5, c.height - 270);
  const T = new THREE.CanvasTexture(c); T.colorSpace = THREE.SRGBColorSpace; T.anisotropy = 8; return T; })();
const wrap = new THREE.Mesh(new THREE.PlaneGeometry(WRAPW, WRAPH, 24, 60).translate(0, WRAPH / 2, 0), new THREE.MeshStandardMaterial({ map: wrapTex, roughness: 0.9, side: THREE.DoubleSide }));
wrap.position.set(0, 0, BD / 2 + OFF + DECKW + 0.15); scene.add(wrap);
const WP = wrap.geometry.getAttribute('position'), WP0 = Float32Array.from(WP.array);
function placeWrap(t) {
  const a = t - TL.drop; if (a > 3.2) { wrap.visible = false; return; } wrap.visible = true;
  for (let i = 0; i < WP.count; i++) { const x = WP0[i * 3], y = WP0[i * 3 + 1];
    const fall = a > 0 ? 4.9 * a * a * (0.7 + 0.3 * H01(Math.round(x))) : 0, ripple = 0.25 * Math.sin(x * 0.7 + t * 2.1) * Math.sin(y * 0.3 + t * 1.3);
    WP.array[i * 3 + 1] = Math.max(0.02, y - fall); WP.array[i * 3 + 2] = ripple + (a > 0 ? Math.min(6, a * a * 1.2) * (y / WRAPH) : 0); }
  WP.needsUpdate = true; wrap.geometry.computeVertexNormals();
}
// the crane: a tower crane west of the site; its jib slews, the trolley runs out, a steel beam comes down on the top deck
const crane = new THREE.Group(); scene.add(crane); crane.position.set(-BW / 2 - 14, 0, -2);
const craneM = M('#d8a020', 0.6, 0.3);
{ const mast = new THREE.Mesh(new THREE.BoxGeometry(2, TOP + 24, 2).translate(0, (TOP + 24) / 2, 0), craneM); crane.add(mast); }
const jib = new THREE.Group(); jib.position.y = TOP + 24; crane.add(jib);
{ const j = new THREE.Mesh(new THREE.BoxGeometry(60, 1.6, 1.6).translate(22, 0, 0), craneM); jib.add(j); const cw = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 3).translate(-12, -1, 0), M('#555')); jib.add(cw); }
const hook = new THREE.Group(); jib.add(hook);
const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 4).translate(0, -0.5, 0), M('#222')); hook.add(cable);
const beam = new THREE.Mesh(new THREE.BoxGeometry(8, 0.5, 0.35), M('#7a3a2a', 0.6, 0.4)); hook.add(beam);
function placeCrane(t) {
  const u = E(clamp((t - TL.distribute) / (TL.view - TL.distribute)));
  jib.rotation.y = lerp(0.9, 0.15, u); const tr = lerp(30, 16, u), drop = lerp(10, TOP + 24 - builtAt(t) * FH - 1.2, E(clamp((t - TL.distribute - 1.5) / 3.2)));
  hook.position.set(tr, 0, 0); cable.scale.y = drop; beam.position.y = -drop;
}

// ------------------------------------------------------------------ the builders: on the decks, at work; passing the work up the lifts
const folk = new People(scene, { max: 120, viewH: H, budget: [40, 110], shadows: 'none', receiveShadow: false });
const CREW = [];
for (let i = 0; i < 70; i++) {
  const s = H01(i * 4.7), p = PER[Math.floor(s * PER.length)], lift = 2 + Math.floor(H01(i * 8.1) * (NLIFT - 4));
  CREW.push({ id: folk.add(People.varied(TRADES[i % TRADES.length], 900 + i)), x: p[0] + p[2] * (DECKW / 2) + (H01(i * 2.2) - 0.5) * 1.2 * Math.abs(p[3]), z: p[1] + p[3] * (DECKW / 2) + (H01(i * 2.2) - 0.5) * 1.2 * Math.abs(p[2]),
    lift, face: Math.atan2(-p[2], -p[3]), seed: s });
}
function placeCrew(t) {
  const lastBuilt = Math.floor(builtAt(t) * FH / LIFT);
  for (const [i, c] of CREW.entries()) {
    const viewing = t >= TL.view;
    const lift = viewing ? Math.min(NLIFT - 1, lastBuilt + 1) : c.lift;                       // at the end they are all up on the top working deck
    const y = lift * LIFT + 0.06, pass = t >= TL.comm && t < TL.view;
    folk.set(c.id, { x: c.x, y, z: c.z, heading: viewing ? c.face + Math.PI + (c.seed - 0.5) * 0.6 : c.face + (pass ? Math.sin(t * 1.3 + i) * 0.8 : 0), act: viewing ? (c.seed < 0.35 ? 'fist' : 'stand') : 'work', ph: t * (0.7 + 0.4 * c.seed) + c.seed, t: t + c.seed, pump: viewing ? Math.exp(-((t + 0.04) % 1) * 5) : null });
  }
}

// ------------------------------------------------------------------ the camera
function cam(t) {
  if (t < TL.drop) { const u = E(t / TL.drop); return { p: [lerp(2, 10, u), lerp(42, 40, u), lerp(BD / 2 + 6, BD / 2 + 70, u)], l: [lerp(1, 0, u), lerp(46, 40, u), 0], fov: lerp(30, 50, u) }; }   // the sheet, then the wall it is
  if (t < TL.contours) { const u = E((t - TL.drop) / (TL.contours - TL.drop)); return { p: [lerp(10, 40, u), lerp(40, 30, u), lerp(BD / 2 + 70, 70, u)], l: [0, 36, 0], fov: 48 }; }
  if (t < TL.comm) { const u = E((t - TL.contours) / (TL.comm - TL.contours)); return { p: [lerp(60, 90, u), lerp(14, 22, u), lerp(110, 90, u)], l: [0, lerp(40, 46, u), 0], fov: 44 }; }   // the contours: low, the full height
  if (t < TL.distribute) { const u = E((t - TL.comm) / (TL.distribute - TL.comm)), y = lerp(14, 26, u); return { p: [BW / 2 + 9, y + 2, BD / 2 + 8], l: [BW / 2 - 2, y - 1, BD / 2 + 1.4], fov: 44 }; }   // along the decks, the hands
  if (t < TL.view) { const u = E((t - TL.distribute) / (TL.view - TL.distribute)); return { p: [lerp(-70, -60, u), lerp(60, 80, u), lerp(70, 50, u)], l: [-6, lerp(55, 62, u), 0], fov: 46 }; }   // the crane lands the beam
  const u = E(clamp((t - TL.view) / (TL.mark - TL.view)));                                                                          // dawn, the top deck, looking out with them
  const y = builtAt(t) * FH;
  return { p: [lerp(BW / 2 + 6, BW / 2 + 30, u), y + lerp(5, 22, u), lerp(BD / 2 + 10, BD / 2 + 50, u)], l: [lerp(0, -20, u), y - lerp(1, 6, u), lerp(-10, -80, u)], fov: 46 };
}

// ------------------------------------------------------------------ the words (house: solid type on a solid band)
const FONT = '"Big Shoulders Display", "Anton", sans-serif';
const STOCK = '#EFE6CF', INK = '#15110F', HRED = '#D71920';
const outE = x => 1 - Math.pow(1 - clamp(x), 3);
const CUES = [
  [0.3, 7.8, ['A NEWSPAPER', 'IS NOT ONLY'], 330, 140, 'main'], [1.8, 7.8, ['A COLLECTIVE PROPAGANDIST', 'AND A COLLECTIVE AGITATOR,'], 330 + 342, 92, 'main'],
  [4.0, 7.8, ['IT IS ALSO'], 330 + 342 + 225, 112, 'main'], [5.0, 7.8, ['A COLLECTIVE', 'ORGANISER.'], 330 + 342 + 225 + 137, 132, 'hot'],
  [6.0, 7.8, ['LENIN · WHERE TO BEGIN? · ISKRA, MAY 1901'], 1250, 38, 'sub'],
  [TL.liken, TL.contours - 0.2, ['IT MAY BE LIKENED', 'TO THE SCAFFOLDING', 'ROUND A BUILDING', 'UNDER CONSTRUCTION,'], 330, 112, 'main'],
  [TL.contours, TL.comm - 0.2, ['WHICH MARKS', 'THE CONTOURS', 'OF THE STRUCTURE'], 330, 136, 'main'],
  [TL.comm, TL.distribute - 0.2, ['AND FACILITATES', 'COMMUNICATION', 'BETWEEN THE BUILDERS,'], 330, 120, 'main'],
  [TL.distribute, TL.view - 0.2, ['ENABLING THEM', 'TO DISTRIBUTE', 'THE WORK'], 330, 136, 'main'],
  [TL.view, TL.labour - 0.1, ['AND TO VIEW', 'THE COMMON RESULTS', 'ACHIEVED BY THEIR'], 330, 120, 'main'],
  [TL.labour, TL.mark - 0.1, ['ORGANISED', 'LABOUR.'], 360, 200, 'red'],
];
function fit(g, text, size, maxW) { g.font = `900 ${size}px ${FONT}`; const w = g.measureText(text).width; return w > maxW ? size * maxW / w : size; }
function line(g, text, x, y, size, { fill = STOCK, band = INK, a = 1, strike = 1 } = {}) {
  const s = fit(g, text, size, 960 * 0.94); g.save(); g.globalAlpha = a; g.font = `900 ${s}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.letterSpacing = `${Math.round(s * 0.012)}px`;
  const w = g.measureText(text).width, padX = s * 0.22, padY = s * 0.16;
  g.translate(x, y - s * 0.36); g.scale(strike, strike); g.translate(-x, -(y - s * 0.36));
  g.fillStyle = band; g.fillRect(x - w / 2 - padX, y - s * 0.92 - padY * 0.4, w + 2 * padX, s * 0.92 + padY * 1.4);
  g.fillStyle = fill; g.fillText(text, x, y); g.restore();
}
function drawType(g, t) {
  for (const [a, b, lines, y, size, style] of CUES) {
    if (t < a || t >= b) continue;
    const age = t - a, al = clamp((b - t) / 0.15), fr = age * 30;   // complete on its hit frame (the house strike; v1 faded in from nothing)
    const strike = fr < 3 ? 1.16 - 0.16 * fr / 3 : fr < 5 ? 1 - 0.03 * Math.sin((fr - 3) / 2 * Math.PI) : 1;
    lines.forEach((tx, i) => {
      const yy = y + i * size * 1.22, o = { a: al, strike: style === 'sub' ? 1 : strike };
      if (style === 'sub') line(g, tx, 540, yy, size, { ...o, fill: INK, band: STOCK });
      else if (style === 'red') line(g, tx, 540, yy, size, { ...o, fill: STOCK, band: HRED });
      else if (style === 'hot') line(g, tx, 540, yy, size, { ...o, fill: HRED, band: STOCK });
      else line(g, tx, 540, yy, size, o);
    });
  }
}

// ------------------------------------------------------------------ the frame
const closerCv = document.createElement('canvas'); closerCv.width = W; closerCv.height = H; const closerG = closerCv.getContext('2d');
window.renderFrame = async (t) => {
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  const ts = Math.min(t, TL.mark - 1e-3), dawn = E(clamp((ts - TL.comm) / (TL.labour - TL.comm)));
  paintSky(dawn); sun.color.set(new THREE.Color('#ff9a60').lerp(new THREE.Color('#ffe0b8'), dawn)); sun.intensity = lerp(0.9, 2.2, dawn); sun.position.set(lerp(-200, 220, dawn), lerp(40, 90, dawn), lerp(160, -120, dawn));
  hemi.intensity = lerp(0.55, 1.0, dawn);
  placeBuilding(ts); placeWrap(ts); placeCrane(ts); placeCrew(ts);
  const y0 = builtAt(ts) * FH; work.forEach((L, i) => { L.position.set((i % 3 - 1) * 10, y0 - 1.5 - Math.floor(i / 3) * 10, BD / 2 - 1); L.intensity = lerp(40, 8, dawn); });
  const C = cam(ts); camera.position.set(...C.p); camera.fov = C.fov; camera.updateProjectionMatrix(); camera.lookAt(V3(...C.l));
  folk.update(camera);
  renderer.render(scene, camera);
  { const gl = renderer.getContext(), px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }   // sync before the copy (THE LADDER v1's black frames)
  ctx.drawImage(glc, 0, 0, W, H);
  if (t >= TL.mark) {
    const age = t - TL.mark; ctx.fillStyle = `rgba(4,3,6,${clamp(0.9 + age * 3, 0, 0.97)})`; ctx.fillRect(0, 0, W, H);
    closerG.clearRect(0, 0, W, H); closer(closerG, age); ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.drawImage(closerCv, 0, 0); ctx.restore();
    return {};
  }
  drawType(ctx, t);
  finish.apply(ctx, Math.round(t * 30), { grain: 0.045, vignette: 0.3 });
  return {};
};
ready = true;
