// ANATOMY / MUSCLE / TRUNK AND GIRDLE (ANAT8-BODY, 8 Oct 2026, iteration 3; NOTES.md D3, M6: the trunk and the shoulder girdle first, what the
// client's words were about). Every muscle is built from ATTACHMENTS ON THE PERSON'S OWN BONES (skeleton K: K.pts and K.geo, by name), deep to
// superficial, each draped on the layer under it (core.js fanSheet), its thickness the literature's by sex x the person's muscularity
// (sampler.js musclePattern: ALMI z, occupation, age), so the edges and hollows between muscles exist for the fat and the skin to show.
//
// ORDER (deep -> superficial; each layer is the drape target of the next):
//   intercostal wall (the cage's surface between the ribs) | deep abdominal wall (internal oblique + transversus + the posterior rectus sheath) |
//   erector spinae | nuchal (splenius + semispinalis) | supraspinatus, infraspinatus (+ teres minor), teres major | deep hip rotators |
//   serratus anterior | rectus abdominis | external oblique | latissimus dorsi | gluteus medius | gluteus maximus | pectoralis major (clavicular,
//   sternocostal heads) | trapezius (upper, middle, lower) | deltoid (anterior, middle, posterior) | sternocleidomastoid (sternal, clavicular heads)
// The THICKNESS TABLE (REF, mm, full thickness at the belly, adults, by sex) is typed from memory of ultrasound / MRI studies (to check against
// published values with sources: NOTES.md M4); every number is one parameter.
import { part, sdParts } from '../skeleton/sdf.js';
import { chestLevels } from '../skeleton/chest.js';
import { add, sub, mul, dot, len, nrm, crs, lerp, mad, clamp, ss, bump, layerOf, dropOn, resample, fanSheet, strap, slab, spindle } from './core.js';
const CM = 0.01, X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
export const REF = {   // mm
  pecMajor: { m: 20, f: 12 }, pecClav: { m: 14, f: 9 }, deltAnt: { m: 18, f: 13 }, deltMid: { m: 22, f: 16 }, deltPost: { m: 16, f: 12 },
  trapUpper: { m: 10, f: 8 }, trapMid: { m: 6, f: 5 }, trapLower: { m: 5, f: 4 }, latissimus: { m: 8, f: 6 }, latFold: { m: 13, f: 10 }, serratus: { m: 6, f: 4.5 },
  rectusAbd: { m: 12, f: 9 }, extOblique: { m: 8, f: 6 }, deepWall: { m: 13, f: 10 }, scm: { m: 10, f: 8 }, erectorL: { m: 13, f: 10 }, erectorT: { m: 6, f: 5 },
  nuchal: { m: 16, f: 13 }, gluteMax: { m: 30, f: 26 }, gluteMed: { m: 22, f: 18 }, infraspinatus: { m: 17, f: 13 }, supraspinatus: { m: 20, f: 16 }, teresMajor: { m: 14, f: 11 },
  rotators: { m: 15, f: 13 },
};
// which musclePattern key sizes which muscle
const KEY = { pecMajor: 'pectoral', pecClav: 'pectoral', deltAnt: 'deltoid', deltMid: 'deltoid', deltPost: 'deltoid', trapUpper: 'trapUpper', trapMid: 'trapMid', trapLower: 'trapLower',
  latissimus: 'latissimus', latFold: 'latissimus', serratus: 'serratus', rectusAbd: 'rectusAbd', extOblique: 'oblique', deepWall: 'oblique', scm: 'scm', erectorL: 'erector', erectorT: 'erector',
  nuchal: 'trapUpper', gluteMax: 'gluteMax', gluteMed: 'gluteMed', infraspinatus: 'deltoid', supraspinatus: 'deltoid', teresMajor: 'latissimus', rotators: 'gluteMed' };

export function buildTrunk(B, K, ctx) {
  const { sexF, sT, mscale, fatK } = ctx, sx = sexF ? 'f' : 'm', P = K.pts, G = K.geo, out = [], info = {};
  const Tm = k => REF[k][sx] / 1000 * mscale(KEY[k]) * (0.5 + 0.5 * sT);   // the person's belly thickness (m)
  const bones = K.parts, boneL = layerOf(bones), byName = n => bones.find(p => p.name === n);
  const push = (p, deep = true) => { out.push(p); return p; };
  const under = (...extra) => layerOf(bones.concat(out, extra.flat()));
  // ---------------------------------------------------------------- the trunk's axis (the drape rays start on it): x = 0, z = the vertebral bodies' line
  // + 6.5 cm in the thorax, 5 cm in the abdomen (the cage's and the abdomen's own centres)
  const LV = Object.entries(G.lev).map(([n, c]) => ({ n, y: c[1], z: c[2] })).sort((a, b) => a.y - b.y);
  const zLev = y => { if (y <= LV[0].y) return LV[0].z; if (y >= LV[LV.length - 1].y) return LV[LV.length - 1].z; let i = 1; while (LV[i].y < y) i++; const t = (y - LV[i - 1].y) / (LV[i].y - LV[i - 1].y); return LV[i - 1].z + t * (LV[i].z - LV[i - 1].z); };
  const yT12 = G.lev.T12[1], yL2 = G.lev.L2[1], zAx = y => zLev(y) + (y >= yT12 ? 6.5 : y <= yL2 ? 5.0 : 5.0 + 1.5 * (y - yL2) / (yT12 - yL2)) * CM * sT;
  const trunkDir = p => ({ A: [0, p[1], zAx(p[1])], n: nrm([p[0], 0, p[2] - zAx(p[1])]) });
  const fromPt = C => p => ({ A: C, n: nrm(sub(p, C)) });
  const lvAt = n => G.lev[n], sp = n => P['sp_' + n];
  // ================================================================ DEEP LAYER
  // INTERCOSTAL WALL: the cage's surface between the ribs (external and internal intercostals, the costal cartilages' membranes): a slab on the ribs'
  // centrelines from each rib's angle round to its sternal or marginal end, ribs 1-10, 6 mm (the ribs' own thickness): the drape target of the cage's
  // muscles (without it a ray falls between two ribs into the lung)
  for (const [S_, s] of [['L', 1], ['R', -1]]) {
    const rows = []; for (let k = 1; k <= 10; k++) { const R = G.ribs['rib' + k + S_]; let i0 = 0; for (let i = 1; i < R.path.length; i++) if (R.path[i][2] < R.path[i0][2]) i0 = i;
      rows.push(resample(R.path.slice(i0).concat((R.cart || []).slice(1)), 14)); }
    push(slab('intercostal.' + S_, rows, rows.map(r => r.map(() => 0.0062 * sT)), { group: 'trunkDeep', k: 0.004 }));
  }
  // DEEP ABDOMINAL WALL (internal oblique + transversus, the quadratus lumborum's edge at the back, the posterior rectus sheath in front): a loft of
  // cross-sections from the xiphoid down to the pubic crest. Front: the chord xiphoid -> pubic crest bowed forward (bowMax by sex, BMI, age: the
  // abdomen's own convexity, visceral mass included); side: from the 10th rib's lateral point down to the iliac crest (a waist concavity by sex),
  // the inguinal ligament below the ASIS; back: the erectors' lateral edge
  const pL = G.pelvisL, pubF = pL.q(0.9, -9.4, 2.7), yX = P.xiphoidTip[1], zX = P.xiphoidTip[2] - 0.2 * CM, yPub = pubF[1], zPub = pubF[2];
  const r10 = G.ribs.rib10L.lat, crT = P.crestTubL, asis = P.asisL, yCt = P.crestTopL[1], pubTub = pL.q(2.6, -9.0, 2.4);
  let bowMax = ((sexF ? 2.8 : 2.6) + 0.3 * ((B.bmi ?? 22) - 22) + 0.03 * ((B.age ?? 35) - 30)) * CM;
  const sPk = sexF ? 0.6 : 0.5, aPk = Math.log(0.5) / Math.log(sPk), bowAt = s => Math.sin(Math.PI * Math.pow(clamp(s, 0, 1), aPk));
  const zFchord = y => zX + (zPub - zX) * (yX - y) / (yX - yPub), sOf = y => (yX - y) / (yX - yPub);
  // CALIBRATION (NOTES D6: the anatomy places, the measures size): the abdomen's front is the anatomy's predicted convexity, held where v6's own front
  // leaves less than the person's expected abdominal fat + skin + the rectus over it (v6's skin front taken as its max within +-1.5 cm: the navel's
  // dimple is in the skin, not the wall); predicted and held depths are reported (info.abdomen): where v6 holds the wall back, v6's belly is flatter
  // than the anatomy predicts for this person (or the expected fat is high)
  const fatAbd = ctx.fatExp ? ctx.fatExp('abdominal') : (sexF ? 0.017 : 0.014), zFpred = y => zFchord(y) + bowMax * bowAt(sOf(y)), zFc = new Map();
  const skinFmax = y => { let m = -Infinity; for (let d = -0.015; d <= 0.0151; d += 0.005) { const f = ctx.midFront(y + d); if (f === f) m = Math.max(m, f); } return m; };
  const zF = y => { const k = Math.round(y * 200); if (!zFc.has(k)) { const yy = k / 200, sf = skinFmax(yy), cap = sf > -1 ? sf - fatAbd - 0.0015 - 0.0015 - Tm('rectusAbd') : Infinity; zFc.set(k, Math.min(zFpred(yy), cap)); } return zFc.get(k); };
  info.abdomen = { bowPredCm: +(bowMax * 100).toFixed(1), fatExpMm: +(fatAbd * 1000).toFixed(1), heldCm: [0.25, 0.5, 0.75].map(sv => { const y = yX - sv * (yX - yPub); return [+(y * 100).toFixed(1), +((zFpred(y) - zF(y)) * 100).toFixed(1)]; }) };
  const concav = (sexF ? 0.9 : 0.5) * CM * sT, xb = 7.0 * CM * sT;
  const xL = y => { if (y >= r10[1]) return Math.abs(r10[0]) - 0.6 * CM; if (y >= crT[1]) { const t = (r10[1] - y) / (r10[1] - crT[1]); return lerp([Math.abs(r10[0]) - 0.6 * CM], [Math.abs(crT[0]) - 0.8 * CM], t)[0] - concav * Math.sin(Math.PI * t); }
    const t = clamp((crT[1] - y) / (crT[1] - asis[1]), 0, 1); return Math.abs(crT[0]) - 0.8 * CM + t * ((Math.abs(asis[0]) - 1.0 * CM) - (Math.abs(crT[0]) - 0.8 * CM)); };
  const zL = y => { if (y >= r10[1]) return r10[2]; if (y >= crT[1]) return r10[2] + (crT[2] - r10[2]) * (r10[1] - y) / (r10[1] - crT[1]); return crT[2] + (asis[2] - 1.0 * CM - crT[2]) * clamp((crT[1] - y) / (crT[1] - asis[1]), 0, 1); };
  const th0 = y => y >= r10[1] ? 0.45 + 0.3 * clamp((y - r10[1]) / Math.max(0.01, yX - r10[1]), 0, 1) : y >= yCt ? 0 : y >= asis[1] ? 0.3 + 0.25 * (yCt - y) / (yCt - asis[1]) : 0.55 + 0.35 * clamp((asis[1] - y) / (asis[1] - yPub), 0, 1);
  const secPt = (y, th) => { const xl = y < asis[1] ? Math.abs(asis[0]) - 1.0 * CM + (Math.abs(pubTub[0]) - Math.abs(asis[0]) + 1.0 * CM) * clamp((asis[1] - y) / (asis[1] - yPub), 0, 1) : xL(y), zl = zL(y), zb = zLev(y) - 1.0 * CM;
    if (th <= 0.5) return [xb + (xl - xb) * Math.sin(Math.PI * th), zb + (zl - zb) * (1 - Math.cos(Math.PI * th))];
    const f = (th - 0.5) * Math.PI; return [xl * Math.pow(Math.cos(f), 0.85), zl + (zF(y) - zl) * Math.sin(f)]; };
  { const NR = 13, NS = 9, rows = [], T = [];
    for (let r = 0; r < NR; r++) { const y = yX - (yX - yPub) * r / (NR - 1), t0 = th0(y), row = [], tr = [];
      const ths = Array.from({ length: NS }, (_, i) => t0 + (1 - t0) * i / (NS - 1));
      const tw = th => (th < 0.15 ? 12 : th < 0.75 ? Tm('deepWall') * 1000 : th < 0.88 ? Tm('deepWall') * 1000 + (2.5 - Tm('deepWall') * 1000) * (th - 0.75) / 0.13 : 2.5) / 1000 * (y < asis[1] ? 0.6 : 1);
      for (let i = 0; i < NS; i++) { const [x, z] = secPt(y, ths[i]); row.push([-x, y, z]); tr.push(tw(ths[i])); }
      for (let i = NS - 2; i >= 0; i--) { const [x, z] = secPt(y, ths[i]); row.push([x, y, z]); tr.push(tw(ths[i])); }
      rows.push(row); T.push(tr); }
    push(slab('abdominalWall', rows, T, { group: 'trunkDeep', k: 0.004, up: 2 })); }
  // ERECTOR SPINAE (iliocostalis, longissimus, spinalis) in the gutter beside the spinous processes, S2 -> T1: the deep face on the laminae and the
  // transverse processes (forward to the rib angles laterally), the back face level with the spinous tips beside them and bulging behind them by
  // E (lumbar 1.0 cm in men, 0.8 in women at average muscularity; thoracic 0.35; nothing over the sacrum) x muscularity
  const mE = mscale('erector');
  for (const [S_, s] of [['L', 1], ['R', -1]]) {
    const lv = ['T1', 'T2', 'T4', 'T6', 'T8', 'T10', 'T12', 'L1', 'L2', 'L3', 'L4', 'L5'], rows = [], T = [];
    const row = (y, zLam, zTip, xmax, E, cb = 0) => { const xs = [0.9, 0.3, 0.5, 0.7, 0.88, 1].map((f, i) => (i === 0 ? 0.9 * CM : f * xmax)), r = [], t = [];
      for (const x of xs) { const u = clamp((x - 0.9 * CM) / (xmax - 0.9 * CM), 0, 1), zd = zLam + 0.25 * CM * Math.pow(x / (2.5 * CM), 2), zb = zTip + 0.3 * CM + cb * u * u - E * Math.pow(Math.sin(Math.PI * clamp(u * 0.92 + 0.04, 0, 1)), 0.7) + (u > 0.85 ? (u - 0.85) / 0.15 * 0.6 * (zd - zTip) : 0);
        const th = Math.max(0.002, zd - zb); r.push([s * x, y, (zd + zb) / 2]); t.push(th); } rows.push(r); T.push(t); };
    // the sacral origin: the aponeurosis over S1-S3 (thin), then the levels
    { const sac = G.sacrum.rows[1], yS2 = sac[1][1], zS2 = sac[1][2] - 0.4 * CM; row(yS2, zS2 + 0.6 * CM, zS2, 4.5 * CM * sT, 0.0); }
    for (const n of lv.slice().reverse()) { const V = G.vert[n], c = V.c, zLam = c[2] - V.d / 2 - V.canal - 0.2 * CM, zTip = sp(n)[2], y = c[1];
      const lum = n[0] === 'L', E = (lum ? (sexF ? 0.8 : 1.0) : n === 'T12' || n === 'T10' ? 0.6 : 0.35) * CM * mE * (n === 'L5' ? 0.6 : 1), xmax = (lum ? 6.8 : n === 'T1' || n === 'T2' ? 4.2 : 5.8) * CM * sT;
      row(y, zLam, Math.min(zTip, zLam - 0.8 * CM), xmax, E, (lum ? 0.6 : 1.8) * CM * sT); }
    push(slab('erector.' + S_, rows, T, { group: 'back', k: 0.006, up: 2 }));
  }
  // the skull's insertions (HEAD's names; until HEAD's skull runs in this bake, the rule in HEAD's craniometric frame, mm: the inion 7 mm inside the
  // occiput's skin, the superior nuchal line 34 mm lateral, the mastoid tip 9 mm inside the skin laterally, ~29 / 26 mm under the FH, 6 mm behind the porion)
  const sk = ctx.skull || skullRule(B, G.frH, sexF, K.faceIds);
  info.skull = Object.fromEntries(Object.entries(sk).map(([k, v]) => [k, v.map(q => +(q * 100).toFixed(1))]));
  // NUCHAL (splenius capitis + semispinalis capitis + the deep cervical extensors) from the superior nuchal line down to T3 beside the spinous processes
  for (const [S_, s] of [['L', 1], ['R', -1]]) {
    const mN = mscale('trapUpper') ** 0.5, rows = [], T = [];
    const lev = ['C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'T1', 'T3'], bul = { C2: 1.1, C3: 1.2, C4: 1.2, C5: 1.1, C6: 0.9, C7: 0.5, T1: 0.35, T3: 0.15 };
    { const a = sk['SNL_med_' + S_], b = sk['SNL_lat_' + S_], top = [0.15, 0.5, 0.85, 1].map(t => mad(lerp(sk.Inion, b, t), Z, 0.6 * CM)); top[0][0] = s * 0.8 * CM; rows.push(top); T.push([4, 8, 8, 5].map(v => v / 1000 * mN)); }
    for (const n of lev) { const V = G.vert[n], c = V.c, zLam = c[2] - V.d / 2 - V.canal - 0.2 * CM, zTip = sp(n)[2], xm = (n[0] === 'C' ? 3.6 : 2.8) * CM * sT, r = [], t = [];
      for (const f of [0.2, 0.5, 0.8, 1]) { const x = f * xm, zb = zTip - bul[n] * CM * mN * Math.sin(Math.PI * clamp(f * 0.9, 0, 1)) * (f < 0.25 ? 0.6 : 1) + 0.15 * CM, zd = zLam + 0.3 * CM * f * f; r.push([s * x, c[1], (zb + zd) / 2]); t.push(Math.max(0.002, zd - zb)); }
      rows.push(r); T.push(t); }
    push(slab('nuchal.' + S_, rows, T, { group: 'back', k: 0.006 }));
  }
  // SCAPULAR MUSCLES: infraspinatus + teres minor (the infraspinous fossa -> the greater tubercle's posterior facets), supraspinatus (the supraspinous
  // fossa -> under the acromion -> the tubercle's top), teres major (the inferior angle -> the medial lip of the intertubercular groove)
  for (const [S_, s] of [['L', 1], ['R', -1]]) {
    const Sc = G['scap' + S_], H = G['hum' + S_], post = Sc.post, gt = P['greaterTub' + S_], hAt = H.at;
    const U0 = layerOf(bones.filter(p => /^(scapula|humerus|clavicle)\.|^rib\d/.test(p.name)));
    const tI = Tm('infraspinatus');
    push(fanSheet({ name: 'infraspinatus.' + S_, group: 'cuff', O: [Sc.root, lerp(Sc.root, Sc.inf, 0.5), Sc.inf], I: [hAt(0.9, -0.2, -1.6 * H.kh), hAt(1.0, 0.8, -1.5 * H.kh)], nu: 7, nv: 9, U: U0,
      dir: p => ({ A: mad(p, post, -0.1), n: nrm(add(post, mul(nrm(sub(p, Sc.G)), 0.25))) }), gap: () => 0.002, w: (u, v) => 1 - ss((v - 0.75) / 0.25) * 0.6,
      T: (u, v) => tI * (0.35 + 0.65 * bump(v, -0.3, 0.35, 1.05)) * (0.45 + 0.55 * Math.sin(Math.PI * clamp(u, 0.02, 0.98))) }));
    const tS = Tm('supraspinatus'), sTop = mad(Sc.sa, post, 0.4 * CM), sRoot = mad(Sc.root, Y, 1.2 * CM * sT);
    push(fanSheet({ name: 'supraspinatus.' + S_, group: 'cuff', O: [sTop, sRoot], I: [hAt(0.2, -1.2 * H.kh, 0.4), hAt(0.9, -0.9 * H.kh, -0.4)], nu: 5, nv: 8, U: U0,
      guide: (u, v, o, i) => mad(lerp(o, i, v), Y, 1.0 * CM * Math.sin(Math.PI * v)), dir: p => ({ A: mad(p, nrm(add(post, Y)), -0.1), n: nrm(add(post, Y)) }), gap: () => 0.001,
      w: (u, v) => 1 - ss((v - 0.5) / 0.25), T: (u, v) => tS * (0.4 + 0.6 * bump(v, -0.3, 0.3, 1.0)) * (0.5 + 0.5 * Math.sin(Math.PI * clamp(u, 0.05, 0.95))) }));
    const tT = Tm('teresMajor'), o1 = mad(lerp(Sc.inf, Sc.igl, 0.25), post, 0.5 * CM), ins = hAt(-0.6, 3.2 * H.kh, 0.9 * H.kh);
    push(spindle('teresMajor.' + S_, [o1, mad(lerp(o1, ins, 0.35), post, 0.6 * CM), mad(lerp(o1, ins, 0.7), post, 0.3 * CM), ins], [0.45, 1.0, 0.85, 0.35].map(f => f * tT * 0.75), { group: 'cuff' }));
  }
  // DEEP HIP ROTATORS (piriformis, the obturator internus and gemelli, quadratus femoris): the sacrum's lateral border and the ischium -> the
  // trochanter's back: they fill the hollow behind the sciatic notch that gluteus maximus lies on
  for (const [S_, s] of [['L', 1], ['R', -1]]) {
    const pv = G['pelvis' + S_], F = G['fem' + S_], sac = G.sacrum.rows[s > 0 ? 0 : 2], tR = Tm('rotators'), back = [0, 0, -1];
    const O = [sac[1], sac[2], sac[3], mad(P['ischTub' + S_], Y, 1.5 * CM)], I = [mad(F.gt, F.F.a, -1.4 * CM, Y, 0.6 * CM), mad(F.gt, F.F.a, -1.6 * CM, Y, -2.6 * CM)];
    const Hc = [s * 0.03, F.H[1], F.H[2] + 0.02];
    push(fanSheet({ name: 'rotators.' + S_, group: 'hipDeep', O, I, nu: 6, nv: 8, U: layerOf(bones.filter(p => /^(coxa|sacrum|femur)/.test(p.name))), dir: fromPt(Hc), gap: () => 0.002,
      T: (u, v) => tR * (0.4 + 0.6 * bump(v, -0.2, 0.45, 1.05)) * (0.6 + 0.4 * Math.sin(Math.PI * u)) }));
  }
  // ================================================================ THE CAGE'S AND THE ABDOMEN'S MUSCLES
  // SERRATUS ANTERIOR: digitations from ribs 1-9 at the anterior axillary line, round the cage UNDER the scapula to its medial border (the upper slips to
  // the superior angle, the lower five converging on the inferior angle); draped on the cage only (it lies between the cage and the scapula); the
  // digitations are thickness notches along the origin (the serrations show below the pectoral's border on lean men)
  const cageL = layerOf(bones.filter(p => /^(rib\d|sternum)/.test(p.name)).concat(out.filter(p => /^intercostal/.test(p.name))));
  for (const [S_, s] of [['L', 1], ['R', -1]]) {
    const Sc = G['scap' + S_], tSe = Tm('serratus'), O = [], I = [];
    const azi = k => (k <= 2 ? 0.62 : k <= 4 ? 0.66 : 0.70 - 0.02 * (k - 5));   // the station along the rib (from its angle) at the anterior axillary line
    for (let k = 1; k <= 9; k++) { const R = G.ribs['rib' + k + S_]; let i0 = 0; for (let i = 1; i < R.path.length; i++) if (R.path[i][2] < R.path[i0][2]) i0 = i; const line = resample(R.path.slice(i0), 40); O.push(line[Math.round(azi(k) * 39)]); }
    const borderPt = t => lerp(Sc.sa, Sc.root, Math.min(1, t / 0.3)), med = t => t < 0.3 ? borderPt(t) : lerp(Sc.root, Sc.inf, (t - 0.3) / 0.7);
    for (let k = 1; k <= 9; k++) I.push(mad(med(k <= 2 ? 0.1 * k : k <= 4 ? 0.3 + 0.12 * (k - 3) : 0.75 + 0.25 * (k - 5) / 4), Sc.post, -0.6 * CM));
    const nDig = 9, dig = u => 0.55 + 0.45 * Math.pow(Math.cos(Math.PI * u * (nDig - 1)), 2);
    push(fanSheet({ name: 'serratusAnterior.' + S_, group: 'trunk', O, I, nu: 17, nv: 10, U: cageL, dir: trunkDir, gap: () => 0.001, smooth: 1,
      T: (u, v) => tSe * (0.5 + 0.5 * bump(v, -0.3, 0.3, 1.1)) * (v < 0.35 ? dig(u) + (1 - dig(u)) * ss(v / 0.35) : 1) * (0.7 + 0.3 * Math.sin(Math.PI * u)) }));
  }
  // RECTUS ABDOMINIS in its sheath: from the 5th-7th costal cartilages and the xiphoid to the pubic crest; the linea alba between the pair (1.0-1.4 cm
  // wide above the umbilicus, narrow below); THREE TENDINOUS INTERSECTIONS (at the xiphoid's tip, at the umbilicus, midway) as 30 % thinner bands
  const umb = B.lm.omphalion || [0, (yX + yPub) / 2, 0], tRa = Tm('rectusAbd');
  { const yTop = P.xiphisternal[1] + 0.5 * CM * sT, yB = yPub, Lr = yTop - yB, vOf = y => clamp((yTop - y) / Lr, 0, 1);
    const ints = [vOf(P.xiphoidTip[1] - 0.6 * CM), (vOf(P.xiphoidTip[1] - 0.6 * CM) + vOf(umb[1])) / 2, vOf(umb[1] + 0.4 * CM)];
    const vs = [...new Set([0, 0.04, 0.12, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, ...ints.flatMap(v => [v - 0.012, v, v + 0.012])].map(v => +clamp(v, 0, 1).toFixed(4)))].sort((a, b) => a - b);
    const wTop = (sexF ? 7.4 : 8.4) * CM * sT, wMid = (sexF ? 6.4 : 7.2) * CM * sT, wBot = (sexF ? 2.8 : 3.2) * CM * sT, xMed = v => (v < 0.55 ? lerp([0.7], [0.55], v / 0.55)[0] : lerp([0.55], [0.2], (v - 0.55) / 0.45)[0]) * CM * sT;
    const xLat = v => v < 0.45 ? wTop + (wMid - wTop) * ss(v / 0.45) : wMid + (wBot - wMid) * ss((v - 0.45) / 0.55);
    for (const [S_, s] of [['L', 1], ['R', -1]]) {
      const guide = (u, v) => { const y = yTop - Lr * v + u * (v < 0.15 ? (1 - v / 0.15) * 3.0 * CM * sT : 0), x = xMed(v) + u * (xLat(v) - xMed(v)); return [s * x, y, zF(y) + 1.0 * CM]; };
      const notch = v => 1 - 0.3 * Math.max(...ints.map(c => Math.max(0, 1 - Math.abs(v - c) / 0.013)));
      push(fanSheet({ name: 'rectusAbdominis.' + S_, group: 'trunk', O: [[0, 0, 0]], I: [0, 0, 0], guide, nu: 7, vs, U: under(), dir: trunkDir, gap: () => 0.0015, smooth: 1,
        T: (u, v) => tRa * (v < 0.12 ? 0.55 + 0.45 * v / 0.12 : v > 0.85 ? 1 - 0.3 * (v - 0.85) / 0.15 : 1) * (u > 0.8 ? 1 - 0.55 * (u - 0.8) / 0.2 : u < 0.1 ? 0.85 + 0.15 * u / 0.1 : 1) * notch(v) }));
    }
    info.rectus = { intersectionsV: ints.map(v => +v.toFixed(3)), umbilicusCm: +(umb[1] * 100).toFixed(1) };
  }
  // EXTERNAL OBLIQUE: digitations from ribs 5-12 (interlocking with serratus and latissimus), fibres down and forward: the posterior ones to the
  // iliac crest's outer lip (the FLANK over the crest), the anterior ones into the aponeurosis at the linea semilunaris and the inguinal ligament
  // (thin: the muscular part ends on a line down from the 9th cartilage and across from the ASIS)
  const tEo = Tm('extOblique');
  for (const [S_, s] of [['L', 1], ['R', -1]]) {
    const azi = { 5: 0.8, 6: 0.76, 7: 0.71, 8: 0.64, 9: 0.58, 10: 0.52 }, O = [];
    for (let k = 5; k <= 12; k++) { const R = G.ribs['rib' + k + S_]; if (k >= 11) { O.push(R.path[R.path.length - 1]); continue; } let i0 = 0; for (let i = 1; i < R.path.length; i++) if (R.path[i][2] < R.path[i0][2]) i0 = i; const line = resample(R.path.slice(i0).concat((R.cart || []).slice(1)), 40); O.push(line[Math.round(azi[k] * 39)]); }
    const semi = y => { const x = (sexF ? 6.6 : 7.4) * CM * sT; return [s * x, y, zF(y) + 1.0 * CM]; };
    const I = [semi(yX - 3 * CM), semi(umb[1]), mad(lerp(P['asis' + S_], pL.q(2.6, -9.0, 2.4).map((v, i) => i === 0 ? s * Math.abs(v) : v), 0.5), Z, 0.5 * CM), mad(P['asis' + S_], [s, 0, 0], 0.3 * CM), mad(P['crestTub' + S_], [s, 0, 0], 0.4 * CM), mad(lerp(P['crestTub' + S_], P['crestTop' + S_], 0.45), [s, 0, 0], 0.4 * CM)];
    const vm = u => u < 0.55 ? 0.5 + 0.25 * u / 0.55 : 1;
    push(fanSheet({ name: 'externalOblique.' + S_, group: 'trunk', O, I, nu: 15, nv: 12, U: under(), dir: trunkDir, gap: () => 0.001, smooth: 2,
      T: (u, v) => tEo * (v <= vm(u) ? (0.55 + 0.45 * bump(v, -0.2, 0.4, vm(u) + 0.15)) : 0.18) * (u > 0.92 ? 0.75 : 1) * (v < 0.15 ? 0.5 + 0.5 * v / 0.15 : 1) }));
  }
  // LATISSIMUS DORSI: T7-T12's spinous processes, the thoracolumbar fascia (L1-S2: aponeurotic, wide), the posterior iliac crest, ribs 10-12 -> the floor
  // of the intertubercular groove (the fibres twist: the upper ones insert lowest); the free lateral edge and the POSTERIOR AXILLARY FOLD (with teres
  // major) bridge from the cage to the arm
  const tLd = Tm('latissimus'), tLf = Tm('latFold');
  for (const [S_, s] of [['L', 1], ['R', -1]]) {
    const H = G['hum' + S_], pv = G['pelvis' + S_], O = [];
    for (const n of ['T7', 'T8', 'T9', 'T10', 'T11', 'T12', 'L1', 'L2', 'L3', 'L4', 'L5']) O.push(mad(sp(n), [s, 0, 0], 0.4 * CM));
    O.push(mad(G.sacrum.rows[1][1], [s, 0, 0], 1.2 * CM), mad(P['psis' + S_], Z, -0.4 * CM), mad(pv.crest[6], Y, 0.3 * CM), mad(pv.crest[5], Y, 0.4 * CM), mad(pv.crest[4], Y, 0.4 * CM));
    for (const k of [12, 11, 10]) O.push(G.ribs['rib' + k + S_].lat);
    const I = [H.at(-0.2, 4.6 * H.kh, 1.0 * H.kh), H.at(-0.25, 2.6 * H.kh, 1.05 * H.kh)];
    const nO = O.length, uLum = 6 / (nO - 1), uCr = 13 / (nO - 1);   // T12 at u ~ 0.33, the crest from u ~ 0.72
    const vm = u => u < uLum ? 0.08 : u < uCr ? 0.08 + 0.42 * Math.sin(Math.PI * clamp((u - uLum) / (uCr - uLum), 0, 1) * 0.5 + Math.PI * 0.5 * 0) : Math.max(0, 0.5 - 0.5 * (u - uCr) / (1 - uCr));
    push(fanSheet({ name: 'latissimus.' + S_, group: 'trunk', O, I, nu: 19, nv: 12, U: under(), dir: trunkDir, gap: () => 0.0012, smooth: 2,
      w: (u, v) => 1 - ss((v - 0.62) / 0.3), bulge: (u, v) => 0.3 * CM * bump(v, 0.5, 0.82, 1.0),
      T: (u, v) => { const a = ss((v - vm(u)) / 0.15); return Math.max(0.0012, (0.15 * (1 - a) + a) * (tLd + (tLf - tLd) * ss((v - 0.68) / 0.2) * ss((u - 0.45) / 0.3)) * (v > 0.92 ? 1 - 0.5 * (v - 0.92) / 0.08 : 1)); } }));
  }
  // ================================================================ THE HIP
  // GLUTEUS MEDIUS: the ilium's outer face under the crest (ASIS to the posterior third) -> the greater trochanter's lateral face; gluteus minimus
  // under it (the gap); its upper front third lies under the fat only (the hip's lateral bulge above the trochanter)
  const tGm = Tm('gluteMed'), tGx = Tm('gluteMax');
  for (const [S_, s] of [['L', 1], ['R', -1]]) {
    const pv = G['pelvis' + S_], F = G['fem' + S_], O = [1, 2, 3, 4, 5].map(i => mad(pv.crest[i], Y, -0.5 * CM, [s, 0, 0], 0.4 * CM)), I = [mad(F.gt, F.F.a, 1.0 * CM, Y, 1.2 * CM), mad(F.gt, F.F.a, -0.8 * CM, Y, 1.4 * CM)];
    const Hc = [s * 0.035, F.H[1] + 0.05, F.H[2]];
    push(fanSheet({ name: 'gluteusMedius.' + S_, group: 'hip', O, I, nu: 9, nv: 10, U: under(), dir: fromPt(Hc), gap: (u, v) => (0.007 - 0.005 * v), smooth: 2,
      T: (u, v) => tGm * (0.35 + 0.65 * bump(v, -0.25, 0.4, 1.08)) * (0.65 + 0.35 * Math.sin(Math.PI * u)) }));
  }
  // GLUTEUS MAXIMUS: the posterior ilium behind the posterior gluteal line, the sacrum's and coccyx's lateral border, the sacrotuberous ligament ->
  // the iliotibial tract (upper and superficial fibres, at the trochanter) and the gluteal tuberosity (the deep lower fibres); thick, coarse
  for (const [S_, s] of [['L', 1], ['R', -1]]) {
    const pv = G['pelvis' + S_], F = G['fem' + S_], sac = G.sacrum.rows[s > 0 ? 0 : 2];
    const O = [mad(pv.crest[5], Y, -0.4 * CM), mad(pv.crest[6], Y, -0.2 * CM), mad(P['psis' + S_], Z, -0.6 * CM), mad(sac[1], Z, -0.6 * CM), mad(sac[2], Z, -0.6 * CM), mad(sac[3], Z, -0.5 * CM), mad(sac[4], Z, -0.4 * CM), mad(P.coccyxTip, [s, 0, 0], 1.2 * CM), lerp(P.coccyxTip, P['ischTub' + S_], 0.55)];
    const I = [mad(F.gt, F.F.l, 1.2 * CM, F.F.a, -1.0 * CM, Y, -1.0 * CM), mad(F.gt, F.F.l, 1.0 * CM, F.F.a, -1.4 * CM, Y, -4.5 * CM), mad(F.shTop, F.F.u, 6.5 * CM * F.kfm, F.F.a, -1.6 * CM, F.F.l, 0.6 * CM)];
    const Hc = [s * 0.02, F.H[1] + 0.03, F.H[2] + 0.025];
    push(fanSheet({ name: 'gluteusMaximus.' + S_, group: 'hip', O, I, nu: 13, nv: 11, U: under(), dir: fromPt(Hc), gap: () => 0.002, smooth: 2,
      T: (u, v) => tGx * (0.3 + 0.7 * bump(v, -0.25, 0.42, 1.12)) * (0.55 + 0.45 * Math.sin(Math.PI * clamp(u * 0.9 + 0.08, 0, 1))) }));
  }
  // ================================================================ THE GIRDLE'S SUPERFICIAL MUSCLES
  // PECTORALIS MAJOR: the clavicular head (the clavicle's medial half) and the sternocostal head (the sternum's edge, cartilages 1-6, the external
  // oblique's aponeurosis: the abdominal part) -> the lateral lip of the intertubercular groove (the upper fibres insert lowest: the fold's twist);
  // the lower border is the ANTERIOR AXILLARY FOLD, a free bridge from the cage to the arm
  const tPm = Tm('pecMajor'), tPc = Tm('pecClav');
  for (const [S_, s] of [['L', 1], ['R', -1]]) {
    const H = G['hum' + S_], C = G['clav' + S_], st = G.sternum;
    const Oc = resample([0.5, 0.38, 0.26, 0.15, 0.05].map(t => mad(along(C.pts, t), C.fw, 1.0 * CM * sT, Y, -0.35 * CM)), 6);   // on the clavicle's front face (its radius ~0.6-0.9 cm)
    const Os = [st.at(0.6, s * st.stw(2.4), 0.5), ...[1, 2, 3, 4, 5].map(k => st.at(st.attD[k], s * st.stw(1.45), 0.45)), st.at(st.xs, s * st.stw(1.6), 0.4)];
    { const c6 = G.ribs['rib6' + S_].cart; if (c6 && c6.length) Os.push(mad(c6[Math.floor(c6.length / 2)], Z, 0.4 * CM)); }
    Os.push([s * (sexF ? 6.5 : 7.5) * CM * sT, yX - 1.2 * CM * sT, zF(yX - 1.2 * CM) + 0.9 * CM]);
    const IcL = [H.at(0.55, 8.6 * H.kh, 1.45 * H.kh), H.at(0.55, 6.6 * H.kh, 1.5 * H.kh)], IsL = [H.at(0.5, 7.2 * H.kh, 1.5 * H.kh), H.at(0.45, 3.2 * H.kh, 1.55 * H.kh)];   // the tendon on the lateral lip's surface (the shaft ~1.1 cm)
    const wP = (u, v) => 1 - ss((v - 0.5) / 0.38);
    push(fanSheet({ name: 'pectoralisClav.' + S_, group: 'chest', O: Oc, I: IcL, nu: 6, nv: 10, U: under(), dir: trunkDir, gap: () => 0.0015, w: (u, v) => ss(v / 0.15) * wP(u, v), smooth: 2,
      bulge: (u, v) => 0.4 * CM * bump(v, 0.45, 0.8, 1),
      T: (u, v) => tPc * (0.2 + 0.8 * bump(v, -0.1, 0.45, 1.1)) * (0.7 + 0.3 * Math.sin(Math.PI * u)) }));
    // v2 (lane iteration 6): THE LOWER BORDER BY RIB LEVEL. In v1 every fibre ran straight (in the front view) from its origin to the humerus, so the lowest,
    // from the abdominal slip below the xiphoid, rose ~9 cm in its first 4.5 cm of x and crossed the midclavicular line at the 5th rib's UPPER edge: the
    // lower border sat 3 cm high and the men's nipple, hung 2.5 cm above it, 2-2.5 cm above ANSUR. The atlases put the lower border on the MCL over the
    // 5th rib / 5th space (the lowest origin on the 6th rib or cartilage in 80 %, ~1 cm above the inframammary fold: Baek et al. 2017, Clin Anat 30:357).
    // So the lower fibres pass THROUGH a point Q(u) on the chest wall on the MCL: the straight chord's crossing lowered by a share that grows from 0 (u <= 0.2:
    // the manubrial and upper costal fibres as v1) to the whole drop at u = 1, where Q is the 5th rib's lower half (the border itself; the sheet's rounded
    // edge reaches the rib's lower edge), on a quadratic Bezier origin -> Q -> insertion blended in from u 0.15 to 0.7 (the drape lays it on the wall); and
    // the lower fibres keep their thickness out to the border (v1 thinned them 60 % over the first 30 % of their length: a 5 mm sheet where the border
    // should roll); only the abdominal slip's first ~15 % stays thin.
    let guide = null, Tlow = null;   // (v1's chord and thinning deleted in lane iteration 10: one current version)
    {
      const CL = chestLevels(K, S_), yLowX = 0.5 * (CL.mid(5) + CL.lo(5)), U0 = under(), zFr = P.xiphisternal[2] + 0.16, Qc = new Map();
      const onWall = (x, y) => { let z = zFr; for (let i = 0; i < 300; i++) { const d = U0.d(x, y, z); if (d <= 0.002) break; z -= Math.max(0.0005, 0.8 * (d - 0.002)); } return [x, y, z]; };
      // the straight chord's crossing of the MCL in the front view (where v1's fibre u would cross, before its drape)
      const yChord = (Oi, Ii) => { const t = clamp((CL.xm - Math.abs(Oi[0])) / Math.max(1e-6, Math.abs(Ii[0]) - Math.abs(Oi[0])), 0, 1); return Oi[1] + t * (Ii[1] - Oi[1]); };
      const yC1 = yChord(Os[Os.length - 1], IsL[IsL.length - 1]);
      if (yLowX === yLowX) guide = (u, v, Oi, Ii) => { const key = u.toFixed(4); if (!Qc.has(key)) { const Q = onWall(s * CL.xm, yChord(Oi, Ii) + (yLowX - yC1) * ss((u - 0.2) / 0.8)), a = len(sub(Q, Oi)), b = len(sub(Ii, Q)), vq = clamp(a / (a + b), 0.1, 0.6);
          Qc.set(key, { vq, C: mul(sub(sub(Q, mul(Oi, (1 - vq) ** 2)), mul(Ii, vq * vq)), 1 / (2 * vq * (1 - vq))) }); }
        const { C } = Qc.get(key), bez = add(add(mul(Oi, (1 - v) ** 2), mul(C, 2 * v * (1 - v))), mul(Ii, v * v)); return lerp(lerp(Oi, Ii, v), bez, ss((u - 0.15) / 0.55)); };
      Tlow = (u, v) => 1 - 0.6 * ss((u - 0.75) / 0.25) * (1 - ss((v - 0.04) / 0.12));
      (info.pecV2 ||= {})[S_] = { mclCm: +(CL.xm * 100).toFixed(1), rib5lowerHalfYcm: +(yLowX * 100).toFixed(1), chordYcm: +(yC1 * 100).toFixed(1), guide: !!guide };
    }
    push(fanSheet({ name: 'pectoralisStern.' + S_, group: 'chest', O: Os, I: IsL, nu: 13, nv: 12, U: under(), dir: trunkDir, gap: () => 0.0015, w: wP, smooth: 2, ...(guide ? { guide } : {}),
      bulge: (u, v) => 0.9 * CM * bump(v, 0.45, 0.78, 1) * (0.4 + 0.6 * u),
      T: (u, v) => tPm * (0.16 + 0.84 * Math.pow(bump(v, -0.05, 0.46, 1.12), 1.2)) * Tlow(u, v) * (u < 0.08 ? 0.75 + 0.25 * u / 0.08 : 1) }));
  }
  // TRAPEZIUS: the upper part (the superior nuchal line, the inion, the nuchal ligament -> the clavicle's lateral third), the middle (C7-T3 -> the
  // acromion and the spine's upper lip), the lower (T4-T12 -> the root of the spine); the tendinous diamond over C7-T1 thin
  for (const [S_, s] of [['L', 1], ['R', -1]]) {
    const C = G['clav' + S_], Sc = G['scap' + S_], spU = Sc.spine;
    const nuchal = ['C2', 'C3', 'C4', 'C5', 'C6'].map(n => [s * 0.3 * CM, sp(n)[1], sp(n)[2] - 1.0 * CM]);
    const cU = [0, G.lev.T6[1], zAx(G.lev.T6[1])], cM = [0, G.lev.T4[1], zAx(G.lev.T4[1]) - 1.0 * CM];
    const dirU = p => { const C0 = p[1] > G.lev.C7[1] ? [0, Math.min(p[1] - 0.03, G.lev.C4[1]), zLev(p[1]) + 1.5 * CM] : cU; return { A: C0, n: nrm(sub(p, C0)) }; };
    const tU = Tm('trapUpper'), tMd = Tm('trapMid'), tLo = Tm('trapLower');
    push(fanSheet({ name: 'trapeziusUpper.' + S_, group: 'back', O: [mad(sk['SNL_lat_' + S_], Z, 0.3 * CM), mad(sk['SNL_med_' + S_], Z, -0.3 * CM), mad(sk.Inion, Z, -0.3 * CM), ...nuchal, mad(sp('C7'), Z, -0.3 * CM)],
      I: [mad(along(C.pts, 0.62), Y, 0.4 * CM, C.fw, -0.3 * CM), mad(along(C.pts, 0.8), Y, 0.4 * CM, C.fw, -0.4 * CM), mad(C.ac, Y, 0.5 * CM, C.fw, -0.6 * CM), mad(Sc.acB, Y, 0.5 * CM)],
      nu: 10, nv: 11, U: under(), dir: dirU, gap: () => 0.0012, smooth: 2,
      T: (u, v) => tU * (0.15 + 0.85 * bump(v, -0.05, 0.6, 1.08)) * (u < 0.25 ? 0.5 + 0.5 * u / 0.25 : 1) }));
    push(fanSheet({ name: 'trapeziusMiddle.' + S_, group: 'back', O: ['C7', 'T1', 'T2', 'T3'].map(n => mad(sp(n), Z, -0.3 * CM)), I: [mad(Sc.acB, Y, 0.3 * CM), mad(spU[2], Y, 0.4 * CM), mad(spU[1], Y, 0.4 * CM)],
      nu: 7, nv: 11, U: under(), dir: fromPt(cM), gap: () => 0.0012, smooth: 2,
      T: (u, v) => tMd * (0.25 + 0.75 * ss((v - 0.12) / 0.2)) * (0.4 + 0.6 * bump(v, 0, 0.55, 1.1)) }));
    push(fanSheet({ name: 'trapeziusLower.' + S_, group: 'back', O: ['T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'].map(n => mad(sp(n), Z, -0.3 * CM)), I: [mad(spU[1], Y, -0.2 * CM), mad(Sc.root, Y, -0.6 * CM)],
      nu: 11, nv: 10, U: under(), dir: trunkDir, gap: () => 0.0012, smooth: 2,
      T: (u, v) => tLo * (0.2 + 0.8 * ss((v - 0.1) / 0.25)) * (0.5 + 0.5 * bump(v, 0, 0.6, 1.05)) * (u > 0.85 ? 1 - 0.5 * (u - 0.85) / 0.15 : 1) }));
  }
  // DELTOID: three heads from the clavicle's lateral third, the acromion's lateral edge and the scapular spine's lower lip -> the deltoid tuberosity
  // (~45 % down the humerus), draped over the humeral head and the cuff (the subdeltoid bursa: the gap); separate parts, so the furrows between
  // the heads exist (lean, muscular people show them)
  for (const [S_, s] of [['L', 1], ['R', -1]]) {
    const H = G['hum' + S_], C = G['clav' + S_], Sc = G['scap' + S_], tub = H.Lh * 0.47 * CM;
    const Ad = (H.Lh * 0.47), axis = p => { const d = sub(p, H.Sh), t = clamp(dot(d, H.F.u), 0, Ad * CM), A = mad(H.Sh, H.F.u, t); return { A, n: nrm(sub(p, A)) }; };
    const dT = t => H.at(1.05 * H.kh, Ad * H.kh / H.kh, t);
    const heads = [
      ['deltoidAnterior', [0.64, 0.74, 0.84, 0.94].map(t => mad(along(C.pts, t), C.fw, 0.95 * CM * sT, Y, 0.25 * CM)), [dT(0.6 * H.kh), dT(0.25 * H.kh)], Tm('deltAnt')],
      ['deltoidMiddle', [mad(Sc.acrB, Z, 1.3 * CM, Y, 0.2 * CM), mad(Sc.acrB, [s, 0, 0], 0.2 * CM, Y, 0.3 * CM), mad(Sc.acrB, Z, -1.4 * CM, Y, 0.2 * CM)], [dT(0.25 * H.kh), dT(-0.2 * H.kh)], Tm('deltMid')],
      ['deltoidPosterior', [mad(Sc.spine[3], Y, -0.4 * CM, Z, -0.4 * CM), mad(Sc.spine[2], Y, -0.6 * CM), mad(lerp(Sc.spine[1], Sc.spine[2], 0.4), Y, -0.6 * CM)], [dT(-0.2 * H.kh), dT(-0.55 * H.kh)], Tm('deltPost')]];
    const slerp = (a, b, v) => { const ra = len(a), rb = len(b), da = nrm(a), db = nrm(b), th = Math.acos(clamp(dot(da, db), -1, 1)), sn = Math.sin(th) || 1e-6;
      const d = th < 1e-3 ? da : add(mul(da, Math.sin((1 - v) * th) / sn), mul(db, Math.sin(v * th) / sn)); return mul(nrm(d), ra + (rb - ra) * v); };
    const lat = nrm(sub(P['greaterTub' + S_], H.Sh)), rV = (H.Rh + 1.3 * H.kh) * CM, vF = 0.38;
    const viaDir = [nrm(add(mul(H.F.a, 0.8), mul(lat, 0.6))), lat, nrm(add(mul(H.F.a, -0.8), mul(lat, 0.6)))];
    const wrapOf = vd => (u, v, o, i) => { const a = sub(o, H.Sh), b = sub(i, H.Sh), m = mul(nrm(add(add(nrm(a), nrm(b)), mul(vd, 3))), rV);
      return add(H.Sh, v < vF ? slerp(a, m, v / vF) : slerp(m, b, (v - vF) / (1 - vF))); };
    heads.forEach(([nm, O, I, tD], hi) => push(fanSheet({ name: nm + '.' + S_, group: 'shoulder', O, I, guide: wrapOf(viaDir[hi]), nu: 6, nv: 11, U: under(), dir: axis, gap: (u, v) => 0.004 - 0.002 * v, smooth: 2,
      T: (u, v) => tD * (0.3 + 0.7 * bump(v, -0.2, 0.4, 1.1)) * (0.62 + 0.38 * Math.sin(Math.PI * u)) })));
  }
  // STERNOCLEIDOMASTOID: the sternal head (the manubrium beside the jugular notch) and the clavicular head (the clavicle's medial third) -> the
  // mastoid process and the superior nuchal line's lateral half; two straps (the lesser supraclavicular fossa between them at the bottom), a gentle
  // forward-outward bow
  for (const [S_, s] of [['L', 1], ['R', -1]]) {
    const C = G['clav' + S_], st = G.sternum, tS = Tm('scm'), mt = sk['MastoidTip_' + S_], snl = sk['SNL_lat_' + S_];
    const insS = mad(mt, Z, -0.2 * CM, Y, 0.6 * CM), insC = lerp(mt, snl, 0.45);
    const col = y => [0, y, zLev(y) + 1.5 * CM];
    const path = (a, b, bow) => Array.from({ length: 7 }, (_, i) => { const t = i / 6, p = lerp(a, b, t), c = col(p[1]), n = nrm([p[0] - c[0], 0, p[2] - c[2]]); return mad(p, n, bow * Math.sin(Math.PI * t)); });
    const pS = path(st.at(0.35, s * st.stw(1.0), 0.4), insS, 0.3 * CM), pC = path(mad(along(C.pts, 0.18), Y, 0.5 * CM), insC, 0.25 * CM);
    const upOf = Pp => Pp.map((p, i) => { const d = nrm(sub(Pp[Math.min(Pp.length - 1, i + 1)], Pp[Math.max(0, i - 1)])), c = col(p[1]), n = nrm([p[0] - c[0], 0, p[2] - c[2]]); return nrm(crs(d, n)); });
    push(strap('scmSternal.' + S_, pS, upOf(pS), [1.0, 1.6, 2.0, 2.2, 2.4, 2.6, 2.4].map(w => w * CM * sT), [0.45, 0.8, 1.0, 1.0, 0.9, 0.7, 0.45].map(t => t * tS), { group: 'neck' }));
    push(strap('scmClavicular.' + S_, pC, upOf(pC), [2.4, 2.2, 2.0, 1.8, 1.6, 1.5, 1.4].map(w => w * CM * sT), [0.35, 0.6, 0.7, 0.7, 0.6, 0.5, 0.35].map(t => t * tS), { group: 'neck' }));
  }
  return { parts: out, info };
}
// a polyline's point at arc fraction t
function along(Pp, t) { return resample(Pp, 41)[Math.round(clamp(t, 0, 1) * 40)]; }
// the skull's insertion points by HEAD's names, by rule in HEAD's craniometric frame (mm) when HEAD's skull is not in this bake: the inion 7 mm inside
// the occiput's skin at FH + 12 mm, the superior nuchal line 16 / 34 mm lateral (HEAD's skull.js: back(16, yInion - 1), back(34, yInion - 4)), the
// mastoid tip at 0.385 of the bitragion breadth from the midline, ~29 (m) / 26 (f) mm under the FH, 6 mm behind the porion (a lateral ray met the ear)
export function skullRule(B, fr, sexF, ids0 = null) {
  const P = B.pos, T = B.tri, nb = B.nb, rayMm = (o, d) => { const ob = fr.toBind(o), db = nrm(sub(fr.toBind(add(o, mul(d, 10))), ob)); let best = Infinity;
    for (let i = 0; i < T.length; i += 3) { const a = T[i], b = T[i + 1], c = T[i + 2]; if (a >= nb || b >= nb || c >= nb) continue;
      const A = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]], e1 = sub([P[b * 3], P[b * 3 + 1], P[b * 3 + 2]], A), e2 = sub([P[c * 3], P[c * 3 + 1], P[c * 3 + 2]], A), pv = crs(db, e2), det = dot(e1, pv); if (Math.abs(det) < 1e-12) continue;
      const tv = sub(ob, A), u = dot(tv, pv) / det; if (u < 0 || u > 1) continue; const q = crs(tv, e1), v = dot(db, q) / det; if (v < 0 || u + v > 1) continue; const t = dot(e2, q) / det; if (t > 0 && t < best) best = t; }
    return best * 1000; };
  const ids = ids0 || B.faceIds || {}, bt = ids.t_L != null ? Math.hypot(P[ids.t_L * 3] - P[ids.t_R * 3], P[ids.t_L * 3 + 1] - P[ids.t_R * 3 + 1], P[ids.t_L * 3 + 2] - P[ids.t_R * 3 + 2]) * 1000 : 0;   // bitragion (mm): HEAD's four skulls put the mastoid tips at 0.38-0.39 of it
  const yI = 12, back = (x, y) => { const d = rayMm([x, y, -40], [0, 0, -1]); return d < 200 ? -40 - d + 7 : -88; };
  const zI = back(0, yI), out = { Inion: [0, yI, zI] };
  for (const [S_, s] of [['L', 1], ['R', -1]]) { out['SNL_med_' + S_] = [s * 16, yI - 1, back(16 * s, yI - 1) + 1]; out['SNL_lat_' + S_] = [s * 34, yI - 4, back(34 * s, yI - 4) + 2];
    const yM = sexF ? -26 : -29; out['MastoidTip_' + S_] = [s * (bt > 0.1 ? 0.385 * bt : sexF ? 50 : 55), yM, -6]; }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, fr.toBind(v)]));
}
