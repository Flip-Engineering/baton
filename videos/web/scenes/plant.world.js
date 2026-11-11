// THE PLANT THAT WOULD NOT DIE: the sets (research/october/PLANT_brief.md). Two worlds, each its own THREE.Scene:
//   the hall   a long bay, the press line under dust sheets (objects/press.js gap presses; the sheets settled once by lib/fx/cloth.js and
//              kept in assets/plant/sheets.json, restored here), a row of steel columns in front of the line (the torch's shadows), a
//              roof slab whose broken north-light panes let the moon in (its own shafts in the haze, lantern.js hazeShaft), puddles,
//              an EXIT sign, the main disconnect on a column, the lot's sodium light through the south windows (a Lantern with the
//              sash as its gobo), high-bay lamps for when the crew is in, a bench and a fixture
//   the plant  from across the lot: a long low auto plant, a sawtooth roof (commonwealth3.world.js plantMesh's profile at human scale),
//              five bays of steel-sash windows whose panes are THREE layer 3 (the matte's layer), the dark interior, a sodium cut-off
//              pole over the lot (light/practicals.js PRACTICALS.hpsCutoff), the low moon, and the windows' own light on the lot
// Units: the light levels are in the reveal's exposure-1 units (a surface lit to about 1-2 reads white after ACES).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { press } from '../lib/fx/objects/press.js';
import { groundPlane } from '../lib/fx/objects/stage.js';
import { Cloth } from '../lib/fx/cloth.js';
import { Lantern, hazeShaft } from '../lib/fx/lantern.js';
import { PRACTICALS } from '../lib/fx/light/practicals.js';
import { candelaFromLumens } from '../lib/fx/light/color.js';
import { LINE, STATIONS, CREW, columnX, MOON_DIR, MOON_PATCHES, holeOf, PUDDLES, EXIT_SIGN, DISCONNECT, EXT, bayX } from './plant.plan.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const std = (color, roughness = 0.85, metalness = 0, o = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...o });
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const mesh = (g, m, { cast = true, recv = true } = {}) => { const o = new THREE.Mesh(g, m); o.castShadow = cast; o.receiveShadow = recv; return o; };

// a window sash as a gobo (the lot light through the south windows; the bays' light on the lot): bright panes, dark bars
export function sashCanvas(cols = 6, rows = 4, N = 256) {
  const c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, N, N);
  const m = N * 0.12, w = (N - 2 * m) / cols, h = (N - 2 * m) / rows, bar = Math.max(2, N * 0.012);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const b = 0.75 + 0.25 * ((i * 7 + j * 3) % 5) / 4; g.fillStyle = `rgb(${255 * b | 0},${255 * b | 0},${255 * b | 0})`;
    g.fillRect(m + i * w + bar / 2, m + j * h + bar / 2, w - bar, h - bar); }
  const gr = g.createRadialGradient(N / 2, N / 2, N * 0.2, N / 2, N / 2, N * 0.5); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.85)');
  g.fillStyle = gr; g.fillRect(0, 0, N, N);
  return c;
}

// ------------------------------------------------------------------ the hall
export function buildHall(scene, sheetsJSON) {
  const out = { occluders: [], stops: [], sheets: [], presses: [], shafts: [] };
  const cx = (LINE.west + LINE.east) / 2, cz = (LINE.north + LINE.south) / 2, LX = LINE.east - LINE.west, LZ = LINE.south - LINE.north, RY = LINE.roofY;
  // the floor and its puddles (dark, glossy: they take the light's highlights)
  const floor = groundPlane('concrete', { size: 160 }); floor.position.set(cx, 0, cz); scene.add(floor); out.stops.push(floor); out.floor = floor;
  const pudM = std('#060606', 0.05, 0);
  for (const [x, z, rx, rz] of PUDDLES) { const p = mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), pudM, { cast: false }); p.scale.set(rx, 1, rz); p.position.set(x, 0.004, z); p.rotation.y = x * 0.37; scene.add(p); }
  // the walls (dark brick) and the roof slab with its broken panes
  const wallM = std('#1d1a17', 0.92);
  const walls = mergeGeometries([box(0.4, RY, LZ, LINE.west, RY / 2, cz), box(0.4, RY, LZ, LINE.east, RY / 2, cz), box(LX, RY, 0.4, cx, RY / 2, LINE.north), box(LX, RY, 0.4, cx, RY / 2, LINE.south)]);
  const wm = mesh(walls, wallM); scene.add(wm); out.stops.push(wm);
  const holes = MOON_PATCHES.map(p => { const y = p[1] < 0.5 ? 2.2 : 0, [x, z] = holeOf(p, y); return [x - 0.7, x + 0.7, z - 0.5, z + 0.5, p, y]; });
  const slabs = [];
  for (let z = LINE.north; z < LINE.south - 1e-6; z += 1) {
    const hs = holes.filter(h => h[2] < z + 1 && h[3] > z).sort((a, b) => a[0] - b[0]); let x = LINE.west;
    for (const h of hs) { if (h[0] > x) slabs.push(box(h[0] - x, 0.25, 1, (x + h[0]) / 2, RY + 0.125, z + 0.5)); x = Math.max(x, h[1]); }
    if (LINE.east > x) slabs.push(box(LINE.east - x, 0.25, 1, (x + LINE.east) / 2, RY + 0.125, z + 0.5));
  }
  const roofM = std('#0b0b0c', 0.95), roof = mesh(mergeGeometries(slabs), roofM); scene.add(roof);
  const truss = []; for (let z = LINE.north + 3; z < LINE.south; z += 6) truss.push(box(LX, 0.32, 0.18, cx, RY - 0.3, z));
  for (let x = LINE.west + 6; x < LINE.east; x += 12) truss.push(box(0.18, 0.32, LZ, x, RY - 0.3, cz));
  scene.add(mesh(mergeGeometries(truss), std('#141414', 0.7, 0.4)));
  // the line's columns (the torch's occluders: their shadows are the stripes) and the bay's portal columns
  const steel = std('#2b2d2f', 0.55, 0.55), cols = [];
  for (let k = LINE.colK0; k <= LINE.colK1; k++) { const c = mesh(new THREE.BoxGeometry(LINE.colW, RY, LINE.colW), steel); c.position.set(columnX(k), RY / 2, LINE.colZ); scene.add(c); cols.push(c); }
  out.occluders.push(...cols); out.cols = cols;
  const portal = []; for (let x = LINE.west + 2.12; x < LINE.east; x += 12) for (const z of [9, -8]) portal.push(box(0.36, RY, 0.36, x, RY / 2, z));
  scene.add(mesh(mergeGeometries(portal), steel));
  // the presses (three built, the rest their clones) and their sheets (restored from the bake)
  const kinds = [1, 2, 3].map(s => press({ kind: 'gap', tons: 45, seed: 1936 + s, stroke: 0.2 }));
  for (const k of kinds) k.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const sheetGeo = sheetsJSON.variants.map(v => { const cl = new Cloth({ w: v.w, l: v.l, nx: v.nx, nz: v.nz, at: v.at, bend: v.bend });
    const P = Float32Array.from(v.p, x => x / 1000); cl.restore({ p: P, q: P.slice(), t: 0 }); cl.sync(); return cl.geometry; });
  const sheetM = std('#d3cdc0', 0.93, 0, { side: THREE.DoubleSide });
  for (const s of STATIONS) {
    const p = kinds[(s.i + 30) % 3].clone(); p.position.set(s.x, 0, LINE.pressZ); scene.add(p); out.presses.push(p);
    const sh = mesh(sheetGeo[(s.i + 30) % 2], sheetM); sh.position.set(s.x, 0, LINE.pressZ); scene.add(sh); out.sheets.push(sh); out.stops.push(sh);
  }
  // the moon: a low key through the broken panes (shadowed by the roof), its shafts in the haze
  const moon = new THREE.DirectionalLight('#c9d3ea', 0); moon.castShadow = true; moon.shadow.mapSize.set(2048, 2048);
  const mt = V3(-13, 0, 3); moon.position.copy(mt).addScaledVector(MOON_DIR, -60); moon.target.position.copy(mt);
  Object.assign(moon.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 140 }); moon.shadow.camera.updateProjectionMatrix();
  moon.shadow.bias = -0.0006; moon.shadow.normalBias = 0.04; scene.add(moon, moon.target); out.moon = moon;
  for (const h of holes) { const from = V3((h[0] + h[1]) / 2, RY, (h[2] + h[3]) / 2), len = (RY - h[5]) / -MOON_DIR.y;
    const sf = hazeShaft(scene, { color: '#cfd8ee', ground: 0 }); sf.set(from, MOON_DIR, len, 0, 0.32, 0.012); out.shafts.push({ sf, from, len }); }
  // the EXIT sign hanging over the aisle (it dies with the breaker)
  { const g = new THREE.Group(), c = document.createElement('canvas'); c.width = 256; c.height = 112; const x = c.getContext('2d');
    x.fillStyle = '#0a0a0a'; x.fillRect(0, 0, 256, 112); x.fillStyle = '#fff'; x.font = '900 84px Anton, Impact, sans-serif'; x.textAlign = 'center'; x.fillText('EXIT', 128, 92);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    out.exitMat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(0, 0, 0) });
    g.add(mesh(new THREE.BoxGeometry(0.46, 0.22, 0.07), std('#121212', 0.6), { cast: false }));
    for (const s of [1, -1]) { const f = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.18), out.exitMat); f.position.z = s * 0.036; f.rotation.y = s > 0 ? 0 : Math.PI; g.add(f); }
    for (const s of [-0.16, 0.16]) g.add(mesh(new THREE.CylinderGeometry(0.006, 0.006, RY - EXIT_SIGN.y, 6).translate(s, (RY - EXIT_SIGN.y) / 2 + 0.11, 0), steel, { cast: false }));
    g.position.copy(EXIT_SIGN); scene.add(g); out.exit = g; }
  // the main disconnect on its column: a grey box, the handle on its pivot (posed from the Lever's own pivot and grip each frame)
  { const g = new THREE.Group(), x = columnX(DISCONNECT.k), z = LINE.colZ + LINE.colW / 2;
    g.add(mesh(box(0.42, 0.62, 0.22, x, 1.42, z + 0.11), std('#55585a', 0.6, 0.4)));
    g.add(mesh(box(0.3, 0.06, 0.05, x, 1.86, z + 0.05), std('#3a3c3e', 0.6, 0.4)));
    const handle = new THREE.Group(), hm = std('#1a1a1a', 0.5, 0.3);
    handle.add(mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 10).translate(0, 0.5, 0), hm), mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.42, 10).rotateZ(Math.PI / 2), hm));
    scene.add(g, handle); out.disconnect = { group: g, handle, x, z };
    out.setHandle = (pivot, grip) => { const d = grip.clone().sub(pivot), L = d.length(); handle.position.copy(pivot); handle.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize());
      handle.children[0].scale.set(1, L, 1); handle.children[1].position.set(0, L, 0); }; }
  // the lot's sodium light through the south windows: a lamp outside with the sash as its gobo (no shadow: the wall is its window)
  const lot = new Lantern(scene, { profile: 'searchlight', half: 0.42, lumens: 20000, cookie: sashCanvas(5, 3), shadow: 0, beam: false, body: false, ref: 20, color: '#ffe6c4' });
  lot.place(V3(-14, 9.5, 27)).aim(V3(-12, 0, 5.5)); lot.gain = 0; lot.update(); out.lot = lot;
  // the high-bay lamps (off until the crew is in) and a soft fill from the aisle
  out.lamps = [];
  for (let x = -18; x <= 6; x += 4) { const L = new THREE.SpotLight('#fff4e6', 0, 0, 0.95, 0.65, 2); L.position.set(x, RY - 0.4, 1.8); L.target.position.set(x, 0, 0.4);
    if (x === -6 || x === -14) { L.castShadow = true; L.shadow.mapSize.set(1024, 1024); L.shadow.bias = -0.0005; L.shadow.normalBias = 0.03; }
    scene.add(L, L.target); out.lamps.push(L); }
  out.fill = new THREE.HemisphereLight('#c0c8d8', '#000000', 0); scene.add(out.fill);
  // the bench and the fixture (the lamp's insert): a bench top, a welded frame rail clamped in a jig, a bolt head
  { const g = new THREE.Group(), wood = std('#3a3026', 0.85), jig = std('#2c2e30', 0.5, 0.6), rail = std('#4a4c4e', 0.45, 0.7);
    g.add(mesh(box(1.8, 0.07, 0.75, -6.15, 0.885, 1.2), wood), mesh(box(0.08, 0.86, 0.08, -6.95, 0.43, 0.9), wood), mesh(box(0.08, 0.86, 0.08, -5.35, 0.43, 0.9), wood),
      mesh(box(0.08, 0.86, 0.08, -6.95, 0.43, 1.5), wood), mesh(box(0.08, 0.86, 0.08, -5.35, 0.43, 1.5), wood));
    g.add(mesh(box(0.9, 0.12, 0.12, -6.0, 0.98, 1.02), rail), mesh(box(0.14, 0.18, 0.3, -6.42, 0.99, 1.1), jig), mesh(box(0.14, 0.18, 0.3, -5.58, 0.99, 1.1), jig));
    g.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.05, 6).translate(-6.0, 1.065, 1.02), rail));
    scene.add(g); out.bench = g; out.bolt = V3(-6.0, 1.065, 1.02); }
  // the crew's fixtures: a low welding jig in front of each worker (0.44 m ahead, the work at about 0.66 m)
  { const g = new THREE.Group(), jm = std('#2a2c2e', 0.55, 0.6), parts = [];
    for (const c of CREW) { const h = c.heading, x = c.x + Math.sin(h) * 0.44, z = c.z + Math.cos(h) * 0.44;
      parts.push(box(0.56, 0.6, 0.34, x, 0.3, z), box(0.62, 0.05, 0.08, x, 0.63, z - 0.08), box(0.62, 0.05, 0.08, x, 0.63, z + 0.08)); }
    g.add(mesh(mergeGeometries(parts), jm)); g.visible = false; scene.add(g); out.fixtures = g; }
  return out;
}

// ------------------------------------------------------------------ the plant from across the lot
const SKY_VS = `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FS = `uniform vec3 uMoon; uniform float uK; varying vec3 vD;
void main(){ float h = clamp(vD.y, 0.0, 1.0), m = max(dot(normalize(vD), uMoon), 0.0);
  vec3 c = mix(vec3(0.045, 0.05, 0.065), vec3(0.008, 0.01, 0.016), pow(h, 0.45)) + vec3(0.16, 0.17, 0.2) * pow(m, 40.0) + vec3(0.05) * pow(m, 6.0);
  gl_FragColor = vec4(c * uK, 1.0); }`;
export function buildPlant(scene) {
  const out = { panes: [], winLights: [] }, X0 = EXT.x0, X1 = EXT.x0 + EXT.bays * EXT.bayW, Wb = X1 - X0, E = EXT.eave;
  { const lotG = groundPlane('asphalt', { size: 420 }); lotG.position.set(0, 0, 80); scene.add(lotG); out.lot = lotG; }
  // the sky and the low moon (up and to the left of the plant, seen from the lot)
  const MD = V3(-0.17, 0.13, -1).normalize(); out.moonDir = MD;
  const skyU = { uMoon: { value: MD }, uK: { value: 1 } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, uniforms: skyU, side: THREE.BackSide, depthWrite: false }));
  sky.position.set(0, 0, 142); scene.add(sky); out.sky = skyU;
  const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(7.5, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6.1, 6.4), fog: false }));
  moonDisc.position.set(0, 1.55, 142).addScaledVector(MD, 1100); moonDisc.lookAt(0, 1.55, 142); scene.add(moonDisc);
  const moonL = new THREE.DirectionalLight('#c8d2ea', 0.09); moonL.position.copy(MD).multiplyScalar(200); moonL.target.position.set(0, 0, 0); scene.add(moonL, moonL.target); out.moonL = moonL;
  // the building: a plinth, the piers between the bays, the lintel band, the sawtooth (one tooth to a bay, the steep face glazed), the dark interior
  const brick = std('#3a3430', 0.92), dark = std('#050505', 0.95), steelM = std('#1a1c1e', 0.5, 0.6), glazing = std('#0a0c10', 0.15, 0.2);
  const parts = [box(Wb, EXT.winY0, 0.5, 0, EXT.winY0 / 2, -0.25), box(Wb, E - EXT.winY1, 0.5, 0, (E + EXT.winY1) / 2, -0.25)];
  for (let b = 0; b <= EXT.bays; b++) { const x = X0 + b * EXT.bayW, w = b === 0 || b === EXT.bays ? EXT.winM * 2 + 0.4 : EXT.winM * 2; parts.push(box(w, EXT.winY1 - EXT.winY0, 0.5, x, (EXT.winY0 + EXT.winY1) / 2, -0.25)); }
  scene.add(mesh(mergeGeometries(parts), brick));
  const teeth = [];
  for (let b = 0; b < EXT.bays; b++) { const x0 = X0 + b * EXT.bayW, s = new THREE.Shape(); s.moveTo(x0, E); s.lineTo(x0 + EXT.bayW, E + EXT.rise); s.lineTo(x0 + EXT.bayW, E); s.lineTo(x0, E);
    teeth.push(new THREE.ExtrudeGeometry(s, { depth: EXT.depth, bevelEnabled: false }).translate(0, 0, -EXT.depth)); }
  scene.add(mesh(mergeGeometries(teeth), std('#24211f', 0.9)));
  for (let b = 0; b < EXT.bays; b++) scene.add(mesh(new THREE.PlaneGeometry(EXT.depth, EXT.rise * 0.86).rotateY(Math.PI / 2).translate(X0 + (b + 1) * EXT.bayW - 0.02, E + EXT.rise * 0.45, -EXT.depth / 2), glazing, { cast: false }));
  scene.add(mesh(mergeGeometries([box(Wb, 0.3, EXT.depth, 0, E - 0.15, -EXT.depth / 2), box(Wb, E, 0.3, 0, E / 2, -EXT.depth), box(0.3, E, EXT.depth, X0, E / 2, -EXT.depth / 2), box(0.3, E, EXT.depth, X1, E / 2, -EXT.depth / 2)]), dark));
  // the windows: steel sash bars in front, the panes behind them on layer 3 only (the base render never draws them: the matte does)
  const bars = [];
  for (let b = 0; b < EXT.bays; b++) {
    const x0 = X0 + b * EXT.bayW + EXT.winM, x1 = X0 + (b + 1) * EXT.bayW - EXT.winM, w = x1 - x0, h = EXT.winY1 - EXT.winY0, cxb = (x0 + x1) / 2, cy = (EXT.winY0 + EXT.winY1) / 2;
    for (let i = 0; i <= EXT.cols; i++) bars.push(box(0.07, h, 0.08, x0 + w * i / EXT.cols, cy, -0.04));
    for (let j = 0; j <= EXT.rows; j++) bars.push(box(w, 0.07, 0.08, cxb, EXT.winY0 + h * j / EXT.rows, -0.04));
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0xffffff })); pane.position.set(cxb, cy, -0.12); pane.layers.set(3); scene.add(pane); out.panes.push(pane);
    // the bay's light on the lot (a gobo of its own sash), off until the bay is lit
    const L = new Lantern(scene, { profile: 'incandescent', half: 0.62, lumens: 4000, cookie: sashCanvas(EXT.cols, EXT.rows), shadow: 0, beam: false, body: false, color: '#fff3e0' });
    L.place(V3(cxb, cy + 0.5, -2.5)).aim(V3(cxb, 0, 16)); L.gain = 0; L.update(); out.winLights.push(L);
  }
  scene.add(mesh(mergeGeometries(bars), steelM, { cast: false }));
  // the lot's sodium cut-off pole (practicals.js hpsCutoff figures on a plain SpotLight)
  { const P = PRACTICALS.hpsCutoff, [px, , pz] = EXT.pole, H = EXT.poleH;
    scene.add(mesh(new THREE.CylinderGeometry(0.09, 0.13, H, 10).translate(px, H / 2, pz), steelM), mesh(box(1.4, 0.08, 0.08, px - 0.7, H - 0.1, pz), steelM), mesh(box(0.55, 0.16, 0.38, px - 1.35, H - 0.18, pz), steelM));
    const L = new THREE.SpotLight('#ffcf8a', 0, 0, P.half, P.pen, 2); L.position.set(px - 1.35, H - 0.3, pz); L.target.position.set(px - 1.35, 0, pz + 0.5);
    L.castShadow = true; L.shadow.mapSize.set(1024, 1024); L.shadow.bias = -0.0005; L.shadow.camera.near = 0.3; L.shadow.camera.far = 40; scene.add(L, L.target);
    out.pole = L; out.poleCd = candelaFromLumens(P.lumens, P.half);
    out.poleFace = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.34).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0) }));
    out.poleFace.position.set(px - 1.35, H - 0.265, pz); scene.add(out.poleFace); }
  return out;
}
