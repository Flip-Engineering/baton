// THE CORE (8 Oct 2026; TRUE SCALE ep. 1; research/series/machine/ep1_brief.md; series bible research/series/machine/BIBLE.md).
// Seen only from straight above, crews lay a power transformer's core sheet by sheet: about 4,000 layers of grain-oriented steel, each
// about a quarter of a millimetre. The continent waits two and a half years for one. Inside the works the order is exact; around them
// there is none (demand doubled, the shortage runs on into 2026, the new capacity ships in 2028). Then, over three windings, the crew
// laces the top yoke shut, and the magnetic circuit is closed by hand. Engels: socialised production upon a predetermined plan becomes
// possible. The Executive Chairman: the productive forces have outmoded the relations.
//   bars (1.05 s)  0  frame 0: four hold a pressboard board over the flat core: A POWER TRANSFORMER. / ORDER ONE, / WAIT 128 WEEKS.
//                  4  the eight lay a 5.8 m top-yoke sheet (150 px/m)         8  the gantry stacker at the second table
//                 11  the step: a time-lapse, the push to 900 px/m onto the bottom-left mitre (the seven-step stair)
//                 14  OUT: pads lay in, crooked, one, two, three a bar, then holes; 30 the late sites (an extension, a pour)
//                 35  THE TURN: laid square, one step off: the active part, the top yoke 85 % laced over three windings; 41 closed
//                 42  the pull-out to the whole hall (30 px/m), all twelve at stations; 48 the lacing crew steps back
//                 54  the mark, laid in from the left, settling square
// The join: every shot, card and the mark arrives as a lamination (lib/fx/truescale/corestack.js layInQuad / cardQuad: the ONE new
// asset), settling one step off the sheet before it; the slivers make the joint's own stair. Words: ink on pressboard (core.cards.js).
// Engines: corestack (the core, its laying, lacing, the plan rig, GO steel, pressboard, the lay-in), light/ (LitRenderer, LightRig,
// practicals, surface materials, floor bounce), the person pipeline (v7 people with hero.js's hard hats and gloves), kit (Finish,
// closer). 7/16 at q = 100: the Song is declared at BPM 100; a bar is 1.75 beats (bar 54 = beat 94.5, logo_at.json).
// c20 (15 Oct; research/PIECE_NOTES.md THE CORE): the stack past its widest packet (terraces), the steel shader as a book of sheets, the
// board laid down at frame 0, the eight's sheet carried in, the push onto the terraces' corner stairs, the anarchy as waste and waiting
// (core.world.js buildTile, framed per tile), the yoke laced from open, the hall at work, the cards off the top strip. Takes: core_a, core_b.
import * as THREE from 'three';
import { W, H, outCanvas, Finish, closer, loadFonts } from '../lib/kit.js';
import { planRig, layInQuad, cardQuad, LayStack, drawLayer } from '../lib/fx/truescale/corestack.js';
import { T, TL, BAR, ST, HALF, STEP_FROM, layers, CARDS, camOf } from './core.plan.js';
import { buildHall, buildTile, buildSite, hallRecord, outRecord } from './core.world.js';
import { Cast, hookPoses, eightPoses, gantryPoses, stepPoses, pourPoses, lacePoses } from './core.cast.js';
import { buildCards } from './core.cards.js';

let ready = false;
Object.defineProperty(window, 'sceneReady', { get: () => ready, set: () => {}, configurable: true });
const DRY = !!globalThis.CORE_DRY;                                   // node: the scene's logic without GL (labs/truescale/core_scene_test.mjs)
const ctx = outCanvas();
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x)), V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const ease = u => { u = clamp(u); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };
const newCanvas = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };

// ---------------------------------------------------------------- the light pipeline (two places: the hall and outside)
const glc = newCanvas();
let lr = null, LR = null;
if (!DRY) {
  const L = await import('../lib/fx/light/index.js');
  lr = new L.LitRenderer({ canvas: glc, width: W, height: H, quality: 'final' });
  LR = L;
}
const sceneHall = new THREE.Scene(), sceneOut = new THREE.Scene();
const PRESETS = DRY ? (await import('../lib/fx/light/presets.js')).PRESETS : LR.PRESETS;
const rigHall = DRY ? { practicals: [] } : new LR.LightRig(lr.renderer, sceneHall, hallRecord(PRESETS));
const rigOut = DRY ? { practicals: [] } : new LR.LightRig(lr.renderer, sceneOut, outRecord(PRESETS));
function movePractical(P, pos, aim) {
  if (!P) return; P.pos.copy(pos); P.aim.copy(aim); P.light.position.copy(pos); if (P.light.target) { P.light.target.position.copy(aim); P.light.target.updateMatrixWorld(); }
  if (P.head) { P.head.position.copy(pos); P.head.quaternion.setFromUnitVectors(V3(0, -1, 0), aim.clone().sub(pos).normalize()); }
}
const rake = rigHall.practicals.find(p => p.spec?.name === 'rake') || null;

// ---------------------------------------------------------------- the world, the words, the crews
const world = buildHall(sceneHall);
const core = world.core, core2 = world.core2, lam = core.lam;
const CARDSET = await buildCards();
const [AX, AZ] = ST.A, [BX, BZ] = ST.B, [CX, CZ] = ST.C;
// card 1, the board the crew holds: 2.70 x 1.30 m, 3 mm, over the centre limb and both windows (screen x 135-945, y 900-1290)
const board = CARDSET.hook.mesh(THREE, 600, 0.003); board.name = 'board'; world.groups.A.add(board);
const TOP0 = core.yOf(HALF);                                          // the stack's top at frame 0 (0.55 m over the deck)
// c20: frame 0 lives: the four hold the board up (a breath), then lay it down flat on the stack (pressboard is the core's own material:
// the ducts' spacers are cut from it), hands come off and they step back: one act, its shadow under the rake closing onto the board
const BOARD = { x0: -1.35, x1: 1.35, z: -0.35, down: 2.9, off: 3.05, back: 3.2,
  y: t => TOP0 + 0.0035 + 0.42 * (1 - ease((t - 0.7) / 2.2)) + (t < 0.7 ? 0.005 * Math.sin(t * 4.0) : 0) };
const cast = new Cast();
await cast.build({ scene: sceneHall, only: globalThis.CORE_ONLY || null });
// the sheets being laid: the eight's top-yoke sheet (bar 4), the gantry's limb sheet (bar 8), the hall's limb sheet (bar 42)
const sheetA = core.sheetMesh(HALF, 'yokeT', world.coreMats); world.groups.A.add(sheetA);
const sheetA2 = core.sheetMesh(HALF + 1, 'limbC', world.coreMats); world.groups.A.add(sheetA2);
const sheetB = core2.sheetMesh(724, 'limbL', world.coreMats); world.groups.B.add(sheetB);
if (!DRY) LR.litPatchAll(sceneHall);                                // every material in the hall (the crews' too) into the light pipeline
const lay8 = core.lay(HALF, { t0: T(4), dur: 3.8, part: 'yokeT', crew: 8, from: [0, -1.25], lift: 0.3 });   // c20: carried in from the rack beyond the yoke, seen
const layHall = core.lay(HALF + 1, { t0: T(43), dur: 6.3, part: 'limbC', crew: 4, from: [0.0, 0.9], lift: 0.2 });
const LACE = { t0: T(35), t1: T(41), from: 0.0, cycle: BAR, base: 0.3, approach: 0.55 };   // c20: the circles open when the shot lands; six handfuls close them
const lacePlan = core.lacePlan(LACE);

// ---------------------------------------------------------------- the plan rig (straight down; push and track only)
const rig = planRig({ width: 3.6, center: [AX, AZ - 0.8], ref: TOP0 });
const setCam = (shot, t, o) => { const c = camOf(shot, t, o); rig.set(c.w, c.x, c.z, c.ref); return c; };

// ---------------------------------------------------------------- one hall shot at t: the world's state, the crew, the light, the camera
const report = { misses: {} };
function stageHall(shot, t) {
  const W0 = world;
  // station A: the stack (the time-lapse lays 581 sheets in the step shot); the board in frame 0 only; the eight's sheet; the hall's
  let upto = HALF;
  if (shot === 'step') upto = Math.round(STEP_FROM + (HALF - STEP_FROM) * ease((t - T(11)) / (T(14) - T(11))));
  if (shot === 'lace') upto = HALF + 1;
  W0.setCoreA(upto);
  board.visible = shot === 'hook'; board.position.set(0, BOARD.y(t) - 0.0015, BOARD.z);
  sheetA.visible = shot === 'eight'; sheetA.matrix.copy(shot === 'eight' ? lay8(t).T : new THREE.Matrix4()); sheetA.matrixWorldNeedsUpdate = true;
  const sH = layHall(t); sheetA2.visible = shot === 'lace' && t >= T(43); sheetA2.matrix.copy(sH.T); sheetA2.matrixWorldNeedsUpdate = true;
  // station B: the gantry carries a limb sheet from the feed rack to its place, lowers it, lets go, rises
  const g = W0.gantry, f = W0.feed, yPlace = core2.yOf(724); let u = clamp((t - T(8)) / (T(11) - T(8)));
  let gx = f.x, gz = f.z, gy = f.y + 0.6, held = true;
  if (shot === 'gantry' || shot === 'lace') {
    if (shot === 'lace') { const uu = ((t - T(36)) / 3.15) % 1; u = uu < 0 ? uu + 1 : uu; }   // c20: in the pull-out the stacker keeps working
    if (u < 0.4) { const v = ease(u / 0.4); gx = f.x + (-core2.P - f.x) * v; gz = f.z * (1 - v); gy = Math.max(f.y + 0.08, yPlace + 0.5) + 0.25 * Math.sin(v * Math.PI); }
    else if (u < 0.7) { const v = ease((u - 0.4) / 0.3); gx = -core2.P; gz = 0; gy = yPlace + 0.5 * (1 - v) + 0.0003; }
    else if (u < 0.78) { gx = -core2.P; gz = 0; gy = yPlace + 0.0003; held = u < 0.74; }
    else { const v = ease((u - 0.78) / 0.22); gx = -core2.P; gz = 0; gy = yPlace + 0.0003 + 0.9 * v; held = false; }
  }
  const sheetTop = (held ? gy : yPlace) + lam;
  g.set(gx, gz, sheetTop + 0.03);
  sheetB.matrix.makeTranslation(held ? gx + core2.P : 0, held ? gy - yPlace : 0, held ? gz : 0); sheetB.matrixWorldNeedsUpdate = true;
  // station C: the top yoke laced to done(t); the handful in the crew's hands
  const done = core.yokeDone(t, LACE); W0.setYoke(shot === 'lace' ? done : 0.85);
  let rel = null;
  if (shot === 'lace' && t >= LACE.t0 && t < lacePlan.t1) {
    const n = Math.min(lacePlan.nC - 1, Math.floor((t - LACE.t0) / LACE.cycle)); rel = core.relace(n, t, LACE);
    const seated = Math.round(core.N * done), end = Math.min(core.N, 2 * Math.floor(lacePlan.b0 + lacePlan.per * (n + 1)));
    W0.setHandful(seated, Math.max(seated, end), rel.lift, rel.dz || 0);
  } else W0.setHandful(0, 0, 0);
  // the light: the rake moved to the station (a work light on a tripod, low, across the object's edges)
  if (rake) { if (shot === 'gantry') movePractical(rake, V3(BX - 2.5, 1.25, BZ - 3.0), V3(BX - 2.5, 1.0, BZ + 0.5));
    else if (shot === 'lace') movePractical(rake, V3(CX - 3.7, 5.15, CZ + 1.0), V3(CX + 3.0, 4.92, CZ - 0.25));
    else if (shot === 'step') movePractical(rake, V3(AX - 5.2, 1.75, AZ + 0.6), V3(AX - 2.6, 1.15, AZ + 2.2));   // c20: low across the corner's terraces
    else movePractical(rake, V3(AX - 1.5, 2.2, AZ - 2.9), V3(AX - 1.5, 1.2, AZ + 0.2)); }   // c20: over the board, so its shadow closes on it
  // the crews
  cast.hideAll(); cast.into(sceneHall, Object.keys(cast.P));
  const top = core.yOf(upto) + lam;
  let poses = [];
  if (shot === 'hook') poses = hookPoses(ST.A, BOARD, t);
  else if (shot === 'eight') poses = eightPoses(ST.A, lay8, t);
  else if (shot === 'gantry') poses = gantryPoses(ST.B, core2, core2.yOf(724), t, f);
  else if (shot === 'step' && t < T(12.6)) poses = stepPoses(ST.A, core, top, t);   // c20: the crew is gone before the push lands: the stair alone
  else if (shot === 'lace') {
    poses = lacePoses(ST.C, rel, t, { closed: T(41), stepAt: T(48), platY: 3.87 });
    if (!rel) poses = lacePoses(ST.C, core.relace(lacePlan.nC - 1, lacePlan.t1, LACE), Math.max(t, T(41)), { closed: T(41), stepAt: T(48), platY: 3.87 });
    if (t >= T(41.5)) poses.push(...hallPoses(t));
  }
  for (const p of poses) report.misses[shot + ':' + p.id] = cast.pose(p.id, p);
  return { top, upto, done, rel, poses };
}
// the hall's other six, at their stations, from the pull-out on
function hallPoses(t) {
  const out = [];
  const s = layHall(t), grips = s.grips.slice().sort((a, b) => a.pW.z - b.pW.z), Wg = grips.filter(g => g.side === 'W'), Eg = grips.filter(g => g.side === 'E');
  const put = (id, g, faceX) => { const p = g.pW.clone().add(V3(AX, 0, AZ)), yaw = faceX > 0 ? Math.PI / 2 : -Math.PI / 2, lat = V3(Math.cos(yaw), 0, -Math.sin(yaw));
    out.push({ id, at: [p.x - faceX * 0.44, p.z], yaw, lean: 0.2, drop: 0.04, look: 0.35, hands: s.phase === 'set' && s.u > 0.94 ? null : { L: p.clone().addScaledVector(lat, 0.17), R: p.clone().addScaledVector(lat, -0.17) } }); };
  Wg.forEach((g, i) => put(['L03', 'L06'][i], g, 1)); Eg.forEach((g, i) => put(['L11', 'L20'][i], g, -1));   // two women, two men
  out.push({ id: 'L14', at: [BX + 4.75, BZ + 1.1], yaw: -Math.PI / 2, lean: 0.05, look: 0.3, hands: { L: V3(BX + 4.45, 1.12, BZ + 1.18), R: V3(BX + 4.45, 1.1, BZ + 1.02) } });
  out.push({ id: 'L23', at: [ST.D[0] - 0.4, ST.D[1] + 1.35], yaw: Math.PI, lean: 0.25, look: 0.4, hands: { L: V3(ST.D[0] - 0.5, 1.3, ST.D[1] + 1.0), R: V3(ST.D[0] - 0.3, 1.25, ST.D[1] + 1.05) } });
  return out;
}

// ---------------------------------------------------------------- the tiles outside: built, shot once (static), disposed; the pour lives
const outGroup = new THREE.Group(); sceneOut.add(outGroup);
let liveSite = null;
function stageTile(L, t) {
  const key = L.id;
  if (!liveSite || liveSite.key !== key) {
    if (liveSite) { outGroup.remove(liveSite.g); liveSite.g.traverse(m => { m.geometry?.dispose(); }); }
    const g = L.shot === 'site' ? buildSite(L.tile.kind, L.tile.seed, L.tile.frame) : buildTile(L.tile.kind, L.tile.seed);
    outGroup.add(g); liveSite = { key, g };
  }
  cast.hideAll();
  const pour = liveSite.g.userData.pour;
  if (pour) { const ps = pourPoses(pour, t); cast.into(sceneOut, ps.map(p => p.id)); for (const p of ps) report.misses['pour:' + p.id] = cast.pose(p.id, p); }
  const c = camOf(L.shot, t, { tile: L.tile }); rig.set(c.w, c.x, c.z, c.ref);
  return { pour: !!pour };
}

// ---------------------------------------------------------------- shots into images (snapshots of buried sheets are cached)
const cache = new Map(), MAXC = 18;
function keep(key, canvas) { cache.set(key, canvas); while (cache.size > MAXC) cache.delete(cache.keys().next().value); return canvas; }
function render(shot, t) {
  if (shot === 'pad' || shot === 'site') { if (!DRY) lr.render({ scene: sceneOut, camera: rig.camera, rig: rigOut, t }); return; }
  const st = stageHall(shot, t); setCam(shot, t, { top: st.top });
  if (!DRY) lr.render({ scene: sceneHall, camera: rig.camera, rig: rigHall, t });
}
function shotAt(L, t) { if (L.shot === 'pad' || L.shot === 'site') stageTile(L, t); render(L.shot, t); }
if (!DRY) await loadFonts();                                          // the closer's ACP.US face
const closerCv = newCanvas(); if (!DRY) closer(closerCv.getContext('2d'), 2.0);   // the mark settled: it arrives by the lay-in, upright
function imageOf(L, t, live) {
  if (L.shot === 'mark') return closerCv;
  const staticTile = L.shot === 'pad' || (L.shot === 'site' && L.tile.kind !== 'pour');
  if (!live || staticTile) {
    const key = L.id + (staticTile ? '' : '@' + L.freezeAt);
    if (cache.has(key)) return cache.get(key);
    shotAt(L, staticTile ? L.t0 : L.freezeAt);
    const c = newCanvas(); c.getContext('2d').drawImage(glc, 0, 0); return keep(key, c);
  }
  shotAt(L, t); return glc;
}

// ---------------------------------------------------------------- the frame
const LAY = layers(), STACK = new LayStack(LAY, { keep: 12 });
const cards = CARDSET.strips;                                          // [{ plan, card }]
const finish = new Finish(1880);
let last = null;
window.__core = { LAY, CARDS, cards, CARDSET, core, core2, world, cast, rig, report, stageHall, lacePlan, BOARD, cache };
window.renderFrame = async (t) => {
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  const vis = STACK.at(t);
  const liveL = [...vis].reverse().find(v => v.L.kind !== 'card')?.L;
  // the draw list: the sheets as laid; each card on top while it is read, then under whatever covers it
  const items = vis.map(v => ({ key: v.L.t0, kind: 'shot', L: v.L, q: v.q }));
  // a card covered by the next card in its band stays above the sheets until that card has covered it; one covered by a sheet's lay-in
  // (bars 8, 35, 54) goes under that sheet; card 3 is covered at bar 12 by a strip carrying the picture (a lamination laid over it)
  for (const c of cards) { const p = c.plan; if (t < p.t0 || t >= p.until + 0.5) continue;
    const onTop = t < p.until || p.cover === 'strip' || cards.some(o => Math.abs(o.plan.t0 - p.until) < 1e-6);
    items.push({ key: onTop ? 1e9 + p.t0 : p.until - 1e-6, kind: 'card', c, q: cardQuad({ ...p, h: c.card.h, k: 0, seed: 7 }, t) }); }
  for (const c of cards) { const p = c.plan; if (p.cover === 'strip' && t >= p.until && t < p.until + 0.5) items.push({ key: 1e9 + p.until, kind: 'cover', c, q: cardQuad({ edge: p.edge === 'L' ? 'R' : 'L', t0: p.until, dur: 0.42, y: p.y, h: c.card.h }, t) }); }
  items.sort((a, b) => a.key - b.key);
  // images: buried sheets first (their snapshots may need renders), the live one last (it stays in the GL canvas)
  const imgs = new Map();
  for (const it of items) if (it.kind === 'shot' && it.L !== liveL) imgs.set(it.L, imageOf(it.L, t, false));
  if (liveL) imgs.set(liveL, imageOf(liveL, t, true));
  ctx.fillStyle = '#5f5d59'; ctx.fillRect(0, 0, W, H);
  for (const it of items) {
    if (it.kind === 'shot') drawLayer(ctx, imgs.get(it.L), it.q, { at: [0, 0], size: [W, H], edgeLine: it.L.shot !== 'hook' });
    else if (it.kind === 'card') drawLayer(ctx, it.c.card.canvas, it.q, { at: [it.c.card.at[0], it.q.y], size: [it.c.card.canvas.width, it.c.card.h], shadow: 0.42 });
    else if (it.kind === 'cover' && liveL) { const q = { ...it.q, dx: 0, dy: 0, rot: 0 }; delete q.y; drawLayer(ctx, imgs.get(liveL), q, { at: [0, 0], size: [W, H], shadow: 0.3 }); }
  }
  finish.apply(ctx, Math.round(t * 30), { grain: 0.012, vignette: 0.12 });
  last = { t, layers: items.map(i => i.kind === 'shot' ? i.L.id : i.kind + ':' + i.c.plan.n), live: liveL?.id };
  return last;
};
ready = true;
