// THE MAJORITY v2 take B (majority_b): the fan-cam is the spine. The chant's growth is counted in faces: one (b4), four (b10),
// sixteen (b18-22, three rows going red), then the whole country (b34, faces over the lit towns). Score: the c12 crunk rescore.
// Built from majority_a.js by review/THE_MAJORITY_c2/build/make_b.py. Take A's text: v1's structure rebuilt with people a stranger recognises (c7 hero.js workers lit by the
// stadium floods, faces on the fan-cam, a full-frame mascot fold). Based on majority.js (picture v2, cycle R1):
// THE MAJORITY (majority), picture v2 (cycle R1). The stadium, cut on the song's hits (~40 shots in 48 beats):
//   b0    WE'RE THE MAJORITY.: behind the hero (a lineworker, white hard hat, hi-vis) in her section, a bent-elbow fist on
//         the 808, her headlamp thrown into the bowl; rows of backs below her against the lit turf; the far stands.
//   b2    STRAIGHT FROM WORK.: four half-beat turnstile macros, a green chirp on each badge (the class shown, never named).
//   b4    AMERICAN.: a Gursky wall of backs over the turf (no sky), the fists rippling out; b5 the far stand's headlamps.
//   b6/7  DAY SHIFT. / NIGHT SHIFT.: one rim-lit back each (scrubs under a fleece; cook's whites).
//   b8    the lower bowl stands, left to right (no frame); b10 AMERICAN.: the wider wall; b12 the bowl from the corner.
//   b14   TEAM SPORTS.: the video board's mascot race; b15 both suits fold flat and empty, heads on.
//   b16   HOME TEAM.: the FAN CAM: the board frames the crowd seeing itself, board inside board (the clip frame).
//   b18-23 AMERICAN. x3: STRIPE OUT, one more deck red by clothing and phone light on each hit, cream between, until the
//         three red bands stand as ≡ (b23, low from the field).
//   b24   ON YOUR FEET.: the upper deck stands row by row; b26 the Wave, a-MER-i-CAN riding the ribbon board in the world.
//   b28   MAKE ROOM.: four micro-cuts of new rows rising over the rim against the night.
//   b30   the crouch (the floods dip to the headlamps); b31 the one silence, crouched, in silhouette (never black).
//   b32   COAST TO COAST.: the floods slam on, the crane climbs out of the bowl; b34 the country lights from the middle out.
//   b36   AMERICAN. x3: rowhouses, a headframe town, a refinery catwalk, a harvest crew (half-beat cuts, phones up);
//         b38 all four at once; b40 the whole bowl in phone light.
//   b41   the card stunt from the blimp, messy; b41.5 the kid flips his upside-down card.
//   b42   COMMUNIST.: the mark locks (four stripes), the stripes run east as red light across the lit country; b44 the dive.
//   b45   COMMUNIST.: the hero again, matched to frame 0; b48 the 1.4 s lockup over her frame, then a hard cut to frame 0.
// Rules held (GRAPHICS_ROADMAP, the critic's brief): no front-lit faces at mid distance or closer (every near person is a
// back or a rim silhouette, the crowd walls are sub-legible texture); every raised arm is the bent-elbow PUMP / overhead
// glyph (ranks.js SIL cells, hero.js PUMP, the bowl shader's vertical fist), never a straight arm; headwear hard / cap /
// knit / bare only; no party, league or team marks; the words are scoreboard prompts in the world or jersey slams
// (Ultra: cream fill, red outline, navy drop), complete on their hit frame, never boxed.
// Words: research/scripts_final/majority.json (v1.1). Song: audio/songs2/majority.py (102 BPM, F# minor, crunk).
import * as THREE from 'three';
import { W, H, C, loadBeats, clamp, lerp, ease, rng, loadBrand, BRAND, sigil, line, acpEmblem } from '../lib/kit.js';
import { Post } from '../lib/fx/post.js';
import { Ranks } from '../lib/fx/ranks.js';
import { loadFace } from '../lib/fx/type.js';
import { SAFE, setBlock, typeAudit } from '../lib/fx/type_world.js';
import { Stage } from '../lib/fx/folk_worlds.js';
import { castHero, CREW8 } from '../lib/fx/workforce.js';
import { loadAnsur } from '../lib/fx/rig/body.js';
import { mascotBig, CardStand } from './majority_a.art.js';
import { Hero } from '../lib/fx/hero.js';          // the heroes are hero.js people (via Stage): render.mjs writes their gesture audit
import { loadGeo, USMap } from '../lib/fx/maps.js';
import { Bowl, Crowd, LIGHT, DECKS } from './majority.bowl.js';
import { Post as BowlPost } from './majority.post.js';
import { PAL, turf, steps, shade, turnstile, Board, mascotRace, nightSky, parapet, region, phone, Cards, kidCard } from './majority.plates.js';

const QS = new URLSearchParams(location.search);
void Hero;
await loadBrand();
{ const f = new FontFace('Archivo Black', 'url(../node_modules/@fontsource/archivo-black/files/archivo-black-latin-400-normal.woff2)'); document.fonts.add(await f.load()); }
const B = await loadBeats('majority_b');
const SPB = B.spb, CLOSE = 48, LOCK_S = 1.4, FR = 1 / 30;
const bt = b => b * SPB;
const DUR = CLOSE * SPB + LOCK_S;
window.DURATION = DUR;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
const KINDS = ['hard', 'cap', 'knit', 'bare'];            // headwear: hard hats, caps, knit caps, bare heads (no patterned headwear)

// ================================================================ canvases and the finish
const post = new Post(W, H, { direct: true, glowScale: 0.25 });
const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
const comp = mk(), cg = comp.getContext('2d', { willReadFrequently: true });
const typeC = mk(), tg = typeC.getContext('2d', { willReadFrequently: true });
const tmp = mk(), mg = tmp.getContext('2d');
const tmp2 = mk(), mg2 = tmp2.getContext('2d');
const tmp3 = mk(), mg3 = tmp3.getContext('2d');

// ================================================================ the bowl (3D: the stands, the far crowd as texture)
const SC = Number(QS.get('sc') || 0.6), RW = Math.round(W * SC), RH = Math.round(H * SC);
const glc = document.createElement('canvas'); glc.width = RW; glc.height = RH;
const renderer = new THREE.WebGLRenderer({ canvas: glc, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); renderer.setSize(RW, RH, false);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
const bpost = new BowlPost(renderer, RW, RH, RW, RH);
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(LIGHT.uFogCol.value.clone(), LIGHT.uFogD.value);
const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 30000);
const bowl = new Bowl(scene);
const crowd = new Crowd(scene);
crowd.mat.uniforms.uRes.value = RH;
const H01 = x => { x = Math.sin(x * 127.1) * 43758.5453; return x - Math.floor(x); };
// the crowd program: presence, stand, a vertical fist, headlamp, phone, stripe colour (1 red, 2 cream)
function crowdState({ fill = [1, 1, 1], stand = 1, arms = 0, lamp = 0, phone: ph = 0, stripe = null, hide = null, t = 0, field = 0 } = {}) {
  crowd.apply((s, k, S, Cc) => {
    if (hide && hide(s)) return;
    const f = s.deck === 3 ? field : fill[s.deck];
    if (H01(s.seed) >= f) return;
    S[0] = 1;
    S[1] = typeof stand === 'function' ? stand(s) : stand;
    const a = typeof arms === 'function' ? arms(s) : arms;
    S[2] = H01(s.seed * 3.7) < 0.35 ? clamp(a * (0.8 + 0.2 * Math.sin(t * 9 + s.seed))) : 0;       // at most ~35% raise an arm
    S[3] = typeof lamp === 'function' ? lamp(s) : lamp;
    Cc[2] = typeof ph === 'function' ? ph(s) : ph;
    Cc[3] = stripe ? stripe(s) : 0;
  });
}
function looksBowl({ flood = 1, fog = 0.0032, lamps = null } = {}) {
  LIGHT.uFlood.value = flood; LIGHT.uFogD.value = fog; scene.fog.density = fog; bowl.masts.set(lamps ?? flood);
  crowd.mat.uniforms.uStripeK.value = 0.4; crowd.mat.uniforms.uPhoneK.value = 1;
}
function setCam(p, target, fov = 40, roll = 0) {
  camera.position.copy(p); camera.up.set(Math.sin(roll), Math.cos(roll), 0); camera.fov = fov; camera.lookAt(target); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
}
function rings(text = '', col = '#F4E6D0', o = {}) { bowl.rings.forEach((R, i) => R.draw(typeof text === 'function' ? text(i) : text, typeof col === 'function' ? col(i) : col, { bg: '#050507', rep: 6, ...o })); }
function renderBowl(g, { t = 0, bloom = 0.7, streak = 0.2, expo = 1.3, sat = 0.95, contrast = 1.06 } = {}) {
  LIGHT.uTime.value = t;
  bpost.render([[scene, camera]], { time: t, bloom, streak, ca: 0, vig: 0, grain: 0, expo, sat, contrast });
  g.drawImage(glc, 0, 0, W, H);
}
const proj = p => { const v = p.clone().project(camera); return [(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H, v.z]; };

// ================================================================ people: the hero and her crew (hero.js on a Stage), ranks of backs (SIL)
const RK = await Ranks.create({ W, H });
{ const e = document.createElement('canvas'); e.width = e.height = 256; acpEmblem(e.getContext('2d'), 128, 128, 200, { color: '#ffffff' }); RK.emblem = e; }
const st = new Stage({ W, H }); await st.init();
const CAST = {
  hero: { variant: 'plains', height: 1.72, kind: 'work', shirt: '#c6cf2e', shirt2: '#9aa0a0', trousers: '#2c3444', hat: 'hard', hatColor: '#eeece4', beard: 0, stubble: 0, seed: 101 },
  welder: { variant: 'heavy', height: 1.8, kind: 'leather', shirt: '#4a3020', trousers: '#262a30', hat: 'cap', hatColor: '#1c1c1e', beard: 0.5, seed: 102 },
  farm: { variant: 'forge', height: 1.78, kind: 'flannel', shirt: '#7a1c1c', shirt2: '#2a0c0c', trousers: '#2c3e5e', hat: 'knit', hatColor: '#2a2c32', seed: 103 },
  nurse: { variant: 'plains', height: 1.7, kind: 'coat', shirt: '#2c3a48', trousers: '#1f5f68', hat: 'none', seed: 104 },
  cook: { variant: 'forge', height: 1.76, kind: 'work', shirt: '#e4e0d6', trousers: '#2a2a2e', hat: 'knit', hatColor: '#e8e6e0', seed: 105 },
};
const HEROES = Object.fromEntries(Object.entries(CAST).map(([k, o]) => [k, st.hero(o)]));
// the c7 population (HUMAN c7: castHero(..., { c7: true })): who is in the stands, in what they wear from the job
const ANSUR = await loadAnsur();
CREW8.forEach(spec => { const { opts, apply } = castHero(spec, ANSUR, { c7: true }); const h = st.hero({ ...opts, collar: false }); apply(h); HEROES[spec.name.toLowerCase()] = h; });   // ada walt rosa otis kai june ray mei
const stHemi = new THREE.HemisphereLight('#3a4052', '#0a0806', 0.35); st.scene.add(stHemi);
// the stadium's light on a back: a cold flood from the masts behind the lens (key), the floods over the far stands in
// front of her (a hot rim on the hat, the shoulders and the fist); used by the lit render (clothes read: the hi-vis)
const stKey = new THREE.DirectionalLight('#dfe6ff', 0), stRim = new THREE.DirectionalLight('#fff0d8', 0), stRim2 = new THREE.DirectionalLight('#9fb6ff', 0);
for (const l of [stKey, stRim, stRim2]) { st.scene.add(l); st.scene.add(l.target); }
for (const h of Object.values(HEROES)) h.watch(st.camera);
// pose one back: standing from the bind pose, turned away from the lens; arm: null | 'R' | 'L' (the PUMP glyph, bent
// elbow, forearm vertical, fist beside the head); strike: onset time (s): 3 frames cocked, the strike ON the onset frame,
// a 1-frame overshoot, then a pump on twos
function poseBack(h, { x = 0, y = 0, z = 0, turn = Math.PI, arm = null, strike = null, t = 0, head = 0 } = {}) {
  st.stand(h, { x, y, z, turn, t: 'bind', nod: -0.04, head });
  const other = arm === 'R' ? 'L' : 'R';
  if (!arm) { for (const s of ['L', 'R']) { h.gesture(s, 'SIDE', { fist: false }); h.relaxHand(s); } return; }
  h.gesture(other, 'SIDE', { fist: false }); h.relaxHand(other);
  if (strike == null) { h.gesture(arm, 'PUMP', { p: 0.9, fistScale: 1.15 }); return; }
  const k = Math.round((t - strike) * 30);
  if (k < -3) { h.gesture(arm, 'SIDE', { fist: false }); h.relaxHand(arm); }
  else if (k < 0) h.gesture(arm, 'COCK', { fist: true });
  else { const p = k === 0 ? 0.6 : k === 1 ? 1 : k < 10 ? 0.92 : (Math.floor((k - 10) / 8) % 2 ? 0.6 : 0.95); h.gesture(arm, 'PUMP', { p, fistScale: k === 1 ? 1.25 : 1.15 }); }
}
function onlyHeroes(names) { for (const [k, h] of Object.entries(HEROES)) { const on = names.includes(k); h.group.visible = on; h._auditCam = on ? st.camera : null; } }
const heroCanvas = mk();
// render the visible backs rim-lit by a far light through the 2D point sun2d (a flood above the far stands)
function renderBacks(sun2d, { rim = '#fff0d8', rim2 = '#5a78b0', body = '#07080c', lit = false, key = 1.4, rimI = 6 } = {}) {
  const ray = new THREE.Vector3((sun2d[0] / W) * 2 - 1, -(sun2d[1] / H) * 2 + 1, 0.5).unproject(st.camera).sub(st.camera.position).normalize();
  const up = V3(0, 1, 0), side = new THREE.Vector3().crossVectors(ray, up).normalize();
  const sunW = st.camera.position.clone().addScaledVector(ray, 500).addScaledVector(up, 260).addScaledVector(side, (sun2d[0] < W / 2 ? 1 : -1) * 220);
  if (lit) {     // the lit render: key from the masts behind the lens, above; the hot rim from the floods ahead of her
    const c0 = st.camera.position;
    stKey.intensity = key; stKey.position.copy(c0).add(V3(-4, 9, 5)); stKey.target.position.set(0, 1.2, 0);
    stRim.intensity = rimI; stRim.color.set(rim); stRim.position.copy(sunW); stRim.target.position.set(0, 1.4, 0);
    stRim2.intensity = rimI * 0.45; stRim2.color.set(rim2); stRim2.position.set(sunW.x * -0.6, sunW.y * 0.8, sunW.z); stRim2.target.position.set(0, 1.4, 0);
    st.r.toneMappingExposure = 1.0; st.renderLit();
    stKey.intensity = stRim.intensity = stRim2.intensity = 0;
  } else st.renderRim(sunW, { rim, rim2, body, bump: 0.5, wrapK: 0.14, bounce: 0.0, rimW: 0.42 });
  const g = heroCanvas.getContext('2d'); g.clearRect(0, 0, W, H); g.drawImage(st.canvas, 0, 0); return heroCanvas;
}
const toScreen = p => { const v = p.clone().project(st.camera); return [(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H]; };

// the stadium night style for ranks: blue-black backs, the flood rim (warm white) on heads and shoulders
const lerpHex = (a, b, u) => { const A = parseInt(a.slice(1), 16), Bb = parseInt(b.slice(1), 16); const c = [16, 8, 0].map(s => Math.round(lerp((A >> s) & 255, (Bb >> s) & 255, u))); return '#' + c.map(v => v.toString(16).padStart(2, '0')).join(''); };
function nightStyle(n, { rim = '#ffe4bc', far = '#2c3040', near = '#040509', rimNear = 1.0, rimFar = 0.45, key = '#6a7a98', keyNear = 0.12, keyFar = 0.02, dust = '#ffd8a0', alt = 0 } = {}) {
  const ink = [], rimAmt = [], keyAmt = [], accAmt = [];
  for (let i = 0; i < n; i++) { const u = n > 1 ? i / (n - 1) : 0;
    ink.push(lerpHex(near, far, Math.pow(u, 0.8) * (1 - alt * (i % 2)))); rimAmt.push(lerp(rimNear, rimFar, u)); keyAmt.push(lerp(keyNear, keyFar, u)); accAmt.push(lerp(0.6, 0.1, u)); }
  return { ink, rim, rimAmt, key, keyAmt, acc: '#010102', accAmt, shadow: '#010102', shadowA: 0.6, ground: ['#1a1c24', '#07080c'], dust, flag: '#b0140e', flagDark: '#5a0806', emblem: '#ffcf70' };
}
// a wall of backs: n ranks of 2 staggered rows, stepping up the stands from below the frame to the turf line
function wall(seed, { n = 12, foot = 2080, h = 440, ratio = 0.84, over = 0.62, raise = 0.34, rows = 2, thick = 0.22, pack = 1.2 } = {}) {
  const ranks = [];
  let f = foot, hh = h;
  for (let i = 0; i < n; i++) { ranks.push({ foot: f, h: hh, rows, thick, pack, raise, gaps: 0.035, kinds: KINDS, jitter: 0.04 }); f -= hh * over; hh *= ratio; }
  const c = RK.design({ seed, ranks }); c.feet = ranks.map(r => r.foot); c.top = f; return c;
}
const onFig = (cr, t, pick) => {
  const S = RK.sil, out = [];
  for (const R of cr.ranks) for (const f of R.figs) { const p = RK._pose(f, t), c = p.c; const pt = c && pick(c, f); if (!pt) continue;
    const s = cr.surge ? cr.surge(f, t) : null, x = f.x + (s ? s.dx : 0), y = f.y + (s ? s.dy : 0) + (p.dy || 0) * f.h, hh = f.h * (s ? s.k : 1), k = hh / (S.types[c.type].h * S.PPM);
    out.push([f.flip ? x - (pt[0] - c.foot[0]) * k : x + (pt[0] - c.foot[0]) * k, y + (pt[1] - c.foot[1]) * k, hh, f]); }
  return out;
};
const fistPts = (cr, t) => onFig(cr, t, (c, f) => f.raise && c.fist);
const headPts = (cr, t) => onFig(cr, t, c => c.head);

// ================================================================ the words (research/scripts_final/majority.json v1.1)
// [beat, text, emphasis, hold (beats), place]: jersey slams (Ultra) unless `world` (drawn on the board by its shot)
const ULTRA = await loadFace('ultra'), SHOUL = await loadFace('shoulders');   // calls: Ultra (the jersey); chant slams: Big Shoulders 900, italic
const CUES = [
  [0, "WE'RE THE MAJORITY.", 0, 2, { lines: [["WE'RE THE", 172], ['MAJORITY.', 232]], y: 520 }],
  [2, 'STRAIGHT FROM WORK.', 0, 2, { lines: [['STRAIGHT', 196], ['FROM WORK.', 196]], y: 560 }],
  [4, 'AMERICAN.', 0, 1.3, { sh: 300, y: 470 }],
  [6, 'DAY SHIFT.', 0, 1, { cap: 230, y: 470 }],
  [7, 'NIGHT SHIFT.', 0, 1, { cap: 220, y: 470 }],
  [10, 'AMERICAN.', 0, 1.6, { sh: 340, y: 470 }],
  [14, 'TEAM SPORTS.', 0, 2, { sh: 250, y: 400 }],
  [16, 'HOME TEAM.', 1, 2, { world: 'fancam' }],
  [18, 'AMERICAN.', 0, 1.4, { sh: 300, y: 470, x: 540 }],
  [20, 'AMERICAN.', 0, 1.4, { sh: 380, y: 470, x: 540 }],
  [22, 'AMERICAN.', 0, 1.4, { sh: 420, y: 470, x: 540 }],
  [24, 'ON YOUR FEET.', 0, 2, { lines: [['ON YOUR', 220], ['FEET.', 300]], y: 600 }],
  [28, 'MAKE ROOM.', 0, 2, { lines: [['MAKE', 240], ['ROOM.', 240]], y: 700 }],
  [32, 'COAST TO COAST.', 1, 2, { lines: [['COAST TO', 210], ['COAST.', 290]], y: 640 }],
  [36, 'AMERICAN.', 0, 1.4, { sh: 300, y: 470 }],
  [38, 'AMERICAN.', 0, 1.4, { sh: 380, y: 900 }],
  [40, 'AMERICAN.', 0, 1.4, { sh: 460, y: 700 }],
  [42, 'COMMUNIST.', 1, 2, { pay: true, y: 1190 }],
  [45, 'COMMUNIST.', 1, 3, { sh: 300, y: 520 }],
];
typeAudit.plantCap = 196;
window.typeInfo = () => typeAudit.items;
const BLK = new Map();
function blockOf(c) {
  if (BLK.has(c)) return BLK.get(c);
  const P = c[4]; let b;
  if (P.pay) b = setBlock(SHOUL, [{ text: c[1], fill: true, max: 560 }], { role: 'payoff', y: P.y, maxW: 900, gap: 0.1 });
  else if (P.sh) b = setBlock(SHOUL, c[1], { role: 'slam', cap: P.sh, y: P.y, x: P.x, maxW: 900 });
  else if (P.lines) b = setBlock(ULTRA, P.lines.map(([text, cap]) => ({ text, cap })), { role: 'shout', y: P.y, x: P.x, gap: 0.12, maxW: 920 });
  else b = setBlock(ULTRA, c[1], { role: 'slam', cap: P.cap, y: P.y, x: P.x, maxW: 920 });
  if (b.bbox.y1 < SAFE.y1 + 4 || b.bbox.y2 > SAFE.y2 - 4) { const dy = b.bbox.y1 < SAFE.y1 + 4 ? SAFE.y1 + 4 - b.bbox.y1 : SAFE.y2 - 4 - b.bbox.y2; P.y += dy; BLK.delete(c); return blockOf(c); }
  BLK.set(c, b); return b;
}
// the jersey: a navy drop, a black keyline, a red (or cream) outline, the cream (or red) fill; printed flat, never glowing
function jersey(g, b, { red = false, s = 1, dx = 0, dy = 0, alpha = 1 } = {}) {
  const cap = b.cap || 200, fill = red ? '#d21a1f' : PAL.cream, edge = red ? PAL.cream : '#c8161c';
  const cx = (b.bbox.x1 + b.bbox.x2) / 2, cy = (b.bbox.y1 + b.bbox.y2) / 2;
  g.save(); g.globalAlpha = alpha; g.translate(cx + dx, cy + dy); g.scale(s, s); if (b.font === SHOUL) g.transform(1, 0, -0.16, 1, 0, 0); g.translate(-cx, -cy);
  const each = fn => { for (const gl of b.glyphs) { g.save(); g.translate(gl.ox, gl.oy); fn(gl.path); g.restore(); } };
  const o = Math.max(6, cap * 0.07), d = Math.max(8, cap * 0.075);
  g.lineJoin = 'round';
  g.save(); g.translate(d * 0.6, d); g.strokeStyle = PAL.navy; g.lineWidth = o * 2 + 4; each(p => g.stroke(p)); g.fillStyle = PAL.navy; each(p => g.fill(p)); g.restore();
  g.strokeStyle = '#05060a'; g.lineWidth = o * 2 + 6; each(p => g.stroke(p));
  g.strokeStyle = edge; g.lineWidth = o * 2; each(p => g.stroke(p));
  g.fillStyle = fill; each(p => g.fill(p));
  g.restore();
}
const WT = [];     // world type the shot sets this frame (board prompts), drawn on the type layer with the cues
function drawType(beat, t) {
  tg.clearRect(0, 0, W, H); typeAudit.reset();
  for (const fn of WT) fn(tg);
  const bq = beat + 0.5 * FR / SPB;
  for (const c of CUES) {
    if (bq < c[0] || bq >= c[0] + c[3] || c[4].world) continue;
    const b = blockOf(c), age = Math.round((t - bt(c[0])) * 30), s = age === 0 ? 1.07 : age === 1 ? 1.025 : 1;   // the slam: 7% over on the hit frame, settled by frame 2
    jersey(tg, b, { red: !!c[2], s });
    typeAudit.add(b, { role: c[4].pay ? 'payoff' : b.role, read: 1, s, world: 'printed' });
  }
}
const boardWords = new Map();
function boardText(g, text, cap, x, y, { red = false } = {}) {
  const key = text + cap + x + y; let b = boardWords.get(key);
  if (!b) { b = setBlock(SHOUL, [{ text, cap }], { role: 'plant', cap, x, y, maxW: 880 }); boardWords.set(key, b); }
  jersey(g, b, { red });
  typeAudit.add(b, { role: 'plant', read: 1, s: 1, world: 'board' });
}

// ================================================================ the board, the map, the cards
const board = new Board(320, 180);
const geo = await loadGeo({ world: false, rivers: false });
const us = new USMap(geo); us._bake();
const HOME = [-94.6, 39.1];            // the bowl sits in the middle of the country (unnamed)
const cards = new Cards(BRAND.acp_emblem, { cols: 88, rows: 70 });

// ================================================================ the shots (cuts on the song's hits)
const SHOTS = [
  { b0: 0, name: 'hero' },
  { b0: 2, name: 'badge', i: 0 }, { b0: 2.5, name: 'badge', i: 1 }, { b0: 3, name: 'badge', i: 2 }, { b0: 3.5, name: 'badge', i: 3 },
  { b0: 4, name: 'wall', v: 0 }, { b0: 5, name: 'farstand' },
  { b0: 6, name: 'shift', i: 0 }, { b0: 7, name: 'shift', i: 1 },
  { b0: 8, name: 'rise' }, { b0: 10, name: 'wall', v: 1 }, { b0: 12, name: 'bowlwide' },
  { b0: 14, name: 'race' }, { b0: 15, name: 'fold' }, { b0: 16, name: 'fancam' },
  { b0: 18, name: 'stripe', k: 1 }, { b0: 20, name: 'stripe', k: 2 }, { b0: 22, name: 'stripe', k: 3 }, { b0: 23, name: 'eq' },
  { b0: 24, name: 'feet' }, { b0: 26, name: 'wave' },
  { b0: 28, name: 'room', i: 0 }, { b0: 28.5, name: 'room', i: 1 }, { b0: 29, name: 'room', i: 2 }, { b0: 29.5, name: 'room', i: 3 },
  { b0: 30, name: 'crouch' }, { b0: 31, name: 'silence' },
  { b0: 32, name: 'crane' }, { b0: 34, name: 'country' },
  { b0: 36, name: 'region', i: 0 }, { b0: 36.5, name: 'region', i: 1 }, { b0: 37, name: 'region', i: 2 }, { b0: 37.5, name: 'region', i: 3 },
  { b0: 38, name: 'quad' }, { b0: 39, name: 'region', i: 2, v: 1 }, { b0: 40, name: 'phones' },
  { b0: 40.5, name: 'cards' }, { b0: 41.5, name: 'kid' }, { b0: 42, name: 'mark' }, { b0: 43, name: 'east' }, { b0: 44, name: 'dive' },
  { b0: 45, name: 'hero', v: 1 }, { b0: 48, name: 'lock' },
];
SHOTS.forEach((s, i) => { s.b1 = i + 1 < SHOTS.length ? SHOTS[i + 1].b0 : 99; });
const shotAt = beat => { const b = beat + 0.5 * FR / SPB; let s = SHOTS[0]; for (const x of SHOTS) if (b >= x.b0) s = x; return s; };

// ---------------------------------------------------------------- designed crowds (built once)
const CR = {};
function heroCrowd(v) {       // her section: her back (3D, the custom rank) over four ranks of backs stepping down to the turf
  const key = 'hero' + v; if (CR[key]) return CR[key];
  const c = RK.design({ seed: 11 + v, ranks: [
    { foot: 2420, h: 1500, draw: () => heroCanvas },
    { foot: 1560, h: 330, rows: 1, pack: 1.15, raise: 0.34, gaps: 0.05, kinds: KINDS },
    { foot: 1380, h: 196, rows: 2, thick: 0.18, pack: 1.2, raise: 0.3, kinds: KINDS },
    { foot: 1262, h: 112, rows: 2, thick: 0.2, pack: 1.25, raise: 0.28, kinds: KINDS },
    { foot: 1196, h: 64, rows: 2, thick: 0.2, pack: 1.3, raise: 0.22, kinds: KINDS },
  ] });
  RK.hit(c, bt(v ? 45 : 0) - 1 / 30, { from: [560, 1900], speed: 160, jitter: 3, lead: -3 });
  return (CR[key] = c);
}
const W0 = () => CR.w0 || (CR.w0 = (() => { const c = wall(21, { n: 13, foot: 2100, h: 470, ratio: 0.84, over: 0.66 }); RK.hit(c, bt(4), { from: [540, 2000], speed: 150, jitter: 3, lead: -3 }); return c; })());
const W1 = () => CR.w1 || (CR.w1 = (() => { const c = wall(22, { n: 22, foot: 2000, h: 300, ratio: 0.9, over: 0.6, raise: 0.3 }); RK.hit(c, bt(10), { from: [300, 2000], speed: 170, jitter: 3, lead: -3 }); return c; })());

// ================================================================ the shots, drawn
// ---- people seen from the front (c7 hero.js workers) under the stadium's floods
// key: the masts behind the lens, above and to the left (a cool-white flood); rim: the far floods behind her (cool, from above);
// a low warm bounce off the lit turf; the face falls into the hat brim's shadow the way a face under a hard hat does
function renderFronts({ key = 2.0, keyCol = '#f4f0ff', rimI = 2.6, rimCol = '#b4c8ff', hemi = 0.62, bounce = 0.55 } = {}) {
  const c0 = st.camera.position;
  stKey.color.set(keyCol); stKey.intensity = key; stKey.position.copy(c0).add(V3(-3.2, 4.2, 1.5)); stKey.target.position.set(0, 1.5, 0);
  stRim.color.set(rimCol); stRim.intensity = rimI; stRim.position.set(2.5, 5, -7); stRim.target.position.set(0, 1.5, 0);
  stRim2.color.set('#ffb36e'); stRim2.intensity = bounce; stRim2.position.copy(c0).add(V3(0.8, -2.2, 0.5)); stRim2.target.position.set(0, 1.3, 0);
  const h0 = stHemi.intensity; stHemi.intensity = hemi; st.r.toneMappingExposure = 1.0; st.renderLit(); stHemi.intensity = h0;
  stKey.intensity = stRim.intensity = stRim2.intensity = 0;
  const g = heroCanvas.getContext('2d'); g.clearRect(0, 0, W, H); g.drawImage(st.canvas, 0, 0); return heroCanvas;
}
const SKINFIX = 'saturate(0.8) contrast(1.04)';       // c7 skin under a hot key reads orange (HUMAN c7 "still weak" 2): pull it back a little
function bowlBackdrop(t, { flood = 1.3, cam = [-34, 2.4, -6], tgt = [70, 9, 6], fov = 36, blur = 2.5, expo = 1.3, lampK = 0.2, phoneK = 0.1 } = {}) {
  looksBowl({ flood, fog: 0.003 });
  crowdState({ fill: [1, 1, 1], stand: 1, arms: 0.9, lamp: s => (H01(s.seed * 5.1) < lampK ? 1 : 0), phone: s => (H01(s.seed * 2.9) < phoneK ? 1 : 0), t });
  rings('');
  setCam(V3(...cam), V3(...tgt), fov);
  mg.clearRect(0, 0, W, H); renderBowl(mg, { t, bloom: 0.9, expo });
  cg.save(); cg.filter = `blur(${blur}px)`; cg.drawImage(tmp, 0, 0); cg.restore();
}
function heroShot(t, beat, v) {
  // her, turned to the lens: the headlamp clicks on over her face, the badge on her vest, a fist up on the 808. The stands
  // behind her are the crowd facing the field, lit by the masts.
  bowlBackdrop(t, { cam: [-34 + (v ? 2 : 0), 2.4, -6], tgt: [70, 9, 6 + (v ? 4 : 0)] });
  const sh = cg.createLinearGradient(0, 0, 0, 800); sh.addColorStop(0, 'rgba(4,5,12,0.62)'); sh.addColorStop(1, 'rgba(4,5,12,0)'); cg.fillStyle = sh; cg.fillRect(0, 0, W, 800);   // the type's ground
  onlyHeroes(['mei']);
  const on = bt(v ? 45 : 0) - 1 / 30, push = v ? 0.05 * (beat - 45) : 0.07 * beat;
  poseBack(HEROES.mei, { x: 0, z: 0, turn: v ? 0.2 : -0.2, arm: 'R', strike: on, t, head: v ? -0.1 : 0.1 });
  st.lookAt(V3(v ? -0.3 : 0.3, 1.58, 3.3 - push), V3(0, 1.5, 0), 30);
  renderFronts();
  cg.save(); cg.filter = SKINFIX; cg.drawImage(heroCanvas, 0, 0); cg.restore();
  const hd = HEROES.mei.joint('head'), p = toScreen(hd.clone().add(V3(0, 0.15, 0.14)));
  const k = clamp((t - on) * 30 + 6, 0, 1) * (0.7 + 0.3 * Math.sin(t * 9));          // the headlamp clicks on at the hit
  phone(cg, p[0], p[1], 16, 1.0 * k);
  cg.save(); cg.globalCompositeOperation = 'lighter'; const gr = cg.createRadialGradient(p[0], p[1], 0, p[0], p[1], 360); gr.addColorStop(0, `rgba(255,244,220,${0.28 * k})`); gr.addColorStop(1, 'rgba(255,244,220,0)'); cg.fillStyle = gr; cg.fillRect(p[0] - 360, p[1] - 360, 720, 720); cg.restore();
}
// a section from the front, the bowl lit behind them. people: [{ n: name, x, z, arm, dy }]; rim-lit silhouettes when lit is false
function frontLine(t, beat, { people = [{ n: 'rosa', x: -0.66, z: 0.3, arm: 'L' }, { n: 'otis', x: 0.02, z: 0, arm: 'R' }, { n: 'kai', x: 0.68, z: 0.35, arm: 'R' }], b0 = 4, d = 4.2, fov = 34, ty = 1.6, light = {}, lamps = false, dim = 1 } = {}) {
  bowlBackdrop(t, { cam: [-34, 2.4, 8], tgt: [70, 10, -6], fov: 38, lampK: 0.25, flood: 1.3 * dim });
  onlyHeroes(people.map(p => p.n));
  people.forEach((p, i) => poseBack(HEROES[p.n], { x: p.x, y: p.dy || 0, z: p.z, turn: -p.x * 0.35 + (i % 2 ? 0.1 : -0.1), arm: p.arm || null, strike: bt(b0) - 1 / 30 + i * 0.03, t, head: (i % 3 - 1) * 0.1 }));
  st.lookAt(V3(0.1, ty, d), V3(0, ty - 0.05, 0), fov);
  renderFronts(light);
  cg.save(); cg.filter = SKINFIX; cg.drawImage(heroCanvas, 0, 0); cg.restore();
  if (lamps) for (const p of people) { const hd = HEROES[p.n].joint('head'), q = toScreen(hd.clone().add(V3(0, 0.14, 0.14))); phone(cg, q[0], q[1], 13, 1); }
}
function beam(g, a, b, k) {
  g.save(); g.globalCompositeOperation = 'lighter';
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l, w0 = 6, w1 = 150;
  const gr = g.createLinearGradient(a[0], a[1], b[0], b[1]); gr.addColorStop(0, `rgba(255,248,230,${0.45 * k})`); gr.addColorStop(0.3, `rgba(255,244,220,${0.16 * k})`); gr.addColorStop(1, 'rgba(255,240,210,0)');
  g.fillStyle = gr; g.beginPath(); g.moveTo(a[0] + nx * w0, a[1] + ny * w0); g.lineTo(b[0] + nx * w1, b[1] + ny * w1); g.lineTo(b[0] - nx * w1, b[1] - ny * w1); g.lineTo(a[0] - nx * w0, a[1] - ny * w0); g.fill();
  const sg = g.createRadialGradient(a[0], a[1], 0, a[0], a[1], 26); sg.addColorStop(0, `rgba(255,250,240,${0.6 * k})`); sg.addColorStop(1, 'rgba(255,240,220,0)');
  g.fillStyle = sg; g.fillRect(a[0] - 30, a[1] - 30, 60, 60);
  g.restore();
}
function wallShot(g, t, cr, { fieldY = null, k = 1, style = null, sink = null, lamps = 0 } = {}) {
  const fy = fieldY ?? Math.max(160, cr.top - 40);
  const back = gg => { gg.fillStyle = '#06070b'; gg.fillRect(0, 0, W, H); turf(gg, 0, fy, { k, t }); steps(gg, cr.feet, { k }); };
  cr.surge = sink || null;
  RK.compose(g, cr, t, { back, style: style || nightStyle(cr.ranks.length, { far: shade('#5e6478', 0.35 + 0.65 * k), near: '#07080e', key: '#a8b4d0', keyNear: 0.34 * k, keyFar: 0.12 * k, rimNear: 1.25, rimFar: 0.7, dust: '#b8c4e0', alt: 0.12 }), sun: [560, Math.max(0, fy - 200)], ground: false, dust: false, gapAmt: 0.34 * k, shadowAmt: 0 });
  if (lamps) for (const [x, y, hh, f] of headPts(cr, t)) if (H01(f.seed * 9.3) < 0.2) phone(g, x, y - hh * 0.02, Math.max(1.2, hh * 0.012), lamps);
}
function mascotShot(t, beat, fold, age) {
  // the sideline, full frame: the elephant and the donkey run the touchline; on the kick both suits fold flat and empty, heads on
  bowlBackdrop(t, { cam: [0, 1.6, 34], tgt: [0, 9, -60], fov: 30, blur: 4, lampK: 0, phoneK: 0.05, flood: 1.25, expo: 1.2 });
  const y0 = 1215, sc = Math.min(t, bt(15)) * 420;
  const gr = cg.createLinearGradient(0, y0, 0, H); gr.addColorStop(0, '#2c7a3a'); gr.addColorStop(0.5, '#1d5e2c'); gr.addColorStop(1, '#0d3a1b'); cg.fillStyle = gr; cg.fillRect(0, y0, W, H - y0);
  for (let i = -2; i < 9; i++) { const x = i * 190 - (sc % 380); if (i % 2) continue; cg.fillStyle = 'rgba(0,0,0,0.13)'; cg.beginPath(); cg.moveTo(x + 40, y0); cg.lineTo(x + 190 + 40, y0); cg.lineTo(x + 190 + 400, H); cg.lineTo(x + 400, H); cg.fill(); }
  cg.fillStyle = '#05060a'; cg.fillRect(0, y0 - 46, W, 46); cg.fillStyle = 'rgba(255,230,190,0.5)'; cg.fillRect(0, y0 - 46, W, 3);    // the low wall at the touchline
  cg.fillStyle = '#e8e8de'; cg.fillRect(0, y0 + 90, W, 12);                                                                       // the sideline
  const f = fold ? Math.min(1, age / 0.14) : 0, S = 270, fy = 1610;
  mascotBig(cg, 290 + (fold ? 20 : 0), fy, S, 'elephant', t, f, 1);
  mascotBig(cg, 800, fy + 20, S, 'donkey', t + 0.25, f, 1);
  const vg = cg.createRadialGradient(W / 2, 1000, 400, W / 2, 1000, 1300); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.5)'); cg.fillStyle = vg; cg.fillRect(0, 0, W, H);
  if (fold && age < 0.07) { cg.fillStyle = `rgba(255,255,255,${0.3 * (1 - age / 0.07)})`; cg.fillRect(0, 0, W, H); }
}
// ================================================================ take B: the fan-cam is the spine; the chant's growth counted in faces
// one face (b4), four (b10), sixteen (b18-22, three rows going red: the ≡), then the whole country (b34, faces over the lit towns)
const ORDER = ['mei', 'otis', 'rosa', 'kai', 'june', 'walt', 'ray', 'ada'];
function faceCrop(name, v, t, { tw, th, hit = -1, hitK = 1, arm = true } = {}) {
  // one person, head and shoulders, drawn into the stage canvas; returns the crop rect {sy, sh} to copy (aspect tw:th)
  const h = HEROES[name]; onlyHeroes([name]);
  poseBack(h, { x: 0, z: 0, turn: (v % 2 ? 0.3 : -0.3), arm: arm ? (v % 2 ? 'L' : 'R') : null, strike: hit < 0 ? null : hit, t, head: (v % 2 ? -0.12 : 0.12) + 0.05 * Math.sin(t * 2 + v) });
  const cropH = W * th / tw, Hw = 0.82, vis = Hw * H / cropH, d = vis / (2 * Math.tan(THREE.MathUtils.degToRad(15))), hy = h.joint('head').y;
  st.lookAt(V3((v % 2 ? -0.18 : 0.18), hy - 0.05, d), V3(0, hy - 0.08, 0), 30);
  renderFronts({ key: 2.1 });
  return { sy: (H - cropH) / 2, sh: cropH };
}
const PORT = new Map();
function portrait(name, v) {          // a cached portrait (the sixteen and the towns): rendered once
  const key = name + ':' + v; if (PORT.has(key)) return PORT.get(key);
  const c = document.createElement('canvas'); c.width = 256; c.height = 320; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 320); gr.addColorStop(0, ['#3a4058', '#4a3c34', '#2c3c46'][v % 3]); gr.addColorStop(1, '#10121a'); g.fillStyle = gr; g.fillRect(0, 0, 256, 320);
  const r = faceCrop(name, v, 0.4 + 0.1 * v, { tw: 256, th: 320, arm: true, hit: -9 });
  g.filter = SKINFIX + ' brightness(2.1)'; g.drawImage(heroCanvas, 0, r.sy, W, r.sh, 0, 0, 256, 320); g.filter = 'none';
  PORT.set(key, c); return c;
}
const wallCan = (() => { const c = document.createElement('canvas'); c.width = 1000; c.height = 1100; return c; })();
function faceWall(t, beat, n, { b0 = 4, redRow = 0, dur = 2 } = {}) {
  bowlBackdrop(t, { cam: [-34, 2.4, 8], tgt: [70, 10, -6], fov: 38, lampK: 0.25 });
  cg.fillStyle = 'rgba(4,5,10,0.55)'; cg.fillRect(0, 0, W, H);
  const cols = n === 1 ? 1 : n === 4 ? 2 : 4, rows = n === 1 ? 1 : n === 4 ? 2 : 4, fw = 1000, fh = 1100, tw = fw / cols, th = fh / rows, F = wallCan.getContext('2d');
  F.fillStyle = '#05060a'; F.fillRect(0, 0, fw, fh);
  const age = t - bt(b0);
  for (let i = 0; i < cols * rows; i++) {
    const cx = (i % cols) * tw, cy = Math.floor(i / cols) * th, name = ORDER[i % 8], v = Math.floor(i / 8) + (i % 3), red = Math.floor(i / cols) >= rows - redRow && rows > 1;
    F.save(); F.beginPath(); F.rect(cx + 3, cy + 3, tw - 6, th - 6); F.clip();
    const bgG = F.createLinearGradient(0, cy, 0, cy + th); bgG.addColorStop(0, ['#3a4058', '#4a3c34', '#2c3c46'][i % 3]); bgG.addColorStop(1, '#10121a'); F.fillStyle = bgG; F.fillRect(cx, cy, tw, th);
    if (n <= 4) {   // live: each one finds herself on the screen and puts a fist up on the hit (staggered)
      const r = faceCrop(name, v, t, { tw, th, hit: bt(b0) - 1 / 30 + i * 0.05 });
      F.save(); F.filter = SKINFIX + ' brightness(2.1)'; F.drawImage(heroCanvas, 0, r.sy, W, r.sh, cx, cy, tw, th); F.restore();
    } else {
      const P = portrait(name, v), pop = 1 + 0.06 * Math.exp(-Math.max(0, age - i * 0.03) * 7) * (age >= 0 ? 1 : 0), z = pop * (1.04 + 0.02 * Math.sin(t * 2 + i));
      F.drawImage(P, cx + tw * (1 - z) / 2, cy + th * (1 - z) / 2, tw * z, th * z);
    }
    if (red) { F.globalCompositeOperation = 'lighter'; F.fillStyle = 'rgba(190,12,22,0.5)'; F.fillRect(cx, cy, tw, th); F.globalCompositeOperation = 'source-over'; }
    F.fillStyle = '#e0141a'; F.beginPath(); F.arc(cx + 22, cy + 22, Math.max(5, tw * 0.03), 0, TAU); F.fill();
    F.restore();
  }
  mg3.clearRect(0, 0, W, H); mg3.drawImage(wallCan, 0, 0, W, H);
  mg2.clearRect(0, 0, W, H);
  board.draw(mg2, 40, 640, fw, fh, null, { src: tmp3, glow: 0.6, housing: true, pitch: n === 16 ? 4 : 5 });
  mg2.save(); mg2.globalCompositeOperation = 'lighter'; mg2.globalAlpha = 0.8; mg2.drawImage(tmp2, 0, 0); mg2.restore();   // the LED mask halves the picture: lift it
  cg.drawImage(tmp2, 0, 0);
}
const FACES = ['mei', 'otis', 'rosa', 'kai'];
function fancam(t, beat, u) {
  // the base: the section from behind, looking up at the board (fists up at their own picture)
  looksBowl({ flood: 1.0 });
  crowdState({ fill: [1, 0.95, 0.85], stand: 1, arms: 0.9, t });
  rings('');
  setCam(V3(-84, 12, 1), V3(60, 24, 0), 30);
  const bx = 70, by = 250, bw = 940, bh = 1020;
  mg.clearRect(0, 0, W, H);
  renderBowl(mg, { t, bloom: 0.7, expo: 1.2 });
  const c = CR.fan || (CR.fan = (() => { const cc = RK.design({ seed: 41, ranks: [
    { foot: 2060, h: 560, rows: 1, pack: 1.1, raise: 0.4, kinds: KINDS },
    { foot: 1780, h: 330, rows: 2, thick: 0.2, pack: 1.2, raise: 0.4, kinds: KINDS },
  ] }); RK.hit(cc, bt(16), { from: [540, 1900], speed: 180, jitter: 3, lead: -3 }); return cc; })());
  RK.compose(mg, c, t, { style: nightStyle(2, { far: '#1a1e2a' }), sun: [540, 560], ground: false, dust: false, gapAmt: 0.12, shadowAmt: 0 });
  // THE FEED: the fan-cam finds one of them at a time (scrubs, hi-vis, flannel, a knit cap), each seeing herself on the board and
  // putting a fist up; the board they are looking at shows the feed in a corner: board inside board, three levels deep
  const idx = clamp(Math.floor((beat - 16) * 2), 0, 3), who = FACES[idx], t0 = bt(16 + idx * 0.5);
  const fw = bw, fh = bh, band = W * fh / fw;
  onlyHeroes([who]);
  poseBack(HEROES[who], { x: 0, z: 0, turn: idx % 2 ? 0.28 : -0.28, arm: idx % 2 ? 'L' : 'R', strike: t0 - 1 / 30, t, head: idx % 2 ? -0.12 : 0.12 });
  const hy = HEROES[who].joint('head').y, vis = 1.36, dist = vis / (2 * Math.tan(THREE.MathUtils.degToRad(15)));
  st.lookAt(V3(idx % 2 ? -0.25 : 0.25, hy - 0.02, dist), V3(0, hy - 0.08, 0), 30);
  renderFronts({ key: 2.2 });
  const feeds = [0, 1, 2].map(() => { const c2 = document.createElement('canvas'); c2.width = fw; c2.height = fh; return c2; });
  const chrome = (g, x, y, w, h, s) => {     // the fan-cam chrome: a cream frame, a red live dot, the lower-third band
    g.save(); g.strokeStyle = PAL.cream; g.lineWidth = Math.max(1.5, 10 * s); g.strokeRect(x + 14 * s, y + 14 * s, w - 28 * s, h - 28 * s);
    g.fillStyle = '#e0141a'; g.beginPath(); g.arc(x + 58 * s, y + 60 * s, 15 * s, 0, TAU); g.fill();
    g.fillStyle = 'rgba(8,10,24,0.82)'; g.fillRect(x + 14 * s, y + h - 170 * s, w - 28 * s, 150 * s); g.restore();
  };
  for (let lev = 0; lev < 3; lev++) {
    const F = feeds[lev], fg = F.getContext('2d');
    const bgG = fg.createLinearGradient(0, 0, 0, fh); bgG.addColorStop(0, '#2a2c3c'); bgG.addColorStop(1, '#10121a'); fg.fillStyle = bgG; fg.fillRect(0, 0, fw, fh);
    fg.save(); fg.globalAlpha = 0.5; fg.filter = 'blur(10px)'; fg.drawImage(tmp, 0, 1100, W, W * fh / fw, 0, 0, fw, fh); fg.restore();      // the stands behind her, out of focus
    fg.save(); fg.filter = SKINFIX + ' brightness(2.6)'; fg.drawImage(heroCanvas, 0, (H - band) / 2, W, band, 0, 0, fw, fh); fg.restore();
    const mw = fw * 0.4, mh = fh * 0.4, mx = fw - mw - 34, my = 40;           // the board, in the corner of the feed
    fg.fillStyle = '#07080b'; fg.fillRect(mx - 8, my - 8, mw + 16, mh + 16);
    if (lev > 0) fg.drawImage(feeds[lev - 1], mx, my, mw, mh); else { fg.fillStyle = '#10141c'; fg.fillRect(mx, my, mw, mh); }
    chrome(fg, mx, my, mw, mh, mw / fw);
    chrome(fg, 0, 0, fw, fh, 1);
    fg.save(); fg.translate(0, 0); boardText(fg, 'HOME TEAM.', 130, fw / 2, fh - 92, { red: false }); fg.restore();
  }
  mg2.clearRect(0, 0, W, H); mg2.drawImage(tmp, 0, 0);
  board.draw(mg2, bx, by, bw, bh, null, { src: (() => { mg3.clearRect(0, 0, W, H); mg3.drawImage(feeds[2], 0, 0, W, H); return tmp3; })(), glow: 0.5, housing: true, pitch: 4 });
  mg2.save(); mg2.beginPath(); mg2.rect(bx, by, bw, bh); mg2.clip(); mg2.globalCompositeOperation = 'lighter'; mg2.globalAlpha = 0.75; mg2.drawImage(tmp2, 0, 0); mg2.restore();   // the LED mask halves the picture: lift it
  const z = 1 + 0.2 * ease.inOutCubic(u), cx = bx + bw / 2, cy = by + bh / 2;
  cg.save(); cg.translate(cx, cy); cg.scale(z, z); cg.translate(-cx, -cy); cg.drawImage(tmp2, 0, 0); cg.restore();
  WT.length = 0;
}
// the stripes: rows grouped into bands per deck, red inside, cream at the edges, so three red bands stand as ≡
function stripeOf(k) {
  return s => {
    if (s.deck === 3) return 0;
    const D = DECKS[s.deck], r = s.row / D.rows;
    const on = s.deck === 0 ? k >= 1 : s.deck === 1 ? k >= 2 : k >= 3;
    const inner = s.deck === 1 ? (r > 0.12 && r < 0.9) : (r > 0.16 && r < 0.84);
    return on ? (inner ? 1 : 2) : 0;
  };
}
function stripeShot(t, beat, S, u) {
  const k = S.name === 'eq' ? 3 : S.k, hitAge = t - bt(S.b0);
  looksBowl({ flood: 1.0, fog: 0.0025 });
  crowdState({ fill: [1, 1, 1], stand: 1, arms: s => (s.deck + 1 === k ? 0.9 : 0.4), stripe: stripeOf(k), t });
  crowd.mat.uniforms.uStripeK.value = 0.35 + 0.9 * Math.exp(-hitAge * 6);         // the phone-light flash as each deck turns
  rings('', '#F4E6D0', { fill: 0.9, fillCol: '#F4E6D0' });
  if (S.name === 'eq') setCam(V3(-8 + 3 * u, 1.7, 0), V3(100, 23, 0), 46);
  else if (k === 1) setCam(V3(-40, 2.5, 0), V3(76, 7.5, 6 - 8 * u), 22);
  else if (k === 2) setCam(V3(-40, 3, 0), V3(84, 15, -6 + 8 * u), 32);
  else setCam(V3(-40, 3.5, 0), V3(92, 24, 4 - 6 * u), 44);
  renderBowl(cg, { t, bloom: 0.7, sat: 1.05 });
  if (S.name !== 'eq') {         // the people making it: a row of them close, red over the hi-vis, phones up red, the deck turning behind
    const sg = cg.createLinearGradient(0, 1250, 0, H); sg.addColorStop(0, 'rgba(4,5,10,0)'); sg.addColorStop(1, 'rgba(4,5,10,0.8)'); cg.fillStyle = sg; cg.fillRect(0, 1250, W, H - 1250);
    const names = [['ray', 'june', 'kai'], ['otis', 'mei', 'walt'], ['rosa', 'ada', 'otis']][k - 1]; onlyHeroes(names);
    names.forEach((n, i) => poseBack(HEROES[n], { x: (i - 1) * 0.7, z: i === 1 ? 0 : 0.3, turn: -(i - 1) * 0.3, arm: i === 1 ? 'L' : 'R', strike: bt(S.b0) - 1 / 30 + i * 0.03, t, head: (i - 1) * 0.1 }));
    st.lookAt(V3(0, 2.44, 4.6), V3(0, 2.3, 0), 34);
    renderFronts({ keyCol: '#ff8a74', rimCol: '#ffe6cc', key: 3.2, rimI: 3.2, hemi: 0.9 });
    cg.save(); cg.filter = SKINFIX; cg.drawImage(heroCanvas, 0, 0); cg.restore();
    names.forEach((n, i) => { const w = toScreen(HEROES[n].joint(i === 1 ? 'wrist.L' : 'wrist.R').clone().add(V3(0, 0.1, 0))); cg.save(); cg.globalCompositeOperation = 'lighter'; const gr = cg.createRadialGradient(w[0], w[1], 0, w[0], w[1], 70); gr.addColorStop(0, 'rgba(255,70,60,0.95)'); gr.addColorStop(1, 'rgba(255,40,40,0)'); cg.fillStyle = gr; cg.fillRect(w[0] - 70, w[1] - 70, 140, 140); cg.restore(); });
  }
}
function waveShot(t, beat, u) {
  // the Wave: a band of standing, arms-up, phone-lit seats sweeping round the bowl; a-MER-i-CAN rides the club ring
  looksBowl({ flood: 0.95 });
  const th = -0.35 + (beat - 26) * 0.4;                         // the crest crosses the far stand in front of the lens at b27
  const near = s => { let d = Math.atan2(s.z / 42, s.x / 64) - th; d = Math.atan2(Math.sin(d), Math.cos(d)); return Math.exp(-d * d * 110); };
  crowdState({ fill: [1, 1, 1], stand: s => (near(s) > 0.3 ? 1 : 0.2), arms: s => near(s), phone: s => near(s) > 0.5 ? 1 : 0, stripe: s => (near(s) > 0.25 ? 1 : 0), t });
  crowd.mat.uniforms.uStripeK.value = 0.9;                       // the Wave is a travelling band of red light and bodies up
  const syl = ['A', 'MER', 'I', 'CAN'][clamp(Math.floor((beat - 26) * 2), 0, 3)];
  rings('');          // the wave is carried by bodies (the ribbon letters read as A A A A at phone size)
  setCam(V3(-76, 9, -14), V3(92, 16.5, 14 - 20 * u), 20);
  renderBowl(cg, { t, bloom: 0.9 });
}
function roomShot(t, beat, i) {
  // new rows rising over the rim, backlit by the bowl's own glow in the haze above it (four micro-cuts, a scale each):
  // from outside and below the rim, the wall a solid black band, the people climbing into the light over it
  const py = [1320, 1220, 1150, 1080][i], sc = [1, 0.62, 0.4, 0.26][i];
  const sky = cg.createLinearGradient(0, 0, 0, py); sky.addColorStop(0, '#0c1224'); sky.addColorStop(0.55, '#3a4462'); sky.addColorStop(0.92, '#d8c4a0'); sky.addColorStop(1, '#fff0d0');
  cg.fillStyle = sky; cg.fillRect(0, 0, W, py);
  const key = 'room' + i;
  const c = CR[key] || (CR[key] = RK.design({ seed: 50 + i, ranks: [
    { foot: py + 420 * sc, h: 900 * sc, rows: 1, pack: 1.05, raise: 0.4, kinds: KINDS },
    { foot: py + 240 * sc, h: 620 * sc, rows: 2, thick: 0.25, pack: 1.2, raise: 0.4, kinds: KINDS },
    { foot: py + 120 * sc, h: 400 * sc, rows: 2, thick: 0.25, pack: 1.3, raise: 0.35, kinds: KINDS },
  ] }));
  c.surge = (f, tt) => { const k = ease.outBack(clamp((tt - bt(28 + i * 0.5) + 0.06 - (2 - f.rank) * 0.04 - (f.x / W) * 0.05) / 0.16)); return { dx: 0, dy: f.h * 0.75 * (1 - k), k: 1 }; };
  RK.compose(cg, c, t, { style: nightStyle(3, { rim: '#fff4dc', far: '#141824', rimNear: 1.4, rimFar: 1.0 }), sun: [W / 2 + 120, py + 40], ground: false, dust: false, gap: false, shadowAmt: 0 });
  // the rim wall: a solid band, its lip catching the glow; a rail post every few metres
  const wl = cg.createLinearGradient(0, py, 0, H); wl.addColorStop(0, '#1b2236'); wl.addColorStop(0.5, '#0c101c'); wl.addColorStop(1, '#05060a'); cg.fillStyle = wl; cg.fillRect(0, py, W, H - py);   // the stadium's outer wall under the rim, floodlit from above
  cg.fillStyle = 'rgba(255,236,200,0.07)'; for (let x = 20; x < W; x += 90) cg.fillRect(x, py, 38, H - py);               // concrete ribs
  for (let x = 140; x < W; x += 360) { const gw = cg.createLinearGradient(0, py, 0, py + 700); gw.addColorStop(0, 'rgba(255,214,150,0.55)'); gw.addColorStop(1, 'rgba(255,214,150,0)'); cg.fillStyle = gw; cg.fillRect(x, py, 70, 700); }   // the gates' glow
  cg.fillStyle = 'rgba(255,230,190,0.55)'; cg.fillRect(0, py, W, 3);
  cg.fillStyle = '#05060a'; for (let x = 40; x < W; x += 240 * sc + 60) cg.fillRect(x, py - 90 * sc, 8 * sc + 3, 90 * sc);
  cg.fillRect(0, py - 90 * sc, W, 6 * sc + 2);
}
function craneShot(g, t, beat, u) {
  // COAST TO COAST.: the floods slam on and the camera keeps climbing, out of the bowl, until it is a lit ring in the dark country;
  // the country shot picks it up from there (a dissolve on the same centre, never a cut to a map)
  const e = ease.inOutCubic(u), h = lerp(14, 2600, Math.pow(e, 1.7));
  looksBowl({ flood: 1.25, fog: lerp(0.0015, 0.00006, Math.min(1, e * 1.4)), lamps: 1.3 });
  crowdState({ fill: [1, 1, 1], stand: 1, arms: 0.9, phone: s => H01(s.seed * 2.3) < 0.5 ? 1 : 0, stripe: stripeOf(3), t });
  crowd.mat.uniforms.uStripeK.value = 0.4 + 0.8 * Math.exp(-(beat - 32) * 3);
  rings('', '#F4E6D0', { fill: 0.9, fillCol: '#F4E6D0' });
  setCam(V3(lerp(-70, -6, e), h, lerp(18, 1, e)), V3(lerp(40, 0, e), 0, 0), lerp(58, 34, e));
  renderBowl(g, { t, bloom: 1.0, streak: 0.4 });
  if (e > 0.2) { const r = rng(77), a = clamp((e - 0.2) / 0.4); g.save(); g.globalCompositeOperation = 'lighter';     // the towns round the stadium
    for (let k = 0; k < 1600; k++) { const ang = r() * TAU, d = 170 + Math.pow(r(), 0.7) * 3400, p = proj(V3(Math.cos(ang) * d, 0, Math.sin(ang) * d * 0.9)); if (p[2] > 1) continue;
      const s = 1 + r() * 2.4; g.fillStyle = `rgba(255,${170 + r() * 60 | 0},${90 + r() * 60 | 0},${a * (0.3 + 0.6 * r())})`; g.fillRect(p[0], p[1], s, s); }
    g.restore(); }
}
function countryShot(t, beat, u) {
  // the country, lit from the middle out (the bowl's own light running to both coasts): lights only, no borders
  cg.fillStyle = '#020306'; cg.fillRect(0, 0, W, H);
  const r = lerp(90, 1100, ease.inOutCubic(clamp((beat - 34) / 2)));        // lit from the first frame (never a black cut)
  const cam = { x: 560, y: 390, zoom: lerp(1.9, 1.02, ease.inOutCubic(u)), sy: 980 };
  const oc = us.toScreen(us.project(HOME), cam), shk = 1 - ease.inOutCubic(clamp(u * 1.6));
  cg.save(); cg.translate((W / 2 - oc[0]) * shk, (H / 2 - oc[1]) * shk);     // the bowl's light sits at the centre where the climb left it
  // the dark land (no county fill: the ignition front read as blocky tiles), then the towns switched on from the middle out
  us.draw(cg, { cam, t, style: 'night', towns: 0, unlit: 2.2, ignite: { origin: HOME, r: -1e4, width: 1, heat: 0 }, grid: 0, borders: 0, res: 0.75, embers: false });
  { // the towns switch on as the ring passes them (drawn here: usmap.towns' ignite needs per-county fields cities lack)
    const o0 = us.project(HOME), z = cam.zoom || 1;
    cg.save(); cg.globalCompositeOperation = 'lighter';
    for (const c of us.cities) { if (c.pop < 6000) break;
      const d = Math.hypot(c.x - o0[0], c.y - o0[1]) * (0.85 + 0.3 * H01(c.x * 0.37 + c.y)), a = clamp((r - d) / 50); if (a <= 0) continue;
      const [x, y] = us.toScreen([c.x, c.y], cam), sz = (0.8 + Math.log10(c.pop / 6000 + 1) * 2.4) * 0.42 * Math.sqrt(z);
      const flash = Math.exp(-Math.max(0, r - d) / 30);         // a spark as each town comes on
      cg.globalAlpha = 0.3 * a + 0.5 * flash; cg.fillStyle = '#ff8a2c'; cg.fillRect(x - sz * 2.2, y - sz * 2.2, sz * 4.4, sz * 4.4);
      cg.globalAlpha = a; cg.fillStyle = '#ffe6b8'; cg.fillRect(x - sz / 2, y - sz / 2, sz, sz); }
    cg.restore(); }
  { // take B: the whole country is faces: a portrait over each big town as the light reaches it
    const o0 = us.project(HOME), z = cam.zoom || 1; let k = 0;
    for (const c of us.cities) { if (k >= 70) break; k++;
      const d = Math.hypot(c.x - o0[0], c.y - o0[1]) * (0.85 + 0.3 * H01(c.x * 0.37 + c.y)), a = clamp((r - d) / 60); if (a <= 0) continue;
      const [x, y] = us.toScreen([c.x, c.y], cam), sz = (44 + 36 * Math.min(1, Math.log10(c.pop / 1e5 + 1))) * Math.sqrt(z) * (0.6 + 0.4 * a), P = portrait(ORDER[k % 8], Math.floor(k / 8) % 2);
      cg.save(); cg.globalAlpha = a; cg.beginPath(); cg.arc(x, y, sz / 2, 0, TAU); cg.clip(); cg.drawImage(P, 0, 40, 256, 220, x - sz / 2, y - sz / 2, sz, sz); cg.restore();
      cg.save(); cg.globalAlpha = a; cg.strokeStyle = '#f4e6d0'; cg.lineWidth = 2; cg.beginPath(); cg.arc(x, y, sz / 2, 0, TAU); cg.stroke(); cg.restore(); }
  }
  const o = us.toScreen(us.project(HOME), cam);
  const gg = cg.createRadialGradient(o[0], o[1], 2, o[0], o[1], 48); gg.addColorStop(0, 'rgba(255,250,235,0.9)'); gg.addColorStop(1, 'rgba(255,220,160,0)');
  cg.save(); cg.globalCompositeOperation = 'lighter'; cg.fillStyle = gg; cg.fillRect(o[0] - 100, o[1] - 100, 200, 200); cg.restore();
  cg.restore();
}
function eastShot(t, beat, u) {
  // b43: the four stripes run east from the bowl across the lit country as four lines of red light
  cg.fillStyle = '#020306'; cg.fillRect(0, 0, W, H);
  const cam = { x: 700, y: 360, zoom: 2.3 + 0.2 * u, sy: 760 };
  us.draw(cg, { cam, t, style: 'night', grid: 0, borders: 0, res: 0.75, embers: false, dim: 0.9 });
  const o = us.toScreen(us.project(HOME), cam), e = us.toScreen(us.project([-70, 39.1]), cam);
  const head = lerp(o[0], e[0] + 200, ease.outCubic(clamp((beat - 43) / 0.8)));
  cg.save(); cg.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 4; k++) { const y = o[1] - 84 + k * 56, gr = cg.createLinearGradient(o[0], 0, Math.max(o[0] + 1, head), 0);
    gr.addColorStop(0, 'rgba(230,20,24,0.95)'); gr.addColorStop(0.85, 'rgba(255,60,50,0.95)'); gr.addColorStop(1, 'rgba(255,220,200,1)');
    cg.fillStyle = gr; cg.fillRect(o[0], y - 12, head - o[0], 24);
    cg.globalAlpha = 0.35; cg.fillRect(o[0], y - 28, head - o[0], 56); cg.globalAlpha = 1; }
  cg.restore();
  acpEmblem(cg, o[0] - 80, o[1], 270, { color: null });
}
const stand = new CardStand(BRAND.acp_emblem, { cols: 90, rows: 84 });
function cardShot(t, beat, S, u, age) {
  // across the field: a lit block of the stands, people holding cards up, the mark coming up in FOUR WAVES (a quarter of the bowl
  // each, left to right), a few wrong or late until the lock, one hole (the kid's card, upside down); b42 it locks square, red light
  const wide = S.name === 'cards', uu = wide ? clamp((beat - 40.5) / 1.0) : 1, lock = wide ? 0 : ease.outCubic(clamp(age / 0.12));
  mg.fillStyle = '#04050a'; mg.fillRect(0, 0, W, H);
  const sky = mg.createLinearGradient(0, 0, 0, 420); sky.addColorStop(0, '#0a0e1c'); sky.addColorStop(1, '#1a2036'); mg.fillStyle = sky; mg.fillRect(0, 0, W, 420);
  mg.save(); mg.globalCompositeOperation = 'lighter';       // the floods across the top of the far stand, hazy
  for (const fx of [150, 380, 620, 880]) { const g2 = mg.createRadialGradient(fx, 130, 4, fx, 130, 230); g2.addColorStop(0, 'rgba(255,250,235,0.95)'); g2.addColorStop(0.15, 'rgba(255,240,210,0.4)'); g2.addColorStop(1, 'rgba(255,240,210,0)'); mg.fillStyle = g2; mg.fillRect(fx - 240, 0, 480, 480); }
  mg.restore();
  const res = stand.draw(mg, 0, 420, W, 1008, { u: uu, lock, kid: wide ? 0 : 1, t });
  mg.fillStyle = '#0a0e0a'; mg.fillRect(0, 1428, W, H - 1428); const tg2 = mg.createLinearGradient(0, 1428, 0, H); tg2.addColorStop(0, '#16301a'); tg2.addColorStop(1, '#0a1a0c'); mg.fillStyle = tg2; mg.fillRect(0, 1428, W, H - 1428);   // the field's edge, in front
  if (!wide) { const g3 = mg.createRadialGradient(W / 2, 960, 50, W / 2, 960, 900); g3.addColorStop(0, 'rgba(255,40,40,0.22)'); g3.addColorStop(1, 'rgba(255,40,40,0)'); mg.save(); mg.globalCompositeOperation = 'lighter'; mg.fillStyle = g3; mg.fillRect(0, 0, W, H); mg.restore(); }
  const zoom = S.name === 'dive' ? 1 + 6 * Math.pow(u, 2.2) : 1 + (wide ? 0.06 * u : 0.0);
  const [kx, ky] = S.name === 'dive' ? res.kid : [W / 2, 960];
  cg.save(); cg.translate(kx, ky); cg.scale(zoom, zoom); cg.translate(-kx, -ky); cg.drawImage(tmp, 0, 0); cg.restore();
  if (S.name === 'dive') {   // cards flung into the air round the lens as the camera dives through the mark
    const rr = rng(3); cg.save();
    for (let k = 0; k < 60; k++) { const a = rr() * TAU, d = (0.2 + rr()) * 900 * Math.pow(u, 0.7), x = W / 2 + Math.cos(a) * d, y = H / 2 + Math.sin(a) * d * 1.3, s = 30 + 160 * u * rr();
      cg.translate(x, y); cg.rotate(a + u * 4); cg.fillStyle = rr() < 0.6 ? '#c8161c' : '#efe2c8'; cg.fillRect(-s / 2, -s * 0.35, s, s * 0.7); cg.setTransform(1, 0, 0, 1, 0, 0); }
    cg.restore(); }
}
function kidShot(t, beat, age, dur) {
  // the kid with the upside-down card: Kai, lit by the phones and the masts, turns his card over: cream and upside down, then red
  const u = clamp(age / dur), flip = ease.inOutCubic(clamp((u - 0.25) / 0.45));
  mg.fillStyle = '#05060a'; mg.fillRect(0, 0, W, H); stand.draw(mg, 0, 420, W, 1008, { u: 1, lock: 0, kid: flip, t });
  cg.save(); cg.filter = 'blur(16px) brightness(0.55)'; cg.drawImage(tmp, 0, 0); cg.restore();
  onlyHeroes(['kai']);
  poseBack(HEROES.kai, { x: 0, z: 0, turn: 0.08, arm: null, t, head: -0.06 + 0.1 * flip });
  st.lookAt(V3(0, 1.28, 3.3), V3(0, 1.18, 0), 30);
  renderFronts({ key: 2.0, keyCol: '#ffe2c4' });
  cg.save(); cg.filter = SKINFIX; cg.drawImage(heroCanvas, 0, 0); cg.restore();
  const cw = 560, chh = 380 * Math.max(0.06, Math.abs(Math.cos(flip * Math.PI))), red = flip > 0.5;
  cg.save(); cg.translate(W / 2, 1330 + 8 * Math.sin(u * 9));
  cg.fillStyle = red ? '#d0161c' : '#efe2c8'; cg.fillRect(-cw / 2, -chh / 2, cw, chh);
  if (!red) { cg.fillStyle = '#b8a888'; cg.save(); cg.scale(1, Math.max(0.06, Math.abs(Math.cos(flip * Math.PI))));    // the printed "this side up" arrow, pointing down: upside down
    cg.beginPath(); cg.moveTo(-50, -110); cg.lineTo(50, -110); cg.lineTo(50, 10); cg.lineTo(110, 10); cg.lineTo(0, 140); cg.lineTo(-110, 10); cg.lineTo(-50, 10); cg.closePath(); cg.fill(); cg.restore(); }
  cg.strokeStyle = 'rgba(255,240,220,0.55)'; cg.lineWidth = 3; cg.strokeRect(-cw / 2, -chh / 2, cw, chh); cg.restore();
  for (const sg of [-1, 1]) {      // his hands on the card's edges: the heel of the hand behind, four fingers curled over the top corner
    const hx = W / 2 + sg * (cw / 2 - 6), hy = 1330 - chh / 2 + 24; cg.save(); cg.translate(hx, hy);
    const sk = cg.createRadialGradient(-sg * 8, -10, 6, 0, 0, 80); sk.addColorStop(0, '#c89070'); sk.addColorStop(1, '#6a4030'); cg.fillStyle = sk; cg.strokeStyle = '#2a1810'; cg.lineWidth = 3;
    cg.beginPath(); cg.ellipse(sg * 6, 36, 40, 52, sg * 0.12, 0, TAU); cg.fill(); cg.stroke();
    for (let f = 0; f < 4; f++) { cg.beginPath(); cg.ellipse(-sg * 12 + sg * f * 2, -14 + f * 26, 24, 12, sg * 0.15, 0, TAU); cg.fill(); cg.stroke(); }
    cg.restore(); }
  if (red) { cg.save(); cg.globalCompositeOperation = 'lighter'; const g3 = cg.createRadialGradient(W / 2, 1000, 20, W / 2, 1000, 700); g3.addColorStop(0, 'rgba(255,50,40,0.28)'); g3.addColorStop(1, 'rgba(255,50,40,0)'); cg.fillStyle = g3; cg.fillRect(0, 0, W, H); cg.restore(); }
  const hd = HEROES.kai.joint('head'), p = toScreen(hd.clone().add(V3(0, 0.12, 0.13)));
  phone(cg, p[0], p[1], 10, 0.8);     // the headlamp on his cap
}
// the stands round the card section from the blimp: seat rows curving with the bowl, heads in rows, aisles, phone
// points, the turf's edge at the bottom of the frame (built once)
let _stands = null;
function standsTop() {
  if (_stands) return _stands;
  const c = mk(), g = c.getContext('2d'), r = rng(9);
  g.fillStyle = '#07080c'; g.fillRect(0, 0, W, H);
  for (let row = 0; row < 90; row++) { const y = -40 + row * 23.5, bend = (x => 0.00009 * (x - 540) * (x - 540));
    g.strokeStyle = 'rgba(40,44,56,0.9)'; g.lineWidth = 3; g.beginPath(); for (let x = 0; x <= W; x += 30) g.lineTo(x, y + bend(x)); g.stroke();
    for (let x = 6 + (row % 2) * 6; x < W; x += 12) { if ((Math.floor(x / 168) + 1) * 168 - x < 14) continue; if (r() < 0.12) continue;
      const yy = y + bend(x) - 7; g.fillStyle = r() < 0.5 ? '#1a1e2a' : '#11141c'; g.beginPath(); g.ellipse(x, yy, 4.6, 5.2, 0, 0, TAU); g.fill();
      if (r() < 0.12) phone(g, x, yy - 5, 1.3, 0.8); } }
  g.fillStyle = 'rgba(10,12,18,0.95)'; for (let x = 168; x < W; x += 168) g.fillRect(x - 7, 0, 14, H);          // the stair aisles
  const tg2 = g.createLinearGradient(0, 1760, 0, H); tg2.addColorStop(0, '#0a120c'); tg2.addColorStop(1, '#2e4a2c'); g.fillStyle = tg2; g.fillRect(0, 1760, W, 160);   // the field's edge
  return (_stands = c);
}
const REGP = [['walt', 'june'], ['otis', 'mei'], ['ray', 'ada'], ['kai', 'rosa']];
const REGL = [['#ffc98a', '#7aa0ff'], ['#ffb46a', '#9ab8ff'], ['#ff9a54', '#a8c0ff'], ['#ffd89a', '#8aa8ff']];
function regionShot(g, t, i) {
  // a real place for each syllable (rowhouse roofs, a headframe town, a refinery catwalk, a harvest crew), two of them in it, phones up,
  // lit warm by the place's own lamps with the sky's blue on the rim
  region(g, i, t, { horizon: 1180 });
  const c = CR['reg' + i] || (CR['reg' + i] = (() => { const cc = RK.design({ seed: 60 + i, ranks: [
    { foot: 1330, h: 140, rows: 2, thick: 0.2, pack: 1.3, raise: 0.45, kinds: KINDS },
    { foot: 1230, h: 64, rows: 2, thick: 0.2, pack: 1.4, raise: 0.4, kinds: KINDS },
  ] }); RK.hit(cc, bt(36 + i * 0.5) - 2 / 30, { from: [540, 2000], speed: 240, jitter: 2 }); return cc; })());
  RK.compose(g, c, t, { style: nightStyle(2, { rim: '#ffc98a', far: '#2a2426' }), sun: [[640, 420, 560, 700][i], 1150], ground: false, dust: false, gapAmt: 0.12, shadowAmt: 0 });
  const names = REGP[i]; onlyHeroes(names);
  const on = bt(36 + i * 0.5) - 1 / 30;
  names.forEach((n, k) => poseBack(HEROES[n], { x: k ? 0.5 : -0.5, z: k ? 0.1 : 0, turn: k ? -0.35 : 0.35, arm: k ? 'L' : 'R', strike: on + k * 0.04, t, head: k ? 0.1 : -0.1 }));
  st.lookAt(V3(0, 2.03, 4.4), V3(0, 1.9, 0), 32);
  renderFronts({ keyCol: REGL[i][0], rimCol: REGL[i][1], key: 3.0, rimI: 3.4, hemi: 0.9 });
  g.save(); g.filter = SKINFIX; g.drawImage(heroCanvas, 0, 0); g.restore();
  names.forEach((n, k) => { const w = toScreen(HEROES[n].joint(k ? 'wrist.L' : 'wrist.R').clone().add(V3(0, 0.1, 0))); phone(g, w[0], w[1], 14, 1); });
}
function frameAt(t, beat) {
  const S = shotAt(beat), u = clamp((beat - S.b0) / (S.b1 - S.b0)), age = t - bt(S.b0);
  cg.globalAlpha = 1; cg.globalCompositeOperation = 'source-over'; cg.filter = 'none';
  cg.fillStyle = '#000'; cg.fillRect(0, 0, W, H);
  onlyHeroes([]); WT.length = 0;
  const look = { bloom: 0.25 };
  switch (S.name) {
    case 'hero': heroShot(t, beat, S.v || 0); break;
    case 'badge': turnstile(cg, S.i, age); look.bloom = 0.4; break;
    case 'wall': faceWall(t, beat, S.v ? 4 : 1, { b0: S.b0 }); break;
    case 'farstand': {     // the empty far stand answers: a dotted line of headlamps clicking on, one beat late
      looksBowl({ flood: 0.28, fog: 0.004 });
      const on = s => (s.deck === 2 && s.x > 40 && (s.row % 4 === 1) && ((s.z + 60) / 120) < (beat - 5.05) * 2.2) ? 1 : 0;
      crowdState({ fill: [0.9, 0.5, 0.55], stand: 1, lamp: on, t });
      crowd.mat.uniforms.uLampK.value = 3.5;
      rings('');
      setCam(V3(-70, 8, 2), V3(110, 20, 0), 28);
      renderBowl(cg, { t, bloom: 1.3, streak: 0.5, expo: 1.6 });
      crowd.mat.uniforms.uLampK.value = 1;
      break;
    }
    case 'shift': {        // DAY SHIFT. / NIGHT SHIFT.: the same section, two shifts interleaved: a navy coverall under a white hat (day) beside an older man in a work cap (night), side by side;
                           // on NIGHT SHIFT. her neighbour's headlamp comes on and a fist goes up
      frontLine(t, beat, { b0: S.b0, d: 3.5, fov: 36, ty: 1.72, lamps: false, light: { key: 2.2 },
        people: [{ n: 'ada', x: -0.42, z: 0.1, arm: S.i ? null : 'L' }, { n: 'walt', x: 0.42, z: 0, arm: S.i ? 'R' : null }] });
      if (S.i) { const hd = HEROES.walt.joint('head'), q = toScreen(hd.clone().add(V3(0, 0.15, 0.14))); phone(cg, q[0], q[1], 16, 1); }
      break;
    }
    case 'rise': {         // the section stands up out of its seats, left to right, on the beat: four of them, lit from the masts
      const xs = [-0.9, -0.3, 0.3, 0.9], ps = ['walt', 'june', 'ray', 'ada'].map((n, i) => ({ n, x: xs[i], z: i % 2 ? 0 : 0.15, arm: i % 2 ? 'R' : 'L', dy: -1.15 * (1 - ease.outBack(clamp((t - bt(8) - 0.07 * i) / 0.32))) }));
      frontLine(t, beat, { b0: 8.6, d: 4.7, fov: 40, ty: 1.6, people: ps });
      break;
    }
    case 'bowlwide': {     // b12: the bowl from the corner of the upper deck, the upper deck filling down its aisles
      looksBowl({ flood: 1.0 });
      crowdState({ fill: [1, 0.95, lerp(0.35, 0.95, ease.inOutCubic(u))], stand: 1, arms: 0.7, t });
      rings('');
      setCam(V3(-58 + 6 * u, 30, -26 + 4 * u), V3(36, 12, 8), 62);
      renderBowl(cg, { t, bloom: 0.8 });
      break;
    }
    case 'race': case 'fold': mascotShot(t, beat, S.name === 'fold' ? 1 : 0, age); break;
    case 'fancam': fancam(t, beat, u); break;
    case 'stripe': faceWall(t, beat, 16, { b0: S.b0, redRow: S.k }); break;
    case 'eq': stripeShot(t, beat, S, u); break;
    case 'feet': {         // ON YOUR FEET.: the upper deck stands row by row, bottom to top, in its stripes
      looksBowl({ flood: 1.0 });
      crowdState({ fill: [1, 1, 1], stand: s => s.deck < 2 ? 1 : ((beat - 24.1) * 1.1 - s.row / 34 * 1.2 > 0 ? 1 : 0), arms: s => s.deck === 2 ? 0.8 : 0.5, stripe: stripeOf(3), t });
      crowd.mat.uniforms.uStripeK.value = 0.35;
      rings('', '#F4E6D0', { fill: 0.9, fillCol: '#F4E6D0' });
      setCam(V3(-40, 3.2, 0), V3(96, 30 + 5 * u, 2 - 4 * u), 40);
      renderBowl(cg, { t, bloom: 0.8 });
      break;
    }
    case 'wave': waveShot(t, beat, u); break;
    case 'room': roomShot(t, beat, S.i); break;
    case 'crouch': case 'silence': {   // the floods dip to the headlamps: the section crouches low, in silhouette, lamps on (b31: the one silence, never black)
      const sil = S.name === 'silence', k = ease.outCubic(clamp((t - bt(30)) / 0.18));
      const xs = [-0.95, -0.32, 0.32, 0.95, -0.62, 0, 0.62], ns = ['rosa', 'otis', 'kai', 'mei', 'walt', 'june', 'ray'];
      frontLine(t, beat, { b0: 99, d: 5.0, fov: 42, ty: 1.55, dim: sil ? 0.35 : lerp(1, 0.4, k), lamps: true, light: { key: 0.25, keyCol: '#8aa0d0', rimI: sil ? 3.2 : 2.6, hemi: 0.18, bounce: 0.1 },
        people: ns.map((n, i) => ({ n, x: xs[i], z: i > 3 ? -0.9 : (i % 2) * 0.1, arm: null, dy: -0.42 * k })) });
      look.bloom = 0.9;
      break;
    }
    case 'crane': craneShot(cg, t, beat, u); break;
    case 'country': {
      countryShot(t, beat, u);
      if (beat < 34.55) { mg2.clearRect(0, 0, W, H); craneShot(mg2, t, beat, 1); cg.save(); cg.globalAlpha = 1 - ease.inOutCubic(clamp((beat - 34) / 0.5)); cg.drawImage(tmp2, 0, 0); cg.restore(); }
      break;
    }
    case 'region': regionShot(cg, t, S.i); break;
    case 'quad': {         // b38: all four regions at once
      for (let i = 0; i < 4; i++) { mg2.clearRect(0, 0, W, H); regionShot(mg2, t, i);
        const x = (i % 2) * W / 2, y = Math.floor(i / 2) * H / 2; cg.drawImage(tmp2, W * 0.1, H * 0.12, W * 0.8, H * 0.8, x, y, W / 2, H / 2); }
      cg.fillStyle = '#05060a'; cg.fillRect(W / 2 - 4, 0, 8, H); cg.fillRect(0, H / 2 - 4, W, 8);
      break;
    }
    case 'phones': {       // b40: the whole bowl in phone light, the floods down (the Klutsis hand-sea in phone light)
      looksBowl({ flood: 0.12, lamps: 0.25 });
      crowdState({ fill: [1, 1, 1], stand: 1, arms: 0.9, phone: s => H01(s.seed * 2.3) < 0.85 ? 1 : 0, stripe: stripeOf(3), t });
      crowd.mat.uniforms.uStripeK.value = 0.12; crowd.mat.uniforms.uPhoneK.value = 3.0;
      rings('');
      setCam(V3(-50, 4, 0), V3(100, 26, 6 - 10 * u), 44 - 6 * u);
      renderBowl(cg, { t, bloom: 1.2, streak: 0.5 });
      break;
    }
    case 'cards': case 'mark': case 'dive': cardShot(t, beat, S, u, age); break;
    case 'kid': kidShot(t, beat, age, (S.b1 - S.b0) * SPB); break;
    case 'east': eastShot(t, beat, u); break;
    case 'lock': heroShot(t, 47.99, 1); break;
  }
  return look;
}

// ---------------------------------------------------------------- the lockup (b48): ☭≡/acc + ACP.US over the hero frame
function lockup(g, age) {
  const a = ease.outExpo(clamp(age / 0.2));
  cg.fillStyle = `rgba(38,48,76,${0.88 * a})`; cg.fillRect(0, 0, W, H);        // the piece's own ground: the night slate over her frame
  sigil(g, W / 2, 860, 250, { color: C.cream, accent: C.red2, alpha: a });
  line(g, 'ACP.US', W / 2, 1180, { family: 'Archivo Black', size: 96, color: C.cream, alpha: clamp((age - 0.12) * 8) * a });
}

// ================================================================ render
window.renderFrame = async (tIn) => {
  const t = tIn % DUR, beat = t / SPB + 1e-6;
  const look = frameAt(t, beat);
  if (QS.has('notype') || beat >= CLOSE) { tg.clearRect(0, 0, W, H); typeAudit.reset(); } else drawType(beat, t);
  if (beat >= CLOSE) lockup(tg, t - bt(CLOSE));
  const imp = shotAt(beat).name === 'mark' && Math.round((t - bt(42)) * 30) <= 1;
  post.apply({ world: comp, type: typeC }, t, {
    bloom: { amount: look.bloom, threshold: 0.7, radius: 1.0 }, halation: { amount: imp ? 0 : 0.28, tint: [1, 0.55, 0.25] },
    lens: { distort: 0.01, ca: 0 },
    film: { exposure: imp ? 0.25 : 0, contrast: 0.3, sat: 1.0, shoulder: 0.35, split: { shadows: [0.1, 0.2, 0.3], highlights: [0.9, 0.62, 0.36], amount: 0.3 }, fade: 0.0 },
    vignette: { amount: 0.35 }, grain: { amount: 0.4, size: 1.2 },
    type: { glow: 0, shadow: 0, grain: 0.12 },
  });
};
window.sceneInfo = { DUR, SPB, CLOSE, shots: SHOTS.length };
window.sceneReady = true;
