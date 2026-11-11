// ANAT8-HEAD: a PARAMETRIC SKULL of our own (8 Oct; REV 2 it2). An SDF (lib/fx/anatomy/layer/sdf.js) of anatomically shaped parts, built
// in the craniometric frame (frame.js: origin the porion midpoint, y up normal to the Frankfurt horizontal, x the person's left, z forward,
// mm) from the person's craniometric parameters (tables.js: Howells' set + the mandible, by sex and population, age-remodelled), the draw
// conditioned only on the person's VAULT (rev 4: the head's length and breadth under the scalp, what the body sets) and their sex, age and
// ancestry: nothing of the generator's face (its width, menton, chin, eyes) enters the bone; the eyes' seat is the bone's (reported).
//   const K = drawSkull(info, anchors, { T, averageness });    // info { name, sex, age, group, bmi }; anchors: frame.livingAnchors (or null)
//   const B = buildSkull(K);                                    // B.S (scene), B.parts { skull (cranium + face), mandible, teeth, hyoid },
//                                                               // B.lm (bony landmarks, mm), B.globe (the REAL eyes, r ~12, seated by the
//                                                               // bone), B.globeProxy (the cast's eye proxies), B.arch, B.orbit, B.report
// REV 2 (it2: the measurer's anatomist read of rev 1, measures/it1.md): rev 1 was a model of tubes, flat 3 x 3 sheets and slabs (the maxilla
// a slab, the nasal bones a tile, the ramus a quad, the arch a plank, the rims tori, the base a solid ellipsoid). Rev 2 builds each part
// from its own section or surface: HEIGHT SLABS (an analytic front surface: the brow and forehead, the bony nasal pyramid with its nasion
// saddle, the maxilla with its plan curvature, canine eminence and fossa), SWEEPS (a section along a spine: the mandibular body, the
// alveolar processes, the zygomatic arch, the rims' processes, the condylar neck, the coronoid, the hyoid, each tooth), SMOOTH SHEETS (the
// ramus) and CAVITIES carved last (the orbits as lofted pyramids whose margins are the edges where the masses meet them, sharp or rounded
// by sex and side; a pear-shaped piriform aperture; the nasal cavity; the temporal fossae; the glenoid fossae, the meatus, the foramen
// magnum), the vault clipped by a cranial BASE (basiocciput, occipital condyles, mastoids, styloids, the nuchal plane). The mandible is
// SOLVED between the condyle (drawn per person) and the bony menton (the drawn N-Me) for its ramus height, body length, gonial angle and FMA together.
// Labels: 1 cranium, 2 facial skeleton, 3 mandible, 4 teeth, 5 hyoid. The eyes are NOT bone: B.globe says where they sit in the orbits.
import * as D from '../layer/sdf.js';
import { SKULL_KEYS, sdOf, SKULL_MIX, popMeans, LOADINGS, AGE_PER_DECADE, TEETH } from './tables.js';
export const SKULL_VERSION = 5;   // (lane it22) the corneal apex drawn against the nasion (the orbit's profile chain as one draw; NAS and the Hertel reading share the lateral rim); (c5 it14) the skull from the person alone: the orbits, the corneal plane and the glabella no longer from the cast's eyes or the scans (was 3: the face's width and height drawn from the bone's distribution)
export const LBL = { cranium: 1, face: 2, mandible: 3, teeth: 4, hyoid: 5 };
export const LBL_NAME = { 1: 'cranium', 2: 'facial skeleton', 3: 'mandible', 4: 'teeth', 5: 'hyoid' };
const { v3 } = D, rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI, clamp = (x, a, b) => Math.min(b, Math.max(a, x)), lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function rng(seed) { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(r) { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }
const hashStr = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
// the depth at a forensic site (FACE P2's table, face_pop.json tissue), as face_tissue.siteDepth
function siteDepth(T, key, sex, age, bmi) { const s = T?.sites?.[key]; if (!s) return null; const ref = T.ref || { age: 35, bmi: 24 };
  return Math.max(0.8, (sex === 'm' ? s.m : s.f) + s.perDecade * ((age ?? 35) - ref.age) / 10 + s.perBMI * ((bmi ?? 24) - ref.bmi)); }
// a smooth monotone-ish 1-D profile through knots [[x, y], ...] (Catmull-Rom in x, clamped at the ends)
function profile(knots) { const K = knots.slice().sort((a, b) => a[0] - b[0]), n = K.length;
  return x => { if (x <= K[0][0]) return K[0][1]; if (x >= K[n - 1][0]) return K[n - 1][1]; let i = 0; while (i + 1 < n && K[i + 1][0] < x) i++;
    const p0 = K[Math.max(0, i - 1)], p1 = K[i], p2 = K[i + 1], p3 = K[Math.min(n - 1, i + 2)], t = (x - p1[0]) / (p2[0] - p1[0]), h = p2[0] - p1[0];
    const m1 = (p2[1] - p0[1]) / ((p2[0] - p0[0]) || 1) * h, m2 = (p3[1] - p1[1]) / ((p3[0] - p1[0]) || 1) * h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2; }; }

// ---------------------------------------------------------------- the draw
// drawSkull(info, A, o) -> K: every SKULL_KEY (mm / deg) + sex, age, mix, NMe (bony nasion-menton), display (incisor display at rest),
// the vault (fitted to the scalp), castGlobe (the cast's eyes: the membrane's lid proxy only), golMax, report { anchors, z (the draw), clamped }
export function drawSkull(info, A = null, o = {}) {
  const sex = info.sex === 'm' ? 'm' : 'f', age = info.age ?? 35, bmi = info.bmi ?? 24, mix = o.mix || SKULL_MIX[info.group] || SKULL_MIX.white, mu = popMeans(sex, mix);
  // averageness (0..1) shrinks the person's own scatter about the means: the cast is 'common to attractive' and attractiveness tracks
  // averageness (Langlois and Roggman 1990), so the default keeps three quarters of the scatter
  const r = rng((hashStr('anat8skull:' + (info.name || '')) ^ Math.imul((o.seed ?? 0) + 7, 2654435761)) >>> 0), av = clamp(o.averageness ?? 0.25, 0, 1), dec = Math.max(0, age - 30) / 10;
  const K = { name: info.name || '', sex, age, bmi, mix, group: info.group || 'white' }, rep = { anchors: {}, z: {}, clamped: [] }, eps = {};
  for (const k of SKULL_KEYS) eps[k] = clamp(gauss(r), -2, 2) * (1 - av);
  eps.NMe = clamp(gauss(r), -2, 2) * (1 - av);
  const NMe_mu = mu.NPH + (sex === 'm' ? 47 : 42.5), NMe_sd = 5.5;
  // (rev 4, c5 it14) THE SKULL FROM THE PERSON, NOT FROM THE MESH. The draw is conditioned ONLY on the VAULT (what the body sets: the
  // cranium's length and breadth under the scalp, its shape fitted to the scalp away from the face, the ears and the temples) and on
  // the person's sex, age and ancestry (the population mix of the tables). Nothing of the generator's FACE enters: not its zy-zy, its
  // menton or chin (rev 2), and (new in rev 4) not its EYES: rev 2-3 seated the orbits round the cast's globes (DKB + OBB forced to the
  // cast's IPD - 1, the orbit's height at the cast's globe, the corneal plane at the cast's corneal apex), so the bone's eye seat was the
  // mesh's. Now the orbits' breadths are drawn, the orbit sits on the Frankfurt plane (the orbitale at y 0, the frame's own definition),
  // the corneal plane comes from the basion-nasion length; where that seats the globe beside the cast's eye is REPORTED (globeSeat):
  // the hand-off (the eyes follow the bone: FACE7 / EYES and this lane's next step). The cast's eyes are carried only as the PROXY the
  // membrane keeps the lids round (K.castGlobe: the eye mesh that exists), never as a constraint on the bone.
  let zS = 0, nS = 0; const anch = {};
  if (A) { const dep = (k, fb) => siteDepth(o.T, k, sex, age, bmi) ?? fb;
    const dg = dep('g', 5.3), dop = (sex === 'm' ? 6.2 : 5.8) + 0.05 * (bmi - 24), deu = (sex === 'm' ? 6.8 : 6.2) + 0.06 * (bmi - 24);   // the vault's soft tissue (scalp)
    const fit = (k, v) => { const sd = sdOf(k, sex), lo = mu[k] - 3 * sd, hi = mu[k] + 3 * sd, c = clamp(v, lo, hi); if (c !== v) rep.clamped.push(`${k} ${v.toFixed(1)} -> ${c.toFixed(1)}`); anch[k] = c; return (c - mu[k]) / sd; };
    zS += fit('GOL', A.gop - dg - dop); zS += fit('XCB', A.eueu - 2 * deu); nS = 2;
    if (A.scalp?.length > 50) { K.vault = fitVault(A.scalp, (sex === 'm' ? 6.2 : 5.8) + 0.05 * (bmi - 24), { rx: mu.XCB / 2, rz: mu.GOL / 2 }); rep.vault = K.vault; }
    if (A.globe) K.castGlobe = { L: A.globe.L, R: A.globe.R, r: A.globe.r };
    rep.anchors = { gop: A.gop, eueu: A.eueu, depths: { g: +dg.toFixed(2), op: +dop.toFixed(2), eu: +deu.toFixed(2) } };
    rep.meshFace = { zyzy: A.zyzy, nme: A.nme, ipd: A.ipd ?? null };   // a description of the mesh the skin will be fitted from; never read below
  }
  // THE FACE FROM THE BONE'S OWN DISTRIBUTION (rev 3): the face's width (ZYB) and height (N-Me) drawn, leaning only on the vault's size.
  // The loadings are our reading of the craniometric covariance (vault size against facial breadth r ~0.4-0.5, against facial height
  // r ~0.3-0.4, within sex: Howells 1973's factor analyses, as recalled); the rest is the person's own draw (eps, shrunk by averageness).
  const sz = nS ? zS / nS : 0, zW = 0.5 * sz + Math.sqrt(0.75) * eps.ZYB, zH = 0.35 * sz + Math.sqrt(1 - 0.35 * 0.35) * eps.NMe;
  K.NMe = NMe_mu + NMe_sd * clamp(zH, -2.5, 2.5); rep.faceFrom = 'bone';
  const F = { size: sz, height: zH, width: zW };
  anch.ZYB = mu.ZYB + sdOf('ZYB', sex) * clamp(zW, -2.5, 2.5);
  for (const k of SKULL_KEYS) { if (k in anch) { K[k] = anch[k]; rep.z[k] = +((anch[k] - mu[k]) / sdOf(k, sex)).toFixed(2); continue; }
    const L = LOADINGS[k] || {}; let z = 0, l2 = 0; for (const [f, w] of Object.entries(L)) { z += w * F[f]; l2 += w * w; }
    z += Math.sqrt(Math.max(0, 1 - l2)) * eps[k]; K[k] = mu[k] + sdOf(k, sex) * z; rep.z[k] = +z.toFixed(2); }
  // (rev 5, lane it22) THE CORNEAL APEX DRAWN AGAINST THE NASION: the orbit's profile chain as ONE draw. The face-to-eye relation in
  // profile (the bony nasion ahead of the corneal apex, P = 5 + NAS - Hertel in this build: buildSkull puts the lateral rim's Hertel point
  // at cornea - hertel, the frontomalare 5 mm ahead of it, the nasion NAS ahead of that) was the difference of two INDEPENDENT draws (Howells'
  // nasion subtense NAS, sd 2.5, and the Hertel reading, sd 2), so its scatter was the sum of theirs (sd 3.2 before averageness) and a person
  // drawn high on NAS and low on Hertel (L23: +0.5 / -1.5 z) stood the nasion 12 mm ahead of the cornea where people stand 5-9. In the
  // anatomy the two share one term: the LATERAL ORBITAL RIM's sagittal position is the far end of NAS's chord (the frontomalare) AND the
  // reference of the Hertel reading (the corneal apex ahead of the rim), so a retruded rim raises both, and the globe's place against the
  // nasion and the medial orbit varies far less than either (the group means show it: NAS - Hertel is 3 / 1 / 0 / 0.5 mm for white / Black /
  // East Asian / Amerind men where NAS spans 14-19 and Hertel 14-18). So P is drawn (from NAS's own stream, eps.nasDepth: no other key's
  // draw moves) with the residual scatter sd_P = sqrt(sd_NAS^2 - sd_Hertel^2) (1.5 mm), and NAS = P - 5 + Hertel: NAS keeps its table mean
  // and sd (sqrt(sd_P^2 + sd_H^2) = sd_NAS), Hertel is untouched, and their correlation is sd_H / sd_NAS (0.8), the share of NAS that is the
  // rim's. OUR decomposition from the shared landmark, as recalled; no published NAS-Hertel correlation was fetched. No target: the
  // HSRD-100 heads describe the result afterwards (labs/human8/anat8_scratch probes; NOTES it22).
  { const sdH = sdOf('hertel', sex), sdN = sdOf('nasDepth', sex), sdP = Math.sqrt(Math.max(0.25, sdN * sdN - sdH * sdH));
    K.nasDepth = mu.nasDepth + (K.hertel - mu.hertel) + sdP * eps.nasDepth; rep.z.nasDepth = +((K.nasDepth - mu.nasDepth) / sdN).toFixed(2);
    rep.radix = { P: +(5 + K.nasDepth - K.hertel).toFixed(2), zP: +eps.nasDepth.toFixed(2), sdP: +sdP.toFixed(2) }; }
  // age remodelling (from 30)
  for (const [k, v] of Object.entries(AGE_PER_DECADE)) if (k in K) K[k] += v * dec;
  K.orbitRim = (AGE_PER_DECADE.orbitRim || 0) * dec;      // the infraorbital rim's retrusion (mm)
  K.display = Math.max(0, TEETH.display[sex] + AGE_PER_DECADE.display * dec);
  K.upperInc = Object.entries(mix).reduce((a, [g, w]) => a + w * (TEETH.upperInc[g] ?? 22), 0) / Object.values(mix).reduce((a, b) => a + b, 0);
  K.lowerInc = Object.entries(mix).reduce((a, [g, w]) => a + w * (TEETH.lowerInc[g] ?? 25), 0) / Object.values(mix).reduce((a, b) => a + b, 0);
  // the vault's length guard: the built GOL (the face placed round the eyes, the vault fitted to the scalp) may not exceed the population's
  // mean + 1.5 SD; beyond it the vault's back is shortened (the scalp over the occiput thickens: reported)
  K.golMax = mu.GOL + 1.5 * sdOf('GOL', sex); K.golMu = mu.GOL;
  for (const k of Object.keys(K)) if (typeof K[k] === 'number') K[k] = +K[k].toFixed(2);
  if (K.vault) { K.XCB = +(2 * K.vault.r[0]).toFixed(1); }
  // where the bone seats the globe beside the cast's eye (the hand-off; a description: nothing moves by it): the orbits' spacing and the
  // corneal plane by the basion-nasion length, against the cast's IPD and corneal apex
  if (K.castGlobe) { const cg = K.castGlobe, ap = A?.globe?.apex; rep.globeSeat = { ipdBone: +(K.DKB + K.OBB + 1).toFixed(1), ipdCast: A?.ipd ?? null, yBone: +(K.OBH / 2 + 2).toFixed(1), yCast: +(0.5 * (cg.L[1] + cg.R[1])).toFixed(1), corneaZbone: +((sex === 'm' ? 0.99 : 0.94) * K.BNL - 8).toFixed(1), corneaZcast: ap ? +(0.5 * (ap.L + ap.R)).toFixed(1) : null }; }
  K.report = { ...rep, factors: Object.fromEntries(Object.entries(F).map(([k, v]) => [k, +v.toFixed(2)])), means: Object.fromEntries(SKULL_KEYS.map(k => [k, +mu[k].toFixed(1)])) };
  return K;
}

// the VAULT fitted to the cast's head under the hair: an axis-aligned ellipsoid (centre on the midline) through the scalp points inset by
// the scalp's thickness (Gauss-Newton, 5 parameters, weak priors on the breadth and length): the head's size and shape stay the cast's
// (hair, hats, the rig keep fitting); the FACE's bone is the skull model's. pts: [x, y, z, nx, ny, nz] (mm, outward normals).
export function fitVault(pts, scalp = 6, prior = {}) {
  const Q = pts.map(p => [p[0] - p[3] * scalp, p[1] - p[4] * scalp, p[2] - p[5] * scalp]);
  let th = [30, (Math.max(...Q.map(q => q[2])) + Math.min(...Q.map(q => q[2]))) / 2, Math.max(...Q.map(q => Math.abs(q[0]))), 80, (Math.max(...Q.map(q => q[2])) - Math.min(...Q.map(q => q[2]))) / 2];
  const res = t => { const out = Q.map(q => { const e = Math.sqrt((q[0] / t[2]) ** 2 + ((q[1] - t[0]) / t[3]) ** 2 + ((q[2] - t[1]) / t[4]) ** 2); return (e - 1) * Math.cbrt(t[2] * t[3] * t[4]); });
    const w = Math.sqrt(Q.length) * 0.15; out.push(w * (t[2] - (prior.rx ?? t[2])) / 6, w * (t[4] - (prior.rz ?? t[4])) / 8, w * (t[0] - 32) / 12); return out; };
  for (let it = 0; it < 30; it++) { const r0 = res(th), J = th.map((_, k) => { const t2 = th.slice(); t2[k] += 0.05; const r1 = res(t2); return r1.map((v, i) => (v - r0[i]) / 0.05); });
    const A = th.map((_, a) => th.map((_, b) => J[a].reduce((s, v, i) => s + v * J[b][i], 0) + (a === b ? 1e-3 : 0))), g = th.map((_, a) => J[a].reduce((s, v, i) => s + v * r0[i], 0));
    const M = A.map((row, i) => [...row, -g[i]]); for (let i = 0; i < 5; i++) { let q = i; for (let j = i + 1; j < 5; j++) if (Math.abs(M[j][i]) > Math.abs(M[q][i])) q = j; [M[i], M[q]] = [M[q], M[i]]; for (let j = 0; j < 5; j++) if (j !== i) { const f = M[j][i] / M[i][i]; for (let c = i; c <= 5; c++) M[j][c] -= f * M[i][c]; } }
    const dx = M.map((row, i) => row[5] / row[i]); th = th.map((v, i) => v + dx[i]); if (Math.max(...dx.map(Math.abs)) < 1e-3) break; }
  const r = res(th).slice(0, Q.length).map(Math.abs).sort((a, b) => a - b), c = [0, th[0], th[1]], rr = [th[2], th[3], th[4]];
  // a radial correction on the ellipsoid: real symmetric harmonics up to degree 4 (even in x: the vault is symmetric), least squares with
  // a ridge, fitted to the inset points' radial residuals (mm): the head's own shape under the hair, not an ellipsoid's
  const dir = q => { const u = [(q[0] - c[0]) / rr[0], (q[1] - c[1]) / rr[1], (q[2] - c[2]) / rr[2]], l = Math.hypot(...u) || 1; return [u[0] / l, u[1] / l, u[2] / l, l]; };
  const basisSH = d => { const [x, y, z] = d; return [1, y, z, x * x, y * y, z * z, y * z, x * x * y, x * x * z, y * y * z, y * z * z, y * y * y, z * z * z, x * x * x * x, y * y * y * y, z * z * z * z, x * x * y * y, x * x * z * z, y * y * z * z]; };
  const rows = Q.map(q => { const d = dir(q); return { b: basisSH(d), e: (d[3] - 1) * Math.cbrt(rr[0] * rr[1] * rr[2]) }; }), nb = rows[0].b.length;
  const A = Array.from({ length: nb }, () => new Float64Array(nb)), g = new Float64Array(nb);
  for (const { b, e } of rows) for (let i = 0; i < nb; i++) { g[i] += b[i] * e; for (let j = 0; j < nb; j++) A[i][j] += b[i] * b[j]; }
  for (let i = 0; i < nb; i++) A[i][i] += 0.02 * rows.length;
  const M = A.map((row, i) => [...row, g[i]]); for (let i = 0; i < nb; i++) { let q = i; for (let j = i + 1; j < nb; j++) if (Math.abs(M[j][i]) > Math.abs(M[q][i])) q = j; [M[i], M[q]] = [M[q], M[i]]; for (let j = 0; j < nb; j++) if (j !== i) { const f = M[j][i] / M[i][i]; for (let k = i; k <= nb; k++) M[j][k] -= f * M[i][k]; } }
  const sh = M.map((row, i) => +(row[nb] / row[i]).toFixed(4)), rs = rows.map(({ b, e }) => Math.abs(e - b.reduce((a, v, i) => a + v * sh[i], 0))).sort((a, b) => a - b);
  return { c: [0, +th[0].toFixed(2), +th[1].toFixed(2)], r: [+th[2].toFixed(2), +th[3].toFixed(2), +th[4].toFixed(2)], sh, n: Q.length, rms0: +Math.sqrt(r.reduce((a, b) => a + b * b, 0) / r.length).toFixed(2),
    rms: +Math.sqrt(rs.reduce((a, b) => a + b * b, 0) / rs.length).toFixed(2), p90: +rs[Math.floor(0.9 * rs.length)].toFixed(2), scalp: +scalp.toFixed(2) };
}
// the vault's SDF: the ellipsoid's (IQ bound) plus the harmonic correction in its direction (a radial bump field; fine for the slow shape)
export function vaultPrim(V, o = {}) {
  const E = D.ellipsoid(V.c, V.r, o), sh = V.sh; if (!sh) return E; const [cx, cy, cz] = V.c, [a, b, c] = V.r, mx = Math.max(...sh.map(Math.abs)) * 4 + 4;
  const corr = (x, y, z) => { let u = (x - cx) / a, v = (y - cy) / b, w = (z - cz) / c; const l = Math.hypot(u, v, w) || 1; u /= l; v /= l; w /= l;
    const B = [1, v, w, u * u, v * v, w * w, v * w, u * u * v, u * u * w, v * v * w, v * w * w, v * v * v, w * w * w, u * u * u * u, v * v * v * v, w * w * w * w, u * u * v * v, u * u * w * w, v * v * w * w]; let s = 0; for (let i = 0; i < B.length; i++) s += B[i] * sh[i]; return s; };
  return { ...E, kind: 'vault', d: (x, y, z) => E.d(x, y, z) - corr(x, y, z), aabb: E.aabb.map((v, i) => v + (i < 3 ? -mx : mx)) };
}

// ---------------------------------------------------------------- geometry helpers
// Catmull-Rom through pts, n samples per segment
export function spline(pts, n = 6) { return D.catmull(pts, n); }
// resample a polyline at arc lengths (returns points and tangents)
function arcAt(poly, s) { let acc = 0; for (let i = 0; i + 1 < poly.length; i++) { const l = v3.dist(poly[i], poly[i + 1]); if (acc + l >= s || i + 2 === poly.length) { const t = clamp((s - acc) / (l || 1), 0, 1); return { p: v3.lerp(poly[i], poly[i + 1], t), t: v3.norm(v3.sub(poly[i + 1], poly[i])) }; } acc += l; } return { p: poly[poly.length - 1], t: [1, 0, 0] }; }
const polyLen = poly => poly.reduce((a, p, i) => (i ? a + v3.dist(poly[i - 1], p) : 0), 0);
// both sides: build on the left (+x) and mirror
const both = (S, mk, op = 'add', k = 0) => { const p = mk(); S.push(op === 'add' && (typeof k === 'function' || k > 0) ? 'smooth' : op, p, k); S.push(op === 'add' && (typeof k === 'function' || k > 0) ? 'smooth' : op, D.mirrorX(p), k); };
// the outward (buccal / labial) horizontal normal of an arch's tangent on the left side
const outOf = t => v3.norm([-t[2], 0, t[0]]);
// a floor: the solid lies ABOVE y = f(x, z) (a bound: the height difference over the slope)
function floorPrim(f, o = {}) { const e = 0.5; return D.custom((x, y, z) => { const F = f(x, z), fx = (f(x + e, z) - f(x - e, z)) / (2 * e), fz = (f(x, z + e) - f(x, z - e)) / (2 * e); return (F - y) / Math.sqrt(1 + fx * fx + fz * fz); }, [-1e3, -1e3, -1e3, 1e3, 1e3, 1e3], o); }

// ---------------------------------------------------------------- the mandible's solve (profile plane: y up, z forward)
// Go between the condylion Co and the menton Me: the ramus height (Co-Go, projected), the body length (Go-Me, projected), the gonial angle
// (Co-Go-Me) and the FMA (Me-Go to the FH) each scored by its z against the draw; the condylion may move in its own scatter
export function solveMandible(K, Co0, Me, dxRamus = 6, dxBody = 40) {
  const m = K.sex === 'm', sdRH = sdOf('RH', K.sex), sdGM = sdOf('GoMe', K.sex), FMA_mu = m ? 24.5 : 26, FMA_sd = 5;
  const RHp = Math.sqrt(Math.max(1, K.RH ** 2 - dxRamus ** 2));
  let best = null;
  for (let dy = -2; dy <= 2; dy += 0.5) for (let dz = -2; dz <= 2; dz += 0.5) { const Co = [Co0[0], Co0[1] + dy, Co0[2] + dz], zc = (dy / 1.3) ** 2 + (dz / 1.8) ** 2;
    for (let gy = Co[1] - 75; gy <= Co[1] - 35; gy += 0.5) for (let gz = Co[2] - 15; gz <= Co[2] + 25; gz += 0.5) {
      const rh = Math.hypot(Co[1] - gy, Co[2] - gz), gm = Math.hypot(Me[1] - gy, Me[2] - gz), u = [Co[1] - gy, Co[2] - gz], w = [Me[1] - gy, Me[2] - gz];
      const ang = deg(Math.acos(clamp((u[0] * w[0] + u[1] * w[1]) / (rh * gm), -1, 1))), fma = deg(Math.atan2(gy - Me[1], Me[2] - gz));
      const c = ((rh - RHp) / sdRH) ** 2 + ((gm - K.GoMe) / sdGM) ** 2 + ((ang - K.gonial) / 6) ** 2 + 0.6 * ((fma - FMA_mu) / FMA_sd) ** 2 + zc;
      if (!best || c < best.c) best = { c, Co, Go: [gy, gz], rh, gm, ang, fma }; } }
  return best;
}

// ---------------------------------------------------------------- the skull
export function buildSkull(K) {
  const m = K.sex === 'm', lm = {}, report = {};
  const rob = clamp((K.browRidge - 2.6) / 3.2, 0, 1);            // robusticity: the brow, the glabella, the mastoids, the gonial eversion
  const gw = (o => Object.entries(K.mix).reduce((a, [g, w]) => a + w * (o[g] ?? o.white), 0) / Object.values(K.mix).reduce((a, b) => a + b, 0));
  // ---- the frame's key points (NOTES.md, design 2): the face placed round the EYE
  const bp = K.AUB - 4, xD = K.DKB / 2, xOc = xD + K.OBB / 2, xEc = xD + K.OBB, hh = K.OBH / 2, hw = K.OBB / 2;
  const yOc = K.OBH / 2 + 0.5, ySupM = yOc + hh, yIn = yOc - hh - 0.5;
  const cornea = (m ? 0.99 : 0.94) * K.BNL - 8, zLatH = cornea - K.hertel, zFMA = zLatH + 5;
  const zN = zFMA + K.nasDepth, yN = yIn + 0.78 * K.OBH, N = [0, yN, zN];
  const zSup = cornea + gw(m ? { white: 5, black: 3.5, asian: 2, amerind: 3.5 } : { white: 2.5, black: 2, asian: 1, amerind: 2 });
  const zInf = cornea - gw({ white: 2, black: 3, asian: 3.5, amerind: 3 }) + K.orbitRim, zMed = zN - 7.5;
  // the GLABELLA: GLS is the bone's glabellar prominence AS BUILT, the robust brow's pillow included (the glabellar ellipsoid below stands
  // ~2.6 mm x rob in front of zG: measured on the build, rev 2.1); so zG = the GLS front less that pillow (rev 2.1-3 added the pillow on
  // top of GLS, counting it twice, and then pulled the excess toward the ten HSRD-100 heads' soft glabella, keeping 45 % within +-3 mm:
  // a measurement constructing the form. Rev 4: no pull; the scans only measure the result)
  const yG = yN + (m ? 11 : 10), zGfront = zN + 1 + 0.8 * K.GLS, gBump = rob > 0.15 ? 2.6 * rob : 0, zG = zGfront - gBump, G = [0, yG, zG];
  report.glabella = { frontAhead: +(zGfront - cornea).toFixed(1), pillow: +gBump.toFixed(1) };
  lm.N = N; lm.G = G; lm.cornea = cornea; lm.FMA_z = zFMA; lm.Hertel_z = zLatH; lm.Po_L = [bp / 2, 0, 0]; lm.Or_L = [xOc - 1, yIn, zInf];
  // the vertical chain: nasal height, ANS, prosthion, the incisors, infradentale
  const yANS = yN - K.NLH, zANS = zN + 1.5 + 0.7 * K.progn, yPr = yN - K.NPH, zPr = zN - 0.5 + K.progn, yA = (yANS + yPr) / 2 + 1, zA = Math.min(zANS, zPr) - 2.5;
  const ui = rad(K.upperInc), li = rad(K.lowerInc), crU = TEETH.crown[K.sex][0], crL = TEETH.lowCrown[K.sex][0];
  const UIE = [0, yPr - 1.5 - crU * Math.cos(ui), zPr + 0.6 + crU * Math.sin(ui)];            // the upper incisal edge, its labial face
  const LIE = [0, UIE[1] + TEETH.overbite, UIE[2] - TEETH.overjet];                            // the lower incisal edge's labial face: overjet / overbite
  const Id = [0, LIE[1] - crL * Math.cos(li) - 1.5, LIE[2] - crL * Math.sin(li) - 0.4];
  // the chin: the bony menton by the drawn N-Me, the pogonion ahead of the incisors' line by the chin's projection (rev 4: nothing from the
  // living chin)
  const yMe = yN - K.NMe, PogZ = Id[2] - 2 + K.chinProj;
  const Pog = [0, yMe + (m ? 11 : 10), PogZ], Me = [0, yMe, PogZ - (m ? 8 : 7)], Gn = [0, yMe + 3.4, PogZ - 2.6], Bp = [0, (Id[1] + Pog[1]) / 2 + 1, Math.min(Id[2], PogZ) - (m ? 2.6 : 2.2)];
  const yPal = yANS - 7, zPNS = zPr - (m ? 50 : 47);
  Object.assign(lm, { ANS: [0, yANS, zANS], A: [0, yA, zA], Pr: [0, yPr, zPr], UIE, LIE, Id, B: Bp, Pog, Gn, Me, PNS: [0, yANS - 3, zPNS] });
  // the basion from the basion-nasion length (BNL) at ~20 mm under the FH; the opisthion behind it
  const yBa = -20.5, zBa = zN - Math.sqrt(Math.max(400, K.BNL ** 2 - (yN - yBa) ** 2)), Ba = [0, yBa, zBa], Opi = [0, yBa + 3, zBa - (m ? 36 : 34)];
  lm.Ba = Ba; lm.Opi = Opi;
  // ---- the mandible's frame: the condylion drawn per person, the gonion SOLVED (solveMandible)
  const Cc0 = [K.coCo / 2 - 9.5, K.CoY - 4.6, K.CoZ], sol = solveMandible(K, [Cc0[0], K.CoY, K.CoZ], [0, Me[1], Me[2]], Math.abs(Cc0[0] - K.goGo / 2), K.goGo / 2);
  const Co = [Cc0[0], sol.Co[1], sol.Co[2]], Cc = [Co[0], Co[1] - 4.6, Co[2]], Go = [K.goGo / 2, sol.Go[0], sol.Go[1]];
  // the sigmoid notch's floor and the CORONOID's tip (rev 2.1: Cor is the tip as built, a few mm under the condylion; rev 2's landmark sat
  // 9-10 mm under the tip the ramus' corner made: the temporalis inserts on the tip)
  const Nt = [Co[0] - 4, Co[1] - (m ? 15 : 13.5), Co[2] + (m ? 15 : 14)], Cor = [Co[0] - 10, Co[1] - (m ? 4 : 3.5), Co[2] + (m ? 33 : 31)];
  Object.assign(lm, { Co_L: Co, Go_L: Go, Cor_L: Cor, Notch_L: Nt, gonialAngle: +sol.ang.toFixed(1), FMA: +sol.fma.toFixed(1), RHp: +sol.rh.toFixed(1), GoMe: +sol.gm.toFixed(1) });
  report.mandible = { cost: +sol.c.toFixed(2), RH: [+K.RH, +sol.rh.toFixed(1)], GoMe: [+K.GoMe, +sol.gm.toFixed(1)], gonial: [+K.gonial, +sol.ang.toFixed(1)], FMA: +sol.fma.toFixed(1), CoMove: [+(sol.Co[1] - K.CoY).toFixed(1), +(sol.Co[2] - K.CoZ).toFixed(1)] };

  // ---- the scenes
  const C = LBL.cranium, Fc = LBL.face, Md = LBL.mandible, Tt = LBL.teeth;
  const skull = D.scene([], 'skull', { label: C }), mand = D.scene([], 'mandible', { label: Md }), teethU = D.scene([], 'upper teeth', { label: Tt }), teethL = D.scene([], 'lower teeth', { label: Tt });

  // ================= 1. THE VAULT, clipped by the cranial base; its back shortened to the GOL guard
  let V = K.vault, vault, zOp, yVc, ayV, azV, zVc;
  if (V) { yVc = V.c[1]; zVc = V.c[2]; ayV = V.r[1]; azV = V.r[2]; vault = vaultPrim(V, { label: C, name: 'vault' }); }
  else { zOp = zG - K.GOL; yVc = m ? 34 : 33; ayV = K.BBH - (m ? 19 : 18) - yVc; azV = ((zN - 14) - zOp) / 2; zVc = zOp + azV; vault = D.ellipsoid([0, yVc, zVc], [K.XCB / 2 - 3.5, ayV, azV], { label: C, name: 'vault' }); }
  { let zb = Infinity; for (let y = yVc - 30; y <= yVc + 30; y += 3) { const t = D.rayHit(vault, [0, y, zVc - 200], [0, 0, 1], 260); if (t != null) zb = Math.min(zb, zVc - 200 + t); }
    zOp = zb; const gol = zG + 1.5 + 0.6 * gBump - zOp; report.vault = { GOLraw: +gol.toFixed(1), golMax: K.golMax };
    if (gol > K.golMax) { const ex = gol - K.golMax, L0 = zVc - zOp, R = 0.7 * L0, s = 1 + ex / (L0 - R / 2 - ex);   // the back shortened by ex (smooth stretch ramp)
      vault = D.squeeze(vault, zVc, 2, s, -1, { label: C, name: 'vault', ramp: R }); zOp += ex; report.vault.shortened = +ex.toFixed(1); } }
  // the external cranial base (the vault's underside replaced): the sphenoid / infratemporal roof in front (~4 mm under the FH), down
  // past the basion to the foramen magnum (~ basion level), the nuchal plane rising behind to the inion; lower laterally behind the porion
  const yInion = clamp(yVc - 0.45 * ayV, 4, 14), zInionGuess = zOp + 6;
  const yBase = (x, z) => { const ax = Math.abs(x);
    let y = z >= zBa + 14 ? -4 : z >= zBa - 6 ? lerp(yBa + 1, -4, sstep(zBa - 6, zBa + 14, z)) : z >= Opi[2] ? yBa + 1 : lerp(yBa + 1, yInion - 2, sstep(Opi[2], zInionGuess, z));
    const lat = sstep(28, 44, ax) * (1 - sstep(4, 16, z)) * sstep(zOp + 20, zOp + 45, z); y = Math.min(y, lerp(y, -15, lat));
    return y + 0.008 * ax * ax * sstep(Opi[2], Opi[2] - 25, z); };
  const vS = D.scene([], 'vault+base', { label: C }); vS.add(vault); const kBase = (x, y, z) => lerp(m ? 7 : 9, 14, sstep(Opi[2] - 10, Opi[2] - 40, z)); kBase.max = 14; vS.inter(floorPrim(yBase, { label: C, name: 'cranial base' }), kBase);
  skull.add(vS);

  // ================= 2. THE BROW AND FOREHEAD: a height slab (the front surface an analytic function), merging into the vault
  // the vault's own front (for the blend at the top of the slab)
  // rev 2.1 (it3): sampled every 5 mm; a ray that MISSES the vault (beyond its side) is NaN, never a stand-in depth (rev 2 used zG - 40,
  // which, interpolated against the vault's side, put the brow slab's front 10-25 mm outside the vault: the measurer's torn 'temporal tab')
  const vaultFront = (() => { const xs = [], ys = []; for (let x = 0; x <= 75; x += 5) xs.push(x); for (let y = yN + 8; y <= yN + 93; y += 5) ys.push(y);
    const T = ys.map(y => xs.map(x => { const t = D.rayHit(vS, [x, y, zG + 60], [0, 0, -1], 200); return t == null ? NaN : zG + 60 - t; }));
    return (x, y) => { const ax = Math.abs(x), i = clamp(Math.floor(ax / 5), 0, xs.length - 2), u = clamp((ax - xs[i]) / 5, 0, 1), jf = clamp((y - ys[0]) / 5, 0, ys.length - 1.0001), j = Math.floor(jf), v = jf - j;
      return lerp(lerp(T[j][i], T[j][i + 1], u), lerp(T[j + 1][i], T[j + 1][i + 1], u), v); }; })();
  const slope = Math.tan(rad(K.frontalSlope));
  // the forehead in profile: the frontal inclination and the frontal bone's curvature (an arc of ~70-85 mm, women rounder), from the
  // glabella up until it passes under the vault (the vault fitted to the scalp takes over above)
  const Rfp = m ? 85 : 72, fh = d => zG - d * slope - d * d / (2 * Rfp);
  const zMidBrow = profile([[yN - 4, zN - 0.3], [yN, zN + 0.2], [yN + 5, zN + 0.55 * (zG - zN) + 0.4], [yG, zG], [yG + 8, fh(8) - 0.3], [yG + 20, fh(20)], [yG + 34, fh(34)], [yG + 48, fh(48)], [yG + 62, fh(62)], [yG + 76, fh(76)]]);
  // the margin-level plan curve: glabella, above the medial canthus, the supraorbital margin over the pupil (its notch), the lateral third
  // turning back, the zygomatic process of the frontal bone
  const zm = profile([[0, zG - 0.6], [xD + 2, zN - 0.2 + 1.2 * rob], [xOc - 5, zSup + 0.6 * rob], [xOc + 5, zSup - 1.4], [xEc - 4, zFMA + 3.8], [xEc + 1, zFMA + 0.6], [xEc + 8, zFMA - 6]]);
  const Rf = m ? 60 : 56;
  // the front of the frontal bone: the anatomical brow and forehead, never inside the vault (a smooth max with the vault's own front, so
  // the two meet without a step where the forehead passes under the vault)
  const xTL = y => K.WFB / 2 - 4 + 0.25 * Math.max(0, y - yN - 10);           // the temporal line on the frontal bone, diverging upward
  const browZ0 = (x, y) => { const ax = Math.abs(x), s = sstep(ySupM + 1, ySupM + 20, y), dm = zm(0) - zm(ax), df = ax * ax / (2 * Rf) + 0.035 * Math.max(0, ax - 26) ** 2 + 0.3 * Math.max(0, ax - xTL(y)) ** 2; return zMidBrow(y) - lerp(dm, df, s); };
  const browF = (x, y) => { const ax = Math.abs(x), z0 = browZ0(x, y), vf0 = vaultFront(ax, y); if (!(vf0 === vf0)) return z0;
    const vf = vf0 - 0.6, w = sstep(3, -1.5, z0 - vf); return lerp(z0, vf, w) - 2 * sstep(-1.5, -4.5, z0 - vf) - (y > yN + 70 ? (y - yN - 70) * 0.6 : 0); };
  const browBox = [-(xEc + 10), yN - 4, zFMA - 50, xEc + 10, yN + 86, zG + 6];
  // the slab exists only where the frontal bone stands IN FRONT of the vault (or within 5 mm inside it, where it follows the vault 0.6 mm
  // inside): where the analytic forehead lies deep inside the vault, or the vault is absent (a ray missed), it is outside the region
  const browBoxR = D.regionBox(-(xEc + 9), yN - 4, xEc + 9, yN + 84, 8), browRegion = (x, y) => { const vf = vaultFront(Math.abs(x), y), r0 = browBoxR(x, y);
    if (!(vf === vf)) return Math.max(r0, 6); return D.smax(r0, (vf - 6) - browZ0(x, y), 2); };
  skull.add(D.heightSlab(browF, 16, browRegion, { k: 2, label: C, name: 'frontal bone', aabb: browBox }), 4);
  // the frontal eminences (women's more marked), the men's superciliary arches and glabellar pillow
  both(skull, () => D.ellipsoid([27, yN + 42, browF(27, yN + 42) - (m ? 8 : 6.6)], [16, 15, 7], { label: C, name: 'frontal eminence' }), 'add', 8);
  if (rob > 0.15) { both(skull, () => D.ellipsoid([xOc - 8, ySupM + 6, browF(xOc - 8, ySupM + 6) - 3.6 + 1.6 * rob], [11, 4.6, 4.4], { label: C, name: 'superciliary arch', basis: D.basis([0.25, 0.1, 1], [1, 0, -0.25]) }), 'add', 5);
    skull.add(D.ellipsoid([0, yG - 1, zG - 4.6 + 1.2 * rob], [13, 6, 4.2], { label: C, name: 'glabella' }), 7); }

  // the anterior cranial base behind the face (sphenoid body and greater wings, ethmoid): solid like the rest of the braincase; the orbits,
  // the nasal cavity and the temporal fossae are carved from it
  skull.add(D.ellipsoid([0, yOc - 3, cornea - 38], [xEc - 2, 20, 26], { label: C, name: 'sphenoid and ethmoid' }), 6);
  // ================= 3. THE TEMPORAL FOSSAE: carved behind the lateral orbital rims, above the arches (the minimum frontal breadth WFB)
  const yFt = yN + 14, zFt = zFMA - 12;
  // the vault's own side (x of its surface at (y, z)): the fossa's floor rises to it at the temporal line and fades behind
  const vaultSide = (() => { const ys = [], zs = []; for (let y = -30; y <= yN + 66; y += 6) ys.push(y); for (let z = -40; z <= zFMA + 6; z += 6) zs.push(z);
    const T = ys.map(y => zs.map(z => { const t = D.rayHit(vS, [130, y, z], [-1, 0, 0], 200); return t == null ? 20 : 130 - t; }));
    return (y, z) => { const jf = clamp((y - ys[0]) / 6, 0, ys.length - 1.0001), j = Math.floor(jf), v = jf - j, if_ = clamp((z - zs[0]) / 6, 0, zs.length - 1.0001), i = Math.floor(if_), u = if_ - i;
      return lerp(lerp(T[j][i], T[j][i + 1], u), lerp(T[j + 1][i], T[j + 1][i + 1], u), v); }; })();
  const fossaFloor = (y, z) => { const base = K.WFB / 2 - 0.3 + 0.07 * Math.max(0, zFt - 4 - z) + 0.004 * Math.max(0, (yFt - 8) - y) ** 2, side = vaultSide(y, z) + 0.8;
    return lerp(base, Math.max(base, side), Math.max(sstep(yFt + 4, yN + 46, y), sstep(zFMA - 50, zFMA - 82, z))); };
  const fossaRegion = D.regionPoly([[-40, zInf - 34], [yIn - 6, zLatH - 9], [yOc + 6, zLatH - 7.5], [yN + 4, zFMA - 7], [yN + 16, zFMA - 9.5], [yN + 30, zFMA - 22], [yN + 42, zFMA - 44], [yN + 46, zFMA - 70], [yN + 36, -12], [16, -24], [-2, -24], [-40, -24]]);
  both(skull, () => D.heightSlab(fossaFloor, 70, fossaRegion, { axis: 'x', dir: -1, k: 7, label: C, name: 'temporal fossa', aabb: [K.WFB / 2 - 8, -45, -30, 140, yN + 52, zFMA + 2] }), 'sub', 7);

  // ================= 4. THE CRANIAL BASE: occipital condyles, basiocciput, mastoids, styloids, the inion and the superior nuchal lines
  const ocL = v3.norm([-0.42, 0, 1]), ocU = v3.norm(v3.cross([0, 1, 0], ocL));
  both(skull, () => D.ellipsoid([12.5, yBa - 4.5, zBa - 9], [5.2, 4.6, 11], { label: C, name: 'occipital condyle', basis: [ocU, [0, 1, 0], ocL] }), 'add', 3);
  skull.add(D.sweep([[0, yBa + 2.5, zBa - 1], [0, yBa + 9, zBa + 9], [0, -6, zBa + 22]], [{ a: 4, b: 10.5 }, { a: 4.8, b: 12 }, { a: 6, b: 14 }], { up: [0, 1, 0], label: C, name: 'basiocciput' }), 5);
  const msTip = [bp / 2 - 5.5, -(K.MDH - 1), -9];
  both(skull, () => D.roundCone([bp / 2 - 1, -7, -13], msTip, m ? 10.5 : 9, m ? 4.8 : 3.8, { label: C, name: 'mastoid' }), 'add', 4);
  both(skull, () => D.ellipsoid([bp / 2 - 3, -9, -21], [8 + 2 * rob, 9, 12], { label: C, name: 'mastoid base' }), 'add', 6);
  both(skull, () => D.roundCone([bp / 2 - 15, -9, -1], [bp / 2 - 22, -32, 9], 2.2, 1.4, { label: C, name: 'styloid' }), 'add', 1.5);
  // the external occipital protuberance and the superior nuchal lines, laid on the vault's surface (the trapezius and the SCM insert here)
  const back = (x, y) => { const t = D.rayHit(vS, [x, y, zOp - 40], [0, 0, 1], 140); return t == null ? null : [x, y, zOp - 40 + t]; };
  lm.Inion = back(0, yInion); lm.SNL_med_L = back(16, yInion - 1); lm.SNL_lat_L = back(34, yInion - 4); const snl3 = back(48, yInion - 9);
  if (lm.Inion) skull.add(D.sphere(v3.add(lm.Inion, [0, 0, 1.6]), m ? 3.6 + 1.5 * rob : 2.4, { label: C, name: 'occipital protuberance' }), 3);
  if (lm.SNL_med_L && lm.SNL_lat_L && snl3) both(skull, () => D.tube([lm.Inion, lm.SNL_med_L, lm.SNL_lat_L, snl3].map(p => v3.add(p, [0, 0, 0.6])), [m ? 2.2 : 1.5, m ? 2.0 : 1.4, 1.6, 1.3], { k: 1, label: C, name: 'superior nuchal line' }), 'add', 2.5);

  // ================= 5. THE FACIAL SKELETON (masses; the cavities are carved after)
  // ---- the bony NASAL PYRAMID: the nasal bones (a rounded tent, a concave saddle at the nasion) and the frontal processes of the maxilla
  const na = rad(K.nasalAng), Lnb = K.nasalLen, Rhi = [0, yN - Lnb * Math.cos(na), zN + Lnb * Math.sin(na)]; lm.Rhi = Rhi;
  const cotTop = gw({ white: 0.95, black: 0.78, asian: 0.72, amerind: 0.88 }), cotLow = gw({ white: 1.75, black: 1.2, asian: 1.15, amerind: 1.45 }) + 0.06 * (K.nasDepth - 16);
  const zDors = y => { if (y >= yN) return zN + (zG - zN) * 0.35 * sstep(yN, yN + 8, y); const s = clamp((yN - y) / (Lnb * Math.cos(na)), 0, 1.6); return zN + Lnb * Math.sin(na) * Math.pow(s, 1.18); };
  const nasF = (x, y) => { const ax = Math.abs(x), s = clamp((yN - y) / (yN - Rhi[1]), 0, 1.4), cot = lerp(cotTop, cotLow, Math.min(1, s)), rr = lerp(6, 2.4, Math.min(1, s));
    return zDors(y) - (Math.sqrt(ax * ax + rr * rr) - rr) * cot - 0.012 * Math.max(0, ax - xD) ** 2 * 3; };
  // rev 2.1: the plate keeps >= 4 mm (along its normal) to the free margin so the aperture's cut leaves a margin of >= 2.6 mm at a 1.0-1.25
  // mm net (rev 2's 3.4 left a knife edge that aliased: the measurer's stippled free margin); the front (the dorsum) does not move
  const nasT = (x, y) => lerp(8, 4.2, clamp((yN - y) / (yN - Rhi[1]), 0, 1)) + 0.25 * Math.abs(x);
  skull.add(D.heightSlab(nasF, nasT, D.regionPoly([[-(xD + 1), yN + 5], [xD + 1, yN + 5], [xD + 6, yN - 10], [xD + 10, yANS + 6], [-(xD + 10), yANS + 6], [-(xD + 6), yN - 10]]), { k: 1.5, label: Fc, name: 'nasal bones', aabb: [-(xD + 12), yANS + 4, zMed - 20, xD + 12, yN + 7, Rhi[2] + 6] }), 2);
  // ---- the MAXILLA's front: plan curvature from the cheek to the dental arch, the canine eminence over the canine root, the canine fossa
  const upArchRaw = [[0, 0, 0], [8, 0.4, -2.0], [15.5, 1.0, -7.0], [21.5, 1.8, -14], [25.5, 2.6, -21.5], [28.5, 3.6, -31], [30, 4.8, -41]];
  const ax = K.MAB / 63, upOcc = spline(upArchRaw.map(p => [p[0] * ax, UIE[1] + p[1], UIE[2] + p[2]]), 8);
  const xCan = 15.5 * ax + 0.5;
  const zMmid = profile([[yPr + 5, zPr - 2.2], [yA, zA - 0.2], [yANS, zANS - 2.6], [yANS + 8, zANS - 4.5], [yIn + 3, zInf + 7]]);
  // the face's plan curve at two levels, blended in height: at the alveolar level the dental arch; at the malar level the infraorbital
  // margin's line out to the malar eminence (the zygoma's body faces forward: Mal is only |malarProj| behind the orbitale) and the turn
  // back to the arch. As drops behind the midline profile (zMmid), with the canine eminence, the canine fossa and the malar eminence.
  const Mal = [xOc + 13, yIn - 11, zInf + K.malarProj], yUp = yIn - 6, yLow = yPr + 9, zUp0 = zMmid(yUp);
  const dropUp = profile([[0, 0], [10, zUp0 - (zInf + 4)], [xOc - 4, zUp0 - (zInf + 1.4)], [xOc + 4, zUp0 - (zInf - 0.6 + 0.5 * K.malarProj)], [Mal[0], zUp0 - (zInf + K.malarProj - 0.6)], [Mal[0] + 7, zUp0 - (zInf + K.malarProj - 6)], [Mal[0] + 13, zUp0 - (zInf + K.malarProj - 17)], [Mal[0] + 18, zUp0 - (zInf + K.malarProj - 30)]]);
  const RpL = m ? 31 : 29, dropLow = x => x * x / (2 * RpL) + 0.02 * Math.max(0, x - 26) ** 2 * 3;
  const maxF = (x, y) => { const ax2 = Math.abs(x), t = sstep(yLow, yUp, y); let z = zMmid(y) - lerp(dropLow(ax2), dropUp(ax2), t);
    z += 1.5 * Math.exp(-(((ax2 - xCan + 0.15 * (y - yPr)) / 3.6) ** 2)) * sstep(yPr + 2, yPr + 8, y) * (1 - sstep(yANS - 4, yANS + 4, y));
    z -= (m ? 3.4 : 3.0) * Math.exp(-(((ax2 - xCan - 7) / 7) ** 2) - (((y - yANS - 1.5) / 7.5) ** 2));
    z += 1.2 * Math.exp(-(((ax2 - Mal[0]) / 9) ** 2) - (((y - Mal[1]) / 8) ** 2));
    return z; };
  both(skull, () => D.heightSlab(maxF, 7, D.regionPoly([[-3, yPr + 4], [xCan + 6, yPr + 6], [31, yPr + 12], [Mal[0] - 1, yIn - 22], [Mal[0] + 1, yIn - 17], [Mal[0] + 2, yIn - 3], [xEc + 2, yIn + 4], [-3, yIn + 4]]), { k: 2.5, label: Fc, name: 'maxilla and zygoma', aabb: [-4, yPr + 2, zInf - 40, Mal[0] + 18, yIn + 6, zANS + 4] }), 'add', 3);
  // the maxilla's body behind its front (the sinus is not modelled: solid), the palate and the upper ALVEOLAR process (a sweep along the arch)
  both(skull, () => D.ellipsoid([xOc - 10, (yIn + yPr + 10) / 2, zInf - 17], [13, (yIn - yPr - 10) / 2 + 1, 16], { label: Fc, name: 'maxillary body' }), 'add', 5);
  skull.add(D.ellipsoid([0, yPal - 2, (zPr + zPNS) / 2 - 3], [K.MAB / 2 - 10, 5, (zPr - zPNS) / 2 + 1], { label: Fc, name: 'palate' }), 4);
  // the teeth's labial / buccal curve at the cervix (the alveolar process' spine runs inside it)
  const toothArc = (poly, W) => { const L0 = polyLen(poly), out = []; let s = 0; for (let i = 0; i < 7; i++) { const c = arcAt(poly, Math.min(L0, s + W[i] / 2)); out.push({ i, s: s + W[i] / 2, p: c.p, t: c.t, n: outOf(c.t) }); s += W[i]; } return out; };
  const upT = toothArc(upOcc, TEETH.width.map(w => w * ax));
  const lowArchRaw = [[0, 0, 0], [5.6, 0, -1.4], [11.6, -0.1, -4.9], [16.6, -0.2, -10.6], [21.2, 0.2, -17.6], [24.6, 1.1, -26.6], [26.6, 2.4, -37]];
  const lowOcc = spline(lowArchRaw.map(p => [p[0] * ax, LIE[1] + p[1], LIE[2] + p[2]]), 8), lowT = toothArc(lowOcc, TEETH.lowWidth.map(w => w * ax * 0.98));
  // each tooth's own frame and crown profile: T from the edge toward the cervix along its inclination, U the arch's tangent (mesiodistal),
  // the profile [t along the crown (0 edge, 1 cervix, > 1 root), mesiodistal half, labial half, lingual half]; E the edge's centre line,
  // placed so the labial (buccal) face at the edge lies on the arch curve
  const toothGeom = (o, upper) => { const i = o.i, W = (upper ? TEETH.width : TEETH.lowWidth)[i] * ax, Th = TEETH.thick[i] * (upper ? 1 : 0.88), Cr = (upper ? TEETH.crown : TEETH.lowCrown)[K.sex][i];
    const inc = rad((upper ? K.upperInc : K.lowerInc) * clamp(1 - i / 4.5, 0.1, 1)), vert = upper ? 1 : -1;
    const T = v3.norm([-o.n[0] * Math.sin(inc), vert * Math.cos(inc), -o.n[2] * Math.sin(inc)]), U = o.t, labSign = v3.dot(v3.cross(T, U), o.n) > 0 ? 1 : -1, ant = i <= 2;
    const prof = ant ? (i === 2 ? [[0, 1.4, 1.2, 1.2], [0.28, W / 2 * 0.96, Th * 0.3, Th * 0.32], [0.7, W / 2 * 0.86, Th * 0.4, Th * 0.48], [1, W / 2 * 0.7, Th * 0.42, Th * 0.48], [1.5, 2.4, 2.6, 2.6]]
      : [[0, W / 2 * 0.9, 0.55, 0.6], [0.3, W / 2, Th * 0.18, Th * 0.3], [0.7, W / 2 * 0.9, Th * 0.24, Th * 0.42], [1, W / 2 * 0.72, Th * 0.32, Th * 0.45], [1.5, 2, 2.2, 2.4]])
      : [[0, W / 2 * 0.8, Th / 2 * 0.78, Th / 2 * 0.78], [0.35, W / 2, Th / 2, Th / 2], [1, W / 2 * 0.82, Th / 2 * 0.86, Th / 2 * 0.86], [1.45, W / 2 * 0.6, Th / 2 * 0.6, Th / 2 * 0.6]];
    const E = v3.sub(o.p, v3.mul(o.n, prof[0][2])), cerv = v3.add(E, v3.mul(T, Cr));
    return { i, W, Th, Cr, T, U, labSign, ant, prof, E, cerv, labC: prof.find(q => q[0] === 1)[2], linC: prof.find(q => q[0] === 1)[3], upper }; };
  const upG = upT.map(o => toothGeom(o, true)), lowG = lowT.map(o => toothGeom(o, false));
  // the ALVEOLAR process along the roots: a sweep whose spine runs up each root (crest 1.5 mm past the cervix), its section's axis the
  // tooth's own (the labial plate leans with the roots), labial bone thin over the roots (the juga), the canine's the strongest
  const alveolus = (Gs, upper, label, name) => { const L = Gs.map(g => v3.add(g.cerv, v3.mul(g.T, 6.1))), ups = Gs.map(g => g.T);
    const sp = [...L.slice().reverse().map(v3.mirrorX), ...L], up = [...ups.slice().reverse().map(v3.mirrorX), ...ups], gg = [...Gs.slice().reverse(), ...Gs];
    const sec = gg.map(g => { const jug = g.i === 2 ? 1.0 : g.i < 2 ? 0.45 : 0, lab = g.labC + 1.0 + jug + (g.i >= 5 ? 0.8 : 0), lin = g.linC + 1.4 + (g.i >= 5 ? 0.6 : 0);
      return { a: [9, 4.6], b: upper ? [lab, lin] : [lin, lab], n: 2.4 }; });
    return D.sweep(sp, sec, { up, sub: 2, label, name }); };
  skull.add(alveolus(upG, true, Fc, 'upper alveolar process'), 3);
  // ---- the ZYGOMA: body (the malar eminence, facing forward and out), frontal process (the lateral orbital margin), the arch (a bowed
  // sweep, deep in front, to the articular tubercle and the root over the meatus), the zygomaticoalveolar buttress to the first molar
  const fnZ = v3.norm([0.62, -0.12, 0.78]);
  both(skull, () => D.ellipsoid(v3.sub(Mal, v3.mul(fnZ, 8)), [13, 11.5, 7.5], { label: Fc, name: 'zygomatic body', basis: D.basis(fnZ, [1, 0, -0.8]) }), 'add', 4);
  both(skull, () => D.sweep([[xEc - 2, yIn - 7, zLatH - 6], [xEc + 2.2, yOc - 3, zLatH - 5.2], [xEc + 2.4, yOc + 6, zFMA - 5.4], [xEc + 0.5, yOc + 14, zFMA - 6.2]],
    [{ a: 6.5, b: 4 }, { a: 5.2, b: 3.1 }, { a: 5, b: 3.1 }, { a: 5.5, b: 3.4 }], { up: [0.12, 0, 1], label: Fc, name: 'frontal process of zygoma' }), 'add', 2);
  const zTub = Co[2] + 9, zZy = zTub + 0.38 * (Mal[2] - 14 - zTub);
  // rev 2.1: the ARCH a flattened strip (a superellipse section: height by sex and robusticity, ~4.4-4.8 mm thick), not a tube identical on
  // everyone; its posterior root runs ABOVE the glenoid fossa (rev 2's root met the condyle's lateral pole: the welded TMJ)
  const aH = (m ? 4.6 : 3.9) + 0.6 * rob, aT = m ? 2.4 : 2.2;
  const arch = [[Mal[0] - 2, Mal[1] + 0.5, Mal[2] - 7.5], [Mal[0] + 6, Mal[1] + 1, Mal[2] - 12], [K.ZYB / 2 - 5, -7.2, zZy + 14], [K.ZYB / 2 - 2.7, -6.8, zZy], [bp / 2 + 4.5, -6, zTub], [bp / 2 + 2.5, Math.max(-2.2, Co[1] + 4.2), Co[2] + 1]];
  both(skull, () => D.sweep(arch, [{ a: [10, 11], b: 7.2 }, { a: [8, 9.5], b: 5 }, { a: [aH, aH + 1.2], b: aT + 0.3, n: 2.6 }, { a: [aH - 0.4, aH + 0.6], b: aT, n: 2.8 }, { a: [aH - 0.6, aH + 0.4], b: aT + 0.4, n: 2.6 }, { a: [3.2, 2.6], b: 3 }], { up: [0, 1, 0], label: Fc, name: 'zygoma and arch' }), 'add', 3);
  both(skull, () => D.tube([[bp / 2 + 2, -1, Co[2]], [bp / 2 + 1.5, 2.5, -4], [bp / 2 - 1, 5, -18]], [2.4, 2, 1.6], { k: 1, label: C, name: 'supramastoid crest' }), 'add', 3);
  const m1 = upT[5]; both(skull, () => D.sweep([[Mal[0] - 3, yIn - 19, Mal[2] - 10], [(Mal[0] + m1.p[0]) / 2 - 3, (yIn + m1.p[1]) / 2 - 4, m1.p[2] - 3], [m1.p[0] - 3.5, m1.p[1] + 13, m1.p[2] - 3]], [{ a: 3.6, b: 2.6 }, { a: 3.2, b: 2.4 }, { a: 3, b: 2.2 }], { up: [0, 0, 1], label: Fc, name: 'zygomaticoalveolar crest' }), 'add', 4);
  // ---- the pterygoid plates behind the maxilla (the sphenoid; the medial wall of the infratemporal fossa)
  both(skull, () => D.smoothSheet([[[11, -4, zPNS - 8], [18, -4, zPNS - 2]], [[12, yPal - 6, zPNS - 3], [17, yPal - 7, zPNS + 3]]], 1.4, { nu: 2, nv: 2, label: C, name: 'pterygoid plate' }), 'add', 3);

  // ================= 6. THE ORBITS: lofted pyramids; a wall shell (closed: the orbit opens only forward and at its apex), then the cavity
  const ac = [xOc, yOc, (zMed + zLatH + zSup + zInf) / 4 + 1], apex = [m ? 14.5 : 13.5, yOc - 2, cornea - 45], Tor = v3.norm(v3.sub(apex, ac)), upOr = [-Math.sin(rad(8)), Math.cos(rad(8)), 0];
  const orbSpine = [-14, -3, 6, 15, 26, 36].map(t => v3.add(ac, v3.mul(Tor, t))).concat([apex]);
  // the medial wall (the lamina papyracea) stays near sagittal at the dacryon's x as the axis runs back and in: the sections' medial
  // half-widths follow it; the lateral wall converges at ~35 deg; the roof vaults behind the margin
  const bMed = t => Math.max(1.6, xOc + Tor[0] * t - (xD - 0.6)), lenOr = v3.dist(ac, apex);
  const orbSec = [{ a: [hh + 4, hh + 4], b: [hw + 5, hw + 3], n: 2.6 }, { a: [hh + 0.3, hh + 0.2], b: [hw + 0.6, Math.min(hw - 0.3, bMed(-3))], n: 2.8 }, { a: [hh + 2.2, hh + 1.6], b: [hw + 1.2, Math.min(hw + 0.2, bMed(6))], n: 2.6 },
    { a: [hh + 0.8, hh + 0.8], b: [hw - 2.2, Math.min(hw - 1.4, bMed(15))], n: 2.4 }, { a: [hh * 0.72, hh * 0.72], b: [hw * 0.58, Math.min(hw * 0.66, bMed(26))], n: 2.2 }, { a: [hh * 0.42, hh * 0.42], b: [hw * 0.32, Math.min(hw * 0.36, bMed(36))], n: 2 }, { a: 2.6, b: 2.6, n: 2 }];
  const orbit = D.sweep(orbSpine, orbSec, { up: upOr, sub: 3, name: 'orbit' });
  const shell = D.sweep(orbSpine.slice(2).concat([v3.add(apex, v3.mul(Tor, 4))]), orbSec.slice(2).map(s => ({ a: (Array.isArray(s.a) ? s.a : [s.a, s.a]).map(v => v + 3), b: (Array.isArray(s.b) ? s.b : [s.b, s.b]).map(v => v + 3), n: s.n })).concat([{ a: 3.4, b: 3.4 }]), { up: upOr, sub: 3, label: Fc, name: 'orbital walls' });
  // ---- the nasal cavity and the PIRIFORM APERTURE (a pear: its apex the nasal bones' free margin, widest below the middle, the base
  // rounded over the nasal floor)
  const Hap = Rhi[1] - yANS;
  const nasalCav = D.sweep([[0, yANS - 3.5, zANS - 31], [0, yANS + 8, zANS - 31], [0, yIn - 3, zN - 30], [0, yN - 7, zN - 27]], [{ a: 22, b: K.NLB / 2 + 1.5, n: 2.4 }, { a: 22, b: K.NLB / 2, n: 2.4 }, { a: 20, b: xD - 3.8, n: 2.2 }, { a: 15, b: Math.max(2.2, xD - 7), n: 2 }], { up: [0, 0, 1], name: 'nasal cavity' });
  const apert = D.sweep([[0, yANS - 3.5, zANS - 4], [0, yANS - 1.2, zANS - 4], [0, yANS + 1, zANS - 4], [0, yANS + 0.3 * Hap, zANS - 3.5], [0, yANS + 0.55 * Hap, zANS - 3], [0, yANS + 0.75 * Hap, Rhi[2] - 8], [0, yANS + 0.9 * Hap, Rhi[2] - 6], [0, Rhi[1] + 0.2, Rhi[2] - 5]],
    [{ a: [26, 8], b: K.NLB / 2 - 7 }, { a: [26, 8], b: K.NLB / 2 - 3.5 }, { a: [26, 8], b: K.NLB / 2 - 1.5 }, { a: [26, 9], b: K.NLB / 2 }, { a: [26, 9], b: K.NLB / 2 - 1.8 }, { a: [26, 10], b: K.NLB / 2 - 5 }, { a: [26, 10], b: 4.2 }, { a: [26, 10], b: 2.8 }], { up: [0, 0, 1], sub: 4, name: 'piriform aperture' });
  // the aperture's margin: sharp (k 1) at the floor and the lower lateral edge, rounded (k 2.4) along the upper lateral edge and the nasal
  // bones' free margin (rev 2: k 1 everywhere: a saw-tooth edge where the cut met the sloping plate)
  const kAp = (x, y, z) => lerp(1.0, 2.4, sstep(yANS + 0.45 * Hap, yANS + 0.8 * Hap, y)); kAp.max = 2.4;
  skull.sub(nasalCav, 3); skull.sub(apert, kAp);
  both(skull, () => shell, 'add', 2.5);
  // the orbital margin: the supraorbital edge sharp in women and rounded in men, the lateral margin sharp, the infraorbital margin rounded
  const kOrb = (x, y, z) => { const u = (y - yOc) / hh, t = (x - ac[0]) * Tor[0] + (y - ac[1]) * Tor[1] + (z - ac[2]) * Tor[2], kr = lerp(lerp(1.6, 2.6, sstep(-0.9, -0.4, -u)), m ? 2.3 + 0.6 * rob : 1.2, sstep(0.35, 0.8, u)); return lerp(kr, 0.8, sstep(3, 9, t)); }; kOrb.max = 3;
  const kOrbR = (x, y, z) => kOrb(-x, y, z); kOrbR.max = 3;
  skull.sub(orbit, kOrb); skull.sub(D.mirrorX(orbit), kOrbR);
  // after the cavities: the anterior nasal spine (rooted in the premaxilla), the nasal septum and the vomer seen through the aperture
  skull.add(D.roundCone([0, yANS - 1.5, zANS - 9], [0, yANS + 0.2, zANS + 1.2], 3.2, 1.25, { label: Fc, name: 'anterior nasal spine' }), 1.5);
  skull.add(D.heightSlab(() => 1.6, 3.2, D.regionPoly([[yANS - 4, zANS - 44], [yANS - 3, zANS - 17], [yANS + 10, zANS - 17], [Rhi[1] - 2, Rhi[2] - 16], [yN - 4, zN - 15], [yN - 6, zN - 40]]), { axis: 'x', k: 1.5, label: Fc, name: 'nasal septum', aabb: [-2.5, yANS - 6, zANS - 46, 2.5, yN, Rhi[2] - 8] }), 1.5);
  // the glenoid fossae (the condyle sits in them with a ~2.5 mm joint space) and the external acoustic meatus
  const cdU = v3.norm([1, 0, 0.27]), cdW = v3.norm(v3.cross(cdU, [0, 1, 0]));
  both(skull, () => D.ellipsoid(v3.add(Cc, [0, 2.6, -0.5]), [11.5, 7, 7.6], { name: 'glenoid fossa', basis: [cdU, [0, 1, 0], cdW] }), 'sub', 2);
  both(skull, () => D.capsule([bp / 2 + 9, -4.6, -1], [bp / 2 - 10, -4.6, 0.5], 4.3, { name: 'acoustic meatus' }), 'sub', 1.5);
  skull.sub(D.sweep([[0, yBa - 16, (zBa + Opi[2]) / 2], [0, yBa + 16, (zBa + Opi[2]) / 2 - 1]], [{ a: (zBa - Opi[2]) / 2, b: m ? 15.5 : 14.5 }, { a: (zBa - Opi[2]) / 2, b: m ? 15.5 : 14.5 }], { up: [0, 0, 1], name: 'foramen magnum' }), 2.5);

  // ================= 7. THE TEETH: crowns shaped along their own axes (incisors thin at the edge: the overjet is the built one), roots into
  // the alveolus. Upper on upOcc (labial / buccal curve at the occlusal level), lower on lowOcc.
  const tooth = g => { const lab = (h, l) => (g.labSign > 0 ? [h, l] : [l, h]);
    const pts = g.prof.map(q => v3.add(g.E, v3.mul(g.T, q[0] * g.Cr))), sec = g.prof.map(q => ({ a: q[1], b: lab(q[2], q[3]), n: g.ant ? 2.2 : 3.2 }));
    return D.sweep(pts, sec, { up: g.U, sub: 3, label: Tt, name: g.upper ? 'upper tooth' : 'lower tooth' }); };
  // (rev 2.1) neighbouring crowns blend at their contact points (k 1.2: a neck, not a pinch: the mesh stays manifold)
  for (const g of upG) { const t = tooth(g); teethU.add(t, 1.2); teethU.add(D.mirrorX(t), 1.2); }
  for (const g of lowG) { const t = tooth(g); teethL.add(t, 1.2); teethL.add(D.mirrorX(t), 1.2); }

  // ================= 8. THE MANDIBLE: body (a section along its plan curve), inferior border, the chin (protuberance, tubercles), the lower
  // alveolar process, the ramus (a smooth sheet between its borders), the condylar process (neck and head), the coronoid, the oblique line
  // Go is the bigonial landmark on the bone's OUTER surface: the body's and the ramus' mid-surfaces lie their half-thickness inside it
  const zSym = (Pog[2] + Bp[2]) / 2 - 6.5, Wb = Go[0] - 6.8, Db = zSym - (Go[2] + 7);
  const bodyPlan = spline([[0, 0], [0.2 * Wb, -0.05 * Db], [0.45 * Wb, -0.21 * Db], [0.66 * Wb, -0.44 * Db], [0.84 * Wb, -0.7 * Db], [Wb, -Db]].map(([x, dz]) => [x, 0, zSym + dz]), 4);
  const nB = bodyPlan.length, tOf = j => j / (nB - 1);
  const lowCrest = j => { const t = tOf(j); return lerp(Id[1] - 0.5, lowT[5].p[1] - 9.6, Math.min(1, t * 1.35)) + (t > 0.78 ? (t - 0.78) * 30 : 0); };
  const lowBorder = j => { const t = tOf(j); return lerp(yMe + 0.6, Go[1] + 1.5, Math.pow(t, 1.12)) + 1.8 * Math.exp(-(((t - 0.84) / 0.06) ** 2)); };
  const bodySpine = bodyPlan.map((p, j) => [p[0], (lowCrest(j) + lowBorder(j)) / 2, p[2]]);
  const bodySec = bodyPlan.map((_, j) => { const t = tOf(j), hgt = (lowCrest(j) - lowBorder(j)) / 2; return { a: [hgt, hgt], b: t < 0.1 ? [m ? 7.4 : 6.8, m ? 7 : 6.4] : [lerp(6, 4.4, sstep(0.55, 1, t)) + (m ? 0.4 : 0), lerp(5.4, 3.8, sstep(0.55, 1, t))], n: 2.5 }; });
  const across = a => [...a.slice(1).reverse().map(p => [-p[0], p[1], p[2]]), ...a], acrossS = a => [...a.slice(1).reverse(), ...a];
  mand.add(D.sweep(across(bodySpine), acrossS(bodySec), { up: [0, 1, 0], sub: 1, label: Md, name: 'mandibular body' }));
  const rB = m ? 5.4 : 4.8;
  mand.add(D.sweep(across(bodyPlan.map((p, j) => [p[0] * 0.995, lowBorder(j) + rB * 0.82, p[2]])), acrossS(bodyPlan.map((_, j) => ({ a: rB * (1 - 0.18 * tOf(j)), b: [rB * (1 - 0.15 * tOf(j)) + 0.4, rB * (1 - 0.2 * tOf(j))] }))), { up: [0, 1, 0], sub: 1, label: Md, name: 'inferior border' }), 2.5);
  mand.add(D.ellipsoid([0, Pog[1] - 2, Pog[2] - 4.6], [K.chinB / 2 * 0.8 + 3.5, 7.4, 4.6], { label: Md, name: 'mental protuberance' }), 4);
  both(mand, () => D.ellipsoid([K.chinB / 2 * 0.8, yMe + 5.5, Me[2] + 2.6], [4.2, 3.2, 3], { label: Md, name: 'mental tubercle' }), 'add', 5);
  mand.add(alveolus(lowG, false, Md, 'lower alveolar process'), 3);
  // the ramus: posterior border Go -> the condylar neck, anterior border the retromolar region -> the coronoid's base; the notch between
  const lastLow = lowT[6], AB0 = [lastLow.p[0] + 2.5, lastLow.p[1] - 7, lastLow.p[2] - 7];
  const PB = s => v3.add(v3.lerp([Go[0] - 3.6, Go[1] + 3, Go[2] + 2.5], [Co[0] - 0.8, Nt[1] + 5, Co[2] - 2.5], s), [0, 0, 2.2 * Math.sin(Math.PI * s)]);
  // the anterior border: RB ahead of the posterior border at mid height (wider toward the body and toward the coronoid's base), concave
  const fwd = v3.norm([0, -(Co[2] - Go[2]), Co[1] - Go[1]]);
  const AB = s => { const w = K.RB + 7 * (1 - s) ** 2 + 5 * s * s - 1.2, p = v3.add(PB(s), v3.mul(fwd, w)); p[0] = lerp(AB0[0], Cor[0] + 2, s); return p; };
  const ramGrid = [], ramHalf = [];
  // rev 2.1: the top row is the SIGMOID NOTCH (a U from the condylar neck down to Nt and up to the coronoid's tip), the coronoid a thin
  // tapering plate (rev 2's top row was a straight slanted edge whose front corner made a square 'coronoid' 9-10 mm above lm.Cor)
  const notchY = r => r <= 0.5 ? lerp(Nt[1] + 5, Nt[1], sstep(0, 0.5, r)) : lerp(Nt[1], Cor[1], sstep(0.5, 1, r) ** 1.3);
  for (const s of [0, 0.25, 0.5, 0.75, 1]) { const row = [], hrow = []; for (const r of [0, 0.22, 0.5, 0.78, 1]) { let p = v3.lerp(PB(s), AB(s), r);
      if (s === 1) { p = r === 1 ? Cor.slice() : [p[0], notchY(r), lerp(PB(1)[2], Cor[2] - 2, r)]; }
      if (m && s < 0.3 && r < 0.4) p = v3.add(p, [1.6 * rob * (1 - s / 0.3) * (1 - r / 0.4), 0, 0]); row.push(p);
      hrow.push(s === 1 ? [2.6, 1.7, 1.45, 1.4, 1.1][[0, 0.22, 0.5, 0.78, 1].indexOf(r)] : r === 0 ? 3.0 : r === 1 ? 2.3 : r === 0.22 || r === 0.78 ? 1.8 : 1.45); }
    ramGrid.push(row); ramHalf.push(hrow); }
  both(mand, () => D.smoothSheet(ramGrid, ramHalf, { nu: 3, nv: 3, label: Md, name: 'ramus' }), 'add', 3);
  both(mand, () => D.sweep([[Co[0] - 1, Nt[1] + 2, Co[2] - 2.6], [Co[0] - 0.5, Co[1] - 10, Co[2] - 1.2], [Cc[0], Cc[1] - 1.5, Cc[2]]], [{ a: 4.8, b: 5.6 }, { a: 4.2, b: 4.2 }, { a: 5.5, b: 4.2 }], { up: [1, 0, 0], label: Md, name: 'condylar neck' }), 'add', 2);
  both(mand, () => D.ellipsoid(Cc, [9.6, 4.8, 4.8], { label: Md, name: 'condyle', basis: [cdU, [0, 1, 0], cdW] }), 'add', 2);
  both(mand, () => D.sweep([[Cor[0] + 2.2, Nt[1] - 2, Cor[2] - 8], [Cor[0] + 1, (Nt[1] + Cor[1]) / 2, Cor[2] - 3], [Cor[0], Cor[1] - 0.5, Cor[2]]], [{ a: 7.5, b: 1.6 }, { a: 4.5, b: 1.4 }, { a: 1.6, b: 1.1 }], { up: [0, 0.3, 1], label: Md, name: 'coronoid process' }), 'add', 2);

  // ================= 9. THE HYOID: from the mandibular plane (body ~15 mm under it, ~40 % of the way from menton to gonion)
  const dMP = v3.norm([0, Go[1] - Me[1], Go[2] - Me[2]]), nMP = [0, -dMP[2], dMP[1]].map(x => -x), gm3 = Math.hypot(Go[1] - Me[1], Go[2] - Me[2]);
  const nDown = nMP[1] < 0 ? nMP : nMP.map(x => -x), hB = v3.add(v3.add(Me, v3.mul(dMP, 0.4 * gm3)), v3.mul(nDown, 15));
  const hy = D.scene([], 'hyoid', { label: LBL.hyoid });
  hy.add(D.sweep([[-11, hB[1] + 0.5, hB[2] - 3], [-5, hB[1], hB[2]], [5, hB[1], hB[2]], [11, hB[1] + 0.5, hB[2] - 3]], [{ a: 4.2, b: 2 }, { a: 5, b: 2.2 }, { a: 5, b: 2.2 }, { a: 4.2, b: 2 }], { up: [0, 1, 0], label: LBL.hyoid, name: 'hyoid body' }));
  both(hy, () => D.sweep([[10, hB[1] + 0.5, hB[2] - 2.5], [17, hB[1] + 3, hB[2] - 15], [21, hB[1] + 7, hB[2] - 29]], [{ a: 2.6, b: 2 }, { a: 1.7, b: 1.5 }, { a: 2.1, b: 2 }], { up: [0, 1, 0], label: LBL.hyoid, name: 'greater horn' }), 'add', 1.5);
  lm.Hyoid = hB; report.hyoidBelowMP = +v3.dot(v3.sub(hB, Me), nDown).toFixed(1);

  // ---- assembled
  // (rev 2.1) the UPPER part (cranium + face + upper teeth) and the LOWER (mandible + lower teeth), the lower carved clear of the upper where
  // they meet: the joint (2.0 mm: the joint space and disc), the coronoid under the arch (1.5) and the bite (0.3: the crowns in occlusion
  // touch in life; a 0.3 mm gap keeps the two parts' meshes apart when each is meshed on its own: meshParts)
  const upper = D.scene([], 'upper skull'); upper.add(skull); upper.add(teethU, 0.9);      // the crowns filleted into their alveoli (no crease)
  const lowerRaw = D.scene([], 'lower jaw'); lowerRaw.add(mand); lowerRaw.add(teethL, 0.9);
  const guard = (gap, box) => D.custom((x, y, z) => upper.d(x, y, z) - gap, box, { name: 'guard' }), lower = D.scene([], 'lower jaw', { label: Md }); lower.add(lowerRaw);
  for (const sg of [1, -1]) { const bx = (a, b) => [Math.min(sg * a[0], sg * b[0]), a[1], a[2], Math.max(sg * a[0], sg * b[0]), b[1], b[2]];
    lower.sub(guard(2.0, bx([Co[0] - 16, Co[1] - 16, Co[2] - 14], [Co[0] + 16, Co[1] + 10, Co[2] + 14])), 0.8);
    lower.sub(guard(1.5, bx([Cor[0] - 12, Cor[1] - 22, Cor[2] - 16], [Cor[0] + 12, Cor[1] + 8, Cor[2] + 8])), 0.6); }
  lower.sub(guard(0.3, [-K.MAB / 2 - 10, LIE[1] - 9, Math.min(upOcc[upOcc.length - 1][2], lowOcc[lowOcc.length - 1][2]) - 10, K.MAB / 2 + 10, UIE[1] + 9, UIE[2] + 6]), 0.3);
  const teeth = D.scene([], 'teeth', { label: Tt }); teeth.add(teethU); teeth.add(teethL);
  const S = D.scene([], 'skull'); S.add(upper); S.add(lower); S.add(hy);
  const zyX = K.ZYB / 2, mir = o => { for (const k of Object.keys(o)) if (k.endsWith('_L')) o[k.replace(/_L$/, '_R')] = v3.mirrorX(o[k]); return o; };
  Object.assign(lm, { Zy_L: [zyX, -6.8, zZy], Mal_L: Mal, Fmt_L: [xEc + 2.4, yOc + 6, zFMA - 0.4], Ms_L: msTip, Eu_L: [K.XCB / 2, yVc, zVc], Op: [0, yVc, zOp], V: [0, yVc + ayV, zVc],
    Ft_L: [K.WFB / 2, yFt, zFt], AlB_L: [K.NLB / 2, yANS + 0.35 * Hap, zANS - 3], Ba, Opi, MastoidTip_L: msTip, MastoidPost_L: [bp / 2 - 4, -12, -20] });
  mir(lm);
  // the eyes in the orbits: the REAL globe (r ~12, its centre 12.4 mm behind the bone's corneal plane, 1.5 above / 0.5 lateral of the
  // aperture's centre: seated by the bone) and the cast's PROXY (rev 4: the cast's own eye where the mesh has it, for the membrane to keep
  // the lids round; it no longer places the orbit)
  const gR = m ? 12.1 : 11.8, gC = [xOc + 0.5, yOc + 1.5, cornea - 12.4];
  const globe = { L: { c: gC, r: gR }, R: { c: v3.mirrorX(gC), r: gR } };
  const cg = K.castGlobe, globeProxy = cg ? { L: { c: cg.L.slice(), r: cg.r }, R: { c: cg.R.slice(), r: cg.r } } : { L: { c: gC, r: gR }, R: { c: v3.mirrorX(gC), r: gR } };
  // (rev 2.1) the build's own surfaces and key numbers, for the layers above the bone (head/: the muscles lie on these)
  const geo = { browF, fossaFloor, fossaRegion, maxF, nasF, xTL, cotTop, cotLow, Mal, zZy, zTub, aH, aT, xD, xOc, xEc, yOc, hh, hw, ySupM, yIn, zSup, zInf, zMed, zFMA, zLatH, yFt, zFt, yG, zG, yN, zN, yANS, zANS, yPr, zPr, cornea, Rhi, xCan, bp, rob, yMe, upOcc, lowOcc };
  return { S, geo, parts: { skull, cranium: skull, face: skull, mandible: mand, teeth, teethU, teethL, upper, lower, hyoid: hy }, lm, globe, globeProxy, orbit: { ac, apex, axis: Tor, cavity: orbit }, arch: { upper: upOcc, lower: lowOcc, upT, lowT }, K, report, version: SKULL_VERSION };
}
// a box that holds the skull (mm), for sampling
export function skullBox(B, pad = 6) { const a = B.S.aabb; return [a[0] - pad, a[1] - pad, a[2] - pad, a[3] + pad, a[4] + pad, a[5] + pad].map(x => Math.round(x)); }
// the skull as a LAYER (the ANAT8 contract: metres in bind space) and its named points in bind space for ANAT8-BODY's insertions
import { layerFromFrame } from '../layer/index.js';
export function skullLayer(B, fr) { return layerFromFrame(B.S, fr.toMm, fr.toBind, LBL_NAME, 'skull'); }
export const INSERTIONS = ['Inion', 'SNL_med_L', 'SNL_med_R', 'SNL_lat_L', 'SNL_lat_R', 'MastoidTip_L', 'MastoidTip_R', 'MastoidPost_L', 'MastoidPost_R', 'Hyoid', 'Me', 'Go_L', 'Go_R', 'Co_L', 'Co_R', 'Zy_L', 'Zy_R', 'Po_L', 'Po_R'];
export function skullPointsBind(B, fr, names = INSERTIONS) { const out = {}; for (const k of names) if (B.lm[k]) out[k] = fr.toBind(B.lm[k]).map(x => +x.toFixed(5)); return out; }
// (rev 2.1, it3) the skull MESHED BY PARTS (for display, cutaways and measurement): the upper skull (cranium, face, upper teeth), the lower
// jaw (mandible, lower teeth) and the hyoid, each meshed on its own over its own box, shards dropped, concatenated (piece 0 / 1 / 2).
// h: the net (mm). Returns { M (concatenated, labels per vertex), pieces: [{ name, stats, components, dropped }] }
import { sampleField, surfaceNets, meshStats, meshComponents, dropSmall, concatMeshes } from '../layer/grid.js';
export function meshParts(B, h = 1.25, o = {}) {
  const list = [['upper skull', B.parts.upper], ['lower jaw', B.parts.lower], ['hyoid', B.parts.hyoid]], meshes = [], pieces = [];
  for (const [name, P] of list) { const a = P.aabb, pad = 2 * h, box = [a[0] - pad, a[1] - pad, a[2] - pad, a[3] + pad, a[4] + pad, a[5] + pad].map(x => Math.round(x));
    const G = sampleField(P, box, h, { band: o.band ?? 2.5 }), M0 = surfaceNets(G, { labels: P }), C0 = meshComponents(M0), M = dropSmall(M0, o.minVerts ?? 60);
    meshes.push(M); pieces.push({ name, stats: meshStats(M), components: C0.count, kept: C0.count - M.dropped, dropped: M.dropped, evals: G.info.evals }); }
  return { M: concatMeshes(meshes), pieces };
}
