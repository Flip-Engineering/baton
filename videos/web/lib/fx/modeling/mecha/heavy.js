// HEAVY (MODELING c3): MECHA PROLETARIAT's giant designed as heavy engineering, not as a character.
//
// The direction (review/studio_modeling_c3/before/NOTES.md, and the client's 1 Oct words): no face, no hero pose, no candy red, no
// emblem as decoration; the giant is something workers BUILD. So the body is made the way plant is made: chamfered plate boxes
// with proud panels (the panel line and the rivet row carry the scale), hydraulic rams across the joints, ladders, doors, rails
// and stencils at true human size, and a crew housing glazed like a ship's bridge set LOW between the shoulders (people behind
// glass instead of a head). Red is red-lead primer: the colour of plates not yet painted, so during the build it marks the
// construction front; finished, the giant is grey with ONE red plate bearing the mark.
//
// Three designs on one rig, in metres (a person is 1.75):
//   HULL     ship and dam: wide, low centre of mass, a prow chest, deco setbacks at the shoulders, a bridge sunk between them (~49 m)
//   SETBACK  the American skyscraper: stacked setback tiers and vertical piers, a glazed crown on a stepped neck, pier legs (~58 m)
//   FRAME    Eiffel's armature for Liberty, left visible: riveted box-lattice limbs on pinned bearings, a glazed crew cab hung
//            inside the chest cage, plates only where work needs a floor or a face (~50 m)
//
//   const G = new Heavy(scene, { design: 'HULL', mats });  G.pose(POSE.stand);  G.setBuild(0..1);  G.update();  (rams follow)
//   G.solePlant('L')  -> keeps the named foot where it was while the pose changes (for a walk)
import * as THREE from 'three';
import { plateSet, bars, rng } from './giant_mat.js';
import { stencilTexture } from './parts.js';
import { drawMark, RED } from '../../../closer.js';

const d2r = Math.PI / 180, V3 = (x, y, z) => new THREE.Vector3(x, y, z), lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- materials (colour-managed: the lab turns ColorManagement on)
const TEXCACHE = new Map();
function plateTex(seed, base, o = {}) {
  const key = JSON.stringify([seed, base, o]); if (TEXCACHE.has(key)) return TEXCACHE.get(key);
  const S = plateSet({ seed, base, px: 1024, tile: 6, plateW: 3, plateH: 1.5, tone: o.tone ?? 6, rust: o.rust ?? .25, streak: o.streak ?? .35, mill: o.mill ?? .12, hammer: 0, rivet: .15 });
  const mk = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; return t; };
  const r = { map: mk(S.albedo, true), bump: mk(S.bump, false), rough: mk(S.rough, false) }; TEXCACHE.set(key, r); return r;
}
// a painted-steel material with grime that rises from the ground and runs down from seams (world space)
export function paintMat(base, { seed = 1, metal = .12, rough = .62, grime = .7, plate = true, env = .7, bump = .5, rust, streak } = {}) {
  const T = plate ? plateTex(seed, base, { rust, streak }) : null;
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: metal, roughness: rough, envMapIntensity: env });
  if (T) { m.map = T.map; m.bumpMap = T.bump; m.bumpScale = bump; m.roughnessMap = T.rough; } else m.color.setRGB(base[0] / 255, base[1] / 255, base[2] / 255, THREE.SRGBColorSpace);
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 wp_ = vec4(transformed, 1.);
      #ifdef USE_INSTANCING
        wp_ = instanceMatrix * wp_;
      #endif
      vWP = (modelMatrix * wp_).xyz;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vWP;
      float gh_(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float gn_(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(gh_(i), gh_(i+vec2(1,0)), f.x), mix(gh_(i+vec2(0,1)), gh_(i+vec2(1,1)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float h = vWP.y;
        float low = 1. - smoothstep(0., 7., h);
        float col = gn_(vec2((vWP.x + vWP.z) * 1.3, 3.)) * .6 + gn_(vec2((vWP.x - vWP.z) * 4.1, 9.)) * .4;
        float run = smoothstep(.5, .9, col) * (.5 + .5 * gn_(vec2(vWP.y * .15, vWP.x * .3)));
        float pch_ = gn_(vWP.xz * .3 + vWP.y * .2);
        float dirt = clamp(low * (.6 + .5 * pch_) + run * .45 + pch_ * .12, 0., 1.) * ${grime.toFixed(2)};
        diffuseColor.rgb *= mix(vec3(1.), vec3(.48, .44, .40), dirt);
      }`);
  };
  m.customProgramCacheKey = () => 'heavy' + grime.toFixed(2);
  return m;
}
export function makeMats(design = 'HULL') {
  const base = { HULL: [124, 128, 130], SETBACK: [138, 135, 127], FRAME: [104, 108, 112] }[design] || [124, 128, 130];
  const M = {
    body: paintMat(base, { seed: 11 }),
    trim: paintMat(base.map(v => v - 22), { seed: 12 }),
    dark: paintMat([48, 50, 54], { seed: 13, rough: .7, metal: .25 }),
    primer: paintMat([124, 60, 44], { seed: 14, rough: .9, metal: 0, grime: .55, plate: false }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: .9, roughness: .22, envMapIntensity: 1.1 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1e1e20, roughness: .8 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1a2026, metalness: .1, roughness: .06, envMapIntensity: 1.6, transparent: true, opacity: .62 }),
    cabin: new THREE.MeshStandardMaterial({ color: 0x2a2620, emissive: new THREE.Color(1, .72, .42), emissiveIntensity: .55, roughness: .9 }),
    crew: new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: .9 }),
    rail: paintMat([196, 168, 70], { plate: false, rough: .6, grime: .5 }),
    lattice: paintMat(base.map(v => v - 12), { seed: 15, plate: false, rough: .6 }),
  };
  return M;
}

// ---------------------------------------------------------------- geometry
// a box with 45-degree chamfers on every edge (plant is flame-cut plate, not filleted plastic), centred
export function chamferBox(w, h, d, c = .35) {
  c = Math.max(.01, Math.min(c, w * .3, h * .3, d * .3)); const x = w / 2 - c, y = h / 2 - c, s = new THREE.Shape();
  s.moveTo(-x, -y); s.lineTo(x, -y); s.lineTo(x, y); s.lineTo(-x, y); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(.01, d - 2 * c), bevelEnabled: true, bevelThickness: c, bevelSize: c, bevelSegments: 1, curveSegments: 1 });
  g.translate(0, 0, -(d - 2 * c) / 2); return g;
}
// scale x/z linearly along y: at the geometry's bottom by (bx, bz), at its top by (tx, tz)
function taper(g, bx = 1, bz = 1, tx = 1, tz = 1) {
  g.computeBoundingBox(); const b = g.boundingBox, p = g.attributes.position, h = b.max.y - b.min.y || 1;
  for (let i = 0; i < p.count; i++) { const t = (p.getY(i) - b.min.y) / h; p.setX(i, p.getX(i) * lerp(bx, tx, t)); p.setZ(i, p.getZ(i) * lerp(bz, tz, t)); }
  p.needsUpdate = true; g.computeVertexNormals(); return g;
}
// world-ish box-mapped UVs in plate-tile units (6 m tile): the plate pattern stays the same size on every part
function boxUV(geo, tile = 6) {
  const g = geo.index ? geo.toNonIndexed() : geo; g.computeVertexNormals(); const p = g.attributes.position, nm = g.attributes.normal, uv = new Float32Array(p.count * 2), us = 1 / tile;
  for (let i = 0; i < p.count; i += 3) {
    const nx = Math.abs(nm.getX(i) + nm.getX(i + 1) + nm.getX(i + 2)), ny = Math.abs(nm.getY(i) + nm.getY(i + 1) + nm.getY(i + 2)), nz = Math.abs(nm.getZ(i) + nm.getZ(i + 1) + nm.getZ(i + 2));
    for (let q = 0; q < 3; q++) { const x = p.getX(i + q), y = p.getY(i + q), z = p.getZ(i + q); let u, v; if (ny >= nx && ny >= nz) { u = x; v = z; } else if (nx >= nz) { u = z; v = y; } else { u = x; v = y; } uv[(i + q) * 2] = u * us + .37; uv[(i + q) * 2 + 1] = v * us + .21; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return g;
}
const node = (parent, p = [0, 0, 0], name = '') => { const o = new THREE.Group(); o.position.set(...p); o.name = name; parent.add(o); return o; };
function put(parent, geo, mat, p = [0, 0, 0], r = [0, 0, 0], tag = null) {
  const m = new THREE.Mesh(geo, mat); m.position.set(...p); m.rotation.set(...r); m.castShadow = m.receiveShadow = true; parent.add(m); if (tag) m.userData.tag = tag; return m;
}
const cylX = (r, len, seg = 24) => { const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateZ(Math.PI / 2); return g; };

// ---------------------------------------------------------------- the giant
// joint layout (local, metres). Each design overrides dimensions; the hierarchy is the same.
export const DESIGNS = {
  HULL: { name: 'HULL', idea: 'ship and dam: heavy, low, a prow chest, a ship\'s bridge sunk between deco shoulder setbacks', ankle: 4, shin: 13, thigh: 12, pelvis: [15, 5, 10], waist: 3.4, chest: [20, 13, 12], shX: 13.6, shY: 9.6, ua: 10.5, fa: 11, hand: 6, hipX: 5.8, base: 'HULL' },
  SETBACK: { name: 'SETBACK', idea: 'the American skyscraper: setback tiers and piers, a glazed crown on a stepped neck, pier legs', ankle: 4, shin: 15, thigh: 13.5, pelvis: [13.5, 5, 9], waist: 3.6, chest: [16, 15, 10], shX: 12, shY: 11, ua: 11.5, fa: 12, hand: 5.4, hipX: 5.3, base: 'SETBACK' },
  FRAME: { name: 'FRAME', idea: 'Eiffel\'s armature for Liberty left visible: riveted lattice limbs on pinned bearings, a crew cab hung inside the chest cage', ankle: 4, shin: 13, thigh: 12, pelvis: [13.5, 5, 9], waist: 3.4, chest: [18, 14, 11], shX: 12.6, shY: 10.4, ua: 10.5, fa: 11, hand: 5.6, hipX: 5.6, base: 'FRAME' },
};

export class Heavy {
  constructor(parent, { design = 'HULL', mats = null, seed = 3, crew = true, markPlate = true, mark = true } = {}) {
    const D = this.D = DESIGNS[design]; this.design = design; this.R = rng(seed);
    const M = this.M = mats || makeMats(design); this.parts = []; this.rams = []; this.crewOn = crew;
    this.g = new THREE.Group(); this.g.name = 'heavy-' + design; parent.add(this.g);
    const J = this.J = {}, hipY = D.ankle + D.shin + D.thigh; this.hipY = hipY;
    J.root = node(this.g, [0, hipY, 0], 'root');
    J.pelvis = node(J.root, [0, 0, 0], 'pelvis');
    J.waist = node(J.root, [0, D.pelvis[1] * .5, 0], 'waist');
    J.chest = node(J.waist, [0, D.waist, 0], 'chest');
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R';
      J['sh' + L] = node(J.chest, [s * D.shX, D.shY, 0], 'sh' + L);
      J['el' + L] = node(J['sh' + L], [0, -D.ua, 0], 'el' + L);
      J['wr' + L] = node(J['el' + L], [0, -D.fa, 0], 'wr' + L);
      J['hp' + L] = node(J.root, [s * D.hipX, -1.2, 0], 'hp' + L);
      J['kn' + L] = node(J['hp' + L], [0, -D.thigh, 0], 'kn' + L);
      J['an' + L] = node(J['kn' + L], [0, -D.shin, 0], 'an' + L);
    }
    const B = { HULL: buildHull, SETBACK: buildSetback, FRAME: buildFrame }[design];
    B(this);
    if (mark && markPlate) this.addMark();
    this.pose(POSE.stand); this.g.updateMatrixWorld(true);
    // build order: the way a frame is erected. Feet, shins, thighs, pelvis, chest, shoulders, bridge; the arms are made in the shops
    // and go on last. Inside a segment, bottom-up with a scatter. Each segment has an armature (a box truss) that is up before its plates.
    this.order(seed);
    this.build = 1;
  }
  order(seed) {
    const R = rng(seed + 5), J = this.J, SPAN = { shH: [.66, .78], bridge: [.74, .84], back: [.6, .72], an: [0, .1], kn: [.07, .26], hp: [.22, .38], pelvis: [.36, .44], waist: [.42, .46], root: [.36, .44], chest: [.45, .74], sh: [.8, .88], el: [.86, .95], wr: [.92, .98] };
    const jointOf = o => { for (let p = o; p; p = p.parent) { const k = Object.keys(J).find(k => J[k] === p); if (k) return k; } return 'root'; };
    const kind = k => k.replace(/[LR]$/, '');
    // segment boxes (world, at the stand pose) from their meshes
    const seg = {}; this.g.updateMatrixWorld(true);
    this.g.traverse(o => { if (!(o.isMesh || o.isInstancedMesh)) return; const k = jointOf(o); const S = (seg[k] = seg[k] || { box: new THREE.Box3(), core: new THREE.Box3(), list: [] }); S.list.push(o); if (o.isMesh) { S.box.expandByObject(o); if (o.userData.tag === 'core' && !S.coreSet) { S.core.expandByObject(o); S.coreSet = true; } } });
    for (const [k, S] of Object.entries(seg)) {
      const [a, b] = SPAN[kind(k)] || [.4, .5], y0 = S.box.min.y, y1 = S.box.max.y, H = Math.max(1, y1 - y0), extra = kind(k) === 'chest' ? 1.0 : 1;
      S.start = a; for (const o of S.list) { const c = new THREE.Vector3(); if (o.isMesh) { o.geometry.computeBoundingBox(); o.geometry.boundingBox.getCenter(c); o.localToWorld(c); } else c.set(0, y0, 0);
        const f = Math.min(1, Math.max(0, (c.y - y0) / H)) * extra; o.userData.thr = o.userData.tag === 'core' ? a + .01 : Math.min(.985, a + (b - a) * (f * .8 + R() * .2)); o.userData.segEnd = b; o.userData.base = o.material; o.userData.paint = o.material === this.M.body || o.material === this.M.trim; }
      // the armature for the segment: a box truss inside its core, in the joint's own space
      if (['an', 'kn', 'hp', 'chest', 'pelvis', 'el', 'sh'].includes(kind(k)) && J[k]) {
        const inv = new THREE.Matrix4().copy(J[k].matrixWorld).invert(), bl = (S.coreSet ? S.core : S.box).clone().applyMatrix4(inv), sz = bl.getSize(new THREE.Vector3()), ct = bl.getCenter(new THREE.Vector3());
        const w = sz.x * .62, d = sz.z * .62, h = sz.y * .96, L = [], n = Math.max(2, Math.round(h / 3)), C = [[-1, -1], [1, -1], [1, 1], [-1, 1]], at = (sx, sz2, t) => V3(ct.x + sx * w / 2, bl.min.y + h * t + sz.y * .02, ct.z + sz2 * d / 2);
        for (let i = 0; i <= n; i++) { const t = i / n; for (let j = 0; j < 4; j++) { const A = C[j], B = C[(j + 1) % 4]; L.push([at(A[0], A[1], t), at(B[0], B[1], t), .16]); if (i < n) { L.push([at(A[0], A[1], t), at(A[0], A[1], (i + 1) / n), .26]); L.push([at(A[0], A[1], t), at(B[0], B[1], (i + 1) / n), .12]); } } }
        const im = bars(L, this.M.dark, J[k]); im.userData.thr = a; im.userData.base = im.material; im.userData.arm = true; im.userData.segEnd = b;
      }
    }
    for (const q of this.rams) { const ka = jointOf(q.a), kb = jointOf(q.b); q.thr = Math.max(...[ka, kb].map(k => (SPAN[kind(k)] || [.5, .5])[1])); }
  }
  height() { const b = new THREE.Box3().setFromObject(this.g); return b.max.y - b.min.y; }
  // a part hanging from a joint: a chamfered core plus a grid of proud panels on its faces (each panel a plate you could bolt on)
  slab(parent, { w, h, d, y = 0, x = 0, z = 0, bot = [1, 1], top = [1, 1], c = .45, panels = [2, 2], faces = 'fblr', mat = null, pmat = null, gap = .16, th = .22, frame = true, core = true, inset = .1 } = {}) {
    const M = this.M, g = node(parent, [x, y, z]);
    const geo = boxUV(taper(chamferBox(w, h, d, c), bot[0], bot[1], top[0], top[1]));
    geo.translate(0, -h / 2, 0); // hangs down from the joint: y in [-h, 0]
    if (core) put(g, geo, mat || M.body, [0, 0, 0], [0, 0, 0], 'core');
    if (frame) { // the armature inside, seen when the core is off
      const L = [], hw = w * .42, hd = d * .4, n = Math.max(2, Math.round(h / 3));
      const at = (sx, sz, t) => V3(sx * hw * lerp(top[0], bot[0], t), -h * t, sz * hd * lerp(top[1], bot[1], t));
      const C = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (let i = 0; i <= n; i++) { const t = i / n; for (let j = 0; j < 4; j++) { const a = C[j], b = C[(j + 1) % 4]; L.push([at(a[0], a[1], t), at(b[0], b[1], t), .1]); if (i < n) { L.push([at(a[0], a[1], t), at(a[0], a[1], (i + 1) / n), .16]); L.push([at(a[0], a[1], t), at(b[0], b[1], (i + 1) / n), .07]); } } }
      bars(L, M.dark, g);
    }
    // panels
    const [rows, cols] = panels, sy = h, add = (face) => {
      const isZ = face === 'f' || face === 'b', sgn = face === 'f' || face === 'r' ? 1 : -1;
      const halfTop = (isZ ? d * top[1] : w * top[0]) / 2, halfBot = (isZ ? d * bot[1] : w * bot[0]) / 2, slope = (halfTop - halfBot) / sy;
      const spanTop = isZ ? w * top[0] : d * top[1], spanBot = isZ ? w * bot[0] : d * bot[1];
      for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
        const t = (r + .5) / rows, yc = -sy * t, span = lerp(spanTop, spanBot, t) - 2 * c - inset * 2, ph = sy / rows - gap - (r === 0 || r === rows - 1 ? c * .7 : 0), pw = span / cols - gap;
        const off = -span / 2 + (q + .5) * span / cols, half = lerp(halfTop, halfBot, t), ang = Math.atan(slope);
        const pg = boxUV(chamferBox(pw, ph, th, Math.min(.12, th * .45)));
        const m = new THREE.Mesh(pg, pmat || mat || M.body); m.castShadow = m.receiveShadow = true; m.userData.tag = 'panel';
        if (isZ) { m.position.set(off, yc + (r === 0 ? -c * .35 : r === rows - 1 ? c * .35 : 0), sgn * (half + th * .35)); m.rotation.set(sgn * ang, 0, 0); if (sgn < 0) m.rotation.y = Math.PI; }
        else { m.position.set(sgn * (half + th * .35), yc + (r === 0 ? -c * .35 : r === rows - 1 ? c * .35 : 0), off); m.rotation.set(0, sgn * Math.PI / 2, 0); m.rotateX(ang); }
        g.add(m);
      }
    };
    for (const f of faces) add(f);
    this.parts.push(g); return g;
  }
  bearing(parent, r, len, p = [0, 0, 0], mat = null) { // a pinned joint: drum, flange rings and a pin boss either side
    const M = this.M, g = node(parent, p);
    put(g, cylX(r, len, 28), mat || M.dark); for (const s of [1, -1]) { put(g, cylX(r * 1.12, .5, 28), M.trim, [s * len / 2, 0, 0]); put(g, cylX(r * .42, .7, 16), M.chrome, [s * (len / 2 + .5), 0, 0]); }
    return g;
  }
  // hydraulic ram between two anchors on two links; follows them on update()
  ram(a, aLocal, b, bLocal, { r = .55, rod = .3, frac = .55 } = {}) {
    const M = this.M, g = new THREE.Group(); this.g.add(g);
    const barrel = put(g, new THREE.CylinderGeometry(r, r, 1, 18), M.trim), rodM = put(g, new THREE.CylinderGeometry(rod, rod, 1, 14), M.chrome);
    const capA = put(g, new THREE.SphereGeometry(r * 1.15, 14, 10), M.dark), capB = put(g, new THREE.SphereGeometry(rod * 1.6, 12, 8), M.dark);
    const hose = put(g, new THREE.CylinderGeometry(r * .22, r * .22, 1, 8), M.rubber);
    this.rams.push({ a, aLocal: V3(...aLocal), b, bLocal: V3(...bLocal), barrel, rodM, capA, capB, hose, frac, r }); return g;
  }
  update() {
    this.g.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(this.g.matrixWorld).invert(), Y = V3(0, 1, 0);
    for (const q of this.rams) {
      const A = q.aLocal.clone().applyMatrix4(q.a.matrixWorld).applyMatrix4(inv), B = q.bLocal.clone().applyMatrix4(q.b.matrixWorld).applyMatrix4(inv), d = B.clone().sub(A), L = d.length(), dir = d.clone().normalize(), Q = new THREE.Quaternion().setFromUnitVectors(Y, dir);
      const bl = Math.min(L * .78, Math.max(L * q.frac, 2)), rl = L - bl * .85;
      q.barrel.scale.set(1, bl, 1); q.barrel.position.copy(A).addScaledVector(dir, bl / 2); q.barrel.quaternion.copy(Q);
      q.rodM.scale.set(1, rl, 1); q.rodM.position.copy(B).addScaledVector(dir, -rl / 2); q.rodM.quaternion.copy(Q);
      q.capA.position.copy(A); q.capB.position.copy(B);
      const side = new THREE.Vector3().crossVectors(dir, V3(0, 0, 1)).normalize().multiplyScalar(q.r * 1.25);
      q.hose.scale.set(1, bl * .8, 1); q.hose.position.copy(A).addScaledVector(dir, bl * .45).add(side); q.hose.quaternion.copy(Q);
    }
  }
  // human-scale fittings on a link: a ladder (rails and rungs every 0.3 m), a door with a frame, a handrail, a stencil
  ladder(parent, x0, y0, y1, z, { w = .5, rot = 0 } = {}) {
    const g = node(parent, [x0, 0, z]); g.rotation.y = rot; const L = [];
    for (const s of [-1, 1]) L.push([V3(s * w / 2, y0, 0), V3(s * w / 2, y1, 0), .035]);
    for (let y = Math.min(y0, y1) + .3; y < Math.max(y0, y1); y += .3) L.push([V3(-w / 2, y, 0), V3(w / 2, y, 0), .02]);
    for (let y = Math.min(y0, y1) + 1; y < Math.max(y0, y1); y += 3) for (const s of [-1, 1]) L.push([V3(s * w / 2, y, 0), V3(s * w / 2, y, -.35), .03]);
    // the cage hoops (a fixed ladder over 3 m has them)
    for (let y = Math.min(y0, y1) + 2.4; y < Math.max(y0, y1) - .5; y += 1.2) { const n = 8; for (let k = 0; k < n; k++) { const a0 = Math.PI * k / n, a1 = Math.PI * (k + 1) / n; L.push([V3(Math.cos(a0) * .42, y, .42 * Math.sin(a0) + .05), V3(Math.cos(a1) * .42, y, .42 * Math.sin(a1) + .05), .018]); } }
    bars(L, this.M.rail, g); return g;
  }
  door(parent, p, rot = [0, 0, 0], { w = .9, h = 2.0 } = {}) {
    const g = node(parent, p); g.rotation.set(...rot);
    put(g, new THREE.BoxGeometry(w + .24, h + .24, .12), this.M.trim); put(g, new THREE.BoxGeometry(w, h, .14), this.M.dark, [0, 0, .02]);
    put(g, new THREE.BoxGeometry(.06, .3, .06), this.M.chrome, [w * .35, 0, .12]); return g;
  }
  rail(parent, a, b, { h = 1.1 } = {}) {
    const A = V3(...a), B = V3(...b), n = Math.max(1, Math.round(A.distanceTo(B) / 1.8)), L = [];
    for (let i = 0; i <= n; i++) { const p = A.clone().lerp(B, i / n); L.push([p, p.clone().add(V3(0, h, 0)), .03]); }
    for (const y of [h, h * .5]) L.push([A.clone().add(V3(0, y, 0)), B.clone().add(V3(0, y, 0)), .03]);
    bars(L, this.M.rail, parent);
  }
  stencil(parent, text, p, rot = [0, 0, 0], { w = 4, h = 1, col = '#e6e0d2' } = {}) {
    const t = stencilTexture(text, { w: 512, h: Math.round(512 * h / w), col, size: Math.round(512 * h / w * .78) }); t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: .35, roughness: .8, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.position.set(...p); m.rotation.set(...rot); parent.add(m); return m;
  }
  vent(parent, p, rot, w = 3, h = 1.6) { // louvred grille
    const g = node(parent, p); g.rotation.set(...rot); put(g, new THREE.BoxGeometry(w + .3, h + .3, .14), this.M.trim);
    for (let y = -h / 2 + .1; y < h / 2; y += .22) put(g, new THREE.BoxGeometry(w, .08, .2), this.M.dark, [0, y, .06], [-.6, 0, 0]); return g;
  }
  // the crew housing: a bridge glazed on the front (windows lean OUT at the top, as on a ship), warm cabin light, crew behind glass
  bridge(parent, { w = 8, h = 3.6, d = 6, p = [0, 0, 0], lean = .28, wrap = false } = {}) {
    const M = this.M, g = node(parent, p); this.J.bridge = g;
    put(g, boxUV(chamferBox(w, h * .45, d, .3)), M.body, [0, -h * .3, 0], [0, 0, 0], 'core');
    put(g, boxUV(chamferBox(w * 1.04, h * .25, d * 1.04, .25)), M.trim, [0, h * .43, -.1]);
    // cabin box (lit) and the crew
    put(g, new THREE.BoxGeometry(w * .94, h * .52, d * .8), M.cabin, [0, h * .08, -.3]);
    if (this.crewOn) { const R = rng(7); for (let i = 0; i < (wrap ? 5 : 3); i++) { const x = (i - (wrap ? 2 : 1)) * w * .26 + (R() - .5) * .4; const c = node(g, [x, -.3, d * .38]); put(c, new THREE.CylinderGeometry(.24, .2, .9, 8), M.crew, [0, .5, 0]); put(c, new THREE.SphereGeometry(.15, 8, 6), M.crew, [0, 1.12, 0]); } }
    // glazing: a band of panes with mullions, leaning out
    const gl = node(g, [0, h * .08, d * .5 - .05]); gl.rotation.x = -lean;
    put(gl, new THREE.PlaneGeometry(w * .96, h * .5), M.glass); const L = [], n = Math.round(w / 1.4);
    for (let i = 0; i <= n; i++) { const x = -w * .48 + i * w * .96 / n; L.push([V3(x, -h * .25, .02), V3(x, h * .25, .02), .07]); }
    L.push([V3(-w * .48, -h * .25, .03), V3(w * .48, -h * .25, .03), .1], [V3(-w * .48, h * .25, .03), V3(w * .48, h * .25, .03), .1]);
    bars(L, M.dark, gl);
    if (wrap) for (const s of [1, -1]) { const sg = node(g, [s * (w * .5 - .05), h * .08, -.3]); sg.rotation.y = s * Math.PI / 2; put(sg, new THREE.PlaneGeometry(d * .7, h * .48), M.glass); }
    this.rail(g, [-w / 2, h * .55, d * .45], [w / 2, h * .55, d * .45]);
    return g;
  }
  // a hand: a heavy palm, four fingers of three phalanges, a thumb; curl 0 (open) .. 1 (fist)
  hand(parent, s, { size = 5, curl = .35, mat = null } = {}) {
    const M = this.M, k = size / 5, g = node(parent, [0, -.6 * k, 0]); this.hands = this.hands || {}; const fingers = [];
    put(g, boxUV(chamferBox(4.1 * k, 3.6 * k, 2.1 * k, .3 * k)), mat || M.body, [0, -1.9 * k, 0], [0, 0, 0], 'core');
    put(g, boxUV(chamferBox(4.3 * k, .9 * k, 2.3 * k, .2 * k)), M.dark, [0, -.25 * k, 0]);
    for (let i = 0; i < 4; i++) {
      const x = (-1.5 + i) * .98 * k; let p = node(g, [x, -3.75 * k, .1 * k]); const lens = [1.6, 1.25, 1.0].map(v => v * k * (i === 0 || i === 3 ? .9 : 1)); const segs = [];
      for (let j = 0; j < 3; j++) { put(p, boxUV(chamferBox(.86 * k, lens[j], 1.15 * k, .16 * k)), j === 2 ? M.trim : (mat || M.body), [0, -lens[j] / 2, 0]); put(p, cylX(.36 * k, .9 * k, 12), M.dark); segs.push(p); p = node(p, [0, -lens[j], 0]); }
      fingers.push(segs);
    }
    let t = node(g, [s * 2.0 * k, -1.6 * k, .7 * k]); t.rotation.set(.5, 0, s * .7); const thumb = [t];
    for (let j = 0; j < 2; j++) { put(t, boxUV(chamferBox(1.0 * k, 1.5 * k, 1.1 * k, .16 * k)), M.body, [0, -.75 * k, 0]); t = node(t, [0, -1.5 * k, 0]); thumb.push(t); }
    const H = { fingers, thumb, g }; this.hands[s > 0 ? 'L' : 'R'] = H; this.curl(s > 0 ? 'L' : 'R', curl); return H;
  }
  curl(side, c) { const H = this.hands?.[side]; if (!H) return; H.fingers.forEach((segs, i) => segs.forEach((sg, j) => { sg.rotation.x = -(c * [1.0, 1.25, 1.0][j] * (1 + i * .04)); })); H.thumb[1].rotation.x = -c * .8; }
  addMark() { // the ONE red: a red plate, bolted on, bearing the mark (cream). Placed per design (this.markAt = [parent, pos, w])
    if (!this.markAt) return; const [parent, p, w] = this.markAt, h = w * 1.18;
    const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * h / w); const g = c.getContext('2d');
    g.fillStyle = RED; g.fillRect(0, 0, c.width, c.height); g.fillStyle = 'rgba(0,0,0,.18)'; const MR = rng(5); for (let i = 0; i < 400; i++) g.fillRect(MR() * 512, MR() * c.height, 2 + MR() * 10, 1 + MR() * 3);   // seeded (c4 fix: the noise changed every render)
    drawMark(g, c.width / 2, c.height * .44, c.width * .82, { color: '#e9e1cf' });
    g.font = `800 ${Math.round(c.width * .1)}px "Big Shoulders Stencil Display", sans-serif`; g.fillStyle = '#e9e1cf'; g.textAlign = 'center'; g.fillText('No. 1', c.width / 2, c.height * .9);
    for (const [x, y] of [[.06, .04], [.94, .04], [.06, .96], [.94, .96], [.5, .04], [.5, .96]]) { g.fillStyle = 'rgba(0,0,0,.4)'; g.beginPath(); g.arc(x * 512, y * c.height, 9, 0, 7); g.fill(); g.fillStyle = '#d9584a'; g.beginPath(); g.arc(x * 512 - 1, y * c.height - 1, 7, 0, 7); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    const faceMat = new THREE.MeshStandardMaterial({ map: t, roughness: .7, metalness: .05 }), m = new THREE.Mesh(boxUV(chamferBox(w, h, .3, .08)), this.M.trim);
    m.position.set(...p); m.castShadow = true; const mg = node(parent, [0, 0, 0]); if (this.markRot) { mg.position.set(...p); m.position.set(0, 0, 0); mg.rotation.set(...this.markRot); } mg.add(m); this.markMesh = m;
    // the box UVs are world-tiled; give the face plane its own UVs instead
    const f = new THREE.Mesh(new THREE.PlaneGeometry(w * .98, h * .98), faceMat); f.position.copy(m.position); f.position.z += .16; mg.add(f); this.markFace = f;
  }
  // ---- pose: {joint: [x, y, z] degrees}, root: {p: [x, y, z], r: [...]}, curl: {L, R}
  pose(P) {
    const J = this.J; for (const k in J) if (!['root', 'bridge', 'back', 'shHL', 'shHR'].includes(k)) J[k].rotation.set(0, 0, 0);
    for (const [k, v] of Object.entries(P)) { if (k === 'root' || k === 'curl') continue; if (J[k]) J[k].rotation.set(v[0] * d2r, (v[1] || 0) * d2r, (v[2] || 0) * d2r); }
    const r = P.root || {}; J.root.position.set(r.p?.[0] ?? 0, this.hipY + (r.p?.[1] ?? 0), r.p?.[2] ?? 0); J.root.rotation.set(...(r.r || [0, 0, 0]).map(v => v * d2r));
    if (P.curl) for (const s of ['L', 'R']) if (P.curl[s] != null) this.curl(s, P.curl[s]);
    this.update();
  }
  footWorld(side) { this.g.updateMatrixWorld(true); const p = new THREE.Vector3(); this.J['an' + side].getWorldPosition(p); return p; }
  // drop the root so the lowest sole touches y = 0 (call after pose for standing tiles)
  ground() { this.g.updateMatrixWorld(true); const b = new THREE.Box3(); for (const s of ['L', 'R']) b.expandByObject(this.J['an' + s]); this.g.position.y -= b.min.y; this.g.updateMatrixWorld(true); this.update(); }
  // the build: u from 0 (frame only) to 1 (finished). Parts are hung bottom-up; the newest are still in red-lead primer
  setBuild(u, { primerBand = .1, primerAll = false } = {}) {
    this.build = u; this.g.traverse(o => { if (o.userData.thr == null) return; const age = u - o.userData.thr; o.visible = age >= 0 && !(o.userData.arm && u >= Math.min(.999, o.userData.segEnd + .06)); if (o.userData.paint) o.material = (u < 1 && (age < primerBand || primerAll || (o.userData.tag === 'core' && u < o.userData.segEnd + .04))) ? this.M.primer : o.userData.base; });
    for (const q of this.rams) for (const m of [q.barrel, q.rodM, q.capA, q.capB, q.hose]) m.visible = u >= q.thr;
    if (this.markFace) this.markFace.visible = this.markMesh.visible = u >= .999;
  }
}

// ---------------------------------------------------------------- shape helpers: sections in plan (x, z), extruded down from y = 0
export const rectC = (w, d, c = 1) => { const x = w / 2, z = d / 2; c = Math.min(c, x * .8, z * .8); return [[-x + c, -z], [x - c, -z], [x, -z + c], [x, z - c], [x - c, z], [-x + c, z], [-x, z - c], [-x, -z + c]]; };
// a ship's section: flat back, straight sides, the front closing to a blunt prow
export const prowS = (w, d, prow = 3, nose = .2, c = .8) => { const x = w / 2, z = d / 2; return [[-x + c, -z], [x - c, -z], [x, -z + c], [x, z - prow], [w * nose, z], [-w * nose, z], [-x, z - prow], [-x, -z + c]]; };
// prism: section extruded along -y for h, chamfered (bevel b) on its top and bottom rims, x/z scaled at the bottom by bot and the top by top
export function prism(sect, h, { bot = [1, 1], top = [1, 1], b = .3 } = {}) {
  const s = new THREE.Shape(); sect.forEach(([x, z], i) => i ? s.lineTo(x, -z) : s.moveTo(x, -z)); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(.05, h - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b * .9, bevelOffset: -b * .9, bevelSegments: 1, curveSegments: 1 });
  g.rotateX(-Math.PI / 2); g.computeBoundingBox(); const y0 = g.boundingBox.min.y; g.translate(0, -y0, 0); // y in [0, h]
  taper(g, bot[0], bot[1], top[0], top[1]); g.translate(0, -h, 0); return boxUV(g);
}
function armor(G, parent, sect, h, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, mat = null, tag = 'core', ...o } = {}) {
  return put(parent, prism(sect, h, o), mat || G.M.body, [x, y, z], [rx, ry, rz], tag);
}
// a bolted plate: a thin chamfered slab you could hang from a crane hook
function plateOn(G, parent, w, h, p, r = [0, 0, 0], { t = .45, mat = null } = {}) { return put(parent, boxUV(chamferBox(w, h, t, Math.min(.18, t * .4))), mat || G.M.body, p, r, 'panel'); }
// a slewing ring (the crane's turntable bearing) for the waist: the torso turns on it
function slewRing(G, parent, r, y) {
  const g = node(parent, [0, y, 0]); put(g, new THREE.CylinderGeometry(r, r, 1.3, 40), G.M.dark); put(g, new THREE.CylinderGeometry(r * 1.06, r * 1.06, .35, 40), G.M.trim, [0, .5, 0]);
  const n = 36, im = new THREE.InstancedMesh(new THREE.CylinderGeometry(.13, .13, .3, 6), G.M.chrome, n), M4 = new THREE.Matrix4();
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; M4.makeTranslation(Math.cos(a) * r * 1.01, .82, Math.sin(a) * r * 1.01); im.setMatrixAt(i, M4); } g.add(im); return g;
}

// ---------------------------------------------------------------- shared: hips, legs, arms (heavy, mass low)
function hips(G, { w, d, h, skirt = true }) {
  const { J, M, D } = G;
  armor(G, J.pelvis, rectC(w, d, 1.6), h, { y: h * .55, bot: [.8, .86], b: .4 });
  slewRing(G, J.pelvis, Math.min(w, d) * .36, h * .55 + .1);
  put(J.waist, new THREE.CylinderGeometry(Math.min(w, d) * .3, Math.min(w, d) * .33, D.waist + 1, 24), M.dark, [0, D.waist / 2, 0]);
  if (skirt) for (const s of [1, -1]) {
    plateOn(G, J.pelvis, w * .3, h * 1.05, [s * w * .2, -h * .2, d * .5 + .3], [-.16, 0, s * .03]);
    plateOn(G, J.pelvis, d * .62, h * 1.0, [s * (w * .5 + .3), -h * .25, 0], [0, s * Math.PI / 2, 0], { t: .5 }).rotateX(.14);
  }
}
function legs(G, { thigh, shin, foot, kneeR = 2.6, ribs = 0 }) {
  const { J, D, M } = G;
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R', hp = J['hp' + L], kn = J['kn' + L], an = J['an' + L];
    G.bearing(hp, 3, 5.2, [0, 0, 0]);
    // thigh: heavy at the hip, narrowing to the knee; an armour plate on the outside
    armor(G, hp, rectC(thigh.w, thigh.d, 1.3), D.thigh - 1.6, { y: -1.4, bot: [.8, .84] });
    plateOn(G, hp, thigh.d * .74, D.thigh * .55, [s * (thigh.w * .45 + .35), -D.thigh * .38, 0], [0, s * Math.PI / 2, 0], { t: .6 });
    G.bearing(kn, kneeR, thigh.w * .8, [0, 0, 0]);
    // knee cap: an angled plate the giant can kneel on
    const kc = node(kn, [0, .4, shin.d * .5 + .4]); kc.rotation.x = -.18; armor(G, kc, rectC(shin.w * .82, 2.6, .8), 5.4, { y: 2.6, bot: [.86, 1], tag: 'panel' });
    // shin: a greave that FLARES toward the ankle (mass low, like a crane's outrigger leg), a front plate, a caged ladder, a door
    armor(G, kn, rectC(shin.w, shin.d, 1.6), D.shin - 1.2, { y: -1.2, top: [.86, .9], bot: [1.08, 1.06] });
    const gr = node(kn, [0, -2.8, shin.d * .5 + .1]); gr.rotation.x = -.035; armor(G, gr, rectC(shin.w * .62, 1.2, .5), D.shin * .66, { mat: M.trim, tag: 'panel', bot: [1.08, 1] });
    for (let i = 0; i < ribs; i++) { const x = (i - (ribs - 1) / 2) * shin.w * .28; armor(G, kn, rectC(.7, .8, .2), D.shin - 3, { x, y: -2.2, z: shin.d * .5 + .9, tag: 'panel', mat: M.trim }); }
    // ankle: a shroud over the joint, then the foot
    G.bearing(an, 1.8, 3.8, [0, 0, 0], M.dark);
    armor(G, kn, rectC(shin.w * 1.18, shin.d * 1.16, 1.4), 2.4, { y: -D.shin + 2.3, mat: M.trim });
    const f = node(an, [0, 0, 0]), fw = foot.w, fl = foot.l, fh = D.ankle;
    armor(G, f, rectC(fw * .78, fl * .62, 1.6), fh * .82, { y: -fh * .1, z: fl * .02, bot: [1.18, 1.3] });
    armor(G, f, prowS(fw, fl * .38, 2.2, .3, .6), fh * .42, { y: -fh + fh * .42, z: fl * .38, mat: M.trim, bot: [1, 1], top: [.94, .9] });
    armor(G, f, rectC(fw * .92, fl * .26, .6), fh * .38, { y: -fh + fh * .38, z: -fl * .32, mat: M.trim });
    put(f, new THREE.BoxGeometry(fw * 1.0, .32, fl * 1.02), M.rubber, [0, -fh + .16, fl * .03]);
    G.door(f, [s * fw * .4 + s * .02, -fh * .52, -fl * .06], [0, s * Math.PI / 2, 0], { h: 1.8 });
    // knee rams (twin, front: an excavator's boom cylinders) and an ankle ram behind
    for (const q of [1, -1]) G.ram(hp, [q * thigh.w * .3, -D.thigh * .52, thigh.d * .58], kn, [q * shin.w * .32, -4.8, shin.d * .62], { r: .62, rod: .34, frac: .6 });
    G.ram(kn, [0, -D.shin * .5, -shin.d * .64], an, [0, -.6, -fl * .3], { r: .58, rod: .32, frac: .6 });
    G.ladder(kn, s * (shin.w * .5 + .35), -D.shin + 2.4, -2.6, 0, { rot: s * Math.PI / 2 });
    G.door(kn, [s * (shin.w * .52 + .02), -D.shin * .8, -shin.d * .22], [0, s * Math.PI / 2, 0]);
    G.stencil(kn, L === 'L' ? 'L-1' : 'R-1', [0, -D.shin * .72, shin.d * .5 + .66], [0, 0, 0], { w: 2.4, h: 1.1, col: '#2a2826' });
  }
}
function arms(G, { ua, fa, handSize, curl = .4, elbowR = 2.2 }) {
  const { J, M, D } = G;
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R', sh = J['sh' + L], el = J['el' + L];
    G.bearing(sh, 3.1, 4.6, [0, 0, 0]);
    armor(G, sh, rectC(ua.w, ua.d, 1), D.ua - 2.2, { y: -1.6, bot: [.92, .92] });
    G.bearing(el, elbowR, ua.w * .9, [0, 0, 0]);
    // forearm: the big member (it does the lifting): an olecranon lever above the pin, a cuff at the wrist
    armor(G, el, rectC(fa.w, fa.d, 1.4), D.fa + 1.2, { y: 1.6, bot: [.8, .82], top: [.88, .9] });
    plateOn(G, el, fa.d * .7, D.fa * .5, [s * (fa.w * .45 + .32), -D.fa * .32, 0], [0, s * Math.PI / 2, 0], { t: .55, mat: M.trim });
    armor(G, el, rectC(fa.w * .92, fa.d * .92, 1), 1.6, { y: -D.fa + 1.4, mat: M.dark });
    G.hand(J['wr' + L], s, { size: handSize, curl });
    G.ram(sh, [0, -3.4, -ua.d * .62], el, [0, 1.8, -fa.d * .62], { r: .55, rod: .3, frac: .62 });
    G.ram(sh, [s * ua.w * .56, -2.6, ua.d * .18], el, [s * fa.w * .5, -2.6, fa.d * .2], { r: .46, rod: .26, frac: .62 });
    G.stencil(el, 'SWL 400 T', [s * (fa.w * .45 + .62), -D.fa * .62, 0], [0, s * Math.PI / 2, 0], { w: 3.6, h: .85, col: '#2b2a28' });
  }
}
// a shoulder housing that wraps the top of the arm, stepped back at the top (deco setbacks); fixed to the chest
function shoulder(G, s, { w, d, h, steps = [[.74, .8, 2.2], [.5, .6, 1.2]], x = 1.2, label = null, mat = null }) {
  const { J, D, M } = G, sh = node(J.chest, [s * D.shX, D.shY, 0]); J['shH' + (s > 0 ? 'L' : 'R')] = sh;
  armor(G, sh, rectC(w, d, 1.3), h, { x: s * x, y: h * .58, bot: [.94, .92], mat });
  let y = h * .58; for (const [kw, kd, kh] of steps) { y += kh; armor(G, sh, rectC(w * kw, d * kd, .6), kh, { x: s * (x + w * (1 - kw) * .22), y, mat: M.trim }); }
  G.rail(sh, [s * (x - w * .35), h * .58, d * .46], [s * (x + w * .46), h * .58, d * .46]);
  G.vent(sh, [s * (x + w / 2 + .05), h * .1, -d * .1], [0, s * Math.PI / 2, 0], d * .5, 2.2);
  if (label) G.stencil(sh, label, [s * x, h * .32, d / 2 + .06], [0, 0, 0], { w: w * .62, h: w * .62 * .38 });
  G.door(sh, [s * (x - w * .2), h * .58 + 1.25, d * .38], [0, 0, 0], { h: 1.9 });
  return sh;
}

// ---------------------------------------------------------------- HULL
function buildHull(G) {
  const { J, D, M } = G, [cw, ch, cd] = D.chest;
  hips(G, { w: D.pelvis[0], d: D.pelvis[2], h: D.pelvis[1] });
  // chest: a hull section turned upright. Prow front, flat back, narrowing hard to the waist; a strake (belt) round it
  armor(G, J.chest, prowS(cw, cd, 3.2, .16, 1.2), ch, { y: ch, bot: [.6, .8], b: .5 });
  armor(G, J.chest, prowS(cw * .94, cd * 1.02, 3.2, .16, 1.1), 1.1, { y: ch * .42, mat: M.trim, bot: [1, 1], tag: 'panel' }).scale.set(.84, 1, 1);
  // the bulwark round the top (the bridge sits behind it), and the chest plates either side of the keel
  armor(G, J.chest, prowS(cw * 1.02, cd * 1.04, 3.3, .16, 1.2), 1.5, { y: ch + 1.2, mat: M.trim, tag: 'panel' });
  for (const s of [1, -1]) { const p = node(J.chest, [s * cw * .27, ch * .82, cd * .5 - 1.35]); p.rotation.y = s * .56; plateOn(G, p, cw * .3, ch * .38, [0, 0, 0], [-.06, 0, 0], { t: .55 }); }
  G.bridge(J.chest, { w: 9, h: 4, d: 6.6, p: [0, ch + 3.2, .2], lean: .32 });
  armor(G, J.chest, rectC(10, 7.4, 1.2), 1.6, { y: ch + 1.5, z: -.2, mat: M.dark });
  // back: the power house, two short stacks, vents, a ladder to the bridge deck
  const back = node(J.chest, [0, ch, -cd * .5]); J.back = back;
  armor(G, back, rectC(cw * .56, 4.4, 1), ch * .72, { z: -1.6, y: 1.2, mat: M.trim });
  for (const s of [1, -1]) { put(back, new THREE.CylinderGeometry(.95, 1.1, 5, 16), M.dark, [s * 2.7, 3.2, -2.4]); G.vent(back, [s * 2.4, -ch * .4, -3.85], [0, Math.PI, 0], 3, 2.6); }
  G.ladder(J.chest, 0, 1.5, ch + .5, -cd * .5 - 4.1, { rot: Math.PI });
  for (const s of [1, -1]) shoulder(G, s, { w: 8.4, d: 10, h: 7, steps: [[.72, .8, 1.6]], label: s > 0 ? 'ACP' : 'No. 1' });
  G.markAt = [J.chest, [-cw * .25, ch * .62, cd * .5 - 1.0], 3.4]; G.markRot = [-.06, -.56, 0];
  legs(G, { thigh: { w: 7, d: 7.6 }, shin: { w: 7.2, d: 7.8 }, foot: { w: 9, l: 14 }, kneeR: 2.9 });
  arms(G, { ua: { w: 6, d: 6.4 }, fa: { w: 7.6, d: 8 }, handSize: D.hand });
}

// ---------------------------------------------------------------- SETBACK
function buildSetback(G) {
  const { J, D, M } = G, [cw, ch, cd] = D.chest;
  hips(G, { w: D.pelvis[0], d: D.pelvis[2], h: D.pelvis[1] });
  // three tiers stepping in, each with a cornice; vertical piers on the front (the Daily News / Chrysler move)
  const tiers = [[cw, ch * .56, cd, [.66, .82]], [cw * .8, ch * .28, cd * .86, [1, 1]], [cw * .54, ch * .16, cd * .72, [1, 1]]]; let y = 0;
  tiers.forEach(([w, h, d, bot], i) => {
    y += h; armor(G, J.chest, rectC(w, d, 1), h, { y, bot, b: .3 });
    armor(G, J.chest, rectC(w * 1.04, d * 1.06, 1.05), .7, { y: y + .1, mat: M.trim, tag: 'panel' });
    const n = i === 0 ? 7 : i === 1 ? 5 : 3;
    for (let k = 0; k < n; k++) { const x = (k - (n - 1) / 2) * w / n * .92; armor(G, J.chest, rectC(w / n * .42, 1, .2), h - .9, { x: x * (i === 0 ? .86 : 1), y: y - .7, z: d / 2 + .25, mat: k === (n - 1) / 2 ? M.trim : M.body, tag: 'panel', bot: i === 0 ? [.75, 1] : [1, 1] }); }
  });
  G.bridge(J.chest, { w: 6.4, h: 3.4, d: 5.6, p: [0, y + 2.2, .2], lean: .12, wrap: true });
  armor(G, J.chest, rectC(4.8, 4.2, .8), 1.2, { y: y + 4.6, mat: M.trim });
  armor(G, J.chest, rectC(2.6, 2.4, .5), 1.0, { y: y + 5.6, mat: M.trim });
  for (const s of [1, -1]) { const sh = shoulder(G, s, { w: 7.6, d: 9, h: 11, x: .8, steps: [[.76, .78, 2.6], [.52, .58, 1.6], [.3, .38, 1]], label: s > 0 ? 'ACP' : 'No. 1' });
    for (let k = 0; k < 3; k++) armor(G, sh, rectC(.9, .8, .2), 10, { x: s * .8 + (k - 1) * 2.2, y: 11 * .58 - .3, z: 4.6, mat: M.trim, tag: 'panel' }); }
  G.ladder(J.chest, 0, 1.5, y, -cd * .5 - .4, { rot: Math.PI });
  G.markAt = [J.chest, [0, ch * .3, cd * .5 + .75], 3.2];
  legs(G, { thigh: { w: 6.4, d: 7 }, shin: { w: 6.8, d: 7.4 }, foot: { w: 8.8, l: 13 }, kneeR: 2.6, ribs: 3 });
  arms(G, { ua: { w: 5.6, d: 6 }, fa: { w: 7, d: 7.4 }, handSize: D.hand });
}

// ---------------------------------------------------------------- FRAME
function truss(G, parent, { w, h, d, y = 0, x = 0, z = 0, bot = [1, 1], r = .32, bay = 3.2, plates = 0 }) {
  const g = node(parent, [x, y, z]), L = [], n = Math.max(2, Math.round(h / bay)), C = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const at = (sx, sz, t) => V3(sx * w / 2 * lerp(1, bot[0], t), -h * t, sz * d / 2 * lerp(1, bot[1], t));
  for (let i = 0; i <= n; i++) { const t = i / n; for (let j = 0; j < 4; j++) { const a = C[j], b = C[(j + 1) % 4]; L.push([at(a[0], a[1], t), at(b[0], b[1], t), r * .6]); if (i < n) { L.push([at(a[0], a[1], t), at(a[0], a[1], (i + 1) / n), r]); L.push([at(a[0], a[1], t), at(b[0], b[1], (i + 1) / n), r * .45]); L.push([at(b[0], b[1], t), at(a[0], a[1], (i + 1) / n), r * .45]); } } }
  bars(L, G.M.lattice, g);
  const N = (n + 1) * 4, gi = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), G.M.trim, N), M4 = new THREE.Matrix4(); let q = 0;
  for (let i = 0; i <= n; i++) for (const [sx, sz] of C) { M4.compose(at(sx, sz, i / n), new THREE.Quaternion(), V3(r * 3.4, r * 3.4, r * 3.4)); gi.setMatrixAt(q++, M4); }
  gi.castShadow = true; g.add(gi);
  for (let i = 0; i < plates; i++) { const t0 = (i + .5) / (plates + .5); plateOn(G, g, w * lerp(1, bot[0], t0) * .92, h / (plates + 1) * .55, [0, -h * t0, d / 2 * lerp(1, bot[1], t0) + .25]); }
  G.parts.push(g); return g;
}
function buildFrame(G) {
  const { J, D, M } = G, [cw, ch, cd] = D.chest;
  hips(G, { w: D.pelvis[0], d: D.pelvis[2], h: D.pelvis[1], skirt: false });
  truss(G, J.chest, { w: cw, h: ch, d: cd, y: ch, bot: [.62, .78], r: .5, bay: 3.4 });
  for (const yy of [ch * .4, ch * .74]) armor(G, J.chest, rectC(cw * lerp(.62, 1, yy / ch) * .95, cd * .9, .6), .5, { y: yy, mat: M.trim, tag: 'panel' });
  G.bridge(J.chest, { w: 7, h: 3.6, d: 5.2, p: [0, ch * .74 + 2.4, .3], lean: .2, wrap: true });
  armor(G, J.chest, rectC(cw * 1.04, cd * 1.04, 1), 1.1, { y: ch + .5, mat: M.trim });
  armor(G, J.chest, rectC(cw * .8, 1, .3), ch * .55, { z: -cd * .5 + .2, y: ch * .95 });
  G.ladder(J.chest, cw * .33, 0, ch, cd * .5 + .8);
  G.markAt = [J.chest, [0, ch * .5, cd * .5 + .5], 3.4];
  for (const s of [1, -1]) shoulder(G, s, { w: 7.4, d: 9, h: 4.4, x: .6, steps: [[.7, .7, 1.2]], mat: M.body });
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R';
    G.bearing(J['hp' + L], 3, 5.4); truss(G, J['hp' + L], { w: 6, h: D.thigh - 1.4, d: 6, y: -1.6, bot: [.8, .8], r: .44, plates: 1 });
    G.bearing(J['kn' + L], 2.7, 5.4); truss(G, J['kn' + L], { w: 6, h: D.shin - 1.6, d: 6.2, y: -1.4, bot: [1.08, 1.06], r: .44, plates: 2 });
    armor(G, J['kn' + L], rectC(7.4, 7.6, 1.2), 2.2, { y: -D.shin + 2.2, mat: M.trim });
    G.bearing(J['an' + L], 1.8, 4, [0, 0, 0], M.dark);
    G.bearing(J['sh' + L], 3, 4.4); truss(G, J['sh' + L], { w: 4.4, h: D.ua - 2.4, d: 4.4, y: -1.8, bot: [.86, .86], r: .36 });
    G.bearing(J['el' + L], 2.1, 4.4); truss(G, J['el' + L], { w: 5.6, h: D.fa - 1.2, d: 5.6, y: -.2, bot: [.8, .8], r: .38, plates: 1 });
    armor(G, J['el' + L], rectC(5, 5, .8), 1.4, { y: -D.fa + 1.2, mat: M.dark });
    G.hand(J['wr' + L], s, { size: D.hand, curl: .4 });
    const f = node(J['an' + L], [0, 0, 0]), fw = 8.4, fl = 13, fh = D.ankle;
    armor(G, f, rectC(fw * .78, fl * .62, 1.6), fh * .82, { y: -fh * .1, z: fl * .02, bot: [1.18, 1.3] });
    armor(G, f, prowS(fw, fl * .38, 2.2, .3, .6), fh * .42, { y: -fh + fh * .42, z: fl * .38, mat: M.trim });
    put(f, new THREE.BoxGeometry(fw, .32, fl * 1.02), M.rubber, [0, -fh + .16, fl * .03]);
    for (const q of [1, -1]) G.ram(J['hp' + L], [q * 2.2, -D.thigh * .55, 3.4], J['kn' + L], [q * 2.3, -4.6, 3.5], { r: .6, rod: .32, frac: .58 });
    G.ram(J['sh' + L], [0, -3.5, -2.8], J['el' + L], [0, 1.4, -3], { r: .55, rod: .3, frac: .62 });
    G.ladder(J['kn' + L], 0, -D.shin + 2.4, -2, 3.5);
  }
}

// ---------------------------------------------------------------- poses (degrees). x = pitch (+ = limb swings back for legs), z = roll
export const POSE = {
  // at rest but not on parade: weight on the left, right foot a little forward and out, arms away from the body, a slight lean in
  stand: { root: { p: [0, -.6, 0], r: [2, -4, 0] }, waist: [2, 4, 0], chest: [3, 0, 0], hpL: [2, 0, 3], knL: [5, 0, 0], anL: [-7, 0, -3], hpR: [-10, 8, -6], knR: [10, 0, 0], anR: [0, 0, 6], shL: [-6, 0, 10], elL: [-18, 0, 0], shR: [6, 0, -12], elR: [-12, 0, 0], curl: { L: .45, R: .3 } },
  // the work: both hands low and forward, taking a load (a girder) at hip height
  carry: { root: { p: [0, -2.2, 0], r: [6, 0, 0] }, waist: [6, 0, 0], chest: [8, 0, 0], hpL: [-14, 0, 4], knL: [26, 0, 0], anL: [-12, 0, -4], hpR: [-4, 0, -4], knR: [14, 0, 0], anR: [-10, 0, 4], shL: [-42, 0, 8], elL: [-38, 0, 0], shR: [-42, 0, -8], elR: [-38, 0, 0], curl: { L: .75, R: .75 } },
};
// one step at true slowness: phase 0..1 moves the right foot from behind to in front while the left stays planted
export function stepPose(u) {
  const e = u * u * (3 - 2 * u), sw = Math.sin(Math.PI * u);
  return {
    root: { p: [Math.sin(Math.PI * u) * .8, -.9 - sw * .3 + Math.sin(2 * Math.PI * u) * .1, 0], r: [4, 0, lerp(-2, 2, e)] },
    waist: [1, lerp(6, -6, e), lerp(2, -2, e)], chest: [3, lerp(4, -4, e), 0],
    hpL: [lerp(-14, 12, e), 0, 2], knL: [lerp(8, 10, e) + sw * 4, 0, 0], anL: [lerp(6, -22, e), 0, -2],
    hpR: [lerp(16, -24, e) , 0, -3], knR: [lerp(18, 8, e) + sw * 38, 0, 0], anR: [lerp(-14, 16, e) - sw * 10, 0, 2],
    shL: [lerp(-14, 14, e), 0, 9], elL: [-20 - sw * 6, 0, 0], shR: [lerp(14, -14, e), 0, -9], elR: [-20 - sw * 6, 0, 0], curl: { L: .4, R: .4 },
  };
}
