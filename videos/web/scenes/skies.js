// FROM THE SKIES? v2 (7 Oct): one continuous camera move through the night instead of six cuts; an electronic score (songs2/skies_e.py).
// FROM THE SKIES? (4 Oct 2026, new piece; concepts_20261004 #3). Mao, "Where Do Correct Ideas Come From?" (May 1963;
// research/sources/texts/mao-correct-ideas.txt), verbatim, answered by the ACP's own Declaration (21 Jul 2024; acp-declaration.txt):
// "Marxism-Leninism is not a doctrine born of pure thought, but real historical practice."
// The night sky over a steel plant (AMERICANA's integrated mill, 1.3 km off). Do they drop from the skies? The camera looks up at an empty
// sky. No. It comes down to the plant: the struggle for production; a crowd coming up the road: the class struggle; a radio dish on the
// ridge slewing to the sky: scientific experiment. Then the crowd fills the road toward the mill: a material force.
// Two renderers, one camera: the World (atmos, PLANT_NIGHT) draws the sky and the mill; a transparent People layer draws the crowd over it.
import * as THREE from 'three';
import { W, H, loadFonts, outCanvas, Finish, closer, clamp, lerp, ease } from '../lib/kit.js';
import { World } from '../lib/fx/world3d.js';
import { LOOKS3, LightField, patchMaterial } from '../lib/fx/atmos3d.js';
import * as CT from '../lib/fx/americana_city.js';
import { People, TRADES } from '../lib/fx/people.js';
import { loadAnsur } from '../lib/fx/rig/body.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const ctx = outCanvas();
await loadFonts();
await (async () => { const f = new FontFace('Big Shoulders Display', 'url(../node_modules/@fontsource/big-shoulders-display/files/big-shoulders-display-latin-900-normal.woff2)', { weight: '900' }); document.fonts.add(await f.load()); })();
await loadAnsur();
const finish = new Finish(1963);
const H01 = x => { const s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const E = ease.inOutCubic;

export const TL = { ask: 0, skies: 3.0, no1: 5.0, mind: 6.0, no2: 8.0, practice: 9.0, production: 13.0, classs: 16.0, science: 19.0, grasped: 22.0, force: 25.5, world: 28.5, acp: 32.0, real: 35.5, mark: 40, end: 44 };

// ------------------------------------------------------------------ the world: the mill at night (as lab_americana shot 4)
// GRAPHICS 4.B (8 Oct, opt-in): practicals 2 (?practicals=2, or window.ACP_FX = { practicals: 2 }) stands the crowd in the World instead of
// pasting it from a second renderer, so it takes the world's haze, grade and depth (a marcher hides a lamp behind him) and 4x MSAA in place of
// the layer's own. Its materials take the road's lightmap (patchMaterial, chained over people.js's skinning), and the four lamps over the
// march's tail are real lights. Gone with the second renderer: its ACES, its fixed hemisphere, mill and rim lights, and the drawImage paste;
// the crowd's key is the world's own (the Atmos key). The lamp sprites get fractional occlusion. ?lampgain= / ACP_FX.lampGain for the
// re-grade. ?view=mask (ACP_FX.view = 'mask'), for measuring the crowd's light: the crowd white, everything else black, no type (practicals
// 2: hidden by the world where the world is in front; 1: the pasted layer). Without these knobs nothing here changes.
const FX = window.ACP_FX || {}, QS = new URLSearchParams(location.search);
const P2 = +(QS.get('practicals') ?? FX.practicals ?? 1) >= 2, LAMPG = +(QS.get('lampgain') ?? FX.lampGain ?? 1), MASK = (QS.get('view') ?? FX.view) === 'mask';
const Wd = new World({ shadows: 0, atmos: P2 ? { look: LOOKS3.PLANT_NIGHT, samples: 4 } : LOOKS3.PLANT_NIGHT, far: 30000, near: 0.5 });
const A = Wd.atmos;
const lf = new LightField(A, { box: [-1400, -2200, 1600, 300], res: 2048, haloPx: 26, occTaps: P2 ? 8 : 1 });
{ const g = new THREE.PlaneGeometry(6000, 9400, 8, 8); g.rotateX(-Math.PI / 2); g.translate(0, 0, -4300); const m = new THREE.MeshStandardMaterial({ color: '#26241f', roughness: 0.95 }); patchMaterial(m, lf); Wd.scene.add(new THREE.Mesh(g, m)); }
const plant = new CT.Plant(Wd, lf, { origin: [60, 0, -1300], patch: patchMaterial });
const st = plant.stacks;
new CT.Plumes(A, lf, [
  { x: st[2].x, y: st[2].h, z: st[2].z, size: 8, rise: 240 }, { x: st[0].x, y: st[0].h, z: st[0].z, size: 6, rise: 180 },
  { x: 60 + 290, y: 44, z: -1360, size: 14, rise: 300 }, { x: 60 - 250, y: 125, z: -1470, size: 30, rise: 520 }, { x: 20, y: 90, z: -1320, size: 7, rise: 140 },
], { n: 320, gain: 1 });
// the road to the mill, its sodium lamps
const ROAD0 = lf.lights.length;
{ const g = new THREE.PlaneGeometry(14, 1300); g.rotateX(-Math.PI / 2); g.translate(0, 0.05, -650); const m = new THREE.MeshStandardMaterial({ color: '#1a1a1c', roughness: 0.6 }); patchMaterial(m, lf); Wd.scene.add(new THREE.Mesh(g, m));
  for (let z = -20; z > -1200; z -= 40) for (const sx of [-1, 1]) lf.add({ pos: [sx * 9, 9, z], color: '#ffb066', i: 2.0, core: 0.3, halo: 0.5, minPx: 1.2, pool: { r: 9, i: 22 } }); }
// the radio dish on the ridge west of the road (scientific experiment): a mast and a dish that slews up to the sky
const DISH = { x: -260, z: -420, y: 30 };
const dishM = new THREE.MeshStandardMaterial({ color: '#c8ccd2', roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide }); patchMaterial(dishM, lf, { wallFall: 80 });
const ridge = new THREE.Mesh(new THREE.ConeGeometry(180, DISH.y, 24, 1), (() => { const m = new THREE.MeshStandardMaterial({ color: '#1e1d1a', roughness: 0.95 }); patchMaterial(m, lf); return m; })()); ridge.position.set(DISH.x, DISH.y / 2, DISH.z); Wd.scene.add(ridge);
const dish = new THREE.Group(); dish.position.set(DISH.x, DISH.y, DISH.z); Wd.scene.add(dish);
{ const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2, 22, 10).translate(0, 11, 0), dishM); dish.add(mast); }
const bowl = new THREE.Group(); bowl.position.y = 23; dish.add(bowl);
{ const pts = []; for (let i = 0; i <= 16; i++) { const r = i / 16 * 18; pts.push(new THREE.Vector2(r, r * r / 60)); }
  const d = new THREE.Mesh(new THREE.LatheGeometry(pts, 48), dishM); d.rotation.x = -Math.PI / 2; bowl.add(d);
  const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 12, 6).rotateX(Math.PI / 2).translate(0, 0, 6), dishM); bowl.add(feed); }
lf.add({ pos: [DISH.x, DISH.y + 36, DISH.z], color: '#ff1a0a', i: 2.4, core: 0.5, halo: 0.6, minPx: 1.5, blink: { period: 1.5, duty: 0.35, phase: 0 } });
A.setTowns([{ x: 200, z: -1300, r: 900, i: 0.35 }, { x: -3000, z: -5000, r: 2500, i: 0.2 }]);
lf.build(); lf.animated = false;
// 4.B: the lamps over the march's tail (rows z -20 and -60, both sides) as real lights, at their pools' intensity, for the whole piece (one
// continuous shot), so every farm range draws the same frame: the camera is among or behind these rows whenever it is near the crowd
if (P2) for (let i = ROAD0; i < ROAD0 + 4; i++) lf.light(i, { gain: LAMPG });
function placeDish(t) { const u = E(clamp((t - TL.science) / 2.6)); bowl.rotation.set(lerp(-0.25, -1.1, u), lerp(0.4, -0.3, u), 0); }

// ------------------------------------------------------------------ the crowd layer: its own renderer, the same camera, a clear background
// (4.B practicals 2: none of it; the crowd is in the World's scene)
let pc, pr, ps = Wd.scene, pcam;
if (!P2) {
pc = document.createElement('canvas'); pc.width = W; pc.height = H;
pr = new THREE.WebGLRenderer({ canvas: pc, antialias: true, alpha: true, preserveDrawingBuffer: true });
pr.setPixelRatio(1); pr.setSize(W, H, false); pr.setClearColor(0, 0); pr.toneMapping = THREE.ACESFilmicToneMapping; pr.toneMappingExposure = 1.0; pr.outputColorSpace = THREE.SRGBColorSpace;
ps = new THREE.Scene();
ps.add(new THREE.HemisphereLight('#6a78a0', '#2a1a10', 0.55));
const millKey = new THREE.DirectionalLight('#ffa060', 2.2); millKey.position.set(60, 60, -1300); millKey.target.position.set(0, 0, 0); ps.add(millKey, millKey.target);   // the mill's glow ahead of them
const rim = new THREE.DirectionalLight('#ffcf90', 1.0); rim.position.set(0, 20, 60); ps.add(rim, rim.target);                                                       // the road's sodium behind
pcam = new THREE.PerspectiveCamera(40, W / H, 0.5, 30000);
}
const folk = new People(ps, { max: 420, viewH: H, budget: [40, 160], shadows: 'none', receiveShadow: false });
const FOLK = [];
for (let i = 0; i < 400; i++) {
  const lane = (H01(i * 3.7) - 0.5) * 11, z0 = -8 - i * 0.55 - H01(i * 5.1) * 0.6;
  FOLK.push({ id: folk.add(People.varied(TRADES[i % TRADES.length], 2100 + i)), x: lane, z0, seed: H01(i * 9.3), fist: H01(i * 1.9) < 0.4 });
}
// 4.B practicals 2: the figures take the lightmap over their own shading, and are posed for the World's camera inside its render (onBefore)
let crowdOn = false;
if (P2) { folk.eachMaterial(m => patchMaterial(m, lf)); Wd.onBefore.push(c => { if (crowdOn) folk.update(c); else for (const m of folk.meshes) m.visible = false; }); }
// 4.B measurement (?view=mask): the figures white over their own skinning; practicals 2: the world black (it still hides them where it is in front)
if (MASK) { const mine = new Set(folk.meshes), BLACK = new THREE.MeshBasicMaterial({ color: 0x000000 });
  if (P2) Wd.scene.traverse(o => { if (mine.has(o)) return; if (o.isMesh) o.material = BLACK; else if (o.isPoints || o.isLine) o.visible = false; }); else pr.toneMapping = THREE.NoToneMapping;
  folk.eachMaterial(m => { const prev = m.onBeforeCompile.bind(m), key = m.customProgramCacheKey.bind(m);
    m.onBeforeCompile = (sh, r) => { prev(sh, r); sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  gl_FragColor = vec4(1.0);'); };
    m.customProgramCacheKey = () => key() + '|mask'; }); }
function placeFolk(t) {
  for (const f of FOLK) {
    const walk = t - TL.practice, z = f.z0 - walk * 1.3, marching = t >= TL.classs;
    const fist = marching && f.fist;
    folk.set(f.id, { x: f.x + 0.2 * Math.sin(walk * 0.6 + f.seed * 6), y: 0, z, heading: Math.PI, act: fist ? 'march' : 'walk', ph: walk * 5.4 / 1.35 + f.seed * 3, amt: 1, speed: 1, t: t + f.seed, pump: fist ? Math.exp(-((t + 0.04) % 1) * 5) : null });
  }
}

// ------------------------------------------------------------------ the camera (one, for both layers)
// v2 (7 Oct; the client on v1: "none of the visual segments have appropriate transition"): ONE unbroken move instead of six set-ups. Up at the empty sky;
// down to the mill with the people already on the road to it; low behind them (social practice); rising over them to the furnaces ahead (production);
// swinging down in front of the march (class struggle); a long lens finding the dish slewing on the ridge from the march (experiment); the crane up over the
// masses; then on over their heads toward the mill under the sky (the Party's answer). Keyframes [t, pos, target, fov], Catmull-Rom through them.
const lead = t => -8 - (t - TL.practice) * 1.3;
const KF = [
  [0.0, [0, 1.7, 30], [0, 900, -60], 60], [4.7, [0, 1.7, 30], [0, 880, -200], 60],
  [6.2, [1, 1.6, 28], [20, 60, -1300], 34], [8.6, [3, 1.6, 22], [40, 40, -1300], 30],
  [10.6, [6, 3.2, 8], [0, 1.6, -45], 42], [12.8, [5, 5, 2], [10, 8, -120], 40],
  [15.4, [9, 24, -14], [60, 70, -1300], 30],
  [17.2, [4, 6, lead(17.2) - 24], [0, 1.6, lead(17.2) + 18], 40], [18.8, [3, 4.5, lead(18.8) - 26], [0, 1.5, lead(18.8) + 22], 40],
  [20.0, [-1, 4, lead(20) - 24], [-260, 48, -420], 16], [21.8, [-2, 4.5, lead(21.8) - 23], [-260, 60, -420], 13],
  [23.6, [10, 8, lead(23.6) + 34], [0, 0, lead(23.6) - 30], 46], [27.5, [30, 60, lead(27.5) + 110], [0, 0, -420], 46],
  [31.5, [40, 90, lead(31.5) + 150], [0, 0, -900], 46],
  [35.5, [0, 70, -200], [60, 90, -1300], 44], [40.0, [-20, 30, -500], [60, 120, -1300], 44],
];
function cr(p0, p1, p2, p3, u) { const u2 = u * u, u3 = u2 * u; return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3); }
function cam(t) {
  t = clamp(t, 0, KF[KF.length - 1][0]);
  let i = 0; while (i < KF.length - 2 && t >= KF[i + 1][0]) i++;
  const a = KF[Math.max(0, i - 1)], b = KF[i], c = KF[i + 1], d = KF[Math.min(KF.length - 1, i + 2)];
  const u = E(clamp((t - b[0]) / (c[0] - b[0])));
  const v = (k, j) => cr(a[k][j], b[k][j], c[k][j], d[k][j], u);
  const dir = q => { const x = q[2][0] - q[1][0], y = q[2][1] - q[1][1], z = q[2][2] - q[1][2], l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };   // the look DIRECTION is splined, not the point (targets 45 m and 1300 m away made it swing behind)
  const da = dir(a), db = dir(b), dc = dir(c), dd = dir(d), dv = [0, 1, 2].map(j => cr(da[j], db[j], dc[j], dd[j], u)), dl = Math.hypot(...dv);
  const pos = [0, 1, 2].map(j => v(1, j));
  return { pos, target: pos.map((p, j) => p + dv[j] / dl * 200), fov: cr(a[3], b[3], c[3], d[3], u) };
}

// ------------------------------------------------------------------ the words (house: solid type on a solid band, complete on the hit frame)
const FONT = '"Big Shoulders Display", "Anton", sans-serif';
const STOCK = '#EFE6CF', INK = '#15110F', HRED = '#D71920';
const CUES = [
  [0.3, 4.9, ['WHERE DO', 'CORRECT IDEAS', 'COME FROM?'], 330, 140, 'main'],
  [TL.skies, TL.no1, ['DO THEY DROP', 'FROM THE SKIES?'], 330 + 3 * 171, 110, 'main'],
  [TL.no1, TL.mind, ['NO.'], 420, 300, 'red'],
  [TL.mind, TL.no2, ['ARE THEY INNATE', 'IN THE MIND?'], 330, 132, 'main'],
  [TL.no2, TL.practice, ['NO.'], 420, 300, 'red'],
  [TL.practice, TL.production, ['THEY COME FROM', 'SOCIAL PRACTICE,'], 330, 132, 'main'], [11.0, TL.production, ['AND FROM IT ALONE;'], 330 + 2 * 161, 120, 'hot'],
  [TL.production, TL.classs, ['THE STRUGGLE', 'FOR PRODUCTION,'], 330, 140, 'main'],
  [TL.classs, TL.science, ['THE CLASS', 'STRUGGLE'], 330, 170, 'main'],
  [TL.science, TL.grasped, ['AND SCIENTIFIC', 'EXPERIMENT.'], 330, 140, 'main'],
  [TL.grasped, TL.force, ['ONCE THE CORRECT IDEAS', 'ARE GRASPED', 'BY THE MASSES,'], 330, 112, 'main'],
  [TL.force, TL.world, ['THESE IDEAS TURN', 'INTO A', 'MATERIAL FORCE'], 330, 130, 'hot'],
  [TL.world, TL.acp - 0.1, ['WHICH CHANGES SOCIETY', 'AND CHANGES', 'THE WORLD.'], 330, 116, 'main'],
  [29.4, TL.acp - 0.1, ['MAO ZEDONG · WHERE DO CORRECT IDEAS COME FROM? · 1963'], 1250, 32, 'sub'],
  [TL.acp, TL.real, ['MARXISM–LENINISM', 'IS NOT A DOCTRINE', 'BORN OF PURE THOUGHT,'], 330, 116, 'main'],
  [TL.real, TL.mark - 0.1, ['BUT REAL', 'HISTORICAL', 'PRACTICE.'], 360, 180, 'red'],
  [36.2, TL.mark - 0.1, ['AMERICAN COMMUNIST PARTY · DECLARATION · 21 JULY 2024'], 1250, 36, 'sub'],
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
    const age = t - a, al = clamp((b - t) / 0.12), fr = age * 30;
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
const sync = r => { const gl = r.getContext(), px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };   // before each copy (THE LADDER v1's black frames)
function maskFrame(ts, C) {   // 4.B measurement: the crowd white on black, through the same camera (no haze, grade, type or finish)
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  if (ts < TL.no1) return {};
  if (P2) { const k = Wd.camera, r = Wd.renderer, tm = r.toneMapping; k.position.set(...C.pos); k.up.set(0, 1, 0); k.lookAt(...C.target); if (k.fov !== C.fov) { k.fov = C.fov; k.updateProjectionMatrix(); }
    k.updateMatrixWorld(); folk.update(k); r.toneMapping = THREE.NoToneMapping; r.setRenderTarget(null); r.setClearColor(0, 1); r.clear(); r.render(Wd.scene, k); r.toneMapping = tm; sync(r); ctx.drawImage(Wd.canvas, 0, 0, W, H); }
  else { placeFolk(ts); pcam.position.set(...C.pos); pcam.fov = C.fov; pcam.updateProjectionMatrix(); pcam.lookAt(new THREE.Vector3(...C.target)); folk.update(pcam); pr.render(ps, pcam); sync(pr); ctx.drawImage(pc, 0, 0, W, H); }
  return {};
}
window.renderFrame = async (t) => {
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  const ts = Math.min(t, TL.mark - 1e-3), C = cam(ts);
  placeDish(ts);
  if (P2) { crowdOn = ts >= TL.no1; if (crowdOn) placeFolk(ts); }      // 4.B: the crowd in the World, from b5 as before
  if (MASK) return maskFrame(ts, C);
  Wd.render(C, ts); sync(Wd.renderer);
  ctx.drawImage(Wd.canvas, 0, 0, W, H);
  if (!P2 && ts >= TL.no1) {
    placeFolk(ts);
    pcam.position.set(...C.pos); pcam.fov = C.fov; pcam.updateProjectionMatrix(); pcam.lookAt(new THREE.Vector3(...C.target));
    folk.update(pcam); pr.render(ps, pcam); sync(pr);
    ctx.drawImage(pc, 0, 0, W, H);
  }
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
