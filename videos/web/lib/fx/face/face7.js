// FACE7 (HUMAN c8 round 7): the parts of the face that sit on its form, each from its own anatomy or growth: the lids over the eye,
// the lashes and the brows grown from their follicles, the brow's line on the skull, the lips' finish, the resting mouth. ONE current
// version (the client, 8 Oct: superseded revisions live only in git history; FACE7's iterations are in
// review/studio_human_c8/after/face7/NOTES.md). Reached through face3Spec(info, { .., f6: {}, f7: {} }) (the person passes it).
// The FORM of the face (the bone, the muscles, the fat compartments, the skin membrane: the upper lip's length, the lower face's width,
// the cheek) is the anatomy's: ANAT8-HEAD's face rev 9 (face9.js, from the skull out) and NOSEMOUTH's nose and lips. FACE7 does not
// shape it. (c7 it 17, 15 Oct, the client: 'we aren't looking for presculpted figures'; 'WE ARE ONLY INTERESTED IN PERFECTING FROM OUR
// PROCEDURAL SYSTEMS': RETIRED to git history: the upper lip cut and the cheek push toward the c3 photographs' percentiles through a
// MediaPipe-minus-bind calibration (lip / cheek / cal, bindRead), the brow's height lifted to the photographs' p50 (cal.photo.brow), the
// upper lid raised to the photographs' p40 margin-reflex distance (globe.lift, face7Lift) and the young women's narrowing (lids.narrow,
// MakeHuman eye-height2-decr): all constructions from numbers. And the card brows and card lashes as FACE7's face: the brows and the
// lashes are grown.)
//
//  rest    FACE6's muscle rest with a lower base and tone (no resting smile).
//  globe   ONE GLOBE: the eye drawn at 12 mm with its corneal apex kept (eyes.js globe7; Cycles takes it through the export), the lid-margin
//          loop and the canthal pocket seated on the eye's surface (the cornea over the iris), the skin over the globe outside the opening
//          (the seal).
//  aperture the lids' REST from the lid's anatomy (face7Aperture: the levator and Mueller's tone, the aponeurosis' and the lower lid's
//          laxity with age), up or down, on the drawn eye.
//  lidTissue the lids as layers on the drawn eye: the margin's thickness, the tarsal platform, the crease (DETAIL7's height) and the fold
//          over it with the laxity of age, the lower lid's pretarsal roll (face7LidTissue); the lashes on the margin's anterior edge.
//  lashes  the rows grown from their follicles (hair/face.js growLashesFol) on the drawn eye's lid edges (lidMargins7); each card draws
//          its own lashes at the follicle's calibre with a natural point (hair/brow7.js lashStrands7; Cycles the same hairs in the person's
//          fibre BSDF: blender/person_hair.py LASH7), the face cards' fibre lobes (c7 it 18: the look-set sheen multipliers deleted).
//  brows   grown as HAIR from a follicle field (hair/face.js growBrows `fol`: single hairs over the brow's skin, density, direction, length
//          and calibre by region, feathered edges); the engine's card draws its own hairs at the calibre (hair/brow7.js browStrands7; Cycles
//          the same hairs: blender/person_hair.py BROW7); their material (browMaterial7); the brow's line (hair/face.js browShape) on the
//          SKULL's supraorbital margin (`rim`: ANAT8-HEAD's skull tables, this person's orbit height): men's brows on the margin, women's
//          lower edge on it.
//  eyes    (likeness/eyes.js `f7`) the iris without its own specular, the stage's tear-film reflection halved, the sclera's value and pink,
//          a smaller paler caruncle, the key's catchlight at FACE5's physical energy. (The EYES studio replaces the eye organ.)
//  under   SKIN4's periorbital zones under FACE5's gate: the inner canthus' red and the upper lid's band down.
//  lips    the meeting line's groove shallower, a satin wet band.
import * as FT from '../body/face_tissue.js';
import { clamp } from './sample.js';
import { globes } from './face6.js';
import { browMaterial7, lashMaterial7 } from '../hair/brow7.js';
import { face7Cavity, cavityPatch, cavityUniforms } from './cavity7.js';
import { LASH_CARD7 } from '../hair/face.js';
import { FINE_NUMBERS } from '../anatomy/fine/features.js';
import { drawSkull } from '../anatomy/skull/skull.js';

export const FACE7_VERSION = 7;
const sst = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const at = (P, v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
export const F7_DEFAULTS = {
  rest: { base: { f: 0.45, m: 0.2 }, rest: 0.6, cap: 1.5, duchenne: 0.4 },
  // brows: the band's thickness x and arch x (browShape: where on the skin the field grows); mat (hair/brow7.js browMaterial7); fol: the
  // follicle field (hair/face.js growBrows; FACE7 c3 it 7; the brows' only path since c7 it 17: the card brows are not FACE7's face):
  // rho (hairs per cm2 of skin at the body's core, per sex: no normative brow density was found; set so a brow carries ~150-300 single
  // hairs, the range brow restoration plants for a natural-to-full brow, at about the scalp's 130-160 per cm2), head / tail (density there as a share of the body's), the edges' fall-off
  // (in half-thicknesses past the core, lower / upper), stray (the density share out to `out` half-thicknesses), len (mm: head, body, tail),
  // exit (deg: the hair's angle out of the skin), lie (mm: how far the hair stands off the skin at its tip per 8 mm of length), w (mm: the
  // card's width at the root / tip: a single hair, the atlas tile's strands squeezed into it), sep (mm: the least distance between follicles);
  // base: the skin's soft base under the hairs (x index.js's), alpha: the cards' alpha gain (brow7.js)
  brows: { thick: { f: 1.3, m: 1.12 }, arch: 0.85, mat: { specR: 0.18, specTRT: 0.35, eGain: 0.25, greyK: 0.6, alphaGain: 1.7 },
    // (c5 it 13; plate tags dn15) THE BROW'S FIELD AS A BROW GROWS: the body is a uniformly dense mass across most of its height (core 0.8), the
    // lower border defined (lower 0.3: the lower row's hairs lie up and out ACROSS the border, so it reads as an edge, not a fade), the upper
    // border feathered over a little more (upper 0.5), the head a little sparser than the body with its hairs upright (head 0.65): the
    // descriptions of the brow in the oculoplastic and restoration texts (as recalled). Until it 12 the field was a fall-off almost
    // everywhere (core 0.55, lower 0.55, upper 0.85, head 0.5): ~40 cards (~160 hairs) a woman's brow, a sparse veil the critics called
    // faded and grey. The density per cm2 (rho) is unchanged: only where on the brow it holds.
    fol: { rho: { f: 140, m: 160 }, head: 0.65, tail: 0.4, core: 0.8, lower: 0.3, upper: 0.5, stray: 0.05, out: 1.9, len: { f: [4.5, 7.0, 5.0], m: [5.0, 8.5, 5.5] },
      exit: 16, lie: 0.55, w: [0.30, 0.12], sep: 0.42, base: 0.3, alpha: 1.0,
      // (c5 it 11) cal: the brow hair's calibre at the root (mm; brow shafts ~0.06-0.10 mm, men's coarser: the trichology texts, as recalled,
      // said so), clump: hairs a card draws (the half brow tile's ~4 strands, measured; hair/face.js growBrowsFol), conv: the card's tip / root width
      cal: { f: 0.075, m: 0.09 }, clump: 4, conv: 0.75,
      // (c6 it 15) strands: the engine's card draws its own `clump` hairs at the calibre (hair/brow7.js browStrands7: the hairs person_hair.py's
      // BROW7 draws in Cycles), not the scalp atlas' brow tile; false: the atlas tile (the A/B's before)
      strands: {} },
    // (c5 it 12; the brow's only height since c7 it 17: the photographs' percentile lift through `cal` is deleted) THE BROW ON ITS BONE
    // (hair/face.js browShape o.rim): k = where the supraorbital margin falls across the brow at the pupil's column, in half-thicknesses
    // below the brow's centre: men 0 (the brow on the margin), women 1 (its lower edge on it, the body above). The margin's height over the
    // globe's centre is the SKULL's (ANAT8-HEAD's
    // skull/skull.js drawSkull: this person's orbit height OBH from the craniometric tables by sex and background, the person's own draw):
    // OBH / 2 - yOc (the orbit's centre under the globe's, skull.js' seating)
    rim: { k: { f: 1, m: 0 }, yOc: 1.5 } },
  eyes: { irisSpec: 0, ccEnv: 0.45, sclera: 0.78, pink: 1, catch: 1, caruncle: { scale: 0.8, col: [0.46, 0.27, 0.25] } },
  under: { underEye: 1, innerCanthus: 0.25, upperLid: 0.7 },
  lips: { groove: 0.6, wetRough: 0.32 },
  // r (mm): the drawn globe (the corneal apex kept); inset (mm, eyes.js'); seat: the visible lid margin on the eye's surface (a margin vertex
  // floating more than outMax off it comes in to outTo, one sunk more than inMax into it comes out to inTo, radially; the lid skin within
  // ~sig mm follows; the canthal pocket: loop vertices more than `pocket` mm behind the globe's front come forward along the axis to
  // pocketTo); seal: the skin outside the margin ring over the globe (target cover mm, ramp from the ring mm, floor mm at the ring, band,
  // spread sigma, cap; skipIris: over the cornea the lid is the eye's own edge)
  globe: { r: 12.0, inset: 0.4, seat: { outMax: 0.6, outTo: 0.35, inMax: 0.25, inTo: -0.1, sig: 2.2, pocket: 0.3, pocketTo: 0.15 },
    seal: { target: 1.2, ramp: 2.0, floor: 0.4, band: 10, sigma: 1.5, cap: 2.5, skipIris: 0.5 } },
  // lashes: strands (c7 it 18; hair/brow7.js lashMaterial7 -> lashStrands7: per row, n lashes a card and the share of its root width a lash
  // is (hair/face.js LASH_CARD7: the card's own construction), conv (the card's tip / root width: fol's w1, the clump gathering); sd, tip, k:
  // brow7.js LASH_STRANDS7, the hair's own shaft); fol (c4 it 10; the lashes' only path since c7 it 17: the card lashes are not FACE7's face):
  // the rows grown from their follicles (hair/face.js growLashesFol): per lid, up / lo: n (lashes, a young adult), cal (mm at the root), len (mm:
  // medial, middle, lateral), base (deg below the eye's forward axis: the proximal shaft), lift (upper: deg at the tip) / tip (lower: deg at the
  // tip), straight (the share of the length before the curve), bare (the share of the margin medial of the punctum without lashes), rowLift /
  // rowBack (mm: the second row's place), rowLen (its lashes' length share: the inner row is shorter), w1 (the card's tip width over its root: the clump gathering), fan (rad: the medial and lateral lashes'
  // turn outward); age (the losses at laxity 1: count, length, calibre); groups (the group means' factors); loMel (the lower row the
  // upper's pigment). (c7 it 18: loAlpha, the lower row's coverage gain, DELETED: each lash is drawn at its calibre, its coverage its own)
  lashes: { strands: { up: { ...LASH_CARD7.up, conv: 0.65 }, lo: { ...LASH_CARD7.lo, conv: 0.6, ua: 0.40, ub: 0.60 } },
    fol: { up: { n: 150, cal: 0.10, len: [6.5, 10.0, 9.0], base: -5, lift: 55, straight: 0.15, bare: 0.08, rowLift: 0.3, rowBack: 0.15, rowLen: 0.8, w1: 0.65, fan: [0.15, 0.65] },
      lo: { n: 70, cal: 0.075, len: [3.5, 6.5, 6.0], base: -25, tip: -42, straight: 0.45, bare: 0.16, w1: 0.6, fan: [-0.05, 0.5] },
      age: { n: 0.3, len: 0.15, cal: 0.15 }, groups: { asian: { n: 0.85, len: 0.9, cal: 1.15, lift: 0.55, base: -6 }, black: { lift: 1.15 } }, loMel: true } },
  // (it 8; landed 9 Oct; the lids' only path since c7 it 17) the lid as tissue (face7LidTissue): mm, on the
  // drawn eye. up: margin (the anterior edge proud of the eye), sm (how close to the posterior margin it reaches that), pre (the tarsal
  // platform: skin + orbicularis + tarsus), fold (the skin over the crease at least this prouder than the platform), wf (the fold's lower
  // face), fade (mm over the fold's face where the construct hands back to the face), hood (the fold's edge = the crease x (1 - hood
  // lax^1.3)); lo: margin, sm, pre, roll / rollAt / rollW (the pretarsal orbicularis' roll), rollAge (its loss at laxity 1), tarsus (the
  // plate's height), fade; across (the share of the opening's width the parts fade over at each canthus), floor (no lid under this),
  // ant (the lashes root where the margin reaches this share of its thickness)
  lidTissue: { up: { margin: 2.0, sm: 0.6, pre: 2.0, fold: 2.0, wf: 1.2, fade: [1.5, 6], hood: 0.55 },
    lo: { margin: 1.6, sm: 0.6, pre: 1.7, roll: 0.6, rollAt: 2.2, rollW: 1.4, rollAge: 0.5, tarsus: 4.5, fade: 3.5 }, across: 0.15, floor: 0.3, ant: 0.75 },
  // (it 9; landed 9 Oct; the lids' only rest since c7 it 17: the photograph-percentile lift and the young women's narrowing are deleted)
  // the lids' REST from the lid's anatomy (face7Aperture). mm on the drawn eye, in
  // primary gaze: up.cover (the young adult's upper margin under the superior limbus: the levator's resting length), apo / apoP (how far the
  // margin falls at laxity 1 as the aponeurosis stretches: x lax^apoP), muller (the lift Mueller's muscle gives at full sympathetic tone);
  // lo.cover (the young lower margin over the inferior limbus), sag / sagP (how far it sags at laxity 1: the canthal tendon and the tarsus
  // loosening); tone (Mueller's tone: 1 = the alert, attentive rest; less = tired); span (mm over / under the margin the rotation fades over:
  // the skin above folds into the crease, the lid-cheek junction below stays); max (mm at the margin, either way)
  aperture: { up: { cover: 1.5, apo: 1.0, apoP: 2, muller: 2.0 }, lo: { cover: 0.5, sag: 0.8, sagP: 2 }, tone: 1, span: { up: 9, lo: 6 }, max: { up: 4.5, lo: 3.0 } },
  // (c7 it 19) THE EYE'S CAVITY (face/cavity7.js): the skin round each eye lit by the share of the room it can SEE past the lids, the globe and
  // the hair cards (the lash rows, the brow), in SKIN's ambient slot at full strength there; options over cavity7.js CAVITY7 (rays, reach,
  // box...). false: SKIN's proxy alone (the it 19 bench's control arm only: delete it in the next iteration whatever the read)
  cavity: {},
};
// (objects merge over the defaults; a `false` or absent part is the default: every part is the current face and there is no switch back to
// a retired path. Keys a caller may still pass that this file no longer reads (lip, cheek, cal, lids, globe.lift) are ignored.)
const merge = (a, b) => (b && typeof b === 'object' ? { ...a, ...b } : { ...a });
const bySex = (v, s) => (v && typeof v === 'object' && !Array.isArray(v) ? v[s] ?? 0 : v);
const obj = x => (x && typeof x === 'object' ? x : {});

// face7Spec(info, o): o.f7 = {} | { rest, brows, eyes, under, lips, globe, lashes, lidTissue, aperture } (objects merge over the defaults)
export function face7Spec(info, o = {}) {
  const f7 = obj(o.f7), D = F7_DEFAULTS, sex = info.sex === 'm' ? 'm' : 'f', g = obj(f7.globe), fb = obj(f7.brows), lt = obj(f7.lidTissue), ap = obj(f7.aperture), lf = obj(f7.lashes?.fol);
  const brows = { ...D.brows, ...fb, mat: merge(D.brows.mat, fb.mat), fol: merge(D.brows.fol, fb.fol), rim: merge(D.brows.rim, fb.rim) };
  const lidTissue = { ...D.lidTissue, ...lt, up: merge(D.lidTissue.up, lt.up), lo: merge(D.lidTissue.lo, lt.lo) };
  const aperture = { ...D.aperture, ...ap, up: merge(D.aperture.up, ap.up), lo: merge(D.aperture.lo, ap.lo), span: merge(D.aperture.span, ap.span), max: merge(D.aperture.max, ap.max) };
  return { v: FACE7_VERSION, name: info.name, sex, age: info.age ?? 35, group: info.group || 'white', seed: o.seed ?? 1,
    rest: merge(D.rest, f7.rest), brows, eyes: merge(D.eyes, f7.eyes), under: merge(D.under, f7.under), lips: merge(D.lips, f7.lips),
    globe: { ...D.globe, ...g, seat: merge(D.globe.seat, g.seat), seal: merge(D.globe.seal, g.seal) },
    cavity: f7.cavity === false ? false : merge(D.cavity, f7.cavity),
    lashes: { ...D.lashes, strands: f7.lashes?.strands === false ? false : { up: merge(D.lashes.strands.up, f7.lashes?.strands?.up), lo: merge(D.lashes.strands.lo, f7.lashes?.strands?.lo) }, fol: { ...D.lashes.fol, ...lf, up: merge(D.lashes.fol.up, lf.up), lo: merge(D.lashes.fol.lo, lf.lo), age: merge(D.lashes.fol.age, lf.age) } }, lidTissue, aperture };
}

// ---------------------------------------------------------------- the bind read in the photographs' units (it 2)
// bindRead(F, P, E, ctx) -> { ipd (mm), snSto, stoMe (IPD), cheek (the silhouette's width at the stomion over its widest across the
// cheekbones: facepass' cheek_full, read on the mesh from the front), zy (that widest, mm) }. ctx: FACE6's { nb, side, tri }
// the face's width seen from the front at height y0 (mm, the anchors' frame): where the mesh's edges cross that height, the widest left and
// right in front of zMin (the ears and the back of the head out)
export function silhouetteW(Q, tri, nb, y0, zMin) {
  let l = 0, r = 0; const hit = (a, b) => { const ya = Q[a * 3 + 1], yb = Q[b * 3 + 1]; if ((ya - y0) * (yb - y0) > 0 || ya === yb) return; const t = (y0 - ya) / (yb - ya);
    const x = Q[a * 3] + t * (Q[b * 3] - Q[a * 3]), z = Q[a * 3 + 2] + t * (Q[b * 3 + 2] - Q[a * 3 + 2]); if (z < zMin) return; if (x > l) l = x; if (-x > r) r = -x; };
  for (let k = 0; k < tri.length; k += 3) { const a = tri[k], b = tri[k + 1], c = tri[k + 2]; if (a >= nb || b >= nb || c >= nb) continue; hit(a, b); hit(b, c); hit(c, a); }
  return l + r;
}
export function bindRead(F, P, E, ctx) {
  const I = F.ids, nb = ctx.nb, A = FT.faceAnchors(P, I, nb), G = globes(E, ctx.side), Q = new Float64Array(nb * 3);
  for (let v = 0; v < nb; v++) { const q = A.toMm(at(P, v)); Q[v * 3] = q[0]; Q[v * 3 + 1] = q[1]; Q[v * 3 + 2] = q[2]; }
  const ipd = G.L && G.R ? Math.hypot(G.L.c[0] - G.R.c[0], G.L.c[1] - G.R.c[1]) * 1000 : 62, Y = k => A.lm(k)[1];
  const yP = G.L && G.R ? A.toMm([0, 0.5 * (G.L.c[1] + G.R.c[1]), 0])[1] : Y('n') - 12, zT = 0.5 * (A.side('t', 1)[2] + A.side('t', -1)[2]);
  let zy = 0; for (let y = yP - 26; y <= yP - 4; y += 2) zy = Math.max(zy, silhouetteW(Q, ctx.tri, nb, y, zT + 6));
  const wM = silhouetteW(Q, ctx.tri, nb, Y('sto'), zT);   // (in front of the tragion: the ear lobes out)
  return { ipd: +ipd.toFixed(2), snSto: +((Y('sn') - Y('sto')) / ipd).toFixed(4), stoMe: +((Y('sto') - Y('me')) / ipd).toFixed(4), cheek: +(wM / Math.max(1, zy)).toFixed(4), zy: +zy.toFixed(2), wMouth: +wM.toFixed(2) };
}
// FACE6's expression defaults under rev 8 (the rest nearer the rest-face photos); the person's own f6.expr wins
export function f6ExprOf(f7, f6expr) {
  if (!f7?.rest) return f6expr; const r = f7.rest, s = f7.sex;
  return { base: bySex(r.base, s), rest: r.rest, cap: r.cap, duchenne: r.duchenne, ...(f6expr && typeof f6expr === 'object' ? f6expr : {}) };
}

// ---------------------------------------------------------------- instruments (describe; other lanes read them too: ANAT8-HEAD's labs)
// frontGlobes: a sphere fitted to the front cap of each eye proxy (globeCover's default globe)
export function frontGlobes(E, side) {
  const out = {};
  for (const [s, sv] of [['L', 1], ['R', 0]]) { const ix = []; for (let i = 0; i < E.length / 3; i++) if (side[i] === sv) ix.push(i); if (ix.length < 8) continue;
    let zmax = -Infinity; for (const i of ix) zmax = Math.max(zmax, E[i * 3 + 2]); const pts = ix.filter(i => E[i * 3 + 2] > zmax - 0.006);
    const A = Array.from({ length: 4 }, () => new Float64Array(5));
    for (const i of pts) { const x = E[i * 3], y = E[i * 3 + 1], z = E[i * 3 + 2], a = [2 * x, 2 * y, 2 * z, 1], b = x * x + y * y + z * z; for (let r = 0; r < 4; r++) { A[r][4] += a[r] * b; for (let c = 0; c < 4; c++) A[r][c] += a[r] * a[c]; } }
    for (let i = 0; i < 4; i++) { let q = i; for (let j = i + 1; j < 4; j++) if (Math.abs(A[j][i]) > Math.abs(A[q][i])) q = j; [A[i], A[q]] = [A[q], A[i]]; for (let j = 0; j < 4; j++) if (j !== i) { const f = A[j][i] / A[i][i]; for (let k = i; k < 5; k++) A[j][k] -= f * A[i][k]; } }
    const x = [0, 1, 2, 3].map(i => A[i][4] / A[i][i]); out[s] = { c: x.slice(0, 3), R: Math.sqrt(x[3] + x[0] ** 2 + x[1] ** 2 + x[2] ** 2) }; }
  return out;
}
// ---------------------------------------------------------------- the globe's cover outside the lids (it 3; the orchestrator's L08 finding)
// What the rendered globe shows of itself from the front: eyes.js and person_scene.py both draw the sphere fitted to the eye shell's front
// cap (frontGlobes; FACE6's globes() is a different sphere, the proxy's back half, 15 mm: the lids are seated on that one). Rays along the
// face's axis on a 0.25 mm grid over the globe's disc against the skin's frontmost surface. The APERTURE is the visible part connected to
// the cornea (after a 1 mm erosion, so a hairline bridge at a canthus does not join a separate patch); POKE is any other visible part (the
// globe out through the skin); COVER is the skin's thickness in front of the globe along the axis (mm).
// coverGrid(P, tri, nb, g) -> { N, cm, x0, y0, zs, vis, disc, cov, A, dA (mm from the aperture; 0 inside) }
export function coverGrid(P, tri, nb, g, cell = 0.25, poly = null) {
  const c = g.c, R = g.R, h = R, cm = cell / 1000, N = Math.ceil(2 * h / cm), x0 = c[0] - h, y0 = c[1] - h, zs = new Float64Array(N * N).fill(-Infinity);
  for (let t = 0; t < tri.length; t += 3) { const a = tri[t], b = tri[t + 1], d = tri[t + 2]; if (a >= nb || b >= nb || d >= nb) continue;
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2], bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2], dx = P[d * 3], dy = P[d * 3 + 1], dz = P[d * 3 + 2];
    if (Math.max(az, bz, dz) < c[2] - R) continue;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, dx) - x0) / cm)), i1 = Math.min(N - 1, Math.floor((Math.max(ax, bx, dx) - x0) / cm)), j0 = Math.max(0, Math.floor((Math.min(ay, by, dy) - y0) / cm)), j1 = Math.min(N - 1, Math.floor((Math.max(ay, by, dy) - y0) / cm));
    if (i0 > i1 || j0 > j1) continue; const den = (by - dy) * (ax - dx) + (dx - bx) * (ay - dy); if (Math.abs(den) < 1e-14) continue;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const x = x0 + (i + 0.5) * cm, y = y0 + (j + 0.5) * cm;
      const l1 = ((by - dy) * (x - dx) + (dx - bx) * (y - dy)) / den, l2 = ((dy - ay) * (x - dx) + (ax - dx) * (y - dy)) / den, l3 = 1 - l1 - l2;
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue; const z = l1 * az + l2 * bz + l3 * dz, k = j * N + i; if (z > zs[k]) zs[k] = z; } }
  const vis = new Uint8Array(N * N), cov = new Float64Array(N * N).fill(NaN), disc = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = x0 + (i + 0.5) * cm - c[0], y = y0 + (j + 0.5) * cm - c[1], rho = Math.hypot(x, y); if (rho >= R) continue;
    const k = j * N + i, zg = c[2] + Math.sqrt(R * R - rho * rho); disc[k] = 1; cov[k] = (zs[k] - zg) * 1000; if (!(zs[k] > zg)) vis[k] = 1; }
  const r1 = Math.round(1 / cell), grow = (src, r, keep) => { const o = new Uint8Array(N * N); for (let k = 0; k < N * N; k++) if (src[k]) { const i = k % N, j = (k - i) / N;
    for (let q = -r; q <= r; q++) for (let p = -r; p <= r; p++) { if (p * p + q * q > r * r) continue; const ii = i + p, jj = j + q; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue; const kk = jj * N + ii; if (!keep || keep[kk]) o[kk] = 1; } } return o; };
  const er = new Uint8Array(N * N); for (let k = 0; k < N * N; k++) { if (!vis[k]) continue; const i = k % N, j = (k - i) / N; let ok = 1;
    for (let q = -r1; q <= r1 && ok; q++) for (let p = -r1; p <= r1; p++) { if (p * p + q * q > r1 * r1) continue; const ii = i + p, jj = j + q; if (ii < 0 || jj < 0 || ii >= N || jj >= N || !vis[jj * N + ii]) { ok = 0; break; } } er[k] = ok; }
  let seed = -1, best = Infinity; for (let k = 0; k < N * N; k++) if (er[k]) { const i = k % N, j = (k - i) / N, dd = Math.hypot(i + 0.5 - N / 2, j + 0.5 - N / 2); if (dd < best) { best = dd; seed = k; } }
  const comp = new Uint8Array(N * N); if (seed >= 0) { const st = [seed]; comp[seed] = 1; while (st.length) { const k = st.pop(), i = k % N, j = (k - i) / N;
    for (const [p, q] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + p, jj = j + q; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue; const kk = jj * N + ii; if (er[kk] && !comp[kk]) { comp[kk] = 1; st.push(kk); } } } }
  let A = grow(comp, r1 + 1, vis); for (let it = 0; it < 3; it++) A = grow(A, 1, vis);   // (back out to the margin inside vis)
  // (it 4) the aperture as the lid margin ring's own outline (projected along the axis; one cell of slack), when given
  if (poly) { A = new Uint8Array(N * N); for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (inPoly(x0 + (i + 0.5) * cm, y0 + (j + 0.5) * cm, poly)) A[j * N + i] = 1; A = grow(A, 1, null); }
  // distance from the aperture (mm; a two-pass chamfer over the grid)
  const dA = new Float64Array(N * N).fill(1e9); for (let k = 0; k < N * N; k++) if (A[k]) dA[k] = 0; const s2 = Math.SQRT2 * cell;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const k = j * N + i; if (i > 0) dA[k] = Math.min(dA[k], dA[k - 1] + cell); if (j > 0) { dA[k] = Math.min(dA[k], dA[k - N] + cell); if (i > 0) dA[k] = Math.min(dA[k], dA[k - N - 1] + s2); if (i < N - 1) dA[k] = Math.min(dA[k], dA[k - N + 1] + s2); } }
  for (let j = N - 1; j >= 0; j--) for (let i = N - 1; i >= 0; i--) { const k = j * N + i; if (i < N - 1) dA[k] = Math.min(dA[k], dA[k + 1] + cell); if (j < N - 1) { dA[k] = Math.min(dA[k], dA[k + N] + cell); if (i < N - 1) dA[k] = Math.min(dA[k], dA[k + N + 1] + s2); if (i > 0) dA[k] = Math.min(dA[k], dA[k + N - 1] + s2); } }
  return { N, cm, cell, x0, y0, zs, vis, disc, cov, A, dA, at: (x, y) => { const i = Math.floor((x - x0) / cm), j = Math.floor((y - y0) / cm); return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i; } };
}
// globeCover(P, tri, nb, E, side) -> per eye { poke (mm2), pokeMax (mm), pokeAt (deg round the eye: 0 temporal, 90 up, 180 nasal, 270
// down), thin (mm2 of the band 1-8 mm outside the aperture covered by < `need` mm: the first mm is the lid margin's own rounding onto the
// globe), minCover (mm, in that band), thinBy30 (mm2 per 30-degree sector), aperture (mm2) }
export function globeCover(P, tri, nb, E, side, { band = 8, need = 0.8, cell = 0.25, map = false, G: G0 = null, F = null } = {}) {
  const G = G0 || frontGlobes(E, side), out = {}, rings = G0 && F ? ringPolys(F, P, G0) : null;
  for (const [s, g] of Object.entries(G)) { const sg = s === 'L' ? 1 : -1, Q = coverGrid(P, tri, nb, g, cell, rings?.[s] || null), { N, vis, disc, cov, A, dA } = Q, a2 = cell * cell;
    const ang = k => { const i = k % N, j = (k - i) / N, x = (i + 0.5 - N / 2) * sg, y = j + 0.5 - N / 2; return Math.round(((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360); };
    let poke = 0, pokeMax = 0, pokeAt = null, thin = 0, minCover = Infinity, ap = 0; const sec = new Set(), tsec = new Float64Array(12);
    // the opening's height over the globe's axis (mm: the aperture's extent in the columns within 1 mm of the centre: MediaPipe's lid gap)
    let apH = 0; { const ic = Math.floor(N / 2), w = Math.round(1 / cell); for (let i = ic - w; i <= ic + w; i++) { let lo = Infinity, hi = -Infinity; for (let j = 0; j < N; j++) if (A[j * N + i]) { lo = Math.min(lo, j); hi = Math.max(hi, j); } if (hi >= lo) apH = Math.max(apH, (hi - lo + 1) * cell); } }
    for (let k = 0; k < N * N; k++) { if (!disc[k]) continue; if (A[k]) { ap += a2; continue; }
      if (vis[k]) { poke += a2; const dz = -cov[k]; if (Number.isFinite(dz) && dz > pokeMax) { pokeMax = dz; pokeAt = ang(k); } if (pokeAt == null) pokeAt = ang(k); sec.add(Math.floor(ang(k) / 10)); continue; }
      if (dA[k] >= 1 && dA[k] <= band) { if (cov[k] < need) { thin += a2; tsec[Math.floor(ang(k) / 30) % 12] += a2; } if (cov[k] < minCover) minCover = cov[k]; } }
    out[s] = { poke: +poke.toFixed(2), pokeMax: +pokeMax.toFixed(2), pokeAt, pokeArc: sec.size * 10, thin: +thin.toFixed(1), minCover: +minCover.toFixed(2), aperture: +ap.toFixed(1), apH: +apH.toFixed(2), R: +(g.R * 1000).toFixed(2),
      thinBy30: Array.from(tsec, v => +v.toFixed(1)), ...(map ? { map: { N, cell, vis: Array.from(vis), A: Array.from(A), cov: Array.from(cov, v => Number.isFinite(v) ? +v.toFixed(2) : null), sg } } : {}) }; }
  return out;
}
// face7Seal(F, P, E, ctx, o) -> { P, report }: the skin outside the aperture brought forward (along the face's axis, so nothing slides
// sideways and the landmarks keep their x, y) until it covers the rendered globe by o.target mm, ramping from 0 at the aperture's edge (the
// lid margin stays where FACE6 seated it: the margin's own thickness is that first o.ramp mm) to the full cover; the push spread over
// o.sigma mm (a soft maximum, so the lid's surface stays smooth), capped at o.cap mm. Only front-surface vertices move (the lid's inner fold
// and the socket behind it do not).
export function face7Seal(F, P0, E, ctx, o, G0 = null) {
  const P = new Float32Array(P0), { nb, tri, side } = ctx, G = G0 || frontGlobes(E, side), R = {}, ring = new Set([...(F.lid?.L || []), ...(F.lid?.R || [])]), rings = G0 ? ringPolys(F, P, G0) : null;
  for (const [s, g] of Object.entries(G)) { const Q = coverGrid(P, tri, nb, g, 0.25, rings?.[s] || null), c = g.c, req = [];
    const rIris = o.skipIris != null ? (g.rl ?? 0.006) + o.skipIris / 1000 : -1;   // (it 5) over the cornea the lid is the eye's own edge, not a hook: left to the aperture
    for (let v = 0; v < nb; v++) { if (ring.has(v)) continue; const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2], rho = Math.hypot(x - c[0], y - c[1]); if (rho >= g.R * 0.985 || rho < rIris) continue;
      const k = Q.at(x, y); if (k < 0 || Q.A[k] || Q.dA[k] > o.band) continue; if (z < Q.zs[k] - 0.0008) continue;   // (behind the front surface)
      const zg = c[2] + Math.sqrt(g.R * g.R - rho * rho), cov = (z - zg) * 1000, want = Math.max(o.floor ?? 0, o.target * sst(0, o.ramp, Q.dA[k])), r = want - cov; if (r > 0.01) req.push([v, Math.min(o.cap, r)]); }
    // the soft maximum over the front surface near the eye
    const D = new Map(), s2 = 2 * (o.sigma / 1000) ** 2, reach = 3 * o.sigma / 1000;
    for (const [v, r] of req) { const px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2];
      for (let u = 0; u < nb; u++) { if (ring.has(u)) continue; const dx = P[u * 3] - px; if (dx > reach || dx < -reach) continue; const dy = P[u * 3 + 1] - py; if (dy > reach || dy < -reach) continue; const dz = P[u * 3 + 2] - pz; if (dz > reach || dz < -reach) continue;
        const k = Q.at(P[u * 3], P[u * 3 + 1]); if (k >= 0 && (Q.A[k] || P[u * 3 + 2] < Q.zs[k] - 0.0008)) continue;   // (front surface outside the aperture only)
        const w = r * Math.exp(-(dx * dx + dy * dy + dz * dz) / s2); if (w > (D.get(u) || 0)) D.set(u, w); } }
    let mx = 0; for (const [u, d] of D) { P[u * 3 + 2] += d / 1000; mx = Math.max(mx, d); }
    R[s] = { verts: req.length, moved: D.size, maxMm: +mx.toFixed(2) }; }
  return { P, report: R };
}

// ---------------------------------------------------------------- it 4: ONE GLOBE
// Three spheres stood for one eye until it 4: FACE6 seated the lids on globes() (the proxy's back half, ~15 mm), it 3's gate and seal read
// frontGlobes() (the front cap of all the proxy's parts, 8.8-11.4 mm), and eyes.js / person_scene.py DRAW fitEyes' sphere (the OUTER shell's
// front cap, 13.6-14 mm, its centre ~1.9 mm further back): at 10-12 mm off the axis the drawn sclera stood 1-3 mm in front of the sphere
// the seal covered, which is why L08's hooks outlived it 3. drawnGlobes is fitEyes' rule on the bind (the same numbers; checked in node
// against the built eye), resized by o.r (mm, the corneal apex kept) as eyes.js resizes what it draws under f7.globe.
// drawnGlobes(E, idxE, side, { r, inset, rl }) -> { L, R: { c: [x, y, z] the DRAWN sphere's centre (inset applied), R, rFit, apex } }
function fitSphere4(pts) {
  const A = Array.from({ length: 4 }, () => new Float64Array(5));
  for (const p of pts) { const a = [2 * p[0], 2 * p[1], 2 * p[2], 1], b = p[0] ** 2 + p[1] ** 2 + p[2] ** 2; for (let r = 0; r < 4; r++) { A[r][4] += a[r] * b; for (let c = 0; c < 4; c++) A[r][c] += a[r] * a[c]; } }
  for (let i = 0; i < 4; i++) { let p = i; for (let j = i + 1; j < 4; j++) if (Math.abs(A[j][i]) > Math.abs(A[p][i])) p = j; [A[i], A[p]] = [A[p], A[i]];
    for (let j = 0; j < 4; j++) if (j !== i) { const f = A[j][i] / A[i][i]; for (let k = i; k < 5; k++) A[j][k] -= f * A[i][k]; } }
  const x = [0, 1, 2, 3].map(i => A[i][4] / A[i][i]); return { c: [x[0], x[1], x[2]], r: Math.sqrt(x[3] + x[0] ** 2 + x[1] ** 2 + x[2] ** 2) };
}
export function drawnGlobes(E, idxE, side, o = {}) {
  const n = E.length / 3, par = Int32Array.from({ length: n }, (_, i) => i), f = i => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
  for (let t = 0; t < idxE.length; t += 3) { const a = f(idxE[t]), b = f(idxE[t + 1]), c = f(idxE[t + 2]); par[b] = a; par[f(c)] = a; }
  const comps = new Map(); for (let i = 0; i < n; i++) { const k = f(i); if (!comps.has(k)) comps.set(k, []); comps.get(k).push(i); }
  const out = {}, rl = (o.rl ?? 6) / 1000, inset = (o.inset ?? 0.4) / 1000, kc = rr => rr * Math.cos(Math.asin(Math.min(0.99, rl / rr)));
  for (const [s, sv] of [['L', 1], ['R', -1]]) { const cs = [...comps.values()].filter(vs => Math.sign(E[vs[0] * 3]) === sv); if (!cs.length) continue;
    const zmaxOf = vs => { let m = -Infinity; for (const i of vs) m = Math.max(m, E[i * 3 + 2]); return m; }, outer = cs.sort((a, b) => zmaxOf(b) - zmaxOf(a))[0], zmax = zmaxOf(outer);
    const fit = fitSphere4(outer.filter(i => E[i * 3 + 2] > zmax - 0.006).map(i => [E[i * 3], E[i * 3 + 1], E[i * 3 + 2]]));
    const r = o.r ? o.r / 1000 : fit.r, c = [fit.c[0], fit.c[1], fit.c[2] + kc(fit.r) - kc(r) - inset];
    out[s] = { c, R: r, rFit: fit.r, apex: zmax, rl, rc: (o.rc ?? 7.8) / 1000 }; }
  return out;
}
// (it 5) the drawn eye's SURFACE radius along a unit direction d from the globe's centre (eyes.js eyeGeometry: the corneal cap rc in front of
// the limbus, the globe behind it): what a lid margin rests on. Over the iris the cornea stands up to 1.2 mm proud of the 12 mm sphere, so a
// margin seated 0.35 mm off the SPHERE (it 4) lay up to 0.85 mm INSIDE the cornea there.
export function eyeSurfR(g, d) {
  const R = g.R, rl = g.rl ?? 0.006, rc = g.rc ?? 0.0078, thL = Math.asin(Math.min(0.99, rl / R)), zcc = R * Math.cos(thL) - Math.sqrt(rc * rc - rl * rl);
  if (d[2] <= Math.cos(thL)) return R; return Math.max(R, zcc * d[2] + Math.sqrt(Math.max(0, rc * rc - zcc * zcc * (1 - d[2] * d[2]))));
}
// the visible lid margin (the loop's vertices outside R - 2 mm; the rest is the conjunctival fold behind the globe, as FACE6's seatLids)
export function visibleMargin(F, P, s, g) { return (F.lid?.[s] || []).filter(v => Math.hypot(P[v * 3] - g.c[0], P[v * 3 + 1] - g.c[1], P[v * 3 + 2] - g.c[2]) > g.R - 0.002); }
function inPoly(px, py, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) c = !c; } return c; }
// the visible margin's outline seen along the axis (a star-shaped polygon round its centroid), per eye
export function ringPolys(F, P, G) {
  const out = {};
  for (const [s, g] of Object.entries(G)) { const L = visibleMargin(F, P, s, g); if (L.length < 6) continue; const q = L.map(v => [P[v * 3], P[v * 3 + 1]]), cx = q.reduce((a, p) => a + p[0], 0) / q.length, cy = q.reduce((a, p) => a + p[1], 0) / q.length;
    out[s] = q.sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx)); }
  return out;
}
// the visible margin's gap to the globe (mm: + off it, - sunk in), per eye
export function marginGap(F, P, G) {
  const out = {};
  for (const [s, g] of Object.entries(G)) { const L = visibleMargin(F, P, s, g); if (!L.length) continue;
    // (it 5: against the eye's surface, the cornea over the iris, when the globe carries its limbus; it 4 read the sphere)
    const d = L.map(v => { const dv = [P[v * 3] - g.c[0], P[v * 3 + 1] - g.c[1], P[v * 3 + 2] - g.c[2]], r = Math.hypot(...dv); return (r - (g.rl ? eyeSurfR(g, dv.map(x => x / r)) : g.R)) * 1000; }).sort((a, b) => a - b);
    out[s] = { n: L.length, min: +d[0].toFixed(2), p50: +d[d.length >> 1].toFixed(2), max: +d[d.length - 1].toFixed(2), off06: d.filter(x => x > 0.6).length, sunk: d.filter(x => x < -0.25).length }; }
  return out;
}
// (it 5) irisLids(P, tri, nb, G, rl) -> per eye, seen along the face's axis (the square-on plate): mrd1 / mrd2 (mm: the iris centre, i.e.
// the corneal apex, to the first skin above / below it on the drawn globe: the margin-reflex distances), cov (the share of the iris radius
// rl the upper lid covers: lid_read.py's cov_up on the photographs), show (the lower lid below the limbus' bottom, in iris radii: show_dn),
// lat / med (mm2 of the globe visible outside the limbus on the temporal / nasal side: the white wedges of the eye), apW (mm, the
// opening's width through the apex' row)
// the opening on the drawn eye seen along the axis: the largest connected patch of the eye's surface with no skin in front of it, its top
// and bottom per column (mm over / under the globe's centre; NaN outside it), its x extent (mm), and the cell grid
export function openingProfile(P, tri, nb, g, rl = 6, rc = 7.8, cell = 0.25) {
  const Q = coverGrid(P, tri, nb, g, cell, null), { N, zs } = Q, R = g.R * 1000, thL = Math.asin(Math.min(0.99, rl / R)), zcc = R * Math.cos(thL) - Math.sqrt(rc * rc - rl * rl), c = g.c;
  const vis = new Uint8Array(N * N), lab = new Int32Array(N * N).fill(-1), dzs = new Float64Array(N * N).fill(NaN);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = (i + 0.5 - N / 2) * cell, y = (j + 0.5 - N / 2) * cell, rho = Math.hypot(x, y); if (rho >= R * 0.995) continue;
    const ze = rho < rl ? zcc + Math.sqrt(rc * rc - rho * rho) : Math.sqrt(R * R - rho * rho), k = j * N + i, dz = (zs[k] - c[2]) * 1000 - ze; dzs[k] = dz; if (!(dz > 0)) vis[k] = 1; }
  let best = -1, bestN = 0, nl = 0; const sizes = [];
  for (let k = 0; k < N * N; k++) { if (!vis[k] || lab[k] >= 0) continue; const st = [k]; lab[k] = nl; let n = 0;
    while (st.length) { const q = st.pop(), i = q % N, j = (q - i) / N; n++; for (const [p2, q2] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + p2, jj = j + q2; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue; const kk = jj * N + ii; if (vis[kk] && lab[kk] < 0) { lab[kk] = nl; st.push(kk); } } }
    sizes.push(n); if (n > bestN) { bestN = n; best = nl; } nl++; }
  const yU = new Float64Array(N).fill(NaN), yL = new Float64Array(N).fill(NaN); let xMin = Infinity, xMax = -Infinity;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const k = j * N + i; if (lab[k] !== best || best < 0) continue; const x = (i + 0.5 - N / 2) * cell, y = (j + 0.5 - N / 2) * cell;
    if (!(y <= yU[i])) yU[i] = Number.isNaN(yU[i]) ? y + cell / 2 : Math.max(yU[i], y + cell / 2); if (!(y >= yL[i])) yL[i] = Number.isNaN(yL[i]) ? y - cell / 2 : Math.min(yL[i], y - cell / 2); xMin = Math.min(xMin, x); xMax = Math.max(xMax, x); }
  return { N, cell, vis, lab, best, dzs, yU, yL, xMin, xMax, at: x => { const i = Math.floor(x / cell + N / 2); return i < 0 || i >= N ? -1 : i; } };
}
// (it 5) irisLids(P, tri, nb, G, rl, rc) -> per eye, seen along the face's axis (the square-on plate), on the eye eyes.js DRAWS (the corneal
// cap rc in front of the limbus rl, the globe behind): mrd1 / mrd2 (mm: the corneal apex, the iris centre, to the opening's top / bottom in
// its column: the margin-reflex distances; mrd1 < 0 when the upper lid covers the pupil), cov (the share of the iris radius the upper lid
// covers: lid_read.py's cov_up), show (the lower lid under the limbus' bottom, in iris radii: show_dn), lat / med (mm2 of the opening
// outside the limbus, temporal / nasal: the white wedges), iris (the share of the iris disc in the opening), apW (mm, the opening's width)
export function irisLids(P, tri, nb, G, rl = 6, rc = 7.8) {
  const out = {};
  for (const [s, g] of Object.entries(G)) { const sg = s === 'L' ? 1 : -1, O = openingProfile(P, tri, nb, g, rl, rc), { N, cell, lab, best, yU, yL } = O, ic = Math.floor(N / 2), a2 = cell * cell;
    if (best < 0) { out[s] = { mrd1: null, mrd2: null, cov: 1, show: -1, lat: 0, med: 0, iris: 0, apW: 0 }; continue; }
    let i0 = ic; if (Number.isNaN(yU[i0])) { let d = 1; while (d < N && Number.isNaN(yU[ic + d] ?? NaN) && Number.isNaN(yU[ic - d] ?? NaN)) d++; i0 = !Number.isNaN(yU[ic + d] ?? NaN) ? ic + d : ic - d; }
    const mrd1 = yU[i0], mrd2 = -yL[i0]; let lat = 0, med = 0, iris = 0, irisAll = 0;
    for (let k = 0; k < N * N; k++) { const i = k % N, j = (k - i) / N, x = (i + 0.5 - N / 2) * cell * sg, y = (j + 0.5 - N / 2) * cell, r = Math.hypot(x, y); if (r <= rl) irisAll += a2;
      if (lab[k] !== best) continue; if (r > rl) { if (x > 0) lat += a2; else med += a2; } else iris += a2; }
    out[s] = { mrd1: +mrd1.toFixed(2), mrd2: +mrd2.toFixed(2), cov: +(1 - mrd1 / rl).toFixed(3), show: +(mrd2 / rl - 1).toFixed(3), lat: +lat.toFixed(1), med: +med.toFixed(1), iris: +(iris / irisAll).toFixed(3),
      apW: +(O.xMax - O.xMin + cell).toFixed(2), dzApex: +(O.dzs[ic * N + ic] ?? NaN).toFixed(2) }; }
  return out;
}
// face7Seat(F, P, G, ctx, o) -> { P, report }: the visible margin seated on the DRAWN globe (FACE6's seatLids' rule on the right sphere,
// with tighter limits: the margin rests on the globe, its skin within ~o.sig mm follows; the loop's own vertices take only their own move)
// (EYES-FIX, 16 Oct) ONLY WHERE THE EYE IS UNDER THE MARGIN, NASALLY: a margin vertex NASAL of the globe's silhouette (its distance from the
// eye's axis beyond R + the gap wanted, on the midline's side) is left where it is: that is the medial commissure, which the medial canthal
// tendon holds over the lacrimal lake and the caruncle (face9: anatomy/head/membrane.js canthalTendons), off the globe. The radial pull
// moved it TOWARD THE AXIS onto the 12 mm sphere, shortening the opening (labs/eyes/eye7_fissure.mjs: L22 / L21 en-ex 30.4 / 30.1 after face9,
// 24.3 / 24.0 after this seat). The LATERAL commissure is still seated: its tendon holds it against the globe (the lateral canthal angle is
// apposed to the globe), and left past the silhouette it opened a slot into the socket (L22 96, L21 43 cells of 0.25 mm on the rev-7 bakes).
// (A seat along the eye's axis everywhere was tried: it kept the width but its depth moves near the silhouette folded the skin: L08 190
// sharp edges round the eye against 137; dropped.)
export function face7Seat(F, P0, G, ctx, o) {
  const P = new Float32Array(P0), R = { before: marginGap(F, P0, G) }, sig = (o.sig ?? 2.2) / 1000;
  for (const [s, g] of Object.entries(G)) { const corr = new Map();
    for (const v of visibleMargin(F, P0, s, g)) { const p = at(P0, v), dv = [p[0] - g.c[0], p[1] - g.c[1], p[2] - g.c[2]], r = Math.hypot(...dv), gap = r - eyeSurfR(g, dv.map(x => x / r));
      const want = gap > o.outMax / 1000 ? o.outTo / 1000 : gap < -o.inMax / 1000 ? o.inTo / 1000 : gap; if (Math.abs(want - gap) < 1e-6) continue;
      if (dv[0] * g.c[0] < 0 && Math.hypot(dv[0], dv[1]) >= g.R + want) continue;   // nasal of the globe's silhouette: the medial commissure, left where its tendon holds it
      corr.set(v, dv.map(x => x / r * (want - gap))); }
    if (!corr.size) continue;
    const C = [...corr.entries()].map(([v, d]) => [at(P0, v), d]), ring = new Set(F.lid?.[s] || []);
    for (let v = 0; v < ctx.nb; v++) { if (ring.has(v)) continue; const p = at(P0, v); if (Math.hypot(p[0] - g.c[0], p[1] - g.c[1], p[2] - g.c[2]) > g.R + 0.012) continue;
      let wx = 0, wy = 0, wz = 0, ws = 0; for (const [c, d] of C) { const e = ((p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2) / (sig * sig); if (e > 16) continue; const k = Math.exp(-0.5 * e); wx += k * d[0]; wy += k * d[1]; wz += k * d[2]; ws += k; }
      if (ws > 1e-3) { const f = Math.min(1, ws) / ws; P[v * 3] += wx * f; P[v * 3 + 1] += wy * f; P[v * 3 + 2] += wz * f; } }
    for (const [v, d] of corr) for (let a = 0; a < 3; a++) P[v * 3 + a] += d[a];
    R[s] = { moved: corr.size, maxMm: +(Math.max(...[...corr.values()].map(d => Math.hypot(...d))) * 1000).toFixed(2) }; }
  // the canthal pocket: the loop's vertices the visible-margin rule leaves out (more than 2 mm inside the globe) are not all conjunctival
  // fold: at the lateral canthus hm08's loop turns 5 mm BEHIND the globe's front (L08: ex and its seven neighbours, 2.4-3 mm inside the
  // sphere), so the drawn sclera stood in front of the canthal angle and showed past it: the hook's root. Every loop vertex inside the
  // globe's disc and more than o.pocket mm behind its front comes forward ALONG THE AXIS (x, y kept: ex and the fissure's width stay) to
  // o.pocketTo mm behind it: the canthal angle on the globe. The skin round it is the seal's (next).
  if (o.pocket != null) for (const [s, g] of Object.entries(G)) { let n = 0, mx = 0;
    for (const v of F.lid?.[s] || []) { const x = P[v * 3] - g.c[0], y = P[v * 3 + 1] - g.c[1], rho = Math.hypot(x, y); if (rho >= g.R * 0.995) continue;
      const zg = g.c[2] + Math.sqrt(g.R * g.R - rho * rho), cov = (P[v * 3 + 2] - zg) * 1000; if (cov >= -o.pocket) continue;
      const dz = -o.pocketTo - cov; P[v * 3 + 2] += dz / 1000; n++; mx = Math.max(mx, dz); }
    R[s] = { ...(R[s] || {}), pocket: n, pocketMm: +mx.toFixed(2) }; }
  R.after = marginGap(F, P, G);
  return { P, report: R };
}

// liftField(F, P, g, s, o, ctx) -> Map(vertex -> weight): how much of a lid's rotation over the globe each vertex takes (face7Aperture: the
// lid moves the way its muscles move it: rotated about the axis through the globe's centre, so it stays wrapped on the eye), most at the
// margin and over the pupil, fading to the canthi (the canthal tendons hold them) and over o.span mm up (o.lo: down) the lid.
export function liftField(F, P, g, s, o, ctx) {
  // the lid's EDGE is where it occludes the eye (openingProfile), not hm08's margin loop: on L05 and L23 the hooded upper lid's lowest skin
  // hangs 1-2 mm in front of the eye between two loop vertices 10 mm apart. Per column: from the opening's middle up (a vertex under it is
  // the lower lid's) to o.span mm over its top, fading; across: from the opening's middle to its ends (the canthi stay)
  const O = openingProfile(P, ctx.tri, ctx.nb, g, (g.rl ?? 0.006) * 1000, (g.rc ?? 0.0078) * 1000); if (O.best < 0) return null;
  const c = g.c, xm = (O.xMin + O.xMax) / 2, hw = (O.xMax - O.xMin) / 2, span = o.span, ring = new Set(F.lid?.[s] || []), W = new Map();
  const colOf = x => { let i = O.at(x); if (i < 0) return null; if (Number.isNaN(O.yU[i])) { const ii = x < xm ? O.at(O.xMin) : O.at(O.xMax); i = ii; } return Number.isNaN(O.yU[i]) ? null : [O.yU[i], O.yL[i]]; };
  for (let v = 0; v < P.length / 3; v++) { const dx = (P[v * 3] - c[0]) * 1000, dy = (P[v * 3 + 1] - c[1]) * 1000, dz = (P[v * 3 + 2] - c[2]) * 1000;
    if (Math.abs(dx - xm) > hw + 1 || dz < -6 || Math.hypot(dx, dy, dz) > g.R * 1000 + 12) continue;
    const wx = 1 - sst(0.3 * hw, 0.95 * hw, Math.abs(dx - xm)); if (wx < 1e-3) continue; const col = colOf(dx); if (!col) continue; const [yu, yl] = col, mid = (yu + yl) / 2;
    const k0 = Math.min(1.2, 0.4 * (yu - yl) + 0.2), front = ring.has(v) || dz > 0 ? 1 : 0;   // (it 9: o.lo, the lower lid's field, mirrored)
    const wy = (o.lo ? sst(-mid, -mid + k0, -dy) * (1 - sst(-yl + 0.8, -yl + span, -dy)) : sst(mid, mid + k0, dy) * (1 - sst(yu + 0.8, yu + span, dy))) * front; if (wx * wy > 1e-3) W.set(v, wx * wy); }
  return W;
}
function rotLid(P0, W, c, th) { const P = new Float32Array(P0);
  for (const [v, w] of W) { const a = th * w, ca = Math.cos(a), sa = Math.sin(a), y = P[v * 3 + 1] - c[1], z = P[v * 3 + 2] - c[2]; P[v * 3 + 1] = c[1] + y * ca + z * sa; P[v * 3 + 2] = c[2] - y * sa + z * ca; }
  return P; }

// ---------------------------------------------------------------- it 9: THE LIDS' REST FROM THE LID'S ANATOMY (landed 9 Oct; the only rest since c7 it 17)
// Until it 9 the upper lid's height was a NUMBER: raised (face7Lift) to the c3 portraits' p40 margin-reflex distance (0.050 / 0.044 IPD,
// ~2.7-3.1 mm), never lowered; the young women's opening narrowed first (lids.narrow, MakeHuman eye-height2-decr: v6's 'stare'); the lower
// lid left where hm08 and FACE6 put it. On the twelve that is an upper margin 2.5-3.25 mm over the iris centre (covering about half the
// iris' upper radius) and a lower margin 0.75-1.75 mm over the inferior limbus: a 7-7.75 mm opening, the critics' 'half-shut eye'. The
// portraits were the wrong measure: mostly daylight, many smiling (people squint in sun; a smile lifts the cheek into the lower lid), and
// MediaPipe's lid contour is the lash line. A lid at rest is where its anatomy holds it (oculoplastic anatomy as recalled from the
// standard texts, said so; the numbers are those texts' norms, not fitted to a render or a photograph):
//   upper  the levator palpebrae (from the orbit's apex over Whitnall's ligament to its aponeurosis on the tarsus) at its resting tone,
//          with Mueller's muscle (sympathetic, ~2 mm of lift) holds the margin 1-2 mm under the superior limbus in primary gaze (MRD1
//          ~4-5 mm in young adults); with age the aponeurosis stretches and loosens from the tarsus (involutional ptosis) and the margin
//          falls; a tired face loses Mueller's tone. cover = up.cover + up.apo lax^apoP + up.muller (1 - tone).
//   lower  the lower lid's retractors and the canthal tendons hold its margin at the inferior limbus or a hair over it (MRD2 ~5-5.5);
//          with age the tendons and the tarsus loosen and it sags (inferior scleral show). cover = lo.cover - lo.sag lax^sagP.
// lax is FACE6's laxity(age) (face_tissue.js), the same tissue state that hangs the fold (lidTissue's hood) and thins the lower roll.
// Each margin is then moved the way its muscles move it: the lid rotated over the globe about the axis through the globe's centre (it stays
// wrapped on the eye), most at the margin and over the pupil, fading to the canthi (the tendons hold them) and over span mm up / down the
// lid; the margin re-seated on the eye's surface (face7Seat); the angle per eye found by secant steps on the opening's read (irisLids), up
// or down. Not modelled (said plainly): the globe's protrusion (proptosis lifts both margins, enophthalmos drops the upper; both read
// from the orbit, ANAT8-HEAD's), gaze (primary only), sex and ancestry (the norms differ little in the margin's height; the fold and the
// crease carry the visible difference: lidTissue), the opening's width (the canthi: unchanged).
export function apertureRest(spec, rl = 6) {
  const o = spec.aperture, lax = FT.laxity(spec.age), up = o.up, lo = o.lo, tone = clamp(o.tone ?? 1);
  const cU = up.cover + up.apo * Math.pow(lax, up.apoP ?? 2) + up.muller * (1 - tone), cL = lo.cover - lo.sag * Math.pow(lax, lo.sagP ?? 2);
  return { lax: +lax.toFixed(3), coverUp: +cU.toFixed(2), coverLo: +cL.toFixed(2), mrd1: +(rl - cU).toFixed(2), mrd2: +(rl - cL).toFixed(2) };
}
// the rotation (rad about the globe's x axis) that brings read(P) to tgt, both ways, by secant steps (read rises with the angle)
function solveRot(F, P, g, s, W, read, tgt, thMax, seatO, ctx) {
  const Gs = { [s]: g }, at_ = th => { let Q = rotLid(P, W, g.c, th); if (seatO) Q = face7Seat(F, Q, Gs, ctx, seatO).P; return { Q, m: read(Q), th }; };
  const m0 = read(P); if (m0 == null) return null; if (Math.abs(m0 - tgt) < 0.12) return { Q: P, m: m0, th: 0, m0 };
  let a = 0, ma = m0, b = clamp((tgt - m0) / (g.R * 1000), -thMax, thMax), B = at_(b), best = B;
  for (let it = 0; it < 5 && Math.abs(B.m - tgt) > 0.12; it++) { const sl = (B.m - ma) / (b - a || 1e-6); if (!(sl > 1e-3)) break; const nb2 = clamp(b + (tgt - B.m) / sl, -thMax, thMax); if (Math.abs(nb2 - b) < 1e-5) break;
    a = b; ma = B.m; b = nb2; B = at_(b); if (Math.abs(B.m - tgt) < Math.abs(best.m - tgt)) best = B; }
  return { ...best, m0 };
}
export function face7Aperture(F, P0, G, ctx, spec, seatO = null) {
  let P = new Float32Array(P0); const o = spec.aperture, R = {};
  for (const [s, g] of Object.entries(G)) { const rl = (g.rl ?? 0.006) * 1000, rc = (g.rc ?? 0.0078) * 1000, T = apertureRest(spec, rl);
    const read = Q => irisLids(Q, ctx.tri, ctx.nb, { [s]: g }, rl, rc)[s], r0 = read(P); R[s] = { target: { mrd1: T.mrd1, mrd2: T.mrd2 }, before: { mrd1: r0.mrd1, mrd2: r0.mrd2 } };
    // the upper margin (the levator's), then the lower (its retractors'), each on the lid as the other left it
    const Wu = liftField(F, P, g, s, { span: o.span.up }, ctx);
    const U = Wu ? solveRot(F, P, g, s, Wu, Q => read(Q).mrd1, T.mrd1, o.max.up / (g.R * 1000), seatO, ctx) : null; if (U) P = U.Q;
    const Wl = liftField(F, P, g, s, { span: o.span.lo, lo: true }, ctx);
    const L = Wl ? solveRot(F, P, g, s, Wl, Q => { const m = read(Q).mrd2; return m == null ? null : -m; }, -T.mrd2, o.max.lo / (g.R * 1000), seatO, ctx) : null; if (L) P = L.Q;
    const r1 = read(P);
    R[s] = { ...R[s], after: { mrd1: r1.mrd1, mrd2: r1.mrd2, iris: r1.iris, apW: r1.apW }, upMm: U ? +(U.th * g.R * 1000).toFixed(2) : 0, loMm: L ? +(-L.th * g.R * 1000).toFixed(2) : 0,
      verts: [Wu?.size ?? 0, Wl?.size ?? 0] }; }
  const T = apertureRest(spec);
  return { P, report: { lax: T.lax, coverUp: T.coverUp, coverLo: T.coverLo, tone: o.tone ?? 1, ...R } };
}

// ---------------------------------------------------------------- it 8: THE LID AS TISSUE (the A/B under measurement: f7.lidTissue)
// Until it 8 the lids were a shape: hm08's lid seated on the drawn eye (face7Seat), raised (face7Lift) and pushed clear of it (face7Seal),
// which left L08's and L12's upper lid a flap 0-0.6 mm thick for 3 mm over the margin, then one smooth ramp to the brow (no margin, no
// platform, no crease, no fold), and the lower lid ~1 mm thick for 5 mm (the critic's 'pale ledge'). A lid is layers lying ON the eye
// (oculoplastic anatomy, as recalled from the standard texts: the skin, the thinnest of the body, under 1 mm; the pretarsal orbicularis;
// the tarsal plate ~1 mm thick, ~10 mm tall in the upper lid and ~4-5 mm in the lower; the free margin ~2 mm across, its anterior edge
// carrying the lashes; the levator's aponeurosis inserting into the skin at the upper tarsus' border: the crease; above it the septum
// and the preaponeurotic fat with the preseptal skin standing over the crease: the fold; in the lower lid the pretarsal orbicularis
// as a soft roll under the lashes, then the septum and the lid-cheek junction). So, on the drawn eye (the cornea's cap included, so the
// globe's bulge reads through the lid), in the lid's own coordinate s (mm along the eye from the margin, at the platform's radius):
//   upper  the margin's anterior edge `margin` mm proud of the eye within `sm` mm of the posterior margin (the lashes root there: the
//          lash line lies on it, hair/face.js lidMargins7 `ant`); the tarsal platform at `pre` mm (skin + orbicularis + tarsus) lying on
//          the eye up to the fold's edge; the fold: the skin above the crease at least `fold` mm prouder than the platform (outward
//          only: where the face already stands further out, it is kept), the crease's wall the `wf` mm under the fold's edge (the
//          crease's shadow; on hm08's rows 1-3 mm apart over the lid the wall is as sharp as the rows allow), fading into the face over
//          `fade` mm above. The crease's height is DETAIL7's (anatomy/fine/features.js FINE_NUMBERS.crease: by sex,
//          ancestry and age, the photographs' 8.8 mm median, converging to the canthi) so the two tiers draw ONE crease; the fold's edge
//          hangs over it with the skin's laxity (FACE6's laxity curve: the hood of age, dermatochalasis): edge = H (1 - hood lax^1.3).
//   lower  the margin `margin` mm proud, the pretarsal plate at `pre` mm with the orbicularis' roll (`roll` mm at `rollAt` mm under
//          the margin, `rollW` wide, less with age), held to the tarsus' height (`tarsus` mm); under it the face is kept or lifted to
//          the plate, never pulled in (the lid-cheek junction and the fat of age are the form's), fading over `fade` mm.
// Across, every part fades over the last `across` of the opening's width at each canthus (the canthal tendons). Only the front
// surface moves (the lid's lining and the socket do not), radially from the globe's centre (the lid stays wrapped on the eye); the
// margin loop (FACE6's / face7Seat's seat) does not move.
export function frontRaster(P, tri, nb, cx, cy, half, cell = 0.00025, zMin = -Infinity) {
  const N = Math.ceil(2 * half / cell), x0 = cx - half, y0 = cy - half, zs = new Float64Array(N * N).fill(-Infinity);
  for (let t = 0; t < tri.length; t += 3) { const a = tri[t], b = tri[t + 1], d = tri[t + 2]; if (a >= nb || b >= nb || d >= nb) continue;
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2], bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2], dx = P[d * 3], dy = P[d * 3 + 1], dz = P[d * 3 + 2];
    if (Math.max(az, bz, dz) < zMin) continue;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, dx) - x0) / cell)), i1 = Math.min(N - 1, Math.floor((Math.max(ax, bx, dx) - x0) / cell)), j0 = Math.max(0, Math.floor((Math.min(ay, by, dy) - y0) / cell)), j1 = Math.min(N - 1, Math.floor((Math.max(ay, by, dy) - y0) / cell));
    if (i0 > i1 || j0 > j1) continue; const den = (by - dy) * (ax - dx) + (dx - bx) * (ay - dy); if (Math.abs(den) < 1e-14) continue;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const x = x0 + (i + 0.5) * cell, y = y0 + (j + 0.5) * cell;
      const l1 = ((by - dy) * (x - dx) + (dx - bx) * (y - dy)) / den, l2 = ((dy - ay) * (x - dx) + (ax - dx) * (y - dy)) / den, l3 = 1 - l1 - l2;
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue; const z = l1 * az + l2 * bz + l3 * dz, k = j * N + i; if (z > zs[k]) zs[k] = z; } }
  return { N, zs, z: (x, y) => { const i = Math.floor((x - x0) / cell), j = Math.floor((y - y0) / cell); return i < 0 || j < 0 || i >= N || j >= N ? -Infinity : zs[j * N + i]; } };
}
// the crease's height over the upper margin (mm) at t (0 medial .. 1 lateral): DETAIL7's rule (anatomy/fine/features.js), its numbers
export function creaseH(sex, group, age, faceS = 1, t = 0.5) {
  const C = FINE_NUMBERS.crease, H = C.H[sex === 'm' ? 'm' : 'f'] * (C.group[group] ?? 1) * (1 + 0.04 * Math.max(0, age - 45) / 10) * faceS;
  return H * (0.38 + 0.62 * Math.pow(Math.sin(Math.PI * clamp(0.06 + 0.92 * Math.pow(clamp(t), 0.9))), 0.55));
}
export function face7LidTissue(F, P0, G, ctx, spec, faceS = 1) {
  const P = new Float32Array(P0), { nb, tri } = ctx, o = spec.lidTissue, U = o.up, L = o.lo, R = {}, lax = FT.laxity(spec.age), mm = 1000;
  const loop = new Set([...(F.lid?.L || []), ...(F.lid?.R || [])]), hood = 1 - (U.hood ?? 0.55) * Math.pow(lax, 1.3), roll = L.roll * (1 - (L.rollAge ?? 0.5) * lax);
  for (const [s, g] of Object.entries(G)) {
    const sg = s === 'L' ? 1 : -1, c = g.c, Rm = g.R * mm, rl = (g.rl ?? 0.006) * mm, rc = (g.rc ?? 0.0078) * mm;
    const O = openingProfile(P0, tri, nb, g, rl, rc); if (O.best < 0) { R[s] = 'no opening'; continue; }
    const Fr = frontRaster(P0, tri, nb, c[0], c[1], g.R + 0.008, 0.00025, c[2] - 0.004);
    // per column: the margins' heights (mm over / under the centre), filled in from the nearest valid column toward the canthi
    const N = O.N, cell = O.cell, yU = Float64Array.from(O.yU), yL = Float64Array.from(O.yL), xs = i => (i + 0.5 - N / 2) * cell;
    let iMin = N, iMax = -1; for (let i = 0; i < N; i++) if (!Number.isNaN(yU[i])) { iMin = Math.min(iMin, i); iMax = Math.max(iMax, i); }
    if (iMax < iMin) { R[s] = 'no opening'; continue; }
    const xA = xs(iMin), xB = xs(iMax), tOf = x => { const t = (x - xA) / Math.max(1e-6, xB - xA); return sg > 0 ? t : 1 - t; };   // (0 medial .. 1 lateral)
    const colAt = x => { let i = clamp(Math.floor(x / cell + N / 2), iMin, iMax); let d = 0; while (Number.isNaN(yU[i]) && d < N) { d++; const a = clamp(i - d, iMin, iMax), b = clamp(i + d, iMin, iMax); i = !Number.isNaN(yU[a]) ? a : b; } return i; };
    const eyeR = (dx, dy, dz) => { const r = Math.hypot(dx, dy, dz); return eyeSurfR({ R: g.R, rl: g.rl, rc: g.rc }, [dx / r, dy / r, dz / r]) * mm; };
    // s: the arc length along the face's front surface in the vertex's column from the margin (up or down), as the lid lies NOW (a vertex
    // up the brow's slope is far along it, however near the eye's centre its direction points)
    const arcS = (xm, ym, yM) => { const dir = ym > yM ? 1 : -1, st = 0.25; let s2 = 0, zp = null;
      for (let y = yM; dir * (ym - y) > 1e-9; y += dir * st) { const y2 = dir > 0 ? Math.min(ym, y + st) : Math.max(ym, y - st), z = Fr.z(c[0] + xm / mm, c[1] + y2 / mm);
        const zz = Number.isFinite(z) ? (z - c[2]) * mm : null, dz = zz != null && zp != null ? zz - zp : 0; s2 += Math.hypot(Math.abs(y2 - y), dz); if (zz != null) zp = zz; }
      return s2; };
    let n = 0, maxOut = 0, maxIn = 0; const probe = { up: [], lo: [] };
    for (let v = 0; v < nb; v++) { if (loop.has(v)) continue;
      const x = P0[v * 3] - c[0], y = P0[v * 3 + 1] - c[1], z = P0[v * 3 + 2] - c[2], xm = x * mm, ym = y * mm, zm = z * mm;
      if (zm < -2 || Math.hypot(xm, ym, zm) > Rm + 16 || xm < xA - 0.5 || xm > xB + 0.5) continue;
      if (P0[v * 3 + 2] < Fr.z(P0[v * 3], P0[v * 3 + 1]) - 0.0008) continue;   // (front surface only)
      const t = tOf(xm), wx = sst(0, o.across, t) * sst(0, o.across, 1 - t); if (wx < 1e-3) continue;
      const i = colAt(xm), up = ym > 0.5 * (yU[i] + yL[i]), yM = up ? yU[i] : yL[i], xc = xs(i);
      if (up ? ym <= yM : ym >= yM) continue; const sv = arcS(xm, ym, yM); if (sv < 0.05) continue;
      const cur = Math.hypot(xm, ym, zm) - eyeR(xm, ym, zm); let tgt, w;
      if (up) { const H = creaseH(spec.sex, spec.group, spec.age, faceS, t), sE = H * hood;
        const plat = U.margin * sst(0, U.sm, sv) + (U.pre - U.margin) * sst(U.sm, U.sm + 1.5, sv), kF = sst(sE - U.wf, sE, sv);   // (the crease's wall below the fold's edge; the fold itself never pulled in)
        tgt = (1 - kF) * plat + kF * Math.max(cur, plat + U.fold); w = 1 - sst(sE + U.fade[0], sE + U.fade[1], sv);
        if (Math.abs(xm - xc) < 0.6 && Math.abs(xc) < 1) probe.up.push([+sv.toFixed(2), +cur.toFixed(2), +tgt.toFixed(2)]); }
      else { const plat = L.margin * sst(0, L.sm, sv) + (L.pre - L.margin) * sst(L.sm, L.sm + 1.5, sv) + roll * Math.exp(-(((sv - L.rollAt) / L.rollW) ** 2)) * sst(0.3, 1.2, sv);
        const kB = sst(L.tarsus - 1, L.tarsus, sv); tgt = (1 - kB) * plat + kB * Math.max(cur, plat); w = 1 - sst(L.tarsus, L.tarsus + L.fade, sv);   // (under the tarsus the face is kept: the lid-cheek junction, the fat of age)
        if (Math.abs(xm - xc) < 0.6 && Math.abs(xc) < 1) probe.lo.push([+sv.toFixed(2), +cur.toFixed(2), +tgt.toFixed(2)]); }
      // (it 9) at the canthi the tissue only builds OUT, never pulls the skin in (the canthal tendons and the lateral retinaculum stand there;
      // pulled in, L05's lateral canthus pinched into a back-facing sliver once the lids opened to their rest): inward moves fade in over the
      // next `across` of the opening's width
      w *= wx; if (w < 1e-3) continue; let d = w * (Math.max(o.floor, tgt) - cur); if (d < 0) d *= sst(o.across, 2 * o.across, t) * sst(o.across, 2 * o.across, 1 - t); if (Math.abs(d) < 0.01) continue;
      const r = Math.hypot(xm, ym, zm), k = (r + d) / r; P[v * 3] = c[0] + x * k; P[v * 3 + 1] = c[1] + y * k; P[v * 3 + 2] = c[2] + z * k;
      n++; maxOut = Math.max(maxOut, d); maxIn = Math.min(maxIn, d); }
    const ord = a => a.sort((p, q) => p[0] - q[0]);
    R[s] = { moved: n, outMm: +maxOut.toFixed(2), inMm: +maxIn.toFixed(2), H: +creaseH(spec.sex, spec.group, spec.age, faceS, 0.5).toFixed(2), edge: +(creaseH(spec.sex, spec.group, spec.age, faceS, 0.5) * hood).toFixed(2),
      span: [+xA.toFixed(1), +xB.toFixed(1)], pupilUp: ord(probe.up), pupilLo: ord(probe.lo) }; }
  return { P, report: { lax: +lax.toFixed(3), hood: +hood.toFixed(3), roll: +roll.toFixed(2), ...R } };
}

// ---------------------------------------------------------------- the lower face (after FACE6's seating)
// face7Geo(F, P, E, ctx, spec) -> { P, report }: the lids on the drawn globe (seat, aperture, seal, lid tissue); R.cal describes the lower face's
// proportions as the photographs' instrument reads them (bindRead: a description; the lip / cheek construction toward them was retired 15 Oct)
export function face7Geo(F, P0, E, ctx, spec) {
  const P = new Float32Array(P0), I = F.ids, R = {}, { nb, tri } = ctx, A = FT.faceAnchors(P, I, nb), G = globes(E, ctx.side);
  const ipd = G.L && G.R ? Math.hypot(G.L.c[0] - G.R.c[0], G.L.c[1] - G.R.c[1]) * 1000 : 62;
  R.ipd = +ipd.toFixed(1);
  R.cal = bindRead(F, P0, E, ctx);
  // c. ONE GLOBE: the visible lid margin seated on the globe the renderers draw (ctx.idxE: the eye proxy's index, face3 hands it)
  const G7 = ctx.idxE ? drawnGlobes(E, ctx.idxE, ctx.side, spec.globe) : null; if (!G7) R.globe = 'no eye index: lids not seated';
  if (G7) { R.globe = Object.fromEntries(Object.entries(G7).map(([s, g]) => [s, { rFit: +(g.rFit * 1000).toFixed(2), r: +(g.R * 1000).toFixed(2) }]));
    const st = face7Seat(F, P, G7, ctx, spec.globe.seat); P.set(st.P); R.seat = st.report;
    // both lids to their rest from the lid's anatomy (face7Aperture: the levator, Mueller's tone, the laxity of age), up or down, re-seated
    const ap = face7Aperture(F, P, G7, ctx, spec, spec.globe.seat); P.set(ap.P); R.aperture = ap.report;
    R.globe7 = Object.fromEntries(Object.entries(G7).map(([s, g]) => [s, { c: g.c.map(x => +x.toFixed(6)), R: +g.R.toFixed(6), rl: g.rl, rc: g.rc }])); }
  // d. the skin over the drawn globe outside the opening (L08's hooks), the aperture the margin ring's outline
  if (G7) { const so = spec.globe.seal, go = { G: G7, F };
    const before = globeCover(P, tri, nb, E, ctx.side, go), sl = face7Seal(F, P, E, ctx, so, G7); P.set(sl.P);
    const after = globeCover(P, tri, nb, E, ctx.side, go), pick = c => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, { thin: v.thin, minCover: v.minCover, poke: v.poke, aperture: v.aperture }]));
    R.seal = { ...sl.report, before: pick(before), after: pick(after) }; }
  // e. (it 8) the lid as tissue on the drawn eye; the lashes root on its margin's anterior edge (hair/face.js lidMargins7 reads `ant`)
  if (G7) { const lt = face7LidTissue(F, P, G7, ctx, spec, A.s); P.set(lt.P); R.lidTissue = lt.report;
    const o = spec.lidTissue; for (const s of Object.keys(R.globe7)) Object.assign(R.globe7[s], { ant: +(o.up.margin * o.ant).toFixed(3), antLo: +(o.lo.margin * o.ant).toFixed(3) }); }
  return { P, report: R };
}

// ---------------------------------------------------------------- the options FACE7 hands the other stages (hair's brows and lashes, the eyes)
// ctx: { seed (the person's), globe (face7Geo's drawn globes, bind m) }. The brows grow as a follicle field (hair/face.js growBrows `fol`):
// thick / arch place the band on the skin the field grows over, the field its hairs; the band's height is the skull's supraorbital margin
// (`rim`: ANAT8-HEAD's skull/skull.js drawSkull for this person: half the orbit's height over the orbit's centre, yOc under the globe's).
export function face7Hair(spec, hair, ctx = {}) {
  if (!hair) return hair; const b = spec.brows, s = spec.sex, br = { ...(hair.brows || {}) };
  br.thick = +((br.thick ?? 1) * bySex(b.thick, s)).toFixed(3); br.arch = +((br.arch ?? 1) * b.arch).toFixed(3);
  br.fol = { ...b.fol, rho: bySex(b.fol.rho, s), len: bySex(b.fol.len, s), cal: b.fol.cal != null ? bySex(b.fol.cal, s) : undefined }; br.density = 1; br.base = +Math.min(2.2, (br.base ?? 1) * b.fol.base).toFixed(3);
  const K = drawSkull({ name: spec.name, sex: s, age: spec.age, group: spec.group }), dy = K.OBH / 2 - (b.rim.yOc ?? 1.5);
  br.rim = { k: bySex(b.rim.k, s), dy: +(dy / 1000).toFixed(5) }; br.lift = 0; br.f7rim = { obhMm: +K.OBH.toFixed(2), marginMm: +dy.toFixed(2) };
  // the lashes on the drawn eye's lid edges: face7Geo's drawn globes (bind m) go to hair/face.js growLashes as lashes.eye7
  // (c4 it 10, lashes.fol) the rows from their follicles, with the person's group and the tissue's laxity (FACE6's, as the lids use it)
  const lf = ctx.globe ? { fol: { ...spec.lashes.fol, group: spec.group, lax: +FT.laxity(spec.age).toFixed(3) } } : {};
  const la = ctx.globe ? { lashes: { ...(typeof hair.lashes === 'object' ? hair.lashes : {}), eye7: ctx.globe, ...lf } } : {};
  return { ...hair, brows: br, ...la };
}
export function face7Eyes(spec, eyesP) {
  if (!eyesP) return eyesP; const e = spec.eyes;
  return { ...eyesP, globe7: { r: spec.globe.r }, f7: { irisSpec: e.irisSpec, ccEnv: e.ccEnv, sclera: e.sclera, pink: e.pink, caruncle: e.caruncle },
    ...(eyesP.f5 && e.catch != null ? { f5: { ...eyesP.f5, catch: e.catch } } : {}) };
}

// ---------------------------------------------------------------- shading (after face3Skin's FACE5 step): the lips' finish, the brows' material
export function face7Skin(h, f3) {
  const s = f3.f7?.spec, rep = {}; if (!s) return rep;
  // the lips: the wet band's lobe satin, not plastic (FACE5's hook: roughness 0.24 in the band -> wetRough)
  if (s.lips && h.body?.material) { const mat = h.body.material, prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey?.bind(mat), wr = (s.lips.wetRough ?? 0.32).toFixed(3);
    mat.onBeforeCompile = (sh, r) => { prev?.call(mat, sh, r); const a = 'roughnessFactor = mix(roughnessFactor, 0.24, wb);'; rep.wetRough = sh.fragmentShader.includes(a); if (rep.wetRough) sh.fragmentShader = sh.fragmentShader.replace(a, `roughnessFactor = mix(roughnessFactor, ${wr}, wb);`); };
    mat.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|f7lips' + wr; mat.needsUpdate = true; }
  if (s.brows?.mat) { const fo = s.brows.fol, bm = fo ? { ...s.brows.mat, alphaGain: fo.alpha, ...(fo.strands && fo.cal ? { strands: { n: Math.max(1, fo.clump ?? 4), conv: fo.conv ?? 0.75, ...(typeof fo.strands === 'object' ? fo.strands : {}) } } : {}) } : s.brows.mat; try { rep.brows = browMaterial7(h, bm); } catch (e) { rep.brows = 'brow7: ' + (e.message || e); } }
  // (c7 it 18) the lashes: each card's own lashes at the calibre (strands; false = the atlas tile: the it 18 bench's control arm), the lower
  // row the upper's pigment (fol.loMel); no sheen multipliers (deleted: they hid a fringe the lash's shading never made)
  if (s.lashes) { try { rep.lashes = lashMaterial7(h, { strands: s.lashes.strands, loMel: s.lashes.fol?.loMel }); } catch (e) { rep.lashes = 'lash7: ' + (e.message || e); } }
  // (c7 it 19) the eye's cavity: the body's AO lines patched now (inert until the visibility exists); the visibility itself needs the eye
  // that is drawn, so likeness/eyes.js buildEyes runs it (cavityRun) once the eyes are built
  let cavityU = null;
  if (s.cavity && h.body?.material) { cavityU = cavityUniforms(); try { cavityPatch(h.body.material, cavityU, rep); } catch (e) { rep.cavityPatch = 'cavity7: ' + (e.message || e); } }
  h.face7 = { spec: s, report: rep, ...(cavityU ? { cavityU, cavityRun: () => face7Cavity(h, s.cavity, cavityU) } : {}) };
  return rep;
}
