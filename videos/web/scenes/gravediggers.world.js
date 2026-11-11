// THE GRAVEDIGGERS: the world's props (scene-local): the 96 headstones with their years cut in (v2: granite, arched and shouldered, on
// bases, weathered), the old graveyard round them, the enamel sign in the grave, the buried plant (americana_city's Plant, sunk 130 m; its
// four stacks' tops out of the ground) that rises with its lights built on and switched off until the light (americana_c2 lfSwitch), the
// dust off its line, its steam, the warm rake from its bearing, the steam off the cup. Canvas atlases are drawn once.
import * as THREE from 'three';
import { Plant, Plumes } from '../lib/fx/americana_city.js';
import { lfSwitch } from '../lib/fx/americana_c2.js';
import { patchMaterial } from '../lib/fx/atmos3d.js';
import { TL, COL, RIM, GRAVE, D2R } from './gravediggers.plan.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const eio = u => { u = clamp(u); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const SERIF = '"Cormorant Garamond", "Playfair Display", Georgia, "Times New Roman", serif';
const mul = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

// the plant: 1 km north, about on the graveyard's axis (americana_city's Plant spans origin x -420 .. +700), set 90 m east of centre so
// that from the close (low in the U.S. trench, looking north) none of the four stack tops stands behind the two heroes
export const PLANT = { origin: [-50, 0, -900], sink: 130, stackShow: 24, rise: [TL.rise, TL.lit - 0.25], riseV4: [TL.rise - 2.5, TL.lit - 0.25] };   // v2: 7.25 s, not 3.85; v4: the plant starts up 2.5 s (world time) before the wide opens, so the stacks stand over the haze from the first frame
export const RAKE_DIR = new THREE.Vector3((PLANT.origin[0] + 140) / 900, Math.sin(7 * Math.PI / 180), -Math.cos(7 * Math.PI / 180)).normalize();   // toward the plant's middle, low

// ---------------------------------------------------------------- the sky's beacon (the plant's red, blinking at the mouth's head edge)
export const BEACON_HOOK = { uniforms: { uBeacon: { value: 0 }, uBeaconDir: { value: new THREE.Vector3(0, Math.cos(0.66), -Math.sin(0.66)) } },
  glsl: /* glsl */`
uniform float uBeacon; uniform vec3 uBeaconDir;
vec3 atmosHook(vec3 dir, float dist, vec3 c, float isSky){
  if (uBeacon <= 0.0) return c;
  float a = max(dot(dir, uBeaconDir), 0.0);
  return c + vec3(1.0, 0.3, 0.07) * uBeacon * (pow(a, 60.0) * 0.5 + pow(a, 9.0) * 0.08) * isSky;
}
` };

export function buildWorld({ scene, atmos, lfPlant, lfGrave, D }) {
  const out = {};
  // ---------------------------------------------------------------- the stones (v2): headstones, not bars. Granite slabs with arched or
  // shouldered tops on a low base, weathered (a canvas granite: grain, speckle, lichen, the rain's streaks down the face), the year cut
  // into the west face under the arch (dark in the cut, a lit lip under it). The rows shrink toward the grave by each country's own record.
  const gran = document.createElement('canvas'); gran.width = gran.height = 512;
  { const g = gran.getContext('2d'), R = mul(1848); g.fillStyle = '#8f8c86'; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 26000; i++) { const v = 110 + R() * 70 | 0, a = 0.18 + R() * 0.3; g.fillStyle = `rgba(${v},${v - 2},${v - 6},${a})`; g.fillRect(R() * 512, R() * 512, 1 + R() * 2.2, 1 + R() * 2.2); }
    for (let i = 0; i < 2600; i++) { const v = R() < 0.5 ? 40 + R() * 30 : 190 + R() * 50; g.fillStyle = `rgba(${v},${v},${v},${0.35 + R() * 0.4})`; g.fillRect(R() * 512, R() * 512, 1.2, 1.2); }
    for (let i = 0; i < 70; i++) { const x = R() * 512, w = 2 + R() * 9, y0 = R() * 200; const gr = g.createLinearGradient(0, y0, 0, y0 + 160 + R() * 300);
      gr.addColorStop(0, 'rgba(40,38,34,0.0)'); gr.addColorStop(0.2, `rgba(40,38,34,${0.08 + R() * 0.14})`); gr.addColorStop(1, 'rgba(40,38,34,0)'); g.fillStyle = gr; g.fillRect(x, y0, w, 460); }
    for (let i = 0; i < 90; i++) { const x = R() * 512, y = R() * 512, r = 3 + R() * 18; g.fillStyle = `rgba(${70 + R() * 30 | 0},${74 + R() * 30 | 0},${58 + R() * 20 | 0},${0.18 + R() * 0.25})`;
      g.beginPath(); g.ellipse(x, y, r, r * (0.5 + R() * 0.6), R() * 3, 0, 7); g.fill(); } }
  const granTex = new THREE.CanvasTexture(gran); granTex.colorSpace = THREE.SRGBColorSpace; granTex.wrapS = granTex.wrapT = THREE.RepeatWrapping; granTex.repeat.set(1.6, 1.6); granTex.anisotropy = 4;
  const atlas = document.createElement('canvas'), CW = 256, CH = 128, NC = 8, NR = 6; atlas.width = CW * NC; atlas.height = CH * NR;
  { const g = atlas.getContext('2d'); g.clearRect(0, 0, atlas.width, atlas.height); g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let k = 0; k < COL.n; k++) { const cx = (k % NC + 0.5) * CW, cy = (Math.floor(k / NC) + 0.5) * CH; g.font = `600 92px ${SERIF}`;
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillText(String(COL.y0 + k), cx, cy + 7);              // the lit lower lip of the cut
      g.fillStyle = '#ffffff'; g.globalCompositeOperation = 'destination-out'; g.fillText(String(COL.y0 + k), cx, cy + 3); g.globalCompositeOperation = 'source-over';
      g.fillStyle = 'rgba(0,0,0,1)'; g.fillText(String(COL.y0 + k), cx, cy + 3); } }                    // the cut itself, in shadow
  const atlasTex = new THREE.CanvasTexture(atlas); atlasTex.colorSpace = THREE.SRGBColorSpace; atlasTex.anisotropy = 8;
  const stoneM = patchMaterial(new THREE.MeshStandardMaterial({ color: '#b6b2aa', map: granTex, roughness: 0.88, metalness: 0 }), lfGrave, { wallFall: 3 });
  const cutM = patchMaterial(new THREE.MeshStandardMaterial({ color: '#ffffff', map: atlasTex, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), lfGrave, { wallFall: 3 });
  // a headstone's outline in its own plane (u across, v up): an arch, a shouldered top or a gabled one; extruded to its thickness
  const outline = (w, h, kind) => { const S = new THREE.Shape(), a = w / 2; S.moveTo(-a, 0); S.lineTo(a, 0);
    if (kind === 0) { const r = a; S.lineTo(a, h - r); S.absarc(0, h - r, r, 0, Math.PI, false); }
    else if (kind === 1) { const sh = Math.min(0.07, h * 0.08); S.lineTo(a, h - sh * 2.2); S.quadraticCurveTo(a, h - sh, a - sh, h - sh); S.quadraticCurveTo(a * 0.35, h - sh, a * 0.3, h - sh * 0.3);
      S.absarc(0, h - a * 0.3 - sh * 0.3, a * 0.3, 0, Math.PI, false); S.quadraticCurveTo(-a * 0.35, h - sh, -a + sh, h - sh); S.quadraticCurveTo(-a, h - sh, -a, h - sh * 2.2); }
    else { S.lineTo(a, h - a * 0.45); S.lineTo(0, h); S.lineTo(-a, h - a * 0.45); }
    S.lineTo(-a, 0); return S; };
  const slabGeo = (w, h, t, kind, bevel = 0.008) => { const g = new THREE.ExtrudeGeometry(outline(w - 2 * bevel, h - bevel, kind), { depth: t - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 18 });
    g.translate(0, 0, -(t - 2 * bevel) / 2); g.rotateY(-Math.PI / 2); return g; };          // face (+z of the shape) turned to -x: west
  const baseGeo = (w, t) => new THREE.BoxGeometry(t + 0.07, 0.07, w + 0.06).translate(0, 0.035, 0);
  out.stones = D.stones.map(s => {
    const kind = (s.k * 7 + (s.country === 'us' ? 0 : 3)) % 5 === 0 ? 2 : (s.k + (s.country === 'us' ? 1 : 0)) % 3 === 0 ? 1 : 0, w = COL.w + 0.02;
    const m = new THREE.Mesh(baseGeo(w, COL.t), stoneM); m.castShadow = m.receiveShadow = true; m.matrixAutoUpdate = false;
    const slab = new THREE.Mesh(slabGeo(w, s.h, COL.t, kind), stoneM); slab.position.y = 0.065; slab.castShadow = slab.receiveShadow = true; m.add(slab); slab.updateMatrix();
    // the cut: the year on the west face under the top
    const ch = 0.075, cw = ch * 2, pg = new THREE.PlaneGeometry(cw, ch), u0 = (s.k % NC) / NC, v1 = 1 - Math.floor(s.k / NC) / NR, uv = pg.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) / NC, v1 - (1 - uv.getY(i)) / NR);
    pg.rotateY(-Math.PI / 2); pg.translate(-COL.t / 2 - 0.0015, 0.065 + s.h - (kind === 0 ? w / 2 + 0.07 : 0.16), 0);
    const cut = new THREE.Mesh(pg, cutM); cut.receiveShadow = true; m.add(cut); cut.updateMatrix();
    if (scene) scene.add(m); return { s, mesh: m, lean: { deg: 0 }, foot: 0 };
  });
  // the old graveyard round the record: rows of older stones east of the U.S. column and north beyond the 1979 end (no years: worn
  // faces, a few broken, some leaning), so the two rows stand inside a graveyard and not on a lawn. Static, instanced by shape.
  { const R = mul(1917), spots = [];
    for (let x = 1.9; x <= 9.5; x += 1.25 + R() * 0.2) for (let z = -3.6; z >= -27; z -= 1.05 + R() * 0.35) if (R() > 0.12) spots.push([x + (R() - 0.5) * 0.25, z]);
    for (let z = -24.2; z >= -33; z -= 1.4 + R() * 0.3) for (let x = -6.4; x <= 9.5; x += 1.0 + R() * 0.4) if (R() > 0.18) spots.push([x + (R() - 0.5) * 0.3, z]);
    const kinds = [0, 1, 2].map(k => ({ k, geo: slabGeo(0.42, 1, 0.1, k), list: [] }));
    for (const [x, z] of spots) { const k = R() < 0.55 ? 0 : R() < 0.6 ? 1 : 2, h = 0.45 + R() * 0.7 * (R() < 0.15 ? 0.4 : 1), w = 0.34 + R() * 0.2;
      kinds[k].list.push({ x, z, h, w, yaw: (R() - 0.5) * 0.12, lean: (R() - 0.5) * (R() < 0.2 ? 0.22 : 0.06), roll: (R() - 0.5) * 0.06 }); }
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const oldM = new THREE.MeshStandardMaterial({ color: '#a8a49c', map: granTex, roughness: 0.9, metalness: 0 });     // unpatched: the pools never reach them
    out.oldStones = kinds.map(K => { const im = new THREE.InstancedMesh(K.geo, oldM, K.list.length); im.castShadow = im.receiveShadow = true;
      K.list.forEach((o, i) => { q.setFromEuler(e.set(o.roll, o.yaw, o.lean)); M.compose(V3(o.x, -0.04, o.z), q, V3(1, o.h, o.w / 0.42)); im.setMatrixAt(i, M); });
      im.instanceMatrix.needsUpdate = true; if (scene) scene.add(im); return im; }); }
  const _q = new THREE.Quaternion(), _p = V3(), _s = V3(1, 1, 1), up = V3(0, 1, 0);
  // the stones on the ground at t, leaning as the settle tilts them. Each stands on the trench's lip, where the shear's slope (60-70 deg
  // under the foot) would throw it down: none falls, so the tilt is ranked into the brief's 3-5 deg (the steepest ground leans most),
  // and it comes on with the settle's own ease (the slope at t over the settled slope)
  let LU = null;
  out.placeStones = (t, ew) => {
    if (!LU) { const S = ew.settles.at(-1), tr = S ? S.t + S.over + 0.1 : 0, raw = out.stones.map(o => (S ? ew.lean(o.s.x, o.s.z, tr, { r: 0.12, max: 90 }).deg : 0));
      const rank = raw.map((r, i) => i).sort((a, b) => raw[a] - raw[b]); LU = raw.map(r => ({ ref: r, deg: 0 })); rank.forEach((i, n) => { LU[i].deg = 3 + 2 * n / Math.max(1, rank.length - 1); }); }
    out.stones.forEach((o, i) => { const { x, z } = o.s, L = ew.lean(x, z, t, { r: 0.12, max: 90 }), y = ew.heightAt(x, z, t), U = LU[i];
      L.deg = U.ref > 1e-6 ? Math.min(1, Math.tan(L.deg * D2R) / Math.tan(U.ref * D2R)) * U.deg : 0;
      o.lean = L; o.foot = y; _q.setFromAxisAngle(L.axis, L.deg * Math.PI / 180); _p.set(x, y, z); o.mesh.matrix.compose(_p, _q, _s); o.mesh.matrixWorldNeedsUpdate = true; }); };
  // (v1's ledger, a slab cut CANADA · U.S. · 1979 at the head of the columns, is gone: it labelled what the stones are)
  // ---------------------------------------------------------------- the sign on the grave's floor: white enamel, PRIVATE PROPERTY / NO TRESPASSING
  { const [sx, sy, sz, sw, sl] = RIM.sign, cv = document.createElement('canvas'); cv.width = 1200; cv.height = 800; const g = cv.getContext('2d');
    g.fillStyle = '#cfc6b0'; g.fillRect(0, 0, 1200, 800);
    { const gr = g.createRadialGradient(600, 400, 120, 600, 400, 760); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(60,44,30,0.45)'); g.fillStyle = gr; g.fillRect(0, 0, 1200, 800); }
    g.strokeStyle = '#111'; g.lineWidth = 26; g.strokeRect(46, 46, 1108, 708); g.lineWidth = 6; g.strokeRect(80, 80, 1040, 640);
    g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const fit = (txt, size, maxW) => { g.font = `${size}px "Archivo Black", "Anton", sans-serif`; const m = g.measureText(txt).width; if (m > maxW) g.font = `${size * maxW / m}px "Archivo Black", "Anton", sans-serif`; };
    fit('PRIVATE', 190, 960); g.fillText('PRIVATE', 600, 300); fit('PROPERTY', 190, 960); g.fillText('PROPERTY', 600, 500); g.fillRect(250, 548, 700, 12); fit('NO TRESPASSING', 96, 900); g.fillText('NO TRESPASSING', 600, 668);
    for (const [hx, hy] of [[96, 96], [1104, 96], [96, 704], [1104, 704]]) { g.beginPath(); g.arc(hx, hy, 14, 0, 7); g.fillStyle = '#2a2622'; g.fill(); }
    { let s = 1848; const r = () => (s = (s * 16807) % 2147483647) / 2147483647; g.fillStyle = '#3a2f26';      // chips at the edges: the enamel off the iron
      for (let i = 0; i < 46; i++) { const e = Math.floor(r() * 4), u = r(), x = e < 2 ? u * 1200 : e === 2 ? r() * 30 : 1200 - r() * 30, y = e >= 2 ? u * 800 : e === 0 ? r() * 30 : 800 - r() * 30;
        g.beginPath(); g.ellipse(x, y, 6 + r() * 26, 5 + r() * 18, r() * 3, 0, 7); g.fill(); } }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const side = new THREE.MeshStandardMaterial({ color: '#2c2a28', roughness: 0.7, metalness: 0.4 }), face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0.05 });
    patchMaterial(face, lfGrave, { wallFall: 3 }); patchMaterial(side, lfGrave, { wallFall: 3 });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.012, sl), [side, side, face, side, side, side]); sign.position.set(sx, sy + 0.004, sz); sign.rotation.set(0.03, Math.PI, 0.02);   // finish (c20): raised onto the floor (at sy - 0.012 and 0.07 / 0.05 rad the floor hid all but a corner on the farm render: only 'RTY / ESPASSING' showed); one corner still under the earth   // v2: tipped, its far end under the floor's earth     // its top toward the foot end (south): it reads from the head end
    sign.receiveShadow = true; sign.castShadow = true; out.sign = sign; if (scene) scene.add(sign); }

  // ---------------------------------------------------------------- the plant, buried; its lights built at their final places, off
  const L0 = lfPlant.lights.length, plantG = new THREE.Group(), stacksG = new THREE.Group(); if (scene) scene.add(plantG, stacksG);
  const plant = new Plant({ scene: plantG }, lfPlant, { origin: PLANT.origin, seed: 1917, patch: patchMaterial });
  const L1 = lfPlant.lights.length; out.lightIdx = Array.from({ length: L1 - L0 }, (_, i) => L0 + i);
  plantG.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  // the four stacks (and their bands) in their own group: each sunk so that its top stands out of the ground
  out.stackParts = []; for (const m of [...plantG.children]) { if (m.name !== 'stack' && m.name !== 'stack band') continue; m.geometry.computeBoundingBox(); const c = m.geometry.boundingBox.getCenter(V3());
    const st = plant.stacks.reduce((b, s) => (Math.hypot(s.x - c.x, s.z - c.z) < Math.hypot(b.x - c.x, b.z - c.z) ? s : b)); plantG.remove(m); stacksG.add(m); out.stackParts.push({ m, sink: st.h - PLANT.stackShow }); }
  out.plant = plant; out.plantG = plantG; out.stacksG = stacksG;
  // the dust off the line where it meets the ground (moonlit: the lights are off), and the steam that the lights take at the drop
  const b = plant.bounds, dust = [];
  for (let i = 0; i <= 10; i++) dust.push({ x: b.x0 + (b.x1 - b.x0) * i / 10, y: 3, z: b.z1 + 10, size: 26, rise: 70 });
  for (let i = 1; i < 4; i++) dust.push({ x: b.x0 - 10, y: 3, z: b.z1 - (b.z1 - b.z0) * i / 4, size: 24, rise: 60 }, { x: b.x1 + 10, y: 3, z: b.z1 - (b.z1 - b.z0) * i / 4, size: 24, rise: 60 });
  out.dust = new Plumes(atmos, lfPlant, dust, { n: 140, seed: 23, gain: 0 });
  const st = plant.stacks;
  out.steam = new Plumes(atmos, lfPlant, [{ x: st[2].x, y: st[2].h, z: st[2].z, size: 8, rise: 240 }, { x: st[0].x, y: st[0].h, z: st[0].z, size: 6, rise: 180 },
    { x: plant.cooling.x, y: plant.cooling.h, z: plant.cooling.z, size: 30, rise: 520 }, { x: PLANT.origin[0] + 290, y: 44, z: PLANT.origin[2] - 60, size: 14, rise: 300 }], { n: 300, seed: 29, gain: 0 });
  atmos.setTowns([]);
  // the rake: a low warm key from the plant's bearing, its own shadows (every stone and worker a second shadow toward the grave)
  const rake = new THREE.DirectionalLight('#ffb070', 0); rake.castShadow = true; rake.shadow.mapSize.set(2048, 2048); rake.shadow.bias = -0.0004; rake.shadow.normalBias = 0.03;
  if (scene) scene.add(rake, rake.target); out.rake = rake;
  // ---------------------------------------------------------------- the steam off the cup: a few soft puffs rising and spreading, moonlit
  { const n = 46, P = new Float32Array(n * 3), A = new Float32Array(n); for (let i = 0; i < n; i++) A[i] = i / n;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('aA', new THREE.BufferAttribute(A, 1));
    const F = atmos.frameU, U = { uT: { value: 0 }, uRes: F.uRes, tDepth: F.tDepth, uScale: { value: 1000 }, uK: { value: 1 } };
    const mat = new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      vertexShader: `attribute float aA; uniform float uT, uScale, uK; varying float vA; varying vec4 vCP;
        void main(){ float u = fract(aA + uT * 0.45), s = fract(sin(aA * 91.7) * 4375.85);
          vec3 p = position + vec3((s - 0.5) * 0.06 + 0.05 * u * sin(uT * 2.3 + aA * 9.0), 0.42 * u, (fract(s * 7.3) - 0.5) * 0.06 + 0.03 * u);
          vec4 mv = viewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; vCP = gl_Position;
          gl_PointSize = min(uScale * (0.03 + 0.09 * u) / max(0.05, -mv.z), 220.0); vA = uK * smoothstep(0.0, 0.12, u) * (1.0 - u) * 0.32; }`,
      fragmentShader: `uniform sampler2D tDepth; varying float vA; varying vec4 vCP;
        void main(){ vec3 ndc = vCP.xyz / vCP.w; if (texture2D(tDepth, ndc.xy * 0.5 + 0.5).r < ndc.z * 0.5 + 0.5 - 1e-5) discard;
          float r = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, r) * vA; gl_FragColor = vec4(vec3(0.62, 0.66, 0.74) * a, a); }` });
    const pts = new THREE.Points(g, mat); pts.frustumCulled = false; atmos.overlay.add(pts); out.steamCup = { pts, U, P, n }; }

  // ---------------------------------------------------------------- per frame
  let switched = -1;
  out.update = (t, shot, cam) => {
    // the rise: sunk 130 m, up to grade over 23.4-27.25 (ease in-out); the stacks each from its own depth
    const u = eio((t - PLANT.riseV4[0]) / (PLANT.riseV4[1] - PLANT.riseV4[0]));
    plantG.position.y = -PLANT.sink * (1 - u); for (const p of out.stackParts) p.m.position.y = -p.sink * (1 - u);
    plantG.visible = stacksG.visible = shot === 'close' || shot === 'wide';
    const vel = Math.sin(Math.PI * clamp((t - PLANT.rise[0]) / (PLANT.rise[1] - PLANT.rise[0])));
    out.dust.U.uGain.value = shot === 'wide' ? 0.38 * vel * vel : 0;            // v2: a haze off the line, not v1's white-out out.dust.points.visible = shot === 'wide';
    // the lights: all on together on the drop (k 0 -> 1 in 0.25 s); the steam and the cloud base take them
    const k = sstep(TL.lit, TL.lit + 0.25, t);
    if (Math.abs(k - switched) > 1e-4) { lfSwitch(lfPlant, out.lightIdx, k); switched = k; }
    out.k = k; out.steam.U.uGain.value = 0.8 * k; out.steam.points.visible = (shot === 'wide' || shot === 'close') && k > 0;
    atmos.setTowns(k > 0 ? [{ x: PLANT.origin[0] + 140, z: PLANT.origin[2] - 60, r: 1300, i: 0.55 * k }] : []);
    BEACON_HOOK.uniforms.uBeacon.value = 0;                 // v2: the blinking red beacon in frame 0's sky is gone (a device, not this piece's)
    // the steam off the cup, while there is a cup
    const S = out.steamCup; S.U.uT.value = t; S.U.uScale.value = 1920 / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)); S.pts.visible = shot === 'grave' || shot === 'wide' || shot === 'climb' || shot === 'yard';
    return k;
  };
  out.steamAt = p => { const S = out.steamCup; for (let i = 0; i < S.n; i++) S.P.set([p.x, p.y + 0.06, p.z], i * 3); S.pts.geometry.attributes.position.needsUpdate = true; };
  return out;
}
