// ART kit / STORM (cycle 2): the lineman at night, lit only by the world. HUMAN's lineman (folk_worlds KITS.lineman,
// read-only: his pose, grip on the conductor, hot stick, pole and conductors) is REUSED, not rebuilt; ART re-dresses
// him for a storm call-out and gives him a real bucket and the truck's lights. bucket.js's own lineman is retired
// (two linemen in the house is how c1 went backwards).
//
//   import { stormLineman } from '../lib/fx/art/storm.js';
//   const s = await stormLineman(st, { arcs: [1.2], lightning: [2.4] });   s.frame(t) -> canvas
//
// Reference: storm crews wear FR rain gear to ASTM F1891 in hi-vis with ANSI 107 retroreflective striping (NASCO,
// ArcWear), rubber insulating gloves under leather protectors, a hard hat whose brim shades the face. The band is his
// own "light from the world": retroreflective tape returns light toward its source, so it FLARES only when the camera
// sits near the axis of a light that hits it (the truck's flood from below, a car's headlight) and is dull grey off it.
// Rain is drawn only where it is lit: streaks inside the flood cone, the work light and the arc sphere, nothing in the
// dark (a streak's length is its fall speed x a 1/48 s shutter, projected). An arc flash is 3-5 frames at scene ~150.
import * as THREE from 'three';
import { KITS } from '../folk_worlds.js';
import { FilmExposure } from './exposure.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

// fibreglass: a woven-roving normal under yellow gel coat, grime in the corners, scuffs on the rim, a rating plate
function fibreglassMaps(seed = 3, base = '#d8b41c') {
  const n = 512, c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d'), R = mulberry(seed);
  g.fillStyle = base; g.fillRect(0, 0, n, n);
  for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(${R() < 0.6 ? '60,48,30' : '255,240,200'},${0.03 + 0.07 * R()})`; g.fillRect(R() * n, R() * n, 1 + R() * 3, 1 + R() * 3); }
  for (let i = 0; i < 90; i++) { g.strokeStyle = `rgba(${R() < 0.5 ? '40,30,20' : '250,240,220'},${0.15 + 0.3 * R()})`; g.lineWidth = 0.5 + R() * 1.5; const x = R() * n, y = R() * n * 0.25; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 50, y + R() * 8); g.stroke(); }  // rim scuffs
  const gr = g.createLinearGradient(0, n, 0, n * 0.5); gr.addColorStop(0, 'rgba(40,32,22,0.6)'); gr.addColorStop(1, 'rgba(40,32,22,0)'); g.fillStyle = gr; g.fillRect(0, 0, n, n);   // grime low
  for (let i = 0; i < 60; i++) { const x = R() * n, y = n * 0.3 + R() * n * 0.5, gg = g.createLinearGradient(0, y, 0, y + 80); gg.addColorStop(0, 'rgba(50,40,28,0.18)'); gg.addColorStop(1, 'rgba(50,40,28,0)'); g.fillStyle = gg; g.fillRect(x, y, 1 + R() * 2, 80); }  // drip streaks
  // rating plate (no brand): a small aluminium plate with engraved rows
  g.fillStyle = '#a8aaa6'; g.fillRect(n * 0.58, n * 0.42, 70, 44); g.fillStyle = '#3a3a38'; for (let r = 0; r < 5; r++) g.fillRect(n * 0.58 + 6, n * 0.42 + 6 + r * 8, 40 + (r * 17 % 20), 2);
  g.fillStyle = '#d71920'; g.fillRect(n * 0.58, n * 0.42 - 12, 70, 8);   // a red DANGER strip (the one red)
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
  // woven roving: a basket weave height field -> normal map
  const b = document.createElement('canvas'); b.width = b.height = 256; const bg = b.getContext('2d'), im = bg.createImageData(256, 256);
  const hgt = (x, y) => { const cx = Math.floor(x / 16), cy = Math.floor(y / 16), u = (x % 16) / 16, v = (y % 16) / 16; return (cx + cy) % 2 ? Math.sin(u * Math.PI) * 0.8 + 0.2 * Math.sin(v * 12) : Math.sin(v * Math.PI) * 0.8 + 0.2 * Math.sin(u * 12); };
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) { const dx = hgt(x + 1, y) - hgt(x - 1 + 256, y), dy = hgt(x, y + 1) - hgt(x, y - 1 + 256), o = (y * 256 + x) * 4;
    im.data[o] = 128 + dx * 40; im.data[o + 1] = 128 + dy * 40; im.data[o + 2] = 255; im.data[o + 3] = 255; }
  bg.putImageData(im, 0, 0); const normal = new THREE.CanvasTexture(b); normal.wrapS = normal.wrapT = THREE.RepeatWrapping; normal.repeat.set(3, 3);
  return { map, normal };
}

export async function stormLineman(st, { arcs = [], lightning = [], retro = 1, rainN = 2600, seed = 7, exposure = 1.0, cam = null } = {}) {
  const k = await KITS.lineman(st, {});
  const S = st.scene, h = k.heroes[0];
  // re-dress: hi-vis FR rain jacket (wet, a little clearcoat) over his shirt colour
  h.group.traverse(o => { if (!o.isMesh || !o.material?.color) return; const hex = '#' + o.material.color.getHexString();
    if (hex === '#34405a') { o.material = o.material.clone(); o.material.color.set('#8e9a14'); if ('clearcoat' in o.material) { o.material.clearcoat = 0.5; o.material.clearcoatRoughness = 0.35; } o.material.roughness = 0.6; /* c2b: albedo down so the flood models the folds instead of clipping the jacket to a yellow blob */ } });
  // retire the kit's primitive bucket walls and boom (beige boxes/bars) in favour of a textured bucket
  const hide = new Set(['e6dcc0', '1e1c1a', 'b01810', 'e8e2c8']);
  S.traverse(o => { if (o.isMesh && !o.isSkinnedMesh && o.material?.color && hide.has(o.material.color.getHexString()) && !h.group.getObjectById(o.id)) o.visible = false; });
  const bP = V3(h.group.position.x + 0.05, 12 + 0.5, h.group.position.z);
  const fg = fibreglassMaps(seed), fib = new THREE.MeshStandardMaterial({ map: fg.map, normalMap: fg.normal, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.3, metalness: 0 });
  const bucket = new THREE.Mesh(new RoundedBoxGeometry(0.66, 1.05, 0.62, 4, 0.1), fib); bucket.position.copy(bP); bucket.material.side = THREE.DoubleSide; bucket.castShadow = bucket.receiveShadow = true; S.add(bucket);
  const liner = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.03, 8, 4, Math.PI * 2), new THREE.MeshStandardMaterial({ color: '#1a1816', roughness: 0.5 })); liner.rotation.set(Math.PI / 2, 0, Math.PI / 4); liner.position.copy(bP).add(V3(0, 0.53, 0)); S.add(liner);
  const bottom = new THREE.Mesh(new THREE.CylinderGeometry(0.39, 0.39, 0.04, 4, 1, false, Math.PI / 4), fib); bottom.position.copy(bP).add(V3(0, -0.52, 0)); S.add(bottom);
  // the upper boom (white gel coat, a worn black dielectric band, a hydraulic hose along it) from below the bucket
  const boomM = new THREE.MeshStandardMaterial({ map: fibreglassMaps(seed + 2, '#8a867c').map, roughness: 0.4 }), band = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.6 }), hose = new THREE.MeshStandardMaterial({ color: '#0e0e0e', roughness: 0.35 });
  const bA = bP.clone().add(V3(-0.35, -0.55, 0)), bB = bP.clone().add(V3(-3.2, -9.5, -2.8)), bd = bB.clone().sub(bA), bl = bd.length();
  const boom = new THREE.Mesh(new THREE.BoxGeometry(0.28, bl, 0.34), boomM); boom.position.copy(bA).add(bB).multiplyScalar(0.5); boom.quaternion.setFromUnitVectors(V3(0, 1, 0), bd.clone().normalize()); S.add(boom);
  const bnd = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 0.36), band); bnd.position.copy(bA).addScaledVector(bd, 0.3); bnd.quaternion.copy(boom.quaternion); S.add(bnd);
  const hs = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, bl, 6), hose); hs.position.copy(boom.position).add(V3(0.17, 0, 0.1)); hs.quaternion.copy(boom.quaternion); S.add(hs);
  // retroreflective bands: two round each forearm/upper arm and one round the chest (ANSI 107 class 3)
  const retroM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.35, 0.33) }), bands = [];
  const ring = (a, b, u, r) => { const p = h.joint(a).lerp(h.joint(b), u), ax = h.joint(b).sub(h.joint(a)).normalize(), m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 4, 20), retroM); m.position.copy(p); m.quaternion.setFromUnitVectors(V3(0, 0, 1), ax); m.scale.set(1, 1, 2.2); S.add(m); bands.push(m); };
  for (const sd of ['L', 'R']) { ring(`upperarm01.${sd}`, `lowerarm01.${sd}`, 0.6, 0.072); ring(`lowerarm01.${sd}`, `wrist.${sd}`, 0.4, 0.06); }
  
  // the lights: find the kit's flood, work light and strobe; add the arc at the grip and lightning
  let flood = null, work = null, strobe = null, deck = null;
  S.traverse(o => { if (o.isSpotLight && o.intensity >= 20) flood = o; else if (o.isSpotLight) work = o; if (o.isPointLight && o.color.getHexString() === 'ffa020') strobe = o; if (o.isDirectionalLight) deck = o; });
  if (flood) { flood.intensity = 210; flood.angle = 0.2; flood.penumbra = 0.5; flood.castShadow = true; flood.shadow.mapSize.set(1024, 1024); }
  if (work) work.intensity = 18;
  if (deck) deck.intensity = 0.25;
  const gripP = h.palm('R').palm.clone();
  const arcL = new THREE.PointLight('#cfe0ff', 0, 40, 2); arcL.position.copy(gripP).add(V3(0.25, 0.05, -0.2)); S.add(arcL);
  const arcBall = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0) })); arcBall.position.copy(arcL.position); S.add(arcBall);
  const sky = new THREE.DirectionalLight('#a8b8ff', 0); sky.position.set(-3, 10, -6); S.add(sky);
  // the WORLDS night plate as the scene background (it is exposed with the 3D through the night curve)
  const pc = document.createElement('canvas'); pc.width = st.W; pc.height = st.H; const pg = pc.getContext('2d'); const PLs = 1.35; pg.drawImage(k.img, -(PLs - 1) * st.W / 2, -30, st.W * PLs, st.H * PLs);
  pg.fillStyle = 'rgba(4,6,12,0.45)'; pg.fillRect(0, 0, st.W, st.H);           // storm, not dusk: the deck is darker than the c3 plate
  const bgT = new THREE.CanvasTexture(pc); bgT.colorSpace = THREE.SRGBColorSpace; S.background = bgT;
  if (cam) { const hp = h.joint('head'); st.lookAt(hp.clone().add(V3(cam[0], cam[1], cam[2])), hp.clone().add(V3(cam[3], cam[4], 0)), cam[5]); }
  const fx = new FilmExposure(st.r, { W: st.W, H: st.H, curve: 'night', exposure, halation: 0.7, veil: 0.1, grain: 0.45 });
  // rain: a box of drops around him, lit analytically by the flood cone, the work light, the arc and lightning
  const R = mulberry(seed), drops = [], hp0 = h.joint('head');
  for (let i = 0; i < rainN; i++) drops.push({ x: hp0.x + (R() - 0.5) * 9, z: hp0.z + (R() - 0.5) * 7 + 1.5, y0: R(), v: 7 + 3 * R(), b: 0.5 + R() });
  const out = document.createElement('canvas'); out.width = st.W; out.height = st.H; const g = out.getContext('2d');
  const arcAt = t => arcs.reduce((m, a) => { const f = (t - a) * 30; return f >= 0 && f < 5 ? Math.max(m, [1, 0.8, 1, 0.5, 0.25][Math.floor(f)]) : m; }, 0);
  const boltAt = t => lightning.reduce((m, a) => { const f = (t - a) * 30; return f >= 0 && f < 8 ? Math.max(m, [1, 0.3, 0.9, 0.5, 0.3, 0.15, 0.08, 0.03][Math.floor(f)]) : m; }, 0);
  const fdir = new THREE.Vector3(), tmp = new THREE.Vector3(), camP = new THREE.Vector3();
  const shot = { st, fx, hero: h, bands, flood, strobe, arcAt, boltAt, frame(t) {
    const arc = arcAt(t), bolt = boltAt(t), stb = strobe ? (Math.floor(t / 0.6) % 2 === 0 ? 1 : 0.1) : 0;
    if (strobe) strobe.intensity = 26 * stb;
    arcL.intensity = 130 * arc; arcBall.material.color.setRGB(120 * arc, 140 * arc, 190 * arc); arcBall.scale.setScalar(0.3 + arc * 0.9);
    sky.intensity = 6 * bolt;
    // retroreflection: bright when the camera is near the flood's axis back toward the band
    camP.copy(st.camera.position);
    if (flood) { const toL = flood.position.clone().sub(bands[0].position).normalize(), toC = camP.clone().sub(bands[0].position).normalize(), cosA = toL.dot(toC);
      const r = retro * (0.25 + 2.6 * Math.pow(clamp((cosA - 0.55) / 0.45), 2)) + arc * 1.5 + bolt * 1.2; retroM.color.setRGB(0.9 * r, 0.9 * r, 0.85 * r); }
    const c = fx.render(S, st.camera, t, { exposure: exposure * (1 + 0.6 * bolt) }); g.drawImage(c, 0, 0);
    // lit rain: each drop is lit by the flood cone (angle test), the work light (falloff), the arc and lightning
    g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
    if (flood) fdir.copy(flood.target.position).sub(flood.position).normalize();
    const cosCone = flood ? Math.cos(flood.angle) : 1, sh = 1 / 48;
    for (const d of drops) {
      const span = 7, y = hp0.y + 3.5 - (((d.y0 * span + t * d.v) % span) + span) % span;
      tmp.set(d.x, y, d.z); let E = 0;
      if (flood) { const v = tmp.clone().sub(flood.position), dl = v.length(); v.divideScalar(dl); const c2 = v.dot(fdir); if (c2 > cosCone) E += 90 * Math.pow(clamp((c2 - cosCone) / (1 - cosCone)), 3) / (1 + dl * dl * 0.06); }   /* c2b: the beam has a hot core; rain fades toward its edge */
      if (work) { const dl = tmp.distanceTo(work.position); if (dl < 1.6) E += 0.6 / (0.3 + dl * dl); }
      if (arc) { const dl = tmp.distanceTo(arcL.position); E += arc * 40 / (0.2 + dl * dl); }
      E += bolt * 0.5;
      if (E < 0.7) continue;                                    // unlit rain is invisible
      const p1 = st.project(tmp), p2 = st.project(tmp.clone().add(V3(0.03, d.v * sh, 0.01)));
      if (p1[2] > 1 || p1[0] < -20 || p1[0] > st.W + 20) continue;
      const a = clamp((E - 0.3) * 0.18 * d.b, 0, 0.7);
      g.strokeStyle = arc > 0.3 ? `rgba(200,220,255,${a})` : `rgba(255,236,205,${a})`; g.lineWidth = 1.2 + d.b * 0.8;
      g.beginPath(); g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.stroke();
    }
    g.restore();
    return out;
  } };
  return shot;
}
