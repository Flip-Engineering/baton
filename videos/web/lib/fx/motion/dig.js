// The dig as a hero act (MOTION, 8 Oct 2026), on the pattern of makeSledge: Dig (labour.js) plans and solves the cycle on the people.js
// proportions, HeroPoser puts that spec on a hero.js body, the HandRig plans the grips once (ToolGrip) and the shovel carries them: the
// front hand on the shaft (it slides where the act slides it: down toward the load, both hands up it for a choke), the rear hand on the
// long shovel's shaft or, through the spade's D, on its crossbar; each hand may turn about what it holds (ToolGrip's free: the turn that
// lines the hand up with the forearm), so the shaft's swing from upright to level does not all land in the wrists.
// The earth: the spit on the blade from the pry to the release (a heaped lump on the face, sized by its kg), then the throw as clods
// (Dig.clods: closed-form lobs, pure in t) that carry on from the release point, and the spoil heap at the landing growing by what has
// landed (Dig.ledger, Dig.heap: a cone at the angle of repose); so a render begun part-way is exact. The grave (the pit) is the scene's.
//   const dg = makeDig(THREE, scene, hero, { tool: 'spade', pit: 1.2, seed: 7 });   // hero placed first (group position = where it stands:
//                                                                                    // the pit floor; rotation.y = its heading)
//   options: tool ('spade' | 'roundpoint'), seed, lead, drive, pit, edge, period, calls, kg, fatigue, cycles, bodyKg, react, t0, depth (as
//     Dig), throwTo and cut in the hero's own frame (metres, x its left, z its front, from where it stands; Dig takes them in its units),
//     clodsPer, spoil0 (m3 already on the heap)
//   dg.frame(t)  -> poses hero + shovel + load + clods + heap for time t (s); returns { phase, therblig, effort, k, u, bite (1 at the
//                   blade's entry, 0 by 0.15 s), clod (the load in flight, world), act (the full sample) }
//   dg.tool (the shovel, a Group whose matrix is set each frame), dg.load (the spit on the blade), dg.clods (InstancedMesh), dg.heap (the
//   spoil cone), dg.dig (the act: events, eventsIn, plan), dg.stats.handMiss (mm, running max), dg.stats.wristDeg { L, R } (the wrists'
//   bend, running max: forearm against hand, about 5 at rest), dg.setVisible(v)
//   shovelModel(THREE, 'roundpoint' | 'spade')  the tool alone, in its own frame (origin at the handle's end, +y to the blade, +z its
//                   face, world metres): for people.js scenes, set its matrix from dig.sample(t).props.shovel.M (and draw the load at
//                   props.shovel.load while props.shovel.loaded, the clods from Dig.clods(dig.events, t))
import { HeroPoser, ToolGrip } from './hero_poser.js';
import { Poser } from './poser.js';
import { Dig, SHOVELS } from './labour.js';
import { cylinder, union } from '../rig/sdf.js';

// the spade's D: a crossbar 2 DW long (an 11 cm opening between the stiles: a hand's breadth and a little), its stiles running from its
// ends to the shaft DY up, where the shaft begins
const DW = 0.065, DY = 0.137, DR = 0.016, DS = 0.012, dStile = s => [[s * DW, 0], [s * 0.012, DY]];
// an ash shaft (with a D-grip for the spade, a turned end for the long shovel), a pressed-steel socket and a dished blade: round-pointed
// and cranked toward its face (the long shovel), or square with a tread turned over its heel (the spade)
export function shovelModel(THREE, tool = 'spade') {
  const W = SHOVELS[tool], V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), g = new THREE.Group();
  const ash = new THREE.MeshStandardMaterial({ color: '#b08a58', roughness: 0.62 }), steel = new THREE.MeshStandardMaterial({ color: '#3b3d40', roughness: 0.5, metalness: 0.85, side: THREE.DoubleSide });
  const add = (geo, m, p, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.copy(p); o.rotation.z = rz; g.add(o); return o; };
  const y0 = W.grip === 'D' ? DY : 0;                                                // the shaft starts where the D's stiles meet it: the D is open for the hand
  add(new THREE.CylinderGeometry(W.r, W.r * 1.08, W.Ls - 0.1 - y0, 12), ash, V(0, (y0 + W.Ls - 0.1) / 2, 0));        // the shaft (its last 10 cm in the socket)
  if (W.grip === 'D') { add(new THREE.CylinderGeometry(DR, DR, 2 * DW, 10), ash, V(0, 0, 0), Math.PI / 2);              // the D: a crossbar the hand closes on (the origin)
    for (const s of [-1, 1]) { const [[x0, y0s], [x1, y1]] = dStile(s); add(new THREE.CylinderGeometry(DS * 0.92, DS, Math.hypot(x1 - x0, y1 - y0s), 8), ash, V((x0 + x1) / 2, (y0s + y1) / 2, 0), Math.atan2(x0 - x1, y1 - y0s)); } }   // and two stiles splitting from the shaft
  else add(new THREE.SphereGeometry(W.r * 1.2, 12, 8), ash, V(0, 0.004, 0));                                          // a turned end
  add(new THREE.CylinderGeometry(W.r * 1.15, W.r * 1.7, 0.14, 12), steel, V(0, W.Ls - 0.07, 0));                      // the socket
  // the blade in the tool's frame: heel at the socket (y = Ls), along b = (0, cos cant, sin cant), x across, dished toward its face zf
  const b = V(0, Math.cos(W.cant), Math.sin(W.cant)), zf = V(0, -Math.sin(W.cant), Math.cos(W.cant)), nv = 12, nw = 8, pos = [], idx = [];
  const half = v => W.grip === 'D' ? 1 - 0.06 * v : v < 0.45 ? 1 - 0.05 * v : Math.pow(Math.max(0, Math.cos((v - 0.45) / 0.55 * Math.PI / 2)), 0.7);
  for (let i = 0; i <= nv; i++) for (let j = 0; j <= nw; j++) { const v = i / nv, w = j / nw * 2 - 1, p = V(0, W.Ls, 0).addScaledVector(b, v * W.bl).addScaledVector(zf, W.dish * w * w); pos.push(w * half(v) * W.bw / 2, p.y, p.z); }
  for (let i = 0; i < nv; i++) for (let j = 0; j < nw; j++) { const a = i * (nw + 1) + j, c = a + nw + 1; idx.push(a, c, a + 1, a + 1, c, c + 1); }
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); bg.setIndex(idx); bg.computeVertexNormals(); g.add(new THREE.Mesh(bg, steel));
  if (W.grip === 'D') add(new THREE.BoxGeometry(W.bw * 0.94, 0.005, 0.024), steel, V(0, W.Ls + 0.004, -0.012));      // the tread, turned back over the heel
  g.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  return g;
}

export function makeDig(THREE, scene, h, { tool = 'spade', seed = 1, lead = 'R', drive, pit = 0, edge, period, calls, throwTo, cut, kg, fatigue, cycles, bodyKg = 78, clodsPer = 6, spoil0 = 0, ...rest } = {}) {
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), hp = new HeroPoser(h), P0 = new Poser(); P0.begin(new Float32Array(66), null);
  const dims = P0.dims(), k = h.o.height / 1.76;                                       // the Poser's figure stands 1.76 m: its local metres times k are this hero's
  const dig = new Dig({ ...rest, seed, dims, sc: k, bodyKg, base: h.group.position.clone(), heading: h.group.rotation.y, tool, lead, drive, pit, edge, period, calls, kg, fatigue, cycles,
    throwTo: throwTo && throwTo.clone().multiplyScalar(1 / k), cut: cut && cut.clone().multiplyScalar(1 / k) });   // the hero's metres -> the act's units
  const W = SHOVELS[dig.tool], side = { rear: dig.side > 0 ? 'R' : 'L', front: dig.side > 0 ? 'L' : 'R' }, D = W.grip === 'D';
  const tool3 = shovelModel(THREE, dig.tool); tool3.matrixAutoUpdate = false; scene.add(tool3);
  const earth = new THREE.MeshStandardMaterial({ color: '#4a3a2a', roughness: 0.95 });
  // the spit on the blade: a heaped dome on the face (its base the blade's, its height the volume of kg of loose earth), set in the tool's frame
  const load = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), earth); load.matrixAutoUpdate = false; load.castShadow = load.receiveShadow = true; load.visible = false; scene.add(load);
  const bl = V(0, Math.cos(W.cant), Math.sin(W.cant)), nf = V(0, -Math.sin(W.cant), Math.cos(W.cant)), onFace = V(0, W.Ls, 0).addScaledVector(bl, W.bl * 0.5).addScaledVector(nf, W.dish * 0.5);
  const lumpM = kgL => { const a = W.bw * 0.42, c = W.bl * 0.4, ht = Math.min(0.16, kgL / 1450 / (2 / 3 * Math.PI * a * c)); return new THREE.Matrix4().makeBasis(V(a, 0, 0), nf.clone().multiplyScalar(ht), bl.clone().multiplyScalar(c)).setPosition(onFace); };
  // the earth in flight: Dig.clods of the act's own events (world, closed form); the heap where they land
  const clods = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), earth, 64);
  clods.count = 0; clods.castShadow = true; clods.frustumCulled = false; scene.add(clods);
  const heap = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 28, 1), earth), heapAt = Poser.l2w(dig.frame, dig.heap); heap.castShadow = heap.receiveShadow = true; heap.visible = false; scene.add(heap);
  // the act's spec on this body: positions scaled by k, the pelvis at the same fraction of its own hip height, each sole's mid point
  // (6 cm ahead of the people.js ankle) back to an ankle, a sole above the ground (the tread under the boot) as a lift
  const toHero = S => ({ pelvis: { ...S.pelvis, p: V(S.pelvis.p.x * k, hp.hip0.y * S.pelvis.p.y / dims.hip, S.pelvis.p.z * k) }, spine: { ...S.spine }, head: S.head,
    feet: S.feet.map(f => f && { p: V((f.p.x - Math.sin(f.yaw || 0) * 0.06) * k, 0, (f.p.z - Math.cos(f.yaw || 0) * 0.06) * k), yaw: f.yaw || 0, pitch: f.pitch || 0, lift: Math.max(0, f.p.y) * k }) });
  // grips: planned once on a reference pose (the shovel across the front at the belt, down toward the lead side), then carried in its
  // frame. The spade's rear hand goes through the D onto its crossbar (a handle along the tool's x at the origin: TD turns the grip's
  // +y onto it), palm on the end side, bearing down the shaft; every other grip is on the shaft
  h.update(); hp.solve({ pelvis: { p: hp.hip0.clone() }, feet: [{ p: V(0.12, 0, 0) }, { p: V(-0.12, 0, 0) }] });
  const y0 = hp.dirW(V(dig.side * 0.6, -0.4, 0.7).normalize()), z0 = V(0, 1, 0).addScaledVector(y0, -y0.y).normalize();
  const T0 = new THREE.Matrix4().makeBasis(V().crossVectors(y0, z0), y0, z0).setPosition(hp.world(V(-dig.side * 0.15, hp.hip0.y + 0.08, 0.2)));
  const TD = new THREE.Matrix4().makeTranslation(-DW, 0, 0).multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2)), tw = (x, y) => V(x, y, 0).applyMatrix4(T0);
  const dObj = () => union(cylinder(tw(-DW, 0), tw(DW, 0), DR), ...[-1, 1].map(s => { const [[x0, y0s], [x1, y1]] = dStile(s); return cylinder(tw(x0, y0s), tw(x1, y1), DS); }));   // the fingers close on the bar, short of the stiles
  const grips = D ? [new ToolGrip(h, [{ side: side.front, u: Math.min(W.slide[0], 0.24) }], { L: W.Ls, r: W.r }, T0), new ToolGrip(h, [{ side: side.rear, u: DW, prefer: y0.clone().negate(), preferW: 1.5, obj: dObj(), roll: 0.3 }], { L: 2 * DW, r: DR }, T0.clone().multiply(TD))]
    : [new ToolGrip(h, [{ side: side.rear, u: W.rear }, { side: side.front, u: Math.min(W.slide[0], 0.24) }], { L: W.Ls, r: W.r }, T0)];   // planned near the body; the act slides it
  const frames = M => D ? [M, M.clone().multiply(TD)] : [M];
  const stats = { handMiss: 0, wristDeg: { L: 0, R: 0 } }, m4 = new THREE.Matrix4(), qI = new THREE.Quaternion(), spin = V(0.3, 1, 0.2).normalize();
  function frame(t) {
    const o = dig.sample(t), S = toHero(o.spec), sh = o.props.shovel;
    // the shoulders come up with the hands above them (as makeSledge)
    const shY = hp.hip0.y + (dims.shoulderH - dims.hip) * k, hy = s => hp.local(sh.grips[s === side.rear ? 0 : 1]).y;
    S.shoulders = { L: 0.3 * Math.max(0, Math.min(1, (hy('L') - shY) / 0.45)), R: 0.3 * Math.max(0, Math.min(1, (hy('R') - shY) / 0.45)) };
    hp.solve(S); tool3.matrix.copy(sh.M); tool3.matrixWorldNeedsUpdate = true;
    const slide = { [side.rear]: D ? DW : sh.slides[0], [side.front]: sh.slides[1] }, Ms = frames(sh.M);
    // reach: where a grip is out of this body's reach the body goes to it (pelvis toward the hands, feet planted), never the hands off the shaft
    for (let it = 0; it < 5; it++) { const tg = Object.assign({}, ...grips.map((g, i) => g.targets(Ms[i], slide))); let dx = V(), over = 0;
      for (const s of ['L', 'R']) { const S0 = h.joint(`upperarm01.${s}`), v = tg[s].p.clone().sub(S0), e = v.length() - hp.armLen * 0.97; if (e > 0) { dx.addScaledVector(v.normalize(), e); over = Math.max(over, e); } }
      if (over < 0.004) break; const dl = hp.local(dx.add(h.group.position)); S.pelvis.p.x += dl.x * 0.9; S.pelvis.p.z += dl.z * 0.9; S.pelvis.p.y += Math.min(0, dl.y) * 0.6; S.spine.flex = (S.spine.flex || 0) + Math.max(0, -dl.y) * 0.4; hp.solve(S); }
    const poles = { L: hp.dirW(V(1, -0.6, -0.4)), R: hp.dirW(V(-1, -0.6, -0.4)) };
    grips.forEach((g, i) => { const miss = g.apply(hp, Ms[i], { slide, poles, free: true }); for (const s in miss) { stats.handMiss = Math.max(stats.handMiss, miss[s]); stats.wristDeg[s] = Math.max(stats.wristDeg[s], g.wristDeg[s]); } });
    // the spit on the blade while it is there; at the release it goes on as the clods
    load.visible = sh.loaded && o.kg > 0; if (load.visible) { load.matrix.multiplyMatrices(sh.M, lumpM(o.kg)); load.matrixWorldNeedsUpdate = true; }
    // the thrown earth: every clod of the releases in the last few seconds, in flight (turning with its time in the air) or lying where it fell
    const C = Dig.clods(dig.eventsIn(t - 6, t + 4), t, { n: clodsPer }); clods.count = Math.min(C.length, 64);
    for (let i = 0; i < clods.count; i++) { m4.compose(C[i].p, qI.setFromAxisAngle(spin, C[i].i * 1.7 + 6 * C[i].s), V(C[i].r, C[i].r * 0.8, C[i].r)); clods.setMatrixAt(i, m4); }
    clods.instanceMatrix.needsUpdate = true;
    // the spoil heap: what has landed by t, a cone at its angle of repose standing at the landing
    const hc = Dig.heap(Dig.ledger(dig.allEvents, t).m3 + spoil0); heap.visible = hc.r > 0.01; heap.scale.set(hc.r, hc.h, hc.r); heap.position.set(heapAt.x, heapAt.y + hc.h / 2, heapAt.z);
    const bt = dig.plan(o.k).tBite, bite = Math.max(0, 1 - Math.abs(t - bt) / 0.15) * (t >= bt ? 1 : 0);
    return { phase: o.phase, therblig: o.therblig, effort: o.effort, k: o.k, u: o.u, bite, clod: o.props.clod, act: o };
  }
  const setVisible = v => { tool3.visible = clods.visible = v; if (!v) load.visible = heap.visible = false; };
  return { frame, tool: tool3, load, clods, heap, dig, grips, setVisible, stats, poser: hp };
}
