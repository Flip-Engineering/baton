// PERSON / CORE (8 Oct): the library the ONE current person is built from (lib/fx/person/build.js makePerson). One current version only:
// the pieces of the old integration chain the current person really uses were moved here (git history keeps the chain); nothing here
// builds an older person. What is here:
//   the twelve (V2_PLAN: their underwear and clothes as cast; V2_HAIR: their hair, as HAIR3 chose it), their records (assets/person/
//   v2_people.json and, for the figure study, BODY7's people7.json: loadPeople2 / peopleAt / personOf), the Hero's options (heroOpts2), the
//   stance (lane F's idleStance standV2; POSE's seeded stance stanceOf2 / stanceV3), the BAKE (a PV2 container: unpackPerson2 / loadBake2:
//   the body the garments were solved on + K3's underwear + the sewn garments + the skin cull), the parts as skinned meshes (partMesh2, with
//   CLOTH8's posed normals), the skin cull (cullBody2), the parts riding P1's detail (rideDetail) and lifted off the posed body
//   (liftOverPosed), the scalp hair pushed out of the posed body and clothes (settleHairPosed), the cloth's posed spikes pulled back
//   (despikeParts), posing a built person (poserOf / afterPose: lane F's IK + CORRECT5) and the page's skin pass (ensureSkinSSS).
// (The exported names keep their old spellings so the lanes' tools only change the path they import from.)
import * as THREE from 'three';
import { HERO_CLOTH_GLSL } from '../hero.js';
import { idleStance } from '../workforce.js';

// the bake container's format fields (the PV2 header the garment bake chain writes: cloth/dress3.js, cloth/wardrobe4/bake4.js)
export const V2_VERSION = 1, V3_VERSION = 1;
const now = () => (globalThis.performance ? performance.now() : Date.now());
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const mulberry = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

// ---------------------------------------------------------------- who and what they wear (the integrator's casting of clothes)
// Twelve of CAST's 24, six women and six men, every background, ages 23-59 (the row); the ladder pair is the first woman and man.
// Underwear: plain and modest (K3's kinds); a bra kind per woman (soft, moulded underwire, sports), men in briefs or boxer briefs.
// Clothes: everyday work and street clothes as K2 can sew them today: a work / casual shirt (Simone for women, Simon for men) in
// chambray, flannel or denim, tucked, over work trousers or slacks (Titan) in twill, denim or duck. Colours ordinary, varied.
export const V2_PLAN = {
  L08_f24_hispanic: { bra: 'soft', base: [['bra', 'bra.soft'], ['briefs', 'briefs']], under: '#e6e0d4', shirt: ['denim', '#5a7394'], trousers: ['twillPC', '#2f3540'], weight: 0.6, look: 'pleasant' },
  L21_m32_black: { base: [['briefs', 'boxers.m']], under: '#3a3d44', shirt: ['flannel', '#6e2a26'], trousers: ['denim', '#2b3a58'], weight: -0.6, look: 'pleasant' },
  L22_f27_black: { bra: 'structured', base: [['bra', 'bra.structured'], ['briefs', 'briefs']], under: '#ebe7de', shirt: ['chambray', '#8b9bb1'], trousers: ['denim', '#25324c'], weight: -0.6, look: 'pleasant' },
  L11_m23_white: { base: [['briefs', 'briefs.m']], under: '#ebe7de', shirt: ['chambray', '#6f86a6'], trousers: ['twillPC', '#6e6450'], weight: 0.6, look: 'common' },
  L20_f29_asian: { bra: 'sports', base: [['bra', 'bra.sports'], ['briefs', 'briefs']], under: '#8c8e91', shirt: ['flannel', '#3c4a5e'], trousers: ['duck', '#6b5a3e'], weight: 0.65, look: 'pleasant' },
  L17_m28_hispanic: { base: [['briefs', 'boxers.m']], under: '#8c8e91', shirt: ['denim', '#3e5478'], trousers: ['duck', '#5e4e36'], weight: 0.6, look: 'pleasant' },
  L12_f39_white: { bra: 'structured', base: [['bra', 'bra.structured'], ['briefs', 'briefs']], under: '#d9cbbb', shirt: ['flannel', '#6a2024'], trousers: ['twillPC', '#2f3a50'], weight: -0.6, look: 'common' },
  L03_m38_asian: { base: [['briefs', 'boxers.m']], under: '#2c3446', shirt: ['chambray', '#7d8a98'], trousers: ['twillPC', '#3b4537'], weight: -0.6, look: 'common' },
  L14_f42_black: { bra: 'soft', base: [['bra', 'bra.soft'], ['briefs', 'briefs']], under: '#2a292d', shirt: ['chambray', '#6f86a6'], trousers: ['duck', '#4a4436'], weight: 0.6, look: 'common' },
  L23_m45_white: { base: [['briefs', 'boxers.m']], under: '#9a9a96', shirt: ['flannel', '#2f4a3a'], trousers: ['denim', '#283450'], weight: 0.65, look: 'common' },
  L06_f53_white: { bra: 'soft', base: [['bra', 'bra.soft'], ['briefs', 'briefs']], under: '#ebe7de', shirt: ['denim', '#46607e'], trousers: ['twillPC', '#4a4436'], weight: -0.6, look: 'common' },
  L05_m59_black: { base: [['briefs', 'briefs.m']], under: '#ebe7de', shirt: ['chambray', '#5d7192'], trousers: ['twillPC', '#3a3a40'], weight: -0.6, look: 'common' },
};
// HAIR3 (round 3, 3 Oct): each person's hair, chosen for them (lane D's v3 styles, assets/hair/styles/w3_*.json, read from the front;
// the men keep lane D's styles with the v3 card look). Over hairFor's seeded pick; makePerson2's opts.hairPlan false = v2's hair.
export const V2_HAIR = {
  // women: styles that read from the front, each by the person's own texture (provisional; see review/.../hair3/NOTES.md)
  L08_f24_hispanic: { style: 'w3_curly', form: 'curly', melanin: { eu: 1.8, ph: 0.04 }, grey: 0 },
  L22_f27_black: { style: 'w3_coily', form: 'coily', melanin: { eu: 3.2, ph: 0.02 }, grey: 0 },
  L20_f29_asian: { style: 'w3_bun', form: 'straight', melanin: { eu: 3.0, ph: 0.02 }, grey: 0 },
  L12_f39_white: { style: 'w3_shoulder', form: 'straight', melanin: { eu: 0.12, ph: 0.06 }, grey: 0.04 },
  L14_f42_black: { style: 'w3_braids', form: 'coily', melanin: { eu: 3.2, ph: 0.02 }, grey: 0.03 },
  L06_f53_white: { style: 'w3_bob', form: 'straight', melanin: { eu: 0.45, ph: 0.05 }, grey: 0.3 },
  // men: lane D's styles as the row had them (seeded picks made explicit), drawn with the v3 card look
  L21_m32_black: { style: 'm_buzz', form: 'coily', beard: 'none', melanin: { eu: 3.2, ph: 0.02 }, grey: 0, look3: true },
  L11_m23_white: { style: 'm3_sidepart', form: 'wavy', beard: 'none', melanin: { eu: 1.1, ph: 0.04 }, grey: 0 },   // (lane D's m_wavy_mid dropped strands across his face)
  L17_m28_hispanic: { style: 'm_sidepart', form: 'wavy', beard: 'stubble', melanin: { eu: 2.2, ph: 0.04 }, grey: 0, look3: true },
  L03_m38_asian: { style: 'm_crop', form: 'straight', beard: 'stubble', melanin: { eu: 3.0, ph: 0.02 }, grey: 0, look3: true },
  L23_m45_white: { style: 'm3_sidepart', form: 'straight', beard: 'none', melanin: { eu: 0.35, ph: 0.06 }, grey: 0.16, look3: true },
  L05_m59_black: { style: 'm_crop', form: 'coily', beard: 'moustache', melanin: { eu: 3.2, ph: 0.02 }, grey: 0.34, look3: true },
};
export const V2_PEOPLE = Object.keys(V2_PLAN);
export const V2_LADDER = { woman: 'L08_f24_hispanic', man: 'L21_m32_black' };
export const V2_FACES = ['L08_f24_hispanic', 'L22_f27_black', 'L20_f29_asian', 'L21_m32_black', 'L03_m38_asian', 'L23_m45_white'];

// ---------------------------------------------------------------- records (assets/person/v2_people.json)
let _people = null;
const ASSETS = new URL('../../../assets/person/', import.meta.url).href;
export async function loadPeople2({ url = ASSETS + 'v2_people.json', force = false } = {}) {
  if (_people && !force) return _people; const J = await fetch(url).then(r => r.json()); _people = { ...J, find: n => J.people.find(e => e.name === n || e.name === String(n).split('_')[0] + '_' + String(n).split('_').slice(1).join('_')) }; return _people;
}
// (integration v7, 8 Oct) records by URL, beside the page-wide default above: makePerson's `people` option (v7: BODY7's people7.json for the
// figure study) reads its own file without replacing the default, so a v6 person built after a v7 one keeps v2_people.json
const _peopleAt = new Map();
export async function peopleAt(url) {
  if (!url) return loadPeople2();
  if (!_peopleAt.has(url)) _peopleAt.set(url, fetch(url).then(r => r.json()).then(J => ({ ...J, find: n => J.people.find(e => e.name === n || e.name === String(n).split('_')[0] + '_' + String(n).split('_').slice(1).join('_')) })));
  return _peopleAt.get(url);
}
const _priors = new Map();
async function priorOf(S, model) { if (!_priors.has(model)) { const PR = await import('../body/prior.js'); _priors.set(model, await PR.loadPrior(S, { model })); } return _priors.get(model); }
// the person as built: 'prior' (the v2 default), 'form1' (FORM alone, no learned prior), 'form0' (CAST's lineup record as baked)
export async function personOf(S, e, which = 'prior') {
  const B = await import('../body/index.js');
  if (which === 'form0') { const C = await import('./casting.js'), L = await C.loadLineup(S); return L.find(e.name); }
  if (which === 'form1') return B.person(S, e.form1);
  const PR = await import('../body/prior.js'); return PR.priorPerson(S, await priorOf(S, e.prior.prior.model), e.prior);
}

// ---------------------------------------------------------------- the Hero's options (the same in the bake and in the page: the
// geometry the garments were solved on is the geometry drawn)
export function heroOpts2(e, variant, height) {
  const f = e.sex === 'f', age = e.age;
  return { variant, height, kind: 'work', skin: e.skin, c7: true, cloth: true, seed: 7, hat: 'none', gloves: false, vest: null,
    age: clamp((age - 20) / 50) * 0.85 + 0.1, hair: age >= 62 ? '#9a948c' : age >= 50 ? '#5a5048' : '#2a1c12', hairStyle: f ? 'bun' : 'short', beard: 0, stubble: f ? 0 : 0.3 };
}
export const poseOf2 = (e, pl) => ({ weight: pl.weight, stance: 'rest', look: 0, age: [e.age, e.age] });
// the v2 stance: lane F's idleStance with the person's kin; optionally each upper arm turned out a little more (armOut, rad, about the
// body's forward axis; default 0 = lane F's stance as is). The bake and the page call this same function, so the drape and the drawn pose
// agree. (First suspected for the sleeves hanging beside the arms on prior bodies; the cause was the placement: see placeFrom.)
// round 3 POSE: the person's stance record (motion/stance.js; plain JSON, seeded by name and seed). `want`: true / 'seeded' (drawn), a full
// record (used as is), or a partial one ({ legs, arms, side, armSide, head }: drawn with those fixed). SM: the stance module (imported by
// the caller, so v2.js loads nothing new unless a stance is asked for)
export function stanceOf2(SM, e, want = true, { seed = 1, dressed = false } = {}) {
  if (want && typeof want === 'object' && want.v) return want;
  const fix = want && typeof want === 'object' ? want : {};
  return SM.stanceOf(e.name, { sex: e.sex, age: e.age, dressed, seed: fix.seed ?? seed, legs: fix.legs, arms: fix.arms, side: fix.side, armSide: fix.armSide, head: fix.head });
}
export function standV2(h, e, pl, p, { armOut = pl?.armOut ?? 0 } = {}) {
  idleStance(h, pl ? poseOf2(e, pl) : { weight: 0.6, stance: 'rest', look: 0, age: [e.age, e.age] }, { kin: true, person: p });
  if (armOut) { const ax = new THREE.Vector3(0, 0, 1); h.update(); h.rotateWorld('upperarm01.L', ax, armOut); h.rotateWorld('upperarm01.R', ax, -armOut); }
  h.update(); return armOut;
}

// ---------------------------------------------------------------- the bake (node; ~1.5-2 min a person, K3's recipe on the v2 body)
// K3 (CLOTHING c2 foundations) wrote the recipe in labs/clothing2/k3_dress.mjs dressOne for lane A bodies; this is the same chain with
// the v2 person (prior body, FACE c2) and the integrator's plan. Container: 'PV2 ' + u32 header length + header JSON + the K3 bake
// (finish.js packBake) + the hero data's positions and eyes (Float32, metres: the body the Hero is built from).

export async function unpackPerson2(buf) {
  const { unpackBake } = await import('../cloth/finish.js');
  const u8 = new Uint8Array(buf), hl = new DataView(u8.buffer, u8.byteOffset).getUint32(4, true), H = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + hl)).trim());
  const k3l = (H.k3 + 3) & ~3, o = 8 + hl, K = unpackBake(u8.slice(o, o + H.k3).buffer);
  const P = new Float32Array(u8.slice(o + k3l, o + k3l + H.pos * 4).buffer), E = new Float32Array(u8.slice(o + k3l + H.pos * 4, o + k3l + H.pos * 4 + H.eyes * 4).buffer);
  return { ...K, v2: H, pos: P, eyes: E };
}

// ---------------------------------------------------------------- the page: parts as skinned meshes (K3's lab drawing, labs/clothing2/foundations.js)
function fabricU(dye) { return { cA: { value: new THREE.Color(dye) }, cB: { value: new THREE.Color(dye) }, cKind: { value: 0 }, cDirt: { value: 0.06 }, cSeed: { value: 3.1 }, cWet: { value: 0 }, cPart: { value: 0 },
  cHem: { value: new THREE.Vector4(9, 9, 9, 100) }, cHem2: { value: new THREE.Vector4(100, -100, 0, 0) }, cWear: { value: 0.08 }, cSweat: { value: 0 }, cFoldK: { value: 0 }, cRetro: { value: 0 },
  cFlex: { value: new THREE.Vector4() }, cFlex2: { value: new THREE.Vector4() }, cVest: { value: new THREE.Vector4(0, 1.3, 1.5, -100) }, cC7: { value: 1 }, cAsp: { value: 0.9 }, cBootP: { value: new THREE.Vector4() }, cBootP2: { value: new THREE.Vector4() },
  fLimbO: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) }, fLimbD: { value: [0, 1, 2, 3].map(() => new THREE.Vector3(0, -1, 0)) }, fLimbE: { value: [0, 1, 2, 3].map(() => new THREE.Vector3(1, 0, 0)) },
  fRad: { value: new THREE.Vector4(0.05, 0.08, 0.15, 0) }, fLen: { value: new THREE.Vector2(0.3, 0.45) }, cOpen: { value: 1 } }; }
export async function partMesh2(h, P, scale, o = {}) {
  const { fabricMaterial } = await import('../cloth/fabric_glsl.js');
  const n = P.n, g = new THREE.BufferGeometry(), X = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) X[i] = P.X[i] / scale;
  g.setAttribute('position', new THREE.BufferAttribute(X, 3)); g.setIndex(new THREE.BufferAttribute(P.T, 1));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(Uint16Array.from(P.SI), 4)); const SW = Float32Array.from(P.SW); for (let v = 0; v < n; v++) { const s = SW[v * 4] + SW[v * 4 + 1] + SW[v * 4 + 2] + SW[v * 4 + 3] || 1; for (let k = 0; k < 4; k++) SW[v * 4 + k] /= s; } g.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
  g.computeVertexNormals();
  let mat;
  if (P.solid) mat = new THREE.MeshPhysicalMaterial({ color: P.color, roughness: 0.38, clearcoat: 0.3, clearcoatRoughness: 0.4 });
  else { const uv = Float32Array.from(P.uv); if (P.group === 'construction') for (let i = 0; i < n; i++) { uv[i * 2] = P.X[i * 3] + 0.6 * P.X[i * 3 + 2]; uv[i * 2 + 1] = P.X[i * 3 + 1]; }
    const rest = new Float32Array(n * 3), ah = new Float32Array(n * 4); for (let i = 0; i < n; i++) { rest[i * 3] = uv[i * 2]; rest[i * 3 + 1] = uv[i * 2 + 1]; rest[i * 3 + 2] = (P.panel ? P.panel[i] : 0) * 0.01; ah.set([2, 0, 1, 0], i * 4); }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('aRest', new THREE.BufferAttribute(rest, 3)); g.setAttribute('aHero', new THREE.BufferAttribute(ah, 4)); g.setAttribute('aFold', new THREE.BufferAttribute(new Float32Array(n), 1));
    const N = g.attributes.normal.array, key = i => `${Math.round(X[i * 3] * 2e4)},${Math.round(X[i * 3 + 1] * 2e4)},${Math.round(X[i * 3 + 2] * 2e4)}`, grp = new Map();
    for (let i = 0; i < n; i++) { const k = key(i); if (!grp.has(k)) grp.set(k, []); grp.get(k).push(i); }
    for (const L of grp.values()) if (L.length > 1) { let x = 0, y = 0, z = 0; for (const i of L) { x += N[i * 3]; y += N[i * 3 + 1]; z += N[i * 3 + 2]; } const l = Math.hypot(x, y, z) || 1; for (const i of L) { N[i * 3] = x / l; N[i * 3 + 1] = y / l; N[i * 3 + 2] = z / l; } }
    // CLOTH8 seam (b) (round 7, 8 Oct; opt-in: o.posedNormals, from opts.posedNormals or a bake header's cloth8.normals === 'posed'; off:
    // byte-identical): the normals of the cloth AS POSED (the pose the bake was solved in, the skeleton's at this call), welded across the
    // seams the same way, each turned back through the inverse of its vertex's own blend, so that the skinning turns it exactly onto the
    // posed surface's normal. computeVertexNormals on the bind mesh drew dark shards wherever the bind is crumpled while the posed cloth is
    // smooth (the solver's mixed sleeve weights; the underarm, where the weights turn from spine to upper arm): the skinned normals pointed
    // into the arm. A vertex whose blend is singular keeps its bind normal.
    if (o.posedNormals && P.SI && P.SW) { const CL = await import('../cloth/collide.js'); h.group.updateMatrixWorld(true); const M = CL.boneMats(h.skeleton, h.body.matrixWorld);
      const Xb = Float64Array.from(X), Pp = CL.skinPose(Xb, Uint16Array.from(P.SI), SW, M, new Float64Array(n * 3), 1), NP = CL.vertexNormals(Pp, P.T, new Float64Array(n * 3));
      for (const L of grp.values()) if (L.length > 1) { let x = 0, y = 0, z = 0; for (const i of L) { x += NP[i * 3]; y += NP[i * 3 + 1]; z += NP[i * 3 + 2]; } for (const i of L) { NP[i * 3] = x; NP[i * 3 + 1] = y; NP[i * 3 + 2] = z; } }
      let kept = 0; for (let v = 0; v < n; v++) { const A = [0, 0, 0, 0, 0, 0, 0, 0, 0]; for (let k = 0; k < 4; k++) { const w = SW[v * 4 + k]; if (!w) continue; const m = P.SI[v * 4 + k] * 16; for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) A[c * 3 + r] += w * M[m + c * 4 + r]; }
        // A column-major (A[c * 3 + r]); solve A nb = np by the adjugate
        const a = A[0], b = A[3], c = A[6], d = A[1], e = A[4], f = A[7], g2 = A[2], hh = A[5], ii = A[8], det = a * (e * ii - f * hh) - b * (d * ii - f * g2) + c * (d * hh - e * g2), px = NP[v * 3], py = NP[v * 3 + 1], pz = NP[v * 3 + 2];
        if (Math.abs(det) < 1e-9 || !(px || py || pz)) { kept++; continue; }
        const nx = ((e * ii - f * hh) * px + (c * hh - b * ii) * py + (b * f - c * e) * pz) / det, ny = ((f * g2 - d * ii) * px + (a * ii - c * g2) * py + (c * d - a * f) * pz) / det, nz = ((d * hh - e * g2) * px + (b * g2 - a * hh) * py + (a * e - b * d) * pz) / det, l = Math.hypot(nx, ny, nz) || 1;
        N[v * 3] = nx / l; N[v * 3 + 1] = ny / l; N[v * 3 + 2] = nz / l; }
      g.attributes.normal.needsUpdate = true; g.userData.posedNormals = { kept }; }
    const warp = new Float32Array(n * 3), T = P.T;
    for (let t = 0; t < T.length; t += 3) { const a = T[t], b = T[t + 1], c = T[t + 2], du1 = uv[b * 2] - uv[a * 2], dv1 = uv[b * 2 + 1] - uv[a * 2 + 1], du2 = uv[c * 2] - uv[a * 2], dv2 = uv[c * 2 + 1] - uv[a * 2 + 1], det = du1 * dv2 - du2 * dv1; if (Math.abs(det) < 1e-12) continue;
      for (let k = 0; k < 3; k++) { const e1 = X[b * 3 + k] - X[a * 3 + k], e2 = X[c * 3 + k] - X[a * 3 + k], d = (-du2 * e1 + du1 * e2) / det; warp[a * 3 + k] += d; warp[b * 3 + k] += d; warp[c * 3 + k] += d; } }
    for (let i = 0; i < n; i++) { const l = Math.hypot(warp[i * 3], warp[i * 3 + 1], warp[i * 3 + 2]); if (l > 0) for (let k = 0; k < 3; k++) warp[i * 3 + k] /= l; else warp[i * 3 + 1] = 1; }
    g.setAttribute('aWarp', new THREE.BufferAttribute(warp, 3));
    // CLOTH3 (round 3, opt-in: a bake part marked sewn, from cloth/dress3.js): hero.js's sewn head (no cuts, no painted construction),
    // the panels' real seams for the seam wear and topstitching, construction drawn as closed solids (fabric_glsl.js fabricMaterial)
    const FN = P.sewn && P.group === 'garment' && P.panel ? await import('../cloth/finish.js') : null, sd = FN ? FN.seamDistance(P.X, P.uv, P.panel) : null, od = FN ? FN.openDistance(P.X, P.uv, P.panel, P.T) : null;
    if (sd) g.setAttribute('aSeamD', new THREE.BufferAttribute(sd, 1)); if (od) g.setAttribute('aOpenD', new THREE.BufferAttribute(od, 1));
    mat = fabricMaterial({ fabric: P.fabric || 'chambray', color: P.color, uniforms: fabricU(P.color), glsl: HERO_CLOTH_GLSL, key: 'k3-fabric', defines: { FAB_UVQ: 1, FAB_WARP: 1, CLOTH_REST: 1, CLOTH_FOLD: 1 }, ...(P.sewn ? { sewn: true, seamD: !!sd, openD: !!od, solid: P.group === 'construction' } : {}) }); mat.side = THREE.DoubleSide; }
  const m = new THREE.SkinnedMesh(g, mat); m.bind(h.skeleton, h.body.bindMatrix); m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
  m.userData.k3 = { name: P.name, construction: P.construction, group: P.group, fabric: P.fabric || null, color: P.color || null, solid: !!P.solid, ...(P.sewn ? { sewn: true } : {}) }; m.userData.part = 'v2-' + P.group;
  h.body.parent.add(m); m.position.copy(h.body.position); m.quaternion.copy(h.body.quaternion); m.scale.copy(h.body.scale); return m;
}
// the skin cull at the body's current level: K3's lists are triangles of the 13k body; Loop level L puts triangle t's children at
// t * 4^L .. (t + 1) * 4^L - 1 (subdiv.js oneLevel); this hero's own index copy (lane A heroes share one: K3's trap)
// The culled triangles are LEFT OUT of a new index (not made degenerate in place as K3's applyCull does): Blender's mesh validation
// drops degenerate faces, and the Cycles export, its unwrap and the engine bake must all see the same triangle list.
export function cullBody2(h, tris) {
  const g = h.body.geometry, L = g.userData.subdiv?.levels || 0, k = 4 ** L, I = g.index.array, nt = I.length / 3, cut = new Uint8Array(nt);
  for (const t of tris) for (let c = t * k; c < (t + 1) * k && c < nt; c++) cut[c] = 1;
  const keep = new Uint32Array((nt - cut.reduce((a, b) => a + b, 0)) * 3); let o = 0;
  for (let t = 0; t < nt; t++) if (!cut[t]) { keep[o++] = I[t * 3]; keep[o++] = I[t * 3 + 1]; keep[o++] = I[t * 3 + 2]; }
  g.setIndex(new THREE.BufferAttribute(keep, 1)); g.userData.v2Culled = nt - keep.length / 3; return g.userData.v2Culled;
}

// the parts ride P1's detailed body (integration v2, seam V4): K3's shells, bindings and straps sit ~1-2 mm off the 13k body, and the
// level-1 surface stands proud of it (the smooth limit surface between vertices plus the detail's muscle, bone and fold relief), so skin
// came through the straps and bindings in pieces (first Cycles face). Each part vertex within 2 cm of the body moves out along the body
// normal by how far the detailed surface there stands outside the flat 13k one (+0.3 mm), in bind space, before skinning.
export async function rideDetail(h, meshes) {
  const g = h.body.geometry, plan = g.userData.plan, g0 = h.body.userData.geomL0; if (!plan || !g0 || !meshes.length) return 0;
  const { subdivideAttr } = await import('../body/subdiv.js'), P = g.attributes.position.array, N = g.attributes.normal.array, Lin = subdivideAttr(plan, g0.attributes.position.array, 3, 'linear');
  const n = P.length / 3, dl = new Float32Array(n), sc = h.scale || 1, cell = 0.01 / sc, reach = 0.02 / sc, eps = 0.0003 / sc, grid = new Map(), key = (i, j, k) => (i * 73856093) ^ (j * 19349663) ^ (k * 83492791);
  for (let v = 0; v < n; v++) { dl[v] = Math.max(0, (P[v * 3] - Lin[v * 3]) * N[v * 3] + (P[v * 3 + 1] - Lin[v * 3 + 1]) * N[v * 3 + 1] + (P[v * 3 + 2] - Lin[v * 3 + 2]) * N[v * 3 + 2]);
    if (dl[v] <= 0) continue; const k = key(Math.floor(P[v * 3] / cell), Math.floor(P[v * 3 + 1] / cell), Math.floor(P[v * 3 + 2] / cell)); (grid.get(k) || grid.set(k, []).get(k)).push(v); }
  let moved = 0;
  for (const m of meshes) { const X = m.geometry.attributes.position.array, c = X.length / 3;
    for (let i = 0; i < c; i++) { const x = X[i * 3], y = X[i * 3 + 1], z = X[i * 3 + 2], ci = Math.floor(x / cell), cj = Math.floor(y / cell), ck = Math.floor(z / cell); let best = -1, bd = reach * reach;
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let e = -2; e <= 2; e++) { const L = grid.get(key(ci + a, cj + b, ck + e)); if (!L) continue; for (const v of L) { const d = (P[v * 3] - x) ** 2 + (P[v * 3 + 1] - y) ** 2 + (P[v * 3 + 2] - z) ** 2; if (d < bd) { bd = d; best = v; } } }
      if (best < 0) continue; const k = dl[best] + eps; X[i * 3] += k * N[best * 3]; X[i * 3 + 1] += k * N[best * 3 + 1]; X[i * 3 + 2] += k * N[best * 3 + 2]; moved++; }
    m.geometry.attributes.position.needsUpdate = true; m.geometry.computeVertexNormals(); m.geometry.computeBoundingSphere(); }
  return moved;
}

// the parts lifted off the POSED body (integration v2, seam V5): K3 fits its shells, bindings and straps in bind; posed (arms down from
// the A-pose) the shoulder and upper chest move by skin weights the strap does not share (its weights are averaged along it), and on the
// learned bodies the skin came through the bra straps in pieces (engine and Cycles alike; not P1's detail: the same without it). For the
// pose the person stands in, every part vertex that the posed body reaches (closer than `gap` along the body's posed normal, up to 2 cm
// inside) moves out by the difference, the push taken back to bind along the body's bind normal. Pose-specific: a new pose re-runs it.
export function liftOverPosed(h, meshes, { gap = 0.0009, iters = 2, maxPush = 0.006 } = {}) {
  if (!meshes.length) return 0; const body = h.body, g = body.geometry, n = g.attributes.position.count, I = g.index.array, v3 = new THREE.Vector3();
  h.group.updateMatrixWorld(true); body.skeleton.update();
  const PB = new Float32Array(n * 3); for (let i = 0; i < n; i++) { v3.fromBufferAttribute(g.attributes.position, i); body.applyBoneTransform(i, v3); PB[i * 3] = v3.x; PB[i * 3 + 1] = v3.y; PB[i * 3 + 2] = v3.z; }
  const NB = new Float32Array(n * 3); for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3, ux = PB[b] - PB[a], uy = PB[b + 1] - PB[a + 1], uz = PB[b + 2] - PB[a + 2], wx = PB[c] - PB[a], wy = PB[c + 1] - PB[a + 1], wz = PB[c + 2] - PB[a + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; for (const q of [a, b, c]) { NB[q] += nx; NB[q + 1] += ny; NB[q + 2] += nz; } }
  for (let i = 0; i < n; i++) { const l = Math.hypot(NB[i * 3], NB[i * 3 + 1], NB[i * 3 + 2]) || 1; NB[i * 3] /= l; NB[i * 3 + 1] /= l; NB[i * 3 + 2] /= l; }
  const N0 = g.attributes.normal.array, sc = h.scale || 1, cell = 0.01 / sc, key = (i, j, k) => (i * 73856093) ^ (j * 19349663) ^ (k * 83492791), grid = new Map();
  const inTri = new Uint8Array(n); for (let k = 0; k < I.length; k++) inTri[I[k]] = 1;
  for (let i = 0; i < n; i++) { if (!inTri[i]) continue; const k = key(Math.floor(PB[i * 3] / cell), Math.floor(PB[i * 3 + 1] / cell), Math.floor(PB[i * 3 + 2] / cell)); (grid.get(k) || grid.set(k, []).get(k)).push(i); }
  let moved = 0; const G = gap / sc, lim = maxPush / sc;
  for (const m of meshes) { const X = m.geometry.attributes.position.array, c = X.length / 3, push = new Float32Array(c), T = m.geometry.index ? m.geometry.index.array : null;
    // neighbours (a push is spread to them: a broad, smooth lift, not a pinch where one vertex meets a form)
    const nbr = Array.from({ length: c }, () => []); if (T) for (let t = 0; t < T.length; t += 3) for (const [a, b] of [[T[t], T[t + 1]], [T[t + 1], T[t + 2]], [T[t + 2], T[t]]]) { nbr[a].push(b); nbr[b].push(a); }
    for (let it = 0; it < iters; it++) { m.skeleton.update(); let any = 0; const want = new Float32Array(c), dir = new Float32Array(c * 3);
      for (let i = 0; i < c; i++) { v3.set(X[i * 3], X[i * 3 + 1], X[i * 3 + 2]); m.applyBoneTransform(i, v3); const ci = Math.floor(v3.x / cell), cj = Math.floor(v3.y / cell), ck = Math.floor(v3.z / cell); let best = -1, bd = Infinity;
        for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let e = -2; e <= 2; e++) { const L = grid.get(key(ci + a, cj + b, ck + e)); if (!L) continue; for (const v of L) { const d = (PB[v * 3] - v3.x) ** 2 + (PB[v * 3 + 1] - v3.y) ** 2 + (PB[v * 3 + 2] - v3.z) ** 2; if (d < bd) { bd = d; best = v; } } }
        if (best < 0) continue; const sd = (v3.x - PB[best * 3]) * NB[best * 3] + (v3.y - PB[best * 3 + 1]) * NB[best * 3 + 1] + (v3.z - PB[best * 3 + 2]) * NB[best * 3 + 2];
        dir[i * 3] = N0[best * 3]; dir[i * 3 + 1] = N0[best * 3 + 1]; dir[i * 3 + 2] = N0[best * 3 + 2];
        if (sd >= G || sd < -0.02 / sc) continue; want[i] = Math.min(G - sd, lim - push[i]); }
      for (let r = 0; r < 4; r++) { const w2 = Float32Array.from(want); for (let i = 0; i < c; i++) { const L = nbr[i]; if (!L.length) continue; let a = 0; for (const j of L) a += want[j]; w2[i] = Math.max(want[i], 0.85 * a / L.length); } want.set(w2); }
      for (let i = 0; i < c; i++) { const k = Math.min(want[i], lim - push[i]); if (k <= 1e-6 || !(dir[i * 3] || dir[i * 3 + 1] || dir[i * 3 + 2])) continue; push[i] += k; any++;
        X[i * 3] += k * dir[i * 3]; X[i * 3 + 1] += k * dir[i * 3 + 1]; X[i * 3 + 2] += k * dir[i * 3 + 2]; }
      moved += any; if (!any) break; }
    m.geometry.attributes.position.needsUpdate = true; m.geometry.computeVertexNormals(); m.geometry.computeBoundingSphere(); }
  return moved;
}

// ---------------------------------------------------------------- makePerson2: one person in the page, each stage switchable
// stages (in this order): form prior | face | detail | kin | hair | skin eyes | found (K3 underwear) | stack (sewn garments) | style
//   form off = CAST's record as baked (form 0); prior off = FORM alone. found / stack draw the BAKE (its body is prior + bra + face):
//   with them on, form, prior and face are the bake's (a re-bake switches those). Without found the figure-study register is v1's
//   painted underwear (lane E + the bust band).
export const STAGES2 = ['form', 'prior', 'face', 'detail', 'kin', 'hair', 'skin', 'eyes', 'found', 'stack', 'style'];
const _bakes = new Map();
export async function loadBake2(name, { url = ASSETS + 'v2/' } = {}) {
  const ck = url + name; if (!_bakes.has(ck)) _bakes.set(ck, (async () => { const r = await fetch(url + name + '.pv2.bin'); if (!r.ok) throw new Error('person: no bake for ' + name + ' in ' + url); return unpackPerson2(await r.arrayBuffer()); })());
  return _bakes.get(ck);
}

// ---------------------------------------------------------------- the figure study's stance (POSE, round 3): the seeded draw; dressed: the arms
// the dressed bakes were sewn for (hang, hip)
export const DRESSED_ARMS = ['hang', 'hip'];
export function stanceV3(SM, e, { seed = 1, dressed = false, arms = DRESSED_ARMS } = {}) {
  const rec = stanceOf2(SM, e, true, { seed, dressed: false });
  if (dressed && !arms.includes(rec.arms)) return { ...rec, arms: 'hang', armsWas: rec.arms };
  return rec;
}

// ---------------------------------------------------------------- the scalp hair pushed out of the posed body and garments
// HAIR4 settles each braid / loc in the BIND pose against the body's envelope (hair/v3.js settleRope), then the stance moves it with the
// body's weights where it rests. Two things it cannot see: the shirt (the braid ends and the long hair sit on or through it: HAIR4's
// note) and the pose (a folded arm, a turned head, a tilted shoulder move the body under a rope sewn to another). After the stance, with
// the garments on, every scalp-hair point below the neck is tested against the POSED body as a height field, raised by the LAYER the
// visible parts make there (shirt, collar, waistband, underwear: how far the outermost stands off the body along its normal): a body
// point counts when the hair point lies within `lat` of its normal line, below its layer top and no deeper than `deep` behind it. A card's pair / a tube's ring
// moves as one (its largest need), the need spreads along the strand with a falloff (no kink where a rope meets the shirt), and the
// move is written back to the bind position through the vertex's own skinning matrix, so the posed hair in this stance is exactly
// the pushed one (and the export / Cycles read the same).
export function settleHairPosed(P, { off = 0.003, lat = 0.012, deep = 0.035, cell = 0.02, layerLat = 0.015, nSmooth = 0.03, spread = 0.75, maxPush = 0.04, below = 0.02, trace: opts_trace = false } = {}) {
  const h = P.h, G = P.groom; h.update?.(); h.group.updateMatrixWorld(true); h.skeleton?.update();
  const scalp = G.meshes.filter(m => m.userData.hairPart === 'scalp' && m.geometry.attributes.aHair);
  if (!scalp.length) return { moved: 0, note: 'no scalp cards' };
  const neckY = h.joint('neck01').y + below, v = new THREE.Vector3();
  // posed world positions (three's own CPU skinning, morphs included) and, when asked, the posed normals of the geometry's normal attribute
  const posed = (m, wantN = false) => { const g = m.geometry, n = g.attributes.position.count, X = new Float32Array(n * 3), NA = wantN ? g.attributes.normal : null, N = NA ? new Float32Array(n * 3) : null;
    m.updateMatrixWorld(true); if (m.isSkinnedMesh) m.skeleton.update(); const BM = m.isSkinnedMesh ? m.skeleton.boneMatrices : null, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight, e = new THREE.Matrix4(), nv = new THREE.Vector3();
    for (let i = 0; i < n; i++) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); X[i * 3] = v.x; X[i * 3 + 1] = v.y; X[i * 3 + 2] = v.z;
      if (!NA) continue; nv.fromBufferAttribute(NA, i);
      if (BM && SI && SW) { const E = e.elements; E.fill(0); for (let c = 0; c < 4; c++) { const w = SW.getComponent(i, c); if (!w) continue; const o = SI.getComponent(i, c) * 16; for (let z = 0; z < 16; z++) E[z] += w * BM[o + z]; } nv.transformDirection(e); }
      else nv.transformDirection(m.matrixWorld);
      N[i * 3] = nv.x; N[i * 3 + 1] = nv.y; N[i * 3 + 2] = nv.z; }
    return wantN ? { X, N } : X; };
  const normals = (X, idx) => { const N = new Float32Array(X.length), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let t = 0; t < idx.length; t += 3) { const i = idx[t], j = idx[t + 1], k = idx[t + 2]; a.fromArray(X, i * 3); b.fromArray(X, j * 3).sub(a); c.fromArray(X, k * 3).sub(a); b.cross(c);
      for (const q of [i, j, k]) { N[q * 3] += b.x; N[q * 3 + 1] += b.y; N[q * 3 + 2] += b.z; } }
    for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i], N[i + 1], N[i + 2]); if (l > 0) { N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; } } return N; };
  const fullIndex = g => g.index ? g.index.array : Uint32Array.from({ length: g.attributes.position.count }, (_, i) => i);
  const yTop = neckY + 0.05, yBot = neckY - 0.75, SX = new Map(scalp.map(m => [m, posed(m)]));
  if (![...SX.values()].some(X => { for (let i = 1; i < X.length; i += 3) if (X[i] < neckY) return true; return false; })) return { moved: 0, over1mm: 0, note: 'no scalp hair below the neck' };
  // the collider is the posed BODY (its own bind normals skinned: its index is culled under the clothes) with a LAYER height per body
  // point: how far the outermost visible part (shirt, collar, waistband, underwear) stands off the body along the body's normal there.
  // A garment's own normals are not used (a collar's fall and stand, a band's top edge, belt loops turn every way); its distance is.
  const BP = posed(h.body, true), bodyX = BP.X, bodyN = BP.N || normals(bodyX, fullIndex(h.body.geometry));
  const pts = [], nrm = [], grid = new Map(), key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let i = 0; i < bodyX.length / 3; i++) { const y = bodyX[i * 3 + 1]; if (y > yTop || y < yBot || !(bodyN[i * 3] || bodyN[i * 3 + 1] || bodyN[i * 3 + 2])) continue;
    const id = pts.length / 3; pts.push(bodyX[i * 3], y, bodyX[i * 3 + 2]); nrm.push(bodyN[i * 3], bodyN[i * 3 + 1], bodyN[i * 3 + 2]); const kk = key(bodyX[i * 3], y, bodyX[i * 3 + 2]); let L = grid.get(kk); if (!L) grid.set(kk, (L = [])); L.push(id); }
  const nBody = pts.length / 3, layer = new Float32Array(nBody), each = (x, y, z, r, fn) => { const R = Math.ceil(r / cell), a = Math.floor(x / cell), b = Math.floor(y / cell), c = Math.floor(z / cell);
    for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) for (let k = -R; k <= R; k++) { const L = grid.get(`${a + i},${b + j},${c + k}`); if (L) for (const id of L) fn(id); } };
  // the body's normals smoothed over `nSmooth` (a cleavage, an armpit or the gap between a folded arm and the chest turn the raw normals
  // sideways; the clothes bridge them, and so should the push)
  if (nSmooth > 0) { const N2 = new Float32Array(nrm.length);
    for (let id = 0; id < nBody; id++) { let sx = 0, sy = 0, sz = 0; const x = pts[id * 3], y = pts[id * 3 + 1], z = pts[id * 3 + 2];
      each(x, y, z, nSmooth, j => { const d2 = (pts[j * 3] - x) ** 2 + (pts[j * 3 + 1] - y) ** 2 + (pts[j * 3 + 2] - z) ** 2; if (d2 > nSmooth * nSmooth) return; const w = 1 - d2 / (nSmooth * nSmooth); sx += nrm[j * 3] * w; sy += nrm[j * 3 + 1] * w; sz += nrm[j * 3 + 2] * w; });
      const l = Math.hypot(sx, sy, sz) || 1; N2[id * 3] = sx / l; N2[id * 3 + 1] = sy / l; N2[id * 3 + 2] = sz / l; }
    for (let i = 0; i < nrm.length; i++) nrm[i] = N2[i]; }
  let nParts = 0, nPartV = 0;
  const visibleIn = m => { for (let p = m; p; p = p.parent) if (p.visible === false) return false; return true; };
  for (const m of P.parts || []) { if (!visibleIn(m) || !m.geometry?.attributes?.position) continue; const X = posed(m); nParts++;
    for (let i = 0; i < X.length / 3; i++) { const x = X[i * 3], y = X[i * 3 + 1], z = X[i * 3 + 2]; if (y > yTop || y < yBot) continue; nPartV++;
      each(x, y, z, layerLat, id => { const dx = x - pts[id * 3], dy = y - pts[id * 3 + 1], dz = z - pts[id * 3 + 2], hh = dx * nrm[id * 3] + dy * nrm[id * 3 + 1] + dz * nrm[id * 3 + 2];
        if (hh < -0.004 || hh > 0.08 || dx * dx + dy * dy + dz * dz - hh * hh > layerLat * layerLat) return; if (hh > layer[id]) layer[id] = hh; }); } }
  // ---- the need of one hair point: the largest (layer + off - s) over body points within `lat` of their normal line and <= `deep` behind
  const needAt = (x, y, z, out) => { let best = 0; out[0] = out[1] = out[2] = 0;
    each(x, y, z, Math.max(lat, deep), id => { const dx = x - pts[id * 3], dy = y - pts[id * 3 + 1], dz = z - pts[id * 3 + 2], nx = nrm[id * 3], ny = nrm[id * 3 + 1], nz = nrm[id * 3 + 2], s = dx * nx + dy * ny + dz * nz, top = layer[id] + off;
      if (s >= top || s < -deep) return; if (dx * dx + dy * dy + dz * dz - s * s > lat * lat) return; const need = Math.min(maxPush, top - s);
      if (need > best) { best = need; out[0] = nx * need; out[1] = ny * need; out[2] = nz * need; out[3] = layer[id] > 0 ? 1 : 0; out[4] = id; } });
    return best; };
  // ---- per scalp mesh: groups (a ribbon's pair, a tube's ring: runs of equal aHair.x), strands (t restarts), needs, spread, write back
  const rep = { colliders: { body: nBody, covered: layer.reduce((q, x) => q + (x > 0 ? 1 : 0), 0), partVerts: nPartV, partMeshes: nParts }, groups: 0, moved: 0, over1mm: 0, maxMm: 0, meanMm: 0, strands: 0 };
  const inv = new THREE.Matrix4(), M = new THREE.Matrix4(), acc = new THREE.Matrix4(), d = new THREE.Vector3(), tmp = [0, 0, 0, 0, 0]; const deepN = { body: 0, parts: 0 }, trace = [];
  let sumMm = 0;
  for (const m of scalp) { const g = m.geometry, A = g.attributes.aHair, n = g.attributes.position.count, X = SX.get(m), groups = [];
    let i = 0, prevT = -1, strand = -1;
    while (i < n) { let j = i + 1; while (j < n && A.getX(j) === A.getX(i) && j - i < 64) j++; const t = A.getX(i); if (t === 0 || t <= prevT) strand++; prevT = t; groups.push({ a: i, b: j, s: strand, need: [0, 0, 0], k: 0 }); i = j; }
    rep.groups += groups.length; rep.strands += strand + 1;
    for (const G1 of groups) { let ymin = Infinity; for (let q = G1.a; q < G1.b; q++) ymin = Math.min(ymin, X[q * 3 + 1]); if (ymin > neckY) continue;
      for (let q = G1.a; q < G1.b; q++) { if (X[q * 3 + 1] > neckY) continue; const k = needAt(X[q * 3], X[q * 3 + 1], X[q * 3 + 2], tmp); if (k > G1.k) { G1.k = k; G1.need = tmp.slice(0, 3); G1.src = tmp[3]; G1.cid = tmp[4]; G1.at = [X[q * 3], X[q * 3 + 1], X[q * 3 + 2]]; } }
      if (G1.k > 0.01) { deepN[G1.src ? 'parts' : 'body']++; if (trace.length < 12 && G1.k > 0.02) trace.push({ k: +(G1.k * 1000).toFixed(1), src: G1.src, at: G1.at.map(x => +x.toFixed(3)), c: [pts[G1.cid * 3], pts[G1.cid * 3 + 1], pts[G1.cid * 3 + 2]].map(x => +x.toFixed(3)), n: [nrm[G1.cid * 3], nrm[G1.cid * 3 + 1], nrm[G1.cid * 3 + 2]].map(x => +x.toFixed(2)) }); } }
    // spread along each strand (forward and back), never below a group's own need
    for (const dir of [1, -1]) for (let q = dir > 0 ? 1 : groups.length - 2; q >= 0 && q < groups.length; q += dir) { const G1 = groups[q], G0 = groups[q - dir]; if (G0.s !== G1.s) continue; const k0 = G0.k * spread; if (k0 > G1.k) { G1.k = k0; G1.need = G0.need.map(x => x * spread); } }
    const pos = g.attributes.position, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight, BM = m.skeleton.boneMatrices, wInv = new THREE.Matrix4().copy(m.matrixWorld).invert();
    let movedHere = 0;
    for (const G1 of groups) { if (G1.k < 1e-5) continue; d.set(...G1.need).transformDirection(wInv).multiplyScalar(G1.k);   // world -> the mesh's frame (rotation only: the hero scale is in the bones)
      // the mesh-local delta is (bindMatrixInverse * sum w B * bindMatrix) applied to the bind delta: invert that per vertex
      for (let q = G1.a; q < G1.b; q++) { const e = acc.elements; e.fill(0);
        for (let c = 0; c < 4; c++) { const w = SW.getComponent(q, c); if (!w) continue; const o = SI.getComponent(q, c) * 16; for (let z = 0; z < 16; z++) e[z] += w * BM[o + z]; }
        M.multiplyMatrices(m.bindMatrixInverse, acc).multiply(m.bindMatrix); inv.copy(M).setPosition(0, 0, 0).invert();
        const db = d.clone().applyMatrix4(inv); pos.setXYZ(q, pos.getX(q) + db.x, pos.getY(q) + db.y, pos.getZ(q) + db.z); }
      movedHere++; const mm = G1.k * 1000; sumMm += mm; rep.maxMm = Math.max(rep.maxMm, mm); if (mm > 1) rep.over1mm++; }
    if (movedHere) { pos.needsUpdate = true; g.computeBoundingSphere(); g.computeBoundingBox?.(); }
    rep.moved += movedHere; }
  // the world-space push length (the bones may scale: measure it posed) on one moved vertex is what the report gives
  rep.deep10mm = deepN; if (opts_trace) rep.trace = trace;
  rep.meanMm = rep.moved ? +(sumMm / rep.moved).toFixed(1) : 0; rep.maxMm = +rep.maxMm.toFixed(1);
  return rep;
}

// ---------------------------------------------------------------- the cloth's posed spikes (CLOTH4's open item)
// Some carried bakes hold a few garment vertices far out of the cloth in the posed stance: thin spikes from the sleeves at the waist's
// height on some backs (L21, L08; CARRY's bakes too). A vertex is a spike when it stands farther than `far` from the mean of its mesh
// neighbours (2 x `far` on a free edge: collar points, hem corners) AND more than `k` x its neighbourhood's edge; it is moved to that mean (posed), a few passes so a strip of them
// folds back too, and the move is written back to the bind position through the vertex's own skinning matrix (as settleHairPosed).
export function despikeParts(P, { far = 0.03, k = 3, passes = 3, stretch = 3, minLen = 0.03, groups = ['garment'] } = {}) {   // (construction left alone: a collar point is a sharp corner of a closed solid)
  const h = P.h; h.group.updateMatrixWorld(true); h.skeleton?.update();
  const v = new THREE.Vector3(), acc = new THREE.Matrix4(), M = new THREE.Matrix4(), inv = new THREE.Matrix4(), rep = { meshes: 0, spikes: 0, maxMm: 0, parts: {} };
  for (const m of P.parts || []) { const g = m.geometry, k3 = m.userData.k3; if (!k3 || !groups.includes(k3.group) || !g.index || !m.isSkinnedMesh) continue;
    const n = g.attributes.position.count, X = new Float32Array(n * 3); m.updateMatrixWorld(true);
    for (let i = 0; i < n; i++) { m.getVertexPosition(i, v); X[i * 3] = v.x; X[i * 3 + 1] = v.y; X[i * 3 + 2] = v.z; }   // the mesh's own (posed) frame
    // neighbours, welded by bind position (a seam's two edges are one vertex: a seam is not a spike)
    const I = g.index.array, nb = Array.from({ length: n }, () => new Set());
    const ec = new Map(), bnd = new Uint8Array(n);
    for (let t = 0; t < I.length; t += 3) for (let c = 0; c < 3; c++) { const a = I[t + c], b = I[t + (c + 1) % 3]; nb[a].add(b); nb[b].add(a); const ek = a < b ? a * n + b : b * n + a; ec.set(ek, (ec.get(ek) || 0) + 1); }
    for (const [ek, c] of ec) if (c === 1) { bnd[Math.floor(ek / n)] = 1; bnd[ek % n] = 1; }   // a free edge's ends: a collar point or a hem corner is a legitimate outlier up to 2 x far
    const moved = new Map(), mv = (i, x, y, z) => { const o = moved.get(i) || [0, 0, 0]; moved.set(i, [o[0] + x - X[i * 3], o[1] + y - X[i * 3 + 1], o[2] + z - X[i * 3 + 2]]); X[i * 3] = x; X[i * 3 + 1] = y; X[i * 3 + 2] = z; };
    // (1) by STRETCH: a sewn panel's flat pattern (aRest: u, v in metres, z the panel) gives every edge its rest length; within a panel
    // an edge posed longer than `stretch` x its rest length and `minLen` is broken (cloth stretches tens of per cent, not 3x). A vertex
    // with most of its edges broken is out of the cloth: it moves to the mean of its neighbours that are not, in passes (a strip of
    // them folds back from its root to its tip)
    const RA = g.attributes.aRest;
    if (RA) { const restL = (a, b) => Math.abs(RA.getZ(a) - RA.getZ(b)) > 1e-4 ? -1 : Math.hypot(RA.getX(a) - RA.getX(b), RA.getY(a) - RA.getY(b));
      for (let pass = 0; pass < 8; pass++) { const out = new Uint8Array(n); let nOut = 0;
        for (let i = 0; i < n; i++) { let br = 0, tot = 0; for (const j of nb[i]) { const r0 = restL(i, j); if (r0 <= 0) continue; tot++; const L = Math.hypot(X[i * 3] - X[j * 3], X[i * 3 + 1] - X[j * 3 + 1], X[i * 3 + 2] - X[j * 3 + 2]); if (L > minLen && L > stretch * r0) br++; }
          if (tot && br * 2 > tot) { out[i] = 1; nOut++; } }
        if (!nOut) break; let any = 0;
        for (let i = 0; i < n; i++) { if (!out[i]) continue; let cx = 0, cy = 0, cz = 0, c = 0; for (const j of nb[i]) if (!out[j]) { cx += X[j * 3]; cy += X[j * 3 + 1]; cz += X[j * 3 + 2]; c++; } if (!c) continue; mv(i, cx / c, cy / c, cz / c); any++; }
        if (!any) break; } }
    // (2) a lone vertex far from the mean of its neighbours (no rest lengths needed)
    for (let pass = 0; pass < passes; pass++) { let any = 0;
      for (let i = 0; i < n; i++) { const N = nb[i]; if (N.size < 2) continue; let cx = 0, cy = 0, cz = 0; const L = [];
        for (const j of N) { cx += X[j * 3]; cy += X[j * 3 + 1]; cz += X[j * 3 + 2]; L.push(Math.hypot(X[j * 3] - X[i * 3], X[j * 3 + 1] - X[i * 3 + 1], X[j * 3 + 2] - X[i * 3 + 2])); }
        cx /= N.size; cy /= N.size; cz /= N.size; const d = Math.hypot(X[i * 3] - cx, X[i * 3 + 1] - cy, X[i * 3 + 2] - cz);
        if (d < far * (bnd[i] ? 2 : 1)) continue; L.sort((a, b) => a - b); const med = L[Math.floor(L.length / 2)];
        // the neighbourhood's own edge scale: the median edge among the neighbours themselves
        let ne = 0, nc = 0; for (const j of N) for (const q of nb[j]) if (q !== i && nc < 40) { ne += Math.hypot(X[j * 3] - X[q * 3], X[j * 3 + 1] - X[q * 3 + 1], X[j * 3 + 2] - X[q * 3 + 2]); nc++; }
        const scale = nc ? ne / nc : med; if (d < k * scale) continue;
        mv(i, cx, cy, cz); any++; }
      if (!any) break; }
    if (!moved.size) continue;
    const pos = g.attributes.position, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight, BM = m.skeleton.boneMatrices; let mx = 0;
    for (const [i, dd] of moved) { const e = acc.elements; e.fill(0);
      for (let c = 0; c < 4; c++) { const w = SW.getComponent(i, c); if (!w) continue; const o = SI.getComponent(i, c) * 16; for (let z = 0; z < 16; z++) e[z] += w * BM[o + z]; }
      M.multiplyMatrices(m.bindMatrixInverse, acc).multiply(m.bindMatrix); inv.copy(M).setPosition(0, 0, 0).invert();
      v.set(dd[0], dd[1], dd[2]).applyMatrix4(inv); pos.setXYZ(i, pos.getX(i) + v.x, pos.getY(i) + v.y, pos.getZ(i) + v.z); mx = Math.max(mx, Math.hypot(...dd)); }
    // normals: a moved vertex takes its neighbours' mean (partMesh2's normals are welded across seams: a recompute would undo that)
    const NA = g.attributes.normal; if (NA) { for (const i of moved.keys()) { let x = 0, y = 0, z = 0; for (const j of nb[i]) if (!moved.has(j)) { x += NA.getX(j); y += NA.getY(j); z += NA.getZ(j); } const l = Math.hypot(x, y, z); if (l > 0) NA.setXYZ(i, x / l, y / l, z / l); } NA.needsUpdate = true; }
    pos.needsUpdate = true; g.computeBoundingSphere();
    rep.meshes++; rep.spikes += moved.size; rep.maxMm = Math.max(rep.maxMm, +(mx * 1000).toFixed(0)); rep.parts[k3.name || m.name || 'part'] = moved.size; }
  return rep;
}

// ---------------------------------------------------------------- posing a built person: lane F's IK on the v6 person (body, clothes, hair,
// correctives as one figure). HeroPoser's constructor resets the skeleton to its bind; poserOf keeps the person's built pose (the dressed
// pose or stance the clothes were draped in) and hands back the poser (HeroPoser6: lane F's two-bone IK with the person's own kinematic
// model, the feet's contacts, the gait). Pose with it, then afterPose(P) once: the P1 detail ride, the skeleton, CORRECT5. The clothes
// follow by skinning (no cloth re-simulation: large departures from the built pose fold the cloth as skinning does; clips carry their
// own cloth offsets).
//   const hp = await poserOf(P); hp.arm('R', targetW, null, hp.dirW(new THREE.Vector3(-0.5, -0.8, -0.2).normalize())); afterPose(P);
export async function poserOf(P) {
  const { HeroPoser6 } = await import('../motion/act6.js'), h = P.h, keep = h.skeleton.bones.map(b => [b.position.clone(), b.quaternion.clone(), b.scale.clone()]);
  const hp = new HeroPoser6(h, { kin: !!h.meta?.kin, person: P.p });
  h.skeleton.bones.forEach((b, i) => { b.position.copy(keep[i][0]); b.quaternion.copy(keep[i][1]); b.scale.copy(keep[i][2]); }); h.update();
  return hp;
}
export function afterPose(P) { P.detail?.update?.(); P.h.update(); P.correct?.update?.(); return P; }

// ---------------------------------------------------------------- the page's side of skin rev 6: SKIN6's pass, once per LitRenderer, when a
// rev-6 body is in the scene (SKIN6's hand-off; StyleStage does not do it). Returns the pass (or null when no rev-6 body is there).
const _sss = new WeakMap();
export async function ensureSkinSSS(lr, scene, opts = {}) {
  if (!lr || _sss.has(lr)) return _sss.get(lr) || null;
  let any = false; scene?.traverse?.(o => { if (o.isMesh && o.material?.userData?.likeSkin6) any = true; });
  if (!any) return null;
  const { installSkinSSS } = await import('../likeness/sss_pass.js'); const S = installSkinSSS(lr, opts); _sss.set(lr, S); return S;
}
