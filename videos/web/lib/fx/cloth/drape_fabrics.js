// DRAPE FABRICS (CLOTHINT, round 7, 8 Oct 2026): the studio's fabrics for a DRAPE (a sheet, a shroud, a banner): linen, cotton, canvas, wool, as
// the same two blocks fabrics.js keeps for every fabric (the physical record the solver reads through phys(), and the look the fabric shader
// reads) plus the glue that shades a grid cloth (main's Cloth, our Drape) through the studio's own fabricMaterial, the path the garments and the
// fabric book use. Opt-in: nothing is added to fabrics.js until registerDrapeFabrics() is called (drapeMaterial does it); a name already in
// fabrics.js is never overwritten, so every existing garment, figure and scene keeps its numbers. FABRIC7 owns the shading files (fabric_glsl.js,
// fabric6.js, fabric7/): this file only imports them.
//
//   import { Drape } from './drape_sheet.js'; import { drapeMaterial, attachFabric } from './drape_fabrics.js'; import { HERO_CLOTH_GLSL } from '../hero.js';
//   const cl = new Drape({ fabric: 'linen', ... });                     // the solver's physics from the same record
//   const mat = drapeMaterial({ fabric: 'linen', color: '#cfc6b2', glsl: HERO_CLOTH_GLSL, uniforms });
//   attachFabric(cl);                                                   // aRest / aWarp / aFold / metric uv on cl.geometry, refreshed by cl.sync()
//   scene.add(new THREE.Mesh(cl.geometry, mat));
// attachFabric also works on a main Cloth (it only needs nx, nz, w, l, p and geometry), so the A/B of the two solvers is shaded identically.
//
// The numbers (typical ranges for the construction, not a measurement of a particular bolt; the Peirce bending length c = (B / (rho g))^(1/3)
// is what sets the scale of a fold, a fold's wavelength sits near 2.8 c; each is checked against a cantilever in labs/clothing2/drape_test.mjs):
//   linen     a mid-weight flax sheet or tablecloth, 185 g/m2, 0.5 mm, KES B 0.30 gf.cm2/cm (flax is stiff and slubby): c 2.5 cm. LOOK (iteration 2): contrast 0.1, slub 0.14; iteration 1's 0.22 / 0.6 made
//             the warp streaks +-75 % in brightness (fabric_glsl.js: cA x (1 + 1.6 contrast yv + 1.4 slub st)): the plates read as wood grain, not cloth
//   cotton    percale bed sheet, 125 g/m2, 0.26 mm, B 0.07: c 1.8 cm (it falls in many small folds)
//   canvas    washed cotton canvas (a drop cloth, a tarpaulin), 340 g/m2, 0.8 mm, B 1.4: c 3.5 cm (few big folds)
//   wool      a woollen blanket, napped, 330 g/m2, 2 mm, B 0.4: c 2.3 cm (heavy, soft, hangs in rounded folds)
// yieldStrain (iteration 2, drape_sheet.js `crease`): the yarn's elastic limit, the strain past which a bend stays (typical: flax is brittle, 1 %; cotton 1.6 %; wool recovers, 4 %). A plate of thickness h bent to curvature k strains
//   its outer fibre by k h / 2, so the fabric's yield curvature is 2 yieldStrain / h: linen 40 /m (a crease 2.5 cm wide), cotton 123 /m (0.8 cm: narrower than a cell of any sheet we can afford, so cotton cannot hold a crease on these grids), wool 40 /m.
import * as THREE from 'three';
import { FABRICS, LOOKS, phys } from './fabrics.js';
import { fabricMaterial } from './fabric_glsl.js';
export const DRAPE_FABRICS_VERSION = 1;

export const DRAPE_PHYS = {
  linen:  { label: 'linen sheet / tablecloth, plain weave',   construction: 'plain', gsm: 185, mm: 0.5,  bend: 0.30, stretch: [9000, 8000],   shear: 220, mu: 0.5, yieldStrain: 0.010 },
  cotton: { label: 'cotton percale sheet',                    construction: 'plain', gsm: 125, mm: 0.26, bend: 0.07, stretch: [7000, 5500],   shear: 250, mu: 0.45, yieldStrain: 0.016 },
  canvas: { label: 'washed cotton canvas (drop cloth)',       construction: 'duck',  gsm: 340, mm: 0.8,  bend: 1.4,  stretch: [17000, 12000], shear: 900, mu: 0.5, yieldStrain: 0.016 },
  wool:   { label: 'wool blanket, napped',                    construction: 'felt',  gsm: 330, mm: 2.0,  bend: 0.4,  stretch: [4000, 3500],   shear: 300, mu: 0.65, yieldStrain: 0.040 },
};
const L = o => o;
export const DRAPE_LOOKS = {
  linen: L({ weave: { kind: 'plain', epc: 24, ppc: 22, weftShow: 0.4, contrast: 0.1, slub: 0.14 }, rough: [0.74, 0.06], sheen: [0.2, 0.62, 0.3], nap: 0.5,
    aniso: [0.45, 16, 0], dye: [0.95, 1], wear: { fibre: 'duck', abr: 0.5, soil: 0.5, fray: 0.3, fade: 0.3 }, inside: [0.55, 0.3], seam: { thread: null, k: 0.5 }, spec: 0.45 }),
  cotton: L({ weave: { kind: 'plain', epc: 40, ppc: 34, weftShow: 0.45, contrast: 0.05, slub: 0.05 }, rough: [0.7, 0.04], sheen: [0.32, 0.5, 0.3], nap: 0.35,
    aniso: [0.3, 22, 0], dye: [1, 1], wear: { fibre: 'pc', abr: 0.2, soil: 0.5, fade: 0.2 }, inside: [0.6, 0.3], seam: { thread: null, k: 0.5 }, spec: 0.5 }),
  canvas: L({ weave: { kind: 'duck', epc: 18, ppc: 12, weftShow: 0.4, contrast: 0.1, slub: 0.1 }, rough: [0.86, 0.05], sheen: [0.2, 0.72, 0.2], nap: 0.6,
    aniso: [0.12, 10, 0], dye: [0.95, 1], wear: { fibre: 'duck', abr: 0.8, soil: 0.7, fray: 0.8, fade: 0.4 }, inside: [0.45, 0.3], seam: { thread: '#a8875a', k: 0.85 }, spec: 0.4 }),
  wool: L({ weave: { kind: 'felt', epc: 10, ppc: 10, weftShow: 0, contrast: 0.12, slub: 0 }, rough: [0.92, 0.03], sheen: [0.55, 0.55, 0.25], nap: 1.6,
    aniso: [0, 1, 0], dye: [1, 1], wear: { fibre: 'knit', abr: 0.3, soil: 0.4, pill: 0.7, fade: 0.2 }, inside: [0.2, 0.3], seam: { thread: null, k: 0.4 }, spec: 0.35 }),
};
// the registered names (fabrics.js's tables are keyed by name, and the shader looks a fabric up by it)
export const DRAPE_NAMES = { linen: 'sheetLinen', cotton: 'sheetCotton', canvas: 'sheetCanvas', wool: 'sheetWool' };
let _done = false;
export function registerDrapeFabrics() {
  if (_done) return Object.values(DRAPE_NAMES);
  for (const [k, f] of Object.entries(DRAPE_PHYS)) { const n = DRAPE_NAMES[k]; if (FABRICS[n]) continue; FABRICS[n] = { ...f }; LOOKS[n] = DRAPE_LOOKS[k]; FABRICS[n].look = DRAPE_LOOKS[k]; }
  _done = true; return Object.values(DRAPE_NAMES);
}
// a fabric given as a short drape name ('linen'), a fabrics.js name ('chambray', 'duck', ...), or a record: the record phys() reads
export function fabricRecord(f) {
  if (f && typeof f === 'object') return f;
  if (DRAPE_PHYS[f]) return DRAPE_PHYS[f];
  if (FABRICS[f]) return FABRICS[f];
  throw new Error(`drape fabric: unknown '${f}' (linen | cotton | canvas | wool, or a fabrics.js name)`);
}
export const drapeName = f => (typeof f === 'string' && DRAPE_NAMES[f]) || f;   // the name fabricMaterial looks up (after registerDrapeFabrics)
// the fabric's numbers for the notes: Peirce c (cm), the fold wavelength 2.8 c (cm)
export function drapeTable() { return Object.keys(DRAPE_PHYS).map(k => { const P = phys(DRAPE_PHYS[k]); return { fabric: k, gsm: DRAPE_PHYS[k].gsm, mm: DRAPE_PHYS[k].mm, bend: DRAPE_PHYS[k].bend, c_cm: +(P.c * 100).toFixed(2), lambda_cm: +(P.c * 280).toFixed(1) }; }); }

// ---------------------------------------------------------------- the material (the swatch book's recipe: fabricMaterial with hero.js's cloth pieces)
// the uniforms hero.js's cloth head reads (a flat sheet leaves most at their neutral values); glsl = HERO_CLOTH_GLSL (the caller imports hero.js)
export function drapeUniforms(color, color2 = null, seed = 1) {
  const V4 = (...a) => new THREE.Vector4(...a), V3 = () => new THREE.Vector3(), V3d = (x, y, z) => new THREE.Vector3(x, y, z);
  return { cA: { value: new THREE.Color(color) }, cB: { value: new THREE.Color(color2 || color) }, cKind: { value: 0 }, cDirt: { value: 0 }, cSeed: { value: seed * 1.7 }, cWet: { value: 0 }, cPart: { value: 0 },
    cHem: { value: V4(9, 9, 9, 100) }, cHem2: { value: V4(100, -100, 0, 0) }, cWear: { value: 0 }, cSweat: { value: 0 }, cFoldK: { value: 0 }, cRetro: { value: 0 },
    cFlex: { value: V4(0, 0, 0, 0) }, cFlex2: { value: V4(0, 0, 0, 0) }, cVest: { value: V4(0, 1.3, 1.5, -100) }, cC7: { value: 1 }, cAsp: { value: 0.9 }, cBootP: { value: V4(0, 0, 0, 0) }, cBootP2: { value: V4(0, 0, 0, 0) },
    fLimbO: { value: [0, 1, 2, 3].map(V3) }, fLimbD: { value: [0, 1, 2, 3].map(() => V3d(0, -1, 0)) }, fLimbE: { value: [0, 1, 2, 3].map(() => V3d(1, 0, 0)) },
    fRad: { value: V4(0.05, 0.08, 0.15, 0) }, fLen: { value: new THREE.Vector2(0.3, 0.45) }, cOpen: { value: 1 } };
}
export function drapeMaterial({ fabric = 'linen', color = '#cfc6b2', color2 = null, glsl, uniforms = null, seed = 1, key = 'drape-fabric', defines = null } = {}) {
  if (!glsl) throw new Error("drapeMaterial: pass glsl = HERO_CLOTH_GLSL (import { HERO_CLOTH_GLSL } from '../hero.js')");
  registerDrapeFabrics();
  return fabricMaterial({ fabric: drapeName(fabric), color, color2, uniforms: uniforms || drapeUniforms(color, color2, seed), glsl, key,
    defines: { FAB_UVQ: 1, FAB_WARP: 1, CLOTH_REST: 1, CLOTH_FOLD: 1, ...(defines || {}) } });
}

// ---------------------------------------------------------------- the attributes the fabric shader reads, on a grid cloth's geometry
// aRest   the flat pattern coordinate (m): weave, slubs and wear stay on the cloth however it folds (CLOTH_REST)
// uv      the same coordinate as the metric material coordinate (weft along x, warp along z; FAB_UVQ); the [0,1] uv moves to aUV01
// aHero   hero.js's per-vertex tag, neutral for a flat cloth        aWarp   the warp's direction in the cloth's space (along the grid's z), per frame
// aFold   signed mean curvature x the bending length (crest > 0, valley < 0), per frame: the real folds drive the fabric's wear and fold shading
// fabric: the name or record whose c scales aFold. Call once after the geometry exists; the refresh runs on every sync() (Drape and Cloth).
export function attachFabric(cl, { fabric = 'linen', foldGain = 1 } = {}) {
  const g = cl.geometry, { nx, nz, w, l } = cl, N = (nx + 1) * (nz + 1), c = phys(fabricRecord(fabric)).c, id = (i, j) => j * (nx + 1) + i;
  const rest = new Float32Array(N * 3), uv = new Float32Array(N * 2), ah = new Float32Array(N * 4), warp = new Float32Array(N * 3), fold = new Float32Array(N);
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const k = id(i, j), x = (i / nx - 0.5) * w, z = (j / nz - 0.5) * l; rest.set([x, 0, z], k * 3); uv.set([x, z], k * 2); ah.set([2, 0, 1, 0], k * 4); }
  if (g.attributes.uv && !g.attributes.aUV01) g.setAttribute('aUV01', new THREE.BufferAttribute(g.attributes.uv.array.slice(), 2));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('aRest', new THREE.BufferAttribute(rest, 3)); g.setAttribute('aHero', new THREE.BufferAttribute(ah, 4));
  g.setAttribute('aWarp', new THREE.BufferAttribute(warp, 3)); g.setAttribute('aFold', new THREE.BufferAttribute(fold, 1));
  const refresh = () => {
    const P = g.attributes.position.array, Nn = g.attributes.normal ? g.attributes.normal.array : null;
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const k = id(i, j), j0 = Math.max(0, j - 1), j1 = Math.min(nz, j + 1), a = id(i, j0) * 3, b = id(i, j1) * 3;
      let wx = P[b] - P[a], wy = P[b + 1] - P[a + 1], wz = P[b + 2] - P[a + 2]; const wl = Math.hypot(wx, wy, wz) || 1; warp[k * 3] = wx / wl; warp[k * 3 + 1] = wy / wl; warp[k * 3 + 2] = wz / wl;
      if (!Nn) continue;   // mean curvature from the umbrella operator, signed so a crest (the normal side is convex) is > 0
      let sx = 0, sy = 0, sz = 0, h2 = 0, cnt = 0; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const i2 = i + di, j2 = j + dj; if (i2 < 0 || i2 > nx || j2 < 0 || j2 > nz) continue; const m = id(i2, j2) * 3,
        dx = P[m] - P[k * 3], dy = P[m + 1] - P[k * 3 + 1], dz = P[m + 2] - P[k * 3 + 2]; sx += dx; sy += dy; sz += dz; h2 += dx * dx + dy * dy + dz * dz; cnt++; }
      fold[k] = cnt ? Math.max(-1, Math.min(1, -2 * (sx * Nn[k * 3] + sy * Nn[k * 3 + 1] + sz * Nn[k * 3 + 2]) / Math.max(1e-8, h2) * c * foldGain)) : 0; }
    g.attributes.aWarp.needsUpdate = true; g.attributes.aFold.needsUpdate = true; };
  (cl._onSync ||= []).push(refresh);
  // main's Cloth.sync() does not know the hook list: wrap it once (its own result is unchanged)
  if (!cl.__hooksNative && !cl.__fabWrapped) { const s = cl.sync.bind(cl); cl.sync = function () { s(); for (const f of cl._onSync || []) f(); return cl; }; cl.__fabWrapped = true; }
  cl.fabricName = drapeName(fabric); cl.sync(); return cl;
}
