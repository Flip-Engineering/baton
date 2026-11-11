// WHITEOUT (WINTER SHIFT ep.1): the sets, scene-local (research/series/snowbelt/ep1_brief.md "Sets"). Built from the objects kit
// (lib/fx/objects/kit.js: G, Parts, mat, paint, canvasTex) and light/'s surfaces; every exterior material takes the weather's snow
// (lib/fx/whiteout.js cover(): snow on up-faces, plaster on windward verticals). Each set sits at its own place in the world and is
// shown only in its shots; the medium hides everything past a few hundred metres, so a set ends where the snow ends it.
//   ROAD    x ~ 0      frame 0 (the buried H sign, the pickup going away) and THE ROAD, ONTARIO (spruce, a pole line, snow stakes)
//   ROAD2   x ~ 500    THE ROAD, UNITED STATES (bare maples, the pole line on the other side, the H sign passing at right)
//   DARK    x ~ 2000   THE DARK HOSPITAL: single storey, ribbon windows dark, a shut ambulance bay, one wall pack lit
//   ER      x ~ 4000   HOULTON, NIGHT: the ER entrance, the canopy, two pairs of sliding doors, the nurses' station, the lot
//   SITE    x ~ 6000   THE SITE: the slab, the first steel, two heated enclosures, an all-terrain crane, the joists; inside the heat
//   NEW     x ~ 6000   THE NEW HOSPITAL: the site's building finished, lit, at night (the same footprint)
// Faces and fixtures here are generic: no real hospital's name, sign, notice or facade (the brief, risk 5).
import * as THREE from 'three';
import { G, Parts, V3, rng, range, pick, mat, paint, canvasTex } from '../lib/fx/objects/kit.js';
import { concreteMaterial, steelMaterial, SURFACES } from '../lib/fx/light/surface.js';
import { litPatchAll, litPatch } from '../lib/fx/light/patch.js';
import { utilityPole, wireSpan } from '../lib/fx/objects/power.js';

const SNOW = 0xf1f3f5, SLATE = 0x4a525a;
export const SETS = { ROAD: [0, 0, 0], ROAD2: [500, 0, 0], DARK: [2000, 0, 0], ER: [4000, 0, 0], SITE: [6000, 0, 0] };

// ------------------------------------------------------------------ materials
const M = {};
function mats() {
  if (M.snow) return M;
  M.snow = mat('wo_snow', { color: SNOW, rough: 0.9, wear: { wobble: 0.06 } });
  M.snowGrey = mat('wo_snowGrey', { color: 0xd9dcde, rough: 0.92, wear: { wobble: 0.1 } });
  M.bank = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.92 });
  M.bark = mat('wo_bark', { color: 0x2b2622, rough: 0.95, wear: { wobble: 0.2 } });
  M.spruce = mat('wo_spruce', { color: 0x1d2a22, rough: 0.95, wear: { wobble: 0.25 } });
  M.galv = mat('wo_galv', { color: 0x8c9092, rough: 0.45, metal: 0.7, wear: { grime: 0.3, grimeH: 0.6 } });
  M.stake = mat('wo_stake', { color: 0x26282a, rough: 0.6 });
  M.paint = paint(0x2b2e31, { grime: 0.6, grimeH: 0.7, edge: 0.15, rough: 0.38, metal: 0.4 });
  M.trim = mat('wo_trim', { color: 0x18191a, rough: 0.5, metal: 0.2 });
  M.tyre = mat('wo_tyre', { color: 0x141414, rough: 0.85 });
  M.wheel = mat('wo_wheel', { color: 0x5a5d60, rough: 0.4, metal: 0.8 });
  M.glassDark = new THREE.MeshStandardMaterial({ color: 0x0c0f12, roughness: 0.08, metalness: 0.0, envMapIntensity: 1.2 });
  M.tail = new THREE.MeshStandardMaterial({ color: 0x220000, roughness: 0.3, emissive: new THREE.Color(1, 0.02, 0.01), emissiveIntensity: 0 });
  M.head = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2, emissive: new THREE.Color(1, 0.97, 0.92), emissiveIntensity: 0 });
  M.brick = mat('wo_brick', { color: 0x7d4636, rough: 0.85, wear: { wobble: 0.15, grime: 0.3, grimeH: 0.8, joints: { h: 0.075, l: 0.225, w: 0.009, k: 0.6, color: [0.62, 0.6, 0.56] } } });
  M.brick2 = mat('wo_brick2', { color: 0x8a5a44, rough: 0.85, wear: { wobble: 0.12, grime: 0.2, grimeH: 0.6, joints: { h: 0.075, l: 0.225, w: 0.009, k: 0.6, color: [0.7, 0.68, 0.63] } } });
  M.brickNew = mat('wo_brickNew', { color: 0x9a6a50, rough: 0.82, wear: { wobble: 0.1, joints: { h: 0.075, l: 0.225, w: 0.009, k: 0.55, color: [0.74, 0.72, 0.68] } } });
  M.coping = mat('wo_coping', { color: 0x4d5257, rough: 0.4, metal: 0.6 });
  M.alu = mat('wo_alu', { color: 0x9aa0a4, rough: 0.35, metal: 0.85 });
  M.concrete = concreteMaterial({ ...SURFACES.concreteYard, base: 0x9a968e, oil: 0.1, tracks: 0.1 });
  M.slab = concreteMaterial({ ...SURFACES.concreteFloor, base: 0x8f8c86, oil: 0.05, dirt: 0.15 });
  M.steel = steelMaterial({ ...SURFACES.primerGrey, top: 0x6c6e6c, wear: 0.2, rust: 0.15, age: 0.15 });
  M.crane = steelMaterial({ ...SURFACES.craneYellow, top: 0x8f8c84, wear: 0.4, rust: 0.2 });          // a grey crane: no yellow accent in this series
  M.joist = steelMaterial({ ...SURFACES.primerRed, top: 0x5f5e5a, primer: 0x5f5e5a, wear: 0.2, rust: 0.1 });
  M.wall = mat('wo_wall', { color: 0xe7e6e1, rough: 0.8 });
  M.floor = mat('wo_floor', { color: 0xbdbcb6, rough: 0.35 });
  M.counter = mat('wo_counter', { color: 0xc9c2b6, rough: 0.5 });
  M.ceiling = mat('wo_ceiling', { color: 0xdedcd6, rough: 0.9 });
  M.screen = new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.3, emissive: new THREE.Color(0.55, 0.75, 0.9), emissiveIntensity: 0 });
  M.windowWarm = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.15, emissive: new THREE.Color(1.0, 0.72, 0.42), emissiveIntensity: 0 });
  M.lamp = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3, emissive: new THREE.Color(1, 0.98, 0.95), emissiveIntensity: 0 });
  M.heater = mat('wo_heater', { color: 0x6e6f6b, rough: 0.5, metal: 0.4, wear: { grime: 0.5, grimeH: 0.5 } });
  M.duct = mat('wo_duct', { color: 0x3a3b3a, rough: 0.7 });
  M.scaffold = mat('wo_scaffold', { color: 0x7d8184, rough: 0.5, metal: 0.7 });
  M.box = mat('wo_box', { color: 0xc8b89a, rough: 0.8 });
  M.wet = new THREE.MeshStandardMaterial({ color: 0x5f5d59, roughness: 0.15, metalness: 0 });
  M.sling = mat('wo_sling', { color: 0x3a3f46, rough: 0.8 });
  M.signBlue = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0 });
  M.signBack = mat('wo_signBack', { color: 0x9a9fa2, rough: 0.5, metal: 0.6 });
  return M;
}

// ------------------------------------------------------------------ small builders
const lerp = (a, b, u) => a + (b - a) * u;
function noise1(x, seed = 1) { const i = Math.floor(x), f = x - i, h = n => { const s = Math.sin((n + seed * 17.13) * 127.1) * 43758.5453; return s - Math.floor(s); }; const u = f * f * (3 - 2 * f); return h(i) * (1 - u) + h(i + 1) * u; }
// a plough bank: a ribbon along z with a cross-section; the cut face (toward the road, side +1 or -1 in x) steep and striated, its foot
// grey-brown with salt and grit, its top clean. crest(z) -> [x, h]
function bank(z0, z1, crest, side, { seed = 1, step = 0.5, back = 3.0, foot = 0.45 } = {}) {
  const prof = [[-back, 0], [-back * 0.6, 0.35], [-back * 0.3, 0.75], [-0.6, 0.95], [-0.25, 1.0], [0, 1.0], [0.08, 0.97], [0.16, 0.8], [0.24, 0.5], [0.3, 0.22], [foot, 0.0]];
  const nz = Math.max(2, Math.ceil(Math.abs(z1 - z0) / step) + 1), np = prof.length, pos = [], col = [], idx = [];
  for (let i = 0; i < nz; i++) {
    const z = lerp(z0, z1, i / (nz - 1)), [xc, h] = crest(z);
    for (let j = 0; j < np; j++) {
      const [px, py] = prof[j], face = px > 0.05;
      // striations on the cut face (the plough wing's scrape), lumps on the top
      const st = face ? (noise1(z * 3.1 + py * 2, seed) - 0.5) * 0.06 + (noise1(z * 11 + py * 7, seed + 3) - 0.5) * 0.025 : (noise1(z * 0.7 + px, seed + 5) - 0.5) * 0.12 * py;
      const x = xc + side * (px + (face ? st : 0)), y = Math.max(0, py * h + (face ? 0 : st * h));
      pos.push(x, y, z);
      // colour: clean white top, a grey-brown salt-and-grit band at the foot of the cut face
      const g = face ? 1 - 0.55 * Math.max(0, 1 - py / 0.35) * (0.7 + 0.3 * noise1(z * 2.3, seed + 9)) : 1 - 0.04 * noise1(z * 0.4 + px, seed + 2);
      const r = face && py < 0.35 ? g * 0.95 : g;
      col.push(0.95 * r, 0.955 * g, 0.96 * g);
    }
  }
  for (let i = 0; i < nz - 1; i++) for (let j = 0; j < np - 1; j++) { const a = i * np + j, b = a + np; if (side > 0 === (z1 > z0)) idx.push(a, b, a + 1, a + 1, b, b + 1); else idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mats().bank); m.castShadow = true; m.receiveShadow = true; m.name = 'bank'; return m;
}
// the road's surface: packed snow with two pairs of dark tyre ruts, the yellow centre line half buried, salt-grey at the edges
function roadTexture(seed = 3) {
  return canvasTex(256, 1024, (g, w, h) => {
    const r = rng(seed);
    g.fillStyle = '#c9cbcc'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { const x = r() * w, y = r() * h, s = 1 + r() * 5, v = 180 + r() * 60; g.fillStyle = `rgba(${v},${v + 2},${v + 4},0.35)`; g.fillRect(x, y, s, s * 3); }
    // ruts (each lane: two wheel paths ~1.8 m apart on a 7 m road mapped to 256 px)
    const lane = w / 2, rut = (cx, wpx) => { for (let y = 0; y < h; y += 2) { const dx = (noise1(y * 0.02, seed + cx) - 0.5) * 6; const gr = g.createLinearGradient(cx + dx - wpx, 0, cx + dx + wpx, 0);
      gr.addColorStop(0, 'rgba(70,72,74,0)'); gr.addColorStop(0.5, `rgba(55,57,60,${0.55 + 0.25 * noise1(y * 0.05, seed)})`); gr.addColorStop(1, 'rgba(70,72,74,0)'); g.fillStyle = gr; g.fillRect(cx + dx - wpx, y, 2 * wpx, 2); } };
    for (const L of [0, 1]) { const c0 = L * lane; rut(c0 + lane * 0.27, 7); rut(c0 + lane * 0.73, 7); }
    // the centre line: double yellow, half buried in packed snow
    for (let y = 0; y < h; y += 3) { const vis = noise1(y * 0.03, seed + 7); if (vis < 0.45) continue; g.fillStyle = `rgba(196,160,40,${0.25 + 0.5 * (vis - 0.45)})`; g.fillRect(lane - 4, y, 2.5, 3); g.fillRect(lane + 1.5, y, 2.5, 3); }
    // drifted snow tongues across the lanes
    for (let i = 0; i < 40; i++) { const y = r() * h, x0 = r() * w * 0.3, len = w * (0.4 + r() * 0.6); g.fillStyle = 'rgba(240,242,244,0.55)'; g.beginPath(); g.ellipse(x0 + len / 2, y, len / 2, 6 + r() * 14, 0.05, 0, 6.283); g.fill(); }
  }, { repeat: [1, 1] });
}
// a spruce: stacked cones (snow lands on what faces up), dark, slightly irregular
function spruce(P, x, z, h, seed) {
  const r = rng(seed), tiers = 7 + Math.floor(r() * 3), base = h * (0.26 + r() * 0.05);
  P.add('bark', G.cyl(0.06 * h / 10, 0.14 * h / 10, h * 0.25, x, h * 0.12, z, 6));
  for (let i = 0; i < tiers; i++) { const u = i / tiers, rad = base * (1 - u) * (0.92 + r() * 0.16), y0 = h * (0.12 + 0.85 * u), ht = h * 0.22 * (1 - u * 0.4);
    P.add('spruce', new THREE.ConeGeometry(rad, ht, 7, 1, false, r() * 6).translate(x + (r() - 0.5) * 0.15, y0 + ht / 2, z + (r() - 0.5) * 0.15)); }
}
function bareTree(P, x, z, h, seed) {
  const r = rng(seed); const trunk = V3(x, 0, z), top = V3(x + (r() - 0.5) * 0.6, h * 0.55, z + (r() - 0.5) * 0.6);
  P.add('bark', G.rod(trunk, top, 0.12 * h / 12, 6));
  for (let i = 0; i < 9; i++) { const a = r() * 6.283, el = 0.5 + r() * 0.7, L = h * (0.25 + r() * 0.3), s = top.clone().lerp(trunk, r() * 0.4);
    const e = s.clone().add(V3(Math.cos(a) * Math.cos(el) * L, Math.sin(el) * L, Math.sin(a) * Math.cos(el) * L)); P.add('bark', G.rod(s, e, 0.035 * h / 12, 5));
    for (let k = 0; k < 3; k++) { const s2 = s.clone().lerp(e, 0.4 + r() * 0.5), a2 = a + (r() - 0.5) * 1.6, L2 = L * 0.4; P.add('bark', G.rod(s2, s2.clone().add(V3(Math.cos(a2) * L2 * 0.7, L2 * 0.6, Math.sin(a2) * L2 * 0.7)), 0.012 * h / 12, 4)); } }
}
// the hospital guide sign: a white H on highway blue, 610 x 610 mm, rounded corners, white border; galvanised U-channel post; snow
// plastered on the windward side and a 15 cm ridge along the top edge (a mesh: the cover shader paints, it does not build volume)
let _signTex = null;
function hSign({ bottom = 1.52, size = 0.61 } = {}) {
  const Mm = mats();
  if (!_signTex) _signTex = canvasTex(512, 512, (g, w) => {
    const R = 40; g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(0, 0, w, w, R); g.fill();
    g.fillStyle = '#0d4f9c'; g.beginPath(); g.roundRect(18, 18, w - 36, w - 36, R - 14); g.fill();      // FHWA guide blue
    g.fillStyle = '#ffffff'; const s = w * 0.56, x0 = (w - s) / 2, y0 = (w - s) / 2, st = s * 0.24;
    g.fillRect(x0, y0, st, s); g.fillRect(x0 + s - st, y0, st, s); g.fillRect(x0, y0 + s / 2 - st * 0.45, s, st * 0.9);
  });
  const grp = new THREE.Group(); grp.name = 'hsign';
  const sm = Mm.signBlue.clone(); sm.map = _signTex; sm.color.set(0xffffff); sm.roughness = 0.5;
  const panel = new THREE.Mesh(G.rbox(size, size, 0.012, 0.035, 0, bottom + size / 2, 0, 2), [Mm.signBack, Mm.signBack, Mm.signBack, Mm.signBack, sm, Mm.signBack]);
  panel.castShadow = true; grp.add(panel);
  // the U-channel post behind it
  const P = new Parts(); P.add('galv', G.box(0.065, bottom + size - 0.05, 0.03, 0, (bottom + size - 0.05) / 2, -0.03), G.box(0.012, bottom + size - 0.05, 0.05, -0.028, (bottom + size - 0.05) / 2, -0.05), G.box(0.012, bottom + size - 0.05, 0.05, 0.028, (bottom + size - 0.05) / 2, -0.05));
  for (const y of [bottom + 0.12, bottom + size - 0.12]) P.add('galv', G.cyl(0.008, 0.008, 0.05, 0, y, -0.01, 6).rotateX(Math.PI / 2).translate(0, 0, 0));
  grp.add(P.build({ galv: Mm.galv }));
  // the snow: a ridge along the top, a crust on the windward (left) border and up the post's windward side
  const S = new Parts(); const ridge = new THREE.CylinderGeometry(0.035, 0.05, size + 0.02, 10, 1).rotateZ(Math.PI / 2).scale(1, 1.6, 0.45).translate(0, bottom + size + 0.045, 0.0);
  S.add('snow', ridge, G.box(0.03, size * 0.9, 0.03, -size / 2 - 0.006, bottom + size * 0.52, 0.004), G.box(0.025, bottom + size - 0.1, 0.035, -0.045, (bottom + size - 0.1) / 2, -0.03));
  grp.add(S.build({ snow: Mm.snow }));
  grp.userData.panel = panel; return grp;
}
// a crew-cab pickup with a box, wheel wells, mirrors, lit tail and head lights. Front = +z. 5.8 x 2.0 x 1.9 m.
export function pickup({ seed = 1 } = {}) {
  const Mm = mats(), P = new Parts(), r = rng(seed);
  const L = 5.8, Wd = 2.0;
  const side = [[-2.9, 0.42], [-2.9, 1.18], [-0.35, 1.18], [-0.3, 1.88], [0.2, 1.92], [1.55, 1.9], [2.05, 1.32], [2.85, 1.24], [2.92, 1.0], [2.9, 0.42]];
  P.add('paint', G.extrude(side, Wd - 0.12).rotateY(Math.PI / 2).translate(0, 0, 0));
  // the bed walls (an open box)
  P.add('paint', G.box(Wd - 0.06, 0.1, 2.45, 0, 1.2, -1.62).translate(0, 0, 0));
  P.add('trim', G.box(Wd - 0.2, 0.05, 2.4, 0, 1.16, -1.62));
  // windows (dark glass) on the cab
  P.add('glass', G.box(Wd - 0.05, 0.5, 0.05, 0, 1.62, 1.78).rotateX(-0.42).translate(0, 0.05, 0.05), G.box(Wd - 0.04, 0.42, 1.6, 0, 1.62, 0.65), G.box(Wd - 0.1, 0.45, 0.04, 0, 1.6, -0.33));
  // bumpers, grille, mirrors
  P.add('trim', G.box(Wd + 0.02, 0.22, 0.18, 0, 0.52, 2.93), G.box(Wd, 0.2, 0.16, 0, 0.52, -2.95), G.box(1.3, 0.38, 0.05, 0, 0.92, 2.93));
  for (const s of [-1, 1]) P.add('trim', G.box(0.06, 0.2, 0.26, s * (Wd / 2 + 0.12), 1.38, 1.45), G.box(0.18, 0.04, 0.05, s * (Wd / 2 + 0.03), 1.33, 1.5));
  // wheels in their wells
  for (const z of [-1.85, 1.75]) for (const s of [-1, 1]) { P.add('tyre', G.cylX(0.4, 0.3, s * 0.86, 0.4, z, 20)); P.add('wheel', G.cylX(0.24, 0.32, s * 0.86, 0.4, z, 14)); P.add('trim', G.box(0.1, 0.12, 1.05, s * (Wd / 2 - 0.02), 0.86, z)); }
  const g = P.build({ paint: Mm.paint, trim: Mm.trim, glass: Mm.glassDark, tyre: Mm.tyre, wheel: Mm.wheel });
  // lamps: tail (vertical LED bars at the rear corners, 1.7 m apart), head (at the front corners)
  const tail = Mm.tail.clone(), head = Mm.head.clone();
  for (const s of [-1, 1]) { const t = new THREE.Mesh(G.box(0.1, 0.3, 0.03, s * 0.85, 1.0, -2.93), tail); t.castShadow = false; g.add(t); const h = new THREE.Mesh(G.box(0.3, 0.14, 0.03, s * 0.72, 1.02, 2.95), head); h.castShadow = false; g.add(h); }
  g.userData = { tail, head, tailPts: [V3(-0.85, 1.0, -2.98), V3(0.85, 1.0, -2.98)], headPts: [V3(-0.72, 1.02, 3.0), V3(0.72, 1.02, 3.0)], box: new THREE.Box3(V3(-1.1, 0, -3.0), V3(1.1, 2.0, 3.0)) };
  g.name = 'pickup'; return g;
}

// ------------------------------------------------------------------ ROAD (frame 0 and THE ROAD, ONTARIO) and ROAD2 (THE ROAD, UNITED STATES)
// The road runs along -z; its lanes are x in [x0 + 1, x0 + 8] (the centre line at x0 + 4.5); the camera of frame 0 stands on the left
// gravel shoulder at x0. `us`: bare maples instead of spruce, the pole line on the left.
function road(cover, { x0 = 0, us = false, seed = 1, z0 = 60, z1 = -2600 } = {}) {
  const Mm = mats(), grp = new THREE.Group(); grp.name = us ? 'road2' : 'road';
  const len = z0 - z1, zc = (z0 + z1) / 2;
  // the ground: snowfields both sides (a wide plane) and the road surface
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, len, 1, 1).rotateX(-Math.PI / 2).translate(x0 + 4.5, -0.02, zc), Mm.snow); ground.receiveShadow = true; ground.name = 'ground'; grp.add(ground);
  const rt = roadTexture(seed + 2); rt.repeat.set(1, len / 28);
  const rm = new THREE.MeshStandardMaterial({ map: rt, roughness: 0.75, color: 0xffffff });
  const surf = new THREE.Mesh(new THREE.PlaneGeometry(7.0, len).rotateX(-Math.PI / 2).translate(x0 + 4.5, 0.0, zc), rm); surf.receiveShadow = true; surf.name = 'road'; grp.add(surf);
  for (const [xa, xb] of [[x0 - 0.6, x0 + 1.0], [x0 + 8.0, x0 + 9.6]]) { const sh = new THREE.Mesh(new THREE.PlaneGeometry(xb - xa, len).rotateX(-Math.PI / 2).translate((xa + xb) / 2, 0.005, zc), Mm.snowGrey); sh.receiveShadow = true; grp.add(sh); }
  // the plough's banks: left (with the rise round the sign post at z ~ -9 in frame 0), right
  // frame 0: the crest runs through the sign's post (x0 - 0.19, z -9.02) at 1.30 m, so the snow comes to 0.22 m under the panel, and
  // sweeps back down toward the lens along the shoulder (the bank's top crosses the lower-left corner of the frame)
  const signZ = -9.02, signX = x0 - 0.19;
  const left = z => { const k = us ? 0 : Math.exp(-(((z - signZ) / 4.0) ** 2)), bx = x0 - 0.75 + 0.25 * Math.sin(z * 0.07 + seed), bh = (us ? 0.95 : 1.02) + 0.22 * noise1(z * 0.09, seed);
    return [bx + (signX - 0.05 - bx) * k, bh + (1.30 - bh) * k]; };
  const right = z => [x0 + 10.0 + 0.2 * Math.sin(z * 0.05 + seed * 2), 0.85 + 0.25 * noise1(z * 0.08, seed + 4)];
  for (let za = z0; za > z1; za -= 300) { const zb = Math.max(z1, za - 300); grp.add(bank(za, zb, left, +1, { seed: seed + za })); grp.add(bank(za, zb, right, -1, { seed: seed + 50 + za })); }
  // snow stakes along both edges (dark fibreglass with a small reflector)
  const ST = new Parts();
  for (let z = 20; z > -1600; z -= 30) for (const x of [x0 + 0.55, x0 + 8.45]) { const r = rng(Math.round(z * 7 + x)); if (r() < 0.1) continue; ST.add('stake', G.cyl(0.012, 0.016, 1.8, x, 0.9 + (r() - 0.5) * 0.05, z + r() * 2, 5)); }
  grp.add(ST.build({ stake: Mm.stake }, { shadows: false }));
  // the pole line (every 45 m) with its wires
  const px = us ? x0 - 6.5 : x0 + 14.0, poles = [];
  for (let z = 15; z > -1500; z -= 45) { const p = utilityPole({ seed: Math.round(-z) + seed, height: 11.5 + (Math.round(-z / 45) % 3) * 0.4, transformer: Math.round(-z / 45) % 7 === 3 }); p.position.set(px, 0, z); p.rotation.y = Math.PI / 2; grp.add(p); poles.push(p); }
  const WP = new Parts();
  for (let i = 0; i < poles.length - 1; i++) { const a = poles[i], b = poles[i + 1]; a.updateMatrixWorld(true); b.updateMatrixWorld(true);
    for (const ph of a.userData.meta?.anchors?.phases || []) { const pa = ph.clone().applyMatrix4(a.matrixWorld), pb2 = ph.clone().applyMatrix4(b.matrixWorld); WP.add('wire', wireSpan(pa, pb2, 0.55, 0.012)); } }
  grp.add(WP.build({ wire: mat('wo_wire', { color: 0x222222, rough: 0.5, metal: 0.5 }) }, { shadows: false }));
  // trees 30-80 m off: spruce (Ontario), bare maples and a few spruce (the U.S. road)
  const T = new Parts(), r = rng(seed + 99);
  for (let i = 0; i < 260; i++) { const sideL = r() < 0.5, d = 28 + r() * 60, x = sideL ? x0 - d : x0 + 9 + d, z = 30 - r() * 1500, h = 9 + r() * 9;
    if (us && r() < 0.75) bareTree(T, x, z, h * 0.9, i + seed); else spruce(T, x, z, h, i + seed); }
  grp.add(T.build({ bark: Mm.bark, spruce: Mm.spruce }, { shadows: false }));
  litPatchAll(grp); grp.traverse(o => { if (o.isMesh && o.material && !o.material.userData.whiteoutCover && o.name !== 'road') { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => cover(m)); } });
  return { group: grp, signZ, x0 };
}

// ------------------------------------------------------------------ a single-storey hospital (the dark one, the Houlton ER, the new one)
// Faces +z (its entrance side); centre x = 0; ground 0. { len, depth, h, brick, lit, canopy: { x, w, d, h }, doors: true, windows: 'dark'|'warm' }
function hospital({ len = 60, depth = 24, h = 4.8, brick = 'brick', windows = 'dark', canopy = { x: 8, w: 9, d: 7, h: 4.0 }, bay = true, doors = false, seed = 1 } = {}) {
  const Mm = mats(), P = new Parts(), grp = new THREE.Group();
  // the walls (brick), the metal coping, the roof with its units
  P.add('brick', G.box(len, h, 0.35, 0, h / 2, depth / 2 - 0.175), G.box(len, h, 0.35, 0, h / 2, -depth / 2 + 0.175), G.box(0.35, h, depth, -len / 2 + 0.175, h / 2, 0), G.box(0.35, h, depth, len / 2 - 0.175, h / 2, 0));
  P.add('coping', G.box(len + 0.1, 0.22, 0.45, 0, h + 0.1, depth / 2 - 0.15), G.box(len + 0.1, 0.22, 0.45, 0, h + 0.1, -depth / 2 + 0.15), G.box(0.45, 0.22, depth, -len / 2 + 0.15, h + 0.1, 0), G.box(0.45, 0.22, depth, len / 2 - 0.15, h + 0.1, 0));
  P.add('roof', G.box(len - 0.2, 0.2, depth - 0.2, 0, h - 0.1, 0));
  const r = rng(seed);
  for (let i = 0; i < 5; i++) P.add('coping', G.box(2.2 + r() * 1.4, 1.1, 1.6 + r(), -len / 2 + 8 + i * len / 5.5, h + 0.55, (r() - 0.5) * depth * 0.5));
  // ribbon windows on the front: a band 1.1 m tall at sill 1.0 m, with mullions every 1.5 m (skipping the entrance and the bay)
  const win = windows === 'warm' ? 'winWarm' : 'winDark';
  const skip = x => (canopy && Math.abs(x - canopy.x) < canopy.w / 2 + 1.0) || (bay && Math.abs(x - (canopy.x - canopy.w)) < 2.2);
  for (let x = -len / 2 + 2; x < len / 2 - 2; x += 1.5) { if (skip(x)) continue;
    P.add(win, G.box(1.45, 1.1, 0.05, x + 0.75, 1.55, depth / 2 + 0.005)); P.add('alu', G.box(0.06, 1.2, 0.08, x, 1.55, depth / 2 + 0.02)); }
  P.add('alu', G.box(len - 4, 0.06, 0.1, 0, 2.12, depth / 2 + 0.02), G.box(len - 4, 0.08, 0.14, 0, 0.98, depth / 2 + 0.04));
  // the ambulance canopy and the entrance
  if (canopy) {
    const { x, w, d, h: ch } = canopy;
    P.add('coping', G.box(w, 0.55, d, x, ch + 0.28, depth / 2 + d / 2), G.box(w + 0.1, 0.12, d + 0.1, x, ch + 0.6, depth / 2 + d / 2));
    for (const s of [-1, 1]) P.add('alu', G.box(0.35, ch, 0.35, x + s * (w / 2 - 0.4), ch / 2, depth / 2 + d - 0.4));
    P.add('ceil', G.box(w - 0.1, 0.02, d - 0.1, x, ch - 0.01, depth / 2 + d / 2));
  }
  if (bay && canopy) { const bx = canopy.x - canopy.w; P.add('door', G.box(3.6, 3.2, 0.12, bx, 1.6, depth / 2 + 0.06)); for (let k = 0; k < 10; k++) P.add('alu', G.box(3.6, 0.025, 0.02, bx, 0.3 + k * 0.3, depth / 2 + 0.13)); }
  grp.add(P.build({ brick: Mm[brick], coping: Mm.coping, roof: Mm.snow, winDark: Mm.glassDark, winWarm: Mm.windowWarm, alu: Mm.alu, ceil: Mm.ceiling, door: Mm.coping }));
  grp.userData = { len, depth, h, canopy };
  return grp;
}
// the entrance: two pairs of sliding glass doors with a vestibule, the nurses' station inside under fluorescent battens, a corridor
function entrance({ x = 8, depth = 24, doorW = 2.6, doorH = 2.4, vest = 3.0, stationZ = 5.5, glass }) {
  const Mm = mats(), P = new Parts(), grp = new THREE.Group(), fz = depth / 2;
  // the opening in the front wall (frame), the outer and inner door pairs (each two leaves), the vestibule's side walls
  for (const z of [fz + 0.02, fz - vest]) { P.add('alu', G.box(doorW + 0.3, 0.18, 0.15, x, doorH + 0.09, z), G.box(0.12, doorH, 0.15, x - doorW / 2 - 0.09, doorH / 2, z), G.box(0.12, doorH, 0.15, x + doorW / 2 + 0.09, doorH / 2, z), G.box(0.06, doorH, 0.12, x, doorH / 2, z)); }
  P.add('wall', G.box(0.2, doorH + 0.3, vest, x - doorW / 2 - 0.25, (doorH + 0.3) / 2, fz - vest / 2), G.box(0.2, doorH + 0.3, vest, x + doorW / 2 + 0.25, (doorH + 0.3) / 2, fz - vest / 2));
  P.add('ceil', G.box(doorW + 0.6, 0.05, vest, x, doorH + 0.32, fz - vest / 2), G.box(16, 0.05, 12, x, 2.9, fz - vest - 6));
  P.add('floor', G.box(16, 0.04, 12 + vest, x, 0.02, fz - (12 + vest) / 2 + 0.2));
  // the interior: the station (an L counter, monitors), the back wall, a corridor going back to the left
  const sz = fz - vest - stationZ;
  P.add('counter', G.box(4.2, 1.07, 0.75, x + 0.4, 0.535, sz), G.box(0.75, 1.07, 2.2, x + 2.15, 0.535, sz - 1.4), G.box(4.4, 0.04, 0.85, x + 0.4, 1.09, sz));
  P.add('wall', G.box(14, 2.9, 0.2, x, 1.45, sz - 4.0), G.box(0.2, 2.9, 8, x + 5.5, 1.45, sz - 0.5), G.box(0.2, 2.9, 5, x - 3.2, 1.45, sz - 1.5));
  P.add('wall', G.box(0.2, 2.9, 10, x - 6.5, 1.45, sz - 2), G.box(3.2, 0.06, 10, x - 4.9, 2.6, sz - 2));
  for (const dx of [-0.8, 0.6, 1.9]) { P.add('trim', G.box(0.55, 0.36, 0.04, x + dx, 1.35, sz - 0.12).rotateX(-0.12)); P.add('screen', G.box(0.5, 0.31, 0.01, x + dx, 1.35, sz - 0.095).rotateX(-0.12)); }
  // battens (their light comes from the practicals; these are the fixtures' diffusers)
  const battens = [];
  for (const [bx, bz] of [[x - 1, sz + 1.2], [x + 1.6, sz + 1.2], [x - 1, sz - 1.4], [x + 1.6, sz - 1.4], [x - 4.9, sz - 3], [x - 4.9, sz + 0.5], [x, fz - vest / 2]]) {
    P.add('lamp', G.box(1.2, 0.03, 0.18, bx, (bz > fz - vest ? doorH + 0.3 : 2.87), bz)); battens.push([bx, bz > fz - vest ? doorH + 0.28 : 2.85, bz]); }
  grp.add(P.build({ alu: Mm.alu, wall: Mm.wall, ceil: Mm.ceiling, floor: Mm.floor, counter: Mm.counter, trim: Mm.trim, screen: Mm.screen, lamp: Mm.lamp }));
  // the glass: four leaves on each pair (salt haze at the foot of the outer pair, condensation in the corners)
  const G1 = new THREE.Group(); G1.name = 'doors';
  for (const [z, outer] of [[fz + 0.02, true], [fz - vest, false]]) for (const s of [-1, 1]) { const leaf = new THREE.Mesh(new THREE.PlaneGeometry(doorW / 2 - 0.05, doorH - 0.05), outer ? glass.outer : glass.inner); leaf.position.set(x + s * doorW / 4, doorH / 2, z + 0.03); leaf.userData.noPrepass = true; leaf.renderOrder = 2; G1.add(leaf); }
  grp.add(G1);
  grp.userData = { battens, station: V3(x + 0.4, 0, sz), stationBack: V3(x + 0.4, 0, sz - 1.2), doors: V3(x, 0, fz), vest, sz };
  return grp;
}
// glass for the doors: a dielectric over the interior, transparent, its own haze texture (salt along the foot, fog in the corners)
function doorGlass({ haze = 0.8 } = {}) {
  const tex = canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h); const r = rng(5);
    const gr = g.createLinearGradient(0, h, 0, h * 0.72); gr.addColorStop(0, `rgba(230,232,230,${0.55 * haze})`); gr.addColorStop(1, 'rgba(230,232,230,0)'); g.fillStyle = gr; g.fillRect(0, h * 0.7, w, h * 0.3);
    for (const [cx, cy] of [[0, 0], [w, 0], [0, h], [w, h]]) { const rg = g.createRadialGradient(cx, cy, 0, cx, cy, w * 0.32); rg.addColorStop(0, `rgba(235,238,240,${0.5 * haze})`); rg.addColorStop(1, 'rgba(235,238,240,0)'); g.fillStyle = rg; g.fillRect(0, 0, w, h); }
    for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(240,240,240,${0.15 * r()})`; g.fillRect(r() * w, h * (0.75 + 0.25 * r()), 2 + r() * 4, 1 + r() * 2); }
  });
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.06, metalness: 0, transmission: 0, transparent: true, opacity: 0.16, depthWrite: false, envMapIntensity: 1.4, specularIntensity: 1, ior: 1.52, alphaMap: null, map: tex, side: THREE.DoubleSide });
  m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.a = clamp(0.1 + texture2D(map, vMapUv).a * 0.85, 0.0, 1.0);'); };
  m.customProgramCacheKey = () => 'wo_doorglass';
  return m;
}

// ------------------------------------------------------------------ the lot: ground, banks, pole lights, tyre tracks
function lot(cover, { x0, z0 = 12, len = 70, tracks = true, poles = [] }) {
  const Mm = mats(), grp = new THREE.Group();
  const g = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2).translate(x0, -0.02, z0 + 200), Mm.snow); g.receiveShadow = true; grp.add(g);
  if (tracks) { const tt = canvasTex(64, 512, (c, w, h) => { c.clearRect(0, 0, w, h); for (const cx of [14, 50]) for (let y = 0; y < h; y += 2) { c.fillStyle = `rgba(150,155,160,${0.45 + 0.2 * noise1(y * 0.05, cx)})`; c.fillRect(cx - 5 + (noise1(y * 0.01, 3) - 0.5) * 4, y, 10, 2); } });
    const tm = new THREE.MeshStandardMaterial({ map: tt, transparent: true, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const tr = new THREE.Mesh(new THREE.PlaneGeometry(2.0, len).rotateX(-Math.PI / 2).translate(x0 + 8, 0.01, z0 + len / 2), tm); tr.userData.noPrepass = true; tr.receiveShadow = true; grp.add(tr); }
  const P = new Parts();
  for (const [px, pz] of poles) { P.add('galv', G.cyl(0.08, 0.12, 8.0, px, 4.0, pz, 10), G.box(0.9, 0.12, 0.45, px, 8.0, pz + 0.2)); }
  if (poles.length) grp.add(P.build({ galv: Mm.galv }));
  litPatchAll(grp); grp.traverse(o => { if (o.isMesh && !o.material.transparent && o.material !== Mm.snow) cover(o.material); });
  return grp;
}

// ------------------------------------------------------------------ THE SITE: slab, first steel, two heated enclosures, crane, joists
function wf(P, key, a, b, d = 0.3, bf = 0.2, tw = 0.012, tf = 0.018) {     // a wide-flange member from a to b (web vertical for beams)
  const dir = b.clone().sub(a), L = dir.length(), mid = a.clone().add(b).multiplyScalar(0.5), vert = Math.abs(dir.y) > 0.9 * L;
  const g = G.merge([G.box(tw, d - 2 * tf, L, 0, 0, 0), G.box(bf, tf, L, 0, d / 2 - tf / 2, 0), G.box(bf, tf, L, 0, -d / 2 + tf / 2, 0)]);
  const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), dir.clone().normalize()); if (vert) q.multiply(new THREE.Quaternion().setFromAxisAngle(V3(0, 0, 1), Math.PI / 2));
  g.applyQuaternion(q).translate(mid.x, mid.y, mid.z); P.add(key, g);
}
function joist(P, key, a, b, depth = 0.6) {                              // an open-web steel joist: two chords and a zig-zag of rods
  const n = Math.max(2, Math.round(a.distanceTo(b) / 0.6)), up = V3(0, depth, 0);
  P.add(key, G.rod(a, b, 0.025, 4), G.rod(a.clone().add(up), b.clone().add(up), 0.025, 4));
  for (let i = 0; i < n; i++) { const u0 = i / n, u1 = (i + 1) / n, p0 = a.clone().lerp(b, u0).add(i % 2 ? up : V3()), p1 = a.clone().lerp(b, u1).add(i % 2 ? V3() : up); P.add(key, G.rod(p0, p1, 0.011, 4)); }
}
export function crane({ boomAng = 1.02, boomLen = 34, slew = 0 } = {}) {
  const Mm = mats(), P = new Parts(), grp = new THREE.Group();
  // the carrier: a long chassis on four axles, the outriggers down on pads
  P.add('crane', G.box(2.6, 1.1, 13, 0, 1.45, 0), G.box(2.5, 1.5, 2.3, 0, 2.2, 5.9));
  for (const z of [-4.6, -3.0, 2.4, 4.0]) for (const s of [-1, 1]) P.add('tyre', G.cylX(0.62, 0.5, s * 1.15, 0.62, z, 16));
  for (const z of [-5.4, 4.9]) for (const s of [-1, 1]) { P.add('crane', G.box(3.2, 0.3, 0.35, s * 2.6, 1.1, z), G.cyl(0.1, 0.1, 1.0, s * 4.1, 0.55, z, 8)); P.add('pad', G.box(0.7, 0.12, 0.7, s * 4.1, 0.06, z)); }
  const sup = new THREE.Group(); sup.position.set(0, 2.0, -1.5); sup.rotation.y = slew; grp.add(sup);
  const S = new Parts();
  S.add('crane', G.box(3.0, 1.6, 5.2, 0, 0.8, -0.5), G.box(2.6, 1.4, 1.4, 0, 0.75, -3.6), G.box(1.2, 1.7, 1.8, 1.1, 1.85, 1.0));
  S.add('glass', G.box(1.0, 0.9, 0.05, 1.1, 2.15, 1.92));
  const boom = new THREE.Group(); boom.position.set(0, 1.9, -2.2); boom.rotation.x = -boomAng; sup.add(boom);
  const B = new Parts(); for (let k = 0; k < 4; k++) { const w = 1.3 - k * 0.18, h = 1.5 - k * 0.2, z0 = k * boomLen / 4 * 0.95; B.add('crane', G.box(w, h, boomLen / 4 + 0.6, 0, 0, z0 + boomLen / 8)); }
  B.add('crane', G.box(0.7, 0.9, 0.9, 0, 0, boomLen + 0.2));
  boom.add(B.build({ crane: Mm.crane }));
  sup.add(S.build({ crane: Mm.crane, glass: Mm.glassDark }));
  grp.add(P.build({ crane: Mm.crane, tyre: Mm.tyre, pad: Mm.trim }));
  // the hook block (positioned per frame by the scene under the boom tip), its line
  const hook = new THREE.Group(); const HB = new Parts(); HB.add('crane', G.box(0.55, 0.9, 0.35, 0, 0, 0)); HB.add('steel', G.cyl(0.04, 0.06, 0.4, 0, -0.62, 0, 8));
  hook.add(HB.build({ crane: Mm.crane, steel: Mm.galv })); grp.add(hook);
  const line = new THREE.Mesh(G.cyl(0.018, 0.018, 1, 0, 0.5, 0, 6), Mm.trim); grp.add(line);
  grp.userData = { boom, sup, hook, line, boomLen, boomAng };
  return grp;
}
export function boomTip(cr) { const { boom, boomLen } = cr.userData; cr.updateMatrixWorld(true); return V3(0, 0, boomLen + 0.4).applyMatrix4(boom.matrixWorld); }

function enclosureShell(W, { size = [12, 4, 10], at, yaw = 0, lights, exposure }) {
  const Mm = mats(), [X, Y, Z] = size, grp = new THREE.Group(); grp.position.set(...at); grp.rotation.y = yaw;
  const E = W.enclosure({ size, at, yaw, lights, tau: 0.38 }, exposure);
  // the poly over the frame: four walls and a low pitched roof; it glows tau E / pi from inside (energy-consistent with its lamps)
  const shell = new THREE.Mesh(G.merge([G.box(X, Y, 0.02, 0, Y / 2, Z / 2), G.box(X, Y, 0.02, 0, Y / 2, -Z / 2), G.box(0.02, Y, Z, X / 2, Y / 2, 0), G.box(0.02, Y, Z, -X / 2, Y / 2, 0),
    G.box(X, 0.02, Z / 2 + 0.3, 0, Y + 0.45, Z / 4).rotateX(0.16).translate(0, 0, 0), G.box(X, 0.02, Z / 2 + 0.3, 0, Y + 0.45, -Z / 4).rotateX(-0.16)]), E.mat);
  shell.name = 'tarp'; grp.add(shell);
  // the scaffold frame showing through as darker lines (outside): standards every 2 m, ledgers at 2 m
  const P = new Parts();
  for (let x = -X / 2; x <= X / 2 + 1e-6; x += 2) for (const z of [-Z / 2 - 0.03, Z / 2 + 0.03]) P.add('scaffold', G.cyl(0.024, 0.024, Y, x, Y / 2, z, 6));
  for (let z = -Z / 2; z <= Z / 2 + 1e-6; z += 2) for (const x of [-X / 2 - 0.03, X / 2 + 0.03]) P.add('scaffold', G.cyl(0.024, 0.024, Y, x, Y / 2, z, 6));
  for (const y of [2, Y]) { P.add('scaffold', G.box(X, 0.05, 0.05, 0, y, Z / 2 + 0.04), G.box(X, 0.05, 0.05, 0, y, -Z / 2 - 0.04), G.box(0.05, 0.05, Z, X / 2 + 0.04, y, 0), G.box(0.05, 0.05, Z, -X / 2 - 0.04, y, 0)); }
  grp.add(P.build({ scaffold: Mm.scaffold }));
  // the flap (a hinged tarp panel on the +x end), drawn aside by the scene
  const flap = new THREE.Group(); flap.position.set(X / 2 + 0.01, 0, -1.2); const fm = new THREE.Mesh(G.box(0.02, Y - 0.2, 2.4, 0, (Y - 0.2) / 2, 1.2), E.mat); flap.add(fm); grp.add(flap);
  grp.userData = { E, flap, size };
  return grp;
}
function heater(P, x, z, yaw = 0) {   // an indirect-fired heater on skids with its duct
  const c = Math.cos(yaw), s = Math.sin(yaw), at = (dx, dz) => [x + c * dx + s * dz, z - s * dx + c * dz];
  const [hx, hz] = at(0, 0); P.add('heater', G.box(1.2, 1.3, 2.6, hx, 0.85, hz).rotateY(0), G.box(1.4, 0.12, 2.9, hx, 0.12, hz));
  const [ex, ez] = at(0, -1.4); P.add('heater', G.cyl(0.18, 0.18, 1.2, ex, 2.0, ez, 10));
  const [dx, dz] = at(0.0, 1.3); P.add('duct', G.tube([V3(dx, 1.0, dz), V3(dx, 1.0, dz + 1.2), V3(dx + 0.3, 1.2, dz + 2.4)], 0.28, 16, 10));
}
function site(W, cover, { x0, exposure, finished = false }) {
  const Mm = mats(), grp = new THREE.Group(), r = rng(9);
  const g = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2).translate(x0, -0.02, 0), Mm.snow); g.receiveShadow = true; grp.add(g);
  // the slab-on-grade 60 x 30 m (its north half under the two enclosures is fresh and bare), a little proud of the snow
  const slab = new THREE.Mesh(G.box(60, 0.25, 30, x0, 0.1, 0), Mm.slab); slab.receiveShadow = true; slab.castShadow = true; grp.add(slab); cover(Mm.slab, { depth: 0.85 });
  const P = new Parts();
  // the first steel: columns on a 7.5 m grid over the south bays, the beam line along the near edge
  const cols = []; for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) { const x = x0 - 26 + i * 7.5, z = 12 - j * 7.5; cols.push([x, z]); wf(P, 'steel', V3(x, 0.2, z), V3(x, 5.2, z), 0.31, 0.25); }
  for (let i = 0; i < 5; i++) wf(P, 'steel', V3(x0 - 26 + i * 7.5, 5.0, 12), V3(x0 - 26 + (i + 1) * 7.5, 5.0, 12), 0.45, 0.19);
  for (let i = 0; i < 3; i++) wf(P, 'steel', V3(x0 - 26 + i * 7.5, 5.0, 4.5), V3(x0 - 26 + (i + 1) * 7.5, 5.0, 4.5), 0.45, 0.19);
  for (let i = 0; i < 2; i++) for (let k = 1; k < 5; k++) joist(P, 'joist', V3(x0 - 26 + i * 7.5 + k * 1.5, 5.25, 12), V3(x0 - 26 + i * 7.5 + k * 1.5, 5.25, 4.5), 0.55);
  // the joist bundle with its slings, on dunnage by the slab's east end (it rises at the action cut)
  const bundle = new THREE.Group(); bundle.position.set(x0 + 14, 0.25, 9.0); const JB = new Parts();
  for (let k = 0; k < 6; k++) joist(JB, 'joist', V3(-4.5, 0.12 + (k % 2) * 0.66, -0.6 + Math.floor(k / 2) * 0.4), V3(4.5, 0.12 + (k % 2) * 0.66, -0.6 + Math.floor(k / 2) * 0.4), 0.5);
  JB.add('dunnage', G.box(0.15, 0.1, 1.6, -3.0, 0.05, 0), G.box(0.15, 0.1, 1.6, 3.0, 0.05, 0));
  bundle.add(JB.build({ joist: Mm.joist, dunnage: Mm.bark }));
  const slings = new THREE.Group(); bundle.add(slings);
  grp.add(bundle);
  // two heated enclosures over the fresh north bays; heaters and their ducts outside
  const workLight = (lx, ly, lz) => ({ pos: [lx, ly, lz], cd: 20000 / (2 * Math.PI * (1 - Math.cos(0.75))) * 1.0, rgb: [1, 0.68, 0.38] });
  const encs = [];
  for (const [ex, ez] of [[x0 - 14, -8.0], [x0 + 2, -8.0]]) {
    const lights = [workLight(ex - 3, 3.2, ez - 2), workLight(ex + 3, 3.2, ez - 2), workLight(ex - 3, 3.2, ez + 2), workLight(ex + 3, 3.2, ez + 2)];
    const e = enclosureShell(W, { size: [12, 4, 10], at: [ex, 0.22, ez], lights, exposure }); grp.add(e); encs.push({ g: e, at: [ex, 0.22, ez], lights });
    heater(P, ex + 7.6, ez + 3.0, 0.3);
  }
  // the inside of the first enclosure (THE HEAT): the pour at the far end, a pump hose, the fresh slab wet, work lights on stands
  const I = new Parts(), [ix, , iz] = encs[0].at;
  I.add('wet', G.box(5.0, 0.04, 9.6, ix + 3.2, 0.24, iz));
  I.add('duct', G.tube([V3(ix - 5.5, 0.4, iz + 3.6), V3(ix - 1.0, 0.35, iz + 3.0), V3(ix + 2.4, 0.6, iz + 1.0), V3(ix + 3.6, 0.9, iz - 1.4)], 0.07, 24, 8));
  for (const L of encs[0].lights) I.add('scaffold', G.cyl(0.02, 0.03, L.pos[1], L.pos[0], L.pos[1] / 2 + 0.22, L.pos[2], 6)), I.add('lamp', G.box(0.35, 0.25, 0.1, L.pos[0], L.pos[1] + 0.22, L.pos[2]));
  // a screed board and a rake by the pour; a stack of supply boxes (L17 carries one across the light)
  I.add('trim', G.box(3.0, 0.05, 0.12, ix + 2.0, 0.3, iz - 1.2), G.rod(V3(ix + 2.6, 0.27, iz + 0.6), V3(ix + 1.2, 1.5, iz + 1.4), 0.02, 5));
  for (let k = 0; k < 5; k++) I.add('box', G.box(0.5, 0.35, 0.4, ix - 4.2 + (k % 2) * 0.55, 0.42 + Math.floor(k / 2) * 0.36, iz + 3.6));
  const inner = I.build({ wet: Mm.wet, duct: Mm.duct, scaffold: Mm.scaffold, lamp: Mm.lamp, trim: Mm.trim, box: Mm.box });
  grp.add(inner);
  grp.add(P.build({ steel: Mm.steel, joist: Mm.joist, heater: Mm.heater, duct: Mm.duct }));
  // the crane, set up on the slab's south side, its boom over the bundle
  const cr = crane({ boomAng: 1.08, boomLen: 30 }); cr.position.set(x0 + 26, 0, 22); cr.rotation.y = Math.PI * 0.86; grp.add(cr);
  // the dusk lamps: tower lights round the site
  const lp = new Parts(); for (const [lx, lz] of [[x0 - 34, 20], [x0 + 34, -18]]) lp.add('galv', G.cyl(0.07, 0.1, 9, lx, 4.5, lz, 8)); grp.add(lp.build({ galv: Mm.galv }));
  litPatchAll(grp);
  grp.traverse(o => { if (o.isMesh && o.material && !o.material.transparent && o.name !== 'tarp') { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { if (m !== Mm.wet && m !== Mm.box && m !== Mm.lamp) cover(m); }); } });
  return { group: grp, bundle, slings, encs, crane: cr, cols, inner };
}

// ------------------------------------------------------------------ the world
export class World {
  constructor(scene, W, { exposure = {} } = {}) {
    this.scene = scene; this.W = W; mats();
    const cover = (m, o = {}) => W.cover(m, o);
    this.sets = {};
    // ROAD and ROAD2
    const R1 = road(cover, { x0: SETS.ROAD[0], seed: 1 }); this.sets.road = R1.group;
    const sign = this.sign = hSign(); this.sets.road.add(sign);
    const R2 = road(cover, { x0: SETS.ROAD2[0], us: true, seed: 7 }); this.sets.road2 = R2.group;
    const sign2 = this.sign2 = hSign(); sign2.position.set(SETS.ROAD2[0] + 9.3, 0.35, -1200); sign2.rotation.y = 0; this.sets.road2.add(sign2);
    litPatchAll(sign); litPatchAll(sign2); for (const s of [sign, sign2]) s.traverse(o => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => cover(m, { depth: 1, plaster: 1 })); });
    // DARK: the dark hospital, seen from 140 m across the field (the camera looks +x at its entrance side)
    const dk = new THREE.Group(); const hd = hospital({ brick: 'brick', windows: 'dark', canopy: { x: 6, w: 9, d: 7, h: 4.0 }, seed: 3 }); hd.rotation.y = -Math.PI / 2; hd.position.set(SETS.DARK[0] + 12, 0, 0); dk.add(hd);
    dk.add(lot(cover, { x0: SETS.DARK[0] - 60, z0: -40, tracks: false, poles: [[SETS.DARK[0] - 20, 20], [SETS.DARK[0] - 20, -26]] }));
    litPatchAll(dk); dk.traverse(o => { if (o.isMesh && !o.material.transparent) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => cover(m, { plaster: 1.2 })); });
    { const D = new Parts(); D.add('door', G.box(0.08, 2.15, 1.0, SETS.DARK[0] - 0.04, 1.075, 1.8)); D.add('coping', G.box(0.35, 0.25, 0.3, SETS.DARK[0] - 0.18, 3.4, 1.8));
      const dd = D.build({ door: mats().coping, coping: mats().trim }); litPatchAll(dd); dk.add(dd); }
    this.sets.dark = dk; this.darkWallPack = V3(SETS.DARK[0] - 0.3, 3.3, 1.8);
    // ER: the Houlton entrance at night (the building faces +z; the camera stands out in the lot)
    const er = new THREE.Group(), ex = SETS.ER[0];
    this.glass = { outer: doorGlass({ haze: 1 }), inner: doorGlass({ haze: 0.35 }) };
    const he = hospital({ brick: 'brick2', windows: 'dark', canopy: { x: 0, w: 9, d: 7, h: 4.0 }, bay: false, seed: 5 }); he.position.set(ex, 0, -12); er.add(he);
    const en = entrance({ x: 0, depth: 24, glass: this.glass }); en.position.set(ex, 0, -12); er.add(en);
    er.add(lot(cover, { x0: ex, z0: 0, tracks: true, poles: [[ex - 14, 18], [ex + 12, 30]] }));
    // the lit ploughed bank in the lot (the type's ground in HOULTON, NIGHT): across the view, 1.1 m
    { const b = bank(-14, 14, () => [0, 1.1], 1, { seed: 41, step: 0.4 }); b.rotation.y = Math.PI / 2; b.position.set(ex, 0, 14); er.add(b); }
    litPatchAll(er); er.traverse(o => { if (o.isMesh && o.material && !o.material.transparent && o.parent?.name !== 'doors') (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (![mats().wall, mats().floor, mats().counter, mats().ceiling, mats().lamp, mats().screen, mats().trim].includes(m)) cover(m, { plaster: 0.6 }); }); });
    this.sets.er = er; this.er = { root: er, entrance: en, hosp: he, x: ex };
    // the exit road beyond the lot (THE LOT, LOOKING OUT): straight away from the doors
    // SITE and NEW
    const st = site(W, cover, { x0: SETS.SITE[0], exposure: exposure.site ?? 1 }); this.sets.site = st.group; this.site = st;
    const nw = new THREE.Group(), nx = SETS.SITE[0];
    const hn = hospital({ len: 60, depth: 30, h: 5.0, brick: 'brickNew', windows: 'warm', canopy: { x: 8, w: 10, d: 7.5, h: 4.0 }, bay: false, seed: 8 }); hn.position.set(nx, 0, 0); nw.add(hn);
    this.glassNew = { outer: doorGlass({ haze: 0.2 }), inner: doorGlass({ haze: 0.1 }) };
    const enn = entrance({ x: 8, depth: 30, glass: this.glassNew }); enn.position.set(nx, 0, 0); nw.add(enn);
    nw.add(lot(cover, { x0: nx, z0: 16, tracks: false, poles: [[nx - 6, 34], [nx + 22, 34]] }));
    // the ploughed lane to the door
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(6, 120).rotateX(-Math.PI / 2).translate(nx + 8, 0.004, 15 + 60), mats().snowGrey); lane.receiveShadow = true; nw.add(lane);
    litPatchAll(nw); nw.traverse(o => { if (o.isMesh && o.material && !o.material.transparent && o.parent?.name !== 'doors') (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (![mats().wall, mats().floor, mats().counter, mats().ceiling, mats().lamp, mats().screen, mats().trim, mats().windowWarm].includes(m)) cover(m, { plaster: 0.4 }); }); });
    this.sets.newh = nw; this.newh = { root: nw, entrance: enn, hosp: hn, x: nx };
    // the pickups (one moves set to set)
    this.pick = pickup({ seed: 2 }); litPatchAll(this.pick); scene.add(this.pick);
    for (const s of Object.values(this.sets)) { s.visible = false; scene.add(s); }
    this.road1 = R1; this.road2 = R2;
  }
  show(name) { for (const [k, s] of Object.entries(this.sets)) s.visible = k === name || (Array.isArray(name) && name.includes(k)); }
}
