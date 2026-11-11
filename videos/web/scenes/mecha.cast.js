// MECHA PROLETARIAT (8 Oct, the asset remake): the cast, from the client's person pipeline. Every person on screen at hero distance is
// a v7 person (lib/fx/person: makePerson('v7:<name>'), the studio default: BODY7 forms, FACE7, DETAIL7's fine tier, SKIN7 with its
// subsurface pass, HAIR7 cards, CLOTH9's settled K4 wardrobe under FABRIC7), built ONE AFTER ANOTHER (FABRIC7's hooks are
// page-wide), each in their own work clothes. The 2 Oct CREW8 heroes (the orange one-piece, the ski-mask beard, the bouffant hood,
// the sticker vest) are gone.
//   the five at the levers   L23 (trades tee, chore coat), L14 (warehouse sweatshirt), L21 (fleece sweatshirt), L17 (tee),
//                            L08 (the youngest woman): hands closed on the levers by HandRig, planned once, carried per frame
//   Ray at the anvil          L05 (maintenance chambray, work trousers, boots): MOTION's Muybridge 376 blow (motion/sledge.js) on his
//                            own body, onto a London-pattern anvil with a hot bar on its face
//   the welder                L12 (construction tee under a canvas chore coat): at the giant's foot under WE BUILT HER., and both
//                            hands on the main breaker's handle for FIRE HER UP.
// Gaps (asked of HUMAN and CLOTHING, not hand-rolled here): hard hats and a welding helmet on a v7 head, gloves on a v7 hand, the
// hi-vis vest / coverall / FR jacket garments. Until then the crew are bareheaded indoors and bare-handed on the grips.
import * as THREE from 'three';
import * as PI from '../lib/fx/person/index.js';
const { loadPersonStudio, makePerson } = PI;
// main's person pipeline exports afterPose7 from index.js (build.js); an older tree had it only in v7.js
const afterPose7 = PI.afterPose7 || (await import('../lib/fx/person/' + 'v7.js')).afterPose7;
import { HandRig, cylinder } from '../lib/fx/rig/index.js';
import { makeSledge } from '../lib/fx/motion/sledge.js';
import { anvil } from './mecha.props.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const CREW = ['L23_m45_white', 'L14_f42_black', 'L21_m32_black', 'L17_m28_hispanic', 'L08_f24_hispanic'];
export const RAY = 'L05_m59_black', WELDER = 'L12_f39_white';
export const CREW_X = [-2.2, -1.25, -0.3, 0.65, 1.6];

// keep a built person's own stance (the bake's) so every frame starts from it, not from the bind
function keepStance(P) { const bs = P.h.skeleton.bones; P._stance = bs.map(b => [b.position.clone(), b.quaternion.clone()]); }
export function toStance(P) { P.h.skeleton.bones.forEach((b, i) => { b.position.copy(P._stance[i][0]); b.quaternion.copy(P._stance[i][1]); }); P.h.update(); }

// a HandRig power grip on a bar given in the WORLD (p0 -> p1, radius r), planned once at rest; update(a, u, th) carries the planned
// hand round the pivot (world X axis through `pivot`, angle th from where it was planned), a: approach (1 = off the bar, moved by
// `away`), u: closure 0..1
export function barGrip(h, side, p0, p1, r, pivot, { approach = null, pole = null, skin = 0, away = null } = {}) {
  const hand = new HandRig(h, side, { skin });
  h.update();
  const bar = cylinder(p0.clone(), p1.clone(), r), pl = pole || V(side === 'R' ? -.25 : .25, -1, .1);
  const G = hand.planBest({ grip: 'power', obj: bar, at: bar.centre.clone(), axis: bar.axis.clone(), approach: (approach || V(side === 'R' ? -.35 : .35, 0, -1)).clone().normalize(), r, pole: pl }, { poseOpts: { pole: pl, lean: false } });
  hand.settle(G); hand.fit(G);
  const armQ = hand.snap(), wrist0 = G.wristPt.clone(), R0 = G.R.clone(), rep = hand.measure(bar, G);
  console.log('mecha: grip', side, 'reachMiss', (G.state.reachMiss * 1000).toFixed(0), 'mm, gap', rep.maxGapMm?.toFixed?.(1), 'pen', rep.maxPenMm?.toFixed?.(1));
  const off = away || V(side === 'R' ? -.22 : .22, -.18, -.2);
  return { hand, G, rep,
    update(a, u, th) {
      hand.restore(armQ);
      const rot = new THREE.Matrix4().makeRotationX(th);
      const w = wrist0.clone().sub(pivot).applyMatrix4(rot).add(pivot).addScaledVector(off, a);
      const R = R0.clone(); if (R.isMatrix4) R.premultiply(rot); else if (R.isQuaternion) R.premultiply(new THREE.Quaternion().setFromRotationMatrix(rot));
      hand.place(G, w, R, { pole: pl, lean: false }); hand.pose(G, u);
    } };
}

// c20: the welder's body came through her jacket and jeans at FIRE HER UP. (v11, 16 s: skin-coloured holes where the posed cloth lies
// inside the body as she reaches up and leans in). Every body vertex the clothes cover (weighted to the torso and the limbs, not the
// head, neck or hands) is pushed in along its bind normal by d, feathered by how much of its weight is covered, so the skin lies
// under the cloth in any pose; the face and the hands are untouched. On this person's own copy of the geometry.
const BARE = /^(neck|head|jaw|eye|tongue|teeth|special|levator|oris|orbicularis|risorius|temporalis|nose|ear|lip|cheek|brow|forehead|chin|wrist|metacarpal|finger|thumb)/i;
export function shrinkUnderCloth(P, d = 0.018) {
  const h = P.h, m = h.body; if (!m || !m.geometry) return 0;
  const g = m.geometry = m.geometry.clone(), pa = g.attributes.position, na = g.attributes.normal, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, bones = h.skeleton.bones;
  if (!si || !sw || !na) return 0;
  const bare = bones.map(b => BARE.test(b.name || '')); let n = 0;
  for (let i = 0; i < pa.count; i++) { let cw = 0, tw = 0;
    for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k), j = si.getComponent(i, k); if (w <= 0) continue; tw += w; if (!bare[j]) cw += w; }
    const f = tw > 0 ? Math.max(0, Math.min(1, (cw / tw - 0.55) / 0.4)) : 0; if (f <= 0) continue;
    const s = d * f / (h.scale || 1); pa.setXYZ(i, pa.getX(i) - na.getX(i) * s, pa.getY(i) - na.getY(i) * s, pa.getZ(i) - na.getZ(i) * s); n++; }
  pa.needsUpdate = true; g.computeBoundingSphere(); return n;
}

export class Cast {
  constructor() { this.all = []; }
  async build({ scene, log = console.log } = {}) {
    const st = this.st = await loadPersonStudio();
    const mk = async (name, o = {}) => { const t0 = performance.now(); let P = null;
      try { P = await makePerson(name, { studio: st, pose: false, ...o }); }
      catch (e) { log('mecha: person ' + name + ' FAILED ' + (e.stack || e)); return null; }
      P.h.group.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; } });
      P.h.group.position.set(0, 0, 0); P.h.group.rotation.y = 0; P.h.update(); keepStance(P); P.h.group.visible = false; scene.add(P.h.group);
      log('mecha: person ' + name + ' ' + Math.round(performance.now() - t0) + ' ms, seams ' + (P.report?.seams?.length || 0)); this.all.push(P); return P; };
    this.crew = []; for (const n of CREW) this.crew.push(await mk(n));
    this.ray = await mk(RAY); this.welder = await mk(WELDER);
    if (this.welder) log('mecha: welder body under her clothes, vertices pushed in: ' + shrinkUnderCloth(this.welder, 0.02));
    return this;
  }
  // the five at the console at SET (crew face +z), each hand planned on its lever (LEVERS: the console's levers, world pivots)
  planConsole(SET, levers) {
    this.SET = SET.clone(); this.rigs = [];
    this.crew.forEach((P, i) => { if (!P) { this.rigs.push(null); return; }
      const h = P.h; toStance(P); h.group.position.set(SET.x + CREW_X[i], SET.y, SET.z + .42); h.group.rotation.y = 0; h.update();
      const lev = side => { const L = levers[2 * i + (side === 'L' ? 1 : 0)]; L.piv.updateWorldMatrix(true, false); const base = L.piv.getWorldPosition(V()); return { base, p0: base.clone().add(V(0, .52, 0)), p1: base.clone().add(V(0, .74, 0)) }; };
      const rig = {};
      for (const side of ['R', 'L']) { const l = lev(side); try { rig[side] = barGrip(h, side, l.p0, l.p1, .028, l.base); } catch (e) { console.log('mecha: grip fail', CREW[i], side, e.message); rig[side] = null; } }
      this.rigs.push(rig);
    });
  }
  // per frame: the crew at the console, levers at angles th[k], hands per hs(k) -> [approach, closure]
  posConsole(vis, th, hs) {
    this.crew.forEach((P, i) => { if (!P) return; const on = i < vis; P.h.group.visible = on; if (!on) return;
      toStance(P); const h = P.h; h.group.position.set(this.SET.x + CREW_X[i], this.SET.y, this.SET.z + .42); h.group.rotation.y = 0; h.update();
      const rg = this.rigs[i]; if (rg) for (const [side, k] of [['R', 2 * i], ['L', 2 * i + 1]]) if (rg[side]) { const [a, u] = hs(k); rg[side].update(a, u, th[k]); }
      afterPose7(P); });
  }
  hideAll() { for (const P of this.all) if (P) P.h.group.visible = false; if (this.sledge) this.sledge.setVisible(false); if (this.bar) this.bar.visible = false; }
  // Ray at his anvil: MOTION's blow on his body, the anvil remade (London pattern), a hot bar on its face
  setupRay(scene, at, yaw, TB) {
    const P = this.ray; if (!P) return null; const h = P.h; toStance(P); h.group.position.copy(at); h.group.rotation.y = yaw; h.update();
    const SL = this.sledge = makeSledge(THREE, scene, h, { TB });
    const top = SL.anvilTop(); SL.anvil.children.slice().forEach(c => { c.visible = false; });
    const av = anvil({ faceY: top.y }); SL.anvil.add(av);
    const bar = this.bar = new THREE.Mesh(new THREE.BoxGeometry(.05, .035, .26), new THREE.MeshStandardMaterial({ color: 0x3a1a0a, emissive: new THREE.Color(1, .3, .06), emissiveIntensity: 26, roughness: .6 }));
    bar.position.copy(top).add(V(0, .018, 0)); bar.rotation.y = h.group.rotation.y + .35; scene.add(bar);
    SL.setVisible(false); h.group.visible = false; bar.visible = false;
    return { SL, top: top.clone(), bar };
  }
  poseRay(on, tLocal) { const P = this.ray; if (!P || !this.sledge) return null; P.h.group.visible = on; this.sledge.setVisible(on); this.bar.visible = on; if (!on) return null;
    const f = this.sledge.frame(tLocal); afterPose7(P); return f; }
  // the welder: standing at the giant's foot, looking up at her; or at the breaker, both hands on its handle. The breaker: she stands
  // square to the switchgear, the handle pulled down toward her (off); FIRE HER UP pushes it up and away (on), her body leaning in
  // from the ankles. The grips are planned with the handle mid-throw (the bar in easy reach) and carried round the pivot.
  setupBreaker(sw, { stand = .48 } = {}) {
    const P = this.welder; if (!P) return; const h = P.h, T = sw.userData.throw || { off: .5, on: -.1 }, th0 = (T.off + T.on) / 2;
    this.swHandle = sw.userData.handle; this.swThrow = T; this.swTh0 = th0; this.swHandle.rotation.x = th0; sw.updateMatrixWorld(true);
    const hub = this.swHub = sw.userData.handle.getWorldPosition(V()), [b0, b1] = sw.userData.bar, q = new THREE.Quaternion(); sw.userData.handle.getWorldQuaternion(q);
    toStance(P); const front = V(0, 0, 1).applyQuaternion(sw.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
    h.group.position.copy(hub).addScaledVector(front, stand).setY(0); h.group.rotation.set(0, Math.atan2(-front.x, -front.z), 0); h.update();
    this.welderAtBreaker = { pos: h.group.position.clone(), yaw: h.group.rotation.y, front };
    // p0: the bar's end on her LEFT, p1 on her right (her right is her local -x)
    const qy = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), h.group.rotation.y), right = V(-1, 0, 0).applyQuaternion(qy);
    let p0 = b0.clone().applyQuaternion(q).add(hub), p1 = b1.clone().applyQuaternion(q).add(hub); if (p0.clone().sub(p1).dot(right) > 0) [p0, p1] = [p1, p0];
    this.brk = {};
    for (const side of ['R', 'L']) { const sg = side === 'R' ? -1 : 1;
      try { this.brk[side] = barGrip(h, side, side === 'R' ? p1.clone().lerp(p0, .08) : p0.clone().lerp(p1, .08), side === 'R' ? p1.clone().lerp(p0, .42) : p0.clone().lerp(p1, .42), .024, hub,
        { approach: V(.3 * sg, -.25, -1).applyQuaternion(qy), pole: V(.45 * sg, -1, -.1).applyQuaternion(qy), away: V(.2 * sg, -.2, -.18).applyQuaternion(qy) }); }
      catch (e) { console.log('mecha: breaker grip fail', side, e.message); this.brk[side] = null; } }
    toStance(P); h.update();
  }
  // c20: anyone standing in the yard (the class at frame 0, the front row at the end): their own stance, placed, the head turned to look
  // up (look 0..1) and a little to the side (turn, radians)
  stand(P, pos, yaw, { look = 0, turn = 0 } = {}) {
    if (!P) return; const h = P.h; toStance(P); h.group.visible = true; h.group.position.copy(pos); h.group.rotation.set(0, yaw, 0); h.update();
    for (const [nm, k] of [['neck01', .45], ['head', .55]]) { const b = h.bone(nm); if (b) { b.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), turn * k)); b.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), -look * k)); } }
    h.update(); afterPose7(P);
  }
  poseWelder(mode, o = {}) {
    const P = this.welder; if (!P) return; const h = P.h; h.group.visible = !!mode; if (!mode) return;
    toStance(P);
    if (mode === 'breaker') { const w = this.welderAtBreaker, th = o.th ?? this.swThrow.off;
      // the lean into the push: the whole body inclined from the ankles toward the switchgear (rotation about her own x axis)
      h.group.position.copy(w.pos); h.group.rotation.set(0, w.yaw, 0); h.group.rotateX(o.lean ?? 0); h.update();
      this.swHandle.rotation.x = th; this.swHandle.updateMatrixWorld(true);
      for (const side of ['R', 'L']) if (this.brk?.[side]) this.brk[side].update(o.a ?? 0, o.u ?? 1, th - this.swTh0); }
    else { h.group.position.copy(o.pos); h.group.rotation.set(0, o.yaw ?? 0, 0); h.update();
      // the head and neck turned up toward the machine she built (a look, eased: chin up, eyes on her)
      const look = o.look ?? .5; for (const [nm, k] of [['neck01', .45], ['head', .55]]) { const b = h.bone(nm); if (b) b.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), -look * k)); }
      h.update(); }
    afterPose7(P);
  }
}
