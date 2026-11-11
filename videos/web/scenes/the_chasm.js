// THE CHASM (v1, 16 Oct 2026; research/pieces/THE_CHASM.md, script research/scripts_final/the_chasm.json).
// Marx, Wage Labour and Capital (1847): "If capital grows rapidly, wages may rise, but the profit of capital rises disproportionately
// faster. The material position of the worker has improved, but at the cost of his social position. The social chasm that separates
// him from the capitalist has widened." A tower going up at golden hour, one floor a bar: the nation's output. The crew ride their
// hoist cage up the face; the owner's glass car comes up from under them, passes them and climbs away until it rides just under the lit
// top; the open bay of the facade between them widens to 137 m. The number is painted on the stair core at the floor where the crew
// stop: the labour share, 52.8 %, the lowest on record (BLS, Q2 2026). The operator hits the stop and the tower stops with them: no
// floor goes up, the crane holds, the car hangs. NOTHING RISES / WITHOUT US. They start it again; WE BUILT ALL OF IT.
//   the plan      the_chasm.plan.js (the beat -> cage, car, top, shots, gaze, words; pure, checked in node)
//   the world     the_chasm.world.js (the tower, the hoist, the car, the crane, the city)
//   the people    the_chasm.cast.js (five from the person pipeline, posed by IK in the cage)
//   the light     light/ (LitRenderer, LightRig): golden hour, the sun low from the front right; the owner's glass lit warm inside
// Score: audio/songs2/the_chasm_e.py (100 BPM; the stop at b72, the return at b78, the mark at b94).
import * as THREE from 'three';
import { W as FW, H as FH, loadBeats } from '../lib/kit.js';
import { LitRenderer } from '../lib/fx/light/pipeline.js';
import { LightRig } from '../lib/fx/light/rig.js';
import { PRESETS } from '../lib/fx/light/presets.js';
import { drawMark, markBox, drawLockup } from '../lib/closer.js';
import { BPM, SPB, STOP, BACK, CLOSE, END, FLOOR, cageY, carY, topFloors, shotAt, CARDS, leverAngle, buttonIn } from './the_chasm.plan.js';
import { World } from './the_chasm.world.js';
import { Cast } from './the_chasm.cast.js';
THREE.ColorManagement.enabled = true;

const T0 = performance.now(), lap = n => console.log('the_chasm: [boot]', n, Math.round(performance.now() - T0), 'ms');
const Q = new URLSearchParams(globalThis.location?.search || '');
const DRY = Q.get('dry') === '1';                      // logic only: everything runs, nothing is drawn (a local check without a picture)
const PEOPLE = Q.get('people') !== '0';
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };

// ================================================================ the type face
const FACE = 'League Spartan';
try { const f = new FontFace(FACE, 'url(../assets/fonts/league-spartan-latin-900-normal.woff2)', { weight: '900' }); document.fonts.add(await f.load()); } catch (e) { console.log('the_chasm: font', e.message); }
window.DURATION = END;
const out = document.getElementById('out'); out.width = FW; out.height = FH;
const ctx = out.getContext('2d');

// ================================================================ the beat
let B = null; try { B = await loadBeats('the_chasm'); } catch (e) { console.log('the_chasm: no hits.json, nominal grid'); }
const beatOf = t => (B ? B.beat(t) : t / SPB);

// ================================================================ the stage
const SOFT = (() => { try { const g = document.createElement('canvas').getContext('webgl2'), e = g.getExtension('WEBGL_debug_renderer_info'); return !e || /swiftshader|llvmpipe|software/i.test(g.getParameter(e.UNMASKED_RENDERER_WEBGL)); } catch (_) { return true; } })();
const SCALE = +(Q.get('scale') || (SOFT ? 0.5 : 1)), QUAL = Q.get('q') || (SOFT ? 'draft' : 'clip');
const glc = document.createElement('canvas'); glc.width = Math.round(FW * SCALE); glc.height = Math.round(FH * SCALE);
const lr = new LitRenderer({ canvas: glc, width: FW, height: FH, quality: QUAL, scale: SCALE });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, FW / FH, 0.2, 6000);
lap('stage');

// golden hour, the sun 11 degrees up from the front right of the facade (it lights the crew's faces and the face of the tower; the sky
// behind the tower is the clear side)
const rig = new LightRig(lr.renderer, scene, PRESETS.goldenHour({ camera: { ev100: 12.9, wb: 5400 }, sky: { kind: 'clear', elevation: 11, azimuth: 142, turbidity: 3.2 },
  sun: { extent: 30, shadowSize: 4096, softness: 1.5 }, atmosphere: { density: 0.0011, height: 120, g: 0.72, maxDist: 2500 },
  lens: { bloom: 0.035, halation: 0.22, vignette: 0.28, grain: 0.018 } }));
lap('rig');

const world = await new World(scene).build();
lap('world');
const cast = new Cast();
if (PEOPLE) { await cast.build(scene); lap('cast ' + cast.n); }
if (cast.n && cast.mod?.ensureSkinSSS && !DRY) { try { await cast.mod.ensureSkinSSS(lr, scene); } catch (e) { console.log('the_chasm: skin pass', e.message); } }

// ================================================================ the site's moving parts
// the crane works: the jib swings between two picks each bar, the trolley runs in and out, the hook lifts; it holds through the stop
function craneAt(b) {
  const w = b < STOP ? b : b < BACK ? STOP : STOP + (b - BACK);
  const ph = w / 8 * Math.PI;
  return { slewA: 0.9 + 0.55 * Math.sin(ph), trolleyX: 24 + 10 * Math.sin(ph * 0.7 + 1), hookY: 6 + 9 * (0.5 + 0.5 * Math.sin(ph * 1.3)) };
}
// the sun's shadow: fitted to what the shot is about (a close shot gets millimetres, a wide the whole tower)
function fitShadow(center, ext) {
  const s = rig.sun; if (!s || !s.shadow) return;
  const sc = s.shadow.camera; if (sc.right !== ext) { sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = ext * 8; sc.updateProjectionMatrix(); }
  rig.center.copy(center); rig.sunDist = ext * 3; rig._placeSun(rig.sunDir);
}
const SHADOW = { climb: 7, pass: 22, open: 70, tower: 160, mark: 10, still: 160, rise: 7, all: 170 };

// ================================================================ the type (after the picture)
function setFont(size) { ctx.font = `900 ${size.toFixed(1)}px "${FACE}"`; }
const CAP = 0.7;   // League Spartan: cap height / font size
function drawCard(card, t) {
  const [b0, , lines, o] = card;
  let size = o.cap / CAP, k = 1; setFont(size);
  for (const l of lines) k = Math.min(k, 888 / ctx.measureText(l).width);
  size *= k; setFont(size);
  ctx.save(); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.shadowColor = 'rgba(8,6,4,0.55)'; ctx.shadowBlur = 26; ctx.shadowOffsetY = 2; ctx.fillStyle = '#f7f3ea';
  // each line arrives with the beat it falls on, a frame or two apart (a word read as it comes, not a slide)
  let y = o.y + size * CAP;
  lines.forEach((l, i) => { const show = (beatOf(t) - b0) >= i * 0.5 || o.together; if (show) ctx.fillText(l, 72, y); y += size * 0.98; });
  if (o.credit) { const cs = 25 / CAP; setFont(cs); let w = ctx.measureText(o.credit).width, kk = Math.min(1, 888 / w); setFont(cs * kk); ctx.globalAlpha = 0.9; ctx.fillText(o.credit, 74, y - size * 0.98 + 25 * 2.0 + 10); }
  ctx.restore();
}
function drawType(t) { const b = beatOf(t); for (const c of CARDS) if (b >= c[0] && b < c[1]) drawCard(c, t); }
// the sign-off: the four-stripe mark and the lockup on the dark, cut on the last hit
function drawCloser(t) {
  const age = t - CLOSE * SPB;
  ctx.fillStyle = '#0b0a09'; ctx.fillRect(0, 0, FW, FH);
  // the mark goes up the way the tower did: the badge, then its four stripes laid one after another, a floor at a time
  const g0 = markBox(0, 0, 300), st = [0, 1, 2, 3].map(k => clamp((age - 0.08 - k * 0.09) / 0.12));
  drawMark(ctx, 540 - (g0.box.x0 + g0.box.x1) / 2, 860, 300, { badge: clamp(age / 0.1), stripes: st });
  ctx.save(); ctx.globalAlpha = clamp((age - 0.25) / 0.2); drawLockup(ctx, 540, 1150, 92, { color: '#f4e6d0' }); ctx.restore();
}

// ================================================================ one frame
const look = V(), center = V();
async function frameAt(t) {
  const b = beatOf(t), s = shotAt(b), c = s.cam;
  const topF = topFloors(b), yc = cageY(b), yg = carY(b), cr = craneAt(b);
  // WE BUILT ALL OF IT: from b84 the floors light, the crew's floor first, then up the tower a floor every sixteenth, to the top
  const lit = b < 84 ? null : k => clamp((b - 84 - Math.max(0, k - 16) * 0.18) / 0.5);
  world.set({ topF, cageY: yc, carY: yg, ...cr, lever: leverAngle(b), button: buttonIn(b), exposure: rig.exposure, glazeTo: Math.floor(topF) - 7, lit });
  if (cast.n) cast.pose(b, { y: yc });
  // the camera: the shot's lens, with a drone's slow drift on the close shots and a dead still frame at the stop
  const still = s.id === 'mark' || s.id === 'still';
  const dr = still ? 0 : (s.id === 'climb' || s.id === 'rise' ? 1 : 0.4), tt = t * 0.6;
  camera.position.set(c.pos[0] + dr * 0.05 * Math.sin(tt * 1.3), c.pos[1] + dr * 0.04 * Math.sin(tt * 0.9 + 1), c.pos[2] + dr * 0.04 * Math.sin(tt * 0.7 + 2));
  look.set(...c.look); camera.fov = c.fov; camera.updateProjectionMatrix(); camera.lookAt(look); camera.updateMatrixWorld(true);
  center.copy(look); fitShadow(center, SHADOW[s.id] || 40);
  const dist = camera.position.distanceTo(look), close = s.id === 'climb' || s.id === 'rise';
  if (!DRY) lr.render({ scene, camera, rig, t, lens: { focal: close ? 50 : 35, fstop: close ? 5.6 : 11, focus: dist }, ao: { radius: close ? 0.5 : 2.0, intensity: 1.1 }, contactLen: close ? 0.25 : 1.0 });
  return s;
}

window.renderFrame = async (tIn) => {
  const t = Math.min(tIn, END), b = beatOf(t);
  if (b >= CLOSE) { if (!DRY) drawCloser(t); return; }
  await frameAt(t);
  if (DRY) return;
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(glc, 0, 0, FW, FH);
  drawType(t);
};
window.sceneInfo = { DUR: END, BPM, CLOSE };
window.__chasm = { scene, camera, world, cast, rig, frameAt, shotAt };
lap('ready');
window.sceneReady = true;
