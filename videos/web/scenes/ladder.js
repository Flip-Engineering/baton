// THE LADDER (4 Oct 2026, new piece; concepts_20261004 #6). A steel ladder up the face of a tower at night, the city's windows on
// every side. Lenin, The Impending Catastrophe (1917): "socialism is now gazing at us from all the windows of modern capitalism";
// state-monopoly capitalism is "a rung on the ladder of history between which and the rung called socialism there are no
// intermediate rungs." The climb runs out of rungs at the parapet; over it, the Program's own plank (pharmaceutical companies
// into State-Owned Enterprises "with the mandate to cure diseases rather than profit from them") and the city's windows turn red
// from the tower outward. Sources: research/acp_program_media.md (l.71, the Program; §3 Lenin, CW 25, via marxists.org).
// World: AMERICANA city (Skyline, facade windows; facadeMaterial's red reveal), CITY_NIGHT. 60 BPM: beats = seconds.
import * as THREE from 'three';
import { W, H, loadFonts, outCanvas, Finish, closer, clamp, lerp, ease } from '../lib/kit.js';
import { World } from '../lib/fx/world3d.js';
import { LOOKS3, LightField, patchMaterial } from '../lib/fx/atmos3d.js';
import * as AM from '../lib/fx/americana.js';
import * as CT from '../lib/fx/americana_city.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const ctx = outCanvas();
await loadFonts();
await (async () => { const f = new FontFace('Big Shoulders Display', 'url(../node_modules/@fontsource/big-shoulders-display/files/big-shoulders-display-latin-900-normal.woff2)', { weight: '900' }); document.fonts.add(await f.load()); })();
const finish = new Finish(1917);

export const TL = { up: 0, wide: 8, down: 11, top: 19, rungs: 23.5, roof: 25, red: 27, all: 37, mark: 42, end: 46 };

// ------------------------------------------------------------------ the world
// 4x supersampled (5 Oct): at scale 1 the moving window grids aliased on some frames (speckle spikes ~30% on e.g. b9.13, b9.23), the client's
// 'weird graphical flickering'; at scale 2 every frame measures steady (scratchpad lfk/ng tests). World draws it down to 1080x1920.
// GRAPHICS 4.B (8 Oct, opt-in): practicals 2 (?practicals=2, or window.ACP_FX = { practicals: 2 }) makes the 15 wall packs real lights
// (LightField.light: spots down the face, so the steel, the facade and the brackets next to each pack are lit by it) and gives the lamp
// sprites fractional occlusion (a rung crossing a lamp dims it, no pop). The lights take the packs' pools over, so the 15 pools stacked at the
// ladder's foot are gone and the steel and parapet gains (0.22 and 0.25, cut to hide them) go back to 1. ?lampgain= / ACP_FX.lampGain for
// the re-grade. Without the knob nothing here changes.
const FX = window.ACP_FX || {}, QS = new URLSearchParams(location.search);
const P2 = +(QS.get('practicals') ?? FX.practicals ?? 1) >= 2, LAMPG = +(QS.get('lampgain') ?? FX.lampGain ?? 1);
const Wd = new World({ scale: 2, shadows: 0, atmos: LOOKS3.CITY_NIGHT, far: 40000, near: 0.2 });
const A = Wd.atmos;
const lf = new LightField(A, { box: [-6000, -6000, 6000, 6000], res: 2048, haloPx: 24, occTaps: P2 ? 8 : 1 });
{ const g = new THREE.PlaneGeometry(14000, 14000, 8, 8); g.rotateX(-Math.PI / 2); const m = new THREE.MeshStandardMaterial({ color: '#2a2824', roughness: 0.95 }); patchMaterial(m, lf);
  const gr = new THREE.Mesh(g, m); gr.userData.noReflect = true; Wd.scene.add(gr); }
// the city all round the tower, a clearing of a block (the tower stands at the origin, its ladder face toward +z)
const ring = (z0, z1, x0, x1, n, hMin, hMax, extra = {}) => ({ z0, z1, x0, x1, n, hMin, hMax, lit: 0.3, curtain: 0.4, ...extra });
// v3 (client, 4 Oct: 'vastly improved assets for cityscapes'): twice the towers, and a dense low-rise fabric between them so the city has no black holes
const rows = [
  ring(120, 420, -420, 420, 80, 20, 110, { gain: 0.8 }), ring(-120, -420, -420, 420, 70, 30, 140, { gain: 0.8 }),
  ring(-380, 380, 140, 520, 52, 25, 120, { gain: 0.8 }), ring(-380, 380, -520, -140, 52, 25, 120, { gain: 0.8 }),
  ring(600, 1400, -1100, 1100, 150, 40, 260, { peak: { x: -150, w: 500 }, curtain: 0.6 }), ring(-600, -1500, -1100, 1100, 120, 40, 240, { curtain: 0.6 }),
  ring(1700, 3600, -2400, 2400, 220, 25, 170), ring(-1800, -3800, -2400, 2400, 180, 25, 150),
  ring(130, 3600, -2600, 2600, 700, 8, 28, { lit: 0.25, curtain: 0.1, gain: 0.7, roofs: false }), ring(-130, -3800, -2600, 2600, 600, 8, 28, { lit: 0.25, curtain: 0.1, gain: 0.7, roofs: false }),
];
const sky = new CT.Skyline(Wd, lf, rows, { seed: 19 });
// the tower: 40 x 30 m, 184 m, its own facade; a parapet; the ladder bolted to the +z face at x = 14
const TOWER = { w: 40, d: 30, h: 184, lx: 14 };
const facade = CT.facadeMaterial(lf, { gain: 0.2 });           // a metre from the glass: dark curtain wall, mostly unlit (v2's flat cream slabs)
{ const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), m = new THREE.InstancedMesh(g, facade, 1), o = new THREE.Object3D();
  o.position.set(0, 0, -TOWER.d / 2); o.scale.set(TOWER.w, TOWER.h, TOWER.d); o.updateMatrix(); m.setMatrixAt(0, o.matrix); m.setColorAt(0, new THREE.Color('#7a746c'));
  m.geometry.setAttribute('iseed', new THREE.InstancedBufferAttribute(new Float32Array([41.3, 0.5, 0, 0]), 4)); m.frustumCulled = false; Wd.scene.add(m);   // half the floors lit
  sky.reds.push(facade.userData.red); }
const steel = new THREE.MeshStandardMaterial({ color: '#6a6e74', roughness: 0.55, metalness: 0.6 }); patchMaterial(steel, lf, { wallFall: 400, gain: P2 ? 1 : 0.22 });   // galvanized, not neon
const parapetM = new THREE.MeshStandardMaterial({ color: '#5c5852', roughness: 0.9 }); patchMaterial(parapetM, lf, { wallFall: 400, gain: P2 ? 1 : 0.25 });   // v1's coping glowed like a hot slab
{ const p = new THREE.Mesh(new THREE.BoxGeometry(TOWER.w + 0.6, 1.1, 0.5).translate(0, 0.55, 0), parapetM); p.position.set(0, TOWER.h, 0.0); Wd.scene.add(p);
  const p2 = p.clone(); p2.position.z = -TOWER.d; Wd.scene.add(p2);
  for (const sx of [-1, 1]) { const q = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, TOWER.d).translate(0, 0.55, -TOWER.d / 2), parapetM); q.position.set(sx * (TOWER.w / 2), TOWER.h, 0); Wd.scene.add(q); }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(TOWER.w, 0.2, TOWER.d).translate(0, 0.1, -TOWER.d / 2), parapetM); roof.position.y = TOWER.h; Wd.scene.add(roof); }
// the ladder: two flat-bar rails 0.45 m apart on stand-off brackets, round rungs every 0.3 m (12 in), from the street to the parapet
export const RUNG = 0.3, LTOP = TOWER.h - 0.15, LZ = 0.22;
{ const n = Math.floor(LTOP / RUNG), rg = new THREE.CylinderGeometry(0.016, 0.016, 0.45, 8).rotateZ(Math.PI / 2), rungs = new THREE.InstancedMesh(rg, steel, n), o = new THREE.Object3D();
  for (let i = 0; i < n; i++) { o.position.set(TOWER.lx, (i + 1) * RUNG, LZ); o.updateMatrix(); rungs.setMatrixAt(i, o.matrix); } rungs.frustumCulled = false; Wd.scene.add(rungs);
  for (const sx of [-1, 1]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.012, LTOP + 1.1, 0.065).translate(0, (LTOP + 1.1) / 2, 0), steel); r.position.set(TOWER.lx + sx * 0.235, 0, LZ); Wd.scene.add(r); }
  const nb = Math.floor(LTOP / 3), bg = new THREE.BoxGeometry(0.05, 0.05, LZ), br = new THREE.InstancedMesh(bg, steel, nb * 2); let k = 0;
  for (let i = 0; i < nb; i++) for (const sx of [-1, 1]) { o.position.set(TOWER.lx + sx * 0.235, 1.5 + i * 3, LZ / 2); o.updateMatrix(); br.setMatrixAt(k++, o.matrix); } br.frustumCulled = false; Wd.scene.add(br);
  // the rails' goosenecks over the parapet (the last rung is the last rung: the rails go over, nothing between)
  for (const sx of [-1, 1]) { const c = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.016, 6, 16, Math.PI), steel); c.rotation.y = Math.PI / 2; c.position.set(TOWER.lx + sx * 0.235, LTOP + 1.1, LZ - 0.4); Wd.scene.add(c); } }
// wall packs up the ladder (sodium, every 12 m) and the red beacon on the parapet
const PACK0 = lf.lights.length;
for (let y = 6; y < TOWER.h; y += 12) lf.add({ pos: [TOWER.lx - 2.2, y, 0.5], color: AM.SODIUM, i: 0.7, core: 0.3, halo: 0.4, minPx: 1.2, pool: { r: 4.5, i: 2.6 } });   // v3: at 5 the pools washed the near glass orange, at 1 the tower went black
lf.add({ pos: [TOWER.lx - 6, TOWER.h + 2.5, -1], color: '#ff1a0a', i: 2.6, core: 0.5, halo: 0.6, minPx: 1.6, blink: { period: 1.5, duty: 0.35, phase: 0 } });
{ const r = AM.rng(31);   // street lights, clustered on the grid
  for (let i = 0; i < 1400; i++) { const ang = r() * Math.PI * 2, d = 60 + Math.pow(r(), 0.8) * 4200; if (r() < 0.3) continue;
    const x = Math.round(Math.cos(ang) * d / 90) * 90 + (r() - 0.5) * 8, z = Math.round(Math.sin(ang) * d / 90) * 90;
    lf.add({ pos: [x, 8, z], color: r() < 0.7 ? AM.SODIUM : AM.LED, i: 1.8, core: 0.3, halo: 0.4, minPx: 1.1, pool: { r: 8, i: 12 } }); } }
A.setTowns([{ x: 0, z: 1800, r: 3000, i: 0.45 }, { x: 0, z: -2000, r: 3000, i: 0.35 }]);
lf.build(); lf.animated = true;
// 4.B: each pack a full-cutoff light at its pool's intensity: a spot straight down, 87 degrees, so it lights everything below its housing (the
// rails beside it from half a metre down, the wall under it in a scallop) and nothing above it or behind it; the same 15 for the whole piece,
// so every farm range draws the same frame. The 1,400 street lamps stay in the 2D map.
if (P2) for (let i = PACK0; i < PACK0 + 15; i++) lf.light(i, { kind: 'spot', angle: 1.52, penumbra: 0.3, gain: LAMPG });

// ------------------------------------------------------------------ the camera, shot by shot
const E = ease.inOutCubic;
function cam(t) {
  if (t < TL.wide) {                       // up the ladder from the rungs: the rails converge up the face into the night
    const y = 150 + 0.6 * t; return { pos: [TOWER.lx + 0.1, y, LZ + 1.6], target: [TOWER.lx - 0.3, y + 14, LZ - 1.0], fov: 56 };
  }
  if (t < TL.down) { const u = (t - TL.wide) / (TL.down - TL.wide);   // the tower in its city, from the air: a hairline of steel up the face
    return { pos: [lerp(150, 120, u), 190 + 6 * u, lerp(260, 220, u)], target: [8, 140, 0], fov: 34 }; }
  if (t < TL.top) { const u = (t - TL.down) / (TL.top - TL.down), y = 168 + 6 * u;   // down the ladder: the rungs drop away to the street
    return { pos: [TOWER.lx + 4, y + 1, LZ + 4.5], target: [TOWER.lx - 1, y - 35, LZ + 12], fov: 70 }; }
  if (t < TL.rungs) { const u = clamp((t - TL.top) / (TL.rungs - TL.top));   // the last rungs: the rails go over the parapet into the night, nothing above
    const y = lerp(LTOP - 8, LTOP - 2.5, E(u)); return { pos: [TOWER.lx + 0.05, y, LZ + 1.4], target: [TOWER.lx - 0.2, y + 8, LZ - 2], fov: 56 }; }
  if (t < TL.all) { const u = (t - TL.rungs) / (TL.all - TL.rungs);   // NO INTERMEDIATE RUNGS.: a cut over the parapet: the city, its windows going red from the tower out
    return { pos: [TOWER.lx - 1, LTOP + 2.6 + 3 * u, 0.6 + 2 * u], target: [lerp(-60, 120, E(u)), 70, 1500], fov: 46 }; }
  const u = clamp((t - TL.all) / (TL.mark - TL.all));      // the whole city, red, from high
  return { pos: [lerp(300, 420, u), lerp(520, 640, u), lerp(-700, -900, u)], target: [0, 60, 900], fov: 52 };
}
const RED_STEPS = [27.6, 28.9, 30.2, 31.5, 32.8, 34.1, 35.4];   // one district per plank, then the rest of the city
function redAt(t) {   // the red front: off until the plank, then from the tower out, a ring on each item, to the city's edge by FROM ALL THE WINDOWS.
  if (t < TL.red) return -1;
  const RR = [20, 300, 600, 950, 1350, 1800, 2400, 3200], R = k => RR[k];   // rings through the depth the camera sees (it looks out to ~3 km)
  let r = R(0);
  RED_STEPS.forEach((ts, i) => { r = lerp(r, R(i + 1), outE((t - ts) / 0.45)); });
  return lerp(r, 5200, outE((t - TL.all) / 2));
}

// ------------------------------------------------------------------ the words (house: solid type on a solid band)
const FONT = '"Big Shoulders Display", "Anton", sans-serif';
const STOCK = '#EFE6CF', INK = '#15110F', HRED = '#D71920';
const outE = x => 1 - Math.pow(1 - clamp(x), 3);
// [t0, t1, lines, y, size, style]
const CUES = [
  [0.3, 7.9, ['SOCIALISM IS NOW', 'GAZING AT US'], 330, 124, 'main'],
  [2.8, 7.9, ['FROM ALL THE WINDOWS'], 330 + 2 * 124 * 1.22, 112, 'hot'],
  [4.8, 7.9, ['OF MODERN CAPITALISM.'], 330 + 2 * 124 * 1.22 + 112 * 1.22, 112, 'main'],
  [5.6, 7.9, ['LENIN · 1917'], 1220, 44, 'sub'],
  [8.2, 10.9, ['STATE-MONOPOLY', 'CAPITALISM'], 330, 140, 'main'],
  [11.1, 13.9, ['IS A COMPLETE', 'MATERIAL PREPARATION', 'FOR SOCIALISM,'], 330, 116, 'main'],
  [14.0, 16.4, ['THE THRESHOLD', 'OF SOCIALISM,'], 330, 136, 'main'],
  [16.5, 18.9, ['A RUNG ON', 'THE LADDER', 'OF HISTORY'], 330, 140, 'main'],
  [19.2, 22.4, ['BETWEEN WHICH', 'AND THE RUNG', 'CALLED SOCIALISM'], 330, 132, 'main'],
  [22.4, 23.5, ['THERE ARE'], 330, 150, 'main'],
  [23.5, 26.6, ['NO', 'INTERMEDIATE', 'RUNGS.'], 330, 176, 'red'],
  [25.4, 26.6, ['LENIN · THE IMPENDING CATASTROPHE · 1917'], 1220, 40, 'sub'],
  // the Program's ownership planks, a list (client, 5 Oct: the lone pharma sentence was 'odd, cumbersome, tangential'; 'one of many'):
  // each item a district of the city going red (redAt steps with them)
  [27.0, 36.8, ['THE NATIONALIZATION OF'], 300, 96, 'prog'],
  [27.6, 36.8, ['THE ENERGY SECTOR,'], 300 + 127, 104, 'prog'],
  [28.9, 36.8, ['TELECOMMUNICATIONS,'], 300 + 127 * 2, 104, 'prog'],
  [30.2, 36.8, ['PHARMACEUTICALS,'], 300 + 127 * 3, 104, 'prog'],
  [31.5, 36.8, ['SOCIAL MEDIA MONOPOLIES,'], 300 + 127 * 4, 104, 'prog'],
  [32.8, 36.8, ['REAL ESTATE AND CONSTRUCTION,'], 300 + 127 * 5, 104, 'prog'],
  [34.1, 36.8, ['ALL STRATEGIC INDUSTRY'], 300 + 127 * 6, 104, 'progHot'],
  [35.4, 36.8, ['INTO STATE-OWNED ENTERPRISES.'], 300 + 127 * 7, 96, 'progHot'],
  [28.6, 36.8, ['THE PROGRAM · AMERICAN COMMUNIST PARTY'], 1770, 44, 'sub'],
  [37.6, 41.8, ['FROM ALL', 'THE WINDOWS.'], 330, 170, 'red'],
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
    const age = t - a, al = clamp((b - t) / 0.18), fr = age * 30;   // complete on its hit frame (the house strike; v1 faded in from nothing)
    const strike = fr < 3 ? 1.16 - 0.16 * fr / 3 : fr < 5 ? 1 - 0.03 * Math.sin((fr - 3) / 2 * Math.PI) : 1;   // in from 116%, a 2-frame squash
    lines.forEach((tx, i) => {
      const yy = y + i * size * 1.22, o = { a: al, strike: style === 'sub' ? 1 : strike };
      if (style === 'sub') line(g, tx, 540, yy, size, { ...o, fill: INK, band: STOCK });
      else if (style === 'red') line(g, tx, 540, yy, size, { ...o, fill: STOCK, band: HRED });
      else if (style === 'hot' || style === 'progHot') line(g, tx, 540, yy, size, { ...o, fill: HRED, band: STOCK });
      else line(g, tx, 540, yy, size, o);
    });
  }
}

// ------------------------------------------------------------------ the frame
const closerCv = document.createElement('canvas'); closerCv.width = W; closerCv.height = H; const closerG = closerCv.getContext('2d');
window.renderFrame = async (t) => {
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  const ts = Math.min(t, TL.mark - 1e-3);
  sky.setRed([0, 0], redAt(ts), 140);
  Wd.render(cam(ts), ts);
  { const gl = Wd.renderer.getContext(), px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }   // sync the GPU before the copy (v1 on the farm: single black frames)
  ctx.drawImage(Wd.canvas, 0, 0, W, H);
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
