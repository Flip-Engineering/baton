// BODY / KIN (HUMAN c8 lane A): a person's own kinematic model, taken from the person's own mesh (bind pose, metres, kg).
//   joint centres   MakeHuman's joint vertex groups on this person's frame (mix.js takes them BEFORE soft tissue: fat never moves a joint)
//   segments        the closed body mesh voxelised (1 cm), each voxel labelled by the nearest skin region (a flood from the surface
//                   inward), the axial part cut the way Zatsiorsky's gamma-scanner segments are bounded (head at the C7-suprasternale
//                   plane; trunk thirds at the xiphoid and the omphalion; thigh from the trunk at the plane through the hip joint centre
//                   and the gluteal fold); Dempster's segment densities (thorax 0.92 for the lungs), then scaled so the masses sum to
//                   the person's measured mass. Per segment: mass, COM, the inertia tensor about the COM and its three radii of gyration
//                   (sagittal, transverse, longitudinal) as fractions of the segment length, with de Leva 1996 (sex-specific) beside it
//                   as the check (the same endpoints).
//   carrying angle  drawn per person from Van Roy et al. 2005 (women 16.7 +/- 2.6, men 11.6 +/- 3.2 deg); falls to ~2 deg varus at
//                   full flexion (lane F interpolates).
//   ranges          CDC Normal Joint ROM (Soucie 2011) by sex x age band, one seeded draw per person (age > 69: the bands' trend
//                   extended, capped), elbow and knee HYPEREXTENSION included, then the person's own soft-tissue limits from the mesh:
//                   knee flexion (thigh meets calf), elbow flexion (biceps meets forearm), hip flexion (thigh meets abdomen, a bump):
//                   2 d sin(phi / 2) = kappa (r1(d) + r2(d)), r the tissue depth on the flexion side at d from the joint, kappa the
//                   compressed fraction (0.5: OUR assumption). Also in rig/limits.js's own LIMITS format (limits).
//   stance          heel separation from hip breadth (McIlroy and Maki 1997: 0.17 m at the mean), foot angle (14 deg mean).
//   gait            hip height as leg length, comfortable speed by sex and decade (Bohannon 1997), step and cadence from the walk ratio, step width
//                   from hip-joint spacing, pelvic obliquity range and vertical COM excursion by sex (Smith et al. 2002), peak hip
//                   adduction scaled by bitrochanteric breadth over leg length (Chumanov et al. 2008: no numbers, our 2-4 deg),
//                   pregnancy (wider, slower; lumbar extension up to 28 deg at term, Whitcome et al. 2007).
// kinematics(S, built, measures, targets, { seed }) -> kin (schema: KIN_SCHEMA below and the lane notes).
import { mulberry32, gauss } from './sampler.js';
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = a => Math.hypot(a[0], a[1], a[2]), unit = a => mul(a, 1 / (len(a) || 1));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mid = (a, b) => mul(add(a, b), 0.5), r4 = x => Math.round(x * 1e4) / 1e4, r3 = v => v.map(r4), r1 = x => Math.round(x * 10) / 10;
export const KIN_VERSION = 1;
export const KIN_SCHEMA = 'see videos/review/studio_human_c8/after/body/NOTES.md, "p.kin"';
// Dempster 1955 segment densities (kg/L, as tabulated by Winter 2009, table 4.1)
const DENS = { head: 1.11, upperTrunk: 0.92, midTrunk: 1.01, lowerTrunk: 1.01, upperArm: 1.07, forearm: 1.13, hand: 1.16, thigh: 1.05, shank: 1.09, foot: 1.10 };
const SEG_NAMES = ['head', 'upperTrunk', 'midTrunk', 'lowerTrunk', 'upperArm_L', 'forearm_L', 'hand_L', 'thigh_L', 'shank_L', 'foot_L', 'upperArm_R', 'forearm_R', 'hand_R', 'thigh_R', 'shank_R', 'foot_R'];
const SEG_ID = Object.fromEntries(SEG_NAMES.map((n, i) => [n, i + 1]));
const R = { head: 0, neck: 1, torso: 2, uarm: 3, farm: 4, hand: 5, finger: 6, pelvis: 7, thigh: 8, shin: 9, foot: 10, jaw: 11 };
const LIMB = { [R.uarm]: 'upperArm', [R.farm]: 'forearm', [R.hand]: 'hand', [R.finger]: 'hand', [R.shin]: 'shank', [R.foot]: 'foot' };
// hero bones of the joint centres (heads), and the landmark endpoints of de Leva's segments
export const JOINT_BONES = { HJC_L: 'upperleg01.L', KJC_L: 'lowerleg01.L', AJC_L: 'foot.L', SJC_L: 'upperarm01.L', EJC_L: 'lowerarm01.L', WJC_L: 'wrist.L',
  HJC_R: 'upperleg01.R', KJC_R: 'lowerleg01.R', AJC_R: 'foot.R', SJC_R: 'upperarm01.R', EJC_R: 'lowerarm01.R', WJC_R: 'wrist.R', C7T1: 'neck01', AO: 'head', L5S1: 'spine05', T12L1: 'spine03' };

// ---------------------------------------------------------------- voxels: column ray casts with winding numbers
export function voxelize(S, P, h = 0.01) {
  const t = S.tri, nb = S.nb; let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let v = 0; v < nb; v++) { const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  x0 -= h; z0 -= h; y0 -= h; const nx = Math.ceil((x1 - x0) / h) + 2, ny = Math.ceil((y1 - y0) / h) + 2, nz = Math.ceil((z1 - z0) / h) + 2;
  // orientation of the mesh (outward normals give a positive signed volume)
  let sv = 0; for (let i = 0; i < t.length; i += 3) { const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3; sv += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]); }
  const orient = sv >= 0 ? 1 : -1;
  const bins = new Array(nx * nz); for (let i = 0; i < bins.length; i++) bins[i] = [];
  for (let i = 0; i < t.length; i += 3) { const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
    const i0 = Math.floor((Math.min(P[a], P[b], P[c]) - x0) / h), i1 = Math.floor((Math.max(P[a], P[b], P[c]) - x0) / h), k0 = Math.floor((Math.min(P[a + 2], P[b + 2], P[c + 2]) - z0) / h), k1 = Math.floor((Math.max(P[a + 2], P[b + 2], P[c + 2]) - z0) / h);
    for (let ii = i0; ii <= i1; ii++) for (let kk = k0; kk <= k1; kk++) bins[ii * nz + kk].push(i); }
  const inside = new Uint8Array(nx * ny * nz), hits = [];
  for (let ii = 0; ii < nx; ii++) for (let kk = 0; kk < nz; kk++) { const L = bins[ii * nz + kk]; if (!L.length) continue;
    const px = x0 + (ii + 0.5) * h + 1.37e-6, pz = z0 + (kk + 0.5) * h + 2.91e-6; hits.length = 0;
    for (const i of L) { const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
      const ax = P[a], az = P[a + 2], bx = P[b], bz = P[b + 2], cx = P[c], cz = P[c + 2], d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(d) < 1e-14) continue;
      const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d, l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d, l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      const ny_ = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);   // y of (b - a) x (c - a)
      hits.push([l1 * P[a + 1] + l2 * P[b + 1] + l3 * P[c + 1], ny_ * orient < 0 ? 1 : -1]); }
    if (hits.length < 2) continue; hits.sort((p, q) => p[0] - q[0]);
    let w = 0; for (let j = 0; j < hits.length - 1; j++) { w = Math.max(0, w + hits[j][1]); if (w <= 0) continue;
      const ja = Math.ceil((hits[j][0] - y0) / h - 0.5), jb = Math.floor((hits[j + 1][0] - y0) / h - 0.5);
      for (let jj = Math.max(0, ja); jj <= Math.min(ny - 1, jb); jj++) inside[(ii * ny + jj) * nz + kk] = 1; } }
  return { h, x0, y0, z0, nx, ny, nz, inside, at: (ii, jj, kk) => [x0 + (ii + 0.5) * h, y0 + (jj + 0.5) * h, z0 + (kk + 0.5) * h] };
}

// ---------------------------------------------------------------- segments
function segmentVoxels(S, P, G, ep) {
  const { h, x0, y0, z0, nx, ny, nz, inside } = G, lab = new Int8Array(nx * ny * nz), q = [];
  const idx = (ii, jj, kk) => (ii * ny + jj) * nz + kk;
  // seeds: every body vertex labels its voxel: limbs by region and side; everything else is axial (-1) and is cut by planes below
  for (let v = 0; v < S.nb; v++) { const ii = Math.floor((P[v * 3] - x0) / h), jj = Math.floor((P[v * 3 + 1] - y0) / h), kk = Math.floor((P[v * 3 + 2] - z0) / h);
    const reg = S.region[v], limb = LIMB[reg], side = P[v * 3] >= 0 ? 'L' : 'R', l = limb ? SEG_ID[limb + '_' + side] : -1;
    for (const [a, b, c] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) { const I = ii + a, J = jj + b, K = kk + c; if (I < 0 || J < 0 || K < 0 || I >= nx || J >= ny || K >= nz) continue;
      const c0 = idx(I, J, K); if (!inside[c0]) continue; if (!lab[c0]) { lab[c0] = l; q.push(c0); } break; } }
  for (let qi = 0; qi < q.length; qi++) { const c0 = q[qi], l = lab[c0], kk = c0 % nz, jj = ((c0 - kk) / nz) % ny, ii = (c0 - kk - jj * nz) / (ny * nz);
    for (const [a, b, c] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) { const I = ii + a, J = jj + b, K = kk + c; if (I < 0 || J < 0 || K < 0 || I >= nx || J >= ny || K >= nz) continue;
      const c1 = idx(I, J, K); if (inside[c1] && !lab[c1]) { lab[c1] = l; q.push(c1); } } }
  // the cuts (Zatsiorsky's gamma-scanner boundaries, as near as landmarks allow): the arm leaves the trunk at the plane through the
  // acromion and the axillary folds; elbow and knee at the plane through the joint centre bisecting the two segment axes; hand and foot
  // distal to the plane through the wrist / ankle centre square to the forearm / shank; the thigh leaves the trunk at the plane through
  // the hip joint centre and the gluteal fold (lateral axis in it); the head at the plane through C7 and the suprasternal notch.
  const lat = [1, 0, 0], headN = unit(cross(lat, sub(ep.SUPR, ep.CERV))), headS = Math.sign(dot(sub(ep.VERT, ep.CERV), headN));
  const C = {}; for (const s of ['L', 'R']) { const g = k => ep[k + '_' + s];
    const aU = unit(sub(g('EJC'), g('SJC'))), aF = unit(sub(g('WJC'), g('EJC'))), aT = unit(sub(g('KJC'), g('HJC'))), aS = unit(sub(g('AJC'), g('KJC')));
    let nSh = unit(cross(sub(g('AXF'), g('ACR')), sub(g('AXB'), g('ACR')))); if (dot(sub(g('EJC'), g('ACR')), nSh) < 0) nSh = mul(nSh, -1);
    let nTh = unit(cross(lat, sub(g('GLUTF'), g('HJC')))); if (dot(sub(g('KJC'), g('HJC')), nTh) < 0) nTh = mul(nTh, -1);
    C[s] = { aF, aS, nSh, nTh, nE: unit(add(aU, aF)), nK: unit(add(aT, aS)), ACR: g('ACR'), SJC: g('SJC'), EJC: g('EJC'), WJC: g('WJC'), HJC: g('HJC'), KJC: g('KJC'), AJC: g('AJC') }; }
  const yX = ep.XYPH[1], yO = ep.OMPH[1], ARM = new Set(['upperArm', 'forearm', 'hand']), LEG = new Set(['shank', 'foot']);
  const acc = SEG_NAMES.map(() => ({ n: 0, s: [0, 0, 0], m2: [0, 0, 0, 0, 0, 0] }));
  for (let ii = 0; ii < nx; ii++) for (let jj = 0; jj < ny; jj++) for (let kk = 0; kk < nz; kk++) { const c0 = idx(ii, jj, kk); if (!inside[c0]) continue;
    const p = [x0 + (ii + 0.5) * h, y0 + (jj + 0.5) * h, z0 + (kk + 0.5) * h], s = p[0] >= 0 ? 'L' : 'R', Q = C[s], k0 = lab[c0] > 0 ? SEG_NAMES[lab[c0] - 1].replace(/_[LR]$/, '') : null;
    let chain = k0 && ARM.has(k0) ? 'arm' : k0 && LEG.has(k0) ? 'leg' : 'axial';
    const distalSh = dot(sub(p, Q.ACR), Q.nSh) > 0;
    if (chain === 'arm' && !distalSh) chain = 'axial';
    if (chain === 'axial' && distalSh && Math.abs(p[0]) > Math.abs(Q.SJC[0]) && p[1] > yX) chain = 'arm';
    if (chain === 'axial' && dot(sub(p, Q.HJC), Q.nTh) > 0 && p[1] < Q.HJC[1] + 0.06) chain = 'leg';
    let l;
    if (chain === 'arm') l = SEG_ID[(dot(sub(p, Q.WJC), Q.aF) > 0 ? 'hand' : dot(sub(p, Q.EJC), Q.nE) > 0 ? 'forearm' : 'upperArm') + '_' + s];
    else if (chain === 'leg') l = SEG_ID[(dot(sub(p, Q.AJC), Q.aS) > 0 ? 'foot' : dot(sub(p, Q.KJC), Q.nK) > 0 ? 'shank' : 'thigh') + '_' + s];
    else if (dot(sub(p, ep.CERV), headN) * headS > 0) l = SEG_ID.head;
    else l = p[1] > yX ? SEG_ID.upperTrunk : p[1] > yO ? SEG_ID.midTrunk : SEG_ID.lowerTrunk;
    lab[c0] = l;
    const A = acc[l - 1]; A.n++; A.s[0] += p[0]; A.s[1] += p[1]; A.s[2] += p[2];
    A.m2[0] += p[0] * p[0]; A.m2[1] += p[1] * p[1]; A.m2[2] += p[2] * p[2]; A.m2[3] += p[0] * p[1]; A.m2[4] += p[0] * p[2]; A.m2[5] += p[1] * p[2]; }
  return { acc, lab };
}

// tissue depth on a side of a segment: the furthest skin point along `dir` (unit, perpendicular to the axis) in the slice through c
function depth(S, P, tris, c, axis, dir, side) {
  const t = S.tri, d = i => (P[i * 3] - c[0]) * axis[0] + (P[i * 3 + 1] - c[1]) * axis[1] + (P[i * 3 + 2] - c[2]) * axis[2]; let best = 0;
  for (const k of tris) { const ia = t[k], ib = t[k + 1], ic = t[k + 2], da = d(ia), db = d(ib), dc = d(ic);
    if ((da > 0 && db > 0 && dc > 0) || (da < 0 && db < 0 && dc < 0)) continue;
    for (const [i, j, di, dj] of [[ia, ib, da, db], [ib, ic, db, dc], [ic, ia, dc, da]]) { if (di * dj >= 0) continue; const s = di / (di - dj);
      const x = P[i * 3] + (P[j * 3] - P[i * 3]) * s, y = P[i * 3 + 1] + (P[j * 3 + 1] - P[i * 3 + 1]) * s, z = P[i * 3 + 2] + (P[j * 3 + 2] - P[i * 3 + 2]) * s;
      if (side && Math.sign(x) !== side) continue; const q = [x - c[0], y - c[1], z - c[2]];
      if (len(sub(q, mul(axis, dot(q, axis)))) > 0.25) continue; best = Math.max(best, dot(q, dir)); } }
  return best;
}
function triRegions(S, regs) { const key = 'ktri:' + regs.join(','); S._tris ||= {}; if (S._tris[key]) return S._tris[key];
  const t = S.tri, Rg = S.region, ok = new Set(regs), out = []; for (let i = 0; i < t.length; i += 3) if (ok.has(Rg[t[i]]) || ok.has(Rg[t[i + 1]]) || ok.has(Rg[t[i + 2]])) out.push(i); return (S._tris[key] = Int32Array.from(out)); }
// the soft-tissue flexion limit of a hinge: segments 1 and 2 leave joint J along a1 and a2; their flexion sides face f1 and f2
const KAPPA = 0.5;
function softLimit(S, P, J, a1, f1, t1, a2, f2, t2, side, ds = [0.06, 0.09, 0.12, 0.15, 0.19, 0.24]) {
  let phi = 0, at = null;
  for (const d of ds) { const ra = depth(S, P, t1, add(J, mul(a1, d)), a1, f1, side), rb = depth(S, P, t2, add(J, mul(a2, d)), a2, f2, side);
    if (!ra || !rb) continue; const ph = 2 * Math.asin(clamp(KAPPA * (ra + rb) / (2 * d), 0, 1)) * 180 / Math.PI; if (ph > phi) { phi = ph; at = { d, r1: r4(ra), r2: r4(rb) }; } }
  return { maxFlex: r1(180 - phi), at };
}
const perp = (v, a) => unit(sub(v, mul(a, dot(v, a))));

// ---------------------------------------------------------------- the model
export function kinematics(S, B, m, t, { seed = 1, h = 0.01 } = {}) {
  const P = B.pos, sex = t.sex === 'm' ? 'm' : 'f', age = t.age ?? 40, pop = S.pop, lit = pop.lit, rnd = mulberry32((seed | 0) * 104729 + 7), g = () => gauss(rnd);
  const bi = Object.fromEntries(S.hero.meta.bones.map((b, i) => [b.name, i])), jh = name => B.heads[bi[name]];
  const lm = k => { const v = S.landmarks[k]; return [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]; };
  const joints = Object.fromEntries(Object.entries(JOINT_BONES).map(([k, b]) => [k, r3(jh(b))]));
  joints.MIDH = r3(mid(joints.HJC_L, joints.HJC_R)); joints.SJCmid = r3(mid(joints.SJC_L, joints.SJC_R));
  const ep = { ...joints, VERT: lm('vertex'), CERV: lm('cervicale'), SUPR: lm('suprasternale'), XYPH: lm('xiphoid'), OMPH: lm('omphalion'),
    MET3_L: lm('met3L'), MET3_R: lm('met3R'), HEEL_L: lm('heelL'), HEEL_R: lm('heelR'), TTIP_L: lm('toeTipL'), TTIP_R: lm('toeTipR'), GLUTF_L: lm('gluteFoldL'), GLUTF_R: lm('gluteFoldR'),
    ACR_L: lm('acromionL'), ACR_R: lm('acromionR'), AXF_L: lm('axillaFrontL'), AXF_R: lm('axillaFrontR'), AXB_L: lm('axillaBackL'), AXB_R: lm('axillaBackR') };
  // ---- segments from the voxels
  const G = voxelize(S, P, h), { acc } = segmentVoxels(S, P, G, ep), cell = h * h * h * 1000;   // litres per voxel
  const kindOf = n => n.replace(/_[LR]$/, ''), END = { head: ['VERT', 'CERV'], upperTrunk: ['SUPR', 'XYPH'], midTrunk: ['XYPH', 'OMPH'], lowerTrunk: ['OMPH', 'MIDH'],
    upperArm: ['SJC', 'EJC'], forearm: ['EJC', 'WJC'], hand: ['WJC', 'MET3'], thigh: ['HJC', 'KJC'], shank: ['KJC', 'AJC'], foot: ['HEEL', 'TTIP'] };
  const DL = lit.deleva1996[sex], DLrow = { head: 'head2', upperTrunk: 'upperTrunk', midTrunk: 'midTrunk', lowerTrunk: 'lowerTrunk', upperArm: 'upperArm', forearm: 'forearm', hand: 'hand', thigh: 'thigh', shank: 'shank', foot: 'foot' };
  let raw = 0, volL = 0; const segs = {};
  SEG_NAMES.forEach((n, i) => { const A = acc[i]; volL += A.n * cell; raw += A.n * cell * DENS[kindOf(n)]; });
  const M = m.mass, ks = M / raw;
  let comAll = [0, 0, 0];
  SEG_NAMES.forEach((n, i) => { const A = acc[i], k = kindOf(n), sd = n.endsWith('_L') ? '_L' : n.endsWith('_R') ? '_R' : '', mass = A.n * cell * DENS[k] * ks, mv = mass / Math.max(1, A.n);
    const c = A.n ? mul(A.s, 1 / A.n) : [0, 0, 0];
    // central second moments -> inertia tensor about the COM (kg m^2), voxel self-inertia added (m h^2 / 6 per axis)
    const C = A.n ? [A.m2[0] / A.n - c[0] * c[0], A.m2[1] / A.n - c[1] * c[1], A.m2[2] / A.n - c[2] * c[2], A.m2[3] / A.n - c[0] * c[1], A.m2[4] / A.n - c[0] * c[2], A.m2[5] / A.n - c[1] * c[2]].map(x => x * A.n * mv) : [0, 0, 0, 0, 0, 0];
    const self = mass * h * h / 6, tr = C[0] + C[1] + C[2];
    const I = [[tr - C[0] + self, -C[3], -C[4]], [-C[3], tr - C[1] + self, -C[5]], [-C[4], -C[5], tr - C[2] + self]];
    const [pa, pb] = END[k], prox = ep[pa + (ep[pa + sd] ? sd : '')] || ep[pa], dist = ep[pb + (ep[pb + sd] ? sd : '')] || ep[pb], ax = sub(dist, prox), L = len(ax), a = unit(ax);
    const ml = perp([1, 0, 0], a), ap = cross(a, ml), Iq = e => dot(e, [dot(I[0], e), dot(I[1], e), dot(I[2], e)]);
    const rg = [Iq(ml), Iq(ap), Iq(a)].map(x => Math.sqrt(Math.max(0, x) / Math.max(mass, 1e-9)) / L);
    const row = DL[DLrow[k]], dl = { massFrac: row[2], comFrac: row[3], rg: [row[4], row[5], row[6]] };
    segs[n] = { mass: r4(mass), massFrac: r4(mass / M), volumeL: r4(A.n * cell), density: DENS[k], com: r3(c), comFrac: r4(dot(sub(c, prox), a) / L), comOffAxis: r4(len(sub(sub(c, prox), mul(a, dot(sub(c, prox), a))))),
      prox: pa + (ep[pa + sd] ? sd : ''), dist: pb + (ep[pb + sd] ? sd : ''), length: r4(L), inertia: I.map(r => r.map(x => +x.toExponential(4))), rg: rg.map(r4),
      deLeva: { ...dl, mass: r4(dl.massFrac * M), com: r3(add(prox, mul(ax, dl.comFrac))) } };
    comAll = add(comAll, mul(c, mass)); });
  comAll = mul(comAll, 1 / M);
  // de Leva's whole-body COM on the same endpoints, for the check
  let cd = [0, 0, 0], md = 0; for (const s of Object.values(segs)) { cd = add(cd, mul(s.deLeva.com, s.deLeva.mass)); md += s.deLeva.mass; } cd = mul(cd, 1 / md);
  // ---- carrying angle (one draw per person, extension and supination)
  const CA = lit.carrying_angle[sex], carrying = { deg: r1(clamp(CA[0] + CA[1] * g(), 0, 30)), mean: CA[0], sd: CA[1], atFullFlexion: -2, src: 'Van Roy et al. 2005' };
  // ---- ranges: CDC means by band, one draw, extended past 69 along the bands' own trend (capped at 1.5x that change)
  const RC = lit.rom_cdc[sex], rom = {};
  for (const [k, [[m1, h1], [m2, h2]]] of Object.entries(RC)) {
    const slope = (m2 - m1) / 25, mean = age <= 32 ? m1 : age <= 57 ? m1 + slope * (age - 32) : m2 + clamp(slope * (age - 57), -Math.abs(m2 - m1) * 1.5, Math.abs(m2 - m1) * 1.5);
    const sd = Math.max(3, (age < 45 ? h1 : h2) * Math.sqrt(80) / 1.96) * (k.endsWith('Ext') && (k.startsWith('knee') || k.startsWith('elbow')) ? 0.6 : 1);
    rom[k] = { deg: r1(Math.max(k.endsWith('Ext') ? -6 : 0, mean + sd * g())), mean: r1(mean), sd: r1(sd), limitedBy: 'joint' }; }
  // soft tissue: the person's own mesh (bind pose: legs straight; the bind forearm is flexed ~45 deg, so the elbow uses its own frame)
  const legT = triRegions(S, [R.thigh]), shinT = triRegions(S, [R.shin]), uaT = triRegions(S, [R.uarm]), faT = triRegions(S, [R.farm]), trunkT = triRegions(S, [R.torso, R.pelvis]);
  const soft = {};
  { const kn = ep.KJC_L, aT = unit(sub(ep.HJC_L, kn)), aS = unit(sub(ep.AJC_L, kn)), back = [0, 0, -1];
    soft.kneeFlex = softLimit(S, P, kn, aT, perp(back, aT), legT, aS, perp(back, aS), shinT, 1, [0.12, 0.15, 0.18, 0.22]); }
  { const el = ep.EJC_L, aU = unit(sub(ep.SJC_L, el)), aF = unit(sub(ep.WJC_L, el)), fU = perp(aF, aU), fF = perp(aU, aF);
    soft.elbowFlex = softLimit(S, P, el, aU, fU, uaT, aF, fF, faT, 1, [0.1, 0.13, 0.16]); }
  { const hj = ep.HJC_L, aT = unit(sub(ep.KJC_L, hj)), up = [0, 1, 0], fwd = [0, 0, 1];
    soft.hipFlex = softLimit(S, P, hj, aT, perp(fwd, aT), legT, up, fwd, trunkT, 1, [0.2, 0.25, 0.3, 0.35]); }
  for (const [k, s] of Object.entries(soft)) if (rom[k] && s.maxFlex < rom[k].deg) { rom[k].bony = rom[k].deg; rom[k].deg = s.maxFlex; rom[k].limitedBy = 'soft tissue'; }
  // rig/limits.js LIMITS format (degrees; flex + = distal end forward; the shin's flexion is negative there)
  const limits = { upperarm: { axis: -1, flex: [-60, rom.shoulderFlex.deg], abd: [-30, 180], twist: [-90, 90] },
    forearm: { axis: -1, flex: [-rom.elbowExt.deg, rom.elbowFlex.deg], abd: [-10, 10], twist: [-rom.pronation.deg, rom.supination.deg] },
    thigh: { axis: -1, flex: [-rom.hipExt.deg, rom.hipFlex.deg], abd: [-25, 40], twist: [-40, 45] },
    shin: { axis: -1, flex: [-rom.kneeFlex.deg, rom.kneeExt.deg], abd: [-10, 10], twist: [-10, 10] },
    foot: { axis: -1, flex: [-rom.anklePlantar.deg, rom.ankleDorsi.deg], abd: [-25, 25], twist: [-30, 30] } };
  // ---- stance (bind: hip joints, hip breadth from the measures)
  const hipSp = Math.abs(ep.HJC_L[0] - ep.HJC_R[0]), hb = m.hipBreadth || hipSp * 2, ST = lit.stance;
  const heelSep = clamp(ST.heelSep * (hb / (sex === 'f' ? 0.37 : 0.355)) + 0.025 * g(), 0.08, 0.34);
  const stance = { hipJointSpacing: r4(hipSp), hipBreadth: r4(hb), heelSep: r4(heelSep), ankleSep: r4(heelSep + 0.01), footAngle: r1(clamp(ST.footAngle + 5 * g(), 0, 35)), src: 'McIlroy and Maki 1997, scaled by hip breadth (ours)' };
  // ---- gait
  const H = m.stature, legL = (ep.HJC_L[1] + ep.HJC_R[1]) / 2, old = clamp((age - 35) / 45), heavy = clamp((m.bmi - 25) / 12), wk = t.preg?.week || 0, pg = clamp((wk - 12) / 28);
  // comfortable speed by sex and decade (Bohannon 1997, Age Ageing 26:15, 230 adults 20-79 y; 80+ extended), slower when heavy or late in
  // pregnancy; then step and cadence from the walk ratio (step length / cadence ~ 0.00365 x stature m per step/min; Sekiya and Nagasaki 1998)
  const BOH = { f: [1.407, 1.415, 1.390, 1.395, 1.296, 1.272, 1.17], m: [1.393, 1.458, 1.462, 1.393, 1.359, 1.331, 1.23] }, dec = clamp((age - 25) / 10, 0, 6), di = Math.min(5, Math.floor(dec)), bo = BOH[sex][di] + (BOH[sex][di + 1] - BOH[sex][di]) * (dec - di);
  const speed = clamp(bo * (1 - 0.012 * Math.max(0, m.bmi - 30) - 0.1 * pg) + 0.1 * g(), 0.5, 1.9), wr = 0.00365 * H, step = Math.sqrt(wr * 60 * speed), froude = speed * speed / (9.81 * legL);
  const GA = lit.gait, btr = hb / legL, btr0 = sex === 'f' ? 0.43 : 0.39;
  const gait = { legLength: r4(legL), froude: r4(froude), speed: r4(speed), stepLength: r4(step), cadence: r1(speed / step * 60), walkRatio: +wr.toFixed(5), stepWidth: r4(clamp(0.55 * hipSp + 0.03 * pg + 0.01 * heavy + 0.012 * g(), 0.03, 0.2)),
    pelvicObliquity: r1(Math.max(2, GA.pelvicObliquity[sex][0] + GA.pelvicObliquity[sex][1] * g())), comVerticalPctLeg: r1(Math.max(1.5, GA.comVertical[sex][0] + GA.comVertical[sex][1] * g())),
    hipAdductionPeak: r1(8 + (sex === 'f' ? 3 : 0) + 20 * (btr - btr0) + 1.5 * g()), armSwing: r4(clamp(1 - 0.35 * old - 0.15 * heavy, 0.3, 1.1)),
    posture: { kyphosis: r4(0.05 + 0.22 * old + 0.08 * heavy), headFwd: r4(0.04 + 0.16 * old), kneeBend: r4(0.03 + 0.08 * old), lumbarExtension: r4(28 * Math.PI / 180 * pg * pg) },
    src: 'speed Bohannon 1997 by sex and decade (heavy and pregnant slower: ours); walk ratio 0.00365 stature (Sekiya and Nagasaki 1998); Smith et al. 2002; Chumanov et al. 2008 (scaled, ours); Whitcome et al. 2007' };
  // ---- balance.js SEGMENTS in its own joint names, with this person's fractions (com(P) with these reproduces the bind COM)
  const BJ = { neck: ep.C7T1, headTop: ep.VERT, hips: ep.MIDH, shoulderMid: ep.SJCmid, shL: ep.SJC_L, elL: ep.EJC_L, wrL: ep.WJC_L, fiL: ep.MET3_L, shR: ep.SJC_R, elR: ep.EJC_R, wrR: ep.WJC_R, fiR: ep.MET3_R,
    hipL: ep.HJC_L, knL: ep.KJC_L, anL: ep.AJC_L, toL: ep.TTIP_L, hipR: ep.HJC_R, knR: ep.KJC_R, anR: ep.AJC_R, toR: ep.TTIP_R };
  const along = (a, b, c) => { const v = sub(BJ[b], BJ[a]); return r4(dot(sub(c, BJ[a]), v) / dot(v, v)); };
  const trunkM = segs.upperTrunk.mass + segs.midTrunk.mass + segs.lowerTrunk.mass, trunkC = mul(add(add(mul(segs.upperTrunk.com, segs.upperTrunk.mass), mul(segs.midTrunk.com, segs.midTrunk.mass)), mul(segs.lowerTrunk.com, segs.lowerTrunk.mass)), 1 / trunkM);
  const balanceSegments = [['head', 'neck', 'headTop', r4(segs.head.mass / M), along('neck', 'headTop', segs.head.com)], ['trunk', 'hips', 'shoulderMid', r4(trunkM / M), along('hips', 'shoulderMid', trunkC)]];
  for (const s of ['L', 'R']) for (const [nm, k, a, b] of [['uarm', 'upperArm', 'sh', 'el'], ['farm', 'forearm', 'el', 'wr'], ['hand', 'hand', 'wr', 'fi'], ['thigh', 'thigh', 'hip', 'kn'], ['shin', 'shank', 'kn', 'an'], ['foot', 'foot', 'an', 'to']]) {
    const sg = segs[`${k}_${s}`]; balanceSegments.push([nm + s, a + s, b + s, r4(sg.mass / M), along(a + s, b + s, sg.com)]); }
  return { version: KIN_VERSION, units: 'm, kg, kg m^2, deg (posture: rad)', frame: 'bind pose at the person\'s stature: x the person\'s left, y up, z forward, ground y = 0',
    sex, age, stature: r4(H), mass: r4(M), joints, jointBones: JOINT_BONES, landmarks: Object.fromEntries(['VERT', 'CERV', 'SUPR', 'XYPH', 'OMPH', 'MET3_L', 'MET3_R', 'HEEL_L', 'HEEL_R', 'TTIP_L', 'TTIP_R', 'GLUTF_L', 'GLUTF_R'].map(k => [k, r3(ep[k])])),
    segments: segs, com: r3(comAll), comHeightFrac: r4(comAll[1] / H), comDeLeva: r3(cd), comHeightFracDeLeva: r4(cd[1] / H), voxel: { h, volumeL: r4(volL), meshVolumeL: r4(m.vol) },
    carryingAngle: carrying, rom, softTissue: soft, limits, stance, gait, balanceSegments, balanceJoints: Object.fromEntries(Object.entries(BJ).map(([k, v]) => [k, r3(v)])) };
}
// scale a kin to another rendered height (Hero's o.height / p.height): lengths x s, masses x s^3 (same density), inertia x s^5
export function scaleKin(kin, s) {
  if (s === 1) return kin; const L = v => v.map(x => r4(x * s)), out = JSON.parse(JSON.stringify(kin));
  for (const o of [out.joints, out.landmarks, out.balanceJoints]) for (const k of Object.keys(o)) o[k] = L(o[k]);
  for (const g of Object.values(out.segments)) { g.mass = r4(g.mass * s ** 3); g.com = L(g.com); g.length = r4(g.length * s); g.inertia = g.inertia.map(r => r.map(x => +(x * s ** 5).toExponential(4))); g.deLeva.mass = r4(g.deLeva.mass * s ** 3); g.deLeva.com = L(g.deLeva.com); }
  out.com = L(out.com); out.comDeLeva = L(out.comDeLeva); out.stature = r4(out.stature * s); out.mass = r4(out.mass * s ** 3);
  for (const k of ['hipJointSpacing', 'hipBreadth', 'heelSep', 'ankleSep']) out.stance[k] = r4(out.stance[k] * s);
  for (const k of ['legLength', 'stepLength', 'stepWidth']) out.gait[k] = r4(out.gait[k] * s); out.gait.speed = r4(out.gait.speed * Math.sqrt(s)); out.gait.cadence = r1(out.gait.speed / out.gait.stepLength * 60);
  return out;
}
