// THE PLANT THAT WOULD NOT DIE: the frame (scenes/plant.js makes the canvas and the renderer and calls this; web/labs/lantern/plant_dry.mjs
// builds it in node against stubs to run every frame's logic without a GPU). research/october/PLANT_brief.md; the plan is plant.plan.js.
// Each frame: the set's base render (HDR, with its depth), the OVER render of the cards, the matte (lantern.js: the torch's light, the
// pictures' own light, the panes' layer, the world persist in the cards' alpha), the reveal straight to the canvas, then the lead's grade
// (hard black and white), the words, the grain, the mark.
import * as THREE from 'three';
import { W, H, loadFonts, Finish, closer, clamp, SAFE_BAND } from '../lib/kit.js';
import { loadBands, cueType, band, STYLES } from '../lib/fx/bands.js';
import { Reel } from '../lib/fx/reel.js';
import { Lantern, LightMatte } from '../lib/fx/lantern.js';
import { Eyes } from '../lib/fx/eyes.js';
import { loadAnsur } from '../lib/fx/rig/body.js';
import { loadHeroData } from '../lib/fx/hero.js';
import { TL, CUES, SUBS, LINE, STATIONS, LAND, POWER_CARDS, EXT, bayX, bayLit, coinAt, camAt, torchAt, shotAt, guardHand, runnerTorch, KNEE } from './plant.plan.js';
import { buildHall, buildPlant } from './plant.world.js';
import { Card, revealBy, NIGHT } from './plant.cards.js';
import { buildCrew, poseGuard, poseWatch, poseHands, poseDouble, poseCrew, hideFolk } from './plant.crew.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const FPS = 30;
// the persist windows: the cards keep what the light found in them (world-space), filled at the frame times from each window's start
const PERSIST = { station: [[TL.inside, TL.off + 0.1], [TL.breaker, TL.dark]], land: [[TL.swing, TL.breaker]] };
// light levels per shot (the reveal's exposure-1 units: ~1-2 on a surface reads white)
const LEVEL = { torchE: 5.5, moon: 0.32, shaft: 0.22, lot: 0.55, exit: 3.0, lamps: 2.4, fill: 0.05, poleE: 9, winE: 5, haze: 0.42 };

export async function buildPlantScene({ renderer, ctx, glc }) {
  await loadFonts(); await loadBands();
  const [sheetsJSON, reel, ansur, heroData] = await Promise.all([fetch('../assets/plant/sheets.json').then(r => r.json()),
    Reel.load(['../assets/flint/plates', '../assets/plant/plates']), loadAnsur(), loadHeroData()]);
  const finish = new Finish(1936);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const hall = new THREE.Scene(), plant = new THREE.Scene(), hallOver = new THREE.Scene(), plantOver = new THREE.Scene();
  hall.background = new THREE.Color(0, 0, 0); plant.background = new THREE.Color(0, 0, 0);
  hall.fog = new THREE.FogExp2('#000000', 0.011);
  const camera = new THREE.PerspectiveCamera(40, W / H, 0.03, 3200);
  const rtBase = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(W, H) });
  const rtOver = new THREE.WebGLRenderTarget(W / 2, H / 2, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(W / 2, H / 2) });
  const lm = new LightMatte(renderer, { w: W / 2, h: H / 2 });
  const zero = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); zero.needsUpdate = true;
  // ---------------------------------------------------------------- the sets, the light, the people
  const world = buildHall(hall, sheetsJSON), ext = buildPlant(plant);
  const torch = new Lantern(hall, { profile: 'led', shadow: 1024, ref: 4.2, haze: LEVEL.haze, ground: 0 }); torch.occluders = world.occluders; torch.stops = world.stops;
  const ghost = new Lantern(null, { profile: 'led', shadow: 0, beam: false });                 // the persist's replays (never rendered)
  const K = await buildCrew({ scene: hall, ansur, heroData });
  const eyes = new Eyes(hall, { max: 64, size: 0.016, minPx: 2.4, halo: 9 });
  const eyeLamp = new THREE.PointLight('#f4f8ff', 0, 0.09, 2); hall.add(eyeLamp);
  // ---------------------------------------------------------------- the cards
  const stationCards = STATIONS.map(s => new Card(hallOver, { plate: s.plate, w: LINE.cardW, pos: [s.x, LINE.cardY0 + LINE.cardH / 2, LINE.cardZ], off: s.off, rate: s.rate, acc: [24, 43], name: 'st' + s.i }));
  const landCards = LAND.map((L, k) => new Card(hallOver, { plate: L.plate, w: L.w, pos: L.card, face: L.cam, off: 1.1 * k, acc: [32, 57], name: 'land' + k }));
  const powerCards = POWER_CARDS.map(P => new Card(hallOver, { plate: P.plate, w: P.w, pos: P.pos, face: P.face === 'cam' ? [-9.5, 2.0, 4.2] : undefined, off: 0.3, name: P.name, curve: NIGHT.machine }));   // the machines kept to their highlights
  const extCards = EXT.plates.map((p, b) => new Card(plantOver, { plate: p, w: EXT.cardW, pos: [bayX(b), (EXT.winY0 + EXT.winY1) / 2 - (0.5 - EXT.cardV) * EXT.cardW * 16 / 9, EXT.cardZ], off: 0.7 * b, px: 270, name: 'bay' + b, curve: NIGHT.window }));
  // the running line's light on his face at the turn: a lamp whose gobo is the flywheel card as printed (lantern.js cookie)
  const machine = new Lantern(hall, { profile: 'incandescent', half: 0.62, lumens: 300, cookie: powerCards[2].cv, shadow: 0, beam: false, body: false, color: '#eef2ff' });
  machine.gain = 0; machine.update();
  const FR = new THREE.Frustum(), PV = new THREE.Matrix4();
  const closerCv = document.createElement('canvas'); closerCv.width = W; closerCv.height = H; const closerG = closerCv.getContext('2d');
  let lastShot = null;

  // the persist: bring each card's accumulator to time t (replaying from its windows' starts when a render begins or jumps)
  function persistTo(cards, windows, t, torchFn) {
    for (const c of cards) {
      if (c.accT > t + 1e-6) c.resetAcc();
      let from = c.accT < 0 ? -Infinity : c.accT;
      for (const [a, b] of windows) {
        const k0 = Math.max(Math.ceil((Math.max(a, from + 1e-6)) * FPS - 1e-6), Math.ceil(a * FPS - 1e-6)), k1 = Math.floor(Math.min(b, t) * FPS + 1e-6);
        for (let k = k0; k <= k1; k++) { const tk = k / FPS; if (tk <= from + 1e-6) continue; if (!torchFn(tk)) continue; c.accumulate(revealBy(ghost, KNEE, 0.04)); }
      }
      c.accT = t;
    }
  }
  // the ghost torch at a replay time (the plan's torch: the guard's hand point, the double's run, the swing's hand)
  function ghostAt(tk) {
    const T = torchAt(tk), S = shotAt(tk); if (!T.on) return false;
    ghost.ref = T.ref || 3; ghost.on(T.on);
    if (T.hold === 'runner') { const r = runnerTorch(tk); ghost.place(r.pos).aimDir(r.dir); }
    else { const pos = T.pos || (T.hold === 'guard' ? guardHand(S.name) : null); if (!pos) return false; ghost.place(pos); if (T.target) ghost.aim(T.target); }
    if (T.drift) ghost.drift(tk, T.drift);
    return true;
  }

  async function renderHall(t, C) {
    const name = C.name, dark = t >= TL.dark, crewIn = name === 'lamp' || name === 'crew';
    // the set's state
    for (const s of world.sheets) s.visible = !dark;
    const run = x => 1 - sstep(TL.dark + x - 0.01, TL.dark + x + 0.03, t);                    // every light dies in a run at the breaker's bottom
    const amb = name === 'beam' ? 0 : 1;                                                       // frame 0: black but the disc (the moon is elsewhere)
    world.moon.intensity = LEVEL.moon * amb * run(0.11) * (crewIn ? 0.4 : 1);
    for (const s of world.shafts) s.sf.set(s.from, world.moon.position.clone().sub(world.moon.target.position).negate().normalize(), s.len, LEVEL.shaft * amb * run(0.11) * (crewIn ? 0.3 : 1), 0.32, 0.012, camera);
    world.exitMat.color.setScalar(LEVEL.exit * run(0) * (name === 'beam' ? 0 : 1) + (crewIn ? LEVEL.exit : 0));
    world.lot.gain = LEVEL.lot * amb * run(0.04) * (dark ? 0 : 1) * world.lot.ref * world.lot.ref / world.lot.I0; world.lot.update();
    const lampsK = name === 'crew' ? 1 : name === 'lamp' ? 0.35 : 0;
    for (const L of world.lamps) L.intensity = LEVEL.lamps * 49 * lampsK;
    world.fixtures.visible = name === 'crew' || name === 'lamp';
    world.fill.intensity = LEVEL.fill * lampsK;
    // the people
    K.guard.group.visible = false; K.hands.group.visible = false; K.ratchet.visible = false; hideFolk(K);
    if (name === 'watch') {                                                                    // his face: the camera set from his own eyes (bodies differ)
      poseWatch(K, V3(-8.0, 0, 2.6), 0.05);
      const he = Eyes.ofHero(K.guard), E = he[0].clone().lerp(he[1], 0.5), k = sstep(TL.watch, TL.lamp, t);
      camera.position.copy(E).add(V3(0.05 + 0.03 * k, -0.05, 1.2 - 0.07 * k)); camera.fov = 30; camera.up.set(0, 1, 0); camera.lookAt(E.clone().add(V3(0, 0.035, 0)));
      camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    }
    if (name === 'lamp' || name === 'crew') poseHands(K, t, world.bolt);
    let dbl = null; if (name === 'breaker') dbl = poseDouble(K, t);
    let crewEyes = []; if (name === 'crew') crewEyes = poseCrew(K, t, C.p);
    // the torch
    const T = torchAt(t); torch.ref = T.ref || 3; torch.on(T.on ?? 0); torch.haze = LEVEL.haze;
    if (T.hold === 'guard') { const hand = guardHand(name); torch.place(hand).aim(T.target); if (T.drift) torch.drift(t, T.drift); poseGuard(K, name, torch, torch.pos.clone().addScaledVector(torch.dir, 10)); }
    else if (T.hold === 'runner') { const r = runnerTorch(t); torch.place(r.pos).aimDir(r.dir); }
    else if (T.pos) { torch.place(T.pos); if (T.target) torch.aim(T.target); if (T.drift) torch.drift(t, T.drift); }
    torch.gain = LEVEL.torchE * torch.ref * torch.ref / torch.I0;
    if (T.bench) torch.haze = 0.08;
    torch.update(camera);
    if (dbl && dbl.lever) world.setHandle(dbl.lever.pivot, dbl.lever.grip);
    else { const D = world.disconnect; world.setHandle(V3(D.x, 1.55, D.z + 0.2), V3(D.x, 1.55 + 0.45 * Math.sin(0.62), D.z + 0.2 - 0.45 * Math.cos(0.62) + 0.45)); }
    K.folk.update(camera);
    if (name === 'breaker') {                                                                // the torch rides in his right fist once he is posed
      const g = K.folk.gripPos(K.double, -1, V3()); if (g.y > -100) { torch.place(g.add(V3(0, 0.02, 0))); torch.update(camera); } }
    // the cards in this shot
    const showSt = ['beam', 'sheets', 'inside', 'swing', 'breaker'].includes(name) && !dark, showLand = name === 'swing', showPow = name === 'powers' || name === 'watch';
    FR.setFromProjectionMatrix(PV.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const live = [];
    const persisting = name === 'inside' || name === 'swing' || name === 'breaker';                // a card is printed only if light can reach it
    for (const c of stationCards) { c.mesh.visible = showSt; if (showSt && c.inView(FR) && (c.litBy(torch) || (persisting && c.accMax > 0))) live.push(c); }
    for (const c of landCards) { c.mesh.visible = showLand; if (showLand && c.inView(FR) && (c.litBy(torch) || c.accMax > 0)) live.push(c); }
    for (const [k, c] of powerCards.entries()) { const P = POWER_CARDS[k], on = sstep(P.t, P.t + 0.35, t); c.mesh.visible = showPow && on > 0; c.U.uLit.value = on; if (c.mesh.visible && (c.inView(FR) || name === 'watch')) live.push(c); }
    if (name === 'watch' && !live.includes(powerCards[2])) live.push(powerCards[2]);
    // the persist (world-space), in the shots that keep it: every card in view is brought to t; one it has touched is printed
    if (persisting) { const inv = stationCards.filter(c => showSt && c.inView(FR)); persistTo(inv, PERSIST.station, t, ghostAt); for (const c of inv) if (c.accMax > 0 && !live.includes(c)) live.push(c); }
    if (name === 'swing') { const inv = landCards.filter(c => c.inView(FR)); persistTo(inv, PERSIST.land, t, ghostAt); for (const c of inv) if (c.accMax > 0 && !live.includes(c)) live.push(c); }
    for (const c of live) await c.print(reel, t);
    // the eyes: his at the turn (calm, unshouting: no expression), the crew's one by one as they work
    eyes.begin(); eyeLamp.intensity = 0;
    if (name === 'watch') { const he = Eyes.ofHero(K.guard), o = sstep(TL.eyes, TL.eyes + 0.45, t); eyes.pair(he[0], he[1], o * 1.1, '#ffffff');
      eyeLamp.position.copy(he[0]).lerp(he[1], 0.5).add(V3(0, 0.012, 0.05)); eyeLamp.intensity = 0.04 * o; }
    for (const e of crewEyes) { if (e.open <= 0.001) continue; const ep = Eyes.ofPeople(K.folk, e.c.id); if (ep) eyes.pair(ep[0], ep[1], e.open * 0.95, '#ffffff'); }
    eyes.end(camera, H);
    // the machines' light on his face (the turn)
    machine.gain = name === 'watch' ? 2.4 * 1.0 * 1.0 / machine.I0 * 4 : 0; if (name === 'watch') { const f = K.guard.joint('head'); machine.place(f.clone().add(V3(-0.85, -0.25, 0.75))).aim(f); machine.light.map.needsUpdate = true; }
    machine.update();
    // render: the base (HDR + depth), the cards (their own depth; alpha 0 where there is none), the matte, the reveal to the canvas
    renderer.setRenderTarget(rtBase); renderer.render(hall, camera);
    const cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0); renderer.setRenderTarget(rtOver); renderer.clear(); renderer.render(hallOver, camera); renderer.setClearColor(cc, ca); renderer.setRenderTarget(null);
    let mask = zero, opt = { gain: 1, lightK: 1, exposure: 1, edge: 0.06 };
    if (torch.k > 0.001 && (showSt || showLand)) mask = lm.light(rtBase.depthTexture, camera, torch, { knee: KNEE, edge: 0.04, ragged: 0.3, t });
    if (name === 'inside' && t >= TL.off) opt = { gain: 0.5, lightK: 0, selfK: 1, key: 0.42, soft: 0.25, persistA: 1 };
    else if (name === 'inside') opt = { ...opt, persistA: 1 };
    else if (name === 'swing' || name === 'breaker') opt = { ...opt, persistA: 1, lightK: 0.55 };
    else if (showPow) { mask = lm.self(rtOver, { key: 0.5, soft: 0.18 }); opt = { gain: 1.1, lightK: 1, exposure: 1 }; }
    const hasOver = showSt || showLand || showPow;
    lm.reveal(rtBase, hasOver ? rtOver : null, hasOver ? mask : null, { ...opt, target: null });
    return { live: live.length };
  }

  async function renderPlant(t, C) {
    const poleOn = t < TL.ext ? 1 : 0;
    ext.pole.intensity = ext.poleCd * LEVEL.poleE * 81 / ext.poleCd * poleOn; ext.poleFace.material.color.setScalar(6 * poleOn);
    const coin = coinAt(t);
    for (const [b, c] of extCards.entries()) {
      const lit = bayLit(b, t); c.U.uLit.value = lit; c.mesh.visible = true;
      const cy = (EXT.winY0 + EXT.winY1) / 2 - (0.5 - EXT.cardV) * c.h;
      c.U.uCoin.value.set((coin.x - (bayX(b) - c.w / 2)) / c.w, (coin.y - (cy - c.h / 2)) / c.h, 0.95 / c.h, 1.25 * coin.on);
      const L = ext.winLights[b]; L.gain = LEVEL.winE * lit * 64 / L.I0; L.update();
      await c.print(reel, t);
    }
    renderer.setRenderTarget(rtBase); renderer.render(plant, camera);
    const cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0); renderer.setRenderTarget(rtOver); renderer.clear(); renderer.render(plantOver, camera); renderer.setClearColor(cc, ca); renderer.setRenderTarget(null);
    const mask = lm.layer(plant, camera, 3);
    lm.reveal(rtBase, rtOver, mask, { gain: 1, lightK: 0, exposure: 1.15, edge: 0, target: null });
    return {};
  }

  async function frame(t) {
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    const C = camAt(Math.min(t, TL.end - 1e-3));
    camera.position.copy(C.p); camera.fov = C.fov; camera.up.set(0, 1, 0); camera.lookAt(C.l); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    if (C.name !== lastShot) { lastShot = C.name; }
    const info = C.set === 'hall' ? await renderHall(t, C) : await renderPlant(t, C);
    { const gl = renderer.getContext(), px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    // the lead's grade: hard black and white
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.filter = 'grayscale(1) contrast(1.3) brightness(1.04)'; ctx.drawImage(glc, 0, 0, W, H); ctx.filter = 'none';
    if (t >= TL.mark) {                                                                        // the lit plant sinks under the house closer
      const age = t - TL.mark; ctx.fillStyle = `rgba(2,1,1,${clamp(0.55 + age * 1.6, 0, 0.97)})`; ctx.fillRect(0, 0, W, H);
      closerG.clearRect(0, 0, W, H); closer(closerG, age); ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.drawImage(closerCv, 0, 0); ctx.restore();
      return { shot: C.name };
    }
    cueType(ctx, t, CUES, { x: SAFE_BAND.cx });
    for (const [a, e, line, y, size] of SUBS) if (t >= a && t < e) band(ctx, line, SAFE_BAND.cx, y, size, { ...STYLES.sub, a: clamp((e - t) / 0.08) });
    finish.apply(ctx, Math.round(t * FPS), { grain: 0.07, vignette: 0.42 });
    return { shot: C.name, ...info };
  }
  return { frame, world, ext, K, torch, lm, camera, cards: { stationCards, landCards, powerCards, extCards } };
}
