// THE FACTORY c20 (machines_e1_a / _b): the plant and its people in 3D, for the 2D gate world to look into and cut to.
//
//   Plant    inside the press hall under sodium light: the objects kit's straight-side tandem line (lib/fx/objects
//            pressLine, four presses P-11..P-14 with flywheels, gibs, two-hand stations, the conveyors between them), an
//            arc-welding cell (cobotArm, the orange weld curtains, the beam on the table, the arc as the light), and the
//            crew from the person pipeline (lib/fx/people.js: in a page the crowd IS the current person system, dressed in
//            the 'steel' trade: hard hats, hi-vis, gloves). Built after the objects lab's FACTORY OUR PACE. shot (labs/
//            objects/lab_objects.js ?shot=presses), which was made for this piece. Not cut with any film.
//   Figures  the same people outside, on a transparent layer the 2D gate world composites: the worker at the gate in
//            profile at 5:40 a.m., the crew filing in, the two on the lift (take a). Its camera is set so its horizon and
//            ground plane land on the 2D world's (horizonCam), so a person stands where the drawing's ground is.
//
// One camera object per renderer, moved per shot (the Stage's GTAO composer is built per camera: one camera, one build).
import * as THREE from 'three';
import { pressLine, cobotArm, G, Parts, mat, fin, paint, V3, TAU, rng } from '../lib/fx/objects/index.js';
import { Stage, SKIES, groundPlane } from '../lib/fx/objects/stage.js';
import { People } from '../lib/fx/people.js';

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const ease = x => { x = clamp(x); return x * x * (3 - 2 * x); };
const lerpV = (a, b, u) => a.clone().lerp(b, u);
const headingTo = d => Math.atan2(d.x, d.z);              // People face +Z at heading 0

// ===================================================================================== the plant
export class Plant {
  constructor(W, H) {
    this.W = W; this.H = H;
    const cv = this.canvas = document.createElement('canvas'); cv.width = W; cv.height = H;
    const st = this.st = new Stage(cv, { sky: SKIES.sodium, noDome: true, exposure: 1.2, fogDensity: 0.016,
      key: { az: 1.9, el: 0.9, color: 0xffb060, intensity: 1.2 }, rim: { az: -2.2, el: 0.25, color: 0xff3a20, intensity: 1.6 },
      fill: { sky: 0x6a4020, ground: 0x1a0c08, intensity: 0.55 }, aoRadius: 0.8 });
    st.scene.background = new THREE.Color(0x2a0605);
    // ---- the line
    const line = this.line = pressLine({ seed: 4, n: 4, spacing: 9.5, paint: 0x4d6356, wear: 0.65 });
    st.add(line);
    st.add(groundPlane('concrete', { size: 300, color: '#2c2925' }));
    // ---- the hall: the back wall (brick, grime), columns and roof trusses, the high glazing lit red by the dawn, sodium lamps
    const B = new Parts();
    B.add('wall', G.box(160, 22, 0.5, -20, 11, -14));
    for (let x = -95; x < 60; x += 6) B.add('col', G.box(0.4, 18, 0.6, x, 9, -13.4), G.box(0.4, 0.8, 30, x, 18.5, 0));
    for (let x = -95; x < 60; x += 6) for (let k = 0; k < 6; k++) B.add('col', G.rod(V3(x, 18.1, -14 + k * 5), V3(x + 3, 16.8, -14 + k * 5 + 2.5), 0.06, 5));
    B.add('glow', G.box(160, 3.4, 0.1, -20, 14.8, -13.7));
    const lampPos = [];
    for (let x = -60; x < 30; x += 12) for (const z of [-2, 7]) { B.add('lamp', G.cyl(0.55, 0.9, 0.5, x, 15.2, z, 16)); B.add('bulb', G.cyl(0.5, 0.5, 0.05, x, 14.93, z, 16)); lampPos.push([x, 14.7, z]); }
    st.add(B.build({ wall: mat('plantWall', { color: 0x5a2a22, rough: 0.9, wear: { joints: { h: 0.075, l: 0.225, w: 0.008, k: 0.5, color: [0.25, 0.14, 0.1] }, grime: 0.6, grimeH: 6, wobble: 0.3 } }),
      col: paint(0x2a2a2a, { grime: 0.3, speck: 0.2 }), glow: mat('hiwin', { color: 0xff3a20, emissive: 0xff2a14, emissiveIntensity: 2.2 }),
      lamp: fin('black'), bulb: mat('sodium', { color: 0xffc070, emissive: 0xffa040, emissiveIntensity: 6 }) }));
    lampPos.forEach(([x, y, z], i) => { if (i % 2 === 0 || Math.abs(x) < 20) { const L = new THREE.PointLight(0xffa048, 90, 45, 1.6); L.position.set(x, y - 0.5, z); if (i === 6) { L.castShadow = true; L.shadow.mapSize.set(1024, 1024); } st.scene.add(L); } });
    line.updateMatrixWorld(true);
    // each press: its centre, its front (the operator's side) and the operator's mark
    this.P = line.userData.presses.map(p => {
      const c = p.getWorldPosition(new THREE.Vector3()), op = p.localToWorld(p.userData.meta.anchors.operator.clone()), die = p.localToWorld(p.userData.meta.anchors.die.clone());
      const nF = op.clone().sub(c).setY(0).normalize();
      return { p, c, op, die, nF, side: new THREE.Vector3(-nF.z, 0, nF.x) };
    });
    const P0 = this.P[0];
    st.event('ram', { kind: 'point', color: 0xeaf2ff, intensity: 260, pos: [P0.die.x + P0.nF.x * 0.6, P0.die.y, P0.die.z + P0.nF.z * 0.6], decay: 2, distance: 40 });
    // the flood the crew stand in front of on CREW!: the press lit from above and in front, warm
    const fl = P0.c.clone().addScaledVector(P0.nF, 9).setY(13);
    st.event('flood', { kind: 'spot', color: 0xffb468, intensity: 900, pos: [fl.x, fl.y, fl.z], target: [P0.c.x, 3.5, P0.c.z], angle: 0.42, penumbra: 0.8, decay: 1.6, distance: 60, shadow: true });
    // ---- the weld cell, in front of the line between P-11 and the wall's end (the line in the haze behind it)
    const CELL = this.CELL = P0.c.clone().addScaledVector(P0.nF, 7).addScaledVector(P0.side, 7);
    const cell = new THREE.Group(); cell.position.copy(CELL); cell.rotation.y = headingTo(P0.nF.clone().negate()) + Math.PI / 2;
    const F = new Parts();
    F.add('table', G.box(2.4, 0.08, 1.2, 0, 0.84, 1.15)); for (const sx of [-1, 1]) for (const sz of [-1, 1]) F.add('table', G.box(0.1, 0.8, 0.1, sx * 1.1, 0.4, 1.15 + sz * 0.5));
    for (let i = 0; i < 6; i++) F.add('slot', G.box(2.3, 0.01, 0.03, 0, 0.885, 0.7 + i * 0.18));
    F.add('beam', G.box(2.0, 0.02, 0.2, 0, 0.9, 1.15), G.box(2.0, 0.3, 0.018, 0, 1.06, 1.15), G.box(2.0, 0.02, 0.2, 0, 1.22, 1.15));
    for (const x of [-0.5, 0.2, 0.8]) F.add('beam', G.box(0.012, 0.28, 0.09, x, 1.06, 1.1));
    for (const x of [-0.9, 0.9]) F.add('clamp', G.box(0.08, 0.4, 0.08, x, 1.05, 0.85), G.box(0.08, 0.06, 0.32, x, 1.26, 0.98));
    F.add('bead', G.box(0.35, 0.012, 0.012, 0.03, 0.94, 1.105));
    for (let i = 0; i < 3; i++) F.add('curtain', G.box(1.4, 1.9, 0.01, -1.6 + i * 1.45, 1.15, -1.3));
    F.add('frame', G.box(4.5, 0.05, 0.05, -0.15, 2.1, -1.3), G.box(0.05, 2.1, 0.05, -2.35, 1.05, -1.3), G.box(0.05, 2.1, 0.05, 2.1, 1.05, -1.3));
    cell.add(F.build({ table: paint(0x3a3c3e, { grime: 0.6, speck: 0.4, edge: 0.6 }), slot: fin('black'), beam: mat('beamSteel', { color: 0x4a4c4e, rough: 0.5, metal: 0.7, wear: { speck: 0.5, speckScale: 9, edge: 0.5 } }),
      clamp: paint(0x2a4a8a, { edge: 0.5 }), bead: mat('bead', { color: 0xffa060, emissive: 0xff7020, emissiveIntensity: 3, rough: 0.4 }),
      curtain: mat('curtain', { color: 0xc86a10, emissive: 0x5a2a04, emissiveIntensity: 0.7, transparent: true, opacity: 0.72, rough: 0.6, side: THREE.DoubleSide }),
      frame: paint(0xd8a21c, { grime: 0.3, edge: 0.5 }) }));
    const bot = this.bot = cobotArm({ seed: 3, kind: 'industrial', paint: 0xb3261c, wear: 0.4, riser: 0.5, drum: false });
    cell.add(bot.group); st.add(cell); cell.updateMatrixWorld(true); this.cell = cell;
    this.cellW = (x, y, z) => cell.localToWorld(V3(x, y, z));
    const NS = 140, sg = this.sparkG = new THREE.BufferGeometry(); this.sp = new Float32Array(NS * 6); sg.setAttribute('position', new THREE.BufferAttribute(this.sp, 3));
    this.sparks = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: new THREE.Color(1.0, 0.62, 0.25).multiplyScalar(4), transparent: true, opacity: 0.95 })); this.sparks.frustumCulled = false; st.add(this.sparks);
    this.arc = st.event('arc', { kind: 'point', color: 0xcfe0ff, intensity: 22, pos: [0, 1, 1], decay: 2, distance: 20, shadow: true });
    this.arcGlow = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3.4, 4) })); st.add(this.arcGlow);
    st.fit(new THREE.Box3(V3(-32, 0, -12), V3(16, 12, 16)));
    // ---- the crew (person pipeline). Operators at the four two-hand stations; one at the weld cell; the crowd for CREW!
    const folk = this.folk = new People(st.scene, { max: 96, viewH: H, budget: [28, 90] });
    this.ops = this.P.map((P, i) => { const id = folk.add(People.varied('steel', 41 + i * 7, { hat: true })); folk.set(id, { x: P.op.x, z: P.op.z, heading: headingTo(P.nF.clone().negate()), act: 'stand' }); return id; });
    const cw = this.cellW(-0.9, 0, 2.6); this.welder = folk.add(People.varied('steel', 77, { hat: true }));
    folk.set(this.welder, { x: cw.x, z: cw.z, heading: headingTo(this.cellW(0, 0, 1.15).sub(cw).setY(0)), act: 'stand' });
    const r = rng(28), crowd = this.crowd = [];
    const lay = People.crowdLayout(54, { width: 13, depth: 9, z0: 0, seed: 28, clump: 0.6, minGap: 0.62 });
    for (const [k, q] of lay.entries()) {
      const d = 3.2 - q.z;                                                // 3.2 .. ~12 m in front of the press
      const pos = P0.c.clone().addScaledVector(P0.nF, d).addScaledVector(P0.side, q.x);
      const id = folk.add(People.varied('steel', 300 + k, { hat: r() < 0.92 }));
      const face = P0.c.clone().sub(pos).setY(0);
      folk.set(id, { x: pos.x, z: pos.z, heading: headingTo(face) + (r() - 0.5) * 0.3, act: 'stand', visible: false });
      crowd.push({ id, d, side: r() < 0.5 ? -1 : 1, both: r() < 0.3, lag: r() * 0.16, raise: r() < 0.85 });
    }
    this.cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 600);
  }
  // the press slide for P-11 from the kick clock: down on the hit, back up over 0.45 s; the others run the tandem cycle
  strokes(t, { since = 9, until = 9, phase = 0.0 } = {}) {
    this.line.userData.setStroke(phase, 0.28);
    const P0 = this.P[0].p;
    const s = since < 0.45 ? 1 - ease(since / 0.45) : until < 0.22 ? ease(1 - until / 0.22) : 0;
    P0.userData.setStroke(s);
    return since < 1 ? Math.exp(-since * 9) : 0;                         // the ram light
  }
  weld(t, on = 1) {
    const bot = this.bot, wx = -0.25 + 0.35 * ((t * 0.35) % 1);
    bot.reach(this.cellW(wx + 0.02, 0.945, 1.115), { tilt: 0.25 });
    const tipW = bot.tip.getWorldPosition(new THREE.Vector3());
    const fl = on * (0.75 + 0.25 * Math.sin(t * 91.7) * Math.sin(t * 37.1 + 1.3));
    this.arc.position.copy(tipW).add(V3(0, 0.02, 0)); this.arcGlow.position.copy(tipW); this.arcGlow.visible = on > 0;
    const r = rng(Math.floor(t * 12) + 1), sp = this.sp;
    for (let i = 0; i < 140; i++) {
      const a = r() * TAU, v = 1.2 + r() * 3.2, up = 0.4 + r() * 1.6, age = r() * 0.35, dt = 0.018;
      const p = tt => V3(tipW.x + Math.cos(a) * v * tt, tipW.y + up * tt - 4.9 * tt * tt, tipW.z + Math.sin(a) * v * tt);
      const A = p(age), Bp = p(age + dt); if (A.y < tipW.y - 0.06) { A.y = Bp.y = tipW.y - 0.06; }
      if (!on) { A.set(0, -10, 0); Bp.set(0, -10, 0); }
      sp.set([A.x, A.y, A.z, Bp.x, Bp.y, Bp.z], i * 6);
    }
    this.sparkG.attributes.position.needsUpdate = true;
    return fl;
  }
  // the crew's poses: operators at the palm buttons (both hands forward at the station), the crowd's arms on CREW!
  pose(t, { crowd = false, up = 0 } = {}) {
    const f = this.folk;
    for (const id of this.ops) f.set(id, { t, gesture: { name: 'BANNER_LOW', side: 2, p: 0, w: 1 } });
    f.set(this.welder, { t: t + 3 });
    for (const c of this.crowd) {
      const u = c.raise ? ease((up - c.lag) / 0.5) : 0;
      f.set(c.id, { visible: crowd, t: t + c.d, fistScale: 1, gesture: u > 0 ? { name: 'OVERHEAD', side: c.both ? 2 : c.side, p: 0, w: u } : null });
    }
  }
  // shots: name, shot-local u (0..1 through the shot), and the beat's clock. Returns the canvas.
  render(shot, t, u, { since = 9, until = 9, up = 0, phase = 0 } = {}) {
    const cam = this.cam, P0 = this.P[0], at = (v, y) => v.clone().setY(y);
    let fov = 30, pos, look, w = { ram: 0, flood: 0.25, arc: 0 }, crowd = false, weld = 0;
    w.ram = this.strokes(t, { since, until, phase });
    if (shot === 'bay') {                                  // through the bay door: P-11 and its operator from behind
      pos = at(P0.op, 1.8).addScaledVector(P0.nF, 6.5).addScaledVector(P0.side, 1.2); look = at(P0.c, 2.9); fov = 34;
      w.flood = 0.6;
    } else if (shot === 'line') {                          // OUR LINE.: low along the line, the presses receding into haze
      pos = lerpV(V3(19, 1.5, 13.5), V3(17, 1.6, 11.8), u); look = V3(-9, 5.6 - 0.4 * u, -1.5); fov = 30;
    } else if (shot === 'cell') {                          // OUR PACE.: the weld arm at the beam, the arc as the light
      pos = lerpV(this.cellW(5.6, 1.45, -1.5), this.cellW(5.0, 1.42, -1.1), u); look = this.cellW(-0.3, 1.0, 0.55); fov = 30; weld = 1; w.flood = 0.1;
    } else if (shot === 'slam') {                          // over the operator's shoulder onto the die, the slide coming down
      pos = at(P0.op, 1.85).addScaledVector(P0.nF, 1.9 + 0.3 * u).addScaledVector(P0.side, 0.75); look = at(P0.die, P0.die.y - 0.1); fov = 40;
    } else if (shot === 'crowd') {                         // CREW!: the crew in hard hats before the lit press, arms going up
      pos = at(P0.c, 1.25 + 0.15 * u).addScaledVector(P0.nF, 17 - 1.2 * u).addScaledVector(P0.side, 0.6); look = at(P0.c, 4.2); fov = 32; crowd = true; w.flood = 1;
    } else {                                               // 'roll': LET 'ER ROLL., the camera travelling with the line
      pos = lerpV(V3(14, 1.25, 9), V3(5, 1.35, 8.2), u); look = V3(-14, 3.4, -0.5); fov = 31; weld = 1;
    }
    w.arc = this.weld(t, weld);
    this.pose(t, { crowd, up });
    cam.fov = fov; cam.aspect = this.W / this.H; cam.position.copy(pos); cam.lookAt(look); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    this.folk.update(cam);
    this.st.render(cam, w);
    return this.canvas;
  }
}

// ===================================================================================== the people outside (transparent layer)
// A camera that looks level along -z from height h, with its horizon at screen row hz (a 2D world's horizon): a ground
// point at distance d and lateral x lands at (W/2 + f x / d, hz + f h / d), f = H / 2 / tan(fov / 2).
export class Figures {
  constructor(W, H) {
    this.W = W; this.H = H;
    const cv = this.canvas = document.createElement('canvas'); cv.width = W; cv.height = H;
    const st = this.st = new Stage(cv, { alpha: true, ao: false, noDome: true, sky: SKIES.night, exposure: 1.0,
      key: { az: -0.8, el: 0.2, color: 0x8a98a8, intensity: 0.8 }, rim: { az: 2.4, el: 0.3, color: 0xff9a5a, intensity: 3 }, fill: { sky: 0x506070, ground: 0x202428, intensity: 0.5 } });
    st.scene.background = null; st.renderer.setClearColor(0x000000, 0);
    st.fit(new THREE.Box3(V3(-6, 0, -50), V3(6, 4, 0)));
    const folk = this.folk = new People(st.scene, { max: 48, viewH: H, budget: [12, 40] });
    this.worker = folk.add(People.varied('steel', 1966, { hat: true, fem: 0, beard: false, stubble: true }));
    this.lifters = [folk.add(People.varied('steel', 5, { hat: true })), folk.add(People.varied('steel', 12, { hat: true }))];
    const r = rng(20); this.walkerActors = [];
    for (let i = 0; i < 26; i++) this.walkerActors.push({ id: folk.add(People.varied('steel', 500 + i, { hat: r() < 0.85 })), lane: (r() - 0.5) * 3.6, d0: 7 + r() * 34, sp: 0.85 + 0.3 * r(), ph: r() * 6 });
    this.all = [this.worker, ...this.lifters, ...this.walkerActors.map(w => w.id)];
    this.cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 400);
    this.f = H / 2 / Math.tan(THREE.MathUtils.degToRad(15));
  }
  horizonCam(hz, h = 1.6, fov = 30) {
    const c = this.cam; c.fov = fov; c.aspect = this.W / this.H; c.position.set(0, h, 0); c.lookAt(0, h, -1);
    c.setViewOffset(this.W, this.H, 0, this.H / 2 - hz, this.W, this.H); c.updateProjectionMatrix(); c.updateMatrixWorld(true);
    this.f = this.H / 2 / Math.tan(THREE.MathUtils.degToRad(fov / 2)); this.h = h; this.hz = hz;
  }
  // the world point standing on the 2D ground at screen (sx, sy), and the lateral x at distance d for screen x sx
  ground(sx, sy) { const d = this.f * this.h / (sy - this.hz); return { x: (sx - this.W / 2) * d / this.f, z: -d, d }; }
  latX(sx, d) { return (sx - this.W / 2) * d / this.f; }
  light({ rim = 0xff9a5a, rimI = 3, rimAz = 2.4, key = 0x8a98a8, keyI = 0.8, keyAz = -0.8, sky = 0x506070, gnd = 0x202428, hemi = 0.5, exp = 1.0 } = {}) {
    const st = this.st;
    st.rim.color.setHex(rim); st.rim.intensity = rimI; st.rimAz = rimAz; st.key.color.setHex(key); st.key.intensity = keyI; st.keyAz = keyAz;
    st.hemi.color.setHex(sky); st.hemi.groundColor.setHex(gnd); st.hemi.intensity = hemi; st.renderer.toneMappingExposure = exp;
  }
  _go(show) {
    for (const id of this.all) this.folk.set(id, { visible: show.has(id) });
    this.folk.update(this.cam);
    this.st.fit(this._box || new THREE.Box3(V3(-6, 0, -50), V3(6, 6, 0)));
    this.st.render(this.cam);
    return this.canvas;
  }
  // the worker at the gate (A, A2, AR): profile, facing screen-right toward the gate; b4-8 (CLOCK IN.) he turns and walks
  // in toward it. walk: 0 standing, else seconds since he set off.
  gateWorker(t, { walk = -1, look = 0.12, sx = 300, d = 5.1 } = {}) {
    const x0 = this.latX(sx, d);
    let st = { x: x0, z: -d, heading: Math.PI / 2, act: 'stand', t, look };
    if (walk >= 0) {
      const turn = ease(walk / 0.5), hd = Math.PI / 2 + (Math.PI * 0.42) * turn;   // from facing +x round to facing into the lot
      const go = Math.max(0, walk - 0.25), dist = 1.3 * go;
      st = { x: x0 + Math.sin(hd) * dist, z: -d + Math.cos(hd) * dist, heading: hd, act: walk > 0.2 ? 'walk' : 'stand', ph: go * 5.6, t, look: 0 };
    }
    this.folk.set(this.worker, st);
    this._box = new THREE.Box3(V3(x0 - 3, 0, -d - 4), V3(x0 + 3, 2.2, -d + 2));
    return this._go(new Set([this.worker]));
  }
  // take a: the two on the lift, reaching up to the frame with the new owner's banner; still between cuts
  lifters(t, deckSy, baseSy, xs) {
    const g = this.ground(xs[0], baseSy), lift = (baseSy - deckSy) * g.d / this.f;
    this.lifters.forEach((id, i) => { const x = this.latX(xs[i], g.d);
      this.folk.set(id, { x, z: g.z - 0.3 * i, heading: Math.PI + (i ? -0.25 : 0.2), act: 'stand', t: t + i * 2, lift, gesture: { name: 'BANNER_TOP', side: i ? 1 : 2, p: 0, w: 1 } }); });
    this._box = new THREE.Box3(V3(-6, 0, g.z - 3), V3(6, lift + 2.5, g.z + 3));
    return this._go(new Set(this.lifters));
  }
  // the crew filing through the gate toward the bay: near = those still in front of the gate line (dGate), far = past it
  walkers(t, which, dGate, tt) {
    const show = new Set();
    for (const w of this.walkerActors) {
      const d = w.d0 + tt * 1.35 * w.sp, near = d < dGate;
      if (d > 50 || (which === 'near') !== near) continue;
      this.folk.set(w.id, { x: w.lane, z: -d, heading: Math.PI + w.lane * 0.03, act: 'walk', ph: tt * 5.6 * w.sp + w.ph, t });
      show.add(w.id);
    }
    this._box = new THREE.Box3(V3(-6, 0, -52), V3(6, 2.2, -5));
    return this._go(show);
  }
}
