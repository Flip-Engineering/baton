// THE CHASM: the world. A concrete frame tower going up in a city at golden hour: the floors (one a bar), the glazed lower floors, the
// open bay up the facade between the crew's hoist and the owner's glass car, the stair core between them with the number painted on it
// at the mark's floor, the top deck with its climbing screen, the owner's lit glass pavilion and the tower crane, the hoist mast and
// its cage, the glass car on its rails, and the city round the site. Every part is built once; the plan (the_chasm.plan.js) moves it.
// Facade: the plane z = 0 facing +z. Units: metres.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { boxGeometry, concreteMaterial, steelMaterial, glassMaterial, SURFACES } from '../lib/fx/light/surface.js';
import { litPatch } from '../lib/fx/light/patch.js';
import { FLOOR, MARK_FLOOR, NUMBER, CORE } from './the_chasm.plan.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const merge = gs => mergeGeometries(gs.filter(Boolean), false);
const std = (o = {}) => litPatch(new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0, ...o }));
function rngOf(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const shadowed = (m, cast = true, recv = true) => { m.castShadow = cast; m.receiveShadow = recv; return m; };

export const W = 36, D = 24, MAXF = 70;                  // footprint x -18..18, z -24..0; floors built up to MAXF
const X0 = -18, X1 = 18, BAY = [-9.9, -0.2];              // the open bay: from the hoist to the car's rails, never glazed
const COLS = [-18, -13.6, -9.9, 0, 4.5, 9, 13.5, 18];

// ---------------------------------------------------------------- textures (canvas)
function canvasTex(w, h, draw, { srgb = true, repeat = null } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
// the hoist's wire mesh: welded 50 mm squares of 4 mm wire
const meshTex = () => canvasTex(256, 256, (g, w, h) => { g.clearRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 3; for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, h); g.stroke(); g.beginPath(); g.moveTo(0, i * 32); g.lineTo(w, i * 32); g.stroke(); } }, { srgb: false, repeat: [1, 1] });
// the number, sprayed through a stencil in hi-vis orange on the core wall at the landing: a level line, the benchmark triangle, overspray
async function numberTex(text) {
  const F = 'Big Shoulders Stencil Display';
  try { const f = new FontFace(F, 'url(../node_modules/@fontsource/big-shoulders-stencil-display/files/big-shoulders-stencil-display-latin-800-normal.woff2)', { weight: '800' }); document.fonts.add(await f.load()); } catch (e) { console.log('the_chasm: stencil font', e.message); }
  return canvasTex(1536, 1024, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const r = rngOf(52), ink = 'rgba(255,92,18,', base = 690;
    // overspray haze behind the figures
    for (let i = 0; i < 2600; i++) { const x = 90 + r() * 1360, y = 140 + r() * 600, a = 0.012 + r() * 0.03; g.fillStyle = ink + a + ')'; g.beginPath(); g.arc(x, y, 1 + r() * 3, 0, 7); g.fill(); }
    g.font = `800 520px "${F}"`; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    const tw = g.measureText(text).width, x0 = (w - tw) / 2;
    g.fillStyle = ink + '0.93)'; g.fillText(text, x0, base);
    // a runner from the base of a stroke or two (too much paint on a cold wall)
    for (const [dx, len] of [[0.18, 70], [0.47, 120], [0.81, 52]]) { const x = x0 + tw * dx; g.fillStyle = ink + '0.85)'; g.fillRect(x, base - 6, 5, len); g.beginPath(); g.arc(x + 2.5, base - 6 + len, 4.5, 0, 7); g.fill(); }
    // the level line under it and the benchmark triangle on the line
    g.fillStyle = ink + '0.95)'; g.fillRect(70, base + 90, w - 140, 16);
    g.beginPath(); g.moveTo(170, base + 90); g.lineTo(250, base + 90); g.lineTo(210, base + 160); g.closePath(); g.fill();
    // the paint's grain: the concrete shows through where the can ran dry
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(0,0,0,${0.1 + r() * 0.35})`; g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 2); }
    g.globalCompositeOperation = 'source-over';
  });
}
// window bands for the city: rows of glazing, a few lit
function cityTex(seed) {
  const r = rngOf(seed);
  return canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = '#7d7a73'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) { const lit = r() < 0.08; g.fillStyle = lit ? '#e9c27a' : r() < 0.5 ? '#2a3038' : '#3a4048'; g.fillRect(x + 2, y + 3, 12, 10); }
  });
}

// ---------------------------------------------------------------- the tower
export class World {
  constructor(scene) { this.scene = scene; this.root = new THREE.Group(); scene.add(this.root); }
  async build() {
    const root = this.root;
    const conc = concreteMaterial({ ...SURFACES.concreteFloor, base: 0x9b968c, joint: 0, oil: 0.05, dirt: 0.3, cracks: 0.25, rough: 0.85 });
    const concCore = concreteMaterial({ ...SURFACES.concreteFloor, base: 0xa39d92, joint: 0, oil: 0.0, dirt: 0.35, cracks: 0.2, rough: 0.88 });
    const dark = std({ color: 0x1a1918, roughness: 0.95 });
    const glass = glassMaterial({ tint: 0x22303a, dirt: 0.15, rough: 0.03, env: 1.15 });
    const mull = std({ color: 0x8e9196, roughness: 0.35, metalness: 0.85 });
    const rail = std({ color: 0xd6b21e, roughness: 0.55 });
    this.mats = { conc, concCore, dark, glass, mull, rail };
    // floors: one group per floor, so the plan can put up one a bar (the slab, the facade columns above it, the deep interior)
    this.floors = [];
    for (let k = 0; k <= MAXF; k++) {
      const y = k * FLOOR, g = new THREE.Group(); g.name = 'floor' + k;
      const parts = [boxGeometry(W, 0.3, D, 0, y - 0.15, -D / 2)];
      for (const x of COLS) parts.push(boxGeometry(0.6, FLOOR - 0.3, 0.6, x - Math.sign(x) * 0.3 * (Math.abs(x) === 18 ? 1 : 0), y + (FLOOR - 0.3) / 2, -0.3));
      for (const x of [-12, -4, 4, 12]) for (const z of [-8, -16]) parts.push(boxGeometry(0.6, FLOOR - 0.3, 0.6, x, y + (FLOOR - 0.3) / 2, z));
      g.add(shadowed(new THREE.Mesh(merge(parts), conc)));
      // the back of each floor is dark (a deep plan, unlit at this hour)
      const back = new THREE.Mesh(new THREE.PlaneGeometry(W, FLOOR), dark); back.position.set(0, y + FLOOR / 2, -D + 0.05); g.add(back);
      root.add(g); this.floors.push({ g, y, glass: null, guard: null });
    }
    // each floor's work lights: a run of fittings under the slab above, 1.5 m in from the face (off until the crew's wave at the end)
    const wl = []; for (let x = -16.5; x <= 16.5; x += 3) wl.push(boxGeometry(1.2, 0.06, 0.18, x, FLOOR - 0.36, -1.5));
    const wlGeo = merge(wl);
    for (const f of this.floors) { const m = new THREE.Mesh(wlGeo, std({ color: 0x111111, emissive: new THREE.Color(1.0, 0.9, 0.75), emissiveIntensity: 0 })); m.position.y = f.y; f.g.add(m); f.lights = m; }
    // the curtain wall: glazed panels with mullions outside the bay, floor by floor (the plan glazes up to a few floors under the deck)
    const panelL = boxGeometry(BAY[0] - X0, FLOOR - 0.12, 0.04, (X0 + BAY[0]) / 2, FLOOR / 2, 0.08), panelR = boxGeometry(X1 - BAY[1], FLOOR - 0.12, 0.04, (X1 + BAY[1]) / 2, FLOOR / 2, 0.08);
    const glassGeo = merge([panelL, panelR]);
    const mparts = [];
    for (let x = X0; x <= X1 + 1e-6; x += 1.5) { if (x > BAY[0] + 0.1 && x < BAY[1] - 0.1) continue; mparts.push(boxGeometry(0.07, FLOOR, 0.16, x, FLOOR / 2, 0.14)); }
    mparts.push(boxGeometry(BAY[0] - X0, 0.14, 0.2, (X0 + BAY[0]) / 2, 0.07, 0.14), boxGeometry(X1 - BAY[1], 0.14, 0.2, (X1 + BAY[1]) / 2, 0.07, 0.14));
    mparts.push(boxGeometry(BAY[0] - X0, 0.9, 0.06, (X0 + BAY[0]) / 2, 0.2, 0.1), boxGeometry(X1 - BAY[1], 0.9, 0.06, (X1 + BAY[1]) / 2, 0.2, 0.1));   // spandrels
    const mullGeo = merge(mparts);
    // edge protection on the open slabs: posts and two rails, safety yellow, and the toe board
    const gparts = [];
    for (let x = X0 + 0.2; x < X1; x += 2.4) gparts.push(boxGeometry(0.05, 1.1, 0.05, x, 0.55, 0.2));
    gparts.push(boxGeometry(W - 0.4, 0.05, 0.05, 0, 1.1, 0.2), boxGeometry(W - 0.4, 0.05, 0.05, 0, 0.55, 0.2), boxGeometry(W - 0.4, 0.15, 0.03, 0, 0.075, 0.2));
    const guardGeo = merge(gparts);
    for (const f of this.floors) {
      const gl = new THREE.Mesh(glassGeo, glass); gl.position.y = f.y; gl.receiveShadow = true; f.g.add(gl);
      const mu = shadowed(new THREE.Mesh(mullGeo, mull)); mu.position.y = f.y; f.g.add(mu); f.glass = [gl, mu];
      const gu = shadowed(new THREE.Mesh(guardGeo, rail)); gu.position.y = f.y; f.g.add(gu); f.guard = gu;
    }
    // the stair core's facade wall between the hoist and the car: full height, in its own lifts (one a floor, so it rises with the floors)
    this.core = [];
    for (const f of this.floors) { const m = shadowed(new THREE.Mesh(boxGeometry(CORE[1] - CORE[0], FLOOR, 0.35, (CORE[0] + CORE[1]) / 2, f.y + FLOOR / 2, 0.1), concCore)); f.g.add(m); this.core.push(m); }
    // the number on the core wall at the mark's floor, centred over the landing, about 1.4 m tall
    const nt = await numberTex(NUMBER.text);
    const num = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8 * 1024 / 1536), litPatch(new THREE.MeshStandardMaterial({ map: nt, transparent: true, roughness: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })));
    num.position.set((CORE[0] + CORE[1]) / 2, MARK_FLOOR * FLOOR + 1.62, 0.285); num.receiveShadow = true; num.renderOrder = 2;
    this.floors[MARK_FLOOR].g.add(num); this.number = num;
    // the ground: the site slab and the street
    const ground = shadowed(new THREE.Mesh(boxGeometry(1600, 0.2, 1600, 0, -0.1, 0), concreteMaterial({ ...SURFACES.concreteYard, base: 0x6f6c66 })), false, true);
    root.add(ground);
    this._top(); this._hoist(); this._car(); this._crane(); this._city();
    return this;
  }
  // ---------------------------------------------------------------- the top: the deck, the climbing screen, the owner's pavilion
  _top() {
    const g = this.top = new THREE.Group(); g.name = 'top';
    const form = std({ color: 0xb8742f, roughness: 0.8 }), screenM = std({ color: 0x5a5f63, roughness: 0.6, metalness: 0.4 });
    // formwork tables and stacks of ply on the deck
    const fp = []; const r = rngOf(9);
    for (let i = 0; i < 14; i++) fp.push(boxGeometry(2.4, 0.25 + r() * 0.5, 1.2, -16 + r() * 18, 0.2, -2 - r() * 20));
    g.add(shadowed(new THREE.Mesh(merge(fp), form)));
    // the climbing screen round the top two floors (perforated sheet on a frame), left open over the bay and the core
    const sp = [];
    for (const [a, b] of [[X0, BAY[0] - 0.2], [4.0, X1]]) sp.push(boxGeometry(b - a, 2 * FLOOR, 0.08, (a + b) / 2, -FLOOR + 0.6, 1.0));
    sp.push(boxGeometry(0.08, 2 * FLOOR, D, X0 - 1, -FLOOR + 0.6, -D / 2), boxGeometry(0.08, 2 * FLOOR, D, X1 + 1, -FLOOR + 0.6, -D / 2));
    g.add(shadowed(new THREE.Mesh(merge(sp), screenM)));
    // the owner's pavilion: a glass box on the deck at the corner over the car's rails, lit warm inside
    const pv = this.pavilion = new THREE.Group(); pv.position.set(6, 0, -8); g.add(pv);
    const pw = 20, ph = 4.6, pd = 16;
    const slab = shadowed(new THREE.Mesh(boxGeometry(pw + 0.6, 0.45, pd + 0.6, 0, 0.22, 0), std({ color: 0x2b2a28, roughness: 0.4, metalness: 0.3 }))); pv.add(slab);
    const roof = shadowed(new THREE.Mesh(boxGeometry(pw + 1.6, 0.5, pd + 1.6, 0, ph + 0.25, 0), std({ color: 0x1f1e1d, roughness: 0.5, metalness: 0.4 }))); pv.add(roof);
    this.warm = std({ color: 0x000000, emissive: new THREE.Color(1.0, 0.72, 0.42), emissiveIntensity: 1 });
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(pw - 0.6, pd - 0.6), this.warm); ceil.rotation.x = Math.PI / 2; ceil.position.y = ph - 0.05; pv.add(ceil);
    const backW = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), std({ color: 0x3b2a1d, roughness: 0.5 })); backW.position.set(0, ph / 2, -pd / 2 + 0.05); pv.add(backW);
    const floorIn = new THREE.Mesh(new THREE.PlaneGeometry(pw, pd), std({ color: 0xc9c2b4, roughness: 0.25 })); floorIn.rotation.x = -Math.PI / 2; floorIn.position.y = 0.46; pv.add(floorIn);
    const pg = glassMaterial({ tint: 0x2a2620, dirt: 0.05, rough: 0.02, env: 0.9 });
    pg.transparent = true; pg.opacity = 0.55;
    for (const [w, x, z, ry] of [[pw, 0, pd / 2, 0], [pd, pw / 2, 0, Math.PI / 2], [pd, -pw / 2, 0, -Math.PI / 2]]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, ph - 0.5), pg); p.position.set(x, ph / 2 + 0.2, z); p.rotation.y = ry; pv.add(p); }
    const fins = []; for (let x = -pw / 2; x <= pw / 2 + 1e-6; x += 2.5) fins.push(boxGeometry(0.08, ph, 0.25, x, ph / 2, pd / 2)); pv.add(shadowed(new THREE.Mesh(merge(fins), std({ color: 0x9c8f78, roughness: 0.3, metalness: 0.9 }))));
    // a pool of the pavilion's light on its own glass and deck: two warm lamps inside the box
    this.pavLights = [];
    for (const x of [-5, 5]) { const L = new THREE.PointLight(0xffb871, 1, 22, 2); L.position.set(x, ph - 0.6, 0); pv.add(L); this.pavLights.push(L); }
    this.root.add(g);
  }
  // ---------------------------------------------------------------- the crew's hoist: the mast (section by section) and the cage
  _hoist() {
    const yellow = steelMaterial({ ...SURFACES.craneYellow, top: 0xd8a514, wear: 0.4, rust: 0.25, age: 0.4 });
    const grey = steelMaterial({ ...SURFACES.primerGrey, top: 0x7c8084, rust: 0.2 });
    // a 1.508 m mast section: four chords, a rack on the cage side, a diagonal on each face
    const s = 1.508, a = 0.65, cp = [];
    for (const [x, z] of [[-a / 2, -a / 2], [a / 2, -a / 2], [-a / 2, a / 2], [a / 2, a / 2]]) cp.push(boxGeometry(0.076, s, 0.076, x, s / 2, z));
    for (const z of [-a / 2, a / 2]) cp.push(boxGeometry(a, 0.05, 0.05, 0, 0.04, z), boxGeometry(a, 0.05, 0.05, 0, s - 0.04, z));
    for (const x of [-a / 2, a / 2]) cp.push(boxGeometry(0.05, 0.05, a, x, 0.04, 0), boxGeometry(0.05, 0.05, a, x, s - 0.04, 0));
    this._diag = [];
    for (const sgn of [-1, 1]) { const d = new THREE.BoxGeometry(0.04, Math.hypot(a, s), 0.04); d.rotateZ(sgn * Math.atan2(a, s)); d.translate(0, s / 2, sgn * a / 2); d.deleteAttribute('uv'); this._diag.push(d); }
    cp.push(boxGeometry(0.06, s, 0.12, 0, s / 2, a / 2 + 0.06));     // the rack
    const sec = merge(cp);
    const n = Math.ceil((MAXF * FLOOR + 30) / s);
    const mast = this.mast = new THREE.InstancedMesh(sec, grey, n); const M = new THREE.Matrix4();
    for (let i = 0; i < n; i++) { M.makeTranslation(-8, i * s, 0.62); mast.setMatrixAt(i, M); }
    mast.castShadow = mast.receiveShadow = true; mast.frustumCulled = false; this.mastSec = s; this.root.add(mast);
    const diag = this.mastDiag = new THREE.InstancedMesh(merge(this._diag), steelMaterial({ ...SURFACES.primerGrey, top: 0x7c8084, rust: 0.2, box: false }), n);
    for (let i = 0; i < n; i++) { M.makeTranslation(-8, i * s, 0.62); diag.setMatrixAt(i, M); } diag.castShadow = true; diag.frustumCulled = false; this.root.add(diag);
    // ties back to the slab edge every third floor
    const tp = []; for (let k = 3; k <= MAXF; k += 3) tp.push(boxGeometry(0.08, 0.08, 0.9, -8.3, k * FLOOR + 0.5, 0.1), boxGeometry(0.08, 0.08, 0.9, -7.7, k * FLOOR + 0.5, 0.1));
    this.ties = shadowed(new THREE.Mesh(merge(tp), grey)); this.root.add(this.ties);
    // the cage: 3.2 x 1.5 x 2.5 m, its floor at the group's origin; the front (z +) mesh with a mid rail, sides mesh, a roof with the drive
    const c = this.cage = new THREE.Group(); c.name = 'cage';
    const cw = 3.2, cd = 1.5, chh = 2.5, cz = 1.95;
    const fr = [boxGeometry(cw, 0.14, cd, 0, -0.07, 0)];
    for (const [x, z] of [[-cw / 2, -cd / 2], [cw / 2, -cd / 2], [-cw / 2, cd / 2], [cw / 2, cd / 2]]) fr.push(boxGeometry(0.07, chh, 0.07, x, chh / 2, z));
    fr.push(boxGeometry(cw, 0.07, 0.07, 0, chh, cd / 2), boxGeometry(cw, 0.07, 0.07, 0, chh, -cd / 2), boxGeometry(0.07, 0.07, cd, -cw / 2, chh, 0), boxGeometry(0.07, 0.07, cd, cw / 2, chh, 0));
    fr.push(boxGeometry(cw, 0.05, 0.05, 0, 1.06, cd / 2 - 0.02), boxGeometry(0.05, 0.05, cd, -cw / 2 + 0.02, 1.06, 0), boxGeometry(0.05, 0.05, cd, cw / 2 - 0.02, 1.06, 0));   // the mid rail
    fr.push(boxGeometry(cw, 0.16, 0.03, 0, 0.08, cd / 2), boxGeometry(cw + 0.1, 0.1, cd + 0.1, 0, chh + 0.05, 0));   // toe board, roof
    fr.push(boxGeometry(1.1, 0.55, 0.9, -0.6, chh + 0.38, -0.2), boxGeometry(0.5, 0.4, 0.5, 0.6, chh + 0.3, -0.35));   // the drive, the cable drum
    const cageFrame = shadowed(new THREE.Mesh(merge(fr), yellow)); c.add(cageFrame);
    // (a patched material must be made fresh, never cloned: a clone keeps the 'lit' flag but not the patch)
    const wireMat = (rx, ry) => { const t = meshTex(); t.repeat.set(rx, ry); return litPatch(new THREE.MeshStandardMaterial({ color: 0x9a9c97, metalness: 0.7, roughness: 0.45, alphaMap: t, alphaTest: 0.5, transparent: false, side: THREE.DoubleSide })); };
    const wire = wireMat(cw / 0.4, (chh - 1.12) / 0.4);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(cw - 0.08, chh - 1.12), wire); front.position.set(0, 1.12 + (chh - 1.12) / 2, cd / 2); c.add(shadowed(front));
    const lowW = wireMat(cw / 0.4, 0.9 / 0.4);
    const low = new THREE.Mesh(new THREE.PlaneGeometry(cw - 0.08, 0.9), lowW); low.position.set(0, 0.16 + 0.45, cd / 2); c.add(shadowed(low));
    for (const sx of [-1, 1]) { const wm = wireMat(cd / 0.4, chh / 0.4);
      const p = new THREE.Mesh(new THREE.PlaneGeometry(cd - 0.08, chh - 0.1), wm); p.rotation.y = Math.PI / 2; p.position.set(sx * cw / 2, chh / 2, 0); c.add(shadowed(p)); }
    // the control box on the right-hand wall inside, its lever and the red stop button
    const boxM = std({ color: 0x55595d, roughness: 0.5, metalness: 0.5 });
    const cb = shadowed(new THREE.Mesh(boxGeometry(0.16, 0.42, 0.3, 1.47, 1.18, 0.15), boxM)); c.add(cb);
    const lever = this.lever = new THREE.Group(); lever.position.set(1.40, 1.12, 0.27); c.add(lever);
    lever.add(shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 8).translate(0, 0.08, 0), std({ color: 0x222222, metalness: 0.8, roughness: 0.3 }))));
    lever.add(shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 10).translate(0, 0.17, 0), std({ color: 0x111111, roughness: 0.4 }))));
    const btn = this.button = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 20).rotateZ(Math.PI / 2), std({ color: 0xc8140f, roughness: 0.35 }));
    btn.position.set(1.37, 1.34, 0.07); c.add(shadowed(btn));
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 20).rotateZ(Math.PI / 2), std({ color: 0xe0c214, roughness: 0.5 })); collar.position.set(1.385, 1.34, 0.07); c.add(collar);
    // a work lamp under the roof
    const lamp = new THREE.Mesh(boxGeometry(0.6, 0.05, 0.12, 0, chh - 0.06, 0.2), std({ color: 0x000000, emissive: new THREE.Color(1, 0.93, 0.82), emissiveIntensity: 0.4 })); c.add(lamp);
    c.position.set(-8, 0, cz); this.root.add(c);
    this.cageDims = { cw, cd, chh, cz };
  }
  // ---------------------------------------------------------------- the owner's glass car on the core's far side
  _car() {
    const g = this.car = new THREE.Group(); g.name = 'car';
    const steel = std({ color: 0xb7b4ad, roughness: 0.18, metalness: 1.0 });
    const w = 2.4, h = 2.7, d = 1.6;
    const fr = [];
    for (const [x, z] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) fr.push(boxGeometry(0.08, h, 0.08, x, h / 2, z));
    fr.push(boxGeometry(w + 0.12, 0.32, d + 0.12, 0, -0.16, 0), boxGeometry(w + 0.12, 0.3, d + 0.12, 0, h + 0.15, 0));
    g.add(shadowed(new THREE.Mesh(merge(fr), steel)));
    this.carWarm = std({ color: 0x000000, emissive: new THREE.Color(1.0, 0.76, 0.48), emissiveIntensity: 1 });
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.1, d - 0.1), this.carWarm); ceil.rotation.x = Math.PI / 2; ceil.position.y = h - 0.02; g.add(ceil);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), std({ color: 0x2e2118, roughness: 0.35 })); back.position.set(0, h / 2, -d / 2 + 0.02); g.add(back);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), std({ color: 0x8c857a, roughness: 0.2 })); floor.rotation.x = -Math.PI / 2; floor.position.y = 0.01; g.add(floor);
    const brass = new THREE.Mesh(boxGeometry(w - 0.2, 0.04, 0.04, 0, 0.95, -d / 2 + 0.12), std({ color: 0xb08d4a, roughness: 0.25, metalness: 1 })); g.add(brass);
    const gl = glassMaterial({ tint: 0x3a2f22, dirt: 0.04, rough: 0.015, env: 1.0 }); gl.transparent = true; gl.opacity = 0.5;
    for (const [ww, x, z, ry] of [[w, 0, d / 2, 0], [d, w / 2, 0, Math.PI / 2], [d, -w / 2, 0, -Math.PI / 2]]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(ww - 0.08, h - 0.05), gl); p.position.set(x, h / 2, z); p.rotation.y = ry; g.add(p); }
    const L = this.carLight = new THREE.PointLight(0xffc07e, 1, 8, 2); L.position.set(0, h - 0.4, 0); g.add(L);
    g.position.set(-1.7, 0, 1.25); this.root.add(g);
    // its rails: two polished guides up the core's face, the full height
    const rails = []; for (const x of [-2.75, -0.65]) rails.push(boxGeometry(0.09, MAXF * FLOOR + 10, 0.12, x, (MAXF * FLOOR + 10) / 2, 0.35));
    this.carRails = shadowed(new THREE.Mesh(merge(rails), steel)); this.root.add(this.carRails);
  }
  // ---------------------------------------------------------------- the tower crane on the core, slewing with the work
  _crane() {
    const g = this.crane = new THREE.Group(); g.name = 'crane';
    const red = steelMaterial({ ...SURFACES.craneYellow, top: 0xe1b21b, wear: 0.35, rust: 0.2, age: 0.35 });
    const lattice = (len, w, h, axis) => {      // a lattice boom along +x (axis 'x') or +y, chords and zig-zag web
      const p = []; const n = Math.max(2, Math.round(len / 2));
      if (axis === 'y') { for (const [x, z] of [[-w / 2, -w / 2], [w / 2, -w / 2], [-w / 2, w / 2], [w / 2, w / 2]]) p.push(boxGeometry(0.14, len, 0.14, x, len / 2, z));
        for (let i = 0; i < n; i++) for (const z of [-w / 2, w / 2]) p.push(boxGeometry(w, 0.08, 0.08, 0, i * len / n, z)); }
      else { for (const [y, z] of [[0, -w / 2], [0, w / 2], [h, 0]]) p.push(boxGeometry(len, 0.12, 0.12, len / 2, y, z));
        for (let i = 0; i <= n; i++) { p.push(boxGeometry(0.08, h, 0.08, i * len / n, h / 2, -w / 4)); p.push(boxGeometry(0.08, 0.08, w, i * len / n, 0, 0)); } }
      return merge(p); };
    const mastH = 34;
    g.add(shadowed(new THREE.Mesh(lattice(mastH, 2.0, 0, 'y'), red)));
    const slew = this.slew = new THREE.Group(); slew.position.y = mastH; g.add(slew);
    slew.add(shadowed(new THREE.Mesh(lattice(52, 1.6, 1.8, 'x'), red)));
    const cj = shadowed(new THREE.Mesh(lattice(16, 1.6, 1.2, 'x'), red)); cj.rotation.y = Math.PI; slew.add(cj);
    slew.add(shadowed(new THREE.Mesh(boxGeometry(3.2, 2.4, 2.2, -13.5, -1.1, 0), std({ color: 0x8f8d88, roughness: 0.85 }))));   // the counterweights
    slew.add(shadowed(new THREE.Mesh(boxGeometry(2.0, 2.2, 1.8, 1.5, -1.4, 1.6), std({ color: 0xe6e3dc, roughness: 0.5 }))));   // the cab
    const apex = shadowed(new THREE.Mesh(lattice(7, 1.2, 0, 'y'), red)); slew.add(apex);
    const tie = []; for (const [x, y] of [[40, 0], [-15, 0]]) { const len = Math.hypot(x, 7 - y), gg = new THREE.BoxGeometry(0.06, len, 0.06); gg.rotateZ(-Math.atan2(x, 7 - y)); gg.translate(x / 2, (7 + y) / 2, 0); gg.deleteAttribute('uv'); tie.push(gg); }
    slew.add(new THREE.Mesh(merge(tie), std({ color: 0x333333, metalness: 0.8, roughness: 0.4 })));
    // the trolley, the hoist rope and a bundle of rebar on the hook
    const tr = this.trolley = new THREE.Group(); tr.position.x = 30; slew.add(tr);
    const rope = this.rope = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 6).translate(0, -0.5, 0), std({ color: 0x222222, metalness: 0.7, roughness: 0.5 })); tr.add(rope);
    const load = this.load = new THREE.Group(); tr.add(load);
    const rb = []; for (let i = 0; i < 12; i++) rb.push(boxGeometry(9, 0.04, 0.04, 0, (i % 3) * 0.05, Math.floor(i / 3) * 0.05 - 0.08));
    load.add(shadowed(new THREE.Mesh(merge(rb), std({ color: 0x5b3a26, roughness: 0.7, metalness: 0.5 }))));
    load.add(shadowed(new THREE.Mesh(boxGeometry(0.4, 0.5, 0.3, 0, 1.6, 0), std({ color: 0xd6a51a }))));
    g.position.set(-10.5, 0, -11); this.top.add(g);
  }
  // ---------------------------------------------------------------- the city round the site
  _city() {
    const r = rngOf(31), texs = [cityTex(3), cityTex(7), cityTex(11)];
    const mats = texs.map(t => litPatch(new THREE.MeshStandardMaterial({ map: t, roughness: 0.7, metalness: 0.1 })));
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    for (let m = 0; m < 3; m++) {
      const list = [];
      for (let i = 0; i < 160; i++) {
        const ang = r() * Math.PI * 2, rad = 60 + r() ** 0.7 * 900, x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
        if (z > -40 && z < 140 && Math.abs(x) < 60) continue;                       // the street in front of the site stays open
        const w = 18 + r() * 30, d = 18 + r() * 30, h = 12 + r() ** 2.2 * 140 * (rad < 300 ? 1 : 0.7);
        list.push([x, z, w, d, h, r() * 0.3]);
      }
      const im = new THREE.InstancedMesh(box, mats[m], list.length), M4 = new THREE.Matrix4(), q = new THREE.Quaternion();
      list.forEach(([x, z, w, d, h, ry], i) => { q.setFromAxisAngle(V(0, 1, 0), ry); M4.compose(V(x, 0, z), q, V(w, h, d)); im.setMatrixAt(i, M4); });
      im.castShadow = true; im.receiveShadow = true; this.root.add(im);
    }
    // the site hoarding at the street
    const hd = shadowed(new THREE.Mesh(boxGeometry(70, 2.6, 0.1, 0, 1.3, 26), std({ color: 0x3d4a3f, roughness: 0.8 }))); this.root.add(hd);
  }

  // ---------------------------------------------------------------- per frame: the plan's state into the objects
  set({ topF, cageY, carY, slewA, trolleyX, hookY, lever, button, exposure, glazeTo, lit = null }) {
    const nTop = Math.floor(topF), part = topF - nTop;
    for (let k = 0; k <= MAXF; k++) {
      const f = this.floors[k];
      f.g.visible = k <= nTop;
      // the floor being jacked up into place rises with the deck over its beat
      f.g.position.y = 0;
      f.lights.material.emissiveIntensity = (lit ? lit(k) : 0) * 900 * exposure;
      const open = k > glazeTo; f.glass[0].visible = !open; f.glass[1].visible = !open; f.guard.visible = open && k <= nTop;
    }
    this.top.position.y = topF * FLOOR;
    void part;
    // the mast reaches 3 m over the deck; the ties come with it
    this.mast.count = this.mastDiag.count = Math.min(this.mast.instanceMatrix.count, Math.ceil((topF * FLOOR + 3) / this.mastSec));
    this.cage.position.y = cageY; this.car.position.y = carY;
    this.slew.rotation.y = slewA; this.trolley.position.x = trolleyX;
    const ropeLen = Math.max(1, this.slew.position.y - hookY); this.rope.scale.y = ropeLen; this.load.position.y = -ropeLen;
    this.lever.rotation.x = lever; this.button.position.x = 1.37 + 0.012 * button;
    // the lit glass: interiors at a lamp's luminance, pre-exposed (cd/m2 x exposure)
    this.warm.emissiveIntensity = 2600 * exposure; this.carWarm.emissiveIntensity = 3200 * exposure;
    for (const L of this.pavLights) L.intensity = 4000 * exposure; this.carLight.intensity = 900 * exposure;
  }
}
