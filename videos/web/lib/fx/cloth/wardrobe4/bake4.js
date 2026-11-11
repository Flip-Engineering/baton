// BAKE4 (CLOTHING K4, the wardrobe): a v3 person dressed in an OUTFIT from the wardrobe (garments4.js), baked into the same PV2 container
// person/v3.js bakePersonV3 writes, so makePerson('v3:<name>' | 'v4:<name>', { bake: 'k4' }) draws it (with wardrobe4/fabrics4.js
// registered on the page: registerFabrics4()). The chain is bakePersonV3's dressed default (CLOTH4: one body, the learned prior; POSE's
// seeded stance; K3's foundations; CARRY's A-pose sew carried into the stance; CLOTH4's construction), with the garments generalised:
//   outfit = { id, top: { kind, fabric?, color, tuck? }, bottom: { kind, fabric?, color }, outer?: { kind, fabric?, color },
//              shoes: { kind: 'boot' | 'sneaker', color, ... }, arms?: 'hang' | 'hip' | 'pocket' | 'folded' | ... }
// Ids in the stack: the bottom is 'trousers' (CLOTH4's waistband ring and the shin cut read it: jeans, chinos, a skirt alike), a TUCKED top
// is 'shirt' (the ring holds its tail in), an untucked top 'top', the outer layer 'outer' (layer rank outer). Nothing here changes a
// default path: bakePersonV3 and every older bake are untouched (this file is new; it only calls their exported functions).
import { registerFabrics4 } from './fabrics4.js';
import { GARMENTS, garmentOf, fabricFor, variantFor } from './garments4.js';
import { placeWardrobe } from './place4.js';
import { boneMats, skinPose, SurfaceMesh } from '../collide.js';
import { heroScale } from '../foundations.js';
export const BAKE4_VERSION = 1;
export const K4_DIR = 'k4';
const now = () => (globalThis.performance ? performance.now() : Date.now());
const SM_ARMS_ALL = ['hang', 'pocket', 'hip', 'folded', 'clasp', 'claspBack'];

// fix5 (CLOTH5, opt-in; absent = K4's bake byte for byte): { boot: { ownShin } (boot4's shaft from this side's shin), fall5 (the collar fall as
// a shell), post(h, Sx, parts, G, ctx) (a callback after the construction: cloth5/bake5.js's hem, cuff and collar passes) }
export async function bakeWardrobe(S, e, outfit, { edge = 0.0135, log = () => {}, clear = 0.016, faceRev = 3, featureGain = 1, stanceSeed = 1, stackOpts = {}, c4 = {}, trims = true, fix5 = null } = {}) {
  registerFabrics4();
  const t0 = now(), ms = {}, tm = (k, t) => { ms[k] = Math.round(now() - t); };
  const V2 = await import('../../person/core.js'), V3 = await import('../../person/core.js'), { V2_PLAN, V2_VERSION, personOf, heroOpts2 } = V2;
  const C3 = (await import('../dress3.js')).CARRY3, C4m = await import('../cloth4.js'); await C4m.loadCloth4();
  const { Hero } = await import('../../hero.js');
  const FD = await import('../foundations.js'), FIN = await import('../finish.js'), { dressPerson } = await import('../stack.js');
  const { tailor } = await import('../tailor.js'), { buildGarment, toSewPattern } = await import('../pattern/build.js'), { bodyFrame } = await import('../pattern/place.js');
  const FC = await import('../../face/index.js'), SM = await import('../../motion/stance.js'), TR = trims ? await import('./trim4.js') : null;
  const pl = V2_PLAN[e.name]; if (!pl) throw new Error('k4: no plan for ' + e.name);
  let t = now(); const p = await personOf(S, e, 'prior'); tm('person', t);
  const sex = p.sex, f = sex === 'f', bra = f ? pl.bra : null;
  t = now(); const dS = FD.supportedData(p, bra, {}); tm('support', t);
  t = now(); const Fs = await FC.loadFaceStudio(), src = FC.sourceOf(dS, dS.meta.variants[0].name);
  src.rec = { ...src.rec, sex: p.sex, age: p.age, group: p.group, measures: p.measures, height: p.height };
  const face = FC.makeFace(Fs, src, { rev: faceRev, look: pl.look, ...(faceRev >= 3 ? { featureGain } : {}) }), data = FC.withFace(src, face, '_v3'), variant = data.variant; tm('face', t);
  t = now(); const h = new Hero(data, heroOpts2(e, variant, p.height)); tm('hero', t);
  // the stance: POSE's seeded draw (as v3's dressed default), the arms as the outfit asks (or the draw's)
  let stanceRec = V3.stanceV3(SM, e, { seed: stanceSeed, dressed: true, arms: SM_ARMS_ALL });
  if (outfit.arms && stanceRec.arms !== outfit.arms) stanceRec = { ...stanceRec, arms: outfit.arms, armsWas: stanceRec.arms };
  SM.standPerson(h, stanceRec, { person: p }); h.update();
  // CLOTH5 (opt-in fix5.pose { q: [bone quaternions], root }): the person carried into a KEY POSE of an act (MOTION's track frame) instead of
  // the stance: the same sew, the same A-pose settle and weights, the carry goes on to this pose (cloth5/pose5.js turns it into offsets)
  if (fix5?.pose) { const Q = fix5.pose.q; h.bones.forEach((b, i) => { if (Q[i]) b.quaternion.fromArray(Q[i]); }); if (fix5.pose.root) h.bone('root').position.fromArray(fix5.pose.root); h.update(); }
  t = now(); const W = FD.wearFoundations(h, p, pl.base.map(([id, kind]) => ({ id, kind, color: pl.under }))); tm('foundations', t);
  const scale = W.scale, g0 = h.body.geometry.attributes.position.array, dpos = data.arr('pos_' + variant), full = new Float64Array(dpos.length);
  for (let i = 0; i < full.length; i++) full[i] = dpos[i]; full.set(W.dressed.subarray(0, S.nb * 3));
  h._foundBody = Float32Array.from(g0, (x, i) => (i < S.nb * 3 ? W.dressed[i] / scale : x));
  const head = { v2: V2_VERSION, v3: V3.V3_VERSION, k4: BAKE4_VERSION, armOut: 0, stance: stanceRec, bodyKind: 'prior', name: e.name, label: e.label, sex, age: p.age, group: p.group, plan: pl, bra, variant, scale, height: p.height,
    face: { rev: face.rev, targetScale: face.targetScale ?? 0.1, featureGain: face.featureGain ?? 1, mouth: face.mouth, c2: { skin: face.c2.skin, eyes: face.c2.eyes, lipsMask: face.c2.lipsMask, rest: face.c2.rest, lids: face.c2.lids, jaw: face.c2.jaw && { goGo: face.c2.jaw.goGo, ratio: face.c2.jaw.ratio } }, look: pl.look, homogeneity: face.homogeneity, ms: face.ms },
    prior: e.prior.prior && { model: e.prior.prior.model, sexU: e.prior.prior.sexU }, measures: { bmi: p.measures.bmi, stature: p.height, mass: p.measures.mass }, foundations: W.report, outfit };
  const parts = []; for (const q of W.list) for (const d of q.data) parts.push({ ...d, group: 'found', owner: q.id });
  // ---- shoes (in the collider in place of the c7 boots)
  t = now(); const shoes = outfit.shoes || { kind: 'boot' }, lowShoe = shoes.kind !== 'boot';
  const shoe = lowShoe ? (await import('./shoe4.js')).wearShoes(h, p, shoes, { scale }) : C4m.wearBoots(h, p, { height: 0.165, color: shoes.color || null, ...(fix5?.boot || {}) }, { scale });
  log(e.name, 'shoes', shoes.kind, JSON.stringify(shoe.report)); tm('shoes', t);
  // ---- drafting and placement on the dressed body
  t = now(); const T = tailor(p, { positions: Float32Array.from(full) }), Bf = bodyFrame(p, { positions: Float32Array.from(full), T });
  const wTF = T.mm.waistToFloor / 1000, wTH = T.mm.waistToHips / 1000;
  const K4 = C4m.c4Spec({ boot: false, ...c4 }), G = {};
  const mapOf = async name => import(`../pattern/sewmaps/${name}.js`);
  // the bottom
  { const sp = outfit.bottom, Gd = garmentOf(sp.kind), MAP = await mapOf(Gd.map), design = Gd.design(sex), vr = variantFor(Gd, sex), fabric = fabricFor(Gd, sex, sp.fabric);
    if (Gd.skirt) { const opt = { ...(Gd.options ? Gd.options(T, sex, sp) : {}), ...(sp.options || {}) }, g = await buildGarment(MAP, T.mm, { design, options: opt, h: edge });
      const waistY = T.levels.naturalWaist - (opt.waistbandPosition ?? 0.25) * wTH, X0 = placeWardrobe(g, Bf, { clear: clear + 0.004, waistY });
      G.bottom = { sp, Gd, g, design, fabric, color: sp.color, pattern: toSewPattern(g, X0, { person: e.name }), waistY, report: { kind: sp.kind, design, waistY: +waistY.toFixed(4), lengthCm: +(g.seams[0].La * 100).toFixed(1) } }; }
    else { const V0 = MAP.variants[vr] || {}, rise = sp.rise ?? V0.options?.waistHeight ?? 0.6, hemUp = sp.hemUp ?? (lowShoe ? 0.065 : K4.trousers.hemUp), ease0 = C4m.trouserEase({ ...(V0.options || {}) }, sp.kind === 'work' ? K4.trousers : {});
      const bootG = lowShoe ? null : bootGirth(h, scale), knee = (T.mm.knee || 380) / 1000, kneeEase = bootG ? Math.max(ease0.kneeEase ?? 0.1, Math.min(0.6, (bootG + (lowShoe ? 0.02 : K4.trousers.overBoot)) / knee - 1)) : (ease0.kneeEase ?? 0.1);
      const waistY = T.levels.naturalWaist - wTH * (1 - rise); let lb = Math.max(-0.2, Math.min(0.1, -hemUp / wTF));
      const draftT = lbx => buildGarment(MAP, T.mm, { design, variant: vr, options: { ...ease0, waistHeight: rise, lengthBonus: lbx, kneeEase, ...(sp.options || {}) }, h: edge });
      let g = await draftT(lb);
      const legsOver = Float32Array.from(full), Nb = W.B.N, ank = Math.max(p.kin?.joints?.AJC_L?.[1] ?? 0.08, p.kin?.joints?.AJC_R?.[1] ?? 0.08), top = ank + (lowShoe ? 0.06 : 0.17), out = lowShoe ? 0.012 : K4.trousers.legsOut;
      for (let v = 0; v < S.nb; v++) { const r = S.region[v], nx = Nb[v * 3], nz = Nb[v * 3 + 2], l = Math.hypot(nx, nz); if ((r === 9 || r === 10) && full[v * 3 + 1] < top && l > 0.5) { const k = out * Math.min(1, (top - full[v * 3 + 1]) / 0.03); legsOver[v * 3] += nx / l * k; legsOver[v * 3 + 2] += nz / l * k; } }
      const BfT = bodyFrame(p, { positions: legsOver, T }); let X0 = placeWardrobe(g, BfT, { clear, waistY }), hemY = Infinity, topY = -Infinity;
      const ext = () => { hemY = Infinity; topY = -Infinity; for (let i = 0; i < g.n; i++) { hemY = Math.min(hemY, X0[i * 3 + 1]); topY = Math.max(topY, X0[i * 3 + 1]); } }; ext();
      { const err = (hemY - T.levels.floor) - hemUp; if (Math.abs(err) > 0.008) { lb = Math.max(-0.2, Math.min(0.1, lb + err / wTF)); g = await draftT(lb); X0 = placeWardrobe(g, BfT, { clear, waistY }); ext(); } }
      G.bottom = { sp, Gd, g, design, fabric, color: sp.color, pattern: toSewPattern(g, X0, { person: e.name }), waistY, report: { kind: sp.kind, design: design + '/' + vr, rise, hemUp, kneeEase: +kneeEase.toFixed(3), bootGirth: bootG && +bootG.toFixed(3), lengthBonus: +lb.toFixed(4), placedHemUp: +(hemY - T.levels.floor).toFixed(4) } }; } }
  // the top and the outer layer
  for (const role of ['top', 'outer']) { const sp = outfit[role]; if (!sp) continue; const Gd = garmentOf(sp.kind), MAP = await mapOf(Gd.map), design = Gd.design(sex), fabric = fabricFor(Gd, sex, sp.fabric), tuck = sp.tuck || Gd.tuck || 'out';
    const opt = { ...(Gd.options ? Gd.options(T, sex, { ...sp, tuck }) : {}), ...(sp.options || {}) }, g = await buildGarment(MAP, T.mm, { design, options: opt, h: edge });
    const outer = role === 'outer', X0 = placeWardrobe(g, Bf, { clear: outer ? 0.032 : clear, clearLow: outer ? 0.042 : tuck === 'out' ? 0.03 : null, bentArm: true });
    const pattern = toSewPattern(g, X0, { person: e.name }); if (outer) pattern.layer = 'outer';
    G[role] = { sp, Gd, g, design, fabric, color: sp.color, pattern, tuck, report: { kind: sp.kind, design, tuck, n: g.n } }; }
  tm('draft', t); log(e.name, 'drafted', JSON.stringify(Object.fromEntries(Object.entries(G).map(([k, v]) => [k, v.report]))));
  head.garments = Object.fromEntries(Object.entries(G).map(([k, v]) => [k, { ...v.report, fabric: v.fabric, color: v.color }]));
  // ---- the stack (CARRY's sew + CLOTH4's stack options)
  const idOf = { bottom: 'trousers', top: G.top?.tuck === 'in' ? 'shirt' : 'top', outer: 'outer' };
  const layers = [...pl.base.map(([id, kind]) => ({ id, design: kind.startsWith('bra') ? 'found.bra' : kind.startsWith('undershirt') ? 'found.undershirt' : kind.startsWith('boxers') ? 'found.boxers' : 'found.briefs' })), { id: 'boots', design: 'hero.boots' }];
  if (G.bottom) layers.push({ id: 'trousers', design: 'pattern:' + G.bottom.design, pattern: G.bottom.pattern, fabric: G.bottom.fabric, color: G.bottom.color, partOf: 'bottom', ...(K4.stiff ? { interfacing: K4.stiff.trousers } : {}), ...(fix5?.hemBand && !G.bottom.Gd.skirt ? { hemBand5: fix5.hemBand } : {}) });
  if (G.top) layers.push({ id: idOf.top, design: 'pattern:' + G.top.design, pattern: G.top.pattern, fabric: G.top.fabric, color: G.top.color, partOf: 'top', rules: { tuck: G.top.tuck }, ...(K4.stiff && G.top.Gd.construct === 'shirt' ? { interfacing: K4.stiff.shirt } : {}) });
  if (G.outer) layers.push({ id: 'outer', design: 'pattern:' + G.outer.design, pattern: G.outer.pattern, fabric: G.outer.fabric, color: G.outer.color, partOf: 'top', rules: { tuck: 'out' }, ...(K4.stiff && G.outer.Gd.construct === 'shirt' ? { interfacing: K4.stiff.shirt } : {}) });
  t = now(); const Sx = await dressPerson(h, { person: 'k4:' + e.name, mode: 'made-to-measure', layers }, { cache: false, disk: false, iters: 3, guard: 'measure', sewRigid: false, sewUnder: false, cullSide: true, tuckTorsoOnly: true, tuckDraw: 0.10, tuckFreeze: 0.12, poseBySide: true, T: 1.0, sew: { T: 1.2, hz: 900, iters: 4 },
    carry: { ...C3.carry }, ...C3.stackOpts, ...C4m.stackOpts(K4), ...stackOpts }); tm('stack', t);
  head.stack = { sew: 'A-pose + carry (CARRY3)', order: Sx.report.order, carry: Sx.report.carry || null, garments: Sx.report.garments.map(g => ({ id: g.id, particles: g.particles, ms: g.ms, penMaxMm: g.penMax && +g.penMax.toFixed(1), stretchMean: g.stretchMean, stretchP99: g.stretchP99, seamGapMm: g.sew?.seamGapMm })), ms: Sx.report.ms };
  log(e.name, 'stack', Sx.report.ms, 'ms', JSON.stringify(head.stack.garments.map(g => [g.id, g.seamGapMm && +g.seamGapMm.toFixed(1), g.penMaxMm, g.stretchMean && +g.stretchMean.toFixed(2)])));
  // ---- parts: the solved cloth as panels, then construction
  for (const role of ['bottom', 'top', 'outer']) { if (!G[role]) continue; const id = idOf[role], r = Sx.recs.get(id); if (!r) continue; G[role].id = id; G[role].rec = r;
    parts.push(...FIN.garmentParts(h, r, { id, color: G[role].color, fabric: G[role].fabric }).map(d => ({ ...d, group: 'garment', owner: id, sewn: 1 }))); }
  t = now(); const finRep = {};
  const conS = G.top?.Gd.construct === 'shirt' ? { rec: G.top.rec, g: G.top.g, color: G.top.color, sex } : null, conT = G.bottom?.Gd.construct === 'trousers' ? { rec: G.bottom.rec, g: G.bottom.g, color: G.bottom.color, sex } : null;
  if (conS || conT) { const fin = FIN.construct(h, Sx, { own: true, ...(conS ? { shirt: conS } : {}), ...(conT ? { trousers: conT } : {}), ...(fix5?.fall5 ? { fall5: true } : {}) }); parts.push(...fin.parts.map(d => ({ ...d, group: 'construction', sewn: 1 }))); finRep.k3 = fin.report; }
  if (G.outer?.Gd.construct === 'shirt') { const fin = FIN.construct(h, Sx, { own: true, shirt: { rec: G.outer.rec, g: G.outer.g, color: G.outer.color, sex }, ...(fix5?.fall5 ? { fall5: true } : {}) }); parts.push(...fin.parts.map(d => ({ ...d, name: 'outer.' + d.name, group: 'construction', sewn: 1 }))); finRep.outer = fin.report; }
  // CLOTH4's waistband ring when the waist shows (a tucked top, or a top that ends above it); under an untucked top the waistband is not drawn
  const waistHidden = G.top && G.top.tuck !== 'in';
  if (waistHidden) for (let k = parts.length - 1; k >= 0; k--) if (['waistband', 'beltloops', 'button.waist'].includes(parts[k].name) && parts[k].part === 'trousers') parts.splice(k, 1);
  const K4f = { ...K4, ring: G.bottom && !waistHidden && G.bottom.Gd.ring ? { ...K4.ring, ...G.bottom.Gd.ring } : null, cuffJoin: G.top?.g?.panels?.some(q => /^cuff/.test(q.name)) ? K4.cuffJoin : null };
  head.c4 = { spec: K4f, ...C4m.finish4(h, Sx, parts, K4f, { scale, boot: null, sex, log: (...a) => log(e.name, ...a) }) };
  for (let k = parts.length - 1; k >= 0; k--) if (!parts[k].X || parts[k].X.length < 9 || !parts[k].T || parts[k].T.length < 3) parts.splice(k, 1);
  for (const q of shoe.parts) parts.push(q); head.shoes = { kind: shoes.kind, ...shoe.report };
  if (TR) { const tr = TR.trimAll(h, Sx, parts, G, { scale, sex, log: (...a) => log(e.name, ...a), waistHidden }); finRep.trim4 = tr; }
  // the bottom's construction under an untucked top is not drawn (the fly, the yoke's stitching, a rivet: 1-3 mm proud of the trousers'
  // cloth, they came through a tee lying on it); the line is the top's hem, per angle round the body
  if (waistHidden && G.top?.rec) finRep.underTop = hideUnderTop(h, G.top.rec, parts, FIN, scale, G.top.Gd.trim === 'sweat' ? 0.07 : 0);   // a sweatshirt's rib band hangs 7 cm under its cloth's hem
  finRep.bootCaps = fixBootCaps(parts);
  // an inner garment's cloth lying under (or poking a few mm through) an outer garment's cloth, away from the outer's edges, is not drawn:
  // the tee under the open chore coat, the trousers under an untucked tee, a tucked tail under a skirt (K1's joint settle leaves a few %
  // of crossing edges; at 1:1 they showed as pale patches of the inner cloth on the outer)
  { const pairs = []; if (G.outer && G.top) pairs.push([idOf.top, 'outer']); if (G.top && G.bottom) pairs.push(G.top.tuck === 'in' ? [idOf.top, 'trousers'] : ['trousers', idOf.top]);
    finRep.covered = hideCovered(h, Sx, parts, pairs, scale, FIN); }
  if (fix5?.post) finRep.fix5 = await fix5.post(h, Sx, parts, G, { scale, sex, FIN, log: (...a) => log(e.name, ...a), waistHidden, idOf, outfit });
  head.finish = finRep; tm('finish', t);
  // ---- the skin cull: under the base layer, under every garment's simulated cloth; the neck opening kept; the shin under the leg near the hem
  t = now(); head.foundUnder = FIN.cullUnderGarments(h, parts.filter(q => q.group === 'found'), Sx);
  const cov = FIN.coverSkin(h, { foundCover: W.cover, stack: Sx, whole: true }); head.cover = cov.report;
  head.keepOpen = keepOpen4(h, Sx, cov, G, { keep: K4.collar?.keep ?? 0.035, FIN }); tm('cull', t);
  ms.total = Math.round(now() - t0); head.ms = ms;
  return pack(head, parts, g0, cov, dpos, data, variant, face, FIN, V2_VERSION, V3.V3_VERSION);
}

// the top's hem as a curve round the body (sectors of angle about the hem loop's centre): y and radius; construction parts of the trousers
// above it (posed) and within its radius + 3 cm are dropped from their index
function hideUnderTop(h, rec, parts, FIN, scale, below = 0) {
  // the hem: the lowest boundary loop of the body panels (a hanging arm's sleeve end is often lower: it was taken first, and the
  // trousers' fly, rivets and coin pocket came through tees and sweatshirts)
  const Gs = FIN.solved(h, rec), limb = v => [...Gs.panels[v]].some(pn => /^(sleeve|cuff)/.test(pn)); let hem = null, ly = Infinity;
  for (const L of Gs.loops) { if (L.ids.length < 12 || L.ids.filter(limb).length > L.ids.length / 2) continue; let y = 0; for (const v of L.ids) y += Gs.X[v * 3 + 1]; y /= L.ids.length; if (y < ly) { ly = y; hem = L; } }
  if (!hem) return { skipped: 'no hem loop' }; let cx = 0, cz = 0; for (const v of hem.ids) { cx += Gs.X[v * 3]; cz += Gs.X[v * 3 + 2]; } cx /= hem.ids.length; cz /= hem.ids.length;
  const K = 48, TAU = Math.PI * 2, ys = new Float64Array(K).fill(-Infinity), rs = new Float64Array(K), sec = (x, z) => Math.floor((((Math.atan2(z - cz, x - cx) % TAU) + TAU) % TAU) / TAU * K) % K;
  for (const v of hem.ids) { const j = sec(Gs.X[v * 3], Gs.X[v * 3 + 2]); ys[j] = Math.max(ys[j], Gs.X[v * 3 + 1]); rs[j] = Math.max(rs[j], Math.hypot(Gs.X[v * 3] - cx, Gs.X[v * 3 + 2] - cz)); }
  for (let it = 0; it < K; it++) for (let j = 0; j < K; j++) if (!isFinite(ys[j])) { const a = ys[(j + K - 1) % K], b = ys[(j + 1) % K]; if (isFinite(a) || isFinite(b)) { ys[j] = isFinite(a) && isFinite(b) ? (a + b) / 2 : isFinite(a) ? a : b; rs[j] = Math.max(rs[(j + K - 1) % K], rs[(j + 1) % K]); } }
  h.group.updateMatrixWorld(true); const M = boneMats(h.skeleton, h.body.matrixWorld); let dropped = 0, nParts = 0;
  for (const q of parts) { if (q.group !== 'construction' || q.part !== 'trousers') continue; const n = q.X.length / 3, Xh = new Float64Array(n * 3); for (let i = 0; i < n * 3; i++) Xh[i] = q.X[i] / scale;
    const P = skinPose(Xh, q.SI, q.SW, M, new Float64Array(n * 3), scale), hid = new Uint8Array(n);
    for (let v = 0; v < n; v++) { const j = sec(P[v * 3], P[v * 3 + 2]); hid[v] = P[v * 3 + 1] > ys[j] - 0.01 - below && Math.hypot(P[v * 3] - cx, P[v * 3 + 2] - cz) < rs[j] + 0.06 ? 1 : 0; }
    const T = []; for (let t = 0; t < q.T.length; t += 3) { if (hid[q.T[t]] && hid[q.T[t + 1]] && hid[q.T[t + 2]]) { dropped++; continue; } T.push(q.T[t], q.T[t + 1], q.T[t + 2]); } if (T.length !== q.T.length) nParts++; q.T = Int32Array.from(T); }
  for (let k = parts.length - 1; k >= 0; k--) if (parts[k].T.length < 3) parts.splice(k, 1);
  return { hemLoop: hem.ids.length, trisDropped: dropped, parts: nParts };
}
// for each [inner owner, outer stack id]: the inner's garment triangles whose corners all lie within `gap` outside the outer's posed surface
// or anywhere under it (to 3 cm), not at the outer's open edges, are dropped from the inner's index (T and Tfull)
function hideCovered(h, Sx, parts, pairs, scale, FIN, { gap = 0.008, reach = 0.03 } = {}) {
  h.group.updateMatrixWorld(true); const M = boneMats(h.skeleton, h.body.matrixWorld), rep = {};
  const limbRx = /^(sleeve|cuff)/;
  for (const [inner, outer] of pairs) { const R = Sx.recs.get(outer); if (!R?.surf) continue; let dropped = 0, of = 0;
    // with the trousers on either side of the pair, sleeves take no part (an arm hangs beside the hip: its sleeve lies against the
    // trousers without being under or over them): the outer's surface without its sleeves, the inner's sleeves never hidden
    const trou = inner === 'trousers' || outer === 'trousers'; let surf = R.surf;
    if (trou && inner === 'trousers' && R.L?.pattern) { const Gs = FIN.solved(h, R), keep = []; const Tw = Gs.W.tris; for (let t = 0; t < Tw.length; t += 3) { if ([Tw[t], Tw[t + 1], Tw[t + 2]].some(v => [...Gs.panels[v]].some(pn => limbRx.test(pn)))) continue; keep.push(Tw[t], Tw[t + 1], Tw[t + 2]); }
      surf = new SurfaceMesh(Gs.X, Int32Array.from(keep), { cell: 0.03, boundary: true, normals: Gs.N }); }
    for (const q of parts) { if (q.group !== 'garment' || q.owner !== inner) continue; const n = q.X.length / 3, Xh = new Float64Array(n * 3); for (let i = 0; i < n * 3; i++) Xh[i] = q.X[i] / scale;
      const P = skinPose(Xh, q.SI, q.SW, M, new Float64Array(n * 3), scale), hid = new Uint8Array(n), limbP = (q.panels || []).map(pn => limbRx.test(pn));
      for (let v = 0; v < n; v++) { if (trou && q.panel && limbP[q.panel[v]]) continue; const c = surf.closest(P[v * 3], P[v * 3 + 1], P[v * 3 + 2], reach); if (c && !c.edge && c.d < gap) hid[v] = 1; }
      const cut = T => { const out = []; for (let t = 0; t < T.length; t += 3) { if (hid[T[t]] && hid[T[t + 1]] && hid[T[t + 2]]) { dropped++; continue; } out.push(T[t], T[t + 1], T[t + 2]); } of += T.length / 3; return Int32Array.from(out); };
      q.T = cut(q.T); if (q.Tfull) q.Tfull = cut(q.Tfull); }
    rep[inner + '<' + outer] = { dropped, of }; }
  return rep;
}
// boot4's heel and toe caps are wound inward (drawn as the boot's inside: a dark arch at the heel from behind, a notch at the toe): the fan
// triangles round each cap's centre vertex (the two vertices right after boot4's 27 x 36 section rings) turned to face away from the foot
function fixBootCaps(parts) {
  let fixed = 0; for (const q of parts) { if (!/^boot\.upper\./.test(q.name || '')) continue; const X = q.X, T = q.T, n0 = 27 * 36;
    for (const c of [n0, n0 + 1]) { if (c * 3 + 2 >= X.length) continue; let cz = 0, k = 0; for (let t = 0; t < T.length; t += 3) if (T[t] === c || T[t + 1] === c || T[t + 2] === c) { k++; }
      if (k < 20) continue; let mz = 0; for (let v = 0; v < n0; v++) mz += X[v * 3 + 2]; mz /= n0; const back = X[c * 3 + 2] < mz; void cz;
      for (let t = 0; t < T.length; t += 3) { if (!(T[t] === c || T[t + 1] === c || T[t + 2] === c)) continue; const a = T[t] * 3, b = T[t + 1] * 3, d = T[t + 2] * 3, ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], vx = X[d] - X[a], vy = X[d + 1] - X[a + 1], nz = ux * vy - uy * vx;
        if ((back && nz > 0) || (!back && nz < 0)) { const tmp = T[t + 1]; T[t + 1] = T[t + 2]; T[t + 2] = tmp; fixed++; } } } }
  return { fixed };
}
// the neck opening of the innermost top (the highest boundary loop of its cloth) and the neck itself are never cut (cloth4.js keepOpen's
// rule, for any top: a tee's crew neck, a sweatshirt's, a shirt's collar); the shin within 4 mm of a trouser leg is cut (the slimmer leg)
function keepOpen4(h, Sx, cov, G, { keep, FIN }) {
  const top = G.top?.rec || G.outer?.rec; if (!top) return { skipped: 'no top' };
  const RG_NECK = 1, RG_TORSO = 2, g = h.body.geometry, idx = g.index.array, P = g.attributes.position.array, AH = g.attributes.aHero?.array, n = P.length / 3, scale = heroScale(h);
  h.group.updateMatrixWorld(true); const M = boneMats(h.skeleton, h.body.matrixWorld), X = skinPose(Float64Array.from(P), g.attributes.skinIndex.array, g.attributes.skinWeight.array, M, new Float64Array(n * 3), scale);
  const Gs = FIN.solved(h, top); let best = null, by = -Infinity; for (const L of Gs.loops) { if (L.ids.length < 10) continue; let y = 0; for (const v of L.ids) y += Gs.X[v * 3 + 1]; y /= L.ids.length; if (y > by) { by = y; best = L; } }
  if (!best) return { skipped: 'no neck loop' };
  const pts = best.ids.map(v => [Gs.X[v * 3], Gs.X[v * 3 + 1], Gs.X[v * 3 + 2]]), k2 = keep * keep, kp = new Uint8Array(n); let yMin = Infinity; for (const q of pts) yMin = Math.min(yMin, q[1]);
  for (let v = 0; v < n; v++) { const r = AH ? Math.round(AH[v * 4]) : -1; if (r === RG_NECK) { kp[v] = 1; continue; } if (r !== RG_TORSO || X[v * 3 + 1] < yMin - keep) continue;
    for (const q of pts) { const d = (X[v * 3] - q[0]) ** 2 + (X[v * 3 + 1] - q[1]) ** 2 + (X[v * 3 + 2] - q[2]) ** 2; if (d < k2) { kp[v] = 1; break; } } }
  const before = cov.full.length, out = []; for (const t of cov.full) { if (kp[idx[t * 3]] || kp[idx[t * 3 + 1]] || kp[idx[t * 3 + 2]]) continue; out.push(t); }
  const tr = Sx.recs.get('trousers'); let hemCut = 0;
  if (tr?.surf && !G.bottom?.Gd.skirt) { const cut = new Uint8Array(n), has = new Uint8Array(idx.length / 3); for (const t of out) has[t] = 1;
    for (let v = 0; v < n; v++) { const r = AH ? Math.round(AH[v * 4]) : -1; if (r !== 9 && r !== 8) continue; const q = tr.surf.closest(X[v * 3], X[v * 3 + 1], X[v * 3 + 2], 0.03); if (q && q.d < 0.004) cut[v] = 1; }
    for (let t = 0; t < idx.length / 3; t++) if (!has[t] && cut[idx[t * 3]] && cut[idx[t * 3 + 1]] && cut[idx[t * 3 + 2]]) { out.push(t); hemCut++; } }
  cov.full = Uint32Array.from(out.sort((a, b) => a - b)); return { trisFullBefore: before, trisFull: cov.full.length, neckLoop: best.ids.length, neckY: +by.toFixed(3), hemCut };
}
function pack(head, parts, g0, cov, dpos, data, variant, face, FIN, V2_VERSION, V3_VERSION) {
  const k3 = FIN.packBake({ ...head }, parts, { body: Float32Array.from(g0), cullBase: cov.base, cullFull: cov.full });
  const P = Float32Array.from(dpos), E = Float32Array.from(data.arr('eyes_' + variant));
  const hj = new TextEncoder().encode(JSON.stringify({ v2: V2_VERSION, v3: V3_VERSION, k4: BAKE4_VERSION, name: head.name, variant, k3: k3.byteLength, pos: P.length, eyes: E.length, mouth: face.mouth }));
  const hl = (hj.length + 3) & ~3, k3l = (k3.byteLength + 3) & ~3, bin = new Uint8Array(8 + hl + k3l + P.byteLength + E.byteLength);
  bin.set([80, 86, 50, 32]); new DataView(bin.buffer).setUint32(4, hl, true); bin.fill(32, 8, 8 + hl); bin.set(hj, 8); bin.set(k3, 8 + hl);
  bin.set(new Uint8Array(P.buffer), 8 + hl + k3l); bin.set(new Uint8Array(E.buffer), 8 + hl + k3l + P.byteLength);
  return { bin, report: { ...head, parts: parts.map(q => ({ name: q.name, group: q.group, n: q.X.length / 3 })) } };
}
// the shoe's top girth (the hull of the collider meshes' top 2.5 cm, per side): v3.js's bootGirth (not exported there)
const hull = pts => { const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); } for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  const H = lo.slice(0, -1).concat(up.slice(0, -1)); let L = 0; for (let i = 0; i < H.length; i++) { const a = H[i], b = H[(i + 1) % H.length]; L += Math.hypot(b[0] - a[0], b[1] - a[1]); } return L; };
export function bootGirth(h, scale) { const bt = h.cloth?.boots ? [].concat(h.cloth.boots) : []; if (!bt.length) return null; let ytop = -Infinity; const side = { L: [], R: [] };
  for (const m of bt) { const X = m.geometry.attributes.position.array; for (let i = 0; i < X.length / 3; i++) ytop = Math.max(ytop, X[i * 3 + 1] * scale); }
  for (const m of bt) { const X = m.geometry.attributes.position.array; for (let i = 0; i < X.length / 3; i++) { const y = X[i * 3 + 1] * scale; if (y > ytop - 0.03 && y < ytop - 0.005) side[X[i * 3] > 0 ? 'L' : 'R'].push([X[i * 3] * scale, X[i * 3 + 2] * scale]); } }
  const g = ['L', 'R'].map(k => (side[k].length > 3 ? hull(side[k]) : 0)); return Math.max(...g) || null; }
export { GARMENTS };
