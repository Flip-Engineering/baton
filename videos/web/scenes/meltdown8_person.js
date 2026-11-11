// MELTDOWN v19: the worker's hand and forearm from the studio's person pipeline (lib/fx/folk_worlds.js Stage -> hero.js Hero, which in a
// page becomes the current person: cast, body, skin and work clothes from lib/fx/person; research/PERSON_PIPELINE.md). It replaces the
// hand-rolled SDF hand of v12-v18 (meltdown8_hand.js / meltdown8_hero.js, kept on disk as history). The idea is unchanged: the hand rises
// open, closes, the fist turns its knuckles to us, four bars light on the knuckles and grow into the mark.
//
//   const P = await createPersonHand(W, H);  P.draw(g, { q, turn, dist, dx, dy, fade })  ->  knuckles [{x, y, ang, len}] pinky..index
//   q 0 open .. 1 fist; turn 0 palm to the lens .. 1 knuckles to the lens. The knuckles are where the bars sit (the scene draws them).
//
// The person is posed ONCE into three key poses (all bone rotations snapshotted): K0 the open hand, palm to the lens; K1 the fist, palm
// still to the lens; K2 the fist turned, knuckles to the lens. A frame slerps between them. The arm is a target-mode gesture with the
// wrist in front of the chin and the elbow out and down (bent: never a straight raised arm); the fist is Bridgman's (hero.fistBridgman).
// The camera is placed square to the forearm (so it runs straight up the frame, the fist at the top), and its far plane sits just behind
// the forearm, so the body behind it (chest, head) is not drawn: a hand and a sleeved forearm, lit by the payoff's ember light.
import * as THREE from 'three';
import { Stage } from '../lib/fx/folk_worlds.js';
import { GESTURES } from '../lib/fx/gesture.js';

GESTURES.MELT_RAISE = { target: [0.07, 1.36, 0.42], pole: [1, -0.8, -0.15], prop: true };   // the wrist before the chin, elbow out and down

const SIDE = 'R', FING = ['finger5', 'finger4', 'finger3', 'finger2'];   // pinky..index

export async function createPersonHand(W = 1080, H = 1920) {
  const st = new Stage({ W, H }); await st.init();
  const h = st.hero({ variant: 'heavy', height: 1.8, kind: 'work', shirt: '#3e4a5a', trousers: '#2a2622', skin: '#a8714c', dirt: 0.4, stubble: 0.6, hat: 'none', seed: 19, age: 0.45, folds: 1, wear: 0.4 });
  if (h.person && h.person.ready) await h.person.ready;                 // the person system grafts the current person onto the hero's bones
  const who = h.person ? `${h.person.state}${h.person.who ? ' ' + h.person.who : ''}` : 'hero';
  console.log(`[meltdown8_person] the hand: ${who}`);

  const snap = () => h.bones.map(b => b.quaternion.clone());
  const put = Q => { h.bones.forEach((b, i) => b.quaternion.copy(Q[i])); h.update(); };
  h.resetPose(); h.group.position.set(0, 0, 0); h.group.rotation.set(0, 0, 0); h.update();
  h.gesture('L', 'SIDE', { fist: false }); h.relaxHand('L', 1, { cascade: true });
  h.gesture(SIDE, 'MELT_RAISE', { fist: false });
  h.relaxHand(SIDE, 0.35, { cascade: true });                            // an open, living hand (not the bind pose's flat splay)
  h.update();
  const OPEN = snap();
  const E = h.joint(`lowerarm01.${SIDE}`), Wr = h.joint(`wrist.${SIDE}`), e = Wr.clone().sub(E).normalize();
  const F = h._body(), v0 = F.fwd.clone().negate();
  const v = v0.clone().addScaledVector(e, -v0.dot(e)).normalize();     // the view direction: from in front of the person, square to the forearm
  const twist = (Q, ang) => { put(Q); h.rotateWorld(`lowerarm01.${SIDE}`, e, ang * 0.45); h.update(); h.rotateWorld(`lowerarm02.${SIDE}`, e, ang * 0.55); h.update(); };
  const best = (Q, sgn) => { let b = { s: -9, a: 0 }; for (let k = -36; k <= 36; k++) { const a = k * Math.PI / 36; twist(Q, a); const s = sgn * h.palm(SIDE).n.dot(v); if (s > b.s) b = { s, a }; } return b; };
  const a0 = best(OPEN, -1);                                             // the palm toward the lens (its normal against the view direction)
  twist(OPEN, a0.a); const K0 = snap();
  put(OPEN); h.fistBridgman(SIDE); h.update(); const FIST = snap();
  const a2 = best(FIST, 1);                                              // the back of the fist (the knuckles) toward the lens
  twist(FIST, a0.a); const K1 = snap();
  twist(FIST, a2.a); const K2 = snap();
  const C = h.palm(SIDE).c.clone();                                      // the fist's centre in the turned pose: the shot is framed on it
  console.log(`[meltdown8_person] twist open ${(a0.a * 57.3).toFixed(0)} deg (palm ${a0.s.toFixed(2)}), fist ${(a2.a * 57.3).toFixed(0)} deg (back ${a2.s.toFixed(2)})`);

  // the light: an ember key from above the lens, a hot pool under the fist, a red rim from behind, a faint warm ambient
  const side = new THREE.Vector3().crossVectors(v, e).normalize();
  const key = new THREE.DirectionalLight('#ffc28a', 2.6), rim = new THREE.DirectionalLight('#ff4a18', 3.4), rim2 = new THREE.DirectionalLight('#ff8a40', 1.6);
  const pool = new THREE.PointLight('#ff7a30', 2.2, 1.2, 1.6), amb = new THREE.HemisphereLight('#5a3024', '#120406', 0.45);
  key.position.copy(C).addScaledVector(v, -1).addScaledVector(e, 1.1).addScaledVector(side, 0.7); key.target.position.copy(C);
  rim.position.copy(C).addScaledVector(v, 1.4).addScaledVector(e, 0.6).addScaledVector(side, -0.9); rim.target.position.copy(C);
  rim2.position.copy(C).addScaledVector(v, 1.2).addScaledVector(e, 0.3).addScaledVector(side, 1.0); rim2.target.position.copy(C);
  pool.position.copy(C).addScaledVector(v, -0.22).addScaledVector(e, -0.2);
  st.scene.add(key, key.target, rim, rim.target, rim2, rim2.target, pool, amb);

  const cam = st.camera, ql = new THREE.Quaternion();
  function pose(q, turn) {
    const A = turn > 0 ? K1 : K0, B = turn > 0 ? K2 : K1, u = turn > 0 ? turn : q;
    h.bones.forEach((b, i) => { ql.slerpQuaternions(A[i], B[i], u); b.quaternion.copy(ql); });
    h.update();
  }
  function draw(g, c = {}) {
    const q = Math.max(0, Math.min(1, c.q ?? 0)), turn = Math.max(0, Math.min(1, c.turn ?? 0)), D = c.dist ?? 0.72;
    pose(q, turn);
    const aim = C.clone().addScaledVector(e, -(c.drop ?? 0.06));          // frame below the fist: the fist sits in the upper third
    cam.fov = c.fov ?? 30; cam.near = 0.05; cam.far = D + (c.depth ?? 0.12);
    cam.position.copy(aim).addScaledVector(v, -D); cam.up.copy(e); cam.lookAt(aim);
    if (c.roll) { cam.rotateZ(c.roll); }
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    const cv = st.renderLit();
    const dx = c.dx || 0, dy = c.dy || 0;
    g.save(); g.globalAlpha = c.fade ?? 1; g.drawImage(cv, dx, dy, W, H); g.restore();
    const n = h.palm(SIDE).n.clone();
    return FING.map(f => {
      const a = h.joint(`${f}-1.${SIDE}`).addScaledVector(n, -0.011), b = h.joint(`${f}-2.${SIDE}`).addScaledVector(n, -0.009);
      const pa = st.project(a), pb = st.project(b);
      return { x: (pa[0] + pb[0]) / 2 + dx, y: (pa[1] + pb[1]) / 2 + dy, ang: Math.atan2(pb[1] - pa[1], pb[0] - pa[0]), len: Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) };
    });
  }
  return { draw, cv: st.canvas, who };
}
