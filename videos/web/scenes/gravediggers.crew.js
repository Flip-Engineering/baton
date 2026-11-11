// THE GRAVEDIGGERS: the crew and the ground they move (no DOM: the scene builds it into its World; tools/gravediggers_calls.mjs builds
// it without a scene to write assets/gravediggers/calls.json).
//   the rim crew   (v2: person pipeline people, lib/fx/person makePerson) an older plant worker in a cap (L05) leaning on his planted
//                  spade at the head end; from TL.turn he turns to the grave's spoil and fills (makeDig, two spits off the heap: Earthwork
//                  fromHeap, solved to land at TL.land and TL.land2); the woman (L14) on the west rim, her spade on the rim's edge (makeDig: one cycle on 1.875, one on
//                  30.0, a notch in the rim); two people.js workers kneeling and crouching on the west rim, blades planted; one
//                  crouching at the foot end with a cup (steam)
//   the 48         people.js diggers (steel, weld, overalls, rail; men and women), one at the moon-side foot of every second stone,
//                  walking in from the west edge, arriving in Dig's set stance; one Dig each (roundpoint, arms): one free bite on
//                  arrival for those who get there in time (Canada's), then every bite on the call (explicit 14.84 + 2.5 k; the
//                  break's call answered with no spread: each digger's own reaction solved out). Earthwork pits at the crowd's rate
//                  (each bite moves tens of spits: a fable's pace) until 18.0, nothing after (the close's two heroes are the spit)
//   the close      the woman and a welder in a knit cap (L23; makeDig: spade, foot drive, on the trench floor) at the trench's
//                  south end, cutting the bench ahead of them at rate 1; the southernmost U.S. diggers stand down for them
//   the field      a few thousand people.js workers beyond the graveyard (stand, SHOULDER_TOOL, a spade each), facing the grave
// Earthwork (lib/fx/earthwork.js): the grave (open: 1, its spoil a ridge beyond the east rim), the woman's notch, a pit per digger,
// three link cuts (opened on the 16ths from 14.9 by the walls' own breaking: synthetic bites), the joins on 16ths from the grave
// outward and up both columns, the sumps the heroes cut, the trench paths (the settle at the break, the depth for the score).
import * as THREE from 'three';
import { People } from '../lib/fx/people.js';
import { workerDesc } from '../lib/fx/workforce.js';
import { mulberry32 } from '../lib/fx/rig/body.js';
import { loadPersonStudio, makePerson } from '../lib/fx/person/index.js';
import { Cast } from '../lib/fx/motion/cast.js';
import { Poser } from '../lib/fx/motion/poser.js';
import { Dig } from '../lib/fx/motion/labour.js';
import { makeDig, shovelModel } from '../lib/fx/motion/dig.js';
import { Earthwork } from '../lib/fx/earthwork.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TL, CALLS, STRIKES, REACT, S16, GRAVE, COL, TRENCH, LINKS, RIM, LEDGER, BERM_X, stoneZ, trenchX, HOOKS, HOOK } from './gravediggers.plan.js';
// v2: the walk in starts out in the dark west of the yard (v1's started at the overhead's frame edge, 6.7 m west)
const WALK_X = -14.0;

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const h01 = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
export const FLOOR_T = 18.0;                 // the crowd's bites move earth until here (after it the close's two are the spit)

// a tool from shovelModel as instanced meshes (one per material), for the crowd and the field
function instancedTool(tool, n, scene) {
  const g = shovelModel(THREE, tool), by = new Map(); g.updateMatrixWorld(true);
  g.traverse(o => { if (!o.isMesh) return; const geo = o.geometry.clone().applyMatrix4(o.matrixWorld); geo.deleteAttribute('uv'); if (!geo.index) return;
    if (!by.has(o.material)) by.set(o.material, []); by.get(o.material).push(geo); });
  const out = []; for (const [mat, geos] of by) { const m = new THREE.InstancedMesh(mergeGeometries(geos), mat, n); m.count = 0; m.castShadow = m.receiveShadow = true; m.frustumCulled = false; if (scene) scene.add(m); out.push(m); }
  return { meshes: out, n: 0, set(i, M) { for (const m of out) m.setMatrixAt(i, M); }, done(k) { for (const m of out) { m.count = k; m.instanceMatrix.needsUpdate = true; } } };
}
// makeDig's own Dig, rebuilt from the same options (a hero's bites and lands, solved before makeDig is called)
function heroDig(h, o) {
  const P0 = new Poser(); P0.begin(new Float32Array(66), null); const k = h.o.height / 1.76, { throwTo, cut, bodyKg = 78, ...rest } = o;
  return new Dig({ ...rest, dims: P0.dims(), sc: k, bodyKg, base: h.group.position.clone(), heading: h.group.rotation.y,
    throwTo: throwTo && throwTo.clone().multiplyScalar(1 / k), cut: cut && cut.clone().multiplyScalar(1 / k) });
}
// calls that put cycle k's bite exactly at want[k] (a bite is its call + the digger's reaction, drawn per call from the seed: linear)
function solveCalls(make, want) { const nom = want.map(t => t - REACT), d0 = make(nom); return want.map((t, k) => nom[k] + (t - d0._cyc[k].b)); }
// a hero placed: group at [x, y, z], heading
const place = (h, [x, y, z], heading) => { h.group.position.set(x, y, z); h.group.rotation.y = heading; h.group.updateMatrixWorld(true); };
// world -> a hero's local frame (metres) at [x, z, heading]
const toLocal = (w, [x, z, hd]) => w.clone().sub(V3(x, w.y, z)).setY(w.y).applyAxisAngle(V3(0, 1, 0), -hd);

export async function buildCrew({ scene = null, ansur, heroData, lf = null, field = 2400, personStudio = null } = {}) {
  const S = scene || new THREE.Scene(), R = mulberry32(1848);
  const folk = new People(S, { max: 64 + field, viewH: 1920, budget: [14, 420], lodPx: [250, 70] }), C = new Cast(folk);
  // ---------------------------------------------------------------- Earthwork: the plan
  const box = [-3.6, LEDGER.z0 - 0.25, 0.8, GRAVE.l / 2 + 0.55];
  const ew = new Earthwork(THREE, scene, { box, res: 0.02, near: 8, seed: 1848, lf, ground: { color: '#69705c', roughness: 0.96 }, earth: '#3a3128', spoil: '#4c3d2e', keyEvery: 1.5, maxKeys: 16 });
  const grave = ew.pit({ rect: [GRAVE.x, GRAVE.z, GRAVE.w, GRAVE.l, 0], floor: GRAVE.floor, open: 1, seed: 1848, heap: { side: 1, gap: 0.12 } });
  const W0 = RIM.woman, notch = ew.pit({ rect: [W0.notch[0], W0.notch[1], W0.notch[2], W0.notch[3], 0], floor: W0.notchFloor, seed: 7 });
  const atBerm = z => ({ at: [BERM_X, z] });
  const link = { US: ew.pit({ rect: [...LINKS.US, 0], floor: TRENCH.floor, heap: atBerm(LINKS.US[1]), seed: 31 }), X: ew.pit({ rect: [...LINKS.X, 0], floor: TRENCH.floor, heap: atBerm(LINKS.X[1]), seed: 32 }),
    CS: ew.pit({ rect: [...LINKS.CS, 0], floor: TRENCH.floor, heap: atBerm(LINKS.CS[1]), seed: 33 }) };
  // ---------------------------------------------------------------- the 48: a pit, a place, a walk in, a Dig each
  const TR = ['steel', 'weld', 'overalls', 'rail'], DIG = [];
  for (const col of ['us', 'ca']) for (let j = 0; j < 24; j++) {
    const k = COL.n - 1 - 2 * j, X = col === 'us' ? COL.XU : COL.XC, pz = stoneZ(k), px = trenchX(X), i = DIG.length;
    const welder = col === 'us' && j === 0, trade = welder ? 'weld' : TR[(j * 3 + (col === 'us' ? 1 : 0)) % 4];
    const desc = workerDesc(ansur, R, { trade, sex: welder ? 'm' : R() < 0.3 ? 'f' : 'm', c7: true }); desc.hat = true; desc.gloves = true;
    const id = folk.add(desc), st = folk.get(id), sc = C.sc(id), dims = C.dims(id), seed = 4000 + i * 17, bodyKg = C.bodyKg(id);
    // the place: the Dig's own cut (the set, rear grip at home) lands on the pit's centre
    const probe = new Dig({ seed, dims, sc, bodyKg, base: V3(), heading: Math.PI / 2, tool: 'roundpoint', lead: 'L', cycles: 1, st });
    const off = Poser.l2w(probe.frame, probe.cut), base = V3(px - off.x, 0, pz - off.z);
    const L = V3(BERM_X + (h01(i * 3.1) - 0.5) * 0.3, 0, pz + (h01(i * 5.7) - 0.5) * 0.25);           // the land: the bank west of Canada
    const throwTo = L.clone().sub(base).applyAxisAngle(V3(0, 1, 0), -Math.PI / 2).multiplyScalar(1 / sc);
    // the walk in from the west edge (U.S. first: theirs is longer, across Canada's low row between its diggers), at a brisk 1.6 m/s
    const zW = col === 'us' ? pz - COL.pitch : base.z, path = col === 'us' ? [V3(WALK_X - 0.6 * h01(i * 4.4), 0, zW), V3(base.x - 0.75, 0, zW), base.clone()] : [V3(WALK_X - 0.6 * h01(i * 4.4), 0, zW), base.clone()];
    const len = path.slice(1).reduce((a, p, n) => a + p.distanceTo(path[n]), 0), v = col === 'us' ? 1.6 : 1.7;
    const early = (-6.7 - WALK_X) / v;                 // the longer walk: they set out earlier and arrive when v1's did
    const enter = (col === 'us' ? 10.85 + 0.25 * h01(i * 7.3) : 10.72 + 0.62 * h01(i * 9.1)) - early, arrive = enter + len / v;
    // one free bite on arrival if its cycle can close before the call (Canada's: the cycle squeezed to its floor ends by 14.79), then the
    // calls as called (each bite its own reaction late: a spread of +- 0.05 s on the beat), the break's answered exactly on it
    // (Canada's long shovels on a quicker cycle, 1.9 s: a free bite as late as 13.7 still closes before the call's set at 14.79)
    const period = col === 'ca' ? 1.9 : 2.2, iso = arrive + 0.34 + 0.5 * h01(i * 2.9), free = iso <= 14.79 - 0.6 * 0.9 * period * 1.06 - 0.06 ? [iso - REACT] : [];
    const make = calls => new Dig({ seed, dims, sc, bodyKg, base, heading: Math.PI / 2, tool: 'roundpoint', lead: 'L', calls, st, throwTo, period });
    const nom = [...free, ...CALLS, ...STRIKES], d0 = make(nom), kb = free.length + CALLS.length - 1; nom[kb] += TL.brk - d0._cyc[kb].b;
    const dig = make(nom);
    DIG.push({ i, id, col, j, k, pit: { x: px, z: pz }, base, dig, path, len, v, enter, arrive, iso: free.length ? dig._cyc[0].b : null, seed, sc,
      quarter: i % 4, closeHide: col === 'us' && k >= 33, ph0: h01(i * 1.3) * 6.28 });
  }
  // the pits (one per digger: the pitch is two stones, the wall between neighbours 0.24 m) and their joins, from the grave outward
  for (const d of DIG) d.cut = ew.pit({ rect: [d.pit.x, d.pit.z, TRENCH.w, TRENCH.pitLen, 0], floor: TRENCH.floor, heap: atBerm(d.pit.z), seed: 100 + d.i });
  const colPits = c => DIG.filter(d => d.col === c).sort((a, b) => b.pit.z - a.pit.z).map(d => d.cut);      // south (the grave) first
  const pUS = colPits('us'), pCA = colPits('ca'), J = [];
  const join = (a, b, n) => J.push(ew.join(a, b, { at: TL.join + n * S16, need: 0.3 }));
  // the grave and the links on 16ths 0-2, the first pit of each column on 3 (a pit's first spits reach the join's depth at about 15.4),
  // then two walls of each column on each 16th (4-15): both trenches whole by 17.34, read whole for a bar and a half before the cut
  join(grave, link.US, 0); join(link.US, link.X, 1); join(link.X, link.CS, 2); join(link.US, pUS[0], 3); join(link.CS, pCA[0], 3);
  for (let n = 0; n + 1 < pUS.length; n++) join(pUS[n], pUS[n + 1], 4 + (n >> 1));
  for (let n = 0; n + 1 < pCA.length; n++) join(pCA[n], pCA[n + 1], 4 + (n >> 1));
  // the links open on the 16ths before the join (the walls' own breaking: synthetic bites, a fable's pace, their spoil on the bank)
  { let kk = 0; const ev = (cut, rect, t0) => { const out = []; for (let s = 0; s < 3; s++) { const t = t0 + s * S16 * 0.5, p = V3(rect[0] + (s - 1) * rect[2] * 0.25, 0, rect[1]);
      out.push({ t, kind: 'bite', k: kk, where: p, depth: 0.22, kg: 30 }, { t: t + 0.55, kind: 'land', k: kk, where: V3(BERM_X, 0, rect[1]), kg: 30 }); kk++; } return out; };
    const vol = r => r[2] * r[3] * -TRENCH.floor * 1450 / (3 * 30);
    ew.feed(ev(link.US, LINKS.US, 14.82), { cut: link.US, rate: vol(LINKS.US) * 1.02, tool: 'spade', lag: 0.06 });
    ew.feed(ev(link.X, LINKS.X, 14.98), { cut: link.X, rate: vol(LINKS.X) * 1.02, tool: 'spade', heading: Math.PI / 2, lag: 0.06 });
    ew.feed(ev(link.CS, LINKS.CS, 15.13), { cut: link.CS, rate: vol(LINKS.CS) * 1.02, tool: 'spade', lag: 0.06 }); }
  // the crowd's feeds: each bite before FLOOR_T moves `rate` spits, so each digger's pit and the wall north of it are dug out by then
  // a pit and what the join leaves of the wall north of it (it breaks at about half depth), a little under: no spit is left over to
  // roam into the sumps the close's two cut (the top bench first rule takes everything higher before it goes deeper)
  const VOL = TRENCH.w * (TRENCH.pitLen + 0.24 * 0.45) * -TRENCH.floor * 0.97;
  // (each of a bite's spits counted as a full long-shovel load of bank, the throw's own lighter load notwithstanding: fewer spits to cut)
  const SPIT_KG = 9.4;
  for (const d of DIG) { const n = d.dig.allEvents.filter(e => e.kind === 'bite' && e.t < FLOOR_T).length;
    d.rate = n ? VOL * 1450 / (n * SPIT_KG) : 0; ew.feed(d.dig.allEvents.filter(e => e.kind === 'land' || e.t < FLOOR_T).map(e => (e.kind === 'bite' ? { ...e, kg: SPIT_KG } : e)), { dig: d.dig, cut: d.cut, rate: d.rate }); }
  // the trench paths (not fed: the settle's cuts, and the trench's depth for the score)
  const trUS = ew.trench({ path: [[trenchX(COL.XU), LEDGER.z0 + 0.1], [trenchX(COL.XU), -GRAVE.l / 2 - 0.36]], width: TRENCH.w, floor: TRENCH.floor });
  const trCA = ew.trench({ path: [[trenchX(COL.XC), LEDGER.z0 + 0.1], [trenchX(COL.XC), LINKS.CS[1] + LINKS.CS[3] / 2]], width: TRENCH.w, floor: TRENCH.floor });
  ew.settle({ t: TL.brk + 0.04, cuts: [trCA, trUS], drop: 0.12, shear: 0.25, over: 0.6 });

  // ---------------------------------------------------------------- the heroes
  // v2: the three are the person pipeline's people (lib/fx/person makePerson: body, face, skin, hair, work clothes), not hero.js presets.
  // v1's man at the head of the grave was the lead piece's figure (its config, seed and eye lamp): he is gone. The head of the grave
  // is this piece's own: an older plant worker in a cap, who leads the fill at the end.
  const pst = personStudio || await loadPersonStudio();
  const person = async (name, o) => { const P = await makePerson(name, { studio: pst, pose: false, ...o }); return P.h; };
  const him = await person('L05_m59_black', { hat: 'cap', hatColor: '#1e1d1b', gloves: true, gloveColor: '#6b5a44', seed: 1848 });
  const her = await person('L14_f42_black', { gloves: true, gloveColor: '#8a7a52', seed: 1871 });
  const welder = await person('L23_m45_white', { hat: 'knit', hatColor: '#2b2b2d', gloves: true, gloveColor: '#5a4a38', seed: 1905 });
  for (const h of [him, her, welder]) { h.group.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); if (scene) scene.add(h.group); }
  // the man: his Dig faces the grave's spoil (ESE) from beside the head end, his right to the grave; his spit lands on the sign at TL.land
  const M0 = RIM.man, mBase = [M0.dig[0], 0, M0.dig[1]], sign = V3(RIM.sign[0], RIM.sign[1], RIM.sign[2]);
  place(him, mBase, M0.dig[2]);
  const mThrow = toLocal(sign, M0.dig);
  const mOpt = { tool: 'spade', seed: 1848, lead: 'R', throwTo: mThrow, bodyKg: 82, kg: 11 };      // a full spit off the heap (the sign half under it)
  // two spits: the first lands on the sign at TL.land, the second over it at TL.land2 (the earth closing)
  let mCalls; { const g = TL.land - 2.2; let c = [g, g + (TL.land2 - TL.land)];
    for (let it = 0; it < 3; it++) { const pr = heroDig(him, { ...mOpt, calls: c }); c = [c[0] + (TL.land - pr.plan(0).tLand), c[1] + (TL.land2 - pr.plan(1).tLand)]; } mCalls = c; }
  const mCall = mCalls[0];
  const dgM = makeDig(THREE, S, him, { ...mOpt, calls: mCalls });
  // the woman on the west rim: her spade on the rim's edge, a cycle on 1.875 and on 30.0, across the mouth to the ridge's crest
  const wR = RIM.woman.base, wBase = [wR[0], 0, wR[1]];
  place(her, wBase, wR[2]);
  const crest = V3(GRAVE.w / 2 + 0.12 + 1.42, 0.86, wR[1] + 0.1), wOpt = { tool: 'spade', seed: 1871, lead: 'L', throwTo: toLocal(crest, wR), cut: V3(0.02, 0, RIM.woman.cut), bodyKg: 64 };
  const wCalls = solveCalls(c => heroDig(her, { ...wOpt, calls: c }), [TL.gd, TL.fall]);
  const dgWR = makeDig(THREE, S, her, { ...wOpt, calls: wCalls });
  // the close: the woman and the welder on the U.S. trench's floor at its south end, facing up it, cutting the bench ahead (sumps)
  // (each where its spade's cut, 0.53 m ahead, is a pit's centre: a spit's first wedge is cut in a digger's own pit, not on a broken wall)
  const xT = trenchX(COL.XU) + 0.02, zA = stoneZ(37) + 0.534, zB = stoneZ(31) + 0.534, hClose = {};
  const sumpA = ew.trench({ path: [[xT, zA - 0.28], [xT, zA - 1.2]], width: 0.46, floor: -1.25 }), sumpB = ew.trench({ path: [[xT, zB - 0.28], [xT, zB - 1.2]], width: 0.46, floor: -1.25 });
  // the floor they stand on: the trench as the crowd leaves it at the close (Earthwork is pure: asked before their own feeds exist)
  const yA = ew.heightAt(xT, zA, TL.close), yB = ew.heightAt(xT, zB, TL.close);
  const cOpt = (h, seed, kg) => ({ tool: 'spade', seed, lead: 'L', pit: Math.max(0.3, -h), edge: TRENCH.w / 2, bodyKg: kg });
  place(her, [xT, yA, zA], Math.PI); const wTcalls = solveCalls(c => heroDig(her, { ...cOpt(yA, 1872, 64), calls: c }), [17.5, 20.0, 22.5, 25.0, TL.brk]);
  const dgWT = makeDig(THREE, S, her, { ...cOpt(yA, 1872, 64), calls: wTcalls }); hClose.her = [xT, yA, zA];
  place(welder, [xT, yB, zB], Math.PI); const eTcalls = solveCalls(c => heroDig(welder, { ...cOpt(yB, 1905, 84), calls: c }), [17.5, 20.0, 22.5, 25.0, TL.brk]);
  const dgWe = makeDig(THREE, S, welder, { ...cOpt(yB, 1905, 84), calls: eTcalls }); hClose.welder = [xT, yB, zB];
  // their feeds: the spit at rate 1 into the bench ahead (no keep-out round their feet: the crowd dug that floor, and nothing cuts it now)
  const heroFeed = (dg, cut) => { const nk = ew.keeps.length; ew.feed(dg.dig.allEvents.filter(e => e.kind === 'land' || e.t > 17.0), { dig: dg.dig, cut, rate: 1 }); ew.keeps.length = nk; ew._dirty = true; };
  const pitAt = z => DIG.filter(d => d.col === 'us').reduce((b, d) => (Math.abs(d.pit.z - z) < Math.abs(b.pit.z - z) ? d : b)).cut;
  heroFeed(dgWT, pitAt(zA - 0.6)); heroFeed(dgWe, pitAt(zB - 0.6));
  ew.feed(dgWR.dig, { cut: notch, rate: 1 });
  ew.feed(dgM.dig, { fromHeap: true });
  for (const dg of [dgM, dgWR, dgWT, dgWe]) dg.heap.visible = false;

  // ---------------------------------------------------------------- the rim crew (people.js): kneeling, crouching, the cup
  const RIMP = [];
  const rimOne = (key, trade, sex, seed) => { const Rr = mulberry32(seed), d = workerDesc(ansur, Rr, { trade, sex, c7: true }); d.hat = true; d.gloves = trade !== 'overalls';
    const id = folk.add(d), [x, z, hd] = RIM[key], fr = Poser.frame(V3(x, 0, z), hd, C.sc(id)); const o = { key, id, frame: fr, sc: C.sc(id) }; RIMP.push(o); return o; };
  const K = rimOne('kneel', 'rail', 'm', 61), Cr = rimOne('crouch', 'overalls', 'f', 62), Cu = rimOne('cup', 'steel', 'm', 63);
  // their planted spades: blade in the ground at the rim's edge, the shaft leaning back to the hand (world matrices: origin the D)
  const plantedSpade = (tip, D) => { const y = tip.clone().sub(D).normalize(), z = V3(0, 1, 0).cross(y).normalize(), x = V3().crossVectors(y, z).normalize(); z.crossVectors(x, y);
    return new THREE.Matrix4().makeBasis(x, y, z).setPosition(D); };
  const spadeAt = (fr, tipL, hold) => { const tip = Poser.l2w(fr, tipL), D = Poser.l2w(fr, hold), dir = tip.clone().sub(D).normalize(); D.copy(tip).addScaledVector(dir, -0.99); return plantedSpade(tip, D); };
  K.spade = spadeAt(K.frame, V3(0.24, -0.12, 0.29), V3(0.14, 0.95, 0.2)); Cr.spade = spadeAt(Cr.frame, V3(0.24, -0.12, 0.3), V3(0.1, 0.85, 0.2));
  const rimTools = []; for (const o of [K, Cr]) { const g = shovelModel(THREE, 'spade'); g.matrixAutoUpdate = false; g.matrix.copy(o.spade); g.matrixWorldNeedsUpdate = true; if (scene) scene.add(g); rimTools.push(g); o.tool = g; }
  const onShaft = (M, u) => V3(0, u, 0).applyMatrix4(M);                     // a point u metres down the shaft from the D
  const rimSpec = (o, t) => { const fr = o.frame, w2l = p => Poser.w2l(fr, p), br = 0.012 * Math.sin(t * 1.7 + o.id);
    if (o.key === 'kneel') return { pelvis: { p: V3(0.02, 0.5 + br * 0.3, -0.16), pitch: 0.22, yaw: 0.1 }, spine: { flex: 0.5 + br, twist: 0.12 }, head: { pitch: 0.66, yaw: 0.05 },
      feet: [{ p: V3(0.14, 0, 0.22), yaw: 0.12 }, { p: V3(-0.14, 0, -0.56), yaw: -0.05, pitch: -1.15, pivot: 'T' }],
      hands: [{ p: w2l(onShaft(o.spade, 0.1)), curl: 1.4 }, { p: w2l(onShaft(o.spade, 0.03)), curl: 1.45 }], arms: [null, null] };
    if (o.key === 'crouch') return { pelvis: { p: V3(0, 0.4 + br * 0.3, -0.2), pitch: 0.34 }, spine: { flex: 0.58 + br }, head: { pitch: 0.6 },
      feet: [{ p: V3(0.16, 0, -0.02), yaw: 0.3, kneeOut: 0.55 }, { p: V3(-0.16, 0, -0.07), yaw: -0.3, kneeOut: 0.55 }],
      hands: [{ p: w2l(onShaft(o.spade, 0.04)), curl: 1.45 }, { p: w2l(onShaft(o.spade, 0.16)), curl: 1.4 }], arms: [null, null] };
    // the cup: both hands round it, at the chest, over the knees; the head down to the grave
    return { pelvis: { p: V3(0, 0.4 + br * 0.3, -0.15), pitch: 0.28 }, spine: { flex: 0.42 + br }, head: { pitch: 0.62 },
      feet: [{ p: V3(0.17, 0, 0.06), yaw: 0.3, kneeOut: 0.6 }, { p: V3(-0.17, 0, 0.02), yaw: -0.3, kneeOut: 0.6 }],
      hands: [{ p: V3(0.045, 0.78 + br, 0.34), curl: 1.0, roll: 0.9 }, { p: V3(-0.045, 0.78 + br, 0.34), curl: 1.0, roll: -0.9 }], arms: [null, null] };
  };

  // ---------------------------------------------------------------- the field beyond the graveyard
  const FIELD = []; { const Rf = mulberry32(1917);
    for (let n = 0; FIELD.length < field && n < field * 4; n++) { const zz = -36 - Math.pow(Rf(), 0.8) * 112, half = 10 + 0.26 * -zz, x = (Rf() - 0.5) * 2 * half;
      if (FIELD.some(p => (p.x - x) ** 2 + (p.z - zz) ** 2 < 0.62 * 0.62 && Math.abs(p.z - zz) < 1)) continue;
      const d = People.varied(TR[n % 4], 6000 + n); d.c6 = true; d.wear = 0.4; d.hat = true;
      FIELD.push({ id: folk.add(d), x, z: zz, heading: Math.atan2(-x, -zz) * 0.85 + (Rf() - 0.5) * 0.12, t0: Rf() * 20, side: Rf() < 0.8 ? -1 : 1 }); } }
  // ---------------------------------------------------------------- props: the 48's long shovels, loads, clods; the field's spades
  const crowdTools = instancedTool('roundpoint', DIG.length, scene), fieldTools = instancedTool('spade', FIELD.length, scene);
  const earthM = new THREE.MeshStandardMaterial({ color: '#4a3a2a', roughness: 1 });
  const loads = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), earthM, DIG.length); loads.count = 0; loads.castShadow = true; loads.frustumCulled = false;
  const clods = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), earthM, DIG.length * 12); clods.count = 0; clods.castShadow = true; clods.frustumCulled = false;
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.036, 0.1, 16), new THREE.MeshStandardMaterial({ color: '#b8b4aa', roughness: 0.5, metalness: 0.4 })); cup.castShadow = true;
  if (scene) scene.add(loads, clods, cup);
  // v4 (c22): the burial. Earthwork heaps the man's two spits as one smooth cone, which the plant's amber rake turned into a flat orange disc over
  // the sign (the studio, 16 Oct). The earth is now clods: ~150 dark lumps of every size, thrown from his spade at the two lands (TL.land, TL.land2),
  // settling in a rough heap that takes the lettering a part at a time (the first throw the north half and the middle, the second over the rest and the
  // middle's crest), the biggest near the middle and dust-sized at the edges.
  const BUR = []; { const R = mulberry32(1917), [sx, sy, sz] = RIM.sign;
    for (let i = 0; i < 168; i++) { const wave = i < 64 ? 0 : 1, cx = sx + (wave ? 0.03 : -0.06), cz = sz + (wave ? 0.02 : -0.07), a = R() * Math.PI * 2, r = Math.sqrt(R()) * (wave ? 0.3 : 0.24);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r * 0.78, rr = Math.hypot(x - sx, (z - sz) * 1.3), size = (0.014 + R() * R() * 0.05) * (1.15 - Math.min(0.8, rr / 0.36));
      const pile = (wave ? 0.07 : 0.03) * Math.max(0, 1 - rr / 0.3);
      BUR.push({ x, z, y: sy + 0.012 + pile + size * 0.55, size, wave, d: R() * 0.14, rot: [R() * 6, R() * 6, R() * 6], sq: 0.65 + R() * 0.5, tone: R() }); } }
  const burM = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 }), bur = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 1), burM, BUR.length);
  bur.count = 0; bur.castShadow = bur.receiveShadow = true; bur.frustumCulled = false;
  { const c = new THREE.Color(); BUR.forEach((o, i) => bur.setColorAt(i, c.set('#24211d').lerp(c.clone().set('#463f36'), o.tone * o.tone))); bur.instanceColor.needsUpdate = true; }
  if (scene) scene.add(bur);
  const burAt = (t, shot) => {
    bur.count = 0; if (shot !== 'reverse') return;
    const m = RIM.man.dig, from = V3(m[0] + 0.1, 0.55, m[1] + 0.2), e = new THREE.Euler(), p = V3(), q = new THREE.Quaternion(), M4 = new THREE.Matrix4();
    for (let i = 0; i < BUR.length; i++) { const o = BUR[i], tl = (o.wave ? TL.land2 : TL.land) - 0.16 + o.d; if (t < tl) continue;
      const u = Math.min(1, (t - tl) / 0.18), arc = 4 * u * (1 - u) * (0.35 + o.size * 6);
      p.set(from.x + (o.x - from.x) * u, from.y + (o.y - from.y) * u + arc, from.z + (o.z - from.z) * u);
      const sz = o.size * (u < 1 ? 0.8 : 1); q.setFromEuler(e.set(o.rot[0] + 5 * u, o.rot[1] + 4 * u, o.rot[2])); M4.compose(p, q, V3(sz, sz * o.sq, sz)); bur.setMatrixAt(bur.count++, M4); }
    bur.instanceMatrix.needsUpdate = true;
  };

  // ---------------------------------------------------------------- one frame
  const _M = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = V3(), spin = V3(0.3, 1, 0.2).normalize();
  const poser = new Poser(), _walk = new Float32Array(66);
  // the walk's pose blended into the Dig's set over `w` (a st.pose hook: people.js poses the walk, this moves it toward st._mz)
  const blendHook = (out, st) => { const w = st._bw ?? 1, m = st._mz; if (!m) return; for (let i = 0; i < out.length; i++) out[i] += (m[i] - out[i]) * w; };
  const COPY = (out, st) => { if (st._mz) out.set(st._mz); };
  const SHOULDER = { name: 'SHOULDER_TOOL', side: -1, p: 0.5 };          // the walk in: the long shovel on the right shoulder
  function digPose(d, t) {           // a crowd digger at t: hidden, walking, settling into the set, digging
    if (t < d.enter) { folk.set(d.id, { visible: false }); return null; }
    const st = folk.get(d.id);
    if (t < d.arrive) { let s = (t - d.enter) * d.v, n = 0; while (n + 2 < d.path.length && s > d.path[n].distanceTo(d.path[n + 1])) { s -= d.path[n].distanceTo(d.path[n + 1]); n++; }
      const a = d.path[n], b = d.path[n + 1], p = a.clone().lerp(b, clamp(s / Math.max(1e-6, a.distanceTo(b)))), hd = Math.atan2(b.x - a.x, b.z - a.z);
      folk.set(d.id, { visible: true, shadowOnly: false, x: p.x, y: 0, z: p.z, heading: hd, act: 'walk', ph: d.ph0 + (t - d.enter) * 6.4, amt: 1, speed: 1.15, plant: true, pose: null, mix: null, gesture: SHOULDER, t, lift: 0, rig: null });
      return null; }
    const o = d.dig.sample(t), Pz = st._mz || (st._mz = new Float32Array(66)); poser.begin(Pz, st); poser.solve(Pz, o.spec, o.frame);
    const w = sstep(d.arrive, d.arrive + 0.32, t);
    if (w < 1) folk.set(d.id, { visible: true, x: o.frame.pos.x, y: 0, z: o.frame.pos.z, heading: o.frame.heading, act: 'walk', ph: d.ph0 + (d.arrive - d.enter) * 6.4 + (t - d.arrive) * 6.4 * (1 - w), amt: 1 - w, speed: 1.15, plant: true, pose: blendHook, _bw: w, mix: null, gesture: { ...SHOULDER, w: 1 - w }, t, lift: 0, rig: null });
    else folk.set(d.id, { visible: true, x: o.frame.pos.x, y: o.frame.pos.y, z: o.frame.pos.z, heading: o.frame.heading, act: 'stand', plant: false, lift: 0, rig: null, mix: null, gesture: null, look: 0, pose: COPY, t });
    return o;
  }
  // the man's lean (frame 0 to 32.5): feet planted at the head end, both hands on the D of a spade planted at the rim, his face down the lens
  const LEAN_SLIDE = 0.18;                                   // his front hand just under the D, on the shaft's top
  const lean = { base: [M0.lean[0], 0, M0.lean[1]], hd: M0.lean[2], tip: V3(M0.lean[0] + 0.02, -0.13, GRAVE.z - GRAVE.l / 2 - 0.07) };
  lean.D = lean.tip.clone().add(V3(-0.02, 0.97, -0.17).normalize().multiplyScalar(0.99)); lean.M = plantedSpade(lean.tip, lean.D);
  const LENS = V3(...HOOKS[HOOK].p);                        // v4: his eyes go to the hook camera (low in the grave's south end), not the floor's centre
  const toHeroSpec = (S, hp, k, dims) => ({ pelvis: { ...S.pelvis, p: V3(S.pelvis.p.x * k, hp.hip0.y * S.pelvis.p.y / dims.hip, S.pelvis.p.z * k) }, spine: { ...S.spine }, head: S.head,
    feet: S.feet.map(f => f && { p: V3((f.p.x - Math.sin(f.yaw || 0) * 0.06) * k, 0, (f.p.z - Math.cos(f.yaw || 0) * 0.06) * k), yaw: f.yaw || 0, pitch: f.pitch || 0, lift: Math.max(0, f.p.y) * k }) });
  const P0 = new Poser(); P0.begin(new Float32Array(66), null); const DIMS0 = P0.dims();
  function leanSpec(hp, t) {
    const br = 0.008 * Math.sin(t * 1.5);
    const S2 = { pelvis: { p: V3(0, hp.hip0.y - 0.035, -0.07), pitch: 0.22 }, spine: { flex: 0.46 + br }, head: { pitch: 0.5, yaw: 0 },
      feet: [{ p: V3(0.12, 0, 0.0), yaw: 0.08 }, { p: V3(-0.12, 0, -0.06), yaw: -0.1 }], shoulders: { L: 0.08, R: 0.08 } };
    // the head pitched and turned onto the lens from where his eyes are (two passes)
    for (let it = 0; it < 2; it++) { hp.solve(S2); const e = him.joint('head').add(him.joint('neck01')).multiplyScalar(0.5), to = hp.local(LENS).sub(hp.local(e));
      const want = Math.atan2(-to.y, Math.hypot(to.x, to.z)), have = Math.atan2(-(hp.local(him.joint('head')).y - hp.local(him.joint('neck01')).y), 1) * 0;
      S2.head.pitch = clamp(want - 0.22 - (0.46 + br) - have, 0.1, 1.25); S2.head.yaw = clamp(Math.atan2(to.x, to.z), -0.5, 0.5); }
    return S2;
  }
  function manFrame(t) {               // returns the hero's pose source ('lean' | 'turn' | 'dig')
    const T0 = TL.turn, T1 = Math.max(T0 + 0.6, dgM.dig._cyc[0].s + 0.12);    // the lean holds to the turn; he straightens and turns into his set
    const hp = dgM.poser;
    if (t >= T1) { place(him, mBase, M0.dig[2]); dgM.frame(t); dgM.heap.visible = false; return 'dig'; }
    if (t < T0) { place(him, lean.base, lean.hd); const S2 = leanSpec(hp, t); hp.solve(S2); setTool(dgM, lean.M, LEAN_SLIDE, hp); dgM.load.visible = false; dgM.clods.count = 0; return 'lean'; }
    // the turn: the frame swings from the lean's to the Dig's (his feet are under the rim from the floor), the spec and the tool blend
    const u = sstep(T0, T1, t), hd = M0.lean[2] + (M0.dig[2] - M0.lean[2]) * u, b = lean.base.map((v, i) => v + (mBase[i] - v) * u);
    place(him, mBase, M0.dig[2]); const o = dgM.dig.sample(t), A = toHeroSpec(o.spec, hp, him.o.height / 1.76, DIMS0);
    place(him, lean.base, lean.hd); const Lz = leanSpec(hp, T0);
    place(him, b, hd);
    const conv = (p, fromBase, fromHd) => toLocal(V3(p.x, p.y, p.z).applyAxisAngle(V3(0, 1, 0), fromHd).add(V3(fromBase[0], 0, fromBase[2])), [b[0], b[2], hd]);
    const mix = (x, y) => x + (y - x) * u, S2 = { pelvis: { p: conv(Lz.pelvis.p, lean.base, lean.hd).lerp(conv(A.pelvis.p, mBase, M0.dig[2]), u), pitch: mix(Lz.pelvis.pitch, A.pelvis.pitch || 0), yaw: mix(0, A.pelvis.yaw || 0), roll: mix(0, A.pelvis.roll || 0) },
      spine: { flex: mix(Lz.spine.flex, A.spine.flex || 0), twist: mix(0, A.spine.twist || 0), bend: mix(0, A.spine.bend || 0) }, head: { pitch: mix(Lz.head.pitch, (A.head && A.head.pitch) || 0), yaw: mix(Lz.head.yaw, (A.head && A.head.yaw) || 0) },
      feet: [0, 1].map(k => { const f0 = Lz.feet[k], f1 = A.feet[k]; return { p: conv(f0.p, lean.base, lean.hd).lerp(conv(f1.p, mBase, M0.dig[2]), u), yaw: mix(f0.yaw + lean.hd - hd, (f1.yaw || 0) + M0.dig[2] - hd), pitch: mix(0, f1.pitch || 0), lift: 0.06 * Math.sin(Math.PI * clamp(u * 2 - k * 0.6)) }; }) };
    hp.solve(S2);
    const M1 = o.props.shovel.M, pa = V3(), qa = new THREE.Quaternion(), pb = V3(), qb = new THREE.Quaternion(); lean.M.decompose(pa, qa, _s); M1.decompose(pb, qb, _s);
    const Mt = new THREE.Matrix4().compose(pa.lerp(pb, sstep(0.15, 0.85, u)), qa.slerp(qb, sstep(0.15, 0.85, u)), V3(1, 1, 1));
    setTool(dgM, Mt, LEAN_SLIDE + (o.props.shovel.slides[1] - LEAN_SLIDE) * u, hp); dgM.load.visible = false; dgM.clods.count = 0;
    return 'turn';
  }
  // a hero's tool where the scene puts it (not the act): the grips carried by it (makeDig's ToolGrip; the D's grip on its crossbar)
  // (front: the front hand's place down the shaft, m from the D; the rear hand is on the D's crossbar, as makeDig holds a spade)
  function setTool(dg, M, front, hp) {
    dg.tool.matrix.copy(M); dg.tool.matrixWorldNeedsUpdate = true;
    const TD = new THREE.Matrix4().makeTranslation(-0.065, 0, 0).multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2)), Ms = [M, M.clone().multiply(TD)];
    const side = { rear: dg.dig.side > 0 ? 'R' : 'L', front: dg.dig.side > 0 ? 'L' : 'R' }, sl = { [side.rear]: 0.065, [side.front]: front };
    const poles = { L: hp.dirW(V3(1, -0.6, -0.4)), R: hp.dirW(V3(-1, -0.6, -0.4)) };
    dg.grips.forEach((g, i) => g.apply(hp, Ms[i], { slide: sl, poles, free: true }));
  }
  const WOMAN_RIM = t => t < TL.close || t >= TL.fall;     // the woman is on the rim except in the close and the wide (in the trench)

  function pose(t, cam, shot) {
    // the 48
    let nc = 0; const loadM = new THREE.Matrix4(); clods.count = 0;
    for (const d of DIG) {
      d.show = false; d.M = null;
      if ((shot === 'close' || shot === 'wide') && d.closeHide) { folk.set(d.id, { visible: false }); continue; }
      if (shot === 'grave' || shot === 'reverse') { folk.set(d.id, { visible: false }); continue; }      // under the rim from the floor; out of the reverse
      const o = digPose(d, t); d.show = t >= d.enter; d.w = sstep(d.arrive, d.arrive + 0.32, t); if (!o) continue;
      const sh = o.props.shovel; d.M = sh.M;
      if (sh.loaded && o.kg > 0) { const r = Math.cbrt(o.kg / 1450 * 1.25 / (2 / 3 * Math.PI * 0.4)); loadM.compose(sh.load, _q.identity(), V3(r, r * 0.4, r)); loads.setMatrixAt(nc++, loadM); }
      for (const c of Dig.clods(d.dig.eventsIn(t - 4, t + 1), t, { n: 4, keep: 0.8 })) { if (clods.count >= DIG.length * 12) break; _M.compose(c.p, _q.setFromAxisAngle(spin, c.i * 1.7 + 6 * c.s), V3(c.r, c.r * 0.8, c.r)); clods.setMatrixAt(clods.count++, _M); }
    }
    loads.count = nc; loads.instanceMatrix.needsUpdate = true; clods.instanceMatrix.needsUpdate = true;
    burAt(t, shot);
    // the rim crew (people.js), still but breathing
    for (const o of RIMP) { o.rep = C.apply(o.id, o.frame, rimSpec(o, t), t); folk.set(o.id, { visible: true }); }
    // the field: from the close on, standing with a spade on the shoulder, facing the grave
    for (const p of FIELD) { if (t < TL.close || !(shot === 'close' || shot === 'wide')) { folk.set(p.id, { visible: false }); continue; }
      folk.set(p.id, { visible: true, x: p.x, y: 0, z: p.z, heading: p.heading, act: 'stand', t: t + p.t0, gesture: { name: 'SHOULDER_TOOL', side: p.side, p: 0.5 }, pose: null, plant: true, mix: null, rig: null }); }
    // the heroes
    const out = { man: manFrame(t) };
    const herRim = WOMAN_RIM(t);
    if (herRim) { place(her, wBase, wR[2]); dgWR.frame(t); dgWR.heap.visible = false; } else { place(her, hClose.her, Math.PI); dgWT.frame(t); dgWT.heap.visible = false; }
    dgWR.setVisible(herRim); dgWT.setVisible(!herRim);
    const welderOn = t >= TL.close && t < TL.fall; welder.group.visible = welderOn; dgWe.setVisible(welderOn); if (welderOn) { place(welder, hClose.welder, Math.PI); dgWe.frame(t); dgWe.heap.visible = false; }
    // his spit's clods only from the cut to the reverse (the release is a beat before it: no earth comes at the lens)
    if (t < TL.sign) dgM.clods.count = 0;
    out.herRim = herRim; out.welderOn = welderOn;
    return out;
  }
  // after folk.update(camera): what is carried (the field's spades, the cup)
  const shoulderM = (id, side, back, out) => { const at = folk.att[id], g = folk.gripPos(id, side), sh = at.arm[side > 0 ? 0 : 1].S.clone().add(V3(0, 0.07, 0)), y = sh.sub(g).normalize(),
    x = V3().crossVectors(y, V3(0, 1, 0)).normalize(), z = V3().crossVectors(x, y); return out.makeBasis(x, y, z).setPosition(g.clone().addScaledVector(y, -back)); };
  const _A = new THREE.Matrix4(), pa = V3(), qa = new THREE.Quaternion(), pb = V3(), qb = new THREE.Quaternion();
  function after(t) {
    let n = 0, nl = 0;
    for (const d of DIG) { if (!d.show || !folk.att[d.id]) continue;
      if (d.w >= 1 && d.M) { crowdTools.set(nl++, d.M); continue; }
      shoulderM(d.id, -1, 0.42, _A); if (d.M && d.w > 0) { _A.decompose(pa, qa, _s); d.M.decompose(pb, qb, _s); _A.compose(pa.lerp(pb, d.w), qa.slerp(qb, d.w), V3(1, 1, 1)); }
      crowdTools.set(nl++, _A); }
    crowdTools.done(nl);
    for (const p of FIELD) { const st = folk.get(p.id); if (!st.visible || !folk.att[p.id]) continue; fieldTools.set(n++, shoulderM(p.id, p.side, 0.16, _M)); }
    fieldTools.done(n);
    const cu = RIMP.find(o => o.key === 'cup'), a = folk.gripPos(cu.id, 1), b = folk.gripPos(cu.id, -1); cup.position.copy(a).lerp(b, 0.5).add(V3(0, 0.02, 0)); cup.visible = folk.get(cu.id).visible;
  }
  // what the score reads (assets/gravediggers/calls.json): the call times, the isolation bites by quarter, the trench's depth, the land
  function callsJSON() {
    const groups = [[], [], [], []]; for (const d of DIG) if (d.iso != null) groups[d.quarter].push(+d.iso.toFixed(4));
    const depth = []; for (let t = TL.join; t <= TL.brk + 1e-6; t += 0.125) { const a = ew.depth(trUS, t), b = ew.depth(trCA, t); depth.push([+t.toFixed(3), +((a.mean + b.mean) / 2).toFixed(4), +Math.max(a.max, b.max).toFixed(4)]); }
    const calls = [...CALLS, ...STRIKES].map(t => +t.toFixed(3));
    return { calls, groups: groups.map(g => g.sort((a, b) => a - b)), depth, land: +dgM.dig.plan(0).tLand.toFixed(4), land2: +dgM.dig.plan(1).tLand.toFixed(4), source: 'scene',
      note: 'written from the scene (scenes/gravediggers.crew.js) by tools/gravediggers_calls.mjs: calls 0.16 s before each downbeat the crew answers (15.0-22.5) and the unanswered calls; groups: the free bites on arrival (11.25-15.0), by quarter of the 48; depth: ew.depth of the two trench paths (mean of the means, max)' };
  }
  return { folk, C, ew, cuts: { grave, notch, link, trUS, trCA, sumpA, sumpB, pUS, pCA }, joins: J, DIG, FIELD, RIMP, heroes: { him, her, welder },
    digs: { man: dgM, womanRim: dgWR, womanTrench: dgWT, welder: dgWe }, mCall, wCalls, lean, LENS, hClose, props: { crowdTools, fieldTools, loads, clods, cup, rimTools, bur },
    pose, after, callsJSON, WOMAN_RIM };
}
