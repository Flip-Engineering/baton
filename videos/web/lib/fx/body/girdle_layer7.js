// BODY / GIRDLE LAYER 7 (HUMAN c8 round 7, BODY7 c3 iterations 2, 8 and 9, 8-9 Oct 2026): THE NECK BASE AND THE SHOULDER GIRDLE'S SURFACE FROM THE BONES OUT.
// Ours, CC0. Node-side (the export and the clay job); the page never runs it (the skeleton costs ~10-20 s a person, the layer ~1 s).
//
// WHY. Beside the photographs the neck base and the shoulder girdle broke every plate of the latest person (the critic, c3 it1): ropy, lumpy relief
// on the men's necks, a gully from the ear to the notch, an incision where the pectoral meets the deltoid, and no clavicle, no supraclavicular
// hollow, no sternal notch on anyone. Those forms came from the detail tier's GIRDLE (body/detail.js): curves put at hm08's landmarks with TYPED
// amplitudes (the jugular notch a 5.5 mm dent, the clavicle a 3.2 mm ridge, the fossa a 4.5 mm dent, the SCM a 2.8 mm band ...) and the
// half-maximum re-shaping of lane A's fitted muscle BLOBS (the pectoral's, deltoid's, upper trapezius' and SCM's half-maximum contours made into
// crisp edges: a blob's contour is not a muscle's border, so the edges land where no anatomy is). A system that guesses forms at landmarks
// cannot be right for everyone it makes.
//
// WHAT THIS DOES INSTEAD (GIRDLE_LAYER7_VERSION 3, c3 iteration 8, and 4 below; for anyone the system makes; nothing per person, nothing fitted to a render
// or a photograph):
//  1. the person's own girdle BONES: ANAT8-BODY's skeleton built on this person's prior body (lib/fx/anatomy/skeleton): the clavicle as a bone
//     with its S-curve from the SC joint to the AC, the manubrium with its clavicular heads, the scapula's spine and acromion. They are the
//     subcutaneous structures of the region, and they are REGISTERED to this skin (placed from the rig's joints, the sternum from the skin's own
//     suprasternale minus its tissue). Each is covered by the bone site's skin and fat (skin 1.5 mm + fat by sex, x (pf / ref)^1.2: ANAT8's
//     convention, muscle/index.js FATREF);
//  2. over a FLOOR that is anatomy, not data: below the clavicle the pectoralis major lies straight under the site's fat (the floor = the fat's
//     depth: the chest keeps its own form), behind it the trapezius does the same, the shoulder's cap the deltoid; above the clavicle and in front
//     of the trapezius (the supraclavicular fossa, the posterior triangle, the notch's upper part) the floor is GL7.deepNeck deeper (the fat pad
//     over the scalenes and the trachea). The envelope depth under each skin vertex is E = smax(E_bone, floor): a bone stands out where it comes
//     nearer the skin than the floor; the floor varies smoothly with the position against the clavicle (no gates, nothing filled);
//  3. its FORMS, not its bulk: E band-passed on the skin (a difference of Gaussians: the fat's bridging scale, sigma = GL7.sigF0 + sigFk x the
//     site's thickness, minus the 2 cm mean, GL7.sigL): the clavicle's crest, the hollows above and below it, the manubrium's edge. The skin keeps
//     its own macro form (BODY7's prior: ANSUR, NHANES, the photographs' widths) and its own band outside [sigF, sigL];
//  4. the detail tier's typed girdle forms (detail.Dg3: the curves clavicle, fossae, SCM band, deltopectoral groove and sternum line, and the
//     half-maximum re-shaping of the SCM, upper trapezius, pectoral and deltoid blobs) are TAKEN OUT over the same region, the bones' relief put
//     in, along the skin's normal (bind), into girdle7's saved copy as well (a later girdleReset7 keeps it), the normals rebuilt. The jugular
//     notch and the SC joints stay as the detail tier makes them: point forms at the skin's own landmarks, which these coarse bones do not resolve.
// The region: the neck (hero region 1), the upper trunk and the shoulder caps (2, 3) from ~10 cm under the notch to 12 cm over it, out past the
// AC, fading over 3 cm; skin facing down (the axilla) and the arm under the cap are left out. The breast, the face and the rest are untouched.
//   girdleLayer7(P, { name, register })   the soft-hook signature (makePerson's soft slot, ANAT8-BODY's and not landed: the A/B route for the farm,
//                                          popts { soft: { module: 'body/girdle_layer7.js', fn: 'girdleLayer7' } }); the figure study only
// TRIED AND DROPPED (node, c3 it8; ~/.cache/acp_human/body7_scratch/c3i8): v1-v2, ANAT8's girdle MUSCLES in the envelope (parts: 'all', kept as
// an option): ANAT8's SCM and trapezius stand 5-15 mm OUT of this skin and its pectoral and deltoid sheets lie inclined to it, so their band-pass
// put +-5-8 mm stripes down the neck and bands across the chest (v1 also folded the axilla: 18 edges over 60 deg); a deep floor under them
// (v3a) made steps where the gate flipped (61 edges over 60 deg). The muscles' relief waits for a muscle layer registered to the skin.
// v4 (c3 iteration 9): THE GIRDLE MUSCLES BY THEIR THICKNESS. ANAT8's muscles stand 5-30 mm off this skin (its SCM at the skin, its pectoral's
// clavicular head ~3 cm under it), so they cannot be placed by position (v1-v2); they are READ along the skin's normal: the thickness of the
// superficial girdle muscles' union crossed by the normal line (2 x the line's deepest point inside them: a sheet's true thickness at any
// incidence), registration-free. Their PRESENCE (a border, a gap; not their interior thickness, which in ANAT8's faceted sheets is not anatomy)
// sinks the covered muscle layer by the local sheet's own thickness where they stop: the posterior triangle behind the SCM, the supraclavicular
// fossa, the sternal valley between the pectorals, the deltopectoral border. ONE reference depth (the chest's fat) for the layer (no switch between
// fat sites at a plane); the floor's constant deepNeck GONE (the hollows are the muscles' absence). The SCM's two heads (ANAT8 builds them apart up
// the neck) are bound in one sheath: their presence closed over the skin (GL7.scmClose). The ANTERIOR TRIANGLE is filled (the larynx, trachea,
// thyroid and strap muscles, which no layer builds yet): no sink medial to the SCM's footprint above the notch. hm08's head region on the neck
// (most of it) joins the layer behind the chin's plane. The relief never folds the skin it edits (GL7.foldGuard: withdrawn where an edge turns
// over 60 deg and 30 deg sharper than with the typed forms out). muscles: false = v3 (the A/B while v4 is measured).
// What it does NOT do (said plainly): no larynx or thyroid (the anterior neck is held, not built), no platysma, no age forms of the neck
// (platysmal bands, necklace lines); the muscles' interior form (the SCM's belly, the trapezius' slope) is the prior body's own, only their
// borders come from ANAT8; ANAT8's muscles are taken as they are (their heads' course, their extent).
import { girdleSaved7, girdleBindEdit7 } from './girdle7.js';
export const GIRDLE_LAYER7_VERSION = 4;
export const GL7 = {
  sigL: 0.022,       // the band-pass: the Gaussian whose mean is taken out (m): forms narrower than ~4 sigL stay
  reach: 0.03,       // |phi| beyond which a skin vertex has no structure under it (m)
  dot0: 0.35, dot1: 0.75,   // the envelope's gradient . the skin normal: the structure is UNDER the skin (not beside it)
  sigF0: 0.0025, sigFk: 0.6,   // the fat's bridging blur: sigma = sigF0 + sigFk x the site's subcutaneous thickness (m)
  kBlend: 0.004, kFat: 0.5,    // the smooth union's radius: kBlend + kFat x the mean site thickness
  skin: 0.0015,      // the skin's own thickness (m)
  // the site's subcutaneous fat at ANAT8's reference body fat (men 18 %, women 28 %), mm: the clavicle, sternum and acromion lie under skin and a
  // thin layer; the chest and deltoid from FATREF (muscle/index.js); the upper trapezius between the deltoid and subscapular sites; the neck thin
  fat: { bone: { m: 2.5, f: 3.5 }, pectoral: { m: 6, f: 8 }, deltoid: { m: 5, f: 8 }, trapU: { m: 6, f: 8 }, trapM: { m: 9, f: 11 }, scm: { m: 3, f: 4 } },
  yLo: 0.075, yHi: 0.12, xOut: 0.05, fade: 0.03,   // the region round the jugular notch (m below / above it, out past the AC) and its fade
  maxMm: 9,          // a guard, not a shape: |relief| over this is reported (a fault to read), never clipped silently
  deepNeck: 0.006,   // v3 only (muscles: false): the floor's extra depth above the clavicle and in front of the trapezius (m); v4 has the muscles' own absence there
  parts: 'bone',     // the envelope's POSITIONED parts: 'bone' (the clavicles, the manubrium and its clavicular heads, the scapula's acromion) | 'all' (+ ANAT8's girdle
                     // muscles by position: dropped in v2, their positions are not this skin's)
  // v4: THE GIRDLE MUSCLES BY THEIR THICKNESS (registration-free): ANAT8's superficial girdle muscles (the SCM's two heads, the trapezius' upper and
  // middle parts, the pectoralis major's two heads, the deltoid's three) read on this skin as the thickness of their union crossed by the skin's
  // normal line (2 x the deepest point of the line inside them: a sheet's true thickness at any incidence); the muscle layer's top lies the
  // site's fat under the skin where the local sheet is at its own thickness (tauCap: its Gaussian mean where there is muscle) and sinks by what
  // it lacks where it thins or stops (a border, a gap between two muscles: the posterior triangle, the supraclavicular fossa). muscles: false = v3
  // (the floor's constant deepNeck above the clavicle in place of the muscles): the one A/B switch while v4 is measured.
  muscles: true,
  musc: /^(scmSternal|scmClavicular|trapeziusUpper|trapeziusMiddle|pectoralisClav|pectoralisStern|deltoidAnterior|deltoidMiddle|deltoidPosterior)\./,
  tauOut: 0.03, tauIn: 0.05, tauStep: 0.0015,   // the normal line marched from 3 cm out to 5 cm in, 1.5 mm steps (m)
  tauMin: 0.0005,    // a vertex counts as over muscle (for tauCap's mean) with tau over this (m)
  scmK: 0.01,        // the SCM's two heads' smooth union (m): the investing fascia binding them into one belly
  scmClose: 0.012,   // the SCM's presence closed over the skin (m): gaps up to ~2 x this between its heads are the model's, filled
  pres0: 0.15, pres1: 0.6,   // the muscle's presence over a skin vertex: tau from pres0 to pres1 of the local sheet's own thickness (tCap)
  foldGuard: true, foldDeg: 60, foldJump: 30,   // v4: the edit withdrawn where it turns an edge over 60 deg and 30 deg sharper than as built
  fillW: 0.006,      // the soft edge (m) of the anterior triangle's fill (the viscera under the strap muscles) medial to the SCM's footprint
  neckZ: 0.03, neckNy: -0.6,   // hm08's head region (most of the neck) joins the layer behind the chin's plane (z under Jn + neckZ) and not facing down (the jaw's underside)
  nyDown0: -0.55, nyDown1: -0.25,   // the skin facing down (normal y under these) is left out: the axilla, the arm's underside
  armLo: 0.035,      // the arm's skin only above this (m) under the notch: the deltoid's cap, not the arm under the axilla
};
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const SITE = [[/^clavicle\./, 'bone'], [/^sternum$/, 'bone'], [/^scapula\./, 'bone'], [/^scm/, 'scm'], [/^trapeziusUpper/, 'trapU'], [/^trapeziusMiddle/, 'trapM'],
  [/^pectoralis(Clav|Stern)/, 'pectoral'], [/^deltoid/, 'deltoid']];
const siteOf = name => { for (const [re, s] of SITE) if (re.test(name)) return s; return null; };

// the topology of the hero's body geometry (vertex neighbours, vertex triangles), cached per geometry
const _topo = new WeakMap();
function topoOf(g) {
  const I = g.index.array, n = g.attributes.position.count; let T = _topo.get(g); if (T && T.nI === I.length) return T;
  const deg = new Int32Array(n + 1), tdeg = new Int32Array(n + 1), seen = new Set(), E = [];
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) { const a = I[t + e], b = I[t + (e + 1) % 3], k = a < b ? a * n + b : b * n + a; tdeg[a + 1]++;
    if (seen.has(k)) continue; seen.add(k); E.push(a, b); deg[a + 1]++; deg[b + 1]++; }
  for (let v = 0; v < n; v++) { deg[v + 1] += deg[v]; tdeg[v + 1] += tdeg[v]; }
  const nb = new Int32Array(deg[n]), fill = deg.slice(0, n); for (let i = 0; i < E.length; i += 2) { const a = E[i], b = E[i + 1]; nb[fill[a]++] = b; nb[fill[b]++] = a; }
  const vt = new Int32Array(tdeg[n]), tf = tdeg.slice(0, n); for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) vt[tf[I[t + e]]++] = t / 3;
  T = { nI: I.length, off: deg, nb, toff: tdeg, vt }; _topo.set(g, T); return T;
}
function normalsAt(X, I, T, verts, out) {
  for (const v of verts) { let nx = 0, ny = 0, nz = 0;
    for (let k = T.toff[v]; k < T.toff[v + 1]; k++) { const t = T.vt[k], a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
      const ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2], wx = X[c] - X[a], wy = X[c + 1] - X[a + 1], wz = X[c + 2] - X[a + 2];
      nx += uy * wz - uz * wy; ny += uz * wx - ux * wz; nz += ux * wy - uy * wx; }
    const l = Math.hypot(nx, ny, nz) || 1; out[3 * v] = nx / l; out[3 * v + 1] = ny / l; out[3 * v + 2] = nz / l; }
}
// mesh health over a vertex set: turned triangles (against a reference), dihedral angles of the edges inside the set
export function meshHealth7(X0, X1, I, T, mark) {
  const tn = (X, t) => { const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2]; const ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2], wx = X[c] - X[a], wy = X[c + 1] - X[a + 1], wz = X[c + 2] - X[a + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, l = Math.hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l]; };
  const nT = I.length / 3, inT = new Uint8Array(nT); let turned = 0;
  for (let t = 0; t < nT; t++) if (mark[I[3 * t]] && mark[I[3 * t + 1]] && mark[I[3 * t + 2]]) { inT[t] = 1; if (X0) { const a = tn(X0, t), b = tn(X1, t); if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < 0) turned++; } }
  const ed = new Map(); for (let t = 0; t < nT; t++) if (inT[t]) for (let e = 0; e < 3; e++) { const a = I[3 * t + e], b = I[3 * t + (e + 1) % 3], k = a < b ? a + ',' + b : b + ',' + a; const l = ed.get(k); if (l) l.push(t); else ed.set(k, [t]); }
  let o30 = 0, o60 = 0, mx = 0; for (const l of ed.values()) { if (l.length !== 2) continue; const a = tn(X1, l[0]), b = tn(X1, l[1]); const ang = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 / Math.PI; if (ang > 30) o30++; if (ang > 60) o60++; if (ang > mx) mx = ang; }
  return { tris: inT.reduce((a, b) => a + b, 0), turned, over30: o30, over60: o60, maxDeg: +mx.toFixed(1) };
}

// ---------------------------------------------------------------- the person's girdle anatomy (ANAT8-BODY's skeleton and muscles; node)
export async function girdleAnatomy7(P, { muscles = GL7.parts === 'all' || GL7.muscles } = {}) {
  const p = P.p; if (!p?.built) throw new Error('girdle_layer7: no prior body (P.p.built)');
  const [K8, M8, BS] = await Promise.all([import('../anatomy/skeleton/index.js'), muscles ? import('../anatomy/muscle/index.js') : null, import('./index.js')]);
  const S0 = p._S || await BS.loadBodyStudio(), t0 = Date.now(), B = K8.bodyOf(S0, p.built, p), K = K8.buildSkeleton(B), M = muscles ? M8.buildMuscles(B, K, { rec: p, version: 2 }) : { parts: [] };
  return { K8, B, K, M, ms: Date.now() - t0 };
}
// the envelope: each girdle part covered by its site's subcutaneous layer, the smooth union; phi(x) metres (anatomy frame = hero bind x scale)
export function girdleEnvelope7(A, o = {}) {
  const K = { ...GL7, ...o }, { K8, B, K: Sk, M } = A, fem = B.sex === 'f', fk = Math.pow((B.pf ?? (fem ? 0.28 : 0.18)) / (fem ? 0.28 : 0.18), 1.2);
  const parts = Sk.parts.concat(M.parts).filter(q => siteOf(q.name) && (K.parts === 'all' || siteOf(q.name) === 'bone')).map(q => { const s = siteOf(q.name); return { q, site: s, t: K.skin + (K.fat[s][fem ? 'f' : 'm'] / 1000) * fk }; });
  const tMean = parts.reduce((a, q) => a + q.t, 0) / Math.max(1, parts.length), kb = K.kBlend + K.kFat * tMean, cut = K.reach + 0.02;
  const phi = (x, y, z) => { let d = cut, lab = -1, dmin = cut;
    for (let i = 0; i < parts.length; i++) { const r = parts[i], e = K8.sdPart(r.q, x, y, z, cut + r.t) - r.t; if (e >= cut) continue; if (e < dmin) { dmin = e; lab = i; } d = d >= cut ? e : K8.smin(d, e, kb); }
    return { d, lab }; };
  return { phi, parts, fk, kb, tMean, fem };
}

// ---------------------------------------------------------------- the layer on the hero (bind), and the hook
// v3 (c3 iteration 8): E over the floor (see the header), a difference of Gaussians on the skin, the skin facing down left out. field: the
// depth E, E over the floor (Ef), the relief before the region weight (Rf), the floor (fl), the nearest part (lab), all per vertex (m).
export function girdleRelief7(h, A, Env, { base = null, Dg3 = null, ...o } = {}) {
  const K = { ...GL7, ...o }, g = h.body.geometry, X = g.attributes.position.array, I = g.index.array, n = g.attributes.position.count, N = g.attributes.normal.array, T = topoOf(g);
  const REG = g.attributes.aHero?.array, rst = g.attributes.aHero?.itemSize || 4, sc = h.scale || 1, t0 = Date.now();
  const B0 = base || X, inTri = new Uint8Array(n); for (let i = 0; i < I.length; i++) inTri[I[i]] = 1;
  const Jn = A.K.geo?.sternum?.Jn; if (!Jn) throw new Error('girdle_layer7: no jugular notch in the skeleton');
  const acX = Math.max(Math.abs(A.K.geo.clavL?.ac?.[0] ?? 0.17), Math.abs(A.K.geo.clavR?.ac?.[0] ?? 0.17));
  // the surface the anatomy is read on: the as-built bind without the detail tier's girdle forms (they are what this replaces)
  const S = new Float64Array(3 * n); for (let i = 0; i < 3 * n; i++) S[i] = B0[i] * sc - (Dg3 ? Dg3[i] * sc : 0);
  const regOf = v => REG ? Math.round(REG[v * rst]) : 2;
  const useM = !!K.muscles && !!A.M?.parts?.some(q => K.musc.test(q.name));
  // v4: most of the neck is hm08's head region 0 (11: the jaw's): it joins the layer behind the chin's plane and where the skin does not face down
  const regOk = v => { if (!inTri[v]) return false; const r = regOf(v); if (r === 1 || r === 2 || r === 3) return true;
    return useM && (r === 0 || r === 11) && S[3 * v + 2] < Jn[2] + K.neckZ && N[3 * v + 1] > K.neckNy; };
  const zone = (v, pad) => { const x = Math.abs(S[3 * v]), y = S[3 * v + 1]; return y > Jn[1] - K.yLo - K.fade - pad && y < Jn[1] + K.yHi + K.fade + pad && x < acX + K.xOut + K.fade + pad; };
  // the region's weight: the box round the notch, the skin that faces down left out (the axilla, the arm's underside), the arm only over the cap
  const wReg = v => { const x = Math.abs(S[3 * v]), y = S[3 * v + 1]; let w = ss(Jn[1] - K.yLo - K.fade, Jn[1] - K.yLo, y) * ss(Jn[1] + K.yHi + K.fade, Jn[1] + K.yHi, y) * ss(acX + K.xOut + K.fade, acX + K.xOut, x);
    w *= ss(K.nyDown0, K.nyDown1, N[3 * v + 1]); if (regOf(v) === 3) w *= ss(Jn[1] - K.armLo - K.fade, Jn[1] - K.armLo, y); return w; };
  const pad = 2.5 * K.sigL, vs = []; for (let v = 0; v < n; v++) if (regOk(v) && zone(v, pad)) vs.push(v);
  const inZ = new Uint8Array(n); for (const v of vs) inZ[v] = 1;
  // the depth field E (the envelope's depth under the skin along the normal: + = the structure lies close under, - = deep), its validity
  const E = new Float64Array(n), val = new Float64Array(n), tLoc = new Float64Array(n), lab = new Int16Array(n).fill(-1), e = 0.001;
  for (const v of vs) { const x = S[3 * v], y = S[3 * v + 1], z = S[3 * v + 2], r = Env.phi(x, y, z); E[v] = -r.d; if (r.lab < 0 || Math.abs(r.d) >= K.reach) continue;
    const gx = Env.phi(x + e, y, z).d - Env.phi(x - e, y, z).d, gy = Env.phi(x, y + e, z).d - Env.phi(x, y - e, z).d, gz = Env.phi(x, y, z + e).d - Env.phi(x, y, z - e).d, gl = Math.hypot(gx, gy, gz) || 1;
    const dn = (gx * N[3 * v] + gy * N[3 * v + 1] + gz * N[3 * v + 2]) / gl;
    val[v] = ss(K.dot0, K.dot1, dn) * ss(K.reach, 0.6 * K.reach, Math.abs(r.d)); E[v] = -r.d; tLoc[v] = Env.parts[r.lab].t; lab[v] = r.lab; }
  // THE FLOOR (v3): the envelope models the girdle's BONES only (the clavicles, the manubrium and its clavicular heads, the scapula's spine and
  // acromion: subcutaneous, and placed from the rig's joints and the skin's own suprasternale, so they are registered to this skin); what lies
  // between them is a soft floor at a depth that is anatomy, not data: below the clavicle the pectoralis major lies straight under the site's
  // fat (the floor = the fat's depth: the chest keeps its own form), behind it the trapezius does the same, and in front of the trapezius and
  // above the clavicle (the posterior triangle and the supraclavicular fossa, the notch over the manubrium) the floor is GL7.deepNeck deeper:
  // the scalenes and the trachea lie under a fat pad there. E_tot = smax(E_bone, floor): the bones stand out of the floor where they come
  // nearer the skin than it; the floor varies smoothly with the position against the clavicle (no validity gates, nothing filled).
  const clavY = (S_, x) => { const pts = A.K.geo['clav' + S_]?.pts; if (!pts) return null; const ax = Math.abs(x);
    for (let i = 0; i + 1 < pts.length; i++) { const x0 = Math.abs(pts[i][0]), x1 = Math.abs(pts[i + 1][0]); if ((ax - x0) * (ax - x1) <= 0) { const t = (ax - x0) / ((x1 - x0) || 1e-9); return [pts[i][1] + t * (pts[i + 1][1] - pts[i][1]), pts[i][2] + t * (pts[i + 1][2] - pts[i][2])]; } }
    const e = ax < Math.abs(pts[0][0]) ? pts[0] : pts[pts.length - 1]; return [e[1], e[2]]; };
  const tS = s_ => K.skin + (K.fat[s_][Env.fem ? 'f' : 'm'] / 1000) * Env.fk, smax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };
  // v4: THE MUSCLES BY THEIR THICKNESS. tau: the thickness of the superficial girdle muscles' union crossed by the skin's normal line (2 x the
  // deepest point of the line inside them); tCap: the local sheet's own thickness (tau's Gaussian mean at sigL over the skin that has muscle
  // under it). The muscle layer's top = the site's fat under the skin where tau = tCap, sinking by tCap - tau at a border or a gap.
  const tau = new Float64Array(n), tCap = new Float64Array(n), isScm = new Uint8Array(n), fill = new Float64Array(n), pres = new Float64Array(n).fill(1); let tauMs = 0, scmClosed = 0;
  const inZ_ = new Uint8Array(n); for (const v of vs) inZ_[v] = 1;
  if (useM) { const t1 = Date.now(), MU0 = A.M.parts.filter(q => K.musc.test(q.name)), K8 = A.K8, step = K.tauStep;
    // the SCM's two heads (ANAT8's two parts) bound in one sheath: the investing fascia unites them into one belly a little above the clavicle,
    // so their union is a smooth one (K.scmK), which bridges the narrow gap ANAT8 leaves between them up the neck (the lesser supraclavicular
    // fossa stays where they diverge, over the clavicle); every other muscle by the hard union
    const SC = { L: MU0.filter(q => /^scm/.test(q.name) && q.name.endsWith('.L')), R: MU0.filter(q => /^scm/.test(q.name) && q.name.endsWith('.R')) }, MU = MU0.filter(q => !/^scm/.test(q.name));
    const sdM = (x, y, z, cut) => { let d = MU.length ? K8.sdParts(MU, x, y, z, cut).d : cut, scm = false;
      for (const sd of ['L', 'R']) { const P2 = SC[sd]; if (!P2.length) continue; let e = cut; for (const q of P2) { const f = K8.sdPart(q, x, y, z, cut + K.scmK); e = e >= cut ? f : K8.smin(e, f, K.scmK); } if (e < d) { d = e; scm = true; } }
      return { d, scm }; };
    for (const v of vs) { const x = S[3 * v], y = S[3 * v + 1], z = S[3 * v + 2], nx = N[3 * v], ny = N[3 * v + 1], nz = N[3 * v + 2];
      if (sdM(x, y, z, K.tauIn + 0.01).d >= K.tauIn + 0.01) continue;
      const dAt = s_ => sdM(x + nx * s_, y + ny * s_, z + nz * s_, 0.03).d;
      let dm = 0, sb = null; for (let s_ = K.tauOut; s_ > -K.tauIn; s_ -= step) { const d = dAt(s_); if (-d > dm) { dm = -d; sb = s_; } }
      if (sb !== null && sdM(x + nx * sb, y + ny * sb, z + nz * sb, 0.03).scm) isScm[v] = 1;
      if (sb !== null) { let lo = sb - step, hi = sb + step; for (let it = 0; it < 8; it++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (dAt(m1) < dAt(m2)) hi = m2; else lo = m1; } dm = Math.max(dm, -dAt((lo + hi) / 2)); }
      tau[v] = 2 * dm; }
    tauMs = Date.now() - t1; }
  const Ef = new Float64Array(n), fl = new Float64Array(n);
  if (useM) { const cellT = 0.02, GT = new Map(), kT = (i, j, k) => i + ',' + j + ',' + k, R = 2.5 * K.sigL, s2 = 2 * K.sigL * K.sigL;
    for (const v of vs) { const q = kT(Math.floor(S[3 * v] / cellT), Math.floor(S[3 * v + 1] / cellT), Math.floor(S[3 * v + 2] / cellT)); let l = GT.get(q); if (!l) GT.set(q, l = []); l.push(v); }
    for (const v of vs) { const x = S[3 * v], y = S[3 * v + 1], z = S[3 * v + 2], r = Math.ceil(R / cellT), ci = Math.floor(x / cellT), cj = Math.floor(y / cellT), ck = Math.floor(z / cellT); let w = 0, a = 0;
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) { const l = GT.get(kT(ci + i, cj + j, ck + k)); if (!l) continue;
        for (const u of l) { if (tau[u] <= K.tauMin) continue; const dx = S[3 * u] - x, dy = S[3 * u + 1] - y, dz = S[3 * u + 2] - z, d2 = dx * dx + dy * dy + dz * dz; if (d2 > R * R) continue;
          if (N[3 * u] * N[3 * v] + N[3 * u + 1] * N[3 * v + 1] + N[3 * u + 2] * N[3 * v + 2] < 0.3) continue; const ww = Math.exp(-d2 / s2); w += ww; a += ww * tau[u]; } }
      tCap[v] = w > 0 ? a / w : 0; }
    // THE ANTERIOR TRIANGLE IS FILLED: in front of and medial to the SCMs the neck holds its viscera (the larynx, the trachea, the thyroid under
    // the strap muscles), which this model does not build: no sink there. The SCM's medial footprint edge per side and per 5 mm of height (the
    // skin over the SCM, read from tau): skin medial to it and above the notch is the anterior triangle (a soft edge of K.fillW).
    const bin = 0.005, med = { L: new Map(), R: new Map() };
    for (const v of vs) { if (!isScm[v] || tau[v] <= K.tauMin) continue; const sd = S[3 * v] >= 0 ? 'L' : 'R', b = Math.floor((S[3 * v + 1] - Jn[1]) / bin), ax = Math.abs(S[3 * v]); const m = med[sd].get(b); if (m === undefined || ax < m) med[sd].set(b, ax); }
    const medAt = (sd, y) => { const b = Math.floor((y - Jn[1]) / bin); let best = null; for (let k = 0; k <= 4 && best === null; k++) { const a1 = med[sd].get(b - k), a2 = med[sd].get(b + k); if (a1 !== undefined || a2 !== undefined) best = Math.min(a1 ?? 1, a2 ?? 1); } return best; };
    for (const v of vs) { const y = S[3 * v + 1]; if (y < Jn[1] - K.fillW) continue; const m = medAt(S[3 * v] >= 0 ? 'L' : 'R', y); if (m === null) continue;
      fill[v] = ss(m + K.fillW, m - K.fillW, Math.abs(S[3 * v])) * ss(Jn[1] - K.fillW, Jn[1] + K.fillW, y); }
    // the muscles' PRESENCE over each vertex (a border, a gap), not their interior thickness (ANAT8's sheets vary in thickness by their facets);
    // the SCM's presence CLOSED over the skin (dilated then eroded by K.scmClose): ANAT8 builds its two heads apart up the neck, where the real
    // ones run together in one sheath (the clavicular head under the sternal one) a little above the clavicle: the gap is the model's, not anatomy
    const near = (v, Rr, fn) => { const x = S[3 * v], y = S[3 * v + 1], z = S[3 * v + 2], r = Math.ceil(Rr / cellT), ci = Math.floor(x / cellT), cj = Math.floor(y / cellT), ck = Math.floor(z / cellT);
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) { const l = GT.get(kT(ci + i, cj + j, ck + k)); if (!l) continue;
        for (const u of l) { const dx = S[3 * u] - x, dy = S[3 * u + 1] - y, dz = S[3 * u + 2] - z; if (dx * dx + dy * dy + dz * dz > Rr * Rr) continue; if (N[3 * u] * N[3 * v] + N[3 * u + 1] * N[3 * v + 1] + N[3 * u + 2] * N[3 * v + 2] < 0.3) continue; if (fn(u) === false) return; } } };
    for (const v of vs) pres[v] = tCap[v] > 1e-5 ? ss(K.pres0 * tCap[v], K.pres1 * tCap[v], tau[v]) : 1;
    if (K.scmClose > 0) { const s0 = new Uint8Array(n), dil = new Uint8Array(n); for (const v of vs) if (isScm[v] && pres[v] > 0.5) s0[v] = 1;
      for (const v of vs) { if (s0[v]) { dil[v] = 1; continue; } near(v, K.scmClose, u => { if (s0[u]) { dil[v] = 1; return false; } }); }
      let closed = 0; for (const v of vs) { if (!dil[v] || s0[v]) continue; let all = true; near(v, K.scmClose, u => { if (!dil[u] && inZ_[u]) { all = false; return false; } }); if (all) { pres[v] = 1; closed++; } }
      scmClosed = closed; } }
  for (const v of vs) { const x = S[3 * v], y = S[3 * v + 1], z = S[3 * v + 2], c = clavY(x >= 0 ? 'L' : 'R', x) || [Jn[1], Jn[2]];
    const above = ss(c[0] - 0.01, c[0] + 0.015, y), front = ss(c[1] - 0.015, c[1] + 0.005, z), lat = ss(acX - 0.02, acX + 0.01, Math.abs(x));
    const tChest = tS('pectoral'), tNeck = tS('scm') + (useM ? 0 : K.deepNeck), tBack = tS('trapU'), tArm = tS('deltoid');
    const tIn = (1 - above) * tChest + above * (front * tNeck + (1 - front) * tBack), t = (1 - lat) * tIn + lat * tArm; tLoc[v] = t;
    // v4: ONE reference depth for the covered muscle layer (the chest's: below the clavicle the skin keeps its own form, as in v3), sinking by what
    // the muscles lack (tCap - tau): the hollows come from the anatomy, not from a switch between fat sites (a site switch at a plane is a step)
    // the sink: by the muscles' PRESENCE (a border, a gap), not by their interior thickness (ANAT8's sheets' interior varies by their facets, not anatomy)
    fl[v] = useM ? -(tChest + tCap[v] * (1 - pres[v]) * (1 - fill[v])) : -t;
    const Eb = lab[v] >= 0 || E[v] ? E[v] : -K.reach - 0.02; Ef[v] = smax(Math.max(Eb, -K.reach - 0.02), fl[v], Env.kb); val[v] = 1; }
  // neighbourhoods (a grid over the zone's vertices; a ball with the normals agreeing)
  const cell = 0.02, G = new Map(), key = (i, j, k) => i + ',' + j + ',' + k;
  for (const v of vs) { const q = key(Math.floor(S[3 * v] / cell), Math.floor(S[3 * v + 1] / cell), Math.floor(S[3 * v + 2] / cell)); let l = G.get(q); if (!l) G.set(q, l = []); l.push(v); }
  const ball = (v, R, fn) => { const x = S[3 * v], y = S[3 * v + 1], z = S[3 * v + 2], r = Math.ceil(R / cell), ci = Math.floor(x / cell), cj = Math.floor(y / cell), ck = Math.floor(z / cell);
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) { const l = G.get(key(ci + a, cj + b, ck + c)); if (!l) continue;
      for (const u of l) { const dx = S[3 * u] - x, dy = S[3 * u + 1] - y, dz = S[3 * u + 2] - z, d2 = dx * dx + dy * dy + dz * dz; if (d2 > R * R) continue;
        if (N[3 * u] * N[3 * v] + N[3 * u + 1] * N[3 * v + 1] + N[3 * u + 2] * N[3 * v + 2] < 0.3) continue; fn(u, d2); } } };
  // the fat's thickness under each vertex (the nearest part's site; filled like E where there is none)
  const tF = tLoc;
  // the DoG: the field at the fat's bridging scale minus its 2 cm mean; the cover = the share of real data within the 2 cm mean
  const out = []; for (const v of vs) if (wReg(v) > 0) out.push(v);
  const Rf = new Float64Array(n), cov = new Float64Array(n), s2L = 2 * K.sigL * K.sigL;
  for (const v of out) { const sF = K.sigF0 + K.sigFk * tF[v], s2F = 2 * sF * sF; let wl = 0, el = 0, wh = 0, eh = 0, vl = 0;
    ball(v, 2.5 * K.sigL, (u, d2) => { const w = Math.exp(-d2 / s2L); wl += w; el += w * Ef[u]; vl += w * val[u]; if (d2 < 6.25 * sF * sF) { const w2 = Math.exp(-d2 / s2F); wh += w2; eh += w2 * Ef[u]; } });
    Rf[v] = (wh > 0 ? eh / wh : Ef[v]) - (wl > 0 ? el / wl : Ef[v]); cov[v] = 1; }
  // the edit: out with the detail tier's girdle forms, in with the anatomy's relief (along the skin's normal), bind units
  // the typed girdle forms go WHOLE wherever they are on the neck (most of the neck is hm08's head region 0, where the SCM's and the upper
  // trapezius' blobs put +-5-7 mm: the ropy neck), down to the region's lower edge; on the trunk and the arm out to its lateral edge (fading)
  const wRm = v => { const x = Math.abs(S[3 * v]), y = S[3 * v + 1], r = regOf(v); return ss(Jn[1] - K.yLo - K.fade, Jn[1] - K.yLo, y) * (r === 0 || r === 1 || r === 11 ? 1 : ss(acX + K.xOut + K.fade, acX + K.xOut, x)); };
  const D = new Float64Array(3 * n), Drm = new Float64Array(3 * n), vals = []; let over = 0; const inOut = new Uint8Array(n); for (const v of out) inOut[v] = 1;
  for (const v of out) { const w = wReg(v), wr = wRm(v), r = Rf[v] * cov[v], rm = r * 1000; if (Math.abs(rm) > K.maxMm) over++; vals.push(rm * w);
    for (let j = 0; j < 3; j++) { Drm[3 * v + j] = -wr * (Dg3 ? Dg3[3 * v + j] : 0); D[3 * v + j] = w * r * N[3 * v + j] / sc + Drm[3 * v + j]; } }
  let nRm = 0; if (Dg3) for (let v = 0; v < n; v++) { if (inOut[v] || !inTri[v]) continue; if (!Dg3[3 * v] && !Dg3[3 * v + 1] && !Dg3[3 * v + 2]) continue; const wr = wRm(v); if (!wr) continue;
    for (let j = 0; j < 3; j++) { D[3 * v + j] = -wr * Dg3[3 * v + j]; Drm[3 * v + j] = D[3 * v + j]; } out.push(v); nRm++; }
  vals.sort((a, b) => a - b); const q = p => vals.length ? +vals[Math.max(0, Math.min(vals.length - 1, Math.floor(p * (vals.length - 1))))].toFixed(2) : null;
  const byLab = {}; for (const v of out) if (lab[v] >= 0 && val[v] > 0.5) { const s = Env.parts[lab[v]].site; (byLab[s] ||= []).push(Rf[v] * cov[v] * 1000); }
  const sites = Object.fromEntries(Object.entries(byLab).map(([s, A_]) => { A_.sort((a, b) => a - b); return [s, { n: A_.length, p05: +A_[Math.floor(0.05 * (A_.length - 1))].toFixed(1), p50: +A_[Math.floor(0.5 * (A_.length - 1))].toFixed(1), p95: +A_[Math.floor(0.95 * (A_.length - 1))].toFixed(1) }]; }));
  let dgMax = 0; if (Dg3) for (const v of out) dgMax = Math.max(dgMax, Math.hypot(Dg3[3 * v], Dg3[3 * v + 1], Dg3[3 * v + 2]) * sc * 1000);
  return { D, Drm, verts: out, field: { E, Ef, val, Rf, cov, lab, fl, tau, tCap, fill }, stats: { version: GIRDLE_LAYER7_VERSION, zone: vs.length, region: out.length, typedOutsideZone: nRm, valid: +(vs.reduce((a, v) => a + (val[v] > 0.5 ? 1 : 0), 0) / Math.max(1, vs.length)).toFixed(2),
    reliefMm: { p01: q(0.01), p05: q(0.05), p50: q(0.5), p95: q(0.95), p99: q(0.99) }, overMaxMm: over, detailGirdleRemovedMaxMm: +dgMax.toFixed(1), sites, fatK: +Env.fk.toFixed(2), blendMm: +(Env.kb * 1000).toFixed(1),
    muscles: useM ? (() => { const a = vs.filter(v => tau[v] > K.tauMin).map(v => tau[v] * 1000).sort((p_, q_) => p_ - q_), c = vs.filter(v => tCap[v] > 0).map(v => (tCap[v] - Math.min(tau[v], tCap[v])) * 1000).sort((p_, q_) => p_ - q_), Q = (L, p_) => L.length ? +L[Math.floor(p_ * (L.length - 1))].toFixed(1) : null;
      return { over: a.length, tauMm: [Q(a, 0.05), Q(a, 0.5), Q(a, 0.95)], sinkMm: [Q(c, 0.5), Q(c, 0.95), Q(c, 1)], scmClosed, ms: tauMs }; })() : false, ms: Date.now() - t0 } };
}

export async function girdleLayer7(P, { name = null, register = 'bare', anatomy = null, ...o } = {}) {
  const h = P?.h, g = h?.body?.geometry; if (register !== 'bare') return { skipped: 'dressed register (form 1): the girdle layer acts on the figure study only' };
  if (!g?.index) return { skipped: 'no body geometry' };
  const t0 = Date.now(), X = g.attributes.position.array, n = g.attributes.position.count, I = g.index.array;
  // the as-built bind (girdle7's relax is a pose-time bind correction over its band: read the anatomy on the as-built skin, add the same edit to both)
  const sv = girdleSaved7(h), base = Float64Array.from(X); if (sv) for (let i = 0; i < sv.idx.length; i++) for (let j = 0; j < 3; j++) base[3 * sv.idx[i] + j] = sv.pos[3 * i + j];
  const A = anatomy || await girdleAnatomy7(P, { muscles: (o.parts ?? GL7.parts) === 'all' || !!(o.muscles ?? GL7.muscles) }), Env = girdleEnvelope7(A, o), Dg3 = P.detail?.Dg3 || h.detail?.Dg3 || null;
  if (Dg3 && Dg3.length !== 3 * n) throw new Error('girdle_layer7: the detail tier\'s girdle record does not match the body (' + Dg3.length / 3 + ' vs ' + n + ')');
  const R = girdleRelief7(h, A, Env, { base, Dg3, ...o }), D = R.D, K_ = { ...GL7, ...o };
  const X0 = Float64Array.from(X), mark = new Uint8Array(n); for (const v of R.verts) mark[v] = 1;
  // v4: THE RELIEF NEVER FOLDS THE SKIN IT EDITS (a guard on our own damage, not a shape): where an edge turns sharp under the anatomy's relief
  // (over GL7.foldDeg, and GL7.foldJump sharper than the skin with the typed forms out), the relief is withdrawn at its vertices and eased back
  // over two rings; twice at most. The typed forms' removal is not guarded (it returns the skin to the face and prior stages' own mesh).
  const guard = { withdrawn: 0 };
  if (K_.foldGuard) { const T0 = topoOf(g), Xt = new Float64Array(X.length), wgt = new Float64Array(n).fill(1);
    const tnA = (Q, t) => { const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2]; const ux = Q[b] - Q[a], uy = Q[b + 1] - Q[a + 1], uz = Q[b + 2] - Q[a + 2], wx = Q[c] - Q[a], wy = Q[c + 1] - Q[a + 1], wz = Q[c + 2] - Q[a + 2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, l = Math.hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l]; };
    const ed = new Map(); for (let t = 0; t < I.length / 3; t++) { if (!(mark[I[3 * t]] || mark[I[3 * t + 1]] || mark[I[3 * t + 2]])) continue; for (let e = 0; e < 3; e++) { const a = I[3 * t + e], b = I[3 * t + (e + 1) % 3], k = a < b ? a * n + b : b * n + a; const l = ed.get(k); if (l) l.push(t); else ed.set(k, [t]); } }
    const ang = (Q, l) => { const p_ = tnA(Q, l[0]), q_ = tnA(Q, l[1]); return Math.acos(Math.max(-1, Math.min(1, p_[0] * q_[0] + p_[1] * q_[1] + p_[2] * q_[2]))) * 180 / Math.PI; };
    // the baseline: the skin with the typed forms taken out (their removal is not scaled: it returns the skin to what the face and prior stages made)
    const Xb = Float64Array.from(X0); for (const v of R.verts) for (let j = 0; j < 3; j++) Xb[3 * v + j] += R.Drm[3 * v + j];
    const a0 = new Map(); for (const [k, l] of ed) if (l.length === 2) a0.set(k, ang(Xb, l));
    for (let pass = 0; pass < 2; pass++) { Xt.set(Xb); for (const v of R.verts) for (let j = 0; j < 3; j++) Xt[3 * v + j] += wgt[v] * (D[3 * v + j] - R.Drm[3 * v + j]);
      const bad = new Set(); for (const [k, l] of ed) { if (l.length !== 2) continue; const a1 = ang(Xt, l); if (a1 > K_.foldDeg && a1 - a0.get(k) > K_.foldJump) { bad.add(Math.floor(k / n)); bad.add(k % n); } }
      if (!bad.size) break; guard.withdrawn += bad.size;
      let fr = [...bad]; for (const v of fr) wgt[v] = 0; const seen = new Set(fr);
      for (const f of [0.4, 0.75]) { const nf = []; for (const v of fr) for (let k = T0.off[v]; k < T0.off[v + 1]; k++) { const u = T0.nb[k]; if (seen.has(u)) continue; seen.add(u); nf.push(u); wgt[u] = Math.min(wgt[u], f); } fr = nf; } }
    for (const v of R.verts) for (let j = 0; j < 3; j++) D[3 * v + j] = R.Drm[3 * v + j] + wgt[v] * (D[3 * v + j] - R.Drm[3 * v + j]); }
  for (const v of R.verts) { X[3 * v] += D[3 * v]; X[3 * v + 1] += D[3 * v + 1]; X[3 * v + 2] += D[3 * v + 2]; }
  const kept = girdleBindEdit7(h, D);
  const T = topoOf(g), ring = new Set(R.verts); for (const v of R.verts) for (let k = T.off[v]; k < T.off[v + 1]; k++) ring.add(T.nb[k]);
  normalsAt(X, I, T, ring, g.attributes.normal.array);
  g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true; g.computeBoundingSphere?.();
  const health = { before: meshHealth7(null, X0, I, T, mark), after: meshHealth7(X0, X, I, T, mark) };
  // the triangles that changed side: which way they face against the neck's axis (x 0, z 4 cm behind the notch), as built and after (the typed
  // forms crumple the skin behind the ear: their removal turns those triangles back out; a turn the other way would be damage)
  { const Jn = A.K.geo.sternum.Jn, sc = h.scale || 1; let o0 = 0, o1 = 0, c = 0; const tn = (Q, t) => { const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], d = 3 * I[3 * t + 2]; const ux = Q[b] - Q[a], uy = Q[b + 1] - Q[a + 1], uz = Q[b + 2] - Q[a + 2], wx = Q[d] - Q[a], wy = Q[d + 1] - Q[a + 1], wz = Q[d + 2] - Q[a + 2]; return [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx]; };
    for (let t = 0; t < I.length / 3; t++) { if (!(mark[I[3 * t]] && mark[I[3 * t + 1]] && mark[I[3 * t + 2]])) continue; const p = tn(X0, t), q = tn(X, t); if (p[0] * q[0] + p[1] * q[1] + p[2] * q[2] >= 0) continue;
      const cx = (X0[3 * I[3 * t]] + X0[3 * I[3 * t + 1]] + X0[3 * I[3 * t + 2]]) / 3 * sc, cz = (X0[3 * I[3 * t] + 2] + X0[3 * I[3 * t + 1] + 2] + X0[3 * I[3 * t + 2] + 2]) / 3 * sc - (Jn[2] - 0.04); c++;
      if (p[0] * cx + p[2] * cz > 0) o0++; if (q[0] * cx + q[2] * cz > 0) o1++; }
    health.turnedFacingOut = { turned: c, asBuilt: o0, after: o1 }; }
  return { version: GIRDLE_LAYER7_VERSION, name, ...R.stats, health, foldGuard: guard, girdleSavedEdited: kept, detailGirdle: !!Dg3, anatomyMs: A.ms, ms: Date.now() - t0 };
}
