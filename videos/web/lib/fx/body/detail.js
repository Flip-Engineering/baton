// BODY / DETAIL (P1, ANATOMY AT RESOLUTION, 3 Oct 2026): the small anatomical forms a 13k-quad body cannot carry, evaluated on the
// person's subdivided mesh (subdiv.js) FROM THE PERSON'S OWN ANATOMY: the landmarks and joint centres of the frame, the muscle amounts
// the fit chose (lane A's muscle layer, which swells with fat-free mass), and the subcutaneous fat thickness that decides how much of
// it shows. Ours, CC0. Applied to a built Hero from outside (no hero.js hook), opt-in: a hero nobody calls applyDetail on is untouched.
//
//   import { applyDetail } from '/web/lib/fx/body/detail.js';
//   const D = applyDetail(h, p, { level: 1 });     // h = new Hero(p, ...) for a body-studio person p (castBody / loadCast)
//   D.update();                                    // after posing, each frame: the flexion bulges follow the elbows, knees and ankles
//   D.setLevel(0 | D.level)                        // LOD: swap back to the 13k body for distant views (levelForView in subdiv.js)
//   D.stats                                        // vertices, triangles, ms per stage, displacement range, volume change
// Order with the other lanes: applyDetail BEFORE likeness/applySkin (its per-vertex fields are then computed on the detailed mesh; if it
// ran first its attributes are subdivided along) and before hair/style patches; garments, eyes and hair cards are separate meshes and stay.
//
// What it adds (each a displacement along the subdivided mesh's own normal, metres, in bind space):
//  1. MUSCLE DEFINITION. Lane A's muscle bellies (Scheepers et al. 1997 origin-insertion bellies, amplitude from the fit) are re-shaped
//     at resolution: each field's half-maximum contour becomes the belly's edge, sharp where the person is lean and blurred by the fat
//     over it (edge width 2.5 mm + 0.7 x fat thickness), the volume of each muscle kept (the re-shaped belly is scaled to the same
//     integral, so the fitted mass and tapes stay). The definition is the difference, weighted by exp(-fat / 10 mm): a lean body shows
//     every belly and the separations between them, a heavy one keeps the masses and loses the edges.
//  2. SUBCUTANEOUS BONE AND TENDON as resolution-free curves and points on the person's surface (clavicle and its fossae, jugular
//     notch, sternoclavicular joints, costal margin, ASIS and iliac crest, C7 and the thoracic spinous processes, scapular spine, border
//     and angle, olecranon and epicondyles, ulnar head, knuckles, patella with its tendon and fat pads, tibial tuberosity and crest,
//     malleoli, Achilles tendon, wrist flexor and hand extensor tendons, hamstring tendons), fading as exp(-fat / tau), tau 4-8 mm.
//  3. SEPARATIONS between muscle groups the student draws (linea alba, linea semilunaris, the rectus intersections, deltopectoral and
//     bicipital grooves, the spinal furrow by the erectors, the iliac furrow, the inguinal line, the sartorius and IT-band grooves, the
//     popliteal hollow, the lateral gluteal hollow), deepened by the muscles either side and filled by fat.
//  4. FOLDS AND CREASES: joint creases (elbow, popliteal), the gluteal fold and cleft, sacral dimples, the inframammary fold (from the
//     person's breast, deeper with volume and ptosis), and where adiposity makes them the navel and suprapubic abdominal folds, the flank
//     and bra-line rolls, each a crease with the overhanging roll above, deeper with fat and laxity (age, parity).
//  5. MICRO RELIEF in the shader (bump from bind-space functions, crisp at any vertex spacing): superficial veins on the forearms,
//     hands, shins and feet (lean, older, male and muscular show more), cellulite dimpling on the gluteofemoral skin where fat is thick
//     (most adult women, few men).
//  6. FLEXION BULGES (the cheap part of Scheepers): biceps and brachialis thicken as the elbow flexes while the triceps flattens; the
//     hamstrings with the knee; the calf with plantarflexion. A per-vertex vector in the vertex shader, driven by D.update().
// Lane B (skin), D (hair), E (style) and P2 (face) are separate: P2 adds its own small face forms through registerDetail(fn) (below).
import * as THREE from 'three';
import { HERO_REGIONS as R } from '../hero.js';
import { subdivideHero, subdivideAttr, setBodyLevel } from './subdiv.js';
import { reliefBase, reliefMod, muscleField } from './mix.js';
import { nippleRelief7 } from './nipple.js';      // NAC7 v2 (BODY7 rev 7.7): a rev 7 record only
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sst = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = a => Math.hypot(a[0], a[1], a[2]), unit = a => mul(a, 1 / (len(a) || 1));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const perp = (d, axis) => unit(sub(d, mul(axis, dot(d, axis))));
// the average adult man's fitted muscle amounts (lane A's cast, m45 p50): the reference that sets how much a groove deepens with muscle
const MUS_REF = { deltoid: 0.004, pectoral: 0.0045, trapUpper: 0.0067, trapMid: 0.0034, trapLower: 0.0022, latissimus: 0.0045, erector: 0.0036, rectusAbd: 0.0027, oblique: 0.0027, serratus: 0.0017,
  gluteMax: 0.0078, gluteMed: 0.0049, biceps: 0.0034, triceps: 0.0034, forearmExt: 0.0027, forearmFlex: 0.0027, rectusFem: 0.0043, vastusLat: 0.005, vastusMed: 0.005, adductors: 0.0036,
  hamstrings: 0.0043, gastroc: 0.0068, soleus: 0.0039, tibialisAnt: 0.0029, scm: 0.0034 };
// the most a belly is re-shaped (m): the strongest fitted amounts (upper trapezius 16 mm) would otherwise carve humps
const MDEF_CAP = 0.008;
// BODY7 c3 it2: the GIRDLE's typed forms (the curves placed from hm08 landmarks with typed amplitudes, and the half-maximum re-shaping of the
// girdle's fitted muscle blobs) are accumulated apart in Dg (their total is unchanged in D), so body/girdle_layer7.js can replace them with the
// relief the person's own girdle anatomy implies (ANAT8-BODY's bones and muscles under the person's fat): detail.Dg3 = Dg x the normal it was
// displaced along (bind). Nothing else reads it.
// (c3 it8) the jugular notch and the SC joints stay OUT of Dg: they are point forms at the skin's own landmarks (the suprasternale the skeleton is
// anchored to), which the girdle layer's coarse bones do not resolve; the layer keeps them and replaces the curves and the blobs.
export const GIRDLE_CURVES = new Set(['clavicle', 'supraclavFossa', 'scm', 'infraclavFossa', 'deltopectoral', 'sternum']);
export const GIRDLE_MUS = new Set(['scm', 'trapUpper', 'pectoral', 'deltoid']);
export const DETAIL_DEFAULTS = { level: 1, define: 1.2, bone: 1, folds: 1, creases: 1, veins: 1, cellulite: 1, flex: 1, micro: true, regions: null, bandLimit: 1.3, compensate: 1, morphs: true, seed: null, skip: null };
const _extra = [];
// another lane's forms at this resolution: fn(ctx) adds displacements with ctx.add(v, metres) (ctx below: P, N, n, T, region, hv, lm(name),
// jt(bone), pick(o, dir, regions), curve(spec)); returns nothing. P2 (lib/fx/face/) registers its small face forms here.
export function registerDetail(name, fn) { const i = _extra.findIndex(e => e.name === name); if (i >= 0) _extra[i] = { name, fn }; else _extra.push({ name, fn }); }

// ---------------------------------------------------------------- the context: the subdivided mesh, its fields, picking and a vertex grid
function makeContext(h, p, o) {
  const S = p._S, B = p.built, g = h.body.geometry, plan = g.userData.plan || null, n = g.attributes.position.count, P = g.attributes.position.array, N = g.attributes.normal.array;
  const AH = g.attributes.aHero.array, I = g.index.array, n0 = S.n, nb = S.nb;
  const up = (a, k = 1) => plan ? subdivideAttr(plan, a, k, 'linear') : a;
  const inTri = new Uint8Array(n); for (let i = 0; i < I.length; i++) inTri[I[i]] = 1;
  // per-vertex area and mean edge length
  const area = new Float32Array(n), hv = new Float32Array(n), hc = new Float32Array(n);
  for (let t = 0; t < I.length; t += 3) { const a = I[t], b = I[t + 1], c = I[t + 2], A = [a, b, c].map(v => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]);
    const ar = len(cross(sub(A[1], A[0]), sub(A[2], A[0]))) / 6; area[a] += ar; area[b] += ar; area[c] += ar;
    for (const [x, y, u, w] of [[a, b, 0, 1], [b, c, 1, 2], [c, a, 2, 0]]) { const l = len(sub(A[u], A[w])); hv[x] += l; hv[y] += l; hc[x]++; hc[y]++; } }
  for (let v = 0; v < n; v++) hv[v] = hc[v] ? hv[v] / hc[v] : 0.01;
  // fat thickness: lane A's depots (B.T, body vertices) + a baseline for MakeHuman's own subcutaneous layer (by its macro weight)
  // lane A's T is what its depots ADD to MakeHuman's own body, which already carries a subcutaneous layer: that layer is set from the
  // person's fat fraction (NHANES DXA via the sampler) by region, women thicker over the hips, thighs and upper arms (OUR calibration,
  // read against NHANES 2005-06 triceps and subscapular skinfolds: a skinfold is about twice the fat under it)
  const T0 = new Float32Array(n0); T0.set(B.T.subarray(0, nb)); const T = up(T0), pf = p.targets?.pf ?? (p.sex === 'f' ? 0.32 : 0.22), lay = 0.0015 + 0.03 * Math.max(0, pf - 0.06);
  const fem = p.sex === 'f', RK = { [R.head]: 0.45, [R.jaw]: 0.5, [R.neck]: 0.6, [R.torso]: 1, [R.uarm]: fem ? 1.05 : 0.75, [R.farm]: 0.45, [R.hand]: 0.22, [R.finger]: 0.15, [R.pelvis]: fem ? 1.35 : 1.1, [R.thigh]: fem ? 1.3 : 0.85, [R.shin]: 0.5, [R.foot]: 0.25 };
  const rk0 = new Float32Array(n0); for (let v = 0; v < n0; v++) rk0[v] = RK[S.region[v]] ?? 0.6; const rk = up(rk0);
  for (let v = 0; v < n; v++) T[v] = Math.max(0, T[v]) + lay * rk[v];
  // vertex grid (2 cm)
  const cell = 0.02, grid = new Map(), kk = (x, y, z) => ((Math.floor(x / cell) + 512) * 1024 + Math.floor(y / cell) + 512) * 1024 + Math.floor(z / cell) + 512;
  for (let v = 0; v < n; v++) if (inTri[v]) { const k = kk(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(v); }
  const box = (lo, hi, cb) => { for (let x = Math.floor(lo[0] / cell); x <= Math.floor(hi[0] / cell); x++) for (let y = Math.floor(lo[1] / cell); y <= Math.floor(hi[1] / cell); y++) for (let z = Math.floor(lo[2] / cell); z <= Math.floor(hi[2] / cell); z++) {
    const a = grid.get(((x + 512) * 1024 + y + 512) * 1024 + z + 512); if (a) for (const v of a) cb(v); } };
  const region = v => AH[v * 4], side = v => AH[v * 4 + 2];
  const regSet = regs => regs ? new Set(regs) : null;
  const pos = v => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], nrm = v => [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]];
  const nearest = (q, regs = null, sgn = 0) => { const rs = regSet(regs); for (let r = 0.02; r <= 0.16; r *= 2) { let best = -1, bd = Infinity;
      box(sub(q, [r, r, r]), add(q, [r, r, r]), v => { if (rs && !rs.has(region(v))) return; if (sgn && Math.sign(P[v * 3]) !== sgn && Math.abs(P[v * 3]) > 0.004) return; const d = (P[v * 3] - q[0]) ** 2 + (P[v * 3 + 1] - q[1]) ** 2 + (P[v * 3 + 2] - q[2]) ** 2; if (d < bd) { bd = d; best = v; } });
      if (best >= 0) return best; } return -1; };
  // a ray from o along d to the skin (the vertex nearest the ray inside a cone, facing it), as lane A's ray_pick; original vertices only
  const pick = (o, d, regs = null, cone = 0.45) => { d = unit(d); const rs = regSet(regs); let best = -1, bs = Infinity;
    for (let v = 0; v < nb; v++) { if (rs && !rs.has(region(v))) continue; const q = sub(pos(v), o), t = dot(q, d); if (t <= 0 || t > 0.35) continue; const pr = len(sub(q, mul(d, t)));
      if (pr > Math.tan(cone) * t + 0.004) continue; const sc = pr + 0.05 * t + 0.02 * Math.max(0, -dot(nrm(v), d)); if (sc < bs) { bs = sc; best = v; } }   // the first skin along the ray wins
    if (best < 0) throw new Error('detail: no surface along ' + JSON.stringify(o.map(x => +x.toFixed(3))) + ' -> ' + JSON.stringify(d.map(x => +x.toFixed(2))));
    return pos(best); };
  const L = S.landmarks, lm = name => { const v = L[name]; if (v == null) throw new Error('detail: no landmark ' + name); return pos(v); };
  const I0 = h.idx, jt = b => h.head0[I0[b]].toArray();
  const k = (p.height || B.stature) / 1.7;
  return { h, p, S, B, g, plan, n, n0, nb, P, N, AH, I, inTri, area, hv, T, up, box, nearest, pick, lm, jt, region, side, pos, nrm, k, regSet, o };
}

// ---------------------------------------------------------------- curves on the surface
// spec: { pts: [[x,y,z]...] control points (any; snapped to the skin), w half-width (m), amp (m, + raised), prof 'round' | 'plateau' |
//   'sharp' | 'gauss' | 'fold', vis [kind, ...], env [[s, k]...] along the curve (0..1), wenv width along, ab [a, b] (a point with an
//   elliptical footprint: half-lengths along dir and across), dir, regs, face (facing threshold), roll (fold: the roll side, a vector),
//   taper (default true), sgn (keep to one side of the midline) }
function curve(C, sp) {
  const regs = sp.regs || null, sgn = sp.sgn || 0, step = 0.007 * C.k;
  let ctrl = sp.pts.map(q => q.slice()), out = [];
  if (ctrl.length === 1) out = [ctrl[0]];
  else for (let i = 0; i < ctrl.length - 1; i++) { const a = ctrl[i], b = ctrl[i + 1], m = Math.max(1, Math.ceil(len(sub(b, a)) / step)); for (let j = 0; j < m; j++) out.push(lerp(a, b, j / m)); }
  if (ctrl.length > 1) out.push(ctrl[ctrl.length - 1]);
  // snap to the nearest skin vertex, then smooth (the vertex lattice zigzags); the normal from the snapped vertices, smoothed alike
  let nr = out.map(q => { const v = C.nearest(q, regs, sgn); return v < 0 ? null : v; });
  const keep = nr.map((v, i) => v != null ? i : -1).filter(i => i >= 0); out = keep.map(i => C.pos(nr[i])); let nl = keep.map(i => C.nrm(nr[i]));
  for (let it = 0; it < 3 && out.length > 2; it++) { const o2 = out.map(q => q.slice()), n2 = nl.map(q => q.slice());
    for (let i = 1; i < out.length - 1; i++) { o2[i] = add(mul(out[i], 0.5), mul(add(out[i - 1], out[i + 1]), 0.25)); n2[i] = unit(add(mul(nl[i], 0.5), mul(add(nl[i - 1], nl[i + 1]), 0.25))); } out = o2; nl = n2; }
  const cum = [0]; for (let i = 1; i < out.length; i++) cum.push(cum[i - 1] + len(sub(out[i], out[i - 1])));
  return { ...sp, pl: out, nl, cum, total: cum[cum.length - 1] || 1 };
}
const knots = (ks, s) => { if (!ks) return 1; if (s <= ks[0][0]) return ks[0][1]; for (let i = 1; i < ks.length; i++) if (s <= ks[i][0]) { const [s0, a] = ks[i - 1], [s1, b] = ks[i]; return a + (b - a) * (s - s0) / (s1 - s0 || 1); } return ks[ks.length - 1][1]; };
function profile(kind, d) {
  switch (kind) {
    case 'plateau': return sst(1.0, 0.55, d);
    case 'sharp': return d < 1.6 ? Math.exp(-2.6 * d) * (1 - d / 1.6) : 0;
    case 'gauss': return Math.exp(-2.2 * d * d);
    default: return d < 1 ? (1 - d * d) ** 2 : 0;          // round
  }
}
// evaluate one curve into D (scalar along the normal); vis(v) gives the visibility law
function evalCurve(C, cv, D, vis) {
  const { pl, nl, cum, total } = cv, M = pl.length, w0 = cv.w, isPt = M === 1, rs = C.regSet(cv.regs), ab = cv.ab, fold = cv.prof === 'fold';
  const wmax = ab ? Math.max(...ab) : w0 * Math.max(1, ...(cv.wenv || [[0, 1]]).map(q => q[1])), reach = (fold ? 3.5 : 1.25) * wmax + 0.004;
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (const q of pl) { lo = lo.map((x, i) => Math.min(x, q[i])); hi = hi.map((x, i) => Math.max(x, q[i])); }
  const P = C.P, N = C.N, bl = C.o.bandLimit, face0 = cv.face ?? 0.1, roll = cv.roll || null;
  let dirAB = cv.dir ? unit(cv.dir) : null;
  C.box(sub(lo, [reach, reach, reach]), add(hi, [reach, reach, reach]), v => {
    if (rs && !rs.has(C.region(v))) return; if (cv.sgn && Math.sign(P[v * 3]) !== cv.sgn) return; if (cv.zMax != null && P[v * 3 + 2] > cv.zMax) return;
    const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
    let bk = 0, bt = 0, bd = Infinity, bc = pl[0];
    if (!isPt) for (let i = 0; i < M - 1; i++) { const a = pl[i], e = sub(pl[i + 1], a), ee = dot(e, e) || 1e-12, t = clamp(dot(sub(p, a), e) / ee), c = add(a, mul(e, t)), d = dot(sub(p, c), sub(p, c)); if (d < bd) { bd = d; bk = i; bt = t; bc = c; } }
    const nc = isPt ? nl[0] : unit(lerp(nl[bk], nl[bk + 1], bt)), tan = isPt ? (dirAB || [0, 1, 0]) : unit(sub(pl[bk + 1], pl[bk]));
    const nv = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]], fc = sst(face0, face0 + 0.4, dot(nv, nc)); if (fc <= 0) return;
    const dl = sub(p, bc), dn = dot(dl, nc), dt = sub(dl, mul(nc, dn)), gate = Math.exp(-2 * (dn / reach) ** 2);
    const s = isPt ? 0.5 : (cum[bk] + bt * (cum[bk + 1] - cum[bk])) / total;
    let env = knots(cv.env, s); if (!isPt && cv.taper !== false) env *= sst(0, 0.1, s) * sst(1, 0.9, s);
    if (!env) return;
    const w = w0 * knots(cv.wenv, s), weff = Math.max(w, bl * C.hv[v]), thin = w / weff;
    let val;
    if (fold) { let b = unit(cross(nc, tan)); if (roll && dot(b, roll) < 0) b = mul(b, -1); const lat = dot(dt, b);
      val = -Math.exp(-((lat / weff) ** 2)) * thin + (cv.rollK ?? 0.45) * (lat > 0 ? Math.exp(-(((lat - 2.4 * w * (cv.rollW ?? 2.5)) / (w * (cv.rollW ?? 2.5))) ** 2)) : 0); }
    else if (ab) { const tt = perp(tan, nc), bb = cross(nc, tt), u = dot(dt, tt), q = dot(dt, bb); val = profile(cv.prof, Math.hypot(u / ab[0], q / ab[1])); }
    else { const d = len(dt) / weff; val = profile(cv.prof, d) * (cv.prof === 'sharp' || cv.crease ? thin : 1); }
    if (!val) return;
    D[v] += cv.amp * env * val * fc * gate * vis(v, cv);
  });
}

// ---------------------------------------------------------------- the anatomy (left side authored, mirrored by s; k = stature / 1.7)
function anatomy(C) {
  const { lm, jt, pick, k } = C, p = C.p, sex = p.sex, out = [], F = [0, 0, 1], BK = [0, 0, -1], UP = [0, 1, 0];
  const RG = { trunk: [R.torso, R.pelvis, R.neck], torso: [R.torso, R.neck], neck: [R.neck, R.torso, R.head, R.jaw], uarm: [R.uarm, R.torso], arm: [R.uarm, R.farm], farm: [R.farm, R.hand, R.uarm], hand: [R.hand, R.farm, R.finger],
    pelvis: [R.pelvis, R.torso, R.thigh], thigh: [R.thigh, R.pelvis], knee: [R.thigh, R.shin], shin: [R.shin, R.foot], foot: [R.foot, R.shin] };
  const add_ = q => out.push(q), sp = (a, d, regs, cone) => { try { return pick(a, d, regs, cone); } catch { return null; } };
  const SN = lm('suprasternale'), XY = lm('xiphoid'), OM = lm('omphalion'), PU = lm('pubis'), C7 = lm('cervicale'), SAC = lm('sacrum');
  // ---- midline
  add_({ name: 'jugularNotch', pts: [add(SN, [0, 0.01 * k, -0.004])], w: 0.015 * k, amp: -0.0055, prof: 'round', vis: ['bone', 0.009], regs: RG.neck, face: 0 });
  add_({ name: 'sternum', pts: [add(SN, [0, -0.03 * k, 0]), add(XY, [0, 0.015 * k, 0])].map(q => sp(add(q, [0, 0, -0.08]), F, RG.torso)).filter(Boolean), w: 0.016 * k, amp: -0.0016, prof: 'round', vis: ['musc', 0.01, ['pectoral']], regs: RG.torso });
  add_({ name: 'epigastric', pts: [add(XY, [0, -0.025 * k, 0.01])], ab: [0.022 * k, 0.026 * k], dir: UP, amp: -0.0018, prof: 'round', vis: ['bone', 0.006], regs: RG.trunk });
  const albaPts = [add(XY, [0, -0.012 * k, 0]), lerp(XY, OM, 0.5), add(OM, [0, 0.012 * k, 0])].map(q => sp(add(q, [0, 0, -0.1]), F, RG.trunk)).filter(Boolean);
  add_({ name: 'lineaAlba', pts: albaPts, w: 0.0085 * k, amp: -0.0022, prof: 'round', vis: ['musc', 0.01, ['rectusAbd']], regs: RG.trunk });
  add_({ name: 'navel', pts: [OM], ab: [0.007 * k, 0.0055 * k], dir: UP, amp: -0.004, prof: 'round', vis: ['const'], regs: RG.trunk, face: -0.2 });
  add_({ name: 'c7', pts: [C7], w: 0.012 * k, amp: 0.0035, prof: 'round', vis: ['bone', 0.009], regs: RG.neck, face: 0 });
  const scapInfY = (lm('scapInfL')[1] + lm('scapInfR')[1]) / 2;
  for (let y = C7[1] - 0.026 * k, i = 0; y > scapInfY - 0.06 * k; y -= 0.024 * k, i++) { const q = sp([0, y, 0], BK, RG.torso); if (q) add_({ name: 'spinous', pts: [q], w: (i ? 0.0075 : 0.009) * k, amp: i ? 0.0012 : 0.0022, prof: 'round', vis: ['bone', i ? 0.004 : 0.007], regs: RG.torso, face: 0 }); }
  const furrow = []; for (let f = 0; f <= 1.0001; f += 0.125) { const y = C7[1] - 0.05 * k + (SAC[1] + 0.02 * k - C7[1] + 0.05 * k) * f, q = sp([0, y, 0], BK, RG.trunk); if (q) furrow.push(q); }
  add_({ name: 'spinalFurrow', pts: furrow, w: 0.008 * k, wenv: [[0, 0.8], [0.55, 1], [0.85, 1.5], [1, 1.2]], amp: -0.0042, env: [[0, 0.35], [0.5, 0.6], [0.8, 1], [1, 0.7]], prof: 'round', vis: ['musc', 0.014, ['erector']], regs: RG.trunk });
  const crotchY = Math.min(lm('gluteFoldL')[1], lm('gluteFoldR')[1]) + 0.01 * k, cl = [add(SAC, [0, -0.02 * k, 0]), [0, (SAC[1] + crotchY) / 2, -0.02], [0, crotchY, -0.02]].map((q, i) => i ? sp(q, BK, [R.pelvis, R.thigh]) : q).filter(Boolean);
  add_({ name: 'glutealCleft', zMax: jt('upperleg01.L')[2] - 0.01, pts: cl, w: 0.0045 * k, amp: -0.0045, prof: 'sharp', crease: true, vis: ['crease'], env: [[0, 0.4], [0.3, 1], [1, 1]], regs: [R.pelvis, R.thigh] });
  for (const s of [1, -1]) {
    const X = s > 0 ? 'L' : 'R', m = q => [q[0] * s, q[1], q[2]], sd = d => [d[0] * s, d[1], d[2]];
    // ---- neck, clavicle, shoulder
    const scj = sp(add(SN, [s * 0.024 * k, 0.006 * k, -0.04]), F, RG.neck), ac = lm('acromion' + X), cm = lm('clavicleMid' + X);
    const acj = sp(add(ac, [-s * 0.016 * k, 0.0, 0.02]), [0, 1, 0.25], RG.neck.concat([R.uarm])) || ac;
    if (scj) { add_({ name: 'clavicle', pts: [scj, add(lerp(scj, cm, 0.5), [0, 0, 0.004]), cm, lerp(cm, acj, 0.55), acj], w: 0.0072 * k, amp: 0.0032, prof: 'round', env: [[0, 1.25], [0.3, 1], [0.8, 0.85], [1, 1.1]], taper: false, vis: ['bone', 0.007], regs: RG.neck.concat([R.uarm]), sgn: s, face: 0 });
      add_({ name: 'scJoint', pts: [scj], w: 0.0095 * k, amp: 0.0022, prof: 'round', vis: ['bone', 0.008], regs: RG.neck, sgn: s, face: 0 });
      const fos = [lerp(scj, cm, 0.35), cm, lerp(cm, acj, 0.45)].map(q => sp(add(q, [0, 0.04 * k, -0.05]), [0, 0.6, 1], RG.neck)).filter(Boolean);
      if (fos.length > 1) add_({ name: 'supraclavFossa', pts: fos.map(q => add(q, [0, 0.012 * k, -0.006])), w: 0.012 * k, amp: -0.0045, prof: 'round', vis: ['bone', 0.008, 'age'], regs: RG.neck, sgn: s, face: 0 });
      const ms = sp(add(lm('tragion' + X), [-s * 0.012, -0.028 * k, -0.02 * k]), [s, -0.2, -0.3], [R.neck, R.head, R.jaw]);
      if (ms) { const sh = sp(add(SN, [s * 0.014 * k, 0.014 * k, -0.04]), F, RG.neck) || scj;
        add_({ name: 'scm', pts: [sh, lerp(sh, ms, 0.35), lerp(sh, ms, 0.7), ms], w: 0.0095 * k, wenv: [[0, 0.7], [0.4, 1.1], [1, 1.2]], amp: 0.0028, prof: 'round', env: [[0, 1.2], [0.35, 1], [1, 0.45]], vis: ['musc', 0.012, ['scm'], 0.35], regs: RG.neck, sgn: s, face: -0.1 }); } }
    const ifc = sp(add(lerp(cm, acj, 0.4), [0, -0.035 * k, -0.04]), [s * 0.2, 0.1, 1], RG.torso.concat([R.uarm]));
    if (ifc) add_({ name: 'infraclavFossa', pts: [ifc], w: 0.014 * k, amp: -0.0022, prof: 'round', vis: ['musc', 0.01, ['deltoid', 'pectoral']], regs: RG.torso.concat([R.uarm]), sgn: s });
    // ---- arm frame (bind A-pose): u down the humerus; anterior = the body's forward direction orthogonalised; lateral away from the trunk
    const SH = jt('upperarm01.' + X), EL = jt('lowerarm01.' + X), WR = jt('wrist.' + X), u = unit(sub(EL, SH)), ant = perp(F, u), lat0 = cross(u, ant), lat = lat0[0] * s > 0 ? lat0 : mul(lat0, -1);
    const LIMB = { arm: [R.uarm, R.farm, R.hand], leg: [R.thigh, R.shin, R.foot, R.pelvis] };
    const around = (a, b, t, ang, A = ant, Lt = lat, regs = LIMB.arm) => { const ax = unit(sub(b, a)), aa = perp(A, ax), ll = perp(Lt, ax), d = add(mul(aa, Math.cos(ang)), mul(ll, Math.sin(ang))); return sp(lerp(a, b, t), d, regs, 0.35); };
    const deg = Math.PI / 180;
    // deltopectoral groove: from the infraclavicular fossa along the deltoid's front edge toward its insertion
    const dp = [ifc, around(SH, EL, 0.12, 35 * deg), around(SH, EL, 0.3, 45 * deg)].filter(Boolean);
    if (dp.length > 1) add_({ name: 'deltopectoral', pts: dp, w: 0.0075 * k, amp: -0.0024, prof: 'round', vis: ['musc', 0.01, ['deltoid', 'pectoral']], regs: RG.uarm, sgn: s });
    // bicipital grooves (medial: between biceps and triceps; lateral: biceps / brachialis and triceps)
    const mb = [0.28, 0.55, 0.85].map(t => around(SH, EL, t, -70 * deg)).filter(Boolean), lb = [0.5, 0.7, 0.9].map(t => around(SH, EL, t, 72 * deg)).filter(Boolean);
    if (mb.length > 1) add_({ name: 'medialBicipital', pts: mb, w: 0.0075 * k, amp: -0.0026, prof: 'round', vis: ['musc', 0.01, ['biceps', 'triceps']], regs: RG.arm, sgn: s, face: -0.1 });
    if (lb.length > 1) add_({ name: 'lateralBicipital', pts: lb, w: 0.0065 * k, amp: -0.002, prof: 'round', vis: ['musc', 0.01, ['biceps', 'triceps']], regs: RG.arm, sgn: s, face: -0.1 });
    // biceps tendon into the elbow crease, and the crease
    const bt = [around(SH, EL, 0.8, 5 * deg), around(SH, EL, 0.96, -5 * deg)].filter(Boolean);
    if (bt.length > 1) add_({ name: 'bicepsTendon', pts: bt, w: 0.0045 * k, amp: 0.0018, prof: 'round', vis: ['tendon', 0.006], regs: RG.arm, sgn: s });
    const ec = [-55, -20, 15, 50].map(a => around(SH, EL, 1.0, a * deg)).filter(Boolean);
    if (ec.length > 1) add_({ name: 'elbowCrease', pts: ec, w: 0.0028 * k, amp: -0.0012, prof: 'sharp', crease: true, vis: ['crease'], regs: RG.arm, sgn: s });
    add_({ name: 'olecranon', pts: [lm('olecranon' + X)], w: 0.011 * k, amp: 0.0035, prof: 'round', vis: ['bone', 0.009], regs: RG.arm, sgn: s, face: 0 });
    for (const e of ['latEpicondyle', 'medEpicondyle']) add_({ name: e, pts: [lm(e + X)], w: 0.008 * k, amp: 0.0022, prof: 'round', vis: ['bone', 0.007], regs: RG.arm, sgn: s, face: 0 });
    // forearm and hand: the palm's normal at the bind pose (hero.js's construction), the radial direction from the ulnar head to the radial styloid
    const fj = n_ => jt(n_ + '.' + X), aP = unit(sub(fj('finger5-1'), fj('finger2-1'))), fF = unit(sub(fj('finger3-1'), WR)); let pn = unit(cross(fF, aP));
    if (dot(sub(jt('finger1-3.' + X), fj('finger2-1')), pn) < 0) pn = mul(pn, -1);                   // pn: toward the palm side
    const uF = unit(sub(WR, EL)), palm = perp(pn, uF), rad = perp(sub(lm('radialStyloid' + X), lm('ulnarHead' + X)), uF);
    const fa = (t, a) => around(EL, WR, t, a * deg, palm, rad);                                         // a: 0 palmar, 90 radial, 180 dorsal, -90 ulnar
    for (const [nm, a0, a1, t0, t1, w, amp] of [['palmarisLongus', 0, 0, 0.6, 0.97, 0.0026, 0.0013], ['flexorCarpiRadialis', 28, 24, 0.58, 0.97, 0.003, 0.0014], ['flexorCarpiUlnaris', -78, -72, 0.55, 0.96, 0.0038, 0.0012]]) {
      const q = [fa(t0, a0), fa((t0 + t1) / 2, (a0 + a1) / 2), fa(t1, a1)].filter(Boolean); if (q.length > 1) add_({ name: nm, pts: q, w: w * k, amp, prof: 'round', env: [[0, 0.3], [0.5, 1], [1, 0.9]], vis: ['tendon', 0.0045], regs: RG.farm, sgn: s }); }
    add_({ name: 'ulnarHead', pts: [lm('ulnarHead' + X)], w: 0.0075 * k, amp: 0.0026, prof: 'round', vis: ['bone', 0.006], regs: RG.farm, sgn: s, face: 0 });
    add_({ name: 'radialStyloid', pts: [lm('radialStyloid' + X)], w: 0.0065 * k, amp: 0.0015, prof: 'round', vis: ['bone', 0.006], regs: RG.farm, sgn: s, face: 0 });
    const dors = mul(pn, -1), wd = sp(sub(WR, mul(dors, 0.0)), dors, RG.hand.concat([R.farm]), 0.4);
    for (const f of [2, 3, 4, 5]) { const kn = sp(fj('finger' + f + '-1'), add(dors, mul(fF, 0.25)), [R.hand, R.finger], 0.35); if (!kn) continue;
      add_({ name: 'knuckle' + f, pts: [kn], w: 0.0068 * k, amp: 0.0022, prof: 'round', vis: ['bone', 0.005], regs: [R.hand, R.finger], sgn: s, face: 0 });
      if (wd) { const a = lerp(wd, kn, 0.12), b = lerp(wd, kn, 0.85), mid = lerp(wd, kn, 0.5); const q = [a, sp(add(mid, mul(dors, -0.02)), dors, [R.hand], 0.4) || mid, b];
        add_({ name: 'extensorTendon' + f, pts: q, w: 0.0026 * k, amp: 0.0011, prof: 'round', env: [[0, 0.5], [0.4, 1], [1, 0.8]], vis: ['tendon', 0.0045], regs: [R.hand], sgn: s }); } }
    // ---- chest and abdomen (left side)
    const cmPts = [add(XY, [s * 0.012 * k, 0.004, 0]), sp(add(XY, [s * 0.055 * k, -0.04 * k, -0.08]), F, RG.trunk), sp(add(XY, [s * 0.095 * k, -0.08 * k, -0.08]), [s * 0.5, 0, 1], RG.trunk), lm('rib10' + X)].filter(Boolean);
    add_({ name: 'costalMargin', pts: cmPts, w: 0.0085 * k, amp: 0.0022, prof: 'round', vis: ['bone', 0.006], regs: RG.trunk, sgn: s });
    const ls = [sp(add(XY, [s * 0.068 * k, -0.04 * k, -0.08]), F, RG.trunk), sp(add(OM, [s * 0.072 * k, 0, -0.08]), F, RG.trunk), sp(add(PU, [s * 0.035 * k, 0.035 * k, -0.08]), F, RG.trunk)].filter(Boolean);
    add_({ name: 'semilunaris', pts: ls, w: 0.01 * k, amp: -0.0024, prof: 'round', vis: ['musc', 0.01, ['rectusAbd', 'oblique']], regs: RG.trunk, sgn: s });
    for (const [f, rise, amp] of [[0.14, 0.01, 0.0019], [0.52, 0.008, 0.0019], [0.97, 0.004, 0.0015]]) { const y = XY[1] + (OM[1] - XY[1]) * f;
      const q = [sp([s * 0.006 * k, y, -0.02], F, RG.trunk), sp([s * 0.036 * k, y + rise * 0.3 * k, -0.02], F, RG.trunk), sp([s * 0.066 * k, y + rise * k, -0.02], F, RG.trunk)].filter(Boolean);
      if (q.length > 1) add_({ name: 'rectusIntersection', pts: q, w: 0.0075 * k, amp: -amp, prof: 'round', vis: ['musc', 0.009, ['rectusAbd']], regs: RG.trunk, sgn: s }); }
    const asis = lm('asis' + X), ic = lm('iliacCrest' + X), psis = lm('psis' + X);
    add_({ name: 'asis', pts: [asis], w: 0.011 * k, amp: 0.0028, prof: 'round', vis: ['bone', 0.006], regs: RG.pelvis, sgn: s, face: 0 });
    const crest = [asis, sp(add(lerp(asis, ic, 0.5), [s * 0.0, 0.006 * k, -0.06]), [s, 0, 0.8], RG.pelvis), ic, sp(add(lerp(ic, psis, 0.5), [0, 0.008 * k, 0.04]), [s * 0.8, 0, -1], RG.pelvis), psis].filter(Boolean);
    add_({ name: 'iliacCrest', pts: crest, w: 0.0085 * k, amp: 0.0018, prof: 'round', vis: ['bone', 0.005], regs: RG.pelvis, sgn: s, face: 0 });
    add_({ name: 'iliacFurrow', pts: crest.slice(0, 4).map(q => add(q, [0, -0.006 * k, 0])), w: 0.008 * k, amp: -0.0026, prof: 'round', vis: ['musc', 0.01, ['oblique']], regs: RG.pelvis, sgn: s, face: 0 });
    const pt = sp(add(PU, [s * 0.03 * k, 0.012 * k, -0.08]), F, RG.pelvis);
    if (pt) { add_({ name: 'inguinalLine', pts: [add(asis, [-s * 0.004, -0.01 * k, 0]), lerp(asis, pt, 0.5), pt], w: 0.0085 * k, amp: -0.0026, prof: 'round', vis: ['musc', 0.009, ['oblique', 'rectusAbd']], regs: RG.pelvis, sgn: s });
      add_({ name: 'inguinalFold', pts: [add(asis, [-s * 0.01, -0.03 * k, 0]), lerp(add(asis, [0, -0.03 * k, 0]), pt, 0.5), add(pt, [0, -0.008 * k, 0])], w: 0.0045 * k, amp: 0.0042, prof: 'fold', roll: [0, 1, 0.3], vis: ['fold', 0.016, 0.02], regs: RG.pelvis.concat([R.thigh]), sgn: s }); }
    // serratus digitations: four short oblique bellies on the side of the chest below the axilla
    const ax = lm('axillaFront' + X), r10 = lm('rib10' + X);
    for (let i = 0; i < 4; i++) { const c = sp(add(lerp(add(ax, [s * 0.005, -0.045 * k, -0.035 * k]), add(r10, [s * 0.01, 0.075 * k, -0.02 * k]), (i + 0.5) / 4), [-s * 0.08, 0, -0.04]), [s, 0, 0.55], RG.torso);
      if (c) add_({ name: 'serratus', pts: [c], ab: [0.02 * k, 0.0085 * k], dir: unit([-s * 0.3, -1, 0.85]), amp: 0.0016, prof: 'round', vis: ['musc', 0.008, ['serratus']], regs: RG.torso, sgn: s }); }
    // ---- back
    const sr = lm('scapRoot' + X), si = lm('scapInf' + X), axb = lm('axillaBack' + X);
    add_({ name: 'scapSpine', pts: [add(ac, [-s * 0.012, -0.004, -0.012]), lerp(ac, sr, 0.5), sr], w: 0.0085 * k, amp: 0.0025, prof: 'round', vis: ['bone', 0.007], regs: RG.torso.concat([R.uarm]), sgn: s, face: 0 });
    add_({ name: 'scapBorder', pts: [sr, lerp(sr, si, 0.5), si], w: 0.008 * k, amp: 0.002, prof: 'round', vis: ['bone', 0.007], regs: RG.torso, sgn: s, face: 0 });
    add_({ name: 'scapAngle', pts: [si], w: 0.012 * k, amp: 0.0022, prof: 'round', vis: ['bone', 0.007], regs: RG.torso, sgn: s, face: 0 });
    const isp = sp(add(mul(add(add(sr, si), axb), 1 / 3), [0, 0.01 * k, 0.06]), BK, RG.torso);
    if (isp) add_({ name: 'infraspinatus', pts: [isp], ab: [0.04 * k, 0.026 * k], dir: unit(sub(ac, sr)), amp: 0.0025, prof: 'round', vis: ['musc', 0.01, ['trapMid', 'latissimus']], regs: RG.torso, sgn: s });
    add_({ name: 'teresMajor', pts: [add(si, [s * 0.008, 0.008, 0]), lerp(si, axb, 0.55), add(axb, [-s * 0.004, 0.01, 0])], w: 0.013 * k, amp: 0.0026, prof: 'round', env: [[0, 0.6], [0.5, 1], [1, 0.7]], vis: ['musc', 0.01, ['latissimus']], regs: RG.torso.concat([R.uarm]), sgn: s });
    add_({ name: 'sacralDimple', pts: [psis], w: 0.009 * k, amp: -0.004, prof: 'round', vis: ['bone', 0.013], regs: RG.pelvis, sgn: s, face: 0 });
    // the bra-line and waist-back rolls (adiposity), the flank crease
    const bra = [0.02, 0.07, 0.115, 0.14].map((x, i) => sp([s * x * k, scapInfY - 0.022 * k, 0], [s * (i > 2 ? 0.8 : 0.15), 0, -1], RG.torso)).filter(Boolean);
    if (bra.length > 1) add_({ name: 'braRoll', pts: bra, w: 0.004 * k, amp: 0.004, prof: 'fold', roll: [0, 1, 0], vis: ['fold', 0.016, 0.02], regs: RG.torso, sgn: s });
    const wb = [0.025, 0.07, 0.11].map((x, i) => sp([s * x * k, ic[1] + 0.03 * k, 0], [s * (i > 1 ? 0.8 : 0.2), 0, -1], RG.trunk)).filter(Boolean);
    if (wb.length > 1) add_({ name: 'waistBackRoll', pts: wb, w: 0.0045 * k, amp: 0.0045, prof: 'fold', roll: [0, 1, 0], vis: ['fold', 0.02, 0.02], regs: RG.trunk, sgn: s });
    const fl = [sp(add(ic, [-s * 0.03, -0.01 * k, 0.07]), [s * 0.5, 0, 1], RG.pelvis), sp(add(ic, [-s * 0.02, -0.012 * k, 0]), [s, 0, 0], RG.pelvis), sp(add(ic, [-s * 0.03, -0.01 * k, -0.07]), [s * 0.5, 0, -1], RG.pelvis)].filter(Boolean);
    if (fl.length > 1) add_({ name: 'flankCrease', pts: fl, w: 0.0045 * k, amp: 0.0045, prof: 'fold', roll: [0, 1, 0], vis: ['fold', 0.018, 0.02], regs: RG.pelvis, sgn: s });
    // ---- buttock and hip
    const gf = lm('gluteFold' + X), gfP = [sp([s * 0.025 * k, gf[1] + 0.006 * k, 0], BK, [R.pelvis, R.thigh]), gf, sp([s * 0.125 * k, gf[1] + 0.022 * k, 0], [s * 0.6, 0, -1], [R.pelvis, R.thigh])].filter(Boolean);
    if (gfP.length > 1) add_({ name: 'glutealFold', pts: gfP, w: 0.004 * k, amp: 0.0035, prof: 'fold', roll: [0, 1, 0], rollK: 0.35, env: [[0, 1], [0.6, 1], [1, 0.2]], taper: false, vis: ['gfold'], regs: [R.pelvis, R.thigh], sgn: s });
    const gh = sp(add(lm('trochanter' + X), [-s * 0.03, 0.012 * k, -0.035 * k]), [s, 0, -0.5], [R.pelvis, R.thigh]);
    if (gh) add_({ name: 'gluteHollow', pts: [gh], ab: [0.03 * k, 0.022 * k], dir: UP, amp: -0.0038, prof: 'round', vis: ['musc', 0.009, ['gluteMax', 'gluteMed']], regs: [R.pelvis, R.thigh], sgn: s });
    // ---- leg frame: u down the femur; forward and lateral as for the arm
    const HJ = jt('upperleg01.' + X), KN = jt('lowerleg01.' + X), AN = jt('foot.' + X), lu = unit(sub(KN, HJ)), lant = perp(F, lu), llat0 = cross(lu, lant), llat = llat0[0] * s > 0 ? llat0 : mul(llat0, -1);
    const lg = (a, b, t, ang) => around(a, b, t, ang * deg, lant, llat, LIMB.leg);                                   // ang: 0 front, 90 lateral, 180 back, -90 medial
    const pat = lm('patella' + X), tt = lm('tibialTub' + X);
    add_({ name: 'patella', pts: [add(pat, [0, 0.009 * k, 0]), add(pat, [0, -0.007 * k, 0])], w: 0.021 * k, amp: 0.0034, prof: 'plateau', taper: false, vis: ['bone', 0.009], regs: RG.knee, sgn: s, face: 0 });
    add_({ name: 'quadTendon', pts: [add(pat, [0, 0.03 * k, 0]), add(pat, [0, 0.065 * k, 0])].map(q => sp(add(q, [0, 0, -0.06]), F, RG.knee) || q), w: 0.012 * k, amp: 0.0012, prof: 'round', vis: ['tendon', 0.006], regs: RG.knee, sgn: s });
    add_({ name: 'patellarLigament', pts: [add(pat, [0, -0.026 * k, 0]), tt], w: 0.0075 * k, amp: 0.0018, prof: 'round', vis: ['tendon', 0.008], regs: RG.knee, sgn: s });
    for (const sx of [1, -1]) { const q = sp(add(lerp(pat, tt, 0.35), [s * sx * 0.019 * k, -0.004, -0.05]), [s * sx * 0.4, 0, 1], RG.knee); if (q) add_({ name: 'infrapatellarPad', pts: [q], w: 0.012 * k, amp: 0.0016, prof: 'round', vis: ['const'], regs: RG.knee, sgn: s }); }
    add_({ name: 'tibialTuberosity', pts: [tt], w: 0.0095 * k, amp: 0.002, prof: 'round', vis: ['bone', 0.007], regs: RG.shin, sgn: s, face: 0 });
    const mm = lm('medMalleolus' + X), lmal = lm('latMalleolus' + X);
    const tc = [add(tt, [0, -0.02 * k, 0]), lg(KN, AN, 0.35, -12), lg(KN, AN, 0.62, -25), lg(KN, AN, 0.85, -42), add(mm, [0, 0.04 * k, 0.006])].filter(Boolean);
    add_({ name: 'tibialCrest', pts: tc, w: 0.0075 * k, amp: 0.0022, prof: 'sharp', env: [[0, 1], [0.7, 0.9], [1, 0.4]], vis: ['bone', 0.005], regs: RG.shin, sgn: s, face: -0.1 });
    add_({ name: 'medMalleolus', pts: [mm], w: 0.0125 * k, amp: 0.0042, prof: 'round', vis: ['bone', 0.009], regs: RG.foot, sgn: s, face: -0.1 });
    add_({ name: 'latMalleolus', pts: [lmal], w: 0.0115 * k, amp: 0.0036, prof: 'round', vis: ['bone', 0.009], regs: RG.foot, sgn: s, face: -0.1 });
    const hl = lm('heel' + X), ach = [sp(add(hl, [0, 0.035 * k, 0.05]), BK, RG.foot), lg(KN, AN, 0.82, 180), lg(KN, AN, 0.62, 178)].filter(Boolean);
    if (ach.length > 1) { add_({ name: 'achilles', pts: ach, w: 0.0065 * k, wenv: [[0, 1.15], [0.5, 1], [1, 1.5]], amp: 0.003, prof: 'round', env: [[0, 0.8], [0.4, 1], [1, 0.35]], vis: ['tendon', 0.007], regs: RG.shin, sgn: s, face: -0.1 });
      for (const [mal, sx] of [[mm, -1], [lmal, 1]]) { const q = sp(add(lerp(mal, ach[0], 0.5), [0, 0.012 * k, 0]), [s * sx * 0.6, 0, -0.8], RG.foot); if (q) add_({ name: 'retromalleolar', pts: [add(q, [0, -0.008 * k, 0]), add(q, [0, 0.022 * k, 0])], w: 0.008 * k, amp: -0.0028, prof: 'round', vis: ['bone', 0.008], regs: RG.shin.concat([R.foot]), sgn: s }); } }
    const kb = lm('kneeBack' + X);
    add_({ name: 'popliteal', pts: [kb], ab: [0.032 * k, 0.014 * k], dir: UP, amp: -0.003, prof: 'round', vis: ['musc', 0.012, ['hamstrings', 'gastroc'], 0.3], regs: RG.knee, sgn: s });
    add_({ name: 'poplitealCrease', pts: [-60, -20, 20, 60].map(a => lg(HJ, KN, 1.0, 180 + a)).filter(Boolean), w: 0.0026 * k, amp: -0.0011, prof: 'sharp', crease: true, vis: ['crease'], regs: RG.knee, sgn: s, face: 0 });
    for (const [nm, a0, a1] of [['bicepsFemorisTendon', 140, 112], ['semitendinosusTendon', -145, -122]]) { const q = [lg(HJ, KN, 0.72, a0), lg(HJ, KN, 0.9, (a0 + a1) / 2), lg(HJ, KN, 1.04, a1)].filter(Boolean);
      if (q.length > 1) add_({ name: nm, pts: q, w: 0.0065 * k, amp: 0.002, prof: 'round', env: [[0, 0.4], [0.5, 1], [1, 0.8]], vis: ['tendon', 0.008], regs: RG.knee, sgn: s, face: -0.1 }); }
    const itb = [0.22, 0.5, 0.82].map(t => lg(HJ, KN, t, 102)).filter(Boolean);
    if (itb.length > 1) add_({ name: 'itBandGroove', pts: itb, w: 0.0095 * k, amp: -0.0024, prof: 'round', vis: ['musc', 0.011, ['vastusLat', 'hamstrings']], regs: RG.thigh, sgn: s, face: -0.1 });
    const sart = [sp(add(asis, [-s * 0.006, -0.045 * k, -0.06]), [s * 0.2, 0, 1], [R.pelvis, R.thigh]), lg(HJ, KN, 0.4, -38), lg(HJ, KN, 0.72, -70), lg(HJ, KN, 0.97, -100)].filter(Boolean);
    if (sart.length > 1) add_({ name: 'sartoriusLine', pts: sart, w: 0.009 * k, amp: -0.0022, prof: 'round', vis: ['musc', 0.011, ['rectusFem', 'vastusMed', 'adductors']], regs: RG.thigh.concat([R.pelvis]), sgn: s, face: -0.1 });
  }
  // abdominal folds (adiposity): at the navel and above the pubis, across both sides, the roll above each crease
  const nf = [-0.12, -0.06, 0, 0.06, 0.12].map(x => sp([x * k, OM[1] - 0.008 * k + Math.abs(x) * 0.12, -0.02], [x * 3, 0, 1], RG.trunk)).filter(Boolean);
  if (nf.length > 2) add_({ name: 'navelFold', pts: nf, w: 0.0045 * k, amp: 0.0045, prof: 'fold', roll: [0, 1, 0.2], vis: ['fold', 0.02, 0.025], regs: RG.trunk });
  const pf = [-0.11, -0.055, 0, 0.055, 0.11].map(x => sp([x * k, PU[1] + 0.03 * k + Math.abs(x) * 0.25, -0.02], [x * 3, -0.2, 1], RG.trunk)).filter(Boolean);
  if (pf.length > 2) add_({ name: 'suprapubicFold', pts: pf, w: 0.005 * k, amp: 0.006, prof: 'fold', roll: [0, 1, 0.3], rollK: 0.6, vis: ['fold', 0.022, 0.03], regs: RG.trunk.concat([R.thigh]) });
  return out;
}

// ---------------------------------------------------------------- the person's visibility laws
function visLaws(C, mus) {
  const { T } = C, p = C.p, lax = clamp(p.params.laxity || 0, 0, 1.2), old = clamp((p.age - 35) / 45);
  return (v, cv) => { const V = cv.vis || ['const'], t = T[v];
    switch (V[0]) {
      case 'bone': return Math.exp(-t / V[1]) * C.o.bone * (V[2] === 'age' ? 1 + 0.6 * old : 1);
      case 'tendon': return Math.exp(-t / V[1]) * C.o.bone;
      case 'musc': { const m = V[2] ? V[2].reduce((a, nm) => a + mus(nm), 0) / V[2].length : 1; return Math.max(V[3] || 0, Math.exp(-t / (0.6 * V[1]))) * clamp(m, 0.25, 2.2) * C.o.define; }
      case 'fold': return clamp((t - V[1]) / V[2], 0, 1.6) * (1 + 0.8 * lax) * C.o.folds;
      case 'gfold': return (0.35 + clamp((t - 0.008) / 0.02, 0, 1.4) + 0.6 * lax) * C.o.folds;
      case 'crease': return (0.7 + 0.6 * lax) * (1 + clamp(t / 0.015)) * C.o.creases;
      default: return 1;
    } };
}
// the gradient magnitude of a per-vertex scalar (piecewise linear on the triangles), area-weighted onto vertices
function gradMag(C, f) {
  const { P, I, n } = C, g = new Float32Array(n), w = new Float32Array(n);
  for (let t = 0; t < I.length; t += 3) { const a = I[t], b = I[t + 1], c = I[t + 2]; const fa = f[a], fb = f[b], fc = f[c]; if (fa === fb && fb === fc) continue;
    const pa = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]], e1 = sub([P[b * 3], P[b * 3 + 1], P[b * 3 + 2]], pa), e2 = sub([P[c * 3], P[c * 3 + 1], P[c * 3 + 2]], pa), nn = cross(e1, e2), A2 = len(nn); if (A2 < 1e-12) continue;
    const nu = mul(nn, 1 / A2), gr = mul(add(mul(cross(nu, e2), -(fb - fa)), mul(cross(nu, e1), fc - fa)), 1 / A2), gm = len(gr) * 0 + Math.hypot(...gr), ar = A2 / 2;
    g[a] += gm * ar; g[b] += gm * ar; g[c] += gm * ar; w[a] += ar; w[b] += ar; w[c] += ar; }
  for (let v = 0; v < n; v++) g[v] = w[v] ? g[v] / w[v] : 0; return g;
}

// ---------------------------------------------------------------- veins (curves -> per-vertex signed distance for the shader) and cellulite mask
function veinCurves(C) {
  const { jt, lm, pick } = C, out = [], deg = Math.PI / 180, F = [0, 0, 1], seed = C.o.seed ?? (C.p.spec?.seed ?? 1);
  let st = (seed * 9301 + 49297) % 233280; const rnd = () => (st = (st * 9301 + 49297) % 233280) / 233280 - 0.5;
  const sp = (a, d, regs) => { try { return pick(a, d, regs, 0.35); } catch { return null; } };
  for (const s of [1, -1]) {
    const X = s > 0 ? 'L' : 'R', EL = jt('lowerarm01.' + X), WR = jt('wrist.' + X), SH = jt('upperarm01.' + X), fj = n_ => jt(n_ + '.' + X);
    const aP = unit(sub(fj('finger5-1'), fj('finger2-1'))), fF = unit(sub(fj('finger3-1'), WR)); let pn = unit(cross(fF, aP)); if (dot(sub(jt('finger1-3.' + X), fj('finger2-1')), pn) < 0) pn = mul(pn, -1);
    const uF = unit(sub(WR, EL)), palm = perp(pn, uF), rad = perp(sub(lm('radialStyloid' + X), lm('ulnarHead' + X)), uF);
    const ar = (a, b, t, ang, A, Lt, regs = [R.uarm, R.farm, R.hand]) => { const ax = unit(sub(b, a)), aa = perp(A, ax), ll = perp(Lt, ax), d = add(mul(aa, Math.cos(ang)), mul(ll, Math.sin(ang))); return sp(lerp(a, b, t), d, regs); };
    const fa = (t, a) => ar(EL, WR, t, (a + 9 * rnd()) * deg, palm, rad);
    const u = unit(sub(EL, SH)), ant = perp(F, u), lat0 = cross(u, ant), lat = lat0[0] * s > 0 ? lat0 : mul(lat0, -1), ua = (t, a) => ar(SH, EL, t, (a + 8 * rnd()) * deg, ant, lat);
    const V = (name, pts, r, k = 1) => { pts = pts.filter(Boolean); if (pts.length > 1) out.push({ name, pts, w: r, k, sgn: s }); };
    // forearm (0 palmar, 90 radial, 180 dorsal): cephalic up the radial border, basilic up the ulnar, the median antebrachial, the median cubital across the elbow
    // a vein meanders: knots (t along the forearm, angle) sampled every 4 % of its length with a seeded wobble of a few degrees
    const run = (knots_, fn, jit = 7) => { const pts = []; for (let i = 0; i < knots_.length - 1; i++) { const [t0, a0] = knots_[i], [t1, a1] = knots_[i + 1], m = Math.max(1, Math.round(Math.abs(t1 - t0) / 0.04));
      for (let j = 0; j < m; j++) { const u = j / m; pts.push(fn(t0 + (t1 - t0) * u, a0 + (a1 - a0) * u + jit * Math.sin(7.3 * (t0 + (t1 - t0) * u) + seed) * 0.6 + jit * rnd() * 0.6)); } }
      const l = knots_[knots_.length - 1]; pts.push(fn(l[0], l[1])); return pts; };
    const faR = (t, a) => ar(EL, WR, t, a * deg, palm, rad), uaR = (t, a) => ar(SH, EL, t, a * deg, ant, lat);
    V('cephalic', [...run([[1.0, 140], [0.75, 110], [0.45, 85], [0.15, 62], [0.0, 52]], faR), ...run([[0.9, 62], [0.6, 70]], uaR, 4)], 0.0024);
    V('basilic', [...run([[1.0, -150], [0.7, -118], [0.4, -95], [0.1, -70], [0.0, -58]], faR), ...run([[0.9, -75], [0.75, -80]], uaR, 4)], 0.0024);
    V('medianAntebrachial', run([[0.92, 8], [0.6, 2], [0.3, -6], [0.05, -25]], faR, 9), 0.0019, 0.7);
    V('medianCubital', [...run([[0.14, 55], [0.0, 20]], faR, 5), ...run([[0.95, -25], [0.88, -60]], uaR, 4)], 0.0026);
    // the back of the hand: from between the knuckles toward the wrist, joining a dorsal arch
    const dors = mul(pn, -1), kj = x => { const a = Math.min(5, Math.max(2, Math.floor(x))), b = Math.min(5, a + 1); return lerp(fj('finger' + a + '-1'), fj('finger' + b + '-1'), x - a); },
      hp = (f, t) => { const a = lerp(kj(f + 0.5), WR, t); return sp(sub(a, mul(dors, 0.04)), dors, [R.hand]); };
    for (const f of [2, 3, 4]) V('dorsalMetacarpal' + f, [hp(f, 0.12), hp(f, 0.45), hp(f + (f < 4 ? 0.3 : -0.3), 0.75)], 0.0017, 0.8);
    V('dorsalArch', [hp(2, 0.62), hp(3, 0.7), hp(4, 0.66)], 0.0018, 0.8);
    // leg: the great saphenous in front of the medial malleolus and up the medial shin; the dorsal arch of the foot
    const HJ = jt('upperleg01.' + X), KN = jt('lowerleg01.' + X), AN = jt('foot.' + X), lu = unit(sub(AN, KN)), lant = perp(F, lu), ll0 = cross(lu, lant), llat = ll0[0] * s > 0 ? ll0 : mul(ll0, -1);
    const sh = (t, a) => ar(KN, AN, t, (a + 8 * rnd()) * deg, lant, llat, [R.shin, R.foot, R.thigh]);
    V('greatSaphenous', [sp(add(lm('medMalleolus' + X), [0, 0.0, 0.03]), [-s * 0.3, 0, 1], [R.foot, R.shin]), sh(0.9, -55), sh(0.65, -95), sh(0.35, -115), sh(0.08, -125)], 0.0026);
    const toe = jt('toe3-1.' + X), fp = (x, t) => { const a = lerp(add(AN, [s * x, 0, 0]), toe, t); return sp(add(a, [0, 0.06, 0]), [0, -1, 0.3], [R.foot]); };
    V('dorsalFootArch', [fp(-0.025, 0.55), fp(0.0, 0.62), fp(0.025, 0.55)], 0.0018, 0.8);
    V('dorsalFootMedial', [fp(-0.025, 0.55), fp(-0.03, 0.25), sp(add(lm('medMalleolus' + X), [0, -0.01, 0.025]), [-s * 0.3, 0, 1], [R.foot])], 0.002, 0.8);
    void HJ;
  }
  return out;
}

// ---------------------------------------------------------------- the shader part (micro relief, flexion bulges); chained after whatever is there
const VERT_PARS = `attribute vec4 aDetM, aDetF; varying vec4 vDetM; uniform vec3 uFlexL, uFlexR;`;
const VERT = `vDetM = aDetM; transformed += normal * dot(aDetF.xyz, aHero.z > 0.0 ? uFlexL : uFlexR);`;
const FRAG_PARS = `varying vec4 vDetM; uniform float uDetScale, uDetVein, uDetCell, uDetOn;
float dtH(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
vec3 dtH3(vec3 p){ return fract(sin(vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)))) * 43758.5453); }
vec2 dtWorley(vec3 x){ vec3 i = floor(x), f = fract(x); float d1 = 9.0, d2 = 9.0;
  for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) for (int c = -1; c <= 1; c++) { vec3 o = vec3(float(a), float(b), float(c)), q = o + 0.15 + 0.7 * dtH3(i + o) - f; float e = dot(q, q);
    if (e < d1) { d2 = d1; d1 = e; } else if (e < d2) d2 = e; }
  return vec2(sqrt(d1), sqrt(d2)); }
float dtNoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dtH(i), dtH(i + vec3(1,0,0)), f.x), mix(dtH(i + vec3(0,1,0)), dtH(i + vec3(1,1,0)), f.x), f.y), mix(mix(dtH(i + vec3(0,0,1)), dtH(i + vec3(1,0,1)), f.x), mix(dtH(i + vec3(0,1,1)), dtH(i + vec3(1,1,1)), f.x), f.y), f.z); }
float detailH(vec3 b){ float h = 0.0;
  if (vDetM.y > 0.002) { float r = max(vDetM.z, 1e-4), y = vDetM.x / r, c = clamp(1.0 - y * y, 0.0, 1.0); h += uDetVein * vDetM.y * c * sqrt(c) * r * 0.5; }
  if (vDetM.w > 0.01) { // the dimples where fibrous septa tether the skin between fat lobules: soft, irregular, 1-2.5 cm, a few tenths of a mm deep
    float nz = 0.62 * dtNoise(b * vec3(34.0, 25.0, 34.0)) + 0.38 * dtNoise(b * vec3(78.0, 60.0, 78.0) + 3.1);
    h -= uDetCell * vDetM.w * 0.0009 * smoothstep(0.48, 0.8, nz); }
  return h; }`;
const NORMAL = `
// integration v3: no varying in the condition (derivatives in uniform flow: the V100s drew 1-px lines along the vein bands); detailH is 0
// outside its bands, so the normal is unchanged there
if (uDetOn > 0.5) { float Hd = detailH(vBind) * uDetScale; vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
  vec2 dH = vec2(dFdx(Hd), dFdy(Hd)); vec3 R1 = cross(dpy, normal), R2 = cross(normal, dpx); float det = dot(dpx, R1) * faceDirection;
  vec3 gr = sign(det) * (dH.x * R1 + dH.y * R2); vec3 np = normalize(abs(det) * normal - gr); if (!any(isnan(np))) normal = np; }`;
function patchMaterial(h, U) {
  const mat = h.body.material, prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.onBeforeCompile = (sh, r) => { prev?.(sh, r); Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_PARS).replace('#include <morphtarget_vertex>', '#include <morphtarget_vertex>\n' + VERT);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_PARS).replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + NORMAL); };
  mat.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|p1-detail';
  mat.needsUpdate = true;
}

// ---------------------------------------------------------------- apply
export function applyDetail(h, p, opts = {}) {
  const o = { ...DETAIL_DEFAULTS, ...opts }, t0 = performance.now(), ms = {};
  if (!p || !p.built || !p._S) throw new Error('applyDetail: a body-studio person (castBody / loadCast) is needed: its frame, muscles and fat drive the detail');
  if (h.detail) h.detail.dispose?.();
  let t = performance.now();
  if (o.level) subdivideHero(h, { levels: o.level, compensate: o.compensate, morphs: o.morphs }); else setBodyLevel(h, 0);
  ms.subdiv = Math.round(performance.now() - t); t = performance.now();
  const C = makeContext(h, p, o), { n, P, N, T, area } = C, D = new Float32Array(n), S = C.S, B = C.B;
  ms.context = Math.round(performance.now() - t); t = performance.now();
  const musA = p.params.muscle || {}, mus = nm => (musA[nm] ?? MUS_REF[nm] ?? 0.003) / (MUS_REF[nm] || 0.003);
  const regOK = o.regions ? new Set(o.regions) : null;
  // 0. lane A's relief layer is replaced at resolution (it was the base mesh's soft version of the same forms): its displacement, removed
  // (FORM, 3 Oct: the same visibility function as mix.js, so a form-1 body's relief is removed exactly; form 0 unchanged)
  const rel = new Float32Array(C.n0); { const rk = p.params.relief ?? 1, base0 = reliefBase(p.params), fm = p.params.form || 0;
    if (rk) for (const name of S.fieldsOf('relief')) { if (name === 'submentalFold') continue; const fl = S.field(name), m = fl.meta, amp = m.amp * rk * (p.params.reliefK?.[name] ?? 1);
      for (let i = 0; i < fl.ix.length; i++) { const v = fl.ix[i]; if (v >= C.nb) continue; const te = B.T[v] + base0, mod = reliefMod(m.mode, te, fm); rel[v] += amp * fl.f[i] * mod; } } }
  const relS = C.up(rel); for (let v = 0; v < n; v++) D[v] -= relS[v];
  // 1. muscle definition (volume-kept re-shaping of each fitted belly)
  const flexE = new Float32Array(n), flexK = new Float32Array(n), flexA = new Float32Array(n);
  const F1 = (p.params.form || 0) >= 1, Dg = new Float32Array(n);
  for (const [nm, m] of Object.entries(musA)) { if (!m) continue; const f0 = S.dense(nm); if (!f0) continue; const f = C.up(f0), gm = gradMag(C, f), cr = new Float32Array(n), gm7 = GIRDLE_MUS.has(nm);
    // what the base mesh carries for this belly: the raw field (form 0) or its low-pass + gated definition (form 1, mix.js muscleField)
    let fb = f; if (F1) { const mb = muscleField(S, p.params, nm, B.T), b0 = new Float32Array(C.n0); b0.set(mb.subarray(0, Math.min(C.n0, mb.length))); fb = C.up(b0); }
    let sf = 0, sc = 0;
    for (let v = 0; v < n; v++) { const fv = f[v]; if (fv <= 0.01) continue; const se = 0.005 + 0.7 * T[v], dl = clamp(se * gm[v], 0.08, 0.45); cr[v] = sst(0.5 - dl, 0.5 + dl, fv) * (0.6 + 0.4 * sst(0.35, 1, fv)); sf += fb[v] * area[v]; sc += cr[v] * area[v]; }
    const c = sc > 0 ? sf / sc : 1;
    for (let v = 0; v < n; v++) { const fv = f[v]; if (fv <= 0.01 && !cr[v]) continue; const vis = Math.exp(-T[v] / 0.006) * o.define, dd = Math.min(m, MDEF_CAP) * vis * (c * cr[v] - fb[v]); D[v] += dd; if (gm7) Dg[v] += dd;
      if (nm === 'biceps') flexE[v] += 0.009 * clamp(mus(nm), 0.3, 2.5) * cr[v]; else if (nm === 'triceps') flexE[v] -= 0.004 * clamp(mus(nm), 0.3, 2.5) * cr[v];
      else if (nm === 'hamstrings') flexK[v] += 0.006 * clamp(mus(nm), 0.3, 2.5) * cr[v]; else if (nm === 'rectusFem' || nm === 'vastusLat' || nm === 'vastusMed') flexK[v] -= 0.002 * clamp(mus(nm), 0.3, 2.5) * cr[v];
      else if (nm === 'gastroc' || nm === 'soleus') flexA[v] += 0.007 * clamp(mus(nm), 0.3, 2.5) * cr[v]; } }
  ms.muscle = Math.round(performance.now() - t); t = performance.now();
  // 2-4. bone, tendon, separations, folds and creases as surface curves
  const vis = visLaws(C, mus); let curves = [];
  const skip = new Set(typeof o.skip === 'string' ? o.skip.split(',') : o.skip || []);
  for (const sp of anatomy(C)) { if (skip.has(sp.name)) continue; try { curves.push(curve(C, sp)); } catch (e) { (C.warn ||= []).push(sp.name + ': ' + e.message); } }
  { const Dc = new Float32Array(n); for (const cv of curves) { if (GIRDLE_CURVES.has(cv.name)) evalCurve(C, cv, Dc, vis); else evalCurve(C, cv, D, vis); }
    for (let v = 0; v < n; v++) if (Dc[v]) { D[v] += Dc[v]; Dg[v] += Dc[v]; } }
  // the inframammary fold: on the breast field's lower contour (women; men with chest fat)
  { const br = p.params.breast, chest = p.params.fat?.chestFat || 0, mound = S.dense('breastMound'), foot = S.dense('breastFoot');
    const depth = p.sex === 'f' && br ? 0.0015 + 0.0035 * clamp((p.breast?.measured?.diffMl ?? p.breast?.volumeMl ?? 400) / 900, 0.15, 1.6) * (1 + 0.6 * clamp(p.breast?.grade ?? 1, 0, 3) / 3) : clamp((chest - 0.004) / 0.02, 0, 1) * 0.004;
    if (depth > 0) { const f = C.up(foot), gm = gradMag(C, f), nipY = (C.lm('nippleL')[1] + C.lm('nippleR')[1]) / 2, lv = 0.32;
      for (let v = 0; v < n; v++) { if (f[v] < 0.05 || C.region(v) !== R.torso) continue; if (P[v * 3 + 1] > nipY - 0.015 * C.k) continue; const g = Math.max(gm[v], 1); const d = (f[v] - lv) / g, w = Math.max(0.0035 * C.k, o.bandLimit * C.hv[v]);
        const under = sst(nipY - 0.02 * C.k, nipY - 0.05 * C.k, P[v * 3 + 1]), front = sst(-0.2, 0.3, N[v * 3 + 2]);
        D[v] += (-depth * Math.exp(-((d / w) ** 2)) * (0.0035 * C.k / w) + 0.3 * depth * (d > 0 ? Math.exp(-(((d - 2.4 * w) / (2 * w)) ** 2)) : 0)) * under * front * o.folds; } } void mound; }
  ms.curves = Math.round(performance.now() - t); t = performance.now();
  // other lanes' forms (P2's face)
  const ctx = { ...C, add: (v, x) => { D[v] += x; }, curve: sp => curve(C, sp), evalCurve: (cv, visFn) => evalCurve(C, cv, D, visFn || (() => 1)) };
  for (const e of _extra) { try { e.fn(ctx); } catch (err) { (C.warn ||= []).push(e.name + ': ' + err.message); } }
  // region filter (e.g. only the skin a garment leaves bare)
  if (regOK) for (let v = 0; v < n; v++) if (!regOK.has(C.region(v))) D[v] = 0;
  // displace along the subdivided normal; normals again
  const Dg3 = new Float32Array(3 * n); for (let v = 0; v < n; v++) if (Dg[v] && !(regOK && !regOK.has(C.region(v)))) { Dg3[v * 3] = Dg[v] * N[v * 3]; Dg3[v * 3 + 1] = Dg[v] * N[v * 3 + 1]; Dg3[v * 3 + 2] = Dg[v] * N[v * 3 + 2]; }
  let dmin = 0, dmax = 0; for (let v = 0; v < n; v++) { const d = D[v]; if (!d) continue; P[v * 3] += d * N[v * 3]; P[v * 3 + 1] += d * N[v * 3 + 1]; P[v * 3 + 2] += d * N[v * 3 + 2]; dmin = Math.min(dmin, d); dmax = Math.max(dmax, d); }
  C.g.attributes.position.needsUpdate = true; C.g.computeVertexNormals(); h.nrm = C.g.attributes.normal.array;
  ms.displace = Math.round(performance.now() - t); t = performance.now();
  // rev 7.6 (BODY7 c2 iteration 2): the nipple-areola complex in the geometry where anatomy puts it (body/nipple.js nippleRelief7: hm08's nipple
  // patch, collapsed by the learned prior bodies into a crumple of turned triangles at the fixed vertices, is laid out again on the chest's own
  // surface, and the areola and papilla are raised at nippleAt's point, the point SKIN7's painted areola reads). On by default for a REV 7 prior
  // record (p.prior.rev7, people7.json) only; o.nipple7: false switches it off, an object passes options (e.g. { relief: false }); v6 untouched.
  let nac = null; { const on = o.nipple7 ?? !!(p.prior?.rev7 && p.priorVA);
    if (on) { try { nac = nippleRelief7(h, { sex: p.sex, scale: 1 / (h.scale || 1), ...(typeof on === 'object' ? on : {}) }); if (nac) { delete nac.nipple; ms.nipple7 = nac.ms; } } catch (e) { (C.warn ||= []).push('nipple7: ' + (e.message || e)); } } }
  t = performance.now();
  // 5. micro relief attributes (veins, cellulite) and 6. flexion bulges
  const aM = new Float32Array(n * 4), aF = new Float32Array(n * 4);
  if (o.micro) {
    const age = p.age, sexK = p.sex === 'm' ? 1 : 0.6, old = clamp((age - 30) / 45), strong = clamp(1 + 0.25 * (p.targets?.zAlmi || 0), 0.7, 1.8), vK = o.veins * sexK * (0.75 + 0.6 * old) * strong;
    if (vK > 0) { const vc = veinCurves(C).map(sp => { try { return curve(C, { ...sp, regs: null }); } catch { return null; } }).filter(Boolean), best = new Float32Array(n).fill(Infinity);
      for (const cv of vc) { const { pl, nl } = cv, Rcore = 0.012 * C.k; let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (const q of pl) { lo = lo.map((x, i) => Math.min(x, q[i])); hi = hi.map((x, i) => Math.max(x, q[i])); }
        C.box(sub(lo, [Rcore, Rcore, Rcore]), add(hi, [Rcore, Rcore, Rcore]), v => { if (cv.sgn && Math.sign(P[v * 3]) !== cv.sgn) return; const q = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
          let bk = 0, bt = 0, bd = Infinity, bc = pl[0]; for (let i = 0; i < pl.length - 1; i++) { const a = pl[i], e = sub(pl[i + 1], a), ee = dot(e, e) || 1e-12, tt = clamp(dot(sub(q, a), e) / ee), c = add(a, mul(e, tt)), d = dot(sub(q, c), sub(q, c)); if (d < bd) { bd = d; bk = i; bt = tt; bc = c; } }
          const nc = unit(lerp(nl[bk], nl[bk + 1], bt)), tn = unit(sub(pl[bk + 1], pl[bk])), dl = sub(q, bc), dn = dot(dl, nc), dt = sub(dl, mul(nc, dn)), bvec = unit(cross(nc, tn)), latv = dot(dt, bvec);
          if (Math.abs(dn) > 0.012 || Math.abs(latv) > Rcore || Math.abs(latv) >= best[v]) return; const sAlong = (cv.cum[bk] + bt * (cv.cum[bk + 1] - cv.cum[bk])) / cv.total;
          best[v] = Math.abs(latv); aM[v * 4] = latv; aM[v * 4 + 2] = 1.35 * cv.w * C.k; aM[v * 4 + 1] = cv.k * vK * Math.exp(-T[v] / 0.0035) * sst(0, 0.12, sAlong) * sst(1, 0.85, sAlong) * sst(Rcore, 0.5 * Rcore, Math.abs(latv)); }); }
      for (let v = 0; v < n; v++) if (best[v] === Infinity) aM[v * 4] = 0.02; }
    // cellulite: the gluteofemoral skin where fat is thick (Nurnberger and Muller 1978: the fat lobules of women's thigh and buttock skin)
    const cK = o.cellulite * (p.sex === 'f' ? 1 : 0.12) * (0.6 + 0.6 * clamp(p.params.laxity || 0));
    if (cK > 0) { const gl = C.up(S.dense('glute')), tr = C.up(S.dense('troch')), st_ = C.up(S.dense('subtroch')), tf = C.up(S.dense('thighFront')), it = C.up(S.dense('innerThigh'));
      for (let v = 0; v < n; v++) { const r = C.region(v); if (r !== R.pelvis && r !== R.thigh) continue; const m = Math.min(1, gl[v] + tr[v] + st_[v] + 0.5 * it[v] + 0.35 * tf[v]); aM[v * 4 + 3] = cK * m * (F1 ? sst(0.014, 0.03, T[v]) : sst(0.008, 0.024, T[v])); } }   // FORM 1: none at a healthy woman's ~9-13 mm
  }
  if (o.flex) for (let v = 0; v < n; v++) { aF[v * 4] = flexE[v] * o.flex; aF[v * 4 + 1] = flexK[v] * o.flex; aF[v * 4 + 2] = flexA[v] * o.flex; }
  C.g.setAttribute('aDetM', new THREE.BufferAttribute(aM, 4)); C.g.setAttribute('aDetF', new THREE.BufferAttribute(aF, 4));
  const U = { uFlexL: { value: new THREE.Vector3() }, uFlexR: { value: new THREE.Vector3() }, uDetScale: { value: h.scale }, uDetVein: { value: 1 }, uDetCell: { value: 1 }, uDetOn: { value: 1 } };
  if (!h.body.material.userData.p1Detail) { patchMaterial(h, U); h.body.material.userData.p1Detail = U; } else Object.assign(h.body.material.userData.p1Detail, U);
  const Uu = h.body.material.userData.p1Detail;
  ms.micro = Math.round(performance.now() - t);
  // the base geometry (level 0) keeps working with the patched material: zero attributes
  const g0 = h.body.userData.geomL0; if (g0 && g0 !== C.g && !g0.attributes.aDetM) { const n0 = g0.attributes.position.count; g0.setAttribute('aDetM', new THREE.BufferAttribute(new Float32Array(n0 * 4), 4)); g0.setAttribute('aDetF', new THREE.BufferAttribute(new Float32Array(n0 * 4), 4)); }
  // flexion from the pose: elbow and knee flexion past the bind, ankle plantarflexion
  const bindAng = {}, ang3 = (a, b, c) => { const u1 = new THREE.Vector3().subVectors(a, b).normalize(), u2 = new THREE.Vector3().subVectors(c, b).normalize(); return Math.PI - Math.acos(clamp(u1.dot(u2), -1, 1)); };
  const wpos = nm => new THREE.Vector3().setFromMatrixPosition(h.bone(nm).matrixWorld);
  const angles = () => { h.group.updateMatrixWorld(true); const o2 = {}; for (const X of ['L', 'R']) { o2['e' + X] = ang3(wpos('upperarm01.' + X), wpos('lowerarm01.' + X), wpos('wrist.' + X)); o2['k' + X] = ang3(wpos('upperleg01.' + X), wpos('lowerleg01.' + X), wpos('foot.' + X)); o2['a' + X] = ang3(wpos('lowerleg01.' + X), wpos('foot.' + X), wpos('toe3-1.' + X)); } return o2; };
  { const r0 = h.group.rotation.clone(), p0 = h.group.position.clone(); Object.assign(bindAng, angles()); void r0; void p0; }
  const update = () => { const a = angles(); for (const X of ['L', 'R']) { const u = X === 'L' ? Uu.uFlexL.value : Uu.uFlexR.value; u.set(clamp((a['e' + X] - bindAng['e' + X]) / 2.3), clamp((a['k' + X] - bindAng['k' + X]) / 2.2), clamp((bindAng['a' + X] - a['a' + X]) / 0.8)); } return a; };
  // stats: what it cost and what it did
  let vol0 = 0, vol1 = 0; { const vf = (Pp, I) => { let s = 0; for (let i = 0; i < I.length; i += 3) { const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3; s += Pp[a] * (Pp[b + 1] * Pp[c + 2] - Pp[b + 2] * Pp[c + 1]) - Pp[a + 1] * (Pp[b] * Pp[c + 2] - Pp[b + 2] * Pp[c]) + Pp[a + 2] * (Pp[b] * Pp[c + 1] - Pp[b + 1] * Pp[c]); } return Math.abs(s) / 6; };
    if (g0) vol0 = vf(g0.attributes.position.array, g0.index.array); vol1 = vf(P, C.I); }
  const stats = { level: o.level, vertices: n, triangles: C.I.length / 3, ms: { ...ms, total: Math.round(performance.now() - t0) }, displacementMm: [+(dmin * 1000).toFixed(2), +(dmax * 1000).toFixed(2)], curves: curves.length,
    volumeL: { base: +(vol0 * 1000).toFixed(2), detailed: +(vol1 * 1000).toFixed(2) }, warnings: C.warn || [], ...(nac ? { nipple7: nac } : {}) };
  const detail = { level: o.level, opts: o, stats, D, Dg3, T, U: Uu, update, curves, setLevel: lv => setBodyLevel(h, lv), dispose: () => {}, set: q => { if (q.veins != null) Uu.uDetVein.value = q.veins; if (q.cellulite != null) Uu.uDetCell.value = q.cellulite; if (q.on != null) Uu.uDetOn.value = q.on ? 1 : 0; } };
  h.detail = detail; return detail;
}
