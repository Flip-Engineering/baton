// The sledge blow as a reusable act (MECHA c4, 3 Oct; extracted from labs/human7/lab_sledge.js, HUMAN c7, which stays the reference).
// Measured from Muybridge plate 376: square wide stance, the sledge up over the right shoulder, the trunk dropping into the blow with the
// hands meeting the anvil at the body's lowest, the head swinging low past the right thigh and back up. HeroPoser drives the body, the
// HandRig plans the grips once (ToolGrip) and the tool carries them. Each blow draws its own depth, lean and timing.
//   const sl = makeSledge(THREE, scene, hero, { TB: 1.9 });   // hero placed first (group position, rotation.y): the anvil follows it
//   sl.frame(t)                                                // pose hero + tool for time t (s); returns { u, c, strike } (strike 0..1 at impact)
import { HeroPoser, ToolGrip } from './hero_poser.js';
import { PLATE_376, fitPlate } from './plates.js';
import { hash } from './poser.js';

export function makeSledge(THREE, scene, h, { TB = 1.9, KZ = 0.86, anvilYaw = 0.35, period0 = 0 } = {}) {
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const hp = new HeroPoser(h), k = h.o.height / PLATE_376.statureM;
  const KEYS = fitPlate(PLATE_376), ORDER = [5, 6, 7, 8, 9, 10, 11, 0, 1, 2, 3, 4], UK = [0, 0.06, 0.13, 0.22, 0.30, 0.38, 0.46, 0.56, 0.66, 0.75, 0.84, 0.92];
  const hip0 = 0.885;
  const cr = (p0, p1, p2, p3, t) => { const t2 = t * t, t3 = t2 * t; return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3); };
  function key(u) { u = ((u % 1) + 1) % 1; let j = UK.length - 1; for (let i = 0; i < UK.length; i++) if (UK[i] <= u) j = i;
    const u0 = UK[j], u1 = j + 1 < UK.length ? UK[j + 1] : 1, w = (u - u0) / (u1 - u0), g = i => KEYS[ORDER[((i % 12) + 12) % 12]];
    const a = g(j - 1), b = g(j), c = g(j + 1), d = g(j + 2), s = f => cr(f(a), f(b), f(c), f(d), w), v = f => V(s(p => f(p).x), s(p => f(p).y), s(p => f(p).z));
    const sz = q => q.setZ(q.z * KZ); return { pitch: s(p => p.pitch), lean: s(p => p.lean), pelvis: v(p => p.pelvis), hands: sz(v(p => p.hands)), head: sz(v(p => p.head)), shoulder: sz(v(p => p.shoulder)) }; }
  // the anvil on its stump, under the head at the blow (in the hero's frame)
  const anvilTop = key(0).head.clone().multiplyScalar(k); anvilTop.y -= 0.045;
  const anvil = new THREE.Group();
  { const steel = new THREE.MeshStandardMaterial({ color: '#2c2d2f', roughness: 0.42, metalness: 0.85 }), wood = new THREE.MeshStandardMaterial({ color: '#5a4630', roughness: 0.9 }), face = new THREE.MeshStandardMaterial({ color: '#8c8c88', roughness: 0.22, metalness: 1 });
    const add = (geo, m, p, r) => { const o = new THREE.Mesh(geo, m); o.position.copy(p); if (r) o.rotation.set(...r); o.castShadow = o.receiveShadow = true; anvil.add(o); return o; };
    const yT = anvilTop.y, blockH = yT - 0.3;
    add(new THREE.CylinderGeometry(0.24, 0.27, blockH, 20), wood, V(0, blockH / 2, 0));
    add(new THREE.BoxGeometry(0.2, 0.08, 0.34), steel, V(0, blockH + 0.04, 0));
    add(new THREE.BoxGeometry(0.11, 0.13, 0.22), steel, V(0, blockH + 0.145, 0));
    add(new THREE.BoxGeometry(0.13, 0.07, 0.42), steel, V(0, yT - 0.035, -0.02));
    add(new THREE.BoxGeometry(0.125, 0.004, 0.36), face, V(0, yT + 0.001, -0.03));
    add(new THREE.ConeGeometry(0.055, 0.22, 16), steel, V(0, yT - 0.03, 0.29), [Math.PI / 2, 0, 0]);
    const p = hp.world(V(anvilTop.x, 0, anvilTop.z)); anvil.position.copy(p); anvil.rotation.y = h.group.rotation.y + anvilYaw; scene.add(anvil); }
  // the sledge: 36-inch hickory handle, forged octagonal head (10 lb)
  const tool = new THREE.Group();
  { const hick = new THREE.MeshStandardMaterial({ color: '#a8824e', roughness: 0.6 }), forg = new THREE.MeshStandardMaterial({ color: '#303133', roughness: 0.5, metalness: 0.85 }), bright = new THREE.MeshStandardMaterial({ color: '#9a9a96', roughness: 0.2, metalness: 1 });
    const hl = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.019, 0.9, 12), hick); hl.position.y = 0.45; tool.add(hl);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.021, 12, 8), hick); knob.scale.y = 0.6; tool.add(knob);
    const L = 0.17, r = 0.034, prof = [V(0, -L / 2), V(r * 0.72, -L / 2), V(r, -L / 2 + 0.011), V(r, L / 2 - 0.011), V(r * 0.72, L / 2), V(0, L / 2)].map(p => new THREE.Vector2(p.x, p.y));
    const head = new THREE.Mesh(new THREE.LatheGeometry(prof, 8), forg); head.rotation.z = Math.PI / 2; head.position.y = 0.86; tool.add(head);
    for (const s of [-1, 1]) { const f = new THREE.Mesh(new THREE.CircleGeometry(r * 0.72, 8), bright); f.position.set(s * (L / 2 + 0.0005), 0.86, 0); f.rotation.y = s * Math.PI / 2; tool.add(f); }
    const wedge = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.004, 0.03), bright); wedge.position.y = 0.86 + r; tool.add(wedge);
    tool.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; }); tool.matrixAutoUpdate = false; scene.add(tool); }
  const HANDS_U = 0.12;
  function toolMatrix(hands, head, vel) { const y = head.clone().sub(hands).normalize(), o = hands.clone().addScaledVector(y, -HANDS_U);
    let x = vel.clone().addScaledVector(y, -vel.dot(y)); if (x.lengthSq() < 1e-8) x = V(1, 0, 0).addScaledVector(y, -y.x); x.normalize(); const z = V().crossVectors(x, y).normalize();
    return new THREE.Matrix4().makeBasis(x, y, z).setPosition(o); }
  const feet = () => [{ p: V(0.36 * k, 0, 0.0), yaw: 0.32 }, { p: V(-0.36 * k, 0, -0.02), yaw: -0.3 }];
  function act(t) { const c = Math.floor(t / TB) + period0, u = t / TB - Math.floor(t / TB), j = a => (hash(c * 31 + a, 7) - 0.5) * 2;
    const kp = key(u), kd = key(u + 0.004), dep = 1 + 0.07 * j(1), ln = 1 + 0.12 * j(2), near = Math.min(u, 1 - u) < 0.08 ? 0 : 1;
    const pitch = kp.pitch * dep, lean = kp.lean * ln;
    const S = { pelvis: { p: V(kp.pelvis.x * k, hp.hip0.y * (kp.pelvis.y / hip0) - 0.012 * j(3) * Math.sin(Math.PI * Math.min(1, pitch / 0.8)), kp.pelvis.z * k), pitch: 0.42 * pitch, yaw: 0.18 * lean, roll: -0.05 * lean },
      spine: { flex: 0.58 * pitch, bend: 0.45 * lean, twist: 0.4 * lean }, feet: feet(), head: {} };
    const shY = kp.shoulder.y * k, hY = kp.hands.y * k; S.shoulders = { L: 0.28 * Math.max(0, Math.min(1, (hY - shY) / 0.45)), R: 0.32 * Math.max(0, Math.min(1, (hY - shY) / 0.45)) };
    const eye = V(0, kp.shoulder.y * k + 0.2, kp.shoulder.z * k), to = anvilTop.clone().sub(eye), want = Math.atan2(-to.y, Math.hypot(to.x, to.z));
    S.head = { pitch: (want - pitch) * 0.85 - 0.05, yaw: Math.atan2(to.x, to.z) * 0.5 - 0.4 * lean };
    return { S, hands: kp.hands.clone().multiplyScalar(k), head: kp.head.clone().multiplyScalar(k), vel: kd.head.clone().sub(kp.head), u, c, slideR: 0.16 + 0.3 * Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, (u - 0.38) / 0.5)))) * near };
  }
  // grips: planned once on a reference pose (the sledge across the front at the belt), then carried in the tool's frame
  h.update(); hp.solve({ pelvis: { p: hp.hip0.clone() }, feet: feet() });
  const ref = { hands: V(0.02, hp.hip0.y + 0.12, 0.34), head: V(0.12, hp.hip0.y - 0.25, 1.0) };
  const grips = new ToolGrip(h, [{ side: 'L', u: 0.05 }, { side: 'R', u: 0.16 }], { L: 0.9, r: 0.018 }, toolMatrix(hp.world(ref.hands), hp.world(ref.head), hp.dirW(V(0, -1, 0))));
  const stats = { handMiss: 0 };
  function frame(t) {
    const a = act(t); hp.solve(a.S);
    const T = toolMatrix(hp.world(a.hands), hp.world(a.head), hp.dirW(a.vel)); tool.matrix.copy(T); tool.matrixWorldNeedsUpdate = true;
    // reach: where a grip is out of this body's reach the body goes to it (pelvis toward the hands, feet planted), never the hands off the handle
    for (let it = 0; it < 5; it++) { const tg = grips.targets(T, { R: a.slideR }); let dx = V(), over = 0;
      for (const sd of ['L', 'R']) { const S0 = h.joint(`upperarm01.${sd}`), v = tg[sd].p.clone().sub(S0), e = v.length() - hp.armLen * 0.97; if (e > 0) { dx.addScaledVector(v.normalize(), e); over = Math.max(over, e); } }
      if (over < 0.004) break; const dl = hp.local(dx.add(h.group.position)); a.S.pelvis.p.x += dl.x * 0.9; a.S.pelvis.p.z += dl.z * 0.9; a.S.pelvis.p.y += Math.min(0, dl.y) * 0.6; a.S.spine.flex += Math.max(0, -dl.y) * 0.4; hp.solve(a.S); }
    const miss = grips.apply(hp, T, { slide: { R: a.slideR }, poles: { L: hp.dirW(V(1, -0.5, -0.6)), R: hp.dirW(V(-1, -0.4, -0.5)) } });
    stats.handMiss = Math.max(stats.handMiss, miss.L, miss.R);
    const strike = Math.max(0, 1 - Math.min(a.u, 1 - a.u) / 0.05);   // u = 0 is the blow (376.6 first)
    return { u: a.u, c: a.c, strike };
  }
  const setVisible = v => { anvil.visible = tool.visible = v; };
  return { frame, anvil, tool, anvilTop: () => hp.world(anvilTop), setVisible, stats, poser: hp };
}
