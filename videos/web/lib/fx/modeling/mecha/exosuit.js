// MECHA KIT exosuit (MODELING c2): the ACP work exosuit of the reference painting (acp_fortress.jpg: ochre suits, a pack on the back, a
// helmet with a lifted visor, a crate carried at the hip), built as working equipment about 2.4 m tall with the operator VISIBLE:
// open frame, the coverall shows between the struts, the face is a face. Actuators run on the OUTSIDE of the limbs (pelvis to
// thigh, thigh to shin, upper arm to forearm) as rams that solve their own length from the pose; hoses leave the power pack
// and swing; every joint is a disc and a pin. Walk cycle by two-bone IK (hip height, foot lift, torso lean under the load).
//
//   const suit = new Exosuit(scene, { who: 'boris', carry: true }); suit.update(phase, { speed });   // phase 0..1 = one stride
//   suit.root.position.set(x, 0, z); suit.root.rotation.y = heading;
import * as THREE from 'three';
import { aimQ, mesh, rbox, box, cylX, cylY, cylZ, strut, PAL, Ram, Hose, ik2, V, crate, clevis, nextPid, decalPlane, stencilTexture, hazardTexture } from './parts.js';
import { Figure } from './figure.js';

const S = 1.15, L1 = .5 * S, L2 = .5 * S, HIP_Y = 1.2, ANK = .16;
function aim(g, A, B, up) {
  g.position.copy(A); const d = B.clone().sub(A).normalize(); aimQ(g, A, B, up || (Math.abs(d.y) > .8 ? V(0, 0, 1) : V(0, 1, 0)));
}
const mix = (a, b, u) => a.clone().lerp(b, u);

export class Exosuit {
  constructor(parent, { who = 'boris', carry = true, coverall = PAL.ochre, shell = PAL.ochre, pack = PAL.olive, crateText = 'A-5', crateScale = 1 } = {}) {
    this.root = new THREE.Group(); parent.add(this.root); const R = this.root; this.carry = carry;
    this.fig = new Figure(R, { who, coverall, hat: PAL.ochreLt, helmet: 'suit', scale: S });
    this.shell = shell;
    // pelvis frame + hip joints
    this.pel = new THREE.Group(); R.add(this.pel);
    rbox(.56, .26, .4, .08, PAL.steelDk, { parent: this.pel });
    const apron = rbox(.44, .24, .06, .03, shell, { parent: this.pel }); apron.position.set(0, -.05, .2);
    for (const s of [-1, 1]) { const hj = cylX(.1, .12, PAL.steel, { parent: this.pel }, 22); hj.position.set(s * .3, 0, 0); const cp = cylX(.055, .15, PAL.steelDk, { parent: this.pel }, 14); cp.position.set(s * .31, 0, 0); }
    // torso frame: chest plate (front, half-shell), spine, yoke, backpack
    this.tor = new THREE.Group(); R.add(this.tor); const T = this.tor;
    const chest = rbox(.6, .56, .3, .12, shell, { parent: T }); chest.position.set(0, .34 * S, .1 * S);
    for (const s of [-1, 1]) { const pd = rbox(.3, .2, .32, .08, shell, { parent: T }); pd.position.set(s * .36, .62 * S, 0); }
    const yoke = rbox(.62, .1, .26, .04, PAL.steelDk, { parent: T }); yoke.position.set(0, .56 * S, -.01);
    const spine = box(.1, .5, .08, PAL.steel, { parent: T }); spine.position.set(0, .3 * S, -.1);
    for (const s of [-1, 1]) { const st = box(.05, .5, .05, PAL.steelLt, { parent: T }); st.position.set(s * .22, .3 * S, .14 * S); const sj = cylX(.075, .1, PAL.steel, { parent: T }, 18); sj.position.set(s * .33, .55 * S, 0); }
    const pk = new THREE.Group(); pk.position.set(0, .34 * S, -.3); T.add(pk); this.pk = pk;
    rbox(.44, .52, .24, .05, pack, { parent: pk });
    for (const s of [-1, 1]) { const tk = cylY(.095, .62, PAL.steel, { parent: pk }, 18); tk.position.set(s * .17, .44, -.02); const cap = cylY(.1, .04, PAL.steelDk, { parent: pk }, 18); cap.position.set(s * .17, .76, -.02); const bd = cylY(.1, .05, PAL.ochreDk, { parent: pk }, 18); bd.position.set(s * .17, .5, -.02); }
    const ex = cylY(.035, .4, PAL.steelDk, { parent: pk }, 10); ex.position.set(0, .66, -.04);
    for (let i = 0; i < 5; i++) { const f = box(.4, .015, .1, PAL.steelDk, { parent: pk }); f.position.set(0, -.18 + i * .07, -.17); }
    const gauge = cylZ(.04, .03, PAL.steelLt, { parent: pk }, 14); gauge.position.set(.12, .06, -.13);
    const dec = decalPlane(stencilTexture('ACP-07', { w: 200, h: 60, col: '#1c1a16', wear: true }), .22, .066, { pid: pk.children[0].userData.pid }); dec.position.set(0, .22, -.126); dec.rotation.y = Math.PI; pk.add(dec);
    // legs
    this.leg = [-1, 1].map(s => {
      const o = { s };
      o.thigh = new THREE.Group(); o.shin = new THREE.Group(); R.add(o.thigh, o.shin);
      o.thighShell = rbox(.34, .32, L1 * .9, .1, shell, { parent: o.thigh }); o.thighShell.position.set(0, .0, L1 * .48);
      o.shinShell = rbox(.29, .28, L2 * .86, .09, shell, { parent: o.shin }); o.shinShell.position.set(0, .0, L2 * .5);
      o.kneeDisc = cylX(.095, .06, PAL.steel, { parent: R }, 22); o.kneePin = cylX(.035, .12, PAL.steelLt, { parent: R }, 10);
      o.kneePad = rbox(.3, .26, .16, .08, PAL.steelDk, { parent: R });
      o.struts = [0, 1].map(() => box(.045, .04, 1, PAL.steelLt, { parent: R }));
      o.boot = new THREE.Group(); R.add(o.boot);
      const sole = rbox(.3, .14, .52, .05, PAL.rubber, { parent: o.boot }); sole.position.set(0, -.08, .1);
      const toe = rbox(.3, .19, .2, .08, PAL.steelDk, { parent: o.boot }); toe.position.set(0, -.02, .34);
      const up = rbox(.3, .28, .32, .08, shell, { parent: o.boot }); up.position.set(0, .08, 0);
      const ank = cylX(.07, .06, PAL.steel, { parent: o.boot }, 16); ank.position.set(s * .09, .06, 0);
      o.ramH = new Ram(R, { barrelR: .042, rodR: .022, barrel: .26 }); o.ramK = new Ram(R, { barrelR: .042, rodR: .022, barrel: .24 });
      o.ramA = new Ram(R, { barrelR: .036, rodR: .02, barrel: .18 });
      o.hose = [new Hose(R, { r: .016, sag: .12, side: s * .05 }), new Hose(R, { r: .016, sag: .09, side: s * .04 })];
      return o;
    });
    // arms
    this.arm = [-1, 1].map(s => {
      const o = { s }; o.u = new THREE.Group(); o.f = new THREE.Group(); R.add(o.u, o.f);
      o.uSh = rbox(.22, .22, .32, .08, shell, { parent: o.u }); o.uSh.position.set(0, .0, .17);
      o.fSh = rbox(.2, .2, .3, .07, shell, { parent: o.f }); o.fSh.position.set(0, .0, .16);
      o.elb = cylX(.065, .06, PAL.steel, { parent: R }, 18);
      o.ram = new Ram(R, { barrelR: .032, rodR: .018, barrel: .2 });
      o.hose = new Hose(R, { r: .014, sag: .1, side: s * .05 });
      return o;
    });
    // the load
    if (carry) { this.crate = crate(.62 * crateScale, .4 * crateScale, .42 * crateScale, { col: PAL.khaki, text: crateText }); R.add(this.crate); }
    this.hoseP = [0, 1, 2, 3].map(() => new Hose(R, { r: .02, sag: .2, side: .08 }));
    this.t = 0; this.distPerCycle = .85 / .62;       // the root's travel per cycle at the default stride (planted feet stay planted)
  }
  // phase: 0..1 per stride (both legs). speed: m/s (sets stride). walking forward = +Z.
  update(phase = 0, { stride = .85, lean = .12, bob = .035 } = {}) {
    const R = this.root, fig = this.fig, legs = this.leg, arms = this.arm;
    const hipZ = 0, hipY = HIP_Y - bob * (.5 + .5 * Math.cos(phase * Math.PI * 4)) - .02;
    const ankles = [], knees = [], hips = [];
    legs.forEach((o, i) => {
      const ph = (phase + (i ? .5 : 0)) % 1, stanceF = .62;
      let z, y;
      if (ph < stanceF) { const u = ph / stanceF; z = stride / 2 * (1 - 2 * u); y = ANK + Math.max(0, (u > .85 ? (u - .85) / .15 : 0)) * .06; }
      else { const u = (ph - stanceF) / (1 - stanceF); z = -stride / 2 + stride * (u * u * (3 - 2 * u)); y = ANK + Math.sin(u * Math.PI) * .2; }
      const x = o.s * .2, A = V(x, y, hipZ + z), H = V(x, hipY, hipZ), K = ik2(H, A, L1, L2, V(0, 0, 1));
      ankles.push(A); knees.push(K); hips.push(H);
      aim(o.thigh, H, K, V(0, 0, 1)); aim(o.shin, K, A, V(0, 0, 1));
      o.boot.position.copy(A); o.boot.rotation.x = ph < stanceF ? (ph / stanceF > .85 ? -.35 * (ph / stanceF - .85) / .15 : 0) : -.35 * Math.cos((ph - stanceF) / (1 - stanceF) * Math.PI * .5) * 0 + .0;
      o.kneeDisc.position.set(x + o.s * .02, K.y, K.z); o.kneePin.position.copy(o.kneeDisc.position); o.kneePad.position.set(x, K.y + .0, K.z + .17);
      // outer struts (thigh and shin) beside the limb
      const off = o.s * .2; const Ho = H.clone().add(V(off, 0, 0)), Ko = K.clone().add(V(off, 0, 0)), Ao = A.clone().add(V(off, .1, 0));
      this._strut(o.struts[0], Ho, Ko); this._strut(o.struts[1], Ko, Ao);
      // rams: pelvis lug -> thigh lug (outside, ahead of the thigh); thigh lug -> shin lug (behind the knee); shin -> boot heel
      const lug = (P, Q, u, side, back) => P.clone().lerp(Q, u).add(V(side, 0, back));
      o.ramH.solve(H.clone().add(V(o.s * .26, .16, .09)), lug(H, K, .62, o.s * .16, .09));
      o.ramK.solve(lug(H, K, .3, o.s * .17, -.1), lug(K, A, .42, o.s * .15, -.09));
      o.ramA.solve(lug(K, A, .7, o.s * .15, -.08), A.clone().add(V(o.s * .12, .06, -.14)));
      o.pH = lug(H, K, .62, o.s * .16, .09); o.pK = lug(H, K, .3, o.s * .17, -.1);
    });
    // torso under load
    const hipC = V(0, hipY, hipZ); this.pel.position.copy(hipC).add(V(0, .06, 0)); this.pel.rotation.set(0, Math.sin(phase * Math.PI * 2) * .06, 0);
    this.tor.position.copy(hipC).add(V(0, .08, 0)); this.tor.rotation.set(lean, -Math.sin(phase * Math.PI * 2) * .07, 0);
    this.tor.updateMatrix();
    const tp = (x, y, z) => V(x, y, z).applyMatrix4(this.tor.matrix);
    // arms to the crate
    const cz = .56, cy = 1.0 - bob * (.5 + .5 * Math.cos(phase * Math.PI * 4)) * .8, cw = .33;
    arms.forEach(o => {
      const s = o.s, Sd = tp(s * .31, .55 * S, 0), W = V(s * cw, cy, cz), E = ik2(Sd, W, .3 * S, .27 * S, V(s * .7, -.5, -.25));
      aim(o.u, Sd, E); aim(o.f, E, W); o.elb.position.copy(E).add(V(s * .02, 0, 0));
      o.ram.solve(Sd.clone().add(V(s * .1, -.05, -.08)), E.clone().add(V(s * .09, .01, -.04)).lerp(W, .25));
      o.pS = Sd.clone().add(V(s * .08, -.1, -.1)); o.pW = W; o.E = E; o.S = Sd; o.W = W;
    });
    if (this.crate) this.crate.position.set(0, cy, cz + .01);
    // the operator, inside: legs a little inboard of the shell struts
    const P = {
      hip: hipC.clone().add(V(0, .03, 0)),
      kneeL: knees[1].clone().add(V(-.08, 0, .0)), kneeR: knees[0].clone().add(V(.08, 0, 0)), ankleL: ankles[1].clone().add(V(-.1, .02, 0)), ankleR: ankles[0].clone().add(V(.1, .02, 0)),
      shoulderL: tp(.2, .55 * S, 0), shoulderR: tp(-.2, .55 * S, 0), elbowL: arms[1].E.clone().add(V(-.08, 0, 0)), elbowR: arms[0].E.clone().add(V(.08, 0, 0)),
      wristL: arms[1].W.clone().add(V(-.03, 0, 0)), wristR: arms[0].W.clone().add(V(.03, 0, 0)), lean, head: tp(0, .78 * S, .03 * S), headPitch: -lean * .6 + .05, headYaw: Math.sin(phase * Math.PI * 2) * .1, torsoYaw: 0,
    };
    fig.pose(P);
    fig.torso.position.copy(this.tor.position); fig.torso.rotation.copy(this.tor.rotation);
    // hoses: pack ports -> the leg rams' barrels and the arm rams
    const port = (x, y) => tp(x, .3 * S + y, -.4);
    this.hoseP[0].update(port(.12, -.12), legs[1].pK, { sag: .25 }); this.hoseP[1].update(port(-.12, -.12), legs[0].pK, { sag: .25 });
    this.hoseP[2].update(port(.18, .1), arms[1].pS, { sag: .12 }); this.hoseP[3].update(port(-.18, .1), arms[0].pS, { sag: .12 });
    for (const o of legs) { o.hose[0].update(o.pH, o.pK, { sag: .06 }); o.hose[1].update(o.pK, o.pH.clone().lerp(o.pK, .3).add(V(0, -.4, 0)), { sag: .08 }); }
    for (const o of arms) o.hose.update(o.pS, o.E.clone().add(V(o.s * .1, .02, -.05)), { sag: .08 });
    return R;
  }
  _strut(m, A, B) { m.position.copy(A).lerp(B, .5); aimQ(m, A, B); m.scale.set(1, 1, A.distanceTo(B)); }
}
