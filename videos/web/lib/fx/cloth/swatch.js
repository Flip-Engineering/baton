// SWATCH (CLOTHING c1): the fabric book. Every fabric of lib/fx/cloth/fabrics.js on the same three forms under the same light, so a
// fabric's identity can be judged apart from bodies, through the SAME shading path as hero cloth (fabric_glsl.js fabricMaterial with
// hero.js's cloth pieces; litPatch-compatible: the lab patches it into light/ like any other material).
//
//   const { target, dist, fov, lift, report } = await swatchBook(scene, { side, back, light });   // lab_cloth.js mode=swatch
//
// The forms, per fabric (a column; two tiers of eight, the back tier on a riser, ordered light to heavy):
//   drape    a Cusick drape (the textile drape test, BS 5058 / ISO 9073-9 geometry): a 30 cm specimen centred on an 18 cm disc. The
//            free annulus hangs by the fabric's own cantilever: Peirce's chord angle at an overhang l (c/l)^3 = cos(theta/2) / (8 tan
//            theta) from the bending length c (fabrics.js phys), the tip slope 4/3 of the chord angle, and the hem's spare length taken
//            up in N nodes (N from the disc's circumference over ~2.6 c + 2.2 cm, 4..9). Soft jersey falls straight in many small
//            nodes, duck and leather stand out in few. The drape coefficient (shadow area over the annulus) is reported.
//   panel    the cloth stretched flat on a board leaning back 20 degrees: colour, weave, sheen and the fibre lobe on a plane.
//   turned   a strip lying on the shelf whose front edge turns up and back over itself (a turned hem): the cloth's back face (the
//            weft side of a twill, the lining colour) on the turn, the edge's curvature, sheen across it.
// Every form carries aRest (the flat material coordinate) and aFold (signed mean curvature x the bending length), the attributes the
// drape writes on garments, so the book also exercises the CLOTH_REST / CLOTH_FOLD path. Folds are real geometry here (cFoldK 0).
import * as THREE from 'three';
import { FABRICS, phys } from './fabrics.js';
import { fabricMaterial, fabricPack } from './fabric_glsl.js';
import { HERO_CLOTH_GLSL } from '../hero.js';

// the book's order and the dye each is shown in (the trade's usual colour for it)
export const BOOK = [
  ['hivisYG', '#c8f028'], ['hivisOR', '#ff6a10'], ['jersey', '#2a2c30'], ['rib', '#6a2a1c'], ['chambray', '#1a3058'], ['flannel', '#6a1c1c', '#1a1414'], ['twillPC', '#2c3a52'], ['twillPC', '#d8641c'],
  ['cordura', '#3a4030'], ['denim', '#2a3a5a'], ['duck', '#5a4228'], ['melton', '#3a3a40'], ['gloveLeather', '#c8b070'], ['leather', '#5a3420'], ['bootLeather', '#2a1c12'], ['hivisMesh', '#c8f028'],
];
const COLS = 8, DX = 0.4, SHELF = [0.78, 0.1], DEPTH = [-0.8, 0.12], RD = 0.09, RS = 0.15;   // two tiers: the back one on a riser (no shelf over the front one: it shadowed it from the key)

// Peirce: the chord angle of a cantilever of overhang l under its own weight, from the bending length c
function peirceTheta(c, l) { const k = (c / l) ** 3; let lo = 1e-4, hi = Math.PI / 2 - 1e-4; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (Math.cos(m / 2) / (8 * Math.tan(m)) > k) lo = m; else hi = m; } return (lo + hi) / 2; }

// a grid geometry with position, uv (m), aRest, aWarp, aHero, aFold from callbacks over (i, j)
function gridGeom(ni, nj, P, Rest, UV, c, close = false) {
  const n = (ni + 1) * (nj + 1), pos = new Float32Array(n * 3), rest = new Float32Array(n * 3), uv = new Float32Array(n * 2), ah = new Float32Array(n * 4), id = (i, j) => i * (nj + 1) + j;
  for (let i = 0; i <= ni; i++) for (let j = 0; j <= nj; j++) { const k = id(i, j), p = P(i, j), r = Rest(i, j), u = UV(i, j); pos.set(p, k * 3); rest.set(r, k * 3); uv.set(u, k * 2); ah.set([2, 0, 1, 0], k * 4); }
  const idx = []; for (let i = 0; i < ni; i++) for (let j = 0; j < nj; j++) { const a = id(i, j), b = id(i + 1, j), d = id(i, j + 1), e = id(i + 1, j + 1); idx.push(a, b, d, d, b, e); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aRest', new THREE.BufferAttribute(rest, 3)); g.setAttribute('aHero', new THREE.BufferAttribute(ah, 4)); g.setIndex(idx); g.computeVertexNormals();
  // the warp's direction in the form's space: d position / d (rest coordinate along the warp, uv.y), by finite differences on the grid
  const N = g.attributes.normal.array, warp = new Float32Array(n * 3), fold = new Float32Array(n);
  const at = (i, j) => [Math.min(ni, Math.max(0, i)), close ? ((j % nj) + nj) % nj : Math.min(nj, Math.max(0, j))];
  for (let i = 0; i <= ni; i++) for (let j = 0; j <= nj; j++) { const k = id(i, j);
    let best = null; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const [i2, j2] = at(i + di, j + dj), k2 = id(i2, j2), dv = uv[k2 * 2 + 1] - uv[k * 2 + 1], du = uv[k2 * 2] - uv[k * 2];
      if (Math.abs(dv) > 1e-6 && (!best || Math.abs(dv) / (Math.abs(du) + 1e-6) > best[0])) best = [Math.abs(dv) / (Math.abs(du) + 1e-6), k2, dv]; }
    if (best) { const [, k2, dv] = best, w = [0, 1, 2].map(cc => (pos[k2 * 3 + cc] - pos[k * 3 + cc]) / dv), l = Math.hypot(...w) || 1; warp.set(w.map(x => x / l), k * 3); } else warp.set([0, 1, 0], k * 3);
    // mean curvature from the umbrella operator (h ~ the grid spacing), signed so a crest is > 0, times the bending length
    let sx = 0, sy = 0, sz = 0, cnt = 0, h2 = 0; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const [i2, j2] = at(i + di, j + dj), k2 = id(i2, j2); if (k2 === k) continue;
      const dx = pos[k2 * 3] - pos[k * 3], dy = pos[k2 * 3 + 1] - pos[k * 3 + 1], dz = pos[k2 * 3 + 2] - pos[k * 3 + 2]; sx += dx; sy += dy; sz += dz; h2 += dx * dx + dy * dy + dz * dz; cnt++; }
    if (cnt) { const Hm = -2 * (sx * N[k * 3] + sy * N[k * 3 + 1] + sz * N[k * 3 + 2]) / Math.max(1e-8, h2); fold[k] = Math.max(-1, Math.min(1, Hm * c)); } }
  g.setAttribute('aWarp', new THREE.BufferAttribute(warp, 3)); g.setAttribute('aFold', new THREE.BufferAttribute(fold, 1));
  return g;
}

// the Cusick drape of one fabric: returns { geom, nodes, dc }
function cusick(name, seed) {
  const P = phys(name), c = P.c, l = RS - RD, th = peirceTheta(c, l), aTip = Math.min(Math.PI / 2, th * 4 / 3);
  const N = Math.max(4, Math.min(9, Math.round(2 * Math.PI * RD / (2.6 * c + 0.022))));
  const NR = 26, NA = 144, prof = [];                                  // the mean profile along the free length: [R, Y, alpha]
  { let R = RD, Y = 0; const ns = 60; prof.push([R, Y, 0]); for (let k = 1; k <= ns; k++) { const s = k / ns * l, a = aTip * (1 - (1 - s / l) ** 3), ds = l / ns; R += Math.cos(a) * ds; Y -= Math.sin(a) * ds; prof.push([R, Y, a]); } }
  const pf = s => { const f = Math.min(prof.length - 1, Math.max(0, s / l * (prof.length - 1))), i = Math.floor(f), u = f - i, A = prof[i], B = prof[Math.min(prof.length - 1, i + 1)]; return A.map((x, k) => x + (B[k] - x) * u); };
  const ph = seed * 1.7, rr = i => i / NR * RS;
  const Pf = (i, j) => { const r = rr(i), phi = j / NA * Math.PI * 2;
    if (r <= RD) return [r * Math.cos(phi), 0.002, r * Math.sin(phi)];
    const s = r - RD, [R, Y, a] = pf(s), amp = Math.sqrt(Math.max(0, 2 * (r * r - R * R))) / N, w = amp * Math.cos(N * phi + ph) * Math.min(1, s / 0.02);
    const nr = Math.sin(a), ny = Math.cos(a);                           // the profile's outward normal in the (radial, up) plane
    const RR = R + w * nr, YY = Y + 0.002 + w * ny; return [RR * Math.cos(phi), YY, RR * Math.sin(phi)]; };
  const geom = gridGeom(NR, NA, Pf, (i, j) => { const r = rr(i), phi = j / NA * Math.PI * 2; return [r * Math.cos(phi), 0, r * Math.sin(phi)]; }, (i, j) => { const r = rr(i), phi = j / NA * Math.PI * 2; return [r * Math.cos(phi), r * Math.sin(phi)]; }, c, true);
  // drape coefficient: the shadow (projected) area beyond the disc over the annulus
  let A = 0; for (let j = 0; j < NA; j++) { const p = Pf(NR, j), q = Pf(NR, j + 1); A += 0.5 * Math.abs(p[0] * q[2] - p[2] * q[0]); }
  const dc = (A - Math.PI * RD * RD) / (Math.PI * (RS * RS - RD * RD));
  return { geom, nodes: N, dc, theta: th };
}
function panel(c) { const W = 0.26, H = 0.2, tilt = 0.35;
  return gridGeom(26, 20, (i, j) => { const x = (i / 26 - 0.5) * W, v = j / 20 * H; return [x, 0.012 + v * Math.cos(tilt), -v * Math.sin(tilt)]; }, (i, j) => [(i / 26 - 0.5) * W, j / 20 * H, 0], (i, j) => [(i / 26 - 0.5) * W, j / 20 * H], c); }
function turned(c, mm) { const W = 0.26, L0 = 0.06, r = 0.011 + mm, Lc = Math.PI * r, L1 = 0.035, Lt = L0 + Lc + L1, nj = 40;
  const at = v => { if (v <= L0) return [0.002, -0.03 + v]; if (v <= L0 + Lc) { const a = (v - L0) / r; return [0.002 + r - r * Math.cos(a), -0.03 + L0 + r * Math.sin(a)]; } return [0.002 + 2 * r, -0.03 + L0 - (v - L0 - Lc)]; };
  return gridGeom(26, nj, (i, j) => { const v = j / nj * Lt, [y, z] = at(v); return [(i / 26 - 0.5) * W, y, z]; }, (i, j) => [(i / 26 - 0.5) * W, j / nj * Lt, 0], (i, j) => [(i / 26 - 0.5) * W, j / nj * Lt], c); }

export async function swatchBook(scene, { side = new THREE.Vector3(1, 0, 0), back = new THREE.Vector3(0, 0, 1), light = 'hard', book = BOOK } = {}) {
  const root = new THREE.Group(); root.rotation.y = Math.atan2(back.x, back.z); scene.add(root);
  const steel = new THREE.MeshStandardMaterial({ color: '#4a4a48', roughness: 0.45, metalness: 0.6 }), wood = new THREE.MeshStandardMaterial({ color: '#3a3128', roughness: 0.8 }), board = new THREE.MeshStandardMaterial({ color: '#1e1e1c', roughness: 0.7 });
  const add = (geo, mat, x, y, z, sh = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = sh; m.receiveShadow = true; root.add(m); return m; };
  const rows = Math.ceil(book.length / COLS), report = [];
  for (let r = 0; r < rows; r++) add(new THREE.BoxGeometry(COLS * DX + 0.1, SHELF[r], 0.5), wood, 0, SHELF[r] / 2, DEPTH[r] + 0.05);
  book.forEach(([name, col, col2], k) => {
    if (!FABRICS[name]) return;
    const row = Math.floor(k / COLS), cIx = k % COLS, x = (cIx - (COLS - 1) / 2) * DX, y0 = SHELF[row], z0 = DEPTH[row], P = phys(name), seed = k + 1;
    const U = { cA: { value: new THREE.Color(col) }, cB: { value: new THREE.Color(col2 || col) }, cKind: { value: 0 }, cDirt: { value: 0 }, cSeed: { value: seed * 1.7 }, cWet: { value: 0 }, cPart: { value: 0 },
      cHem: { value: new THREE.Vector4(9, 9, 9, 100) }, cHem2: { value: new THREE.Vector4(100, -100, 0, 0) }, cWear: { value: 0 }, cSweat: { value: 0 }, cFoldK: { value: 0 }, cRetro: { value: 0 },
      cFlex: { value: new THREE.Vector4() }, cFlex2: { value: new THREE.Vector4() }, cVest: { value: new THREE.Vector4(0, 1.3, 1.5, -100) }, cC7: { value: 1 }, cAsp: { value: 0.9 }, cBootP: { value: new THREE.Vector4() }, cBootP2: { value: new THREE.Vector4() },
      fLimbO: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) }, fLimbD: { value: [0, 1, 2, 3].map(() => new THREE.Vector3(0, -1, 0)) }, fLimbE: { value: [0, 1, 2, 3].map(() => new THREE.Vector3(1, 0, 0)) },
      fRad: { value: new THREE.Vector4(0.05, 0.08, 0.15, 0) }, fLen: { value: new THREE.Vector2(0.3, 0.45) }, cOpen: { value: 1 } };
    const mat = () => fabricMaterial({ fabric: name, color: col, color2: col2 || null, uniforms: U, glsl: HERO_CLOTH_GLSL, key: 'swatch-fabric', defines: { FAB_UVQ: 1, FAB_WARP: 1, CLOTH_REST: 1, CLOTH_FOLD: 1 } });
    // the drape on its pedestal (disc top 0.40 over the shelf), the panel and the turned edge in front
    const cu = cusick(name, seed), top = y0 + 0.4;
    add(cu.geom, mat(), x, top, z0 - 0.06); add(new THREE.CylinderGeometry(RD - 0.001, RD - 0.001, 0.008, 48), steel, x, top - 0.004, z0 - 0.06); add(new THREE.CylinderGeometry(0.008, 0.008, 0.4, 12), steel, x, y0 + 0.2, z0 - 0.06);
    add(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 24), steel, x, y0 + 0.005, z0 - 0.06);
    const pb = add(new THREE.BoxGeometry(0.27, 0.21, 0.01), board, x, y0 + 0.012 + 0.1 * Math.cos(0.35), z0 + 0.13 - 0.1 * Math.sin(0.35) - 0.006); pb.rotation.x = -0.35;
    add(panel(P.c), mat(), x, y0, z0 + 0.13); add(turned(P.c, P.h), mat(), x, y0, z0 + 0.22);
    const n = fabricPack(name, col).numbers;
    report.push({ k, name, colour: col, label: FABRICS[name].label, c_cm: n.c_cm, nodes: cu.nodes, drapeCoef: +cu.dc.toFixed(2), peirceDeg: +(cu.theta * 180 / Math.PI).toFixed(1), lambda_cm: n.lambda_cm, rough: n.rough, sheen: n.sheen, lobe: n.lobe, nap: n.nap, fluorY: n.fluorY, x: +x.toFixed(2), row });
  });
  root.updateMatrixWorld(true);
  const t = new THREE.Vector3(0, 0.66, 0).add(back.clone().multiplyScalar(-0.3));
  return { target: [t.x, t.y, t.z], dist: 4.5, fov: 24, lift: 0.5, report: { light, order: report.map(r => r.name), fabrics: report } };
}
