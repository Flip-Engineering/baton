// ART kit / LADLE: a steel-mill teeming ladle as a model, not a grey cylinder. three.js.
//
//   import { buildLadle, buildHook, buildMoulds, buildTruss, surfaceTextures } from '../lib/fx/art/ladle.js';
//   const L = buildLadle({ seed: 3 });  scene.add(L.group);  L.tilt(0.55);  L.lipWorld() -> Vector3 (pour point)
//
// Anatomy (after period photographs of Bessemer / open-hearth teeming ladles, 1900-1950): a riveted plate shell,
// slightly tapered, in three strakes with lap seams and a rivet row on each; two forged girth BANDS; two TRUNNIONS on
// cast collars at 60% height carrying the BAIL (a flat forged yoke) that the crane hook takes; a pouring SPOUT at the lip;
// a refractory LINING showing at the rim, its lip built up with frozen slag (skull) that drips down the outside;
// heat-tint on the upper shell (straw -> bronze -> blue -> grey), soot and runs of rust, bright wear on the band edges.
// Surfaces are canvas-painted maps (albedo + roughness + bump), so the model survives a 1:1 crop.
import * as THREE from 'three';

function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// painted shell maps: u around, v up. Returns { map, rough, bump } CanvasTextures.
export function surfaceTextures({ w = 1024, h = 512, seed = 3, strakes = 3, heatTint = true, base = [44, 40, 37], rivets = true } = {}) {
  const R = mulberry(seed);
  const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const A = mk(), Rg = mk(), B = mk(), a = A.getContext('2d'), r = Rg.getContext('2d'), b = B.getContext('2d');
  // base plate: mill scale mottling
  a.fillStyle = `rgb(${base})`; a.fillRect(0, 0, w, h); r.fillStyle = '#b0b0b0'; r.fillRect(0, 0, w, h); b.fillStyle = '#808080'; b.fillRect(0, 0, w, h);
  // mill scale: streaky, not blotchy (plates were rolled): horizontal smears at two scales, plus fine pitting
  for (let i = 0; i < 1400; i++) { const x = R() * w, y = R() * h, L = 20 + R() * 160, k = R();
    a.fillStyle = k < 0.55 ? `rgba(18,15,13,${0.05 + 0.1 * R()})` : k < 0.85 ? `rgba(84,64,48,${0.05 + 0.08 * R()})` : `rgba(110,102,94,${0.04 + 0.06 * R()})`;
    a.fillRect(x, y, L, 1 + R() * 5);
    b.fillStyle = `rgba(${k < 0.5 ? 90 : 160},${k < 0.5 ? 90 : 160},${k < 0.5 ? 90 : 160},0.1)`; b.fillRect(x, y, L, 1 + R() * 3); }
  for (let i = 0; i < 9000; i++) { const x = R() * w, y = R() * h; a.fillStyle = `rgba(10,8,7,${0.1 + 0.25 * R()})`; a.fillRect(x, y, 1 + R() * 1.5, 1 + R() * 1.5);
    b.fillStyle = 'rgba(40,40,40,0.35)'; b.fillRect(x, y, 1.5, 1.5); }
  // heat tint band near the top (v high = top in three's lathe uv: v=1 at the top)
  if (heatTint) { const g = a.createLinearGradient(0, 0, 0, h * 0.45);
    g.addColorStop(0, 'rgba(40,52,70,0.55)'); g.addColorStop(0.35, 'rgba(70,60,90,0.35)'); g.addColorStop(0.6, 'rgba(120,80,40,0.35)'); g.addColorStop(1, 'rgba(150,120,70,0)');
    a.fillStyle = g; a.fillRect(0, 0, w, h * 0.45); }
  // rust runs down from the seams and the rim; soot up from the bottom
  for (let i = 0; i < 260; i++) { const x = R() * w, y0 = R() < 0.5 ? R() * h * 0.2 : (Math.floor(R() * strakes) / strakes) * h, L = 30 + R() * 180;
    const g = a.createLinearGradient(0, y0, 0, y0 + L); g.addColorStop(0, `rgba(${110 + 40 * R()},${50 + 20 * R()},24,${0.25 + 0.3 * R()})`); g.addColorStop(1, 'rgba(90,40,20,0)');
    a.fillStyle = g; a.fillRect(x, y0, 1.5 + R() * 4, L); }
  const sg = a.createLinearGradient(0, h, 0, h * 0.6); sg.addColorStop(0, 'rgba(10,8,8,0.75)'); sg.addColorStop(1, 'rgba(10,8,8,0)'); a.fillStyle = sg; a.fillRect(0, h * 0.6, w, h * 0.4);
  // strake seams (lap joints) and rivet rows; vertical butt straps every 1/6 turn
  for (let s = 1; s < strakes; s++) { const y = Math.round(h * s / strakes);
    a.fillStyle = 'rgba(12,10,9,0.8)'; a.fillRect(0, y - 2, w, 3); b.fillStyle = '#c8c8c8'; b.fillRect(0, y - 9, w, 8); b.fillStyle = '#404040'; b.fillRect(0, y - 1, w, 3);
    if (rivets) for (let x = 6; x < w; x += 17) { rivet(a, b, r, x + R() * 1.5, y - 14); } }
  for (let k = 0; k < 6; k++) { const x = (k + 0.3) / 6 * w; a.fillStyle = 'rgba(14,12,11,0.6)'; a.fillRect(x - 11, 0, 2, h); a.fillRect(x + 11, 0, 2, h); b.fillStyle = '#b8b8b8'; b.fillRect(x - 11, 0, 24, h);
    if (rivets) for (let y = 10; y < h; y += 19) { rivet(a, b, r, x - 5, y); rivet(a, b, r, x + 6, y + 8); } }
  // bright wear: a few scraped patches
  for (let i = 0; i < 40; i++) { a.fillStyle = `rgba(150,140,128,${0.15 + 0.2 * R()})`; const x = R() * w, y = R() * h; a.fillRect(x, y, 4 + R() * 30, 1 + R() * 2); r.fillStyle = 'rgba(60,60,60,0.7)'; r.fillRect(x, y, 4 + R() * 30, 2); }
  const T = c => { const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4; return t; };
  const map = T(A); map.colorSpace = THREE.SRGBColorSpace;
  return { map, rough: T(Rg), bump: T(B), canvases: { A, Rg, B } };
}
function rivet(a, b, r, x, y) {
  const g = a.createRadialGradient(x - 1.5, y - 1.5, 0.5, x, y, 5); g.addColorStop(0, 'rgba(62,56,50,0.8)'); g.addColorStop(0.6, 'rgba(34,30,27,0.9)'); g.addColorStop(1, 'rgba(10,8,8,0.8)');
  a.fillStyle = g; a.beginPath(); a.arc(x, y, 5, 0, 7); a.fill();
  const gb = b.createRadialGradient(x, y, 0, x, y, 5.5); gb.addColorStop(0, '#ffffff'); gb.addColorStop(1, 'rgba(128,128,128,0)'); b.fillStyle = gb; b.beginPath(); b.arc(x, y, 5.5, 0, 7); b.fill();
  r.fillStyle = '#707070'; r.beginPath(); r.arc(x, y, 3, 0, 7); r.fill();
}

export function steelMaterial(tex, { color = '#ffffff', metal = 0.55, bump = 0.012 } = {}) {
  return new THREE.MeshStandardMaterial({ color, map: tex.map, roughnessMap: tex.rough, roughness: 1, bumpMap: tex.bump, bumpScale: bump, metalness: metal });
}

// a ladle, ~3.2 m tall. Local origin: the trunnion axis centre. group.tilt(a) rotates about the trunnions (x axis).
export function buildLadle({ seed = 3, H = 3.2, Rb = 1.35, Rt = 1.62, fill = 0.86, tex = null, material = null, linMat = null, slagMat = null } = {}) {
  const R = mulberry(seed * 13 + 1), group = new THREE.Group(), body = new THREE.Group(); group.add(body);
  const yT = H * 0.6;                         // trunnion height from the base
  body.position.y = -yT;
  const t = tex || surfaceTextures({ seed });
  const shellM = material || steelMaterial(t);
  // shell: tapered with a slight belly, rounded bottom corner
  const prof = [];
  for (let i = 0; i <= 24; i++) { const u = i / 24, y = u * H; const r = Rb + (Rt - Rb) * u + 0.06 * Math.sin(Math.PI * u); prof.push(new THREE.Vector2(r, y)); }
  prof.unshift(new THREE.Vector2(Rb - 0.12, -0.02), new THREE.Vector2(Rb - 0.03, 0.0)); prof.unshift(new THREE.Vector2(0, -0.02));
  const shell = new THREE.Mesh(new THREE.LatheGeometry(prof, 72), shellM); shell.castShadow = shell.receiveShadow = true; body.add(shell);
  // girth bands (forged, proud of the shell) with bright worn edges
  const bandM = material || new THREE.MeshStandardMaterial({ color: '#4a4440', roughness: 0.55, metalness: 0.7, map: t.map, bumpMap: t.bump, bumpScale: 0.01 });
  for (const v of [0.18, 0.78]) { const y = v * H, r = Rb + (Rt - Rb) * v + 0.06 * Math.sin(Math.PI * v);
    const bp = [new THREE.Vector2(r + 0.01, y - 0.13), new THREE.Vector2(r + 0.075, y - 0.11), new THREE.Vector2(r + 0.08, y + 0.11), new THREE.Vector2(r + 0.01, y + 0.13)];
    const band = new THREE.Mesh(new THREE.LatheGeometry(bp, 72), bandM); band.castShadow = true; body.add(band);
    // rivet heads on the band: instanced hemispheres
    const rv = new THREE.InstancedMesh(new THREE.SphereGeometry(0.028, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), material || new THREE.MeshStandardMaterial({ color: '#3a3430', roughness: 0.85, metalness: 0.25 }), 96), m = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (let i = 0; i < 48; i++) for (let k = 0; k < 2; k++) { const a = (i + k * 0.5) / 48 * Math.PI * 2, rr = r + 0.08, yy = y + (k ? 0.06 : -0.06);
      q.setFromUnitVectors(V3(0, 1, 0), V3(Math.sin(a), 0, Math.cos(a))); m.compose(V3(Math.sin(a) * rr, yy, Math.cos(a) * rr), q, V3(1, 1, 1)); rv.setMatrixAt(i * 2 + k, m); }
    body.add(rv); }
  // rim: refractory lining (pale brick) inside, and the lip built up with slag skull that drips outside
  const lin = linMat || new THREE.MeshStandardMaterial({ color: '#8a7a68', roughness: 0.95, metalness: 0 });
  const rimP = []; for (let i = 0; i <= 10; i++) { const u = i / 10, a = u * Math.PI; rimP.push(new THREE.Vector2(Rt - 0.16 + 0.1 * (1 - Math.cos(a)), H + 0.02 + 0.09 * Math.sin(a))); }
  const rim = new THREE.Mesh(new THREE.LatheGeometry(rimP, 72), lin); body.add(rim);
  const inner = new THREE.Mesh(new THREE.LatheGeometry(prof.map(p => new THREE.Vector2(Math.max(0, p.x - 0.2), p.y + 0.02)), 48), new THREE.MeshStandardMaterial({ color: '#3a2e26', roughness: 1, side: THREE.BackSide })); body.add(inner);
  // slag skull: a lumpy torus on the lip, darker, with drips down the outside near the spout
  const slag = slagMat || new THREE.MeshStandardMaterial({ color: '#241c18', roughness: 0.8, metalness: 0.2 });
  const tg = new THREE.TorusGeometry(Rt - 0.04, 0.085, 10, 120); const P = tg.attributes.position;
  for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i), a = Math.atan2(y, x), n = 1 + 0.35 * Math.sin(a * 7 + 1) * Math.sin(a * 13) + 0.2 * Math.sin(a * 31);
    const c = V3(Math.cos(a) * (Rt - 0.04), Math.sin(a) * (Rt - 0.04), 0), d = V3(x, y, z).sub(c).multiplyScalar(n); P.setXYZ(i, c.x + d.x, c.y + d.y, c.z + d.z); }
  tg.computeVertexNormals(); const skull = new THREE.Mesh(tg, slag); skull.rotation.x = Math.PI / 2; skull.position.y = H + 0.09; body.add(skull);
  // spout: a trough at +z on the lip
  const spG = new THREE.CylinderGeometry(0.26, 0.2, 0.62, 16, 1, true, Math.PI * 0.5, Math.PI); spG.rotateX(Math.PI / 2); spG.rotateY(Math.PI);
  const spout = new THREE.Mesh(spG, bandM); spout.position.set(0, H - 0.02, Rt + 0.22); spout.rotation.x = -0.25; body.add(spout);
  const spLin = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.6, 16, 1, true, Math.PI * 0.5, Math.PI).rotateX(Math.PI / 2).rotateY(Math.PI), lin); spLin.material.side = THREE.DoubleSide;
  spLin.position.copy(spout.position).add(V3(0, 0.03, 0)); spLin.rotation.x = -0.25; body.add(spLin); spLin.userData.trough = true;
  for (let i = 0; i < 9; i++) { const a = (R() - 0.5) * 0.9, L = 0.2 + R() * 0.7, rr = Rt + 0.05, d = new THREE.Mesh(new THREE.CapsuleGeometry(0.03 + R() * 0.03, L, 3, 8), slag);
    d.position.set(Math.sin(a) * rr, H - L / 2 + 0.05, Math.cos(a) * rr); d.rotation.z = (R() - 0.5) * 0.2; body.add(d); }
  // trunnions on cast collars (+-x)
  for (const s of [-1, 1]) { const r = Rb + (Rt - Rb) * 0.6 + 0.05;
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.9, 0.7), bandM); col.position.set(s * (r + 0.02), yT, 0); body.add(col);
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.36, 24).rotateZ(Math.PI / 2), bandM); tr.position.set(s * (r + 0.25), yT, 0); body.add(tr);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.06, 24).rotateZ(Math.PI / 2), bandM); cap.position.set(s * (r + 0.44), yT, 0); body.add(cap); }
  // molten surface disk (the caller swaps in a MoltenPool material)
  const surf = new THREE.Mesh(new THREE.CircleGeometry(Rt - 0.2, 64), new THREE.MeshBasicMaterial({ color: '#ffb040' }));
  surf.rotation.x = -Math.PI / 2; surf.position.y = H * fill; body.add(surf);
  const Rr = Rb + (Rt - Rb) * 0.6 + 0.05;
  const L = { group, body, surf, trough: spLin, H, yT, Rt, trunnionX: Rr + 0.44,
    tilt(a) { group.rotation.x = a; group.updateMatrixWorld(true); return L; },
    lipWorld(out = new THREE.Vector3()) { group.updateMatrixWorld(true); return out.set(0, H + 0.02, Rt + 0.5).applyMatrix4(body.matrixWorld); },
    // the spout's pour direction in world space (tangent the metal leaves along)
    lipDir(out = new THREE.Vector3()) { group.updateMatrixWorld(true); return out.set(0, -0.25, 1).normalize().transformDirection(body.matrixWorld); } };
  return L;
}

// the bail and the crane block/hook, hanging from the top of frame. Returns the group; attach at the trunnions.
export function buildBail(L, { material = null, height = 2.6 } = {}) {
  const m = material || new THREE.MeshStandardMaterial({ color: '#2e2a28', roughness: 0.6, metalness: 0.7 });
  const g = new THREE.Group(), x = L.trunnionX - 0.1, top = height;
  const arm = (s) => { const pts = [V3(s * x, 0, 0), V3(s * x, top * 0.6, 0), V3(s * x * 0.55, top * 0.95, 0), V3(0, top, 0)];
    const c = new THREE.CatmullRomCurve3(pts); const mesh = new THREE.Mesh(new THREE.TubeGeometry(c, 40, 0.1, 4, false), m); mesh.scale.z = 1.8; mesh.castShadow = true; return mesh; };
  g.add(arm(1), arm(-1));
  for (const s of [-1, 1]) { const eye = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.08, 8, 20).rotateY(Math.PI / 2), m); eye.position.set(s * x, 0, 0); g.add(eye); }
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 16).rotateX(Math.PI / 2), m); pin.position.y = top; g.add(pin);
  return g;
}
export function buildHook({ material = null, chain = 6 } = {}) {
  const m = material || new THREE.MeshStandardMaterial({ color: '#1e1b1a', roughness: 0.5, metalness: 0.8 });
  const g = new THREE.Group();
  // the hook: a thick C with a tapering tip, then a block with sheaves, then wire ropes up out of frame
  const hk = new THREE.CatmullRomCurve3([V3(0, 1.2, 0), V3(0, 0.5, 0), V3(0.05, 0.05, 0), V3(-0.25, -0.35, 0), V3(-0.6, -0.1, 0), V3(-0.55, 0.25, 0)]);
  const hg = new THREE.TubeGeometry(hk, 60, 0.13, 10, false); const hp = hg.attributes.position;
  for (let i = 0; i < hp.count; i++) { const k = Math.floor(i / 11) / 60, s = 1.15 - 0.75 * Math.pow(k, 1.6); const cx = hk.getPointAt(Math.min(1, k)); hp.setXYZ(i, cx.x + (hp.getX(i) - cx.x) * s, cx.y + (hp.getY(i) - cx.y) * s, cx.z + (hp.getZ(i) - cx.z) * s * 1.2); }
  hg.computeVertexNormals(); g.add(new THREE.Mesh(hg, m));
  const block = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.5), m); block.position.y = 1.8; g.add(block);
  for (const s of [-1, 1]) { const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 24).rotateX(Math.PI / 2), m); sh.position.set(s * 0.2, 1.95, 0.3); g.add(sh);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 30, 6), m); rope.position.set(s * 0.25, 1.95 + 15, 0); g.add(rope); }
  return g;
}
// ingot moulds: tapered cast-iron boxes on a bogie line, one open mouth each
export function buildMoulds({ n = 5, spacing = 1.5, material = null, seed = 7 } = {}) {
  const t = surfaceTextures({ seed, w: 512, h: 256, strakes: 1, heatTint: false, base: [34, 30, 29], rivets: false });
  const m = material || steelMaterial(t, { metal: 0.2, color: '#9a9490' });
  const g = new THREE.Group(), mouths = [];
  for (let i = 0; i < n; i++) {
    const mg = new THREE.CylinderGeometry(0.42, 0.55, 2.0, 4, 1, false); mg.rotateY(Math.PI / 4);
    const mo = new THREE.Mesh(mg, m); mo.position.set(i * spacing, 1.0, 0); mo.castShadow = mo.receiveShadow = true; g.add(mo);
    const lugs = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.16, 0.22), m); lugs.position.set(i * spacing, 1.55, 0); g.add(lugs);
    const mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.56).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#100808' })); mouth.position.set(i * spacing, 2.005, 0); g.add(mouth);
    mouths.push(mouth);
  }
  const bogie = new THREE.Mesh(new THREE.BoxGeometry(n * spacing + 0.6, 0.35, 1.3), m); bogie.position.set((n - 1) * spacing / 2, -0.1, 0); g.add(bogie);
  return { group: g, mouths };
}
// a mill-building roof: riveted Pratt trusses receding, crane runway girders. Instanced boxes (cheap).
export function buildTruss({ span = 22, bays = 9, bay = 5, height = 16, material = null } = {}) {
  const m = material || new THREE.MeshStandardMaterial({ color: '#2a2624', roughness: 0.8, metalness: 0.4 });
  const g = new THREE.Group(), beams = [];
  const beam = (a, b, s = 0.18) => beams.push([a, b, s]);
  for (let k = 0; k < bays; k++) { const z = -k * bay, h2 = 3.2;
    const L = V3(-span / 2, height, z), Rr = V3(span / 2, height, z), Tp = V3(0, height + h2, z);
    beam(L, Rr, 0.3); beam(L, Tp, 0.3); beam(Rr, Tp, 0.3);
    for (let i = 1; i < 8; i++) { const u = i / 8, x = -span / 2 + span * u, yTop = height + h2 * (1 - Math.abs(u - 0.5) * 2); beam(V3(x, height, z), V3(x, yTop, z), 0.1);
      const u2 = (i + (u < 0.5 ? 1 : -1)) / 8, x2 = -span / 2 + span * u2, y2 = height + h2 * (1 - Math.abs(u2 - 0.5) * 2); beam(V3(x, height, z), V3(x2, y2, z), 0.08); }
    beam(V3(-span / 2, 0, z), V3(-span / 2, height, z), 0.5); beam(V3(span / 2, 0, z), V3(span / 2, height, z), 0.5);
    if (k) { beam(V3(-span / 2, height - 2.5, z), V3(-span / 2, height - 2.5, z + bay), 0.7); beam(V3(span / 2, height - 2.5, z), V3(span / 2, height - 2.5, z + bay), 0.7); beam(Tp, V3(0, height + h2, z + bay), 0.15); } }
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), m, beams.length), M4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  beams.forEach(([a, b, s], i) => { const d = b.clone().sub(a), L = d.length(); q.setFromUnitVectors(V3(0, 1, 0), d.normalize()); M4.compose(a.clone().add(b).multiplyScalar(0.5), q, V3(s, L, s)); im.setMatrixAt(i, M4); });
  im.castShadow = true; g.add(im); return g;
}
