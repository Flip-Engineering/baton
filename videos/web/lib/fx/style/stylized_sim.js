// STYLE / stylized_sim (issue #87, pinned head e235ca4): the same act and the same cloth solver on a lane-E
// styled figure, plus the matched photoreal/stylized measurement that makes the comparison reviewable.
//
// WHAT THIS FILE IS, AND IS NOT
// The studio has two person paths. The current person (lib/fx/person) builds its body, garments and bake, but its
// `style` option applies lane E's SURFACE patch only; the shape ladder is not run on that body. Lane E's own path
// (style/recipes.js -> style/shape.js -> Hero) is the stylized person: `styledPerson(base, recipe)` returns a hero
// data object with the simplification ladder and the canon applied, and `Hero` cuts garments on that body. This
// file is the missing link between that stylized body and the studio's own MOTION/CLOTH behaviour:
//
//   base (crewPerson / bodyPerson / personFrom, lane A landmarks+relief)
//     -> styledPerson(base, recipe)                 shape ladder + canon (style/shape.js)
//     -> Hero(S, opts); S.finish(h)                 the styled body, dressed (hero.js)
//     -> tagSimulationParts(h)                      the garments as the cloth solver's parts (userData.k3)
//     -> bakeTrack7(P, act, { cloth: true })        the same act bake and ClothMotion as a realistic person
//     -> measureClothSim(P, spec, act)              contact, strain and penetration in the solver's own units
//     -> compareMatched(photo, stylized)            one photoreal baseline, one stylized candidate
//
// The cloth solver is not reimplemented and not edited. ClothMotion already carries any mesh whose
// `userData.k3.group` is 'garment' or 'construction'; Hero's shells did not carry that tag, so we add the tag and
// the fabric name (the wardrobe's registered fabrics) and then the existing solver treats them exactly as it
// treats a current person's sewn garments. Nothing in anatomy/cloth/contact/skin/hair/motion is changed.
//
// THE MATCHED PAIR
// A comparison is only meaningful if exactly one variable changes. `matchedPair` builds two specs whose every
// simulation field (person, seed, clip, fps, frames, key, every, cloth, hair, extra act options, cloth options,
// source pins) is identical and whose `style`/`recipe` differ. `assertMatched` refuses a pair that differs
// anywhere else, and `simulationKey` is the canonical hashable form of the shared fields. The photoreal baseline
// is recipe 'photoreal' (distance 0); the stylized candidate must clear `MIN_STYLE_DISTANCE`, so a surface-only
// tweak cannot pass as a stylized figure.
//
// THE MEASUREMENT
// `measureClothSim` runs the same act through ClothMotion with the same options, steps it in clip order, and
// reports what the solver itself reports: the per-frame skin/sunk/inside vertex counts (`ClothMotion.measure`),
// the maximum edge strain against the garment's own stance edge lengths and its utilisation against that part's
// fabric smax, the relaxation/push caps, and the deepest cloth-inside-body distance in mm (the same nearest-body
// test measure() uses, kept signed). The style look is measured separately by `styleDistance`, a deterministic
// read of the lane-E recipe (shape level, canon), not an image statistic. Hero's garments are shader-cut shells,
// not the current person's sewn cloth stack, so the absolute contact counts are not zero even on the control. The
// pass is a matched regression: the stylized arm must stay within the documented bounds of the photoreal arm
// built on the same shell (the raw counts are reported, not hidden). The production-clean path remains the current
// person's sewn garments.
//
// No render is launched here; a lab or scene calls buildStyledFigure/simulateFigure and then StyleStage.render.
// Source pins are exact for pinned head e235ca432f1514842da8e99ec28addf77c99b2d4; `node --test` verifies each
// pinned blob's sha256 and git blob id.
import { STYLES } from './recipes.js';

export const VERSION = 'stylized-sim-v1';
export const PINNED_HEAD = 'e235ca432f1514842da8e99ec28addf77c99b2d4';
export const MIN_STYLE_DISTANCE = 1.5;

// Exact source pins at the pinned head. Every pin carries a sha256 and a git blob id; source_commit is the last
// commit that touched the file at the pinned head. The test computes each pinned blob's sha256 and checks both ids.
export const SOURCE_PINS = Object.freeze([
  { path: 'videos/web/lib/fx/style/recipes.js', sha256: '57e207905dd3a6fc908033ed8ff7fec2eabb91c52ee43f266b062263686fc2a1', git_blob: 'a9328533be900ee3d882b98c2df5f5040f8cc3db', source_commit: 'db037ddc1019cd53890c029174a351dfde5f1011' },
  { path: 'videos/web/lib/fx/style/shape.js', sha256: 'a50ee7cdce096425bd144823b5f835aff1368bebe63b81227ed07dc31b153c96', git_blob: '88734e34ed2f2a1606d2b630e21bcf1de0646df6', source_commit: 'db037ddc1019cd53890c029174a351dfde5f1011' },
  { path: 'videos/web/lib/fx/style/surface.js', sha256: '8ba4bd2b67eed643a8240c32ef26df92543ffff88bc06683f13021ecd910a909', git_blob: '654d898dacc1a2148a6281ab7aeb020b2e6a6b08', source_commit: 'db037ddc1019cd53890c029174a351dfde5f1011' },
  { path: 'videos/web/lib/fx/style/line.js', sha256: '1074500caed1ec6294ef65e64c23d9027b1c6b228d7ae622768a8308096c6e3f', git_blob: 'dc28934cec5d935163ce11124ff28d546d65da7c', source_commit: 'db037ddc1019cd53890c029174a351dfde5f1011' },
  { path: 'videos/web/lib/fx/style/person.js', sha256: 'c473edc0a777e278e458717c5babcc15a59ebf22d1dc48dc2e49e907c8f008ef', git_blob: '4ddb3d1669cdd609dc684fbe842058577668008f', source_commit: 'db037ddc1019cd53890c029174a351dfde5f1011' },
  { path: 'videos/web/lib/fx/motion/bake7.js', sha256: 'af3c61ec9b445181a30b1d7af7a623922183d57e3e5bc1a1ac0258fc45d61170', git_blob: 'efb9ded20b1c6edb63692a7eb8efea0c6beb55ac', source_commit: 'db037ddc1019cd53890c029174a351dfde5f1011' },
  { path: 'videos/web/lib/fx/motion/cloth_motion.js', sha256: '9c0d6717c0a8efcd2c828be54e98185ae22b09f8b9d2e6f06114540f18b639c4', git_blob: '794b81e7bbc1dc8474fb22726e9de03986d81329', source_commit: 'db037ddc1019cd53890c029174a351dfde5f1011' },
  { path: 'videos/web/lib/fx/cloth/wardrobe4/fabrics4.js', sha256: '24a83874b940b03285d03062ebda5961a5b9d550f7534897a2174e89b30c0180', git_blob: '9f8bf6c80fe6f4728355e0f172389590cae2a1e7', source_commit: 'db037ddc1019cd53890c029174a351dfde5f1011' },
  { path: 'videos/web/lib/fx/cloth/fabrics.js', sha256: '864b894d837387ed4c6343e43d309b9f33a5d07864a7a882748243bccf47c540', git_blob: 'd943ccb398878d83db348fcfaef222db45e0096d', source_commit: 'db037ddc1019cd53890c029174a351dfde5f1011' },
  { path: 'videos/web/lib/fx/hero.js', sha256: 'c7e915889aa62cb1afd3e5600d1f00832353bac0056d552bd5b0217bbf572683', git_blob: '510fbda8b8212879b94fae6af38e2d34dbb49bbc', source_commit: 'db037ddc1019cd53890c029174a351dfde5f1011' },
  { path: 'videos/web/scenes/oneshot2.js', sha256: 'b121349610bb3a0bf04badb87416bdd97e0cfa5f5d30e04e82656dfd021d86eb', git_blob: '4b7b4817edab4f3a3e4bc3913d1fa4a78e35a215', source_commit: 'ea83bca2b4ebcbc42d14a488d3e5f9d70de70e95' },
  { path: 'videos/sources/body/landmarks.json', sha256: '8ba105a0f23ad9a11b1923281f11baf26794d451405bf8d35b94c2cd7e1e308a', git_blob: 'f220cd834d8c1d1a555614d9a4995083b6d9b4d0', source_commit: 'db037ddc1019cd53890c029174a351dfde5f1011' },
  { path: 'videos/sources/makehuman/3dobjs/base.obj', sha256: '8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c', git_blob: 'd26635e9326e3cca30778fd7b9c00062b03cce09', source_commit: 'db037ddc1019cd53890c029174a351dfde5f1011' },
  { path: 'videos/sources/makehuman/rigs/default.mhskel', sha256: '99f179bce0aa850b45d4191a1d0d234c5851f881c057439470ded3bddf729a24', git_blob: 'b02cbecae00143856410d7561adf006d83bf9b3e', source_commit: 'db037ddc1019cd53890c029174a351dfde5f1011' },
  { path: 'videos/sources/makehuman/rigs/default_weights.mhw', sha256: '0f3641d651ae3d00ad6b4ccee43142edb109d3bd909d27d9e4139ef1beed8625', git_blob: '66185806afacf87749be8e5cf6dbf66496b2a6b0', source_commit: 'db037ddc1019cd53890c029174a351dfde5f1011' },
  // the binary bases the lane-E person reads (not in this partial clone; blob ids are exact at the pinned head)
  { path: 'videos/web/assets/body/basis.json', sha256: '1be38158dfb7f829d77a7e5168bdbce66436bb7576f2d9b7d5cd97d4efdf8983', git_blob: '2c6d308bf7fdeddef71af31b1b4c3ca87df40167', source_commit: 'db037ddc1019cd53890c029174a351dfde5f1011' },
  { path: 'videos/web/assets/body/basis.bin', sha256: '3b9dceee938fe90b1573bf86b02d92b9f62a48030d58a7d39e8060c2ff7455bd', git_blob: '13365ba34849308d4a98ee7769ad80f008d8843d', source_commit: 'db037ddc1019cd53890c029174a351dfde5f1011' },
  { path: 'videos/web/assets/hero/hero.json', sha256: '5fc94731cec45c4e60de2e947b927a4d92f11d78975b06d9272c3de821709928', git_blob: '10b11add857a86d9ab54e34027a1d574f65f5ed6', source_commit: 'db037ddc1019cd53890c029174a351dfde5f1011' },
  { path: 'videos/web/assets/hero/hero.bin', sha256: '4b26231e35c1013939da8fd1f0585f7ee8ab1662e65ab3fc5f835428223da453', git_blob: 'e846ce3b39a1ff36c189b747f4ac20257ff39a60', source_commit: 'db037ddc1019cd53890c029174a351dfde5f1011' },
  { path: 'videos/web/assets/rig/ansur_subjects.json', sha256: '245cb8c3938f55ca8f675933453d90f5910a0f06ca4be4622ae6965c59d55180', git_blob: '25251ab055fa9156db305a04f4b6930343929fb4', source_commit: 'db037ddc1019cd53890c029174a351dfde5f1011' },
]);

// The lane-E recipes this workstream will call stylized. The recipe itself stays in recipes.js; this is only the
// reviewable shortlist and the minimum style distance each must clear. (Distance is not the recipe's quality.)
export const STYLIZED_LOOKS = Object.freeze({
  sculpted: { recipe: 'sculpted', minStyleDistance: 3.0, note: 'L2 planes, clay, plane lines' },
  monumental: { recipe: 'monumental', minStyleDistance: 2.5, note: 'L1 masses, monumental canon, clay' },
  notan: { recipe: 'notan', minStyleDistance: 4.0, note: 'L2 planes, notan surface, designed medium' },
  engraving: { recipe: 'engraving', minStyleDistance: 2.0, note: 'L1 masses, engrave print' },
  woodcut: { recipe: 'woodcut', minStyleDistance: 2.5, note: 'L1.5 masses, woodcut print' },
  halftone: { recipe: 'halftone', minStyleDistance: 2.0, note: 'L1 masses, KLUTSIS looks' },
  poster: { recipe: 'poster', minStyleDistance: 4.0, note: 'L2 planes, three-ink poster' },
  cel: { recipe: 'cel', minStyleDistance: 3.5, note: 'L1.6 flat value' },
});

const SIM_FIELDS = ['who', 'seed', 'clip', 'fps', 'nf', 'key', 'every', 'cloth', 'hair', 'extra', 'clothOpts', 'assets'];
const CANON = { natural: 0, heroic: 0.6, monumental: 1.0, caricature: 0.8 };
const SURFACE = { skin: 0, clay: 1.0, flat: 1.5, notan: 1.6, poster: 1.6 };
const MEDIUM = { lit: 0, designed: 1.0, print: 1.2, looks: 1.2, ref: 1.4, film: 0.9, draw: 1.3, mural: 1.3, watercolour: 1.3, monument: 1.4, shadow: 1.5, plate: 1.2 };

const fail = (msg) => { throw new Error('stylized-sim: ' + msg); };
const isPlain = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
function canonical(value) {
  if (isPlain(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(v => canonical(v === undefined ? null : v)).join(',') + ']';
  if (typeof value === 'object') return '{' + Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  fail('only JSON values are comparable (got ' + typeof value + ')');
}
const round = (x, n = 4) => Math.round(x * 10 ** n) / 10 ** n;

export function recipeOf(recipe) {
  if (typeof recipe === 'string') {
    const R = STYLES[recipe];
    if (!R) fail(`no lane-E recipe '${recipe}' in style/recipes.js`);
    return { ...R, key: recipe };
  }
  if (!recipe || typeof recipe !== 'object') fail('a recipe key or lane-E recipe object is required');
  return recipe;
}

function levelOf(level) {
  if (typeof level === 'number' && Number.isFinite(level)) return level;
  if (level && typeof level === 'object') {
    const v = Object.values(level).filter(x => typeof x === 'number' && Number.isFinite(x));
    return v.length ? Math.max(...v) : 0;
  }
  return 0;
}

export function styleDistance(recipe) {
  const R = recipeOf(recipe), s = R.shape || {}, su = R.surface || {}, li = R.line || null, me = R.medium || {};
  let d = levelOf(s.level);
  d += CANON[s.canon || 'natural'] ?? 0;
  d += SURFACE[su.surface || 'skin'] ?? 0.5;
  d += Math.min(0.5, Math.max(0, (su.fade ?? 0) * 0.5));
  if (li) {
    d += Math.min(0.8, (li.weight ?? 0) * 0.25);
    d += Math.min(0.4, (li.planes ?? 0) * 0.4);
    d += Math.min(0.3, (li.landmarks ?? 0) * 0.3);
  }
  d += MEDIUM[me.kind || 'lit'] ?? 0.5;
  return round(d);
}

export function assertStylizedLook(recipe) {
  const R = recipeOf(recipe), key = R.key || null, distance = styleDistance(R);
  if (key === 'photoreal') fail('photoreal is the baseline, not a stylized candidate');
  const floor = STYLIZED_LOOKS[key]?.minStyleDistance ?? MIN_STYLE_DISTANCE;
  if (distance < floor) fail(`'${key || R.label || 'recipe'}' has style distance ${distance} < ${floor}; it is not a clear stylized look`);
  return { key, distance, recipe: R };
}

export function simulationKey(spec) {
  const out = {};
  for (const k of SIM_FIELDS) out[k] = spec[k] ?? null;
  return canonical(out);
}

export function assertMatched(photo, stylized) {
  if (!photo || !stylized) fail('two specs are required');
  if (photo.style !== 'photorealistic' || stylized.style !== 'stylized') fail("specs must be style 'photorealistic' and 'stylized'");
  for (const k of SIM_FIELDS) if (canonical(photo[k] ?? null) !== canonical(stylized[k] ?? null)) fail(`matched pair differs in '${k}'`);
  if (canonical(photo.recipe ?? null) === canonical(stylized.recipe ?? null)) fail('matched pair must use different recipes');
  return true;
}

// One variable changed: style/recipe. Every simulation field is shared by reference/value.
export function matchedPair({ who, recipe = 'sculpted', seed = 2026, clip = 'walk7', fps = 15, nf = 91, key = 1, every = 2, cloth = true, hair = false, extra = null, clothOpts = { relax: 64, sub: 8 }, assets = SOURCE_PINS } = {}) {
  if (!who) fail('who is required');
  const look = assertStylizedLook(recipe);
  const shared = { who, seed, clip, fps, nf, key, every, cloth, hair, extra: extra ?? null, clothOpts: clothOpts ?? {}, assets };
  const photo = { ...shared, style: 'photorealistic', recipe: 'photoreal' };
  const stylized = { ...shared, style: 'stylized', recipe: look.recipe };
  assertMatched(photo, stylized);
  return { photoreal: photo, stylized, simulation: simulationKey(photo), styleDistance: { photoreal: 0, stylized: look.distance } };
}

// ---------------------------------------------------------------- the styled figure
// The garments Hero builds are its own shells. The current cloth solver reads parts by userData.k3; give the
// main garment shells the same tags and registered fabric names so ClothMotion carries them (no cloth file is
// edited). Construction shells (collar, rims, pockets, boots, gloves) are NOT put through the solver: Hero draws
// them as supersets cut in the colour shader and they do not carry a cloth solve; including them in the solver's
// contact/strain rulers produced false skin/inside counts and degenerate edges in the actual sim record.
const HERO_CLOTH = {
  top: { group: 'garment', name: 'shirt', fabric: 'teeJersey' },
  skirt: { group: 'garment', name: 'shirt', fabric: 'teeJersey' },
  bottom: { group: 'garment', name: 'trousers', fabric: 'chino' },
  vest: { group: 'garment', name: 'vest', fabric: 'canvas' },
};
const SIM_GARMENTS = new Set(Object.keys(HERO_CLOTH));

// The bake's cloth.rest() is taken at the person's built stance, and bakeTrack7 leaves the hero in its last pose.
// Snapshot the stance once and restore it before each solver pass so the two arms start from the same pose.
export function stanceOf(h) {
  return { q: h.bones.map(B => B.quaternion.toArray()), root: h.bone('root')?.position.toArray() || [0, 0, 0] };
}
export function restoreStance(figure) {
  if (!figure?.h || !figure.stance) return figure;
  figure.h.bones.forEach((B, i) => { if (figure.stance.q[i]) B.quaternion.fromArray(figure.stance.q[i]); });
  const root = figure.h.bone('root'); if (root) root.position.fromArray(figure.stance.root);
  figure.h.update();
  return figure;
}

export function tagSimulationParts(h) {
  const parts = [];
  for (const [key, val] of Object.entries(h.cloth || {})) {
    if (!SIM_GARMENTS.has(key)) continue;
    for (const m of [].concat(val || [])) {
      if (!m || !m.isMesh || !m.geometry || !m.geometry.attributes?.position) continue;
      const tag = HERO_CLOTH[key];
      m.userData.k3 = { ...tag, ...(m.userData.k3 || {}) };
      parts.push(m);
    }
  }
  return parts;
}

// Build a lane-E styled figure from a base person record (crewPerson / bodyPerson / personFrom). The caller keeps
// the base and opts; the styled person is the base with the ladder and canon applied, and the Hero is cut on it.
export async function buildStyledFigure({ base, recipe, opts = {}, height = null } = {}) {
  if (!base) fail('a base person record is required');
  const look = assertStylizedLook(recipe);
  const [{ styledPerson }, { Hero }, F4] = await Promise.all([import('./recipes.js'), import('../hero.js'), import('../cloth/wardrobe4/fabrics4.js')]);
  F4.registerFabrics4();
  const H = height ?? opts.height ?? base.height;
  const S = styledPerson(base, look.recipe, { height: H });
  const h = new Hero(S, { ...opts, variant: S.name, height: H });
  S.finish(h);
  const parts = tagSimulationParts(h);
  return { S, h, parts, stance: stanceOf(h), recipe: look.recipe, recipeKey: look.key, styleDistance: look.distance, info: { name: opts.label || S.label || S.name, label: opts.label || S.name, sex: S.sex, age: base.age ?? opts.age, height: H } };
}

// The photoreal baseline on the same base record: the same Hero, un-styled body, garments tagged for the same
// solver. This is the control arm of the matched pair; it is not a lane-E recipe and has style distance 0.
export async function buildBaselineFigure({ base, opts = {}, height = null } = {}) {
  if (!base) fail('a base person record is required');
  const [{ Hero }, F4] = await Promise.all([import('../hero.js'), import('../cloth/wardrobe4/fabrics4.js')]);
  F4.registerFabrics4();
  const H = height ?? opts.height ?? base.height;
  const h = new Hero(base, { ...opts, height: H });
  const parts = tagSimulationParts(h);
  return { S: base, h, parts, stance: stanceOf(h), recipe: 'photoreal', recipeKey: 'photoreal', styleDistance: 0, info: { name: opts.label || base.label || base.name, label: opts.label || base.name, sex: base.sex, age: base.age ?? opts.age, height: H } };
}

// Hero's shader hides the skin under the garments, but its body INDEX still contains the covered triangles. ClothMotion's
// rulers read that index, so the first actual record counted hidden skin as skin through cloth. Cull the triangles whose
// three vertices the rest-pose cloth covers for the solver pass, and restore the index after it (the renderer keeps the
// complete body; the shader cut is unchanged).
async function cullForCloth(P, spec) {
  const g = P.h?.body?.geometry;
  if (!g || !g.index || P._clothCulled) return () => {};
  const { ClothMotion } = await import('../motion/cloth_motion.js');
  let probe;
  try { probe = new ClothMotion(P, spec.clothOpts || {}); probe.rest(); } catch (e) { return () => {}; }
  const cov = probe._cov, original = g.index, full = original.array, nt = full.length / 3;
  if (!cov || !nt) return () => {};
  const keep = new Uint32Array(full.length); let o = 0;
  for (let t = 0; t < nt; t++) { const a = full[t * 3], b = full[t * 3 + 1], c = full[t * 3 + 2]; if (cov[a] && cov[b] && cov[c]) continue; keep[o++] = a; keep[o++] = b; keep[o++] = c; }
  if (o === full.length) return () => {};
  g.setIndex(Array.from(keep.slice(0, o))); P._clothCulled = true;
  return () => { g.index = original; P._clothCulled = false; };
}

// The same bake the studio uses: `actFor7` poses the hero, bakeTrack7 steps ClothMotion every frame (key: 1,
// the sleeve corrections are centimetres and change with the forearm's swing), and the track is encoded.
export async function simulateFigure(figure, spec, { measure = true } = {}) {
  if (!figure?.h || !figure?.parts) fail('buildStyledFigure() result required');
  const { bakeTrack7 } = await import('../motion/bake7.js');
  const { actFor7 } = await import('../motion/act7.js');
  const P = { ...figure.S, h: figure.h, parts: figure.parts, info: figure.info, groom: null, stance: figure.stance };
  const act = () => actFor7(spec.clip, P, spec.who, spec.extra || {});
  const restoreCull = spec.cloth ? await cullForCloth(P, spec) : () => {};
  try {
    restoreStance(P);
    const baked = await bakeTrack7(P, act, { clip: spec.clip, name: spec.who, fps: spec.fps, nf: spec.nf, key: spec.key, every: spec.every, cloth: spec.cloth, hair: !!spec.hair, rulers: true, clothOpts: spec.clothOpts });
    restoreStance(P);
    const metrics = measure && spec.cloth ? await measureClothSim(P, spec, act) : null;
    return { ...baked, P, spec, metrics, styleDistance: figure.styleDistance, recipeKey: figure.recipeKey };
  } finally { restoreCull(); }
}

// The cloth solver's own rulers, with the signed nearest-body distance kept so penetration is in mm:
//   skin   drawn body vertices that a rest-pose-covered garment no longer covers (skin through cloth)
//   sunk   cloth > 2 mm inside DRAWN skin (the visible interpenetration)
//   inside cloth > 3 mm inside the posed body of its own family (the contact pass's own failure count)
//   stretch max edge length / the garment's stance edge length; limit is the part's own smax (4 % woven, 15 % knit)
//   penetration deepest cloth-inside-body distance in mm; clearance the smallest non-negative signed distance
// A frame samples all parts and every edge; `measureEvery` lets a lab sample fewer frames without changing the
// solver (default 1: every frame, as the bake steps it).
export async function measureClothSim(P, spec, act, { measureEvery = 1 } = {}) {
  const restoreCull = await cullForCloth(P, spec);
  try {
    const { ClothMotion } = await import('../motion/cloth_motion.js');
    let cloth;
    try { restoreStance(P); cloth = new ClothMotion(P, spec.clothOpts || {}); cloth.rest(); }
    catch (e) { return { error: String(e && e.message || e).slice(0, 300), frames: 0, parts: 0 }; }
    const a = act(), dt = 1 / spec.fps, MIN_EDGE = 0.002;
    const out = { frames: 0, sampled: 0, parts: cloth.st.length, skin: 0, sunk: 0, inside: 0, insideDrawn: 0, covered: 0, stretchMax: 0, stretchUtil: 0, stretchPart: null, stretchSum: 0, stretchSamples: 0, stretchLimit: 1, relaxMaxMm: 0, maxSecMm: 0, maxPushMm: 0, penetrationMm: 0, clearanceMm: Infinity, error: null };
    if (!cloth.st.length) return { ...out, error: 'no garment parts tagged for ClothMotion' };
    for (const s of cloth.st) if (s.smax > out.stretchLimit) out.stretchLimit = s.smax;
    for (let i = 0; i < spec.nf; i++) {
      a.frame(i * dt); P.h.update();
      let rep;
      try { rep = cloth.step(dt, { first: i === 0, measure: false }); }
      catch (e) { out.error = String(e && e.message || e).slice(0, 300); break; }
      out.frames++;
      out.relaxMaxMm = Math.max(out.relaxMaxMm, rep.relaxMaxMm ?? 0);
      out.maxSecMm = Math.max(out.maxSecMm, rep.maxSecMm ?? 0);
      out.maxPushMm = Math.max(out.maxPushMm, rep.maxPushMm ?? 0);
      if (i % measureEvery) continue;
      out.sampled++;
      const poke = cloth.measure(); const all = poke.all || {};
      out.skin += all.skin || 0; out.sunk += all.sunk || 0; out.inside += all.inside || 0; out.covered += all.covered || 0;
      for (const s of cloth.st) {
        if (!s.el0 || !s.pw) continue;
        for (let e = 0; e < s.ed.length; e += 2) { const l0 = s.el0[e >> 1]; if (l0 < MIN_EDGE) continue; const ia = s.ed[e] * 3, ib = s.ed[e + 1] * 3, L = Math.hypot(s.pw[ib] - s.pw[ia], s.pw[ib + 1] - s.pw[ia + 1], s.pw[ib + 2] - s.pw[ia + 2]); const r = L / l0, util = r / (s.smax || 1); if (r > out.stretchMax) out.stretchMax = r; if (util > out.stretchUtil) { out.stretchUtil = util; out.stretchPart = s.m.userData.k3?.name || null; } out.stretchSum += r; out.stretchSamples++; }
        // signed distance to the nearest DRAWN body vertex of the cloth's own family; hidden skin is not a contact
        for (let v = 0; v < s.n; v++) { const G = cloth._gF[s.fam[v]]; if (!G) continue; const j = G.nearest(s.pw[v * 3], s.pw[v * 3 + 1], s.pw[v * 3 + 2], 0.05); if (j < 0 || !cloth.drawn[j]) continue;
          const sd = (s.pw[v * 3] - cloth._bx[j * 3]) * cloth._bn[j * 3] + (s.pw[v * 3 + 1] - cloth._bx[j * 3 + 1]) * cloth._bn[j * 3 + 1] + (s.pw[v * 3 + 2] - cloth._bx[j * 3 + 2]) * cloth._bn[j * 3 + 2];
          if (sd < -0.003) out.insideDrawn++;
          if (sd < 0) out.penetrationMm = Math.max(out.penetrationMm, -sd * 1000); else out.clearanceMm = Math.min(out.clearanceMm, sd * 1000); }
      }
    }
    out.stretchMean = out.stretchSamples ? out.stretchSum / out.stretchSamples : 0;
    out.penetrationMm = round(out.penetrationMm);
    out.clearanceMm = Number.isFinite(out.clearanceMm) ? round(out.clearanceMm) : null;
    out.stretchMax = round(out.stretchMax);
    out.stretchUtil = round(out.stretchUtil, 6);
    out.stretchLimit = round(out.stretchLimit);
    return out;
  } finally { restoreCull(); }
}

// The comparison the issue asks for: same behaviour, a clear look, no contact or strain beyond the solver's own
// limits. `human_sim.compare()` consumes these names; the counts are the solver's rulers, not a proxy.
export function compareMatched(photoRun, stylizedRun) {
  const photo = photoRun?.spec, stylized = stylizedRun?.spec;
  assertMatched(photo, stylized);
  const p = photoRun.metrics, s = stylizedRun.metrics;
  if (!p || !s) fail('both runs need cloth metrics (spec.cloth=true and measure=true)');
  const valid = (m) => !m.error && m.parts > 0 && m.frames > 0 && m.stretchSamples > 0;
  const contactWithinControl = (c, r) => c.skin <= r.skin * 1.75 + 5 && c.sunk <= r.sunk * 1.75 + 5 && c.insideDrawn <= r.insideDrawn * 1.75 + 5 && c.penetrationMm <= r.penetrationMm + 5;
  const strainWithinControl = (c, r) => c.stretchUtil <= r.stretchUtil * 1.10 + 1e-9;
  const zeroContact = (m) => m.skin === 0 && m.sunk === 0 && m.insideDrawn === 0 && m.penetrationMm === 0;
  const limits = {
    matched_contact: 'stylized skin/sunk/inside-drawn <= 1.75x the photoreal control + 5 vertices each; penetration <= control + 5 mm',
    matched_strain: 'stylized stretch utilisation <= 1.10x the photoreal control',
    absolute_contact: 'informational only: Hero garments are shader-cut shells, not the current person\'s sewn cloth stack',
    fabric_stretch: 'each part against its own fabric smax (4% woven, 15% knit)',
  };
  const lookKey = (stylized.recipe && typeof stylized.recipe === 'object' ? stylized.recipe.key : stylized.recipe) || null;
  const lookFloor = STYLIZED_LOOKS[lookKey]?.minStyleDistance ?? MIN_STYLE_DISTANCE;
  const checks = {
    matched_spec: simulationKey(photo) === simulationKey(stylized),
    photoreal_distance_zero: photoRun.styleDistance === 0,
    stylized_look: stylizedRun.styleDistance >= lookFloor,
    photoreal_cloth_live: photoRun.rep?.cloth === 'live',
    stylized_cloth_live: stylizedRun.rep?.cloth === 'live',
    control_valid: valid(p),
    candidate_valid: valid(s),
    stylized_contact_within_control: contactWithinControl(s, p),
    stylized_strain_within_control: strainWithinControl(s, p),
    photoreal_reps_present: (photoRun.rep?.angles?.length || 0) > 0,
    stylized_reps_present: (stylizedRun.rep?.angles?.length || 0) > 0,
    photoreal_contact_zero: zeroContact(p),
    stylized_contact_zero: zeroContact(s),
  };
  const metrics = ['skin', 'sunk', 'inside', 'insideDrawn', 'stretchMax', 'stretchUtil', 'stretchMean', 'penetrationMm', 'clearanceMm', 'relaxMaxMm'];
  const deltas = {};
  for (const k of metrics) deltas[k] = (typeof s[k] === 'number' && typeof p[k] === 'number') ? round(s[k] - p[k]) : null;
  const passKeys = ['matched_spec', 'photoreal_distance_zero', 'stylized_look', 'photoreal_cloth_live', 'stylized_cloth_live', 'control_valid', 'candidate_valid', 'stylized_contact_within_control', 'stylized_strain_within_control', 'photoreal_reps_present', 'stylized_reps_present'];
  return {
    version: VERSION, pinned_head: PINNED_HEAD, passed: passKeys.every(k => checks[k]),
    checks, limits, style_distance: { photorealistic: photoRun.styleDistance, stylized: stylizedRun.styleDistance },
    metrics: { photorealistic: p, stylized: s }, deltas,
    simulation: simulationKey(photo), track_bytes: { photorealistic: photoRun.rep?.bytes ?? null, stylized: stylizedRun.rep?.bytes ?? null },
    cloth: { photorealistic: photoRun.rep?.cloth ?? null, stylized: stylizedRun.rep?.cloth ?? null },
  };
}
