// ANATOMY / PELVIS / MUSCLES (ANAT8-PELVIS, round 7, 8 Oct 2026; NOTES: review/studio_human_c8/after/anat8_pelvis/NOTES.md, D2).
// The pelvic region's muscles that ANAT8-BODY's buildMuscles does not build, as VOLUMES from origin to insertion on the person's own skeleton
// (K = buildSkeleton(B): K.pts, K.geo.pelvis*, K.geo.fem*, K.geo.lev), built with ANAT8-BODY's muscle/core.js builders (imported, never edited):
//   gluteus minimus; tensor fasciae latae + the iliotibial tract's upper band; psoas major + iliacus (iliopsoas, under the inguinal ligament through
//   the muscular lacuna to the lesser trochanter); pectineus; adductor longus, brevis, magnus; gracilis; sartorius; rectus femoris; vastus lateralis,
//   intermedius, medialis; the hamstrings (semitendinosus, semimembranosus, biceps femoris long and short heads).
// ANAT8-BODY's gluteus maximus and medius, the deep rotators, the obliques, the rectus and the deep wall are taken as they are (one source of truth).
//
// SIZE (the input, a tissue property): each muscle's VOLUME = the reference volume (Handsfield et al 2014, J Biomech 47:631, MRI of 35 lower-limb
// muscles in 24 young adults; the means typed from memory: TO VERIFY against the table) x the person's LEG LEAN MASS over the cohort's (v7, lane
// iteration 14: the person's own DXA appendicular lean mass, ALMI x stature^2 from the CAST draw, times the legs' share of it by sex (NHANES
// 2017-18 DXX_J, computed on this box); the cohort's from its fat-free mass by the same NHANES ratios) x the person's muscle PATTERN as a
// redistribution only (ANAT8-BODY's muscleScale squared, divided by its volume-weighted mean over these muscles: the occupation moves volume between
// groups, it adds no lean mass the DXA does not have). v6 multiplied stature x fat-free mass by the muscularity squared (1 + 0.32 zAlmi, x the
// occupation): the person's lean mass counted twice, since the fat-free mass and the ALMI z come from the same DXA draw (L12, 59 kg, ALMI 6.64:
// 1.40x the cohort's vastus lateralis, a man's; 185 cm2 of muscle at her mid-thigh; L08, ALMI 6.35: 0.75x). The FORM comes from the attachments
// and the path; nothing is sized to a girth.
// THE THIGH (v6, lane iteration 13): every thigh muscle from its origin to its insertion on the person's own skeleton, packed with the others in the
// fascia lata (pelvis/thigh.js); the hip's own (iliopsoas, gluteus minimus, TFL) and the iliotibial tract here. v1-v5's thigh (the bellies through
// one adult male's atlas centroids, THIGH_ATLAS) is in git history only.
//   import { buildPelvisMuscles, PELVIS_MUSCLE_REF } from '.../anatomy/pelvis/muscles.js'
//   const PM = buildPelvisMuscles(B, K, M, { rec })   -> { parts: [part (kind 'muscle', group 'pelvis')], thigh (thigh.js's build), info: { vf, target: { name: cm3 } } }
import { sdParts, part as part0, tube, accelPart } from '../skeleton/sdf.js';
import { fanSheet, layerOf, mad, sub, add, mul, nrm, dot, len, lerp, clamp, ss, bump, resample, volumeOf } from '../muscle/core.js';
import { muscleScale } from '../muscle/index.js';
import { buildThigh } from './thigh.js';
import { legFatProfile } from './fat.js';
const CM = 0.01, Y = [0, 1, 0];
export const PELVIS_MUSCLES_VERSION = 9;   // (lane iteration 19) the knee's fat bodies' volumes (KNEE_FAT_REF: by sex, scaled by stature cubed; not lean mass); // (lane iteration 18) the leg's muscles below the knee (Handsfield 2014's twelve, from the same leg lean mass: the cohort's leg lean is the whole limb's); // (lane iteration 14) the volumes from the person's own leg lean mass (DXA ALMI x the legs' share), the muscle pattern a redistribution only (v6 counted the lean mass twice); // (lane iteration 13) the thigh from origin to insertion, packed in its fascia (thigh.js); TFL from its own origin and insertion; the atlas tables (THIGH_ATLAS*, v2-v5) deleted
// one side, cm3, the cohort's means (Handsfield 2014; recalled, to verify), and the musclePattern key that scales each
export const PELVIS_MUSCLE_REF = {
  gluteusMinimus: [104, 'gluteMed'], tensorFasciaeLatae: [66, 'gluteMed'], psoas: [274, 'rectusFem'], iliacus: [214, 'rectusFem'], pectineus: [54, 'adductors'],
  adductorLongus: [175, 'adductors'], adductorBrevis: [119, 'adductors'], adductorMagnus: [559, 'adductors'], gracilis: [109, 'adductors'], sartorius: [154, 'rectusFem'],
  rectusFemoris: [269, 'rectusFem'], vastusLateralis: [581, 'vastusLat'], vastusIntermedius: [374, 'vastusLat'], vastusMedialis: [377, 'vastusMed'],
  semitendinosus: [213, 'hamstrings'], semimembranosus: [249, 'hamstrings'], bicepsFemorisLong: [227, 'hamstrings'], bicepsFemorisShort: [113, 'hamstrings'],
  // (v8, lane iteration 18) THE LEG BELOW THE KNEE (thigh.js crusLines; Handsfield 2014's leg muscles, the means RECALLED, to verify against its table)
  gastrocnemiusMedialis: [257, 'gastroc'], gastrocnemiusLateralis: [150, 'gastroc'], soleus: [438, 'soleus'], popliteus: [20, 'soleus'], tibialisPosterior: [104, 'soleus'],
  flexorDigitorumLongus: [29, 'soleus'], flexorHallucisLongus: [89, 'soleus'], tibialisAnterior: [136, 'tibialisAnt'], extensorDigitorumLongus: [103, 'tibialisAnt'],
  extensorHallucisLongus: [39, 'tibialisAnt'], fibularisLongus: [130, 'tibialisAnt'], fibularisBrevis: [66, 'tibialisAnt'],
  // ANAT8-BODY's (built there; the reference for the report only)
  gluteusMaximus: [847, 'gluteMax'], gluteusMedius: [323, 'gluteMed'] };
// (v9, lane iteration 19) THE KNEE'S FAT BODIES (thigh.js: packed on the bone like the muscles), one side, cm3, by sex, for a reference stature
// (f 1.63 m, m 1.77 m), scaled by the stature cubed (they are the knee's own structures, sized with the joint; not lean mass, not the subcutaneous
// budget). infrapatellarFat (Hoffa's pad): MRI volumetry in adults ~20-25 cm3 in women, ~28-33 in men (Osteoarthritis Initiative cohorts, e.g.
// Steidle-Kloc E et al 2016 Osteoarthritis Cartilage; Teichtahl AJ et al 2015 Arthritis Res Ther; RECALLED, to verify). suprapatellarFat (the
// quadriceps and prefemoral pads together) and poplitealFat (the fossa's fat above the joint line, its vessels and nerves within): ESTIMATED from
// the structures' described extents (Standring 2016: the pads ~3-4 cm across and up to ~1 cm deep; the fossa's upper triangle ~12-15 cm tall,
// ~4-5 cm across at the condyles, ~2 cm deep), to verify against MRI volumetry.
export const KNEE_FAT_REF = { infrapatellarFat: { f: 22, m: 30 }, suprapatellarFat: { f: 11, m: 14 }, poplitealFat: { f: 24, m: 28 } };
const KNEE_FAT_STATURE = { f: 1.63, m: 1.77 };
// (v7) the lean mass the muscles' volumes follow. NHANES 2017-18 DXX_J (public domain; ~/.cache/acp_human/data/DXX_J.XPT with DEMO_J; computed on
// this box, lane iteration 14), adults 18-35, medians: appendicular lean (arms + legs, lean excl. BMC) / fat-free mass men 0.438, women 0.408; the
// legs' share of the appendicular lean men 0.715, women 0.757 (a woman of the same ALM carries more of it in her legs)
export const LEAN = { almPerFfm: { m: 0.438, f: 0.408 }, legPerAlm: { m: 0.715, f: 0.757 } };
// Handsfield's cohort: fat-free mass ~57 kg (mean mass ~71 kg at ~20 % fat; recalled), both sexes: its leg lean by the pooled ratios (~0.425, ~0.73)
const COHORT_LEG_LEAN = 57 * 0.425 * 0.73;
// the person's leg lean mass (kg, both legs): the CAST draw's ALMI x stature^2 x the legs' share; without a draw, the fat-free mass x the ratios
export function legLean(B, rec = {}) {
  const sx = B.sex === 'f' ? 'f' : 'm', t = rec.targets || rec.prior?.targets || {}, H = B.stature;
  if (Number.isFinite(t.almi) && t.almi > 0) return { kg: t.almi * H * H * LEAN.legPerAlm[sx], source: 'almi' };
  const mass = (B.bmi ?? 22) * H * H, ffm = mass * (1 - (B.pf ?? (sx === 'f' ? 0.28 : 0.18)));
  return { kg: ffm * LEAN.almPerFfm[sx] * LEAN.legPerAlm[sx], source: 'ffm' };
}
const part = (n, prims, o) => accelPart(part0(n, prims, o));

// the femur's shaft frame: a point at fraction t from the neck's base (0) to the knee joint's level (1); (x lateral, z anterior) cm x k off the axis
export function femurFrame(F, s) {
  const down = mul(F.sdir, -1), Lsh = dot(sub(F.K, F.Pn), down);
  let l = sub(F.F.l, mul(down, dot(F.F.l, down))); l = nrm(l); let a = sub(F.F.a, mul(down, dot(F.F.a, down))); a = nrm(a);
  const ax = t => mad(F.Pn, down, t * Lsh), sec = (t, x, z, k = 1) => mad(ax(t), l, x * CM * k, a, z * CM * k);
  const lt = mad(F.Pn, F.sdir, -2.6 * CM * F.kfm, F.med, 1.2 * CM * F.kfm, F.F.a, -1.2 * CM * F.kfm);
  return { ax, sec, l, a, down, Lsh, lt, radial: p => { const t = clamp(dot(sub(p, F.Pn), down) / Lsh, -0.2, 1.1), c = ax(t); return { A: c, n: nrm(sub(p, c)) }; } };
}
// a spindle (a chain of cones) whose radii are scaled so its volume is V (cm3): the belly's form from its path, its size from the input volume
function spindleV(name, pts, prof, Vcm3, o = {}) {
  let v = 0; for (let i = 0; i + 1 < pts.length; i++) { const L = len(sub(pts[i + 1], pts[i])) * 100, a = prof[i], b = prof[i + 1]; v += Math.PI * L * (a * a + a * b + b * b) / 3; }
  const k = Math.sqrt(Vcm3 / Math.max(1e-6, v)), radii = prof.map(r => Math.max(0.0015, r * k * CM));
  const P = part(name, tube(pts, radii), { k: o.k ?? 0.004, group: o.group || 'pelvis', kind: 'muscle', meta: { target: Vcm3, ...(o.meta || {}) } });
  P.path = pts; P.radii = radii; return P;
}
// a fan's thickness scaled to a volume: the sheet is built once at unit thickness, its volume estimated from the grid (area x T), T rescaled
function areaOf(D) { let A = 0; for (let i = 0; i + 1 < D.length; i++) for (let j = 0; j + 1 < D[0].length; j++) { const a = D[i][j], b = D[i + 1][j], c = D[i][j + 1], d = D[i + 1][j + 1];
  const x1 = sub(b, a), x2 = sub(c, a), x3 = sub(b, d), x4 = sub(c, d); A += 0.5 * (len([x1[1] * x2[2] - x1[2] * x2[1], x1[2] * x2[0] - x1[0] * x2[2], x1[0] * x2[1] - x1[1] * x2[0]]) + len([x3[1] * x4[2] - x3[2] * x4[1], x3[2] * x4[0] - x3[0] * x4[2], x3[0] * x4[1] - x3[1] * x4[0]])); } return A; }
function fanV(spec, Vcm3, h = 0.006) {
  // the thickness profile T(u, v) is scaled so the built sheet's MEASURED volume is Vcm3 (a sheet wrapped round a bone gains area with its
  // thickness, so area x T under-reads): a first guess from the draped grid's area x the profile's mean, then a bracketed bisection in log k
  const T0 = spec.T, probe = fanSheet({ ...spec, T: () => 0.002, up: 1 }), G = probe.grid, A = areaOf(G.D) * 1e4;   // cm2
  let m = 0, n = 0; for (const u of G.us) for (const v of G.vs) { m += T0(u, v); n++; } m /= n;
  const k0 = Vcm3 / Math.max(1e-6, A * m * 100), build = k => { const P = fanSheet({ ...spec, T: (u, v) => T0(u, v) * k }); return { P, k, vol: volumeOf(P, h).cm3 }; };
  let lo = { k: 0, vol: 0 }, hi = null, best = build(k0);
  if (best.vol > Vcm3) hi = best; else lo = best;
  for (let it = 0; it < 8 && Math.abs(best.vol / Vcm3 - 1) > 0.06; it++) {
    const k = hi ? (lo.k > 0 ? Math.sqrt(lo.k * hi.k) : hi.k * 0.5) : lo.k * 2, r = build(k);
    if (r.vol > Vcm3) hi = r; else lo = r;
    if (Math.abs(r.vol / Vcm3 - 1) < Math.abs(best.vol / Vcm3 - 1)) best = r; }
  best.P.meta = { ...(best.P.meta || {}), target: Vcm3, built: best.vol, area: +A.toFixed(0), tMeanMm: +(m * best.k * 1000).toFixed(1) }; return best.P;
}

export function buildPelvisMuscles(B, K, M, opts = {}) {
  const t0 = Date.now(), sexF = B.sex === 'f', P = K.pts, G = K.geo, out = [], info = { vf: {}, target: {} };
  const LL = legLean(B, opts.rec || {}), hf = LL.kg / COHORT_LEG_LEAN;
  const ms = muscleScale(B, opts.rec || {}, opts.pattern || null);
  // the pattern as a redistribution: its squared scale over its volume-weighted mean across this lane's muscles (so it moves volume, never adds it)
  const pw = (() => { let a = 0, w = 0; for (const [, [v, k]] of Object.entries(PELVIS_MUSCLE_REF)) { if (k === 'gluteMax') continue; a += v * ms(k) * ms(k); w += v; } return a / w; })();
  const pat = k => ms(k) * ms(k) / pw;
  // adductor magnus' two parts share its volume: the adductor part (to the linea aspera) and the ischiocondylar part (to the adductor tubercle);
  // the split is an assumption (~55 / 45: the ischiocondylar part is the posteromedial mass of the atlas's section)
  const SPLIT = { adductorMagnus: ['adductorMagnus', 0.55], adductorMagnusIschial: ['adductorMagnus', 0.45] };
  const sx = sexF ? 'f' : 'm', kneeK = Math.pow((B.stature || KNEE_FAT_STATURE[sx]) / KNEE_FAT_STATURE[sx], 3);
  const V = n => { if (KNEE_FAT_REF[n]) { const v = KNEE_FAT_REF[n][sx] * kneeK; info.target[n] = +v.toFixed(1); return v; }
    const [key, f0] = SPLIT[n] || [n, 1], [v, k] = PELVIS_MUSCLE_REF[key]; const f = hf * pat(k); info.vf[n] = +f.toFixed(3); info.target[n] = +(v * f * f0).toFixed(0); return v * f * f0; };
  info.hf = +hf.toFixed(3); info.legLeanKg = +LL.kg.toFixed(2); info.legLeanSource = LL.source; info.patternMean = +pw.toFixed(3);
  const bones = K.parts, base = M ? M.parts : [];
  const under = (...extra) => layerOf(bones.concat(base, out, extra.flat()));
  const push = p => { out.push(p); return p; };
  // ---------------- THE HIP'S OWN: the iliopsoas in front of the joint, gluteus minimus under medius, tensor fasciae latae anterolateral
  for (const [S_, s] of [['L', 1], ['R', -1]]) {
    const pv = G['pelvis' + S_], F = G['fem' + S_], q = pv.q, FF = femurFrame(F, s), lev = n => G.lev[n], LT = FF.lt, HJ = pv.hj, X_ = [s, 0, 0];
    // PSOAS MAJOR: the bodies and transverse processes of T12-L4 -> along the pelvic brim -> under the inguinal ligament (the muscular lacuna) -> in
    // front of the hip joint -> the lesser trochanter. ILIACUS: the iliac fossa -> joins it at the brim
    const lac = q(7.6, -8.6, 1.6), capF = mad(HJ, FF.a, 2.4 * CM * F.kfm, FF.l, -0.6 * CM, Y, -1.2 * CM);
    push(spindleV('psoas.' + S_, [mad(lev('L1'), X_, 2.4 * CM), mad(lev('L3'), X_, 3.6 * CM, [0, 0, 1], 0.4 * CM), mad(lev('L5'), X_, 4.8 * CM, [0, 0, 1], 1.6 * CM), q(6.6, -6.4, 0.0), lac, capF, mad(LT, FF.a, 0.4 * CM, FF.l, -0.3 * CM)],
      [0.7, 1.5, 1.9, 1.9, 1.6, 1.3, 0.5], V('psoas')));
    const fossa = [q(9.0, 1.0, -4.0), q(8.4, -2.0, -2.8), q(7.8, -5.0, -1.0)].map(p => mad(p, X_, -1.4 * CM));
    push(spindleV('iliacus.' + S_, [fossa[0], fossa[1], fossa[2], mad(lac, X_, 0.8 * CM, [0, 0, 1], -0.2 * CM), mad(capF, X_, 0.5 * CM), mad(LT, FF.a, 0.6 * CM)], [1.2, 2.0, 1.9, 1.5, 1.2, 0.5], V('iliacus')));
    // GLUTEUS MINIMUS: the outer ilium between the anterior and inferior gluteal lines -> the greater trochanter's anterior face; under gluteus medius
    // (ANAT8-BODY's medius drapes with a gap of 7 -> 2 mm for it): built on the bone, before the medius in depth
    const Hc = [s * 0.035, F.H[1] + 0.05, F.H[2]], gminO = [0, 1, 2, 3, 4].map(i => lerp(pv.crest[i], pv.lower[i], 0.5)), gminI = [mad(F.gt, F.F.a, 1.4 * CM, Y, 0.8 * CM), mad(F.gt, F.F.a, 0.4 * CM, Y, 1.2 * CM)];
    push(fanV({ name: 'gluteusMinimus.' + S_, group: 'pelvis', O: gminO, I: gminI, nu: 7, nv: 8, U: layerOf(bones.filter(p => /^(coxa|femur)/.test(p.name))), dir: p => ({ A: Hc, n: nrm(sub(p, Hc)) }), gap: () => 0.001, smooth: 1, reach: 0.03,
      T: (u, v) => (0.35 + 0.65 * bump(v, -0.2, 0.45, 1.05)) * (0.6 + 0.4 * Math.sin(Math.PI * u)) }, V('gluteusMinimus')));
    // TENSOR FASCIAE LATAE (v6): the ASIS and the outer lip of the crest just behind it -> into the iliotibial tract's anterior fibres over the
    // greater trochanter's anterolateral face, at the trochanter's lower border (standard anatomy); a short fusiform belly on its own line,
    // anterolateral of the hip, never lateral of the thigh (v5 carried the atlas's TFL rows: git history only)
    const asis = P['asis' + S_], tflO = mad(asis, X_, 0.4 * CM, [0, 0, 1], -0.6 * CM), tflI = mad(F.gt, nrm(add(FF.l, FF.a)), 2.2 * CM * F.kfm, FF.down, 3.0 * CM * F.kfm);
    push(spindleV('tensorFasciaeLatae.' + S_, [tflO, lerp(tflO, tflI, 0.3), lerp(tflO, tflI, 0.65), tflI], [0.5, 1.2, 1.2, 0.35], V('tensorFasciaeLatae')));
  }
  // ---------------- THE THIGH: every muscle from origin to insertion, packed in the fascia lata (thigh.js), around the bones and the hip's muscles
  // (v8, lane iteration 18) THE CALF'S MUSCLE FROM THE PERSON'S CALF: the 15 Oct directive (the measurements set the simulation's PARAMETERS, never its
  // shape): the person's own calf girth (the CAST draw's ANSUR II calf circumference) corrected for the layer over the muscle (the anthropometric
  // corrected girth, C - 2 pi T: Heymsfield et al 1982's method, here with the model's own layer at the calf, legFatProfile) gives the muscle's area
  // there; the crural muscles' volumes (Handsfield's, from the leg lean mass) are scaled together by it (thigh.js buildSide, 'crus'). Their form is
  // still their attachments' and their packing's; without a girth the leg lean mass stands alone.
  const LFP = legFatProfile(B, K), tg = opts.rec?.targets || opts.rec?.prior?.targets || {}, calf = Number.isFinite(tg.calf) && tg.calf > 0.2 ? { girth: tg.calf, T: LFP.mL * LFP.LP.calf + LFP.skin } : null;
  const T = buildThigh(B, K, M, { V, obstacles: base.concat(out), keepLabels: !!opts.keepLabels, calf });
  for (const p of T.parts) push(p);
  info.thigh = T.info;
  // THE ILIOTIBIAL TRACT's upper band (the fascia lata thickened laterally; gluteus maximus' upper fibres and TFL insert into it): a 2-3 mm sheet from the
  // iliac tubercle and the crest down over the trochanter to mid-thigh, draped on everything under it; a deep fascia, the lateral thigh's adherent zone
  for (const [S_, s] of [['L', 1], ['R', -1]]) {
    const F = G['fem' + S_], FF = femurFrame(F, s), kq = Math.sqrt(hf * pat('vastusLat') * 44 / F.Lfm), sec = (t, x, z) => FF.sec(t, x, z, kq), X_ = [s, 0, 0];
    const O = [mad(P['crestTub' + S_], X_, 0.4 * CM, [0, 0, 1], -1.2 * CM), mad(P['crestTub' + S_], X_, 0.4 * CM, [0, 0, 1], 1.4 * CM)];
    const I = [sec(0.62, 3.0, -1.4), sec(0.62, 3.4, 1.0)];
    const tW = 0.0025;
    push(fanSheet({ name: 'iliotibialTract.' + S_, group: 'pelvis', O, I, nu: 4, nv: 14, U: under(), gap: () => 0.0006, smooth: 2, reach: 0.08,
      dir: p => { const below = dot(sub(p, F.Pn), FF.down) > 0; if (below) return FF.radial(p); const C = [s * 0.03, F.H[1] + 0.02, F.H[2]]; return { A: C, n: nrm(sub(p, C)) }; },
      guide: (u, v, o, i) => { const g = lerp(o, i, v); const C = [s * 0.0, g[1], F.H[2] - 0.01]; return mad(g, nrm([g[0] - C[0], 0, g[2] - C[2]]), 4 * CM * Math.sin(Math.PI * clamp(v * 1.4, 0, 1))); },
      T: (u, v) => tW * (v < 0.1 ? 0.5 + 5 * v : 1) }));
  }
  info.ms = Date.now() - t0; info.version = PELVIS_MUSCLES_VERSION;
  return { parts: out, thigh: T, info };
}
