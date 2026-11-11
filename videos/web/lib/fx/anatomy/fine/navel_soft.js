// ANATOMY / FINE / NAVEL_SOFT (DETAIL7, c6 iteration 18, 15 Oct 2026): THE NAVEL SOLVED, NOT DRAWN. Ours, CC0.
//
// WHY: iterations 7-16 drew the navel as a height profile (a K0 flare, a rolled wall, a floor): a construction. The 15 Oct directive: the form
// comes from the simulation; the navel is the umbilical scar tethering the skin membrane to the linea alba in the soft solve, so the hood and
// the slope come from the tissue, not a cut. And the renders agreed: i16's rolled wall read as an almond punched into a flat belly, its rim a
// knife edge with an orange scatter fringe (orchestrator, i16 L22; i16 L03 the same, round).
//
// WHAT IS SOLVED (ANAT8-BODY's soft-tissue solver, lib/fx/anatomy/soft/: XPBD stable Neo-Hookean tets, a skin membrane, tethers, gravity;
// used as it is, nothing in it edited): a block of the abdominal wall round the omphalion, at the fine tier's scale (h 1.1 mm: the pelvis
// region's 6 mm grid cannot hold a navel, and carries it as 'free' vertices that ride the skin round them):
//   the SUBCUTANEOUS FAT on the deep fascia (the anterior rectus sheath and the linea alba), its thickness the person's periumbilical fat (BMI,
//     sex), its moduli the pelvis region's superficial fat (tissueMats; the shear: NAVEL_TISSUE.fatMuScale), sliding on the fascia through
//     the same loose areolar layer;
//   the UMBILICAL STALK over the ring: no fat lobules lie over the umbilical ring (the skin is fused to the ring through the scar): in life
//     the pit is air; in the mesh a near-nothing compartment (E 30 Pa) that does not grow, so the fat round it is free to;
//   the SKIN, the pelvis region's membrane (the in vivo toe, the J-curve to the linear region, the dermis's thickness by sex);
//   the UMBILICAL CICATRIX: the skin over the ring tethered to the ring on the fascia, the scar's rest length the dermis's thickness (the scar
//     contracted: the skin at the floor lies on the fascia);
//   the LINEA ALBA above it: the zone of adherence from ~1.2 cm above the omphalion upward (ANAT8-PELVIS's line, tethers.js), skin bound in place;
//   GRAVITY, standing (the bind's -y), the abdomen tilted as the person's own surface is at the omphalion.
// THE HISTORY (the navel forms as the person grows): the block starts as a child's thin layer with the skin over the ring already on the
// fascia (the cord's scar); the fat thickens round the scar to the person's own thickness in steps (an anisotropic growth of the fat's rest
// state along the layer's normal: growThickness), each solved under gravity; the skin the growth over-stretches GROWS back to its
// homeostatic stretch (Zoellner, Buganza Tepole and Kuhl 2012: skinGrowth 'grow', lamCrit 1.10), and the block's skin starts at that same
// homeostatic stretch, so only the scar's own pull is an excess. The wall, the rim's roll, the hood over the upper wall, the lower ramp, any
// radial folds of compressed skin: whatever the tissue makes of it. Nothing here is a shape: the inputs are the tissue's numbers.
// THE OUTPUT: the solved skin as a relief on the patch's tangent plane (mm, out = +): the OUTERMOST skin along the normal (an overhang's lip
// becomes the wall under it: a height field cannot fold, and the eye at the patch's normal sees the lip), minus the solve's own far field (the
// block's sag and its edges belong to the pelvis region's solve, not this one), tapered to 0 at the block's edge.
// CACHE (as face9's, face/face9.js): the solve depends only on the key's inputs (the tissue numbers below, the code); node solves a missing key
// and writes assets/person/fine7/navel/<key>.bin|json; the page reads only the cache (it never solves). prepareNavel() before the bake;
// navelSolved() (sync) inside it.
//
// VERSION 2 (c6 iteration 19, 15 Oct): THE ABDOMINAL WALL THAT BREAKS THE NAVEL'S SYMMETRY. Version 1's every input was symmetric (a round ring
// on a flat fascia under a uniform fat and an isotropic skin), so its navel could only be a round crater (the it1 critic, from the committed
// reliefs: round, 11-12 mm across, no hood; photographed navels are vertical slits when lean, horizontal hooded creases with fat). The inputs now
// carry the wall's own anatomy, and the same solve decides the aspect:
//   the RECTI AND THE LINEA ALBA from the muscle system (ANAT8-BODY muscle/trunk.js, one source of truth): the deep surface is the linea alba
//     between the two recti's medial borders, the bellies' anterior sheath standing proud of it by the person's rectus thickness (trunk.js REF
//     x the person's muscularity, musclePattern) with trunk.js's border taper; the linea alba's half-width from trunk.js (wider above the
//     umbilicus, narrow below), opened round the ring (the ring sits IN the linea alba: its band each side of the ring); trunk.js's tendinous
//     intersection 4 mm above the umbilicus (the belly 30 % thinner there). The fat fills the midline between the bellies under the skin
//     (the periumbilical thickness is the scar's span, skin to linea alba, as version 1); over the bellies it is that much thinner, never
//     under a lean adult's minimum: where the muscle leaves less, the skin rides over it (a lean person's recti show; their navel sits in the
//     groove between them). The relief is the skin's departure from that reference: the patch adds the navel, the body keeps its wall.
//   the ZONE OF ADHERENCE along the linea alba above the umbilicus (Lockwood 1991, PRS 87:1009: the superficial fascial system adherent to the
//     deep fascia): a strip the linea alba's width, not a line;
//   the SKIN ORTHOTROPIC along Langer's lines (transverse on the abdomen): stiffer along them than across (NAVEL_TISSUE.skin.langer), so at
//     the same homeostatic stretch its tension is larger transversely;
//   the TILT is gone from the key (the it1 critic: tilt 0 vs 20 deg changed the relief by 0.035 mm rms): the abdomen at the omphalion stands
//     upright, gravity in its plane.
import { buildSoft, solveSoft, skinGrowth } from '../soft/index.js';
import { tissueMats } from '../pelvis/index.js';
import { REF as MUSCLE_REF } from '../muscle/trunk.js';
import { musclePattern, MUSCLE_BASE } from '../../body/sampler.js';

export const NAVEL_SOFT_VERSION = 3;   // c6 iteration 20: the relief = the scar's solve minus the SAME block solved without the scar (the it2 critic: the analytic
//   reference lift left a straight-edged terrace at x = +-13 mm on L22, and the far-field quadric + taper a faint disc at 20-24 mm)
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sst = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export const NAVEL_TISSUE = {
  fatPerBmi: { m: 2.2, f: 2.7 }, bmi0: 16, fatMin: 6, fatMax: 45,   // periumbilical subcutaneous fat, mm per BMI unit over 16 (ultrasound / CT SAT, as recalled; BODY_FINE's since i7)
  dermis: { m: 2.2, f: 1.9 },                                      // abdominal dermis, mm (ultrasound, as recalled; BODY_FINE.navel.wall's)
  ringR: 4.5,                                                      // the umbilical ring's radius, mm at 1.70 m (the adult ring closed by the scar ~0.8-1 cm across, as recalled)
  stalk: { E: 30, nu: 0.3, rho: 50 },                              // what fills the pit in the mesh (AIR in life: the pit's wall is the fat's free face under the skin): near nothing (3 Pa and 100 Pa gave the same pit: node i18)
  scarK: 100, scarSlackMm: 0.0,                                    // N/m a point of the cicatrix; its rest length = the dermis + this
  // (v2) THE CICATRIX CONTRACTS: a healed full-thickness wound's scar contracts to 20-60 % of its area (wound contraction 40-80 %, as recalled:
  // Rudolph 1979 and the wound-healing literature); the umbilical scar gathers the skin over the ring toward the ring's centre (each point's anchor at
  // `contract` x its distance: the area's midpoint, 60 % contraction), so the skin round it is drawn in and down, not only down;
  // and the ring's attachments are not even: the lower half carries the three fused cords (the two obliterated umbilical arteries and the urachus),
  // the upper half the round ligament alone (standard anatomy: why adult umbilical hernias come through the upper half): the scar's points below
  // the ring's centre 3 x as stiff as those above (the same mean)
  scarContract: Math.sqrt(1 - 0.6), cords: { below: 3, above: 1 },
  alba: { from: 12, k: 200, give: 0.0015 },                       // the linea alba's zone of adherence from 12 mm above the omphalion (tethers.js: 'down to 1 cm above'), N/m a point, m
  skin: { toe: 22.7e3, Elin: 20e6, lock: 0.25, compress: 10,       // the pelvis region's skin membrane (Mazier and Bordas 2024 in vivo toe; J-curve as soft/breast.js)
    prestretch: 1.10,     // living skin sits at its HOMEOSTATIC stretch (Zoellner et al. 2012: the elastic stretch growth returns to, 1.10 uniaxial): the block's skin starts there
                          // everywhere, so where the scar's pull is grown out the skin's tension is the abdomen's own, not an excess pulling the belly into a bowl
    langer: 1.5 },        // (v2) the skin's stiffness along : across Langer's lines (transverse on the abdomen), the geometric mean the toe above: in vivo elastic-wave
                          // studies give ~1.2-1.7 (wave speed ratios ~1.1-1.3 squared; Ruvolo et al. 2007, Deroy et al. 2017, as recalled), ex vivo linear-region tests ~2-3
                          // (Ni Annaidh et al. 2012, Ottenio et al. 2015, as recalled): the in vivo working range is the toe's, so the in vivo value
  // (v2) THE ABDOMINAL WALL ROUND THE UMBILICUS (mm unless said): the muscle system's numbers (ANAT8-BODY muscle/trunk.js; trunk.js keeps the
  // linea alba's and the border's inline in buildTrunk: COPIED here, the same values: ANAT8-BODY, please export them so this reads them)
  wall: {
    alba: [[0, 7], [0.55, 5.5], [1, 2]],   // the linea alba's half-width (mm x sT) at the fraction v of the recti's length from the top (trunk.js xMed: 1.0-1.4 cm wide above the umbilicus, narrow below)
    umbV: 0.6,                              // the umbilicus at ~60 % of the way from the xiphisternal joint to the pubis (xiphisternal-umbilicus ~17-18 cm, umbilicus-pubis ~12 cm: as recalled)
    span: { m: 310, f: 290 },               // the recti's length, the xiphisternal top to the pubic crest, x sT (as recalled)
    border: [0.85, 0.1],                    // trunk.js: the belly 85 % of its thickness at its medial border, its full thickness at 10 % of its width
    bellyW: { m: 66, f: 59 },               // a rectus belly's width at the umbilicus x sT (trunk.js: wMid less xMed)
    intersection: { above: 4, thin: 0.3, half: 0.013 },   // trunk.js: the umbilical tendinous intersection 4 mm above the umbilicus, the belly 30 % thinner over +-0.013 of its length
    fatMin: 3,                              // the thinnest subcutaneous layer over a lean adult's rectus sheath (as recalled): where the muscle leaves less, the skin rides over it
  },
  ref: 'solved',   // (v3) the relief's reference: the same block, the same growth history, NO scar (no cicatrix, no stalk: fat over the ring): what the wall,
                   // the zone of adherence, gravity and the held edges do to the skin cancel exactly; 'lift' = v2's analytic wall.top (node A/B only)
  fatMuScale: 1,   // the superficial fat's own small-strain shear (tissueMats: 2.5 kPa, Samani 2007 / Comley and Fleck 2010), NOT the pelvis region's in vivo
                   // relaxation x 0.098 (Mazier and Bordas 2024's gravity calibration of a whole breast's sag): the navel's wall is a millimetre-scale
                   // corner of the septate superficial layer, where the skin's homeostatic tension over the fat's shear (the elastocapillary length T / mu)
                   // sets how far the rim rounds: ~5 mm here, ~50 mm with the relaxed value (node, iteration 18: dbg6 | dbg7, both a pit in a dish)
  base: { G: 300, t: 0.003, kn: 1e6 },                             // the loose areolar layer on the fascia (pelvis region's)
  history: { childMm: 3.5, maxStep: 0.06, sub: 2, stepTime: 0.3, lamCrit: 1.10, final: false },   // the fat from a child's ~3.5 mm (periumbilical SAT, as recalled) to today's, in steps of at most 6 % thickness (a thick layer takes more), 2 solves each
  grid: { h: 0.0015, hMax: 0.0025, cells: 12, Rb: 0.024, G: 0.3, massFloor: 3 },   // (v2) massFloor 3 (soft/index.js's small-cut-cell cure: the INERTIAL mass only, gravity on the true mass, the
                                                                    // equilibrium unchanged): at 1 every step from the 7th chattered at 0.3-0.9 m/s at the ring's edge (v1's committed L22 solve too,
                                                                    // unseen until now); at 3 every step converges (node, iteration 19; the inverted tets left are the stalk filler's, crushed: air in life)   // the tet grid (m: the layer in ~12 cells, 1.5-2.5 mm; at 1.1 mm the child's step chattered, node i18), the block's half-width (m), the relief's grid (mm)
};

// the key's inputs: the person's tissue numbers (rounded so near-identical people share a solve). (v2) + the trunk's scale and the rectus's
// thickness (the muscle system's: REF x the person's muscularity x (0.5 + 0.5 sT), trunk.js Tm); the tilt is gone (gravity in the plane)
export function navelTissue(info) {
  const N = NAVEL_TISSUE, sex = info.sex === 'm' ? 'm' : 'f', bmi = Math.round((info.bmi ?? 23) * 2) / 2, stat = info.stature ?? (sex === 'm' ? 1.76 : 1.63), k = Math.round((stat / 1.7) * 50) / 50;
  const age = Math.round(clamp(info.age ?? 35, 18, 90) / 5) * 5, tf = +clamp(N.fatPerBmi[sex] * (bmi - N.bmi0), N.fatMin, N.fatMax).toFixed(1);
  const sT = Math.round(stat * 100 / (sex === 'f' ? 162.5 : 175.5) * 50) / 50;   // trunk.js's sT (the person's stature over the sex's mean)
  const pat = musclePattern(sex, info.age ?? 35, info.zAlmi ?? 0, info.occupation || 'general'), ms = clamp(Math.sqrt((pat.rectusAbd ?? MUSCLE_BASE.rectusAbd) / MUSCLE_BASE.rectusAbd), 0.75, 1.35);   // muscle/index.js muscleScale
  const tRa = +(Math.round(MUSCLE_REF.rectusAbd[sex] * ms * (0.5 + 0.5 * sT) * 5) / 5).toFixed(1);
  return { sex, bmi, k, age, tf, hd: N.dermis[sex], rRing: +(N.ringR * k).toFixed(2), sT, tRa };
}
export function navelKey(T) {
  const s = `nv${NAVEL_SOFT_VERSION}|${T.sex}|${T.bmi}|${T.k}|${T.age}|${T.tf}|${T.hd}|${T.rRing}|${T.sT}|${T.tRa}|${JSON.stringify(NAVEL_TISSUE)}`;
  let h1 = 2166136261, h2 = 5381; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = (Math.imul(h2, 33) + c) >>> 0; }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

// (v2) THE ABDOMINAL WALL round the umbilicus, in the patch's frame (mm: x lateral, y up the abdomen, w out of it; the skin's reference at w ~ 0):
//   base(x, y)  the deep surface: the linea alba at -Tt (Tt = the fat over it + the dermis: the scar's span), the recti's sheath proud of it
//   top(x, y)   the skin's reference: level over the fat that fills the midline, lifted where a belly leaves less than the fat's minimum over it
//   rect(x, y)  a belly's height over the linea alba; xb(y) the medial border's distance from the midline; half(y) the linea alba's half-width
export function navelWall(T) {
  const W = NAVEL_TISSUE.wall, sT = T.sT, L = W.span[T.sex] * sT, t = T.tRa, hd = T.hd, Tt = T.tf + hd, rR = T.rRing, A = W.alba;
  const half = y => { const v = clamp(W.umbV - y / L, 0, 1); let i = 0; while (i < A.length - 2 && v > A[i + 1][0]) i++; const [v0, a0] = A[i], [v1, a1] = A[i + 1]; return (a0 + (a1 - a0) * (v - v0) / (v1 - v0)) * sT; };
  const xb = y => half(y) + Math.sqrt(Math.max(0, rR * rR - y * y));   // the ring sits IN the linea alba: the alba's own band each side of it
  const wB = W.bellyW[T.sex] * sT * W.border[1], nH = W.intersection.half * L;
  const rect = (x, y) => { const d = Math.abs(x) - xb(y); if (d <= 0) return 0;
    const prof = W.border[0] + (1 - W.border[0]) * Math.min(1, d / wB), notch = 1 - W.intersection.thin * Math.max(0, 1 - Math.abs(y - W.intersection.above) / nH);
    return t * prof * notch * sst(0, t, d); };   // the anterior sheath round the belly's rounded medial edge (up over a width of its own thickness)
  const smax = (a, b, k) => { const q = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + q * q * k / 4; };   // the skin cannot bend sharper than its thickness
  const top = (x, y) => smax(0, rect(x, y) + W.fatMin + hd - Tt, hd), base = (x, y) => -Tt + rect(x, y);
  return { rect, top, base, half, xb, Tt, t, hd };
}

// the region for buildSoft (frame: e1 lateral, e2 up the abdomen, e3 out; gravity the bind's -y, in the abdomen's plane)
export function navelRegion(T, o = {}) {
  const N = NAVEL_TISSUE, h = o.h ?? Math.min(N.grid.hMax, Math.max(N.grid.h, (T.tf + T.hd) / 1000 / N.grid.cells)), Rb = o.Rb ?? N.grid.Rb, hd = T.hd / 1000, Tt = (T.tf + T.hd) / 1000, rR = T.rRing / 1000;
  const e3 = [0, 0, 1], e1 = [1, 0, 0], e2 = [0, 1, 0], O = [0, 0, 0], Wl = navelWall(T), noWall = !!o.flat;   // o.flat: version 1's flat wall (node A/B only)
  const topM = noWall ? () => 0 : (u, v) => Wl.top(u * 1000, v * 1000) / 1000, baseM = noWall ? () => -Tt : (u, v) => Wl.base(u * 1000, v * 1000) / 1000;
  const toW = (u, v, w) => [O[0] + e1[0] * u + e2[0] * v + e3[0] * w, O[1] + e1[1] * u + e2[1] * v + e3[1] * w, O[2] + e1[2] * u + e2[2] * v + e3[2] * w];
  const toF = (x, y, z) => [(x - O[0]) * e1[0] + (y - O[1]) * e1[1] + (z - O[2]) * e1[2], (x - O[0]) * e2[0] + (y - O[1]) * e2[1] + (z - O[2]) * e2[2], (x - O[0]) * e3[0] + (y - O[1]) * e3[1] + (z - O[2]) * e3[2]];
  // THE COLUMN OVER THE RING: 'filler' (the default, version 1's): a near-nothing 'stalk' compartment the scar crushes as it holds the skin
  // down; the fat round it, meshed continuously with it, is DRAGGED down with the floor into a cone as wide as the layer is thick (node,
  // iteration 19: every filler variant a ~20 mm round crater, whatever the wall, the skin or the scar did). 'air' (o.column, NODE A/B ONLY, not a
  // render path): no fat over the ring, the column's wall the fat's free face lined with skin, the floor the scar's dermis on the ring: with the
  // fat at its small-strain shear the reference column barely moves (a punched cylinder 8.7 mm across: the skin's tension over the fat's shear,
  // T / (mu r) ~ 0.4, cannot close it); with the relaxed shear the step solves do not settle in their 0.3 s (iteration 19, NOTES)
  const air = (o.column ?? 'filler') === 'air', noScar = !!o.noScar;   // (v3) noScar: the reference block (fat over the ring, no cicatrix)
  const fieldF = (u, v, w) => { const tp = topM(u, v), bs = baseM(u, v), dl = Math.max(w - tp, bs - w), r = Math.hypot(u, v);
    if (!air) return { d: dl, comp: !noScar && r < rR ? 1 : 0, label: tp - w < w - bs ? 'skin' : 'base' };
    const dh = Math.min(rR - r, w - (bs + hd)); return { d: Math.max(dl, dh), comp: 0, label: dh >= dl || tp - w < w - bs ? 'skin' : 'base' }; };
  // the deep surface's signed distance (its height field's, to first order) and its normal
  const dg = (x, y, z, g) => { const [u, v, w] = toF(x, y, z), e = 1e-4, b = baseM(u, v), bu = (baseM(u + e, v) - baseM(u - e, v)) / (2 * e), bv = (baseM(u, v + e) - baseM(u, v - e)) / (2 * e), s = 1 / Math.sqrt(1 + bu * bu + bv * bv);
    if (g) for (let q = 0; q < 3; q++) g[q] = (e3[q] - bu * e1[q] - bv * e2[q]) * s; return (w - b) * s; };
  const TM = tissueMats({ age: T.age, sex: T.sex }), fat = { ...TM.mats[0], muScale: o.fatMuScale ?? N.fatMuScale }, aw = 0.0105e6 * Math.max(0, T.age - 20) / 0.42e6;
  const sH = o.surfH ?? h / 2, scar = { name: 'cicatrix', skin: [], anchor: [], k: N.scarK, slack: 0 }, Lscar = hd + N.scarSlackMm / 1000;
  const cS = o.scarContract ?? N.scarContract, kB = 2 * N.cords.below / (N.cords.below + N.cords.above), kA = 2 * N.cords.above / (N.cords.below + N.cords.above); scar.k = [];
  const rS = air ? rR - sH / 2 : rR;   // (air) the floor's skin, off the wall's foot
  for (let u = -rS; u <= rS + 1e-9; u += sH) for (let v = -rS; v <= rS + 1e-9; v += sH) if (Math.hypot(u, v) <= rS) {
    scar.skin.push(toW(u, v, air ? baseM(u, v) + hd : topM(u, v))); scar.anchor.push(toW(u * cS, v * cS, baseM(u * cS, v * cS))); scar.k.push(N.scarK * (o.evenRing ? 1 : v < -1e-9 ? kB : v > 1e-9 ? kA : 1)); }
  scar.slack = Lscar / Tt - 1;   // rest = the reference length (the full thickness) x (1 + slack) = the dermis: the contracted scar (soft/index.js takes one slack a
  // tether set: its rest = the point's own reference length x (1 + slack): with the contraction the reference lengths differ a little, rest ~ the dermis)
  // (v2) the zone of adherence: the linea alba's width (a strip of bound skin across it), from N.alba.from above the omphalion upward
  const alba = { name: 'lineaAlba', kind: 'bound', skin: [], anchor: [], k: N.alba.k, give: N.alba.give };
  for (let v = N.alba.from / 1000 * T.k; v < Rb - 2 * h; v += sH) { const hw = noWall ? 0 : Wl.half(v * 1000) / 1000;
    for (let u = -hw; u <= hw + 1e-9; u += sH) { const p = toW(u, v, topM(u, v)); alba.skin.push(p); alba.anchor.push(p.slice()); }
    if (hw > 0 && (2 * hw) % sH > 0.3 * sH) { const p = toW(hw, v, topM(hw, v)); alba.skin.push(p); alba.anchor.push(p.slice()); } }
  const w0 = -Tt - 1.37 * h, w1 = 0.63 * h + (noWall ? 0 : Math.max(0, Wl.top(Rb * 1000, 0), Wl.top(-Rb * 1000, Rb * 1000)) / 1000);   // grid nodes off the two faces
  return { name: 'navel', h, surfH: sH, box: [-Rb, -Rb, w0, Rb, Rb, w1], frame: { O, ax: [e1, e2, e3] }, fieldF,
    compartments: air || noScar ? [{ name: 'fat', kind: 'fat', mat: fat }] : [{ name: 'fat', kind: 'fat', mat: fat }, { name: 'stalk', kind: 'scar', mat: { ...N.stalk, ...(o.stalkE ? { E: o.stalkE } : {}) } }],
    solids: { dg, d: (x, y, z) => dg(x, y, z, null) },
    interfaces: [{ label: 'base', kind: 'sliding', ...N.base }],
    membranes: [{ name: 'skin', label: 'skin', E: N.skin.toe * (1 + aw), Elin: N.skin.Elin, lock: N.skin.lock, t: hd, laxity: 1 / (o.prestretch ?? N.skin.prestretch) - 1, compress: N.skin.compress }],
    tethers: noScar ? [alba] : [scar, alba], colliders: [],
    cuts: [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => { const p = toW(a * Rb, b * Rb, 0), n = [a * e1[0] + b * e2[0], a * e1[1] + b * e2[1], a * e1[2] + b * e2[2]]; return { p, n, kind: 'held' }; }),
    gravity: [0, -9.81, 0], massFloor: o.massFloor ?? N.grid.massFloor,
    track: [{ name: 'centre', p: toW(0, 0, air ? -Tt + hd : 0) }, { name: 'rimUp', p: toW(0, rR + 2 * h, 0) }, { name: 'rimDown', p: toW(0, -rR - 2 * h, 0) }, { name: 'rimSide', p: toW(rR + 2 * h, 0, topM(rR + 2 * h, 0)) }],
    meta: { e1, e2, e3, Tt, rR, Rb, topM, baseM, wall: noWall ? null : Wl, air, hd, noScar } };
}

// (v2) THE SKIN ORTHOTROPIC along Langer's lines (transverse on the abdomen: e1): each skin edge's stiffness (toe, linear region and the softer
// compression alike) x sqrt(r) cos^2 + sin^2 / sqrt(r) of its angle to the lines (the geometric mean the isotropic modulus): at the same
// homeostatic stretch the skin's tension is larger along the lines (an edge network's response follows its edges' to first order)
export function orthotropicSkin(S, R, r) {
  if (!(r > 0) || r === 1) return 0;
  const e1 = R.meta.e1, P0 = S.surf.pos0, lab = S.surf.label, iS = S.surf.labels.indexOf('skin'), sr = Math.sqrt(r); let n = 0;
  for (const m of S.cons.memb) { if (lab[m.a] !== iS || lab[m.b] !== iS) continue;
    const dx = P0[m.b * 3] - P0[m.a * 3], dy = P0[m.b * 3 + 1] - P0[m.a * 3 + 1], dz = P0[m.b * 3 + 2] - P0[m.a * 3 + 2], l2 = dx * dx + dy * dy + dz * dz; if (!(l2 > 0)) continue;
    const c = dx * e1[0] + dy * e1[1] + dz * e1[2], c2 = c * c / l2, f = sr * c2 + (1 - c2) / sr;
    m.aT /= f; m.aC /= f; if (m.aL) m.aL /= f; n++; }
  return n;
}

// the solved skin -> the relief grid (mm on the tangent plane, out = +)
// the solved skin's OUTERMOST height along the patch normal on the relief's grid (mm), holes filled from their neighbours
function skinHeights(R, surf, G, half, n) {
  const Z = new Float32Array(n * n).fill(NaN);
  const { e1, e2, e3 } = R.meta, P = surf.pos, tri = surf.tri, lab = surf.label, iSkin = surf.labels.indexOf('skin');
  const F = new Float64Array(P.length); for (let v = 0; v < P.length / 3; v++) { const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    F[v * 3] = (x * e1[0] + y * e1[1] + z * e1[2]) * 1000; F[v * 3 + 1] = (x * e2[0] + y * e2[1] + z * e2[2]) * 1000; F[v * 3 + 2] = (x * e3[0] + y * e3[1] + z * e3[2]) * 1000; }
  for (let t = 0; t < tri.length; t += 3) { const a = tri[t], b = tri[t + 1], c = tri[t + 2]; if (lab[a] !== iSkin || lab[b] !== iSkin || lab[c] !== iSkin) continue;
    const ax = F[a * 3], ay = F[a * 3 + 1], aw = F[a * 3 + 2], bx = F[b * 3], by = F[b * 3 + 1], bw = F[b * 3 + 2], cx = F[c * 3], cy = F[c * 3 + 1], cw = F[c * 3 + 2];
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(den) < 1e-12) continue;
    const i0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx) / G + half)), i1 = Math.min(n - 1, Math.floor(Math.max(ax, bx, cx) / G + half)), j0 = Math.max(0, Math.ceil(Math.min(ay, by, cy) / G + half)), j1 = Math.min(n - 1, Math.floor(Math.max(ay, by, cy) / G + half));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const x = (i - half) * G, y = (j - half) * G, l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den, l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den, l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue; const w = l1 * aw + l2 * bw + l3 * cw, q = j * n + i; if (!(Z[q] >= w)) Z[q] = w; } }
  // holes (no triangle over a node: the grid's edge): the nearest filled value along the row, then the column
  let holes = 0; for (let q = 0; q < Z.length; q++) if (Number.isNaN(Z[q])) holes++;
  for (let pass = 0; pass < 4 && holes; pass++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const q = j * n + i; if (!Number.isNaN(Z[q])) continue; let s = 0, m = 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue; const z = Z[jj * n + ii]; if (!Number.isNaN(z)) { s += z; m++; } }
    if (m) { Z[q] = s / m; holes--; } }
  for (let q = 0; q < Z.length; q++) if (Number.isNaN(Z[q])) Z[q] = 0;
  return Z;
}
export function reliefFromSurface(R, surf, o = {}) {
  const N = NAVEL_TISSUE, G = o.G ?? N.grid.G, Rbm = R.meta.Rb * 1000, half = Math.floor(Rbm / G), n = 2 * half + 1, Z = skinHeights(R, surf, G, half, n);
  // (v3) the skin's departure from the SAME block solved without the scar (o.ref: { R, surface }): the wall, the zone of adherence, gravity's
  // sag and the held edges cancel exactly, so the patch carries the navel alone (the body keeps its wall). (v2's analytic reference, the wall's
  // top surface, left the skin's smoothing of the wall's corners in the relief: a straight-edged terrace at x = +-13 mm on L22: node A/B only)
  if (o.ref) { const Zr = skinHeights(o.ref.R, o.ref.surface, G, half, n); for (let q = 0; q < Z.length; q++) Z[q] -= Zr[q]; }
  else if (R.meta.wall) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) Z[j * n + i] -= R.meta.wall.top((i - half) * G, (j - half) * G);
  // the far field: a quadric fitted on the ring 0.55-0.8 of the block's half-width (the block's sag, its held edges), subtracted. (v3) With the
  // solved reference the far field is already gone: no fit (a quadric through the navel's own outer slope would cut a disc into it)
  const M = Array.from({ length: 6 }, () => new Float64Array(7));
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = (i - half) * G, y = (j - half) * G, r = Math.hypot(x, y) / Rbm; if (r < 0.55 || r > 0.8) continue; const f = [1, x, y, x * x, x * y, y * y], z = Z[j * n + i];
    for (let p = 0; p < 6; p++) { for (let q = 0; q < 6; q++) M[p][q] += f[p] * f[q]; M[p][6] += f[p] * z; } }
  for (let p = 0; p < 6; p++) M[p][p] += 1e-9;
  for (let p = 0; p < 6; p++) { let m = p; for (let q = p + 1; q < 6; q++) if (Math.abs(M[q][p]) > Math.abs(M[m][p])) m = q; [M[p], M[m]] = [M[m], M[p]];
    for (let q = 0; q < 6; q++) if (q !== p) { const f = M[q][p] / M[p][p]; for (let w = p; w < 7; w++) M[q][w] -= f * M[p][w]; } }
  const e = o.ref ? [0, 0, 0, 0, 0, 0] : M.map((row, p) => row[6] / row[p]);
  // the embedding's facets (the surface is linear inside each 1.1 mm tet): a Gaussian of 0.35 mm, then the taper to 0 at the block's edge
  const H = new Float32Array(n * n); for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = (i - half) * G, y = (j - half) * G; H[j * n + i] = Z[j * n + i] - (e[0] + e[1] * x + e[2] * y + e[3] * x * x + e[4] * x * y + e[5] * y * y); }
  const sg = (o.smooth ?? 0.35) / G, kr = Math.ceil(3 * sg), K = []; for (let d = -kr; d <= kr; d++) K.push(Math.exp(-d * d / (2 * sg * sg))); const ks = K.reduce((a, b) => a + b, 0);
  const tmp = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { let s = 0; for (let d = -kr; d <= kr; d++) s += K[d + kr] * H[j * n + clamp(i + d, 0, n - 1)]; tmp[j * n + i] = s / ks; }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { let s = 0; for (let d = -kr; d <= kr; d++) s += K[d + kr] * tmp[clamp(j + d, 0, n - 1) * n + i]; const x = (i - half) * G, y = (j - half) * G;
    H[j * n + i] = s / ks; }
  // the taper to 0 at the block's edge (zero slope at both ends of the band); what it cuts is reported (edge: the relief's rms and its largest
  // |value| in the band, before the taper: ~0 with the solved reference, the disc the it2 critic saw when it was not)
  const t0 = o.ref ? 0.7 : 0.8, t1 = o.ref ? 0.98 : 0.95; let es = 0, ec = 0, em = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = (i - half) * G, y = (j - half) * G, r = Math.hypot(x, y), q = j * n + i;
    if (r > t0 * Rbm && r < t1 * Rbm) { es += H[q] * H[q]; ec++; em = Math.max(em, Math.abs(H[q])); } H[q] *= 1 - sst(t0 * Rbm, t1 * Rbm, r); }
  let mn = 0, mx = 0; for (const z of H) { if (z < mn) mn = z; if (z > mx) mx = z; }
  return { G, half, n, h: H, far: e.map(x => +x.toFixed(5)), ref: o.ref ? 'solved' : 'lift', edge: { rmsMm: +Math.sqrt(es / Math.max(1, ec)).toFixed(4), maxMm: +em.toFixed(4), band: [t0, t1] }, rangeMm: [+mn.toFixed(2), +mx.toFixed(2)] };
}

// GROWTH IN THICKNESS (the fat thickening round the scar from childhood): the multiplicative split F = Fe Fg (as soft/index.js setGrowth) with
// an ANISOTROPIC Fg = I + (g - 1) n n^T (the layer thickens along its normal n; its area grows with the body, which this block does not
// model): each tet's rest matrix DmInv Fg^-1, its rest volume, compliances and mass x g. gOf(compartment name) -> g. Its own snapshot of
// the built rest state (S.restN), so setGrowth's is not touched (tissueCreep re-applies setGrowth: not used with this).
export function growThickness(S, gOf, n) {
  const nT = S.TF.length, nN = S.invM.length, R = S.R;
  if (!S.restN) S.restN = { DmInv: Float64Array.from(S.DmInv), Vol: Float64Array.from(S.Vol), aD: Float64Array.from(S.aD), aH: Float64Array.from(S.aH), invM: Float64Array.from(S.invM) };
  const Z = S.restN, mt = new Float64Array(nN), Dn = [0, 0, 0];
  for (let t = 0; t < nT; t++) { const g = gOf(R.compartments[S.TC[t]].name) || 1, a = 1 / g - 1, o = t * 9;
    for (let r = 0; r < 3; r++) Dn[r] = Z.DmInv[o + r * 3] * n[0] + Z.DmInv[o + r * 3 + 1] * n[1] + Z.DmInv[o + r * 3 + 2] * n[2];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S.DmInv[o + r * 3 + c] = Z.DmInv[o + r * 3 + c] + a * Dn[r] * n[c];
    S.Vol[t] = Z.Vol[t] * g; S.aD[t] = Z.aD[t] / g; S.aH[t] = Z.aH[t] / g;
    const mq = R.compartments[S.TC[t]].mat.rho * Z.Vol[t] * g * S.TF[t] / 4; for (let q = 0; q < 4; q++) mt[S.TT[t * 4 + q]] += mq; }
  const mf = R.massFloor > 0 ? R.massFloor * Math.max(...R.compartments.map(c => c.mat.rho)) * R.h * R.h * R.h : 0;
  for (let k = 0; k < nN; k++) { const m = mt[k], mi = mf > 0 && m > 0 && m < mf ? mf : m; S.mass[k] = mi; S.gS[k] = mi > 0 ? m / mi : 1; S.invM[k] = Z.invM[k] === 0 ? 0 : mi > 0 ? 1 / mi : 0; }
}

// the solve with its load history -> { T, key, G, half, n, h (Float32Array, mm), report }
// THE LOAD HISTORY: the navel forms as the fat thickens round the scar: the block starts at a child's layer (history.childMm of fat over
// the dermis), the skin over the ring on the fascia through the scar; the fat (not the stalk) grows in thickness to today's in history.steps
// steps, each solved history.sub times with the skin over-stretched by it growing after each solve (skinGrowth). (Tried first, node only,
// not kept: today's layer with the scar PULLING the skin down through it, rounds of skin growth and fat creep: the stalk crushed, 1100+
// tets inverted, the solve chattering at 0.8 m/s and never converging.)
export function solveNavel(T, o = {}) {
  const t0 = Date.now(), N = NAVEL_TISSUE, HS = { ...N.history, ...(o.history || {}) }, R = navelRegion(T, o), S = buildSoft(R), log = o.log || null;
  S.info.orthotropic = orthotropicSkin(S, R, o.langer ?? N.skin.langer);   // (v2) the skin's stiffness along Langer's lines
  if (R.meta.air) for (const c of S.cons.teth) if (c.name === 'cicatrix') c.L = R.meta.hd + N.scarSlackMm / 1000;   // (v2) the scar's rest: the dermis, from its contracted anchor
  const so = { dt: 0.001, maxTime: 3, damping: 40, tolMm: 0.02, vmaxMmS: 1, minTime: 0.3, ...(o.solve || {}) };
  // (v3) the reference: the same block (the same grid, wall, zone of adherence, skin, gravity, held edges) without the scar: fat over the ring,
  // through the SAME growth history (a single solve at today's thickness chatters: the skin sits locked in its J-curve's stiff region without
  // the growth rounds that relax it; node, iteration 20: 27 mm/s after 3 s), so everything but the scar cancels in the difference
  let ref = null;
  if (!o.noScar && !R.meta.air && (o.ref ?? N.ref) === 'solved') { const Rr = navelRegion(T, { ...o, noScar: true }), Sr = buildSoft(Rr);
    Sr.info.orthotropic = orthotropicSkin(Sr, Rr, o.langer ?? N.skin.langer);
    const rr = solveGrow(T, { ...o, keepSurface: true, snapshots: false }, Rr, Sr, HS, so, Date.now(), null);
    const last = rr.report.history[rr.report.history.length - 1];
    ref = { R: Rr, surface: rr.surface, report: { converged: last.converged, residualMmS: last.residualMmS, inverted: last.inverted, invertedBy: rr.report.invertedBy, ms: rr.report.ms } };
    if (log) log({ reference: 'solved (no scar, the same history)', ...ref.report }); }
  return solveGrow(T, o, R, S, HS, so, t0, log, ref);
}
function solveGrow(T, o, R, S, HS, so, t0, log, ref = null) {
  const e3 = R.meta.e3, Tt = R.meta.Tt, tC = (HS.childMm + T.hd) / 1000, g0 = Math.min(1, tC / Tt), X = S.X, nN = X.length / 3;
  // the child's layer: every node's height over the fascia x g0 (the built grid keeps today's resolution), the rest state thinned to match
  // the HELD nodes (the block's edges: the pelvis region's tissue round it, which grows too) are carried at the layer's grown height each step
  // (v2) every height is over the LOCAL deep surface (the linea alba, the recti's sheath): the child's layer is the grown one scaled down onto it
  const held = [], X0 = S.X0, e1 = R.meta.e1, e2 = R.meta.e2, baseM = R.meta.baseM, dot3 = (P, k, e) => P[k * 3] * e[0] + P[k * 3 + 1] * e[1] + P[k * 3 + 2] * e[2];
  for (let k = 0; k < nN; k++) if (S.invM[k] === 0) held.push(k);
  const bN = new Float64Array(nN); for (let k = 0; k < nN; k++) bN[k] = baseM(dot3(X0, k, e1), dot3(X0, k, e2));
  const atG = (k, g) => { const s = dot3(X0, k, e3), ds = (bN[k] + (s - bN[k]) * g) - s; for (let q = 0; q < 3; q++) X[k * 3 + q] = X0[k * 3 + q] + ds * e3[q]; };
  for (let k = 0; k < nN; k++) atG(k, g0);
  growThickness(S, () => g0, e3);
  // the linea alba's zone of adherence holds the skin where the layer under it puts it: its anchors (the skin's built, today's, positions) ride
  // the growth with the skin (the septa grow with the fat), so the zone never pulls the child's skin up to today's surface
  const alba = S.cons.teth.filter(c => c.bound), a0 = alba.map(c => c.a.slice()), aH = alba.map((c, m) => { const p = a0[m]; return p[0] * e3[0] + p[1] * e3[1] + p[2] * e3[2] - baseM(p[0] * e1[0] + p[1] * e1[1] + p[2] * e1[2], p[0] * e2[0] + p[1] * e2[1] + p[2] * e2[2]); });
  const albaAt = g => alba.forEach((c, m) => { const ds = -aH[m] * (1 - g); for (let q = 0; q < 3; q++) c.a[q] = a0[m][q] + ds * e3[q]; });
  albaAt(g0);
  const steps = Math.max(4, Math.ceil(Math.log(1 / g0) / Math.log(1 + HS.maxStep))), hist = [], snaps = o.snapshots ? [] : null, stepSo = { ...so, maxTime: HS.stepTime ?? 0.8, minTime: 0.2 };
  let L = null;
  for (let k = 0; k <= steps; k++) {
    const g = g0 * Math.pow(1 / g0, k / steps);   // geometric: equal relative increments
    growThickness(S, nm => nm === 'fat' ? g : g0, e3); albaAt(g); for (const q of held) atG(q, g);
    // the skin grows WHILE the fat does (sub rounds: a solve, then the over-stretched skin grown back to the limit), so it never sits locked
    // in the J-curve's linear region against the growing tissue
    let gs = null; for (let r = 0; r < HS.sub; r++) { L = solveSoft(S, stepSo); gs = skinGrowth(S, L.surface.pos, { lamCrit: HS.lamCrit, mode: 'grow' }); }
    const rec = { step: k, g: +g.toFixed(3), fatMm: +((Tt * g) * 1000 - T.hd).toFixed(1), converged: L.stats.converged, t: L.stats.time, residualMmS: L.stats.residualMmS, inverted: L.stats.inverted, Jmin: L.stats.Jmin, skin: L.stats.skinStrainPct, grown: gs.edges, track: trackMm(L, R), vmaxAt: vAt(L, R) };
    hist.push(rec); if (log) log(rec); if (snaps && (k % 4 === 0 || k === steps)) snaps.push({ round: k, rel: reliefFromSurface(R, L.surface) });
  }
  if (HS.final) L = solveSoft(S, so); hist.push({ step: 'final', converged: L.stats.converged, t: L.stats.time, residualMmS: L.stats.residualMmS, inverted: L.stats.inverted, Jmin: L.stats.Jmin, skin: L.stats.skinStrainPct, tether: L.stats.tether, track: trackMm(L, R) });
  if (log) log(hist[hist.length - 1]);
  const rel = reliefFromSurface(R, L.surface, { ...o, ref: ref ? { R: ref.R, surface: ref.surface } : null }), invBy = invertedBy(S, R);
  return { T, key: navelKey(T), G: rel.G, half: rel.half, n: rel.n, h: rel.h, snaps, surface: o.keepSurface ? L.surface : null, R: o.keepSurface ? R : null,
    report: { version: NAVEL_SOFT_VERSION, mode: 'grow', T, wall: R.meta.wall ? wallReport(R.meta.wall) : 'flat (node A/B)', orthotropicEdges: S.info.orthotropic, invertedBy: invBy, massFloor: R.massFloor, g0: +g0.toFixed(3), grid: S.info.grid, h: R.h, tets: S.info.tets, surfVerts: S.info.surfVerts, tethers: S.info.tethers, far: rel.far, ref: rel.ref, edge: rel.edge, reference: ref ? ref.report : null, rangeMm: rel.rangeMm, history: hist, ms: Date.now() - t0 } };
}
// the inverted tets (J <= 0, tissue fraction >= 0.25, as soft/index.js counts them) by compartment, and the fat's by depth (mm under the skin's reference)
function invertedBy(S, R) { const X = S.X, TT = S.TT, D = S.DmInv, out = {}, fatAt = {}, e3 = R.meta.e3;
  for (let t = 0; t < S.TF.length; t++) { if (S.TF[t] < 0.25) continue; const a = TT[t * 4], o = t * 9, M = [0, 1, 2].map(q => { const b = TT[t * 4 + 1 + q]; return [X[b * 3] - X[a * 3], X[b * 3 + 1] - X[a * 3 + 1], X[b * 3 + 2] - X[a * 3 + 2]]; });
    const F = [0, 1, 2].map(r => [0, 1, 2].map(c => M[0][r] * D[o + c] + M[1][r] * D[o + 3 + c] + M[2][r] * D[o + 6 + c]));   // Ds DmInv (Ds's columns the edges)
    const J = F[0][0] * (F[1][1] * F[2][2] - F[1][2] * F[2][1]) - F[0][1] * (F[1][0] * F[2][2] - F[1][2] * F[2][0]) + F[0][2] * (F[1][0] * F[2][1] - F[1][1] * F[2][0]);
    if (J > 0) continue; const nm = R.compartments[S.TC[t]].name; out[nm] = (out[nm] || 0) + 1;
    if (nm === 'fat') { const z = Math.round(-(S.X0[a * 3] * e3[0] + S.X0[a * 3 + 1] * e3[1] + S.X0[a * 3 + 2] * e3[2]) * 1000 / 2) * 2; fatAt[z] = (fatAt[z] || 0) + 1; } }
  return { ...out, fatByDepthMm: fatAt }; }
function wallReport(W) { const r = v => +v.toFixed(2); return { rectusMm: r(W.t), albaHalfMm: { up20: r(W.half(20)), at0: r(W.half(0)), down20: r(W.half(-20)) }, borderAtRingMm: r(W.xb(0)),
  fatOverBellyMm: r(W.top(20, 0) - W.base(20, 0) - W.hd), skinLiftMm: r(W.top(20, 0)) }; }
function vAt(L, R) { const v = L.stats.vmaxAt; if (!v) return null; const { e1, e2, e3 } = R.meta, p = v.restCm.map(x => x * 10); return { mm: [e1, e2, e3].map(e => +(p[0] * e[0] + p[1] * e[1] + p[2] * e[2]).toFixed(1)), massG: v.massG }; }
function trackMm(L, R) { const { e1, e2, e3 } = R.meta, out = {}; for (const [k, p] of Object.entries(L.track)) out[k] = [e1, e2, e3].map(e => +((p[0] * e[0] + p[1] * e[1] + p[2] * e[2]) * 1000).toFixed(2)); return out; }

// ---- the cache (face9's pattern): Int16 relief at 0.005 mm, n x n, row-major (j = up, i = lateral)
const MEM = new Map(), BUILDING = new Map(), UNIT = 0.005;
const BASE = () => new URL('../../../../assets/person/fine7/navel/', import.meta.url);
const isNode = () => typeof process !== 'undefined' && !!process.versions?.node && typeof window === 'undefined';
export function encodeNavel(r) { const q = new Int16Array(r.n * r.n); for (let i = 0; i < q.length; i++) q[i] = Math.round(clamp(r.h[i] / UNIT, -32767, 32767)); return new Uint8Array(q.buffer); }
function decodeNavel(u8, meta) { const b = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength), q = new Int16Array(b), h = new Float32Array(q.length); for (let i = 0; i < q.length; i++) h[i] = q[i] * UNIT;
  return { key: meta.key, T: meta.T, G: meta.G, half: meta.half, n: meta.n, h, report: meta.report }; }
// load (or, in node, solve and write) the person's navel; the bake then reads it synchronously (navelSolved)
export async function prepareNavel(info, o = {}) {
  const T = navelTissue(info), key = navelKey(T); if (MEM.has(key)) return MEM.get(key);
  if (BUILDING.has(key)) return BUILDING.get(key);
  const job = (async () => { const dir = o.base ? new URL(o.base) : BASE();
    try { if (dir.protocol === 'file:' && isNode()) { const fsM = 'node:fs', fs = await import(fsM); const fb = new URL(key + '.bin', dir), fj = new URL(key + '.json', dir);
        if (fs.existsSync(fb) && fs.existsSync(fj)) { const r = decodeNavel(fs.readFileSync(fb), JSON.parse(fs.readFileSync(fj, 'utf8'))); MEM.set(key, r); return r; }
        if (o.build === false || process.env.FINE7_NAVEL_BUILD === '0') return null;
        console.log(`fine7 navel: no solve for key ${key} (${T.sex} bmi ${T.bmi} age ${T.age} fat ${T.tf} mm rectus ${T.tRa} mm): solving it (node)`);
        const r = solveNavel(T, o), meta = { key, T, G: r.G, half: r.half, n: r.n, report: r.report, by: 'fine/navel_soft.js prepareNavel (node)' };
        fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(fb, encodeNavel(r)); fs.writeFileSync(fj, JSON.stringify(meta, null, 1));
        const d = decodeNavel(encodeNavel(r), meta); MEM.set(key, d); console.log(`fine7 navel: solved and cached ${key} (${(r.report.ms / 1000).toFixed(0)} s, relief ${r.report.rangeMm.join('..')} mm)`); return d; }
      const [b, m] = await Promise.all([fetch(new URL(key + '.bin', dir)), fetch(new URL(key + '.json', dir))]); if (!b.ok || !m.ok) return null;
      const r = decodeNavel(new Uint8Array(await b.arrayBuffer()), await m.json()); MEM.set(key, r); return r;
    } catch (e) { console.warn('fine7 navel: ' + (e?.stack || e)); return null; } })();
  BUILDING.set(key, job); job.finally(() => BUILDING.delete(key)); return job;
}
export function navelSolved(info) { return MEM.get(navelKey(navelTissue(info))) || null; }
// the relief at (x, y) mm on the patch's tangent plane (bicubic Catmull-Rom on the cached grid; 0 outside)
export function navelAt(Nv, x, y) {
  const fx = x / Nv.G + Nv.half, fy = y / Nv.G + Nv.half, i = Math.floor(fx), j = Math.floor(fy), n = Nv.n; if (i < 1 || j < 1 || i >= n - 2 || j >= n - 2) return 0;
  const tx = fx - i, ty = fy - j, H = Nv.h, cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  const row = jj => cr(H[jj * n + i - 1], H[jj * n + i], H[jj * n + i + 1], H[jj * n + i + 2], tx);
  return cr(row(j - 1), row(j), row(j + 1), row(j + 2), ty);
}
