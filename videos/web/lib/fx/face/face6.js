// FACE6 (HUMAN c8 round 6, 4 Oct): face rev 7: the face from OUR tissue system (lib/fx/body/face_tissue.js: the facial skeleton as
// parameters, muscles and fat compartments over it, the skin over them), with the scans only as a measuring stick. Opt-in: only
// face3Spec(info, { .., f6: {} }) reaches this file (makePerson('v5:<name>', { face3: { f6: {} } })); every other person, bake, lab and
// scene renders exactly as before (face6_test.mjs checks face3.js, face5.js without f6 against the files before FACE6).
//
// Where it sits in face3Data (rev 7 = v5's rev 6 with these changes; each a switch in f6):
//  1. RETUNE (FACE4's, kept: our own P2 features at 0.3, the mouth's at 0.2) but MakeHuman's AGE and FAT targets OFF (0): age and BMI
//     now come from the layers. FACE4's scan IDENTITY basis OFF (f6.scanId: true puts it back, as an option). FACE3's dimorphism targets
//     OFF: the women's forms come from the skeleton's sex and femininity terms (the same femininity draw).
//  2. TISSUE (here, before FACE3's shape): the base's painted crease bands relaxed (forms.js's nasolabial / tear-trough / marionette
//     forms; the layers make the creases now); the SKELETON field on the bone (transmitted to the skin by region; the eyes and teeth
//     ride it whole); the LAYERS' change (muscles and fat compartments: identity, age's deflation and descent, BMI) along the normals,
//     the table's own site amounts kept (the compartments redistribute; the cited site table sets how much); the skin as a sheet (a
//     fold is as sharp as the skin is thick).
//  3. FACE4's lids and lips warp (MRD1 / MRD2 by the scans' numbers: measurement), the seal: as v5.
//  4. MOUTH: as v5 (its lip relief is still the scans' mean: hand-off; f6.lips false for MOUTH's relief off).
//  5. FACE5: symmetry, lips' lines and wet band, eyes and the skin's age zones as v5; its crease relax, young fill and pleasant rest are
//     replaced by ours (age geometry from the layers; the rest from the muscles).
//  6. EXPRESSION from our muscles: zygomaticus major (the modiolus pulled along its line toward the zygoma, the cheek's fat bunched over
//     the nasolabial line, the lips following the corner), with a share of orbicularis oculi (the lower lid raised, the infraorbital
//     fat bunched): the REST is the person's seeded tone of it; and the same field becomes the rig's 'mouth-corner-puller' channel
//     (hero.js's smile morph, MOTION's 'smile' channel), so MOTION plays our muscles.
//  7. SEATING: the lids over the globe (no gap, no intersection: the margin rests on the globe, the lid's thickness over it), the teeth
//     under the lips (the alveolar field moves the teeth with the bone; the lips' cover measured against the site table).
import * as FT from '../body/face_tissue.js';
import { clamp, rng, hashStr, groupMix, baseMix } from './sample.js';
import { creaseMask } from './face5.js';

export const FACE6_VERSION = 1;
const sst = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const at = (P, v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
export const F6_CREDIT = null;   // rev 7 uses no scan-derived shape by default (f6.scanId: FACE4's credit comes back with the basis)
export const RETUNE7 = [['mouth/', 0.2], ['head/head-fat', 0], ['head/head-age', 0], ['', 0.3]];
export const F6_DEFAULTS = {
  scanId: false, dimorph: false, retune: RETUNE7,
  skeleton: { amp: { f: 1.1, m: 1.6 }, age: true },    // the scans measure more (NOTES: women 2.5x, men 1.2x in these directions); kept short of it: no caricature
  layers: { amp: 1, z: { f: 1.0, m: 1.2 } },
  creases: { keep: 0.4, relax: 12 },
  sheet: 2,                                   // Laplacian passes on the layers' change (the skin as a sheet; ~ its thickness at hm08's spacing)
  expr: { kind: 'rest', tone: null, rest: 1.0, smile: 3.4, smile2: 5.2, cap: 2.6, duchenne: 0.5, unitMm: null, channel: true },
  seat: { lids: true, inMax: 1.0, outMax: 1.2 },
  lips: 'ours',                               // the lips' form: 'ours' (LIP_FORM over MOUTH's machinery) | true (MOUTH's scan relief, v5) | false (none)
  imprint: 0.9,                               // how much of the ligaments' tether shows, x the skin's laxity by age (face_tissue.laxity)
  layersOut: false,                           // keep the layer surfaces for the ladder (f3.f6.layers)
};
const merge = (a, b) => b === false ? false : (b && typeof b === 'object' ? { ...a, ...b } : { ...a });

// face6Spec(info, o): o = the face3 options; o.f6 = {} | { age (override, years), bmi, seed, skeleton, layers, creases, expr, seat, scanId, .. }
export function face6Spec(info, o = {}) {
  const f6 = typeof o.f6 === 'object' ? o.f6 : {}, D = F6_DEFAULTS;
  const age = f6.age ?? info.age ?? 35, sex = info.sex === 'm' ? 'm' : 'f', gm = baseMix(groupMix(info.group || 'white'));
  const seedOf = () => rng((hashStr('face6:' + (info.name || '')) ^ Math.imul((f6.seed ?? 0) + 5, 2654435761)) >>> 0), r = seedOf();
  const sk = merge(D.skeleton, f6.skeleton), ly = merge(D.layers, f6.layers);
  // the femininity draw: FACE3's (same seed rule), passed in o.fem by face3Spec, so brows and lashes and the skeleton agree
  const ampOf = a => typeof a === 'object' && a ? (a[sex] ?? 1) : (a ?? 1);
  const zi = { sex, age: sk && sk.age === false ? 30 : age, group: info.group, fem: o.fem };
  const z = sk ? FT.skeletonZ(zi, r, { amp: ampOf(sk.amp), groupMix: gm, age: sk?.age }) : {};
  // the draw's fixed terms alone (sex, femininity, group, age: the same seed with no random amplitude): the look's averageness scales
  // only the random part (face6Tissue; P2's looks: pleasant 0.4, attractive 0.7: attractive faces sit nearer the average)
  const zT = sk ? FT.skeletonZ(zi, seedOf(), { amp: 0, groupMix: gm, age: sk?.age }) : {};
  const zL = {}; for (const L of FT.LAYERS) { let u = 0; while (u === 0) u = r(); zL[L.key] = +clamp(Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()) * (ly ? ampOf(ly.z) : 0), -2.4, 2.4).toFixed(3); }
  const ex = merge(D.expr, f6.expr); if (ex) { ex.kind = ex.kind ?? 'rest'; ex.tone = ex.tone ?? +(0.45 + 0.55 * r()).toFixed(3); }
  return { v: FACE6_VERSION, name: info.name, sex, age, ageCast: info.ageCast ?? info.age ?? age, bmi: f6.bmi ?? info.bmi ?? 24, group: info.group || 'white', fem: o.fem ?? null,
    scanId: f6.scanId ?? D.scanId, dimorph: f6.dimorph ?? D.dimorph, retune: f6.retune ?? D.retune, skeleton: sk, z, zT, layers: ly, zL, look: f6.look ?? null,
    creases: merge(D.creases, f6.creases), sheet: f6.sheet ?? D.sheet, imprint: f6.imprint ?? D.imprint, expr: ex, seat: merge(D.seat, f6.seat), lips: f6.lips ?? D.lips, layersOut: f6.layersOut ?? D.layersOut };
}

// ---------------------------------------------------------------- helpers
export function vnorm(P, tri, nb) { const N = new Float32Array(nb * 3);
  for (let t = 0; t < tri.length; t += 3) { const a = tri[t], b = tri[t + 1], c = tri[t + 2]; if (a >= nb || b >= nb || c >= nb) continue;
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; for (const v of [a, b, c]) { N[v * 3] += nx; N[v * 3 + 1] += ny; N[v * 3 + 2] += nz; } }
  for (let v = 0; v < nb; v++) { const l = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) || 1; N[v * 3] /= l; N[v * 3 + 1] /= l; N[v * 3 + 2] /= l; } return N; }
export function adjacency(tri, nb) { const S = Array.from({ length: nb }, () => new Set());
  for (let t = 0; t < tri.length; t += 3) { const a = tri[t], b = tri[t + 1], c = tri[t + 2]; if (a >= nb || b >= nb || c >= nb) continue; S[a].add(b).add(c); S[b].add(a).add(c); S[c].add(a).add(b); }
  return S.map(s => s.size ? Int32Array.from(s) : null); }
function relaxN(P, N, M, adj, lam) { const D = new Float32Array(M.length);
  for (let v = 0; v < M.length; v++) { if (M[v] < 0.01) continue; const a = adj[v]; if (!a) continue; let sx = 0, sy = 0, sz = 0; for (const u of a) { sx += P[u * 3]; sy += P[u * 3 + 1]; sz += P[u * 3 + 2]; }
    D[v] = ((sx / a.length - P[v * 3]) * N[v * 3] + (sy / a.length - P[v * 3 + 1]) * N[v * 3 + 1] + (sz / a.length - P[v * 3 + 2]) * N[v * 3 + 2]) * lam * M[v]; }
  for (let v = 0; v < M.length; v++) if (D[v]) { P[v * 3] += D[v] * N[v * 3]; P[v * 3 + 1] += D[v] * N[v * 3 + 1]; P[v * 3 + 2] += D[v] * N[v * 3 + 2]; } }
// the crease bands' depth: mean |normal Laplacian| (um) over a band (FACE5's read)
export function creaseRead(P, N, M, adj, thr = 0.5) { let s = 0, c = 0;
  for (let v = 0; v < M.length; v++) { if (M[v] < thr) continue; const a = adj[v]; if (!a?.length) continue; let sx = 0, sy = 0, sz = 0; for (const u of a) { sx += P[u * 3]; sy += P[u * 3 + 1]; sz += P[u * 3 + 2]; }
    s += Math.abs((sx / a.length - P[v * 3]) * N[v * 3] + (sy / a.length - P[v * 3 + 1]) * N[v * 3 + 1] + (sz / a.length - P[v * 3 + 2]) * N[v * 3 + 2]); c++; }
  return c ? +(s / c * 1e6).toFixed(1) : null; }
// the head's vertices and the head-only fade (nothing under the chin's underside moves; the collar 12 cm under the mouth never)
function headSet(A, P, nb) { const me = A.lm('me'), out = [], w = new Float32Array(nb);
  for (let v = 0; v < nb; v++) { const q = A.toMm(at(P, v)); if (q[1] < me[1] - 42 * A.s) continue; const k = sst(me[1] - 38 * A.s, me[1] - 10 * A.s, q[1]); if (k <= 0) continue; w[v] = k; out.push(v); }
  return { list: out, w }; }
// the eye proxies: per side the vertex list and the globe (a least-squares sphere through the proxy's back 3/4: the cornea's bulge out)
export function globes(E, side) {
  const out = {};
  for (const [s, sv] of [['L', 1], ['R', 0]]) { const ix = []; for (let i = 0; i < E.length / 3; i++) if (side[i] === sv) ix.push(i); if (ix.length < 8) continue;
    // the proxy's back half is a clean sphere (rms 0.27 mm on the cast); its front carries the cornea, iris and the lens' parts
    const zc = ix.reduce((a, i) => a + E[i * 3 + 2], 0) / ix.length, list = ix.filter(i => E[i * 3 + 2] < zc - 0.002);
    const A = Array.from({ length: 4 }, () => new Float64Array(4)), b = new Float64Array(4);
    for (const i of list) { const x = E[i * 3], y = E[i * 3 + 1], z = E[i * 3 + 2], row = [2 * x, 2 * y, 2 * z, 1], rhs = x * x + y * y + z * z; for (let a = 0; a < 4; a++) { b[a] += row[a] * rhs; for (let q = 0; q < 4; q++) A[a][q] += row[a] * row[q]; } }
    const M = A.map((r, i) => [...r, b[i]]); for (let i = 0; i < 4; i++) { let q = i; for (let j = i + 1; j < 4; j++) if (Math.abs(M[j][i]) > Math.abs(M[q][i])) q = j; [M[i], M[q]] = [M[q], M[i]]; for (let j = 0; j < 4; j++) if (j !== i) { const f = M[j][i] / (M[i][i] || 1e-30); for (let c = i; c <= 4; c++) M[j][c] -= f * M[i][c]; } }
    const q = M.map((r, i) => r[4] / (r[i] || 1e-30)), c = q.slice(0, 3), R = Math.sqrt(Math.max(1e-8, q[3] + c[0] ** 2 + c[1] ** 2 + c[2] ** 2));
    out[s] = { ix, c, R }; }
  return out;
}

// ---------------------------------------------------------------- 2. the tissue: skeleton + layers (+ the base's painted creases relaxed)
// face6Tissue(F, P0, E0, ctx, spec) -> { P, E, report, layers? }; ctx = { nb, n, tri, teeth: Uint32Array of helper vertex ids, bakeAge }
export function face6Tissue(F, P0, E0, ctx, spec) {
  const { nb, n, tri } = ctx, P = new Float32Array(P0), E = new Float32Array(E0), I = F.ids, R = {};
  // the look's averageness (P2's LOOKS_C2: common 0, pleasant 0.4, attractive 0.7) on the random part of the draw
  const av = ctx.averageness ?? 0; if (av > 0) { const z = {}; for (const [k, v] of Object.entries(spec.z)) { const t = spec.zT?.[k] ?? 0; z[k] = +Math.max(-2, Math.min(2, t + (1 - av) * (v - t))).toFixed(3); }
    const zL = {}; for (const [k, v] of Object.entries(spec.zL || {})) zL[k] = +(v * (1 - av)).toFixed(3); spec = { ...spec, z, zL }; R.averageness = av; }
  const A = FT.faceAnchors(P, I, nb), H = headSet(A, P, nb), adj = ctx.adj || adjacency(tri, nb);
  R.size = +A.s.toFixed(3); R.go = { L: A.go(1).map(x => +x.toFixed(1)), R: A.go(-1).map(x => +x.toFixed(1)) };
  // a. the base's painted crease bands (forms.js) relaxed: the layers make the creases now
  if (spec.creases) { const N = vnorm(P, tri, nb), M = creaseMask(P, I, nb), b0 = creaseRead(P, N, M, adj); let it = 0, now = b0;
    while (it < spec.creases.relax && now != null && now > spec.creases.keep * b0) { relaxN(P, N, M, adj, 0.5); it++; now = creaseRead(P, N, M, adj); }
    R.creases = { before: b0, after: now, passes: it }; }
  // b. the skeleton: the bone's displacement, transmitted to the skin by region; the eyes (globes) and the teeth ride it whole
  const SP = spec.skeleton ? FT.skeletonParts(A) : null, d = [0, 0, 0];
  let mxS = 0;
  if (SP) { for (const v of H.list) { const q = A.toMm(at(P, v)); FT.boneAt(SP, spec.z, q, d); const t = FT.transmissionAt(A, q) * H.w[v] * 0.001;
      P[v * 3] += d[0] * t; P[v * 3 + 1] += d[1] * t; P[v * 3 + 2] += d[2] * t; mxS = Math.max(mxS, Math.hypot(...d) * t * 1000); }
    if (ctx.teeth) for (const v of ctx.teeth) { const q = A.toMm(at(P0, v)); FT.boneAt(SP, spec.z, q, d); for (let a = 0; a < 3; a++) P[v * 3 + a] += d[a] * 0.001; }
    const G = globes(E0, ctx.side); R.globeMove = {};
    for (const [s, g] of Object.entries(G)) { FT.boneAt(SP, spec.z, A.toMm(g.c), d); for (const i of g.ix) for (let a = 0; a < 3; a++) E[i * 3 + a] += d[a] * 0.001; R.globeMove[s] = d.map(x => +x.toFixed(2)); }
    R.skeleton = { maxMm: +mxS.toFixed(2), z: spec.z }; }
  // c. the layers' change along the normals (mm): the compartments' identity, age (deflation, descent) and BMI, with the cited table's
  // own site amounts kept: dT = Lyr(person) - Lyr(30, 24, 0) - site-RBF[Lyr(age, bmi, 0) - Lyr(30, 24, 0)] + site-RBF[tab(age, bmi) - tab(bakeAge, 24)]
  const T = F.pop.tissue, LIG = { 1: FT.ligaments(A, 1), [-1]: FT.ligaments(A, -1) }, sites = FT.sitePoints(A);
  const stP = { sex: spec.sex, age: spec.age, bmi: spec.bmi, z: spec.layers ? spec.zL : {} }, st0 = { sex: spec.sex, age: 30, bmi: 24, z: {} }, stA = { ...stP, z: {} };
  // the layers' sum at q: untethered (the volume) or tethered (the ligaments' imprint)
  const lyr = (st, q, teth = false) => { let s = 0; for (const L of FT.LAYERS) for (const sg of L.shape.length > 1 ? [1, -1] : [1]) { if (L.shape.length > 1 && Math.sign(q[0] || 1) !== sg && Math.abs(q[0]) > 6 * A.s) continue; s += FT.layerThickness(L, A, q, sg, st, LIG[sg], teth); } return s; };
  const lax = FT.laxity(spec.age) * (spec.imprint ?? 0.9);
  const siteVals = sites.map(([k, q]) => { const dl = lyr(stA, q) - lyr(st0, q), dt = (FT.siteDepth(T, k, spec.sex, spec.age, spec.bmi) ?? 0) - (FT.siteDepth(T, k, spec.sex, ctx.bakeAge ?? spec.ageCast, 24) ?? 0); return [k, q, dt - dl, dl, dt]; });
  R.sites = Object.fromEntries(siteVals.filter((x, i, a) => a.findIndex(y => y[0] === x[0]) === i).map(([k, , c, dl, dt]) => [k, { layers: +dl.toFixed(2), table: +dt.toFixed(2), corr: +c.toFixed(2) }]));
  const corrAt = q => { let s = 0, w = 0.15; for (const [, c, v] of siteVals) { const e = ((q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2 + (q[2] - c[2]) ** 2) / (13 * A.s) ** 2; if (e > 30) continue; const g = Math.exp(-0.5 * e); s += g * v; w += g; } return s / w; };
  const dT = new Float32Array(nb); let mxT = 0;
  if (spec.layers) { const amp = spec.layers.amp ?? 1;
    // the volume's change (identity, age's gain / deflation / descent, BMI) + the tethers' imprint through a skin as lax as the age's
    for (const v of H.list) { const q = A.toMm(at(P, v)), vol = lyr(stP, q); dT[v] = amp * (vol - lyr(st0, q) + corrAt(q) + lax * (lyr(stP, q, true) - vol)) * H.w[v]; }
    // the skin as a sheet: the change low-passed at the skin's thickness (hm08's face spacing is 3-5 mm: `sheet` passes)
    for (let it = 0; it < (spec.sheet ?? 2); it++) { const D2 = Float32Array.from(dT); for (const v of H.list) { const a = adj[v]; if (!a) continue; let s = 0; for (const u of a) s += dT[u]; D2[v] = 0.5 * dT[v] + 0.5 * s / a.length; } dT.set(D2); }
    const N = vnorm(P, tri, nb); for (const v of H.list) { const k = dT[v] * 0.001; P[v * 3] += k * N[v * 3]; P[v * 3 + 1] += k * N[v * 3 + 1]; P[v * 3 + 2] += k * N[v * 3 + 2]; mxT = Math.max(mxT, Math.abs(dT[v])); }
    R.layers = { maxMm: +mxT.toFixed(2), laxity: +lax.toFixed(3), zL: spec.zL }; }
  R.creases && (R.creases.final = creaseRead(P, vnorm(P, tri, nb), creaseMask(P, I, nb), adj));
  const out = { P, E, report: R, A, dT };
  return out;
}

// ---------------------------------------------------------------- the ladder: bone | + muscle | + fat | skin (bind positions + a class each)
// layerSurfaces(..) -> { head: vertex ids, bone, muscle, fat (Float32Array n*3, bind m), cls (Uint8Array: 0 bone, 1 teeth, 2 globe, 3
// cartilage), mus (0..1 muscle share at the muscle surface), comp (the dominant fat compartment index, -1 none), deep (0..1 deep share) }
export function layerSurfaces(F, P, E, ctx, spec, A, dT) {
  const { nb, tri } = ctx, I = F.ids, T = F.pop.tissue, sites = FT.sitePoints(A).map(([k, q]) => [k, q, FT.siteDepth(T, k, spec.sex, spec.age, spec.bmi) ?? 5]);
  const N = vnorm(P, tri, nb); for (let it = 0; it < 6; it++) { const adj = ctx.adj; const N2 = Float32Array.from(N); for (let v = 0; v < nb; v++) { const a = adj[v]; if (!a) continue; for (let k = 0; k < 3; k++) { let s = N[v * 3 + k]; for (const u of a) s += N[u * 3 + k]; N2[v * 3 + k] = s; } const l = Math.hypot(N2[v * 3], N2[v * 3 + 1], N2[v * 3 + 2]) || 1; for (let k = 0; k < 3; k++) N2[v * 3 + k] /= l; } N.set(N2); }
  const H = headSet(A, P, nb), G = globes(E, ctx.side), LIG = { 1: FT.ligaments(A, 1), [-1]: FT.ligaments(A, -1) };
  const st = { sex: spec.sex, age: spec.age, bmi: spec.bmi, z: spec.zL };
  const n3 = P.length, bone = new Float32Array(P), mus = new Float32Array(P), fat = new Float32Array(P), cls = new Uint8Array(nb), musK = new Float32Array(nb), comp = new Int8Array(nb).fill(-1), musDom = new Int8Array(nb).fill(-1), deep = new Float32Array(nb), Dv = new Float32Array(nb), Mv = new Float32Array(nb), Sv = new Float32Array(nb);
  const sto = A.lm('sto'), prn = A.lm('prn'), rhi = A.lm('rhi'), half = Math.abs(A.side('ch', 1)[0] - A.side('ch', -1)[0]) / 2;
  const fatKeys = FT.LAYERS.map((L, i) => [L, i]).filter(([L]) => L.layer !== 'muscle');
  for (const v of H.list) { const p = at(P, v), q = A.toMm(p); let D = FT.depthAt(A, sites, q) + (dT ? dT[v] : 0), c = 0;
    const sk = FT.skinAt(A, q, spec.age);
    // the globe under the lids: the deep surface is the globe's
    for (const g of Object.values(G)) { const r = Math.hypot(p[0] - g.c[0], p[1] - g.c[1], p[2] - g.c[2]) * 1000, R = g.R * 1000; if (r < R + 7 && p[2] > g.c[2] - 0.002) { const k = sst(R + 7, R + 3, r); D = D * (1 - k) + Math.max(0.6, r - R) * k; if (k > 0.5) c = 2; } }
    // the cartilaginous nose (below the rhinion, in front of the face) and the lips over the teeth
    const nose = (q[1] < rhi[1] - 2 * A.s && q[1] > A.lm('sn')[1] - 1 * A.s && Math.abs(q[0]) < 18 * A.s && q[2] > A.lm('sn')[2] - 8 * A.s) ? sst(A.lm('sn')[2] - 8 * A.s, A.lm('sn')[2] - 2 * A.s, q[2]) : 0;
    if (nose > 0) { D = D * (1 - nose) + (sk + 0.8) * nose; if (nose > 0.5) c = 3; }
    // the lips (orbicularis oris over the teeth): the skeleton layer shows the teeth there (the lips hidden), the muscle layer the lips
    const lipW = Math.exp(-0.5 * ((q[0] / (half + 3 * A.s)) ** 2 + ((q[1] - sto[1]) / (9 * A.s)) ** 2)); if (lipW > 0.5 && q[2] > sto[2] - 16 * A.s) c = 1;
    // the ears (cartilage under ~1 mm of skin)
    for (const sg of [1, -1]) { const t = A.side('t', sg); if (Math.sign(q[0]) === sg && Math.abs(q[0]) > Math.abs(t[0]) - 7 * A.s && Math.hypot(q[1] - t[1], q[2] - t[2]) < 34 * A.s) { D = sk + 0.6; c = 3; } }
    D = Math.max(D, sk + 0.4);
    // the mouth's inside (the oral lining's normals face the cavity: an offset along them would push it out through the cheek): hidden
    { const hc = [0, -45 * A.s, -70 * A.s], o2 = [q[0] - hc[0], q[1] - hc[1], q[2] - hc[2]], nn = N[v * 3] * o2[0] + N[v * 3 + 1] * o2[1] + N[v * 3 + 2] * o2[2];
      if (nn < 0 && Math.abs(q[1] - sto[1]) < 22 * A.s && Math.abs(q[0]) < half + 22 * A.s) { cls[v] = 4; Dv[v] = 0; Mv[v] = 0; Sv[v] = 0; continue; } }
    let m = 0, fs = 0, fd = 0, best = 0, bestM = 0;
    for (const L of FT.LAYERS) for (const sg of [1, -1]) { if (L.shape.length < 2 && sg < 0) continue; if (L.shape.length > 1 && Math.sign(q[0] || 1) !== sg && Math.abs(q[0]) > 6 * A.s) continue;
      const t = FT.layerThickness(L, A, q, sg, st, LIG[sg]); if (!t) continue; if (L.layer === 'muscle') { m += t; if (t > bestM) { bestM = t; musDom[v] = FT.LAYERS.indexOf(L); } } else { if (L.layer === 'deep') fd += t; else fs += t; if (t > best) { best = t; comp[v] = FT.LAYERS.indexOf(L); } } }
    if (c === 2 || c === 3) m = 0; if (c === 1) { m = Math.max(0, D - sk - 0.3); musDom[v] = FT.LAYERS.findIndex(L => L.key === 'orbOris'); }
    m = Math.min(m, Math.max(0, D - sk - 0.3)); musK[v] = clamp(m / 2.5); deep[v] = fd / Math.max(1e-6, fd + fs);
    Dv[v] = Math.min(D, 15); Mv[v] = m; Sv[v] = sk; cls[v] = c; }
  // the depth field smoothed over the head (offsets along diverging normals fold where the depth jumps: the cheek over the oral cavity)
  for (let it = 0; it < 4; it++) { const D2 = Float32Array.from(Dv); for (const v of H.list) { if (cls[v] === 2 || cls[v] === 4) continue; const a = ctx.adj[v]; if (!a) continue; let s = 0, c = 0; for (const u of a) { s += Dv[u]; c++; } D2[v] = 0.5 * Dv[v] + 0.5 * s / c; } Dv.set(D2); }
  for (const v of H.list) { if (cls[v] === 4) continue; const p = at(P, v), D = Math.max(Dv[v], Sv[v] + 0.4), m = Math.min(Mv[v], Math.max(0, D - Sv[v] - 0.3));
    for (let a = 0; a < 3; a++) { bone[v * 3 + a] = p[a] - D * 0.001 * N[v * 3 + a]; mus[v * 3 + a] = p[a] - (D - m) * 0.001 * N[v * 3 + a]; fat[v * 3 + a] = p[a] - Sv[v] * 0.001 * N[v * 3 + a]; } }
  return { head: Int32Array.from(H.list), bone, muscle: mus, fat, cls, mus: musK, musDom, comp, deep, names: FT.LAYERS.map(L => L.key) };
}

// ---------------------------------------------------------------- 6. expression from our muscles
// smileField(F, P, ctx, spec, A) -> { D: Float32Array(n*3) bind deltas for ONE unit, corner: { dy, dx } mm a unit }: zygomaticus major (the
// modiolus pulled toward its origin on the zygoma; the lips follow the corner, the upper more than the lower; the cheek's fat bunched over
// the nasolabial line), + `duchenne` x orbicularis oculi (the lower lid raised, the infraorbital fat bunched). unitMm: the modiolus' travel a unit.
export function smileField(F, P, ctx, spec, A, unitMm = 8) {
  const { nb, n, tri } = ctx, I = F.ids, D = new Float32Array(n * 3), N = vnorm(P, tri, nb), H = headSet(A, P, nb), sto = A.lm('sto');
  const half = Math.abs(A.side('ch', 1)[0] - A.side('ch', -1)[0]) / 2, dk = spec.expr?.duchenne ?? 0.5;
  const sides = [1, -1].map(sg => { const ch = A.side('ch', sg), M = [ch[0] + sg * 4 * A.s, ch[1] + 0.5 * A.s, ch[2] - 3 * A.s], O = [A.side('mal', sg)[0] + sg * 7 * A.s, A.side('mal', sg)[1] + 9 * A.s, A.side('mal', sg)[2] - 6 * A.s];
    const u = [O[0] - M[0], O[1] - M[1], O[2] - M[2]], l = Math.hypot(...u); return { sg, ch, M, O, u: u.map(x => x / l), len: l, lig: FT.ligaments(A, sg), pi: A.side('pi', sg) }; });
  for (const v of H.list) { const q = A.toMm(at(P, v)); const S = sides[q[0] >= 0 ? 0 : 1], sg = S.sg;
    // the perioral pull: Gaussian round the modiolus, carried along the muscle toward its origin (fading), the lips by |x| / half
    const dM = Math.hypot(q[0] - S.M[0], (q[1] - S.M[1]) * 1.15, q[2] - S.M[2]), wM = Math.exp(-0.5 * (dM / (11 * A.s)) ** 2);
    const tAlong = clamp(((q[0] - S.M[0]) * S.u[0] + (q[1] - S.M[1]) * S.u[1] + (q[2] - S.M[2]) * S.u[2]) / S.len), dLine = FT.segDist(q, S.M, S.O), wL = Math.exp(-0.5 * (dLine / (7 * A.s)) ** 2) * (1 - tAlong) * 0.8;
    const lipZone = Math.exp(-0.5 * ((q[1] - sto[1]) / (9 * A.s)) ** 2) * sst(0, 1, Math.abs(q[0]) / half) ** 1.2, inMouth = Math.abs(q[0]) < half * 1.15 ? lipZone : 0;
    let w = Math.max(wM, wL, inMouth * 0.95); if (w < 1e-3) continue;
    // the lower lip and chin follow the corner less upward (the depressors hold it)
    const lower = q[1] < S.ch[1] - 1 * A.s ? sst(0, 8 * A.s, S.ch[1] - q[1]) : 0, up = 1 - 0.55 * lower;
    const dx = unitMm * S.u[0] * w, dy = unitMm * S.u[1] * w * up, dz = unitMm * S.u[2] * w;
    // the cheek's mass bunched (forward and up) between the modiolus and the zygoma, cut at the nasolabial line on its medial side
    const B = FT.shapeAt({ k: 'blob', c: [S.M[0] * 0.55 + S.O[0] * 0.45 + sg * 2 * A.s, S.M[1] * 0.55 + S.O[1] * 0.45, S.M[2] * 0.55 + S.O[2] * 0.45 + 2 * A.s], r: [11 * A.s, 10 * A.s, 10 * A.s] }, q);
    const dNL = FT.polyDist(q, S.lig.nl.pts), medial = (Math.abs(q[0]) < Math.abs(S.ch[0]) + 3 * A.s && q[1] < S.lig.nl.pts[0][1]) ? 1 : 0;
    const bul = 0.26 * unitMm * B * (1 - Math.exp(-0.5 * (dNL / (2.6 * A.s)) ** 2)) * (medial ? 0.15 : 1);
    // orbicularis oculi (the Duchenne share): the lower lid up, the fat under it bunched
    const dE = Math.hypot((q[0] - S.pi[0]) / 13, (q[1] - (S.pi[1] - 4 * A.s)) / 6, (q[2] - S.pi[2]) / 8) / A.s, wE = dk * Math.exp(-0.5 * dE * dE);
    const k = 0.001 * H.w[v];
    D[v * 3] += k * (dx + bul * N[v * 3]); D[v * 3 + 1] += k * (dy + bul * N[v * 3 + 1] + 0.12 * unitMm * B + 1.3 * wE); D[v * 3 + 2] += k * (dz + bul * N[v * 3 + 2] + 0.6 * wE * N[v * 3 + 2]); }
  // keep the lids' margins clear of the globe: the upper lid does not move; the lower lid's rise is capped by the lid line's own field
  const ups = new Set(); for (const s of ['L', 'R']) for (const v of F.lid?.[s] || []) { const cy = (F.lid[s] || []).reduce((a, u) => a + P[u * 3 + 1], 0) / (F.lid[s] || [1]).length; if (P[v * 3 + 1] > cy) ups.add(v); }
  for (const v of ups) D[v * 3] = D[v * 3 + 1] = D[v * 3 + 2] = 0;
  const cy = 1000 * (0.5 * (D[I.ch_L * 3 + 1] + D[I.ch_R * 3 + 1]) - D[I.sto * 3 + 1]), cx = 1000 * 0.5 * (D[I.ch_L * 3] - D[I.ch_R * 3]);
  return { D, corner: { dy: +cy.toFixed(2), dx: +cx.toFixed(2) } };
}
const tiltOf = (P, I) => (0.5 * (P[I.ch_L * 3 + 1] + P[I.ch_R * 3 + 1]) - P[I.sto * 3 + 1]) * 1000;
// the rest / expression kinds: neutral 0; rest: the corners a tone x `rest` mm up (capped `cap` over the stomion); smile / smile2: + mm
export function face6Expr(F, P0, ctx, spec, field) {
  const I = F.ids, P = new Float32Array(P0), ex = spec.expr, R = { kind: ex?.kind || 'neutral' };
  if (!ex || ex.kind === 'neutral' || !field) { R.w = 0; R.tilt = +tiltOf(P, I).toFixed(2); return { P, report: R }; }
  const t0 = tiltOf(P, I), per = Math.max(0.5, field.corner.dy);
  const base = Math.max(t0, ex.base ?? (spec.sex === 'm' ? 0.6 : 1.0));   // the level rest (MOUTH's minTilt: the corners 0.5-1.5 mm over the stomion)
  const want = ex.kind === 'smile2' ? base + ex.smile2 : ex.kind === 'smile' ? base + ex.smile : Math.min(ex.cap, base + ex.rest * ex.tone);
  const w = clamp((want - t0) / per, 0, 1); for (let i = 0; i < Math.min(P.length, field.D.length); i++) P[i] += w * field.D[i];
  Object.assign(R, { tone: ex.tone, w: +w.toFixed(3), perUnit: field.corner, tilt0: +t0.toFixed(2), tilt: +tiltOf(P, I).toFixed(2) });
  return { P, report: R };
}

// ---------------------------------------------------------------- 7. seating: the lids over the globe, the lips over the teeth
// the lid margins (FACE P2's loops) against the globe: gap = distance from the globe's centre - R - lid thickness at the margin (mm);
// the loop's vertices floating more than gapMax over the globe are pulled in, any inside it pushed out; the lid skin round them follows
// (EYES-FIX, 16 Oct) only where the eye is under the margin, nasally: a margin vertex nasal of the globe's silhouette is the medial commissure
// (its tendon holds it off the globe, over the caruncle: face9 anatomy/head/membrane.js canthalTendons) and is left; pulled radially it went
// toward the axis. The lateral one is still seated: its tendon holds it against the globe (face7.js face7Seat: the same, and why)
export function seatLids(F, P0, E, side, ctx, spec) {
  const P = new Float32Array(P0), G = globes(E, side), R = { before: {}, after: {}, moved: 0 }, o = spec.seat || {}, inMax = (o.inMax ?? 1.0) / 1000, outMax = (o.outMax ?? 1.2) / 1000;
  // the VISIBLE margin: the loop's vertices outside R - 2 mm (the rest of P2's loop is the lid's inner, conjunctival fold behind the globe)
  const vis = (s, g) => (F.lid?.[s] || []).filter(v => Math.hypot(P[v * 3] - g.c[0], P[v * 3 + 1] - g.c[1], P[v * 3 + 2] - g.c[2]) > g.R - 0.002);
  const gapOf = (s, g) => { const L = vis(s, g); if (!L.length) return null; let mn = Infinity, mx = -Infinity, sum = 0; for (const v of L) { const r = Math.hypot(P[v * 3] - g.c[0], P[v * 3 + 1] - g.c[1], P[v * 3 + 2] - g.c[2]) - g.R; mn = Math.min(mn, r); mx = Math.max(mx, r); sum += r; }
    return { n: L.length, min: +(mn * 1000).toFixed(2), max: +(mx * 1000).toFixed(2), mean: +(sum / L.length * 1000).toFixed(2) }; };
  for (const [s, g] of Object.entries(G)) R.before[s] = gapOf(s, g);
  // gross errors only: a visible margin vertex sunk more than inMax into the globe comes out to -0.3 mm; one floating more than outMax off
  // it comes in to +0.6 mm (radially); the lid skin within ~4 mm follows (a Gaussian)
  if (o.lids) for (const [s, g] of Object.entries(G)) { const corr = new Map();
    for (const v of vis(s, g)) { const p = at(P, v), dv = [p[0] - g.c[0], p[1] - g.c[1], p[2] - g.c[2]], r = Math.hypot(...dv), gap = r - g.R;
      const want = gap < -inMax ? -0.0003 : gap > outMax ? 0.0006 : gap; if (Math.abs(want - gap) < 1e-6) continue;
      if (dv[0] * g.c[0] < 0 && Math.hypot(dv[0], dv[1]) >= g.R + want) continue;   // nasal of the globe's silhouette: the medial commissure, left where its tendon holds it
      corr.set(v, dv.map(x => x / r * (want - gap))); }
    if (!corr.size) continue;
    const C = [...corr.entries()].map(([v, d]) => [at(P0, v), d]), ring = new Set(F.lid?.[s] || []);
    // (the loop's own vertices take only their own correction: a neighbour's pull sank L05's margin 1.8 mm)
    for (let v = 0; v < ctx.nb; v++) { if (ring.has(v)) continue; const p = at(P0, v); if (Math.hypot(p[0] - g.c[0], p[1] - g.c[1], p[2] - g.c[2]) > g.R + 0.012) continue;
      let wx = 0, wy = 0, wz = 0, ws = 0; for (const [c, d] of C) { const e = ((p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2) / (0.0022 ** 2); if (e > 16) continue; const k = Math.exp(-0.5 * e); wx += k * d[0]; wy += k * d[1]; wz += k * d[2]; ws += k; }
      if (ws > 1e-3) { const f = Math.min(1, ws) / ws; P[v * 3] += wx * f; P[v * 3 + 1] += wy * f; P[v * 3 + 2] += wz * f; } }
    for (const [v, d] of corr) for (let a = 0; a < 3; a++) P[v * 3 + a] += d[a];
    R.moved += corr.size; }
  for (const [s, g] of Object.entries(G)) R.after[s] = gapOf(s, g);
  R.globe = Object.fromEntries(Object.entries(G).map(([s, g]) => [s, +(g.R * 1000).toFixed(2)]));
  return { P, report: R };
}
// the lips' cover over the incisors at the midline (mm: the upper lip at labrale superius and the lower at labrale inferius, to the most
// forward tooth point below / above them) and the teeth that stand in front of the lip surface (should be none)
export function teethRead(F, P, teeth, A) {
  if (!teeth?.length) return null; const I = F.ids, ls = A.toMm(at(P, I.ls)), li = A.toMm(at(P, I.li)), sto = A.toMm(at(P, I.sto));
  let zu = -1e9, zl = -1e9; for (const v of teeth) { const q = A.toMm(at(P, v)); if (Math.abs(q[0]) > 5) continue; if (q[1] > sto[1] - 1 && q[2] > zu) zu = q[2]; if (q[1] < sto[1] + 1 && q[2] > zl) zl = q[2]; }
  return { upper: +(ls[2] - zu).toFixed(2), lower: +(li[2] - zl).toFixed(2) };
}

// ---------------------------------------------------------------- the lips: OUR form (orbicularis oris' rolls over the dental arch)
// lipProfile(F, P, src) -> per column (u = |x| / half: 0, 0.3, 0.6) the front surface's profile through the lips (MOUTH's frame and height
// map, mm): the upper roll's crest (its height over the meeting line and its depth ahead of it: the groove), the lower roll's, the sulcus'
// depth behind the lower crest. The same read on the scans and on ours: the scans MEASURE what our form must reach (no scan shape is used).
export async function lipProfile(F, P, src) {
  const MO = await import('./mouth.js'), M = MO.mouthFrame(F, P, src.nb, src.ao, src.tri), hm = MO.heightMap(M, P, src.tri, src.nb), out = {};
  for (const u of [0, 0.3, 0.6]) { const rows = []; for (const sg of [1, -1]) { const x = sg * Math.max(0.6, u * M.half), y0 = M.ym(x);
      const zAt = h => hm.at(x, y0 + h), zl = Math.min(...[-0.5, -0.25, 0, 0.25, 0.5].map(zAt).filter(Number.isFinite));
      let cU = null, cL = null; for (let h = 0.5; h <= 12; h += 0.25) { const z = zAt(h); if (Number.isFinite(z) && (!cU || z > cU[1])) cU = [h, z]; }
      for (let h = -0.5; h >= -14; h -= 0.25) { const z = zAt(h); if (Number.isFinite(z) && (!cL || z > cL[1])) cL = [h, z]; }
      let sul = null; if (cL) for (let h = cL[0] - 1; h >= cL[0] - 14; h -= 0.25) { const z = zAt(h); if (Number.isFinite(z) && (!sul || z < sul[1])) sul = [h, z]; }
      if (cU && cL && Number.isFinite(zl)) rows.push({ hU: cU[0], gU: cU[1] - zl, hL: -cL[0], gL: cL[1] - zl, sulcus: sul ? cL[1] - sul[1] : null, sulH: sul ? -sul[0] : null }); }
    const m = k => rows.length ? +(rows.reduce((a, r) => a + (r[k] ?? 0), 0) / rows.length).toFixed(2) : null;
    out[u] = { hU: m('hU'), gU: m('gU'), hL: m('hL'), gL: m('gL'), sulcus: m('sulcus'), sulH: m('sulH') }; }
  return out;
}
// the form's numbers by sex: measured on the seven closed-mouth HSRD-100 heads with lipProfile (face6_test.mjs 'lip form'), mm, at the
// midline and at 0.3 / 0.6 of the half-width; crests as fractions of the person's vermilion heights (uv, lv) at the scans' mean heights
export const LIP_FORM = {
  // the seven closed-mouth heads (5 women: HSR0015, 0027, 0028, 0112 + 0102 open -> 4 + ...; see face6_test 'lip form'), per sex, midline:
  // women: the upper crest AT the border (h 8.35 mm, uv 7.28), the meeting line 4.78 mm behind it; the lower crest 5.22 mm under the line
  // (0.62 lv), 2.65 mm ahead of it; the sulcus 4.2 mm behind the lower crest. Men: 6.9 / 5.9; 6.4 / 6.1 (HSR0161's full lips; 4.1 without)
  f: { U: { c: 1.0, g: 4.8, p: 1.35 }, L: { c: 0.62, g: 2.65 }, uv: 7.28, lv: 8.44 },
  m: { U: { c: 0.95, g: 5.6, p: 1.35 }, L: { c: 0.62, g: 3.6 }, uv: 8.69, lv: 9.7 },
  k: 0.8,   // the groove at 0.8 of the scans' depth: on our lip sheets (no inner mucosa) the full depth read as a parted, pouting mouth in clay
  src: 'OUR two-roll form (orbicularis oris\' marginal and peripheral parts over the incisors), its numbers measured on the closed-mouth HSRD-100 heads (CC BY 4.0) with lipProfile: measurement only, no scan geometry is transferred',
};
// lipResidual(F, P, sets, M, spec6, mspec, ao) -> MOUTH's residual contract { r: Map v -> [dx, dy, dz] frame mm, used, lipScale }: the
// outer lip vertices moved in depth only, each column to our two-roll form: upper z = crest - g_U ((h - c_U)/c_U)^2 (the crest at
// c_U, the groove g_U deep at the meeting line, falling back under the border), lower likewise; the crest's own depth per column is the
// person's (MOUTH's depth hold keeps it), so the transverse arc over the teeth stays the person's (FACE4's); the philtral columns as two
// low ridges over the bow's peaks
export function lipResidual(F, P, sets, M, form, mspec, ao) {
  const r = new Map(), cols = new Map(), half = M.half;
  const loc = new Map(sets.outer.map(v => [v, M.loc(v)]));
  for (const v of sets.outer) { const q = loc.get(v), up = ao[v * 3 + 1] > -0.004, h = q[1] - M.ym(q[0]); const key = (up ? 'U' : 'L') + Math.round(q[0] / 1.5);
    const c = cols.get(key) || { z: -1e9, n: 0 }; if ((up ? h > 0 && h < mspec.uv * 1.2 : h < 0 && h > -mspec.lv * 1.2) && q[2] > c.z) c.z = q[2]; c.n++; cols.set(key, c); }
  for (const v of sets.outer) { const q = loc.get(v), up = ao[v * 3 + 1] > -0.004, h = q[1] - M.ym(q[0]), u = Math.min(1, Math.abs(q[0]) / half);
    const c = cols.get((up ? 'U' : 'L') + Math.round(q[0] / 1.5)); if (!c || c.z < -1e8) continue;
    const taper = Math.pow(Math.max(0, 1 - u ** 4), 0.5), H = up ? mspec.uv * Math.max(0.25, Math.pow(Math.max(0, 1 - Math.pow(u, 2.2)), 0.7)) : mspec.lv * Math.max(0.25, Math.pow(Math.max(0, 1 - u * u), 0.55));
    const f = up ? form.U : form.L, hc = f.c * H, g = Math.min(5.0, (form.k ?? 0.8) * f.g * (H / Math.max(1, up ? form.uv : form.lv)) * taper), hh = Math.abs(h);
    if (hh > H + 1.5) continue;
    // the upper roll: from the crest at the border down to the meeting line, convex (p > 1: the roll's front, then the fall into the
    // groove); the lower roll: a parabola about its crest, back toward the line and down toward the sulcus
    const zt = up ? (hh <= hc ? c.z - g * Math.pow(1 - hh / Math.max(0.3, hc), f.p ?? 1.6) : c.z - 0.3 * ((hh - hc) / 1.5) ** 2)
      : (hh <= hc ? c.z - g * ((hh - hc) / Math.max(0.3, hc)) ** 2 : c.z - 0.5 * g * ((hh - hc) / Math.max(0.5, H - hc)) ** 2), w = 1 - sst(H, H + 1.5, hh);
    let dz = (zt - q[2]) * w; dz = Math.max(-3, Math.min(3, dz));
    r.set(v, [0, 0, dz]); }
  return { r, used: ['ours'], lipScale: 0.5 * (mspec.uv + mspec.lv) };
}
