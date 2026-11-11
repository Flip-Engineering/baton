// ANATOMY / FINE (DETAIL7, round 7, 8 Oct 2026): the FINE-STRUCTURE TIER of the face and body anatomy system. Ours, CC0.
// Everything the anatomy system made so far (FACE6's skeleton field, the muscle and fat compartments, the creases, BODY's FORM) is a
// displacement of hm08's vertices, Loop-subdivided once (2-3 mm apart on the face): no form finer than a few millimetres can exist there.
// This tier carries the anatomy BELOW that: feature curves placed per person by the landmarks and the tissue state (features.js), their
// profiles, the skin's microstructure (micro.js), rasterized into the head's own chart (chart.js, assets/person/fine7/head_chart.*) by a
// per-person bake (bake.js) that runs the same in the browser (the engine: normal + cavity, engine.js) and in node on the farm (Cycles: true
// displacement with adaptive subdivision, videos/blender/person_scene.py; labs/human8/fine7_bake.mjs writes the maps).
// The current person (makePerson('latest:<name>'), integration v7) carries it; v7.js calls applyFine7 and passes the export's popts to Cycles.
// ITERATION 7 (body.js): the TORSO's patch charts (the navel from the tissue, the nipple-areola complexes at BODY7's nippleAt) in a band under the
// head chart; ON for every person (c6 iteration 19: the review gate abolished, 15 Oct 17:15; build.js has passed body: true since 15 Oct).
// `body: false` remains only for fine7_job's 'nobody' twin (the A/B that isolates the torso's patches on a render).
//
//   import { applyFine7 } from '/web/lib/fx/anatomy/fine/index.js';
//   const F = await applyFine7(P.h, P.info, { res: 2048 });     // after makePerson (any v5 / v6 person: hm08 topology, subdivided or not)
//   F.set({ form: 1, pores: 1, cavity: 0.8 }); F.report; F.dispose();
//   const D = await fineData(h, info, { res: 4096, pores: true }) // the bake alone (no hook): { K, B, feats, A, st } for Cycles and tests
import * as FT from '../../body/face_tissue.js';
import { loadChart, chartOnGeometry } from './chart.js';
import { faceFeatures, tissueState, FINE_NUMBERS } from './features.js';
import { fineSurface, bakeFine, lipsInMm } from './bake.js';
import { makeTextures, fineHook, ENGINE_KEY } from './engine.js';
import { withFineCache, cachedBake, FINE_TOKEN } from './fine_cache_client.mjs';
import { skinReport, SKIN_AGE, skinSet, staticFold } from './skin_age.js';
import { bodyPatches, packBody, bodySource, prepareBody, navelGeometryMap, BODY_FINE, BODY_FINE_VERSION } from './body.js';
import { NAVEL_SOFT_VERSION, NAVEL_TISSUE, navelTissue, navelKey, navelWall, solveNavel, prepareNavel, navelSolved } from './navel_soft.js';
import { LIP_FILM, LIP_PRINT_VERSION, lipPrint, lipZGrid } from './lips.js';

export const FINE7_VERSION = 14;   // c7 iteration 23: the lip print's FOLDS (lips.js 5, LIP_PRINT_VERSION 2): the pucker's compression past the period-doubling strain folds the vermilion's film in a phase-locked cascade (2, 4, 8 onset wavelengths), the folds kept at rest as creases that take the tone's compression first (deeper toward the corners and with laxity; the ripple between them shallower). c7 iteration 21: the navel reaches Cycles as GEOMETRY (body.js navelEmbedding / navelGeometryMap: the patch carried onto the solved skin over an injective embedding, a graph along the patch's normal: no torn sheet; fineDataFrom { navelGeom } zeroes its band in the maps). c6 iteration 20: the vermilion's furrows are the WRINKLING of its film (lips.js: the stratum corneum on the soft lip under the orbicularis' compression, a Swift-Hohenberg phase field per person; the comb is gone); the navel's relief measured from the same block solved without the scar (navel_soft v3).
// c6 iteration 19: the navel's solve carries the abdominal wall (navel_soft v2: the recti and the linea alba, the zone of adherence, the skin orthotropic along Langer's lines); the torso's patches ON by default (FINE7_DEFAULTS.body, as build.js since 15 Oct).
// c6 iteration 18: the navel SOLVED (navel_soft.js: the umbilical scar in ANAT8-BODY's soft solver), not drawn.
//   // iteration 11: the ENGINE's twin of the mixture: the pores' sub-pixel variance widens the engine's lobes, their steep walls' hidden share comes out of its specular (engine.js fineL; MICRO_GLSL fineLobeV / fineHide).
// iteration 10: iteration 10: what the lobes see of the microstructure: a mixture (the plateau's variance widens the lobes, the steep insides of the pores and the furrows take their share of the footprint out of them: Cycles varo.f32, hide.f32). iteration 9: the microstructure band-limited to the texel, its sub-texel slope variance to the lobes' roughness (Cycles: var.f32).
// iteration 7: the torso's patch charts (body.js: the navel, the nipple-areola complexes).
// (history)   // iteration 6: every static line's depth from the skin's set (skin_age.js), the age lines' cross-section a crease. iteration 5: the age lines (features.js FEATURES_VERSION 4). iteration 4: soft bands (taper, along-curve profiles, the alar arc, the asymmetric roll), pore and fissure occlusion. iteration 2: valleys fitted to the photographs' cross-sections, true-mm distances, horizon occlusion, pre-filtered pores, the Cycles band split
export const FINE7_DEFAULTS = { res: 2048, form: 1.0, pores: 1.0, cavity: 0.8, net: true, bakePores: false, body: true };
export { FINE_NUMBERS, loadChart, chartOnGeometry, faceFeatures, tissueState, fineSurface, bakeFine, SKIN_AGE, skinSet, staticFold, skinReport, bodyPatches, packBody, bodySource, prepareBody, navelGeometryMap, BODY_FINE, BODY_FINE_VERSION,
  NAVEL_SOFT_VERSION, NAVEL_TISSUE, navelTissue, navelKey, navelWall, solveNavel, prepareNavel, LIP_FILM, LIP_PRINT_VERSION, lipPrint, lipZGrid };

let _lm = null;
export async function loadLandmarks(base = new URL('../../../../assets/face/', import.meta.url).href) {
  if (!_lm) _lm = fetch(base + 'landmarks.json').then(r => r.json());
  return _lm;
}
// the person's info from a lineup name when the caller has none (L08_f24_hispanic -> f, 24, hispanic)
export function infoFromName(name) {
  const m = /(L\d\d)_([fm])(\d\d)_([a-z]+)/.exec(String(name || ''));
  return m ? { name: `${m[1]}_${m[2]}${m[3]}_${m[4]}`, sex: m[2], age: +m[3], group: m[4] } : { name: String(name || 'person'), sex: 'f', age: 35, group: 'white' };
}

// the bake for a built hero (no hook): the chart on its body, the anatomy, the maps
export async function fineData(h, info, o = {}) {
  const t0 = Date.now(), C = await loadChart(o.chartBase), lm = await loadLandmarks(o.faceBase);
  const g = h.body.geometry, Pb = g.attributes.position.array, K = chartOnGeometry(C, g), bodySrc = o.bodySrc || ((o.body ?? FINE7_DEFAULTS.body) ? bodySource(h) : null);
  if (bodySrc) await prepareBody({ ...bodySrc, P: Pb }, info);   // (c6 iteration 18) the navel's solve (node: solved and cached if missing)
  return fineDataFrom(Pb, K, C, lm, info, h.mouth5?.m?.lines || null, { ...o, t0, bodySrc });
}
// the same from raw arrays (node: an export's bind positions with the chart carried onto its topology)
export function fineDataFrom(Pb, K, C, lm, info, lines, o = {}) {   // (K is replaced by the packed chart when the body's patches are on)
  const t0 = o.t0 ?? Date.now(), A = FT.faceAnchors(Pb, lm.ids, Math.min(C.nb, K.n)), st = tissueState(info, o.tissue || {});
  // (iteration 7) the torso's patches, made on THIS body (bind positions Pb) and packed under the head chart
  const BB = (o.body ?? FINE7_DEFAULTS.body) && o.bodySrc ? bodyPatches({ ...o.bodySrc, P: Pb }, info) : null, PK = BB ? packBody(K, C.aspect, BB, { navelGeom: !!o.navelGeom }) : { K, aspect: C.aspect, BP: null };
  const S = fineSurface(Pb, PK.K, A, PK.aspect), ctx = { A, lm, st, S, lips: lines }, feats = faceFeatures(ctx);
  const B = cachedBake(o[FINE_TOKEN], () => bakeFine(S, feats, st, { res: o.res ?? FINE7_DEFAULTS.res, pores: o.bakePores ?? FINE7_DEFAULTS.bakePores, net: o.net ?? FINE7_DEFAULTS.net, lips: lines ? lipsInMm(A, lines) : null, keepPos: !!o.keepPos, ao: o.ao ?? true, split: !!o.split, body: PK.BP }));
  K = PK.K; if (BB) B.report.body = BB.report;
  B.report.ms.all = Date.now() - t0; B.report.tissue = { age: st.age, sex: st.sex, group: st.group, lax: +st.lax.toFixed(3), ageK: +st.ageK.toFixed(3), skin: skinReport(st) };
  B.report.chart = { level: K.level, verts: K.n, on: K.on.reduce((s, x) => s + x, 0), tris: K.tris.length / 3 };
  return { K, B, feats, A, st, S, aspect: PK.aspect, body: BB };
}

// the engine: bake + textures + the skin hook on the hero (a second call replaces the first: same key)
export async function applyFine7(h, info, opts = {}) {
  const C = await loadChart(opts.chartBase), lm = await loadLandmarks(opts.faceBase);
  if (info && (opts.body ?? FINE7_DEFAULTS.body)) await prepareBody(bodySource(h), info);   // (c6 iteration 18) the navel's solve (the page: its cache only)
  const g = h.body.geometry;
  return withFineCache(() => {
    const o = { ...FINE7_DEFAULTS, ...opts }, bodyEnabled = !!(o.body ?? FINE7_DEFAULTS.body);
    const bodySrc = bodyEnabled ? bodySource(h) : null;
    return { positions: bodyEnabled ? null : g.attributes.position.array, chart: C, chartOnBody: chartOnGeometry(C, g),
      landmarks: lm, info, lines: h.mouth5?.m?.lines ?? null, options: o,
      bodySource: bodySrc,
      preparedNavel: bodyEnabled ? navelSolved(info) : null };
  }, token => applyFine7Sync(h, info, token ? { ...opts, [FINE_TOKEN]: token } : opts, C, lm));
}
// the same with the chart and the landmarks already loaded (a page can install it inside a synchronous build step)
export function applyFine7Sync(h, info, opts = {}, C, lm) {
  const o = { ...FINE7_DEFAULTS, ...opts }, g = h.body.geometry, K = chartOnGeometry(C, g);
  // (iteration 7) info: the caller's (makePerson's P.info). Until now a caller without it got infoFromName(h.meta?.person), and hero.js never
  // sets meta.person: every person was baked as a 35-year-old white woman (lab_fine7's engine plates, iterations 1-6). Now a missing info
  // is an error unless the caller says which person it is.
  if (!info) throw new Error('applyFine7: no person info (pass makePerson\'s P.info: age, sex, group, bmi, stature drive the tissue)');
  const D = fineDataFrom(g.attributes.position.array, K, C, lm, info, h.mouth5?.m?.lines || null, { ...o, bodySrc: (o.body ?? FINE7_DEFAULTS.body) ? bodySource(h) : null }), T = makeTextures(D.K, D.B);
  const keys = [].concat(h.o?.skinHook || []).map(x => x?.key || '');
  const laneB = opts.laneB ?? keys.some(k => k.startsWith('likeness-skin')), laneB4 = opts.laneB4 ?? keys.some(k => /^likeness-skin[4-9]/.test(k));
  const hook = fineHook(T, { K: [1, o.form, o.pores, o.cavity], O: D.A.o, dbg: o.dbg ? 1 : 0 }, { laneB, laneB4 });
  if (typeof h.useSkinHook !== 'function') throw new Error('applyFine7: this hero has no skinHook (hero.js H1)');
  h.useSkinHook(hook);
  const U = hook.uniforms;
  const F = { key: ENGINE_KEY, D, T, U, report: { ...D.B.report, gpuBytes: T.bytes, keys, laneB, laneB4 },
    set({ form, pores, cavity, on } = {}) { const k = U.fineK.value; if (on != null) k.x = on ? 1 : 0; if (form != null) k.y = form; if (pores != null) k.z = pores; if (cavity != null) k.w = cavity; },
    dispose() { T.VT.dispose(); T.GT.dispose(); T.MT.dispose(); } };
  h.fine7 = F;
  return F;
}
