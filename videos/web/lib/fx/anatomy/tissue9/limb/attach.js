// ANATOMY / TISSUE9 / LIMB / ATTACH (TISSUE9-LIMB, round 8, 16 Oct 2026): THE LOWER LIMB'S MUSCLES AS FIBRES FROM ORIGIN TO INSERTION on the person's own
// skeleton (buildSkeleton: K.pts, K.geo.pelvis*, K.geo.fem*, the femur, patella, tibia, fibula and foot parts). These are DATA: the attachments and the
// routes of standard anatomy (Standring 2016, Gray's Anatomy; recalled), carried over unchanged from the paused lanes' line definitions (ANAT8-PELVIS:
// pelvis/thigh.js lines / fans / crusLines / crusFans, pelvis/muscles.js the hip's own; ANAT8-BODY: muscle/trunk.js the gluteals and the deep
// rotators, their origin and insertion rows). What those lanes BUILT on the lines (spindles, per-section packing in a convex hull, fan sheets of chosen
// thickness) is not used: in tissue9 a line is a muscle's SEED and the muscle GROWS from it to its volume (grow.js).
//   limbFibres(B, K, S_, s) -> { name: { fibres: [[p0, p1, ...], ...] } }   (world, m; S_ 'L' | 'R', s +1 | -1)
import { sdPart } from '../../skeleton/sdf.js';
import { mad, sub, add, mul, nrm, dot, len, lerp } from '../../muscle/core.js';
const CM = 0.01, Y = [0, 1, 0], Z = [0, 0, 1];

// a segment's frame (thigh: hip centre -> knee; crus: the knee's joint line -> the ankle): the bone's section centre and its surface along a bearing
function segFrame(B, K, S_, crus) {
  const G = K.geo, F = G['fem' + S_], KJL = mad(F.K, nrm(sub(F.K, F.H)), 1.7 * CM * F.kfm), AJ = B.J?.['foot.' + S_]?.h || mad(KJL, [0, -1, 0], 0.4);
  const H = crus ? KJL : F.H, Kj = crus ? AJ : F.K, Lm = len(sub(Kj, H)), u = nrm(sub(Kj, H)), orth = v => nrm(sub(v, mul(u, dot(v, u)))), l = orth(F.F.l), a = orth(F.F.a);
  const bone = K.parts.find(p => p.name === (crus ? 'tibia.' : 'femur.') + S_), fibula = K.parts.find(p => p.name === 'fibula.' + S_);
  const W = (sc, X, Zz) => mad(H, u, sc, l, X, a, Zz);
  const boneC = (sc, bp = bone) => { let sx = 0, sz = 0, n = 0; for (let X = -0.05; X <= 0.05; X += 0.002) for (let Zz = -0.05; Zz <= 0.05; Zz += 0.002) { const p = W(sc, X, Zz); if (sdPart(bp, p[0], p[1], p[2], 0.01) < 0) { sx += X; sz += Zz; n++; } } return n ? [sx / n, sz / n] : null; };
  const shaftAt = r => { const c = boneC(r * Lm); return c ? W(r * Lm, c[0], c[1]) : mad(H, u, r * Lm); };
  const surf = (r, dir) => { const c = shaftAt(r); let t = 0; while (t < 0.06 && sdPart(bone, ...mad(c, dir, t), 0.02) < 0) t += 0.0005; return mad(c, dir, t); };
  const fshaft = r => { const c = fibula ? boneC(r * Lm, fibula) : null; return c ? W(r * Lm, c[0], c[1]) : mad(shaftAt(r), l, 0.027); };
  const fsurf = (r, dir) => { const c = fshaft(r); let t = 0; while (fibula && t < 0.04 && sdPart(fibula, ...mad(c, dir, t), 0.02) < 0) t += 0.0005; return mad(c, dir, t); };
  return { H, u, l, a, Lm, at: r => mad(H, u, r * Lm), surf, shaftAt, fsurf, T: (r, X, Zz) => mad(shaftAt(r), l, X * CM, a, Zz * CM) };
}
const dirOf = (fr, deg) => nrm(add(mul(fr.a, Math.cos(deg * Math.PI / 180)), mul(fr.l, Math.sin(deg * Math.PI / 180))));   // 0 anterior, +90 lateral, -90 medial, 180 posterior

// THE THIGH (pelvis/thigh.js lines + fans, ANAT8-PELVIS lane iterations 13-19)
function thighLines(B, K, S_, s, fr) {
  const P = K.pts, G = K.geo, pv = G['pelvis' + S_], q = pv.q, F = G['fem' + S_], X_ = [s, 0, 0], k = F.kfm;
  const Kc = F.Kc, lat = fr.l, ant = fr.a, up = mul(fr.u, -1);
  const patella = K.parts.find(p => p.name === 'patella.' + S_), pb = patella.bb, patC = [(pb[0] + pb[3]) / 2, (pb[1] + pb[4]) / 2, (pb[2] + pb[5]) / 2];
  const patTop = mad(patC, up, 1.3 * CM * k), patLat = mad(patC, lat, 1.6 * CM * k, up, 0.4 * CM * k), patMed = mad(patC, lat, -1.6 * CM * k, up, 0.4 * CM * k);
  const tib = P['tibialTub' + S_], pes = mad(tib, lat, -2.6 * CM * k, ant, -1.4 * CM * k, up, 0.6 * CM * k), fib = P['fibHead' + S_];
  const condMedPost = mad(Kc, lat, -2.6 * CM * k, ant, -3.4 * CM * k, up, 2.5 * CM * k), condLatPost = mad(Kc, lat, 2.6 * CM * k, ant, -3.4 * CM * k, up, 2.5 * CM * k);
  const medTibPost = mad(Kc, lat, -2.4 * CM * k, ant, -2.6 * CM * k, up, -2.6 * CM * k), addTub = mad(Kc, lat, -3.6 * CM * k, ant, -0.8 * CM * k, up, 4.2 * CM * k);
  const tub = P['ischTub' + S_], tubL = mad(tub, X_, 0.6 * CM), tubM = mad(tub, X_, -0.3 * CM, Z, -0.4 * CM);
  const face = (r, deg) => fr.surf(r, dirOf(fr, deg));
  const gtBase = mad(F.gt, fr.u, 2.2 * CM * k, ant, 0.4 * CM * k), asis = P['asis' + S_], aiis = q(10.6, -4.2, 0.4), lt = mad(F.Pn, F.sdir, -2.6 * CM * k, F.med, 1.2 * CM * k, F.F.a, -1.2 * CM * k);
  const patApex = mad(patC, fr.u, 1.9 * CM * k, ant, -0.1 * CM * k);
  const L = {
    vastusIntermedius: [face(0.12, 20), face(0.4, 15), face(0.7, 10), patTop],
    vastusLateralis: [gtBase, face(0.3, 105), face(0.6, 100), patLat],
    vastusMedialis: [face(0.1, -40), face(0.4, -110), face(0.75, -95), patMed],
    rectusFemoris: [aiis, mad(fr.at(0.08), ant, 2.6 * CM * k), patTop],
    semimembranosus: [tubL, condMedPost, medTibPost], semitendinosus: [tubM, condMedPost, pes], bicepsFemorisLong: [mad(tubM, X_, 0.5 * CM), condLatPost, fib],
    bicepsFemorisShort: [face(0.45, 160), face(0.75, 140), fib],
    pectineus: [q(3.6, -9.4, 1.4, 0.3), lt, face(0.17, -160)], adductorBrevis: [q(2.2, -13.0, 0.4, 0.7), face(0.2, -165), face(0.38, -170)],
    adductorLongus: [q(2.0, -10.6, 2.4, 0.3), face(0.35, -160), face(0.62, -165)], adductorMagnus: [q(4.8, -16.6, -3.4, 1.0), face(0.3, -170), face(0.72, -160)],
    adductorMagnusIschial: [mad(tub, X_, -0.4 * CM, Z, 0.6 * CM), mad(face(0.6, -140), lat, -1.0 * CM * k), addTub],
    sartorius: [mad(asis, up, -0.6 * CM, Z, -0.4 * CM), condMedPost, pes], gracilis: [q(1.6, -12.4, 1.2, 0.3), condMedPost, pes],
    suprapatellarFat: [face(0.76, 0), face(0.86, 0), face(0.95, 0)],
    poplitealFat: [face(0.7, 180), face(0.86, 180), mad(face(1.0, 180), up, -1.4 * CM * k)],
    // the patellar ligament (the quadriceps' insertion continued: the patella's apex -> the tibial tuberosity)
    patellarLigament: [patApex, mad(tib, ant, 0.2 * CM * k, up, 0.4 * CM * k)] };
  const N = 4, sp = (a, b) => Array.from({ length: N }, (_, i) => a + (b - a) * i / (N - 1));
  const fans = {
    adductorLongus: sp(0.35, 0.62).map(r => [L.adductorLongus[0], face(r, -160 - 5 * (r - 0.35) / 0.27)]),
    adductorBrevis: sp(0.2, 0.38).map(r => [L.adductorBrevis[0], face(r, -165 - 5 * (r - 0.2) / 0.18)]),
    adductorMagnus: sp(0, 1).map(t => [q(2.4 + 3.6 * t, -13.6 - 4.0 * t, 0.2 - 3.2 * t, 1.0), face(0.12 + 0.6 * t, -170 + 10 * t)]),
    // the vasti arise along the shaft (their origin lines: VL the intertrochanteric line, the greater trochanter's base and the lateral lip of the linea
    // aspera; VM the medial lip; VI the anterior and lateral faces of the upper two thirds): fibres from points down the origin to the patella
    vastusLateralis: [L.vastusLateralis, [face(0.22, 120), face(0.5, 115), patLat], [face(0.4, 150), face(0.7, 120), patLat]],
    vastusMedialis: [L.vastusMedialis, [face(0.3, -150), face(0.65, -110), patMed], [face(0.55, -150), face(0.85, -80), patMed]],
    vastusIntermedius: [L.vastusIntermedius, [face(0.2, 70), face(0.55, 50), patTop], [face(0.2, -30), face(0.55, -20), patTop]] };
  const out = {}; for (const [n, pts] of Object.entries(L)) out[n] = { fibres: fans[n] || [pts] };
  return out;
}

// THE LEG BELOW THE KNEE (pelvis/thigh.js crusLines + crusFans, ANAT8-PELVIS lane iteration 18)
function crusLines(B, K, S_, s, fr) {
  const P = K.pts, G = K.geo, F = G['fem' + S_], k = F.kfm;
  const uT = nrm(sub(F.K, F.H)), oT = v => nrm(sub(v, mul(uT, dot(v, uT)))), lT = oT(F.F.l), aT = oT(F.F.a), upT = mul(uT, -1), Kc = F.Kc;
  const condMed = mad(Kc, lT, -2.6 * CM * k, aT, -3.0 * CM * k, upT, 3.0 * CM * k), condLat = mad(Kc, lT, 2.4 * CM * k, aT, -3.0 * CM * k, upT, 2.6 * CM * k);
  const latEpi = mad(Kc, lT, 3.6 * CM * k, aT, -0.6 * CM * k, upT, 0.4 * CM * k);
  const mm = P['medMal' + S_], lm = P['latMal' + S_], heel = P['heel' + S_], a = fr.a, l = fr.l;
  const tib = (r, deg) => fr.surf(r, dirOf(fr, deg)), fib = (r, deg) => fr.fsurf(r, dirOf(fr, deg)), T = fr.T;
  const calc = mad(heel, a, 0.6 * CM * k, Y, 1.5 * CM * k);
  const behindMM = mad(mm, a, -1.2 * CM * k, Y, 0.6 * CM * k), behindLM = mad(lm, a, -1.1 * CM * k, Y, 0.9 * CM * k);
  const frontAnk = (X, Zz) => T(1.0, X * k, Zz * k);
  const L = {
    gastrocnemiusMedialis: [condMed, T(0.05, -2.0 * k, -4.6 * k), T(0.28, -1.6 * k, -5.4 * k), T(0.72, 0.2 * k, -4.4 * k), T(0.92, 0.3 * k, -4.0 * k), calc],
    gastrocnemiusLateralis: [condLat, T(0.05, 2.0 * k, -4.4 * k), T(0.24, 1.8 * k, -5.0 * k), T(0.72, 0.6 * k, -4.4 * k), T(0.92, 0.4 * k, -4.0 * k), calc],
    soleus: [fib(0.06, 180), T(0.3, 0.8 * k, -3.4 * k), T(0.62, 0.6 * k, -3.6 * k), T(0.92, 0.35 * k, -3.6 * k), calc],
    popliteus: [latEpi, T(0.06, 0.2 * k, -2.6 * k), tib(0.17, -150)],
    tibialisPosterior: [T(0.1, 1.4 * k, -1.4 * k), T(0.45, 1.0 * k, -1.8 * k), T(0.82, -0.4 * k, -1.8 * k), behindMM, mad(mm, a, 2.6 * CM * k, Y, -1.8 * CM * k)],
    flexorDigitorumLongus: [tib(0.3, -150), T(0.6, -0.6 * k, -2.2 * k), T(0.88, -0.9 * k, -2.1 * k), mad(behindMM, a, -0.2 * CM * k, Y, -0.6 * CM * k), mad(mm, a, 4.0 * CM * k, Y, -3.6 * CM * k)],
    flexorHallucisLongus: [fib(0.33, 180), T(0.65, 1.4 * k, -2.6 * k), T(0.92, 0.4 * k, -2.4 * k), mad(behindMM, a, -0.6 * CM * k, l, 0.8 * CM * k, Y, -1.2 * CM * k), mad(mm, a, 8.0 * CM * k, Y, -4.6 * CM * k)],
    tibialisAnterior: [tib(0.05, 60), tib(0.35, 75), T(0.82, 0.3 * k, 2.0 * k), frontAnk(-0.6, 2.6), mad(mm, a, 3.6 * CM * k, Y, -2.4 * CM * k, l, 0.6 * CM * k)],
    extensorDigitorumLongus: [fib(0.06, 30), fib(0.4, 15), T(0.82, 1.6 * k, 1.6 * k), frontAnk(1.0, 2.6), mad(lm, a, 7.5 * CM * k, Y, -3.0 * CM * k, l, -1.0 * CM * k)],
    extensorHallucisLongus: [fib(0.36, -30), T(0.68, 1.0 * k, 1.0 * k), frontAnk(0.2, 2.8), mad(mm, a, 10 * CM * k, Y, -4.0 * CM * k, l, 1.0 * CM * k)],
    fibularisLongus: [fib(0.04, 90), fib(0.35, 100), fib(0.72, 125), behindLM, mad(lm, a, 2.0 * CM * k, Y, -3.0 * CM * k)],
    fibularisBrevis: [fib(0.36, 105), fib(0.75, 115), mad(behindLM, Y, 0.4 * CM * k), mad(lm, a, 3.5 * CM * k, Y, -2.5 * CM * k, l, 1.0 * CM * k)],
    infrapatellarFat: (() => { const pat = K.parts.find(p => p.name === 'patella.' + S_), tb = P['tibialTub' + S_]; if (!pat || !tb) return [T(0.02, 0, 2.0 * k), T(0.08, 0, 2.0 * k)];
      const pb = pat.bb, pc = [(pb[0] + pb[3]) / 2, (pb[1] + pb[4]) / 2, (pb[2] + pb[5]) / 2], apex = mad(pc, fr.u, 1.9 * CM * k, a, -0.1 * CM * k), front = T(0.04, 0, 2.0 * k);
      return [mad(apex, a, -1.0 * CM * k), lerp(mad(apex, a, -1.0 * CM * k), front, 0.5), front]; })() };
  const so = L.soleus, tail = so.slice(1);
  const fans = { soleus: [so, [fr.fsurf(0.28, dirOf(fr, -170)), ...tail], [fr.T(0.12, 0.2, -2.0), ...tail], [fr.surf(0.3, dirOf(fr, -140)), ...tail]] };
  const out = {}; for (const [n, pts] of Object.entries(L)) out[n] = { fibres: fans[n] || [pts] };
  return out;
}

// THE HIP: gluteus maximus, medius, minimus, the deep rotators (muscle/trunk.js and pelvis/muscles.js origin and insertion rows), tensor fasciae
// latae, iliacus and psoas (their parts below the region's top cut); a fan's fibres pair its origin row with its insertion row in order
const fan = (O, I, n) => Array.from({ length: n }, (_, m) => { const u = n === 1 ? 0.5 : m / (n - 1), at = (R, t) => { const f = t * (R.length - 1), i = Math.min(R.length - 2, Math.floor(f)); return lerp(R[i], R[i + 1], f - i); }; return [at(O, u), at(I, u)]; });
function hipLines(B, K, S_, s) {
  const P = K.pts, G = K.geo, pv = G['pelvis' + S_], q = pv.q, F = G['fem' + S_], X_ = [s, 0, 0], sac = G.sacrum.rows[s > 0 ? 0 : 2], k = F.kfm;
  const out = {};
  // gluteus maximus: the posterior ilium behind the posterior gluteal line, the sacrum's and coccyx's border, the sacrotuberous ligament -> the iliotibial
  // tract over the trochanter and the gluteal tuberosity
  { const O = [mad(pv.crest[5], Y, -0.4 * CM), mad(pv.crest[6], Y, -0.2 * CM), mad(P['psis' + S_], Z, -0.6 * CM), mad(sac[1], Z, -0.6 * CM), mad(sac[2], Z, -0.6 * CM), mad(sac[3], Z, -0.5 * CM), mad(sac[4], Z, -0.4 * CM), mad(P.coccyxTip, X_, 1.2 * CM), lerp(P.coccyxTip, P['ischTub' + S_], 0.55)];
    const I = [mad(F.gt, F.F.l, 1.2 * CM, F.F.a, -1.0 * CM, Y, -1.0 * CM), mad(F.gt, F.F.l, 1.0 * CM, F.F.a, -1.4 * CM, Y, -4.5 * CM), mad(F.shTop, F.F.u, 6.5 * CM * k, F.F.a, -1.6 * CM, F.F.l, 0.6 * CM)];
    out.gluteusMaximus = { fibres: fan(O, I, 9) }; }
  { const O = [1, 2, 3, 4, 5].map(i => mad(pv.crest[i], Y, -0.5 * CM, X_, 0.4 * CM)), I = [mad(F.gt, F.F.a, 1.0 * CM, Y, 1.2 * CM), mad(F.gt, F.F.a, -0.8 * CM, Y, 1.4 * CM)];
    out.gluteusMedius = { fibres: fan(O, I, 6) }; }
  { const O = [0, 1, 2, 3, 4].map(i => lerp(pv.crest[i], pv.lower[i], 0.5)), I = [mad(F.gt, F.F.a, 1.4 * CM, Y, 0.8 * CM), mad(F.gt, F.F.a, 0.4 * CM, Y, 1.2 * CM)];
    out.gluteusMinimus = { fibres: fan(O, I, 5) }; }
  { const O = [sac[1], sac[2], sac[3], mad(P['ischTub' + S_], Y, 1.5 * CM)], I = [mad(F.gt, F.F.a, -1.4 * CM, Y, 0.6 * CM), mad(F.gt, F.F.a, -1.6 * CM, Y, -2.6 * CM)];
    out.rotators = { fibres: fan(O, I, 4) }; }
  { const FF = { l: nrm(sub(F.F.l, mul(F.sdir, dot(F.F.l, F.sdir)))), a: nrm(sub(F.F.a, mul(F.sdir, dot(F.F.a, F.sdir)))) }, down = mul(F.sdir, -1);
    const asis = P['asis' + S_], tflO = mad(asis, X_, 0.4 * CM, Z, -0.6 * CM), tflI = mad(F.gt, nrm(add(FF.l, FF.a)), 2.2 * CM * k, down, 3.0 * CM * k);
    out.tensorFasciaeLatae = { fibres: [[tflO, lerp(tflO, tflI, 0.5), tflI]] };
    const lt = mad(F.Pn, F.sdir, -2.6 * CM * k, F.med, 1.2 * CM * k, F.F.a, -1.2 * CM * k), HJ = pv.hj, lac = q(7.6, -8.6, 1.6), capF = mad(HJ, FF.a, 2.4 * CM * k, FF.l, -0.6 * CM, Y, -1.2 * CM);
    const lev = n => G.lev[n];
    out.psoas = { fibres: [[mad(lev('L3'), X_, 3.6 * CM, Z, 0.4 * CM), mad(lev('L5'), X_, 4.8 * CM, Z, 1.6 * CM), q(6.6, -6.4, 0.0), lac, capF, mad(lt, FF.a, 0.4 * CM, FF.l, -0.3 * CM)]] };
    const fossa = [q(9.0, 1.0, -4.0), q(8.4, -2.0, -2.8), q(7.8, -5.0, -1.0)].map(p => mad(p, X_, -1.4 * CM));
    out.iliacus = { fibres: [[fossa[0], fossa[1], fossa[2], mad(lac, X_, 0.8 * CM, Z, -0.2 * CM), mad(capF, X_, 0.5 * CM), mad(lt, FF.a, 0.6 * CM)]] }; }
  return out;
}

export function limbFibres(B, K, S_, s) {
  const frT = segFrame(B, K, S_, false), frC = segFrame(B, K, S_, true);
  return { ...hipLines(B, K, S_, s), ...thighLines(B, K, S_, s, frT), ...crusLines(B, K, S_, s, frC), _frames: { thigh: frT, crus: frC } };
}
