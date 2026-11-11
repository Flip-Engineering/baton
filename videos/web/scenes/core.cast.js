// THE CORE (TRUE SCALE ep. 1): the crews, from the client's person pipeline. All twelve are v7 people (lib/fx/person:
// makePerson('v7:<name>')) in their own K4 work clothes, with hero.js's own hard hat and cut-resistant knit gloves through person/v2's
// opt-in pass-through ({ hat: 'hard', hatColor, gloves: true, gloveColor }). Hats white, safety yellow or blue, never red. Faces are
// under hats and never seen from above: fine7 off, no subsurface pass. Built once, one after another (FABRIC7's hooks are page-wide).
// Hands go where the work is by two-bone IK on the person's own kinematics (poserOf -> hp.arm), the trunk leans and the pelvis lowers
// with the load, the feet stay planted (two-bone leg IK back onto the ankles the stance put down); afterPose7 every frame. Women are
// half of every crew. Nobody appears twice in a frame: one person, one body.
import * as THREE from 'three';
import { loadPersonStudio, makePerson } from '../lib/fx/person/index.js';
import { afterPose7, poserOf } from '../lib/fx/person/index.js';   // (15 Oct, orchestrator: person/v7.js is deleted, one current person; index.js exports both)
import { mulberry } from '../lib/fx/truescale/corestack.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const HAT = { white: '#ecebe4', yellow: '#e2bb1c', blue: '#2e5d99' };
export const GLOVE = '#c2b98a';
export const PEOPLE = {
  L03: ['L03_m38_asian', 'blue'], L05: ['L05_m59_black', 'yellow'], L06: ['L06_f53_white', 'white'], L08: ['L08_f24_hispanic', 'yellow'],
  L11: ['L11_m23_white', 'white'], L12: ['L12_f39_white', 'blue'], L14: ['L14_f42_black', 'yellow'], L17: ['L17_m28_hispanic', 'white'],
  L20: ['L20_f29_asian', 'white'], L21: ['L21_m32_black', 'blue'], L22: ['L22_f27_black', 'white'], L23: ['L23_m45_white', 'yellow'],
};

export class Cast {
  constructor() { this.P = {}; this.hp = {}; this.stance = {}; this.report = {}; }
  async build({ scene, log = console.log, only = null } = {}) {
    const st = this.st = await loadPersonStudio();
    for (const [id, [name, hat]] of Object.entries(PEOPLE)) {
      if (only && !only.includes(id)) continue;
      const t0 = (globalThis.performance || Date).now(); let P = null;
      try { P = await makePerson('v7:' + name, { studio: st, pose: false, fine7: false, hat: 'hard', hatColor: HAT[hat], gloves: true, gloveColor: GLOVE }); }
      catch (e) { log('core: person ' + id + ' FAILED ' + (e.stack || e)); continue; }
      // (16 Oct, finish) the current person builds its Hero with hat 'none' and hides any hatGroup (build.js ignores the hat / gloves opts),
      // so c20's first delivery (1015-133608) had bare heads from above. The hard hat goes on here with hero.js's own _hat on the person's
      // skull (as the graft does for a scene's hat), the scalp cards under it hidden. Gloves are not reachable after the build (noted).
      if (!P.h.hatGroup?.visible && typeof P.h._hat === 'function') {
        try { if (P.h.hatGroup?.parent) P.h.hatGroup.parent.remove(P.h.hatGroup); P.h.hatGroup = null;
          P.h._hat({ ...P.h.o, hat: 'hard', hatColor: HAT[hat], hatWear: 0.25, seed: name.length });
          P.h.group.traverse(m => { if (m.userData && m.userData.part === 'hair8' && !['brows', 'lashes', 'lashesLow', 'beard', 'moustache'].includes(m.userData.hairPart)) m.visible = false; });
        } catch (e) { log('core: person ' + id + ' hat FAILED ' + (e.stack || e)); } }
      P.h.group.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; } });
      P.h.group.position.set(0, 0, 0); P.h.group.rotation.y = 0; P.h.update();
      this.stance[id] = P.h.skeleton.bones.map(b => [b.position.clone(), b.quaternion.clone()]);
      this.hp[id] = await poserOf(P);
      P.h.group.visible = false; scene.add(P.h.group); this.P[id] = P;
      this.report[id] = { ms: Math.round((globalThis.performance || Date).now() - t0), hat: !!P.h.hatGroup?.visible, gloves: !!P.h.cloth?.gloves };
      log(`core: person ${id} ${this.report[id].ms} ms, hat ${this.report[id].hat}, gloves ${this.report[id].gloves}`);
    }
    return this;
  }
  toStance(id) { const P = this.P[id], S = this.stance[id]; P.h.skeleton.bones.forEach((b, i) => { b.position.copy(S[i][0]); b.quaternion.copy(S[i][1]); }); P.h.update(); }
  hideAll() { for (const P of Object.values(this.P)) P.h.group.visible = false; }
  // move people between scenes (the hall, the pour outside)
  into(scene, ids) { for (const id of ids) { const P = this.P[id]; if (P && P.h.group.parent !== scene) scene.add(P.h.group); } }
  // pose one person. s: { at: [x, z] (world), y (the floor under them), yaw (0 faces +z), hands: { L, R } (world grip points or null),
  //   lean (rad, trunk forward), drop (m, pelvis down, knees bend), look (rad, head down), step: { u, back } (a step back by u 0..1) }
  // returns the hands' misses (m)
  // pose with the body's own reach: when a hand misses its grip by more than 15 mm, the trunk leans further (or less) and the knees give,
  // from a fixed list, and the best is kept (deterministic: the same s gives the same pose)
  pose(id, s) {
    const first = this.pose1(id, s); if (!first || !s.hands || s.auto === false) return first;
    const worst = m => Math.max(m.L ?? 0, m.R ?? 0); if (worst(first) <= 0.015) return first;
    let best = { m: first, v: worst(first), ds: null };
    for (const [dl, dd] of [[0.15, 0], [0.3, 0.04], [-0.15, 0], [0.45, 0.08], [-0.3, 0.02], [0.6, 0.12]]) {
      const ds = { ...s, lean: Math.max(-0.1, (s.lean || 0) + dl), drop: Math.max(0, (s.drop || 0) + dd) }, m = this.pose1(id, ds), v = worst(m);
      if (v < best.v - 1e-4) best = { m, v, ds }; if (v <= 0.015) break; }
    return best.ds ? this.pose1(id, best.ds) : this.pose1(id, s);
  }
  pose1(id, s) {
    const P = this.P[id], hp = this.hp[id]; if (!P) return null;
    const h = P.h; h.group.visible = true; this.toStance(id);
    const yaw = s.yaw || 0, fwd = V3(Math.sin(yaw), 0, Math.cos(yaw)), lat = V3(Math.cos(yaw), 0, -Math.sin(yaw)), up = V3(0, 1, 0);
    let px = s.at[0], pz = s.at[1];
    const st = s.step, back = st ? (st.back ?? 0.4) : 0, su = st ? clamp(st.u) : 0;
    if (st) { const k = sstep(0.15, 0.85, su) * back; px -= fwd.x * k; pz -= fwd.z * k; }
    h.group.position.set(px, s.y || 0, pz); h.group.rotation.y = yaw; h.update();
    // where the stance put the feet (world), before anything bends
    const ank = { L: h.joint('foot.L'), R: h.joint('foot.R') }, fq = { L: hp._wq('foot.L'), R: hp._wq('foot.R') };
    if (st) { // the step: the rear-going foot first, then the other, each lifted 8 cm at its middle (the body has already moved by k)
      const k = sstep(0.15, 0.85, su) * back, kL = sstep(0, 0.55, su) * back, kR = sstep(0.45, 1, su) * back;
      for (const [sd, kk, u0] of [['L', kL, [0, 0.55]], ['R', kR, [0.45, 1]]]) { const v = clamp((su - u0[0]) / (u0[1] - u0[0])); ank[sd].addScaledVector(fwd, k - kk).add(V3(0, 0.08 * Math.sin(Math.PI * v), 0)); }
    }
    const lean = s.lean || 0, drop = s.drop || 0;
    if (drop) { const R = h.bone('root'); R.position.y -= drop / h.scale; h.update(); }
    if (lean) { for (const [n, k] of [['spine05', 0.12], ['spine04', 0.22], ['spine03', 0.26], ['spine02', 0.22], ['spine01', 0.18]]) if (h.bone(n)) h.rotateWorld(n, lat, lean * k); h.update(); }
    if (drop || lean || st) for (const sd of ['L', 'R']) { const pole = fwd.clone().addScaledVector(lat, sd === 'L' ? 0.25 : -0.25).normalize();
      hp.twoBone(`upperleg01.${sd}`, `lowerleg01.${sd}`, `foot.${sd}`, ank[sd], pole); hp._setWQ(`foot.${sd}`, fq[sd]); }
    if (s.look) { for (const [n, k] of [['neck01', 0.45], ['head', 0.55]]) if (h.bone(n)) h.rotateWorld(n, lat, s.look * k); h.update(); }
    const miss = {};
    for (const sd of ['L', 'R']) {
      const g = s.hands?.[sd]; if (!g) continue;
      const sh = h.joint(`upperarm01.${sd}`), dir = g.clone().sub(sh), d = dir.length(); dir.normalize();
      const wrist = g.clone().addScaledVector(dir, -0.075).add(V3(0, 0.02, 0));
      const pole = lat.clone().multiplyScalar(sd === 'L' ? 0.55 : -0.55).add(V3(0, -0.8, 0)).addScaledVector(fwd, -0.15).normalize();
      const m = hp.arm(sd, wrist, null, pole); miss[sd] = +m.toFixed(4); void d;
      h.relaxHand(sd, s.grip ?? 0.9);
    }
    afterPose7(P);
    return miss;
  }
}

// ---------------------------------------------------------------- the choreography, shot by shot (pure functions of t -> pose specs)
// hook (frame 0): four hold the printed board by its short edges from the floor of the windows; over 0-3.9 s they lower it 0.12 m and
// settle it (a breath, one re-grip), then hold. Local to station A; board = { x0, x1, z, y(t) }
export function hookPoses(A, board, t) {
  // c20: they hold it up (a breath, one re-grip), lower it together flat onto the stack (trunks leaning, knees giving with it), let go,
  // and step back from the table: the act, not a pose
  const y = board.y(t), out = [], spec = [['L22', -1, -0.75], ['L05', -1, 0.05], ['L17', 1, -0.75], ['L12', 1, 0.05]];
  const down = sstep(0.7, board.down ?? 2.9, t), off = t >= (board.off ?? 99), back = board.back ?? 99;
  for (const [id, side, z] of spec) {
    const ex = side < 0 ? board.x0 : board.x1, yaw = side < 0 ? Math.PI / 2 : -Math.PI / 2, regrip = id === 'L22' ? Math.max(0, Math.sin(clamp((t - 0.25) / 0.35) * Math.PI)) * 0.035 : 0;
    // facing the board: the figure's left is world -z for the left pair, +z for the right
    const zl = side < 0 ? z - 0.2 : z + 0.2, zr = side < 0 ? z + 0.2 : z - 0.2;
    const step = t >= back ? { u: (t - back - (id === 'L05' || id === 'L17' ? 0.12 : 0)) / 0.7, back: 0.45 } : null;
    out.push({ id, at: [A[0] + ex + side * 0.22, A[1] + z], yaw, lean: off ? 0.12 : 0.04 + 0.34 * down, drop: off ? 0.01 : 0.01 + 0.07 * down, step,
      hands: off ? null : { L: V3(A[0] + ex, y + 0.012 + regrip, A[1] + zl), R: V3(A[0] + ex, y + 0.012, A[1] + zr) }, look: 0.25 + 0.15 * down });
  }
  return out;
}
// the eight: four on the floor beyond the top yoke, four in the windows (two each), both hands on the sheet's edge round each grip
export function eightPoses(A, lay, t, ids = { out: ['L03', 'L06', 'L08', 'L11'], in: ['L14', 'L20', 'L21', 'L23'] }) {
  const s = lay(t), out = [], outs = s.grips.filter(g => g.side === 'out').sort((a, b) => a.pW.x - b.pW.x), ins = s.grips.filter(g => g.side === 'in').sort((a, b) => a.pW.x - b.pW.x);
  const low = s.phase === 'carry' ? 0 : s.phase === 'lower' ? sstep(0, 1, (s.u - 0.35) / 0.35) : 1, off = s.phase === 'set' && s.u > 0.94;
  const put = (id, g, faceZ) => { const p = g.pW.clone().add(V3(A[0], 0, A[1])), yaw = faceZ > 0 ? 0 : Math.PI;
    const tap = s.phase === 'tap' && (id === 'L03' || id === 'L23') ? 0.012 * Math.max(0, Math.sin((s.u - 0.7) / 0.18 * Math.PI * 4)) : 0;
    out.push({ id, at: [p.x, p.z - faceZ * 0.44], yaw, lean: 0.1 + 0.22 * low, drop: 0.06 * low, look: 0.35,
      hands: off ? null : { L: p.clone().add(V3(faceZ > 0 ? 0.17 : -0.17, tap, 0)), R: p.clone().add(V3(faceZ > 0 ? -0.17 : 0.17, 0, 0)) } }); };
  outs.forEach((g, i) => put(ids.out[i], g, 1)); ins.forEach((g, i) => put(ids.in[i], g, -1));
  return out;
}
// the gantry: L22 squares the stack's outer face with a straightedge; L17 feeds the cut-to-length stacks at the table's end
export function gantryPoses(B, core2, top, t, feed) {
  const xf = core2.P + core2.o.D / 2 + 0.008, sq = 0.004 * Math.sin(t * 5.2), yb = top - 0.08;
  const fx = B[0] + feed.x, fz = B[1] + feed.z, lift = 0.03 * sstep(0, 1, Math.sin(clamp((t - 8.6) / 2.5) * Math.PI));
  return [
    { id: 'L22', at: [B[0] + xf + 0.42, B[1] - 0.2], yaw: -Math.PI / 2, lean: 0.28 + Math.max(0, 0.9 - yb) * 0.6, drop: 0.08 + Math.max(0, 0.9 - yb) * 0.5, look: 0.4,   // (c20: the low table: she crouches to the face)
      hands: { L: V3(B[0] + xf + sq, yb, B[1] - 0.2 + 0.45), R: V3(B[0] + xf + sq, yb, B[1] - 0.2 - 0.45) } },
    { id: 'L17', at: [fx, fz + 1.56], yaw: Math.PI, lean: 0.62, drop: 0.14, look: 0.45,           // at the rack's end, the stack's end in her hands
      hands: { L: V3(fx - 0.28, feed.y + lift, fz + 1.21), R: V3(fx + 0.28, feed.y + lift, fz + 1.21) } },
  ];
}
// the time-lapse: the crew moves in jumps (a new place every sixteenth), laying round the core's left side; nobody twice in a frame
export function stepPoses(A, core, top, t, ids = ['L06', 'L11', 'L14', 'L21']) {
  const j = Math.floor((t - 11.55) / 0.15), r = mulberry(4000 + j * 17), h = core.o.D / 2, P = core.P, Zy = core.Zy, out = [];
  const spots = [
    { at: [-P - h - 0.5, -Zy + 0.2], yaw: Math.PI / 2, g: [-P - h, -Zy + 0.2] }, { at: [-P - h - 0.5, 0.4], yaw: Math.PI / 2, g: [-P - h, 0.4] },
    { at: [-P - h - 0.5, Zy - 0.1], yaw: Math.PI / 2, g: [-P - h, Zy - 0.1] }, { at: [-1.6, Zy + h + 0.5], yaw: Math.PI, g: [-1.6, Zy + h] },
    { at: [-2.7, Zy + h + 0.5], yaw: Math.PI, g: [-2.7, Zy + h] }, { at: [-1.17, Zy - h - 0.45], yaw: 0, g: [-1.17, Zy - h] },
    { at: [-P + h + 0.42, -0.3], yaw: -Math.PI / 2, g: [-P + h, -0.3] }, { at: [-h - 0.42, 0.9], yaw: Math.PI / 2, g: [-h, 0.9] },
  ];
  const used = new Set();
  for (const id of ids) { let k; do { k = Math.floor(r() * spots.length); } while (used.has(k)); used.add(k); const sp = spots[k], dy = 0.05 * r();
    const g = V3(A[0] + sp.g[0], top + dy, A[1] + sp.g[1]), side = V3(Math.cos(sp.yaw), 0, -Math.sin(sp.yaw));
    const low = Math.max(0, 1.0 - top);                                // c20: the low table early in the time-lapse: they stoop and crouch
    out.push({ id, at: [A[0] + sp.at[0], A[1] + sp.at[1]], yaw: sp.yaw, lean: 0.2 + 0.2 * r() + 0.5 * low, drop: 0.04 + 0.35 * low, look: 0.4, hands: { L: g.clone().addScaledVector(side, 0.2), R: g.clone().addScaledVector(side, -0.2) } }); }
  return out;
}
// the pour: two pull a screed board across the wet edge by its handles, two spread with come-alongs, one works the vibrator; all face
// the pour's open edge (-z: toward the placed concrete), standing in it (sunk 6 cm)
export function pourPoses(site, t, ids = ['L03', 'L06', 'L14', 'L20', 'L23']) {
  const { front, shift, y } = site, x0 = shift[0], z = front - 0.6, pull = 0.18 * Math.sin(t * 4.4), out = [], yaw = Math.PI;
  const handle = (x) => V3(x, y + 0.78, z + pull);
  out.push({ id: 'L03', y: y - 0.06, at: [x0 - 1.9, z + pull + 0.5], yaw, lean: 0.25, drop: 0.04, look: 0.5, hands: { L: handle(x0 - 2.08), R: handle(x0 - 1.72) } });
  out.push({ id: 'L06', y: y - 0.06, at: [x0 + 1.9, z + pull + 0.5], yaw, lean: 0.25, drop: 0.04, look: 0.5, hands: { L: handle(x0 + 1.72), R: handle(x0 + 2.08) } });
  for (const [id, dx, ph] of [['L14', -6.0, 0.0], ['L20', 5.6, 1.3]]) { const r = 0.12 * Math.sin(t * 3.1 + ph), hz = z + 0.16 - 0.3 + r;
    out.push({ id, y: y - 0.06, at: [x0 + dx, z + 0.16], yaw, lean: 0.3, drop: 0.04, look: 0.5, hands: { L: V3(x0 + dx - 0.12, y + 0.94, hz + 0.1), R: V3(x0 + dx + 0.12, y + 0.74, hz - 0.05) } }); }
  out.push({ id: 'L23', y: y - 0.06, at: [x0 + 8.6, z - 0.4], yaw, lean: 0.4, drop: 0.06, look: 0.55, hands: { L: V3(x0 + 8.48, y + 0.92, z - 0.74), R: V3(x0 + 8.72, y + 0.74, z - 0.84) } });
  return out;
}
// the lacing: six on the lacing boards laid over the windings' tops on the +z side, two at each limb's gap, both hands on the handful's top edge; hands off when the yoke is closed
// (bar 41); at bar 48 one step back to the rail. rel: core.relace(n, t) at this t
export function lacePoses(C, rel, t, { closed, stepAt, platY }) {
  const ids = ['L05', 'L08', 'L12', 'L17', 'L21', 'L22'], out = [], off = t >= closed || !rel || !rel.grips[0].on;
  rel?.grips.forEach((g, i) => {
    // c20: from the platform nearer the handful (rel.near: -1 the -z grating, facing +z; +1 the boards over the windings, facing -z)
    const near = rel.near ?? 1, id = ids[i], p = g.pW.clone().add(V3(C[0], 0, C[1]));
    const atz = near < 0 ? Math.min(p.z - 0.45, C[1] - 1.3) : p.z + 0.45, press = rel.u > 0.55 && rel.u < 0.9 ? 0.06 : 0;   // (on boards over the still-open circles, just behind the handful)
    const step = t >= stepAt ? { u: (t - stepAt) / 0.6, back: 0.4 } : null;
    out.push({ id, y: platY, at: [p.x, atz], yaw: near < 0 ? 0 : Math.PI, lean: off ? 0.1 : 0.45 + press, drop: off ? 0.0 : 0.04, look: off ? 0.2 : 0.55, step,
      hands: off ? null : { L: p.clone().add(V3(-0.12, 0, 0)), R: p.clone().add(V3(0.12, 0, 0)) } });
  });
  return out;
}
