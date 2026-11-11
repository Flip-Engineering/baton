// POWER (OBJECTS c1): the natural-draft cooling tower as a named type, not "a trapezoid".
//
// Reference: hyperbolic natural-draft towers of US nuclear and coal stations (e.g. the 1970s-80s towers at Three Mile
// Island, Byron, Susquehanna; Becher, Cooling Towers, 2006): a thin reinforced-concrete hyperboloid shell with a WAIST at
// ~75-80 % of the height, standing on a ring of diagonal X-columns (the lattice you can see daylight through), a stiffened
// rim at the top, the cold-water basin wall at the foot, vertical rain staining under the rim and the lift joints of the
// jump-form pours as faint horizontal lines.
//   coolingTower({ seed, height: 150, waist: 0.62, plume: false })  -> Group (metres, base at y = 0)
import * as THREE from 'three';
import { G, Parts, V3, TAU, rng, range, mat, fin, finish } from './kit.js';

export function coolingTower(o = {}) {
  const r = rng(o.seed ?? 1);
  const H = o.height ?? range(r, 110, 170), Rb = o.base ?? H * range(r, 0.4, 0.46), waistR = Rb * (o.waist ?? range(r, 0.55, 0.66));
  const wy = H * (o.waistAt ?? range(r, 0.74, 0.82)), Rt = waistR * range(r, 1.06, 1.14), colH = H * 0.07;
  // hyperboloid of one sheet through (Rb at colH), (waistR at wy), (Rt at H): r(y) = a * sqrt(1 + ((y - wy)/c)^2)
  const a = waistR, c = (wy - colH) / Math.sqrt((Rb / a) ** 2 - 1);
  const rr = y => y < wy ? a * Math.sqrt(1 + ((y - wy) / c) ** 2) : a + (Rt - a) * ((y - wy) / (H - wy)) ** 2;
  const prof = []; const n = 60; for (let i = 0; i <= n; i++) { const y = colH + (H - colH) * i / n; prof.push([rr(y), y]); }
  const P = new Parts();
  P.add('shell', G.lathe(prof, 96));
  // inside wall (the dark mouth seen from above / the rim thickness)
  P.add('inner', G.lathe(prof.map(([x, y]) => [x - 0.6, y]).reverse(), 96));
  P.add('rim', G.lathe([[Rt - 0.7, H - 1.2], [Rt + 0.5, H - 1.2], [Rt + 0.5, H + 0.3], [Rt - 0.7, H + 0.3]], 96));
  P.add('rim', G.lathe([[rr(colH) - 0.5, colH - 1.0], [rr(colH) + 1.0, colH - 1.0], [rr(colH) + 1.0, colH + 0.8], [rr(colH) - 0.5, colH + 0.8]], 96));
  // the X-column ring: pairs of inclined columns meeting at the shell's foot
  const N = Math.round(Rb * 0.9) * 2;
  for (let i = 0; i < N; i++) {
    const a0 = i / N * TAU, a1 = (i + 1) / N * TAU, R = Rb, top = colH - 1.0;
    const pA = V3(Math.cos(a0) * R, 0, Math.sin(a0) * R), pB = V3(Math.cos(a1) * R, top, Math.sin(a1) * R);
    const pC = V3(Math.cos(a1) * R, 0, Math.sin(a1) * R), pD = V3(Math.cos(a0) * R, top, Math.sin(a0) * R);
    P.add('col', G.rod(pA, pB, 0.45, 6), G.rod(pC, pD, 0.45, 6));
  }
  // the cold-water basin wall and the fill seen dark through the columns
  P.add('rim', G.lathe([[Rb + 2, 0], [Rb + 2.6, 0], [Rb + 2.6, 1.6], [Rb + 2, 1.6]], 96));
  P.add('inner', G.cyl(Rb - 1, Rb - 1, colH * 0.8, 0, colH * 0.45, 0, 64));
  // a caged ladder up the shell? (real towers have an internal stair) -> an aircraft warning lamp pair on the rim
  const lights = [];
  for (let i = 0; i < 4; i++) { const a0 = i / 4 * TAU + 0.3; P.add('lamp', new THREE.SphereGeometry(0.8, 8, 6).translate(Math.cos(a0) * (Rt + 0.3), H + 0.9, Math.sin(a0) * (Rt + 0.3))); lights.push({ kind: 'obstruction', pos: V3(Math.cos(a0) * (Rt + 0.3), H + 0.9, Math.sin(a0) * (Rt + 0.3)), color: 0xff2010 }); }
  const conc = { color: 0xa9a59a, rough: 0.9 };
  const mats = {
    shell: mat('ctShell', { ...conc, wear: { grime: 0.55, grimeH: H * 0.3, streak: 2.5, grimeColor: [0.36, 0.34, 0.3], wobble: 0.2, joints: { h: 1.25, l: 1e6, w: 0.03, k: 0.25, color: [0.45, 0.43, 0.38] } } }),
    inner: mat('ctInner', { color: 0x2a2826, rough: 1 }), rim: mat('ctRim', { color: 0xb8b4a8, rough: 0.85, wear: { grime: 0.3, grimeH: 3 } }),
    col: mat('ctCol', { color: 0x9a968c, rough: 0.9, wear: { grime: 0.6, grimeH: 6 } }), lamp: mat('ctLamp', { color: 0xff3020, emissive: 0xff2010, emissiveIntensity: 3 }),
  };
  const g = P.build(mats);
  return finish(g, { type: 'coolingTower', variant: { height: H, waist: waistR / Rb, base: Rb }, ref: 'hyperbolic natural-draft cooling tower', anchors: { top: V3(0, H, 0) }, lights });
}

// UTILITY POLE (OBJECTS c1): a distribution pole as a lineman would name its parts, not "a corkscrew of bars".
// Reference: REA / RUS distribution construction drawings (Bulletin 1728F-803 class): a Class 2-4 wood pole (40-45 ft),
// a 10 ft crossarm with two wood braces, three pin insulators (or polymer posts) carrying the phases, a neutral on a
// spool rack below, and optionally a pole-mount transformer (the can) on a bracket with its two bushings, a fused cutout
// (the porcelain body angled out, the fuse tube hanging in it) and a lightning arrester, and the ground wire down the pole.
//   utilityPole({ seed, height: 12.5, transformer: true })  ;  meta.anchors.phases = [Vector3 x3] (wire attach points)
//   wireSpan(a, b, sag, r)  -> a catenary TubeGeometry between two attach points
export function wireSpan(a, b, sag = 0.4, r = 0.012) {
  const pts = []; for (let i = 0; i <= 16; i++) { const u = i / 16; const p = a.clone().lerp(b, u); p.y -= sag * 4 * u * (1 - u); pts.push(p); }
  return G.tube(pts, r, 32, 5);
}
export function utilityPole(o = {}) {
  const r = rng(o.seed ?? 1), H = o.height ?? range(r, 11.5, 13.5), P = new Parts(), anchors = {};
  P.add('wood', G.cyl(0.12, 0.17, H, 0, H / 2, 0, 14));
  // crossarm + braces, three pin insulators
  const ay = H - 0.45;
  P.add('wood', G.box(0.09, 0.11, 3.0, 0, ay, 0.12));
  for (const s of [-1, 1]) P.add('steel', G.rod(V3(0, ay - 0.75, 0.08), V3(0, ay - 0.03, s * 0.75 + 0.12), 0.015, 5));
  anchors.phases = [];
  for (const z of [-1.35, -0.45, 1.35]) { P.add('porc', G.lathe([[0.0, 0], [0.05, 0], [0.09, 0.05], [0.05, 0.08], [0.085, 0.12], [0.045, 0.15], [0.07, 0.19], [0.03, 0.22], [0, 0.22]], 14).translate(0, ay + 0.06, z + 0.12)); anchors.phases.push(V3(0, ay + 0.25, z + 0.12)); }
  // pole-top pin insulator
  P.add('porc', G.lathe([[0.0, 0], [0.05, 0], [0.09, 0.05], [0.05, 0.08], [0.085, 0.12], [0.03, 0.2], [0, 0.2]], 14).translate(0, H, 0)); anchors.phases.push(V3(0, H + 0.18, 0));
  // neutral on a spool rack
  const ny = H - 1.9; P.add('steel', G.box(0.05, 0.3, 0.05, 0.16, ny, 0)); P.add('porc', G.cyl(0.05, 0.05, 0.1, 0.24, ny, 0, 12)); anchors.neutral = V3(0.3, ny, 0);
  if (o.transformer ?? true) {
    const ty = H - 3.6;
    P.add('can', G.cyl(0.32, 0.32, 1.05, 0.45, ty, 0, 28), new THREE.SphereGeometry(0.33, 20, 8, 0, TAU, 0, Math.PI / 2).scale(1, 0.25, 1).translate(0.45, ty + 0.52, 0));
    for (let i = 0; i < 6; i++) P.add('can', G.box(0.02, 0.8, 0.14, 0.45 + Math.cos(i / 6 * TAU + 0.5) * 0.34, ty - 0.05, Math.sin(i / 6 * TAU + 0.5) * 0.34).rotateY(0));
    P.add('steel', G.box(0.12, 0.5, 0.25, 0.14, ty, 0));
    for (const z of [-0.12, 0.12]) P.add('porc', G.lathe([[0, 0], [0.04, 0], [0.06, 0.04], [0.035, 0.07], [0.055, 0.1], [0.03, 0.14], [0.04, 0.18], [0, 0.2]], 12).translate(0.45, ty + 0.58, z));
    // fused cutout: a porcelain body angled out from a bracket, the fuse tube hanging in it
    const cy = ty + 1.3;
    P.add('steel', G.box(0.5, 0.05, 0.05, 0.25, cy, -0.25));
    P.add('porc', G.lathe([[0, 0], [0.045, 0], [0.06, 0.05], [0.04, 0.09], [0.06, 0.14], [0.04, 0.19], [0.06, 0.24], [0.04, 0.29], [0.06, 0.34], [0, 0.4]], 12).rotateZ(-0.35).translate(0.5, cy - 0.2, -0.25));
    P.add('fuse', G.cyl(0.02, 0.02, 0.45, 0, 0, 0, 8).rotateZ(-0.35).translate(0.62, cy - 0.02, -0.25));
    P.add('steel', G.box(0.03, 0.08, 0.06, 0.66, cy + 0.2, -0.25));
    P.add('wire', wireSpan(V3(0, ay + 0.25, -1.23), V3(0.68, cy + 0.24, -0.25), 0.05, 0.008), wireSpan(V3(0.58, cy - 0.28, -0.25), V3(0.45, ty + 0.76, -0.12), 0.02, 0.008));
    anchors.transformer = V3(0.45, ty, 0); anchors.cutout = V3(0.55, cy, -0.25);
  }
  P.add('wire', G.cyl(0.006, 0.006, H - 1, 0.13, (H - 1) / 2, -0.1, 4));      // ground wire
  // step bolts / climbing marks, and the pole tag
  for (let y = 2.5; y < H - 2; y += 0.45) P.add('steel', G.cylX(0.01, 0.2, 0, y, (Math.round(y / 0.45) % 2 ? 1 : -1) * 0.14, 5).rotateY(0));
  const mats = {
    wood: mat('poleWood', { color: 0x4a3a2c, rough: 0.95, wear: { grime: 0.5, grimeH: 1.5, streak: 2.5, wobble: 0.3, speck: 0.2, speckColor: [0.25, 0.22, 0.18], speckScale: 20 } }),
    steel: fin('galv'), porc: mat('porc', { color: 0x6a4a36, rough: 0.2, metal: 0 }), can: mat('can', { color: 0x8a918e, rough: 0.5, metal: 0.4, wear: { grime: 0.4, grimeH: 0.8, streak: 2 } }),
    fuse: mat('fuse', { color: 0x1a1a1a, rough: 0.4 }), wire: mat('wire', { color: 0x2a2a2a, rough: 0.5, metal: 0.6 }),
  };
  return finish(P.build(mats), { type: 'utilityPole', variant: { height: H, transformer: o.transformer ?? true }, ref: 'REA/RUS three-phase distribution pole with pole-mount transformer and fused cutout', anchors });
}
