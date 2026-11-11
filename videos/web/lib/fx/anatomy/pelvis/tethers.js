// ANATOMY / PELVIS / TETHERS (ANAT8-PELVIS, round 7, 8 Oct 2026; NOTES D4): the ZONES OF ADHERENCE of the pelvic region, where the superficial
// fascial system (SFS) binds the dermis to the deep fascia or the periosteum through dense fibrous septa: the lines along which the deep fat layer is
// absent and the skin is held. They are the solver's TETHERS (never painted creases): the folds, dimples and grooves come from the solve.
// Anatomy and sources (recalled where marked, to verify): Markman and Barton 1987 (the subcutaneous layers); Lockwood 1991 (the SFS and its zones
// of adherence: the lateral gluteal depression, the gluteal crease, the distal posterior thigh, the inferolateral iliotibial tract, the middle medial
// thigh); Rohrich et al 2001 (the zones of adherence in liposuction planning); the inguinal fold on Holden's line, where Scarpa's fascia fuses with
// the fascia lata ~1-2 cm below and parallel to the inguinal ligament (standard anatomy); the lumbar dimples (of Venus) over the posterior superior
// iliac spines, short cutaneous ligaments to the spine; the natal cleft, the dermis bound to the sacrum and coccyx in the midline; the linea alba
// above the umbilicus. The infragluteal fold: fibrous septa from the dermis to the deep fascia over the ischial tuberosity and the proximal
// hamstrings, running laterally and a little down from below the tuberosity across the medial two-thirds of the buttock; NOT the lower border of
// gluteus maximus, which crosses it obliquely (recalled; Ghavami et al 2018 on the gluteal ligaments, to verify).
//   adherenceLines(B, K) -> [{ name, side (1 L, -1 R, 0 midline), kind: 'line' | 'point', pts (anchors inside, metres, bind), dir (outward, the
//     projection ray onto the deep fascia), width (m: the zone's half-width), k (relative stiffness), slackMm, source }]
import { mad, sub, add, mul, nrm, lerp, clamp, resample, dot, len, crs } from '../muscle/core.js';
import { skinNormals } from '../skeleton/body.js';
const CM = 0.01;
export function adherenceLines(B, K, o = {}) {
  const P = K.pts, G = K.geo, age = B.age ?? 35, out = [];
  // laxity: the septa lengthen with age (the skin's recovery falls, the tethers slacken): 1 mm at 25, +0.6 mm a decade (an assumption, to measure)
  const slack = 1.0 + 0.06 * Math.max(0, age - 25);
  const zAx = ((P.asisL[2] + P.asisR[2]) / 2 + (P.psisL[2] + P.psisR[2]) / 2) / 2;
  for (const [S_, s] of [['L', 1], ['R', -1]]) {
    const pv = G['pelvis' + S_], F = G['fem' + S_], X_ = [s, 0, 0];
    // THE ILIAC CREST: the SFS adherent along the crest's outer lip, ASIS -> PSIS (the flank's roll hangs above it)
    const crest = resample(pv.crest.map(p => mad(p, [0, 1, 0], 0.3 * CM)), 14);
    out.push({ name: 'crest.' + S_, side: s, kind: 'line', pts: crest, dir: p => nrm([p[0], 0.15, p[2] - zAx]), width: 0.009, k: 1.0, slackMm: slack, source: 'Lockwood 1991; Rohrich 2001 (zones of adherence)' });
    // THE INGUINAL FOLD (Holden's line): ~1.5 cm below and parallel to the inguinal ligament (ASIS -> pubic tubercle)
    const ing = resample([P['asis' + S_], P['pubTub' + S_]], 10).map(p => mad(p, [0, 1, 0], -1.5 * CM, [0, 0, 1], 0.3 * CM));
    out.push({ name: 'inguinal.' + S_, side: s, kind: 'line', pts: ing, dir: () => nrm([0.15 * s, -0.35, 1]), width: 0.008, k: 1.0, slackMm: slack, source: "Scarpa's fascia fused to the fascia lata (Holden's line), standard anatomy" });
    // THE GENITOCRURAL FOLD (lane iteration 17): the perineum's lateral boundary, where the membranous layer of the superficial perineal fascia
    // (Colles') attaches to the ischiopubic ramus and the fascia lata: a septum from the ramus's margin to the skin, which the skin's crease between
    // the thigh and the perineum overlies. The anchors lie on the ramus's margin (pubic tubercle -> ischial tuberosity); the septum runs from each to
    // the skin nearest it (genitocruralCrease), and the zone's deep point is where that septum meets the deep fascia. v1-v13 projected the anchors
    // along one fixed ray from 25 cm outside, which crossed the other thigh: the deep points landed 3-14 cm from the midline down to mid-thigh and
    // every skin vertex the zone pinned lay in the held strip, so it bound nothing (lane iteration 16, scratch pins16.mjs).
    const gk = genitocruralCrease(B, K, s);
    out.push({ name: 'genitocrural.' + S_, side: s, kind: 'line', pts: gk.anchor, dirs: gk.w.map(w => mul(w, -1)), from: gk.depth.map(d => d + 0.5 * CM), dir: () => nrm([-0.6 * s, -0.4, 0.2]), width: 0.008, k: 0.8, slackMm: slack, crease: gk, source: 'the perineum\'s lateral boundary: Colles\' fascia on the ischiopubic ramus and the fascia lata (standard anatomy; Standring 2016, recalled)' });
    // THE INFRAGLUTEAL FOLD: from just below and medial of the ischial tuberosity, laterally and a little down, across the medial ~2/3 of the buttock
    const it = P['ischTub' + S_], trX = Math.abs(P['trochanter' + S_][0]);
    const m0 = mad(it, X_, -0.6 * CM, [0, 1, 0], -1.4 * CM, [0, 0, 1], -0.8 * CM), x1 = trX * 0.82;
    const igf = [0, 0.25, 0.5, 0.75, 1].map(t => [s * (Math.abs(m0[0]) + t * (x1 - Math.abs(m0[0]))), m0[1] - 1.6 * CM * t * t, m0[2] + 0.6 * CM * t]);
    out.push({ name: 'infragluteal.' + S_, side: s, kind: 'line', pts: resample(igf, 12), dir: () => nrm([0.1 * s, -0.2, -1]), width: 0.008, k: 1.0, slackMm: slack, source: 'Lockwood 1991 (the gluteal crease); Ghavami 2018 (recalled, to verify)' });
    // THE LUMBAR DIMPLE over the PSIS (a point tether)
    out.push({ name: 'dimple.' + S_, side: s, kind: 'point', pts: [mad(P['psis' + S_], [0, 0, 1], -0.2 * CM)], dir: () => nrm([0.2 * s, 0, -1]), width: 0.008, k: 1.0, slackMm: slack * 0.7, source: 'the lumbar dimples (of Venus) over the PSIS (standard anatomy)' });
    // THE LATERAL GLUTEAL DEPRESSION (lane iteration 11): ABOVE and behind the greater trochanter, over gluteus medius between the crest and the
    // trochanter's top, bounded by gluteus maximus' anterior border behind and TFL in front: the hollow of the mid-lateral buttock, with the
    // trochanteric depot BELOW it (Lockwood 1991; Mendieta 2006, the trochanteric depression; recalled, to verify). v1-v8 ran it from 4.5 cm above
    // the trochanter's top to 6 cm below it, so the zone held the skin to the deep fascia ON the trochanter, emptied the trochanteric depot there
    // and pushed the hip's fat below it: the notch at the trochanter and the lobe beneath (node outline, iteration 11).
    const gtp = mad(F.gt, [0, 1, 0], 1.5 * CM, F.F.a, -1.8 * CM, F.F.l, 1.2 * CM);
    const lgd = [mad(gtp, [0, 1, 0], 6.0 * CM, F.F.a, -0.6 * CM), mad(gtp, [0, 1, 0], 3.0 * CM, F.F.a, -0.3 * CM), gtp];
    out.push({ name: 'lateralGluteal.' + S_, side: s, kind: 'line', pts: resample(lgd, 8), dir: () => nrm([s, 0, -0.55]), width: 0.008, k: 0.6, slackMm: slack, source: 'Lockwood 1991 (the lateral gluteal depression; recalled, to verify)' });
    // THE MIDDLE MEDIAL THIGH (Lockwood's medial zone; at the region's lower edge)
    const dn = mul(F.sdir, -1), Lsh = (F.K[1] - F.Pn[1]) / dn[1];
    const mt = [0.42, 0.5, 0.58].map(t => mad(F.Pn, dn, t * Lsh, F.F.l, -2.0 * CM));
    out.push({ name: 'medialThigh.' + S_, side: s, kind: 'line', pts: mt, dir: () => nrm([-s, 0, 0.1]), width: 0.008, k: 0.5, slackMm: slack, source: 'Lockwood 1991 (the middle medial thigh; recalled, to verify)' });
    // (lane iteration 18) THE TIBIA'S SUBCUTANEOUS FACE: the crural fascia blends with the periosteum of the tibia's anteromedial surface from below the
    // tuberosity to the medial malleolus (standard anatomy, Standring 2016): no deep fat there, the skin over bone. On the leg's own axis (the knee's
    // joint line -> the ankle joint), each anchor projected from 6 cm out along the face's outward (anteromedial) direction onto the deep layer
    const AJ = B.J?.['foot.' + S_]?.h;
    if (AJ) { const kj = mad(F.K, nrm(sub(F.K, F.H)), 1.7 * CM * F.kfm), uL = nrm(sub(AJ, kj)), aL = nrm(sub(F.F.a, mul(uL, uL[0] * F.F.a[0] + uL[1] * F.F.a[1] + uL[2] * F.F.a[2]))), lL = nrm(sub(F.F.l, mul(uL, uL[0] * F.F.l[0] + uL[1] * F.F.l[1] + uL[2] * F.F.l[2])));
      const amd = nrm(add(mul(aL, 0.72), mul(lL, -0.69))), Lc = Math.hypot(AJ[0] - kj[0], AJ[1] - kj[1], AJ[2] - kj[2]), rs = [0.16, 0.26, 0.36, 0.46, 0.56, 0.66, 0.76, 0.84];
      out.push({ name: 'tibialFace.' + S_, side: s, kind: 'line', pts: rs.map(r => mad(kj, uL, r * Lc, amd, 0.5 * CM)), dirs: rs.map(() => amd), from: rs.map(() => 0.06), dir: () => amd, width: 0.012, k: 0.6, slackMm: slack,
        source: 'the crural fascia fused to the periosteum of the tibia\'s subcutaneous (anteromedial) surface (standard anatomy, Standring 2016)' }); }
  }
  // THE NATAL CLEFT: the midline over the sacrum (from S3) and the coccyx
  const cl = [P.sacrumS3, ...G.sacrum.rows[1].slice(3).map(p => p), P.coccyxTip, mad(P.coccyxTip, [0, 1, 0], -1.5 * CM, [0, 0, 1], 0.8 * CM)];
  out.push({ name: 'natalCleft', side: 0, kind: 'line', pts: resample(cl, 10), dir: () => [0, -0.1, -1], width: 0.007, k: 1.0, slackMm: slack * 0.7, source: 'the intergluteal cleft (standard anatomy)' });
  // THE LINEA ALBA above the umbilicus (from the costal margin's level down to 1 cm above the omphalion); anchors inside the abdomen, projected forward
  const umb = B.lm.omphalion, yTop = Math.min(P.rib10L[1], P.rib10R[1]) + 0.02, zIn = G.lev.L3[2] + 0.04;
  out.push({ name: 'lineaAlba', side: 0, kind: 'line', pts: resample([[0, yTop, zIn], [0, umb[1] + 0.012, zIn]], 8), dir: () => [0, 0, 1], width: 0.006, k: 0.8, slackMm: slack, binds: 'sfs', source: 'the linea alba (standard anatomy); the membranous layer (Scarpa) fused to it, the superficial (Camper) fat and the dermis continuous across the midline (Markman and Barton 1987)' });
  // THE SUPRAPUBIC CREASE: across the mons' upper border, ~2.5 cm above the pubic tubercles
  const yS = (P.pubTubL[1] + P.pubTubR[1]) / 2 + 2.5 * CM, zS = (P.pubTubL[2] + P.pubTubR[2]) / 2 - 0.5 * CM, xS = Math.abs(P.pubTubL[0]) + 1.5 * CM;
  out.push({ name: 'suprapubic', side: 0, kind: 'line', pts: resample([[-xS, yS, zS], [xS, yS, zS]], 9), dir: () => nrm([0, 0.1, 1]), width: 0.007, k: 0.6, slackMm: slack, source: 'the suprapubic crease (Scarpa\'s fascia at the pubic crest; recalled, to verify)' });
  return out;
}

// THE GENITOCRURAL CREASE ON THE SKIN (lane iteration 17), side s: the ramus's margin from the pubic tubercle to the ischial tuberosity (10 anchors)
// and, for each, the closest point of the person's skin (hm08's triangles on that side) and its septum, anchor -> skin. -> { anchor, skin, nrm (the
// skin's outward normal there), w (unit, skin -> anchor: the septum inward), u (unit, perpendicular to the septum and the crease, toward the THIGH),
// depth (m, skin to anchor) }. One definition for the zone (the tether), the held perineum (fat.js perineumOf) and the thigh's medial bound (thigh.js).
export function genitocruralCrease(B, K, s) {
  const P = K.pts, pv = K.geo[s > 0 ? 'pelvisL' : 'pelvisR'], S_ = s > 0 ? 'L' : 'R', X_ = [s, 0, 0];
  const gc = [mad(P['pubTub' + S_], X_, 0.6 * CM, [0, 1, 0], -1.0 * CM), pv.q(4.6, -13.6, 1.0, 1.0), pv.q(5.8, -16.2, -2.4, 1.0), pv.q(6.6, -17.6, -5.4, 1.0)];
  const anchor = resample(gc, 10), X = B.pos, T = B.tri, nb = B.nb, R = B.region, ARM = new Set([3, 4, 5, 6]), tris = [];
  const lo = anchor.reduce((m, a) => m.map((v, c) => Math.min(v, a[c])), [Infinity, Infinity, Infinity]).map(v => v - 0.12), hi = anchor.reduce((m, a) => m.map((v, c) => Math.max(v, a[c])), [-Infinity, -Infinity, -Infinity]).map(v => v + 0.12);
  for (let t = 0; t < T.length; t += 3) { const a = T[t], b = T[t + 1], c = T[t + 2]; if (a >= nb || b >= nb || c >= nb) continue; if (R && (ARM.has(R[a]) || ARM.has(R[b]) || ARM.has(R[c]))) continue;
    const cx = (X[a * 3] + X[b * 3] + X[c * 3]) / 3, cy = (X[a * 3 + 1] + X[b * 3 + 1] + X[c * 3 + 1]) / 3, cz = (X[a * 3 + 2] + X[b * 3 + 2] + X[c * 3 + 2]) / 3;
    if (s * cx < -0.002 || cx < lo[0] || cx > hi[0] || cy < lo[1] || cy > hi[1] || cz < lo[2] || cz > hi[2]) continue; tris.push(a, b, c); }
  const N = skinNormals(B), skin = [], nrmS = [];
  for (const q of anchor) { let best = null, bd = Infinity, bt = -1;
    for (let k = 0; k < tris.length; k += 3) { const A = tris[k], Bv = tris[k + 1], C = tris[k + 2], cp = closestOnTri(q, [X[A * 3], X[A * 3 + 1], X[A * 3 + 2]], [X[Bv * 3], X[Bv * 3 + 1], X[Bv * 3 + 2]], [X[C * 3], X[C * 3 + 1], X[C * 3 + 2]]), d = len(sub(cp, q)); if (d < bd) { bd = d; best = cp; bt = k; } }
    const A = tris[bt], Bv = tris[bt + 1], C = tris[bt + 2], pa = [X[A * 3], X[A * 3 + 1], X[A * 3 + 2]], fn = nrm(crs(sub([X[Bv * 3], X[Bv * 3 + 1], X[Bv * 3 + 2]], pa), sub([X[C * 3], X[C * 3 + 1], X[C * 3 + 2]], pa))), vn = [0, 1, 2].map(c => N[A * 3 + c] + N[Bv * 3 + c] + N[C * 3 + c]);
    skin.push(best); nrmS.push(dot(fn, vn) < 0 ? mul(fn, -1) : fn); }
  const w = anchor.map((a, j) => nrm(sub(a, skin[j]))), depth = anchor.map((a, j) => len(sub(a, skin[j])));
  const u = skin.map((c, j) => { const l = nrm(sub(skin[Math.min(skin.length - 1, j + 1)], skin[Math.max(0, j - 1)])), v = nrm(crs(w[j], l)); return dot(v, [s, -1, 0]) < 0 ? mul(v, -1) : v; });
  return { side: s, anchor, skin, nrm: nrmS, w, u, depth };
}
// p on the perineal side of the crease's septum (true) or the thigh's (false); null where p's nearest crease point is past either end (the caller
// keeps its own rule there)
export function perinealSide(G, p) {
  const C = G.skin; let best = Infinity, J = 0, Tt = 0;
  for (let j = 0; j + 1 < C.length; j++) { const ab = sub(C[j + 1], C[j]), t = clamp(dot(sub(p, C[j]), ab) / Math.max(1e-12, dot(ab, ab)), 0, 1), d = len(sub(p, mad(C[j], ab, t))); if (d < best) { best = d; J = j; Tt = t; } }
  const last = C.length - 1;
  if (J === 0 && Tt === 0 && dot(sub(p, C[0]), sub(C[1], C[0])) < 0) return null;
  if (J === last - 1 && Tt === 1 && dot(sub(p, C[last]), sub(C[last], C[last - 1])) > 0) return null;
  const c = lerp(C[J], C[J + 1], Tt), u = nrm(lerp(G.u[J], G.u[J + 1], Tt));
  return dot(sub(p, c), u) < 0;
}
function closestOnTri(p, a, b, c) {   // Ericson, Real-Time Collision Detection (2005) 5.1.5
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap); if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp); if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) return mad(a, ab, d1 / (d1 - d3));
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp); if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) return mad(a, ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return mad(b, sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6)));
  const den = 1 / (va + vb + vc); return add(a, add(mul(ab, vb * den), mul(ac, vc * den)));
}
