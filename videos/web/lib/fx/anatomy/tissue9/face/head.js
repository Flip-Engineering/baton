// TISSUE9-FACE / HEAD: THE HEAD AND NECK AS ONE VOLUME OF TISSUE, GROWN ON THE PERSON'S SKULL (16 Oct 2026, round 8 iteration 1).
// Pure JS (node; no three.js); millimetres in the craniometric frame (skull/frame.js: x the person's left, y up, z forward).
//   const Hd = buildHeadTissue(V, deps, o)   V: { P (the face at the hook, bind metres), E (eyes), info, seedKey, side, tri }
//                                            deps: { F (the face studio: ids, pop.tissue), globes (face6.js) }
//   Hd.L (the lattice: L.lab the body of every voxel), Hd.bodies (id -> { name, cls, kind, side, V }), Hd.skin (the skin's outer surface:
//   a sampled signed distance, negative inside), Hd.B (the skull), Hd.fr (the frame), Hd.N / Hd.M (NOSEMOUTH's nose and mouth: DATA),
//   Hd.marks (the anatomy's own points and lines: the canthi and lid margins, the stomion line, the nostril rims), Hd.report
// THE MODEL (DESIGN.md): the BONE (ANAT8-HEAD's skull, kept: it is the bone), the CARTILAGE (NOSEMOUTH's septal, upper and lower lateral
// cartilages: their geometry), the GLOBES (seated by the orbit), the orbit's contents behind the septum, the tongue and the neck's core
// (the cervical column, the pharynx, the larynx: fixed in iteration 1) are FIXED; every soft tissue is a BODY grown from a seed to its
// volume by packing (grow.js): the muscles from their lines of action (origin on the bone, insertion on the bone, the modiolus, the lips or
// the dermis; a voxel is a muscle's only if one of its fibres, bowed by at most its slack, can pass through it), the glands in their
// spaces, the deep fat, then the superficial fat in its compartments (soft territories between their septa), the lips' mucosa wetting the
// orbicularis (the vermilion is where it reaches the air), the scalp and the nose's envelope as laminates (their septa's length). The
// holes the tissue may not fill: the palpebral fissures (the canthi on the canthal tendons: EYES-FIX's geometry; the lid margins at the
// lids' rest heights), the oral fissure (the stomion line: NOSEMOUTH's mouth), the nostrils (NOSEMOUTH's vestibules), the pharynx. The
// skin's outer surface = the grown tissue's surface + the dermis by site; NOTHING of hm08's form enters (the template is projected onto
// this surface afterwards, for its topology: project.js).
import * as FR from '../../skull/frame.js';
import * as SK from '../../skull/skull.js';
import { buildNose } from '../../head/nose/index.js';
import { buildMouth } from '../../head/mouth/index.js';
import { sampleField, makeField, redistance, blurField } from '../../layer/grid.js';
import { onBone, hitBone } from '../../head/common.js';
import { lattice, growPotts } from './grow.js';
import { VOL, volOf, CLS, tensions, DERMIS, SCALP_SUB } from './data.js';
export const HEAD9_VERSION = 1;
const v3 = { add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: a => Math.hypot(a[0], a[1], a[2]), dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t] };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x)), lerp = (a, b, t) => a + (b - a) * t, mir = p => [-p[0], p[1], p[2]];
const r1 = p => p.map(x => +x.toFixed(1));

// ---------------------------------------------------------------- the skull and the frame (the person's own, as face9 drew it)
export function skullOf(V, deps) {
  const { F, globes } = deps, I = F.ids, G6 = globes(V.E, V.side), fr = FR.headFrameFH(V.P, I, { sex: V.info.sex, globes: G6 }), A = FR.livingAnchors(V.P, I, fr, G6, { tri: V.tri, E: V.E });
  const K = SK.drawSkull({ ...V.info, name: 'f9:' + V.seedKey }, A, { T: F.pop.tissue }), B = SK.buildSkull(K);
  return { fr, A, K, B, G6 };
}
// the bone's sampled, redistanced field (2 mm; ANAT8-HEAD's: buildHead's G) over the skull's box
export function boneField(B, h = 2.0) { const a = B.S.aabb, box = [a[0] - 30, Math.max(a[1] - 30, -150), a[2] - 30, a[3] + 30, a[4] + 8, a[5] + 30].map(Math.round); return redistance(sampleField(B.S, box, h, { band: 3 })); }

// ---------------------------------------------------------------- THE HEAD
export function buildHeadTissue(V, deps, o = {}) {
  const t0 = Date.now(), log = o.log || (() => {}), hv = o.h ?? 1.0, st = { sex: V.info.sex, age: V.info.age, bmi: V.info.bmi ?? 24, fitness: 0.5, group: V.info.group, name: 'f9:' + V.seedKey };
  const S0 = o.skull || skullOf(V, deps), { fr, B } = S0, G = o.G || boneField(B), lm = B.lm, g = B.geo, K = B.K, m = st.sex === 'm', rep = { version: HEAD9_VERSION, ms: {} };
  const N = buildNose(B, G, st), M = buildMouth(B, G, st, { sn: N.lm.sn0, snSkin: N.lm.sn, alarBaseY: N.lm.al?.[1] });
  rep.ms.anatomyData = Date.now() - t0;
  // ---- bone helpers: a ray from the front (along -z) or the side (along -x) to the bone, a point put on the bone (lifted along its normal)
  const hb = (x, y, z0 = 160) => hitBone(G, [x, y, z0], [0, 0, -1], 260) || [x, y, 0];
  const hl = (y, z, x0 = 120) => hitBone(G, [x0, y, z], [-1, 0, 0], 130) || [40, y, z];
  const hm = (y, z) => hitBone(G, [0.5, y, z], [1, 0, 0], 80);                               // from the midline outward (the mandible's inner surface)
  const ob = (p, lift = 1) => onBone(G, p, lift);
  // ---- THE DOMAIN: the skull's box, the nose ahead, the neck down to a cut through the larynx (the domain's cut, below the hyoid)
  const yCut = lm.Hyoid[1] - (o.cutBelowHyoid ?? 32), xMax = Math.max(lm.Eu_L[0], lm.Zy_L[0]) + 18;
  const box = [-xMax, yCut - 3, lm.Op[2] - 14, xMax, lm.V[1] + 14, Math.max(N.lm.prn[2], lm.N[2] + 30) + 14];
  const dims = [0, 1, 2].map(a => Math.ceil((box[a + 3] - box[a]) / hv) + 1), L = lattice(box.slice(0, 3), hv, dims), lab = L.lab, NN = L.N;
  rep.domain = { box: r1(box), dims, voxels: NN, h: hv, yCut: +yCut.toFixed(1) };
  log(`domain ${dims.join('x')} = ${(NN / 1e6).toFixed(1)} M voxels at ${hv} mm; cut y ${yCut.toFixed(1)}`);
  const bodies = []; let nextId = 1; const byName = {};
  const body = (name, b) => { const id = nextId++; bodies[id] = { name, ...b }; byName[name] = id; return id; };
  // FIXED bodies
  const ID = { bone: body('bone', { cls: CLS.SOLID, fixed: true, kind: 'bone' }), cart: body('cartilage', { cls: CLS.SOLID, fixed: true, kind: 'cartilage' }), globe: body('globe', { cls: CLS.SOLID, fixed: true, kind: 'globe' }),
    orbital: body('orbital contents', { cls: CLS.FAT, fixed: true, kind: 'deepFat' }), tongue: body('tongue and floor of mouth', { cls: CLS.SOLID, fixed: true, kind: 'core' }),
    spine: body('cervical column', { cls: CLS.SOLID, fixed: true, kind: 'bone' }), visc: body('pharynx and larynx', { cls: CLS.SOLID, fixed: true, kind: 'core' }), cut: body('the domain\'s cut', { cls: CLS.CUT, fixed: true, kind: 'cut' }),
    eyeHole: body('palpebral fissure', { cls: CLS.HOLE, fixed: true, kind: 'hole' }), mouthHole: body('oral fissure', { cls: CLS.HOLE, fixed: true, kind: 'hole' }), noseHole: body('nostril', { cls: CLS.HOLE, fixed: true, kind: 'hole' }),
    airway: body('nasal cavity and pharynx', { cls: CLS.HOLE, fixed: true, kind: 'hole' }) };
  // ---- 1. the BONE (the sampled field at 1 mm) and the cut
  const t1 = Date.now();
  for (let n = 0; n < NN; n++) { if (lab[n] === 255) continue; const p = L.pos(n); if (p[1] < yCut) { lab[n] = ID.cut; continue; } if (G.value(p[0], p[1], p[2]) < 0) lab[n] = ID.bone; }
  rep.ms.bone = Date.now() - t1;
  // a region fill: f(p) -> true over a box (mm), only where the voxel is free (outside air) unless over is set
  const fill = (bx, f, id, over = null) => { let c = 0; const i0 = Math.max(1, Math.floor((bx[0] - box[0]) / hv)), j0 = Math.max(1, Math.floor((bx[1] - box[1]) / hv)), k0 = Math.max(1, Math.floor((bx[2] - box[2]) / hv));
    const i1 = Math.min(dims[0] - 2, Math.ceil((bx[3] - box[0]) / hv)), j1 = Math.min(dims[1] - 2, Math.ceil((bx[4] - box[1]) / hv)), k1 = Math.min(dims[2] - 2, Math.ceil((bx[5] - box[2]) / hv));
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const n = L.idx(i, j, k), s = lab[n]; if (s !== 0 && !(over && over.has(s))) continue; const p = [box[0] + i * hv, box[1] + j * hv, box[2] + k * hv]; if (f(p)) { lab[n] = id; c++; } }
    return c; };
  const both = (bx, f, id, over) => fill(bx, f, id, over) + fill([-bx[3], bx[1], bx[2], -bx[0], bx[4], bx[5]], p => f(mir(p)), id, over);
  // the CRANIAL CAVITY (the brain: fixed): a point the skull encloses (bone met within 160 mm along at least five of the six axis rays),
  // above the skull base and not in the orbits or the nasal cavity under the anterior fossa; tested on a 3 mm grid (no tissue may grow into
  // the cranium through the foramen magnum)
  { const ID_brain = body('brain', { cls: CLS.SOLID, fixed: true, kind: 'core' }); ID.brain = ID_brain; const hc = 3, a = B.S.aabb, yMin = Math.min(lm.Ba[1], lm.Opi[1]) - 2, enc = new Map();
    const rays = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const encl = (x, y, z) => { if (G.value(x, y, z) <= 0 || y < yMin || (y < g.ySupM && z > lm.Ba[2] + 20)) return false; let hit = 0; for (const d of rays) if (hitBone(G, [x, y, z], d, 160)) hit++; return hit >= 5; };
    const key = (x, y, z) => Math.round(x / hc) + ',' + Math.round(y / hc) + ',' + Math.round(z / hc);
    rep.brain = fill([a[0], yMin, a[2], a[3], a[4], a[5]], p => { const k = key(p[0], p[1], p[2]); if (!enc.has(k)) enc.set(k, encl(Math.round(p[0] / hc) * hc, Math.round(p[1] / hc) * hc, Math.round(p[2] / hc) * hc)); return enc.get(k) && G.value(p[0], p[1], p[2]) > 0; }, ID_brain); }
  // ---- 2. the GLOBES (seated by the orbit: skull.js), the orbit's contents behind the septum (the orbital fat, the extraocular muscles)
  for (const s of ['L', 'R']) { const c = B.globe[s].c, r = B.globe[s].r; fill([c[0] - r - 1, c[1] - r - 1, c[2] - r - 1, c[0] + r + 1, c[1] + r + 1, c[2] + r + 1], p => v3.dist(p, c) < r, ID.globe); }
  { const cav = B.orbit.cavity, gl = B.globe.L, P1 = [g.xOc, g.yOc + g.hh, g.zSup], P2 = [g.xOc, g.yOc - g.hh, g.zInf], P3 = [g.xEc, g.yOc, g.zLatH];
    const cr = [P2[1] - P1[1], P2[2] - P1[2], 0], nrm = (() => { const a = v3.sub(P2, P1), b = v3.sub(P3, P1), n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], l = v3.len(n); return v3.mul(n[2] < 0 ? v3.mul(n, -1) : n, 1 / l); })();
    const behind = p => v3.dot(v3.sub(p, P1), nrm) + 2.0 < 0;   // 2 mm behind the plane of the margins: the orbital septum
    rep.orbital = both(cav.aabb, p => cav.d(p[0], p[1], p[2]) < 0 && v3.dist(p, gl.c) > gl.r && behind(p), ID.orbital); }
  // ---- 3. the CARTILAGE (NOSEMOUTH's framework: its geometry is the nose's data) and the NOSTRILS (their vestibules: holes)
  const cartD = (x, y, z) => { let d = Infinity; for (const P of N.parts) d = Math.min(d, P.d(x, y, z)); return d; };
  rep.cartilage = fill(N.box, p => cartD(p[0], p[1], p[2]) < 0, ID.cart);
  rep.vestibule = fill(N.box, p => N.vestibules.some(P => P.d(p[0], p[1], p[2]) < 0), ID.noseHole);
  // ---- 4. the NASAL CAVITY behind the piriform aperture and the PHARYNX (air the tissue may not enter), the TONGUE, the CERVICAL COLUMN
  //      and the LARYNX (fixed in iteration 1: the neck's core; DESIGN.md)
  const Ba = lm.Ba, Hy = lm.Hyoid, yAp0 = lm.ANS[1] - 1, yAp1 = lm.Rhi[1] - 2;
  const zAp = y => lerp(lm.ANS[2] - 3, lm.Rhi[2] - 5, clamp((y - yAp0) / (yAp1 - yAp0), 0, 1)), apW = y => K.NLB / 2 - 0.5 - 5 * clamp((y - yAp0) / (yAp1 - yAp0) - 0.4, 0, 1);
  rep.nasalCavity = fill([-K.NLB / 2 - 2, yAp0, lm.PNS[2] - 4, K.NLB / 2 + 2, yAp1, lm.Rhi[2]], p => Math.abs(p[0]) < apW(p[1]) && p[2] < zAp(p[1]) - 0.5, ID.airway);
  // the column's front (the prevertebral fascia) with the cervical lordosis; C1 under the basion
  const yC1 = Ba[1] - 6, zSf = y => Ba[2] + 3 + 4 * Math.sin(Math.PI * clamp((yC1 - y) / (yC1 - yCut), 0, 1));
  const spineIn = p => { const [x, y, z] = p; if (y > yC1 + 4) return false; const f = zSf(y), ax = Math.abs(x);
    return (Math.hypot(x / 12, (z - (f - 9)) / 8.5) < 1) || (ax < 16 && z < f - 14 && z > f - 36) || (ax < 27 && z < f - 11 && z > f - 22 && y < yC1 - 2) || (ax < 4.5 && z < f - 34 && z > f - 52 && y < yC1 - 6) || (ax < 15 && z >= f - 9 && z < f + 4); };
  rep.spine = fill([-30, yCut, -70, 30, yC1 + 4, 20], spineIn, ID.spine);
  const zPh0 = y => zSf(y) + 4, zPh1 = y => zSf(y) + (y > Hy[1] ? 16 : 11), phW = y => (y > Hy[1] - 4 ? 15 : 10);
  rep.pharynx = fill([-16, yCut, -10, 16, lm.PNS[1] + 6, lm.PNS[2]], p => { const [x, y, z] = p; if (y > lm.PNS[1] + 6) return false; const top = y > lm.PNS[1] - 8; return Math.abs(x) < (top ? 13 : phW(y)) && z > zPh0(y) && z < (top ? lm.PNS[2] - 3 : zPh1(y)); }, ID.airway);
  // the larynx and the pharynx's walls in front of the column, below the hyoid: the thyroid laminae a V opening backward (prominence forward)
  rep.larynx = fill([-24, yCut, -6, 24, Hy[1] + 2, Hy[2] + 8], p => { const [x, y, z] = p, ax = Math.abs(x); if (y > Hy[1] - 3) return ax < 19 && z > zSf(y) + 2 && z < zPh1(y) + 4;
    return ax < 21 && z > zSf(y) + 2 && z < Hy[2] + 3 - 0.55 * ax; }, ID.visc);
  // the TONGUE fills the oral cavity: inside the lower arch (lingual of the teeth), from the floor (the mylohyoid's plane: the hyoid to the
  // genial tubercles) up to the palate, back to the oropharynx; the floor's own muscles (mylohyoid, geniohyoid) grow below it
  { const arch = B.arch.lower.concat(B.arch.upper), xA = z => { let best = 0; for (const p of arch) if (Math.abs(p[2] - z) < 4) best = Math.max(best, Math.abs(p[0])); return best; };
    const zFront = Math.max(...B.arch.lower.map(p => p[2])) - 7, yFloor = z => lerp(Hy[1] + 7, lm.Me[1] + 13, clamp((z - Hy[2]) / (zFront - 4 - Hy[2]), 0, 1)), zBack = zSf(Hy[1]) + 16;
    const xAc = new Map(); const xAz = z => { const k = Math.round(z); if (!xAc.has(k)) xAc.set(k, xA(k)); return xAc.get(k); };
    rep.tongue = fill([-40, Hy[1] - 2, zBack, 40, lm.PNS[1] + 2, zFront], p => { const [x, y, z] = p; if (y < yFloor(z) || y > lm.PNS[1] + 2) return false; const w = z > Math.min(...B.arch.lower.map(q => q[2])) ? xAz(z) - 6 : 20; return Math.abs(x) < Math.max(8, w); }, ID.tongue); }
  // ---- 5. the PALPEBRAL FISSURES: the canthi on the canthal tendons (EYES-FIX: medial commissure 5.5 mm lateral of dacryon, the lateral
  //      held against the globe 5 mm inside the lateral rim, 2 mm higher), the margins at the lids' rest heights (MRD1 ~ 4 mm above the
  //      pupil's centre, MRD2 ~ 5 mm below: the levator's and the lower retractors' tone at rest; adult norms, as recalled); a hole from the
  //      globe's surface out through the lids' thickness
  const marks = { eyes: {} }, MRD1 = o.mrd1 ?? (m ? 3.6 : 4.0), MRD2 = o.mrd2 ?? 5.2;
  for (const s of ['L', 'R']) { const sg = s === 'L' ? 1 : -1, c = B.globe[s].c, r = B.globe[s].r, gx = c[0] * sg;
    const uEn = (g.xD + 5.5) - gx, vEn = -1.0, vEx = vEn + 2.0, uEx = Math.min((g.xEc - 5.0) - gx, Math.sqrt(Math.max(1, (r + 0.35) ** 2 - vEx * vEx)));
    const sOf = u => clamp((u - uEn) / (uEx - uEn), 0, 1), base = u => lerp(vEn, vEx, sOf(u));
    const up = u => base(u) + (MRD1 - (vEn + vEx) / 2) * Math.pow(4 * sOf(u) * (1 - sOf(u)), 0.7), lo = u => base(u) - (MRD2 + (vEn + vEx) / 2) * Math.pow(4 * sOf(u) * (1 - sOf(u)), 0.85);
    // the fissure seen from the front (its outline in the eye's frontal plane), open from what lies behind it (the globe; beyond the globe's
    // silhouette, medially, the caruncle and the lacrimal lake, receding 0.5 mm a mm) out through the lids' thickness (8 mm)
    const zBack = (u, v) => { const w2 = r * r - u * u - v * v; return w2 > 0 ? c[2] + Math.sqrt(w2) : c[2] - 0.5 * (Math.sqrt(u * u + v * v) - r); };
    const inside = p => { const u = (p[0] - c[0]) * sg, v = p[1] - c[1]; if (!(u > uEn && u < uEx && v < up(u) && v > lo(u))) return false; const zb = zBack(u, v); return p[2] > zb - 0.3 && p[2] < zb + 8; };
    fill([c[0] - r - 9, c[1] - r - 9, c[2] - 8, c[0] + r + 9, c[1] + r + 9, c[2] + r + 9], inside, ID.eyeHole);
    const at = (u, v) => [c[0] + sg * u, c[1] + v, zBack(u, v) + 0.3];
    const us = Array.from({ length: 17 }, (_, i) => lerp(uEn, uEx, i / 16));
    marks.eyes[s] = { en: at(uEn, vEn), ex: at(uEx, vEx), upper: us.map(u => at(u, up(u))), lower: us.map(u => at(u, lo(u))), c, r }; }
  // ---- 6. the ORAL FISSURE: the stomion line (NOSEMOUTH's mouth: the lips' rest length from the skin's subnasale, the commissures on the
  //      arch at the canine-premolar contact), from the lips' front back to the teeth: a slit 0.9 mm thick the lips meet across
  const stoL = M.curves.stomion_L, sto = stoL.slice().reverse().map(mir).concat(stoL.slice(1)), xCh = Math.abs(M.lm.ch_L[0]) - 0.3;
  const stoAt = x => { const ax = Math.abs(x); for (let i = 0; i + 1 < stoL.length; i++) { const a = stoL[i], b = stoL[i + 1]; if (ax >= a[0] && ax <= b[0]) { const t = (ax - a[0]) / (b[0] - a[0] || 1); return [x, lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; } } return null; };
  rep.oralFissure = fill([-xCh, M.lm.sto[1] - 6, lm.UIE[2] - 30, xCh, M.lm.sto[1] + 6, M.lm.sto[2] + 8], p => { const q = stoAt(p[0]); if (!q) return false; return Math.abs(p[1] - q[1]) < 0.45 * hv + 0.05 && p[2] < q[2] + 7 && G.value(p[0], p[1], p[2]) > 0.3; }, ID.mouthHole);
  marks.stomion = sto; marks.mouth = { ch_L: M.lm.ch_L, ch_R: M.lm.ch_R, ls: M.lm.ls, li: M.lm.li, sto: M.lm.sto, vbUpper: M.curves.vbUpper_L, vbLower: M.curves.vbLower_L };
  marks.nose = { prn: N.lm.prn, sn: N.lm.sn, al: N.lm.al, ac: N.lm.ac, rim: N.curves.nostrilRim_L, groove: N.curves.alarGroove_L, columella: N.curves.columella };
  rep.ms.fixed = Date.now() - t1;
  // ---------------------------------------------------------------- THE GROWING BODIES
  const vox = mL => mL * 1000 / (hv * hv * hv);
  // a voxel mask over a box (bbox-local), from a predicate
  const maskOf = (bx, f) => { const i0 = Math.max(0, Math.floor((bx[0] - box[0]) / hv)), j0 = Math.max(0, Math.floor((bx[1] - box[1]) / hv)), k0 = Math.max(0, Math.floor((bx[2] - box[2]) / hv));
    const i1 = Math.min(dims[0] - 1, Math.ceil((bx[3] - box[0]) / hv)), j1 = Math.min(dims[1] - 1, Math.ceil((bx[4] - box[1]) / hv)), k1 = Math.min(dims[2] - 1, Math.ceil((bx[5] - box[2]) / hv)), bxN = i1 - i0 + 1, byN = j1 - j0 + 1, bzN = k1 - k0 + 1;
    const Mk = new Uint8Array(bxN * byN * bzN); let c = 0;
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const p = [box[0] + i * hv, box[1] + j * hv, box[2] + k * hv]; if (f(p)) { Mk[((k - k0) * byN + (j - j0)) * bxN + (i - i0)] = 1; c++; } }
    const [nx, ny] = dims; return { n: c, allow: n => { const i = n % nx, t = (n - i) / nx, j = t % ny, k = (t - j) / ny; if (i < i0 || i > i1 || j < j0 || j > j1 || k < k0 || k > k1) return false; return Mk[((k - k0) * byN + (j - j0)) * bxN + (i - i0)] === 1; } }; };
  const bbOf = (pts, pad) => { const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; for (const p of pts) for (let a = 0; a < 3; a++) { b[a] = Math.min(b[a], p[a] - pad); b[a + 3] = Math.max(b[a + 3], p[a] + pad); } return b; };
  // a MUSCLE: fibres (polylines from origin to insertion); a voxel is the muscle's only if it lies within some fibre segment's spheroid
  // |x - a| + |x - b| <= (1 + slack) |a - b| (the fibre bowed by at most its slack); seeded along its fibres
  const seeds = []; const seedLine = (id, pts, step = 0.5) => { if (pts.length === 1) seeds.push([id, pts[0]]); for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i], b = pts[i + 1], n = Math.max(1, Math.ceil(v3.dist(a, b) / step)); for (let q = 0; q <= n; q++) seeds.push([id, v3.lerp(a, b, q / n)]); } };
  const muscle = (key, side, fibres, o2 = {}) => {
    // the attachments here are LINES (iteration 2: areas): where the fibres bowed by the muscle's own slack cannot hold its volume (the free
    // voxels inside their spheroids less than twice the volume), the bow grows (x 1.3 a step) until they can: reported per muscle
    const V0 = o2.mL ?? volOf(key, st), all = fibres.flat(); let sk = o2.slack ?? VOL[key]?.slack ?? 0.08, mk = null, tries = 0;
    for (; tries < 8; tries++) { const segs = []; for (const f of fibres) for (let i = 0; i + 1 < f.length; i++) segs.push([f[i], f[i + 1], (1 + sk) * v3.dist(f[i], f[i + 1])]);
      const pad = Math.max(...segs.map(([a, b, Lm]) => 0.5 * Math.sqrt(Math.max(0, Lm * Lm - v3.dist(a, b) ** 2)))) + 2;
      mk = maskOf(bbOf(all, pad), p => { const n = L.at(p[0], p[1], p[2]); if (n >= 0 && lab[n] !== 0) return false; return segs.some(([a, b, Lm]) => v3.dist(p, a) + v3.dist(p, b) <= Lm); });
      if (mk.n * hv ** 3 >= 2 * V0 * 1000) break; sk *= 1.3; }
    const id = body(key + (side ? '_' + side : ''), { cls: o2.cls ?? CLS.MUSCLE, kind: o2.kind ?? 'muscle', V: vox(V0), allow: mk.allow, phase: o2.phase ?? 0, mL: +V0.toFixed(2), slack: +sk.toFixed(3), slackSteps: tries, fibres: fibres.map(f => f.map(r1)), side });
    for (const f of fibres) seedLine(id, f); return id; };
  const both2 = (fn) => { fn('L', 1); fn('R', -1); };
  const S = (p, sg) => [p[0] * sg, p[1], p[2]];
  const lo = lerp;
  const ag = v3.lerp(lm.Go_L, [lm.Me[0] + 22, lm.Me[1], lm.Me[2]], 0.28);   // the antegonial notch (the masseter's anterior border meets the lower border)
  const mod = M.lm.mod_L, ch = M.lm.ch_L, archBot = -6.8 - g.aH - 0.6;
  const fibreSet = (O, I, n, via = null) => Array.from({ length: n }, (_, i) => { const t = n === 1 ? 0.5 : i / (n - 1), a = O(t), b = I(t); return via ? [a, via(t), b] : [a, b]; });
  both2((s, sg) => {
    const F = f => f.map(p => S(p, sg)), FF = fs => fs.map(F);
    // MASSETER: the zygomatic arch's lower border (its zygomatic process to the articular eminence) -> the ramus' lateral surface, the angle
    // and the lower border to the antegonial notch (superficial and deep heads as one body)
    muscle('masseter', s, fibreSet(t => ob(v3.add(hl(lo(-8.5, -12, t), lo(lm.Co_L[2] + 12, g.zZy + 22, t)), [-1, -2.5, 0]), 1.0), t => ob(hl(lo(lm.Go_L[1] + 7, ag[1] + 6, t), lo(lm.Go_L[2] + 3, ag[2], t)), 1.0), 6).map(F));
    // TEMPORALIS: the temporal fossa within the inferior temporal line -> the coronoid and the ramus' anterior border, its fibres converging
    // under the arch
    const tl = [[lm.Ft_L[1], lm.Ft_L[2]], [g.yN + 40, 30], [g.yN + 42, 0], [g.yN + 30, -30], [12, -40]];
    muscle('temporalis', s, tl.map(([y, z], i) => { const t = i / (tl.length - 1), O = ob(hl(y, z), 1.0), I = v3.add(lm.Cor_L, [0.5, lo(-6, -1, t), lo(2, -5, t)]), via = [Math.max(O[0], I[0]) + 2, 4, lo(42, 22, t)]; return [O, via, I]; }).map(F));
    // BUCCINATOR: the pterygomandibular raphe and the alveolar processes at the molars -> the modiolus, on the teeth's outer face
    { const up7 = B.arch.upper[B.arch.upper.length - 4], lo7 = B.arch.lower[B.arch.lower.length - 4];
      muscle('buccinator', s, [[ob(hl(up7[1] + 9, up7[2]), 1.2), mod], [ob(hl(lo(up7[1], lo7[1], 0.5), Math.min(up7[2], lo7[2]) - 4), 1.2), mod], [ob(hl(lo7[1] - 9, lo7[2]), 1.2), mod]].map(F)); }
    // the muscles of expression: origin on the bone -> insertion in the modiolus, the lips or the dermis
    muscle('zygMajor', s, FF([[ob(hl(-12, g.zZy + 20), 1.0), v3.add(mod, [1, 1, 2])]]));
    muscle('zygMinor', s, FF([[ob(hb(g.xOc + 8, g.yIn - 8), 1.0), [16, lo(M.lm.sto[1], N.lm.sn[1], 0.55), M.lm.ls[2] - 7]]]));
    muscle('lls', s, FF([[ob(hb(g.xOc - 6, g.yIn - 2), 1.0), [11, lo(M.lm.sto[1], N.lm.sn[1], 0.6), M.lm.ls[2] - 5]]]));
    muscle('llsan', s, FF([[ob(hb(g.xD + 2, g.yN - 12), 1.0), v3.add(N.lm.al, [-1, -1, -3])], [ob(hb(g.xD + 2, g.yN - 12), 1.0), [8, lo(M.lm.sto[1], N.lm.sn[1], 0.7), M.lm.ls[2] - 4]]]));
    muscle('lao', s, FF([[ob(hb(g.xCan + 3, lm.ANS[1] - 4), 1.0), v3.add(mod, [0, 2, 1])]]));
    { const dao0 = ob(hb(24, lm.Me[1] + 7), 1.0), dli0 = ob(hb(12, lm.Me[1] + 10), 1.0);
      muscle('dao', s, FF([[dao0, v3.add(mod, [0, -2, 1])]])); muscle('dli', s, FF([[dli0, [9, M.lm.li[1] + 1, M.lm.li[2] - 4]]]));
      const me0 = ob(hb(5, lm.Id[1] - 6), 0.8); muscle('mentalis', s, FF([[me0, v3.add(me0, [1, -9, 9])]])); }
    // FRONTALIS (the galea -> the brow's dermis), CORRUGATOR, PROCERUS
    muscle('frontalis', s, [6, 18, 30, 42].map(x => [ob(hb(x, g.yN + 62), 2.0), ob(hb(x, g.ySupM + (x > 30 ? 2 : 6)), 3.0)]).map(F));
    muscle('corrugator', s, FF([[ob(hb(g.xD - 2, g.ySupM - 2), 1.0), ob(hb(g.xOc - 2, g.ySupM + 4), 3.5)]]));
    muscle('procerus', s, FF([[ob(hb(2.5, g.yN - 10), 1.0), ob(hb(2.5, g.yN + 9), 3.0)]]));
    // ORBICULARIS OCULI: the orbital part round the rim from the medial canthal tendon to the lateral raphe, the palpebral part in the lids
    { const E = marks.eyes.L, c = E.c, r = E.r, med = ob(hb(g.xD + 1, g.yOc - 1), 1.2), lat = ob(hl(g.yOc - 1, g.zLatH + 1, g.xEc + 30), 1.5);
      const lid = (u, v, out) => { const w = Math.sqrt(Math.max(0, r * r - u * u - v * v)); return [c[0] + u, c[1] + v, c[2] + w + out]; };
      muscle('orbOculi', s, [[med, ob(hb(g.xOc - 8, g.ySupM + 1), 1.2), ob(hb(g.xOc + 8, g.ySupM + 2), 1.2), lat], [med, ob(hb(g.xOc - 6, g.yIn - 4), 1.2), ob(hb(g.xOc + 8, g.yIn - 5), 1.2), lat],
        [E.en, lid(-5, 7, 1.4), lid(5, 7.5, 1.4), E.ex], [E.en, lid(-5, -8, 1.2), lid(5, -8.5, 1.2), E.ex]].map(F)); }
    // the floor's muscles: the anterior digastric (the digastric fossa -> the hyoid), the mylohyoid (the mylohyoid line -> the raphe, the hyoid)
    muscle('digastricAnt', s, FF([[ob([6, lm.Me[1] + 2, lm.Me[2] - 5], 1.0), [9, Hy[1] + 1, Hy[2] + 1]]]));
    { const mh = t => { const z = lo(lm.Me[2] - 12, lm.Go_L[2] + 26, t), q = hm(lm.Me[1] + 12 + 4 * t, z); return q ? ob(q, 0.8) : [20 + 15 * t, lm.Me[1] + 12, z]; };
      muscle('mylohyoid', s, fibreSet(mh, t => [0.5, lo(lm.Me[1] - 1, Hy[1] + 2, t), lo(lm.Me[2] - 14, Hy[2] + 2, t)], 4).map(F)); }
    // the NECK above the cut: the sternocleidomastoid (the mastoid and the superior nuchal line -> the cut, toward the sternum and the
    // clavicle), the posterior neck muscles as one body (splenius, semispinalis, the upper trapezius, levator scapulae: the occiput and the
    // column -> the cut)
    muscle('scm', s, FF([[ob(v3.add(lm.MastoidTip_L, [1, 2, 3]), 1.0), [16, yCut + 1, Hy[2] - 12]], [ob(lm.MastoidPost_L, 1.0), [34, yCut + 1, Hy[2] - 30]]]));
    { const zc = zSf(yCut), occ = [[10, 6, -80], [26, 7, -72], [38, 2, -58], [46, -10, -38]].map(p => ob(hb(p[0], p[1], p[2] + 60) ? [p[0], p[1], p[2]] : p, 1.0));
      const occB = occ.map(p => { const q = hitBone(G, [p[0], p[1], p[2] - 60], [0, 0, 1], 80); return q ? ob(q, 1.0) : p; });
      const ym = lo(lm.Ba[1] - 10, yCut, 0.5);
      muscle('neckBack', s, occB.map((p, i) => [p, [lo(5, 30, i / 3), ym, zSf(ym) - lo(54, 24, i / 3)], [lo(6, 40, i / 3), yCut + 1, zc - lo(52, 16, i / 3)]]).map(F));
      // the LATERAL NECK (scalenes, levator scapulae, the carotid sheath, the straps, the posterior triangle's fat): from the column's
      // transverse processes and the mastoid down to the cut, round the column's sides and in front of it beside the larynx
      const yt = lo(lm.Ba[1] - 12, yCut, 0.15), ytm = lo(lm.Ba[1] - 12, yCut, 0.55);
      muscle('neckLateral', s, [[[30, yt, zSf(yt) - 16], [33, ytm, zSf(ytm) - 14], [36, yCut + 1, zc - 12]], [[22, yt, zSf(yt) + 2], [26, ytm, zSf(ytm) + 6], [30, yCut + 1, zc + 10]], [[14, Hy[1] - 4, Hy[2] - 8], [16, ytm - 8, Hy[2] - 4], [14, yCut + 1, Hy[2] - 6]]].map(F)); }
  });
  // the ORBICULARIS ORIS, each lip one body round the mouth from modiolus to modiolus (the peripheral and the marginal parts), and the
  // lips' MUCOSA and labial glands, which wet it (the vermilion is where they reach the air): their volumes are NOSEMOUTH's lips' (MOUTH:
  // Farkas' vermilion heights, the lip's length and thickness: mouth/params.js), their shapes the packing's
  const partVol = (prims, bx) => { let c = 0; const step = 0.75; for (let z = bx[2]; z <= bx[5]; z += step) for (let y = bx[1]; y <= bx[4]; y += step) for (let x = bx[0]; x <= bx[3]; x += step) if (prims.some(P => P.d(x, y, z) < 0)) c++; return c * step ** 3 / 1000; };
  const mp = k => M.parts.filter(p => p.name.includes(k)), mbx = M.box || [-45, M.lm.li[1] - 20, M.lm.ch_L[2] - 25, 45, N.lm.sn[1] + 6, M.lm.ls[2] + 8];
  const lipV = { ooU: partVol(mp('orbicularis oris').filter(p => p.name.includes('upper')), mbx), ooL: partVol(mp('orbicularis oris').filter(p => p.name.includes('lower')), mbx), mucU: partVol(mp('mucosa (upper)'), mbx), mucL: partVol(mp('mucosa (lower)'), mbx) };
  rep.lips = Object.fromEntries(Object.entries(lipV).map(([k, v]) => [k, +v.toFixed(2)]));
  { const ys = M.lm.sto[1], zs = M.lm.sto[2], up = (dy, dz) => [mod, [24, ys + dy * 0.5, zs - 15 + dz], [13, ys + dy * 0.85, zs - 4 + dz], [0, ys + dy, zs - 2 + dz], [-13, ys + dy * 0.85, zs - 4 + dz], [-24, ys + dy * 0.5, zs - 15 + dz], mir(mod)];
    const dU = M.lm.sto[1] - N.lm.sn[1], dD = M.lm.sto[1] - (M.lm.li[1] - 7);   // the upper lip's height (stomion to the skin's subnasale), the lower's to the sulcus
    muscle('orbOris', 'U', [0.12, 0.35, 0.6, 0.85].map((f, i) => up(-dU * f, -i * 0.8)), { mL: lipV.ooU, slack: 0.12 }); muscle('orbOris', 'D', [0.15, 0.4, 0.7, 0.95].map((f, i) => up(-dD * f, -i * 1.2)), { mL: lipV.ooL, slack: 0.12 });
    const stoLine = sto.map(p => p.slice()), near = (p, d) => { let b = Infinity; for (const q of stoLine) b = Math.min(b, v3.dist(p, q)); return b < d; };
    for (const [sd, mL] of [['U', lipV.mucU], ['D', lipV.mucL]]) { const sgn = sd === 'U' ? 1 : -1, mk = maskOf([-xCh - 3, ys - 16, lm.UIE[2] - 8, xCh + 3, ys + 16, zs + 10], p => { const q = stoAt(p[0]); return !!q && (p[1] - q[1]) * sgn > -0.5 && near(p, 13); });
      const id = body('mucosa_' + sd, { cls: CLS.MUCOSA, kind: 'mucosa', V: vox(mL), allow: mk.allow, phase: 0, mL: +mL.toFixed(2) });
      seedLine(id, stoLine.filter(p => Math.abs(p[0]) < xCh - 2).map(p => [p[0], p[1] + sgn * 1.4, p[2] - 2.5])); } }
  // the GLANDS in their spaces: the parotid's superficial lobe between the ramus' posterior border and the ear, over the masseter's
  // posterior part; the submandibular gland in the submandibular triangle under the body
  both2((s, sg) => { const F = f => f.map(p => S(p, sg)), Go = lm.Go_L;
    const parL = [[Go[0] + 4, -14, lm.Co_L[2] - 4], [Go[0] + 6, -30, Go[2] - 2], [Go[0] + 7, Go[1] + 6, Go[2] + 2]], smL = [[K.goGo / 2 - 13, ag[1] - 8, ag[2] - 2], [K.goGo / 2 - 15, ag[1] - 10, ag[2] + 10]];
    const near = (pts, d) => p => { for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i], b = pts[i + 1], ab = v3.sub(b, a), t = clamp(v3.dot(v3.sub(p, a), ab) / v3.dot(ab, ab), 0, 1); if (v3.dist(p, v3.add(a, v3.mul(ab, t))) < d) return true; } return false; };
    for (const [key, pts, R] of [['parotid', F(parL), 18], ['submandibular', F(smL), 12]]) { const mk = maskOf(bbOf(pts, R + 1), near(pts, R)), mL = volOf(key, st), id = body(key + '_' + s, { cls: CLS.GLAND, kind: 'gland', V: vox(mL), allow: mk.allow, phase: 0, mL: +mL.toFixed(2) }); seedLine(id, pts); } });
  // the SCALP (a laminate: the dermis held by dense septa at their length over the bone) and the NOSE's ENVELOPE (a laminate over the
  // cartilage and the nasal bones: NOSEMOUTH's envT less the dermis), the ALAR LOBULES (fibrofatty: NOSEMOUTH's lobules' volume, in their
  // place on the framework)
  { const tS = SCALP_SUB[st.sex === 'm' ? 'm' : 'f'], scalpRegion = p => p[1] > g.yN + 52 || (p[2] < lm.Ft_L[2] - 40 && p[1] > g.yN + 12) || (p[2] < -45 && p[1] > 4 && p[1] > 4 + (p[2] + 45) * 0.0);
    const id = body('scalp', { cls: CLS.LAMINATE, kind: 'laminate', P: 3, phase: 0, allow: n => { const p = L.pos(n); if (!scalpRegion(p)) return false; const d = G.value(p[0], p[1], p[2]); return d > 0 && d < tS; } });
    for (let a = 0; a < 360; a += 6) for (let e = 10; e <= 80; e += 10) { const th = a * Math.PI / 180, ph = e * Math.PI / 180, dir = [Math.cos(ph) * Math.cos(th), Math.sin(ph), Math.cos(ph) * Math.sin(th)], c = [0, 30, -10], q = hitBone(G, v3.add(c, v3.mul(dir, 140)), v3.mul(dir, -1), 140); if (q && scalpRegion(q)) seeds.push([id, ob(q, 0.8)]); }
    const nb = N.box, dermN = p => DERMIS.base + (DERMIS.noseTip - DERMIS.base) * clamp((p[1] - (N.lm.prn[1] + 12)) / -10, 0, 1);
    const noseRegion = p => p[0] > nb[0] && p[0] < nb[3] && p[1] > nb[1] && p[1] < Math.min(nb[4], g.yN + 4) && p[2] > nb[2] && Math.abs(p[0]) < Math.abs(N.lm.al[0]) + 2;
    const idN = body('nasal envelope', { cls: CLS.LAMINATE, kind: 'laminate', P: 3, phase: 0, allow: n => { const p = L.pos(n); if (!noseRegion(p)) return false; const d = Math.min(G.value(p[0], p[1], p[2]), cartD(p[0], p[1], p[2])); return d > 0 && d < Math.max(1.3 * hv, N.envT(p[0], p[1], p[2]) - dermN(p)); } });
    for (const p of N.curves.dorsum || []) seeds.push([idN, v3.add(p, [0, 0, 0.5])]); seeds.push([idN, v3.add(N.lm.prn, [0, 0, -1.5])]);
    for (const P of N.lobules) { const bx = P.aabb, mL = partVol([P], bx), mk = maskOf(bx.map((x, i) => x + (i < 3 ? -3 : 3)), p => P.d(p[0], p[1], p[2]) < 1.5), id2 = body(P.name, { cls: CLS.FAT, kind: 'lobule', V: vox(mL), allow: mk.allow, phase: 0, mL: +mL.toFixed(2) });
      for (let z = bx[2]; z <= bx[5]; z += 1) for (let y = bx[1]; y <= bx[4]; y += 1) for (let x = bx[0]; x <= bx[3]; x += 1) if (P.d(x, y, z) < -0.8) seeds.push([id2, [x, y, z]]); } }
  // the DEEP FAT in its spaces: the buccal fat pad (its body behind the zygoma and its buccal extension between the buccinator and the
  // masseter's anterior border), the deep medial cheek fat on the maxilla, the SOOF and the ROOF on the orbital rims, the temporal fat pads
  // in the fossa over the temporalis
  both2((s, sg) => { const up6 = B.arch.upT[5], c0 = v3.add(up6.p, v3.mul(up6.n, 11.6)), bp = [c0[0] + 2, M.lm.sto[1] + 6, c0[2] - 3];
    const deep = [['buccalPad', [bp, [bp[0], bp[1] + 13, bp[2] - 10], [bp[0] - 3, bp[1] + 26, bp[2] - 19]], 16], ['dmcf', [ob(hb((g.xD + g.xOc) / 2 + 3, (lm.ANS[1] + g.yIn) / 2 - 1), 1.5)], 12],
      ['soof', [ob(hb(g.xOc + 3, g.yIn - 4), 1.2), ob(hb(g.xOc + 12, g.yIn - 2), 1.2)], 9], ['roof', [ob(hb(g.xOc + 2, g.ySupM + 2), 1.2), ob(hb(g.xOc + 12, g.ySupM), 1.2)], 9],
      ['temporalPad', [ob(hl(4, 34), 7), ob(hl(14, 44), 6), ob(hl(-2, 22), 7)], 18]];
    for (const [key, pts0, R] of deep) { const pts = pts0.map(p => S(p, sg)), near = p => pts.some((q, i) => v3.dist(p, q) < R || (i + 1 < pts.length && (() => { const a = q, b = pts[i + 1], ab = v3.sub(b, a), t = clamp(v3.dot(v3.sub(p, a), ab) / v3.dot(ab, ab), 0, 1); return v3.dist(p, v3.add(a, v3.mul(ab, t))) < R; })()));
      const mk = maskOf(bbOf(pts, R + 1), near), mL = volOf(key, st), id = body(key + '_' + s, { cls: CLS.FAT, kind: 'deepFat', V: vox(mL), allow: mk.allow, phase: 1, mL: +mL.toFixed(2) }); seedLine(id, pts); } });
  // the SUPERFICIAL FAT: each compartment (Rohrich and Pessa 2007) seeded on the deep layer's surface at its place, grown after the deep
  // layers, in a soft territory (the nearest compartment's place: the septa run between them); the anchors (left), seeded at phase 2
  const supA = [['forehead', () => hb(16, g.yN + 30)], ['temporal', () => hl(20, 30)], ['infraorbital', () => hb(g.xOc, g.yIn - 4)], ['medialCheek', () => hb(g.xOc - 4, g.yIn - 17)],
    ['middleCheek', () => hb(g.xOc + 10, g.yIn - 20)], ['lateralCheek', () => hl(-28, lm.Go_L[2] + 8)], ['nasolabial', () => hb(Math.abs(N.lm.al[0]) + 4, lo(N.lm.al[1], M.lm.sto[1], 0.35))],
    ['jowl', () => hb(30, lm.Me[1] + 17)], ['mental', () => hb(9, lm.Me[1] + 8)], ['submental', () => [14, lm.Me[1] - 6, lm.Me[2] - 14]], ['neckSub', () => [40, lo(Hy[1], yCut, 0.4), Hy[2] - 30]], ['neckSub', () => [34, lo(Hy[1], yCut, 0.4), zSf(yCut) - 40]]];
  const supIds = {}; both2((s) => { for (const k of new Set(supA.map(a => a[0]))) { const mL = volOf(k, st); supIds[k + '_' + s] = body(k + '_' + s, { cls: CLS.FAT, kind: 'supFat', V: vox(mL), phase: 2, mL: +mL.toFixed(2) }); } });
  // seeds into the lattice (only into free voxels; a seed off its own confinement is skipped)
  // a seed lands on its nearest free voxel within 3 mm that its body's confinement allows (a point on the bone's surface may round into it)
  let nSeed = 0; const okSeed = (id, n) => n >= 0 && lab[n] === 0 && (!bodies[id].allow || bodies[id].allow(n));
  for (const [id, p] of seeds) { let n = L.at(p[0], p[1], p[2]); if (!okSeed(id, n)) { n = -1; let bd = Infinity; for (let dz = -3; dz <= 3; dz++) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const q = L.at(p[0] + dx * hv, p[1] + dy * hv, p[2] + dz * hv), d = dx * dx + dy * dy + dz * dz; if (d < bd && okSeed(id, q)) { bd = d; n = q; } } }
    if (n < 0) continue; lab[n] = id; nSeed++; }
  // the nose's envelope is seeded on every voxel its septa reach (a laminate fills its reach)
  { const idN = byName['nasal envelope'], nb2 = N.box; for (let z = nb2[2]; z <= nb2[5]; z += hv) for (let y = nb2[1]; y <= nb2[4]; y += hv) for (let x = nb2[0]; x <= nb2[3]; x += hv) { const n = L.at(x, y, z); if (okSeed(idN, n)) { lab[n] = idN; nSeed++; } } }
  rep.seeds = nSeed; rep.ms.setup = Date.now() - t0; log(`bodies ${nextId - 1}, seeds ${nSeed}, setup ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  // ---------------------------------------------------------------- GROW: the muscles, glands, lips, laminates; the deep fat
  const J = tensions(), gopt = { seed: o.seed ?? 7, kappa: o.kappa ?? 200, log, logEvery: o.logEvery ?? 10 };
  const R1 = growPotts(L, bodies, J, { ...gopt, phases: [{ sweeps: o.sweeps0 ?? 50, T: 0.6, ramp: 0.6, grow: 0, upTo: 0 }, { sweeps: o.sweeps1 ?? 40, T: 0.6, ramp: 0.6, grow: 1, upTo: 1 }] });
  // the superficial compartments' seeds: from each anchor outward to the grown tissue's surface (the SMAS: the deep layer's top), the
  // territories (each voxel to its nearest anchor on that surface)
  const surfOut = (p0, dir) => { let p = p0.slice(), last = null; for (let t = 0; t < 70; t += 0.5) { const q = v3.add(p0, v3.mul(dir, t)), n = L.at(q[0], q[1], q[2]); if (n < 0) break; const sd = lab[n]; if (sd === 0) return q; last = q; } return last || p0; };
  const anchors = []; both2((s, sg) => { for (const [k, f] of supA) { let p = S(f(), sg); const dir = k === 'temporal' || k === 'lateralCheek' ? [sg, 0, 0] : k === 'submental' ? [0, -0.8, 0.6] : k === 'neckSub' ? v3.mul(v3.sub(p, [0, p[1], 0]), 1 / Math.hypot(p[0], p[2])) : [0.25 * sg, 0, 0.97];
    const q = k === 'submental' || k === 'neckSub' ? surfOut([p[0] * 0.3, p[1], k === 'neckSub' ? zSf(p[1]) + 10 : p[2] - 6], dir) : surfOut(v3.sub(p, v3.mul(dir, 4)), dir); anchors.push([supIds[k + '_' + s], q]); } });
  for (const [id, q] of anchors) for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const n = L.at(q[0] + dx, q[1] + dy, q[2] + dz); if (n >= 0 && lab[n] === 0) lab[n] = id; }
  { const terr = new Uint8Array(NN), aP = anchors.map(a => a[1]), aI = anchors.map(a => a[0]);
    for (let n = 0; n < NN; n++) { const s0 = lab[n]; if (s0 !== 0 && !(bodies[s0] && !bodies[s0].fixed)) continue; const p = L.pos(n); let b = -1, bd = Infinity; for (let i = 0; i < aP.length; i++) { const d = (p[0] - aP[i][0]) ** 2 + (p[1] - aP[i][1]) ** 2 + (p[2] - aP[i][2]) ** 2; if (d < bd) { bd = d; b = i; } } terr[n] = aI[b]; }
    for (const id of Object.values(supIds)) bodies[id].pen = { map: terr, P: o.septa ?? 1.0 }; }
  rep.anchors = anchors.map(([id, q]) => [bodies[id].name, r1(q)]);
  // the LOOSE AREOLAR TISSUE (the space between the bodies and under the skin: the investing fascia's, the subcutaneous septa's loose
  // tissue): it carries no tension against any tissue and the skin's against air, and costs its own pressure p a voxel, so it fills only
  // what the skin's tension would rather span than follow (a crevice, a cleft between two bellies: a concavity tighter than the tension
  // and p allow); it is seeded on every concave air voxel at the start of the last phase and the packing keeps what pays
  const idA = body('areolar', { cls: CLS.AREOLAR, kind: 'areolar', P: -(o.areolarP ?? 1.2), phase: 3 }); ID.areolar = idA;
  const R2 = growPotts(L, bodies, J, { ...gopt, seed: (o.seed ?? 7) + 1, beforePhase: (ph) => { if (ph !== 1) return; let c = 0; const [nx, ny] = dims, OFFs = []; for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy || dz) OFFs.push(dx + dy * nx + dz * nx * ny);
      const cand = []; for (let n = 0; n < NN; n++) { if (lab[n] !== 0) continue; let t = 0; for (const d of OFFs) { const q = lab[n + d]; if (q !== 0 && q !== 255 && bodies[q] && bodies[q].cls !== CLS.HOLE && bodies[q].cls !== CLS.CUT) t++; } if (t >= 14) cand.push(n); }
      for (const n of cand) { lab[n] = idA; c++; } log(`  areolar seeded on ${c} concave voxels`); }, phases: [{ sweeps: o.sweeps2 ?? 50, T: 0.6, ramp: 0.6, grow: 2, upTo: 2 }, { sweeps: o.sweeps3 ?? 30, T0: 0.6, T: 0.2, grow: -1, upTo: 3 }] });
  rep.grow = { phase01: { ms: R1.ms, attempts: R1.attempts, accepted: R1.accepted }, phase23: { ms: R2.ms, attempts: R2.attempts, accepted: R2.accepted }, volumes: R2.vol };
  rep.ms.grow = R1.ms + R2.ms;
  // ---------------------------------------------------------------- THE SKIN: the grown tissue's outer surface + the dermis by site
  const t3 = Date.now(), Sk = skinField(L, bodies, ID, { B, N, M, marks, st });
  rep.skin = Sk.report; rep.ms.skin = Date.now() - t3; rep.ms.total = Date.now() - t0;
  return { L, bodies, byName, ID, skin: Sk.F, sub: Sk.Fsub, out: Sk.out, B, G, fr, S0, N, M, marks, st, report: rep };
}

// THE SKIN'S OUTER SURFACE. The outside = the air connected to the lattice's border, the palpebral fissures, the nostrils and the oral
// fissure; every other voxel is inside (an enclosed void is loose areolar tissue; the nasal cavity and the pharynx are inside the skin).
// The subcutaneous surface = that indicator's boundary (blurred 0.7 mm, redistanced); the skin's outer surface lies the dermis' thickness by
// site outside it (thin over the lids and the vermilion: DERMIS); the fissures and nostrils are kept open through the dermis.
export function skinField(L, bodies, ID, ctx) {
  const t0 = Date.now(), [nx, ny, nz] = L.dims, N = L.N, lab = L.lab, h = L.h, out = new Uint8Array(N), st = [];
  const openHole = s => s === ID.eyeHole || s === ID.noseHole || s === ID.mouthHole;
  for (let n = 0; n < N; n++) if (lab[n] === 255) { out[n] = 1; st.push(n); }
  const OFF = [1, -1, nx, -nx, nx * ny, -nx * ny];
  while (st.length) { const n = st.pop(); for (const d of OFF) { const q = n + d; if (q < 0 || q >= N || out[q]) continue; const s = lab[q]; if (s === 0 || openHole(s)) { out[q] = 1; st.push(q); } } }
  // the indicator (+0.5 outside, -0.5 inside), blurred, scaled to mm and redistanced: the subcutaneous surface's signed distance
  // below the cut the neck's section at the cut is carried straight down (the domain's boundary: the body continues there)
  { let jc = 0; for (let j = 0; j < ny; j++) { const n = (Math.floor(nz / 2) * ny + j) * nx + Math.floor(nx / 2); if (lab[n] !== ID.cut && lab[n] !== 255) { jc = j; break; } }
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { const src = out[(k * ny + jc) * nx + i]; for (let j = 0; j < jc; j++) { const n = (k * ny + j) * nx + i; if (lab[n] === ID.cut) out[n] = src; } } }
  const F0 = new Float32Array(N); for (let n = 0; n < N; n++) F0[n] = out[n] ? 0.5 : -0.5;
  const Gb = blurField(makeField(F0, L.dims, L.origin, h), 0.7 * h), Fs = new Float32Array(N); for (let n = 0; n < N; n++) Fs[n] = Gb.F[n] * 2 * h;
  const Fsub = redistance(makeField(Fs, L.dims, L.origin, h), { keep: 0.5 * h, passes: 2 });
  // the dermis by site: the nearest body under the surface decides (mucosa: the vermilion; a lid: the orbicularis in front of the globe)
  const { B, marks } = ctx, near = (p, c, r) => v3.dist(p, c) < r;
  const tD = (p, n) => { const s = lab[n]; if (bodies[s]?.kind === 'mucosa') return DERMIS.vermilion;
    for (const k of ['L', 'R']) { const E = marks.eyes[k]; if (near(p, E.c, E.r + 9) && p[2] > E.c[2]) return DERMIS.lid; }
    if (bodies[s]?.name === 'scalp') return DERMIS.scalp; if (p[1] < B.lm.Me[1] - 8) return DERMIS.neck;
    if (Math.abs(p[0]) < 30 && p[1] < ctx.N.lm.sn[1] && p[1] > ctx.M.lm.li[1] - 4) return DERMIS.lipSkin; return DERMIS.base; };
  // the body under the surface: a step 1.5 mm inside along the distance's gradient
  const F = new Float32Array(N), V = Fsub.F, gq = [0, 0, 0];
  for (let n = 0; n < N; n++) { const v = V[n]; if (v > 5 || v < -3) { F[n] = v - DERMIS.base; continue; } const p = L.pos(n); Fsub.grad(p[0], p[1], p[2], gq, 0.5 * h);
    const q = [p[0] - (v + 1.5) * gq[0], p[1] - (v + 1.5) * gq[1], p[2] - (v + 1.5) * gq[2]], m = L.at(q[0], q[1], q[2]); F[n] = v - tD(p, m >= 0 ? m : n); }
  for (let n = 0; n < N; n++) if (openHole(lab[n])) F[n] = Math.max(F[n], 0.4);
  const Fk = redistance(blurField(makeField(F, L.dims, L.origin, h), 0.5 * h), { keep: 0.5 * h, passes: 2 });
  let outN = 0; for (let n = 0; n < N; n++) if (out[n]) outN++;
  return { F: Fk, Fsub, out, report: { outsideVoxels: outN, ms: Date.now() - t0 } };
}
