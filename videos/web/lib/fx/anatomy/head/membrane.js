// ANAT8-HEAD (it4, 8 Oct): THE SKIN AS A MEMBRANE ON hm08: face rev 9's FORM from the skull out. Pure JS (node or browser), no three.js;
// millimetres in the craniometric frame (skull/frame.js). Runs OFFLINE in node (the bake: labs/human8/anat8/anat8_f9.mjs); the page only
// reads the baked displacement (face/face9.js).
//   const env = skinEnvelope(H, B, { h, sigma })    // the anatomy's skin as a clean field: E.value(x, y, z) = signed distance (mm) to it
//   const fit = fitMembrane(P, tri, nb, env.E, H, B, { lock, lambda, outer, mu, muData })   // hm08's head vertices moved onto it
//   fit.U (Float64Array nb * 3: the displacement, mm, frame), fit.w (the data weight per vertex), fit.report
//
// 1. THE ENVELOPE (why not the level set it3 showed). it3's skin was the zero level of (inner layers - superficial fat - skin), and every
//    thin solid in the inner union stood through it: 14-17 floating islands, rods and beads at the straps, the nose's cartilage, slits
//    (the it3 measurer's G-S). Here: (a) the straps and the platysma are not solids under the skin (head/index.js rev 2: they lie IN the
//    superficial layer, which the table already counts); (b) the field is sampled once over the face's box, its inside components that do
//    not contain bone are dropped (islands); (c) a Gaussian blur (sigma ~1.6 mm) rounds anything narrower than ~3-4 mm (a rod, a bead, a
//    slit) and leaves forms of larger radius where they were; (d) redistanced (layer/grid.js), so E is a true distance to that surface and
//    a vertex's step onto it is exact. The bone field under it is redistanced too (head/index.js rev 2: the it3 G-D root cause).
// 2. THE MEMBRANE (why a displacement and not a re-mesh). hm08's head keeps its topology, UVs, rig weights, lids, lip rolls, nostrils and
//    ears (every downstream system: FACE7, MOUTH, DETAIL7, SKIN7, hair, garments). What the anatomy changes is the FORM: a smooth
//    displacement field U over hm08's head that puts the skin on the envelope where the anatomy is trusted, minimising
//        sum_v w_v |U_v - T_v|^2  +  lambda sum_edges |U_a - U_b|^2        (T_v: the step that puts vertex v on the envelope)
//    re-linearised a few times (each outer iteration re-reads the envelope at P + U), solved by Gauss-Seidel. The membrane term makes U
//    smooth at the scale of a few edges (~4-6 mm on hm08's face): the anatomy's grooves wider than that come through (the tear trough,
//    the nasolabial and mentolabial lines, the temporal hollow), hm08's own detail rides on unchanged (U is smooth, P's detail is kept).
//    THE RETAINING LIGAMENTS are not in this term (rev 6, lane it21): they tether the dermis in the SOLVED tissue (head/soft.js: unilateral
//    tethers from the bone, slack by laxity(age); head/fill.js stage 2: the fat held at their line), so the grooves of age are already in
//    the envelope the membrane follows with a uniform weight. Rev 1-5 raised the data weight x3 along six ligament lines at every age and
//    kept 2/3 of the unspread step there: the groove entered twice, and on L23 the x3 pull at the nasolabial / mandibular lines folded the
//    skin at the chin's corners (20 reversed triangles; 0 without it). The same sheet is also measured in MILLIMETRES (below, rev 6).
// 3. WHAT IS NOT THE ANATOMY'S (data weight 0: the displacement there is the membrane's interpolation of its surroundings, so the form
//    moves with the face and the feature keeps its own shape): the lids and the eye socket (LOCKED, U = 0: FACE7's seal over the globe
//    stands, >= 0.96 mm; the brow and the cheek move round them), the lips and the mentolabial sulcus (the lips' form and their relation
//    are MOUTH's / FACE7's: v6's lower lip sits behind the upper as the scans' do, the it3 level set's did not), the nostrils' tunnel and
//    the mouth's lining (interior vertices: their normal faces away from the envelope's), the ears, the scalp above the hairline and the
//    neck below the jaw (faded to 0: the hair, the hats and ANAT8-BODY's neck keep their fit).
import { sampleField, redistance, blurField, keepComponents } from '../layer/grid.js';
import { vertexNormals, lowpass } from '../layer/fit.js';
import { v3, clamp, lerp, sstep, f1, f2 } from './common.js';
export const MEMBRANE_VERSION = 8;   // (EYES-FIX, 16 Oct) THE CANTHI ON THE CANTHAL TENDONS: the lid-margin rings' ends placed by our skull's orbit (canthalTendons, 1c), the rings re-laid between them, before the sheet is fitted; (lane it22) THE EYES FOLLOW THE BONE: the lids, the canthi and the socket carried with the globe to the seat the orbit gives it (globeSeat, globeCarry) before the sheet is fitted; (lane it21) THE SHEET IN MILLIMETRES: the membrane and bending terms by the mesh's metric (cotangent weights, the vertex's area), not by its edges; the data weight uniform (the retaining ligaments act once, in the solved tissue: head/soft.js's tethers and head/fill.js's hold, no longer again as a x3 data weight and a kept step here). (was 5: (lane it18) THE EYE'S SOFT TISSUE: the lid skin carried by the bending term (only the margins locked) and no envelope data inside the orbital aperture (lane it20: rev 4's A/B switches o.lidCarry / o.palpebral DELETED: rev 5 is the behaviour);   // (c6 it15) spread 1 and temple 'anat' are the DEFAULTS (every bake's since it12; spread 0 / temple 'box' = the A/B); rev 4 (lane it12, 15 Oct): o.temple 'anat', the temple's data to the anatomy (the ear's lock only at the ear; the A/B until the critic rules); rev 3 (lane it11, 15 Oct): o.spread, the deep relief seen through the soft tissue (rev 2 = spread 0, the A/B until the critic rules); rev 2 (it5): the bending term, the form / detail split (rev 1 deleted at it6: git history only))

// ---------------------------------------------------------------- 1. the envelope
export function skinEnvelope(H, B, o = {}) {
  const t0 = Date.now(), lm = B.lm, g = B.geo, h = o.h ?? 2, front = Math.max(H.soft.prn[2], g.zN + 30) + 14;
  const box = o.box || [-90, Math.round(lm.Me[1] - 46), -24, 90, Math.round(g.yN + 84), Math.round(front)];
  const S = { d: (x, y, z) => H.phiSub(x, y, z) - H.skin([x, y, z]) };
  const G0 = sampleField(S, box, h, { band: o.band ?? 4 }), t1 = Date.now();
  const { G: G1, cleared } = keepComponents(G0, (i, j, k, x, y, z) => H.G.value(x, y, z) < -1.5);
  const G2 = o.sigma === 0 ? G1 : blurField(G1, o.sigma ?? 1.6), E = redistance(G2), t2 = Date.now();
  return { E, raw: G0, box, report: { box, h, sigma: o.sigma ?? 1.6, cleared, evals: G0.info.evals, ms: { sample: t1 - t0, clean: t2 - t1 } } };
}

// ---------------------------------------------------------------- interior vertices by a ray along the normal (head triangles only)
export function interiorByRay(P, tri, nb, N, inHead, minT = 2.5, maxT = 60) {
  const T = []; for (let t = 0; t < tri.length; t += 3) { const a = tri[t], b = tri[t + 1], c = tri[t + 2]; if (a < nb && b < nb && c < nb && (inHead(a) || inHead(b) || inHead(c))) T.push(t); }
  // a uniform grid of the triangles (cell 6 mm) walked along each ray
  const C = 6, key = (i, j, k) => ((i + 200) * 400 + (j + 200)) * 400 + (k + 200), cells = new Map();
  for (const t of T) { const ia = tri[t] * 3, ib = tri[t + 1] * 3, ic = tri[t + 2] * 3, lo = [0, 1, 2].map(d => Math.floor(Math.min(P[ia + d], P[ib + d], P[ic + d]) / C)), hi = [0, 1, 2].map(d => Math.floor(Math.max(P[ia + d], P[ib + d], P[ic + d]) / C));
    for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) { const kk = key(i, j, k); (cells.get(kk) || cells.set(kk, []).get(kk)).push(t); } }
  const out = new Uint8Array(nb);
  for (let v = 0; v < nb; v++) { if (!inHead(v)) continue; const o = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], d = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]], seen = new Set(); let hit = false;
    for (let s = minT; s <= maxT && !hit; s += C * 0.5) { const q = [o[0] + d[0] * s, o[1] + d[1] * s, o[2] + d[2] * s], L = cells.get(key(Math.floor(q[0] / C), Math.floor(q[1] / C), Math.floor(q[2] / C))); if (!L) continue;
      for (const t of L) { if (seen.has(t)) continue; seen.add(t); const a = tri[t], b = tri[t + 1], c = tri[t + 2]; if (a === v || b === v || c === v) continue; const ia = a * 3, ib = b * 3, ic = c * 3;
        const e1 = [P[ib] - P[ia], P[ib + 1] - P[ia + 1], P[ib + 2] - P[ia + 2]], e2 = [P[ic] - P[ia], P[ic + 1] - P[ia + 1], P[ic + 2] - P[ia + 2]], pv = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]], det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2]; if (Math.abs(det) < 1e-9) continue;
        const tv = [o[0] - P[ia], o[1] - P[ia + 1], o[2] - P[ia + 2]], u = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) / det; if (u < 0 || u > 1) continue; const qv = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]], w = (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]) / det; if (w < 0 || u + w > 1) continue;
        const tt = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) / det; if (tt > minT && tt < maxT) { hit = true; break; } } }
    out[v] = hit ? 1 : 0; }
  return out;
}

// ---------------------------------------------------------------- 1b. THE EYES FOLLOW THE BONE (rev 7, lane it22)
// Until rev 6 the globe stayed where the cast's generator put it while the face was rebuilt round OUR skull: the skull's corneal plane
// (its basion-nasion length) and its orbits (DKB, OBB, OBH) are the person's own draw, the cast's eyes another, so the face-to-eye relation
// in the render was the DIFFERENCE of two independent things: the bone's corneal plane stood -6.8 .. +7.7 mm from the cast's corneal apex
// across the twelve (L06 -6.8, L17 -6.2, L21 -5.6, L05 +7.7), its globe 0.9-3.4 mm higher and its interpupillary distance -7.6 .. +3.5 mm
// off; the radix in profile spanned 6.8-27.3 mm ahead of the cornea among six men (the HSRD-100 men 17.8 +- 3.4), and the membrane, the
// lid margins LOCKED at the cast's eye, had to fold the canthi and the radix where the envelope round the bone's orbit stood 7-17 mm from
// them (the critic's it20 / it21 eye folds). In the body the globe sits in its orbit and the lids, the canthi (the canthal tendons to the
// bone) and the conjunctival sac go with it. So: each globe is SEATED BY THE BONE (skull.js B.globe: the orbit's centre + 0.5 mm lateral,
// 1.5 above, the corneal apex on the bone's corneal plane), the cast's eye moved there whole (rigidly: its shape and size are FACE7 / EYES'),
// and the eye's soft tissue carried with it: the lid margins, the palpebral skin, the canthi and the socket by the full move within 6 mm of
// the globe's surface, fading to none by 22 mm (globeCarry) BEFORE the membrane fits the rest of the head (the locks then hold the carried
// lids, and the sheet joins them to the anatomy round them). The eyes' move rides in the bake (bake9.js encodeFace9) and face9Apply moves
// the person's eyes with it, so everything after face9 (FACE6's lid seating, FACE7's lids and seal, the brows and lashes, the engine eye)
// reads the seated globe. A property of the bone for any person; nothing fitted to a render or a photograph.
// globeSeat(B, apex): { L: [dx, dy, dz], R } (mm, the frame): the bone's seat less the cast's (centre in x, y; corneal apex in z)
export function globeSeat(B, apex = null) { const out = {};
  for (const s of ['L', 'R']) { const gb = B.globe[s].c, gp = B.globeProxy[s].c, ap = apex?.[s];
    out[s] = [gb[0] - gp[0], gb[1] - gp[1], ap != null ? B.lm.cornea - ap : gb[2] - gp[2]]; }
  return out; }
// globeCarry(P, nb, proxy, delta, o) -> Float64Array U0 (mm): the eyes' soft tissue carried with the globe: within o.near (6 mm) of the
// cast's globe surface the full move, a smoothstep to none by o.far (22 mm); where both eyes reach (the radix) the moves add, normalised
// when the weights pass 1
export function globeCarry(P, nb, proxy, delta, o = {}) { const U0 = new Float64Array(nb * 3), a = o.near ?? 6, b = o.far ?? 22;
  for (let v = 0; v < nb; v++) { const q = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]; let sw = 0; const acc = [0, 0, 0];
    for (const s of ['L', 'R']) { const pr = proxy?.[s], d = delta?.[s]; if (!pr || !d) continue; const w = 1 - sstep(a, b, v3.dist(q, pr.c) - pr.r); if (w <= 0) continue; sw += w; acc[0] += w * d[0]; acc[1] += w * d[1]; acc[2] += w * d[2]; }
    if (sw > 0) { const k = sw > 1 ? 1 / sw : 1; U0[v * 3] = acc[0] * k; U0[v * 3 + 1] = acc[1] * k; U0[v * 3 + 2] = acc[2] * k; } }
  return U0; }

// ---------------------------------------------------------------- 1c. THE CANTHI ON THE CANTHAL TENDONS (EYES-FIX, 16 Oct)
// Until now the lid-margin rings were hm08's, as the person's shape left them, carried rigidly with the globe (globeCarry) and LOCKED: nothing
// in the anatomy placed the canthi. Measured on the twelve (labs/eyes/eye7_fissure.mjs, review/.../eyes/NOTES.md 'EYES-FIX'): en-ex 21.7-24.4
// mm where adults measure ~28-31 (women) / ~30-33 (men) (Farkas 1994, as recalled), the iris 0.48-0.54 of the opening (~0.40 in life): the
// doll's eye. In the body the tarsal plates are tied to the bony orbit at both ends: the MEDIAL CANTHAL TENDON (its anterior limb) to the
// anterior lacrimal crest and the frontal process of the maxilla, beside dacryon; the LATERAL CANTHAL TENDON to Whitnall's lateral orbital
// tubercle on the zygoma, a few mm inside the lateral orbital rim and ~1-2 mm higher than the medial insertion, holding the lateral
// commissure against the globe (standard oculoplastic anatomy, as recalled: e.g. Whitnall 1921; Bron, Tripathi, Tripathi, Wolff's Anatomy of
// the Eye and Orbit 1997, ch. 2). So each commissure is where its tendon's free end lies, a short reach from OUR skull's orbital margins:
//   med  mm lateral of the medial orbital margin (skull.js xD, dacryon) to the medial canthal angle: the tendon's anterior limb with the
//        commissure. 5.5 = (en-en - dacryon breadth) / 2 from the adult norms (Farkas' en-en ~31.8 / 33.3 women / men against Howells'
//        DKB ~21 / 22: as recalled, a reach in the literature's range, not fitted to a render or to a person)
//   lat  mm medial of the lateral orbital margin (skull.js xEc) to the lateral commissure: Whitnall's tubercle ~4 mm inside the rim, the
//        tendon running forward and in to the commissure on the globe; 5.0 from ex-ex ~88-91 against the bone's bi-ectoconchion as our
//        skull builds it (DKB + 2 OBB, ~98-101; as recalled, the same caveat)
//   tilt mm the lateral commissure stands above the medial (the insertions' heights; the norms' upward canthal tilt, as recalled)
// The medial commissure keeps its own height; both keep the person's own rings (topology, order, hm08's lid shape). WHAT MOVES: each ring
// is re-laid between its new ends: in the eye's frontal frame (u across, + temporal; v up; about the seated globe's centre) the margin is
// stretched along u (each side of the corneal axis by its own canthus' ratio; beyond a canthus the tissue goes with it) and the lateral half
// raised toward the tilt, IN THE FRONTAL PLANE: the depth is the seat's, not this step's. The margin rests on the drawn globe where the
// eye is under it (FACE6 / FACE7's seats: face/face6.js seatLids, face/face7.js face7Seat), and past the globe's silhouette the seats leave
// the commissures where their tendons hold them (the medial over the lacrimal lake and the caruncle, in front of the medial orbital wall;
// the lateral is held against the globe: below). A slide round the
// globe here (the margin kept at its radius as it goes out) was tried and dropped: moving the lateral canthal region 6-12 mm back in this
// step folded the tissue round it (L08: 40-134 reversed triangles round the eye against 34 with none, 11 without the slide; it 16 Oct
// probe, labs/eyes notes). The eye's soft tissue round the rings (the lid skin,
// the canthal skin, the socket's lining) is carried with them: the same move at its own place, at full within o.near (4 mm) of a ring and
// fading to none by o.far (20 mm), BEFORE the membrane is fitted (its locks then hold the re-laid rings and the bending term joins the lid
// skin to the brow and the cheek, as for the carry). The globe does not move.
// canthalTendons(P0, nb, lid, ids, B, proxy, o) -> { U (Float64Array nb * 3, mm, the frame), report }; P0: positions after the carry (mm),
// lid: { L: [ids], R } the lid-margin rings, ids: the landmarks (en_L, ex_L, en_R, ex_R are ring vertices), proxy: the seated eye proxies
export const CANTHI = { med: 5.5, lat: 5.0, tilt: 2.0, rest: 0.35, near: 4, far: 20 };
export function canthalTendons(P0, nb, lid, ids, B, proxy, o = {}) {
  const C = { ...CANTHI, ...o }, g = B.geo, U = new Float64Array(nb * 3), report = { params: { med: C.med, lat: C.lat, tilt: C.tilt } };
  const at = v => [P0[v * 3], P0[v * 3 + 1], P0[v * 3 + 2]];
  for (const s of ['L', 'R']) {
    const pr = proxy?.[s], ring = (lid?.[s] || []).filter(v => v < nb), en = ids?.['en_' + s], ex = ids?.['ex_' + s];
    if (!pr || ring.length < 6 || en == null || ex == null) { report[s] = 'skipped (no proxy, ring or canthi)'; continue; }
    const sg = s === 'L' ? 1 : -1, G = pr.c, gx = G[0] * sg;
    const uOf = q => (q[0] - G[0]) * sg, vOf = q => q[1] - G[1];
    const e0 = at(en), x0 = at(ex), uEn0 = uOf(e0), uEx0 = uOf(x0), vEn0 = vOf(e0), vEx0 = vOf(x0);
    // the lateral commissure is held AGAINST the globe: the ring (the lid margin's posterior edge, where it rests on the eye) ends no further out
    // than the globe's silhouette at its height (B.globe r, the eye's own size, + rest: the margin's rest off it in the tear film, FACE7's seat
    // target); the skin's exocanthion lies the lid's thickness beyond it. Past the silhouette the margins did not meet the eye: the probe's
    // full build showed a 1-1.3 mm slot into the socket there (labs/eyes eye7_fissure, 16 Oct)
    const vEx1 = vEn0 + C.tilt, Rg = (B.globe?.[s]?.r ?? 12) + C.rest;
    const uEn1 = (g.xD + C.med) - gx, uEx1 = Math.min((g.xEc - C.lat) - gx, Math.sqrt(Math.max(1, Rg * Rg - vEx1 * vEx1)));
    if (!(uEn0 < -1 && uEx0 > 1 && uEn1 < -1 && uEx1 > 1)) { report[s] = `skipped (canthi not either side of the axis: en u ${f2(uEn0)} ex u ${f2(uEx0)})`; continue; }
    const kMed = uEn1 / uEn0, kLat = uEx1 / uEx0, dvEx = vEx1 - vEx0;
    // the move at a place, in the frontal plane: the stretch along u, the lateral half's rise (depth kept: see above)
    const mapAt = q => { const u = uOf(q), vv = vOf(q);
      const u1 = u < 0 ? (u >= uEn0 ? u * kMed : u + (uEn1 - uEn0)) : (u <= uEx0 ? u * kLat : u + (uEx1 - uEx0));
      const v1 = vv + (u > 0 ? dvEx * sstep(0, uEx0, u) : 0);
      return [(u1 - u) * sg, v1 - vv, 0]; };
    const RP = ring.map(at);
    // the rings take the map exactly; the eye's soft tissue round them takes the same map at its own place (so the skin beyond a commissure
    // goes with it and never falls behind it), fading with the distance to the nearer ring from o.near to o.far
    const onRing = new Set(ring); let moved = 0, maxMm = 0;
    for (let v = 0; v < nb; v++) { const q = at(v); let d = mapAt(q);
      if (!onRing.has(v)) { let dmin = Infinity; for (const p of RP) dmin = Math.min(dmin, Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]));
        if (dmin >= C.far) continue; const fade = 1 - sstep(C.near, C.far, dmin); d = d.map(x => x * fade); }
      U[v * 3] += d[0]; U[v * 3 + 1] += d[1]; U[v * 3 + 2] += d[2]; const m = Math.hypot(d[0], d[1], d[2]); if (m > 0.01) moved++; if (m > maxMm) maxMm = m; }
    const e1 = [0, 1, 2].map(a => e0[a] + U[en * 3 + a]), x1 = [0, 1, 2].map(a => x0[a] + U[ex * 3 + a]);
    if (!onRing.has(en) || !onRing.has(ex)) report.warn = `${s}: en / ex not on the lid ring (carried by interpolation)`;
    report[s] = { en: { u: [f2(uEn0), f2(uEn1)], v: f2(vEn0) }, ex: { u: [f2(uEx0), f2(uEx1)], v: [f2(vEx0), f2(vEx1)], dz: f2(x1[2] - x0[2]) },
      enex: [f2(v3.dist(e0, x0)), f2(v3.dist(e1, x1))], moved, maxMm: f2(maxMm) };
  }
  return { U, report };
}

// ---------------------------------------------------------------- 2-3. the membrane on hm08
// P: hm08's positions in the frame (mm), at least nb vertices (Float64Array or Float32Array, x y z); tri: the body's triangles; E: the
// envelope; H, B: the head and the skull; o.lock: a Set of vertex ids held at U = 0 (beyond the eyes' own lock); o.lids: the lid margin
// rings [ids] (locked); o.proxy: { L: { c, r }, R } the cast's eye proxies (the lids seat on them: locked within r + 2.5 mm)
export function fitMembrane(P, tri, nb, E, H, B, o = {}) {
  let lipsU = null; const t0 = Date.now(), lm = B.lm, g = B.geo, sto = H.soft.sto, chX = H.soft.chX, me = lm.Me, go = lm.Go_L, lam = o.lambda ?? 0.12, outer = o.outer ?? 14, cmin = o.contact ?? 2.0, maxStep = o.maxStep ?? 6;
  const N = vertexNormals(P, tri, nb), adj = Array.from({ length: nb }, () => new Set());
  for (let t = 0; t < tri.length; t += 3) { const a = tri[t], b = tri[t + 1], c = tri[t + 2]; if (a >= nb || b >= nb || c >= nb) continue; adj[a].add(b).add(c); adj[b].add(a).add(c); adj[c].add(a).add(b); }
  const A = adj.map(s => Int32Array.from(s)), at = v => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
  const lock = new Uint8Array(nb), w = new Float64Array(nb), wLipV = new Float64Array(nb).fill(1), dnV = new Float64Array(nb), free = new Uint8Array(nb), cls = new Int8Array(nb);
  for (const v of o.lock || []) if (v < nb) lock[v] = 1; for (const r of o.lids || []) for (const v of r) if (v < nb) lock[v] = 1;
  const yHair = g.yN + (o.hairline ?? 52), gr = [0, 0, 0];
  // INTERIOR vertices (the mouth's lining, the nostrils' tunnels, the eye sockets, the floor of the mouth): a ray along the vertex's own
  // normal meets hm08's head again between 2.5 and 60 mm (the outer skin's ray escapes; a nearer hit is an overhang: the ala over its
  // crease). The it4 runs before this test moved the mouth's back lining and the floor of the mouth 20-28 mm (their normals happened to
  // agree with the envelope's)
  const inner = interiorByRay(P, tri, nb, N, (v) => { const q = at(v); return !(q[1] < me[1] - 48 || q[1] > yHair + 26 || q[2] < -6 || Math.abs(q[0]) > 92); });
  // ... and the MOUTH's lining by its normal (FACE6's test: hm08's oral bag is open at the back, so a ray from the pharynx or the floor
  // of the mouth can escape): in the oral region a normal facing the cavity's centre is lining, not skin
  { const hc = [0, sto[1] - 3, sto[2] - 40]; for (let v = 0; v < nb; v++) { if (inner[v]) continue; const q = at(v); if (Math.abs(q[0]) > chX + 38 || q[1] > g.yANS + 6 || q[1] < me[1] + 2 || q[2] > sto[2] + 6 || q[2] < 0) continue;
    if (N[v * 3] * (q[0] - hc[0]) + N[v * 3 + 1] * (q[1] - hc[1]) + N[v * 3 + 2] * (q[2] - hc[2]) < 0) inner[v] = 1; } }
  for (let v = 0; v < nb; v++) { const q = at(v);
    // the head region (outside it U = 0: the scalp's top, the back of the head, the ears, the neck)
    if (q[1] < me[1] - 48 || q[1] > yHair + 26 || q[2] < -6 || Math.abs(q[0]) > 92) { cls[v] = 0; continue; }
    // the eyes: the lid MARGINS (o.lids) and the socket locked (FACE7's seal stands). (rev 5, lane it18) THE LID SKIN IS CARRIED: rev 1-4
    // also locked every skin vertex lying on the globe (within lockR of the proxy, ahead of its centre - 6 mm: the whole tarsal and preseptal
    // lid), so U was held at 0 over the lid while the brow and the orbital rim's soft tissue above it moved 2-6 mm with the anatomy, and the
    // correction had to fall to zero along the lock's edge: the LID-BROW SEAM (a fold or step where the lid meets the brow, it11's board,
    // worst on L23 and L20). In the body the lid skin is one sheet with the brow's: the orbicularis' palpebral part and the skin over it run
    // continuously from the brow over the septum to the tarsus; only the margin (the tarsal plate on the globe, held by the canthal tendons)
    // is fixed to the eye. So: the margin rings stay locked, the lid skin above and below them is FREE with no data weight (its fine form
    // is FACE7's / hm08's and rides on P), and the bending term carries the brow's displacement down to the margin with a continuous slope;
    // the globe's contact (below: no skin nearer the proxy than r + 1.0 mm, hard r + 0.8) keeps the carried lid off the eye.
    let wEye = 1; for (const s of ['L', 'R']) { const pr = o.proxy?.[s]; if (!pr) continue; const dg = v3.dist(q, pr.c) - pr.r; const lr = o.lockR ?? 1.5; if (q[2] > pr.c[2] - 8) wEye = Math.min(wEye, sstep(lr, lr + (o.eyeRamp ?? 8), dg)); }
    // the eye socket's interior (behind the lids, round the proxy) is locked with the lids: a socket vertex pulled toward the envelope
    // went through them (FACE7's globeCover saw the proxy: 0.6-1.9 mm2 on L21 / L23)
    if (inner[v]) for (const s of ['L', 'R']) { const pr = o.proxy?.[s]; if (pr && v3.dist(q, pr.c) < pr.r + 7) lock[v] = 1; }
    // (rev 5, lane it18) ... and the socket's back wall INSIDE the eye's sphere behind its centre: no skin lies there (hm08's cavity behind the
    // globe; its ray escapes through the lids' opening, so the interior test missed it, and with data weight 1 it was pulled 5-6 mm toward
    // the envelope against its locked neighbours: L23 x 27-40, z 63-66, U 5-6 mm across one edge)
    for (const s of ['L', 'R']) { const pr = o.proxy?.[s]; if (pr && q[2] < pr.c[2] && v3.dist(q, pr.c) < pr.r) { lock[v] = 1; inner[v] = 1; } }
    if (lock[v]) { cls[v] = 2; continue; }
    free[v] = 1; cls[v] = 1;
    // (rev 4, lane it12, o.temple 'anat'; the A/B until the critic rules) the EAR's lock only where the pinna is: the z ramp (12-28 mm ahead
    // of the porion) acts at and below the ear's top (Farkas: superaurale ~30 mm above the porion; a 10 mm blend), and above it the
    // temple's scalp keeps its data back to the head region's edge (a ramp z -6..10, under the hair). Below the ear (the retromandibular
    // skin) rev 3's ramp stands (it8: opening it moved the jaw in). Rev 3's ramp ran at every height, so above the ear the anatomy's temple
    // was pinned to the cast along z 12-46 (with wTemple below), and the correction ended in a ridge there (the it11 hot map: x 50-60,
    // y -10..+60, the mid band 0.75-1.0 mm against the scans' 0.57-0.60).
    const up = sstep(30, 40, q[1]);   // (c6 it16: temple 'anat' is the only behaviour; the 'box' A/B deleted)
    const wHair = sstep(yHair + 18, yHair, q[1]), wBack = (1 - up) * sstep(12, 28, q[2]) + up * sstep(-6, 10, q[2]);   // the preauricular skin and the tragus (z < 12 mm ahead of the porion): the ear's, not modelled (L20's pulled 25 mm in at wBack 4-20)
    const tz = clamp((me[2] - q[2]) / Math.max(1, me[2] - go[2]), 0, 1), border = lerp(me[1], go[1], tz), wNeck = sstep(border - 14, border - 2, q[1]);
    // the lips and the mentolabial sulcus: MOUTH's / FACE7's (v6's lip relation matches the scans'): the membrane carries them
    const ex = q[0] / (chX + 5), ey = (q[1] - sto[1]) / (q[1] > sto[1] ? 8.5 : 15), wLip = q[2] > sto[2] - 22 ? sstep(0.75, 1.3, Math.hypot(ex, ey)) : 1;
    // interior vertices (the nostrils' tunnel, the mouth's lining, an eye pocket): the normal faces away from the envelope's outward
    const e = E.value(q[0], q[1], q[2]); E.grad(q[0], q[1], q[2], gr); const dn = N[v * 3] * gr[0] + N[v * 3 + 1] * gr[1] + N[v * 3 + 2] * gr[2], deepIn = e < -6 && dn < 0.3;   // deep inside the anatomy's skin and facing away from it: a nostril's inner wall (L08: 12 mm toward the septum before)
    if (deepIn) inner[v] = 1;
    // the nostril's inner lateral wall: in the nose's box a normal facing the midline (the outer ala faces out); the envelope's nasal
    // cavity is 'outside' (the piriform aperture is empty), and L08's inner wall was pulled 13 mm toward the septum before this
    if (Math.abs(q[0]) < 26 && q[1] < g.yN - 6 && q[1] > H.soft.sn[1] - 6 && N[v * 3] * Math.sign(q[0] || 1) < -0.3 && N[v * 3 + 2] < 0.5) inner[v] = 1;
    // ... and the nose's inside behind the alar base (the vestibule's roof and the cavity hm08 models): its normals face down into the
    // nostril, whose ray escapes through the opening (L08's vestibule roof went 27 mm down before this)
    if (Math.abs(q[0]) < 12 && q[1] < lm.Rhi[1] && q[1] > H.soft.sn[1] - 4 && q[2] < H.soft.al[2] - 3) inner[v] = 1;
    const wInt = inner[v] ? 0 : sstep(0.05, 0.45, dn), wUnder = sstep(-0.8, -0.4, N[v * 3 + 1]);
    // the temple under the hair (behind the temporal hairline, ~30-45 mm ahead of the porion): v6's scalp, where the hair cards sit
    // (L20's temple would have come 12.5 mm in: the anatomy's temporal fossa is narrower than the cast's head; NEXT: the hair's own fit)
    // (rev 4, o.temple 'anat': no temple lock: the hair is groomed on the head the face hook makes (person/build.js grooms after face3), so
    // its roots follow the scalp; the anatomy's temporalis and temporal fat are built and the temple is theirs)
    const wTemple = 1;   // (not 'deep inside the envelope': L21's nasal dorsum is 10 mm inside it, and outer skin)
    // the nose: its form from the anatomy (the tip where the cartilaginous framework puts it: head/index.js softAnchors), its fine form is
    // hm08's (the cartilage is a coarse model)
    // (rev 5, lane it18) THE PALPEBRAL REGION IS THE LIDS', NOT THE ENVELOPE'S: inside the orbital aperture (the bone's rim: x from the
    // dacryon xD to the ectoconchion, y from the infraorbital to the supraorbital margin; projected along the frame's z, in front of the
    // lateral rim's plane) the skin is the lids' (the tarsus, the septum and the preseptal orbicularis over the orbital fat, hung from the
    // rim; the canthi tied to the bone by the canthal tendons). The envelope there is the smooth union of the bone's globe and the rims
    // (k >= 4 mm, the superficial fat offset): it bridges the medial canthal notch and the lid sulcus, so it pulled the medial canthus
    // 10-13 mm forward against the socket's locked lining (L23: a 7.6 mm jump across one edge: the crack at both inner canthi in it12's
    // board) and stood the brow 5-7 mm proud over a lid held at 0 (the fold along the crease). Data weight 0 inside the aperture,
    // ramping in over the rim (rho 0.8 -> 1.1 of the aperture's half-axes): the rim, the brow and the cheek keep the anatomy, and the
    // bending term carries their displacement across the palpebral skin to the margins
    let wOrb = 1; if (q[2] > g.zLatH - 4) { const ex = (Math.abs(q[0]) - g.xOc) / g.hw, ey = (q[1] - g.yOc) / g.hh; wOrb = sstep(0.8, 1.1, Math.hypot(ex, ey)); }
    const wNose = q[1] < g.yN - 6 && q[1] > (H.soft.sn[1] - 2) && Math.abs(q[0]) < 22 && q[2] > lm.Rhi[2] - 16 ? (o.noseW ?? 1) : 1;
    let wl = wHair * wBack * wTemple * wNeck * wLip * wEye * wOrb * wInt * wNose * (q[1] < sto[1] ? wUnder : 1);   // the chin's underside and the submental skin: the neck's soft tissue is ANAT8-BODY's, not modelled here (the envelope wrapped the mandible: L23's submental skin pulled 15 mm up)
    w[v] = wl; wLipV[v] = wLip; dnV[v] = inner[v] ? -1 : dn; if (wl < 0.02) cls[v] = 3; }
  // the solve: re-linearised on the envelope, Gauss-Seidel on (W + lambda L) U = W T, U = 0 on the locked and outside vertices
  // CONTACT: the skin never nearer our bone than cmin (2 mm: the thinnest skin and its subcutis, over the nasal dorsum and the brow):
  // a vertex that would be is pushed out along the bone's normal with weight 2, whatever its data weight (it is anatomy, not data)
  const U = new Float64Array(nb * 3), T = new Float64Array(nb * 3), We = new Float64Array(nb), list = []; for (let v = 0; v < nb; v++) if (free[v]) list.push(v);
  const res = [], gb = [0, 0, 0]; let contacts = 0, cgs = 0;
  // REV 2 (it5, 8 Oct): THE BENDING TERM (the orchestrator, 12:30: 'relax hm08 onto it with a bending term'). Rev 1 minimised
  //     sum w |U - T|^2 + lambda sum_edges |U_a - U_b|^2                     (a MEMBRANE: U is C0, a tent at every point constraint)
  // so U bent sharply wherever the data weight changed (the locked lids' edge, the lip window, the hairline and jaw fades): rev 1 eased the
  // lock's edge by hand over four rings and still left 1-9 new curvature peaks a head at the medial canthus. Rev 2 adds a thin-plate term
  //     + mu sum_r |(L U)_r|^2,   (L U)_r = mean of U over r's neighbours - U_r   (the umbrella: the discrete Laplacian of the displacement)
  // over every vertex r whose 1-ring holds a free vertex, the locked and outside rows included: U leaves the lock, the lip window and the
  // fades with a continuous slope (the bi-Laplacian's natural C1), so the anatomy's correction ramps in over its own length instead of a
  // ring, and no hand-made ease is needed. Penalising L U (not L of the surface) keeps hm08's own curvature (its detail rides unchanged
  // where L U = 0). Solved per axis by conjugate gradients on (W + lambda L_g + mu L^T L) U = W T, warm-started each outer iteration.
  // THE BENDING STIFFNESS BY WHERE THE ANATOMY SPEAKS: where the data weight is high the skin lies on the envelope (whose own smoothness,
  // blurred at 1.6 mm, carries the form, and whose grooves at the ligaments must come through), so the bending there is light (muData);
  // where there is no data (the lids' lock and its edge, the lip window, the fades to the hairline, the ear and the neck, the interior)
  // U is the anatomy's correction CARRIED across, and there it is a thin plate (mu): the smoothest C1 continuation of its surroundings
  // (rev 1's harmonic interpolation made a tent at every edge of the data). mu_r = muData + (mu - muData) (1 - min(1, mean w over r's
  // closed 1-ring)).
  // (rev 2 also widens the eyes' data ramp, eyeRamp, from 4 to 8 mm: the envelope over the orbicularis oculi's orbital ring (a coarse shell
  // on ROOF / SOOF, the it3 measurer's 'horn') is not trusted that near the lids; at 4 mm L20 kept 12 new curvature peaks above the medial
  // canthi, at 8 mm 7 (L08 6 -> 3), the globe's poke 0)
  const mu = o.mu ?? 8, muD = o.muData ?? 0.5, cgIt = o.cgIter ?? 400;
  // (REV 6, lane it21) THE SHEET'S STIFFNESS IN MILLIMETRES, NOT IN EDGES: the membrane term as the Dirichlet energy (cotangent
  // weights, 1 on a regular mesh) and the bending term as the integral of |Laplace-Beltrami U|^2 (cotangent weights over the vertex's area,
  // scaled to the mean vertex: the same mu on the regular face). The umbrella's uniform weights let U change by the same amount across a
  // ring of 0.3 mm triangles (the lid margins, the canthi) as across a ring of 2 mm ones: there the displacement's gradient passed 1 and the
  // carried lid skin folded (L22: 51 of 53 reversed triangles were carried lid skin, data weight 0, beside the locked margin; reversed
  // triangles on the face, rev 5 -> rev 6 on the same envelopes: L22 77 -> 5, L08 104 -> 35, L23 100 -> 21). The Dirichlet energy is
  // scale-free, so a narrow strip of small triangles resists a jump across it as a wide one does; the bending energy per unit area is
  // larger where the mesh is fine (|Laplace-Beltrami U|^2 x the vertex's area). Obtuse triangles' negative cotangents clamped at 0.1 of the
  // mean (the energy stays positive definite); the area ratio clamped to 0.2-25.
  const CW = A.map(a => new Float64Array(a.length).fill(1)), BW = A.map(a => new Float64Array(a.length).fill(a.length ? 1 / a.length : 0)), BS = new Float64Array(nb).fill(1), SR = new Float64Array(nb).fill(1);
  { const ct = A.map(a => new Float64Array(a.length)), ar = new Float64Array(nb), idxOf = (v, u) => A[v].indexOf(u);
    for (let t = 0; t < tri.length; t += 3) { const id = [tri[t], tri[t + 1], tri[t + 2]]; if (id.some(v => v >= nb)) continue; const pt = id.map(at);
      const ux = pt[1][0] - pt[0][0], uy = pt[1][1] - pt[0][1], uz = pt[1][2] - pt[0][2], wx = pt[2][0] - pt[0][0], wy = pt[2][1] - pt[0][1], wz = pt[2][2] - pt[0][2], a2 = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx); if (!(a2 > 1e-12)) continue;
      for (let k = 0; k < 3; k++) { ar[id[k]] += a2 / 6; const o0 = pt[k], p1 = pt[(k + 1) % 3], p2 = pt[(k + 2) % 3], e1 = [p1[0] - o0[0], p1[1] - o0[1], p1[2] - o0[2]], e2 = [p2[0] - o0[0], p2[1] - o0[1], p2[2] - o0[2]], cot = (e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2]) / a2;
        const b = id[(k + 1) % 3], c = id[(k + 2) % 3], i1 = idxOf(b, c), i2 = idxOf(c, b); if (i1 >= 0) ct[b][i1] += 0.5 * cot; if (i2 >= 0) ct[c][i2] += 0.5 * cot; } }
    let cs = 0, cn = 0, as = 0, an = 0, ds = 0; for (const v of list) { for (let i = 0; i < A[v].length; i++) { cs += Math.max(0, ct[v][i]); cn++; } as += ar[v]; an++; }
    const cBar = cs / Math.max(1, cn), aBar = as / Math.max(1, an); for (let v = 0; v < nb; v++) for (let i = 0; i < A[v].length; i++) ct[v][i] = Math.max(0.1 * cBar, ct[v][i]);
    for (const v of list) { let d = 0; for (let i = 0; i < A[v].length; i++) d += ct[v][i]; ds += d; } const dBar = ds / Math.max(1, an);
    for (let v = 0; v < nb; v++) { const a = A[v]; let d = 0; for (let i = 0; i < a.length; i++) { CW[v][i] = ct[v][i] / cBar; BW[v][i] = ct[v][i] / dBar; d += BW[v][i]; } BS[v] = d; SR[v] = ar[v] > 0 ? clamp(aBar / ar[v], 0.2, 25) : 1; } }
  const rows = [], mr = new Float64Array(nb); for (let r = 0; r < nb; r++) { if (!A[r].length) continue; let any = free[r], ws = Math.min(1, w[r]); for (const u of A[r]) { if (free[u]) any = 1; ws += Math.min(1, w[u]); } if (!any) continue; rows.push(r); mr[r] = muD + (mu - muD) * (1 - ws / (A[r].length + 1)); }
  const zr = new Float64Array(nb);
  const matvec = (x, y, Wv) => { for (const v of list) { const a = A[v], cw = CW[v]; let sl = 0; for (let i = 0; i < a.length; i++) { const u = a[i]; sl += cw[i] * (x[v] - (free[u] ? x[u] : 0)); } y[v] = Wv[v] * x[v] + lam * sl; }
    if (mu > 0 || muD > 0) { for (const r of rows) { const a = A[r], bw = BW[r]; let m = 0; for (let i = 0; i < a.length; i++) if (free[a[i]]) m += bw[i] * x[a[i]]; zr[r] = mr[r] * SR[r] * (m - BS[r] * (free[r] ? x[r] : 0)); }
      for (const r of rows) { const a = A[r], bw = BW[r]; if (free[r]) y[r] -= zr[r] * BS[r]; for (let i = 0; i < a.length; i++) if (free[a[i]]) y[a[i]] += zr[r] * bw[i]; } } };
  function solveBending(U, Wv, T) { let iters = 0; const x = new Float64Array(nb), b = new Float64Array(nb), r = new Float64Array(nb), p = new Float64Array(nb), q = new Float64Array(nb);
    for (let ax = 0; ax < 3; ax++) { for (const v of list) { x[v] = U[v * 3 + ax]; b[v] = Wv[v] * T[v * 3 + ax]; }
      matvec(x, q, Wv); let rr = 0, bb = 0; for (const v of list) { r[v] = b[v] - q[v]; p[v] = r[v]; rr += r[v] * r[v]; bb += b[v] * b[v]; }
      const tol = 1e-10 * Math.max(bb, 1e-9);
      for (let k = 0; k < cgIt && rr > tol; k++) { matvec(p, q, Wv); let pq = 0; for (const v of list) pq += p[v] * q[v]; if (!(pq > 0)) break; const al = rr / pq; let rn = 0;
        for (const v of list) { x[v] += al * p[v]; r[v] -= al * q[v]; rn += r[v] * r[v]; } const be = rn / rr; rr = rn; for (const v of list) p[v] = r[v] + be * p[v]; iters++; }
      for (const v of list) U[v * 3 + ax] = x[v]; }
    return iters; }
  // THE FORM AND THE DETAIL (rev 2; the design's section 6, which rev 1 skipped): rev 1 stepped every trusted vertex itself onto the
  // envelope, so U carried v6's own fine form (its folds, the lips' and nostrils' rims near the data, 0.5-3 mm umbrellas) AND the
  // envelope's small lumps, and |L U| reached 4-6 mm at single vertices (the it5 probe: 290 of L08's 413 outer vertices over 0.5 mm were
  // trusted data, most where v6's own umbrella is > 0.5 mm). Rev 2 fits the FORM: a Taubin low-pass of v6's head (o.lowIters, default 4
  // passes: wavelengths under ~10 mm, features narrower than ~4-5 mm, halved or more; longer forms kept) is what is stepped onto the
  // envelope; U is then smooth by construction, and P + U keeps v6's detail (P - base) on the anatomy's form. The contacts (the bone, the
  // globe) still act on the real surface P + U.
  // REV 3 (lane it11, 15 Oct): THE DEEP RELIEF SEEN THROUGH THE SOFT TISSUE. The envelope is the deep layers (bone, muscle, the deep fat,
  // the glands, the buccal pad) OFFSET by the superficial layer's depth: an offset surface hands every deep bump to the skin 1:1, whatever
  // the tissue over it (the masseter's front edge, the pad's island, the parotid's rim, the zygoma's arch read through 15-20 mm of fat as
  // sharply as through 2 mm). That is not how an elastic layer carries a buried shape: under a layer of thickness t the surface sees a
  // buried bump spread over a width ~ t (Boussinesq / the elastic layer's Green's function: a point load at depth t spreads to a half-width
  // of the order of t; relief of wavelength lambda is damped roughly as 1 / cosh(2 pi t / lambda)). The it10 bench showed exactly that
  // failure: knobs and facets 10-30 mm across over the lateral cheek, the buccal region, the temple and the chin, and the relief instrument
  // (anat8_bands.mjs) measured the 3-9 mm band there at 2-3x the real heads' (cheekLateral L21 1.90 against the scans' 0.57). So: each outer
  // iteration's steps onto the envelope (the signed distance along the normal) are spread over the head's surface by a diffusion whose
  // width at a vertex is sigma_v = spreadC x t_v, t_v the soft tissue's depth over our bone there (H.G at the vertex): thin tissue (the
  // brow, the nasal dorsum, the zygoma's body, the chin's point) keeps the bone's form crisp; thick tissue (the cheek, the buccal space,
  // the jowl, the temple) carries only its broad form. A normalised convolution (the step x weight and the weight diffused alike), so the
  // ramps to the unmodelled zones do not drag the steps toward zero. (rev 6: the retaining ligaments' tie of the dermis to the deep
  // fascia is in the solved envelope; rev 3-5 also kept (1 - 1/w) of the unspread step at their lines.) (c6 it16: spreadC 0, rev 2's A/B, DELETED: the spread is the behaviour.)
  const spreadC = 1, tissueT = new Float64Array(nb); let edge2 = 0, ne2 = 0; for (const v of list) for (const u of A[v]) { edge2 += (P[u * 3] - P[v * 3]) ** 2 + (P[u * 3 + 1] - P[v * 3 + 1]) ** 2 + (P[u * 3 + 2] - P[v * 3 + 2]) ** 2; ne2++; } edge2 /= Math.max(1, ne2);   // mean squared edge (mm2) of the head's free vertices
  if (spreadC > 0) for (const v of list) tissueT[v] = clamp(H.G.value(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]), 1, 30);
  // The spread acts on the envelope's OFFSET from the form along its normal (o_v = n.U + the step: where the anatomy's skin lies, independent
  // of the current U), not on the step itself: a spread step is only a preconditioner (the re-linearised outer loop drives the spread
  // residual, and so the residual, to zero: the first trial, spread 0.5 / 0.8, moved the face 0.35 mm). The target's normal offset is the
  // spread offset; U's tangential part is left as it is.
  const spreadSteps = (T, U, Wv) => { const sMax = spreadC * 30, h2 = edge2, n = Math.max(1, Math.ceil(sMax * sMax / (0.25 * h2))), alpha = new Float64Array(nb), a = new Float64Array(nb), b = new Float64Array(nb), na = new Float64Array(nb), nbw = new Float64Array(nb), NBn = NB, off = new Float64Array(nb), un = new Float64Array(nb);
    for (const v of list) { const sg = spreadC * tissueT[v]; alpha[v] = Math.min(0.5, (sg * sg) / (n * h2 / 2)); un[v] = U[v * 3] * NBn[v * 3] + U[v * 3 + 1] * NBn[v * 3 + 1] + U[v * 3 + 2] * NBn[v * 3 + 2];
      off[v] = un[v] + (T[v * 3] - U[v * 3]) * NBn[v * 3] + (T[v * 3 + 1] - U[v * 3 + 1]) * NBn[v * 3 + 1] + (T[v * 3 + 2] - U[v * 3 + 2]) * NBn[v * 3 + 2]; const wv = w[v] > 0 && !(Wv[v] > w[v]) ? Math.min(1, w[v]) : 0; a[v] = wv * off[v]; b[v] = wv; }
    for (let it = 0; it < n; it++) { for (const v of list) { const A_ = A[v]; let sa = 0, sb = 0, c = 0; for (const u of A_) if (free[u]) { sa += a[u]; sb += b[u]; c++; } na[v] = c ? a[v] + alpha[v] * (sa / c - a[v]) : a[v]; nbw[v] = c ? b[v] + alpha[v] * (sb / c - b[v]) : b[v]; }
      for (const v of list) { a[v] = na[v]; b[v] = nbw[v]; } }
    for (const v of list) { if (!(w[v] > 0) || Wv[v] > w[v]) continue;   // contacts (bone, globe) keep their own push: they are walls, not relief
      const os = b[v] > 1e-6 ? a[v] / b[v] : off[v], ds = os - un[v];   // (rev 6) no kept fraction at the ligaments: their tether is in the solved envelope
      T[v * 3] = U[v * 3] + ds * NBn[v * 3]; T[v * 3 + 1] = U[v * 3 + 1] + ds * NBn[v * 3 + 1]; T[v * 3 + 2] = U[v * 3 + 2] + ds * NBn[v * 3 + 2]; } };
  const split = true, headSet = []; for (let v = 0; v < nb; v++) if (cls[v] !== 0 && A[v].length) headSet.push(v);
  const PB = split ? lowpass(P, A, headSet, { iters: o.lowIters ?? 4 }) : P, NB = split ? vertexNormals(PB, tri, nb) : N;
  for (let it = 0; it < outer; it++) { contacts = 0;
    for (const v of list) { const x = P[v * 3] + U[v * 3], y = P[v * 3 + 1] + U[v * 3 + 1], z = P[v * 3 + 2] + U[v * 3 + 2]; We[v] = w[v];
      // the step onto the envelope ALONG THE VERTEX'S OWN NORMAL (v6's), not along the field's gradient: a closest-point step slid the
      // vertices tangentially out of concavities (L21's radix band emptied); the normal line's crossing, linearised: s = -e / (n . g)
      if (w[v] > 0) { const bx = PB[v * 3] + U[v * 3], by = PB[v * 3 + 1] + U[v * 3 + 1], bz = PB[v * 3 + 2] + U[v * 3 + 2], e = E.value(bx, by, bz); E.grad(bx, by, bz, gr); const ng = Math.max(0.5, NB[v * 3] * gr[0] + NB[v * 3 + 1] * gr[1] + NB[v * 3 + 2] * gr[2]), st = clamp(-e / ng, -maxStep, maxStep);
        T[v * 3] = U[v * 3] + st * NB[v * 3]; T[v * 3 + 1] = U[v * 3 + 1] + st * NB[v * 3 + 1]; T[v * 3 + 2] = U[v * 3 + 2] + st * NB[v * 3 + 2]; }
      if (dnV[v] > 0.05 && (w[v] > 0.02 || dnV[v] > 0.3)) { const db = H.G.value(x, y, z); if (db < cmin && db > -3) { H.G.grad(x, y, z, gb, 0.6); const nd = N[v * 3] * gb[0] + N[v * 3 + 1] * gb[1] + N[v * 3 + 2] * gb[2], k = (cmin - db) / Math.max(0.5, nd);   // out ALONG THE NORMAL (along the bone's gradient L21's radix slid 5 mm down the nasion's saddle)
        T[v * 3] = U[v * 3] + k * N[v * 3]; T[v * 3 + 1] = U[v * 3 + 1] + k * N[v * 3 + 1]; T[v * 3 + 2] = U[v * 3 + 2] + k * N[v * 3 + 2]; We[v] = Math.max(w[v], 2); contacts++; } }
      // the globe is bone-like for the skin (the orchestrator, 07:22): no skin vertex in front of the eye's centre nearer the cast's eye
      // proxy than 1.0 mm (the lids, locked, keep their own seal)
      for (const sg of ['L', 'R']) { const pr = o.proxy?.[sg]; if (!pr || z < pr.c[2] - 4) continue; const dx = x - pr.c[0], dy = y - pr.c[1], dz = z - pr.c[2], r = Math.hypot(dx, dy, dz), k = pr.r + 1.0 - r; if (k > 0 && r > 1e-6) { T[v * 3] = U[v * 3] + k * dx / r; T[v * 3 + 1] = U[v * 3 + 1] + k * dy / r; T[v * 3 + 2] = U[v * 3 + 2] + k * dz / r; We[v] = Math.max(We[v], 2); contacts++; } } }
    if (spreadC > 0) spreadSteps(T, U, We);   // (rev 3) the deep relief seen through the soft tissue's own thickness (below)
    cgs += solveBending(U, We, T);   // data + membrane + BENDING, conjugate gradients (above)
    // the residual on the data vertices (|E| at P + U)
    const R = []; for (const v of list) { if (w[v] < 0.5) continue; R.push(Math.abs(E.value(PB[v * 3] + U[v * 3], PB[v * 3 + 1] + U[v * 3 + 1], PB[v * 3 + 2] + U[v * 3 + 2]))); }   // (rev 2: the FORM's residual)
    R.sort((a, b) => a - b); res.push({ it, p50: f2(R[Math.floor(0.5 * R.length)]), p95: f2(R[Math.floor(0.95 * R.length)]) }); }
  // HARD CONTACT after the solve (the least-squares contact above is a strong spring, not a wall): no skin vertex in front of the eye's
  // centre nearer the proxy than 0.8 mm, none nearer our bone than 1.5 mm (pushed out along the globe's radius / the bone's normal)
  let hard = 0; for (const v of list) { if (dnV[v] <= 0.05) continue; let x = P[v * 3] + U[v * 3], y = P[v * 3 + 1] + U[v * 3 + 1], z = P[v * 3 + 2] + U[v * 3 + 2];
    for (const sg of ['L', 'R']) { const pr = o.proxy?.[sg]; if (!pr || z < pr.c[2] - 4) continue; const dx = x - pr.c[0], dy = y - pr.c[1], dz = z - pr.c[2], r = Math.hypot(dx, dy, dz), k = pr.r + 0.8 - r; if (k > 0 && r > 1e-6) { U[v * 3] += k * dx / r; U[v * 3 + 1] += k * dy / r; U[v * 3 + 2] += k * dz / r; hard++; } }
    if (!(w[v] > 0.02 || dnV[v] > 0.3)) continue; x = P[v * 3] + U[v * 3]; y = P[v * 3 + 1] + U[v * 3 + 1]; z = P[v * 3 + 2] + U[v * 3 + 2]; const db = H.G.value(x, y, z); if (db < 1.5 && db > -3) { H.G.grad(x, y, z, gb, 0.6); const nd = N[v * 3] * gb[0] + N[v * 3 + 1] * gb[1] + N[v * 3 + 2] * gb[2], k = (1.5 - db) / Math.max(0.5, nd); U[v * 3] += k * N[v * 3]; U[v * 3 + 1] += k * N[v * 3 + 1]; U[v * 3 + 2] += k * N[v * 3 + 2]; hard++; } }
  // THE LIPS MOVE AS ONE: the lip window (the vermilion, the commissures, the mouth's lining, the mentolabial sulcus) takes the mean
  // displacement of the outer lips, blended out by the window's weight, so the lips' relation (the lower behind the upper, 3.2 +- 1.4 mm in
  // the scanned women, 1.4 +- 1.8 in the men; v6's is in range) is kept while the mouth moves with the anatomy (the membrane alone carried
  // the upper lip with the philtrum and the lower with the chin: L08's relation 3.7 -> 5.9 mm in the first it4 run)
  { let sx = 0, sy = 0, sz = 0, sw = 0; for (const v of list) { const k = 1 - wLipV[v]; if (k < 0.7 || P[v * 3 + 2] < sto[2] - 6) continue; sx += k * U[v * 3]; sy += k * U[v * 3 + 1]; sz += k * U[v * 3 + 2]; sw += k; }
    if (sw > 0) { const m = [sx / sw, sy / sw, sz / sw]; for (const v of list) { const k = 1 - wLipV[v]; if (k <= 0) continue; for (let a = 0; a < 3; a++) U[v * 3 + a] = (1 - k) * U[v * 3 + a] + k * m[a]; } lipsU = m.map(f2); } }
  // report: the displacement by region (the anatomy's correction of v6's form)
  const reg = (q) => q[1] > g.yN + 18 ? 'forehead' : q[1] > g.yN - 8 && Math.abs(q[0]) < 14 ? 'glabella/radix' : q[1] > g.yIn - 4 && Math.abs(q[0]) >= 14 ? 'brow/orbit' : Math.abs(q[0]) < 16 && q[1] > H.soft.sn[1] - 2 ? 'nose' : q[1] > sto[1] + 10 && Math.abs(q[0]) < chX + 6 ? 'upper lip' : Math.abs(q[0]) < chX + 6 && q[1] > sto[1] - 12 && q[2] > sto[2] - 22 ? 'lips' : Math.abs(q[0]) < 26 && q[1] < sto[1] - 12 ? 'chin' : q[2] > lm.Go_L[2] + 22 && q[1] > sto[1] - 8 ? 'cheek' : 'jaw/side';
  // by region: the displacement; the envelope's signed distance from v6's skin (E0: - = the anatomy's skin is further out) and from
  // rev 9's (E1) over the trusted vertices (w >= 0.5); the mean data weight
  const by = {}; for (const v of list) { const q = at(v), k = reg(q), m = Math.hypot(U[v * 3], U[v * 3 + 1], U[v * 3 + 2]); const b = by[k] || (by[k] = { n: 0, sum: 0, max: 0, dz: 0, w: 0, nd: 0, e0: 0, e1: 0, a1: 0 }); b.n++; b.sum += m; b.max = Math.max(b.max, m); b.dz += U[v * 3 + 2]; b.w += w[v];
    if (w[v] >= 0.5) { b.nd++; const qb = [PB[v * 3], PB[v * 3 + 1], PB[v * 3 + 2]]; b.e0 += E.value(qb[0], qb[1], qb[2]); const e1 = E.value(qb[0] + U[v * 3], qb[1] + U[v * 3 + 1], qb[2] + U[v * 3 + 2]); b.e1 += e1; b.a1 += Math.abs(e1); } }
  const byR = Object.fromEntries(Object.entries(by).map(([k, b]) => [k, { n: b.n, mean: f2(b.sum / b.n), max: f2(b.max), meanDz: f2(b.dz / b.n), w: f2(b.w / b.n), data: b.nd, E0: b.nd ? f2(b.e0 / b.nd) : null, E1: b.nd ? f2(b.e1 / b.nd) : null, absE1: b.nd ? f2(b.a1 / b.nd) : null }]));
  return { U, w, cls, lock, free, inner, report: { split, spread: spreadC, lowIters: o.lowIters ?? 4, lambda: lam, mu, muData: muD, cg: cgs, rows: rows.length, outer, free: list.length, locked: lock.reduce((a, b) => a + b, 0), data: list.filter(v => w[v] >= 0.5).length, residual: res, contacts, hard, interior: inner.reduce((a, b) => a + b, 0), lipsU, byRegion: byR, ms: Date.now() - t0, version: MEMBRANE_VERSION } };
}
