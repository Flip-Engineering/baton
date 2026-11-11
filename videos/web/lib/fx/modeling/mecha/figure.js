// MECHA KIT figure (MODELING c2): an operator drawn as a person, not a mannequin: a skull with brow, nose, jaw, ears and a moustache
// or not, a hard hat with a brim and chin strap, goggles pushed up, a coverall with a collar and a name patch. Segments are
// capsules that follow joint points each frame (the machine's own kinematics drive them), so the same figure sits in a walker's
// cab, stands inside an exosuit or drives a forklift. Faces are specific (the `who` record) so two operators are never one.
import * as THREE from 'three';
import { aimQ, mesh, paint, PAL, box, rbox, nextPid, stencilTexture, decalPlane } from './parts.js';

export const WHO = {
  ana:   { skin: '#b9825c', hair: '#1e1612', stache: false, brow: 1.1, nose: 1.0, jaw: 1.0, age: 0 },
  boris: { skin: '#d1a784', hair: '#6a5a46', stache: true, brow: 1.4, nose: 1.15, jaw: 1.15, age: 1 },
  chidi: { skin: '#6b4630', hair: '#100c0a', stache: false, brow: .9, nose: 1.1, jaw: .95, age: 0 },
  dolores: { skin: '#a8714f', hair: '#2a1e18', stache: false, brow: 1.0, nose: .9, jaw: .9, age: 1 },
  emil:  { skin: '#e0b898', hair: '#9a8a6a', stache: true, brow: 1.2, nose: 1.3, jaw: 1.05, age: 2 },
};

class Seg {
  constructor(parent, r0, r1, col, { cls = 'subject' } = {}) {
    const g = new THREE.CylinderGeometry(r1, r0, 1, 12, 1); g.rotateX(Math.PI / 2);
    this.m = mesh(g, col, { parent, cls }); this.sph = [];
  }
  set(A, B) { this.m.position.copy(A).lerp(B, .5); aimQ(this.m, A, B); this.m.scale.set(1, 1, Math.max(.001, A.distanceTo(B))); }
}

export class Figure {
  // opts: who (WHO key), suit colour, hat colour, scale (1 = 1.75 m person), gloves
  constructor(parent, { who = 'ana', coverall = PAL.ochre, hat = PAL.white, scale = 1, helmet = 'hat', cls = 'subject', respirator = false } = {}) {
    this.g = new THREE.Group(); parent.add(this.g); this.s = scale; const s = scale, P = new THREE.Group(); this.g.add(P);
    const W = this.W = WHO[who] || WHO.ana, o = { cls };
    this.limb = {};
    const seg = (n, r0, r1, col) => (this.limb[n] = new Seg(this.g, r0 * s, r1 * s, col, o));
    seg('thighL', .085, .065, coverall); seg('thighR', .085, .065, coverall); seg('shinL', .065, .05, coverall); seg('shinR', .065, .05, coverall);
    seg('uarmL', .052, .045, coverall); seg('uarmR', .052, .045, coverall); seg('farmL', .045, .036, coverall); seg('farmR', .045, .036, coverall);
    this.boots = [0, 1].map(() => rbox(.12 * s, .1 * s, .3 * s, .03 * s, PAL.rubber, { parent: this.g, cls }));
    this.hands = [0, 1].map(() => { const h = mesh(new THREE.SphereGeometry(.045 * s, 10, 8), PAL.steelDk, { parent: this.g, cls }); return h; });
    // torso + pelvis
    this.pelvis = rbox(.34 * s, .2 * s, .22 * s, .05 * s, coverall, { parent: this.g, cls });
    this.torso = new THREE.Group(); this.g.add(this.torso);
    const chest = rbox(.38 * s, .5 * s, .24 * s, .07 * s, coverall, { parent: this.torso, cls }); chest.position.y = .3 * s;
    const sh = rbox(.46 * s, .12 * s, .2 * s, .05 * s, coverall, { parent: this.torso, cls }); sh.position.y = .5 * s;
    const belt = box(.36 * s, .05 * s, .25 * s, PAL.strap, { parent: this.torso, cls }); belt.position.y = .02 * s;
    const pat = decalPlane(stencilTexture((who || 'ana').toUpperCase().slice(0, 6), { w: 160, h: 48, col: '#201c14', wear: false }), .12 * s, .04 * s, { pid: chest.userData.pid }); pat.position.set(.08 * s, .42 * s, .126 * s); this.torso.add(pat);
    // neck + head
    this.head = new THREE.Group(); this.g.add(this.head);
    const skin = PAL.skin, sk = W.skin;
    const neck = mesh(new THREE.CylinderGeometry(.045 * s, .055 * s, .08 * s, 10), sk, { parent: this.torso, cls }); neck.position.y = .6 * s;
    const skull = mesh(new THREE.SphereGeometry(.095 * s, 18, 14), sk, { parent: this.head, cls }); skull.scale.set(.92, 1.08, 1);
    const jaw = rbox(.13 * s * W.jaw, .1 * s, .13 * s, .04 * s, sk, { parent: this.head, cls }); jaw.position.set(0, -.07 * s, .02 * s);
    const brow = rbox(.15 * s, .03 * s * W.brow, .05 * s, .012 * s, sk, { parent: this.head, cls }); brow.position.set(0, .03 * s, .085 * s);
    const nose = mesh(new THREE.ConeGeometry(.022 * s * W.nose, .06 * s * W.nose, 6), sk, { parent: this.head, cls }); nose.rotation.x = Math.PI / 2 + .25; nose.position.set(0, -.015 * s, .105 * s);
    for (const sx of [-1, 1]) {
      const ear = mesh(new THREE.SphereGeometry(.026 * s, 8, 6), sk, { parent: this.head, cls }); ear.scale.set(.5, 1, .8); ear.position.set(sx * .092 * s, -.005 * s, -.005 * s);
      const eye = mesh(new THREE.SphereGeometry(.011 * s, 6, 5), '#17130f', { parent: this.head, cls, line: false }); eye.position.set(sx * .036 * s, .01 * s, .097 * s);
      const lid = box(.034 * s, .008 * s, .01 * s, W.hair, { parent: this.head, cls, line: false }); lid.position.set(sx * .036 * s, .028 * s, .1 * s);
    }
    if (W.stache) { const st = rbox(.08 * s, .022 * s, .03 * s, .01 * s, W.hair, { parent: this.head, cls }); st.position.set(0, -.058 * s, .105 * s); }
    const mouth = box(.05 * s, .006 * s, .01 * s, '#4a2a22', { parent: this.head, cls, line: false }); mouth.position.set(0, -.085 * s, .108 * s);
    if (respirator) { const r = rbox(.13 * s, .09 * s, .07 * s, .03 * s, PAL.steel, { parent: this.head, cls }); r.position.set(0, -.07 * s, .105 * s); }
    if (helmet === 'hat') {
      const dome = mesh(new THREE.SphereGeometry(.108 * s, 18, 10, 0, Math.PI * 2, 0, Math.PI * .56), hat, { parent: this.head, cls }); dome.position.y = .02 * s; dome.scale.set(1, 1.05, 1.08);
      const brimG = new THREE.CylinderGeometry(.13 * s, .13 * s, .012 * s, 20); const brimM = mesh(brimG, hat, { parent: this.head, cls }); brimM.position.set(0, .045 * s, .02 * s); brimM.scale.set(1, 1, 1.12);
      const ridge = box(.02 * s, .02 * s, .2 * s, hat, { parent: this.head, cls }); ridge.position.set(0, .125 * s, 0);
      const gog = box(.15 * s, .035 * s, .03 * s, PAL.steelDk, { parent: this.head, cls }); gog.position.set(0, .075 * s, .098 * s);
      for (const sx of [-1, 1]) { const lens = mesh(new THREE.CylinderGeometry(.022 * s, .022 * s, .012 * s, 12), PAL.glass, { parent: this.head, cls }); lens.rotation.x = Math.PI / 2; lens.position.set(sx * .038 * s, .075 * s, .115 * s); }
      const strap = box(.012 * s, .1 * s, .012 * s, PAL.strap, { parent: this.head, cls, line: false }); strap.position.set(.088 * s, -.05 * s, .02 * s);
    } else if (helmet === 'suit') {   // the reference's exosuit helmet: a rounded shell, a lifted visor, a collar ring
      const dome = mesh(new THREE.SphereGeometry(.125 * s, 18, 12, 0, Math.PI * 2, 0, Math.PI * .62), PAL.ochreLt, { parent: this.head, cls }); dome.position.y = .015 * s;
      const rim = mesh(new THREE.TorusGeometry(.12 * s, .012 * s, 6, 24), PAL.steelDk, { parent: this.head, cls }); rim.rotation.x = Math.PI / 2; rim.position.y = -.015 * s;
      const vis = mesh(new THREE.SphereGeometry(.128 * s, 14, 8, -.9, 1.8, .55, .7), PAL.steelDk, { parent: this.head, cls }); vis.position.y = .03 * s; vis.rotation.x = -.5; vis.position.z = .03 * s;
      const lamp = rbox(.04 * s, .03 * s, .04 * s, .01 * s, PAL.steelLt, { parent: this.head, cls }); lamp.position.set(.09 * s, .1 * s, .06 * s);
    }
  }
  // P: { hip (pelvis centre), kneeL, kneeR, ankleL, ankleR, shoulderL, shoulderR, elbowL, elbowR, wristL, wristR, lean (rad about X), headYaw, headPitch, torsoYaw }
  // x = lateral (left is +x), z = forward.
  pose(P) {
    const s = this.s, L = this.limb;
    this.pelvis.position.copy(P.hip); this.pelvis.rotation.set(0, P.torsoYaw || 0, 0);
    const hl = P.hip.clone().add(new THREE.Vector3(.09 * s, 0, 0)), hr = P.hip.clone().add(new THREE.Vector3(-.09 * s, 0, 0));
    L.thighL.set(hl, P.kneeL); L.thighR.set(hr, P.kneeR); L.shinL.set(P.kneeL, P.ankleL); L.shinR.set(P.kneeR, P.ankleR);
    this.boots[0].position.copy(P.ankleL).add(new THREE.Vector3(0, -.03 * s, .07 * s)); this.boots[1].position.copy(P.ankleR).add(new THREE.Vector3(0, -.03 * s, .07 * s));
    if (P.footPitch) { this.boots[0].rotation.x = P.footPitch[0]; this.boots[1].rotation.x = P.footPitch[1]; }
    this.torso.position.copy(P.hip).add(new THREE.Vector3(0, .05 * s, 0)); this.torso.rotation.set(P.lean || 0, P.torsoYaw || 0, 0);
    L.uarmL.set(P.shoulderL, P.elbowL); L.uarmR.set(P.shoulderR, P.elbowR); L.farmL.set(P.elbowL, P.wristL); L.farmR.set(P.elbowR, P.wristR);
    this.hands[0].position.copy(P.wristL); this.hands[1].position.copy(P.wristR);
    this.head.position.copy(P.head); this.head.rotation.set(P.headPitch || 0, P.headYaw || 0, 0);
  }
  // joint points of the torso in the figure's parent space (shoulders, neck) for a given pelvis/lean: used by the machines to attach the arms
  torsoPoint(x, y, z) { const v = new THREE.Vector3(x, y, z).multiplyScalar(this.s); this.torso.updateMatrix(); return v.applyMatrix4(this.torso.matrix); }
}
