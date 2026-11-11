// THE GRAVEDIGGERS v3 (c21, 15 Oct 2026; v2 c20, v1 8 Oct; ACP OCTOBER ep. 1). v3 is v2's world cut to v1's pace (plan CUT, V3T:
// output time, mark at 37.5) with v1's launch out of the grave restored; the timeline below is the world's clock (ts), not the film's.
// v2: We look up from the floor of an open grave at the workers capital
// made. Out of the grave the camera climbs into a moonlit graveyard: two rows of headstones, one a year from 1979 to 2026, U.S. and Canada,
// each country's stones shrinking toward the grave by its own record of factory jobs (no chart, no figures, no credit: the stones carry
// it), inside an old graveyard. The plants' workers walk in, dig apart, then dig as one; they cut the ground from under the stones; their
// strikes go on and the buried plant comes up out of the earth, lit. Last, at the bottom of the grave, a sign, PRIVATE PROPERTY: two spits of
// earth land on it. The words are the Manifesto's (ch. 1, MIA's text of the 1888 English edition: "are its own grave-diggers"), verbatim.
//   0-7.5      frame 0: the grave from its floor (the older plant worker at the head end; the woman's cut on the west rim at 3.75)
//   7.5-10     the climb out of the mouth, the sky turning to the yard. Take a: 10-20 a slow track at eye height down the rows toward
//              the grave (the walk in crosses the lens). Take b: the crane goes on rising and draws back over the whole yard
//   15.0       the call: the crew digs as one; the walls between their pits break on the 16ths
//   20.0-27.5  the dig, close, in the U.S. trench; 27.5 the break (the walls slump, the stones lean); the wide: strikes at 30, 32.5,
//              35 and the plant rises (30-37.25), lit at 37.5, the camera eases to the grave
//   42.5       frame 0 again, lit; 47.5 he turns to the spoil; 50.0 the reverse: the sign; his spits land on it at 51.25 and 53.75; the
//              filled grave holds to the mark at 55.0
// v2 against v1: the people are the person pipeline's (v1's bearded man was the lead piece's figure: out, with its eye lamp); headstones in
// place of bars; the FACTORY JOBS band, its figures and its BLS credit gone; the overhead chart shot gone; the exposure held (v1 clipped
// the walls, the fog and the sign); 58.5 s in place of 39.
import * as THREE from 'three';
import { W, H, loadFonts, outCanvas, Finish, closer, clamp, SAFE_BAND } from '../lib/kit.js';
import { World } from '../lib/fx/world3d.js';
import { LOOKS3, LightField } from '../lib/fx/atmos3d.js';
import { People } from '../lib/fx/people.js';
import { loadAnsur } from '../lib/fx/rig/body.js';
import { loadPersonStudio } from '../lib/fx/person/index.js';
import { Eyes } from '../lib/fx/eyes.js';
import { loadBands, cueType, band, STYLES } from '../lib/fx/bands.js';
import { TL, V3T, cutAt, camCut, MOON_DIR, GRAVE, COL, data, cues, SUBS, camAt, applyCam, trenchX, stoneZ } from './gravediggers.plan.js';
import { buildCrew } from './gravediggers.crew.js';
import { buildWorld, BEACON_HOOK, RAKE_DIR, PLANT } from './gravediggers.world.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const ctx = outCanvas();
await loadFonts(); await loadBands();
const finish = new Finish(1848);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const [MAN, CAN] = await Promise.all([fetch('../assets/gravediggers/manemp.json').then(r => r.json()), fetch('../assets/gravediggers/canada.json').then(r => r.json())]);
const D = data(MAN, CAN), CUES = cues(D);

// ------------------------------------------------------------------ the world: one World and Atmos for every shot, toggled per shot
// The look is PLANT_NIGHT moved to a moonlit graveyard: a pale moonlit sky with low cloud crossing it (the sky rectangle reads pale over
// black earth), the moon low in the west (18 deg) as the Atmos key (a non-shadowing fill) and as the World's sun (the shadow chart).
// Values measured through a mirror of the grade in node: lit grass 0.54, the bars 0.00, a stone's top 0.86, the zenith 0.6.
const LOOK = { ...LOOKS3.PLANT_NIGHT,
  sky: { zen: ['#8a96b0', 0.21], horSun: ['#5c6274', 0.16], horAnti: ['#4c5466', 0.14], belt: ['#000000', 0], horExp: 0.5, stars: 0.04 },
  sun: { dir: [0, -0.5, 1], color: ['#000000', 0], disk: 0, light: 0 },
  moon: { dir: MOON_DIR, color: ['#b4c2e6', 0.22], light: 0.18 },
  hemi: { sky: ['#8090b0', 0.18], ground: ['#000000', 0] },
  fog: { d: 0.0005, h: 140, gain: 1, sun: 0.25, amb: ['#3a4256', 0.03], far: 9000 },
  clouds: { on: 1, h: 420, scale: 1 / 900, cover: 0.5, soft: 0.28, amb: ['#a8aec0', 0.15], sun: 0, fade: 1 / 20000 },
  towns: { color: ['#ff9448', 1] },
  exposure: 1.55, bloom: 0.1, floor: 0.03, white: 0.97,      // v2: the highlights held (v1's 2.3 / 0.86 clipped the walls, the sky and the sign)
  sat: 1.1, contrast: 1.12, shadowTint: [0, 0.004, 0.016], grain: 0, vignette: 0 };
const Wd = new World({ shadows: 2048, atmos: { look: LOOK, samples: 4, hook: BEACON_HOOK }, far: 30000, near: 0.03 });
const A = Wd.atmos, scene = Wd.scene, cam = Wd.camera;
A.U.uWind.value.set(0.021, 0.007);                                        // the low cloud crosses the mouth in the first seconds
const MOON = Wd.sun({ dir: MOON_DIR, color: '#c8d4f0', intensity: 5.3, area: 20, focus: [0, 0, -10], bias: -0.0003, normalBias: 0.02 });
// the plant's lights (one LightField over the plant) and the graveyard's fill (a second, pools only: the sky's light in the grave and the
// trench, on the earth, the stones and the sign; people and heroes are not patched with it, so it never lights a figure's front)
const lfPlant = new LightField(A, { box: [PLANT.origin[0] - 520, PLANT.origin[2] - 460, PLANT.origin[0] + 820, PLANT.origin[2] + 520], res: 2048, haloPx: 22, occTaps: 8 });
const lfGrave = new LightField(A, { box: [-7, -25, 7, 4], res: 1024, haloPx: 0 });
const FILL = { grave: lfGrave.add({ pos: [0, 0.2, 0], color: '#c4ccdc', i: 0, core: 0, halo: 0, pool: { r: 0.85, i: 10 } }) };
for (const [n, z] of [[0, -4.6], [1, -6.6], [2, -8.8], [3, -11.2]]) FILL['tr' + n] = lfGrave.add({ pos: [trenchX(COL.XU), 0.1, z], color: '#c4ccdc', i: 0, core: 0, halo: 0, pool: { r: 0.75, i: 8 } });

// ------------------------------------------------------------------ the crew, the ground, the props
const [ansur, personStudio] = await Promise.all([loadAnsur(), loadPersonStudio()]);
const crew = await buildCrew({ scene, ansur, personStudio, lf: lfGrave, field: 2400 });
const { folk, ew } = crew, { him, her, welder } = crew.heroes;
ew.surround({ size: 6000 });
const world = buildWorld({ scene, atmos: A, lfPlant, lfGrave, D });
lfPlant.build(); lfGrave.build(); lfPlant.animated = false;
// (v1's eye lamp, the lead's, that burned his face white from the floor, is gone: the moon from his right models the face)
// the eyes: the lead's Eyes, drawn in Atmos's emissive layer (after the haze, through the bloom and the exposure), hidden by what stands
// in front of them through the scene's depth (each eye's centre tested; from overhead not tested, as the lead's overhead)
const eyes = new Eyes(A.overlay, { max: 2700, size: 0.009, minPx: 1.6, halo: 4 });       // v2: a glint in the eye, not a lamp
eyes.material.vertexShader = `attribute float aOpen; attribute vec3 aCol; uniform float uScale, uSize, uMinPx, uHalo, uOcc; uniform sampler2D tDepth;
varying float vOpen; varying vec3 vCol; varying float vPx;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float px = max(uMinPx, uSize * uScale / max(0.05, -mv.z));
  vPx = px; vOpen = aOpen; vCol = aCol;
  gl_Position = projectionMatrix * mv;
  float sz = px * uHalo * (0.35 + 0.65 * aOpen);
  if (uOcc > 0.5) { vec3 ndc = gl_Position.xyz / gl_Position.w;
    if (abs(ndc.x) < 1.0 && abs(ndc.y) < 1.0 && texture2D(tDepth, ndc.xy * 0.5 + 0.5).r < ndc.z * 0.5 + 0.5 - 2e-6) sz = 0.0; }
  gl_PointSize = sz;
}`;
Object.assign(eyes.material.uniforms, { tDepth: A.frameU.tDepth, uOcc: { value: 1 } }); eyes.material.depthTest = false; eyes.material.needsUpdate = true;

// ------------------------------------------------------------------ shadows: each light's frustum fitted to the shot's ground (texel-tight)
function fitShadow(L, dir, box, { near0 = null } = {}) {
  const c = V3((box[0] + box[1]) / 2, (box[2] + box[3]) / 2, (box[4] + box[5]) / 2), d = V3(...dir).normalize(), R = 400;
  L.position.copy(c).addScaledVector(d, R); L.target.position.copy(c); L.target.updateMatrixWorld(); L.updateMatrixWorld();
  const S = L.shadow.camera; S.position.copy(L.position); S.lookAt(c); S.updateMatrixWorld();
  const inv = S.matrixWorldInverse, lo = V3(1e9, 1e9, 1e9), hi = V3(-1e9, -1e9, -1e9), p = V3();
  for (const x of [box[0], box[1]]) for (const y of [box[2], box[3]]) for (const z of [box[4], box[5]]) { p.set(x, y, z).applyMatrix4(inv); lo.min(p); hi.max(p); }
  Object.assign(S, { left: lo.x, right: hi.x, bottom: lo.y, top: hi.y, near: Math.max(0.5, -hi.z - 60), far: -lo.z + 5 });
  if (near0 != null) S.near = -p.copy(near0).applyMatrix4(inv).z;                 // nothing on the light's side of this point casts
  S.updateProjectionMatrix(); L.shadow.needsUpdate = true;
}
// per shot: the moon's ground (the overhead's from the frame's west edge: the walk in comes into frame with its shadows), the rake's
const SHADOW = {
  grave: [-3.2, 3.6, -2, 2.6, -3.4, 2.6], climb: [-14.5, 10, -1.2, 2.6, -30, 6], yard: [-14.5, 6, -1.2, 2.4, -27, 1], close: [-3.6, 7.5, -1.4, 2.2, -32, 0.5],
  wide: [-32, 32, -1.2, 2.2, -150, 6], reverse: [-2.4, 2.8, -2, 2.4, -2.6, 2.2] };

// ------------------------------------------------------------------ the people audit's CROTCH filter (the lead's, spectre.js): a pair
// counts only where this frame's lights, haze and grade would show the victim's crotch (>= 2/255). The crew is backlit by the moon (the
// west rim's backs to it), the hemisphere's ground is black and the fill pools never reach a figure; a front light added later brings
// the check straight back. Through the World's lights and a mirror of the Atmos grade + this scene's 2D grade.
const _hz = { p: V3(), n: V3(), l: V3(), c: new THREE.Color() }, lumOf = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const aces = x => clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14));
function crotchShows(id, camera) {
  const at = folk.att[id]; if (!at || !at.hips) return 1;
  const P = _hz.p.set(0, -0.1, 0.07).applyMatrix4(at.hips), N = _hz.n.copy(camera.position).sub(P).normalize(), hemi = Wd._hemi;
  let E = lumOf(_hz.c.copy(hemi.groundColor).lerp(hemi.color, 0.5 * N.y + 0.5)) * hemi.intensity;
  for (const L of [MOON, A.key, world.rake]) if (L.intensity > 0) E += lumOf(L.color) * L.intensity * Math.max(0, N.dot(_hz.l.copy(L.position).sub(L.target.position).normalize()));
  const x = E * lumOf(_hz.c.set(folk.get(id).d.bottom)) / Math.PI * LOOK.exposure;
  let m = Math.pow(aces(x), 1 / 2.2); m = clamp((m - LOOK.floor) / (LOOK.white - LOOK.floor)); m += (m * m * (3 - 2 * m) - m) * (LOOK.contrast - 1);
  return clamp(((m - 0.5) * 1.3 + 0.5) * 1.04);
}
folk.hazards = (camera, w, h, frac, minPx) => People.prototype.hazards.call(folk, camera, w, h, frac, minPx).filter(z => crotchShows(z.b, camera) >= 2 / 255);

// ------------------------------------------------------------------ the amber key (from 27.5): black and white with contrast 1.3, but the
// sodium and the furnace keep their colour (hues 8-52 deg with some saturation), weighted by K(t). A per-pixel pass (frontier4's toned()).
function amberKey(g, K) {
  const id = g.getImageData(0, 0, W, H), d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255, y = 0.2126 * r + 0.7152 * gg + 0.0722 * b, grey = clamp((y - 0.5) * 1.16 + 0.5);
    let keep = 0; const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), sat = mx > 0 ? (mx - mn) / mx : 0;
    if (sat > 0.16 && mx === r) { const hue = 60 * (((gg - b) / Math.max(1e-6, mx - mn) + 6) % 6); keep = K * sstep(0.16, 0.38, sat) * sstep(4, 12, hue) * (1 - sstep(48, 58, hue)); }
    if (keep <= 0) { const v = grey * 255; d[i] = d[i + 1] = d[i + 2] = v; continue; }
    for (let c = 0; c < 3; c++) { const v = d[i + c] / 255, col = clamp((v - 0.5) * 1.16 + 0.5); d[i + c] = (grey + (col - grey) * keep) * 255; }
  }
  g.putImageData(id, 0, 0);
}

// ------------------------------------------------------------------ the frame
const closerCv = document.createElement('canvas'); closerCv.width = W; closerCv.height = H; const closerG = closerCv.getContext('2d');
const WHITE = new THREE.Color('#ffffff');
const NEAR = { grave: 8, climb: 40, yard: 40, close: 30, wide: 34, reverse: 8 };
let lastShot = null;
window.__gd = { TL, V3T, cutAt, camCut, D, CUES, SUBS, crew, world, Wd, A, ew, cam, MOON, lfGrave, lfPlant, FILL, eyes, camAt, crotchShows };
window.renderFrame = async (t) => {
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  // v3: the cut (plan CUT): the world's clock ts runs on from each segment's offset; a segment may carry its own camera
  const seg = cutAt(t), ts = Math.min(t + seg[2], TL.mark - 1e-3), C = seg[3] ? camCut(seg[3], t) : camAt(ts), shot = C.shot;
  applyCam(cam, C);
  // the crew and the ground at ts (people posed, heroes solved, Earthwork replayed), then the props on them
  const pose = crew.pose(ts, cam, shot);
  world.placeStones(ts, ew);
  const k = world.update(ts, shot, cam);
  ew.update(ts, cam, { near: NEAR[shot] });
  // the light, per shot: the moon's shadow fitted to the shot; the fill pools in the grave (floor and reverse) and along the trench (close)
  if (shot !== lastShot) { fitShadow(MOON, MOON_DIR, SHADOW[shot]); lastShot = shot; }
  lfGrave.U.uLightGain.value = shot === 'grave' || shot === 'close' ? 0.7 : shot === 'reverse' ? 0.32 : 0;   // v2: the sky's fill in the grave low enough that the sign reads
  const rk = sstep(TL.lit, TL.lit + 0.25, ts);
  world.rake.intensity = 2.4 * rk * (shot === 'reverse' ? 0.3 : 1);      // v4: the sign shot is moonlit with a breath of the plant's amber (the rake made the spits a flat orange disc) if (rk > 0) fitShadow(world.rake, RAKE_DIR, SHADOW[shot]);
  folk.update(cam); crew.after(ts);
  world.steamAt(crew.props.cup.position);
  // the eyes: every pair a small white glint
  eyes.begin();
  for (let id = 0; id < folk.n; id++) { const st = folk.get(id); if (!st.visible) continue; const ep = Eyes.ofPeople(folk, id); if (ep) eyes.pair(ep[0], ep[1], 0.9 + 0.1 * Math.sin(ts * 6 + id), WHITE); }
  for (const h of [him, her, ...(pose.welderOn ? [welder] : [])]) { if (!h.group.visible) continue; const he = Eyes.ofHero(h); eyes.pair(he[0], he[1], 0.8, WHITE); }
  eyes.material.uniforms.uOcc.value = 1; eyes.end(cam, H); eyes.gain = 0.8;
  Wd.render(null, ts); { const gl = Wd.renderer.getContext(), px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
  // the grade: the lead's (grayscale, contrast 1.3, brightness 1.04); from the drop the amber key keeps the sodium and the furnace
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const K = sstep(TL.lit, TL.lit + 0.25, ts);
  if (K > 0 && t < V3T.mark) { ctx.drawImage(Wd.canvas, 0, 0, W, H); amberKey(ctx, K); }
  else { ctx.filter = 'grayscale(1) contrast(1.16) brightness(1.0)'; ctx.drawImage(Wd.canvas, 0, 0, W, H); ctx.filter = 'none'; }   // v2: softer than v1's 1.3 (it clipped)
  if (t >= V3T.mark) {
    const age = t - V3T.mark; ctx.fillStyle = `rgba(2,1,1,${clamp(0.85 + age * 3, 0, 0.97)})`; ctx.fillRect(0, 0, W, H);
    closerG.clearRect(0, 0, W, H); closer(closerG, age); ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.drawImage(closerCv, 0, 0); ctx.restore();
    return {};
  }
  cueType(ctx, t, CUES, { x: SAFE_BAND.cx });                 // centred on the safe band (x 60-960), not the frame
  for (const [a, e, line, y, size, x] of SUBS) if (t >= a && t < e) band(ctx, line, x, y, size, { ...STYLES.sub, a: clamp((e - t) / 0.08) });
  finish.apply(ctx, Math.round(t * 30), { grain: 0.07, vignette: 0.42 });
  return { shot };
};
ready = true;
