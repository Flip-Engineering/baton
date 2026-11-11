// THE CHASM: the crew. Five people from the client's person pipeline (makePerson: the current person, its own work clothes), in hard
// hats, standing in the hoist cage facing out, hands on the mid rail; the operator at the control box with her left hand on the lever.
// They are posed by two-bone IK on each person's own kinematics (poserOf -> hp.arm) to grip points in the cage's frame, the trunk
// leaning a little onto the rail, the heads following the plan's gaze (the glass car going by and up; the number; the top), afterPose7
// every frame. The person module is imported when the cast is built (the farm runs main's person pipeline; nothing here pins a version).
import * as THREE from 'three';
import { CREW, RAIL, gazeOf, opHand, swayOf } from './the_chasm.plan.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const HAT = { white: '#ecebe4', yellow: '#e2bb1c', blue: '#2e5d99' };

export class Cast {
  constructor() { this.P = {}; this.hp = {}; this.stance = {}; this.report = {}; this.mod = null; this.miss = {}; }
  async build(scene, { log = console.log } = {}) {
    let mod;
    try { mod = this.mod = await import('../lib/fx/person/index.js'); } catch (e) { log('the_chasm: person module FAILED ' + (e.stack || e)); return this; }
    if (!mod.makePerson || !mod.poserOf || !mod.afterPose7) { log('the_chasm: the person module here lacks makePerson / poserOf / afterPose7 (a local tree older than main); no people'); return this; }
    const st = await mod.loadPersonStudio();
    for (const c of CREW) {
      const t0 = performance.now(); let P = null;
      try { P = await mod.makePerson(c.name, { studio: st, pose: false, fine7: false, hat: 'hard', hatColor: HAT[c.hat] }); }
      catch (e) { log('the_chasm: person ' + c.id + ' FAILED ' + (e.stack || e)); continue; }
      // the hard hat: the current person builds its Hero bare-headed, so the hat goes on with hero.js's own _hat over the scalp
      if (!P.h.hatGroup?.visible && typeof P.h._hat === 'function') {
        try { if (P.h.hatGroup?.parent) P.h.hatGroup.parent.remove(P.h.hatGroup); P.h.hatGroup = null;
          P.h._hat({ ...P.h.o, hat: 'hard', hatColor: HAT[c.hat], hatWear: 0.3, seed: c.name.length });
          P.h.group.traverse(m => { if (m.userData && m.userData.part === 'hair8' && !['brows', 'lashes', 'lashesLow', 'beard', 'moustache'].includes(m.userData.hairPart)) m.visible = false; });
        } catch (e) { log('the_chasm: hat ' + c.id + ' ' + (e.message || e)); } }
      P.h.group.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; } });
      P.h.group.position.set(0, 0, 0); P.h.group.rotation.y = 0; P.h.update();
      this.stance[c.id] = P.h.skeleton.bones.map(b => [b.position.clone(), b.quaternion.clone()]);
      this.hp[c.id] = await mod.poserOf(P);
      scene.add(P.h.group); this.P[c.id] = P;
      this.report[c.id] = Math.round(performance.now() - t0);
      log(`the_chasm: person ${c.id} ${c.name} ${this.report[c.id]} ms, hat ${!!P.h.hatGroup?.visible}`);
    }
    return this;
  }
  get n() { return Object.keys(this.P).length; }
  show(on) { for (const P of Object.values(this.P)) P.h.group.visible = on; }
  toStance(id) { const P = this.P[id], S = this.stance[id]; P.h.skeleton.bones.forEach((b, i) => { b.position.copy(S[i][0]); b.quaternion.copy(S[i][1]); }); P.h.update(); }
  // everyone at beat b, in a cage whose floor is at world (cx, cy, cz) (the cage's frame: x across, z out)
  pose(b, cage) {
    for (const c of CREW) {
      const P = this.P[c.id], hp = this.hp[c.id]; if (!P) continue;
      const h = P.h; h.group.visible = true; this.toStance(c.id);
      const sw = swayOf(c.id, b), lat = V3(1, 0, 0), up = V3(0, 1, 0);
      const px = c.at[0] + sw.sx, pz = c.at[1];
      h.group.position.set(px, cage.y, pz); h.group.rotation.y = 0; h.update();
      // lean onto the rail (the trunk forward a little), the feet held where the stance put them
      const ank = { L: h.joint('foot.L'), R: h.joint('foot.R') }, fq = { L: hp._wq('foot.L'), R: hp._wq('foot.R') };
      const lean = c.op ? 0.02 : sw.lean;
      for (const [n, k] of [['spine05', 0.12], ['spine04', 0.22], ['spine03', 0.26], ['spine02', 0.22], ['spine01', 0.18]]) if (h.bone(n)) h.rotateWorld(n, lat, lean * k);
      h.update();
      for (const sd of ['L', 'R']) { const pole = V3(sd === 'L' ? 0.25 : -0.25, 0, 1).normalize(); hp.twoBone(`upperleg01.${sd}`, `lowerleg01.${sd}`, `foot.${sd}`, ank[sd], pole); hp._setWQ(`foot.${sd}`, fq[sd]); }
      // the head: turn (about up) then pitch (about the shoulders' axis)
      const gz = gazeOf(c.id, b);
      for (const [n, k] of [['neck01', 0.4], ['head', 0.6]]) if (h.bone(n)) h.rotateWorld(n, up, gz.turn * k);
      h.update();
      for (const [n, k] of [['neck01', 0.45], ['head', 0.55]]) if (h.bone(n)) h.rotateWorld(n, lat, gz.pitch * k);
      h.update();
      // the hands: both on the mid rail in front of them; the back one (D) on the shoulders' level of the rail at the side
      const hands = {};
      if (c.op) { const o = opHand(b); hands.L = V3(o[0], cage.y + o[1], o[2]); hands.R = V3(px - 0.2, cage.y + RAIL.y, RAIL.z); }
      else if (c.id === 'D') { hands.L = V3(px + 0.22, cage.y + 1.32, pz + 0.3); hands.R = V3(px - 0.25, cage.y + 1.0, pz + 0.18); }
      else { hands.L = V3(px + 0.19, cage.y + RAIL.y, RAIL.z); hands.R = V3(px - 0.19, cage.y + RAIL.y, RAIL.z); }
      for (const sd of ['L', 'R']) {
        const g = hands[sd]; if (!g) continue;
        const sh = h.joint(`upperarm01.${sd}`), dir = g.clone().sub(sh).normalize();
        const wrist = g.clone().addScaledVector(dir, -0.075).add(V3(0, 0.02, 0));
        const pole = V3(sd === 'L' ? 0.55 : -0.55, -0.8, -0.15).normalize();
        try { const m = hp.arm(sd, wrist, null, pole); (this.miss[c.id] ||= {})[sd] = Math.round((m || 0) * 1000); h.relaxHand?.(sd, c.id === 'D' && sd === 'L' ? 0.4 : 0.9); } catch (e) { /* a reach that fails leaves the arm at rest */ }
      }
      this.mod.afterPose7(P);
    }
  }
}
