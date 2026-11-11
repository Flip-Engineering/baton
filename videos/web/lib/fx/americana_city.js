// AMERICANA / CITY + PLANT (WORLDS studio c1)
//   Skyline    American setback towers (Ferriss, Mead) in depth rows: podium, 2-4 setbacks, crowns (pyramid, spire, flat with
//              plant), red obstruction beacons. Facades per fragment: 3.9 m floors, 1.5 m window bays, spandrels; windows lit
//              per FLOOR (office floors in bands, cleaners' floors, dark mechanical floors every ~20), warm and cool floors,
//              averaged when a bay is under a pixel (no moire, no window-dot grid).
//   Ramp       an elevated interchange ramp swept along a curve: deck, barriers, piers, LED lamps, moving car lights.
//   Water      a river: dark water, the planar reflection smeared into vertical streaks (wetMaterial with ripple).
//   Plant      an integrated mill at real heights: stacks 120-150 m, blast furnace + stoves, coke battery, BOF shop, tank
//              farm, pipe racks, conveyor galleries, flare stack, sodium catwalk lights, steam plumes lit from below. Every
//              part carries a temperature (deg C) for PRODUCTIVE's thermal read (thermalPass).
//   RailYard   ladder tracks with tank cars and hoppers under 30 m high-mast sodium towers.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ATMOS_GLSL, LF_GLSL } from './atmos3d.js';
import { rng } from './americana.js';

const TAU = Math.PI * 2;
function strip(g) { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); return g; }
const unitBox = strip(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
const unitPyr = strip(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0));
const unitCyl = strip(new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 1).translate(0, 0.5, 0));
const unitCylLo = strip(new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1).translate(0, 0.5, 0));
const unitDome = strip(new THREE.SphereGeometry(0.5, 20, 8, 0, TAU, 0, Math.PI / 2));

// ------------------------------------------------------------------ facade material (standard + lightmap + per-floor windows)
export function facadeMaterial(lf, { gain = 1, floorH = 3.9, bay = 1.5, mech = 20 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55, metalness: 0.15 });
  // the red reveal (THE LADDER): windows within uRedR metres (xz) of uRedC switch on red, a uRedW-metre front; uRedR < 0 = off (the default)
  const RED = { uRedC: { value: new THREE.Vector3() }, uRedR: { value: -1 }, uRedW: { value: 80 } };
  mat.userData.red = RED;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, lf.U, { uWG: { value: gain } }, RED);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 iseed; flat varying vec4 vSeed; varying vec3 vWP; varying vec3 vNW; varying vec3 vLoc;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 lp = vec4(transformed, 1.);
          #ifdef USE_INSTANCING
          lp = instanceMatrix * lp;
          #endif
          vWP = (modelMatrix * lp).xyz; vSeed = iseed; vLoc = transformed;
          vNW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal); }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        flat varying vec4 vSeed; varying vec3 vWP; varying vec3 vNW; varying vec3 vLoc; uniform float uWG; uniform vec3 uRedC; uniform float uRedR, uRedW;
        // vSeed is flat (5 Oct): fh() multiplies its argument by ~5e5, so the last bits NVIDIA's perspective interpolation leaves on a per-instance
        // constant flipped windows lit/dark per pixel and per frame on the farm (THE LADDER's tower face); SwiftShader carried it exactly
        ${LF_GLSL}
        float fh(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 N = normalize(vNW); float side = step(.5, abs(N.y));           // roofs: no windows
        float u = abs(N.x) > .5 ? vWP.z : vWP.x;
        float fl = floor(vWP.y / ${floorH.toFixed(2)}), fy = fract(vWP.y / ${floorH.toFixed(2)});
        float bc = floor(u / ${bay.toFixed(2)}), fx = fract(u / ${bay.toFixed(2)});
        float curtain = step(.5, vSeed.z);
        float fwU = max(fwidth(u) / ${bay.toFixed(2)}, 1e-4), fwY = max(fwidth(vWP.y) / ${floorH.toFixed(2)}, 1e-4);
        // box-filtered window edges (4 Oct, THE LADDER: hard steps shimmered as salt-and-pepper once a bay was a few pixels)
        vec4 wb = curtain > .5 ? vec4(.04, .96, .06, .94) : vec4(.14, .86, .3, .86);
        float wx = clamp((fx - wb.x) / fwU + .5, 0., 1.) - clamp((fx - wb.y) / fwU + .5, 0., 1.);
        float wy0 = clamp((fy - wb.z) / fwY + .5, 0., 1.) - clamp((fy - wb.w) / fwY + .5, 0., 1.);
        float win = clamp(wx, 0., 1.) * clamp(wy0, 0., 1.);
        float fill = curtain > .5 ? .7 : .4;
        float aa = clamp(max(fwU, fwY) * 2.2 - .2, 0., 1.);                   // from ~10 px a bay toward the floor's average; all of it by ~2 px
        win = mix(win, fill, aa);
        win *= 1. - side;
        vec3 spand = diffuseColor.rgb * (1. + .3 * (clamp(fy / fwY + .5, 0., 1.) - clamp((fy - .07) / fwY + .5, 0., 1.)) * (1. - aa));   // the slab edge, a lighter band
        diffuseColor.rgb = mix(spand, vec3(.03, .035, .04), win * (curtain > .5 ? .9 : .7));
        // occupancy: per floor, per building; mechanical floors dark; a few floors cool fluorescent
        float hf = fh(vec3(vSeed.x, fl, 1.)), hw = fh(vec3(vSeed.x, fl, bc));
        float mechF = step(mod(fl + floor(vSeed.x*7.), ${mech.toFixed(1)}), .5);
        float band = step(hf, vSeed.y) * (1. - mechF);
        float lit = band * step(hw, .82) + (1. - band) * step(hw, .03);
        lit *= step(1.5, fl);                                                  // lobby handled below
        vec3 wc = mix(vec3(1., .72, .42), vec3(.78, .9, 1.), step(.7, fh(vec3(vSeed.x, fl, 3.))));
        float rk = uRedR < 0. ? 0. : clamp((uRedR - distance(vWP.xz, uRedC.xz) - 30. * fh(vec3(vSeed.x, fl, 5.))) / uRedW, 0., 1.);
        wc = mix(wc, vec3(1., .1, .06) * 1.3, rk); lit = max(lit, rk * step(hw, .9) * step(1.5, fl) * (1. - mechF));
        float lob = (1. - step(1.5, fl)) * step(.3, fy) * (1. - side);
        // inside the glass: blinds drawn part-way on some, ceiling light falling off toward the sill (close up only; averaged away with aa)
        float wyN = clamp((fy - wb.z) / (wb.w - wb.z), 0., 1.), blindAt = fh(vec3(vSeed.x, fl, bc + 11.)) < .38 ? .35 + .5 * fh(vec3(vSeed.x, fl, bc + 13.)) : 2.;
        float inside = mix(.62, 1.18, wyN) * (wyN > blindAt ? .22 : 1.);
        // close up (aa near 0): mullions split the glass into panes, and the frame's reveal shades the glass's edges
        float wxN = clamp((fx - wb.x) / (wb.y - wb.x), 0., 1.), pw = fwU / (wb.y - wb.x), ph = fwY / (wb.w - wb.z);
        float mull = curtain > .5 ? 1. - .85 * (1. - smoothstep(.0, .035 + pw, abs(wxN - .5))) : (1. - .85 * (1. - smoothstep(.0, .03 + pw, abs(wxN - .5)))) * (1. - .85 * (1. - smoothstep(.0, .03 + ph, abs(wyN - .62))));
        float reveal = smoothstep(.0, .09, min(wxN, 1. - wxN)) * smoothstep(.0, .07, min(wyN, 1. - wyN));
        inside *= mix(mull * mix(.5, 1., reveal), 1., aa);
        vec3 fwEm = mix(wc * lit * (.3 + 1.1*hw*hw) * mix(inside, 1., aa), wc * mix(vSeed.y, .8, rk) * .45 * fill, aa);
        vec3 winEm = fwEm * win + vec3(1., .85, .6) * lob * .12 * step(.5, fh(vec3(vSeed.x, 9., bc)));
        winEm *= uWG;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += winEm;`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        { float up = clamp(N.y, 0., 1.), hf2 = exp(-max(vWP.y, 0.) / 25.);
          reflectedLight.indirectDiffuse += diffuseColor.rgb * lightAt(vWP) * mix(.5 * hf2, 1., up) / 3.14159; }`);
  };
  mat.customProgramCacheKey = () => 'facade4' + floorH + bay;
  return mat;
}

// ------------------------------------------------------------------ Skyline: towers in depth rows
// rows: [{ z0, z1, x0, x1, n, hMin, hMax, peak: { x, w } (gaussian height bump), lit, curtain }]
export class Skyline {
  constructor(world, lf, rows, { seed = 7, beacons = true, palette = ['#8c8478', '#6e6a66', '#a09080', '#5a5e66', '#7c7066', '#4a4c52'] } = {}) {
    const r = rng(seed), tiers = [], crowns = [], spires = [];
    this.rows = rows.map(() => ({ tiers: [], crowns: [], spires: [], meshes: [] }));
    rows.forEach((R, ri) => {
      const T = this.rows[ri];
      for (let i = 0; i < R.n; i++) {
        const x = R.x0 + (R.x1 - R.x0) * r(), z = R.z0 + (R.z1 - R.z0) * r();
        const pk = R.peak ? Math.exp(-(((x - R.peak.x) / R.peak.w) ** 2)) : 0;
        let H = R.hMin + (R.hMax - R.hMin) * Math.pow(r(), 1.8) * (0.4 + 0.6 * pk) + pk * (R.hMax - R.hMin) * 0.35 * r();
        H = Math.max(R.hMin, H);
        let w = 28 + r() * 30, d = 24 + r() * 26; const seedv = [r() * 100, (R.lit ?? 0.55) * (0.6 + 0.8 * r()), r() < (R.curtain ?? 0.5) ? 1 : 0, 0];
        const col = new THREE.Color(palette[Math.floor(r() * palette.length)]).multiplyScalar(0.8 + 0.3 * r());
        // podium + setbacks (1916 zoning envelope): each tier narrower
        const nT = H > 120 ? 2 + Math.floor(r() * 3) : 1 + Math.floor(r() * 2);
        let y = 0; const pod = Math.min(H * 0.25, 20 + r() * 25);
        if (H > 90) { T.tiers.push({ p: [x, 0, z], s: [w * 1.35, pod, d * 1.3], seed: seedv, c: col }); y = pod; }
        for (let k = 0; k < nT; k++) { const th = (H - y) * (k === nT - 1 ? 1 : 0.45 + 0.2 * r()); T.tiers.push({ p: [x, y, z], s: [w, th, d], seed: seedv, c: col }); y += th; w *= 0.72 + 0.1 * r(); d *= 0.72 + 0.1 * r(); if (y >= H - 1) break; }
        const ct = r();
        if (H > 150 && ct < 0.35) { const ph = 12 + r() * 25; T.crowns.push({ p: [x, y, z], s: [w, ph, d], c: col }); y += ph; }
        if (H > 180 && ct > 0.7) { const sh = 30 + r() * 60; T.spires.push({ p: [x, y, z], s: [1.2, sh, 1.2], c: new THREE.Color('#9a9ea4') }); y += sh; }
        if (beacons && (H > 100 || r() < 0.2)) lf.add({ pos: [x, y + 1.5, z], color: '#ff1a0a', i: 2.2, core: 0.5, halo: 0.5, minPx: 1.4, blink: ct > 0.6 ? { period: 1.5, duty: 0.35, phase: 0 } : null });
      }
      const mk = (geo, list, mat) => {
        const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length)); m.count = list.length;
        const seeds = new Float32Array(Math.max(1, list.length) * 4), o = new THREE.Object3D();
        list.forEach((it, i) => { o.position.set(...it.p); o.scale.set(...it.s); o.rotation.set(0, 0, 0); o.updateMatrix(); m.setMatrixAt(i, o.matrix); m.setColorAt(i, it.c); if (it.seed) seeds.set(it.seed, i * 4); });
        m.geometry = m.geometry.clone(); m.geometry.setAttribute('iseed', new THREE.InstancedBufferAttribute(seeds, 4));
        m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.frustumCulled = false; world.scene.add(m); T.meshes.push(m); return m;
      };
      const fm = facadeMaterial(lf, { gain: R.gain ?? 1 }); (this.reds = this.reds || []).push(fm.userData.red);
      mk(unitBox, T.tiers, fm);
      // the roofs (4 Oct, THE LADDER: the towers read as blank boxes): a lip on every tier, plant on the roofs (HVAC blocks, a water tank on
      // some), and on the tall towers a lit crown band under the top
      if (R.roofs !== false) {
        const lips = [], plant = [], tanks = [], crowns2 = [];
        const tops = new Map(); for (const t of T.tiers) { const k = t.p[0].toFixed(1) + ',' + t.p[2].toFixed(1); const y = t.p[1] + t.s[1]; if (!tops.has(k) || tops.get(k).y < y) tops.set(k, { y, t }); }
        for (const t of T.tiers) {
          const y = t.p[1] + t.s[1], [w, , d] = t.s;
          lips.push({ p: [t.p[0], y, t.p[2]], s: [w + 0.6, 1.1, d + 0.6], c: t.c.clone().multiplyScalar(0.8) });
          const n = 1 + Math.floor(r() * 3);
          for (let j = 0; j < n; j++) plant.push({ p: [t.p[0] + (r() - 0.5) * w * 0.6, y, t.p[2] + (r() - 0.5) * d * 0.6], s: [3 + r() * 5, 2 + r() * 3, 3 + r() * 5], c: new THREE.Color('#5a5e62').multiplyScalar(0.7 + 0.4 * r()) });
          if (r() < 0.3) tanks.push({ p: [t.p[0] + (r() - 0.5) * w * 0.5, y, t.p[2] + (r() - 0.5) * d * 0.5], s: [5, 7, 5], c: new THREE.Color('#6b5844') });
        }
        for (const { y, t } of tops.values()) if (y > 110) crowns2.push({ p: [t.p[0], y - 6, t.p[2]], s: [t.s[0] + 0.3, 1.6, t.s[2] + 0.3], c: new THREE.Color(['#fff1d6', '#d8e6ff', '#ffd2a0', '#ff4030'][Math.floor(r() * 4)]) });
        const roofM = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, metalness: 0.2 });
        if (lips.length) mk(unitBox, lips, roofM);
        if (plant.length) mk(unitBox, plant, roofM);
        if (tanks.length) mk(unitCylLo, tanks, roofM);
        if (crowns2.length) mk(unitBox, crowns2, new THREE.MeshBasicMaterial({ color: '#ffffff' }));
      }
      if (T.crowns.length) mk(unitPyr, T.crowns, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5, metalness: 0.4 }));
      if (T.spires.length) mk(unitCylLo, T.spires, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4, metalness: 0.7 }));
    });
    this.count = this.rows.reduce((a, R) => a + R.tiers.length, 0);
  }
  meshesOf(ri) { return this.rows[ri].meshes; }
  // the red reveal on every row: centre [x, z], radius r (m), front width w (m); r < 0 switches it off
  setRed(c, r, w = 80) { for (const R of this.reds) { R.uRedC.value.set(c[0], 0, c[1]); R.uRedR.value = r; R.uRedW.value = w; } }
}

// ------------------------------------------------------------------ elevated ramp along a curve
export class Ramp {
  // pts: [[x,y,z]...] deck centreline; width m; lamps every m; cars: moving light pairs along the curve
  // pierLight (pass 2, opt-in): { color, i, fall } a sodium head under the deck at each pier top: the pier catches a pool of
  // light at its head and falls to black toward the ground (instead of taking the ground lightmap up its whole height)
  constructor(world, lf, pts, { width = 9, thick = 1.6, lampEvery = 55, lampI = 3.5, cars = 6, speed = 22, dir = 1, patch = null, seed = 5, piers = 45, pierLight = null } = {}) {
    const C = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), L = C.getLength(), N = Math.max(8, Math.round(L / 3));
    const pos = [], up = new THREE.Vector3(0, 1, 0);
    const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    const frame = (u) => { const p = C.getPointAt(u), t = C.getTangentAt(u), s = new THREE.Vector3().crossVectors(t, up).normalize(); return { p, t, s }; };
    for (let i = 0; i < N; i++) {
      const A = frame(i / N), B = frame((i + 1) / N);
      const off = (F, x, y) => F.p.clone().addScaledVector(F.s, x).add(new THREE.Vector3(0, y, 0)).toArray();
      const hw = width / 2;
      quad(off(A, -hw, 0), off(B, -hw, 0), off(B, hw, 0), off(A, hw, 0));                      // deck top
      quad(off(A, hw, -thick), off(B, hw, -thick), off(B, -hw, -thick), off(A, -hw, -thick));  // soffit
      for (const sd of [-1, 1]) { quad(off(A, sd * hw, 0), off(A, sd * hw, -thick), off(B, sd * hw, -thick), off(B, sd * hw, 0));   // fascia
        quad(off(A, sd * (hw - 0.3), 0.85), off(B, sd * (hw - 0.3), 0.85), off(B, sd * hw, 0.85), off(A, sd * hw, 0.85));            // barrier top
        quad(off(A, sd * (hw - 0.3), 0), off(B, sd * (hw - 0.3), 0), off(B, sd * (hw - 0.3), 0.85), off(A, sd * (hw - 0.3), 0.85)); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    const conc = new THREE.MeshStandardMaterial({ color: '#8a8680', roughness: 0.85, side: THREE.DoubleSide }); if (patch) patch(conc, lf);
    const deck = new THREE.Mesh(g, conc); world.scene.add(deck); this.deck = deck;
    // piers (hammerhead columns)
    const pg = [];
    for (let s = piers / 2; s < L; s += piers) { const F = frame(s / L); const h = F.p.y - thick; if (h < 2) continue;
      pg.push(strip(new THREE.BoxGeometry(2.2, h, 2.2).translate(F.p.x, h / 2, F.p.z)), strip(new THREE.BoxGeometry(width * 0.8, 1.4, 2.4).translate(F.p.x, h - 0.7, F.p.z))); }
    if (pg.length && !pierLight) world.scene.add(new THREE.Mesh(mergeGeometries(pg), conc));
    else if (pg.length) {
      // the fall-off is baked per vertex (colour attribute) on vertically subdivided piers: lit at the head, black at the foot
      const PL = pierLight, col = new THREE.Color(PL.color || '#ff9a3c').multiplyScalar(PL.i ?? 2), fall = PL.fall ?? 4, pgs = [];
      for (let s = piers / 2; s < L; s += piers) { const F = frame(s / L); const h = F.p.y - thick; if (h < 2) continue;
        for (const gg of [new THREE.BoxGeometry(2.2, h, 2.2, 1, Math.max(2, Math.ceil(h / 1.5)), 1).translate(F.p.x, h / 2, F.p.z), new THREE.BoxGeometry(width * 0.8, 1.4, 2.4).translate(F.p.x, h - 0.7, F.p.z)]) {
          const q = strip(gg), P = q.getAttribute('position'), C = new Float32Array(P.count * 3);
          for (let i = 0; i < P.count; i++) C[i * 3] = Math.exp(-Math.max(h - P.getY(i), 0) / fall);
          q.setAttribute('color', new THREE.BufferAttribute(C, 3)); pgs.push(q); } }
      const g = mergeGeometries(pgs);
      const pm = new THREE.MeshStandardMaterial({ color: '#7a7670', roughness: 0.9, vertexColors: true });
      pm.onBeforeCompile = (sh) => { sh.uniforms.uPL = { value: col };
        sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '').replace('#include <common>', '#include <common>\nuniform vec3 uPL;')
          .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse += diffuseColor.rgb * uPL * vColor.r;'); };
      pm.customProgramCacheKey = () => 'pierlight';
      world.scene.add(new THREE.Mesh(g, pm));
      for (let s = piers / 2; s < L; s += piers) { const F = frame(s / L); const h = F.p.y - thick; if (h < 2) continue; lf.add({ pos: [F.p.x, h - 0.4, F.p.z + 1.4], color: PL.color || '#ff9a3c', i: (PL.i ?? 2) * 1.2, core: 0.2, halo: 0.5, minPx: 1.1 }); }
    }
    // lamps on the barrier
    const poles = [];
    for (let s = 10; s < L; s += lampEvery) { const F = frame(s / L), b = F.p.clone().addScaledVector(F.s, width / 2 - 0.15);
      poles.push(strip(new THREE.BoxGeometry(0.2, 10, 0.2).translate(b.x, b.y + 5.8, b.z)));
      const h = b.clone().addScaledVector(F.s, -2.2); poles.push(strip(new THREE.BoxGeometry(0.6, 0.15, 0.3).translate(h.x, b.y + 10.6, h.z)));
      lf.add({ pos: [h.x, b.y + 10.5, h.z], color: '#fff0dc', i: lampI, core: 0.25, halo: 0.7, minPx: 1.5, pool: { r: 6, i: lampI * 0.5 } }); }
    if (poles.length) { const pm = new THREE.MeshStandardMaterial({ color: '#555a5e', roughness: 0.5, metalness: 0.5 }); if (patch) patch(pm, lf); world.scene.add(new THREE.Mesh(mergeGeometries(poles), pm)); }
    // cars
    const r = rng(seed); this.cars = []; this.lf = lf; this.C = C; this.L = L;
    for (let k = 0; k < cars; k++) { const car = { s0: r() * L, v: speed * (0.85 + 0.3 * r()), lane: (r() - 0.5) * width * 0.5, ids: [] };
      for (const sd of [-1, 1]) { car.ids.push([sd, 0, lf.lights.length]); lf.add({ pos: [0, 0, 0], color: '#fff4e6', i: 2.5, core: 0.12, halo: 0.5, minPx: 1.2 });
        car.ids.push([sd, 1, lf.lights.length]); lf.add({ pos: [0, 0, 0], color: '#ff1808', i: 1.2, core: 0.1, halo: 0.35, minPx: 1.0 }); }
      this.cars.push(car); }
    this.dir = dir;
  }
  update(t) {
    for (const c of this.cars) { const s = ((c.s0 + c.v * t * this.dir) % this.L + this.L) % this.L, u = s / this.L;
      const p = this.C.getPointAt(u), tg = this.C.getTangentAt(u).multiplyScalar(this.dir), sd = new THREE.Vector3(-tg.z, 0, tg.x).normalize();
      for (const [side, tail, id] of c.ids) { const q = p.clone().addScaledVector(sd, c.lane + side * 0.8).addScaledVector(tg, tail ? -4.4 : 0); this.lf.setPos(id, q.x, q.y + (tail ? 0.8 : 0.7), q.z); } }
  }
}

function beamC(a, b, t) { const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), L = A.distanceTo(B); const g = new THREE.BoxGeometry(t, t, L);
  g.applyMatrix4(new THREE.Matrix4().lookAt(A, B, new THREE.Vector3(0, 1, 0))); g.translate(...A.clone().add(B).multiplyScalar(0.5).toArray()); return strip(g); }
// ------------------------------------------------------------------ the plant (integrated mill), with temperatures
// Every mesh gets userData.temp (deg C); instanced parts may carry an 'itemp' attribute. thermalPass() reads both.
export class Plant {
  constructor(world, lf, { origin = [0, 0, -1300], seed = 11, patch = null, lightGain = 1 } = {}) {
    const [ox, oy, oz] = origin, r = rng(seed);
    this.world = world; this.parts = []; this.lf = lf;
    const std = (color, rough = 0.8, metal = 0.1) => { const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }); if (patch) patch(m, lf); return m; };
    const add = (geo, mat, temp, name) => { const m = new THREE.Mesh(geo, mat); m.userData.temp = temp; m.name = name; world.scene.add(m); this.parts.push(m); return m; };
    const G = (arr) => mergeGeometries(arr.map(strip));
    const cyl = (x, y, z, rad, h, seg = 24) => strip(new THREE.CylinderGeometry(rad, rad, h, seg, 1).translate(x, y + h / 2, z));
    const box = (x, y, z, sx, sy, sz) => strip(new THREE.BoxGeometry(sx, sy, sz).translate(x, y + sy / 2, z));
    const tube = (pts, rad) => strip(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), 24, rad, 8, false));
    // BOF / mill shops: long sheds with clerestories, lit monitors (emissive strips done as lights)
    const sheds = [];
    const shedList = [[ox - 300, oz - 60, 220, 48, 62], [ox + 60, oz - 200, 260, 38, 44], [ox + 330, oz - 150, 180, 56, 50], [ox - 120, oz - 260, 320, 40, 36]];
    for (const [x, z, L, W, H] of shedList) { sheds.push(box(x, 0, z, L, H, W), box(x, H, z, L * 0.96, 7, W * 0.3));
      for (let k = 0; k < 10; k++) lf.add({ pos: [x - L / 2 + (k + 0.5) * L / 10, H + 3, z + W * 0.16], color: '#ffb060', i: 1.6 * lightGain, core: 1.2, halo: 0.35, minPx: 1.2 });
      for (let k = 0; k < 5; k++) lf.add({ pos: [x - L / 2 + (k + 0.5) * L / 5, 9, z + W / 2 + 1], color: '#ffa04a', i: 4 * lightGain, core: 0.4, halo: 0.6, pool: { r: 10, i: 22 * lightGain } }); }
    add(G(sheds), std('#4a4642', 0.85, 0.3), 32, 'sheds');
    // blast furnace + 4 stoves + downcomers + bustle pipe
    const bx = ox - 40, bz = oz - 20, bf = [];
    bf.push(cyl(bx, 0, bz, 8, 42), strip(new THREE.CylinderGeometry(5, 8, 22, 24).translate(bx, 53, bz)), cyl(bx, 64, bz, 3.2, 26));
    for (let k = 0; k < 4; k++) { const x = bx + 32 + k * 16; bf.push(cyl(x, 0, bz + 10, 5, 44), strip(new THREE.SphereGeometry(5, 16, 8, 0, TAU, 0, Math.PI / 2).translate(x, 44, bz + 10))); }
    bf.push(tube([[bx, 88, bz], [bx + 8, 96, bz + 4], [bx + 22, 70, bz + 8], [bx + 24, 20, bz + 12]], 1.6), tube([[bx, 88, bz], [bx - 10, 94, bz - 2], [bx - 22, 60, bz - 6]], 1.4));
    bf.push(strip(new THREE.TorusGeometry(10, 1.1, 8, 32).rotateX(Math.PI / 2).translate(bx, 30, bz)));
    for (let y = 8; y < 90; y += 12) bf.push(box(bx, y, bz, 22, 0.3, 22));                           // platforms
    add(G(bf.slice(0, 3)), std('#5a4e46', 0.7, 0.5), 180, 'furnace');
    add(G(bf.slice(3, 11)), std('#6a625a', 0.7, 0.4), 140, 'stoves');
    add(G(bf.slice(11)), std('#3a3634', 0.8, 0.4), 90, 'bf pipework');
    lf.add({ pos: [bx, 20, bz + 12], color: '#ff6a20', i: 18 * lightGain, core: 3, halo: 1.0, pool: { r: 16, i: 60 * lightGain } });          // cast house glow
    for (let y = 20; y < 90; y += 14) lf.add({ pos: [bx + 11, y, bz + 11], color: '#ffae5a', i: 2.4 * lightGain, core: 0.3, halo: 0.5, minPx: 1.2 });
    // coke battery: long low block with a glowing pusher side and a quench tower
    const cx = ox + 190, cz = oz - 60;
    add(G([box(cx, 0, cz, 160, 14, 16), box(cx, 14, cz, 160, 3, 8)]), std('#3e3a38', 0.9, 0.1), 260, 'coke battery');
    for (let k = 0; k < 12; k++) lf.add({ pos: [cx - 75 + k * 13.5, 7, cz + 8.5], color: '#ff5a18', i: 5 * lightGain, core: 1.5, halo: 0.5, minPx: 1.4, pool: { r: 6, i: 10 * lightGain } });
    add(G([box(cx + 100, 0, cz, 14, 44, 14)]), std('#4a4644', 0.8, 0.2), 70, 'quench tower');
    // stacks: 120-150 m, with red/white bands at the top, beacons
    this.stacks = [];
    for (const [x, z, h, rd, t] of [[ox - 150, oz - 90, 150, 4.5, 160], [ox - 118, oz - 100, 135, 4, 140], [ox + 150, oz - 130, 125, 3.6, 220], [ox + 260, oz - 40, 110, 3.2, 120]]) {
      const m = add(G([strip(new THREE.CylinderGeometry(rd * 0.8, rd * 1.2, h, 20).translate(x, h / 2, z))]), std('#8a8680', 0.8, 0.1), t, 'stack');
      add(G([strip(new THREE.CylinderGeometry(rd * 0.82, rd * 0.84, 10, 20).translate(x, h - 15, z)), strip(new THREE.CylinderGeometry(rd * 0.8, rd * 0.82, 6, 20).translate(x, h - 3, z))]), std('#a8281c', 0.7, 0.1), t, 'stack band');
      lf.add({ pos: [x, h + 1, z], color: '#ff1a0a', i: 3 * lightGain, core: 0.5, halo: 0.5, minPx: 1.5, blink: { period: 1.5, duty: 0.35, phase: 0 } });
      lf.add({ pos: [x, h * 0.5, z + rd + 0.5], color: '#ff1a0a', i: 1.5 * lightGain, core: 0.3, halo: 0.4, minPx: 1.2 });
      this.stacks.push({ x, z, h, rd, t }); }
    // natural-draught cooling tower (hyperboloid, 125 m) and a gas holder: the two masses that say "plant" at 1 km
    { const pts = []; for (let i = 0; i <= 20; i++) { const y = i / 20; pts.push(new THREE.Vector2(34 + 22 * Math.pow(Math.abs(y - 0.72) / 0.72, 1.6) * (y < 0.72 ? 1 : 0.35), y * 125)); }
      const ct = new THREE.LatheGeometry(pts, 48); ct.translate(ox - 250, 0, oz - 170); this.cooling = { x: ox - 250, z: oz - 170, h: 125 };
      const legs = []; for (let k = 0; k < 36; k++) { const a = k / 36 * TAU; legs.push(beamC([ox - 250 + Math.cos(a) * 56, 0, oz - 170 + Math.sin(a) * 56], [ox - 250 + Math.cos(a + 0.12) * 53, 9, oz - 170 + Math.sin(a + 0.12) * 53], 0.9)); }
      const m = add(G([ct]), std('#6e6a64', 0.9, 0.05), 38, 'cooling tower'); m.material.side = THREE.DoubleSide; add(G(legs), std('#5a5650', 0.9, 0.05), 30, 'cooling legs'); }
    add(G([cyl(ox + 470, 0, oz - 240, 32, 78, 40), strip(new THREE.SphereGeometry(32, 32, 8, 0, TAU, 0, 0.35).translate(ox + 470, 78 - 32 * Math.cos(0.35), oz - 240))]), std('#5a5e62', 0.6, 0.5), 18, 'gas holder');
    lf.add({ pos: [ox + 470, 80, oz - 240], color: '#ff1a0a', i: 2 * lightGain, core: 0.4, halo: 0.4, minPx: 1.3 });
    // the ore dock on the river: ore bridges (Great Lakes practice) over stockpiles, and a second furnace behind
    { const dz = oz + 380, br = [], piles = [];
      for (const [x, w] of [[ox - 170, 110], [ox + 20, 120], [ox + 210, 100]]) {
        for (const sd of [-1, 1]) { br.push(box(x + sd * w / 2, 0, dz, 5, 44, 7)); br.push(beamC([x + sd * w / 2, 0, dz - 3], [x + sd * w / 2, 30, dz + 12], 1.2)); }
        br.push(box(x, 44, dz, w + 60, 6, 8), box(x - w / 2 - 22, 50, dz, 18, 9, 10), beamC([x - w / 2 - 30, 50, dz], [x + w / 2 + 30, 44, dz], 0.8));
        for (let k = -3; k <= 3; k++) br.push(beamC([x + k * w / 7, 44, dz - 4], [x + (k + 0.5) * w / 7, 50, dz - 4], 0.5));
        lf.add({ pos: [x - w / 2 - 22, 58, dz + 5], color: '#e8f0ff', i: 3 * lightGain, core: 0.4, halo: 0.5, pool: { r: 20, i: 16 * lightGain } });
        lf.add({ pos: [x + w / 2, 47, dz + 5], color: '#ffa048', i: 2.5 * lightGain, core: 0.3, halo: 0.5, minPx: 1.2 });
        piles.push(strip(new THREE.ConeGeometry(28, 16, 20).translate(x - 20, 8, dz - 40)), strip(new THREE.ConeGeometry(22, 12, 18).translate(x + 35, 6, dz - 50))); }
      add(G(br), std('#3c3e40', 0.6, 0.6), 16, 'ore bridges'); add(G(piles), std('#3a2418', 1, 0), 12, 'ore piles');
      const bx2 = ox + 210, bz2 = oz - 60, f2 = [];
      f2.push(cyl(bx2, 0, bz2, 7, 38), strip(new THREE.CylinderGeometry(4.5, 7, 20, 20).translate(bx2, 48, bz2)), cyl(bx2, 58, bz2, 2.8, 22));
      for (let k = 0; k < 3; k++) f2.push(cyl(bx2 + 26 + k * 14, 0, bz2 + 8, 4.5, 40), strip(new THREE.SphereGeometry(4.5, 14, 6, 0, TAU, 0, Math.PI / 2).translate(bx2 + 26 + k * 14, 40, bz2 + 8)));
      f2.push(tube([[bx2, 78, bz2], [bx2 + 7, 86, bz2 + 3], [bx2 + 18, 60, bz2 + 6], [bx2 + 20, 18, bz2 + 9]], 1.4));
      for (let y = 8; y < 80; y += 12) f2.push(box(bx2, y, bz2, 18, 0.3, 18));
      add(G(f2), std('#56504a', 0.7, 0.5), 150, 'furnace B');
      for (let y = 18; y < 80; y += 15) lf.add({ pos: [bx2 + 9, y, bz2 + 9], color: '#ffae5a', i: 2 * lightGain, core: 0.3, halo: 0.5, minPx: 1.2 });
      lf.add({ pos: [bx2, 16, bz2 + 10], color: '#ff6a20', i: 12 * lightGain, core: 2.5, halo: 0.9, pool: { r: 14, i: 40 * lightGain } }); }
    // tank farm
    const tanks = [];
    for (let i = 0; i < 6; i++) tanks.push(cyl(ox - 330 + (i % 3) * 42, 0, oz + 80 + Math.floor(i / 3) * 44, 15, 14 + r() * 4, 36));
    add(G(tanks), std('#8c9094', 0.5, 0.5), 24, 'tanks');
    // pipe racks: trestles with bundles of pipes, running across the site
    const rack = [], pipes = [];
    const runs = [[[ox - 360, oz + 150], [ox + 600, oz + 150]], [[ox + 120, oz + 150], [ox + 120, oz - 180]], [[ox + 450, oz + 150], [ox + 450, oz - 60]]];
    for (const [[x0, z0], [x1, z1]] of runs) { const L = Math.hypot(x1 - x0, z1 - z0), nx = (x1 - x0) / L, nz = (z1 - z0) / L;
      for (let s = 0; s <= L; s += 8) { const x = x0 + nx * s, z = z0 + nz * s; for (const sd of [-1, 1]) rack.push(box(x - nz * sd * 3, 0, z + nx * sd * 3, 0.4, 9, 0.4)); rack.push(box(x, 9, z, Math.abs(nz) * 6.6 + 0.4, 0.4, Math.abs(nx) * 6.6 + 0.4)); rack.push(box(x, 6, z, Math.abs(nz) * 6.6 + 0.4, 0.3, Math.abs(nx) * 6.6 + 0.4)); }
      for (let k = 0; k < 6; k++) { const off = -2.6 + k * 1.05, rad = 0.25 + (k % 3) * 0.18, y = k < 4 ? 9.6 : 6.6;
        pipes.push(tube([[x0 - nz * off, y, z0 + nx * off], [(x0 + x1) / 2 - nz * off, y, (z0 + z1) / 2 + nx * off], [x1 - nz * off, y, z1 + nx * off]], rad)); }
      for (let s = 20; s < L; s += 40) lf.add({ pos: [x0 + nx * s, 10.5, z0 + nz * s], color: '#ffa04a', i: 2.2 * lightGain, core: 0.3, halo: 0.5, minPx: 1.2, pool: { r: 8, i: 10 * lightGain } }); }
    add(G(rack), std('#4a4c4e', 0.6, 0.5), 22, 'racks');
    add(G(pipes), std('#7a7e80', 0.4, 0.6), 110, 'pipes');
    // conveyor galleries (inclined)
    const conv = [];
    for (const [a, b] of [[[ox + 330, 50, oz - 20], [ox + 200, 6, oz + 120]], [[bx + 10, 80, bz - 10], [bx + 150, 4, bz - 150]]]) { const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), L = A.distanceTo(B);
      const g = new THREE.BoxGeometry(4, 3.5, L); g.applyMatrix4(new THREE.Matrix4().lookAt(A, B, new THREE.Vector3(0, 1, 0))); g.translate(...A.clone().add(B).multiplyScalar(0.5).toArray()); conv.push(strip(g));
      for (let s = 0.1; s < 1; s += 0.2) { const P = A.clone().lerp(B, s); conv.push(box(P.x, 0, P.z, 1.2, P.y, 1.2)); lf.add({ pos: [P.x, P.y + 2, P.z], color: '#ffb060', i: 1.6 * lightGain, core: 0.3, halo: 0.4, minPx: 1.1 }); } }
    add(G(conv), std('#5a5854', 0.8, 0.3), 30, 'conveyors');
    // flare stack
    const fx = ox + 330, fz = oz - 320;
    this.flarePos = [fx, 70, fz];
    add(G([cyl(fx, 0, fz, 1.4, 68, 12), ...[0, 1, 2].map(k => strip(new THREE.CylinderGeometry(0.15, 0.15, 70, 4).rotateZ(0.08).rotateY(k * TAU / 3).translate(fx + Math.cos(k * TAU / 3) * 6, 34, fz + Math.sin(k * TAU / 3) * 6)))]), std('#6a6664', 0.6, 0.5), 300, 'flare stack');
    this.flare = lf.add({ pos: [fx, 76, fz], color: '#ff8a2a', i: 45 * lightGain, core: 3.5, halo: 1.2, minPx: 3, pool: { r: 40, i: 40 * lightGain } });
    // yard floodlights on poles
    for (let k = 0; k < 16; k++) { const x = ox - 380 + k * 70 + (r() - 0.5) * 30, z = oz + 170 + (r() - 0.5) * 20; lf.add({ pos: [x, 18, z], color: k % 3 ? '#ffa048' : '#e8f0ff', i: 5 * lightGain, core: 0.5, halo: 0.6, pool: { r: 18, i: 30 * lightGain } }); }
    this.bounds = { x0: ox - 420, x1: ox + 700, z0: oz - 220, z1: oz + 200 };
  }
}

// ------------------------------------------------------------------ steam plumes (soft particles lit by the plant below)
export class Plumes {
  // sources: [{ x, y, z, rate(size), rise, drift:[dx,dz], temp }]
  constructor(atmos, lf, sources, { n = 260, seed = 4, gain = 1 } = {}) {
    const r = rng(seed), P = [], A = [];
    for (const S of sources) for (let i = 0; i < n; i++) { const u = i / n; P.push(S.x, S.y, S.z); A.push(u, r(), S.size ?? 12, S.rise ?? 120); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('pa', new THREE.Float32BufferAttribute(A, 4));
    const F = atmos.frameU;
    this.U = { ...atmos.U, ...lf.U, tDepth: F.tDepth, uRes: F.uRes, uOcc: F.uOcc, uFovY: { value: 0.6 }, uDrift: { value: new THREE.Vector2(0.35, 0.1) }, uGain: { value: gain } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: this.U, transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      vertexShader: ATMOS_GLSL + LF_GLSL + /* glsl */`
        attribute vec4 pa; uniform vec2 uRes, uDrift; uniform float uFovY, uGain; varying vec3 vC; varying float vA, vSeed; varying vec4 vCP;
        void main(){
          float u = fract(pa.x + uTime * .012);                             // age along the plume
          vec3 p = position + vec3(0., pa.w * pow(u, .7), 0.) + vec3(uDrift.x, 0., uDrift.y) * pa.w * u * u * 1.2;
          p.xz += (vec2(pa.y, fract(pa.y*7.3)) - .5) * pa.z * (1.2 + 5.*u);
          p.y += (fract(pa.y*3.7) - .5) * pa.z * (1. + 3.*u);
          vec4 mv = viewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv; vCP = gl_Position; float d = -mv.z;
          float rad = pa.z * (1. + 4.5*u);
          gl_PointSize = min(rad * uRes.y / (2. * tan(uFovY*.5) * d) * 2., 300.);
          // lighting: the plant below (lightmap at the plume's foot, falling with height), the moon on top, the sky
          vec3 below = lightAt(vec3(p.x, 0., p.z)) * exp(-(p.y - position.y) / 70.) * .1;
          below = mix(vec3(dot(below, vec3(.33))), below, .7);                 // steam scatters the sodium, desaturated
          vec3 top = vec3(dot(uSMoonCol, vec3(.33))) * 2.2 + vec3(.006, .006, .007);
          float tr = exp(-hazeTau(normalize(p - uCamPos), d));
          vC = (below + top) * uGain * tr + hazeCol(normalize(p - uCamPos)) * (1. - tr) * .3;
          vA = pow(1. - u, 1.3) * smoothstep(0., .04, u) * .6 * tr; vSeed = pa.y;
        }`,
      fragmentShader: `uniform sampler2D tDepth; uniform float uOcc; varying vec3 vC; varying float vA, vSeed; varying vec4 vCP;
        void main(){ vec3 ndc = vCP.xyz / vCP.w; if (uOcc > .5 && texture2D(tDepth, ndc.xy*.5+.5).r < ndc.z*.5+.5) discard;
          vec2 q = gl_PointCoord - .5; float r = length(q);
          float n = .6 + .4*sin(q.x*9. + vSeed*20.)*sin(q.y*7. + vSeed*13.);
          float a = smoothstep(.5, .1, r) * vA * n;
          gl_FragColor = vec4(vC * a, a); }` }));
    this.points.frustumCulled = false; this.points.userData.noReflect = false;
    atmos.overlay.add(this.points);
    this.sources = sources;
  }
}

// ------------------------------------------------------------------ rail yard: ladder tracks, tank cars, hoppers, high masts
export class RailYard {
  constructor(world, lf, { x0 = -500, x1 = 500, z = -250, tracks = 9, gauge = 5.2, seed = 3, patch = null, lightGain = 1 } = {}) {
    const r = rng(seed), tank = [], hop = [], rails = [];
    for (let k = 0; k < tracks; k++) { const zz = z - k * gauge;
      for (const sd of [-0.72, 0.72]) rails.push(strip(new THREE.BoxGeometry(x1 - x0, 0.16, 0.08).translate((x0 + x1) / 2, 0.3, zz + sd)));
      let x = x0 + r() * 40;
      while (x < x1 - 20) { if (r() < 0.2) { x += 25 + r() * 60; continue; }
        const isTank = r() < 0.55, L = isTank ? 18 : 16;
        if (isTank) { const g = new THREE.CylinderGeometry(1.5, 1.5, L - 1, 16); g.rotateZ(Math.PI / 2); g.translate(x + L / 2, 2.6, zz); tank.push(strip(g)); tank.push(strip(new THREE.BoxGeometry(L, 0.5, 2.6).translate(x + L / 2, 1.1, zz))); }
        else { hop.push(strip(new THREE.BoxGeometry(L - 1, 3.6, 3.1).translate(x + L / 2, 1.2 + 1.8, zz))); for (let q = 0; q < 3; q++) hop.push(strip(new THREE.ConeGeometry(1.1, 1.2, 4).rotateX(Math.PI).translate(x + 3 + q * 5, 0.9, zz))); }
        x += L + 0.8; } }
    const mat = (c, rough = 0.6, metal = 0.4) => { const m = new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal }); if (patch) patch(m, lf); return m; };
    const add = (geos, m, temp) => { if (!geos.length) return; const me = new THREE.Mesh(mergeGeometries(geos), m); me.userData.temp = temp; world.scene.add(me); return me; };
    add(tank, mat('#1c1c1e', 0.45, 0.5), 14); add(hop, mat('#3a2c24', 0.85, 0.3), 12); add(rails, mat('#6a6664', 0.3, 0.9), 10);
    // high-mast sodium towers, 30 m, six luminaires each
    const masts = [];
    for (let x = x0 + 60; x < x1; x += 180) { const zz = z - tracks * gauge / 2 + (r() - 0.5) * 8; masts.push(strip(new THREE.CylinderGeometry(0.35, 0.6, 30, 8).translate(x, 15, zz)), strip(new THREE.TorusGeometry(1.4, 0.2, 6, 12).rotateX(Math.PI / 2).translate(x, 30, zz)));
      lf.add({ pos: [x, 30, zz], color: '#ff9a3c', i: 10 * lightGain, core: 1.2, halo: 0.8, pool: { r: 30, i: 6 * lightGain } }); }
    add(masts, mat('#5a5a5a', 0.5, 0.6), 11);
  }
}

// ------------------------------------------------------------------ thermal (PRODUCTIVE's FLIR read of the same frame)
// Renders temperature (deg C) with an override material (mesh userData.temp; plumes and practicals add heat), then maps it
// through ironbow with a fixed span, a sensor halo (bright objects ringed dark, as uncooled bolometers do) and noise.
export class ThermalPass {
  // v2 (pass 2, opt-in): temperature STRUCTURE, not ID colours: userData.tempGrad { y0, y1, t0, t1 } (a stack cooling down
  // its length, a furnace hot at the tuyeres), emissivity falling at grazing angles (form reads as a gradient: hot cores,
  // cool limbs), silhouette cards keep their cut-outs, plume cards add their heat (max blend), and the sky is a cold gradient.
  constructor(atmos, { tMin = -8, tMax = 140, ambient = 4, v2 = false } = {}) {
    this.A = atmos; const w = atmos.w, h = atmos.h; this.v2 = v2;
    this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
    this.mat = new THREE.ShaderMaterial({ uniforms: { uTemp: { value: 20 }, uAmb: { value: ambient }, uCamPos: atmos.U.uCamPos },
      vertexShader: `varying vec3 vWP; varying vec3 vN; void main(){ vec4 lp = vec4(position, 1.);
          #ifdef USE_INSTANCING
          lp = instanceMatrix * lp;
          #endif
          vec4 w = modelMatrix * lp; vWP = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float uTemp, uAmb; uniform vec3 uCamPos; varying vec3 vWP; varying vec3 vN;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main(){ float t = uTemp; vec3 n = normalize(vN);
          float up = n.y;                                                       // roofs radiate to the cold sky
          t = mix(t, uAmb + (t - uAmb) * .55, clamp(up, 0., 1.));
          t += (h(floor(vWP.xz * .5) + floor(vWP.y * .5)) - .5) * 2.5;         // panel-to-panel variation
          t += (t - uAmb) * .25 * exp(-max(vWP.y, 0.) / 20.);                   // hotter near the process floor
          gl_FragColor = vec4(t, 0., 0., 1.); }` });
    this.map = new THREE.ShaderMaterial({ uniforms: { tT: { value: this.rt.texture }, tE: { value: atmos.rtE.texture }, uMin: { value: tMin }, uMax: { value: tMax }, uSeed: { value: 0 }, uRes: { value: new THREE.Vector2(w, h) }, uV2: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader: `uniform sampler2D tT, tE; uniform float uMin, uMax, uSeed; uniform vec2 uRes; varying vec2 vUv;
        vec3 ironbow(float x){ x = clamp(x, 0., 1.);
          vec3 c0 = vec3(.027,0.,.102), c1 = vec3(.11,.012,.314), c2 = vec3(.353,.027,.549), c3 = vec3(.627,.082,.51), c4 = vec3(.863,.235,.227), c5 = vec3(.957,.471,.055), c6 = vec3(.992,.741,.11), c7 = vec3(1.,.941,.478), c8 = vec3(1.,1.,.957);
          if (x < .12) return mix(c0, c1, x/.12); if (x < .28) return mix(c1, c2, (x-.12)/.16); if (x < .42) return mix(c2, c3, (x-.28)/.14);
          if (x < .56) return mix(c3, c4, (x-.42)/.14); if (x < .7) return mix(c4, c5, (x-.56)/.14); if (x < .83) return mix(c5, c6, (x-.7)/.13);
          if (x < .93) return mix(c6, c7, (x-.83)/.1); return mix(c7, c8, (x-.93)/.07); }
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uSeed) * 43758.5453); }
        uniform float uV2;
        void main(){
          float t = texture2D(tT, vUv).r;
          float e = dot(texture2D(tE, vUv).rgb, vec3(.33));                        // practicals and plumes: heat
          if (uV2 > .5) { if (t < -39.) t = mix(-6., -34., pow(clamp(vUv.y, 0., 1.), .6)); t += min(e, 1.5) * 40.; }   // the cold sky gradient; lamps as hot points
          else t += e * 60.;
          // bolometer halo: a blurred copy subtracted (hot things ringed dark), 8 taps
          float b = 0.; for (int i = 0; i < 8; i++) { float a = float(i) * .785; b += texture2D(tT, vUv + vec2(cos(a), sin(a)) * 9. / uRes).r; } b /= 8.;
          t -= max(b - t, 0.) * .35;
          float x = (t - uMin) / (uMax - uMin); x = pow(clamp(x, 0., 1.), .7);
          vec3 c = ironbow(x + (h(vUv*uRes) - .5) * .025);
          gl_FragColor = vec4(c, 1.); }` });
  }
  _v2mats() {
    if (this.m2) return;
    const V = `varying vec3 vWP; varying vec3 vN; varying vec2 vUv; void main(){ vUv = uv; vec4 lp = vec4(position, 1.);
          #ifdef USE_INSTANCING
          lp = instanceMatrix * lp;
          #endif
          vec4 w = modelMatrix * lp; vWP = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`;
    const F = (card) => `uniform float uTemp, uAmb; uniform vec4 uGrad; uniform vec3 uCamPos; uniform sampler2D tC; varying vec3 vWP; varying vec3 vN; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main(){ ${card ? 'vec4 c = texture2D(tC, vUv); if (c.r < .45) discard;' : ''}
          float t = uTemp; if (uGrad.x < uGrad.y) t = mix(uGrad.z, uGrad.w, clamp((vWP.y - uGrad.x) / (uGrad.y - uGrad.x), 0., 1.));
          vec3 n = normalize(vN), v = normalize(uCamPos - vWP); float mu = abs(dot(n, v));
          ${card ? 't += c.b * 40.; t -= (1. - c.g) * 0.;' : 't = uAmb + (t - uAmb) * (.62 + .38 * pow(mu, .5));        // grazing: lower emissivity'}
          t = mix(t, uAmb + (t - uAmb) * .55, clamp(n.y, 0., 1.) * ${card ? '0.' : '1.'});   // roofs see the cold sky
          t += (h(floor(vWP.xz * .5) + floor(vWP.y * .5)) - .5) * 2.;
          t += (t - uAmb) * .2 * exp(-max(vWP.y, 0.) / 20.);
          gl_FragColor = vec4(t, 0., 0., 1.); }`;
    const U = () => ({ uTemp: { value: 20 }, uAmb: { value: this.mat.uniforms.uAmb.value }, uGrad: { value: new THREE.Vector4(0, 0, 0, 0) }, uCamPos: this.A.U.uCamPos, tC: { value: null } });
    this.m2 = new THREE.ShaderMaterial({ uniforms: U(), vertexShader: V, fragmentShader: F(false) });
    this.m2c = new THREE.ShaderMaterial({ uniforms: U(), vertexShader: V, fragmentShader: F(true), side: THREE.DoubleSide });
    this.m2p = new THREE.ShaderMaterial({ uniforms: { uHeat: { value: 40 }, uAmb: { value: this.mat.uniforms.uAmb.value }, tP: { value: null } }, transparent: true, depthTest: true, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, side: THREE.DoubleSide,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; vec3 c = modelMatrix[3].xyz; vec3 right = normalize(vec3(viewMatrix[0][0], 0., viewMatrix[2][0]));
          vec3 w = c + right * position.x * length(modelMatrix[0].xyz) + vec3(0., position.y * length(modelMatrix[1].xyz), 0.); gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.); }`,
      fragmentShader: `uniform float uHeat, uAmb; uniform sampler2D tP; varying vec2 vUv; void main(){ float a = texture2D(tP, vUv).r; if (a < .03) discard;
          gl_FragColor = vec4(-30. + (uHeat + 30.) * smoothstep(.03, .7, a) * exp(-vUv.y * 1.8), 0., 0., 1.); }` });   // wisps cool into the sky
  }
  _renderV2(cam) {
    const A = this.A, r = A.renderer, sc = A.scene; this._v2mats();
    const swaps = []; sc.traverse(o => { if (!(o.isMesh || o.isInstancedMesh)) return; if (o.material === this.m2) return;
      const card = !!o.userData.card, m = card ? this.m2c.clone() : this.m2.clone();
      m.uniforms.uCamPos = A.U.uCamPos; m.uniforms.uTemp.value = o.userData.temp ?? 8; const G = o.userData.tempGrad; if (G) m.uniforms.uGrad.value.set(G.y0, G.y1, G.t0, G.t1);
      if (card) m.uniforms.tC.value = o.userData.cardTex; swaps.push([o, o.material]); o.material = m; });
    const tm = r.toneMapping; r.toneMapping = THREE.NoToneMapping;
    r.setRenderTarget(this.rt); r.setClearColor(new THREE.Color(-40, 0, 0), 1); r.clear(); r.render(sc, A.camera);
    // plume cards add their heat (max blend), depth-tested against the scene just drawn
    const pl = []; A.overlay.traverse(o => { if (o.userData.plume) pl.push(o); });
    if (pl.length) { const ps = new THREE.Scene(); for (const o of pl) { const m = this.m2p.clone(); m.uniforms.tP.value = o.userData.plumeTex; m.uniforms.uHeat.value = o.userData.temp ?? 45;
        const q = new THREE.Mesh(o.geometry, m); q.position.copy(o.position); q.scale.copy(o.scale); q.frustumCulled = false; ps.add(q); }
      r.autoClear = false; r.render(ps, A.camera); r.autoClear = true; }
    r.setClearColor(0, 1); for (const [o, m] of swaps) { o.material.dispose(); o.material = m; }
    r.toneMapping = tm;
  }
  render(cam, t) {
    const A = this.A, r = A.renderer, sc = A.scene;
    if (this.v2) { A.render(cam, t); this._renderV2(cam); this.map.uniforms.uSeed.value = t % 7; this.map.uniforms.uV2.value = 1; const tm = r.toneMapping; r.toneMapping = THREE.NoToneMapping; A._pass(this.map, null); r.toneMapping = tm; return; }
    A.render(cam, t);                                                          // fills rtE (emissive heat) and the depth
    const temps = []; sc.traverse(o => { if (o.isMesh || o.isInstancedMesh) { temps.push([o, o.onBeforeRender]); const T = o.userData.temp ?? 8;
      o.onBeforeRender = (rr, s, c, g, m) => { if (m === this.mat) { m.uniforms.uTemp.value = T; m.uniformsNeedUpdate = true; } }; } });
    sc.overrideMaterial = this.mat; const tm = r.toneMapping; r.toneMapping = THREE.NoToneMapping;
    r.setRenderTarget(this.rt); r.setClearColor(new THREE.Color(-20, 0, 0), 1); r.clear(); r.render(sc, A.camera);
    sc.overrideMaterial = null; r.setClearColor(0, 1); for (const [o, f] of temps) o.onBeforeRender = f;
    this.map.uniforms.uSeed.value = t % 7; A._pass(this.map, null); r.toneMapping = tm;
  }
}
