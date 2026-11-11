// PERSON (8 Oct): THE ONE CURRENT PERSON. makePerson('<name>') (person/index.js) builds it; there is no version to ask for and no code path
// that builds an older person (the old integration chain v2 .. v7 lives only in git history). A 'latest:' / 'vN:' / 'lineup:' prefix in a
// running lane's command is accepted, stripped and logged once (deprecated); `rev`, `v6`, `v7` options are ignored the same way.
// Every lane's current result is ON; each lane LANDS a passed change by writing its own file, assets/person/v7lanes/<LANE>.json (read
// here at build: the slots below), so the next build by anyone carries it; the caller's options win over the lane files, the lane files
// over the defaults here (research/capabilities/human.md: the schema).
//
// The order of composition (each a seam the lanes named; each step measures on what precedes it):
//   body form (BODY7; ANAT8-BODY's soft tissue when landed) -> face form (FACE7 face rev 8; ANAT8-HEAD face rev 9 when landed) -> fine
//   structure (DETAIL7, on the final landmarks) -> skin colour and light transport (SKIN7) -> hair (HAIR7) -> garments (the bake: CLOTH9's
//   CLOTH8's v8c (CLOTH9's settle when it lands on v8c), cover8 under them and their posed normals, FABRIC7's look on them; MOTION c2's dressed poses) ->
//   the camera (CAMERA7: render-time, the stage) last.
// What the person carries (the slot: the lane that owns it; DEFAULTS below are the values when no lane file says otherwise):
//   body7    BODY7 rev 7.7 on the FIGURE STUDY (wear 'bare'): people7.json (the photographs' calibration in the tissue top-up, hands and
//            feet to ANSUR II, the girdle dropped to ANSUR's acromion with girdleRelax7, the pectoral crease gone) + NAC7 (the nipple at its
//            anatomical point: NAC7 v2, BODY7's 7.7); girdle7 after the stance and after every pose (afterPose7). (15 Oct c5 it2) ONE BODY:
//            the dressed person stands on the same simulated body as the figure study (the anatomy hooks get register 'bare' = the body's
//            register; the garments re-seated on it by CLOTH9's seat9, below). { nac7: false } = without NAC7 (BODY7's one switch); body7: false = off
//   girdleLayer BODY7's girdle layer (lib/fx/body/girdle_layer7.js girdleLayer7): ON (15 Oct c5): the neck base and shoulder girdle from ANAT8-BODY's
//            bones and the girdle muscles' borders under the person's fat, in place of the detail tier's typed girdle forms (detail.Dg3); every
//            person, dressed or bare (c5 it2)
//   soft     ANAT8-BODY's soft-tissue solve (lib/fx/anatomy/soft/): ON for every woman (15 Oct c5): anatomy/soft/hook.js soft8 = the breast solved
//            under gravity (the lane's keyed envelope bake assets/anatomy/soft/<name>.json when current for this body and solver, else the solve
//            itself in node, written back as that bake; a page never solves) and BODY7's membrane fit (fitMembrane7) onto it, every subdivision
//            level; every woman, dressed or bare (c5 it2: the body under the clothes is this body; no male chest region yet). Any
//            lib/fx/<module>'s fn(P, { name, register, ...opts })
//            after the body form (the caller's A/B)
//   pelvis   ANAT8-PELVIS's pelvic tissue solve (lib/fx/anatomy/pelvis/hook.js pelvis7): ON for EVERY person (names 'all'), after soft. (15 Oct
//            c5 it3) the bake is KEYED to the person's body and the code (pelvis v11: hook v3), as soft's and face9's are: a current bake is
//            laid on, a missing or stale one is SOLVED in node by the build (~8-10 min a person; ANAT8_PELVIS_BUILD=0 = report only) and
//            written back; a page never solves. All twelve baked by 22:12 (the lane re-bakes on each PELVIS_VERSION)
//   face7    FACE7's CURRENT face (face3.f7 = {}: FACE7 has one version, FACE7_VERSION 7: the lids wrap the drawn globe, it 5-6's lid
//            lift, lid-edge lashes and catchlight; its A/Bs (brows.fol, lidTissue) off until FACE7's critic rules); false = off.
//            (8 Oct 20:09: the default was { globe: { lift: false, seat: { surface: 'sphere' } }, lashes: false }, it 4's keys; face7.js
//            no longer reads any of them, so the person already drew FACE7's current face: the value now says so)
//   face9    ANAT8-HEAD face rev 9 (the face from the skull out: skull -> muscles -> fat compartments -> the skin membrane, a keyed bake a face,
//            assets/person/anat8h/cache/<key>.bin, built in node on a missing key): ON, gain 1, for everyone (15 Oct c5)
//   nosemouth NOSEMOUTH's nose and lips (the anatomy's cartilage and orbicularis wrapped on the face: lib/fx/anatomy/head/nose/wrap.js
//            nosemouth7, a displacement bake a person): ON, names 'all' (15 Oct c5; bakes exist for L03 L05 L08 L22, the others report skipped;
//            SEAM, c5 it3: those four were fitted on 8 Oct to the face WITHOUT face9 (labs/nosemouth latestFace), and the hook ADDS them to
//            face9's face, so inside the window face9's move and the wrap's both act: a re-bake on the current face is NOSEMOUTH's);
//            runs after the face form, the stance and ANAT8's hooks, BEFORE the fine tier (DETAIL7 reads the final lip border)
//   eyes     EYES' slot: { eye7: {} } = EYES' engine eye, ON (15 Oct c5); Cycles follows through the export's popts (person_job.py writes the
//            eye7 maps and installs blender/eye7_cycles.py); { eyes: { eye7: false } } is lane B's eyes rev 4 (a diagnosis A/B)
//   fine7    DETAIL7's fine-structure tier (the engine's normal + cavity; in Cycles displacement through the export's popts): the relief x a
//            gain by age (age: [floor, from, to]: floor under `from`, 1 at `to`); DETAIL7 landed [1, 25, 45] (gain 1 at any age: its skin
//            model carries each static line's depth by age since i6, so a blanket ramp double-counted it)
//   skin     skin rev 7 = SKIN OPTICS iteration 1 (landed by its lane, 8 Oct 21:10, after the orchestrator's read of A | B on deep skin:
//            'A is better ... land it'): the colour from the layered model (lib/fx/likeness/optics.js: the cast hex inverted to pigments,
//            the face's blood over the arm's, SKIN4's zones and the mottle as melanin / blood / deoxygenation multipliers into the physical
//            table; the Cycles radius = the model's diffuse mean free path); SKIN7's photographic grade and its aim / mottleLaw / grainMelExp
//            options are gone from skin.js (A's effective values are SKIN7_DEFAULTS); SKIN OPTICS' chem (22:05) is rev 7 itself: the mottle
//            at the amplitude SKIN4 measured on the HSRD-100 scans (mottle 1) for EVERY person. (8 Oct 22:29: the last per-person skin
//            override, SKIN_TUNE (L08 mottle 0.7 grain 0.7, L06 0.75 / 0.7: SKIN4's read of them 'dirty' at the old grade's x1.8), is
//            DELETED: its condition ('out when the model's own mottle is measured on them') is met by chem; L08 and L06 carry the same
//            measured mottle as the other ten. The client, 17:25: no per-person overrides.)
//   (Cycles) HAIRMAT's hair FIBRE model (landed by its lane, 21:14: 'full', rigid children): read by blender/hairmat7.py from
//            v7lanes/HAIRMAT.json at every Cycles render (person_hair.build_part ends in hairmat7.dress); nothing in the engine person
//   hair     HAIR7 hair rev 7 for every groom, ropes on rope7 (the rope's base laid along the scalp by its comb: the cage gone; HAIR7 it 5's
//            critic); CAST's blondes (L12, L11) kept
//   bake     the garments' bake: CLOTH8's v8c for EVERY dressed person (8 Oct 17:45: the clearest clothing win of the round, job 1008-124952:
//            clean elbows, a clean tuck, whole cuffs and neckbands); a dressed person with a MOTION c2 dressed pose (L08 L22 L20 L14 L21 L17
//            L05: folded arms, clasped hands, a hand in a pocket) stands in it, on CLOTH8's re-finish of that bake (poseBake: v8c/dress7).
//            CLOTH9's settle (v9f) was on CLOTH7's v7c: it comes back when CLOTH9 lands it on v8c (its lane file). pose: false = all on the bake
//   cover8   CLOTH8 cover8 rev 2 (d 4 mm, clear 6 mm: the skin under the clothes kept and pushed in: no black voids, the buttons drawn)
//            WITH rev 3's DIRECTION (c3 it1, 8 Oct: dir 'smooth', CLOTH8's own key): the push follows the bind surface's SMOOTHED outward
//            normal (area-weighted face normals of the full triangle list, 8 rings), so hm08's nipple patch, folded inside out in the dressed
//            register's body, is pushed IN, not out through the cloth (rev 2: the knots on L06's T-shirt, the flecks on L03's and L21's chests).
//            Only the direction: rev 2's chase of cloth lying inside the body and its keepCut stay (rev 3's `under: false` opened a skin
//            patch through L21's sweater at the shoulder in his dressed pose: CLOTH8's GPU 1008-173459 r3v8c, and speck_probe). The lane
//            file's { d, clear } merges over it; dressed; engine here, Cycles through the export (after CORRECT5's corrected bind)
//   posedNormals  CLOTH8 seam (b): the garments' normals as posed (no dark shards where the bind is crumpled), dressed
//   seat9    CLOTH9's seat at build (lib/fx/cloth/cloth9/seat9.js seatPerson9, rev 2; WIRED 15 Oct c5 it2): every garment of a dressed person
//            re-seated, in its pose, on the body the person ends with (the anatomy layers move the body after the parts are attached): where
//            the cloth is now inside the skin or the underwear, or rested on skin that withdrew since the attach (X0dress); after refit8,
//            before fine7 and cover8; { seat9: false } = a diagnosis A/B
//   fabric7  FABRIC7's current fabric (grain, tone, light, the ridge cascade's options) + SHOES7 around the build (page-wide hooks, turned
//            off after), at the RENDER TIER's sub-frame count (useFabric7 { samples: K }: film 16 for stills, motion 8 for a clip: FABRIC7's
//            hand-off, 8 Oct; before, the person drew the film tier's grain at K 1); a page that turned FABRIC7 on itself (the Cycles atlas
//            bake: samples 1, atlas 1) keeps its own options. FABRIC6's yarn-level data under it (fabric: false = off)
//   (always) FACE6's facial skeleton (face3.f6) under FACE7, FACE5's zones and catchlight, FACE4 + MOUTH, HAIR6's settle and HAIR4's
//            posed settle, CORRECT5's correctives (P.correct.update() after every pose), the cloth's posed spikes pulled back
//   motion   MOTION c3 rev 7d acts (lift7, wave7, walk7, row7: actFor7 + bakeTrack7, CORRECT5 per frame): { motion: { clip } }
//   cloth    CLOTHINT: P.colliders(o) / P.clothMesh(o) (a sheet or any Drape settles on this person; the lane file's colliders / clothMesh
//            are their defaults)
//   stage, looks  CAMERA7 / STYLE c6 (render-time): STAGE, LOOKS
// NOT COMPOSED (said plainly): (15 Oct c5 it2: the dressed person and the figure study are ONE body now: BODY7's records, the girdle, the
// girdle layer, the breast's solve and pelvis7 under the clothes too, the garments re-seated on it by seat9); the men have
// no chest envelope (soft/ solves the breast); the body's base form is still BODY7's calibrated fit (people7.json's tissue top-up) wherever no
// solve carries the tissue (everything but the breast and the pelvic region); a dressed POSE keeps its own bake (CLOTH9 settles the stance
// only); the motion clips' cloth is MOTION's own; CAMERA7's studio@7 casts orange (studio@5 is the default stage).
import { Hero } from '../hero.js';
import { V2_PLAN, V2_HAIR, STAGES2, loadPeople2, peopleAt, personOf, heroOpts2, poseOf2, stanceOf2, standV2, partMesh2, cullBody2, rideDetail, liftOverPosed, loadBake2,
  stanceV3, settleHairPosed, despikeParts, afterPose } from './core.js';

const now = () => (globalThis.performance ? performance.now() : Date.now());
const mulberry = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const isObj = x => x && typeof x === 'object';
const ASSETS = new URL('../../../assets/', import.meta.url).href, PASSETS = ASSETS + 'person/';
const sst = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- the defaults (what each lane gives the person when its lane file is absent)
export const PEOPLE7 = ASSETS + 'body/body7/people7.json';    // BODY7's records (the figure study)
export const DEFAULTS = {
  body7: { nac7: true },                                                          // BODY7 rev 7.6
  // (15 Oct, integrator c5 it1, THE CLIENT: 'we are building a procedural body, face, and clothing system'; of the anatomy layers left off: 'THIS IS THE
  // REAL WORK') THE ANATOMY SIMULATION IS THE PERSON: every anatomy layer below is ON for everyone it can act on; a layer that reads worse is the bug list
  // (fixed in the simulation, never switched off and never sculpted over). { <slot>: false } is a diagnosis A/B only.
  girdleLayer: {},                                                                // BODY7's girdle layer (girdle_layer7.js: the neck base and girdle from ANAT8's bones and muscles, in place of the detail tier's typed girdle forms Dg3); figure study
  soft: { module: 'anatomy/soft/hook.js', fn: 'soft8', names: 'all' },           // ANAT8-BODY's soft-tissue solve (the breast under gravity: its keyed bake, else the solve in node), BODY7's membrane fit onto it; women, figure study
  pelvis: { module: 'anatomy/pelvis/hook.js', fn: 'pelvis7', names: 'all' },      // ANAT8-PELVIS's solved pelvic region, EVERY person: a keyed bake per person (all twelve), a stale or missing one solved in node
  face7: {},                                                                      // FACE7's current face (one version; lip / cheek / cal's construction from numbers RETIRED 15 Oct: the lower face is face9's)
  face9: { gain: 1 },                                                             // ANAT8-HEAD face rev 9: the face from the skull out (the twelve mb5 bakes, it19)
  nosemouth: { names: 'all' },                                                    // NOSEMOUTH: with no module named, the slot runs NOSEMOUTH_CHAIN (below): the wrap, then the alar base's shell; a lane value with { module, fn } runs that one, { chain: [...] } its own chain
  eyes: { eye7: {} },                                                             // EYES' engine eye (eye7; Cycles follows through the export's popts)
  fine7: { res: 2048, cycRes: 4096, age: [1, 25, 45], body: true },              // DETAIL7 (engine atlas, Cycles atlas; gain 1 at any age: DETAIL7 i8's landing; body: the torso's patches, the navel as a rolled skin wall + the NAC relief, ON 15 Oct c5, engine AND Cycles)
  skin: { rev: 7 },                                                               // SKIN7 rev 7 = SKIN OPTICS iteration 1 (the layered model; landed 21:10)
  hair: { rev: 7 },                                                               // HAIR7 (rope7 on: HAIR7 it 5's critic, 'an improvement over the cage')
  bake: 'v8c',                                                                    // CLOTH8 v8c (CLOTH9 lands its settle on it)
  poseBake: 'v8c/dress7',                                                         // CLOTH8's re-finish of MOTION c2's dressed poses
  cover8: { d: 0.004, clear: 0.006, dir: 'smooth' },                              // CLOTH8 cover8 rev 2 + rev 3's direction (c3 it1)
  posedNormals: true,                                                             // CLOTH8 seam (b)
  seat9: {},                                                                      // CLOTH9's seat at build (seatPerson9: the garments re-seated on the body the person ends with; CLOTH9.json names the module; wired c5 it2)
  refit8: {},                                                                     // CLOTH8 c5 refit8 ON (15 Oct, integrator c4 it3: passed by the orchestrator's look at 1015-055940): the underwear rides the tissue that moved after it was attached; { refit8: false } is the A/B
  fabric7: {},                                                                    // FABRIC7 (useFabric7's options; samples = the render tier's K)
  colliders: {}, clothMesh: {},                                                   // CLOTHINT (P.colliders / P.clothMesh defaults)
};
// which lane owns which slot (a lane file may set only its own); the order is the order of composition (a later lane's bake wins)
// (15 Oct c5, the orchestrator's audit item 3: 'one slot runs both') NOSEMOUTH's default chain: the anatomy's nose and lips wrapped on the person (wrap.js
// nosemouth7: a per-person bake, L03 L05 L08 L22) then the alar base's shell solved as a membrane with a bending limit (alarbase.js alarBase7, everyone)
export const NOSEMOUTH_CHAIN = [{ module: 'anatomy/head/nose/wrap.js', fn: 'nosemouth7' }, { module: 'anatomy/head/nose/alarbase.js', fn: 'alarBase7' }];
export const LANE_SLOTS = { BODY7: ['body7', 'girdleLayer'], ANAT8_BODY: ['soft'], ANAT8_PELVIS: ['pelvis'], FACE7: ['face7'], ANAT8_HEAD: ['face9'], NOSEMOUTH: ['nosemouth'], EYES: ['eyes'], DETAIL7: ['fine7'], SKIN7: ['skin'], HAIR7: ['hair'],
  CLOTH8: ['cover8', 'posedNormals', 'bake', 'poseBake', 'refit8'], CLOTH9: ['bake', 'poseBake', 'seat9'], FABRIC7: ['fabric7'], CLOTHINT: ['colliders', 'clothMesh'] };
// render-time (the labs and person_job read them): CAMERA7's stages (studio@7 a switch: it casts orange on skin), STYLE c6's rev 7d keys,
// RENDER6's quality tiers
export const STAGE = { portrait: 'studio@5', window: 'window@5', yard: 'yard@5', camera7: 'studio@7' };
export const LOOKS = { stencil: 'stencil7', notan: 'notan7Red', montage: 'montage7Gravure', montageScreen: 'montage7', poster: 'sovietPoster7', cel: 'celShadow7', ligne: 'ligneClaire7',
  six: ['stencil7', 'notan7Red', 'montage7Gravure', 'sovietPoster7', 'celShadow7', 'ligneClaire7'] };
export const QUALITY = { stills: 'film', clips: 'motion', shutter: 0.5 };
// the sub-frame count K of each tier (lib/fx/light/quality.js QUALITY6: preview 1, motion 8, film 16): FABRIC7's grain is drawn for it
export const TIER_K = { preview: 1, motion: 8, film: 16 };
// what a person wears: 'work' = dressed in their outfit (the default), 'bare' = the figure study (K3's underwear). Another outfit on a body is
// a new bake (the wardrobe is draped offline), not a page call.
export const WEAR = { work: null, bare: 'form,prior,face,detail,kin,hair,skin,eyes,found', nude: 'form,prior,face,detail,kin,hair,skin,eyes,found' };
// (integrator c6, 16 Oct; ANAT8-BODY's ask, the orchestrator's 02:40 block) 'nude' = the figure study WITHOUT the upper foundation: no cup, no painted
// bust band, the skin under the bra drawn (the bake's cull for it lifted); the briefs kept. The same body, face and anatomy keys as 'bare' (one
// register to the hooks); for Cycles bust shots of the chest as the photographs show it: an adult figure study, not sexual.
// CAST seam kept (casting: who the person is, not a correction): the blondes (HAIR6's hand-off: L12 a light golden blonde, L11 a dark blonde young man)
export const CAST_HAIR = { L12_f39_white: { melanin: { eu: 0.05, ph: 0.06 } }, L11_m23_white: { melanin: { eu: 0.10, ph: 0.05 } } };
// the bakes that carry K4's wardrobe (their fabric names need registerFabrics4): by the bake path's last segment, or MOTION c2's bakes
const WARDROBE = /^(v5c|k4|v6c|v7c|v8c|dress|dress7|act7)$/;
const MOUTH = {};   // MOUTH's option (face3.mouth), one object for every build as before
export const fineGain = (age, A = DEFAULTS.fine7.age) => +(A[0] + (1 - A[0]) * sst(A[1], A[2], age ?? 35)).toFixed(3);

// ---------------------------------------------------------------- the lane files (assets/person/v7lanes/<LANE>.json: { <slot>: value, note })
let _lanes = null;
export async function laneFiles({ force = false } = {}) {
  if (_lanes && !force) return _lanes;
  _lanes = (async () => { const out = {};
    for (const L of Object.keys(LANE_SLOTS)) { const j = await fetch(PASSETS + 'v7lanes/' + L + '.json').then(r => (r.ok ? r.json() : null)).catch(() => null); if (j && isObj(j)) out[L] = j; }
    return out; })();
  return _lanes;
}
// the effective slots: DEFAULTS <- lane files (in LANE_SLOTS order, objects merged one level) ; the caller's options are applied after
// (shallow: an unchanged slot is the DEFAULTS object itself, as the old chain passed its constants)
export async function personDefaults() {
  const F = await laneFiles(), D = { ...DEFAULTS }, from = {}, bakes = [DEFAULTS.bake];
  for (const [L, slots] of Object.entries(LANE_SLOTS)) { const j = F[L]; if (!j) continue;
    for (const s of slots) if (s in j) { const v = j[s]; D[s] = isObj(v) && !Array.isArray(v) && isObj(D[s]) ? { ...D[s], ...v } : v; from[s] = L; if (s === 'bake' && v) bakes.unshift(v); } }
  // (8 Oct 21:30) the garments' bakes in the order of composition, the latest lane's first: a person stands in the first one that has them
  // (a lane's new bake may not be built for all twelve yet: CLOTH9's v9j/v8c holds L03 L06 L12; the others keep CLOTH8's v8c)
  D.bakes = [...new Set(bakes)];
  return { D, from };
}
// the first bake of the chain that holds this person (a lane's bake not yet built for everyone falls back to the one it builds on)
async function firstBakeWith(name, chain) {
  for (const b of chain) { if (await loadBake2(name, { url: PASSETS + b + '/' }).then(() => true).catch(() => false)) return b; }
  return chain[chain.length - 1];
}
// landing markers of the two hooks (kept for the lanes that write them)
let _f9 = null, _soft = null;
const face9Landed = () => (_f9 ||= fetch(PASSETS + 'anat8h/landed.json').then(r => (r.ok ? r.json() : null)).catch(() => null));
const softLanded = () => (_soft ||= fetch(ASSETS + 'anatomy/soft/landed.json').then(r => (r.ok ? r.json() : null)).catch(() => null));
const landedFor = (L, name) => !!(L && (L.names === 'all' || (Array.isArray(L.names) && L.names.includes(name))));
// BODY7's records (people7.json: prior = rev 7)
let _p7 = null;
export async function people7() { if (!_p7) _p7 = peopleAt(PEOPLE7); return _p7; }
// the key's angular radius (deg) of a stage, for FACE5's catchlight
async function keyDegOf(stage) {
  if (!stage) return null;
  if (isObj(stage)) return stage.keyHalfDeg ?? null;
  try { const ST = await import('../stage/stages.js'), S = ST.stageRecord(String(stage)); return S.key !== 'physical' ? S.key.size / 2 : (S.sky?.kind === 'clear' ? 0.27 : null); }
  catch { return null; }
}

// ---------------------------------------------------------------- the person
// name: one of the twelve (V2_PLAN's keys). opts: { studio, wear: 'work' | 'bare', stages, seed, stage (for the catchlight), motion: { clip },
// export (the Cycles export takes cover8 and the fine tier itself), the slots above (false = off, an object = merged over the lane's),
// and the build's switches (pose, fabric, correct, hairSettle, settle, despike, ride, lift, detail, eyes, ...) }
function personBuildTimingRecord(P, name) {
  const finiteDurations = (source, keys) => {
    const result = {};
    for (const key of keys) {
      const value = source?.[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) result[key] = value;
    }
    return result;
  };
  const report = P?.report || {};
  const person = report.person || {};
  return {
    event: 'person_build_timing',
    schema: 1,
    name: String(name),
    report_ms: finiteDurations(report.ms, ['total']),
    report_person_ms: finiteDurations(person.ms, [
      'girdle', 'girdleLayer', 'soft', 'pelvis', 'nosemouth', 'refit8', 'seat9', 'fine7', 'cover8', 'motion', 'total'
    ]),
    report_person_build_ms: finiteDurations(person.build?.ms, [
      'hair4Ready', 'settle', 'despike', 'settle6', 'fabric', 'correct'
    ])
  };
}

export async function buildPerson(name, opts = {}) {
  const T0 = now(), { D, from } = await personDefaults();
  // `slots`: the lanes' slots for this build only (an A/B of a lane's landing: { slots: { bake: 'v9f/v7c', poseBake: null } }), as a lane file would
  if (isObj(opts.slots)) for (const [k, v] of Object.entries(opts.slots)) { D[k] = v; from[k] = 'opts.slots'; }
  const { slots: _s, rev: _r, v1: _1, v2: _2, v3: _3, v4: _4, v5: _5, v6: _6, v7: _7, body7 = D.body7 ?? true, girdleLayer = null, soft = null, pelvis = null, nosemouth = null, face7 = D.face7 ?? true, face9 = null, fine7 = D.fine7 ?? {}, cover8 = D.cover8 ?? true,
    refit8 = D.refit8 ?? null, seat9 = null, fabric7 = D.fabric7 ?? true, export: forExport = false, motion = null, ...rest } = opts;
  // the wear and the register
  if (rest.wear != null && rest.stages == null) { const w = String(rest.wear); if (!(w in WEAR)) throw new Error(`person: wear '${w}' (work | bare | nude)`); if (WEAR[w]) rest.stages = WEAR[w]; if (w === 'nude') rest.nude = true; }
  const SL = rest.stages == null || rest.stages === 'all' ? null : Array.isArray(rest.stages) ? rest.stages : String(rest.stages).split(',').map(s => s.trim());
  const dressed = !SL || SL.includes('stack');
  const RP = { lanes: {}, popts: {}, ms: {}, from };
  const o = { ...rest };
  // (integrator c6, HAIR7's hand-off since its it 15) a build for Cycles (the export and lab_bake's skin bake: `export`) tells the hair, so the
  // painted root base is retired on the Cycles skin and HAIR7's follicle field alone makes the parting and the hairline (hair/index.js o.cycles)
  if (forExport) o.cycles = true;
  // ---- body form (BODY7): the rev 7 records; NAC7. (15 Oct c5 it2, THE CLIENT: 'new cloth goes on new body'; the orchestrator: 'MAKE THE
  // ANATOMY SIMULATION THE PERSON') ONE BODY for both wears: the dressed person stands on the figure study's body (people7, the girdle, the
  // girdle layer, the soft solve, pelvis7), and CLOTH9's seat9 re-seats the garments on it after the anatomy layers (below). Until c5 it1 the
  // dressed register was form 1 under the clothes (b7 = body7 && !dressed): two bodies and, through the records, two faces (face9's keys).
  // `breg` = the BODY's register the anatomy hooks are told: 'bare' whenever BODY7's body stands (the hooks' 'work' meant 'form 1 under the
  // clothes: do not move the skin', which no longer holds: the seat moves the cloth with it)
  const b7 = body7 !== false, breg = b7 || !dressed ? 'bare' : 'work';
  if (b7) { o.people = PEOPLE7; const nac = isObj(body7) && body7.nac7 != null ? !!body7.nac7 : true; if (!nac) o.detail = { ...(o.detail || {}), nipple7: false }; RP.lanes.body7 = { rev: nac ? 7.6 : 7.5, register: 'bare', wear: dressed ? 'work' : 'bare' }; }
  else RP.lanes.body7 = false;
  // ---- face form (FACE7 rev 8; ANAT8-HEAD rev 9 when landed)
  if (rest.face3 !== false) {
    const f3 = { ...(isObj(rest.face3) ? rest.face3 : {}) }; if (f3.f6 === undefined) f3.f6 = {};
    if (face7 !== false && f3.f7 === undefined) f3.f7 = face7 === 'it5' ? {} : isObj(face7) ? { ...(isObj(D.face7) ? D.face7 : {}), ...face7 } : D.face7;   // (15 Oct) the caller's object MERGES over the landed face7 (FACE7 found it replaced it: A/B plates lost the landed lids); { key: false } still turns a landed key off
    let f9 = face9 ?? D.face9;
    if (f9 == null && f3.f9 === undefined) { const L = await face9Landed(); if (landedFor(L, name)) f9 = { gain: L.gain ?? 1 }; }
    if (f9 && f9 !== false && f3.f9 === undefined) f3.f9 = isObj(f9) ? f9 : {};
    o.face3 = f3; RP.lanes.face7 = f3.f7 ? 'current' : false; RP.lanes.face9 = f3.f9 ? { gain: f3.f9.gain ?? 1 } : false; if (!f3.f9) RP.waiting = [...(RP.waiting || []), 'face9 (ANAT8-HEAD): not landed'];
  }
  // ---- skin (SKIN7) and hair (HAIR7, ropes kept out of brow7)
  if (rest.skin !== false) o.skin = { ...D.skin, ...(isObj(rest.skin) ? rest.skin : {}) };
  if (rest.hair !== false) { const hh = isObj(rest.hair) ? rest.hair : {}; o.hair = { ...D.hair, ...hh, h7: { ...(D.hair?.h7 || {}), ...(hh.h7 || {}) } }; }
  RP.lanes.skin = o.skin || false; RP.lanes.hair = o.hair ? { rev: o.hair.rev, h7: o.hair.h7, ...(o.cycles ? { cycles: true } : {}) } : false;
  if (o.nude) RP.wear = 'nude';
  // ---- eyes (EYES' slot, 8 Oct 22:33: its lane file { eyes: { eye7: {} } } lands the engine eye; the caller's { eyes: {...} } merges over it).
  // Unset when neither says anything, so the eyes are lane B's rev 4 exactly as before. The export carries eye7 to Cycles (export.js popts.eye7
  // -> person_job runs labs/eyes/eye7_maps.mjs on the export and installs blender/eye7_cycles.py before render_person.py)
  if (rest.eyes !== false && (isObj(rest.eyes) || (isObj(D.eyes) && Object.keys(D.eyes).length))) o.eyes = { ...(isObj(D.eyes) ? D.eyes : {}), ...(isObj(rest.eyes) ? rest.eyes : {}) };
  RP.lanes.eyes = rest.eyes === false ? false : o.eyes?.eye7 ? { eye7: true } : { rev: 4 }; if (o.eyes?.eye7) RP.popts.eye7 = true;
  // ---- CLOTH8 seam (b): the garments' posed normals (dressed)
  if (dressed && o.posedNormals === undefined && D.posedNormals) o.posedNormals = true;
  RP.lanes.posedNormals = !!(dressed && o.posedNormals);
  // ---- garments: the bake (a dressed pose keeps its own bake); a MOTION c3 clip chooses its own
  const mo = motion ? (isObj(motion) ? motion : { clip: String(motion) }) : null;
  let A7 = null; if (mo) { try { A7 = await import('../motion/act7.js'); } catch (e) { A7 = null; } }
  const clip7 = !!(mo && A7?.CLIPS7?.[mo.clip]);
  if (mo && !clip7) throw new Error(`person: motion clip '${mo.clip}' (the current clips: ${Object.keys(A7?.CLIPS7 || {}).join(', ')})`);
  if (clip7) { const po = A7.personOpts7(mo.clip, name); if (o.bake == null) o.bake = po.bake; o.ride = o.ride ?? po.ride; o.pose = false; }
  else if (o.bake == null) {
    let pb = null; if (dressed && (o.pose ?? 'dressed') === 'dressed') { try { pb = (await import('../motion/act6.js')).CLIPS6?.row6?.bake?.[name] || null; } catch (e) { pb = null; } }
    // CLOTH8's re-finish of the dressed pose's bake (v8c/dress7) where it has one; the stance and the pose are the same record
    if (pb) { o.pose = 'dressed'; if (D.poseBake && pb === 'motion6/dress7') { o.bake = D.poseBake; RP.poseBake = { from: pb, to: D.poseBake }; } }
    else { o.bake = from.bake === 'opts.slots' ? D.bake : await firstBakeWith(name, D.bakes || [D.bake]); o.pose = false; if (o.bake !== D.bake) RP.bakeFallback = { lane: D.bake, used: o.bake }; } }
  // ---- fabric (FABRIC7 + SHOES7) around the build: page-wide hooks, turned off after it (a page that turned them on itself keeps them)
  const fab7 = fabric7 !== false && o.fabric !== false && dressed;
  let F7 = null, S7 = null, was7 = false, wasS7 = false;
  const f7K = TIER_K[clip7 ? QUALITY.clips : QUALITY.stills] ?? 16;
  if (fab7) { try { F7 = await import('../cloth/fabric7/index.js'); was7 = !!F7.fabric7Options?.().on; F7.useFabric7({ ...(was7 ? {} : { samples: f7K }), ...D.fabric7, ...(isObj(fabric7) ? fabric7 : {}) });
    S7 = await import('../cloth/fabric7/shoes7.js'); wasS7 = !!S7.shoes7Options?.().on; S7.useShoes7(); } catch (e) { F7 = S7 = null; } }
  let P;
  try { P = await buildDressed(name, o); }
  finally { if (F7 && !(isObj(fabric7) && fabric7.keep)) { if (!was7) F7.stopFabric7(); if (!wasS7) S7?.stopShoes7?.(); } }
  // (CLOTH8 refit8's hook, 15 Oct; CLOTH9's seat9, c5 it2) the body's bind positions as the parts were attached, before BODY7's girdle / soft / pelvis move it
  const seatOn = seat9 !== false && D.seat9 !== false && D.seat9 != null && dressed;
  const X0dress = ((refit8 && refit8 !== false) || seatOn) && P.parts?.length ? Float64Array.from(P.h.body.geometry.attributes.position.array) : null;
  const R = P.report; RP.bake = R.person.bake; RP.pose = RP.poseBake ? 'dressed' : R.person.pose; RP.build = R.person; R.person = RP; RP.lanes.fabric7 = F7 ? { version: F7.FABRIC7_VERSION, ...D.fabric7, samples: was7 ? 'the page\'s' : f7K } : false;
  if (F7) RP.popts.fabric7 = { ...D.fabric7 };
  // (c5 it2) THE ANATOMY ACTS ON THE WHOLE SKIN: the draw cull (cullBody2: the triangles the bake calls covered, under the garments dressed and
  // under the underwear bare, dropped from the body's index) is lifted while BODY7's girdle, the girdle layer, the soft solve's fit, pelvis7 and
  // NOSEMOUTH run, and put back after them (before refit8 / seat9 / cover8, which read the full list themselves). Found in node: BODY7's
  // membrane fit read the CULLED index, so L08's breast fit moved 1266 vertices (max 11.3 mm) dressed and 3623 (32.4) bare (the bra cups'
  // skin culled) from ONE bake and key; with the whole skin, 4471 (31.3) dressed.
  const gB = P.h.body.geometry, fullTri = gB.userData.plan?.tri, culledIdx = b7 && fullTri && gB.index && gB.index.count < fullTri.length ? gB.index : null;
  if (culledIdx) gB.setIndex(new culledIdx.constructor(Uint32Array.from(fullTri), 1));
  // ---- BODY7: the girdle after the stance (the clavicle depressed while the arm hangs; the hands kept outside the hip)
  if (b7 && P.stages?.has?.('kin')) { const t = now();
    try { const J = await people7(), e = J.find(name), g = e?.prior?.prior?.rev7?.girdle; if (g) { const G7 = await import('../body/girdle7.js'); P.body7 = { girdle: g, G7 }; RP.lanes.body7.girdle = G7.girdle7(P.h, g, {}) ?? true; afterPose(P); } else R.seams.push('body7: no girdle record for ' + name); }
    catch (e) { R.seams.push('body7 girdle: ' + (e.message || e)); } RP.ms.girdle = Math.round(now() - t); }
  // ---- BODY7's GIRDLE LAYER (lib/fx/body/girdle_layer7.js girdleLayer7; WIRED 15 Oct, c5 it1: until today only labs/human8/body7_export.mjs --girdle
  // ran it): the neck base and the shoulder girdle's relief from ANAT8-BODY's skeleton (clavicle, manubrium, scapular spine) and the girdle muscles' borders
  // under the person's fat, IN PLACE of the detail tier's typed girdle forms and fitted muscle blobs (detail.Dg3: taken out over the same region, the bones'
  // relief put in). The figure study (BODY7's fit acts on the bare register: the dressed body is form 1). { girdleLayer: false } = a diagnosis A/B
  if (girdleLayer !== false && D.girdleLayer !== false && D.girdleLayer != null && P.stages?.has?.('kin')) {
    if (breg !== 'bare') RP.lanes.girdleLayer = { skipped: 'form 1 under the clothes (body7 false): the girdle layer acts on BODY7\'s body only' };
    else { const t = now(), go = { ...(isObj(D.girdleLayer) ? D.girdleLayer : {}), ...(isObj(girdleLayer) ? girdleLayer : {}) };
      try { const GL = await import('../body/girdle_layer7.js'), r = await GL.girdleLayer7(P, { name, register: breg, ...go }); R.girdleLayer = r;
        RP.lanes.girdleLayer = r?.skipped ? r : { version: r.version, region: r.region, reliefMm: r.reliefMm, typedRemovedMaxMm: r.detailGirdleRemovedMaxMm, detailGirdle: r.detailGirdle, foldGuard: r.foldGuard?.withdrawn ?? 0 }; afterPose(P); }
      catch (e) { R.seams.push('girdleLayer: ' + (e.message || e)); } RP.ms.girdleLayer = Math.round(now() - t); } }
  else RP.lanes.girdleLayer = false;
  // ---- ANAT8-BODY soft tissue: the solved envelope, the skin fitted onto it (ON for every woman since 15 Oct: anatomy/soft/hook.js soft8, the lane's keyed bake or the solve)
  if (soft !== false && P.stages?.has?.('kin')) {
    const L = isObj(D.soft) ? D.soft : await softLanded(), so = isObj(soft) ? soft : landedFor(L, name) ? { ...(L.opts || {}) } : null;
    if (so && (L?.module || so.module)) { const t = now();
      try { const M = await import('../' + (so.module || L.module)), fn = M[so.fn || L.fn || 'fitSkin7']; RP.lanes.soft = (await fn(P, { name, register: breg, ...so })) ?? true; afterPose(P); }
      catch (e) { R.seams.push('soft: ' + (e.message || e)); } RP.ms.soft = Math.round(now() - t); }
    else { RP.lanes.soft = false; RP.waiting = [...(RP.waiting || []), 'soft (ANAT8-BODY): not landed']; } }
  else RP.lanes.soft = false;
  // ---- ANAT8-PELVIS: the pelvic region's solved tissue (its own slot, after the breast's soft solve: lib/fx/anatomy/pelvis/hook.js pelvis7);
  // off until the lane lands it (v7lanes/ANAT8_PELVIS.json { pelvis: { module, fn, names: [..] | 'all', opts } }); the caller's { pelvis: {...} } is the A/B
  if (pelvis !== false && P.stages?.has?.('kin')) {
    const L = isObj(D.pelvis) ? D.pelvis : null, so = isObj(pelvis) ? pelvis : landedFor(L, name) ? { ...(L.opts || {}) } : null;
    const mod = so?.module || L?.module || (so ? 'anatomy/pelvis/hook.js' : null);
    if (so && mod) { const t = now();
      try { const M = await import('../' + mod), fn = M[so.fn || L?.fn || 'pelvis7']; RP.lanes.pelvis = (await fn(P, { name, register: breg, ...so })) ?? true; afterPose(P); }
      catch (e) { R.seams.push('pelvis: ' + (e.message || e)); } RP.ms.pelvis = Math.round(now() - t); }
    else { RP.lanes.pelvis = false; RP.waiting = [...(RP.waiting || []), 'pelvis (ANAT8-PELVIS): not landed']; } }
  else RP.lanes.pelvis = false;
  // ---- NOSEMOUTH (its slot, 8 Oct 22:33): the anatomy's nose and lips (ANAT8-HEAD's skull, NOSEMOUTH's cartilage and orbicularis) wrapped on the
  // person's face as a per-person displacement bake (lib/fx/anatomy/head/nose/wrap.js nosemouth7), after the face form and the stance and
  // BEFORE the fine tier (DETAIL7 places its creases and lip lines on the final landmarks; the hook hands the vermilion's paint and DETAIL7's
  // lip lines its borders); off until the lane lands it (v7lanes/NOSEMOUTH.json { nosemouth: { names: [..] | 'all', opts } }); the caller's
  // { nosemouth: {...} } is the A/B. A person without a bake is reported skipped by the hook (no seam).
  if (nosemouth !== false && P.stages?.has?.('face') !== false) {
    const L = isObj(D.nosemouth) ? D.nosemouth : null, so = isObj(nosemouth) ? nosemouth : landedFor(L, name) ? { ...(L.opts || {}) } : null;
    // (15 Oct c5) a `chain` of { module, fn, opts } runs in order in the one slot (the wrap, then the alar base's shell); else { module, fn } as before
    const chain = Array.isArray(so?.chain) ? so.chain : Array.isArray(L?.chain) ? L.chain : (so?.module || L?.module) ? [{ module: so?.module || L.module, fn: so?.fn || L?.fn || 'nosemouth7' }] : NOSEMOUTH_CHAIN;
    if (so) { const t = now(), reps = {};
      for (const st of chain) { try { const M = await import('../' + st.module), fn = M[st.fn]; const { chain: _c, ...so2 } = so; reps[st.fn] = (await fn(P, { name, register: breg, ...so2, ...(st.opts || {}) })) ?? true; afterPose(P); }
        catch (e) { R.seams.push('nosemouth ' + st.fn + ': ' + (e.message || e)); } }
      RP.lanes.nosemouth = chain.length === 1 ? reps[chain[0].fn] ?? false : reps; RP.ms.nosemouth = Math.round(now() - t); }
    else { RP.lanes.nosemouth = false; RP.waiting = [...(RP.waiting || []), 'nosemouth (NOSEMOUTH): not landed']; } }
  else RP.lanes.nosemouth = false;
  if (culledIdx) { gB.setIndex(culledIdx); RP.lanes.body7 && (RP.lanes.body7.wholeSkin = { culled: (fullTri.length - culledIdx.count) / 3 }); }
  // ---- CLOTH8 refit8 (c5 it2; ON by default since 15 Oct c4 it3; the caller's { refit8: false } is the A/B, { refit8: {...} } its options): the parts
  // (default the underwear, group 'found') bound to the body they were fitted on (X0dress) and placed on the body the person ends with;
  // byte-identical where the body did not move. Bare and dressed; the export (export.js buildPerson -> here) carries it to Cycles.
  if (X0dress && refit8 && refit8 !== false) { const t = now();
    try { const RF = await import('../cloth/cloth8/refit8.js'), ro = { ...(isObj(D.refit8) ? D.refit8 : {}), ...(isObj(refit8) ? refit8 : {}) }, tri = P.h.body.geometry.userData.plan?.tri;
      const rep = RF.refitPerson8(tri ? { ...P, bodyIndexFull: tri } : P, X0dress, ro); R.refit8 = rep; RP.lanes.refit8 = { version: RF.REFIT8_VERSION, moved: rep.bodyMoved ?? 0, parts: Object.keys(rep.parts || {}).length, ...(rep.skipped ? { skipped: rep.skipped } : {}) }; }
    catch (e) { R.seams.push('refit8: ' + (e.message || e)); } RP.ms.refit8 = Math.round(now() - t); }
  else RP.lanes.refit8 = false;
  // ---- CLOTH9's SEAT AT BUILD (seat9 rev 2: seatPerson9; WIRED 15 Oct c5 it2, CLOTH9's 'FOR THE INTEGRATOR' lines): every garment of the dressed
  // person re-seated, in its pose, on the body the person ends with (BODY7's body, the girdle layer, the soft solve, pelvis7 and refit8's underwear
  // all moved it after the parts were attached: X0dress); after refit8, BEFORE fine7 and cover8 (cover8 decides the covered skin from where the
  // cloth ends). The export (export.js buildPerson -> here) carries the seated parts to Cycles. { seat9: false } = a diagnosis A/B
  if (seatOn && X0dress) { const t = now();
    try { const so = { ...(isObj(D.seat9) ? D.seat9 : {}), ...(isObj(seat9) ? seat9 : {}) }, M = await import('../' + (so.module || 'cloth/cloth9/seat9.js'));
      const { module: _m, fn: _f, ...sopt } = so, r = await M[so.fn || 'seatPerson9'](P, X0dress, sopt); R.seat9 = r;
      RP.lanes.seat9 = r?.skipped ? r : { version: r?.version, parts: r?.parts, verts: r?.verts, x0: r?.x0, ms: r?.msTotal, ...(r?.dropped ? { dropped: r.dropped } : {}) }; }
    catch (e) { R.seams.push('seat9: ' + (e.message || e)); } RP.ms.seat9 = Math.round(now() - t); }
  else RP.lanes.seat9 = false;
  // ---- DETAIL7: the fine tier (on the final landmarks: after the face, the body and the stance); the export takes it to Cycles
  if (fine7 !== false && P.stages?.has?.('face') !== false) {
    const fo = { ...(isObj(D.fine7) ? D.fine7 : {}), ...(isObj(fine7) ? fine7 : {}) }, k = fo.form != null ? +fo.form : fineGain(P.info?.age, fo.age || DEFAULTS.fine7.age);
    RP.popts.fine7 = { res: fo.cycRes ?? DEFAULTS.fine7.cycRes, form: k, ...(fo.cyc ? { cyc: fo.cyc } : {}), ...(fo.body != null ? { body: !!fo.body } : {}) }; RP.lanes.fine7 = { form: k, body: !!fo.body };
    if (!forExport && fo.engine !== false) { const t = now();
      try { const FI = await import('../anatomy/fine/index.js'); P.fine7 = await FI.applyFine7(P.h, P.info, { res: fo.res ?? DEFAULTS.fine7.res, ...(fo.body != null ? { body: !!fo.body } : {}) }); P.fine7.set({ form: k, cavity: 0.8 * k }); RP.lanes.fine7.engine = true; }
      catch (e) { R.seams.push('fine7: ' + (e.message || e)); } RP.ms.fine7 = Math.round(now() - t); } }
  else RP.lanes.fine7 = false;
  // ---- CLOTH8 cover8 (dressed): the export applies it after CORRECT5's corrected bind (export.js), the engine here
  if (cover8 !== false && dressed && P.parts?.length) {
    const c8 = { ...(isObj(D.cover8) ? D.cover8 : DEFAULTS.cover8), ...(isObj(cover8) ? cover8 : {}) }; RP.popts.cover8 = c8; RP.lanes.cover8 = c8;
    if (!forExport) { const t = now(); try { const C8 = await import('../cloth/cloth8/cover8.js'); R.cover8 = C8.applyCover8(P, c8); } catch (e) { R.seams.push('cover8: ' + (e.message || e)); } RP.ms.cover8 = Math.round(now() - t); } }
  else RP.lanes.cover8 = false;
  // ---- MOTION c3 rev 7d: the act baked on this person
  if (clip7) { const t = now(); try { P.motion = await attachMotion7(P, name, mo, A7); RP.lanes.motion = { clip: mo.clip, nf: P.motion.T?.nf ?? null, path: P.motion.path }; }
    catch (e) { R.seams.push('motion7: ' + (e.message || e)); } RP.ms.motion = Math.round(now() - t); }
  // ---- CLOTHINT: other cloth over this person
  P.colliders = async (oc = {}) => (await import('../cloth/colliders.js')).peopleColliders(P, { ...(isObj(D.colliders) ? D.colliders : {}), ...oc });
  P.clothMesh = async (oc = {}) => (await import('../cloth/colliders.js')).peopleMesh(P, { ...(isObj(D.clothMesh) ? D.clothMesh : {}), ...oc });
  RP.ms.total = Math.round(now() - T0); R.ms.total = RP.ms.total;
  // the same person again with some options changed (another wear, a switch): a fresh build; the caller swaps the groups when it is ready
  P.rebuild = (over = {}) => { const oo = { ...opts, ...over }; if (over.wear != null && over.stages == null) delete oo.stages; return buildPerson(name, oo); };
  // Emit only measured duration fields. A diagnostics failure must not change the completed build.
  try { console.log(JSON.stringify(personBuildTimingRecord(P, name))); } catch {}
  return P;
}

// ---------------------------------------------------------------- the dressed person: the bake (or the dressed pose's), the face, skin, hair,
// fabric under FABRIC7, CORRECT5, HAIR6's settle (what the person carries under the lanes' round-7 results above)
async function buildDressed(name, o) {
  const { wear: _w, pose = 'dressed', fabric = {}, correct = true, hairSettle = true, castHair, stage, f5: f5o, ...r } = o;
  const SL = r.stages == null || r.stages === 'all' ? null : Array.isArray(r.stages) ? r.stages : String(r.stages).split(',').map(s => s.trim());
  const dressed = !SL || SL.includes('stack');
  // the bake: named > the dressed pose's (MOTION c2: CLIPS6.row6) > the default
  let bake = r.bake, poseBake = null;
  if (bake == null && pose && dressed) { try { const A = await import('../motion/act6.js'); poseBake = A.CLIPS6.row6.bake?.[name] || null; if (poseBake) bake = poseBake; } catch (e) { /* act6 absent */ } }
  bake = bake ?? DEFAULTS.bake;
  const last = String(bake).split('/').filter(Boolean).pop() || '';
  if (WARDROBE.test(last) || /^motion6\//.test(String(bake))) { const F4 = await import('../cloth/wardrobe4/fabrics4.js'); F4.registerFabrics4(); }
  // skin (one model for everyone: no per-person values), eyes, hair (+ CAST's blondes), the face: FACE6 + FACE7 over FACE5 over FACE4 + MOUTH
  const skin = r.skin === false ? undefined : { rev: 6, ...(isObj(r.skin) ? r.skin : {}) };
  const eyes = r.eyes === false ? undefined : isObj(r.eyes) ? { rev: 4, ...r.eyes } : { rev: 4 };
  const hair6 = r.hair === false ? false : { rev: 6, ...(isObj(r.hair) ? r.hair : {}) };
  if (hair6 && hair6.rev >= 6 && castHair !== false && !hair6.melanin && CAST_HAIR[name]) Object.assign(hair6, CAST_HAIR[name]);
  const hair = hair6 === false ? undefined : { rev: 4, ...{ rev: 5, ...hair6 } };
  let face3 = r.face3;
  if (face3 !== false) { face3 = { ...(isObj(face3) ? face3 : {}) }; if (face3.f6 === undefined) face3.f6 = {}; if (face3.f6 === false) delete face3.f6; }
  const keyDeg = await keyDegOf(stage);
  const f5 = f5o === false || face3 === false || (isObj(face3) && face3.f5 === false) ? null : { ...(isObj(face3?.f5) ? face3.f5 : {}), ...(isObj(f5o) ? f5o : {}) };
  if (f5 && keyDeg != null) f5.eyes = { keyDeg, ...(isObj(f5.eyes) ? f5.eyes : {}) };
  if (face3 !== false) { face3 = { ...face3 }; if (f5) face3.f5 = f5; else delete face3.f5; }
  const mouth = r.mouth === false ? null : r.mouth ?? MOUTH;
  if (face3 !== false) face3 = { rev: 4, ...(isObj(face3) ? face3 : {}), ...(mouth ? { mouth } : {}) };
  // FABRIC6's yarn-level data for the garments made during this build (page-wide hook: on for the build, off after)
  const F6 = fabric !== false ? await import('../cloth/fabric6.js') : null;
  if (F6) F6.useFabric6(isObj(fabric) && isObj(fabric.opts) ? fabric.opts : {});
  // the records, the bake's folder and the stance: dressed = the record the garments were sewn in (the bake's header); the figure study =
  // POSE's seeded draw
  const J = r.people ? await peopleAt(r.people) : await loadPeople2(), e = J.find(name); if (!e) throw new Error('person: no person ' + name);
  const bakeUrl = r.bakeUrl || PASSETS + bake + '/';
  const useBake = !SL || SL.includes('stack') || SL.includes('found');
  let stance = r.stance;
  if (stance === undefined) { if (dressed && useBake) { const b = await loadBake2(e.name, { url: bakeUrl }).catch(() => null); stance = b?.header?.stance || false; }
    else { const SM = await import('../motion/stance.js'); stance = stanceV3(SM, e, { seed: r.stanceSeed ?? 1 }); } }
  const ob = { ...r, bake, ride: r.ride ?? 'unsewn', face3, bakeUrl, stance, faceRev: r.faceRev ?? 3 };
  if (skin) ob.skin = skin; else delete ob.skin;
  if (eyes) ob.eyes = eyes; else delete ob.eyes;
  if (hair) ob.hair = hair; else delete ob.hair;
  if (ob.face3 == null) ob.face3 = true;
  let P, R; const ms = {};
  try { P = await buildBaked(name, ob); R = P.report;
    R.person = { bake, pose: poseBake ? 'dressed' : false, ride: ob.ride, skin: skin || false, eyes: eyes || false, hair: hair || false, face3: face3 || false, mouth: mouth || false, f5: f5 || false, keyDeg, fabric: F6 ? 6 : false, correct: !!correct, ms };
    // HAIR4: the atlas decoded before a still; the scalp hair out of the POSED body and garments
    if (hair && P.groom) { const t = now(); try { const Hm = await import('../hair/index.js'); R.person.hair4Ready = await Hm.hair4Ready(); } catch (err) { R.seams.push('hair4Ready: ' + (err.message || err)); } ms.hair4Ready = Math.round(now() - t); }
    if (r.settle !== false && P.groom && P.stages.has('kin')) { const t = now(); try { R.person.settle = settleHairPosed(P, isObj(r.settle) ? r.settle : {}); } catch (err) { R.seams.push('settle: ' + (err.message || err)); } ms.settle = Math.round(now() - t); }
    // the cloth's posed spikes pulled back
    if (r.despike !== false && P.parts?.length && P.stages.has('kin')) { const t = now(); try { R.person.despike = despikeParts(P, isObj(r.despike) ? r.despike : {}); } catch (err) { R.seams.push('despike: ' + (err.message || err)); } ms.despike = Math.round(now() - t); }
    if (P.groom && !P.groom.meshes.some(m => m.userData.hairPart === 'scalp') && P.hair?.style) R.seams.push('hair: no scalp mesh drawn'); }
  finally { if (F6 && !(isObj(fabric) && fabric.keep)) F6.stopFabric6(); }
  // HAIR6: the free strands settled onto the posed person (stance + garments); written back to the bind positions (the export sees it)
  if (hair6 && hair6.rev >= 6 && hairSettle !== false && P.groom && P.stages?.has?.('kin')) { const t = now();
    try { const S6 = await import('../hair/sim6.js'); const s = S6.settleHair6(P, isObj(hairSettle) ? hairSettle : {}); R.person.settle6 = s && { strands: s.strands ?? s.free ?? null, ms: s.ms ?? null }; }
    catch (err) { R.seams.push('settleHair6: ' + (err.message || err)); } ms.settle6 = Math.round(now() - t); }
  // FABRIC6: the per-vertex data now (else each mesh draws once without it); fuzz shells only when asked
  if (F6 && P.parts?.length) { const t = now(); try { R.person.fabricData = F6.prepareFabric6(P.h.group); if (isObj(fabric) && fabric.fuzz) R.person.fuzz = F6.fuzz6(P.h.group, isObj(fabric.fuzz) ? fabric.fuzz : {}); }
    catch (err) { R.seams.push('fabric6: ' + (err.message || err)); } ms.fabric = Math.round(now() - t); }
  // CORRECT5: after the parts (despike, settle); carried to the garments; P.correct.update() after every later pose
  if (correct && P.stages?.has?.('kin')) { const t = now();
    try { const C5 = await import('../body/correct.js'); P.correct = C5.applyCorrectives(P, isObj(correct) ? correct : {}); R.correct = P.correct.stats; }
    catch (err) { R.seams.push('correct: ' + (err.message || err)); } ms.correct = Math.round(now() - t); }
  return P;
}

// ---------------------------------------------------------------- the nude register (integrator c6): the upper foundation and its cull
// The bake's foundations (K3: group 'found') carry no garment id per part, so the upper foundation is found by where the parts lie in height: the
// found parts grouped by OVERLAPPING height ranges (a bra's shells, band, edges and straps overlap one another; the briefs' shell, waist and leg
// bindings overlap one another; the two garments are ~5-15 cm apart: the midriff). With two or more groups the top one is the upper foundation;
// one group (a man's briefs, or a brief that reaches the band) leaves nothing out, so 'nude' is then the bare register. yCut (body units) is midway
// between the upper group's lowest point and the next group's highest.
export function upperFoundation(parts, scale = 1) {
  const S = parts.filter(q => q.group === 'found' && q.X?.length).map(q => { let lo = Infinity, hi = -Infinity; const n = q.X.length / 3;
    for (let i = 0; i < n; i++) { const y = q.X[i * 3 + 1] / scale; if (y < lo) lo = y; if (y > hi) hi = y; } return { q, lo, hi }; }).sort((a, b) => a.lo - b.lo);
  const G = []; for (const s of S) { const g = G[G.length - 1]; if (g && s.lo <= g.hi + 0.01) { g.parts.push(s.q); g.hi = Math.max(g.hi, s.hi); } else G.push({ lo: s.lo, hi: s.hi, parts: [s.q] }); }
  const out = new Set(); out.yCut = null; out.groups = G.length; if (G.length < 2) return out;
  const top = G[G.length - 1], next = G[G.length - 2]; for (const q of top.parts) out.add(q); out.yCut = (top.lo + next.hi) / 2; return out;
}
// the bake's cull (level-0 triangles of the 13k body) without the triangles whose centroid lies above yCut (the skin the bra covered); body units
function cullBelow(h, tris, yCut) {
  const g0 = h.body.userData.geomL0 || h.body.geometry, P = g0.attributes.position.array, I = g0.index?.array; if (!I || yCut == null) return tris;
  return Array.from(tris).filter(t => (P[I[t * 3] * 3 + 1] + P[I[t * 3 + 1] * 3 + 1] + P[I[t * 3 + 2] * 3 + 1]) / 3 < yCut);
}

// ---------------------------------------------------------------- the baked person: one person in the page, each stage switchable
// stages (in this order): form prior | face | detail | kin | hair | skin eyes | found (K3 underwear) | stack (sewn garments) | style
//   form off = CAST's record as baked (form 0); prior off = FORM alone. found / stack draw the BAKE (its body is prior + bra + face):
//   with them on, form, prior and face are the bake's (a re-bake switches those). Without found the figure-study register is the
//   painted underwear (lane E + the bust band).
async function buildBaked(name, opts = {}) {
  const T0 = now(), PI = await import('./index.js'), st = opts.studio || await PI.loadPersonStudio(), S = st.S;
  const SS = new Set(opts.stages === 'all' || opts.stages == null ? STAGES2.filter(s => s !== 'style') : Array.isArray(opts.stages) ? opts.stages : String(opts.stages).split(',').map(s => s.trim()).filter(Boolean));
  const R = { ms: {}, seams: [], notes: [], stages: STAGES2.filter(s => SS.has(s)) }, tm = (k, t) => { R.ms[k] = Math.round(now() - t); };
  const J = opts.people ? await peopleAt(opts.people) : await loadPeople2(), e = J.find(name); if (!e) throw new Error('person: no person ' + name + ' in ' + (opts.people || 'assets/person/v2_people.json'));
  const pl = V2_PLAN[e.name], useBake = SS.has('found') || SS.has('stack'), dressed = SS.has('stack');
  // two bakes a person: '<name>' (DRESSED, made on the form-1 body: K2's sewn sleeves hang beside the arms on 8 of 12 learned-prior
  // bodies, see the notes) and '<name>_base' (the FIGURE-STUDY register: K3's underwear on the learned-prior body)
  const bu = opts.bakeUrl ? { url: opts.bakeUrl } : {};
  let t = now(); let bake0 = null; if (useBake) { if (!dressed) bake0 = await loadBake2(e.name + '_base', bu).catch(() => null); bake0 ||= await loadBake2(e.name, bu); }
  // the body the bake was made on (header.body: 'prior' or 'form1'; see the notes: sewn sleeves on learned bodies)
  // header.bodyKind (bakes before it: '_base' and the round-1 bakes placed from form 1 are prior bodies, the dressed ones form 1;
  // header.body is packBake's body block, not the kind)
  const which = useBake ? (bake0.header.bodyKind || (bake0.header.placeFrom ? 'prior' : bake0.header.stack ? 'form1' : 'prior')) : SS.has('prior') ? 'prior' : SS.has('form') ? 'form1' : 'form0', p = await personOf(S, e, which); tm('who', t);
  const info = { name: e.name, label: e.label, sex: e.sex, age: Math.round(e.age), group: e.group, bmi: p.measures?.bmi ?? null, stature: p.height, skin: e.skin, body: which, model: which === 'prior' ? e.model : null };
  // ---- the hero data: the bake's body (prior + bra + face), or the record with FACE c2 made here, or the record as is
  let data = p, variant = p.meta.variants[0].name, bake = null, face = null;
  t = now();
  if (useBake) { bake = bake0; variant = bake.v2.variant; const V = { ...p.meta.variants[0], name: variant, mouth: bake.v2.mouth }, ex = new Map([['pos_' + variant, bake.pos], ['eyes_' + variant, bake.eyes]]);
    data = { ...p, name: variant, meta: { ...p.meta, variants: [V] }, arr: k => (ex.has(k) ? ex.get(k) : p._S.hero.arr(k)) }; face = bake.header.face;
    if (!SS.has('face') || !SS.has('prior') || !SS.has('form')) R.notes.push('found/stack draw the bake: its body is form 1 + prior + bra + FACE c2 whatever those switches say'); }
  else if (SS.has('face')) { const FC = await import('../face/index.js'), F = st.F ||= await FC.loadFaceStudio(), src = FC.sourceOf(p, variant);
    src.rec = { ...src.rec, sex: p.sex, age: p.age, group: p.group, measures: p.measures, height: p.height };   // (integration v3: opts.faceRev 3 = MakeHuman's targets at their real size)
    const fr = FC.makeFace(F, src, { rev: opts.faceRev ?? 2, look: pl?.look || 'common' }); data = FC.withFace(src, fr, '_v2'); variant = data.variant; face = { mouth: fr.mouth, c2: fr.c2 }; }
  tm('face', t);
  // ---- FACE3 (round 3, opt-in: opts.face3 true | a face3 spec): women's dimorphism within range, a seeded closed-mouth neutral or slight
  // smile with the lips sealed, the eyes' wet parts, the GPU seam fix, optional light make-up (face/face3.js; FACE3_CAST per person)
  let f3 = null, F3 = null;
  if (opts.face3) { t = now(); F3 = await import('../face/face3.js'); const FCx = await import('../face/index.js'), F = st.F ||= await FCx.loadFaceStudio();
    const sp = F3.face3Spec(info, { seed: opts.seed ?? 1, ...(F3.FACE3_CAST[e.name] || {}), ...(typeof opts.face3 === 'object' ? opts.face3 : {}) });
    const r3 = await F3.face3Data(data, variant, sp, { F }); data = r3.data; variant = r3.variant; f3 = r3.f3; R.face3 = f3.report; tm('face3', t);
    // (integration v4) FACE4's identity basis is a statistical derivative of the HSRD-100 scans (CC BY 4.0): its credit joins R.credit
    const c4 = R.face3?.f4?.credit; if (c4) { R.credits = [...new Set([...(R.credits || (R.credit ? [R.credit] : [])), c4])]; R.credit = R.credits.join(' | '); } }
  t = now(); const h = new Hero(data, heroOpts2(e, variant, p.height)); tm('hero', t);
  // garments: hero.js's c7 shells off (boots stay with the sewn garments); c1's band covers off (the cull decides what skin is drawn)
  for (const [k, v] of Object.entries(h.cloth)) [].concat(v).forEach(m => { if (m) { m.visible = dressed && k === 'boots'; m.castShadow = m.visible; } });
  if (h.hatGroup) h.hatGroup.visible = false; if (h.skinU.hCover) h.skinU.hCover.value.w = 0; if (h.skinU.hCover2) h.skinU.hCover2.value.set(0, 0, -100, -100);
  if (h.skinU.hBoots && !dressed) h.skinU.hBoots.value = 0; h._bare = !dressed;
  const order = [];
  // ---- HAIR (lane D), BEFORE P1's subdivision: lane D's head field and its scalp attribute (aHairD) are sized by h.meta.n (the 13k
  // body); groomed here, the subdivision carries aHairD like any float attribute and the cards keep their original-vertex bindings
  // HAIR3 (round 3): the plan's hair (V2_HAIR, below: style, form, colour per person) over hairFor's seeded pick; opts.hairPlan false = as v2
  const hair = PI.hairFor({ ...info }, opts.seed ?? 1, { ...(opts.hairPlan !== false && V2_HAIR[e.name] || {}), ...(opts.hair || {}) }); let groom = null;
  if (SS.has('hair') && st.Hm && !st.Hm._error) { t = now(); try { const ho = { styles: st.hairStyles, style: hair.style, form: hair.form, age: e.age, beard: hair.beard, seed: opts.seed ?? 1, melanin: hair.melanin, ...(opts.cycles ? { cycles: true } : {}), ...(hair.grey != null ? { grey: hair.grey } : {}), ...(hair.look3 != null ? { look3: hair.look3 } : {}), shade: { rNorm: opts.hairRNorm !== false }, ...(f3?.hair || {}), ...(opts.hair || {}) }; delete ho.hex;
      groom = st.Hm.groomHero(h, ho); order.push('hair'); R.hair = { style: ho.style, form: ho.form, beard: ho.beard, melanin: ho.melanin }; } catch (err) { R.seams.push('hair: ' + (err.message || err)); } tm('hair', t); }
  // ---- P1: anatomy at resolution (level 1 at hero distance), BEFORE skin and style (their fields then live on the detailed mesh)
  let D = null;
  if (SS.has('detail')) { t = now(); try { const DT = await import('../body/detail.js'); D = DT.applyDetail(h, p, { level: opts.detailLevel ?? 1, ...(opts.detail || {}) }); } catch (err) { R.seams.push('detail: ' + (err.message || err)); } tm('detail', t); }
  // ---- the figure-study register without K3: v1's painted underwear (the bust band + lane E's briefs)
  if (!useBake) { const band = PI.bustBand(h, p); if (band) { PI.paintBand(h, band); order.push('bust band'); }
    if (st.SF && !st.SF._error) { const sty = st.SF.applySurface(h, { surface: 'skin', fade: 0, underwear: true }); if (band) sty.U.stUW.value.w = 0; h._v2sty = sty; order.push('painted underwear'); } }
  // ---- KIN (lane F's idleStance with the person's own model)
  const poseSpec = pl ? poseOf2(e, pl) : { weight: 0.6, stance: 'rest', look: 0, age: [e.age, e.age] };
  // round 3 POSE (opt-in): opts.stance (true | 'seeded' | a motion/stance.js record | { legs, arms, side, armSide, head, seed }) stands the person in a
  // seeded natural stance (weight on one leg, the pelvis and shoulders counter-tilted, the head turned, relaxed hands); absent = standV2 as before
  t = now(); if (SS.has('kin')) { if (opts.stance) { const SM = await import('../motion/stance.js'), rec = stanceOf2(SM, e, opts.stance, { seed: opts.stanceSeed ?? 1, dressed });
      R.stance = SM.standPerson(h, rec, { person: p }); } else standV2(h, e, pl, p, useBake ? { armOut: bake.header.armOut || 0 } : {}); } else { h.resetPose(); } h.update(); D?.update?.(); tm('kin', t);
  R.kin = SS.has('kin') && h.meta?.kin ? PI.kinRead(h, h.meta.kin) : null;
  // ---- SKIN (lane B via H1; FACE c2's params) and the lip mask; EYES
  let skinR = null, eyesR = null;
  if (SS.has('skin') && st.L && !st.L._error) { t = now(); skinR = await st.L.applySkin(h, { level: 0, ...(face?.c2?.skin || {}), ...(opts.skin || {}) }, { model: st.skinModel }); order.push('skin');
    if (face?.c2?.lipsMask) { const FC = await import('../face/c2.js'); FC.fitLipMask(h, face.c2.lipsMask); } tm('skin', t); }
  if (f3) R.face3.skin = F3.face3Skin(h, f3);   // FACE3: the contact line, make-up (an H1 hook after lane B) and the seam fix
  // (integrator c6, 16 Oct; the orchestrator's 00:55 order from EYES' it14 critic) THE IRIS FROM THE PERSON'S OWN PIGMENT: the melanin column, the
  // pheo / eu ratio, the border layer's share and the stroma's law drawn per person from a continuous distribution by ancestry and age, seeded by
  // the person (person/iris7.js irisPigment7, on EYES' anchors); EYES' eye7 grows the iris from it (eye7Record's `pig`; the export carries it to
  // Cycles). Until today a class was looked up by group here (white: one of five; hispanic: brown / brown / hazel; everyone else dark brown).
  // `iris` stays EYES' nearest anchor for what EYES still keys by class; the caller's { eyes: { iris, pig } } wins (an A/B).
  if (SS.has('eyes') && st.E && !st.E._error) { t = now(); const I7 = (await import('./iris7.js')).irisPigment7({ name: e.name, group: e.group, age: e.age, sex: e.sex, seed: opts.seed ?? 1 });
    eyesR = st.E.buildEyes(h, { iris: I7.cls, pig: I7.pig, ...(face?.c2?.eyes || {}), ...(f3?.eyes || {}), ...(opts.eyes || {}) }); R.iris7 = { pig: eyesR?.opt?.pig ?? I7.pig, cls: eyesR?.opt?.iris ?? I7.cls, ratio: I7.ratio, from: I7.from }; tm('eyes', t); }
  // ---- K3's underwear and the sewn garments (baked), skinned to this Hero; the skin cull at the body's level
  let parts = [];
  if (useBake) { t = now(); const scale = bake.header.scale;
    // (CLOTH8 seam (b), opt-in: opts.posedNormals true / false, else the bake's own header: cloth8.normals 'posed' (v8c))
    const pn = opts.posedNormals ?? (bake.header.cloth8?.normals === 'posed');
    // (integrator c6) the nude register: the upper foundation (the found parts above the waist: the bra's cups, band and straps) left out
    const upper = !dressed && opts.nude ? upperFoundation(bake.parts, scale) : null;
    for (const q of bake.parts) { if (q.group !== 'found' && !dressed) continue; if (upper?.has(q)) continue; parts.push(await partMesh2(h, dressed && q.Tfull ? { ...q, T: q.Tfull } : q, scale, pn ? { posedNormals: true } : {})); }
    // (integration v6, CLOTH6's finding) ride: 'unsewn' rides only the parts that are not sewn (a sewn construction layer and its garment
    // rode different body points and crossed again); any other value: as before
    if (D && opts.ride !== false) R.rideDetail = await rideDetail(h, opts.ride === 'unsewn' ? parts.filter(m => !m.userData.k3?.sewn) : parts);
    R.culled = cullBody2(h, dressed ? bake.cullFull : upper?.size ? cullBelow(h, bake.cullBase, upper.yCut) : bake.cullBase);
    if (upper) R.nude = { left: upper.size, groups: upper.groups, yCut: upper.yCut == null ? null : +upper.yCut.toFixed(4), culled: R.culled };
    // (integration v4, CLOTH4's hand-off) a bake that carries its own boot (parts of group 'boot', cloth/boot4.js) hides hero.js's c7 boots
    if (dressed && bake.parts.some(q => q.group === 'boot')) { for (const m of [].concat(h.cloth?.boots || [])) if (m) { m.visible = false; m.castShadow = false; } R.boots = 'bake'; }
    if (opts.lift !== false && SS.has('kin')) R.liftOverPosed = liftOverPosed(h, parts.filter(m => m.userData.k3?.group !== 'construction' && !m.userData.k3?.sewn));   // CLOTH3: a sewn garment (dress3 bakes) is not lifted: it was carried into this pose against the posed body (the lift raised 5 cm bumps at the clavicles)
    tm('parts', t);
    R.bake = { stack: bake.header.stack, cover: bake.header.cover, k2: bake.header.k2, ms: bake.header.ms, bra: bake.header.bra }; }
  // ---- STYLE: lane E's surface patch and its reach to every later material (v1's seam 5)
  const recipe = SS.has('style') ? PI.recipeOf(st, opts.style || 'photoreal') : null;
  if (recipe && st.SF && !st.SF._error) { let sty = h._v2sty; if (!sty) sty = st.SF.applySurface(h, { surface: 'skin', fade: recipe?.surface?.fade ?? 0, underwear: false });
    let k = 60; const done = new Set(); h.group.traverse(m => { if (!m.isMesh) return; for (const mt of [].concat(m.material)) if (mt && !mt.userData.style && !done.has(mt)) { done.add(mt); st.SF.patchOther(mt, sty, m.userData.part === 'hair8' ? 50 : k++); } });
    // notan / poster: the sewn garments and the underwear keep their lit planes (lane E's ST_CLOTH_LIFT, seam 17); opts.clothLift false: as lane E prints them
    if (opts.clothLift !== false) h.group.traverse(m => { if (!m.isMesh || !/^v2-/.test(m.userData.part || '') || m.material.isMeshPhysicalMaterial && m.userData.k3?.construction === 'button') return; const mt = m.material; mt.defines = { ...(mt.defines || {}), ST_CLOTH_LIFT: 1 }; mt.needsUpdate = true; }); }
  R.patchOrder = { applied: order };
  h.group.traverse(m => { if (m.isMesh && m.visible) { m.receiveShadow = true; if (m.castShadow == null) m.castShadow = true; } });
  R.tris = PI.trianglesOf(h); R.tris.parts = parts.reduce((a, m) => a + m.geometry.index.count / 3, 0); R.ms.total = Math.round(now() - T0);
  return { h, p, info, wear: dressed ? { kind: 'shirt+trousers', shirt: pl?.shirt, trousers: pl?.trousers } : null, hair, pose: R.stance ? R.stance.record : poseSpec, stages: SS, recipe, skin: skinR, eyes: eyesR, groom, detail: D, face, bake, parts, report: R, baked: true };
}

// ---------------------------------------------------------------- posing: core.js poserOf (lane F's IK); after a pose the girdle again (figure study)
export function afterPose7(P) { afterPose(P); if (P.body7) { try { P.body7.G7.girdle7(P.h, P.body7.girdle, {}); afterPose(P); } catch (e) { /* the pose stands without the girdle */ } } P.fine7 && P.h.update?.(); return P; }

// ---------------------------------------------------------------- MOTION c3 rev 7d on the person: the act baked in place (bakeTrack7), MOTION's
// players, CORRECT5 per frame. P.motion.apply(t). A throwing bake throws (8 Oct 20:17, MOTION c3's hand-off: the fallback to MOTION c2's
// cached clips, assets/person/motion6/{lift6,row6,walk6,wave6}, is gone with them: a clip is the current act or an error, never an old one).
export async function attachMotion7(P, name, { clip, cloth = true, hair = true, fps = 15, extra = null, cacheRecipe = null } = {}, A7 = null) {
  A7 = A7 || await import('../motion/act7.js');
  const { bakeTrack7 } = await import('../motion/bake7.js'), CM = await import('../motion/cloth_motion.js');
  const C = A7.CLIPS7[clip], nf = Math.round((C.dur || 6) * fps) + 1;
  let T = null, rep = null, path = 'w7:ok';
  try { const bake = () => bakeTrack7(P, () => A7.actFor7(clip, P, name, extra), { clip, name, fps, nf, key: 3, every: 2, cloth, hair: hair && !!P.groom, rulers: false });
    let useCache = null; const policy = globalThis.__ACP_MOT4_TRACK_CACHE_POLICY__;
    if (cacheRecipe && policy?.enabled === true && policy?.qualified === true) {
      try { const [{ withMotion7TrackCache }, { calibrateLids }] = await Promise.all([import('../motion/mot4_track_cache.mjs'), import('../motion/life.js')]);
        useCache = () => withMotion7TrackCache({ P, A7, CM, clip, name, fps, nf, extra, cloth, hair: hair && !!P.groom, cacheRecipe, calibrateLids, bake });
      } catch { /* an unavailable optional cache leaves the original bake path usable */ }
    }
    const B = useCache ? await useCache() : await bake();
    T = B.T; rep = B.rep; if (rep.act?.err7) path = 'w7:partial(' + rep.act.err7 + ')'; }
  catch (e) { throw new Error(`person: MOTION c3's bake of '${clip}' for ${name} failed: ${String(e?.message || e).slice(0, 200)}`); }
  const h = P.h; h.group.position.set(0, 0, 0); h.group.rotation.y = 0; h.group.updateMatrixWorld(true);
  const tp = new CM.TrackPlayer(P, T), hp = new CM.HairPlayer(P, tp), ep = new CM.EyePlayer(P);
  const M = { clip, T, rep, path, tp, hp, ep, fps: T.H?.fps || fps };
  M.place = (x = 0, z = 0, yaw = 0) => { const g = P.h.group; g.position.set(x, g.position.y, z); g.rotation.y = yaw; if (tp.g0) tp.g0 = { p: g.position.clone(), yaw }; return M; };
  M.apply = (t, oo = {}) => { const fr = tp.apply(t, { cloth: oo.cloth !== false }); try { hp.apply?.(t, fr); ep.apply?.(t, fr); } catch (e) { /* players without a frame API */ }
    try { A7.applyFace7?.(P.h, nm => tp.chan?.(nm, fr)); } catch (e) { /* no face channels */ } P.correct?.update?.(); return fr; };
  return M;
}
