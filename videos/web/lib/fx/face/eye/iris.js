// EYES: the iris grown from its anatomy (lib/fx/face/eye/model.js has the optics and the sources). A polar map per eye: u = the angle round the
// corneal axis (0 temporal, 0.25 up, 0.5 nasal: the globe frame of likeness/eyes.js fitEyes, mirrored per side), v = s, the radial place from
// the pupil margin (0) to the iris root (1) in the iris at rest; a dilating pupil stretches s (Pamplona et al. 2009 model the iris's radial
// deformation; linear here). Out: the relief (mm, + toward the cornea), per place the tissue it is (the border layer's thickness factor, the
// stroma's melanocyte factor, its thickness factor, the trabecular sleeve's share) and the albedo those give through model.js irisSpectrum
// (linear Rec.709). The relief is geometry in Cycles (the mesh is displaced by it, the finest part a bump) and parallax in the engine.
//   const I = growIris(M, { cls: 'brown', seed: 7, side: 1 });   // M: the skin model (assets/likeness/skin_model.json)
//
// (EYE7_VERSION 9) THE STROMA GROWN AS ITS VESSEL NETWORK, not features painted on a disc. The iris's anterior stroma is built round its
// vessels (Bron, Tripathi, Tripathi, Wolff's Anatomy of the Eye and Orbit, 8th ed. 1997, the iris; Imesch, Wallow, Albert 1997, Surv
// Ophthalmol 41 S2:S117; Sturm and Larsson 2009, Pigment Cell Melanoma Res 22:544):
//   - the RADIAL VESSELS leave the major arterial circle at the root and run centripetally in a wavy course (the slack that lets the pupil
//     move) to the collarette, each in a thick sleeve of collagen: these sleeves are the radial TRABECULAE, the iris's fibrous grain. They are
//     grown here as cords at the spacing the trabecular pattern shows at the collarette (~0.2 mm: of the order of a hundred round it), the
//     more peripheral of them branching (Y-junctions) as the circumference grows toward the root; a cord stands about half its thickness
//     proud of the loose stroma (a half-embedded cylinder);
//   - at the COLLARETTE they meet in the arcades of the incomplete minor arterial circle (the remnant of the pupillary membrane's attachment):
//     the thickest ridge of the iris, a zigzag whose outward corners are where the radial vessels arrive;
//   - the PUPILLARY ZONE inside it carries the finer radial vessels to the margin over the sphincter (a fine, flatter striation);
//   - FUCHS' CRYPTS are lacunae through the border layer and the superficial stroma either side of the collarette, the trabeculae bridging
//     them (a crypt is deep, but the cords that cross it stay at the surface); peripheral crypts near the root; CONTRACTION FURROWS circular
//     in the outer ciliary zone; pigment spots; the PUPILLARY RUFF (the pigment epithelium turned round the margin, crenated). The counts of
//     crypts, furrows and spots are the person's grades (Larsson and Pedersen 2004, Mol Vis 10:821: crypts 1-4, furrows 1-4, both varying
//     widely within every population; Edwards et al. 2016, R Soc Open Sci 3:150424).
// (EYE7_VERSION 11) THE BLOOD IN THE VESSELS GROWN HERE: each radial vessel's lumen (and the pupillary zone's finer ones) is laid into the stroma
// under its sleeve as a depth-averaged blood fraction (blood, bloodP), so the loose stroma between the cords carries none (model.js, IRIS_TISSUE).
// The optics then decide what shows (EYE7_VERSION 10: the melanin's measured amount, model.js): the border layer is a thin melanin filter, so
// the network shows as RELIEF under the light and in colour (a sleeve's dense collagen brighter, a crypt's bare stroma bluer, as the walk
// gives it); out: the albedo (the engine), and for Cycles the border layer's coat tint and the stroma's walk albedo, with its distance (sssD).
import { irisAlbedo, irisCycles, coatDiffuseT, irisPig, ruffSpectrum, rgbOf, ANAT, IRIS_TISSUE } from './model.js';

export function rng(seed) { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// value noise on a lattice periodic in x (period px cells): smooth, deterministic
export function pnoise(seed) {
  const H = (i, j) => { let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(seed, 2147483647); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  return (x, y, px) => { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const w = k => ((k % px) + px) % px, a = H(w(i), j), b = H(w(i + 1), j), c = H(w(i), j + 1), d = H(w(i + 1), j + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy; };
}

// the person's crypt and furrow grades: their own draw (Larsson and Pedersen 2004 grade crypts 1-4 and furrows 1-4; both vary widely within
// every population)
export function irisGrades(seed) { const r = rng(seed * 7919 + 13); return { crypt: 1 + Math.floor(r() * 4), furrow: 1 + Math.floor(r() * 4), spots: r() < 0.3 ? 1 + Math.floor(r() * 3) : 0 }; }

// the network's anatomy (mm): the trabecular spacing at the collarette, the cords' sleeve radius (Gaussian sigma of the ridge) and how proud they
// stand, the waviness of their course, the collarette ridge and its zigzag, the pupillary zone's finer vessels. Values of the order the iris's
// histology and slit-lamp anatomy show (the cords ~0.05-0.15 mm across, the collarette the thickest part of the stroma); not fitted to a render.
export const NET = { spacing: 0.2, sleeve: [0.03, 0.055], proud: 0.45, wave: [0.04, 0.14], branchP: 0.6, coll: { h: 0.085, w: 0.07, zig: 0.22, every: 3.5 },
  pup: { n: 2.4, h: 0.014, w: 0.016 } };

export function growIris(M, { cls = 'brown', seed = 1, side = 1, NA = 1024, NR = 256, pupilRest = 1.75, grades = null, pig: pigO = null } = {}) {   // pigO: the person's own pigment (model.js irisPigDraw), else the class's
  const t0 = Date.now(), R = rng(seed * 2654435761 + (side > 0 ? 1 : 2)), N = pnoise(seed * 31 + (side > 0 ? 3 : 4)), G = grades || irisGrades(seed);
  const rootR = ANAT.iris.rootR, span = rootR - pupilRest, rr = s => pupilRest + s * span;   // mm at rest
  const pig = pigO ? { ...irisPig(cls), ...pigO } : irisPig(cls);
  const TAU = Math.PI * 2, angD = (a, b) => { let d = a - b; d -= TAU * Math.round(d / TAU); return d; };
  const height = new Float32Array(NA * NR), ablK = new Float32Array(NA * NR).fill(1), melK = new Float32Array(NA * NR).fill(1), thK = new Float32Array(NA * NR).fill(1), cordK = new Float32Array(NA * NR);
  const blood = new Float32Array(NA * NR), bloodP = new Float32Array(NA * NR);   // (v11) the stroma's blood: depth-averaged volume fraction in the radial vessels' lumens / the pupillary zone's fine vessels'
  const sC0 = ANAT.iris.collarette, rC = rr(sC0);
  // 1. the radial vessels: one per ~spacing round the collarette, each from the root (s 1) to the collarette, wavy; the peripheral ones branch
  const nV = Math.round(TAU * rC / NET.spacing), vessels = [];
  for (let k = 0; k < nV; k++) {
    const a0 = (k + 0.35 * (R() - 0.5)) / nV * TAU, amp = NET.wave[0] + (NET.wave[1] - NET.wave[0]) * R(), f = 1.2 + 1.8 * R(), ph = R() * TAU;
    const sig = NET.sleeve[0] + (NET.sleeve[1] - NET.sleeve[0]) * R();
    const v = { a0, amp, f, ph, sig, h: NET.proud * 2 * sig, s0: null, s1: 0.985 - 0.04 * R(), parent: null, dA: 0 };
    vessels.push(v);
    if (R() < NET.branchP) {   // a branch toward the root: splits at s_b and diverges by up to half a spacing there
      const sb = 0.5 + 0.38 * R(), dA = (R() < 0.5 ? -1 : 1) * (0.35 + 0.3 * R()) * NET.spacing / rr(1);
      vessels.push({ ...v, sig: v.sig * (0.7 + 0.2 * R()), h: v.h * 0.8, parent: v, sb, dA, s1: 0.97 - 0.05 * R(), ph: v.ph });
    }
  }
  const angAt = (v, s) => { const r = rr(s), a = v.a0 + (v.amp / r) * Math.sin(v.f * Math.PI * s + v.ph);
    return v.parent ? a + v.dA * Math.max(0, (s - v.sb) / (1 - v.sb)) ** 1.3 : a; };
  // 2. the collarette: the arcades between the arriving vessels: its place s_c(angle) zigzags, outward at each arrival, inward between them
  // the arcades' corners are where the larger radial arteries arrive (one in NET.coll.every of the cords, irregularly), each corner its own depth
  const arr = vessels.filter(v => !v.parent && R() < 1 / NET.coll.every).map(v => ({ a: ((angAt(v, sC0) % TAU) + TAU) % TAU, k: 0.45 + 0.55 * R() })).sort((p, q) => p.a - q.a);
  const sc = new Float32Array(NA), zig = NET.coll.zig / span;
  for (let j = 0; j < NA; j++) { const a = (j + 0.5) / NA * TAU; let lo = { a: arr[arr.length - 1].a - TAU, k: arr[arr.length - 1].k }, hi = { a: arr[0].a + TAU, k: arr[0].k };
    for (let k = 0; k < arr.length; k++) { if (arr[k].a <= a) lo = arr[k]; else { hi = arr[k]; break; } }
    const t = (a - lo.a) / Math.max(1e-6, hi.a - lo.a), kk = lo.k + (hi.k - lo.k) * t, tri = Math.abs(2 * t - 1);   // 1 at a corner, 0 midway
    sc[j] = sC0 + zig * kk * (tri - 0.5) + 0.03 * (N((j / NA) * 5, 0.5, 5) - 0.5) * 2; }
  // the vessels end AT the collarette (their own angle's s_c): set each one's inner end
  const scAt = a => sc[Math.floor((((a % TAU) + TAU) % TAU) / TAU * NA) % NA];
  for (const v of vessels) v.s0 = v.parent ? v.sb : scAt(v.a0);
  // 3. the pupillary zone's finer vessels: from the collarette to near the margin
  const nP = Math.round(NET.pup.n * nV), pupV = [];
  for (let k = 0; k < nP; k++) { const a0 = R() * TAU; pupV.push({ a0, amp: 0.02 + 0.04 * R(), f: 1 + 2 * R(), ph: R() * TAU, sig: NET.pup.w * (0.7 + 0.6 * R()), h: NET.pup.h * (0.6 + 0.8 * R()), s0: 0.04 + 0.06 * R(), s1: scAt(a0) + 0.01 }); }
  // 4. crypts: lacunae through the border layer into the stroma, either side of the collarette (most just outside it) and near the root
  const crypts = []; const nC = [0, 4, 10, 18, 30][G.crypt];
  for (let k = 0; k < nC; k++) { const per = R() < 0.2, inner = !per && R() < 0.2;
    crypts.push({ a: R() * TAU, s: per ? 0.72 + 0.2 * R() : null, ds: inner ? -(0.03 + 0.06 * R()) : 0.025 + 0.14 * R() * R(), L: per ? 0.3 + 0.5 * R() : 0.35 + 1.0 * R(),
      W: per ? 0.2 + 0.25 * R() : 0.22 + 0.4 * R(), d: per ? 0.06 + 0.08 * R() : 0.1 + 0.15 * R(), tilt: (R() - 0.5) * 0.6, s0k: 50 * R() }); }
  // contraction furrows: circular grooves in the outer ciliary zone, partial arcs
  const furrows = []; const nF = [0, 1, 3, 5, 7][G.furrow];
  for (let k = 0; k < nF; k++) furrows.push({ s: 0.62 + 0.3 * R(), a0: R() * TAU, len: 0.6 + 2.6 * R(), d: 0.025 + 0.03 * R(), w: 0.05 + 0.04 * R() });
  // pigment spots (naevi / freckles on the anterior surface: more melanosomes in the border layer)
  const spots = []; for (let k = 0; k < G.spots; k++) spots.push({ a: R() * TAU, s: 0.4 + 0.5 * R(), r: 0.12 + 0.25 * R() });

  // the cords splatted per row: for each vessel its angle at this row, a Gaussian ridge across angle
  // (v11) each vessel's LUMEN (radius lumenR for the radial vessels, lumenRp for the pupillary zone's) laid into the stroma under its sleeve:
  // its cross-section pi rL^2 spread over the sleeve's Gaussian (integral sig sqrt(pi)) and averaged over the stroma's depth
  const dS = ANAT.iris.stroma, lumA = Math.PI * IRIS_TISSUE.lumenR ** 2, lumAp = Math.PI * IRIS_TISSUE.lumenRp ** 2;
  const splat = (i, s, r, list, isCord, inZone) => { for (const v of list) { if (!inZone(v, s)) continue;
    const ac = angAt(v, s), fade = Math.min(1, (s - v.s0) / 0.04, (v.s1 - s) / 0.05); if (fade <= 0) continue;
    const half = 3 * v.sig / r, j0 = Math.floor((ac - half) / TAU * NA), j1 = Math.ceil((ac + half) / TAU * NA), bl = (isCord ? lumA : lumAp) / (v.sig * Math.sqrt(Math.PI) * dS);
    for (let jj = j0; jj <= j1; jj++) { const j = ((jj % NA) + NA) % NA, a = (j + 0.5) / NA * TAU, dmm = Math.abs(angD(a, ac)) * r;
      const e = Math.exp(-((dmm / v.sig) ** 2)) * fade, q = i * NA + j; height[q] += v.h * e; if (isCord) { cordK[q] = Math.max(cordK[q], e); blood[q] += bl * e; } else bloodP[q] += bl * e; } } };
  for (let i = 0; i < NR; i++) { const s = (i + 0.5) / NR, r = rr(s);
    splat(i, s, r, vessels, true, (v, s_) => s_ > v.s0 - 0.01 && s_ < v.s1);
    splat(i, s, r, pupV, false, (v, s_) => s_ > v.s0 && s_ < v.s1);
  }
  for (let i = 0; i < NR; i++) { const s = (i + 0.5) / NR, r = rr(s);
    for (let j = 0; j < NA; j++) { const u = (j + 0.5) / NA, a = u * TAU, q = i * NA + j, s_c = sc[j];
      let h = height[q], ab = 1 + 0.18 * (N(u * 24, s * 6, 24) - 0.5) * 2, mk = 1 + 0.2 * (N(u * 9 + 40, s * 3, 9) - 0.5) * 2, tk = 1;
      // the collarette's ridge; the pupillary zone thinner and a little lower toward the margin; the root's thinning
      h += NET.coll.h * Math.exp(-((((s - s_c) * span) / NET.coll.w) ** 2));
      if (s < s_c) { h -= 0.03 * (1 - s / s_c); tk *= 0.85; }
      h -= 0.06 * Math.max(0, (s - 0.9) / 0.1) ** 2;
      // crypts: deep, the border layer gone and the stroma thinner; the cords that cross them stay at the surface (bridges)
      for (const c of crypts) { const s0 = c.s ?? (s_c + c.ds), dr = (s - s0) * span, dt = angD(a, c.a) * r;
        const x0 = (dr * Math.cos(c.tilt) + dt * Math.sin(c.tilt)) / (c.L / 2), y0 = (-dr * Math.sin(c.tilt) + dt * Math.cos(c.tilt)) / (c.W / 2);
        if (x0 * x0 + y0 * y0 > 3) continue;
        const irr = 1 + 0.45 * (N(Math.atan2(y0, x0) / TAU * 7 + c.a * 3, c.s0k, 7) - 0.5) * 2, d2 = (x0 * x0 + y0 * y0) / (irr * irr);   // an irregular lacuna
        if (d2 >= 1.4) continue; const m = d2 < 1 ? (1 - d2) ** 1.5 : 0, rim = Math.exp(-(((Math.sqrt(d2) - 1) / 0.18) ** 2)), br = cordK[q];
        h += -c.d * m * (1 - 0.85 * br) + 0.012 * rim; ab *= 1 - Math.min(1, 1.6 * m) * (1 - br); tk *= 1 - 0.5 * m * (1 - br); }
      for (const f of furrows) { const da = angD(a, f.a0 + f.len / 2); if (Math.abs(da) > f.len / 2) continue;
        const e = Math.exp(-((((s - f.s) * span) / f.w) ** 2)) * Math.min(1, (f.len / 2 - Math.abs(da)) / 0.2); h -= f.d * e; }   // (v10) a fold of the whole anterior iris: the border layer runs on through it (v9 thinned it; with the measured melanin that drew pale rings)
      for (const p of spots) { const d2 = (((s - p.s) * span) ** 2 + (angD(a, p.a) * r) ** 2) / p.r ** 2; if (d2 < 1) { ab = Math.max(ab, 1 + 2.2 * (1 - d2)); mk *= 1 + 1.5 * (1 - d2); } }
      // the finest fibres (bump-scale): radial streaks
      h += 0.006 * (N(u * 420, s * 4, 420) - 0.5) * 2;
      // the pupillary ruff: the posterior epithelium turned over the margin, crenated
      if (s < 0.05) h += 0.03 * (1 - s / 0.05) * (0.6 + 0.4 * Math.cos(a * 96));
      height[q] = h; ablK[q] = Math.max(0, ab); melK[q] = Math.max(0.2, mk); thK[q] = Math.max(0.15, tk);
    } }
  // (EYE7_VERSION 10) through the optics (cached on the quantized tissue factors): the albedo (the layered transport's reflectance: the engine),
  // and for Cycles the border layer's coat tint and the stroma's walk albedo (its thickness is the mesh's own there, so no thK in it)
  const albedo = new Float32Array(NA * NR * 3), tint = new Float32Array(NA * NR * 3), sssA = new Float32Array(NA * NR * 3), cache = new Map(), ruff = rgbOf(M, ruffSpectrum(M));
  for (let i = 0; i < NR; i++) { const s = (i + 0.5) / NR, rw = s < 0.045 ? Math.min(1, (0.045 - s) / 0.02) : 0;
    for (let j = 0; j < NA; j++) { const q = i * NA + j, kA = Math.round(ablK[q] * 40), kM = Math.round(melK[q] * 40), kT = Math.round(thK[q] * 20), kC = Math.round(cordK[q] * 10),
        bt = blood[q] + bloodP[q], kB = Math.round(bt / 0.0005), kL = bloodP[q] > blood[q] ? 1 : 0, key = `${kA},${kM},${kT},${kC},${kB},${kL}`;   // (v11) the vessels' blood; the lumen of whichever vessels carry most of it
      let c = cache.get(key); if (!c) { const f = { ablK: kA / 40, melK: kM / 40, thK: kT / 20, cordK: kC / 10, blood: kB * 0.0005, lumen: kL ? IRIS_TISSUE.lumenRp : IRIS_TISSUE.lumenR }, cy = irisCycles(M, pig, { ...f, thK: 1 });
        c = { a: irisAlbedo(M, pig, f), t: cy.tint.map(v => coatDiffuseT(v) ** 2), A: cy.A }; cache.set(key, c); }   // the coat's tint: its diffuse transmittance IN AND OUT (Cycles' Coat Tint is the colour at normal view, applied once as tint^(1/cos) along the view: svm/closure.h, 4.2-5.2)
      for (let k = 0; k < 3; k++) { albedo[q * 3 + k] = c.a[k] * (1 - rw) + ruff[k] * rw; tint[q * 3 + k] = c.t[k] * (1 - rw) + rw; sssA[q * 3 + k] = c.A[k] * (1 - rw) + ruff[k] * rw; } } }
  const sss = irisCycles(M, pig, {});   // the stroma's walk distance per channel (mm): the plain stroma's
  // (v11) what the grown network gives (a description, the CHECK): the stroma's mean blood (ILIT borrowed 4 % from the dermis) and the share of the
  // iris's face its lumens cover (OCT angiography of normal irides: ~8 % vessel density, Skalet et al. 2017)
  let bSum = 0, nIn = 0, cover = 0; for (let i = 0; i < NR; i++) for (let j = 0; j < NA; j++) { const q = i * NA + j; bSum += blood[q] + bloodP[q]; nIn++; }
  for (const v of vessels) cover += 2 * IRIS_TISSUE.lumenR * (v.s1 - v.s0) * span; for (const v of pupV) cover += 2 * IRIS_TISSUE.lumenRp * (v.s1 - v.s0) * span;
  const netBlood = { mean: +(bSum / nIn).toFixed(5), lumenCover: +(cover / (Math.PI * (rootR ** 2 - pupilRest ** 2))).toFixed(4) };
  return { NA, NR, cls, seed, side, pupilRest, rootR, grades: G, pig, height, ablK, melK, thK, cordK, blood, bloodP, netBlood, albedo, tint, sssA, sssD: sss.d.map(v => +v.toFixed(4)), thick: +sss.thick.toFixed(4),
    counts: { vessels: vessels.length, radials: nV, pupillary: nP, crypts: nC, furrows: nF, spots: G.spots, colours: cache.size, blood: netBlood }, ms: Date.now() - t0 };
}
