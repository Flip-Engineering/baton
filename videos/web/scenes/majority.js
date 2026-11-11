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
import { Hero } from '../lib/fx/hero.js';          // the heroes are hero.js people (via Stage): render.mjs writes their gesture audit
import { loadGeo, USMap } from '../lib/fx/maps.js';
import { Bowl, Crowd, LIGHT, DECKS } from './majority.bowl.js';
import { Post as BowlPost } from './majority.post.js';
import { PAL, turf, steps, shade, turnstile, Board, mascotRace, nightSky, parapet, region, phone, Cards, kidCard } from './majority.plates.js';

const QS = new URLSearchParams(location.search);
void Hero;
await loadBrand();
{ const f = new FontFace('Archivo Black', 'url(../node_modules/@fontsource/archivo-black/files/archivo-black-latin-400-normal.woff2)'); document.fonts.add(await f.load()); }
const B = await loadBeats('majority');
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
function renderBowl(g, { t = 0, bloom = 0.7, streak = 0.2, expo = 1, sat = 0.95, contrast = 1.06 } = {}) {
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
const stHemi = new THREE.HemisphereLight('#3a4052', '#0a0806', 0.35); st.scene.add(stHemi);
// the stadium's light on a back: a cold flood from the masts behind the lens (key), the floods over the far stands in
// front of her (a hot rim on the hat, the shoulders and the fist); used by the lit render (clothes read: the hi-vis)
const stKey = new THREE.DirectionalLight('#dfe6ff', 0), stRim = new THREE.DirectionalLight('#fff0d8', 0), stRim2 = new THREE.DirectionalLight('#9fb6ff', 0);
for (const l of [stKey, stRim, stRim2]) { st.scene.add(l); st.scene.add(l.target); }
for (const h of Object.values(HEROES)) h.watch(st.camera);
// pose one back: standing from the bind pose, turned away from the lens; arm: null | 'R' | 'L' (the PUMP glyph, bent
// elbow, forearm vertical, fist beside the head); strike: onset time (s): 3 frames cocked, the strike ON the onset frame,
// a 1-frame overshoot, then a pump on twos
function poseBack(h, { x = 0, z = 0, turn = Math.PI, arm = null, strike = null, t = 0, head = 0 } = {}) {
  st.stand(h, { x, z, turn, t: 'bind', nod: -0.04, head });
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
  [0, "WE'RE THE MAJORITY.", 1, 2, { lines: [["WE'RE THE", 172], ['MAJORITY.', 232]], y: 520 }],
  [2, 'STRAIGHT FROM WORK.', 0, 2, { lines: [['STRAIGHT', 196], ['FROM WORK.', 196]], y: 560 }],
  [4, 'AMERICAN.', 0, 1.3, { sh: 300, y: 470 }],
  [6, 'DAY SHIFT.', 0, 1, { cap: 230, y: 470 }],
  [7, 'NIGHT SHIFT.', 0, 1, { cap: 220, y: 470 }],
  [10, 'AMERICAN.', 0, 1.6, { sh: 420, y: 820 }],
  [14, 'TEAM SPORTS.', 0, 2, { world: 'board' }],
  [16, 'HOME TEAM.', 1, 2, { world: 'fancam' }],
  [18, 'AMERICAN.', 0, 1.4, { sh: 280, y: 440, x: 520 }],
  [20, 'AMERICAN.', 0, 1.4, { sh: 380, y: 760, x: 540 }],
  [22, 'AMERICAN.', 0, 1.4, { sh: 320, y: 1080, x: 540 }],
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
  { b0: 41, name: 'cards' }, { b0: 41.5, name: 'kid' }, { b0: 42, name: 'mark' }, { b0: 43, name: 'east' }, { b0: 44, name: 'dive' },
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
function heroShot(t, beat, v) {
  // the bowl behind her: from her row, across the field to the far stands; her section is 2D (the near deck hidden)
  looksBowl({ flood: 1.0, fog: 0.0036 });
  crowdState({ fill: [1, 0.95, 0.9], stand: 1, arms: 0.8, lamp: s => (H01(s.seed * 5.1) < 0.14 ? 1 : 0), t, hide: s => s.deck === 0 && s.x < -40 });
  rings(i => i === 1 ? "WE'RE THE MAJORITY" : '', '#F4E6D0');
  const push = v ? 0.06 * (beat - 45) : 0.09 * beat;                // a slow push in on her (never a held frame)
  setCam(V3(-84 + push * 10, 16, 1.5), V3(60, 2, 0), 30);             // the far stands fill the top; a sliver of sky at most
  mg.clearRect(0, 0, W, H); renderBowl(mg, { t, bloom: 0.8 });
  cg.save(); cg.filter = 'blur(2.5px)'; cg.drawImage(tmp, 0, 0); cg.restore();    // a long lens: the far stands soften (texture, never static)
  // her section's stepped concrete under the ranks below her (so they stand in the stands, not on the turf)
  steps(cg, [1860, 1560, 1380, 1262, 1196], { k: 0.8 });
  // the hero and two of her crew, from behind, cropped by the frame; her fist up on the 808
  onlyHeroes(['hero', 'welder', 'farm']);
  const on = bt(v ? 45 : 0) - 1 / 30;
  poseBack(HEROES.hero, { x: 0.08, z: -0.3, turn: Math.PI - 0.12, arm: 'R', strike: on, t });
  poseBack(HEROES.welder, { x: -0.72, z: 0.25, turn: Math.PI + 0.25, arm: null, t });
  poseBack(HEROES.farm, { x: 0.95, z: 0.1, turn: Math.PI - 0.4, arm: 'L', strike: on + 3 / 30, t });
  st.lookAt(V3(0.28, 1.5, 2.55 - push), V3(0.05, 1.72, -6), 42);
  renderBacks([760, 520], { rim: '#fff2de', rim2: '#8aa6e0', lit: true, key: 0.32, rimI: 10 });
  RK.compose(cg, heroCrowd(v), t, { style: nightStyle(5, { far: '#1e222e' }), sun: [620, 900], ground: false, dust: false, gapAmt: 0.1, shadowAmt: 0 });
  // her headlamp: the beam thrown forward into the bowl (away from the lens), a thin shaft in the haze
  const hd = HEROES.hero.joint('head');
  beam(cg, toScreen(hd.clone().add(V3(0.02, 0.19, -0.2))), toScreen(hd.clone().add(V3(-1.5, -2.5, -38))), 1.1);
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
function boardShot(t, beat, fold, age) {
  // from the hero's section: the board over the far end zone fills the frame; her section's heads along the bottom
  looksBowl({ flood: 0.9 });
  crowdState({ fill: [1, 0.9, 0.8], stand: 1, arms: 0.3, t });
  rings('');
  setCam(V3(-84, 12, 1), V3(60, 22, 0), 30);
  mg.clearRect(0, 0, W, H); renderBowl(mg, { t, bloom: 0.7 }); cg.save(); cg.filter = 'blur(3px)'; cg.drawImage(tmp, 0, 0); cg.restore();
  const x = 70, y = 330, w = 940, h = 530;
  const u = fold ? 1 : clamp((beat - 14) / 1), f = fold ? ease.outCubic(clamp(age / 0.14)) : 0;
  board.draw(cg, x, y, w, h, (L, cw, ch) => mascotRace(L, cw, ch, u, f, t), { glow: 1 });
  const c = CR.boardHeads || (CR.boardHeads = RK.design({ seed: 31, ranks: [
    { foot: 2050, h: 520, rows: 1, pack: 1.1, raise: 0.0, kinds: KINDS },
    { foot: 1830, h: 330, rows: 2, thick: 0.2, pack: 1.2, raise: 0.1, kinds: KINDS },
  ] }));
  RK.compose(cg, c, t, { style: nightStyle(2, { far: '#10131b' }), sun: [540, 600], ground: false, dust: false, gapAmt: 0.1, shadowAmt: 0 });
  WT.push(g => boardText(g, 'TEAM SPORTS.', 150, x + w / 2, y + 100));    // the board's prompt, in the world (its title band)
}
function fancam(t, beat, u) {
  // the base: the section from behind, looking up at the board (fists up at their own picture)
  looksBowl({ flood: 1.0 });
  crowdState({ fill: [1, 0.95, 0.85], stand: 1, arms: 0.9, t });
  rings('');
  setCam(V3(-84, 12, 1), V3(60, 24, 0), 30);
  const bx = 70, by = 300, bw = 940, bh = 560;
  mg.clearRect(0, 0, W, H);
  renderBowl(mg, { t, bloom: 0.7 });
  const c = CR.fan || (CR.fan = (() => { const cc = RK.design({ seed: 41, ranks: [
    { foot: 2060, h: 560, rows: 1, pack: 1.1, raise: 0.4, kinds: KINDS },
    { foot: 1780, h: 330, rows: 2, thick: 0.2, pack: 1.2, raise: 0.4, kinds: KINDS },
    { foot: 1560, h: 190, rows: 2, thick: 0.2, pack: 1.25, raise: 0.36, kinds: KINDS },
    { foot: 1420, h: 110, rows: 2, thick: 0.2, pack: 1.3, raise: 0.3, kinds: KINDS },
  ] }); RK.hit(cc, bt(16), { from: [540, 1900], speed: 180, jitter: 3, lead: -3 }); return cc; })());
  RK.compose(mg, c, t, { style: nightStyle(4, { far: '#1a1e2a' }), sun: [540, 560], ground: false, dust: false, gapAmt: 0.12, shadowAmt: 0 });
  // THE FEED: the fan-cam's picture is the section itself, tight from behind (heads, fists up), and above them the board
  // they are looking at, showing the feed: board inside board, three levels deep (the Droste loop)
  const fw = bw, fh = bh, feed = [0, 1, 2].map(() => { const c2 = document.createElement('canvas'); c2.width = fw; c2.height = fh; return c2; });
  const chrome = (g, x, y, w, h, s) => {     // the fan-cam chrome: a cream frame, a red live dot, the lower-third band
    g.save(); g.strokeStyle = PAL.cream; g.lineWidth = Math.max(1.5, 10 * s); g.strokeRect(x + 14 * s, y + 14 * s, w - 28 * s, h - 28 * s);
    g.fillStyle = '#e0141a'; g.beginPath(); g.arc(x + 58 * s, y + 60 * s, 15 * s, 0, TAU); g.fill();
    g.fillStyle = 'rgba(8,10,24,0.82)'; g.fillRect(x + 14 * s, y + h - 170 * s, w - 28 * s, 150 * s); g.restore();
  };
  for (let lev = 0; lev < 3; lev++) {
    const F = feed[lev], fg = F.getContext('2d');
    fg.drawImage(tmp, 0, 1250, W, W * fh / fw, 0, 0, fw, fh);                   // the crowd, tight, from behind
    fg.save(); fg.globalCompositeOperation = 'lighter'; fg.globalAlpha = 0.7; fg.drawImage(F, 0, 0); fg.restore();   // the broadcast lift (a camera feed is exposed for the crowd)
    fg.fillStyle = 'rgba(255,236,200,0.1)'; fg.fillRect(0, 0, fw, fh);
    const mw = fw * 0.46, mh = fh * 0.46, mx = (fw - mw) / 2, my = fh * 0.05;    // the board above them, in the feed
    fg.fillStyle = '#07080b'; fg.fillRect(mx - 8, my - 8, mw + 16, mh + 16);
    if (lev > 0) fg.drawImage(feed[lev - 1], mx, my, mw, mh); else { fg.fillStyle = '#10141c'; fg.fillRect(mx, my, mw, mh); }
    chrome(fg, mx, my, mw, mh, mw / fw);
    fg.save(); fg.translate(mx, my); fg.scale(mw / fw, mh / fh); boardText(fg, 'HOME TEAM.', 130, fw / 2, fh - 92, { red: true }); fg.restore();
  }
  mg2.clearRect(0, 0, W, H); mg2.drawImage(tmp, 0, 0);
  board.draw(mg2, bx, by, bw, bh, null, { src: (() => { mg3.clearRect(0, 0, W, H); mg3.drawImage(feed[2], 0, 0, W, H); return tmp3; })(), glow: 0.5, housing: true, pitch: 4 });
  chrome(mg2, bx, by, bw, bh, 1);
  const z = 1 + 0.32 * ease.inOutCubic(u), cx = bx + bw / 2, cy = by + bh / 2;
  cg.save(); cg.translate(cx, cy); cg.scale(z, z); cg.translate(-cx, -cy); cg.drawImage(tmp2, 0, 0); cg.restore();
  WT.push(g => { g.save(); g.translate(cx, cy); g.scale(z, z); g.translate(-cx, -cy); boardText(g, 'HOME TEAM.', 130, bx + bw / 2, by + bh - 92, { red: true }); g.restore(); });
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
}
function waveShot(t, beat, u) {
  // the Wave: a band of standing, arms-up, phone-lit seats sweeping round the bowl; a-MER-i-CAN rides the club ring
  looksBowl({ flood: 0.95 });
  const th = -0.35 + (beat - 26) * 0.4;                         // the crest crosses the far stand in front of the lens at b27
  const near = s => { let d = Math.atan2(s.z / 42, s.x / 64) - th; d = Math.atan2(Math.sin(d), Math.cos(d)); return Math.exp(-d * d * 110); };
  crowdState({ fill: [1, 1, 1], stand: s => (near(s) > 0.3 ? 1 : 0.2), arms: s => near(s), phone: s => near(s) > 0.5 ? 1 : 0, stripe: s => (near(s) > 0.25 ? 1 : 0), t });
  crowd.mat.uniforms.uStripeK.value = 0.9;                       // the Wave is a travelling band of red light and bodies up
  const syl = ['A', 'MER', 'I', 'CAN'][clamp(Math.floor((beat - 26) * 2), 0, 3)];
  rings(i => i === 0 ? `${syl}` : '', '#F4E6D0', { rep: 3, scroll: -(beat - 26) * 0.06 });
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
  cg.fillStyle = '#05060a'; cg.fillRect(0, py, W, H - py);
  cg.fillStyle = 'rgba(255,230,190,0.55)'; cg.fillRect(0, py, W, 3);
  cg.fillStyle = '#05060a'; for (let x = 40; x < W; x += 240 * sc + 60) cg.fillRect(x, py - 90 * sc, 8 * sc + 3, 90 * sc);
  cg.fillRect(0, py - 90 * sc, W, 6 * sc + 2);
}
function craneShot(t, beat, u) {
  // COAST TO COAST.: the floods slam on and the camera climbs out of the bowl until it is a lit ring in the dark country
  looksBowl({ flood: 1.25, fog: 0.0015, lamps: 1.3 });
  crowdState({ fill: [1, 1, 1], stand: 1, arms: 0.9, phone: s => H01(s.seed * 2.3) < 0.5 ? 1 : 0, stripe: stripeOf(3), t });
  crowd.mat.uniforms.uStripeK.value = 0.4 + 0.8 * Math.exp(-(beat - 32) * 3);
  rings('', '#F4E6D0', { fill: 0.9, fillCol: '#F4E6D0' });
  const e = ease.inOutCubic(u), h = lerp(14, 900, Math.pow(e, 1.6));
  setCam(V3(lerp(-70, -20, e), h, lerp(18, 2, e)), V3(lerp(40, 0, e), 0, 0), lerp(58, 40, e));
  renderBowl(cg, { t, bloom: 1.0, streak: 0.4 });
  if (e > 0.25) { const r = rng(77), a = clamp((e - 0.25) / 0.4); cg.save(); cg.globalCompositeOperation = 'lighter';     // the town round the stadium
    for (let k = 0; k < 900; k++) { const ang = r() * TAU, d = 170 + Math.pow(r(), 0.7) * 2600, p = proj(V3(Math.cos(ang) * d, 0, Math.sin(ang) * d * 0.9)); if (p[2] > 1) continue;
      const s = 1 + r() * 2; cg.fillStyle = `rgba(255,${170 + r() * 60 | 0},${90 + r() * 60 | 0},${a * (0.3 + 0.6 * r())})`; cg.fillRect(p[0], p[1], s, s); }
    cg.restore(); }
}
function countryShot(t, beat, u) {
  // the country, lit from the middle out (the bowl's own light running to both coasts): lights only, no borders
  cg.fillStyle = '#020306'; cg.fillRect(0, 0, W, H);
  const r = lerp(90, 1100, ease.inOutCubic(clamp((beat - 34) / 2)));        // lit from the first frame (never a black cut)
  const cam = { x: 560, y: 390, zoom: lerp(1.9, 1.02, ease.inOutCubic(u)), sy: 980 };
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
  const o = us.toScreen(us.project(HOME), cam);
  const gg = cg.createRadialGradient(o[0], o[1], 2, o[0], o[1], 48); gg.addColorStop(0, 'rgba(255,250,235,0.9)'); gg.addColorStop(1, 'rgba(255,220,160,0)');
  cg.save(); cg.globalCompositeOperation = 'lighter'; cg.fillStyle = gg; cg.fillRect(o[0] - 100, o[1] - 100, 200, 200); cg.restore();
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
function cardShot(t, beat, S, u, age) {
  // from the blimp: the section's cards, lit from behind by phones, visibly messy until the kid's card; then locked
  const lockU = S.name === 'cards' ? clamp((beat - 40.6) / 1.35) : 1, kid = beat < 41.9 ? 0 : 1, lock = S.name === 'cards' ? 0 : ease.outCubic(clamp(age / 0.12));
  const zoom = S.name === 'dive' ? 1 + 6 * Math.pow(u, 2.2) : 1 + 0.02 * u;
  const x0 = 40, y0 = 300, w = 1000, h = 800;
  mg.drawImage(standsTop(), 0, 0);
  if (S.name !== 'cards') { mg.fillStyle = 'rgba(0,0,0,0.25)'; mg.fillRect(0, 0, W, H); }
  const res = cards.draw(mg, x0, y0, w, h, lockU, kid, { t, lock });
  if (S.name !== 'cards') { const g2 = mg.createRadialGradient(W / 2, y0 + h / 2, 10, W / 2, y0 + h / 2, 800); g2.addColorStop(0, 'rgba(255,40,40,0.18)'); g2.addColorStop(1, 'rgba(255,40,40,0)'); mg.save(); mg.globalCompositeOperation = 'lighter'; mg.fillStyle = g2; mg.fillRect(0, 0, W, H); mg.restore(); }
  const [kx, ky] = res.kid;
  cg.save(); cg.translate(kx, ky); cg.scale(zoom, zoom); cg.translate(-kx, -ky); cg.drawImage(tmp, 0, 0); cg.restore();
  if (S.name === 'dive') {   // cards flung into the air round the lens as the camera dives through the mark
    const rr = rng(3); cg.save();
    for (let k = 0; k < 60; k++) { const a = rr() * TAU, d = (0.2 + rr()) * 900 * Math.pow(u, 0.7), x = W / 2 + Math.cos(a) * d, y = H / 2 + Math.sin(a) * d * 1.3, s = 30 + 160 * u * rr();
      cg.translate(x, y); cg.rotate(a + u * 4); cg.fillStyle = rr() < 0.6 ? '#c8161c' : '#efe2c8'; cg.fillRect(-s / 2, -s * 0.35, s, s * 0.7); cg.setTransform(1, 0, 0, 1, 0, 0); }
    cg.restore(); }
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
function regionShot(g, t, i) {
  region(g, i, t, { horizon: 1180 });
  const key = 'reg' + i;
  const kinds = [['cap', 'knit', 'bare'], ['hard', 'cap', 'bare'], ['hard'], ['cap', 'bare', 'knit']][i];
  const c = CR[key] || (CR[key] = (() => { const cc = RK.design({ seed: 60 + i, ranks: [
    { foot: 2120, h: 820, rows: 1, pack: 1.0, raise: 0.5, kinds, x0: -100, x1: 1180 },
    { foot: 1560, h: 300, rows: 2, thick: 0.2, pack: 1.2, raise: 0.5, kinds },
    { foot: 1330, h: 140, rows: 2, thick: 0.2, pack: 1.3, raise: 0.45, kinds },
    { foot: 1230, h: 64, rows: 2, thick: 0.2, pack: 1.4, raise: 0.4, kinds },
  ] }); RK.hit(cc, bt(36 + i * 0.5) - 2 / 30, { from: [540, 2000], speed: 240, jitter: 2 }); return cc; })());
  const glowX = [640, 420, 560, 700][i];
  RK.compose(g, c, t, { style: nightStyle(4, { rim: '#ffc98a', far: '#2a2426' }), sun: [glowX, 1150], ground: false, dust: false, gapAmt: 0.12, shadowAmt: 0 });
  for (const [x, y, hh] of fistPts(c, t)) phone(g, x, y - hh * 0.025, Math.max(1.5, hh * 0.018), 1);
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
    case 'wall': wallShot(cg, t, S.v ? W1() : W0(), { k: 1 }); break;
    case 'farstand': {     // the empty far stand answers: a dotted line of headlamps clicking on, one beat late
      looksBowl({ flood: 0.28, fog: 0.004 });
      const on = s => (s.deck === 2 && s.x > 40 && (s.row % 4 === 1) && ((s.z + 60) / 120) < (beat - 5.05) * 2.2) ? 1 : 0;
      crowdState({ fill: [0.9, 0.5, 0.55], stand: 1, lamp: on, t });
      crowd.mat.uniforms.uLampK.value = 3.5;
      rings('');
      setCam(V3(-84, 12.5, 2), V3(110, 34, 0), 22);
      renderBowl(cg, { t, bloom: 1.3, streak: 0.5 });
      crowd.mat.uniforms.uLampK.value = 1;
      break;
    }
    case 'shift': {        // one back per beat: scrubs under a fleece (DAY SHIFT.), cook's whites (NIGHT SHIFT.)
      looksBowl({ flood: 1.0 });
      crowdState({ fill: [1, 0.9, 0.8], stand: 1, arms: 0.6, t });
      rings('');
      setCam(V3(-80 + S.i * 3, 10, -8 + S.i * 16), V3(40, 12, S.i ? -20 : 20), 30);
      renderBowl(mg, { t, bloom: 1.0 });
      cg.save(); cg.filter = 'blur(9px)'; cg.drawImage(tmp, 0, 0); cg.restore();
      const who = S.i ? 'cook' : 'nurse'; onlyHeroes([who]);
      poseBack(HEROES[who], { x: 0, z: 0, turn: Math.PI + (S.i ? 0.3 : -0.25), arm: S.i ? 'R' : 'L', strike: bt(S.b0) + 2 / 30, t, head: S.i ? 0.1 : -0.15 });
      st.lookAt(V3(S.i ? -0.2 : 0.25, 1.42, 1.9 - 0.12 * u), V3(0, 1.52, -6), 44);
      renderBacks(S.i ? [300, 380] : [800, 380], { rim: '#fff0da', rim2: '#8aa6e0', lit: true, key: S.i ? 0.45 : 0.4, rimI: 10 });
      cg.drawImage(heroCanvas, 0, 0);
      break;
    }
    case 'rise': {         // the lower bowl stands, left to right on the seat roll (no frame): rows rise out of their seats
      const sink = (f, tt) => { const ts = bt(7.6) + (f.x / W) * SPB * 1.1 + f.rank * 0.02; const k = ease.outBack(clamp((tt - ts) / 0.16)); return { dx: 0, dy: f.h * 0.46 * (1 - k), k: 1 }; };
      wallShot(cg, t, W1(), { k: 0.85, sink });
      break;
    }
    case 'bowlwide': {     // b12: the bowl from the corner of the upper deck, the upper deck filling down its aisles
      looksBowl({ flood: 1.0 });
      crowdState({ fill: [1, 0.95, lerp(0.35, 0.95, ease.inOutCubic(u))], stand: 1, arms: 0.7, t });
      rings('');
      setCam(V3(-95, 58, -70 + 6 * u), V3(10, 0, 5), 52);
      renderBowl(cg, { t, bloom: 0.8 });
      break;
    }
    case 'race': case 'fold': boardShot(t, beat, S.name === 'fold' ? 1 : 0, age); break;
    case 'fancam': fancam(t, beat, u); break;
    case 'stripe': case 'eq': stripeShot(t, beat, S, u); break;
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
    case 'crouch': case 'silence': {
      const sil = S.name === 'silence', c = W1();
      const sink = (f, tt) => ({ dx: 0, dy: f.h * 0.44 * ease.outCubic(clamp((tt - bt(30)) / 0.18)), k: 1 });
      wallShot(cg, t, c, { k: sil ? 0.36 : lerp(0.9, 0.42, ease.outCubic(clamp(age / 0.3))), sink, lamps: 1, style: nightStyle(c.ranks.length, { far: '#262a36', rimNear: 0.9, rimFar: 0.45, dust: '#8a96b8' }) });
      look.bloom = 0.5;
      break;
    }
    case 'crane': craneShot(t, beat, u); break;
    case 'country': countryShot(t, beat, u); break;
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
    case 'kid': kidCard(cg, age, (S.b1 - S.b0) * SPB); break;
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
