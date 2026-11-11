// TAILOR (CLOTHING c2, lane K2): a person -> the tailor's measures a FreeSewing design asks for (mm, FreeSewing's names), and the
// ease a garment is drafted with for a fit. Made-to-measure from lane A's people (lib/fx/body/: p.built, p.measures, p.landmarks;
// read only). The method is GarmentMeasurements' (Kemper, Wenninger, Botsch: landmarks and tape paths on the body mesh), written here
// in JS (their code is GPL-3.0 and needs the FBX SDK; we take none of it).
//
// The naming trap (brief 3.6): NHANES 'waist' is at the iliac crest (lane A `waist`); FreeSewing `waist` is the NATURAL waist (lane A
// `naturalWaist`); FreeSewing `hips` is the high hip (lane A `highHip`); FreeSewing `seat` is NHANES 'hip' (lane A `hip`).
//
// A tape here is what a tailor's tape does: it bridges hollows. Girths are the convex hull of a plane slice (lane A's tapeAt); the
// lengths over the body (HPS to bust, HPS to waist front and back, the cross seam) are arcs of the convex hull of a plane slice
// between two points, on the side the tape lies (front, back, under the crotch).
//
//   import { tailor, easeFor } from '/web/lib/fx/cloth/tailor.js'
//   const T = tailor(p, { support: 'soft' })   // { mm: { chest, highBust, ... }, levels (m), points (m), from: 'lane A ...', ms }
//   const opts = easeFor('shirt', T, { fit: 'regular' })   // FreeSewing options (fractions) for the design
import { measure, triSet, slicePlane } from '../body/measure.js';
const mm = x => Math.round(x * 10000) / 10;     // m -> mm, 0.1 mm
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = a => Math.hypot(a[0], a[1], a[2]), nrm = a => scl(a, 1 / (len(a) || 1)), cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// 2D convex hull (Andrew), points [[x, y, ...rest]] -> hull in counter-clockwise order
function hull(pts) {
  const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (P.length < 3) return P;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
// the tape from a to b (3D points on or near the body) in the plane through a and b that contains direction `dir`, lying on the
// side of the chord where `via` is (a 3D point the tape passes near: the bust, the crotch, the back): hull arc length (m)
export function tapeArc(S, P, tris, a, b, dir, via, { keep = null } = {}) {
  const ab = sub(b, a), n = nrm(cross(ab, dir));
  // the plane frame: slicePlane's basis (u = n x a0, v = n x u, a0 = the y or x axis), points [u, v] around a; keep(world point) filters
  const a0 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], u = nrm(cross(n, a0)), v = cross(n, u), to2 = p => { const q = sub(p, a); return [dot(q, u), dot(q, v)]; };
  const pts = slicePlane(S, P, tris, a, n).filter(q => !keep || keep(add(a, add(scl(u, q[0]), scl(v, q[1])))));
  const A = to2(a), B = to2(b), Vv = to2(via); pts.push([A[0], A[1], 'A'], [B[0], B[1], 'B']);
  // A or B can sit just inside the hull (a slice point a hair beyond them): start from the nearest hull vertex, plus that step
  const H = hull(pts); if (H.length < 3) return len(ab);
  const near = Q => { let bi = 0, bd = Infinity; H.forEach((q, i) => { const d = Math.hypot(q[0] - Q[0], q[1] - Q[1]); if (d < bd) { bd = d; bi = i; } }); return [bi, bd]; };
  const [ia, da] = near(A), [ib, db] = near(B); if (ia === ib) return len(ab);
  // the two arcs; pick the one whose side matches via's
  const arc = d => { let L = 0, i = ia, far = -Infinity; const side = (q) => (B[0] - A[0]) * (q[1] - A[1]) - (B[1] - A[1]) * (q[0] - A[0]); let s = 0;
    while (i !== ib) { const j = (i + d + H.length) % H.length; L += Math.hypot(H[j][0] - H[i][0], H[j][1] - H[i][1]); s += side(H[j]); i = j; } return { L, s }; };
  const f = arc(1), g = arc(-1), sv = (B[0] - A[0]) * (Vv[1] - A[1]) - (B[1] - A[1]) * (Vv[0] - A[0]);
  return (Math.sign(f.s) === Math.sign(sv) ? f.L : g.L) + da + db;
}
// the part of a horizontal girth behind (z < zCut) the body's side line: a tape from side seam to side seam over the back (m)
function backArc(S, P, tris, y) {
  const pts = slicePlane(S, P, tris, [0, y, 0], [0, 1, 0]); if (pts.length < 3) return 0;
  // slicePlane's frame for n = y: a0 = x axis, u = n x a0 = (0,0,-1)... u = -z, v = n x u = -x (lane A's ext() notes (u, v) = (-z, -x))
  const H = hull(pts.map(q => [q[0], q[1]])); let x0 = Infinity, x1 = -Infinity, i0 = 0, i1 = 0; H.forEach((q, i) => { if (q[1] < x0) { x0 = q[1]; i0 = i; } if (q[1] > x1) { x1 = q[1]; i1 = i; } });
  let L1 = 0, z1 = 0; for (let i = i0; i !== i1; i = (i + 1) % H.length) { const j = (i + 1) % H.length; L1 += Math.hypot(H[j][0] - H[i][0], H[j][1] - H[i][1]); z1 += H[j][0]; }
  let L2 = 0, z2 = 0; for (let i = i1; i !== i0; i = (i + 1) % H.length) { const j = (i + 1) % H.length; L2 += Math.hypot(H[j][0] - H[i][0], H[j][1] - H[i][1]); z2 += H[j][0]; }
  return z1 > z2 ? L1 : L2;    // u = -z: the larger u is the back
}
const hullLen = pts => { const H = hull(pts.map(q => [q[0], q[1]])); let L = 0; for (let i = 0; i < H.length; i++) { const j = (i + 1) % H.length; L += Math.hypot(H[j][0] - H[i][0], H[j][1] - H[i][1]); } return L; };
function girth(S, P, tris, p0, n, side = 0) { const pts = slicePlane(S, P, tris, p0, n, side).map(q => [q[0], q[1]]); const H = hull(pts); let L = 0; for (let i = 0; i < H.length; i++) { const j = (i + 1) % H.length; L += Math.hypot(H[j][0] - H[i][0], H[j][1] - H[i][1]); } return L; }

// ---------------------------------------------------------------- the person's tailor measures
// p: a lane A person (castBody / loadCast). support: 'soft' | 'period' | 'sports' (women): measured over that supported bust.
export function tailor(p, { support = null, positions = null } = {}) {
  const t0 = performance.now(), S = p._S, B0 = p.built; if (!S || !B0) throw new Error('tailor: needs a lane A person (p._S, p.built)');
  const Psup = positions || (support && p.sex === 'f' ? p.supported(support) : null), P = Psup || B0.pos, B = Psup ? { ...B0, pos: Psup } : B0;
  const m = measure(S, B, { sex: p.sex, pf: p.targets?.pf ?? 0.3, age: p.age });
  const L = k => { const v = S.landmarks[k]; return [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]; };
  const trunk = triSet(S, [1, 2, 7]), torso = triSet(S, [1, 2]), legs = triSet(S, [2, 7, 8]), thighT = triSet(S, [7, 8]), shinT = triSet(S, [9]), uarm = triSet(S, [3]), farm = triSet(S, [4, 5]), neckT = triSet(S, [0, 1, 2, 11]);
  const bone = name => { const i = S.hero.meta.bones.findIndex(b => b.name === name); return { head: B.heads[i], tail: B.tails[i] }; };
  let floor = Infinity; for (let v = 0; v < S.nb; v++) floor = Math.min(floor, P[v * 3 + 1]);
  // the neck's base: the tape round the neck region just above where it meets the shoulders, tilted like a collar (C7 behind, the
  // notch in front); raised in 5 mm steps until the slice is all neck (a slice through the shoulders reads far too long)
  const c7 = L('cervicale'), ss = L('suprasternale'), nn = nrm(cross(sub(ss, c7), [1, 0, 0])), head = m.headCirc;
  // a horizontal ring round the neck region just above C7 (a full ring there: the throat is neck), and the flare to the base, x 1.08
  let neckBase = 0; for (let dy = 0.012; dy < 0.05 && !(neckBase > 0.25); dy += 0.004) neckBase = 1.08 * girth(S, P, triSet(S, [1]), [0, c7[1] + dy, 0], [0, 1, 0]);
  // held to 0.33-0.41 of the chest (ready-to-wear ratios: a 15.5 in collar on a 40 in chest is 0.39): a heavy neck's ring above C7
  // takes in the soft tissue over the trapezius and read up to 0.48
  const chestM = Math.max(m.bust, m.bustMax || 0); neckBase = Math.min(0.41 * chestM, Math.max(0.33 * chestM, neckBase));
  // HPS: where the shoulder's top line meets the neck: the highest torso point just outside the neck's base radius, each side
  const neckR = neckBase / (2 * Math.PI), hps = s => { let best = null; for (let v = 0; v < S.nb; v++) { const r = S.region[v]; if (r !== 2 && r !== 1) continue; const x = P[v * 3] * s;
      if (x < neckR * 0.95 || x > neckR * 1.25) continue; if (P[v * 3 + 1] > L('cervicale')[1] + 0.01) continue; if (!best || P[v * 3 + 1] > best[1]) best = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]; } return best; };
  const hpsL = hps(1), hpsR = hps(-1), acrL = L('acromionL'), acrR = L('acromionR'), nipL = L('nippleL'), nipR = L('nippleR');
  const yNW = m.levels.naturalWaist, yHH = m.levels.highHip, yHip = m.levels.hip, yAx = (L('axillaFrontL')[1] + L('axillaBackL')[1] + L('axillaFrontR')[1] + L('axillaBackR')[1]) / 4;
  // the natural waist's front and back points on the midline, and at the bust's x
  const zAt = (y, x, front) => { let z = front ? -Infinity : Infinity; for (let v = 0; v < S.nb; v++) { const r = S.region[v]; if (r !== 2 && r !== 7) continue; if (Math.abs(P[v * 3 + 1] - y) > 0.012 || Math.abs(P[v * 3] - x) > 0.015) continue; z = front ? Math.max(z, P[v * 3 + 2]) : Math.min(z, P[v * 3 + 2]); } return z; };
  const wF = [0, yNW, zAt(yNW, 0, true)], wB = [0, yNW, zAt(yNW, 0, false)];
  const crotch = [0, m.crotchSkin ?? m.crotch, 0], band = (y0, y1) => q => q[1] >= y0 && q[1] <= y1;
  const xAx = Math.max(...['axillaFrontL', 'axillaBackL', 'axillaFrontR', 'axillaBackR'].map(k => Math.abs(L(k)[0])));
  // the high bust as FreeSewing takes it: round the back at the armpits, ACROSS THE CHEST ABOVE THE BREASTS (the tape rises in front):
  // a plane through the back axilla folds and a front point over the breast's upper pole (7 cm over the apex, at least 2 cm over the
  // front axilla fold); a level tape at the armpits would pass through a lifted bust's upper pole and read the bust again
  const aB = scl(add(L('axillaBackL'), L('axillaBackR')), 0.5), yF = Math.max((L('axillaFrontL')[1] + L('axillaFrontR')[1]) / 2 + 0.02, (nipL[1] + nipR[1]) / 2 + 0.07);
  const fP = [0, yF, 0.2], nHB = nrm(cross(sub(L('axillaBackL'), L('axillaBackR')), sub(fP, aB))).map((c, i, a) => a[1] < 0 ? -c : c);
  const highBust = hullLen(slicePlane(S, P, torso, [0, aB[1] - 0.01, aB[2]], nHB).filter(q => Math.abs(q[2]) <= xAx));
  const hpsToBust = (tapeArc(S, P, torso, hpsL, nipL, [0, 0, 1], add(scl(add(hpsL, nipL), 0.5), [0, 0, 0.3]), { keep: band(nipL[1] - 0.02, hpsL[1] + 0.01) }) + tapeArc(S, P, torso, hpsR, nipR, [0, 0, 1], add(scl(add(hpsR, nipR), 0.5), [0, 0, 0.3]), { keep: band(nipR[1] - 0.02, hpsR[1] + 0.01) })) / 2;
  // HPS to the waist in front: over the bust point for women (HPS -> apex, apex straight down to the waist), straight down for men
  const front = (h, nip) => { if (p.sex === 'f') { const wx = [nip[0], yNW, zAt(yNW, nip[0], true)];
      return tapeArc(S, P, torso, h, nip, [0, 0, 1], add(scl(add(h, nip), 0.5), [0, 0, 0.3]), { keep: band(nip[1] - 0.02, h[1] + 0.01) }) + tapeArc(S, P, trunk, nip, wx, [0, 0, 1], [nip[0], (nip[1] + yNW) / 2, 0.5], { keep: band(yNW - 0.01, nip[1] + 0.02) }); }
    const wx = [h[0], yNW, zAt(yNW, h[0], true)]; return tapeArc(S, P, trunk, h, wx, [0, 0, 1], [h[0], (h[1] + yNW) / 2, 0.5], { keep: band(yNW - 0.01, h[1] + 0.01) }); };
  const back = (h) => { const wx = [h[0], yNW, zAt(yNW, h[0], false)]; return tapeArc(S, P, trunk, h, wx, [0, 0, 1], [h[0], (h[1] + yNW) / 2, -0.5], { keep: band(yNW - 0.01, h[1] + 0.01) }); };
  const crossSeam = tapeArc(S, P, legs, wF, wB, [0, 1, 0], [0, crotch[1] - 0.2, 0], { keep: band(-1, yNW + 0.005) });
  // a bump or a wide section can send the hull round the wrong way: outside 0.55-0.95 x seat, take FreeSewing-like proportions
  const csOk = crossSeam > 0.55 * m.hip && crossSeam < 0.95 * m.hip;
  const crossSeamFront = tapeArc(S, P, legs, wF, [0, crotch[1], (wF[2] + wB[2]) / 2], [0, 1, 0], [0, crotch[1], 0.4], { keep: band(-1, yNW + 0.005) });
  // shoulders: over the back between the acromions, the slope from HPS
  const sh2sh = tapeArc(S, P, triSet(S, [1, 2, 3]), acrL, acrR, [0, 0, 1], [0, (acrL[1] + acrR[1]) / 2 + 0.3, -0.2]);
  const slope = (Math.atan2(hpsL[1] - acrL[1], acrL[0] - hpsL[0]) + Math.atan2(hpsR[1] - acrR[1], hpsR[0] - acrR[0])) / 2 * 180 / Math.PI;
  // arm: biceps (the greatest upper-arm tape perpendicular to the bone), shoulder to wrist (acromion -> olecranon -> ulnar head), wrist
  const ua = bone('upperarm01.L'), fa = bone('lowerarm01.L'), wr = bone('wrist.L'), ax = nrm(sub(fa.head, ua.head)), fx = nrm(sub(wr.head, fa.head));
  let biceps = 0; for (let f = 0.25; f <= 0.7; f += 0.05) biceps = Math.max(biceps, girth(S, P, uarm, add(ua.head, scl(sub(fa.head, ua.head), f)), ax, 1));
  // shoulder to wrist as a tailor takes it, down the outside of the arm: acromion -> lateral epicondyle -> ulnar head (FreeSewing: arm a little bent)
  const wrist = girth(S, P, farm, L('ulnarHeadL'), fx, 1); const sh2wr = len(sub(L('latEpicondyleL'), acrL)) + len(sub(L('ulnarHeadL'), L('latEpicondyleL')));
  // legs
  const kn = bone('lowerleg01.L'), hip = bone('upperleg01.L'), an = bone('foot.L'), lx = nrm(sub(kn.head, hip.head)), sx = nrm(sub(an.head, kn.head));
  const knee = girth(S, P, triSet(S, [8, 9]), kn.head, sx, 1), upperLeg = girth(S, P, thighT, [hip.head[0], crotch[1] - 0.025, kn.head[2]], [0, 1, 0], 1);
  let ankle = Infinity; for (let f = 0.7; f <= 0.9; f += 0.04) ankle = Math.min(ankle, girth(S, P, shinT, add(kn.head, scl(sub(an.head, kn.head), f)), sx, 1));

  const T = {
    chest: mm(Math.max(m.bust, m.bustMax || 0)), highBust: mm(highBust), underbust: mm(m.underbust), bustSpan: mm(Math.abs(nipL[0] - nipR[0])), hpsToBust: mm(hpsToBust),
    hpsToWaistFront: mm((front(hpsL, nipL) + front(hpsR, nipR)) / 2), hpsToWaistBack: mm((back(hpsL) + back(hpsR)) / 2), neck: mm(neckBase), shoulderToShoulder: mm(sh2sh), shoulderSlope: Math.round(slope * 10) / 10,
    waistToArmpit: mm(yAx - yNW), waistToHips: mm(yNW - yHH), waist: mm(m.naturalWaist), hips: mm(m.highHip), seat: mm(m.hip), waistBack: mm(backArc(S, P, legs, yNW)), seatBack: mm(backArc(S, P, legs, yHip)),
    biceps: mm(biceps), shoulderToWrist: mm(sh2wr), wrist: mm(wrist), shoulderToElbow: mm(len(sub(L('olecranonL'), acrL))),
    crossSeam: mm(csOk ? crossSeam : 0.72 * m.hip), crossSeamFront: mm(csOk && crossSeamFront < 0.6 * crossSeam ? crossSeamFront : 0.47 * (csOk ? crossSeam : 0.72 * m.hip)), waistToFloor: mm(yNW - floor), waistToKnee: mm(yNW - kn.head[1]), waistToSeat: mm(yNW - yHip), waistToUpperLeg: mm(yNW - (crotch[1] - 0.0)),
    upperLeg: mm(upperLeg), knee: mm(knee), ankle: mm(ankle), inseam: mm(crotch[1] - floor), head: mm(head),
  };
  if (p.sex !== 'f') { T.highBust = T.chest; }    // men: FreeSewing reads highBust only for designs drafted for it
  return { mm: T, sex: p.sex, age: p.age, name: p.name, support: Psup ? support : null, levels: { naturalWaist: yNW, highHip: yHH, hip: yHip, axilla: yAx, crotch: crotch[1], floor, bust: m.levels.bust },
    points: { hpsL, hpsR, acrL, acrR, nipL, nipR, waistFront: wF, waistBack: wB }, lane: { naturalWaist: m.naturalWaist, waist: m.waist, hip: m.hip, highHip: m.highHip, bust: m.bust, underbust: m.underbust }, pregnant: !!p.pregnant, kin: p.kin ? { kyphosis: p.kin.gait?.posture?.kyphosis ?? 0 } : null,
    ms: Math.round(performance.now() - t0) };
}

// ---------------------------------------------------------------- ease by garment and fit (FreeSewing option values, fractions)
// fit: 'slim' | 'regular' | 'relaxed' | 'work'. Women's tops are drafted from the high bust (Simone): chest ease goes on the high bust
// and the full-bust adjustment adds the difference. A belly (waist over chest) or a pregnancy gets waist and hip room, and the shirt
// longer; an older rounded back (kyphosis) gets FreeSewing's roundBack. Our numbers, from FreeSewing's defaults and ready-to-wear
// practice (a work shirt ~ 15-20 % at the chest); not a standard.
const FIT = { slim: { chest: 0.08, waist: 0.06, hips: 0.06, biceps: 0.12 }, regular: { chest: 0.12, waist: 0.12, hips: 0.12, biceps: 0.15 },
  relaxed: { chest: 0.18, waist: 0.18, hips: 0.16, biceps: 0.20 }, work: { chest: 0.16, waist: 0.16, hips: 0.14, biceps: 0.20 } };
export function easeFor(garment, T, { fit = 'work' } = {}) {
  const F = FIT[fit] || FIT.work, M = T.mm, o = {};
  if (garment === 'shirt') {
    Object.assign(o, { chestEase: F.chest, waistEase: F.waist, hipsEase: F.hips, bicepsEase: F.biceps, cuffEase: 0.2, collarEase: 0.05, lengthBonus: 0.25 });
    const belly = M.waist / M.chest;   // a belly: FreeSewing's waistEase is on the waist measure; keep at least the chest's ease there
    if (belly > 0.95) { o.waistEase = Math.max(o.waistEase, F.chest + 0.04); o.hipsEase = Math.max(o.hipsEase, F.hips + 0.04); o.lengthBonus += 0.05; }
    if (T.pregnant) { o.waistEase += 0.08; o.hipsEase += 0.06; o.lengthBonus += 0.08; }
    if ((T.kin?.kyphosis ?? 0) > 0.15) o.roundBack = Math.min(0.1, 0.03 + 0.1 * T.kin.kyphosis);
  } else if (garment === 'trousers') {
    Object.assign(o, { waistEase: fit === 'slim' ? 0.01 : 0.02, seatEase: fit === 'slim' ? 0.03 : fit === 'relaxed' ? 0.1 : 0.06, kneeEase: fit === 'slim' ? 0.06 : 0.15 });
  }
  return o;
}
