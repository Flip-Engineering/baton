// MECHA KIT forklift (MODELING c2): the small ACP yard truck of the reference painting (rust-orange body, an overhead guard, a driver
// in an ochre suit), built to a real counterbalance truck's layout: counterweight over the steer axle, hood over the engine, a
// two-stage mast with chains and a carriage, forks, a seat, a steering wheel, a stencilled capacity plate. Forward +Z.
import * as THREE from 'three';
import { mesh, rbox, box, cylX, cylY, cylZ, strut, PAL, wheel, V, crate, nextPid, decalPlane, stencilTexture } from './parts.js';
import { Figure } from './figure.js';

export class Forklift {
  constructor(parent, { who = 'chidi', body = PAL.rust, load = true, lift = .35, text = 'ACP 1.5t' } = {}) {
    const R = this.root = new THREE.Group(); parent.add(R);
    const ch = rbox(1.0, .42, 2.0, .07, body, { parent: R }); ch.position.set(0, .62, -.05);
    const cw = rbox(1.1, .72, .6, .16, body, { parent: R }); cw.position.set(0, .9, -.9);
    const hood = rbox(.82, .3, .9, .06, PAL.steelDk, { parent: R }); hood.position.set(0, 1.02, -.45);
    const dash = rbox(.8, .5, .2, .05, body, { parent: R }); dash.position.set(0, 1.02, .62);
    const floor = box(.9, .06, 1.2, PAL.steelDk, { parent: R }); floor.position.set(0, .85, .0);
    // overhead guard: four posts and a roof grille
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const p = strut([sx * .46, .85, sz * .5 + .15], [sx * .46, 2.1, sz * .45 + .15], .05, .05, PAL.steelDk, { parent: R }); }
    const roof = box(1.0, .04, 1.05, PAL.steelDk, { parent: R }); roof.position.set(0, 2.1, .15);
    for (let i = -3; i <= 3; i++) { const b = box(.025, .03, 1.05, PAL.steelLt, { parent: R }); b.position.set(i * .14, 2.13, .15); }
    const seat = rbox(.5, .12, .46, .04, PAL.rubber, { parent: R }); seat.position.set(0, .93, -.2); const back = rbox(.5, .55, .1, .04, PAL.rubber, { parent: R }); back.position.set(0, 1.2, -.42);
    const col = cylZ(.025, .5, PAL.steelDk, { parent: R }, 8); col.position.set(0, 1.34, .38); col.rotation.x = -.8;
    const sw = new THREE.Mesh(new THREE.TorusGeometry(.17, .017, 6, 20), new THREE.MeshLambertMaterial({ color: PAL.rubber })); sw.userData.pid = nextPid(); sw.rotation.x = Math.PI / 2 - .8; sw.position.set(0, 1.52, .5); sw.castShadow = true; R.add(sw);
    // mast: two channels, cross-members, a carriage and forks
    for (const sx of [-1, 1]) { const m = box(.07, 2.0, .09, PAL.steelDk, { parent: R }); m.position.set(sx * .42, 1.2, 1.05); const m2 = box(.05, 1.8, .07, PAL.steel, { parent: R }); m2.position.set(sx * .3, 1.2 + lift * .6, 1.14); }
    for (const y of [.35, 1.1, 2.1]) { const b = box(.9, .06, .08, PAL.steelDk, { parent: R }); b.position.set(0, y + .2, 1.05); }
    const car = new THREE.Group(); car.position.y = lift; R.add(car); this.carriage = car;
    const plate = box(1.0, .5, .05, PAL.steel, { parent: car }); plate.position.set(0, .6, 1.2);
    for (const sx of [-1, 1]) { const f = box(.1, .05, 1.1, PAL.steelDk, { parent: car }); f.position.set(sx * .3, .36, 1.75); const fv = box(.1, .6, .05, PAL.steelDk, { parent: car }); fv.position.set(sx * .3, .62, 1.22); }
    for (const sx of [-1, 1]) { const chn = cylY(.012, 1.6, PAL.steelLt, { parent: R }, 6); chn.position.set(sx * .12, 1.35, 1.13); }
    const cyl = cylY(.05, 1.3, PAL.steelLt, { parent: R }, 10); cyl.position.set(0, .95, .96);
    // wheels
    for (const sx of [-1, 1]) { const w = wheel(.36, .26, { tire: PAL.rubber, rim: PAL.steel }); w.position.set(sx * .5, .36, .45); R.add(w); const w2 = wheel(.3, .22); w2.position.set(sx * .48, .3, -.78); R.add(w2); }
    const rl = rbox(.16, .1, .12, .03, PAL.hazard, { parent: R }); rl.position.set(.44, 1.18, -1.2);
    const beacon = cylY(.06, .1, PAL.hazard, { parent: R }, 12); beacon.position.set(.35, 2.2, -.2);
    const plateDec = decalPlane(stencilTexture(text, { w: 256, h: 64, col: '#1d1a14' }), .4, .1, { pid: dash.userData.pid }); plateDec.position.set(0, 1.07, .72); R.add(plateDec);
    const sideDec = decalPlane(stencilTexture('A-5', { w: 256, h: 128, col: '#1d1a14' }), .3, .15, { pid: ch.userData.pid }); sideDec.position.set(.502, .66, .2); sideDec.rotation.y = Math.PI / 2; R.add(sideDec);
    // driver
    this.fig = new Figure(R, { who, coverall: PAL.ochre, hat: PAL.ochreLt, helmet: 'suit', scale: 1.1 });
    const hip = V(0, 1.05, -.2), P = {
      hip, kneeL: V(.15, 1.18, .28), kneeR: V(-.15, 1.18, .28), ankleL: V(.17, .9, .5), ankleR: V(-.17, .9, .5),
      shoulderL: V(.2, 1.62, -.25), shoulderR: V(-.2, 1.62, -.25), elbowL: V(.28, 1.4, .05), elbowR: V(-.28, 1.4, .05), wristL: V(.14, 1.45, .4), wristR: V(-.14, 1.45, .4),
      lean: .15, head: V(0, 1.98, -.12), headPitch: .05, headYaw: 0, torsoYaw: 0,
    };
    this.fig.pose(P); this.fig.torso.position.set(0, 1.08, -.22); this.fig.torso.rotation.x = .1;
    if (load) { const c = crate(.8, .6, .6, { col: PAL.khaki, text: 'B-12' }); c.position.set(0, .66 + lift, 1.85); R.add(c); }
  }
}
