// WHO OWNS THE DATA (4 Oct 2026, new piece; concepts_20261004 extension). The ACP's dispatch "Against the Palantir Agenda" (June
// 2025; research/sources/texts/acp-d-against-palantir-agenda.txt), verbatim, set over an aisle walled floor to ceiling with citizens'
// files: one index card a person, to the vanishing point. On ALL AMERICANS ACROSS THE AISLE the files fall and the people behind
// them step into the aisle; FORMING A POPULAR FRONT is them, side by side. (Program media idea 19: the wall of files.) Not used:
// the dispatch's claims about foreign services. Distinct from MELTDOWN's file. 60 BPM: beats = seconds.
import * as THREE from 'three';
import { W, H, loadFonts, outCanvas, Finish, closer, clamp, lerp, ease } from '../lib/kit.js';
import { People, TRADES } from '../lib/fx/people.js';
import { loadAnsur } from '../lib/fx/rig/body.js';
import { Print } from '../lib/fx/print.js';
import { fpPatchScene, FigurePass } from '../lib/fx/figure_pass.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const ctx = outCanvas();
await loadFonts();
await (async () => { const f = new FontFace('Big Shoulders Display', 'url(../node_modules/@fontsource/big-shoulders-display/files/big-shoulders-display-latin-900-normal.woff2)', { weight: '900' }); document.fonts.add(await f.load()); })();
await loadAnsur();
const finish = new Finish(2025);
const H01 = x => { const s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export const TL = { db: 0, assault: 5.8, power: 11.2, duo: 16.2, fraud: 20.8, aisle: 24.5, unite: 28.2, front: 31.7, rights: 35.2, mark: 40, end: 44 };

// ------------------------------------------------------------------ renderer
const glc = document.createElement('canvas'); glc.width = W; glc.height = H;
const renderer = new THREE.WebGLRenderer({ canvas: glc, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H, false); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1; renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#05070a'); scene.fog = new THREE.FogExp2('#05070a', 0.022);
const camera = new THREE.PerspectiveCamera(40, W / H, 0.05, 400);
scene.add(new THREE.HemisphereLight('#b8c6e0', '#1a1814', 0.55));
const key = new THREE.DirectionalLight('#e8eeff', 1.4); key.position.set(0.5, 6, 3); scene.add(key, key.target);

// ------------------------------------------------------------------ the aisle: a polished floor, ceiling strip lights, two walls of files
let STRIPS; const AW = 2.2, ROWS = 9, CW = 0.62, CH = 0.42, GAP = 0.06, LENZ = 160, COLS = Math.floor(LENZ / (CW + GAP));
let FLOOR; { const f = FLOOR = new THREE.Mesh(new THREE.PlaneGeometry(12, LENZ + 20).rotateX(-Math.PI / 2).translate(0, 0, -LENZ / 2 + 6), new THREE.MeshStandardMaterial({ color: '#16181c', roughness: 0.35, metalness: 0.2 })); scene.add(f);
  const strips = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 0.04, 2.2), new THREE.MeshBasicMaterial({ color: '#dfe8ff' }), Math.floor(LENZ / 4)), o = new THREE.Object3D();
  for (let i = 0; i < strips.count; i++) { o.position.set(0, ROWS * (CH + GAP) + 0.9, 4 - i * 4); o.updateMatrix(); strips.setMatrixAt(i, o.matrix); } scene.add(strips); STRIPS = strips; }
// the cards: eight drawn variants (an ID photo, a name, fields, a number, a barcode), each an InstancedMesh
function cardTex(v) {
  const c = document.createElement('canvas'); c.width = 372; c.height = 252; const g = c.getContext('2d'), r = k => H01(v * 31.7 + k);
  g.fillStyle = '#e9e2cf'; g.fillRect(0, 0, 372, 252); g.fillStyle = ['#7d8a96', '#8b7a66', '#6f8070', '#8a6f6f'][v % 4]; g.fillRect(0, 0, 372, 26);
  g.fillStyle = '#c9c2b0'; g.fillRect(18, 42, 104, 132); g.fillStyle = '#4a4744';                         // the photo: a head and shoulders
  g.beginPath(); g.ellipse(70, 92, 26 + 6 * r(1), 31 + 4 * r(2), 0, 0, Math.PI * 2); g.fill(); g.beginPath(); g.ellipse(70, 172, 52, 40, 0, Math.PI, 0); g.fill();
  g.fillStyle = '#2b2a28'; g.font = 'bold 22px monospace'; g.fillText(`${String(100 + Math.floor(r(3) * 560))}-${String(10 + Math.floor(r(4) * 89))}-${String(1000 + Math.floor(r(5) * 8999))}`, 140, 62);
  for (let k = 0; k < 6; k++) { g.fillStyle = k % 2 ? '#8d877a' : '#5d5951'; g.fillRect(140, 84 + k * 18, 90 + 120 * r(6 + k), 7); }
  for (let x = 140; x < 352; x += 3 + Math.floor(r(x) * 3)) { g.fillStyle = '#1f1e1c'; g.fillRect(x, 200, 1 + Math.floor(r(x + 1) * 2), 34); }
  const T = new THREE.CanvasTexture(c); T.colorSpace = THREE.SRGBColorSpace; T.anisotropy = 8; return T;
}
const cardG = new THREE.PlaneGeometry(CW, CH);
const CARDS = [];                    // { side, row, col, x, y, z, mesh, idx, seed }
const MESHES = [];
for (let v = 0; v < 8; v++) { const m = new THREE.InstancedMesh(cardG, new THREE.MeshStandardMaterial({ map: cardTex(v), roughness: 0.75 }), Math.ceil(2 * ROWS * COLS / 8) + 8); m.count = 0; m.frustumCulled = false; scene.add(m); MESHES.push(m); }
for (const side of [-1, 1]) for (let col = 0; col < COLS; col++) for (let row = 0; row < ROWS; row++) {
  const seed = H01(side * 7.3 + col * 1.31 + row * 9.7), m = MESHES[Math.floor(seed * 8)], idx = m.count++;
  CARDS.push({ side, row, col, x: side * AW, y: 0.35 + row * (CH + GAP), z: 2 - col * (CW + GAP), m, idx, seed });
}
for (const m of MESHES) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m.count * 3).fill(1), 3);
const _o = new THREE.Object3D(), _c = new THREE.Color();
// a card's fall: from the aisle's near end outward, they tip and drop flat to the floor
const fallAt = c => TL.aisle + 0.6 + Math.max(0, -c.z) * 0.035 + (ROWS - c.row) * 0.04 + 0.25 * c.seed;
function placeCards(t, tint) {
  for (const c of CARDS) {
    const a = t - fallAt(c);
    let y = c.y, rx = 0, dx = 0;
    if (a > 0) { const T = Math.min(a, 2.0); y = Math.max(0.012, c.y - 4.9 * T * T); rx = Math.min(Math.PI / 2, a * 3.2); dx = -c.side * Math.min(1, a * 1.4) * (0.2 + 0.6 * c.seed); }
    _o.position.set(c.x + dx, y, c.z); _o.rotation.set(0, -c.side * Math.PI / 2, 0); _o.rotateX(-rx * (y <= 0.013 ? 1 : 0.6)); _o.updateMatrix();
    c.m.setMatrixAt(c.idx, _o.matrix);
    tint(c, _c); c.m.setColorAt(c.idx, _c);
  }
  for (const m of MESHES) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
}
// the scan bar: a cool line that sweeps the files, flagging them red
const scan = new THREE.Mesh(new THREE.BoxGeometry(AW * 2 + 0.2, ROWS * (CH + GAP) + 0.4, 0.03), new THREE.MeshBasicMaterial({ color: '#ff3a2a', transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }));
scan.position.y = ROWS * (CH + GAP) / 2 + 0.2; scene.add(scan);
const scanZ = t => (t >= TL.power && t < TL.duo ? lerp(4, -60, (t - TL.power) / (TL.duo - TL.power)) : null);

// ------------------------------------------------------------------ the people behind the files
scene.traverse(o => { if (o.isMesh) o.userData.subject = 0; });                                    // the set is ground; anything the crowd adds later is subject
const folk = new People(scene, { max: 220, viewH: H, budget: [40, 140], shadows: 'none', receiveShadow: false });
for (const m of folk.meshes) m.userData.subject = 1;
// v2 (5 Oct, client: 'needs a better visual'): from ALL AMERICANS the piece is a linocut. Two blocks of people face each other
// across the gutter (the aisle), one in blue ink and one in red; on UNITE they walk into the gutter and the inks overprint; on
// FORMING A POPULAR FRONT they turn to us, one key block in black and red, fists on the beat.
const FOLK = [], FILES = 9;
for (const side of [-1, 1]) for (let k = 0; k < 90; k++) {
  const seed = 400 + k * 2 + (side > 0 ? 1 : 0), h = H01(seed), rank = Math.floor(k / FILES), file = k % FILES;
  FOLK.push({ side, rank, file, id: folk.add(People.varied(TRADES[(k + (side > 0 ? 2 : 0)) % TRADES.length], seed)), seed: h,
    jx: 0.14 * (H01(seed * 3) - 0.5), z: 0.4 - rank * 1.15 - 0.35 * H01(seed * 7) });
}
function placeFolk(t, hide = 0) {
  for (const f of FOLK) {
    if (t < TL.aisle || f.side === hide) { folk.set(f.id, { y: -500 }); continue; }
    const w0 = TL.unite + 0.2 + 0.05 * f.rank + 0.35 * f.seed, u = ease.inOutCubic(clamp((t - w0) / 1.7));
    const gap = lerp(1.25, 0.04, u), x = f.side * (gap + 0.3 + f.file * 0.58 + f.jx);
    const walking = t > w0 && u < 1, faceIn = -f.side * Math.PI / 2, faceUs = (H01(f.seed * 5.5) - 0.5) * 0.35;
    const turn = ease.inOutCubic(clamp((t - (TL.front - 0.4 + 0.15 * f.seed)) / 0.4));          // turned to us on the FRONT hit
    const fist = t > TL.front + 0.05 && H01(f.seed * 9.1) < 0.55;
    folk.set(f.id, { x, y: 0, z: f.z, heading: lerp(faceIn, faceUs, turn), act: walking ? 'walk' : fist ? 'fist' : 'stand', ph: (t - w0) * 5.2, t: t + f.seed, pump: fist ? Math.exp(-((t + 0.04 + 0.03 * f.rank) % 1) * 5) : null });
  }
}

// ------------------------------------------------------------------ the camera
const E = ease.inOutCubic;
function cam(t) {
  if (t < TL.assault) return { p: [0, 1.6, 3.5 - 0.9 * t], l: [0, 1.7, -40], fov: 46 };                                         // down the aisle
  if (t < TL.power) { const u = E((t - TL.assault) / (TL.power - TL.assault)); return { p: [lerp(0.6, 1.3, u), 1.36, lerp(-8, -9.2, u)], l: [AW, 1.32, -9.4], fov: 32 }; }   // one file
  if (t < TL.duo) return { p: [-1.2, 2.4, 2.5 - 0.6 * (t - TL.power)], l: [0.8, 1.6, -30], fov: 50 };                           // the scan
  if (t < TL.aisle) { const u = (t - TL.duo) / (TL.aisle - TL.duo); return { p: [0, lerp(4.2, 5.2, u), 3 - 2 * u], l: [0, 0.6, -80], fov: 44 }; }   // the archive to the vanishing point
  if (t < TL.front) { const u = (t - TL.aisle) / (TL.front - TL.aisle); return { p: [0, lerp(1.9, 1.7, u), lerp(4.6, 4.0, u)], l: [0, 1.3, -12], fov: 46 }; }   // across the gutter
  const u = E(clamp((t - TL.front) / (TL.mark - TL.front)));                                                                    // the front, from below it
  return { p: [0, lerp(0.85, 0.7, u), lerp(5.0, 3.9, u)], l: [0, lerp(1.75, 1.95, u), -16], fov: 44 };
}

// ------------------------------------------------------------------ the words (house: solid type on a solid band)
const FONT = '"Big Shoulders Display", "Anton", sans-serif';
const STOCK = '#EFE6CF', INK = '#15110F', HRED = '#D71920';
const outE = x => 1 - Math.pow(1 - clamp(x), 3);
const CUES = [
  [0.3, 5.6, ['A DATABASE'], 330, 150, 'main'], [1.4, 5.6, ['COMPILING THE', 'PERSONAL INFORMATION'], 330 + 183, 112, 'main'], [3.2, 5.6, ['OF AMERICAN CITIZENS.'], 330 + 183 + 273, 112, 'hot'],
  [5.8, 11.0, ['AN UNPRECEDENTED', 'ASSAULT'], 330, 130, 'main'], [7.6, 11.0, ['ON THE PRIVACY,', 'DIGNITY AND SECURITY', 'OF THE AMERICAN PEOPLE'], 330 + 317, 92, 'main'],
  [11.2, 16.0, ['NEARLY UNLIMITED POWER'], 330, 108, 'main'], [12.6, 16.0, ['TO CONTROL,', 'MANIPULATE,', 'AND ABUSE'], 330 + 132, 124, 'hot'], [14.6, 16.0, ['THE AMERICAN PUBLIC'], 330 + 132 + 454, 108, 'main'],
  [16.2, 20.6, ['REGARDLESS OF', 'THE PRESIDENTIAL', 'ADMINISTRATION'], 330, 118, 'main'], [18.2, 20.6, ['AND RULING', 'DUOPOLY PARTY.'], 330 + 432, 118, 'hot'],
  [20.8, 24.3, ['A FRAUDULENT', '“TECH BILLIONAIRE”', 'CLASS'], 330, 124, 'main'],
  [22.0, 24.3, ['AMERICAN COMMUNIST PARTY · AGAINST THE PALANTIR AGENDA · JUNE 2025'], 1250, 32, 'sub'],
  [24.5, 28.0, ['ALL AMERICANS', 'ACROSS THE AISLE'], 330, 140, 'main'],
  [28.2, 31.5, ['MUST COME TOGETHER', 'AND UNITE,'], 330, 124, 'main'],
  [31.7, 35.0, ['FORMING', 'A POPULAR FRONT'], 330, 140, 'red'],
  [35.2, 39.9, ['TO DEFEND OUR', 'CONSTITUTIONAL', 'RIGHTS'], 330, 140, 'red'],
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

// ------------------------------------------------------------------ the print (v2): linocut from the live crowd, the G-buffer steering the gouges
const pr = new Print({ ship: true }); pr.preload(['cream']);
const gb = new FigurePass(renderer, W / 2, H / 2);     // respects the crowd's instancing and skinning (GBuffer drew one figure at the origin)
const BLUE = '#1d3f8f', RED = '#d71920', PAPERC = new THREE.Color('#f4eee2');
const CUT = { pitch: 12, contour: 1, lino: 1, jag: 0.55, grain: 0.12, t1: 0.42, t2: 0.84 };
const PREP = { subject: 'aux', clear: 0.5, contrast: 0.8 };
const printLight = new THREE.DirectionalLight('#fff4e8', 1.3); printLight.position.set(-3, 5, 8); printLight.target.position.set(0, 1, -6); scene.add(printLight, printLight.target); printLight.visible = false;
function pass(t, hide) {
  placeFolk(t, hide); folk.update(camera);
  scene.traverse(o => { if (o.isMesh && o.userData.subject === undefined) o.userData.subject = 1; }); fpPatchScene(scene);   // once per material
  renderer.render(scene, camera); return gb.read(scene, camera);
}
function printFront(t) {
  printLight.visible = true; const fogW = scene.fog.density; scene.fog.density = 0.03;              // depth falls off to the stock
  const bg0 = scene.background, fc0 = scene.fog.color.clone(); scene.background = PAPERC; scene.fog.color.copy(PAPERC); FLOOR.visible = false;   // the figures on bare stock
  if (t < TL.front) {                                                                                 // two blocks, two inks, overprinting where they meet
    let aux = pass(t, 1); pr.render(ctx, glc, [['woodcut', { ...CUT, ink: BLUE }]], { t, paper: 'cream', aux, prep: PREP, out: null });
    aux = pass(t, -1); ctx.save(); ctx.globalCompositeOperation = 'multiply';
    pr.render(ctx, glc, [['woodcut', { ...CUT, ink: RED, alpha: 'ink' }]], { t, paper: 'cream', aux, prep: PREP, out: null }); ctx.restore();
  } else {                                                                                            // one block: key and red
    const aux = pass(t, 0);
    pr.render(ctx, glc, [['woodcut', { ...CUT, two: 1, ink2: 'acp' }]], { t, paper: 'cream', aux, prep: PREP, out: null });
  }
  scene.fog.density = fogW; printLight.visible = false; scene.background = bg0; scene.fog.color.copy(fc0); FLOOR.visible = true;
}

// ------------------------------------------------------------------ the frame
const closerCv = document.createElement('canvas'); closerCv.width = W; closerCv.height = H; const closerG = closerCv.getContext('2d');
window.renderFrame = async (t) => {
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  const ts = Math.min(t, TL.mark - 1e-3), sz = scanZ(ts);
  const duo = ts >= TL.duo && ts < TL.fraud;
  placeCards(ts, (c, col) => {
    let r = 1, g = 1, b = 1;
    if (sz !== null && c.z > sz) { r = 1.25; g = 0.55; b = 0.5; }                                                // flagged once the scan has passed
    if (duo) { const k = clamp((ts - TL.duo - 0.04 * c.col) * 2); const red = c.seed < 0.5; r = lerp(1, red ? 1.2 : 0.6, k); g = lerp(1, red ? 0.55 : 0.7, k); b = lerp(1, red ? 0.5 : 1.25, k);   // two colours ...
      const m = clamp((ts - TL.duo - 2.4) * 1.2); r = lerp(r, 0.85, m); g = lerp(g, 0.85, m); b = lerp(b, 0.85, m); }                                              // ... the same file
    col.setRGB(r, g, b);
  });
  scan.material.opacity = sz !== null ? 0.5 : 0; if (sz !== null) scan.position.z = sz;
  const C = cam(ts); camera.position.set(...C.p); camera.fov = C.fov; camera.updateProjectionMatrix(); camera.lookAt(V3(...C.l));
  const printed = ts >= TL.aisle;
  for (const m of [...MESHES, STRIPS]) m.visible = !printed;
  if (!printed) {
    placeFolk(ts); folk.update(camera);
    renderer.render(scene, camera);
    { const gl = renderer.getContext(), px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }   // sync before the copy (THE LADDER v1's black frames)
    ctx.drawImage(glc, 0, 0, W, H);
  } else if (window.__RAW) { placeFolk(ts); folk.update(camera); renderer.render(scene, camera); ctx.drawImage(glc, 0, 0, W, H); } else printFront(ts);
  if (t >= TL.mark) {
    const age = t - TL.mark; ctx.fillStyle = `rgba(4,3,6,${clamp(0.9 + age * 3, 0, 0.97)})`; ctx.fillRect(0, 0, W, H);
    closerG.clearRect(0, 0, W, H); closer(closerG, age); ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.drawImage(closerCv, 0, 0); ctx.restore();
    return {};
  }
  drawType(ctx, t);
  finish.apply(ctx, Math.round(t * 30), { grain: t >= TL.aisle ? 0.02 : 0.045, vignette: t >= TL.aisle ? 0.12 : 0.3 });
  return {};
};
ready = true;
