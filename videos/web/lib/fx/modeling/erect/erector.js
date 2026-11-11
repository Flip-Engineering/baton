// ERECTOR (MODELING c4): the heavy-engineering giant, developed deep from c3's FRAME.
//
// The idea (c3 judge, c4 critic): FRAME was the one design with its own idea, because its finished state looks like construction.
// So this is FRAME made of the members construction is really made of, with its plates partly hung, so the finished giant still
// shows how it was made:
//   - limbs are built-up lattice columns: four angle-iron chords, riveted lacing, gussets and battens (Eiffel's Liberty armature,
//     every riveted bridge and furnace frame), not round tubes meeting at cubes;
//   - the plating follows a plan per face (painted, left in red lead, not yet hung), so the lattice shows where the plan leaves it;
//   - the shoulder is one plate girder across the top (stiffeners, flange angles, a walkway, lamp masts), the crew cab is hung
//     inside the chest cage behind a portal you can see from the front, the power house is on the back with its two stacks;
//   - every joint is a pinned bearing in a fork of cheek plates; the rams have real barrels and rods with a stroke, so a rod's
//     shine grows and shrinks as the joint works (and the pose can be checked against the stroke);
//   - the hand is a working grab: a plated palm, four fingers of three box phalanges on knuckle pins, an opposed thumb;
//   - no face, no head; one red plate (the mark, No. 1) and red lead as a stage of the work.
// In metres: hip 29 m, shoulder beam top ~52 m, mast ~58 m. A person is 1.75.
//
//   const E = new Erector(parent, { U });  E.pose(P) (see rigkit.js)  E.setBuild(u)  E.update()  E.com()  E.lifts(u)
import * as THREE from 'three';
import { Batch, V3, cbox, cyl, cylX, cylZ, along, latticeColumn, plateFace, plateAt, angleMember, flatBar, iBeam, bearing, ladder, walkway, rng } from './members.js';
import { sharedUniforms, steelMats, plainBuild, setOil } from './steel.js';
import { decalAtlas, cellUV, CHALK_KEYS } from './decals.js';
import { drawMark, RED } from '../../../closer.js';

const d2r = Math.PI / 180, lerp = (a, b, t) => a + (b - a) * t, clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
// dimensions (metres)
export const DIM = { ankleH: 4, shin: 13, thigh: 12, hipX: 5.6, hipDrop: 1.2, waistY: 2.6, chestY: 3.2, chestH: 14, chestTop: [18, 10], chestBot: [10, 8],
  shX: 13.4, shY: 13.2, beamY: 15, beamH: 3.4, beamHalf: 16.6, ua: 10.2, fa: 10.6, toe: [0, -2.6, 4.6], footW: 7.4 };
// erection plan: [start, end] of each segment's steel on the build clock; plating and paint follow
export const PLAN = {
  an: [.02, .09], toe: [.03, .09], kn: [.10, .25], hp: [.25, .38], pelvis: [.37, .44], waist: [.43, .47], chest: [.46, .60], beam: [.59, .67],
  sh: [.66, .74], el: [.73, .82], wr: [.81, .88], fing: [.84, .90],
  plate: { kn: [.22, .62, .5, .9], hp: [.36, .7, .6, .92], an: [.08, .3, .3, .7], pelvis: [.42, .6, .65, .9], chest: [.58, .86, .8, .97], beam: [.65, .8, .82, .97], sh: [.74, .9, .9, .98], el: [.8, .93, .9, .99], wr: [.86, .93, .93, .99] },
};
// c5 (MODELING c5, "the open giant"): the same erection order, but plate goes on only where a real machine needs it (soles, toes,
// the knee pad it kneels on, a mud apron at the foot of the shin, the cab, the power house, the beam's web) and it is hung LATE, after
// the chest is up, so the lower body does not close before the rest exists. The paint gang works bottom-up and at u = 1 has reached
// the hip: legs and feet in black iron paint, pelvis to beam and both arms still in red lead, the long members open lattice for good.
export const PLAN5 = {
  an: [.02, .09], toe: [.03, .09], kn: [.10, .25], hp: [.25, .38], pelvis: [.37, .44], waist: [.43, .47], chest: [.46, .60], beam: [.59, .67],
  sh: [.66, .74], el: [.73, .82], wr: [.81, .88], fing: [.84, .90],
  // [hang from, hang to, paint from, paint to]; paint > 1 = left in red lead on the finished giant
  plate: { an: [.08, .3, .74, .84], kn: [.62, .76, .82, .92], hp: [.64, .78, .9, .98], pelvis: [.6, .7, .96, 9], chest: [.58, .8, 9, 9], beam: [.65, .8, 9, 9], sh: [.74, .9, 9, 9], el: [.8, .93, 9, 9], wr: [.86, .93, .9, .97] },
  // members (the lattice itself): when the paint reaches them. Legs painted bottom-up over the last fifth; the rest stays red lead
  frame: { an: [.74, .8], kn: [.8, .9], hp: [.88, .97], pelvis: [9, 9], chest: [9, 9], sh: [9, 9], el: [9, 9] },
};
// masses (tonnes), for the centre of gravity
export const MASS = { pelvis: 520, waist: 160, chest: 900, beam: 430, hp: 380, kn: 430, an: 220, to: 60, sh: 230, el: 310, wr: 80, f: 6 };

// a hose as a tube along a curve that is rebuilt every frame (fixed topology: n rings of `rad` vertices, parallel-transport frames)
export class TubeLine {
  constructor(mat, { n = 36, rad = 6, r = .11 } = {}) {
    this.n = n; this.rad = rad; this.r = r; const nv = n * rad, idx = [];
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < rad; k++) { const a = i * rad + k, b = i * rad + (k + 1) % rad, c = a + rad, d = b + rad; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setIndex(idx); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    const st = new Float32Array(nv * 4); for (let i = 0; i < nv; i++) st.set([0, -1, .3, 0], i * 4); g.setAttribute('aStage', new THREE.BufferAttribute(st, 4));
    this.mesh = new THREE.Mesh(g, mat); this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false; if (mat.userData?.depth) this.mesh.customDepthMaterial = mat.userData.depth;
    this.curve = new THREE.CatmullRomCurve3([V3(), V3(0, 1, 0)], false, 'centripetal');
  }
  set(points) {
    this.curve.points = points; const P = this.mesh.geometry.attributes.position.array, N = this.mesh.geometry.attributes.normal.array, n = this.n, rad = this.rad;
    const pts = this.curve.getSpacedPoints(n - 1), T = V3(), Nn = V3(), Bn = V3(), tmp = V3();
    for (let i = 0; i < n; i++) {
      T.copy(pts[Math.min(n - 1, i + 1)]).sub(pts[Math.max(0, i - 1)]).normalize();
      if (i === 0) { Nn.set(0, 1, 0); if (Math.abs(T.dot(Nn)) > .9) Nn.set(1, 0, 0); Nn.addScaledVector(T, -T.dot(Nn)).normalize(); } else { Nn.addScaledVector(T, -T.dot(Nn)).normalize(); }
      Bn.crossVectors(T, Nn);
      for (let k = 0; k < rad; k++) { const a = k / rad * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a); tmp.copy(Nn).multiplyScalar(c).addScaledVector(Bn, sn); const j = (i * rad + k) * 3;
        N[j] = tmp.x; N[j + 1] = tmp.y; N[j + 2] = tmp.z; P[j] = pts[i].x + tmp.x * this.r; P[j + 1] = pts[i].y + tmp.y * this.r; P[j + 2] = pts[i].z + tmp.z * this.r; }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true; this.mesh.geometry.attributes.normal.needsUpdate = true; this.mesh.geometry.computeBoundingSphere();
  }
}

export class Erector {
  // design: 'c4' (default: MODELING c4's plating, unchanged, so LIGHTING's A/B renders stay identical) | 'c5' (open lattice, late
  // plate, a paint front at the hip, real laps, rivet heads as geometry, hose loops on the rams, fingers that close on what they hold)
  constructor(parent, { U = null, seed = 4, quant = 90, mats = null, crew = true, snow = .7, design = 'c4' } = {}) {
    this.design = design; this.C5 = design === 'c5'; this.PLAN = this.C5 ? PLAN5 : PLAN;
    this.U = U || sharedUniforms(); this.U.uSnow.value = snow; this.M = mats || steelMats(this.U); this.R = rng(seed); this.quant = quant;
    this.decal = plainBuild(this.U, { map: decalAtlas().tex, alphaTest: .45, roughness: .85, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.M.decal = this.decal; this.chalk = CHALK_KEYS(); this.chalkI = 0;
    this.g = new THREE.Group(); this.g.name = 'erector'; parent.add(this.g);
    this.batches = []; this.rams = []; this.segMeshes = []; this.crewOn = crew;
    const D = DIM, J = this.J = {};
    const node = (p, pos, name) => { const o = new THREE.Group(); o.position.set(...pos); o.name = name; (p || this.g).add(o); J[name] = o; return o; };
    this.hipY = D.ankleH + D.shin + D.thigh; this.rootY = this.hipY + D.hipDrop;
    node(this.g, [0, this.rootY, 0], 'root'); node(J.root, [0, 0, 0], 'pelvis'); node(J.root, [0, D.waistY, 0], 'waist'); node(J.waist, [0, D.chestY, 0], 'chest'); node(J.chest, [0, 0, 0], 'beam');
    for (const s of [1, -1]) { const L = s > 0 ? 'L' : 'R';
      node(J.chest, [s * D.shX, D.shY, 0], 'sh' + L); node(J['sh' + L], [0, -D.ua, 0], 'el' + L); node(J['el' + L], [0, -D.fa, 0], 'wr' + L);
      node(J.root, [s * D.hipX, -D.hipDrop, 0], 'hp' + L); node(J['hp' + L], [0, -D.thigh, 0], 'kn' + L); node(J['kn' + L], [0, -D.shin, 0], 'an' + L); node(J['an' + L], D.toe, 'to' + L); }
    this.buildAll();
    this.addMark(); this.g.updateMatrixWorld(true); this.bakeRest(); this.measureMasses(); this.setupRams();
    this.restQ = {}; for (const k in J) this.restQ[k] = J[k].quaternion.clone();
    this.setBuild(1); this.update();
  }
  batch(seg, side = 0) { const B = new Batch({ seed: Math.floor(this.R() * 1e6), quant: this.quant, side, rivets: this.C5 ? { r: .075, p: .46 } : null }); B.seg = seg; if (this.C5) B.defPaint = { pelvis: 9, waist: 9, chest: 9, beam: 9, sh: 9, el: 9 }[seg] ?? null; this.batches.push(B); return B; }
  // c5: the lattice paint front for a segment: f(t_) along a column (t_ 0 top .. 1 bottom), painted bottom-up between the plan's two times
  // c5 lattice: a crane boom's proportions, not a solid built-up column: single (Warren) diagonals of narrow flat bar, battens and
  // diaphragms only at the ends, small gussets, lighter chords. At 270 px the c4 column (X lacing 0.46 m on four faces, a batten
  // every panel) closed up almost solid in any three-quarter view.
  lat(o) { if (!this.C5) return o; return { ...o, a: (o.a || .8) * .78, t: (o.t || .09) * .9, lace: (o.lace || .44) * .62, laceT: .05, pattern: 'Z', battenEvery: 0, gusset: [.85, .95], diaph: 'ends', panel: (o.panel || 3) * 1.25 }; }
  framePaint(seg, s = 1) { if (!this.C5) return -1; const fr = this.PLAN.frame[seg]; if (!fr || fr[0] > 1) return 9; return t_ => lerp(fr[0], fr[1], 1 - t_) + (s < 0 ? .004 : 0); }
  finish(B, joint, name) { const g = B.build(this.M, { name }); this.J[joint].add(g); B.group = g; B.joint = joint; g.traverse(o => { if (o.isMesh) this.segMeshes.push(o); }); return g; }
  // a decal quad on a face: key in the atlas; stage: { thr, paint (visible after), hide (chalk: hidden after its plate is painted) }
  decalQuad(B, key, C, nrm, up, w, h, { thr = 0, after = -1, hide = 0 } = {}) {
    const z = nrm.clone().normalize(), y = up.clone().addScaledVector(z, -up.dot(z)).normalize(), x = new THREE.Vector3().crossVectors(y, z);
    const m = new THREE.Matrix4().makeBasis(x, y, z); m.setPosition(C.clone().addScaledVector(z, .03));
    B.push('decal', new THREE.PlaneGeometry(w, h), m, { thr, paint: after, wear: hide ? -hide : 0, uv: cellUV(key), edge: false, aoConst: 1, noLift: true });
  }
  nextChalk() { return this.chalk[(this.chalkI++) % this.chalk.length]; }

  // ------------------------------------------------------------------------------------------------ the segments
  buildAll() {
    const D = DIM, P = this.PLAN, R = this.R, C5 = this.C5;
    // ---------------- feet (ankle pin at the origin; sole at y = -4)
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R', B = this.batch('an', s), [t0, t1] = P.an, fw = D.footW, ys = -D.ankleH;
      const th = f => lerp(t0, t1, f) + (s < 0 ? .006 : 0);
      bearing(B, V3(0, 0, 0), 1.8, 4.4, { thr: th(.8), wear: .7 });
      for (const q of [1, -1]) plateAt(B, V3(q * 2.5, -1.4, -.2), V3(q, 0, 0), V3(0, 1, 0), 5.2, 3.4, { t: .45, c: .12, thr: th(.7), sys: 'plate', paint: lerp(P.plate.an[2], P.plate.an[3], .3), wear: .7 });
      // the heel box: four plated sides, deck, sole with grouser bars, vertical stiffeners
      const z0 = -4.4, z1 = 4.3, y0 = ys + .5, y1 = -1.0, zc = (z0 + z1) / 2, hh = y1 - y0;
      const pnt = f => lerp(P.plate.an[2], P.plate.an[3], f);
      for (const q of [1, -1]) {
        const xs = q * fw / 2;
        for (let k = 0; k < 3; k++) { const zz = lerp(z0, z1, (k + .5) / 3); plateAt(B, V3(xs, (y0 + y1) / 2, zz), V3(q, 0, 0), V3(0, 1, 0), (z1 - z0) / 3 - .08, hh, { t: .2, thr: th(.25 + k * .05), paint: pnt(.2 + k * .1), wear: .6, lap: 0 }); }
        for (let k = 0; k <= 6; k++) { const zz = lerp(z0 + .3, z1 - .3, k / 6); flatBar(B, V3(xs + q * .2, y0, zz), V3(xs + q * .2, y1, zz), V3(q, 0, 0), { w: .3, t: .3, sys: 'plate', thr: th(.35), paint: pnt(.4), wear: .5 }); }
      }
      for (const q of [1, -1]) plateAt(B, V3(0, (y0 + y1) / 2, q > 0 ? z1 : z0), V3(0, 0, q), V3(0, 1, 0), fw - .1, hh, { t: .2, thr: th(.3), paint: pnt(.3), wear: .7 });
      plateAt(B, V3(0, y1 + .08, zc), V3(0, 1, 0), V3(0, 0, -1), fw - .1, z1 - z0, { t: .16, thr: th(.5), paint: pnt(.5), wear: .4 });
      B.push('mill', cbox(fw + .3, .5, z1 - z0 + .4, .1), new THREE.Matrix4().makeTranslation(0, ys + .25, zc), { thr: th(.05), wear: 1, aoConst: .7 });
      for (let k = 0; k < 8; k++) B.push('mill', cbox(fw + .2, .28, .35, .05), new THREE.Matrix4().makeTranslation(0, ys + .05, lerp(z0 + .4, z1 - .4, k / 7)), { thr: th(.05), wear: 1, aoConst: .6 });
      // crew door, a rail round the deck, the leg's stencil
      plateAt(B, V3(s * (fw / 2 + .18), ys + 2.2, -1.2), V3(s, 0, 0), V3(0, 1, 0), 1.0, 2.0, { t: .1, sys: 'mill', thr: th(.6), wear: .9 });
      walkway(B, V3(-fw / 2 + .2, y1 + .2, z0 + .4), V3(fw / 2 - .2, y1 + .2, z0 + .4), V3(0, 0, 1), { w: .01, thr: th(.9) });
      this.decalQuad(B, 'st:' + L + '-1', V3(s * (fw / 2 + .12), ys + 2.6, 2.2), V3(s, 0, 0), V3(0, 1, 0), 2.6, 1.3, { thr: th(.5), after: pnt(.6) });
      this.decalQuad(B, 'hazard', V3(0, ys + .9, z1 + .12), V3(0, 0, 1), V3(0, 1, 0), fw * .9, .7, { thr: th(.5), after: pnt(.6) });
      this.finish(B, 'an' + L, 'foot' + L);
      // the toe: hinged at the front of the heel box
      const T = this.batch('toe', s), tt = f => lerp(P.toe[0], P.toe[1], f);
      bearing(T, V3(0, 0, 0), .8, fw - 1, { thr: tt(.2), wear: .8, bolts: 8 });
      const ty0 = ys - D.toe[1] + .5, tz1 = 4.0;
      for (const q of [1, -1]) plateAt(T, V3(q * fw / 2, (ty0 + 1.1) / 2, tz1 / 2), V3(q, 0, 0), V3(0, 1, 0), tz1, 1.1 - ty0, { t: .2, thr: tt(.4), paint: pnt(.4), wear: .8 });
      plateAt(T, V3(0, 1.1, tz1 / 2 - .2), V3(0, 1, 0), V3(0, 0, -1), fw - .1, tz1 - .4, { t: .16, thr: tt(.5), paint: pnt(.5), wear: .6 });
      const nose = new THREE.Matrix4().makeTranslation(0, (ty0 + 1.1) / 2 - .2, tz1 + .1).multiply(new THREE.Matrix4().makeRotationX(.35));
      T.push('plate', cbox(fw, 1.1 - ty0 + .4, .3, .1), nose, { thr: tt(.6), paint: pnt(.6), wear: 1, plate: [fw, 2] });
      T.push('mill', cbox(fw + .3, .5, tz1 + .4, .1), new THREE.Matrix4().makeTranslation(0, ty0 - .25, tz1 / 2), { thr: tt(.1), wear: 1, aoConst: .7 });
      for (let k = 0; k < 4; k++) T.push('mill', cbox(fw + .2, .28, .35, .05), new THREE.Matrix4().makeTranslation(0, ty0 - .45, lerp(.4, tz1 - .2, k / 3)), { thr: tt(.1), wear: 1, aoConst: .6 });
      this.decalQuad(T, 'hazard2', V3(0, ty0 + .4, tz1 + .28), V3(0, -.35, 1), V3(0, 1, 0), fw * .9, .6, { thr: tt(.6), after: pnt(.7) });
      this.finish(T, 'to' + L, 'toe' + L);
    }
    // ---------------- shins (knee pin at the origin)
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R', B = this.batch('kn', s), [t0, t1] = P.kn, th = f => lerp(t0, t1, f) + (s < 0 ? .006 : 0), pp = P.plate.kn;
      const col = latticeColumn(B, this.lat({ y0: -2.4, h: 9.2, top: [4.6, 4.8], bot: [5.6, 5.8], a: .8, t: .1, panel: 3.05, lace: .46, battenEvery: 1, thr: [th(.15), th(.85)], wear: .3, paint: this.framePaint('kn', s) }));
      bearing(B, V3(0, 0, 0), 2.5, 4.4, { thr: th(.95), wear: .6, bolts: 14 });
      // the knee cheeks: c5 cuts them to the bearing's fork (a pair of narrow cheeks, not a box round the joint)
      for (const q of [1, -1]) plateAt(B, V3(q * 2.45, C5 ? -.9 : -1.2, 0), V3(q, 0, 0), V3(0, 1, 0), C5 ? 3.4 : 5.4, C5 ? 3.6 : 4.6, { t: .5, c: .14, thr: th(.9), paint: lerp(pp[2], pp[3], .1), wear: .6 });
      // the knee pad: what it kneels on (heavy use: chipped to bare steel at the edges)
      const kc = new THREE.Matrix4().makeTranslation(0, -.6, C5 ? 2.8 : 3.0).multiply(new THREE.Matrix4().makeRotationX(-.18));
      if (C5) plateAt(B, V3(0, -.6, 2.8), V3(0, -.18, 1), V3(0, 1, 0), 3.8, 4.4, { t: .6, c: .22, thr: th(.96), paint: lerp(pp[2], pp[3], .05), wear: 1.05 });   // c5: a narrower pad, riveted
      else B.push('plate', cbox(4.8, 5.4, 1.0, .3), kc, { thr: th(.96), paint: lerp(pp[2], pp[3], .05), wear: 1.05, plate: [4.8, 5.4] });
      // ankle shroud at the foot of the shin
      for (const [f, nn] of [['f', V3(0, 0, 1)], ['b', V3(0, 0, -1)], ['l', V3(1, 0, 0)], ['r', V3(-1, 0, 0)]]) { if (C5 && f !== 'f') continue; const w = f === 'f' || f === 'b' ? 6.2 : 6.4; plateAt(B, V3(0, -12.3, 0).addScaledVector(nn, f === 'f' || f === 'b' ? 3.15 : 3.05), nn, V3(0, 1, 0), w, 2.4, { t: .3, c: .1, thr: C5 ? pp[0] : th(.05), paint: lerp(pp[2], pp[3], .05), wear: .8 }); }
      // plating plans: the front greave mostly hung; the outer side half; the inside open. Different per leg.
      const R2 = rng(s > 0 ? 11 : 12);
      if (C5) {
        // c5: one mud apron on the front of the shin's foot, in two lapped courses (the wear face a crawler's track frame plates);
        // the right leg's upper course is not hung yet (a front of work you can see from the front)
        plateFace(B, col, 'f', s > 0 ? ['PP', 'PP'] : ['..', 'PP'], { t0: .62, t1: 1, thr: [pp[0], pp[1]], paintAt: [pp[2], pp[3]], R: R2, overlap: .3 });
      } else {
      // the greave: the front's lower two-thirds in two big courses; the right shin's top course is a repair still in red lead
      plateFace(B, col, 'f', s > 0 ? ['PP', 'PP'] : ['RR', 'PP'], { t0: .34, t1: 1, thr: [pp[0], pp[1]], paintAt: [pp[2], pp[3]], R: R2 });
      plateFace(B, col, s > 0 ? 'l' : 'r', s > 0 ? ['P.', 'PP'] : ['.P', 'PP'], { t0: .5, t1: 1, thr: [pp[0], pp[1]], paintAt: [pp[2], pp[3]], R: R2 });
      }
      ladder(B, s * 3.4, -1.2, -12.6, -1.6, V3(s, 0, 0), { thr: th(.9) });
      this.decalQuad(B, 'st:KNEE ' + L, V3(s * 2.75, -3.2, 0), V3(s, 0, 0), V3(0, 1, 0), 3.0, 1.2, { thr: th(.9), after: lerp(pp[2], pp[3], .2) });
      this.decalQuad(B, 'n' + (s > 0 ? 3 : 4), V3(0, -9.5, 3.42), V3(0, 0, 1), V3(0, 1, 0), 1.6, .8, { thr: pp[0] + .05, after: lerp(pp[2], pp[3], .4) });
      for (let k = 0; k < 3; k++) this.decalQuad(B, this.nextChalk(), V3((k - 1) * 1.6, -4.5 - k * 2, 3.4), V3(0, 0, 1), V3(0, 1, 0), 1.4, .7, { thr: pp[0] + .02, hide: lerp(pp[2], pp[3], .5) });
      this.finish(B, 'kn' + L, 'shin' + L);
    }
    // ---------------- thighs (hip pin at the origin)
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R', B = this.batch('hp', s), [t0, t1] = P.hp, th = f => lerp(t0, t1, f) + (s < 0 ? .005 : 0), pp = P.plate.hp;
      const col = latticeColumn(B, this.lat({ y0: -2.6, h: 7.4, top: [5.2, 5.2], bot: [4.5, 4.7], a: .8, t: .1, panel: 2.5, lace: .46, battenEvery: 1, thr: [th(.1), th(.85)], wear: .25, paint: this.framePaint('hp', s) }));
      const fp = C5 ? this.framePaint('hp', s) : null, pk = (v, t_) => C5 ? fp(t_) : v;
      for (const q of [1, -1]) plateAt(B, V3(q * 2.0, C5 ? -.8 : -1.0, 0), V3(q, 0, 0), V3(0, 1, 0), C5 ? 3.6 : 5.2, C5 ? 3.4 : 4.2, { t: .45, c: .12, thr: th(.9), paint: pk(lerp(pp[2], pp[3], .3), 0), wear: .5 });
      for (const q of [1, -1]) plateAt(B, V3(q * 2.85, C5 ? -11.7 : -11.4, 0), V3(q, 0, 0), V3(0, 1, 0), C5 ? 3.6 : 5.6, C5 ? 3.4 : 4.0, { t: .45, c: .12, thr: th(.05), paint: pk(lerp(pp[2], pp[3], .05), 1), wear: .6 });
      const R2 = rng(s > 0 ? 21 : 22);
      // the thigh stays a lattice; one armour course on the outside, half hung (c5: none: the thigh is a lattice for good)
      if (!C5) plateFace(B, col, s > 0 ? 'l' : 'r', s > 0 ? ['PP'] : ['P.'], { t0: .3, t1: .75, thr: [pp[0], pp[1]], paintAt: [pp[2], pp[3]], R: R2 });
      this.decalQuad(B, 'st:HIP ' + L, V3(s * 3.0, -4, 0), V3(s, 0, 0), V3(0, 1, 0), 2.8, 1.1, { thr: th(.9), after: lerp(pp[2], pp[3], .5) });
      this.decalQuad(B, 'n' + (s > 0 ? 5 : 6), V3(s * 3.0, -8.5, 1.2), V3(s, 0, 0), V3(0, 1, 0), 1.6, .8, { thr: pp[0] + .05, after: lerp(pp[2], pp[3], .5) });
      this.finish(B, 'hp' + L, 'thigh' + L);
    }
    // ---------------- pelvis: two deep plate girders, a deck and the slewing ring; the hip bearings in their cheeks
    {
      const B = this.batch('pelvis'), [t0, t1] = P.pelvis, th = f => lerp(t0, t1, f), pp = P.plate.pelvis;
      for (const q of [1, -1]) {
        const zc = q * 3.6;
        // a riveted Warren truss in each girder plane: chords of paired angles, diagonals, verticals, gussets at the nodes
        const nP = 6, xA = -6.9, xB = 6.9, yb = -2.3, yt = 2.5;
        const fpv = C5 ? 9 : -1;
        for (const y of [yb, yt]) for (const zz of [zc - .35, zc + .35]) angleMember(B, V3(xA, y, zz), V3(xB, y, zz), V3(0, y > 0 ? -1 : 1, 0), V3(0, 0, zz > zc ? 1 : -1), { a: .55, t: .08, thr: th(.1), paint: fpv });
        for (let k = 0; k <= nP; k++) { const x = lerp(xA, xB, k / nP);
          iBeam(B, V3(x, yb, zc), V3(x, yt, zc), V3(0, 0, 1), { h: .55, b: .5, thr: th(.2 + k * .03), wear: .3, paint: fpv });
          for (const y of [yb, yt]) plateAt(B, V3(x, y + (y > 0 ? -.55 : .55), zc + q * .32), V3(0, 0, q), V3(0, 1, 0), 1.7, 1.4, { t: .05, sys: 'frame', thr: th(.25), wear: .3, paint: fpv });
          if (k < nP) { const x1 = lerp(xA, xB, (k + 1) / nP), up = k % 2 === 0; iBeam(B, V3(x, up ? yb : yt, zc), V3(x1, up ? yt : yb, zc), V3(0, 0, 1), { h: .5, b: .45, thr: th(.3 + k * .03), wear: .3, paint: fpv }); } }
      }
      for (let k = 0; k < 3; k++) flatBar(B, V3(lerp(-4, 4, k / 2), 2.4, -3.4), V3(lerp(-4, 4, k / 2), 2.4, 3.4), V3(0, 1, 0), { w: .6, t: .12, thr: th(.4), wear: .2, ao: () => .6 });
      B.push('grating', cbox(12.8, .1, 7.0, .02), new THREE.Matrix4().makeTranslation(0, 2.75, 0), { thr: th(.5), wear: .6, aoConst: .85 });
      B.push('mill', cyl(3.9, .7, 40), new THREE.Matrix4().makeTranslation(0, 3.1, 0), { thr: th(.7), wear: .6, edge: false, aoConst: .8 });
      for (const s of [1, -1]) { bearing(B, V3(s * DIM.hipX, -DIM.hipDrop, 0), 2.7, 7.2, { thr: th(.8), wear: .6 }); for (const q of [1, -1]) plateAt(B, V3(s * DIM.hipX + q * 3.3, C5 ? -1.3 : -1.6, 0), V3(q, 0, 0), V3(0, 1, 0), C5 ? 4.2 : 6.4, C5 ? 4.6 : 6.0, { t: .5, c: .14, thr: th(.75), paint: lerp(pp[2], pp[3], .2), wear: .5 }); }
      ladder(B, -2.6, -3.6, -2.4, 2.75, V3(0, 0, 1), { thr: th(.9) });
      this.finish(B, 'pelvis', 'pelvis');
    }
    // ---------------- waist: the turret the chest slews on (a crane's slewing ring, its gear and bolts)
    {
      const B = this.batch('waist'), [t0, t1] = P.waist, th = f => lerp(t0, t1, f);
      B.push('mill', cyl(3.3, 3.2, 40), new THREE.Matrix4().makeTranslation(0, 1.6, 0), { thr: th(.2), wear: .5, edge: false, aoConst: .7 });
      B.push('mill', cyl(3.75, .5, 40), new THREE.Matrix4().makeTranslation(0, .35, 0), { thr: th(.3), wear: .8, edge: false, aoConst: .8 });
      for (let k = 0; k < 64; k++) { const a = k / 64 * Math.PI * 2; B.push('mill', cbox(.36, .42, .3, .04), new THREE.Matrix4().makeTranslation(Math.cos(a) * 3.82, .35, Math.sin(a) * 3.82).multiply(new THREE.Matrix4().makeRotationY(-a)), { thr: th(.3), wear: 1, aoConst: .8, noLift: true }); }
      for (let k = 0; k < 40; k++) { const a = k / 40 * Math.PI * 2; B.push('chrome', cyl(.1, .3, 6), new THREE.Matrix4().makeTranslation(Math.cos(a) * 3.0, 3.25, Math.sin(a) * 3.0), { thr: th(.6), wear: .2, edge: false, noLift: true }); }
      // two slew motors with their pinions
      for (const s of [1, -1]) B.push('plate', cbox(1.6, 2.2, 1.6, .2), new THREE.Matrix4().makeTranslation(s * 3.2, 1.6, -2.2), { thr: th(.7), paint: .9, wear: .5 });
      this.finish(B, 'waist', 'waist');
    }
    // ---------------- chest: the cage (a tapering lattice), ring girders, decks, the cab behind a portal, the power house
    {
      const B = this.batch('chest'), [t0, t1] = P.chest, th = f => lerp(t0, t1, f), pp = P.plate.chest, H = DIM.chestH;
      const col = latticeColumn(B, this.lat({ y0: H, h: H, top: DIM.chestTop, bot: DIM.chestBot, a: 1.0, t: .12, panel: 3.5, lace: .6, laceT: .08, battenEvery: 2, thr: [th(.05), th(.7)], wear: .25, faces: 'blr', paint: C5 ? 9 : -1 }));
      // the front face: X lacing in the lowest and the top panels; the middle is a portal (knee braces) the cab looks out of
      const gF = (sx, t_) => col.gauge(sx, 1, t_, V3(0, 0, 1));
      const lift = V3(0, 0, .12);
      for (const [ta, tb] of [[1, .75], [.25, 0]]) { flatBar(B, gF(-1, ta).add(lift), gF(1, tb).add(lift), V3(0, 0, 1), { w: .6, t: .08, thr: th(1 - ta), wear: .3, ext: .2 }); flatBar(B, gF(1, ta).add(lift).add(V3(0, 0, .08)), gF(-1, tb).add(lift).add(V3(0, 0, .08)), V3(0, 0, 1), { w: .6, t: .08, thr: th(1 - ta), wear: .3, ext: .2 }); }
      for (const t_ of [0, .25, .5, .75, 1]) { const A = gF(-1, t_), Bp = gF(1, t_); iBeam(B, A.clone().add(V3(0, 0, -.5)), Bp.clone().add(V3(0, 0, -.5)), V3(0, 1, 0), { h: 1.1, b: .7, thr: th(1 - t_), wear: .3, ao: () => .8 }); }
      for (const sx of [1, -1]) { flatBar(B, gF(sx, .75).add(V3(0, 0, .1)), gF(sx, .75).lerp(gF(-sx, .75), .25).add(V3(0, -2.6, .1)), V3(0, 0, 1), { w: .8, t: .1, thr: th(.4), wear: .3 }); flatBar(B, gF(sx, .25).add(V3(0, 0, .1)), gF(sx, .25).lerp(gF(-sx, .25), .22).add(V3(0, 2.4, .1)), V3(0, 0, 1), { w: .8, t: .1, thr: th(.4), wear: .3 }); }
      // ring girders inside at the deck levels, gratings with rails (people stand here)
      for (const [t_, yy] of [[.643, 5.0], [.32, 9.5]]) { const [w, d] = col.dim(t_); for (const q of [1, -1]) iBeam(B, V3(-w / 2 + .8, yy, q * (d / 2 - .8)), V3(w / 2 - .8, yy, q * (d / 2 - .8)), V3(0, 1, 0), { h: .9, b: .5, thr: th(1 - t_), ao: () => .7 });
        B.push('grating', cbox(w - 2.2, .1, d - 2.2, .02), new THREE.Matrix4().makeTranslation(0, yy + .5, 0), { thr: th(1 - t_ + .05), wear: .7, aoConst: .75 });
        walkway(B, V3(-w / 2 + 1.2, yy + .55, d / 2 - 1.3), V3(w / 2 - 1.2, yy + .55, d / 2 - 1.3), V3(0, 0, -1), { w: .01, thr: th(1 - t_ + .06) }); }
      // the cab, hung from the upper deck, its glazing leaning out at the portal
      const cab = { w: 8.4, h: 3.8, d: 5.0, y: 6.4, z: 1.2 };
      B.push('plate', cbox(cab.w, .6, cab.d + .4, .1), new THREE.Matrix4().makeTranslation(0, cab.y - cab.h / 2 - .3, cab.z), { thr: th(.75), paint: lerp(pp[2], pp[3], .5), wear: .5 });
      B.push('plate', cbox(cab.w + .3, .7, cab.d + .6, .15), new THREE.Matrix4().makeTranslation(0, cab.y + cab.h / 2 + .35, cab.z), { thr: th(.76), paint: lerp(pp[2], pp[3], .5), wear: .4 });
      B.push('cab', cbox(cab.w - .4, cab.h, cab.d - .6, .05), new THREE.Matrix4().makeTranslation(0, cab.y, cab.z - .3), { thr: th(.75), edge: false });
      for (const q of [1, -1]) B.push('plate', cbox(.4, cab.h, cab.d, .08), new THREE.Matrix4().makeTranslation(q * cab.w / 2, cab.y, cab.z), { thr: th(.75), paint: lerp(pp[2], pp[3], .5), wear: .5 });
      { const gm = new THREE.Matrix4().makeTranslation(0, cab.y, cab.z + cab.d / 2).multiply(new THREE.Matrix4().makeRotationX(-.22));
        B.push('glass', cbox(cab.w - .6, cab.h - .5, .06, .01), gm, { thr: th(.78), edge: false });
        for (let k = 0; k <= 6; k++) B.push('plate', cbox(.18, cab.h - .4, .2, .03), gm.clone().multiply(new THREE.Matrix4().makeTranslation(lerp(-cab.w / 2 + .3, cab.w / 2 - .3, k / 6), 0, .08)), { thr: th(.78), paint: .9, wear: .3, noLift: true });
        this.cabFront = V3(0, cab.y, cab.z + cab.d / 2); }
      if (this.crewOn) { const RR = rng(77); for (let i = 0; i < 4; i++) { const x = (i - 1.5) * 1.8 + (RR() - .5) * .5; const m = new THREE.Matrix4().makeTranslation(x, cab.y - .9, cab.z + 1.2); B.push('rubber', cyl(.24, 1.2, 8), m, { thr: th(.8), edge: false, noLift: true }); B.push('rubber', cyl(.16, .3, 8).translate(0, .85, 0), m, { thr: th(.8), edge: false, noLift: true }); } }
      // the front plating: the lower panel mostly hung; the upper corners; the mark plate goes top left
      const R2 = rng(31);
      if (C5) {
        // c5: the cage stays open: a belly band under the cab (where the crew's deck and the slew drives are) and one lapped
        // course low on each side; the cab and the power house are the closed parts
        plateFace(B, col, 'f', ['PP'], { t0: .8, t1: 1, thr: [pp[0], pp[1]], paintAt: [pp[2], pp[3]], R: R2, out: .5 });
        plateFace(B, col, 'l', ['P..'], { t0: .78, t1: 1, thr: [pp[0], pp[1]], paintAt: [pp[2], pp[3]], R: R2 });
        plateFace(B, col, 'r', ['..P'], { t0: .78, t1: 1, thr: [pp[0], pp[1]], paintAt: [pp[2], pp[3]], R: R2 });
      } else {
      plateFace(B, col, 'f', ['PP'], { t0: .75, t1: 1, thr: [pp[0], pp[1]], paintAt: [pp[2], pp[3]], R: R2, out: .5 });
      plateFace(B, col, 'l', ['PP.', '...', '...', 'PPR'], { thr: [pp[0], pp[1]], paintAt: [pp[2], pp[3]], R: R2 });
      plateFace(B, col, 'r', ['.PP', '...', '...', 'PPP'], { thr: [pp[0], pp[1]], paintAt: [pp[2], pp[3]], R: R2 });
      }
      // the power house on the back: plated, louvred, two stacks up through the beam (c5: lower and set in, so the kneeling
      // profile is not a hunched backpack: 5.2 m tall and 1.4 m closer to the cage)
      { const zb = -DIM.chestTop[1] / 2 - (C5 ? .8 : 2.2), yb = C5 ? 4.6 : 6.2, hb = C5 ? 5.2 : 7.6, wb = C5 ? 9 : 10;
        for (let k = 0; k < 3; k++) plateAt(B, V3(lerp(-wb / 3, wb / 3, k / 2), yb, zb - 2), V3(0, 0, -1), V3(0, 1, 0), wb / 3 - .1, hb, { t: .2, thr: th(.8), paint: lerp(pp[2], pp[3], .6), wear: .4 });
        for (const q of [1, -1]) plateAt(B, V3(q * wb / 2, yb, zb), V3(q, 0, 0), V3(0, 1, 0), 4, hb, { t: .2, thr: th(.8), paint: lerp(pp[2], pp[3], .6), wear: .4 });
        plateAt(B, V3(0, yb + hb / 2, zb), V3(0, 1, 0), V3(0, 0, 1), wb, 4, { t: .2, thr: th(.82), paint: lerp(pp[2], pp[3], .6), wear: .4 });
        for (const q of [1, -1]) { const gv = new THREE.Matrix4().makeTranslation(q * 2.6, yb + 1, zb - 2.18); for (let k = 0; k < (C5 ? 10 : 14); k++) B.push('mill', cbox(3.6, .16, .28, .02), gv.clone().multiply(new THREE.Matrix4().makeTranslation(0, -2.4 + k * .36, 0)).multiply(new THREE.Matrix4().makeRotationX(.6)), { thr: th(.85), wear: .5, aoConst: .7, noLift: true }); }
        const sh = C5 ? 15.6 : 14;
        for (const q of [1, -1]) { B.push('mill', cyl(.95, sh, 20), new THREE.Matrix4().makeTranslation(q * 2.6, yb + hb / 2 + sh / 2, zb - .2), { thr: th(.9), wear: .3, edge: false, aoConst: .9 }); B.push('mill', cyl(1.15, .5, 20), new THREE.Matrix4().makeTranslation(q * 2.6, yb + hb / 2 + sh - .2, zb - .2), { thr: th(.9), wear: .3, edge: false }); }
        this.stacks = [V3(2.6, yb + hb / 2 + sh + .2, zb - .2), V3(-2.6, yb + hb / 2 + sh + .2, zb - .2)]; }
      ladder(B, 3.2, -3.0, .5, H - .2, V3(0, 0, 1), { thr: th(.9) });
      for (let k = 0; k < 3; k++) this.decalQuad(B, this.nextChalk(), V3(-4 + k * 3.5, 2 + k * .8, 4.9), V3(0, 0, 1), V3(0, 1, 0), 1.6, .8, { thr: pp[0] + .02, hide: lerp(pp[2], pp[3], .5) });
      this.markAt = { p: V3(-6.1, 12.1, DIM.chestTop[1] / 2 + .78), w: 3.6 };
      this.finish(B, 'chest', 'chest');
    }
    // ---------------- the shoulder beam: a plate girder box across the top, with its walkway, masts and lamps
    {
      const B = this.batch('beam'), [t0, t1] = P.beam, th = f => lerp(t0, t1, f), pp = P.plate.beam, y0 = DIM.beamY, h = DIM.beamH, X = DIM.beamHalf, ym = y0 + h / 2;
      const n = 12;
      for (const q of [1, -1]) {
        const zc = q * 2.3;
        for (let k = 0; k < n; k++) { const xa = lerp(-X, X, k / n), xb = lerp(-X, X, (k + 1) / n), f = Math.abs((xa + xb) / 2) / X; const isR = (q > 0 && (k === 3 || k === 9)) || (q < 0 && k === 6);
          plateAt(B, V3((xa + xb) / 2, ym, zc), V3(0, 0, q), V3(0, 1, 0), xb - xa - .06, h - .1, { t: .16, thr: th(.1 + .5 * (1 - f)), paint: isR ? 9 : lerp(pp[2], pp[3], f), wear: .35, ao: (p, nn) => nn.z * q < 0 ? .3 : .92, rows: 'lr' }); }
        for (let k = 0; k <= n; k++) { const x = lerp(-X, X, k / n); flatBar(B, V3(x, y0 + .2, zc + q * .32), V3(x, y0 + h - .2, zc + q * .32), V3(0, 0, q), { w: .55, t: .08, sys: 'plate', thr: th(.5), paint: lerp(pp[2], pp[3], .5), wear: .45 }); }
        for (const y of [y0 + .12, y0 + h - .12]) angleMember(B, V3(-X, y, zc + q * .1), V3(X, y, zc + q * .1), V3(0, y > ym ? -1 : 1, 0), V3(0, 0, q), { a: .6, t: .08, thr: th(.3) });
      }
      for (const y of [y0, y0 + h]) for (let k = 0; k < 6; k++) { const xa = lerp(-X, X, k / 6), xb = lerp(-X, X, (k + 1) / 6); plateAt(B, V3((xa + xb) / 2, y, 0), V3(0, y > ym ? 1 : -1, 0), V3(1, 0, 0), 5.4, xb - xa - .05, { t: .18, thr: th(.2 + k * .04), paint: lerp(pp[2], pp[3], .5), wear: .4 }); }
      for (const s of [1, -1]) plateAt(B, V3(s * X, ym, 0), V3(s, 0, 0), V3(0, 1, 0), 5.0, h, { t: .25, thr: th(.6), paint: lerp(pp[2], pp[3], .6), wear: .6 });
      // bearing pads on the chest top, the shoulder forks below the ends
      for (const sx of [1, -1]) for (const sz of [1, -1]) B.push('mill', cbox(1.8, 1.0, 1.8, .1), new THREE.Matrix4().makeTranslation(sx * 8.2, y0 - .5, sz * 4.2), { thr: th(.05), wear: .6 });
      for (const s of [1, -1]) { for (const q of [1, -1]) plateAt(B, V3(s * DIM.shX + q * 2.4, y0 - 1.4, 0), V3(q, 0, 0), V3(0, 1, 0), 4.8, 4.6, { t: .5, c: .14, thr: th(.7), paint: lerp(pp[2], pp[3], .7), wear: .5 }); bearing(B, V3(s * DIM.shX, DIM.shY, 0), 2.3, 6.0, { thr: th(.75), wear: .6 }); }
      // top: walkways with handrails both edges, two lamp masts with floodlights, the aviation mast, a davit
      walkway(B, V3(-X + .5, y0 + h + .1, 2.4), V3(X - .5, y0 + h + .1, 2.4), V3(0, 0, -1), { w: 1.2, thr: th(.9), rails: 'both' });
      walkway(B, V3(-X + .5, y0 + h + .1, -2.4), V3(X - .5, y0 + h + .1, -2.4), V3(0, 0, 1), { w: .01, thr: th(.9) });
      this.lamps = [];
      for (const s of [1, -1]) {
        const mx = s * 12.4, base = y0 + h + .1, mh = 7;
        for (const [a, b] of [[V3(mx - .5, base, -.5), V3(mx - .3, base + mh, -.3)], [V3(mx + .5, base, -.5), V3(mx + .3, base + mh, -.3)], [V3(mx - .5, base, .5), V3(mx - .3, base + mh, .3)], [V3(mx + .5, base, .5), V3(mx + .3, base + mh, .3)]]) angleMember(B, a, b, V3(-Math.sign(a.x - mx), 0, 0), V3(0, 0, -Math.sign(a.z)), { a: .18, t: .03, thr: th(.92), noLift: true });
        for (let k = 0; k < 4; k++) flatBar(B, V3(mx - .45, base + k * 1.7, .45), V3(mx + .45, base + (k + 1) * 1.7, .45), V3(0, 0, 1), { w: .12, t: .03, thr: th(.92), noLift: true });
        B.push('plate', cbox(2.6, .3, 1.4, .05), new THREE.Matrix4().makeTranslation(mx, base + mh, 0), { thr: th(.93), paint: .95, noLift: true });
        for (let k = 0; k < 3; k++) { const lp = V3(mx + (k - 1) * .8, base + mh + .55, .5), lm = new THREE.Matrix4().makeTranslation(lp.x, lp.y, lp.z).multiply(new THREE.Matrix4().makeRotationX(.5));
          B.push('mill', cbox(.7, .6, .5, .05), lm, { thr: th(.93), noLift: true }); B.push('lamp', new THREE.CircleGeometry(.26, 12), lm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, .26)), { thr: th(.95), edge: false, noLift: true }); this.lamps.push({ seg: 'beam', p: lp.clone().add(V3(0, 0, .3)), dir: V3(0, -.48, .88) }); }
      }
      { const mh = 9, base = y0 + h + .1; B.push('mill', cyl(.25, mh, 8), new THREE.Matrix4().makeTranslation(1.2, base + mh / 2, -1.2), { thr: th(.95), edge: false, noLift: true });
        B.push('lamp', new THREE.SphereGeometry(.3, 10, 8), new THREE.Matrix4().makeTranslation(1.2, base + mh + .2, -1.2), { thr: th(.97), edge: false, noLift: true }); this.aviation = V3(1.2, base + mh + .2, -1.2); this.top = base + mh + .5; }
      { const dx = -7.5, base = y0 + h + .1; B.push('plate', cyl(.45, 4.4, 12), new THREE.Matrix4().makeTranslation(dx, base + 2.2, 1.6), { thr: th(.95), paint: .97, edge: false, noLift: true });
        flatBar(B, V3(dx, base + 4.2, 1.6), V3(dx, base + 3.2, 7.4), V3(0, 1, 0), { w: .5, t: .4, sys: 'plate', paint: .97, thr: th(.95), noLift: true });
        B.push('rubber', cyl(.025, 3.4, 4), new THREE.Matrix4().makeTranslation(dx, base + 1.5, 7.3), { thr: th(.95), edge: false, noLift: true }); B.push('hazard', cbox(.5, .7, .4, .05), new THREE.Matrix4().makeTranslation(dx, base - .4, 7.3), { thr: th(.95), noLift: true }); }
      ladder(B, -X + 1.2, -2.5, y0 - 12, y0 + h, V3(-1, 0, 0), { thr: th(.95) });
      this.decalQuad(B, 'st:SWL 600 t', V3(9.2, ym, 2.62), V3(0, 0, 1), V3(0, 1, 0), 4.6, 1.5, { thr: th(.6), after: lerp(pp[2], pp[3], .5) });
      this.decalQuad(B, 'st:▲ 52 m', V3(-9.5, ym, 2.62), V3(0, 0, 1), V3(0, 1, 0), 3.6, 1.4, { thr: th(.6), after: lerp(pp[2], pp[3], .5) });
      for (let k = 0; k < 3; k++) this.decalQuad(B, this.nextChalk(), V3(-2 + k * 2.6, ym - .6, 2.6), V3(0, 0, 1), V3(0, 1, 0), 1.5, .75, { thr: pp[0] + .01, hide: lerp(pp[2], pp[3], .3) });
      this.finish(B, 'beam', 'beam');
    }
    // ---------------- arms: lattice upper arm, plated forearm (it does the lifting), the hand as a working grab
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R';
      { const B = this.batch('sh', s), [t0, t1] = P.sh, th = f => lerp(t0, t1, f) + (s < 0 ? .005 : 0), pp = P.plate.sh;
        const col = latticeColumn(B, this.lat({ y0: -2.0, h: 6.6, top: [4.2, 4.2], bot: [3.8, 3.9], a: .66, t: .09, panel: 2.2, lace: .4, battenEvery: 1, thr: [th(.1), th(.85)], wear: .3, paint: this.framePaint('sh', s) }));
        B.push('mill', cylX(2.0, 3.6, 28), null, { thr: th(.95), wear: .6, edge: false, aoConst: .8 });
        for (const q of [1, -1]) plateAt(B, V3(q * 1.95, -1.0, 0), V3(q, 0, 0), V3(0, 1, 0), C5 ? 3.2 : 4.4, C5 ? 2.8 : 3.4, { t: .45, c: .12, thr: th(.9), paint: lerp(pp[2], pp[3], .2), wear: .5 });
        for (const q of [1, -1]) plateAt(B, V3(q * 2.3, C5 ? -9.9 : -9.6, 0), V3(q, 0, 0), V3(0, 1, 0), C5 ? 3.2 : 4.6, C5 ? 3.0 : 3.6, { t: .45, c: .12, thr: th(.05), paint: lerp(pp[2], pp[3], .1), wear: .6 });
        if (!C5) plateFace(B, col, s > 0 ? 'l' : 'r', ['P'], { t0: .2, t1: .6, thr: [pp[0], pp[1]], paintAt: [pp[2], pp[3]], R: rng(41 + s) });
        this.decalQuad(B, 'n' + (s > 0 ? 9 : 10), V3(s * 2.6, -6.5, 0), V3(s, 0, 0), V3(0, 1, 0), 1.6, .8, { thr: pp[0] + .05, after: lerp(pp[2], pp[3], .5) });
        this.finish(B, 'sh' + L, 'upperarm' + L); }
      { const B = this.batch('el', s), [t0, t1] = P.el, th = f => lerp(t0, t1, f) + (s < 0 ? .005 : 0), pp = P.plate.el;
        bearing(B, V3(0, 0, 0), 2.0, 3.6, { thr: th(.95), wear: .7 });
        const col = latticeColumn(B, this.lat({ y0: -1.6, h: 8.4, top: [4.8, 4.8], bot: [4.0, 4.2], a: .6, t: .08, panel: 2.8, lace: .36, battenEvery: 1, thr: [th(.1), th(.6)], wear: .2, diaph: true, paint: this.framePaint('el', s) }));
        const R2 = rng(51 + s);
        if (C5) {
          // c5: the forearm is a bare lattice boom like a crane's (that is how a long member stays light); only the underside,
          // which takes the load and the knocks, carries one lapped wear course
          plateFace(B, col, 'b', ['P', 'P'], { t0: .45, t1: 1, thr: [pp[0], pp[1]], paintAt: [pp[2], pp[3]], R: R2, out: .3, overlap: .25 });
          // the olecranon as two cheek plates and a pin boss (a lever, not a box)
          for (const q of [1, -1]) plateAt(B, V3(q * 1.1, 1.3, -1.7), V3(q, 0, 0), V3(0, 1, -.35), 3.0, 3.4, { t: .3, c: .1, thr: th(.7), paint: lerp(pp[2], pp[3], .3), wear: .8 });
          B.push('mill', cylX(.65, 2.6, 16), new THREE.Matrix4().makeTranslation(0, 2.6, -2.25), { thr: th(.72), wear: .8, edge: false, aoConst: .85 });
        } else {
        // the forearm does the lifting: plated all round in two long courses, one plate left off (the lattice inside shows)
        plateFace(B, col, 'f', ['PP', 'PP'], { thr: [pp[0], pp[1]], paintAt: [pp[2], pp[3]], R: R2, out: .3 });
        plateFace(B, col, 'b', ['PP', s > 0 ? 'P.' : 'PP'], { thr: [pp[0], pp[1]], paintAt: [pp[2], pp[3]], R: R2, out: .3 });
        plateFace(B, col, 'l', s > 0 ? ['P', 'P'] : ['.', 'R'], { thr: [pp[0], pp[1]], paintAt: [pp[2], pp[3]], R: R2, out: .3 });
        plateFace(B, col, 'r', s > 0 ? ['P', 'P'] : ['P', 'P'], { thr: [pp[0], pp[1]], paintAt: [pp[2], pp[3]], R: R2, out: .3 });
        // the olecranon: a heavy plated lever behind and above the pin, where the elbow ram pushes
        B.push('plate', cbox(3.0, 3.6, 2.6, .35), new THREE.Matrix4().makeTranslation(0, 1.3, -1.7).multiply(new THREE.Matrix4().makeRotationX(.35)), { thr: th(.7), paint: lerp(pp[2], pp[3], .3), wear: .8, plate: [3, 3.6] });
        }
        for (const q of [1, -1]) plateAt(B, V3(q * 1.7, -10.6, 0), V3(q, 0, 0), V3(0, 1, 0), C5 ? 3.0 : 3.6, C5 ? 2.6 : 3.0, { t: .4, c: .12, thr: th(.75), paint: lerp(pp[2], pp[3], .2), wear: .7 });
        this.decalQuad(B, 'st:SWL 400 t', V3(s * 2.62, -5, 0), V3(s, 0, 0), V3(0, 1, 0), 3.4, 1.0, { thr: pp[0] + .05, after: lerp(pp[2], pp[3], .7) });
        this.decalQuad(B, 'st:HYD 280 BAR', V3(0, -3.2, -2.62), V3(0, 0, -1), V3(0, 1, 0), 3.2, .9, { thr: pp[0] + .05, after: lerp(pp[2], pp[3], .7) });
        this.finish(B, 'el' + L, 'forearm' + L); }
      this.buildHand(s);
    }
  }
  // the hand: palm plated box, four fingers of three box phalanges on knuckle pins, an opposed thumb. Palm faces -s*x (toward the body).
  buildHand(s) {
    const L = s > 0 ? 'L' : 'R', J = this.J, P = this.PLAN, [t0, t1] = P.wr, th = f => lerp(t0, t1, f) + (s < 0 ? .004 : 0), pp = P.plate.wr;
    const B = this.batch('wr', s); bearing(B, V3(0, 0, 0), 1.3, 3.0, { axis: 'z', thr: th(.5), wear: .7, bolts: 8 });
    const pw = 4.8, ph = 4.4, pt = 2.6, py = -.9 - ph / 2;
    B.push('plate', cbox(pt, ph, pw, .3), new THREE.Matrix4().makeTranslation(0, py, 0), { thr: th(.6), paint: lerp(pp[2], pp[3], .5), wear: .7, plate: [pw, ph], plateAxes: 'zy' });
    for (const q of [1, -1]) B.push('plate', cbox(.3, ph * .9, pw * .9, .08), new THREE.Matrix4().makeTranslation(q * (pt / 2 + .12), py, 0), { thr: th(.65), paint: q === s ? lerp(pp[2], pp[3], .5) : 9, wear: q === -s ? 1.5 : .6, plate: [pw * .9, ph * .9], plateAxes: 'zy' });
    B.push('mill', cylZ(.7, pw + .4, 16), new THREE.Matrix4().makeTranslation(0, py - ph / 2, 0), { thr: th(.7), wear: .8, edge: false });
    this.finish(B, 'wr' + L, 'palm' + L);
    const H = { fingers: [], thumb: [] }; this.hands = this.hands || {}; this.hands[L] = H;
    const pz = [-1.75, -.58, .58, 1.75], lens = [1.9, 1.5, 1.15], fthr = f => lerp(P.fing[0], P.fing[1], f);
    pz.forEach((z, i) => {
      let parent = J['wr' + L], y = py - ph / 2 - .1, segs = [];
      for (let j = 0; j < 3; j++) {
        const nd = new THREE.Group(); nd.position.set(0, j === 0 ? y : -lens[j - 1], j === 0 ? z : 0); parent.add(nd); segs.push(nd);
        const F = this.batch('f', s), k = (i === 0 || i === 3) ? .92 : 1, ln = lens[j] * k;
        F.push('mill', cylZ(.5, .95, 14), null, { thr: fthr(.2 + j * .2), wear: .9, edge: false, aoConst: .8 });
        F.push('plate', cbox(1.25, ln - .25, .95, .16), new THREE.Matrix4().makeTranslation(0, -ln / 2, 0), { thr: fthr(.3 + j * .2), paint: j === 2 ? 9 : lerp(pp[2], pp[3], .6), wear: j === 2 ? 2 : 1, plate: [.95, ln], plateAxes: 'zy' });
        if (j === 2) F.push('mill', cbox(1.0, .5, .8, .15), new THREE.Matrix4().makeTranslation(-s * .2, -ln + .1, 0), { thr: fthr(.9), wear: 2 });
        F.push('rubber', cyl(.09, ln * .8, 6), new THREE.Matrix4().makeTranslation(s * .7, -ln / 2, 0), { thr: fthr(.95), edge: false, noLift: true });
        const g = F.build(this.M, { name: `f${L}${i}${j}` }); nd.add(g); g.traverse(o => { if (o.isMesh) this.segMeshes.push(o); }); F.group = g; F.joint = null; F.node = nd;
        parent = nd;
      }
      H.fingers.push(segs);
    });
    // thumb: forward (+z) and down, opposed across the palm
    { let parent = J['wr' + L]; const base = new THREE.Group(); base.position.set(-s * .3, py + .6, pw / 2 + .2); base.rotation.set(-.55, 0, 0); parent.add(base); parent = base; const tl = [2.0, 1.5];
      for (let j = 0; j < 2; j++) { const nd = new THREE.Group(); nd.position.set(0, j === 0 ? 0 : -tl[0], 0); parent.add(nd); H.thumb.push(nd);
        const F = this.batch('f', s); F.push('mill', cylX(.55, 1.2, 14), null, { thr: fthr(.4), wear: .9, edge: false });
        F.push('plate', cbox(1.3, tl[j] - .2, 1.1, .16), new THREE.Matrix4().makeTranslation(0, -tl[j] / 2, 0), { thr: fthr(.5), paint: j ? 9 : lerp(pp[2], pp[3], .6), wear: j ? 2 : 1, plate: [1.3, tl[j]] });
        const g = F.build(this.M, { name: `t${L}${j}` }); nd.add(g); g.traverse(o => { if (o.isMesh) this.segMeshes.push(o); }); parent = nd; } }
    this.curl(L, .35);
  }
  // curl 0 (open) .. 1 (closed): fingers fold toward the palm (-s x); spread opens them a little
  curl(L, c, { thumb = null, spread = 0 } = {}) {
    const H = this.hands?.[L]; if (!H) return; const s = L === 'L' ? 1 : -1;
    H.fingers.forEach((segs, i) => segs.forEach((sg, j) => { sg.rotation.set((j === 0 ? (i - 1.5) * .05 * spread : 0), 0, -s * c * [1.05, 1.25, 1.0][j] * (1 + i * .03)); }));
    const tc = thumb ?? c; H.thumb[0].rotation.set(0, 0, -s * tc * .7); H.thumb[1].rotation.set(0, 0, -s * tc * .9);
  }
  // c5: fingers that CLOSE on what they hold. boxes: [{ c: world centre, q: world quaternion, h: half sizes }] (an I-girder is its
  // two flanges, web and end plates). Each finger joint, base first, turns in until its phalanges would enter a box (sampled at
  // the plate's corners, a few cm of skin), so the hand wraps the section instead of laying straight boxes on it; free fingers
  // close to `max`. amount 0..1 blends from the plain curl `c0` to the solved closure (the moment of gripping).
  gripOn(L, boxes, { amount = 1, c0 = .3, max = [95, 100, 80], thumbMax = [70, 85], step = 3 } = {}) {
    const H = this.hands?.[L]; if (!H) return; const s = L === 'L' ? 1 : -1, p = V3(), loc = V3(), qi = new THREE.Quaternion();
    const Bx = boxes.map(b => ({ c: b.c, qi: b.q.clone().invert(), h: b.h.clone().addScalar(.04) }));
    const hit = (nodes, lens, w = .62, d = .47) => { for (let j = 0; j < nodes.length; j++) { const nd = nodes[j]; nd.updateMatrixWorld(true); const ln = lens[j];
      for (const k of [.45, .95]) for (const x of [-w, w]) for (const z of [-d, d]) { p.set(x, -ln * k, z).applyMatrix4(nd.matrixWorld);
        for (const b of Bx) { loc.copy(p).sub(b.c).applyQuaternion(b.qi); if (Math.abs(loc.x) < b.h.x && Math.abs(loc.y) < b.h.y && Math.abs(loc.z) < b.h.z) return true; } } } return false; };
    const lens = [1.9, 1.5, 1.15];
    H.fingers.forEach((segs, i) => {
      const k = (i === 0 || i === 3) ? .92 : 1, ln = lens.map(v => v * k), base = segs.map((sg, j) => -s * c0 * [1.05, 1.25, 1.0][j] * (1 + i * .03));
      const sol = [0, 0, 0]; segs.forEach(sg => sg.rotation.z = 0);
      for (let j = 0; j < 3; j++) { let a = 0;
        for (let deg = step; deg <= max[j]; deg += step) { segs[j].rotation.z = -s * deg * d2r; if (hit(segs.slice(j), ln.slice(j))) { break; } a = deg; }
        sol[j] = a; segs[j].rotation.z = -s * a * d2r; }
      segs.forEach((sg, j) => { sg.rotation.z = lerp(base[j], -s * sol[j] * d2r, amount); });
    });
    { const T = H.thumb, tl = [2.0, 1.5], sol = [0, 0]; T.forEach(n => n.rotation.z = 0);
      for (let j = 0; j < 2; j++) { let a = 0; for (let deg = step; deg <= thumbMax[j]; deg += step) { T[j].rotation.z = -s * deg * d2r; if (hit(T.slice(j), tl.slice(j), .65, .55)) break; a = deg; } sol[j] = a; T[j].rotation.z = -s * a * d2r; }
      T.forEach((n, j) => { n.rotation.z = lerp(-s * c0 * [.7, .9][j], -s * sol[j] * d2r, amount); }); }
    this.g.updateMatrixWorld(true);
  }
  // ------------------------------------------------------------------------------------------------ after building
  // rest-pose height above the soles per vertex (mud), and each segment's mass centre
  bakeRest() {
    this.g.updateMatrixWorld(true); const v = new THREE.Vector3(), base = this.g.matrixWorld.clone().invert();
    for (const m of this.segMeshes) { const g = m.geometry, p = g.attributes.position, a = new Float32Array(p.count), M = base.clone().multiply(m.matrixWorld);
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(M); a[i] = v.y; } g.setAttribute('aRest', new THREE.BufferAttribute(a, 1)); }
  }
  measureMasses() {
    this.masses = [];
    for (const B of this.batches) {
      if (!B.group) continue; const box = new THREE.Box3(); B.group.traverse(o => { if (o.isMesh) { o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox.clone(); if (isFinite(bb.min.x)) box.union(bb); } });
      const c = box.getCenter(new THREE.Vector3()), seg = B.seg, mass = seg === 'f' ? MASS.f : (MASS[seg === 'toe' ? 'to' : seg] ?? 50);
      this.masses.push({ obj: B.group, c, mass, seg });
    }
    this.totalMass = this.masses.reduce((a, m) => a + m.mass, 0);
  }
  // centre of mass in the giant's base frame (and the world), plus an optional carried load { p: world, kg }
  com(load = null) {
    this.g.updateMatrixWorld(true); const c = new THREE.Vector3(), w = new THREE.Vector3(); let M = 0;
    for (const m of this.masses) { w.copy(m.c).applyMatrix4(m.obj.matrixWorld); c.addScaledVector(w, m.mass); M += m.mass; }
    if (load) { c.addScaledVector(load.p, load.t); M += load.t; }
    return c.multiplyScalar(1 / M);
  }
  // ------------------------------------------------------------------------------------------------ rams
  // a ram between two anchors on two segments. Its stroke is sized from the governing joint's range (sampled), so the barrel is a
  // fixed length and the chrome rod shows how far it is out. `joint`: [name, axis, minDeg, maxDeg].
  addRam(a, aL, b, bL, { r = .55, rod = .3, joint = null, name = '', hoseSide = 1 } = {}) {
    const q = { a: this.J[a], aL: V3(...aL), b: this.J[b], bL: V3(...bL), r, rod, joint, name, hoseSide };
    this.rams.push(q); return q;
  }
  setupRams() {
    for (const s of [1, -1]) { const L = s > 0 ? 'L' : 'R';
      this.addRam('pelvis', [s * DIM.hipX, 1.8, -3.9], 'hp' + L, [0, -5.6, -2.9], { r: .7, rod: .38, joint: ['hp' + L, 'x', -100, 30], name: 'hip' + L });
      for (const q of [1, -1]) this.addRam('hp' + L, [q * 1.6, -7.6, 3.05], 'kn' + L, [q * 1.6, -3.4, 3.1], { r: .62, rod: .34, joint: ['kn' + L, 'x', 0, 125], name: 'knee' + L + q, hoseSide: q });
      this.addRam('kn' + L, [0, -7.6, -3.25], 'an' + L, [0, -1.2, -3.9], { r: .58, rod: .32, joint: ['an' + L, 'x', -60, 75], name: 'ankle' + L });
      this.addRam('chest', [s * 8.2, 11.4, 5.4], 'sh' + L, [0, -4.4, 2.3], { r: .58, rod: .32, joint: ['sh' + L, 'x', -120, 40, 'z', -35, 35, 'y', -45, 45], name: 'shoulder' + L });
      this.addRam('sh' + L, [0, -2.8, -2.3], 'el' + L, [0, 2.8, -2.7], { r: .55, rod: .3, joint: ['el' + L, 'x', -140, 0], name: 'elbow' + L });
    }
    // size each ram's barrel and stroke from its joint's range
    const save = {}; for (const k in this.J) save[k] = this.J[k].quaternion.clone();
    for (const q of this.rams) {
      // the joint's working range (one to three axes), sampled: the ram must reach every pose in it
      let lo = 1e9, hi = -1e9; const [jn, ...ax] = q.joint, j = this.J[jn], axes = []; for (let i = 0; i < ax.length; i += 3) axes.push(ax.slice(i, i + 3));
      const steps = axes.map((_, i) => i ? 6 : 24), idx = axes.map(() => 0);
      for (;;) { const r = [0, 0, 0]; axes.forEach(([a, a0, a1], i) => { r['xyz'.indexOf(a)] = lerp(a0, a1, idx[i] / steps[i]) * d2r; }); j.rotation.set(...r); const L = this.ramLen(q); lo = Math.min(lo, L); hi = Math.max(hi, L);
        let k = 0; while (k < idx.length && ++idx[k] > steps[k]) { idx[k] = 0; k++; } if (k === idx.length) break; }
      j.quaternion.copy(save[jn]);
      q.Lmin = lo - .4; q.stroke = hi - lo + 1.0; q.barrel = Math.max(q.stroke + .6, q.Lmin - .9); if (q.barrel > q.Lmin - .5) { q.barrel = q.Lmin - .5; q.short = true; }
      // meshes (build-aware)
      const mk = (geo, sys, o = {}) => { const Bt = new Batch(); Bt.push(sys, geo, null, { thr: 0, wear: .6, edge: false, noLift: true, aoConst: .9, rest: 20, ...o }); const g = Bt.build(this.M); const m = g.children[0]; m.removeFromParent(); this.g.add(m); return m; };
      q.mBarrel = mk(cyl(q.r, 1, 20), 'plate', { paint: -1, wear: .8 }); q.mRod = mk(cyl(q.rod, 1, 16), 'chrome');
      q.mCapA = mk(cyl(q.r * 1.12, .5, 20), 'mill'); q.mEyeA = mk(cylX(q.r * .75, q.r * 2.2, 16), 'mill'); q.mEyeB = mk(cylX(q.rod * 1.5, q.rod * 3.4, 14), 'mill');
      q.mGland = mk(cyl(q.r * 1.08, .4, 20), 'mill'); q.mHose = mk(cyl(.12, 1, 6), 'rubber'); q.mBand = mk(cyl(q.r * 1.02, .35, 20), 'hazard');
      q.parts = [q.mBarrel, q.mRod, q.mCapA, q.mEyeA, q.mEyeB, q.mGland, q.mHose, q.mBand];
      // a stroke longer than its barrel needs a telescopic (two-stage) ram: a fat first-stage sleeve, then the rod
      if (q.short) { q.mStage = mk(cyl(q.rod * 1.45, 1, 16), 'chrome'); q.mStageG = mk(cyl(q.rod * 1.6, .3, 16), 'mill'); q.parts.push(q.mStage, q.mStageG); }
      if (this.C5) {
        // c5: two hydraulic lines per ram as service loops (excavator boom practice): a port block and elbow at each end of the
        // barrel, the rod-end line clamped along the barrel, both lines looping round behind the pivot with slack to a manifold
        // block on the frame, so the loop flexes as the joint works. The straight 0.12 m rod (c4's hose) is hidden.
        q.mHose.visible = false; q.parts = q.parts.filter(m => m !== q.mHose);
        q.lines = [0, 1].map(() => new TubeLine(this.M.rubber, { n: 40, rad: 6, r: .1 + q.r * .06 }));
        for (const L of q.lines) { this.g.add(L.mesh); q.parts.push(L.mesh); }
        q.mPorts = [0, 1].map(() => mk(cbox(q.r * .9, .5, q.r * .9, .06), 'mill', { wear: 1 }));
        q.mElb = [0, 1].map(() => mk(cylX(.13, .36, 8), 'chrome'));
        q.mClamps = [0, 1].map(() => mk(cbox(.16, .22, q.r * 2.7, .03), 'mill', { wear: 1.2 }));
        q.mBlock = mk(cbox(.7, .5, .9, .06), 'mill', { wear: .8 });
        q.parts.push(...q.mPorts, ...q.mElb, ...q.mClamps, q.mBlock);
        // the manifold block sits on segment a, beside and behind the pivot (in a's own frame, from the rest pose)
        this.g.updateMatrixWorld(true); const Aw = q.aL.clone().applyMatrix4(q.a.matrixWorld), Bw = q.bL.clone().applyMatrix4(q.b.matrixWorld), dw = Bw.clone().sub(Aw).normalize();
        let sw = new THREE.Vector3().crossVectors(dw, V3(0, 0, 1)); if (sw.lengthSq() < 1e-3) sw = V3(1, 0, 0); sw.normalize().multiplyScalar(q.hoseSide);
        q.blockL = Aw.clone().addScaledVector(dw, -1.5).addScaledVector(sw, q.r + 1.1).applyMatrix4(q.a.matrixWorld.clone().invert());
      }
      q.thr = Math.max(this.PLAN[q.a.name.replace(/[LR]$/, '')]?.[1] ?? .5, this.PLAN[q.b.name.replace(/[LR]$/, '')]?.[1] ?? .5) + .01;
    }
    this.g.updateMatrixWorld(true);
  }
  ramLen(q) { this.g.updateMatrixWorld(true); const A = q.aL.clone().applyMatrix4(q.a.matrixWorld), B = q.bL.clone().applyMatrix4(q.b.matrixWorld); return A.distanceTo(B); }
  // per frame: rams follow the joints; returns each ram's extension (0 closed .. 1 at full stroke) in this.ramRep
  update() {
    this.g.updateMatrixWorld(true); const inv = this.g.matrixWorld.clone().invert(), Y = V3(0, 1, 0); this.ramRep = {};
    for (const q of this.rams) {
      const A = q.aL.clone().applyMatrix4(q.a.matrixWorld).applyMatrix4(inv), B = q.bL.clone().applyMatrix4(q.b.matrixWorld).applyMatrix4(inv), d = B.clone().sub(A), L = d.length(), dir = d.clone().normalize();
      const Q = new THREE.Quaternion().setFromUnitVectors(Y, dir), ext = (L - q.Lmin) / q.stroke; this.ramRep[q.name] = ext;
      const bl = q.barrel, rl = Math.max(.2, L - bl + .3);
      q.mBarrel.scale.set(1, bl, 1); q.mBarrel.position.copy(A).addScaledVector(dir, bl / 2); q.mBarrel.quaternion.copy(Q);
      q.ext = Math.max(0, Math.min(1, ext));
      if (q.mStage) { const s1 = Math.min(rl * .55, bl - .3), r2 = rl - s1 + .2; q.mStage.scale.set(1, s1, 1); q.mStage.position.copy(A).addScaledVector(dir, bl + s1 / 2 - .2); q.mStage.quaternion.copy(Q); q.mStageG.position.copy(A).addScaledVector(dir, bl + s1 - .25); q.mStageG.quaternion.copy(Q);
        q.mRod.scale.set(1, r2, 1); q.mRod.position.copy(B).addScaledVector(dir, -r2 / 2); q.mRod.quaternion.copy(Q); }
      else { q.mRod.scale.set(1, rl, 1); q.mRod.position.copy(B).addScaledVector(dir, -rl / 2); q.mRod.quaternion.copy(Q); }
      q.mCapA.position.copy(A).addScaledVector(dir, .25); q.mCapA.quaternion.copy(Q);
      q.mGland.position.copy(A).addScaledVector(dir, bl - .2); q.mGland.quaternion.copy(Q);
      q.mBand.position.copy(A).addScaledVector(dir, bl - .7); q.mBand.quaternion.copy(Q);
      const xax = V3(1, 0, 0); for (const [m, P] of [[q.mEyeA, A], [q.mEyeB, B]]) { m.position.copy(P); m.quaternion.copy(Q); }
      const side = new THREE.Vector3().crossVectors(dir, V3(0, 0, 1)); if (side.lengthSq() < 1e-4) side.set(1, 0, 0); side.normalize().multiplyScalar(q.r * 1.3 * q.hoseSide);
      q.mHose.scale.set(1, bl * .85, 1); q.mHose.position.copy(A).addScaledVector(dir, bl * .47).add(side); q.mHose.quaternion.copy(Q);
      void xax;
      if (q.lines && q.mBarrel.visible !== false) {
        const sd = side.clone().normalize(), bn = new THREE.Vector3().crossVectors(dir, sd).normalize(), blk = q.blockL.clone().applyMatrix4(q.a.matrixWorld).applyMatrix4(inv);
        const s2 = sd.clone().multiplyScalar(.82).addScaledVector(bn, .57).normalize(), down = V3(0, -1, 0);
        const portA = A.clone().addScaledVector(dir, .7).addScaledVector(sd, q.r * 1.05), portB = A.clone().addScaledVector(dir, bl - .6).addScaledVector(s2, q.r * 1.05);
        q.mPorts[0].position.copy(portA); q.mPorts[0].quaternion.copy(Q); q.mPorts[1].position.copy(portB); q.mPorts[1].quaternion.copy(Q);
        const eA = portA.clone().addScaledVector(sd, .38), eB = portB.clone().addScaledVector(s2, .38);
        q.mElb[0].position.copy(eA); q.mElb[0].quaternion.setFromUnitVectors(V3(1, 0, 0), sd); q.mElb[1].position.copy(eB); q.mElb[1].quaternion.setFromUnitVectors(V3(1, 0, 0), s2);
        const c1 = A.clone().addScaledVector(dir, bl * .62).addScaledVector(s2, q.r + .2), c2 = A.clone().addScaledVector(dir, bl * .28).addScaledVector(s2, q.r + .2);
        q.mClamps[0].position.copy(c1).addScaledVector(s2, -.08); q.mClamps[0].quaternion.copy(Q); q.mClamps[1].position.copy(c2).addScaledVector(s2, -.08); q.mClamps[1].quaternion.copy(Q);
        q.mBlock.position.copy(blk); q.mBlock.quaternion.copy(Q);
        // the loop behind the pivot: out past the eye, sagging under its own weight, then in to the block
        const loopA = A.clone().addScaledVector(dir, -.9).addScaledVector(sd, q.r + 1.05).addScaledVector(down, .55), loopB = A.clone().addScaledVector(dir, -1.2).addScaledVector(s2, q.r + .75).addScaledVector(down, .9);
        q.lines[0].set([eA.clone().addScaledVector(sd, .12), eA.clone().addScaledVector(sd, .45).addScaledVector(dir, -.25), loopA, loopA.clone().lerp(blk, .55).addScaledVector(down, .35), blk.clone().addScaledVector(sd, .3)]);
        q.lines[1].set([eB.clone().addScaledVector(s2, .12), eB.clone().addScaledVector(s2, .2).addScaledVector(dir, -.5), c1.clone().addScaledVector(s2, .02), c2.clone().addScaledVector(s2, .02), A.clone().addScaledVector(dir, .1).addScaledVector(s2, q.r + .35), loopB, loopB.clone().lerp(blk, .5).addScaledVector(down, .45), blk.clone().addScaledVector(s2, -.25)]);
      }
    }
    // oil round the bearings follows the joints
    const oil = []; const p = new THREE.Vector3();
    for (const [k, r] of [['hpL', 4.2], ['hpR', 4.2], ['knL', 3.6], ['knR', 3.6], ['anL', 2.8], ['anR', 2.8], ['shL', 3.4], ['shR', 3.4], ['elL', 3.0], ['elR', 3.0], ['waist', 4.5], ['wrL', 2], ['wrR', 2]]) { this.J[k].getWorldPosition(p); if (k === 'waist') p.y += .5; oil.push([p.x, p.y, p.z, r]); }
    setOil(this.U, oil);
  }
  // ------------------------------------------------------------------------------------------------ build and lifts
  setBuild(u) {
    this.build = u; this.U.uBuild.value = u;
    for (const q of this.rams) { const on = u >= q.thr; for (const m of q.parts) m.visible = on; }
    if (this.markMesh) this.markMesh.visible = u >= .985;
  }
  // the lifts in the air at build time u: [{ thr, side, c: world centre at the hook, k: 0 (just picked) .. 1 (landed) }]
  // for cranes to carry them (two cranes: one each side)
  liftsAt(u) {
    if (!this._lifts) { // gather the pieces by quantised threshold and side, in the base frame at rest
      const map = new Map(); this.g.updateMatrixWorld(true); const inv = this.g.matrixWorld.clone().invert();
      for (const B of this.batches) { const obj = B.group; if (!obj) continue; const M = inv.clone().multiply(obj.matrixWorld);
        for (const pc of B.pieces) { if (pc.thr <= 0 || pc.thr > 1) continue; const c = pc.c.clone().applyMatrix4(M), side = c.x >= 0 ? 1 : -1, key = pc.thr.toFixed(5) + ':' + side;
          const e = map.get(key) || { thr: pc.thr, side, c: V3(), n: 0, top: -1e9 }; e.c.add(c); e.n++; e.top = Math.max(e.top, c.y); map.set(key, e); } }
      this._lifts = [...map.values()].map(e => ({ ...e, c: e.c.multiplyScalar(1 / e.n) })).sort((a, b) => a.thr - b.thr);
    }
    const W = this.U.uDropW.value, H = this.U.uDropH.value, out = [];
    for (const e of this._lifts) { const age = u - e.thr; if (age < -W * 1.2 || age > W * .9) continue; const k = clamp(age / W), drop = (1 - k * k * (3 - 2 * k)) * H;
      out.push({ thr: e.thr, side: e.side, c: e.c.clone().add(V3(0, drop + (age < 0 ? H * (1 + -age / W * .6) : 0), 0)).applyMatrix4(this.g.matrixWorld), top: e.top + drop, k: age < 0 ? 0 : k, n: e.n, pre: age < 0 }); }
    return out;
  }
  // the one red plate: the mark, No. 1, bolted to the chest's upper left
  addMark() {
    const { p, w } = this.markAt, h = w * 1.18, c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * h / w); const g = c.getContext('2d'), R = rng(5);
    g.fillStyle = RED; g.fillRect(0, 0, c.width, c.height); g.fillStyle = 'rgba(0,0,0,.16)'; for (let i = 0; i < 400; i++) g.fillRect(R() * 512, R() * c.height, 2 + R() * 10, 1 + R() * 3);
    drawMark(g, c.width / 2, c.height * .44, c.width * .8, { color: '#e9e1cf' });
    g.font = `800 ${Math.round(c.width * .1)}px "Big Shoulders Stencil Display", sans-serif`; g.fillStyle = '#e9e1cf'; g.textAlign = 'center'; g.fillText('No. 1', c.width / 2, c.height * .9);
    for (const [x, y] of [[.05, .04], [.95, .04], [.05, .96], [.95, .96], [.5, .04], [.5, .96], [.05, .5], [.95, .5]]) { g.fillStyle = 'rgba(0,0,0,.4)'; g.beginPath(); g.arc(x * 512 + 1, y * c.height + 2, 9, 0, 7); g.fill(); g.fillStyle = '#c4473a'; g.beginPath(); g.arc(x * 512, y * c.height, 7, 0, 7); g.fill(); }
    // weather: a rust run from two bolts, grime at the foot
    for (let i = 0; i < 6; i++) { const x = (R() < .5 ? .05 : .95) * 512 + (R() - .5) * 20, gr = g.createLinearGradient(0, 30, 0, 30 + 200 * R()); gr.addColorStop(0, 'rgba(70,30,15,.5)'); gr.addColorStop(1, 'rgba(70,30,15,0)'); g.fillStyle = gr; g.fillRect(x - 2, 30, 4, 260); }
    const gg = g.createLinearGradient(0, c.height * .75, 0, c.height); gg.addColorStop(0, 'rgba(40,30,25,0)'); gg.addColorStop(1, 'rgba(40,30,25,.45)'); g.fillStyle = gg; g.fillRect(0, 0, 512, c.height);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    const m = new THREE.Mesh(cbox(w, h, .3, .06), [new THREE.MeshStandardMaterial({ map: t, roughness: .7, metalness: .05 })]); m.geometry.clearGroups(); m.material = new THREE.MeshStandardMaterial({ map: t, roughness: .7 });
    // planar uv for the front face
    const pa = m.geometry.attributes.position, uv = new Float32Array(pa.count * 2); for (let i = 0; i < pa.count; i++) { uv[i * 2] = pa.getX(i) / w + .5; uv[i * 2 + 1] = pa.getY(i) / h + .5; } m.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    m.position.copy(p); m.castShadow = true; this.J.chest.add(m); this.markMesh = m; return m;
  }
}
