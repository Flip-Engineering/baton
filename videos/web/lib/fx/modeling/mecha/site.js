// SITE (MODELING c3): the place a giant is built in. Overcast steel-grey day, smoke, mud-and-slab ground, a scaffold tower with
// decks, a tower crane, dust that rolls at the giant's own pace, and a crowd that is not one mannequin. Everything in real metres.
//
// Why: v1's giant was staged on a night grid of bulbs (THE GIANT's picture) with flat floors and identical crowds. The pieces the
// client praises (REBUILD THE COUNTRY, the steelworks-in-snow painting, the Liberty workshop photographs) are grey, dense, dirty
// and full of people on structure. The light is overcast: a soft key, a big sky, aerial haze that grows with distance.
import * as THREE from 'three';
import { bars, rng, plainMat } from './giant_mat.js';
THREE.ColorManagement.enabled = false;

const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const rtex = (c, rep = false) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
export const SKY = { top: [150, 158, 168], mid: [196, 198, 198], hor: [214, 210, 202], fog: '#cfccc4' };

// ---- overcast sky dome + the environment map made from it (so steel reflects a grey sky, not a studio)
export function makeSky(renderer, scene, { top = SKY.top, mid = SKY.mid, hor = SKY.hor, ground = [96, 92, 88], warmLow = 0, seed = 3 } = {}) {
  const c = cv(1024, 512), g = c.getContext('2d'), R = rng(seed);
  const gr = g.createLinearGradient(0, 0, 0, 512); const f = a => `rgb(${a[0]},${a[1]},${a[2]})`;
  gr.addColorStop(0, f(top)); gr.addColorStop(.38, f(mid)); gr.addColorStop(.5, f(hor)); gr.addColorStop(.52, f(ground)); gr.addColorStop(1, f(ground.map(v => v * .8)));
  g.fillStyle = gr; g.fillRect(0, 0, 1024, 512);
  // cloud mottling: big soft darker and lighter bands in the upper half (overcast has structure; a flat grey reads as a render)
  for (let i = 0; i < 90; i++) { const x = R() * 1024, y = R() * 230, w = 90 + R() * 260, h = 14 + R() * 38, a = .04 + R() * .08; g.fillStyle = R() < .5 ? `rgba(255,255,255,${a})` : `rgba(80,86,96,${a})`; g.beginPath(); g.ellipse(x, y, w, h, 0, 0, 7); g.fill(); }
  const t = rtex(c); t.mapping = THREE.EquirectangularReflectionMapping; t.wrapS = THREE.RepeatWrapping;
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, fog: false, depthWrite: false })); sky.rotation.y = 0; sky.renderOrder = -10; sky.name = 'sky'; scene.add(sky);
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromEquirectangular(t).texture; pm.dispose();
  scene.fog = new THREE.Fog(SKY.fog, 120, 900);
  return sky;
}

// ---- ground: slab, gravel, mud, tracks, puddles that hold the sky
export function makeGround(scene, { size = 1400, seed = 5 } = {}) {
  const c = cv(1024, 1024), g = c.getContext('2d'), R = rng(seed);
  g.fillStyle = '#74706a'; g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 9000; i++) { const v = 90 + R() * 70; g.fillStyle = `rgba(${v},${v - 4},${v - 10},${.06 + R() * .1})`; g.fillRect(R() * 1024, R() * 1024, 1 + R() * 5, 1 + R() * 4); }
  for (let i = 0; i < 26; i++) { const x = R() * 1024, y = R() * 1024, r = 30 + R() * 110; const gr = g.createRadialGradient(x, y, 0, x, y, r); const mud = R() < .6; gr.addColorStop(0, mud ? 'rgba(66,52,40,.35)' : 'rgba(30,30,34,.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  g.strokeStyle = 'rgba(40,34,28,.28)'; g.lineWidth = 7; for (let k = 0; k < 3; k++) { g.beginPath(); const y0 = R() * 1024; g.moveTo(0, y0); g.bezierCurveTo(300, y0 + R() * 60 - 30, 700, y0 + R() * 60 - 30, 1024, y0 + R() * 40 - 20); g.stroke(); g.translate(0, 16); g.beginPath(); g.moveTo(0, y0); g.bezierCurveTo(300, y0 + R() * 60 - 30, 700, y0 + R() * 60 - 30, 1024, y0 + R() * 40 - 20); g.stroke(); g.setTransform(1, 0, 0, 1, 0, 0); }
  g.strokeStyle = 'rgba(20,20,20,.35)'; g.lineWidth = 2; for (let i = 0; i <= 1024; i += 256) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 1024); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(1024, i); g.stroke(); }
  const t = rtex(c, true); t.repeat.set(size / 32, size / 32);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: t, roughness: .93, metalness: 0, envMapIntensity: .5 }));
  m.rotation.x = -Math.PI / 2; m.receiveShadow = true; m.name = 'ground'; scene.add(m); return m;
}

// ---- the crowd: instanced people (legs, torso, arms, head, hat) with varied height, width, clothes, hats, skin; arms up for some
const SKINS = ['#d9b08c', '#c68e66', '#a0694a', '#7a4d36', '#e4c3a2', '#b97d58', '#5d3c2a', '#d2a27c'];
const CLOTH = ['#6a6a5a', '#4d5560', '#7a7058', '#3e4a52', '#8a8268', '#555048', '#5a6a70', '#6e5e4a', '#2f3640', '#847a6a', '#a09a88'];
const HATS = ['#d8d4c8', '#d8b02a', '#cf6a1c', '#e8e4dc', '#2f4a8a', '#aeb2b4', '#26272a', '#c8c2b0'];
export class Crowd {
  constructor(parent, n, { seed = 1, caps = .25 } = {}) {
    this.n = n; this.P = []; const R = this.R = rng(seed);
    for (let i = 0; i < n; i++) this.P.push({ x: 0, y: 0, z: 0, yaw: R() * 6.28, s: 1, arm: 0, w: 1, c: CLOTH[(R() * CLOTH.length) | 0], skin: SKINS[(R() * SKINS.length) | 0], hat: R() < caps ? '#26272a' : HATS[(R() * HATS.length) | 0], bob: R() * 6.28, lean: 0 });
    const M = c => new THREE.MeshStandardMaterial({ color: c, roughness: .85, metalness: 0, envMapIntensity: .5 });
    const mk = (geo, white = true) => { const im = new THREE.InstancedMesh(geo, M('#ffffff'), n); im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3); im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true; parent.add(im); return im; };
    const leg = new THREE.CylinderGeometry(.1, .085, .85, 7); leg.translate(0, .425, 0);
    const torso = new THREE.CylinderGeometry(.22, .19, .62, 8); torso.translate(0, 1.15, 0);
    const arm = new THREE.CylinderGeometry(.06, .05, .62, 6); arm.translate(0, -.31, 0);
    const head = new THREE.SphereGeometry(.115, 10, 8); head.translate(0, 1.6, 0);
    const hat = new THREE.SphereGeometry(.135, 10, 6, 0, Math.PI * 2, 0, Math.PI * .55); hat.translate(0, 1.66, 0);
    this.legs = mk(leg); this.torso = mk(torso); this.armL = mk(arm); this.armR = mk(arm); this.head = mk(head); this.hat = mk(hat);
    const col = new THREE.Color();
    this.P.forEach((p, i) => { col.set('#3a3c40').lerp(new THREE.Color(p.c), .5); this.legs.setColorAt(i, col); col.set(p.c); this.torso.setColorAt(i, col); this.armL.setColorAt(i, col); this.armR.setColorAt(i, col); col.set(p.skin); this.head.setColorAt(i, col); col.set(p.hat); this.hat.setColorAt(i, col); });
    for (const im of [this.legs, this.torso, this.armL, this.armR, this.head, this.hat]) im.instanceColor.needsUpdate = true;
    this.set = parent;
  }
  // refresh matrices from P (call after moving people)
  commit(t = 0) {
    const M = new THREE.Matrix4(), S = new THREE.Matrix4(), Y = new THREE.Matrix4(), T = new THREE.Matrix4(), A = new THREE.Matrix4(), E = new THREE.Euler();
    this.P.forEach((p, i) => {
      const b = Math.sin(t * 2.2 + p.bob) * .015;
      T.makeTranslation(p.x, p.y + b, p.z); Y.makeRotationY(p.yaw); S.makeScale(p.s * p.w, p.s, p.s * p.w); M.multiplyMatrices(T, Y).multiply(S);
      if (p.lean) { E.set(p.lean, 0, 0); M.multiply(A.makeRotationFromEuler(E)); }
      this.legs.setMatrixAt(i, M); this.torso.setMatrixAt(i, M); this.head.setMatrixAt(i, M); this.hat.setMatrixAt(i, M);
      for (const [im, sx] of [[this.armL, 1], [this.armR, -1]]) {
        const up = p.arm * (sx > 0 ? 1 : .6); const sh = new THREE.Matrix4().makeTranslation(sx * .27, 1.4, 0), r = new THREE.Matrix4().makeRotationFromEuler(E.set(-up * 2.6 + Math.sin(t * 1.3 + p.bob) * .05, 0, sx * (.12 + up * .25)));
        im.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(M, sh).multiply(r));
      }
    });
    for (const im of [this.legs, this.torso, this.armL, this.armR, this.head, this.hat]) im.instanceMatrix.needsUpdate = true;
  }
}

// ---- scaffold tower: standards, ledgers, transoms, diagonals, planked decks with rails, ladders. Four faces, each hinged at its base.
export class Scaffold {
  constructor(parent, { halfW = 24, halfD = 19, height = 78, bay = 4, lift = 5, seed = 2, gal = '#9c9fa0' } = {}) {
    this.g = new THREE.Group(); parent.add(this.g); const R = rng(seed); this.dims = { halfW, halfD, height, lift }; this.decks = [];
    const steel = new THREE.MeshStandardMaterial({ color: gal, metalness: .7, roughness: .5, envMapIntensity: .9 });
    const plank = new THREE.MeshStandardMaterial({ color: '#8a7550', roughness: .9, metalness: 0 });
    const board = new THREE.MeshStandardMaterial({ color: '#cbc4b0', roughness: .9, metalness: 0 });
    this.faces = [];
    const faces = [
      { name: 'front', o: new THREE.Vector3(0, 0, halfD), L: halfW * 2, dir: new THREE.Vector3(1, 0, 0), nrm: new THREE.Vector3(0, 0, 1) },
      { name: 'back', o: new THREE.Vector3(0, 0, -halfD), L: halfW * 2, dir: new THREE.Vector3(1, 0, 0), nrm: new THREE.Vector3(0, 0, -1) },
      { name: 'right', o: new THREE.Vector3(halfW, 0, 0), L: halfD * 2, dir: new THREE.Vector3(0, 0, 1), nrm: new THREE.Vector3(1, 0, 0) },
      { name: 'left', o: new THREE.Vector3(-halfW, 0, 0), L: halfD * 2, dir: new THREE.Vector3(0, 0, 1), nrm: new THREE.Vector3(-1, 0, 0) },
    ];
    for (const F of faces) {
      const pivot = new THREE.Group(); pivot.position.copy(F.o); this.g.add(pivot);
      // local frame: x along the face, y up, z out from the tower (so rotating about x tips the face outward)
      const loc = new THREE.Group(); pivot.add(loc); loc.rotation.y = Math.atan2(F.nrm.x, F.nrm.z);   // z -> nrm
      const standards = [], ledgers = [], diag = [], rungs = [];
      const nB = Math.round(F.L / bay), nL = Math.floor(height / lift), r = .075, depth = 2.6;     // rail tube 48 mm in reality; slightly fat for the feed
      for (let i = 0; i <= nB; i++) { const x = -F.L / 2 + i * F.L / nB; standards.push([new THREE.Vector3(x, 0, 0), new THREE.Vector3(x, nL * lift + 1.1, 0), r]); standards.push([new THREE.Vector3(x, 0, -depth), new THREE.Vector3(x, nL * lift + 1.1, -depth), r]); }
      for (let j = 0; j <= nL; j++) { const y = j * lift; ledgers.push([new THREE.Vector3(-F.L / 2, y, 0), new THREE.Vector3(F.L / 2, y, 0), r]); ledgers.push([new THREE.Vector3(-F.L / 2, y, -depth), new THREE.Vector3(F.L / 2, y, -depth), r * .9]);
        for (let i = 0; i <= nB; i++) { const x = -F.L / 2 + i * F.L / nB; ledgers.push([new THREE.Vector3(x, y, 0), new THREE.Vector3(x, y, -depth), r * .8]); }
        if (j > 0) for (const hh of [1.0, .5]) ledgers.push([new THREE.Vector3(-F.L / 2, y + hh, 0), new THREE.Vector3(F.L / 2, y + hh, 0), r * .7]); }
      for (let j = 0; j < nL; j++) for (let i = 0; i < nB; i++) if ((i + j) % 2 === 0) { const x0 = -F.L / 2 + i * F.L / nB, x1 = x0 + F.L / nB; diag.push([new THREE.Vector3(x0, j * lift, 0), new THREE.Vector3(x1, (j + 1) * lift, 0), r * .75]); }
      bars(standards, steel, loc); bars(ledgers, steel, loc); bars(diag, steel, loc);
      // decks: planks on every second lift, a toe board, a ladder run on the end bays
      const pl = [], tb = [];
      for (let j = 1; j <= nL; j += 2) for (let x = -F.L / 2; x < F.L / 2 - .1; x += 1.6) { const gap = R() < .06; if (gap) continue; pl.push([x + .8, j * lift - .02, -depth / 2, R() * .02]); }
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1.55, .05, depth), plank, pl.length), M = new THREE.Matrix4();
      pl.forEach((p, i) => { M.makeTranslation(p[0], p[1], p[2]); im.setMatrixAt(i, M); }); im.castShadow = im.receiveShadow = true; im.frustumCulled = false; loc.add(im);
      // sheeting on the lowest five lifts (the cladding crew's boards): a few tarp panels, grey, for mass on the face
      for (let j = 0; j < nL; j += 1) for (let i = 0; i < nB; i++) if (R() < (j < 4 ? .18 : .06)) { const w = F.L / nB - .2, p = new THREE.Mesh(new THREE.PlaneGeometry(w, lift - 1.2), board); p.position.set(-F.L / 2 + (i + .5) * F.L / nB, j * lift + lift / 2, .02); p.material = board; loc.add(p); }
      const lad = []; for (const x of [-F.L / 2 + bay * .5]) for (let j = 0; j < nL; j++) { lad.push([new THREE.Vector3(x - .25, j * lift, .2), new THREE.Vector3(x - .25, (j + 1) * lift + 1, .2), .03]); lad.push([new THREE.Vector3(x + .25, j * lift, .2), new THREE.Vector3(x + .25, (j + 1) * lift + 1, .2), .03]); for (let y = .3; y < lift; y += .3) lad.push([new THREE.Vector3(x - .25, j * lift + y, .2), new THREE.Vector3(x + .25, j * lift + y, .2), .02]); }
      bars(lad, steel, loc);
      this.faces.push({ pivot, loc, F, nL, depth, nB, deckY: Array.from({ length: Math.floor(nL / 2) + 1 }, (_, q) => (1 + q * 2) * lift).filter(y => y <= nL * lift) });
    }
  }
  // 0 up .. 1 fallen away: faces tip outward about their base, staggered (the cranes are lowering them; nothing falls at free-fall)
  fall(u, order = [0, 2, 3, 1]) {
    this.faces.forEach((f, i) => { const o = order.indexOf(i), a = Math.max(0, Math.min(1, (u * 1.6 - o * .22) / .55)), e = a * a * (3 - 2 * a); f.pivot.rotation.set(0, 0, 0); f.pivot.rotateOnAxis(new THREE.Vector3(...f.F.dir.toArray()).cross(new THREE.Vector3(0, 1, 0)).multiplyScalar(-1).normalize(), e * 1.45); });
  }
  // world-space deck positions along a face for placing workers: [{p: Vector3, face, level}] (face untipped)
  deckSpots(R, n) {
    const out = []; for (let i = 0; i < n; i++) { const f = this.faces[(R() * 4) | 0], lv = f.deckY[(R() * f.deckY.length) | 0], x = (R() - .5) * f.F.L * .94; const p = new THREE.Vector3(x, lv + .02, -f.depth * (.2 + R() * .6)); out.push({ face: f, local: p }); } return out;
  }
}

// ---- a tower crane: lattice mast, slewing jib, counter-jib, cab, trolley and hook; the cable can carry a load
export class TowerCrane {
  constructor(parent, { h = 96, jib = 68, back = 22, mast = 3.2, seed = 4, col = '#b9b6ab' } = {}) {
    this.g = new THREE.Group(); parent.add(this.g); this.h = h; const steel = new THREE.MeshStandardMaterial({ color: col, metalness: .55, roughness: .55, envMapIntensity: .8 });
    const dk = new THREE.MeshStandardMaterial({ color: '#5a5b5e', metalness: .5, roughness: .6 });
    const list = [], ch = .2, hs = mast / 2, ns = Math.round(h / 4.4);
    const C = [[-hs, -hs], [hs, -hs], [hs, hs], [-hs, hs]];
    for (let i = 0; i <= ns; i++) { const y = i * h / ns; for (let j = 0; j < 4; j++) { const a = C[j], b = C[(j + 1) % 4]; list.push([new THREE.Vector3(a[0], y, a[1]), new THREE.Vector3(b[0], y, b[1]), ch * .5]); if (i < ns) { list.push([new THREE.Vector3(a[0], y, a[1]), new THREE.Vector3(a[0], y + h / ns, a[1]), ch]); list.push([new THREE.Vector3(a[0], y, a[1]), new THREE.Vector3(b[0], y + h / ns, b[1]), ch * .55]); } } }
    bars(list, steel, this.g);
    this.slew = new THREE.Group(); this.slew.position.y = h; this.g.add(this.slew);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(3, 3.2, 3.4), dk); cab.position.set(0, 2.4, 2.4); cab.castShadow = true; this.slew.add(cab);
    const win = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.4, .1), new THREE.MeshStandardMaterial({ color: '#10141a', roughness: .1, metalness: .9, emissive: new THREE.Color('#ffb870'), emissiveIntensity: .15 })); win.position.set(0, 2.8, 4.14); this.slew.add(win);
    const jl = [], jh = 2.6, nj = Math.round(jib / 4);
    for (let i = 0; i <= nj; i++) { const x = i * jib / nj; jl.push([new THREE.Vector3(x, 0, -jh / 2), new THREE.Vector3(x, 0, jh / 2), .1]); jl.push([new THREE.Vector3(x, jh * .9 * (1 - x / jib * .6), 0), new THREE.Vector3(x, 0, -jh / 2), .08]); jl.push([new THREE.Vector3(x, jh * .9 * (1 - x / jib * .6), 0), new THREE.Vector3(x, 0, jh / 2), .08]); if (i < nj) { const x1 = x + jib / nj; jl.push([new THREE.Vector3(x, 0, -jh / 2), new THREE.Vector3(x1, 0, -jh / 2), .16]); jl.push([new THREE.Vector3(x, 0, jh / 2), new THREE.Vector3(x1, 0, jh / 2), .16]); jl.push([new THREE.Vector3(x, jh * .9 * (1 - x / jib * .6), 0), new THREE.Vector3(x1, jh * .9 * (1 - x1 / jib * .6), 0), .13]); jl.push([new THREE.Vector3(x, 0, -jh / 2), new THREE.Vector3(x1, 0, jh / 2), .07]); } }
    bars(jl, steel, this.slew);
    const bl = []; for (let i = 0; i <= 5; i++) { const x = -i * back / 5; bl.push([new THREE.Vector3(x, 0, -jh / 2), new THREE.Vector3(x, 0, jh / 2), .1]); if (i < 5) { bl.push([new THREE.Vector3(x, 0, -jh / 2), new THREE.Vector3(x - back / 5, 0, -jh / 2), .16]); bl.push([new THREE.Vector3(x, 0, jh / 2), new THREE.Vector3(x - back / 5, 0, jh / 2), .16]); } }
    bars(bl, steel, this.slew);
    for (let i = 0; i < 4; i++) { const cw = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.4, 2.6), new THREE.MeshStandardMaterial({ color: '#8b8a86', roughness: .9 })); cw.position.set(-back + 2 + i * 2.3, -1.2, 0); cw.castShadow = true; this.slew.add(cw); }
    // the tower head (the A-frame) with pendants
    const ah = [[new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 11, 0), .18], [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 11, 0), .18], [new THREE.Vector3(0, 11, 0), new THREE.Vector3(jib * .7, 0, 0), .05], [new THREE.Vector3(0, 11, 0), new THREE.Vector3(-back * .8, 0, 0), .05]];
    bars(ah, steel, this.slew);
    // trolley, cable, hook block; setHook(x along jib, drop y)
    this.trolley = new THREE.Group(); this.slew.add(this.trolley); const tr = new THREE.Mesh(new THREE.BoxGeometry(2, .7, 2), dk); tr.castShadow = true; this.trolley.add(tr);
    this.cable = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, 1, 5), new THREE.MeshStandardMaterial({ color: '#1c1c1e', roughness: .6 })); this.cable.castShadow = true; this.g.add(this.cable);
    this.cable2 = this.cable.clone(); this.g.add(this.cable2);
    this.block = new THREE.Group(); this.g.add(this.block); const blk = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.2, 1.2), new THREE.MeshStandardMaterial({ color: '#d8b02a', roughness: .6, metalness: .2 })); blk.position.y = -1; blk.castShadow = true; this.block.add(blk);
    this.setHook(jib * .55, 18, 0);
  }
  // swing: slew angle (rad, about y); x: trolley position along the jib; drop: metres below the jib; returns hook world position
  setHook(x, drop, swing = 0) {
    this.slew.rotation.y = swing; this.trolley.position.set(x, -.9, 0); this.g.updateMatrixWorld(true);
    const top = new THREE.Vector3(x, 0, 0).applyMatrix4(this.slew.matrixWorld).sub(this.g.position); top.y = this.h - .9;
    const bot = top.clone(); bot.y = this.h - .9 - drop;
    for (const [c, off] of [[this.cable, -.5], [this.cable2, .5]]) { c.position.set(top.x + off * .6, (top.y + bot.y) / 2, top.z); c.scale.set(1, drop, 1); }
    this.block.position.copy(bot); this.block.position.y -= 0; this.hookPos = bot.clone().add(this.g.position); return this.hookPos;
  }
}

// ---- dust and smoke: soft sprites. Dust rolls out as a ring of sheets and rises slowly (at the giant's scale a puff takes seconds, not frames)
let _puff = null;
function puffTex() { if (_puff) return _puff; const c = cv(128, 128), g = c.getContext('2d'), R = rng(9); const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62); gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(.55, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(0,0,0,${.05 + R() * .2})`; g.beginPath(); g.arc(R() * 128, R() * 128, 3 + R() * 14, 0, 7); g.fill(); } return (_puff = rtex(c)); }
export class Dust {
  constructor(parent, { n = 260, seed = 6 } = {}) { this.R = rng(seed); this.items = []; this.g = new THREE.Group(); parent.add(this.g); this.pool = []; for (let i = 0; i < n; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex(), color: '#9a948a', transparent: true, opacity: 0, depthWrite: false, fog: true })); s.visible = false; this.g.add(s); this.pool.push(s); } this.next = 0; this.bursts = []; }
  // a burst at (x, z) at time t0: `size` is the foot's width in metres; sprites roll outward at ~size/2.5 m/s, rise at ~0.4 m/s and fade over ~8 s
  burst(t0, x, z, size = 12, n = 30, tint = '#9a948a') { this.bursts.push({ t0, x, z, size, n, tint, seed: Math.floor(this.R() * 1e9) }); }
  update(t) {
    for (const s of this.pool) { s.visible = false; } let q = 0;
    for (const b of this.bursts) {
      const age = t - b.t0; if (age < 0 || age > 12) continue; const R = rng(b.seed);
      for (let i = 0; i < b.n && q < this.pool.length; i++) {
        const a = R() * Math.PI * 2 + (R() - .5) * .2, sp = (.25 + R() * .45) * b.size / 2.4, d = b.size * .25 + sp * Math.pow(age, .8) * 1.0, rise = .35 * age + R() * 1.5, sz = b.size * (.22 + R() * .35) * (1 + age * .22);
        const o = Math.exp(-age / 4.5) * (.1 + R() * .28) * Math.min(1, age * 3);
        const s = this.pool[q++]; s.visible = true; s.position.set(b.x + Math.cos(a) * d, .5 + sz * .25 + rise, b.z + Math.sin(a) * d); s.scale.set(sz * 1.5, sz, 1); s.material.opacity = o; s.material.color.set(b.tint); s.material.rotation = R() * 6;
      }
    }
  }
}
export function smokeColumn(parent, x, z, { h = 160, w = 22, n = 30, seed = 3, col = '#b0aca4', op = .22 } = {}) {
  const R = rng(seed), g = new THREE.Group(); parent.add(g);
  for (let i = 0; i < n; i++) { const t = i / n, s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex(), color: col, transparent: true, opacity: op * (1 - t * .6), depthWrite: false, fog: true })); const sz = w * (.7 + t * 2.2) * (.8 + R() * .5); s.scale.set(sz, sz * .8, 1); s.position.set(x + t * h * .22 + (R() - .5) * w * .6, 6 + t * h, z + (R() - .5) * w * .5); s.material.rotation = R() * 6; g.add(s); }
  return g;
}
// a far industrial skyline: blast-furnace stacks, a boiler house, gantries, as flat-shaded silhouettes in the haze (the steelworks painting)
export function skyline(parent, { z = -420, span = 900, seed = 8, col = '#8f9296' } = {}) {
  const R = rng(seed), g = new THREE.Group(); parent.add(g); const m = new THREE.MeshStandardMaterial({ color: col, roughness: 1, metalness: 0, envMapIntensity: .3 });
  for (let i = 0; i < 26; i++) { const x = (R() - .5) * span, w = 12 + R() * 40, h = 20 + R() * 70, d = 16 + R() * 20;
    const kind = R(); let mesh; if (kind < .3) mesh = new THREE.Mesh(new THREE.CylinderGeometry(w * .12, w * .2, h * 1.8, 10), m), mesh.position.set(x, h * .9, z - R() * 80);
    else if (kind < .65) mesh = new THREE.Mesh(new THREE.BoxGeometry(w * 1.6, h * .6, d), m), mesh.position.set(x, h * .3, z - R() * 60);
    else { mesh = new THREE.Mesh(new THREE.CylinderGeometry(w * .35, w * .5, h, 12), m); mesh.position.set(x, h / 2, z - R() * 60); }
    g.add(mesh); }
  return g;
}
