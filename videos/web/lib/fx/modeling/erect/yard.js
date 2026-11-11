// ERECT yard (MODELING c4): a site kit with density and weather, for any heavy-construction scene (the giant's yard first).
//
// Why: c3's site was a clean pipe-scaffold box on flat grey ground. The painting the party chose has worked ground (snow over mud,
// ruts, spoil), timber everywhere (cribbing, trestles, plank walks), mixed scaffold, cranes against the sky, steam, and hundreds of
// small dark people. Everything here is in metres and built from the same members and material stack as the giant.
//
//   const Y = new Yard(scene, { U, M });   Y.ground(); Y.crib(...); Y.towerCrane(...); Y.truck(...); Y.works(); Y.steam(...)
//   Y.crowd(n, place) (HUMAN's people.js workers, not mannequins);  Y.update(t, camera) each frame (cranes, steam, people)
import * as THREE from 'three';
import { Batch, V3, cbox, cyl, cylX, cylZ, along, angleMember, flatBar, plateAt, iBeam, latticeColumn, rng } from './members.js';
import { stackMaterial, plainBuild, mottleTexture } from './steel.js';
import { People } from '../../people.js';

const lerp = (a, b, t) => a + (b - a) * t, clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x)), C = h => new THREE.Color(h);
const sstep = (a, b, t) => { const u = clamp((t - a) / (b - a)); return u * u * (3 - 2 * u); };
const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// ---------------------------------------------------------------- lit sprites (steam, smoke, dust): forward scatter toward the sun
let _puff = null;
export function puffTex() {
  if (_puff) return _puff; const c = cv(128, 128), g = c.getContext('2d'), R = rng(9);
  for (let i = 0; i < 18; i++) { const x = 64 + (R() - .5) * 50, y = 64 + (R() - .5) * 50, r = 18 + R() * 30, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(255,255,255,${.22 + R() * .2})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }
  const m = g.createRadialGradient(64, 64, 30, 64, 64, 64); m.addColorStop(0, 'rgba(0,0,0,0)'); m.addColorStop(1, 'rgba(0,0,0,1)'); g.globalCompositeOperation = 'destination-out'; g.fillStyle = m; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return (_puff = t);
}
export class Puffs {
  // n sprites; each { p, s, a (alpha), c (base colour), rot }. update(camera, sunDir) relights them: backlit steam glows
  constructor(parent, n, { col = '#e9e6df', shade = '#8d8a86', sunCol = '#ffd7a0', depthWrite = false } = {}) {
    this.g = new THREE.Group(); parent.add(this.g); this.items = []; this.col = C(col); this.shade = C(shade); this.sunCol = C(sunCol);
    for (let i = 0; i < n; i++) { const m = new THREE.SpriteMaterial({ map: puffTex(), transparent: true, depthWrite, opacity: 0, fog: false }); const s = new THREE.Sprite(m); s.visible = false; this.g.add(s); this.items.push(s); }
  }
  light(camera, sunD, k = 1) {
    const cp = camera.getWorldPosition(V3()), v = V3();
    for (const s of this.items) { if (!s.visible) continue; v.copy(s.position).sub(cp).normalize(); const fwd = Math.pow(Math.max(0, v.dot(sunD)), 4), top = clamp((s.position.y - (s.userData.base ?? 0)) / Math.max(1, s.scale.y) * .3 + .4);
      s.material.color.copy(this.shade).lerp(this.col, top).lerp(this.sunCol, fwd * .8 * k).multiplyScalar(1 + fwd * 1.4 * k); }
  }
}
// a steam or smoke plume: a column of puffs that rises, drifts with the wind and grows; t animates it
export class Plume {
  constructor(parent, p, { n = 26, h = 40, w = 6, wind = [1, 0, .3], rate = 1, col = '#ece9e2', shade = '#9a958d', op = .5, seed = 3 } = {}) {
    this.P = new Puffs(parent, n, { col, shade }); this.p = p.clone(); this.o = { n, h, w, wind: V3(...wind), rate, op }; this.R = rng(seed); this.seeds = Array.from({ length: n }, () => [this.R(), this.R(), this.R()]);
  }
  update(t, camera, sunD) {
    const { n, h, w, wind, rate, op } = this.o;
    this.P.items.forEach((s, i) => { const [a, b, c] = this.seeds[i], age = ((t * rate * .12 + i / n) % 1), y = age * h;
      s.visible = true; s.position.copy(this.p).add(V3((b - .5) * w * .4, y, (c - .5) * w * .4)).addScaledVector(wind, age * age * h * .6);
      const sz = w * (.6 + age * 2.6) * (.8 + a * .4); s.scale.set(sz, sz * .85, 1); s.material.opacity = op * Math.min(1, age * 6) * (1 - age) * (1 - age * .3); s.material.rotation = a * 6 + age; s.userData.base = this.p.y; });
    this.P.light(camera, sunD);
  }
}

// ---------------------------------------------------------------- the yard
export class Yard {
  constructor(scene, { U, M = {}, seed = 11 } = {}) {
    this.scene = scene; this.U = U; this.R = rng(seed); this.anim = []; this.plumes = []; this.cranes = []; this.groups = [];
    this.M = { ...M,
      timber: stackMaterial(U, { coat: '#6e5841', primer: '#6e5841', bare: '#8a7458', rivets: 0, rustAmt: 0, wear: .6, rough: .9, metal: 0, tone: .55, name: 'timber' }),
      timberDk: stackMaterial(U, { coat: '#4a3c2e', primer: '#4a3c2e', rivets: 0, rustAmt: 0, rough: .92, metal: 0, tone: .5, name: 'timberDk' }),
      crane: stackMaterial(U, { coat: '#3d3a36', wear: .8, rustAmt: .5, rivR: .03, rivP: .2, name: 'crane' }),
      craneY: stackMaterial(U, { coat: '#a8862f', primer: '#a8862f', wear: 1, rustAmt: .4, rivets: 0, name: 'craneY' }),
      tube: stackMaterial(U, { coat: '#8b8c88', bare: '#9a9a96', wear: .4, rivets: 0, rustAmt: .3, metal: .55, rough: .5, name: 'tube' }),
      truck: stackMaterial(U, { coat: '#6b2f24', wear: 1, rivets: 0, rustAmt: .4, name: 'truckR' }),
      truck2: stackMaterial(U, { coat: '#3c4a52', wear: 1, rivets: 0, rustAmt: .4, name: 'truckB' }),
      concrete: stackMaterial(U, { coat: '#a39e94', primer: '#a39e94', rivets: 0, rustAmt: .2, rough: .95, metal: 0, tone: .5, name: 'concrete' }),
      glassY: plainBuild(U, { color: C('#1a1f24'), metalness: .3, roughness: .1 }),
      lampY: plainBuild(U, { color: C('#ffe6c2') }, { basic: true }),
      tarp: stackMaterial(U, { coat: '#5c6058', primer: '#5c6058', rivets: 0, rustAmt: 0, rough: .95, metal: 0, tone: .6, name: 'tarp' }),
    };
    this.M.lampY.toneMapped = false;
  }
  add(B, name = 'yard', pos = null, rotY = 0) { const g = B.build(this.M, { name }); if (pos) g.position.copy(pos); g.rotation.y = rotY; this.scene.add(g); this.groups.push(g); return g; }

  // ---------------- ground: snow worked into mud, ruts and tyre tracks, puddles that hold the sky, spoil heaps, a slab
  ground({ size = 1600, tile = 64, seed = 5, snow = .62, slab = [64, 56] } = {}) {
    const R = rng(seed), S = 2048, c = cv(S, S), g = c.getContext('2d');
    g.fillStyle = '#e4e3de'; g.fillRect(0, 0, S, S);
    // trodden mud and slush patches
    for (let i = 0; i < 260; i++) { const x = R() * S, y = R() * S, r = 20 + R() * 160, gr = g.createRadialGradient(x, y, 0, x, y, r), mud = R() < 1 - snow;
      gr.addColorStop(0, mud ? `rgba(${70 + R() * 30 | 0},${58 + R() * 20 | 0},${46 + R() * 14 | 0},${.45 + R() * .35})` : `rgba(240,240,238,${.3 + R() * .4})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    for (let i = 0; i < 40000; i++) { const v = 150 + R() * 100; g.fillStyle = `rgba(${v},${v - 2},${v - 6},${.05 + R() * .12})`; g.fillRect(R() * S, R() * S, 1 + R() * 3, 1 + R() * 2); }
    for (let i = 0; i < 9000; i++) { const v = 50 + R() * 50; g.fillStyle = `rgba(${v},${v - 6},${v - 12},${.1 + R() * .3})`; g.fillRect(R() * S, R() * S, 1 + R() * 2, 1 + R() * 2); }   // grit
    // ruts: pairs of dark wet tracks curving through
    g.lineCap = 'round';
    for (let k = 0; k < 4; k++) { const y0 = R() * S, a = (R() - .5) * 300, b = (R() - .5) * 300; for (const off of [0, 38]) { g.strokeStyle = `rgba(60,50,40,${.12 + R() * .12})`; g.lineWidth = 7 + R() * 5; g.beginPath(); g.moveTo(-20, y0 + off); g.bezierCurveTo(S * .33, y0 + a + off, S * .66, y0 + b + off, S + 20, y0 + off + (R() - .5) * 200); g.stroke();
      g.strokeStyle = 'rgba(25,22,20,.12)'; g.lineWidth = 2; g.stroke(); } }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(size / tile, size / tile); t.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({ map: t, roughness: .9, envMapIntensity: .6 });
    // break the tiling with a large-scale patch noise (world space), and a little sky sheen where it is wet
    mat.onBeforeCompile = sh => { sh.uniforms.uMot = { value: mottleTexture() };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPg;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPg = (modelMatrix * vec4(transformed, 1.)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPg; uniform sampler2D uMot;').replace('#include <map_fragment>', `#include <map_fragment>
        { vec4 a = texture2D(uMot, vWPg.xz / 420.), b = texture2D(uMot, vWPg.xz / 97. + .3); float m = smoothstep(.42, .7, a.r * .7 + b.b * .3);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(.55, .5, .45), m * .75); diffuseColor.rgb *= .9 + .2 * b.g; }`); };
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat); m.rotation.x = -Math.PI / 2; m.receiveShadow = true; m.name = 'ground'; this.scene.add(m);
    // the slab the giant is built on: concrete, stained, with its cribbing pads
    if (slab) { const B = new Batch({ seed: 3 }); B.push('concrete', cbox(slab[0], .6, slab[1], .1), new THREE.Matrix4().makeTranslation(0, -.25, 0), { wear: .3, aoConst: .95, plate: [slab[0], slab[1]] }); this.add(B, 'slab'); }
    return m;
  }
  // the giant's own footprints: pressed into the snow down to the mud, grouser bars printed across, a rim of thrown snow
  footprints(list) {
    if (!this._fpTex) { const c = cv(256, 512), g = c.getContext('2d'), R = rng(77); g.clearRect(0, 0, 256, 512);
      g.fillStyle = 'rgba(232,232,228,.55)'; g.fillRect(6, 6, 244, 500); g.fillStyle = 'rgba(62,52,42,.92)'; g.fillRect(18, 22, 220, 470);
      for (let k = 0; k < 11; k++) { g.fillStyle = 'rgba(30,26,22,.8)'; g.fillRect(20, 40 + k * 41, 216, 12); g.fillStyle = 'rgba(150,140,128,.35)'; g.fillRect(20, 52 + k * 41, 216, 4); }
      for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(${200 + R() * 50 | 0},${200 + R() * 50 | 0},${200 + R() * 50 | 0},${R() * .4})`; g.fillRect(18 + R() * 220, 22 + R() * 470, 1 + R() * 4, 1 + R() * 3); }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; this._fpTex = t; }
    const mat = new THREE.MeshStandardMaterial({ map: this._fpTex, transparent: true, roughness: .8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const [x, z, yaw] of list) { const m = new THREE.Mesh(new THREE.PlaneGeometry(8.2, 14.2), mat); m.rotation.set(-Math.PI / 2, 0, yaw || 0); m.position.set(x, .03, z); m.receiveShadow = true; this.scene.add(m); }
  }
  // a puddle: low roughness, dark, holds the sky
  puddle(x, z, rx, rz, rot = 0) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(1, 28), new THREE.MeshStandardMaterial({ color: C('#3a3a38'), roughness: .06, metalness: .1, envMapIntensity: 1.2 })); m.scale.set(rx, rz, 1); m.rotation.set(-Math.PI / 2, 0, rot); m.position.set(x, .04, z); m.receiveShadow = true; this.scene.add(m); return m;
  }
  // spoil heap: a lumpy mound with snow on its top
  spoil(x, z, r, h, seed = 1) {
    const R = rng(seed), g = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const k = .82 + R() * .3; p.setXYZ(i, p.getX(i) * r * k, p.getY(i) * h * (.85 + R() * .25), p.getZ(i) * r * k); }
    g.computeVertexNormals(); const B = new Batch(); B.push('concrete', g, new THREE.Matrix4().makeTranslation(x, 0, z), { wear: 0, aoConst: .9, edge: false });
    const M2 = { concrete: stackMaterial(this.U, { coat: '#5a4c3e', primer: '#5a4c3e', rivets: 0, rustAmt: 0, rough: .97, metal: 0, tone: .6 }) };
    const gr = B.build(M2, { name: 'spoil' }); this.scene.add(gr); return gr;
  }
  // ---------------- timber
  // a crib: alternating layers of square timbers (h layers), w x d plan
  crib(x, z, w, d, h, { size = .35, rotY = 0, M = 'timber', y = 0 } = {}) {
    const B = new Batch({ seed: (this.R() * 1e6) | 0 }), n = Math.round(h / size);
    for (let i = 0; i < n; i++) { const yy = y + size / 2 + i * size, along = i % 2 === 0, len = along ? w : d, cnt = Math.max(2, Math.round((along ? d : w) / (size * 2.2)));
      for (let k = 0; k < cnt; k++) { const o = lerp(-(along ? d : w) / 2 + size / 2, (along ? d : w) / 2 - size / 2, cnt > 1 ? k / (cnt - 1) : .5);
        const m = new THREE.Matrix4().makeTranslation(along ? 0 : o, yy, along ? o : 0); B.push(M, cbox(along ? len : size, size * .96, along ? size : len, .02), m, { wear: .4, aoConst: .85 }); } }
    return this.add(B, 'crib', V3(x, 0, z), rotY);
  }
  // a timber trestle tower (falsework): four posts, sills, cross bracing every lift, a cap with wedges
  trestle(x, z, h, { w = 4, d = 4, rotY = 0, lift = 3, thr = null } = {}) {
    const B = new Batch({ seed: (this.R() * 1e6) | 0 }), P = (sx, sz, y) => V3(sx * w / 2, y, sz * d / 2), C4 = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [sx, sz] of C4) { const { m, L } = along(P(sx, sz, 0), P(sx, sz, h), V3(0, 0, 1)); B.push('timber', cbox(.36, L, .36, .03), m, { wear: .4, aoConst: .85 }); }
    for (let y = 0; y <= h + .01; y += lift) for (let j = 0; j < 4; j++) { const a = C4[j], b = C4[(j + 1) % 4]; const { m, L } = along(P(a[0], a[1], Math.min(y, h)), P(b[0], b[1], Math.min(y, h)), V3(0, 1, 0)); B.push('timberDk', cbox(.22, L + .5, .3, .02), m, { wear: .3, aoConst: .8 }); }
    for (let y = 0; y < h - .1; y += lift) for (let j = 0; j < 4; j++) { const a = C4[j], b = C4[(j + 1) % 4]; const y1 = Math.min(y + lift, h); const { m, L } = along(P(a[0], a[1], y), P(b[0], b[1], y1), V3(0, 1, 0)); B.push('timberDk', cbox(.18, L, .08, .01), m, { wear: .3, aoConst: .8 }); }
    B.push('timber', cbox(w + 1, .5, d + 1, .04), new THREE.Matrix4().makeTranslation(0, h + .25, 0), { wear: .5, aoConst: .9 });
    return this.add(B, 'trestle', V3(x, 0, z), rotY);
  }
  // ---------------- tube scaffold round a rectangle: standards, ledgers, braces, planked lifts with toe boards and rails
  scaffold(x, z, halfW, halfD, h, { bay = 2.4, lift = 2.0, faces = 'fblr', planks = 2, rotY = 0, sheet = .12, seed = 2 } = {}) {
    const B = new Batch({ seed }), R = rng(seed), T = (A, Bp, r) => { const { m, L } = along(A, Bp, V3(0, 0, 1)); B.push('tube', cyl(r, L, 6), m, { wear: .3, edge: false, aoConst: .9, noLift: true }); };
    const F = { f: [V3(-halfW, 0, halfD), V3(halfW, 0, halfD), V3(0, 0, 1)], b: [V3(halfW, 0, -halfD), V3(-halfW, 0, -halfD), V3(0, 0, -1)], l: [V3(halfW, 0, halfD), V3(halfW, 0, -halfD), V3(1, 0, 0)], r: [V3(-halfW, 0, -halfD), V3(-halfW, 0, halfD), V3(-1, 0, 0)] };
    const depth = 1.3;
    for (const f of faces) { const [A, Bp, n] = F[f], L = A.distanceTo(Bp), nb = Math.max(1, Math.round(L / bay)), nl = Math.floor(h / lift), dir = Bp.clone().sub(A).normalize();
      for (let i = 0; i <= nb; i++) { const p = A.clone().addScaledVector(dir, i * L / nb); for (const o of [0, depth]) T(p.clone().addScaledVector(n, o), p.clone().addScaledVector(n, o).add(V3(0, nl * lift + 1, 0)), .06); }
      for (let j = 1; j <= nl; j++) { const y = j * lift; for (const o of [0, depth]) T(A.clone().addScaledVector(n, o).add(V3(0, y, 0)), Bp.clone().addScaledVector(n, o).add(V3(0, y, 0)), .055);
        for (const hh of [1.0, .5]) T(A.clone().addScaledVector(n, depth).add(V3(0, y + hh, 0)), Bp.clone().addScaledVector(n, depth).add(V3(0, y + hh, 0)), .045);
        for (let i = 0; i <= nb; i++) { const p = A.clone().addScaledVector(dir, i * L / nb).add(V3(0, y, 0)); T(p, p.clone().addScaledVector(n, depth), .05); }
        if (j % planks === 0) for (let i = 0; i < nb; i++) { const p = A.clone().addScaledVector(dir, (i + .5) * L / nb).addScaledVector(n, depth / 2).add(V3(0, y + .06, 0)), mm = new THREE.Matrix4().makeBasis(dir, V3(0, 1, 0), new THREE.Vector3().crossVectors(dir, V3(0, 1, 0))); mm.setPosition(p); if (R() > .07) B.push('timber', cbox(L / nb - .05, .06, depth - .1, .01), mm, { wear: .6, aoConst: .9, noLift: true }); }
        if (R() < sheet) for (let i = 0; i < nb; i++) if (R() < .5) { const p = A.clone().addScaledVector(dir, (i + .5) * L / nb).addScaledVector(n, depth + .05).add(V3(0, y - lift / 2, 0)), mm = new THREE.Matrix4().makeBasis(dir, V3(0, 1, 0), n); mm.setPosition(p); B.push('tarp', cbox(L / nb, lift * .95, .02, .005), mm, { wear: 0, aoConst: .9, noLift: true }); } }
      for (let i = 0; i < nb; i += 2) for (let j = 0; j < nl; j += 1) { const p0 = A.clone().addScaledVector(dir, i * L / nb).add(V3(0, j * lift, 0)), p1 = A.clone().addScaledVector(dir, Math.min(nb, i + 1) * L / nb).add(V3(0, (j + 1) * lift, 0)); T(p0, p1, .045); }
    }
    return this.add(B, 'scaffold', V3(x, 0, z), rotY);
  }
  // ---------------- cranes
  // a tower crane: lattice mast (angle chords, lacing), slewing jib and counter-jib, cab, A-frame with pendants, trolley and hook.
  // returns { g, setHook(worldTarget) -> aims the jib, runs the trolley, drops the hook to the target }
  towerCrane(x, z, { h = 80, jib = 60, back = 20, mat = 'craneY', rotY = 0 } = {}) {
    const g = new THREE.Group(); g.position.set(x, 0, z); this.scene.add(g); const R = this.R;
    const B = new Batch({ seed: (R() * 1e6) | 0 }), hs = 1.1, n = Math.round(h / 3.4), C4 = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [sx, sz] of C4) angleMember(B, V3(sx * hs, 0, sz * hs), V3(sx * hs, h, sz * hs), V3(-sx, 0, 0), V3(0, 0, -sz), { a: .22, t: .03, sys: mat, noLift: true, wear: .4 });
    for (let i = 0; i < n; i++) { const y0 = i * h / n, y1 = (i + 1) * h / n; for (let j = 0; j < 4; j++) { const a = C4[j], b = C4[(j + 1) % 4], fn = V3((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2).normalize(); flatBar(B, V3(a[0] * hs, y0, a[1] * hs), V3(b[0] * hs, y1, b[1] * hs), fn, { w: .12, t: .03, sys: mat, noLift: true, wear: .3 }); flatBar(B, V3(a[0] * hs, y1, a[1] * hs), V3(b[0] * hs, y1, b[1] * hs), fn, { w: .1, t: .03, sys: mat, noLift: true, wear: .3 }); } }
    B.push('concrete', cbox(6, 1.4, 6, .1), new THREE.Matrix4().makeTranslation(0, .7, 0), { aoConst: .9, noLift: true });
    for (let k = 0; k < 4; k++) B.push('concrete', cbox(2.2, 1.6, 4.4, .1), new THREE.Matrix4().makeTranslation(0, 2.2 + k * 1.65, 0), { aoConst: .85, noLift: true });
    g.add(B.build(this.M, { name: 'craneMast' }));
    const slew = new THREE.Group(); slew.position.y = h; g.add(slew);
    const J = new Batch({ seed: 2 }), jh = 2.2;
    const top = x0 => V3(x0, jh * (1 - x0 / jib * .5), 0);
    const nj = Math.round(jib / 3);
    for (let i = 0; i < nj; i++) { const xa = i * jib / nj, xb = (i + 1) * jib / nj; for (const s of [-1, 1]) { angleMember(J, V3(xa, 0, s * 1), V3(xb, 0, s * 1), V3(0, 1, 0), V3(0, 0, -s), { a: .16, t: .03, sys: mat, noLift: true }); flatBar(J, V3(xa, 0, s), top(xb), V3(0, 0, s), { w: .1, t: .03, sys: mat, noLift: true }); flatBar(J, top(xa), V3(xb, 0, s), V3(0, 0, s), { w: .1, t: .03, sys: mat, noLift: true }); }
      angleMember(J, top(xa), top(xb), V3(0, -1, 0), V3(0, 0, 1), { a: .16, t: .03, sys: mat, noLift: true }); flatBar(J, V3(xb, 0, -1), V3(xb, 0, 1), V3(0, 1, 0), { w: .1, t: .03, sys: mat, noLift: true }); }
    for (let i = 0; i < 6; i++) { const xa = -i * back / 6, xb = -(i + 1) * back / 6; for (const s of [-1, 1]) angleMember(J, V3(xa, 0, s * 1.3), V3(xb, 0, s * 1.3), V3(0, 1, 0), V3(0, 0, -s), { a: .2, t: .03, sys: mat, noLift: true }); flatBar(J, V3(xb, 0, -1.3), V3(xb, 0, 1.3), V3(0, 1, 0), { w: .12, t: .03, sys: mat, noLift: true }); }
    J.push('grating', cbox(back, .08, 2.4, .01), new THREE.Matrix4().makeTranslation(-back / 2, .1, 0), { noLift: true, aoConst: .9 });
    for (let k = 0; k < 4; k++) J.push('concrete', cbox(2, 3.2, 2.6, .1), new THREE.Matrix4().makeTranslation(-back + 1.4 + k * 2.15, -1.2, 0), { noLift: true, aoConst: .85 });
    for (const s of [-1, 1]) { flatBar(J, V3(0, 0, s * 1), V3(0, 10, 0), V3(0, 0, s), { w: .3, t: .2, sys: mat, noLift: true }); }
    J.push('crane', cyl(.04, Math.hypot(jib * .62, 10), 4), (() => { const { m } = along(V3(0, 10, 0), V3(jib * .62, top(jib * .62).y, 0)); return m; })(), { noLift: true, edge: false });
    J.push('crane', cyl(.04, Math.hypot(back, 10), 4), (() => { const { m } = along(V3(0, 10, 0), V3(-back, 0, 0)); return m; })(), { noLift: true, edge: false });
    J.push('crane', cbox(2.6, 2.8, 2.6, .1), new THREE.Matrix4().makeTranslation(1.6, -1.8, 2.2), { noLift: true });
    J.push('glassY', cbox(2.2, 1.2, .06, .01), new THREE.Matrix4().makeTranslation(1.6, -1.6, 3.52), { noLift: true, edge: false });
    slew.add(J.build(this.M, { name: 'craneJib' }));
    // trolley, hoist ropes, hook block
    const trolley = new THREE.Mesh(cbox(2, .7, 2.2, .1), this.M.crane); trolley.castShadow = true; slew.add(trolley);
    const rope = new THREE.Mesh(cyl(.035, 1, 4), new THREE.MeshStandardMaterial({ color: C('#1b1b1b'), roughness: .6 })), rope2 = rope.clone(); rope.castShadow = rope2.castShadow = true; g.add(rope, rope2);
    const block = new THREE.Mesh(cbox(1.2, 1.8, .8, .1), this.M.craneY); block.castShadow = true; g.add(block);
 const Cr = { g, slew, trolley, rope, rope2, block, h, jib, back, rotY };
    Cr.setHook = (target, { swing = null } = {}) => {   // target: world point the hook block should hang at
      const loc = target.clone().sub(g.position); const ang = swing ?? Math.atan2(-loc.z, loc.x); slew.rotation.y = ang;
      const r = clamp(Math.hypot(loc.x, loc.z), 4, jib - 1); trolley.position.set(r, -.6, 0); g.updateMatrixWorld(true);
      const tw = trolley.getWorldPosition(V3()).sub(g.position), hookY = Math.min(target.y + 1, h - 3), drop = h - .9 - hookY;
      for (const [rp, o] of [[rope, -.25], [rope2, .25]]) { rp.position.set(tw.x + o * Math.cos(ang + Math.PI / 2), h - .9 - drop / 2, tw.z - o * Math.sin(ang + Math.PI / 2)); rp.scale.set(1, Math.max(.1, drop), 1); }
      block.position.set(tw.x, hookY - .9, tw.z); block.rotation.y = ang; return block.getWorldPosition(V3()).add(g.position.clone().multiplyScalar(0));
    };
    Cr.setHook(V3(x + jib * .5, h * .5, z)); slew.rotation.y = rotY; this.cranes.push(Cr); return Cr;
  }
  // a crawler crane: tracks, body with its counterweight, a luffed lattice boom, the rope to the hook
  crawler(x, z, { boom = 54, luff = 62, rotY = 0, mat = 'craneY' } = {}) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rotY; this.scene.add(g); const B = new Batch({ seed: 5 });
    for (const s of [-1, 1]) { B.push('crane', cbox(1.4, 1.4, 9, .3), new THREE.Matrix4().makeTranslation(s * 2.6, .7, 0), { noLift: true, wear: 1 }); for (let k = 0; k < 18; k++) B.push('mill', cbox(1.5, .12, .3, .02), new THREE.Matrix4().makeTranslation(s * 2.6, 1.42, -4.3 + k * .5), { noLift: true, wear: 1 }); }
    B.push(mat, cbox(4.4, 2.6, 6, .2), new THREE.Matrix4().makeTranslation(0, 2.9, -.6), { noLift: true, wear: .8 });
    B.push('crane', cbox(4.2, 2.2, 1.8, .2), new THREE.Matrix4().makeTranslation(0, 2.6, -4.2), { noLift: true, wear: .5 });
    B.push(mat, cbox(1.6, 2.2, 1.8, .1), new THREE.Matrix4().makeTranslation(-1.6, 4.9, 1.6), { noLift: true }); B.push('glassY', cbox(1.4, 1.0, .05, .01), new THREE.Matrix4().makeTranslation(-1.6, 5.2, 2.52), { noLift: true, edge: false });
    const a = luff * Math.PI / 180, foot = V3(0, 3.6, 1.8), tip = foot.clone().add(V3(0, Math.sin(a) * boom, Math.cos(a) * boom)), w0 = 1.0, n = Math.round(boom / 2.6);
    const ax = V3(0, Math.sin(a), Math.cos(a)), side = V3(1, 0, 0), up = new THREE.Vector3().crossVectors(ax, side).normalize().negate();
    for (const sx of [-1, 1]) for (const su of [-1, 1]) angleMember(B, foot.clone().addScaledVector(side, sx * w0 * 1.4).addScaledVector(up, su * w0), tip.clone().addScaledVector(side, sx * w0 * .4).addScaledVector(up, su * w0 * .4), side.clone().multiplyScalar(-sx), up.clone().multiplyScalar(-su), { a: .18, t: .03, sys: mat, noLift: true });
    for (let i = 0; i < n; i++) { const p0 = foot.clone().lerp(tip, i / n), p1 = foot.clone().lerp(tip, (i + 1) / n), k0 = lerp(1.4, .4, i / n), k1 = lerp(1.4, .4, (i + 1) / n);
      for (const su of [-1, 1]) flatBar(B, p0.clone().addScaledVector(side, -k0 * w0).addScaledVector(up, su * w0 * lerp(1, .4, i / n)), p1.clone().addScaledVector(side, k1 * w0).addScaledVector(up, su * w0 * lerp(1, .4, (i + 1) / n)), up.clone().multiplyScalar(su), { w: .09, t: .03, sys: mat, noLift: true });
      for (const sx of [-1, 1]) flatBar(B, p0.clone().addScaledVector(side, sx * k0 * w0).addScaledVector(up, -w0 * lerp(1, .4, i / n)), p1.clone().addScaledVector(side, sx * k1 * w0).addScaledVector(up, w0 * lerp(1, .4, (i + 1) / n)), side.clone().multiplyScalar(sx), { w: .09, t: .03, sys: mat, noLift: true }); }
    const mast = V3(0, 9, -3.6); B.push('crane', cyl(.04, mast.distanceTo(tip), 4), along(mast, tip).m, { noLift: true, edge: false }); B.push('crane', cyl(.06, mast.distanceTo(V3(0, 4, -4)), 4), along(V3(0, 4, -4), mast).m, { noLift: true, edge: false });
    g.add(B.build(this.M, { name: 'crawler' }));
    const rope = new THREE.Mesh(cyl(.04, 1, 4), new THREE.MeshStandardMaterial({ color: C('#1b1b1b'), roughness: .6 })); rope.castShadow = true; g.add(rope); const block = new THREE.Mesh(cbox(.9, 1.4, .6, .1), this.M.craneY); block.castShadow = true; g.add(block);
    const Cc = { g, tip, setDrop: d => { rope.position.set(tip.x, tip.y - d / 2, tip.z); rope.scale.set(1, d, 1); block.position.set(tip.x, tip.y - d - .7, tip.z); } }; Cc.setDrop(tip.y * .6); return Cc;
  }
  // ---------------- vehicles and stock
  truck(x, z, rotY = 0, { kind = 'flatbed', col = 'truck', load = null, lights = false } = {}) {
    const B = new Batch({ seed: (this.R() * 1e6) | 0 }), wheel = (wx, wz, r = .55) => { B.push('rubber', cylX(r, .5, 14), new THREE.Matrix4().makeTranslation(wx, r, wz), { noLift: true, edge: false }); B.push('mill', cylX(r * .55, .52, 10), new THREE.Matrix4().makeTranslation(wx, r, wz), { noLift: true, edge: false }); };
    B.push(col, cbox(2.5, 2.4, 2.3, .15), new THREE.Matrix4().makeTranslation(0, 2.1, 5.2), { noLift: true, wear: 1 });
    B.push('glassY', cbox(2.2, 1.0, .06, .01), new THREE.Matrix4().makeTranslation(0, 2.6, 6.37), { noLift: true, edge: false });
    B.push(col, cbox(2.5, 1.0, 1.4, .15), new THREE.Matrix4().makeTranslation(0, 1.4, 6.9), { noLift: true, wear: 1 });
    B.push('mill', cbox(1.0, .9, .3, .05), new THREE.Matrix4().makeTranslation(0, 1.25, 7.65), { noLift: true });
    B.push('mill', cbox(1.2, .3, 11, .05), new THREE.Matrix4().makeTranslation(0, .95, 0), { noLift: true });
    for (const s of [-1, 1]) { wheel(s * 1.05, 6.2); wheel(s * 1.05, 4.0); wheel(s * 1.05, -2.2); wheel(s * 1.05, -3.6); }
    if (kind === 'flatbed') B.push('crane', cbox(2.5, .3, 8, .05), new THREE.Matrix4().makeTranslation(0, 1.3, -1.2), { noLift: true, wear: 1 });
    if (kind === 'tipper') { B.push(col, cbox(2.5, 1.6, 6, .1), new THREE.Matrix4().makeTranslation(0, 2.2, -1.0), { noLift: true, wear: 1.4 }); B.push('concrete', cbox(2.2, .8, 5.6, .3), new THREE.Matrix4().makeTranslation(0, 3.2, -1.0), { noLift: true }); }
    if (lights) for (const s of [-1, 1]) B.push('lampY', new THREE.CircleGeometry(.14, 10), new THREE.Matrix4().makeTranslation(s * .9, 1.5, 7.62), { noLift: true, edge: false });
    const g = this.add(B, 'truck', V3(x, 0, z), rotY);
    if (load === 'plates') { const L = new Batch(); for (let k = 0; k < 5; k++) L.push(k % 2 ? 'primer' : 'plate', cbox(2.2, .2, 6, .05), new THREE.Matrix4().makeTranslation(0, 1.55 + k * .21, -1.2), { noLift: true, paint: k % 2 ? 9 : -1, plate: [2.2, 6] }); g.add(L.build(this.M, { name: 'load' })); }
    if (load === 'girder') { const L = new Batch(); iBeam(L, V3(0, 2.4, -6.5), V3(0, 2.4, 4.0), V3(0, 1, 0), { h: 1.6, b: .7, sys: 'primer', paint: 9, wear: .3, noLift: true }); g.add(L.build(this.M, { name: 'load' })); }
    return g;
  }
  plateStack(x, z, n = 6, rotY = 0) { const B = new Batch({ seed: (this.R() * 1e6) | 0 }); for (let k = 0; k < n; k++) B.push(this.R() < .5 ? 'primer' : 'plate', cbox(3.2, .18, 6.2, .04), new THREE.Matrix4().makeTranslation((this.R() - .5) * .2, .3 + k * .2, 0).multiply(new THREE.Matrix4().makeRotationY((this.R() - .5) * .06)), { noLift: true, paint: this.R() < .5 ? 9 : -1, plate: [3.2, 6.2] });
    for (const zz of [-2, 2]) B.push('timber', cbox(3.6, .25, .3, .02), new THREE.Matrix4().makeTranslation(0, .12, zz), { noLift: true }); return this.add(B, 'plates', V3(x, 0, z), rotY); }
  girderStack(x, z, n = 4, len = 16, rotY = 0) { const B = new Batch({ seed: (this.R() * 1e6) | 0 }); for (let k = 0; k < n; k++) iBeam(B, V3(-len / 2, .9 + Math.floor(k / 2) * 1.4, (k % 2 - .5) * 1.2), V3(len / 2, .9 + Math.floor(k / 2) * 1.4, (k % 2 - .5) * 1.2), V3(0, 1, 0), { h: 1.2, b: .6, sys: 'primer', paint: 9, wear: .3, noLift: true });
    for (const xx of [-len / 3, len / 3]) B.push('timber', cbox(.3, .25, 3, .02), new THREE.Matrix4().makeTranslation(xx, .12, 0), { noLift: true }); return this.add(B, 'girders', V3(x, 0, z), rotY); }
  hut(x, z, rotY = 0, { lit = true } = {}) { const B = new Batch({ seed: 4 }); B.push('tarp', cbox(6, 2.8, 2.6, .05), new THREE.Matrix4().makeTranslation(0, 1.6, 0), { noLift: true, wear: .5 }); B.push('crane', cbox(6.3, .18, 2.9, .03), new THREE.Matrix4().makeTranslation(0, 3.1, 0), { noLift: true });
    if (lit) B.push('lampY', new THREE.PlaneGeometry(1.2, .8), new THREE.Matrix4().makeTranslation(-1.2, 1.9, 1.32), { noLift: true, edge: false }); for (const xx of [-2.4, 2.4]) B.push('timber', cbox(.3, .4, 2.6, .02), new THREE.Matrix4().makeTranslation(xx, .2, 0), { noLift: true }); return this.add(B, 'hut', V3(x, 0, z), rotY); }
  lightTower(x, z, h = 16, rotY = 0) { const B = new Batch({ seed: 6 }); B.push('crane', cyl(.18, h, 8), new THREE.Matrix4().makeTranslation(0, h / 2, 0), { noLift: true, edge: false }); B.push('crane', cbox(3, .2, .4, .02), new THREE.Matrix4().makeTranslation(0, h, 0), { noLift: true });
    for (const xx of [-1.1, -.37, .37, 1.1]) { B.push('mill', cbox(.6, .5, .3, .03), new THREE.Matrix4().makeTranslation(xx, h + .4, .1), { noLift: true }); B.push('lampY', new THREE.CircleGeometry(.22, 10), new THREE.Matrix4().makeTranslation(xx, h + .4, .27), { noLift: true, edge: false }); }
    B.push('craneY', cbox(1.6, 1.2, 2.4, .1), new THREE.Matrix4().makeTranslation(0, .6, 0), { noLift: true }); return this.add(B, 'lighttower', V3(x, 0, z), rotY); }
  drums(x, z, n = 5) { const B = new Batch({ seed: 8 }); for (let k = 0; k < n; k++) B.push(this.R() < .5 ? 'truck2' : 'truck', cyl(.3, .9, 12), new THREE.Matrix4().makeTranslation((k % 3) * .65, .45, Math.floor(k / 3) * .65), { noLift: true, wear: 1.2, edge: false }); return this.add(B, 'drums', V3(x, 0, z)); }
  // ---------------- distant works: furnace towers, stacks, sheds, a gas holder, in the haze; smoke from the stacks
  works({ z = -420, span = 1300, seed = 8, n = 46, smoke = true } = {}) {
    const R = rng(seed), B = new Batch({ seed }), M2 = { far: stackMaterial(this.U, { coat: '#2e2d2b', primer: '#2e2d2b', rivets: 0, rustAmt: 0, wear: 0, grime: .3, tone: .3, env: .3, name: 'far' }) };
    for (let i = 0; i < n; i++) { const x = (R() - .5) * span, zz = z - R() * 300, k = R(), w = 10 + R() * 34, h = 16 + R() * 60;
      if (k < .25) { B.push('far', cyl(w * .06, h * 2.2, 10, w * .09), new THREE.Matrix4().makeTranslation(x, h * 1.1, zz), { noLift: true, edge: false }); if (smoke && R() < .7) this.plumes.push(new Plume(this.scene, V3(x, h * 2.2, zz), { n: 14, h: 160, w: 22, wind: [1.2, 0, .2], op: .32, rate: .2, col: '#c9c3b8', shade: '#6f6a64', seed: i })); }
      else if (k < .55) B.push('far', cbox(w * 1.8, h * .55, 30, .5), new THREE.Matrix4().makeTranslation(x, h * .27, zz), { noLift: true });
      else if (k < .7) { B.push('far', cyl(w * .32, h * 1.1, 14, w * .38), new THREE.Matrix4().makeTranslation(x, h * .55, zz), { noLift: true, edge: false }); B.push('far', cyl(w * .18, h * .6, 10), new THREE.Matrix4().makeTranslation(x, h * 1.4, zz), { noLift: true, edge: false }); }
      else if (k < .82) { const hh = h * 1.6; latticeColumn(B, { y0: hh, h: hh, top: [6, 6], bot: [12, 12], cx: x, cz: zz, a: .5, t: .1, panel: 6, lace: .4, sys: 'far', diaph: false, battenEvery: 0 }); }
      else B.push('far', cyl(w * .7, h * .7, 24), new THREE.Matrix4().makeTranslation(x, h * .35, zz), { noLift: true, edge: false }); }
    const g = B.build(M2, { name: 'works', shadow: false }); this.scene.add(g); return g;
  }
  // a new steel column (built-up lattice, in red lead) with its cap plate, a landing for the connecting crew and a ladder
  column(x, z, h, { w = 2.2 } = {}) {
    const B = new Batch({ seed: (this.R() * 1e6) | 0 });
    latticeColumn(B, { y0: h, h, top: [w, w], bot: [w, w], a: .32, t: .04, panel: 1.8, lace: .18, laceT: .03, sys: 'primer', battenEvery: 3, wear: .2, gusset: [.5, .6] });
    B.push('primer', cbox(w + 1.2, .25, w + 1.2, .03), new THREE.Matrix4().makeTranslation(0, h + .12, 0), { paint: 9, plate: [w + 1.2, w + 1.2], plateAxes: 'xz' });
    B.push('concrete', cbox(w + 2, 1, w + 2, .1), new THREE.Matrix4().makeTranslation(0, .5, 0), {});
    B.push('grating', cbox(w + 2.4, .08, 1.4, .01), new THREE.Matrix4().makeTranslation(0, h - 1.4, -w / 2 - .8), {});
    for (const y of [h - .3, h - .85]) B.push('rail', cyl(.03, w + 2.4, 6).rotateZ(Math.PI / 2), new THREE.Matrix4().makeTranslation(0, y, -w / 2 - 1.45), { edge: false });
    const g = this.add(B, 'column', V3(x, 0, z)); return g;
  }
  // people near a ground hit turn toward it, each after their own beat (a crowd at the foot of something that big reacts)
  reactTo(t0, x, z, { radius = 55, seed = 3 } = {}) {
    const R = rng(seed); for (const q of this.people || []) { const d = Math.hypot(q.st.x - x, q.st.z - z); if (d > radius || q.walk) continue; q.react = { t0: t0 + .25 + R() * .6 + d / 340, h0: q.st.heading, h1: Math.atan2(x - q.st.x, z - q.st.z) }; }
    this.anim.push(t => { for (const q of this.people || []) { const r = q.react; if (!r) continue; const u = Math.max(0, Math.min(1, (t - r.t0) / .7)), e = u * u * (3 - 2 * u); let dh = r.h1 - r.h0; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); q.st.heading = r.h0 + dh * e; } });
  }
  // (c5) people react with the BODY to a ground hit at (x, z): the jolt arrives at ~300 m/s through the ground, each person reacts
  // 0.12-0.4 s later; within `near` m they brace (hips drop, knees and trunk flex), a share step back a pace or two on the walk
  // cycle run backwards, some throw a forearm up to the face, and everyone turns toward it (head first, then the body); it all
  // eases off after ~2 s. Farther out (to `radius`) only the head and body turn, later, as reactTo. Walkers stop and look.
  startle(t0, x, z, { radius = 90, near = 28, seed = 5, steps = .55 } = {}) {
    const R = rng(seed);
    for (const q of this.people || []) { const st = q.st, d = Math.hypot(st.x - x, st.z - z); if (d > radius) continue;
      const k = clamp(1 - (d - 6) / (near * 1.4)), away = Math.atan2(st.x - x, st.z - z);
      q.st._s = { tr: t0 + d / 300 + .12 + R() * .28, k, ax: Math.sin(away), az: Math.cos(away), face: Math.atan2(x - st.x, z - st.z), h0: st.heading,
        step: d < near && R() < steps ? (.5 + R() * .7) * k : 0, guard: d < near && R() < .45 ? (R() < .5 ? 1 : -1) : 0, crouch: .5 + .5 * R(), x0: st.x0 ?? st.x, z0: st.z0 ?? st.z, walk: q.walk, act: st.act };
      if (!st.pose) st.pose = (out, s2, API) => { const b = s2._sb || 0; if (b <= 0) return; const { NB, B, ARM, LEG } = API;
        out[NB * 3 + 1] -= .11 * b; out[B.spine * 3] += .16 * b; out[B.chest * 3] += .22 * b; out[B.head * 3] -= .12 * b;
        for (const sd of [1, -1]) { const [th, sh, ft] = LEG(sd); out[th * 3] -= .42 * b; out[sh * 3] += .78 * b; out[ft * 3] -= .36 * b; out[th * 3 + 2] += sd * .06 * b; const [ua, fa] = ARM(sd); out[ua * 3 + 2] += sd * .25 * b; out[fa * 3] -= .3 * b; }
        const g = s2._sg || 0; if (g) { const [ua, fa, hn] = ARM(g > 0 ? 1 : -1), a = Math.abs(g); out[ua * 3] -= 1.55 * a; out[ua * 3 + 2] -= (g > 0 ? 1 : -1) * .2 * a; out[fa * 3] -= 1.75 * a; out[hn * 3] += .3 * a; } };
    }
    this.anim.push(t => { for (const q of this.people || []) { const st = q.st, S = st._s; if (!S) continue; const u = t - S.tr;
      if (u < 0) { st._sb = 0; st._sg = 0; continue; }
      if (S.walk) { q.walk = null; st.x0 = st.x; st.z0 = st.z; S.walk = null; st.act = 'stand'; st.t0 = st.t; }
      const off = 1 - sstep(1.7, 3.4, u), b = sstep(0, .22, u) * (.55 + .45 * S.crouch) * S.k * off;
      st._sb = b; st._sg = S.guard ? S.guard * sstep(.05, .3, u) * (1 - sstep(1.1, 2.2, u)) : 0;
      if (st.act === 'work') st.act = 'stand';
      const turn = sstep(.1, .1 + .55 + (1 - S.k) * .5, u); let dh = S.face - S.h0; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); st.heading = S.h0 + dh * turn;
      if (S.step) { const sp = sstep(.1, .9, u), w = Math.sin(Math.PI * clamp((u - .05) / .95));
        st.x = S.x0 + S.ax * S.step * sp; st.z = S.z0 + S.az * S.step * sp; st.mix = w > .02 ? { walk: w, stand: 1 - w } : null; st.ph = (st.ph0 || 0) - sp * Math.PI * 2 * S.step / .7; st.amt = .55; }
      st.look = .25 * Math.sin(Math.PI * clamp(u / .6)) * (S.k > .2 ? 1 : 0);
    } });
  }
  steam(p, o = {}) { const pl = new Plume(this.scene, p, o); this.plumes.push(pl); return pl; }
  // ---------------- people: HUMAN's workers (people.js), placed by a function (p, i, R) -> sets x, z, heading, act...
  // desc (LIGHTING c2): (i, R) -> a People.add() descriptor, e.g. HUMAN c6's workforce.workerDesc(A, R) (ANSUR bodies, a quarter
  // women, c6 clothes and wear); omitted, the c4 crowd (People.varied by trade) as before
  crowd(n, place, { viewH = 1920, trades = ['steel', 'steel', 'weld', 'overalls', 'rail', 'farm'], seed = 31, act = 'stand', desc = this.desc || null } = {}) {
    if (!this.folk) this.folk = new People(this.scene, { max: 900, viewH, budget: [30, 220] });
    const R = rng(seed), ids = [];
    for (let i = 0; i < n; i++) { const d = desc ? desc(i, R) : People.varied(trades[i % trades.length], (seed * 1000 + i) | 0), id = this.folk.add(d); const st = { x: 0, z: 0, y: 0, heading: R() * 6.28, act, t: R() * 10, ph: R() * 6 }; place(st, i, R); this.folk.set(id, st); ids.push({ id, st, walk: st.walk || null }); }
    this.people = (this.people || []).concat(ids); return ids;
  }
  update(t, camera, sunD) {
    for (const f of this.anim) f(t);
    for (const p of this.plumes) p.update(t, camera, sunD);
    // (c5) act, mix, amt, look, visible and the startle's brace/guard pass through too (people.js keeps its own copy of each person's
    // state: fields changed on q.st after crowd() were never seen before)
    if (this.folk) { for (const q of this.people) { const st = q.st; if (q.walk) { const [vx, vz] = q.walk; st.x = st.x0 + vx * t; st.z = st.z0 + vz * t; st.ph = t * 5.4 * Math.hypot(vx, vz) / 1.35 + st.ph0; } else st.t = st.t0 + t;
      this.folk.set(q.id, { x: st.x, y: st.y || 0, z: st.z, t: st.t, ph: st.ph, heading: st.heading, act: st.act || 'stand', mix: st.mix || null, amt: st.amt ?? 1, look: st.look || 0, visible: st.visible !== false, _sb: st._sb || 0, _sg: st._sg || 0 }); } this.folk.update(camera); }
  }
}
// the work: a riveted plate girder (red lead, new steel) that the giant lifts; set(centre) moves it
export class Girder {
  constructor(parent, M, { len = 25.6, depth = 2.4, flange = 1.1, mass = 240 } = {}) {
    const B = new Batch({ seed: 12 }); this.len = len; this.depth = depth; this.mass = mass; this.flange = flange;
    iBeam(B, V3(-len / 2, 0, 0), V3(len / 2, 0, 0), V3(0, 1, 0), { h: depth, b: flange, tf: .12, tw: .06, sys: 'primer', paint: 9, wear: .25, noLift: true });
    for (let k = 0; k <= 12; k++) for (const s of [-1, 1]) flatBar(B, V3(-len / 2 + .4 + k * (len - .8) / 12, -depth / 2 + .15, s * .2), V3(-len / 2 + .4 + k * (len - .8) / 12, depth / 2 - .15, s * .2), V3(0, 0, s), { w: .3, t: .05, sys: 'primer', paint: 9, wear: .2, noLift: true });
    for (const s of [-1, 1]) B.push('mill', cbox(.3, depth + .1, flange + .2, .04), new THREE.Matrix4().makeTranslation(s * len / 2, 0, 0), { noLift: true });
    this.g = B.build(M, { name: 'girder' }); parent.add(this.g);
  }
  set(c, tilt = 0) { this.g.position.copy(c); this.g.rotation.set(0, 0, tilt); this.g.updateMatrixWorld(true); }
  // (c5) the section as boxes in the world, for a hand to close on: two flanges, the web with its stiffeners, the end plates
  boxes() {
    const m = this.g.matrixWorld, q = new THREE.Quaternion(), out = []; this.g.getWorldQuaternion(q); const L = this.len / 2, d = this.depth / 2;
    for (const [c, h] of [[[0, d - .06, 0], [L, .06, this.flange / 2]], [[0, -(d - .06), 0], [L, .06, this.flange / 2]], [[0, 0, 0], [L, d - .12, .26]], [[L, 0, 0], [.15, d + .05, this.flange / 2 + .1]], [[-L, 0, 0], [.15, d + .05, this.flange / 2 + .1]]])
      out.push({ c: V3(...c).applyMatrix4(m), q, h: V3(...h) });
    return out;
  }
}
