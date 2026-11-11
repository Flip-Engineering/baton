// MECHA KIT walker (MODELING c2): an ACP industrial walking machine, answering the client's note on MECHA PROLETARIAT v1 ("the walker
// needs to reflect ACP stylings of mechas not arbitrary anime kaiju stuff"). References are working walking machines, not
// characters: the GE Walking Truck, the Menzi Muck and Timberjack walking excavators, Big Muskie's boom and pins, the Aliens P-5000's
// open cab and exposed hydraulics; and the painting's own white-and-ochre industrial world (acp_fortress.jpg).
//
// What changed from v1's walker and why: the HEAD IS GONE (no crest, fins, antennae or visor slit): the top is a glazed cab with two
// crew visible through the glass, an exhaust stack, a radiator deck and a work-light bar. Joints are pin-and-clevis (a boss with a
// flange ring, a pin with washers and cotter) with RAMS between anchors on the two links that solve their own length every frame;
// hoses leave ports on the hull and flex with the legs; legs are cut-out plate girders (lightening holes, cross-ribs), not
// chamfered boxes; ladders, landings and rails run up the leg at human scale (the people on them are 1.75 m); stencils read
// (unit numbers, hazard bands, one ACP mark in red on the flank: the ONLY red on the machine).
//
//   const w = new Walker(scene); w.update(phase);    // phase 0..1 per stride; root moves w.distPerCycle in +Z per cycle
import * as THREE from 'three';
import { aimQ, mesh, rbox, box, cylX, cylY, cylZ, strut, PAL, Ram, Hose, ik2, V, ladder, handrail, clevis, nextPid, decalPlane, stencilTexture, hazardTexture, capsuleBetween, paint } from './parts.js';
import { Figure } from './figure.js';
import { drawMark, RED } from '../../../closer.js';

const L1 = 4.6, L2 = 4.4, ANK = .75, HIP_Y = 8.0;
function aim(g, A, B, up) { g.position.copy(A); const d = B.clone().sub(A).normalize(); aimQ(g, A, B, up || (Math.abs(d.y) > .8 ? V(0, 0, 1) : V(0, 1, 0))); }

// a girder side-plate: tapered, with lightening holes. Length along local Z, height along local Y, thickness along local X.
function plate(len, h0, h1, t, holes, col, parent) {
  const s = new THREE.Shape(), r = Math.min(h0, h1) * .08;
  s.moveTo(0, -h0 / 2); s.lineTo(len, -h1 / 2); s.lineTo(len, h1 / 2); s.lineTo(0, h0 / 2); s.closePath();
  const n = holes, hs = [];
  for (let i = 0; i < n; i++) { const u = (i + .5) / n, cx = len * u, hh = h0 + (h1 - h0) * u, rr = hh * .27; const p = new THREE.Path(); p.absarc(cx, 0, rr, 0, Math.PI * 2, true); hs.push(p); }
  s.holes = hs;
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 14 }); g.translate(0, 0, -t / 2); g.rotateY(-Math.PI / 2);
  const m = mesh(g, col, { parent });
  // I-beam flanges along both edges: the plate reads as a girder, not a cut-out
  const grp = new THREE.Group(); grp.add(m);
  for (const sg of [-1, 1]) { const f = strut([0, sg * h0 / 2, 0], [0, sg * h1 / 2, len], t + .22, .1, PAL.steelDk, { parent: grp }); }
  parent.add(grp); parent.remove(m); return grp;
}
function markTexture(size = 512) {
  const c = document.createElement('canvas'); c.width = size; c.height = Math.round(size * .62); const g = c.getContext('2d');
  drawMark(g, size / 2, c.height / 2, c.height * .96, { color: RED });
  g.globalCompositeOperation = 'destination-out'; let s = 77; const r = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 90; i++) { g.globalAlpha = .4 + r() * .6; g.beginPath(); g.ellipse(r() * c.width, r() * c.height, 1 + r() * 5, 1 + r() * 2.5, r() * 3, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return t;
}

export class Walker {
  constructor(parent, { body = PAL.ochre, trim = PAL.white, crew = true, workers = true } = {}) {
    const R = this.root = new THREE.Group(); parent.add(R); this.body = body; this.stride = 4.4; this.stanceF = .6; this.distPerCycle = this.stride / this.stanceF;
    // ------------------------------------------------------------ hull
    const H = this.hull = new THREE.Group(); R.add(H);
    const deck = rbox(4.2, 1.7, 5.6, .18, body, { parent: H }); deck.position.set(0, .3, 0);
    const skirt = rbox(4.5, .5, 5.9, .12, PAL.steelDk, { parent: H }); skirt.position.set(0, -.65, 0);
    const haz = new THREE.Mesh(new THREE.PlaneGeometry(5.7, .3), new THREE.MeshLambertMaterial({ map: hazardTexture() })); haz.userData.pid = skirt.userData.pid; haz.position.set(2.26, -.65, 0); haz.rotation.y = Math.PI / 2; H.add(haz); const haz2 = haz.clone(); haz2.position.x = -2.26; haz2.rotation.y = -Math.PI / 2; H.add(haz2);
    // louvred engine bay at the rear, radiator grille, access panels with hinges and handles
    const bay = rbox(3.6, 1.1, 2.4, .1, trim, { parent: H }); bay.position.set(0, 1.4, -1.4);
    for (let i = 0; i < 9; i++) { const sl = box(3.0, .05, .09, PAL.steelDk, { parent: H }); sl.position.set(0, .95 + i * .11, -2.62); sl.rotation.x = .4; }
    for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) { const pn = box(.05, .6, .75, PAL.steelDk, { parent: H }); pn.position.set(sx * 1.84, 1.35, -.55 - i * .85); const hnd = cylZ(.03, .3, PAL.steelLt, { parent: H }, 8); hnd.position.set(sx * 1.88, 1.35, -.45 - i * .85); hnd.rotation.x = Math.PI / 2; }
    for (const sx of [-.9, .9]) { const st = cylY(.2, 2.2, PAL.steelDk, { parent: H }, 14); st.position.set(sx, 2.9, -2.1); const cap = cylY(.28, .12, PAL.steel, { parent: H }, 14); cap.position.set(sx, 4.0, -2.1); const clp = cylY(.23, .1, PAL.steelDk, { parent: H }, 14); clp.position.set(sx, 3.2, -2.1); }
    // deck rails and a landing: a human-scale walkway round the engine bay
    for (const sx of [-1, 1]) H.add(handrail([sx * 2.0, 1.15, 2.6], [sx * 2.0, 1.15, -2.7], { h: 1.05, post: 1.6, col: PAL.hazard }));
    H.add(handrail([-2.0, 1.15, -2.7], [2.0, 1.15, -2.7], { h: 1.05, post: 2.0, col: PAL.hazard }));
    // cab: a glazed box with pillars, a roof with a lamp bar, two seats, controls
    const cab = this.cab = new THREE.Group(); cab.position.set(0, 1.15, 1.45); H.add(cab);
    const cfloor = box(3.0, .2, 2.6, PAL.steelDk, { parent: cab }); cfloor.position.y = .1;
    const roof = rbox(3.2, .22, 2.9, .08, trim, { parent: cab }); roof.position.set(0, 2.55, .1);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const p = strut([sx * 1.45, .2, sz * 1.2], [sx * 1.4, 2.5, sz * 1.15], .12, .12, trim, { parent: cab }); }
    const wsf = mesh(new THREE.BoxGeometry(2.8, 2.2, .04), PAL.glass, { parent: cab, glass: true, pid: nextPid() }); wsf.position.set(0, 1.35, 1.3);
    for (const sx of [-1, 1]) { const sg = mesh(new THREE.BoxGeometry(.04, 2.0, 2.2), PAL.glass, { parent: cab, glass: true, pid: nextPid() }); sg.position.set(sx * 1.43, 1.35, .05); }
    const bg = mesh(new THREE.BoxGeometry(2.8, 2.0, .04), PAL.glass, { parent: cab, glass: true, pid: nextPid() }); bg.position.set(0, 1.3, -1.25);
    const mull = box(.08, 2.2, .1, trim, { parent: cab }); mull.position.set(0, 1.35, 1.32);
    const mull2 = box(2.8, .08, .1, trim, { parent: cab }); mull2.position.set(0, 1.0, 1.32);
    for (let i = -2; i <= 2; i++) { const lp = cylZ(.12, .22, PAL.steelLt, { parent: cab }, 12); lp.position.set(i * .6, 2.72, 1.4); }
    const wiper = strut([.2, 1.0, 1.34], [1.2, 1.7, 1.34], .03, .03, PAL.steelDk, { parent: cab });
    const sunvisor = rbox(3.0, .08, .6, .03, trim, { parent: cab }); sunvisor.position.set(0, 2.5, 1.6); sunvisor.rotation.x = -.18;
    this.fig = [];
    if (crew) for (const [sx, who] of [[-.7, 'ana'], [.75, 'emil']]) {
      const seat = rbox(.7, .15, .6, .06, PAL.rubber, { parent: cab }); seat.position.set(sx, .5, .3); const sb = rbox(.7, .8, .12, .05, PAL.rubber, { parent: cab }); sb.position.set(sx, .95, -.05);
      const con = rbox(.5, .5, .5, .05, PAL.steelDk, { parent: cab }); con.position.set(sx, .55, 1.0); const stick = cylY(.03, .45, PAL.steelDk, { parent: cab }, 8); stick.position.set(sx, 1.0, .88); stick.rotation.x = .3;
      const f = new Figure(cab, { who, coverall: PAL.ochre, hat: PAL.white, scale: 1.0 }); this.fig.push(f);
      const hip = V(sx, .78, .15), P = { hip, kneeL: V(sx + .15, .95, .75), kneeR: V(sx - .15, .95, .75), ankleL: V(sx + .16, .4, 1.0), ankleR: V(sx - .16, .4, 1.0),
        shoulderL: V(sx + .2, 1.45, .1), shoulderR: V(sx - .2, 1.45, .1), elbowL: V(sx + .28, 1.15, .45), elbowR: V(sx - .28, 1.15, .45), wristL: V(sx + .12, 1.05, .85), wristR: V(sx - .12, 1.05, .85),
        lean: .12, head: V(sx, 1.78, .22), headPitch: .06, headYaw: sx > 0 ? -.2 : .15, torsoYaw: 0 };
      f.pose(P); f.torso.position.set(sx, .83, .12); f.torso.rotation.x = .1; f.pelvis.position.set(sx, .6, .1);
    }
    // flank: the one red mark, a unit number and a stencil panel
    const mk = decalPlane(markTexture(), 3.3, 2.05, { pid: deck.userData.pid, alphaTest: .35 }); mk.position.set(0, .3, 2.815); H.add(mk);
    const un = decalPlane(stencilTexture('W-7', { w: 256, h: 128, col: '#25231f' }), 1.1, .55, { pid: skirt.userData.pid }); un.position.set(2.26, -.1, 2.4); un.rotation.y = Math.PI / 2; H.add(un);
    const un2 = un.clone(); un2.position.x = -2.26; un2.rotation.y = -Math.PI / 2; H.add(un2);
    const sten = decalPlane(stencilTexture('MAX 40 t  NO RIDERS', { w: 512, h: 64, col: '#25231f' }), 2.4, .3, { pid: bay.userData.pid }); sten.position.set(0, 1.3, -2.605); sten.rotation.y = Math.PI; H.add(sten);
    // a davit crane on the foredeck: a lattice boom, a block and a hook (an industrial walker lifts things)
    const dav = new THREE.Group(); dav.position.set(1.7, 1.2, -.4); H.add(dav);
    cylY(.22, 1.0, PAL.steelDk, { parent: dav }, 12).position.y = .5; const boom = strut([0, 1.0, 0], [-1.2, 3.4, 1.3], .22, .22, PAL.steelLt, { parent: dav }); const boom2 = strut([.3, 1.0, 0], [-1.1, 3.4, 1.3], .08, .08, PAL.steelDk, { parent: dav });
    this.hookLine = cylY(.015, 1.4, PAL.steelDk, { parent: dav }, 4); this.hookLine.position.set(-1.2, 2.7, 1.3); const hk = box(.16, .26, .16, PAL.steelDk, { parent: dav }); hk.position.set(-1.2, 1.95, 1.3);
    // ------------------------------------------------------------ legs
    this.leg = [-1, 1].map(s => {
      const o = { s };
      // hip: a big boss on the hull side with a flange ring, a pin, bolts
      const boss = cylX(1.0, .8, PAL.steel, { parent: R }, 32); const flange = cylX(1.2, .12, PAL.steelDk, { parent: R }, 32); o.boss = boss; o.flange = flange;
      o.bolts = []; for (let i = 0; i < 12; i++) { const b = cylX(.06, .2, PAL.steelLt, { parent: R }, 6); o.bolts.push(b); }
      const hpin = cylX(.34, 1.3, PAL.steelLt, { parent: R }, 16); o.hpin = hpin;
      o.thigh = new THREE.Group(); R.add(o.thigh); o.shin = new THREE.Group(); R.add(o.shin);
      for (const sx of [-.55, .55]) { const p = plate(L1, 1.8, 1.2, .16, 4, body, o.thigh); p.position.x = sx * 1.1; const p2 = plate(L2, 1.2, 1.0, .14, 4, body, o.shin); p2.position.x = sx * .95; }
      for (let i = 1; i < 6; i++) { const r = box(2.2, .16, .16, PAL.steelDk, { parent: o.thigh }); r.position.set(0, .0, L1 * i / 6); const r2 = box(1.9, .14, .14, PAL.steelDk, { parent: o.shin }); r2.position.set(0, 0, L2 * i / 6); }
      const tcap = box(2.3, .9, .7, PAL.steelDk, { parent: o.thigh }); tcap.position.set(0, .0, 0.35);
      const cowl = rbox(2.2, .12, L1 * .45, .05, body, { parent: o.thigh }); cowl.position.set(0, .8, L1 * .3);
      const cowl2 = rbox(1.9, .1, L2 * .4, .05, body, { parent: o.shin }); cowl2.position.set(0, .62, L2 * .72);
      // knee: a fork on the thigh, the shin between, a big pin
      o.kneeBoss = cylX(.6, 1.45, PAL.steel, { parent: R }, 24); o.kneePin = cylX(.26, 1.8, PAL.steelLt, { parent: R }, 14); o.kneeFl = cylX(.74, .1, PAL.steelDk, { parent: R }, 24);
      o.kneeCotter = box(.05, .6, .05, PAL.steelDk, { parent: R });
      o.ankleBoss = cylX(.42, 1.35, PAL.steel, { parent: R }, 20); o.anklePin = cylX(.2, 1.7, PAL.steelLt, { parent: R }, 12);
      // foot: heel block, toe plate on its own pin, tread plates, stencilled number
      o.foot = new THREE.Group(); R.add(o.foot);
      const heel = rbox(1.9, .55, 1.9, .12, PAL.steelDk, { parent: o.foot }); heel.position.set(0, -.5, -.2);
      const sole = rbox(2.2, .3, 3.4, .1, PAL.rubber, { parent: o.foot }); sole.position.set(0, -.72, .5);
      const toe = new THREE.Group(); toe.position.set(0, -.5, 1.0); o.foot.add(toe); o.toe = toe; const tp = rbox(2.0, .32, 1.4, .08, PAL.steelDk, { parent: toe }); tp.position.set(0, -.2, .6);
      const lug = clevis({ w: 1.4, r: .24, plate: .06, pin: .1 }); lug.position.set(0, -.3, -.15); lug.scale.setScalar(1); o.foot.add(lug);
      for (let i = 0; i < 5; i++) { const g = box(1.9, .05, .1, PAL.hazard, { parent: o.foot }); g.position.set(0, -.54, .6 + i * .3); }
      // rams (hip: two, knee: one big, ankle: one)
      const big = { barrelR: .26, rodR: .14, barrel: 1.7 }, mid = { barrelR: .2, rodR: .11, barrel: 1.3 };
      o.ramH = [new Ram(R, big), new Ram(R, big)]; o.ramK = new Ram(R, big); o.ramA = new Ram(R, mid); o.ramT = new Ram(R, { barrelR: .13, rodR: .07, barrel: .8 });
      // hoses: four per leg: pressure and return to the hip and knee rams, a bundle to the ankle
      o.hose = [0, 1, 2, 3].map(i => new Hose(R, { r: i < 2 ? .1 : .075, sag: 1.1, side: s * .25 }));
      // ladders fixed to the links: the shin's runs from the ankle to the knee landing, the thigh's from the landing to the hip deck
      const ox = s * 1.55;
      o.ladder1 = ladder([ox, .0, L2 - .5], [ox, .0, .6], { w: .6 }); o.shin.add(o.ladder1);
      const stand = new THREE.Group(); R.add(stand); o.stand = stand; o.standLocal = V(ox + s * .35, 0, .35);
      const land = rbox(1.5, .1, 1.3, .03, PAL.steelDk, { parent: stand }); land.position.set(0, .0, 0);
      const lrail = handrail([-.75, 0, -.65], [-.75, 0, .65], { h: 1.0, post: 1.3 }); stand.add(lrail); stand.add(handrail([-.75, 0, .65], [.75, 0, .65], { h: 1.0, post: 1.5 })); stand.add(handrail([.75, 0, .65], [.75, 0, -.65], { h: 1.0, post: 1.3 }));
      o.ladder2 = ladder([ox, .0, L1 - .45], [ox, .0, .9], { w: .6 }); o.thigh.add(o.ladder2);
      return o;
    });
    if (workers) {   // two people at human scale: one on the knee landing of the near leg, one on the deck
      this.people = [];
      const mk = (who, hat, par) => { const f = new Figure(par, { who, coverall: PAL.khaki, hat, scale: 1 }); this.people.push(f); return f; };
      this.kneeWorker = mk('dolores', PAL.white, R); this.deckWorker = mk('chidi', PAL.hazard, H);
      const standing = (f, base) => { const P = { hip: V(base.x, base.y + .95, base.z), kneeL: V(base.x + .1, base.y + .5, base.z + .05), kneeR: V(base.x - .1, base.y + .5, base.z + .05), ankleL: V(base.x + .1, base.y + .05, base.z), ankleR: V(base.x - .1, base.y + .05, base.z),
        shoulderL: V(base.x + .2, base.y + 1.45, base.z), shoulderR: V(base.x - .2, base.y + 1.45, base.z), elbowL: V(base.x + .28, base.y + 1.2, base.z + .08), elbowR: V(base.x - .28, base.y + 1.2, base.z + .08),
        wristL: V(base.x + .25, base.y + 1.0, base.z + .2), wristR: V(base.x - .25, base.y + 1.0, base.z + .2), lean: 0, head: V(base.x, base.y + 1.68, base.z + .02), headPitch: 0, headYaw: 0, torsoYaw: 0 }; f.pose(P); f.torso.position.set(base.x, base.y + 1.0, base.z); };
      standing(this.deckWorker, V(-1.2, 1.15, -2.2)); this.deckWorker.g.visible = true;
      this._standing = standing;
    }
    this.hosesHull = [0, 1, 2, 3].map(() => new Hose(R, { r: .09, sag: .8, side: .3 }));
  }
  _strut(m, A, B) { m.position.copy(A).lerp(B, .5); aimQ(m, A, B); m.scale.set(1, 1, A.distanceTo(B)); }
  // phase 0..1 per stride; returns the root-space positions (for cameras)
  update(phase = 0, { sway = .35, bob = .35 } = {}) {
    const R = this.root, H = this.hull, legs = this.leg, st = this.stride, sf = this.stanceF;
    const hy = HIP_Y - bob * (.5 + .5 * Math.cos(phase * Math.PI * 4));
    const sx = Math.sin(phase * Math.PI * 2) * sway * -1;     // sway over the standing leg
    H.position.set(sx, hy + 1.2, 0); H.rotation.set(Math.sin(phase * Math.PI * 4) * .012, 0, Math.sin(phase * Math.PI * 2) * .012);
    H.updateMatrix(); H.updateMatrixWorld(true);
    const hp = (x, y, z) => V(x, y, z).applyMatrix4(H.matrix);       // hull-local -> root space (root has no transform of its own relative to R)
    const info = [];
    legs.forEach((o, i) => {
      const ph = (phase + (i ? .5 : 0)) % 1, s = o.s; let z, y, pitch = 0;
      if (ph < sf) { const u = ph / sf; z = st / 2 * (1 - 2 * u); y = ANK; pitch = u > .88 ? -.5 * (u - .88) / .12 : 0; y += u > .88 ? .5 * (u - .88) / .12 : 0; }
      else { const u = (ph - sf) / (1 - sf), e = u * u * (3 - 2 * u); z = -st / 2 + st * e; y = ANK + .5 + Math.sin(u * Math.PI) * 1.1; pitch = -.5 * (1 - e) + .1 * Math.sin(u * Math.PI) * 0; }
      const hx = s * 2.45 + sx, Hh = V(hx, hy + 1.2 - .15, 0), A = V(s * 2.45, y, z + 0), K = ik2(Hh, A, L1, L2, V(0, 0, 1));
      aim(o.thigh, Hh, K, V(0, 0, 1)); aim(o.shin, K, A, V(0, 0, 1)); o.foot.position.copy(A); o.foot.rotation.x = pitch; o.toe.rotation.x = ph < sf ? 0 : .35 * Math.sin((ph - sf) / (1 - sf) * Math.PI);
      // joints
      o.boss.position.copy(Hh).add(V(s * .0, 0, 0)); o.flange.position.copy(Hh).add(V(-s * .45, 0, 0)); o.hpin.position.copy(Hh).add(V(s * .1, 0, 0));
      o.bolts.forEach((b, j) => { const a = j / 12 * Math.PI * 2; b.position.set(Hh.x - s * .5, Hh.y + Math.cos(a) * 1.1, Hh.z + Math.sin(a) * 1.1); });
      o.kneeBoss.position.copy(K); o.kneePin.position.copy(K); o.kneeFl.position.copy(K).add(V(s * .78, 0, 0)); o.kneeCotter.position.copy(K).add(V(s * .95, .0, 0));
      o.ankleBoss.position.copy(A).add(V(0, 0, 0)); o.anklePin.position.copy(A);
      // rams: from hull-side lugs to thigh lugs; knee: thigh upper lug (back) to shin upper lug (back); ankle: shin lower lug to heel
      const along = (P, Q, u, side, up, back) => P.clone().lerp(Q, u).add(V(side, up, back));
      const hl1 = hp(s * 2.0, 1.4, 1.7), hl2 = hp(s * 2.0, 1.4, -1.7);
      const thighLug1 = along(Hh, K, .58, s * .95, .0, .85), thighLug2 = along(Hh, K, .52, s * .95, 0, -.8);
      o.ramH[0].solve(hl1, thighLug1); o.ramH[1].solve(hl2, thighLug2);
      const kl1 = along(Hh, K, .3, s * .95, 0, -1.0), kl2 = along(K, A, .3, s * .95, 0, -.85);
      o.ramK.solve(kl1, kl2);
      const al1 = along(K, A, .62, s * .8, 0, -.7), al2 = A.clone().add(V(s * .8, .2, -.95));
      o.ramA.solve(al1, al2);
      o.ramT.solve(A.clone().add(V(s * .9, .15, .35)), A.clone().add(V(s * .9, -.2, 1.3)));
      // hoses
      const pHull = [hp(s * 1.3, 1.5, .9), hp(s * 1.3, 1.5, -.9), hp(s * 1.6, .5, 2.2), hp(s * 1.6, .5, -2.4)];
      o.hose[0].update(pHull[0], thighLug1.clone().add(V(s * .3, .1, 0)), { sag: 1.0 }); o.hose[1].update(pHull[1], thighLug2.clone().add(V(s * .3, .1, 0)), { sag: 1.0 });
      o.hose[2].update(hp(s * 1.7, 1.2, .0), kl1.clone().add(V(s * .25, 0, 0)), { sag: 1.4 }); o.hose[3].update(kl1.clone().add(V(s * .3, 0, 0)), al1.clone().add(V(s * .2, 0, 0)), { sag: .9 });
      o.shin.updateWorldMatrix(true, false); o.stand.position.copy(R.worldToLocal(o.shin.localToWorld(o.standLocal.clone()))).add(V(0, .1, 0));
      o.K = K; o.A = A;
    });
    // hull-to-hull hose bundles and the worker on the near knee landing
    if (this.kneeWorker) { legs[1].stand.updateWorldMatrix(true, false); const kl = R.worldToLocal(V(0, .08, 0).applyMatrix4(legs[1].stand.matrixWorld)); this._standing(this.kneeWorker, kl); }
    this.hookLine.rotation.z = Math.sin(phase * Math.PI * 4) * .04;
    return R;
  }
}
