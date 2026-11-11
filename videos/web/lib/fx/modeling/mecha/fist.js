// MECHA KIT fist (MODELING c2): a worker's fist gripping a lever, MODELLED (not an SDF blob, not a luminance trick), after the Master Hands
// shot "CU fist gripping a lever and throwing it" (Part I 03:56; videos/sources/footage/MasterHa1936.mp4). Side-on, the forearm
// enters from the left, the knuckle mass sits left of the loop of the four curled fingers, the thumb lies across the index finger.
// Seen from the front of the fist, the four MIDDLE PHALANGES are four horizontal bars, one above the other: the four stripes
// of the ACP mark (that is the v10 idea that worked). Hand units: 1 = 10 cm; +X to the right (towards the knuckles), +Y up,
// +Z towards the camera. The camera is orthographic at S px per unit, so the model lands pixel-exact on the CLOSER c1 vector mark:
// finger k's bar ends where stripe k begins (x = 576 px, rows 868/972/1075/1178 px at S = 491, mark 520 px at 540,960).
//
// Faces (after Klutsis, 1930): every part of the hand is tiled with PORTRAITS of Master Hands workers, laid on the part's own UV
// (round the finger, along the forearm) so the tiles follow the form, the tiles shrink with the part, and no tile faces
// the camera at the same size as its neighbour. The faces come from assets/hand_faces (scripts/hand_faces_extract.py).
import * as THREE from 'three';
import { aimQ, mesh, paint, nextPid, PAL, cylY, box } from './parts.js';
THREE.ColorManagement.enabled = false;

export const S_PX = 491, CX = 540, CY = 1023;     // px per hand unit; where (0,0) lands
export const FINGERS = [   // index, middle, ring, little: lengths of the three phalanges, MCP height
  { y: .315, len: [.45, .28, .22], r: .095 }, { y: .105, len: [.5, .31, .23], r: .1 }, { y: -.105, len: [.46, .29, .22], r: .096 }, { y: -.315, len: [.37, .23, .2], r: .088 },
];
const rad = d => d * Math.PI / 180;

// face duotone: the faces are the file wall's red duotone (grey, lifted, ember tint)
function duotone(img, w, h, crop) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  const [sx, sy, sw, sh] = crop; g.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h), D = d.data; let lo = 255, hi = 0; for (let i = 0; i < D.length; i += 4) { const l = D[i] * .3 + D[i + 1] * .59 + D[i + 2] * .11; lo = Math.min(lo, l); hi = Math.max(hi, l); }
  const hist = new Float32Array(256); for (let i = 0; i < D.length; i += 4) hist[Math.round(D[i] * .3 + D[i + 1] * .59 + D[i + 2] * .11)]++;
  const cdf = new Float32Array(256); let acc = 0; for (let k = 0; k < 256; k++) { acc += hist[k]; cdf[k] = acc / (D.length / 4); }       // equalised: every face reads at full contrast
  for (let i = 0; i < D.length; i += 4) {
    let l = cdf[Math.round(D[i] * .3 + D[i + 1] * .59 + D[i + 2] * .11)]; l = .12 + .88 * l;
    const t = l < .5 ? l / .5 : (l - .5) / .5;
    const a = l < .5 ? [34, 6, 10] : [190, 52, 38], b = l < .5 ? [190, 52, 38] : [255, 214, 170];
    D[i] = a[0] + (b[0] - a[0]) * t; D[i + 1] = a[1] + (b[1] - a[1]) * t; D[i + 2] = a[2] + (b[2] - a[2]) * t;
  }
  g.putImageData(d, 0, 0); return c;
}
export async function loadFaces(base = '../../assets/hand_faces/') {
  const idx = await (await fetch(base + 'index.json')).json();
  const imgs = await Promise.all(idx.map(f => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = base + f.file; })));
  return imgs.filter(Boolean);
}
// a deck of tiles shuffled so a face repeats only when the deck is used up (no repeat within one part, very few across the hand)
class Deck {
  constructor(faces, seed = 1) { this.f = faces; this.i = 0; this.s = seed * 7919; this.order = this._shuffle(); this.cache = new Map(); }
  _r() { return (this.s = (this.s * 9301 + 49297) % 233280) / 233280; }
  _shuffle() { const a = this.f.map((_, i) => i); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this._r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  next() { if (this.i >= this.order.length) { this.order = this._shuffle(); this.i = 0; } return this.order[this.i++]; }
  tile(k, w, h, jitter = 0) { const key = k + '_' + w + 'x' + h; if (!this.cache.has(key)) { const img = this.f[k], iw = img.width, ih = img.height, a = w / h, sh = Math.min(ih, iw / a), sw = sh * a; this.cache.set(key, duotone(img, w, h, [(iw - sw) / 2, Math.max(0, (ih - sh) * .35), sw, sh])); } return this.cache.get(key); }
}
// a UV-wrapped tile texture for a part with `circ` x `len` metres: tiles are `tile` units on a side (aspect .82)
function faceTexture(deck, circ, len, { tile = .2, px = 52, gap = 2, rot = -Math.PI / 2 } = {}) {
  const cols = Math.max(2, Math.round(circ / tile)), rows = Math.max(1, Math.round(len / (tile * .82))), cw = px, ch = Math.round(px * .82);   // x = round the part, y = along it
  const c = document.createElement('canvas'); c.width = cols * cw; c.height = rows * ch; const g = c.getContext('2d'); g.fillStyle = '#0b0204'; g.fillRect(0, 0, c.width, c.height);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const k = deck.next(), t = deck.tile(k, ch - gap, cw - gap);        // the tile image is w x h = ch x cw, then turned a quarter so the face's up runs round the part
    g.save(); g.translate(i * cw + cw / 2, j * ch + ch / 2); g.rotate(rot); g.drawImage(t, -(ch - gap) / 2, -(cw - gap) / 2); g.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4; t.wrapS = THREE.RepeatWrapping; return t;
}
const Z = new THREE.Vector3(0, 0, 1);
// a finger or thumb as ONE tube through its joints (continuous tiles round the bends: no seam at the knuckles), faces on the tube's own UV,
// along the finger one tile every `tile` units and round it as many as fit. Ends are rounded off with small caps.
function limb(deck, pts, r, parent, { tile = .19, px = 64, flipY = false, flipX = false } = {}) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', .5), len = curve.getLength();
  const g = new THREE.TubeGeometry(curve, 48, r, 20, false);
  const cols = Math.max(2, Math.round(len / (tile * .82))), rows = Math.max(3, Math.round(Math.PI * 2 * r / tile)), tw = Math.round(px * .82), th = px;
  const c = document.createElement('canvas'); c.width = cols * tw; c.height = rows * th; const gg = c.getContext('2d'); gg.fillStyle = '#0b0204'; gg.fillRect(0, 0, c.width, c.height);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const k = deck.next(); gg.drawImage(deck.tile(k, tw - 2, th - 2), i * tw + 1, j * th + 1); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.anisotropy = 4;
  if (flipY) { t.wrapT = THREE.RepeatWrapping; t.repeat.y = -1; } if (flipX) { t.wrapS = THREE.RepeatWrapping; t.repeat.x = -1; }
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xffffff, map: t })); m.userData.pid = nextPid(); m.userData.cls = 'subject'; m.castShadow = true;
  const grp = new THREE.Group(); grp.add(m);
  for (const P of [pts[0], pts[pts.length - 1]]) { const b = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), new THREE.MeshLambertMaterial({ color: 0xffffff, map: faceTexture(deck, Math.PI * 2 * r, r * 2, { tile, px }) })); b.userData.pid = m.userData.pid; b.userData.cls = 'subject'; b.castShadow = true; b.position.copy(P); grp.add(b); }
  parent.add(grp); grp.userData.parts = grp.children.slice(); return grp;
}
// a limb segment between two points: a capsule with its own face tiles
function segment(deck, A, B, r0, r1, parent, o = {}) {
  const L = A.distanceTo(B); const g = new THREE.CylinderGeometry(r1, r0, L, 22, 1, false); g.rotateX(Math.PI / 2);        // along +Z, length L, centred
  const tex = faceTexture(deck, Math.PI * 2 * r0, L, { tile: o.tile || .2, px: o.px || 52 });
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex })); m.userData.pid = nextPid(); m.userData.cls = 'subject'; m.castShadow = true; m.receiveShadow = true;
  m.position.copy(A).lerp(B, .5); aimQ(m, A, B);
  // end caps: balls (the joint), same tiles (so the finger is one closed form)
  const mk = P => { const b = new THREE.Mesh(new THREE.SphereGeometry(r0, 18, 12), new THREE.MeshLambertMaterial({ color: 0xffffff, map: faceTexture(deck, Math.PI * 2 * r0, r0 * 2, { tile: o.tile || .2, px: o.px || 52 }) })); b.userData.pid = m.userData.pid; b.userData.cls = 'subject'; b.castShadow = true; b.position.copy(P); return b; };
  const grp = new THREE.Group(); grp.add(m); const b0 = mk(A), b1 = mk(B); grp.add(b0, b1); parent.add(grp); grp.userData.parts = [m, b0, b1]; return grp;
}

export class Fist {
  constructor(parent, faces, { seed = 3 } = {}) {
    this.root = new THREE.Group(); parent.add(this.root); const R = this.root, deck = this.deck = new Deck(faces, seed);
    // knuckle mass: the back of the hand (a rounded block) and the base of the thumb
    // the back of the hand: an ellipsoid along X (poles at wrist and knuckles) so the tiles run round it like round a finger
    const eg = new THREE.SphereGeometry(1, 36, 24); eg.rotateZ(Math.PI / 2); eg.scale(1.05, .5, .34);
    const bm = new THREE.Mesh(eg, new THREE.MeshLambertMaterial({ color: 0xffffff, map: faceTexture(deck, 2.4, 2.1, { tile: .2, px: 88 }) }));
    bm.position.set(-.8, 0, -.02); bm.userData.pid = nextPid(); bm.userData.cls = 'subject'; bm.castShadow = true; R.add(bm); this.back = bm;
    // the heel and thenar swell: a second, smaller mass under the thumb
    const th = new THREE.Mesh(new THREE.SphereGeometry(.3, 22, 16), new THREE.MeshLambertMaterial({ color: 0xffffff, map: faceTexture(deck, 1.9, .6, { tile: .2, px: 56 }) }));
    th.position.set(-.82, .34, .2); th.scale.set(1.2, .9, .9); th.userData.pid = bm.userData.pid; th.userData.cls = 'subject'; th.castShadow = true; R.add(th); this.thenar = th;
    // forearm: tapering, long (leaves the frame); sleeve cuff
    const fa = segment(deck, new THREE.Vector3(-1.6, -.04, -.04), new THREE.Vector3(-6, .1, -.1), .4, .5, R, { tile: .34, px: 64 }); this.forearm = fa;
    // the lever: a steel shaft with a rubber grip, a boss ring below the fist (what is gripped), no faces
    const lv = new THREE.Group(); lv.position.set(-.08, 0, .22); R.add(lv); this.lever = lv;
    cylY(.1, 3.4, '#2a2428', { parent: lv, pid: nextPid(), cls: 'mid' }, 18).position.y = 0;
    const boss = cylY(.2, .26, '#4a4046', { parent: lv, pid: nextPid(), cls: 'mid' }, 22); boss.position.y = -1.0;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(.17, 16, 12), new THREE.MeshLambertMaterial({ color: '#2a2428' })); knob.userData.pid = nextPid(); knob.userData.cls = 'mid'; knob.position.y = 1.7; lv.add(knob);
    // fingers: MCP -> three phalanges curling toward the camera and back over the lever
    this.fingers = FINGERS.map((F, k) => {
      const grp = new THREE.Group(); R.add(grp); const a1 = rad(80), a2 = rad(180), a3 = rad(250); const P = [new THREE.Vector3(0, F.y, 0)];
      let ang = [a1, a2, a3]; for (let i = 0; i < 3; i++) { const p = P[i]; P.push(new THREE.Vector3(p.x + Math.cos(ang[i]) * F.len[i], F.y, p.z + Math.sin(ang[i]) * F.len[i])); }
      const L = limb(deck, P, F.r, grp, { tile: .19, px: 64 }); const segs = [L];
      grp.userData = { k, P, segs, y: F.y }; return grp;
    });
    // thumb: from the thenar, across the front of the index finger, tip at the knuckle of the middle finger
    const T = [new THREE.Vector3(-.84, .36, .24), new THREE.Vector3(-.46, .45, .64), new THREE.Vector3(-.04, .4, .68)];
    this.thumb = new THREE.Group(); R.add(this.thumb); limb(deck, T, .13, this.thumb, { tile: .2, px: 64 });
    this.fingerMats = this.fingers.map(f => f.userData.segs.flatMap(s => s.userData.parts));
  }
  // state: s.slim[k] 0..1 (finger k becomes its stripe: radius shrinks toward .55, albedo to red), s.tension 0..1 (the fist squeezes), s.fade (parts other than the fingers: 0 visible .. 1 gone)
  pose({ slim = [0, 0, 0, 0], squeeze = 0, pulse = [0, 0, 0, 0], redK = [0, 0, 0, 0] } = {}) {
    this.fingers.forEach((f, k) => {
      const sc = (1 - slim[k] * .45) * (1 + pulse[k] * .18);
      f.scale.set(1, sc, 1); f.position.y = f.userData.y * (1 - sc);       // slim about its own axis (y is the finger's stack height)
      for (const m of this.fingerMats[k]) { m.material.color.setRGB(1, 1 - redK[k] * .78, 1 - redK[k] * .86); m.material.emissive = m.material.emissive || new THREE.Color(); m.material.emissive.setRGB(redK[k] * .6 + pulse[k] * .3, redK[k] * .04, redK[k] * .04); }
    });
    this.root.scale.setScalar(1 - squeeze * .012);
  }
}
