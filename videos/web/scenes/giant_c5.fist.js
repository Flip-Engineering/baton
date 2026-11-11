// THE GIANT c9: the gloved fists. RIG c1's HandRig on hero.js (real ANSUR bodies, work gloves) closing on a hoist line, lit by
// the deck floods. Replaces v1's people.js "black mitten raised in empty air": here the glove has knuckles, a thumb, a
// wrist and something to hold, and it closes on the hit (u 0 -> 1 over 0.3 s) then hauls the line down.
//
//   const F = await makeFist({ THREE, scene, atm, x, y, z, seed });   // the worker stands on the deck at (x, y, z)
//   F.pose(u, haul)   // u: closure 0..1 (staggered, thumb last); haul: m the hands have hauled down the line
//   F.show(bool);  F.anchors() -> { R, L, head, line }  (world points for the camera)
import { loadHeroData, Hero } from '../lib/fx/hero.js';
import { HandRig } from '../lib/fx/rig/hand.js';
import { cylinder } from '../lib/fx/rig/sdf.js';
import { loadAnsur, sampleBody, heroOptions, applyBody, mulberry32 } from '../lib/fx/rig/body.js';

export async function makeFist({ THREE, scene, atm, x = 0, y = 0, z = 0, yaw = 0, seed = 5, shirt = '#4a3e2c', glove = '#4e3a26', hat = 'hard' }) {   // asset round: worn split-leather work gloves (the old brown read as bare skin beside the sleeve)
  const V = (a = 0, b = 0, c = 0) => new THREE.Vector3(a, b, c);
  const data = await loadHeroData(), A = await loadAnsur();
  const body = sampleBody(A, mulberry32(seed), { sex: 'm', stature: [1.68, 1.78], build: 'stocky', age: [38, 56] });
  const worker = new Hero(data, { ...heroOptions(body, { outfit: 'coat', seed: 30 + seed, hat }), shirt, shirt2: '#2c2418', trousers: '#2a2620', gloves: true, gloveColor: glove,
    skin: '#8a5c40', hair: '#1c1410', hatColor: '#c8a020', dirt: 0.55, boots: '#1e150c',
    wear: 0.65, folds: 0.9, sweat: 0.3 });   // asset round (4 Oct): HUMAN c6's surface layer (worn leather, cloth folds at the joints, sweat), off until now
  applyBody(worker, body);
  // c20 (15 Oct): v7 showed these hands bare (pale skin, light nail tips) though the glove shell is built and skinned to the hand (node check:
  // 6552 triangles, ~3 mm off the skin after the grip). In the close-ups the skin still won through it. The shell is stood further off the
  // skin (+3 mm along its own normals, 6-7 mm in all, a split-leather work glove's real thickness) so the hand underneath can't show.
  { const g = worker.cloth.gloves && worker.cloth.gloves.geometry;
    if (g && g.attributes.normal) { const P = g.attributes.position, N = g.attributes.normal;
      for (let i = 0; i < P.count; i++) P.setXYZ(i, P.getX(i) + N.getX(i) * 0.003, P.getY(i) + N.getY(i) * 0.003, P.getZ(i) + N.getZ(i) * 0.003);
      P.needsUpdate = true; g.computeBoundingSphere(); } }
  const root = new THREE.Group(); root.position.set(x, y, z); root.rotation.y = yaw; root.add(worker.group); scene.add(root);
  worker.group.position.set(0, 0, 0);
  root.updateMatrixWorld(true); worker.update();
  worker.meshes.forEach(m => { m.layers.enable(atm.maskLayer); m.frustumCulled = false; });
  // the hoist line: a vertical rope from the snatch block above, hanging in front of the worker's chest (a few cm out of the body plane)
  const F0 = worker._body();          // facing (horizontal), up, out-to-the-left, origin under the feet
  const SR = worker.joint('upperarm01.R'), SL = worker.joint('upperarm01.L');
  const chestY = (SR.y + SL.y) / 2, ropeR = 0.021;
  const centre = SR.clone().add(SL).multiplyScalar(0.5).addScaledVector(F0.fwd, 0.36);
  centre.y = chestY - 0.05;
  // a slight lean of the rope: it runs up and away toward the block (out along the facing direction)
  const lean = F0.fwd.clone().multiplyScalar(0.10);
  const a = centre.clone().add(V(0, -1.4, 0)).addScaledVector(lean, -1.4), b = centre.clone().add(V(0, 3.2, 0)).addScaledVector(lean, 3.2);
  const rope = cylinder(a, b, ropeR);
  // asset round (4 Oct): a laid rope, three strands twisted round the axis (it was a smooth rod), built along +y then aimed like the old cylinder
  const ropeMesh = (() => { const L = b.distanceTo(a), grp = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: '#3a2c1c', roughness: 0.92, metalness: 0 });
    for (let k = 0; k < 3; k++) { const pts = []; for (let i = 0; i <= 400; i++) { const y = -L / 2 + L * i / 400, ang = y / 0.085 * Math.PI * 2 + k * Math.PI * 2 / 3;
        pts.push(V(Math.cos(ang) * ropeR * 0.52, y, Math.sin(ang) * ropeR * 0.52)); }
      grp.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 400, ropeR * 0.55, 8, false), mat)); }
    grp.traverse(o => o.layers && o.layers.enable(atm.maskLayer)); return grp; })();
  ropeMesh.position.copy(a.clone().add(b).multiplyScalar(0.5)); ropeMesh.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize()); ropeMesh.layers.enable(atm.maskLayer); scene.add(ropeMesh);
  const axis = rope.axis.clone();
  const hands = {};
  worker.resetPose(); worker.update();
  for (const [side, up] of [['R', -0.08], ['L', 0.30]]) {
    const hand = new HandRig(worker, side, { skin: 0.0065 * worker.scale });   // c20: the thicker glove
    const sg = side === 'L' ? 1 : -1;
    const at = centre.clone().addScaledVector(axis, up);
    const approach = F0.xL.clone().multiplyScalar(sg).addScaledVector(F0.fwd, -0.25).normalize();   // from the rope toward the palm: sideways (the palm faces the midline, thumb up), a little back at the worker
    const pole = V(sg * 0.3, -1, -0.3);
    const G = hand.planBest({ grip: 'power', obj: rope, at, axis, approach, r: ropeR, pole }, { poseOpts: { pole, lean: false } });
    hand.settle(G); hand.fit(G);
    { const m = hand.measure(rope, G); console.log('fist fit', side, 'wrap', G.wrapSign, 'gap', m.maxGapMm.toFixed(1), 'pen', m.maxPenMm.toFixed(1), 'contacts', m.contacts, 'wrist', (G.state.wristAngle * 57.3).toFixed(0), 'miss', (G.state.reachMiss * 1000).toFixed(0)); }
    hands[side] = { hand, G, armQ: hand.snap(), wrist0: G.wristPt.clone(), R0: G.R.clone() };
  }
  const st = { u: 0, haul: 0 };
  function pose(u, haul = 0) {
    st.u = u; st.haul = haul;
    worker.resetPose(); worker.update();
    for (const side of ['R', 'L']) {
      const h = hands[side], approach = (1 - Math.min(1, u * 2.2)) * 0.09;   // the hand comes in over the first 40% of the closure
      h.hand.restore(h.armQ);
      const wp = h.wrist0.clone().addScaledVector(V(0, -1, 0), haul).addScaledVector(F0.fwd, approach).addScaledVector(F0.up, approach * 0.6);
      h.hand.place(h.G, wp, h.R0, { pole: h.G.pole, lean: false });
      h.hand.pose(h.G, u);
    }
    worker.update();
  }
  pose(1, 0);
  return { worker, root, ropeMesh, pose, hands, body,
    show(v) { root.visible = v; ropeMesh.visible = v; },
    anchors() { return { R: hands.R.hand.h.joint('wrist.R'), L: hands.L.hand.h.joint('wrist.L'), head: worker.joint('head'), line: centre.clone(), fwd: F0.fwd.clone(), left: F0.xL.clone(), up: F0.up.clone() }; } };
}
