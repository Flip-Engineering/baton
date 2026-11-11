// DRESS3 (CLOTH3, round 3, 3 Oct): the v2 person's dressed bake, re-made. The same chain as person/v2.js bakePerson (K3's recipe: the bust
// in its bra, FACE c2, the Hero, the base layer, K2's shirt and trousers drafted over it, K1's stack, K3's construction, the skin cull) with
// what the c8 judge asked of the cloth:
//   - ONE BODY: dressed on the person's own learned-prior body (SOMA / MHR), placed from it (no form-1 placement, no second bake body);
//   - SEWN IN THE A-POSE, then CARRIED to the stance in ~10 steps (stack.js opts.carry), into whatever pose the person gets (opts.stance:
//     POSE's motion/stance.js record, as makePerson2 takes it; default: standV2, today's page pose);
//   - TROUSERS from the waist: a rise below the natural waist (Titan's waistHeight, default 0.6) and a hem length (hemUp: m over the
//     floor at the outseam) that does not move the waist (place.js waistY; Titan's lengthBonus solved for it); the hems kept out of
//     the boots (the carry's boot guard);
//   - construction in the garment's own fabric; every garment and construction part marked `sewn` (makePerson2 draws them with
//     hero.js's sewn head: no cuts, no painted detail; real seams for the seam wear; construction as closed solids).
// Output: the PV2 container makePerson2 reads (person/v2.js unpackPerson2), to assets/person/<dir>/<name>.pv2.bin (labs/clothing2/cloth3_bake.mjs).
// Neutral demo people (CAST's lineup); nothing here is a video's.
import { V2_PLAN, V2_VERSION, personOf, heroOpts2, standV2, stanceOf2 } from '../person/core.js';
const now = () => (globalThis.performance ? performance.now() : Date.now());
export const DRESS3_VERSION = 1;
// CARRY (CLOTHING round 3b): the carry's tuck and cuff holds, for a caller that drafts and dresses itself (person/v3.js bakePersonV3):
//   draft the shirt with { ...easeFor('shirt', T, { fit: 'work' }), ...CARRY3.shirtOptions } and call dressPerson(h, outfit, { ..., carry: CARRY3.carry,
//   ...CARRY3.stackOpts }) with the hero standing in its stance (dressPerson remembers the pose, sews in the A-pose, carries back to it).
//   Here: bakePerson3(S, e, { carry3: true, sleeveBonus: 0.10, stance }). Notes: review/studio_clothing_c2/after/carry/NOTES.md
export const CARRY3 = { carry: { hold3: true }, stackOpts: { sewCuffs: true }, shirtOptions: { sleeveLengthBonus: 0.10 } };

export async function bakePerson3(S, e, { edge = 0.0135, log = () => {}, which = 'prior', placeFrom = 'self', clear = 0.016, carry = true, rise = 0.6, hemUp = 0.11,
  stance = null, stanceSeed = 1, cups = null, own = true, bentArm = true, wholeCover = true, baseOnly = false, stackOpts = {}, sleeveBonus = null, carry3 = false } = {}) {
  const t0 = now(), ms = {}, tm = (k, t) => { ms[k] = Math.round(now() - t); };
  const pl = V2_PLAN[e.name]; if (!pl) throw new Error('dress3: no plan for ' + e.name);
  const { Hero } = await import('../hero.js');
  const FD = await import('./foundations.js'), FIN = await import('./finish.js'), { dressPerson } = await import('./stack.js');
  const { tailor, easeFor } = await import('./tailor.js'), { buildGarment, toSewPattern } = await import('./pattern/build.js');
  const { bodyFrame, placeGarment } = await import('./pattern/place.js');
  const SHIRT = await import('./pattern/sewmaps/shirt.js'), TROUSERS = await import('./pattern/sewmaps/trousers.js');
  const FC = await import('../face/index.js');
  let t = now(); const p = await personOf(S, e, which); tm('person', t);
  const f = p.sex === 'f', bra = f ? pl.bra : null;
  t = now(); const dS = FD.supportedData(p, bra, cups ? { dome: true } : {}); tm('support', t);   // cups 'dome': the bust domed in its cup
  t = now(); const F = await FC.loadFaceStudio(), src = FC.sourceOf(dS, dS.meta.variants[0].name);
  src.rec = { ...src.rec, sex: p.sex, age: p.age, group: p.group, measures: p.measures, height: p.height };
  const face = FC.makeFace(F, src, { rev: 2, look: pl.look }), data = FC.withFace(src, face, '_v2'), variant = data.variant; tm('face', t);
  t = now(); const h = new Hero(data, heroOpts2(e, variant, p.height)); tm('hero', t);
  // the pose the person will be drawn in (the carry's target): POSE's record when given, else today's v2 stance
  let stanceRec = null, armOut = 0;
  if (stance === 'bind') { h.resetPose(); h.update(); }   // debug: dressed in the A-pose only (no carry needed)
  else if (stance) { const SM = await import('../motion/stance.js'); stanceRec = stanceOf2(SM, e, stance, { seed: stanceSeed, dressed: true }); SM.standPerson(h, stanceRec, { person: p }); h.update(); }
  else armOut = standV2(h, e, pl, p);
  t = now(); const W = FD.wearFoundations(h, p, pl.base.map(([id, kind]) => ({ id, kind, color: pl.under, ...(cups && id === 'bra' ? { strapBlend: true } : {}) }))); tm('foundations', t);
  const scale = W.scale, g0 = h.body.geometry.attributes.position.array, dpos = data.arr('pos_' + variant), full = new Float64Array(dpos.length);
  for (let i = 0; i < full.length; i++) full[i] = dpos[i]; full.set(W.dressed.subarray(0, S.nb * 3));
  h._foundBody = Float32Array.from(g0, (x, i) => (i < S.nb * 3 ? W.dressed[i] / scale : x));
  log(e.name, 'foundations', JSON.stringify(W.report.garments.map(g => [g.id, g.verts, g.liftMaxMm, g.ms])));
  const head = { v2: V2_VERSION, dress3: DRESS3_VERSION, armOut, ...(stanceRec ? { stance: stanceRec } : {}), bodyKind: which, name: e.name, label: e.label, sex: p.sex, age: p.age, group: p.group, plan: pl, bra, variant, scale, height: p.height,
    face: { mouth: face.mouth, c2: { skin: face.c2.skin, eyes: face.c2.eyes, lipsMask: face.c2.lipsMask, rest: face.c2.rest, lids: face.c2.lids, jaw: face.c2.jaw && { goGo: face.c2.jaw.goGo, ratio: face.c2.jaw.ratio } }, look: pl.look, homogeneity: face.homogeneity, ms: face.ms },
    prior: e.prior.prior && { model: e.prior.prior.model, sexU: e.prior.prior.sexU }, measures: { bmi: p.measures.bmi, stature: p.height, mass: p.measures.mass }, foundations: W.report };
  // baseOnly: the figure-study bake (<name>_base: the underwear alone on the same body)
  if (baseOnly) { const parts = []; for (const q of W.list) for (const d of q.data) parts.push({ ...d, group: 'found', owner: q.id });
    const cov = FIN.coverSkin(h, { foundCover: W.cover }); head.cover = cov.report; ms.total = Math.round(now() - t0); head.ms = ms; head.cups = cups;
    return pack(head, parts, g0, cov, dpos, data, variant, face, FIN); }
  // drafting and placement on the body that is dressed (placeFrom 'self'), or integration v2's form-1 placement ('form1')
  let pT = p, fullP = full;
  if (placeFrom === 'form1' && p.priorVA) { const p1 = await personOf(S, e, 'form1'), d1 = FD.supportedData(p1, bra), P1 = d1.supportPos || p1.built.pos; pT = p1; fullP = new Float64Array(full.length);
    for (let i = 0; i < full.length; i++) fullP[i] = i < S.nb * 3 ? P1[i] + (full[i] - dpos[i]) : full[i]; }
  t = now(); const T = tailor(pT, { positions: Float32Array.from(fullP) });
  const shirt = await buildGarment(SHIRT, T.mm, { design: f ? 'simone' : 'simon', options: { ...easeFor('shirt', T, { fit: 'work' }), ...(sleeveBonus != null ? { sleeveLengthBonus: sleeveBonus } : {}) }, h: edge });   // CARRY: sleeveBonus (opt-in) = FreeSewing's sleeveLengthBonus (default 0.035)
  // the trousers from the waist: the rise (Titan's waistHeight lowers the waist by waistToHips x (1 - it)) and the hem hemUp over the floor
  // at the outseam: Titan's leg is waistToFloor x (1 + lengthBonus) from the natural waist, so lengthBonus = -hemUp / waistToFloor
  const wTF = T.mm.waistToFloor / 1000, wTH = T.mm.waistToHips / 1000, waistY = T.levels.naturalWaist - wTH * (1 - rise);
  let lb = Math.max(-0.2, Math.min(0.1, -hemUp / wTF));
  // the leg's opening goes OVER the boot: Titan's leg is straight below the knee (hem = knee x (1 + kneeEase)); the c7 boot's shaft top is
  // ~42 cm round, more than the hem K2's ease gave (36-39 cm), so the legs stopped on the boot's top and shattered into it
  const bootG = bootGirth(h, scale), knee = (T.mm.knee || 380) / 1000, ease0 = easeFor('trousers', T);
  const kneeEase = bootG ? Math.max(ease0.kneeEase ?? 0.15, Math.min(0.6, (bootG + 0.05) / knee - 1)) : (ease0.kneeEase ?? 0.15);
  const draftT = lbx => buildGarment(TROUSERS, T.mm, { design: 'titan', variant: f ? 'slacks' : 'work', options: { ...ease0, waistHeight: rise, lengthBonus: lbx, kneeEase }, h: edge });
  let trou = await draftT(lb);
  // the trouser legs placed OUTSIDE the boots (K3's rule): the shin and foot below the boot's top stand 2.6 cm out, sideways only
  const legsOver = Float32Array.from(fullP), Nb = W.B.N, ank = Math.max(pT.kin?.joints?.AJC_L?.[1] ?? 0.08, pT.kin?.joints?.AJC_R?.[1] ?? 0.08), bootTop = ank + 0.17;
  for (let v = 0; v < S.nb; v++) { const r = S.region[v], nx = Nb[v * 3], nz = Nb[v * 3 + 2], l = Math.hypot(nx, nz); if ((r === 9 || r === 10) && fullP[v * 3 + 1] < bootTop && l > 0.5) { const k = (carry ? 0.04 : 0.026) * Math.min(1, (bootTop - fullP[v * 3 + 1]) / 0.03); legsOver[v * 3] += nx / l * k; legsOver[v * 3 + 2] += nz / l * k; } }
  const Bf = bodyFrame(pT, { positions: Float32Array.from(fullP), T }), BfT = bodyFrame(pT, { positions: legsOver, T });
  let X0T = placeGarment(trou, BfT, { clear, waistY }), hemY = Infinity, topY = -Infinity; const ext = () => { hemY = Infinity; topY = -Infinity; for (let i = 0; i < trou.n; i++) { hemY = Math.min(hemY, X0T[i * 3 + 1]); topY = Math.max(topY, X0T[i * 3 + 1]); } }; ext();
  // the placed hem against the asked one (Titan's outseam is not exactly waistToFloor x (1 + lengthBonus) from the placed waist): once more
  { const err = (hemY - T.levels.floor) - hemUp; if (Math.abs(err) > 0.008) { lb = Math.max(-0.2, Math.min(0.1, lb + err / wTF)); trou = await draftT(lb); X0T = placeGarment(trou, BfT, { clear, waistY }); ext(); } }
  const patS = toSewPattern(shirt, placeGarment(shirt, Bf, { clear, bentArm }), { person: e.name }), patT = toSewPattern(trou, X0T, { person: e.name });
  tm('draft', t); log(e.name, 'drafted', shirt.n, trou.n, 'rise', rise, 'lengthBonus', lb.toFixed(3), 'waist y', waistY.toFixed(3), 'placed hem', (hemY - T.levels.floor).toFixed(3), 'top', (topY - T.levels.floor).toFixed(3));
  head.trousers = { rise, hemUp, kneeEase: +kneeEase.toFixed(3), bootGirth: bootG && +bootG.toFixed(3), lengthBonus: +lb.toFixed(4), waistY: +waistY.toFixed(4), naturalWaist: +T.levels.naturalWaist.toFixed(4), placedHemUp: +(hemY - T.levels.floor).toFixed(4), placedTopUp: +(topY - T.levels.floor).toFixed(4) };
  const outfit = { person: 'v2:' + e.name, mode: 'made-to-measure', layers: [
    ...pl.base.map(([id, kind]) => ({ id, design: kind.startsWith('bra') ? 'found.bra' : kind.startsWith('undershirt') ? 'found.undershirt' : kind.startsWith('boxers') ? 'found.boxers' : 'found.briefs' })),
    { id: 'boots', design: 'hero.boots' },
    { id: 'trousers', design: 'pattern:titan', pattern: patT, fabric: pl.trousers[0], color: pl.trousers[1], partOf: 'bottom' },
    { id: 'shirt', design: 'pattern:' + shirt.design, pattern: patS, fabric: pl.shirt[0], color: pl.shirt[1], partOf: 'top', rules: { tuck: 'in' } }] };
  t = now(); const Sx = await dressPerson(h, outfit, { cache: false, disk: false, iters: 3, guard: 'measure', sewRigid: false, sewUnder: false, cullSide: true, tuckTorsoOnly: true, tuckDraw: 0.10, tuckFreeze: 0.12, poseBySide: true, T: carry ? 1.0 : 1.4, sew: { T: 1.2, hz: 900, iters: 4 },
    ...(carry ? { carry: { ...(carry === true ? {} : carry), ...(carry3 ? { hold3: true } : {}) } } : {}), ...(carry3 ? { sewCuffs: true } : {}), ...stackOpts }); tm('stack', t);
  head.stack = { order: Sx.report.order, carry: Sx.report.carry || null, garments: Sx.report.garments.map(g => ({ id: g.id, particles: g.particles, ms: g.ms, penMaxMm: g.penMax && +g.penMax.toFixed(1), stretchMean: g.stretchMean, stretchP99: g.stretchP99, seamGapMm: g.sew?.seamGapMm })), ms: Sx.report.ms };
  head.k2 = { shirt: shirt.design, trousers: 'titan/' + (f ? 'slacks' : 'work'), edge, clear, placeFrom };
  head.check = checks(h, Sx, scale); log(e.name, 'check', JSON.stringify(head.check));
  log(e.name, 'stack', Sx.report.ms, 'ms', JSON.stringify(head.stack.garments.map(g => [g.id, g.seamGapMm && +g.seamGapMm.toFixed(1), g.penMaxMm, g.stretchMean && +g.stretchMean.toFixed(2)])));
  const parts = [];
  for (const q of W.list) for (const d of q.data) parts.push({ ...d, group: 'found', owner: q.id });
  for (const id of ['trousers', 'shirt']) { const r = Sx.recs.get(id), fb = id === 'shirt' ? pl.shirt : pl.trousers; parts.push(...FIN.garmentParts(h, r, { id, color: fb[1], fabric: fb[0] }).map(d => ({ ...d, group: 'garment', owner: id, sewn: 1 }))); }
  t = now(); const fin = FIN.construct(h, Sx, { own, shirt: { rec: Sx.recs.get('shirt'), g: shirt, color: pl.shirt[1], sex: p.sex }, trousers: { rec: Sx.recs.get('trousers'), g: trou, color: pl.trousers[1], sex: p.sex } });
  parts.push(...fin.parts.map(d => ({ ...d, group: 'construction', sewn: 1 }))); head.finish = fin.report; tm('finish', t);
  t = now(); head.foundUnder = FIN.cullUnderGarments(h, parts.filter(q => q.group === 'found'), Sx);
  const cov = FIN.coverSkin(h, { foundCover: W.cover, stack: Sx, whole: wholeCover }); head.cover = cov.report; tm('cull', t);
  ms.total = Math.round(now() - t0); head.ms = ms;
  head.cups = cups; return { ...pack(head, parts, g0, cov, dpos, data, variant, face, FIN), h, Sx };
}
// the PV2 container (person/v2.js bakePerson's tail, unchanged)
function pack(head, parts, g0, cov, dpos, data, variant, face, FIN) {
  const k3 = FIN.packBake({ ...head }, parts, { body: Float32Array.from(g0), cullBase: cov.base, cullFull: cov.full });
  const P = Float32Array.from(dpos), E = Float32Array.from(data.arr('eyes_' + variant));
  const hj = new TextEncoder().encode(JSON.stringify({ v2: V2_VERSION, name: head.name, variant, k3: k3.byteLength, pos: P.length, eyes: E.length, mouth: face.mouth }));
  const hl = (hj.length + 3) & ~3, k3l = (k3.byteLength + 3) & ~3, bin = new Uint8Array(8 + hl + k3l + P.byteLength + E.byteLength);
  bin.set([80, 86, 50, 32]); new DataView(bin.buffer).setUint32(4, hl, true); bin.fill(32, 8, 8 + hl); bin.set(hj, 8); bin.set(k3, 8 + hl);
  bin.set(new Uint8Array(P.buffer), 8 + hl + k3l); bin.set(new Uint8Array(E.buffer), 8 + hl + k3l + P.byteLength);
  return { bin, report: { ...head, parts: parts.map(q => ({ name: q.name, group: q.group, n: q.X.length / 3 })) } };
}
// ---------------------------------------------------------------- checks (posed, m): the tuck and the hems over the boots
const hull = pts => { const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); } for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  const H = lo.slice(0, -1).concat(up.slice(0, -1)); let L = 0; for (let i = 0; i < H.length; i++) { const a = H[i], b = H[(i + 1) % H.length]; L += Math.hypot(b[0] - a[0], b[1] - a[1]); } return L; };
// the c7 boot's shaft girth at its top (bind, m; the larger side)
function bootGirth(h, scale) { const bt = h.cloth?.boots ? [].concat(h.cloth.boots) : []; if (!bt.length) return null; let ytop = -Infinity; const side = { L: [], R: [] };
  for (const m of bt) { const X = m.geometry.attributes.position.array; for (let i = 0; i < X.length / 3; i++) ytop = Math.max(ytop, X[i * 3 + 1] * scale); }
  for (const m of bt) { const X = m.geometry.attributes.position.array; for (let i = 0; i < X.length / 3; i++) { const y = X[i * 3 + 1] * scale; if (y > ytop - 0.03 && y < ytop - 0.005) side[X[i * 3] > 0 ? 'L' : 'R'].push([X[i * 3] * scale, X[i * 3 + 2] * scale]); } }
  const g = ['L', 'R'].map(k => (side[k].length > 3 ? hull(side[k]) : 0)); return Math.max(...g) || null; }
export function checks(h, Sx, scale) {
  const tr = Sx.recs.get('trousers'), sh = Sx.recs.get('shirt'), out = {}, r3 = x => +x.toFixed(3);
  if (tr && sh) { let wy = 0, k = 0; for (const hd of tr.pattern.holds) for (const i of hd.ids) { wy += tr.X[i * 3 + 1]; k++; } let dmin = Infinity, amin = Infinity; const vc = sh.solved.visCore;
    for (let p = 0; p < sh.G.np; p++) { if (sh.limb && sh.limb[p]) continue; const y = sh.X[p * 3 + 1]; amin = Math.min(amin, y); if (!vc || vc[p]) dmin = Math.min(dmin, y); }
    out.tuck = { tuckTop: r3(sh.L.tuckTop ?? NaN), waistbandY: r3(wy / Math.max(1, k)), shirtDrawnMinY: r3(dmin), shirtMinY: r3(amin) }; }
  if (tr) { const legs = { L: [], R: [] }; let ymin = Infinity; for (let p = 0; p < tr.G.np; p++) ymin = Math.min(ymin, tr.X[p * 3 + 1]);
    for (let p = 0; p < tr.G.np; p++) { const y = tr.X[p * 3 + 1]; if (y < ymin + 0.03) legs[tr.X[p * 3] > 0 ? 'L' : 'R'].push([tr.X[p * 3], tr.X[p * 3 + 2]]); }
    out.hem = { minY: r3(ymin), girthL: legs.L.length > 3 ? r3(hull(legs.L)) : null, girthR: legs.R.length > 3 ? r3(hull(legs.R)) : null }; }
  const bt = h.cloth?.boots ? [].concat(h.cloth.boots) : []; if (bt.length) { const side = { L: [], R: [] }; let ytop = -Infinity;
    for (const m of bt) { const X = m.geometry.attributes.position.array; for (let i = 0; i < X.length / 3; i++) ytop = Math.max(ytop, X[i * 3 + 1] * scale); }
    for (const m of bt) { const X = m.geometry.attributes.position.array; for (let i = 0; i < X.length / 3; i++) { const y = X[i * 3 + 1] * scale; if (y > ytop - 0.03 && y < ytop - 0.005) side[X[i * 3] > 0 ? 'L' : 'R'].push([X[i * 3] * scale, X[i * 3 + 2] * scale]); } }
    out.boots = { top: r3(ytop), girthTopL: side.L.length > 3 ? r3(hull(side.L)) : null, girthTopR: side.R.length > 3 ? r3(hull(side.R)) : null }; }
  return out;
}
