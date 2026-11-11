// GIANT (MODELING c3): the giant robot, rebuilt as something BUILT: an armature of trusses clad in lapped steel plates, with
// fixtures in human units (ladders, hatches, rails, rams, stencils, rivet rows), four silhouettes and four heads on ONE rig.
//
//   const G = new Giant(scene, { sil: 'S1', head: 'H3', k: .68 });   // k = real metres per local unit; standing height = 92 k  (62.6 m)
//   G.pose(POSES.stand)            // the same pose tables as scenes/mecha.world.js (POSES, lerpPose), degrees->radians arrays
//   G.setClad(0..1)                // how much of the skin is on (the build as a process: armature first, plates after)
//   G.sole(), G.wp(...)            // foot and joint world positions (the choreography plants feet on them)
//
// Silhouettes (families in research/capabilities/modeling.md): S1 Mukhina stride (D, A) | S2 block miner (D) | S3 colossus of
// industry (D, C, B) | S4 half-clad lattice giant (C). Heads: H1 welding helmet (A, F) | H2 hard-hat brim over a riveted plate
// (F) | H3 sculpted steel worker's face (D) | H4 crew bridge (B). No fins, no antennae, no glowing eye slits, no candy panels.
// The ONE red is the ACP mark (four stripes, upright) on a dark chest plate; everything else is steel, primer and scale.
import * as THREE from 'three';
import { steelMat, plainMat, loft, boxUV, clad, setClad, bars, rng } from './giant_mat.js';
import { Ram, ladder, handrail, stencilTexture, decalPlane, PAL, clevis } from './parts.js';
import { drawMark, RED } from '../../../closer.js';
THREE.ColorManagement.enabled = false;

const d2r = Math.PI / 180;
export const SILS = {
  S1: { name: 'Mukhina stride', legS: 1, shX: 17.6, chest: [13.4, 8.2], waist: [7.2, 5.6], neck: [3.9, 3.6], ua: [3.5, 3.1], fa: [4.1, 2.9], th: [4.5, 3.7], sh: [3.7, 2.9], hand: 1.25, foot: 1.05, style: { ua: 'clad', fa: 'clad', th: 'clad', sh: 'clad' }, base: [150, 154, 158], metal: .78, rough: .38, hammer: .5 },
  S2: { name: 'block miner', legS: .72, shX: 19.5, chest: [16.2, 10.4], waist: [9.4, 7.4], neck: [4.8, 1.2], ua: [4.7, 4.3], fa: [6.4, 4.2], th: [5.8, 4.8], sh: [4.8, 3.9], hand: 1.9, foot: 1.2, style: { ua: 'clad', fa: 'clad', th: 'clad', sh: 'clad' }, base: [86, 90, 96], metal: .5, rough: .7, hammer: .15 },
  S3: { name: 'colossus of industry', legS: 1, shX: 18.2, chest: [14.4, 9], waist: [7.6, 6], neck: [3.4, 3.2], ua: [3.8, 3.4], fa: [3.6, 3], th: [4.6, 3.8], sh: [4.5, 3.8], hand: 1.35, foot: 1.1, style: { ua: 'clad', fa: 'boom', th: 'clad', sh: 'drum' }, base: [108, 110, 112], metal: .5, rough: .62, hammer: .05 },
  S4: { name: 'half-clad lattice', legS: 1.02, shX: 16.4, chest: [11.6, 7.2], waist: [6, 4.8], neck: [3.2, 3], ua: [3.1, 2.8], fa: [3.2, 2.6], th: [4, 3.3], sh: [3.2, 2.6], hand: 1.1, foot: 1, style: { ua: 'clad', fa: 'lattice', th: 'lattice', sh: 'lattice' }, base: [118, 120, 122], metal: .55, rough: .6, hammer: 0 },
};
export const HEADS = ['H1', 'H2', 'H3', 'H4'];
export const HEAD_NAMES = { H1: 'welding helmet', H2: 'hard-hat brim', H3: 'steel worker\'s face', H4: 'crew bridge' };

function markCanvas(px = 512, bg = null) {
  const c = document.createElement('canvas'); c.width = px; c.height = Math.round(px * .62); const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); }
  drawMark(g, c.width / 2, c.height / 2, c.height * .96, { color: RED }); return c;
}
const node = (parent, p = [0, 0, 0], name = '') => { const o = new THREE.Group(); o.position.set(...p); o.name = name; parent.add(o); return o; };
const add = (parent, mesh, p = [0, 0, 0], r = [0, 0, 0]) => { mesh.position.set(...p); mesh.rotation.set(...r); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh; };
const lerp = (a, b, t) => a + (b - a) * t;
// profile: along t, radii from r0 to r1 with a bulge (muscle / drum) and optional flare at the end
const P = (r0, r1, { bulge = 0, flare = 0, ez = 1, cz = 0 } = {}) => t => { const r = lerp(r0, r1, t) * (1 + bulge * Math.sin(Math.PI * t) + flare * t * t * t); return { rx: r, rz: r * ez, cx: 0, cz }; };

export class Giant {
  constructor(parent, { sil = 'S1', head = 'H1', k = .68, clad: cl = 1, seed = 1, markTex = null, ground = 0, rivets = true, steel = null } = {}) {
    const S = this.S = SILS[sil]; this.sil = sil; this.headKind = head; this.k = k; this.m = 1 / k; this.seed = seed; const m = this.m, R = rng(seed + 11);
    this.g = new THREE.Group(); this.g.scale.setScalar(k); parent.add(this.g);
    const steelM = steel || steelMat({ seed: seed * 7 + 1, base: S.base, metal: S.metal, rough: S.rough, hammer: S.hammer, ground, grime: .85 });
    const dark = steelMat({ seed: seed * 7 + 2, base: [58, 60, 64], metal: .4, rough: .7, ground, grime: .9, tone: 8 });
    const prim = plainMat('#3a3633', { metal: .3, rough: .8 }), blk = plainMat('#17171a', { metal: .2, rough: .6 });
    this.M = { steel: steelM, dark, prim, blk };
    const rv = rivets ? .3 : 0, arm = { r: .13 };
    const J = this.J = {}; this.rams = []; this.fixtures = [];
    const hip0 = 46 - (1 - S.legS) * 0;                         // the hips node sits at y 46 in the stock rig; legs are lengthened or shortened below
    J.hips = this.root = node(this.g, [0, 46, 0], 'root');
    // ---- pelvis (clad, a ring)
    const pel = clad(J.hips, steelM, P(S.waist[0] * 1.45, S.waist[0] * 1.2, { ez: .78 }), 8, { k, dir: -1, pitch: 1.5, n: 24, rivets: rv, seed: seed + 1, armature: dark, arm, thrSpan: .5, cap1: true }); pel.position.y = 4;
    this.skin = [pel];
    // ---- waist and chest
    J.waist = node(J.hips, [0, 4, 0], 'waist');
    this.skin.push(clad(J.waist, steelM, P(S.waist[0], S.waist[0] * 1.08, { ez: S.waist[1] / S.waist[0] }), 8, { k, dir: 1, pitch: 1.2, n: 24, rivets: rv, seed: seed + 2, armature: dark, arm, thrSpan: .5 }));
    J.chest = node(J.waist, [0, 8, 0], 'chest');
    const cs = S.style, chestProf = t => { const w = lerp(S.chest[0] * .86, S.chest[0] * 1.02, Math.min(1, t * 2.6)) * (t > .7 ? lerp(1, .78, (t - .7) / .3) : 1); return { rx: w, rz: lerp(S.chest[1] * .85, S.chest[1], Math.min(1, t * 2)) * (t > .75 ? lerp(1, .6, (t - .75) / .25) : 1), cx: 0, cz: -.4 }; };
    const chestClad = clad(J.chest, steelM, chestProf, 19, { k, dir: 1, pitch: this.sil === 'S3' ? 2.4 : 1.5, lap: this.sil === 'S3' ? .12 : .07, n: 28, rivets: rv, seed: seed + 3, armature: dark, arm: { r: .16 }, thrSpan: .45, cap1: true });
    this.skin.push(chestClad); this.chestClad = chestClad;
    // the one red: the mark, upright, on a dark chest plate with its own rivet frame, at human-readable size (about 7 m)
    const mk = (markTex ? markTex : new THREE.CanvasTexture(markCanvas(512))); mk.colorSpace = THREE.NoColorSpace;
    const plateW = 12.6, plateH = 9.6, zf = S.chest[1] + .7;
    const cp = add(J.chest, new THREE.Mesh(boxUV(new THREE.BoxGeometry(plateW, plateH, 1.0), k), dark), [0, 8.4, zf - .4]); cp.userData.keep = true;
    const mkm = new THREE.Mesh(new THREE.PlaneGeometry(plateW * .84, plateW * .84 * .62), new THREE.MeshStandardMaterial({ map: mk, transparent: true, alphaTest: .35, emissive: new THREE.Color('#bf1f1f'), emissiveMap: mk, emissiveIntensity: .5, roughness: .55, metalness: 0, side: THREE.DoubleSide }));
    mkm.position.set(0, 8.4, zf + .12); J.chest.add(mkm); this.markMesh = mkm;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (let q = 0; q < 5; q++) { const r = new THREE.Mesh(new THREE.SphereGeometry(.2, 6, 4), steelM); r.position.set(sx * (plateW / 2 - .5), 8.4 + sy * (plateH / 2 - .5) * (1 - q * .0), zf + .14); r.position.x = sx * (plateW / 2 - .5 - q * .0); if (q === 0) J.chest.add(r); }
    // ---- neck and head
    J.neck = node(J.chest, [0, 19, 0.5], 'neck');
    this.skin.push(clad(J.neck, steelM, P(S.neck[0], S.neck[0] * 1.08), S.neck[1] + 1.2, { k, dir: 1, pitch: 1.2, n: 18, rivets: rv, seed: seed + 4, armature: dark, arm: { r: .09 }, thrSpan: .3, cap1: true }));
    J.head = node(J.neck, [0, S.neck[1] + 1, 0], 'head'); this.buildHead(J.head, head, { steelM, dark, prim, blk, k, seed, ground });
    // ---- arms
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R';
      const sh = J['sh' + L] = node(J.chest, [s * S.shX, 14, 0], 'sh' + L);
      add(sh, new THREE.Mesh(new THREE.SphereGeometry(S.ua[0] * 1.2, 20, 14), dark));
      // the shoulder yoke: a lapped dome plus a rail along its top (human size)
      const ua = J['ua' + L] = node(sh, [0, 0, 0], 'ua' + L);
      const uaStyle = cs.ua; this.skin.push(this.limb(ua, uaStyle, P(S.ua[0] * 1.08, S.ua[1]), 18, { dir: -1, seed: seed + 5 + s, bulge: .06, k, rv }));
      const el = J['el' + L] = node(ua, [0, -18, 0], 'el' + L);
      add(el, new THREE.Mesh(new THREE.SphereGeometry(S.fa[0] * .7, 16, 12), dark));
      this.skin.push(this.limb(el, cs.fa, P(S.fa[0], S.fa[1], { bulge: .12 }), 16, { dir: -1, seed: seed + 7 + s, k, rv }));
      const wr = J['wr' + L] = node(el, [0, -16, 0.3], 'wr' + L);
      this.buildHand(wr, s, { steelM, dark, k, scale: S.hand });
    }
    // ---- legs: thigh and shin lengths scale with legS
    const th = 21 * S.legS, sn = 19 * S.legS; this.leg = { th, sn };
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R';
      const hp = J['hip' + L] = node(J.hips, [s * 7.5, -2, 0], 'hip' + L);
      add(hp, new THREE.Mesh(new THREE.SphereGeometry(S.th[0] * .85, 18, 12), dark));
      this.skin.push(this.limb(hp, cs.th, P(S.th[0], S.th[1], { bulge: .05 }), th, { dir: -1, seed: seed + 9 + s, k, rv }));
      const kn = J['kn' + L] = node(hp, [0, -th, 0], 'kn' + L);
      add(kn, new THREE.Mesh(new THREE.SphereGeometry(S.th[1] * .95, 16, 12), dark));
      // knee cap: a lapped plate on the front (the thing a kneeling giant kneels on)
      add(kn, new THREE.Mesh(boxUV(new THREE.BoxGeometry(S.th[1] * 1.7, S.th[1] * 1.5, 2.2), k), steelM), [0, .4, S.th[1] * .98], [-.2, 0, 0]);
      this.skin.push(this.limb(kn, cs.sh, P(S.sh[0], S.sh[1] * .86, { flare: .12 }), sn, { dir: -1, seed: seed + 11 + s, k, rv }));
      const an = J['an' + L] = node(kn, [0, -sn, 0], 'an' + L);
      add(an, new THREE.Mesh(new THREE.SphereGeometry(S.sh[1] * .8, 12, 8), dark));
      this.buildFoot(an, s, steelM, dark, S.foot);
    }
    this.buildFixtures(S, { steelM, dark, prim, blk, k });
    this.buildRams(S, { dark, k });
    if (sil === 'S3') this.buildIndustry(S, { steelM, dark, prim, blk, k });
    this.setClad(cl);
    this.pose(POSE_STAND);
  }

  // one limb segment in its style: clad courses over an armature, a bare lattice, a crane boom, or a drum (boiler) with bands
  limb(parent, style, prof, len, { dir, seed, bulge = 0, k, rv }) {
    const { steelM, dark } = this.M, arm = { r: .14 };
    if (style === 'lattice' || style === 'boom') {
      const g = new THREE.Group(); parent.add(g);
      const n = Math.max(3, Math.round(len * k / (style === 'boom' ? 3.2 : 3.6)) + 1), list = [], chord = (style === 'boom' ? .2 : .26) / k, rings = [];
      const nCh = style === 'boom' ? 4 : 6;
      for (let i = 0; i < n; i++) { const t = i / (n - 1), p = prof(t), y = dir * t * len, r = []; for (let j = 0; j < nCh; j++) { const a = j / nCh * Math.PI * 2 + (nCh === 4 ? Math.PI / 4 : 0); r.push(new THREE.Vector3(p.rx * .92 * Math.sin(a), y, p.rz * .92 * Math.cos(a))); } rings.push(r); }
      for (let i = 0; i < n; i++) for (let j = 0; j < nCh; j++) { list.push([rings[i][j], rings[i][(j + 1) % nCh], chord * .55]); if (i < n - 1) { list.push([rings[i][j], rings[i + 1][j], chord]); list.push([rings[i][j], rings[i + 1][(j + 1) % nCh], chord * .6]); } }
      // plates only on the working side: one clad strip on the outer face (a lattice that is half finished)
      g.userData.armature = bars(list, dark, g); g.userData.courses = [];
      // gussets at the nodes (round plates) so the truss reads as welded, not wireframe
      const gus = new THREE.SphereGeometry(1, 8, 6), im = new THREE.InstancedMesh(gus, steelM, n * nCh), M4 = new THREE.Matrix4(); let q = 0;
      for (let i = 0; i < n; i++) for (let j = 0; j < nCh; j++) { M4.compose(rings[i][j], new THREE.Quaternion(), new THREE.Vector3(1, 1, 1).multiplyScalar(chord * 1.5)); im.setMatrixAt(q++, M4); } im.castShadow = true; g.add(im);
      return g;
    }
    if (style === 'drum') {
      const g = clad(parent, steelM, P(prof(0).rx * 1.05, prof(1).rx * 1.0, { flare: .12, bulge: .1 }), len, { k, dir, pitch: 2.6, lap: .12, n: 26, rivets: rv, seed, armature: dark, arm, thrSpan: .5 });
      // three weld bands (the drum's girth seams), proud
      for (const t of [.25, .5, .75]) { const p = prof(t); const b = new THREE.Mesh(loft([{ y: dir * (t * len - .3), rx: p.rx * 1.12, rz: p.rz * 1.12 }, { y: dir * (t * len + .3), rx: p.rx * 1.12, rz: p.rz * 1.12 }], { n: 26, k, cap0: false, cap1: false }), dark); g.add(b); b.userData.keep = true; }
      return g;
    }
    return clad(parent, steelM, prof, len, { k, dir, pitch: 1.5, n: 22, rivets: rv, seed, armature: dark, arm });
  }

  buildFoot(an, s, steelM, dark, fs) {
    const k = this.k, sh = new THREE.Shape(), z0 = -6.2 * fs, z1 = 12.5 * fs;
    sh.moveTo(z0, -4.3); sh.lineTo(z1, -4.3); sh.lineTo(z1 + .3, -2.6); sh.lineTo(z1 - 3, -.4); sh.lineTo(3.6 * fs, 2.6); sh.lineTo(-4.8 * fs, 2.8); sh.lineTo(z0 - .4, -1.2); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 9.4 * fs, bevelEnabled: true, bevelSize: .6, bevelThickness: .6, bevelSegments: 2 }); g.rotateY(-Math.PI / 2); g.translate(4.7 * fs, 0, 0);
    // rotateY(-90): shape x -> world z. After the rotation the extrude depth runs along x
    const foot = add(an, new THREE.Mesh(boxUV(g, k), steelM)); foot.userData.keep = true;
    // the sole: a dark tread plate; cleats; toe cap
    add(an, new THREE.Mesh(new THREE.BoxGeometry(10.4 * fs, .8, (z1 - z0) + 1.4), dark), [0, -4.4, (z0 + z1) / 2]);
    for (let q = 0; q < 6; q++) add(an, new THREE.Mesh(new THREE.BoxGeometry(10.6 * fs, .5, .5), dark), [0, -4.9, z0 + 1.6 + q * ((z1 - z0 - 3) / 5)]);
  }

  buildHand(wr, s, { steelM, dark, k, scale: hs }) {
    const J = this.J, L = s > 0 ? 'L' : 'R', hand = J['hand' + L] = node(wr, [0, -2.5 * hs, 0], 'hand');
    add(wr, new THREE.Mesh(new THREE.CylinderGeometry(2.4 * hs, 2.6 * hs, 3 * hs, 14), dark), [0, -.8 * hs, 0]);
    add(hand, new THREE.Mesh(boxUV(new THREE.BoxGeometry(7.4 * hs, 7.6 * hs, 3.6 * hs), k), steelM), [0, -3.7 * hs, 0]);
    const fingers = [];
    for (let f = 0; f < 4; f++) {
      const x = (-2.7 + f * 1.8) * s * hs; let par = node(hand, [x, -7.4 * hs, .6 * hs]); const segs = [];
      for (let q = 0; q < 3; q++) {
        const ln = [3.3, 2.6, 2.1][q] * hs; add(par, new THREE.Mesh(new THREE.CylinderGeometry(.82 * hs, .82 * hs, 1.9 * hs, 10), dark), [0, 0, 0], [0, 0, Math.PI / 2]);
        add(par, new THREE.Mesh(boxUV(new THREE.BoxGeometry(1.6 * hs, ln, 1.9 * hs), k), steelM), [0, -ln / 2, .1]); segs.push(par); par = node(par, [0, -ln, 0]);
      }
      fingers.push(segs);
    }
    const t1 = node(hand, [s * 3.7 * hs, -2.5 * hs, 1.2 * hs]); add(t1, new THREE.Mesh(boxUV(new THREE.BoxGeometry(1.8 * hs, 3.2 * hs, 2 * hs), k), steelM), [0, -1.6 * hs, 0]);
    const t2 = node(t1, [0, -3.2 * hs, 0]); add(t2, new THREE.Mesh(boxUV(new THREE.BoxGeometry(1.7 * hs, 2.4 * hs, 1.9 * hs), k), steelM), [0, -1.2 * hs, 0]);
    J['fingers' + L] = fingers; J['thumb' + L] = [t1, t2];
  }

  // ---- heads. All in head-local units (y up from the neck top, z forward); about 11 high.
  buildHead(H, kind, { steelM, dark, prim, blk, k, seed, ground }) {
    const rv = .3, glass = new THREE.MeshStandardMaterial({ color: '#0c0d10', roughness: .15, metalness: .9, emissive: new THREE.Color('#ffb060'), emissiveIntensity: .08 });
    this.glassMat = glass; this.headParts = [];
    if (kind === 'H1') {          // welding helmet: a rounded shell, a deep front housing with a dark lens, a neck bib; lens flipped up on hinges
      const prof = t => { const r = t < .85 ? 5.6 + 1.2 * Math.sin(Math.PI * Math.min(1, t * 1.15)) : 5.6 * Math.sqrt(Math.max(0, 1 - Math.pow((t - .85) / .15, 2))) + .2; return { rx: r, rz: r * 1.1, cx: 0, cz: -.4 }; };
      this.headParts.push(clad(H, steelM, prof, 11.6, { k, dir: 1, pitch: 1.1, n: 26, rivets: rv, seed: seed + 21, thrSpan: .3 })); H.children.at(-1).position.y = .2;
      add(H, new THREE.Mesh(boxUV(new THREE.BoxGeometry(9.8, 6.2, 3.4), k), dark), [0, 5.6, 5.9], [-.08, 0, 0]);
      add(H, new THREE.Mesh(new THREE.BoxGeometry(7.4, 2.2, .5), glass), [0, 5.7, 7.65], [-.08, 0, 0]);       // the lens: a dark slit, faint warm light behind
      add(H, new THREE.Mesh(new THREE.BoxGeometry(8.4, .5, .5), dark), [0, 7.1, 7.7], [-.08, 0, 0]); add(H, new THREE.Mesh(new THREE.BoxGeometry(8.4, .5, .5), dark), [0, 4.3, 7.7], [-.08, 0, 0]);
      for (const sx of [-1, 1]) { add(H, new THREE.Mesh(new THREE.CylinderGeometry(.9, .9, 1.2, 12), dark), [sx * 5.3, 5.5, 3.2], [0, 0, Math.PI / 2]); }
      add(H, new THREE.Mesh(boxUV(new THREE.BoxGeometry(9, 3.4, 5.2), k), steelM), [0, -.4, 1.6], [.35, 0, 0]);    // bib
    } else if (kind === 'H2') {   // hard-hat brim over a riveted plate with no features
      const prof = t => { const r = 5.4 + 1.0 * Math.sin(Math.PI * Math.min(1, t * 1.1)); return { rx: t > .88 ? r * Math.sqrt(Math.max(0, 1 - Math.pow((t - .88) / .12, 2))) + .3 : r, rz: (t > .88 ? r * Math.sqrt(Math.max(0, 1 - Math.pow((t - .88) / .12, 2))) + .3 : r) * 1.1, cx: 0, cz: -.2 }; };
      const hat = clad(H, steelM, prof, 6.4, { k, dir: 1, pitch: 1.1, n: 26, rivets: rv, seed: seed + 22, thrSpan: .3 }); hat.position.y = 5.4; this.headParts.push(hat);
      add(H, new THREE.Mesh(boxUV(new THREE.CylinderGeometry(9.6, 9.6, .5, 40), k), steelM), [0, 5.2, 1.3]).scale.set(1, 1, 1.12);
      for (const o of [-1.4, 0, 1.4]) add(H, new THREE.Mesh(new THREE.BoxGeometry(.5, .6, 12), dark), [o, 11.5, 0]);
      add(H, new THREE.Mesh(boxUV(new THREE.BoxGeometry(9.2, 5.6, 8), k), steelM), [0, 2.4, 0]);
      add(H, new THREE.Mesh(boxUV(new THREE.BoxGeometry(9.8, 1.6, 8.6), k), dark), [0, 4.8, 0]);
      add(H, new THREE.Mesh(boxUV(new THREE.BoxGeometry(6.4, 1.8, 1.0), k), dark), [0, .2, 4.3]);
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.1, 1.2, 14), dark); lamp.rotation.x = Math.PI / 2; add(H, lamp, [0, 9.2, 6.2]); add(H, new THREE.Mesh(new THREE.CircleGeometry(.85, 14), new THREE.MeshStandardMaterial({ color: '#d8d0b8', emissive: new THREE.Color('#ffe2b0'), emissiveIntensity: .3 })), [0, 9.2, 6.82]);
    } else if (kind === 'H3') {   // a sculpted steel worker's face: a displaced head with a brow, nose, cheekbones, lips, a strong jaw, ears, cropped hair in plate
      this.headParts.push(sculptFace(H, steelM, dark, k));
    } else {                      // H4 crew bridge: a ship's bridge/crane cab, glazed all round, wings with rails, a mast; workers behind the glass
      add(H, new THREE.Mesh(boxUV(new THREE.BoxGeometry(12, 1.6, 9.6), k), steelM), [0, .8, 0]);
      add(H, new THREE.Mesh(boxUV(new THREE.BoxGeometry(11, 5.6, 8.6), k), dark), [0, 4.4, 0]);
      for (let q = 0; q < 6; q++) add(H, new THREE.Mesh(new THREE.BoxGeometry(1.5, 3.2, .3), glass), [-4.2 + q * 1.68, 4.9, 4.4]);
      for (const sx of [-1, 1]) for (let q = 0; q < 3; q++) add(H, new THREE.Mesh(new THREE.BoxGeometry(.3, 3.2, 1.9), glass), [sx * 5.6, 4.9, -2.4 + q * 2.4]);
      add(H, new THREE.Mesh(boxUV(new THREE.BoxGeometry(13, .8, 11), k), steelM), [0, 7.6, .3]);
      for (const sx of [-1, 1]) { const w = new THREE.Mesh(boxUV(new THREE.BoxGeometry(5, .4, 3), k), dark); add(H, w, [sx * 9, 1.8, 2]); }
      add(H, new THREE.Mesh(new THREE.CylinderGeometry(.25, .35, 8, 8), dark), [-3.5, 12, -1]);
      const dish = new THREE.Mesh(new THREE.TorusGeometry(2.2, .18, 6, 24, Math.PI * 1.6), dark); dish.rotation.set(0, .3, 0); add(H, dish, [-3.5, 16, -1]);
      add(H, new THREE.Mesh(new THREE.BoxGeometry(3.4, .5, 1.2), blk), [3, 8.4, 0]);
      // two crew figures behind the glass, standing at the front window: a dark torso and a pale head
      for (const [x, ph] of [[-2.2, 0], [1.6, 1]]) { add(H, new THREE.Mesh(new THREE.CylinderGeometry(.6, .8, 2.2, 8), blk), [x, 3.2, 2.6]); add(H, new THREE.Mesh(new THREE.SphereGeometry(.5, 8, 6), plainMat(ph ? '#a98468' : '#c4a58a')), [x, 4.7, 2.6]); }
    }
  }

  // ---- fixtures in human units: ladders, handrails, hatches (doors), stencils. Sizes in real metres, placed by local position.
  buildFixtures(S, { steelM, dark, prim, blk, k }) {
    const m = this.m, J = this.J, grp = (parent, p, r = [0, 0, 0]) => { const g = new THREE.Group(); g.scale.setScalar(m); g.position.set(...p); g.rotation.set(...r); parent.add(g); this.fixtures.push(g); return g; };
    const lad = (parent, p, lenM, r, w = .55) => { const g = grp(parent, p, r); g.add(ladder([0, 0, 0], [0, lenM, 0], { w })); return g; };
    const door = (parent, p, r, w = .95, h = 2.0, text = 'A-1') => {
      const g = grp(parent, p, r), fr = new THREE.Mesh(new THREE.BoxGeometry(w + .24, h + .24, .1), blk), dr = new THREE.Mesh(new THREE.BoxGeometry(w, h, .14), prim);
      dr.position.z = .05; fr.position.z = 0; g.add(fr, dr);
      const hd = new THREE.Mesh(new THREE.BoxGeometry(.22, .05, .06), new THREE.MeshStandardMaterial({ color: '#9a9a9a', metalness: .8, roughness: .4 })); hd.position.set(w * .3, 0, .15); g.add(hd);
      for (let q = 0; q < 3; q++) { const hg = new THREE.Mesh(new THREE.BoxGeometry(.12, .24, .06), blk); hg.position.set(-w / 2 - .05, h * (q - 1) * .38, .1); g.add(hg); }
      const dec = decalPlane(stencilTexture(text, { w: 256, h: 96, col: '#d8d2c0', seed: 3 }), w * .7, h * .16, {}); dec.position.set(0, h * .3, .13); g.add(dec); return g;
    };
    const win = (parent, p, r, w = 1.2, h = .5) => { const g = grp(parent, p, r); const wd = new THREE.Mesh(new THREE.BoxGeometry(w, h, .12), this.glassMat || blk); g.add(wd); const f = new THREE.Mesh(new THREE.BoxGeometry(w + .12, h + .12, .08), blk); f.position.z = -.02; g.add(f); return g; };
    const rail = (parent, a, b, r = [0, 0, 0]) => { const g = grp(parent, [0, 0, 0], r); g.add(handrail(a, b, { h: 1.05, post: 2.0, col: PAL.steelLt })); return g; };
    // thighs: a ladder up the outer side, a hatch on the front
    for (const s of [1, -1]) {
      const hp = J[s > 0 ? 'hipL' : 'hipR'], kn = J[s > 0 ? 'knL' : 'knR'], sh = J[s > 0 ? 'shL' : 'shR'];
      lad(hp, [s * (S.th[0] + .1), -this.leg.th * .9, S.th[0] * .3], (this.leg.th * .8) * this.k, [0, s * Math.PI / 2, 0]);
      door(hp, [0, -this.leg.th * .38, S.th[0] + .45], [0, 0, 0], .95, 2.0, s > 0 ? 'L-14' : 'R-15');
      door(kn, [0, -this.leg.sn * .45, S.sh[0] * .9 + .6], [-.04, 0, 0], .9, 1.9, s > 0 ? 'L-31' : 'R-32');
      lad(kn, [s * (S.sh[0] * .9), -this.leg.sn * .92, 1], (this.leg.sn * .78) * this.k, [0, s * Math.PI / 2, 0]);
      // the pauldron rail and a small ladder on the upper arm
      rail(J.chest, [s * (S.shX - 6) * m, 13.6 * m, 0], [s * (S.shX + 5) * m, 14.4 * m, 0]);
    }
    // chest: a back hatch and a row of windows (a gallery where crew walk) at the upper chest; a ladder up the back
    win(J.chest, [-8.5, 13.2, S.chest[1] * .9 + 0.4], [0, -.7, 0], 1.6, .6); win(J.chest, [8.5, 13.2, S.chest[1] * .9 + .4], [0, .7, 0], 1.6, .6);
    door(J.chest, [0, 8, -S.chest[1] * .95 - .5], [0, Math.PI, 0], 1.1, 2.1, 'H-1');
    lad(J.chest, [3.5, 1, -S.chest[1] * .95 - .6], 17 * this.k, [0, Math.PI, 0]);
    // waist: a hatch, hazard-free (grey): stencilled number
    door(J.waist, [S.waist[0] * .7, 4, S.waist[1] + .4], [0, .6, 0], .9, 1.9, 'W-2');
    // the head carries a stencilled numeral: a unit number at the neck ring (steel plate)
  }

  // ---- rams that solve their own length between lugs on two parts (c2's Ram), now at giant scale: knee, elbow, hip
  buildRams(S, { dark, k }) {
    const m = this.m, J = this.J, V = (x, y, z) => new THREE.Vector3(x, y, z);
    const mk = (parent, aLocal, child, bLocal, thick = 1) => { const r = new Ram(parent, { barrelR: .42 * m * thick, rodR: .22 * m * thick, barrel: 4 * m, col: '#58595e', rodCol: '#b8bcc2' }); r.g.traverse(o => { o.castShadow = true; }); this.rams.push({ r, parent, a: aLocal, child, b: bLocal }); return r; };
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R', hp = J['hip' + L], kn = J['kn' + L], el = J['el' + L], ua = J['ua' + L];
      // knee: from the back of the thigh to the back of the shin, one each side of the leg's centre line
      for (const o of [-1, 1]) mk(hp, V(o * 2.6, -this.leg.th * .3, -S.th[1] - .8), kn, V(o * 2.6, -this.leg.sn * .3, -S.sh[1] * .9 - .9), 1);
      // elbow: front of upper arm to front of forearm
      mk(ua, V(0, -5, S.ua[1] + .8), el, V(0, -4.5, S.fa[0] * .85 + .8), .8);
      // hip: pelvis to the outer thigh
      mk(J.hips, V(s * 9, 1.5, -5), hp, V(s * (S.th[0] + .7), -6, -3.4), 1.1);
    }
    for (const q of this.rams) { q.r.g.userData.keep = true; }
    this.updateRams();
  }
  updateRams() {
    const A = new THREE.Vector3(), B = new THREE.Vector3(); this.g.updateMatrixWorld(true);
    for (const q of this.rams) {
      A.copy(q.a); B.copy(q.b);
      // B lives in `child`'s frame; express in `parent`'s: parent -> child chain matrix (child.matrix for direct children; the hip ram goes through hip node)
      q.child.updateMatrix(); B.applyMatrix4(q.child.matrix);
      if (q.child.parent !== q.parent) B.applyMatrix4(q.child.parent.matrix);
      q.r.bl = Math.min(q.r.bl, 1e9); q.r.solve(A, B);
    }
  }

  // S3: the plant a colossus is made of: a boiler drum across the back with a stack, a hull strake of portholes, a crane boom hanging at the elbow
  buildIndustry(S, { steelM, dark, prim, blk, k }) {
    const J = this.J, m = this.m;
    const drum = add(J.chest, new THREE.Mesh(boxUV(new THREE.CylinderGeometry(5.6, 5.6, 25, 30), k), steelM), [0, 12, -S.chest[1] - 4.4], [0, 0, Math.PI / 2]); drum.userData.keep = true;
    for (const x of [-9, -3, 3, 9]) { const b = add(J.chest, new THREE.Mesh(new THREE.CylinderGeometry(5.9, 5.9, .7, 30), dark), [x, 12, -S.chest[1] - 4.4], [0, 0, Math.PI / 2]); }
    for (const sx of [-1, 1]) { const c = add(J.chest, new THREE.Mesh(new THREE.CylinderGeometry(5.9, 5.9, 1.2, 30), dark), [sx * 12.8, 12, -S.chest[1] - 4.4], [0, 0, Math.PI / 2]); }
    for (const [x, hh] of [[8.5, 17], [-8.5, 12]]) { const st = add(J.chest, new THREE.Mesh(boxUV(new THREE.CylinderGeometry(1.5, 1.8, hh, 16), k), dark), [x, 17.5 + hh / 2, -S.chest[1] - 4.4]); const fl = add(J.chest, new THREE.Mesh(new THREE.CylinderGeometry(2.1, 1.5, 1.4, 16), dark), [x, 17.5 + hh, -S.chest[1] - 4.4]); this.stacks = this.stacks || []; this.stacks.push({ node: J.chest, p: new THREE.Vector3(x, 17.5 + hh + 1, -S.chest[1] - 4.4) }); }
    // a row of portholes on the chest strake, brass-ringed
    for (let q = -3; q <= 3; q++) { if (Math.abs(q) < 1) continue; const pr = add(J.chest, new THREE.Mesh(new THREE.CylinderGeometry(.9, .9, .5, 14), blk), [q * 3.6, 3.2, S.chest[1] * .9], [Math.PI / 2, 0, 0]); add(J.chest, new THREE.Mesh(new THREE.TorusGeometry(.95, .13, 6, 18), plainMat('#8a7448', { metal: .8, rough: .4 })), [q * 3.6, 3.2, S.chest[1] * .9 + .28]); }
    // the crane hook at each wrist: a block, a sheave and a hook on a cable, hanging from the forearm boom
    for (const s of [1, -1]) { const el = J[s > 0 ? 'elL' : 'elR']; add(el, new THREE.Mesh(boxUV(new THREE.BoxGeometry(2.2, 2.8, 2.2), k), dark), [s * 0, -14.4, -S.fa[0] * .6]); }
  }

  // ---- pose: the scene's own POSES tables (degrees->radians arrays) with the legs scaled and the body lowered onto the ground
  pose(Pz, { lock = true } = {}) {
    const J = this.J, set = (o, r) => { if (r) o.rotation.set(r[0], r[1], r[2]); };
    if (Pz.hips) {
      const y = Pz.hips.p[1]; J.hips.position.set(Pz.hips.p[0], y - (1 - this.S.legS) * 40 * Math.max(.55, y / 46), Pz.hips.p[2]); J.hips.rotation.set(...Pz.hips.r);
    }
    for (const k of ['waist', 'chest', 'neck', 'head', 'shL', 'shR', 'elL', 'elR', 'wrL', 'wrR', 'hipL', 'hipR', 'knL', 'knR', 'anL', 'anR']) set(J[k === 'shL' ? 'uaL' : k === 'shR' ? 'uaR' : k], Pz[k]);
    for (const s of ['L', 'R']) {
      const c = Pz['curl' + s] ?? .2;
      J['fingers' + s].forEach((segs, f) => segs.forEach((o, q) => { o.rotation.x = c * [1.1, 1.35, 1.0][q] * (1 + .06 * (f - 1.5)); }));
      const [t1, t2] = J['thumb' + s]; t1.rotation.set(c * .6, 0, (s === 'L' ? -1 : 1) * (.3 + c * .5)); t2.rotation.x = c * .9;
    }
    this.g.updateMatrixWorld(true);
    if (lock) { const lo = this.lowest(); J.hips.position.y -= lo / this.k; this.g.updateMatrixWorld(true); }
    this.updateRams();
  }
  // lowest world y (real m, relative to the giant group's origin) of the soles and, for kneeling, the knee caps
  lowest() {
    let lo = 1e9; const v = new THREE.Vector3(); this.g.updateMatrixWorld(true);
    for (const L of ['L', 'R']) {
      const an = this.J['an' + L], kn = this.J['kn' + L];
      for (const p of [[0, -4.9, 12], [0, -4.9, -5], [5, -4.9, 4], [-5, -4.9, 4]]) { v.set(...p).applyMatrix4(an.matrixWorld); lo = Math.min(lo, v.y - this.g.position.y); }
      v.set(0, -2.6, 3.4).applyMatrix4(kn.matrixWorld); lo = Math.min(lo, v.y - this.g.position.y);
    }
    return lo;
  }
  sole(L, p = [0, -4.9, 4]) { this.g.updateMatrixWorld(true); return new THREE.Vector3(...p).applyMatrix4(this.J['an' + L].matrixWorld); }
  wp(joint, p = [0, 0, 0]) { this.g.updateMatrixWorld(true); return new THREE.Vector3(...p).applyMatrix4(this.J[joint].matrixWorld); }
  setClad(v) { this.clad = v; const root = this.g; root.traverse(o => { if (o.userData?.courses) for (const c of o.userData.courses) c.visible = c.userData.thr <= v; }); this.g.traverse(o => { if (o.userData?.armature) o.userData.armature.visible = true; }); }
}

// stand pose (the scene's own POSES.stand; kept here so the module does not import a scene file)
const R3 = (x, y = 0, z = 0) => [x * d2r, y * d2r, z * d2r];
export const POSE_STAND = { hips: { p: [0, 46, 0], r: R3(0) }, waist: R3(0), chest: R3(-2), neck: R3(-2), head: R3(0),
  shL: R3(4, 0, -9), elL: R3(-16), wrL: R3(0), shR: R3(4, 0, 9), elR: R3(-16), wrR: R3(0),
  hipL: R3(-2, 0, -3), knL: R3(4), anL: R3(-2), hipR: R3(-2, 0, 3), knR: R3(4), anR: R3(-2), curlL: 1.0, curlR: 1.0 };

// ---- the sculpted face (H3): a displaced head, features as Gaussian bumps in the unit-sphere's (x, y) on the front, built to be read
// at 1:1 as a face in plate (a Mukhina / VDNKh head), not a mask: heavy brow, straight nose, high cheekbones, closed mouth, square jaw.
function sculptFace(H, steelM, dark, k) {
  const g = new THREE.SphereGeometry(1, 120, 90), p = g.attributes.position, G = (x, y, cx, cy, sx, sy, a) => a * Math.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2));
  const rx = 5.1, ry = 6.4, rz = 5.8, cy0 = 5.8;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i); const fr = Math.max(0, z);       // front weight
    let d = 0;
    const f = fr > 0 ? 1 : 0;
    d += f * (G(x, y, 0, .2, .55, .07, .5)                       // brow ridge
      - G(x, y, -.32, .1, .13, .08, .55) - G(x, y, .32, .1, .13, .08, .55)       // eye sockets
      + G(x, y, 0, -.04, .075, .27, .85) + G(x, y, 0, -.28, .17, .07, .5)        // nose bridge and tip
      + G(x, y, -.15, -.26, .06, .05, .2) + G(x, y, .15, -.26, .06, .05, .2)     // nostril wings
      + G(x, y, -.46, -.1, .15, .1, .38) + G(x, y, .46, -.1, .15, .1, .38)       // cheekbones
      - G(x, y, 0, -.46, .26, .02, .3) + G(x, y, 0, -.41, .2, .04, .12) + G(x, y, 0, -.52, .2, .05, .14)   // mouth line and lips
      + G(x, y, 0, -.72, .22, .1, .45)                                          // chin
      + G(x, y, -.55, -.5, .16, .14, .18) + G(x, y, .55, -.5, .16, .14, .18)     // jaw corners
      - G(x, y, -.55, -.2, .12, .12, .2) - G(x, y, .55, -.2, .12, .12, .2));     // cheek hollows
    d += G(x, y, 0, .74, .8, .22, .22);                             // hair line mass above the brow (a cropped hair in plate)
    const jaw = y < -.1 ? 1 + .1 * Math.min(1, (-.1 - y) * 1.6) * (z > 0 ? 1 : .5) : 1;           // squarer jaw
    const sx = rx * jaw * (1 + (y < -.35 ? -.12 * (-.35 - y) : 0)), sy = ry, sz = rz;
    const s = 1 + d * .075;
    p.setXYZ(i, x * sx * s, cy0 + y * sy * (1 + (y < -.7 ? .0 : 0)) * (s > 1 && z > .6 ? 1 : 1), z * sz * s);
  }
  g.computeVertexNormals();
  // plate UVs: front projection, so seams run horizontally across the face like hammered sheet
  const uv = new Float32Array(p.count * 2), us = k / 6; for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) * us + (p.getZ(i) < 0 ? .5 : 0); uv[i * 2 + 1] = p.getY(i) * us; } g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const face = new THREE.Mesh(g, steelM); face.castShadow = face.receiveShadow = true; H.add(face);
  for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), steelM); e.scale.set(.5, 1.5, 1.1); e.position.set(sx * 5.2, 5.4, -.3); e.castShadow = true; H.add(e); }
  // a thick neck-to-head collar so the head sits on the neck ring; eye balls are not made: the sockets are shadow
  return face;
}

// ---- the pose tables of scenes/mecha.world.js (degrees as radians arrays), copied so this module imports no scene file; plus the raised sledge
export const POSES = {
  kneel: { hips: { p: [0, 24.5, 0], r: R3(6, 0, 0) }, waist: R3(8), chest: R3(6), neck: R3(-4), head: R3(-8), shL: R3(-58, 0, -8), elL: R3(-62), wrL: R3(10), shR: R3(-12, 0, 12), elR: R3(-30), wrR: R3(8), hipL: R3(-98, 0, -4), knL: R3(96), anL: R3(4), hipR: R3(-8, 0, 3), knR: R3(98), anR: R3(-45), curlL: .5, curlR: .9 },
  stand: POSE_STAND,
  rise1: { hips: { p: [0, 33, 0], r: R3(14) }, waist: R3(14), chest: R3(8), neck: R3(0), head: R3(4), shL: R3(-40, 0, -14), elL: R3(-40), wrL: R3(0), shR: R3(-20, 0, 18), elR: R3(-30), wrR: R3(0), hipL: R3(-86, 0, -4), knL: R3(70), anL: R3(14), hipR: R3(-32, 0, 3), knR: R3(88), anR: R3(-20), curlL: .9, curlR: 1 },
  rise2: { hips: { p: [0, 41, 0], r: R3(8) }, waist: R3(6), chest: R3(2), neck: R3(-2), head: R3(-2), shL: R3(-14, 0, -14), elL: R3(-24), wrL: R3(0), shR: R3(-8, 0, 16), elR: R3(-24), wrR: R3(0), hipL: R3(-44, 0, -4), knL: R3(40), anL: R3(4), hipR: R3(-22, 0, 3), knR: R3(34), anR: R3(-8), curlL: 1, curlR: 1 },
};
POSES.shoulder = { ...POSE_STAND, hips: { p: [0, 46, 0], r: R3(0) }, waist: R3(0, 6, 0), chest: R3(-3, 4, 0), neck: R3(-4), head: R3(-6, -4, 0), shR: R3(-38, 0, 24), elR: R3(-104), wrR: R3(-10, 0, 10), curlR: 1.25, shL: R3(4, 0, -12), elL: R3(-22), wrL: R3(0), curlL: 1.25, hipL: R3(-4, 0, -6), knL: R3(6), anL: R3(-2), hipR: R3(2, 0, 7), knR: R3(4), anR: R3(-4) };
POSES.swing = { ...POSES.shoulder, shR: R3(-150, 0, 40), elR: R3(-70), chest: R3(-8, -8, 0), waist: R3(-4, -6, 0) };
// the hammer raised: the right forearm up, the haft vertical in the fist, the left hand at the haft's foot; weight on the right leg
POSES.raise = { ...POSE_STAND, hips: { p: [0, 46, 0], r: R3(0, -6, 0) }, waist: R3(-2, 8, 0), chest: R3(-4, 8, 0), neck: R3(-2), head: R3(-8, -10, 0), shR: R3(-96, 0, 20), elR: R3(-84), wrR: R3(0, 0, 0), curlR: 1.3, shL: R3(-50, 0, -10), elL: R3(-60), curlL: 1.3,
  hipL: R3(-4, 0, -5), knL: R3(8), anL: R3(-4), hipR: R3(4, 0, 6), knR: R3(6), anR: R3(-6) };
// a gait pose from a phase (0..1 = one full left+right stride cycle): hips swing, the swing knee folds, arms counter-swing
export function walkPose(ph, { amp = 26, lift = 46, sway = 3 } = {}) {
  const sw = a => Math.sin(a * Math.PI * 2), L = ph, Rr = (ph + .5) % 1, ang = f => -amp * Math.sin(f * Math.PI * 2 + .0), kn = f => 6 + lift * Math.max(0, Math.sin((f - .02) * Math.PI * 2 * 1)) ** 1.3 * (f < .5 ? 1 : 0);
  const leg = f => ({ h: -amp * (f < .5 ? Math.cos(f * Math.PI * 2 * 1) * -1 + 0 : 0) });
  // simple: f in [0,.5) swing (hip goes from back (+amp*.7) through to front (-amp)), f in [.5,1) stance (front to back)
  const hip = f => f < .5 ? lerp(amp * .75, -amp, ease(f / .5)) : lerp(-amp, amp * .75, (f - .5) / .5);
  const knee = f => f < .5 ? 8 + lift * Math.sin(f / .5 * Math.PI) ** 1.2 : 6 + 8 * Math.sin((f - .5) / .5 * Math.PI) * .0 + (f > .5 && f < .62 ? 10 * Math.sin((f - .5) / .12 * Math.PI) : 0);
  const ank = f => f < .5 ? -14 * Math.sin(f / .5 * Math.PI) : (f < .6 ? 6 : 0) - (f > .9 ? 10 * (f - .9) / .1 : 0);
  const a = hip(L), b = hip(Rr), kL = knee(L), kR = knee(Rr);
  return { hips: { p: [0, 46 + Math.abs(Math.sin(ph * Math.PI * 2)) * -.6, 0], r: R3(1.5, sw(ph) * 3, sw(ph) * -1.2) }, waist: R3(0, -sw(ph) * 5, 0), chest: R3(-1, sw(ph) * 5, 0), neck: R3(-2), head: R3(0),
    shL: R3(-b * .6 + 4, 0, -9), elL: R3(-16 - Math.max(0, -b) * .4), wrL: R3(0), shR: R3(-a * .6 + 4, 0, 9), elR: R3(-16 - Math.max(0, -a) * .4), wrR: R3(0),
    hipL: R3(a, 0, -3 + sway * sw(ph)), knL: R3(kL), anL: R3(ank(L)), hipR: R3(b, 0, 3 + sway * sw(ph)), knR: R3(kR), anR: R3(ank(Rr)), curlL: 1, curlR: 1 };
}
const ease = u => u * u * (3 - 2 * u);

// a sledge: a long steel-pipe haft and a plated head with a stencil; origin at the grip, +Y along the haft (head end up)
Giant.prototype.sledge = function (hand = 'R', { len = 34, grip = [0, 0, Math.PI / 2], butt = 6 } = {}) {
  const m = this.m, k = this.k, g = new THREE.Group(), steel = this.M.steel, dark = this.M.dark;
  const haft = new THREE.Mesh(boxUV(new THREE.CylinderGeometry(.34 * m, .38 * m, len * m, 14), k), dark); haft.position.y = (len - butt) * m / 2; g.add(haft);
  const head = new THREE.Mesh(boxUV(new THREE.BoxGeometry(3.6 * m, 3 * m, 8.6 * m), k), steel); head.position.y = (len - butt) * m + 1.5 * m; head.castShadow = true; g.add(head);
  for (const s of [-1, 1]) { const f = new THREE.Mesh(new THREE.BoxGeometry(3.0 * m, 3.3 * m, .5 * m), dark); f.position.set(0, (len - butt) * m + 1.5 * m, s * 4.5 * m); g.add(f); }
  const bt = new THREE.Mesh(new THREE.CylinderGeometry(.5 * m, .5 * m, .6 * m, 12), dark); bt.position.y = -butt * m; g.add(bt);
  g.rotation.set(...grip); g.position.set(0, -3.6 * this.S.hand, 1.2 * this.S.hand);
  g.traverse(o => { o.castShadow = true; }); this.J['hand' + hand].add(g); this.sledgeObj = g; return g;
};
